/**
 * ★ **A9 — THE SPECTATOR MAY NOT SEE A FRONT THE AGENT CANNOT READ, NOR THE AGENT ONE THE FRAME HIDES.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > *"The spectator client never shows a live fact an agent's own `observe` wouldn't."* — A9
 *
 * For this layer's whole life it did, and two independent play-tests found it from opposite ends.
 * A player watched `front:r3:sys-20 · sys-20 96% · lands in 555` scroll past on the public feed —
 * `frontBands`, a `PUBLIC` frame field — while `observe` carried **no `risk` key at all**:
 * `OBSERVE_KEYS` was a closed list of ten, `Runtime.riskView` had **zero callers**, and `agent.md`
 * §11F documented three fields nothing had ever serialised. The three risk acts were on the menu,
 * correctly priced, with no state to price them from.
 *
 * This file is the guard, and it checks the property in **both** directions, because only one of
 * them is comfortable:
 *
 *   1. **Everything the frame shows, the agent reads.** Same front, same cone, same odds, off the
 *      same book.
 *   2. **And nothing more.** The SWATH is drawn at *announcement* and withheld until landfall —
 *      *"which is what SEALED means everywhere else in this engine"* — so the block may not carry
 *      it early, and no cone cell may leak an intensity. A block that over-delivered would hand
 *      every reader a solved game, which A2 forbids in the same breath.
 *
 * ## Every assertion here states its non-vacuity FIRST
 *
 * Two guards written in this repo on one day were vacuous on first writing, and the standing
 * defect it keeps re-finding is *"an invariant whose subject cannot occur"* — INV-22 was green over
 * an empty journal for the project's whole life. So each block below asserts that the world really
 * is in the state under test (a front exists · goods really stand in its cone · the offer really is
 * unaffordable) before it asserts anything about the payload.
 *
 * ## Mutation results, run rather than asserted
 *
 * | mutation in `src/risk/view.ts` | killed by |
 * |---|---|
 * | `cone: []` in `riskBlock` | parity (and the seal test, which reads the cone) |
 * | publish `front.swath` unconditionally | the seal |
 * | drop `VULNERABILITY_BY_TIER` from `stakeInCone` | the tier case |
 * | `INTENSITY_MAX_BPS` → `3000` (the band's floor) | the bound, and the tier case |
 * | `spare = 0` — ignore the per-good floor | the bound, and the tier case |
 * | spare the floor at the DEAREST system instead of the cheapest | the floor-placement case |
 * | sort the floor by system id (the shipped-then-fixed defect) | the floor-placement case |
 * | `ticks_to_announce: 0` always | both schedule cases |
 * | `affordable = offers` — offer `sign` unfunded | the `sign` gate's *offering* half |
 * | `tooDear = []` — drop the row | the `sign` gate's *accounting* half |
 *
 * The last two `sign` rows are listed separately on purpose: they are the two halves of
 * `test/api/withheld-is-accountable.spec.ts`'s standard — *offered, or counted with a reason* —
 * and a guard that killed only one of them would let the other ship.
 *
 * ⚑ **The two floor-placement rows are here because the first pass SURVIVED them.** The bound
 * case holds at one system, where the floor's placement cannot matter, so it was green over a
 * property it could not observe — this file's own header, one screen up, as a live example. The
 * fix was a second fixture holding at two coned systems of different tiers, not a stronger
 * assertion on the first.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import { Rng } from '../../src/core/rng.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { minor, qty } from '../../src/core/units.js';
import { LEVY_GOOD } from '../../src/levy/index.js';
import { freeCash } from '../../src/market/escrow.js';
import {
  COVER_ELECTIVE_BPS_FLOOR,
  FRONT_EVERY_RECKONINGS,
  announceFront,
  INTENSITY_MAX_BPS,
  VULNERABILITY_BY_TIER,
  landfallTickOf,
  riskScheduleAt,
  stakeInCone,
  type RiskViewInput,
} from '../../src/risk/index.js';
import type { Runtime } from '../../src/sim/runtime.js';
import { tierOf } from '../../src/world/index.js';
import {
  FIRST_ANNOUNCE_TICK,
  FIRST_FRONT_RECKONING,
  FIRST_LANDFALL_TICK,
  act,
  fund,
  riskWorld,
  runTo,
  seatsFor,
  stockAt,
} from './fixture.js';

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(obj) : []);

/** The `risk` block exactly as a wake would deliver it. */
function riskOf(runtime: Runtime, principal: PrincipalId): Record<string, unknown> {
  const payload = buildObservation({
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 9,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  }) as unknown as Record<string, unknown>;
  return obj(payload['risk']);
}

