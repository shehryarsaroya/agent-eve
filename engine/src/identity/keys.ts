/**
 * Ed25519 identity, on Node 22's built-in `node:crypto`. No dependency.
 *
 * The design intent, restated because it is the reason this file is not a bearer
 * token: **the signature must be the agent's, not our note that it agreed.** A
 * product whose only asset is a permanent public account of who kept their word
 * cannot rest that account on *trust our server* (SPEC §6.1). So the private half
 * belongs to the principal, we hold the public half, and anyone — including
 * someone auditing us — can re-check the record.
 *
 * Two consequences worth stating in code:
 *
 *  - {@link AgentKeypair} keeps the private key in a `#private` field. It cannot
 *    be reached by `JSON.stringify`, by a spread, or by an object walk, so it
 *    cannot fall into a log, an event, an observation or a Dispatch (SEC-9).
 *    Exporting it takes an explicitly-named method, which is greppable.
 *  - The `keyid` is the key's own RFC 7638 thumbprint, so it is *self-certifying*:
 *    a verifier can check that the keyid actually names the key that signed,
 *    rather than trusting an opaque label. A keyid nobody can forge is what stops
 *    "sign with my key, claim it was theirs".
 */

import { createPrivateKey, createPublicKey, createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import type { JsonWebKey, KeyObject } from 'node:crypto';

import { decodeBase64Url, encodeBase58, encodeBase64Url, decodeBase58 } from './encoding.js';
import { IdentityError } from './reasons.js';

/** The public half of an Ed25519 key, in JWK form (RFC 8037). */
export interface PublicKeyJwk {
  readonly kty: 'OKP';
  readonly crv: 'Ed25519';
  readonly x: string;
}

/**
 * The private half, in JWK form. Its own type so that a signature accepting a
 * public key can never be handed a private one by accident, and so that a grep
 * for this name finds every place a secret could travel.
 */
export interface PrivateKeyJwk extends PublicKeyJwk {
  readonly d: string;
}

/**
 * Everything the server keeps about a key. Note what is absent: the private
 * half. This type is the whole of what enrollment stores.
 */
export interface PublicKeyRecord {
  /** RFC 7638 JWK thumbprint, base64url. Self-certifying: derived from the key. */
  readonly keyid: string;
  /** `did:key:z…` — the key *is* the identifier, so a credential verifies offline. */
  readonly didKey: string;
  readonly publicKeyJwk: PublicKeyJwk;
}

/** Ed25519 raw public keys are 32 bytes. Anything else is not one. */
const ED25519_PUBLIC_KEY_BYTES = 32;

/** Multicodec prefix for an Ed25519 public key, as `did:key` requires. */
const MULTICODEC_ED25519_PUB = Uint8Array.from([0xed, 0x01]);

/**
 * The private half. Deliberately a class, not an interface: the key lives in a
 * `#private` field so that no accidental serialisation can reach it (SEC-9).
 */
export class AgentKeypair {
  readonly record: PublicKeyRecord;
  readonly #privateKey: KeyObject;

  constructor(privateKey: KeyObject, record: PublicKeyRecord) {
    this.record = record;
    this.#privateKey = privateKey;
  }

  get keyid(): string {
    return this.record.keyid;
  }

  /** Sign raw bytes. For RFC 9421 this is the signature base, ASCII-encoded. */
  sign(bytes: Uint8Array): Uint8Array {
    // Ed25519 takes a null algorithm: the curve fixes the hash.
    return new Uint8Array(sign(null, bytes, this.#privateKey));
  }

  /**
   * Export the private half as a JWK, for an agent that wants to persist its own
   * identity across restarts. Named so that it is obvious in a diff and in a
   * grep for anything that could leak a secret.
   */
  exportPrivateKeyJwkDangerously(): PrivateKeyJwk {
    const jwk = this.#privateKey.export({ format: 'jwk' });
    if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string' || typeof jwk.d !== 'string') {
      throw new IdentityError('private key did not export as an Ed25519 JWK');
    }
    return { kty: 'OKP', crv: 'Ed25519', x: jwk.x, d: jwk.d };
  }
}

/**
 * `node:crypto` wants a plain, index-signed JWK object. Rebuilding the three (or
 * four) members explicitly also means nothing else riding on the object — an
 * `alg`, a `use`, a stray `d` — can reach the crypto layer unnoticed.
 */
function asJwkInput(jwk: PublicKeyJwk | PrivateKeyJwk): JsonWebKey {
  const out: JsonWebKey = { kty: jwk.kty, crv: jwk.crv, x: jwk.x };
  if ('d' in jwk) out.d = jwk.d;
  return out;
}

function jwkFromPublicKey(key: KeyObject): PublicKeyJwk {
  const jwk = key.export({ format: 'jwk' });
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') {
    throw new IdentityError('not an Ed25519 public key');
  }
  return { kty: 'OKP', crv: 'Ed25519', x: jwk.x };
}

/**
 * RFC 7638 JWK thumbprint.
 *
 * Deliberately **not** `core/canonical.ts`: RFC 7638 defines its own canonical
 * form (the required members only, lexicographic, no whitespace, no prefix), and
 * a thumbprint computed any other way is simply not a thumbprint — it would not
 * match any other implementation, which defeats the point of adopting a standard.
 * Our canonicaliser owns the structures *we* define; this one is the RFC's.
 */
export function thumbprint(jwk: PublicKeyJwk): string {
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`;
  return encodeBase64Url(new Uint8Array(createHash('sha256').update(canonical, 'utf8').digest()));
}

/** `did:key:z…` for an Ed25519 public key (multicodec 0xed01, multibase base58btc). */
export function didKeyFor(jwk: PublicKeyJwk): string {
  const raw = decodeBase64Url(jwk.x);
  if (raw === null || raw.length !== ED25519_PUBLIC_KEY_BYTES) {
    throw new IdentityError('Ed25519 JWK "x" is not 32 base64url-encoded bytes');
  }
  const prefixed = new Uint8Array(MULTICODEC_ED25519_PUB.length + raw.length);
  prefixed.set(MULTICODEC_ED25519_PUB, 0);
  prefixed.set(raw, MULTICODEC_ED25519_PUB.length);
  return `did:key:z${encodeBase58(prefixed)}`;
}

/** The inverse of {@link didKeyFor}: recover the key so a credential verifies offline. */
export function jwkFromDidKey(did: string): PublicKeyJwk | null {
  if (!did.startsWith('did:key:z')) return null;
  const decoded = decodeBase58(did.slice('did:key:z'.length));
  if (decoded === null) return null;
  if (decoded.length !== MULTICODEC_ED25519_PUB.length + ED25519_PUBLIC_KEY_BYTES) return null;
  if (decoded[0] !== MULTICODEC_ED25519_PUB[0] || decoded[1] !== MULTICODEC_ED25519_PUB[1]) return null;
  return {
    kty: 'OKP',
    crv: 'Ed25519',
    x: encodeBase64Url(decoded.slice(MULTICODEC_ED25519_PUB.length)),
  };
}

export function recordFromJwk(jwk: PublicKeyJwk): PublicKeyRecord {
  return { keyid: thumbprint(jwk), didKey: didKeyFor(jwk), publicKeyJwk: jwk };
}

/**
 * Generate a fresh keypair.
 *
 * `generateKeyPairSync` draws from the OS CSPRNG, not from {@link Rng} — and
 * that is correct rather than a DET-7 violation: a key drawn from the seeded,
 * published generator would be **derivable by every spectator from the published
 * seed**. Keys are host state, never world state; they never enter the state
 * hash and replay never regenerates them (SPEC §15.1: events are output, and the
 * replay input triple is `(snapshot, action_log, seed)` — the action log carries
 * the public key, so replay reads it rather than recreating it).
 */
export function generateKeypair(): AgentKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return new AgentKeypair(privateKey, recordFromJwk(jwkFromPublicKey(publicKey)));
}

/** Rebuild a keypair from an exported private JWK, for an agent resuming. */
export function keypairFromPrivateJwk(jwk: PrivateKeyJwk): AgentKeypair {
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({ key: asJwkInput(jwk), format: 'jwk' });
  } catch (e) {
    throw new IdentityError(`not an importable Ed25519 private JWK: ${String(e)}`);
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new IdentityError(`expected an ed25519 key, got ${String(privateKey.asymmetricKeyType)}`);
  }
  const publicKey = createPublicKey(privateKey);
  return new AgentKeypair(privateKey, recordFromJwk(jwkFromPublicKey(publicKey)));
}

/**
 * Verify raw bytes against a stored public key.
 *
 * Returns false rather than throwing on a malformed key or a wrong-length
 * signature: a caller checking a signature must get one answer, and an exception
 * on some inputs and `false` on others is how a rejection turns into a 500.
 */
export function verifyBytes(jwk: PublicKeyJwk, bytes: Uint8Array, signature: Uint8Array): boolean {
  try {
    const key = createPublicKey({ key: asJwkInput(jwk), format: 'jwk' });
    return verify(null, bytes, key, signature);
  } catch {
    return false;
  }
}

/**
 * Does this keyid actually name this key? The thumbprint is a function of the
 * key, so the answer is checkable rather than assertable.
 */
export function keyidMatches(jwk: PublicKeyJwk, keyid: string): boolean {
  return thumbprint(jwk) === keyid;
}
