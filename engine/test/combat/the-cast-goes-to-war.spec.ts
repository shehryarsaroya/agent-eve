/**
 * **COMBAT IS LIVE — asserted on a world nobody steers.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS FILE EXISTS.** Phase 2 landed 5,987 lines, `engage`, five hulls, twenty-nine modules, a
 * published stacking curve and five roles earned from fittings — and `src/cast/heuristic.ts` had no
 * combat branch, so **nothing in the world had ever built a hull.** That is this project's signature
 * defect at its largest scale yet: *a capability that exists and is never exercised is
 * indistinguishable from one that is missing — in every report, on every frame, and to every reader
 * including its author.*
 *
 * `test/combat/reachable.spec.ts` already proves combat is reachable **from the menu**, with the goods
 * stocked straight from the faucet and every step driven by hand. It says so itself: *"what this file
 * proves is reachability of the menu, not the economics of the supply chain."* This file is the other
 * half, and the assertions are deliberately about **outcomes in a running world** rather than about
 * branches firing:
 *
 *   1. a member reaches the Frontier, and **builds the doctrine out of goods it produced**;
 *   2. a formation **of ours** stands on a field and the battle reaches **CONTEST** — not a battle in
 *      which the world's fleet arrived and nobody came out, which is what a hull-less FIGHT looks
 *      like and which would satisfy a naive "did a battle happen" assertion;
 *   3. **a hull is destroyed**, permanently, on the public record (A5);
 *   4. **THE BATTLE LINE** (A13) carries two sides on a published frame;
 *   5. and none of it makes the **Levy** or the **Charge** harder, which is the gate that decides
 *      whether the branches were right to exist.
 *
 * ── THE SEED IS CHOSEN, AND THE REASON IS THE MAP RATHER THAN THE BRANCH ─────
 *
 * A hull costs `ration` **and `fuel`**, and `FUEL_YIELD_PER_TICK` is zero at every tier but FRONTIER.
 * The launch map has exactly **two** lanes into the Frontier — `sys-09 → sys-26` and
 * `sys-16 → sys-25` — and `graduate` moves a body one lane at a time, so the only members that can
 * ever reach fuel are the raiders the cast seats *on those two systems*. Measured over twenty-four
 * seeds at eight members: **one** produced a Frontier member. At twenty members it is seven of
 * sixteen, which matches the seating combinatorics exactly.
 *
 * So combat's reachability in a world nobody steers is gated by **the map's two chokepoints and the
 * seating lottery**, not by the cast's willingness — the same shape as `D23` #3's *"the map is ~4x too
 * big for the population"*, one mechanic further along. `fz-13` is the eight-member seed that seats
 * `brannock` on `sys-09`. If the map or the seating changes, re-pick a seed that seats a raider at
 * `sys-09` or `sys-16` rather than deleting the assertion.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import {
  CAST_DOCTRINE,
  CAST_ENGAGE_FAVOUR_BPS,
  HeuristicCast,
  type CastMember,
} from '../../src/cast/index.js';
import { setSpeed } from '../../src/core/time.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { BPS_ONE } from '../../src/core/units.js';
import {
  HULL_COST_GOODS,
  simulateFit,
  SLICES_PER_TICK,
  WORLD_PRINCIPAL,
  worldFleetProfile,
} from '../../src/combat/index.js';
import type { BattleLine } from '../../src/frames/contract.js';
import { Runtime } from '../../src/sim/runtime.js';
import { holdingOf, tierOf } from '../../src/world/index.js';

/**
 * The eight-member seeds whose raiders are seated on a Frontier gate. See the header.
 *
 * **Two, and asserted per seed rather than in aggregate**, because one of them is what makes the
 * logistics branch detectable at all: with `crewMove` deleted `fz-13` still fights (its hands happen to
 * be home when the world arrives) and the second seed goes quiet. An aggregate over both would pass
 * with the branch removed, which is the vacuous shape this project keeps finding and which the first
 * version of this file had.
 *
 * ── ★ `g16` → `g10` AT `RULES_VERSION` 16, `g10` → `g05` AT 26, AND THE HEADER'S INSTRUCTION IS WHY ──
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The header says: *"If the map or the seating changes, re-pick a seed that seats a raider at `sys-09`
 * or `sys-16` rather than deleting the assertion."* Neither has ever changed — the **cast's
 * trajectory** did, twice, and both times on a seed chosen *because* it sits on a knife edge.
 *
 * **At 16:** `D31` made `fill_role` carry a stake and §7.3 resolves a contested slot pro-rata by
 * stake, so which member wins which slot moved. On `g16` that cost `kestrel` its one engagement —
 * `engage` **1 → 0**, wrecks **564 → 0** — with the same three hulls built.
 *
 * **At 26 (`D41`):** EXPOSURE gained its delegated half — Σ `max_direct_loss` over live GRANTS, which
 * §3 always said it was and which nothing had ever summed. That moved the Levy's allocation **for
 * the first time in this world's life**: `INVERSE_EXPOSURE` is the published default and had been one
 * flat weight, and it now discriminates hard. Measured on `g10` at 900 ticks, 8 members: **hulls 3
 * (unchanged — the supply chain is intact), `engage` 1 → 0, battles 2 → 0.** Measured on the same
 * world, the size of the input that moved: `p:sable` carries **73,816** of delegated exposure against
 * **261** of lock exposure, and `p:varrow`, which granted nothing, carries **252** and nothing else.
 * A 272× spread where there had been none is what tipped the edge.
 *
 * `g05` replaces it, re-measured under the new cast: **frontier 1, hulls 3, `engage` 2, wrecks 2,
 * two battles reaching CONTEST with one of ours in both.**
 *
 * ── ⚑ AND THE `crewMove` COVERAGE IS NOW PARTIAL, WHICH IS RECORDED RATHER THAN CLAIMED ──
 *
 * `g10` detected a `crewMove` deletion as `engage` **1 → 0**. **No seed of the 34 scanned does that
 * under the new cast** — `g05` goes `engage` **2 → 1** and wrecks **2 → 1**, and `fz-13` is
 * unchanged at 2. So the pair no longer covers that branch by going dark, and saying it did would be
 * a comment claiming coverage the file does not have.
 *
 * What replaces the claim is an **assertion**: {@link CREW_MOVE_FLOOR} requires `g05` to reach
 * `engage` ≥ 2, so deleting `crewMove` turns this file RED on the number rather than on a zero. That
 * is weaker evidence than a seed going silent and it is *checkable*, which a comment is not.
 * ══════════════════════════════════════════════════════════════════════════
 */
