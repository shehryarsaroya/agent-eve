/**
 * The free deterministic services (SPEC §12.1, PROP-O6).
 *
 * > "**Free, read-only deterministic services** — never consume an action, never
 * > reserve: `plan_hands` (3–6 *complete* allocation plans with EV bands, worst case,
 * > and what each forecloses) · `quote_venture` · `reference_split` · `stress_grant` ·
 * > `dry_run` · `mandate` (§13B) · paginated GETs. These exist because hand allocation
 * > × role filling × counterparty selection × split × limits is a mixed-integer
 * > assignment problem with a bargaining subgame — the exact shape LLMs are worst at.
 * > Without them agents do not flail visibly; they play blandly and identically, and
 * > the agent-quality gate fails silently."
 *
 * ## The four guarantees, and how each is structural rather than promised
 *
 * **Never consumes an action.** No function in this file takes an `ActionBudget` and
 * none can reach one: the desk is constructed with sources and a quote book, and the
 * budget lives inside the tick. PROP-O6's test passes a real budget alongside and
 * asserts its spend is unchanged, which is the only version of this claim worth
 * having.
 *
 * **Never reserves.** Nothing here mutates. The desk holds a memo table and two
 * counters; the world, the ledger and the venture book arrive as read-only sources.
 * The test asserts `worldHash` and the ledger's `stateHash` are byte-identical across
 * a full sweep of every service.
 *
 * **Memoised per `(principal, tick)`.** §12.1: "correct by construction since
 * snapshot T is frozen." The memo table is cleared when the tick advances, so it is
 * bounded by `principals x services x arguments-in-one-tick` and not by uptime (scar
 * #3). Identical calls return the *same object*, which the test asserts by identity,
 * not by deep equality — a fresh-but-equal result would mean the solver ran again and
 * the capacity guarantee is gone.
 *
 * **Bounded under load.** Two limits, and they are different quantities on purpose: a
 * **per-principal call limit** stops one agent monopolising the desk, and a **shared
 * node budget** stops the aggregate of well-behaved agents from doing it. §12.1 calls
 * an unmetered allocation solver "the one real capacity risk in the design", and a
 * per-principal limit alone does not address it — 300 principals each politely inside
 * their own limit is the load that matters.
 *
 * Both limits are **per tick**, never per second. A wall-clock limit belongs at the
 * transport (`src/api/limits.ts`, whitelisted in the scale audit for exactly this
 * reason) because it protects the host rather than the game; a per-tick limit is
 * scale-invariant and survives the 30x compression `TESTING.md` §1.1 warns about.
 *
 * ## What a refusal looks like
 *
 * `{ served: false, ground }` — never a throw and never an error status. A free
 * service that threw would be an agent-reachable path into a 500, and under load it
 * would be one every agent could reach at will. `NODE_BUDGET` and `PAGED` are the two
 * grounds a refusal can carry, and both tell the agent to come back next tick.
 */

import type { GrantId, PrincipalId, VentureId } from '../core/types.js';
import { minor, type Minor } from '../core/units.js';
import { compareIds } from '../ledger/index.js';
import {
  openIndices,
  projectedSettlement,
  referenceSplit,
  roleOfPrincipal,
  type ReferenceShare,
  type VentureRecord,
} from '../venture/index.js';
import { handsOf, isPresent, type HandRecord } from '../world/index.js';
import type { Affordance, Candidate } from './affordance.js';
import { compareCandidates } from './affordance.js';
import { buildCatalogue } from './catalogue.js';
import { slotForecast, type SlotForecast } from './forecast.js';
import { QuoteBook } from './quote.js';
import type { MandateRead, ObserveSources } from './sources.js';
import { LIST_CAPS, phrase } from './tokens.js';
import { WithheldTally, type WithheldGround } from './withheld.js';

/**
 * The service names, in `agent.md` §6's own spelling.
 *
 * Lowercase because they are agent-facing identifiers, and `page` is `agent.md`'s
 * "paginated reads" given a name so an agent can call it.
 */
export const SERVICE_NAMES = Object.freeze([
  'plan_hands',
  'quote_venture',
  'reference_split',
  'stress_grant',
  'dry_run',
  'mandate',
  'page',
] as const);

