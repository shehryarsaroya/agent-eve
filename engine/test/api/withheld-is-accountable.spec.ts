/**
 * ★ **PER-OBSERVATION VERB ACCOUNTABILITY — the property AGT-R5 does not check.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `header.withheld` closes with *"Nothing you were eligible for has been dropped without this
 * count."* That is an absolute promise about the affordance list, and until now **nothing
 * connected it to the verb set**. Every row was hand-written per mechanic, so a mechanic could
 * ship with no row at all — and one did:
 *
 *     trade   silent in 497 of 576 observations (86.3%), with a reachable venue in EVERY one
 *
 * measured on a swept 1,800-tick world, and reproduced on the live shard against a real
 * enrolled principal holding 200,000 currency and 40,116 `ration`.
 *
 * **`agt-r5-reachability.test.ts` passes, and could not have caught it.** It asks *"is every
 * live verb offered SOMEWHERE"* — a global property over a whole sweep, reconciled against an
 * exception list. `trade` came off that list legitimately the day a resting order first
 * existed. The property that broke is per-observation: *when this verb is absent for THIS
 * principal on THIS wake, is the absence accounted for?* Global reachability and per-wake
 * accountability are different claims, and only the first had a test.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## What makes the property checkable at all
 *
 * `header.withheld.verbs` — each row tagged with the verb whose absence it explains. Without
 * it the accounting exists only as prose, and prose is not reconcilable against
 * `header.live_verbs`; string-matching the verb name does not work either, because the honest
 * sentences do not always contain it (`build`'s row says *"a WORKS at sys-04 is not offered"*,
 * `deliver`'s says *"Charge delivery(ies)"*).
 *
 * ## The trigger, and why it is read off the PAYLOAD
 *
 * "Genuinely inapplicable" needs a definition or the invariant is unfalsifiable. Writing a
 * predicate per verb over engine state would be a second implementation of the affordance
 * layer — ~500 lines, two homes for one rule, the exact anti-pattern that produced the bug.
 *
 * So a trigger is a predicate over **the observation the agent is holding**: *the payload
 * itself shows the input this verb consumes is present.* That is cheap, it re-implements
 * nothing, and it is the standard an agent would hold us to — if `market.at` is non-empty the
 * agent can see it is standing in a market, and a silent `trade` is a contradiction *it can
 * detect*. Where a verb's trigger cannot be read off the payload it is declared in
 * {@link UNTRIGGERED} with a reason, on AGT-R5's discipline: the list is the review surface,
 * and "we have not got round to it" is not a legitimate entry.
 *
 * ## What is CLOSED and what is DECLARED
 *
 * {@link CLOSED} verbs must be accounted for in **every** observation where their trigger
 * fires. {@link OPEN} verbs are the ones this sweep found in `trade`'s position and did not
 * close — each with its measured rate, so the size of the remaining gap is on the record
 * rather than in somebody's memory. Both directions are checked, so neither list can rot.
 */

import { describe, expect, it } from 'vitest';
import { buildObservation, MAX_DOSSIER_OFFERS } from '../../src/api/observe.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { COMPARTMENTS } from '../../src/grant/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { commonsSystems } from '../../src/world/index.js';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(obj) : []);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

type Payload = Record<string, unknown>;
type Trigger = (o: Payload) => boolean;

/**
 * **CLOSED** — the verb is accounted for in every observation where its input is visible.
 *
 * Each trigger reads only fields the payload publishes, and each is the *agent's own* test for
 * "I can see I have what this verb needs". A trigger that were stricter than that would let the
 * engine off for a state an agent would call a contradiction.
 */
