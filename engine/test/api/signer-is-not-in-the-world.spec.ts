/**
 * ★ THE SIGNER IS NOT IN THE WORLD — and the record says so, tick by tick.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Season 1 is live. Anything hashed or captured is a rules change, and a rules change forces a declared
 * divergence into the permanent record. So the gateway header and the SIGNER disclosure must change
 * NOTHING the world computes — not one `state_hash`, not one durable row the journal writes.
 *
 * Two kinds of proof, the follow tables' pair (`test/follow/the-record-is-untouched.spec.ts`):
 *
 *   1. **Behavioural.** The same seed, cast, enrolments and acts, run twice through the real HTTP
 *      surface: once with every newcomer enrolled and played through a verified gateway header — so
 *      every one is `hosted`, metered per account, and drawn that way on both frames every tick — and
 *      once with none of it. Every tick's `state_hash` and every tick's journal rows must match.
 *   2. **Structural.** No module that writes, replays or hashes the record imports the hosted-key store
 *      or the gateway; the journal's SQL never names `hosted_key`; the table is append-only and
 *      unpartitioned; and the season script truncates it with the world.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { gatewayHeaders } from '../../src/api/gateway.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import { APPEND_ONLY_UNPARTITIONED, PUBLIC_DISCLOSURE_TABLES, SCHEMA_MIGRATIONS } from '../../src/db/migrate.js';
import { generateKeypair, type AgentKeypair } from '../../src/identity/index.js';
import { extractTick } from '../../src/persist/extract.js';
import { PATHS, buildSigned, harness, raw, type Agent, type Harness } from './harness.js';

const SEED = 'signer-not-in-the-world';
const SECRET = Buffer.alloc(32, 0x6b);
const TICKS = TICKS_PER_RECKONING + 12;
const ACCOUNTS = ['10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003'];

interface Run {
  readonly hashes: readonly string[];
  readonly journal: readonly string[];
  readonly hosted: number;
  readonly hostedOnFrames: number;
}

function nowOf(h: Harness): number {
  return Math.floor(h.clock.nowMs() / 1000);
}

/** One world. `viaGateway` decides whether the newcomers come through the connector. Nothing else differs. */
async function run(viaGateway: boolean, keys: readonly AgentKeypair[]): Promise<Run> {
  const h = await harness({ seed: SEED, gateway: { state: 'configured', secret: SECRET } });
  try {
    const cast = new HeuristicCast(h.runtime, { size: 4 });
    cast.seat(SEED);
    const agents: Agent[] = keys.map((keypair, i) => ({ handle: `chat-${String(i)}`, keypair, principalId: '' }));
    const gate = (i: number, method: string, path: string, digest: string | null): Record<string, string> =>
      viaGateway
        ? gatewayHeaders(SECRET, { accountId: ACCOUNTS[i] ?? '', method, path, contentDigest: digest, now: nowOf(h) })
        : {};

    const hashes: string[] = [];
    const journal: string[] = [];
    let hostedOnFrames = 0;
    const step = (): void => {
      for (const action of cast.decide(h.runtime.engine.tick + 1, SEED)) h.runtime.engine.submit(action);
      const report = h.runtime.runTick();
      hashes.push(report.stateHash);
      journal.push(JSON.stringify(extractTick(h.runtime, report)));
      // Both frames, every tick, WITH the lookup — exactly what `serve()` publishes. Rendering them
      // must not touch the world either.
      const live = h.runtime.liveFrame(h.context.signers.lookup);
      hostedOnFrames += live.directoryLines.filter((l) => l.signer === 'hosted').length;
      if (report.clock.isSettlementTick) {
        const nightly = h.runtime.reckoningFrame(h.context.signers.lookup);
        hostedOnFrames += (nightly?.standings ?? []).filter((r) => r.signer === 'hosted').length;
      }
    };

    for (let t = 0; t < 5; t += 1) step();
    for (const [i, a] of agents.entries()) {
      const text = JSON.stringify({ handle: a.handle, publicKey: a.keypair.record.publicKeyJwk.x });
      const digest = `sha-256=:${createHash('sha256').update(text).digest('base64')}:`;
      const res = await raw(h, 'POST', PATHS.enroll, text, {
        'content-type': 'application/json',
        'content-digest': digest,
        ...gate(i, 'POST', PATHS.enroll, digest),
      });
      expect(res.status, res.text).toBe(201);
    }
    step();
    for (let t = 0; t < TICKS; t += 1) {
      if (t % 40 === 0) {
        // Each newcomer observes and acts through the API — signed by its own key, and in the gateway
        // world carrying its account's header too.
        for (const [i, a] of agents.entries()) {
          const observed = buildSigned(h, a, 'GET', PATHS.observe);
          const seen = await raw(h, 'GET', PATHS.observe, undefined, { ...observed.headers, ...gate(i, 'GET', PATHS.observe, null) });
          expect(seen.status, seen.text).toBe(200);
          const body = { actions: [{ verb: 'publish_offer', params: { text: `CHAT HANDS ${String(t)}` }, clientSequence: t + 1 }], idempotencyKey: `k-${String(i)}-${String(t)}` };
          const signed = buildSigned(h, a, 'POST', PATHS.act, body);
          const acted = await raw(h, 'POST', PATHS.act, signed.text ?? undefined, {
            ...signed.headers,
            ...gate(i, 'POST', PATHS.act, signed.headers['content-digest'] ?? null),
          });
          expect(acted.status, acted.text).toBe(200);
        }
      }
      step();
    }
    return { hashes, journal, hosted: h.context.signers.health().hosted, hostedOnFrames };
  } finally {
    await h.close();
  }
}