export type ServiceName = (typeof SERVICE_NAMES)[number];

/** Calls one principal may make in one tick. Generous: these are cheap reads. */
export const CALLS_PER_PRINCIPAL_PER_TICK = 12;

/**
 * Solver nodes the whole node may explore in one tick, across every principal.
 *
 * The number that actually bounds the capacity risk. At 300 principals this is ~13
 * nodes each if every one of them plans in the same tick, which is why the solver
 * enumerates in a canonical order and reports what it did not reach rather than
 * exploring greedily.
 */
export const NODE_BUDGET_PER_TICK = 4_096;

/** Nodes one `plan_hands` call may explore before it stops and says so. */
export const NODES_PER_PLAN_CALL = 512;

/** §12.1: "3–6 *complete* allocation plans". Both ends are requirements. */
export const MIN_PLANS = 3;
export const MAX_PLANS = 6;

export type ServiceReply<T> =
  | { readonly served: true; readonly value: T }
  | { readonly served: false; readonly ground: Extract<WithheldGround, 'NODE_BUDGET' | 'PAGED'> };

// ── plan_hands ───────────────────────────────────────────────────────────────

/**
 * What one hand does under a plan.
 *
 * `HOLD` and `BUSY` are what make a plan **complete**: §12.1 asks for complete
 * allocation plans, and a plan that mentions two of three hands is a suggestion. A
 * hand left idle is a *decision* and it is written down as one; a hand already
 * committed or in transit is not the plan's to move and says so.
 *
 * **There is deliberately no step for a crossing.** The solver only considers slots at
 * a hand's own system, so no plan it produces proposes travelling to reach one — and a
 * member named for a step nothing emits would be a capability an agent reads about and
 * cannot get. That is a real limitation, stated here rather than papered over with a
 * vocabulary word: plans across lanes need a route cost and a transit-tick horizon, and
 * pricing an EV against an arrival that has not happened is a different problem from the
 * one this solver answers.
 */
export type PlanStepKind = 'TAKE_ROLE' | 'HOLD' | 'BUSY';

export interface PlanStep {
  readonly kind: PlanStepKind;
  readonly hand: string;
  /** The venture a `TAKE_ROLE` fills, or null on a `HOLD` or a `BUSY`. */
  readonly venture: VentureId | null;
  readonly role_index: number | null;
}

export interface HandPlan {
  readonly rank: number;
  /** One step per hand, always. Asserted by PROP-O6's completeness test. */
  readonly steps: readonly PlanStep[];
  readonly ev_p10: Minor;
  readonly ev_p50: Minor;
  readonly ev_p90: Minor;
  /** Σ `max_direct_loss` over the plan's steps. The worst case, exact. */
  readonly worst_case: Minor;
  readonly forecloses: readonly string[];
}

export interface PlanReply {
  readonly plans: readonly HandPlan[];
  /** Nodes this call explored. Published so the budget is auditable, not folklore. */
  readonly nodes: number;
  /** Plans the node budget stopped us reaching. Counted, never silent. */
  readonly withheld: number;
}

// ── quote_venture / stress_grant / dry_run ───────────────────────────────────

export interface VentureQuote {
  readonly venture: VentureId;
  readonly my_role_index: number | null;
  readonly open_slots: readonly SlotForecast[];
  readonly projected: ReturnType<typeof projectedSettlement>;
}

/**
 * `stress_grant` — what the limits actually permit, at their worst.
 *
 * §8's attack, in numbers: "a delegate sends your hands into a raid where its own
 * accomplice waits, every action technically within bounds, your loss total." So the
 * stress is not a simulation of a delegate's behaviour — it is the arithmetic of the
 * bound, which is the only part that is knowable.
 */
export interface GrantStress {
  readonly grant: GrantId;
  readonly headroom_direct: Minor;
  readonly headroom_contingent: Minor;
  /** Direct + contingent: the most this grant can cost if it is used to the limit. */
  readonly worst_case_total: Minor;
  /** Ticks the grant still has to run. Zero once expired. */
  readonly ticks_remaining: number;
  readonly note: string;
}

