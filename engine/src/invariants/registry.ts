/**
 * The register of INV-1 … INV-26, and the honest account of what is checked.
 *
 * Every other module in this engine implements the invariants it can see.
 * `ledger/invariants.ts` owns the value group, `world/invariants.ts` presence,
 * `events/invariants.ts` the record. None of them can own the list itself, and
 * the list is the thing that matters: **an invariant nobody implements looks
 * exactly like an invariant that never fires.** TESTING.md §3 calls INV-25 "the
 * one most likely to quietly stop being true as features are added"; the general
 * form of that hazard is a registry that flatters itself.
 *
 * So this file carries, per invariant:
 *
 *   - `checkedIn`  — the module whose code answers it, or `null` if nothing does;
 *   - `producedIn` — the module that *produces* the state it reads, or `null`.
 *     A check with no producer is not a passing check, it is an unexercised one,
 *     and the distinction is the whole reason this column exists;
 *   - `coverage`   — `FULL | PARTIAL | ABSENT`, with `gap` stating why whenever
 *     it is not `FULL`. An empty `gap` on a non-`FULL` row fails a test.
 *
 * `test/invariants/registry.test.ts` cross-checks these claims against the code:
 * every `FULL` row must have a test proving it *fires*, which is the gap wave 1's
 * verifier found in INV-2 and INV-7 (nine call sites, no firing test).
 */

import type { InvariantViolation } from '../core/types.js';

/** TESTING.md §3's own headings. Not §3-canon words; none of these name a game concept. */
export type InvariantGroup = 'VALUE' | 'PRESENCE' | 'RECORD' | 'PROMISES' | 'AUTHORITY' | 'CROWD';

/**
 * How much of the invariant is actually enforced today.
 *
 * `ABSENT` is a legitimate value and must stay usable: a registry that cannot
 * express "nothing checks this" is a registry that lies by omission.
 */
export type Coverage = 'FULL' | 'PARTIAL' | 'ABSENT';

export interface InvariantEntry {
  readonly id: string;
  readonly group: InvariantGroup;
  /** TESTING.md §3's statement, compressed to one line. */
  readonly statement: string;
  /** Module path that implements the check, or `null` when nothing does. */
  readonly checkedIn: string | null;
  /** Module path that produces the state the check reads, or `null`. */
  readonly producedIn: string | null;
  readonly coverage: Coverage;
  /** Required whenever `coverage !== 'FULL'`. Stated, never implied. */
  readonly gap: string;
  /**
   * Report order. Lower is more severe.
   *
   * INV-17 is rank 0 and alone there: a default with no attributable cause is
   * the game accusing an innocent agent, which A5′ makes strictly worse than a
   * crash. Everything else is ordered by how permanent its damage is.
   */
  readonly rank: number;
}

/** INV-17's rank, named so the ordering claim is testable rather than incidental. */
export const TOP_SEVERITY_ID = 'INV-17';

function entry(
  id: string,
  group: InvariantGroup,
  rank: number,
  statement: string,
  checkedIn: string | null,
  producedIn: string | null,
  coverage: Coverage,
  gap = '',
): InvariantEntry {
  return { id, group, statement, checkedIn, producedIn, coverage, gap, rank };
}

/**
 * The 26, in id order.
 *
 * Read the `producedIn` column before believing the `coverage` column. Six of
 * these checks are complete functions over state that **no module writes yet** —
 * the Levy, the docket, seals, standing, grants. Those rows are `PARTIAL` on
 * purpose: the arithmetic is asserted, the wiring is not, and calling that `FULL`
 * is how a checklist becomes a comfort blanket.
 */
