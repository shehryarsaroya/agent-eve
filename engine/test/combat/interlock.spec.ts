/**
 * ★ **THE FIVE RELATIONSHIPS, EACH AS A REVERSAL.**
 *
 * `PASS-SHIPS-COMBAT-extended` §11 states the success test for the combat kernel, and it is not a
 * feature list:
 *
 * > *"Two equally priced fleets with different fits/composition should reverse the outcome through an
 * > understandable counter; a cheap tackler or EWAR ship should decide an expensive loss; a
 * > disengagement should save some assets and abandon others; replay should reproduce and explain it."*
 *
 * So every test in this file is a **pair** — the same fleet, one module different, opposite outcome —
 * because *"the tackle code runs"* is a claim about the engine and *"the web decided the fight"* is a
 * claim about the game. Only the second one is worth anything.
 *
 * Each test names the MUTATION that should turn it red. That is the standing discipline here: a guard
 * nobody has broken is a guard nobody has tested.
 */

import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import type { HandId, PrincipalId, SystemId } from '../../src/core/types.js';
import {
  Book,
  ENGAGEMENT_PHASE_TICKS,
  GAP_AT_CONTACT,
  PIN_THRESHOLD,
  SLICES_PER_TICK,
  applyVolley,
  contestGap,
  engagementIdFor,
  fieldControlOf,
  rangeBetween,
  runTick,
  simulateFit,
  stackSum,
  wantsOut,
  type EngagementRecord,
  type Formation,
  type FitProfile,
  type HullId,
  type TargetPredicate,
} from '../../src/combat/index.js';
import type { RaidId, RaidSide } from '../../src/predation/index.js';

const STAGE = 'sys-x' as SystemId;

/** A battle with no formations, in a named state. Pure: no runtime, no ledger, no clock. */
function battle(state: EngagementRecord['state'] = 'CONTEST'): EngagementRecord {
  const raid = 'raid:100:0' as RaidId;
  return {
    id: engagementIdFor(raid),
    raid,
    stage: STAGE,
    target: 'p:def' as PrincipalId,
    initiator: 'p:atk' as PrincipalId,
    worldForce: 0,
    openedAtTick: 100,
    state,
    phaseEndsTick: 200,
    gap: GAP_AT_CONTACT,
    seedCommit: 'deadbeef',
    formations: [],
    wrecks: [],
    trace: [],
    fieldControl: null,
    resolvedAtTick: null,
  };
}

let counter = 0;

/** Add a formation. `hulls` identical copies of one fit, so the cohort arithmetic is exercised. */
function add(
  record: EngagementRecord,
  args: {
    readonly side: RaidSide;
    readonly hull: string;
    readonly modules: readonly string[];
    readonly hulls?: number;
    readonly echelon?: Formation['echelon'];
    readonly posture?: Formation['posture'];
    readonly primary?: readonly TargetPredicate[];
    readonly withdrawBelowBps?: number;
  },
): { readonly formation: Formation; readonly profile: FitProfile } {
  const simulated = simulateFit(args.hull, args.modules);
  if (!simulated.ok) throw new Error(`${args.hull} ${args.modules.join('+')}: ${simulated.hint}`);
  const profile = simulated.value;
  const hulls = args.hulls ?? 1;
  counter += 1;
  const principal = `p:${args.side === 'RAIDER' ? 'atk' : 'def'}${String(counter)}` as PrincipalId;
  const formation: Formation = {
    id: `${record.id}/${principal}/${profile.fitHash}/${args.echelon ?? 'MAIN'}/${args.posture ?? 'HOLD'}` as Formation['id'],
    principal,
    side: args.side,
    fit: profile.fitHash,
    hull: args.hull,
    hands: Array.from({ length: hulls }, (_, i) => `${principal}:h${String(i)}` as HandId),
    hulls: Array.from({ length: hulls }, (_, i) => `${principal}:hull${String(i)}` as HullId),
    echelon: args.echelon ?? 'MAIN',
    posture: args.posture ?? 'HOLD',
    primary: [...(args.primary ?? ['WEAKEST'])],
    withdrawWhen: { ehpBelowBps: args.withdrawBelowBps ?? 0, hullsLost: 0, now: false },
    ehp: profile.ehp * hulls,
    ehpFull: profile.ehp * hulls,
    cap: profile.capacitor * hulls,
    capFull: profile.capacitor * hulls,
    tackledBy: 0,
    scrammed: false,
    webbedBps: 0,
    paintedBps: 0,
    capOut: false,
    withdrawn: false,
    hullsLost: 0,
    committedAtTick: 100,
  };
  record.formations.push(formation);
  return { formation, profile };
}

