/**
 * Resolution — **arithmetic, not a combat simulation** (SPEC §9, A2, A3).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **HIGHER FORCE WINS, DETERMINISTICALLY. NO DICE.**
 *
 *     defenderForce = FORCE_PER_HAND x (hands the target committed)
 *                   + FORCE_PER_HAND x (hands DEFENDER joiners have standing here)
 *                   + FORCE_BY_TIER[tier of the stage]
 *
 *     raiderForce   = the raid's OWN force still on the field  (see below)
 *                   + FORCE_PER_HAND x SUM over raider parties of
 *                       min(that principal's hands standing here, its SWAY here)
 *
 *     defenderForce >= raiderForce  ->  REPULSED       (ties go to the defender)
 *     otherwise                     ->  PLUNDERED
 *
 * There are no hit points, no rounds and no positioning. §9 says the Demand window
 * *"resolves within a tick and cannot be won by polling"*, and A3 says intent not
 * clicks: a tactical simulation at five minutes a tick is unwatchable and unplayable by
 * an agent that is offline most of the day. The only randomness anywhere near this is
 * `raid.force`, drawn **at spawn** inside a published band — so by the time an agent
 * decides, the arithmetic is fully known and the answer is a judgement about other
 * agents rather than a gamble against the engine.
 *
 * **Ties go to the defender**, deliberately: a defender that has done the arithmetic and
 * matched the raid should not lose to a rounding convention, and the direction is
 * published so it is a rule rather than an accident.
 *
 * **And the raider's sum has one term the defender's does not: SWAY** (§16.12 #1, `world/sway.ts`).
 * A raider party's hand counts only where its principal can supply it — within
 * `SWAY_AT_SEAT` hops of ground it holds, less `SWAY_STRAIT_TOLL` for every STRAIT in the way it
 * holds neither end of. The defender's hands are never read that way, and `ForceArgs.swayAt`
 * carries the argument in full: a chokepoint exists to favour the interior line, so a reach limit
 * that thinned the defence would invert the mechanic it came from.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚑ **THE RAIDER'S SUM USED TO COUNT PARTY *ROWS*, AND THAT WAS TWO BUGS AT ONCE.**
 *
 * It read `FORCE_PER_JOINER x (raider parties with SWAY >= 1)` — one point per PRINCIPAL, with the
 * sway magnitude read only as a boolean. A blind player found what that costs from the outside:
 * *"`force.your_sway: 3` at the target system with two IDLE hands standing there and
 * `force.raider: 1`. No verb converts them. Offence is priced in allies the reach rules forbid
 * asking."* It was exactly right, and there was no verb — `demand` commits one hand, `join` is
 * refused to a principal already in the standoff, and `engage`'s hulls add nothing to a demand.
 *
 * Two things it contradicted, each on its own sufficient:
 *
 *   1. **`SWAY_STATEMENT`, which we ship to agents verbatim**, says *"SWAY is how many of your 3
 *      HANDS count as FORCE at a place you are not defending."* The raid layer read it as a
 *      permission bit. Scar #1 exactly: the engine and its own rules text disagreeing about one
 *      rule, each individually coherent — and here the *text* was the correct one.
 *   2. **The campaign layer already does it properly.** `campaign/pulse.ts:readCampaignForce`
 *      computes `min(hands present, sway)` for the attacker and for every ally. Two hostile
 *      mechanics read the same `swayAt` port in incompatible units, and only one of them
 *      implemented the published sentence.
 *
 * It also made the two sides of one comparison incommensurable: the TARGET's own hands were
 * `FORCE_PER_HAND x hands` (up to 3 from one `fight`) while a raider was `1`, whatever it brought.
 * So the fix is not a buff — it is the raider side being measured in the unit the target's side was
 * always measured in.
 *
 * **AND ALLIES ON BOTH SIDES ARE COUNTED IN HANDS, FOR THE SAME REASON.** `defenderJoiners` was also
 * a row count, so leaving it alone would have made a defender ally's three hands worth 1 against a
 * raider ally's 3 — inverting §16.1 MUST-3's whole point, that a chokepoint *"lets a smaller defender
 * exploit interior lines"*. `campaign/pulse.ts` is the precedent for both halves at once: attacker
 * and every attacking ally at `min(present, sway)`, defender and every defending ally at `present`.
 * This is now the same arithmetic in the same units, one layer down.
 *
 * **What it does NOT change:** the sway *asymmetry* (offence is supplied, defence is present — a
 * raider at 0 sway still buys nothing and {@link ForceReading.terms.raidersOutOfSway} still counts
 * it), terrain, the tie rule, or `march` being the act that adds a hand. There is no new verb:
 * **the hands you have standing there are the force you have**, which is what §16.12 #1 means by
 * capacity-limited projection and what makes `move` worth an action before a window closes.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **AND THE RAID'S OWN FORCE IS MEASURED AT RESOLUTION TOO, WHICH IT WAS NOT.**
 *
 * `raid.force` used to be read straight off the record — a scalar drawn at spawn for a world
 * raid, and never touched again. That made §9A's advertised coupling run **one direction only**.
 * `combat/index.ts`, `combat/battle.ts` and SPEC §9A all say the same thing: *"a wrecked hull routs
 * its hand, `readForce` counts hands at resolution, so losing the battle loses the force reading
 * automatically."* True of the defender. False of the world, because `applyLoss` returns early on a
 * world hull and the scalar on the record did not care how many LANCEs were left.
 *
 * Measured, seed `fz-13` tick 192: `brannock` answered FIGHT with one missile WARDEN, **destroyed
 * all three world LANCEs**, held the field at 2,395 EHP of 4,400 — and the standoff resolved
 * **PLUNDERED 2-3**. It won the battle and lost the standoff. So `engage` against the weather was
 * all downside for a material agent: hulls are destroyed permanently and could not affect the
 * outcome, which makes YIELD the only rational answer and makes A14's scheduled drama render
 * identically to peace — A13's definition of a mechanic that does not exist.
 *
 * {@link ForceArgs.raidForceLeft} closes it, and it is deliberately **not** a second arithmetic.
 * §9A's rule is *"composition beats headcount, through hands and nothing else"*; a world raid's
 * fleet is crewed by one synthetic hand per hull, and this makes those hands count by the **same
 * rule at the same moment** as every other hand in the sum. What changed is not the formula — it is
 * that one side stopped being exempt from it.
 *
 * Three properties the shape guarantees, each load-bearing:
 *
 *   - **The world's force can only fall.** `Math.min` against `raid.force` means no battle can hand
 *     a raid strength it was never given, whatever a book says.
 *   - **No battle means no reduction.** `null` reads as *"nothing is counting"* and the drawn scalar
 *     stands, so an unanswered raid and an unfought one are exactly as strong as they were. This is
 *     also what makes an agent-initiated demand pass through untouched: `DEMAND_OWN_FORCE` is 0 and
 *     all of its force is already hands.
 *   - **A bookkeeping failure never hands out a free repulse.** A raid whose fleet was never
 *     fielded reports `null`, not 0 — see {@link ForceArgs.raidForceLeft}. A5′ in the direction that
 *     matters here: the record must not credit a victory nobody won.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## What this file does *not* do
 *
 * It computes and it does not move anything. Every seizure, forfeiture and recovery is
 * performed by `predate.ts` through the ledger and the world, and the *measured* result
 * is what goes in the book — never the number below. A5′: the record must never be
 * wrong, and the cheapest guarantee is that the module which decides cannot also write.
 */

