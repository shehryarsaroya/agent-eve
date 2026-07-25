/**
 * `E2E-12` — the false-default construction, and the false-default audit in **both**
 * modes.
 *
 * > `E2E-12` **The false-default construction.** A rival deliberately drains a
 * > counterparty's committed account during the commitment window. Assert the hard freeze
 * > prevents it and **no default is recorded**. Then assert the same attempt with the
 * > freeze disabled *does* fabricate one — proving the test can detect the bug it exists
 * > for. — TESTING.md §6
 *
 * > **Mode A, hazards off:** an all-cooperative simulation must log **zero** defaults.
 * > **Mode B, hazards on:** every logged default must be *attributable*. — SPEC §15.4
 *
 * ## What "prevents it" means here, precisely
 *
 * Two of §15.4's five defences are in play and they fire in different places, so both are
 * asserted separately:
 *
 *   1. **The hard freeze**, as §15.3's input-hash assertion. The driver reads the payer's
 *      balance at the freeze and again at `VERIFY_INPUTS`; a difference means the
 *      settlement would resolve from a state nobody acted on, and it halts **before any
 *      value moves and before any row is appended**. No default is recorded because
 *      nothing is settled.
 *   2. **INV-18**, after the fact. Even with the assertion switched off, the drain's own
 *      event is at the settlement tick with a sequence below the settlement's own, so the
 *      ASSERT phase sees a third party touching the settlement set and the tick never
 *      publishes.
 *
 * The mutation proves the first is doing work: with `disableFreeze` the engine settles
 * anyway and a default really is fabricated against a payer that had the money at the
 * freeze. That default exists in memory and is caught by the second defence before an
 * observer can read it — which is the honest description of what the engine does, and the
 * reason both assertions are here rather than one.
 */

import { describe, expect, it } from 'vitest';
import { minor } from '../../src/core/units.js';
import { storesAccount } from '../../src/ledger/index.js';
import {
  runReckoningAudit,
  verifyEveryDefaultAttributable,
  verifyNoInventedDefault,
} from '../../src/reckoning/index.js';
import { computeClaims, type Election } from '../../src/venture/index.js';
import {
  ALICE,
  BRAM,
  DOV,
  FREEZE_TICK,
  SETTLE_TICK,
  drain,
  fixture,
  freeze,
  goLive,
  makeHaul,
  planFor,
  run,
  wage,
} from './fixture.js';


const PROCEEDS = minor(600);
const STORES = minor(2_500);

/**
 * A world in which the payer **can** afford its elective parts at the freeze and
 * **cannot** after a drain.
 *
 * Both halves of that sentence are load-bearing, and getting the inequality wrong makes
 * the mutation prove nothing — so the arithmetic is stated rather than tuned:
 *
 * ```text
 * escrowed 100 + elective 1200, on each of two wage roles
 *   -> elective total                     E = 2400
 *   -> escrow holds 200 funded + 600 realised, pays 200, returns
 *      the rest to the payer BEFORE the elective parts are paid   R =  600
 *   -> the payer's stores at the freeze    S = 2500 - 200        =  2300
 * ```
 *
 * `R < E <= S + R`. The payer can pay tonight, and cannot once its stores are gone. The
 * first version of this fixture had `R > E` — the escrow refunded the payer more than it
 * owed, the drain changed nothing, and the mutation silently demonstrated a *working*
 * freeze by producing no default at all.
 *
 * Two **wage** roles rather than a wage and a share, because a wage is a senior fixed
 * claim: the elective total is then a figure that does not move with the proceeds, which
 * is what makes the inequality above stable rather than a coincidence of one yield.
 */
function draining() {
  const f = fixture(STORES);
  const haul = makeHaul(f, {
    creator: DOV,
    carrier: wage(100, 1_200),
    escort: wage(100, 1_200),
  });
  goLive(f, haul, [ALICE, BRAM], PROCEEDS);
  const claims = computeClaims(haul, PROCEEDS);
  const elections = new Map<number, Election>();
  for (const r of claims.roles) if (r.electiveDue > 0) elections.set(r.roleIndex, r.electiveDue);
  return { f, haul, elections, claims };
}

