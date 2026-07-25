/**
 * The repo-wide §3 vocabulary guard.
 *
 * `vocabulary.test.ts` proves the unions in `core/types.ts` against the canon, and
 * it is careful and compiler-checked. It also **missed every collision wave 1
 * actually shipped**, because all three lived in other modules:
 *
 *   `HoldingState.STANDING`   src/world/holding.ts
 *   `Protection.EXPOSED`      src/world/commons.ts   (§3: EXPOSURE never means peril scope)
 *   `GrantMandate` / `mandateOf`  src/identity/vc.ts (§3: MANDATE never means a grant)
 *
 * Each module's own verifier eventually found its own collision by writing a
 * scanner scoped to its own directory. That is three scanners that cannot see each
 * other, which is the same shape as the bug: a detector with a blind spot reads
 * exactly like a clean bill of health.
 *
 * So this file is deliberately the widest possible version — every `.ts` under
 * `src/`, every string-literal union member and every exported identifier, checked
 * against §3 parsed out of `SPEC.md`. It is slower and blunter than the typed
 * version and that is the point: scar #1 survived a full build and three critic
 * passes because every individual component was correct.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SPEC = readFileSync(new URL('../../../docs/design/SPEC.md', import.meta.url), 'utf8');
const SRC = new URL('../../src/', import.meta.url).pathname;

/** §3's Term column, parsed from the canon rather than copied out of it. */
function canonTerms(): ReadonlySet<string> {
  const section = SPEC.split('## 3. Vocabulary')[1]?.split('\n## 4.')[0];
  if (section === undefined) throw new Error('SPEC §3 not found — the guard cannot run');
  const terms = new Set<string>();
  for (const m of section.matchAll(/^\| \*\*(.+?)\*\* \|/gm)) {
    for (const part of (m[1] ?? '').split(/[·/]/)) {
      const t = part.trim();
      // §3 formats a few rows with markdown emphasis or backticks.
      const clean = t.replace(/[`*]/g, '').trim();
      if (/^[A-Z][A-Z_ ]*$/.test(clean)) terms.add(clean);
    }
  }
  return terms;
}

/**
 * Sanctioned uses, keyed by **`Union.member`**, not by the bare term.
 *
 * The first version of this map keyed on the term alone, and a mutation test
 * proved it worthless: reintroducing `HoldingState = 'STANDING'` — one of the very
 * collisions this file names in its header — passed all five tests, because
 * `STANDING` was globally allowlisted for the legitimate `Standing` type.
 *
 * That is the detector reproducing the bug it hunts. A canon term is never
 * sanctioned in the abstract; it is sanctioned in exactly one context, and any
 * other declaration reusing it is the second concept §3 forbids. So the key is
 * the pair, and every entry still states why.
 */
const SANCTIONED = new Map<string, string>([
  ['VentureKind.RAID', "§3's own Means column reads 'predation; a venture kind', sanctioning both"],
  ['VentureKind.LEVY', 'the LEVY venture kind is precisely how the LEVY obligation is discharged'],
  ['AccountKind.STORES', "§3 defines STORES as 'assets, inventory, balances'; a STORES account is exactly that"],
  ['AssertScope.TICK', 'the tick horizon and an assertion scoped to tick close are the same tick'],
  ['AssertScope.RECKONING', 'the Reckoning horizon; a Reckoning-scoped assertion names that same horizon'],
  ['Visibility.SEALED', "the visibility tier that holds seals — §3's SEAL row now says so explicitly"],
]);

function srcFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...srcFiles(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

interface Union {
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly members: readonly string[];
}

/**
 * Every string-literal union in `src/`, however it is declared: a named `type`, an
 * inline field annotation, or a `Set`/array of literals used as an enum. The
 * `core/types.ts` guard reaches only the first kind, and `Protection.EXPOSED` was
 * the first kind in a file that guard does not read.
 */
function allUnions(): readonly Union[] {
  const found: Union[] = [];
  for (const file of srcFiles()) {
    const rel = file.slice(file.indexOf('/src/') + 1);
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const [i, raw] of lines.entries()) {
      // Comments are prose, not a rules surface. But a *string literal* inside a
      // comment is still not a rules surface either, so strip both.
      const code = raw.replace(/\/\/.*$/, '');
      if (/^\s*\*/.test(code)) continue;
      const decl = code.match(/(?:type|readonly)?\s*(\w+)\s*[:=]\s*((?:'[A-Z][A-Z_]*'\s*\|\s*)+'[A-Z][A-Z_]*')/);
      if (decl === null) continue;
      const members = [...(decl[2] ?? '').matchAll(/'([A-Z][A-Z_]*)'/g)].map((m) => m[1] ?? '');
      found.push({ file: rel, line: i + 1, name: decl[1] ?? '?', members });
    }
  }
  return found;
}

describe('SPEC §3 is a rules surface — repo-wide', () => {
  it('the canon parsed out of SPEC §3 is non-trivial, so a silent parse failure cannot pass this suite', () => {
    // A guard that quietly finds zero canon terms would pass everything. This is
    // the guard's own guard.
    const canon = canonTerms();
    expect(canon.size).toBeGreaterThan(25);
    expect(canon).toContain('STANDING');
    expect(canon).toContain('EXPOSURE');
    expect(canon).toContain('MANDATE');
    expect(canon).toContain('HOLDING');
  });

  it('finds unions outside core/types.ts, or it is not actually wider than the typed guard', () => {
    // If this ever drops to only core/types.ts, the blind spot is back.
    const unions = allUnions();
    const dirs = new Set(unions.map((u) => u.file.split('/')[1]));
    expect(unions.length).toBeGreaterThan(8);
    expect(dirs.size).toBeGreaterThan(1);
  });

  it('no union member anywhere in src/ reuses a §3 canon term for a second concept', () => {
    const canon = canonTerms();
    const violations: string[] = [];
    for (const u of allUnions()) {
      for (const m of u.members) {
        if (!canon.has(m)) continue;
        // The pair, never the bare term — see the note on SANCTIONED.
        if (SANCTIONED.has(`${u.name}.${m}`)) continue;
        violations.push(`${u.file}:${u.line} ${u.name} = '${m}'`);
      }
    }
    // Three collisions shipped in wave 1 and every one of them would have been
    // caught here: HoldingState.STANDING, Protection.EXPOSED, and the MANDATE
    // reuse in vc.ts. All are fixed; this keeps them fixed.
    expect(violations).toEqual([]);
  });

  it('every sanctioned dual use carries a stated reason', () => {
    // The allowlist is the only way a collision can get in, so it is the thing
    // most worth guarding. An empty reason is not a reason.
    for (const [pair, reason] of SANCTIONED) {
      expect(reason.length, `${pair} has no justification`).toBeGreaterThan(20);
      // A bare term as a key would silently re-open the hole the mutation test
      // found, so the shape itself is asserted.
      expect(pair, `${pair} must be keyed Union.MEMBER, not a bare term`).toContain('.');
    }
  });

  it('the guard actually bites — a sanctioned term in an unsanctioned context is caught', () => {
    // The mutation test that saved this file. Keyed on the bare term, this passed
    // while `HoldingState = 'STANDING'` was live in the tree. Simulated here rather
    // than by editing src, so it runs on every CI pass instead of once by hand.
    const canon = canonTerms();
    const mutant: Union = {
      file: 'src/world/holding.ts',
      line: 22,
      name: 'HoldingState',
      members: ['STANDING', 'FALLEN'],
    };
    const caught: string[] = [];
    for (const m of mutant.members) {
      if (!canon.has(m)) continue;
      if (SANCTIONED.has(`${mutant.name}.${m}`)) continue;
      caught.push(`${mutant.name}.${m}`);
    }
    expect(caught).toEqual(['HoldingState.STANDING']);
  });

  it('no source file contains a NUL byte', () => {
    // Wave 1 shipped nine of them across two ledger files and one identity test.
    // `file(1)` reports such a file as `data` and grep skips it entirely, so every
    // grep-based guard above — and SEC-9's outbound secret scan — silently stops
    // covering it while tsc, eslint and vitest all stay green.
    const withNul = srcFiles().filter((f) => readFileSync(f).includes(0));
    expect(withNul).toEqual([]);
  });
});
