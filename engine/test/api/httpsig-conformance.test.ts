/**
 * A *foreign* RFC 9421 client, written against the RFC and `agent.md` alone.
 *
 * ┌─ WHY THIS FILE IS NOT test/api/security-path.test.ts ─────────────────────┐
 * │ Every other signature test in this repo signs with `signRequest` and       │
 * │ verifies with `verifySignedRequest` — two halves of one module. If both     │
 * │ halves agree on a wrong signature base, every one of those tests passes    │
 * │ and every real client still fails. That is exactly what Gate 3 measured.   │
 * │                                                                            │
 * │ So this client shares NOTHING with the engine: it builds the signature      │
 * │ base by hand from RFC 9421 §2.5, derives its `keyid` from RFC 7638 by hand, │
 * │ signs with `node:crypto` directly, and uses `agent.md`'s documented label   │
 * │ `sig1` rather than the engine's internal default. It talks to a real        │
 * │ socket. It is the only test here that can fail when the engine is           │
 * │ self-consistently wrong.                                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The scenario under test is the deployed one: `deploy/nginx-compact.conf` proxies
 * `/api/` to `http://127.0.0.1:8801/`, and the trailing slash strips the
 * mount prefix — so a conformant client signs `@path: /api/observe` and the
 * app is handed `/observe`. `deliverTo` is how that is reproduced without nginx.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

import { LOOSE_LIMITS, harness, raw, type Harness } from './harness.js';

let h: Harness | null = null;

afterEach(async () => {
  if (h !== null) await h.close();
  h = null;
});

function live(): Harness {
  if (h === null) throw new Error('no harness');
  return h;
}

// ── A client built from the two RFCs, sharing no code with the engine ───────

interface ForeignClient {
  readonly handle: string;
  readonly publicKeyB64Url: string;
  readonly keyid: string;
  readonly privateKey: KeyObject;
}

function foreignClient(handle: string): ForeignClient {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw32 = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const x = raw32.toString('base64url');
  // RFC 7638 §3: the required members only, lexicographic, no whitespace. Written
  // out as a literal rather than JSON.stringify of an object, so member order is a
  // property of this test and not of V8's insertion order.
  const jwk = `{"crv":"Ed25519","kty":"OKP","x":"${x}"}`;
  const keyid = createHash('sha256').update(jwk, 'utf8').digest('base64url');
  return { handle, publicKeyB64Url: x, keyid, privateKey };
}

interface ForeignRequest {
  readonly method: string;
  /** The request target this client puts on the wire and therefore signs. */
  readonly signAs: string;
  /** Where the request is actually delivered. Differs when a proxy strips a prefix. */
  readonly deliverTo?: string;
  readonly components?: readonly string[];
  readonly body?: string;
  readonly nonce?: string;
  readonly createdOffsetSeconds?: number;
}

interface ForeignSigned {
  readonly headers: Record<string, string>;
  readonly base: string;
  readonly body: string | undefined;
  readonly target: string;
}

/**
 * A fresh nonce, counted rather than drawn. `Math.random` is banned repo-wide
 * (DET-7) and a test has no business being the exception.
 */
let nonceCounter = 0;
function freshNonce(): string {
  nonceCounter += 1;
  return `foreign-nonce-${String(nonceCounter).padStart(10, '0')}`;
}

/**
 * Build the signature base per RFC 9421 §2.5 by hand: one `"name": value` line per
 * covered component, LF-joined, then the `"@signature-params"` line, no trailing LF.
 */
