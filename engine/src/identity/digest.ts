/**
 * `Content-Digest` (RFC 9530) — a structured-field dictionary of byte sequences.
 *
 * Why the body needs its own covered component at all: RFC 9421 signs *headers*,
 * not the body. Without a digest in the covered set, a signature over
 * `@method @path @authority` is a signature over "this principal asked for
 * something at this path" and an intermediary can replace the entire action
 * payload. That is not a theoretical concern in a game where the payload is
 * `sign this compact for 40,000 minor units`.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import { parseDictionary, serializeDictionary, SfParseError } from './sfv.js';
import type { SfDictionary } from './sfv.js';
import type { Refusal } from './reasons.js';
import { refuse } from './reasons.js';
import type { SignatureRejection } from './reasons.js';

/** The algorithms we accept, strongest first. Names are RFC 9530's registry keys. */
const SUPPORTED = ['sha-512', 'sha-256'] as const;
type SupportedAlgorithm = (typeof SUPPORTED)[number];

function hashName(alg: SupportedAlgorithm): string {
  return alg === 'sha-512' ? 'sha512' : 'sha256';
}

/** Build the header value for a body. Agents call this; so does our own cast. */
export function contentDigestHeader(body: Uint8Array, alg: SupportedAlgorithm = 'sha-256'): string {
  const digest = new Uint8Array(createHash(hashName(alg)).update(body).digest());
  const dict: SfDictionary = [[alg, { kind: 'item', bare: { type: 'binary', value: digest }, params: [] }]];
  return serializeDictionary(dict);
}

/**
 * Check a received `Content-Digest` against the body we actually read.
 *
 * Every offered algorithm we recognise must match — not "at least one", which
 * would let a sender pair a correct weak digest with a wrong strong one and pick
 * whichever the next hop trusts less.
 */
export function verifyContentDigest(
  header: string,
  body: Uint8Array,
): { readonly ok: true } | ({ readonly ok: false } & Refusal<SignatureRejection>) {
  let dict: SfDictionary;
  try {
    dict = parseDictionary(header);
  } catch (e) {
    const detail = e instanceof SfParseError ? e.message : String(e);
    return refuse('CONTENT_DIGEST_MALFORMED', `Content-Digest is not a structured dictionary: ${detail}`);
  }

  let checked = 0;
  for (const [alg, member] of dict) {
    if (!isSupported(alg)) continue;
    if (member.kind !== 'item' || member.bare.type !== 'binary') {
      return refuse('CONTENT_DIGEST_MALFORMED', `Content-Digest entry '${alg}' is not a byte sequence`);
    }
    const expected = new Uint8Array(createHash(hashName(alg)).update(body).digest());
    const offered = member.bare.value;
    // Length first: timingSafeEqual throws on a mismatch, and a throw here would
    // turn a rejected request into a 500 (scar #11).
    if (offered.length !== expected.length || !timingSafeEqual(offered, expected)) {
      return refuse(
        'CONTENT_DIGEST_MISMATCH',
        `Content-Digest ${alg} does not match the ${body.length}-byte body received`,
      );
    }
    checked += 1;
  }

  if (checked === 0) {
    return refuse(
      'CONTENT_DIGEST_ALGORITHM_UNSUPPORTED',
      `Content-Digest offered no algorithm this engine implements (accepted: ${SUPPORTED.join(', ')})`,
    );
  }
  return { ok: true };
}

function isSupported(alg: string): alg is SupportedAlgorithm {
  return (SUPPORTED as readonly string[]).includes(alg);
}
