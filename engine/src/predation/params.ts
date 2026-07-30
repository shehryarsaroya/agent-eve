/**
 * Predation's published numbers (SPEC §9, §16 step 12).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **EVERY NUMBER HERE IS PUBLISHED TO AGENTS.** A2: known arithmetic is exact and
 * machine-readable, and its corollary — *a formula nobody has written cannot satisfy
 * A2* — is the whole reason this file exists as constants rather than as literals
 * scattered through the resolver. A raid an agent could not see coming, at odds it
 * could not compute, is a dice roll wearing a mechanic's clothes.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The seeded RNG draws exactly two things per raid — the demand inside
 * {@link RAID_DEMAND_QTY} and the raid's own force inside {@link RAID_FORCE} — and both
 * **bands** are published, so an agent knows the worst case before it decides. Nothing
 * else in predation is random: targeting is a published rule (`target.ts`) and
 * resolution is arithmetic (`resolve.ts`).
 *
 * Numbers marked *(calibrate)* are simulation starting points, not claims.
 */

import { TICKS_PER_RECKONING, WINDOW_FIRST_PHASE } from '../core/time.js';
import { bps, minor, qty, type Bps, type Minor, type Qty } from '../core/units.js';

/**
 * The phases of the Reckoning cycle at which the world spawns a raid.
 *
 * Three per Reckoning *(calibrate)*, evenly spread across the working part of the
 * cycle. Published so an agent can plan a convoy around them — which is the point:
 * A14 says drama runs on a clock, and a clock nobody can read is just weather.
 *
 * The last one plus {@link DEMAND_WINDOW_TICKS} must land strictly before the
 * commitment window opens, or a raid would resolve inside the freeze — §5.1 forbids
 * raid resolution there in as many words. {@link assertRaidSchedule} makes that
 * executable rather than a comment, and it runs at construction.
 */
export const RAID_SPAWN_PHASES: readonly number[] = Object.freeze([48, 120, 192]);

/**
 * Ticks between a demand being issued and the standoff resolving. The window.
 *
 * Long enough that an agent with a wake budget can actually read the demand and
 * answer it — §12.4's wake economy means an agent is not looking every tick — and
 * short enough that three fit inside one Reckoning with room to spare. It is also
 * the A5′ floor: {@link raidWindowIsHonest} refuses to resolve a raid whose demand
 * was not readable for this long.
 */
export const DEMAND_WINDOW_TICKS = 24;

/**
 * A principal the world has just raided is off the target list for this long.
 *
 * Scar #14 by name: *"a fresh agent's only asset drowned on turn one"*. SPEC §9 asks
 * for a per-victim cooldown and this is it. One Reckoning *(calibrate)*.
 */
export const RAID_VICTIM_COOLDOWN_TICKS = TICKS_PER_RECKONING;

/**
 * A stage where a raid was **repulsed** is off the target list for this long.
 *
 * This is the world raid's own downside, and it is the only one it has: nobody owns a
 * world raid, so it holds no capital that could be slashed. What it can lose is
 * *future access*, which is the same currency A10 uses to make defection rational at a
 * season boundary. Beating a raid buys a real, published, time-bounded peace at that
 * place — see `resolve.ts` for the honest statement of what this does and does not
 * cover.
 */
export const RAID_STAGE_HELD_TICKS = TICKS_PER_RECKONING;

/**
 * The demand, in units of the good, drawn from this **absolute** band.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **AN ABSOLUTE BAND, NOT A FRACTION OF WHAT THE TARGET HOLDS — AND THAT IS A §11.2
 * DECISION, NOT A CALIBRATION ONE.**
 *
 * The first draft made the demand a published percentage of the target's standing stock.
 * The demand has to be `PUBLIC` (the target must read it, and the raid is the map's
 * motion), and the band has to be published (A2). Together those two would have made the
 * target's stock at that place recoverable from a public event within a fixed multiple —
 * a `SENSED` quantity derived from a public formula and a private stockpile, which is
 * exactly the "Charge fuel gauge" mistake caught in review, in a different mechanic.
 *
 * Drawn from an absolute band, the published demand is a pure function of the seed and
 * carries **zero** information about what the target holds. It also makes §11.2's own
 * promise literally true: *"a raider that guesses wrong hits ballast"* — the raid can
 * demand 6,000 and find 200, because it never knew.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *(calibrate)*: against a 50,000-unit starter allotment and a 20,000-unit Reckoning
 * duty, this is 10–30% of one night's Levy. Enough that a raid can push a principal into
 * `LEVY SHORT`; nowhere near enough to end anyone.
 */
export const RAID_DEMAND_QTY = Object.freeze({ min: qty(2_000), max: qty(6_000) });

