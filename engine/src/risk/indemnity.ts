/**
 * The INDEMNITY — RSK4, RSK5, SOL2, and §7.4's *"pay, partial pay, restructure, or default"*.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ## The three things this file is for
 *
 * **1. Correlated claims.** One FRONT strikes one SWATH and *every* COVER over goods in that swath
 * falls due together, off one cause event. CAT1 is explicit that this is the whole reason a risk
 * market exists — *"independent per-asset loss dice would make diversification trivial and
 * reinsurance cosmetic"* — and CAT10 CUTS the alternative by name. So the cohort is built in one
 * pass from one event and shares one `causeEventId`, which is also what makes every default in it
 * attributable (INV-17).
 *
 * **2. The decision.** §7.4's MUST-5 calls it *"the signature betrayal"*. It is already
 * representable: `Election = Minor | IN_FULL` gives **pay in full · pay a part · pay nothing**, which
 * is exactly the pass's `pay_claim | pay_partial | default_claim`. So this layer spends no verb and
 * invents no fourth shape — `elect` decides an INDEMNITY the same way it decides a venture role.
 *
 * > **A note on "restructure".** The pass lists `propose_restructure` as a fifth option. It is not
 * > implemented and the reason is A5′ rather than budget: a restructure that *moves the due date*
 * > lets a payer convert a default into a delay, and §15.3 already fixes what happens when an
 * > obligation cannot resolve in time — *"it DEFERS to the next Reckoning; it never defaults"*. A
 * > partial payment with the remainder carried as an outstanding balance **is** the restructure, and
 * > it is the one shape that cannot be used to launder a refusal. RSK5's own text agrees: *"a
 * > recovery offer neither delays the deadline nor reduces severity unless accepted beforehand."*
 *
 * **3. Propagation.** A cession's INDEMNITY settles **before** the primary's (descending depth), and
 * if the cession defaults **the primary still owes its payee every unit**. RE1: *"the primary remains
 * liable if the reinsurer defaults unless the policy contains a disclosed cut-through endorsement"* —
 * and there is no cut-through here, deliberately, because cut-through is the clause that *stops*
 * contagion and contagion is what we are trying to observe.
 *
 * So the primary, having been let down, chooses again: pay from its own free balance, or default in
 * turn. **That second choice is the propagation**, and it is a choice rather than a formula, which is
 * what makes it A6-shaped drama instead of a cascade equation.
 *
 * ## ★ THE FALSE-DEFAULT SURFACE, WHICH IS LARGER HERE THAN ANYWHERE ELSE
 *
 * §15.4 calls the false default *"the top engineering risk"* and a risk market is where it bites
 * hardest, because a correlated event resolves many promises at once off one number. Six defences,
 * five of them §15.4's and one that only exists in this layer:
 *
 *   1. **The hard freeze.** Every INDEMNITY is opened at landfall and settled inside the frozen
 *      settlement set. Nothing recomputes a loss at settlement time.
 *   2. **`acted_on_state_version` compared at settlement** — {@link guardIndemnity}, halting.
 *   3. **The valuation is pinned in `terms_hash`.** The single most important one here: after a
 *      front, the destroyed good is scarce and its spot price spikes. Valuing the loss at the
 *      post-event mark would inflate every INDEMNITY past the limit its payer agreed to and make the
 *      payer short *through a price move it did not cause*. {@link openIndemnity} takes the mark off
 *      `cover.valuation` and there is no other source.
 *   4. **An escrowed shortfall is a recorded LOSS, structurally.** {@link escrowShortIsNeverDefault}
 *      is a literal `false`, copied from `cargoLost.ts`'s `isDefault: false` for the same reason:
 *      *"INV-17 and A5′ make a fabricated default the worst bug this system can have."*
 *   5. **The deferral bound writes `unattributed`, never a default.** §15.3: an obligation still
 *      unresolved at the round limit defers, and *"a truncated cascade recording a breach is an
 *      engine-fabricated default, and a rival can construct one deliberately."*
 *   6. ★ **Exclusive insurable interest** (`cover.ts`'s header). Two COVERS over one holding would
 *      make Σ indemnity exceed the real loss with every individual settlement arithmetically
 *      correct — a false default that none of the five above can see, because there is no race and
 *      no stale read. It is refused at bind.
 *
 * And **attribution follows the chain**: when a primary defaults because its reinsurer defaulted
 * first, the `causeEventId` on its default row is *the reinsurer's default event*, not the front's.
 * §15.4's Mode B asks that *"each one carries the event ID of the loss or the missed delivery that
 * caused it"*, and for a propagated failure the missed delivery is the one upstream.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { EventId, GoodId, GrantId, PrincipalId } from '../core/types.js';
import { BPS_ONE, addMinor, minor, subMinor, type Minor, type Qty } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import { payByPriority, type Claim } from '../ledger/waterfall.js';
import type { AccountId } from '../core/types.js';
import type { Ledger } from '../ledger/ledger.js';
import { storesAccount } from '../ledger/accounts.js';
import { IN_FULL, type DefaultCause, type Election } from '../venture/settlement.js';
import { COVER_DEDUCTIBLE_BPS } from './params.js';
import {
  electiveOutstanding,
  escrowedOutstanding,
  recordCoverPaid,
  type CoverId,
  type CoverRecord,
} from './cover.js';
import type { FrontId } from './front.js';

export type IndemnityId = string & { readonly __brand: 'IndemnityId' };

/**
 * `OPEN → DUE → PAID | PART_PAID | DEFAULTED | DEFERRED`.
 *
 * `PART_PAID` is a terminal state that is **not** a default: the payer paid something and refused
 * nothing it had elected. It carries an outstanding balance and it is what a restructure looks like
 * in a world where the due date cannot move (see the header). A `PART_PAID` row that later goes
 * unpaid becomes `DEFAULTED` on the pass that resolves it, never retroactively.
 */
