/**
 * `@path` is the client's path, and a failing signature says what we computed.
 *
 * ┌─ THE GATE-3 FINDING THIS FILE EXISTS FOR ─────────────────────────────────┐
 * │ A probe wrote a textbook RFC 9421 client and got 401 SIGNATURE_INVALID    │
 * │ until it signed `"@path": /observe` instead of `/api/observe`. It  │
 * │ found that only by brute-forcing eight variants. **Every conformant       │
 * │ client failed at its first signed request**, and the refusal text named    │
 * │ the two causes that were fine ("a different key, or a message that        │
 * │ changed in flight") and not the one that was wrong.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * §2.2.6 derives `@path` from the target the *client* sent. A path-stripping proxy
 * destroys that before the origin sees it, and the two arrivals are byte-identical,
 * so the origin is told rather than left to guess: the caller supplies the
 * client-visible spelling plus the ones that route to the same handler.
 *
 * Accepting two spellings is the part that has to be *proved* safe rather than
 * asserted, so this suite carries the three properties that make it safe —
 * attribution follows the base that verified, the nonce is still spent once across
 * both spellings, and an unrelated path is still refused — next to the fix itself.
 * The wire-level half is in `test/api/security-path.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_ALTERNATE_REQUEST_TARGETS,
  buildSignedRequest,
  signRequest,
  verifyArchivedSignature,
  verifySignedRequest,
  wallSeconds,
} from '../../src/identity/index.js';
import type { SignableRequest } from '../../src/identity/index.js';
import { NOW, TICK, enrol, freshStore, newKeyring } from './helpers.js';

/** What the client sent. What §2.2.6 says `@path` is derived from. */
const SENT = '/api/observe';
/** What the app was handed, because nginx proxies `/api/` to the app root. */
const RECEIVED = '/observe';

interface Fixture {
  readonly keyring: ReturnType<typeof newKeyring>;
  readonly keypair: ReturnType<typeof enrol>['keypair'];
}

function fixture(): Fixture {
  const keyring = newKeyring();
  const { keypair } = enrol(keyring, 'p:vale');
  return { keyring, keypair };
}

/**
 * A request signed over `signedTarget` and delivered as `deliveredTarget`.
 *
 * The two arguments are the whole point: every other helper in this suite signs and
 * sends the same string, which is exactly the case that already worked.
 */
function crossSigned(
  f: Fixture,
  signedTarget: string,
  deliveredTarget: string,
  alternates: readonly string[],
  nonce = 'nonce-aaaaaaaa',
): SignableRequest {
  const built = buildSignedRequest({
    method: 'GET',
    scheme: 'https',
    authority: 'agentinsurance.io',
    requestTarget: signedTarget,
    keypair: f.keypair,
    created: NOW,
    nonce,
  });
  return {
    ...built.request,
    requestTarget: deliveredTarget,
    alternateRequestTargets: alternates,
  };
}

function verify(f: Fixture, request: SignableRequest, replay = freshStore()) {
  return verifySignedRequest({ request, now: NOW, tick: TICK, directory: f.keyring, replay });
}

