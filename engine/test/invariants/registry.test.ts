/**
 * The registry's own guard — is the account of what is checked *honest*?
 *
 * This file exists because the registry is the most dangerous artifact in the module.
 * A list of 26 invariants with 26 ticks next to it reads as a guarantee, and the whole
 * value of the list is that it can be trusted when it says something is *not* covered.
 * So every column is checked against reality:
 *
 *   - all 26 ids, exactly once, no gaps and no extras;
 *   - `checkedIn` names a file that exists and a symbol that is exported from it;
 *   - a non-`FULL` row states its gap, and a `FULL` row does not pretend to have one;
 *   - the severity order puts INV-17 at the top of the register and `TICK-TORN` above it;
 *   - the aggregate can reach every id — no invariant is in the register and out of the
 *     pass;
 *   - the cause table the standing check borrows from `seal/standing.ts` still has all
 *     four causes, so a change there cannot silently widen or narrow INV-21.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { INVARIANTS, TOP_SEVERITY_ID, halting, rankViolations, severityRank, warn } from '../../src/invariants/registry.js';
import {
  ALL_INVARIANT_IDS,
  STANDING_CAUSES,
  assertCauseTableIntact,
  checkInvariants,
  halt,
  invariant,
} from '../../src/invariants/index.js';

const ENGINE = new URL('../../', import.meta.url).pathname;

describe('the register covers exactly INV-1 .. INV-26', () => {
  it('has 26 entries, in id order, with no gaps and no duplicates', () => {
    expect(INVARIANTS).toHaveLength(26);
    const numbers = INVARIANTS.map((e) => Number.parseInt(e.id.replace('INV-', ''), 10));
    expect(numbers).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
    expect(new Set(INVARIANTS.map((e) => e.id)).size).toBe(26);
  });

  it('every entry states a non-trivial claim', () => {
    for (const e of INVARIANTS) {
      expect(e.statement.length, `${e.id} has no statement`).toBeGreaterThan(20);
      expect(e.group.length).toBeGreaterThan(0);
    }
  });

  it('ALL_INVARIANT_IDS matches the register', () => {
    expect([...ALL_INVARIANT_IDS]).toEqual(INVARIANTS.map((e) => e.id));
  });
});

describe('the coverage columns are true', () => {
  it('every checkedIn path names a file that exists and a symbol it exports', () => {
    for (const e of INVARIANTS) {
      if (e.checkedIn === null) {
        // Legitimate, and it must stay expressible: a registry that cannot say
        // "nothing checks this" lies by omission.
        expect(e.coverage).toBe('ABSENT');
        continue;
      }
      // A row may name more than one implementation (INV-21 has two halves).
      for (const claim of e.checkedIn.split('+').map((s) => s.trim())) {
        const [path, symbol] = claim.split(':');
        expect(path, `${e.id} names no file`).toBeDefined();
        if (path === undefined) continue;
        const full = `${ENGINE}${path}`;
        expect(existsSync(full), `${e.id} names ${path}, which does not exist`).toBe(true);
        if (symbol === undefined) continue;
        const bare = symbol.replace(/\s*\(.*\)$/, '').trim();
        const source = readFileSync(full, 'utf8');
        expect(
          source.includes(`export function ${bare}`) || source.includes(`export { ${bare}`),
          `${e.id} names ${path}:${bare}, which that file does not export`,
        ).toBe(true);
      }
    }
  });

  it('a non-FULL row states its gap, and a FULL row makes no excuse', () => {
    for (const e of INVARIANTS) {
      if (e.coverage === 'FULL') {
        expect(e.gap, `${e.id} is FULL but states a gap`).toBe('');
      } else {
        // An unstated gap is the flattering version of an honest one.
        expect(e.gap.length, `${e.id} is ${e.coverage} with no stated gap`).toBeGreaterThan(40);
      }
    }
  });

  it('a row with no producer is never claimed as FULL', () => {
    // The distinction the whole registry turns on: a complete check over state
    // nothing writes is an unexercised check, not a passing one.
    for (const e of INVARIANTS) {
      if (e.producedIn === null) {
        expect(e.coverage, `${e.id} claims FULL with no producer`).not.toBe('FULL');
      }
    }
  });

  it('reports which invariants no module produces state for — the list that matters', () => {
    const unproduced = INVARIANTS.filter((e) => e.producedIn === null).map((e) => e.id);
    // Pinned so that wiring one is a visible diff rather than an invisible drift.
    // ★ INV-22 CAME OFF THIS LIST at `RULES_VERSION` 23, and the removal is the point of the pin.
    //
    // Its `producedIn` was `null` — *"no office/grant module writes these yet"* — which stopped
    // being true the day `grant/book.ts` started writing the spend journal, and stayed `null`
    // anyway. It now names `src/grant/book.ts + src/grant/dossier.ts`, the two modules whose rows
    // the invariant reads. INV-23 stays `null` honestly: nothing writes the signed-deal journal
    // its counterparty clause needs.
    expect(unproduced).toEqual([
      'INV-6',
      'INV-18',
      'INV-19',
      'INV-23',
      'INV-24',
      'INV-25',
      'INV-26',
    ]);
  });
});

describe('the severity order', () => {
  it('INV-17 is the top of the register, alone', () => {
    expect(TOP_SEVERITY_ID).toBe('INV-17');
    expect(severityRank('INV-17')).toBe(0);
    for (const e of INVARIANTS) {
      if (e.id === 'INV-17') continue;
      expect(severityRank(e.id), `${e.id} ties or beats INV-17`).toBeGreaterThan(0);
    }
  });

  it('a torn commit outranks even INV-17, because it unbalances every promise', () => {
    expect(severityRank('TICK-TORN')).toBeLessThan(severityRank('INV-17'));
  });

  it('an unknown id sorts last rather than crashing the report', () => {
    expect(severityRank('WHAT-EVEN-IS-THIS')).toBe(99);
  });

  it('rankViolations is deterministic to the last field', () => {
    const violations = [
      halt('INV-24', 5, 'levy'),
      halt('INV-17', 5, 'b default'),
      halt('INV-17', 5, 'a default'),
      halt('INV-2', 5, 'supply'),
    ];
    const once = rankViolations(violations);
    const twice = rankViolations([...violations].reverse());
    expect(once.map((v) => v.message)).toEqual(twice.map((v) => v.message));
    expect(once[0]?.id).toBe('INV-17');
    // Ties inside an id break on the message, so the published list is byte-stable.
    expect(once[0]?.message).toBe('a default');
  });

  it('halting keeps HALTs and drops WARNs', () => {
    const mixed = [halt('INV-2', 1, 'stop'), warn('INV-2', 1, 'note')];
    expect(halting(mixed)).toHaveLength(1);
    expect(halting(mixed)[0]?.severity).toBe('HALT');
  });

  it('invariant() finds an entry and returns undefined for a stranger', () => {
    expect(invariant('INV-17')?.group).toBe('PROMISES');
    expect(invariant('INV-27')).toBeUndefined();
  });
});

describe('the aggregate can reach every id in the register', () => {
  it('every id is either checked or explicitly skipped — none is silently absent', () => {
    // The failure this catches: an invariant listed in the register that the pass
    // never mentions, which reads as covered in the registry and is covered nowhere.
    const report = checkInvariants({}, 1);
    const mentioned = new Set([...report.checked, ...report.skipped.map((s) => s.id)]);
    const missing = ALL_INVARIANT_IDS.filter((id) => !mentioned.has(id));
    expect(missing).toEqual([]);
  });

  it('with nothing supplied, every id is skipped with a reason', () => {
    const report = checkInvariants({}, 1);
    expect(report.checked).toEqual([]);
    expect(new Set(report.skipped.map((s) => s.id)).size).toBe(26);
    for (const s of report.skipped) {
      expect(s.reason.length, `${s.id} was skipped with no reason`).toBeGreaterThan(10);
    }
  });
});

describe("INV-21's cause table still has one home and four causes", () => {
  it('the imported table covers all four causes and no fifth', () => {
    // Borrowed from `src/seal/standing.ts`, so a change there could silently widen or
    // narrow what a cause may move. A widened table is a false pass; a narrowed one is
    // a false halt, which SPEC §15.4 puts in the same class as a false default.
    expect(() => {
      assertCauseTableIntact();
    }).not.toThrow();
    expect([...STANDING_CAUSES].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([
      'CONTRADICTED_SEAL',
      'DECAY',
      'DEFAULT',
      'ELECTIVE_HONOURED',
    ]);
  });
});
