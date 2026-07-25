/**
 * A **grant**, serialised as a W3C Verifiable Credential (SPEC §8).
 *
 * Why this is not decoration: a delegate can verify its own authority offline, a
 * counterparty can verify a delegate's claims *before* dealing with it, and the
 * betrayal replay shows a credential chain rather than a database row — the
 * claims, the limit it stayed inside, each renewal that extended it, and the
 * deed. *"The worst case was shown before you signed"* stops being a promise our
 * interface makes and becomes something the signature proves.
 *
 * Three deliberate departures from a textbook VC, each stated rather than
 * discovered later:
 *
 *  1. **Validity is in ticks, not dates.** VCDM's `validFrom`/`validUntil` are
 *     XML dateTimes. A grant expires at a Reckoning-stamped `expires_tick` (SPEC
 *     §8.1 #5), and carrying a wall-clock date beside it would be two homes for
 *     one quantity (scar #5) *and* would not compress with the speed setting. So
 *     `validFromTick`/`validUntilTick`, as extension properties.
 *  2. **The cryptosuite is ours: `eddsa-compact-c1`.** The standard `eddsa-jcs-2022`
 *     requires JCS (RFC 8785) canonicalisation. This codebase has exactly one
 *     canonicaliser — `core/canonical.ts`, the same one that produces `terms_hash`
 *     — and a second one would be a second way to hash the same terms. A hash
 *     mismatch reads to an agent as *the counterparty reneging*, which is the A5′
 *     failure. One canonicaliser, named honestly in the proof.
 *  3. **Spend is not in the credential.** `spentDirect`/`spentContingent` are
 *     server state that changes every act; signing them would mean reissuing the
 *     credential per act and would give a quantity two homes. The credential is
 *     the *claims*; headroom is looked up.
 *
 * The claims is a **GRANT** and its bounds are **LIMITS** (SPEC §3). Neither word
 * is reused here for anything else.
 */

import { canonicalize } from '../core/canonical.js';
import type { CanonicalValue } from '../core/canonical.js';
import type { Grant, GrantId, PrincipalId } from '../core/types.js';
import type { Minor } from '../core/units.js';
import { minor } from '../core/units.js';
import { decodeBase58, encodeBase58 } from './encoding.js';
import type { AgentKeypair, PublicKeyJwk } from './keys.js';
import { jwkFromDidKey, thumbprint, verifyBytes } from './keys.js';
import type { KeyDirectory } from './keyring.js';
import { keyLiveAt } from './keyring.js';
import type { CredentialRejection, Verified } from './reasons.js';
import { IdentityError, accept, refuse } from './reasons.js';

export const VC_CONTEXT_V2 = 'https://www.w3.org/ns/credentials/v2';

/**
 * Our extension context. **Must actually be served before any third party is
 * asked to verify** — a context URL that 404s makes the credential unprocessable
 * by a conforming JSON-LD verifier. Tracked as an outstanding deliverable.
 */
export const COMPACT_CONTEXT = 'https://agenttransfer.dev/compact/credentials/v1';

export const VERIFIABLE_CREDENTIAL_TYPE = 'VerifiableCredential';
export const GRANT_CREDENTIAL_TYPE = 'CompactGrantCredential';
export const CRYPTOSUITE = 'eddsa-compact-c1';
export const GRANT_URN_PREFIX = 'urn:compact:grant:';

/**
 * Maximum delegation depth, counting the root grantor as 1 — so the default
 * permits the owner, its delegate, and one re-delegation.
 *
 * *(calibrate)*. SPEC §8.1 #4 requires depth to be computed over the transitive
 * closure and cycles rejected at grant time, but §17 does not name the number.
 * Noted as a parameter that belongs in §17.
 */
export const MAX_DELEGATION_DEPTH = 3;

// ── the credential ──────────────────────────────────────────────────────────

export interface CredentialIssuer {
  /** `did:key:z…` — the key *is* the identifier, so this verifies with no lookup. */
  readonly id: string;
  /** The ledger key. Binding it to the did:key is the directory's job. */
  readonly principal: PrincipalId;
}

