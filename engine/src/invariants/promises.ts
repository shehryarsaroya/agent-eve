/**
 * INV-18, INV-19, and INV-21's history half.
 *
 * These are claims about the *relationship* between the frozen settlement set, the
 * event ledger and the standing table, and no single module can see two of those at
 * once. They all exist because of the same failure. SPEC §15.4:
 *
 * > I commit to pay from account X; during the window my convoy is raided and X is
 * > drained; my "default" is your bug, permanently attached to my name, invisible
 * > in a healthy-looking system.
 *
 * INV-18 is the hard freeze made executable (scar #6). INV-19 is
 * `acted_on_state_version` compared at settlement.
 *
 * ## What is deliberately *not* here
 *
 * **INV-20 is not in this file.** `src/seal/invariants.ts` owns it, over a real
 * `SealBook` that counts its own evaluations — which is a stronger claim than
 * anything reachable from a verdict list, because "evaluated once" is a claim about
 * history and a snapshot cannot show history. The aggregate calls theirs. A second
 * implementation here would be an audit that can disagree with the engine, and a
 * disagreement about the rules is scar #1.
 *
 * **INV-21 has two halves and this file owns one.** `src/seal/standing.ts:checkInv21`
 * is the *per-batch* half: given a before row, an after row and the causes the tick
 * claims, did anything move that no cause authorises? {@link checkStandingJournal}
 * is the *history* half: does the cached row match the whole journal, do the distinct
 * counterparties actually differ (scar #9), and — the clause only reachable from
 * here — did standing fall for a default that INV-17 can justify? Neither half
 * subsumes the other, and the cause table itself is imported from `seal/standing.ts`
 * so it has exactly one home.
 */

import { reckoningIndex } from '../core/time.js';
import type {
  EventId,
  GameEvent,
  InvariantViolation,
  PrincipalId,
  SealId,
  Standing,
} from '../core/types.js';
import type { EventLedger } from '../events/ledger.js';
import { VECTORS_BY_CAUSE, type StandingCause, type StandingVector } from '../seal/standing.js';
import type { DefaultRegister } from './attribution.js';
import { halt } from './registry.js';

// ── INV-18: the hard freeze ─────────────────────────────────────────────────

/**
 * What the Reckoning is about to settle, computed at the freeze and then immutable.
 *
 * `objects` holds the id of everything the settlement will read or write —
 * ventures, escrow accounts, stores, encumbrances, principals. INV-18's claim is
 * that between the freeze and the settlement, **nothing touches any of them**,
 * because anything that does can move the value the settlement is about to pay
 * from, and the settlement will then record the shortfall as a broken promise.
 *
 * `settlementSeqFrom` is load-bearing and easy to miss. With `FREEZE_TICKS = 1`
 * the freeze tick *is* the settlement tick (`inFreeze(t)` and `isSettlementTick(t)`
 * are both true at phase 287), so "between freeze and settlement" is an empty
 * interval in wall time and the only thing separating the two is the sequence
 * within that tick. So the settlement declares the `seqInTick` at which its own
 * events begin; everything written at the freeze tick *before* that is somebody
 * else's action and may not touch the set.
 */
export interface SettlementSet {
  readonly reckoningIndex: number;
  /** The tick the freeze took effect. Usually the settlement tick itself. */
  readonly frozenAtTick: number;
  /** The tick settlement runs at. Events from here on are the settlement's own. */
  readonly settlementTick: number;
  /**
   * The `seqInTick` at the settlement tick from which events belong to the
   * settlement. Events at that tick with a lower seq are third-party actions.
   */
  readonly settlementSeqFrom: number;
  /** Every object the settlement depends on. */
  readonly objects: ReadonlySet<string>;
  /** Hash of the settlement inputs, taken at the freeze. Pins the valuation. */
  readonly inputsHash: string;
  /** The state version the frozen snapshot is at. */
  readonly stateVersion: number;
}

/** Payload nesting the object scan will walk. Beyond this, refuse rather than miss. */
const MAX_PAYLOAD_DEPTH = 8;