/** A lookup over the fits actually in this battle. The resolver's own contract. */
function lookup(pairs: readonly { readonly profile: FitProfile }[]): (fit: string) => FitProfile | undefined {
  const memo = new Map(pairs.map((p) => [p.profile.fitHash as string, p.profile]));
  return (fit) => memo.get(fit);
}

/** Run a battle to a conclusion, or `ticks` ticks. Returns total wrecks per side. */
function fight(
  record: EngagementRecord,
  profileOf: (fit: string) => FitProfile | undefined,
  ticks: number = ENGAGEMENT_PHASE_TICKS.CONTEST,
  seed = 'interlock',
): { readonly raider: number; readonly defender: number; readonly control: string } {
  const rng = Rng.fromSeed(seed);
  let raider = 0;
  let defender = 0;
  for (let t = 0; t < ticks; t += 1) {
    const out = runTick({ record, profileOf, rng, tick: 100 + t, fireEnabled: true, pursuitOnly: false });
    for (const loss of out.losses) {
      const owner = record.formations.find((f) => f.id === loss.formation);
      if (owner?.side === 'RAIDER') raider += 1;
      else defender += 1;
    }
    const standing = (side: RaidSide): number =>
      record.formations.filter((f) => f.side === side && !f.withdrawn && f.hands.length > 0).length;
    if (standing('RAIDER') === 0 || standing('DEFENDER') === 0) break;
  }
  return { raider, defender, control: fieldControlOf(record) };
}

// ── #2 SIZE, SIGNATURE, MOTION, RANGE, APPLICATION ──────────────────────────