export interface DryRun {
  readonly verb: string;
  /** The affordance this would be, when it is legal. */
  readonly affordance: Affordance | null;
  /**
   * Every ground that withheld an affordance for this principal this tick, in
   * canonical order — not "the reason yours failed".
   *
   * Stated as the weaker claim because it is the true one: eligibility is evaluated
   * over the whole catalogue, and singling out one act's ground would mean re-deciding
   * that act in isolation, which is a second opinion about eligibility. The honest
   * answer is the list of rules that were in play plus the nearest legal act.
   */
  readonly grounds: readonly WithheldGround[];
  /** The closest legal thing, so a refusal is never a dead end (§12.2, PROP-O7). */
  readonly nearest: Affordance | null;
}

// ── the desk ─────────────────────────────────────────────────────────────────

export class ServiceDesk {
  private tick = -1;
  private readonly memo = new Map<string, unknown>();
  private readonly calls = new Map<PrincipalId, number>();
  private nodesUsed = 0;

  constructor(
    private readonly quotes: QuoteBook = new QuoteBook(),
    readonly callsPerPrincipalPerTick: number = CALLS_PER_PRINCIPAL_PER_TICK,
    readonly nodeBudgetPerTick: number = NODE_BUDGET_PER_TICK,
  ) {}

  /** Nodes spent this tick, across every principal. The capacity number. */
  get nodes(): number {
    return this.nodesUsed;
  }

  get memoSize(): number {
    return this.memo.size;
  }

  callsMade(principal: PrincipalId): number {
    return this.calls.get(principal) ?? 0;
  }

  /**
   * Roll the memo table and both counters when the tick advances.
   *
   * Called at the top of every service, never lazily on first use: a limit that reset
   * on first *use* would give an agent that called early in a tick a different
   * allowance from one that called late, which is A4 through a side door — the same
   * argument `tick/wake.ts` makes about the wake budget.
   */
  private rollTo(tick: number): void {
    if (tick === this.tick) return;
    this.tick = tick;
    this.memo.clear();
    this.calls.clear();
    this.nodesUsed = 0;
  }

  /**
   * Memoise per `(principal, tick, key)` and meter the call.
   *
   * A memo *hit* does not consume the call limit. That is deliberate: the limit exists
   * to bound work, a hit is no work, and charging for it would make an agent's second
   * read of the same answer cost the same as a fresh solve — which is a reason to
   * cache client-side, and a reason for us to be wrong about what we told it.
   */
  private serve<T>(
    principal: PrincipalId,
    tick: number,
    key: string,
    compute: () => ServiceReply<T>,
  ): ServiceReply<T> {
    this.rollTo(tick);
    // '::' as the separator, never NUL (see `withheld.ts`).
    const memoKey = `${principal}::${key}`;
    const hit = this.memo.get(memoKey);
    if (hit !== undefined) return hit as ServiceReply<T>;

    const used = this.callsMade(principal);
    if (used >= this.callsPerPrincipalPerTick) {
      // A refusal, not an error. `PAGED` because the answer exists and next tick's
      // allowance will produce it — nothing about the world is withholding it.
      return { served: false, ground: 'PAGED' };
    }
    this.calls.set(principal, used + 1);
    const value = compute();
    this.memo.set(memoKey, value);
    return value;
  }

  /** Claim solver nodes, up to what the shared budget still has. */
  private claimNodes(want: number): number {
    const free = Math.max(0, this.nodeBudgetPerTick - this.nodesUsed);
    const taken = Math.min(want, free);
    this.nodesUsed += taken;
    return taken;
  }

  // ── plan_hands ─────────────────────────────────────────────────────────────

