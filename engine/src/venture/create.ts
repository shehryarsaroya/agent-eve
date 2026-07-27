/**
 * `create`'s rules surfaces, as functions of their inputs.
 *
 * ── WHY THIS LIVES HERE AND NOT IN `sim/runtime.ts` ──────────────────────────
 *
 * The fourth extraction under `D21`'s coupling order, following `refine.ts`, `sign.ts` and
 * `withdraw.ts`. `vCreate` is the longest verb handler in a 9,785-line class and it is the one that
 * decides two things nothing else in the game decides: **who a venture binds**, and **how much of it
 * is a promise rather than an execution.** Both are agent-facing rules, both are read by the
 * affordance list, the board row, the frame and `agent.md`, and each of those is a place scar #1 can
 * open. So each rule gets exactly one home, and every surface calls it rather than restating it.
 *
 * Nothing here touches the world. These are pure functions over params and over facts the caller has
 * already established, which is what lets the tests exercise them without a runtime.
 */

import { readInt } from '../core/params.js';
import type { GrantId, PrincipalId, VentureKind } from '../core/types.js';
import { BPS_ONE, bps, type Bps } from '../core/units.js';
import { reject, type Rejection, type WorldResult } from '../world/result.js';
import { MIN_ESCROW_BPS, isEscrowable, maxElectiveBps, minElectiveBps } from './kinds.js';

// ══════════════════════════════════════════════════════════════════════════════
// A DELEGATED `create` BINDS THE GRANTOR. THE GRANT **IS** THE CONSENT.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * The sentence the engine and `agent.md` must both say, in one place so they cannot drift.
 *
 * Same pattern as `GRADUATION_STATEMENT` and `CHARGE_STATEMENT`: the rules-surface test reads this
 * constant and asserts the document contains it, so a change here fails the build until the
 * document follows. `agent.md` §9 promised *"agents you granted authority to keep acting for you"*
 * while the engine required the grantor's own fresh countersignature — the document and the engine
 * disagreeing about one rule, which is scar #1's exact shape.
 */
export const GRANT_IS_CONSENT =
  'A delegated create binds you the moment it is made. The grant is the consent: your delegate does ' +
  'not need a second signature from you, and going dark does not undo what it committed inside the ' +
  'LIMITS you signed.';

/**
 * Who has countersigned a venture **at the moment it is formed**.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS IS WHERE A6 BECOMES REACHABLE, AND IT USED TO RETURN NOTHING.**
 *
 * §7.3 says *"nothing binds until both parties countersign the same `terms_hash`"*, and the first
 * build applied that to the creator of a **delegated** venture as well — so a delegate could form a
 * venture in its grantor's name, draw on both of the grantor's LIMITS, fund the escrow out of the
 * grantor's stores, and the thing still sat `FORMING` until the grantor woke up and signed.
 *
 * Three blind probes reached the same conclusion independently (`D22`): *"going dark is a perfect
 * defence against a delegate, so accepting a mandate has zero expected value and granting one has a
 * small non-zero cost. Both sides rationally opt out."* That is the quiet equilibrium arriving
 * through the front door, on the one mechanic the whole design is named for.
 *
 * **The grant is the consent.** A grantor that signed `max_direct_loss` and
 * `max_contingent_liability` has already stated the worst case it accepts; requiring a second
 * signature per act makes the LIMITS decorative and the delegate powerless. So the creator is bound
 * at formation, and the LIMITS are the protection — which is what §8.1 always said they were, and
 * what makes signing a grant genuinely dangerous. That danger is not a side effect. It is A6.
 *
 * Two consequences worth stating because they are the point rather than the cost:
 *
 *   - **The escrow was already gone.** `create` locks the escrowed half out of the creator's stores
 *     at formation, before any signature. So the countersignature never protected the direct half
 *     either; it only stopped the venture from *going anywhere*, which is a way of wasting the
 *     grantor's money rather than a way of protecting it.
 *   - **A syndicate could never sign at all.** A house *"cannot sign a request and cannot act"*, and
 *     `signatoriesRequired` includes the creator — so every venture an office-holder created on its
 *     syndicate's behalf was unactivatable by construction. Offices were unblocked over the treasury
 *     and then dead-ended one step later. This closes that too, and it is the same rule, not a
 *     special case: the house's consent is the covenant its members voted.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Returns the creator when the create is delegated, and nobody otherwise — an agent creating on its
 * own account still signs its own terms, because there is no grant standing in for the signature and
 * `sign`'s echo of `your_take_at_p50` is the only check that the creator read what it priced (§7.1).
 */
export function boundAtFormation(args: {
  readonly creator: PrincipalId;
  readonly boundByGrant: GrantId | null;
}): readonly PrincipalId[] {
  return args.boundByGrant === null ? [] : [args.creator];
}