describe('★ relationship #2 — a frigate matters beside a battleship, and the tracking term is why', () => {
  it('★ a CITADEL cannot apply to an un-webbed PIKE, and one WEB more than doubles it', () => {
    // MUTATION: make `motionBps` unconditionally 10000 in `applyVolley`. Both halves become identical
    // and the reason large guns need a screen disappears — a battleship would simply delete frigates,
    // which is §3 MUST-5's named failure ("unsupported battleships are tackled, neuted, bombed, or
    // orbited by cheap ships"). RED on the ratio.
    //
    // Measured on ONE VOLLEY rather than on wrecks, deliberately: a whole-hull count is a coarse
    // instrument and it hid this relationship the first time this test was written — both fleets
    // destroyed exactly one PIKE over four ticks and the test read as green-adjacent while proving
    // nothing. The applied figure is the quantity the design is actually about.
    const record = battle();
    const gunner = add(record, {
      side: 'RAIDER',
      hull: 'CITADEL',
      modules: ['LARGE_GUN', 'LARGE_GUN', 'LARGE_GUN', 'AFTERBURNER'],
    });
    const frigate = add(record, { side: 'DEFENDER', hull: 'PIKE', modules: ['SMALL_GUN', 'AFTERBURNER'], hulls: 3 });
    record.gap = 1;

    const bare = applyVolley({
      shooter: gunner.formation,
      shooterProfile: gunner.profile,
      target: frigate.formation,
      targetProfile: frigate.profile,
      gap: record.gap,
      commanded: false,
      dampedBy: 0,
      rng: Rng.fromSeed('bare'),
    });

    // One WEB wing, on a hull that costs a twentieth of the battleship it is enabling.
    frigate.formation.webbedBps = 6_000;
    const webbed = applyVolley({
      shooter: gunner.formation,
      shooterProfile: gunner.profile,
      target: frigate.formation,
      targetProfile: frigate.profile,
      gap: record.gap,
      commanded: false,
      dampedBy: 0,
      rng: Rng.fromSeed('bare'),
    });

    expect(bare.paper, 'the paper number is the same in both halves — only APPLICATION changed').toBe(webbed.paper);
    expect(
      bare.damage,
      'un-webbed, a battleship applies a small fraction of its paper damage to fast frigates',
    ).toBeLessThan(Math.trunc(bare.paper / 3));
    expect(
      webbed.damage,
      'webbed, the same volley lands far more. A 420-cost frigate changes what a 6,850-cost battleship ' +
        'achieves, which is §12 relationship #2 in one number.',
    ).toBeGreaterThan(bare.damage * 2);
    expect(bare.why, 'and the reason is stated, not inferred').toMatch(/tracking/i);
  });

  it('the range row is what makes EXTREME a place to stand: a small gun does nothing there', () => {
    // MUTATION: replace `rangeFactorBps[dampedCell] ?? 0` with `?? 10_000`. A weapon out of range
    // becomes a weapon in range and the whole kiting layer evaporates. RED here.
    const close = battle();
    const a = add(close, { side: 'RAIDER', hull: 'LANCE', modules: ['SMALL_GUN', 'SMALL_GUN', 'AFTERBURNER'] });
    const b = add(close, { side: 'DEFENDER', hull: 'WARDEN', modules: ['SHIELD_EXTENDER', 'AFTERBURNER'] });
    close.gap = 0;
    fight(close, lookup([a, b]), 2);

    const far = battle();
    const c = add(far, { side: 'RAIDER', hull: 'LANCE', modules: ['SMALL_GUN', 'SMALL_GUN', 'AFTERBURNER'] });
    const d = add(far, { side: 'DEFENDER', hull: 'WARDEN', modules: ['SHIELD_EXTENDER', 'AFTERBURNER'] });
    far.gap = 4;
    fight(far, lookup([c, d]), 2);

    expect(
      b.formation.ehp,
      'small guns at CONTACT must have done damage, or the pair proves nothing',
    ).toBeLessThan(b.formation.ehpFull);
    expect(
      d.formation.ehp,
      'and small guns at EXTREME must have done NONE. Their published range row is 0 there, so a target ' +
        'that held the gap open took nothing — which is the entire economics of kiting.',
    ).toBe(d.formation.ehpFull);
  });

  it('the range race is decided by mobility, and a WEB takes mobility away', () => {
    // MUTATION: drop the `effectiveMobility` web term (return `profile.mobility`). A brawler can then
    // never be out-run and never out-run anything: the gap becomes a function of posture alone, which
    // is a coin-flip dressed as a decision. RED on the second expectation.
    const open = battle();
    const brawler = add(open, { side: 'RAIDER', hull: 'WARDEN', modules: ['MWD'], posture: 'CLOSE' });
    const kiter = add(open, { side: 'DEFENDER', hull: 'PIKE', modules: ['AFTERBURNER'], posture: 'KITE' });
    const lookupA = lookup([brawler, kiter]);
    expect(
      contestGap(open, open.formations, lookupA),
      'the PIKE is faster than an MWD cruiser, so it holds the gap OPEN',
    ).toBeGreaterThan(open.gap);

    // Now web the kiter. Its 9 mobility becomes 3, below the MWD cruiser's 10.
    kiter.formation.webbedBps = 6_000;
    expect(
      contestGap(open, open.formations, lookupA),
      'webbed, the same PIKE loses the range race and the brawler drags the gap shut. One mid slot ' +
        'reverses who chooses the range, which is what makes tackle a purchase rather than a lottery.',
    ).toBeLessThan(open.gap);
  });
});

// ── #3 TACKLE AND PARTIAL WITHDRAWAL ────────────────────────────────────────

