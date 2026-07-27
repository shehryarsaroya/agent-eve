/**
 * **THE PIXEL SIGNATURE (A13), AND THE FUEL GAUGE THAT WAS KILLED IN REVIEW.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Draft 1 proposed a public gauge reading *"Reckonings of Charge remaining"*. It was
 * rejected as a **scouting oracle**, and the record of why is worth carrying here rather
 * than only in the design folder, because this is the file where it would come back:
 *
 * > The gauge is computed from the public recipe plus the hidden stockpile, so it leaks
 * > reserve coverage, the limiting good, and — when it jumps — inbound convoy contents. I
 * > even wrote the exploit down approvingly ("attack the one at 1").
 *
 * The replacement is **public legal state only**: `PAID` · `ARREARS 1 of 2` ·
 * `NEXT MISS LAPSES`, plus the amount due, the deadline, and the bond at risk. Every one of
 * those five is either the world's own published verdict about a claim or a number the rules
 * fixed in advance:
 *
 * | field | where it comes from | what it could leak |
 * |---|---|---|
 * | `state` / `legend` | how many Charges the record already published as short | nothing — it *is* the published record |
 * | `due` | `chargeOf(tier, misses)` allocated by a public ballot | nothing — a stranger can compute it |
 * | `deadline_tick` | the clock | nothing |
 * | `bond_at_risk` | the published per-claim requirement, capped at what is posted | posted bond is `PUBLIC` by §6.4 ("public, and any amount") |
 * | `paid` / `owed` | goods **already destroyed** into a sink | a completed public act (A5) |
 *
 * **`paid` is the one that had to be argued.** It is a running total of goods the claimant
 * has handed over *this Reckoning*, which is a fact about the past and not about the
 * warehouse: it tells a reader what was spent, never what is left. The gauge's sin was
 * publishing a function of the *remaining* stock; `paid` is a function of the *destroyed*
 * stock, and the difference is the whole §11.2 boundary. A field named
 * `reckonings_of_cover`, or anything else that divides a stockpile by a recipe, does not
 * belong in this file and `frames/projection.ts` will refuse it.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The observation half is the `projectedDrown` pattern (High Water's, shipped here as a
 * standing requirement): `if_you_do_nothing` names the state the claim moves to and what
 * that costs, **before** the deadline. A5′ makes that mandatory rather than nice: a claimant
 * that was never shown what it owed must never be recorded in arrears for not paying it.
 */

import { reckoningIndex, ticksUntilReckoning } from '../core/time.js';
import type { PrincipalId, SystemId, ZoneTier } from '../core/types.js';
import { minor, qty, type Minor, type Qty } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import type { ClaimLine } from '../frames/contract.js';
import { bondAtRiskFor, postedBondOf, requiredBondOf, type BondRead } from './bond.js';
import type { Book, CessionOffer, ClaimRecord, ClaimState } from './book.js';
import { chargeOf } from './charge.js';
import { claimRouteFor, type ClaimRoute } from './claim.js';
import { vulnerabilityViewAt, type VulnerabilityView } from './cycle.js';
import { CHARGE_GOOD, CHARGE_MISSES_TO_LAPSE, MAX_CLAIM_LINES } from './params.js';

/**
 * The arrears steps before a lapse. Two, given three misses to lapse.
 *
 * Derived rather than written as `2`, so the legend and the threshold can never disagree:
 * raising {@link CHARGE_MISSES_TO_LAPSE} changes both, and a hard-coded `2` would leave the
 * label saying "1 of 2" while the third miss no longer lapsed. That is scar #1's shape in a
 * string a viewer reads.
 */
export const ARREARS_STEPS = CHARGE_MISSES_TO_LAPSE - 1;

/**
 * The label, and it is a rules surface: it is what a viewer believes and what an agent reads.
 *
 * `PAID` · `ARREARS 1 of 2` · `ARREARS 2 of 2 · NEXT MISS LAPSES` — the three the corrected
 * design names, plus the two terminal ones a viewer is owed the difference between (a lapse
 * is the world taking the claim; a cession is the holder letting go and salvaging).
 */
export function claimLegend(state: ClaimState, misses: number): string {
  switch (state) {
    case 'SUPPLIED':
      return 'PAID';
    case 'STRAINED':
      return `ARREARS ${String(Math.max(1, misses))} of ${String(ARREARS_STEPS)}`;
    case 'CONTESTED':
      return `ARREARS ${String(Math.max(2, misses))} of ${String(ARREARS_STEPS)} · NEXT MISS LAPSES`;
    case 'LAPSED':
      return 'LAPSED · BOND SLASHED';
    case 'CEDED':
      return 'CEDED';
  }
}