function foreignSign(c: ForeignClient, req: ForeignRequest): ForeignSigned {
  const authority = live().authority;
  const created = Math.floor(live().clock.nowMs() / 1000) + (req.createdOffsetSeconds ?? 0);
  const nonce = req.nonce ?? freshNonce();
  const question = req.signAs.indexOf('?');
  const path = question < 0 ? req.signAs : req.signAs.slice(0, question);
  const query = question < 0 ? '?' : `?${req.signAs.slice(question + 1)}`;

  const headers: Record<string, string> = {};
  let digest: string | null = null;
  if (req.body !== undefined) {
    digest = `sha-256=:${createHash('sha256').update(req.body, 'utf8').digest('base64')}:`;
    headers['content-digest'] = digest;
    headers['content-type'] = 'application/json';
  }

  const components = req.components ?? [
    '@method',
    '@path',
    '@authority',
    ...(req.body === undefined ? [] : ['content-digest']),
  ];
  const valueOf = (name: string): string => {
    switch (name) {
      case '@method':
        return req.method.toUpperCase();
      case '@path':
        return path === '' ? '/' : path;
      case '@authority':
        return authority.toLowerCase();
      case '@scheme':
        return 'http';
      case '@query':
        return query;
      case '@target-uri':
        return `http://${authority.toLowerCase()}${req.signAs}`;
      case 'content-digest':
        if (digest === null) throw new Error('covering content-digest without a body');
        return digest;
      default:
        throw new Error(`this client does not know how to cover ${name}`);
    }
  };

  const params = `;created=${String(created)};keyid="${c.keyid}";alg="ed25519";nonce="${nonce}"`;
  const inner = `(${components.map((n) => `"${n}"`).join(' ')})${params}`;
  const base = [
    ...components.map((n) => `"${n}": ${valueOf(n)}`),
    `"@signature-params": ${inner}`,
  ].join('\n');

  // agent.md §2's worked example labels the signature `sig1`, not the engine's
  // internal default. A client following the document uses the document's label.
  const signature = cryptoSign(null, Buffer.from(base, 'ascii'), c.privateKey);
  headers['signature-input'] = `sig1=${inner}`;
  headers['signature'] = `sig1=:${signature.toString('base64')}:`;
  return { headers, base, body: req.body, target: req.deliverTo ?? req.signAs };
}

async function enrolForeign(c: ForeignClient): Promise<number> {
  const res = await raw(
    live(),
    'POST',
    '/api/enroll',
    JSON.stringify({ handle: c.handle, publicKey: c.publicKeyB64Url }),
    { 'content-type': 'application/json' },
  );
  return res.status;
}

async function sendForeign(c: ForeignClient, req: ForeignRequest) {
  const s = foreignSign(c, req);
  return raw(live(), req.method, s.target, s.body, s.headers);
}

// ── 1. The headline, end to end, over a socket ──────────────────────────────

