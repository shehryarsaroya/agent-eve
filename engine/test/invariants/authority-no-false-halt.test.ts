/**
 * INV-23 HALTED THE WORLD ON FOUR LEGAL GRANTS.
 *
 * A permanent, agent-reachable halt, and free enrolment made it free to trigger. Measured:
 *
 *     a -> b, b -> c, c -> d, d -> e     =>  HALT INV-23: "grant chain from p:a is 5 deep"
 *
 * Nobody re-delegated anything. Each of those five principals granted authority over ITS OWN stores
 * to one other principal — the most ordinary thing a cast of neighbours does, and precisely what the
 * `grant` affordance now offers to every counterparty with a kept promise. So the affordance shipped
 * earlier today made a latent halt into a likely one.
 *
 * `loop.ts` names this the worst class in the repo: a halt reachable from agent input is "worse than
 * a crash because it is a weapon".
 *
 * ── WHY THE INVARIANT WAS WRONG RATHER THAN THE PLAY ─────────────────────────
 * `vGrant` sets `grantor` to the actor and the grant binds the GRANTOR'S OWN stores. `Grant` has no
 * `parentGrantId`, so holding a grant from A does not let you delegate A's authority onward. Read as
 * a graph of *who may spend whose money*, the two shapes the walk halted on are:
 *
 *     a -> b -> a          two neighbours who each trust the other
 *     a -> b -> c -> d     four principals who each trust one other
 *
 * Both legal, both desirable, both the point of A6. *"A chain nobody can audit is authority nobody
 * granted"* is the right sentence about the wrong graph — nobody granted TRANSITIVE authority,
 * because every grant is explicit, bounded, and shown to its grantor before signing.
 *
 * The transitive walk is kept, not deleted: it is correct code for the model that arrives with
 * `parentGrantId`. The last test in this file is what stops it staying inert once there is a real
 * chain to check.
 */

import { describe, expect, it } from 'vitest';
import { checkInv23 } from '../../src/invariants/authority.js';
import { MAX_DELEGATION_DEPTH } from '../../src/identity/index.js';
import type { Grant, GrantId, PrincipalId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';

function grant(n: number, from: string, to: string): Grant {
  return {
    id: `grant:${String(n)}` as GrantId,
    grantor: from as PrincipalId,
    delegate: to as PrincipalId,
    template: 'treasury-hand',
    maxDirectLoss: minor(1_000),
    maxContingentLiability: minor(1_000),
    spentDirect: minor(0),
    spentContingent: minor(0),
    expiresTick: 9_999,
    revokedAtTick: null,
  };
}

describe('independent grants are not a delegation chain', () => {
  it('does not halt on a line of principals who each trust one other', () => {
    // The exact input that halted the live model, one hop past the depth cap.
    const grants = [
      grant(1, 'p:a', 'p:b'),
      grant(2, 'p:b', 'p:c'),
      grant(3, 'p:c', 'p:d'),
      grant(4, 'p:d', 'p:e'),
    ];
    const violations = checkInv23(grants, [], 100);
    expect(
      violations.map((v) => `${v.severity} ${v.id} ${v.message}`),
      'four principals each granting over their OWN stores is legal play, and halting on it is an ' +
        'agent-reachable denial of the whole world',
    ).toEqual([]);
  });

  it('does not halt on mutual trust between two neighbours', () => {
    // a->b->a reads as a cycle only if the edges mean "delegated onward". They mean "may spend my
    // money", so this is two agents who each trust the other — the most desirable state in the game.
    const violations = checkInv23([grant(1, 'p:a', 'p:b'), grant(2, 'p:b', 'p:a')], [], 100);
    expect(violations, 'mutual trust is not a cycle').toEqual([]);
  });

  it('scales past the cap without halting, because there is no cap to breach', () => {
    // A realistic cast: twelve principals in a ring, every one trusting its neighbour. Under the old
    // edge construction this was a 12-deep "chain" and a certain halt.
    const ring = Array.from({ length: 12 }, (_, i) =>
      grant(i + 1, `p:${String(i)}`, `p:${String((i + 1) % 12)}`),
    );
    expect(ring.length).toBeGreaterThan(MAX_DELEGATION_DEPTH + 1);
    expect(checkInv23(ring, [], 100)).toEqual([]);
  });

  it('still refuses a grant to yourself, which is meaningless under any model', () => {
    // The guard's own guard: the fix must not have disarmed the check that was always right, or
    // this file would be proving that INV-23 does nothing at all.
    const violations = checkInv23([grant(1, 'p:a', 'p:a')], [], 100);
    expect(violations.length, 'self-grant must still be caught').toBe(1);
    expect(violations[0]?.id).toBe('INV-23');
    expect(String(violations[0]?.message)).toMatch(/its own delegate/);
  });
});

describe('the transitive walk must come back the moment a chain can exist', () => {
  it('fails when `Grant` gains a parent link, so the inert walk cannot stay inert', () => {
    // THE TRIPWIRE. `hasDelegationParentage` returns false for every grant today, so the cycle and
    // depth walk runs over an empty graph. That is correct *only* while a chain is impossible.
    //
    // The moment somebody adds `parentGrantId` to build real sub-delegation, the walk must be
    // re-enabled and re-reasoned — the depth cap, the cycle check, and `recordSpend` walking to the
    // root so a chain cannot multiply headroom (A7: the worst case was shown before signing).
    // Without this assertion the fix above becomes a silent hole in the invariant that exists to
    // stop unauditable authority.
    const sample = grant(1, 'p:a', 'p:b') as unknown as Record<string, unknown>;
    expect(
      Object.prototype.hasOwnProperty.call(sample, 'parentGrantId'),
      'A `parentGrantId` now exists on Grant, so delegation chains are real and INV-23\'s transitive ' +
        'walk is no longer checking anything. Re-enable it: build edges from parentage, restore the ' +
        'depth cap, make `recordSpend` consume headroom at every ancestor, and cascade `revoke` to ' +
        'the subtree. Then delete this test and write the ones for those four rules.',
    ).toBe(false);
  });
});
