/**
 * `build {kind:"CAMPAIGN"}` — declaring a war, and every gate in front of it.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS IS A `kind` ON `build` AND NOT A VERB.**
 *
 * §17's rules budget is 40 verbs of 40, spent, and *"adding one means removing one"*. `refine
 * {kind:"ALLOY"}` and `build {kind:"WORKS"|"ANCHOR"|"HULL"}` are the two worked precedents, and this
 * is `build`'s fourth kind for a reason stronger than budget arithmetic: **a campaign is a durable
 * thing raised at a place out of committed capital**, which is exactly what the other three are.
 * `build {kind:"ANCHOR"}` requires your holding to stand at the system, destroys goods that are
 * already there, and locks a bond. This requires your holding to stand *one lane from* the system,
 * consumes goods that are already at your DEPOT, and locks a bond. They are the same shape aimed in
 * opposite directions — the anchor makes a claim exist and the campaign makes one stop existing.
 *
 * The five gates that are not obvious are numbered in the body. The one worth naming here is
 * **adjacency**, because it is what makes geography do work (§16.6 MUST-5): a campaign can only be
 * aimed at a system your body is already next to, so the map decides who can fight whom, and a
 * distant power cannot project force it has not walked.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## The two things this module deliberately does NOT check
 *
 * **1. It does not check that the defender can be beaten.** No hand count, no force comparison, no
 * "you will lose". §11.2 makes a principal's hands `SENSED` at their location and `PUBLIC` only as
 * motion; a gate that refused a hopeless campaign would answer *"how many hands does p:x have at
 * OPS-7 right now"* to anybody willing to spend an action, which is a manifest served through a
 * refusal. Scouting is the counterplay and it stays a real one — exactly as it is for `demand`.
 *
 * **2. It does not check that the attacker can afford five pulses of MATERIEL.** Only the first. A
 * campaign that runs out of supply STARVES, publicly, on a published clock, and that is the mechanic
 * rather than a failure of it: §16.6 MUST-5's whole claim is that *"supply lets a smaller defender
 * win by cutting a corridor"*, and a gate that required the whole war to be pre-funded would delete
 * the corridor along with the interdiction. What is checked is that the **first** pulse is stocked,
 * because a campaign declared with nothing at the depot would starve without ever pressing and the
 * bond would be forfeited for a war that never happened.
 */

import { phaseOfReckoning, reckoningIndex, TICKS_PER_RECKONING } from '../core/time.js';
import type { ClaimState, PrincipalId, SystemId, ZoneTier } from '../core/types.js';
import { minor, type Minor, type Qty } from '../core/units.js';
import { reject, type Rejection, type WorldResult } from '../world/result.js';
import { Book, campaignIdFor, type CampaignId, type CampaignRecord } from './book.js';
import {
  breachesToTake,
  CAMPAIGN_BOND_MINOR,
  CAMPAIGN_PULSE_PHASE,
  CAMPAIGN_STATEMENT,
  LAST_DECLARE_PHASE,
  MATERIEL_GOOD,
  MAX_LIVE_CAMPAIGNS,
  PULSE_MATERIEL_QTY,
  rebuffsToStand,
} from './params.js';

/**
 * Everything a declaration touches. Nothing else is reachable from here, which is the point.
 *
 * Narrow on purpose (`RefinePort`'s rule): the signature enumerates the operation's reach, so a
 * reviewer can see it reads the map, the claim book, a holding, one goods total and one balance, and
 * writes exactly one lock. Passing the whole `Runtime` would compile and would buy nothing.
 */
