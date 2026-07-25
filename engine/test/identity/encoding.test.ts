/**
 * Encoding round-trips.
 *
 * These look trivial and are not: a base58 implementation that mishandles leading
 * zero bytes produces a `did:key` that is *almost* right, and the failure surfaces
 * as "this credential verifies for us and not for anyone else". Roughly 1 in 256
 * Ed25519 public keys begins with a zero byte, which is often enough to reach
 * production and rare enough to survive a hand-written test.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  decodeBase58,
  decodeBase64,
  decodeBase64Url,
  encodeBase58,
  encodeBase64,
  encodeBase64Url,
} from '../../src/identity/encoding.js';
import { didKeyFor, generateKeypair, jwkFromDidKey, thumbprint } from '../../src/identity/index.js';

const bytes = fc.uint8Array({ maxLength: 64 });

describe('encoding', () => {
  it('base58 round-trips, including leading zero bytes', () => {
    fc.assert(
      fc.property(bytes, (b) => {
        const decoded = decodeBase58(encodeBase58(b));
        expect(decoded).not.toBeNull();
        expect(Array.from(decoded!)).toEqual(Array.from(b));
      }),
      { numRuns: 300 },
    );
  });

  it('base58 encodes leading zeros as literal 1s', () => {
    expect(encodeBase58(new Uint8Array([]))).toBe('');
    expect(encodeBase58(new Uint8Array([0]))).toBe('1');
    expect(encodeBase58(new Uint8Array([0, 0]))).toBe('11');
    expect(encodeBase58(new Uint8Array([1]))).toBe('2');
    expect(Array.from(decodeBase58('1')!)).toEqual([0]);
    expect(Array.from(decodeBase58('11')!)).toEqual([0, 0]);
  });

  it('base58 rejects characters outside the alphabet', () => {
    // '0', 'I', 'O' and 'l' are excluded by base58btc precisely because they are
    // confusable, which matters when a did:key gets copied by hand.
    for (const bad of ['0', 'I', 'O', 'l', ' ', '+']) {
      expect(decodeBase58(`2${bad}2`)).toBeNull();
    }
  });

  it('base64 round-trips and rejects non-canonical spellings', () => {
    fc.assert(
      fc.property(bytes, (b) => {
        expect(Array.from(decodeBase64(encodeBase64(b))!)).toEqual(Array.from(b));
        expect(Array.from(decodeBase64Url(encodeBase64Url(b))!)).toEqual(Array.from(b));
      }),
      { numRuns: 200 },
    );
    // Unpadded standard base64 and base64url characters in a standard field are
    // both refused: two spellings of one value in a signed header is an ambiguity.
    expect(decodeBase64('QQ')).toBeNull();
    expect(decodeBase64('a-b=')).toBeNull();
    expect(decodeBase64Url('QQ==')).toBeNull();
    // Trailing bits that are not zero decode to the same bytes as a canonical
    // spelling but are a different string.
    expect(decodeBase64('QR==')).toBeNull();
  });

  it('did:key round-trips a real Ed25519 key and pins the keyid to it', () => {
    for (let i = 0; i < 20; i += 1) {
      const kp = generateKeypair();
      const jwk = kp.record.publicKeyJwk;
      expect(kp.record.didKey).toBe(didKeyFor(jwk));
      // The multicodec prefix for Ed25519 makes every such did:key start z6Mk.
      expect(kp.record.didKey.startsWith('did:key:z6Mk')).toBe(true);
      expect(jwkFromDidKey(kp.record.didKey)).toEqual(jwk);
      expect(kp.record.keyid).toBe(thumbprint(jwk));
    }
  });

  it('did:key rejects anything that is not an Ed25519 multicodec', () => {
    expect(jwkFromDidKey('did:key:zzzz')).toBeNull();
    expect(jwkFromDidKey('did:web:example.com')).toBeNull();
    expect(jwkFromDidKey('')).toBeNull();
  });
});