const CLOSED: Readonly<Record<string, Trigger>> = Object.freeze({
  /**
   * ★ THE DEFECT. `market.at` non-empty is exactly the probe's own reasoning: *I am standing in
   * a market and I am offered no trade and nothing says why.*
   */
  trade: (o) => strings(obj(o['market'])['at']).length > 0,
  /**
   * ★ **PROMOTED FROM `OPEN` AT `RULES_VERSION` 31, AND THE OLD ENTRY'S REASON IS WHY.**
   *
   * It read: *"TRIGGER TOO COARSE — 209/568 (36.8%) silent while `counterparties[]` is non-empty.
   * `message` is scoped to a VENTURE you are both party to, not to anyone you have heard of, so
   * having a counterparty is not having somebody to talk to."*
   *
   * That was an exact description of the defect 31 fixes, filed as a reason not to fix the row.
   * **Having a counterparty is now having somebody to talk to**: `counterparties[]` carries every
   * principal a PARLEY may reach, `message {to, act, text}` is the act, and when it is not offered
   * `header.parley.rule` says which of the three walls was hit — not entitled, spent, or nobody
   * reachable. So the trigger stops being too coarse by the list becoming exactly what the trigger
   * assumed it was.
   *
   * A stale exception on a list like this is worse than a missing one: it is the review surface
   * asserting a limitation the engine no longer has, which is how a fixed defect gets re-argued as a
   * constraint.
   */
  message: (o) => rows(o['counterparties']).length > 0,
  /** An IDLE hand is the input `move` consumes, and it is published on every `hands[]` row. */
  move: (o) => rows(o['hands']).some((h) => h['state'] === 'IDLE'),
  /**
   * A FORMING venture of this principal's that it has not signed. `sign` is the one act that
   * stops a venture lapsing, so an unaccounted absence here costs a real deal.
   *
   * ★ **`my_role !== null` USED TO BE PART OF THIS, AND IT MADE THE GUARD BLIND TO THE CREATOR.**
   * A probe reported that `sign` is never offered to a venture's creator, that two fully-staffed
   * ventures died ABANDONED of it, and that two other agents' hands were wasted. **The report is
   * false** — verified from outside on a live world: a creator's `sign` arrives first in the list,
   * with copy-pasteable params, and `briefing.prompt` names it in words.
   *
   * But the reason this sweep could not have contradicted it is the finding. `ventures.mine[]`
   * holds ventures you created *or* hold a role in, so inside `mine` **`my_role === null` means you
   * are the creator** — and the old clause excluded exactly that row. The one case a probe would
   * doubt was the one case the guard could not see, and the guard reported green either way. That
   * is this project's standing defect (an invariant whose subject cannot occur) applied to the
   * accountability sweep itself, so the clause is gone and the creator case is asserted
   * non-vacuously below.
   */
  sign: (o) =>
    rows(obj(o['ventures'])['mine']).some(
      (v) => v['i_have_signed'] === false && v['state'] === 'FORMING',
    ),
});

/**
 * The creator half of `sign`'s trigger, counted separately.
 *
 * A widened trigger that never fires on the widened case is the same vacuity one level in: the
 * clause would be gone from the source and the coverage would not have moved. Inside
 * `ventures.mine[]`, `my_role === null` is the creator.
 */
const SIGN_AS_CREATOR: Trigger = (o) =>
  rows(obj(o['ventures'])['mine']).some(
    (v) => v['my_role'] === null && v['i_have_signed'] === false && v['state'] === 'FORMING',
  );

/**
 * **OPEN** — found in `trade`'s position by this sweep and NOT closed here, with the measured
 * silence rate at the time of writing and why it is deferred rather than fixed.
 *
 * Every rate below is `silent / trigger-fired` over one 1,800-tick 8-member world sampled every
 * 25 ticks (576 observations), `seed: trig`. **These are not targets and not excuses**; they are
 * the size of the gap, written down so the next reader does not have to re-measure to find out
 * whether it moved. Three legitimate kinds of reason:
 *
 *   - **TRIGGER TOO COARSE** — the payload field this sweep keys on is a superset of the state
 *     the verb needs, so some share of the "silence" is correct behaviour and the honest rate is
 *     unknown until a sharper trigger exists. Closing on a coarse trigger would bill an agent a
 *     row for a decision it cannot make, which is the mistake `demand` was explicitly built to
 *     avoid in the Commons (A8 makes the act *invalid*, so no row).
 *   - **NEEDS A DESIGN CALL** — the reason is real and the sentence is not writable without
 *     deciding something the owner has not decided.
 *   - **OUT OF SCOPE HERE** — real, in another module's lane.
 */