function affordancesOf(runtime: Runtime, principal: PrincipalId): Record<string, unknown>[] {
  const payload = buildObservation({
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 9,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  }) as unknown as Record<string, unknown>;
  return rows(payload['affordances']);
}

function withheldOf(runtime: Runtime, principal: PrincipalId): Record<string, unknown> {
  const payload = buildObservation({
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 9,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  }) as unknown as Record<string, unknown>;
  return obj(obj(payload['header'])['withheld']);
}

describe('★ A9 — the frame and the payload carry the same FRONT', () => {
  it('names the same front, the same cone systems and the same odds', () => {
    const world = riskWorld('observable:parity', 2, 'MARCHES');
    const [reader] = seatsFor(world, 0);
    runTo(world.runtime, FIRST_ANNOUNCE_TICK + 1);

    // ── NON-VACUITY, FIRST: the SPECTATOR really is being shown a front. ──────
    // Without this the parity assertions below hold trivially over two empty lists, which is
    // exactly the shape (`INV-22` green over an empty journal) that hid this defect for a year.
    const bands = world.runtime.frontBandLines(world.runtime.engine.tick);
    expect(bands.length, 'the public frame must actually carry a front band').toBeGreaterThan(0);

    const fronts = rows(riskOf(world.runtime, reader)['fronts']);
    expect(fronts.length, 'and the agent must be shown one at all — this is the whole defect').toBe(1);

    const framed = new Set(bands.map((b) => `${String(b.front)}::${String(b.system)}::${String(b.tintBps)}`));
    const read = new Set(
      fronts.flatMap((f) =>
        rows(f['cone']).map((c) => `${String(f['front'])}::${String(c['system'])}::${String(c['odds_bps'])}`),
      ),
    );
    // Set equality in BOTH directions: `⊆` in one direction alone would pass a payload that
    // dropped half the cone, and `⊇` alone would pass one that invented cells.
    //
    // MUTATION: drop `cone` from `riskBlock`'s front row, or publish `coneAt(front, front.announcedTick)`
    // instead of `coneAt(front, tick)`, and this fails naming the systems that differ.
    const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
    expect([...read].sort(cmp)).toEqual([...framed].sort(cmp));
  });

  it('★ AND NOTHING MORE — the SWATH is sealed until landfall, on the frame and in the payload alike', () => {
    const world = riskWorld('observable:sealed', 2, 'MARCHES');
    const [reader] = seatsFor(world, 0);
    runTo(world.runtime, FIRST_ANNOUNCE_TICK + 1);

    // ── NON-VACUITY, FIRST: there IS a swath to leak. It is drawn at announcement. ──
    // If `front.swath` were empty here, "the payload does not publish it" would be a statement
    // about nothing.
    const front = world.runtime.risk.liveFronts(world.runtime.engine.tick)[0];
    expect(front, 'a front must be live').toBeDefined();
    expect(front?.swath.length, 'the SWATH is drawn AT ANNOUNCEMENT — there is a secret to keep').toBeGreaterThan(0);

    const read = rows(riskOf(world.runtime, reader)['fronts'])[0];
    expect(read?.['state']).toBe('FORECAST');
    // MUTATION: publish `f.swath` unconditionally in `riskBlock` and this fails.
    expect(read?.['swath'], 'the payload may not carry the SWATH before it lands').toEqual([]);

    // And no cone cell may smuggle the intensity out under another name. The two are drawn from
    // different sub-streams, so a coincidence is possible per-cell; over the whole cone it is not.
    const intensities = new Set(front?.swath.map((c) => Number(c.intensityBps)) ?? []);
    const published = rows(read?.['cone']).map((c) => Number(c['odds_bps']));
    expect(published.length).toBeGreaterThan(0);
    expect(
      published.filter((odds) => intensities.has(odds)).length,
      'a cone cell publishing a swath intensity would be the seal leaking through a rename',
    ).toBeLessThan(published.length);
  });
});