/**
 * ★ The `engage` floor `g05` must clear, and it exists to keep the logistics branch covered.
 *
 * `g05` engages **twice** with `crewMove` intact and **once** without it, so a `> 0` assertion would
 * stay green with the branch deleted. Keyed by seed because it is a fact about one seed's trajectory
 * and not a property of the layer — the same reason `WAR_SEEDS` is asserted per seed.
 */
const CREW_MOVE_FLOOR: Readonly<Record<string, number>> = Object.freeze({ 'g05': 2 });

export const WAR_SEEDS = ['fz-13', 'g05'] as const;

/** Seeds the balance half is asserted over. The four the territorial gate was measured on. */
const GATE_SEEDS = ['gate-a', 'gate-b', 'gate-c', 'gate-d'] as const;

/**
 * ★ Seeds the **published frame** half is asserted over, and they are not {@link WAR_SEEDS}.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE FOUR CRITERIA DO NOT ALL FIT IN TWO SEEDS ANY MORE, AND SPLITTING IS THE HONEST ANSWER.**
 * A seed has to do four separable things for this file: reach a two-sided CONTEST, destroy a hull,
 * carry a two-sided line onto a frame *published at a settlement tick*, and go dark when `crewMove`
 * is deleted. Measured under the `RULES_VERSION` 16 cast:
 *
 * | seed | CONTEST + wreck | two-sided line on a FRAME | detects `crewMove` deletion |
 * |---|---|---|---|
 * | `fz-13` | yes | yes | **no** (its hands are home anyway) |
 * | `g10` | yes | **no** — 2 lines published, both RAIDER-only | **yes** (`engage` 1 → 0) |
 * | `g24` | yes | yes | **no** (fights with the branch gone) |
 *
 * `g10`'s battle is real and its wrecks are real; what it does not do is have one of *ours* standing
 * on the line at the tick the frame is drawn — `BATTLE_LINE_RETAIN_TICKS` is one Reckoning, so the
 * frame carries the battle, and its formation had already gone. That is a fact about one seed's
 * timing, not about A13, and forcing it into the frame assertion would mean deleting the assertion
 * that catches a `crewMove` regression.
 *
 * So `WAR_SEEDS` keeps the pair that covers the branch and `LINE_SEEDS` covers the pixel signature.
 * The alternative — one pair that passes everything — was `['fz-13', 'g24']`, and it fails the test
 * this file cares most about: with `crewMove` deleted **the whole file would stay green**, which is
 * the vacuity its own header calls out.
 *
 * ── ★ RE-SCANNED AT 33, AND THE PIN DID NOT HAVE TO MOVE ──────────────────
 *
 * ══════════════════════════════════════════════════════════════════════════
 * §16.12 #1's lode broke this file's frame assertion — `g24: battleLines is empty on every published
 * frame` — and the reflex is to hunt for a seed that is green again. **That is a silencer, not a
 * re-pin**, and this file has been re-pinned twice already (`g10` → `g05`). So `scripts/war-seed-scan.ts`
 * exists now: it plays every candidate and prints **the whole table, pass and fail**, so the next
 * person has the data rather than the conclusion.
 *
 * The scan said the pin was fine and the *engine* was not. `g24` had lost its line to
 * `cast/heuristic.ts:graduateFor` — the lode pointed the anti-lateral-hop gate at `systemYield`, which
 * made every lateral hop legal again, and a cast that wanders is a cast that is not standing on a
 * battle line when the frame is drawn. Fixing the gate restored `g24` untouched.
 *
 * The table, 900 ticks × 8 members, after the fix:
 *
 * | seed | CONTEST | wrecks | lines | two-sided | engage | qualifies |
 * |---|---|---|---|---|---|---|
 * | `fz-13` | yes | 3 | 2 | **1** | 1 | ★ |
 * | `g05` | yes | 6 | 2 | **1** | 4 | ★ |
 * | `g10` | yes | 3 | 1 | 0 | 1 | — *(RAIDER-only, as its row above says)* |
 * | `g24` | yes | 3 | 3 | **1** | 1 | ★ |
 * | `g01` `g02` `g03` `g06` `g07` | no | 0 | 0 | 0 | 0 | — |
 * | `g08` | yes | 0 | 1 | 0 | 0 | — |
 *
 * **Three of ten carry the property**, which is what licenses a two-seed pin: a property one seed of
 * ten satisfies is a coincidence and would need an assertion instead, the way {@link CREW_MOVE_FLOOR}
 * replaced a seed that no longer went silent. `g05` is the spare, and it is already a `WAR_SEEDS`
 * member — so if `LINE_SEEDS` ever does have to move, it moves there and the scan says why.
 *
 * ── ★ IT MOVED, AT `RULES_VERSION` 40, AND THE SCAN SAYS WHY ────────────────
 *
 * `g24` stopped qualifying. `scripts/war-seed-scan.ts`, 24 seeds × 900 ticks × 8 members, on the
 * merged tree:
 *
 * | seed | CONTEST | wrecks | lines | two-sided | engage | qualifies |
 * |---|---|---|---|---|---|---|
 * | `fz-13` | yes | 3 | 2 | **1** | 1 | ★ |
 * | `g05` | yes | 6 | 1 | **1** | 2 | ★ |
 * | `g24` | yes | 0 | 1 | 0 | 0 | — |
 * | `w-2` `w-3` `w-5` `w-6` `w-7` | yes | 0 | 1–2 | 0 | 0 | — |
 * | `w-12` | yes | 3 | 1 | 0 | 1 | — |
 * | the other 14 | no | 0 | 0 | 0 | 0 | — |
 *
 * **2 of 24.** The move is the one this block pre-authorised: to `g05`, with the scan's table
 * pasted rather than described. What changed the world was 40's `standoffNeeded` reserve — the cast
 * now keeps a hand back on the raid schedule instead of permanently, which is what took the market
 * from 4 fills back to 17, and `g24` still reaches CONTEST but no longer gets a hull to the field
 * (`engage` 1 → 0). The block above says it plainly: *"any change to the world's shape invalidates
 * the picks."*
 *
 * ⚑ **And 2 of 24 is thinner than 3 of 10, which is worth saying rather than burying.** The
 * property still has two independent carriers, so the two-seed pin stands — but the next author to
 * move the world's shape should run the scan expecting to re-pin, and if it ever reads 1, this test
 * has to become an assertion about the mechanism rather than a pin on a seed.
 * ══════════════════════════════════════════════════════════════════════════
 */