describe('§2.2.6 — @path comes from the request target the client sent', () => {
  it('accepts a signature over the client-visible path when the proxy delivered the stripped one', () => {
    const f = fixture();
    // The probe's exact case: it signed /api/observe, nginx handed us /observe.
    const verified = verify(f, crossSigned(f, SENT, SENT, [RECEIVED]));

    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.signatureBase).toContain(`"@path": ${SENT}`);
    expect(verified.value.signatureBase).not.toContain(`"@path": ${RECEIVED}\n`);
  });

  it('still accepts the app-internal path, which is what a client forced into the workaround signs', () => {
    const f = fixture();
    // The transitional half. A client that already shipped the /observe workaround
    // keeps working, and it is the spelling nginx-behind-the-edge produces today.
    const verified = verify(f, crossSigned(f, RECEIVED, SENT, [RECEIVED]));

    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    // Attribution follows the base that VERIFIED, never the canonical one — an
    // archive recording a base the bytes do not sign cannot be re-proved.
    expect(verified.value.signatureBase).toContain(`"@path": ${RECEIVED}`);
  });

  it('re-verifies from the archive under either spelling, so the audit path is exact', () => {
    const f = fixture();
    for (const signedTarget of [SENT, RECEIVED]) {
      const verified = verify(f, crossSigned(f, signedTarget, SENT, [RECEIVED]));
      expect(verified.ok).toBe(true);
      if (!verified.ok) continue;
      // SEC-2's second half: a third party, later, reaches the same verdict from the
      // record alone — with no idea a proxy was ever involved.
      expect(verifyArchivedSignature(verified.value, f.keyring).ok).toBe(true);
    }
  });

  it('refuses a signature over an unrelated path — the prefix is the only thing forgiven', () => {
    const f = fixture();
    // /act and /observe are different resources. Nothing about accepting a mount
    // prefix may make a signature for one authorise the other.
    const verified = verify(f, crossSigned(f, '/api/act', SENT, [RECEIVED]));

    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.reason).toBe('SIGNATURE_INVALID');
  });

  it('spends the nonce once across both spellings, so neither is a replay window', () => {
    const f = fixture();
    const replay = freshStore();
    const shared = 'nonce-replay-1';

    // Accepted under the alternate spelling…
    expect(verify(f, crossSigned(f, RECEIVED, SENT, [RECEIVED], shared), replay).ok).toBe(true);
    // …and the same nonce is now spent for the canonical one too, because the replay
    // store is keyed on (keyid, nonce) and never on the path.
    const second = verify(f, crossSigned(f, RECEIVED, SENT, [RECEIVED], shared), replay);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe('NONCE_REPLAYED');
  });

  it('carries the alternate through @query and @target-uri, not @path alone', () => {
    const f = fixture();
    const sent = '/api/observe?wait=true';
    const built = buildSignedRequest({
      method: 'GET',
      scheme: 'https',
      authority: 'agentinsurance.io',
      requestTarget: sent,
      keypair: f.keypair,
      created: NOW,
      nonce: 'nonce-query-01',
    });
    // Sign every target-derived component the engine supports. If the alternate
    // rebuild changed only @path, @target-uri would still carry the stripped path
    // and this would fail — which is how a partial fix would present.
    const signed = signRequest({
      request: built.request,
      keypair: f.keypair,
      created: NOW,
      nonce: 'nonce-query-01',
      components: ['@method', '@path', '@authority', '@query', '@target-uri'],
    });

    const verified = verify(f, {
      ...built.request,
      requestTarget: '/observe?wait=true',
      alternateRequestTargets: [sent],
      headers: { 'signature-input': signed.signatureInput, signature: signed.signature },
    });

    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.signatureBase).toContain(`"@target-uri": https://agentinsurance.io${sent}`);
    expect(verified.value.signatureBase).toContain('"@query": ?wait=true');
  });

  it('builds no alternate base when no target-derived component is covered', () => {
    const f = fixture();
    const request: SignableRequest = {
      method: 'GET',
      scheme: 'https',
      authority: 'agentinsurance.io',
      requestTarget: RECEIVED,
      headers: {},
      body: null,
    };
    const signed = signRequest({
      request,
      keypair: f.keypair,
      created: NOW,
      nonce: 'nonce-nopath-1',
      components: ['@method', '@authority'],
    });

    // A base with no path in it is byte-identical under every spelling, so the extra
    // curve operations would buy nothing. The saving is invisible from outside except
    // here: the diagnostic lists what was actually checked, and it is one thing.
    const verified = verifySignedRequest({
      request: {
        ...request,
        // Tampered authority, so verification fails and the diagnostic is built.
        authority: 'elsewhere.example',
        alternateRequestTargets: [SENT],
        headers: { 'signature-input': signed.signatureInput, signature: signed.signature },
      },
      now: NOW,
      tick: TICK,
      directory: f.keyring,
      replay: freshStore(),
      policy: {
        // @path is required by default; this case is precisely about not covering it.
        requiredComponents: ['@method', '@authority'],
        maxAge: wallSeconds(60),
        maxSkewAhead: wallSeconds(30),
        requireNonce: true,
        requireContentDigestWithBody: true,
        maxNonceLength: 64,
      },
    });
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.diagnostic?.['request_targets_checked']).toEqual([RECEIVED]);
    // And with no @path covered there is nothing to say about it.
    expect(verified.detail).not.toContain('@path');
  });

  it('checks at most MAX_ALTERNATE_REQUEST_TARGETS alternates, however many it is handed', () => {
    const f = fixture();
    // The alternates are derived from an agent-reachable path, so the cap is what
    // stops one request becoming unbounded curve work. The true spelling is pushed
    // past the cap on purpose: it must NOT be reached.
    const filler = ['/x1', '/x2', '/x3', '/x4', '/x5'];
    expect(filler.length).toBeGreaterThan(MAX_ALTERNATE_REQUEST_TARGETS);
    const verified = verify(f, crossSigned(f, SENT, RECEIVED, [...filler, SENT]));

    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.reason).toBe('SIGNATURE_INVALID');
    expect(verified.diagnostic?.['request_targets_checked']).toHaveLength(
      MAX_ALTERNATE_REQUEST_TARGETS + 1,
    );
  });
});

