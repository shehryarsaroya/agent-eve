/**
 * The recap worker: exactly one email per follower per Reckoning, across kicks and restarts,
 * and a failure that is retried rather than fatal.
 *
 * Frames are written with the real `publishFrame`, into a temp directory, and read back the
 * way the worker reads them in production — off disk, as the files a spectator downloads.
 * The timer is injected, so a retry is a function the test calls rather than a wait.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishFrame } from '../../src/frames/write.js';
import {
  InMemoryFollowStore,
  MailError,
  RecapWorker,
  hashToken,
  unsubscribeTokenFor,
  type FollowStore,
  type RecapWorkerOptions,
} from '../../src/api/follow/index.js';
import { RECAP_CEILING_SHARE_BPS } from '../../src/api/limits.js';
import { RecordingMailer, TEST_SECRET, clockAt, frame, standing, type AdvanceableClock } from './helpers.js';

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'follow-worker-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Publish Reckoning `n` (and its predecessor, so the recap has a night to compare to). */
function publish(n: number, handles: readonly string[] = ['vale', 'orison']): void {
  const rows = (kept: number) => handles.map((h) => standing(h, { electiveHonoured: kept }));
  if (n > 0) publishFrame(dir, frame(n - 1, { standings: rows(n - 1) }));
  publishFrame(dir, frame(n, { standings: rows(n) }));
}

async function follower(store: InMemoryFollowStore, id: string, handle: string, email: string, lastSent: number | null = null): Promise<void> {
  await store.insertPending({
    id,
    handle,
    email,
    confirmTokenHash: hashToken(`c-${id}`),
    unsubscribeTokenHash: hashToken(unsubscribeTokenFor(TEST_SECRET, id)),
    nowMs: 1,
  });
  await store.activate(id, 2, lastSent);
}

interface Scheduled {
  run: () => void;
  ms: number;
  cancelled: boolean;
}

function worker(
  store: FollowStore,
  mailer: RecordingMailer,
  over: Partial<RecapWorkerOptions> = {},
  clock: AdvanceableClock = clockAt(),
): { w: RecapWorker; timers: Scheduled[]; logs: string[] } {
  const timers: Scheduled[] = [];
  const logs: string[] = [];
  const w = new RecapWorker({
    store,
    mailer,
    secret: TEST_SECRET,
    framesDir: dir,
    publicUrl: 'https://agenteve.io',
    clock,
    dailyCeiling: 2_000,
    log: (line) => logs.push(line),
    schedule: (run, ms) => {
      const t: Scheduled = { run, ms, cancelled: false };
      timers.push(t);
      return {
        cancel: () => {
          t.cancelled = true;
        },
      };
    },
    ...over,
  });
  return { w, timers, logs };
}

describe('exactly once', () => {
  it('one recap per ACTIVE follower for the latest Reckoning, and a second kick sends nothing', async () => {
    publish(3);
    const store = new InMemoryFollowStore();
    await follower(store, 'a', 'vale', 'one@example.com');
    await follower(store, 'b', 'vale', 'two@example.com');
    await follower(store, 'c', 'orison', 'three@example.com');
    const mailer = new RecordingMailer();
    const { w } = worker(store, mailer);
    w.kick();
    w.kick(); // while running: coalesced, not doubled
    await w.idle();
    expect(mailer.sent.map((m) => m.to).sort((x, y) => (x < y ? -1 : 1))).toEqual([
      'one@example.com',
      'three@example.com',
      'two@example.com',
    ]);
    for (const row of store.all()) expect(row.lastSentReckoning).toBe(3);
    w.kick();
    await w.idle();
    expect(mailer.sent).toHaveLength(3);
  });

  it('a restart — a NEW worker over the same store — re-sends nothing', async () => {
    publish(5);
    const store = new InMemoryFollowStore();
    await follower(store, 'a', 'vale', 'one@example.com');
    const mailer = new RecordingMailer();
    const first = worker(store, mailer).w;
    await first.run();
    await first.close();
    const second = worker(store, mailer).w;
    const report = await second.run();
    expect(report.sent).toBe(0);
    expect(mailer.sent).toHaveLength(1);
  });

  it('the next Reckoning is owed again, and a missed one is not backfilled', async () => {
    const store = new InMemoryFollowStore();
    await follower(store, 'a', 'vale', 'one@example.com', 1);
    const mailer = new RecordingMailer();
    const { w } = worker(store, mailer);
    publish(4); // the follower's mark is at 1: Reckonings 2 and 3 were missed
    await w.run();
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.subject).toContain('Reckoning 4');
    publish(5);
    await w.run();
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[1]?.subject).toContain('Reckoning 5');
  });

  it('a re-seeded world restarts the count, and a follower marked in the old one is owed tonight', async () => {
    // Follows outlive a season (the house cast keeps its names), and `reseed.sh` empties the world's
    // tables and frames but not these. A mark of 40 against a new world's Reckoning 2 must not mean
    // "already sent" for the next thirty-eight nights.
    publish(2);
    const store = new InMemoryFollowStore();
    await follower(store, 'a', 'vale', 'one@example.com', 40);
    const mailer = new RecordingMailer();
    await worker(store, mailer).w.run();
    expect(mailer.sent).toHaveLength(1);
    expect((await store.find('vale', 'one@example.com'))?.lastSentReckoning).toBe(2);
  });

  it('carries a provider idempotency key per (follow, Reckoning), so a crash between send and mark cannot double-send', async () => {
    publish(7);
    const store = new InMemoryFollowStore();
    await follower(store, 'abc', 'vale', 'one@example.com');
    const mailer = new RecordingMailer();
    await worker(store, mailer).w.run();
    expect(mailer.sent[0]?.idempotencyKey).toBe('recap-abc-r7');
  });

  it('sends nothing to a PENDING or UNSUBSCRIBED follow, and nothing for a follower who confirmed after tonight settled', async () => {
    publish(2);
    const store = new InMemoryFollowStore();
    await store.insertPending({ id: 'p', handle: 'vale', email: 'p@example.com', confirmTokenHash: 'x', unsubscribeTokenHash: 'y', nowMs: 1 });
    await follower(store, 'u', 'vale', 'u@example.com');
    await store.unsubscribe('u', 3);
    await follower(store, 'late', 'vale', 'late@example.com', 2);
    const mailer = new RecordingMailer();
    await worker(store, mailer).w.run();
    expect(mailer.sent).toHaveLength(0);
  });
});

