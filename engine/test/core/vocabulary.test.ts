/**
 * PROP-O3-adjacent: the counting tests. "The budget is enforced by arithmetic,
 * not intentions" (TESTING.md §4.7).
 *
 * `scripts/budget-audit.mjs` already counts axioms, verbs and observe keys out of
 * SPEC.md. This file covers what that script cannot: the **engine's own unions**,
 * and whether they still agree with the canon. SPEC §3 is a rules surface, and
 * scar #1 is the engine and the agent-facing text disagreeing about one word — a
 * bug that survived a full build and three critic passes because every individual
 * component was correct. The only way to catch it is to compare the two surfaces
 * directly, in a test. Two collisions found this way are reported at the bottom.
 *
 * The lists below are proved complete by the compiler, not by eyeballing: each is
 * checked with an `Exclude<>` that fails to compile if a union member is missing.
 * A runtime count over a hand-maintained list would drift silently, which is the
 * exact failure this file exists to prevent.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type {
  Visibility,
  DecisionSource,
  ProvenanceClass,
  ZoneTier,
  HandState,
  VentureKind,
  VentureState,
  SealVerdict,
  WorldStatus,
  InvariantViolation,
} from '../../src/core/types.js';

/**
 * `InvariantViolation.severity` is declared inline rather than as a named type,
 * so it was originally missing from the list below — and a mutation test proved
 * the omission was invisible: changing it to `'HALT' | 'WARN' | 'LIVE' | 'SEALED'`
 * passed both `tsc --noEmit` and the whole suite. Referenced through an indexed
 * access so it cannot be forgotten again, and so the `Covers<>` proof reaches it.
 */
type Severity = InvariantViolation['severity'];

const SPEC = readFileSync(new URL('../../../docs/design/SPEC.md', import.meta.url), 'utf8');

/**
 * Compile-time proof that a literal list covers a whole union. If a member is
 * added to the union without being added here, `Exclude<>` is non-never and the
 * assignment fails to compile — which is what makes the runtime count below mean
 * something.
 */
type Covers<Union, List extends readonly Union[]> = [Exclude<Union, List[number]>] extends [never]
  ? true
  : { missing: Exclude<Union, List[number]> };

const VISIBILITY = ['PUBLIC', 'PARTIES', 'SENSED', 'SEALED', 'PRIVATE'] as const;
/**
 * Canon terms an engine enum may legitimately use, because §3 states the two
 * meanings are ONE concept. Every entry needs that justification; "it seemed
 * fine" is how scar #1 shipped.
 */
const SANCTIONED_DUAL_USE = new Set(['RAID', 'LEVY', 'STORES', 'TICK', 'SEALED']);

const DECISION_SOURCE = ['LIVE', 'INTENT', 'DELEGATE', 'HEURISTIC', 'FALLBACK'] as const;
const PROVENANCE = ['FACT', 'ASSERTION', 'ESTIMATE'] as const;
const ZONE_TIER = ['COMMONS', 'MARCHES', 'FRONTIER'] as const;
const HAND_STATE = ['IDLE', 'IN_TRANSIT', 'COMMITTED', 'RECOVERING'] as const;
const VENTURE_KIND = ['HAUL', 'DIG', 'ESCORT', 'RAID', 'BUILD', 'SURVEY', 'SIEGE', 'LEVY'] as const;
const VENTURE_STATE = ['FORMING', 'LIVE', 'SETTLED', 'DEFAULTED', 'ABANDONED', 'DEFERRED'] as const;
const SEAL_VERDICT = ['HONOURED', 'CONTRADICTED'] as const;
const WORLD_STATUS = ['RUNNING', 'PAUSED'] as const;
const SEVERITY = ['HALT', 'WARN'] as const;

