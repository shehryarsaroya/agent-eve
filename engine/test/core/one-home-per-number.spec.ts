/**
 * **TWO HOMES FOR ONE NUMBER, AS AN EXECUTABLE REFUSAL.**
 *
 * This repo's most expensive recurring defect is one quantity or one rule declared in two places,
 * free to drift. Scar #5 is its name; `core/params.ts`, `core/allocate.ts`, `ledger/endowment.ts`,
 * `sovereignty/params.ts` and `market/order.ts` each carry a docstring about a specific instance of
 * it. Every one of those docstrings was written *after* the drift was found, and not one of them could
 * stop the next one — a comment saying "do not copy this" is not a mechanism.
 *
 * So this file is the mechanism, and it is deliberately **structural**: it reads source text rather
 * than calling functions. A behavioural test cannot catch these, and that is the whole problem — the
 * copies were byte-identical when they were made. `tick/loop.ts` held a `readInt` identical to
 * `core/params.ts`'s, and no test of either could tell, because they agreed. They agree until somebody
 * hardens one.
 *
 * ── WHY EACH ASSERTION IS NON-VACUOUS ────────────────────────────────────────
 *
 * A structural test can pass by looking at nothing — the exact failure this file exists to prevent,
 * one level up (`test/api/withheld-is-accountable.spec.ts` and the `typeof hook === 'function'` guard
 * that could never fail are the local precedents). So every `it` below first asserts that the thing it
 * scans **is really there**: the file list is non-empty, the canonical declaration is found, the
 * pattern it forbids is one the harness can actually match. Read the `expect(...).toBeGreaterThan(0)`
 * lines as part of the test, not as noise.
 *
 * ── HOW TO MUTATION-TEST IT ──────────────────────────────────────────────────
 *
 * Each block names its mutation. Re-add the copy it forbids and the block must go red; if it stays
 * green, the assertion is checking the wrong spelling and is worth less than no test.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { largestRemainder, AllocationError } from '../../src/core/allocate.js';
import { readInt, readString } from '../../src/core/params.js';
import { TICKS_PER_RECKONING, WINDOW_FIRST_PHASE } from '../../src/core/time.js';
import { BPS_ONE, minor, qty, type Minor, type Qty } from '../../src/core/units.js';
import { STARTER_ALLOTMENT } from '../../src/ledger/endowment.js';
import { largestRemainder as levyLargestRemainder, LevyArithmeticError } from '../../src/levy/assessment.js';
import { LEVY_STARTER_ALLOTMENT } from '../../src/levy/params.js';
import { CHARGE_MISSES_TO_CONTEST, CHARGE_MISSES_TO_LAPSE } from '../../src/sovereignty/params.js';
import {
  readBool,
  readIntOrAbsent,
  readIntOrNull,
  readStringOrAbsent,
  readStringOrNull,
  SnapshotError,
} from '../../src/tick/snapshot.js';
import { ARREARS_STEPS, claimDoNothing } from '../../src/sovereignty/view.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function sourceFiles(dir: string): readonly string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(ROOT + rel)) {
      const next = `${rel}/${entry}`;
      if (statSync(ROOT + next).isDirectory()) walk(next);
      else if (entry.endsWith('.ts')) out.push(next);
    }
  };
  walk(dir);
  return out;
}

const ALL_SRC = sourceFiles('src');
const textOf = (rel: string): string => readFileSync(ROOT + rel, 'utf8');

/**
 * The file with every comment blanked, line numbering preserved.
 *
 * Load-bearing, and the first version of this file did not have it: three of these blocks quote the
 * expression they forbid in their own explanatory comment, so a scan over raw text flagged the fix as
 * the defect. A guard that trips on the prose describing it is worse than no guard — it teaches the
 * next reader to delete the guard.
 */
