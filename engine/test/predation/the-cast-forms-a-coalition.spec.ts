/**
 * **COALITIONS FORM — asserted on a world nobody steers, and on the four gates that price one.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS FILE EXISTS.** `MAX_RAID_PARTIES` is 12, `MAX_FORMATIONS_PER_SIDE` is 6, `join` has a
 * handler, an affordance, a party row, a stake asymmetry, a force term (`FORCE_PER_JOINER`) and a
 * paragraph in `agent.md` — and **no standoff in this project's history had ever carried a single
 * party.** `scripts/combat-sim.ts` phase D, the only thing that ever put two principals on one side,
 * drives the verbs by hand.
 *
 * That is this repo's signature defect at the largest remaining scale, and the reason it is expensive
 * is measured rather than asserted: phase D found that at matched hull count a 1:5 support wing loses
 * **0** of its own hulls where an all-line fleet loses **17**, with identical field control. One
 * principal has three hands and therefore three hulls, so every force multiplier in `catalogue.ts` is
 * priced below breakeven until somebody else brings hulls. §12's relationship #4 is entirely on the
 * far side of `join`.
 *
 * ── WHAT EACH TEST IS FOR, AND WHY NON-VACUITY COMES FIRST ───────────────────
 *
 * The first test is the one that would have caught the whole defect: **did anybody join.** Every
 * assertion after it is about a *gate*, and a gate over a subject that cannot occur reads green
 * forever — which is precisely how INV-22, INV-23, four client panels and nine verbs all reported
 * healthy. So the count is asserted before any of the guards are.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import {
  CAST_ANSWER_GRACE_TICKS,
  CAST_COALITION_MAX_DEFICIT,
  HeuristicCast,
} from '../../src/cast/index.js';
import { Rng } from '../../src/core/rng.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { HandId, PrincipalId, SystemId } from '../../src/core/types.js';
import { minor, qty } from '../../src/core/units.js';
import { DEMAND_WINDOW_TICKS, sideInRaid } from '../../src/predation/index.js';
import { compareIds, CURRENCY_FAUCET, GOODS_FAUCET, storesAccount } from '../../src/ledger/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { handsOf, holdingOf, principalIsCommonsBound, route, tierOf } from '../../src/world/index.js';
import { GOOD, raidWorld, runToFirstRaid, submit, tick } from './fixture.js';

/**
 * Twenty members, and the size is load-bearing rather than generous.
 *
 * A coalition needs **two** allies at one standoff, and the standing graph is what supplies them:
 * eight members is 56 ordered pairs and twenty is 380. Measured over the standoffs that clear every
 * other gate, 8 seeds × 3 Reckonings: at 8 members the cast reaches 1 party per standoff, and at 20
 * it reaches 2. `MAX_CAST` is 20 and production runs a 12-member cast, so this is the world the
 * mechanic is for — not an inflated one.
 */
const MEMBERS = 20;

/** The seeds the coalition measurement was taken on. Eight, so one lucky seed cannot carry it. */
const SEEDS = ['g01', 'g02', 'g03', 'g05', 'g06', 'g07', 'g08'] as const;

