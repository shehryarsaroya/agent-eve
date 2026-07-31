/**
 * ★ **`RULES_VERSION` 37 — A RAIDER'S FORCE IS HANDS, NOT PARTY ROWS**, and the briefing can see a war.
 *
 * *(35 was the pre-assigned lane; the surface lode renumbered to 37 at merge. This file said 35 for
 * two versions afterwards, which is the cross-reference class `core/allocate.ts`'s note is about.)*
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A BLIND PLAYER STOOD AT ITS OWN DEMAND'S STAGE WITH THREE HANDS AND READ `force.raider: 1`.**
 *
 * *"`force.your_sway: 3` at the target system with two IDLE hands standing there and
 * `force.raider: 1`. No verb converts them; `join` refused; `withheld` silent. Offence is priced in
 * allies the reach rules forbid asking."* Every clause of that was correct.
 *
 * `readForce` scored the raider's side `FORCE_PER_JOINER x (parties with sway >= 1)` — one point per
 * PRINCIPAL, with the sway MAGNITUDE read only as a boolean — while the TARGET's side was
 * `FORCE_PER_HAND x hands`. Two sides of one comparison in different units, and it contradicted two
 * things already shipped:
 *
 *   1. **`SWAY_STATEMENT`**, which agents read verbatim: *"SWAY is how many of your 3 HANDS count as
 *      FORCE at a place you are not defending."* The engine read it as a permission bit. Scar #1 with
 *      the agent-facing text on the correct side.
 *   2. **`campaign/pulse.ts:readCampaignForce`**, which already computes `min(present, sway)` for the
 *      attacker and every ally, and `present` for every defender. One `swayAt` port, two units.
 *
 * There is **no new verb** — the act that adds a hand is `move`, which is why `RaidView.march` no
 * longer nulls the moment one hand of yours is there, and why the `your_side !== null` arm of the raid
 * affordance chain now exists at all. It did not: an initiator fell through `target`, `not-in-it-and-
 * far` and `not-in-it-and-here` alike, so it got no affordance, no `withheld` row and no counter.
 *
 * ── AND THE BRIEFING, WHICH HAD NEVER CONSULTED A RAID ───────────────────────
 *
 * `briefing.if_you_do_nothing` read ventures, elections, hands in transit, the Levy and claims. At
 * tick 213 it told a principal with 500 staked in a demand resolving at 231 that *"absence costs
 * opportunity and nothing else."* `Runtime.liveRaidAgainst`'s docstring names the briefing as one of
 * its three readers; it had never called it. Both are asserted here because both are about the same
 * thing being invisible from the same place.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import { WAKES_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { FORCE_BY_TIER, FORCE_PER_HAND } from '../../src/predation/params.js';
import { readForce } from '../../src/predation/resolve.js';
import { SWAY_AT_SEAT } from '../../src/world/index.js';
import { act, raidWorld, runTo, tick } from './fixture.js';

type Row = Record<string, unknown>;
const obj = (v: unknown): Row => (typeof v === 'object' && v !== null ? (v as Row) : {});
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.map(obj) : []);

function look(runtime: ReturnType<typeof raidWorld>['runtime'], who: PrincipalId): Row {
  return buildObservation({
    runtime,
    principal: who,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: WAKES_PER_RECKONING,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  }) as unknown as Row;
}

describe('★ the raider\'s force is counted in HANDS (RULES_VERSION 37)', () => {
  it('★ NON-VACUITY, then the claim: three hands from ONE principal are worth three, not one', () => {
    // The unit change, isolated from the world. `handsAtStage` answers three hands for the raider and
    // one for the target, so the OLD arithmetic reads 1 raider against 1 + terrain and the NEW one
    // reads 3. Sway is held at `SWAY_AT_SEAT` (3), which is the cap and not the term.
    //
    // MUTATION: put `FORCE_PER_JOINER * raiderJoiners` back and `raiderForce` drops 3 → 1.
    const raid = {
      id: 'raid:1:d0',
      initiator: 'p:a' as PrincipalId,
      target: 'p:b' as PrincipalId,
      stage: 'sys-05' as SystemId,
      good: 'ration',
      demandQty: 400,
      state: 'DEMANDED',
      force: 0,
      spawnedAtTick: 1,
      resolvesAtTick: 25,
      answer: null,
      parties: [
        { principal: 'p:a' as PrincipalId, side: 'RAIDER', handId: 'h:a1', stake: 500, encumbranceId: null, joinedAtTick: 1 },
      ],
    } as never;
    const three = (who: PrincipalId): readonly string[] =>
      who === ('p:a' as PrincipalId) ? ['h:a1', 'h:a2', 'h:a3'] : ['h:b1'];
    const reading = readForce({
      raid,
      tier: 'FRONTIER',
      defenderHands: 1,
      handsAtStage: three as never,
      raidForceLeft: () => null,
      swayAt: () => SWAY_AT_SEAT,
    });
    expect(
      reading.terms.raiderHands,
      'THE TERM: `Σ min(hands standing, sway)`, which is what the published SWAY_STATEMENT promises',
    ).toBe(3);
    expect(reading.terms.raiderJoiners, 'and the PRINCIPAL count is still published beside it').toBe(1);
    expect(
      reading.raiderForce,
      'so one principal with three hands out-forces a one-hand defence on the Frontier',
    ).toBe(FORCE_PER_HAND * 3);
    expect(reading.verdict).toBe('PLUNDERED');
  });

  it('★ SWAY is the CAP, not a permission bit — three hands at sway 1 are worth one', () => {
    // The asymmetry that survives: offence is supplied, defence is present. This is what makes the
    // change a unit correction rather than a raider buff, and it is the clause `campaign/pulse.ts`
    // already had.
    const raid = {
      id: 'raid:1:d0',
      initiator: 'p:a' as PrincipalId,
      target: 'p:b' as PrincipalId,
      stage: 'sys-05' as SystemId,
      good: 'ration',
      demandQty: 400,
      state: 'DEMANDED',
      force: 0,
      spawnedAtTick: 1,
      resolvesAtTick: 25,
      answer: null,
      parties: [
        { principal: 'p:a' as PrincipalId, side: 'RAIDER', handId: 'h:a1', stake: 500, encumbranceId: null, joinedAtTick: 1 },
      ],
    } as never;
    const reading = readForce({
      raid,
      tier: 'FRONTIER',
      defenderHands: 1,
      handsAtStage: ((who: PrincipalId) =>
        who === ('p:a' as PrincipalId) ? ['h:a1', 'h:a2', 'h:a3'] : ['h:b1']) as never,
      raidForceLeft: () => null,
      swayAt: () => 1,
    });
    expect(reading.terms.raiderHands, 'capped at the sway, never at the headcount').toBe(1);
    expect(reading.raiderForce).toBe(1);
    expect(reading.verdict, 'and a tie still goes to the defender').toBe('REPULSED');
    // At sway 0 the party buys nothing and the meter says so — unchanged from before 35.
    const none = readForce({
      raid,
      tier: 'FRONTIER',
      defenderHands: 1,
      handsAtStage: ((who: PrincipalId) =>
        who === ('p:a' as PrincipalId) ? ['h:a1', 'h:a2', 'h:a3'] : ['h:b1']) as never,
      raidForceLeft: () => null,
      swayAt: () => 0,
    });
    expect(none.terms.raiderHands).toBe(0);
    expect(none.terms.raidersOutOfSway, 'the mechanic\'s meter still counts the refusal').toBe(1);
  });

  it('★ a DEFENDER ally\'s hands count too, or a chokepoint would favour the attacker', () => {
    // §16.1 MUST-3's whole argument is that a chokepoint *"lets a smaller defender exploit interior
    // lines"*. Leaving `defenderJoiners` a row count while the raider moved to hands would have
    // inverted it, so both allies are hands. The defender's are never capped by sway.
    const raid = {
      id: 'raid:1:d0',
      initiator: null,
      target: 'p:b' as PrincipalId,
      stage: 'sys-05' as SystemId,
      good: 'ration',
      demandQty: 400,
      state: 'DEMANDED',
      force: 2,
      spawnedAtTick: 1,
      resolvesAtTick: 25,
      answer: 'FIGHT',
      parties: [
        { principal: 'p:c' as PrincipalId, side: 'DEFENDER', handId: 'h:c1', stake: 0, encumbranceId: null, joinedAtTick: 1 },
      ],
    } as never;
    const reading = readForce({
      raid,
      tier: 'MARCHES',
      defenderHands: 1,
      handsAtStage: ((who: PrincipalId) =>
        who === ('p:c' as PrincipalId) ? ['h:c1', 'h:c2'] : ['h:b1']) as never,
      raidForceLeft: () => null,
      swayAt: () => 0,
    });
    expect(reading.terms.defenderAllyHands, 'two hands from one ally are worth two').toBe(2);
    expect(reading.terms.defenderJoiners, 'and the principal count is published beside it').toBe(1);
    expect(reading.defenderForce).toBe(1 + 2 + (FORCE_BY_TIER['MARCHES'] ?? 0));
    expect(reading.terms.raidersOutOfSway, 'a world raid has no raider parties to refuse').toBe(0);
  });
});

describe('★ an initiator standing at its own demand can SEE and CHANGE its force', () => {
  it('★ `your_hands_here`, `raider_hands`, and a reinforcement `move` — none of which existed', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // The reader is a RAIDER party, so `your_side !== null`, so before 35 it fell through every arm of
    // the affordance chain: no offer, no `withheld` row, no counter. And `RaidView.march` was nulled
    // the moment one hand of the reader's stood at the stage, on the reasoning that *"there is nothing
    // left to walk"* — true while a second hand bought nothing, false now.
    //
    // MUTATION: delete the `else` arm in `api/observe.ts`'s raid loop and the `move` offer for this
    // reader disappears with no row anywhere saying so.
    // ══════════════════════════════════════════════════════════════════════════
    const { runtime, principals, stage } = raidWorld('force-hands-view', 3);
    const initiator = principals[0];
    const victim = principals[1];
    if (initiator === undefined || victim === undefined) throw new Error('need two principals');
    runTo(runtime, 4);

    // Walk one of the initiator's hands OFF the stage, so a reinforcement route exists to walk back.
    const hands = runtime.world.handsByPrincipal.get(initiator) ?? [];
    expect(hands.length, 'a principal has three hands').toBeGreaterThan(1);

    const opened = act(runtime, initiator, 'demand', {
      principal: victim,
      system: stage,
      good: 'ration',
      qty: 3000,
    });
    // `act` returns the correction, or null when the act was accepted. Null is success.
    expect(opened, `demand refused: ${opened === null ? '' : String(opened.hint)}`).toBeNull();
    tick(runtime);

    const view = rows(obj(look(runtime, initiator)['obligations'])['raid'])[0];
    expect(view, 'the initiator must see its own standoff').toBeDefined();
    const force = obj(view?.['force']);
    expect(view?.['your_side'], 'and be a RAIDER in it').toBe('RAIDER');
    expect(
      Object.prototype.hasOwnProperty.call(force, 'your_hands_here'),
      'the pair `your_sway` + `your_hands_here` IS the decision, and only half of it was published',
    ).toBe(true);
    expect(
      Object.prototype.hasOwnProperty.call(force, 'raider_hands'),
      'and the term the sum is actually built from',
    ).toBe(true);
    expect(
      Number(force['raider_hands']),
      'the initiator\'s own hands standing at the stage are its force',
    ).toBeGreaterThan(0);
    expect(Number(force['raider_hands'])).toBe(Number(force['raider']));
    expect(
      Number(force['your_hands_here']),
      'and it can see how many of them are there',
    ).toBeGreaterThan(0);

    // The reader is a party, so it gets a REINFORCEMENT answer or a row saying why not. Never both,
    // never neither — that was the silence.
    const payload = look(runtime, initiator);
    const moves = rows(payload['affordances']).filter((a) => a['verb'] === 'move');
    // `header.withheld` is the accounting surface, and `verbs[]` plus `reason` are what an agent reads.
    const withheld = obj(obj(payload['header'])['withheld']);
    const reason = typeof withheld['reason'] === 'string' ? withheld['reason'] : '';
    expect(
      moves.length > 0 || reason.includes('reinforcement'),
      'a party that could bring more force is offered a walk, or told why it cannot — never silence. ' +
        `offers: ${String(moves.length)} · withheld: ${reason.slice(0, 300)}`,
    ).toBe(true);
  });

  it('★ the briefing prices the standoff instead of saying absence costs nothing', () => {
    // MUTATION: delete either loop at the end of `ifYouDoNothing` and this goes red on the first
    // assertion; delete `standoffPressure` from the prompt ladder and it goes red on the third.
    const { runtime, principals, stage } = raidWorld('force-hands-briefing', 3);
    const initiator = principals[0];
    const victim = principals[1];
    if (initiator === undefined || victim === undefined) throw new Error('need two principals');
    runTo(runtime, 4);

    const before = String(obj(look(runtime, victim)['briefing'])['if_you_do_nothing']);
    const opened = act(runtime, initiator, 'demand', {
      principal: victim,
      system: stage,
      good: 'ration',
      qty: 3000,
    });
    // `act` returns the correction, or null when the act was accepted. Null is success.
    expect(opened, `demand refused: ${opened === null ? '' : String(opened.hint)}`).toBeNull();
    tick(runtime);

    for (const who of [victim, initiator]) {
      const briefing = obj(look(runtime, who)['briefing']);
      const nothing = String(briefing['if_you_do_nothing']);
      expect(
        nothing,
        `${who}: a live standoff must be priced in the field whose contract is that absence is priced`,
      ).not.toContain('absence costs opportunity and nothing else');
      expect(nothing, 'and it names the tick, which is before the Reckoning').toMatch(/resolves at tick \d+/);
      expect(
        String(briefing['prompt']),
        `${who}: the first sentence of the wake must not be about board roles while a war is live`,
      ).toMatch(/TARGET of|RAIDER in|DEFENDER in/);
    }
    // NON-VACUITY: the "before" reading must not already mention a standoff, or the assertions above
    // would pass over a world where the field was never silent about one. (It does mention the Levy —
    // that clause was always there, and it is the one that proves the field is not a constant.)
    expect(
      before,
      'before the demand there was no standoff to price, so the field must not name one',
    ).not.toMatch(/resolves at tick/);
    expect(before, 'and the field was already saying something, so it is not simply empty').not.toBe('');
  });
});