import type { HandId, PrincipalId, RaidState, ZoneTier } from '../core/types.js';
import { qty, type Qty } from '../core/units.js';
import type { RaidParty, RaidRecord } from './book.js';
import {
  FORCE_BY_TIER,
  FORCE_PER_HAND,
  RAID_DEMAND_QTY,
  RAID_MAX_TAKE_BPS,
  RAID_TAKE_MULTIPLE,
} from './params.js';

/**
 * Which way a standoff went, before anything has moved.
 *
 * A **narrowing of {@link RaidState}**, not a second union over the same two words: the
 * reading and the recorded outcome are one concept at two moments, and declaring
 * `'REPULSED' | 'PLUNDERED'` twice would be exactly the drift §3 exists to stop.
 */
export type Verdict = Extract<RaidState, 'REPULSED' | 'PLUNDERED'>;

export interface ForceReading {
  readonly defenderForce: number;
  readonly raiderForce: number;
  readonly verdict: Verdict;
  /** The terms, published so an agent can check the sum rather than trust it (A2). */
  readonly terms: {
    readonly defenderHands: number;
    readonly defenderJoiners: number;
    /**
     * ★ **HANDS the DEFENDER joiners have standing here** — the term of the sum, never capped by sway.
     *
     * `defenderJoiners` beside it counts PRINCIPALS. Both are published because they are different
     * findings that one number reports identically: three allies with one hand each and one ally with
     * three read the same force and mean very different things about who turned up.
     */
    readonly defenderAllyHands: number;
    readonly terrain: number;
    /**
     * The raid's own force **as it stands now** — what went into `raiderForce`.
     *
     * Equal to {@link raidForceAtSpawn} until a battle takes hulls off the raid's side of the
     * field. Reported separately from the spawn figure rather than replacing it, because "the
     * world came with 3 and has 1 left" is the whole story and a single number tells neither half.
     */
    readonly raidForce: number;
    /** What the raid was given at spawn, inside `RAID_FORCE`'s published band. Never moves. */
    readonly raidForceAtSpawn: number;
    /** ★ Supplied raider HANDS: `Σ min(hands standing here, sway here)`. See the module header. */
    readonly raiderHands: number;
    readonly raiderJoiners: number;
    /**
     * ★ Raider parties still standing at the stage whose SWAY there is **0**, so their hands
     * bought nothing (§16.12 #1).
     *
     * ══════════════════════════════════════════════════════════════════════════
     * **THIS FIELD IS THE MECHANIC'S METER, AND IT IS HERE BECAUSE OF THE PROJECT'S DEFECT.**
     * A capacity limit that never binds is indistinguishable from one that is missing, in every
     * report and to every reader. `raiderJoiners` counts what was *bought*; this counts what was
     * *refused for being out of reach*, and the two are different findings that a single number
     * reports identically. If this is 0 in every world forever, the reach half of §16.12 #1 is a
     * label and this field is what says so.
     * ══════════════════════════════════════════════════════════════════════════
     *
     * Normally 0 on the demand path, because `demandRefusal` and the `join` gate both refuse a
     * zero-sway raider before a party row exists. It goes positive when reach is **lost during
     * the window** — a claim lapses at a settlement, a holding falls — which is exactly the case
     * a gate at join time cannot cover and the reason the reading is taken again here.
     */
    readonly raidersOutOfSway: number;
  };
}

