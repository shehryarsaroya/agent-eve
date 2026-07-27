/**
 * `briefing` — the prompt and `if_you_do_nothing` (SPEC §12.1, PROP-O5, R1).
 *
 * > "`if_you_do_nothing` is accurate: take no action, advance to the next
 * > Reckoning, assert the stated consequence is what occurred. **This is the single
 * > highest-value cheap test in the document** — it is High Water's
 * > `projectedDrown` generalised, and it is what lets a model self-correct."
 * > — TESTING.md, PROP-O5
 *
 * ## Structured first, prose second
 *
 * `if_you_do_nothing.outcomes[]` is the part under test and `line` is a rendering of
 * it. That order matters: a prose-only prediction can only be checked by a human
 * reading it, which means it is checked once, at review, and then drifts. Every
 * outcome below carries the venture, the amount, and — the field that makes the test
 * honest — a {@link ProvenanceClass}.
 *
 * ## Why provenance is not decoration here
 *
 * A wage role's elective part is a fixed number and the prediction is exact
 * (`FACT`). A share role's is a residual that is not drawn until the venture
 * resolves, so the p50 figure is genuinely a forecast (`ESTIMATE`) — and
 * `agent.md` §4 is emphatic about exactly this: *"the `your_take_at_p50` figure you
 * were shown at signing is an estimate, not the bill ... an agent that elects the
 * exact number it was quoted is therefore electing less than it owes."*
 *
 * So PROP-O5 tests the two differently and both strictly: a `FACT` outcome must
 * equal what settlement did, and an `ESTIMATE` must contain it inside the published
 * p10..p90 band. Asserting equality on an estimate would either fail on honest
 * randomness or force the test to pin the seed and stop testing the claim.
 *
 * ## Doing nothing is a *choice with a defined consequence*, not an absence
 *
 * `settlement.ts:electionFor` is the whole reason this file can be exact: "An
 * absent entry is zero. That single line is PROP-V4's second clause." So a creator
 * that takes no action elects nothing, and every elective part it owes becomes a
 * `DECLINED` default at the next Reckoning. That is the harshest true statement in
 * the observation and it belongs in the first thing an agent reads (agent.md §12:
 * "Read `briefing.if_you_do_nothing` first, every wake").
 */

import { reckoningIndex, ticksUntilReckoning } from '../core/time.js';
import type { PrincipalId, ProvenanceClass } from '../core/types.js';
import { minor, type Minor } from '../core/units.js';
import { compareIds } from '../ledger/index.js';
import {
  NEUTRAL_STAGE_BPS,
  computeClaims,
  computeProceeds,
  filledIndices,
  isLive,
  openIndices,
  residualAtPercentile,
  roleOfPrincipal,
  type ClaimBreakdown,
  type Percentile,
  type VentureRecord,
} from '../venture/index.js';
import { handsOf, inTransitEta } from '../world/index.js';
import { roleSealKey, type ObserveSources } from './sources.js';
import { LIST_CAPS, line } from './tokens.js';

/**
 * What happens at the next Reckoning if this principal does nothing.
 *
 * Every member is a fact about *this* principal's own position — never a prediction
 * about somebody else's behaviour. `ELECTIVE_AT_RISK` is the closest it gets, and it
 * is deliberately phrased as "not guaranteed" rather than "they will not pay": the
 * whole design rests on that being a genuine choice (A7), and an observation that
 * predicted a counterparty's election would be handing agents the cartel-monitoring
 * tool §11.2 spends a page closing.
 */
export type DoNothingKind =
  /** You are the payer; electing nothing is a default on the record (§7.4, PROP-V4). */
  | 'ELECTIVE_LAPSES'
  /** You are the payee; the elective half is the payer's choice and may not arrive. */
  | 'ELECTIVE_AT_RISK'
  /** The escrowed half executes automatically, whatever anybody does (A7). */
  | 'ESCROW_EXECUTES'
  /** A role of yours holds no seal and the freeze will close on it (§11.1). */
  | 'SEAL_ABSENT'
  /** A venture of yours will reach its window's close with a role open (§7.4). */
  | 'ROLE_OPEN'
  /** The Levy is assessed and unpaid. The total cannot be dodged (§5.2). */
  | 'LEVY_UNPAID'
  /** A hand completes its transit before the Reckoning. */
  | 'HAND_LANDS'
  /** Nothing of yours resolves. Said explicitly, because silence reads as an error. */
  | 'NOTHING_RESOLVES';