describe('★ behavioural: an all-hosted world and an all-self world are the same world', () => {
  it('every tick’s state_hash and every durable row match, through a settled Reckoning', async () => {
    const keys = [generateKeypair(), generateKeypair(), generateKeypair()];
    const hosted = await run(true, keys);
    const plain = await run(false, keys);

    // The feature was exercised, or the comparison proves nothing.
    expect(hosted.hosted).toBe(3);
    expect(plain.hosted).toBe(0);
    expect(hosted.hostedOnFrames, 'the hosted newcomers were drawn as hosted on the frames').toBeGreaterThan(0);
    expect(plain.hostedOnFrames).toBe(0);

    expect(hosted.hashes.length).toBe(plain.hashes.length);
    expect(hosted.hashes.length).toBeGreaterThan(TICKS_PER_RECKONING);
    for (let i = 0; i < hosted.hashes.length; i += 1) {
      expect(hosted.hashes[i], `state_hash diverged at the ${String(i)}th tick`).toBe(plain.hashes[i]);
      expect(hosted.journal[i], `the durable rows diverged at the ${String(i)}th tick`).toBe(plain.journal[i]);
    }
  }, 240_000);
});

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

describe('★ structural: nothing that writes, replays or hashes the record can reach the signer', () => {
  it('the runtime, the tick, the record and the reckoning never import the hosted keys or the gateway', () => {
    const recordSide = [
      join(SRC, 'sim/runtime.ts'),
      ...files(join(SRC, 'persist')),
      ...files(join(SRC, 'tick')),
      ...files(join(SRC, 'reckoning')),
      ...files(join(SRC, 'ledger')),
      ...files(join(SRC, 'events')),
    ];
    const offenders = recordSide.filter((f) => /from\s+['"][^'"]*api\/(hosted|gateway)(\.js)?['"]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
    // The runtime may know the TYPE of a lookup (its frame builders take one as an argument) and
    // nothing else of the signer: no value import.
    const runtime = readFileSync(join(SRC, 'sim/runtime.ts'), 'utf8');
    expect(runtime).toMatch(/import type \{ SignerLookup \} from '\.\.\/identity\/signer\.js'/);
    expect(runtime).not.toMatch(/import \{[^}]*\bsignerAt\b/);
  });

  it('the journal’s Postgres store never names the table, and the table is append-only and unpartitioned', () => {
    expect(readFileSync(join(SRC, 'persist/postgres.ts'), 'utf8')).not.toMatch(/hosted_key/);
    for (const table of PUBLIC_DISCLOSURE_TABLES) expect(APPEND_ONLY_UNPARTITIONED as readonly string[]).toContain(table);
    const migrate = readFileSync(join(SRC, 'db/migrate.ts'), 'utf8');
    const partitioned = /const PARTITIONED_TABLES = \[([^\]]*)\]/.exec(migrate)?.[1] ?? '';
    expect(partitioned).not.toContain('hosted_key');
    expect(SCHEMA_MIGRATIONS.find(([v]) => v === 3)?.[1]).toMatch(/hosted keys/);
    const schema = readFileSync(join(SRC, 'db/schema.sql'), 'utf8');
    const table = /CREATE TABLE IF NOT EXISTS hosted_key \(([\s\S]*?)\n\);/.exec(schema)?.[1] ?? '';
    for (const column of ['keyid', 'principal', 'recorded_at_tick', 'recorded_ms']) {
      expect(table, column).toMatch(new RegExp(`\\n\\s*${column}\\s`));
    }
    expect(table).not.toMatch(/account|email/);
    expect(schema).not.toMatch(/hosted_key[\s\S]{0,400}PARTITION BY/);
  });
});
