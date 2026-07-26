/**
 * A file-backed home for the cast's memory.
 *
 * Deliberately the only place in `src/cast` that touches a filesystem, and deliberately
 * behind {@link MemoryVault} so every test uses an in-memory double and no test needs a
 * temp directory.
 *
 * ## What this is not
 *
 * It is **not** part of the record. Nothing here is hashed, snapshotted, replayed or
 * published; `state_hash` cannot see it and `boot` does not read it. Deleting the file
 * costs the cast its grudges and costs the world nothing — which is exactly the blast
 * radius something outside the ledger should have, and the reason it can be written with
 * a plain `writeFileSync` rather than through the journal.
 *
 * ## Why it exists at all
 *
 * A6 needs *months of honest work* before the abuse means anything. With memory in the
 * heap, every deploy reset every member to a stranger — on a project that deploys several
 * times a day, no trust arc could ever be longer than a few hours.
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CastNote, MemoryVault } from './memory.js';

export function fileVault(path: string): MemoryVault {
  return {
    load(): Record<string, CastNote[]> | null {
      try {
        const raw = readFileSync(path, 'utf8');
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
        return parsed as Record<string, CastNote[]>;
      } catch {
        // Absent, unreadable, or not JSON. A cast with no memory is a cast that starts
        // fresh, which is the same state it was in before this file existed — never a
        // reason to refuse to boot.
        return null;
      }
    },

    save(all: Record<string, CastNote[]>): void {
      // Write-then-rename, so a crash mid-write leaves the previous memory intact rather
      // than a truncated file that `load` would then discard entirely. Cheap insurance
      // against losing every grudge to one bad moment.
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(all), 'utf8');
      renameSync(tmp, path);
    },
  };
}
