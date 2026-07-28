/**
 * ★ **THE EXPOSURE HIGH-WATER MARK — `RULES_VERSION` 17, AND THE FIFTH `Book.prune` CANDIDATE.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS FILE EXISTS.** §5.2 gives a constellation four ways to bear its tribute and calls the
 * vote *"the drama"*. `RULES_VERSION` 16 made the cast stake, so EXPOSURE stopped being identically
 * zero and all four rules could produce different dockets. They did — on **12 of 129**, with three of
 * eight seeds seeing none, because the reading was in the wrong place:
 *
 *   · `settleVenture` calls `releaseStakes` at the **settlement tick** (§7.4, "encumbrances released
 *     last"), so every stake in the world is handed back at phase 287;
 *   · `LEVY_ASSESS_PHASE` is **0** — the very next tick — and `levy/params.ts` gives three reasons it
 *     must stay there.
 *
 * So the docket sampled the one moment in the cycle when nobody was exposed. Measured, `g01`, six
 * Reckonings, open stake locks per phase: **phase 0 → 4**, phase 24 → 69, phase 144 → 89, phase 286 →
 * 92, phase 287 → 6. A **22x trough**. The ballot closes at `WINDOW_FIRST_PHASE`, mid-cycle, against a
 * reading that has evaporated before the docket it decides is cut.
 *
 * The fix is a **per-Reckoning EXPOSURE high-water mark** — the largest EXPOSURE a principal carried
 * at any tick of one Reckoning — because that is the quantity the rule's own words describe.
 * `levy/book.ts:exposurePeaks` carries the argument; this file is the assertion, in five parts:
 *
 *   1. **The mark exists and is non-zero** in an aged world (non-vacuity, first).
 *   2. **It survives the release**, which is the whole property. A stake escrowed mid-cycle and given
 *      back at settlement still stands in that cycle's mark, so the docket cannot be dodged by
 *      unwinding before the freeze.
 *   3. **★ IT CANNOT BE PRUNED BEFORE IT IS READ**, asserted from `LEVY_RETAINED_RECKONINGS` rather
 *      than from a comment. `Book.prune` has now silently destroyed a load-bearing row four times in
 *      this repo — in the engine, in a fix, in `balance-gate.ts`, and as a `Ring` cap that ate 109
 *      `kept` from a nine-Reckoning sweep — and a high-water mark is exactly the shape that gets
 *      cleared one tick early. This is the first one checked in advance.
 *   4. **It round-trips through `capture()`/`restore()`**, including from a checkpoint written before
 *      this field existed.
 *   5. **An agent can see it (A2)**, in the same units the rule reads, with the `vote` affordance
 *      quoting the engine's own figures rather than a second arithmetic.
 *
 * And the sixth, which is the *point* rather than the mechanism: **the vote is a real decision**, in
 * MINOR, measured on real dockets. That is the last test.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { buildObservation } from '../../src/api/observe.js';
import {
  isSettlementTick,
  phaseOfReckoning,
  reckoningIndex,
  setSpeed,
  TICKS_PER_RECKONING,
} from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { principalPosition, storesAccount } from '../../src/ledger/index.js';
import {
  allocate,
  Book,
  isNewcomer,
  LEVY_RETAINED_RECKONINGS,
  LEVY_BALLOT,
  LEVY_RULES,
  levyStateTable,
  PUBLISHED_DEFAULT_RULE,
  weightOf,
  type LevyRule,
  type LevySubject,
} from '../../src/levy/index.js';
import { Runtime } from '../../src/sim/runtime.js';

/** One Reckoning's worth of readings, taken at the phases where each one is decided. */
interface Cycle {
  readonly reckoning: number;
  /** `exposurePeakOf(reckoning, p)` sampled at the FREEZE tick — the mark near its cycle high. */
  readonly markAtFreeze: ReadonlyMap<PrincipalId, number>;
  /** Instantaneous EXPOSURE at the SETTLEMENT tick, after the release. The old reading. */
  readonly instantAtSettle: ReadonlyMap<PrincipalId, number>;
  /** `exposurePeakOf(reckoning, p)` re-read at phase 0 of the NEXT cycle — what the docket used. */
  readonly markAsBilled: ReadonlyMap<PrincipalId, number>;
  /** Instantaneous EXPOSURE at phase 0 of the next cycle. The trough. */
  readonly instantAtAssess: ReadonlyMap<PrincipalId, number>;
}

