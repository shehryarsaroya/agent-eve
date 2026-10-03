/**
 * ★ SPEC §3's SIGNER — `self` · `hosted` · `null` — on every surface that carries a principal's record.
 *
 * Owner decisions 1 and 2 (`docs/design/CONNECTORS-2026-10-02.md`): the server signs for chat players,
 * and that — and that they may be played from chat — is PUBLIC on their record. A9 makes it a parity
 * claim, not a frame feature: the frames' `standings` and `directoryLines`, and `observe`'s
 * `header.standing`, `counterparties[]` and `ventures.directory`, must carry the same field from the same
 * lookup. And it must never be world state, which `signer-is-not-in-the-world.spec.ts` proves.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import {
  HOSTED_FAILURE_ALARM,
  HostedSigners,
  InMemoryHostedKeyStore,
  type HostedKeyRecord,
  type HostedKeyStore,
} from '../../src/api/hosted.js';
import { serve } from '../../src/api/server.js';
import type { PrincipalId } from '../../src/core/types.js';
import { serialiseFrame, serialiseLiveFrame } from '../../src/frames/write.js';
import { Keyring, generateKeypair, signerAt, type AgentKeypair } from '../../src/identity/index.js';
import { InMemoryJournalStore } from '../../src/persist/index.js';
import type { Runtime } from '../../src/sim/runtime.js';
import { act, contactWorld, runTo, SETTLEMENT, tick } from '../say/contact-fixture.js';

const HOSTED = 'p:schat' as PrincipalId;
const SELF = 'p:sown' as PrincipalId;
const KEYLESS = 'p:shouse' as PrincipalId;

function keyed(): { readonly keyring: Keyring; readonly hostedKey: AgentKeypair; readonly selfKey: AgentKeypair } {
  const keyring = new Keyring();
  const hostedKey = generateKeypair();
  const selfKey = generateKeypair();
  keyring.register(HOSTED, hostedKey.record, 1);
  keyring.register(SELF, selfKey.record, 1);
  return { keyring, hostedKey, selfKey };
}

describe('★ signerAt — the key live at the tick decides, and the record of a key never changes', () => {
  it('no key is null; a key the server signs with is hosted; any other key is self', () => {
    const { keyring, hostedKey } = keyed();
    const hosted = new Set([hostedKey.record.keyid]);
    expect(signerAt(keyring, hosted, KEYLESS, 10)).toBeNull();
    expect(signerAt(keyring, hosted, HOSTED, 10)).toBe('hosted');
    expect(signerAt(keyring, hosted, SELF, 10)).toBe('self');
    expect(signerAt(keyring, new Set(), HOSTED, 10)).toBe('self');
  });

  it('before its first key takes effect a principal is answered by the key it enrolled with', () => {
    const { keyring, hostedKey } = keyed();
    expect(signerAt(keyring, new Set([hostedKey.record.keyid]), HOSTED, 0)).toBe('hosted');
  });

  it('★ a principal that takes its key over is `self` from that tick — and `hosted` before it, forever', () => {
    const { keyring, hostedKey } = keyed();
    const hosted = new Set([hostedKey.record.keyid]);
    const own = generateKeypair();
    keyring.rotate(HOSTED, own.record, 50);
    expect(signerAt(keyring, hosted, HOSTED, 49)).toBe('hosted');
    expect(signerAt(keyring, hosted, HOSTED, 50)).toBe('self');
    expect(signerAt(keyring, hosted, HOSTED, 5_000)).toBe('self');
  });
});

/** A store that fails its first `failures` writes, then works — the shape of a database hiccup. */
class FlakyStore implements HostedKeyStore {
  readonly kind = 'memory' as const;
  readonly written: HostedKeyRecord[] = [];
  constructor(private failures: number) {}
  hostedKeys(): Promise<readonly HostedKeyRecord[]> {
    return Promise.resolve([...this.written]);
  }
  recordHostedKey(row: HostedKeyRecord): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new Error('connection refused'));
    }
    this.written.push(row);
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

