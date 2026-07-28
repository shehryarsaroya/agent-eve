/**
 * What a campaign looks like — to an agent, on the ticker, and **on the map**.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ## ★ THE PIXEL SIGNATURE (A13): **THE SAP**
 *
 * A13 refuses a mechanic with no named pixel signature, and it names the vocabulary a new one has to
 * extend rather than replace: *a claim tints a system · a compact draws a link between two holdings ·
 * a broken compact snaps that link and scars both parties · a venture is a ring whose hollow arc is
 * the part riding on someone's word · a siege closes a ring · a convoy is a line that can be
 * severed.* Combat added THE BATTLE LINE; the market added THE PRINT.
 *
 * A campaign is harder than any of them, because it is the first mechanic that is **two places and
 * many Reckonings at once**. It has to read at a glance on one map beside everything else.
 *
 * **THE SAP is a notched band drawn from the campaign's DEPOT toward its OBJECTIVE.**
 *
 *   - It **advances one notch per BREACH and retreats one per REBUFF**, reaching the objective on the
 *     last breach it needs. `notches` is the position and `notchesToReach` is the length, so the band
 *     is the score — a viewer reads `2–1` off the geometry without a legend.
 *   - It is **dashed while MASSING**: the published notice window, before the first pulse. A defender
 *     watching the map sees the war coming a full Reckoning before it presses, which is §16.6 MUST-8
 *     rendered rather than merely honoured.
 *   - It is **solid while PRESSING**.
 *   - It is drawn **HOLLOW when the depot has no MATERIEL for the next pulse** — so a starving war
 *     looks starved a whole Reckoning before it dies, and a defender who cut the corridor can see
 *     that it worked. This is the one field that makes supply visible, and it is what turns a
 *     logistics mechanic into a picture.
 *   - On **TAKEN** the band reaches the system, the claim's tint goes out, and a **ruin** persists at
 *     the fallen anchor — reusing §16's world-memory ruin rather than inventing a mark.
 *   - On **REBUFFED · STARVED · LIFTED** the band **recoils to the depot** and the objective's tint
 *     is untouched. A war that failed leaves the map exactly as it found it, which is the correct
 *     picture: nothing was taken.
 *
 * The name is a siege term — a sap is the trench dug forward from the besieger's works toward the
 * wall, advanced by increments. Every other visual primitive in the engine was already spoken for:
 * *link, tint, ring, arc, line, bar, gap, tether, chain, halo, pip, socket, mark, print*.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## The one §11.2 decision, and it is the same one the claim tint made
 *
 * `HOLLOW` says *"there is not enough materiel at the depot for the next pulse"*, which is a
 * threshold on a stock — and §11.2 puts a stock at `SENSED`. It is admitted because it is not a
 * **quantity**: it is a one-bit fact about a **published obligation** falling due at a **published
 * tick**, exactly as `anchorHot` is on `ClaimLine` and for the identical reason. `anchorHot` says
 * "this anchor did not get its fuel this Reckoning" and carries no stockpile; this says "this
 * campaign will not press next Reckoning" and carries none either. A viewer learns the war is
 * failing; nobody learns how much anybody holds.
 *
 * The rejected version, for the record: a `materielHere` figure on the line. That is the "fuel gauge"
 * `sovereignty/view.ts` killed — a public recipe divided by a private stockpile, leaking coverage,
 * the limiting good and the contents of an inbound convoy. One bit is the whole admissible signal.
 */

import { phaseOfReckoning, reckoningIndex, TICKS_PER_RECKONING } from '../core/time.js';
import type { CampaignState, PrincipalId, SystemId } from '../core/types.js';
import type { Minor, Qty } from '../core/units.js';
import { qty } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import type { SapLine } from '../frames/contract.js';
import { Book, isLiveCampaign, nextPulseTickOf, type CampaignRecord } from './book.js';
import {
  CAMPAIGN_PULSES,
  CAMPAIGN_PULSE_PHASE,
  MATERIEL_GOOD,
  MAX_SAP_LINES,
  PULSE_MATERIEL_QTY,
  STARVES_TO_END,
} from './params.js';
import { readCampaignForce, type PulsePort } from './pulse.js';

/** Your place in a campaign, or `null` when you are only watching. */
export type CampaignStanding = 'ATTACKER' | 'DEFENDER' | 'ALLY_ATTACKER' | 'ALLY_DEFENDER' | null;