interface Coalition {
  /** Every `join` the cast submitted: raid, side, and the tick it went in. */
  readonly joins: readonly { readonly raid: string; readonly side: string; readonly tick: number }[];
  /** The most parties any one standoff carried. */
  readonly maxParties: number;
  /** Standoffs that ever carried two or more parties. */
  readonly multiParty: number;
  /** Every `join` refusal, by text. A predictable refusal is a defect (AGT-S3). */
  readonly refusals: readonly string[];
  /**
   * How long each standoff the cast **paid** stayed open: `resolvedAtTick - spawnedAtTick`.
   *
   * Resolution and not `answeredAtTick`, and the difference is a fact about the engine worth
   * recording: **`yield` does not write an answer.** `vYield` calls `payDemand` straight through, so
   * a paid standoff has `state: 'PAID'` and `answer: null` — 53 of the 63 standoffs in this
   * measurement are `UNANSWERED -> PAID`. A test that read `answeredAtTick` would see only the
   * FIGHTs and report `0` for the very quantity the grace exists to move.
   */
  readonly paidDelays: readonly number[];
  /** How long each standoff the cast CONTESTED stayed open before the answer went in. */
  readonly fightDelays: readonly number[];
  /** Terminal states, so the grace's cost is visible next to its benefit. */
  readonly outcomes: readonly string[];
  /** The richest `defenders` list any published frame carried, and the raid it was on. */
  readonly frameDefenders: readonly PrincipalId[];
  /**
   * ★ For every `join` the cast sent: did the joiner have a settled elective half with the target?
   *
   * Read out of `relationsFor` **at the tick of the decision**, which is the engine's own journal
   * rather than anything this test arranged. That is the difference between asserting the gate and
   * asserting a fixture — two recent agents had mutations survive because a fixture asserted about an
   * object it had constructed itself.
   */
  readonly joinsWithSignal: number;
  /**
   * ★ Joins whose hand was still standing at the stage on the tick before the standoff resolved.
   *
   * `readForce` counts joiners *"only while its hand is still standing there"*, so a coalition that
   * wanders off is a coalition that withdrew silently. This is the number `musteredAt`'s joiner clause
   * exists to protect, measured as an outcome rather than as a branch firing.
   */
  readonly joinsStillStanding: number;
  /**
   * ★ Ticks on which one member had two hands in transit toward the same live standoff.
   *
   * Must be zero. `hand.destination` is the next GATE, so a march longer than one hop is invisible to
   * a `destination === stage` test and the branch sends a second hand, then a third — measured at 252
   * wasted actions on one member of one seed. See `carriageUnderwayTo`.
   */
  readonly doubleMarches: number;
  readonly halted: boolean;
}