export interface DoNothingOutcome {
  readonly kind: DoNothingKind;
  /** The venture, hand or place this is about. Empty when it is about nothing. */
  readonly subject: string;
  readonly amount: Minor;
  /**
   * `FACT` when the figure is arithmetic on pinned terms; `ESTIMATE` when it depends
   * on a residual not yet drawn. §11.3 requires the three-way separation everywhere.
   */
  readonly provenance: ProvenanceClass;
  /** The p10..p90 band, for an `ESTIMATE`. Null when the figure is exact. */
  readonly band: readonly [Minor, Minor] | null;
}

export interface IfYouDoNothing {
  /** The settlement tick these outcomes are about. */
  readonly at_tick: number;
  readonly reckoning_index: number;
  readonly outcomes: readonly DoNothingOutcome[];
  /** One rendering of the outcomes. Never the source of truth. */
  readonly line: string;
}

export interface Briefing {
  /** One sentence naming the actual dilemma (§12.1, R1). */
  readonly prompt: string;
  readonly if_you_do_nothing: IfYouDoNothing;
}

/**
 * The settlement tick the briefing is about: the last tick of the current
 * Reckoning. Derived from the clock module, never counted here.
 */
export function nextSettlementTick(tick: number): number {
  return tick + ticksUntilReckoning(tick) - 1;
}

/**
 * Will this venture be settled at `settlementTick`? — **`isLive` is not this question.**
 *
 * `venture/venture.ts:LIVE_STATES` is documented as "venture states in which a role's
 * fill occupies its hand", i.e. the *hand-occupancy* index, and it is `FORMING | LIVE`.
 * The settlement set is a different set: `venture/book.ts:settlementSet` is
 * `(LIVE | DEFERRED) && resolvesAtTick <= tick`, and its own comment is emphatic that a
 * deferral is "still due, tried again next Reckoning" and deliberately does **not** move
 * `resolvesAtTick` because that field is inside `terms_hash`.
 *
 * Filtering the briefing with `isLive` therefore dropped every DEFERRED obligation, and
 * `if_you_do_nothing` answered a creator with a deferred venture due at this very
 * Reckoning: *"Nothing of yours resolves at the Reckoning on tick 287."* That is the
 * A5-prime shape in its quiet direction — the agent is told it is safe to do nothing, does
 * nothing, and the retry at that Reckoning records the default. Worse than the FORMING
 * over-claim, because an over-claim makes an agent look and a false all-clear does not.
 *
 * `test/observe/briefing.test.ts` asserts this agrees with the real
 * `VentureBook.settlementSet`, so the two cannot drift.
 */
export function resolvesAt(venture: VentureRecord, settlementTick: number): boolean {
  return (
    (venture.state === 'LIVE' || venture.state === 'DEFERRED') &&
    venture.resolvesAtTick <= settlementTick
  );
}

/**
 * Build the briefing.
 *
 * Pure over the sources, so PROP-O5 can call it, then settle, then compare — with no
 * step in between that could have changed the answer.
 */