describe('the block is honest in a world with no front, rather than absent or empty', () => {
  it('carries the schedule before the first front is ever announced', () => {
    const world = riskWorld('observable:nofront', 2, 'MARCHES');
    const [reader] = seatsFor(world, 0);
    runTo(world.runtime, FIRST_ANNOUNCE_TICK - 40);

    // ── NON-VACUITY, FIRST: nothing is live, so this really is the "no front" world. ──
    expect(
      world.runtime.risk.liveFronts(world.runtime.engine.tick).length,
      'this test is about a world with NO front; if one is live it proves nothing',
    ).toBe(0);
    expect(world.runtime.frontBandLines(world.runtime.engine.tick).length).toBe(0);

    const block = riskOf(world.runtime, reader);
    expect(block['fronts']).toEqual([]);

    // ★ The point: an empty list beside a live countdown, never a bare `[]` that reads as
    // "this world has no weather". A key that is null in every world is the defect this repo
    // keeps finding, and the schedule is what stops this one being it.
    const schedule = obj(block['schedule']);
    expect(schedule['announced']).toBe(false);
    expect(Number(schedule['ticks_to_announce'])).toBe(40);
    expect(Number(schedule['next_landfall_tick'])).toBe(FIRST_LANDFALL_TICK);
    expect(Number(schedule['next_reckoning'])).toBe(FIRST_FRONT_RECKONING);
    expect(Number(schedule['every_reckonings'])).toBe(FRONT_EVERY_RECKONINGS);

    // The terms and the rule are present at zero too, for `aggression`'s reason: an agent must
    // not have to discover a resource by exhausting it, nor a price by being charged it.
    expect(Number(obj(block['terms'])['deductible_bps'])).toBeGreaterThan(0);
    expect(String(block['rule']).length).toBeGreaterThan(80);
    expect(obj(block['your_record'])['unseasoned']).toBe(true);
  });

  it('the schedule is arithmetic, so it never reads 0/0 and never points at a front that has landed', () => {
    // Swept rather than sampled: one tick either side of an announcement and a landfall is where
    // an off-by-one lives, and a schedule that pointed backwards would be a countdown that runs up.
    for (let tick = 0; tick <= landfallTickOf(FIRST_FRONT_RECKONING * 3) + 10; tick += 7) {
      const s = riskScheduleAt(tick);
      expect(s.next_landfall_tick, `tick ${String(tick)}`).toBeGreaterThanOrEqual(tick);
      expect(s.ticks_to_landfall).toBe(s.next_landfall_tick - tick);
      expect(s.announced).toBe(s.next_announce_tick <= tick);
      expect(s.ticks_to_announce).toBe(Math.max(0, s.next_announce_tick - tick));
    }
  });
});