const OPEN: Readonly<Record<string, string>> = Object.freeze({
  abandon:
    'TRIGGER TOO COARSE — 136/137 (99.3%) silent while holding a claim. `crossingAnchored` names ' +
    '`abandon` in its TEXT but the row is tagged `graduate`, so the tag is right and the verb has no ' +
    'row of its own. Holding a claim is not the same as wanting to drop one, and the sovereignty ' +
    'block already publishes the arrears and the bond. Needs the sharper trigger (STRAINED, or in ' +
    'arrears) before a row is honest.',
  build:
    'NEEDS A DESIGN CALL — 541/576 (93.9%) silent while `holding.works.here` exists. `worksWithheld` ' +
    'already covers the UNAFFORDABLE branch; the rest is mostly "you already hold a WORKS here", ' +
    'which is a state `holding.works.held[]` publishes and which a row would repeat on every wake ' +
    'forever. Whether a permanent, unchangeable condition should be counted every wake is the open ' +
    'question, and it applies to several verbs at once.',
  deliver:
    'TRIGGER TOO COARSE — 538/576 (93.4%) silent while an obligation exists. `chargeNoHand` and ' +
    '`carryBlocked` already cover the two blocked cases; a Charge that is simply PAID is not a ' +
    'withholding. Needs a trigger keyed on an OUTSTANDING amount.',
  vote:
    'TRIGGER TOO COARSE — 451/576 (78.3%) silent while a `levy` block exists. A levy block exists ' +
    'every wake; a BALLOT is open for a slice of the cycle. The honest trigger is the ballot window ' +
    'and the payload does publish `closes_tick`, so this is the cheapest of the six to close next.',
  grant:
    'NEEDS A DESIGN CALL — 246/538 (45.7%) silent while sitting in a syndicate. `grant` is the A6 ' +
    'core loop, so silence here is the most expensive on this list. But an office must EXIST before ' +
    'it can be granted, and offices are voted into being — so the row would have to explain a ' +
    'multi-step path, which is a rules excerpt rather than a withheld reason.',
  elect:
    'TRIGGER TOO COARSE — 124/377 (32.9%) silent while a LIVE venture exists. `elect` is for a ' +
    'venture YOU created, on a role somebody ELSE holds, inside the commitment window. Three ' +
    'conjuncts the trigger does not carry.',
  seal:
    'NEEDS A DESIGN CALL — 152/576 (26.4%) silent while `next_reckoning.seal_slot` is non-null. A ' +
    'slot being open is not the same as having an intention worth sealing, and §11.2 makes a seal ' +
    'declassify one Reckoning later — so a row urging one every wake changes behaviour rather than ' +
    'explaining it.',
  haul:
    'OUT OF SCOPE HERE — 87/259 (33.6%) silent with an IDLE hand. `haul` needs goods at the hand\'s ' +
    'system AND a lane AND somewhere worth taking them; the payload publishes the first two. Real, ' +
    'and it belongs with the goods-movement surface rather than with the market.',
  post_bond:
    'OUT OF SCOPE HERE — 51/286 (17.8%) silent outside the Commons. The sovereignty block owns this ' +
    'sentence and already publishes `holding.bond`.',
  refine:
    'OUT OF SCOPE HERE — 8/561 (1.4%) silent while holding a WORKS. The smallest gap on the list and ' +
    'the fourth good\'s own lane.',
});

/**
 * Verbs with **no payload trigger at all**, each with why. Same discipline as AGT-R5's
 * `UNOFFERED`: an entry without a reason is not allowed to exist.
 *
 * These are all RESPONSE-ONLY — the verb answers something another principal started, and the
 * pending thing is published in the payload only while it is pending, at which point the verb is
 * *offered*. So "unoffered and unnamed" is the correct and complete answer, and a trigger would
 * fire on nothing.
 */
const UNTRIGGERED: Readonly<Record<string, string>> = Object.freeze({
  audit:
    'ALREADY ACCOUNTED, BY A DEDICATED BRANCH — `auditNoClearance`, tagged `audit`. It is the one verb ' +
    'whose two states are total: a grantor with a live CLEARANCE out is OFFERED the act, and a grantor ' +
    'with grants but no clearance gets the row saying its access log is empty by construction. A ' +
    'principal that has issued no grant at all is not withholding anything — there is no subject.',
  admit: 'RESPONSE-ONLY — needs a pending application to your syndicate; offered while one is pending.',
  apply: 'RESPONSE-ONLY — needs a syndicate whose charter admits applications, which is somebody else\'s act.',
  approve: 'RESPONSE-ONLY — needs an open proposal in a syndicate you sit in.',
  deny: 'RESPONSE-ONLY — needs a pending application to refuse.',
  revoke: 'RESPONSE-ONLY — needs a live grant you issued; `grants.granted[]` publishes it and the verb is offered.',
  withdraw: 'RESPONSE-ONLY — needs a syndicate membership to give notice on.',
  yield: 'RESPONSE-ONLY — needs a DEMANDED raid against you; offered on the raid row for its whole window.',
  fight: 'RESPONSE-ONLY — same window as `yield`, same row.',
  join: 'RESPONSE-ONLY — needs a LIVE raid you are not already a side of, at a stage where you have a hand.',
  engage: 'RESPONSE-ONLY — needs an ANSWERED FIGHT plus a READY hull berthed at the stage. The narrowest state in the game.',
  demand:
    'ALREADY ACCOUNTED, BY TWO DEDICATED BRANCHES — `demandCapacitySpent` and `demandSilent`, both tagged ' +
    '`demand`, and deliberately NOT counted in the Commons where A8 makes the act invalid rather than ' +
    'refused. It needs no trigger here because it is the one verb whose accounting is already total.',
  fill_role: 'ALREADY ACCOUNTED, BY THREE BRANCHES — `alternateHands`, `rowsOutOfReach`, `rowsWithNoHand`.',
  graduate: 'ALREADY ACCOUNTED — `crossingWithheld` and `crossingAnchored`.',
  claim: 'ALWAYS OFFERED — a claim costs no action and is on every menu, so it is never absent.',
  publish_offer: 'ALWAYS OFFERED — free, bounded, public, on every menu.',
  create: 'ALWAYS OFFERED — the kinds an agent can afford are on every menu; the rest are named on the row.',
  form: 'ALWAYS OFFERED where affordable — the syndicate entry point, priced in currency.',
  set_delivery_intent: 'REACHABLE ELSEWHERE — the offline path; covered by test/api/offline-path-is-expressible.test.ts.',
});

