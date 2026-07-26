/**
 * The house cast, deciding.
 *
 * The gap this closes, stated plainly: every decision in the live world is `HEURISTIC`
 * and the deployed world's own health check calls it **unhealthy** for exactly that
 * reason (`deciding_share_bps: 0` against a floor of 2500). It is right to. Heuristics
 * produce motion, not drama — and A6's central claim, *months of honest work followed by
 * abuse of granted authority at the moment of maximum leverage*, is not a behaviour a
 * policy function can exhibit, because there is no line of code you could write for it
 * that would not also be the loyalty meter A6 forbids.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE TICK NEVER AWAITS THE NETWORK.**
 *
 * `decide()` is synchronous, top to bottom, and there is no `await` in it. A wake starts
 * a request and returns immediately; the reply lands in a member's inbox from a promise
 * callback, and is picked up by a *later* `decide()`. So a member that asked a question
 * at tick 400 acts on the answer at tick 402 — which is exactly what a remote agent over
 * HTTP does, and it is the only shape that is safe: tick resolution is deterministic and
 * measured in single-digit milliseconds, and an LLM call is measured in seconds.
 *
 * The tick therefore cannot be slowed, stalled or failed by the API. The worst an outage
 * can do is make the cast fall back to heuristics, which is where it started.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── FOUR MORE PROPERTIES, EACH LOAD-BEARING ──
 *
 * 1. **Replay never consults the cast.** Boot seats the cast from the seed and then
 *    replays the *action log*; `decide()` is called only from the live scheduler. A
 *    decision enters the record as a logged action with `decision_source: 'LIVE'`, and
 *    the record is what reproduces. That is what makes a non-deterministic player safe
 *    inside a deterministic world, and `test/cast/replay.test.ts` proves the transport
 *    is called zero times during a replay.
 *
 * 2. **Default off.** {@link llmCastEnabled} is false unless `COMPACT_CAST_LLM` is set,
 *    and with it unset {@link LlmCast.decide} returns the heuristic cast's own array
 *    unchanged — the same objects, not a re-derivation. Nobody spends money by accident.
 *
 * 3. **Degrade, never freeze.** API error, timeout, quota exhaustion, budget cap,
 *    malformed JSON, an unknown verb, a float in a param: every one of them falls the
 *    member back to its heuristic decision, marked `FALLBACK`, and the show continues.
 *    Nothing in this file may throw into the scheduler, and every stage is wrapped.
 *
 * 4. **It reads the same observation an external agent gets, and pays a wake for it.**
 *    `buildObservation` with `fresh: true`, metered against `WAKES_PER_RECKONING`, the
 *    same sixteen a stranger gets. The existing heuristic cast reads `runtime.*`
 *    internals directly and for free, which is an A4 defect — the house seeing more than
 *    the metered players. This class does not do that on its LIVE path. It does not fix
 *    it on the fallback path either, because the fallback *is* the existing heuristic;
 *    see the note on {@link LlmCast.decide}.
 */

import { buildObservation } from '../api/observe.js';
import { ACTIONS_PER_TICK, reckoningIndex, WAKES_PER_RECKONING } from '../core/time.js';
import type { Clock } from '../core/time.js';
import type { PrincipalId } from '../core/types.js';
import type { Runtime } from '../sim/runtime.js';
import type { SubmittedAction } from '../tick/index.js';
import {
  CastBudget,
  DEFAULT_CAST_LIMITS,
  formatMicros,
  type CastBudgetLimits,
  type CastSpendReport,
} from './budget.js';
import { characterOf, type CastCharacter } from './characters.js';
import { HeuristicCast, type CastMember, type CastOptions } from './heuristic.js';
import { CastMemory } from './memory.js';
import { parseReply, type ParsedAction } from './parse.js';
import { buildPrompt, loadContract, type ContractExcerpt } from './prompt.js';
import {
  CastTransportError,
  DEFAULT_CAST_MODEL,
  describeFailure,
  type CastTransport,
  type CompletionReply,
} from './transport.js';