export function buildBriefing(sources: ObserveSources, principal: PrincipalId): Briefing {
  const at = nextSettlementTick(sources.tick);
  const outcomes: DoNothingOutcome[] = [];

  for (const venture of [...sources.ventures].sort((a, b) => compareIds(a.id, b.id))) {
    // `isLive || resolvesAt`, never `isLive` alone: `isLive` is `FORMING | LIVE` and a
    // DEFERRED obligation is neither, yet it is in the settlement set and will be judged
    // at this Reckoning. See {@link resolvesAt}.
    if (!isLive(venture) && !resolvesAt(venture, at)) continue;
    const partyAsCreator = venture.creator === principal;
    const role = roleOfPrincipal(venture, principal);
    if (!partyAsCreator && role === null) continue;

    // Two conditions, and both were mistakes to omit.
    //
    // **It has to resolve inside this Reckoning.** A venture resolving later is not a
    // consequence of doing nothing *now*.
    //
    // **It has to be settleable.** A `FORMING` venture cannot default: settlement refuses
    // anything but `LIVE` or `DEFERRED` (`settlement.ts:guardSettleable`), so a
    // half-filled venture whose window closes is `ABANDONED` — it fails to form, and
    // nobody broke a promise. The first draft predicted `ELECTIVE_LAPSES` for it, which
    // is the briefing telling an agent it is about to be recorded as a defaulter over a
    // deal that never bound.
    //
    // The correction to that first draft then over-narrowed to `state === 'LIVE'` and
    // dropped `DEFERRED`, which `guardSettleable` accepts and `book.settlementSet`
    // includes — so {@link resolvesAt} is the predicate, and it is exactly settlement's own.
    const resolvesNow = resolvesAt(venture, at);

    if (partyAsCreator && resolvesNow) {
      outcomes.push(...payerOutcomes(venture, principal));
    }
    if (role !== null && resolvesNow) {
      outcomes.push(...payeeOutcomes(venture, principal));
    }
    if (role !== null && !sources.sealedRoles.has(roleSealKey(venture.id, role.index))) {
      outcomes.push({
        kind: 'SEAL_ABSENT',
        subject: `${venture.id}#${String(role.index)}`,
        amount: minor(0),
        provenance: 'FACT',
        band: null,
      });
    }
    if (venture.state === 'FORMING' && openIndices(venture).length > 0 && venture.windowClosesTick <= at) {
      outcomes.push({
        kind: 'ROLE_OPEN',
        subject: venture.id,
        amount: minor(openIndices(venture).length),
        provenance: 'FACT',
        band: null,
      });
    }
  }

  if (sources.levy !== null) {
    const owed = minor(Math.max(0, sources.levy.my_assessment - sources.levy.paid));
    if (owed > 0) {
      outcomes.push({
        kind: 'LEVY_UNPAID',
        subject: sources.levy.deliverable_to,
        amount: owed,
        provenance: 'FACT',
        band: null,
      });
    }
  }

  for (const hand of handsOf(sources.world, principal)) {
    const eta = inTransitEta(hand);
    if (eta !== null && eta <= at) {
      outcomes.push({
        kind: 'HAND_LANDS',
        subject: hand.id,
        amount: minor(eta),
        provenance: 'FACT',
        band: null,
      });
    }
  }

  if (outcomes.length === 0) {
    outcomes.push({
      kind: 'NOTHING_RESOLVES',
      subject: '',
      amount: minor(0),
      provenance: 'FACT',
      band: null,
    });
  }

  const ordered = orderOutcomes(outcomes);
  return {
    prompt: buildPrompt(sources, principal, ordered),
    if_you_do_nothing: {
      at_tick: at,
      reckoning_index: reckoningIndex(sources.tick),
      outcomes: Object.freeze(ordered),
      line: renderLine(ordered, at),
    },
  };
}

/**
 * What the payer loses by electing nothing.
 *
 * The claim is computed at the p50 residual through `computeClaims` — the **same**
 * function settlement uses — so a wage role's figure is the one the waterfall will
 * pay and a share role's is the midpoint of the published band. Recomputing the
 * claim rule here would be two implementations of "what is owed", which §7.1 names
 * as the failure it was written to prevent.
 */
function payerOutcomes(venture: VentureRecord, principal: PrincipalId): DoNothingOutcome[] {
  const out: DoNothingOutcome[] = [];
  const claims = claimsAt(venture, 'p50');
  for (const claim of claims.roles) {
    if (claim.holder === null || claim.electiveDue <= 0) continue;
    // Self-dealing pays nothing and defaults on nothing (settlement books it as
    // fully paid), so predicting a default here would libel the payer to itself.
    if (claim.holder === principal) continue;
    const isWage = roleIsWage(venture, claim.roleIndex);
    out.push({
      kind: 'ELECTIVE_LAPSES',
      subject: `${venture.id}#${String(claim.roleIndex)}`,
      amount: claim.electiveDue,
      provenance: isWage ? 'FACT' : 'ESTIMATE',
      band: isWage ? null : electiveBand(venture, claim.roleIndex),
    });
  }
  return out;
}

