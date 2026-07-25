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

  it('is deterministic: the same run writes a byte-identical latest frame', () => {
    const a = mkdtempSync(join(tmpdir(), 'rf-a-'));
    const b = mkdtempSync(join(tmpdir(), 'rf-b-'));
    const args = { ...DEFAULT_ARGS, seed: 'frame-det', ticks: TICKS_PER_RECKONING + 2, principals: 8, quiet: true };
    runSim({ ...args, framesDir: a });
    runSim({ ...args, framesDir: b });
    expect(readFileSync(join(a, 'latest.json'), 'utf8')).toBe(readFileSync(join(b, 'latest.json'), 'utf8'));
  });
});