interface Sample {
  /** verb -> observations where its trigger fired */
  readonly fired: Map<string, number>;
  /** verb -> observations where its trigger fired AND it was neither offered nor named */
  readonly silent: Map<string, number>;
  readonly observations: number;
  readonly live: readonly string[];
  /** Observations where `sign`'s trigger fired for a CREATOR — see SIGN_AS_CREATOR. */
  readonly signAsCreatorFired: number;
  readonly signAsCreatorSilent: number;
}

/**
 * One sweep, memoised, shared by every direction — the correction `agt-r5-reachability` had to
 * make for the same reason. Two directions reading two worlds can disagree about a narrow state
 * and then the pair is unsatisfiable.
 *
 * 900 ticks rather than 1,800: this test asks about *per-observation* accounting, which every
 * wake exercises, so it does not need the long tail a reachability sweep needs to enter a narrow
 * state. Sampled every 25 ticks over 8 members.
 */
let sweptOnce: Sample | null = null;
function sweep(): Sample {
  if (sweptOnce !== null) return sweptOnce;
  setSpeed('instant');
  const seed = 'withheld-accountable';
  const rt = new Runtime({ seed });
  const cast = new HeuristicCast(rt, { size: 8 });
  cast.seat(seed);
  const fired = new Map<string, number>();
  const silent = new Map<string, number>();
  let observations = 0;
  let signAsCreatorFired = 0;
  let signAsCreatorSilent = 0;
  for (let i = 0; i < 900; i += 1) {
    const target = rt.engine.tick + 1;
    for (const a of cast.decide(target, seed)) rt.engine.submit(a);
    const report = rt.runTick();
    if (report.halted) throw new Error(`halted at ${String(report.tick)}`);
    if (i % 25 !== 0) continue;
    for (const member of cast.roster) {
      const payload = buildObservation({
        runtime: rt,
        principal: member.principal,
        serverNowMs: 0,
        fresh: true,
        wakesRemaining: 9,
        stale: false,
        corrections: [],
        correctionsDropped: 0,
        actionsRemaining: 4,
      }) as unknown as Payload;
      observations += 1;
      const offered = new Set(rows(payload['affordances']).map((a) => String(a['verb'])));
      const named = new Set(strings(obj(obj(payload['header'])['withheld'])['verbs']));
      for (const [verb, trigger] of Object.entries(CLOSED)) {
        if (!trigger(payload)) continue;
        fired.set(verb, (fired.get(verb) ?? 0) + 1);
        if (offered.has(verb) || named.has(verb)) continue;
        silent.set(verb, (silent.get(verb) ?? 0) + 1);
      }
      // The creator case on its own counter — see SIGN_AS_CREATOR.
      if (SIGN_AS_CREATOR(payload)) {
        signAsCreatorFired += 1;
        if (!offered.has('sign') && !named.has('sign')) signAsCreatorSilent += 1;
      }
    }
  }
  sweptOnce = {
    fired,
    silent,
    observations,
    live: [...rt.liveVerbs].sort(cmp),
    signAsCreatorFired,
    signAsCreatorSilent,
  };
  return sweptOnce;
}

