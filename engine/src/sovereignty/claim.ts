/**
 * The gates. **Every refusal in sovereignty lives here, and none of them throws.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **NOTHING HERE CAN HALT THE WORLD ON AN AGENT'S INPUT.** Every function in this file
 * returns a {@link Rejection} or `null`. Three agent-triggerable halts have shipped in this
 * repo, and the mechanic below has the largest blast radius of anything an agent can reach:
 * a bad refusal costs one action, a bad throw stops a Reckoning that has an audience (A14).
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## Two gates, two moods, and the split is the collapse arc
 *
 * {@link claimRejection} answers *"may I raise an anchor here?"* — and the answer depends on
 * whether the system is unclaimed (ordinary), for sale (a rescue or a fire sale), or
 * `CONTESTED` inside the published window (a takeover). One verb, three stories, and the
 * refusal names which one is available so an agent never has to guess.
 *
 * {@link chargeDeliveryFault} answers *"may I hand these goods over?"* — and it is where the
 * two enforcements `DRAFT-2-synthesis.md` §2 makes conditions of the goods Charge live:
 * **locality** (the goods must already be standing at the claimed system) and **presence**
 * (a hand must be standing there). Consumption is `settle.ts`/the runtime's half: the goods
 * are destroyed, never parked.
 *
 * ## Why any principal's hand may pay a Charge
 *
 * The Levy's non-escrowable share must be carried by the payer's *own* hand, and that is
 * the anti-Coase-collapse mechanism for a mechanic about presence. The Charge is a mechanic
 * about **supply**, and the critique is explicit that the two are different claims:
 *
 * > Keep a goods Charge only if its claim is *"the world must physically supply this
 * > system"*, not *"the sovereign personally hauls it."* Trade necessarily lets the claimant
 * > outsource logistics.
 *
 * So a hauler's hand discharges a Charge in full. That is not a leak — it is the haulage
 * market, and it is also the rescue: somebody else paying your Charge is a story, and a rule
 * that forbade it would delete the best ending the arc has.
 */

import { inFreeze, isSettlementTick } from '../core/time.js';
import type { PrincipalId, SystemId } from '../core/types.js';
import type { Qty } from '../core/units.js';
import { handsOf, isPresent, type HandRecord, type WorldState } from '../world/index.js';
import { holdingOf } from '../world/state.js';
import { tierOf, type WorldMap } from '../world/map.js';
import { reject, type Rejection } from '../world/result.js';
import { bondCoversOneMore, bondNeededForOneMore, postedBondOf, type BondRead } from './bond.js';
import type { Book, ClaimRecord } from './book.js';
import { inVulnerabilityWindow, vulnerabilityViewAt } from './cycle.js';
import {
  ANCHOR_QTY,
  ARREARS_STATEMENT,
  CHARGE_GOOD,
  CLAIM_BOND_MINOR,
  SOVEREIGNTY_STATEMENT,
} from './params.js';

/** How a `build` on this system would land, if it landed at all. */
export type ClaimRoute = 'VIRGIN' | 'CESSION' | 'TAKEOVER';

/**
 * A hand of this principal standing at a place right now.
 *
 * `payment.ts:carrierAt`'s twin rather than a call into it: that one is the Levy's and takes
 * the Levy's delivery place, and sharing it would tie two mechanics' presence rules
 * together so that a change to one silently changed the other. The predicate is three lines
 * and the coupling would be permanent.
 */
export function handAt(
  world: WorldState,
  principal: PrincipalId,
  system: SystemId,
  tick: number,
): HandRecord | null {
  const present = handsOf(world, principal)
    .filter((hand) => isPresent(hand, tick) && hand.location === system)
    .sort((a, b) => a.ordinal - b.ordinal);
  return present[0] ?? null;
}

/**
 * Which of the three stories a `build` on this system would be, or `null` if none is open.
 *
 * Pure over `(book, system, tick)`, so the affordance layer, the observation and the gate all
 * answer it from one function — and an agent that reads `route: 'TAKEOVER'` in its
 * observation is reading the same decision the handler will make (scar #5 for a branch).
 */
export function claimRouteFor(book: Book, system: SystemId, tick: number): ClaimRoute | null {
  const live = book.liveAt(system);
  if (live === null) return 'VIRGIN';
  if (book.cessionAt(system) !== null) return 'CESSION';
  if (live.state === 'CONTESTED' && inVulnerabilityWindow(tick)) return 'TAKEOVER';
  return null;
}

