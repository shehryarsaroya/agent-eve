/**
 * The PULSE — one campaign's once-per-Reckoning resolution, and every ending it can reach.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS MODULE COMPUTES AND MOVES NOTHING.** It reads, it decides, it returns a plan. Every
 * destruction, forfeit and release is the adapter's, exactly as `predation/resolve.ts` computes and
 * `predate.ts` moves. The reason is A5′: a resolver that both decided and moved could record a
 * BREACH it had not paid for, and there would be no second road to check it against. `CMP-3`
 * recomputes every recorded `materielSpent` from the posting log and halts in either direction.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## The force reading, and why it is not `readForce`
 *
 * §9's `readForce` takes a `RaidRecord`, a weather scalar drawn at spawn, and a `raidForceLeft`
 * closure that falls as world hulls are wrecked. A campaign has none of those three: it is not
 * weather, nothing is drawn, and it has no fleet of its own. Handing it a synthetic `RaidRecord` to
 * reach one comparison would be worse than restating the comparison — it would put a second meaning
 * on the raid record and make every future change to §9's arithmetic silently a change to war.
 *
 * So the comparison is stated here, once, **out of §9's own published constants**, imported rather
 * than copied: `FORCE_PER_HAND`, `FORCE_PER_JOINER` and `FORCE_BY_TIER`. There is no second number
 * anywhere in this file. The rule is §9's rule — *higher wins, ties to the defender* — and
 * `test/campaign/pulse.spec.ts` asserts the tie goes the defender's way by mutation, because a
 * tie-break is exactly the clause a refactor silently inverts.
 *
 * **Hands are counted at the PULSE, never at the join.** Same rule as `readForce`'s `stillThere`,
 * and the same hole it closes: a joiner who signed up and marched away would otherwise contribute a
 * force it was not there to provide, and a DEFENDER joiner stakes nothing, so it would be a free
 * rebuff forever.
 *
 * ## Why MATERIEL is spent BEFORE the force is read
 *
 * Because the alternative prices war wrong. If the attacker could see the defender's hands and then
 * decide whether to pay, every pulse would be free reconnaissance and a campaign would cost nothing
 * on the Reckonings it was losing. Paying first makes the war a **commitment** — the supply is spent
 * whether or not the assault lands, which is what makes an outnumbered attacker's fifth pulse a real
 * loss and what makes bringing hands the defender's actual counterplay rather than a formality.
 *
 * It also makes the STARVE branch honest: a starved pulse spends nothing, because there was nothing
 * to spend. `materielSpent` is therefore exactly the two states of the mechanic, on the record.
 */

import { reckoningIndex } from '../core/time.js';
import type {
  CampaignState,
  ClaimState,
  HandId,
  PrincipalId,
  PulseOutcome,
  SystemId,
  ZoneTier,
} from '../core/types.js';
import { minor, qty, type Minor, type Qty } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
// §9's published force constants. Imported, never restated: the whole claim of this module is that
// a campaign is fought by the same arithmetic as a standoff, and two spellings of `FORCE_PER_HAND`
// would make that claim false the first time either moved (scar #5).
import { FORCE_BY_TIER, FORCE_PER_HAND, FORCE_PER_JOINER } from '../predation/params.js';
// The razing rule, shared with the raid path. Same import argument as §9's force constants above:
// a campaign is fought by the same arithmetic as a standoff, so it must END A STRUCTURE by the same
// arithmetic too — two spellings of `RAZE_FORCE_MARGIN` would make that claim false the first time
// either moved, and A8 would then hold on one path and not the other.
import { razeVerdict, type RazeCandidate } from '../works/raze.js';
import {
  Book,
  isLiveCampaign,
  nextPulseTickOf,
  type CampaignId,
  type CampaignRecord,
  type PulseRow,
} from './book.js';
import {
  CAMPAIGN_PULSES,
  CAMPAIGN_SALVAGE_BPS,
  MATERIEL_GOOD,
  PULSE_MATERIEL_QTY,
  STARVES_TO_END,
} from './params.js';

