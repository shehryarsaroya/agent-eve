/**
 * **THE TERRITORIAL LAYER, LIVE — asserted on a world nobody steers.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS FILE EXISTS.** `D23` #4 found sovereignty *anti*-load-bearing and the rent was
 * built to answer it. The rent landed, it renders, and `claimLines` stayed **0** — because
 * nothing in the world ever *chose* the ground. The agent that built the rent wrote it down:
 * *"Tonight made the rent and fuel legible; it did not make anyone want the ground."*
 *
 * Verified against live production at tick 5,274 before this file was written: `claimLines`
 * `len=0`, and all five WORKS reporting `rentBps: 0, rentPaid: 0, rentPerTick: 0,
 * fuelExtracted: 0, fuelPerTick: 0`. One of them had extracted 3,920 units of ore and paid rent
 * to nobody, because nobody owned the ground under it.
 *
 * So the assertions here are deliberately about **outcomes in a running world**, not about
 * branches firing. A test that proves `build {ANCHOR}` was submitted proves the same thing
 * `claimLines: 0` already disproved. What has to become true is:
 *
 *   1. principals leave the Commons at all, and land somewhere better than they left;
 *   2. `claimLines` is **non-empty** — live claims stand;
 *   3. `rent_to` is **non-null for a real tenant**, and goods actually move on it;
 *   4. the Charge gets **paid**, so the claims are not a queue of pending lapses;
 *   5. `fuel` — the good only the Frontier makes — is extracted and **burned into an anchor**;
 *   6. and none of it makes the **Levy** harder, which is the gate that decides whether the
 *      branches were right. A5 has no opt-out: breaches this cast produces stay on the record.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast, type CastMember } from '../../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { ANCHOR_FUEL_BY_TIER, CHARGE_BY_TIER, CLAIM_BOND_MINOR } from '../../src/sovereignty/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { ALLOY_ANCHOR_QTY, FUEL_YIELD_PER_TICK } from '../../src/works/params.js';
import { holdingOf, tierOf } from '../../src/world/index.js';
import { giveAlloy } from '../works/alloy-fixture.js';

/** The four seeds the balance gate was run on. Fixed, so the numbers below are reproducible. */
export const GATE_SEEDS = ['gate-a', 'gate-b', 'gate-c', 'gate-d'] as const;

interface Run {
  readonly runtime: Runtime;
  readonly cast: HeuristicCast;
  /** Accepted actions, by verb. */
  readonly verbs: Map<string, number>;
  /** Accepted actions, by `principal|verb`, so a per-member claim is assertable. */
  readonly byMember: Map<string, number>;
  /** Refusals, by `verb invariant`. AGT-S3: a repeat here is a rules-surface defect. */
  readonly refusals: Map<string, number>;
}

/**
 * Run a world nobody steers, and tally what it actually did.
 *
 * Tallied from `engine.log` per tick rather than from the cast's own return, because the cast
 * returning an action proves only that it asked: `ActionLog` retention is bounded, so the tally
 * has to happen inside the loop.
 */