const LINE_SEEDS = ['fz-13', 'g05'] as const;

interface Wreck {
  readonly battle: string;
  readonly principal: PrincipalId;
  readonly hull: string;
  readonly tick: number;
}

interface Answered {
  readonly raid: string;
  readonly answer: string;
  /** The verdict the published view showed **at the tick the answer was sent**. */
  readonly verdictWhenAnswered: string;
  readonly state: string;
  readonly lost: number;
}

interface War {
  readonly runtime: Runtime;
  readonly cast: HeuristicCast;
  readonly verbs: Map<string, number>;
  readonly refusals: Map<string, number>;
  /** Hull classes built, in build order, by principal. */
  readonly built: Map<string, string[]>;
  /** The deepest state each battle reached, and whether one of ours was standing in it. */
  readonly battles: Map<string, { deepest: string; ours: number; sides: Set<string> }>;
  /** Every wreck the run produced. **Accumulated per tick**, because the book PRUNES. */
  readonly wrecks: Wreck[];
  /** Raids this cast answered, with the reading it answered on. */
  readonly answered: Answered[];
  /** The richest `battleLines` any published frame carried. */
  readonly lines: readonly BattleLine[];
}

const STATES = ['MUSTER', 'CONTACT', 'CONTEST', 'BREAK', 'AFTERMATH'] as const;

/**
 * Run a world nobody steers and tally what its combat actually did.
 *
 * **The wreck tally is accumulated inside the loop and that is not a style choice.** `Book.prune`
 * drops settled engagements once the book is over `MAX_ENGAGEMENT_ROWS`, and a settled battle's
 * wrecks go with it — so a tally read at the end of a 900-tick run reports **zero wrecks on a run
 * that destroyed nine hulls**. Measured exactly that way before this comment existed.
 */
