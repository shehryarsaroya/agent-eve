#!/usr/bin/env node
/**
 * PROP-O3 — the rules-budget audit.
 *
 * SPEC §17: "<=15 axioms, <=40 verbs, <=10 top-level observe keys, <=8 venture
 * kinds ... every addition was individually justified by a critic, which is
 * exactly why the drift is invisible. Adding one means removing one. Enforced by
 * a test that counts them, not by good intentions."
 *
 * This is that test. It reads the spec as the source of truth and cross-checks
 * the engine's own enums against it, so a verb added in code without a spec
 * entry (or the reverse) fails the build. That cross-check is the point: the
 * spec and the engine disagreeing about the vocabulary *is* scar #1.
 */

import { readFileSync } from 'node:fs';

const SPEC = new URL('../../docs/design/SPEC.md', import.meta.url).pathname;
const TYPES = new URL('../src/core/types.ts', import.meta.url).pathname;

const BUDGETS = { axioms: 15, verbs: 40, observeKeys: 10, ventureKinds: 8 };

const spec = readFileSync(SPEC, 'utf8');
const types = readFileSync(TYPES, 'utf8');
const problems = [];

// ── axioms ──────────────────────────────────────────────────────────────────
const axiomSection = spec.split('## 3.')[0];
const axioms = [...axiomSection.matchAll(/\*\*A(\d+)['′]? /g)].map((m) => m[1]);
const axiomCount = new Set(axioms).size;

// ── verbs ───────────────────────────────────────────────────────────────────
const actBlock = spec.match(/### 12\.2 act\n\n```text\n([\s\S]*?)```/);
if (!actBlock) problems.push('could not find the §12.2 act block in SPEC.md');
let verbs = [];
if (actBlock) {
  for (const line of actBlock[1].split('\n')) {
    if (!line.trim() || line.startsWith(' ')) continue; // continuation lines
    const rest = line.slice(line.indexOf(' ')).trim();
    // A verb line may carry a trailing prose clause after an em dash.
    const head = rest.split('—')[0];
    verbs.push(...head.split('·').map((v) => v.trim()).filter(Boolean));
  }
}

// ── observe keys ────────────────────────────────────────────────────────────
const obsBlock = spec.match(/```text\n(header [\s\S]*?)```/);
if (!obsBlock) problems.push('could not find the §12.1 observe block in SPEC.md');
const observeKeys = obsBlock
  ? obsBlock[1].split('\n').filter((l) => l && !l.startsWith(' ')).map((l) => l.split(/\s+/)[0])
  : [];

// ── venture kinds: spec §3 vs the engine's own union ────────────────────────
const kindRow = spec.match(/VENTURE\*\*[^\n]*\n/);
const engineKinds = types.match(/export type VentureKind =([^;]+);/);
const engineKindList = engineKinds
  ? [...engineKinds[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1])
  : [];

// ── report ──────────────────────────────────────────────────────────────────
const counts = {
  axioms: axiomCount,
  verbs: verbs.length,
  observeKeys: observeKeys.length,
  ventureKinds: engineKindList.length,
};

for (const [k, limit] of Object.entries(BUDGETS)) {
  if (counts[k] > limit) {
    problems.push(`${k}: ${counts[k]} exceeds the §17 budget of ${limit}. Remove one before adding one.`);
  }
}

// Axioms are exactly 15, not at most: the set is the design's spine and a
// missing one means a section was deleted, not that we got tidier.
if (counts.axioms !== 15) {
  problems.push(`axioms: expected exactly 15, found ${counts.axioms}`);
}
if (counts.observeKeys !== 10) {
  problems.push(
    `observe keys: expected exactly 10 (the budget is at its ceiling), found ${counts.observeKeys}: ${observeKeys.join(' ')}`,
  );
}

// Duplicate verbs would mean one word naming two concepts — a §3 violation.
const dupes = verbs.filter((v, i) => verbs.indexOf(v) !== i);
if (dupes.length > 0) {
  problems.push(`verb declared twice (one word, two concepts — §3): ${[...new Set(dupes)].join(', ')}`);
}

// Every engine venture kind must appear in the spec's own canon row.
if (kindRow) {
  for (const kind of engineKindList) {
    if (!spec.includes(kind)) {
      problems.push(`engine VentureKind '${kind}' appears nowhere in SPEC.md — the engine and the canon disagree`);
    }
  }
}

console.log('Rules budget (§17):');
console.log(`  axioms         ${counts.axioms}/15`);
console.log(`  verbs          ${counts.verbs}/40`);
console.log(`  observe keys   ${counts.observeKeys}/10`);
console.log(`  venture kinds  ${counts.ventureKinds}/8   [${engineKindList.join(' ')}]`);

if (problems.length > 0) {
  console.error('\nPROP-O3 budget audit FAILED:\n');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\nPROP-O3 budget audit passed.');