/** The public sentence a delegated formation writes, for a receipt, a refusal or an affordance. */
export function bindingNote(args: {
  readonly creator: PrincipalId;
  readonly delegate: PrincipalId;
  readonly grant: GrantId;
}): string {
  return (
    `${args.delegate} bound ${args.creator} to this under grant ${args.grant}. ${args.creator} did ` +
    'not countersign and does not need to: the grant is the consent, and its LIMITS are the bound.'
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HOW MUCH OF A VENTURE IS A PROMISE IS THE CREATOR'S TO OFFER, INSIDE A BAND.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * The sentence `agent.md` must carry about the band, pinned here for the same reason as
 * {@link GRANT_IS_CONSENT}.
 *
 * Deliberately does **not** use the word "split". §3 gives SPLIT one meaning — *"the agreed division
 * of proceeds"* — and naming the escrowed/elective proportion a split would be a canon term doing a
 * second job on the most-read surface in the game. §3 already names these two halves: ESCROWED and
 * ELECTIVE. So the parameter is `elective_bps` and the prose says *proportion*.
 */
export const ELECTIVE_BPS_STATEMENT =
  'You choose how much of a venture is a promise. `elective_bps` on create is the share of every ' +
  'role left elective rather than escrowed, in basis points, inside a band the kind publishes — and ' +
  'the filler reads it on the board row before it commits a hand.';

/**
 * Read `elective_bps` off a `create`, or fall back to the kind's own floor.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE PROPORTION WAS A FIAT, AND A PROBE SENT THIS PARAM AND WAS IGNORED.**
 *
 * Every venture in the world was priced at exactly `f(kind)` elective and the rest escrowed, because
 * there was one pricer and it took no proportion. `agent.md` says *"the elective half is a real
 * choice, every time"*; in practice it was a fixed tax with a fixed answer, and `D22`'s fourth finding
 * is that there was therefore **nothing to negotiate**, which is why nobody negotiated. A creator
 * offering 60/40 against another offering 95/5 is the moment a counterparty's public record becomes
 * worth reading — which is the whole premise, and it had no lever.
 *
 * Worse: a probe **sent** `elective_bps: 4000` and the param was silently dropped. It got a 75/25
 * venture back and no correction. That is the `graduate`/`on_behalf_of` failure again — a dropped
 * param on a verb that shapes a binding commitment does not degrade the request, it changes what the
 * agent committed to — so the unrecognised spellings in {@link unhonouredCreateParam} are **refused**,
 * never ignored.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `escrow_bps` is honoured as the exact complement rather than refused: it is the same number said
 * from the other end, §7.5 publishes the *escrow* ratio on the card, and an agent that reaches for it
 * means something unambiguous. Sending both is refused unless they agree, because two figures that
 * disagree about one quantity is §7.1's failure with a percentage sign.
 */
export function readElectiveBps(
  kind: VentureKind,
  params: Readonly<Record<string, unknown>>,
): WorldResult<Bps> {
  const misnamed = unhonouredCreateParam(params);
  if (misnamed !== null) return misnamed;

  // ── PRESENT-BUT-UNREADABLE IS A REFUSAL, NOT AN ABSENCE ──────────────────────
  //
  // `readInt` is *"forgiving about spelling and strict about type"* and returns **null** for both
  // "no such key" and "the key is there and is not a safe integer". Those are the same value and
  // opposite facts, and collapsing them here reproduced the exact defect this parameter exists to
  // fix: `elective_bps: 40` as a *float* (`40.5`), or as the string `"4000"`, fell through to the
  // default and the agent got a venture priced at a proportion it did not choose, with no
  // correction. Found by a mutation test on this function, not by review.
  const malformed = malformedProportion(params);
  if (malformed !== null) return malformed;

  const wantedElective = readInt(params, ['elective_bps', 'electiveBps']);
  const wantedEscrow = readInt(params, ['escrow_bps', 'escrowBps']);
  if (wantedElective !== null && wantedEscrow !== null && wantedElective + wantedEscrow !== BPS_ONE) {
    return reject(
      'PROP-V5',
      `you sent elective_bps ${String(wantedElective)} and escrow_bps ${String(wantedEscrow)}, which add ` +
        `to ${String(wantedElective + wantedEscrow)} rather than ${String(BPS_ONE)}. They are the same ` +
        'number from opposite ends, so send one. Nothing was created: two figures that disagree about one ' +
        'quantity is how a party ends up bound to a proportion it did not choose.',
    );
  }
  const wanted = wantedElective ?? (wantedEscrow === null ? null : BPS_ONE - wantedEscrow);
  const low = minElectiveBps(kind);
  const high = maxElectiveBps(kind);
  // No proportion asked for: the kind's own floor, which is what every venture was priced at before
  // this parameter existed. So an unchanged `create` is an unchanged venture, and the default is a
  // *published* number rather than merely a historical one.
  if (wanted === null) return { ok: true, value: low };

  if (!Number.isSafeInteger(wanted) || wanted < 0 || wanted > BPS_ONE) {
    return reject('PROP-V5', `elective_bps is basis points in 0..${String(BPS_ONE)}, got ${String(wanted)}.`);
  }
  if (!isEscrowable(kind)) {
    if (wanted === BPS_ONE) return { ok: true, value: bps(BPS_ONE) };
    return reject(
      'PROP-V5',
      `${kind} is a top-yield kind and is legally un-escrowable (§7.5), so it is ${String(BPS_ONE)} bps ` +
        `elective and nothing else — you asked for ${String(wanted)}. The highest prizes cannot be secured: ` +
        'escrow strictly dominates for the buyer of any promise, so if they could be escrowed nobody would ' +
        'ever risk trust and standing would have nothing to accrue to. Send it without elective_bps, or ' +
        'pick an escrowable kind.',
    );
  }
  if (wanted < low) {
    return reject(
      'PROP-V5',
      `${kind} requires elective_bps >= ${String(low)} — f(kind), §7.5 — and you asked for ` +
        `${String(wanted)}. The elective part is the only part standing can accrue to, so no venture may ` +
        `be offered fully secured. The band for ${kind} is ${String(low)}..${String(high)}.`,
    );
  }
  if (wanted > high) {
    return reject(
      'PROP-V5',
      `${kind} requires elective_bps <= ${String(high)} — at least ${String(MIN_ESCROW_BPS)} bps of every ` +
        `role stays escrowed — and you asked for ${String(wanted)}. A creator that locks nothing can staff ` +
        'a venture on a promise alone and walk away for the price of one line on its record, and a fresh ' +
        'identity is free (A15), so the floor is capital rather than reputation. The band for ' +
        `${kind} is ${String(low)}..${String(high)}.`,
    );
  }
  return { ok: true, value: bps(wanted) };
}

/** Every spelling of the proportion this verb reads. One list, so presence and value agree. */
const PROPORTION_KEYS: readonly string[] = Object.freeze([
  'elective_bps',
  'electiveBps',
  'escrow_bps',
  'escrowBps',
]);

/**
 * A proportion that was *sent* and cannot be read as basis points.
 *
 * `40.5`, `"4000"`, `null` and `true` are all things an agent might send, and every one of them used
 * to arrive as "no proportion given" — so the create succeeded at the default and the agent believed
 * it had priced the unsecured half. A number that is nearly a proportion is worse than none.
 */
function malformedProportion(params: Readonly<Record<string, unknown>>): Rejection | null {
  for (const key of PROPORTION_KEYS) {
    const raw = params[key];
    if (raw === undefined) continue;
    if (typeof raw === 'number' && Number.isSafeInteger(raw)) continue;
    return reject(
      'PROP-V5',
      `${key} must be an INTEGER number of basis points in 0..${String(BPS_ONE)} — you sent ` +
        `${typeof raw === 'string' ? `the string "${raw}"` : String(raw)}. It is not coerced and it is not ` +
        'ignored: 4000 and "4000" would be the same act with only one of them on the record, and a create ' +
        'that quietly fell back to the default would bind you to a proportion you did not choose. Nothing ' +
        'was created.',
    );
  }
  return null;
}

/**
 * Params a `create` will not silently drop.
 *
 * The general rule `Runtime.unhonouredOnBehalf` states for `on_behalf_of`, applied to the two a probe
 * actually sent and lost:
 *
 *   - **`roles` / `role_count`.** The role template is a property of the *kind*, derived from the yield
 *     table so that ">=4 roles on a top-yield kind" cannot be edited away (`kinds.ts`). An agent that
 *     asks for four roles and silently gets two has been handed a different deal from the one it
 *     priced, and the count is the whole of PROP-V6's cooperation arithmetic.
 *   - **`split` / `escrow_pct` / `elective_pct`.** `split` is a §3 canon term meaning the division of
 *     *proceeds*; honouring it here would give a canon word a second meaning on a rules surface, and
 *     ignoring it would let an agent believe it had priced the unsecured half when it had not.
 *     Percentages are refused rather than multiplied by 100 — a factor-of-100 guess about how much of
 *     a deal is unsecured is not a guess worth making.
 */
export function unhonouredCreateParam(params: Readonly<Record<string, unknown>>): Rejection | null {
  for (const key of ['roles', 'role_count', 'roleCount', 'n_roles']) {
    if (params[key] === undefined) continue;
    return reject(
      'PROP-V6',
      `create does not take ${key}, and it will not quietly ignore it either. How many roles a venture ` +
        'has is fixed by its kind: DIG, HAUL, ESCORT, SURVEY, RAID and LEVY carry 2, and BUILD and SIEGE ' +
        'carry 4 — the top-yield kinds are the ones that force four distinct principals, which is why ' +
        'they pay what they pay. Nothing was created. Send create with the kind whose shape you want.',
    );
  }
  for (const key of ['split', 'escrow_pct', 'elective_pct', 'escrowPct', 'electivePct']) {
    if (params[key] === undefined) continue;
    return reject(
      'PROP-V5',
      `create does not take ${key}, and it will not quietly ignore it either — a dropped proportion means ` +
        'you are bound to a different deal from the one you priced. Use elective_bps: basis points of ' +
        'each role left as a promise rather than locked, so 4000 offers 60% secured and 40% on trust. ' +
        '(split means something else here — §3 reserves it for the division of proceeds.) Nothing was ' +
        'created.',
    );
  }
  return null;
}