describe('SIGNATURE_INVALID says what the server computed', () => {
  it('returns the signature base line by line, so a client diffs instead of guessing', () => {
    const f = fixture();
    const verified = verify(f, crossSigned(f, '/api/act', RECEIVED, []));

    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    const base = verified.diagnostic?.['signature_base'];
    expect(Array.isArray(base)).toBe(true);
    // The lines are the RFC's own spelling, not prose about them.
    expect(base).toContain('"@method": GET');
    expect(base).toContain(`"@path": ${RECEIVED}`);
    expect(base).toContain('"@authority": agentinsurance.io');
    // Line-per-component, and the params line is last (§2.5's most-missed detail).
    const lines = base as readonly string[];
    expect(lines[lines.length - 1]).toContain('"@signature-params":');
    // Never one newline-joined blob: the outbound scrubber collapses whitespace, so
    // a joined base would arrive as one unusable line.
    for (const line of lines) expect(line).not.toContain('\n');
  });

  it('names @path as the likely cause and lists every spelling it checked', () => {
    const f = fixture();
    const verified = verify(f, crossSigned(f, '/api/act', SENT, [RECEIVED]));

    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.detail).toContain('diagnostic.signature_base');
    expect(verified.detail).toContain(`"@path": ${SENT}`);
    expect(verified.detail).toContain(RECEIVED);
    expect(verified.diagnostic?.['request_targets_checked']).toEqual([SENT, RECEIVED]);
    // The two innocent causes may still be mentioned — they are sometimes right —
    // but never first, and never alone.
    expect(verified.detail.indexOf('@path')).toBeLessThan(verified.detail.indexOf('different key'));
  });

  it('quotes no RFC section number, because the outbound scrubber would eat it', () => {
    const f = fixture();
    const verified = verify(f, crossSigned(f, '/api/act', SENT, [RECEIVED]));
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    // `scrub` redacts anything shaped like a semantic version, so "§2.2.6" reaches
    // the agent as "§[version]" — a rules surface mangled by a security filter,
    // which is the same class of bug as the one this whole change fixes.
    expect(verified.detail).not.toMatch(/\d+\.\d+\.\d+/);
    expect(verified.detail).toContain('RFC 9421');
  });

  it('bounds the diagnostic, because the covered list is client-controlled', () => {
    const f = fixture();
    // Twenty-five distinct headers, all covered, all present — so none is refused as
    // absent and the base is genuinely long. A diagnostic that echoed all of them
    // would be an unbounded outbound string (INV-26).
    const extras: Record<string, string> = {};
    const covered = ['@method', '@path', '@authority'];
    for (let i = 0; i < 25; i += 1) {
      extras[`x-pad-${String(i)}`] = `pad${String(i)}`;
      covered.push(`x-pad-${String(i)}`);
    }
    const request: SignableRequest = {
      method: 'GET',
      scheme: 'https',
      authority: 'agentinsurance.io',
      requestTarget: RECEIVED,
      headers: extras,
      body: null,
    };
    const signed = signRequest({
      request,
      keypair: f.keypair,
      created: NOW,
      nonce: 'nonce-wide-001',
      components: covered,
    });

    const verified = verify(f, {
      ...request,
      // Tampered authority: the signature cannot verify, so the diagnostic is built.
      authority: 'elsewhere.example',
      headers: { ...extras, 'signature-input': signed.signatureInput, signature: signed.signature },
    });
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    const lines = verified.diagnostic?.['signature_base'] as readonly string[];
    expect(lines.length).toBeLessThanOrEqual(21);
    expect(lines[lines.length - 1]).toContain('further lines');
    // The covered list is the other echo of the same client-chosen input, and it needs
    // the same bound — it was the one that got away in the first version of this.
    const echoed = verified.diagnostic?.['covered_components'] as readonly string[];
    expect(echoed.length).toBeLessThanOrEqual(21);
    expect(echoed[echoed.length - 1]).toContain('further components');
  });
});