export function play(seed: string, ticks: number, size = 8, supplyAlloy = false): Run {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size });
  cast.seat(seed);
  const verbs = new Map<string, number>();
  const byMember = new Map<string, number>();
  const refusals = new Map<string, number>();
  for (let n = 0; n < ticks; n += 1) {
    if (supplyAlloy) standAlloyAtEverySeat(runtime, cast);
    for (const action of cast.decide(runtime.engine.tick + 1, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    for (const entry of runtime.engine.log.forTick(report.tick)) {
      if (entry.outcome === 'REFUSED' && entry.rejection !== null) {
        const key = `${entry.verb} ${entry.rejection.invariant}`;
        refusals.set(key, (refusals.get(key) ?? 0) + 1);
        continue;
      }
      verbs.set(entry.verb, (verbs.get(entry.verb) ?? 0) + 1);
      const who = `${String(entry.principal)}|${entry.verb}`;
      byMember.set(who, (byMember.get(who) ?? 0) + 1);
    }
    expect(
      report.halted,
      `halted at ${String(report.tick)}: ${report.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`,
    ).toBe(false);
  }
  return { runtime, cast, verbs, byMember, refusals };
}

/**
 * Stand one anchor's worth of alloy at every member's seat. **Off by default, on for one test.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY A CAST TEST NEEDS A FIXTURE AT ALL, WHICH IS ITSELF THE FINDING.** With the fourth good
 * live and nothing supplied, `fz-13` over 900 ticks produces **no FRONTIER claim at all** — measured:
 * `brannock` walks to `sys-09`, which is the MARCHES gate to `sys-26`, and stops there, claiming the
 * Marches instead. Two gates now stand between a cast member and the Frontier and it can pay neither:
 *
 *   - the second rung of `graduate` costs `ALLOY_GRADUATION_QTY` at the seat it leaves, and
 *   - a frontier anchor costs `ALLOY_ANCHOR_QTY` standing at the system.
 *
 * Neither is reachable for a member that has already left the Commons. `refine {kind:"ALLOY"}` is
 * four to eight times dearer outside it, and `heuristic.ts:alloyErrandFor`'s buy step is gated on
 * `freeCash`, which is **identically zero for every principal in every world this repo has run**
 * (D7's floor is the whole `STARTER_STAKE`) — a fact that file records against itself. So the errand
 * collapses to its haul step, there is nothing to haul, and the Frontier is closed to the cast.
 *
 * That is a real property of today's world and it is reported rather than hidden here. What it is
 * NOT is this test's subject: the assertions below are about **fuel** — that a FRONTIER system
 * yields the third good, that the claimant's own quote publishes its share, and that the fuel stands
 * where an anchor could burn it. Letting the alloy supply decide them would make a fuel test go red
 * for a reason in `market/`.
 *
 * The other nine tests in this file pass `supplyAlloy: false` and their worlds are byte-identical to
 * what they were before this parameter existed.
 * ══════════════════════════════════════════════════════════════════════════
 */
function standAlloyAtEverySeat(runtime: Runtime, cast: HeuristicCast): void {
  for (const member of cast.roster) {
    const seat = holdingOf(runtime.world, member.principal).system;
    if (runtime.alloyAt(member.principal, seat) >= ALLOY_ANCHOR_QTY) continue;
    giveAlloy(runtime, member.principal, seat);
  }
}

/** Where a member's body stands now — the same thing the cast's own `bodyOf` reads. */
function bodyOf(runtime: Runtime, member: CastMember): SystemId {
  return holdingOf(runtime.world, member.principal).system;
}

function did(run: Run, principal: PrincipalId, verb: string): number {
  return run.byMember.get(`${String(principal)}|${verb}`) ?? 0;
}

describe('the cast can reach the place its tribute is payable at (a guard that was wrong)', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **A PRE-EXISTING DEFECT, FOUND WHILE MAKING TERRITORY REACHABLE.**
   *
   * `levyMove` refused any hop whose tier differed from `tierOf(map, member.seat)`. The launch
   * map's constellation 1 is mixed — `sys-01`..`04` COMMONS, `sys-05`..`07` MARCHES — and
   * `levy/place.ts` puts the delivery place at the constellation's *lowest-id COMMONS system*.
   * So a MARCHES-seated member in constellation 1 had its only legal route refused **by the
   * cast, not by the engine**: `commonsBoundRejection` binds hands going OUT of the Commons and
   * never refuses one coming back in.
   *
   * Measured before the fix, seed `gate-b`: `levyShort: 6000`, `brannock` (seat `sys-05`) with
   * three hands parked at `sys-07`, delivery place `sys-01`, zero `deliver` actions ever. After
   * the fix `levyShort` is **0 on all four gate seeds**.
   *
   * MUTATION: restore `tierOf(map, next) !== tierOf(map, member.seat)` in `levyMove`. RED on the
   * second expectation below.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('a member whose delivery place is in another TIER still pays', () => {
    const run = play('gate-b', 640);
    const stranded = run.cast.roster.filter((m) => {
      const block = run.runtime.levyBlockFor(m.principal, run.runtime.engine.tick);
      if (block === null) return false;
      const here = tierOf(run.runtime.world.map, bodyOf(run.runtime, m));
      return tierOf(run.runtime.world.map, block.deliverable_to) !== here;
    });
    // The fixture has to contain one, or the assertion below is vacuous — the failure mode three
    // agents hit in one night on this codebase.
    expect(
      stranded.length,
      'no member on this seed is assessed in a tier it is not standing in, so this proves nothing',
    ).toBeGreaterThan(0);
    for (const m of stranded) {
      expect(
        did(run, m.principal, 'deliver'),
        `${m.handle} stands in a different tier from ${String(
          run.runtime.levyBlockFor(m.principal, run.runtime.engine.tick)?.deliverable_to,
        )} and delivered nothing — the cast refused its own legal route`,
      ).toBeGreaterThan(0);
    }
  }, 180_000);

  it('and the world-level shortfall it was inflating is gone on every gate seed', () => {
    // The headline meter, which no single agent can lower (§14.2). Before the guard fix two of
    // the four gate seeds carried a 6,000 shortfall that was entirely one stranded member.
    for (const seed of GATE_SEEDS) {
      const run = play(seed, 640);
      expect(
        run.runtime.reckoningFrame()?.meters.levyShort ?? -1,
        `${seed} is short, and a shortfall is an accusation`,
      ).toBe(0);
    }
  }, 600_000);
});