/**
 * Every object id an event mentions.
 *
 * Deliberately blunt: the id columns plus **every string anywhere in the payload**.
 * A targeted version would need a per-kind schema of which fields hold references,
 * and the first kind whose schema is out of date is a hole in the one invariant
 * standing between legitimate predation and a fabricated default. False positives
 * here cost an operator a conversation; false negatives cost a principal its name.
 */
export function touchedObjects(event: GameEvent): ReadonlySet<string> {
  const out = new Set<string>();
  if (event.actorPrincipalId !== null) out.add(event.actorPrincipalId);
  if (event.onBehalfOfPrincipalId !== null) out.add(event.onBehalfOfPrincipalId);
  if (event.grantId !== null) out.add(event.grantId);
  collectStrings(event.payload, 0, out);
  return out;
}

function collectStrings(value: unknown, depth: number, out: Set<string>): void {
  if (depth > MAX_PAYLOAD_DEPTH) {
    throw new Error(
      `INV-18: event payload nested deeper than ${MAX_PAYLOAD_DEPTH}; the object scan cannot see the bottom`,
    );
  }
  if (typeof value === 'string') {
    if (value.length > 0) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, depth + 1, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) collectStrings(v, depth + 1, out);
  }
}

/**
 * INV-18 — between freeze and settlement, zero events touch any object in the
 * settlement set.
 *
 * Scar #6 made executable. The event that "didn't happen" ~35% of the time in
 * High Water happened because the state the resolver read was not the state the
 * players acted on; here the same divergence would not merely lose an event, it
 * would publish an accusation.
 */
export function checkInv18(
  events: EventLedger,
  set: SettlementSet,
  tick: number,
): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  if (set.settlementTick < set.frozenAtTick) {
    out.push(
      halt(
        'INV-18',
        tick,
        `settlement set for Reckoning ${set.reckoningIndex} settles at tick ${set.settlementTick}, ` +
          `before its freeze at ${set.frozenAtTick}`,
      ),
    );
    return out;
  }

  for (const t of events.ticks()) {
    if (t < set.frozenAtTick || t > set.settlementTick) continue;
    for (const rec of events.eventsAtTick(t)) {
      const { event } = rec;
      // The settlement's own events necessarily touch the set — that is what
      // settling is. Everything before `settlementSeqFrom` at the settlement tick,
      // and everything at a freeze tick before it, is a third party.
      if (t === set.settlementTick && event.seqInTick >= set.settlementSeqFrom) continue;

      const touched = touchedObjects(event);
      const hits = [...set.objects].filter((o) => touched.has(o)).sort(cmp);
      if (hits.length > 0) {
        out.push(
          halt(
            'INV-18',
            tick,
            `event ${event.id} (${event.kind}) at tick ${t} seq ${event.seqInTick} touches ` +
              `${hits.join(', ')} inside the freeze for Reckoning ${set.reckoningIndex}; ` +
              'an unfrozen settlement can fabricate a broken promise',
          ),
        );
      }
    }
  }
  return out;
}

// ── INV-19: what the parties acted on ───────────────────────────────────────

/**
 * One item in the settlement set, with both sides of the comparison.
 *
 * The venture module supplies `pinned*` (what was countersigned) and `observed*`
 * (what the frozen snapshot says now). This module does not recompute either:
 * an audit with its own second implementation of the valuation rule is an audit
 * that can disagree with the engine, and a disagreement about the rules is
 * scar #1 with a permanent accusation attached.
 */
export interface SettlementItem {
  /** The venture, grant or Levy assessment being settled. */
  readonly obligation: string;
  /** `acted_on_state_version` as pinned at countersignature. */
  readonly pinnedStateVersion: number | null;
  /** The state version the settlement is resolving from. */
  readonly observedStateVersion: number;
  /** `terms_hash`, which pins the valuation rule *and* its as-of tick. */
  readonly pinnedTermsHash: string | null;
  /** The same hash recomputed from the frozen inputs. */
  readonly observedTermsHash: string | null;
}

/**
 * INV-19 — at settlement, `acted_on_state_version` matches the state the parties
 * acted on, or the tick halts.
 *
 * Halts rather than settling on the new numbers. That choice is the whole point:
 * settling anyway is what produces the default nobody caused, and SPEC §15.4 lists
 * this comparison as the second of five defences against exactly that.
 */