/**
 * The one force function. Called by the resolver, by the observation, and by the
 * affordance that prices `fight` — so the number an agent is shown before it commits and
 * the number the resolver uses are literally the same call (scar #1).
 *
 * `defenderHands` is passed in rather than counted here because commitment has one home
 * and it is not this module: the target's own committed hands are held by
 * `predate.ts`'s port, and a second count here would be scar #5.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A JOINER COUNTS ONLY WHILE ITS HAND IS STILL STANDING THERE**, and
 * {@link ForceArgs.handsAtStage} is what makes that true rather than assumed. It is a
 * required argument on purpose: the first version counted `raid.parties` by side alone,
 * and a verifier walked straight through the hole it left —
 *
 *   join at tick 49, `move` the hand out at tick 71, resolve at tick 72. The party row
 *   still said `+1`, so the joiner bought force with a hand that was a system away, and
 *   `routHand` then found it `IN_TRANSIT` and declined to rout it. A raider dodged the
 *   hand half of its stake-and-hand risk; a **defender joiner, which stakes no capital at
 *   all, dodged its risk entirely and could grant a free repulse forever.**
 *
 * The target's own hands were always re-counted at resolution (`handsDefending`), so the
 * asymmetry also broke the one rule the book states in as many words — *"force is per
 * hand; capital buys none"* (`book.ts`) and *"one hand is one unit of simultaneous
 * presence"* (§3). A hand that is elsewhere is not presence.
 * ══════════════════════════════════════════════════════════════════════════
 */