export interface GrantCredentialSubject {
  /** The delegate's `did:key`. */
  readonly id: string;
  readonly principal: PrincipalId;
  readonly template: string;
  readonly maxDirectLoss: Minor;
  readonly maxContingentLiability: Minor;
  /**
   * Root grantor first, this credential's issuer last. Depth is its length, so
   * the chain is the thing checked rather than a self-reported number (SPEC §8.1
   * #4: computed over the transitive closure, cycles rejected).
   */
  readonly delegationChain: readonly PrincipalId[];
}

export interface GrantProofOptions {
  readonly type: 'DataIntegrityProof';
  readonly cryptosuite: string;
  readonly proofPurpose: 'assertionMethod';
  /** `did:key:z…#z…` — the fragment repeats the key, as did:key requires. */
  readonly verificationMethod: string;
  /** Ticks, for the same reason validity is in ticks. */
  readonly createdAtTick: number;
}

export interface GrantProof extends GrantProofOptions {
  /** Multibase base58btc (`z`-prefixed), as Data Integrity proofs are written. */
  readonly proofValue: string;
}

export interface GrantCredential {
  readonly '@context': readonly string[];
  readonly id: string;
  readonly type: readonly string[];
  readonly issuer: CredentialIssuer;
  readonly validFromTick: number;
  readonly validUntilTick: number;
  readonly credentialSubject: GrantCredentialSubject;
  readonly proof: GrantProof;
}

/** The signed half of a {@link Grant}: what the credential carries, and no more. */
export interface GrantClaims {
  readonly id: GrantId;
  readonly grantor: PrincipalId;
  readonly delegate: PrincipalId;
  readonly template: string;
  readonly maxDirectLoss: Minor;
  readonly maxContingentLiability: Minor;
  readonly expiresTick: number;
}

export function claimsOf(grant: Grant): GrantClaims {
  return {
    id: grant.id,
    grantor: grant.grantor,
    delegate: grant.delegate,
    template: grant.template,
    maxDirectLoss: grant.maxDirectLoss,
    maxContingentLiability: grant.maxContingentLiability,
    expiresTick: grant.expiresTick,
  };
}

// ── the two clock rules, defined once ───────────────────────────────────────

/**
 * SPEC §8.1 #6: **revocation takes effect next tick.** So a grant revoked at tick
 * R is still live at R and dead from R+1. Exported because the grants module must
 * apply the same rule; two implementations of one rule is scar #5 in logic form.
 */
export function isRevokedAt(revokedAtTick: number | null, atTick: number): boolean {
  return revokedAtTick !== null && atTick > revokedAtTick;
}

/** A grant is live **through** `expiresTick` inclusive, and dead from the next tick. */
export function isExpiredAt(expiresTick: number, atTick: number): boolean {
  return atTick > expiresTick;
}

// ── issuing ─────────────────────────────────────────────────────────────────

export interface IssueGrantCredentialOptions {
  readonly claims: GrantClaims;
  readonly issuerKeypair: AgentKeypair;
  readonly issuerDidKey: string;
  /** The delegate's `did:key`, so a counterparty can bind holder to credential. */
  readonly delegateDidKey: string;
  readonly issuedAtTick: number;
  /**
   * Root grantor first, issuer last. For a first-hand grant this is
   * `[claims.grantor]`; a re-delegation appends.
   */
  readonly delegationChain: readonly PrincipalId[];
}

export function issueGrantCredential(options: IssueGrantCredentialOptions): GrantCredential {
  const { claims } = options;
  if (claims.expiresTick < options.issuedAtTick) {
    throw new IdentityError('a grant cannot expire before it is issued');
  }
  const chain = options.delegationChain;
  if (chain.length === 0 || chain[chain.length - 1] !== claims.grantor) {
    throw new IdentityError('the delegation chain must end at the issuing grantor');
  }

  const unsigned = {
    '@context': [VC_CONTEXT_V2, COMPACT_CONTEXT],
    id: `${GRANT_URN_PREFIX}${claims.id}`,
    type: [VERIFIABLE_CREDENTIAL_TYPE, GRANT_CREDENTIAL_TYPE],
    issuer: { id: options.issuerDidKey, principal: claims.grantor },
    validFromTick: options.issuedAtTick,
    validUntilTick: claims.expiresTick,
    credentialSubject: {
      id: options.delegateDidKey,
      principal: claims.delegate,
      template: claims.template,
      maxDirectLoss: claims.maxDirectLoss,
      maxContingentLiability: claims.maxContingentLiability,
      delegationChain: chain,
    },
  } satisfies Omit<GrantCredential, 'proof'>;

  return signGrantCredential(unsigned, options.issuerKeypair, options.issuedAtTick);
}