describe('PROP-O1 — every unoffered verb is either inapplicable or NAMED, per observation', () => {
  it('★ THE INVARIANT: a CLOSED verb is never silent while its input is visible', () => {
    const { fired, silent, observations } = sweep();
    // Non-vacuity, and it is the whole safety of this test: every trigger must have FIRED, or
    // "never silent" is a claim about nothing. This is the failure mode that let INV-22 report
    // green over an empty journal for the project's whole life.
    expect(observations, 'the sweep must have solved real observations').toBeGreaterThan(100);
    for (const verb of Object.keys(CLOSED)) {
      expect(
        fired.get(verb) ?? 0,
        `${verb}'s trigger never fired in ${String(observations)} observations, so this test asserts ` +
          'NOTHING about it. Fix the trigger or the sweep — a guard whose subject cannot occur is ' +
          'indistinguishable from a missing one.',
      ).toBeGreaterThan(0);
    }
    const broken = Object.keys(CLOSED)
      .filter((verb) => (silent.get(verb) ?? 0) > 0)
      .sort(cmp);
    expect(
      broken,
      `these verbs were unoffered AND unnamed in header.withheld.verbs while the payload itself ` +
        `showed the input they consume: ${broken
          .map((v) => `${v} ${String(silent.get(v) ?? 0)}/${String(fired.get(v) ?? 0)}`)
          .join(', ')}. header.withheld promises "nothing you were eligible for has been dropped ` +
        'without this count" and that promise is false for each of them. Add a tagged row, or move ' +
        'the verb to OPEN with a reason and its measured rate.',
    ).toEqual([]);
  }, 180_000);

  it('★ `sign` AS THE CREATOR — the case a probe doubted and this guard could not see', () => {
    // The trigger used to require `my_role !== null`, which inside `ventures.mine[]` excludes
    // exactly the creator. A probe then claimed `sign` is never offered to a creator, and nothing
    // here could have contradicted it either way. Both halves are asserted: the case OCCURS in a
    // world nobody steers, and it is never silent when it does.
    const { signAsCreatorFired, signAsCreatorSilent, observations } = sweep();
    expect(
      signAsCreatorFired,
      `no creator ever held an unsigned FORMING venture in ${String(observations)} observations, so ` +
        'widening the trigger moved the source and not the coverage — which is the vacuity this ' +
        'change exists to remove, one level in',
    ).toBeGreaterThan(0);
    expect(
      signAsCreatorSilent,
      'a creator must never be left unable to close its own venture with nothing saying why: it ' +
        "wastes every hand its counterparties committed, not only the creator's own action",
    ).toBe(0);
  }, 180_000);

  it('★ `trade` SPECIFICALLY, because it is the one that was 86% silent', () => {
    // Named on its own rather than left inside the loop: this is the regression, and a failure
    // message that says "trade" is worth more than one that says "a CLOSED verb".
    const { fired, silent } = sweep();
    expect(fired.get('trade') ?? 0, 'the sweep must reach a principal standing in a market').toBeGreaterThan(
      50,
    );
    expect(
      silent.get('trade') ?? 0,
      'trade was silent in 497 of 576 observations before this change, every one of them with a ' +
        'reachable venue. It must be zero.',
    ).toBe(0);
  }, 180_000);

  it('every live verb is CLOSED, OPEN or UNTRIGGERED — the list cannot go stale by omission', () => {
    // The reconciliation. A verb added to `liveVerbs` with no entry anywhere lands here, which
    // is the check that would have caught `trade` on the day the market shipped.
    const { live } = sweep();
    const undeclared = live
      .filter((verb) => CLOSED[verb] === undefined && OPEN[verb] === undefined && UNTRIGGERED[verb] === undefined)
      .sort(cmp);
    expect(
      undeclared,
      `these live verbs have no accountability decision recorded: ${undeclared.join(', ')}. Give each ` +
        'one a CLOSED trigger, an OPEN entry with its measured rate, or an UNTRIGGERED reason. This is ' +
        'the check that was missing when `trade` shipped a mechanic with no withheld row at all.',
    ).toEqual([]);
  }, 180_000);

  it('and nothing is declared twice, nor declared for a verb that is not live', () => {
    const { live } = sweep();
    const liveSet = new Set(live);
    const all = [...Object.keys(CLOSED), ...Object.keys(OPEN), ...Object.keys(UNTRIGGERED)];
    const seen = new Set<string>();
    const twice = all.filter((verb) => (seen.has(verb) ? true : (seen.add(verb), false))).sort(cmp);
    expect(twice, 'a verb in two lists has two answers, which is the disagreement §3 forbids').toEqual([]);
    // The rot direction: an entry for a verb the engine no longer has is a rules surface
    // describing a world that does not exist.
    const dead = all.filter((verb) => !liveSet.has(verb)).sort(cmp);
    expect(
      dead,
      `these verbs are declared here but are not in header.live_verbs: ${dead.join(', ')}. Remove them.`,
    ).toEqual([]);
  }, 180_000);

  it('every OPEN and UNTRIGGERED entry carries a real reason that classifies itself', () => {
    for (const [verb, reason] of Object.entries(OPEN)) {
      expect(reason.length, `${verb}'s OPEN reason is too short to be one`).toBeGreaterThan(80);
      expect(
        reason,
        `${verb} must classify itself: TRIGGER TOO COARSE, NEEDS A DESIGN CALL, or OUT OF SCOPE HERE`,
      ).toMatch(/TRIGGER TOO COARSE|NEEDS A DESIGN CALL|OUT OF SCOPE HERE/);
      expect(reason, `${verb}'s OPEN entry must carry its MEASURED rate, or the gap has no size`).toMatch(
        /\d+\/\d+ \(\d+(\.\d+)?%\)/,
      );
    }
    for (const [verb, reason] of Object.entries(UNTRIGGERED)) {
      expect(reason.length, `${verb}'s UNTRIGGERED reason is too short to be one`).toBeGreaterThan(40);
      expect(
        reason,
        `${verb} must classify itself: RESPONSE-ONLY, ALREADY ACCOUNTED, ALWAYS OFFERED, or REACHABLE ELSEWHERE`,
      ).toMatch(/RESPONSE-ONLY|ALREADY ACCOUNTED|ALWAYS OFFERED|REACHABLE ELSEWHERE/);
    }
  });

  it('header.withheld.verbs is a SUBSET of live_verbs, sorted and deduped', () => {
    // ── AND WHY IT IS *NOT* DISJOINT FROM THE OFFERED SET, WHICH I ASSERTED FIRST AND WAS WRONG ──
    //
    // "a row is never billed for a verb that was offered" is the intuitive invariant and it is
    // FALSE, correctly: `commonsBoundLanes` counts the `move`s onto lanes leaving the Commons
    // while the `move`s between COMMONS systems are on the menu, and `alternateHands` counts the
    // extra hands for a slot whose fill IS offered. A row is about the omitted **acts**, not
    // about the verb wholesale, and both of those omissions are ones an agent needs. Recorded
    // here rather than dropped, because the wrong version of this assertion is the one a future
    // reader will reach for.
    //
    // What is left is still worth pinning: the tagging must not name a verb the engine does not
    // have, and the list must be byte-stable across two wakes (PROP-O6), which needs sorting and
    // deduping.
    setSpeed('instant');
    const seed = 'withheld-subset';
    const rt = new Runtime({ seed });
    const cast = new HeuristicCast(rt, { size: 6 });
    cast.seat(seed);
    let checked = 0;
    let sawSome = 0;
    /** Verbs that were offered AND carried a row. Legitimate; see the note above. */
    let bothWays = 0;
    for (let i = 0; i < 300; i += 1) {
      const target = rt.engine.tick + 1;
      for (const a of cast.decide(target, seed)) rt.engine.submit(a);
      const report = rt.runTick();
      if (report.halted) throw new Error(`halted at ${String(report.tick)}`);
      if (i % 20 !== 0) continue;
      for (const member of cast.roster) {
        const payload = buildObservation({
          runtime: rt,
          principal: member.principal,
          serverNowMs: 0,
          fresh: true,
          wakesRemaining: 9,
          stale: false,
          corrections: [],
          correctionsDropped: 0,
          actionsRemaining: 4,
        }) as unknown as Payload;
        const withheldVerbs = strings(obj(obj(payload['header'])['withheld'])['verbs']);
        const offered = new Set(rows(payload['affordances']).map((a) => String(a['verb'])));
        checked += 1;
        if (withheldVerbs.length > 0) sawSome += 1;
        for (const verb of withheldVerbs) {
          expect(rt.liveVerbs.has(verb as never), `withheld names ${verb}, which is not live`).toBe(true);
        }
        // The rows are about acts, so a verb may be both offered and (partly) withheld. Counted
        // rather than forbidden, so that if it ever stopped happening this test says so.
        for (const verb of withheldVerbs) if (offered.has(verb)) bothWays += 1;
        // Sorted and deduped, because an agent may compare two wakes byte for byte (PROP-O6).
        expect([...withheldVerbs].sort(cmp)).toEqual(withheldVerbs);
        expect(new Set(withheldVerbs).size).toBe(withheldVerbs.length);
      }
    }
    // Non-vacuity: the field must have been non-empty somewhere, or every loop above ran zero times.
    expect(checked).toBeGreaterThan(50);
    expect(sawSome, 'withheld.verbs was empty in every observation — this test asserts nothing').toBeGreaterThan(
      0,
    );
    expect(
      bothWays,
      'no verb was ever both offered and partly withheld, so the note above describes nothing and the ' +
        'stricter assertion it argues against would have been safe after all — re-read it before ' +
        'trusting either version',
    ).toBeGreaterThan(0);
  }, 180_000);
});