/**
 * Ticks between one member's wakes. *(calibrate)*
 *
 * 288 ticks per Reckoning divided by 16 wakes is 18, so the default spends the budget
 * evenly and exactly. Lower it and the wake budget binds instead, which is the correct
 * failure: the cap that runs out first should be the one an external agent also has.
 */
export const DEFAULT_WAKE_GAP_TICKS = 18;

/**
 * Ticks a wake may take before the member gives up on it.
 *
 * In ticks, not seconds, because DET-8 fails the build on a bare duration and because
 * the question is genuinely "how stale may this answer be", which is a game-time
 * question. Three ticks is 30 s at `fast` and 15 min at `prod`.
 */
export const DEFAULT_DEADLINE_TICKS = 3;

/**
 * Actions one reply may plan. *(calibrate)*
 *
 * A3: "jobs and operations are durable intents"; a wake that buys exactly one action is
 * a wake that cannot express a plan, and at one action per 18 ticks the cast would barely
 * move. Three is short enough that the world has not changed underneath the last one —
 * and when it has, the action is refused and the correction is on the member's next
 * prompt, which is the game working.
 */
export const DEFAULT_PLAN_MAX = 3;

/**
 * What a member does on a tick it has no live decision for.
 *
 *   - `heuristic` — act as the heuristic cast would, marked `HEURISTIC`. Preserves
 *     today's motion and §15.6's guarantee that unfilled role slots get filled, so
 *     ventures still always resolve.
 *   - `quiet` — do nothing. Every action the member takes is then its own, which drives
 *     `deciding_share_bps` up, at the cost of a visibly emptier map and of §15.6's
 *     role-filling guarantee.
 */
export type CastIdlePolicy = 'heuristic' | 'quiet';

export const DEFAULT_IDLE_POLICY: CastIdlePolicy = 'heuristic';

export interface LlmCastOptions extends CastOptions {
  readonly transport: CastTransport;
  readonly clock: Clock;
  readonly model?: string;
  readonly limits?: Partial<CastBudgetLimits>;
  readonly wakeGapTicks?: number;
  readonly deadlineTicks?: number;
  readonly planMax?: number;
  readonly idle?: CastIdlePolicy;
  /** Where log lines go. Redacted before they get here; redacted again on the way out. */
  readonly log?: (line: string) => void;
  /**
   * The player contract. Omit to read `agent.md`; pass `null` to force the disabled
   * path (which is what a test for "the contract could not be read" needs).
   */
  readonly contract?: ContractExcerpt | null;
  readonly memory?: CastMemory;
}

/** One member's inbox and plan. Not state: never hashed, snapshotted or replayed. */
interface MemberState {
  /** Actions from the last accepted reply, submitted one per tick, in order. */
  plan: ParsedAction[];
  inflight: Inflight | null;
  /** Filled by a promise callback, drained by the next `decide`. */
  ready: Ready | null;
  lastWakeTick: number;
  /** Monotonic. One action per member per tick means it is unique inside any window. */
  sequence: number;
  /** Set when the next action must be a `FALLBACK`, and why. */
  fallbackWhy: string | null;
}

interface Inflight {
  readonly generation: number;
  readonly startedTick: number;
  readonly controller: AbortController;
}

type Ready =
  | { readonly generation: number; readonly ok: true; readonly reply: CompletionReply }
  | { readonly generation: number; readonly ok: false; readonly why: string };

/**
 * The wake budget, applied to the house cast.
 *
 * A deliberately separate, deliberately identical copy of the rule in `server.ts`: sixteen
 * per principal per Reckoning, reset on the boundary and never accumulating. It is not
 * shared with the HTTP layer's ledger because a cast principal never arrives over HTTP,
 * and reaching into `createApp`'s closure to share a `Map` would couple the cast to the
 * server for no gain. What matters is that the *number* is `WAKES_PER_RECKONING` read from
 * `core/time.ts`, so there is one place to change it.
 */
class WakeLedger {
  private reckoning = -1;
  private readonly spent = new Map<PrincipalId, number>();

  rollTo(index: number): void {
    if (index === this.reckoning) return;
    this.reckoning = index;
    this.spent.clear();
  }