function codeOf(rel: string): string {
  return textOf(rel)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')) // block + JSDoc, newlines kept
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

/**
 * The lanes this audit actually cleaned in the ONE-HOME sweep.
 *
 * The bare-literal scan is scoped to these rather than to all of `src/`, and the exclusion is
 * **recorded rather than silent**: `combat/`, `api/`, `sim/`, `syndicate/` and `frames/` hold 22 more
 * bare `10_000`s and two more bare `288`s, listed in `OUT_OF_LANE_BARE_LITERALS` below so the next
 * agent inherits the list instead of rediscovering it. A scope that hid them would make this test the
 * thing it exists to forbid: a green report over a defect nobody can see.
 */
const CLEANED_LANES = [
  'src/core/',
  'src/ledger/',
  'src/world/',
  'src/venture/',
  'src/tick/',
  'src/works/',
  'src/sovereignty/',
  'src/predation/',
  'src/campaign/',
  'src/grant/',
  'src/levy/',
  'src/market/',
  'src/observe/',
  'src/persist/',
] as const;

const inCleanedLane = (rel: string): boolean => CLEANED_LANES.some((lane) => rel.startsWith(lane));

/** Known, deliberate debt outside the cleaned lanes. Shrink this list; never grow it. */
const OUT_OF_LANE_BARE_LITERALS = ['src/combat/', 'src/api/', 'src/sim/', 'src/syndicate/', 'src/frames/'] as const;

describe('the harness can see the source it claims to scan', () => {
  it('finds a realistic number of source files, so a later empty scan cannot pass silently', () => {
    // The guard on every other block in this file. An `ALL_SRC` of `[]` would make each `forEach`
    // below iterate nothing and report green over a codebase full of copies.
    expect(ALL_SRC.length).toBeGreaterThan(200);
    expect(ALL_SRC).toContain('src/core/allocate.ts');
    expect(ALL_SRC).toContain('src/tick/loop.ts');
  });
});

describe('one allocator: largest remainder lives in core/ and nowhere else', () => {
  it('is exact for every unit brand, so no caller needs to launder its type', () => {
    // The reason it moved. `world/lode.ts` had `largestRemainder((base * n) as never, w)`: `as never`
    // is assignable to every parameter, so it did not convert `number` to `Minor` — it switched off
    // argument checking on the call INV-W1's integer-ness rests on. Generic over `T extends number`
    // means the brand survives instead of being dropped and re-attached.
    const asMinor: readonly Minor[] = largestRemainder(minor(10), [1, 1, 1]);
    const asQty: readonly Qty[] = largestRemainder(qty(10), [1, 1, 1]);
    const asPlain: readonly number[] = largestRemainder(10, [1, 1, 1]);
    expect(asMinor).toEqual([4, 3, 3]);
    expect(asQty).toEqual([4, 3, 3]);
    expect(asPlain).toEqual([4, 3, 3]);

    // Σ exact is the property all three of INV-24, SOV-4 and INV-W1 assert over their own caller.
    for (const total of [0, 1, 7, 9_999, 1_000_003]) {
      const shares = largestRemainder(total, [3, 1, 1, 5]);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it('the Levy still throws LevyArithmeticError, so moving it changed no halt', () => {
    // The wrapper's whole justification. Four assertions in `test/levy/` name this class; a refactor
    // that changed which class a halt throws would be a behaviour change wearing a refactor's clothes.
    expect(() => levyLargestRemainder(minor(1), [])).toThrow(LevyArithmeticError);
    expect(() => levyLargestRemainder(minor(-1), [1])).toThrow(LevyArithmeticError);
    expect(() => levyLargestRemainder(minor(5), [0, 0])).toThrow(LevyArithmeticError);
    // And it is catchable as the general shape, which is what makes `core/` the owner.
    expect(() => levyLargestRemainder(minor(1), [])).toThrow(AllocationError);
  });

  it('no module outside core/ implements a largest-remainder or equal-split pass', () => {
    // MUTATION: restore `predation/predate.ts`'s private
    //   `const share = Math.floor(want / ordered.length); const remainder = want - share * n;`
    // and this must go red. That copy was provably identical for equal weights and asserted nothing —
    // no Σ check, no negative-total refusal, no 2^53 guard — on a path that moves seized goods.
    const SPLIT_SHAPES = [
      /Math\.floor\(\s*\w+\s*\/\s*\w+\.length\s*\)/, // floor(total / n)
      /remainder\s*=\s*\w+\s*-\s*\w+\s*\*\s*\w+\.length/, // total - share * n
      /<\s*remainder\s*\?\s*1\s*:\s*0/, // i < remainder ? 1 : 0
    ];
    expect(SPLIT_SHAPES.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const rel of ALL_SRC) {
      if (rel.startsWith('src/core/')) continue;
      const text = codeOf(rel);
      for (const shape of SPLIT_SHAPES) {
        if (shape.test(text)) offenders.push(`${rel} matches ${String(shape)}`);
      }
    }
    expect(
      offenders,
      'a second largest-remainder is scar #5 applied to an algorithm: the failure mode is a total ' +
        'off by one unit in one of the two mechanics, which is a fabricated debt (A5′) in whichever ' +
        'one drifted. Call `core/allocate.ts:largestRemainder`.',
    ).toEqual([]);
  });

  it('and no module reaches into levy/ for it, which was the layering inversion', () => {
    // MUTATION: re-add `import { largestRemainder } from '../levy/assessment.js';` to `world/lode.ts`
    // and this goes red. That import made `world` depend on `levy` while `levy` depends on `world`.
    const reaching = ALL_SRC.filter(
      (rel) => !rel.startsWith('src/levy/') && /largestRemainder\s*\}\s*from\s*'\.\.\/levy\//.test(codeOf(rel)),
    );
    expect(reaching).toEqual([]);
  });
});

describe('one reader family: params from core/, snapshots from tick/', () => {
  it('core/params.ts is strict about type while tolerant about spelling', () => {
    // Non-vacuity for the block below: the canonical readers must actually enforce something, or
    // forbidding copies of them protects nothing.
    expect(readInt({ qty: 3 }, ['qty'])).toBe(3);
    expect(readInt({ qty: '3' }, ['qty'])).toBeNull(); // a string is a refusal, never a coercion
    expect(readInt({ qty: 1.5 }, ['qty'])).toBeNull(); // DET: no float reaches a value path
    expect(readString({ venture_id: 'v1' }, ['venture', 'venture_id'])).toBe('v1');
    expect(readString({ venture: '' }, ['venture'])).toBeNull(); // empty is ABSENT, never ""
  });

  it('the strict and tolerant snapshot readers differ on a MISSING key, in that direction', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // The distinction the collapse had to preserve, and the one place getting it backwards would only
    // show up on a **production hydrate** — the worst possible place to find out.
    //
    // Before 38 the name `readStringOrNull` meant BOTH of these: `tick/snapshot.ts` threw on a missing
    // key, `levy/book.ts` and `sovereignty/book.ts` returned null. Collapsing them to the strict rule
    // would turn an older snapshot's absent field into a boot halt; collapsing to the tolerant rule
    // would let a genuinely corrupt row hydrate as `null` and lose data silently, which A5 forbids.
    // So both rules survive and only the ambiguity died: plain name = strict, `OrAbsent` = tolerant.
    //
    // MUTATION: swap the two bodies in `tick/snapshot.ts` and this block goes red on all four.
    // ══════════════════════════════════════════════════════════════════════════
    const present = { a: 'x', n: 7, nul: null } as const;

    // An explicit null is null for both families — never the difference.
    expect(readStringOrNull(present, 'nul', 'w')).toBeNull();
    expect(readStringOrAbsent(present, 'nul', 'w')).toBeNull();

    // A MISSING key is the whole difference.
    expect(() => readStringOrNull({}, 'gone', 'w'), 'strict must halt on an absent key').toThrow(SnapshotError);
    expect(() => readIntOrNull({}, 'gone', 'w'), 'strict must halt on an absent key').toThrow(SnapshotError);
    expect(readStringOrAbsent({}, 'gone', 'w'), 'tolerant must read absent as null').toBeNull();
    expect(readIntOrAbsent({}, 'gone', 'w'), 'tolerant must read absent as null').toBeNull();

    // Both stay strict about TYPE, which is what makes either safe to hydrate through.
    expect(() => readStringOrAbsent(present, 'n', 'w')).toThrow(SnapshotError);
    expect(() => readIntOrAbsent(present, 'a', 'w')).toThrow(SnapshotError);
    expect(readBool({ b: true }, 'b', 'w')).toBe(true);
    expect(() => readBool(present, 'a', 'w')).toThrow(SnapshotError);
  });

  it('no module declares a private copy of a canonical reader', () => {
    // MUTATION: re-add `function readInt(params, keys)` to `tick/loop.ts`, or `readParam` — which is
    // how the copy hid, since a grep for `readString` could not find it — and this goes red.
    //
    // Eight copies of the snapshot family existed across four books at 34, two of them re-using the
    // name `readStringOrNull` for a DIFFERENT rule about a missing key: the canonical one throws, the
    // copies returned null. On a hydrate that is a row silently losing a field where A5 forbids a
    // wrong record.
    const FORBIDDEN = [
      'readInt',
      'readString',
      'readList',
      'readParam',
      'readBool',
      'readObject',
      'readArray',
      'readIntOrNull',
      'readStringOrNull',
      'readIntOrNullAt',
      'readStringOrNullAt',
      'readIntOrAbsent',
      'readStringOrAbsent',
    ];
    const HOMES = new Set(['src/core/params.ts', 'src/tick/snapshot.ts']);
    expect(FORBIDDEN.length).toBeGreaterThan(0);

    // Non-vacuity: the pattern must match the canonical declarations themselves.
    const canonical = FORBIDDEN.filter((name) =>
      [...HOMES].some((home) => new RegExp(`^(?:export )?function ${name}\\b`, 'm').test(textOf(home))),
    );
    expect(canonical.length, 'the declaration pattern must match the real homes').toBeGreaterThan(2);

    const offenders: string[] = [];
    for (const rel of ALL_SRC) {
      if (HOMES.has(rel)) continue;
      const text = codeOf(rel);
      for (const name of FORBIDDEN) {
        if (new RegExp(`^(?:export )?function ${name}\\b`, 'm').test(text)) {
          offenders.push(`${rel} declares its own ${name}`);
        }
      }
    }
    expect(
      offenders,
      'one rule, two homes, free to disagree about what counts as a value. Import from ' +
        '`core/params.js` (agent params) or `tick/snapshot.js` (canonical snapshots).',
    ).toEqual([]);
  });
});

describe('one enrolment allotment, and the ledger does not depend on the Levy for it', () => {
  it('the Levy name and the ledger declaration are the same number', () => {
    expect(LEVY_STARTER_ALLOTMENT).toBe(STARTER_ALLOTMENT);
    expect(STARTER_ALLOTMENT).toBeGreaterThan(0);
  });

  it('src/ledger/ imports nothing from src/levy/', () => {
    // MUTATION: re-add `import { LEVY_STARTER_ALLOTMENT } from '../levy/params.js';` to
    // `ledger/endowment.ts` and this goes red.
    //
    // `test/core/goods-are-independent.test.ts` already forbids this for the four good *ids*, with the
    // reason spelled out: "the ledger — the lowest layer, where every value ultimately lands —
    // depended on the Levy, one of the highest." It stopped at the ids. The enrolment *quantity* kept
    // the import alive, and with it the `ledger -> levy -> ledger` cycle.
    const ledgerFiles = ALL_SRC.filter((rel) => rel.startsWith('src/ledger/'));
    expect(ledgerFiles.length).toBeGreaterThan(5);
    const offenders = ledgerFiles.filter((rel) => /from\s*'\.\.\/levy\//.test(codeOf(rel)));
    expect(offenders, 'the ledger is below the Levy and must not import from it').toEqual([]);
  });
});

describe('one CONTESTED threshold, derived from the lapse count', () => {
  it('the label and the threshold are the same number by construction', () => {
    expect(CHARGE_MISSES_TO_CONTEST).toBe(CHARGE_MISSES_TO_LAPSE - 1);
    expect(ARREARS_STEPS).toBe(CHARGE_MISSES_TO_CONTEST);
  });

  it('claimDoNothing turns contestable exactly at the derived count, not at a literal 2', () => {
    // Derived, so this tracks `CHARGE_MISSES_TO_LAPSE` instead of pinning today's 3.
    const owed = qty(1);
    expect(claimDoNothing(owed, CHARGE_MISSES_TO_CONTEST - 1)).toBe('BECOMES_CONTESTABLE');
    expect(claimDoNothing(owed, CHARGE_MISSES_TO_LAPSE - 1)).toBe('LAPSES');
    expect(claimDoNothing(qty(0), CHARGE_MISSES_TO_LAPSE)).toBe('STAYS_SUPPLIED');
  });

  it('no sovereignty module gates the CONTESTED state on a bare 2', () => {
    // MUTATION: restore `} else if (misses >= 2) {` in `settle.ts` and this goes red. With
    // `CHARGE_MISSES_TO_LAPSE` at 4 that literal opened the vulnerability window a full Reckoning
    // before the legend said the claim was takeable — the engine and the published clock disagreeing
    // about when territory can be taken.
    const BARE = [/misses\s*>=\s*2\b/, /next\s*>=\s*2\b/, /missesAt\([^)]*\)\s*>=\s*2\b/];
    expect(BARE.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const rel of ALL_SRC.filter((r) => r.startsWith('src/sovereignty/'))) {
      const text = codeOf(rel);
      for (const shape of BARE) if (shape.test(text)) offenders.push(`${rel} matches ${String(shape)}`);
    }
    expect(offenders, 'use CHARGE_MISSES_TO_CONTEST').toEqual([]);
  });
});

describe('one cycle length and one bps scale', () => {
  it('no module re-derives WINDOW_FIRST_PHASE from literals', () => {
    // MUTATION: restore `TICKS_PER_RECKONING - 1 - 1 - 24` in `predation/params.ts` and this goes red.
    // That expression was a hand-inlined `WINDOW_FIRST_PHASE` whose `24` read as either
    // `COMMITMENT_WINDOW_TICKS` or `DEMAND_WINDOW_TICKS` — both 24, both used in that file — guarding
    // the assertion that stops a raid resolving inside §5.1's hard freeze.
    expect(WINDOW_FIRST_PHASE).toBeLessThan(TICKS_PER_RECKONING);
    const offenders = ALL_SRC.filter((rel) =>
      /TICKS_PER_RECKONING\s*-\s*1\s*-\s*1\s*-\s*\d+/.test(codeOf(rel)),
    );
    expect(offenders, 'import WINDOW_FIRST_PHASE from core/time.js').toEqual([]);
  });

  it('no module writes the cycle length or the bps scale as a bare literal in code', () => {
    // MUTATION: restore `((next % 288) + 288) % 288` in `campaign/invariants.ts` — a hand-inlined
    // `phaseOfReckoning` with the constant written three times, inside the A14 halt for "a scheduled
    // decision at an unpublished tick" — and this goes red.
    //
    // Comments and prose are exempt: those are documentation debt, reported separately. This scans
    // code lines only, which is why the line filter below is part of the assertion.
    expect(TICKS_PER_RECKONING).toBe(288);
    expect(BPS_ONE).toBe(10_000);
    const offenders: string[] = [];
    for (const rel of ALL_SRC) {
      if (rel === 'src/core/time.ts' || rel === 'src/core/units.ts') continue;
      if (!inCleanedLane(rel)) continue;
      codeOf(rel)
        .split('\n')
        .forEach((code, i) => {
          if (/[^_\w]288\b/.test(code) && !/288_/.test(code)) offenders.push(`${rel}:${String(i + 1)} bare 288`);
          if (/\/\s*10_000\b/.test(code) || /\*\s*10_000\b/.test(code)) {
            offenders.push(`${rel}:${String(i + 1)} bare 10_000 as a bps scale`);
          }
        });
    }
    expect(
      offenders,
      'the cycle length is a runtime setting (`setSpeed`) and the bps scale is `BPS_ONE`; a literal ' +
        'publishes a confidently wrong number on any world not running the default clock',
    ).toEqual([]);
  });
});

describe('the debt outside the cleaned lanes is counted, not hidden', () => {
  it('records how many bare cycle-length and bps literals remain, and refuses to let it grow', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // The instrument for the part of the sweep that did not happen. The ONE-HOME sweep cleaned the
    // fourteen lanes in `CLEANED_LANES`; `combat/`, `api/`, `sim/`, `syndicate/` and `frames/` were
    // other agents' live files that round and were left alone.
    //
    // Left alone is fine. Left **uncounted** is the defect this repo has shipped six times: nothing
    // could tell "nobody uses this" from "this does not exist" because no column printed it. So the
    // remainder is a number here, and it is a ceiling rather than a target.
    // ══════════════════════════════════════════════════════════════════════════
    const remaining: string[] = [];
    for (const rel of ALL_SRC) {
      if (inCleanedLane(rel)) continue;
      if (!OUT_OF_LANE_BARE_LITERALS.some((lane) => rel.startsWith(lane))) continue;
      codeOf(rel)
        .split('\n')
        .forEach((code, i) => {
          if (/[^_\w]288\b/.test(code) && !/288_/.test(code)) remaining.push(`${rel}:${String(i + 1)} 288`);
          if (/\/\s*10_000\b/.test(code) || /\*\s*10_000\b/.test(code)) {
            remaining.push(`${rel}:${String(i + 1)} 10_000`);
          }
        });
    }
    // Non-vacuity first, and it is the whole point: if this ever reads 0 the scan has broken, because
    // the same regexes found 24 of these one commit ago. A silent 0 here would retire the ledger.
    expect(remaining.length, 'the scan must still be able to see the known debt').toBeGreaterThan(0);
    expect(
      remaining.length,
      `bare cycle-length/bps literals outside the cleaned lanes: ${String(remaining.length)}.\n` +
        `${remaining.join('\n')}\n\n` +
        'This is a CEILING. Collapsing any of these to `TICKS_PER_RECKONING` / `BPS_ONE` and lowering ' +
        'the number is the intended edit; raising it means a new copy was written.',
    ).toBeLessThanOrEqual(24);
  });
});

describe('one BID escrow', () => {
  it('nothing multiplies a limit price by a quantity outside the checked helper', () => {
    // MUTATION: restore `minor(order.limitPrice * remainingOf(order))` in `market/observe.ts` and this
    // goes red. Six homes existed for this one quantity; that one skipped `multiplyPrice`'s
    // safe-integer check and was the one publishing the number to agents.
    const offenders: string[] = [];
    for (const rel of ALL_SRC) {
      if (rel === 'src/market/order.ts') continue;
      const text = codeOf(rel);
      if (/limitPrice\s*\*/.test(text) || /\*\s*remainingOf\(/.test(text)) offenders.push(rel);
    }
    expect(offenders, 'use `multiplyPrice`, `cashRequired` or `escrowFor` from market/order.js').toEqual([]);
  });
});
