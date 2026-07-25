/**
 * `E2E-14` — the valuation moved between agreement and settlement.
 *
 * > `E2E-14` Valuation moves sharply between agreement and settlement; `terms_hash` pinned
 * > the rule *and* its as-of tick; the settlement matches what the parties agreed, not the
 * > new price. — TESTING.md §6
 *
 * ## How the engine actually protects this, and what is therefore worth asserting
 *
 * There is no live price anywhere in the settlement path. `computeClaims` is a function of
 * `(venture, proceeds)` and nothing else, and `proceeds` is **pinned by the caller into
 * the frozen settlement set** before anything settles. So "the settlement matches what the
 * parties agreed" is structural, not incidental — and the failure mode that remains is the
 * other one: somebody **re-pins** the valuation on the row after the countersignature, so
 * that the terms the settlement reads are not the terms anybody signed.
 *
 * That is what `terms_hash` is for, and it is why §15.4's third defence is stated as
 * "`terms_hash` includes the valuation rule *and* its as-of tick". Both halves are asserted
 * separately below, because a hash that covered only the rule would let a repricing pass as
 * "the same rule, read later" — which is precisely the sharp move E2E-14 describes.
 */

import { describe, expect, it } from 'vitest';
import { minor } from '../../src/core/units.js';
import { DEFAULT_VALUATION_RULE } from '../../src/ledger/index.js';
import { computeClaims, pinnedAt, termsHash, termsHashOf, type Election } from '../../src/venture/index.js';
import {
  ALICE,
  BRAM,
  FORM_TICK,
  RULES_VERSION,
  fixture,
  freeze,
  goLive,
  makeHaul,
  planFor,
  run,
} from './fixture.js';

const PROCEEDS = minor(12_000);

function slice() {
  const f = fixture();
  const haul = makeHaul(f);
  goLive(f, haul, [ALICE, BRAM], PROCEEDS);
  const elections = new Map<number, Election>();
  for (const r of computeClaims(haul, PROCEEDS).roles) {
    if (r.electiveDue > 0) elections.set(r.roleIndex, r.electiveDue);
  }
  return { f, haul, elections };
}

describe('E2E-14 — terms_hash pins the valuation rule AND its as-of tick', () => {
  it('the as-of tick is inside the hash, so the same rule read later is a different pin', () => {
    const { haul } = slice();
    const before = termsHashOf(haul);
    const shape = {
      venture: haul.id,
      kind: haul.kind,
      creator: haul.creator,
      stage: haul.stage,
      roles: haul.roles.map((r) => ({ index: r.index, label: r.label, terms: r.terms })),
      windowOpensTick: haul.windowOpensTick,
      windowClosesTick: haul.windowClosesTick,
      resolvesAtTick: haul.resolvesAtTick,
      rulesVersion: RULES_VERSION,
    } as const;

    // Same rule, later as-of tick. If only the rule were hashed these would collide, and a
    // repricing would settle as "what the parties agreed".
    const sameRuleLaterTick = termsHash({
      ...shape,
      valuation: pinnedAt(DEFAULT_VALUATION_RULE, FORM_TICK + 50),
    });
    expect(sameRuleLaterTick).not.toBe(before);
    expect(termsHash({ ...shape, valuation: haul.valuation })).toBe(before);
  });

  it('a valuation re-pinned after the freeze halts the Reckoning rather than settling', () => {
    const { f, haul, elections } = slice();
    const frozen = freeze(f, [planFor(haul, { proceeds: PROCEEDS, elections })]);

    // The sharp move: the row is edited so the valuation is "as of" a later, better tick.
    const rewritten = { ...haul.valuation, asOfTick: FORM_TICK + 50 };
    Object.assign(haul, { valuation: rewritten });

    const outcome = run(f, frozen);

    expect(outcome.transaction.committed).toBe(false);
    expect(outcome.transaction.failedAt).toBe('VERIFY_INPUTS');
    // Nothing settled, so nothing was paid on the new price and nothing was recorded
    // against anybody for the difference.
    expect(outcome.transaction.applied).toEqual([]);
    expect(outcome.defaults).toEqual([]);
    expect(f.register.size).toBe(0);

    const reason = outcome.transaction.haltRecord?.reason ?? '';
    expect(reason).toContain('terms_hash');
    expect(reason).toContain('the settlement must match what the parties agreed');
  });

  it('a role s terms rewritten after the freeze halts too — the whole compact is pinned, not just the price', () => {
    const { f, haul, elections } = slice();
    const frozen = freeze(f, [planFor(haul, { proceeds: PROCEEDS, elections })]);

    const escort = haul.roles[1];
    if (escort === undefined) throw new Error('fixture');
    // A creator quietly shrinking the elective half it is about to owe.
    Object.assign(escort, { terms: { ...escort.terms, elective: minor(1) } });

    const outcome = run(f, frozen);
    expect(outcome.transaction.committed).toBe(false);
    expect(outcome.transaction.failedAt).toBe('VERIFY_INPUTS');
    expect(f.standing.row(ALICE).electiveHonoured).toBe(0);
  });

  it('with nothing rewritten, the settlement divides the pinned proceeds and commits', () => {
    const { f, haul, elections } = slice();
    const pinnedTerms = termsHashOf(haul);
    const claims = computeClaims(haul, PROCEEDS);
    const outcome = run(f, freeze(f, [planFor(haul, { proceeds: PROCEEDS, elections })]));

    expect(outcome.transaction.committed).toBe(true);
    // The pin survives the settlement: nothing in the waterfall rewrites the terms it was
    // computed from, so the row still hashes to what was countersigned.
    expect(termsHashOf(haul)).toBe(pinnedTerms);
    expect(haul.valuation.asOfTick).toBe(FORM_TICK);

    const settlement = outcome.settlements[0];
    expect(settlement?.claims.proceeds).toBe(PROCEEDS);
    // Every payout is the claim the pinned proceeds imply — the arithmetic the parties
    // could have run themselves before signing (A2).
    for (const [i, payout] of (settlement?.payouts ?? []).entries()) {
      expect(payout.claim).toBe(claims.roles[i]?.claim);
    }
  });
});