describe('★ `at_stake` — the "how hard" answer, and it is a BOUND rather than a guess', () => {
  it('is an upper bound the real strike never exceeds, and it is not vacuously large', () => {
    const world = riskWorld('observable:stake', 2, 'MARCHES');
    const [holder] = seatsFor(world, 0);
    runTo(world.runtime, FIRST_ANNOUNCE_TICK + 1);

    const front = world.runtime.risk.liveFronts(world.runtime.engine.tick)[0];
    expect(front).toBeDefined();
    const eye = front?.eye as SystemId;
    stockAt(world.runtime, holder, eye, 60_000, LEVY_GOOD);
    runTo(world.runtime, world.runtime.engine.tick + 1);

    const read = rows(riskOf(world.runtime, holder)['fronts'])[0];
    const stake = obj(read?.['at_stake']);
    const goods = rows(stake['goods']);

    // ── NON-VACUITY, FIRST, three ways ───────────────────────────────────────
    // A bound of 0 is trivially an upper bound; a bound of "everything you own" is trivially one
    // too. Both must be excluded before "the strike never exceeds it" means anything.
    expect((read?.['your_systems_in_cone'] as string[]).length, 'the holder must stand in the cone').toBeGreaterThan(0);
    expect(goods.length, 'and hold something there').toBeGreaterThan(0);
    const bound = Number(stake['worst_case_minor']);
    expect(bound, 'the bound must be a real number of minor units').toBeGreaterThan(0);
    const row = goods.find((g) => g['good'] === LEVY_GOOD);
    expect(Number(row?.['spared']), 'the per-good floor must actually be charged').toBeGreaterThan(0);
    expect(
      Number(row?.['worst_case_qty']),
      'and the bound must be strictly below the whole holding, or the tier share is not being applied',
    ).toBeLessThan(Number(row?.['qty_in_cone']));

    // ── THE PROPERTY: run it to landfall and compare. ────────────────────────
    //
    // Measured **at the systems the CONE named**, which is exactly the claim the field makes and
    // not a convenient narrowing: `coneOf` publishes 8 cells and `swathOf` draws 2–5 from its own
    // sub-stream, so over 500 fronts three of them struck one system the cone did not name. The
    // block's `rule` and `agent.md` §11F both say so. Comparing against total holdings would be
    // asserting a promise the payload does not make — and would flake on 0.6% of seeds.
    const coned = new Set((read?.['your_systems_in_cone'] as string[]) ?? []);
    const before = qtyHeldAt(world.runtime, holder, LEVY_GOOD, coned);
    runTo(world.runtime, FIRST_LANDFALL_TICK + 1);
    const after = qtyHeldAt(world.runtime, holder, LEVY_GOOD, coned);
    const taken = before - after;
    expect(taken, 'the front must actually strike this holder, or the comparison is empty').toBeGreaterThan(0);
    // MUTATION: use `INTENSITY_MIN_BPS` in `stakeInCone`, or spare the per-good floor at the
    // system with the HIGHEST worst-intensity rather than the lowest — both make the bound too
    // small and both fail here.
    expect(taken, 'a published bound the strike exceeds is a lie in the direction that hurts').toBeLessThanOrEqual(
      Number(row?.['worst_case_qty']),
    );
  });

  it('★ spends the per-good floor where it SAVES THE LEAST, which is what makes the number a bound', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // `destroySet` charges the floor **once across every struck system**, in its own lot order, so
    // which system gets the spare depends on where the SWATH actually landed — a fact sealed until
    // landfall. A preview that assumed the floor protects the *dearest* goods would publish a
    // figure the real strike can EXCEED, by `floor × (dearest − cheapest intensity)`, and it would
    // do so silently: every individual term still correct, the total quietly short.
    //
    // The first version of `stakeInCone` sorted by system id, which is arbitrary with respect to
    // tier and therefore wrong roughly half the time. **The mutation that catches it is reversing
    // this comparator**, and it survived the fixture above because that holder stood at ONE system
    // — a guard that cannot see the property it is written for, which is this file's own header.
    // ══════════════════════════════════════════════════════════════════════════
    const world = riskWorld('observable:floor', 2, 'MARCHES');
    const [holder] = seatsFor(world, 0);
    runTo(world.runtime, FIRST_ANNOUNCE_TICK + 1);
    const front = world.runtime.risk.liveFronts(world.runtime.engine.tick)[0];
    expect(front).toBeDefined();

    // Two systems the CONE names, so both are in scope, and the same good in both.
    const cells = [...(front?.cone ?? [])].map((c) => c.system);
    expect(cells.length, 'the cone must name at least two systems for this to mean anything').toBeGreaterThan(1);
    const [cheapAt, dearAt] = [cells[0] as SystemId, cells[1] as SystemId];
    const each = 60_000;
    const read: RiskViewInput = {
      book: world.runtime.risk,
      principal: holder,
      tick: world.runtime.engine.tick,
      holdings: [
        { system: cheapAt, good: LEVY_GOOD, qty: qty(each), unitPrice: minor(1) },
        { system: dearAt, good: LEVY_GOOD, qty: qty(each), unitPrice: minor(1) },
      ],
      freeCash: minor(0),
    };
    // COMMONS at 2,500 bps against FRONTIER at 10,000 — the widest spread the tier table allows,
    // so the two placements are as far apart as they can be and the assertion is not a rounding
    // artefact.
    const tierRead = (s: SystemId): 'COMMONS' | 'FRONTIER' => (s === cheapAt ? 'COMMONS' : 'FRONTIER');
    const bound = Number(
      stakeInCone(read, tierRead).get(String(front?.id))?.goods[0]?.worst_case_qty ?? -1,
    );

    const worstAt = (tier: 'COMMONS' | 'FRONTIER'): number =>
      Math.trunc((Number(INTENSITY_MAX_BPS) * Number(VULNERABILITY_BY_TIER[tier])) / 10_000);
    const floor = 20_000;
    const floorOnTheCheap =
      Math.trunc(((each - floor) * worstAt('COMMONS')) / 10_000) +
      Math.trunc((each * worstAt('FRONTIER')) / 10_000);
    const floorOnTheDear =
      Math.trunc((each * worstAt('COMMONS')) / 10_000) +
      Math.trunc(((each - floor) * worstAt('FRONTIER')) / 10_000);

    // ── NON-VACUITY, FIRST: the two placements really do differ, so there is a choice to get
    //    wrong. Without this the equality below would pass for any comparator at all.
    expect(floorOnTheCheap, 'the two placements must differ, or this test decides nothing').toBeGreaterThan(
      floorOnTheDear,
    );
    // MUTATION: reverse the comparator in `stakeInCone` and `bound` becomes `floorOnTheDear`.
    expect(bound, 'the floor is assumed to protect the CHEAPEST goods — every other placement takes less').toBe(
      floorOnTheCheap,
    );
  });

  it('★ the CONE/SWATH gap the bound is qualified by is REAL, and it is the size the docs claim', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // The qualifier *"over the systems the CONE names"* is either an honest limit or a hedge, and
    // the difference is whether anybody measured it. This is the measurement: over 500 fronts on
    // the launch map, **4 have one struck system the cone did not publish** — and an independent
    // sweep on a different seed family read **3**, which is why `risk.rule` and `agent.md` §11F
    // quote it as *3–4 in 500* rather than as a constant. It is a rate, not a fact about a world.
    //
    // The per-sweep count is exact and deterministic, so it is pinned; the CELL count is the
    // structural claim and is pinned at 1. A `front.ts` change that made the SWATH a strict subset
    // of the CONE should make this test say so out loud rather than pass silently — at which point
    // the qualifier can be deleted from three documents, which is a finding worth being told about.
    // ══════════════════════════════════════════════════════════════════════════
    const world = riskWorld('observable:conegap', 2, 'MARCHES');
    const map = world.runtime.world.map;
    let outside = 0;
    let worstCells = 0;
    for (let i = 0; i < 500; i += 1) {
      const reckoning = 3 * (i + 1);
      const front = announceFront(map, Rng.fromSeed(`conegap:${String(i)}`), reckoning, reckoning * 288);
      const cone = new Set(front.cone.map((c) => c.system));
      const missed = front.swath.filter((c) => !cone.has(c.system)).length;
      if (missed > 0) outside += 1;
      worstCells = Math.max(worstCells, missed);
    }
    // Non-vacuity in both directions: the sweep really ran, and the gap is small rather than absent
    // — if it were zero the qualifier could be deleted, and that is a finding, not a pass.
    expect(outside, 'measured 4/500 here — the qualifier in `risk.rule` is about a real case').toBe(4);
    expect(worstCells, 'and never more than one cell').toBe(1);
  });

  it('applies the tier, so identical goods on Commons ground are bounded lower than on the Marches', () => {
    // ★ **A rule that never discriminates is a rule this repo has already shipped three times** —
    // EXPOSURE was identically zero, so `BY_EXPOSURE`, `EVEN` and the published default
    // `INVERSE_EXPOSURE` were one flat weight on 18 of 18 dockets. A bound that ignored
    // `VULNERABILITY_BY_TIER` would read the same on the safest ground in the game as on the most
    // dangerous, and nothing about the number's shape would say so.
    //
    // Driven through `stakeInCone` with the tier reader swapped and **everything else identical**,
    // because which tier the eye lands in is a draw: gating the case on a seed producing a Commons
    // eye is how a test starts skipping itself.
    const world = riskWorld('observable:tier', 2, 'MARCHES');
    const [holder] = seatsFor(world, 0);
    runTo(world.runtime, FIRST_ANNOUNCE_TICK + 1);
    const front = world.runtime.risk.liveFronts(world.runtime.engine.tick)[0];
    expect(front, 'a front must be live').toBeDefined();
    const eye = front?.eye as SystemId;

    const read: RiskViewInput = {
      book: world.runtime.risk,
      principal: holder,
      tick: world.runtime.engine.tick,
      holdings: [{ system: eye, good: LEVY_GOOD, qty: qty(60_000), unitPrice: minor(1) }],
      freeCash: minor(0),
    };
    const bound = (tier: 'COMMONS' | 'MARCHES'): number =>
      Number(stakeInCone(read, () => tier).get(String(front?.id))?.worst_case_minor ?? -1);

    // Non-vacuity: the two weights really are different, and both bounds are real numbers.
    expect(Number(VULNERABILITY_BY_TIER.MARCHES)).toBeGreaterThan(Number(VULNERABILITY_BY_TIER.COMMONS));
    expect(bound('COMMONS')).toBeGreaterThan(0);
    // MUTATION: drop the `VULNERABILITY_BY_TIER[...]` factor from `stakeInCone` and the two are equal.
    expect(bound('MARCHES')).toBeGreaterThan(bound('COMMONS'));
    // The ratio is the published one rather than merely "bigger": 6,000 against 2,500 bps, and the
    // worst intensity is `INTENSITY_MAX_BPS` rather than the centre of the band.
    expect(bound('MARCHES') / bound('COMMONS')).toBeCloseTo(2.4, 2);
    const exposed = 60_000 - 20_000;
    const worst = Math.trunc(
      (exposed * Math.trunc((Number(INTENSITY_MAX_BPS) * Number(VULNERABILITY_BY_TIER.MARCHES)) / 10_000)) / 10_000,
    );
    expect(bound('MARCHES')).toBe(worst);
    expect(tierOf(world.runtime.world.map, eye)).toBeDefined();
  });
});