/**
 * The agent-facing record. snake_case, because these names reach an agent and `agent.md` publishes
 * them — the wire matches the document character for character (scar #1).
 */
export interface CampaignView {
  readonly campaign: string;
  readonly attacker: PrincipalId;
  readonly defender: PrincipalId;
  readonly objective: SystemId;
  readonly depot: SystemId;
  readonly state: CampaignState;
  /** The score, as one string a viewer and an agent read the same way: `2-1 of 3`. */
  readonly legend: string;
  readonly breaches: number;
  readonly breaches_needed: number;
  readonly rebuffs: number;
  readonly rebuffs_needed: number;
  readonly pulses_run: number;
  readonly pulses_max: number;
  readonly your_side: CampaignStanding;
  /** Null once the campaign has ended or run its clock. */
  readonly next_pulse_tick: number | null;
  readonly ticks_until_pulse: number | null;
  readonly materiel_good: typeof MATERIEL_GOOD;
  readonly materiel_per_pulse: Qty;
  /**
   * MATERIEL standing at the depot — **computed for the READER, and only for a party.**
   *
   * The asymmetry is `sovereignty/view.ts`'s (`available_here` is the reader's, `rent_*` is the
   * claimant's) and here it is a §11.2 boundary rather than a convenience: an attacker must know
   * whether its next pulse is funded, and a stranger must not learn what is in somebody's depot. So
   * a non-party reads `null`, and the SAP's `HOLLOW` bit is all it gets.
   */
  readonly materiel_here: Qty | null;
  /** Would the next pulse starve? Published to everyone; it is the SAP's own bit. */
  readonly next_pulse_starves: boolean;
  readonly consecutive_starves: number;
  readonly starves_to_end: number;
  /** The force arithmetic **right now**, recomputed and never cached. Both sides, always. */
  readonly force: {
    readonly attacker: number;
    readonly defender: number;
    readonly terrain: number;
    readonly attacker_hands: number;
    readonly defender_hands: number;
    readonly outcome_if_pulsed_now: 'BREACH' | 'REBUFF';
  };
  readonly bond: Minor;
  readonly forfeited: Minor;
  readonly returned: Minor;
  readonly roster: readonly { readonly principal: PrincipalId; readonly side: string; readonly stake: Minor }[];
  /** The postmortem. §16.6 MUST-14, and the reason the pulses are state rather than a fold. */
  readonly log: readonly {
    readonly reckoning: number;
    readonly tick: number;
    readonly outcome: string;
    readonly attacker_force: number;
    readonly defender_force: number;
    readonly materiel_spent: Qty;
  }[];
  /** The consequence of doing nothing, in one sentence. High Water's `projectedDrown` pattern. */
  readonly if_you_do_nothing: string;
}

/** What a view needs beyond the pulse port: the reader's own depot stock. */
export interface CampaignViewPort extends PulsePort {
  materielAt(principal: PrincipalId, system: SystemId): Qty;
}

/**
 * Every campaign this principal can see, most recent first.
 *
 * Visibility: a campaign is `PUBLIC`. Both places are on the map, the bond is posted capital (§6.4:
 * *"public, and any amount"*), and the score is the world's own verdict — nothing here is a
 * quantity anybody holds. That is the same tier `RaidLine` and `ClaimLine` already sit at, and A9
 * then holds by construction for the frame: the SAP carries strictly fewer fields than this.
 */
export function campaignViewsFor(args: {
  readonly book: Book;
  readonly port: CampaignViewPort;
  readonly principal: PrincipalId;
  readonly tick: number;
  readonly limit: number;
}): readonly CampaignView[] {
  const rows = args.book
    .all()
    .filter((c) => isLiveCampaign(c.state) || c.attacker === args.principal || c.defender === args.principal)
    .sort((a, b) => b.declaredAtTick - a.declaredAtTick || compareIds(a.id, b.id));
  return rows.slice(0, args.limit).map((c) => viewOf(c, args.port, args.principal, args.tick));
}