  remaining(principal: PrincipalId): number {
    return Math.max(0, WAKES_PER_RECKONING - (this.spent.get(principal) ?? 0));
  }

  spend(principal: PrincipalId): boolean {
    const used = this.spent.get(principal) ?? 0;
    if (used >= WAKES_PER_RECKONING) return false;
    this.spent.set(principal, used + 1);
    return true;
  }

  get total(): number {
    let n = 0;
    for (const used of this.spent.values()) n += used;
    return n;
  }
}

export interface LlmCastReport {
  readonly enabled: boolean;
  readonly model: string;
  readonly members: number;
  readonly wakesThisReckoning: number;
  readonly live: number;
  readonly fallback: number;
  readonly discarded: number;
  readonly spend: CastSpendReport;
}

export class LlmCast {
  private readonly heuristic: HeuristicCast;
  private readonly budget: CastBudget;
  private readonly wakes = new WakeLedger();
  private readonly memory: CastMemory;
  private readonly state = new Map<string, MemberState>();
  private readonly characters = new Map<string, CastCharacter>();
  private readonly contract: ContractExcerpt | null;
  private readonly model: string;
  private readonly wakeGapTicks: number;
  private readonly deadlineTicks: number;
  private readonly planMax: number;
  private readonly idle: CastIdlePolicy;
  private readonly sink: (line: string) => void;

  private seed = '';
  private generation = 0;
  private capAnnounced = false;
  private liveCount = 0;
  private fallbackCount = 0;
  private discardedCount = 0;

