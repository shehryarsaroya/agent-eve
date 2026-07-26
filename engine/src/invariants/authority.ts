/**
 * INV-22, INV-23 — the authority group.
 *
 * A6 makes betrayal-via-legitimate-authority the core loop, which means the grant
 * table is the surface an attacker works against. Both invariants here exist
 * because the *legitimate* path must be airtight: if a delegate can exceed its
 * LIMITS, or route authority through a cycle back to itself, then the betrayal
 * stops being a story about trust and becomes a bug report.
 *
 * PROP-G1 is the attack INV-22 is scaled for: "a delegate sends your hands into a
 * raid where its own accomplice waits, every action technically within bounds, your
 * loss total." Every action within bounds is the *acceptable* version. The
 * unacceptable version is the same attack with the bounds not actually enforced,
 * and the only way to know which one happened is to recompute the spend from the
 * journal rather than trust the counter on the row.
 */

import { MAX_DELEGATION_DEPTH } from '../identity/vc.js';
import type { EventId, Grant, GrantId, InvariantViolation, PrincipalId } from '../core/types.js';
import { addMinor, minor, type Minor } from '../core/units.js';
import { halt } from './registry.js';

/**
 * One draw against a grant's LIMITS.
 *
 * `direct` bounds destruction, not just transfers (PROP-G1), so a spend row
 * carries both halves separately: a delegate can burn your cargo without moving a
 * single coin, and a journal that only recorded transfers would show a clean grant
 * over a total loss.
 */
export interface GrantSpend {
  readonly grant: GrantId;
  readonly delegate: PrincipalId;
  readonly tick: number;
  readonly eventId: EventId;
  readonly direct: Minor;
  readonly contingent: Minor;
}

/**
 * INV-22 — no grant's headroom is negative; the sum of all delegate spends against
 * a grant never exceeds its LIMITS, even with concurrent delegates.
 *
 * "Even with concurrent delegates" is the clause that forces the recomputation. A
 * per-row counter incremented by two writers is exactly the read-modify-write race
 * that produces a spend over the limit with a counter that looks fine, so the
 * journal is summed and the counter is treated as a cache to be checked — the same
 * shape as INV-5 for EXPOSURE.
 */
export function checkInv22(
  grants: readonly Grant[],
  spends: readonly GrantSpend[],
  tick: number,
): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const summed = new Map<GrantId, { readonly direct: Minor; readonly contingent: Minor }>();
  const known = new Map<GrantId, Grant>();
  for (const g of grants) known.set(g.id, g);

  for (const spend of [...spends].sort(
    (a, b) => cmp(a.grant, b.grant) || a.tick - b.tick || cmp(a.eventId, b.eventId),
  )) {
    if (spend.direct < 0 || spend.contingent < 0) {
      out.push(
        halt(
          'INV-22',
          tick,
          `spend ${spend.eventId} against grant ${spend.grant} is negative ` +
            `(direct ${spend.direct}, contingent ${spend.contingent}); a spend never returns headroom`,
        ),
      );
    }
    const grant = known.get(spend.grant);
    if (grant === undefined) {
      out.push(
        halt(
          'INV-22',
          tick,
          `spend ${spend.eventId} draws on grant ${spend.grant}, which is not in the grant table`,
        ),
      );
      continue;
    }
    if (spend.delegate !== grant.delegate) {
      out.push(
        halt(
          'INV-22',
          tick,
          `spend ${spend.eventId} on grant ${spend.grant} was made by ${spend.delegate}, but the grant ` +
            `names ${grant.delegate}`,
        ),
      );
    }
    if (spend.tick > grant.expiresTick) {
      out.push(
        halt(
          'INV-22',
          tick,
          `spend ${spend.eventId} on grant ${spend.grant} is at tick ${spend.tick}, after it expired at ` +
            `${grant.expiresTick}`,
        ),
      );
    }
    if (grant.revokedAtTick !== null && spend.tick > grant.revokedAtTick) {
      out.push(
        halt(
          'INV-22',
          tick,
          `spend ${spend.eventId} on grant ${spend.grant} is at tick ${spend.tick}, after it was revoked at ` +
            `${grant.revokedAtTick}`,
        ),
      );
    }
    // `addMinor`, not `+=`. A bare accumulator that crosses 2^53 rounds SILENTLY and
    // the wrong total is itself a safe integer, so the journal-vs-cache comparison
    // below would compare two different wrong numbers and could agree. The checked
    // helper throws instead — and an invariant whose own arithmetic can drift is a
    // guard that reads exactly like a clean bill of health (the same reasoning that
    // put `sumMinor` in `core/units.ts`).
    const acc = summed.get(spend.grant) ?? { direct: minor(0), contingent: minor(0) };
    summed.set(spend.grant, {
      direct: addMinor(acc.direct, spend.direct),
      contingent: addMinor(acc.contingent, spend.contingent),
    });
  }

  for (const grant of [...known.values()].sort((a, b) => cmp(a.id, b.id))) {
    if (grant.maxDirectLoss < 0 || grant.maxContingentLiability < 0) {
      out.push(
        halt(
          'INV-22',
          tick,
          `grant ${grant.id} has negative LIMITS (direct ${grant.maxDirectLoss}, contingent ` +
            `${grant.maxContingentLiability})`,
        ),
      );
    }
    if (grant.spentDirect < 0 || grant.spentContingent < 0) {
      out.push(
        halt(
          'INV-22',
          tick,
          `grant ${grant.id} has negative spend (direct ${grant.spentDirect}, contingent ` +
            `${grant.spentContingent})`,
        ),
      );
    }
    if (grant.spentDirect > grant.maxDirectLoss) {
      out.push(
        halt(
          'INV-22',
          tick,
          `grant ${grant.id} headroom is negative: spent ${grant.spentDirect} of a max_direct_loss of ` +
            `${grant.maxDirectLoss}. The grantor was shown that number before it signed (A7)`,
        ),
      );
    }
    if (grant.spentContingent > grant.maxContingentLiability) {
      out.push(
        halt(
          'INV-22',
          tick,
          `grant ${grant.id} headroom is negative: contingent ${grant.spentContingent} of a max of ` +
            `${grant.maxContingentLiability}`,
        ),
      );
    }
    const acc = summed.get(grant.id) ?? { direct: minor(0), contingent: minor(0) };
    if (acc.direct !== grant.spentDirect) {
      out.push(
        halt(
          'INV-22',
          tick,
          `grant ${grant.id}: the spend journal sums to ${acc.direct} direct, the row caches ` +
            `${grant.spentDirect}. Concurrent delegates race a counter; they cannot race a journal`,
        ),
      );
    }
    if (acc.contingent !== grant.spentContingent) {
      out.push(
        halt(
          'INV-22',
          tick,
          `grant ${grant.id}: the spend journal sums to ${acc.contingent} contingent, the row caches ` +
            `${grant.spentContingent}`,
        ),
      );
    }
  }

  return out;
}