describe('★ relationship #3 — a cheap tackler decides which expensive asset leaves', () => {
  it('a formation over its withdrawal threshold leaves — unless something holds it', () => {
    // MUTATION: delete the `formation.tackledBy >= PIN_THRESHOLD` branch in `runTick`. Everything
    // always escapes, nothing is ever destroyed, and §12 relationship #3's warning comes true
    // verbatim: "without this, agents rationally disengage and the insurance/claims game starves."
    // RED on the second expectation.
    const free = battle();
    const runner = add(free, { side: 'DEFENDER', hull: 'CITADEL', modules: ['LARGE_GUN'], withdrawBelowBps: 10_000 });
    const shooter = add(free, { side: 'RAIDER', hull: 'LANCE', modules: ['SMALL_GUN'] });
    runner.formation.ehp = Math.trunc(runner.formation.ehpFull / 2);
    expect(wantsOut(runner.formation), 'its stop condition has fired').toBe(true);
    runTick({
      record: free,
      profileOf: lookup([runner, shooter]),
      rng: Rng.fromSeed('free'),
      tick: 101,
      fireEnabled: true,
      pursuitOnly: false,
    });
    expect(
      runner.formation.withdrawn,
      'nothing held it, so a battleship worth 6,850 walked away from a fight it was losing',
    ).toBe(true);

    const held = battle();
    const runner2 = add(held, { side: 'DEFENDER', hull: 'CITADEL', modules: ['LARGE_GUN'], withdrawBelowBps: 10_000 });
    // One PIKE with one POINT. 420 of goods against a 6,850 battleship.
    const tackler = add(held, { side: 'RAIDER', hull: 'PIKE', modules: ['POINT', 'AFTERBURNER'], echelon: 'SCREEN' });
    runner2.formation.ehp = Math.trunc(runner2.formation.ehpFull / 2);
    runTick({
      record: held,
      profileOf: lookup([runner2, tackler]),
      rng: Rng.fromSeed('held'),
      tick: 101,
      fireEnabled: true,
      pursuitOnly: false,
    });
    expect(
      runner2.formation.tackledBy,
      'the POINT must have landed. A PIKE fitted for tackle is the cheapest object in this game that ' +
        'can decide the fate of the most expensive one.',
    ).toBeGreaterThanOrEqual(PIN_THRESHOLD);
    expect(
      runner2.formation.withdrawn,
      'and so the battleship CANNOT leave, at a hundredth of its cost. This asymmetry is the whole ' +
        'reason permanent public loss ever happens.',
    ).toBe(false);
  });

  it('withdrawal is per formation, so a fleet saves some and abandons others', () => {
    // §7 MUST-5: "a disengagement should save some assets and abandon others". A whole-fleet retreat
    // flag would make this test meaningless, which is exactly why the threshold is on the formation.
    const record = battle();
    const pinned = add(record, { side: 'DEFENDER', hull: 'WARDEN', modules: ['MISSILE'], withdrawBelowBps: 10_000 });
    const loose = add(record, {
      side: 'DEFENDER',
      hull: 'WARDEN',
      modules: ['MISSILE', 'MISSILE'],
      withdrawBelowBps: 10_000,
      echelon: 'SUPPORT',
    });
    // One SCRAM, reaching CLOSE and no further. SUPPORT is two cells back and out of its reach.
    const tackler = add(record, { side: 'RAIDER', hull: 'PIKE', modules: ['SCRAM'], echelon: 'SCREEN' });
    record.gap = 0;
    // Both are hurt, so both stop conditions have fired. A threshold of 10,000 bps means "leave the
    // moment you are not at full", and at exactly full the fraction is 10,000 — not below it — so an
    // undamaged formation stays. That boundary is deliberate: a threshold that fired at full health
    // would make every fleet leave the tick it arrived.
    pinned.formation.ehp = Math.trunc(pinned.formation.ehpFull / 2);
    loose.formation.ehp = Math.trunc(loose.formation.ehpFull / 2);
    runTick({
      record,
      profileOf: lookup([pinned, loose, tackler]),
      rng: Rng.fromSeed('partial'),
      tick: 101,
      fireEnabled: true,
      pursuitOnly: false,
    });
    expect(
      [pinned.formation.withdrawn, loose.formation.withdrawn],
      'exactly one of the two must have escaped. A SCRAM reaches CLOSE and no further, so the support ' +
        'wing standing two cells back is free and the main line is not — which is what an echelon IS.',
    ).toEqual([false, true]);
  });
});

// ── #4 COUNTERABLE FORCE MULTIPLIERS ────────────────────────────────────────