/**
 * May this principal raise an anchor on this system?
 *
 * The order is the honesty: refuse on the world's rules first (tier, body, freeze), then on
 * the incumbent's rights, then on the price. Nothing has moved when any of these fire.
 */
export function claimRejection(args: {
  readonly book: Book;
  readonly map: WorldMap;
  readonly world: WorldState;
  readonly principal: PrincipalId;
  readonly system: SystemId;
  readonly tick: number;
  /** Unpledged units of {@link CHARGE_GOOD} standing at `system` in the actor's stores. */
  readonly anchorAvailable: Qty;
  readonly bondRead: BondRead;
  /**
   * Currency this principal may spend on a cession price.
   *
   * **Earnings, never the §12.5 endowment** (D7): the caller passes `freeCash`, which is the
   * free balance above `ENDOWMENT_FLOOR_MINOR`. A cession is the only principal-to-principal
   * transfer in sovereignty — the anchor and the Charge are destroyed, the bond is locked in
   * the buyer's own stores — so it is the only place the endowment could leave a principal,
   * and `ledger/endowment.ts` says it may not. `vBuild`'s own block carries the measurement.
   */
  readonly freeMinor: number;
}): Rejection | null {
  const { book, map, world, principal, system, tick } = args;

  if (map.systems.get(system) === undefined) {
    return reject('A2', `there is no system ${system}. ${SOVEREIGNTY_STATEMENT}`);
  }
  const tier = tierOf(map, system);
  if (tier === 'COMMONS') {
    return reject(
      'A8',
      `${system} is a COMMONS system and a claim there is INVALID, not refused: nothing in the Commons can be ` +
        'fought over, so there is nothing for a claim to mean. A8 is a permanent floor, not a prize. Claim a ' +
        'MARCHES or FRONTIER system — `graduate` moves your holding out, and the claim goes where your body is.',
    );
  }
  if (world.holdingByPrincipal.get(principal) === undefined) {
    return reject('A2', `${principal} has no holding, so it has no body to anchor a claim with.`);
  }
  const holding = holdingOf(world, principal);
  if (holding.system !== system) {
    return reject(
      'A2',
      `your holding stands at ${holding.system}, not at ${system}. A claim is anchored by your BODY: move it ` +
        'with `graduate` (one lane outward at a time) and then raise the anchor. This is what stops a claim ' +
        'being a thing you buy from a distance.',
    );
  }
  if (holding.state === 'FALLEN') {
    return reject(
      'INV-8',
      `your holding ${holding.id} fell at Reckoning ${String(holding.fellAtReckoning)}; a ruin cannot anchor a ` +
        'claim. It has to be rebuilt first.',
    );
  }
  if (inFreeze(tick) || isSettlementTick(tick)) {
    return reject(
      'A14',
      'the freeze is on, so no claim changes hands and no anchor rises until the Reckoning has run. §5.1 ' +
        're-reads every payer balance between the freeze and the settlement and halts on any difference, and ' +
        'an anchor moves both goods and currency. The next Reckoning opens in a tick or two.',
    );
  }

  const route = claimRouteFor(book, system, tick);
  const live = book.liveAt(system);
  if (route === null && live !== null) {
    return reject('A2', cannotTakeYet(book, live, tick));
  }
  if (live !== null && live.claimant === principal) {
    return reject(
      'A2',
      `you already hold the claim on ${system} (${live.state}). \`build\` does not top it up and it is not how ` +
        'a Charge is paid — `deliver` {"obligation":"CHARGE","system":"' +
        `${system}"} is. ${ARREARS_STATEMENT}`,
    );
  }

  // ── The price, checked before a unit of it moves (A15, §6.3) ──────────────
  if (args.anchorAvailable < ANCHOR_QTY) {
    return reject(
      'A15',
      `raising an anchor destroys ${String(ANCHOR_QTY)} units of ${CHARGE_GOOD} that are ALREADY STANDING at ` +
        `${system}. You have ${String(args.anchorAvailable)} unpledged there. Goods somewhere else do not ` +
        'count: an anchor is produced material put into a place, which is why this gate cannot be paid in ' +
        'currency and cannot be paid by enrolling a second identity (A15).',
    );
  }
  if (!bondCoversOneMore(book, principal, args.bondRead)) {
    const posted = postedBondOf(book, principal, args.bondRead);
    const needed = bondNeededForOneMore(book, principal);
    return reject(
      'A15',
      `a claim requires a posted BOND of ${String(CLAIM_BOND_MINOR)} and you hold ${String(book.claimsOf(principal).length)} ` +
        `claim(s), so one more needs ${String(needed)} posted continuously. You have ${String(posted)} posted. ` +
        `Post the difference with \`post_bond\` {"amount":${String(needed - posted)}}. A bond is slashable ` +
        'capital locked in your own stores, not a deposit — you keep it unless a claim of yours LAPSES, and ' +
        'then it is taken.',
    );
  }
  if (route === 'CESSION') {
    const offer = book.cessionAt(system);
    if (offer !== null && args.freeMinor < offer.price) {
      return reject(
        'A15',
        `${offer.by} is asking ${String(offer.price)} for the claim on ${system} and you have ` +
          `${String(args.freeMinor)} you can spend on it. That figure is your EARNINGS: locked stores do not ` +
          'count, and neither does the starter stake the world gave you — a cession price leaves you and goes ' +
          'to another principal, and the endowment funds your own work only (it can buy no claim, fund no bid ' +
          'and be sold to nobody). Earn it by hauling, trading or completing ventures. Taking it also makes you ' +
          'the claimant ' +
          `of record on its arrears: this claim is ${live?.state ?? 'SUPPLIED'} with ` +
          `${String(book.missesAt(system))} consecutive miss(es), and a transfer never resets that count.`,
      );
    }
  }
  return null;
}

