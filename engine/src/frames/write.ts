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
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalize, type CanonicalValue } from '../core/canonical.js';
import { assertFrameBudgets, type ReckoningFrame } from './contract.js';

export class FrameWriteError extends Error {}

/** Where the client looks. Matched by `deploy/nginx-compact.conf`. */
export const LATEST = 'latest.json';

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

  // Canonicalise for the GUARANTEES, then strip the version prefix for the WIRE.
  //
  // `canonicalize` returns `c<version>:{…}`, which is deliberately not valid JSON — the
  // prefix exists so a canonicaliser change is visible rather than silently rewriting a
  // hash. But the client fetches this with `response.json()`, and the first version of
  // this function shipped the prefix straight through, so every frame would have failed
  // to parse in the browser while every test that only checked "a file was written"
  // passed.
  //
  // The body after the prefix IS valid JSON — sorted keys, integers only, no floats —
  // so stripping it keeps both properties that matter here (a float cannot reach a
  // viewer, and the same settled Reckoning serialises byte-identically on every host)
  // while producing something a browser can actually read.
  const canonical = canonicalize(frame as unknown as CanonicalValue);
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
 */
function atomicWrite(dir: string, name: string, body: string): void {
  const tmp = join(dir, `.${name}.tmp`);
  const dest = join(dir, name);
  writeFileSync(tmp, body, 'utf8');
  renameSync(tmp, dest);
}

export interface WrittenFrame {
  readonly reckoning: number;
  readonly file: string;
  readonly bytes: number;
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
  atomicWrite(dir, name, body);

  // The pointer is the frame itself rather than a reference, so the client needs ONE
  // fetch on the common path. It costs a duplicate of the newest frame on disk and
  // saves a round trip for every viewer, every poll.
  atomicWrite(dir, LATEST, body);

  return { reckoning: frame.reckoningIndex, file: name, bytes: Buffer.byteLength(body, 'utf8') };
}