  /**
   * 3–6 complete allocation plans.
   *
   * The enumeration is deliberately small and canonical rather than clever: every
   * hand's option set is ordered, plans are formed by taking the best available slot
   * for each hand in turn under a rotating starting offset, and each plan is priced
   * from the same `computeClaims` the waterfall uses. A cleverer search would be a
   * second opinion about what a role is worth.
   */
  planHands(sources: ObserveSources, principal: PrincipalId): ServiceReply<PlanReply> {
    return this.serve(principal, sources.tick, 'plan_hands', () => {
      const hands = handsOf(sources.world, principal);
      const slots = openSlotsFor(sources, principal);
      const granted = this.claimNodes(Math.min(NODES_PER_PLAN_CALL, (hands.length + 1) * (slots.length + 1)));
      if (granted === 0) {
        return { served: false, ground: 'NODE_BUDGET' };
      }

      const plans: HandPlan[] = [];
      let nodes = 0;
      // One plan per starting offset into the slot list, plus the all-hold plan. That
      // yields `min(slots+1, MAX_PLANS)` distinct complete plans, deterministically,
      // and it always yields at least one (the all-hold plan) so a principal with
      // nothing to do still gets a complete answer rather than an empty list.
      for (let offset = 0; offset <= slots.length && plans.length < MAX_PLANS; offset += 1) {
        if (nodes >= granted) break;
        const plan = planAt(sources, hands, slots, offset);
        nodes += hands.length + 1;
        if (plans.some((existing) => sameSteps(existing.steps, plan.steps))) continue;
        plans.push({ ...plan, rank: plans.length + 1 });
      }
      const reachable = Math.min(slots.length + 1, MAX_PLANS);
      return {
        served: true,
        value: {
          plans: Object.freeze(plans),
          nodes,
          withheld: Math.max(0, reachable - plans.length),
        },
      };
    });
  }

  // ── quote_venture ──────────────────────────────────────────────────────────

  quoteVenture(
    sources: ObserveSources,
    principal: PrincipalId,
    venture: VentureId,
  ): ServiceReply<VentureQuote | null> {
    return this.serve(principal, sources.tick, `quote_venture::${venture}`, () => {
      const found = sources.ventures.find((v) => v.id === venture);
      if (found === undefined) return { served: true, value: null };
      const role = roleOfPrincipal(found, principal);
      return {
        served: true,
        value: {
          venture: found.id,
          my_role_index: role?.index ?? null,
          open_slots: Object.freeze(openIndices(found).map((index) => slotForecast(found, index))),
          projected: projectedSettlement(found, sources.tick),
        },
      };
    });
  }

  // ── reference_split ────────────────────────────────────────────────────────

  /**
   * §7.3's anchor. Passed straight through from the venture module, because "an
   * anchor that takes a side is a recommendation" and re-weighting it here would be
   * taking one.
   */
  referenceSplitOf(
    sources: ObserveSources,
    principal: PrincipalId,
    venture: VentureId,
  ): ServiceReply<readonly ReferenceShare[] | null> {
    return this.serve(principal, sources.tick, `reference_split::${venture}`, () => {
      const found = sources.ventures.find((v) => v.id === venture);
      return { served: true, value: found === undefined ? null : referenceSplit(found) };
    });
  }

  // ── stress_grant ───────────────────────────────────────────────────────────

  stressGrant(
    sources: ObserveSources,
    principal: PrincipalId,
    grantId: GrantId,
  ): ServiceReply<GrantStress | null> {
    return this.serve(principal, sources.tick, `stress_grant::${grantId}`, () => {
      const grant = sources.grants.find((g) => g.id === grantId);
      if (grant === undefined || (grant.grantor !== principal && grant.delegate !== principal)) {
        // A grant you are not party to is not yours to stress. Null rather than a
        // refusal: the honest answer is "no such grant, for you".
        return { served: true, value: null };
      }
      const direct = minor(Math.max(0, grant.maxDirectLoss - grant.spentDirect));
      const contingent = minor(Math.max(0, grant.maxContingentLiability - grant.spentContingent));
      return {
        served: true,
        value: {
          grant: grant.id,
          headroom_direct: direct,
          headroom_contingent: contingent,
          worst_case_total: minor(direct + contingent),
          ticks_remaining: Math.max(0, grant.expiresTick - sources.tick),
          note:
            'A delegate inside these bounds can still cost you all of it, through ordinary ' +
            'legitimate actions. There is no betray verb and no loyalty meter.',
        },
      };
    });
  }

  // ── dry_run ────────────────────────────────────────────────────────────────