describe('the territorial layer is LIVE — claims, rent and a Charge that gets paid', () => {
  it('★ claimLines is NON-EMPTY on every gate seed, and every claim is standing', () => {
    // ══════════════════════════════════════════════════════════════════════
    // **THE ONE ASSERTION THE WHOLE NIGHT'S WORK EXISTS TO MAKE.** `D23` #4's measurement was a
    // single number — `claimLines: 0` — and it was still 0 in production at tick 5,274 after the
    // rent, the fuel, the Charge, the vulnerability window and `demand` had all shipped and all
    // rendered. A mechanic nothing ever chooses is indistinguishable from one that is missing.
    //
    // "Standing" matters as much as "non-empty": a run that took ground and lost it would also
    // produce claim lines, and would be worse than none — a lapse is an arrears published three
    // Reckonings running plus 50,000 of bond slashed, permanently, with A5 having no opt-out.
    // MUTATION: delete the `chargeMove` call from `decideOne` and this goes red on the second
    // expectation (measured: 3 of 11 claims LAPSED with the branch removed).
    // ══════════════════════════════════════════════════════════════════════
    for (const seed of GATE_SEEDS) {
      const run = play(seed, 900);
      const lines = run.runtime.reckoningFrame()?.claimLines ?? [];
      expect(lines.length, `${seed}: no claim line — the territory layer is still inert`).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.state, `${seed}: ${line.system} is ${line.state}`).not.toBe('LAPSED');
        expect(line.arrears, `${seed}: ${line.system} carries arrears`).toBe(0);
      }
      // And the bond behind them is real slashable capital, not a fee.
      for (const claim of run.runtime.sovereignty.liveClaims()) {
        expect(
          run.runtime.bondView(claim.claimant).posted,
          `${seed}: ${String(claim.claimant)} holds a claim with no bond behind it`,
        ).toBeGreaterThanOrEqual(CLAIM_BOND_MINOR);
      }
    }
  }, 600_000);

  it('a claim stands only where its claimant already WORKS — the balance gate, as a property', () => {
    // The clause that makes the branch safe: the recurring Charge is funded by income at that exact
    // place, in the good the Charge is payable in, standing where the Charge requires it to stand.
    // It is also the fuel rule (`works/params.ts`: *"a landlord that works its own ground fuels
    // itself"*), so one gate covers both.
    //
    // ══════════════════════════════════════════════════════════════════════
    // **THE `takenAtTick >= onlineAtTick` ASSERTION IS THE ONE THAT BITES, AND THE FIRST VERSION OF
    // THIS TEST DID NOT HAVE IT.** Asserting only that the claimant works the ground passed with the
    // gate deleted, because `worksFor` sits above `claimFor` with a four-times-higher roll and
    // therefore usually builds first anyway. A test that a branch ordering already guarantees is not
    // testing the gate.
    //
    // The gate's actual wording is *"works it, and works it ONLINE"* — a WORKS inside its 24-tick
    // spin-up has produced nothing, so the Charge it is meant to fund is a promise rather than an
    // income. MUTATION: `if (mine.length === 0 && false)` in `claimFor`. RED here.
    // ══════════════════════════════════════════════════════════════════════
    for (const seed of GATE_SEEDS) {
      const run = play(seed, 900);
      const claims = run.runtime.sovereignty.liveClaims();
      expect(claims.length, `${seed}: no claim to check`).toBeGreaterThan(0);
      for (const claim of claims) {
        const mine = run.runtime.works.liveAt(claim.system).filter((w) => w.holder === claim.claimant);
        expect(
          mine.length,
          `${seed}: ${String(claim.claimant)} holds ${claim.system} and works none of it`,
        ).toBeGreaterThan(0);
        const earliestOnline = Math.min(...mine.map((w) => w.onlineAtTick));
        expect(
          claim.takenAtTick,
          `${seed}: ${claim.system} was claimed at tick ${String(claim.takenAtTick)} but its ` +
            `claimant's WORKS did not come online until ${String(earliestOnline)} — the Charge was ` +
            'taken on against income that did not exist yet',
        ).toBeGreaterThanOrEqual(earliestOnline);
        // The body is there too — a claim is anchored by a body (INV-8) and `graduate` is refused
        // while one stands on a claim, so this is the engine's rule read back.
        expect(holdingOf(run.runtime.world, claim.claimant).system).toBe(claim.system);
        // And the ground out-earns its own Charge, which is what the cover multiple asserts.
        const tier = tierOf(run.runtime.world.map, claim.system);
        const quote = run.runtime.worksQuote(claim.claimant, claim.system);
        expect(
          quote.sharePerTick * TICKS_PER_RECKONING,
          `${seed}: ${claim.system} does not cover its own Charge`,
        ).toBeGreaterThan(CHARGE_BY_TIER[tier]);
      }
    }
  }, 600_000);

  it('★ rent_to is non-null for a real tenant, and the goods actually move', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The second half of the finding. `rent_to` was `null` and `fuel_share_per_tick` was `0` on
    // *every observation a real agent could obtain*, because every WORKS in the world stood on
    // unclaimed Commons ground. A landlord, a tenant and a transfer between them is the thing the
    // rent was built for, and it had never happened.
    //
    // Asserted through `worksQuote` — the accessor the affordance and the observation both publish
    // from — so this is the number an agent reads, not an internal tally.
    // ══════════════════════════════════════════════════════════════════════
    let seedsWithATenant = 0;
    let rentMoved = 0;
    for (const seed of GATE_SEEDS) {
      const run = play(seed, 900);
      for (const claim of run.runtime.sovereignty.liveClaims()) {
        const tenants = run.runtime.works.liveAt(claim.system).filter((w) => w.holder !== claim.claimant);
        if (tenants.length === 0) continue;
        seedsWithATenant += 1;
        for (const tenant of tenants) {
          const quote = run.runtime.worksQuote(tenant.holder, claim.system);
          expect(quote.rentTo, 'a tenant on claimed ground is quoted its landlord BY NAME').toBe(
            claim.claimant,
          );
          expect(quote.rentBps, 'and the rate that applies to it').toBe(claim.rentBps);
          expect(quote.sharePerTick + quote.rentPerTick).toBe(quote.grossPerTick);
          rentMoved += tenant.rentPaid;
        }
      }
    }
    expect(
      seedsWithATenant,
      'no claim in any gate seed has a tenant on it, so `rent_to` is still null everywhere and the ' +
        'rent has nobody to be a relationship with',
    ).toBeGreaterThan(0);
    expect(
      rentMoved,
      'tenants stand on claimed ground and not one unit of rent has changed hands — the split is not ' +
        'running, which is the failure the claim-line panel would render as "nothing collected"',
    ).toBeGreaterThan(0);
  }, 600_000);

  it('the Charge is DELIVERED, by a hand that walked to the ground it is owed at', () => {
    // `deliver {"obligation":"CHARGE"}` needs goods standing at the claimed system AND a hand
    // standing there — and `graduate` moves a HOLDING, leaving every hand where it was. So the
    // branch has to walk one, and this asserts the walk happened rather than that the verb is legal.
    const run = play('gate-a', 900);
    const claimants = new Set(run.runtime.sovereignty.liveClaims().map((c) => String(c.claimant)));
    expect(claimants.size, 'somebody must hold ground').toBeGreaterThan(0);
    let supplied = 0;
    for (const who of claimants) {
      const claim = run.runtime.sovereignty.liveClaims().find((c) => String(c.claimant) === who);
      if (claim === undefined) continue;
      // Reads the same `ClaimView` the observation publishes.
      const view = run.runtime.claimsFor(claim.claimant).find((v) => v.system === claim.system);
      expect(view, `${who} cannot read its own claim`).toBeDefined();
      expect(view?.hand_here, `${who} has no hand standing on ${claim.system} to hand goods over`).toBe(
        true,
      );
      // Paid something this Reckoning, or discharged in full and owing nothing.
      if ((view?.paid ?? 0) > 0 || (view?.owed ?? 1) === 0) supplied += 1;
    }
    expect(supplied, 'no claimant has discharged any part of its Charge').toBeGreaterThan(0);
    expect(run.verbs.get('deliver') ?? 0, 'deliveries happened at all').toBeGreaterThan(0);
  }, 300_000);
});

