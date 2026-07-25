/**
 * Structured Field Values (RFC 8941) — the subset RFC 9421 needs, strictly.
 *
 * Three reasons this is hand-written rather than approximated with a regex:
 *
 *  1. **The signature base is re-serialised, not echoed.** RFC 9421 §2.5 builds
 *     the `@signature-params` line from the parsed signature input. Echoing the
 *     raw header bytes instead would let a sender smuggle a non-canonical
 *     spelling past us and mean something different to the next verifier. So we
 *     need a serialiser whose output is canonical, and a parser that preserves
 *     the one thing serialisation must not reorder: **parameter order**.
 *  2. **Decimals are rejected outright.** `sf-decimal` is a float, and a float
 *     in a signed structure is banned everywhere in this codebase. A signature
 *     parameter is a hashed structure by definition.
 *  3. **Duplicates are rejected, not last-wins.** RFC 8941 says a repeated
 *     dictionary key takes the last value. In a *signature* header that is an
 *     ambiguity between what we verify and what an intermediary might read, so
 *     we refuse it. Stricter than the RFC, deliberately, and stated.
 */

export class SfParseError extends Error {}
export class SfSerializeError extends Error {}

export type SfBareItem =
  | { readonly type: 'string'; readonly value: string }
  | { readonly type: 'token'; readonly value: string }
  | { readonly type: 'integer'; readonly value: number }
  | { readonly type: 'boolean'; readonly value: boolean }
  | { readonly type: 'binary'; readonly value: Uint8Array };

/** Ordered, because re-serialisation must reproduce the order it was given. */
export type SfParams = readonly (readonly [string, SfBareItem])[];

export interface SfItem {
  readonly kind: 'item';
  readonly bare: SfBareItem;
  readonly params: SfParams;
}

export interface SfInnerList {
  readonly kind: 'inner-list';
  readonly items: readonly SfItem[];
  readonly params: SfParams;
}

export type SfMember = SfItem | SfInnerList;

/** Ordered list of members, not a Map: order is part of the wire form. */
export type SfDictionary = readonly (readonly [string, SfMember])[];

export function sfString(value: string): SfBareItem {
  return { type: 'string', value };
}

export function sfInteger(value: number): SfBareItem {
  return { type: 'integer', value };
}

export function sfBinary(value: Uint8Array): SfBareItem {
  return { type: 'binary', value };
}

export function sfParam(params: SfParams, name: string): SfBareItem | null {
  for (const [k, v] of params) if (k === name) return v;
  return null;
}

