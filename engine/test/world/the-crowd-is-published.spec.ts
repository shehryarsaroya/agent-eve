/**
 * ★ **THE 430% TERM, PUBLISHED** — `holding.graduation.ground[].occupants` / `.share_per_tick`.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A BLIND PLAYER CROSSED ONTO THE MOST CROWDED SYSTEM ON THE MAP AND THE ROW IT READ WAS TRUE.**
 *
 * *"I picked sys-05 because it read `yield 110 · richness_bps 0 · gate: true`. It was the most crowded
 * system on the map — 4 WORKS at 27 each. `p:kestrel` sat alone on sys-10 taking 115. THE LODE spreads
 * a tier by ~15%; occupancy spreads it by 430%. A one-way, 50,000-plus-5,000 decision publishes the
 * 15% term and hides the 430% term."*
 *
 * Every figure `ground[]` carried was exact, comparable and a pure function of the fixed map — and the
 * term that decides the income was not among them. `works.here.share_per_tick` proves the engine knew
 * it, one key over, for the system the reader was standing on and for no other.
 *
 * That is A2's two clauses pulling apart: *"never hand it a solved game"* held, and *"never make an
 * agent need a wiki"* did not, because the only way to learn a destination's crowding was to spend the
 * irreversible act and look. It is also why three separate measurements said the cast never competes
 * for rich ground — **it cannot, because emptiness was not published.**
 *
 * ── WHAT THIS FILE ASSERTS, AND NON-VACUITY FIRST ────────────────────────────
 *
 * A field that is present and constant is the defect one level up, so the first test proves the
 * numbers MOVE with occupancy on a real world before any of the rest runs. The rest:
 *
 *   1. the derived share is the ENGINE's, not a recomputation — identical to `worksQuote`, which is
 *      what the build affordance quotes and what `vBuildWorks` charges (scar #1);
 *   2. the ranking actually inverts — an empty poor system beats a crowded rich one, which is the
 *      whole finding as an executable claim;
 *   3. `worksQuote`'s `held` is PER-SYSTEM, the latent overstatement found underneath the claim.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/index.js';
import { WAKES_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { Runtime } from '../../src/sim/runtime.js';
import { systemYield } from '../../src/works/params.js';
import { setSpeed } from '../../src/core/time.js';
import { tierOf } from '../../src/world/map.js';
import { LODE_STATEMENT } from '../../src/world/lode.js';

type Row = Record<string, unknown>;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

let rt: Runtime;

beforeEach(() => {
  setSpeed('instant');
  rt = new Runtime({ seed: 'crowd-published' });
});
afterEach(() => {
  setSpeed('instant');
});

/** The `holding.graduation.ground[]` rows one principal reads, straight off the payload. */
function ground(who: PrincipalId): Row[] {
  const payload = buildObservation({
    runtime: rt,
    principal: who,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: WAKES_PER_RECKONING,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  }) as unknown as Row;
  const holding = payload['holding'] as Row;
  const graduation = holding['graduation'] as Row;
  const rows = graduation['ground'];
  expect(Array.isArray(rows), '`holding.graduation.ground` must be an array').toBe(true);
  return (rows as Row[]).map((r) => r);
}

/** Seat a principal in the Commons the way enrolment does, without going through HTTP. */
function seat(name: string): PrincipalId {
  const who = `p:${name}` as PrincipalId;
  rt.seat(who, name);
  return who;
}

