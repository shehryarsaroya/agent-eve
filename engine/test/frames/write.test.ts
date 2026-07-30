/**
 * Frame publishing: atomicity and ordering.
 *
 * Both properties only fail under load, which for this game means during the one minute
 * a night anyone is watching. So they are asserted rather than reasoned about.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyFrame } from '../../src/frames/render.js';
import { renderLiveFrame } from '../../src/frames/live.js';
import {
  FRAME_INDEX,
  LATEST,
  LIVE,
  archiveLiveFrame,
  liveFrameFileName,
  publishLiveFrame,
  frameFileName,
  frameIndexRow,
  publishFrame,
  publishReplayedFrame,
  serialiseFrame,
  type FrameIndex,
} from '../../src/frames/write.js';
import { CanonicalError } from '../../src/core/canonical.js';
import { TICKS_PER_RECKONING, isSettlementTick } from '../../src/core/time.js';

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'compact-frames-'));
}

function index(d: string): FrameIndex {
  return JSON.parse(readFileSync(join(d, FRAME_INDEX), 'utf8')) as FrameIndex;
}

/** The tick Reckoning `n` settles on. */
function settlesAt(n: number): number {
  const t = n * TICKS_PER_RECKONING + (TICKS_PER_RECKONING - 1);
  if (!isSettlementTick(t)) throw new Error(`test arithmetic is wrong: ${String(t)} is not a settlement tick`);
  return t;
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

/**
 * THE ARCHIVE'S TABLE OF CONTENTS.
 *
 * D23 #5 read as "the per-Reckoning archive is not served". It was: the audit fetched
 * `r-15.json` and the file is `r-000015.json`. What was genuinely missing is anything that
 * published the naming rule or the set of indices, so no client could reach a Reckoning it
 * was not already looking at, and §14's replay had nothing to read.
 */
describe('the archive index', () => {
  it('names every published Reckoning and the file it actually lives in', () => {
    const d = dir();
    publishFrame(d, emptyFrame(15, settlesAt(15), 'h15'));
    const rows = index(d).reckonings;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reckoning).toBe(15);
    // The whole point: the padded filename is PUBLISHED rather than guessed at. An
    // unpadded guess is exactly the 404 the audit reported.
    expect(rows[0]?.file).toBe('r-000015.json');
    expect(readdirSync(d)).toContain(rows[0]?.file);
  });

  it('orders numerically, so a timeline past nine nights still reads in sequence', () => {
    // DET-1: a bare `.sort()` puts 10 before 2. On this file that is a history strip that
    // reads out of order for every archive older than nine Reckonings.
    const d = dir();
    for (const n of [2, 10, 1]) publishFrame(d, emptyFrame(n, settlesAt(n), `h${String(n)}`));
    expect(index(d).reckonings.map((r) => r.reckoning)).toEqual([1, 2, 10]);
  });

  it('carries no field the published frame does not', () => {
    // The §11.2 argument, executable. `frameIndexRow` takes a whole `ReckoningFrame` — a
    // value that already passed `assertInertPublicFacts` — so the index cannot disclose
    // anything the frame beside it does not. `file` is the one exception and is the naming
    // rule itself, which is the fact this index exists to publish.
    const frame = emptyFrame(4, settlesAt(4), 'h4');
    const row = frameIndexRow(frame);
    const published = JSON.parse(serialiseFrame(frame)) as Record<string, unknown> & {
      meters: Record<string, unknown>;
      rundown: unknown[];
    };
    expect(row.reckoning).toBe(published['reckoningIndex']);
    expect(row.tick).toBe(published['tick']);
    expect(row.stateHash).toBe(published['stateHash']);
    expect(row.levyShort).toBe(published.meters['levyShort']);
    expect(row.kept).toBe(published.meters['kept']);
    expect(row.broken).toBe(published.meters['broken']);
    expect(row.beats).toBe(published.rundown.length);
    expect(Object.keys(row).sort((a, b) => (a < b ? -1 : 1))).toEqual([
      'beats',
      'broken',
      'file',
      'kept',
      'levyShort',
      'reckoning',
      'stateHash',
      'tick',
    ]);
  });

  it('upserts rather than duplicating when a Reckoning is republished', () => {
    const d = dir();
    publishFrame(d, emptyFrame(3, settlesAt(3), 'h3'));
    publishFrame(d, emptyFrame(3, settlesAt(3), 'h3'));
    expect(index(d).reckonings).toHaveLength(1);
  });

  it('rebuilds from a corrupt table of contents rather than refusing to publish', () => {
    // A damaged derivative must never take the show down. Boot replay walks every settled
    // Reckoning in order, so the next restart refills the whole table from the record.
    const d = dir();
    writeFileSync(join(d, FRAME_INDEX), 'not json at all', 'utf8');
    publishFrame(d, emptyFrame(6, settlesAt(6), 'h6'));
    expect(index(d).reckonings.map((r) => r.reckoning)).toEqual([6]);
  });
});

