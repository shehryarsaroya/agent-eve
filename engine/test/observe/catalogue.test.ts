/**
 * The catalogue against the engine it advertises.
 *
 * `catalogue.ts` composes eligibility out of the owning modules' own predicates and
 * says why: a second implementation of "can this hand fill this role" is scar #1 with
 * an affordance attached — the agent is shown an option the engine then refuses, which
 * from the agent's side is indistinguishable from a counterparty taking the slot.
 *
 * A comment cannot enforce that. These tests can: **every `fill_role` the observation
 * publishes is passed to the real `fillRole`, and every board slot to the real
 * `windowContains`/`openIndices` path.** A condition added to the venture module and
 * not to the composition here fails here.
 *
 * The forecast test is the same shape one level up: `slotForecast` lifts the holder
 * lookup out of `takeAtPercentile`, so for a role that *is* held the two must agree
 * exactly. If they ever diverge, one of them has grown a rule about what a role is
 * owed, and §7.1 is explicit that there may only be one.
 */

import { describe, expect, it } from 'vitest';
import { minor, type Bps } from '../../src/core/units.js';
import { buildObservation, slotForecast, slotClaimAt } from '../../src/observe/index.js';
import {
  PERCENTILES,
  fillRole,
  openIndices,
  roleOfPrincipal,
  takeAtPercentile,
  windowContains,
} from '../../src/venture/index.js';
import { handById, handsOf } from '../../src/world/index.js';
import type { HandId, VentureId } from '../../src/core/types.js';
import {
  ALICE,
  BRAM,
  CASS,
  DOV,
  ESK,
  fill,
  fixture,
  goLive,
  makeHaul,
  makeTopYield,
  share,
  sourcesFor,
  vid,
  wage,
} from './fixture.js';

