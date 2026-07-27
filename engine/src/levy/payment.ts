/**
 * Discharge. §5.2: payable **only in located goods physically delivered to a named
 * place**, and **a stated share of every assessment is non-escrowable — it must be
 * carried by a hand, not bought as a service.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE NON-ESCROWABLE SHARE IS THE WHOLE MECHANIC.** PROP-LV3 exists to attempt the
 * Coase collapse against it: three principals with hands near the delivery place run a
 * delivery service, everyone buys it, zero trust is risked, zero standing accrues, and
 * `LEVY SHORT` sits flat every night — the meter that exists to *rise* when the
 * population turtles.
 *
 * The defence is two buckets and one rule: **value delivered by anybody else's hand
 * can only ever fill the escrowable bucket.** No amount of purchased delivery touches
 * the non-escrowable one, so presence is not for sale at any price. That is enforced
 * here, in {@link creditFor}, and nowhere else — a second implementation of the split
 * is a second answer to "did this principal pay", which is A5′ waiting for a busy
 * night.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The other half of §5.2 that lives here is **R19**: *"the Levy is payable by a
 * standing intent, and its worst case is goods plus one public receipt."* An offline
 * principal sets `set_delivery_intent` once (one action) and every tick it runs after
 * that costs nothing (A3). So the delivery gate must be expressible as a predicate over
 * world state alone, with no live decision in it — which is what {@link deliveryFault}
 * is.
 */

import { inFreeze, isSettlementTick } from '../core/time.js';
import type { PrincipalId, SystemId } from '../core/types.js';
import { BPS_ONE, minor, qty, type Minor, type Qty } from '../core/units.js';
import { handsOf, isPresent, type HandRecord, type WorldState } from '../world/index.js';
import { LEVY_NON_ESCROWABLE_BPS } from './params.js';

/**
 * The share of an assessment that cannot be bought, in MINOR.
 *
 * Rounded **up**, so the un-purchasable part is never rounded away on a small
 * assessment. A newcomer at the nominal rate still has to show up, which is the point:
 * §13's minute-60 checklist has "one Levy paid" in it, and paying is how a first-hour
 * agent learns that presence is the scarce thing.
 */
export function nonEscrowableOf(assessment: Minor): Minor {
  if (assessment <= 0) return minor(0);
  const product = assessment * LEVY_NON_ESCROWABLE_BPS;
  if (!Number.isSafeInteger(product)) {
    throw new Error(`non-escrowable overflow: ${assessment} x ${LEVY_NON_ESCROWABLE_BPS}`);
  }
  return minor(Math.min(assessment, Math.ceil(product / BPS_ONE)));
}

/** What has been delivered against one assessment, split by whose hand carried it. */
export interface PaymentSplit {
  /** Delivered by the payer's own hand, present at the named place. Fills either bucket. */
  readonly paidOwn: Minor;
  /** Delivered by another principal's hand — a service. Fills the escrowable bucket only. */
  readonly paidOther: Minor;
}

/** What one assessment still owes, bucket by bucket. Pure; the only shortfall arithmetic. */
export interface Owing {
  readonly assessment: Minor;
  readonly nonEscrowable: Minor;
  readonly escrowable: Minor;
  /** Credited against the non-escrowable bucket. Only ever the payer's own hand. */
  readonly nonEscrowableFilled: Minor;
  readonly escrowableFilled: Minor;
  /** What a viewer and the agent are shown as `paid`. Never more than the assessment. */
  readonly paid: Minor;
  /** The non-escrowable part still owed. **Cannot be swept and cannot be bought.** */
  readonly presenceOwed: Minor;
  /** The escrowable part still owed. Sweepable at settlement. */
  readonly purchasableOwed: Minor;
  /** `presenceOwed + purchasableOwed`. What `LEVY SHORT` is the sum of. */
  readonly owed: Minor;
}

/**
 * Resolve one assessment against what was delivered.
 *
 * The order inside the payer's own bucket is **non-escrowable first**, and it is a
 * decision rather than an accident: filling the escrowable part first would leave a
 * principal that paid most of its assessment by hand still short on presence, and it
 * would have no way to tell from `paid` alone. Filling presence first means the number
 * an agent watches (`shortfall_if_unpaid`) falls monotonically as it delivers.
 */