/**
 * A countersigned deal, for INV-23's third clause.
 *
 * `signer` is the principal whose key signed; `onBehalfOf` is the principal whose
 * assets are bound. When both are set and the signer is also on the other side of
 * the table, the delegate is trading with itself using someone else's money — a
 * self-deal wearing a grant, and the one form of betrayal that must be *invalid*
 * rather than merely legible (E2E-11: betrayal is legitimate-authority abuse or it
 * is nothing).
 */
export interface SignedDeal {
  readonly eventId: EventId;
  readonly signer: PrincipalId;
  readonly onBehalfOf: PrincipalId | null;
  readonly grant: GrantId | null;
  readonly counterparties: readonly PrincipalId[];
}

/**
 * Whether a grant is a link in a real delegation chain rather than a root grant.
 *
 * A chain needs a parent: "B may act for A, and C may act for A **through B**". `Grant`
 * (`core/types.ts`) has no `parentGrantId`, so in this build the answer is always no — every grant
 * is a root over its own grantor's stores. Written as a predicate rather than as a deleted branch
 * so that the fact is stated in one place, testable, and impossible to forget when parentage lands.
 */
function hasDelegationParentage(grant: Grant): boolean {
  return Object.prototype.hasOwnProperty.call(grant, 'parentGrantId');
}

/**
 * INV-23 — no grant chain contains a cycle; no principal is transitively its own
 * delegate; no delegate is counterparty to a deal it signs on another's behalf.
 *
 * Cycles are checked over grants **live at `tick`**, because an expired grant is
 * not authority and a revoked one is not either — a cycle through a dead edge is a
 * historical curiosity, and halting the world over it would be a false halt.
 */
