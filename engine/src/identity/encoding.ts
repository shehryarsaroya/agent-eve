/**
 * Byte encodings, all strict.
 *
 * `Buffer.from(s, 'base64')` is *lenient*: it silently discards characters
 * outside the alphabet and tolerates bad padding. On a signature that is a real
 * hazard — two different header strings decode to the same bytes, so a rejected
 * message and an accepted one can be made to look alike, and a "malformed
 * header" test passes for the wrong reason. Everything here validates first and
 * decodes second, and every decoder round-trips its own output.
 *
 * No dependencies: base58btc is thirty lines of integer arithmetic and the
 * alternative is a supply-chain edge on the identity path.
 */

import { IdentityError } from './reasons.js';

const B64_STD = /^[A-Za-z0-9+/]*={0,2}$/;
const B64_URL = /^[A-Za-z0-9_-]*$/;

export function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/** Strict standard base64 with padding, as structured fields require. */
export function decodeBase64(s: string): Uint8Array | null {
  if (!B64_STD.test(s)) return null;
  // Padded base64 is always a multiple of 4 characters. Node accepts unpadded
  // input; the RFC 8941 byte-sequence grammar does not, and accepting both means
  // two spellings of one value.
  if (s.length % 4 !== 0) return null;
  const bytes = new Uint8Array(Buffer.from(s, 'base64'));
  // Re-encoding catches non-canonical trailing bits, which decode to the same
  // bytes but are a different string — an ambiguity in a signed header.
  if (encodeBase64(bytes) !== s) return null;
  return bytes;
}

/** base64url, unpadded — the JOSE/JWK spelling. */
export function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function decodeBase64Url(s: string): Uint8Array | null {
  if (!B64_URL.test(s)) return null;
  // Unpadded base64url of n bytes is never 1 mod 4 characters long.
  if (s.length % 4 === 1) return null;
  const bytes = new Uint8Array(Buffer.from(s, 'base64url'));
  if (encodeBase64Url(bytes) !== s) return null;
  return bytes;
}

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * base58btc, as `did:key` requires (multibase prefix `z`).
 *
 * Integer arithmetic on byte arrays — no BigInt, because BigInt in a hashed path
 * invites the float question all over again, and 34 bytes does not need it.
 */
export function encodeBase58(bytes: Uint8Array): string {
  // Leading zero bytes carry no positional value, so they are counted out first
  // and written back as literal '1's. Folding them into the accumulator instead
  // is the classic base58 bug: it turns 0x00 into "11".
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

  const digits: number[] = []; // little-endian base-58
  for (let i = zeros; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte === undefined) throw new IdentityError('unreachable: base58 byte out of range');
    let carry = byte;
    for (let k = 0; k < digits.length; k += 1) {
      const d = digits[k];
      if (d === undefined) throw new IdentityError('unreachable: base58 digit out of range');
      carry += d * 256;
      digits[k] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let out = '1'.repeat(zeros);
  for (let k = digits.length - 1; k >= 0; k -= 1) {
    const d = digits[k];
    if (d === undefined) throw new IdentityError('unreachable: base58 digit out of range');
    out += B58_ALPHABET[d];
  }
  return out;
}

export function decodeBase58(s: string): Uint8Array | null {
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros += 1;

  const bytes: number[] = []; // little-endian base-256
  for (let i = zeros; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === undefined) return null;
    const v = B58_ALPHABET.indexOf(ch);
    if (v < 0) return null;
    let carry = v;
    for (let k = 0; k < bytes.length; k += 1) {
      const b = bytes[k];
      if (b === undefined) return null;
      carry += b * 58;
      bytes[k] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[bytes.length - 1 - i];
    if (b === undefined) return null;
    out[zeros + i] = b;
  }
  return out;
}
