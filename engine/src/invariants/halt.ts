/**
 * The halt state machine (SPEC §15.2).
 *
 * > **On assertion failure: abort the tick and halt. Never publish a broken tick.**
 * > Halting has defined semantics, because a world that stops with no resume path is
 * > an outage in front of an audience:
 * > - The world enters `PAUSED`. `observe` returns the last good snapshot marked
 * >   `stale`, with an empty affordance list; `act` returns 503 with a reason; the
 * >   client shows a **"Reckoning delayed"** card, not a countdown to an event that
 * >   will not occur.
 * > - Submissions queue (bounded, with a published cap) rather than being lost.
 * > - An operator replays the failed tick from `(snapshot_T, action_log_T, seed_T)`
 * >   in a sandbox, fixes the defect, and issues a signed `resume` that re-runs it
 * >   deterministically. Because the input triple is immutable, the fixed tick
 * >   produces the world every observer was promised.
 *
 * Four things here are structural rather than documented, because each is a rule
 * that a later change would otherwise quietly break:
 *
 * 1. **`affordances` is `readonly never[]` while paused.** Not "usually empty" —
 *    there is no type that would let a paused observation carry one. An affordance
 *    is an offer, and the world cannot honour an offer it is not running.
 * 2. **{@link DelayCard} has no countdown field.** A countdown to an event that will
 *    not occur is worse than no information, because it is information that is
 *    false. `act`'s refusal says `retryAfterTicks: null` for the same reason: the
 *    honest answer to "when" is *nobody knows yet*.
 * 3. **The input triple is deep-frozen on capture**, and its hash is what a resume
 *    order must name. "The fixed tick produces the world every observer was
 *    promised" is only true if nobody edited the inputs on the way to the fix, and
 *    `Object.freeze` survives the boundary with plain JS where `readonly` does not.
 * 4. **Resume is signed.** Restarting a public record is not an unauthenticated
 *    operation. Ed25519 over the canonical claim, verified against a named operator
 *    key, and the claim binds to *this* tick and *this* triple hash — so a resume
 *    captured off the wire cannot be replayed at a later halt.
 */

import { canonicalHash, canonicalize, type CanonicalValue } from '../core/canonical.js';
import type { InvariantViolation, PrincipalId, WorldStatus } from '../core/types.js';
import { verifyBytes, type PublicKeyJwk } from '../identity/keys.js';
import type { InvariantReport } from './aggregate.js';
import { TOP_SEVERITY_ID, halting, rankViolations } from './registry.js';

/**
 * The published cap on the submission queue.
 *
 * Published, because SPEC §15.2 says "bounded, with a published cap" — an
 * undisclosed bound is indistinguishable from losing the submission, and scar #3
 * says a full system returns a helpful 503 rather than degrading. Also INV-26: this
 * is the declared cap for the queue array.
 */
export const SUBMISSION_QUEUE_BOUND = 4096;

/** The card's headline, verbatim. Golden-filed; the client renders this string. */
export const RECKONING_DELAYED = 'Reckoning delayed';

// ── the immutable input triple ───────────────────────────────────────────────

/**
 * `(snapshot_T, action_log_T, seed_T)` — replay's only input (SPEC §15.1).
 *
 * Events are **output**, never input. Nothing in here is an event, and nothing
 * downstream may fold events to reconstruct it: that is the event-sourcing cliff
 * §15.1 names, and it is what makes `expected_state_version` incoherent.
 */
export interface TickInputs {
  readonly tick: number;
  readonly snapshot: CanonicalValue;
  /** Every submitted action, in resolution order — `(priority, principal, seq)`. */
  readonly actionLog: readonly CanonicalValue[];
  /** The seed string. `hash(seed)` published before actions were accepted (DET-6). */
  readonly seed: string;
}

/**
 * The identity of a triple. A resume order names this, so an operator cannot fix a
 * different tick than the one that broke, and cannot quietly amend the inputs.
 */
export function tripleHash(inputs: TickInputs): string {
  return canonicalHash({
    tick: inputs.tick,
    snapshot: inputs.snapshot,
    actionLog: [...inputs.actionLog],
    seed: inputs.seed,
  });
}

const MAX_FREEZE_DEPTH = 32;

/**
 * Deep-freeze the triple at capture.
 *
 * TypeScript's `readonly` vanishes at the boundary with plain JS and under an `as`
 * cast; `Object.freeze` does not, and under ESM strict mode a write to a frozen
 * property throws. The promise "the fixed tick produces the world every observer was
 * promised" rests entirely on these bytes not having moved.
 */