export const INVARIANTS: readonly InvariantEntry[] = [
  entry(
    'INV-1',
    'VALUE',
    10,
    '>=2 postings summing to zero per value-moving event, or one ISSUE/RETIRE against a named faucet/sink',
    'src/ledger/invariants.ts:checkInv1',
    'src/ledger/ledger.ts',
    'FULL',
  ),
  entry(
    'INV-2',
    'VALUE',
    10,
    'supply conservation per currency and per good: balances + escrowed + in-transit = issued - retired',
    'src/ledger/invariants.ts:checkInv2',
    'src/ledger/ledger.ts',
    'FULL',
  ),
  entry(
    'INV-3',
    'VALUE',
    10,
    'no negative balance on a non-faucet account; no negative lot; locks never exceed the balance',
    'src/ledger/invariants.ts:checkInv3',
    'src/ledger/ledger.ts',
    'FULL',
  ),
  entry(
    'INV-4',
    'VALUE',
    10,
    'every encumbrance references a live obligation; no orphan locks; no obligation lacks its encumbrance',
    'src/ledger/invariants.ts:checkInv4',
    'src/ledger/encumbrance.ts',
    'FULL',
  ),
  entry(
    'INV-5',
    'VALUE',
    10,
    'EXPOSURE recomputed from the encumbrance table equals the cached value, and the value served',
    'src/ledger/invariants.ts:checkInv5',
    'src/ledger/encumbrance.ts',
    'FULL',
  ),
  entry(
    'INV-6',
    'VALUE',
    10,
    "every settled venture's splits sum exactly to its proceeds; the remainder is allocated, never dropped",
    'src/ledger/waterfall.ts:assertPayoutsExact',
    null,
    'PARTIAL',
    'the arithmetic is complete and asserted per settlement, but no venture module produces settlements yet, ' +
      'so the aggregate can only check the payout sets handed to it in InvariantInputs.settlements',
  ),
  entry(
    'INV-7',
    'VALUE',
    10,
    'no quantity has two homes: both mirrors recomputed from posting, which is authoritative',
    'src/ledger/invariants.ts:checkInv7',
    'src/ledger/ledger.ts',
    'FULL',
  ),
  entry(
    'INV-8',
    'PRESENCE',
    40,
    'every principal has exactly 3 hands; hands are never destroyed, a lost hand is RECOVERING',
    'src/world/invariants.ts:checkInv8',
    'src/world/state.ts',
    'FULL',
  ),
  entry(
    'INV-9',
    'PRESENCE',
    40,
    'every hand is in exactly one state and fills at most one venture role',
    'src/world/invariants.ts:checkInv9',
    'src/world/hands.ts',
    'PARTIAL',
    'the role half needs RoleFills from venture_role.filled_by_hand_id, and no venture module writes that table ' +
      'yet; with the default NO_ROLE_FILLS the multiplicity clause is vacuous, so InvariantInputs.roleFills ' +
      'must be supplied by the tick loop for this to bite',
  ),
  entry(
    'INV-10',
    'PRESENCE',
    40,
    "a hand's in_transit_eta agrees with its origin, destination and the gate transit table",
    'src/world/invariants.ts:checkInv10',
    'src/world/movement.ts',
    'FULL',
  ),
  entry(
    'INV-11',
    'RECORD',
    30,
    'seq_in_tick is dense and gapless within each tick',
    'src/events/invariants.ts:seqDensityViolations',
    'src/events/ledger.ts',
    'FULL',
  ),
  entry(
    'INV-12',
    'RECORD',
    30,
    'no parent_event_id from a later tick; no cycle in the causality graph',
    'src/events/invariants.ts:causalityViolations',
    'src/events/ledger.ts',
    'FULL',
  ),
  entry(
    'INV-13',
    'RECORD',
    30,
    'every PARTIES event has >=2 audience rows and every SENSED event >=1; every tier ceiling holds',
    'src/events/invariants.ts:fanOutViolations',
    'src/events/ledger.ts',
    'FULL',
  ),
  entry(
    'INV-14',
    'RECORD',
    30,
    'visibility is monotonic: nothing already public becomes private, declassify_at never moves earlier',
    'src/events/invariants.ts:monotonicityViolations',
    'src/events/ledger.ts',
    'FULL',
  ),
  entry(
    'INV-15',
    'RECORD',
    30,
    'rules_version is pinned at acceptance and never rewritten',
    'src/events/invariants.ts:recordIntegrityViolations',
    'src/events/ledger.ts',
    'FULL',
  ),
  entry(
    'INV-16',
    'RECORD',
    30,
    'the event table admits no UPDATE and no DELETE',
    'src/events/invariants.ts:appendOnlySurfaceViolations',
    'src/events/ledger.ts',
    'PARTIAL',
    'the in-process half is complete (deep-frozen rows plus a reflective scan for a write path). The database ' +
      'half lives in src/db/migrate.ts as a REVOKE and is only exercised against a live Postgres, which this ' +
      'aggregate cannot reach; AX-A5-1 must run in CI separately',
  ),
  entry(
    'INV-17',
    'PROMISES',
    0,
    'every default event carries an attributable cause: the event id of the loss, missed delivery, or elapsed window',
    'src/invariants/attribution.ts:checkInv17',
    'src/invariants/attribution.ts',
    'PARTIAL',
    'the register, the record-level parent check and the two-mode audit are complete, but the only producer of ' +
      'default events today is the audit model in src/invariants/audit.ts. When a venture module records a real ' +
      'default it must go through DefaultRegister.attribute or this check has nothing to compare against',
  ),
  entry(
    'INV-18',
    'PROMISES',
    1,
    'between freeze and settlement, zero events touch any object in the settlement set',
    'src/invariants/promises.ts:checkInv18',
    null,
    'PARTIAL',
    'complete over a supplied SettlementSet. Note that FREEZE_TICKS = 1 makes the freeze tick and the settlement ' +
      'tick the same tick, so the protected interval is empty in wall time and the check reduces to the ' +
      'within-tick seq boundary (settlementSeqFrom). Scar #6 wants a wider freeze or that boundary made explicit ' +
      'in the tick loop',
  ),
  entry(
    'INV-19',
    'PROMISES',
    1,
    'at settlement, acted_on_state_version matches the state the parties acted on, or the tick halts',
    'src/invariants/promises.ts:checkInv19',
    null,
    'PARTIAL',
    'the comparison is complete; both sides of it (pinned versus observed inputs hash and state version) must be ' +
      'supplied by the venture module, which does not exist yet',
  ),
  entry(
    'INV-20',
    'PROMISES',
    1,
    'every seal has exactly one verdict, scoped to its own reckoning index, evaluated once',
    'src/seal/invariants.ts:checkInv20',
    'src/seal/book.ts',
    'FULL',
  ),
  entry(
    'INV-21',
    'PROMISES',
    1,
    'standing changed only via elective-honoured settlement, default, contradicted seal, or scheduled decay',
    'src/seal/standing.ts:checkInv21 (per batch) + src/invariants/promises.ts:checkStandingJournal (history)',
    'src/seal/standing.ts',
    'PARTIAL',
    'two complementary halves, both wired. The per-batch half needs before/after rows and the causes claimed; ' +
      'the history half needs a standing journal that only the audit model writes today. Until a venture ' +
      'settlement writes real ELECTIVE_HONOURED rows, the anti-farm clause (scar #9) is exercised only by the audit',
  ),
  entry(
    'INV-22',
    'AUTHORITY',
    50,
    "no grant's headroom is negative; delegate spends never exceed its limits, even concurrently",
    'src/invariants/authority.ts:checkInv22',
    null,
    'PARTIAL',
    'complete over a supplied grant list and spend journal, including recomputation from the journal (the only ' +
      'way the concurrency clause is checkable). No office/grant module writes these yet',
  ),
  entry(
    'INV-23',
    'AUTHORITY',
    50,
    'no grant chain cycle; no principal transitively its own delegate; no delegate is counterparty to its own deal',
    'src/invariants/authority.ts:checkInv23',
    null,
    'PARTIAL',
    'the cycle, self-delegation and depth clauses are complete over a supplied grant list. The counterparty clause ' +
      'needs the signed-deal journal and is only checked for the deals supplied',
  ),
  entry(
    'INV-24',
    'CROWD',
    60,
    'Levy assessments sum to the constellation total exactly; the newcomer floor applies to every eligible principal',
    'src/invariants/crowd.ts:checkInv24',
    null,
    'PARTIAL',
    'the arithmetic is complete; no Levy module produces assessments yet',
  ),
  entry(
    'INV-25',
    'CROWD',
    60,
    'every principal appears in >=1 docket row per Reckoning — the anti-quiet invariant',
    'src/invariants/crowd.ts:checkInv25',
    null,
    'PARTIAL',
    'complete over a supplied docket; no docket projection exists yet. TESTING.md §3 names this the invariant ' +
      'most likely to quietly stop being true, so it is the one to wire first',
  ),
  entry(
    'INV-26',
    'CROWD',
    60,
    'every array in every serialized structure is within its declared cap',
    'src/invariants/crowd.ts:checkInv26',
    null,
    'PARTIAL',
    'the walker is complete and treats an undeclared array as a violation, but it only sees the structures handed ' +
      'to it. Nothing yet enumerates every serialized structure in the engine, so coverage is per-call',
  ),
];