export type IndemnityState = 'OPEN' | 'DUE' | 'PAID' | 'PART_PAID' | 'DEFAULTED' | 'DEFERRED';

export interface IndemnityRecord {
  readonly id: IndemnityId;
  readonly cover: CoverId;
  /** The event family. Every INDEMNITY off one FRONT shares it — that is the correlation. */
  readonly front: FrontId;
  readonly payer: PrincipalId;
  readonly payee: PrincipalId;
  /** What was lost, **at the mark pinned in `terms_hash`**. Never a post-event price. */
  readonly grossLoss: Minor;
  /** CAT4's skin in the game, taken off the loss before the limit applies. */
  readonly deductible: Minor;
  /** `min(limit, grossLoss − deductible)`. What the COVER actually owes. */
  readonly covered: Minor;
  readonly escrowedDue: Minor;
  readonly electiveDue: Minor;
  escrowedPaid: Minor;
  electivePaid: Minor;
  readonly openedTick: number;
  readonly dueTick: number;
  /**
   * INV-17's attributable cause. The FRONT's strike event for a primary; **the upstream default
   * event** for a layer that was let down by the one above it. Never null.
   */
  causeEventId: EventId;
  /** 1 for a primary; deeper for a cession. Settlement runs in *descending* order of this. */
  readonly depth: number;
  state: IndemnityState;
  deferrals: number;
  readonly boundByGrant: GrantId | null;
  readonly actedBy: PrincipalId | null;
}

export class IndemnityError extends Error {}
export class IndemnityHalt extends Error {}

/**
 * ★ An escrowed shortfall on an INDEMNITY is a **recorded loss**, never a default.
 *
 * A literal type rather than a runtime flag, exactly as `ledger/cargoLost.ts` does it, and for the
 * identical reason. The concrete scenario: the escrow was funded at offer time and the front then
 * struck; the money is there, so this should be unreachable — and that is why it is expressed as a
 * constant that the compiler will not let anybody widen. If it ever *is* short, the honest record is
 * a loss with a cause, and the world halts on {@link guardIndemnity} rather than libelling a payer.
 */
export const escrowShortIsNeverDefault = false as const;

export function indemnityId(front: FrontId, cover: CoverId): IndemnityId {
  return `indemnity:${front}:${cover}` as IndemnityId;
}

// ── Opening the cohort (RSK4) ───────────────────────────────────────────────

/** What a FRONT took from one payee, in one good, at one system. */
export interface StruckInterest {
  readonly payee: PrincipalId;
  readonly good: GoodId;
  readonly qtyLost: Qty;
}

/**
 * The pinned unit price of `good` on a COVER's own valuation.
 *
 * Throws rather than defaulting to zero. A missing mark means the cover was bound over a good its
 * valuation never priced, and silently valuing that loss at zero would pay a struck payee nothing
 * while its cover reads as honoured — scar #1 with money.
 */