/** Why a claimed system is not available right now, with the clock that would make it so. */
function cannotTakeYet(book: Book, live: ClaimRecord, tick: number): string {
  const window = vulnerabilityViewAt(tick);
  if (live.state !== 'CONTESTED') {
    return (
      `${live.system} is claimed by ${live.claimant} and its claim is ${live.state}. A claim can only be taken ` +
      'from a holder that the world has already recorded short TWICE — that is the CONTESTED state — and only ' +
      `inside the published vulnerability window (phases ${String(window.first_phase)}–${String(window.last_phase)} ` +
      'of a Reckoning). Until then the only way in is a cession the holder publishes itself: watch the feed for ' +
      '`sovereignty.cession.offered`. Nobody can take a supplied claim at any price, so a claimant that pays is ' +
      'safe by rule and not by luck.'
    );
  }
  return (
    `${live.system}'s claim is CONTESTED, so it CAN be taken — but not now. The vulnerability window opens at ` +
    `tick ${String(window.opens_tick)} (in ${String(window.ticks_until_open)} ticks) and runs to phase ` +
    `${String(window.last_phase)}. Be standing there with the anchor goods and a posted bond when it opens. ` +
    'A14: the clock is published so a defender can read it too.'
  );
}

/**
 * Why this Charge delivery cannot happen, as a sentence, or `null` if it can.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **LOCALITY AND PRESENCE ARE BOTH CHECKED HERE, AND THEY ARE DIFFERENT CHECKS.**
 *
 * `DRAFT-2-synthesis.md` §2 conditions the goods Charge on three enforcements. Two are
 * here: the goods must be **standing at the claimed system** (`available` is computed from
 * lots located there — the caller's `chargeGoodAt`, never the location-blind
 * `levyGoodAvailable`), and a **hand must be standing there** to hand them over. The third,
 * consumption, is the runtime's: the lots are destroyed into `sink:consumption`, never
 * relocated and never parked, so the same stockpile cannot pay two Reckonings.
 *
 * The critic's numeric exploit — *"store 1,000,000 rations in the core, park one hand at the
 * frontier, pay a 10,000 Charge, the whole lot relocates and 990,000 appears behind the
 * blockade"* — is closed by the first check: nothing relocates, so nothing can teleport.
 * ══════════════════════════════════════════════════════════════════════════
 */
