/**
 * Identity: Ed25519 keys, RFC 9421 signed requests, and grants as W3C
 * Verifiable Credentials.
 *
 * One import for the HTTP boundary and one for the agent side. The barrel exists
 * so that the api module never reaches past it into `sfv.ts` — the structured
 * field parser is an implementation detail of the signature format, and a caller
 * that starts parsing headers itself is a second, disagreeing interpretation of
 * the same bytes.
 */

export { wallSeconds, wallSecondsFrom, addWallSeconds, WallClockError } from './wallclock.js';
export type { WallSeconds } from './wallclock.js';

export { IdentityError, accept, refuse } from './reasons.js';
export type { CredentialRejection, Refusal, SignatureRejection, Verified } from './reasons.js';

export {
  AgentKeypair,
  didKeyFor,
  generateKeypair,
  jwkFromDidKey,
  keyidMatches,
  keypairFromPrivateJwk,
  recordFromJwk,
  thumbprint,
  verifyBytes,
} from './keys.js';
export type { PrivateKeyJwk, PublicKeyJwk, PublicKeyRecord } from './keys.js';

export { Keyring, keyLiveAt } from './keyring.js';
export type { KeyDirectory, KeyRegistration } from './keyring.js';

export { BoundedReplayStore } from './replay.js';
export type { ReplayOutcome, ReplayStore, ReplayStoreLimits } from './replay.js';

export { contentDigestHeader, verifyContentDigest } from './digest.js';

export {
  DEFAULT_SIGNATURE_POLICY,
  RequestVerifier,
  signRequest,
  verifyArchivedSignature,
  verifySignedRequest,
} from './httpsig.js';
export type {
  AcceptedSignature,
  SignRequestOptions,
  SignableRequest,
  SignaturePolicy,
  SignedHeaders,
  VerifyRequestOptions,
} from './httpsig.js';

export { buildSignedRequest } from './client.js';
export type { BuildSignedRequestOptions, SignedRequest } from './client.js';

export {
  COMPACT_CONTEXT,
  CRYPTOSUITE,
  GRANT_CREDENTIAL_TYPE,
  GRANT_URN_PREFIX,
  MAX_DELEGATION_DEPTH,
  VC_CONTEXT_V2,
  VERIFIABLE_CREDENTIAL_TYPE,
  grantFromCredential,
  isExpiredAt,
  isRevokedAt,
  issueGrantCredential,
  claimsFromCredential,
  claimsOf,
  signGrantCredential,
  verificationMethodFor,
  verifyGrantCredential,
  verifyArchivedGrantCredential,
} from './vc.js';
export type {
  CredentialIssuer,
  GrantCredential,
  GrantCredentialSubject,
  GrantClaims,
  GrantProof,
  GrantProofOptions,
  IssueGrantCredentialOptions,
  VerifyGrantCredentialOptions,
} from './vc.js';
