/**
 * `join {campaign}` and `withdraw {campaign}` — the roster, and the way out.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **TWO EXISTING VERBS, ONE NEW PARAMETER EACH, AND NO NEW WORD.** §17's budget is 40 of 40.
 * `join` already means *"take a side in somebody's fight"* and `withdraw` already means *"take
 * yourself out of a commitment"* — so §16.6 MUST-9's ally market and MUST-13's voluntary exit both
 * arrive as a `campaign` parameter on a verb that already carries the concept. That is §3's test
 * passed rather than dodged: these are the same concepts at a different horizon, not second ones.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## The asymmetry is the whole of MUST-9, and it is published
 *
 * > *"Any force, repair, intel relay, transit guarantee, or supply materially helping a side is
 * > tagged to that side … Attackers can recruit allies only as co-belligerents risking their own
 * > stake."*
 *
 * A DEFENDER joins free; an ATTACKER locks {@link CAMPAIGN_JOIN_STAKE_MINOR}, forfeit with the
 * campaign. `join {side:"DEFENDER"}` in §9 already works exactly this way, and the reason is the
 * same one: pricing the act of helping somebody hold their home would make the aggressor's side the
 * cheaper one to be on, which inverts attacker risk.
 *
 * ## Joining commits no hand, and that is deliberate
 *
 * A roster row is a **declaration**; force is the hands you actually have standing at the OBJECTIVE
 * when the pulse resolves. Two consequences worth having: an ally can promise support and be caught
 * not providing it (the say-do gap, on the record, for free), and reinforcements that arrive
 * mid-cycle count in full. A join that locked a hand would have made the second impossible and the
 * first invisible.
 */

import { inFreeze, isSettlementTick } from '../core/time.js';
import type { PrincipalId } from '../core/types.js';
import { type Minor } from '../core/units.js';
import { reject, type Rejection } from '../world/result.js';
import { Book, isLiveCampaign, type CampaignId, type CampaignSide } from './book.js';
import { CAMPAIGN_JOIN_STAKE_MINOR, MAX_CAMPAIGN_PARTIES } from './params.js';

/** What a join reads and writes. One lock, nothing else. */
export interface RosterPort {
  isSeated(principal: PrincipalId): boolean;
  freeStoresOf(principal: PrincipalId): Minor;
  lockStake(args: {
    readonly campaign: CampaignId;
    readonly principal: PrincipalId;
    readonly amount: Minor;
    readonly tick: number;
  }): string | null;
}

/** What an ATTACKER joiner locks. Zero for a DEFENDER, and the zero is a rule (see the header). */
export function joinStakeFor(side: CampaignSide): Minor {
  return side === 'ATTACKER' ? CAMPAIGN_JOIN_STAKE_MINOR : (0 as Minor);
}

/**
 * **Every gate on `join {campaign}`, in published order.** Called by the affordance and the verb.
 */