describe('every fill_role the observation publishes is one the engine accepts', () => {
  it('accepts the published fill on a two-role HAUL', () => {
    const f = fixture();
    const haul = makeHaul(f, { creator: ALICE });
    const built = buildObservation(sourcesFor(f), BRAM);
    const fills = built.observation.affordances.filter((a) => a.verb === 'fill_role');
    expect(fills.length).toBeGreaterThan(0);

    for (const affordance of fills) {
      const ventureId = affordance.params['venture'] as VentureId;
      const roleIndex = affordance.params['role_index'] as number;
      const handId = affordance.params['hand'] as HandId;
      const venture = f.book.require(ventureId);
      // The real function, on the real rows. Not a re-check of the same predicates.
      const result = fillRole(venture, roleIndex, handById(f.world, handId), 1);
      expect(result.ok, result.ok ? '' : `${result.invariant}: ${result.hint}`).toBe(true);
      // Undo, so the next published fill is evaluated against the same world the
      // observation described.
      if (result.ok) {
        result.value.filledByHandId = null;
        result.value.filledByPrincipal = null;
        result.value.filledAtTick = null;
      }
      void haul;
    }
  });

  it('publishes no fill for a venture whose window has closed', () => {
    const f = fixture();
    makeHaul(f, { windowOpensTick: 0, windowClosesTick: 3, resolvesAtTick: 10 });
    const built = buildObservation(sourcesFor(f, { tick: 5 }), BRAM);
    expect(built.observation.affordances.some((a) => a.verb === 'fill_role')).toBe(false);
    expect(built.observation.header.withheld.some((r) => r.ground === 'WINDOW_SHUT')).toBe(true);
  });

  it('publishes no second fill for a principal already holding a role — PROP-V6 clause 2', () => {
    const f = fixture();
    const top = makeTopYield(f, 'BUILD', vid('v-build-1'), ALICE);
    fill(f, top, 0, BRAM, 1);
    const built = buildObservation(sourcesFor(f), BRAM);
    const fills = built.observation.affordances.filter(
      (a) => a.verb === 'fill_role' && a.params['venture'] === top.id,
    );
    expect(fills).toEqual([]);
    expect(roleOfPrincipal(top, BRAM)).not.toBeNull();
    expect(openIndices(top).length).toBeGreaterThan(0);
  });

  it('never offers one hand for two slots in the same payload', () => {
    // Presence is the tightest constraint in the game. Two options that both consume
    // the same hand is a list where only one entry is real.
    const f = fixture();
    makeHaul(f, { id: vid('v-a'), creator: ALICE });
    makeHaul(f, { id: vid('v-b'), creator: DOV });
    makeHaul(f, { id: vid('v-c'), creator: ESK });
    const built = buildObservation(sourcesFor(f), BRAM);
    const hands = built.observation.affordances
      .filter((a) => a.verb === 'fill_role')
      .map((a) => a.params['hand']);
    expect(new Set(hands).size).toBe(hands.length);
  });

  it('board slots are exactly the ones the venture module calls open and in-window', () => {
    const f = fixture();
    const open_ = makeHaul(f, { id: vid('v-open'), creator: ALICE, windowClosesTick: 100 });
    makeHaul(f, { id: vid('v-shut'), creator: DOV, windowOpensTick: 0, windowClosesTick: 2, resolvesAtTick: 9 });
    const built = buildObservation(sourcesFor(f, { tick: 5 }), CASS);
    for (const slot of built.observation.ventures.board) {
      const venture = f.book.require(slot.venture);
      expect(windowContains(venture, 5)).toBe(true);
      expect(openIndices(venture)).toContain(slot.role_index);
    }
    expect(built.observation.ventures.board.some((s) => s.venture === open_.id)).toBe(true);
    expect(built.observation.ventures.board.some((s) => s.venture === 'v-shut')).toBe(false);
  });

  it('a board slot carries the terms_hash a filler has to countersign', () => {
    // ── GATE 3's `0/0` ────────────────────────────────────────────────────────
    //
    // A fill is a request allocated at tick close and the venture stays FORMING until
    // every party countersigns the *same* hash (§7.3). Without the hash on the row that
    // advertises the slot, a filler needs a second wake to read it out of
    // `ventures.mine[]` — inside a 12-tick window, on one wake per 18 ticks. Gate 3's
    // measure came out `0/0` and ~46 ventures died on a missing countersignature.
    const f = fixture();
    const haul = makeHaul(f, { creator: ALICE });
    const built = buildObservation(sourcesFor(f), BRAM);
    const slots = built.observation.ventures.board.filter((s) => s.venture === haul.id);
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      // The venture's own hash, full length: `countersign` compares it byte for byte and
      // reads a prefix as a different deal.
      expect(slot.terms_hash).toBe(f.book.require(slot.venture).termsHash);
      expect(String(slot.terms_hash).length).toBeGreaterThan(32);
    }
  });

  it('counts the idle hands it does not offer, instead of claiming it offered them all', () => {
    // `free[0]` offers one hand per slot. The others are legal acts — two Gate-3 probes
    // filled with a hand the payload never offered — so they are counted under `PAGED`,
    // the ground that means *eligible*, and `accountingFaults` must still balance.
    const f = fixture();
    const haul = makeHaul(f, { creator: ALICE });
    const free = handsOf(f.world, BRAM).filter(
      (hand) => hand.state === 'IDLE' && hand.location === haul.stage,
    );
    expect(free.length, 'the omission only exists if there is more than one hand').toBeGreaterThan(1);

    const built = buildObservation(sourcesFor(f), BRAM);
    const offered = built.observation.affordances.filter((a) => a.verb === 'fill_role');
    expect(offered.length).toBeGreaterThan(0);
    const paged = built.observation.header.withheld.find(
      (row) => row.field === 'affordances' && row.ground === 'PAGED',
    );
    expect(paged?.count ?? 0).toBeGreaterThanOrEqual(free.length - 1);
    // PROP-O1's arithmetic, which is the half a bare count could fake.
    expect(built.accounting).toEqual([]);
  });

  it('a board slot’s worst case matches its fill_role affordance exactly', () => {
    // Two numbers for one worst case is scar #5 aimed at the honesty guarantee.
    const f = fixture();
    makeHaul(f, { creator: ALICE });
    const built = buildObservation(sourcesFor(f), BRAM);
    for (const slot of built.observation.ventures.board) {
      const affordance = built.observation.affordances.find(
        (a) =>
          a.verb === 'fill_role' &&
          a.params['venture'] === slot.venture &&
          a.params['role_index'] === slot.role_index,
      );
      if (affordance === undefined) continue;
      expect(slot.worst_case).toBe(affordance.max_direct_loss);
    }
  });
});

