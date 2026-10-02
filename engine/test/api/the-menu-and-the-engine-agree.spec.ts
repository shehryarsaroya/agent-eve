/**
 * ★ **THE MENU AND THE ENGINE AGREE — for a principal a grant restricts.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A house cast member playing under a real model wrote this in its own public reason line:
 *
 *     "That Sable slot is barred by my grant despite the menu… I'll audit the authority trail"
 *
 * It was right. It held a grant from `sable`, so §8.1 #3's self-dealing guard (INV-23) refuses it a
 * role in any venture `sable` created while the grant was live — and `ventures.board[]` and the
 * `fill_role` affordance offered it that exact slot anyway. The board was built from its own short
 * eligibility list (FORMING, inside the window, not already a party) and the authority rule lived
 * only inline in `vFillRole`. The agent copied the affordance verbatim, spent an action, and was
 * refused: AGT-S2, and scar #1's shape — two surfaces, each coherent, disagreeing about one rule.
 *
 * **The general cause is a rule with one reader**, and the fix is one home with three:
 * `Runtime.fillRoleAuthorityRefusal` (the handler, the board and the heuristic cast all call it),
 * `Runtime.fillSlotRefusalFor` (the slot's own rules, asked at the tick the fill would land in) and
 * `Runtime.ventureGateRefusalFor` (the verb table's gates in front of the handler).
 *
 * What this file asserts, each preceded by the non-vacuity check its claim rests on:
 *
 *   1. a delegate is NOT offered a slot its grant bars it from, and is TOLD so in `withheld`;
 *   2. the bar is real — the same act sent by hand is refused INV-23 — so (1) is not a filter
 *      hiding a slot the engine would have accepted;
 *   3. every `fill_role` the delegate IS offered is accepted by the engine, sent verbatim;
 *   4. across a seeded heuristic world where the cast grants and fills on its own, no delegate is
 *      ever offered a fill the engine then refuses on authority.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { inFreeze, setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { EventId, PrincipalId, SystemId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { buildObservation } from '../../src/api/observe.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { CURRENCY_FAUCET, storesAccount } from '../../src/ledger/index.js';
import { finaleTickOf } from '../../src/season/index.js';
import { commonsSystems, handsOf, holdingOf, tierOf } from '../../src/world/index.js';
import { Runtime, type PendingCorrection } from '../../src/sim/runtime.js';
import { finaleWorld, idleAt, WINDOW } from '../season/fixture.js';

type Row = Record<string, unknown>;

interface World {
  readonly runtime: Runtime;
  readonly grantor: PrincipalId;
  readonly delegate: PrincipalId;
  readonly outsider: PrincipalId;
  readonly stage: SystemId;
}

function world(seed: string): World {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const stage = commonsSystems(runtime.world.map)[0];
  if (stage === undefined) throw new Error('the launch map has no Commons system');
  const grantor = 'p:sable' as PrincipalId;
  const delegate = 'p:ferren' as PrincipalId;
  const outsider = 'p:outsider' as PrincipalId;
  runtime.seat(grantor, 'sable', stage);
  runtime.seat(delegate, 'ferren', stage);
  runtime.seat(outsider, 'outsider', stage);
  for (const p of [grantor, delegate, outsider]) runtime.standing.open(p);
  return { runtime, grantor, delegate, outsider, stage };
}

let sequence = 0;

/** Submit one act, run the tick, and return the refusal (via the correction channel) or null. */
function act(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  params: Readonly<Record<string, unknown>>,
): PendingCorrection | null {
  sequence += 1;
  const outcome = runtime.engine.submit({
    principal,
    verb,
    params,
    clientSequence: sequence,
    arrivalMs: 0,
    decisionSource: 'LIVE',
  });
  if (!outcome.ok) throw new Error(`submit ${verb} refused at the door: ${outcome.invariant} ${outcome.hint}`);
  const report = runtime.runTick();
  if (report.halted) {
    throw new Error(`${verb} halted the world: ${report.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`);
  }
  return runtime.takeCorrections(principal).find((c) => c.verb === verb) ?? null;
}

