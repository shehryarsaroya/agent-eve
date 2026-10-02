/**
 * ★ **THE CAST OPENS A VENTURE ONLY WHEN SOMEBODY COULD FILL IT** (`HeuristicCast.createCanFill`).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A 12-member season from genesis (`fs-a`, `instant`) opened 1,465 ventures and 1,252 of them — 85% —
 * retired ABANDONED: a board of slots nobody had a hand for. A role holds its hand until the Reckoning
 * settles, so after the opening of a cycle almost nobody had one to give, and every tick a member found
 * no slot to fill it rolled to open one more. Nothing in the ledger was harmed — a failed formation
 * refunds in full — which is why no gate caught it; what it cost was the record, the board an agent
 * reads and the frames a viewer watches (A13), and the hands a doomed venture held while it waited.
 *
 * The cast now asks the question before it commissions: do cast-mates seated in the stage's tier have
 * enough free hands for the roles already open there AND this venture's own? Measured over ten seeds
 * of a whole season, the abandoned share fell from 84% to 5% while settled ventures (1,821 → 1,839)
 * and elective promises kept (3,846 → 3,861) rose slightly (TRACKER, the launch fixes).
 *
 * These are the short form of that measurement — three Reckonings, two seeds — and they pin the
 * outcome rather than the mechanism, because the outcome is what the record shows.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import { Runtime } from '../../src/sim/runtime.js';
import { isTopYield } from '../../src/venture/index.js';

interface Board {
  readonly opened: number;
  readonly settled: number;
  readonly defaulted: number;
  readonly abandonedUnfilled: number;
  readonly kept: number;
}

function play(seed: string, reckonings: number): Board {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: 12 });
  cast.seat(seed);
  while (runtime.engine.tick < reckonings * TICKS_PER_RECKONING) {
    for (const action of cast.decide(runtime.engine.tick + 1, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    expect(report.halted, `halted at tick ${String(report.tick)}`).toBe(false);
  }
  // The ordinary two-role ventures this change is about: never the four-role BUILD (its own gate) and
  // never the season's grand venture (its own branches).
  const ordinary = runtime.ventures.all().filter((v) => v.grand === null && !isTopYield(v.kind));
  return {
    opened: ordinary.length,
    settled: ordinary.filter((v) => v.state === 'SETTLED').length,
    defaulted: ordinary.filter((v) => v.state === 'DEFAULTED').length,
    abandonedUnfilled: ordinary.filter(
      (v) => v.state === 'ABANDONED' && v.roles.some((r) => r.filledByPrincipal === null),
    ).length,
    kept: runtime.standing.rows().reduce((n, s) => n + s.electiveHonoured, 0),
  };
}

describe('★ the house cast commissions what it can fill', () => {
  for (const seed of ['g01', 'fs-a']) {
    it(
      `${seed}: three Reckonings, and almost nothing it opens retires unfilled`,
      () => {
        const board = play(seed, 3);
        // MUTATION: make `createCanFill` return true — RED. Before the gate `g01` read 109 of 150 abandoned
        // unfilled (73%), every one a DIG opened while no cast-mate had a hand to give; `fs-a` 156 of 207.
        expect(board.abandonedUnfilled, 'a venture nobody could fill is not a venture').toBeLessThanOrEqual(
          Math.floor(board.opened / 10),
        );
        // And it still WORKS: the gate turns away what could not fill, never the deals that could. Over
        // these three Reckonings `g01` settles 30 before the gate and 32 after, `fs-a` 39 and 33 — over a
        // whole season and ten seeds, 1,821 and 1,839. (calibrate)
        expect(board.opened, 'the board is not starved').toBeGreaterThanOrEqual(30);
        expect(board.settled, 'and the ventures it opens settle').toBeGreaterThanOrEqual(25);
        expect(board.kept, 'and the promises in them are kept').toBeGreaterThanOrEqual(60);
      },
      300_000,
    );
  }
});