describe('E2E-12 — the hard freeze prevents the fabrication', () => {
  it('with nothing draining, the payer honours everything and no default is recorded', () => {
    const { f, haul, elections } = draining();
    const outcome = run(f, freeze(f, [planFor(haul, { proceeds: PROCEEDS, elections })]));

    expect(outcome.transaction.committed).toBe(true);
    expect(outcome.defaults).toEqual([]);
    expect(f.standing.row(DOV).defaults).toBe(0);
  });

  it('a rival drains the payer between the freeze and the settlement: the tick halts and NO default is recorded', () => {
    const { f, haul, elections } = draining();
    const frozen = freeze(f, [planFor(haul, { proceeds: PROCEEDS, elections })]);

    // The rival's move, exactly §15.4's sentence: "I commit to pay from account X; during
    // the window my convoy is raided and X is drained."
    drain(f, { from: storesAccount(DOV), tick: SETTLE_TICK, venture: haul.id });

    const outcome = run(f, frozen);

    expect(outcome.transaction.committed).toBe(false);
    // It halts at VERIFY_INPUTS — before the money moves, which is why nothing is
    // recorded rather than recorded and then retracted (INV-16 admits no retraction).
    expect(outcome.transaction.failedAt).toBe('VERIFY_INPUTS');
    expect(outcome.transaction.torn).toBe(false);
    expect(outcome.transaction.applied).toEqual([]);

    // The whole point of E2E-12: no accusation anywhere.
    expect(outcome.defaults).toEqual([]);
    expect(f.register.size).toBe(0);
    expect(f.standing.row(DOV).defaults).toBe(0);
    expect(f.standing.changes()).toEqual([]);
    // And nothing reached the append-only record at the settlement tick.
    expect(f.events.eventsAtTick(SETTLE_TICK).filter((r) => r.event.kind.startsWith('venture.'))).toEqual(
      [],
    );

    // The operator gets the account and the amount, not a hash mismatch.
    const reason = outcome.transaction.haltRecord?.reason ?? '';
    expect(reason).toContain(storesAccount(DOV));
    expect(reason).toContain('a broken promise the payer could have kept');
  });

  it('WITH THE FREEZE DISABLED the same attempt fabricates a default — the test can detect its bug', () => {
    const { f, haul, elections } = draining();
    const frozen = freeze(f, [planFor(haul, { proceeds: PROCEEDS, elections })]);
    drain(f, { from: storesAccount(DOV), tick: SETTLE_TICK, venture: haul.id });

    const outcome = run(f, frozen, { disableFreeze: true });

    // The fabrication. A payer that could have paid at the freeze is recorded as having
    // broken a promise, for money a rival took after the settlement set was hashed.
    expect(outcome.defaults.length).toBeGreaterThan(0);
    expect(outcome.defaults.every((d) => d.promisor === DOV)).toBe(true);
    expect(outcome.settlements[0]?.terminalState).toBe('DEFAULTED');
    // The faults the assertion would have raised are published rather than swallowed.
    expect(outcome.bypassedFreezeFaults.length).toBeGreaterThan(0);

    // …and the second defence catches it before any observer can read it. INV-18 sees the
    // rival's row inside the freeze, so the tick never publishes.
    expect(outcome.transaction.committed).toBe(false);
    expect(outcome.report?.violations.some((v) => v.id === 'INV-18')).toBe(true);
    expect(f.controller.status).toBe('PAUSED');
    expect(f.controller.publishedTick).toBe(-1);
  });

  it('catches a drain landing INSIDE the freeze interval, not only at the settlement tick', () => {
    // Closes a gap a verifier measured. Every other drain in this suite lands AT the
    // settlement tick, where INV-18 catches it via the within-tick seq boundary
    // (settlementSeqFrom) rather than via the interval. Proof the interval itself was
    // untested: reverting `frozenAtTick` to the settlement tick in
    // src/invariants/audit.ts left all 16 tests in this file green.
    //
    // The interval only exists at all because core/time.ts was fixed — it previously had
    // `inFreeze` and `isSettlementTick` both true at one phase, so "between freeze and
    // settlement" was empty and INV-18 was vacuous in the wired engine. This case is
    // what makes that fix load-bearing rather than tidy.
    const { f, haul, elections } = draining();
    const frozen = freeze(f, [planFor(haul, { proceeds: PROCEEDS, elections })]);
    expect(frozen.settlementTick).toBeGreaterThan(frozen.frozenAtTick);

    // Strictly between the freeze and settlement — the interval, not the boundary.
    drain(f, { from: storesAccount(DOV), tick: FREEZE_TICK, venture: haul.id });

    const outcome = run(f, frozen, { disableFreeze: true });

    // Still fabricates, so the scenario is the real one and not a no-op…
    expect(outcome.defaults.length).toBeGreaterThan(0);
    expect(outcome.defaults.every((d) => d.promisor === DOV)).toBe(true);
    // …and INV-18 still stops it publishing, this time on the strength of the interval.
    expect(outcome.transaction.committed).toBe(false);
    expect(outcome.report?.violations.some((v) => v.id === 'INV-18')).toBe(true);
    expect(f.controller.publishedTick).toBe(-1);
  });
});