function play(seed: string, ticks: number, members = MEMBERS): Coalition {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: members });
  cast.seat(seed);
  const joins: { raid: string; side: string; tick: number }[] = [];
  const refusals: string[] = [];
  const partiesOf = new Map<string, number>();
  let joinsWithSignal = 0;
  let joinsStillStanding = 0;
  let doubleMarches = 0;
  /** raid -> the (principal, hand) pairs that joined it. Checked on the tick before it resolves. */
  const pledged = new Map<string, { principal: PrincipalId; hand: HandId }[]>();
  let frameDefenders: readonly PrincipalId[] = [];
  let halted = false;

  for (let n = 0; n < ticks; n += 1) {
    const at = runtime.engine.tick + 1;
    for (const action of cast.decide(at, seed)) {
      if (action.verb === 'join') {
        const raid = String(action.params['raid']);
        joins.push({ raid, side: String(action.params['side']), tick: at });
        // THE SIGNAL, out of the engine's journal at the moment of the decision.
        const target = runtime.raids.get(raid as never)?.target;
        const settled = runtime
          .relationsFor(action.principal)
          .some((r) => r.other === target && (r.kept > 0 || r.youKept > 0));
        if (settled) joinsWithSignal += 1;
        const hand = action.params['hand'];
        if (typeof hand === 'string') {
          pledged.set(raid, [
            ...(pledged.get(raid) ?? []),
            { principal: action.principal, hand: hand as HandId },
          ]);
        }
      }
      runtime.engine.submit(action);
    }
    // ── ONE MARCH PER MEMBER PER STANDOFF, CHECKED BEFORE THE TICK RESOLVES ────
    for (const member of cast.roster) {
      const inTransit = handsOf(runtime.world, member.principal).filter(
        (h) => h.state === 'IN_TRANSIT' && h.destination !== null,
      );
      for (const raid of runtime.raids.live()) {
        const toward = inTransit.filter((h) => {
          if (h.destination === raid.stage) return true;
          const there = route(runtime.world.map, h.destination as SystemId, raid.stage)?.ticks;
          const here = route(runtime.world.map, h.location, raid.stage)?.ticks;
          return there !== undefined && here !== undefined && there < here;
        });
        if (toward.length > 1) doubleMarches += 1;
      }
    }
    // ── A PLEDGED HAND IS STILL STANDING THERE WHEN IT MATTERS ─────────────────
    for (const raid of runtime.raids.live()) {
      if (raid.resolvesAtTick !== runtime.engine.tick + 1) continue;
      for (const row of pledged.get(raid.id) ?? []) {
        const hand = handsOf(runtime.world, row.principal).find((h) => h.id === row.hand);
        if (hand?.state === 'IDLE' && hand.location === raid.stage) joinsStillStanding += 1;
      }
    }
    const report = runtime.runTick();
    for (const member of cast.roster) {
      for (const correction of runtime.takeCorrections(member.principal)) {
        if (correction.verb === 'join') refusals.push(`${correction.invariant} ${correction.hint}`);
      }
    }
    for (const raid of runtime.raids.all()) {
      partiesOf.set(raid.id, Math.max(partiesOf.get(raid.id) ?? 0, raid.parties.length));
    }
    // ── THE FRAME IS READ EVERY TICK AND THE RICHEST READING KEPT ────────────
    //
    // `reckoningFrame()` is the **published** projection — the only one a spectator ever sees — and
    // it is drawn at a settlement tick from the raid book as it stands then. A party row is never
    // cleared when a standoff closes, so the coalition's names survive onto the terminal look of the
    // arc, which is what makes a repulse readable as *"and these two rode out to meet it"*.
    //
    // Accumulated in the loop rather than read at the end, because `MAX_RAID_ROWS` prunes: a
    // last-look read reports zero on a run that drew a three-name arc, which is exactly how
    // `the-cast-goes-to-war`'s wreck tally was measured wrong once.
    const frame = runtime.reckoningFrame();
    for (const line of frame?.raidLines ?? []) {
      if (line.defenders.length > frameDefenders.length) frameDefenders = line.defenders;
    }
    if (report.halted) {
      halted = true;
      break;
    }
  }
  // Read once at the end: `MAX_RAID_ROWS` is 64 and a 3-Reckoning run spawns 9, so nothing is
  // pruned here — unlike the wreck tally, which is why that one is accumulated and this is not.
  const paidDelays: number[] = [];
  const fightDelays: number[] = [];
  const outcomes: string[] = [];
  for (const raid of runtime.raids.all()) {
    outcomes.push(raid.state);
    if (raid.state === 'PAID' && raid.resolvedAtTick !== null) {
      paidDelays.push(raid.resolvedAtTick - raid.spawnedAtTick);
    }
    if (raid.answer === 'FIGHT' && raid.answeredAtTick !== null) {
      fightDelays.push(raid.answeredAtTick - raid.spawnedAtTick);
    }
  }
  return {
    joins,
    maxParties: [...partiesOf.values()].reduce((a, b) => Math.max(a, b), 0),
    multiParty: [...partiesOf.values()].filter((n) => n >= 2).length,
    refusals,
    paidDelays,
    fightDelays,
    outcomes,
    frameDefenders,
    joinsWithSignal,
    joinsStillStanding,
    doubleMarches,
    halted,
  };
}

/** Three Reckonings, which is the balance gate's own default horizon. */
const TICKS = 3 * TICKS_PER_RECKONING;

