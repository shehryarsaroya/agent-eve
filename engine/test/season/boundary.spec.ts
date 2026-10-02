/**
 * THE SEASON BOUNDARY (A10): what resets, and — the half that is easier to break — what never does.
 *
 * > *"Identity, standing, relationships, grudges, holdings, hands and legend **never** reset. Frontier
 * > claims and a named slice of Frontier-deployed capital settle and re-open on a season boundary.
 * > Commons and Marches holdings are untouched."* — A10
 *
 * Built through the front door: claims are raised with `post_bond` + `build {kind:"ANCHOR"}`, the war
 * with `build {kind:"CAMPAIGN"}`, the mandate with `grant`. The only bypass is the goods and capital
 * the fixture hands out, which is what `test/campaign/fixture.ts` does for the same reason.
 */

import { describe, expect, it } from 'vitest';
import type { EventId, GoodId, PrincipalId, SystemId } from '../../src/core/types.js';
import { qty } from '../../src/core/units.js';
import { GOODS_FAUCET, storesAccount } from '../../src/ledger/index.js';
import { finaleTickOf, seasonOf } from '../../src/season/index.js';
import { ANCHOR_QTY, CHARGE_GOOD, CLAIM_BOND_MINOR } from '../../src/sovereignty/params.js';
import { claimLegend } from '../../src/sovereignty/view.js';
import { ALLOY_ANCHOR_QTY, ALLOY_GOOD } from '../../src/works/params.js';
import { CAMPAIGN_BOND_MINOR, MATERIEL_GOOD, PULSE_MATERIEL_QTY } from '../../src/campaign/index.js';
import { neighboursOf, tierOf } from '../../src/world/index.js';
import type { Runtime } from '../../src/sim/runtime.js';
import { act, earn, finaleWorld, runTo, tick, WINDOW } from './fixture.js';

const P = (s: string): PrincipalId => `p:${s}` as PrincipalId;

function stock(runtime: Runtime, principal: PrincipalId, system: SystemId, good: GoodId, amount: number): void {
  runtime.ledger.sourceGoods({
    eventId: `test.stock:${principal}:${good}:${system}:${String(runtime.engine.tick)}:${String(amount)}` as EventId,
    tick: Math.max(0, runtime.engine.tick),
    faucet: GOODS_FAUCET.PRODUCTION,
    to: storesAccount(principal),
    good,
    qty: qty(amount),
    location: system,
    origin: principal,
  });
}

function anchor(runtime: Runtime, principal: PrincipalId, system: SystemId): void {
  stock(runtime, principal, system, CHARGE_GOOD, ANCHOR_QTY * 3);
  stock(runtime, principal, system, ALLOY_GOOD, ALLOY_ANCHOR_QTY);
  earn(runtime, principal, CLAIM_BOND_MINOR * 3, 'bond');
  tick(runtime);
  expect(act(runtime, principal, 'post_bond', { amount: CLAIM_BOND_MINOR })).toBeNull();
  expect(act(runtime, principal, 'build', { kind: 'ANCHOR', system })).toBeNull();
  expect(runtime.sovereignty.liveAt(system)?.claimant).toBe(principal);
}

/** Everything A10 says never resets, as one comparable value per principal. */
function untouchable(runtime: Runtime, principals: readonly PrincipalId[]): unknown {
  return principals.map((p) => {
    const holdingId = runtime.world.holdingByPrincipal.get(p);
    const holding = holdingId === undefined ? undefined : runtime.world.holdings.get(holdingId);
    return {
      principal: p,
      holding: holding === undefined ? null : { id: holding.id, name: holding.name, system: holding.system },
      hands: [...runtime.world.hands.values()]
        .filter((h) => h.principal === p)
        .map((h) => ({ id: h.id, location: h.location }))
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
      standing: { ...runtime.standing.row(p) },
      balance: runtime.ledger.balance(storesAccount(p)),
    };
  });
}

