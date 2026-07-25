/**
 * SEC-3 and PROP-G4 — a grant as a W3C Verifiable Credential.
 *
 * What these tests are protecting: SPEC §8's claim that *"the worst case was shown
 * before you signed"* stops being a promise our interface makes and becomes
 * something the signature proves. That only holds if a credential cannot be edited
 * after issue, cannot outlive its expiry, cannot survive revocation, cannot be
 * issued by someone pretending to be the grantor, and cannot be re-delegated
 * without bound.
 *
 * The tamper test walks **every field** rather than picking two. The signing
 * payload in `vc.ts` is hand-built, so a field left out of it is a field an
 * attacker rewrites freely — and a hand-written tamper test would only ever catch
 * the fields its author remembered.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { minor } from '../../src/core/units.js';
import type { GrantId, PrincipalId } from '../../src/core/types.js';
import {
  CRYPTOSUITE,
  GRANT_CREDENTIAL_TYPE,
  MAX_DELEGATION_DEPTH,
  VC_CONTEXT_V2,
  generateKeypair,
  grantFromCredential,
  isExpiredAt,
  isRevokedAt,
  issueGrantCredential,
  claimsFromCredential,
  claimsOf,
  signGrantCredential,
  verificationMethodFor,
  verifyGrantCredential,
} from '../../src/identity/index.js';
import type { CredentialRejection, GrantCredential, GrantClaims } from '../../src/identity/index.js';
import { enrol, newKeyring } from './helpers.js';

const ISSUED_AT = 20;
const EXPIRES_AT = 900;
const NOW_TICK = 500;

function claims(overrides: Partial<GrantClaims> = {}): GrantClaims {
  return {
    id: 'g-1' as GrantId,
    grantor: 'vale' as PrincipalId,
    delegate: 'orison' as PrincipalId,
    template: 'quartermaster',
    maxDirectLoss: minor(40_000),
    maxContingentLiability: minor(120_000),
    expiresTick: EXPIRES_AT,
    ...overrides,
  };
}

interface Fixture {
  readonly keyring: ReturnType<typeof newKeyring>;
  readonly grantor: ReturnType<typeof enrol>;
  readonly delegate: ReturnType<typeof enrol>;
  readonly credential: GrantCredential;
}

function issued(overrides: Partial<GrantClaims> = {}, chain?: readonly PrincipalId[]): Fixture {
  const keyring = newKeyring();
  const grantor = enrol(keyring, 'vale', 0);
  const delegate = enrol(keyring, 'orison', 0);
  const m = claims({ grantor: grantor.id, delegate: delegate.id, ...overrides });
  const credential = issueGrantCredential({
    claims: m,
    issuerKeypair: grantor.keypair,
    issuerDidKey: grantor.keypair.record.didKey,
    delegateDidKey: delegate.keypair.record.didKey,
    issuedAtTick: ISSUED_AT,
    delegationChain: chain ?? [m.grantor],
  });
  return { keyring, grantor, delegate, credential };
}

describe('a grant serialises as a Verifiable Credential', () => {
  it('has the VC envelope, a did:key issuer, and tick-based validity', () => {
    const { credential, grantor, delegate } = issued();
    expect(credential['@context'][0]).toBe(VC_CONTEXT_V2);
    expect(credential.type).toContain('VerifiableCredential');
    expect(credential.type).toContain(GRANT_CREDENTIAL_TYPE);
    expect(credential.id).toBe('urn:compact:grant:g-1');
    expect(credential.issuer.id).toBe(grantor.keypair.record.didKey);
    expect(credential.issuer.principal).toBe(grantor.id);
    expect(credential.credentialSubject.id).toBe(delegate.keypair.record.didKey);
    // Validity is in ticks, not dates: a grant expires at a Reckoning-stamped
    // tick, and a parallel wall-clock date would be a second home for it.
    expect(credential.validFromTick).toBe(ISSUED_AT);
    expect(credential.validUntilTick).toBe(EXPIRES_AT);
    expect(credential.proof.cryptosuite).toBe(CRYPTOSUITE);
    expect(credential.proof.verificationMethod).toBe(verificationMethodFor(grantor.keypair.record.didKey));
    expect(credential.proof.proofValue.startsWith('z')).toBe(true);
  });

  it('shows the limits SPEC §8 says must be shown before signing', () => {
    const { credential } = issued();
    expect(credential.credentialSubject.maxDirectLoss).toBe(40_000);
    expect(credential.credentialSubject.maxContingentLiability).toBe(120_000);
    expect(credential.credentialSubject.template).toBe('quartermaster');
  });

  it('verifies offline, with no directory and no network', () => {
    // SPEC §8: "a delegate can verify its own authority offline, a counterparty
    // can verify a delegate's authority before dealing with it." The key material
    // is inside the did:key, so this needs nothing but the credential.
    const { credential } = issued();
    expect(verifyGrantCredential(credential, { atTick: NOW_TICK }).ok).toBe(true);
  });

  it('verifies after a JSON round trip, which is how it will actually travel', () => {
    const { credential, keyring } = issued();
    const wire: unknown = JSON.parse(JSON.stringify(credential));
    const result = verifyGrantCredential(wire, { atTick: NOW_TICK, directory: keyring });
    expect(result.ok).toBe(true);
  });
});

/**
 * Re-sign a credential body with an arbitrary patch, using the production signing
 * path. This is how the suite produces properly-signed credentials that
 * `issueGrantCredential` refuses to make — which is what proves the verifier does
 * not rely on the issuer having been honest.
 */