/**
 * REPUBLISHING ON BOOT REPLAY.
 *
 * The live tick loop was the only publisher, so a restart whose replay swallowed a
 * settlement tick lost that night's frame permanently — and a renderer change reached a
 * viewer only at the next settlement, up to a whole Reckoning of wall clock later. Sixty
 * restarts in one day were measured on the deployed world.
 */
describe('publishReplayedFrame', () => {
  it('publishes the Reckoning a replayed settlement tick just settled', () => {
    const d = dir();
    const w = publishReplayedFrame(d, settlesAt(9), () => emptyFrame(9, settlesAt(9), 'h9'));
    expect(w?.file).toBe('r-000009.json');
    expect(readdirSync(d)).toContain('r-000009.json');
  });

  it('does not render on a non-settlement tick', () => {
    // A frame render is a whole-world read. Doing it on all 5,000 replayed ticks would turn
    // a two-minute boot into an outage, so the guard is the cheap one and comes first.
    const d = dir();
    let rendered = 0;
    for (const tick of [0, 1, 100, 286]) {
      publishReplayedFrame(d, tick, () => {
        rendered += 1;
        return emptyFrame(0, tick, 'h');
      });
    }
    expect(rendered).toBe(0);
    expect(readdirSync(d)).toEqual([]);
  });

  it('does nothing at all when no frames directory is configured', () => {
    let rendered = 0;
    expect(
      publishReplayedFrame(null, settlesAt(1), () => {
        rendered += 1;
        return emptyFrame(1, settlesAt(1), 'h');
      }),
    ).toBeNull();
    expect(rendered).toBe(0);
  });

  it('reports and swallows a render or write failure instead of stopping the replay', () => {
    // The world reproducing its own record outranks the show. A budget violation in some
    // historical night must not stop a boot.
    const d = dir();
    const said: string[] = [];
    const w = publishReplayedFrame(
      d,
      settlesAt(2),
      () => {
        throw new Error('a historical night violates a budget that did not exist then');
      },
      (m) => said.push(m),
    );
    expect(w).toBeNull();
    expect(said.join('')).toMatch(/republish failed at replayed tick/);
  });

  it('is a no-op write when the bytes have not moved', () => {
    // Sixty restarts a day would otherwise restamp the whole archive, destroying the one
    // cheap operator signal for when a Reckoning actually landed and quietly contradicting
    // the `immutable` cache-control those files are served under.
    const d = dir();
    const first = publishFrame(d, emptyFrame(8, settlesAt(8), 'h8'));
    expect(first.rewritten).toBe(true);
    const before = statSync(join(d, first.file)).mtimeMs;
    const again = publishReplayedFrame(d, settlesAt(8), () => emptyFrame(8, settlesAt(8), 'h8'));
    expect(again?.rewritten).toBe(false);
    expect(statSync(join(d, first.file)).mtimeMs).toBe(before);
  });

  it('rewrites when the renderer has gained a field, which is how the archive backfills', () => {
    const d = dir();
    publishFrame(d, emptyFrame(11, settlesAt(11), 'h11'));
    const grown = { ...emptyFrame(11, settlesAt(11), 'h11'), ticker: ['t287 a line the old renderer did not emit'] };
    const again = publishReplayedFrame(d, settlesAt(11), () => grown);
    expect(again?.rewritten).toBe(true);
    const onDisk = JSON.parse(readFileSync(join(d, 'r-000011.json'), 'utf8')) as { ticker: string[] };
    expect(onDisk.ticker).toHaveLength(1);
  });

  it('leaves the pointer and the index consistent with the newest replayed Reckoning', () => {
    const d = dir();
    for (const n of [0, 1, 2]) publishReplayedFrame(d, settlesAt(n), () => emptyFrame(n, settlesAt(n), `h${String(n)}`));
    const latest = JSON.parse(readFileSync(join(d, LATEST), 'utf8')) as { reckoningIndex: number };
    expect(latest.reckoningIndex).toBe(2);
    expect(index(d).reckonings.map((r) => r.reckoning)).toEqual([0, 1, 2]);
  });
});