describe('a foreign RFC 9421 client is accepted at its first signed request', () => {
  it('signs the target it sent (/api/observe) and is accepted behind the stripping proxy', async () => {
    h = await harness();
    const c = foreignClient('foreign-one');
    expect(await enrolForeign(c)).toBe(201);

    // THE GATE-3 FAILURE, REPRODUCED EXACTLY: signed over the client-visible target,
    // delivered on the app-internal one, which is what nginx does today.
    const res = await sendForeign(c, {
      method: 'GET',
      signAs: '/api/observe',
      deliverTo: '/observe',
    });

    expect(res.status).toBe(200);
    expect(res.json['ok']).toBe(true);
    // And it is a real observation, not a shell: a wake was spent and affordances came back.
    const observation = res.json['observation'] as Record<string, unknown>;
    expect(Array.isArray(observation['affordances'])).toBe(true);
  });

  it('is accepted when the prefix is preserved too, so fixing nginx changes nothing', async () => {
    h = await harness();
    const c = foreignClient('foreign-two');
    expect(await enrolForeign(c)).toBe(201);
    const res = await sendForeign(c, { method: 'GET', signAs: '/api/observe' });
    expect(res.status).toBe(200);
  });

  it('accepts the app-internal spelling, so a client that shipped the workaround survives', async () => {
    h = await harness();
    const c = foreignClient('foreign-three');
    expect(await enrolForeign(c)).toBe(201);
    const res = await sendForeign(c, { method: 'GET', signAs: '/observe' });
    expect(res.status).toBe(200);
  });

  it('POSTs a signed body to /api/act behind the stripping proxy — digest and @path together', async () => {
    h = await harness();
    const c = foreignClient('foreign-four');
    expect(await enrolForeign(c)).toBe(201);

    // First a real observation, then a real affordance copied verbatim out of it —
    // the whole documented loop, under the proxy, with a Content-Digest in the base.
    const observed = await sendForeign(c, {
      method: 'GET',
      signAs: '/api/observe',
      deliverTo: '/observe',
    });
    expect(observed.status).toBe(200);
    const observation = observed.json['observation'] as Record<string, unknown>;
    const affordances = observation['affordances'] as readonly Record<string, unknown>[];
    expect(affordances.length).toBeGreaterThan(0);
    const [first] = affordances;
    if (first === undefined) throw new Error('no affordance to act on');

    const res = await sendForeign(c, {
      method: 'POST',
      signAs: '/api/act',
      deliverTo: '/act',
      body: JSON.stringify({ verb: first['verb'], args: first['args'] ?? {} }),
    });
    // Whatever the verb decides, it must not be refused for the *signature*: the
    // digest and the prefixed @path have to hold together or this is a 401.
    expect(res.status).not.toBe(401);
    expect(res.json['reason']).not.toBe('SIGNATURE_INVALID');
  });

  it('carries the long poll: @query and @target-uri over the prefixed target', async () => {
    h = await harness();
    const c = foreignClient('foreign-five');
    expect(await enrolForeign(c)).toBe(201);
    const res = await sendForeign(c, {
      method: 'GET',
      signAs: '/api/observe?wait=false',
      deliverTo: '/observe?wait=false',
      components: ['@method', '@path', '@authority', '@scheme', '@query', '@target-uri'],
    });
    expect(res.status).toBe(200);
  });
});

// ── 2. The refusal has to name the thing that is wrong ──────────────────────

describe('when the signature really is wrong, the refusal names @path first', () => {
  it('gives the base line by line, names @path, and never leads with an innocent cause', async () => {
    h = await harness();
    const c = foreignClient('foreign-six');
    expect(await enrolForeign(c)).toBe(201);

    // A genuinely wrong signature: signed over a different endpoint entirely.
    const res = await sendForeign(c, {
      method: 'GET',
      signAs: '/api/act',
      deliverTo: '/observe',
    });

    expect(res.status).toBe(401);
    expect(res.json['reason']).toBe('SIGNATURE_INVALID');
    const diagnostic = res.json['diagnostic'] as Record<string, unknown>;
    const base = diagnostic['signature_base'] as readonly string[];
    // The client can diff its own base against ours, which is the whole point.
    expect(base).toContain('"@path": /api/observe');
    expect(base[base.length - 1]).toContain('"@signature-params":');
    const detail = String(res.json['detail']);
    expect(detail).toContain('@path');
    expect(detail.indexOf('@path')).toBeLessThan(detail.indexOf('different key'));
    // The scrubber must not have eaten the sentence on the way out.
    expect(detail).not.toContain('[version]');
    expect(detail).not.toContain('…');
  });
});

// ── 3. The base is only useful if it is byte-accurate ───────────────────────

