/**
 * ★ A SEAT IS KEPT BY PLAY, NOT BY BEING SEEN — and minting seats is bounded per address per day.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `authenticate` called `seats.touch` on every signed request, and `touch` WAS the idleness clock.
 * So one signed `GET /observe` every four Reckonings held a seat forever, while enrolment is free
 * (eight per ten minutes per address) and the world seats 300. A squatter needed a key and a cheap
 * ping per seat; the newcomer it turned away got a 503 that said the cap was "never on who may
 * play" from a world serving nobody who played.
 *
 * Now the clock is the last tick an action of the principal's was ACCEPTED (`outcome.accepted`, any
 * verb). Four Reckonings from that, unchanged; ONE Reckoning for a seat never played since it was
 * taken. Observing still re-seats a dormant principal when there is room. And six identities per
 * address per day, charged only when one is actually minted.
 *
 * Seats are host resources: no tick, posting or `state_hash` reads the book (see `seats.ts`), so the
 * last block below also proves the record is untouched — boot rebuilds the clock from the journal's
 * action log and reproduces the head hash.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING, isSpeedName, setSpeed } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import {
  ENROLMENT_QUOTA,
  IDLE_SEAT_TICKS,
  SeatBook,
  UNPLAYED_SEAT_TICKS,
} from '../../src/api/index.js';
import { DEFAULT_SPEED, serve } from '../../src/api/server.js';
import { Runtime } from '../../src/sim/runtime.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { InMemoryJournalStore, Journal, bootFromStore } from '../../src/persist/index.js';
import { generateKeypair } from '../../src/identity/index.js';
import { PATHS, agent, enrol, harness, raw, signed, tick, type Agent, type Harness } from './harness.js';

const P = (s: string): PrincipalId => `p:${s}` as PrincipalId;

describe('the lease arithmetic (SeatBook)', () => {
  it('the published leases are four Reckonings and one', () => {
    expect(IDLE_SEAT_TICKS).toBe(TICKS_PER_RECKONING * 4);
    expect(UNPLAYED_SEAT_TICKS).toBe(TICKS_PER_RECKONING);
  });

  it('★ observing alone no longer keeps a seat', () => {
    const book = new SeatBook(4);
    expect(book.claim(P('lurk'), 'lurk', 0).ok).toBe(true);
    // Seen on every tick for two Reckonings — the shape that used to hold a seat forever.
    for (let t = 0; t < UNPLAYED_SEAT_TICKS; t += 1) book.touch(P('lurk'), t);
    expect(book.seatOf(P('lurk'))?.lastSeenTick, 'non-vacuity: it really was seen').toBe(UNPLAYED_SEAT_TICKS - 1);
    expect(book.recycleIdle(UNPLAYED_SEAT_TICKS)).toEqual([P('lurk')]);
    expect(book.isSeated(P('lurk'))).toBe(false);
  });

  it('a seat never played is recycled ONE Reckoning after it was taken, not before', () => {
    const book = new SeatBook(4);
    book.claim(P('new'), 'new', 10);
    expect(book.recycleIdle(10 + UNPLAYED_SEAT_TICKS - 1)).toEqual([]);
    expect(book.unplayed).toBe(1);
    expect(book.recycleIdle(10 + UNPLAYED_SEAT_TICKS)).toEqual([P('new')]);
  });

  it('an accepted action holds the seat for four Reckonings from that action', () => {
    const book = new SeatBook(4);
    book.claim(P('play'), 'play', 0);
    book.recordAccepted(P('play'), 100);
    expect(book.unplayed).toBe(0);
    expect(book.recyclableAt(book.seatOf(P('play')) as never)).toBe(100 + IDLE_SEAT_TICKS);
    expect(book.recycleIdle(100 + IDLE_SEAT_TICKS - 1)).toEqual([]);
    // An older tick never rewinds the clock.
    book.recordAccepted(P('play'), 50);
    expect(book.seatOf(P('play'))?.lastAcceptedTick).toBe(100);
    expect(book.recycleIdle(100 + IDLE_SEAT_TICKS)).toEqual([P('play')]);
  });

  it('a returning principal starts on the short lease, whatever it did before', () => {
    const book = new SeatBook(4);
    book.claim(P('back'), 'back', 0);
    book.recordAccepted(P('back'), 5);
    expect(book.recycleIdle(5 + IDLE_SEAT_TICKS)).toEqual([P('back')]);
    const at = 5 + IDLE_SEAT_TICKS + 40;
    expect(book.claim(P('back'), 'back', at).ok, 'a dormant principal is re-seated when there is room').toBe(true);
    expect(book.recyclableAt(book.seatOf(P('back')) as never)).toBe(at + UNPLAYED_SEAT_TICKS);
    book.recordAccepted(P('back'), at + 1);
    expect(book.recyclableAt(book.seatOf(P('back')) as never)).toBe(at + 1 + IDLE_SEAT_TICKS);
  });

  it('a standing intent’s own run is not play; a submitted action is', () => {
    const book = new SeatBook(4);
    book.claim(P('ord'), 'ord', 0);
    book.recordAcceptedRows([{ principal: P('ord'), tick: 30, arrivalOrdinal: null }]);
    expect(book.seatOf(P('ord'))?.lastAcceptedTick).toBeNull();
    book.recordAcceptedRows([{ principal: P('ord'), tick: 31, arrivalOrdinal: 0 }]);
    expect(book.seatOf(P('ord'))?.lastAcceptedTick).toBe(31);
  });

  it('a boot never sweeps while it rebuilds, and a restart leases every occupied seat from the boot tick', () => {
    const book = new SeatBook(4);
    book.restore(P('a'), 'a', 0);
    // By the policy `a` is recyclable from tick 288 — and `restore` must not act on that.
    book.restore(P('b'), 'b', 600);
    expect(book.isSeated(P('a')), 'restore swept a seat it was still rebuilding the clock for').toBe(true);
    book.recordAccepted(P('b'), 610);
    book.afterRestart(2_000, 0);
    expect(book.recyclableAt(book.seatOf(P('a')) as never)).toBe(2_000 + UNPLAYED_SEAT_TICKS);
    expect(book.recyclableAt(book.seatOf(P('b')) as never)).toBe(2_000 + UNPLAYED_SEAT_TICKS);
    expect(book.recycleIdle(2_000 + UNPLAYED_SEAT_TICKS - 1), 'no eviction inside a Reckoning of a restart').toEqual([]);
  });

  it('a seat whose history a checkpoint skipped is credited with the boot tick, not judged unplayed', () => {
    const book = new SeatBook(4);
    book.restore(P('old'), 'old', 100);
    book.restore(P('new'), 'new', 900);
    // The replay re-read only ticks 800 onward; `old` may well have played before that.
    book.afterRestart(1_000, 800);
    expect(book.seatOf(P('old'))?.lastAcceptedTick).toBe(1_000);
    expect(book.seatOf(P('new'))?.lastAcceptedTick, 'a seat the replay saw whole is judged as seen').toBeNull();
  });
});

describe('over HTTP: the squatter gives the seat back, the player keeps it', () => {
  let h: Harness;
  afterEach(async () => {
    await h.close();
  });

  async function claimSomething(who: Agent, text: string): Promise<void> {
    const res = await signed(h, who, 'POST', PATHS.act, { actions: [{ verb: 'claim', params: { text }, clientSequence: 1 }] });
    expect(res.status).toBe(200);
    const accepted = (res.json['outcome'] as Record<string, unknown>)['accepted'] as unknown[];
    expect(accepted.length, 'non-vacuity: the act must be accepted').toBe(1);
  }

  it('★ a principal that only observes loses its seat to a newcomer; one that acts does not', async () => {
    h = await harness({ seats: 2 });
    const squatter = agent('squat');
    const player = agent('player');
    expect((await enrol(h, squatter)).status).toBe(201);
    expect((await enrol(h, player)).status).toBe(201);
    tick(h, 1);
    await claimSomething(player, 'I am here to play');

    // A full Reckoning, the squatter pinging the whole time.
    for (let i = 0; i < UNPLAYED_SEAT_TICKS; i += 1) {
      if (i % 6 === 0) expect((await signed(h, squatter, 'GET', PATHS.observe)).status).toBe(200);
      tick(h, 1);
    }
    expect(h.context.seats.seatOf(squatter.principalId as never)?.lastSeenTick, 'non-vacuity').toBeGreaterThan(UNPLAYED_SEAT_TICKS / 2);

    const newcomer = agent('newcomer');
    const res = await enrol(h, newcomer);
    expect(res.status, `the newcomer was turned away: ${res.text.slice(0, 300)}`).toBe(201);
    expect(h.context.seats.isSeated(squatter.principalId as never), 'the squatter kept a seat by observing').toBe(false);
    expect(h.context.seats.isSeated(player.principalId as never), 'the player lost a seat it was playing').toBe(true);

    // The squatter's identity is untouched (A10) — only the seat went, and the world is full now.
    expect(h.runtime.world.holdingByPrincipal.has(squatter.principalId as never)).toBe(true);
    const back = await signed(h, squatter, 'GET', PATHS.observe);
    expect(back.status).toBe(503);
    expect(back.json['reason']).toBe('SEATS_FULL');
    expect(String(back.json['detail'])).toContain('kept by play');
  });

  it('a dormant principal is still re-seated by an authenticated request when there is room', async () => {
    h = await harness({ seats: 3 });
    const sleeper = agent('sleeper');
    expect((await enrol(h, sleeper)).status).toBe(201);
    tick(h, UNPLAYED_SEAT_TICKS + 1);
    // Somebody enrolling sweeps the expired lease.
    expect((await enrol(h, agent('sweeper'))).status).toBe(201);
    expect(h.context.seats.isSeated(sleeper.principalId as never)).toBe(false);
    expect((await signed(h, sleeper, 'GET', PATHS.observe)).status).toBe(200);
    expect(h.context.seats.isSeated(sleeper.principalId as never)).toBe(true);
    expect(h.context.seats.seatOf(sleeper.principalId as never)?.occupiedSinceTick).toBe(h.runtime.engine.tick + 1);
  });

  it('the health report tells a squatted world from a full one', async () => {
    h = await harness({ seats: 4 });
    const a = agent('hp-a');
    const b = agent('hp-b');
    for (const x of [a, b]) expect((await enrol(h, x)).status).toBe(201);
    tick(h, 1);
    await claimSomething(a, 'present');
    const health = await raw(h, 'GET', PATHS.health);
    const seats = (health.json['report'] as Record<string, unknown>)['seats'] as Record<string, unknown>;
    expect(seats['occupied']).toBe(2);
    expect(seats['unplayed']).toBe(1);
    expect(seats['recycle_after_ticks']).toEqual({ played: IDLE_SEAT_TICKS, unplayed: UNPLAYED_SEAT_TICKS });
  });
});

describe('over HTTP: six identities per address per day', () => {
  let h: Harness;
  afterEach(async () => {
    await h.close();
  });

  it('★ the seventh enrolment from one address in a day is refused, with a Retry-After', async () => {
    h = await harness({ seats: 64, quota: ENROLMENT_QUOTA });
    expect(ENROLMENT_QUOTA).toEqual({ burst: 6, windowSeconds: 86_400 });
    for (let i = 0; i < ENROLMENT_QUOTA.burst; i += 1) {
      expect((await enrol(h, agent(`q-${String(i)}`))).status).toBe(201);
    }
    const seventh = await enrol(h, agent('q-seventh'));
    expect(seventh.status).toBe(429);
    expect(seventh.json['reason']).toBe('RATE_LIMITED');
    expect(String(seventh.json['detail'])).toContain('Only identities actually minted count');
    expect(h.runtime.world.holdingByPrincipal.has('p:q-seventh' as never), 'a refused enrolment minted something').toBe(false);
    expect(h.context.seats.rows).toBe(ENROLMENT_QUOTA.burst);

    // A day later the address may mint again.
    h.clock.advance(ENROLMENT_QUOTA.windowSeconds * 1000);
    expect((await enrol(h, agent('q-tomorrow'))).status).toBe(201);
  });

  it('a refused handle costs no part of the quota', async () => {
    h = await harness({ seats: 64, quota: { burst: 2, windowSeconds: 86_400 } });
    expect((await enrol(h, agent('taken'))).status).toBe(201);
    // Three collisions: enumeration is charged against the burst, never against the day.
    for (let i = 0; i < 3; i += 1) expect((await enrol(h, agent('taken'))).status).toBe(409);
    expect((await enrol(h, agent('second'))).status, 'collisions spent the daily quota').toBe(201);
    expect((await enrol(h, agent('third'))).status).toBe(429);
  });
});

describe('a restart rebuilds the clock from the record, and the record does not move', () => {
  const SEED = 'seats-rebuilt';
  const CAST = 3;

  beforeAll(() => {
    const requested = (process.env['COMPACT_SPEED'] ?? DEFAULT_SPEED).trim();
    if (isSpeedName(requested)) setSpeed(requested);
  });
  afterAll(() => {
    setSpeed('instant');
  });

  it('★ the player’s last accepted action survives a reboot, the lurker gets a lease from the boot tick', async () => {
    const runtime = new Runtime({ seed: SEED });
    const cast = new HeuristicCast(runtime, { size: CAST });
    cast.seat(SEED);
    const store = new InMemoryJournalStore();
    const journal = new Journal(store);
    await bootFromStore(runtime, store, { seed: SEED });
    const run = (n: number): void => {
      for (let i = 0; i < n; i += 1) {
        for (const a of cast.decide(runtime.engine.tick + 1, SEED)) runtime.engine.submit(a);
        journal.record(runtime, runtime.runTick());
      }
    };

    run(5);
    // Two outsiders enrol exactly as the enrol route does it: world seat, then the journal row.
    for (const handle of ['player', 'lurker']) {
      const at = runtime.engine.tick + 1;
      runtime.seat(P(handle), handle);
      journal.recordEnrollment({
        principal: P(handle),
        handle,
        publicKey: generateKeypair().record.publicKeyJwk.x,
        enrolledAtTick: at,
        ownerEmail: null,
      });
    }
    run(3);
    const submitted = runtime.engine.submit({
      principal: P('player'),
      verb: 'claim',
      params: { text: 'still playing' },
      clientSequence: 1,
      arrivalMs: 0,
      decisionSource: 'LIVE',
    });
    expect(submitted.ok, 'non-vacuity: the action must be accepted').toBe(true);
    const actedAt = submitted.ok ? submitted.value.targetTick : -1;
    run(10);
    await journal.drain();
    const headTick = runtime.engine.tick;
    const headHash = runtime.engine.stateHash;

    const world = await serve({
      port: 0,
      host: '127.0.0.1',
      seed: SEED,
      trustEdge: false,
      castSize: CAST,
      framesDir: null,
      store,
      disableCheckpointAdoption: true,
    });
    try {
      expect(world.boot.status).toBe('READY');
      const context = world.created?.context;
      expect(context).toBeDefined();
      if (context === undefined) return;
      // The record is untouched: the rebuilt world is the world that was journalled.
      expect(context.runtime.engine.tick).toBe(headTick);
      expect(context.runtime.engine.stateHash).toBe(headHash);

      const bootTick = headTick + 1;
      const player = context.seats.seatOf(P('player'));
      const lurker = context.seats.seatOf(P('lurker'));
      expect(player?.lastAcceptedTick, 'derived from the replayed action log').toBe(actedAt);
      expect(lurker?.lastAcceptedTick, 'it never acted, and the replay saw its whole history').toBeNull();
      for (const seat of [player, lurker]) {
        expect(seat?.occupied, 'a restart evicted a seat').toBe(true);
        expect(seat?.occupiedSinceTick).toBe(bootTick);
      }
      expect(context.seats.recycleIdle(bootTick + UNPLAYED_SEAT_TICKS - 1)).toEqual([]);
    } finally {
      await world.close();
    }
  }, 120_000);
});

describe('agent.md says what the engine does (scar #1)', () => {
  const AGENT_MD = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

  it('the seat paragraph states both leases in Reckonings, and that observing does not hold one', () => {
    const offline = AGENT_MD.slice(AGENT_MD.indexOf('## 9. Being offline'), AGENT_MD.indexOf('## 10. Granting authority'));
    expect(offline).toContain('**A seat is kept by play, not by being seen:**');
    expect(offline).toContain(`**${String(words[IDLE_SEAT_TICKS / TICKS_PER_RECKONING])} Reckonings after the last tick an`);
    expect(offline).toContain(`after **${String(words[UNPLAYED_SEAT_TICKS / TICKS_PER_RECKONING])} Reckoning**`);
    expect(offline).toContain('Observing alone does not hold one.');
  });

  it('§2 states the daily quota at the engine’s number', () => {
    const enrolling = AGENT_MD.slice(AGENT_MD.indexOf('## 2. Enrolling'), AGENT_MD.indexOf('## 3. What you have'));
    expect(enrolling).toContain(`**mint at most ${String(words[ENROLMENT_QUOTA.burst])} identities a day**`);
    expect(ENROLMENT_QUOTA.windowSeconds).toBe(24 * 3600);
  });
});
