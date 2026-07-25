/**
 * Structured field parsing and serialisation (RFC 8941), the layer RFC 9421 sits
 * on. A signature base is only reproducible if this layer is, so the properties
 * asserted here are the ones the signature depends on: parse→serialise is a
 * fixed point, and parameter order survives the trip.
 */

import { describe, expect, it } from 'vitest';

import {
  SfParseError,
  parseDictionary,
  serializeDictionary,
  serializeInnerList,
  sfParam,
} from '../../src/identity/sfv.js';

describe('structured fields', () => {
  it('parses a signature-input and re-serialises it byte-identically', () => {
    const field =
      'compact=("@method" "@path" "@authority" "content-digest");created=1700000000;keyid="abc";alg="ed25519";nonce="n0nce-aaa"';
    const dict = parseDictionary(field);
    expect(serializeDictionary(dict)).toBe(field);
  });

  it('preserves parameter order, because re-serialisation must not reorder it', () => {
    // If the parser sorted parameters, the rebuilt @signature-params line would
    // differ from the signed one and every signature would fail with an opaque
    // mismatch. Order in, order out.
    const dict = parseDictionary('s=("x");nonce="n0nce-aaa";keyid="k";created=7');
    const member = dict[0]![1];
    expect(member.kind).toBe('inner-list');
    expect(member.params.map(([k]) => k)).toEqual(['nonce', 'keyid', 'created']);
    expect(serializeInnerList(member as never)).toBe('("x");nonce="n0nce-aaa";keyid="k";created=7');
  });

  it('round-trips escapes, byte sequences and booleans', () => {
    const field = 's=:AQIDBA==:, t="a \\"quoted\\" \\\\ value", u, v=?0';
    const dict = parseDictionary(field);
    expect(serializeDictionary(dict)).toBe(field);
    const t = dict[1]![1];
    expect(t.kind === 'item' && t.bare.type === 'string' ? t.bare.value : null).toBe(
      'a "quoted" \\ value',
    );
  });

  it('refuses sf-decimal, because a float in a signed structure is banned', () => {
    expect(() => parseDictionary('s=("x");created=1.5')).toThrow(SfParseError);
  });

  it('refuses a repeated key rather than taking the last value', () => {
    // RFC 8941 says last-wins. In a signature header that is an ambiguity between
    // what we verify and what an intermediary reads, so it is refused.
    expect(() => parseDictionary('s=("a"), s=("b")')).toThrow(/appears twice/);
    expect(() => parseDictionary('s=("a");keyid="x";keyid="y"')).toThrow(/appears twice/);
  });

  it('refuses malformed fields precisely', () => {
    for (const bad of [
      'compact=("@method"',
      'compact=(@method)',
      'compact="unterminated',
      'compact=:notbase64!:',
      'compact=:QQ:',
      'compact=("a"),',
      'Compact=("a")',
      'compact=?2',
    ]) {
      expect(() => parseDictionary(bad), bad).toThrow(SfParseError);
    }
  });

  it('normalises whitespace on re-serialisation, which is why the base is rebuilt', () => {
    // RFC 8941 §4.2.1.2 discards *any* leading SP inside an inner list, so this
    // parses. RFC 9421 §2.5 then rebuilds the @signature-params line canonically,
    // collapsing it to one space. That is the whole argument for re-serialising
    // rather than echoing the received bytes: what we verify is the canonical
    // spelling, so a second verifier reaches the same verdict we did. A client
    // that signs its own non-canonical rendering is the one at fault, and it
    // fails closed.
    const dict = parseDictionary('compact=("a"   "b") ,  other=("c")');
    expect(serializeDictionary(dict)).toBe('compact=("a" "b"), other=("c")');
  });

  it('reads a named parameter or reports its absence', () => {
    const dict = parseDictionary('s=("x");created=5');
    const params = dict[0]![1].params;
    expect(sfParam(params, 'created')).toEqual({ type: 'integer', value: 5 });
    expect(sfParam(params, 'keyid')).toBeNull();
  });

  it('accepts an empty dictionary but not a trailing comma', () => {
    expect(parseDictionary('')).toEqual([]);
    expect(() => parseDictionary('a=1,')).toThrow(SfParseError);
  });
});
