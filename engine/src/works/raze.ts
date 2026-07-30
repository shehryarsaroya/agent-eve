/**
 * RAZING — what it takes to end a WORKS, and what is left standing when one ends.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE HOLE THIS CLOSES.** Goods are produced, hulls are built, hulls die permanently — and
 * *nothing destroyed a WORKS*. So the economy had no replacement demand: once everybody had built,
 * production capacity only ever went up, and a war's prize was ground that arrived with its
 * factories intact. `Book.raze` was written, captured, restored and **never called** for the
 * project's whole life; the three `razed` filters in `book.ts` were no-ops, and the rebuild half of
 * the loop was already wired and unreachable (`cast/heuristic.ts:worksFor` gates on `ofPrincipal`,
 * which filters `razed`, so a member that loses one builds another the moment one can fall).
 *
 * This module is the decision. **It computes and it moves nothing** — the same port-and-adapter
 * split `refine.ts` is the worked example of and `predation/resolve.ts` states as a rule: a module
 * that both decided and wrote could record a razing it had not performed, and a razed WORKS is a
 * permanent public fact about a real agent's capital (A5, A5′).
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## Who may raze, and the one rule both callers share
 *
 * Two callers, one predicate, one constant — deliberately, because two spellings of "won by enough
 * to burn it" would diverge the first time either moved (scar #5):
 *
 *   - **A raid resolved `PLUNDERED`** (`predation/predate.ts`). Rides the raid spawn clock —
 *     `RAID_SPAWN_PHASES` = 48 · 120 · 192 of every 288-tick Reckoning, drawn by the world and
 *     dodgeable by nobody (A14). Agent-initiated through `demand`, world-initiated otherwise.
 *   - **A campaign `BREACH`** (`campaign/pulse.ts`). Rides the Charge clock at
 *     `CAMPAIGN_PULSE_PHASE`, once per Reckoning. This is the asymmetry the mechanic exists to
 *     close: three breaches took a SUPPLIED claim and the ground changed hands **with its
 *     production untouched**, so winning a war destroyed nothing and nobody had to rebuild.
 *
 * ## Why a MARGIN and not simply "the winner burns it"
 *
 * Because a raid is a smash-and-grab and a WORKS is 60,000 minor plus 5,000 goods. A rule that
 * razed on every `PLUNDERED` would price a 2,000–6,000 goods demand at the cost of a structure,
 * fire on all three spawns every Reckoning, and take production down faster than the world could
 * rebuild it — the one plausible way to make the Levy unpayable.
 *
 * {@link RAZE_FORCE_MARGIN} makes razing what a **rout** does rather than what a win does, and
 * three properties fall out of that, each load-bearing:
 *
 *   - **A defender that musters anything at all keeps its works**, even when it loses the goods. So
 *     the margin is the reason to bring hands to a standoff you already know you cannot win, which
 *     is `join`'s demand side (§9's escort market) priced in something other than pride.
 *   - **It is arithmetic an agent can do before it commits** (A2). `readForce` publishes both sums
 *     and `RAZE_FORCE_MARGIN` is a published constant, so `yield` vs `fight` is a decision about a
 *     known number rather than a gamble — and `worksAtRisk` below is that number, offered on the
 *     affordance so the choice is legible rather than discoverable.
 *   - **It never punishes reading the schedule.** `resolve.ts` promises that a target which empties
 *     a place during the window "loses nothing, and that is the reward for reading the schedule";
 *     razing on an *empty* stage would have inverted that documented reward, so it does not. What
 *     is razed is decided by force, never by what the raid failed to find.
 *
 * ## A8, and why the Commons answer is INVALID rather than a refusal
 *
 * A8: in the Commons hostile action is **invalid, not merely punished**, and it never expires. So a
 * Commons WORKS is unrazable *here*, in the one function both callers go through, rather than in
 * two guards that could drift apart — and the sentence says which axiom did it, because a refusal
 * that only failed would leave an agent unable to tell "safe by rule" from "safe by luck". A8 is a
 * floor an agent should be able to *plan* on.
 *
 * The Commons branch is defence in depth rather than the only guard, and that is on purpose. The
 * campaign path cannot reach a Commons system at all (`declare.ts` refuses a Commons objective as
 * INVALID, and `claim.ts` refuses a Commons claim, so there is no objective to press) and the raid
 * path stages outside the Commons (`target.ts` draws only non-COMMONS lots). Both of those are one
 * edit away from being wrong, in a file whose author would have no reason to think about structures.
 *
 * ## A15: what a razing costs, by path — and the one number worth a second look
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A15 says a gate priced in *identities* is unpriced, so each road here has to be priced in produced
 * goods, slashable capital, or an independently-capitalised counterparty. Three roads:
 *
 *   1. **A world-spawned raid.** No agent pays anything because no agent acts — this is weather on
 *      `RAID_SPAWN_PHASES`, which is A14's whole point. Nothing to price.
 *   2. **A campaign.** `CAMPAIGN_BOND_MINOR` is 2× `CLAIM_BOND_MINOR` and forfeit on failure, plus
 *      `PULSE_MATERIEL_QTY` of produced goods destroyed per pulse at a depot one lane out. Priced in
 *      both of A15's admissible currencies, heavily.
 *   3. **An agent's `demand`.** One unit of `aggression.ts` capacity, which is per-principal,
 *      **non-transferable and expires unspent** — so N enrolments buy N separate small threats rather
 *      than one large one, exactly as that module argues.
 *
 * **The number to keep an eye on is on road 3, and it is not the capacity.** `DEMAND_OWN_FORCE` is 0,
 * so all of a demand's force is hands: the initiator's own party row is 1, terrain at the MARCHES is
 * 1, and {@link RAZE_FORCE_MARGIN} is 2 — so **a lone demand cannot raze anything**, and razing by an
 * agent's own act needs the initiator plus two joiners. That is §9's escort market running in the
 * aggressive direction and it is the right shape.
 *
 * What it means numerically is that two `join`s at `RAID_JOIN_STAKE_MINOR` (500 each, forfeit to the
 * target on a repulse, plus a hand routed) are what convert one aggression spend into the destruction
 * of a 65,000 structure. Those joiners do stake slashable capital and do risk a hand, so this is A15's
 * third category rather than "acquire another account" — **but 1,000 of at-risk capital against 65,000
 * of certain capital is a wide gap, and it is wide because `join` was priced when the largest thing a
 * standoff could take was goods.** Nothing here changes that price; this note exists so that whoever
 * revisits `RAID_JOIN_STAKE_MINOR` knows razing is now on the other side of the scale, and so the gap
 * is a recorded observation rather than something the next reader has to rediscover.
 * ══════════════════════════════════════════════════════════════════════════
 */