/** What the payee is owed, split across A7's two halves. */
function payeeOutcomes(venture: VentureRecord, principal: PrincipalId): DoNothingOutcome[] {
  const out: DoNothingOutcome[] = [];
  const role = roleOfPrincipal(venture, principal);
  if (role === null) return out;
  const claims = claimsAt(venture, 'p50');
  const mine = claims.roles.find((r) => r.roleIndex === role.index);
  if (mine === undefined) return out;
  const isWage = role.terms.wage !== null;

  if (mine.escrowedDue > 0) {
    out.push({
      kind: 'ESCROW_EXECUTES',
      subject: `${venture.id}#${String(role.index)}`,
      amount: mine.escrowedDue,
      provenance: isWage ? 'FACT' : 'ESTIMATE',
      band: isWage ? null : escrowedBand(venture, role.index),
    });
  }
  if (mine.electiveDue > 0 && venture.creator !== principal) {
    out.push({
      kind: 'ELECTIVE_AT_RISK',
      subject: `${venture.id}#${String(role.index)}`,
      amount: mine.electiveDue,
      provenance: isWage ? 'FACT' : 'ESTIMATE',
      band: isWage ? null : electiveBand(venture, role.index),
    });
  }
  return out;
}

/**
 * Claims at one percentile, against the roles **actually filled**.
 *
 * Filled, not full — unlike `your_take_at_p50`, which quotes a full fill so a
 * signature does not go stale mid-negotiation. This answers "what happens if it
 * resolves as it stands", which is `projected_settlement`'s question and the only
 * one a do-nothing prediction may ask.
 */
function claimsAt(venture: VentureRecord, percentile: Percentile): ClaimBreakdown {
  const filled = filledIndices(venture);
  const proceeds = computeProceeds({
    kind: venture.kind,
    filled,
    stageBps: NEUTRAL_STAGE_BPS,
    residualSignedBps: residualAtPercentile(venture.kind, percentile),
  }).proceeds;
  return computeClaims(venture, proceeds, filled);
}

function electiveBand(venture: VentureRecord, roleIndex: number): readonly [Minor, Minor] {
  const lo = claimsAt(venture, 'p10').roles.find((r) => r.roleIndex === roleIndex)?.electiveDue ?? minor(0);
  const hi = claimsAt(venture, 'p90').roles.find((r) => r.roleIndex === roleIndex)?.electiveDue ?? minor(0);
  return [lo, hi];
}

function escrowedBand(venture: VentureRecord, roleIndex: number): readonly [Minor, Minor] {
  const lo = claimsAt(venture, 'p10').roles.find((r) => r.roleIndex === roleIndex)?.escrowedDue ?? minor(0);
  const hi = claimsAt(venture, 'p90').roles.find((r) => r.roleIndex === roleIndex)?.escrowedDue ?? minor(0);
  return [lo, hi];
}

function roleIsWage(venture: VentureRecord, roleIndex: number): boolean {
  return venture.roles[roleIndex]?.terms.wage !== null;
}