interface Docket {
  readonly reckoning: number;
  readonly rule: LevyRule;
  readonly spared: PrincipalId | null;
  readonly byDefault: boolean;
  readonly subjects: readonly LevySubject[];
  /**
   * ★ The weights the **ENGINE** recorded on the plan, in line order — `Allocation.weight`, written
   * by `allocate` at the tick the docket was minted.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THIS FIELD EXISTS BECAUSE A MUTATION SURVIVED.** Every other assertion in this file builds its
   * own `LevySubject` by calling `levySubjectOf(p, tick, reckoning - 1)` — which tests
   * `levySubjectOf` and the *weight function*, and says nothing about what `assessLevyNow` passed.
   * Changing that call site to `reckoning` — putting the assessment back on the trough, which is the
   * entire defect — left all eleven tests green.
   *
   * `plan.lines[].weight` is the engine's own answer, recorded at mint time and never re-derived. An
   * assertion against it cannot be satisfied by a test that agrees with itself.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly recordedWeights: readonly number[];
  readonly principals: readonly PrincipalId[];
}

/**
 * Age one world with the shipping cast and sample the mark at the three phases that matter.
 *
 * The real `Runtime`, the real `HeuristicCast`, real invariants asserting every tick — the same
 * fixture shape as `aged-solvency.spec.ts` and `four-rules-one-lever.spec.ts`, and deliberately not
 * `agedWorld()`, which runs the ticks and hands back a finished world with no per-phase hook.
 */
function aged(
  seed: string,
  reckonings: number,
  members = 8,
): { readonly runtime: Runtime; readonly cycles: readonly Cycle[]; readonly dockets: readonly Docket[] } {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: members });
  cast.seat(seed);

  const roll = (): readonly PrincipalId[] => runtime.world.principalOrder;
  const marks = (reckoning: number): ReadonlyMap<PrincipalId, number> =>
    new Map(roll().map((p) => [p, runtime.levy.exposurePeakOf(reckoning, p)]));
  const instants = (): ReadonlyMap<PrincipalId, number> =>
    new Map(
      roll().map((p) => [p, principalPosition(runtime.ledger, p, storesAccount(p)).exposure]),
    );

  const pending = new Map<number, { markAtFreeze: ReadonlyMap<PrincipalId, number>; instantAtSettle: ReadonlyMap<PrincipalId, number> }>();
  const cycles: Cycle[] = [];
  const dockets: Docket[] = [];

  for (let i = 0; i < reckonings * TICKS_PER_RECKONING; i += 1) {
    const next = runtime.engine.tick + 1;
    for (const action of cast.decide(next, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    expect(
      report.halted,
      `aged world halted at ${String(report.tick)}: ${report.violations
        .map((v) => `${v.id} ${v.message}`)
        .join(' | ')}`,
    ).toBe(false);
    const reckoning = reckoningIndex(report.tick);
    const phase = phaseOfReckoning(report.tick);

    if (phase === TICKS_PER_RECKONING - 2) {
      pending.set(reckoning, { markAtFreeze: marks(reckoning), instantAtSettle: new Map() });
    }
    if (isSettlementTick(report.tick)) {
      const held = pending.get(reckoning);
      if (held !== undefined) pending.set(reckoning, { ...held, instantAtSettle: instants() });
    }
    if (phase === 0 && reckoning > 0) {
      const held = pending.get(reckoning - 1);
      if (held !== undefined) {
        cycles.push({
          reckoning: reckoning - 1,
          markAtFreeze: held.markAtFreeze,
          instantAtSettle: held.instantAtSettle,
          markAsBilled: marks(reckoning - 1),
          instantAtAssess: instants(),
        });
      }
    }
    if (phase !== 0) continue;
    for (const plan of runtime.levy.plansIn(reckoning)) {
      dockets.push({
        reckoning,
        rule: plan.rule,
        spared: plan.spared,
        byDefault: plan.byDefault,
        // `reckoning - 1`, matching `assessLevyNow` exactly: the docket bills the cycle that ended.
        subjects: plan.lines.map((l) => runtime.levySubjectOf(l.principal, report.tick, reckoning - 1)),
        recordedWeights: plan.lines.map((l) => l.weight),
        principals: plan.lines.map((l) => l.principal),
      });
    }
  }
  return { runtime, cycles, dockets };
}

/**
 * The same aged world, stopped mid-cycle with the LEVY ballot **still open and uncast**.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **TWO THINGS HAVE TO BE TRUE AT ONCE AND THE OBVIOUS FIXTURE CANNOT DO IT.** `affordancesFor` offers
 * `vote` only while `ballot.voted === false`, and `HeuristicCast.ballotFor` casts on the **first tick**
 * the window opens — which is phase 0, the one tick at which the cycle in progress has no mark yet.
 * So "the ballot is open" and "the in-progress mark is non-zero" never coincide under the shipping
 * cast, and a fixture that stopped at phase 0 would quote a zero into the golden clause below.
 *
 * The fixture therefore withholds the cast's **LEVY ballots only**, from the last Reckoning onward.
 * Everything else — the fills, the stakes that make the mark, the deliveries — runs untouched. That
 * models a member that simply has not voted yet, which is the exact state the affordance exists for,
 * rather than a world bent to make an assertion pass.
 *
 * A separate run rather than advancing the shared one: the other tests read snapshots captured during
 * {@link aged}'s loop, and a test that mutated the shared runtime would make them order-dependent —
 * which is how a suite starts passing for the wrong reason.
 * ══════════════════════════════════════════════════════════════════════════
 */
function agedToBallotWindow(seed: string, reckonings: number, members = 8): Runtime {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: members });
  cast.seat(seed);
  const holdBallotsFrom = (reckonings - 1) * TICKS_PER_RECKONING;
  const stop = reckonings * TICKS_PER_RECKONING - 40;
  while (runtime.engine.tick < stop) {
    const next = runtime.engine.tick + 1;
    for (const action of cast.decide(next, seed)) {
      const isLevyBallot =
        action.verb === 'vote' &&
        action.params["ballot"] === LEVY_BALLOT;
      if (isLevyBallot && next >= holdBallotsFrom) continue;
      runtime.engine.submit(action);
    }
    const report = runtime.runTick();
    expect(report.halted, `halted at ${String(report.tick)}`).toBe(false);
  }
  return runtime;
}

/**
 * ★ **THE DURABLE FIX FOR THE RE-SEEDING TREADMILL — scan, do not pick.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The affordance test below needs a world where at least one principal is inside the ballot
 * window holding a **non-zero** EXPOSURE mark on both figures — otherwise its golden clause
 * degrades to `toContain('0')`, which matches any sentence with a digit in it.
 *
 * Measured across the eight gate seeds at Reckonings 3, 4 and 5 — 24 pairs — the count of
 * such principals is **0, 1, 2 or 3 out of 8**, and it is 0 in roughly a third of them. So
 * the test has always been one principal from vacuous, and a hardcoded seed is a lottery
 * ticket re-drawn by every unrelated cast edit: **five picks in one session**
 * (`g07` → `g08` → `g01` → `g06` → `g01`), none of the triggering edits touching EXPOSURE,
 * staking or the mark.
 *
 * So it does not pick. It scans, exactly the way `test/frames/docket.spec.ts:CANDIDATE_SEEDS`
 * scans for a discriminating docket, and **fails only when NONE of the 24 discriminates** —
 * which is a real finding about the cast rather than a re-roll. `g01`/4 leads the list
 * because it is the widest known pair, so the common case still builds exactly one world.
 *
 * Written on the branch that moved the endowment floor, because that change alters what the
 * cast spends and would otherwise have re-rolled this for the sixth time.
 * ══════════════════════════════════════════════════════════════════════════
 */