// ════════════════════════════════════════════════════════════════════════════
// ★ THE VERB WAS ACCOUNTED FOR AND THE CAPABILITY WAS NOT — per-TARGET accountability
// ════════════════════════════════════════════════════════════════════════════

/**
 * ★ **A LIVE CAPABILITY WAS DROPPED FROM THE LIST WITH NO COUNTED REASON, AND THE SWEEP ABOVE
 * COULD NOT SEE IT.**
 *
 * A blind probe ran a complete betrayal with two identities. At tick 424 its delegate held two
 * live grants — one an OFFICE in a syndicate, one over `p:probe-trust-01`, the principal that had
 * trusted it — and both `reads` blocks were serving that principal's stores and hands on every
 * tick. The affordance list offered dossiers on **the syndicate only**. `withheld` said
 * `count: 4, verbs: [build, move, trade]`, naming neither `message` nor the subject. The probe
 * hand-built the call; it was accepted; the leak landed.
 *
 * **Why the sweep is blind to this by construction.** Its unit is the bare verb string
 * (`offered.has(verb) || named.has(verb)`), and a dossier is not a verb — it is
 * `message {to, dossier}`. `message` *was* in `affordances[]`, targeting the syndicate, so the
 * verb was fully accounted for while two live capabilities on it were gone. Promoting `message`
 * from OPEN to CLOSED would not have caught it either. That is the file's own header warning
 * (global-vs-per-observation) reappearing one level down as **verb-vs-target**, and the fix is a
 * property whose unit is the `(verb, target)` pair.
 *
 * The cause was two things at once, both in `observe.ts`'s 5C-bis:
 *
 *   1. the cap was `MAX_GRANT_OFFERS` — **a cap on a different list** (how many principals to
 *      suggest you promote), reused for how many of your own live capabilities to admit to;
 *   2. the walk was grant-id hash order, so one grantor could consume every slot — and neither
 *      `break` incremented anything, so the drop was outside all sixteen terms of the sum.
 *
 * Both halves are asserted below, and mutation-verified: the cap is `MAX_DOSSIER_OFFERS`, the
 * walk is breadth-first by grantor, and the tail is counted with the subjects named.
 */