function viewOf(
  campaign: CampaignRecord,
  port: CampaignViewPort,
  reader: PrincipalId,
  tick: number,
): CampaignView {
  const reading = readCampaignForce(port, campaign);
  const next = nextPulseTickOf(campaign);
  const party = campaign.parties.find((p) => p.principal === reader);
  const side: CampaignStanding =
    campaign.attacker === reader
      ? 'ATTACKER'
      : campaign.defender === reader
        ? 'DEFENDER'
        : party === undefined
          ? null
          : party.side === 'ATTACKER'
            ? 'ALLY_ATTACKER'
            : 'ALLY_DEFENDER';

  const stocked = port.materielAt(campaign.attacker, campaign.depot);
  const starves = stocked < PULSE_MATERIEL_QTY;
  // Only a party sees the number; everyone sees the bit. See the field's own note.
  const visibleStock = side === null ? null : stocked;

  return {
    campaign: campaign.id,
    attacker: campaign.attacker,
    defender: campaign.defender,
    objective: campaign.objective,
    depot: campaign.depot,
    state: campaign.state,
    legend: campaignLegend(campaign),
    breaches: campaign.breaches,
    breaches_needed: campaign.breachesNeeded,
    rebuffs: campaign.rebuffs,
    rebuffs_needed: campaign.rebuffsNeeded,
    pulses_run: campaign.pulses.length,
    pulses_max: CAMPAIGN_PULSES,
    your_side: side,
    next_pulse_tick: next,
    ticks_until_pulse: next === null ? null : Math.max(0, next - tick),
    materiel_good: MATERIEL_GOOD,
    materiel_per_pulse: PULSE_MATERIEL_QTY,
    materiel_here: visibleStock,
    next_pulse_starves: starves,
    consecutive_starves: campaign.starves,
    // ── THE THRESHOLD, NOT A SECOND COPY OF THE COUNT ─────────────────────────
    //
    // This field read `campaign.pulses.length === 0 ? 0 : campaign.starves` on its first draft, which
    // is a rules surface lying in the most ordinary case: a campaign that had never starved published
    // `consecutive_starves: 0 · starves_to_end: 0`, and an agent reading a count of 0 out of 0 has been
    // told its war is already over. Every `*_needed` / `*_to_*` field in this view is the PUBLISHED
    // CONSTANT the engine compares against, so `x of y` reads as a fraction everywhere (A2).
    starves_to_end: STARVES_TO_END,
    force: {
      attacker: reading.attackerForce,
      defender: reading.defenderForce,
      terrain: reading.terrain,
      attacker_hands: reading.attackerHands + reading.attackerAllies,
      defender_hands: reading.defenderHands + reading.defenderAllies,
      outcome_if_pulsed_now: reading.attackerForce > reading.defenderForce ? 'BREACH' : 'REBUFF',
    },
    bond: campaign.bond,
    forfeited: campaign.forfeited,
    returned: campaign.returned,
    roster: campaign.parties.map((p) => ({ principal: p.principal, side: p.side, stake: p.stake })),
    log: campaign.pulses.map((p) => ({
      reckoning: p.reckoning,
      tick: p.tick,
      outcome: p.outcome,
      attacker_force: p.attackerForce,
      defender_force: p.defenderForce,
      materiel_spent: p.materielSpent,
    })),
    if_you_do_nothing: doNothingFor(campaign, side, reading.attackerForce > reading.defenderForce, starves),
  };
}

/**
 * The score in the fewest words that carry it: `2-1 of 3` · `MASSING · first pulse tick 504`.
 *
 * One function, read by the agent view, the frame and the ticker, so the three cannot describe the
 * same war differently. `claimLegend`'s discipline exactly.
 */
export function campaignLegend(campaign: CampaignRecord): string {
  if (campaign.state === 'MASSING') {
    return `MASSING · first pulse tick ${String(campaign.firstPulseTick)}`;
  }
  if (isLiveCampaign(campaign.state)) {
    return (
      `${String(campaign.breaches)}-${String(campaign.rebuffs)} of ${String(campaign.breachesNeeded)}` +
      (campaign.starves > 0 ? ` · STARVING ${String(campaign.starves)}` : '')
    );
  }
  return `${campaign.state} ${String(campaign.breaches)}-${String(campaign.rebuffs)}`;
}

/**
 * What happens to this reader if it does nothing. Exact, never a hedge (A2, PROP-O5).
 *
 * Branching on the reader's side rather than on the campaign, because the same fact has opposite
 * meanings: a coming BREACH is progress to the attacker and the loss of a system to the defender,
 * and a sentence that read the same to both would be telling one of them nothing.
 */