const _visibilityComplete: Covers<Visibility, typeof VISIBILITY> = true;
const _decisionSourceComplete: Covers<DecisionSource, typeof DECISION_SOURCE> = true;
const _provenanceComplete: Covers<ProvenanceClass, typeof PROVENANCE> = true;
const _zoneTierComplete: Covers<ZoneTier, typeof ZONE_TIER> = true;
const _handStateComplete: Covers<HandState, typeof HAND_STATE> = true;
const _ventureKindComplete: Covers<VentureKind, typeof VENTURE_KIND> = true;
const _ventureStateComplete: Covers<VentureState, typeof VENTURE_STATE> = true;
const _sealVerdictComplete: Covers<SealVerdict, typeof SEAL_VERDICT> = true;
const _worldStatusComplete: Covers<WorldStatus, typeof WORLD_STATUS> = true;
const _severityComplete: Covers<Severity, typeof SEVERITY> = true;

/**
 * Every string-literal union in core/types.ts, with the name an error message
 * should print — **including the ones declared inline on an interface field**,
 * which is where the first version of this file had a hole.
 */
const ALL_ENUMS: readonly (readonly [string, readonly string[]])[] = [
  ['Visibility', VISIBILITY],
  ['DecisionSource', DECISION_SOURCE],
  ['ProvenanceClass', PROVENANCE],
  ['ZoneTier', ZONE_TIER],
  ['HandState', HAND_STATE],
  ['VentureKind', VENTURE_KIND],
  ['VentureState', VENTURE_STATE],
  ['SealVerdict', SEAL_VERDICT],
  ['WorldStatus', WORLD_STATUS],
  ['InvariantViolation.severity', SEVERITY],
];

/** The §3 vocabulary table's Term column, parsed from the canon. */
function specTerms(): string[] {
  const section = SPEC.split('## 3. Vocabulary')[1]?.split('\n## 4.')[0];
  if (section === undefined) throw new Error('SPEC §3 not found');
  const terms: string[] = [];
  for (const m of section.matchAll(/^\| \*\*(.+?)\*\* \| (.+?) \| (.+?) \|$/gm)) {
    // A row may name several terms in one cell, e.g. "ESCROWED / ELECTIVE".
    for (const part of m[1]!.split(/[·/]/)) terms.push(part.trim());
  }
  return terms;
}

