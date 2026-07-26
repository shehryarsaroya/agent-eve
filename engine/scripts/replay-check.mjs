#!/usr/bin/env node
/**
 * The deploy preflight, as a launcher.
 *
 * The check itself lives in `src/persist/replayCheck.ts`, where it is typed, linted
 * and covered by tests; this file only decides how to run it. Two ways, because the
 * two places it runs are different:
 *
 *   - on the server, after `npm run build`, `dist/persist/replayCheck.js` exists and
 *     is run with bare node (dev deps are pruned there, so `tsx` may be gone);
 *   - on a laptop pointed at a journal, there is no `dist/`, so it falls back to
 *     `npx tsx` over the source.
 *
 * Exit codes are the check's own: 0 reproduces (or the divergence was pre-declared),
 * 3 would NOT reproduce — the deploy must stop, 1 the check could not run.
 *
 * Usage:  COMPACT_DATABASE_URL=... node scripts/replay-check.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/persist/replayCheck.js', import.meta.url));
const source = fileURLToPath(new URL('../src/persist/replayCheck.ts', import.meta.url));

const [command, args] = existsSync(dist)
  ? ['node', [dist, ...process.argv.slice(2)]]
  : ['npx', ['tsx', source, ...process.argv.slice(2)]];

const run = spawnSync(command, args, { stdio: 'inherit' });
if (run.error !== undefined && run.error !== null) {
  process.stderr.write(`replay-check: could not launch ${command}: ${run.error.message}\n`);
  process.exit(1);
}
// A signal death is not a passing check. Anything but a clean 0 must fail the deploy.
process.exit(run.status === null ? 1 : run.status);