/** What happens to this claim at the Reckoning if nothing more is delivered. */
export type ClaimDoNothing = 'STAYS_SUPPLIED' | 'ENTERS_ARREARS' | 'BECOMES_CONTESTABLE' | 'LAPSES';

/**
 * The state a claim moves to at settlement if nothing else is delivered, and it is exact.
 *
 * A pure function of `(owed, misses)` and **the same arithmetic settlement runs**, which is
 * what makes the prediction testable rather than decorative: PROP-O5's test is "take no
 * action, advance to the next Reckoning, assert the stated consequence is what occurred", and
 * that only works if this function and `settleCharge` cannot disagree.
 */
export function claimDoNothing(owed: Qty, misses: number): ClaimDoNothing {
  if (owed <= 0) return 'STAYS_SUPPLIED';
  const next = misses + 1;
  if (next >= CHARGE_MISSES_TO_LAPSE) return 'LAPSES';
  if (next >= 2) return 'BECOMES_CONTESTABLE';
  return 'ENTERS_ARREARS';
}

/**
 * One claim as `observe` shows it.
 *
 * Snake_case, because these field names reach an agent and `agent.md` publishes them — the
 * observation's own convention, and a rules surface (hard rule 4).
 */
export interface ClaimView {
  readonly claim: string;
  readonly system: SystemId;
  readonly tier: ZoneTier;
  readonly claimant: PrincipalId;
  readonly state: ClaimState;
  /** The pixel signature's own words. What a viewer sees, so an agent sees it too (A9). */
  readonly legend: string;
  readonly arrears: number;
  readonly arrears_of: number;
  readonly good: typeof CHARGE_GOOD;
  /** This Reckoning's Charge, as the ballot allocated it. Zero before the assessment. */
  readonly due: Qty;
  readonly paid: Qty;
  readonly owed: Qty;
  /** The rule-fixed amount, before the vote moved it. Published so the vote is legible. */
  readonly rule_qty: Qty;
  /** True iff the constellation voted to spare this claimant. */
  readonly spared: boolean;
  readonly deadline_tick: number;
  readonly ticks_left: number;
  /** Unpledged units of the Charge good standing **at this system**, in the reader's stores. */
  readonly available_here: Qty;
  /**
   * Does the READER have a hand standing here right now?
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE ACCEPTANCE TEST FOUND THIS FIELD MISSING, AND WHAT WAS MISSING WAS THE HAND.**
   * `graduate` moves a HOLDING; it does not move hands, so a principal that crossed, posted a
   * bond and raised an anchor has its body and its goods at the claimed system and all three
   * of its hands still standing where it enrolled. `chargeDeliveryFault` refuses the delivery
   * for exactly the right reason — a Charge is goods physically handed over — and the
   * affordance layer offered it anyway. Measured: the `deliver` affordance was copied verbatim
   * from the observation and came back *"one of YOUR hands has to be standing at sys-05"*,
   * which is an act the engine refuses costing an agent a real action (AGT-S2).
   *
   * So presence is published as state, and the affordance is withheld with a counted reason
   * that names `move`. Both halves: `graduate`'s note is that a choice which is legal but
   * never offered never happens, and its mirror is that an offer the engine refuses teaches
   * an agent the document is wrong.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly hand_here: boolean;
  readonly bond_at_risk: Minor;
  /** What settlement does if nothing more is delivered. The `projectedDrown` pattern. */
  readonly if_you_do_nothing: ClaimDoNothing;
  /** One sentence rendering of the line above. Never the source of truth. */
  readonly consequence: string;
  /** The rule-fixed Charge next Reckoning, including the arrears surcharge if it applies. */
  readonly next_charge: Qty;
  readonly vulnerability: VulnerabilityView;
  /** Non-null while this claim is up for sale. `PUBLIC`: the fire sale is the story. */
  readonly cession: { readonly by: PrincipalId; readonly price: Minor } | null;
  /** How a `build` here would land right now, for a reader that does not hold the claim. */
  readonly route: ClaimRoute | null;
  /**
   * The rent this claim takes, in bps of everything extracted here by anybody else.
   *
   * Off the claim record, not off the constant: the rate a claim was raised under is the rate it
   * keeps, so a reader deciding whether to build here is reading the rate it will actually pay.
   */
  readonly rent_bps: number;
  /** Units of the raw good this claim has collected **this Reckoning**. A completed public act. */
  readonly rent_taken: Qty;
  /** Live WORKS here held by somebody other than the claimant — the set that pays rent. */
  readonly tenants: number;
  /** What the rent is worth to this claim per tick at today's tenancy. Arithmetic, published. */
  readonly rent_per_tick: Qty;
}