describe('the season boundary (A10)', () => {
  it('closes every Frontier claim, ends its war MOOT, leaves Marches ground and everything else untouched', () => {
    const frontierDefender = P('fdef');
    const marchesDefender = P('mdef');
    const attacker = P('att');
    const grantor = P('grantor');
    const delegate = P('deleg');
    const everyone = [frontierDefender, marchesDefender, attacker, grantor, delegate];

    // A Frontier system with a non-Commons neighbour for the depot, and a Marches system.
    const probe = finaleWorld('season-boundary-map', []);
    const map = probe.runtime.world.map;
    const frontier = map.systemOrder.find(
      (s) => tierOf(map, s) === 'FRONTIER' && neighboursOf(map, s).some((n) => tierOf(map, n) !== 'COMMONS'),
    );
    const marches = map.systemOrder.find((s) => tierOf(map, s) === 'MARCHES');
    if (frontier === undefined || marches === undefined) throw new Error('the launch map lacks the tiers');
    const depot = neighboursOf(map, frontier).find((n) => tierOf(map, n) !== 'COMMONS');
    if (depot === undefined) throw new Error('no depot');

    const w = finaleWorld('season-boundary', [], { firstTick: WINDOW.opens_tick });
    const runtime = w.runtime;
    runtime.seat(frontierDefender, 'fdef', frontier);
    runtime.seat(marchesDefender, 'mdef', marches);
    runtime.seat(attacker, 'att', depot);
    runtime.seat(grantor, 'grantor', marches);
    runtime.seat(delegate, 'deleg', marches);
    for (const p of everyone) runtime.standing.open(p);
    tick(runtime);

    anchor(runtime, frontierDefender, frontier);
    anchor(runtime, marchesDefender, marches);
    const frontierClaim = runtime.sovereignty.liveAt(frontier);
    const marchesClaim = runtime.sovereignty.liveAt(marches);
    if (frontierClaim === null || marchesClaim === null) throw new Error('the claims did not form');

    // A war on the Frontier claim, declared through the front door.
    earn(runtime, attacker, CAMPAIGN_BOND_MINOR * 3, 'war-chest');
    stock(runtime, attacker, depot, MATERIEL_GOOD, PULSE_MATERIEL_QTY * 4);
    tick(runtime);
    expect(act(runtime, attacker, 'build', { kind: 'CAMPAIGN', system: frontier })).toBeNull();
    const war = runtime.campaigns.liveAgainst(frontier);
    if (war === null) throw new Error('no campaign');

    // A mandate that must survive the season untouched.
    earn(runtime, grantor, 100_000, 'grant');
    tick(runtime);
    expect(
      act(runtime, grantor, 'grant', {
        to: delegate,
        template: 'treasury-hand',
        max_direct_loss: 5_000,
        max_contingent_liability: 5_000,
        expires_tick: finaleTickOf(1) + 100,
      }),
    ).toBeNull();
    const grant = runtime.grants.all().find((g) => g.grantor === grantor);
    if (grant === undefined) throw new Error('no grant');

    const bondLock = runtime.sovereignty.bondLocksOf(frontierDefender)[0];
    if (bondLock === undefined) throw new Error('no bond lock');
    const bondAmount = runtime.ledger.encumbrances.get(bondLock)?.amountMinor;

    runTo(runtime, finaleTickOf(1) - 1);
    const before = untouchable(runtime, everyone);
    tick(runtime); // ★ the FINALE's settlement tick, and the boundary at its close
    expect(runtime.engine.tick).toBe(finaleTickOf(1));

    // ── WHAT RESETS ──────────────────────────────────────────────────────────
    const closed = runtime.sovereignty.at(frontier);
    expect(closed?.state).toBe('SEASON_ENDED');
    // ★ The legend says what happened and that nothing was taken — `LAPSED · BOND SLASHED`'s counterpart.
    expect(claimLegend('SEASON_ENDED', 0)).toBe('SEASON ENDED · BOND UNTOUCHED');
    expect(
      runtime.events
        .eventsAtTick(runtime.engine.tick)
        .filter((e) => e.event.kind === 'claim.season_ended')
        .map((e) => e.event.payload['system']),
      'the record names the ending in the same word as the claim book',
    ).toEqual([frontier]);
    expect(runtime.sovereignty.liveAt(frontier)).toBeNull();
    const ended = runtime.campaigns.get(war.id);
    expect(ended?.state).toBe('MOOT');
    expect(ended?.returned).toBe(war.bond);
    expect(ended?.forfeited).toBe(0);
    const record = runtime.seasons.last();
    expect(record?.season).toBe(1);
    expect(record?.seasonEndedClaims).toEqual([{ system: frontier, claimant: frontierDefender }]);
    expect(record?.mootedCampaigns).toEqual([war.id]);
    expect(record?.grand.outcome).toBe('UNCLAIMED');

    // ── WHAT NEVER DOES ──────────────────────────────────────────────────────
    // The Marches claim stands, under the same id, with the same claimant.
    expect(runtime.sovereignty.liveAt(marches)?.id).toBe(marchesClaim.id);
    // The Frontier claimant's bond is its credit rating, not the claim's: still posted, same amount.
    expect(runtime.ledger.encumbrances.isOpen(bondLock)).toBe(true);
    expect(runtime.ledger.encumbrances.get(bondLock)?.amountMinor).toBe(bondAmount);
    // Identity, holdings, hands, standing and stores: byte-for-byte what they were the tick before.
    expect(untouchable(runtime, everyone)).toEqual(before);
    // The grant: same row, same limits, not revoked.
    const after = runtime.grants.get(grant.id);
    expect(after?.revokedAtTick).toBeNull();
    expect(after?.maxDirectLoss).toBe(grant.maxDirectLoss);

    // ── AND THE GROUND RE-OPENS ──────────────────────────────────────────────
    tick(runtime);
    expect(seasonOf(runtime.engine.tick)).toBe(2);
    expect(runtime.seasons.closedThrough).toBe(1);
    // The same principal may raise a fresh claim on the re-opened system: a new epoch, not the old row.
    stock(runtime, frontierDefender, frontier, CHARGE_GOOD, ANCHOR_QTY * 3);
    stock(runtime, frontierDefender, frontier, ALLOY_GOOD, ALLOY_ANCHOR_QTY);
    tick(runtime);
    expect(act(runtime, frontierDefender, 'build', { kind: 'ANCHOR', system: frontier })).toBeNull();
    const reopened = runtime.sovereignty.liveAt(frontier);
    expect(reopened?.claimant).toBe(frontierDefender);
    expect(reopened?.epoch).toBe(frontierClaim.epoch + 1);
  });
});
