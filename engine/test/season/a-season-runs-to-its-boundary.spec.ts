/**
 * E2E-28 — a seeded heuristic world plays a WHOLE season and crosses its boundary with every
 * invariant green, and the season's exam question is actually asked.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE ONLY TEST IN THE SUITE THAT REACHES A FINALE BY PLAYING TO IT.** Every other season test starts
 * a world on the season's last day so the boundary is seconds away. This one starts at genesis with
 * the house cast's twelve members and nothing else, and plays fourteen Reckonings — so freeCash is
 * earned rather than issued, hands walk from the Marches to a Frontier stage eight hops out, and the
 * grand venture is formed, staffed, signed, contested and paid (or not) by the cast's own branches.
 *
 * It is long (~8 minutes) on purpose: CLAUDE.md's standing lesson is that a mechanism is complete
 * only when something in the world SELECTS it, and the sixteen times this repo shipped a capability
 * nothing exercised, every short test was green.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed } from '../../src/core/time.js';
import { finaleTickOf, seasonOf } from '../../src/season/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { tierOf } from '../../src/world/index.js';

describe('E2E-28 — a whole season, to its boundary and through it', () => {
  it(
    'twelve heuristic members play Season 1, form and carry the grand venture, and Season 2 opens clean',
    () => {
      setSpeed('instant');
      const seed = 'season-e2e-28';
      const runtime = new Runtime({ seed });
      const cast = new HeuristicCast(runtime, { size: 12 });
      cast.seat(seed);
      const end = finaleTickOf(1) + 3;
      let violations = 0;
      while (runtime.engine.tick < end) {
        for (const action of cast.decide(runtime.engine.tick + 1, seed)) runtime.engine.submit(action);
        const report = runtime.runTick();
        expect(report.halted, `halted at tick ${String(report.tick)}`).toBe(false);
        violations += report.violations.length;
      }
      expect(violations, 'invariants green on every tick, the boundary tick included').toBe(0);
      expect(seasonOf(runtime.engine.tick)).toBe(2);
      expect(runtime.seasons.closedThrough).toBe(1);

      const record = runtime.seasons.last();
      expect(record?.season).toBe(1);
      // The exam question was asked: a crew formed at the Frontier stage, went live and was decided.
      expect(['KEPT', 'BROKEN']).toContain(record?.grand.outcome);
      expect(record?.grand.crew).toHaveLength(4);
      expect(record?.grand.proceedsMinor ?? 0).toBeGreaterThan(0);
      expect(record?.titles.length ?? 0).toBeGreaterThan(0);
      // A10: no Frontier claim survived into Season 2 (SSN-2 halts if one did; asserted here too).
      for (const claim of runtime.sovereignty.liveClaims()) {
        if (tierOf(runtime.world.map, claim.system) === 'FRONTIER') {
          expect(claim.takenAtTick).toBeGreaterThan(finaleTickOf(1));
        }
      }
      // A13: the finale is on the frame a viewer reads.
      const frame = runtime.reckoningFrame();
      expect(frame?.seasonRecords[0]?.season).toBe(1);
      expect(frame?.seasonRecords[0]?.legend.length ?? 0).toBeGreaterThan(0);
      expect(runtime.liveFrame().season?.season).toBe(2);
    },
    1_800_000,
  );
});