export function freezeTriple(inputs: TickInputs): TickInputs {
  return deepFreeze({
    tick: inputs.tick,
    snapshot: inputs.snapshot,
    actionLog: [...inputs.actionLog],
    seed: inputs.seed,
  });
}

function deepFreeze<T>(value: T, depth = 0): T {
  if (depth > MAX_FREEZE_DEPTH) throw new HaltError('tick inputs nested deeper than 32 levels');
  if (value === null || typeof value !== 'object') return value;
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key], depth + 1);
  }
  return Object.freeze(value);
}

export class HaltError extends Error {}

// ── the pause record ────────────────────────────────────────────────────────

export interface HaltRecord {
  /** The tick that failed. Nothing from it was published. */
  readonly tick: number;
  /** Most severe first. INV-17 leads if it is present. */
  readonly violations: readonly InvariantViolation[];
  /** The worst id in the list, which is what the operator reads first. */
  readonly topId: string;
  /** Operator-facing, one line, no stack trace (scar #11 leaked server paths). */
  readonly reason: string;
  /** The immutable triple to replay in a sandbox. */
  readonly inputs: TickInputs;
  readonly inputsHash: string;
  /** Whether the failed pass was even looking at the whole world. */
  readonly skipped: readonly string[];
}

/**
 * The "Reckoning delayed" card.
 *
 * There is deliberately **no countdown field on this type**. Adding one is the
 * failure SPEC §15.2 names by name, so the absence is the guarantee and
 * `test/invariants/halt.test.ts` asserts the serialised card has no key that reads
 * like a countdown.
 */
export interface DelayCard {
  readonly headline: typeof RECKONING_DELAYED;
  /** What an audience is told. Never the violation text — that is operator-facing. */
  readonly detail: string;
  readonly haltedAtTick: number;
  /** The last tick anyone was shown. The world is still true as of here. */
  readonly lastGoodTick: number;
}

// ── observations while paused ───────────────────────────────────────────────

export interface PausedObservation {
  readonly stale: true;
  /** The last good tick. Not the tick that failed. */
  readonly tick: number;
  readonly stateHash: string;
  /**
   * Empty, structurally. `never[]` is not a stylistic choice: an affordance is an
   * offer to act, and `act` returns 503 while paused, so any entry here would be a
   * promise the world cannot keep.
   */
  readonly affordances: readonly never[];
  readonly notice: typeof RECKONING_DELAYED;
  readonly haltedAtTick: number;
  readonly queued: number;
  readonly queueBound: number;
}

export interface LiveObservation {
  readonly stale: false;
  readonly tick: number;
  readonly stateHash: string;
}

export type Observation = PausedObservation | LiveObservation;

export interface ActRefusal {
  readonly ok: false;
  readonly status: 503;
  readonly reason: string;
  /**
   * Always `null` while paused. A number here would be a countdown to an event
   * that may not occur, which is precisely what §15.2 forbids on the client.
   */
  readonly retryAfterTicks: null;
  readonly queueBound: number;
}

// ── the submission queue ────────────────────────────────────────────────────

export interface Submission {
  readonly principal: PrincipalId;
  /** Ordering key. SPEC §15.2 orders by `(priority, principal, client_sequence)`. */
  readonly clientSequence: number;
  readonly action: CanonicalValue;
}

export interface QueuedSubmission extends Submission {
  readonly queuedAtTick: number;
  /** Arrival position, for the operator's log only — never for resolution order. */
  readonly position: number;
}

export interface SubmissionOutcome {
  readonly ok: boolean;
  readonly queued: boolean;
  readonly position: number | null;
  readonly reason: string;
  readonly queueDepth: number;
  readonly queueBound: number;
}

// ── the resume order ────────────────────────────────────────────────────────

/**
 * What the operator signs. Bound to one tick and one triple.
 *
 * `note` is what was fixed, and it is required: a resume with no stated defect is
 * an operator restarting a broken world and hoping, which is the outage this whole
 * mechanism exists to convert into a story with an ending.
 */
export interface ResumeClaim {
  readonly tick: number;
  readonly tripleHash: string;
  /** The operator key id. Named, so a resume is attributable. */
  readonly keyid: string;
  readonly note: string;
}

export interface ResumeOrder {
  readonly claim: ResumeClaim;
  readonly signature: Uint8Array;
}

