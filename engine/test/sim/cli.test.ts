/**
 * `sim` — Gate 0's `--seed S --ticks N` printing per-tick `state_hash`, and the
 * runtime it drives.
 *
 * Two groups. The CLI group asserts the *interface*: the flags exist, a typo is an
 * error rather than a silently different run, and the hash stream is one line per
 * tick. The runtime group asserts the two properties that make the interface worth
 * having: **the same seed reproduces the world**, and **no input from a player can
 * halt it**.
 */

import { describe, expect, it } from 'vitest';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import { ArgError, DEFAULT_ARGS, parseArgs, runSim } from '../../src/sim/cli.js';
import {
  DELIVERY_VERB,
  Runtime,
  defaultTerms,
  nextSettlementAtOrAfter,
} from '../../src/sim/runtime.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { electiveFloor, kindSpec, VENTURE_KINDS } from '../../src/venture/index.js';
import { storesAccount } from '../../src/ledger/index.js';
import { minor } from '../../src/core/units.js';

describe('sim --flags', () => {
  it('takes every flag the build order names', () => {
    const args = parseArgs([
      '--seed', 's1',
      '--ticks', '48',
      '--speed', 'instant',
      '--cast', 'heuristic',
      '--principals', '12',
      '--hazards', 'on',
      '--assert-every-tick',
      '--emit', 'state_hash',
      '--frames', '/tmp/x',
    ]);
    expect(args).toEqual({
      seed: 's1',
      ticks: 48,
      speed: 'instant',
      cast: 'heuristic',
      principals: 12,
      hazards: true,
      assertEveryTick: true,
      emitStateHash: true,
      quiet: false,
      framesDir: '/tmp/x',
      // ★ Off unless asked. Production rewrites one `live.json` in place, because a mid-Reckoning tick
      // is motion and its history is the ledger; `--live-frames` is a measurement mode that archives
      // one file per tick so an instrument can diff consecutive frames. A default that archived 288
      // files a Reckoning would be the cap-that-hides in reverse — noise nobody asked for.
      liveFrames: false,
    });
  });

  it('takes --live-frames, and it is off by default', () => {
    // The flag exists so `scripts/frame-census.ts` can prove that `ticksLeft` counts DOWN rather than
    // merely being populated once. Asserted as a PAIR — present when asked, absent otherwise — because
    // a flag that is silently always on is a different experiment from the one the caller ran.
    expect(DEFAULT_ARGS.liveFrames).toBe(false);
    expect(parseArgs(['--live-frames']).liveFrames).toBe(true);
  });

  it('asserts every tick by default, so the default run is not the one that proves nothing', () => {
    expect(DEFAULT_ARGS.assertEveryTick).toBe(true);
    expect(DEFAULT_ARGS.emitStateHash).toBe(true);
  });

  it('refuses an unknown flag rather than running a different experiment', () => {
    // `--tikcs 500` that silently ran the default is a run whose result answers a
    // different question than the one asked, and an overnight sweep of those is worse
    // than no sweep.
    expect(() => parseArgs(['--tikcs', '500'])).toThrow(ArgError);
    expect(() => parseArgs(['--speed', 'ludicrous'])).toThrow(ArgError);
    expect(() => parseArgs(['--cast', 'llm'])).toThrow(ArgError);
    expect(() => parseArgs(['--hazards', 'maybe'])).toThrow(ArgError);
    expect(() => parseArgs(['--ticks', '0'])).toThrow(ArgError);
    expect(() => parseArgs(['--ticks', 'many'])).toThrow(ArgError);
    expect(() => parseArgs(['--seed'])).toThrow(ArgError);
  });

  it('emits one state_hash per tick, in order, with no gaps', () => {
    const lines: { tick: number; stateHash: string }[] = [];
    const result = runSim({ ...DEFAULT_ARGS, seed: 'emit', ticks: 12, principals: 4 }, (l) => lines.push(l));
    expect(lines).toHaveLength(12);
    expect(lines.map((l) => l.tick)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const line of lines) expect(line.stateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.halted).toBe(false);
    expect(result.violations).toEqual([]);
  });

  it('the hash stream is what DET-1 compares, and the same seed reproduces it byte for byte', () => {
    const a = runSim({ ...DEFAULT_ARGS, seed: 'det-1', ticks: 60, principals: 8 });
    const b = runSim({ ...DEFAULT_ARGS, seed: 'det-1', ticks: 60, principals: 8 });
    expect(b.lines).toEqual(a.lines);
  });

  it('a different seed diverges, so the seed is doing something', () => {
    const a = runSim({ ...DEFAULT_ARGS, seed: 'det-a', ticks: 30, principals: 8 });
    const b = runSim({ ...DEFAULT_ARGS, seed: 'det-b', ticks: 30, principals: 8 });
    expect(b.lines).not.toEqual(a.lines);
  });

  it('runs with no cast at all, so a world with no bots still asserts clean', () => {
    const result = runSim({ ...DEFAULT_ARGS, seed: 'empty', ticks: 40, principals: 5, cast: 'none' });
    expect(result.halted).toBe(false);
    expect(result.violations).toEqual([]);
    // Nothing decided, and nothing was invented to make it look busy.
    expect(result.decisions['HEURISTIC']).toBe(0);
  });

  it('has no rollback gap left, and says so as an equality', () => {
    const result = runSim({ ...DEFAULT_ARGS, seed: 'gaps', ticks: 5, principals: 2 });
    // ── The regression for the gap this build closed ────────────────────────
    //
    // `venture` used to be here: the table joined `state_hash` and had no `restore`, so
    // a halt at ASSERT left the venture book holding the failed tick's fills,
    // activations and settlements while the report claimed the world was back at
    // `snapshot_T`. That made the operator's "replay the failed tick from the immutable
    // triple" story false for the one table settlement mutates most.
    //
    // Equality rather than `not.toContain('venture')`, so a table that loses its restore
    // path — or a new table registered without one — fails here rather than in an
    // operator's night.
    expect(result.rollbackGaps).toEqual([]);
  });

  it('crosses a Reckoning boundary without halting', () => {
    // The tick that has an audience (A14). It is also where every "resolve at the
    // Reckoning" obligation comes due at once, so it is the likeliest halt in the game.
    const result = runSim({
      ...DEFAULT_ARGS,
      seed: 'reckoning',
      ticks: TICKS_PER_RECKONING + 20,
      principals: 12,
    });
    expect(result.halted).toBe(false);
    expect(result.violations).toEqual([]);
  });
});

