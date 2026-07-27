/**
 * INV-22 REPORTS GREEN AND CHECKS NOTHING, BECAUSE NO VERB CAN SPEND A GRANT.
 *
 * A6 is the core loop: *an agent earns trust, is granted authority it could abuse, and abuses it at
 * the moment of maximum leverage.* As of 2026-07-26 the first third of that exists and the rest does
 * not, and this file is the tripwire that says so out loud.
 *
 * What IS built: `grant` is a canon verb, the `GrantBook` is a restorable state table, grants
 * serialise as W3C Verifiable Credentials, INV-22 and INV-23 audit them, `revoke` works, the cast now
 * issues them (`grant=27` per 900 ticks) and they render (`authorityLines=12`).
 *
 * What is NOT built — and the greps are the evidence, not an opinion:
 *
 *   - `grantBook.spend()` is **never called from anywhere outside `src/grant/book.ts`.**
 *   - **No verb accepts a grant to act under.** The only verb taking a `grant` param is `revoke`.
 *   - `onBehalfOfPrincipalId` is written `null` at every venture/seal/audit site. The non-null uses in
 *     `runtime.ts` are sovereignty and claim attribution, not grant delegation.
 *
 * So a delegate cannot use delegated authority. Every grant the world issues is `UNUSED`, `spent: 0`,
 * forever — which means **betrayal via legitimate authority is currently impossible**, and §16's
 * acceptance criterion ("≥1 authority-betrayal occurs unprompted, and its replay shows the grant, the
 * accepted warning, the seal, and the deed") cannot be met by construction rather than by chance.
 *
 * ── WHY THIS IS A TEST AND NOT A TODO ────────────────────────────────────────
 *
 * `assert_invariants` distinguishes CHECKED from SKIPPED, and `aggregate.ts` skips INV-22's
 * concurrency clause when `grantSpends` is **undefined**. But `Runtime` supplies it —
 * `grantSpends: this.grantBook.allSpends()` — so the journal is *supplied and empty*, the clause runs
 * over nothing, and the invariant reports CHECKED. Supplied is not the same as non-empty, and the
 * report cannot tell them apart.
 *
 * That is the unfalsifiable-witness defect class this project keeps finding: a guard whose subject
 * cannot occur, passing forever, indistinguishable in every report from a guard that is genuinely
 * holding. INV-23 had the same shape until `hasDelegationParentage` made its transitive walk
 * explicitly inert until chains exist. This does the same for INV-22.
 *
 * **The day this test fails is the day the core loop closed.** Invert it then: assert spends exist,
 * assert INV-22 rejects an over-limit one, and delete this file's premise. A failure here is good news
 * and the message says so.
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed } from '../../src/core/time.js';
import { Runtime } from '../../src/sim/runtime.js';

describe('INV-22 has nothing to check, and that is a gap in A6 rather than in the invariant', () => {
  it('a world that ISSUES grants produces ZERO spends against them', () => {
    setSpeed('instant');
    const seed = 'inv22-vacuous';
    const rt = new Runtime({ seed });
    const cast = new HeuristicCast(rt, { size: 8 });
    cast.seat(seed);

    let grantsIssued = 0;
    for (let i = 0; i < 900; i += 1) {
      for (const a of cast.decide(rt.engine.tick + 1, seed)) {
        if (a.verb === 'grant') grantsIssued += 1;
        rt.engine.submit(a);
      }
      if (rt.runTick().halted) break;
    }

    // The premise: authority really is being handed out, so "no spends" cannot be explained by "no
    // grants". Without this the test below would pass on an empty world and prove nothing.
    expect(grantsIssued, 'no grants were issued, so this test proves nothing about spending').toBeGreaterThan(0);

    const spends = rt.grants.allSpends();
    expect(
      spends.length,
      `${String(spends.length)} grant spend(s) exist — which means a delegate can now ACT on ` +
        `delegated authority and A6's second link has landed. That is good news, and this test is ` +
        `now backwards: invert it to assert spends occur, add a case where INV-22 rejects one that ` +
        `exceeds its limit, and delete this file's premise.`,
    ).toBe(0);
  }, 180_000);

  it('and INV-22 still reports CHECKED over that empty journal, which is the misleading part', () => {
    // The half that makes this a real problem rather than a curiosity. If the report said SKIPPED,
    // nobody would mistake it for coverage. It says CHECKED, because `aggregate.ts` only skips when
    // the journal is `undefined` and `Runtime` always supplies one.
    setSpeed('instant');
    const seed = 'inv22-reports-checked';
    const rt = new Runtime({ seed });
    const cast = new HeuristicCast(rt, { size: 6 });
    cast.seat(seed);
    for (let i = 0; i < 120; i += 1) {
      for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
      if (rt.runTick().halted) break;
    }

    const report = rt.runTick();
    expect(report.violations, 'the world must be healthy, or the reading below is confounded').toEqual([]);
    // `TickReport.skipped` is the honesty clause: "invariants that did not run because their inputs
    // were absent. Read this." INV-22 is NOT in it — its input (the spend journal) is present, just
    // empty — so every report this world has ever published counts INV-22 as having run. Supplied is
    // not non-empty, and nothing downstream can tell the difference.
    expect(
      report.skipped,
      'INV-22 appears as SKIPPED, so the vacuity is already visible and this test is redundant',
    ).not.toContain('INV-22');
  }, 180_000);
});