import type { PrincipalId, SystemId, ZoneTier } from '../core/types.js';
import { compareIds } from '../ledger/order.js';
import type { WorksId } from './book.js';

/**
 * How far an assault must win by before it can end a structure rather than only take goods. *(calibrate)*
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **FOUR, AND IT WAS TWO UNTIL THE TESTS FOUND WHAT TWO ACTUALLY MEANT.** The first version
 * reasoned "two hands' worth, and `FORCE_BY_TIER` gives the defender terrain, so the margin
 * compounds with the map." **That last clause is false on the tier it matters on:**
 * `FORCE_BY_TIER.FRONTIER` is **0** — deliberately, because *"the Marches are policed and the
 * Frontier is not"* — so an undefended Frontier target reads force 0, the drawn `RAID_FORCE` band is
 * 2–5, and the margin was **met by every possible draw**. On the deepest ground in the game, the
 * gate did not exist.
 *
 * Measured, and this is how it was caught rather than reasoned: `test/combat/the-cast-goes-to-war`
 * went red on seed `g24`. `p:brannock`'s Frontier WORKS was razed at tick 360; `engage` fell from 2
 * to **0** and two-sided battle lines from 202 to **0** — A13's combat signature deleted, because
 * razing had removed the only cast member standing outside the Commons. `test/cast/the-cast-takes-
 * ground` went red the same way: fuel extracted 0, since the razed WORKS *was* the world's only
 * Frontier production. **Three of nine swept seeds razed, and the holder was `p:brannock` on all
 * three** — not a coincidence, but the shape of the bug: raids stage outside the Commons, so razing
 * lands exclusively on whoever has graduated out, which is also whoever carries combat and fuel.
 *
 * ── FOUR IS DERIVED FROM THE SAME NUMBERS `RAID_FORCE` IS ────────────────────
 *
 * `RAID_FORCE`'s own note fixes the frame: *"a principal has exactly three hands (INV-8) and the
 * Marches gives one of terrain, so a solo defence tops out at 4 against a band that reaches 5."* On
 * the Frontier a solo defence tops out at **3**. So, undefended, with `FORCE_PER_HAND` = 1:
 *
 *     tier      terrain   razes at        one hand      two hands
 *     FRONTIER        0   force 4 or 5    force 5       never
 *     MARCHES         1   force 5         never         never
 *     COMMONS         0   never (A8)      —             —
 *
 * That is the property the constant has to have and two did not: **a defender that commits two of
 * its three hands keeps its structure on every tier, against every draw** — while an *undefended*
 * Frontier works still falls on half the band, which is what makes unpoliced ground dangerous
 * without making it indefensible. The Marches stay much safer, which is what "policed" should mean.
 *
 * It is also the largest value that leaves razing reachable at all. At 6 no world raid could ever
 * reach it undefended (the band tops out at 5) and razing would need a coalition every time — which
 * is the *other* failure this module exists to avoid: a capability that exists and is never
 * exercised is indistinguishable from one that is missing.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const RAZE_FORCE_MARGIN = 4;

/**
 * One live WORKS an assault could end, with the only field the decision reads besides its id.
 *
 * `extracted` is carried so the record and THE RUIN can say what was lost in the units the world
 * actually handed over, rather than in a replacement cost nobody paid. It is a cumulative public
 * quantity (`worksLines.extracted` already publishes it), so nothing here widens what is visible.
 */
