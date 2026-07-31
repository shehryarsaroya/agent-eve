/**
 * **`parleys_per_reckoning` IS NOW A FIGURE FOR THE RECKONING, AND IT WAS A FIGURE FOR THE INSTANT.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Measured by a player driving a real signed identity: `earned_minor` fell **1,629 → 0** and
 * `parleys_per_reckoning` fell **3 → 0** *between two reads*, because the principal escrowed 12,000
 * into a venture in between. Both sends after it were refused under A15.
 *
 * Nothing was wrong with the price. `freeCash` is `max(0, freeBalance − endowmentRemaining)` and
 * `vCreate` moves an escrow out of `stores` with a real `transferCurrency`, so an ordinary, legal,
 * entirely intended act revoked the right to speak — mid-Reckoning, unannounced, from a field whose
 * own name promised it would not. The **evaluation** was wrong: a balance was being read where a
 * per-Reckoning entitlement was published.
 *
 * ## What this file has to prove, in this order
 *
 *   1. **The subject exists.** A spend really does drive `freeCash` to zero, or every assertion
 *      below is green about a scenario that never happens. This is the one that has been skipped
 *      twice in this repo, and both guards were vacuous on first writing.
 *   2. **The entitlement survives it** — the actual fix.
 *   3. **The price survives the fix** — a free identity still reads reach 0, allowance 0, and is
 *      still refused by hand past the menu. A latch that entitled anybody would be A15 defeated by
 *      a bug fix, which is strictly worse than the bug.
 *   4. **It is per RECKONING and not forever.** A high-water mark that never cleared would be a
 *      permanent entitlement wearing a cycle's name — the same defect with the sign flipped.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { storesAccount } from '../../src/ledger/index.js';
import { freeCash } from '../../src/market/escrow.js';
import { PARLEYS_PER_RECKONING } from '../../src/say/parley.js';
import { act, campaignWorld, tick } from '../campaign/fixture.js';

/**
 * Spend a principal's whole free balance, the way `vCreate` does: a real `transferCurrency` out of
 * `stores`. Not a burn and not a lock — the reported case was an escrow, which is a transfer, and
 * `freeCash` cannot tell the three apart.
 */
function spendEverything(
  runtime: ReturnType<typeof campaignWorld>['runtime'],
  who: PrincipalId,
  to: PrincipalId,
): void {
  const free = Number(freeCash(runtime.ledger, who));
  if (free <= 0) throw new Error('the fixture gave this principal nothing to spend');
  runtime.ledger.transferCurrency({
    eventId: `test:spend:${who}` as never,
    tick: runtime.engine.tick,
    from: storesAccount(who),
    to: storesAccount(to),
    amount: minor(free),
  });
}

describe('an ordinary spend no longer revokes the right to speak', () => {
  it('holds the allowance across a lock that takes free cash to zero', () => {
    const w = campaignWorld('parley-latch');
    const who = w.attacker;

    // ── 1. NON-VACUITY: THE ENTITLEMENT IS REALLY OPEN, AND ON THE MONEY TERM ──
    //
    // If `distinct_counterparties` were carrying the entitlement, the money term could be zero
    // throughout and this whole file would pass against the unfixed code. So both halves of the
    // disjunction are pinned before anything is spent.
    tick(w.runtime);
    const before = w.runtime.parleysFor(who, w.runtime.engine.tick);
    expect(before.distinct_counterparties).toBe(0);
    expect(Number(before.earned_minor)).toBeGreaterThan(0);
    expect(before.parleys_per_reckoning).toBe(PARLEYS_PER_RECKONING);

    // ── 2. THE SPEND, AND PROOF THAT IT BIT ───────────────────────────────────
    spendEverything(w.runtime, who, w.defender);
    tick(w.runtime);
    // The mutation subject, asserted directly off the ledger rather than inferred: the live
    // reading really is zero now. Without this line a fix that simply stopped the lock from
    // mattering would be indistinguishable from the latch.
    expect(Number(freeCash(w.runtime.ledger, who))).toBe(0);

    // ── 3. THE FIX ────────────────────────────────────────────────────────────
    const after = w.runtime.parleysFor(who, w.runtime.engine.tick);
    expect(after.parleys_per_reckoning).toBe(PARLEYS_PER_RECKONING);
    // And the published figure is consistent with the allowance it justifies — an `earned_minor`
    // of 0 next to an allowance of 3 would be a payload that contradicts itself.
    expect(Number(after.earned_minor)).toBeGreaterThan(0);
    expect(after.parleys_remaining).toBe(PARLEYS_PER_RECKONING);
  });

  it('and the allowance really is spendable afterwards, not merely printed', () => {
    // A published 3 that the handler refuses is the AGT-S2 defect and would satisfy the test
    // above. So the act goes through the verb table, and the refusal channel is read.
    const w = campaignWorld('parley-latch-send');
    const who = w.attacker;
    // Reach comes from standing in a live campaign (`say/reach.ts`), so the war has to exist before
    // anybody can address anybody. Without this the test fails on the OTHER gate and says nothing
    // about the entitlement.
    expect(act(w.runtime, who, 'build', { kind: 'CAMPAIGN', system: w.objective })).toBeNull();
    tick(w.runtime);
    const target = w.runtime.reachFor(who, w.runtime.engine.tick)[0]?.principal;
    if (target === undefined) throw new Error('the fixture gave the attacker nobody to address');

    spendEverything(w.runtime, who, w.defender);
    tick(w.runtime);
    expect(Number(freeCash(w.runtime.ledger, who))).toBe(0);

    const refusal = act(w.runtime, who, 'message', {
      to: target,
      act: 'offer',
      text: 'stand with me at the objective and I will carry your tribute this cycle',
    });
    expect(refusal).toBeNull();

    // ── AND THE SENDER CAN NOW SEE WHAT IT SPENT ──────────────────────────────
    //
    // Before this, a sent parley left no trace in the sender's own view at all: `last_parley` was
    // null, `parleys_received` 0, `talks[]` empty — every one of them an INBOUND field — and the
    // only evidence was the counter dropping. Wrong instrumentation for a three-per-Reckoning
    // resource that expires unspent.
    const seen = w.runtime.parleysFor(who, w.runtime.engine.tick);
    expect(seen.parleys_sent_this_reckoning).toBe(1);
    expect(seen.parleyed_this_reckoning).toEqual([target]);
    // The denominator closes by eye, which is the reason the field lives on this block.
    expect(seen.parleys_remaining + seen.parleys_sent_this_reckoning).toBe(seen.parleys_per_reckoning);
  });
});

