/**
 * THE CRASH LOOP, AND ITS REPLACEMENT.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `serve()` awaited `bootFromStore`. A boot that could not reproduce the record
 * threw, the top-level await rejected, the process exited, `Restart=always` restarted
 * it, and it failed identically — forever, re-reading the whole action log from
 * Postgres each time, with no HTTP surface at all. An operator watching the box saw a
 * service flapping and a port refusing connections; nothing anywhere said which tick,
 * or why.
 *
 * Refusing to serve a world you cannot reproduce is CORRECT (A5′). Exiting is not.
 * This file proves the replacement: the socket is bound first, the process stays up,
 * and every route answers **503 with the diagnosis** — including `/health`, because a
 * 200 anywhere would let a monitor call a held world healthy.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serve, API_BASE_PATH } from '../../src/api/server.js';
import { Runtime } from '../../src/sim/runtime.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed } from '../../src/core/time.js';
import { InMemoryJournalStore, Journal, bootFromStore } from '../../src/persist/index.js';

const SEED = 'serve-held-1';
const CAST = 4;
const HOST = '127.0.0.1';

beforeAll(() => {
  // `serve()` sets this itself; the fixture journal must be written under the same
  // scale, or a divergence could come from the clock rather than from the record.
  setSpeed('fast');
});
afterAll(() => {
  setSpeed('instant');
});

/** A journal several ticks deep, written exactly as `serve()` would write it. */
async function fixture(ticks: number): Promise<InMemoryJournalStore> {
  const runtime = new Runtime({ seed: SEED });
  const cast = new HeuristicCast(runtime, { size: CAST });
  cast.seat(SEED);
  const store = new InMemoryJournalStore();
  const journal = new Journal(store);
  await bootFromStore(runtime, store, { seed: SEED });
  for (let i = 0; i < ticks; i += 1) {
    for (const action of cast.decide(runtime.engine.tick + 1, SEED)) runtime.engine.submit(action);
    const report = runtime.runTick();
    journal.record(runtime, report);
    await journal.flushPending();
  }
  await journal.drain();
  return store;
}