const BY_ID: ReadonlyMap<string, InvariantEntry> = new Map(INVARIANTS.map((e) => [e.id, e]));

export function invariant(id: string): InvariantEntry | undefined {
  return BY_ID.get(id);
}

/**
 * Failure ids that are not invariants but still stop the world, with their rank.
 *
 * `TICK-TORN` is the only thing in this codebase that outranks INV-17. INV-17 is a
 * permanent libel of one principal; a torn commit is "a permanent silent imbalance
 * in an append-only ledger, which is unrecoverable by construction" (SPEC §15.3) —
 * every promise in the world, not one. Both name the tick, which is §3's word for
 * the horizon, used for exactly that.
 */
const EXTRA_RANKS: ReadonlyMap<string, number> = new Map([
  ['TICK-TORN', -1],
  ['TICK-STAGE', 20],
]);

/**
 * Report order for a violation id. Lower is more severe.
 *
 * `core/types.ts:InvariantViolation.severity` has two values, `HALT | WARN`, and
 * adding a third would be a change to the contract every module already imports.
 * So "INV-17 is the highest-severity check in the codebase" is expressed as an
 * *ordering* over HALTs rather than as a third severity level: the halt report
 * leads with rank 0, and an operator reading the top line of a pause record is
 * reading the worst thing that happened.
 */
