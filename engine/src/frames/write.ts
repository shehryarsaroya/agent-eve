/**
 * Writing frames to disk, so the spectator client has something to read.
 *
 * The client polls `frames/latest.json` and, when a Reckoning is named there, the
 * immutable `frames/r-<n>.json`. That split is the whole delivery design (SPEC §15.5):
 * spectator frames are **static cacheable files behind Cloudflare**, not per-connection
 * SSE, because the Reckoning is exactly when you have an audience and that is precisely
 * when a connection-per-viewer model falls over.
 *
 * A settled Reckoning never changes, so `r-<n>.json` can be cached `immutable` for a
 * year while only the tiny pointer carries `no-store`. That is the difference between
 * serving one origin fetch during a spike and serving thousands.
 *
 * **Writes are atomic**, via a temp file and a rename. A viewer that fetches a
 * half-written frame during the one minute a night anyone is watching would be a
 * self-inflicted outage at the worst possible moment, and `rename(2)` within a
 * filesystem is the cheapest guarantee against it.
 *
 * ── THE ARCHIVE HAD NO INDEX, SO IT HAD NO HISTORY ───────────────────────────
 *
 * D23 finding #5 reported the per-Reckoning archive as *not served*. It was served the
 * whole time — the audit fetched `r-15.json` and the file is `r-000015.json`, because
 * {@link frameFileName} pads to six digits so a directory listing sorts the way a human
 * reads it. nginx's regex matched both; only one existed, so the 404 was honest.
 *
 * The real defect was underneath that: **nothing published the naming rule or the set of
 * indices**, so no client could reach a Reckoning it was not already looking at. A viewer
 * saw the latest night and could not see that there had been sixteen before it, and §14's
 * replay had nothing to read. `latest.json` is a 14 KB pointer, so "fetch them all and
 * find out" costs the whole archive to draw one strip.
 *
 * {@link FRAME_INDEX} is that missing surface: one small file naming every settled
 * Reckoning, its tick, its file, and the three §14.2 meters, so a client can draw a
 * timeline in one fetch and then pull only the night a viewer asks for.
 *
 * **It publishes nothing new, and that is structural rather than reviewed.**
 * {@link frameIndexRow} takes a {@link ReckoningFrame} — a value that has already been
 * through `assertInertPublicFacts` and `assertFrameBudgets` — and can only read fields
 * that are already serialised into the published file beside it. There is no path by
 * which the index can carry a fact the frame does not, which is the same argument
 * `projection.ts` makes about the frame itself, one layer down.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalize, type CanonicalValue } from '../core/canonical.js';
import { isSettlementTick } from '../core/time.js';
import { assertFrameBudgets, assertLiveFrameBudgets, type LiveFrame, type ReckoningFrame } from './contract.js';

export class FrameWriteError extends Error {}

/** Where the client looks. Matched by `deploy/nginx-compact.conf`. */
export const LATEST = 'latest.json';

/**
 * ★ Where the client looks **between** Reckonings. Matched by `deploy/nginx-compact.conf`.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE THIRD MOVING FILE, AND THE ONLY ONE THAT CHANGES WHILE ANYONE IS WATCHING.**
 *
 * {@link LATEST} is `max-age=2` against a file that, at `SPEEDS.prod`, changes **once every 24
 * hours** — 288 ticks × 300 s. The client polls it every 15 seconds, so 5,759 of every 5,760 polls
 * return the same bytes and a viewer arriving at an arbitrary moment sees a still image of yesterday.
 *
 * This file is the same shape and the same cache policy over a value that moves every tick. Nothing
 * about §15.5's delivery design changes: it is a **static file behind Cloudflare**, not a socket, and
 * the two-second cache means one origin fetch every two seconds serves any audience at all — which
 * is the exact property per-connection SSE would have destroyed *"because the Reckoning is exactly
 * when you have an audience"*.
 *
 * Rewritten in place rather than archived, and that is the one asymmetry with the Reckoning frame:
 * a settled Reckoning is A5's permanent record and gets an immutable file forever, while a
 * mid-Reckoning tick is *motion* and its history is the record, not this. An archive of 288 live
 * frames a day would be 105,000 files a year that nothing can be derived from that the ledger cannot
 * derive better.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const LIVE = 'live.json';

/**
 * The archive's table of contents. Matched by `deploy/nginx-compact.conf`.
 *
 * A moving file like {@link LATEST}, not an immutable one: it grows by a row every
 * Reckoning, so it is cached for seconds rather than for a year.
 */