/**
 * What resisting and losing — or ignoring — costs, as a multiple of the demand.
 *
 * The three branches have to be genuinely different or the window is not a decision:
 *
 * | branch | cost |
 * |---|---|
 * | **pay** (`yield`) | exactly the demand, at once, no hand risked |
 * | **ignore** | the demand × this multiple, capped at {@link RAID_MAX_TAKE_BPS} |
 * | **resist and lose** (`fight`) | the same, **and** every committed hand goes RECOVERING |
 * | **resist and win** | nothing, and the raid's joiners forfeit their stakes to you |
 *
 * So paying strictly dominates ignoring, which is the intended shape: silence is the
 * expensive answer (A14), and it is expensive in goods and time rather than in
 * identity, standing or a holding.
 */
export const RAID_TAKE_MULTIPLE = 2;

/** No single raid may take more than this fraction of what the target still holds. */
export const RAID_MAX_TAKE_BPS: Bps = bps(5_000);

/**
 * The world raid's own force, in hand-equivalents. Seeded inside a published band.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE TOP OF THIS BAND IS DELIBERATELY ABOVE WHAT ONE PRINCIPAL CAN MUSTER ALONE**,
 * and that is the calibration, not an oversight.
 *
 * A principal has exactly three hands (INV-8) and the Marches gives one of terrain, so
 * a solo defence tops out at **4** against a band that reaches **5**. A principal
 * standing entirely alone therefore cannot guarantee a repulse — it needs one ally on
 * the `DEFENDER` side, and §9 says world raids exist partly to give escorts a guaranteed
 * market. It is also what stops `fight` from being a lookup: at 5 the answer depends on
 * who will stand with you, which is a judgement about other agents, and §1.1 says the
 * best decisions are the ones that are.
 *
 * The agent is never guessing about it: `obligations.raid[].force.verdict_if_resolved_now`
 * publishes the current sum on both sides, exactly (A2).
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *(calibrate)*
 */
export const RAID_FORCE = Object.freeze({ min: 2, max: 5 });

/** Each present, uncommitted hand the defender commits is worth this much force. */
export const FORCE_PER_HAND = 1;

/**
 * Terrain, as a defender's bonus in force. The Marches are policed and the Frontier
 * is not; the Commons is here only so the table is total, and a Commons stage is
 * rejected long before this is read (A8, and `PRD-1` halts on one).
 */
export const FORCE_BY_TIER: Readonly<Record<string, number>> = Object.freeze({
  COMMONS: 0,
  MARCHES: 1,
  FRONTIER: 0,
});

/**
 * The least a principal may stake to join a raid on the raider's side.
 *
 * A7's shape applied to predation: an attacker with nothing at risk is not a
 * character, it is weather. The stake is locked at join and **forfeited to the
 * defender** if the raid is repulsed — forfeiture to the counterparty rather than to a
 * sink, exactly as §7.3 rules for an abandoned slot, because forfeiture to the void is
 * a griefer's bargain.
 */
export const RAID_JOIN_STAKE_MINOR: Minor = minor(500);

/** Force one joiner adds to the side it took. One hand, one unit; capital buys no force. */
export const FORCE_PER_JOINER = 1;

/**
 * The least a principal must have standing at one place, in one good, to be rankable
 * as a target at all. Below it the world does not bother, which keeps a newcomer with a
 * handful of units off the list on structural grounds as well as on the cooldown's.
 */
export const RAID_MIN_TARGET_QTY: Qty = qty(2_000);

/** INV-26: raids live at once. Bounded, because every array in this repo is (scar #3). */
export const MAX_LIVE_RAIDS = 6;

/** INV-26: raid rows retained in the book. Older rows are pruned inside the hash. */
export const MAX_RAID_ROWS = 96;