describe('★ the LIVE frame is published, and it never touches the Reckoning archive', () => {
  const live = (tick: number, ticker: readonly string[] = []) =>
    renderLiveFrame({ tick, stateHash: `h${String(tick)}`, lastReckoning: null, ventures: [], ticker });

  it('writes one moving file and NO archive row', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // A live frame is not a Reckoning. `index.json` is what a scrubber is built from, so a
    // mid-Reckoning tick in it would be a night that never happened — and an `r-NNNNNN.json` for a
    // tick would claim A5's permanence for a projection whose history is the ledger.
    //
    // MUTATION: make `publishLiveFrame` call `publishIndex`. RED on the third assertion.
    // ══════════════════════════════════════════════════════════════════════════
    const d = dir();
    const written = publishLiveFrame(d, live(7));
    expect(written.tick).toBe(7);
    expect(written.rewritten).toBe(true);
    expect(readdirSync(d)).toEqual([LIVE]);
    const onDisk = JSON.parse(readFileSync(join(d, LIVE), 'utf8')) as { tick: number; phase: string };
    expect(onDisk.tick).toBe(7);
    expect(onDisk.phase).toBe('EARLY');
  });

  it('skips an identical rewrite, which is what makes `liveFramesMoved` mean anything', () => {
    // The meter the sim reports is "ticks on which the show actually changed". If an unchanged tick
    // rewrote the file, the meter could not report zero — and a meter that cannot report zero is the
    // defect it was written to detect.
    //
    // MUTATION: delete the `readFileSync(dest) === body` early return in `atomicWrite`. RED.
    const d = dir();
    expect(publishLiveFrame(d, live(7)).rewritten).toBe(true);
    expect(publishLiveFrame(d, live(7)).rewritten).toBe(false);
    expect(publishLiveFrame(d, live(7, ['t7 something happened'])).rewritten).toBe(true);
  });

  it('serialises through the canonical path, so a float cannot reach a viewer', () => {
    // The same guarantee `serialiseFrame` carries: money is integer minor units everywhere else and a
    // live frame is not an exception. Asserted rather than assumed, because this file is written 288
    // times more often than the nightly one and would be 288 times as many broken parses.
    const d = dir();
    const bad = { ...live(7), meters: { ...live(7).meters, onAPromise: 1.5 } } as unknown as ReturnType<typeof live>;
    expect(() => {
      publishLiveFrame(d, bad);
    }).toThrow(CanonicalError);
  });

  it('archives one file per tick under the instrument flag, seven-digit padded', () => {
    // The measurement mode. Production does NOT do this — see `frames/write.ts:archiveLiveFrame`.
    const d = dir();
    for (const t of [8, 9, 10]) archiveLiveFrame(d, live(t));
    expect(readdirSync(d).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([
      't-0000008.json',
      't-0000009.json',
      't-0000010.json',
    ]);
    // Padded so a directory listing sorts the way a human reads it, exactly as `frameFileName` is.
    expect(liveFrameFileName(10)).toBe('t-0000010.json');
    expect(() => liveFrameFileName(-1)).toThrow();
  });
});
