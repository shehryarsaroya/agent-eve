/**
 * `assertInvariants(world, tick)` — the one call the ASSERT phase makes.
 *
 * SPEC §15.2's tick ends `… -> DERIVE -> **ASSERT** -> COMMIT -> WAKE`, and
 * TESTING.md §3 says the 26 invariants "are not tests that run in CI; they are
 * tests that run *in production, forever*." Each wave-1 module already checks the
 * invariants it can see. This is the thing none of them can be: **one pass over
 * all 26, with an honest account of which ones actually ran.**
 *
 * ## Why the report carries `skipped`
 *
 * Six of the 26 read state no module writes yet — seals, standing, grants, the
 * Levy, the docket, settlements. Their checks are complete; their inputs are
 * absent. A pass that returned `[]` in that situation would be indistinguishable
 * from a pass that verified everything, and that is the exact failure wave 1's
 * verifier found in miniature (INV-2 and INV-7 had nine call sites and no test that
 * they ever fire). So {@link checkInvariants} returns `checked` and `skipped`
 * alongside `violations`, `skipped` states *why*, and `requireAll` turns every skip
 * into a HALT for the tick loop, which has no excuse for missing inputs.
 *
 * ## One call per tick, not two
 *
 * `assertEventInvariants` advances INV-14's before-and-after snapshot and clears
 * the ledger's touched set as a side effect. Calling this function twice in one tick
 * therefore makes the second pass blind to a visibility regression in the first. It
 * is called once, from ASSERT, and that is a contract not a convention.
 */

import type { Grant, InvariantViolation, PrincipalId, Standing } from '../core/types.js';
import type { CanonicalValue } from '../core/canonical.js';
import type { Minor } from '../core/units.js';
import { assertEventInvariants, type AssertScope } from '../events/invariants.js';
import type { EventLedger } from '../events/ledger.js';
import {
  checkInv1,
  checkInv2,
  checkInv3,
  checkInv4,
  checkInv5,
  checkInv7,
} from '../ledger/invariants.js';
import type { Ledger } from '../ledger/ledger.js';
import type { ObligationBook } from '../ledger/encumbrance.js';
import { assertPayoutsExact, type WaterfallResult } from '../ledger/waterfall.js';
import type { SealBook } from '../seal/book.js';
import { checkInv20 as checkSealVerdictScope } from '../seal/invariants.js';
import { checkInv21 as checkStandingBatch, type StandingCause } from '../seal/standing.js';
import { checkInv10, checkInv8, checkInv9, type RoleFills } from '../world/invariants.js';
import type { WorldState } from '../world/state.js';
import {
  checkInv22,
  checkInv23,
  type CustodyRow,
  type GrantRelease,
  type GrantSpend,
  type SignedDeal,
} from './authority.js';
import { checkInv17, type DefaultRegister } from './attribution.js';
import {
  checkInv24,
  checkInv25,
  checkInv26,
  type ArrayCap,
  type DocketRow,
  type Inv24Inputs,
} from './crowd.js';
import {
  checkInv18,
  checkInv19,
  checkStandingJournal,
  checkUnjudgedSeals,
  type SettlementItem,
  type SettlementSet,
  type StandingChange,
} from './promises.js';
import { INVARIANTS, halt, halting, rankViolations } from './registry.js';

/** One settled obligation's payout set, for INV-6. */
export interface SettledPayouts {
  readonly obligation: string;
  readonly proceeds: Minor;
  readonly result: WaterfallResult;
}

/** A serialized structure with its declared caps, for INV-26. */
export interface CappedStructure {
  readonly label: string;
  readonly value: CanonicalValue;
  readonly caps: readonly ArrayCap[];
}

/** One principal's standing before and after this batch, with the causes claimed. */
export interface StandingDiff {
  readonly prev: Standing;
  readonly next: Standing;
  readonly causes: readonly StandingCause[];
}

/**
 * Everything the ASSERT phase can see, in one bag.
 *
 * Every field is optional and every absence is *reported*, which is what keeps
 * this from becoming a checklist that passes on an empty object. The tick loop
 * passes `requireAll: true` and therefore has to fill it in.
 */