export function pinnedMark(cover: CoverRecord, good: GoodId): Minor {
  for (const m of cover.valuation.marks) if (m.good === good) return m.unitPrice;
  throw new IndemnityError(
    `cover ${cover.id} has no pinned mark for ${good}; a loss cannot be valued at a price nobody agreed`,
  );
}

export interface OpenPrimaryInput {
  readonly cover: CoverRecord;
  readonly front: FrontId;
  readonly qtyLost: Qty;
  readonly good: GoodId;
  readonly tick: number;
  readonly dueTick: number;
  readonly causeEventId: EventId;
}

/**
 * Open a primary INDEMNITY: a FRONT took goods a COVER stood over.
 *
 * `RSK4`'s `indemnity` trigger — *"uses recorded pre-loss value/loss"*. The arithmetic is four
 * integer lines and every one of them is published, because A2's corollary is that *"a formula
 * nobody has written cannot satisfy A2"*:
 *
 * ```
 * grossLoss   = qtyLost × pinnedMark(good)
 * deductible  = grossLoss × COVER_DEDUCTIBLE_BPS / BPS_ONE      (truncated)
 * covered     = min(limit, grossLoss − deductible)
 * escrowedDue = min(covered, escrowed)   ·   electiveDue = covered − escrowedDue
 * ```
 *
 * The last line is the venture's own split (`settlement.ts:563`), and using it here is what makes
 * the escrowed half of a cover pay first and automatically without a second rule.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ## ★ A CONSEQUENCE OF THAT LAST LINE, FOUND BY THE ACCEPTANCE TEST AND KEPT
 *
 * **The elective half is the TOP slice, so a payer's promise is only tested by a LARGE loss.**
 * `escrowedDue = min(covered, escrowed)` means a loss smaller than the escrowed half is paid entirely
 * out of escrow and `electiveDue` is **zero** — no election, no default, no standing, nothing at risk.
 * The first run of `propagates.spec.ts` produced exactly that and reported *"somebody broke a promise:
 * expected 0 to be greater than 0"* over a cohort that had settled correctly.
 *
 * It is kept rather than changed, for two reasons:
 *
 *   1. **It is what RSK3 describes.** *"The policy deposit auto-pays, general reserve belongs to the
 *      estate, and **the balance** is an honor obligation."* The unsecured tail is the top layer in
 *      real insurance and in this pass.
 *   2. **The alternative is worse.** Splitting each loss pro-rata across the two halves would mean
 *      every trivial claim produced a small elective obligation, so the record would fill with tiny
 *      defaults and the signature moment would be indistinguishable from noise. §7.5 wants the
 *      elective part to *matter*, not to be everywhere.
 *
 * What it means for the design is worth stating plainly: **`elective_bps` is the payer's dial for how
 * exposed its word is.** At the floor (2,500) it is only tested by a near-total loss; at the ceiling
 * (7,500) almost any claim reaches it. That is a real strategic choice, it is published on the offer
 * as `escrow_ratio_bps` (§7.5), and it is the reason the band has two ends rather than one.
 * ══════════════════════════════════════════════════════════════════════════════
 */
export function openPrimary(input: OpenPrimaryInput): IndemnityRecord {
  const cover = input.cover;
  if (cover.payee === null) throw new IndemnityError(`cover ${cover.id} has no payee`);
  if (cover.over.kind !== 'GOODS') {
    throw new IndemnityError(`cover ${cover.id} is a cession; use openCession`);
  }
  const mark = pinnedMark(cover, input.good);
  const grossLoss = minor(input.qtyLost * mark);
  const deductible = minor(Math.trunc((grossLoss * COVER_DEDUCTIBLE_BPS) / BPS_ONE));
  const covered = minor(Math.max(0, Math.min(cover.limit, grossLoss - deductible)));
  const escrowedDue = minor(Math.min(covered, cover.escrowed));
  return {
    id: indemnityId(input.front, cover.id),
    cover: cover.id,
    front: input.front,
    payer: cover.payer,
    payee: cover.payee,
    grossLoss,
    deductible,
    covered,
    escrowedDue,
    electiveDue: subMinor(covered, escrowedDue),
    escrowedPaid: minor(0),
    electivePaid: minor(0),
    openedTick: input.tick,
    dueTick: input.dueTick,
    causeEventId: input.causeEventId,
    depth: cover.depth,
    state: 'OPEN',
    deferrals: 0,
    boundByGrant: cover.boundByGrant,
    actedBy: cover.actedBy,
  };
}

