/**
 * What an agent reads about predation, and what a viewer sees.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **§11.2, ENFORCED BY WHAT THIS FILE CAN SEE.** A raid in progress is `PUBLIC` — it is
 * the map's motion, and the map is the show. What the target actually *holds* is
 * `SENSED`, so nothing here is derived from a stockpile: the demand is a seeded draw
 * from a published band, the forces are counts of hands and joiners, and the outcome is
 * what the ledger moved. There is no field on {@link RaidView} or {@link RaidLine} that
 * a stranger could invert to learn what is in someone's hold.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A9 holds the same way it holds for the event feed: the viewer's value
 * ({@link raidLinesFor}) is built from the same rows as the agent's
 * ({@link raidViewsFor}) and carries strictly fewer fields, so a viewer can never be
 * shown a live fact a non-party agent's own `observe` would not contain.
 */

import type { HandId, PrincipalId, SystemId, ZoneTier } from '../core/types.js';
import type { Minor, Qty } from '../core/units.js';
// The frame contract owns the line's shape, and this module fills it. One home per
// rules surface: a second `RaidLine` declared here would be the same pixel signature
// described twice, and the two would drift the first time a field was added.
import type { RaidLine } from '../frames/contract.js';
// The razing preview, and it is the resolver's own call rather than a copy of it (scar #1).
import { forceToSaveWorks, worksAtRisk, type RazeCandidate } from '../works/raze.js';
import type { Book, RaidRecord, RaidState } from './book.js';
import { RAID_JOIN_STAKE_MINOR, RAID_TAKE_MULTIPLE } from './params.js';
import { payFor, readForce, takeFor } from './resolve.js';

/**
 * One raid, as the agent reads it. Every number an agent needs to price its three
 * options, and none it would have to derive.
 *
 * `if_you_do_nothing` is High Water's `projectedDrown` pattern, which this repo ships as
 * a standing requirement rather than a nicety: the consequence of silence is stated in
 * the same payload as the options, because the whole mechanic is a decision under a
 * clock and an agent that cannot price *not deciding* is not making one.
 */