export interface DeclarePort {
  tierOf(system: SystemId): ZoneTier | null;
  /** Lane-adjacent systems, canonical order. The map's own answer, never a route. */
  neighboursOf(system: SystemId): readonly SystemId[];
  /** Where this principal's holding stands, or null. Its DEPOT, if the declaration lands. */
  holdingSystemOf(principal: PrincipalId): SystemId | null;
  /** True when the holding is FALLEN. A ruin declares no wars. */
  holdingIsRuin(principal: PrincipalId): boolean;
  /** The live claim on this system: who holds it and its public state, or null. */
  claimAt(system: SystemId): { readonly claimant: PrincipalId; readonly state: ClaimState } | null;
  /** Unpledged MATERIEL standing at `system` in this principal's stores. */
  materielAt(principal: PrincipalId, system: SystemId): Qty;
  /** Unencumbered currency in the principal's stores. What the bond has to come out of. */
  freeStoresOf(principal: PrincipalId): Minor;
  /**
   * Lock the bond, returning the encumbrance id, or `null` if it could not be locked.
   *
   * A port method rather than something the adapter does afterwards, so that this module owns the
   * **ordering**: lock, then write the row. Writing first would leave a declared war backed by
   * nothing — an attacker with no risk, A7's named failure, on the record as having posted one.
   */
  lockBond(args: {
    readonly campaign: CampaignId;
    readonly principal: PrincipalId;
    readonly amount: Minor;
    readonly tick: number;
  }): string | null;
}

/** What the caller has to name. One field, because everything else is derived from the map. */
export interface DeclareRequest {
  readonly attacker: PrincipalId;
  /** The claimed system. The DEPOT is wherever the attacker's holding already stands. */
  readonly objective: SystemId;
  readonly tick: number;
}

/**
 * **Every gate on a declaration, in one place, in published order.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE AFFORDANCE AND THE VERB CALL THIS SAME FUNCTION.** Not tidiness — the fix for this
 * project's signature defect in both directions at once. A verb whose gate lives in the handler
 * grows an affordance that offers illegal moves (AGT-S2: an offered act the engine then refuses
 * costs an agent a real action every wake); an affordance with its own copy of the gate grows a
 * mechanic that is legal and unreachable (nine of those shipped here, `grant` among them). One
 * predicate cannot drift from itself.
 * ══════════════════════════════════════════════════════════════════════════
 */