export interface OpenCessionInput {
  readonly cover: CoverRecord;
  /** The INDEMNITY of the COVER this one is written over. */
  readonly under: IndemnityRecord;
  readonly tick: number;
  readonly dueTick: number;
}

/**
 * Open a cession's INDEMNITY: the COVER below it owes, so this one owes too.
 *
 * RE1: *"the underlying adjudicated claim drives recovery automatically."* The gross loss is the
 * **whole** obligation of the layer below — `under.covered` — because that is what its payer is out
 * of pocket, and no deductible applies: a reinsurer's deductible is its attachment point, which is
 * RE3's XoL tower and not built here (see `params.ts` on what is deliberately absent).
 *
 * The cause event is the layer below's, not the front's, so a chain of defaults reads as a chain
 * rather than as N independent failures with one shared excuse.
 */
export function openCession(input: OpenCessionInput): IndemnityRecord {
  const cover = input.cover;
  if (cover.payee === null) throw new IndemnityError(`cover ${cover.id} has no payee`);
  if (cover.over.kind !== 'COVER') {
    throw new IndemnityError(`cover ${cover.id} is a primary; use openPrimary`);
  }
  if (cover.over.cover !== input.under.cover) {
    throw new IndemnityError(
      `cover ${cover.id} is written over ${cover.over.cover}, not ${input.under.cover}`,
    );
  }
  const grossLoss = input.under.covered;
  const covered = minor(Math.min(cover.limit, grossLoss));
  const escrowedDue = minor(Math.min(covered, cover.escrowed));
  return {
    id: indemnityId(input.under.front, cover.id),
    cover: cover.id,
    front: input.under.front,
    payer: cover.payer,
    payee: cover.payee,
    grossLoss,
    deductible: minor(0),
    covered,
    escrowedDue,
    electiveDue: subMinor(covered, escrowedDue),
    escrowedPaid: minor(0),
    electivePaid: minor(0),
    openedTick: input.tick,
    dueTick: input.dueTick,
    causeEventId: input.under.causeEventId,
    depth: cover.depth,
    state: 'OPEN',
    deferrals: 0,
    boundByGrant: cover.boundByGrant,
    actedBy: cover.actedBy,
  };
}

// ── Settlement ──────────────────────────────────────────────────────────────

export interface RiskDefault {
  readonly indemnity: IndemnityId;
  readonly cover: CoverId;
  readonly front: FrontId;
  readonly payer: PrincipalId;
  readonly payee: PrincipalId;
  readonly amount: Minor;
  readonly cause: DefaultCause;
  /** Never null. INV-17, and the chain's own link when the failure was propagated. */
  readonly causeEventId: EventId;
  readonly depth: number;
  readonly actedBy: PrincipalId | null;
  readonly boundByGrant: GrantId | null;
}

/** One kept promise, for RSK7's record. The mirror of {@link RiskDefault}, deliberately symmetric. */
export interface RiskHonoured {
  readonly indemnity: IndemnityId;
  readonly cover: CoverId;
  readonly front: FrontId;
  readonly payer: PrincipalId;
  readonly payee: PrincipalId;
  readonly electivePaid: Minor;
  readonly depth: number;
  readonly actedBy: PrincipalId | null;
  readonly boundByGrant: GrantId | null;
}

export interface SettleIndemnityInput {
  readonly indemnity: IndemnityRecord;
  readonly cover: CoverRecord;
  readonly tick: number;
  readonly eventId: EventId;
  /**
   * What the payer chose. **Absent pays nothing** (PROP-V4's rule, unchanged), and silence is a
   * default rather than an escape — §7.4's MUST-5: *"disconnecting is no escape."*
   */
  readonly election: Election | undefined;
  /** INV-19: the version the freeze hashed. See `SettleInput.actedOnStateVersion`'s warning. */
  readonly actedOnStateVersion: number;
  /** True when the cascade hit its round limit. Only then may a funding shortfall defer. */
  readonly truncated: boolean;
  /**
   * The event id of an upstream default that left this payer short, if there was one.
   *
   * This is the propagation, as attribution. When it is set, a resulting default cites the missed
   * delivery one layer out rather than the FRONT — which is what makes a contagion readable as a
   * chain (§15.4 Mode B).
   */
  readonly upstreamDefaultEventId: EventId | null;
}