  /**
   * Would this act be legal, and what would it cost?
   *
   * Answered by looking the act up in the **catalogue** rather than by re-deciding it:
   * the catalogue is where eligibility lives, so a `dry_run` that agreed with it by
   * coincidence would be the second opinion this whole module avoids.
   */
  dryRun(
    sources: ObserveSources,
    principal: PrincipalId,
    verb: string,
    params: Readonly<Record<string, string | number | boolean | null>>,
  ): ServiceReply<DryRun> {
    const key = `dry_run::${verb}::${Object.keys(params)
      .sort((a, b) => compareIds(a, b))
      .map((k) => `${k}=${String(params[k])}`)
      .join('&')}`;
    return this.serve(principal, sources.tick, key, (): ServiceReply<DryRun> => {
      const tally = new WithheldTally();
      const catalogue = buildCatalogue({
        sources,
        principal,
        quotes: this.quotes,
        tally,
        claimed: new Set(),
      });
      const ordered = [...catalogue.candidates].sort(compareCandidates);
      const exact = ordered.find(
        (candidate) => candidate.affordance.verb === verb && matchesParams(candidate, params),
      );
      if (exact !== undefined) {
        return {
          served: true,
          value: {
            verb,
            affordance: exact.affordance,
            grounds: Object.freeze([]),
            nearest: null,
          },
        };
      }
      const sameVerb = ordered.find((candidate) => candidate.affordance.verb === verb);
      const grounds = tally
        .rows()
        .filter((row) => row.field === 'affordances')
        .map((row) => row.ground);
      return {
        served: true,
        value: {
          verb,
          affordance: null,
          grounds: Object.freeze(grounds),
          nearest: sameVerb?.affordance ?? ordered[0]?.affordance ?? null,
        },
      };
    });
  }

  // ── mandate ────────────────────────────────────────────────────────────────

  /**
   * §13B's owner mandate. Advice, and the agent is told so in the payload itself.
   *
   * A free read rather than a payload key because it is stable text, not per-tick
   * state: shipping a page of prose on all 16 wakes a day is waste the owner pays
   * for, and `header.mandate_version` is what announces a change.
   */
  mandate(sources: ObserveSources, principal: PrincipalId): ServiceReply<MandateRead | null> {
    return this.serve(principal, sources.tick, 'mandate', () => ({
      served: true,
      value: sources.mandate,
    }));
  }

  // ── page ───────────────────────────────────────────────────────────────────

  /**
   * `agent.md`'s "paginated reads" — and the other half of `PAGED`.
   *
   * A `withheld` row saying `PAGED` is only honest if the pages exist, so this returns
   * the full eligible affordance list in canonical order, sliced by cursor. It costs
   * no action and mints no new quote: the affordances it returns carry the ids the
   * observation already published for this tick, because the quote book is idempotent
   * on identical terms.
   */
  page(
    sources: ObserveSources,
    principal: PrincipalId,
    cursor: number,
    size: number = LIST_CAPS.affordances,
  ): ServiceReply<{ readonly items: readonly Affordance[]; readonly next: number | null }> {
    return this.serve(principal, sources.tick, `page::${String(cursor)}::${String(size)}`, () => {
      const tally = new WithheldTally();
      const catalogue = buildCatalogue({
        sources,
        principal,
        quotes: this.quotes,
        tally,
        claimed: new Set(),
      });
      const all = [...catalogue.candidates].sort(compareCandidates).map((c) => c.affordance);
      const from = Math.max(0, cursor);
      const items = all.slice(from, from + Math.max(1, size));
      const next = from + items.length < all.length ? from + items.length : null;
      return { served: true, value: { items: Object.freeze(items), next } };
    });
  }
}

// ── the solver ───────────────────────────────────────────────────────────────

interface OpenSlot {
  readonly venture: VentureRecord;
  readonly roleIndex: number;
  readonly forecast: SlotForecast;
}

/**
 * What taking a slot can cost, at the stake the catalogue quotes.
 *
 * Zero, and it is the **same** zero `fill_role` publishes as its `max_direct_loss`,
 * for the same reason: the quoted stake is zero, so nothing of the holder's is
 * forfeitable. Named rather than written as a literal `0` because the day the quoted
 * stake stops being zero, this is the line that has to change with it — and a bare
 * `+= 0` is a line nobody finds.
 */
const SLOT_WORST_CASE_AT_QUOTED_STAKE = 0;

/**
 * Open slots this principal could take, richest first.
 *
 * Ordered by p50 descending then by `(venture_id, role_index)`, so the enumeration is
 * canonical and two replays produce the same plans (DET-1).
 */
