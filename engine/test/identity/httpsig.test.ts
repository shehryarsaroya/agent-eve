/**
 * SEC-1 — RFC 9421 verification, and every rejection with a *distinguishable*
 * reason.
 *
 * The distinguishability requirement is not decoration. An agent that receives
 * `invalid signature` cannot fix its client, so it retries forever and the
 * operator sees a healthy server refusing a healthy agent (High Water scar #14's
 * shape: the failure presents as a working system). So the suite ends by
 * asserting that **no two cases produced the same reason** — the property, not a
 * list of examples.
 */

import { describe, expect, it } from 'vitest';

import { fixedClock } from '../../src/core/time.js';
import {
  BoundedReplayStore,
  DEFAULT_SIGNATURE_POLICY,
  RequestVerifier,
  buildSignedRequest,
  contentDigestHeader,
  generateKeypair,
  signRequest,
  verifySignedRequest,
  wallSeconds,
  wallSecondsFrom,
} from '../../src/identity/index.js';
import type {
  KeyDirectory,
  SignableRequest,
  SignatureRejection,
  SignaturePolicy,
  WallSeconds,
} from '../../src/identity/index.js';
import { NOW, PLACEHOLDER_SIGNATURE, TICK, bareRequest, enrol, freshStore, jsonBody, newKeyring, withHeaders } from './helpers.js';

const NONCE = 'nonce-aaaaaaaa';

describe('RFC 9421 signature base (§2.5)', () => {
  it('builds exactly the lines the RFC specifies, LF-separated, with no trailing newline', () => {
    const keyring = newKeyring();
    const { keypair } = enrol(keyring, 'vale');
    const body = jsonBody({ verb: 'sign' });
    const digest = contentDigestHeader(body);

    const signed = signRequest({
      request: bareRequest({
        requestTarget: '/act?wait=true',
        headers: { 'Content-Digest': digest, 'Content-Type': 'application/json' },
        body,
      }),
      keypair,
      created: NOW,
      nonce: NONCE,
      components: ['@method', '@path', '@authority', 'content-digest'],
    });

    // Written out literally: this is the golden. Every detail here has been a bug
    // in some implementation — the quoting of component names, the ": " separator,
    // the query being excluded from @path, the params line coming last, and the
    // absence of a trailing newline.
    const expected = [
      '"@method": POST',
      '"@path": /act',
      '"@authority": compact.example',
      `"content-digest": ${digest}`,
      `"@signature-params": ("@method" "@path" "@authority" "content-digest");created=1700000000;keyid="${keypair.keyid}";alg="ed25519";nonce="${NONCE}"`,
    ].join('\n');

    expect(signed.signatureBase).toBe(expected);
    expect(signed.signatureBase.endsWith('\n')).toBe(false);
    expect(signed.signatureBase.split('\n')).toHaveLength(5);
    expect(signed.signatureInput.startsWith('compact=(')).toBe(true);
  });

  it('normalises the authority and derives @path, @query and @target-uri', () => {
    const { keypair } = enrol(newKeyring(), 'orison');
    const signed = signRequest({
      request: bareRequest({ authority: 'Compact.Example:443', requestTarget: '/observe?wait=true' }),
      keypair,
      created: NOW,
      nonce: NONCE,
      components: ['@method', '@path', '@query', '@authority', '@scheme', '@target-uri'],
    });
    expect(signed.signatureBase).toContain('"@authority": compact.example\n');
    expect(signed.signatureBase).toContain('"@path": /observe\n');
    expect(signed.signatureBase).toContain('"@query": ?wait=true\n');
    expect(signed.signatureBase).toContain('"@scheme": https\n');
    expect(signed.signatureBase).toContain('"@target-uri": https://compact.example/observe?wait=true\n');
  });

  it('gives @query a bare "?" when there is none, and @path a "/" when empty', () => {
    const { keypair } = enrol(newKeyring(), 'kell');
    const signed = signRequest({
      request: bareRequest({ requestTarget: '' }),
      keypair,
      created: NOW,
      nonce: NONCE,
      components: ['@path', '@query'],
    });
    expect(signed.signatureBase).toContain('"@path": /\n');
    expect(signed.signatureBase).toContain('"@query": ?\n');
  });

  it('signs deterministically: Ed25519 over the same base gives the same bytes', () => {
    const { keypair } = enrol(newKeyring(), 'vale');
    const request = bareRequest();
    const a = signRequest({ request, keypair, created: NOW, nonce: NONCE });
    const b = signRequest({ request, keypair, created: NOW, nonce: NONCE });
    expect(a.signature).toBe(b.signature);
  });

  it('refuses to sign a component the message does not have', () => {
    const { keypair } = enrol(newKeyring(), 'vale');
    expect(() =>
      signRequest({
        request: bareRequest(),
        keypair,
        created: NOW,
        nonce: NONCE,
        components: ['@method', 'content-digest'],
      }),
    ).toThrow(/COVERED_COMPONENT_ABSENT/);
  });
});

