/**
 * Frame publishing: atomicity and ordering.
 *
 * Both properties only fail under load, which for this game means during the one minute
 * a night anyone is watching. So they are asserted rather than reasoned about.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyFrame } from '../../src/frames/render.js';
import { LATEST, frameFileName, publishFrame, serialiseFrame } from '../../src/frames/write.js';
import { CanonicalError } from '../../src/core/canonical.js';

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'compact-frames-'));
}

describe('publishFrame', () => {
  it('writes the immutable frame and the pointer, both readable as JSON', () => {
    const d = dir();
    const w = publishFrame(d, emptyFrame(7, 2303, 'hash7'));
    expect(w.file).toBe('r-000007.json');

    const named = JSON.parse(readFileSync(join(d, w.file), 'utf8')) as { reckoningIndex: number };
    const latest = JSON.parse(readFileSync(join(d, LATEST), 'utf8')) as { reckoningIndex: number };
    expect(named.reckoningIndex).toBe(7);
    expect(latest.reckoningIndex).toBe(7);
  });

  it('leaves no temp files behind, so a poll never sees a partial write', () => {
    // The atomicity check. A viewer fetching `.latest.json.tmp` would get truncated JSON,
    // and rename(2) is the cheapest guarantee that it cannot happen.
    const d = dir();
    publishFrame(d, emptyFrame(1, 575, 'h'));
    publishFrame(d, emptyFrame(2, 863, 'h'));
    expect(readdirSync(d).filter((f) => f.startsWith('.') || f.endsWith('.tmp'))).toEqual([]);
  });

  it('the pointer always names a frame that already exists on disk', () => {
    // Ordering, not atomicity: the immutable frame lands first. The reverse order has a
    // window where the client is told about a frame that is not there yet — and that
    // window only opens under load.
    const d = dir();
    publishFrame(d, emptyFrame(3, 1151, 'h'));
    const latest = JSON.parse(readFileSync(join(d, LATEST), 'utf8')) as { reckoningIndex: number };
    expect(readdirSync(d)).toContain(frameFileName(latest.reckoningIndex));
  });

  it('pads the filename so a listing sorts the way a human reads it', () => {
    const d = dir();
    for (const n of [2, 10, 1]) publishFrame(d, emptyFrame(n, n * 288, 'h'));
    const frames = readdirSync(d).filter((f) => f.startsWith('r-')).sort((a, b) => (a < b ? -1 : 1));
    expect(frames).toEqual(['r-000001.json', 'r-000002.json', 'r-000010.json']);
  });

  it('refuses a frame carrying a float, rather than serving it', () => {
    // Money is integer minor units everywhere else and a frame is not an exception. The
    // canonical serialiser is what enforces that, which is why frames go through it
    // instead of JSON.stringify.
    const bad = { ...emptyFrame(0, 287, 'h'), meters: { levyShort: 1.5, onAPromise: 0, kept: 0, broken: 0 } };
    expect(() => serialiseFrame(bad as never)).toThrow(CanonicalError);
  });

  it('is byte-identical for the same frame, so a frame can be re-derived and compared', () => {
    const a = serialiseFrame(emptyFrame(5, 1439, 'same'));
    const b = serialiseFrame(emptyFrame(5, 1439, 'same'));
    expect(a).toBe(b);
  });

  it('refuses a negative or fractional Reckoning index', () => {
    expect(() => frameFileName(-1)).toThrow(/non-negative integer/);
    expect(() => frameFileName(1.5)).toThrow(/non-negative integer/);
  });
});