describe('the diagnostic base survives the outbound scrubber intact', () => {
  it('echoes the @authority line unmangled, even when the authority is an IPv4 host', async () => {
    h = await harness();
    const c = foreignClient('foreign-eleven');
    expect(await enrolForeign(c)).toBe(201);
    const res = await sendForeign(c, {
      method: 'GET',
      signAs: '/api/act',
      deliverTo: '/observe',
    });
    const diagnostic = res.json['diagnostic'] as Record<string, unknown>;
    const base = diagnostic['signature_base'] as readonly string[];

    // ══════════════════════════════════════════════════════════════════════
    // `scrub`'s semver redaction was `\bv?\d+\.\d+\.\d+\b`, and an IPv4 address is a
    // dotted quad — so `127.0.0.1` reached the caller as `[version].1`. A diagnostic
    // whose entire purpose is a byte-for-byte diff cannot be allowed to lie about one
    // of its four lines, and the same defect corrupted the `RATE_LIMITED` hint, which
    // names the caller's own address on the endpoint a newcomer meets first.
    //
    // The value is asserted, not merely the line's presence: this is the assertion the
    // fix exists for.
    // ══════════════════════════════════════════════════════════════════════
    expect(live().authority).toMatch(/^127\.0\.0\.1:\d+$/);
    expect(base).toContain(`"@authority": ${live().authority}`);
    for (const line of base) expect(line).not.toContain('[version]');
  });

  it('names the caller’s real address in the RATE_LIMITED hint', async () => {
    h = await harness({ limits: { ...LOOSE_LIMITS, observe: { burst: 1, windowSeconds: 600 } } });
    const c = foreignClient('foreign-twelve');
    expect(await enrolForeign(c)).toBe(201);
    expect((await sendForeign(c, { method: 'GET', signAs: '/api/observe' })).status).toBe(200);
    const limited = await sendForeign(c, { method: 'GET', signAs: '/api/observe' });

    expect(limited.status).toBe(429);
    const detail = String(limited.json['detail']);
    expect(detail).toContain('127.0.0.1');
    expect(detail).not.toContain('[version]');
  });
});

// ── 4. Accepting two spellings must not accept a third resource ─────────────

describe('the forgiveness is exactly one mount prefix and nothing else', () => {
  it('refuses a doubled prefix rather than unwrapping it', async () => {
    h = await harness();
    const c = foreignClient('foreign-seven');
    expect(await enrolForeign(c)).toBe(201);
    // `requestTargetsFor` strips one prefix, so a target that contains it twice must
    // not resolve to the real route — otherwise the "one no-op prefix" argument fails.
    const res = await sendForeign(c, {
      method: 'GET',
      signAs: '/api/api/observe',
    });
    expect(res.status).toBe(404);
  });

  it('refuses a sibling endpoint under either spelling', async () => {
    h = await harness();
    const c = foreignClient('foreign-eight');
    expect(await enrolForeign(c)).toBe(201);
    for (const signAs of ['/act', '/api/act', '/health', '/api/discrepancy']) {
      const res = await sendForeign(c, { method: 'GET', signAs, deliverTo: '/observe' });
      expect(res.status, `signature over ${signAs} must not authorise observe`).toBe(401);
    }
  });

  it('spends the nonce once, whichever spelling burned it', async () => {
    h = await harness();
    const c = foreignClient('foreign-nine');
    expect(await enrolForeign(c)).toBe(201);
    const shared = 'foreign-shared-nonce-1';
    const first = await sendForeign(c, {
      method: 'GET',
      signAs: '/api/observe',
      deliverTo: '/observe',
      nonce: shared,
    });
    expect(first.status).toBe(200);
    // Same nonce, the other spelling. The replay store is keyed on (keyid, nonce)
    // and never on the path, so accepting two spellings opens no replay window.
    const second = await sendForeign(c, {
      method: 'GET',
      signAs: '/observe',
      deliverTo: '/api/observe',
      nonce: shared,
    });
    expect(second.status).toBe(401);
    expect(second.json['reason']).toBe('NONCE_REPLAYED');
  });

  it('records nothing public about a refused signature', async () => {
    h = await harness();
    const c = foreignClient('foreign-ten');
    expect(await enrolForeign(c)).toBe(201);
    const count = (): number =>
      live()
        .runtime.events.ticks()
        .reduce((n, t) => n + live().runtime.events.eventsAtTick(t).length, 0);
    const before = count();
    for (let i = 0; i < 5; i += 1) {
      await sendForeign(c, { method: 'GET', signAs: '/api/act', deliverTo: '/observe' });
    }
    // A5′: a refusal is private and recoverable. Five failed signatures must not put
    // a single line on the permanent record against anyone.
    expect(count()).toBe(before);
  });
});