export const FRAME_INDEX = 'index.json';

export function frameFileName(reckoning: number): string {
  if (!Number.isSafeInteger(reckoning) || reckoning < 0) {
    throw new FrameWriteError(`a Reckoning index must be a non-negative integer, got ${String(reckoning)}`);
  }
  // Zero-padded so a directory listing sorts the way a human expects, and so the
  // filename cannot collide with a differently-formatted write of the same index.
  return `r-${String(reckoning).padStart(6, '0')}.json`;
}

/**
 * Serialise a frame.
 *
 * Through the CANONICAL serialiser, not `JSON.stringify`, for two reasons that both
 * matter here. It throws on a float, so a frame carrying a fractional money value
 * cannot reach a viewer — money is integer minor units everywhere else and a frame is
 * not an exception. And it sorts keys, so the same settled Reckoning produces
 * byte-identical output on every host, which is what lets a frame be re-derived from
 * the ledger and compared rather than trusted.
 */
export function serialiseFrame(frame: ReckoningFrame): string {
  assertFrameBudgets(frame);
  return asJson(frame);
}

/**
 * Serialise a live frame. Same serialiser, same two guarantees, same reasons.
 *
 * Through {@link asJson} rather than `JSON.stringify` deliberately: a float in a money field cannot
 * reach a viewer, and the same tick serialises byte-identically on every host — which is what makes
 * {@link atomicWrite}'s no-op-on-identical path meaningful here. A tick in which nothing a viewer can
 * see changed writes **nothing**, so `live.json`'s mtime is an honest signal of the last time the
 * show moved.
 */
export function serialiseLiveFrame(frame: LiveFrame): string {
  assertLiveFrameBudgets(frame);
  return asJson(frame);
}

/**
 * Canonicalise for the GUARANTEES, then strip the version prefix for the WIRE.
 *
 * `canonicalize` returns `c<version>:{…}`, which is deliberately not valid JSON — the
 * prefix exists so a canonicaliser change is visible rather than silently rewriting a
 * hash. But the client fetches this with `response.json()`, and the first version of this
 * function shipped the prefix straight through, so every frame would have failed to parse
 * in the browser while every test that only checked "a file was written" passed.
 *
 * The body after the prefix IS valid JSON — sorted keys, integers only, no floats — so
 * stripping it keeps both properties that matter here (a float cannot reach a viewer, and
 * the same settled Reckoning serialises byte-identically on every host) while producing
 * something a browser can actually read.
 *
 * Shared with the archive index, deliberately: the index carries money (`levyShort`), and
 * a fractional minor unit has no more business on the timeline than it has on the frame.
 */
