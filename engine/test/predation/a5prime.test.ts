/**
 * **A5′ — the record must never be wrong.** The two named risks in predation, and the
 * two invariants that stop each of them.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * *"A fabricated default is a worse defect than a crash — it libels a real agent
 * permanently"* (A5′, §15.4). Predation is where that risk is largest, because it is the
 * one mechanic that takes value from a principal who did not agree to lose it:
 *
 *   1. **A loss recorded against a principal that did not suffer one.** `PRD-3` recomputes
 *      every recorded loss from the posting log by a second road and halts on any
 *      difference *in either direction*.
 *   2. **A default recorded for failing to pay a demand it was never shown.** A raid
 *      records no default at all, ever — `RaidOutcome.isDefault` is the literal type
 *      `false`, `PRD-5` halts on a raid and a default landing on one principal in one
 *      tick, and `PRD-4` refuses any resolution whose window did not run.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { minor, qty } from '../../src/core/units.js';
import { Rng } from '../../src/core/rng.js';
import {
  Book,
  DEMAND_WINDOW_TICKS,
  MAX_LIVE_RAIDS,
  RAID_SPAWN_PHASES,
  MAX_RAID_PARTIES,
  MAX_SEIZE_LOTS,
  checkPrd1,
  checkPrd2,
  checkPrd3,
  checkPrd4,
  checkPrd5,
  checkPrd6,
  checkPredationInvariants,
  raidArithmeticProblems,
  raidIdFor,
  runPredate,
  takeFor,
  windowWasHonest,
  type PredationInvariantInputs,
  type PredationPort,
} from '../../src/predation/index.js';
import {
  GOOD,
  act,
  commonsWorld,
  eventsOfKind,
  raidRow,
  raidWorld,
  runTo,
  runToFirstRaid,
  tick,
} from './fixture.js';
import { tierOf, SWAY_AT_SEAT } from '../../src/world/index.js';

/**
 * ★ §16.12 #1's SWAY term, held at full for every arithmetic test in this file.
 *
 * `noBattle`'s reason, applied to the other new term: these tests measure hands, joiners and
 * terrain, so the capacity limit is pinned open and they measure what they always measured. The
 * cap's own arithmetic — including that a raider at 0 contributes nothing and shows up in
 * `raidersOutOfSway` — is asserted in `test/world/the-map-has-borders.spec.ts` against the
 * engine's own reading rather than against a fixture built beside the assertion.
 */
const fullSway = () => SWAY_AT_SEAT;


function inputs(book: Book, over: Partial<PredationInvariantInputs> = {}): PredationInvariantInputs {
  return {
    book,
    tick: 100,
    tierOf: () => 'MARCHES',
    movedForRaid: () => null,
    defaultsThisTick: new Set<PrincipalId>(),
    ...over,
  };
}

describe('PRD-1 — A8 as an assertion, not as care', () => {
  it('halts on any raid standing in the Commons, live or historical', () => {
    const book = new Book();
    book.spawn(raidRow({ stage: 'commons-1' as SystemId }));
    const violations = checkPrd1(inputs(book, { tierOf: () => 'COMMONS' }));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.severity).toBe('HALT');
    expect(violations[0]?.message).toContain('invalid, not punished');
  });

  it('says nothing about a raid outside the Commons', () => {
    const book = new Book();
    book.spawn(raidRow());
    expect(checkPrd1(inputs(book))).toEqual([]);
  });

  it('checks the RECORD, so a raid resolved in the Commons last Reckoning still halts', () => {
    // The historical half matters as much as the live half: a resolved Commons raid is a
    // permanent public fact that the floor was breached, and the world should stop rather
    // than carry it forward as though it were fine.
    const book = new Book();
    book.spawn(raidRow({ state: 'PLUNDERED', resolvedAtTick: 72, lostQty: qty(10) }));
    expect(checkPrd1(inputs(book, { tierOf: () => 'COMMONS' }))).toHaveLength(1);
  });
});