describe('the runtime holds the line no agent may cross', () => {
  it('never halts on an unaffordable venture — it refuses it', () => {
    // The ledger throws `LedgerError` on an overdraft, by design. A thrown error inside
    // a verb handler would escape the tick and PAUSE the world, which is a denial of
    // settlement any agent could trigger by asking for something expensive (AGT-X9).
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'poor' });
    runtime.seat('p:pauper' as never, 'pauper');
    // Drain the stake, so nothing can be escrowed.
    const stores = storesAccount('p:pauper' as never);
    const balance = runtime.ledger.balance(stores);
    runtime.ledger.retireCurrency({
      eventId: 'drain' as never,
      tick: 0,
      sink: 'sink:upkeep' as never,
      from: stores,
      amount: balance,
    });

    const submitted = runtime.engine.submit({
      principal: 'p:pauper' as never,
      verb: 'create',
      params: { kind: 'HAUL', value: 1_000_000 },
      clientSequence: 1,
      arrivalMs: 0,
      decisionSource: 'LIVE',
    });
    expect(submitted.ok).toBe(true);
    const report = runtime.runTick();
    expect(report.halted).toBe(false);
    expect(runtime.engine.status).toBe('RUNNING');
    // Refused on the merits, with the rule named, and nothing created.
    const refused = runtime.engine.log.forTick(report.tick).filter((e) => e.outcome === 'REFUSED');
    expect(refused).toHaveLength(1);
    expect(refused[0]?.rejection?.invariant).toBe('A7');
    expect(runtime.ventures.size).toBe(0);
  });

  it('never halts on hostile params for any live verb', () => {
    // A fuzz over the verb table rather than a list of cases: a case list has to be
    // remembered when a verb is added, and the thing being asserted is a property of
    // the whole surface.
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'fuzz' });
    runtime.seat('p:fuzzer' as never, 'fuzzer');
    const hostile: Readonly<Record<string, unknown>>[] = [
      {},
      { venture: 'nope', role: -1, hand: 'ghost' },
      { venture: 'nope', role: 999_999_999, hand: '' },
      { kind: 'NOT_A_KIND', value: -5 },
      { kind: 'HAUL', value: Number.MAX_SAFE_INTEGER },
      { kind: 'SIEGE', value: 0 },
      { text: 'x'.repeat(5_000) },
      { terms_hash: 'deadbeef', venture: 'nope' },
      // The election is agent-supplied and reaches the settlement set, so every shape
      // it can arrive in has to come back as a hint. A malformed one that got through
      // would be dropped silently at the freeze (PROP-V4's own default) and read on the
      // record as a payer that declined. Aimed at `elect` now that it has its own verb,
      // and still carrying `terms_hash` so the same rows also fuzz `sign` — which must
      // refuse an election rather than accept one, and must not throw doing it.
      { venture: 'nope', role: 0, terms_hash: 'deadbeef', election: 'IN_PART' },
      { venture: 'nope', role: 0, terms_hash: 'deadbeef', election: -1 },
      { venture: 'nope', role: 0, terms_hash: 'deadbeef', election: 1.5 },
      { venture: 'nope', role: 0, terms_hash: 'deadbeef', election: Number.MAX_VALUE },
      { venture: 'nope', role: 0, terms_hash: 'deadbeef', election: null },
      { venture: 'nope', role: 0, terms_hash: 'deadbeef', election: { pay: 'everything' } },
      { venture: 'nope', role: Number.NaN, election: 'IN_FULL' },
      { venture: 'nope', role: -1, election: 'IN_FULL' },
      { venture: 'nope', role: 1e308, election: 'IN_FULL' },
      { venture: 'nope', role: '0', election: 'IN_FULL' },
      { act: 'shout', venture: 'nope', text: 'y'.repeat(5_000) },
      { verb: '', target: '', measure: 'NOPE', outcome_low: 5, outcome_high: 1 },
      { intent: { verb: 'move', params: { hand: null } }, until_tick: -1 },
    ];
    let submissions = 0;
    for (const verb of runtime.liveVerbs) {
      for (const params of hostile) {
        const submitted = runtime.engine.submit({
          principal: 'p:fuzzer' as never,
          verb,
          params,
          clientSequence: submissions,
          arrivalMs: submissions,
          decisionSource: 'LIVE',
        });
        submissions += 1;
        void submitted;
      }
      const report = runtime.runTick();
      expect(report.halted, `${verb} halted the world`).toBe(false);
    }
    expect(runtime.engine.status).toBe('RUNNING');
    expect(submissions).toBeGreaterThan(20);
  });

  it('offers `seal` and `elect`, and every seal it offers names a verb this world records', () => {
    // ── The regression for two real defects, both now closed ────────────────
    //
    // 1. With `seal` registered and nothing resolving seals, twenty bots sealing through
    //    Reckoning 0 produced sixty INV-20 HALT violations at tick 287 and PAUSED the
    //    world. One free `seal` from one principal was enough (AGT-X9). The Reckoning
    //    driver now resolves every Reckoning's seals at its settlement tick.
    // 2. The affordance and the cast then both sealed `verb: 'sign'`, and this world
    //    records **no `sign` deed**. With the completeness witness working, such a seal
    //    resolves CONTRADICTED from an absence: a permanent public lie about an agent
    //    that copied the server's own affordance (A5′, scar #1). That is what kept the
    //    verb unregistered, and it is what this assertion now nails down.
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'no-seal' });
    expect(runtime.liveVerbs.has('seal')).toBe(true);
    expect(runtime.liveVerbs.has('elect')).toBe(true);
    // The handler stays exposed for the fixtures that drive it with their own context.
    expect(typeof runtime.sealHandler).toBe('function');
    // The one property that made registration safe: the only verb a seal may name is the
    // one the engine writes deeds under. `'sign'` is the spelling that was the trap.
    expect(DELIVERY_VERB).not.toBe('sign');
  });

  it('runs a full Reckoning with a cast that seals, and marks nobody from an absence', () => {
    // ── §7.6 and A5′ in one loop ────────────────────────────────────────────
    //
    // This used to assert `seals.size === 0`, which is what a world with the verb turned
    // off looks like. With it on, the assertion that matters is the opposite one: seals
    // are *made*, they are *judged*, and — because the affordance, the cast and PROP-D4's
    // compliance gate all read one `sealableRoles` — none of them is marked
    // CONTRADICTED, because every one of them was keepable when it was offered.
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'boundary' });
    const cast = new HeuristicCast(runtime, { size: 20 });
    cast.seat('boundary');
    for (let n = 0; n < TICKS_PER_RECKONING + 5; n += 1) {
      for (const action of cast.decide(runtime.engine.tick + 1, 'boundary')) {
        runtime.engine.submit(action);
      }
      const report = runtime.runTick();
      expect(report.violations, `violations at tick ${String(report.tick)}`).toEqual([]);
      expect(report.halted).toBe(false);
    }
    expect(runtime.seals.size).toBeGreaterThan(0);
    const summary = runtime.reckonings()[0];
    expect(summary?.sealsJudged).toBeGreaterThan(0);
    // A5′: not one mark against an agent that did what the server told it to.
    expect(summary?.sealsContradicted).toBe(0);
    expect(summary?.deedSetFaults).toBe(0);
    // And both halves of A7 were exercised in the same day, which is the evidence §7.6
    // is answerable rather than pre-answered.
    expect(summary?.electiveHonoured).toBeGreaterThan(0);
    expect(summary?.defaults).toBeGreaterThan(0);
  });
});