/**
 * Sign a credential body. The **one** signing path: `issueGrantCredential` builds
 * a well-formed body and calls this, and nothing else constructs a proof.
 *
 * Exported deliberately, because the *verifier* is the security boundary and the
 * issuer's checks are only conveniences. Proving the verifier stands alone means
 * being able to produce credentials the issuer would refuse to make — a chain that
 * does not end at the grantor, a negative limit — and signing them properly. If
 * this were private, those tests would have to reimplement the signing payload,
 * which would then drift from the real one and quietly stop testing anything.
 *
 * The proof always points at the credential's own declared issuer, so a credential
 * can never be *created* naming one issuer and pointing at another key.
 */
export function signGrantCredential(
  unsigned: Omit<GrantCredential, 'proof'>,
  issuerKeypair: AgentKeypair,
  createdAtTick: number,
): GrantCredential {
  const proofOptions: GrantProofOptions = {
    type: 'DataIntegrityProof',
    cryptosuite: CRYPTOSUITE,
    proofPurpose: 'assertionMethod',
    verificationMethod: verificationMethodFor(unsigned.issuer.id),
    createdAtTick,
  };
  const payload = canonicalize(signingPayload(unsigned, proofOptions));
  const signature = issuerKeypair.sign(Buffer.from(payload, 'utf8'));
  return { ...unsigned, proof: { ...proofOptions, proofValue: `z${encodeBase58(signature)}` } };
}

/**
 * Exactly what the proof covers, built by hand and in one place.
 *
 * Hand-building is the hazard here — a field left out of this function is a field
 * an attacker may rewrite freely. `test/identity/vc.test.ts` walks every field of
 * a credential, mutates it, and asserts the proof breaks, which is the only way
 * to keep this list honest as fields are added.
 *
 * The **proof options are signed too**, so the `verificationMethod` cannot be
 * swapped to another key and the `createdAtTick` cannot be backdated.
 */
function signingPayload(
  credential: Omit<GrantCredential, 'proof'>,
  proofOptions: GrantProofOptions,
): CanonicalValue {
  return {
    '@context': [...credential['@context']],
    id: credential.id,
    type: [...credential.type],
    issuer: { id: credential.issuer.id, principal: credential.issuer.principal },
    validFromTick: credential.validFromTick,
    validUntilTick: credential.validUntilTick,
    credentialSubject: {
      id: credential.credentialSubject.id,
      principal: credential.credentialSubject.principal,
      template: credential.credentialSubject.template,
      maxDirectLoss: credential.credentialSubject.maxDirectLoss,
      maxContingentLiability: credential.credentialSubject.maxContingentLiability,
      delegationChain: [...credential.credentialSubject.delegationChain],
    },
    proof: {
      type: proofOptions.type,
      cryptosuite: proofOptions.cryptosuite,
      proofPurpose: proofOptions.proofPurpose,
      verificationMethod: proofOptions.verificationMethod,
      createdAtTick: proofOptions.createdAtTick,
    },
  };
}

/** did:key convention: the fragment repeats the multibase key. */
/**
 * Re-verify a credential the world has already admitted.
 *
 * The two modes exist because rotation has to do two opposite-looking things at
 * once, and the wave-1 verifier found we had only implemented one of them:
 *
 *   - **Rotation is prospective.** A grant validly issued under a key that later
 *     rotated stays valid. Otherwise every grantor holds a delete button for its
 *     own outstanding authority — rotate instead of revoking, and the delegate's
 *     mandate silently evaporates. Revocation is the sanctioned exit; it posts
 *     publicly and takes effect next tick.
 *   - **A retired key cannot mint.** Judging liveness at `validFromTick` (a field
 *     the signer picks and signs) meant a leaked-then-rotated key could keep
 *     issuing new credentials forever by back-dating. Rotation would have
 *     contained nothing.
 *
 * The only thing that separates the two cases is *who* supplied the tick. Here it
 * is the server's own admission record; in `verifyGrantCredential` it is the
 * current tick. Neither is ever taken from the credential.
 */