function play(seed: string, ticks: number, size = 8): War {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size });
  cast.seat(seed);
  const verbs = new Map<string, number>();
  const refusals = new Map<string, number>();
  const built = new Map<string, string[]>();
  const battles = new Map<string, { deepest: string; ours: number; sides: Set<string> }>();
  const wrecks: Wreck[] = [];
  const seenWreck = new Set<string>();
  const answered: Answered[] = [];
  const answeredAt = new Map<string, string>();
  const mine = new Set(cast.roster.map((m) => String(m.principal)));
  let lines: readonly BattleLine[] = [];

  for (let n = 0; n < ticks; n += 1) {
    const tick = runtime.engine.tick + 1;
    // The reading each member would answer on, captured BEFORE the tick applies its actions. That
    // is the number `raidAnswerFor` decided from, and comparing it to the resolution is the only way
    // to catch a force reading that leaked away during the window.
    const readingNow = new Map<string, string>();
    for (const member of cast.roster) {
      for (const view of runtime.raidsFor(member.principal, runtime.engine.tick, 8)) {
        if (view.your_side !== 'TARGET') continue;
        readingNow.set(view.raid, view.force.verdict_if_resolved_now);
      }
    }
    for (const action of cast.decide(tick, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    expect(
      report.halted,
      `halted at ${String(report.tick)}: ${report.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`,
    ).toBe(false);

    for (const entry of runtime.engine.log.forTick(report.tick)) {
      if (entry.outcome === 'REFUSED' && entry.rejection !== null) {
        const key = `${entry.verb} ${entry.rejection.invariant}`;
        refusals.set(key, (refusals.get(key) ?? 0) + 1);
        continue;
      }
      verbs.set(entry.verb, (verbs.get(entry.verb) ?? 0) + 1);
      const params = entry.params as Record<string, unknown>;
      if (entry.verb === 'build' && params['kind'] === 'HULL') {
        const list = built.get(String(entry.principal)) ?? [];
        list.push(String(params['hull']));
        built.set(String(entry.principal), list);
      }
      if (entry.verb === 'fight' || entry.verb === 'yield') {
        const raid = String(params['raid']);
        answeredAt.set(raid, `${entry.verb}|${readingNow.get(raid) ?? 'UNSEEN'}`);
      }
    }

    for (const record of runtime.battles.all()) {
      const held = battles.get(record.id) ?? { deepest: record.state, ours: 0, sides: new Set<string>() };
      if (STATES.indexOf(record.state) >= STATES.indexOf(held.deepest as (typeof STATES)[number])) {
        held.deepest = record.state;
      }
      for (const formation of record.formations) {
        held.sides.add(formation.side);
        if (mine.has(String(formation.principal))) held.ours = Math.max(held.ours, formation.hands.length);
      }
      battles.set(record.id, held);
      for (const wreck of record.wrecks) {
        const key = `${record.id}:${wreck.hand}:${String(wreck.tick)}`;
        if (seenWreck.has(key)) continue;
        seenWreck.add(key);
        wrecks.push({ battle: record.id, principal: wreck.principal, hull: wreck.hull, tick: wreck.tick });
      }
    }
    const frame = runtime.reckoningFrame();
    if (frame !== null && frame.battleLines.length > lines.length) lines = frame.battleLines;
  }

  for (const raid of runtime.raids.all()) {
    const record = answeredAt.get(raid.id);
    if (record === undefined) continue;
    const [answer, verdict] = record.split('|');
    answered.push({
      raid: raid.id,
      answer: answer ?? '?',
      verdictWhenAnswered: verdict ?? '?',
      state: raid.state,
      lost: raid.lostQty,
    });
  }

  return { runtime, cast, verbs, refusals, built, battles, wrecks, answered, lines };
}

/** Where a member's body stands now. */
function bodyOf(runtime: Runtime, member: CastMember): SystemId {
  return holdingOf(runtime.world, member.principal).system;
}

describe('★ the cast builds a fleet out of goods it produced, and flies it', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **THE ASSERTION THE WHOLE CHANGE EXISTS TO MAKE, AND THE VACUOUS VERSION OF IT.**
   *
   * "A battle happened" is *not* the claim. A member that answers FIGHT with hands and no hulls gets
   * a battle too: `runBattles` opens one over any standoff answered FIGHT, `mustWorldFleet` gives the
   * world its LANCEs, and the engagement runs MUSTER → CONTACT → CONTEST → AFTERMATH with **one side
   * empty**. Measured: three of the four territorial gate seeds produce exactly that, and a test that
   * asserted `battles.size > 0` would have passed on a world where no hull was ever built.
   *
   * So the assertion is `ours >= 1` **and** the deepest state reached is CONTEST or later: a
   * formation this cast commanded, on a field, past the tick where damage starts.
   *
   * MUTATION: delete the `crewMove` call from `decideOne` — RED here, because `brannock`'s three
   * hands stay scattered across `sys-25`, `sys-29` and `sys-08` and `engage` refuses a hull with no
   * crew. That is the exact failure this branch was written from.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('builds the doctrine at a FRONTIER berth and brings a formation to CONTEST', () => {
    for (const seed of WAR_SEEDS) oneWar(seed);
  }, 600_000);

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **A HULL IS DESTROYED, WHICH IS THE ONLY IRREVERSIBLE THING IN THE LAYER (A5).**
   *
   * The wreck tally is accumulated per tick because `Book.prune` drops settled engagements — read at
   * the end of a 900-tick run the same world reports **zero**. That is the "invariant whose subject
   * cannot occur" failure wearing a retention policy, and it cost the first version of this test.
   *
   * MUTATION: raise {@link CAST_ENGAGE_FAVOUR_BPS} to 10_000_000 (never favoured) — RED, because
   * nothing is ever committed and nothing of the world's is ever shot at.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('destroys hulls, permanently, on the public record', () => {
    for (const seed of WAR_SEEDS) oneKill(seed);
  }, 600_000);

  /**
   * A13: **THE BATTLE LINE**, on a frame a viewer is served.
   *
   * Two lines of bars is the signature, so the assertion is on the *pair*: a frame carrying only the
   * world's formations is the same picture as surrender, which is precisely what A13 calls having no
   * pixel signature.
   *
   * MUTATION: set {@link BATTLE_LINE_RETAIN_TICKS} back to 2 — RED on both seeds, which is the state
   * combat shipped in.
   *
   * Asserted over {@link LINE_SEEDS} rather than {@link WAR_SEEDS}, and the table at `LINE_SEEDS`
   * says why: `g10` is in the war pair because it is the one seed that detects a `crewMove` deletion,
   * and its own battle resolves before the frame that would carry both sides is drawn.
   */
  it('publishes THE BATTLE LINE with two sides on it', () => {
    for (const seed of LINE_SEEDS) oneLine(seed);
  }, 600_000);
});