/**
 * ★ How grave, then how large **within one kind** — never how large across kinds.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **`amount` IS FIVE DIFFERENT UNITS AND THIS USED TO SORT ALL OF THEM ON ONE SCALE.**
 *
 * `DoNothingOutcome.amount` is typed `Minor` and is populated from:
 *
 *   · `LEVY_UNPAID` — **goods**, discharged only in `ration` (§5.2)
 *   · `ELECTIVE_LAPSES` · `ELECTIVE_AT_RISK` · `ESCROW_EXECUTES` — **currency** minor
 *   · `ROLE_OPEN` — **a count of roles**, 1..4
 *   · `HAND_LANDS` — **an absolute tick number**
 *   · `SEAL_ABSENT` · `NOTHING_RESOLVES` — zero
 *
 * The old comparator was `b.amount - a.amount`, so it ranked a goods obligation against a cash
 * figure, a cardinality and a clock reading. That is the same confusion as
 * `weightOf('BY_STORES')` — §3's canon STORES is *"assets, inventory, balances"*, one word for
 * two things — arriving through a *presentation* layer instead of through a rule, and it is the
 * third site of the family. Two consequences, one already dangerous and one a timer:
 *
 *   1. **`ROLE_OPEN` could never rank above anything**, so a venture about to resolve
 *      `PARTIAL_FILL` sat below a hand walking, permanently.
 *   2. **`HAND_LANDS` carries the tick.** Past tick ~20,000 every in-transit hand outranks a
 *      full `LEVY_DUTY_PER_PRINCIPAL` assessment; the live world was at ~5,274. So the briefing
 *      was scheduled to start leading with "a hand arrives" while the Levy went unpaid, and
 *      `agent.md` §12 tells players to read `if_you_do_nothing` **first every wake**.
 *
 * And the ordering decides what *disappears*: `LIST_CAPS.doNothing` is 12 and
 * `observe/tokens.ts` states plainly that this list *"has no `withheld` field to be counted
 * in"*. A comparator that cannot rank across units, deciding which predicted consequences an
 * agent never sees, with no count of the omission, is PROP-O1's failure with A5′ downstream of
 * it — the quiet direction, where the agent is told it is safe to do nothing.
 *
 * ── THE FIX IS TO RANK THE **KIND**, AND TO COMPARE AMOUNTS ONLY WITHIN ONE ──
 *
 * {@link GRAVITY} is a total order over kinds, so the first line is the gravest consequence
 * rather than the biggest integer, and the cap can only ever drop something *less* grave than
 * what it kept. `amount` is then compared only between two outcomes of the **same kind**, which
 * is the one comparison that is unit-safe by construction — and it stays unit-safe if a future
 * kind arrives in a new unit, because a new kind needs a `GRAVITY` entry and gets its own bucket.
 *
 * No `withheld` field is added: the schema is ten top-level keys and this is a presentation
 * order, not a missing fact. Severity-first is what makes the absent count harmless.
 * ══════════════════════════════════════════════════════════════════════════
 */
const GRAVITY: Readonly<Record<DoNothingKind, number>> = Object.freeze({
  // 0 — a permanent public mark on your record, or goods taken. A5 has no opt-out.
  ELECTIVE_LAPSES: 0,
  LEVY_UNPAID: 1,
  SEAL_ABSENT: 2,
  // 3 — an outcome you lose, with no mark against you.
  ROLE_OPEN: 3,
  // 4 — somebody else's choice, which you cannot fix by acting (A7, and deliberately hedged).
  ELECTIVE_AT_RISK: 4,
  // 5 — news rather than a dilemma: it happens whether you act or not.
  ESCROW_EXECUTES: 5,
  HAND_LANDS: 6,
  // 7 — only ever alone.
  NOTHING_RESOLVES: 7,
});

/**
 * Exported for its regression test, which is the only way to reach the failure that matters.
 *
 * The tick-outranks-the-Levy case needs an absolute tick above `LEVY_DUTY_PER_PRINCIPAL`, i.e. a
 * world 69 Reckonings old — unreachable in a test and inevitable in production. Fed synthetic
 * outcomes, the comparator's behaviour at that horizon is one assertion.
 */
export function orderOutcomes(outcomes: readonly DoNothingOutcome[]): DoNothingOutcome[] {
  return [...outcomes]
    .sort(
      (a, b) =>
        GRAVITY[a.kind] - GRAVITY[b.kind] ||
        // Same kind, therefore same unit. This is the only place `amount` is compared.
        b.amount - a.amount ||
        compareIds(a.subject, b.subject),
    )
    .slice(0, LIST_CAPS.doNothing);
}

/**
 * The prose. Templated from the ordered outcomes, so it can never say something the
 * structured list does not.
 */
