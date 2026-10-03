/**
 * The hosted-key store's SQL, checked without a database — the way `test/persist/postgres-sql.test.ts`
 * and `test/follow/store.test.ts` check theirs: a recording pool, every placeholder matched to an
 * argument, and no value ever spliced into a query string. Plus the `/health` half: a disclosure that
 * cannot reach storage fails the check, and one that can never does.
 */

import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { buildHealth } from '../../src/api/health.js';
import { PgHostedKeyStore, type HostedSignersHealth } from '../../src/api/hosted.js';
import { SeatBook } from '../../src/api/seats.js';
import { setSpeed } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { Runtime } from '../../src/sim/runtime.js';

interface Call {
  readonly sql: string;
  readonly params: readonly unknown[];
}

class FakePool {
  readonly calls: Call[] = [];
  constructor(private readonly rows: readonly Record<string, unknown>[] = []) {}
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: readonly Record<string, unknown>[]; rowCount: number }> {
    this.calls.push({ sql, params: params ?? [] });
    return Promise.resolve({ rows: this.rows, rowCount: this.rows.length });
  }
  end(): Promise<void> {
    return Promise.resolve();
  }
}

const KEYID = 'A'.repeat(43);

describe('PgHostedKeyStore builds consistent parameterised SQL', () => {
  it('records with four bound parameters, first write wins, and nothing spliced', async () => {
    const pool = new FakePool();
    const store = new PgHostedKeyStore({ pool: pool as unknown as Pool });
    await store.recordHostedKey({ keyid: KEYID, principal: "p:o'brien" as PrincipalId, recordedAtTick: 7, recordedMs: 99 });
    const call = pool.calls[0];
    expect(call?.sql).toMatch(/INSERT INTO hosted_key \(keyid, principal, recorded_at_tick, recorded_ms\)/);
    expect(call?.sql).toMatch(/VALUES \(\$1, \$2, \$3, \$4\)/);
    expect(call?.sql).toMatch(/ON CONFLICT \(keyid\) DO NOTHING/);
    expect(call?.sql).not.toMatch(/UPDATE|DELETE/);
    expect(call?.sql).not.toContain("o'brien");
    expect(call?.params).toEqual([KEYID, "p:o'brien", 7, 99]);
  });

  it('reads every key back with its numbers as numbers, in byte order', async () => {
    const pool = new FakePool([{ keyid: KEYID, principal: 'p:chat', recorded_at_tick: '12', recorded_ms: '345' }]);
    const store = new PgHostedKeyStore({ pool: pool as unknown as Pool });
    expect(await store.hostedKeys()).toEqual([{ keyid: KEYID, principal: 'p:chat', recordedAtTick: 12, recordedMs: 345 }]);
    expect(pool.calls[0]?.sql).toMatch(/FROM hosted_key ORDER BY keyid COLLATE "C"/);
    expect(pool.calls[0]?.params).toEqual([]);
  });
});

describe("/health's `signers` block", () => {
  setSpeed('instant');
  const runtime = new Runtime({ seed: 'hosted-health' });
  const seats = new SeatBook(8);
  const block = (over: Partial<HostedSignersHealth & { alarming: boolean }>) => ({
    hosted: 2,
    undurable: 0,
    consecutive_failures: 0,
    last_error: null,
    gateway: 'configured' as const,
    alarming: false,
    ...over,
  });

  it('is reported, without the internal flag, and adds no failure while writes succeed', () => {
    const report = buildHealth(runtime, seats, { requireLiveDecisions: false, signers: () => block({}) });
    expect(report.signers).toEqual({ hosted: 2, undurable: 0, consecutive_failures: 0, last_error: null, gateway: 'configured' });
    expect(report.failures.some((f) => f.includes('signer'))).toBe(false);
  });

  it('a disclosure that cannot reach storage is a failure an operator sees', () => {
    const report = buildHealth(runtime, seats, {
      requireLiveDecisions: false,
      signers: () => block({ undurable: 1, consecutive_failures: 3, last_error: 'connection refused', alarming: true }),
    });
    expect(report.status).toBe('unhealthy');
    expect(report.failures.join(' ')).toMatch(/the signer disclosure is not durable: 1 hosted key\(s\).*connection refused/);
  });

  it('is null where the server runs none', () => {
    expect(buildHealth(runtime, seats, { requireLiveDecisions: false }).signers).toBeNull();
  });
});