describe('★ `sign` is offered only when the premium can actually be paid — a play-test found this', () => {
  it('withholds it under SHORT_FUNDS while the offer stays visible and priced', () => {
    const world = riskWorld('observable:signfunds', 3, 'MARCHES');
    const [payer, payee, banker] = seatsFor(world, 0, 1, 2);
    runTo(world.runtime, FIRST_ANNOUNCE_TICK + 1);
    const front = world.runtime.risk.liveFronts(world.runtime.engine.tick)[0];
    const eye = front?.eye as SystemId;

    stockAt(world.runtime, payee, eye, 60_000, LEVY_GOOD);
    fund(world.runtime, banker, payer, 200_000);
    runTo(world.runtime, world.runtime.engine.tick + 1);

    const write = affordancesOf(world.runtime, payer).find(
      (a) => a['verb'] === 'publish_offer' && obj(a['params'])['kind'] === 'COVER',
    );
    expect(write, 'the payer must be offered the COVER act, or nothing below can be set up').toBeDefined();
    expect(act(world.runtime, payer, 'publish_offer', obj(write?.['params']))).toBeNull();
    runTo(world.runtime, world.runtime.engine.tick + 1);

    // ── NON-VACUITY, FIRST: a real, bindable, PRICED offer stands, and the payee is broke. ──
    const offers = rows(riskOf(world.runtime, payee)['offers']);
    expect(offers.length, 'an open offer over the payee\'s own goods must exist').toBe(1);
    const premium = Number(offers[0]?.['premium']);
    expect(premium, 'and it must cost something').toBeGreaterThan(0);
    expect(
      freeCash(world.runtime.ledger, payee),
      'and the payee must genuinely be unable to pay it — A15 withholds its own stake',
    ).toBeLessThan(premium);

    // MUTATION: delete the `affordable`/`tooDear` split in `coverAffordances` and this fails on
    // the first expect — `sign` returns to the menu and the tick refuses it with PROP-R1, which
    // is precisely the action a probe spent learning a number the payload already knew.
    expect(
      affordancesOf(world.runtime, payee).some((a) => a['verb'] === 'sign'),
      'an act the tick will refuse on arrival is not "something you can legally do right now"',
    ).toBe(false);
    const withheld = withheldOf(world.runtime, payee);
    expect(withheld['verbs']).toContain('sign');
    expect(String(withheld['reason'])).toContain(String(premium));

    // ── AND IT COMES BACK the moment the money does. Without this the guard passes on a `sign`
    //    that is withheld unconditionally, which is the same defect with the sign flipped.
    fund(world.runtime, banker, payee, premium * 2);
    runTo(world.runtime, world.runtime.engine.tick + 1);
    expect(freeCash(world.runtime.ledger, payee)).toBeGreaterThanOrEqual(premium);
    const offered = affordancesOf(world.runtime, payee).find((a) => a['verb'] === 'sign');
    expect(offered, 'a funded payee must be offered the act').toBeDefined();
    // The affordance and the block are one solve: a menu quoting a cover the block does not show
    // is scar #1 with money attached.
    expect(obj(offered?.['params'])['cover']).toBe(offers[0]?.['cover']);
    expect(obj(offered?.['params'])['terms_hash']).toBe(offers[0]?.['terms_hash']);

    // And the act really binds, so this is a reachability guard rather than a menu guard.
    expect(act(world.runtime, payee, 'sign', obj(offered?.['params']))).toBeNull();
    runTo(world.runtime, world.runtime.engine.tick + 1);
    const after = riskOf(world.runtime, payee);
    expect(rows(after['covered']).length, 'what you bought must show up in `covered[]`').toBe(1);
    expect(rows(after['offers']).length, 'and leave `offers[]`, because the interest is taken').toBe(0);
    expect(Number(obj(rows(after['covered'])[0]?.['payer_record'])['written'])).toBe(1);
    expect(Number(COVER_ELECTIVE_BPS_FLOOR)).toBeGreaterThan(0);
  });
});

/** Located goods of one kind in a principal's stores, at a named set of systems. */
function qtyHeldAt(
  runtime: Runtime,
  principal: PrincipalId,
  good: string,
  systems: ReadonlySet<string>,
): number {
  let total = 0;
  for (const lot of runtime.ledger.lotsInAccount(`stores:${principal}` as never)) {
    if (String(lot.good) === good && systems.has(String(lot.location))) total += lot.qty;
  }
  return total;
}
