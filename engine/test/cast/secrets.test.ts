/**
 * HARD RULE 1, as a test: **no key value may ever be logged, thrown, or committed.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE STRING BELOW IS NOT A KEY.** It is `sk-` followed by the words "this is not a
 * real key", assembled at runtime so it is not even a contiguous literal in this file.
 * Its only job is to be findable: a redactor can only be tested by giving it something to
 * redact, and a test that redacts nothing proves nothing.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The interesting leak is never "somebody printed the key on purpose". It is a 401 whose
 * body echoes the `Authorization` header into an error string, which becomes a log line,
 * which becomes a journal row, which becomes a file on a box. So the test checks the
 * whole path: the transport's own error, the cast's log sink, and the source files.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  CastTransportError,
  describeFailure,
  openAiTransport,
  REDACTED,
  redactSecrets,
} from '../../src/cast/index.js';
import { harness, MockTransport } from './mock.js';

/** Assembled, never written whole. See the module note: this is not a credential. */
const FAKE_KEY = ['sk', 'this', 'is', 'not', 'a', 'real', 'key', '000111222'].join('-');

let saved: string | undefined;

beforeEach(() => {
  saved = process.env['OPENAI_API_KEY'];
  process.env['OPENAI_API_KEY'] = FAKE_KEY;
});

afterEach(() => {
  if (saved === undefined) delete process.env['OPENAI_API_KEY'];
  else process.env['OPENAI_API_KEY'] = saved;
});

describe('redaction', () => {
  it('removes the live key by literal match', () => {
    const leaked = `request failed with header Authorization: Bearer ${FAKE_KEY} (401)`;
    const clean = redactSecrets(leaked);
    expect(clean).not.toContain(FAKE_KEY);
    expect(clean).toContain(REDACTED);
  });

  it('removes a key whose SHAPE the regex would not have caught', () => {
    // The literal-match pass, isolated. `FAKE_KEY` is `sk-`-prefixed, so the shape regex
    // catches it too and a test using it would pass with the literal pass deleted. A
    // provider that stops prefixing its keys is not hypothetical, and the literal match
    // is the only pass that would still work on that day.
    const shapeless = ['COMPACT', 'TEST', 'CREDENTIAL', 'ZZZZ9999'].join('_');
    const before = process.env['OPENAI_API_KEY'];
    process.env['OPENAI_API_KEY'] = shapeless;
    try {
      const clean = redactSecrets(`upstream rejected ${shapeless} at 09:00`);
      expect(clean).not.toContain(shapeless);
      expect(clean).toContain(REDACTED);
    } finally {
      if (before === undefined) delete process.env['OPENAI_API_KEY'];
      else process.env['OPENAI_API_KEY'] = before;
    }
  });

  it('removes a key-shaped string this process never held', () => {
    // The case the literal match cannot catch: a proxy's error body carrying somebody
    // else's credential, or a second variable nobody told us about.
    const other = ['sk', 'proj', 'AAAABBBBCCCCDDDD'].join('-');
    const clean = redactSecrets(`upstream said: {"error":{"message":"bad key ${other}"}}`);
    expect(clean).not.toContain(other);
  });

  it('removes a bearer token whatever its shape', () => {
    const clean = redactSecrets('authorization: Bearer abcdef.ghijkl-mnopqr_123');
    expect(clean).not.toContain('abcdef.ghijkl-mnopqr_123');
  });

  it('bounds and flattens whatever it is given, so an HTML error page cannot be a log line', () => {
    const page = `<html>${'x'.repeat(5_000)} ${FAKE_KEY}</html>`;
    const line = describeFailure(new Error(page));
    expect(line.length).toBeLessThanOrEqual(241);
    expect(line).not.toContain(FAKE_KEY);
    expect(line).not.toContain('\n');
  });

  it('is applied by CastTransportError’s own constructor, before the message exists', () => {
    const error = new CastTransportError(`completions returned 401: bad key ${FAKE_KEY}`, 401);
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).toContain(REDACTED);
    expect(`${error.name}: ${error.message}`).not.toContain(FAKE_KEY);
    // And the stack, which is what actually gets printed by an unhandled rejection.
    expect(error.stack ?? '').not.toContain(FAKE_KEY);
  });
});