/**
 * What a claim is COLLECTING, read out of the WORKS book.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **INJECTED, BECAUSE SOVEREIGNTY MUST NOT IMPORT THE PRODUCTION BOOK.** The rent is a fact
 * about extraction and the arithmetic lives in `works/rent.ts`; what belongs to sovereignty is
 * the *term* (`ClaimRecord.rentBps`) and the fact that a landlord is owed something. A direct
 * import here would make the claim view untestable without a works book and would put the
 * dependency the wrong way round — `works/produce.ts` already takes the claim terms through a
 * port for the mirror-image reason.
 *
 * Every field is on the public side of §11.2 and each was checked against the rejected fuel
 * gauge: `taken` is goods the world has **already handed over**, one completed act per tick, the
 * same argument `worksLines.extracted` and `claimLines.owed` are admitted on. `tenants` counts
 * structures each raised by a `PUBLIC` event. `perTick` is a tier yield divided by a public
 * occupancy and multiplied by a published rate — arithmetic any stranger can already do, which
 * A2 requires be exact. **None of them is a function of what anybody still holds.**
 * ══════════════════════════════════════════════════════════════════════════
 */
export interface RentRead {
  /** Units collected at this system in the CURRENT Reckoning. Never a stock reading. */
  readonly taken: Qty;
  /** Live WORKS here held by somebody other than the claimant. The set that pays. */
  readonly tenants: number;
  /** What the claim takes per tick at today's tenancy and crowding. */
  readonly perTick: Qty;
}

export interface ClaimViewPort {
  readonly book: Book;
  readonly tick: number;
  readonly tierOf: (system: SystemId) => ZoneTier;
  /** Unpledged Charge-good units standing at a system, in one principal's stores. */
  readonly availableAt: (principal: PrincipalId, system: SystemId) => Qty;
  /** Is one of this principal's hands standing there? `claim.ts:handAt`, injected. */
  readonly handAt: (principal: PrincipalId, system: SystemId) => boolean;
  /** What the claim on a system is collecting from the WORKS standing on it. */
  readonly rentAt: (system: SystemId, claimant: PrincipalId) => RentRead;
  readonly bondRead: BondRead;
}

/**
 * Every claim this principal holds, priced, with its deadline and its consequence.
 *
 * `reader` is who is *looking*, which is why `available_here` is computed for the reader
 * rather than for the claimant: a rescuer reading a strained claim needs to know what **it**
 * can hand over, and telling it the claimant's stock would be publishing a stockpile.
 */
export function claimViewsFor(
  port: ClaimViewPort,
  reader: PrincipalId,
  claims: readonly ClaimRecord[],
): readonly ClaimView[] {
  // From the clock module, never counted here: two homes for "which Reckoning is this"
  // would let the observation price a Charge from a different cycle than settlement bills.
  const reckoning = reckoningIndex(port.tick);
  return [...claims]
    .sort((a, b) => compareIds(a.system, b.system))
    .map((claim) => claimView(port, reader, claim, reckoning));
}

