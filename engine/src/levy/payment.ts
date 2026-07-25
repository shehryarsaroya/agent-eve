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
import { BPS_ONE, minor, type Minor } from '../core/units.js';
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