/** Everything a pulse reads. Every write is described in the plan, never performed here. */
export interface PulsePort {
  tierOf(system: SystemId): ZoneTier;
  /** The live claim on a system, or null. `null` is what makes a campaign MOOT. */
  claimAt(system: SystemId): { readonly claimant: PrincipalId; readonly state: ClaimState } | null;
  /** IDLE hands this principal has present at `system`. §9's `handsDefending`, same predicate. */
  handsAt(principal: PrincipalId, system: SystemId): readonly HandId[];
  /** Unpledged lots of MATERIEL standing at `system`, canonical order. */
  materielLotsAt(principal: PrincipalId, system: SystemId): readonly { readonly id: string; readonly qty: number }[];
  /**
   * Live WORKS the defender holds at the objective — what a BREACH can end.
   *
   * The DEFENDER's and nobody else's, which is `resolvePulse`'s own rule about bonds applied to
   * structures: *"a bond may not be forfeited to a principal that never chose to be in the war"*, so
   * neither may a tenant's factory be burned for standing on ground somebody else went to war over.
   * A campaign's landlord loses its own production; its tenants lose their landlord.
   */
  worksAt(principal: PrincipalId, system: SystemId): readonly RazeCandidate[];
}

/**
 * What one pulse decided, and everything the adapter must then do.
 *
 * A plan rather than a set of side effects, so the whole decision is one testable value and the
 * ledger motion is one place. `destroy` is empty on a STARVE and on any ending that pre-empts the
 * pulse; `endsWith` is null on a pulse that leaves the campaign live.
 */
export interface PulsePlan {
  readonly campaign: CampaignId;
  readonly row: PulseRow | null;
  /** Lots to destroy into the CONSUMPTION sink, in canonical order, summing to `materielSpent`. */
  readonly destroy: readonly { readonly lotId: string; readonly qty: Qty }[];
  readonly endsWith: CampaignEnding | null;
  /**
   * ★ The WORKS this pulse's BREACH ends, or null — **and this is the whole economic point of a war.**
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE ASYMMETRY THIS CLOSES.** Three breaches took a SUPPLIED claim and the anchor fell, so
   * territory changed hands **with its production untouched.** A war's prize arrived with the
   * factories intact and nobody had to rebuild anything, which is why the economy had no reason to
   * keep running once everybody had built: destruction is what creates replacement demand, and this
   * layer created none.
   *
   * On the **BREACH** rather than on `TAKEN`, deliberately, and it is the more interesting rule:
   *
   *   - **A war nobody wins still costs the defender its production.** A campaign that breaches once
   *     and is then rebuffed leaves the claim where it was and the works in ruins — so an attacker
   *     that loses has still done economic damage, and a defender that "won" has a bill. That is
   *     *"every war has an economic consequence"* holding for the wars that end in nothing, which is
   *     most of them.
   *   - **It lands on a clock nobody controls.** A pulse resolves at `CAMPAIGN_PULSE_PHASE`, once per
   *     Reckoning, on the Charge's own clock (A14). Razing on `TAKEN` would have fired at most once
   *     per campaign and only for the winner; this fires on the schedule the war already rides.
   *   - **`WORKS_PER_PRINCIPAL_PER_SYSTEM` is 1**, so the second and third breaches of a campaign
   *     find nothing standing and say so. The first assault that lands is the one that burns the
   *     works, and the rest of the war is fought over ground that has already stopped producing.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly razes: RazeCandidate | null;
  /** The sentence {@link razeVerdict} returned, on every pulse that read force. Null otherwise. */
  readonly razeWhy: string | null;
}

/**
 * A campaign's ending, with its money split out so nothing has to re-derive it.
 *
 * `lapseObjective` is the one field that reaches outside this module's own bookkeeping, and it is
 * deliberately a **flag rather than a call**: sovereignty owns the lapse, the bond slash and the
 * obituary, so a campaign that performed them itself would be a second lapse path and the two would
 * disagree the first time either changed (`settle.ts`'s V1/V2 pair is the recorded cost of that).
 */
export interface CampaignEnding {
  readonly state: Exclude<CampaignState, 'MASSING' | 'PRESSING'>;
  readonly tick: number;
  /** Of the attacker's bond and every ATTACKER party stake: what goes to the defender. */
  readonly forfeited: Minor;
  /** Of the attacker's bond: what comes back. `forfeited + returned === bond`, always. */
  readonly returned: Minor;
  /** True only on `TAKEN`. Sovereignty lapses the claim and slashes the defender's bond. */
  readonly lapseObjective: boolean;
  /** One sentence, for the record and the ticker. Names the arithmetic, never editorialises. */
  readonly why: string;
}

/**
 * Resolve one campaign's due pulse.
 *
 * The order of the four branches **is** the mechanic and each precedes the next for a stated reason:
 * MOOT before anything (there is nothing to fight over), then supply (the commitment), then force
 * (the assault), then the verdict.
 */