/** The exact bytes signed. One serialisation, so signer and verifier cannot differ. */
export function resumeBytes(claim: ResumeClaim): Uint8Array {
  return new TextEncoder().encode(
    canonicalize({
      kind: 'resume',
      tick: claim.tick,
      tripleHash: claim.tripleHash,
      keyid: claim.keyid,
      note: claim.note,
    }),
  );
}

/** The result of re-running the failed tick from its immutable triple. */
export interface RerunResult {
  readonly committed: boolean;
  /** `state_hash` of `snapshot_T+1`. Meaningful only when committed. */
  readonly stateHash: string;
  readonly report: InvariantReport;
}

export type TickRerun = (inputs: TickInputs) => RerunResult;

export interface ResumeOutcome {
  readonly ok: boolean;
  readonly status: WorldStatus;
  readonly reason: string;
  readonly publishedTick: number;
  readonly stateHash: string | null;
  /** Queued submissions released for the next tick, in queue order. */
  readonly released: readonly QueuedSubmission[];
}

export interface HaltControllerOptions {
  /** The tick the world is published at when it starts. */
  readonly startTick: number;
  readonly startStateHash: string;
  /** Operator keys entitled to resume, by keyid. */
  readonly resumeKeys: ReadonlyMap<string, PublicKeyJwk>;
  readonly queueBound?: number;
}

/**
 * The halt state machine.
 *
 * Owns three things and nothing else: the world's `RUNNING | PAUSED` status, the
 * last *published* tick, and the bounded queue. It deliberately does not run ticks —
 * it is handed the outcome of one — because the thing that must be simple and
 * reviewable is the rule about what observers see.
 */
export class HaltController {
  private state: WorldStatus = 'RUNNING';
  private lastGoodTick: number;
  private lastGoodStateHash: string;
  private pause: HaltRecord | null = null;
  private readonly queue: QueuedSubmission[] = [];
  private arrivals = 0;
  private readonly bound: number;
  private readonly keys: ReadonlyMap<string, PublicKeyJwk>;
  /** Resume claims already honoured. A signed order is single-use. */
  private readonly usedResumes = new Set<string>();

  constructor(options: HaltControllerOptions) {
    this.lastGoodTick = options.startTick;
    this.lastGoodStateHash = options.startStateHash;
    this.keys = options.resumeKeys;
    this.bound = options.queueBound ?? SUBMISSION_QUEUE_BOUND;
    if (!Number.isSafeInteger(this.bound) || this.bound < 1) {
      throw new HaltError(`the submission queue bound must be a positive integer, got ${this.bound}`);
    }
  }

  get status(): WorldStatus {
    return this.state;
  }

  /** The last tick anyone was shown. While paused this does not move. */
  get publishedTick(): number {
    return this.lastGoodTick;
  }

  get publishedStateHash(): string {
    return this.lastGoodStateHash;
  }

  get haltRecord(): HaltRecord | null {
    return this.pause;
  }

  get queueDepth(): number {
    return this.queue.length;
  }

  get queueBound(): number {
    return this.bound;
  }

  /**
   * A tick committed. The only way the published pointer moves.
   *
   * Refuses while paused: publishing from a paused world is the exact thing §15.2
   * forbids, and making it a throw means a caller cannot do it by forgetting to
   * check the status.
   */
  publish(tick: number, stateHash: string): void {
    if (this.state === 'PAUSED') {
      throw new HaltError(
        `cannot publish tick ${tick} while PAUSED at ${String(this.pause?.tick)}; resume first`,
      );
    }
    if (tick < this.lastGoodTick) {
      throw new HaltError(`cannot publish tick ${tick} behind the published tick ${this.lastGoodTick}`);
    }
    this.lastGoodTick = tick;
    this.lastGoodStateHash = stateHash;
  }