describe('★ HostedSigners — the set changes at once, the row is written in order, a failure is retried and reported', () => {
  it('marking a key twice writes it once', async () => {
    const { keyring, hostedKey } = keyed();
    const store = new FlakyStore(0);
    const signers = new HostedSigners(keyring, store);
    const row = { keyid: hostedKey.record.keyid, principal: HOSTED, recordedAtTick: 1, recordedMs: 9 };
    signers.markHosted(row);
    signers.markHosted(row);
    await signers.flush();
    expect(store.written).toEqual([row]);
    expect(signers.signerAt(HOSTED, 2)).toBe('hosted');
    expect(signers.health()).toMatchObject({ hosted: 1, undurable: 0, consecutive_failures: 0, last_error: null });
  });

  it('a failing store keeps the row, counts the failures, alarms at the threshold, and recovers', async () => {
    const { keyring, hostedKey } = keyed();
    const store = new FlakyStore(HOSTED_FAILURE_ALARM);
    const signers = new HostedSigners(keyring, store);
    signers.markHosted({ keyid: hostedKey.record.keyid, principal: HOSTED, recordedAtTick: 1, recordedMs: 9 });
    // markHosted already started one flush; finish the remaining failures.
    for (let i = 0; i < HOSTED_FAILURE_ALARM; i += 1) await signers.flush();
    expect(signers.health().undurable).toBe(1);
    expect(signers.health().last_error).toBe('connection refused');
    expect(signers.alarming).toBe(true);
    // The disclosure is already true in memory — the label does not wait for the database.
    expect(signers.signerAt(HOSTED, 2)).toBe('hosted');
    expect(await signers.flush()).toBe(1);
    expect(signers.alarming).toBe(false);
    expect(signers.health()).toMatchObject({ undurable: 0, consecutive_failures: 0, last_error: null });
    expect(store.written).toHaveLength(1);
  });

  it('close() awaits a write that needs the event loop — a real socket — rather than spinning past it', async () => {
    // A Postgres write resolves on a macrotask. A close that waited with `while (flushing) await
    // Promise.resolve()` would re-queue microtasks forever and never let that write land: this hangs.
    const { keyring, hostedKey } = keyed();
    const written: HostedKeyRecord[] = [];
    let storeClosed = false;
    const slow: HostedKeyStore = {
      kind: 'postgres',
      hostedKeys: () => Promise.resolve([]),
      recordHostedKey: (row) =>
        new Promise((resolve) => {
          setTimeout(() => {
            written.push(row);
            resolve();
          }, 20);
        }),
      close: () => {
        storeClosed = true;
        return Promise.resolve();
      },
    };
    const signers = new HostedSigners(keyring, slow);
    signers.markHosted({ keyid: hostedKey.record.keyid, principal: HOSTED, recordedAtTick: 1, recordedMs: 1 });
    expect(await signers.close()).toBe(0);
    expect(written).toHaveLength(1);
    expect(storeClosed).toBe(true);
  });

  it('load() reads every recorded key, and close() drains what is queued', async () => {
    const { keyring, hostedKey } = keyed();
    const store = new InMemoryHostedKeyStore();
    await store.recordHostedKey({ keyid: hostedKey.record.keyid, principal: HOSTED, recordedAtTick: 1, recordedMs: 1 });
    const signers = new HostedSigners(keyring, store);
    expect(signers.signerAt(HOSTED, 5)).toBe('self');
    expect(await signers.load()).toBe(1);
    expect(signers.signerAt(HOSTED, 5)).toBe('hosted');
    expect(await signers.close()).toBe(0);
  });
});

/** A world where HOSTED and SELF hold keys (one hosted), KEYLESS holds none, and HOSTED is dealing. */
function dealingWorld(seed: string): { readonly runtime: Runtime; readonly signers: HostedSigners } {
  const w = contactWorld(seed, [HOSTED, SELF, KEYLESS]);
  const { keyring, hostedKey } = keyed();
  const signers = new HostedSigners(keyring);
  signers.markHosted({ keyid: hostedKey.record.keyid, principal: HOSTED, recordedAtTick: 1, recordedMs: 1 });
  // Up to the settlement, with HOSTED's offer fresh on it, so both frames list HOSTED as dealing.
  runTo(w.runtime, SETTLEMENT - 2);
  expect(act(w.runtime, HOSTED, 'publish_offer', { text: 'HANDS FOR HIRE FROM A CHAT WINDOW' })).toBeNull();
  tick(w.runtime);
  expect(w.runtime.engine.tick).toBe(SETTLEMENT);
  return { runtime: w.runtime, signers };
}

function observeWith(runtime: Runtime, principal: PrincipalId, signers: HostedSigners | null) {
  return buildObservation({
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 16,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
    ...(signers === null ? {} : { signerOf: (p: PrincipalId) => signers.signerAt(p, Math.max(0, runtime.engine.tick)) }),
  });
}

