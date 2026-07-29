/**
 * **WHICH MANDATE AM I ACTING UNDER?** — grant selection, as a function of its inputs.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **A GRANTOR WHOSE FIRST GRANT WAS NARROW MADE EVERY LATER, WIDER GRANT UNUSABLE.**
 *
 * Both delegated verbs used to resolve their mandate with `GrantBook.liveGrantBetween`, which
 * picks *"the one with the most direct headroom"* and tiebreaks on id — and a grant id is
 * `g:<tick>:<hash>`, so equal headroom means **the oldest grant wins**. Then, and only then, the
 * caller asked whether that grant carried the verb.
 *
 * A blind probe held five grants from one grantor, **four of them carrying `create`**, and every
 * single `create … on_behalf_of` was refused with *"grant g:37 is a treasury-hand and carries
 * elect, not `create` … Ask it for a grant that carries `create`"* — while it already held a
 * quartermaster, an escort-captain, a factor and a steward. The refusal named a real rule and
 * described a world that did not exist. The core loop only became reachable by revoking grants in
 * strict age order.
 *
 * Two rules close it, and they are the two halves of one sentence:
 *
 *   1. **The verb is part of the question, not a check afterwards.** Selection filters to the
 *      grants that actually carry the verb, so "no grant carries it" and "the grant I picked does
 *      not carry it" stop being the same refusal. `GrantBook.carriesVerb` is still the fence and
 *      `recordSpend` is still the backstop; what changed is that the *choice* consults the fence.
 *   2. **An explicit `grant` is honoured, never ignored.** A delegate holding several mandates from
 *      one grantor is the case A6 is about, and a param that shapes which limit gets charged is a
 *      param whose loss changes what the actor committed to — the same class as the dropped
 *      `elective_bps` and the dropped `on_behalf_of`. So it is read, checked, and refused with a
 *      reason; it is never silently replaced by the engine's own pick.
 *
 * ── WHY A PURE FUNCTION AND NOT A METHOD ON THE BOOK ─────────────────────────
 *
 * Because the refusals are a rules surface. `create` and `elect` are the two verbs that accept
 * `on_behalf_of` and draw on LIMITS (`DELEGABLE_VERBS`), and before this they resolved their
 * mandate in two places with two sets of sentences — which is scar #1's setup on the core loop's
 * own door. One function, one set of hints, both verbs.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { Grant, GrantId, PrincipalId } from '../core/types.js';
import { compareIds } from '../ledger/order.js';
import { accept, reject, type WorldResult } from '../world/result.js';
import { officesCarrying } from './compartment.js';

/** What selection needs to know about the book. Narrow on purpose (D21's port shape). */
export interface GrantSelectionPort {
  readonly get: (id: GrantId) => Grant | undefined;
  /** Exists, not expired, not revoked at this tick. `GrantBook.isLive`'s one rule. */
  readonly isLive: (id: GrantId, atTick: number) => boolean;
  /** Every live grant from `grantor` to `delegate`, in canonical id order. */
  readonly liveGrantsBetween: (
    grantor: PrincipalId,
    delegate: PrincipalId,
    atTick: number,
  ) => readonly Grant[];
}

export interface GrantSelection {
  readonly grantor: PrincipalId;
  readonly delegate: PrincipalId;
  /** The verb the delegate is about to draw on. One of {@link DELEGABLE_VERBS}. */
  readonly verb: string;
  readonly atTick: number;
  /** The grant the delegate named, or null to let the engine pick. */
  readonly named: GrantId | null;
}

/**
 * Order two candidate grants: **most direct headroom, then most contingent headroom, then id.**
 *
 * Exported so the tiebreak is testable on its own. Both headrooms are in the order because
 * `create` gates on both and a rule that only looked at the direct half would hand a delegate the
 * grant it cannot finish the act with — and the id is last so replay is stable when two grants are
 * genuinely interchangeable.
 */
export function preferWiderGrant(a: Grant, b: Grant): number {
  const direct = b.maxDirectLoss - b.spentDirect - (a.maxDirectLoss - a.spentDirect);
  if (direct !== 0) return direct;
  const contingent =
    b.maxContingentLiability - b.spentContingent - (a.maxContingentLiability - a.spentContingent);
  if (contingent !== 0) return contingent;
  return compareIds(a.id, b.id);
}

/** One line describing a grant's fence, for a refusal that has to name the real problem. */
function describeFence(g: Grant): string {
  return `${g.id} (${g.template}, carries ${g.verbs.length === 0 ? 'no verbs' : g.verbs.join(' and ')})`;
}