export function checkInv19(
  items: readonly SettlementItem[],
  tick: number,
): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const item of [...items].sort((a, b) => cmp(a.obligation, b.obligation))) {
    if (item.pinnedStateVersion === null) {
      out.push(
        halt(
          'INV-19',
          tick,
          `${item.obligation} is being settled with no acted_on_state_version; there is nothing to compare, ` +
            'so there is no way to know the parties agreed to this outcome',
        ),
      );
    } else if (item.pinnedStateVersion !== item.observedStateVersion) {
      out.push(
        halt(
          'INV-19',
          tick,
          `${item.obligation} was agreed at state version ${item.pinnedStateVersion} but is being settled ` +
            `at ${item.observedStateVersion}; halt rather than settle on numbers nobody signed`,
        ),
      );
    }
    if (item.pinnedTermsHash === null) {
      out.push(
        halt('INV-19', tick, `${item.obligation} has no terms_hash; nothing was countersigned`),
      );
    } else if (item.pinnedTermsHash !== item.observedTermsHash) {
      out.push(
        halt(
          'INV-19',
          tick,
          `${item.obligation} pinned terms_hash ${item.pinnedTermsHash} but the frozen inputs hash to ` +
            `${String(item.observedTermsHash)}; the valuation moved between agreement and settlement`,
        ),
      );
    }
  }
  return out;
}

// ── INV-20's missing clause: the Reckoning that never ran ───────────────────

/**
 * INV-20's zero-verdict case, which `src/seal/invariants.ts` cannot see.
 *
 * That module's check branches on `book.isResolved(r)`. Both branches are correct,
 * and between them they cover "judged twice" and "judged early" — but a Reckoning
 * that was **never resolved at all** takes the unresolved branch forever, so its
 * seals sit with `verdict === null` and `evaluations === 0` and nothing fires. From
 * inside the seal book that is indistinguishable from a Reckoning that has not
 * happened yet; from outside, with a clock, it is a promise the world quietly
 * dropped.
 *
 * TESTING.md §3 says *exactly one* verdict. Zero is as much a violation as two, and
 * it is the more insidious one: two verdicts is a visible contradiction, while zero
 * reads to the agent that made the promise as a promise that never counted. Scar #7
 * is the sticky vow; this is its mirror.
 *
 * Additive on purpose — it makes no claim the seal module already makes, so there is
 * still one implementation of each clause.
 */
export function checkUnjudgedSeals(
  book: {
    auditRecords(): readonly { readonly id: SealId; readonly reckoningIndex: number }[];
    isResolved(reckoning: number): boolean;
  },
  tick: number,
): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const now = reckoningIndex(tick);
  const unresolved = new Set<number>();
  for (const rec of book.auditRecords()) {
    if (rec.reckoningIndex >= now) continue;
    if (book.isResolved(rec.reckoningIndex)) continue;
    unresolved.add(rec.reckoningIndex);
    out.push(
      halt(
        'INV-20',
        tick,
        `seal ${rec.id} was made for Reckoning ${rec.reckoningIndex}, which closed before ${now} and ` +
          'never resolved its seals; exactly one verdict means zero is a violation too',
      ),
    );
  }
  return out;
}

// ── INV-21, the history half ────────────────────────────────────────────────

/**
 * The four sanctioned causes, re-exported from their one home.
 *
 * `src/seal/standing.ts` declares `StandingCause` and `VECTORS_BY_CAUSE`, because
 * that module owns one of the four causes and — as its own header says — "a checker
 * that only knows about its own cause cannot tell 'nothing else moved' from
 * 'something else moved and I could not see it'". Declaring the same union again
 * here would be two homes for one rule table, so this file imports it and
 * {@link STANDING_CAUSES} is derived rather than typed out.
 */
export type { StandingCause } from '../seal/standing.js';

export const STANDING_CAUSES: readonly StandingCause[] = (
  Object.keys(VECTORS_BY_CAUSE) as StandingCause[]
).sort(cmp);

/**
 * The countable vectors. `lastDefaultTick` is a stamp rather than a count, so it is
 * checked separately and excluded here by construction rather than by a second list
 * that could drift from the seal module's.
 */
export type StandingField = Exclude<StandingVector, 'lastDefaultTick'>;