describe('the false-default audit — Mode A, hazards off, zero defaults', () => {
  const result = runReckoningAudit({ seed: 'reckoning-audit::mode-a', hazards: false, reckonings: 2 });

  it('logs zero defaults over the real settlement waterfall', () => {
    expect(result.defaults).toEqual([]);
    expect(result.recordedLoss).toBe(0);
  });

  it('is not vacuous: every venture actually settled', () => {
    expect(result.ventures).toBeGreaterThan(0);
    expect(result.settled).toBe(result.ventures);
    expect(result.deferred).toBe(0);
    expect(result.raids).toBe(0);
  });

  it('every Reckoning committed and broke no invariant', () => {
    expect(result.uncommitted).toEqual([]);
    expect(result.violations).toEqual([]);
    for (const outcome of result.outcomes) {
      expect(outcome.transaction.committed).toBe(true);
      expect(outcome.deedSetFaults).toEqual([]);
      expect(outcome.seals?.deferred).toEqual([]);
      // A witnessed Reckoning marks every seal it holds; nothing here is unmarked.
      expect(outcome.seals?.verdicts.length).toBeGreaterThan(0);
    }
  });

  it('verifies', () => {
    const verdict = verifyNoInventedDefault(result);
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('is deterministic in the seed', () => {
    const again = runReckoningAudit({
      seed: 'reckoning-audit::mode-a',
      hazards: false,
      reckonings: 2,
    });
    expect(again.stateHashes).toEqual(result.stateHashes);
  });

  it('CATCHES the fabrication the freeze exists to prevent', () => {
    // The mutation, through the engine's own code path rather than by writing a default
    // event by hand: a defence that cannot be shown to bite is indistinguishable from no
    // defence at all.
    const broken = runReckoningAudit({
      seed: 'reckoning-audit::mode-a',
      hazards: false,
      reckonings: 1,
      disableFreeze: true,
    });
    expect(broken.defaults.length).toBeGreaterThan(0);
    const verdict = verifyNoInventedDefault(broken);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(' ')).toContain('accusing an innocent agent');
  });
});

describe('the false-default audit — Mode B, hazards on, every default attributable', () => {
  const result = runReckoningAudit({ seed: 'reckoning-audit::mode-b', hazards: true, reckonings: 2 });

  it('exercised the drained-account path, or it proved nothing', () => {
    expect(result.raids).toBeGreaterThan(0);
    // The escrowed shortfall: value destroyed, and never a default (§10.2, PROP-L3).
    expect(result.recordedLoss).toBeGreaterThan(0);
  });

  it('logs some defaults — zero is not assertable here', () => {
    expect(result.defaults.length).toBeGreaterThan(0);
  });

  it('every default carries the event id that caused it, as a column and in the register', () => {
    for (const d of result.defaults) {
      expect(d.causeEventId.length).toBeGreaterThan(0);
      // A raid destroyed the value and the promise broke with it. Not ELAPSED_WINDOW: the
      // record distinguishes "would not pay" from "could not, because of this event".
      expect(d.cause).toBe('LOSS');
      const row = result.world.events.get(d.defaultEventId);
      expect(row).not.toBeNull();
      expect(row?.event.parentEventId).toBe(d.causeEventId);
      const cause = result.world.events.get(d.causeEventId);
      expect(cause).not.toBeNull();
      expect(cause?.event.kind).toBe('raid.struck');
    }
  });

  it('every Reckoning committed and broke no invariant', () => {
    expect(result.uncommitted).toEqual([]);
    expect(result.violations).toEqual([]);
  });

  it('verifies', () => {
    const verdict = verifyEveryDefaultAttributable(result);
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('a different seed fires hazards differently — the world really is driven by Rng', () => {
    const other = runReckoningAudit({
      seed: 'reckoning-audit::mode-b::other-2',
      hazards: true,
      reckonings: 2,
    });
    // Both must still verify; what changes is which ventures were hit.
    expect(verifyEveryDefaultAttributable(other).ok).toBe(true);
    expect(other.raids).toBeGreaterThan(0);
  });

  it('the contradicted seal costs standing, and the charge cites a published row', () => {
    let contradicted = 0;
    for (const outcome of result.outcomes) {
      for (const v of outcome.seals?.verdicts ?? []) {
        if (v.verdict === 'CONTRADICTED') contradicted += 1;
      }
    }
    // A raided venture delivers nothing, so its creator's sealed band is contradicted —
    // the say-do gap doing its job on the night the promise broke.
    expect(contradicted).toBeGreaterThan(0);
    const charges = result.world.standing
      .changes()
      .filter((c) => c.cause === 'CONTRADICTED_SEAL');
    expect(charges.length).toBe(contradicted);
    for (const charge of charges) {
      expect(result.world.events.get(charge.eventId)?.event.kind).toBe('SEAL_RESOLVED');
    }
  });
});

describe('the two modes catch different bugs, which is why there are two', () => {
  it("Mode B's attribution clause passes on the very default Mode A rejects", () => {
    const broken = runReckoningAudit({
      seed: 'reckoning-audit::mode-a',
      hazards: false,
      reckonings: 1,
      disableFreeze: true,
    });
    // The fabricated default is perfectly attributable — it cites the settlement that
    // produced it — so an attribution-only audit would report a clean world. That is the
    // whole argument for running two modes (SPEC §15.4).
    for (const d of broken.defaults) expect(d.causeEventId.length).toBeGreaterThan(0);
    expect(verifyNoInventedDefault(broken).ok).toBe(false);
  });
});