function openSlotsFor(sources: ObserveSources, principal: PrincipalId): readonly OpenSlot[] {
  const out: OpenSlot[] = [];
  for (const venture of [...sources.ventures].sort((a, b) => compareIds(a.id, b.id))) {
    if (venture.state !== 'FORMING') continue;
    if (roleOfPrincipal(venture, principal) !== null) continue;
    if (sources.tick < venture.windowOpensTick || sources.tick > venture.windowClosesTick) continue;
    for (const roleIndex of openIndices(venture)) {
      out.push({ venture, roleIndex, forecast: slotForecast(venture, roleIndex) });
    }
  }
  return out.sort(
    (a, b) =>
      b.forecast.p50 - a.forecast.p50 ||
      compareIds(a.venture.id, b.venture.id) ||
      a.roleIndex - b.roleIndex,
  );
}

/**
 * One complete plan: every hand gets exactly one step.
 *
 * `offset` rotates which slot the first free hand reaches for, which is what turns one
 * greedy answer into a *set* of genuinely different complete plans without a search.
 * At `offset === slots.length` every hand holds, which is the plan an agent most needs
 * priced and least often considers.
 */
function planAt(
  sources: ObserveSources,
  hands: readonly HandRecord[],
  slots: readonly OpenSlot[],
  offset: number,
): Omit<HandPlan, 'rank'> {
  const steps: PlanStep[] = [];
  const forecloses: string[] = [];
  let p10 = 0;
  let p50 = 0;
  let p90 = 0;
  let worst = 0;
  const taken = new Set<string>();
  let cursor = offset;

  for (const hand of hands) {
    if (hand.state !== 'IDLE' || !isPresent(hand, sources.tick)) {
      steps.push({ kind: 'BUSY', hand: hand.id, venture: null, role_index: null });
      continue;
    }
    // A slot at the hand's own system, from `cursor` onward. One principal fills at
    // most one role per venture (PROP-V6), so a venture already used in this plan is
    // skipped rather than double-booked.
    let picked: OpenSlot | null = null;
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[(cursor + i) % slots.length];
      if (slot === undefined) continue;
      const key = `${slot.venture.id}::${String(slot.roleIndex)}`;
      if (taken.has(key) || taken.has(slot.venture.id)) continue;
      if (slot.venture.stage !== hand.location) continue;
      picked = slot;
      cursor = (cursor + i + 1) % slots.length;
      break;
    }
    if (picked === null) {
      steps.push({ kind: 'HOLD', hand: hand.id, venture: null, role_index: null });
      forecloses.push(phrase(`hand ${String(hand.ordinal)} idle, earning nothing`));
      continue;
    }
    taken.add(`${picked.venture.id}::${String(picked.roleIndex)}`);
    taken.add(picked.venture.id);
    steps.push({
      kind: 'TAKE_ROLE',
      hand: hand.id,
      venture: picked.venture.id,
      role_index: picked.roleIndex,
    });
    p10 += picked.forecast.p10;
    p50 += picked.forecast.p50;
    p90 += picked.forecast.p90;
    worst += SLOT_WORST_CASE_AT_QUOTED_STAKE;
    forecloses.push(
      phrase(`hand ${String(hand.ordinal)} to ${picked.venture.id} until ${String(picked.venture.resolvesAtTick)}`),
    );
  }

  return {
    steps: Object.freeze(steps),
    ev_p10: minor(p10),
    ev_p50: minor(p50),
    ev_p90: minor(p90),
    worst_case: minor(worst),
    forecloses: Object.freeze(forecloses.slice(0, LIST_CAPS.hands)),
  };
}

function sameSteps(a: readonly PlanStep[], b: readonly PlanStep[]): boolean {
  if (a.length !== b.length) return false;
  for (const [i, step] of a.entries()) {
    const other = b[i];
    if (other === undefined) return false;
    if (
      step.kind !== other.kind ||
      step.hand !== other.hand ||
      step.venture !== other.venture ||
      step.role_index !== other.role_index
    ) {
      return false;
    }
  }
  return true;
}

function matchesParams(
  candidate: Candidate,
  params: Readonly<Record<string, string | number | boolean | null>>,
): boolean {
  for (const [key, value] of Object.entries(params)) {
    if (candidate.affordance.params[key] !== value) return false;
  }
  return true;
}
