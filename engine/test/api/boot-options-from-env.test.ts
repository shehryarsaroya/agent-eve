/**
 * ★ **THE HOST'S ENVIRONMENT REACHES THE WORLD THROUGH EVERY ENTRY POINT** (2026-10-02).
 *
 * Season 1 went live with `COMPACT_SEATS=1000` in `/etc/agenteve/env` and `/health` reported 500
 * seats: only the `node dist/api/server.js` entry read the variable, and production boots through
 * `deploy/run-standalone.mjs`, which called `serve()` without it — and without the operator door or
 * the adoption switch either. `bootOptionsFromEnv` reads all three in one place; the launcher spreads it.
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SEATS } from '../../src/api/seats.js';
import { bootOptionsFromEnv } from '../../src/api/server.js';

const SAVED = { ...process.env };

afterEach(() => {
  for (const key of ['COMPACT_SEATS', 'COMPACT_ACCEPT_DIVERGENCE_AT_TICK', 'COMPACT_CHECKPOINT_ADOPTION', 'COMPACT_GATEWAY_SECRET']) {
    if (SAVED[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED[key];
  }
});

describe('★ boot options come from the environment, in one place', () => {
  it('reads COMPACT_SEATS, and falls back to the default only when it is unset', () => {
    process.env['COMPACT_SEATS'] = '1000';
    expect(bootOptionsFromEnv().seats).toBe(1000);
    delete process.env['COMPACT_SEATS'];
    expect(bootOptionsFromEnv().seats).toBe(DEFAULT_SEATS);
  });

  it('carries the operator door and the adoption switch through the same call', () => {
    delete process.env['COMPACT_ACCEPT_DIVERGENCE_AT_TICK'];
    delete process.env['COMPACT_CHECKPOINT_ADOPTION'];
    expect(bootOptionsFromEnv().acceptDivergence).toBeNull();
    expect(bootOptionsFromEnv().disableCheckpointAdoption).toBe(false);
  });

  it('★ reads COMPACT_GATEWAY_SECRET: unset, configured (base64, base64url or hex), or malformed — and never prints it', () => {
    const secret = Buffer.alloc(32, 0x2c);
    delete process.env['COMPACT_GATEWAY_SECRET'];
    expect(bootOptionsFromEnv().gateway).toEqual({ state: 'unset' });
    for (const text of [secret.toString('base64'), secret.toString('base64url'), secret.toString('hex')]) {
      process.env['COMPACT_GATEWAY_SECRET'] = text;
      const gateway = bootOptionsFromEnv().gateway;
      expect(gateway?.state).toBe('configured');
      if (gateway?.state === 'configured') expect(gateway.secret.equals(secret)).toBe(true);
    }
    const written: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      written.push(String(chunk));
      return true;
    };
    try {
      process.env['COMPACT_GATEWAY_SECRET'] = 'too-short-to-be-a-key';
      expect(bootOptionsFromEnv().gateway).toEqual({ state: 'malformed' });
    } finally {
      process.stderr.write = write;
    }
    const said = written.join('');
    expect(said).toContain('COMPACT_GATEWAY_SECRET is set but does not decode to 32 bytes');
    expect(said).not.toContain('too-short-to-be-a-key');
  });

  it('the production launcher spreads it, so no entry point can drop one of the three', () => {
    const launcher = readFileSync(new URL('../../../deploy/run-standalone.mjs', import.meta.url), 'utf8');
    expect(launcher, 'MUTATION: remove the spread and Season 1 serves 500 seats again').toContain('...bootOptionsFromEnv()');
  });
});