const BALLOT_WINDOW_CANDIDATES: readonly (readonly [string, number])[] = [
  ['g01', 4],
  ['g01', 3], ['g01', 5],
  ['g02', 3], ['g02', 4], ['g02', 5],
  ['g03', 3], ['g03', 4], ['g03', 5],
  ['g04', 3], ['g04', 4], ['g04', 5],
  ['g05', 3], ['g05', 4], ['g05', 5],
  ['g06', 3], ['g06', 4], ['g06', 5],
  ['g07', 3], ['g07', 4], ['g07', 5],
  ['g08', 3], ['g08', 4], ['g08', 5],
];

/** One principal's readings inside the ballot window: the block, and the `vote` it was offered. */
interface BallotReading {
  readonly principal: PrincipalId;
  readonly block: NonNullable<ReturnType<Runtime['levyBlockFor']>>;
  readonly vote: { readonly what_it_forecloses: string } | undefined;
}

function ballotWindowReadings(runtime: Runtime): readonly BallotReading[] {
  const tick = runtime.engine.tick;
  const out: BallotReading[] = [];
  for (const principal of runtime.world.principalOrder) {
    const block = runtime.levyBlockFor(principal, tick);
    if (block === null) continue;
    const observation = buildObservation({
      runtime,
      principal,
      serverNowMs: 0,
      fresh: true,
      wakesRemaining: 4,
      stale: false,
      corrections: [],
      actionsRemaining: 4,
    });
    // `verb === 'vote'` alone is not enough: §12.2 is "one verb, three ballots" and the CHARGE
    // ballot is also a `vote`. See the note in the test below — selecting on the verb matched
    // sovereignty's upkeep allocation and asserted the Levy's figures against another mechanic.
    const vote = observation.affordances.find(
      (a) => a.verb === 'vote' && a.params['ballot'] === LEVY_BALLOT,
    );
    out.push({ principal, block, vote });
  }
  return out;
}

/** A reading that can actually falsify the golden clause: offered a vote, and both marks non-zero. */
function discriminates(r: BallotReading): boolean {
  return (
    r.vote !== undefined &&
    r.block.exposure_peak_this_cycle > 0 &&
    r.block.assessed_on_exposure_peak > 0
  );
}

/** The first candidate world whose ballot window can falsify the clause. Never a hardcoded seed. */
function discriminatingBallotWindow(): {
  readonly runtime: Runtime;
  readonly readings: readonly BallotReading[];
  readonly seed: string;
  readonly reckonings: number;
} {
  const tried: string[] = [];
  for (const [seed, reckonings] of BALLOT_WINDOW_CANDIDATES) {
    const runtime = agedToBallotWindow(seed, reckonings);
    const readings = ballotWindowReadings(runtime);
    const n = readings.filter(discriminates).length;
    tried.push(`${seed}/R${String(reckonings)}:${String(n)}`);
    if (n > 0) return { runtime, readings, seed, reckonings };
  }
  throw new Error(
    `none of ${String(BALLOT_WINDOW_CANDIDATES.length)} candidate worlds put a principal inside the ` +
      `ballot window holding a NON-ZERO exposure mark on both figures, so the golden clause below ` +
      `cannot discriminate and would pass vacuously on toContain('0'). Either the cast stopped ` +
      `staking before the freeze, or the ballot window moved — do not delete the assertion. ` +
      `Counts per candidate: ${tried.join(' ')}`,
  );
}

/** The members a weight can discriminate between: not floored, not spared. */
function pool(d: Docket): readonly LevySubject[] {
  return d.subjects.filter((s) => !isNewcomer(s) && s.principal !== d.spared);
}

function amountsUnder(d: Docket, rule: LevyRule): readonly number[] {
  return allocate({
    constellation: 'con-1' as never,
    subjects: d.subjects,
    rule,
    spared: d.spared,
    byDefault: false,
  }).lines.map((l) => l.amount);
}