export function owingOf(assessment: Minor, split: PaymentSplit): Owing {
  const nonEscrowable = nonEscrowableOf(assessment);
  const escrowable = minor(assessment - nonEscrowable);
  const own = Math.max(0, split.paidOwn);
  const other = Math.max(0, split.paidOther);

  const nonEscrowableFilled = minor(Math.min(nonEscrowable, own));
  const ownToEscrowable = own - nonEscrowableFilled;
  const escrowableFilled = minor(Math.min(escrowable, ownToEscrowable + other));

  const presenceOwed = minor(nonEscrowable - nonEscrowableFilled);
  const purchasableOwed = minor(escrowable - escrowableFilled);
  return {
    assessment,
    nonEscrowable,
    escrowable,
    nonEscrowableFilled,
    escrowableFilled,
    paid: minor(nonEscrowableFilled + escrowableFilled),
    presenceOwed,
    purchasableOwed,
    owed: minor(presenceOwed + purchasableOwed),
  };
}

/**
 * How much of an offered delivery can actually be credited.
 *
 * Refusing an over-delivery **at the door** rather than accepting and discarding the
 * excess is the honest behaviour: the goods are consumed by the delivery, so silently
 * taking more than the assessment needs would be the engine confiscating on a rounding
 * argument. A caller that offers more is told the exact figure to offer instead.
 */
export function creditFor(owing: Owing, offered: Minor, byOwnHand: boolean): Minor {
  if (offered <= 0) return minor(0);
  const room = byOwnHand ? owing.owed : owing.purchasableOwed;
  return minor(Math.min(offered, Math.max(0, room)));
}

/**
 * ★ What one principal may carry of **another's** assessment, and what carrying it costs.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **§5.2's OTHER HALF, WHICH NOTHING HAS EVER OFFERED.** The non-escrowable share is the
 * famous half of the sentence — *"it must be carried by a hand, not bought as a
 * service"* — and {@link creditFor} has enforced it since the Levy landed. The half
 * nobody read is what that leaves: **70% of every assessment IS escrowable, and §5.2
 * permits it to be carried by another principal's hand.** `deliver {payer}` implements
 * that in full, `paidOther` is one of the columns a shortfall event publishes, and no
 * affordance has ever offered it — so `paidOther` is **0 in every world this repo has
 * ever run.** A capability that exists and is never exercised is indistinguishable from
 * one that is missing.
 *
 * It matters because the residue this instrument was built to see is a **distribution**
 * failure before it is a production one. Measured on `g01` at Reckoning 7: three members
 * hold a WORKS on one MARCHES system, occupancy 3, each earning `floor(110/3) x 288 =
 * 10,368` against a 23,900 assessment — defaulting forever. In the same constellation
 * `orrin`, `sable` and `varrow` sit on **360,000 units of the same good.** The goods
 * exist; they are in somebody else's warehouse. This function is the arithmetic of moving
 * them, and `test/levy/aged-solvency.spec.ts` carries the measurement.
 *
 * ── WHY THE OFFER NETS THE DELIVERER'S **OWN** OUTSTANDING DUTY ─────────────
 *
 * Because that is the one mistake the engine can see coming, and A2 says known arithmetic
 * is exact. Paying your own Levy can never be an error — {@link Owing.owed} caps it. Paying
 * somebody *else's* out of the goods your own tribute needs converts one shortfall into two,
 * and it would do so from an affordance the agent was told was the safest available plan.
 *
 * So {@link Carryable.payable} is the surplus above `owing(self).owed`, not the whole
 * warehouse — an **exact published figure**, never a forecast. Anything forward-looking (next
 * Reckoning's duty, a war chest, a hull) is a judgement and belongs to whoever is playing:
 * the cast keeps `CAST_CARRY_RESERVE_RECKONINGS` for exactly that, and an agent gets every
 * component below to do its own arithmetic with.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Units: `LEVY_UNIT_MINOR` is 1, so a unit of the levy good discharges one MINOR and the
 * `Qty`/`Minor` mixing below is the identity rate the whole module already runs on
 * (`params.ts` argues for it — it deletes rounding between assessment and delivery).
 */