function renderLine(outcomes: readonly DoNothingOutcome[], at: number): string {
  const head = outcomes[0];
  if (head === undefined || head.kind === 'NOTHING_RESOLVES') {
    return line(`Nothing of yours resolves at the Reckoning on tick ${String(at)}.`);
  }
  const parts = outcomes.slice(0, 3).map((outcome) => describe(outcome));
  return line(`At the Reckoning on tick ${String(at)}, taking no action: ${parts.join('; ')}.`);
}

function describe(outcome: DoNothingOutcome): string {
  const about = outcome.subject === '' ? '' : ` on ${outcome.subject}`;
  const hedge = outcome.provenance === 'ESTIMATE' ? ' (estimated at p50)' : '';
  switch (outcome.kind) {
    case 'ELECTIVE_LAPSES':
      return `you elect nothing${about} and ${String(outcome.amount)} is recorded as a default against you${hedge}`;
    case 'ELECTIVE_AT_RISK':
      return `${String(outcome.amount)} elective${about} is the payer's choice and is not guaranteed${hedge}`;
    case 'ESCROW_EXECUTES':
      return `${String(outcome.amount)} escrowed${about} pays you automatically${hedge}`;
    case 'SEAL_ABSENT':
      return `your role${about} still holds no seal and sealing closes at the freeze`;
    case 'ROLE_OPEN':
      return `${String(outcome.amount)} role(s)${about} stay open and it resolves PARTIAL_FILL`;
    case 'LEVY_UNPAID':
      return `${String(outcome.amount)} of Levy stays unpaid and your Commons capacity falls`;
    case 'HAND_LANDS':
      return `hand${about} arrives at tick ${String(outcome.amount)}`;
    case 'NOTHING_RESOLVES':
      return 'nothing of yours resolves';
  }
}

/**
 * The `prompt` — "one sentence naming the actual dilemma" (§12.1, R1).
 *
 * A dilemma needs two sides, so the template names the largest thing at risk *and*
 * the largest thing available, and falls back to the honest sentence when there is
 * only one of them. It is deliberately templated rather than generated: a sentence
 * an LLM wrote about the state is a second description of the state, and §12.1's
 * whole point is that the payload *is* the decision document.
 */
function buildPrompt(
  sources: ObserveSources,
  principal: PrincipalId,
  outcomes: readonly DoNothingOutcome[],
): string {
  const owed = outcomes.find((o) => o.kind === 'ELECTIVE_LAPSES');
  const due = outcomes.find((o) => o.kind === 'ELECTIVE_AT_RISK');
  const levy = outcomes.find((o) => o.kind === 'LEVY_UNPAID');
  const ticks = ticksUntilReckoning(sources.tick);
  const free = sources.stores.freeMinor(principal);

  if (owed !== undefined && due !== undefined) {
    return line(
      `You owe ${String(owed.amount)} elective on ${owed.subject} and are owed ${String(due.amount)} on ` +
        `${due.subject}; ${String(ticks)} ticks to the Reckoning and ${String(free)} free. Honouring costs ` +
        'you the difference and buys the only thing that builds standing.',
    );
  }
  if (owed !== undefined) {
    return line(
      `You owe ${String(owed.amount)} elective on ${owed.subject} with ${String(free)} free and ` +
        `${String(ticks)} ticks left. Paying it is the only thing that builds standing; declining it is legal ` +
        'and permanent.',
    );
  }
  if (due !== undefined) {
    return line(
      `${String(due.amount)} of yours on ${due.subject} rides on someone else's election, ${String(ticks)} ` +
        'ticks from now. You cannot make them pay; you can decide what you do next time.',
    );
  }
  if (levy !== undefined) {
    return line(
      `The Levy wants ${String(levy.amount)} delivered to ${levy.subject} within ${String(ticks)} ticks. ` +
        'It cannot be escrowed and it cannot be dodged; hiding is the most taxed posture in the game.',
    );
  }
  return line(
    `Nothing of yours resolves this Reckoning (${String(ticks)} ticks). ${String(free)} free and ` +
      `${String(handsOf(sources.world, principal).filter((h) => h.state === 'IDLE').length)} idle hands: the ` +
      'cost of waiting is the venture you did not join.',
  );
}