export function declareRefusal(port: DeclarePort, book: Book, req: DeclareRequest): Rejection | null {
  // 1. The map, first, because a refusal that named a price for a place that does not exist would
  //    be A2 half-kept.
  const tier = port.tierOf(req.objective);
  if (tier === null) {
    return reject('A2', `there is no system ${req.objective}, so nothing there can be campaigned against.`);
  }

  // 2. ── A8, AND IT IS CHECKED IN BOTH DIRECTIONS ────────────────────────────
  //
  //    §16.6 MUST-1 is the one item in the whole section written as an absolute: *"The Commons is
  //    absolutely unwardeccable … no declaration or Compact overrides it, no War Anchor or
  //    sovereignty structure can be placed there."* The OBJECTIVE half is redundant with the claim
  //    check below (a Commons claim cannot exist, `claim.ts` refuses it as INVALID) and is written
  //    anyway, because a floor held up by another module behaving well is not a floor. The DEPOT
  //    half is NOT redundant and is the one that matters: a depot inside the Commons would make the
  //    sanctuary a staging ground, which is the same defect as a shipyard in it (§9A refuses that by
  //    name). `CMP-1` then halts the world over either, so this is a caller behaving well and the
  //    invariant is the rule.
  if (tier === 'COMMONS') {
    return reject(
      'A8',
      `${req.objective} is a COMMONS system and a campaign against it is INVALID rather than refused: nothing ` +
        'in the Commons can be fought over, so there is no claim there for a campaign to take. Nothing you do ' +
        'will make it legal.',
    );
  }

  // 3. A body, and it is the DEPOT.
  const depot = port.holdingSystemOf(req.attacker);
  if (depot === null) {
    return reject('A2', `${req.attacker} has no holding, so it has no body to mount a campaign from.`);
  }
  if (port.holdingIsRuin(req.attacker)) {
    return reject(
      'INV-8',
      'your holding is a ruin and a ruin mounts no campaign. Rebuild it first — a campaign is supplied from ' +
        'where your body stands.',
    );
  }
  if (port.tierOf(depot) === 'COMMONS') {
    return reject(
      'A8',
      `your holding stands at ${depot}, which is in the COMMONS, and a campaign's DEPOT may never be there ` +
        '(§16.6 MUST-1): a sanctuary nobody may attack cannot also be an arsenal, or the floor becomes a ' +
        'fortress. `graduate` moves your holding one lane outward; then the depot is legal.',
    );
  }
  if (depot === req.objective) {
    return reject(
      'A2',
      `your holding stands at ${req.objective} itself, so there is no lane between your depot and your ` +
        'objective. A campaign is besieging the place next door, not the place you are standing in — if you ' +
        'are standing on a claimed system and want it, the route is `build` {"kind":"ANCHOR"} inside the ' +
        'vulnerability window, not a war.',
    );
  }

  // 4. ── ADJACENCY: THE GATE THAT MAKES GEOGRAPHY THE MECHANIC ───────────────
  //
  //    §16.6 MUST-3: a War Anchor must be *"linked by a supplied route to the objective"*, and
  //    MUST-5 makes supply *"a graph constraint"*. One lane is the strongest available version of
  //    that in a build where `haul` moves goods one lane at a time: the materiel has to arrive at a
  //    system the objective can see, so the defender knows exactly which corridor to cut and the
  //    attacker cannot besiege anything it has not walked to. A multi-lane route would need a
  //    throughput model and an interdiction verb, neither of which the budget admits.
  if (!port.neighboursOf(depot).includes(req.objective)) {
    return reject(
      'A2',
      `${req.objective} is not lane-adjacent to ${depot}, where your holding stands. A campaign is supplied ` +
        'from ONE LANE away: its MATERIEL must physically stand at your depot and be spent against the ' +
        'objective every Reckoning. Walk your holding closer with `graduate` (one lane at a time, outward ' +
        `only), or pick an objective you are already next to. Your neighbours: ${port.neighboursOf(depot).join(' · ')}.`,
    );
  }

  // 5. ── THE OBJECTIVE MUST BE A CLAIM WORTH TAKING, AND `CONTESTED` IS NOT ONE ──
  //
  //    `breachesToTake` returns null for CONTESTED, LAPSED and CEDED, and the refusal names the
  //    cheaper road in each case. A2 forbids handing an agent a solved game; it equally forbids
  //    letting it spend a bond on something the rules give away.
  const claim = port.claimAt(req.objective);
  if (claim === null) {
    return reject(
      'A2',
      `nobody holds ${req.objective}, so there is nothing there to take by force. A campaign takes a CLAIM ` +
        'from a claimant; an unclaimed system is taken with `build` {"kind":"ANCHOR"} for the price of the ' +
        'anchor goods and a bond. Move your holding there and raise one.',
    );
  }
  if (claim.claimant === req.attacker) {
    return reject(
      'A2',
      `you hold the claim on ${req.objective} yourself. A campaign against your own territory would be a ` +
        'faucet plus a bravery receipt (§9\'s related-party clause), and there is nothing it could take that ' +
        'you do not already have.',
    );
  }
  const needed = breachesToTake(claim.state);
  if (needed === null) {
    if (claim.state === 'CONTESTED') {
      return reject(
        'A2',
        `${req.objective}'s claim is already CONTESTED, which means the world has recorded it short twice and ` +
          'ANY principal standing there may take it inside the published vulnerability window by paying its ' +
          'arrears. A campaign would spend a bond and Reckonings of materiel to buy what the rules are about ' +
          'to hand out — so it is refused rather than offered. Stand at the system with the anchor goods and ' +
          'a posted bond and use `build` {"kind":"ANCHOR"} when the window opens.',
      );
    }
    return reject(
      'A2',
      `${req.objective}'s claim is ${claim.state} — it has already ended. There is nothing left for a ` +
        'campaign to take; the system is claimable by whoever stands there with an anchor.',
    );
  }

  // 6. §5.1: a declaration locks a bond, and the freeze re-reads every payer balance.
  const phase = phaseOfReckoning(req.tick);
  if (phase > LAST_DECLARE_PHASE) {
    const reopens = req.tick - phase + TICKS_PER_RECKONING;
    return reject(
      'A14',
      `the commitment window is open (phase ${String(phase)} of ${String(TICKS_PER_RECKONING)}), and a ` +
        'campaign locks a BOND — §5.1 re-reads every payer balance between the freeze and the settlement and ' +
        `halts on any difference. Declarations reopen at tick ${String(reopens)}. Nothing was spent.`,
    );
  }

  // 7. One live campaign per OBJECTIVE. Not per attacker and not per defender.
  //
  //    Per-objective is the principled unit: two campaigns against one claim would let the claim
  //    fall to breaches neither of them earned, and the SAP would draw two bands to one system,
  //    which is a heatmap rather than a legend (A13). Per-*attacker* would be a second limit on the
  //    same act that the bond already prices, and per-*defender* would let a friendly campaign be
  //    used as a shield — the reverse-Coase exploit `demand.ts` closes structurally.
  const live = book.liveAgainst(req.objective);
  if (live !== null) {
    return reject(
      'A2',
      `${req.objective} is already under campaign ${live.id} (${live.state}, ${String(live.breaches)}–` +
        `${String(live.rebuffs)}, next pulse tick ${String(live.firstPulseTick)}). One campaign per objective: ` +
        'two at once would take a claim on breaches neither of them earned. You may take a side in that one ' +
        'instead — send join with {"campaign":"' +
        `${live.id}","side":"ATTACKER"}.`,
    );
  }
  if (book.liveCount() >= MAX_LIVE_CAMPAIGNS) {
    return reject(
      'INV-26',
      `${String(MAX_LIVE_CAMPAIGNS)} campaigns are already live, which is the declared world cap — the map ` +
        'holds that many SAPs and stays readable. Nothing was spent; the cap frees as they end.',
    );
  }

  // 8. ── THE FIRST PULSE MUST BE STOCKED ─────────────────────────────────────
  //
  //    See the header on why only the first. A5′ is the reason it is checked at all: a campaign
  //    declared with an empty depot would STARVE without ever pressing, and the record would carry a
  //    forfeited bond against an attacker the rules had allowed to declare a war it could not open.
  const stocked = port.materielAt(req.attacker, depot);
  if (stocked < PULSE_MATERIEL_QTY) {
    return reject(
      'A15',
      `a campaign spends ${String(PULSE_MATERIEL_QTY)} units of ${MATERIEL_GOOD} per PULSE, from stock ALREADY ` +
        `STANDING at your depot ${depot}, and you have ${String(stocked)} unpledged there. Goods somewhere ` +
        'else do not count and currency buys none: MATERIEL is produced material put into a place, which is ' +
        'why this gate cannot be paid by enrolling a second identity (A15). `refine` some and `haul` it in — ' +
        `you need ${String(PULSE_MATERIEL_QTY)} standing there to declare and ${String(PULSE_MATERIEL_QTY)} ` +
        'more before every pulse after the first.',
    );
  }

  // 9. The bond. Last, because it is the easiest to fix and the least interesting refusal.
  const free = port.freeStoresOf(req.attacker);
  if (free < CAMPAIGN_BOND_MINOR) {
    return reject(
      'A7',
      `declaring a campaign locks a BOND of ${String(CAMPAIGN_BOND_MINOR)} of slashable capital and you have ` +
        `${String(free)} free. It is not a fee — you get ALL of it back if you win and it goes to the DEFENDER ` +
        'in full if you fail, which is what makes an unserious war expensive and a failed one a transfer to ' +
        'its victim rather than a griefer\'s bargain (§16.6 MUST-2).',
    );
  }

  return null;
}