describe('★ THE BALANCE GATE — territory must not make the Levy harder', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **THE GATE THAT DECIDED WHETHER ANY OF THIS SHIPPED.** Claiming destroys 5,000 units of the good
   * the tribute is payable in, locks 50,000 out of the balance that keeps elective promises, and adds
   * a recurring Charge **denominated in the same good as the tribute**. Naively taken it is three ways
   * to make `levyShort` worse at once, and A5 has no opt-out: every breach it caused would stay on the
   * public record forever, and they would be the house cast's breaches rather than any agent's choice.
   *
   * 4 seeds x 900 ticks x 8 members, `HEAD` (2f816d9) against here:
   *
   * | metric | HEAD | with territory |
   * |---|---|---|
   * | `levyShort` | 12,000 | **0** |
   * | red tribute lines | 0 / 32 | 0 / 32 |
   * | `kept` | 167 | **172** |
   * | `broken` | 17 | **16** |
   * | ventures | 886 | **905** |
   * | live claims | **0** | **11** |
   * | tenants on claimed ground | 0 | 5 |
   * | rent collected (units of ore) | 0 | 31,350 |
   *
   * Every gate metric is equal or better and the territorial layer is live, which was not the first
   * result: the naive branch produced `levyShort` 14,792 and `broken` 78. Four things had to be found
   * and fixed to get here, each measured and each argued at its call site in `src/cast/heuristic.ts` —
   * a tier guard that refused a member's only legal route to its tribute, no hand reserved for a world
   * obligation, an aimless walk that pulled hands off the place they were needed, and a refine
   * threshold calibrated for a poorer world.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('levyShort stays ZERO and no tribute line goes red, with claims live and Charges paid', () => {
    for (const seed of GATE_SEEDS) {
      const run = play(seed, 900);
      const frame = run.runtime.reckoningFrame();
      expect(frame, `${seed}: no frame`).not.toBeNull();
      // Non-vacuity FIRST: a world with no claim in it satisfies the rest of this test trivially,
      // and that world is precisely the one this branch was written to end.
      expect(
        run.runtime.sovereignty.liveClaims().length,
        `${seed}: no live claim, so this gate is being asserted over the world it was meant to change`,
      ).toBeGreaterThan(0);
      expect(frame?.meters.levyShort ?? -1, `${seed}: the Levy went short`).toBe(0);
      expect(
        (frame?.tributeLines ?? []).filter((l) => l.state === 'RED').length,
        `${seed}: a tribute line is RED`,
      ).toBe(0);
    }
  }, 600_000);

  it('and the promise-keeping scoreboard is not worse than the world without territory', () => {
    // `kept`/`broken` is the meter §14.2 calls the scoreboard and GATE 3's whole answer. HEAD across
    // these four seeds is `kept 167 · broken 17`; the table above records where this lands. Asserted
    // as a BAND rather than as literals: the point is that opening the territorial layer did not turn
    // the house cast into a defaulter, and pinning exact counts would make every future calibration
    // look like a regression.
    let kept = 0;
    let broken = 0;
    let ventures = 0;
    for (const seed of GATE_SEEDS) {
      const run = play(seed, 900);
      const frame = run.runtime.reckoningFrame();
      kept += frame?.meters.kept ?? 0;
      broken += frame?.meters.broken ?? 0;
      ventures += run.runtime.ventures.all().length;
    }
    // Both halves non-zero, because §7.6 needs a real answer: a cast that broke nothing would make
    // the falsification test rigged, and one that kept nothing would leave standing nothing to accrue.
    expect(kept, 'elective promises must be kept').toBeGreaterThan(0);
    expect(broken, 'and some must break, or §7.6 has a rigged answer').toBeGreaterThan(0);
    // The band. HEAD is 9.2% broken; the naive territorial branch reached 38.6%, which is what
    // `canPromiseOneMore` and `DEFAULT_CREATE_CHANCE_BPS` were calibrated against each other to fix.
    expect(
      (broken * 100) / (kept + broken),
      'the house cast is breaking a third of its promises — territory is being funded out of money ' +
        'already promised to somebody, which is a breach we authored rather than an agent chose',
    ).toBeLessThan(20);
    expect(ventures, 'and the board is not thinner than the world without territory').toBeGreaterThan(800);
  }, 600_000);
});