describe('the price is exactly unchanged', () => {
  it('a principal that never held free cash never latches: allowance 0, and refused by hand', () => {
    const w = campaignWorld('parley-latch-price');
    expect(act(w.runtime, w.attacker, 'build', { kind: 'CAMPAIGN', system: w.objective })).toBeNull();
    const campaign = w.runtime.campaigns.liveAgainst(w.objective)?.id;
    if (campaign === undefined) throw new Error('no campaign');

    const pauper = 'p:pauper' as PrincipalId;
    w.runtime.seat(pauper, 'pauper', w.objective);
    w.runtime.standing.open(pauper);
    tick(w.runtime);

    // ── THE FREE DOOR, WALKED THROUGH DELIBERATELY ────────────────────────────
    //
    // `join {side:"DEFENDER"}` is free and needs only a seat (§16.6 MUST-9), so this identity now
    // has a constellation's worth of REACH for nothing. That is the hole reach alone cannot close
    // and the reason the entitlement exists — and it is the only setup under which A15, rather
    // than A2, is the gate actually being tested.
    expect(
      act(w.runtime, pauper, 'join', { campaign: String(campaign), side: 'DEFENDER', system: w.objective }),
    ).toBeNull();

    // Run a Reckoning of samples past it. A latch that recorded anything for a principal that
    // never held anything would show up here and nowhere else.
    for (let n = 0; n < 40; n += 1) tick(w.runtime);

    const block = w.runtime.parleysFor(pauper, w.runtime.engine.tick);
    expect(block.reachable_principals, 'the free door must really be open, or this proves nothing').toBeGreaterThan(0);
    expect(block.distinct_counterparties).toBe(0);
    expect(Number(block.earned_minor)).toBe(0);
    expect(block.parleys_per_reckoning).toBe(0);
    expect(block.parleys_remaining).toBe(0);
    expect(block.parleys_sent_this_reckoning).toBe(0);

    // Past the menu, by hand, at a principal it can genuinely reach: still A15.
    const refusal = act(w.runtime, pauper, 'message', {
      to: w.attacker,
      act: 'offer',
      text: 'a cold approach from an identity that has produced nothing',
    });
    expect(refusal).not.toBeNull();
    expect(refusal?.invariant).toBe('A15');
  });
});

describe('per RECKONING, not forever', () => {
  it('the high-water mark clears at the boundary', () => {
    const w = campaignWorld('parley-latch-roll');
    const who = w.attacker;
    tick(w.runtime);
    // Non-vacuity: it is latched now.
    expect(w.runtime.parleysFor(who, w.runtime.engine.tick).parleys_per_reckoning).toBe(
      PARLEYS_PER_RECKONING,
    );

    spendEverything(w.runtime, who, w.defender);
    tick(w.runtime);
    expect(Number(freeCash(w.runtime.ledger, who))).toBe(0);
    expect(w.runtime.parleysFor(who, w.runtime.engine.tick).parleys_per_reckoning).toBe(
      PARLEYS_PER_RECKONING,
    );

    // Cross into the next Reckoning with the money still locked. The entitlement must now be gone:
    // a latch that survived the boundary would be a permanent grant wearing a cycle's name.
    const target = w.runtime.engine.tick + TICKS_PER_RECKONING + 2;
    while (w.runtime.engine.tick < target) tick(w.runtime);
    expect(Number(freeCash(w.runtime.ledger, who))).toBe(0);
    const rolled = w.runtime.parleysFor(who, w.runtime.engine.tick);
    expect(Number(rolled.earned_minor)).toBe(0);
    expect(rolled.parleys_per_reckoning).toBe(0);
  });
});