/** One war seed's fleet, asserted per seed. See {@link WAR_SEEDS} on why not in aggregate. */
function oneWar(seed: string): void {
    const war = play(seed, 900);

    // ── The supply chain, not the faucet ──────────────────────────────────
    const armed = war.cast.roster.filter((m) => war.runtime.fleet.of(m.principal).length > 0);
    expect(
      armed.length,
      'no cast member built a hull. `fuel` exists only at FRONTIER systems, so this is either the ' +
        'seating (see the header) or the arming branch — check `frontier` in scratch/scan before ' +
        'touching the gate.',
    ).toBeGreaterThan(0);
    for (const member of armed) {
      const berth = bodyOf(war.runtime, member);
      expect(
        tierOf(war.runtime.world.map, berth),
        `${member.handle} built at ${berth}, which is not the Frontier — and fuel exists nowhere else`,
      ).toBe('FRONTIER');
      // Built from the doctrine, in the doctrine's order. The order is load-bearing: the buffer is
      // bought before the tackle, because a member that builds the frigate first and then cannot
      // afford a line ship has a tackle hull and nothing to tackle for.
      const order = war.built.get(String(member.principal)) ?? [];
      expect(order.length, `${member.handle} owns hulls it never built`).toBeGreaterThan(0);
      // ── ★ THE PREFIX IS THE DOCTRINE; ANYTHING BEYOND IT IS A REPLACEMENT ──
      //
      // This compared the build LOG index-for-index against the doctrine, which is only right in a
      // world where nothing dies. `hullFor` picks `CAST_DOCTRINE[held]` off the count of hulls a
      // member currently HOLDS, so a member that loses a ship rebuilds at the index that fell vacant
      // — and the log then carries more entries than the doctrine has, with an earlier hull repeated.
      // A5 makes that loss permanent and public, and the fourth good made this world rich enough to
      // reach it: `brannock` built four ships on a three-ship doctrine and the fourth was `PIKE`
      // again, which is the doctrine working rather than being violated.
      //
      // So the assertion splits in two. The prefix must be the doctrine IN ORDER — that is the claim
      // worth making, because the order is load-bearing (the buffer is bought before the tackle) —
      // and every later entry must still be a doctrine hull, which is what catches a branch that
      // started buying whatever it could afford.
      const doctrine = new Set(CAST_DOCTRINE.map((d) => d.hull));
      for (const [index, hull] of order.entries()) {
        if (index < CAST_DOCTRINE.length) {
          expect(hull, `${member.handle}'s ship ${String(index)} is off-doctrine`).toBe(
            CAST_DOCTRINE[index]?.hull,
          );
          continue;
        }
        expect(
          doctrine.has(hull),
          `${member.handle}'s ship ${String(index)} replaced a loss with ${hull}, which is not in the doctrine at all`,
        ).toBe(true);
      }
      // And the doctrine's own cap still binds on what is HELD, whatever the log says.
      expect(
        war.runtime.fleet.readyOrBusyOf(member.principal).length,
        `${member.handle} holds more hulls than the doctrine allows`,
      ).toBeLessThanOrEqual(CAST_DOCTRINE.length);
      // And the goods went into it. A hull is `ration` the Levy will never see again.
      expect(
        war.runtime.fleet.of(member.principal).every((h) => h.location === berth),
        'a hull is berthed where it was built and never travels',
      ).toBe(true);
    }

    // ── A formation of ours, past the tick damage starts ───────────────────
    const contested = [...war.battles.values()].filter(
      (b) => b.ours >= 1 && STATES.indexOf(b.deepest as (typeof STATES)[number]) >= STATES.indexOf('CONTEST'),
    );
    expect(
      contested.length,
      'battles happened and this cast never had a formation in one past MUSTER. A FIGHT answered with ' +
        'hands and no hulls produces a battle with one side empty, which is what a naive ' +
        '"did a battle happen" assertion passes on.',
    ).toBeGreaterThan(0);
    for (const battle of contested) {
      expect(battle.sides.has('RAIDER'), 'and the world was on the other side of it').toBe(true);
      expect(battle.sides.has('DEFENDER'), 'and we were on ours').toBe(true);
    }
    expect(war.verbs.get('engage') ?? 0, `${seed}: \`engage\` was submitted and accepted`).toBeGreaterThan(0);
    // ★ And the floor that keeps `crewMove` covered on the seed that can carry it. See
    // {@link CREW_MOVE_FLOOR}: `> 0` alone stays green with the logistics branch deleted.
    const floor = CREW_MOVE_FLOOR[seed];
    if (floor !== undefined) {
      expect(
        war.verbs.get('engage') ?? 0,
        `${seed}: engage fell below ${String(floor)}, which is what deleting \`crewMove\` does to this ` +
          'seed — the hands never reach the berth, so the hulls sit crewless and only the walk-free ' +
          'engagement happens. Check the logistics branch before re-picking the seed.',
      ).toBeGreaterThanOrEqual(floor);
    }
}