function claimView(
  port: ClaimViewPort,
  reader: PrincipalId,
  claim: ClaimRecord,
  reckoning: number,
): ClaimView {
  const { book } = port;
  const owing = book.owingOf(reckoning, claim.system);
  const found = book.lineFor(reckoning, claim.system);
  const misses = book.missesAt(claim.system);
  const tier = port.tierOf(claim.system);
  const ticksLeft = ticksUntilReckoning(port.tick);
  const doNothing = claimDoNothing(owing.owed, misses);
  const bondAtRisk = bondAtRiskFor(book, claim.claimant, port.bondRead);
  const offer = book.cessionAt(claim.system);
  // Computed for the CLAIMANT, not for the reader: unlike `available_here`, the rent is a
  // property of the claim rather than of whoever is looking at it. A rescuer needs to know what
  // the territory earns its holder — that is exactly the number that says whether the claim is
  // worth saving — and it is public either way.
  const rent = port.rentAt(claim.system, claim.claimant);

  return {
    claim: claim.id,
    system: claim.system,
    tier,
    claimant: claim.claimant,
    state: claim.state,
    legend: claimLegend(claim.state, misses),
    arrears: misses,
    arrears_of: ARREARS_STEPS,
    good: CHARGE_GOOD,
    due: owing.assessment,
    paid: owing.paid,
    owed: owing.owed,
    rule_qty: found?.line.ruleQty ?? chargeOf({ tier, misses }),
    spared: found?.line.spared ?? false,
    deadline_tick: port.tick + ticksLeft - 1,
    ticks_left: ticksLeft,
    available_here: port.availableAt(reader, claim.system),
    hand_here: port.handAt(reader, claim.system),
    bond_at_risk: bondAtRisk,
    if_you_do_nothing: doNothing,
    consequence: describeDoNothing(doNothing, claim.system, owing.owed, bondAtRisk),
    // The surcharge applies to the misses the claim will carry AFTER tonight, which is the
    // number an agent needs to plan a convoy — quoting today's surcharge would understate
    // next Reckoning's bill for a claim that is about to go into arrears.
    next_charge: chargeOf({ tier, misses: doNothing === 'STAYS_SUPPLIED' ? 0 : misses + 1 }),
    vulnerability: vulnerabilityViewAt(port.tick),
    cession: offer === null ? null : { by: offer.by, price: offer.price },
    route: claim.claimant === reader ? null : claimRouteFor(book, claim.system, port.tick),
    rent_bps: claim.rentBps,
    rent_taken: rent.taken,
    tenants: rent.tenants,
    rent_per_tick: rent.perTick,
  };
}

/**
 * The prose. Templated from the structured verdict, so it can never say something the
 * structured field does not — `briefing.ts`'s rule, and the reason `if_you_do_nothing` is a
 * union rather than a sentence.
 */
export function describeDoNothing(
  kind: ClaimDoNothing,
  system: SystemId,
  owed: Qty,
  bondAtRisk: Minor,
): string {
  switch (kind) {
    case 'STAYS_SUPPLIED':
      return `${system}'s Charge is discharged; the claim stays SUPPLIED and the arrears count stays at zero.`;
    case 'ENTERS_ARREARS':
      return (
        `${String(owed)} of ${CHARGE_GOOD} short on ${system}: at the Reckoning the claim goes into public ` +
        `ARREARS 1 of ${String(ARREARS_STEPS)} and next Reckoning's Charge carries a surcharge. Nothing is ` +
        'taken from you tonight.'
      );
    case 'BECOMES_CONTESTABLE':
      return (
        `${String(owed)} of ${CHARGE_GOOD} short on ${system}: at the Reckoning the claim becomes CONTESTED, ` +
        'and from then on ANY principal standing there may take it from you inside the published vulnerability ' +
        `window. One more miss after that LAPSES it and slashes ${String(bondAtRisk)} of your bond.`
      );
    case 'LAPSES':
      return (
        `${String(owed)} of ${CHARGE_GOOD} short on ${system} and this is the ` +
        `${String(CHARGE_MISSES_TO_LAPSE)}rd consecutive miss: at the Reckoning the claim LAPSES and ` +
        `${String(bondAtRisk)} of your bond is SLASHED. Deliver, sell it with \`publish_offer\`, or give it up ` +
        'with `abandon` and keep part of the bond — all three are better than this.'
      );
  }
}

/** A principal's bond position, for the observation's `holding` block. */
export interface BondView {
  readonly posted: Minor;
  readonly required: Minor;
  readonly claims: number;
  /** Negative when the bond no longer covers the claims held. Published, never hidden. */
  readonly headroom: Minor;
}

export function bondViewFor(book: Book, principal: PrincipalId, read: BondRead): BondView {
  const posted = postedBondOf(book, principal, read);
  const required = requiredBondOf(book, principal);
  return {
    posted,
    required,
    claims: book.claimsOf(principal).length,
    headroom: minor(posted - required),
  };
}

/**
 * The frame's claim lines. **Public legal state only.**
 *
 * A claim tints a system (A13's own words) and the legend sits on it. Sorted by amount owed
 * descending so a truncated frame drops discharged hairlines rather than the claim that is
 * about to fall — and the cap is a declared bound (INV-26, scar #3), not a legibility budget.
 *
 * Every field here is in the table at the top of this file. There is deliberately no
 * quantity on this line that is a function of anything the claimant still holds.
 */