export interface IndemnitySettlement {
  readonly indemnity: IndemnityId;
  readonly cover: CoverId;
  readonly front: FrontId;
  readonly payer: PrincipalId;
  readonly payee: PrincipalId;
  readonly escrowedPaid: Minor;
  readonly electivePaid: Minor;
  /** A recorded LOSS. Never a default — see {@link escrowShortIsNeverDefault}. */
  readonly escrowedShortfall: Minor;
  readonly electiveShortfall: Minor;
  /** Escrow left over once the INDEMNITY was met. Goes home to the payer. */
  readonly escrowReturned: Minor;
  readonly defaults: readonly RiskDefault[];
  readonly honoured: readonly RiskHonoured[];
  /** The deferral bound. An amount the engine refuses to attribute to anyone (A5′). */
  readonly unattributed: Minor;
  readonly state: IndemnityState;
  readonly line: string;
}

export const MAX_INDEMNITY_DEFERRALS = 2;

/**
 * §15.4's second defence, and §7.4's `terms_hash` comparison, in one guard.
 *
 * Halts rather than rejects. A mismatch here means the frozen settlement set and the live row
 * disagree, which is scar #6 — *"the resolver reading a state the players never acted on"* — and
 * §15.2's rule for that is unambiguous: **abort the tick and halt. Never publish a broken tick.**
 */
export function guardIndemnity(input: SettleIndemnityInput, liveTermsHash: string | null): void {
  const cover = input.cover;
  if (cover.actedOnStateVersion === null) {
    throw new IndemnityHalt(
      `INV-19: cover ${cover.id} settles with no pinned acted_on_state_version. A settlement whose ` +
        'inputs nobody can prove is a settlement that can fabricate a default (§15.4).',
    );
  }
  if (cover.actedOnStateVersion !== input.actedOnStateVersion) {
    throw new IndemnityHalt(
      `INV-19: cover ${cover.id} pinned state version ${String(cover.actedOnStateVersion)} but the ` +
        `freeze hashed ${String(input.actedOnStateVersion)}. The row was rewritten between the freeze ` +
        'and the settlement.',
    );
  }
  if (liveTermsHash !== null && cover.termsHash !== liveTermsHash) {
    throw new IndemnityHalt(
      `INV-19: cover ${cover.id} terms_hash is ${String(cover.termsHash)} and the freeze hashed ` +
        `${liveTermsHash}. The valuation or the limit moved under a bound promise (§15.4).`,
    );
  }
  if (input.indemnity.cover !== cover.id) {
    throw new IndemnityHalt(
      `indemnity ${input.indemnity.id} names cover ${input.indemnity.cover}, not ${cover.id}`,
    );
  }
}

/**
 * How much of the elective half the payer asked to pay.
 *
 * `IN_FULL` means *the whole thing, whatever it turns out to be* — the same escape hatch
 * `settlement.ts:IN_FULL` documents, and it exists here for a sharper version of the same reason: a
 * payer cannot know its `electiveDue` when it elects, because the loss has not been valued yet at the
 * tick it is offered the affordance. Forcing it to guess a number would turn an over-performing
 * front into a `DECLINED` default against a payer that refused nothing.
 */
export function wantedOf(indemnity: IndemnityRecord, election: Election | undefined): Minor {
  if (election === undefined) return minor(0);
  if (election === IN_FULL) return indemnity.electiveDue;
  return minor(Math.max(0, Math.min(indemnity.electiveDue, election)));
}

/**
 * Settle one INDEMNITY. **Escrowed first, always; elective second, only if elected.**
 *
 * The order is A7 and it is not negotiable: the certain half executes without anybody's permission,
 * then the promise is kept or is not. Doing it the other way round would let a payer's refusal
 * shrink the guaranteed half, which is the one thing escrow buys.
 */