  /**
   * A tick failed its ASSERT phase. Abort and pause.
   *
   * Idempotent for the same tick, so a caller that halts from both a catch block
   * and a status check does not lose the first record — the *first* failure is the
   * one an operator needs.
   */
  haltTick(report: InvariantReport, inputs: TickInputs): HaltRecord {
    const existing = this.pause;
    if (existing !== null && existing.tick === report.tick) return existing;

    const ranked = rankViolations(report.violations);
    const halts = halting(ranked);
    if (halts.length === 0) {
      throw new HaltError(
        `refusing to halt tick ${report.tick}: no HALT-severity violation. Halting on a WARN would make an ` +
          'outage out of something the design chose not to stop for',
      );
    }
    const top = halts[0];
    if (top === undefined) throw new HaltError('unreachable: halting list is non-empty');
    const frozen = freezeTriple(inputs);
    if (frozen.tick !== report.tick) {
      throw new HaltError(
        `the halt record's inputs are for tick ${frozen.tick} but the report is for ${report.tick}; ` +
          'a resume would replay the wrong tick',
      );
    }

    const record: HaltRecord = Object.freeze({
      tick: report.tick,
      violations: Object.freeze(ranked),
      topId: top.id,
      reason:
        top.id === TOP_SEVERITY_ID
          ? `${top.id} (top severity — the record was about to accuse someone): ${top.message}`
          : `${top.id}: ${top.message}`,
      inputs: frozen,
      inputsHash: tripleHash(frozen),
      skipped: Object.freeze(report.skipped.map((s) => s.id)),
    });
    this.pause = record;
    this.state = 'PAUSED';
    return record;
  }

  /**
   * `observe`. While paused: the **last good** snapshot, marked stale, with an empty
   * affordance list.
   *
   * Note which tick it reports — `lastGoodTick`, never the tick that failed. An
   * agent must not be able to tell from a stale observation that a half-computed
   * tick existed, because it did not: it was aborted.
   */
  observe(): Observation {
    const paused = this.pause;
    if (this.state === 'RUNNING' || paused === null) {
      return { stale: false, tick: this.lastGoodTick, stateHash: this.lastGoodStateHash };
    }
    return {
      stale: true,
      tick: this.lastGoodTick,
      stateHash: this.lastGoodStateHash,
      affordances: [],
      notice: RECKONING_DELAYED,
      haltedAtTick: paused.tick,
      queued: this.queue.length,
      queueBound: this.bound,
    };
  }

  /**
   * `act`. Returns a 503 refusal while paused, `null` while running.
   *
   * `null` rather than an ok-object so a caller cannot accidentally treat the
   * refusal as a result: the only way past this is an explicit null check.
   */
  act(): ActRefusal | null {
    const paused = this.pause;
    if (this.state === 'RUNNING' || paused === null) return null;
    return {
      ok: false,
      status: 503,
      reason:
        `the world is PAUSED: tick ${paused.tick} failed ${paused.topId} and was not published. ` +
        'Nothing you did caused this and nothing you did was lost — submissions are queued. ' +
        'No estimate is given, because a wrong one would be worse than none.',
      retryAfterTicks: null,
      queueBound: this.bound,
    };
  }

  /**
   * The spectator card. `null` while running — the client shows its usual countdown.
   *
   * While paused it is "Reckoning delayed" with no countdown, because there is no
   * honest number to put on one.
   */
  card(): DelayCard | null {
    const paused = this.pause;
    if (this.state === 'RUNNING' || paused === null) return null;
    return {
      headline: RECKONING_DELAYED,
      detail:
        'A check failed and the tick was withheld rather than published. ' +
        'Everything shown is true as of the last completed tick.',
      haltedAtTick: paused.tick,
      lastGoodTick: this.lastGoodTick,
    };
  }

  /**
   * Queue a submission rather than lose it.
   *
   * Accepts while running too: the queue is the tick loop's inbox either way, which
   * is what makes "submissions queue rather than being lost" one code path instead
   * of a special case that only exists while paused and is therefore only tested
   * while paused.
   */
  submit(submission: Submission, atTick: number): SubmissionOutcome {
    if (this.queue.length >= this.bound) {
      // Scar #3: a full system returns a helpful refusal rather than degrading.
      return {
        ok: false,
        queued: false,
        position: null,
        reason:
          `the submission queue is full at its published cap of ${this.bound}. ` +
          'Retry after the world resumes; nothing already queued has been dropped to make room for this.',
        queueDepth: this.queue.length,
        queueBound: this.bound,
      };
    }
    const position = this.arrivals;
    this.arrivals += 1;
    this.queue.push({ ...submission, queuedAtTick: atTick, position });
    return {
      ok: true,
      queued: true,
      position,
      reason:
        this.state === 'PAUSED'
          ? `queued at position ${position}; it will be ordered by (priority, principal, client_sequence) when the world resumes`
          : `queued at position ${position}`,
      queueDepth: this.queue.length,
      queueBound: this.bound,
    };
  }

