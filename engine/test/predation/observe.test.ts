/**
 * **What an agent can actually see and do** — the half that decides whether predation is
 * a mechanic or a thing that happens to people.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A2: known arithmetic is exact and machine-readable, and *never make an agent need a
 * wiki*. A14: the schedule is the whole point — a raid an agent could not see coming is a
 * dice roll. And the standing pattern this repo ships from High Water: **the consequence
 * of doing nothing is stated in the same payload as the options**, because a decision
 * under a clock whose default outcome is unstated is not a decision.
 *
 * An affordance is also a *complete, copyable act*: `test/api/blind-play.test.ts` exists
 * because agents copy these params verbatim, and an affordance the engine then refuses is
 * worse than a missing one.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { OBSERVE_KEYS, buildObservation, type Affordance } from '../../src/api/observe.js';
import { CANON_VERBS, unbuiltVerbs } from '../../src/api/verbs.js';
import type { PrincipalId } from '../../src/core/types.js';
import {
  DEMAND_WINDOW_TICKS,
  RAID_JOIN_STAKE_MINOR,
  RAID_TAKE_MULTIPLE,
  RAID_TARGET_STATEMENT,
} from '../../src/predation/index.js';
import type { Runtime } from '../../src/sim/runtime.js';
import { act, raidWorld, runToFirstRaid, tick } from './fixture.js';

function observe(runtime: Runtime, principal: PrincipalId): ReturnType<typeof buildObservation> {
  return buildObservation({
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 4,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  });
}

describe('the schedule reaches the agent before the first raid does', () => {
  it('`header.raid_schedule` publishes the clock and the rule verbatim, from tick zero', () => {
    const { runtime, principals } = raidWorld('obs-schedule', 3);
    const me = principals[0];
    if (me === undefined) throw new Error('fixture');
    tick(runtime);

    const schedule = observe(runtime, me).header['raid_schedule'] as Record<string, unknown>;
    expect(schedule['window_ticks']).toBe(DEMAND_WINDOW_TICKS);
    expect(schedule['rule']).toBe(RAID_TARGET_STATEMENT);
    expect(schedule['next_spawn_tick']).toBeGreaterThanOrEqual(runtime.engine.tick);
    expect(schedule['next_resolve_tick']).toBe(
      (schedule['next_spawn_tick'] as number) + DEMAND_WINDOW_TICKS,
    );
    // Before any raid exists. A schedule that only appeared once you were under attack
    // would be a weather report published after the storm.
    expect(runtime.raids.all()).toEqual([]);
  });

  it('the observation is still exactly eleven top-level keys — §17\'s budget is at its ceiling', () => {
    const { runtime, principals } = raidWorld('obs-budget', 3);
    const me = principals[0];
    if (me === undefined) throw new Error('fixture');
    tick(runtime);
    expect(Object.keys(observe(runtime, me)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([...OBSERVE_KEYS].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    // ★ RE-MEASURED, NOT ADJUSTED. It was 10 for the project's whole life and is 11 because
    // `risk` landed: §12.1's eleventh key, added by raising §17's ceiling rather than trading a
    // key away, because the alternative was an A9 violation (`api/observe.ts:OBSERVE_KEYS` has the
    // note). The number is read off the served list, and the list is checked against `agent.md`
    // §6 and SPEC §12.1 by `test/observe/promise.test.ts` and `scripts/budget-audit.mjs`.
    expect(OBSERVE_KEYS).toHaveLength(11);
  });
});

describe('a demand against you arrives as an obligation, priced on every branch', () => {
  it('names the deadline and the exact cost of paying, resisting and doing nothing', () => {
    const { runtime } = raidWorld('obs-demand', 3);
    const raid = runToFirstRaid(runtime);
    const rows = observe(runtime, raid.target).obligations['raid'] as readonly Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row === undefined) throw new Error('no raid row');

    expect(row['raid']).toBe(raid.id);
    expect(row['your_side']).toBe('TARGET');
    expect(row['resolves_tick']).toBe(raid.resolvesAtTick);
    expect(row['ticks_left']).toBe(raid.resolvesAtTick - runtime.engine.tick);

    const costs = row['costs'] as Record<string, number>;
    expect(costs['pay']).toBe(raid.demandQty);
    // The `projectedDrown` pattern: silence is priced, in the same payload, exactly.
    expect(costs['if_you_do_nothing']).toBeGreaterThan(costs['pay'] ?? 0);
    expect(costs['join_stake']).toBe(RAID_JOIN_STAKE_MINOR);

    // And the force arithmetic on both sides, so `fight` is a calculation and not a hope.
    const force = row['force'] as Record<string, unknown>;
    expect(force['raider']).toBe(raid.force);
    expect(typeof force['defender_if_you_fight']).toBe('number');
    expect(['REPULSED', 'PLUNDERED']).toContain(force['verdict_if_resolved_now']);
  });

  it('a bystander with a hand at the stage sees the raid, unsided, and can take a side', () => {
    // ── WITHOUT THIS THERE IS NO ESCORT MARKET, and the first draft did not have it ──
    //
    // The view used to return only raids the reader was a party to, so a neighbour
    // standing at the stage with three idle hands saw nothing and was offered no `join`.
    // §9's argument for world-spawned predation is that it "gives escorts a guaranteed
    // market"; a market whose demand side is invisible is not one. Having a hand at the
    // stage is §11.2's `SENSED` clause verbatim, and the raid itself is `PUBLIC` anyway.
    const { runtime, principals } = raidWorld('obs-bystander', 3);
    const raid = runToFirstRaid(runtime);
    const bystander = principals.find((p) => p !== raid.target);
    if (bystander === undefined) throw new Error('fixture');

    const seen = observe(runtime, bystander).obligations['raid'] as readonly Record<string, unknown>[];
    expect(seen).toHaveLength(1);
    expect(seen[0]?.['your_side']).toBeNull();
    expect(seen[0]?.['raid']).toBe(raid.id);

    act(runtime, bystander, 'join', { raid: raid.id, side: 'DEFENDER' });
    const rows = observe(runtime, bystander).obligations['raid'] as readonly Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['your_side']).toBe('DEFENDER');
  });

  it('a principal nowhere near the stage sees nothing, so the payload stays a briefing', () => {
    const { runtime, principals } = raidWorld('obs-far', 3);
    const raid = runToFirstRaid(runtime);
    const near = principals.find((p) => p !== raid.target);
    if (near === undefined) throw new Error('fixture');
    // March every hand of `near` off the stage, one gate. It can no longer reach the
    // standoff, and the row goes with it.
    const lanes = runtime.world.map.systems.get(raid.stage)?.lanes ?? [];
    const away = lanes[0];
    if (away === undefined) throw new Error('the stage has no lane out');
    for (const hand of [...runtime.world.hands.values()].filter((h) => h.principal === near)) {
      act(runtime, near, 'move', { hand: hand.id, to: away });
    }
    expect(observe(runtime, near).obligations['raid']).toEqual([]);
  });
});

describe('the affordances are complete, copyable acts the engine will accept', () => {
  function affordances(runtime: Runtime, principal: PrincipalId): readonly Affordance[] {
    return observe(runtime, principal).affordances;
  }

  it('offers the target `yield` and `fight`, each with its exact worst case', () => {
    const { runtime } = raidWorld('obs-aff-target', 3);
    const raid = runToFirstRaid(runtime);
    const list = affordances(runtime, raid.target);

    const pay = list.find((a) => a.verb === 'yield');
    const resist = list.find((a) => a.verb === 'fight');
    expect(pay).toBeDefined();
    expect(resist).toBeDefined();
    expect(pay?.max_direct_loss).toBe(raid.demandQty);
    expect(pay?.expires_tick).toBe(raid.resolvesAtTick);
    // The published multiple is named in the sentence, not left to be derived.
    expect(pay?.what_it_forecloses).toContain(`${String(RAID_TAKE_MULTIPLE)}x`);
    // `fight` names the arithmetic and the fact that hands go RECOVERING, never destroyed.
    expect(resist?.what_it_forecloses).toContain('RECOVERING');
    expect(resist?.what_it_forecloses).toContain('never your holding');
  });

  it('every offered raid act is accepted verbatim — an affordance the floor refuses is worse than none', () => {
    // Agents copy these params exactly (`blind-play`). `fight` and a raider `join` are
    // HOSTILE, so the Commons floor refuses them unless the params name a place or a
    // principal it can locate; if the affordance ever stopped carrying that key, the
    // server would be telling an agent to do something and then declining.
    const { runtime, principals } = raidWorld('obs-aff-copy', 3);
    const raid = runToFirstRaid(runtime);
    const bystander = principals.find((p) => p !== raid.target);
    if (bystander === undefined) throw new Error('fixture');

    for (const [who, list] of [
      [raid.target, affordances(runtime, raid.target)],
      [bystander, affordances(runtime, bystander)],
    ] as const) {
      for (const [i, a] of list.filter((x) => ['yield', 'fight', 'join'].includes(x.verb)).entries()) {
        const outcome = runtime.engine.submit({
          principal: who,
          verb: a.verb,
          params: a.params,
          clientSequence: i,
          arrivalMs: i,
          decisionSource: 'LIVE',
        });
        expect(outcome.ok ? 'ok' : `${outcome.invariant}: ${outcome.hint}`, `${a.verb} ${JSON.stringify(a.params)}`).toBe('ok');
      }
    }
  });

  it('offers a bystander both sides, and prices the raider side as slashable capital', () => {
    const { runtime, principals } = raidWorld('obs-aff-join', 3);
    const raid = runToFirstRaid(runtime);
    const bystander = principals.find((p) => p !== raid.target);
    if (bystander === undefined) throw new Error('fixture');
    const joins = affordances(runtime, bystander).filter((a) => a.verb === 'join');

    expect(joins.map((a) => String(a.params['side'])).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(['DEFENDER', 'RAIDER']);
    const raider = joins.find((a) => a.params['side'] === 'RAIDER');
    const defender = joins.find((a) => a.params['side'] === 'DEFENDER');
    // Attacker risk, priced on the card before it is taken (A7's shape).
    expect(raider?.max_direct_loss).toBe(RAID_JOIN_STAKE_MINOR);
    expect(raider?.what_it_forecloses).toContain('INVALID');
    // A defender risks a hand, not capital, and the card says exactly that.
    expect(defender?.max_direct_loss).toBe(0);
    expect(defender?.what_it_forecloses).toContain('RECOVERING');
  });

  it('offers nothing once the raid has resolved — a card for a closed raid is a refusal waiting', () => {
    const { runtime } = raidWorld('obs-aff-closed', 3);
    const raid = runToFirstRaid(runtime);
    act(runtime, raid.target, 'yield', { raid: raid.id });
    const list = affordances(runtime, raid.target).filter((a) => ['yield', 'fight'].includes(a.verb));
    expect(list).toEqual([]);
  });
});

describe('the verb table and the canon agree about what is live', () => {
  it('`yield`, `fight` and `join` are live, and are canon verbs rather than new ones', () => {
    // §17's budget is at 39 of 40. Predation added zero verbs: all three already existed
    // in SPEC §12.2's table and were already classified in `world/commons.ts`.
    const { runtime } = raidWorld('obs-verbs', 3);
    for (const verb of ['yield', 'fight', 'join']) {
      expect(runtime.liveVerbs.has(verb), verb).toBe(true);
      expect(CANON_VERBS).toContain(verb);
    }
    const first = runtime.world.principalOrder[0];
    if (first === undefined) throw new Error('fixture');
    expect(observe(runtime, first).header['live_verbs']).toContain('fight');
  });

  it('the "not yet live" table no longer promises a verb that already works', () => {
    // A stale entry would never be *shown* — `classifyVerb` checks `live` first — it would
    // just quietly disagree with the engine, which is the drift that file exists to stop.
    const { runtime } = raidWorld('obs-verbs-stale', 3);
    const notLive = unbuiltVerbs(runtime.liveVerbs);
    expect(notLive).not.toContain('yield');
    expect(notLive).not.toContain('fight');
    expect(notLive).not.toContain('join');
    // `demand` joined them: §9's agent-initiated standoff is built, so telling an agent it is
    // waiting on a build step would cost it every action it spent waiting.
    expect(notLive).not.toContain('demand');
    // `flee` is the one that stays, and it is not a gap: §9's flee is "targeting misses if the
    // target moved", which `move` already expresses. A second spelling would be §3's forbidden
    // second concept, and `VERB_ARRIVES_AT` says exactly that rather than promising a step.
    // `flee` used to be asserted here, and its removal is what paid for `engage` (SPEC §9A).
    // It was a canon verb with **no handler** and an argument in `verbs.ts` for never giving it one,
    // which is this project's signature defect arriving on the verb budget itself: it read as one of
    // the 40 in every summary and was unreachable. §17's ceiling is 40, so combat took its slot.
    //
    // The claim that replaces it is the stronger one: the word is gone from the canon entirely, so an
    // agent can no longer read it in the verb list and wonder why it does nothing.
    expect(notLive).not.toContain('flee');
    expect(notLive, 'engage is live from the tick it landed and must never be in this table').not.toContain(
      'engage',
    );
  });
});