/**
 * Declare the campaign. Returns the row that was written, or the sentence that refused it.
 *
 * **Nothing has happened when this refuses.** The gate runs to completion before the bond is locked
 * and the row is written after the lock succeeds, so there is no ordering in which an attacker ends
 * up with a lock and no campaign, or a campaign and no lock. The second is an attacker with no risk
 * on the record as having posted one; the first is an orphan encumbrance, which `INV-4` halts the
 * whole world over.
 */
export function openCampaign(
  port: DeclarePort,
  book: Book,
  req: DeclareRequest,
): WorldResult<CampaignRecord> {
  const refusal = declareRefusal(port, book, req);
  if (refusal !== null) return refusal;

  const depot = port.holdingSystemOf(req.attacker);
  const claim = port.claimAt(req.objective);
  const needed = claim === null ? null : breachesToTake(claim.state);
  if (depot === null || claim === null || needed === null) {
    // Unreachable: gates 3, 5 checked exactly this. Written as a branch rather than a `!` so a
    // future edit that reorders the gate degrades to a refusal instead of an exception inside a
    // verb handler, which is a 500 to an agent (scar #11).
    return reject('A2', `${req.objective} cannot be campaigned against right now. ${CAMPAIGN_STATEMENT}`);
  }

  const id = campaignIdFor(req.tick, book.nextIndexAt(req.tick));
  const encumbranceId = port.lockBond({
    campaign: id,
    principal: req.attacker,
    amount: CAMPAIGN_BOND_MINOR,
    tick: req.tick,
  });
  if (encumbranceId === null) {
    return reject(
      'INV-4',
      `your bond of ${String(CAMPAIGN_BOND_MINOR)} could not be locked, so the campaign was not declared and ` +
        'nothing of yours is committed. Free some stores and send it again.',
    );
  }

  const record: CampaignRecord = {
    id,
    attacker: req.attacker,
    defender: claim.claimant,
    objective: req.objective,
    depot,
    bond: CAMPAIGN_BOND_MINOR,
    bondEncumbranceId: encumbranceId,
    breachesNeeded: needed,
    rebuffsNeeded: rebuffsToStand(needed),
    declaredAtTick: req.tick,
    firstPulseTick: firstPulseTickFor(req.tick),
    state: 'MASSING',
    breaches: 0,
    rebuffs: 0,
    starves: 0,
    pulses: [],
    // The attacker is NOT a roster party. Its force is counted as the attacker's own hands at the
    // objective and its bond is the campaign's, not a party stake — so a row for it would double
    // one and duplicate the other. `demand` puts its initiator on the roster because a raid's force
    // is *only* party hands; a campaign's is the attacker plus its allies, which are different sums.
    parties: [],
    endedAtTick: null,
    endedAtReckoning: null,
    forfeited: minor(0),
    returned: minor(0),
  };
  book.declare(record);
  return { ok: true, value: record };
}