  constructor(
    private readonly runtime: Runtime,
    private readonly options: LlmCastOptions,
  ) {
    this.heuristic = new HeuristicCast(runtime, options);
    this.budget = new CastBudget(options.limits ?? {});
    this.memory = options.memory ?? new CastMemory();
    this.contract = options.contract === undefined ? loadContract() : options.contract;
    this.model = options.model ?? DEFAULT_CAST_MODEL;
    this.wakeGapTicks = Math.max(1, options.wakeGapTicks ?? DEFAULT_WAKE_GAP_TICKS);
    this.deadlineTicks = Math.max(1, options.deadlineTicks ?? DEFAULT_DEADLINE_TICKS);
    this.planMax = Math.max(1, options.planMax ?? DEFAULT_PLAN_MAX);
    this.idle = options.idle ?? DEFAULT_IDLE_POLICY;
    this.sink = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));

    if (this.contract === null) {
      this.log(
        'cast: the LLM cast is OFF because the player contract could not be read from agent.md ' +
          '(missing file, or a required section was renamed). Falling back to heuristics rather ' +
          'than prompting from a private copy of the rules — see the scar #1 note in prompt.ts.',
      );
    }
  }

  get roster(): readonly CastMember[] {
    return this.heuristic.roster;
  }

  /** The seeded characters, for the operator log and for the client. */
  get cast(): ReadonlyMap<string, CastCharacter> {
    return this.characters;
  }

  /** Whether a wake could happen right now. False once the spend cap has latched. */
  get live(): boolean {
    return this.contract !== null && !this.budget.disabled;
  }

  /**
   * Seat the cast, then give each member its character.
   *
   * Delegated to {@link HeuristicCast} rather than reimplemented: the seating rules are
   * load-bearing (raiders outside the Commons, or every raid they ever create is refused
   * by the floor) and a second copy of them would drift.
   */
  seat(seed: string): readonly CastMember[] {
    this.seed = seed;
    const members = this.heuristic.seat(seed);
    for (const member of members) {
      const character = characterOf(member, seed);
      if (character !== null) this.characters.set(member.handle, character);
      this.state.set(member.handle, {
        plan: [],
        inflight: null,
        ready: null,
        // So the first wake can happen immediately rather than 18 ticks in.
        lastWakeTick: -this.wakeGapTicks,
        sequence: 0,
        fallbackWhy: null,
      });
    }
    return members;
  }

  /**
   * Decide this tick. **Synchronous. No `await`. Never throws.**
   *
   * The heuristic decision for every member is computed first and unconditionally,
   * because it is the fallback for all four failure paths and computing it lazily would
   * mean computing it inside a `catch`. It is cheap, deterministic and read-only.
   *
   * ── THE A4 NOTE, STATED HONESTLY ──
   *
   * The LIVE path reads `buildObservation`, the same payload an external agent gets, and
   * spends a wake for it. The FALLBACK and HEURISTIC paths are the existing
   * {@link HeuristicCast}, which reads `runtime.*` internals directly and for free. That
   * is a pre-existing A4 defect — the house cast seeing everything while metered agents
   * do not — and this class **does not fix it and does not worsen it**: the heuristic
   * decision computed here is the identical decision the same heuristic cast would have
   * made on the same tick with this class absent.
   */
  decide(tick: number, seed: string): readonly SubmittedAction[] {
    const heuristic = this.heuristic.decide(tick, seed);
    if (!this.live) return heuristic;

    const index = reckoningIndex(tick);
    this.budget.rollTo(index);
    this.wakes.rollTo(index);

    const fallbacks = new Map<PrincipalId, SubmittedAction>();
    for (const action of heuristic) fallbacks.set(action.principal, action);

    const out: SubmittedAction[] = [];
    for (const member of this.heuristic.roster) {
      const state = this.state.get(member.handle);
      if (state === undefined) {
        // Seated by something other than `seat()`. Play it as a pure heuristic rather
        // than inventing a character for it.
        const fallback = fallbacks.get(member.principal);
        if (fallback !== undefined) out.push(fallback);
        continue;
      }

      const action = this.step(member, state, tick, fallbacks.get(member.principal) ?? null);
      if (action !== null) out.push(action);

      // Separate try/catch from `step`, so a failure to *start* a wake can never emit a
      // second action for a member that has already emitted one — which would be two
      // submissions sharing a window, and (if the sequences ever collided) an ordering
      // tie resolved by arrival, which is the one thing A4 forbids.
      try {
        this.maybeWake(member, state, tick, action !== null);
      } catch (error: unknown) {
        this.log(`cast: ${member.handle} could not start a wake: ${describeFailure(error)}`);
      }
    }
    return out;
  }

  /**
   * One member's move: absorb whatever arrived, expire whatever did not, then act.
   *
   * Total: every path returns an action or `null`, and the `catch` converts any surprise
   * into the heuristic decision rather than into a thrown scheduler.
   */
  private step(
    member: CastMember,
    state: MemberState,
    tick: number,
    fallback: SubmittedAction | null,
  ): SubmittedAction | null {
    try {
      this.absorb(member, state, tick);
      this.expire(member, state, tick);
      return this.act(member, state, tick, fallback);
    } catch (error: unknown) {
      this.log(`cast: ${member.handle} fell back after an internal failure: ${describeFailure(error)}`);
      this.fallbackCount += 1;
      if (fallback === null) return null;
      state.sequence += 1;
      return { ...fallback, clientSequence: state.sequence, decisionSource: 'FALLBACK' };
    }
  }

  /** Move a completed reply into a plan, or record why it was not usable. */
  private absorb(member: CastMember, state: MemberState, tick: number): void {
    const ready = state.ready;
    if (ready === null) return;
    state.ready = null;

    // A reply for a wake we already gave up on. The money is spent either way (see the
    // callback in `maybeWake`), but the answer is stale and the member has moved on.
    if (state.inflight === null || state.inflight.generation !== ready.generation) return;
    state.inflight = null;

    if (!ready.ok) {
      state.fallbackWhy = ready.why;
      this.memory.remember(member.handle, tick, `your wake failed (${ready.why}); a heuristic acted`);
      return;
    }

    const parsed = parseReply(ready.reply.text, {
      // The engine's own registry. Never a copy: a verb list maintained here would be a
      // second rules surface, and it would go stale the first time a verb landed.
      liveVerbs: this.runtime.liveVerbs,
      planMax: this.planMax,
    });
    if (!parsed.ok) {
      this.discardedCount += 1;
      state.fallbackWhy = `discarded:${parsed.why}`;
      this.memory.remember(
        member.handle,
        tick,
        `your reply was DISCARDED (${parsed.why}). Reply with one JSON object and nothing else.`,
      );
      this.log(`cast: ${member.handle} reply discarded (${parsed.why})`);
      return;
    }

    state.plan = [...parsed.plan];
    if (parsed.note !== null) {
      this.memory.remember(member.handle, tick, `you reasoned: ${parsed.note}`);
    }
  }

  /** Give up on a wake that has outlived its deadline. */
  private expire(member: CastMember, state: MemberState, tick: number): void {
    const flight = state.inflight;
    if (flight === null) return;
    if (tick - flight.startedTick <= this.deadlineTicks) return;
    state.inflight = null;
    flight.controller.abort();
    state.fallbackWhy = `deadline:${String(this.deadlineTicks)}-ticks`;
    this.memory.remember(member.handle, tick, 'your wake timed out; a heuristic acted for you');
    this.log(`cast: ${member.handle} wake exceeded ${String(this.deadlineTicks)} ticks; falling back`);
  }

  /** Emit at most one action: the next planned one, a fallback, or the idle policy's. */
  private act(
    member: CastMember,
    state: MemberState,
    tick: number,
    fallback: SubmittedAction | null,
  ): SubmittedAction | null {
    state.sequence += 1;
    const base = {
      principal: member.principal,
      clientSequence: state.sequence,
      // Matches the heuristic cast exactly. Nothing in the engine reads it; it exists so
      // the A4 audit can compare arrival order against resolution order.
      arrivalMs: tick,
    };

    const next = state.plan.shift();
    if (next !== undefined) {
      this.liveCount += 1;
      this.memory.remember(member.handle, tick, `you sent ${next.verb} ${describeParams(next.params)}`);
      return { ...base, verb: next.verb, params: next.params, decisionSource: 'LIVE' };
    }

    const why = state.fallbackWhy;
    state.fallbackWhy = null;
    if (fallback === null) return null;

    if (why !== null) {
      this.fallbackCount += 1;
      return { ...fallback, ...base, decisionSource: 'FALLBACK' };
    }
    if (this.idle === 'quiet') return null;
    return { ...fallback, ...base, decisionSource: 'HEURISTIC' };
  }

  /**
   * Start a wake, if this member may have one.
   *
   * Every gate below refuses *before* any money is committed, and the order is cheapest
   * first. The observation — the expensive part — is built only once every gate has
   * passed, which matters because `buildObservation` solves the whole affordance set.
   */
  private maybeWake(member: CastMember, state: MemberState, tick: number, actedThisTick: boolean): void {
    if (state.inflight !== null) return;
    if (state.ready !== null) return;
    if (state.plan.length > 0) return;
    if (tick - state.lastWakeTick < this.wakeGapTicks) return;
    if (this.runtime.paused) return;

    const verdict = this.budget.mayCall();
    if (!verdict.ok) {
      if (verdict.why === 'SPEND_CAP' && !this.capAnnounced) {
        this.capAnnounced = true;
        const spend = this.budget.report();
        this.log(
          `cast: ⚑ SPEND CAP TRIPPED at ${formatMicros(spend.spentMicros)} of ` +
            `${formatMicros(spend.capMicros)} after ${String(spend.calls)} call(s). The LLM cast is ` +
            'DISABLED for the life of this process and the world is on heuristics. Raise ' +
            'COMPACT_CAST_SPEND_CAP_MICROS and restart to continue.',
        );
      }
      return;
    }

    const character = this.characters.get(member.handle);
    if (character === undefined) return;
    if (this.contract === null) return;
    if (!this.wakes.spend(member.principal)) return;

    state.lastWakeTick = tick;

    // Draining here and nowhere else is the designed semantics: a correction is delivered
    // when an observation is read, exactly as it is for an agent over HTTP.
    const corrections = this.runtime.takeCorrections(member.principal);
    for (const correction of corrections) {
      this.memory.remember(
        member.handle,
        correction.tick,
        `your ${correction.verb} was REFUSED (${correction.invariant}): ${correction.hint}`,
      );
    }

    const observation = buildObservation({
      runtime: this.runtime,
      principal: member.principal,
      // Wall clock, display only, from the injected clock. `Date.now` is banned (DET-7).
      serverNowMs: this.options.clock.nowMs(),
      fresh: true,
      wakesRemaining: this.wakes.remaining(member.principal),
      stale: false,
      corrections,
      actionsRemaining: Math.max(0, ACTIONS_PER_TICK - (actedThisTick ? 1 : 0)),
    });

    const prompt = buildPrompt({
      contract: this.contract,
      // Derived per wake from the record. Cheap: one pass over the standing journal, which the
      // resumed INV-21 check already keeps small enough to walk.
      relations: this.runtime.relationsFor(member.principal).map((r) => ({
        other: String(r.other),
        kept: r.kept,
        broke: r.broke,
        youKept: r.youKept,
        youBroke: r.youBroke,
      })),
      character,
      observation,
      memory: this.memory.render(member.handle),
      liveVerbs: [...this.runtime.liveVerbs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      planMax: this.planMax,
      maxObservationChars: this.budget.caps.maxPromptChars,
    });

    // Charged at its worst case BEFORE the call, so a burst of concurrent wakes cannot
    // overshoot the cap by exactly the concurrency. `settle` corrects it downwards when
    // the provider reports what it actually used.
    const reserved = this.budget.charge(prompt.chars);

    this.generation += 1;
    const generation = this.generation;
    const controller = new AbortController();
    state.inflight = { generation, startedTick: tick, controller };

    try {
      // ── THE ONE LINE THAT MUST NOT BE AWAITED ──────────────────────────────
      // `void` rather than `await`: the scheduler is mid-tick and the world is about to
      // resolve. The reply lands in `state.ready` from a callback and is picked up by a
      // later `decide()`.
      void this.options.transport
        .complete({
          model: this.model,
          messages: prompt.messages,
          maxOutputTokens: this.budget.caps.maxOutputTokens,
          signal: controller.signal,
        })
        .then((reply: CompletionReply) => {
          this.budget.settle(reserved, reply, reply.text.length);
          state.ready = { generation, ok: true, reply };
        })
        .catch((error: unknown) => {
          // ── REFUND ONLY WHAT CANNOT HAVE BEEN BILLED ──────────────────────
          //
          // `reachedProvider === false` means the request never got to anything that could
          // charge for it: no key, DNS, connection refused. None of those can be on an
          // invoice, so keeping the reservation would be *phantom* spend — and phantom
          // spend trips the cumulative cap, which latches, which disables the cast
          // permanently for calls that were never made. A world misconfigured with no key
          // would give up on the LLM path after a few Reckonings of spending nothing.
          //
          // **Not `status === null`.** That was the same question asked the wrong way, and
          // it got the two most common provider-answered failures backwards: a 200 whose
          // body will not parse (OpenAI's refusal shape has `content: null`) and a call
          // the cast aborted at its deadline both arrive with no status and both are
          // billed. Refunding them let the whole cast run with the cumulative cap reading
          // `$0.00` — measured at 96 billed calls, `spentMicros: 0`, cap never tripped.
          // Under-counting real spend is the dangerous direction, so the transport now
          // answers the billing question directly and this only reads it.
          //
          // Anything that is not a CastTransportError at all stays charged, deliberately:
          // an unrecognised failure is not evidence that nothing was spent.
          if (error instanceof CastTransportError && !error.reachedProvider) {
            this.budget.refund(reserved);
          }
          state.ready = { generation, ok: false, why: describeFailure(error, 120) };
        });
    } catch (error: unknown) {
      // A transport that throws synchronously never returned a promise, so nothing will
      // ever fill the inbox. Clear the flight here or the member waits for the deadline.
      state.inflight = null;
      state.fallbackWhy = describeFailure(error, 120);
      this.log(`cast: ${member.handle} transport refused the call: ${describeFailure(error)}`);
    }
  }

  /** Abort every wake in flight. Called on shutdown so nothing holds the process open. */
  close(): void {
    for (const state of this.state.values()) {
      state.inflight?.controller.abort();
      state.inflight = null;
      state.ready = null;
    }
  }

  report(): LlmCastReport {
    return {
      enabled: this.live,
      model: this.model,
      members: this.characters.size,
      wakesThisReckoning: this.wakes.total,
      live: this.liveCount,
      fallback: this.fallbackCount,
      discarded: this.discardedCount,
      spend: this.budget.report(),
    };
  }

  /** One line describing the seated cast, for the boot log. Never carries a key. */
  describeRoster(): string {
    const rows = [...this.characters.values()].map(
      (c) => `${c.handle} (${c.title}, ${c.stance.toLowerCase()})`,
    );
    return rows.join(' · ');
  }

  private log(line: string): void {
    // Redacted here as well as in `transport.ts`, because this is the last gate before a
    // string reaches a file, and a redactor you have to remember to call gets forgotten.
    this.sink(redactLine(line));
  }
}