/** One war seed's losses. */
function oneKill(seed: string): void {
    const war = play(seed, 900);
    expect(
      war.wrecks.length,
      'no hull was destroyed in the whole run. A5 makes loss permanent and public and there is nothing ' +
        'to be permanent about.',
    ).toBeGreaterThan(0);
    // The world's, at least — which is what says our guns fired rather than that we were shot at.
    const worldLost = war.wrecks.filter((w) => w.principal === WORLD_PRINCIPAL);
    expect(
      worldLost.length,
      'every wreck belongs to this cast, so the fleet has only ever been a target. `worldFleetProfile` ' +
        'is public exactly so a defender can compute whether it can win.',
    ).toBeGreaterThan(0);
    // A wreck names a hull the catalogue knows, at a tick, and the fleet book agrees it is gone.
    for (const wreck of war.wrecks) {
      expect(wreck.tick, 'a wreck is dated').toBeGreaterThan(0);
      if (wreck.principal === WORLD_PRINCIPAL) continue;
      const gone = war.runtime.fleet
        .all()
        .filter((h) => h.owner === wreck.principal && h.state === 'WRECKED');
      expect(
        gone.length,
        `${String(wreck.principal)} is recorded as having lost a ${wreck.hull} and its fleet book still ` +
          'holds no wreck. Two homes for one fact disagreeing is A5′ with a warship in it.',
      ).toBeGreaterThan(0);
    }
}

/** One war seed's frame. */
function oneLine(seed: string): void {
    const war = play(seed, 900);
    expect(
      war.lines.length,
      `${seed}: \`battleLines\` is empty on every published frame`,
    ).toBeGreaterThan(0);
    const both = war.lines.filter(
      (line) =>
        line.formations.some((f) => f.side === 'RAIDER') &&
        line.formations.some((f) => f.side === 'DEFENDER'),
    );
    expect(
      both.length,
      // The seed is in the message because it was not, and identifying which of two seeds had gone
      // one-sided cost a separate run. Every assertion in a per-seed loop names its seed.
      `${seed}: every battle line on every frame has one side only — the world turned up and nobody ` +
        `contested it, which renders identically to peace (${String(war.lines.length)} line(s) seen, ` +
        `sides ${[...new Set(war.lines.flatMap((l) => l.formations.map((f) => f.side)))].join('/') || 'none'})`,
    ).toBeGreaterThan(0);
    for (const line of both) {
      expect(line.gap, 'the gap is the motion, and it is inside the range table').toBeGreaterThanOrEqual(0);
      expect(line.gap).toBeLessThanOrEqual(4);
      expect(line.rangeName.length, 'and it carries the word, so the client needs no lookup').toBeGreaterThan(0);
      for (const formation of line.formations) {
        expect(formation.ehpBps, 'a bar height is a FRACTION, never an absolute').toBeLessThanOrEqual(10_000);
        expect(formation.ehpBps).toBeGreaterThanOrEqual(0);
      }
    }
}