export interface Carryable {
  /**
   * The payer's escrowable remainder **after everything the payer can hand over itself** —
   * the only part another hand may ever usefully fill.
   *
   * ── WHY THE PAYER'S OWN REACH IS NETTED OUT, WHICH IS A MEASURED FIX ────────
   *
   * It was `owing(payer).purchasableOwed` flat, and that **raced the payer's own delivery.**
   * Actions resolve from snapshot T (§15.2: *"within-tick actions never react to another
   * within-tick action"*), so a payer paying its whole bill in the same tick a neighbour
   * carried part of it left whichever resolved second with no room and an `A14` refusal —
   * *"nothing of that delivery can be credited"*. `test/cast/heuristic.test.ts` caught it as
   * **six repeated `deliver A14` refusals**, and AGT-S3's rule is that a bot hitting one
   * refusal repeatedly means the affordance is wrong rather than the bot.
   *
   * It is also the better mechanic. §5.2's carry exists so goods can reach a principal that
   * **cannot produce or reach them**, and a payer standing at the delivery place with a full
   * warehouse is not that principal. Offering to carry for it wastes an action, spends goods
   * nobody needed spent, and — because the relief is real — quietly funds a member that could
   * have funded itself.
   */
  readonly escrowableOwed: Minor;
  /**
   * What the payer could hand over **right now**, and therefore what it is expected to.
   *
   * Zero when the payer has no hand standing at its delivery place, because then its stock is
   * unreachable this tick however large it is — a payer rich in goods and absent in body is
   * exactly the case a carry should still serve.
   */
  readonly payerReach: Minor;
  /**
   * The payer's non-escrowable remainder. **No other hand may fill it, at any price.**
   * Published on the offer rather than omitted, because an offer that quietly clipped
   * itself to 70% would read as the engine short-crediting the delivery.
   */
  readonly presenceOwed: Minor;
  /** Unpledged, deliverable units of the levy good the DELIVERER holds. */
  readonly available: Qty;
  /** What the deliverer still owes on its **own** assessment this Reckoning. */
  readonly ownOwed: Minor;
  /** `available - ownOwed`, floored at zero. Stock the deliverer's own tribute does not need. */
  readonly surplus: Qty;
  /** `min(escrowableOwed, surplus)`. What a carry would actually hand over. */
  readonly payable: Minor;
}

/**
 * Resolve a carry offer. Pure; the only arithmetic for "how much of theirs can I take on".
 *
 * One home, three readers — the affordance in `api/observe.ts`, the heuristic cast's
 * `carryFor`, and the tests. A menu that computed its own answer would be a second reply to
 * *"how much may I carry"*, which is scar #1 with a Levy shortfall attached.
 */
export function carryableOf(args: {
  /** The PAYER's outstanding position — whose duty is being discharged. */
  readonly payerOwing: Owing;
  /** The DELIVERER's outstanding position on its own assessment. */
  readonly ownOwing: Owing;
  /** The DELIVERER's unpledged levy good. */
  readonly available: Qty;
  /**
   * What the PAYER could hand over itself right now — its unpledged levy good if one of its
   * own hands is standing at the delivery place, and **zero if none is.**
   *
   * The caller owns that predicate because it is the world's ({@link carrierAt}); this file owns
   * what to do with the number. See {@link Carryable.escrowableOwed} for why it is netted.
   */
  readonly payerReach: Minor;
}): Carryable {
  const payerReach = minor(Math.max(0, args.payerReach));
  // What is left of the payer's ESCROWABLE bucket once everything it can reach is credited to it.
  //
  // The payer's own hand fills **presence first** ({@link owingOf}, and that order is itself a
  // decision argued there), so of `payerReach` only the part above `presenceOwed` ever reaches the
  // escrowable bucket. Stated as arithmetic over the two remainders already on `Owing` rather than
  // by re-deriving a split: re-labelling the payer's existing `paidOther` as `paidOwn` would let a
  // purchased credit fill presence, which is the one thing §5.2 forbids it to do.
  const reachToEscrowable = Math.max(0, payerReach - args.payerOwing.presenceOwed);
  const escrowableOwed = minor(Math.max(0, args.payerOwing.purchasableOwed - reachToEscrowable));
  const ownOwed = minor(Math.max(0, args.ownOwing.owed));
  const surplus = qty(Math.max(0, args.available - ownOwed));
  return {
    escrowableOwed,
    payerReach,
    presenceOwed: minor(Math.max(0, args.payerOwing.presenceOwed)),
    available: args.available,
    ownOwed,
    surplus,
    payable: minor(Math.min(escrowableOwed, surplus)),
  };
}