export interface ForceArgs {
  readonly raid: RaidRecord;
  readonly tier: ZoneTier;
  readonly defenderHands: number;
  /**
   * The hands this principal still has **IDLE and present at the raid's stage**. The same
   * `handsDefending` the target's own muster is counted with, so both sides of the sum
   * are measured by one rule at one moment.
   */
  readonly handsAtStage: (principal: PrincipalId) => readonly HandId[];
  /**
   * How much of the raid's **own** force is still on the field, or `null` when nothing is
   * counting it.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE OTHER HALF OF §9A's COUPLING, AND IT IS A PORT RATHER THAN A LOOKUP FOR A REASON.**
   *
   * The answer lives in the engagement book, which is `src/combat/`'s — and `combat` already
   * imports `predation` (`battle.ts` takes a `RaidRecord`, `combat/params.ts` reads
   * `DEMAND_WINDOW_TICKS`). Reaching the other way would be a module cycle, so the conversion from
   * *surviving hulls* to *force* is `combat/battle.ts`'s
   * {@link import('../combat/battle.js').worldForceLeft} — the same file that decided how many
   * hulls a given force fields in the first place, which is what keeps the two directions of one
   * constant in one place (scar #5).
   *
   * **`null` is not zero and the difference is a rule.** `null` means *"no battle is counting this
   * raid's hulls"* — the standoff was never answered FIGHT, or the engagement book has no row for
   * it, or the world's fleet was never fielded at all. In every one of those the drawn scalar
   * stands. Returning 0 there would let a bookkeeping failure, a pruned row, or a full engagement
   * book hand a defender a free repulse it never fought for — a win on the permanent public record
   * that nobody earned, which is A5′ pointed at the other party.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly raidForceLeft: (raid: RaidRecord) => number | null;
  /**
   * ★ How many hands this principal may project **at this raid's stage** — §16.12 #1's
   * capacity-limited projection, read at resolution like every other term in this sum.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **ONLY THE RAIDER SIDE READS IT, AND THAT ASYMMETRY IS THE DESIGN.**
   *
   * §16.1 MUST-3's entire argument for chokepoints is that they *"let a smaller defender exploit
   * interior lines"*. A reach limit that also thinned the defence would be the mechanic inverted:
   * the large distant bloc would keep its advantage and the local holder would lose the one it was
   * supposed to gain. So the target's own hands, and every DEFENDER joiner standing at the stage,
   * are counted exactly as they were before this existed.
   *
   * Stated as the rule the two callers must not re-decide: **offence is projected and must be
   * supplied from ground you hold; defence is present.** `world/sway.ts` is its one home.
   * ══════════════════════════════════════════════════════════════════════════
   *
   * A port rather than a lookup because sway lives in `world/` and `predation` may not import it
   * without a cycle — the same reason `RaidViewPort.marchTo` is a port.
   */
  readonly swayAt: (principal: PrincipalId) => number;
}