export function verifyArchivedGrantCredential(
  candidate: unknown,
  options: VerifyGrantCredentialOptions & { readonly admittedAtTick: number },
): Verified<GrantCredential, CredentialRejection> {
  return verifyGrantCredential(candidate, options);
}

export function verificationMethodFor(didKey: string): string {
  const z = didKey.slice('did:key:'.length);
  return `${didKey}#${z}`;
}

// ── verifying ───────────────────────────────────────────────────────────────

export interface VerifyGrantCredentialOptions {
  /** Game time. Everything about a grant's life is measured in ticks. */
  readonly atTick: number;
  /**
   * Revocation state, which a credential cannot carry about itself. Omit to
   * verify offline — a delegate checking its own claims, or a counterparty with
   * no directory, both of which SPEC §8 promises are possible.
   */
  readonly revokedAtTick?: number | null | undefined;
  /**
   * Supply to bind the issuer's key to its principal. Without it, verification is
   * cryptographic and structural only: it proves *this key issued this claims*,
   * not *this key is that principal's*.
   */
  readonly directory?: KeyDirectory | undefined;
  readonly maxDepth?: number | undefined;
  /**
   * The tick the **server** recorded as this credential's admission.
   *
   * Omit it and you are ADMITTING: the issuer key must be live right now, which
   * is what stops a retired key from minting. Supply it and you are AUDITING a
   * credential already in the world, so liveness is judged at the recorded
   * admission tick — which is what keeps rotation prospective.
   *
   * There is deliberately no safe default for this, so callers must say which
   * they mean. Prefer `verifyArchivedGrantCredential` for the audit case; it
   * exists so the distinction is visible at the call site rather than in an
   * options bag.
   */
  readonly admittedAtTick?: number | undefined;
}