describe('★ relationship #4 — every multiplier is attackable, and has two counters', () => {
  it('REPAIR keeps a line alive, and DRAIN takes the repair away', () => {
    // MUTATION: delete the `if (healer.capOut)` branch in the SHIELD slice. Capacitor warfare stops
    // touching logistics and §5 MUST-9's whole point — "neutralizers" — becomes a stat with no
    // consequence. RED on the third expectation.
    const supported = battle();
    const line = add(supported, { side: 'DEFENDER', hull: 'WARDEN', modules: ['SHIELD_EXTENDER'], hulls: 2 });
    const logi = add(supported, {
      side: 'DEFENDER',
      hull: 'WARDEN',
      modules: ['REMOTE_REPAIR', 'REMOTE_REPAIR', 'CAP_BATTERY'],
      echelon: 'SUPPORT',
    });
    const guns = add(supported, {
      side: 'RAIDER',
      hull: 'LANCE',
      modules: ['SMALL_GUN', 'SMALL_GUN', 'SMALL_GUN', 'AFTERBURNER'],
      hulls: 2,
    });
    supported.gap = 0;
    fight(supported, lookup([line, logi, guns]), 6);
    const withRepair = line.formation.ehp;

    const alone = battle();
    const line2 = add(alone, { side: 'DEFENDER', hull: 'WARDEN', modules: ['SHIELD_EXTENDER'], hulls: 2 });
    const guns2 = add(alone, {
      side: 'RAIDER',
      hull: 'LANCE',
      modules: ['SMALL_GUN', 'SMALL_GUN', 'SMALL_GUN', 'AFTERBURNER'],
      hulls: 2,
    });
    alone.gap = 0;
    fight(alone, lookup([line2, guns2]), 6);

    expect(
      withRepair,
      'a repair wing must keep the line healthier than the same line alone, or logistics is decoration',
    ).toBeGreaterThan(line2.formation.ehp);

    // And the counter: empty the logi's capacitor.
    logi.formation.cap = 0;
    logi.formation.capOut = true;
    const before = line.formation.ehp;
    runTick({
      record: supported,
      profileOf: lookup([line, logi, guns]),
      rng: Rng.fromSeed('drained'),
      tick: 120,
      fireEnabled: false,
      pursuitOnly: false,
    });
    expect(
      line.formation.ehp,
      'with the repair wing dry, no repair lands. Killing the capacitor is killing the logistics, and ' +
        'that is one of the two counters §12 relationship #4 requires every multiplier to have.',
    ).toBe(before);
  });

  it('the trace explains WHY, not merely what — §7 SHOULD-2 as a field', () => {
    // A causal record is what lets an insurer audit a loss and a narrator ground a sentence (A12: the
    // sandbox authors the stories, the narrator never invents one). A battle that logged only damage
    // numbers would leave "the line did not lack DPS; only 28% applied" unwritable.
    const record = battle();
    const gunner = add(record, { side: 'RAIDER', hull: 'CITADEL', modules: ['LARGE_GUN', 'LARGE_GUN'] });
    const frigate = add(record, { side: 'DEFENDER', hull: 'PIKE', modules: ['AFTERBURNER'], hulls: 4 });
    record.gap = 2;
    const out = runTick({
      record,
      profileOf: lookup([gunner, frigate]),
      rng: Rng.fromSeed('trace'),
      tick: 101,
      fireEnabled: true,
      pursuitOnly: false,
    });
    const volley = out.trace.find((t) => t.kind === 'VOLLEY' || t.kind === 'MISSED');
    expect(volley, 'a volley must be traced').toBeDefined();
    expect(
      volley?.note ?? '',
      'and the note must decompose it. §4 MUST-3: "Paper 18k / applied 5.2k decomposes into range, ' +
        'motion, signature, EWAR, and resists. Viewers can see which intervention fixed application."',
    ).toMatch(/paper|tracking|signature|%/i);
    for (const line of out.trace) {
      expect(line.note.length, 'every trace note is a ticker line for free, so 140 chars is the cap').toBeLessThanOrEqual(140);
    }
  });
});

// ── #1 THE FITTING PUZZLE, AND ITS PUBLISHED CURVE ──────────────────────────