describe('★ the frames and observe carry the same SIGNER, from the same lookup (A9)', () => {
  it('standings rows and dealing marks on the nightly frame, dealing marks on the live frame', () => {
    const { runtime, signers } = dealingWorld('signer-frames');
    const nightly = runtime.reckoningFrame(signers.lookup);
    expect(nightly).not.toBeNull();
    if (nightly === null) return;
    const standing = (p: PrincipalId) => nightly.standings.find((r) => r.principal === p);
    expect(standing(HOSTED)?.signer).toBe('hosted');
    expect(standing(SELF)?.signer).toBe('self');
    expect(standing(KEYLESS)?.signer, 'no key: not self, not hosted').toBeNull();
    expect(nightly.directoryLines.find((l) => l.principal === HOSTED)?.signer).toBe('hosted');
    // The published bytes carry it, and the budgets accept it.
    const published = JSON.parse(serialiseFrame(nightly)) as { standings: { principal: string; signer: unknown }[] };
    expect(published.standings.find((r) => r.principal === HOSTED)?.signer).toBe('hosted');

    const live = runtime.liveFrame(signers.lookup);
    const mark = live.directoryLines.find((l) => l.principal === HOSTED);
    expect(mark?.signer).toBe('hosted');
    const publishedLive = JSON.parse(serialiseLiveFrame(live)) as { directoryLines: { principal: string; signer: unknown }[] };
    expect(publishedLive.directoryLines.find((l) => l.principal === HOSTED)?.signer).toBe('hosted');
  });

  it('with no lookup (a sim, a fixture) every row reads null — nobody in such a world enrolled a key', () => {
    const { runtime } = dealingWorld('signer-no-lookup');
    const nightly = runtime.reckoningFrame();
    expect(nightly?.standings.length).toBeGreaterThan(0);
    for (const row of nightly?.standings ?? []) expect(row.signer).toBeNull();
    for (const line of runtime.liveFrame().directoryLines) expect(line.signer).toBeNull();
  });

  it('★ observe says what the frame says: header.standing, counterparties[] and the directory record', () => {
    const { runtime, signers } = dealingWorld('signer-parity');
    const nightly = runtime.reckoningFrame(signers.lookup);
    const live = runtime.liveFrame(signers.lookup);
    const framed = (p: PrincipalId) => nightly?.standings.find((r) => r.principal === p)?.signer;

    for (const p of [HOSTED, SELF, KEYLESS]) {
      const own = observeWith(runtime, p, signers).header.standing as Record<string, unknown>;
      expect(own['signer'], `${p}'s own header.standing`).toBe(framed(p));
    }
    const reader = observeWith(runtime, SELF, signers);
    const rows = (reader.ventures['directory'] as { rows: { principal: string; record: Record<string, unknown> }[] }).rows;
    const dealer = rows.find((r) => r.principal === HOSTED);
    expect(dealer?.record['signer'], 'the directory record an agent reads').toBe('hosted');
    expect(dealer?.record['signer']).toBe(live.directoryLines.find((l) => l.principal === HOSTED)?.signer);
    for (const row of reader.counterparties as Record<string, unknown>[]) {
      expect(row['signer'], `counterparty ${String(row['principal'])}`).toBe(signers.signerAt(row['principal'] as PrincipalId, runtime.engine.tick));
    }
  });

  it('an observation built with no lookup OMITS the field rather than invent one', () => {
    const { runtime } = dealingWorld('signer-omitted');
    const standing = observeWith(runtime, HOSTED, null).header.standing as Record<string, unknown>;
    expect('signer' in standing).toBe(false);
  });
});

// ── Boot ────────────────────────────────────────────────────────────────────

let closeServer: (() => Promise<void>) | null = null;
afterEach(async () => {
  await closeServer?.();
  closeServer = null;
});

describe('★ boot reads the hosted keys before anything is served — and holds rather than serve a wrong label', () => {
  it('a recorded key is hosted from the first request, and /health counts it', async () => {
    const store = new InMemoryHostedKeyStore();
    const keypair = generateKeypair();
    await store.recordHostedKey({ keyid: keypair.record.keyid, principal: HOSTED, recordedAtTick: 0, recordedMs: 0 });
    const started = await serve({
      port: 0,
      host: '127.0.0.1',
      seed: 'signer-boot',
      trustEdge: false,
      castSize: 3,
      framesDir: null,
      store: new InMemoryJournalStore(),
      hostedKeys: store,
      gateway: { state: 'configured', secret: Buffer.alloc(32, 9) },
    });
    closeServer = started.close;
    expect(started.created).not.toBeNull();
    const signers = started.created?.context.signers;
    expect(signers?.isHosted(keypair.record.keyid)).toBe(true);
    expect(signers?.health()).toMatchObject({ hosted: 1, undurable: 0, gateway: 'configured' });
    const health = (await (await fetch(`http://127.0.0.1:${String(started.port)}/api/health`)).json()) as {
      report: { signers: Record<string, unknown> };
    };
    expect(health.report.signers).toMatchObject({ hosted: 1, undurable: 0, gateway: 'configured' });
  });

  it('a hosted-key table that cannot be read HOLDS the world, saying why', async () => {
    const broken: HostedKeyStore = {
      kind: 'postgres',
      hostedKeys: () => Promise.reject(new Error('relation "hosted_key" does not exist')),
      recordHostedKey: () => Promise.resolve(),
      close: () => Promise.resolve(),
    };
    const started = await serve({
      port: 0,
      host: '127.0.0.1',
      seed: 'signer-held',
      trustEdge: false,
      castSize: 3,
      framesDir: null,
      store: new InMemoryJournalStore(),
      hostedKeys: broken,
    });
    closeServer = started.close;
    expect(started.created).toBeNull();
    expect(started.boot.status).toBe('HELD');
    const res = await fetch(`http://127.0.0.1:${String(started.port)}/api/health`);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('hosted_key');
  });
});