export function verifyGrantCredential(
  candidate: unknown,
  options: VerifyGrantCredentialOptions,
): Verified<GrantCredential, CredentialRejection> {
  const parsed = parseCredential(candidate);
  if (!parsed.ok) return parsed;
  const credential = parsed.value;

  // ── the proof, and the key it points at ─────────────────────────────────
  const issuerJwk = jwkFromDidKey(credential.issuer.id);
  if (issuerJwk === null) {
    return refuse('CREDENTIAL_MALFORMED', `issuer id is not a did:key: ${credential.issuer.id}`);
  }
  if (credential.proof.verificationMethod !== verificationMethodFor(credential.issuer.id)) {
    // The credential names one issuer and points the verifier at a different
    // key. Caught before any crypto: this is a wrong issuer, not a bad signature.
    return refuse(
      'CREDENTIAL_WRONG_ISSUER',
      `proof verificationMethod ${credential.proof.verificationMethod} does not belong to issuer ${credential.issuer.id}`,
    );
  }
  const signature = decodeMultibaseBase58(credential.proof.proofValue);
  if (signature === null) {
    return refuse('PROOF_MALFORMED', 'proofValue is not multibase base58btc (expected a leading "z")');
  }

  const payload = canonicalize(signingPayload(credential, proofOptionsOf(credential.proof)));
  if (!verifyBytes(issuerJwk, Buffer.from(payload, 'utf8'), signature)) {
    return refuse(
      'CREDENTIAL_TAMPERED',
      'the proof does not verify over the credential: it was altered after issue, or signed by another key',
    );
  }

  // ── who the issuer actually is ──────────────────────────────────────────
  if (options.directory !== undefined) {
    // issuerKeyLiveAtTick lets an AUDIT re-verify an archived grant against the
    // tick the server recorded as accepted, exactly as verifyArchivedSignature
    // does. Admitting a NEW credential must use the current tick.
    const bound = bindIssuer(
      credential,
      issuerJwk,
      options.directory,
      options.admittedAtTick ?? options.atTick,
    );
    if (!bound.ok) return bound;
  }

  // ── the chain ───────────────────────────────────────────────────────────
  const chain = credential.credentialSubject.delegationChain;
  if (chain.length === 0 || chain[chain.length - 1] !== credential.issuer.principal) {
    return refuse(
      'CREDENTIAL_CHAIN_INCOHERENT',
      'the delegation chain must be non-empty and end at the issuing principal',
    );
  }
  if (new Set(chain).size !== chain.length) {
    return refuse(
      'CREDENTIAL_CHAIN_CYCLE',
      `a principal appears twice on the delegation chain: ${chain.join(' → ')}`,
    );
  }
  if (chain.includes(credential.credentialSubject.principal)) {
    // A→B→A launders unlimited self-authority into a namespace where the limits
    // were stripped (SPEC §8.1 #4, INV-23).
    return refuse(
      'CREDENTIAL_CHAIN_CYCLE',
      `delegate ${credential.credentialSubject.principal} is already on its own delegation chain`,
    );
  }
  const maxDepth = options.maxDepth ?? MAX_DELEGATION_DEPTH;
  if (chain.length > maxDepth) {
    return refuse(
      'CREDENTIAL_CHAIN_TOO_DEEP',
      `delegation depth ${chain.length} exceeds the limit of ${maxDepth}`,
    );
  }

  // ── the limits ──────────────────────────────────────────────────────────
  const { maxDirectLoss, maxContingentLiability } = credential.credentialSubject;
  if (maxDirectLoss < 0 || maxContingentLiability < 0) {
    return refuse('CREDENTIAL_LIMITS_INVALID', 'limits may not be negative');
  }

  // ── the clock ───────────────────────────────────────────────────────────
  if (credential.validUntilTick < credential.validFromTick) {
    return refuse('CREDENTIAL_MALFORMED', 'validUntilTick precedes validFromTick');
  }
  if (options.atTick < credential.validFromTick) {
    return refuse(
      'CREDENTIAL_NOT_YET_VALID',
      `the grant takes effect at tick ${credential.validFromTick}, and it is tick ${options.atTick}`,
    );
  }
  if (isExpiredAt(credential.validUntilTick, options.atTick)) {
    return refuse(
      'CREDENTIAL_EXPIRED',
      `the grant expired at tick ${credential.validUntilTick}; it is tick ${options.atTick}. Grants expire by design (SPEC §8.1 #5) — ask for a renewal.`,
    );
  }
  if (isRevokedAt(options.revokedAtTick ?? null, options.atTick)) {
    return refuse(
      'CREDENTIAL_REVOKED',
      `the grantor revoked this at tick ${String(options.revokedAtTick)}; revocation took effect the tick after`,
    );
  }

  return accept(credential);
}

/**
 * Bind the issuer's key to its claimed principal.
 *
 * The key is checked as live at **`validFromTick`**, not at the verifying tick.
 * That is SEC-2's prospective rule applied to grants: a credential issued under a
 * key its holder has since rotated stays valid, because rotation must never
 * unmake an obligation. The alternative hands every grantor a way to void its own
 * outstanding claims by rotating a key.
 */
