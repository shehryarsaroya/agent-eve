/**
 * The address grammar — the one field a stranger types that becomes a mail header.
 *
 * Scar #12's relay put attacker-chosen text into real mail. The address cannot be kept out of
 * the mail (it is the recipient), so it is held to a grammar that cannot carry anything else:
 * every hostile shape below must be REFUSED, and every ordinary address accepted and
 * normalised so the per-address caps cannot be dodged by changing case.
 */

import { describe, expect, it } from 'vitest';
import { IDENTITY_LABEL_DOMAINS, MAX_EMAIL_LENGTH, normaliseEmail } from '../../src/api/follow/index.js';

function ok(raw: unknown): string {
  const v = normaliseEmail(raw);
  if (!v.ok) throw new Error(`expected ${String(raw)} to be accepted: ${v.detail}`);
  return v.value;
}

function refused(raw: unknown): string {
  const v = normaliseEmail(raw);
  if (v.ok) throw new Error(`expected ${JSON.stringify(raw)} to be refused, got ${v.value}`);
  return v.detail;
}

describe('normaliseEmail accepts ordinary addresses', () => {
  it('passes a plain address through, lower-cased and trimmed', () => {
    expect(ok('you@example.com')).toBe('you@example.com');
    expect(ok('  You@Example.COM ')).toBe('you@example.com');
  });

  it('keeps the dot-atom characters people really use', () => {
    expect(ok('first.last+eve@sub.example.co.uk')).toBe('first.last+eve@sub.example.co.uk');
    expect(ok("o'brien_x-1@example.org")).toBe("o'brien_x-1@example.org");
    expect(ok('a@xn--bcher-kva.example')).toBe('a@xn--bcher-kva.example');
  });

  it('normalises case, so the per-address cap cannot be dodged with capitals', () => {
    expect(ok('ME@x.io')).toBe(ok('me@X.IO'));
  });
});

describe('normaliseEmail refuses every shape that is not exactly one address', () => {
  it.each([
    ['header injection by CRLF', 'you@example.com\r\nBcc: victim@example.com'],
    ['a bare LF', 'you@example.com\nX: y'],
    ['an embedded NUL', 'you@exa\u0000mple.com'],
    ['an internal space', 'you @example.com'],
    ['a tab', 'you\t@example.com'],
    ['a display name', 'Eve <you@example.com>'],
    ['a second address', 'you@example.com,them@example.com'],
    ['a second @', 'you@x@example.com'],
    ['no @', 'example.com'],
    ['an empty local part', '@example.com'],
    ['an empty domain', 'you@'],
    ['a leading dot', '.you@example.com'],
    ['a trailing dot', 'you.@example.com'],
    ['a doubled dot', 'you..me@example.com'],
    ['a quoted local part', '"you me"@example.com'],
    ['a comment', 'you(comment)@example.com'],
    ['an IP literal', 'you@[127.0.0.1]'],
    ['a bare IP', 'you@127.0.0.1'],
    ['a single-label domain', 'you@localhost'],
    ['a numeric top label', 'you@example.123'],
    ['a label with a leading hyphen', 'you@-example.com'],
    ['non-ASCII', 'yöu@example.com'],
    ['angle brackets', '<you@example.com>'],
    ['an HTML payload', '<script>alert(1)</script>@example.com'],
  ])('%s', (_name, raw) => {
    expect(refused(raw).length).toBeGreaterThan(10);
  });

  it('refuses a non-string and an empty string with a sentence, never a throw', () => {
    for (const raw of [undefined, null, 42, {}, [], '', '   ']) {
      expect(() => normaliseEmail(raw)).not.toThrow();
      expect(normaliseEmail(raw).ok).toBe(false);
    }
  });

  it('refuses an address over the RFC 5321 length, and a local part over 64', () => {
    expect(refused(`${'a'.repeat(250)}@example.com`)).toContain(String(MAX_EMAIL_LENGTH));
    refused(`${'a'.repeat(65)}@example.com`);
  });

  it("refuses the game's own identity labels, which are not mailboxes, and says why", () => {
    for (const domain of IDENTITY_LABEL_DOMAINS) {
      const detail = refused(`vale@${domain}`);
      expect(detail).toContain('identity labels');
      refused(`vale@send.${domain}`);
    }
    // A domain that merely ENDS in the same letters is not the same domain.
    expect(ok('vale@notagenteve.io')).toBe('vale@notagenteve.io');
  });

  it('honours an extra refused domain (the configured from-address domain)', () => {
    expect(normaliseEmail('a@mail.example', ['mail.example']).ok).toBe(false);
    expect(normaliseEmail('a@mail.example', []).ok).toBe(true);
  });
});
