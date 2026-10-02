/**
 * GROWTH's gate (SPEC §4.2, A15) — *"gated on bonded, capitalised, non-related population — never raw
 * headcount, which would let 60 bots mint a fresh resource supply."*
 *
 * Three claims, each against the engine:
 *
 *   1. **Headcount is not an input.** Sixty fresh identities — and sixty with a Reckoning of tenure —
 *      read zero qualified, and a threshold sixty heads would clear opens nothing.
 *   2. **Each of the three words is necessary.** A principal with two of them is not counted; the third
 *      is what makes it count. Tested on the pure gate, so a mutation to any one clause is RED here
 *      without a world.
 *   3. **When the gate does open, the world takes it whole**: at the settlement tick, one constellation,
 *      a PUBLIC row, the frame and `observe` both showing it, newcomers seated in the new enclave, and
 *      a snapshot that restores to the same map.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { LEVY_DUTY_PER_PRINCIPAL } from '../../src/levy/params.js';
import { Runtime } from '../../src/sim/runtime.js';
import { worldStateTable } from '../../src/tick/snapshot.js';
import {
  GROWTH_CAPITAL_MINOR,
  GROWTH_PLAN,
  GROWTH_QUALIFIED_PER_SYSTEM,
  GROWTH_STATEMENT,
  GROWTH_SUMMARY,
  growthReading,
  isQualified,
  launchMap,
  mapHash,
  type GrowthPort,
} from '../../src/world/index.js';

const ids = (n: number, prefix = 'p:bot'): PrincipalId[] =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, '0')}` as PrincipalId);

/** A port over plain tables, so each clause can be switched on its own. */
function port(rows: Record<string, { cash: number; counterparties: number; stake: number }>): GrowthPort {
  return {
    principals: () => Object.keys(rows).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) as PrincipalId[],
    freeCash: (p) => rows[p]?.cash ?? 0,
    distinctCounterparties: (p) => rows[p]?.counterparties ?? 0,
    atStake: (p) => rows[p]?.stake ?? 0,
  };
}

function wake(runtime: Runtime, principal: PrincipalId): Record<string, unknown> {
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
  }) as unknown as Record<string, unknown>;
}

describe('the gate counts the three words of §4.2, and nothing about headcount', () => {
  it('reads sixty fresh identities as zero, and a threshold sixty heads would clear opens nothing', () => {
    // MUTATION: count `principals().length` instead of the qualified. RED.
    const rows = Object.fromEntries(ids(60).map((p) => [p, { cash: 0, counterparties: 0, stake: 0 }]));
    const map = launchMap();
    const reading = growthReading(map, port(rows), 2); // 2 × 30 systems = 60: headcount would clear it
    expect(reading.needed).toBe(60);
    expect(reading.qualified).toBe(0);
    expect(reading.opens).toBe(false);
  });

  it('needs ALL THREE: capital it was paid, a promise honoured to someone else, and capital at stake', () => {
    const all = { cash: GROWTH_CAPITAL_MINOR, counterparties: 1, stake: 1 };
    const p = 'p:one' as PrincipalId;
    expect(isQualified(port({ [p]: all }), p)).toBe(true);
    // MUTATION: drop any one clause from `isQualified` — the matching row below goes RED.
    expect(isQualified(port({ [p]: { ...all, cash: GROWTH_CAPITAL_MINOR - 1 } }), p)).toBe(false);
    expect(isQualified(port({ [p]: { ...all, counterparties: 0 } }), p)).toBe(false);
    expect(isQualified(port({ [p]: { ...all, stake: 0 } }), p)).toBe(false);
  });

  it('opens at exactly the published threshold, measured in the region’s own stages', () => {
    const map = launchMap();
    const needed = map.systems.size * GROWTH_QUALIFIED_PER_SYSTEM;
    const qualify = { cash: GROWTH_CAPITAL_MINOR, counterparties: 1, stake: 1 };
    const just = Object.fromEntries(ids(needed).map((p) => [p, qualify]));
    const short = Object.fromEntries(ids(needed - 1).map((p) => [p, qualify]));
    expect(growthReading(map, port(just)).opens).toBe(true);
    expect(growthReading(map, port(short)).opens).toBe(false);
  });

  it('is in agent.md verbatim, because the frame and the document must say one thing', () => {
    // The `agent-md.test.ts` normalisation: blockquote markers and runs of spaces collapse.
    const agentMd = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');
    const normalised = agentMd.replace(/\n> ?/g, ' ').replace(/[ \t]+/g, ' ');
    expect(normalised).toContain(GROWTH_STATEMENT.replace(/[ \t]+/g, ' '));
  });

  it('serves observe one line, not the rule — and the line names a section agent.md really has', () => {
    // `api/observe.ts`'s sovereignty note: static prose in every observation crowded the house cast's
    // own affordances out of its prompt. MUTATION: serve GROWTH_STATEMENT in `header.growth` — RED.
    expect(GROWTH_SUMMARY.length).toBeLessThan(GROWTH_STATEMENT.length / 3);
    const title = /agent\.md, "([^"]+)"/.exec(GROWTH_SUMMARY)?.[1];
    expect(title).toBeDefined();
    const agentMd = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');
    expect(agentMd).toMatch(new RegExp(`^## [0-9A-Z]+\\. ${title ?? '∅'}`, 'm'));
  });

  it('prices capital at one night of the Levy, and the rule says every number it relies on', () => {
    // `world/` may not import `levy/`, so the literal is pinned to its source here.
    expect(GROWTH_CAPITAL_MINOR).toBe(Number(LEVY_DUTY_PER_PRINCIPAL));
    for (const n of [GROWTH_CAPITAL_MINOR, GROWTH_QUALIFIED_PER_SYSTEM, GROWTH_PLAN.commons, GROWTH_PLAN.marches.min, GROWTH_PLAN.marches.max]) {
      expect(GROWTH_STATEMENT).toContain(String(n));
    }
  });
});

