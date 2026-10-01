/**
 * ★ FOLLOWS ARE NOT PART OF THE WORLD — and the record says so, tick by tick.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A5 makes the world's record permanent and public; an email address must be private and
 * deletable. The two can only coexist if nothing about a follow ever reaches the record — not
 * the journal, not the event ledger, not a snapshot, not `state_hash`, not replay.
 *
 * Two kinds of proof, because either alone can be fooled:
 *
 *   1. **Behavioural.** The same seed and cast are run twice through a settled Reckoning: once
 *      with the feature doing everything it does — a follow request, a confirmation, a click,
 *      a published frame, a recap run, an unsubscribe — between ticks, exactly where the live
 *      server does it; once with no follow at all. Every tick's `state_hash` must match.
 *   2. **Structural.** No module that writes or replays the record imports the follow module;
 *      the journal's SQL never names a follow table; the follow tables are in neither
 *      append-only list and are not partitioned.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TICKS_PER_RECKONING, setSpeed } from '../../src/core/time.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { publishFrame } from '../../src/frames/write.js';
import { extractTick } from '../../src/persist/extract.js';
import { RecapWorker, FollowService, InMemoryFollowStore, followWorldOf } from '../../src/api/follow/index.js';
import { APPEND_ONLY_UNPARTITIONED, PRIVATE_DELETABLE_TABLES, SCHEMA_MIGRATIONS } from '../../src/db/migrate.js';
import { RateLimiter } from '../../src/api/limits.js';
import { LOOSE_FOLLOW_LIMITS, RecordingMailer, TEST_SECRET, clockAt, linkIn, tokenOf } from './helpers.js';

const SEED = 'follow-record-untouched';
const TICKS = TICKS_PER_RECKONING + 12;

interface Run {
  /** Every tick's `state_hash`. */
  readonly hashes: readonly string[];
  /** Every tick's DURABLE rows — events, postings, actions, seed — exactly as the journal writes them. */
  readonly journal: readonly string[];
}

/** One run of the world, with `between` called after each committed tick. */
async function run(between: (runtime: Runtime, tick: number, settled: boolean) => Promise<void>): Promise<Run> {
  setSpeed('instant');
  const runtime = new Runtime({ seed: SEED });
  const cast = new HeuristicCast(runtime, { size: 4 });
  cast.seat(SEED);
  const hashes: string[] = [];
  const journal: string[] = [];
  for (let i = 0; i < TICKS; i += 1) {
    for (const action of cast.decide(runtime.engine.tick + 1, SEED)) runtime.engine.submit(action);
    const report = runtime.runTick();
    hashes.push(report.stateHash);
    // What the journal would persist for this tick — the record replay reads back.
    journal.push(JSON.stringify(extractTick(runtime, report)));
    await between(runtime, report.tick, report.clock.isSettlementTick);
  }
  return { hashes, journal };
}