/**
 * The offices to ask for, named. **A refusal that does not name the fix is a wall** (A2, §12.2), and
 * the list comes from `OFFICE_SHAPES` so it cannot drift from what the templates actually carry.
 */
function askFor(verb: string): string {
  const offices = officesCarrying(verb);
  return offices.length === 0
    ? `Ask it for a grant that carries \`${verb}\``
    : `Ask it for a grant that carries \`${verb}\` (a ${offices.join(', ')})`;
}

/**
 * The live grant that authorises `delegate` to `verb` in `grantor`'s name, or why not.
 *
 * Never throws and never picks a grant the fence would refuse: a caller that gets an `ok` result
 * may go straight to the headroom checks.
 */
export function selectGrant(
  port: GrantSelectionPort,
  args: GrantSelection,
): WorldResult<Grant> {
  const live = port.liveGrantsBetween(args.grantor, args.delegate, args.atTick);

  if (args.named !== null) {
    const named = port.get(args.named);
    if (named === undefined) {
      return reject(
        'A2',
        `there is no grant ${args.named}. Name one of the grants you actually hold — they are in ` +
          '`grants.held[]` on your own observation — or omit `grant` and the widest one that carries ' +
          `\`${args.verb}\` is used.`,
      );
    }
    if (named.grantor !== args.grantor) {
      return reject(
        'INV-23',
        `grant ${named.id} was issued by ${named.grantor}, and you are acting for ${args.grantor}. A draw ` +
          "against the wrong grantor's limit is a wrong row in a journal INV-22 halts the world over, so it " +
          'is refused rather than redirected. Name a grant from ' +
          `${args.grantor}, or change on_behalf_of.`,
      );
    }
    if (named.delegate !== args.delegate) {
      return reject(
        'INV-23',
        `grant ${named.id} names ${named.delegate} as its delegate, not you. Authority is not transferable ` +
          'by naming it: ask ' +
          `${args.grantor} for a grant of your own (verb: grant).`,
      );
    }
    if (!port.isLive(named.id, args.atTick)) {
      return reject(
        'INV-23',
        `grant ${named.id} is expired or revoked at tick ${String(args.atTick)}, so it authorises nothing. ` +
          'Authority ends on a stated tick and revocation takes effect the next tick (scar #7, §8.1 #5, #6). ' +
          `You hold ${String(live.length)} live grant(s) from ${args.grantor}.`,
      );
    }
    if (!named.verbs.includes(args.verb)) {
      const usable = live.filter((g) => g.verbs.includes(args.verb));
      return reject(
        'INV-22',
        `grant ${named.id} is a ${named.template} and carries ` +
          `${named.verbs.length === 0 ? 'no verbs at all' : named.verbs.join(' and ')}, not \`${args.verb}\`. ` +
          `${args.grantor} delegated a SCOPE, not only a budget. ` +
          (usable.length === 0
            ? `None of the ${String(live.length)} live grant(s) you hold from it carries \`${args.verb}\` ` +
              `either: ${live.map(describeFence).join('; ')}.`
            : `You do hold ${String(usable.length)} that does: ${usable.map((g) => g.id).join(', ')} — ` +
              'name one of those, or omit `grant` and the widest is used.') +
          (usable.length === 0 ? ` ${askFor(args.verb)}, or act on your own account.` : ''),
      );
    }
    return accept(named);
  }

  if (live.length === 0) {
    return reject(
      'INV-23',
      `you hold no live grant from ${args.grantor} to act on its behalf. Ask it to grant you scoped ` +
        `authority (verb: grant), or act on your own account. An expired or revoked mandate reads the same ` +
        'way here — authority ends on a stated tick (scar #7).',
    );
  }

  const usable = [...live].filter((g) => g.verbs.includes(args.verb)).sort(preferWiderGrant);
  const best = usable[0];
  if (best === undefined) {
    // ── THE REFUSAL THAT NAMES THE REAL PROBLEM ──────────────────────────────
    //
    // Not "grant <the oldest one> does not carry it" — that sentence sent a probe hunting for a
    // grant it already held four of. The real problem is that NONE of the live mandates carries
    // the verb, so every one of them is listed with what it does carry, and the ask is specific.
    return reject(
      'INV-22',
      `none of the ${String(live.length)} live grant(s) you hold from ${args.grantor} carries ` +
        `\`${args.verb}\`: ${live.map(describeFence).join('; ')}. ${args.grantor} delegated a SCOPE, not ` +
        `only a budget: you may draw on its LIMITS through the verbs it named and no others. ` +
        `${askFor(args.verb)}, or act on your own account.`,
    );
  }
  return accept(best);
}