/**
 * One carry offer as `observe` and the cast both read it: a {@link Carryable} with the two
 * facts that say *whose* and *where*, plus the engine's own refusal if there is one.
 *
 * `fault` is `null` **exactly** when `deliver {payer}` would be accepted, and it is
 * {@link deliveryFault}'s sentence rather than a paraphrase — the same string the verb would
 * return. Two spellings of one refusal is how an affordance list starts offering acts the
 * engine declines.
 */
export interface LevyCarryQuote extends Carryable {
  /** The principal whose assessment this would discharge. */
  readonly payer: PrincipalId;
  /** Where it is payable: the PAYER's plan's delivery place, never the deliverer's. */
  readonly place: SystemId;
  readonly fault: string | null;
}

/** A hand that could discharge a tribute right now: this principal's, present, at the place. */
export function carrierAt(
  world: WorldState,
  principal: PrincipalId,
  place: SystemId,
  tick: number,
): HandRecord | null {
  const present = handsOf(world, principal)
    .filter((hand) => isPresent(hand, tick) && hand.location === place)
    .sort((a, b) => a.ordinal - b.ordinal);
  return present[0] ?? null;
}

/**
 * Is a hand of this principal on its way to the named place?
 *
 * The tribute line's SOLID state, and nothing else reads it. Deliberately generous —
 * a hand *at* the place counts as much as one in transit to it — because the line's
 * job is to say "this one is being dealt with", and a hand standing on the delivery
 * berth is the strongest possible version of that.
 */
export function carriageUnderway(
  world: WorldState,
  principal: PrincipalId,
  place: SystemId,
  tick: number,
): boolean {
  for (const hand of handsOf(world, principal)) {
    if (hand.destination === place) return true;
    if (isPresent(hand, tick) && hand.location === place) return true;
  }
  return false;
}

/**
 * Why this delivery cannot happen, as a sentence, or `null` if it can.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE FREEZE REFUSES A DELIVERY, AND THAT IS NOT A CONVENIENCE.**
 *
 * §5.1's freeze is hard: *"no new commitments, no book clears, no raid resolution, no
 * grant spend, no hazard against any object in the settlement set"*, and the Reckoning
 * driver compares the payer's free balance between the freeze and the settlement and
 * **halts on any difference in either direction**. A delivery inside the freeze moves a
 * figure the venture settlement was computed from, so accepting one would pause a world
 * on a tick where nothing was actually wrong — a self-inflicted halt on the one tick
 * that has an audience (A14).
 *
 * The cost to an agent is nothing: the assessment is minted at phase 0 and the freeze is
 * phase 286, so there are 286 ticks in which to deliver. The refusal says so.
 * ══════════════════════════════════════════════════════════════════════════
 */
export function deliveryFault(args: {
  readonly world: WorldState;
  readonly payer: PrincipalId;
  readonly deliverer: PrincipalId;
  readonly place: SystemId;
  readonly tick: number;
  readonly owing: Owing;
  readonly available: number;
}): string | null {
  if (inFreeze(args.tick) || isSettlementTick(args.tick)) {
    return (
      'the freeze is on, so nothing may move against a settling obligation until the Reckoning has run. ' +
      'A Levy assessment is open from the first tick of its Reckoning; deliver before the freeze.'
    );
  }
  if (args.owing.assessment <= 0) {
    return 'you hold no Levy assessment this Reckoning, so there is nothing to deliver against.';
  }
  const room = args.deliverer === args.payer ? args.owing.owed : args.owing.purchasableOwed;
  if (room <= 0) {
    return args.deliverer === args.payer
      ? 'this assessment is already discharged in full.'
      : `${args.payer}'s assessment has ${String(args.owing.presenceOwed)} left that only its own hand can ` +
          'carry: a stated share of every Levy is non-escrowable and cannot be bought as a service.';
  }
  if (carrierAt(args.world, args.deliverer, args.place, args.tick) === null) {
    return (
      `a Levy is paid in goods physically delivered, so one of your hands has to be standing at ` +
      `${args.place}. Move a hand there — or set a delivery intent, which fires the moment one arrives.`
    );
  }
  if (args.available <= 0) {
    return (
      `you hold none of the levy good to deliver. The Levy is payable only in goods, never in currency ` +
      `and never as a service.`
    );
  }
  return null;
}
