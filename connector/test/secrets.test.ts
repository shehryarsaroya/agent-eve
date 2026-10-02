/**
 * No private key, master key, gateway secret or bearer token in any response, log line or error.
 *
 * Plays a whole session — including failures whose error text deliberately carries the secrets,
 * the way a careless layer might — then searches every byte the service emitted.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { agentKeyAad, KeyVault } from '../src/crypto/vault.js';
import { createLogger, describeError, scrubText } from '../src/log.js';
import { Store } from '../src/store/store.js';
import { GATEWAY_SECRET, MASTER_KEY } from './helpers/config.js';
import { harness, payload } from './helpers/harness.js';

function encodings(bytes: Buffer): string[] {
  return [bytes.toString('base64'), bytes.toString('base64url'), bytes.toString('hex')];
}

describe('secrets never leave', () => {
  it('through any response, log line or error in a full session', async () => {
    const h = await harness();
    const sub = randomUUID();
    const token = await h.issuer.mcpToken({ sub });
    const client = await h.connect({ token });
    const call = async (name: string, args: Record<string, unknown> = {}) => payload(await client.callTool({ name, arguments: args }));

    expect((await call('eve_enroll', { handle: 'vault-check' }))['httpStatus']).toBe(201);
    h.engine.tick += 1;
    const row = await new Store(h.db).principal(sub);
    const seed = new KeyVault(new Map([[1, MASTER_KEY]])).decrypt({ version: row?.keyVersion ?? 1, blob: row?.encryptedKey ?? Buffer.alloc(0) }, agentKeyAad(sub, row?.keyid ?? ''));

    await call('eve_identity');
    await call('eve_observe');
    await call('eve_act', { actions: [{ verb: 'levy_vote', params: { choice: 'EVEN' } }] });
    await call('eve_act', { actions: [{ verb: 'levy_vote', params: { choice: 'EVEN' } }] });
    await call('eve_signing_log');
    await call('eve_wake_status');
    await call('eve_report', { expected: 'x', observed: 'y' });

    // A layer that throws with secrets in its message: the tool must answer generically and the
    // log must be scrubbed.
    const poisoned = `boom ${MASTER_KEY.toString('base64')} ${seed.toString('base64url')} ${GATEWAY_SECRET.toString('hex')} Bearer ${token}`;
    h.engine.override = () => new Error(poisoned);
    const failed = await call('eve_observe');
    expect(failed['mcpError']).toBe(true);
    expect(String(failed['error'])).toMatch(/could not be completed/);
    h.engine.override = null;

    // Bad tokens and the 401 path.
    await h.post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { authorization: `Bearer ${token}x` });
    await h.post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'eve_act', arguments: {} } });

    const emitted = [...h.bodies, ...h.logs].join('\n');
    expect(h.bodies.length).toBeGreaterThan(10);
    expect(h.logs.length).toBeGreaterThan(10);
    for (const secret of [...encodings(MASTER_KEY), ...encodings(GATEWAY_SECRET), ...encodings(seed), token]) {
      expect(emitted.includes(secret), 'a secret was emitted').toBe(false);
    }
    expect(emitted).not.toMatch(/"d"\s*:/);
    await h.close();
  });

  it('the logger scrubs bearer tokens, JWTs, key-shaped strings and named secrets', () => {
    const lines: string[] = [];
    const named = 'a-named-secret-value-1234';
    const logger = createLogger((line) => lines.push(line), () => [named]);
    logger.error('failed', {
      detail: `Authorization: Bearer abcdefghijklmnop eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl ${'A'.repeat(43)} ${named}`,
      count: 3,
      'bad key!': 'dropped',
    });
    const line = lines[0] ?? '';
    expect(line).not.toContain('abcdefghijklmnop');
    expect(line).not.toContain('eyJhbGciOiJFUzI1NiJ9');
    expect(line).not.toContain('A'.repeat(43));
    expect(line).not.toContain(named);
    expect(line).not.toContain('dropped');
    expect(JSON.parse(line)).toMatchObject({ level: 'error', event: 'failed', count: 3 });
    expect(scrubText('x'.repeat(1000)).length).toBeLessThan(400);
    expect(describeError(new Error(`leak ${named}`), [named])).toBe('Error: leak [redacted]');
  });
});