// ── serialisation ───────────────────────────────────────────────────────────

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
const KEY_GRAMMAR = /^[a-z*][a-z0-9_\-.*]*$/;
const TOKEN_GRAMMAR = /^[A-Za-z*][A-Za-z0-9!#$%&'*+\-.^_`|~:/]*$/;

/** RFC 8941 caps sf-integer at 15 digits. Beyond that is not representable. */
const SF_INTEGER_LIMIT = 999999999999999;

export function serializeBareItem(item: SfBareItem): string {
  switch (item.type) {
    case 'string':
      if (!PRINTABLE_ASCII.test(item.value)) {
        throw new SfSerializeError('sf-string admits only printable ASCII');
      }
      return `"${item.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    case 'token':
      if (!TOKEN_GRAMMAR.test(item.value)) {
        throw new SfSerializeError(`not a valid sf-token: ${item.value}`);
      }
      return item.value;
    case 'integer':
      if (!Number.isSafeInteger(item.value) || Math.abs(item.value) > SF_INTEGER_LIMIT) {
        throw new SfSerializeError(`sf-integer out of range: ${String(item.value)}`);
      }
      return String(item.value);
    case 'boolean':
      return item.value ? '?1' : '?0';
    case 'binary':
      return `:${Buffer.from(item.value).toString('base64')}:`;
  }
}

export function serializeParams(params: SfParams): string {
  let out = '';
  for (const [k, v] of params) {
    if (!KEY_GRAMMAR.test(k)) throw new SfSerializeError(`not a valid parameter key: ${k}`);
    out += ';';
    out += k;
    // A boolean-true parameter serialises as the bare key, per RFC 8941 §4.1.1.2.
    if (!(v.type === 'boolean' && v.value)) {
      out += `=${serializeBareItem(v)}`;
    }
  }
  return out;
}

export function serializeItem(item: SfItem): string {
  return serializeBareItem(item.bare) + serializeParams(item.params);
}

export function serializeInnerList(list: SfInnerList): string {
  const inner = list.items.map(serializeItem).join(' ');
  return `(${inner})${serializeParams(list.params)}`;
}

export function serializeMember(member: SfMember): string {
  return member.kind === 'item' ? serializeItem(member) : serializeInnerList(member);
}

export function serializeDictionary(dict: SfDictionary): string {
  const parts: string[] = [];
  for (const [k, v] of dict) {
    if (!KEY_GRAMMAR.test(k)) throw new SfSerializeError(`not a valid dictionary key: ${k}`);
    if (v.kind === 'item' && v.bare.type === 'boolean' && v.bare.value) {
      parts.push(k + serializeParams(v.params));
    } else {
      parts.push(`${k}=${serializeMember(v)}`);
    }
  }
  return parts.join(', ');
}

// ── parsing ─────────────────────────────────────────────────────────────────

class Cursor {
  private i = 0;

  constructor(private readonly s: string) {}

  get rest(): string {
    return this.s.slice(this.i);
  }

  get done(): boolean {
    return this.i >= this.s.length;
  }

  peek(): string | null {
    return this.i < this.s.length ? (this.s[this.i] ?? null) : null;
  }

  take(): string {
    const c = this.s[this.i];
    if (c === undefined) throw new SfParseError('unexpected end of field');
    this.i += 1;
    return c;
  }

  expect(ch: string): void {
    if (this.peek() !== ch) {
      throw new SfParseError(`expected '${ch}' at offset ${this.i}, found '${this.peek() ?? 'EOF'}'`);
    }
    this.i += 1;
  }

  skipSp(): void {
    while (this.peek() === ' ') this.i += 1;
  }

  skipOws(): void {
    while (this.peek() === ' ' || this.peek() === '\t') this.i += 1;
  }

  matchRun(re: RegExp): string {
    let out = '';
    for (;;) {
      const c = this.peek();
      if (c === null || !re.test(c)) return out;
      out += c;
      this.i += 1;
    }
  }
}

const KEY_START = /^[a-z*]$/;
const KEY_CHAR = /^[a-z0-9_\-.*]$/;
const DIGIT = /^[0-9]$/;
const TOKEN_START = /^[A-Za-z*]$/;
const TOKEN_CHAR = /^[A-Za-z0-9!#$%&'*+\-.^_`|~:/]$/;
const B64_CHAR = /^[A-Za-z0-9+/=]$/;

function parseKey(c: Cursor): string {
  const first = c.peek();
  if (first === null || !KEY_START.test(first)) {
    throw new SfParseError(`expected a key, found '${first ?? 'EOF'}'`);
  }
  return c.matchRun(KEY_CHAR);
}

function parseBareItem(c: Cursor): SfBareItem {
  const first = c.peek();
  if (first === null) throw new SfParseError('expected an item, found end of field');
  if (first === '"') return { type: 'string', value: parseString(c) };
  if (first === ':') return { type: 'binary', value: parseBinary(c) };
  if (first === '?') return { type: 'boolean', value: parseBoolean(c) };
  if (first === '-' || DIGIT.test(first)) return { type: 'integer', value: parseInteger(c) };
  if (TOKEN_START.test(first)) return { type: 'token', value: c.matchRun(TOKEN_CHAR) };
  throw new SfParseError(`not a recognised bare item at '${first}'`);
}

function parseString(c: Cursor): string {
  c.expect('"');
  let out = '';
  for (;;) {
    const ch = c.take();
    if (ch === '\\') {
      const esc = c.take();
      if (esc !== '"' && esc !== '\\') {
        throw new SfParseError(`invalid escape '\\${esc}' in sf-string`);
      }
      out += esc;
    } else if (ch === '"') {
      return out;
    } else if (!PRINTABLE_ASCII.test(ch)) {
      throw new SfParseError('non-printable character in sf-string');
    } else {
      out += ch;
    }
  }
}

function parseInteger(c: Cursor): number {
  let sign = 1;
  if (c.peek() === '-') {
    c.take();
    sign = -1;
  }
  const digits = c.matchRun(DIGIT);
  if (digits.length === 0) throw new SfParseError('expected digits in sf-integer');
  // A '.' here means sf-decimal, which is a float. Refused: floats are banned
  // from anything hashed, and a signature parameter is hashed by definition.
  if (c.peek() === '.') throw new SfParseError('sf-decimal is not accepted (no floats in a signed structure)');
  if (digits.length > 15) throw new SfParseError('sf-integer longer than 15 digits');
  return sign * Number(digits);
}

function parseBoolean(c: Cursor): boolean {
  c.expect('?');
  const v = c.take();
  if (v === '1') return true;
  if (v === '0') return false;
  throw new SfParseError(`invalid sf-boolean '?${v}'`);
}

function parseBinary(c: Cursor): Uint8Array {
  c.expect(':');
  const b64 = c.matchRun(B64_CHAR);
  c.expect(':');
  // Strict: the lenient decoder would accept two spellings of the same bytes.
  if (b64.length % 4 !== 0) throw new SfParseError('sf-binary is not padded base64');
  const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  if (Buffer.from(bytes).toString('base64') !== b64) {
    throw new SfParseError('sf-binary is not canonical base64');
  }
  return bytes;
}

function parseParams(c: Cursor): SfParams {
  const params: [string, SfBareItem][] = [];
  const seen = new Set<string>();
  while (c.peek() === ';') {
    c.take();
    c.skipSp();
    const key = parseKey(c);
    if (seen.has(key)) throw new SfParseError(`parameter '${key}' appears twice`);
    seen.add(key);
    if (c.peek() === '=') {
      c.take();
      params.push([key, parseBareItem(c)]);
    } else {
      params.push([key, { type: 'boolean', value: true }]);
    }
  }
  return params;
}

function parseItem(c: Cursor): SfItem {
  return { kind: 'item', bare: parseBareItem(c), params: parseParams(c) };
}

function parseInnerList(c: Cursor): SfInnerList {
  c.expect('(');
  const items: SfItem[] = [];
  for (;;) {
    c.skipSp();
    if (c.peek() === ')') {
      c.take();
      return { kind: 'inner-list', items, params: parseParams(c) };
    }
    items.push(parseItem(c));
    const next = c.peek();
    if (next !== ' ' && next !== ')') {
      throw new SfParseError('inner-list members must be separated by a single space');
    }
  }
}

/** Parse a dictionary field. Throws {@link SfParseError} on any deviation. */
export function parseDictionary(field: string): SfDictionary {
  const c = new Cursor(field.trim());
  const out: [string, SfMember][] = [];
  const seen = new Set<string>();
  if (c.done) return out;
  for (;;) {
    const key = parseKey(c);
    if (seen.has(key)) {
      throw new SfParseError(`dictionary key '${key}' appears twice (refused rather than last-wins)`);
    }
    seen.add(key);
    if (c.peek() === '=') {
      c.take();
      out.push([key, c.peek() === '(' ? parseInnerList(c) : parseItem(c)]);
    } else {
      out.push([key, { kind: 'item', bare: { type: 'boolean', value: true }, params: parseParams(c) }]);
    }
    c.skipOws();
    if (c.done) return out;
    c.expect(',');
    c.skipOws();
    if (c.done) throw new SfParseError('trailing comma in dictionary');
  }
}

export function dictGet(dict: SfDictionary, key: string): SfMember | null {
  for (const [k, v] of dict) if (k === key) return v;
  return null;
}
