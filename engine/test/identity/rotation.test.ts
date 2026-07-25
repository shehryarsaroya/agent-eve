/**
 * SEC-2 — Ed25519 key rotation, and what happens to in-flight obligations signed
 * with the old key.
 *
 * The rule under test, chosen and stated in `keyring.ts`:
 *
 * > Rotation is **prospective only**. A retired key stops authenticating new
 * > requests from the tick the rotation lands, and never invalidates anything
 * > already accepted.
 *
 * The alternative is what makes this a top-severity test rather than a hygiene
 * one. If a retired key's past signatures were treated as void, every principal
 * would hold a delete button for its own history: rotate, and the compacts you
 * signed, the grants you issued and the defaults you incurred all become
 * unattributable. That is A5′ — the record must never be wrong — failing in the
 * one direction nobody checks, because it looks like good key hygiene.
 */

import { describe, expect, it } from 'vitest';

import { minor } from '../../src/core/units.js';
import type { GrantId, PrincipalId } from '../../src/core/types.js';
import {
  generateKeypair,
  issueGrantCredential,
  signRequest,
  verifyArchivedSignature,
  verifyArchivedGrantCredential,
  verifyGrantCredential,
  verifySignedRequest,
} from '../../src/identity/index.js';
import type { AcceptedSignature, SignableRequest } from '../../src/identity/index.js';
import { NOW, bareRequest, enrol, freshStore, newKeyring, withHeaders } from './helpers.js';

const NONCE = 'nonce-aaaaaaaa';

function signedRequestFrom(keypair: ReturnType<typeof generateKeypair>, nonce = NONCE): SignableRequest {
  const request = bareRequest();
  const out = signRequest({ request, keypair, created: NOW, nonce });
  return withHeaders(request, { 'signature-input': out.signatureInput, signature: out.signature });
}

describe('SEC-2 — rotation, live authentication', () => {
  it('retires the old key from the landing tick and installs the new one', () => {
    const keyring = newKeyring();
    const { id, keypair: oldKey } = enrol(keyring, 'vale', 10);
    const newKey = generateKeypair();

    const { retired, installed } = keyring.rotate(id, newKey.record, 100);
    expect(retired.keyid).toBe(oldKey.keyid);
    expect(retired.retiredAtTick).toBe(100);
    expect(installed.keyid).toBe(newKey.keyid);
    expect(installed.registeredAtTick).toBe(100);
    // Identity is permanent (A10): the principal is unchanged by rotation.
    expect(installed.principal).toBe(id);
    expect(keyring.activeFor(id)?.keyid).toBe(newKey.keyid);
    // Keys are never deleted; the archive needs them (A5, scar #3).
    expect(keyring.historyFor(id).map((r) => r.keyid)).toEqual([oldKey.keyid, newKey.keyid]);
  });

  it('the old key still authenticates before the rotation lands, and not after', () => {
    const keyring = newKeyring();
    const { id, keypair: oldKey } = enrol(keyring, 'vale', 10);
    keyring.rotate(id, generateKeypair().record, 100);
    const request = signedRequestFrom(oldKey);

    const before = verifySignedRequest({
      request,
      now: NOW,
      tick: 99,
      directory: keyring,
      replay: freshStore(),
    });
    expect(before.ok).toBe(true);

    const after = verifySignedRequest({
      request,
      now: NOW,
      tick: 100,
      directory: keyring,
      replay: freshStore(),
    });
    expect(after.ok).toBe(false);
    if (after.ok) return;
    expect(after.reason).toBe('KEY_RETIRED');
    // The hint must say the past is safe, or an agent reads a rejection as its
    // whole history being repudiated.
    expect(after.detail).toContain('remain valid');
  });

  it('the new key authenticates from the landing tick and not before', () => {
    const keyring = newKeyring();
    const { id } = enrol(keyring, 'vale', 10);
    const newKey = generateKeypair();
    keyring.rotate(id, newKey.record, 100);
    const request = signedRequestFrom(newKey);

    const early = verifySignedRequest({ request, now: NOW, tick: 99, directory: keyring, replay: freshStore() });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.reason).toBe('KEY_NOT_YET_REGISTERED');

    const onTime = verifySignedRequest({ request, now: NOW, tick: 100, directory: keyring, replay: freshStore() });
    expect(onTime.ok).toBe(true);
  });
});