export function resolvePulse(port: PulsePort, campaign: CampaignRecord, tick: number): PulsePlan {
  const none = { campaign: campaign.id, row: null, destroy: [], razes: null, razeWhy: null } as const;

  // ── 1. IS THERE STILL AN OBJECTIVE? ───────────────────────────────────────
  //
  // The claim may have lapsed on its own, been ceded, been abandoned, or changed hands in the
  // vulnerability window while the war was running. In every one of those the thing the bond was
  // posted against is gone, and **nobody failed at anything** — so the bond comes back whole.
  //
  // This is also the defender's best move when it is losing, and §16.6 MUST-13 lists it as an
  // ending on purpose: *sell the claim and the war has nothing left to take.* A rule that kept the
  // campaign running against whoever held the system next would have let an attacker's bond be
  // forfeited to a principal that never chose to be in the war, and would have made a fire sale
  // pointless — deleting the one exit that turns a collapse into a negotiation.
  const claim = port.claimAt(campaign.objective);
  if (claim === null || claim.claimant !== campaign.defender) {
    return {
      ...none,
      endsWith: {
        state: 'MOOT',
        tick,
        forfeited: minor(0),
        returned: campaign.bond,
        lapseObjective: false,
        why:
          claim === null
            ? `the claim on ${campaign.objective} no longer exists, so the campaign's objective is gone and its ` +
              'bond returns in full'
            : `${campaign.objective} is now held by ${claim.claimant} and the campaign was declared against ` +
              `${campaign.defender}; a bond may not be forfeited to a principal that never chose to be in the war`,
      },
    };
  }

  // ── 2. SUPPLY, AND IT IS SPENT BEFORE ANYTHING IS SEEN ────────────────────
  const picked = takeMateriel(port.materielLotsAt(campaign.attacker, campaign.depot));
  const index = campaign.pulses.length;
  const reckoning = reckoningIndex(tick);

  if (picked === null) {
    const row: PulseRow = {
      index,
      reckoning,
      tick,
      outcome: 'STARVED',
      // A starved pulse presses nothing, so neither side's force was read and publishing a number
      // for it would be inventing one. Zeroes with `materielSpent: 0` beside them are the honest
      // record: nothing happened because nothing arrived.
      attackerForce: 0,
      defenderForce: 0,
      terrain: 0,
      materielSpent: qty(0),
      attackerHands: 0,
      defenderHands: 0,
    };
    const starves = campaign.starves + 1;
    if (starves >= STARVES_TO_END) {
      return {
        ...none,
        row,
        endsWith: {
          state: 'STARVED',
          tick,
          forfeited: campaign.bond,
          returned: minor(0),
          lapseObjective: false,
          why:
            `${String(starves)} consecutive pulses found no ${MATERIEL_GOOD} standing at ${campaign.depot}; an ` +
            'attacker that cannot supply its depot loses to logistics, and its whole bond goes to the defender',
        },
      };
    }
    return { ...none, row, endsWith: verdictAfter(campaign, row, tick) };
  }

  // ── 3. THE FORCE READING. §9's rule, §9's constants, stated once. ──────────
  const reading = readCampaignForce(port, campaign);
  const outcome: PulseOutcome = reading.attackerForce > reading.defenderForce ? 'BREACH' : 'REBUFF';
  const row: PulseRow = {
    index,
    reckoning,
    tick,
    outcome,
    attackerForce: reading.attackerForce,
    defenderForce: reading.defenderForce,
    terrain: reading.terrain,
    materielSpent: picked.spent,
    attackerHands: reading.attackerHands,
    defenderHands: reading.defenderHands,
  };

  // ── 4. AND WHAT THE ASSAULT DESTROYS ──────────────────────────────────────
  //
  // Asked on every pulse that read force, including a REBUFF: `razeVerdict` needs the margin either
  // way and its `why` is the honest sentence for both answers. The margin on a rebuff is negative or
  // zero by construction (`outcome` is BREACH exactly when the attacker is ahead), so a rebuffed
  // pulse can never raze — but the *reason* it did not is recorded rather than inferred, because
  // "the defender held" and "the defender held by one hand" are different facts about a war.
  //
  // The Commons branch inside `razeVerdict` is unreachable from here — `declare.ts` refuses a
  // COMMONS objective as INVALID and `claim.ts` refuses a COMMONS claim, so there is no campaign to
  // pulse — and it is asked anyway. A8 is a floor, and a floor that depended on two other files
  // continuing to agree with it is not one.
  const raze = razeVerdict({
    tier: port.tierOf(campaign.objective),
    system: campaign.objective,
    standing: port.worksAt(campaign.defender, campaign.objective),
    attackerForce: reading.attackerForce,
    defenderForce: reading.defenderForce,
  });

  return {
    campaign: campaign.id,
    row,
    destroy: picked.lots,
    endsWith: verdictAfter(campaign, row, tick),
    razes: raze.falls,
    razeWhy: raze.why,
  };
}