function observe(runtime: Runtime, principal: PrincipalId): Row {
  return buildObservation({
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 16,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  }) as unknown as Row;
}

function board(o: Row): Row[] {
  return ((o['ventures'] as Row)['board'] ?? []) as Row[];
}

function fills(o: Row): Row[] {
  return ((o['affordances'] ?? []) as Row[]).filter((a) => a['verb'] === 'fill_role');
}

function withheld(o: Row): Row {
  return ((o['header'] as Row)['withheld'] ?? {}) as Row;
}

function reasonOf(o: Row): string {
  const reason = withheld(o)['reason'];
  return typeof reason === 'string' ? reason : '';
}

const WIDE = {
  delegate: 'p:ferren',
  template: 'steward',
  max_direct_loss: 250_000,
  max_contingent_liability: 250_000,
  expires_tick: 200,
};

describe('a delegate is offered exactly the fills the engine will take', () => {
  it('★ the grantor’s slot is not offered, is counted, and is really refused; every other slot is taken', () => {
    const w = world('menu-engine-agree');
    // The grant first, so it is live when the grantor's venture is created — which is the tick
    // INV-23 asks about.
    expect(act(w.runtime, w.grantor, 'grant', WIDE)).toBeNull();
    expect(act(w.runtime, w.grantor, 'create', { kind: 'HAUL', value: 12_000, stage: w.stage })).toBeNull();
    expect(act(w.runtime, w.outsider, 'create', { kind: 'HAUL', value: 12_000, stage: w.stage })).toBeNull();
    // Minted hands are not present until a tick has passed.
    w.runtime.runTick();

    const barredVenture = w.runtime.ventures.forPrincipal(w.grantor).find((v) => v.creator === w.grantor);
    const openVenture = w.runtime.ventures.forPrincipal(w.outsider).find((v) => v.creator === w.outsider);
    expect(barredVenture, 'non-vacuity: the grantor must have a FORMING venture').toBeDefined();
    expect(openVenture, 'non-vacuity: the outsider must have a FORMING venture').toBeDefined();
    if (barredVenture === undefined || openVenture === undefined) return;
    expect(
      w.runtime.grants.liveGrantBetween(w.grantor, w.delegate, barredVenture.windowOpensTick),
      'non-vacuity: the delegate must hold a live grant over the creator at creation',
    ).not.toBeNull();

    // ── 1. NOT OFFERED, AND TOLD ────────────────────────────────────────────
    const seen = observe(w.runtime, w.delegate);
    const rows = board(seen);
    expect(rows.some((r) => r['venture'] === openVenture.id), 'the outsider’s slots must be on the board').toBe(true);
    expect(
      rows.some((r) => r['venture'] === barredVenture.id),
      'REGRESSION: the board offers a slot the delegate’s own grant bars it from (INV-23)',
    ).toBe(false);
    expect(fills(seen).some((a) => (a['params'] as Row)['venture'] === barredVenture.id)).toBe(false);
    const why = reasonOf(seen);
    expect(why, 'the omission must be counted with its rule, not silent (PROP-O1)').toContain('INV-23');
    expect(why).toContain(barredVenture.id);
    expect(Number(withheld(seen)['count'])).toBeGreaterThan(0);

    // The outsider, who holds no grant, sees the grantor's slot: the filter is about authority,
    // not about the slot.
    expect(board(observe(w.runtime, w.outsider)).some((r) => r['venture'] === barredVenture.id)).toBe(true);

    // ── 2. THE BAR IS REAL ──────────────────────────────────────────────────
    //
    // Sent by hand with a real hand at the stage — the act the old menu used to offer.
    const hand = handsOf(w.runtime.world, w.delegate)[0];
    const open = barredVenture.roles.find((r) => r.filledByPrincipal === null);
    expect(hand !== undefined && open !== undefined).toBe(true);
    if (hand === undefined || open === undefined) return;
    expect(w.runtime.fillRoleAuthorityRefusal(w.delegate, barredVenture)?.invariant).toBe('INV-23');

    // ── 3. EVERY OFFERED FILL IS ACCEPTED, SENT VERBATIM ───────────────────
    const offered = fills(seen);
    expect(offered.length, 'non-vacuity: the delegate must be offered at least one fill').toBeGreaterThan(0);
    const first = offered[0];
    if (first === undefined) return;
    expect(
      act(w.runtime, w.delegate, 'fill_role', first['params'] as Row),
      'an offered fill_role copied verbatim must never be refused (AGT-S2)',
    ).toBeNull();
    const filled = w.runtime.ventures.get(openVenture.id);
    expect(filled?.roles.some((r) => r.filledByPrincipal === w.delegate)).toBe(true);

    // And now the hand-crafted barred fill: refused, by name, by the engine.
    const refusal = act(w.runtime, w.delegate, 'fill_role', {
      venture: barredVenture.id,
      role: open.index,
      hand: handsOf(w.runtime.world, w.delegate).find((h) => h.state === 'IDLE')?.id ?? hand.id,
    });
    expect(refusal?.invariant, 'the engine must refuse the slot the menu left off').toBe('INV-23');
  }, 120_000);

  it('a slot on the last tick of its window is not offered, because the fill would land after it', () => {
    const w = world('menu-engine-window');
    expect(act(w.runtime, w.outsider, 'create', { kind: 'HAUL', value: 12_000, stage: w.stage })).toBeNull();
    const venture = w.runtime.ventures.forPrincipal(w.outsider)[0];
    expect(venture).toBeDefined();
    if (venture === undefined) return;
    // Walk to the observation tick equal to the window's close. An act sent from it resolves one
    // tick later, outside the window, and the allocation refuses it there.
    while (w.runtime.engine.tick < venture.windowClosesTick) w.runtime.runTick();
    expect(w.runtime.engine.tick).toBe(venture.windowClosesTick);
    const seen = observe(w.runtime, w.delegate);
    expect(
      board(seen).some((r) => r['venture'] === venture.id),
      'REGRESSION: a slot whose window closes before an act sent now could land is on the board',
    ).toBe(false);
  }, 60_000);

  it('★ a principal that owes a seal is offered neither create nor fill_role — and the engine agrees', () => {
    // The verb table puts `committing ?? sealCompliance ?? commonsCapacityRejection` in front of BOTH
    // `create` and `fill_role`, and the menu checked none of the three. A role-holder in a LIVE venture
    // that has not sealed is refused both (PROP-D4) — so it must be offered neither, and told why.
    const w = world('menu-engine-seal');
    expect(act(w.runtime, w.grantor, 'create', { kind: 'HAUL', value: 12_000, stage: w.stage })).toBeNull();
    w.runtime.runTick();
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    expect(v, 'non-vacuity: a FORMING venture to fill').toBeDefined();
    if (v === undefined) return;
    for (const [who, role] of [
      [w.delegate, 0],
      [w.outsider, 1],
    ] as const) {
      const hand = handsOf(w.runtime.world, who).find((x) => x.state === 'IDLE');
      expect(act(w.runtime, who, 'fill_role', { venture: v.id, role, hand: hand?.id })).toBeNull();
    }
    for (const who of [w.delegate, w.outsider]) {
      const row = ((observe(w.runtime, who)['affordances'] ?? []) as Row[]).find(
        (a) => a['verb'] === 'sign' && (a['params'] as Row)['venture'] === v.id,
      );
      expect(row, 'non-vacuity: the filler is offered its countersignature').toBeDefined();
      expect(act(w.runtime, who, 'sign', row?.['params'] as Row)).toBeNull();
    }
    expect(w.runtime.ventures.get(v.id)?.state, 'non-vacuity: the venture bound').toBe('LIVE');
    expect(w.runtime.sealableRoles(w.delegate, w.runtime.engine.tick + 1).length, 'and it owes a seal').toBeGreaterThan(0);

    const seen = observe(w.runtime, w.delegate);
    const offered = (seen['affordances'] ?? []) as Row[];
    expect(offered.some((a) => a['verb'] === 'seal'), 'the seal itself is offered').toBe(true);
    expect(offered.some((a) => a['verb'] === 'create'), 'REGRESSION: create offered to a principal owing a seal').toBe(false);
    expect(offered.some((a) => a['verb'] === 'fill_role'), 'REGRESSION: fill_role offered to a principal owing a seal').toBe(false);
    expect(reasonOf(seen)).toContain('PROP-D4');
    // The engine's answer to the act the menu withheld.
    const refused = act(w.runtime, w.delegate, 'create', { kind: 'HAUL', value: 12_000, stage: w.stage });
    expect(refused?.invariant, 'the engine refuses it for the reason the menu gave').toBe('PROP-D4');
  }, 120_000);
});