describe('RFC 9421 verification — the happy path', () => {
  it('accepts a signed request and archives what was signed', () => {
    const keyring = newKeyring();
    const { id, keypair } = enrol(keyring, 'vale');
    const store = freshStore();
    const body = jsonBody({ verb: 'fill_role', role: 2 });

    const built = buildSignedRequest({
      method: 'POST',
      scheme: 'https',
      authority: 'compact.example',
      requestTarget: '/act',
      body,
      keypair,
      created: NOW,
      nonce: NONCE,
    });

    const result = verifySignedRequest({
      request: built.request,
      now: NOW,
      tick: TICK,
      directory: keyring,
      replay: store,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.principal).toBe(id);
    expect(result.value.keyid).toBe(keypair.keyid);
    expect(result.value.coveredComponents).toEqual(['@method', '@path', '@authority', 'content-digest']);
    expect(result.value.nonce).toBe(NONCE);
    expect(result.value.acceptedAtTick).toBe(TICK);
    // The archived base is the signed statement itself, which is what lets a
    // third party re-check the record later without the original request.
    expect(result.value.signatureBase).toBe(built.signed.signatureBase);
  });

  it('takes real time only from an injected clock', () => {
    const keyring = newKeyring();
    const { keypair } = enrol(keyring, 'vale');
    const clock = fixedClock(1_700_000_000_999);
    const now = wallSecondsFrom(clock);
    // Truncating, not rounding: a signature created at t.9 must not be stamped t+1.
    expect(now).toBe(NOW);
    const built = buildSignedRequest({
      method: 'GET',
      scheme: 'https',
      authority: 'compact.example',
      requestTarget: '/observe',
      keypair,
      created: now,
      nonce: NONCE,
    });
    expect(
      verifySignedRequest({ request: built.request, now, tick: TICK, directory: keyring, replay: freshStore() }).ok,
    ).toBe(true);
  });

  it('accepts a bodyless request with no digest, and a body with one', () => {
    const keyring = newKeyring();
    const { keypair } = enrol(keyring, 'vale');
    const store = freshStore();
    for (const [i, body] of [null, jsonBody({ a: 1 })].entries()) {
      const built = buildSignedRequest({
        method: body === null ? 'GET' : 'POST',
        scheme: 'https',
        authority: 'compact.example',
        requestTarget: '/observe',
        body,
        keypair,
        created: NOW,
        nonce: `${NONCE}-${i}`,
      });
      expect(
        verifySignedRequest({ request: built.request, now: NOW, tick: TICK, directory: keyring, replay: store }).ok,
      ).toBe(true);
    }
  });
});

// ── the rejection table ──────────────────────────────────────────────────────

interface Case {
  readonly reason: SignatureRejection;
  readonly why: string;
  run(): { readonly ok: boolean; readonly reason?: SignatureRejection; readonly detail?: string };
}

/** Sign normally, then edit the message. Every case changes exactly one thing. */
function signed(
  overrides: {
    readonly request?: Partial<SignableRequest>;
    readonly components?: readonly string[];
    readonly created?: WallSeconds;
    readonly expires?: WallSeconds;
    readonly nonce?: string;
  } = {},
) {
  const keyring = newKeyring();
  const { keypair } = enrol(keyring, 'vale');
  const request = bareRequest(overrides.request ?? {});
  const out = signRequest({
    request,
    keypair,
    created: overrides.created ?? NOW,
    nonce: overrides.nonce ?? NONCE,
    expires: overrides.expires,
    components: overrides.components,
  });
  const withSig: SignableRequest = {
    ...request,
    headers: { ...request.headers, 'signature-input': out.signatureInput, signature: out.signature },
  };
  return { keyring, keypair, request: withSig, out };
}

function verify(
  request: SignableRequest,
  directory: KeyDirectory,
  opts: { now?: WallSeconds; tick?: number; store?: BoundedReplayStore; policy?: SignaturePolicy } = {},
) {
  const result = verifySignedRequest({
    request,
    now: opts.now ?? NOW,
    tick: opts.tick ?? TICK,
    directory,
    replay: opts.store ?? freshStore(),
    policy: opts.policy,
  });
  return result.ok ? { ok: true as const } : { ok: false as const, reason: result.reason, detail: result.detail };
}

const cases: Case[] = [
  {
    reason: 'SIGNATURE_INPUT_MISSING',
    why: 'an unsigned request',
    run: () => verify(bareRequest(), newKeyring()),
  },
  {
    reason: 'SIGNATURE_MISSING',
    why: 'Signature-Input without Signature',
    run: () => {
      const s = signed();
      return verify(withHeaders(s.request, { 'signature-input': s.out.signatureInput }), s.keyring);
    },
  },
  {
    reason: 'SIGNATURE_INPUT_MALFORMED',
    why: 'an unterminated inner list',
    run: () =>
      verify(
        withHeaders(bareRequest(), { 'signature-input': 'compact=("@method"', signature: PLACEHOLDER_SIGNATURE }),
        newKeyring(),
      ),
  },
  {
    reason: 'SIGNATURE_MALFORMED',
    why: 'the Signature value is not a byte sequence',
    run: () => {
      const s = signed();
      return verify(
        withHeaders(s.request, { 'signature-input': s.out.signatureInput, signature: 'compact=notbytes' }),
        s.keyring,
      );
    },
  },
  {
    reason: 'LABEL_MISMATCH',
    why: 'the two headers disagree about the label',
    run: () => {
      const s = signed();
      return verify(
        withHeaders(s.request, {
          'signature-input': s.out.signatureInput,
          signature: s.out.signature.replace('compact=', 'other='),
        }),
        s.keyring,
      );
    },
  },
  {
    reason: 'MULTIPLE_SIGNATURES',
    why: 'two signatures offered, so "who signed this" has two answers',
    run: () => {
      const s = signed();
      return verify(
        withHeaders(s.request, {
          'signature-input': `${s.out.signatureInput}, second=("@method");created=1700000000;keyid="x";nonce="nonce-bbbbbbbb"`,
          signature: s.out.signature,
        }),
        s.keyring,
      );
    },
  },
  {
    reason: 'ALGORITHM_UNSUPPORTED',
    why: 'alg names something other than ed25519',
    run: () => {
      const s = signed();
      return verify(
        withHeaders(s.request, {
          'signature-input': s.out.signatureInput.replace('"ed25519"', '"rsa-pss-sha512"'),
          signature: s.out.signature,
        }),
        s.keyring,
      );
    },
  },
  {
    reason: 'KEYID_MISSING',
    why: 'no keyid, so there is no key to check against',
    run: () => {
      const s = signed();
      return verify(
        withHeaders(s.request, {
          'signature-input': `compact=("@method" "@path" "@authority");created=1700000000;alg="ed25519";nonce="${NONCE}"`,
          signature: s.out.signature,
        }),
        s.keyring,
      );
    },
  },
  {
    reason: 'COVERED_COMPONENT_REQUIRED',
    why: 'a signature over @method alone says nothing about which path was called',
    run: () => {
      const s = signed({ components: ['@method'] });
      return verify(s.request, s.keyring);
    },
  },
  {
    reason: 'COVERED_COMPONENT_ABSENT',
    why: 'the signature covers a header the message no longer carries',
    run: () => {
      const s = signed({
        request: { headers: { date: 'Tue, 20 Apr 2021 02:07:35 GMT' } },
        components: ['@method', '@path', '@authority', 'date'],
      });
      const stripped = { ...s.request.headers };
      delete (stripped as Record<string, string>)['date'];
      return verify(withHeaders(s.request, stripped as Record<string, string>), s.keyring);
    },
  },
  {
    reason: 'COVERED_COMPONENT_DUPLICATED',
    why: 'the same component twice is two different signed statements',
    run: () => {
      const s = signed();
      return verify(
        withHeaders(s.request, {
          'signature-input': `compact=("@method" "@method" "@path" "@authority");created=1700000000;keyid="${s.keypair.keyid}";nonce="${NONCE}"`,
          signature: s.out.signature,
        }),
        s.keyring,
      );
    },
  },
  {
    reason: 'COVERED_COMPONENT_UNSUPPORTED',
    why: 'a derived component this engine does not implement',
    run: () => {
      const s = signed();
      return verify(
        withHeaders(s.request, {
          'signature-input': `compact=("@method" "@path" "@authority" "@request-target");created=1700000000;keyid="${s.keypair.keyid}";nonce="${NONCE}"`,
          signature: s.out.signature,
        }),
        s.keyring,
      );
    },
  },
  {
    reason: 'CREATED_MISSING',
    why: 'without created, freshness cannot be judged at all',
    run: () => {
      const s = signed();
      return verify(
        withHeaders(s.request, {
          'signature-input': `compact=("@method" "@path" "@authority");keyid="${s.keypair.keyid}";nonce="${NONCE}"`,
          signature: s.out.signature,
        }),
        s.keyring,
      );
    },
  },
  {
    reason: 'CREATED_IN_FUTURE',
    why: 'a clock further ahead than the skew bound allows',
    run: () => {
      const created = wallSeconds(NOW + DEFAULT_SIGNATURE_POLICY.maxSkewAhead + 1);
      const s = signed({ created });
      return verify(s.request, s.keyring);
    },
  },
  {
    reason: 'CREATED_TOO_OLD',
    why: 'older than the freshness window, so it may be a captured replay',
    run: () => {
      const created = wallSeconds(NOW - DEFAULT_SIGNATURE_POLICY.maxAge - 1);
      const s = signed({ created });
      return verify(s.request, s.keyring);
    },
  },
  {
    reason: 'SIGNATURE_EXPIRED',
    why: 'the signer set its own shorter deadline and it passed',
    run: () => {
      const s = signed({ created: wallSeconds(NOW - 2), expires: wallSeconds(NOW - 1) });
      return verify(s.request, s.keyring);
    },
  },
  {
    reason: 'EXPIRES_NOT_AFTER_CREATED',
    why: 'a signature that was never valid for any instant',
    run: () => {
      const s = signed({ created: NOW, expires: NOW });
      return verify(s.request, s.keyring);
    },
  },
  {
    reason: 'KEYID_UNKNOWN',
    why: 'a key this world has never seen',
    run: () => {
      const keypair = generateKeypair();
      const request = bareRequest();
      const out = signRequest({ request, keypair, created: NOW, nonce: NONCE });
      return verify(
        withHeaders(request, { 'signature-input': out.signatureInput, signature: out.signature }),
        newKeyring(),
      );
    },
  },
  {
    reason: 'KEY_NOT_YET_REGISTERED',
    why: 'the key takes effect at a later tick than the request claims',
    run: () => {
      const keyring = newKeyring();
      const { keypair } = enrol(keyring, 'vale', TICK + 10);
      const request = bareRequest();
      const out = signRequest({ request, keypair, created: NOW, nonce: NONCE });
      return verify(
        withHeaders(request, { 'signature-input': out.signatureInput, signature: out.signature }),
        keyring,
        { tick: TICK },
      );
    },
  },
  {
    reason: 'KEY_RETIRED',
    why: 'signed with a key that has since been rotated out',
    run: () => {
      const keyring = newKeyring();
      const { id, keypair } = enrol(keyring, 'vale', 0);
      keyring.rotate(id, generateKeypair().record, TICK - 1);
      const request = bareRequest();
      const out = signRequest({ request, keypair, created: NOW, nonce: NONCE });
      return verify(
        withHeaders(request, { 'signature-input': out.signatureInput, signature: out.signature }),
        keyring,
        { tick: TICK },
      );
    },
  },
  {
    reason: 'SIGNATURE_INVALID',
    why: 'the keyid was swapped to another registered principal, so the bytes are wrong',
    run: () => {
      const keyring = newKeyring();
      const a = enrol(keyring, 'vale');
      const b = enrol(keyring, 'orison');
      const request = bareRequest();
      const out = signRequest({ request, keypair: a.keypair, created: NOW, nonce: NONCE });
      return verify(
        withHeaders(request, {
          'signature-input': out.signatureInput.replace(a.keypair.keyid, b.keypair.keyid),
          signature: out.signature,
        }),
        keyring,
      );
    },
  },
  {
    reason: 'CONTENT_DIGEST_MISSING',
    why: 'a body with no digest at all',
    run: () => {
      const s = signed({
        request: { body: jsonBody({ verb: 'sign' }) },
        components: ['@method', '@path', '@authority'],
      });
      return verify(s.request, s.keyring);
    },
  },
  {
    reason: 'CONTENT_DIGEST_UNCOVERED',
    why: 'a digest that is present but not signed, so the body is still unsigned',
    run: () => {
      const body = jsonBody({ verb: 'sign' });
      const s = signed({
        request: { body, headers: { 'content-digest': contentDigestHeader(body) } },
        components: ['@method', '@path', '@authority'],
      });
      return verify(s.request, s.keyring);
    },
  },
  {
    reason: 'CONTENT_DIGEST_MALFORMED',
    why: 'a digest value that is not a byte sequence',
    run: () => {
      const body = jsonBody({ verb: 'sign' });
      const s = signed({
        request: { body, headers: { 'content-digest': contentDigestHeader(body) } },
        components: ['@method', '@path', '@authority', 'content-digest'],
      });
      return verify(
        withHeaders(s.request, { ...s.request.headers, 'content-digest': 'sha-256=notbytes' }),
        s.keyring,
      );
    },
  },
  {
    reason: 'CONTENT_DIGEST_ALGORITHM_UNSUPPORTED',
    why: 'only an algorithm we do not implement was offered',
    run: () => {
      const body = jsonBody({ verb: 'sign' });
      const s = signed({
        request: { body, headers: { 'content-digest': contentDigestHeader(body) } },
        components: ['@method', '@path', '@authority', 'content-digest'],
      });
      return verify(
        withHeaders(s.request, {
          ...s.request.headers,
          'content-digest': 'md5=:1B2M2Y8AsgTpgAmY7PhCfg==:',
        }),
        s.keyring,
      );
    },
  },
  {
    reason: 'CONTENT_DIGEST_MISMATCH',
    why: 'the body was swapped in flight while the digest header stayed',
    run: () => {
      const body = jsonBody({ share: 2000 });
      const s = signed({
        request: { body, headers: { 'content-digest': contentDigestHeader(body) } },
        components: ['@method', '@path', '@authority', 'content-digest'],
      });
      return verify({ ...s.request, body: jsonBody({ share: 9000 }) }, s.keyring);
    },
  },
  {
    reason: 'NONCE_MISSING',
    why: 'without a nonce a captured request is replayable for the whole window',
    run: () => {
      const s = signed();
      return verify(
        withHeaders(s.request, {
          'signature-input': `compact=("@method" "@path" "@authority");created=1700000000;keyid="${s.keypair.keyid}"`,
          signature: s.out.signature,
        }),
        s.keyring,
      );
    },
  },
  {
    reason: 'NONCE_MALFORMED',
    why: 'too short to be single-use in practice',
    run: () => {
      const s = signed({ nonce: 'short' });
      return verify(s.request, s.keyring);
    },
  },
  {
    reason: 'NONCE_REPLAYED',
    why: 'the same valid request sent twice',
    run: () => {
      const s = signed();
      const store = freshStore();
      const first = verify(s.request, s.keyring, { store });
      expect(first.ok).toBe(true);
      return verify(s.request, s.keyring, { store });
    },
  },
  {
    reason: 'NONCE_BUDGET_EXCEEDED',
    why: 'more unexpired nonces outstanding than the store will remember',
    run: () => {
      const keyring = newKeyring();
      const { keypair } = enrol(keyring, 'vale');
      const store = new BoundedReplayStore({ retention: wallSeconds(600), perKeyCap: 1, maxKeys: 4 });
      for (const nonce of ['nonce-aaaaaaaa', 'nonce-bbbbbbbb']) {
        const request = bareRequest();
        const out = signRequest({ request, keypair, created: NOW, nonce });
        const result = verify(
          withHeaders(request, { 'signature-input': out.signatureInput, signature: out.signature }),
          keyring,
          { store },
        );
        if (!result.ok) return result;
      }
      throw new Error('the per-key cap was never reached');
    },
  },
];

describe('SEC-1 — every rejection, each distinguishable', () => {
  for (const c of cases) {
    it(`${c.reason}: ${c.why}`, () => {
      const result = c.run();
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(c.reason);
      // The detail is what reaches the agent's correction channel, so it must say
      // something (scar #1: the agent-facing string is part of the rules surface).
      expect(result.detail).toBeTruthy();
      expect((result.detail ?? '').length).toBeGreaterThan(10);
    });
  }

  it('produces a different reason for every distinct failure', () => {
    const reasons = cases.map((c) => c.reason);
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it('never leaks a stack trace or an absolute path into a rejection detail', () => {
    // Scar #11: malformed input is the first thing an external agent sends.
    for (const c of cases) {
      const result = c.run();
      const detail = result.detail ?? '';
      expect(detail).not.toContain('/Users');
      expect(detail).not.toContain('at Object.');
      expect(detail).not.toContain('node_modules');
    }
  });
});

describe('the replay window and the freshness window must agree', () => {
  it('refuses a store that would forget a nonce while it is still replayable', () => {
    // If retention < maxAge + skew there is a replay hole exactly that wide, and
    // it is invisible: every component is individually correct (scar #1's shape).
    expect(() =>
      RequestVerifier.assertReplayCoversPolicy(
        { retention: wallSeconds(30), perKeyCap: 8, maxKeys: 8 },
        DEFAULT_SIGNATURE_POLICY,
      ),
    ).toThrow(/shorter than the freshness window/);

    expect(() =>
      RequestVerifier.assertReplayCoversPolicy(
        { retention: wallSeconds(90), perKeyCap: 8, maxKeys: 8 },
        DEFAULT_SIGNATURE_POLICY,
      ),
    ).not.toThrow();
  });

  it('closes the hole at the far edge: a forgotten nonce is already too old to use', () => {
    const keyring = newKeyring();
    const { keypair } = enrol(keyring, 'vale');
    const store = new BoundedReplayStore({ retention: wallSeconds(90), perKeyCap: 8, maxKeys: 8 });
    const request = bareRequest();
    const out = signRequest({ request, keypair, created: NOW, nonce: NONCE });
    const signedRequest = withHeaders(request, {
      'signature-input': out.signatureInput,
      signature: out.signature,
    });

    expect(verify(signedRequest, keyring, { store }).ok).toBe(true);
    // Well past the point where the store may have rotated the nonce out...
    const later = wallSeconds(NOW + 1000);
    const result = verify(signedRequest, keyring, { store, now: later });
    // ...and the signature is refused on age instead, which is the guarantee.
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('CREATED_TOO_OLD');
  });

  it('RequestVerifier carries policy and store so callers cannot mismatch them', () => {
    const keyring = newKeyring();
    const { keypair } = enrol(keyring, 'vale');
    const verifier = new RequestVerifier(keyring, freshStore());
    const built = buildSignedRequest({
      method: 'POST',
      scheme: 'https',
      authority: 'compact.example',
      requestTarget: '/act',
      body: jsonBody({ verb: 'move' }),
      keypair,
      created: NOW,
      nonce: NONCE,
    });
    expect(verifier.verify(built.request, NOW, TICK).ok).toBe(true);
    // Second time: the nonce is spent, and the store is the verifier's own.
    expect(verifier.verify(built.request, NOW, TICK).ok).toBe(false);
  });
});

describe('the nonce is spent only after the signature verifies', () => {
  it('a forged request does not burn the nonce a real one is about to use', () => {
    const keyring = newKeyring();
    const { keypair } = enrol(keyring, 'vale');
    const store = freshStore();
    const request = bareRequest();
    const out = signRequest({ request, keypair, created: NOW, nonce: NONCE });

    // An attacker who knows the nonce sends it with a broken signature.
    const forged = withHeaders(request, {
      'signature-input': out.signatureInput,
      signature: PLACEHOLDER_SIGNATURE,
    });
    expect(verify(forged, keyring, { store }).reason).toBe('SIGNATURE_INVALID');

    // The genuine request still works. If the nonce were spent before crypto,
    // anyone could pre-burn nonces and lock a principal out of its own turn.
    const genuine = withHeaders(request, { 'signature-input': out.signatureInput, signature: out.signature });
    expect(verify(genuine, keyring, { store }).ok).toBe(true);
  });
});

describe('policy is configurable without weakening the shape', () => {
  it('a deployment may drop the nonce requirement, and replay then depends on freshness alone', () => {
    const keyring = newKeyring();
    const { keypair } = enrol(keyring, 'vale');
    const policy: SignaturePolicy = { ...DEFAULT_SIGNATURE_POLICY, requireNonce: false };
    const request = bareRequest();
    // Hand-built: signRequest always includes a nonce, deliberately.
    const base = [
      '"@method": POST',
      '"@path": /act',
      '"@authority": compact.example',
      `"@signature-params": ("@method" "@path" "@authority");created=1700000000;keyid="${keypair.keyid}";alg="ed25519"`,
    ].join('\n');
    const signature = keypair.sign(Buffer.from(base, 'ascii'));
    const store = freshStore();
    const nonceless = withHeaders(request, {
      'signature-input': `compact=("@method" "@path" "@authority");created=1700000000;keyid="${keypair.keyid}";alg="ed25519"`,
      signature: `compact=:${Buffer.from(signature).toString('base64')}:`,
    });

    const result = verify(nonceless, keyring, { policy, store });
    expect(result.ok).toBe(true);
    // Nothing was remembered, because there was no nonce to remember...
    expect(store.remembered).toBe(0);
    // ...so the same request is accepted again, for as long as it stays fresh.
    // That is the cost of dropping the requirement, stated rather than implied.
    expect(verify(nonceless, keyring, { policy, store }).ok).toBe(true);
    const stale = wallSeconds(NOW + DEFAULT_SIGNATURE_POLICY.maxAge + 1);
    const expired = verify(nonceless, keyring, { policy, store, now: stale });
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.reason).toBe('CREATED_TOO_OLD');
  });
});