describe('★ THE BALANCE GATE — a fleet must not make the tribute harder', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **A HULL IS PAID FOR IN THE GOOD EVERY OBLIGATION IN THIS GAME IS DENOMINATED IN.**
   * `HULL_COST_GOODS.frame` is `WORKS_GOOD`, which equals `LEVY_GOOD` and `CHARGE_GOOD`, so three
   * ships are 3,400 units of a tribute that runs ~20,000 a Reckoning — and unlike a WORKS or an
   * anchor there is **no salvage**, so every unit of it can leave the world in one battle.
   *
   * The territorial gate is the precedent and the warning: the naive claim branch took `levyShort`
   * from 0 to 14,792. So the two meters that decide whether territory was safe to open decide the
   * same thing here, on the same four seeds, plus the war seed where a fleet actually exists.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('levyShort stays ZERO and no tribute line goes red, with a fleet on the board', () => {
    for (const seed of [...GATE_SEEDS, ...WAR_SEEDS]) {
      const war = play(seed, 900);
      const frame = war.runtime.reckoningFrame();
      expect(frame, `${seed}: no frame`).not.toBeNull();
      expect(frame?.meters.levyShort ?? -1, `${seed}: the Levy went short`).toBe(0);
      expect(
        (frame?.tributeLines ?? []).filter((l) => l.state === 'RED').length,
        `${seed}: a tribute line is RED`,
      ).toBe(0);
    }
  }, 900_000);

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **THE CLAUSE THAT MAKES THE ARMING BRANCH SAFE, AS A PROPERTY.** `hullFor` refuses to build
   * unless {@link CAST_ARMS_RESERVE_MULTIPLE} of the price is still standing at the berth in **both**
   * goods, and unless every Charge owed there is covered after the spend. So a member that owns a
   * fleet is never a member that owes goods it cannot reach.
   *
   * Asserted on the state rather than on the branch, exactly as the territorial gate learned to: a
   * test that `hullFor` returned null in some case is a test of a function, and what has to be true
   * is that no claim carries arrears while its holder owns warships.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('a member that owns hulls is not a member in arrears', () => {
    for (const seed of WAR_SEEDS) {
    const war = play(seed, 900);
    const armed = war.cast.roster.filter((m) => war.runtime.fleet.of(m.principal).length > 0);
    expect(armed.length, 'nobody armed, so this proves nothing').toBeGreaterThan(0);
    for (const member of armed) {
      for (const claim of war.runtime.claimsFor(member.principal)) {
        expect(
          claim.arrears,
          `${member.handle} owns ${String(war.runtime.fleet.of(member.principal).length)} hulls and ` +
            `${claim.system} is in arrears — the fleet was bought out of the Charge`,
        ).toBe(0);
      }
      // And the fuel the anchor burns was never the fuel that paid for a hull.
      const berth = bodyOf(war.runtime, member);
      const due = war.runtime.claimsFor(member.principal).find((c) => c.system === berth)?.fuel_due ?? 0;
      expect(
        Number(war.runtime.goodsAt(member.principal, berth, HULL_COST_GOODS.fuel)),
        `${member.handle}'s anchor needs ${String(due)} fuel and the fleet spent it`,
      ).toBeGreaterThanOrEqual(due);
    }
    }
  }, 600_000);

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **THE FORCE READING IS TAKEN AGAIN AT RESOLUTION, AND THE CAST USED TO SPEND ITS OWN ANSWER.**
   *
   * `handsDefending` counts only **IDLE** hands present at the stage, and `readForce` re-reads it at
   * the window's end. So filling a role with a hand standing at the stage — or walking it toward the
   * Levy — silently un-answers a FIGHT already given, and the standoff flips from taking nothing to
   * taking twice the demand.
   *
   * Measured before the reservation existed: seed `gate-c` answered FIGHT twice and one came back
   * **`FIGHT/PLUNDERED`**. This asserts the property that makes that impossible: a FIGHT answered on
   * a reading that said REPULSED must **resolve** REPULSED.
   *
   * The converse is deliberately NOT asserted. `raidAnswerFor`'s fleet clause answers FIGHT on a
   * PLUNDERED reading on purpose — see its doc comment on why winning a battle against the world
   * cannot win the standoff — so a `FIGHT/PLUNDERED` whose reading was already PLUNDERED is a
   * decision, not a leak.
   *
   * MUTATION: delete the `mustered` filter from the `fill_role` branch — RED on `gate-c`.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('a FIGHT answered on a winning reading is still winning at resolution', () => {
    let winnable = 0;
    for (const seed of [...GATE_SEEDS, ...WAR_SEEDS]) {
      const war = play(seed, 900);
      for (const row of war.answered) {
        if (row.answer !== 'fight' || row.verdictWhenAnswered !== 'REPULSED') continue;
        winnable += 1;
        expect(
          row.state,
          `${seed}: ${row.raid} was answered FIGHT on a REPULSED reading and resolved ${row.state}, ` +
            `losing ${String(row.lost)}. The hands that were the answer were spent during the window.`,
        ).toBe('REPULSED');
      }
    }
    expect(
      winnable,
      'no raid in any of these seeds was answered FIGHT on a winning reading, so the assertion above ' +
        'never ran. That is the vacuous shape this project keeps finding: a green test over a subject ' +
        'that cannot occur.',
    ).toBeGreaterThan(0);
  }, 900_000);
});