/**
 * The tick a campaign declared at `tick` first pulses at.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **ALWAYS THE NEXT RECKONING, AND NEVER THIS ONE — THAT IS THE NOTICE.** §16.6 MUST-8 requires
 * *"at least one full wake/standing-order cycle"* before a scheduled decision, and A4 forbids an
 * advantage from wall-clock presence. A campaign declared at phase 200 with a pulse at phase 216 the
 * same day would take sixteen ticks of a sleeping defender's territory-defence away — an attack
 * timed at the moment the victim was least able to answer, which is precisely the timezone-tanking
 * A14 and A4 both refuse.
 *
 * So the first pulse is the pulse phase of the **following** Reckoning, unconditionally, even when
 * declaring early in a cycle would leave room. Unconditional rather than "the next pulse at least N
 * ticks away", because a rule with a threshold in it is a rule an agent has to compute; this one is
 * one sentence: *your first pulse is tomorrow.*
 * ══════════════════════════════════════════════════════════════════════════
 */
export function firstPulseTickFor(declareTick: number): number {
  const cycleStart = declareTick - phaseOfReckoning(declareTick);
  return cycleStart + TICKS_PER_RECKONING + CAMPAIGN_PULSE_PHASE;
}

/** The Reckoning a campaign declared now would first pulse in. Published in the affordance. */
export function firstPulseReckoningFor(declareTick: number): number {
  return reckoningIndex(firstPulseTickFor(declareTick));
}