function reissue(
  credential: GrantCredential,
  patch: Partial<Omit<GrantCredential, 'proof'>>,
  keypair: ReturnType<typeof generateKeypair>,
): GrantCredential {
  const { proof, ...unsigned } = credential;
  return signGrantCredential({ ...unsigned, ...patch }, keypair, proof.createdAtTick);
}

/** Drop one member, to check the verifier notices its absence rather than crashing. */
function without(credential: GrantCredential, key: keyof GrantCredential): Record<string, unknown> {
  return Object.fromEntries(Object.entries(credential).filter(([k]) => k !== key));
}

describe('SEC-3 — every rejection, each distinguishable', () => {
  /**
   * Accumulated across the `it` blocks in order, and asserted exactly at the end.
   * Reordering the tests would change what the final assertion sees, which is why
   * it asserts set equality rather than a count.
   */
  const seen = new Set<CredentialRejection>();

  function expectRefusal(
    candidate: unknown,
    reason: CredentialRejection,
    options: Parameters<typeof verifyGrantCredential>[1] = { atTick: NOW_TICK },
  ): void {
    const result = verifyGrantCredential(candidate, options);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(reason);
    expect(result.detail.length).toBeGreaterThan(10);
    seen.add(result.reason);
  }

  it('CREDENTIAL_TAMPERED — every mutable field is covered by the proof', () => {
    const { credential } = issued();
    // Walk the credential and mutate each leaf in turn. Keeping this exhaustive is
    // the only defence against a field quietly falling out of the signed payload.
    const mutations: readonly (readonly [string, GrantCredential])[] = [
      ['@context', { ...credential, '@context': [VC_CONTEXT_V2, 'https://evil.example/ctx'] }],
      ['id', { ...credential, id: 'urn:compact:grant:g-2' }],
      ['type', { ...credential, type: ['VerifiableCredential', GRANT_CREDENTIAL_TYPE, 'Extra'] }],
      [
        'issuer.principal',
        { ...credential, issuer: { ...credential.issuer, principal: 'kell' as PrincipalId } },
      ],
      ['validFromTick', { ...credential, validFromTick: 1 }],
      ['validUntilTick', { ...credential, validUntilTick: 99_999 }],
      [
        'subject.id',
        { ...credential, credentialSubject: { ...credential.credentialSubject, id: 'did:key:z6MkOther' } },
      ],
      [
        'subject.principal',
        {
          ...credential,
          credentialSubject: { ...credential.credentialSubject, principal: 'kell' as PrincipalId },
        },
      ],
      [
        'subject.template',
        { ...credential, credentialSubject: { ...credential.credentialSubject, template: 'treasurer' } },
      ],
      [
        'subject.maxDirectLoss',
        {
          ...credential,
          credentialSubject: { ...credential.credentialSubject, maxDirectLoss: minor(9_000_000) },
        },
      ],
      [
        'subject.maxContingentLiability',
        {
          ...credential,
          credentialSubject: { ...credential.credentialSubject, maxContingentLiability: minor(9_000_000) },
        },
      ],
      [
        'subject.delegationChain',
        {
          ...credential,
          credentialSubject: {
            ...credential.credentialSubject,
            delegationChain: [...credential.credentialSubject.delegationChain, 'kell' as PrincipalId],
          },
        },
      ],
      ['proof.createdAtTick', { ...credential, proof: { ...credential.proof, createdAtTick: 1 } }],
      ['proof.proofValue', { ...credential, proof: { ...credential.proof, proofValue: 'z11111111' } }],
      [
        // Swapping the issuer key *and* the verificationMethod together keeps the
        // credential internally consistent, so the structural check passes and the
        // proof is what catches it — which proves issuer.id is inside the payload.
        'issuer.id + verificationMethod',
        (() => {
          const stranger = generateKeypair();
          return {
            ...credential,
            issuer: { ...credential.issuer, id: stranger.record.didKey },
            proof: {
              ...credential.proof,
              verificationMethod: verificationMethodFor(stranger.record.didKey),
            },
          };
        })(),
      ],
    ];

    for (const [label, mutated] of mutations) {
      const result = verifyGrantCredential(mutated, { atTick: NOW_TICK });
      expect(result.ok, `mutating ${label} must break the proof`).toBe(false);
      if (!result.ok) expect(result.reason, label).toBe('CREDENTIAL_TAMPERED');
    }
    // Three signed fields are *not* in this list because a structural check
    // catches them first, each with its own reason: `proof.cryptosuite`
    // (PROOF_CRYPTOSUITE_UNSUPPORTED), `proof.proofPurpose` (PROOF_MALFORMED), and
    // `proof.verificationMethod` alone (CREDENTIAL_WRONG_ISSUER). All three have
    // their own tests below, and all three are inside the signed payload.
    seen.add('CREDENTIAL_TAMPERED');
  });

  it('CREDENTIAL_EXPIRED — a grant is live through its expiry tick and dead after', () => {
    const { credential } = issued();
    expect(verifyGrantCredential(credential, { atTick: EXPIRES_AT }).ok).toBe(true);
    expectRefusal(credential, 'CREDENTIAL_EXPIRED', { atTick: EXPIRES_AT + 1 });
    expect(isExpiredAt(EXPIRES_AT, EXPIRES_AT)).toBe(false);
    expect(isExpiredAt(EXPIRES_AT, EXPIRES_AT + 1)).toBe(true);
  });

  it('CREDENTIAL_NOT_YET_VALID — before the issuing tick', () => {
    const { credential } = issued();
    expectRefusal(credential, 'CREDENTIAL_NOT_YET_VALID', { atTick: ISSUED_AT - 1 });
  });

  it('CREDENTIAL_REVOKED — revocation takes effect the tick after it is accepted', () => {
    const { credential } = issued();
    // SPEC §8.1 #6: revocation is always accepted and takes effect next tick.
    expect(verifyGrantCredential(credential, { atTick: 300, revokedAtTick: 300 }).ok).toBe(true);
    expectRefusal(credential, 'CREDENTIAL_REVOKED', { atTick: 301, revokedAtTick: 300 });
    expect(isRevokedAt(300, 300)).toBe(false);
    expect(isRevokedAt(300, 301)).toBe(true);
    expect(isRevokedAt(null, 99_999)).toBe(false);
  });

  it('CREDENTIAL_WRONG_ISSUER — the proof points at a key the issuer does not own', () => {
    const { credential } = issued();
    const stranger = generateKeypair();
    // Form one: caught structurally, before any curve operation.
    expectRefusal(
      {
        ...credential,
        proof: { ...credential.proof, verificationMethod: verificationMethodFor(stranger.record.didKey) },
      },
      'CREDENTIAL_WRONG_ISSUER',
    );
  });

  it('CREDENTIAL_WRONG_ISSUER — a validly signed credential claiming another principal', () => {
    // Form two: the impostor signs correctly with its own key and simply claims to
    // be the grantor. The crypto is fine; only the directory can catch this, which
    // is why the binding check exists at all.
    const keyring = newKeyring();
    const victim = enrol(keyring, 'vale', 0);
    const impostor = enrol(keyring, 'kell', 0);
    const delegate = enrol(keyring, 'orison', 0);
    const forged = issueGrantCredential({
      claims: claims({ grantor: victim.id, delegate: delegate.id }),
      issuerKeypair: impostor.keypair,
      issuerDidKey: impostor.keypair.record.didKey,
      delegateDidKey: delegate.keypair.record.didKey,
      issuedAtTick: ISSUED_AT,
      delegationChain: [victim.id],
    });
    // Offline, it verifies cryptographically — it is a real credential from a real
    // key. The claim it makes about *whose* key is what fails.
    expect(verifyGrantCredential(forged, { atTick: NOW_TICK }).ok).toBe(true);
    expectRefusal(forged, 'CREDENTIAL_WRONG_ISSUER', { atTick: NOW_TICK, directory: keyring });
  });

  it('CREDENTIAL_ISSUER_KEY_UNKNOWN — a key this world has never seen', () => {
    const keyring = newKeyring();
    const outsider = generateKeypair();
    const delegate = enrol(keyring, 'orison', 0);
    const credential = issueGrantCredential({
      claims: claims({ grantor: 'ghost' as PrincipalId, delegate: delegate.id }),
      issuerKeypair: outsider,
      issuerDidKey: outsider.record.didKey,
      delegateDidKey: delegate.keypair.record.didKey,
      issuedAtTick: ISSUED_AT,
      delegationChain: ['ghost' as PrincipalId],
    });
    expectRefusal(credential, 'CREDENTIAL_ISSUER_KEY_UNKNOWN', { atTick: NOW_TICK, directory: keyring });
  });

  it('CREDENTIAL_CHAIN_TOO_DEEP — depth is computed from the chain, not self-reported', () => {
    const chain = ['a', 'b', 'c', 'vale'].map((s) => s as PrincipalId);
    const { credential } = issued({}, chain);
    expect(credential.credentialSubject.delegationChain).toHaveLength(4);
    expectRefusal(credential, 'CREDENTIAL_CHAIN_TOO_DEEP');
    // And it is a limit, not a wall: three deep is fine by default.
    const shallow = issued({}, ['a', 'b', 'vale'].map((s) => s as PrincipalId));
    expect(shallow.credential.credentialSubject.delegationChain).toHaveLength(MAX_DELEGATION_DEPTH);
    expect(verifyGrantCredential(shallow.credential, { atTick: NOW_TICK }).ok).toBe(true);
  });

  it('CREDENTIAL_CHAIN_CYCLE — a principal may not be its own delegate (INV-23)', () => {
    // A→B→A launders unlimited self-authority into a namespace where the limits
    // were stripped (SPEC §8.1 #4).
    const cyclic = issued({ delegate: 'a' as PrincipalId }, ['a' as PrincipalId, 'vale' as PrincipalId]);
    expectRefusal(cyclic.credential, 'CREDENTIAL_CHAIN_CYCLE');

    const repeated = issued({}, ['a', 'a', 'vale'].map((s) => s as PrincipalId));
    const result = verifyGrantCredential(repeated.credential, { atTick: NOW_TICK });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('CREDENTIAL_CHAIN_CYCLE');
  });

  it('CREDENTIAL_CHAIN_INCOHERENT — the chain must end at the issuing principal', () => {
    // Properly signed, and still refused: the issuer's own checks are conveniences
    // and the verifier does not depend on them having run.
    const { credential, grantor } = issued();
    const forged = reissue(
      credential,
      {
        credentialSubject: { ...credential.credentialSubject, delegationChain: ['kell' as PrincipalId] },
      },
      grantor.keypair,
    );
    expectRefusal(forged, 'CREDENTIAL_CHAIN_INCOHERENT');
  });

  it('CREDENTIAL_LIMITS_INVALID — a negative limit is not a claims', () => {
    const { credential, grantor } = issued();
    const negative = reissue(
      credential,
      { credentialSubject: { ...credential.credentialSubject, maxDirectLoss: minor(-1) } },
      grantor.keypair,
    );
    expectRefusal(negative, 'CREDENTIAL_LIMITS_INVALID');
  });

  it('CREDENTIAL_MALFORMED — a validity window that runs backwards', () => {
    const { credential, grantor } = issued();
    const backwards = reissue(credential, { validFromTick: 900, validUntilTick: 20 }, grantor.keypair);
    expectRefusal(backwards, 'CREDENTIAL_MALFORMED', { atTick: 1000 });
  });

  it('CREDENTIAL_MALFORMED — not a credential at all', () => {
    expectRefusal(null, 'CREDENTIAL_MALFORMED');
    expectRefusal('urn:compact:grant:g-1', 'CREDENTIAL_MALFORMED');
    expectRefusal([], 'CREDENTIAL_MALFORMED');
    const { credential } = issued();
    expectRefusal(without(credential, 'id'), 'CREDENTIAL_MALFORMED');
  });

  it('CREDENTIAL_CONTEXT_UNSUPPORTED — a credential in an unknown data model', () => {
    const { credential } = issued();
    expectRefusal({ ...credential, '@context': ['https://example.com/other'] }, 'CREDENTIAL_CONTEXT_UNSUPPORTED');
  });

  it('CREDENTIAL_TYPE_UNSUPPORTED — a credential that is not a grant', () => {
    const { credential } = issued();
    expectRefusal({ ...credential, type: ['VerifiableCredential'] }, 'CREDENTIAL_TYPE_UNSUPPORTED');
  });

  it('PROOF_MISSING — a credential with no proof asserts nothing', () => {
    const { credential } = issued();
    expectRefusal(without(credential, 'proof'), 'PROOF_MISSING');
  });

  it('PROOF_MALFORMED — a proof block missing what a verifier needs', () => {
    const { credential } = issued();
    expectRefusal({ ...credential, proof: { ...credential.proof, proofPurpose: 'keyAgreement' } }, 'PROOF_MALFORMED');
  });

  it('PROOF_CRYPTOSUITE_UNSUPPORTED — a suite we do not implement', () => {
    const { credential } = issued();
    expectRefusal(
      { ...credential, proof: { ...credential.proof, cryptosuite: 'eddsa-jcs-2022' } },
      'PROOF_CRYPTOSUITE_UNSUPPORTED',
    );
  });

  it('a proofValue that is not multibase base58btc is a proof problem, not a tamper', () => {
    const { credential } = issued();
    expectRefusal({ ...credential, proof: { ...credential.proof, proofValue: 'AAAA' } }, 'PROOF_MALFORMED');
  });

  it('exercised exactly these reasons, so no two conditions collapsed into one', () => {
    // Runs last in the describe, so `seen` holds every reason the suite produced.
    // Set equality rather than a count: a new condition that reuses an existing
    // reason would pass a count check and fail this one.
    expect([...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([
      'CREDENTIAL_CHAIN_CYCLE',
      'CREDENTIAL_CHAIN_INCOHERENT',
      'CREDENTIAL_CHAIN_TOO_DEEP',
      'CREDENTIAL_CONTEXT_UNSUPPORTED',
      'CREDENTIAL_EXPIRED',
      'CREDENTIAL_ISSUER_KEY_UNKNOWN',
      'CREDENTIAL_LIMITS_INVALID',
      'CREDENTIAL_MALFORMED',
      'CREDENTIAL_NOT_YET_VALID',
      'CREDENTIAL_REVOKED',
      'CREDENTIAL_TAMPERED',
      'CREDENTIAL_TYPE_UNSUPPORTED',
      'CREDENTIAL_WRONG_ISSUER',
      'PROOF_CRYPTOSUITE_UNSUPPORTED',
      'PROOF_MALFORMED',
      'PROOF_MISSING',
    ]);
  });
});

describe('PROP-G4 — round-trip', () => {
  it('any claims survives issue → verify → read back', () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.string({ minLength: 1, maxLength: 24 }).filter((s) => !s.includes(' ')),
          template: fc.string({ minLength: 1, maxLength: 32 }),
          maxDirectLoss: fc.nat({ max: 1_000_000_000 }),
          maxContingentLiability: fc.nat({ max: 1_000_000_000 }),
          issuedAtTick: fc.nat({ max: 100_000 }),
          life: fc.nat({ max: 100_000 }),
        }),
        (raw) => {
          const keyring = newKeyring();
          const grantor = enrol(keyring, 'vale', 0);
          const delegate = enrol(keyring, 'orison', 0);
          const m: GrantClaims = {
            id: raw.id as GrantId,
            grantor: grantor.id,
            delegate: delegate.id,
            template: raw.template,
            maxDirectLoss: minor(raw.maxDirectLoss),
            maxContingentLiability: minor(raw.maxContingentLiability),
            expiresTick: raw.issuedAtTick + raw.life,
          };
          const credential = issueGrantCredential({
            claims: m,
            issuerKeypair: grantor.keypair,
            issuerDidKey: grantor.keypair.record.didKey,
            delegateDidKey: delegate.keypair.record.didKey,
            issuedAtTick: raw.issuedAtTick,
            delegationChain: [m.grantor],
          });

          const wire: unknown = JSON.parse(JSON.stringify(credential));
          const verified = verifyGrantCredential(wire, {
            atTick: raw.issuedAtTick,
            directory: keyring,
          });
          expect(verified.ok).toBe(true);
          if (!verified.ok) return;
          expect(claimsFromCredential(verified.value)).toEqual(m);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('claimsOf drops exactly the live server state, and grantFromCredential zeroes it', () => {
    const { credential } = issued();
    const grant = grantFromCredential(credential);
    expect(claimsOf(grant)).toEqual(claimsFromCredential(credential));
    // Deliberate: spend is server state that changes every act. Signing it would
    // mean reissuing the credential per act and would give one quantity two homes
    // (scar #5). A restoring caller must reconcile spend from the ledger; the
    // failure mode is under-counting, never believing a credential about it.
    expect(grant.spentDirect).toBe(0);
    expect(grant.spentContingent).toBe(0);
    expect(grant.revokedAtTick).toBeNull();
  });

  it('refuses to issue a credential that expires before it is granted', () => {
    const keyring = newKeyring();
    const grantor = enrol(keyring, 'vale', 0);
    const delegate = enrol(keyring, 'orison', 0);
    expect(() =>
      issueGrantCredential({
        claims: claims({ grantor: grantor.id, delegate: delegate.id, expiresTick: 10 }),
        issuerKeypair: grantor.keypair,
        issuerDidKey: grantor.keypair.record.didKey,
        delegateDidKey: delegate.keypair.record.didKey,
        issuedAtTick: 20,
        delegationChain: [grantor.id],
      }),
    ).toThrow(/cannot expire before it is issued/);
  });

  it('refuses to issue a credential whose chain does not end at the grantor', () => {
    const keyring = newKeyring();
    const grantor = enrol(keyring, 'vale', 0);
    const delegate = enrol(keyring, 'orison', 0);
    expect(() =>
      issueGrantCredential({
        claims: claims({ grantor: grantor.id, delegate: delegate.id }),
        issuerKeypair: grantor.keypair,
        issuerDidKey: grantor.keypair.record.didKey,
        delegateDidKey: delegate.keypair.record.didKey,
        issuedAtTick: ISSUED_AT,
        delegationChain: ['kell' as PrincipalId],
      }),
    ).toThrow(/must end at the issuing grantor/);
  });
});