describe('the doctrine is the one that wins, and the arithmetic says so', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **THE AFFORDANCE MENU OFFERS THE HULL THAT LOSES, AND THE CAST DELIBERATELY DOES NOT FLY IT.**
   *
   * `api/observe.ts` offers one `build {kind:"HULL"}` — a PIKE on a tackle fit — and argues for it
   * well: cheapest hull, §3 MUST-1's *"best answer to how can a new agent matter immediately"*.
   * Measured against the world's own fleet it is also a trap: `scripts/combat-sim.ts`'s `SWARM`
   * (three PIKEs) went **0 won · 2 lost**, losing all three hulls both times, where two missile
   * WARDENs and a PIKE went **4 won · 0 lost**. Three PIKEs bring 1,200 EHP against a force-2 raid's
   * 1,400 and a force-5 raid's 3,500.
   *
   * So this test pins the *reason* the cast flies WARDENs, in the same units the strength gate uses,
   * rather than pinning the names. MUTATION: make {@link CAST_DOCTRINE}'s first ship a PIKE — RED.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it("the first ship built out-trades a force-3 world raid on its own; a PIKE would not", () => {
    const world = worldFleetProfile();
    expect(world, 'the world must be able to field its fleet').not.toBeNull();
    if (world === null) return;
    const worldStrength = 3 * (world.ehp + world.alpha * SLICES_PER_TICK);

    const lead = CAST_DOCTRINE[0];
    expect(lead, 'the doctrine must have a first ship').toBeDefined();
    if (lead === undefined) return;
    const simulated = simulateFit(lead.hull, lead.modules);
    expect(simulated.ok, `the doctrine's lead ship does not fit: ${simulated.ok ? '' : simulated.hint}`).toBe(
      true,
    );
    if (!simulated.ok) return;
    const ours = simulated.value.ehp + simulated.value.alpha * SLICES_PER_TICK;
    expect(
      ours * BPS_ONE,
      `the lead ship is ${String(ours)} against a force-3 world raid's ${String(worldStrength)}, which does ` +
        `not clear CAST_ENGAGE_FAVOUR_BPS. The strength gate would then refuse every commit and the ` +
        `fleet would be a monument.`,
    ).toBeGreaterThanOrEqual(worldStrength * CAST_ENGAGE_FAVOUR_BPS);

    // The negative half: the menu's PIKE, alone, does not clear it — which is why the cast does not
    // copy the affordance verbatim, and why that decision is written down rather than assumed.
    const pike = simulateFit('PIKE', ['SMALL_GUN', 'POINT', 'WEB', 'AFTERBURNER']);
    expect(pike.ok, 'the menu offers a fit that must at least be legal').toBe(true);
    if (!pike.ok) return;
    const alone = pike.value.ehp + pike.value.alpha * SLICES_PER_TICK;
    expect(
      alone * BPS_ONE,
      'a single starter PIKE clears the strength gate against three world LANCEs. If that is now true, ' +
        'the cast should be flying the hull the menu offers and this whole doctrine is a needless ' +
        'divergence from the affordance an agent is shown.',
    ).toBeLessThan(worldStrength * CAST_ENGAGE_FAVOUR_BPS);
  });

  /**
   * The negative half of the arming branch, and it is not decoration: `buildHullRefusal` makes a
   * Commons berth **invalid** (A8 — *"a shipyard inside a place nobody may attack would make the
   * sanctuary the arsenal"*), so a cast that asked anyway would generate one refusal per tick
   * forever, which is the AGT-S3 noise that buries real defects.
   */
  it('never asks for a hull in the Commons, and never gets refused for one', () => {
    const war = play('gate-a', 640);
    const commons = war.cast.roster.filter(
      (m) => tierOf(war.runtime.world.map, bodyOf(war.runtime, m)) === 'COMMONS',
    );
    expect(commons.length, 'the Commons must have residents or this proves nothing').toBeGreaterThan(0);
    for (const member of commons) {
      expect(
        war.runtime.fleet.of(member.principal).length,
        `${member.handle} stands in the Commons and owns a hull`,
      ).toBe(0);
    }
    for (const [key, count] of war.refusals) {
      expect(key.startsWith('build A8'), `${String(count)} × ${key}: a predictable refusal, repeated`).toBe(
        false,
      );
    }
    expect(war.verbs.get('engage') ?? 0, 'and nothing engaged, because nothing was armed').toBe(0);
  }, 300_000);
});