function asJson(value: unknown): string {
  const canonical = canonicalize(value as CanonicalValue);
  const colon = canonical.indexOf(':');
  if (colon < 0) throw new FrameWriteError('canonical form has no version prefix; the serialiser changed shape');
  const body = canonical.slice(colon + 1);

  // Assert what the client will do, here, rather than discovering it in a browser.
  try {
    JSON.parse(body);
  } catch (e) {
    throw new FrameWriteError(
      `a frame must be valid JSON for the client to read it: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return body;
}

/**
 * Atomically write one file inside `dir`.
 *
 * The temp name includes the target so two concurrent writes of *different* files
 * cannot collide on it. Concurrent writes of the SAME file are the caller's problem —
 * and with a single-writer sim process (OPS-5) there is only one writer by construction.
 *
 * **An identical rewrite is skipped**, and returns false. That matters because boot
 * replay republishes every settled Reckoning (see {@link publishReplayedFrame}) and the
 * service is restarted on every deploy — sixty times in one day, measured. Without this,
 * every restart would restamp the whole archive, destroying the one cheap operator signal
 * for *when a Reckoning actually landed*, and quietly contradicting the `immutable`
 * cache-control nginx serves those files under for no gain at all.
 */
function atomicWrite(dir: string, name: string, body: string): boolean {
  const tmp = join(dir, `.${name}.tmp`);
  const dest = join(dir, name);
  try {
    if (readFileSync(dest, 'utf8') === body) return false;
  } catch {
    // Absent or unreadable: fall through and write it.
  }
  writeFileSync(tmp, body, 'utf8');
  renameSync(tmp, dest);
  return true;
}

export interface WrittenFrame {
  readonly reckoning: number;
  readonly file: string;
  readonly bytes: number;
  /** False when the bytes on disk already matched — a republished, unchanged Reckoning. */
  readonly rewritten: boolean;
}

/**
 * One row of the archive's table of contents.
 *
 * Every field is copied off a {@link ReckoningFrame} that has already passed the
 * projection boundary, except `file`, which is the naming rule this index exists to
 * publish. So the index cannot disclose anything the frame beside it does not — the A9
 * parity question is answered one layer up, in `projection.ts`, and this file only
 * re-serves what that layer already admitted.
 *
 * The three meters ride along because a history strip that cannot say what a night was
 * *like* is a list of numbers a viewer has no reason to click. §14.2's `levyShort`,
 * `kept` and `broken` are the smallest set that makes one row legible, and all three are
 * already on the published frame.
 */
export interface FrameIndexRow {
  readonly reckoning: number;
  readonly tick: number;
  /** The archive filename. Six-digit padded — the fact nothing published before. */
  readonly file: string;
  readonly stateHash: string;
  readonly levyShort: number;
  readonly kept: number;
  readonly broken: number;
  /** Rundown segments that night, so a viewer can see which Reckonings had a show in them. */
  readonly beats: number;
}

export interface FrameIndex {
  readonly reckonings: readonly FrameIndexRow[];
}

/**
 * Project one already-published frame into its index row.
 *
 * Deliberately takes the whole `ReckoningFrame` and nothing else. A version that took the
 * runtime, or the outcome, or "just a couple of extra numbers", would be a second
 * projection boundary to police — and the first one took an outside critic to get right.
 */
export function frameIndexRow(frame: ReckoningFrame): FrameIndexRow {
  return {
    reckoning: frame.reckoningIndex,
    tick: frame.tick,
    file: frameFileName(frame.reckoningIndex),
    stateHash: frame.stateHash,
    levyShort: frame.meters.levyShort,
    kept: frame.meters.kept,
    broken: frame.meters.broken,
    beats: frame.rundown.length,
  };
}

/**
 * Read the index, or an empty one.
 *
 * A missing or unparseable index is recoverable and is treated as such rather than
 * thrown: boot replay walks every settled Reckoning in ascending order and upserts each,
 * so the next restart rebuilds the whole table from the record. Refusing to publish
 * because the table of contents is damaged would take the show down to protect a
 * derivative of it.
 */
function readIndex(dir: string): readonly FrameIndexRow[] {
  let raw: string;
  try {
    raw = readFileSync(join(dir, FRAME_INDEX), 'utf8');
  } catch {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const rows: unknown = (parsed as Record<string, unknown>)['reckonings'];
    if (!Array.isArray(rows)) return [];
    // Rows whose `reckoning` is not a number would break the numeric ordering below and
    // would name no file a viewer could fetch, so they are dropped rather than carried.
    return rows.filter(
      (r): r is FrameIndexRow =>
        typeof r === 'object' && r !== null && typeof (r as Record<string, unknown>)['reckoning'] === 'number',
    );
  } catch {
    return [];
  }
}

/**
 * Upsert this Reckoning's row and rewrite the table of contents.
 *
 * Ordered by an EXPLICIT numeric comparator. `reckoning` is a number, and DET-1 bans a
 * bare `.sort()` precisely because it would order 2 after 10 — which on this file would
 * be a timeline that reads out of sequence for anyone whose archive passed nine nights.
 */
function publishIndex(dir: string, frame: ReckoningFrame): void {
  const row = frameIndexRow(frame);
  const rows = [...readIndex(dir).filter((r) => r.reckoning !== row.reckoning), row].sort(
    (a, b) => a.reckoning - b.reckoning,
  );
  atomicWrite(dir, FRAME_INDEX, asJson({ reckonings: rows }));
}

/**
 * Publish a settled Reckoning.
 *
 * Order is deliberate: the immutable frame lands FIRST, then the pointer. A viewer that
 * reads the pointer always finds the file it names. The reverse order has a window in
 * which the client is told about a frame that does not exist yet — and it is a window
 * that only opens under load, which is when someone is watching.
 */
export function publishFrame(dir: string, frame: ReckoningFrame): WrittenFrame {
  mkdirSync(dir, { recursive: true });

  const body = serialiseFrame(frame);
  const name = frameFileName(frame.reckoningIndex);
  const rewritten = atomicWrite(dir, name, body);

  // The pointer is the frame itself rather than a reference, so the client needs ONE
  // fetch on the common path. It costs a duplicate of the newest frame on disk and
  // saves a round trip for every viewer, every poll.
  atomicWrite(dir, LATEST, body);

  // Last, and after the frame it names, for the same reason the pointer is: a table of
  // contents that lists a file the archive does not hold yet is a broken link, and it
  // would only break under the load of a Reckoning night.
  publishIndex(dir, frame);

  return { reckoning: frame.reckoningIndex, file: name, bytes: Buffer.byteLength(body, 'utf8'), rewritten };
}

/** What one live publish did. `rewritten: false` means the bytes on disk already matched. */
export interface WrittenLiveFrame {
  readonly tick: number;
  readonly bytes: number;
  readonly rewritten: boolean;
}

/**
 * ★ Publish the live frame — the motion between appointments.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE ORDERING RULE {@link publishFrame} HAS DOES NOT APPLY, AND THE REASON MATTERS.**
 *
 * `publishFrame` writes the immutable file first and the pointer second, so a viewer that reads the
 * pointer always finds the file it names. There is nothing here for a pointer to name: one file, one
 * atomic rename, and a reader either gets the previous tick whole or this one whole. That is the
 * whole delivery contract for this artifact and it is why it can be this small.
 *
 * **It never touches the Reckoning archive.** A live frame is not a Reckoning, so it writes no
 * `r-NNNNNN.json` and no row into `index.json` — a mid-Reckoning tick in the archive's table of
 * contents would be a night that never happened, and `index.json` is what a scrubber is built from.
 *
 * **Failure is the caller's to swallow**, exactly as it is for the nightly frame: *a frame is a read
 * model over a committed outcome*, and a full disk or a budget violation must drop a frame rather
 * than stop the world. `server.ts` wraps this for that reason and this function does not, so a caller
 * that wants to know it failed can find out — the nightly path learned that lesson the other way
 * round when a halt had no `else` branch and the world stopped dead in silence.
 * ══════════════════════════════════════════════════════════════════════════
 */
export function publishLiveFrame(dir: string, frame: LiveFrame): WrittenLiveFrame {
  mkdirSync(dir, { recursive: true });
  const body = serialiseLiveFrame(frame);
  const rewritten = atomicWrite(dir, LIVE, body);
  return { tick: frame.tick, bytes: Buffer.byteLength(body, 'utf8'), rewritten };
}

export function liveFrameFileName(tick: number): string {
  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new FrameWriteError(`a tick must be a non-negative integer, got ${String(tick)}`);
  }
  // Seven digits, so a directory listing sorts the way a human reads it up to ten million ticks —
  // `frameFileName`'s rule with one more digit, because there are 288 of these per Reckoning.
  return `t-${String(tick).padStart(7, '0')}.json`;
}

/**
 * ★ Archive one live frame per tick, for an instrument rather than for a viewer.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A FIELD THAT IS NON-ZERO ONCE AND A FIELD THAT COUNTS DOWN ARE DIFFERENT CLAIMS**, and only a
 * sequence can tell them apart. The audit that found the nightly frame to be a post-mortem did it by
 * reading 21 archived Reckoning frames and censusing every field; the same method needs consecutive
 * live frames, because *"`ticksLeft` is 6"* proves nothing and *"6, then 5, then 4"* proves the fix.
 *
 * Deliberately **not** what production does. `live.json` is rewritten in place there because a
 * mid-Reckoning tick is motion and its history is the ledger — 288 files a day that nothing can be
 * derived from that the record cannot derive better. This is a measurement mode behind
 * `--live-frames`, and `rewritten` is reported `true` only when the bytes moved, so the meter means
 * the same thing in both modes.
 * ══════════════════════════════════════════════════════════════════════════
 */
export function archiveLiveFrame(dir: string, frame: LiveFrame): WrittenLiveFrame {
  mkdirSync(dir, { recursive: true });
  const body = serialiseLiveFrame(frame);
  const rewritten = atomicWrite(dir, liveFrameFileName(frame.tick), body);
  return { tick: frame.tick, bytes: Buffer.byteLength(body, 'utf8'), rewritten };
}

/**
 * Publish a Reckoning the BOOT REPLAY has just crossed.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A FRAME PUBLISHED ONLY BY THE LIVE LOOP IS A FRAME THE ARCHIVE CAN LOSE FOREVER.**
 *
 * `server.ts` published on `report.clock.isSettlementTick` inside the live tick interval
 * and nowhere else. Boot replay re-derives every tick from the record but published
 * nothing, so a restart whose replay swallowed a settlement tick left a **permanent hole**
 * in the archive: `reckoningFrame()` renders from the runtime's state at that tick, the
 * live loop will never be at that tick again, and no later process could reconstruct the
 * night. Measured on the deployed world: sixty restarts in twenty-four hours against a
 * Reckoning every 288 ticks, which is roughly a one-in-five chance per day of losing a
 * night that A5 says is permanent and public.
 *
 * The same call closes the second half of D23 #5. A renderer change — the three §16
 * projections, say — reached a viewer only at the next settlement, up to a full Reckoning
 * of wall clock after the deploy that shipped it. Republishing on replay means the whole
 * archive is re-derived under the running code the moment the process comes up.
 *
 * **Re-deriving a settled frame is the designed behaviour, not a violation of its
 * immutability.** `serialiseFrame` goes through the canonical serialiser precisely so that
 * "the same settled Reckoning produces byte-identical output on every host, which is what
 * lets a frame be re-derived from the ledger and compared rather than trusted". An
 * unchanged Reckoning is a no-op write by construction ({@link atomicWrite}); one whose
 * bytes moved did so because the renderer gained a field, and the *record* it is derived
 * from has not changed at all.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `render` is a thunk so this file never holds a runtime handle, and it is only called on
 * a settlement tick — a frame render is a whole-world read and doing it on all 5,000
 * replayed ticks would turn a two-minute boot into an outage.
 *
 * Failure is reported and swallowed. A frame is a read model over a committed outcome, and
 * a full disk or a budget violation in some historical night must never stop the world
 * reproducing its own record.
 */
export function publishReplayedFrame(
  dir: string | null,
  tick: number,
  render: () => ReckoningFrame | null,
  onError: (message: string) => void = (m) => process.stderr.write(m),
): WrittenFrame | null {
  if (dir === null || !isSettlementTick(tick)) return null;
  try {
    const frame = render();
    if (frame === null) return null;
    return publishFrame(dir, frame);
  } catch (error: unknown) {
    onError(
      `frame republish failed at replayed tick ${String(tick)} (non-fatal): ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return null;
  }
}