function doNothingFor(
  campaign: CampaignRecord,
  side: CampaignStanding,
  breachNow: boolean,
  starves: boolean,
): string {
  if (!isLiveCampaign(campaign.state)) {
    return `this campaign ended ${campaign.state}. Nothing further moves.`;
  }
  const when = nextPulseTickOf(campaign);
  const at = when === null ? 'no further pulse' : `tick ${String(when)}`;
  if (side === 'ATTACKER' || side === 'ALLY_ATTACKER') {
    if (starves) {
      return (
        `the pulse at ${at} STARVES: there is no ${MATERIEL_GOOD} at ${campaign.depot} to spend, so it counts ` +
        `for the defender and raises your consecutive starves to ${String(campaign.starves + 1)}. Haul ` +
        `${String(PULSE_MATERIEL_QTY)} in before then.`
      );
    }
    return breachNow
      ? `on today's hands the pulse at ${at} is a BREACH — ${String(campaign.breaches + 1)} of ` +
          `${String(campaign.breachesNeeded)}. Keep hands at ${campaign.objective} and materiel at the depot.`
      : `on today's hands the pulse at ${at} is a REBUFF — ties go to the defender, and it would be ` +
          `${String(campaign.rebuffs + 1)} of ${String(campaign.rebuffsNeeded)} against you. Bring more hands ` +
          `to ${campaign.objective} or lift the campaign for part of your bond.`;
  }
  if (side === 'DEFENDER' || side === 'ALLY_DEFENDER') {
    return breachNow
      ? `on today's hands the pulse at ${at} is a BREACH against you — ${String(campaign.breaches + 1)} of ` +
          `${String(campaign.breachesNeeded)}, and at ${String(campaign.breachesNeeded)} the claim on ` +
          `${campaign.objective} LAPSES and your bond is slashed. Move hands there; ties go to YOU.`
      : `on today's hands the pulse at ${at} is a REBUFF — ${String(campaign.rebuffs + 1)} of ` +
          `${String(campaign.rebuffsNeeded)}, and at ${String(campaign.rebuffsNeeded)} the campaign ends and its ` +
          `whole ${String(campaign.bond)} bond comes to you. Keep the hands where they are.`;
  }
  return (
    `you are not in this campaign. Its next pulse is at ${at}; you may take a side with join ` +
    `{"campaign":"${campaign.id}","side":"ATTACKER"|"DEFENDER"} and your hands at ${campaign.objective} would ` +
    'count from that pulse on.'
  );
}

/**
 * The frame's SAPs. Strictly fewer fields than {@link CampaignView}, which is what makes A9 a
 * theorem here rather than a review item: there is no live fact on the map an agent's own `observe`
 * would not answer.
 *
 * Sorted by how close the war is to deciding something — breaches descending, then the objective id
 * — and truncated to {@link MAX_SAP_LINES}. **Selection and ordering are separate concerns**
 * (`render.ts`'s recorded lesson: a `sort(...).slice(...)` that mixed them silently cut the climax
 * on the busiest nights), so the sort key here is significance and the cap is applied after it.
 */
export function sapLinesFor(args: {
  readonly book: Book;
  readonly tick: number;
  readonly materielAt: (principal: PrincipalId, system: SystemId) => Qty;
}): readonly SapLine[] {
  return args.book
    .all()
    .filter((c) => isLiveCampaign(c.state) || endedRecently(c, args.tick))
    .sort(
      (a, b) =>
        Number(isLiveCampaign(b.state)) - Number(isLiveCampaign(a.state)) ||
        b.breaches - a.breaches ||
        compareIds(a.objective, b.objective),
    )
    .slice(0, MAX_SAP_LINES)
    .map((c) => sapOf(c, args.materielAt));
}

function sapOf(campaign: CampaignRecord, materielAt: (p: PrincipalId, s: SystemId) => Qty): SapLine {
  const live = isLiveCampaign(campaign.state);
  const starving = live && materielAt(campaign.attacker, campaign.depot) < PULSE_MATERIEL_QTY;
  return {
    campaign: campaign.id,
    depot: campaign.depot,
    objective: campaign.objective,
    attacker: campaign.attacker,
    defender: campaign.defender,
    state: campaign.state,
    legend: campaignLegend(campaign),
    // On any ending but TAKEN the band recoils to the depot: nothing was taken, so the map must not
    // show a trench at the wall. On TAKEN it reaches, and the claim's own tint goes out.
    notches: campaign.state === 'TAKEN' ? campaign.breachesNeeded : live ? campaign.breaches : 0,
    notchesToReach: campaign.breachesNeeded,
    rebuffs: campaign.rebuffs,
    rebuffsToStand: campaign.rebuffsNeeded,
    dashed: campaign.state === 'MASSING',
    hollow: starving,
    reached: campaign.state === 'TAKEN',
    bond: campaign.bond,
    forfeited: campaign.forfeited,
    nextPulseTick: nextPulseTickOf(campaign),
    allies: campaign.parties.length,
  };
}

