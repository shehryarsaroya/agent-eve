/**
 * The runtime renders a settled Reckoning into a publishable frame.
 *
 * The world settled Reckonings and, until reckoningFrame() existed, nobody could see
 * one — half the product (watchable) dark. This is the end-to-end wiring: settle, then
 * render from the committed outcome (not the live tick), and get a frame the client can
 * read.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSim, DEFAULT_ARGS } from '../../src/sim/cli.js';
import { Runtime } from '../../src/sim/runtime.js';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';

function playedRuntime(seed: string): Runtime {
  const rt = new Runtime({ seed });
  for (const n of ['vale', 'orison', 'halcyon', 'vex', 'corvid', 'kestrel']) {
    rt.seat(`p:${n}` as PrincipalId, n);
  }
  return rt;
}

describe('runtime.reckoningFrame', () => {
  it('is null before any Reckoning has settled', () => {
    const rt = playedRuntime('frame-null');
    expect(rt.reckoningFrame()).toBeNull();
  });

  it('renders a settled Reckoning within the legibility budgets', () => {
    // A whole run via the CLI is the honest exercise: real cast, real settlements.
    const dir = mkdtempSync(join(tmpdir(), 'rf-'));
    const result = runSim({
      ...DEFAULT_ARGS,
      seed: 'frame-e2e',
      ticks: TICKS_PER_RECKONING + 5,
      principals: 12,
      framesDir: dir,
      quiet: true,
    });
    expect(result.framesWritten).toBeGreaterThan(0);

    const latest = JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8')) as {
      reckoningIndex: number;
      meters: { kept: number; broken: number; levyShort: number };
      rundown: unknown[];
      tributeLines: unknown[];
    };
    // A real settled Reckoning: an index, meters, and at most the segment budget.
    expect(latest.reckoningIndex).toBeGreaterThanOrEqual(0);
    expect(latest.rundown.length).toBeLessThanOrEqual(12);
    expect(typeof latest.meters.levyShort).toBe('number');
    // Every principal is assessed each Reckoning, so the Levy's pixel signature is
    // present — the whole point of INV-25 and §5.2's tribute line.
    expect(latest.tributeLines.length).toBeGreaterThan(0);
  });

  it('★ writes `live.json` too, on EVERY tick, and it MOVES', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // The end-to-end half of the artifact: `runSim` (and `api/server.ts`, which runs the same two
    // lines) must publish the live frame on every tick, not only at a settlement. Before it existed
    // this directory held one file that changed once every 288 ticks, and at `SPEEDS.prod` that is
    // once every 24 hours against a client polling every 15 seconds.
    //
    // `liveFramesMoved` is the meter and it is asserted as a RATIO of the ticks run rather than as
    // `> 0`: a single moving frame in 293 would satisfy `> 0` and would still be a still image.
    //
    // MUTATION: move the live publish inside the `isSettlementTick` branch in `sim/cli.ts`. RED on
    // `liveFramesWritten`, because 293 ticks contain one settlement.
    // ══════════════════════════════════════════════════════════════════════════
    const dir = mkdtempSync(join(tmpdir(), 'rf-live-'));
    const ticks = TICKS_PER_RECKONING + 5;
    const result = runSim({
      ...DEFAULT_ARGS,
      seed: 'frame-live-e2e',
      ticks,
      principals: 12,
      framesDir: dir,
      quiet: true,
    });
    expect(result.liveFramesWritten, 'one live frame per tick').toBe(ticks);
    expect(
      result.liveFramesMoved,
      `only ${String(result.liveFramesMoved)} of ${String(ticks)} live frames differed from the one ` +
        'before it — a file that is republished unchanged is the still image this artifact replaces',
    ).toBeGreaterThan(ticks / 2);

    const live = JSON.parse(readFileSync(join(dir, 'live.json'), 'utf8')) as {
      tick: number;
      phase: string;
      ticksUntilReckoning: number;
      glyphs: { state: string }[];
      meters: { onAPromise: number };
      rundown?: unknown;
      sealVerdict?: unknown;
    };
    // The last tick published, not the last settlement — that is the whole difference.
    expect(live.tick).toBe(ticks - 1);
    expect(['EARLY', 'COMMITMENT', 'FREEZE', 'SETTLING']).toContain(live.phase);
    expect(live.ticksUntilReckoning).toBeGreaterThan(0);
    // ★ And a state the NIGHTLY frame cannot express, on the artifact a viewer actually polls.
    expect(
      live.glyphs.some((g) => g.state === 'FORMING' || g.state === 'LIVE'),
      '`glyphFor` derives its state from a SETTLED outcome, so FORMING and LIVE are unreachable on ' +
        'the nightly frame. If they are unreachable here too, the live frame is not a live frame',
    ).toBe(true);
    // A9: the three time-scoped tiers have one carrier and it is absent.
    expect(live.rundown).toBeUndefined();
    expect(live.sealVerdict).toBeUndefined();
  });

  it('is deterministic: the same run writes a byte-identical latest frame', () => {
    const a = mkdtempSync(join(tmpdir(), 'rf-a-'));
    const b = mkdtempSync(join(tmpdir(), 'rf-b-'));
    const args = { ...DEFAULT_ARGS, seed: 'frame-det', ticks: TICKS_PER_RECKONING + 2, principals: 8, quiet: true };
    runSim({ ...args, framesDir: a });
    runSim({ ...args, framesDir: b });
    expect(readFileSync(join(a, 'latest.json'), 'utf8')).toBe(readFileSync(join(b, 'latest.json'), 'utf8'));
  });
});