describe('every principal a delegate may cut a dossier on is offered or NAMED', () => {
  const CLEARED = (delegate: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
    delegate,
    template: 'steward', // create+elect, clearance STORES+HANDS — the widest shape there is
    max_direct_loss: 500,
    max_contingent_liability: 500,
    expires_tick: 400,
    ...over,
  });

  /** A world with `n` grantors, each having granted the one delegate a cleared office. */
  function cleared(seed: string, n: number): { rt: Runtime; delegate: PrincipalId; grantors: PrincipalId[] } {
    setSpeed('instant');
    const rt = new Runtime({ seed });
    const stage = commonsSystems(rt.world.map)[0];
    if (stage === undefined) throw new Error('the launch map has no Commons system');
    const delegate = 'p:deleg' as PrincipalId;
    rt.seat(delegate, 'deleg', stage);
    rt.standing.open(delegate);
    const grantors: PrincipalId[] = [];
    for (let i = 0; i < n; i += 1) {
      const who = `p:grantor-${String(i)}` as PrincipalId;
      rt.seat(who, `grantor-${String(i)}`, stage);
      rt.standing.open(who);
      grantors.push(who);
      const outcome = rt.engine.submit({
        principal: who,
        verb: 'grant',
        params: CLEARED(delegate),
        clientSequence: 0,
        arrivalMs: 0,
        decisionSource: 'LIVE',
      });
      if (!outcome.ok) throw new Error(`grant refused at the door: ${outcome.invariant} ${outcome.hint}`);
      const report = rt.runTick();
      if (report.halted) throw new Error(`halted: ${report.violations.map((v) => v.id).join(',')}`);
      // NON-VACUITY, per grantor: a `reads` block that is null means the clearance never bound,
      // and every assertion below would be about an absence with no capability behind it.
      const grant = rt.grants.forGrantor(who)[0];
      if (grant === undefined || grant.clearance.length === 0) {
        throw new Error(`grantor ${who} issued no cleared grant`);
      }
    }
    return { rt, delegate, grantors };
  }

  function seen(rt: Runtime, delegate: PrincipalId): { targets: Set<string>; payload: Payload } {
    const payload = buildObservation({
      runtime: rt,
      principal: delegate,
      serverNowMs: 0,
      fresh: true,
      wakesRemaining: 9,
      stale: false,
      corrections: [],
      correctionsDropped: 0,
      actionsRemaining: 4,
    }) as unknown as Payload;
    const targets = new Set(
      rows(payload['affordances'])
        .filter((a) => a['verb'] === 'message' && obj(a['params'])['dossier'] !== undefined)
        .map((a) => String(obj(a['params'])['dossier'])),
    );
    return { targets, payload };
  }

  it('★ THE DEFECT: two cleared grantors, and BOTH are offered — not just whichever id sorts first', () => {
    const { rt, delegate, grantors } = cleared('two-grantors', 2);
    const { targets, payload } = seen(rt, delegate);

    // Non-vacuity first: the delegate really is reading both principals right now. If `reads` were
    // null this test would be asserting that a menu omits nothing from an empty capability set.
    const held = rows(obj(payload['grants'])['held']);
    expect(held.length, 'the delegate must hold both grants').toBe(2);
    for (const row of held) {
      expect(row['live']).toBe(true);
      const reads = obj(row['reads']);
      expect(
        Object.keys(reads).sort(cmp),
        'both clearances must be actively serving figures, or the omission has nothing behind it',
      ).toEqual([...COMPARTMENTS].sort(cmp));
    }

    // THE ASSERTION. Before the fix this was `{syn-or-first-grantor}/STORES` and `.../HANDS` only.
    const subjects = new Set([...targets].map((t) => String(t.split('/')[0])));
    expect(
      [...subjects].sort(cmp),
      'a delegate cleared over two principals was offered dossiers on one of them; the other was ' +
        'dropped by a cap sized for an unrelated list, in grant-id hash order, and counted nowhere',
    ).toEqual([...grantors].map(String).sort(cmp));
    // ── AND NO **DOSSIER** ROW WAS WITHHELD, because the cap is wide enough for this shape ──
    //
    // Narrowed at `RULES_VERSION` 31 from *"`message` is not in `withheld.verbs`"*, which stopped
    // being the right question the moment `message` grew a third act. The delegate here stands in no
    // campaign and has honoured no elective promise, so its PARLEY allowance is legitimately zero and
    // `header.parley.rule` legitimately accounts for it — under the old spelling this test would have
    // failed on a row that is correct, and the tempting repair (drop the parley row) would have
    // reopened `trade`'s defect to keep an unrelated assertion green.
    //
    // So the claim is checked where it lives: no row about a DOSSIER. A verb tag cannot carry it,
    // because one verb now has three acts and `withheld` is tagged per verb.
    expect(
      String(obj(obj(payload['header'])['withheld'])['reason']),
      'a delegate cleared over two principals was offered dossiers on both, so no DOSSIER row may be ' +
        'counted as dropped. Asserted on the SENTENCE rather than the verb tag, because `withheld` is ' +
        'tagged per verb and one verb now has three acts.',
    ).not.toMatch(/DOSSIER row\(s\)/);
  });

  it('past the cap, every grantor still appears once and the tail is COUNTED with its subjects', () => {
    // Four grantors x two compartments = 8 candidate rows against a cap of 6. Breadth-first is
    // what makes the guarantee statable: the drop must fall on a SECOND row for some grantor,
    // never on a grantor's only row, because "the menu never mentions this subject" and "the menu
    // shows one of this subject's two compartments" are different lies.
    const { rt, delegate, grantors } = cleared('past-the-cap', 4);
    const { targets, payload } = seen(rt, delegate);
    expect(targets.size, 'the list is capped').toBe(MAX_DOSSIER_OFFERS);

    const subjects = new Set([...targets].map((t) => String(t.split('/')[0])));
    expect(
      [...subjects].sort(cmp),
      'breadth-first: every grantor a delegate can read appears at least once',
    ).toEqual([...grantors].map(String).sort(cmp));

    const withheld = obj(obj(payload['header'])['withheld']);
    expect(
      strings(withheld['verbs']),
      'the drop must be attributed to the verb it is about — `message`, since a dossier is not a verb',
    ).toContain('message');
    expect(Number(withheld['count']), 'and included in the count').toBeGreaterThanOrEqual(
      8 - MAX_DOSSIER_OFFERS,
    );
    // The ground must name the subjects, not just the number: a delegate reading it can then
    // construct the call, which is what §6's promise means and what an uncounted `break` denied.
    const reason = String(withheld['reason']);
    const omitted = [...grantors]
      .flatMap((g) => [...COMPARTMENTS].map((room) => `${String(g)}/${room}`))
      .filter((t) => !targets.has(t));
    expect(omitted.length).toBe(8 - MAX_DOSSIER_OFFERS);
    for (const t of omitted) {
      expect(reason, `the withheld ground must name ${t}, or the count is unactionable`).toContain(t);
    }
  });

  it('the door is WIDER than the menu, and the menu says so', () => {
    // The asymmetry that made the probe's leak possible: `GrantBook.clearanceGrantFor` is a
    // per-subject predicate with no cap, so a hand-built call against an omitted subject is
    // accepted. That is correct — a cap on a MENU must never become a cap on the GAME — but it
    // is only honest if the menu admits it, which is the sentence this pins.
    const { rt, delegate, grantors } = cleared('door-wider', 4);
    const { targets, payload } = seen(rt, delegate);
    const omitted = [...grantors]
      .flatMap((g) => [...COMPARTMENTS].map((room) => `${String(g)}/${room}`))
      .find((t) => !targets.has(t));
    expect(omitted, 'this test needs a dropped row to be about anything').toBeDefined();
    if (omitted === undefined) return;

    const [subject, room] = omitted.split('/');
    expect(
      rt.grants.clearanceGrantFor(subject as PrincipalId, delegate, String(room), rt.engine.tick),
      'the door still admits the row the menu dropped',
    ).not.toBeNull();
    expect(
      String(obj(obj(payload['header'])['withheld'])['reason']),
      'and the menu must not let an agent read the cap as a prohibition',
    ).toContain('Withheld from the MENU is not withheld from the GAME');
  });
});