export interface InvariantInputs {
  // ── value ────────────────────────────────────────────────────────────────
  readonly ledger?: Ledger;
  /** INV-4 needs to know which obligations are live. */
  readonly obligations?: ObligationBook;
  /** INV-5's second cache: the EXPOSURE the observation layer actually served. */
  readonly servedExposure?: ReadonlyMap<PrincipalId, Minor>;
  /** INV-6 is a property of one settlement, so it is checked per settlement. */
  readonly settlements?: readonly SettledPayouts[];

  // ── presence ─────────────────────────────────────────────────────────────
  readonly presence?: WorldState;
  /** INV-9's role half. Without it the multiplicity clause is vacuous. */
  readonly roleFills?: RoleFills;

  // ── the record ───────────────────────────────────────────────────────────
  readonly events?: EventLedger;
  /** `TICK` checks the tick just written; `FULL` walks the ledger (CI, replay). */
  readonly eventScope?: AssertScope;

  // ── promises: the A5' group ──────────────────────────────────────────────
  readonly defaults?: DefaultRegister;
  readonly settlementSet?: SettlementSet;
  readonly settlementItems?: readonly SettlementItem[];
  /** INV-20 lives in `src/seal/invariants.ts`, over the book that counts evaluations. */
  readonly sealBook?: SealBook;
  readonly standingChanges?: readonly StandingChange[];
  readonly standings?: readonly Standing[];
  /**
   * INV-21's per-batch half: `src/seal/standing.ts:checkInv21` over a before row, an
   * after row and the causes the tick claims. Complementary to the journal check —
   * one sees this batch, the other sees history.
   */
  readonly standingDiffs?: readonly StandingDiff[];

  // ── authority ────────────────────────────────────────────────────────────
  readonly grants?: readonly Grant[];
  readonly grantSpends?: readonly GrantSpend[];
  /**
   * ★ INV-22's release clause: every draw given back because its obligation can no longer be owed.
   *
   * Reported as a `skip` when absent, on INV-25's discipline — a journal-vs-cache check run over the
   * spends alone would net a released grant *higher* than its row and halt a healthy world, so an
   * omitted release journal is a hole rather than a quiet default.
   */
  readonly grantReleases?: readonly GrantRelease[];
  readonly deals?: readonly SignedDeal[];
  /** INV-22's custody clause: every DOSSIER cut, and the clearance that authorised it. */
  readonly custody?: readonly CustodyRow[];

  // ── the clock and the crowd ──────────────────────────────────────────────
  readonly levy?: Inv24Inputs;
  readonly docket?: readonly DocketRow[];
  /** INV-25's roll. Defaults to `presence.principalOrder` when presence is given. */
  readonly principals?: readonly PrincipalId[];
  readonly atReckoning?: number;
  readonly capped?: readonly CappedStructure[];

  /**
   * Turn every skipped check into a HALT. The tick loop sets this; a fixture
   * exercising one group does not.
   */
  readonly requireAll?: boolean;
}

export interface SkippedCheck {
  readonly id: string;
  readonly reason: string;
  /**
   * True when nothing the caller could supply would make this clause runnable
   * in-process, so `requireAll` must not escalate it.
   *
   * Exactly one clause is like this today: INV-16's database half is a `REVOKE` in
   * `src/db/migrate.ts` and only AX-A5-1 against a live Postgres can exercise it.
   * Without this flag `requireAll: true` reported that skip as a HALT on a *healthy*
   * world with every input supplied — so the tick loop could never turn the honesty
   * switch on, and the anti-flattery mechanism defeated itself. A world that halts on
   * a state it created is the same class of bug as a false default (SPEC §15.4).
   */
  readonly outOfProcess?: true;
}

export interface InvariantReport {
  readonly tick: number;
  /** Most severe first. INV-17 leads, always (see `registry.severityRank`). */
  readonly violations: readonly InvariantViolation[];
  readonly checked: readonly string[];
  readonly skipped: readonly SkippedCheck[];
}