/** A short, bounded rendering of an action's params, for the memory log. */
function describeParams(params: Readonly<Record<string, unknown>>): string {
  const parts: string[] = [];
  for (const key of Object.keys(params).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    parts.push(`${key}=${String(params[key]).slice(0, 32)}`);
  }
  return parts.join(' ').slice(0, 120);
}

/** Re-exported through a local name so `llm.ts` has exactly one redaction call site. */
function redactLine(line: string): string {
  return describeFailure(line, 600);
}

// ── Environment ─────────────────────────────────────────────────────────────

/**
 * Is the LLM cast switched on?
 *
 * **Default off, and it takes an explicit affirmative to turn on.** `COMPACT_CAST_LLM=1`
 * is a typo away from `COMPACT_CAST_LLM=0`, and a truthiness test would read the second
 * as "on" — a whole Reckoning of spend from one character. So the accepted values are
 * listed and everything else is off.
 */
export function llmCastEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env['COMPACT_CAST_LLM'] ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

/** Read an integer from the environment, or fall back. Never throws, never returns NaN. */
function envInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/** Everything the LLM cast reads from the environment, in one place. */
export interface CastEnvSettings {
  readonly enabled: boolean;
  readonly model: string;
  readonly idle: CastIdlePolicy;
  readonly wakeGapTicks: number;
  readonly deadlineTicks: number;
  readonly planMax: number;
  readonly limits: Partial<CastBudgetLimits>;
}