describe('the transport never surfaces the key', () => {
  it('reports a MISSING key by variable name and says nothing else about it', async () => {
    delete process.env['OPENAI_API_KEY'];
    const transport = openAiTransport({ url: 'http://127.0.0.1:1/never' });
    await expect(
      transport.complete({ model: 'm', messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 1 }),
    ).rejects.toThrow('OPENAI_API_KEY is not set');
  });

  it('passes the key in the header and never anywhere else in the request', async () => {
    let seenBody = '';
    let seenAuth = '';
    const transport = openAiTransport({
      url: 'http://example.invalid/v1',
      fetchImpl: ((_url: string, init: RequestInit) => {
        seenBody = typeof init.body === 'string' ? init.body : '';
        const headers = init.headers as Record<string, string>;
        seenAuth = headers['authorization'] ?? '';
        return Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 }),
        );
      }) as unknown as typeof fetch,
    });
    await transport.complete({
      model: 'gpt-5.6-luna',
      messages: [{ role: 'user', content: 'hello' }],
      maxOutputTokens: 10,
    });
    // The one place it belongs.
    expect(seenAuth).toContain(FAKE_KEY);
    // And nowhere else. A key in the body is a key in every provider-side log.
    expect(seenBody).not.toContain(FAKE_KEY);
  });

  it('redacts a provider error body that echoes the header back', async () => {
    const transport = openAiTransport({
      url: 'http://example.invalid/v1',
      fetchImpl: (() =>
        Promise.resolve(
          new Response(`{"error":"invalid key: ${FAKE_KEY}"}`, { status: 401 }),
        )) as unknown as typeof fetch,
    });
    await expect(
      transport.complete({ model: 'm', messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 1 }),
    ).rejects.toThrow(/redacted/);
    await transport
      .complete({ model: 'm', messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 1 })
      .catch((error: unknown) => {
        expect(String(error)).not.toContain(FAKE_KEY);
      });
  });
});

describe('the cast’s own log sink', () => {
  it('cannot emit a key even when the transport error is stuffed with one', async () => {
    const transport = MockTransport.fails(`401 unauthorized: Bearer ${FAKE_KEY} rejected`);
    const h = harness(transport, { size: 2, wakeGapTicks: 2 });
    await h.run(8);

    const everything = h.logs.join('\n');
    expect(everything).not.toContain(FAKE_KEY);
    // And the memory the next prompt is built from, which is the sneakiest path: an
    // error message becomes a note becomes a prompt becomes a provider-side log.
    for (const call of transport.calls) {
      for (const message of call.request.messages) {
        expect(message.content).not.toContain(FAKE_KEY);
      }
    }
  });
});

describe('nothing in the source or the tests carries a credential', () => {
  it('only transport.ts may use the key’s VALUE; index.ts may only test that it exists', () => {
    const dir = new URL('../../src/cast/', import.meta.url);
    const readers: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts')) continue;
      const source = readFileSync(new URL(name, dir), 'utf8');
      if (!source.includes('OPENAI_API_KEY')) continue;
      readers.push(name);
      if (name === 'transport.ts') continue;
      // Everywhere else, every line that actually READS the variable must be a PRESENCE
      // test and nothing more: the value may not be bound to a name, interpolated, or
      // passed anywhere. A second file that holds the value is a second place it can
      // escape from. Naming the variable in prose is fine and is the whole point of the
      // operator message — the name is the only fact about a key we may ever state.
      const access = /\[\s*['"]OPENAI_API_KEY['"]\s*\]|\.OPENAI_API_KEY\b/;
      for (const line of source.split('\n')) {
        if (!access.test(line)) continue;
        expect(line, `${name}: ${line.trim()}`).toMatch(/length === 0|length > 0|=== undefined|!== undefined/);
        expect(line, `${name}: interpolates the value`).not.toContain('${');
      }
    }
    expect(readers.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(['index.ts', 'transport.ts']);
  });

  it('no source or test file contains a key-shaped literal', () => {
    // `sk-` followed by enough characters to be a credential. Assembled here so this
    // assertion does not trip over itself.
    const shape = new RegExp(`${'sk'}-[A-Za-z0-9_-]{16,}`);
    for (const base of ['../../src/cast/', './']) {
      const dir = new URL(base, import.meta.url);
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.ts')) continue;
        const source = readFileSync(new URL(name, dir), 'utf8');
        expect(shape.test(source), `${name} carries a key-shaped literal`).toBe(false);
      }
    }
  });
});