export function severityRank(id: string): number {
  return BY_ID.get(id)?.rank ?? EXTRA_RANKS.get(id) ?? 99;
}

/**
 * Sort violations for an operator: most severe first, then by id, then by the
 * message. Deterministic to the last field — a pause record is published, and a
 * published list whose order depends on Map iteration is a diff that lies.
 */
export function rankViolations(
  violations: readonly InvariantViolation[],
): readonly InvariantViolation[] {
  return [...violations].sort(
    (a, b) =>
      severityRank(a.id) - severityRank(b.id) ||
      cmp(a.id, b.id) ||
      a.tick - b.tick ||
      cmp(a.message, b.message),
  );
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A HALT-severity violation. The tick aborts; the world PAUSES (SPEC §15.2). */
export function halt(id: string, tick: number, message: string): InvariantViolation {
  return { id, message, tick, severity: 'HALT' };
}

/**
 * A WARN-severity violation. Recorded, does not stop the tick.
 *
 * Used only where stopping the world would be the *worse* outcome — never for an
 * invariant TESTING.md §3 lists, all of which are HALTs. A WARN that should have
 * been a HALT is how a broken tick gets published.
 */
export function warn(id: string, tick: number, message: string): InvariantViolation {
  return { id, message, tick, severity: 'WARN' };
}

/** Ids that stop the tick. Empty means the tick may commit. */
export function halting(violations: readonly InvariantViolation[]): readonly InvariantViolation[] {
  return violations.filter((v) => v.severity === 'HALT');
}