/**
 * Thrown by {@link assertInvariants}. The tick aborts and the world PAUSES.
 *
 * Carries the whole report, not the first failure: an operator replaying a failed
 * tick wants everything that was wrong, and `skipped` tells them whether the pass
 * that failed was even looking at the whole world.
 */
export class InvariantHalt extends Error {
  constructor(readonly report: InvariantReport) {
    super(
      `invariants failed at tick ${report.tick}: ` +
        report.violations.map((v) => `${v.id} ${v.message}`).join(' | '),
    );
    this.name = 'InvariantHalt';
  }
}

/**
 * Run every invariant whose inputs are present. Returns; never throws for a
 * violation.
 *
 * The one thing that *can* throw out of here is a check whose own inputs are
 * malformed beyond the point of a structured answer — a payload nested past the
 * scan depth, for instance. Those are converted to HALT violations below rather
 * than escaping, because the caller's contract is "you get a report".
 */
export function checkInvariants(world: InvariantInputs, tick: number): InvariantReport {
  const violations: InvariantViolation[] = [];
  const checked: string[] = [];
  const skipped: SkippedCheck[] = [];

  const ran = (id: string): void => {
    checked.push(id);
  };
  const skip = (id: string, reason: string): void => {
    skipped.push({ id, reason });
  };
  /** A clause no caller can make runnable here. Reported, never escalated. */
  const skipOutOfProcess = (id: string, reason: string): void => {
    skipped.push({ id, reason, outOfProcess: true });
  };
  const guarded = (id: string, run: () => readonly InvariantViolation[]): void => {
    try {
      violations.push(...run());
    } catch (e) {
      // A check that throws is still a failed check. Swallowing it would publish
      // the tick; letting it escape would lose every other violation in the pass.
      violations.push(
        halt(id, tick, `check threw rather than reporting: ${errorText(e)}`),
      );
    }
    ran(id);
  };

  // ── value: INV-1..7 ──────────────────────────────────────────────────────
  const { ledger } = world;
  if (ledger === undefined) {
    for (const id of ['INV-1', 'INV-2', 'INV-3', 'INV-5', 'INV-7']) {
      skip(id, 'no ledger supplied');
    }
    skip('INV-4', 'no ledger supplied');
  } else {
    guarded('INV-1', () => checkInv1(ledger, tick));
    guarded('INV-2', () => checkInv2(ledger, tick));
    guarded('INV-3', () => checkInv3(ledger, tick));
    const obligations = world.obligations;
    if (obligations === undefined) {
      // Deliberately a skip and not a pass. `emptyObligationBook()` would make
      // every open lock an orphan and halt a healthy world — a false halt is the
      // same class of bug as a false default (SPEC §15.4).
      skip('INV-4', 'no obligation book supplied; every lock would read as an orphan');
    } else {
      guarded('INV-4', () => checkInv4(ledger, { tick, obligations }));
    }
    guarded('INV-5', () => checkInv5(ledger, tick, world.servedExposure ?? null));
    if (world.servedExposure === undefined) {
      skip('INV-5', "the 'served' half was not supplied; only the book's own cache was compared");
    }
    guarded('INV-7', () => checkInv7(ledger, tick));
  }

  const settlements = world.settlements;
  if (settlements === undefined) {
    skip('INV-6', 'no settlements supplied; INV-6 is a property of one settlement');
  } else {
    guarded('INV-6', () => checkInv6(settlements, tick));
  }

  // ── presence: INV-8..10 ──────────────────────────────────────────────────
  const presence = world.presence;
  if (presence === undefined) {
    for (const id of ['INV-8', 'INV-9', 'INV-10']) skip(id, 'no presence tables supplied');
  } else {
    guarded('INV-8', () => checkInv8(presence, tick));
    guarded('INV-9', () => checkInv9(presence, tick, world.roleFills));
    if (world.roleFills === undefined) {
      skip('INV-9', 'no RoleFills supplied; the "at most one role" clause did not run');
    }
    guarded('INV-10', () => checkInv10(presence, tick));
  }

  // ── the record: INV-11..16 ───────────────────────────────────────────────
  const events = world.events;
  if (events === undefined) {
    for (const id of ['INV-11', 'INV-12', 'INV-13', 'INV-14', 'INV-15', 'INV-16']) {
      skip(id, 'no event ledger supplied');
    }
  } else {
    // One call, five ids. The side effect on INV-14's snapshot is why it is one
    // call and why this function must run exactly once per tick.
    const scope: AssertScope = world.eventScope ?? 'TICK';
    let recordViolations: readonly InvariantViolation[] = [];
    try {
      recordViolations = assertEventInvariants(events, { tick, scope });
    } catch (e) {
      recordViolations = [halt('INV-16', tick, `record pass threw: ${errorText(e)}`)];
    }
    violations.push(...recordViolations);
    for (const id of ['INV-11', 'INV-12', 'INV-13', 'INV-14', 'INV-15', 'INV-16']) ran(id);
    skipOutOfProcess(
      'INV-16',
      'the database half (REVOKE UPDATE/DELETE, AX-A5-1) needs a live Postgres and cannot run in-process',
    );
  }

  // ── promises: INV-17..21 ─────────────────────────────────────────────────
  const defaults = world.defaults;
  if (events === undefined || defaults === undefined) {
    skip(
      'INV-17',
      events === undefined ? 'no event ledger supplied' : 'no DefaultRegister supplied',
    );
  } else {
    const scope: AssertScope = world.eventScope ?? 'TICK';
    guarded('INV-17', () =>
      checkInv17(events, defaults, tick, {
        scope: scope === 'FULL' ? 'FULL' : { tick },
      }),
    );
  }

  const settlementSet = world.settlementSet;
  if (events === undefined || settlementSet === undefined) {
    skip('INV-18', settlementSet === undefined ? 'no settlement set supplied' : 'no event ledger supplied');
  } else {
    guarded('INV-18', () => checkInv18(events, settlementSet, tick));
  }

  const settlementItems = world.settlementItems;
  if (settlementItems === undefined) {
    skip('INV-19', 'no settlement items supplied');
  } else {
    guarded('INV-19', () => checkInv19(settlementItems, tick));
  }

  const sealBook = world.sealBook;
  if (sealBook === undefined) {
    skip('INV-20', 'no seal book supplied');
  } else {
    // The seal module's own checker, not a second implementation of the rule —
    // plus the one clause it structurally cannot see (a Reckoning that never ran).
    guarded('INV-20', () => [
      ...checkSealVerdictScope(sealBook, tick),
      ...checkUnjudgedSeals(sealBook, tick),
    ]);
  }

  const standingChanges = world.standingChanges;
  const standings = world.standings;
  if (standingChanges === undefined || standings === undefined || events === undefined || defaults === undefined) {
    skip('INV-21', 'no standing journal, standing rows, event ledger and DefaultRegister together');
  } else {
    guarded('INV-21', () =>
      checkStandingJournal({ changes: standingChanges, standings, events, defaults }, tick),
    );
  }
  const standingDiffs = world.standingDiffs;
  if (standingDiffs === undefined) {
    skip('INV-21', "no before/after standing rows supplied; the per-batch half did not run");
  } else {
    guarded('INV-21', () =>
      standingDiffs.flatMap((d) => checkStandingBatch(d.prev, d.next, d.causes, tick)),
    );
  }

  // ── authority: INV-22..23 ────────────────────────────────────────────────
  const grants = world.grants;
  if (grants === undefined) {
    skip('INV-22', 'no grant table supplied');
    skip('INV-23', 'no grant table supplied');
  } else {
    guarded('INV-22', () =>
      checkInv22(
        grants,
        world.grantSpends ?? [],
        tick,
        world.custody ?? [],
        world.grantReleases ?? [],
      ),
    );
    if (world.grantSpends === undefined) {
      skip('INV-22', 'no spend journal supplied; the concurrency clause did not run');
    }
    if (world.grantReleases === undefined) {
      skip('INV-22', 'no release journal supplied; the give-back clause did not run');
    }
    if (world.custody === undefined) {
      // Named rather than silent, on INV-25's discipline: an invariant reporting green over a
      // subject that cannot occur is indistinguishable from one that is working, and this
      // clause spent its first day exactly there while `grant/dossier.ts` existed unwired.
      skip('INV-22', 'no dossier table supplied; the custody clause did not run');
    }
    guarded('INV-23', () => checkInv23(grants, world.deals ?? [], tick));
    if (world.deals === undefined) {
      skip('INV-23', 'no signed-deal journal supplied; the counterparty clause did not run');
    }
  }

  // ── the clock and the crowd: INV-24..26 ──────────────────────────────────
  const levy = world.levy;
  if (levy === undefined) {
    skip('INV-24', 'no Levy assessments supplied');
  } else {
    guarded('INV-24', () => checkInv24(levy, tick));
  }

  const docket = world.docket;
  const roll = world.principals ?? presence?.principalOrder;
  if (docket === undefined || roll === undefined || world.atReckoning === undefined) {
    skip('INV-25', 'no docket, principal roll and Reckoning index together');
  } else {
    const atReckoning = world.atReckoning;
    guarded('INV-25', () => checkInv25(roll, docket, atReckoning, tick));
  }

  const capped = world.capped;
  if (capped === undefined || capped.length === 0) {
    skip('INV-26', 'no serialized structures supplied; the cap walker only sees what it is handed');
  } else {
    guarded('INV-26', () =>
      capped.flatMap((s) => checkInv26(s.value, s.caps, tick, s.label)),
    );
  }

  if (world.requireAll === true) {
    for (const s of skipped) {
      // An out-of-process clause is reported and not escalated: it is still in
      // `skipped`, so a caller reading the report sees it, but it cannot make a
      // healthy tick unpublishable. Everything else is the caller's missing input.
      if (s.outOfProcess === true) continue;
      violations.push(
        halt(
          s.id,
          tick,
          `not checked: ${s.reason}. The tick loop asserts every invariant; an unchecked invariant is an ` +
            'unpublishable tick',
        ),
      );
    }
  }

  return {
    tick,
    violations: rankViolations(violations),
    checked: [...new Set(checked)].sort(cmpId),
    skipped: [...skipped].sort((a, b) => cmpId(a.id, b.id) || cmpStr(a.reason, b.reason)),
  };
}

