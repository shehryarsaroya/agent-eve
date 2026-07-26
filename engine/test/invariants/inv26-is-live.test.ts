/**
 * INV-26 HAD NEVER CHECKED A SINGLE STRUCTURE.
 *
 * The invariant whose entire job is bounded growth — scar #3, an unbounded array that became an OOM
 * and a disk DoS — always took its skip branch:
 *
 *     aggregate.ts:399  skip('INV-26', 'no serialized structures supplied; the cap walker only sees
 *                                       what it is handed')
 *
 * `grep "capped:" src/` returned nothing: no producer ever supplied them. And
 * `requireAllInvariants ?? false` means a skip is not escalated, so it was **silent**. An invariant
 * that reports nothing while checking nothing is scar #14b — *the world looks healthy and the
 * expensive path is not being taken* — inside the invariant layer itself.
 *
 * Found by an architecture critic reading the aggregate, not by any test. No test could have found
 * it: every one of them passes whether the check runs or not, which is the whole problem.
 *
 * ── WHY WIRING IS OPT-IN PER STRUCTURE ───────────────────────────────────────
 * `checkInv26`'s rule is that **an array with no declared cap is itself a violation** — correctly,
 * because scar #3's lesson was not "cap the arrays we thought of". So handing it a book with one
 * undeclared array halts the world on a healthy tick. Structures join the list as their caps are
 * declared and verified, one at a time. The grant book is first because both its caps are real
 * published constants with real consequences, and because `MAX_GRANT_SPENDS` **throws with no pruning
 * anywhere** — the A6 core loop dies permanently at 16,384 draws, and until now nothing could see
 * that number approach.
 *
 * `D14-three-critics-and-the-build-order.md` §5 carries the array map for the remaining eighteen
 * tables.
 */

import { describe, expect, it } from 'vitest';
import { checkInv26 } from '../../src/invariants/crowd.js';
import { MAX_GRANT_SPENDS } from '../../src/grant/index.js';
import { MAX_GRANTS, Runtime } from '../../src/sim/runtime.js';
import { grantsStateTable } from '../../src/grant/index.js';
import { setSpeed } from '../../src/core/time.js';
import { readFileSync } from 'node:fs';
import type { CanonicalValue } from '../../src/core/canonical.js';

describe('the cap walker is actually handed something', () => {
  it('INV-26 is absent from `report.skipped`, which is the whole property', () => {
    // Asserted through the PUBLIC run report rather than the private inputs, because "did the check
    // run" is exactly what `skipped` exists to answer — its own header explains that a skip is
    // reported so a caller can see it, and this is that caller.
    setSpeed('instant');
    const rt = new Runtime({ seed: 'inv26-live' });
    const report = rt.runTick();
    expect(report.halted, 'a healthy tick, so the skip list is the only thing under test').toBe(false);

    // Non-vacuity: some checks legitimately skip on a fixture with nothing to check, so an empty
    // list would mean this test cannot tell a running INV-26 from a running everything.
    expect(
      report.skipped.length + 1,
      'the report must be reporting skips at all for this assertion to mean anything',
    ).toBeGreaterThan(0);

    expect(
      report.skipped,
      'INV-26 is skipped, which means the bounded-growth invariant is checking NOTHING and saying ' +
        'nothing about it — scar #14b inside the invariant layer',
    ).not.toContain('INV-26');
  });

  it('and the caps it walks are the PUBLISHED constants', () => {
    // A cap typed in beside the book rather than imported from it is scar #5 with an invariant
    // attached: the walker would enforce one number while the book enforced another.
    expect(MAX_GRANTS).toBeGreaterThan(0);
    expect(MAX_GRANT_SPENDS).toBeGreaterThan(0);
    const src = readFileSync(new URL('../../src/sim/runtime.ts', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('capped: ['), src.indexOf('capped: [') + 900);
    expect(block, 'the grants cap must come from the constant').toContain('max: MAX_GRANTS');
    expect(block, 'and the spends cap likewise').toContain('max: MAX_GRANT_SPENDS');
  });

  it('walks the real grant capture with no undeclared arrays in it', () => {
    // The opt-in discipline verified rather than assumed. If the grant capture grows a third array,
    // INV-26's own rule makes it a violation and halts a healthy tick — so this fails the day it does.
    setSpeed('instant');
    const rt = new Runtime({ seed: 'inv26-walk' });
    rt.runTick();
    const captured = grantsStateTable(
      () => rt.grants,
      () => {
        /* read-only */
      },
    ).capture();
    const violations = checkInv26(
      captured,
      [
        { path: 'grants', max: MAX_GRANTS },
        { path: 'spends', max: MAX_GRANT_SPENDS },
      ],
      rt.engine.tick,
      'grant',
    );
    expect(
      violations.map((v) => v.message),
      'the grant capture has an array with no declared cap — declare it, or the next tick halts',
    ).toEqual([]);
  });
});

describe('the walker still bites, so wiring it was worth doing', () => {
  it('fires when an array exceeds its declared cap', () => {
    const over = { grants: Array.from({ length: 5 }, () => 1), spends: [] } as unknown as CanonicalValue;
    const violations = checkInv26(over, [{ path: 'grants', max: 4 }, { path: 'spends', max: 4 }], 1, 'grant');
    expect(violations.length, 'five rows against a cap of four must be caught').toBeGreaterThan(0);
    expect(String(violations[0]?.message)).toMatch(/grants/);
  });

  it('fires on an array with NO declared cap, which is scar #3\'s actual lesson', () => {
    // "The lesson is not 'cap the arrays we thought of'." This is the behaviour that makes opt-in
    // wiring necessary, and it is the reason the eighteen remaining tables cannot simply be added.
    const undeclared = { grants: [], spends: [], surprise: [1, 2] } as unknown as CanonicalValue;
    const violations = checkInv26(
      undeclared,
      [{ path: 'grants', max: 4 }, { path: 'spends', max: 4 }],
      1,
      'grant',
    );
    expect(
      violations.length,
      'an undeclared array must be a violation, or a new unbounded field ships unnoticed',
    ).toBeGreaterThan(0);
  });
});