export function settleIndemnity(
  ledger: Ledger,
  input: SettleIndemnityInput,
  storesOf: (p: PrincipalId) => AccountId = storesAccount,
): IndemnitySettlement {
  const ind = input.indemnity;
  const cover = input.cover;
  guardIndemnity(input, null);

  const payeeStores = storesOf(ind.payee);
  const payerStores = storesOf(ind.payer);

  // ── 1. The escrowed half executes. ────────────────────────────────────────
  const escrowedWanted = minor(Math.min(escrowedOutstanding(cover), subMinor(ind.escrowedDue, ind.escrowedPaid)));
  let escrowedPaidNow = minor(0);
  if (escrowedWanted > 0) {
    const available = ledger.freeBalance(cover.escrow);
    const claims: readonly Claim[] = [
      { account: payeeStores, priority: 0, amount: escrowedWanted, key: `${ind.id}:escrowed` },
    ];
    // Through the waterfall rather than a bare `min`, so `assertPayoutsExact` runs — INV-6 — and a
    // future second claimant on one escrow inherits seniority instead of a race.
    const result = payByPriority(minor(Math.min(available, escrowedWanted)), claims);
    for (const p of result.payouts) {
      if (p.paid <= 0) continue;
      ledger.transferCurrency({
        eventId: `${input.eventId}#escrowed:${String(ind.escrowedPaid)}` as EventId,
        tick: input.tick,
        from: cover.escrow,
        to: p.account,
        amount: p.paid,
      });
      escrowedPaidNow = addMinor(escrowedPaidNow, p.paid);
    }
  }

  // ── 2. The elective half, if it was elected. ──────────────────────────────
  const wanted = wantedOf(ind, input.election);
  const remainingWant = subMinor(wanted, minor(Math.min(wanted, ind.electivePaid)));
  let electivePaidNow = minor(0);
  if (remainingWant > 0) {
    const free = ledger.freeBalance(payerStores);
    const pay = minor(Math.min(remainingWant, Math.max(0, free)));
    if (pay > 0) {
      ledger.transferCurrency({
        eventId: `${input.eventId}#elective:${String(ind.electivePaid)}` as EventId,
        tick: input.tick,
        from: payerStores,
        to: payeeStores,
        amount: pay,
      });
      electivePaidNow = pay;
    }
  }

  ind.escrowedPaid = addMinor(ind.escrowedPaid, escrowedPaidNow);
  ind.electivePaid = addMinor(ind.electivePaid, electivePaidNow);
  recordCoverPaid(cover, escrowedPaidNow, electivePaidNow);

  const escrowedShortfall = subMinor(ind.escrowedDue, ind.escrowedPaid);
  const electiveShortfall = subMinor(ind.electiveDue, ind.electivePaid);

  // ── 3. Attribute, or refuse to. ───────────────────────────────────────────
  //
  // The shape is `venture/settlement.ts:finaliseVenture`'s, line for line, because the rule is the
  // same rule and two spellings of it would drift: what the payer DECLINED is a choice and defaults
  // now; what it could not FUND may defer, but only when the cascade was truncated, and at the
  // deferral bound it becomes `unattributed` rather than a default.
  const declined = subMinor(ind.electiveDue, wanted);
  const unfunded = minor(Math.max(0, wanted - ind.electivePaid));
  const canDefer =
    declined === 0 && unfunded > 0 && input.truncated && ind.deferrals < MAX_INDEMNITY_DEFERRALS;

  const defaults: RiskDefault[] = [];
  const honoured: RiskHonoured[] = [];
  let unattributed = minor(0);

  if (!canDefer && electiveShortfall > 0) {
    const atBound = declined === 0 && input.truncated && ind.deferrals >= MAX_INDEMNITY_DEFERRALS;
    if (atBound) {
      unattributed = electiveShortfall;
    } else {
      defaults.push({
        indemnity: ind.id,
        cover: cover.id,
        front: ind.front,
        payer: ind.payer,
        payee: ind.payee,
        amount: electiveShortfall,
        cause: declined > 0 ? 'DECLINED' : 'UNFUNDED',
        // ★ The chain's own link. An upstream default is the missed delivery that caused this one,
        // and citing the FRONT instead would report a propagated failure as an independent one.
        causeEventId: input.upstreamDefaultEventId ?? ind.causeEventId,
        depth: ind.depth,
        actedBy: ind.actedBy,
        boundByGrant: ind.boundByGrant,
      });
    }
  } else if (!canDefer && ind.electiveDue > 0) {
    honoured.push({
      indemnity: ind.id,
      cover: cover.id,
      front: ind.front,
      payer: ind.payer,
      payee: ind.payee,
      electivePaid: ind.electivePaid,
      depth: ind.depth,
      actedBy: ind.actedBy,
      boundByGrant: ind.boundByGrant,
    });
  }

  // ── 4. The escrow goes home if the INDEMNITY did not need it all. ─────────
  let escrowReturned = minor(0);
  if (!canDefer) {
    const left = ledger.freeBalance(cover.escrow);
    if (left > 0) {
      ledger.transferCurrency({
        eventId: `${input.eventId}#escrow-return` as EventId,
        tick: input.tick,
        from: cover.escrow,
        to: payerStores,
        amount: left,
      });
      escrowReturned = left;
    }
  }

  const state: IndemnityState = canDefer
    ? 'DEFERRED'
    : defaults.length > 0
      ? 'DEFAULTED'
      : electiveShortfall > 0 || escrowedShortfall > 0
        ? 'PART_PAID'
        : 'PAID';
  ind.state = state;
  if (canDefer) ind.deferrals += 1;

  return {
    indemnity: ind.id,
    cover: cover.id,
    front: ind.front,
    payer: ind.payer,
    payee: ind.payee,
    escrowedPaid: ind.escrowedPaid,
    electivePaid: ind.electivePaid,
    escrowedShortfall,
    electiveShortfall,
    escrowReturned,
    defaults: Object.freeze(defaults),
    honoured: Object.freeze(honoured),
    unattributed,
    state,
    line: indemnityLine(ind, state),
  };
}

