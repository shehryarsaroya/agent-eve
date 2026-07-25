#!/usr/bin/env node
/**
 * DET-8 — the scale audit. Runs in CI, fails the build.
 *
 * TESTING.md §1.1, hazard 1: compressing the tick does not compress wall-clock
 * durations. At 30x a legitimate agent making one request per tick looks like a
 * flood, and a "daily" mail cap becomes a per-48-minute cap that throttles the
 * Dispatch. Worse, rate limiting is load-dependent, so it presents as agents
 * mysteriously underperforming rather than as an error.
 *
 * So: every duration in this codebase is either expressed in ticks, or derived
 * from tickSeconds(), or explicitly whitelisted with a justification. This
 * script finds the ones that are none of those.
 *
 * Written in commit #1 deliberately — retrofitting it means auditing a whole
 * codebase instead of a diff.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN_DIRS = ['src', 'scripts'];

/**
 * Every entry needs a reason, and the reason must say why the value is either
 * genuinely scale-invariant or derived. "It seemed fine" is not a reason.
 */
const WHITELIST = [
  {
    file: 'src/core/time.ts',
    reason:
      'Defines the scale itself. SPEEDS holds the tick lengths; every other duration derives from tickSeconds().',
  },
  {
    file: 'scripts/scale-audit.mjs',
    reason: 'This file names the patterns it searches for.',
  },
  {
    file: 'src/api/limits.ts',
    reason:
      'Rate limits are deliberately wall-clock: they protect the host, not the game, so they must NOT compress with the tick. Asserted scale-invariant by design.',
  },
];

// Suffixes that indicate a duration in the identifier itself.
const DURATION_NAME = /(?:_|\b)(ms|millis|milliseconds|seconds|secs|minutes|mins|hours|hrs|days|timeout|interval|delay|backoff|ttl|expiry|expires|cooldown|period|deadline)(?:_|\b)/i;

// Identifiers that make a numeric literal legitimate: it is in ticks.
const TICK_NAME = /tick/i;

const findings = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walk(full);
    } else if (/\.(ts|mjs|js)$/.test(entry)) {
      audit(full);
    }
  }
}

function audit(path) {
  const rel = relative(ROOT, path);
  if (WHITELIST.some((w) => w.file === rel)) return;

  const lines = readFileSync(path, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // Skip comments; a comment mentioning "5 minutes" is documentation.
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    if (!code.trim()) return;

    // An assignment or property whose name says "duration" and whose value is a
    // bare number is the exact hazard: it will not scale.
    const assign = code.match(
      /(?:const|let|var|readonly)?\s*([A-Za-z_$][\w$]*)\s*[:=]\s*(\d[\d_]*)\b/,
    );
    if (assign) {
      const [, name, value] = assign;
      if (DURATION_NAME.test(name) && !TICK_NAME.test(name)) {
        findings.push({
          file: rel,
          line: i + 1,
          name,
          value,
          why: 'duration-named identifier holds a bare literal; express it in ticks or derive from tickSeconds()',
        });
      }
    }

    // setTimeout/setInterval with a literal is always suspect: at 30x it fires
    // 30x too late relative to game time.
    const timer = code.match(/\b(setTimeout|setInterval)\s*\([^,]*,\s*(\d[\d_]*)/);
    if (timer) {
      findings.push({
        file: rel,
        line: i + 1,
        name: timer[1],
        value: timer[2],
        why: 'timer with a literal delay; use ticksToMs() so it scales with the clock',
      });
    }

    // Obvious wall-clock arithmetic.
    if (/\b\d+\s*\*\s*1000\b/.test(code) || /\b(?:60|3600|86400)\s*\*\s*1000\b/.test(code)) {
      findings.push({
        file: rel,
        line: i + 1,
        name: '(inline)',
        value: code.trim().slice(0, 60),
        why: 'inline milliseconds arithmetic; derive from ticksToMs()',
      });
    }
  });
}

for (const d of SCAN_DIRS) {
  try {
    walk(join(ROOT, d));
  } catch {
    // Directory may not exist yet during early scaffolding.
  }
}

if (findings.length > 0) {
  console.error('DET-8 scale audit FAILED — durations that will not compress with the tick:\n');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.name} = ${f.value}`);
    console.error(`      ${f.why}\n`);
  }
  console.error(
    'Fix by expressing the value in ticks, deriving it from tickSeconds()/ticksToMs(),',
  );
  console.error('or adding it to WHITELIST in this file with a reason that says why it is safe.');
  process.exit(1);
}

console.log(`DET-8 scale audit passed (${WHITELIST.length} whitelisted, each with a stated reason).`);