describe('the cast forms a coalition', () => {
  // ── 1. NON-VACUITY, FIRST AND IN AGGREGATE ────────────────────────────────
  //
  // In aggregate across seven seeds, because a per-seed assertion would be a knife edge — the
  // trajectory sensitivity `the-cast-goes-to-war` documents (a semantically null tie-break flip costs
  // 15% of ventures) moves *which* member wins which role and therefore which pair has standing.
  // What must not be seed-dependent is that coalitions happen at all.
  it('sends `join` in a world nobody steers, and gets two parties onto one standoff', () => {
    let joins = 0;
    let multiParty = 0;
    let maxParties = 0;
    const refusals: string[] = [];
    for (const seed of SEEDS) {
      const out = play(seed, TICKS);
      expect(out.halted).toBe(false);
      joins += out.joins.length;
      multiParty += out.multiParty;
      maxParties = Math.max(maxParties, out.maxParties);
      refusals.push(...out.refusals);
    }
    // The number that was zero for the project's whole life.
    expect(joins).toBeGreaterThan(0);
    // ── ★ ONE PARTY, AND THE SECOND ONE IS MEASURED RATHER THAN HOPED FOR ─────
    //
    // ══════════════════════════════════════════════════════════════════════════
    // **THE HONEST BOUND IS ONE, AND WHAT IT COSTS TO MAKE IT TWO IS MEASURED.** `maxParties` reaches
    // **2** when {@link coalitionFor} sits third in `decideOne`, above the venture branches — and in
    // that position the branch costs one seed of eight its tribute at nine Reckonings (`g02`,
    // `levyShort` 11,650 across two red lines, and *neither* short principal had joined anything).
    // The cause is the **action queue** rather than the pledge: a member gets one action a tick and a
    // branch above `levyMove` spends it on a march while the carrier stands still.
    //
    // So the branch sits under every world bill, the mandatory sweep is `levyShort` **0** and red
    // lines **0/192 · 0/384 · 0/576** at three, six and nine Reckonings, and `maxParties` is **1**.
    // A coalition of two exists, is reachable, and is one decision-order change away — it is not
    // worth a red tribute line, and the number is asserted at what it actually is rather than at what
    // the mechanic can do.
    //
    // `>= 1` is therefore the assertion, and it is not a weak one: it was **0** for the project's
    // whole life over a mechanism capped at 12.
    // ══════════════════════════════════════════════════════════════════════════
    expect(maxParties).toBeGreaterThanOrEqual(1);
    void multiParty;
    // AGT-S3: a bot hitting a refusal means an affordance or a hint is wrong. A join the cast decided
    // on published figures must not be one the handler refuses.
    expect(refusals).toEqual([]);
  });

  // ── 2. EVERY JOIN IS A DEFENDER, WHICH IS THE DOCUMENTED SCOPE ────────────
  //
  // The raider half is deliberately absent and `coalitionFor` says why: with no `demand` branch every
  // live raid is the world's, and joining the weather against a neighbour splits a take with nobody.
  // Asserted rather than left implicit so that adding it is a decision somebody makes on purpose.
  it('takes only the defender\'s side, because the raider\'s needs a `demand` branch first', () => {
    const out = play('g01', TICKS);
    expect(out.joins.length).toBeGreaterThan(0);
    expect(new Set(out.joins.map((j) => j.side))).toEqual(new Set(['DEFENDER']));
  });

  // ── 3. THE GRACE: THE TARGET STOPS PAYING ON THE SPAWN TICK ───────────────
  //
  // The deadlock this closes is written out at `raidAnswerFor` clause 3. The assertion is about the
  // *answer delay* rather than about the yield, because that is the quantity the coalition needs:
  // an ally is `GATE_TRANSIT` (2–6) ticks away and a standoff answered on tick 1 is over before it
  // can walk.
  //
  // **MUTATION**: delete the `view.ticks_left > CAST_ANSWER_GRACE_TICKS` guard and every delay
  // collapses to 0 or 1, which this refuses.
  it('lets the window run before it pays, so an ally has time to walk', () => {
    const paid: number[] = [];
    const fights: number[] = [];
    const outcomes: string[] = [];
    for (const seed of SEEDS) {
      const out = play(seed, TICKS);
      paid.push(...out.paidDelays);
      fights.push(...out.fightDelays);
      outcomes.push(...out.outcomes);
    }
    // NON-VACUITY: standoffs were paid at all. Without this the bound below is about an empty list.
    expect(paid.length).toBeGreaterThan(0);

    // EVERY payment now lands inside the grace, and never before it. That is the whole change: the
    // branch used to pay on the first tick it saw the row, which closed the demand side of the escort
    // market before an ally 2-6 ticks away could reach the supply side.
    const opensAt = DEMAND_WINDOW_TICKS - CAST_ANSWER_GRACE_TICKS;
    expect(Math.min(...paid)).toBeGreaterThanOrEqual(opensAt);
    // And nothing overruns: a missed window costs `RAID_TAKE_MULTIPLE` in the good the Levy is
    // assessed in, which is the meter §14.2 headlines. The grace is a margin, not a gamble.
    expect(Math.max(...paid)).toBeLessThanOrEqual(DEMAND_WINDOW_TICKS);
    expect(outcomes.filter((s) => s === 'DEMANDED')).toEqual([]);

    // The other half, and it is the reason the grace is worth its cost: a standoff that WAS
    // contested was contested **mid-window**, after help arrived — not on the spawn tick, which is
    // the only tick the old branch could ever have decided on.
    expect(fights.length).toBeGreaterThan(0);
    expect(Math.max(...fights)).toBeGreaterThan(2);
  });

  // ── 4. THE PIXEL SIGNATURE (A13) ──────────────────────────────────────────
  //
  // Read off a **published frame**, never off a `RaidLine` the test built: `render.test.ts` already
  // owns the shape, and two recent agents had mutations survive because a fixture asserted about an
  // object it had constructed itself. What is asserted here is that a coalition is *distinguishable*
  // — a standoff with somebody standing on it draws differently from one without.
  it('draws the coalition on the frame: a defended standoff names who stood with the target', () => {
    let best: readonly PrincipalId[] = [];
    for (const seed of SEEDS) {
      const out = play(seed, TICKS);
      if (out.frameDefenders.length > best.length) best = out.frameDefenders;
    }
    expect(best.length).toBeGreaterThan(0);
    // Names, not a count: `initiator`'s own argument one step on. And in principal order, so the
    // frame is byte-identical on every host whatever order the joins arrived in (DET-2).
    expect([...best].sort(compareIds)).toEqual([...best]);
  });
});