describe('the menu asks the engine’s clock at the tick an act LANDS, not the tick it is read', () => {
  it('★ an observation whose acts land in the freeze offers nothing the freeze refuses — and says so', () => {
    // Measured before the fix, at observation tick 285 of a six-member world (acts land at 286, the
    // freeze): every member was offered `graduate`, `refine`, `post_bond` and `form`, and the engine
    // refused each one with INV-18. The freeze set is now one home (`Runtime.COMMITTING_VERBS`), the
    // verb table applies it, and the menu withholds it at `tick + 1` with the engine's sentence.
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'menu-engine-freeze' });
    const cast = new HeuristicCast(runtime, { size: 6 });
    const members = cast.seat('menu-engine-freeze');
    const lastBeforeFreeze = TICKS_PER_RECKONING - 3; // reads 285; an act sent now lands at 286
    while (runtime.engine.tick < lastBeforeFreeze) {
      for (const a of cast.decide(runtime.engine.tick + 1, 'menu-engine-freeze')) runtime.engine.submit(a);
      expect(runtime.runTick().halted).toBe(false);
    }
    const landsAt = runtime.engine.tick + 1;
    expect(inFreeze(landsAt), 'non-vacuity: acts sent now land in the freeze').toBe(true);

    const refusedByTheClock = new Set([...Runtime.COMMITTING_VERBS, 'elect', 'deliver']);
    let gatedSomewhere = 0;
    for (const m of members) {
      const seen = observe(runtime, m.principal);
      const offered = ((seen['affordances'] ?? []) as Row[]).map((a) => String(a['verb']));
      const bad = offered.filter((v) => refusedByTheClock.has(v));
      expect(bad, `REGRESSION: ${m.principal} is offered acts the freeze refuses on landing`).toEqual([]);
      if (reasonOf(seen).includes(`lands on tick ${String(landsAt)}`)) gatedSomewhere += 1;
    }
    expect(gatedSomewhere, 'non-vacuity: some member had an act withheld, with the reason named').toBeGreaterThan(0);

    // And the engine agrees about the act the menu withheld: a refine sent now is refused INV-18.
    const holder = members.find((m) => runtime.refinableAt(m.principal, holdingOf(runtime.world, m.principal).system) > 0);
    expect(holder, 'non-vacuity: some member holds a refinable batch at its body on the freeze eve').toBeDefined();
    if (holder === undefined) return;
    const system = holdingOf(runtime.world, holder.principal).system;
    const refusal = act(runtime, holder.principal, 'refine', { system });
    expect(refusal?.invariant, 'the freeze refuses what the menu withheld').toBe('INV-18');
  }, 300_000);
});