/** Ended inside the retention window's most recent Reckoning — the obituary still on screen. */
function endedRecently(campaign: CampaignRecord, tick: number): boolean {
  if (campaign.endedAtReckoning === null) return false;
  return campaign.endedAtReckoning >= reckoningIndex(tick) - 1;
}

/** One ticker line, ≤140 chars. The export surface (§14.5). */
export function campaignTickerLine(campaign: CampaignRecord): string {
  const head =
    campaign.state === 'MASSING'
      ? `${campaign.attacker} declares a campaign on ${campaign.objective} — ${campaign.defender}'s ground. ` +
        `First pulse tick ${String(campaign.firstPulseTick)}.`
      : campaign.state === 'TAKEN'
        ? `${campaign.objective} FALLS. ${campaign.attacker} broke ${campaign.defender}'s claim ` +
          `${String(campaign.breaches)}-${String(campaign.rebuffs)}; the anchor is gone and the ground is open.`
        : campaign.state === 'REBUFFED'
          ? `${campaign.defender} HOLDS ${campaign.objective} ${String(campaign.rebuffs)}-` +
            `${String(campaign.breaches)}. ${campaign.attacker} forfeits ${String(campaign.forfeited)}.`
          : campaign.state === 'STARVED'
            ? `${campaign.attacker}'s campaign on ${campaign.objective} STARVES — no ${MATERIEL_GOOD} reached ` +
              `${campaign.depot}. ${String(campaign.forfeited)} to ${campaign.defender}.`
            : campaign.state === 'LIFTED'
              ? `${campaign.attacker} lifts its campaign on ${campaign.objective} at ` +
                `${String(campaign.breaches)}-${String(campaign.rebuffs)}. ${String(campaign.forfeited)} forfeit.`
              : campaign.state === 'MOOT'
                ? `${campaign.attacker}'s campaign on ${campaign.objective} ends MOOT — the claim it was aimed ` +
                  'at is gone. Bond returned.'
                : `${campaign.attacker} presses ${campaign.objective}: ${campaignLegend(campaign)}.`;
  return head.length <= 140 ? head : `${head.slice(0, 137)}...`;
}

/**
 * The published clock, as one inert value. What every agent reads whether or not it is in a war.
 *
 * Present at zero campaigns and at four alike, for `aggressionCapacityFor`'s recorded reason: until
 * §9's capacity became a standing header block, the only mention of it in an observation was the
 * `withheld` line that fires when it hits zero — so an agent learned the resource existed by
 * exhausting it. A clock nobody can read is not a published clock.
 */
export interface CampaignClock {
  readonly pulse_phase: number;
  readonly next_pulse_tick: number;
  readonly ticks_until_pulse: number;
  readonly pulses_per_campaign: number;
  readonly materiel_good: typeof MATERIEL_GOOD;
  readonly materiel_per_pulse: Qty;
  readonly live_campaigns: number;
  readonly max_live_campaigns: number;
}

export function campaignClockAt(book: Book, tick: number, maxLive: number): CampaignClock {
  const phase = phaseOfReckoning(tick);
  const base = tick - phase;
  // `atOrAfter`, for `nextSpawnTick`'s reason: an agent observing at the pulse tick is looking at a
  // pulse that is resolving now, and telling it the next one is a Reckoning away would be a true
  // sentence about the wrong pulse.
  const next = phase <= CAMPAIGN_PULSE_PHASE ? base + CAMPAIGN_PULSE_PHASE : base + TICKS_PER_RECKONING + CAMPAIGN_PULSE_PHASE;
  return {
    pulse_phase: CAMPAIGN_PULSE_PHASE,
    next_pulse_tick: next,
    ticks_until_pulse: Math.max(0, next - tick),
    pulses_per_campaign: CAMPAIGN_PULSES,
    materiel_good: MATERIEL_GOOD,
    materiel_per_pulse: PULSE_MATERIEL_QTY,
    live_campaigns: book.liveCount(),
    max_live_campaigns: maxLive,
  };
}

/** Zero, as a typed value, for the ports that need one. */
export const NO_MATERIEL: Qty = qty(0);
