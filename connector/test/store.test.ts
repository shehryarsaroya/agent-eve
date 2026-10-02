import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/store/migrate.js';
import { Store } from '../src/store/store.js';
import { MIGRATIONS, testDb, type TestDb } from './helpers/db.js';

let db: TestDb;
let store: Store;

beforeAll(async () => {
  db = await testDb();
  store = new Store(db);
});
afterAll(async () => {
  await db.close();
});

async function principalFor(handle: string) {
  const accountId = randomUUID();
  await store.touchAccount(accountId);
  const result = await store.insertPrincipal({ accountId, handle, keyid: `kid-${handle}-${randomUUID()}`, publicKey: 'x', sealedKey: Buffer.from([1, 2, 3]), keyVersion: 1 });
  return { accountId, result };
}

describe('the eve_mcp schema', () => {
  it('migrates once and is idempotent', async () => {
    expect(await migrate(db, MIGRATIONS)).toEqual([]);
    const { rows } = await db.query<{ version: string }>('SELECT version FROM eve_mcp.schema_migrations');
    expect(rows.map((r) => r.version)).toEqual(['001_eve_mcp.sql']);
  });

  it('holds one principal per account and one account per handle', async () => {
    const first = await principalFor('alpha');
    expect(first.result).toBe('inserted');
    const again = await store.insertPrincipal({ accountId: first.accountId, handle: 'alpha-two', keyid: 'k2', publicKey: 'x', sealedKey: Buffer.from([1]), keyVersion: 1 });
    expect(again).toBe('account-has-principal');
    const other = await principalFor('alpha');
    expect(other.result).toBe('handle-in-use');
  });

  it('refuses a handle the engine would refuse', async () => {
    const accountId = randomUUID();
    await store.touchAccount(accountId);
    await expect(store.insertPrincipal({ accountId, handle: 'Bad_Handle', keyid: 'k-bad', publicKey: 'x', sealedKey: Buffer.from([1]), keyVersion: 1 })).rejects.toThrow();
  });

  it('renames only a principal that never enrolled', async () => {
    const { accountId } = await principalFor('beta');
    const row = await store.principal(accountId);
    expect(await store.renamePending(accountId, row?.keyid ?? '', 'beta-two')).toBe('renamed');
    expect((await store.principal(accountId))?.principalId).toBe('p:beta-two');
    await store.markEnrolled(accountId);
    expect(await store.renamePending(accountId, row?.keyid ?? '', 'beta-three')).toBe('not-pending');
    const enrolled = await store.principal(accountId);
    expect(enrolled?.enrolled).toBe(true);
    expect(enrolled?.lastEnrollStatus).toBe(201);
    expect(enrolled?.sealedKey.equals(Buffer.from([1, 2, 3]))).toBe(true);
  });

  it('reserves client sequence numbers atomically, never below a floor', async () => {
    const { accountId } = await principalFor('gamma');
    const firsts = await Promise.all(Array.from({ length: 10 }, () => store.reserveSequences(accountId, 2, 0)));
    const numbers = firsts.flatMap((f) => [f, f + 1]);
    expect(new Set(numbers).size).toBe(20);
    expect(Math.min(...numbers)).toBe(1);
    expect(await store.reserveSequences(accountId, 1, 500)).toBe(500);
    expect((await store.principal(accountId))?.nextSequence).toBe(501);
  });

  it('keeps a body-free signing log, newest first, findable by key and by content', async () => {
    const { accountId } = await principalFor('delta');
    const a = await store.appendLog({ accountId, method: 'GET', path: '/api/observe', signed: true, keyid: 'k', verbs: [], actionCount: 0, idempotencyKey: null, contentHash: null });
    const b = await store.appendLog({ accountId, method: 'POST', path: '/api/act', signed: true, keyid: 'k', verbs: ['levy_vote'], actionCount: 1, idempotencyKey: 'mcp-1', contentHash: 'h1' });
    await store.completeLog(a, 200, null);
    await store.completeLog(b, 200, { accepted: [{ clientSequence: 1, verb: 'levy_vote', resolvesInTick: 9 }], corrected: [] });
    const log = await store.listLog(accountId, 10);
    expect(log.map((e) => e.path)).toEqual(['/api/act', '/api/observe']);
    expect(log[0]?.verbs).toEqual(['levy_vote']);
    expect((await store.latestByKey(accountId, 'mcp-1'))?.outcome?.accepted[0]?.verb).toBe('levy_vote');
    expect((await store.latestByContent(accountId, 'h1', 600))?.idempotencyKey).toBe('mcp-1');
    expect(await store.latestByContent(accountId, 'h1', 0)).toBeNull();
    expect(await store.latestByContent(randomUUID(), 'h1', 600)).toBeNull();
    const columns = (await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema = 'eve_mcp' AND table_name = 'signing_log'")).rows.map((r) => r.column_name);
    expect(columns).not.toContain('body');
    expect(columns).not.toContain('signature');
  });

  it('remembers the last observation\'s wake facts', async () => {
    const { accountId } = await principalFor('epsilon');
    await store.saveObservation(accountId, { tick: 300, reckoning: 1, wakesRemaining: 12, nextDecisionAt: 310, observedAt: new Date().toISOString() });
    expect((await store.principal(accountId))?.lastObservation).toMatchObject({ tick: 300, wakesRemaining: 12, nextDecisionAt: 310 });
  });
});