/**
 * The verdict a pulse produces, or `null` when the campaign is still undecided.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE LAST CLAUSE IS THE ONE THAT MAKES A CAMPAIGN FINITE, AND IT IS UNREACHABLE BY
 * CONSTRUCTION.** `assertCampaignSchedule` refuses any calibration in which
 * `breachesNeeded + rebuffsNeeded <= CAMPAIGN_PULSES`, so one of the two conditions above is always
 * met by the last pulse. The clause is written anyway, and it does **not** invent a verdict: it ends
 * the campaign `MOOT` with the bond returned and says in its own sentence that the numbers were
 * wrong. A12 forbids the sandbox authoring an outcome, and the alternative — leaving the row live
 * forever with a bond locked inside it — is the endless-aggression mechanic §16.6 MUST-20 CUTs,
 * arriving through a calibration nobody would look at again.
 * ══════════════════════════════════════════════════════════════════════════
 */
function verdictAfter(campaign: CampaignRecord, row: PulseRow, tick: number): CampaignEnding | null {
  const breaches = campaign.breaches + (row.outcome === 'BREACH' ? 1 : 0);
  const rebuffs = campaign.rebuffs + (row.outcome === 'BREACH' ? 0 : 1);

  if (breaches >= campaign.breachesNeeded) {
    return {
      state: 'TAKEN',
      tick,
      forfeited: minor(0),
      returned: campaign.bond,
      lapseObjective: true,
      why:
        `${String(breaches)} breaches of ${String(campaign.breachesNeeded)}: the anchor at ${campaign.objective} ` +
        `falls, ${campaign.defender}'s claim LAPSES and its bond is slashed. ${campaign.attacker}'s own bond ` +
        'returns in full — the campaign priced failure, not war',
    };
  }
  if (rebuffs >= campaign.rebuffsNeeded) {
    return {
      state: 'REBUFFED',
      tick,
      forfeited: campaign.bond,
      returned: minor(0),
      lapseObjective: false,
      why:
        `${String(rebuffs)} rebuffs of ${String(campaign.rebuffsNeeded)}: ${campaign.defender} stood, and the ` +
        `whole ${String(campaign.bond)} bond goes to it`,
    };
  }
  if (campaign.pulses.length + 1 >= CAMPAIGN_PULSES) {
    return {
      state: 'MOOT',
      tick,
      forfeited: minor(0),
      returned: campaign.bond,
      lapseObjective: false,
      why:
        `the campaign ran its ${String(CAMPAIGN_PULSES)} pulses at ${String(breaches)}–${String(rebuffs)} with ` +
        `neither side at its number (${String(campaign.breachesNeeded)} to take, ` +
        `${String(campaign.rebuffsNeeded)} to stand). No verdict is available and none will be invented (A12); ` +
        'the bond returns in full and the calibration is wrong',
    };
  }
  return null;
}

/** The two sums, and the terms they came out of. Published so an agent can check them (A2). */
export interface CampaignForceReading {
  readonly attackerForce: number;
  readonly defenderForce: number;
  readonly terrain: number;
  readonly attackerHands: number;
  readonly defenderHands: number;
  readonly attackerAllies: number;
  readonly defenderAllies: number;
}

/**
 * Read both sides at the OBJECTIVE, right now.
 *
 * Exported and pure over `(port, campaign)` so the affordance, the agent's view, the frame and the
 * resolver all answer *"who is winning"* from one function. An agent shown a number before it
 * commits hands and a resolver computing a different one is scar #1 with territory at stake.
 *
 * `FORCE_BY_TIER` gives the MARCHES 1 and the FRONTIER 0, so — exactly as in §9 — a lone attacker at
 * the Marches ties and loses, and a lone attacker at the Frontier beats silence. The policed zone is
 * policed; the frontier is not; and taking a defended place needs somebody to stand with you.
 */