export function joinRefusal(
  port: RosterPort,
  book: Book,
  args: {
    readonly principal: PrincipalId;
    readonly campaign: CampaignId;
    readonly side: CampaignSide;
    readonly tick: number;
  },
): Rejection | null {
  const campaign = book.get(args.campaign);
  if (campaign === undefined) {
    return reject('A2', `there is no campaign ${args.campaign}.`);
  }
  if (!isLiveCampaign(campaign.state)) {
    return reject(
      'A2',
      `campaign ${args.campaign} ended ${campaign.state} at tick ${String(campaign.endedAtTick ?? 0)}. There is ` +
        'no side left to take.',
    );
  }
  if (!port.isSeated(args.principal)) {
    return reject('A2', `${args.principal} has no standing holding, so it has no body to bring to anybody's war.`);
  }
  // ── THE TWO PRINCIPALS THE WAR IS ABOUT ARE NOT ROSTER PARTIES ─────────────
  //
  // Both are refused rather than silently ignored, and the difference matters to the arithmetic:
  // `readCampaignForce` counts the attacker's and the defender's OWN hands as the two sides' base,
  // then adds each roster party's hands on top. A row for either would count the same hands twice.
  if (args.principal === campaign.attacker) {
    return reject(
      'A2',
      'you declared this campaign, so you are already its attacking side. Your own hands at the objective are ' +
        'counted at every pulse — a roster row would count them twice.',
    );
  }
  if (args.principal === campaign.defender) {
    return reject(
      'A2',
      `you hold the claim this campaign is aimed at, so you are already its defending side. Your hands at ` +
        `${campaign.objective} are counted at every pulse — a roster row would count them twice. What helps you ` +
        'is more hands standing there, or paying the Charge so the claim never becomes cheaper to take.',
    );
  }
  const already = campaign.parties.find((p) => p.principal === args.principal);
  if (already !== undefined) {
    return reject(
      'A2',
      `you are already on campaign ${args.campaign}'s roster as ${already.side}, since tick ` +
        `${String(already.joinedAtTick)}. A principal takes one side: being on both would let one hand at the ` +
        'objective count for and against the same assault.',
    );
  }
  if (campaign.parties.length >= MAX_CAMPAIGN_PARTIES) {
    return reject(
      'INV-26',
      `campaign ${args.campaign}'s roster holds ${String(MAX_CAMPAIGN_PARTIES)} parties, which is the declared ` +
        'cap. Nothing was spent.',
    );
  }
  if (inFreeze(args.tick) || isSettlementTick(args.tick)) {
    return reject(
      'A14',
      'the freeze is on, so no capital may be locked until the Reckoning has run (§5.1 re-reads every payer ' +
        'balance between the freeze and the settlement). The next pulse is a whole cycle away; join before it.',
    );
  }
  const stake = joinStakeFor(args.side);
  if (stake > 0) {
    const free = port.freeStoresOf(args.principal);
    if (free < stake) {
      return reject(
        'A7',
        `joining the ATTACKER side locks ${String(stake)} of slashable capital and you have ${String(free)} free. ` +
          'It is forfeit if the campaign fails: a co-belligerent risks its own stake or it is not one (§16.6 ' +
          'MUST-9). Joining the DEFENDER side costs nothing.',
      );
    }
  }
  return null;
}

/** **Every gate on `withdraw {campaign}`.** Only the attacker may lift its own war. */
export function liftRefusal(
  book: Book,
  args: { readonly principal: PrincipalId; readonly campaign: CampaignId; readonly tick: number },
): Rejection | null {
  const campaign = book.get(args.campaign);
  if (campaign === undefined) {
    return reject('A2', `there is no campaign ${args.campaign}.`);
  }
  if (!isLiveCampaign(campaign.state)) {
    return reject('A2', `campaign ${args.campaign} already ended ${campaign.state}; there is nothing to lift.`);
  }
  if (campaign.attacker !== args.principal) {
    // A defender cannot end a campaign by asking. It ends one by standing, by paying its Charge so
    // the claim never gets cheaper, or by ceding the claim — which ends the war MOOT and is the
    // exit §16.6 MUST-13 wants a losing holder to have.
    return reject(
      'A2',
      `campaign ${args.campaign} is ${campaign.attacker}'s and only its declarer may lift it. If you are its ` +
        `defender, what ends it is standing (${String(campaign.rebuffsNeeded - campaign.rebuffs)} more rebuffs), ` +
        `or ceding the claim on ${campaign.objective} — a campaign whose objective changes hands ends MOOT and ` +
        'its bond goes home.',
    );
  }
  if (inFreeze(args.tick) || isSettlementTick(args.tick)) {
    return reject(
      'A14',
      'the freeze is on, and a lift moves currency between two principals. Lift earlier in the cycle; the next ' +
        'pulse is not inside the freeze either.',
    );
  }
  return null;
}