export interface RazeCandidate {
  readonly id: WorksId;
  readonly system: SystemId;
  readonly holder: PrincipalId;
  readonly extracted: number;
}

/**
 * What an assault did to the production standing at a place.
 *
 * `falls: null` is a first-class answer with its own sentence, never an empty result: "nothing of
 * the defender's stood there", "the margin was not met" and "the Commons forbids it" are three
 * different facts about a war and a record that collapsed them would be a record that lied by
 * omission. `why` is one sentence, names the arithmetic, and editorialises about nothing.
 */
export interface RazeVerdict {
  readonly falls: RazeCandidate | null;
  readonly why: string;
  /**
   * The margin the assault actually carried, `attackerForce - defenderForce`.
   *
   * Published on the verdict rather than recomputed downstream so the row, the event and the
   * refusal all quote one number — and so a reader can check the decision against
   * {@link RAZE_FORCE_MARGIN} without re-deriving either force.
   */
  readonly margin: number;
}

export interface RazeArgs {
  /** The tier of the place under assault. A8's whole enforcement runs off this. */
  readonly tier: ZoneTier;
  readonly system: SystemId;
  /**
   * Live WORKS the losing side holds at this place, in any order.
   *
   * The caller decides *whose* production is at stake and every caller answers the same way: the
   * principal that lost the standoff, and nobody else. Neither path touches a bystander's
   * structure, which is the rule `pulse.ts` already states for capital — *"a bond may not be
   * forfeited to a principal that never chose to be in the war"* — applied to the thing a war
   * would otherwise be free to burn.
   */
  readonly standing: readonly RazeCandidate[];
  readonly attackerForce: number;
  readonly defenderForce: number;
}