describe('★ the EXPOSURE high-water mark', () => {
  const world = aged('g07', 6);

  it('is NON-ZERO in an aged world — non-vacuity, and it is the whole subject', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **FIRST, AND IT IS NOT A FORMALITY.** Every assertion below is about a figure the *world* has to
    // produce. A world in which nobody ever staked would leave every mark at 0, make the pairwise and
    // paired assertions iterate over nothing, and report green — which is the state `D30` found and
    // this change exists to leave. It is also the precise failure the last three of these fixes had:
    // an invariant whose subject cannot occur is indistinguishable from one that passes.
    //
    // MUTATION: `CAST_STAKE_BPS` to 0 → red on the first expectation, naming the zero. Delete the
    // `observeExposurePeaks` call from the OBLIGE handler → red the same way, because a mark nobody
    // records is a mark that is not there.
    // ══════════════════════════════════════════════════════════════════════════
    expect(world.cycles.length, 'six Reckonings produced no complete cycle to read').toBeGreaterThan(0);

    const nonZero = world.cycles.flatMap((c) => [...c.markAsBilled.values()].filter((v) => v > 0));
    expect(
      nonZero.length,
      'not one principal carried a non-zero EXPOSURE high-water mark in any Reckoning of six. ' +
        '§3 says EXPOSURE is created by a venture role stake, a raid stake or a `join` stake; if this ' +
        'is red, none of the three is happening, or `Runtime.observeExposurePeaks` is not being called.',
    ).toBeGreaterThan(0);

    // And integers, because this is a HASHED field and a float in one cannot be reconciled
    // (`core/units.ts`). Also non-negative: a negative mark would flow into `weightOf` as a weight
    // below `LEVY_EXPOSURE_UNIT`, which is an exemption the Levy does not have.
    for (const cycle of world.cycles) {
      for (const [principal, mark] of cycle.markAsBilled) {
        expect(Number.isSafeInteger(mark), `${principal} mark ${String(mark)} is not a safe integer`).toBe(true);
        expect(mark, `${principal} carries a NEGATIVE high-water mark`).toBeGreaterThanOrEqual(0);
      }
    }
  }, 600_000);

  it('★ SURVIVES THE RELEASE — the mark at the freeze is the mark the docket bills', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE DEFINING PROPERTY, AND THE ONE THE DEFECT WAS THE ABSENCE OF.** Three readings of the same
    // principals within two ticks of each other:
    //
    //   · the mark at the FREEZE tick — near the cycle's high;
    //   · instantaneous EXPOSURE at the SETTLEMENT tick, after `releaseStakes` has run;
    //   · the mark re-read at phase 0 of the next cycle, which is what `assessLevyNow` weighted from.
    //
    // The first and third must be **equal** — a max does not move once the cycle is over, and nothing
    // between the freeze and the next phase 0 may lower it. And the third must **exceed** the
    // instantaneous reading for somebody, which is the trough being closed rather than merely
    // measured: if the two agree everywhere, the docket is reading the instant again.
    //
    // This is also the incentive that has to hold: releasing a stake before the freeze must not buy
    // relief from a bill already earned, or the dominant line is to stake all cycle and unwind.
    //
    // MUTATION: make `Book.observeExposure` overwrite instead of keeping the max (`row.peak =
    // minor(exposure)`) and the first assertion goes red — the settlement tick's near-zero reading
    // lands in the row and the freeze figure is gone. Move `observeExposurePeaks` after `settleNow`
    // in the OBLIGE handler and the second goes red on the seeds where the release is total.
    // ══════════════════════════════════════════════════════════════════════════
    let compared = 0;
    let strictlyAbove = 0;
    for (const cycle of world.cycles) {
      for (const [principal, atFreeze] of cycle.markAtFreeze) {
        if (atFreeze <= 0) continue;
        compared += 1;
        expect(
          cycle.markAsBilled.get(principal),
          `R${String(cycle.reckoning)} ${principal}: the mark read ${String(atFreeze)} at the freeze ` +
            `and ${String(cycle.markAsBilled.get(principal) ?? -1)} when the next docket was cut. A ` +
            'high-water mark is a MAX over the cycle — the release at settlement must not lower it, ' +
            'or unwinding before the freeze buys relief from a bill already earned.',
        ).toBe(atFreeze);
        const trough = cycle.instantAtAssess.get(principal) ?? 0;
        if (atFreeze > trough) strictlyAbove += 1;
      }
    }
    expect(compared, 'no principal carried any mark at any freeze, so nothing was compared').toBeGreaterThan(0);
    expect(
      strictlyAbove,
      `all ${String(compared)} readings had the mark EQUAL to the instantaneous EXPOSURE at phase 0. ` +
        'That means the trough is not being avoided — the docket is reading the same figure it always ' +
        'did, and `RULES_VERSION` 17 bought nothing. Check that `settleVenture` still releases stakes ' +
        'at settlement and that `assessLevyNow` still passes `reckoning - 1`.',
    ).toBeGreaterThan(0);
  }, 600_000);

  it('★ CANNOT BE PRUNED BEFORE IT IS READ — asserted from the constants, not from a comment', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **`Book.prune` HAS NOW DESTROYED A LOAD-BEARING ROW FOUR TIMES IN THIS REPO** — in the engine
    // (`MAX_RECKONING_SUMMARIES`), in a fix (`LEVY_RETAINED_RECKONINGS`), in the instrument
    // (`balance-gate.ts` accumulating off a bounded ring), and as a `Ring` cap that ate 109 `kept`
    // from a nine-Reckoning sweep. Every one failed **in the direction that hides**: the row was gone
    // and the number that depended on it read *clean*, not *missing*.
    //
    // A high-water mark is exactly that shape. So the relation is asserted three ways, from smallest
    // claim to largest:
    //
    //   1. **The arithmetic**, from the constant. `prune(R)` runs at the settlement tick of Reckoning
    //      R and keeps `>= R - LEVY_RETAINED_RECKONINGS`. The deepest read is `assessLevyNow` at phase
    //      0 of `R+1` asking for row **R** — the newest row there is. So the window would have to be
    //      negative to lose it. If somebody sets the retention to 0 this still holds; at -1 it does
    //      not, and this is the line that says so.
    //   2. **The book**, directly: write marks across six Reckonings, prune at 5, and check exactly
    //      which survive.
    //   3. **The world**: in the aged run, the mark the docket billed from was still readable AFTER
    //      the prune that ran one tick earlier. That is the end-to-end version and the only one that
    //      would catch a prune moved to a different phase.
    // ══════════════════════════════════════════════════════════════════════════
    // 1. The arithmetic.
    const READ_DISTANCE = 1; // `assessLevyNow` asks for `reckoning - 1` and nothing asks for less.
    expect(
      LEVY_RETAINED_RECKONINGS,
      `the Levy reads the high-water mark ${String(READ_DISTANCE)} Reckoning back and prune keeps ` +
        `${String(LEVY_RETAINED_RECKONINGS)}. Retention below the read distance destroys the row the ` +
        'docket is weighted from, and the docket would go flat SILENTLY — every rule agreeing on a ' +
        'mark of 0 looks exactly like a quiet world.',
    ).toBeGreaterThanOrEqual(READ_DISTANCE);

    // 2. The book, with the boundary bracketed rather than sampled.
    const book = new Book();
    const p = 'p:alpha' as PrincipalId;
    for (let r = 0; r <= 5; r += 1) book.observeExposure(r, p, minor(100 + r));
    for (let r = 0; r <= 5; r += 1) {
      expect(book.exposurePeakOf(r, p), `mark for R${String(r)} before any prune`).toBe(100 + r);
    }
    book.prune(5);
    for (let r = 0; r <= 5; r += 1) {
      const kept = r >= 5 - LEVY_RETAINED_RECKONINGS;
      expect(
        book.exposurePeakOf(r, p),
        `after prune(5) with a ${String(LEVY_RETAINED_RECKONINGS)}-Reckoning window, R${String(r)} ` +
          `should ${kept ? 'SURVIVE' : 'be dropped'}`,
      ).toBe(kept ? 100 + r : 0);
    }
    // ★ And the one that matters: the row a docket cut at phase 0 of R+1 would read.
    expect(
      book.exposurePeakOf(5, p),
      'prune(5) destroyed the mark for Reckoning 5, which is the row the NEXT docket is weighted ' +
        'from. This is the failure this test exists for and it is one off-by-one away at all times.',
    ).toBe(105);

    // 3. The world. `settleLevyNow` calls `levy.prune(reckoning)` at the settlement tick, so by the
    //    time these dockets were cut the prune had already run for the cycle they bill.
    const billedFromSomething = world.dockets.filter(
      (d) => d.reckoning > 0 && pool(d).some((s) => s.exposurePeak > 0),
    );
    expect(
      billedFromSomething.length,
      'not one docket in the aged world was weighted from a non-zero mark. Since `prune` runs at the ' +
        'settlement tick immediately before every assessment, a green `levyShort` with this at zero is ' +
        'the prune hazard having already happened.',
    ).toBeGreaterThan(0);
  }, 600_000);

  it('★ THE ENGINE\'S OWN DOCKET is weighted from the PREVIOUS cycle — the mutation that survived', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **WRITTEN AFTER A MUTATION SURVIVED, AND IT IS THE MOST IMPORTANT TEST IN THIS FILE.**
    //
    // Changing `assessLevyNow`'s subject reader from `reckoning - 1` to `reckoning` puts the
    // assessment back on the trough — the *entire defect* `RULES_VERSION` 17 exists to fix — and every
    // other test here stayed green, because they all build their own subject with `reckoning - 1` and
    // then assert about it. They test `levySubjectOf` and `weightOf`; they never asked what
    // `assessCycle` actually passed. That is a test suite agreeing with itself.
    //
    // `Allocation.weight` is the engine's own answer, written by `allocate` at mint time and carried
    // on the plan. Two assertions against it:
    //
    //   1. **The exact identity.** For every weighable line on an exposure-shaped docket, the recorded
    //      weight must equal `weightOf(rule, subject-with-the-PREVIOUS-cycle's-mark)`. Nothing but the
    //      right reading at the right call site satisfies that.
    //   2. **Discrimination**, as the readable version of the same claim: those recorded weights must
    //      not all be equal. Under the mutation they collapse to `LEVY_EXPOSURE_UNIT` for everybody,
    //      because at phase 0 the cycle in progress is one tick old.
    //
    // MUTATION (the one that motivated this): `assessLevyNow` → `this.levySubjectOf(principal,
    // ctx.tick, reckoning)`. Red on the identity, naming both weights.
    // ══════════════════════════════════════════════════════════════════════════
    const exposureShaped = world.dockets.filter(
      (d) => (d.rule === 'BY_EXPOSURE' || d.rule === 'INVERSE_EXPOSURE') && pool(d).length >= 2,
    );
    expect(
      exposureShaped.length,
      'no docket in this world was allocated under BY_EXPOSURE or INVERSE_EXPOSURE with two weighable ' +
        "members, so nothing here asserts anything. `HeuristicCast.ballotFor` picks the rule that " +
        'minimises its own share, so which rules get voted is a property of the world.',
    ).toBeGreaterThan(0);

    let discriminating = 0;
    for (const docket of exposureShaped) {
      const weighed = new Set(pool(docket).map((s) => s.principal));
      const live: number[] = [];
      for (const [i, subject] of docket.subjects.entries()) {
        if (!weighed.has(subject.principal)) continue;
        const recorded = docket.recordedWeights[i] ?? -1;
        expect(
          recorded,
          `R${String(docket.reckoning)} ${docket.principals[i] ?? '?'} under ${docket.rule}: the plan ` +
            `records weight ${String(recorded)}, but the previous cycle's high-water mark ` +
            `(${String(subject.exposurePeak)}) gives ${String(weightOf(docket.rule, subject))}. ` +
            '`assessLevyNow` must pass `reckoning - 1` to `levySubjectOf` — passing `reckoning` reads ' +
            'the cycle that is one tick old, which is the 22x trough this change exists to close.',
        ).toBe(weightOf(docket.rule, subject));
        live.push(recorded);
      }
      if (new Set(live).size >= 2) discriminating += 1;
    }
    expect(
      discriminating,
      `not one of ${String(exposureShaped.length)} exposure-shaped dockets recorded two different ` +
        'weights. Equal weights across the board is what the trough looked like: `largestRemainder` ' +
        'over equal weights is a flat docket, and the vote moves nothing.',
    ).toBeGreaterThan(0);
  }, 600_000);

  it('round-trips through capture()/restore(), and restores from a PRE-17 checkpoint as zeros', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // Two directions, and the second is the deploy risk rather than a completeness box.
    //
    // A checkpoint written before this field existed holds no `exposurePeaks` key. `restore` reads it
    // with `?? []`, so such a checkpoint adopts cleanly, every mark reads 0, and the two exposure
    // rules are flat until the world has been observed for a cycle — the same answer a genesis world
    // gives on its first Reckoning. That is the **safe** direction: a fabricated mark would bill a
    // real principal for peril the record cannot show, which is A5′.
    // ══════════════════════════════════════════════════════════════════════════
    const book = new Book();
    const a = 'p:aa' as PrincipalId;
    const b = 'p:bb' as PrincipalId;
    book.observeExposure(3, a, minor(4_100));
    book.observeExposure(3, b, minor(7));
    book.observeExposure(4, a, minor(9));

    let live = book;
    const table = levyStateTable(
      () => live,
      (fresh) => {
        live = fresh;
      },
    );
    const captured = table.capture();
    // `StateTable.restore` is optional in the interface and `rollbackGaps` reports a table that
    // lacks one. Asserted rather than `?.`-ed: a levy table with no restore is the rollback hole
    // this field must never sit in, and a silent no-op here would make the whole test vacuous.
    const restore = table.restore?.bind(table);
    expect(restore, 'the levy state table has no `restore`, so a rollback cannot recover the marks').toBeDefined();
    if (restore === undefined) return;
    restore(captured);
    expect(live.exposurePeakOf(3, a)).toBe(4_100);
    expect(live.exposurePeakOf(3, b)).toBe(7);
    expect(live.exposurePeakOf(4, a)).toBe(9);
    expect(live.exposurePeakOf(4, b), 'a pair nobody observed reads 0, never undefined').toBe(0);
    // Non-vacuity for the round trip itself: the capture must actually carry the rows, or this test
    // would pass over an empty array restoring into an empty map.
    expect(
      JSON.stringify(captured),
      'the capture does not mention `exposurePeaks`, so the field is not in `state_hash` and a ' +
        'rollback would not restore it — which is `RULES_VERSION` 17 not actually landing',
    ).toContain('exposurePeaks');
    expect(JSON.stringify(captured)).toContain('4100');

    // The pre-17 checkpoint: the same capture with the key removed.
    const legacy = { ...(captured as Record<string, unknown>) };
    delete legacy['exposurePeaks'];
    restore(legacy as never);
    expect(
      live.exposurePeakOf(3, a),
      'a checkpoint written before this field existed must restore to zero marks rather than throw',
    ).toBe(0);
    expect(live.seatedAtOf(a), 'and the rest of the book must still restore').toBeNull();
  });

  it('publishes the mark to the AGENT in the units the rule reads (A2)', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **A2: KNOWN ARITHMETIC IS EXACT AND MACHINE-READABLE, OR THE VOTE IS A GUESS.** Two of §5.2's
    // four rules are computed from this figure. Before `RULES_VERSION` 17 nothing published it at all
    // — the closest field was `obligations.exposure.mine`, the *instantaneous* reading, which at phase
    // 0 is near zero for the exact reason this change exists. An agent reading that and reasoning
    // about its bill was reasoning correctly from the wrong number, which is scar #1's class.
    //
    // Asserted against `Book.exposurePeakOf` — the engine's own reader, the same call `levySubjectOf`
    // makes for the weight. A test that recomputed the mark here would be a second arithmetic and
    // could agree with itself while disagreeing with the docket.
    //
    // MUTATION: swap the two fields in `levyBlockFor` (publish `reckoning` where `reckoning - 1` goes)
    // and the first two assertions go red naming both figures; the observe fixture seeds them unequal
    // for exactly that reason.
    // ══════════════════════════════════════════════════════════════════════════
    // A world stopped INSIDE the ballot window, because `vote` is not offered outside it. The shared
    // aged world ends on a settlement tick — phase 287, long past `WINDOW_FIRST_PHASE` — which is
    // exactly what the first version of this test discovered by going red on its own message.
    // ── ★ `g07` → `g08`, AND THE SWAP IS A FINDING ABOUT THE FIXTURE ─────────
    //
    // `quotedNonZero` is the vacuity guard directly below, and on `g07` it went to **0** the moment
    // the fourth good landed: alloy's cast branches sit above `fill_role` in `decideOne`, so a few
    // staked fills moved a few ticks and the one principal that had carried a non-zero mark at this
    // exact phase no longer did. Nothing about the mark broke — `exposurePeakOf` is unchanged and
    // every other assertion in this file passed.
    //
    // Measured across all eight gate seeds at Reckonings 3, 4 and 5 — **24 pairs, re-run after every
    // behavioural change in this branch** — the count of principals holding a non-zero mark inside the
    // ballot window is **0, 1, 2 or 3 out of 8**, and it is 0 in roughly a third of them. So this test
    // has always been one principal from vacuous on every seed, and `g07` merely happened to be on the
    // right side of the line when it was written. It came off that side twice in one afternoon, on two
    // unrelated cast edits, which is what identifies the fragility as structural rather than as bad
    // luck.
    //
    // `g01` at Reckoning 4 carried **3**, the widest any of the 24 pairs offered, and it was the
    // fourth pick in one session — `g07` → `g08` → `g01` → `g06` → `g01` — re-rolled by four
    // unrelated cast edits, none of which touched EXPOSURE, staking, or the mark. Two re-rolls is bad
    // luck; five picks is a property of the fixture.
    //
    // ── ★ SO IT NO LONGER PICKS. IT SCANS. ──────────────────────────────────
    //
    // {@link discriminatingBallotWindow} walks the 24 candidate pairs and takes the first whose
    // ballot window can actually falsify the golden clause, failing only when NONE of them can —
    // which is the durable fix this comment used to describe as future work, done here because the
    // branch that moved the endowment floor changes what the cast spends and would have re-rolled
    // this for the sixth time. The seed is now an OUTPUT of the test, reported in its own message.
    //
    // Scanning rather than weakening the guard, because the guard is the point:
    //
    // **EXPOSURE is Σ open `max_direct_loss`; a role stake is held only from fill to settlement; and
    // the ballot closes 40 ticks before a settlement that has just released most of them.** So the
    // quantity this whole mechanic votes on is near its floor at exactly the moment the vote happens
    // — which is `D32`'s trough diagnosis surviving `D34`'s fix, one layer out. `D34` moved the
    // ASSESSMENT onto the high-water mark and left the BALLOT reading the instantaneous set. Making
    // this test robust and making the vote well-informed are the same fix, and it is a cast or a
    // schedule question rather than a test one.
    const { runtime, readings, seed, reckonings } = discriminatingBallotWindow();
    const where = `${seed}/R${String(reckonings)}`;
    const reckoning = reckoningIndex(runtime.engine.tick);
    let checked = 0;
    let quoted = 0;
    // ── THE VACUITY TRAP THIS TEST NEARLY SHIPPED ─────────────────────────────
    //
    // The golden clause below is `toContain(String(figure))`. With `figure` at 0 that is
    // `toContain('0')`, which matches almost any sentence containing any number — so a world whose
    // marks were all zero would pass this test while proving nothing at all. Counted separately and
    // asserted at the end: at least one principal must have been quoted a **non-zero** mark.
    let quotedNonZero = 0;
    for (const { principal, block, vote } of readings) {
      checked += 1;
      expect(
        block.assessed_on_exposure_peak,
        `${where}/${principal}: levy.assessed_on_exposure_peak must be the mark the CURRENT docket ` +
          'was weighted from, which is the previous Reckoning\'s',
      ).toBe(runtime.levy.exposurePeakOf(reckoning - 1, principal));
      expect(
        block.exposure_peak_this_cycle,
        `${where}/${principal}: levy.exposure_peak_this_cycle must be the mark of the cycle IN ` +
          'PROGRESS, which is what the next docket will read',
      ).toBe(runtime.levy.exposurePeakOf(reckoning, principal));

      // ── `verb === 'vote'` IS NOT ENOUGH, AND THE FIRST VERSION OF THIS TEST FOUND OUT ──
      //
      // §12.2 is "one verb, three ballots" and the CHARGE ballot is also a `vote`. Selecting on the
      // verb alone matched sovereignty's upkeep allocation — *"decides how Reckoning 4's sovereignty
      // upkeep is SPLIT across your constellation's claims"* — and asserted the Levy's figures against
      // a sentence from a different mechanic. It went red only because the quoted figure was not a
      // substring of it; with a mark of 0 it would have passed on `toContain('0')`. Two vacuity traps
      // in one assertion, and this is the one the canon warns about: a term shared between mechanics.
      // The `vote` affordance was resolved by {@link ballotWindowReadings}, which is also what the
      // scan's predicate reads — so the world this test runs on is chosen BY this assertion rather
      // than in spite of it.
      if (vote === undefined) continue;
      quoted += 1;
      if (block.exposure_peak_this_cycle > 0 && block.assessed_on_exposure_peak > 0) quotedNonZero += 1;
      // ★ A GOLDEN CLAUSE BUILT FROM THE ENGINE'S OWN QUOTE, never from a literal. The affordance
      // reads the figures off the same block asserted above, so this checks the SENTENCE and the
      // ARITHMETIC cannot come apart — which is the only failure mode scar #1 had.
      expect(
        vote.what_it_forecloses,
        'the `vote` affordance must quote the mark the next docket will read, in figures. A member ' +
          'choosing between BY_EXPOSURE and INVERSE_EXPOSURE without it is voting on a number it ' +
          'cannot see.',
      ).toContain(String(block.exposure_peak_this_cycle));
      expect(vote.what_it_forecloses).toContain(String(block.assessed_on_exposure_peak));
      expect(
        vote.what_it_forecloses,
        'and it must say WHICH reading, because "whoever has most at risk" is true of a dozen of them',
      ).toMatch(/HIGHEST EXPOSURE/);
      expect(vote.what_it_forecloses).toContain('exposure_peak_this_cycle');
    }
    expect(checked, 'no principal held a Levy block, so nothing was checked').toBeGreaterThan(0);
    expect(
      quoted,
      'no principal was offered `vote`, so the affordance text was never read. The ballot closes at ' +
        'WINDOW_FIRST_PHASE — if this is red the world stopped outside the ballot window and this ' +
        'test needs a tick that is not there.',
    ).toBeGreaterThan(0);
    expect(
      quotedNonZero,
      `${where}: every \`vote\` affordance read here quoted a mark of ZERO for at least one of the ` +
        "two figures, so `toContain('0')` matched any sentence with a digit in it and the golden " +
        'clause above proved nothing. `discriminatingBallotWindow` is supposed to make this ' +
        'unreachable — if it is red, the scan and this guard disagree about what discriminates.',
    ).toBeGreaterThan(0);
  }, 600_000);

  it('★ MAKES THE VOTE A REAL DECISION — measured in MINOR, on real dockets', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **§5.2 CALLS THE VOTE "THE DRAMA". THIS IS THAT CLAIM AS A NUMBER.** A rule that changes nobody's
    // bill is a rule that is not there, and until `RULES_VERSION` 17 three of the four changed nothing
    // on seven dockets in eight. So the assertion is not "the rules differ" — the second test in
    // `four-rules-one-lever.spec.ts` owns that — it is **how much a member's own ballot is worth**:
    //
    //   · the SWING: for each weighable member, the span between the cheapest and the dearest rule.
    //     Every one must be non-zero, because a member with a zero swing has no stake in the vote at
    //     all and its ballot is decoration.
    //   · the NAMED LOSER: `namedLoser`'s own quantity, the extra a member bore because of what the
    //     group CHOSE versus what the published default would have done. §14.4 wants a named loser by
    //     the group's action every cycle.
    //
    // Measured, eight gate seeds, six Reckonings, over the 40 weighable dockets: mean swing **5,956
    // MINOR** and max **21,093** against a `LEVY_DUTY_PER_PRINCIPAL` of 20,000 — so a mean of ~30% of
    // a member's whole duty rides on which rule carries — with **zero** members at a zero swing, and
    // **35 of 40 dockets naming a loser** (mean extra 10,065, max 23,634). Under the instantaneous
    // reading the same 40 dockets had 12 with any spread at all.
    //
    // This test asserts the SHAPE on the two seeds it runs, not those totals: a percentage pinned
    // from one sweep makes an unrelated cast change look like this regressing.
    //
    // MUTATION: point both exposure arms of `weightOf` at a constant and the swing collapses to
    // whatever `BY_STORES` alone can move, taking the zero-swing count above zero on the flat dockets.
    // ══════════════════════════════════════════════════════════════════════════
    const weighable = world.dockets.filter((d) => pool(d).length >= 2);
    expect(
      weighable.length,
      'no docket had two weighable members. With a pool of one, `largestRemainder(r, [w])` is `[r]` ' +
        'for every w and no rule can move anything — so there is nothing here a vote could decide.',
    ).toBeGreaterThan(0);

    const swings: number[] = [];
    let dockesWithALoser = 0;
    let worstExtra = 0;
    for (const docket of weighable) {
      const order = amountsUnder(docket, 'EVEN');
      const byRule = new Map(LEVY_RULES.map((rule) => [rule, amountsUnder(docket, rule)] as const));
      const weighed = new Set(pool(docket).map((s) => s.principal));
      for (const [i, subject] of docket.subjects.entries()) {
        if (!weighed.has(subject.principal)) continue;
        const mine = LEVY_RULES.map((rule) => byRule.get(rule)?.[i] ?? 0);
        swings.push(Math.max(...mine) - Math.min(...mine));
      }
      void order;

      // The engine's own counterfactual: what the group's choice cost against the default.
      const voted = allocate({
        constellation: 'con-1' as never,
        subjects: docket.subjects,
        rule: docket.rule,
        spared: docket.spared,
        byDefault: docket.byDefault,
      });
      const underDefault = allocate({
        constellation: 'con-1' as never,
        subjects: docket.subjects,
        rule: PUBLISHED_DEFAULT_RULE,
        spared: null,
        byDefault: true,
      });
      let extra = 0;
      for (const [i, line] of voted.lines.entries()) {
        extra = Math.max(extra, line.amount - (underDefault.lines[i]?.amount ?? 0));
      }
      if (extra > 0) dockesWithALoser += 1;
      worstExtra = Math.max(worstExtra, extra);
    }

    expect(swings.length, 'no weighable member was measured').toBeGreaterThan(0);
    const zeroSwing = swings.filter((s) => s === 0).length;
    expect(
      zeroSwing,
      `${String(zeroSwing)} of ${String(swings.length)} weighable members owe the SAME amount under ` +
        'all four rules, so their ballot cannot change their own bill. §5.2 makes the allocation "a ' +
        'scheduled constellation vote" — a member with nothing riding on it is being asked to vote on ' +
        'nothing.',
    ).toBe(0);

    const mean = Math.round(swings.reduce((a, b) => a + b, 0) / swings.length);
    expect(
      mean,
      `the mean per-member swing between the cheapest and dearest rule is ${String(mean)} MINOR. A ` +
        'vote worth a rounding error is not a decision; §5.2 wants who is spared to be a choice with ' +
        'a price.',
    ).toBeGreaterThan(1_000);

    expect(
      dockesWithALoser,
      `not one of ${String(weighable.length)} weighable dockets named a loser — nobody paid more ` +
        'because of what the group chose than the published default would have charged. §14.4 asks ' +
        "for a named loser BY THE GROUP'S ACTION every cycle, and that is only meaningful against " +
        'this counterfactual.',
    ).toBeGreaterThan(0);
    expect(worstExtra, 'and the worst case must be material, not a unit of rounding').toBeGreaterThan(1_000);
  }, 600_000);

  it('orders the SWEEP by the mark too — or says out loud that no world here went short', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **AN HONEST TRIPWIRE, NOT A GREEN TICK.** §5.2's published default is *"allocated inversely to
    // Exposure, shortfall swept from the least-exposed first"*, and the sweep half read
    // **instantaneous** EXPOSURE at the settlement tick — which is the tick `settleVenture` releases
    // every stake, so it was ~0 for everybody and the "least-exposed first" queue was alphabetical.
    // `RULES_VERSION` 17 points it at the same high-water mark the allocation uses.
    //
    // **The change is order-only and provably amount-neutral**: each sweep draws on its own
    // principal's stores up to its own purchasable shortfall (`SweepPort.availableOf(principal)`), so
    // there is no pot for a queue position to exhaust. `settle.ts:ExposurePeakRead` carries that
    // argument, and `chronic.test.ts` pins the port's ordering contract against distinct readings.
    //
    // What CANNOT be exercised here is the **runtime's wiring**, and this test says so rather than
    // implying coverage it does not have: the eight gate seeds are `levyShort` 0 with 0 red tribute
    // lines at three, six and nine Reckonings, so no principal in any of them has a purchasable
    // shortfall and the queue is empty by construction. A capability that exists and is never
    // exercised is indistinguishable from one that is missing — including to whoever reads this next
    // — so the assertion is conditional and the *absence* is reported at the assertion.
    //
    // The moment any world here does go short this starts asserting for real. If it goes red, the
    // sweep is ordering by something other than the mark.
    // ══════════════════════════════════════════════════════════════════════════
    const settlement = world.runtime.levySettlement;
    const queue = settlement?.sweepQueue ?? [];
    if (queue.length < 2) {
      // Recorded, not skipped. `levyShort` 0 is the *healthy* outcome and the reason this is empty.
      expect(
        settlement?.levyShort ?? 0,
        'the sweep queue is empty AND `levyShort` is non-zero, which cannot both be true: a ' +
          'purchasable shortfall is exactly what puts a principal in the queue. Something is short ' +
          'and nothing is being swept.',
      ).toBe(0);
      return;
    }
    const reckoning = reckoningIndex(world.runtime.engine.tick);
    const marks = queue.map((p) => world.runtime.levy.exposurePeakOf(reckoning, p));
    for (let i = 1; i < marks.length; i += 1) {
      expect(
        marks[i] ?? 0,
        `the sweep queue runs ${queue.join(' -> ')} with marks [${marks.join(', ')}], which is not ` +
          'ascending. §5.2 sweeps from the LEAST-exposed first, and "exposed" is the cycle\'s ' +
          'high-water mark (`levy/settle.ts:ExposurePeakRead`).',
      ).toBeGreaterThanOrEqual(marks[i - 1] ?? 0);
    }
  });

  it('ranks the exposed by the MARK, in both directions, and never exempts anyone', () => {
    // The direction, on the new reading. `four-rules-one-lever.spec.ts` asserts this on a subject it
    // reads from the engine; this asserts it on the *weight function* against hand-built marks, so a
    // world that happened to produce no spread cannot make it vacuous.
    //
    // Never zero is the clause that matters most: §5.2's protections are "never identity, never the
    // holding, never standing" and there is no fourth. A weight of 0 under `INVERSE_EXPOSURE` would be
    // an exemption for the most exposed member, which is not "allocated inversely to Exposure".
    const at = (peak: number): LevySubject => ({
      principal: `p:${String(peak)}` as PrincipalId,
      tenureTicks: TICKS_PER_RECKONING * 10,
      freeStores: minor(10 ** 7),
      levyGoodHeld: 0 as never,
      exposurePeak: minor(peak),
    });
    const safe = at(0);
    const exposed = at(50_000);
    expect(weightOf('BY_EXPOSURE', exposed)).toBeGreaterThan(weightOf('BY_EXPOSURE', safe));
    expect(weightOf('INVERSE_EXPOSURE', exposed)).toBeLessThan(weightOf('INVERSE_EXPOSURE', safe));
    expect(weightOf('INVERSE_EXPOSURE', at(10 ** 12))).toBeGreaterThanOrEqual(1);
    // `EVEN` and `BY_STORES` are untouched by the mark, and that is a claim worth pinning: a change
    // that routed all four rules through it would delete two of the four levers.
    expect(weightOf('EVEN', exposed)).toBe(weightOf('EVEN', safe));
    expect(weightOf('BY_STORES', exposed)).toBe(weightOf('BY_STORES', safe));
  });
});