describe('slotForecast agrees with the preview it lifts the holder out of', () => {
  it('matches takeAtPercentile exactly for a role that is held', () => {
    const f = fixture();
    const haul = makeHaul(f, {
      carrier: wage(1_000, 1_000),
      escort: share(3_000 as Bps, 500, 700),
    });
    goLive(f, haul, [BRAM, CASS], minor(12_000));

    for (const percentile of PERCENTILES) {
      for (const role of haul.roles) {
        const holder = role.filledByPrincipal;
        expect(holder).not.toBeNull();
        if (holder === null) continue;
        const viaPreview = takeAtPercentile(haul, holder, percentile);
        const viaForecast = slotClaimAt(haul, role.index, percentile);
        expect(viaPreview).not.toBeNull();
        expect(viaForecast.claim).toBe(viaPreview?.take);
        expect(viaForecast.escrowedDue).toBe(viaPreview?.escrowedPart);
        expect(viaForecast.electiveDue).toBe(viaPreview?.electivePart);
      }
    }
  });

  it('is monotone across the band — p10 <= p50 <= p90 for a share role', () => {
    const f = fixture();
    const haul = makeHaul(f, { escort: share(3_000 as Bps, 500, 700) });
    const forecast = slotForecast(haul, 1);
    expect(forecast.p10).toBeLessThanOrEqual(forecast.p50);
    expect(forecast.p50).toBeLessThanOrEqual(forecast.p90);
  });

  it('is flat across the band for a wage role — a fixed claim is not a forecast', () => {
    const f = fixture();
    const haul = makeHaul(f, { carrier: wage(1_000, 1_000) });
    const forecast = slotForecast(haul, 0);
    expect(forecast.p10).toBe(forecast.p50);
    expect(forecast.p50).toBe(forecast.p90);
  });

  it('quotes a full fill, so a slot’s EV does not move when a rival joins', () => {
    const f = fixture();
    const top = makeTopYield(f, 'BUILD', vid('v-build-2'), ALICE);
    const before = slotForecast(top, 3);
    fill(f, top, 0, BRAM, 1);
    const after = slotForecast(top, 3);
    expect(after).toEqual(before);
  });
});

describe('the Commons floor decides, not the catalogue', () => {
  it('withholds hostile venture kinds in the Commons and offers the peaceful ones', () => {
    const f = fixture();
    const built = buildObservation(sourcesFor(f), ALICE);
    const kinds = built.observation.affordances
      .filter((a) => a.verb === 'create')
      .map((a) => a.params['kind']);
    expect(kinds).toContain('HAUL');
    expect(kinds).toContain('DIG');
    expect(kinds).not.toContain('RAID');
    expect(kinds).not.toContain('SIEGE');
  });

  it('withholds a seizure ballot with no resolvable target — the floor fails closed', () => {
    const f = fixture();
    const built = buildObservation(
      sourcesFor(f, {
        ballots: [{ id: 'b-seize', kind: 'SEIZURE', closes_tick: 200, voted: false, target: null }],
      }),
      ALICE,
    );
    expect(built.observation.affordances.some((a) => a.verb === 'vote')).toBe(false);
    expect(built.observation.header.withheld.some((r) => r.ground === 'COMMONS_FLOOR')).toBe(true);
  });

  it('offers the Levy ballot, because a vote must never be priced out', () => {
    const f = fixture();
    const built = buildObservation(
      sourcesFor(f, {
        actionsRemaining: 0,
        ballots: [{ id: 'b-levy', kind: 'LEVY', closes_tick: 200, voted: false, target: null }],
      }),
      ALICE,
    );
    const vote = built.observation.affordances.find((a) => a.verb === 'vote');
    expect(vote).toBeDefined();
    expect(vote?.cost).toBe(0);
  });
});

describe('the move affordance prices only what can actually be lost', () => {
  it('is zero on a Commons-to-Commons crossing, because A8 makes the loss impossible', () => {
    const f = fixture();
    const built = buildObservation(sourcesFor(f), ALICE);
    const moves = built.observation.affordances.filter((a) => a.verb === 'move');
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) expect(move.max_direct_loss).toBe(0);
  });

  it('publishes no move for a Commons-bound hand aimed outside the Commons', () => {
    // A15's outbound half, and it gets its own ground so an agent knows to buy a
    // holding rather than to pick a different target.
    const f = fixture();
    const built = buildObservation(sourcesFor(f), ALICE);
    const destinations = new Set(
      built.observation.affordances.filter((a) => a.verb === 'move').map((a) => a.params['to']),
    );
    const commons = new Set(
      [...f.world.map.systems.values()].filter((s) => s.tier === 'COMMONS').map((s) => s.id),
    );
    for (const destination of destinations) {
      expect(commons.has(destination as never)).toBe(true);
    }
    expect(built.observation.header.withheld.some((r) => r.ground === 'COMMONS_BOUND')).toBe(true);
  });
});