describe('★ relationship #1 — the stacking curve, published and diminishing', () => {
  it('the fourth copy of a modifier adds almost nothing, and the sim says so before it is bought', () => {
    // MUTATION: make `stackSum` a plain sum. One-stat monocultures become optimal, broad fits become
    // strictly worse, and §1 MUST-7's whole reason ("stacking penalties prevent one-stat
    // monocultures and make broad, mixed fitting competitive") is deleted. RED here.
    const one = stackSum([1_200]);
    const four = stackSum([1_200, 1_200, 1_200, 1_200]);
    expect(one, 'the first module contributes in full').toBe(1_200);
    expect(
      four,
      'four contribute far less than four times one — and the exact figure is published, so an agent ' +
        'never has to memorise a coefficient (§13: "opaque formulas and stacking-penalty memorization" ' +
        'is on the list of things actively bad for an agent game)',
    ).toBeLessThan(one * 3);

    const simulated = simulateFit('CITADEL', [
      'LARGE_GUN',
      'DAMAGE_MOD',
      'DAMAGE_MOD',
      'DAMAGE_MOD',
      'DAMAGE_MOD',
    ]);
    expect(simulated.ok).toBe(true);
    if (!simulated.ok) return;
    const stack = simulated.value.stacks.find((s) => s.attribute === 'alpha');
    expect(stack, 'the report must exist').toBeDefined();
    expect(
      stack?.effectiveBps ?? 0,
      'effective must be below nominal, which is the whole content of the report',
    ).toBeLessThan(stack?.nominalBps ?? 0);
    expect(
      stack?.marginalIfAddedBps ?? 0,
      'and `marginal_if_added` must be the small number, because it is the one that changes a decision',
    ).toBeLessThan(600);
  });

  it('a fit that cannot pay for itself says so, and the capacitor is the runtime constraint', () => {
    // §1 MUST-3: "CPU/powergrid decide whether a fit can be ASSEMBLED; capacitor decides whether it
    // can PERFORM its role under stress. A ship can be almost undamaged but operationally dead."
    const greedy = simulateFit('WARDEN', ['REMOTE_REPAIR', 'REMOTE_REPAIR', 'REMOTE_REPAIR', 'SHIELD_BOOSTER', 'MWD']);
    expect(greedy.ok, `a legal-but-unstable fit must SIMULATE, not be refused: ${greedy.ok ? '' : greedy.hint}`).toBe(true);
    if (!greedy.ok) return;
    expect(
      greedy.value.capStable,
      'three remote repairers, a booster and an MWD cannot be sustained. The fit is LEGAL — refusing it ' +
        'would make "bring only sustainable fits" a rule rather than a decision.',
    ).toBe(false);
    expect(
      greedy.value.enduranceSlices,
      'and the observation says exactly how many slices it lasts, because A2 forbids an estimate',
    ).not.toBeNull();
  });
});

// ── The topology, as arithmetic ─────────────────────────────────────────────