describe('fuel — the good only the Frontier makes — enters the world', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **`fuel_share_per_tick` WAS `0` ON EVERY OBSERVATION A REAL AGENT COULD OBTAIN**, because no
   * principal had ever stood on a FRONTIER system. `FUEL_YIELD_PER_TICK` is zero at COMMONS and
   * MARCHES *by design* — that asymmetry is the whole comparative advantage — so the good could not
   * exist until somebody crossed two tiers.
   *
   * The seed is chosen, and the reason is stated rather than hidden: only a MARCHES system adjacent
   * to the Frontier can reach it in one crossing (`sys-09 -> sys-26`, `sys-16 -> sys-25`), and the
   * cast seats raiders at random among eighteen MARCHES systems. `fz-13` seats one on a gate. That is
   * a property of the SHIPPED MAP, not of the branch: `D23` #3 already records the map as *"~4x too
   * big for the population"*, and this is the same finding wearing a different number.
   *
   * The BURN is not asserted here and does not need to be: `works/produce.ts:collectingAt` lights an
   * anchor only when somebody other than the claimant works the ground, and
   * `test/works/a-good-only-the-frontier-makes.spec.ts` already pins the burn, its once-per-Reckoning
   * rule and the cold-anchor case end to end. What was missing was the good existing at all.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('a cast member reaches the Frontier, works it, and holds the fuel its anchor will need', () => {
    // ALLOY SUPPLIED — the only run in this file that gets any. The two gates between a cast member
    // and the Frontier are both priced in a good it cannot make or buy once it has left the Commons,
    // so without this there is no FRONTIER claim on any seed and the fuel assertions below would be
    // vacuous. `standAlloyAtEverySeat` carries the measurement and the argument.
    const run = play('fz-13', 900, 8, true);
    const frontier = run.runtime.sovereignty
      .liveClaims()
      .filter((c) => tierOf(run.runtime.world.map, c.system) === 'FRONTIER');
    expect(
      frontier.length,
      'no FRONTIER claim on this seed — if the map or the seating changed, re-pick a seed that seats ' +
        'a member at sys-09 or sys-16 rather than deleting the assertion',
    ).toBeGreaterThan(0);

    let extracted = 0;
    for (const claim of frontier) {
      const tier = tierOf(run.runtime.world.map, claim.system);
      expect(FUEL_YIELD_PER_TICK[tier], 'the Frontier is the only tier that yields it').toBeGreaterThan(0);
      for (const works of run.runtime.works.liveAt(claim.system)) extracted += works.fuelExtracted;
      // The claimant's own quote publishes its fuel share — the field that read `0` everywhere.
      const quote = run.runtime.worksQuote(claim.claimant, claim.system);
      expect(quote.fuelSharePerTick, 'the field a builder reads before it commits 60,000').toBeGreaterThan(0);
      // And it is standing AT the claim, unpledged, which is the only place an anchor can burn it.
      expect(
        run.runtime.fuelAt(claim.claimant, claim.system),
        'fuel exists but not where the anchor needs it',
      ).toBeGreaterThanOrEqual(ANCHOR_FUEL_BY_TIER[tier]);
      // The claim view an agent reads says the same thing, off one accessor (A9).
      const view = run.runtime.claimsFor(claim.claimant).find((v) => v.system === claim.system);
      expect(view?.fuel_due).toBe(ANCHOR_FUEL_BY_TIER[tier]);
      expect(view?.fuel_here ?? 0).toBeGreaterThanOrEqual(ANCHOR_FUEL_BY_TIER[tier]);
    }
    expect(extracted, 'the third good must actually have been dug').toBeGreaterThan(0);
  }, 300_000);

  it('and no fuel is extracted where the map says none exists, however many claims stand', () => {
    // The zeroes are the mechanic (`works/params.ts`), and a world full of MARCHES claims is the
    // strongest place to assert them: if the rent or the Charge had leaked fuel into a tier that
    // makes none, `checkFuelIsFrontierOnly` would halt — and a test that only ever ran on the
    // Frontier would never reach it.
    const run = play('gate-a', 900);
    for (const works of run.runtime.works.liveInOrder()) {
      const tier = tierOf(run.runtime.world.map, works.system);
      if (FUEL_YIELD_PER_TICK[tier] > 0) continue;
      expect(works.fuelExtracted, `${works.system} is ${tier} and yielded fuel`).toBe(0);
    }
  }, 300_000);
});