describe('the compile-time coverage proofs are live', () => {
  it('every union is proved complete by the type checker', () => {
    // Referenced so the constants are not dead code; the real assertion happened
    // at `npx tsc --noEmit`.
    expect([
      _visibilityComplete,
      _decisionSourceComplete,
      _provenanceComplete,
      _zoneTierComplete,
      _handStateComplete,
      _ventureKindComplete,
      _ventureStateComplete,
      _sealVerdictComplete,
      _worldStatusComplete,
      _severityComplete,
    ]).toEqual(new Array<boolean>(10).fill(true));
  });

  it('the enum list covers every string-literal union that core/types.ts declares', () => {
    // Counted out of the source, because `Covers<>` proves each LISTED union is
    // complete and says nothing about whether the list itself is. A mutation that
    // added 'LIVE' to the inline `severity` union passed tsc and the whole suite
    // before this test existed — the exact scar #1 shape, in the file whose job is
    // to prevent it.
    const src = readFileSync(new URL('../../src/core/types.ts', import.meta.url), 'utf8');
    // Every run of two or more single-quoted UPPER_SNAKE literals joined by `|`.
    const unions = [...src.matchAll(/'[A-Z][A-Z_]*'(?:\s*\|\s*'[A-Z][A-Z_]*')+/g)].map((m) =>
      m[0].split('|').map((s) => s.trim().replace(/'/g, '')),
    );
    expect(unions.length, 'no unions found — the regex has rotted').toBeGreaterThanOrEqual(9);
    const known = ALL_ENUMS.map(([, l]) => [...l].sort((a, b) => (a < b ? -1 : 1)).join(','));
    const unaccounted = unions
      .map((u) => [...u].sort((a, b) => (a < b ? -1 : 1)).join(','))
      // `Extract<Visibility, 'PUBLIC' | 'PARTIES'>` is a narrowing of a covered
      // union, not a new one.
      .filter((k) => k !== 'PARTIES,PUBLIC')
      .filter((k) => !known.includes(k));
    expect(unaccounted, 'a string-literal union in types.ts is not in ALL_ENUMS').toEqual([]);
  });
});

describe('PROP-O3 — the §17 budgets, counted', () => {
  it('venture kinds are at the ceiling of 8, so adding one means removing one', () => {
    expect(VENTURE_KIND.length).toBeLessThanOrEqual(8);
    expect(VENTURE_KIND.length).toBe(8);
  });

  it('visibility is exactly five tiers, one ladder, used everywhere', () => {
    expect(VISIBILITY.length).toBe(5);
  });

  it('no enum has a duplicate member', () => {
    for (const [name, list] of ALL_ENUMS) {
      expect(new Set<string>(list).size, name).toBe(list.length);
    }
  });

  it('the union sizes are all pinned, so a quiet addition shows up as a diff', () => {
    expect(ALL_ENUMS.map(([, l]) => l.length)).toEqual([5, 5, 3, 3, 4, 8, 6, 2, 2, 2]);
  });
});

describe('scar #1 — the engine and the canon must not disagree about a word', () => {
  it('SPEC §3 names the same five visibility tiers, in the same spelling and order', () => {
    // Deliberately located inside §3 rather than by a global search: the v3.0
    // header note also says "five-tier ladder" and does not list the tiers, so a
    // naive `find` matches the wrong line and the test passes vacuously.
    const section = SPEC.split('## 3. Vocabulary')[1]?.split('\n## 4.')[0];
    expect(section, 'SPEC §3 not found').toBeDefined();
    const ladder = section!.split('\n').find((l) => l.includes('five-tier ladder'));
    expect(ladder, "SPEC §3 no longer states the visibility ladder").toBeDefined();
    for (const tier of VISIBILITY) {
      expect(ladder!.includes(tier), `SPEC §3's ladder is missing ${tier}`).toBe(true);
    }
    const positions = VISIBILITY.map((t) => ladder!.indexOf(t));
    expect(positions, 'the ladder is stated in a different order from the engine union').toEqual(
      [...positions].sort((a, b) => a - b),
    );
  });

  it('every engine VentureKind appears in SPEC.md verbatim', () => {
    for (const kind of VENTURE_KIND) {
      expect(SPEC.includes(kind), `VentureKind '${kind}' appears nowhere in SPEC.md`).toBe(true);
    }
  });

  it('every engine DecisionSource appears in SPEC.md verbatim', () => {
    // Without decision_source, R3, R4 and the A4 audit are unmeasurable, so the
    // set has to stay pinned to the canon rather than growing quietly in code.
    for (const src of DECISION_SOURCE) {
      expect(SPEC.includes(src), `DecisionSource '${src}' appears nowhere in SPEC.md`).toBe(true);
    }
  });

  it('ZoneTier and ProvenanceClass appear in SPEC.md, though only in prose casing', () => {
    // The canon writes these as words rather than as enum members: "the Commons",
    // "authoritative fact vs. counterparty assertion vs. model estimate". So the
    // cross-check is necessarily case-insensitive here, and it is weaker than the
    // verbatim checks above — noted rather than hidden.
    const lower = SPEC.toLowerCase();
    for (const v of [...ZONE_TIER, ...PROVENANCE]) {
      expect(lower.includes(v.toLowerCase()), `'${v}' appears nowhere in SPEC.md`).toBe(true);
    }
  });

  it('SPEC §3 defines each term exactly once', () => {
    // The vocabulary table is the canon. A term appearing twice means one word has
    // two definitions, which is the §3 violation the whole table exists to prevent.
    const terms = specTerms();
    expect(terms.length).toBeGreaterThanOrEqual(30);
    const seen = new Map<string, number>();
    for (const t of terms) seen.set(t, (seen.get(t) ?? 0) + 1);
    expect(
      [...seen.entries()].filter(([, n]) => n > 1).map(([t]) => t),
      'one word, two definitions',
    ).toEqual([]);
  });

  it('the canon still forbids a second spelling of any tier', () => {
    // If this sentence is ever deleted from the spec, the rule it states stops
    // being enforceable and the tests here become the only record of it.
    expect(SPEC.includes('no second spelling of any tier')).toBe(true);
  });
});

describe('DEFECT reports against src/core/types.ts — §3 collisions', () => {
  it.fails(
    "DEFECT(core/types): 'LIVE' names two concepts — VentureState.LIVE (a venture is running) and DecisionSource.LIVE (an agent decided in the moment)",
    () => {
      // HARD RULE 4 and SPEC §3: no word may name two concepts, anywhere,
      // including field values. This is the shape of scar #1 exactly — an agent
      // reading `decision_source: "LIVE"` next to `state: "LIVE"` has no way to
      // know they are unrelated, and the two will end up in the same observation.
      const owners = new Map<string, string>();
      const collisions: string[] = [];
      for (const [enumName, members] of ALL_ENUMS) {
        for (const m of members) {
          const prior = owners.get(m);
          if (prior !== undefined) collisions.push(`${m}: ${prior} + ${enumName}`);
          else owners.set(m, enumName);
        }
      }
      expect(collisions).toEqual([]);
    },
  );

  it('the cross-enum collision set is recorded here so the defect above is not abstract', () => {
    const owners = new Map<string, string>();
    const collisions: string[] = [];
    for (const [enumName, members] of ALL_ENUMS) {
      for (const m of members) {
        const prior = owners.get(m);
        if (prior !== undefined) collisions.push(`${m}: ${prior} + ${enumName}`);
        else owners.set(m, enumName);
      }
    }
    // Exactly one today. If a second appears, this assertion fails and someone
    // has to decide which word to give up.
    expect(collisions).toEqual(['LIVE: DecisionSource + VentureState']);
  });

  it('FIXED: no engine enum reuses a §3 canon term for a second concept', () => {
    // Was an it.fails pin on DecisionSource.STANDING. §3 gives STANDING to "the
    // public factual vectors", and the engine also used it for "this decision came
    // from a durable pre-set intent". Both ship in the same payload — `standing`
    // on counterparties, `decision_source` on every event — so an agent told
    // `decision_source: "STANDING"` could reasonably read it as "decided by
    // reputation". Renamed to INTENT in SPEC §15.1, the schema enum, and here;
    // A3 already calls these "durable intents", so it is the canon's own word.
    //
    // Sanctioned dual uses are excluded, each because §3 itself says the two
    // meanings are ONE concept rather than two:
    //   RAID    — §3's Means column literally reads "predation; a venture kind".
    //   LEVY    — the LEVY venture kind is how the LEVY obligation is discharged.
    //   STORES  — §3 defines STORES as "assets, inventory, balances"; an account
    //             of kind STORES holds exactly that.
    //   TICK    — the tick horizon and an assertion scoped to tick close are the
    //             same tick.
    //   SEALED  — the visibility tier that holds seals. §3's SEAL row used to say
    //             "never a visibility level" while §3's own ladder included
    //             SEALED; that self-contradiction is now fixed in the canon.
    const canon = new Set(specTerms());
    const collisions: string[] = [];
    for (const [enumName, members] of ALL_ENUMS) {
      for (const m of members) {
        if (canon.has(m) && !SANCTIONED_DUAL_USE.has(m)) collisions.push(`${enumName}.${m}`);
      }
    }
    expect(collisions).toEqual([]);
  });

  it('the canon rows this guard depends on are still in SPEC §3', () => {
    // The guard above is only meaningful while §3 still says these things. If
    // someone edits the canon, they must do it on purpose.
    expect(SPEC).toContain('| **STANDING** | the public factual vectors');
    expect(SPEC).toContain('predation; a venture kind');
    // The SEAL row's self-contradiction is fixed: it used to forbid "a visibility
    // level" while §3's own ladder included SEALED.
    expect(SPEC).toContain('the tier that holds seals');
    expect(SPEC).not.toContain('a bonding tier; a visibility level');
    // And the rename actually landed in the canon, not just the engine.
    expect(SPEC).toContain('{LIVE, INTENT, DELEGATE, HEURISTIC, FALLBACK}');
    expect(specTerms()).toContain('STANDING');
  });
});