describe('the topology is arithmetic an agent can reproduce', () => {
  it('range is the gap plus both echelons, clamped to five cells', () => {
    expect(rangeBetween(0, 'MAIN', 'MAIN'), 'two main lines at gap 0 are at CONTACT').toBe(0);
    expect(rangeBetween(0, 'SCREEN', 'SCREEN'), 'two screens are closer still, and clamp at CONTACT').toBe(0);
    expect(
      rangeBetween(0, 'SUPPORT', 'SUPPORT'),
      'two support wings at gap 0 are two cells apart — which is why a bomber has to go through a screen',
    ).toBe(2);
    expect(rangeBetween(4, 'SUPPORT', 'SUPPORT'), 'and it clamps at EXTREME rather than running off the table').toBe(4);
  });

  it('a RESERVE formation is not on the board at all', () => {
    // MUTATION: delete the `echelon === RESERVE_ECHELON` skips in `runTick`. A reserve becomes a free
    // fifth wing that shoots without being shot, which is the opposite of what holding something back
    // means and would make RESERVE strictly dominant.
    const record = battle();
    const held = add(record, { side: 'RAIDER', hull: 'CITADEL', modules: ['LARGE_GUN', 'LARGE_GUN'], echelon: 'RESERVE' });
    const target = add(record, { side: 'DEFENDER', hull: 'WARDEN', modules: ['SHIELD_EXTENDER'] });
    record.gap = 2;
    runTick({
      record,
      profileOf: lookup([held, target]),
      rng: Rng.fromSeed('reserve'),
      tick: 101,
      fireEnabled: true,
      pursuitOnly: false,
    });
    expect(
      target.formation.ehp,
      'a reserve battleship must not have fired. Holding something back is a real cost, or it is not a ' +
        'decision.',
    ).toBe(target.formation.ehpFull);
  });

  it('field control is CONTESTED when both sides are standing, which is a real outcome', () => {
    // §7 MUST-8: "Observation separates objective_success, field_control and asset_exchange; a side
    // can win one and lose another." A binary winner would make a battle both sides walked away from
    // inexpressible, and that is the most common kind.
    const record = battle();
    add(record, { side: 'RAIDER', hull: 'PIKE', modules: ['SMALL_GUN'] });
    add(record, { side: 'DEFENDER', hull: 'PIKE', modules: ['SMALL_GUN'] });
    expect(fieldControlOf(record)).toBe('CONTESTED');
    const first = record.formations[0];
    if (first === undefined) throw new Error('no formation');
    first.hands = [];
    expect(fieldControlOf(record), 'and it names the survivor when only one is standing').toBe('DEFENDER');
  });

  it('the same battle from the same seed produces the same result, twice', () => {
    // A11 and §2 MUST-5: "Each operation seed is committed by hash at declaration and revealed in
    // Aftermath... a replay can reproduce every result." Without this an insurer cannot audit a loss
    // and a losing agent's "the resolver was tuned against me" is unanswerable.
    const run = (): number => {
      const record = battle();
      const a = add(record, { side: 'RAIDER', hull: 'LANCE', modules: ['SMALL_GUN', 'SMALL_GUN'], hulls: 2 });
      const b = add(record, { side: 'DEFENDER', hull: 'LANCE', modules: ['SMALL_GUN', 'SMALL_GUN'], hulls: 2 });
      record.gap = 0;
      fight(record, lookup([a, b]), 8, 'determinism');
      return a.formation.ehp * 1_000_003 + b.formation.ehp;
    };
    expect(run(), 'identical inputs, identical outcome').toBe(run());
  });

  it('a battle runs exactly SLICES_PER_TICK slices, and the count is published', () => {
    // The number an agent reasons its capacitor against ("40 slices means I am dry five ticks in").
    // If the code ran a different count than the constant an agent was told, every endurance figure
    // in the observation would be a lie — and it would be a lie nobody could see.
    const record = battle();
    const a = add(record, { side: 'RAIDER', hull: 'WARDEN', modules: ['MISSILE', 'SHIELD_BOOSTER', 'MWD'] });
    const b = add(record, { side: 'DEFENDER', hull: 'WARDEN', modules: ['SHIELD_EXTENDER'] });
    const profile = a.profile;
    const capBefore = a.formation.cap;
    runTick({
      record,
      profileOf: lookup([a, b]),
      rng: Rng.fromSeed('slices'),
      tick: 101,
      fireEnabled: false,
      pursuitOnly: false,
    });
    // Regen is clipped at capacity BEFORE the load is paid, which is the shape EVE has and the one
    // that matters: a stable fit sitting at full spends its regen on nothing, so it settles exactly
    // one slice's load below full and stays there for every remaining slice. That is why a "stable"
    // capacitor is not the same as a full one, and why {@link SLICES_PER_TICK} being the published
    // count is load-bearing — an agent reasons its endurance against it.
    expect(profile.capStable, 'this fit is stable, so it settles rather than draining').toBe(true);
    expect(capBefore, 'and it started full').toBe(a.formation.capFull);
    expect(
      a.formation.cap,
      `after ${String(SLICES_PER_TICK)} slices a stable fit that started full sits exactly one slice's ` +
        'load below capacity — regen above capacity is spent on nothing',
    ).toBe(a.formation.capFull - profile.capLoadPerSlice);
  });
});

// ── The book's own guards ───────────────────────────────────────────────────