describe('PRD-3 — every recorded loss is exactly what the ledger moved', () => {
  it('halts when the row claims MORE than the postings moved — the libel', () => {
    const book = new Book();
    book.spawn(raidRow({ state: 'PLUNDERED', resolvedAtTick: 100, lostQty: qty(6_000) }));
    const violations = checkPrd3(inputs(book, { movedForRaid: () => 200 }));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('permanent public libel');
  });

  it('halts when the row claims LESS — the quieter version of the same defect', () => {
    const book = new Book();
    book.spawn(raidRow({ state: 'PLUNDERED', resolvedAtTick: 100, lostQty: qty(10) }));
    expect(checkPrd3(inputs(book, { movedForRaid: () => 6_000 }))).toHaveLength(1);
  });

  it('halts on an open raid that already records a loss', () => {
    const book = new Book();
    book.spawn(raidRow({ state: 'DEMANDED', lostQty: qty(1) }));
    expect(checkPrd3(inputs(book))).toHaveLength(1);
  });

  it('skips rather than fails when there is no ledger to check against', () => {
    // A clause that halts a fixture with no ledger is a clause somebody switches off.
    const book = new Book();
    book.spawn(raidRow({ state: 'PLUNDERED', resolvedAtTick: 100, lostQty: qty(6_000) }));
    expect(checkPrd3(inputs(book, { movedForRaid: () => null }))).toEqual([]);
  });

  it('runs for real against the real ledger, on the tick a raid resolves', () => {
    // The wired half: the second road is the posting log of an actual seizure, so this
    // would fire if `seize` and the book ever disagreed about what moved.
    const { runtime } = raidWorld('prd3-wired', 3);
    const raid = runToFirstRaid(runtime);
    runTo(runtime, raid.resolvesAtTick);
    expect(runtime.raids.get(raid.id)?.state).toBe('PLUNDERED');
    expect(runtime.engine.status).toBe('RUNNING');
    // One more tick, so ASSERT has run again over a book holding a resolved raid.
    tick(runtime);
    expect(runtime.engine.status).toBe('RUNNING');
  });
});

describe('PRD-4 and the window gate — nothing is taken from an agent that was never shown the demand', () => {
  it('`windowWasHonest` is false until the whole published window has run', () => {
    const raid = raidRow({ spawnedAtTick: 48 });
    expect(windowWasHonest(raid, 48 + DEMAND_WINDOW_TICKS - 1)).toBe(false);
    expect(windowWasHonest(raid, 48 + DEMAND_WINDOW_TICKS)).toBe(true);
  });

  it('halts on a resolution that beat its own window', () => {
    const book = new Book();
    book.spawn(raidRow({ state: 'PLUNDERED', spawnedAtTick: 48, resolvedAtTick: 50, lostQty: qty(1) }));
    const violations = checkPrd4(inputs(book));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('never shown the demand');
  });

  it('exempts PAID, because paying early is the target\'s own decision', () => {
    const book = new Book();
    book.spawn(raidRow({ state: 'PAID', spawnedAtTick: 48, resolvedAtTick: 49, lostQty: qty(3_000) }));
    expect(checkPrd4(inputs(book))).toEqual([]);
  });

  it('the live world never resolves early — the demand is readable for the whole window', () => {
    const { runtime } = raidWorld('prd4-wired', 3);
    const raid = runToFirstRaid(runtime);
    // Every tick inside the window: the raid is still open and nothing has been taken.
    for (let t = raid.spawnedAtTick + 1; t < raid.resolvesAtTick; t += 1) {
      runTo(runtime, t);
      expect(runtime.raids.get(raid.id)?.state).toBe('DEMANDED');
      expect(runtime.raids.get(raid.id)?.lostQty).toBe(0);
    }
    runTo(runtime, raid.resolvesAtTick);
    expect(runtime.raids.get(raid.id)?.state).not.toBe('DEMANDED');
  });
});