export function readForce(args: ForceArgs): ForceReading {
  const stillThere = (party: RaidParty): boolean =>
    args.handsAtStage(party.principal).some((id) => id === party.handId);
  const defendersPresent = args.raid.parties.filter((p) => p.side === 'DEFENDER' && stillThere(p));
  const defenderJoiners = defendersPresent.length;
  // Allies in HANDS, no sway cap — defence is present, offence is supplied. See the header.
  const defenderAllyHands = defendersPresent.reduce(
    (n, p) => n + args.handsAtStage(p.principal).length,
    0,
  );
  // ── ★ §16.12 #1: A RAIDER'S HANDS COUNT ONLY WITHIN ITS SWAY ──────────────
  //
  // `stillThere` is presence — the hand is standing at the stage. Sway is *supply*: whether that
  // hand is close enough to ground its principal holds to be force rather than a tourist. Both are
  // required on the raider's side and only presence is required on the defender's, for the reason
  // written out on `ForceArgs.swayAt`.
  const raidersPresent = args.raid.parties.filter((p) => p.side === 'RAIDER' && stillThere(p));
  // ── ★ HANDS, CAPPED BY SWAY — the same `min(present, sway)` a campaign PULSE uses ──
  //
  // See the header. `handsAtStage` is the IDLE-and-present set, the identical predicate the target's
  // own muster is counted with, so both sides of the comparison are in hands. A party whose sway is 0
  // contributes 0 through the `min` rather than through a separate filter — one arithmetic, and the
  // gate is still exactly the published one.
  const raiderHandsOf = (p: RaidParty): number =>
    Math.max(0, Math.min(args.handsAtStage(p.principal).length, args.swayAt(p.principal)));
  const raiderHands = raidersPresent.reduce((n, p) => n + raiderHandsOf(p), 0);
  const raiderJoiners = raidersPresent.filter((p) => args.swayAt(p.principal) >= 1).length;
  const terrain = FORCE_BY_TIER[args.tier] ?? 0;

  // The raid's own force, re-measured — capped at what it was given, so a battle can only ever
  // take strength off the board and never put any on it.
  const left = args.raidForceLeft(args.raid);
  const raidForce = left === null ? args.raid.force : Math.min(args.raid.force, Math.max(0, left));

  const defenderForce =
    FORCE_PER_HAND * Math.max(0, args.defenderHands) + FORCE_PER_HAND * defenderAllyHands + terrain;
  const raiderForce = raidForce + FORCE_PER_HAND * raiderHands;

  return {
    defenderForce,
    raiderForce,
    // Ties to the defender. Stated once, here, and nowhere else.
    verdict: defenderForce >= raiderForce ? 'REPULSED' : 'PLUNDERED',
    terms: {
      defenderHands: Math.max(0, args.defenderHands),
      defenderJoiners,
      /** ★ HANDS those joiners have standing here — the term of the sum. Never capped by sway. */
      defenderAllyHands,
      terrain,
      raidForce,
      raidForceAtSpawn: args.raid.force,
      /**
       * ★ Supplied raider HANDS — `Σ min(hands standing here, sway here)`. **The term of the sum.**
       *
       * Published because it is what changed and because an agent that reads `raiderJoiners` alone
       * cannot tell a coalition of three that brought one hand each from one principal that brought
       * three. It is also the meter on the fix: if this never exceeds `raiderJoiners` in any world,
       * nobody ever marched a second hand and the change bought nothing.
       */
      raiderHands,
      raiderJoiners,
      raidersOutOfSway: raidersPresent.length - raiderJoiners,
    },
  };
}

/**
 * The demand, clamped into the published band.
 *
 * A pure function of the seeded draw and **not** of what the target holds — see
 * {@link RAID_DEMAND_QTY} for why that is a §11.2 decision rather than a calibration
 * one. Integer arithmetic throughout, because the result is pinned into a hashed record
 * and DET-7 bans floats from anything hashed.
 */
export function demandFor(draw: number): Qty {
  return qty(Math.max(RAID_DEMAND_QTY.min, Math.min(RAID_DEMAND_QTY.max, Math.floor(draw))));
}

/**
 * What a raid takes when it is not paid, given what the target *still* has.
 *
 * Two caps, and both matter:
 *
 *   - the multiple of the demand — the price of silence, and the reason paying strictly
 *     dominates ignoring;
 *   - {@link RAID_MAX_TAKE_BPS} of what is actually there — so "offline costs
 *     opportunity, never catastrophe" (§1.1) is arithmetic rather than a hope.
 *
 * And `standingNow`, never the demand: a raid that guesses wrong hits ballast, which is
 * exactly what §11.2's `SENSED` cargo tier is *for*. The target that emptied the place
 * during the window loses nothing, and that is the reward for reading the schedule.
 */
export function takeFor(demand: Qty, standingNow: Qty): Qty {
  if (standingNow <= 0) return qty(0);
  const byMultiple = demand * RAID_TAKE_MULTIPLE;
  const byCap = Math.floor((standingNow * RAID_MAX_TAKE_BPS) / 10_000);
  return qty(Math.max(0, Math.min(byMultiple, byCap, standingNow)));
}

/** What a raid takes when the target pays: exactly the demand, capped at what is there. */
export function payFor(demand: Qty, standingNow: Qty): Qty {
  return qty(Math.max(0, Math.min(demand, Math.max(0, standingNow))));
}