describe('★ graduation.ground publishes the crowd, not only the lode', () => {
  it('★ NON-VACUITY: the new fields MOVE — a WORKS at a destination changes the row a reader sees', () => {
    // The whole defect one level up: a field that is always the same number is indistinguishable
    // from a field that is missing, in every report and to every reader. So this runs FIRST and
    // nothing below it is worth reading if it fails.
    const reader = seat('reader');
    const before = ground(reader);
    expect(before.length, 'a Commons seat must have somewhere to graduate to').toBeGreaterThan(0);
    const target = String(before[0]?.['system']);

    for (const row of before) {
      expect(row['occupants'], `${String(row['system'])} starts empty`).toBe(0);
      expect(
        row['share_per_tick'],
        'and an empty place hands its whole yield to the first arrival',
      ).toBe(Number(row['yield_per_tick']));
    }

    // Four rivals raise a WORKS at the first destination. Nothing else about the world changes.
    for (const i of [0, 1, 2, 3]) {
      rt.works.raise({ system: target as SystemId, holder: `p:rival-${String(i)}` as PrincipalId, tick: 0 });
    }

    const after = ground(reader);
    const crowded = after.find((r) => String(r['system']) === target);
    expect(crowded?.['occupants'], 'the count must follow the book').toBe(4);
    expect(
      Number(crowded?.['share_per_tick']),
      'and the SHARE must fall — this is the 430% term the row used to hide',
    ).toBe(Math.trunc(Number(crowded?.['yield_per_tick']) / 5));
    expect(
      Number(crowded?.['share_per_tick']),
      'strictly less than the yield, or the division is not happening',
    ).toBeLessThan(Number(crowded?.['yield_per_tick']));

    // And every OTHER destination is untouched, so the field is per-system and not a global.
    for (const row of after) {
      if (String(row['system']) === target) continue;
      expect(row['occupants'], `${String(row['system'])} was not built on`).toBe(0);
    }
  });

  it('★ the names are published too, so a crossing is a decision about WHO as well as where', () => {
    const reader = seat('reader');
    const target = String(ground(reader)[0]?.['system']) as SystemId;
    rt.works.raise({ system: target, holder: 'p:kestrel' as PrincipalId, tick: 0 });
    rt.works.raise({ system: target, holder: 'p:vela' as PrincipalId, tick: 0 });

    const row = ground(reader).find((r) => String(r['system']) === target);
    const named = (row?.['occupied_by'] as string[]) ?? [];
    expect(
      [...named].sort(cmp),
      'a count with nobody attached is a cost; a count with names attached is a decision',
    ).toEqual(['p:kestrel', 'p:vela']);
    expect(named.length, 'and the list and the count are one read of one book').toBe(Number(row?.['occupants']));
  });

  it('★ the share is the ENGINE\'s number, identical to what `build` will quote on arrival (scar #1)', () => {
    const reader = seat('reader');
    const first = String(ground(reader)[0]?.['system']) as SystemId;
    rt.works.raise({ system: first, holder: 'p:rival' as PrincipalId, tick: 0 });

    for (const row of ground(reader)) {
      const system = String(row['system']) as SystemId;
      const quote = rt.worksQuote(reader, system);
      expect(
        row['share_per_tick'],
        `${system}: the crossing row and the build quote must be one arithmetic`,
      ).toBe(quote.sharePerTick);
      expect(row['occupants']).toBe(quote.occupants);
      expect(row['fuel_share_per_tick']).toBe(quote.fuelSharePerTick);
      expect(row['rent_bps']).toBe(quote.rentBps);
      // And the yield the row publishes is the map's, so the reader can check the division itself.
      expect(Number(row['yield_per_tick'])).toBe(Number(systemYield(rt.world.map, system)));
    }
  });

  it('★ THE FINDING: an EMPTY poor system beats a CROWDED rich one, and the row now says so', () => {
    // The player's exact situation, reconstructed on the real launch map: two MARCHES destinations,
    // the richer one crowded. Ranking on `yield_per_tick` or `richness_bps` picks the worse ground;
    // ranking on `share_per_tick` picks the better one. Before this change the row carried only the
    // first two, so a correct reading of a true row was the wrong decision.
    const reader = seat('reader');
    const open = ground(reader);
    expect(open.length, 'this claim needs two destinations to rank').toBeGreaterThanOrEqual(2);
    const byYield = [...open].sort(
      (a, b) => Number(b['yield_per_tick']) - Number(a['yield_per_tick']) || cmp(String(a['system']), String(b['system'])),
    );
    const rich = String(byYield[0]?.['system']) as SystemId;
    const poor = String(byYield[byYield.length - 1]?.['system']) as SystemId;

    for (const i of [0, 1, 2, 3]) {
      rt.works.raise({ system: rich, holder: `p:crowd-${String(i)}` as PrincipalId, tick: 0 });
    }

    const rows = ground(reader);
    const richRow = rows.find((r) => String(r['system']) === rich);
    const poorRow = rows.find((r) => String(r['system']) === poor);

    expect(richRow, 'the rich destination must still be in the list').toBeDefined();
    expect(poorRow, 'and so must the poor one').toBeDefined();
    expect(
      Number(richRow?.['yield_per_tick']),
      'the rich system is still the richer GROUND',
    ).toBeGreaterThanOrEqual(Number(poorRow?.['yield_per_tick']));
    expect(
      Number(richRow?.['share_per_tick']),
      'and it pays an arrival strictly WORSE, which is the whole finding',
    ).toBeLessThan(Number(poorRow?.['share_per_tick']));
    // The magnitude, so a future calibration that flattened crowding would be visible here rather
    // than merely still-green: the player measured ~430% against the lode's ~15%.
    const spread = Number(poorRow?.['share_per_tick']) / Number(richRow?.['share_per_tick']);
    expect(spread, 'crowding must dominate the lode by a wide margin, not squeak past it').toBeGreaterThan(2);
  });

  it('★ `worksQuote`\'s `held` is PER-SYSTEM — the overstatement found under the claim', () => {
    // `held` gated the `occupants + 1` division and read `ofPrincipal(...).length > 0`, which is a
    // GLOBAL question. So a principal holding a WORKS anywhere was quoted `yield / occupants` for
    // every OTHER system — the pre-arrival rate the division exists to refuse, on the most-quoted
    // number in the economy, for exactly the reader about to spend a one-way act.
    //
    // Unreachable through the heuristic cast (it declines to graduate while it holds a WORKS), and
    // `alreadyHeld` two dozen lines away was already per-system: two predicates for one question.
    //
    // MUTATION: put `held` back to `ofPrincipal(principal).length > 0` and the last expect flips
    // from 22 to 27 on a four-occupant system.
    const marches = rt.world.map.systemOrder.filter((s) => tierOf(rt.world.map, s) === 'MARCHES');
    const home = marches[0] as SystemId;
    const away = marches[1] as SystemId;
    const who = 'p:holder' as PrincipalId;

    rt.works.raise({ system: home, holder: who, tick: 0 });
    for (const i of [0, 1, 2, 3]) {
      rt.works.raise({ system: away, holder: `p:other-${String(i)}` as PrincipalId, tick: 0 });
    }

    // At HOME it holds one of one, so the live occupancy is right: it takes the whole yield.
    expect(rt.worksQuote(who, home).sharePerTick).toBe(Number(systemYield(rt.world.map, home)));
    // AWAY it holds none, so a build there would be the fifth — `yield / 5`, never `yield / 4`.
    expect(
      rt.worksQuote(who, away).sharePerTick,
      'a system this principal does not stand on is a PROSPECTIVE build wherever else it holds one',
    ).toBe(Math.trunc(Number(systemYield(rt.world.map, away)) / 5));
  });

  it('LODE_STATEMENT ranks the two terms, and names the field to sort on (hard rule 4)', () => {
    // The statement already told an agent two systems in a tier differ, and a second player read it
    // and still picked the worst ground on the map — because it named the smaller reason as THE
    // reason. A rules surface that ranks two terms the wrong way round is worse than one that omits
    // both: it reads as complete.
    expect(LODE_STATEMENT).toMatch(/THE LODE IS THE SMALLER TERM/);
    expect(LODE_STATEMENT, 'and the field an agent should actually rank on').toMatch(/share_per_tick/);
    expect(LODE_STATEMENT, 'with the direction stated, not implied').toMatch(
      /empty poor system pays better than a crowded rich one/,
    );
  });
});