describe('PRD-5 — a raid never produces a default', () => {
  it('halts when a raided principal acquires a default in the same tick', () => {
    // §15.4's named nightmare: "my convoy is raided and X is drained; my default is your
    // bug, permanently attached to my name, invisible in a healthy-looking system."
    const book = new Book();
    book.spawn(raidRow({ state: 'PLUNDERED', resolvedAtTick: 100, lostQty: qty(1) }));
    const violations = checkPrd5(
      inputs(book, { defaultsThisTick: new Set(['p:target' as PrincipalId]) }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('permanently attached to my');
  });

  it('says nothing when the default is against somebody the raid did not touch', () => {
    const book = new Book();
    book.spawn(raidRow({ state: 'PLUNDERED', resolvedAtTick: 100, lostQty: qty(1) }));
    expect(checkPrd5(inputs(book, { defaultsThisTick: new Set(['p:other' as PrincipalId]) }))).toEqual([]);
  });

  it('the resolution receipt says so on its face, and no default event is ever written', () => {
    const { runtime } = raidWorld('prd5-wired', 3);
    const raid = runToFirstRaid(runtime);
    runTo(runtime, raid.resolvesAtTick);
    const receipts = eventsOfKind(runtime, 'raid.resolved');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.payload['is_default']).toBe(false);
    // And nothing default-shaped was written at all: predation records losses, never
    // breaches, because nobody promised the world anything.
    for (const kind of ['VENTURE_DEFAULTED', 'OBLIGATION_DEFAULTED', 'LEVY_DEFAULTED']) {
      expect(eventsOfKind(runtime, kind)).toEqual([]);
    }
  });

  it('standing does not move on a raid — INV-21 permits none of predation\'s outcomes', () => {
    const { runtime } = raidWorld('prd5-standing', 3);
    const raid = runToFirstRaid(runtime);
    const before = JSON.stringify(runtime.standing.rows());
    runTo(runtime, raid.resolvesAtTick);
    expect(runtime.raids.get(raid.id)?.lostQty).toBeGreaterThan(0);
    expect(JSON.stringify(runtime.standing.rows())).toBe(before);
  });
});

describe('PRD-2 and PRD-6 — the bounds and the internal arithmetic', () => {
  it('halts past the declared party cap and on a duplicate party', () => {
    const book = new Book();
    const parties = Array.from({ length: MAX_RAID_PARTIES + 1 }, (_, i) => ({
      principal: `p:${String(i)}` as PrincipalId,
      side: 'RAIDER' as const,
      handId: `h${String(i)}` as never,
      stake: minor(500),
      encumbranceId: null,
      joinedAtTick: 50,
    }));
    book.spawn(raidRow({ parties }));
    expect(checkPrd2(inputs(book)).map((v) => v.id)).toContain('PRD-2');
  });

  it('halts on parties held out of canonical order — a book that hashes differently per host', () => {
    const book = new Book();
    book.spawn(
      raidRow({
        parties: [
          { principal: 'p:z' as PrincipalId, side: 'RAIDER', handId: 'h1' as never, stake: minor(1), encumbranceId: null, joinedAtTick: 1 },
          { principal: 'p:a' as PrincipalId, side: 'RAIDER', handId: 'h2' as never, stake: minor(1), encumbranceId: null, joinedAtTick: 1 },
        ],
      }),
    );
    expect(checkPrd2(inputs(book)).some((v) => v.message.includes('canonical order'))).toBe(true);
  });

  it('names each arithmetic contradiction separately, so a failure says which branch lied', () => {
    expect(raidArithmeticProblems(raidRow({ state: 'REPULSED', lostQty: qty(5) }))[0]).toContain(
      'repulsed and still took',
    );
    expect(
      raidArithmeticProblems(raidRow({ state: 'PLUNDERED', lostQty: qty(0), raiderForce: 5 }))[0],
    ).toContain('took nothing');
    expect(
      raidArithmeticProblems(raidRow({ state: 'PAID', lostQty: qty(99_999) }))[0],
    ).toContain('against a demand of');
    expect(raidArithmeticProblems(raidRow({ state: 'MISSED', lostQty: qty(1) }))[0]).toContain('missed and still took');
    // A repulse whose recorded forces say the defender lost is the arithmetic and the
    // outcome disagreeing, which is what PRD-6 exists to catch.
    expect(
      raidArithmeticProblems(raidRow({ state: 'REPULSED', defenderForce: 1, raiderForce: 5 })),
    ).toContain('was repulsed with 1 against 5; higher force wins');
  });

  it('a healthy world produces none of them', () => {
    const book = new Book();
    book.spawn(raidRow({ state: 'REPULSED', resolvedAtTick: 72, defenderForce: 5, raiderForce: 4 }));
    book.spawn(raidRow({ id: raidIdFor(120, 0), spawnedAtTick: 120, resolvesAtTick: 144 }));
    expect(checkPrd6(inputs(book))).toEqual([]);
    expect(checkPredationInvariants(inputs(book))).toEqual([]);
    expect(book.liveCount()).toBeLessThanOrEqual(MAX_LIVE_RAIDS);
  });
});

describe('a raid that guesses wrong hits ballast (§11.2) — and records that, not the demand', () => {
  it('records what actually moved when the target emptied the place during the window', () => {
    const { runtime, principals, stage } = raidWorld('ballast', 3);
    const raid = runToFirstRaid(runtime);
    const other = principals.find((p) => p !== raid.target);
    if (other === undefined) throw new Error('fixture');

    // The target sells the shelf out from under the raid. Modelled here as a direct
    // ledger move because there is no `haul` verb yet — what matters is that the goods
    // are gone by the deadline, which is exactly what scouting is supposed to buy.
    for (const lot of runtime.ledger.lotsInAccount(`stores:${raid.target}` as never)) {
      if (lot.location !== stage || lot.qty <= 1) continue;
      runtime.ledger.transferGoods({
        eventId: `test:empty:${lot.id}` as never,
        tick: runtime.engine.tick,
        lotId: lot.id,
        to: `stores:${other}` as never,
        qty: qty(lot.qty - 1),
      });
    }

    runTo(runtime, raid.resolvesAtTick);
    const closed = runtime.raids.get(raid.id);
    // One unit left, and the half-cap floors to zero on it: the raid took nothing.
    expect(closed?.lostQty).toBeLessThan(raid.demandQty);
    expect(runtime.engine.status).toBe('RUNNING');
    // Whatever it took, PRD-3 checked it against the posting log and did not halt — so
    // the recorded number is the moved number, which is the entire promise.
    expect(['MISSED', 'PLUNDERED']).toContain(closed?.state);
  });
});

describe('nothing predation does can halt the world from an agent action (AGT-X9)', () => {
  it('every malformed answer is a sentence, never a throw and never a pause', () => {
    const { runtime, principals, stage } = raidWorld('agtx9', 3);
    const raid = runToFirstRaid(runtime);
    const other = principals.find((p) => p !== raid.target);
    if (other === undefined) throw new Error('fixture');

    const nonsense: readonly (readonly [PrincipalId, string, Record<string, unknown>])[] = [
      [raid.target, 'yield', { raid: 'raid:9999:0' }],
      [raid.target, 'fight', { raid: raid.id, system: 'no-such-system' }],
      [other, 'yield', { raid: raid.id }],
      [other, 'join', { raid: raid.id, side: 'SIDEWAYS' }],
      [other, 'join', { raid: raid.id, side: 'DEFENDER', hand: 'no-such-hand' }],
      [raid.target, 'join', { raid: raid.id, side: 'DEFENDER' }],
      [raid.target, 'fight', { raid: raid.id, system: stage, principal: 'p:nobody' }],
    ];
    for (const [who, verb, params] of nonsense) {
      const outcome = runtime.engine.submit({
        principal: who,
        verb,
        params,
        clientSequence: 0,
        arrivalMs: 0,
        decisionSource: 'LIVE',
      });
      if (outcome.ok) tick(runtime);
      expect(runtime.engine.status, `${verb} ${JSON.stringify(params)}`).toBe('RUNNING');
    }
    // Drain what the loop queued: corrections are FIFO, so the next assertion would
    // otherwise read the first refusal above rather than its own.
    runtime.takeCorrections(raid.target);
    runtime.takeCorrections(other);
    // ── THE FLOOR'S KEY IS CROSS-CHECKED, and this is what makes that a rule ──
    //
    // `commonsFloorRejection` clears the place the params NAME. If the handler then acted
    // on a raid somewhere else, the floor would have cleared one thing and the engine
    // done another — a floor held up by a caller behaving well rather than by a check.
    const wrongWho = act(runtime, raid.target, 'fight', {
      raid: raid.id,
      system: raid.stage,
      principal: other,
    });
    expect(wrongWho?.invariant).toBe('A8');
    expect(wrongWho?.hint).toContain('has to be the one the raid is aimed at');
    expect(runtime.raids.get(raid.id)?.answer).toBeNull();

    // The other key, and it needs its own case: naming a legal place that is not THIS
    // raid's place clears the floor against the wrong system.
    const elsewhere = [...runtime.world.map.systems.keys()].find(
      (id) => id !== raid.stage && runtime.world.map.systems.get(id)?.tier === 'MARCHES',
    );
    if (elsewhere === undefined) throw new Error('the launch map has one Marches system');
    const wrongPlace = act(runtime, raid.target, 'fight', { raid: raid.id, system: elsewhere });
    expect(wrongPlace?.invariant).toBe('A8');
    expect(wrongPlace?.hint).toContain('has to be the place the raid is');
    expect(runtime.raids.get(raid.id)?.answer).toBeNull();

    // And answering twice is refused rather than overwriting the first answer.
    act(runtime, raid.target, 'fight', { raid: raid.id, system: stage });
    const second = act(runtime, raid.target, 'fight', { raid: raid.id, system: stage });
    expect(second?.hint).toContain('already answered');
    expect(runtime.engine.status).toBe('RUNNING');
  });
});

describe('the three defences that only bite when something else has already gone wrong', () => {
  it('a partial seizure records what MOVED, not what it wanted — even against its own lot bound', () => {
    // ── THE MUTATION THAT WAS INVISIBLE, AND WHY ─────────────────────────────
    //
    // Changing `seize` to return `args.want` instead of the measured total passed every
    // test, because in the ordinary case the two are equal: `standingOf` and `seize` read
    // the same lots. The one path where they part company is `MAX_SEIZE_LOTS` — the
    // seizure walks a bounded number of lots (scar #3) while `standingOf` counts them all
    // — and that path is exactly the A5′ hazard: the raid would record a loss larger than
    // the ledger produced, permanently, against a real agent.
    //
    // So the target is given many small piles instead of one large one, which is what a
    // trader's inventory actually looks like.
    // One principal, so the ranking has exactly one answer and the test is about the
    // seizure rather than about who was picked.
    const { runtime, principals, stage } = raidWorld('partial-seize', 1);
    const victim = principals[0];
    if (victim === undefined) throw new Error('fixture');
    // Retire the single big enrolment lot, then lay down 40 small piles — which is what
    // a trader's inventory actually looks like, and the only shape that reaches the bound.
    for (const lot of runtime.ledger.lotsInAccount(`stores:${victim}` as never)) {
      if (lot.location !== stage) continue;
      runtime.ledger.destroyGoods({
        eventId: `test:clear:${lot.id}` as never,
        tick: 0,
        sink: 'sink:loss' as never,
        lotId: lot.id,
        qty: qty(lot.qty),
      });
    }
    for (let i = 0; i < 40; i += 1) {
      runtime.ledger.sourceGoods({
        eventId: `test:pile:${String(i).padStart(3, '0')}` as never,
        tick: 0,
        faucet: 'faucet:production' as never,
        to: `stores:${victim}` as never,
        good: GOOD,
        qty: qty(100),
        location: stage,
        origin: victim,
      });
    }

    const raid = runToFirstRaid(runtime);
    expect(raid.target).toBe(victim);
    runTo(runtime, raid.resolvesAtTick);

    const closed = runtime.raids.get(raid.id);
    // 40 piles of 100 stand there; the take is capped at half of that (2,000) and the
    // seizure walks at most MAX_SEIZE_LOTS of them (1,600). The record must say 1,600.
    expect(closed?.lostQty).toBe(MAX_SEIZE_LOTS * 100);
    expect(closed?.lostQty).toBeLessThan(takeFor(raid.demandQty, qty(4_000)));
    // And PRD-3 agreed, from the posting log, or the tick would have halted.
    expect(runtime.engine.status).toBe('RUNNING');
  });

  it('the window gate refuses a raid whose deadline was set inside its own window', () => {
    // `dueAt` already filters on `resolvesAtTick`, which the spawner always sets to
    // spawn + the published window — so removing the gate is invisible in the wired
    // world. It is defence in depth against a second resolution path added later, and
    // this is the only way to exercise it: a row whose deadline is a lie.
    const book = new Book();
    book.spawn(raidRow({ spawnedAtTick: 48, resolvesAtTick: 49 }));
    const report = runPredate({
      book,
      port: inertPort(),
      rng: Rng.fromSeed('gate'),
      tick: 49,
      onFault: () => undefined,
    });
    expect(report.resolved).toEqual([]);
    expect(book.live()).toHaveLength(1);
    // And it does resolve once the published window has actually run.
    const later = runPredate({
      book,
      port: inertPort(),
      rng: Rng.fromSeed('gate'),
      tick: 48 + DEMAND_WINDOW_TICKS,
      onFault: () => undefined,
    });
    expect(later.resolved).toHaveLength(1);
  });

  it('PRD-1 halts the real world if a Commons raid ever exists, whatever let it in', () => {
    // The backstop. Target selection filters Commons lots and the spawner re-checks the
    // stage tier, so a Commons raid needs BOTH to fail — and this is what happens then:
    // the tick aborts and the world pauses rather than carrying a breach of the one
    // promise a newcomer is given before it has learned anything else (A8).
    const { runtime } = commonsWorld('prd1-backstop', 3);
    const stage = [...runtime.world.holdings.values()][0]?.system;
    if (stage === undefined) throw new Error('fixture');
    runtime.raids.spawn(raidRow({ stage, target: runtime.world.principalOrder[0] as PrincipalId }));

    const report = runtime.runTick();
    expect(report.halted).toBe(true);
    expect(report.violations.map((v) => v.id)).toContain('PRD-1');
    expect(runtime.engine.status).toBe('PAUSED');
  });

  it('the SPAWNER refuses a Commons stage on its own, with nothing else helping', () => {
    // ══════════════════════════════════════════════════════════════════════
    // **A8 HAS TWO INDEPENDENT GUARDS AND, UNTIL THIS TEST, NEITHER WAS PINNED ALONE.**
    //
    // The `graduate` change was shipped with an honest caveat: deleting *either* the
    // spawner's `port.tierOf(candidate.stage) === 'COMMONS'` skip **or** the runtime's
    // `safeTier(lot.location) !== 'COMMONS'` lot filter left the whole suite green,
    // because each guard alone is sufficient and the pipeline runs both. Verified: both
    // single-line mutations pass all 106 tests in `commons-exit` + `predation/`.
    //
    // Defence in depth is right for A8. "No test bites when one layer is removed" is not
    // — it means a future edit can silently spend the redundancy without anything going
    // red, and the next edit is then the one that opens the floor. So each guard gets a
    // test at its own seam.
    //
    // This one is the spawner's, isolated by handing it a port that reports a pile in a
    // COMMONS system. Target selection cannot save it here: the port IS the selection.
    //
    // MUTATION: delete `if (port.tierOf(candidate.stage) === 'COMMONS') continue;` from
    // `spawnOne` in `src/predation/predate.ts`. RED on `spawned` — and PRD-1 would then
    // be the only thing left, which is a halt rather than a floor.
    // ══════════════════════════════════════════════════════════════════════
    const inCommons: PredationPort = {
      ...inertPort(),
      principals: () => ['p:sitting-duck' as PrincipalId],
      assailableOf: () => [
        { lotId: 'lot:duck', good: GOOD, qty: qty(50_000), location: 'commons-1' as SystemId },
      ],
      // Honest about the tier, which is the whole point: the world knows this is the
      // Commons and must decline to aim at it anyway.
      tierOf: () => 'COMMONS',
    };
    const book = new Book();
    const report = runPredate({
      book,
      port: inCommons,
      rng: Rng.fromSeed('commons-stage'),
      tick: 48,
      onFault: () => undefined,
    });
    expect(report.spawned, 'a raid was aimed into the Commons').toHaveLength(0);
    expect(book.liveCount()).toBe(0);
    // And it is reported as "came looking, found nobody outside the walls" rather than
    // swallowed — A8 working is a fact about the world, not an absence.
    expect(report.noTarget).toBeGreaterThan(0);
  });

  it('a world entirely inside the floor is never aimed at, however long it runs', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The end-to-end half, and a finding recorded rather than papered over.
    //
    // A8's second guard — `predationPort.assailableOf`'s `safeTier(lot.location) !==
    // 'COMMONS'` lot filter — **cannot be pinned alone by any black-box test, and that is
    // a fact about the code rather than a gap in the suite.** Removing it changes no
    // observable behaviour: its only consumers are target ranking, where the spawner's
    // stage skip refuses the Commons candidate it would produce, and `standingOf`, which
    // already filters `pile.location !== stage` and so never sees a Commons pile for a
    // legal stage. It is real defence in depth, not redundant code — but a test claiming
    // to pin it would pass under its own mutation, which is a worse artifact than none.
    // (Tried and discarded: a `commonsWorld` run, and a graduate with goods left behind.)
    //
    // So the guards are pinned where each is actually load-bearing: the spawner's skip by
    // the test above, PRD-1 by the backstop test above that, and the whole pipeline here.
    // ══════════════════════════════════════════════════════════════════════
    const { runtime } = commonsWorld('lot-filter', 3);
    for (const holding of runtime.world.holdings.values()) {
      expect(tierOf(runtime.world.map, holding.system)).toBe('COMMONS');
    }
    // Two spawn phases and both their windows: nothing may ever be aimed at anyone.
    runTo(runtime, (RAID_SPAWN_PHASES[1] ?? 120) + DEMAND_WINDOW_TICKS + 2);
    expect(eventsOfKind(runtime, 'raid.spawned')).toHaveLength(0);
    expect(runtime.raids.size()).toBe(0);
    expect(runtime.engine.status).toBe('RUNNING');
  });
});

/** A port that owns nothing and moves nothing. For the gate, which must not need one. */
function inertPort(): PredationPort {
  return {
    principals: () => [],
    assailableOf: () => [],
    presentHandsAt: () => 0,
    worksAt: () => [],
    razeWorks: () => false,
    tierOf: () => 'MARCHES',
    handsDefending: () => [],
    standingOf: () => qty(0),
    // No battle book at all, so nothing is counting any raid's hulls and every drawn force
    // stands. `null` rather than 0 for `readForce`'s stated reason: 0 would be a free repulse.
    raidForceLeft: () => null, swayAt: fullSway,
    // Nowhere to march from and nowhere to march to. A port that owns no hands cannot route one.
    marchTo: () => null,
    isSeated: () => true,
    seize: () => qty(0),
    releaseStake: () => undefined,
    forfeit: () => minor(0),
    routHand: () => false,
  };
}