describe('across a world nobody steers, no delegate is offered a fill the engine refuses on authority', () => {
  it('★ every offered fill_role to a grant-holder is accepted, over a seeded heuristic world', () => {
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'menu-engine-sweep' });
    const cast = new HeuristicCast(runtime, { size: 10 });
    cast.seat('menu-engine-sweep');

    let delegateObservations = 0;
    let offeredToDelegates = 0;
    /** (delegate, slot) pairs the RULE bars, counted off the world rather than off the menu. */
    let barredSlotsInWorld = 0;
    /** Offered `fill_role` rows naming a slot the rule bars. The menu's claim, checked directly. */
    let offeredBarred = 0;
    let barredCounted = 0;
    const submitted: { principal: PrincipalId; venture: string }[] = [];
    let authorityRefusals = 0;

    for (let n = 0; n < 900; n += 1) {
      const next = runtime.engine.tick + 1;
      for (const action of cast.decide(next, 'menu-engine-sweep')) runtime.engine.submit(action);

      // Every 9 ticks, read the menu of every principal currently holding a grant from someone,
      // and send the first fill it is offered exactly as offered.
      if (n % 9 === 4) {
        const delegates = new Set<PrincipalId>();
        for (const g of runtime.grants.all()) {
          if (runtime.grants.isLive(g.id, runtime.engine.tick)) delegates.add(g.delegate);
        }
        for (const d of [...delegates].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
          // The rule's subject, measured off the ventures: slots this delegate's grant bars it from.
          const barred = new Set<string>();
          for (const v of runtime.ventures.live()) {
            if (v.state !== 'FORMING' || v.windowClosesTick < next) continue;
            if (v.roles.every((r) => r.filledByPrincipal !== null)) continue;
            if (runtime.fillRoleAuthorityRefusal(d, v) === null) continue;
            barred.add(v.id);
            barredSlotsInWorld += 1;
          }
          const seen = observe(runtime, d);
          delegateObservations += 1;
          if (barred.size > 0 && reasonOf(seen).includes('INV-23')) barredCounted += 1;
          const offers = fills(seen);
          offeredBarred += offers.filter((a) => barred.has(String((a['params'] as Row)['venture']))).length;
          const offer = offers[0];
          if (offer === undefined) continue;
          offeredToDelegates += 1;
          const out = runtime.engine.submit({
            principal: d,
            verb: 'fill_role',
            params: offer['params'] as Row,
            clientSequence: 9_000 + n,
            arrivalMs: 0,
            decisionSource: 'LIVE',
          });
          if (out.ok) submitted.push({ principal: d, venture: String((offer['params'] as Row)['venture']) });
        }
      }

      const report = runtime.runTick();
      expect(report.halted, 'the world must not halt').toBe(false);
      for (const s of submitted.splice(0)) {
        for (const c of runtime.peekCorrections(s.principal)) {
          if (c.verb === 'fill_role' && c.invariant === 'INV-23' && c.params['venture'] === s.venture) {
            authorityRefusals += 1;
          }
        }
      }
    }

    // Non-vacuity, in the order the claim depends on it: the cast granted, somebody was offered a
    // fill, and the RULE had a subject in this world — measured off the ventures rather than off
    // the menu, so a menu that silently dropped the rule could not make this pass.
    expect(delegateObservations, 'the cast must have granted authority to somebody').toBeGreaterThan(0);
    expect(offeredToDelegates, 'some delegate must have been offered a fill').toBeGreaterThan(0);
    expect(
      barredSlotsInWorld,
      'some delegate must have stood beside a slot its grant bars, or this sweep never met the rule',
    ).toBeGreaterThan(0);
    expect(
      offeredBarred,
      'REGRESSION: a delegate was offered a fill_role on a slot its own grant bars it from (INV-23)',
    ).toBe(0);
    expect(
      authorityRefusals,
      'REGRESSION: a delegate was offered a fill_role that the engine refused on authority (INV-23)',
    ).toBe(0);
    expect(barredCounted, 'and when a slot was barred, the menu must have said so in withheld').toBeGreaterThan(0);
    // A heuristic world of 900 ticks; slow under a loaded machine, hence the bound.
  }, 900_000);
});

