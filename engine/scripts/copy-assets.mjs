#!/usr/bin/env node
/**
 * Copy non-TypeScript assets into `dist/`.
 *
 * `tsc` compiles `.ts` and ignores everything else, so `src/db/schema.sql` — which
 * `migrate.ts` reads via `new URL('./schema.sql', import.meta.url)` — was absent from
 * the build and the deploy died at ENOENT on first migration.
 *
 * The URL resolution is correct and stays: the schema belongs in a `.sql` file where
 * it is readable and tooling can lint it, not inlined into a template literal. What
 * was missing is that the build had no notion of an asset at all.
 *
 * It ASSERTS rather than silently copying nothing. A build step that finds zero files
 * and exits 0 is how the same failure comes back looking like success.
 */

import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'dist');

/** Extensions the runtime reads at run time. Add one only with a reason. */
const ASSET_EXT = ['.sql'];

/** Assets the build MUST find. A typo in a path is otherwise a silent no-op. */
const REQUIRED = ['db/schema.sql'];

function walk(dir) {
  const out = [];
  // Explicit comparator: DET-1 bans a bare .sort() even on strings, because the
  // default is implementation-defined for anything else and the habit is the point.
  for (const name of readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (ASSET_EXT.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

const found = walk(SRC).map((f) => relative(SRC, f));

for (const need of REQUIRED) {
  if (!found.includes(need)) {
    console.error(`copy-assets: required asset src/${need} not found; the build would ship broken`);
    process.exit(1);
  }
}

for (const rel of found) {
  const dest = join(OUT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(SRC, rel), dest);
}

console.log(`copy-assets: ${String(found.length)} asset(s) → dist/ (${found.join(', ')})`);