export function readCampaignForce(port: PulsePort, campaign: CampaignRecord): CampaignForceReading {
  // `?? 0` for `readForce`'s reason: a missing key would read `undefined` and propagate `NaN` into a
  // published force, and a `NaN` comparison is silently always a REBUFF — a defender winning for free.
  const terrain = FORCE_BY_TIER[port.tierOf(campaign.objective)] ?? 0;
  const attackerHands = port.handsAt(campaign.attacker, campaign.objective).length;
  const defenderHands = port.handsAt(campaign.defender, campaign.objective).length;

  let attackerAllies = 0;
  let defenderAllies = 0;
  for (const party of campaign.parties) {
    // An ally contributes only the hands it actually has standing there at the pulse. A roster row
    // is a declaration of intent and a hand is a fact; §9 learned this by shipping the other way
    // round, where joining and marching away paid a force nobody provided.
    const present = port.handsAt(party.principal, campaign.objective).length;
    if (present <= 0) continue;
    if (party.side === 'ATTACKER') attackerAllies += present;
    else defenderAllies += present;
  }

  return {
    attackerForce: FORCE_PER_HAND * attackerHands + FORCE_PER_JOINER * attackerAllies,
    defenderForce: FORCE_PER_HAND * defenderHands + FORCE_PER_JOINER * defenderAllies + terrain,
    terrain,
    attackerHands,
    defenderHands,
    attackerAllies,
    defenderAllies,
  };
}

/**
 * Pick exactly {@link PULSE_MATERIEL_QTY} out of the lots standing at the depot, or `null`.
 *
 * All-or-nothing on purpose. A partial spend would either buy a partial breach — a fraction the
 * whole design has no arithmetic for — or silently destroy goods for nothing, and §10.2 requires
 * published rounding rather than a choice made here. So an under-stocked depot is a STARVE and the
 * goods it does hold are left alone, which is also the honest thing: they are still there to be
 * hauled at, raided, or sold.
 */
function takeMateriel(
  lots: readonly { readonly id: string; readonly qty: number }[],
): { readonly lots: readonly { readonly lotId: string; readonly qty: Qty }[]; readonly spent: Qty } | null {
  const available = lots.reduce((n, l) => n + Math.max(0, l.qty), 0);
  if (available < PULSE_MATERIEL_QTY) return null;
  const ordered = [...lots].sort((a, b) => compareIds(a.id, b.id));
  const picked: { lotId: string; qty: Qty }[] = [];
  let taken = 0;
  for (const lot of ordered) {
    if (taken >= PULSE_MATERIEL_QTY) break;
    const portion = Math.min(PULSE_MATERIEL_QTY - taken, Math.max(0, lot.qty));
    if (portion <= 0) continue;
    picked.push({ lotId: lot.id, qty: qty(portion) });
    taken += portion;
  }
  return { lots: picked, spent: qty(taken) };
}

/**
 * The ending a voluntary `withdraw {campaign}` produces.
 *
 * §16.6 MUST-13's *"multiple exits"*, and the salvage is the same rate `abandon` already returns on
 * a claim — one constant, so the two exits from a losing position are priced identically and an
 * agent that learned one knows the other. Rounded **down** on what comes back, so the salvage is
 * never one minor unit generous at the defender's expense.
 */
export function liftEnding(campaign: CampaignRecord, tick: number): CampaignEnding {
  const returned = minor(Math.floor((campaign.bond * CAMPAIGN_SALVAGE_BPS) / 10_000));
  return {
    state: 'LIFTED',
    tick,
    forfeited: minor(campaign.bond - returned),
    returned,
    lapseObjective: false,
    why:
      `${campaign.attacker} lifted the campaign at ${String(campaign.breaches)}–${String(campaign.rebuffs)}; ` +
      `${String(CAMPAIGN_SALVAGE_BPS / 100)}% of the bond returns and the rest goes to ${campaign.defender}`,
  };
}

/** Is this campaign's pulse due at this tick? One home, read by the handler and by the view. */
export function pulseIsDue(campaign: CampaignRecord, tick: number): boolean {
  return isLiveCampaign(campaign.state) && nextPulseTickOf(campaign) === tick;
}

/** Campaigns whose pulse is due now, canonical order. The handler's whole input. */
export function duePulses(book: Book, tick: number): readonly CampaignRecord[] {
  return book.all().filter((c) => pulseIsDue(c, tick));
}
