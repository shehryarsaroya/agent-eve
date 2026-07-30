/**
 * **The Levy as a wired mechanic, not a module** — and the difference is the whole point.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `src/levy/` could be perfect and change nothing. What makes the mechanic real is that the
 * tick loop assesses, the verb table accepts `vote` and `deliver`, `state_hash` sees the
 * book, the abort path restores it, ASSERT runs INV-24 and INV-25 over it, and the sim
 * reports `levyBuilt: true` from the assessments rather than from a constant.
 *
 * Every test here goes through the real `Runtime`. None of them constructs a `Book` by hand.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { LEVY_BALLOT, LEVY_GOOD, LEVY_STARTER_ALLOTMENT, PUBLISHED_DEFAULT_RULE } from '../../src/levy/index.js';
import { runSim, totalise, type SimArgs } from '../../src/sim/cli.js';
import { storesAccount } from '../../src/ledger/index.js';
import { act, attempt, levyWorld, runTo, submit, tick, walkToPlace } from './fixture.js';

const ARGS: SimArgs = {
  seed: 'levy-wired',
  ticks: 600,
  speed: 'instant',
  cast: 'heuristic',
  principals: 8,
  hazards: true,
  assertEveryTick: true,
  emitStateHash: true,
  quiet: true,
  framesDir: null,
  liveFrames: false,
};

describe('the verbs are reachable, and neither of them is new', () => {
  it('`vote` records a LEVY ballot, free, and replaces on a restatement', () => {
    const world = levyWorld('wired-vote', 3);
    const runtime = world.runtime;
    const voter = world.principals[0];
    if (voter === undefined) throw new Error('fixture');
    tick(runtime);

    const before = runtime.engine.budget.materialTaken(voter);
    expect(act(runtime, voter, 'vote', { ballot: LEVY_BALLOT, rule: 'EVEN' })).toBeNull();
    // §17 lists `vote` as free — "a ballot is free and cannot be priced out".
    expect(runtime.engine.budget.materialTaken(voter)).toBe(before);
    expect(runtime.levy.hasVoted(1, voter)).toBe(true);
    expect(runtime.levy.ballotsFor(1, 'con-1' as never)).toHaveLength(1);

    // One principal, one ballot: a restatement replaces rather than appends, or a principal
    // with more actions would have more votes and A4 would fall at the ballot box.
    act(runtime, voter, 'vote', { ballot: LEVY_BALLOT, rule: 'BY_STORES' });
    const ballots = runtime.levy.ballotsInOrder().filter((b) => b.principal === voter);
    expect(ballots).toHaveLength(1);
    expect(ballots[0]?.rule).toBe('BY_STORES');
  });

  it('refuses a closed ballot, an unknown rule and an outside nomination — with sentences', () => {
    const world = levyWorld('wired-vote-refuse', 3);
    const runtime = world.runtime;
    const voter = world.principals[0];
    if (voter === undefined) throw new Error('fixture');
    tick(runtime);

    expect(attempt(runtime, voter, 'vote', { ballot: LEVY_BALLOT, rule: 'WHATEVER' })?.hint).toContain(
      'INVERSE_EXPOSURE',
    );
    expect(
      attempt(runtime, voter, 'vote', { ballot: LEVY_BALLOT, rule: 'EVEN', spare: 'p:stranger' })?.hint,
    ).toContain('your own constellation');

    // ── A SEIZURE BALLOT IS REFUSED AT THE DOOR, BY THE COMMONS FLOOR ────────
    //
    // Not by this module: `world/commons.ts` classifies every ballot kind it does not
    // recognise as HOSTILE and fails closed, so a `SEIZURE` ballot aimed at a Commons
    // principal is *invalid* rather than punished (A8). Worth asserting here because it
    // means the Levy's own "only the LEVY ballot is open" refusal is the second line, not
    // the first — and a future edit that made the floor permissive would surface here.
    const seizure = attempt(runtime, voter, 'vote', { ballot: 'SEIZURE', rule: 'EVEN' });
    expect(seizure?.invariant).toBe('A8');

    // Closed after the commitment window opens: the last 24 ticks and the freeze are for
    // paying, not for arguing.
    runTo(runtime, 270);
    const closed = attempt(runtime, voter, 'vote', { ballot: LEVY_BALLOT, rule: 'EVEN' });
    expect(closed?.hint).toContain('closed at tick');
    expect(runtime.engine.status).toBe('RUNNING');
  });

  it('the vote decides the NEXT Reckoning, so an assessment never moves under a payer', () => {
    const world = levyWorld('wired-next', 3);
    const runtime = world.runtime;
    tick(runtime);
    const before = world.principals.map((p) => runtime.levy.assessmentOf(0, p));

    // A unanimous vote for a rule that would reallocate everything, cast during Reckoning 0.
    for (const [i, p] of world.principals.entries()) {
      submit(runtime, p, 'vote', { ballot: LEVY_BALLOT, rule: 'BY_STORES' }, i);
    }
    tick(runtime);

    // Reckoning 0 is untouched: the plan was minted at phase 0 and does not move.
    expect(world.principals.map((p) => runtime.levy.assessmentOf(0, p))).toEqual(before);
    expect(runtime.levy.planFor(0, 'con-1' as never)?.rule).toBe(PUBLISHED_DEFAULT_RULE);

    // And Reckoning 1 is assessed under the rule they chose.
    runTo(runtime, TICKS_PER_RECKONING);
    expect(runtime.levy.planFor(1, 'con-1' as never)?.rule).toBe('BY_STORES');
    expect(runtime.levy.planFor(1, 'con-1' as never)?.byDefault).toBe(false);
  });

  it('`deliver` moves real located goods into civic custody, and only what it credits', () => {
    const world = levyWorld('wired-deliver', 2);
    const runtime = world.runtime;
    const payer = world.principals[0];
    if (payer === undefined) throw new Error('fixture');
    tick(runtime);
    const owed = runtime.levyBlockFor(payer, runtime.engine.tick)?.my_assessment ?? 0;
    expect(runtime.levyGoodAvailable(payer)).toBe(LEVY_STARTER_ALLOTMENT);

    const place = walkToPlace(runtime, payer);
    act(runtime, payer, 'deliver', {});

    // Goods left the payer's stores, exactly the credited amount, and were retired rather
    // than transferred: civic custody consumes what it is given.
    expect(runtime.levyGoodAvailable(payer)).toBe(LEVY_STARTER_ALLOTMENT - owed);
    const held = runtime.ledger.goodsInAccount(storesAccount(payer)).get(LEVY_GOOD) ?? 0;
    expect(held).toBe(LEVY_STARTER_ALLOTMENT - owed);
    const delivered = runtime.events
      .ticks()
      .flatMap((t) => runtime.events.eventsAtTick(t))
      .map((r) => r.event)
      .filter((e) => e.kind === 'levy.delivered');
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.payload['qty']).toBe(owed);
    expect(delivered[0]?.payload['place']).toBe(place);
    expect(delivered[0]?.payload['byOwnHand']).toBe(true);
  });

  it('refuses a delivery with no hand at the named place, and names the place', () => {
    const world = levyWorld('wired-nohand', 2, 1);
    const runtime = world.runtime;
    const payer = world.principals[0];
    if (payer === undefined) throw new Error('fixture');
    tick(runtime);
    const refusal = act(runtime, payer, 'deliver', {});
    expect(refusal?.hint).toContain('standing at');
    expect(refusal?.hint).toContain('delivery intent');
  });
});

describe('the book is inside state_hash and inside the abort path', () => {
  it('two identical runs hash identically, and a credited delivery changes the hash', () => {
    const one = levyWorld('wired-hash', 2);
    const two = levyWorld('wired-hash', 2);
    tick(one.runtime);
    tick(two.runtime);
    expect(two.runtime.engine.snapshot().stateHash).toBe(one.runtime.engine.snapshot().stateHash);

    const payer = one.principals[0];
    if (payer === undefined) throw new Error('fixture');
    walkToPlace(one.runtime, payer);
    walkToPlace(two.runtime, payer);
    expect(two.runtime.engine.snapshot().stateHash).toBe(one.runtime.engine.snapshot().stateHash);

    act(one.runtime, payer, 'deliver', {});
    tick(two.runtime);
    // A hash that could not see the assessment would call these two worlds identical while
    // one of them owed nothing and the other owed its whole tribute.
    expect(two.runtime.engine.snapshot().stateHash).not.toBe(one.runtime.engine.snapshot().stateHash);
  });

  it('captures and restores every field, including the tenure register', () => {
    const world = levyWorld('wired-restore', 3);
    const runtime = world.runtime;
    tick(runtime);
    const payer = world.principals[0];
    if (payer === undefined) throw new Error('fixture');
    walkToPlace(runtime, payer);
    act(runtime, payer, 'deliver', {});
    act(runtime, payer, 'vote', { ballot: LEVY_BALLOT, rule: 'EVEN', spare: world.principals[1] });

    const captured = runtime.levy.capture();
    const round = new (runtime.levy.constructor as new () => typeof runtime.levy)();
    round.restore(captured);
    expect(round.capture()).toEqual(captured);
    // The tenure register in particular: a restore that lost it would reassess every
    // principal as brand new and hand the whole constellation a nominal rate.
    expect(round.tenureTicksOf(payer, 500)).toBe(runtime.levy.tenureTicksOf(payer, 500));
    expect(round.seatedAtOf(payer)).toBe(runtime.levy.seatedAtOf(payer));
    expect(round.owingOf(0, payer)).toEqual(runtime.levy.owingOf(0, payer));
    expect(round.hasVoted(1, payer)).toBe(true);
  });
});

describe('Commons capacity is the only thing chronic non-payment costs', () => {
  it('refuses a new venture once capacity has fallen, and says nothing else was taken', () => {
    const world = levyWorld('wired-capacity', 2);
    const runtime = world.runtime;
    const p = world.principals[0];
    if (p === undefined) throw new Error('fixture');
    tick(runtime);
    const holdingBefore = runtime.world.holdingByPrincipal.get(p);
    const standingBefore = runtime.standing.rows().find((s) => s.principal === p);

    // Demote all the way to the floor through the book's own door.
    for (let reckoning = 0; reckoning < 40; reckoning += 1) runtime.levy.strike(p, reckoning);
    expect(runtime.levy.capacityOf(p)).toBe(1);

    // One venture is inside the floor; the second is refused, with a hint that names the
    // three things the Levy never takes.
    expect(act(runtime, p, 'create', { kind: 'DIG', stage: world.stage })).toBeNull();
    const refusal = act(runtime, p, 'create', { kind: 'DIG', stage: world.stage });
    expect(refusal?.hint).toContain('Commons capacity is 1');
    expect(refusal?.hint).toContain('your identity are untouched');

    // And nothing else moved: identity, holding, standing (§5.2, PROP-LV4).
    expect(runtime.world.principalOrder).toContain(p);
    expect(runtime.world.holdingByPrincipal.get(p)).toBe(holdingBefore);
    expect(runtime.world.holdings.get(holdingBefore as never)?.state).toBe('INTACT');
    expect(runtime.standing.rows().find((s) => s.principal === p)).toEqual(standingBefore);
    expect([...runtime.world.hands.values()].filter((h) => h.principal === p)).toHaveLength(3);
  });

  it('does not gate a principal at full capacity, so the gate is not a blanket refusal', () => {
    const world = levyWorld('wired-capacity-clean', 2);
    const runtime = world.runtime;
    const p = world.principals[0];
    if (p === undefined) throw new Error('fixture');
    tick(runtime);
    for (let n = 0; n < 3; n += 1) {
      expect(act(runtime, p, 'create', { kind: 'DIG', stage: world.stage })).toBeNull();
    }
  });
});

describe('the sim reports the Levy, and reports it honestly', () => {
  it('levyBuilt is true, assessments sum to the totals, and every principal is assessed', () => {
    const result = runSim(ARGS);
    expect(result.halted).toBe(false);
    expect(result.violations).toEqual([]);
    expect(result.reckonings.levyBuilt).toBe(true);
    expect(result.perLevy.length).toBeGreaterThan(0);
    for (const row of result.perLevy) {
      // Every principal on the roll assessed, every Reckoning. INV-25's own subject.
      expect(row.assessed).toBe(ARGS.principals);
      expect(row.totalMinor).toBeGreaterThan(0);
      expect(row.shortMinor).toBeGreaterThanOrEqual(0);
      expect(row.shortMinor).toBeLessThanOrEqual(row.totalMinor);
    }
    // Ballots were actually cast through the verb, so the vote is exercised end to end.
    expect(result.reckonings.levyBallots).toBeGreaterThan(0);
    // And the tribute lines are drawn at the freeze — A13 as a number.
    expect(result.tributeAtFreeze['lines']).toBe(ARGS.principals);

    // ── `levyShort` HAS TO BE A REAL SUM, AND A MUTATION RUN FOUND IT WAS NOT ──
    //
    // Every assertion above held while `totalise` reported `levyShort: 0` unconditionally —
    // which is precisely the number §14.2 calls the headline and A14's abstention-trivial
    // failure "wearing a number". So it is asserted against the rows it is summed from, by a
    // second road.
    //
    // ══════════════════════════════════════════════════════════════════════════
    // **IT USED TO BE ASSERTED NON-ZERO, AND THAT ASSERTION WAS PINNING TWO CAST DEFECTS.**
    //
    // The original note here read *"this cast pays what it can and still cannot lift the
    // presence share of every tribute in the run"*. It could not, and the reason was not the
    // Levy biting. It was `src/cast/heuristic.ts`, twice:
    //
    //   1. `levyMove` gated every hop on `tierOf(map, member.seat)`, and constellation 1's
    //      delivery place is a COMMONS system while three of its systems are MARCHES — so a
    //      member seated there had its ONLY legal route refused by the cast rather than by the
    //      engine, and delivered nothing for its whole life while being assessed in full.
    //   2. Nothing reserved a hand for the tribute, so a member with all three hands filled
    //      into roles could neither deliver nor walk. Traced: 109,052 units of the good in
    //      stores, 19,304 owed, 264 consecutive ticks with no free hand, swept at the Reckoning.
    //
    // Both are fixed and named at their call sites. With them fixed this cast pays in full, so
    // the shortfall is **zero** — which is the honest reading of the meter: §14.2 says it *"rises
    // when everyone hides"*, and a cast that produces, refines and delivers is not hiding.
    //
    // The Levy's bite is not left unasserted; it is asserted where it can be asserted on purpose
    // rather than by a bot that cannot walk — `chronic.test.ts` (short exactly the non-escrowable
    // share when nobody carries it), `tribute.test.ts` (red lines and a non-zero meter),
    // `coase.test.ts`, `docket.test.ts` and `halt.test.ts` all still pin a non-zero shortfall
    // from a deliberate fixture. What this run may still not do is *manufacture* one.
    // ══════════════════════════════════════════════════════════════════════════
    const summedByHand = result.perLevy.reduce((n, row) => n + row.shortMinor, 0);
    expect(result.reckonings.levyShort).toBe(summedByHand);
    expect(result.reckonings.levyShort).toBeGreaterThanOrEqual(0);
    // Not runaway either: a cast that pays should never be reported short of a whole
    // Reckoning's total, whatever else moves.
    expect(result.reckonings.levyShort).toBeLessThan(result.reckonings.levyTotal);
    expect(result.reckonings.levyTotal).toBe(result.perLevy.reduce((n, r) => n + r.totalMinor, 0));
    expect(result.reckonings.levyAssessed).toBe(ARGS.principals * result.perLevy.length);
  });

  it('levyBuilt is FALSE when nothing was assessed, so the flag can report its own failure', () => {
    // The mutation, as a measurement rather than an edit: `totalise` over an empty Levy log
    // is what the summary would print if the wiring in `runtime.ts` stopped minting an
    // assessment. A hard-coded `true` would have made this test impossible to write.
    expect(totalise([], []).levyBuilt).toBe(false);
    expect(totalise([], []).levyShort).toBe(0);
    expect(
      totalise([], [
        {
          reckoning: 0,
          tick: 287,
          assessed: 3,
          paidInFull: 1,
          totalMinor: 900 as never,
          shortMinor: 400 as never,
          sweptQty: 0 as never,
          sweepQueue: 1,
          demoted: 0,
          byDefault: 1,
          ballotsCast: 2,
        },
      ]).levyBuilt,
    ).toBe(true);
  });

  it('is deterministic: the same seed gives the same hash stream and the same Levy', () => {
    const a = runSim(ARGS);
    const b = runSim(ARGS);
    expect(b.lines).toEqual(a.lines);
    expect(b.reckonings).toEqual(a.reckonings);
    expect(b.perLevy).toEqual(a.perLevy);
    expect(b.tributeAtFreeze).toEqual(a.tributeAtFreeze);
  });
});

describe('nothing an agent sends can halt the world', () => {
  it('survives malformed and hostile Levy parameters, every one a hint', () => {
    const world = levyWorld('wired-fuzz', 2);
    const runtime = world.runtime;
    const p = world.principals[0];
    if (p === undefined) throw new Error('fixture');
    tick(runtime);

    const hostile: readonly Readonly<Record<string, unknown>>[] = [
      {},
      { ballot: '' },
      { ballot: 'LEVY' },
      { ballot: 'levy', rule: 'even' },
      { ballot: 'LEVY', rule: 'EVEN', spare: '' },
      { ballot: 'LEVY', rule: 'EVEN', spare: 'p:' },
      { ballot: 'LEVY', rule: 'EVEN', spare: p },
      { ballot: 'LEVY', rule: 'INVERSE_EXPOSURE', spare: 'con-1' },
    ];
    for (const params of hostile) {
      // `attempt`, not `act`: half of these are refused by the Commons floor at the door
      // rather than by the Levy's handler, and both doors have to fail closed.
      attempt(runtime, p, 'vote', params);
      expect(runtime.engine.status).toBe('RUNNING');
    }

    const deliveries: readonly Readonly<Record<string, unknown>>[] = [
      {},
      { amount: -1 },
      { amount: 0 },
      { amount: Number.MAX_SAFE_INTEGER },
      { on_behalf_of: 'p:nobody' },
      { on_behalf_of: p, amount: 1 },
      { to: 'nowhere' },
      { hand: 'not-a-hand' },
    ];
    for (const params of deliveries) {
      attempt(runtime, p, 'deliver', params);
      expect(runtime.engine.status).toBe('RUNNING');
    }
    expect(runtime.operatorFaults()).toEqual([]);
  });

  it('cannot be made to assess a principal twice, however the tick is driven', () => {
    const world = levyWorld('wired-idempotent', 2);
    const runtime = world.runtime;
    runTo(runtime, 40);
    const plan = runtime.levy.planFor(0, 'con-1' as never);
    const seen = new Set<PrincipalId>();
    for (const line of plan?.lines ?? []) {
      expect(seen.has(line.principal)).toBe(false);
      seen.add(line.principal);
    }
    expect(plan?.lines.reduce((n, l) => n + l.amount, 0)).toBe(plan?.total);
  });
});