describe('the engagement book refuses what would corrupt the record', () => {
  it('coalesces identical commits into one cohort rather than minting a formation per hull', () => {
    // §2 MUST-2: "formations with identical fit/state/order automatically coalesce, preventing 'one
    // ship per formation' action spam." Without it an agent fragments its own fleet by shuffling a
    // list and every per-side cap becomes meaningless.
    const book = new Book();
    const record = battle('MUSTER');
    book.open(record);
    const simulated = simulateFit('PIKE', ['SMALL_GUN', 'AFTERBURNER']);
    expect(simulated.ok).toBe(true);
    if (!simulated.ok) return;
    const common = {
      engagement: record.id,
      principal: 'p:one' as PrincipalId,
      side: 'RAIDER' as RaidSide,
      fit: simulated.value.fitHash,
      hull: 'PIKE',
      echelon: 'MAIN' as const,
      posture: 'HOLD' as const,
      primary: ['WEAKEST'] as readonly TargetPredicate[],
      withdrawWhen: { ehpBelowBps: 0, hullsLost: 0, now: false },
      ehpPerHull: simulated.value.ehp,
      capPerHull: simulated.value.capacitor,
      tick: 101,
    };
    book.commit({ ...common, hand: 'h1' as HandId, hullId: 'u1' as HullId });
    book.commit({ ...common, hand: 'h2' as HandId, hullId: 'u2' as HullId });
    expect(record.formations.length, 'two identical hulls are ONE cohort').toBe(1);
    const cohort = record.formations[0];
    expect(cohort?.hands.length, 'carrying two hands').toBe(2);
    expect(cohort?.hulls.length, 'and two hulls, index-aligned').toBe(2);
    expect(cohort?.ehpFull, 'with both buffers').toBe(simulated.value.ehp * 2);
  });

  it('refuses the same hand twice, because a hand crews one hull', () => {
    const book = new Book();
    const record = battle('MUSTER');
    book.open(record);
    const simulated = simulateFit('PIKE', ['SMALL_GUN']);
    if (!simulated.ok) throw new Error('fit');
    const common = {
      engagement: record.id,
      principal: 'p:one' as PrincipalId,
      side: 'RAIDER' as RaidSide,
      fit: simulated.value.fitHash,
      hull: 'PIKE',
      hand: 'h1' as HandId,
      echelon: 'MAIN' as const,
      posture: 'HOLD' as const,
      primary: ['WEAKEST'] as readonly TargetPredicate[],
      withdrawWhen: { ehpBelowBps: 0, hullsLost: 0, now: false },
      ehpPerHull: simulated.value.ehp,
      capPerHull: simulated.value.capacitor,
      tick: 101,
    };
    book.commit({ ...common, hullId: 'u1' as HullId });
    expect(() => book.commit({ ...common, hullId: 'u2' as HullId })).toThrow(/already in formation/);
  });

  it('round-trips through capture and restore, index alignment intact', () => {
    // The alignment of `hands` and `hulls` is the one thing in this book whose corruption would wreck
    // the WRONG principal's asset — internally consistent, and naming the wrong victim, which is A5′
    // at its worst. `capture` deliberately does NOT sort either array.
    const book = new Book();
    const record = battle('CONTEST');
    book.open(record);
    const simulated = simulateFit('PIKE', ['SMALL_GUN']);
    if (!simulated.ok) throw new Error('fit');
    for (const [i, hand] of ['hZ', 'hA', 'hM'].entries()) {
      book.commit({
        engagement: record.id,
        principal: 'p:one' as PrincipalId,
        side: 'RAIDER',
        fit: simulated.value.fitHash,
        hull: 'PIKE',
        hand: hand as HandId,
        hullId: `u${String(i)}` as HullId,
        echelon: 'MAIN',
        posture: 'HOLD',
        primary: ['WEAKEST'],
        withdrawWhen: { ehpBelowBps: 0, hullsLost: 0, now: false },
        ehpPerHull: simulated.value.ehp,
        capPerHull: simulated.value.capacitor,
        tick: 101,
      });
    }
    const fresh = new Book();
    fresh.restore(book.capture());
    const restored = fresh.get(record.id)?.formations[0];
    expect(restored?.hands, 'insertion order preserved, NOT sorted').toEqual(['hZ', 'hA', 'hM']);
    expect(
      restored?.hulls,
      'and the hulls with it. A sort on either array would silently re-pair every hand with somebody ' +
        "else's hull across a restart.",
    ).toEqual(['u0', 'u1', 'u2']);
  });
});