describe('SEC-2 — in-flight obligations signed with the old key', () => {
  it('an accepted signature stays verifiable forever after its key is retired', () => {
    const keyring = newKeyring();
    const { id, keypair: oldKey } = enrol(keyring, 'vale', 10);

    // A compact is signed and accepted at tick 50.
    const accepted = verifySignedRequest({
      request: signedRequestFrom(oldKey),
      now: NOW,
      tick: 50,
      directory: keyring,
      replay: freshStore(),
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const archived: AcceptedSignature = accepted.value;

    // Months later the principal rotates its key.
    keyring.rotate(id, generateKeypair().record, 5000);

    // The record still proves who signed. This is the assertion the whole design
    // rests on: the ledger's attribution does not decay.
    const recheck = verifyArchivedSignature(archived, keyring);
    expect(recheck.ok).toBe(true);
    if (!recheck.ok) return;
    expect(recheck.value.principal).toBe(id);
    expect(recheck.value.retiredAtTick).toBe(5000);
  });

  it('an archive entry cannot be backdated to before the key existed, or forward past retirement', () => {
    const keyring = newKeyring();
    const { id, keypair: oldKey } = enrol(keyring, 'vale', 10);
    const accepted = verifySignedRequest({
      request: signedRequestFrom(oldKey),
      now: NOW,
      tick: 50,
      directory: keyring,
      replay: freshStore(),
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    keyring.rotate(id, generateKeypair().record, 100);

    for (const tick of [9, 100, 101]) {
      const forged: AcceptedSignature = { ...accepted.value, acceptedAtTick: tick };
      const result = verifyArchivedSignature(forged, keyring);
      expect(result.ok, `tick ${tick}`).toBe(false);
      if (!result.ok) expect(result.reason).toBe('KEY_RETIRED');
    }
  });

  it('a tampered archive entry is caught: the base and the signature must still agree', () => {
    const keyring = newKeyring();
    const { keypair } = enrol(keyring, 'vale', 10);
    const accepted = verifySignedRequest({
      request: signedRequestFrom(keypair),
      now: NOW,
      tick: 50,
      directory: keyring,
      replay: freshStore(),
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;

    // Rewriting what was signed — the exact A5′ attack, an edited ledger.
    const edited: AcceptedSignature = {
      ...accepted.value,
      signatureBase: accepted.value.signatureBase.replace('/act', '/abandon'),
    };
    const result = verifyArchivedSignature(edited, keyring);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('SIGNATURE_INVALID');
  });

  it('reattributing an archive entry to another principal is caught', () => {
    const keyring = newKeyring();
    const { keypair } = enrol(keyring, 'vale', 10);
    const other = enrol(keyring, 'orison', 10);
    const accepted = verifySignedRequest({
      request: signedRequestFrom(keypair),
      now: NOW,
      tick: 50,
      directory: keyring,
      replay: freshStore(),
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;

    const relabelled: AcceptedSignature = { ...accepted.value, principal: other.id };
    const result = verifyArchivedSignature(relabelled, keyring);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('SIGNATURE_INVALID');
  });

  it('a grant issued under a rotated-out key is still valid when audited at its admission tick', () => {
    // The grant version of the same rule: a delegate must not lose its authority
    // because the grantor changed keys, and a grantor must not be able to void its
    // outstanding grants by rotating instead of revoking. Revocation is the
    // sanctioned way out, it posts publicly, and it takes effect next tick.
    //
    // This originally asserted the property through `verifyGrantCredential` at a
    // tick after the rotation, which conflated two different questions. The
    // wave-1 verifier found the other half of that conflation: judging issuer
    // liveness at a signer-chosen tick let a *retired* key mint brand-new grants
    // forever (see rotation-mint.test.ts). Both rules now hold, distinguished by
    // who supplied the tick — the server's admission record here, the current
    // tick when admitting.
    const keyring = newKeyring();
    const grantor = enrol(keyring, 'vale', 10);
    const delegate = enrol(keyring, 'orison', 10);

    const credential = issueGrantCredential({
      claims: {
        id: 'g-1' as GrantId,
        grantor: grantor.id,
        delegate: delegate.id,
        template: 'quartermaster',
        maxDirectLoss: minor(40_000),
        maxContingentLiability: minor(120_000),
        expiresTick: 900,
      },
      issuerKeypair: grantor.keypair,
      issuerDidKey: grantor.keypair.record.didKey,
      delegateDidKey: delegate.keypair.record.didKey,
      issuedAtTick: 20,
      delegationChain: [grantor.id],
    });

    keyring.rotate(grantor.id, generateKeypair().record, 100);

    // Admitted at tick 20, while the key was live.
    expect(verifyGrantCredential(credential, { atTick: 20, directory: keyring }).ok).toBe(true);

    const result = verifyArchivedGrantCredential(credential, {
      atTick: 500,
      directory: keyring,
      admittedAtTick: 20,
    });
    expect(result.ok).toBe(true);
  });
});

describe('SEC-2 — what the keyring refuses', () => {
  it('refuses a second live key for one principal', () => {
    const keyring = newKeyring();
    const { id } = enrol(keyring, 'vale', 10);
    expect(() => keyring.register(id, generateKeypair().record, 20)).toThrow(/already has a live key/);
  });

  it('refuses reviving a retired key, because the archive would become ambiguous', () => {
    const keyring = newKeyring();
    const { id, keypair: oldKey } = enrol(keyring, 'vale', 10);
    keyring.rotate(id, generateKeypair().record, 100);
    expect(() => keyring.rotate(id, oldKey.record, 200)).toThrow(/may not be revived/);
  });

  it('refuses one key registered to two principals', () => {
    const keyring = newKeyring();
    const { keypair } = enrol(keyring, 'vale', 10);
    expect(() => keyring.register('orison' as PrincipalId, keypair.record, 10)).toThrow(
      /already registered to another principal/,
    );
  });

  it('refuses a keyid that is not the thumbprint of the key it names', () => {
    const keyring = newKeyring();
    const real = generateKeypair();
    const forged = { ...real.record, keyid: generateKeypair().keyid };
    expect(() => keyring.register('vale' as PrincipalId, forged, 0)).toThrow(/not the thumbprint/);
  });

  it('refuses rotating a principal that never enrolled', () => {
    expect(() => newKeyring().rotate('ghost' as PrincipalId, generateKeypair().record, 10)).toThrow(
      /no live key to rotate/,
    );
  });

  it('refuses retiring a key before it was registered', () => {
    const keyring = newKeyring();
    const { id } = enrol(keyring, 'vale', 100);
    expect(() => keyring.rotate(id, generateKeypair().record, 50)).toThrow(/before it was registered/);
  });
});