describe('every recap carries a working one-click unsubscribe', () => {
  it('in the body and in the RFC 8058 headers, and the link resolves to the follow', async () => {
    publish(1);
    const store = new InMemoryFollowStore();
    await follower(store, 'f1', 'vale', 'one@example.com');
    const mailer = new RecordingMailer();
    await worker(store, mailer).w.run();
    const mail = mailer.sent[0];
    const token = unsubscribeTokenFor(TEST_SECRET, 'f1');
    const url = `https://agenteve.io/api/follow/unsubscribe?token=${token}`;
    expect(mail?.text).toContain(url);
    expect(mail?.headers?.['List-Unsubscribe']).toBe(`<${url}>`);
    expect(mail?.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect((await store.byUnsubscribeHash(hashToken(token)))?.id).toBe('f1');
    expect(mail?.text).toContain('https://agenteve.io/#/agent/vale');
  });

  it('a rotated secret re-stamps the stored hash BEFORE the email with the new link goes out', async () => {
    publish(1);
    const store = new InMemoryFollowStore();
    await follower(store, 'f1', 'vale', 'one@example.com');
    const rotated = `${TEST_SECRET}-rotated`;
    const mailer = new RecordingMailer();
    await worker(store, mailer, { secret: rotated }).w.run();
    const fresh = unsubscribeTokenFor(rotated, 'f1');
    expect(mailer.sent[0]?.text).toContain(fresh);
    expect((await store.byUnsubscribeHash(hashToken(fresh)))?.id).toBe('f1');
  });
});

describe('failure is logged and retried, never fatal', () => {
  it('a failed send leaves the mark, carries on with the next follower, and schedules a retry', async () => {
    publish(2);
    const store = new InMemoryFollowStore();
    await follower(store, 'a', 'vale', 'bad@example.com');
    await follower(store, 'b', 'vale', 'good@example.com');
    const mailer = new RecordingMailer();
    mailer.fail = (m) => (m.to === 'bad@example.com' ? new MailError('the provider answered 503', 503, { retryable: true }) : null);
    const { w, timers, logs } = worker(store, mailer);
    const report = await w.run();
    expect(report).toMatchObject({ sent: 1, failed: 1, end: 'done' });
    expect((await store.find('vale', 'bad@example.com'))?.lastSentReckoning).toBeNull();
    expect(timers.filter((t) => !t.cancelled)).toHaveLength(1);
    // The log names the follow's random id — never the address.
    expect(logs.join('\n')).toContain('follow a');
    expect(logs.join('\n')).not.toContain('bad@example.com');
    // The retry fires; the provider recovered.
    mailer.fail = () => null;
    timers[0]?.run();
    await w.idle();
    expect(mailer.to('bad@example.com')).toHaveLength(1);
  });

  it('a follower is tried at most three times per Reckoning', async () => {
    publish(2);
    const store = new InMemoryFollowStore();
    await follower(store, 'a', 'vale', 'bad@example.com');
    const mailer = new RecordingMailer();
    mailer.fail = () => new MailError('the provider answered 422', 422);
    const { w } = worker(store, mailer);
    for (let i = 0; i < 6; i += 1) await w.run();
    expect(mailer.attempts).toHaveLength(3);
  });

  it('a provider that refuses US (401) or rate-limits (429) stops the run early', async () => {
    for (const status of [401, 429]) {
      publish(2);
      const store = new InMemoryFollowStore();
      for (const id of ['a', 'b', 'c']) await follower(store, id, 'vale', `${id}@example.com`);
      const mailer = new RecordingMailer();
      mailer.fail = () => new MailError(`answered ${String(status)}`, status, { fatal: status === 401, retryable: status === 429 });
      const { w, timers } = worker(store, mailer);
      const report = await w.run();
      expect(report.end).toBe('provider');
      expect(mailer.attempts).toHaveLength(1);
      expect(timers.length).toBeGreaterThan(0);
    }
  });

  it('kick never throws into the tick loop, even when the store does', async () => {
    publish(2);
    const broken: FollowStore = new Proxy(new InMemoryFollowStore(), {
      get(target, prop, receiver) {
        if (prop === 'dueForRecap') return () => Promise.reject(new Error('connection refused'));
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    const mailer = new RecordingMailer();
    const { w, timers, logs } = worker(broken, mailer);
    expect(() => {
      w.kick();
    }).not.toThrow();
    await w.idle();
    expect(logs.join('\n')).toContain('will retry');
    expect(timers.length).toBeGreaterThan(0);
  });
});

describe('bounded', () => {
  it('recaps stop at their share of the daily ceiling, leaving room for confirmations, and resume tomorrow', async () => {
    publish(2);
    const store = new InMemoryFollowStore();
    for (let i = 0; i < 12; i += 1) await follower(store, `f${String(i).padStart(2, '0')}`, 'vale', `r${String(i)}@example.com`);
    const mailer = new RecordingMailer();
    const { w, timers } = worker(store, mailer, { dailyCeiling: 10 });
    const report = await w.run();
    const share = Math.floor((10 * RECAP_CEILING_SHARE_BPS) / 10_000);
    expect(report.end).toBe('ceiling');
    expect(mailer.sent).toHaveLength(share);
    expect(await store.mailReserved('2026-10-01')).toBe(share);
    // Scheduled for after UTC midnight: the harness clock is 12:00, so 12 hours and a margin.
    expect(timers.at(-1)?.ms).toBeGreaterThan(12 * 3600 * 1000);
  });

  it('a run sends at most maxPerRun, then yields to a continuation', async () => {
    publish(2);
    const store = new InMemoryFollowStore();
    for (let i = 0; i < 5; i += 1) await follower(store, `f${String(i)}`, 'vale', `r${String(i)}@example.com`);
    const mailer = new RecordingMailer();
    const { w, timers } = worker(store, mailer, { maxPerRun: 2, pageSize: 2 });
    const report = await w.run();
    expect(report).toMatchObject({ sent: 2, end: 'bound' });
    expect(timers.at(-1)?.ms).toBe(0);
    timers.at(-1)?.run();
    await w.idle();
    // …and so on, until every follower has tonight's recap exactly once.
    while (timers.some((t) => !t.cancelled && t.ms === 0) && mailer.sent.length < 5) {
      const next = timers.filter((t) => !t.cancelled && t.ms === 0).pop();
      if (next === undefined) break;
      next.cancelled = true;
      next.run();
      await w.idle();
    }
    expect(new Set(mailer.sent.map((m) => m.to)).size).toBe(5);
    expect(mailer.sent).toHaveLength(5);
  });
});

describe('what the worker refuses to do', () => {
  it('nothing without a frame, nothing with mail off, nothing about a handle that left the world', async () => {
    const store = new InMemoryFollowStore();
    await follower(store, 'a', 'vale', 'one@example.com');
    const mailer = new RecordingMailer();
    expect((await worker(store, mailer).w.run()).end).toBe('no-frame');
    publish(2);
    expect((await worker(store, mailer, { mailer: null }).w.run()).end).toBe('off');
    expect((await worker(store, mailer, { secret: null }).w.run()).end).toBe('off');
    expect((await worker(store, mailer, { framesDir: null }).w.run()).end).toBe('no-frame');
    const gone = await worker(store, mailer, { principalExists: () => false }).w.run();
    expect(gone).toMatchObject({ sent: 0, skipped: 1 });
    expect(mailer.sent).toHaveLength(0);
  });

  it('holds no runtime: its whole input is the follow store and the frames directory', () => {
    // Pinned in the type: this literal must list EVERY option (tsc refuses a missing or an
    // extra key), so a runtime, engine or journal handle cannot be added without this failing.
    const sample: Record<keyof RecapWorkerOptions, true> = {
      store: true, mailer: true, secret: true, framesDir: true, publicUrl: true, clock: true, dailyCeiling: true,
      principalExists: true, log: true, pageSize: true, maxPerRun: true, maxAttempts: true, retryMs: true, schedule: true,
    };
    expect(Object.keys(sample).filter((k) => /runtime|engine|journal|ledger|world/i.test(k))).toEqual([]);
  });
});