export function claimLinesFor(args: {
  readonly book: Book;
  readonly reckoning: number;
  readonly tick: number;
  readonly tierOf: (system: SystemId) => ZoneTier;
  /**
   * What each claim is collecting. **Required, not optional, and that is deliberate.**
   *
   * A13: a territory layer with no income on it is invisible — the map would show the same tint
   * for a claim earning nothing and a claim earning more than its Charge, which are the two
   * opposite stories the field exists to tell apart. An optional port defaulting to zero would
   * render "nothing collected" forever and the panel would look correct while reporting nothing,
   * which is the failure `the-production-chain.spec.ts` caught on the `unrefined` meter.
   */
  readonly rentAt: (system: SystemId, claimant: PrincipalId) => RentRead;
  readonly bondRead: BondRead;
}): readonly ClaimLine[] {
  const lines: ClaimLine[] = [];
  for (const claim of args.book.claimsInOrder()) {
    const misses = args.book.missesAt(claim.system);
    const owing = args.book.owingOf(args.reckoning, claim.system);
    const settled = args.book.shortfallOf(args.reckoning, claim.system);
    const rent = args.rentAt(claim.system, claim.claimant);
    lines.push({
      claim: claim.id,
      system: claim.system,
      claimant: claim.claimant,
      state: claim.state,
      legend: claimLegend(claim.state, settled?.misses ?? misses),
      arrears: settled?.misses ?? misses,
      arrearsOf: ARREARS_STEPS,
      due: owing.assessment,
      owed: owing.owed,
      deadlineTick: args.tick + ticksUntilReckoning(args.tick) - 1,
      bondAtRisk: bondAtRiskFor(args.book, claim.claimant, args.bondRead),
      slashed: settled?.slashed ?? minor(0),
      forSale: args.book.cessionAt(claim.system)?.price ?? null,
      contestable: claimRouteFor(args.book, claim.system, args.tick) === 'TAKEOVER',
      rentBps: claim.rentBps,
      rentTaken: rent.taken,
      tenants: rent.tenants,
    });
  }
  return lines
    .sort((a, b) => b.owed - a.owed || compareIds(a.system, b.system))
    .slice(0, MAX_CLAIM_LINES);
}

/**
 * One ticker line per published sovereignty act. ≤140 characters by §11.1's cap.
 *
 * Deliberately the *legal* verb and the place, never a quantity of anybody's stores: the
 * ticker is the most-quoted surface in the game and a habit of putting stock figures in it
 * would reintroduce the gauge one line at a time.
 */
export function claimTickerLine(args: {
  readonly kind: 'TAKEN' | 'ARREARS' | 'CONTESTED' | 'LAPSED' | 'CEDED' | 'FOR_SALE' | 'RESCUED';
  readonly system: SystemId;
  readonly claimant: PrincipalId;
  readonly other: PrincipalId | null;
  readonly amount: number;
}): string {
  const line = ((): string => {
    switch (args.kind) {
      case 'TAKEN':
        return `${args.claimant} raises an anchor at ${args.system}. The claim is held.`;
      case 'ARREARS':
        return `${args.system} is short ${String(args.amount)} of ${CHARGE_GOOD}. ARREARS 1 of ${String(ARREARS_STEPS)}.`;
      case 'CONTESTED':
        return `${args.system} misses again. CONTESTED — next miss lapses it, and the window is open.`;
      case 'LAPSED':
        return `${args.system} LAPSES. ${args.claimant} loses the claim and ${String(args.amount)} of bond.`;
      case 'CEDED':
        return `${args.claimant} gives up ${args.system}${args.other === null ? '' : ` to ${args.other}`}.`;
      case 'FOR_SALE':
        return `${args.claimant} puts ${args.system} up for ${String(args.amount)}.`;
      case 'RESCUED':
        return `${args.other ?? 'someone'} supplies ${args.system} for ${args.claimant}. The arrears clear.`;
    }
  })();
  return line.length <= 140 ? line : `${line.slice(0, 137)}...`;
}

/** A published cession offer, for the feed and the observation. */
export function cessionRowsFor(book: Book): readonly CessionOffer[] {
  return book.cessionsInOrder();
}

/** Zero, typed. Used where an assessment has not been minted yet. */
export const NO_CHARGE: Qty = qty(0);