describe('default pricing is one arithmetic, shared with the affordance', () => {
  it('prices every kind so its own elective floor is satisfied (PROP-V5)', () => {
    // The number `create` charges and the number the affordance shows come from this
    // one function. A second copy in the observation layer would be the engine and the
    // agent-facing surface disagreeing about money.
    for (const kind of VENTURE_KINDS) {
      const spec = kindSpec(kind);
      const terms = defaultTerms(kind, spec.baseYieldMinor);
      expect(terms).toHaveLength(spec.roles.length);
      let shares = 0;
      for (const role of terms) {
        const consideration = role.escrowed + role.elective;
        expect(consideration).toBeGreaterThan(0);
        expect(role.elective).toBeGreaterThanOrEqual(electiveFloor(kind, minor(consideration)));
        expect(role.wage).toBeNull();
        shares += role.share ?? 0;
      }
      // The roles' shares can never exceed the residual there is to divide (INV-6).
      expect(shares).toBeLessThanOrEqual(10_000);
    }
  });

  it('leaves a top-yield kind entirely elective, because it is un-escrowable', () => {
    // PROP-V5: escrow strictly dominates for the buyer of a promise, so if the highest
    // prizes could be escrowed nobody would ever risk trust.
    for (const kind of VENTURE_KINDS) {
      const spec = kindSpec(kind);
      const terms = defaultTerms(kind, spec.baseYieldMinor);
      if (spec.electiveFloorBps === 10_000) {
        for (const role of terms) expect(role.escrowed).toBe(0);
      }
    }
  });

  it('resolves a venture at a settlement tick, never mid-day', () => {
    // A venture that resolved on an arbitrary tick would settle outside the Reckoning
    // that the whole show is built around (A14).
    for (const closes of [0, 1, 100, 286, 287, 288, 500]) {
      const resolves = nextSettlementAtOrAfter(closes);
      expect(resolves).toBeGreaterThanOrEqual(closes);
      expect((resolves + 1) % TICKS_PER_RECKONING).toBe(0);
    }
  });
});