/**
 * The ASSERT phase. Throws {@link InvariantHalt} on any HALT-severity violation.
 *
 * Named for SPEC §15.2's `assert_invariants(world)`. Throws rather than returning,
 * because the caller's only correct response is to abort the tick and halt: *never
 * publish a broken tick*, because a ledger that is wrong in public is worse than a
 * ledger that stopped (A5′).
 */
export function assertInvariants(world: InvariantInputs, tick: number): InvariantReport {
  const report = checkInvariants(world, tick);
  if (halting(report.violations).length > 0) throw new InvariantHalt(report);
  return report;
}

/**
 * INV-6, adapted. `assertPayoutsExact` throws a `WaterfallError`; the ASSERT phase
 * needs a structured violation, and the conversion happens here rather than in the
 * waterfall so the settlement path keeps failing loudly at the point of the bug.
 */
export function checkInv6(
  settlements: readonly SettledPayouts[],
  tick: number,
): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const s of [...settlements].sort((a, b) => cmpStr(a.obligation, b.obligation))) {
    try {
      assertPayoutsExact(s.proceeds, s.result);
    } catch (e) {
      out.push(halt('INV-6', tick, `${s.obligation}: ${errorText(e)}`));
    }
  }
  return out;
}

/** Every id in the register, for a caller that wants to assert full coverage. */
export const ALL_INVARIANT_IDS: readonly string[] = INVARIANTS.map((e) => e.id);

/** `INV-7` sorts after `INV-26` under plain string order, so compare the number. */
function cmpId(a: string, b: string): number {
  const na = Number.parseInt(a.replace(/^INV-/, ''), 10);
  const nb = Number.parseInt(b.replace(/^INV-/, ''), 10);
  if (Number.isSafeInteger(na) && Number.isSafeInteger(nb) && na !== nb) return na - nb;
  return cmpStr(a, b);
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Never a stack trace: scar #11 leaked server paths to players through one. */
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