describe('serve() holds instead of crash-looping', () => {
  it('resolves, binds the port, and answers 503 with the tick and the instruction', async () => {
    const store = await fixture(320);
    const snaps = await store.snapshots();
    const target = snaps[0];
    expect(target).toBeDefined();
    if (target === undefined) throw new Error('the fixture crossed no Reckoning');

    // A record this build cannot reproduce: one journalled snapshot hash is not what
    // replay will produce. (The live-world equivalent is a code change that moves
    // any past tick's arithmetic.)
    const corrupted = new InMemoryJournalStore();
    await corrupted.init(SEED);
    for (const t of await store.ticksSince(-1)) await corrupted.appendTick(t);
    for (const s of snaps) {
      await corrupted.writeSnapshot(s.tick === target.tick ? { ...s, stateHash: 'a'.repeat(64) } : s);
    }

    // THE HEADLINE: this does not reject, and the process is still here afterwards.
    const started = await serve({
      // 0 asks the OS for a free port: a hard-coded one inherits a stale listener
      // from a crashed run and the test then measures the wrong server.
      port: 0,
      host: HOST,
      seed: SEED,
      trustEdge: false,
      castSize: CAST,
      framesDir: null,
      store: corrupted,
    });
    try {
      expect(started.created).toBeNull();
      expect(started.boot.status).toBe('HELD');
      if (started.boot.status !== 'HELD') throw new Error('unreachable');
      expect(started.boot.diagnosis.kind).toBe('STATE_HASH_MISMATCH');
      expect(started.boot.diagnosis.tick).toBe(target.tick);

      // Every route, including health, is 503 — a held world is genuinely unavailable.
      for (const path of [`${API_BASE_PATH}/health`, `${API_BASE_PATH}/observe`, '/']) {
        const res = await fetch(`http://${HOST}:${String(started.port)}${path}`);
        expect(res.status).toBe(503);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body['world']).toBe('HELD');
        expect(body['failure']).toBe('STATE_HASH_MISMATCH');
        expect(body['tick']).toBe(target.tick);
        expect(body['expected_state_hash']).toBe('a'.repeat(64));
        expect(body['operator_instruction']).toBe(
          `COMPACT_ACCEPT_DIVERGENCE_AT_TICK=${String(target.tick)}`,
        );
        expect(String(body['detail'])).toContain('THE WORLD IS HELD');
      }

      // And it wrote nothing: holding is not accepting.
      expect((await corrupted.divergences()).length).toBe(0);
    } finally {
      await started.close();
    }
  }, 180_000);

  it('the operator door lets the same journal come up, and says so in the record', async () => {
    const store = await fixture(320);
    const snaps = await store.snapshots();
    const target = snaps[0];
    if (target === undefined) throw new Error('the fixture crossed no Reckoning');

    const corrupted = new InMemoryJournalStore();
    await corrupted.init(SEED);
    for (const t of await store.ticksSince(-1)) await corrupted.appendTick(t);
    for (const s of snaps) {
      await corrupted.writeSnapshot(s.tick === target.tick ? { ...s, stateHash: 'b'.repeat(64) } : s);
    }

    const started = await serve({
      // 0 asks the OS for a free port: a hard-coded one inherits a stale listener
      // from a crashed run and the test then measures the wrong server.
      port: 0,
      host: HOST,
      seed: SEED,
      trustEdge: false,
      castSize: CAST,
      framesDir: null,
      store: corrupted,
      acceptDivergenceFromTick: target.tick,
    });
    try {
      expect(started.boot.status).toBe('READY');
      expect(started.created).not.toBeNull();

      // Not the status code: the app's own /health legitimately 503s right after a
      // restart (the deciding-share floor, scar #14b). What must be true is that this
      // is the WORLD's health endpoint answering, not the held gate's placeholder.
      const res = await fetch(`http://${HOST}:${String(started.port)}${API_BASE_PATH}/health`);
      const body = (await res.json()) as { readonly report?: Record<string, unknown> } & Record<string, unknown>;
      // The world's own health nests under `report`; the held gate's placeholder does
      // not. Reading the nested field is what distinguishes the two answers.
      expect(body['world']).not.toBe('HELD');
      expect(body.report?.['world']).toBe('RUNNING');

      const rows = await corrupted.divergences();
      expect(rows.length).toBe(1);
      expect(rows[0]?.tick).toBe(target.tick);
      expect(rows[0]?.kind).toBe('STATE_HASH_MISMATCH');
      expect(rows[0]?.detail).toContain('rules change accepted by operator');
    } finally {
      await started.close();
    }
  }, 180_000);

  it('a reproducible journal comes up served, not held', async () => {
    const store = await fixture(40);
    const started = await serve({
      // 0 asks the OS for a free port: a hard-coded one inherits a stale listener
      // from a crashed run and the test then measures the wrong server.
      port: 0,
      host: HOST,
      seed: SEED,
      trustEdge: false,
      castSize: CAST,
      framesDir: null,
      store,
    });
    try {
      expect(started.boot.status).toBe('READY');
      expect(started.created).not.toBeNull();
      // Not the status code: the app's own /health legitimately 503s right after a
      // restart (the deciding-share floor, scar #14b). What must be true is that this
      // is the WORLD's health endpoint answering, not the held gate's placeholder.
      const res = await fetch(`http://${HOST}:${String(started.port)}${API_BASE_PATH}/health`);
      const body = (await res.json()) as { readonly report?: Record<string, unknown> } & Record<string, unknown>;
      // The world's own health nests under `report`; the held gate's placeholder does
      // not. Reading the nested field is what distinguishes the two answers.
      expect(body['world']).not.toBe('HELD');
      expect(body.report?.['world']).toBe('RUNNING');
    } finally {
      await started.close();
    }
  }, 120_000);
});