function bindIssuer(
  credential: GrantCredential,
  issuerJwk: PublicKeyJwk,
  directory: KeyDirectory,
  liveAtTick: number,
): Verified<true, CredentialRejection> {
  const keyid = thumbprint(issuerJwk);
  const registration = directory.lookup(keyid);
  if (registration === null) {
    return refuse('CREDENTIAL_ISSUER_KEY_UNKNOWN', `issuer key ${keyid} is not registered in this world`);
  }
  if (registration.principal !== credential.issuer.principal) {
    return refuse(
      'CREDENTIAL_WRONG_ISSUER',
      `the credential claims issuer ${credential.issuer.principal} but key ${keyid} belongs to ${registration.principal}`,
    );
  }
  // Liveness is judged at a tick the SERVER observed, never at one the signer
  // chose. `validFromTick` is a field the issuer picks and then signs, so
  // trusting it let a rotated-out key mint brand-new grants forever by
  // back-dating: rotate away a leaked key, and the thief keeps issuing
  // credentials that verify. Found by the wave-1 verifier.
  //
  // This is the same split the signature path already made (`verifySignedRequest`
  // judges liveness now, `verifyArchivedSignature` judges it at the tick the
  // server recorded as accepted) — it simply had not been applied to grants.
  if (!keyLiveAt(registration, liveAtTick)) {
    return refuse(
      'CREDENTIAL_ISSUER_KEY_RETIRED',
      `key ${keyid} is not live at tick ${liveAtTick}; a retired key cannot issue, and back-dating validFromTick does not revive it`,
    );
  }
  // Kept as an additional constraint: a credential claiming to start before its
  // own issuing key existed is malformed regardless of who is asking.
  if (!keyLiveAt(registration, credential.validFromTick)) {
    return refuse(
      'CREDENTIAL_WRONG_ISSUER',
      `key ${keyid} was not live at the claimed validFromTick ${credential.validFromTick}`,
    );
  }
  return accept(true);
}

function proofOptionsOf(proof: GrantProof): GrantProofOptions {
  return {
    type: proof.type,
    cryptosuite: proof.cryptosuite,
    proofPurpose: proof.proofPurpose,
    verificationMethod: proof.verificationMethod,
    createdAtTick: proof.createdAtTick,
  };
}

function decodeMultibaseBase58(value: string): Uint8Array | null {
  if (!value.startsWith('z')) return null;
  return decodeBase58(value.slice(1));
}

// ── round-tripping (PROP-G4) ────────────────────────────────────────────────

export function claimsFromCredential(credential: GrantCredential): GrantClaims {
  const id = credential.id.slice(GRANT_URN_PREFIX.length);
  return {
    id: id as GrantId,
    grantor: credential.issuer.principal,
    delegate: credential.credentialSubject.principal,
    template: credential.credentialSubject.template,
    maxDirectLoss: credential.credentialSubject.maxDirectLoss,
    maxContingentLiability: credential.credentialSubject.maxContingentLiability,
    expiresTick: credential.validUntilTick,
  };
}

/**
 * Rebuild a {@link Grant} row from a credential.
 *
 * `spentDirect`, `spentContingent` and `revokedAtTick` come back at their initial
 * values **by design**: they are live server state, not part of the signed
 * claims. A caller restoring a grant must reconcile them from the ledger, and a
 * caller that forgets will under-count spend rather than silently believe a
 * credential about how much has been spent against it.
 */
export function grantFromCredential(credential: GrantCredential): Grant {
  const claims = claimsFromCredential(credential);
  return {
    id: claims.id,
    grantor: claims.grantor,
    delegate: claims.delegate,
    template: claims.template,
    maxDirectLoss: claims.maxDirectLoss,
    maxContingentLiability: claims.maxContingentLiability,
    spentDirect: minor(0),
    spentContingent: minor(0),
    expiresTick: claims.expiresTick,
    revokedAtTick: null,
  };
}

// ── structural parsing of an untrusted object ───────────────────────────────

