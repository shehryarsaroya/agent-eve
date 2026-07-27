/**
 * INV-22 REPORTS GREEN AND CHECKS NOTHING, BECAUSE NO VERB CAN SPEND A GRANT.
 *
 * A6 is the core loop: *an agent earns trust, is granted authority it could abuse, and abuses it at
 * the moment of maximum leverage.* This file is the tripwire on the part that has never happened.
 *
 * What IS built: `grant` is a canon verb, the `GrantBook` is a restorable state table, grants
 * serialise as W3C Verifiable Credentials, INV-22 and INV-23 audit them, `revoke` works, the cast now
 * issues them (`grant=27` per 900 ticks) and they render (`authorityLines=12`). **And two verbs accept
 * a mandate** — `create` (always did) and `elect` (added 2026-07-26).
 *
 * ⚑ **AN EARLIER VERSION OF THIS HEADER WAS WRONG, AND THE ERROR IS WORTH KEEPING.** It said "no verb
 * can spend a grant" and "`grantBook.spend()` is never called outside `src/grant/book.ts`" — both from
 * a grep for `grantBook.spend` and `.spend(`. **The method is `recordSpend`, and the grep missed it.**
 * `create` has supported delegated action all along: `on_behalf_of` names the principal,
 * `liveGrantBetween` infers the mandate, both LIMITS are checked, and the draw is recorded with a
 * careful note about ordering it before the transfer (AGT-X9). A negative claim resting on one grep
 * spelling is exactly as strong as the spelling, and this one was a name away from the truth.
 *
 * `elect` now takes a mandate too, on the same inferred pattern (`test/grant/a-delegate-can-spend`).
 *
 * ── WHAT IS ACTUALLY TRUE, WHICH IS NARROWER AND STILL A GAP ─────────────────
 *
 * The capability exists on two verbs and **no cast ever uses it.** The heuristic cast passes
 * `on_behalf_of` on nothing, the LLM prompt never mentions acting for another principal, so no world
 * this project runs has ever produced a single draw. Which leaves the same practical consequence by a
 * different route: every grant is `UNUSED`/`spent: 0`, INV-22 audits an always-empty journal, and the
 * betrayal §16 asks for has never had a chance to happen.
 *
 * That is a cast gap rather than an engine gap, and it is cheaper to close — a branch that elects or
 * creates under a held mandate, not an authorisation path.
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

describe('INV-22 has nothing to check, because no cast ever uses a mandate it holds', () => {
  it('a world that ISSUES grants produces ZERO draws against them', () => {
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
      `${String(spends.length)} grant draw(s) exist — which means a cast finally USES a mandate it ` +
        `holds, and A6 can complete end to end. That is good news, and this test is now backwards: ` +
        `invert it to assert draws occur, add a case where INV-22 rejects one that exceeds its ` +
        `limit, and delete this file's premise.`,
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