describe('★ THE SWEEP — the same question of every other one-way or expensive decision', () => {
  /**
   * The question the graduation defect generalises to: **does the observation publish the term that
   * dominates the outcome?** Three acts were checked and two had the identical shape — every COST
   * named and the INCOME (or the capacity) omitted.
   *
   *   · `build {WORKS}` — CLEAN. It already names occupancy, the share after arriving, the landlord,
   *     the rate and the frontier fuel. It is the worked example the other two are measured against.
   *   · `build {ANCHOR}` — the price, the goods, the inherited arrears, the bond and the Charge, and
   *     **nothing about rent**. A claim earns `rent_bps` of what OTHER principals' WORKS extract
   *     there, so at 0 tenants it earns zero against a recurring Charge in produced goods — strictly
   *     negative, and it read identically to a good claim. `ClaimView` has carried `tenants` and
   *     `rent_per_tick` the whole time.
   *   · `move` — the trip and the raid exposure, and **nothing about a STRAIT**. That term became
   *     load-bearing at 35: raider force is `min(hands standing, SWAY)` and an unheld strait costs
   *     `SWAY_STRAIT_TOLL` of exactly that, so a hand can arrive present and worth nothing.
   *
   * Asserted on the affordance strings, because the strings ARE the rules surface (hard rule 4) and
   * the alternative is running a cast for a Reckoning and hoping the right offer comes up.
   */
  it('★ `build {ANCHOR}` names the rent and the tenant count, not only what it costs', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/api/observe.ts', import.meta.url)), 'utf8');
    const anchor = src.slice(src.indexOf("params: { kind: 'ANCHOR', system: claim.system }"));
    const body = anchor.slice(0, anchor.indexOf('expires_tick'));
    expect(body, 'the return on a claim is its rent, and the rate decides it').toContain('claim.rent_bps');
    expect(body, 'and the TENANT COUNT decides whether there is any').toContain('claim.tenants');
    expect(body, 'with the per-tick figure, so no arithmetic is left to the reader (A2)').toContain(
      'claim.rent_per_tick',
    );
    expect(body, 'and the zero case stated, because that is the one that loses money').toMatch(
      /At 0 tenants a claim/,
    );
  });

  it('★ `move` names a STRAIT and the SWAY it costs, because 35 made that term decide a war', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/api/observe.ts', import.meta.url)), 'utf8');
    expect(src, 'the lane offer must ask whether it is a strait').toMatch(
      /isStrait\(world\.map, hand\.location, lane\)/,
    );
    expect(src, 'and name the toll from the constant, never as prose').toContain('SWAY_STRAIT_TOLL');
    expect(
      src,
      'and only when it applies — a clause on every lane in the galaxy is one agents learn to skip',
    ).toMatch(/: ''\),/);
  });

  it('`build {WORKS}` is the worked example and stays clean', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/api/observe.ts', import.meta.url)), 'utf8');
    const works = src.slice(src.indexOf("params: { kind: 'WORKS', system: worksHere.system }"));
    const body = works.slice(0, works.indexOf('expires_tick'));
    for (const term of ['worksHere.occupants', 'worksHere.sharePerTick', 'worksHere.rentBps', 'worksHere.fuelSharePerTick']) {
      expect(body, `${term} is a term that decides this build and must stay named`).toContain(term);
    }
  });
});