export function castSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): CastEnvSettings {
  const model = (env['COMPACT_CAST_MODEL'] ?? '').trim();
  const DEFAULTS = DEFAULT_CAST_LIMITS;
  const limits: Partial<CastBudgetLimits> = {
    callsPerReckoning: envInt(env, 'COMPACT_CAST_CALLS_PER_RECKONING', DEFAULTS.callsPerReckoning),
    maxOutputTokens: envInt(env, 'COMPACT_CAST_MAX_OUTPUT_TOKENS', DEFAULTS.maxOutputTokens),
    maxPromptChars: envInt(env, 'COMPACT_CAST_MAX_PROMPT_CHARS', DEFAULTS.maxPromptChars),
    spendCapMicros: envInt(env, 'COMPACT_CAST_SPEND_CAP_MICROS', DEFAULTS.spendCapMicros),
    inputMicrosPerMillion: envInt(env, 'COMPACT_CAST_INPUT_MICROS_PER_MTOK', DEFAULTS.inputMicrosPerMillion),
    outputMicrosPerMillion: envInt(env, 'COMPACT_CAST_OUTPUT_MICROS_PER_MTOK', DEFAULTS.outputMicrosPerMillion),
  };
  return {
    enabled: llmCastEnabled(env),
    model: model.length > 0 ? model : DEFAULT_CAST_MODEL,
    idle: (env['COMPACT_CAST_LLM_IDLE'] ?? '').trim().toLowerCase() === 'quiet' ? 'quiet' : 'heuristic',
    wakeGapTicks: envInt(env, 'COMPACT_CAST_WAKE_GAP_TICKS', DEFAULT_WAKE_GAP_TICKS),
    deadlineTicks: envInt(env, 'COMPACT_CAST_DEADLINE_TICKS', DEFAULT_DEADLINE_TICKS),
    planMax: envInt(env, 'COMPACT_CAST_PLAN_MAX', DEFAULT_PLAN_MAX),
    limits,
  };
}
