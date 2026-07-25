/**
 * Role-slot allocation, batched at tick close (SPEC §7.3, PROP-V8).
 *
 * > **A rationed resource granted at submit is a polling contest** — the design
 * > already solved this one system over (tick-batched market clearing where arrival
 * > order confers no advantage) and simply had not applied it. — §7.3
 *
 * So `fill_role` is a **request**, not a grant. Requests accumulate through the
 * tick and are resolved together at tick close by a rule that never reads arrival:
 *
 *   1. the initiator's stated **preference order** (`venture.preference`);
 *   2. failing that, **pro-rata by stake** — highest stake first;
 *   3. tiebreak on `principal_id`, then `client_sequence`.
 *
 * `client_sequence` is last and it is not arrival: §12.3 gives an agent one
 * `act_batch` per tick with its own ordering, and §15.2 orders the queue by
 * `(priority, principal_id, client_sequence)`, "never arrival". A principal's own
 * sequence is a statement about its own preferences, which is exactly what a
 * tiebreak between two of its own requests should read.
 *
 * The consequence PROP-V8 asserts: **two identical policies submitting at different
 * moments within a tick get identical outcomes.** {@link allocateFills} sorts its
 * input before doing anything, so the caller's order is not an input at all — which
 * is stronger than promising not to look at it. Rebuilding scar #2 (request speed
 * beat strategy) inside a scarce resource is the failure this closes.
 *
 * ## What allocation does *not* do
 *
 * It does not lock the stake. §7.3 requires "filling a role escrows the stake at
 * fill time", and that is a value movement, so it goes through the `Ledger` in
 * {@link ./settlement.ts}'s companion {@link lockFillStake} — this module decides
 * *who*, and the ledger decides *what moves*. One value path (§15.1).
 *
 * ## What it *must* do: hand the world its half in the same phase
 *
 * Commitment lives in `venture_role.filled_by_hand_id` (INV-9) and the hand's *state*
 * lives in the world, and `world/invariants.ts` treats a hand filling a live role while
 * `IDLE` as a **halt**: "release it from the role or commit it". So a grant that wrote
 * the role and left the hand alone made the ALLOCATE phase produce a world the ASSERT
 * phase refuses — the engine halting on a state it created itself, which §15.2 counts
 * as an outage in front of an audience.
 *
 * The transition is the world's to make, so this calls the world's own `commitHand`
 * rather than assigning the field. Two writes in one phase, never one.
 */

import type { HandId, PrincipalId, VentureId } from '../core/types.js';
import { minor, type Minor } from '../core/units.js';
import { compareIds } from '../ledger/index.js';
import { commitHand, type HandRecord } from '../world/index.js';
import { VentureBook } from './book.js';
import { fillRole, vacateRole, type VentureRoleRecord } from './venture.js';

/** One agent's bid for one slot, submitted during a tick. */
export interface FillRequest {
  readonly venture: VentureId;
  readonly roleIndex: number;
  readonly principal: PrincipalId;
  readonly hand: HandId;
  /** §12.3's per-batch ordering key. A statement of the agent's own preference. */
  readonly clientSequence: number;
  /**
   * What this principal commits to the slot (§3: STAKE). The pro-rata fallback
   * reads it, and §7.3 escrows it at fill time so holding a slot is not a free
   * option. Zero is legal and means "no stake, lowest priority in a contest".
   */
  readonly stake: Minor;
}

export type RefusalReason = 'LOST_CONTEST' | 'HAND_COMMITTED' | 'ROLE_RULE';

export interface Granted {
  readonly request: FillRequest;
  readonly role: VentureRoleRecord;
}

export interface Refused {
  readonly request: FillRequest;
  readonly reason: RefusalReason;
  /** The rule that refused: an invariant or a property id. */
  readonly invariant: string;
  readonly hint: string;
}

export interface AllocationResult {
  readonly granted: readonly Granted[];
  readonly refused: readonly Refused[];
}

/**
 * The canonical order requests are considered in. **Never arrival.**
 *
 * Slot-major: all bids for one `(venture, roleIndex)` are adjacent, so a contest is
 * decided in one pass and the winner of an earlier slot is already committed when a
 * later slot is considered — which is what makes "one principal, one role" and "one
 * hand, one live role" hold across a whole batch rather than only pairwise.
 */
export function canonicalRequestOrder(
  a: FillRequest,
  b: FillRequest,
  preferenceRank: (venture: VentureId, principal: PrincipalId) => number,
): number {
  const byVenture = compareIds(a.venture, b.venture);
  if (byVenture !== 0) return byVenture;
  if (a.roleIndex !== b.roleIndex) return a.roleIndex - b.roleIndex;
  // 1. the initiator's stated preference order.
  const rankA = preferenceRank(a.venture, a.principal);
  const rankB = preferenceRank(b.venture, b.principal);
  if (rankA !== rankB) return rankA - rankB;
  // 2. pro-rata by stake: more committed goes first.
  if (a.stake !== b.stake) return b.stake - a.stake;
  // 3. deterministic tiebreak.
  const byPrincipal = compareIds(a.principal, b.principal);
  if (byPrincipal !== 0) return byPrincipal;
  if (a.clientSequence !== b.clientSequence) return a.clientSequence - b.clientSequence;
  return compareIds(a.hand, b.hand);
}