describe('★ behavioural: the world is byte-identical with follows on and off', () => {
  it('every tick’s state_hash and journal rows match across a follow, a confirmation, a recap and an unsubscribe', async () => {
    const plain = await run(() => Promise.resolve());

    const dir = mkdtempSync(join(tmpdir(), 'follow-untouched-'));
    const store = new InMemoryFollowStore();
    const mailer = new RecordingMailer();
    const clock = clockAt();
    let worker: RecapWorker | null = null;
    let service: FollowService | null = null;
    let handle = '';
    try {
      const followed = await run(async (runtime, tick, settled) => {
        if (service === null) {
          handle = String(runtime.world.principalOrder[0] ?? '').replace(/^p:/, '');
          service = new FollowService({
            store, mailer, offReason: null, secret: TEST_SECRET, clock, publicUrl: 'https://agenteve.io',
            dailyCeiling: 100, maxActivePerEmail: 10, limiter: new RateLimiter(LOOSE_FOLLOW_LIMITS), log: () => undefined,
          });
          worker = new RecapWorker({
            store, mailer, secret: TEST_SECRET, framesDir: dir, publicUrl: 'https://agenteve.io', clock,
            dailyCeiling: 100, principalExists: followWorldOf(runtime).principalExists, log: () => undefined,
            schedule: () => ({ cancel: () => undefined }),
          });
        }
        // Between ticks, as the live server's HTTP handlers run: request, then click.
        if (tick === 3) {
          expect(service.request(handle, 'watcher@example.com')).toBe(true);
          await service.idle();
          const outcome = await service.confirm(tokenOf(linkIn(mailer.sent[0], 'confirm')), followWorldOf(runtime).latestSettledReckoning());
          expect(outcome.kind).toBe('confirmed');
        }
        // At the settlement: publish the frame and run the recaps, exactly as serve() does.
        if (settled && worker !== null) {
          const frame = runtime.reckoningFrame();
          if (frame !== null) publishFrame(dir, frame);
          worker.kick();
          await worker.idle();
        }
        if (tick === TICKS_PER_RECKONING + 5) {
          const row = await store.find(handle, 'watcher@example.com');
          if (row !== null) await store.unsubscribe(row.id, clock.nowMs());
        }
      });
      // Not vacuous: the feature really ran — a confirmation and a recap went out.
      expect(mailer.sent.map((m) => m.subject)).toEqual([
        `Confirm: follow ${handle} on Agent Eve`,
        expect.stringContaining('Reckoning 0') as unknown as string,
      ]);
      expect(followed.hashes).toHaveLength(TICKS);
      expect(followed.hashes).toEqual(plain.hashes);
      // And the journal — the event ledger, the postings, the action log — row for row: the
      // record that replay reads back is the same bytes with followers and without them.
      expect(followed.journal).toEqual(plain.journal);
      expect(followed.journal.join('')).not.toMatch(/watcher@example\.com|follow_subscription/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 600_000);
});

// ── Structural ──────────────────────────────────────────────────────────────

const SRC = new URL('../../src/', import.meta.url).pathname;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('★ structural: nothing that writes or replays the record can reach a follow', () => {
  it('no record module imports the follow module', () => {
    const RECORD = ['persist', 'sim', 'tick', 'frames', 'ledger', 'events', 'world', 'reckoning', 'venture', 'invariants', 'cast'];
    const offenders: string[] = [];
    for (const area of RECORD) {
      for (const file of files(join(SRC, area))) {
        const text = readFileSync(file, 'utf8');
        if (/from\s+['"][^'"]*api\/follow/.test(text) || /follow_subscription|follow_mail_day/.test(text)) {
          offenders.push(file.slice(file.indexOf('/src/')));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the follow module never imports the journal, and never holds a Runtime', () => {
    for (const file of files(join(SRC, 'api/follow'))) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/from\s+['"][^'"]*persist\//);
      expect(text, file).not.toMatch(/from\s+['"][^'"]*sim\/runtime/);
      expect(text, file).not.toMatch(/\bJournal\b/);
    }
  });

  it('the follow tables are in neither append-only list — an unsubscribe is an UPDATE, an erasure a DELETE', () => {
    const migrate = readFileSync(join(SRC, 'db/migrate.ts'), 'utf8');
    const lists = ['PARTITIONED_TABLES', 'APPEND_ONLY_TABLES'].map((name) => {
      const m = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(migrate);
      if (m === null) throw new Error(`${name} not found in migrate.ts — this guard cannot run`);
      return m[1] ?? '';
    });
    for (const table of PRIVATE_DELETABLE_TABLES) {
      expect(APPEND_ONLY_UNPARTITIONED as readonly string[]).not.toContain(table);
      for (const list of lists) expect(list).not.toContain(table);
    }
    expect(SCHEMA_MIGRATIONS.map(([v]) => v)).toEqual([1, 2]);
  });

  it('schema.sql declares them unpartitioned, with every column the design names', () => {
    const schema = readFileSync(join(SRC, 'db/schema.sql'), 'utf8');
    const table = /CREATE TABLE IF NOT EXISTS follow_subscription \(([\s\S]*?)\n\);/.exec(schema)?.[1] ?? '';
    for (const column of [
      'handle', 'email', 'status', 'confirm_token_hash', 'unsubscribe_token_hash', 'created_ms', 'confirmed_ms', 'last_sent_reckoning',
    ]) {
      expect(table, column).toMatch(new RegExp(`\\n\\s*${column}\\s`));
    }
    expect(table).toContain("status IN ('PENDING', 'ACTIVE', 'UNSUBSCRIBED')");
    // No plaintext token column: only hashes are stored.
    expect(table).not.toMatch(/\n\s*(confirm_token|unsubscribe_token)\s+text/);
    expect(schema).not.toMatch(/follow_subscription[\s\S]{0,2000}PARTITION BY/);
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS follow_mail_day');
  });

  it('the journal’s Postgres store never names a follow table', () => {
    const journal = readFileSync(join(SRC, 'persist/postgres.ts'), 'utf8');
    expect(journal).not.toMatch(/follow_/);
  });
});