const STANDING_FIELDS: readonly StandingField[] = [
  'electiveHonoured',
  'electiveHonouredValue',
  'defaults',
  'contradictedSeals',
  'distinctCounterparties',
];

/** Which fields a cause may move, read out of the seal module's table. */
function fieldsFor(cause: StandingCause): ReadonlySet<StandingField> {
  const vectors: readonly StandingVector[] = VECTORS_BY_CAUSE[cause] ?? [];
  return new Set(vectors.filter((v): v is StandingField => v !== 'lastDefaultTick'));
}

/**
 * The imported table still covers all four causes and no fifth.
 *
 * Asserted rather than assumed because the table lives in another module: a cause
 * added there without a vector list would silently make every field unauthorised
 * here, and a cause *removed* would make every change under it unauthorised — either
 * way a false halt, which SPEC §15.4 puts in the same class as a false default.
 */
export function assertCauseTableIntact(): void {
  if (STANDING_CAUSES.length !== 4) {
    throw new Error(
      `INV-21 names exactly four causes; seal/standing.ts offers ${STANDING_CAUSES.length}: ` +
        STANDING_CAUSES.join(', '),
    );
  }
  for (const cause of STANDING_CAUSES) {
    if (fieldsFor(cause).size === 0) {
      throw new Error(`cause ${cause} authorises no standing vector; nothing could ever move under it`);
    }
  }
}

/**
 * One entry in the standing journal.
 *
 * The journal exists so INV-21 can be checked at all. Standing is a cached
 * projection; without a journal there is no way to distinguish "this figure rose
 * because an elective part was honoured" from "this figure rose because a loop ran
 * twice", and the second is scar #9, which took a reputation from 50 to 100 with
 * ~17 duplicate pacts.
 */
export interface StandingChange {
  readonly principal: PrincipalId;
  readonly tick: number;
  readonly cause: StandingCause;
  /** The event that justifies it. Must exist in the ledger. */
  readonly eventId: EventId;
  /** Signed deltas, per field. `electiveHonouredValue` is in minor units. */
  readonly delta: Readonly<Partial<Record<StandingField, number>>>;
  /**
   * For `ELECTIVE_HONOURED`: the counterparty whose honoured elective part this
   * was. Required, because the anti-farm term is a count of *distinct,
   * independently-capitalised* counterparties and self-dealing earns zero.
   */
  readonly counterparty: PrincipalId | null;
}

export interface Inv21Inputs {
  readonly changes: readonly StandingChange[];
  /** The cached rows an agent reads. Recomputed from the journal and compared. */
  readonly standings: readonly Standing[];
  readonly events: EventLedger;
  /** INV-17's register. A `DEFAULT` change with no attributable cause is a halt here too. */
  readonly defaults: DefaultRegister;
}

/**
 * INV-21's **history half** — the cached standing row against the whole journal.
 *
 * `src/seal/standing.ts:checkInv21` owns the per-batch half: given before, after and
 * the causes claimed, did anything move that no cause authorises? That check is
 * blind to history by construction, and three of INV-21's failures are historical:
 *
 *   1. the cause is one of the four, and the fields it moved are ones it may move;
 *   2. `DECAY` only ever reduces, and nothing else ever does;
 *   3. the justifying event exists — and if the cause is `DEFAULT`, that default is
 *      *attributable* (INV-17), so reputation cannot fall for an accusation the
 *      engine could not justify. This clause is reachable from nowhere else, because
 *      nothing else sees both the journal and the register;
 *   4. the journal, replayed, equals the cached row — INV-5's shape applied to
 *      reputation: the number an agent is judged by is the number the record can
 *      account for;
 *   5. `distinctCounterparties` matches the distinct *set*, not just the summed
 *      deltas. Scar #9 summed correctly and counted one counterparty seventeen times.
 *
 * Violations are tagged `INV-21` because that is the invariant they belong to. The
 * function is not called `checkInv21` because that name is taken by the other half,
 * and one name per concept is a rules surface (§3).
 */