/** ≤140 characters by construction, so it can be a `reason` on the ticker (§11.1). */
export function indemnityLine(ind: IndemnityRecord, state: IndemnityState): string {
  const verb =
    state === 'PAID'
      ? 'paid'
      : state === 'PART_PAID'
        ? 'part-paid'
        : state === 'DEFAULTED'
          ? 'DEFAULTED on'
          : state === 'DEFERRED'
            ? 'deferred'
            : 'owes';
  return `${ind.payer} ${verb} ${String(ind.covered)} to ${ind.payee} — layer ${String(ind.depth)}`.slice(
    0,
    140,
  );
}

// ── The arithmetic, as an assertion (§7.4's property tests) ──────────────────

/**
 * `covered === escrowedDue + electiveDue`, `paid + shortfall === due` on both halves, and
 * `covered ≤ grossLoss`. Every one is a §7.4 property test, and they are asserted rather than hoped.
 *
 * The last one is CAT6's conservation clause: *"indemnity across layers stays at/below actual
 * loss."* A payout larger than the loss makes being struck profitable and turns the whole layer into
 * a currency faucet (§10.2 holds exactly two, and this is not one of them).
 */
export function assertIndemnityExact(ind: IndemnityRecord): void {
  if (addMinor(ind.escrowedDue, ind.electiveDue) !== ind.covered) {
    throw new IndemnityHalt(
      `INV-R6: indemnity ${ind.id} splits ${String(ind.escrowedDue)}+${String(ind.electiveDue)} against ` +
        `covered ${String(ind.covered)}`,
    );
  }
  if (ind.covered > ind.grossLoss) {
    throw new IndemnityHalt(
      `INV-R6: indemnity ${ind.id} covers ${String(ind.covered)} against a loss of ` +
        `${String(ind.grossLoss)}. Total recovery may never exceed the loss (CAT6).`,
    );
  }
  if (ind.escrowedPaid > ind.escrowedDue || ind.electivePaid > ind.electiveDue) {
    throw new IndemnityHalt(
      `INV-R6: indemnity ${ind.id} paid past its due: ${String(ind.escrowedPaid)}/` +
        `${String(ind.electivePaid)} against ${String(ind.escrowedDue)}/${String(ind.electiveDue)}`,
    );
  }
  if (ind.escrowedPaid < 0 || ind.electivePaid < 0) {
    throw new IndemnityHalt(`INV-R6: indemnity ${ind.id} paid a negative amount`);
  }
}

/** Settlement order: **descending depth**, then id. SOL2's phased clearing, as a comparator. */
export function settlementOrder(a: IndemnityRecord, b: IndemnityRecord): number {
  return b.depth - a.depth || compareIds(a.id, b.id);
}

/** Still owed, both halves. What `observe.obligations_due` publishes (RSK5). */
export function outstandingOf(ind: IndemnityRecord): Minor {
  return addMinor(subMinor(ind.escrowedDue, ind.escrowedPaid), subMinor(ind.electiveDue, ind.electivePaid));
}

/** What a payer would have to find to honour this in full, from its own stores. */
export function electiveOwed(ind: IndemnityRecord): Minor {
  return subMinor(ind.electiveDue, ind.electivePaid);
}

/** The cover's remaining promise, for the affordance's `max_contingent_liability`. */
export function contingentOf(cover: CoverRecord): Minor {
  return electiveOutstanding(cover);
}