describe('a world nobody qualifies in never grows, however many identities it holds', () => {
  it('sixty idle principals across a whole Reckoning: zero qualified, no constellation', () => {
    setSpeed('instant');
    // A threshold of 2 per system is 60 on the launch map — exactly the headcount seated here.
    const runtime = new Runtime({ seed: 'growth-sixty-bots', growthPerSystem: 2 });
    for (const p of ids(60)) runtime.seat(p, p.slice(2));
    for (let t = 0; t < TICKS_PER_RECKONING + 2; t += 1) {
      const report = runtime.runTick();
      expect(report.halted).toBe(false);
    }
    expect(runtime.growthReadingAt().qualified).toBe(0);
    expect(runtime.world.map.grown).toHaveLength(0);
    expect(runtime.world.map.systems.size).toBe(launchMap().systems.size);
  });
});

describe('when the gate opens, the world takes the new constellation whole', () => {
  setSpeed('instant');
  // Threshold 0: the gate opens at the first settlement, so the plumbing is tested without seating 240
  // qualified principals. Production never passes this option.
  const runtime = new Runtime({ seed: 'growth-opens', growthPerSystem: 0 });
  for (const p of ids(4, 'p:early')) runtime.seat(p, p.slice(2));
  const reports: ReturnType<Runtime['runTick']>[] = [];
  for (let t = 0; t < TICKS_PER_RECKONING; t += 1) reports.push(runtime.runTick());

  it('opens exactly one, at the settlement tick, and says so in a PUBLIC row and on the ticker', () => {
    expect(reports.every((r) => !r.halted)).toBe(true);
    expect(runtime.world.map.grown).toHaveLength(1);
    expect(runtime.world.openedAtTick).toEqual([TICKS_PER_RECKONING - 1]);
    const rows = runtime.events
      .eventsAtTick(TICKS_PER_RECKONING - 1)
      .filter((e) => e.event.kind === 'constellation.opened');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.visibility).toBe('PUBLIC');
    expect(runtime.reckoningFrame()?.ticker.some((line) => line.includes('A NEW CONSTELLATION OPENS'))).toBe(true);
  });

  it('publishes the same reading to an agent and to a viewer', () => {
    const agent = wake(runtime, 'p:early000' as PrincipalId);
    const header = agent['header'] as Record<string, unknown>;
    const growth = header['growth'] as Record<string, unknown>;
    const frame = runtime.reckoningFrame();
    expect(frame?.growth).not.toBeNull();
    expect(growth['qualified']).toBe(frame?.growth?.qualified);
    expect(growth['grown']).toBe(1);
    // One line to the agent (agent.md holds the rule); the whole rule to the viewer, who has no agent.md.
    expect(growth['rule']).toBe(GROWTH_SUMMARY);
    expect(frame?.growth?.rule).toBe(GROWTH_STATEMENT);
    expect(frame?.growth?.opened).toHaveLength(1);
    // THE RISE is drawable: every system it names is on the frame's map.
    const onMap = new Set(frame?.map.map((s) => s.id));
    for (const id of frame?.growth?.opened[0]?.systems ?? []) expect(onMap.has(id)).toBe(true);
  });

  it('seats the next newcomers in the new enclave, newest first, until it is level', () => {
    const record = runtime.world.map.grown[0];
    if (record === undefined) throw new Error('no growth');
    const enclave = new Set(record.systems.slice(0, GROWTH_PLAN.commons));
    const seated = ids(2, 'p:late').map((p) => runtime.seat(p, p.slice(2)).holding.system);
    for (const system of seated) expect(enclave.has(system)).toBe(true);
    expect(new Set(seated).size).toBe(2);
  });

  it('restores the grown map from the world table, and a replay grows the same map at the same tick', () => {
    // The world table carries the COUNT and the ticks; restore regrows the map from the base and then
    // checks the hash — so a world restored onto a launch map comes back grown.
    const captured = worldStateTable(runtime.world).capture();
    const fresh = new Runtime({ seed: 'growth-opens', growthPerSystem: 0 });
    expect(fresh.world.map.grown).toHaveLength(0);
    const table = worldStateTable(fresh.world);
    if (table.restore === undefined) throw new Error('the world table has no restore');
    table.restore(captured);
    expect(mapHash(fresh.world.map)).toBe(mapHash(runtime.world.map));
    expect(fresh.world.openedAtTick).toEqual(runtime.world.openedAtTick);

    // DET-1 across a growth: the same inputs open the same constellation on the same tick with the same
    // state hash. MUTATION: draw anything in `openConstellation` from outside `map:<seed>`. RED.
    const twin = new Runtime({ seed: 'growth-opens', growthPerSystem: 0 });
    for (const p of ids(4, 'p:early')) twin.seat(p, p.slice(2));
    for (let t = 0; t < TICKS_PER_RECKONING; t += 1) twin.runTick();
    expect(twin.engine.stateHash).toBe(reports[reports.length - 1]?.stateHash);
    expect(mapHash(twin.world.map)).toBe(mapHash(fresh.world.map));
  });
});