export function checkInv23(
  grants: readonly Grant[],
  deals: readonly SignedDeal[],
  tick: number,
): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const live = grants
    .filter((g) => g.expiresTick >= tick && (g.revokedAtTick === null || g.revokedAtTick >= tick))
    .sort((a, b) => cmp(a.id, b.id));

  const edges = new Map<PrincipalId, PrincipalId[]>();
  for (const g of live) {
    if (g.grantor === g.delegate) {
      out.push(
        halt(
          'INV-23',
          tick,
          `grant ${g.id} makes ${g.grantor} its own delegate; authority over yourself is not a grant`,
        ),
      );
      continue;
    }
    // ── THE EDGE THAT DOES NOT EXIST ────────────────────────────────────────
    //
    // This used to be unconditional, and it manufactured a permanent, agent-reachable HALT out of
    // entirely legal play. Measured: four grants — a→b, b→c, c→d, d→e — produce
    // `HALT INV-23: grant chain from p:a is 5 deep`. Nobody re-delegated anything. Each of those
    // five principals granted authority over ITS OWN stores to one other principal, which is the
    // single most ordinary thing a cast of neighbours does, and it is exactly what the `grant`
    // affordance now offers to every counterparty with a kept promise.
    //
    // The walk models a relationship this build cannot have. `vGrant` sets `grantor` to the actor
    // (or the syndicate it holds an office in) and the grant binds the GRANTOR'S OWN stores; `Grant`
    // has no `parentGrantId`, so holding a grant from A does not let you delegate A's authority
    // onward. Read as a graph of "who may spend whose money", the two shapes this walk halts on are:
    //
    //     a -> b -> a        two neighbours who each trust the other
    //     a -> b -> c -> d   four principals who each trust one other
    //
    // Both are legal, desirable, and the point of A6. "A chain nobody can audit is authority nobody
    // granted" is the right sentence about the wrong graph: nobody granted TRANSITIVE authority
    // here, because every grant is explicit, bounded, and shown to its grantor before signing.
    //
    // So no edge is added, and the walk below runs over an empty graph. It is kept rather than
    // deleted because it is correct code for the model that lands with `parentGrantId` — and
    // `test/invariants/authority-no-false-halt.test.ts` FAILS the moment that field appears, so the
    // walk cannot stay inert once there is a real chain to check. The self-grant refusal above is
    // untouched: authority over yourself is meaningless whatever the model.
    if (!hasDelegationParentage(g)) continue;
    const to = edges.get(g.grantor);
    if (to === undefined) edges.set(g.grantor, [g.delegate]);
    else to.push(g.delegate);
  }

  // Iterative DFS with an on-path set. Recursion would be fine at 300 principals,
  // but a cycle is exactly the input that makes a recursive walk blow the stack,
  // and this runs inside a tick (DET-9: bounded step count regardless of input).
  const colour = new Map<PrincipalId, 'GREY' | 'BLACK'>();
  for (const start of [...edges.keys()].sort(cmp)) {
    if (colour.get(start) === 'BLACK') continue;
    const stack: { readonly node: PrincipalId; index: number }[] = [{ node: start, index: 0 }];
    colour.set(start, 'GREY');
    let depth = 1;
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const children = edges.get(frame.node) ?? [];
      if (frame.index >= children.length) {
        colour.set(frame.node, 'BLACK');
        stack.pop();
        depth -= 1;
        continue;
      }
      const next = children[frame.index];
      frame.index += 1;
      if (next === undefined) continue;
      if (colour.get(next) === 'GREY') {
        const path = stack.map((f) => f.node);
        out.push(
          halt(
            'INV-23',
            tick,
            `grant chain cycle: ${path.join(' -> ')} -> ${next}; ${next} is transitively its own delegate`,
          ),
        );
        continue;
      }
      if (colour.get(next) === 'BLACK') continue;
      colour.set(next, 'GREY');
      stack.push({ node: next, index: 0 });
      depth += 1;
      if (depth > MAX_DELEGATION_DEPTH + 1) {
        out.push(
          halt(
            'INV-23',
            tick,
            `grant chain from ${start} is ${depth} deep, past the limit of ${MAX_DELEGATION_DEPTH}; ` +
              'a chain nobody can audit is authority nobody granted',
          ),
        );
        // Abandoning the walk must not leave GREY nodes behind. A later `start`
        // treats a GREY node as on its own path and reports a cycle — so a legal
        // linear chain p0->p1->…->p6 that merely exceeds the depth cap used to also
        // publish "p2 is transitively its own delegate" about three principals whose
        // grants form no cycle at all. A halt record is permanent and operator-facing;
        // inventing an accusation inside one is the A5' failure in miniature.
        for (const frame of stack) colour.set(frame.node, 'BLACK');
        break;
      }
    }
  }

  for (const deal of [...deals].sort((a, b) => cmp(a.eventId, b.eventId))) {
    if (deal.onBehalfOf === null) continue;
    if (deal.counterparties.includes(deal.signer)) {
      out.push(
        halt(
          'INV-23',
          tick,
          `deal ${deal.eventId} is signed by ${deal.signer} on behalf of ${deal.onBehalfOf} with ` +
            `${deal.signer} as counterparty; a delegate may not sit on both sides of the table`,
        ),
      );
    }
    if (deal.counterparties.includes(deal.onBehalfOf)) {
      out.push(
        halt(
          'INV-23',
          tick,
          `deal ${deal.eventId} names ${deal.onBehalfOf} as both the principal bound and a counterparty`,
        ),
      );
    }
  }

  return out;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