/**
 * The resumable replay state for INV-21.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **WHY THIS IS NOT A TAUTOLOGY.** INV-21's value is that the cached standing row an agent reads
 * is compared against a replay of **every change ever made to it**. Keeping a running total beside
 * the rows and comparing the two is two numbers maintained by one code path agreeing, which proves
 * nothing. So this is not a running total: it is a replay that was independently performed at the
 * tick it was verified, resumed only while the entries it folded provably have not changed.
 *
 * Before: the whole journal was replayed AND SORTED every tick — O(n log n) on an n that grows for
 * the life of the world, worse than the O(n) `checkInv7` was doing before its own fix.
 *
 * **THE BOUNDARY IS A COMPLETED TICK, NOT AN ARRAY INDEX.** The canonical order is
 * `(tick, principal, eventId)`, so entries inside one tick interleave; resuming mid-tick could fold
 * a later-sorting change before an earlier one and move `lastDefault`'s sequencing. Only ticks
 * strictly before the current one are sealed, because the current tick can still receive changes
 * after this check runs.
 *
 * **THE TRAP, WHICH COST A HUNDRED FAILING TESTS ON THE FIRST ATTEMPT.** Fold everything through
 * the current tick but seal at `tick - 1`, and the next call re-folds the previous tick and
 * DOUBLE-COUNTS. Hence the clone: the comparison runs against carried-plus-unsealed-tail, while the
 * carried state absorbs only completed ticks — and absorbs them **only if this pass found no
 * violations**, because a tick that is about to abort must not certify a boundary inside a world
 * that never happened.
 *
 * Keyed on the `EventLedger`, which is stable for a world's life, in a `WeakMap`: this is
 * VERIFICATION state and must never reach `state_hash`, and a restored world correctly starts with
 * no prefix and replays from the beginning.
 * ══════════════════════════════════════════════════════════════════════════════
 */
interface StandingPrefix {
  throughTick: number;
  count: number;
  boundary: string | null;
  readonly recomputed: Map<PrincipalId, Record<StandingField, number>>;
  readonly lastDefault: Map<PrincipalId, number>;
  readonly counterparties: Map<PrincipalId, Set<PrincipalId>>;
}

const STANDING_PREFIX = new WeakMap<EventLedger, StandingPrefix>();

/** Full replays vs resumed ones. Read by the test that proves this is actually incremental. */
export const inv21Stats = { fullReplays: 0, resumed: 0 };