  /**
   * Hand the queue to the tick loop and clear it.
   *
   * Returned in **arrival** order and explicitly not in resolution order: SPEC
   * §15.2 orders by `(priority, principal_id, client_sequence)` and never by
   * arrival, and that ordering belongs to the tick loop. Returning them sorted here
   * would put the determinism rule in two places.
   */
  drain(): readonly QueuedSubmission[] {
    const out = [...this.queue];
    this.queue.length = 0;
    return out;
  }

  /**
   * Verify and execute a signed resume.
   *
   * The order is checked before anything is re-run, and every refusal leaves the
   * world PAUSED — including a re-run that fails again, which is the case that
   * matters most: an operator who fixed the wrong thing must not be able to publish
   * a still-broken tick.
   */
  resume(order: ResumeOrder, rerun: TickRerun): ResumeOutcome {
    const paused = this.pause;
    if (this.state === 'RUNNING' || paused === null) {
      return this.refuse('the world is not paused; there is nothing to resume', null);
    }
    const { claim } = order;
    if (claim.tick !== paused.tick) {
      return this.refuse(
        `the resume order names tick ${claim.tick}; the world is paused at ${paused.tick}`,
        paused,
      );
    }
    if (claim.tripleHash !== paused.inputsHash) {
      return this.refuse(
        `the resume order names input triple ${claim.tripleHash}; the halted tick's triple is ` +
          `${paused.inputsHash}. The inputs are immutable, so a mismatch means the sandbox replayed ` +
          'something else',
        paused,
      );
    }
    if (claim.note.trim().length === 0) {
      return this.refuse('a resume order must state what was fixed', paused);
    }
    const key = this.keys.get(claim.keyid);
    if (key === undefined) {
      return this.refuse(`no operator key named ${claim.keyid} may resume this world`, paused);
    }
    if (!verifyBytes(key, resumeBytes(claim), order.signature)) {
      return this.refuse(
        `the resume order for tick ${claim.tick} does not verify against key ${claim.keyid}`,
        paused,
      );
    }
    const fingerprint = canonicalHash({
      tick: claim.tick,
      tripleHash: claim.tripleHash,
      keyid: claim.keyid,
      note: claim.note,
    });
    if (this.usedResumes.has(fingerprint)) {
      // A signed order is single-use. Without this, an order captured off the wire
      // replays at the next halt of the same tick number.
      return this.refuse('this resume order has already been used', paused);
    }

    // Re-run from the immutable triple. Not from current state, and not from the
    // event stream: replay's input is `(snapshot_T, action_log_T, seed_T)`.
    let result: RerunResult;
    try {
      result = rerun(paused.inputs);
    } catch (e) {
      return this.refuse(
        `the re-run of tick ${paused.tick} threw: ${e instanceof Error ? e.message : String(e)}`,
        paused,
      );
    }
    if (!result.committed) {
      const top = halting(rankViolations(result.report.violations))[0];
      return this.refuse(
        `the re-run of tick ${paused.tick} failed again` +
          (top === undefined ? '' : `: ${top.id} ${top.message}`),
        paused,
      );
    }
    if (tripleHash(paused.inputs) !== paused.inputsHash) {
      // The triple is frozen, so this cannot happen through this API. Asserted
      // because the promise "the world every observer was promised" is *only* the
      // input triple's immutability, and an unasserted foundation is a rumour.
      return this.refuse(
        `the input triple for tick ${paused.tick} changed during the re-run; the promised world is no longer ` +
          'derivable',
        paused,
      );
    }

    this.usedResumes.add(fingerprint);
    this.pause = null;
    this.state = 'RUNNING';
    this.lastGoodTick = paused.tick;
    this.lastGoodStateHash = result.stateHash;
    const released = this.drain();
    return {
      ok: true,
      status: 'RUNNING',
      reason: `tick ${paused.tick} re-ran from its immutable inputs and published; ${claim.note}`,
      publishedTick: this.lastGoodTick,
      stateHash: this.lastGoodStateHash,
      released,
    };
  }

  private refuse(reason: string, paused: HaltRecord | null): ResumeOutcome {
    return {
      ok: false,
      status: this.state,
      reason,
      publishedTick: this.lastGoodTick,
      stateHash: paused === null && this.state === 'RUNNING' ? this.lastGoodStateHash : null,
      released: [],
    };
  }
}

/** Sign a resume claim. Convenience for the operator tool and for tests. */
export function signResume(claim: ResumeClaim, sign: (bytes: Uint8Array) => Uint8Array): ResumeOrder {
  return { claim, signature: sign(resumeBytes(claim)) };
}
