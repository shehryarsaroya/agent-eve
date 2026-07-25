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
import type { Minor } from '../core/units.js';
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
  const summed = new Map<GrantId, { direct: number; contingent: number }>();
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
    const acc = summed.get(spend.grant) ?? { direct: 0, contingent: 0 };
    acc.direct += spend.direct;
    acc.contingent += spend.contingent;
    summed.set(spend.grant, acc);
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
    const acc = summed.get(grant.id) ?? { direct: 0, contingent: 0 };
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