export interface AllocationContext {
  readonly tick: number;
  handOf(id: HandId): HandRecord | undefined;
}

/**
 * Resolve every fill request for this tick.
 *
 * Pure with respect to ordering: the result depends on the *set* of requests, the
 * book, and the tick — never on the order they were handed over. That is PROP-V8,
 * and it is asserted by shuffling the input and comparing.
 */
export function allocateFills(
  book: VentureBook,
  requests: readonly FillRequest[],
  ctx: AllocationContext,
): AllocationResult {
  const rank = (venture: VentureId, principal: PrincipalId): number => {
    const v = book.get(venture);
    if (v === undefined) return Number.MAX_SAFE_INTEGER;
    const at = v.preference.indexOf(principal);
    // Unlisted principals sort after every listed one, in one band, so the stake
    // rule decides between them rather than the list's absence.
    return at === -1 ? v.preference.length : at;
  };

  const ordered = [...requests].sort((a, b) => canonicalRequestOrder(a, b, rank));
  const granted: Granted[] = [];
  const refused: Refused[] = [];

  for (const request of ordered) {
    const venture = book.get(request.venture);
    if (venture === undefined) {
      refused.push({
        request,
        reason: 'ROLE_RULE',
        invariant: 'PROP-V6',
        hint: `no venture ${request.venture}; it may have resolved before tick close.`,
      });
      continue;
    }

    const hand = ctx.handOf(request.hand);
    if (hand === undefined) {
      refused.push({
        request,
        reason: 'ROLE_RULE',
        invariant: 'INV-9',
        hint: `no hand ${request.hand}.`,
      });
      continue;
    }
    if (hand.principal !== request.principal) {
      refused.push({
        request,
        reason: 'ROLE_RULE',
        invariant: 'INV-9',
        hint: `hand ${request.hand} belongs to ${hand.principal}, not ${request.principal}.`,
      });
      continue;
    }

    // The partial unique index, consulted before the venture is touched. A hand
    // already committed loses the contest without the venture ever seeing the bid,
    // so a losing request cannot leave a half-written role behind.
    const existing = book.commitmentOf(request.hand);
    if (existing !== null) {
      refused.push({
        request,
        reason: 'HAND_COMMITTED',
        invariant: 'INV-9',
        hint:
          `hand ${request.hand} already fills ${existing.venture} role ${existing.roleIndex}. ` +
          'A hand is one unit of simultaneous physical presence; send a different hand or wait for ' +
          'that venture to resolve.',
      });
      continue;
    }

    const result = fillRole(venture, request.roleIndex, hand, ctx.tick);
    if (!result.ok) {
      refused.push({
        request,
        // A filled role means somebody else won this slot in this same batch; any
        // other refusal is a rule about the request itself. Distinguishing them is
        // what lets an agent tell "I was outbid" from "I asked for the impossible".
        //
        // `?? null` is load-bearing: a role index the kind does not have reads
        // `undefined`, and `undefined !== null` would tell an agent it was outbid for
        // a slot that does not exist — the one reading it cannot act on.
        reason:
          (venture.roles[request.roleIndex]?.filledByHandId ?? null) !== null
            ? 'LOST_CONTEST'
            : 'ROLE_RULE',
        invariant: result.invariant,
        hint: result.hint,
      });
      continue;
    }

    book.indexFill(request.venture, request.roleIndex, request.hand);

    // The world's half of the same grant. `commitHand` is idempotent for a hand that is
    // already COMMITTED or IN_TRANSIT (an escort travelling *for* the role is a legal
    // fill) and refuses only a RECOVERING one.
    const committed = commitHand(hand);
    if (!committed.ok) {
      // Unreachable while `fillRole` requires `isPresent`, which a RECOVERING hand is
      // not. Kept, and kept as a *rollback*, because the alternative is the exact state
      // INV-9 halts on: a role naming a hand the world will not commit. A refusal costs
      // one agent one slot; the halt costs every agent the tick.
      vacateRole(venture, request.roleIndex);
      book.indexRelease(request.hand);
      refused.push({
        request,
        reason: 'ROLE_RULE',
        invariant: committed.invariant,
        hint: committed.hint,
      });
      continue;
    }
    granted.push({ request, role: result.value });
  }

  return { granted, refused };
}

/** Total stake bid across a batch, for the pro-rata report on a contested slot. */
export function stakeBid(requests: readonly FillRequest[]): Minor {
  let total = 0;
  for (const r of requests) total += r.stake;
  return minor(total);
}