export interface RaidView {
  readonly raid: string;
  readonly stage: SystemId;
  readonly target: PrincipalId;
  /**
   * Who opened it, or `null` for a world raid — **and this changes what the reader should do.**
   *
   * A world raid cannot be negotiated with, because nobody owns it; a demand has somebody at
   * the other end who can be talked to, joined against, or remembered. Telling an agent only
   * that "a raid is here" would leave it unable to tell the two apart, and the second one is
   * the whole of §9's agent-initiated form.
   */
  readonly initiator: PrincipalId | null;
  readonly good: string;
  readonly demand: Qty;
  readonly state: RaidState;
  readonly spawned_tick: number;
  readonly resolves_tick: number;
  readonly ticks_left: number;
  /** Your side, if you are in it. Null when you are only watching. */
  readonly your_side: 'TARGET' | 'RAIDER' | 'DEFENDER' | null;
  readonly answer: string | null;
  /** The force arithmetic as it stands **right now** — recomputed, never cached. */
  readonly force: {
    /** The whole raider sum: `raid_force_left` + one per joiner still standing on that side. */
    readonly raider: number;
    /**
     * The raid's **own** force still on the field, and the reason `engage` is worth an action.
     *
     * ══════════════════════════════════════════════════════════════════════
     * **A WORLD RAID'S FLEET IS PART OF ITS FORCE, AND KILLING IT LOWERS THIS NUMBER.** It used
     * to be a scalar drawn at spawn that nothing could touch, so a defender that destroyed every
     * hull the world brought faced the identical reading and lost the standoff anyway. That made
     * fighting the weather all downside and YIELD the only rational answer.
     *
     * Published as its own field rather than folded into {@link raider} because an agent pricing
     * `engage` needs to see the *component its hulls can move*. It falls one point per world hull
     * destroyed (`WORLD_FLEET.hullsPerForce` = 1) and never rises above
     * {@link raid_force_at_spawn}. On an agent's `demand` it is 0 and stays 0: a demand brings no
     * force of its own — all of it is hands, counted the same way.
     * ══════════════════════════════════════════════════════════════════════
     */
    readonly raid_force_left: number;
    /** What the raid was given at spawn, from `RAID_FORCE`'s published band. Never moves. */
    readonly raid_force_at_spawn: number;
    readonly defender_if_you_fight: number;
    /**
     * ★ How much of {@link defender_if_you_fight} is somebody **else's** hands.
     *
     * Published because without it the sum cannot be decomposed, and a target that cannot decompose
     * it cannot answer the one question a coalition creates: *how many of my own hands must stay
     * standing here?* `defender_if_you_fight` is `FORCE_PER_HAND × your hands + FORCE_PER_JOINER ×
     * joiners + terrain`, and with `terrain` alone published a reader must treat every ally's hand as
     * one of its own — which reserves hands it does not have and, read the other way, hides the fact
     * that help arrived.
     *
     * `PUBLIC` on the tier it already had: `raid.joined` publishes the joiner, its side and its
     * stake at `publicAt: tick`, and `RaidLine.defenders` draws the same names on the frame.
     *
     * Counted the way the resolver counts it — **joiners whose hand is still standing at the stage**,
     * from the one `readForce` call — so an ally that marched away is already gone from this number
     * rather than gone at resolution and a surprise.
     */
    readonly defender_joiners: number;
    /** ★ The same for the other end of the arc. Its stake is public; so is its presence. */
    /**
     * ★ **SUPPLIED RAIDER HANDS** — `Σ min(hands standing here, sway here)`, the term of the sum.
     *
     * ══════════════════════════════════════════════════════════════════════
     * The raider's sum used to be one point per PRINCIPAL, so a blind player stood at the stage with
     * `your_sway: 3` and two IDLE hands and read `force.raider: 1` with no verb that could change it.
     * This is the field that number now comes from, and `raider_joiners` beside it is the count of
     * principals — a coalition of three bringing one hand each and one principal bringing three read
     * `3` here and differ there, which is the distinction a reader pricing `join` actually needs.
     * ══════════════════════════════════════════════════════════════════════
     */
    readonly raider_hands: number;
    readonly raider_joiners: number;
    readonly terrain: number;
    readonly verdict_if_resolved_now: 'REPULSED' | 'PLUNDERED';
    /**
     * ★ §16.12 #1: how many of the READER's own hands would count as force at this stage.
     *
     * A term of {@link raider} for anybody on the raider's side, and **not** a term of
     * {@link defender_if_you_fight} for anybody on the defender's — offence is projected and must
     * be supplied from ground you hold; defence is present. `world/sway.ts` carries the argument
     * and `predation/resolve.ts`'s `ForceArgs.swayAt` carries the reason a chokepoint that thinned
     * the defence would invert the mechanic it came from.
     */
    readonly your_sway: number;
    /** ★ Your own IDLE hands standing at the stage now. The cap is {@link your_sway}; this is the fill. */
    readonly your_hands_here: number;
    /**
     * ★ Raider hands standing here that SWAY did not let count — the mechanic's meter.
     *
     * Published rather than left implicit because `raider` alone cannot distinguish *"nobody
     * came"* from *"three came and none of them could be supplied"*, and those are the two
     * different stories §16.12 #1 exists to make possible.
     */
    readonly raiders_out_of_sway: number;
  };
  /** Exact, never an estimate (A2). What each branch costs the target. */
  readonly costs: {
    readonly pay: Qty;
    readonly if_you_do_nothing: Qty;
    readonly join_stake: Minor;
    /**
     * ★ The WORKS this standoff would END if it resolved now, or `null` when none would.
     *
     * ══════════════════════════════════════════════════════════════════════
     * **THE THIRD THING A RAID CAN TAKE, AND THE ONE THAT WAS NOT PRICED.** `pay` and
     * `if_you_do_nothing` are both quantities of GOODS; a razing costs a structure —
     * `WORKS_COST_MINOR` plus `WORKS_BUILD_QTY`, and every tick of `YIELD_PER_TICK` it would have
     * extracted afterwards. An agent choosing between `yield` and `fight` off a menu that only
     * priced goods would be choosing with the largest number missing.
     *
     * Computed by {@link import('../works/raze.js').worksAtRisk}, which IS
     * {@link import('../works/raze.js').razeVerdict} — literally the same call the resolver makes,
     * not a second arithmetic. Scar #1 is the reason that is structural rather than careful: two
     * individually-correct surfaces disagreeing about one number survived a full build and three
     * critic passes.
     *
     * `null` covers all three refusals, and {@link save_works_force} is what distinguishes them: in
     * the Commons nothing is ever at risk and the force to save is 0.
     * ══════════════════════════════════════════════════════════════════════
     */
    readonly works_at_risk: string | null;
    /**
     * How much MORE defender force it takes to move the structures out of raze range.
     *
     * The counterplay as a number rather than as folklore (A2), and it is the reason to bring hands
     * to a standoff already lost: a defender that reaches this keeps its production even though the
     * goods still go. **Zero** means nothing needs saving — either the margin is already unreachable
     * or the stage is in the Commons, where A8 makes razing invalid outright.
     */
    readonly save_works_force: number;
  };
  readonly lost: Qty;
  readonly forfeited: Minor;
  /**
   * ★ How this reader would **get there**, or `null` when it is already standing at the stage.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **`join` HAD AN AFFORDANCE AND AN UNREACHABLE PRECONDITION, WHICH IS THIS PROJECT'S SIGNATURE
   * DEFECT ONE STEP OUT: THE MENU WAS RIGHT AND THE MENU WAS EMPTY.**
   *
   * The rule below this interface widened once already, from *"raids you are a party to"* to
   * *"…plus live ones where you have an IDLE hand at the stage"*, and the comment on it states
   * exactly why: *"§9's argument for world-spawned predation is that it gives escorts a guaranteed
   * market, and a market nobody can see the demand side of is not one."* True, and the radius was
   * still wrong. Measured on 8 seeds × 3 Reckonings of a world nobody steers: **72 raids, and 0 of
   * them ever had a non-target principal with an IDLE hand at the stage.** 70% of every cast
   * member's hand-ticks are `COMMITTED` to a venture role and its hands are mostly not even at its
   * own body, so the one condition that made a `join` affordance appear was satisfied zero times in
   * the project's whole history. `MAX_RAID_PARTIES` is 12 and no standoff had ever had one party.
   *
   * The same measurement says where the material actually is: **49 of those 72 windows had a
   * bystander holding an IDLE hand within two lanes of the stage**, and `GATE_TRANSIT` intra-
   * constellation is 2–6 ticks against a 24-tick window. So the escort market's demand side was
   * visible to nobody and its supply side was two ticks away.
   *
   * `march` is the fix, and it is deliberately **not** a `join` affordance for a hand that is not
   * there — that would be a move the handler refuses (AGT-S2), which costs an agent an action and
   * its trust in the menu. It is the arithmetic of *getting* there: which hand, the next gate, and
   * the tick it would arrive, against `resolves_tick`. High Water's `projectedDrown` pattern applied
   * to a standoff — the consequence of *not* deciding is already on `costs.if_you_do_nothing`, and
   * this is the cost of the only decision that was previously invisible.
   *
   * **The tier is honest and unchanged.** A live raid is `PUBLIC` — it is the map's motion — and
   * `raidLinesFor` has always published every one of them to the spectator frame, so by A9 an
   * agent's own `observe` was already entitled to it. What was narrow was convenience, and what
   * convenience cost was the whole mechanic.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly march: RaidMarch | null;
}

/**
 * The route one IDLE hand would take to a standoff it is not standing in.
 *
 * Every field is a fact the reader owns or the map publishes; nothing here is derived from anything
 * `SENSED`. `arrives_tick` is the ETA at the **stage**, not at the next gate: a two-lane march is
 * two actions and an agent that budgeted for one would arrive to find the window shut.
 */
export interface MarchRoute {
  readonly hand: HandId;
  readonly from: SystemId;
  /** The next gate — the `to` of a `move` that starts the march. One lane per action. */
  readonly next: SystemId;
  /** Lanes still to cross, including this one. */
  readonly hops: number;
  /** The tick that hand would be standing at the stage, if it left now and never stopped. */
  readonly arrives_tick: number;
}

/**
 * A route, plus the one comparison the route alone cannot make.
 *
 * `in_time` is on the **view** and not on {@link MarchRoute} because it is a fact about a
 * particular standoff's clock, and the port that finds the route does not know which raid is
 * asking. Two homes for that comparison would let a filter and an affordance disagree about whether
 * a march is worth starting.
 */
export interface RaidMarch extends MarchRoute {
  /** `arrives_tick <= resolves_tick`. The whole of whether the hand would matter. */
  readonly in_time: boolean;
}

/**
 * What the observation needs from the world to price a live raid.
 *
 * A strict subset of `PredationPort`, and it is declared as a separate interface that
 * the port **extends** rather than as a second set of methods: the number an agent is
 * shown before it commits and the number the resolver uses must come from one
 * implementation, or the affordance and the outcome can disagree — which is scar #1 with
 * a hand and a hold at stake.
 */
export interface RaidViewPort {
  tierOf(system: SystemId): ZoneTier;
  /** The target's own present, IDLE hands at the stage — the force a `fight` musters. */
  handsDefending(principal: PrincipalId, stage: SystemId): readonly HandId[];
  /** What the reader still has at the stage in the raided good. Its OWN stock only. */
  standingOf(principal: PrincipalId, stage: SystemId, good: string): Qty;
  /**
   * Live WORKS this principal holds at the stage — what a rout would end.
   *
   * On the **view** port as well as on `PredationPort`, for the same reason `raidForceLeft` is on
   * both: this is the number that decides whether `fight` is worth an action, and an observation
   * that showed a different set from the resolver's would be scar #1 with a structure at stake.
   */
  worksAt(principal: PrincipalId, system: SystemId): readonly RazeCandidate[];
  /**
   * How much of the raid's own force is still on the field, or `null` when nothing counts it.
   *
   * On the **view** port and not only on `PredationPort`, deliberately: this is the number that
   * decides whether committing a fleet is worth anything, and an observation that showed the
   * spawn scalar while the resolver used the survivors would be scar #1 with a hold at stake.
   * {@link import('./resolve.js').ForceArgs.raidForceLeft} carries the full argument.
   */
  raidForceLeft(raid: RaidRecord): number | null;
  /**
   * ★ The nearest IDLE hand this principal could walk to `stage`, and when it would arrive.
   *
   * `null` when there is none that may legally get there — no IDLE hand, no route, or a hand the
   * Commons bind holds where it is (`world/movement.ts`). The **engine's** movement rule, asked
   * live, rather than a tier comparison this module could get wrong: the launch map's first
   * constellation is mixed, and a copy of that rule has already cost this repo a member that could
   * never reach the one place its Levy was payable at.
   *
   * On the view port for {@link RaidView.march}'s reason, and it is a port rather than a lookup
   * because routing lives in `world/` and predation may not import it without a cycle.
   */
  marchTo(principal: PrincipalId, stage: SystemId, tick: number): MarchRoute | null;
  /**
   * ★ §16.12 #1: hands this principal may **project** at `stage` (`world/sway.ts`).
   *
   * On the **view** port and not only on the resolver's, for `raidForceLeft`'s reason and more
   * sharply: `RaidView.march` publishes a route to a standoff, and a march that arrives somewhere
   * the walker's force counts for nothing is the AGT-S2 defect with a hand spent on it. The view
   * now states the reading beside the route, so *"can I get there in time"* and *"will it matter
   * when I do"* are answered together.
   */
  swayAt(principal: PrincipalId, stage: SystemId): number;
}

/** One home for "would that hand get there before the window shuts". */
function marchFor(route: MarchRoute | null, resolvesAtTick: number): RaidMarch | null {
  if (route === null) return null;
  return { ...route, in_time: route.arrives_tick <= resolvesAtTick };
}

/**
 * Raids this principal can see: the ones it is **in**, and the live ones it could
 * **reach**.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE SECOND CLAUSE IS NOT A CONVENIENCE — WITHOUT IT THERE IS NO ESCORT MARKET.**
 *
 * The first draft returned only raids the reader was a party to, and a test found the
 * consequence immediately: a bystander standing at the stage with three idle hands was
 * offered no `join` affordance and shown no row, so the only way to help a neighbour was
 * to already know the raid id from the event feed. §9's argument for world-spawned
 * predation is that it *"gives escorts a guaranteed market"*, and a market nobody can see
 * the demand side of is not one.
 *
 * The tier is honest: a live raid is `PUBLIC` (it is the map's motion), and having a hand
 * at the stage is literally §11.2's `SENSED` clause — *"whoever has a hand in range"*. So
 * this widens what is *convenient*, not what is *permitted*.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Still deliberately **not** every raid in the world: a list of standoffs three
 * constellations away is a briefing an agent has to filter before it can act, and the cap
 * keeps the payload bounded (INV-26).
 */
export function raidViewsFor(args: {
  readonly book: Book;
  readonly port: RaidViewPort;
  readonly principal: PrincipalId;
  readonly tick: number;
  readonly limit: number;
}): readonly RaidView[] {
  const mine = new Set(args.book.forPrincipal(args.principal).map((r) => r.id));
  const own: RaidRecord[] = [];
  const reachable: RaidRecord[] = [];
  for (const raid of args.book.all()) {
    if (mine.has(raid.id)) {
      own.push(raid);
      continue;
    }
    if (raid.state !== 'DEMANDED') continue;
    if (args.port.handsDefending(args.principal, raid.stage).length > 0) {
      reachable.push(raid);
      continue;
    }
    // ── ★ THE THIRD CLAUSE: A STANDOFF A HAND COULD STILL WALK TO IN TIME ──────
    //
    // {@link RaidView.march} carries the measurement that forced it into existence. Gated on
    // `in_time` and not merely on reachability, because a row for a standoff that will have
    // resolved before the hand arrives is a briefing an agent has to filter, which is the exact
    // objection this function's own comment raises against returning every raid in the world.
    const march = marchFor(args.port.marchTo(args.principal, raid.stage, args.tick), raid.resolvesAtTick);
    if (march !== null && march.in_time) reachable.push(raid);
  }
  // Own rows first and never truncated: the reader's own deadline outranks somebody else's,
  // and a widened radius that pushed a target's own standoff off the end of the list would be
  // a regression dressed as a feature.
  return [...own, ...reachable]
    .slice(0, Math.max(0, args.limit))
    .map((raid) => viewOf(raid, args.port, args.principal, args.tick));
}

function viewOf(
  raid: RaidRecord,
  port: RaidViewPort,
  reader: PrincipalId,
  tick: number,
): RaidView {
  const party = raid.parties.find((p) => p.principal === reader);
  const side: RaidView['your_side'] =
    raid.target === reader ? 'TARGET' : party === undefined ? null : party.side;

  // Priced for the TARGET, because the target is the one with a decision. A joiner sees
  // the same figures and reads them as what it is fighting over.
  const standing = port.standingOf(raid.target, raid.stage, raid.good);
  // The counterfactual, not the current state: the field is named
  // `defender_if_you_fight` and it answers "what would the sum be if the target
  // answered". An agent deciding needs the number its decision would produce, which is
  // the whole of A2's "known arithmetic is exact" — the alternative is a zero that
  // silently becomes a three the moment it acts.
  const wouldDefend = port.handsDefending(raid.target, raid.stage).length;
  const reading = readForce({
    raid,
    tier: port.tierOf(raid.stage),
    defenderHands: wouldDefend,
    // The same rule the resolver uses, from the same call. An agent shown a joiner's
    // force for a hand that has already marched away would be reading a promise the
    // engine will not keep — scar #1 with a hold at stake.
    handsAtStage: (principal) => port.handsDefending(principal, raid.stage),
    // And the same for the raid's own side. One call, one number, both readers.
    raidForceLeft: (row) => port.raidForceLeft(row),
    // ★ §16.12 #1, and the same call at the same moment as the resolver's.
    swayAt: (principal) => port.swayAt(principal, raid.stage),
  });

  return {
    raid: raid.id,
    stage: raid.stage,
    target: raid.target,
    initiator: raid.initiator,
    good: raid.good,
    demand: raid.demandQty,
    state: raid.state,
    spawned_tick: raid.spawnedAtTick,
    resolves_tick: raid.resolvesAtTick,
    ticks_left: Math.max(0, raid.resolvesAtTick - tick),
    your_side: side,
    answer: raid.answer,
    force: {
      raider: reading.raiderForce,
      raid_force_left: reading.terms.raidForce,
      raid_force_at_spawn: reading.terms.raidForceAtSpawn,
      defender_if_you_fight: reading.defenderForce,
      defender_joiners: reading.terms.defenderJoiners,
      raider_hands: reading.terms.raiderHands,
      raider_joiners: reading.terms.raiderJoiners,
      terrain: reading.terms.terrain,
      verdict_if_resolved_now: reading.verdict,
      /**
       * ★ §16.12 #1: hands of the READER's that would count as force here, of `SWAY_AT_SEAT`.
       *
       * Beside the force sum rather than in a block of its own, because it is a **term of that
       * sum** for anybody on the raider's side — and because a reader that sees `raider_joiners`
       * without it cannot tell a coalition that did not turn up from one whose hands did not
       * reach. Zero, with `march` non-null, is the honest reading of *"you can get there and it
       * will not matter"*, which is what makes the route above safe to publish.
       */
      your_sway: port.swayAt(reader, raid.stage),
      /**
       * ★ **YOUR OWN HANDS STANDING AT THE STAGE RIGHT NOW** — IDLE and present, the set that counts.
       *
       * Beside {@link your_sway} because the pair IS the decision: sway is the cap and this is what
       * you have brought against it. A blind player read `your_sway: 3` with two hands standing there
       * and `force.raider: 1`, and had no field anywhere that would have let it see the third number
       * was 1 — the count of party ROWS. Force is hands now, and this is yours.
       */
      your_hands_here: port.handsDefending(reader, raid.stage).length,
      raiders_out_of_sway: reading.terms.raidersOutOfSway,
    },
    costs: {
      pay: payFor(raid.demandQty, standing),
      // The consequence of silence, exactly: an unanswered raid musters no defence, so
      // it takes the multiple capped by what is actually there.
      if_you_do_nothing: takeFor(raid.demandQty, standing),
      join_stake: RAID_JOIN_STAKE_MINOR,
      // ── ★ AND WHAT SILENCE COSTS IN CAPITAL, NOT ONLY IN GOODS ────────────
      //
      // Asked about the TARGET's production rather than the reader's, because a razing takes the
      // target's structure whoever is reading — a bystander pricing `join` needs to know what is
      // actually on the table, and it is what makes an escort worth hiring for more than the cargo.
      // The same `worksAt` the resolver uses, through the same force reading.
      works_at_risk:
        worksAtRisk({
          tier: port.tierOf(raid.stage),
          system: raid.stage,
          standing: port.worksAt(raid.target, raid.stage),
          attackerForce: reading.raiderForce,
          defenderForce: reading.defenderForce,
        })?.id ?? null,
      save_works_force: forceToSaveWorks({
        tier: port.tierOf(raid.stage),
        attackerForce: reading.raiderForce,
        defenderForce: reading.defenderForce,
      }),
    },
    lost: raid.lostQty,
    forfeited: raid.forfeited,
    // Null once a hand of the reader's is already standing there — there is nothing left to walk,
    // and publishing a route to where you are would read as an instruction to leave.
    // ══════════════════════════════════════════════════════════════════════════
    // ★ **THIS WAS NULLED THE MOMENT ONE HAND OF YOURS WAS THERE, AND THAT USED TO BE RIGHT.**
    //
    // The old comment: *"Null once a hand of the reader's is already standing there — there is
    // nothing left to walk, and publishing a route to where you are would read as an instruction to
    // leave."* True while force was one point per PARTY ROW: a second hand bought nothing, so a route
    // for it was noise. `readForce` now counts `min(hands standing here, sway here)`, so a second hand
    // buys a whole point of force and the route to it is the most useful row on the standoff.
    //
    // `marchTo` already skips hands that are at the stage, so this can only ever name one that is
    // elsewhere — it is a REINFORCEMENT route, never an instruction to leave. It goes null only when
    // there is genuinely no such hand.
    // ══════════════════════════════════════════════════════════════════════════
    march: marchFor(port.marchTo(reader, raid.stage, tick), raid.resolvesAtTick),
  };
}

/**
 * The pixel signature (A13) — **THE RAID LINE**, whose shape is
 * {@link ../frames/contract.RaidLine} and whose argument for being on screen at all is
 * in `frames/projection.ts` beside the §11.2 clause that admits it.
 */

/**
 * The lines for a frame, biggest demand first, capped by the caller's budget.
 *
 * Every raid in the world, not just one principal's — the frame is the viewer's, and a
 * raid is `PUBLIC`. `renderFrame`'s budget does the truncation; ordering here is by the
 * one number that says how much is at stake.
 */
export function raidLinesFor(book: Book, tick: number, limit: number): readonly RaidLine[] {
  return book
    .all()
    .map((raid) => ({
      raid: raid.id,
      stage: raid.stage,
      target: raid.target,
      // ── THE FIELD THAT MAKES THE ARC A STORY RATHER THAN WEATHER ────────────
      //
      // A13 asks for a named pixel signature, and "a raid is happening at OPS-7" and
      // "p:kestrel is taking something from p:wren" are not the same picture. §11.2 admits
      // it without an argument: taking a side in a standoff is already `PUBLIC` (the
      // `raid.joined` event publishes the joiner and its stake), and the initiator is the
      // first party to have taken one.
      initiator: raid.initiator,
      demand: raid.demandQty,
      state: raid.state,
      lost: raid.lostQty,
      raiderForce: raid.raiderForce,
      defenderForce: raid.defenderForce,
      ticksLeft: Math.max(0, raid.resolvesAtTick - tick),
      // ── ★ THE COALITION, AS THE MAP DRAWS IT ────────────────────────────────
      //
      // `raid.parties` is already sorted by principal id (`Book.addParty`), so the spurs are drawn
      // in one order on every host and a frame hash cannot depend on join order. The target itself is
      // NOT listed here — it is `target`, and repeating it would draw the defender twice.
      defenders: raid.parties.filter((p) => p.side === 'DEFENDER').map((p) => p.principal),
      raiders: raid.parties.filter((p) => p.side === 'RAIDER').map((p) => p.principal),
    }))
    .sort(
      (a, b) =>
        // Live raids first — a countdown is the thing to look at — then by size.
        Number(b.state === 'DEMANDED') - Number(a.state === 'DEMANDED') ||
        b.demand - a.demand ||
        (a.raid < b.raid ? -1 : a.raid > b.raid ? 1 : 0),
    )
    .slice(0, limit);
}

/**
 * One 140-character ticker line per resolved raid. The export surface (§14).
 *
 * **The raider is named when there is one**, and it is the first thing in the sentence for the
 * reason A13 asks for a pixel signature at all: "a raid demanded 4,000" is weather, and
 * "p:kestrel demanded 4,000 of p:wren" is a story with somebody in it who will still be here
 * next Reckoning. The world's own raids stay unattributed, because attributing them to anybody
 * would be a permanent public accusation against an agent that did nothing (A5′).
 */
export function raidTickerLine(raid: RaidRecord): string {
  const head = `${raid.stage}: `;
  const by = raid.initiator === null ? '' : `${raid.initiator}'s demand — `;
  const body =
    raid.state === 'REPULSED'
      ? `${raid.target} held the field ${String(raid.defenderForce)}-${String(raid.raiderForce)}` +
        (raid.forfeited > 0 ? `, and took ${String(raid.forfeited)} in forfeited stakes` : '')
      : raid.state === 'PAID'
        ? `${raid.target} paid ${String(raid.lostQty)} of ${raid.good} and the raid left`
        : raid.state === 'PLUNDERED'
          ? `${raid.target} lost ${String(raid.lostQty)} of ${raid.good} ${String(raid.defenderForce)}-${String(raid.raiderForce)}`
          : raid.state === 'MISSED'
            ? `the raid on ${raid.target} found nothing worth taking`
            : raid.initiator === null
              ? `a raid demands ${String(raid.demandQty)} of ${raid.good} from ${raid.target} by tick ${String(raid.resolvesAtTick)}`
              : `${raid.initiator} demands ${String(raid.demandQty)} of ${raid.good} from ${raid.target} by tick ${String(raid.resolvesAtTick)}`;
  // The prefix is dropped on the DEMANDED branch, which already names the raider in the verb.
  const prefix = raid.state === 'DEMANDED' ? '' : by;
  return `${head}${prefix}${body}`.slice(0, 140);
}

/** The published multiple, for the affordance text. One home (scar #1). */
export const RAID_SILENCE_MULTIPLE = RAID_TAKE_MULTIPLE;