export function checkStandingJournal(
  inputs: Inv21Inputs,
  tick: number,
): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];

  // ── THE RESUMED REPLAY (see StandingPrefix) ───────────────────────────────
  let carried = STANDING_PREFIX.get(inputs.events);
  const boundaryIntact =
    carried !== undefined &&
    carried.count <= inputs.changes.length &&
    (carried.count === 0 || String(inputs.changes[carried.count - 1]?.eventId) === carried.boundary);
  if (carried === undefined || !boundaryIntact) {
    carried = { throughTick: -1, count: 0, boundary: null, recomputed: new Map(), lastDefault: new Map(), counterparties: new Map() };
    STANDING_PREFIX.set(inputs.events, carried);
    inv21Stats.fullReplays += 1;
  } else {
    inv21Stats.resumed += 1;
  }
  const sealedThrough = carried.throughTick;

  // The comparison runs against a CLONE, never against the carried state. The clone is bounded by
  // the number of principals with standing, not by the length of the journal, so it is affordable
  // every tick — and it is what lets the unsealed tail be replayed without contaminating a prefix
  // that a later aborted tick might have to disown.
  const recomputed = new Map<PrincipalId, Record<StandingField, number>>();
  for (const [k, v] of carried.recomputed) recomputed.set(k, { ...v });
  const lastDefault = new Map(carried.lastDefault);
  const counterparties = new Map<PrincipalId, Set<PrincipalId>>();
  for (const [k, v] of carried.counterparties) counterparties.set(k, new Set(v));

  const replay = (from: number): readonly StandingChange[] =>
    inputs.changes
      .filter((c) => c.tick > from)
      .sort((a, b) => a.tick - b.tick || cmp(a.principal, b.principal) || cmp(a.eventId, b.eventId));

  const ordered = replay(sealedThrough);

  for (const change of ordered) {
    if (!STANDING_CAUSES.includes(change.cause)) {
      out.push(
        halt(
          'INV-21',
          tick,
          `standing for ${change.principal} moved with cause ${String(change.cause)}, which is not one of ` +
            'the four; standing never moves as a side effect',
        ),
      );
      continue;
    }
    const allowed = fieldsFor(change.cause);
    for (const [field, amount] of Object.entries(change.delta)) {
      const key = field as StandingField;
      if (!STANDING_FIELDS.includes(key)) {
        out.push(
          halt('INV-21', tick, `standing change ${change.eventId} moves unknown field ${field}`),
        );
        continue;
      }
      if (amount === undefined || !Number.isSafeInteger(amount)) {
        out.push(
          halt(
            'INV-21',
            tick,
            `standing change ${change.eventId} moves ${field} by ${String(amount)}; standing is integers`,
          ),
        );
        continue;
      }
      if (!allowed.has(key)) {
        out.push(
          halt(
            'INV-21',
            tick,
            `standing change ${change.eventId} (${change.cause}) moves ${field}, which that cause may not touch`,
          ),
        );
        continue;
      }
      if (change.cause === 'DECAY' && amount > 0) {
        out.push(
          halt(
            'INV-21',
            tick,
            `standing change ${change.eventId} is DECAY but raises ${field} by ${amount}; decay only reduces`,
          ),
        );
        continue;
      }
      if (change.cause !== 'DECAY' && amount < 0) {
        out.push(
          halt(
            'INV-21',
            tick,
            `standing change ${change.eventId} (${change.cause}) reduces ${field} by ${-amount}; only scheduled ` +
              'decay reduces standing',
          ),
        );
        continue;
      }
      const row = bucket(recomputed, change.principal);
      row[key] += amount;
    }

    if (inputs.events.get(change.eventId) === null) {
      out.push(
        halt(
          'INV-21',
          tick,
          `standing change for ${change.principal} cites event ${change.eventId}, which is not in the ledger`,
        ),
      );
    }
    if (change.cause === 'DEFAULT') {
      if (!inputs.defaults.has(change.eventId)) {
        out.push(
          halt(
            'INV-21',
            tick,
            `standing for ${change.principal} fell on ${change.eventId}, which has no attributable cause ` +
              '(INV-17); reputation must never fall for an accusation the engine cannot justify',
          ),
        );
      }
      const prior = lastDefault.get(change.principal);
      if (prior === undefined || change.tick > prior) lastDefault.set(change.principal, change.tick);
    }
    if (change.cause === 'ELECTIVE_HONOURED') {
      if (change.counterparty === null) {
        out.push(
          halt(
            'INV-21',
            tick,
            `standing change ${change.eventId} credits an honoured elective part with no counterparty; ` +
              'the anti-farm term counts distinct counterparties and self-dealing earns zero (scar #9)',
          ),
        );
      } else if (change.counterparty === change.principal) {
        out.push(
          halt(
            'INV-21',
            tick,
            `standing change ${change.eventId} credits ${change.principal} for honouring itself`,
          ),
        );
      } else {
        let seen = counterparties.get(change.principal);
        if (seen === undefined) {
          seen = new Set<PrincipalId>();
          counterparties.set(change.principal, seen);
        }
        seen.add(change.counterparty);
      }
    }
  }

  for (const standing of [...inputs.standings].sort((a, b) => cmp(a.principal, b.principal))) {
    const want = recomputed.get(standing.principal) ?? zeroRow();
    for (const field of STANDING_FIELDS) {
      const held: number = standing[field];
      if (held !== want[field]) {
        out.push(
          halt(
            'INV-21',
            tick,
            `standing for ${standing.principal}: ${field} is ${held}, but the journal accounts for ` +
              `${want[field]}`,
          ),
        );
      }
    }
    // The anti-farm term, checked against the *set* and not only the sum. Scar #9
    // took a reputation from 50 to 100 with ~17 duplicate pacts: a journal that
    // records +1 per honoured part sums correctly and still counts one counterparty
    // seventeen times, so the two recomputations must agree with each other as well
    // as with the row.
    //
    // Asserted as a **ceiling**, not an equality, and that is load-bearing.
    // `VECTORS_BY_CAUSE.DECAY` authorises `distinctCounterparties` (§6.4 gives every
    // vector a recency half-life), so the summed journal above legitimately falls
    // below the number of counterparties the journal names — the set has no way to
    // un-name one. Comparing the same cached field against both the decayed sum and
    // the undecayed set size made the two clauses mutually unsatisfiable: after any
    // decay of this field, no value of `standing.distinctCounterparties` could pass
    // both, and INV-21 halted a healthy world. A false halt is the same class of bug
    // as a false default (SPEC §15.4). The ceiling still catches scar #9 — 17
    // duplicate pacts sum to 17 against a set of 1 — which is the attack; an
    // *under*count only penalises the principal and cannot be farmed.
    const distinct = counterparties.get(standing.principal)?.size ?? 0;
    if (standing.distinctCounterparties > distinct) {
      out.push(
        halt(
          'INV-21',
          tick,
          `standing for ${standing.principal}: distinctCounterparties is ` +
            `${standing.distinctCounterparties}, but the journal names ${distinct} distinct ` +
            'counterparties; duplicates earn zero (scar #9)',
        ),
      );
    }
    const stamp = lastDefault.get(standing.principal) ?? null;
    if (standing.lastDefaultTick !== stamp) {
      out.push(
        halt(
          'INV-21',
          tick,
          `standing for ${standing.principal}: lastDefaultTick is ${String(standing.lastDefaultTick)}, ` +
            `but the journal's latest default is ${String(stamp)}`,
        ),
      );
    }
  }

  for (const [principal, row] of [...recomputed.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    if (inputs.standings.some((s) => s.principal === principal)) continue;
    const moved = STANDING_FIELDS.filter((f) => row[f] !== 0);
    if (moved.length > 0) {
      out.push(
        halt(
          'INV-21',
          tick,
          `the journal moves standing for ${principal} (${moved.join(', ')}) but there is no standing row`,
        ),
      );
    }
  }

  // ── SEAL COMPLETED TICKS, AND ONLY ON A CLEAN PASS ────────────────────────
  //
  // `tick - 1`, never `tick`: the current tick can still receive standing changes after this check
  // runs, and sealing a half-finished tick would leave the rest of it permanently unverified.
  //
  // And nothing is sealed at all when this pass found violations. The tick is about to abort, its
  // standing rows and journal entries will be rolled back, and a boundary sealed inside a tick that
  // never happened would certify a world that does not exist — which is worse than the cost it
  // saves. The clone above is what makes this possible: the comparison already ran against
  // carried-plus-tail, so the carried state can absorb strictly less than it was compared with.
  if (out.length === 0) {
    for (const change of replay(sealedThrough)) {
      if (change.tick > tick - 1) continue;
      if (!STANDING_CAUSES.includes(change.cause)) continue;
      const allowed = fieldsFor(change.cause);
      const row = bucket(carried.recomputed, change.principal);
      for (const [field, amount] of Object.entries(change.delta)) {
        const key = field as StandingField;
        if (!STANDING_FIELDS.includes(key) || amount === undefined || !Number.isSafeInteger(amount)) continue;
        if (!allowed.has(key)) continue;
        row[key] += amount;
      }
      if (change.cause === 'DEFAULT') {
        const prior = carried.lastDefault.get(change.principal);
        if (prior === undefined || change.tick > prior) carried.lastDefault.set(change.principal, change.tick);
      }
      if (change.counterparty !== null && change.counterparty !== change.principal) {
        let seen = carried.counterparties.get(change.principal);
        if (seen === undefined) {
          seen = new Set<PrincipalId>();
          carried.counterparties.set(change.principal, seen);
        }
        seen.add(change.counterparty);
      }
    }
    carried.throughTick = tick - 1;
    carried.count = inputs.changes.length;
    carried.boundary =
      inputs.changes.length === 0 ? null : String(inputs.changes[inputs.changes.length - 1]?.eventId ?? '');
  }

  return out;
}

function zeroRow(): Record<StandingField, number> {
  return {
    electiveHonoured: 0,
    electiveHonouredValue: 0,
    defaults: 0,
    contradictedSeals: 0,
    distinctCounterparties: 0,
  };
}

function bucket(
  map: Map<PrincipalId, Record<StandingField, number>>,
  principal: PrincipalId,
): Record<StandingField, number> {
  const existing = map.get(principal);
  if (existing !== undefined) return existing;
  const fresh = zeroRow();
  map.set(principal, fresh);
  return fresh;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