/**
 * Decide whether the assault ends a structure, and which one.
 *
 * The branch order is the mechanic: **A8 first** (a Commons WORKS is not a close call, it is
 * outside the rules), then the margin (the commitment), then what is actually there.
 */
export function razeVerdict(args: RazeArgs): RazeVerdict {
  const margin = args.attackerForce - args.defenderForce;

  if (args.tier === 'COMMONS') {
    return {
      falls: null,
      margin,
      why:
        `${args.system} is a COMMONS system, so razing a WORKS standing there is INVALID rather ` +
        'than refused: A8 makes the safe floor permanent and unpriced, and no force reading reaches it',
    };
  }

  if (margin < RAZE_FORCE_MARGIN) {
    return {
      falls: null,
      margin,
      why:
        `the assault carried ${String(args.attackerForce)} against ${String(args.defenderForce)}, a margin of ` +
        `${String(margin)} against the ${String(RAZE_FORCE_MARGIN)} a razing takes; the goods moved and the ` +
        'structures stand',
    };
  }

  // Canonical order, never insertion order and never "the biggest": `WORKS_PER_PRINCIPAL_PER_SYSTEM`
  // is 1 so this picks the only row in every world this rule can currently reach, and `compareIds`
  // is what keeps it deterministic in a world where that cap moves. Picking the largest extractor
  // would make the choice depend on a mutable counter, and two replays that credited production in
  // a different order would raze different structures.
  const ordered = [...args.standing].sort((a, b) => compareIds(a.id, b.id));
  const falls = ordered[0] ?? null;

  if (falls === null) {
    return {
      falls: null,
      margin,
      why:
        `the assault carried a margin of ${String(margin)} at ${args.system} and there was no WORKS of the ` +
        'losing side standing there to end',
    };
  }

  return {
    falls,
    margin,
    why:
      `the assault carried ${String(args.attackerForce)} against ${String(args.defenderForce)}, a margin of ` +
      `${String(margin)} against the ${String(RAZE_FORCE_MARGIN)} a razing takes: ${falls.id} is RAZED after ` +
      `handing its holder ${String(falls.extracted)} units, and ${args.system} loses that production`,
  };
}

/**
 * What a defender stands to lose in structures if this standoff goes against it — for the
 * affordance, before it chooses.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE CONSEQUENCE PREVIEW, WHICH IS A STANDING REQUIREMENT AND NOT A COURTESY.**
 * High Water's `projectedDrown` is the pattern and scar #1 is the reason: the number an agent is
 * shown before it commits and the number the resolver uses must be the *same call*, or the two
 * surfaces drift and the agent-facing one is the one that lies. So this takes the same margin and
 * the same rows as {@link razeVerdict} and answers the question `yield`/`fight` actually turns on —
 * *"does losing this cost me the works as well as the goods?"*
 * ══════════════════════════════════════════════════════════════════════════
 */
export function worksAtRisk(args: RazeArgs): RazeCandidate | null {
  return razeVerdict(args).falls;
}

/**
 * The force a defender needs at this place to move a losing standoff out of raze range.
 *
 * Published so the counterplay is arithmetic rather than folklore (A2): a defender reading its own
 * standoff can see both sums, this number, and what it costs to reach it. Zero when the structures
 * are already safe — including in the Commons, where they always are.
 */
export function forceToSaveWorks(args: {
  readonly tier: ZoneTier;
  readonly attackerForce: number;
  readonly defenderForce: number;
}): number {
  if (args.tier === 'COMMONS') return 0;
  const needed = args.attackerForce - RAZE_FORCE_MARGIN + 1;
  return Math.max(0, needed - args.defenderForce);
}