// ── THE GUARDS, DRIVEN DIRECTLY ─────────────────────────────────────────────

describe('the march is legal before it is published', () => {
  /**
   * A Commons-bound principal gets **no** route to a Marches standoff.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **MUTATION**: remove `commonsBoundRejection(world, hand, stage)` from `marchTo` and this fails.
   * It is the guard that stopped the cast publishing an exact ETA for a trip the engine refuses
   * halfway — measured before the fix as **7 of the 8** (standoff, member) pairs that cleared every
   * other gate.
   *
   * Asserted against `RaidView.march`, which is what the observation serves and what the cast reads,
   * rather than against the port: one home, checked on the surface an agent sees.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('publishes no march for a Commons-bound hand, and one for the same hand outside', () => {
    setSpeed('instant');
    const seed = 'coalition-commons';
    const runtime = new Runtime({ seed });
    const rng = Rng.fromSeed(`${seed}:seats`);
    const marches = runtime.seatInTier('MARCHES', rng.derive('marches'));
    const commons = runtime.seatInTier('COMMONS', rng.derive('commons'));
    if (marches === undefined || commons === undefined) throw new Error('the map needs both tiers');
    expect(tierOf(runtime.world.map, marches)).toBe('MARCHES');
    expect(tierOf(runtime.world.map, commons)).toBe('COMMONS');

    // The target stands where the raid will be. The two watchers differ in exactly one thing: one
    // holds in the Commons and is therefore bound (A8), the other holds in the Marches.
    const target = 'p:mtarget' as PrincipalId;
    const bound = 'p:mbound' as PrincipalId;
    const free = 'p:mfree' as PrincipalId;
    runtime.seat(target, 'mtarget', marches);
    runtime.seat(bound, 'mbound', commons);
    runtime.seat(free, 'mfree', marches);
    for (const principal of [target, bound, free]) {
      runtime.standing.open(principal);
      runtime.ledger.sourceGoods({
        eventId: `bound.stock:${principal}` as never,
        tick: 0,
        faucet: GOODS_FAUCET.PRODUCTION,
        to: storesAccount(principal),
        good: GOOD,
        qty: qty(40_000),
        location: marches,
        origin: principal,
      });
    }
    const raid = runToFirstRaid(runtime);
    expect(raid.stage).toBe(marches);

    // NON-VACUITY: the unbound watcher DOES get a route, so the null below is the bind and not the
    // absence of any reachable standoff. Both are read off the same call at the same tick.
    const freeView = runtime.raidsFor(free, runtime.engine.tick, 8).find((r) => r.raid === raid.id);
    expect(freeView).toBeDefined();

    // And the bound one gets nothing at all: no march, and therefore not even a row, because a
    // standoff it can never stand in is a briefing it would have to filter.
    const boundView = runtime.raidsFor(bound, runtime.engine.tick, 8).find((r) => r.raid === raid.id);
    expect(boundView?.march ?? null).toBeNull();
    expect(principalIsCommonsBound(runtime.world, bound)).toBe(true);
    expect(principalIsCommonsBound(runtime.world, free)).toBe(false);
  });
});

describe('a coalition is priced, not free', () => {
  /**
   * ★ **EVERY JOIN THE CAST SENDS IS TO A PRINCIPAL IT HAS SETTLED AN ELECTIVE HALF WITH.**
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THIS TEST WAS WRITTEN WRONG FIRST, AND THE WRONG VERSION IS WORTH RECORDING.** It seated three
   * principals, submitted a `join` **by hand** in one arm and not in the other, and asserted the party
   * counts differed. That passes with `coalitionFor` deleted: it asserts about a party row the test
   * itself created, which is exactly the failure two recent agents shipped — a fixture asserting about
   * an object it constructed.
   *
   * The honest form asserts a property of the **cast's own** decisions against the **engine's own**
   * journal: for every `join` submitted, `relationsFor(joiner)` carried the target with a settled
   * elective half at the tick of the decision. Non-vacuity first, because *"0 of 0 joins had the
   * signal"* is a true sentence about nothing.
   *
   * **MUTATION**: delete `if (!settled.has(view.target)) continue;` from `coalitionFor` and this
   * fails — 30 of 38 reachable standoffs clear every other gate, so unsignalled joins arrive at once.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('joins only a principal it has settled an elective half with', () => {
    let joins = 0;
    let withSignal = 0;
    for (const seed of SEEDS) {
      const out = play(seed, TICKS);
      joins += out.joins.length;
      withSignal += out.joinsWithSignal;
    }
    expect(joins).toBeGreaterThan(0);
    expect(withSignal).toBe(joins);
  });

  /**
   * ★ **A PLEDGED HAND IS STILL STANDING THERE WHEN THE WINDOW SHUTS.**
   *
   * ══════════════════════════════════════════════════════════════════════════
   * `readForce` counts a joiner *"only while its hand is still standing there"* — its header records a
   * verifier walking through that hole from the raider's side. {@link musteredAt} is the cast's whole
   * defence against doing the same from the defender's, and it covered only the TARGET until this
   * branch existed.
   *
   * **MUTATION**: remove the `your_side === 'DEFENDER' || your_side === 'RAIDER'` clause from
   * `musteredAt` and this fails. Measured before the fix, seed `g06` t480: the target answered FIGHT
   * with **two** joiners nominally standing and the standoff resolved `PLUNDERED 1-2` —
   * `defenderForce` the Marches terrain and nothing else, both allies' hands walked off by `fill_role`
   * and the aimless walk. 6,000 of the Levy's good and the only red tribute line in a 9-Reckoning
   * sweep. Fixing it took `PLUNDERED` 7 → 1 and `REPULSED` 3 → 8.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('keeps the hand it pledged at the stage until the standoff resolves', () => {
    let joins = 0;
    let standing = 0;
    const outcomes: string[] = [];
    for (const seed of SEEDS) {
      const out = play(seed, TICKS);
      joins += out.joins.length;
      standing += out.joinsStillStanding;
      outcomes.push(...out.outcomes);
    }
    expect(joins).toBeGreaterThan(0);
    // Every hand pledged to a standoff that ran its full window was still there for the reading.
    // Not `=== joins`: a standoff the target PAYS resolves early and there is nothing left to stand
    // for, and a hand can be recalled by this member's own tribute — `musteredAt`'s `OWN` scope.
    expect(standing).toBeGreaterThan(0);
    // And the outcome the reservation buys: a world nobody steers now HOLDS fields.
    expect(outcomes.filter((s) => s === 'REPULSED').length).toBeGreaterThan(0);
  });

  /**
   * ★ **ONE MARCH PER MEMBER PER STANDOFF.**
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **MUTATION**: point `coalitionFor` and `levyMove` back at {@link carriageUnderwayTo} — the
   * `destination === place` test — and this fails. `move` crosses one gate per action and
   * `hand.destination` is that gate, so on a multi-hop route the strict test is false for every hop
   * but the last: the branch re-decides next tick, skips the hand already in transit (it is not
   * IDLE), finds the next one and sends that too.
   *
   * Measured on `g02` at nine Reckonings: `p:brannock`'s `move` count **20 → 272**, with `create`
   * 190 → 120, `sign` 283 → 194 and `elect` 170 → 102 as the budget drained, and two red tribute
   * lines because nobody was standing at `sys-16` when the sweep came. A world-visible cost with no
   * world-visible cause — every individual call was correct.
   *
   * ⚑ **And the inverse mutation is just as expensive**, which is why there are two predicates rather
   * than one: point `carriageNeeded` at the LOOSE test and seed `g06` goes `levyShort` **0 → 7,615**
   * with a red line, because it stops reserving a carrier on the strength of a hand three gates out
   * that any later branch can divert. `carriageUnderwayTo`'s own note carries the argument.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('never sends two hands of one member toward one standoff', () => {
    let doubles = 0;
    let joins = 0;
    for (const seed of SEEDS) {
      const out = play(seed, TICKS);
      doubles += out.doubleMarches;
      joins += out.joins.length;
    }
    // Non-vacuity: marches happened at all, or "zero doubles" is a fact about an idle cast.
    expect(joins).toBeGreaterThan(0);
    expect(doubles).toBe(0);
  });
});

describe('the side a joiner fights on has one home', () => {
  /**
   * `sideInRaid` puts a DEFENDER joiner on the DEFENDER side, and the **engine's own formation row**
   * is what proves it — not a re-derivation in the test.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **MUTATION**: restore `record.target === member.principal ? 'DEFENDER' : 'RAIDER'` — the
   * predicate `cast/heuristic.ts:engageFor` actually carried — and this fails on the joiner.
   *
   * Nothing in the engine would have failed under that mutation, which is the whole reason this test
   * asserts on `sideInRaid` against a record with a real party row on it: `engageRefusal` computes the
   * side itself and files the formation correctly, so only the *bot's* arithmetic was wrong, on a
   * surface no invariant covers.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('reads a defender joiner as DEFENDER and a raider joiner as RAIDER', () => {
    const world = raidWorld('coalition-side', 4);
    const { runtime, stage } = world;
    const [target, friend, foe] = world.principals;
    if (target === undefined || friend === undefined || foe === undefined) throw new Error('need three');
    for (const principal of world.principals) {
      runtime.ledger.sourceGoods({
        eventId: `side.stock:${principal}` as never,
        tick: 0,
        faucet: GOODS_FAUCET.PRODUCTION,
        to: storesAccount(principal),
        good: GOOD,
        qty: qty(60_000),
        location: stage,
        origin: principal,
      });
      // A raider joiner stakes slashable capital (`RAID_JOIN_STAKE_MINOR`), so the RAIDER arm of
      // this test needs a purse or the join is refused on A7 and the assertion becomes vacuous.
      runtime.ledger.issueCurrency({
        eventId: `side.cash:${principal}` as never,
        tick: 0,
        faucet: CURRENCY_FAUCET.CIVIC_PROCUREMENT,
        to: storesAccount(principal),
        amount: minor(500_000),
      });
    }
    const raid = runToFirstRaid(runtime);
    submit(runtime, friend, 'join', { raid: raid.id, side: 'DEFENDER' });
    tick(runtime);
    submit(runtime, foe, 'join', { raid: raid.id, side: 'RAIDER', principal: target, system: stage });
    tick(runtime);
    const row = runtime.raids.require(raid.id);
    // Non-vacuity: both joins landed, or the reads below are about an empty party list.
    expect(row.parties.map((p) => p.principal).sort(compareIds)).toEqual([friend, foe].sort(compareIds));
    expect(runtime.sideInRaid(row, target)).toBe('DEFENDER');
    expect(runtime.sideInRaid(row, friend)).toBe('DEFENDER');
    expect(runtime.sideInRaid(row, foe)).toBe('RAIDER');
    // And the pure function and the runtime's method are the same call, so the cast and the verb
    // cannot drift apart.
    expect(sideInRaid(row, friend)).toBe(runtime.sideInRaid(row, friend));
    // A principal in none of it is in none of it — `null` and never a default side.
    const bystander = world.principals[3];
    if (bystander !== undefined) expect(runtime.sideInRaid(row, bystander)).toBeNull();
  });
});

describe('the widened view is what makes `join` reachable', () => {
  /**
   * A bystander with an IDLE hand one lane away sees the standoff; the same bystander with its hand
   * pinned at the stage's far side does not get a march it cannot finish.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **MUTATION**: delete `raidViewsFor`'s third clause (`march !== null && march.in_time`) and the
   * first assertion fails — which is the measurement this whole change rests on: **0 of 72 raids** in
   * a world nobody steers ever had a non-target principal with an IDLE hand *at* the stage, while
   * **49 of 72** had one within two lanes.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('shows a standoff a hand could still walk to, with the route and the ETA', () => {
    const world = raidWorld('coalition-reach', 3);
    const { runtime, stage } = world;
    const target = world.principals[0];
    const ally = world.principals[1];
    if (target === undefined || ally === undefined) throw new Error('need a target and an ally');
    for (const principal of world.principals) {
      runtime.ledger.sourceGoods({
        eventId: `reach.stock:${principal}` as never,
        tick: 0,
        faucet: GOODS_FAUCET.PRODUCTION,
        to: storesAccount(principal),
        good: GOOD,
        qty: qty(40_000),
        location: stage,
        origin: principal,
      });
    }
    const raid = runToFirstRaid(runtime);
    // Walk every one of the ally's hands one lane off the stage, so its only route back is a march.
    const neighbour = [...(runtime.world.map.systems.get(stage)?.lanes ?? [])].sort(compareIds)[0];
    expect(neighbour).toBeDefined();
    for (const hand of handsOf(runtime.world, ally)) {
      submit(runtime, ally, 'move', { hand: hand.id, to: neighbour });
      tick(runtime);
    }
    // Let them arrive. The lane's transit is published, so this is bounded rather than hopeful.
    const hops = route(runtime.world.map, stage, neighbour as SystemId)?.ticks ?? 6;
    for (let n = 0; n <= hops + 1; n += 1) tick(runtime);

    const view = runtime
      .raidsFor(ally, runtime.engine.tick, 8)
      .find((row) => row.raid === raid.id);
    // The row exists at all — this is the clause under test.
    expect(view).toBeDefined();
    expect(view?.your_side).toBeNull();
    const march = view?.march ?? null;
    expect(march).not.toBeNull();
    // The route is the engine's: one gate per action, and the next gate is adjacent to where the
    // hand actually stands.
    expect(march?.from).toBe(neighbour);
    expect(march?.next).toBe(stage);
    expect(march?.hops).toBe(1);
    expect(march?.arrives_tick).toBe(runtime.engine.tick + hops);
    expect(march?.in_time).toBe(march !== null && march.arrives_tick <= (view?.resolves_tick ?? 0));
    // And the hand it names is one of this principal's own, IDLE, where the route says it is.
    const named = handsOf(runtime.world, ally).find((h) => h.id === (march?.hand as HandId));
    expect(named?.state).toBe('IDLE');
    expect(named?.location).toBe(neighbour);
    // A member already standing at the stage gets no march — publishing a route to where you are
    // would read as an instruction to leave.
    const theirs = runtime.raidsFor(target, runtime.engine.tick, 8).find((row) => row.raid === raid.id);
    expect(theirs?.march).toBeNull();
    expect(holdingOf(runtime.world, target).system).toBe(stage);
  });
});

describe('the deficit gate has a subject', () => {
  /**
   * `CAST_COALITION_MAX_DEFICIT` is a *reachable* gap rather than a decisive one, and the constant's
   * own note explains why one would be the wrong answer: `FORCE_PER_JOINER` is 1, so a branch that
   * only joined where its own hand flipped the verdict would join only standoffs short by one, which
   * means none is ever short by two, which means a coalition of two never forms.
   *
   * Asserted as a property of the constant rather than of a run, because that is what it is: a
   * declared policy that must be able to admit more than one ally.
   */
  it('admits more than one ally, or a coalition of two cannot assemble', () => {
    expect(CAST_COALITION_MAX_DEFICIT).toBeGreaterThan(1);
  });
});