function parseCredential(candidate: unknown): Verified<GrantCredential, CredentialRejection> {
  const root = asObject(candidate);
  if (root === null) return refuse('CREDENTIAL_MALFORMED', 'not an object');

  const context = asStringArray(root['@context']);
  if (context === null) return refuse('CREDENTIAL_MALFORMED', '@context must be an array of strings');
  if (!context.includes(VC_CONTEXT_V2)) {
    return refuse('CREDENTIAL_CONTEXT_UNSUPPORTED', `@context must include ${VC_CONTEXT_V2}`);
  }

  const type = asStringArray(root['type']);
  if (type === null) return refuse('CREDENTIAL_MALFORMED', 'type must be an array of strings');
  if (!type.includes(VERIFIABLE_CREDENTIAL_TYPE) || !type.includes(GRANT_CREDENTIAL_TYPE)) {
    return refuse(
      'CREDENTIAL_TYPE_UNSUPPORTED',
      `type must include ${VERIFIABLE_CREDENTIAL_TYPE} and ${GRANT_CREDENTIAL_TYPE}`,
    );
  }

  const id = asString(root['id']);
  if (id === null || !id.startsWith(GRANT_URN_PREFIX) || id.length === GRANT_URN_PREFIX.length) {
    return refuse('CREDENTIAL_MALFORMED', `id must be ${GRANT_URN_PREFIX}<grant id>`);
  }

  const issuerObj = asObject(root['issuer']);
  if (issuerObj === null) return refuse('CREDENTIAL_MALFORMED', 'issuer must be an object');
  const issuerId = asString(issuerObj['id']);
  const issuerPrincipal = asString(issuerObj['principal']);
  if (issuerId === null || issuerPrincipal === null) {
    return refuse('CREDENTIAL_MALFORMED', 'issuer needs an id and a principal');
  }

  const validFromTick = asInteger(root['validFromTick']);
  const validUntilTick = asInteger(root['validUntilTick']);
  if (validFromTick === null || validUntilTick === null) {
    return refuse('CREDENTIAL_MALFORMED', 'validFromTick and validUntilTick must be integer ticks');
  }

  const subjectObj = asObject(root['credentialSubject']);
  if (subjectObj === null) return refuse('CREDENTIAL_MALFORMED', 'credentialSubject must be an object');
  const subjectId = asString(subjectObj['id']);
  const subjectPrincipal = asString(subjectObj['principal']);
  const template = asString(subjectObj['template']);
  const maxDirectLoss = asInteger(subjectObj['maxDirectLoss']);
  const maxContingentLiability = asInteger(subjectObj['maxContingentLiability']);
  const chain = asStringArray(subjectObj['delegationChain']);
  if (
    subjectId === null ||
    subjectPrincipal === null ||
    template === null ||
    maxDirectLoss === null ||
    maxContingentLiability === null ||
    chain === null
  ) {
    return refuse(
      'CREDENTIAL_MALFORMED',
      'credentialSubject needs id, principal, template, maxDirectLoss, maxContingentLiability and delegationChain',
    );
  }

  const proofObj = asObject(root['proof']);
  if (proofObj === null) return refuse('PROOF_MISSING', 'a credential with no proof asserts nothing');
  const proofType = asString(proofObj['type']);
  const cryptosuite = asString(proofObj['cryptosuite']);
  const proofPurpose = asString(proofObj['proofPurpose']);
  const verificationMethod = asString(proofObj['verificationMethod']);
  const createdAtTick = asInteger(proofObj['createdAtTick']);
  const proofValue = asString(proofObj['proofValue']);
  if (
    proofType !== 'DataIntegrityProof' ||
    proofPurpose !== 'assertionMethod' ||
    verificationMethod === null ||
    createdAtTick === null ||
    proofValue === null
  ) {
    return refuse(
      'PROOF_MALFORMED',
      'proof needs type DataIntegrityProof, proofPurpose assertionMethod, verificationMethod, createdAtTick and proofValue',
    );
  }
  if (cryptosuite !== CRYPTOSUITE) {
    return refuse(
      'PROOF_CRYPTOSUITE_UNSUPPORTED',
      `cryptosuite must be ${CRYPTOSUITE}; got ${String(cryptosuite)}`,
    );
  }

  return accept<GrantCredential>({
    '@context': context,
    id,
    type,
    issuer: { id: issuerId, principal: issuerPrincipal as PrincipalId },
    validFromTick,
    validUntilTick,
    credentialSubject: {
      id: subjectId,
      principal: subjectPrincipal as PrincipalId,
      template,
      maxDirectLoss: minor(maxDirectLoss),
      maxContingentLiability: minor(maxContingentLiability),
      delegationChain: chain.map((p) => p as PrincipalId),
    },
    proof: {
      type: 'DataIntegrityProof',
      cryptosuite,
      proofPurpose: 'assertionMethod',
      verificationMethod,
      createdAtTick,
      proofValue,
    },
  });
}

function asObject(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asInteger(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : null;
}

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') return null;
    out.push(item);
  }
  return out;
}