/**
 * INV-26: parties (both sides) admitted to one raid.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **8 → 12, BECAUSE AT 8 A FORMATION SLOT THE COMBAT LAYER OFFERS COULD NOT BE REACHED.**
 *
 * `MAX_FORMATIONS_PER_SIDE` is 6 and formations coalesce per principal, so six principals a side can
 * field hulls. Reaching that on an agent's `demand` needs the initiator + 5 raider joiners on one side
 * and 5 defender joiners on the other (the target is a party by *being* the target, not by joining) —
 * **11 parties**. At 8 the standoff filled first, so two of the twelve formation slots `engage` offers
 * were unreachable by construction: this project's signature defect, with two caps disagreeing instead
 * of a missing caller. `assertEngagementSchedule` now refuses a build where that is true again, which
 * is the executable version of this paragraph.
 *
 * **12 rather than 11** for one slot of headroom, so a 6-a-side battle can still admit one
 * force-only helper — a defender joiner brings `FORCE_PER_JOINER` with a hand and no hull, and §9
 * says world raids exist partly to give escorts a guaranteed market. A cap that let the hull-bringers
 * in and locked out the last escort would price the market it was built for.
 *
 * ## What the number costs, stated because a bound is a budget
 *
 * `readForce` walks the party list twice and asks `handsAtStage` per party (≤3 hands each), so the
 * per-reading cost is linear: 8 → 12 is 36 hand checks instead of 24, at `MAX_LIVE_RAIDS` = 6 raids ×
 * up to 20 readers. Against a measured 7.7 ms tick that is noise. Resolution gains up to four more
 * `forfeit` transfers per raid, each a real ledger posting. The snapshot gains four party rows per
 * retained raid row. Nothing here is unbounded and INV-26 still asserts the cap.
 *
 * **Balance-neutral in every world measured, and that is a limitation rather than a result:**
 * `heuristic.ts` has **no `join` branch at all**, so no cast sim reaches even 8. The exercised
 * evidence is `combat-sim.ts` phase D, which drives `join` through the verb table at five principals a
 * side. A world whose agents actually rally will be the first to test this number.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const MAX_RAID_PARTIES = 12;

/**
 * INV-26: lots one seizure will walk before it stops, per raid.
 *
 * Bounded for the usual reason (scar #3), and load-bearing for a second one: `PRD-3`
 * verifies a recorded loss by re-reading the postings this many event ids could have
 * produced, so an unbounded walk here would make the A5′ check unbounded too.
 */
export const MAX_SEIZE_LOTS = 16;

export class RaidScheduleError extends Error {}

/**
 * The schedule must be resolvable. Called from the runtime's constructor, never only
 * from a test.
 *
 * A world whose clock makes a spawned raid resolve inside the freeze must not start:
 * §5.1's freeze is "hard — no raid resolution", so such a raid could only ever be
 * silently dropped or illegally resolved, and both are a permanent public fact about a
 * real agent that the rules made impossible to avoid. This is `assertSealSchedule`'s
 * argument with a different mechanic in it.
 */
export function assertRaidSchedule(): void {
  const problems: string[] = [];
  if (RAID_SPAWN_PHASES.length === 0) {
    problems.push('no spawn phase: the world would never spawn a raid and A14 would be unmet');
  }
  // The window opens at WINDOW_FIRST_PHASE; a raid must resolve strictly before it, so
  // that no raid resolution, hand commitment or seizure ever lands in the commitment
  // window, the freeze, or the settlement tick.
  //
  // Read from `core/time.ts` since `RULES_VERSION` 38. It was `TICKS_PER_RECKONING - 1 - 1 - 24` —
  // a hand-inlined copy of `WINDOW_FIRST_PHASE`'s own definition, in a comment that names the
  // constant it declined to import. Both were 262, and the `24` was the most dangerous character in
  // this file: it is `COMMITMENT_WINDOW_TICKS`, but `DEMAND_WINDOW_TICKS` two hundred lines up is
  // ALSO 24 and is used eight lines below, so the literal read as either constant and the schedule
  // guard was one edit from passing a raid that resolves inside §5.1's hard freeze.
  const lastResolvable = WINDOW_FIRST_PHASE;
  let previous = -1;
  for (const phase of RAID_SPAWN_PHASES) {
    if (!Number.isSafeInteger(phase) || phase < 0 || phase >= TICKS_PER_RECKONING) {
      problems.push(`spawn phase ${String(phase)} is outside the Reckoning cycle`);
      continue;
    }
    if (phase <= previous) {
      problems.push(`spawn phases must be strictly ascending; ${String(phase)} follows ${String(previous)}`);
    }
    previous = phase;
    const resolves = phase + DEMAND_WINDOW_TICKS;
    if (resolves >= lastResolvable) {
      problems.push(
        `a raid spawned at phase ${String(phase)} resolves at phase ${String(resolves)}, which is inside the ` +
          `commitment window or later; §5.1's freeze is hard and admits no raid resolution`,
      );
    }
  }
  if (RAID_DEMAND_QTY.min > RAID_DEMAND_QTY.max) {
    problems.push('the demand band is inverted, so no demand could be drawn from it');
  }
  if (RAID_DEMAND_QTY.min <= 0) {
    problems.push('a demand of zero is not a demand; the window would resolve on nothing');
  }
  if (RAID_FORCE.min > RAID_FORCE.max) {
    problems.push('the force band is inverted, so no raid could be given a strength');
  }
  if (RAID_TAKE_MULTIPLE < 1) {
    problems.push(
      `RAID_TAKE_MULTIPLE is ${String(RAID_TAKE_MULTIPLE)}: ignoring a demand would cost less than paying it, ` +
        'so the window would not be a decision',
    );
  }
  if (problems.length > 0) {
    throw new RaidScheduleError(`the raid schedule is unusable:\n  - ${problems.join('\n  - ')}`);
  }
}
