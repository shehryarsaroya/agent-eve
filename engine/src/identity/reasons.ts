/**
 * Every way a signature or a credential can be refused, each with its own name.
 *
 * SEC-1 and SEC-3 both say *distinguishable*, and they say it for a reason that
 * is not about security: an agent that receives `invalid signature` cannot fix
 * its client, so it retries, and the operator sees a healthy server rejecting a
 * healthy agent forever. High Water pattern #4 — an illegal move returns
 * `{ok:false, hint}` and never an opaque error — applies to authentication
 * exactly as it applies to moves.
 *
 * These strings are a **rules surface** (scar #1). They appear in the agent's
 * correction channel and in `agent.md`, so they may not be renamed without
 * renaming them there too, and no reason may be reused for a second condition.
 * They never appear in the public feed (scar #10): a rejection is a hint, not an
 * event.
 */

/** Why a signed HTTP request was refused. One condition per name. */
export type SignatureRejection =
  // ── the headers themselves ────────────────────────────────────────────────
  /** No `Signature-Input` header at all. */
  | 'SIGNATURE_INPUT_MISSING'
  /** No `Signature` header at all. */
  | 'SIGNATURE_MISSING'
  /** `Signature-Input` is not a well-formed structured-field dictionary. */
  | 'SIGNATURE_INPUT_MALFORMED'
  /** `Signature` is not a dictionary of byte sequences. */
  | 'SIGNATURE_MALFORMED'
  /** The two headers do not agree on the label. */
  | 'LABEL_MISMATCH'
  /** More than one signature offered. We accept exactly one; ambiguity is a footgun. */
  | 'MULTIPLE_SIGNATURES'
  /** `alg` present and not `ed25519`. */
  | 'ALGORITHM_UNSUPPORTED'
  /** No `keyid` parameter, so there is nothing to check the bytes against. */
  | 'KEYID_MISSING'

  // ── the covered component list ────────────────────────────────────────────
  /** A component this deployment insists on is absent from the covered list. */
  | 'COVERED_COMPONENT_REQUIRED'
  /** The signature covers a component the message does not have. */
  | 'COVERED_COMPONENT_ABSENT'
  /** The same component appears twice in the covered list. */
  | 'COVERED_COMPONENT_DUPLICATED'
  /** A derived component or component parameter this engine does not implement. */
  | 'COVERED_COMPONENT_UNSUPPORTED'

  // ── freshness ─────────────────────────────────────────────────────────────
  /** No `created` parameter, so freshness cannot be judged. */
  | 'CREATED_MISSING'
  /** `created` is further ahead of our clock than the skew bound allows. */
  | 'CREATED_IN_FUTURE'
  /** `created` is older than the freshness window. */
  | 'CREATED_TOO_OLD'
  /** `expires` has passed. */
  | 'SIGNATURE_EXPIRED'
  /** `expires` is at or before `created` — a signature that was never valid. */
  | 'EXPIRES_NOT_AFTER_CREATED'

  // ── the key ───────────────────────────────────────────────────────────────
  /** `keyid` names no key this world has ever seen. */
  | 'KEYID_UNKNOWN'
  /** `keyid` names a key that was rotated out before this tick (SEC-2). */
  | 'KEY_RETIRED'
  /** `keyid` names a key registered after this tick. */
  | 'KEY_NOT_YET_REGISTERED'
  /** The bytes do not verify: a wrong key, or a message that was altered. */
  | 'SIGNATURE_INVALID'

  // ── the body ──────────────────────────────────────────────────────────────
  /** There is a body but no `Content-Digest` header. */
  | 'CONTENT_DIGEST_MISSING'
  /** There is a body and a digest, but the signature does not cover the digest. */
  | 'CONTENT_DIGEST_UNCOVERED'
  /** `Content-Digest` is not a dictionary of byte sequences. */
  | 'CONTENT_DIGEST_MALFORMED'
  /** `Content-Digest` offers no algorithm we implement. */
  | 'CONTENT_DIGEST_ALGORITHM_UNSUPPORTED'
  /** The digest does not match the body we received. */
  | 'CONTENT_DIGEST_MISMATCH'

  // ── replay ────────────────────────────────────────────────────────────────
  /** No `nonce` parameter, so the request cannot be made single-use. */
  | 'NONCE_MISSING'
  /** The nonce is empty, over-long, or outside the permitted alphabet. */
  | 'NONCE_MALFORMED'
  /** This nonce has already been spent by this key. */
  | 'NONCE_REPLAYED'
  /** This key has more unexpired nonces outstanding than we will remember (scar #3). */
  | 'NONCE_BUDGET_EXCEEDED';

/** Why a Grant credential was refused. SEC-3 names five; there are more. */
export type CredentialRejection =
  /** Not shaped like a credential at all. */
  | 'CREDENTIAL_MALFORMED'
  /** `@context` does not contain the VC data model context. */
  | 'CREDENTIAL_CONTEXT_UNSUPPORTED'
  /** `type` does not claim to be a Grant credential. */
  | 'CREDENTIAL_TYPE_UNSUPPORTED'
  /** No `proof`, so nothing is signed. */
  | 'PROOF_MISSING'
  /** The proof block is present but not in a shape we can verify. */
  | 'PROOF_MALFORMED'
  /** The cryptosuite is not the one this engine implements. */
  | 'PROOF_CRYPTOSUITE_UNSUPPORTED'
  /** The proof does not verify over the canonical payload: the credential was altered. */
  | 'CREDENTIAL_TAMPERED'
  /** The signing key is not the declared issuer's key. */
  | 'CREDENTIAL_WRONG_ISSUER'
  /** The issuer key is unknown to this world (only checked when a directory is supplied). */
  | 'CREDENTIAL_ISSUER_KEY_UNKNOWN'
  /** `validUntilTick` has passed. */
  | 'CREDENTIAL_EXPIRED'
  /** `validFromTick` has not arrived. */
  | 'CREDENTIAL_NOT_YET_VALID'
  /** The grantor revoked it, and the revocation has taken effect. */
  | 'CREDENTIAL_REVOKED'
  /** The delegation chain is longer than the world permits. */
  | 'CREDENTIAL_CHAIN_TOO_DEEP'
  /** A principal appears twice on the chain — it would be its own delegate (INV-23). */
  | 'CREDENTIAL_CHAIN_CYCLE'
  /** The chain does not begin at the grantor, or does not end at this issuer. */
  | 'CREDENTIAL_CHAIN_INCOHERENT'
  /** A limit is negative, or the mandate is otherwise unenforceable. */
  | 'CREDENTIAL_LIMITS_INVALID';

/**
 * A refusal, with a human-readable detail for the agent's correction channel.
 *
 * `detail` is for the agent, `reason` is for our metrics: the probe harness
 * aggregates `rejections_by_reason` (TESTING.md §16), which only works if the
 * reason is a closed set and the detail is the only thing that varies.
 */
export interface Refusal<R extends string> {
  readonly reason: R;
  readonly detail: string;
}

export type Verified<T, R extends string> =
  | { readonly ok: true; readonly value: T }
  | ({ readonly ok: false } & Refusal<R>);

export function refuse<R extends string>(reason: R, detail: string): { ok: false } & Refusal<R> {
  return { ok: false, reason, detail };
}

export function accept<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

/**
 * Thrown for programmer error — a malformed *outgoing* signature, a bad policy,
 * an impossible key. Never thrown for a rejected request: those are returned,
 * because a 500 on a bad signature is a hint the agent cannot read.
 */
export class IdentityError extends Error {}