export function chargeDeliveryFault(args: {
  readonly world: WorldState;
  readonly deliverer: PrincipalId;
  readonly claim: ClaimRecord;
  readonly tick: number;
  readonly owed: Qty;
  /** Unpledged units of {@link CHARGE_GOOD} standing **at the claimed system**. */
  readonly available: Qty;
}): string | null {
  if (inFreeze(args.tick) || isSettlementTick(args.tick)) {
    return (
      'the freeze is on, so nothing may move against a settling obligation until the Reckoning has run. A ' +
      'Charge is open from the first tick of its Reckoning — there are 286 ticks to deliver in, and the ' +
      'refusal is here rather than a halt because §5.1 re-reads the balances the settlement was computed from.'
    );
  }
  if (args.claim.state === 'LAPSED' || args.claim.state === 'CEDED') {
    return `the claim on ${args.claim.system} has already ${args.claim.state === 'LAPSED' ? 'lapsed' : 'been ceded'}; there is nothing left to supply.`;
  }
  if (args.owed <= 0) {
    return (
      `the Charge on ${args.claim.system} is discharged in full this Reckoning. Nothing more is creditable, and ` +
      'goods handed over now would be destroyed for nothing.'
    );
  }
  if (handAt(args.world, args.deliverer, args.claim.system, args.tick) === null) {
    return (
      `a Charge is paid in goods physically handed over, so one of YOUR hands has to be standing at ` +
      `${args.claim.system}. Move a hand there. Any principal's hand may pay any claim's Charge — the rule is ` +
      'that the world must supply the system, not that its holder personally hauls — so hiring a carrier is a ' +
      'legitimate answer, and so is somebody rescuing a claim that is not theirs.'
    );
  }
  if (args.available <= 0) {
    return (
      `you hold no unpledged ${CHARGE_GOOD} standing at ${args.claim.system}. The Charge is payable ONLY in ` +
      'goods that are already there: stock somewhere else cannot be spent here, and it cannot be paid in ' +
      'currency at any price. Pledged lots are excluded — the same goods must never back two obligations.'
    );
  }
  return null;
}

/**
 * Why this cession cannot be published, or `null`.
 *
 * Deliberately permissive about *when*: a claimant may put a claim up for sale while it is
 * `SUPPLIED`, which is an ordinary land sale, and the fire sale is the same act under
 * pressure. A rule that only allowed selling under duress would make publishing an offer an
 * admission, and an admission nobody makes is a mechanic nobody uses.
 */
export function cessionRejection(args: {
  readonly book: Book;
  readonly principal: PrincipalId;
  readonly system: SystemId;
  readonly price: number | null;
  readonly tick: number;
}): Rejection | null {
  const live = args.book.liveAt(args.system);
  if (live === null) {
    return reject(
      'A2',
      `there is no live claim on ${args.system} to cede. \`publish_offer\` with a \`cede\` field offers YOUR ` +
        'claim for sale; without one it publishes an ordinary offer line.',
    );
  }
  if (live.claimant !== args.principal) {
    return reject(
      'A2',
      `the claim on ${args.system} belongs to ${live.claimant}, not to you. You cannot offer someone else's ` +
        'territory. If it is CONTESTED you can take it inside the vulnerability window with `build`.',
    );
  }
  if (args.price === null || args.price < 0 || !Number.isSafeInteger(args.price)) {
    return reject(
      'A2',
      'a cession needs an asking price in whole minor units: {"cede":"' +
        `${args.system}","price":N}. Zero is allowed and means "take it off my hands" — which is a real move ` +
        'when the alternative is a lapse that slashes your bond.',
    );
  }
  if (inFreeze(args.tick) || isSettlementTick(args.tick)) {
    return reject(
      'A14',
      'the freeze is on. An offer published now could be taken inside the settlement window, which moves two ' +
        'principals\' currency after §5.1 froze the figures the Reckoning was computed from.',
    );
  }
  return null;
}

/** Why this claim cannot be abandoned, or `null`. */
export function abandonRejection(args: {
  readonly book: Book;
  readonly principal: PrincipalId;
  readonly system: SystemId;
  readonly tick: number;
}): Rejection | null {
  const live = args.book.liveAt(args.system);
  if (live === null) {
    return reject('A2', `there is no live claim on ${args.system} to abandon.`);
  }
  if (live.claimant !== args.principal) {
    return reject('A2', `the claim on ${args.system} belongs to ${live.claimant}, not to you.`);
  }
  if (inFreeze(args.tick) || isSettlementTick(args.tick)) {
    return reject(
      'A14',
      'the freeze is on, so a claim cannot be given up until the Reckoning has run — the salvage moves currency ' +
        'and §5.1 has already frozen the figures tonight\'s settlement was computed from. Abandon earlier in ' +
        'the cycle; the arrears you are escaping are settled at the end of it.',
    );
  }
  return null;
}