// ══════════════════════════════════════════════════════════════════════════
// ★ THE TWO CREATES SEASON 1 ADDED TO THE MENU, HELD TO THE SAME RULE (Season 1 merge)
//
// The season lane offers `create {"kind":"BUILD","grand":true}` in the FINALE and the contact lane offers
// `create {"kind":"SIEGE"}` outside the Commons. Both were written against a base where the menu asked
// its questions at the tick it was READ; the stakes lane moved every question to the tick the act LANDS
// and put the verb table's gates in front of every create. These cases hold both new offers to that.
// ══════════════════════════════════════════════════════════════════════════

/** The create affordances an observation offers, by kind (`GRAND` for the grand venture). */
function createsOffered(o: Row): Map<string, Row> {
  const out = new Map<string, Row>();
  for (const a of (o['affordances'] ?? []) as Row[]) {
    if (a['verb'] !== 'create') continue;
    const params = a['params'] as Row;
    out.set(params['grand'] === true ? 'GRAND' : String(params['kind']), a);
  }
  return out;
}

describe('the season’s grand create and the SIEGE create are offered exactly when the engine takes them', () => {
  it('★ the grand create is offered from the tick before its window to the tick before it closes — never after — and each offer is taken', () => {
    const early = 'p:early' as PrincipalId;
    const late = 'p:late' as PrincipalId;
    const tooLate = 'p:toolate' as PrincipalId;
    // The world's first tick is the FINALE's first, so the observation before it reads `opens - 1`.
    const w = finaleWorld('menu-engine-grand', [early, late, tooLate]);
    const rt = w.runtime;
    expect(rt.engine.tick, 'non-vacuity: reading the tick before the window opens').toBe(WINDOW.opens_tick - 1);

    // ── THE OPENING EDGE: an act sent now lands on the window's first tick, so it is offered ──
    const atOpen = createsOffered(observe(rt, early)).get('GRAND');
    expect(atOpen, 'REGRESSION: the tick before the window withholds a create that lands inside it').toBeDefined();
    expect(act(rt, early, 'create', atOpen?.['params'] as Row), 'offered, sent verbatim, accepted').toBeNull();
    expect(rt.ventures.all().filter((v) => v.grand !== null && v.creator === early)).toHaveLength(1);

    // ── THE CLOSING EDGE: offered on the last tick whose act still lands inside the window ──
    while (rt.engine.tick < WINDOW.closes_tick - 1) rt.runTick();
    const lastChance = createsOffered(observe(rt, late)).get('GRAND');
    expect(lastChance, 'the last tick an act can still land inside the window offers it').toBeDefined();

    // ── AND NOT ONE TICK LATER, WITH THE ENGINE'S OWN SENTENCE ─────────────────────────────
    rt.runTick();
    expect(rt.engine.tick).toBe(WINDOW.closes_tick);
    const closed = observe(rt, tooLate);
    expect(
      createsOffered(closed).has('GRAND'),
      'REGRESSION: the window’s last tick offers a create that lands after it closes',
    ).toBe(false);
    expect(reasonOf(closed), 'withheld, and told why (PROP-O1)').toContain(`was ${String(WINDOW.closes_tick)}`);
    // The engine agrees about the act the menu withheld.
    const refused = act(rt, tooLate, 'create', { kind: 'BUILD', stage: w.stage, grand: true });
    expect(refused?.invariant, 'the engine refuses what the menu withheld').toBe('A14');
  }, 300_000);

  it('★ a principal that owes a seal is offered neither the grand create nor a SIEGE — and the engine agrees', () => {
    const payer = 'p:payer' as PrincipalId;
    const hauler = 'p:hauler' as PrincipalId;
    const w = finaleWorld('menu-engine-grand-seal', [payer, hauler]);
    const rt = w.runtime;
    // A HAUL the two of them bind, so each holds a role in a LIVE venture it has not sealed (PROP-D4).
    expect(act(rt, payer, 'create', { kind: 'HAUL', value: 12_000, stage: w.stage })).toBeNull();
    rt.runTick();
    const v = rt.ventures.forPrincipal(payer).find((x) => x.grand === null);
    if (v === undefined) throw new Error('no HAUL formed');
    for (const [who, role] of [
      [payer, 0],
      [hauler, 1],
    ] as const) {
      expect(act(rt, who, 'fill_role', { venture: v.id, role, hand: idleAt(rt, who, w.stage) })).toBeNull();
    }
    for (const who of [payer, hauler]) {
      const sign = ((observe(rt, who)['affordances'] ?? []) as Row[]).find(
        (a) => a['verb'] === 'sign' && (a['params'] as Row)['venture'] === v.id,
      );
      if (sign !== undefined) expect(act(rt, who, 'sign', sign['params'] as Row)).toBeNull();
    }
    expect(rt.ventures.get(v.id)?.state, 'non-vacuity: the HAUL bound').toBe('LIVE');
    expect(rt.sealableRoles(hauler, rt.engine.tick + 1).length, 'non-vacuity: and the hauler owes a seal').toBeGreaterThan(0);
    expect(rt.grandCreateRefusal(hauler, rt.engine.tick + 1), 'non-vacuity: the grand gates alone would take it').toBeNull();
    expect(tierOf(rt.world.map, w.stage), 'non-vacuity: outside the Commons, where SIEGE is legal').not.toBe('COMMONS');

    const seen = observe(rt, hauler);
    const offered = createsOffered(seen);
    expect(offered.has('GRAND'), 'REGRESSION: the grand create offered to a principal owing a seal').toBe(false);
    expect(offered.has('SIEGE'), 'REGRESSION: a SIEGE offered to a principal owing a seal').toBe(false);
    expect(reasonOf(seen)).toContain('PROP-D4');
    const refused = act(rt, hauler, 'create', { kind: 'BUILD', stage: w.stage, grand: true });
    expect(refused?.invariant, 'the engine refuses it for the reason the menu gave').toBe('PROP-D4');
  }, 300_000);

  it('★ across a FINALE the cast plays, every grand and SIEGE create the menu offers is accepted, sent verbatim', () => {
    setSpeed('instant');
    const seed = 'menu-engine-finale';
    const start = WINDOW.opens_tick - 1;
    const runtime = new Runtime({ seed, startTick: start });
    const cast = new HeuristicCast(runtime, { size: 12 });
    const members = cast.seat(seed);
    // A world started this late has had no season to earn in (`the-cast-takes-the-finale.spec.ts`).
    for (const m of members) {
      runtime.ledger.issueCurrency({
        eventId: `test.earn:${m.principal}` as EventId,
        tick: start + 1,
        faucet: CURRENCY_FAUCET.CIVIC_PROCUREMENT,
        to: storesAccount(m.principal),
        amount: minor(150_000),
      });
    }
    const offered = { GRAND: 0, SIEGE: 0 };
    const tried = new Set<string>();
    const sent: { principal: PrincipalId; key: string; clientSequence: number }[] = [];
    let refusals = 0;
    while (runtime.engine.tick < finaleTickOf(1) - 1) {
      const next = runtime.engine.tick + 1;
      for (const action of cast.decide(next, seed)) runtime.engine.submit(action);
      // Every 6 ticks, read every member's menu and send each new-kind create it is offered, verbatim,
      // once per member and kind — the act an agent copying its menu would send.
      if (next % 6 === 0) {
        for (const m of members) {
          for (const [key, a] of createsOffered(observe(runtime, m.principal))) {
            if (key !== 'GRAND' && key !== 'SIEGE') continue;
            offered[key] += 1;
            const once = `${String(m.principal)}:${key}`;
            if (tried.has(once)) continue;
            tried.add(once);
            const clientSequence = 50_000 + tried.size;
            const out = runtime.engine.submit({
              principal: m.principal,
              verb: 'create',
              params: a['params'] as Row,
              clientSequence,
              arrivalMs: 0,
              decisionSource: 'LIVE',
            });
            expect(out.ok, `the door refused an offered ${key} create from ${m.principal}`).toBe(true);
            sent.push({ principal: m.principal, key, clientSequence });
          }
        }
      }
      const report = runtime.runTick();
      expect(report.halted, 'the world must not halt').toBe(false);
      for (const s of sent.splice(0)) {
        for (const c of runtime.peekCorrections(s.principal)) {
          if (c.verb === 'create' && c.clientSequence === s.clientSequence) refusals += 1;
        }
      }
    }
    expect(offered.GRAND, 'non-vacuity: the FINALE offered the grand create to somebody').toBeGreaterThan(0);
    expect(offered.SIEGE, 'non-vacuity: a member outside the Commons was offered a SIEGE').toBeGreaterThan(0);
    expect(refusals, 'REGRESSION: an offered grand or SIEGE create, sent verbatim, was refused').toBe(0);
  }, 900_000);
});
