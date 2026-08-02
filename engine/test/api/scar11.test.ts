/**
 * SCAR-11 and SEC-6 — malformed input to every endpoint.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * High Water had no error middleware. A malformed body reached Express's default
 * handler and the response was an HTML stack trace carrying absolute `/opt` paths,
 * the library versions, and the shape of the deploy. Nothing failed. Nothing was
 * logged. It was found months later by a person poking the API by hand.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * TESTING.md's entry is precise about the assertion: *"malformed input to every
 * endpoint returns clean JSON, no paths, no versions"*. So this file is written as a
 * **matrix**: every hostile body shape × every endpoint, with the leak assertions
 * applied uniformly. A per-endpoint test would have to be remembered when an
 * endpoint is added; a matrix over the route list cannot forget.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PATHS, agent, harness, publicKeyOf, raw, signed, type Harness } from './harness.js';

let h: Harness;

beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

/**
 * Every route that takes a body, and every route that does not.
 *
 * Split because the hostile *input* is a different thing on each: a GET cannot carry
 * a body at all (fetch refuses to send one), so its fuzz surface is the query string
 * and the headers. Running the body matrix against a GET would have "passed" by
 * never issuing the request, which is the false green this whole file is about.
 */
const BODY_ROUTES: readonly (readonly [string, string])[] = Object.freeze([
  ['POST', PATHS.enroll],
  ['POST', PATHS.act],
  ['POST', PATHS.discrepancy],
]);

const QUERY_ROUTES: readonly (readonly [string, string])[] = Object.freeze([
  ['GET', PATHS.observe],
  ['GET', PATHS.health],
]);

/**
 * Hostile bodies. Each has a reason and none of them is a variation on the others:
 * a parser, a decoder, a depth guard and a size guard are four different pieces of
 * code, and a body that only exercises one proves nothing about the rest.
 */
const HOSTILE: readonly (readonly [string, string | Uint8Array])[] = Object.freeze([
  ['truncated json', '{"handle": '],
  ['not json at all', '<html><body>hi</body></html>'],
  ['a bare array', '[1,2,3]'],
  ['a bare number', '42'],
  ['a lone quote', '"'],
  // Constructed, never pasted: a literal NUL in this source is what made `file(1)`
  // report the whole file as `data` and grep skip all seventy assertions in it.
  ['nul byte inside a string', `{"handle": "a${String.fromCharCode(0)}b"}`],
  ['invalid utf-8', new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xff, 0xfe, 0x7d])],
  ['deeply nested', `{"a":${'['.repeat(64)}1${']'.repeat(64)}}`],
  ['prototype pollution attempt', '{"__proto__": {"admin": true}, "handle": "x"}'],
  ['sql-ish injection', `{"handle": "'; DROP TABLE event; --"}`],
  ['unicode direction overrides', '{"handle": "‮x‭"}'],
  ['empty body', ''],
]);

/**
 * The leak patterns. **These are the assertions that matter** and they run on the
 * raw response text, not the parsed JSON, because a leak inside a string value is
 * still a leak.
 */
function assertNoLeak(text: string, contentType: string): void {
  // HTML at all is the failure: Express's stack page is HTML and nothing this API
  // sends is.
  expect(contentType).toContain('application/json');
  expect(text).not.toMatch(/<!DOCTYPE|<html|<pre>|<br>/i);
  // Absolute paths, in every spelling a deploy could produce.
  expect(text).not.toMatch(/\/(?:Users|home|opt|srv|var|usr|private|tmp|etc|root)\//);
  expect(text).not.toMatch(/[A-Za-z]:\\/);
  expect(text).not.toContain('node_modules');
  expect(text).not.toMatch(/file:\/\//);
  // Stack frames.
  expect(text).not.toMatch(/\bat\s+\w+\s*\(/);
  expect(text).not.toContain('SyntaxError');
  expect(text).not.toContain('JSON.parse');
  // Versions, of ours or of anything we depend on.
  expect(text).not.toMatch(/\bv?\d+\.\d+\.\d+/);
  expect(text).not.toMatch(/express/i);
  expect(text).not.toMatch(/\bnode:[a-z]/);
}

describe('SCAR-11 — malformed input never leaks the host', () => {
  for (const [method, path] of BODY_ROUTES) {
    for (const [label, body] of HOSTILE) {
      it(`${method} ${path} with ${label} answers clean JSON`, async () => {
        const res = await raw(h, method, path, body, { 'content-type': 'application/json' });
        expect(res.status).toBeGreaterThanOrEqual(200);
        expect(res.status).toBeLessThan(600);
        assertNoLeak(res.text, res.contentType);
        // Every non-2xx carries the closed-set reason and a sentence, so a probe can
        // aggregate `rejections_by_reason` (TESTING.md §16).
        if (res.status >= 400) {
          expect(typeof res.json['reason']).toBe('string');
          expect(typeof res.json['detail']).toBe('string');
        }
      });
    }
  }

  for (const [method, path] of QUERY_ROUTES) {
    for (const [label, body] of HOSTILE) {
      it(`${method} ${path} with ${label} in the query answers clean JSON`, async () => {
        const payload = typeof body === 'string' ? body : '\uffff\ufffe';
        const res = await raw(h, method, `${path}?q=${encodeURIComponent(payload)}`, undefined, {
          // Hostile headers too: a header value reaches the signature base, and the
          // signature base reaches an error message. Header values are byte strings
          // by spec, so the non-ASCII cases are percent-encoded rather than dropped —
          // dropping them would be the test quietly not running.
          'x-probe': encodeURIComponent(payload).slice(0, 200),
        });
        expect(res.status).toBeGreaterThanOrEqual(200);
        assertNoLeak(res.text, res.contentType);
      });
    }
  }

  it('an unknown route answers JSON, not the HTML 404 page', async () => {
    const res = await raw(h, 'GET', '/api/does-not-exist');
    expect(res.status).toBe(404);
    assertNoLeak(res.text, res.contentType);
    expect(res.json['reason']).toBe('NO_SUCH_ROUTE');
    // Helpful: it names the whole API rather than only saying no.
    expect(String(res.json['detail'])).toContain('/api/observe');
  });

  it('a wrong method on a real path answers JSON', async () => {
    const res = await raw(h, 'DELETE', PATHS.observe);
    expect(res.status).toBeGreaterThanOrEqual(400);
    assertNoLeak(res.text, res.contentType);
  });

  it('an oversized body is refused with a size, not a stack', async () => {
    const huge = `{"handle":"${'a'.repeat(200_000)}"}`;
    const res = await raw(h, 'POST', PATHS.enroll, huge, { 'content-type': 'application/json' });
    expect([400, 413]).toContain(res.status);
    assertNoLeak(res.text, res.contentType);
    expect(String(res.json['reason'])).toBe('BODY_TOO_LARGE');
  });

  it('never advertises the framework', async () => {
    const res = await fetch(`${h.origin}${PATHS.health}`);
    expect(res.headers.get('x-powered-by')).toBeNull();
    await res.text();
  });

  it('serves agent.md as markdown, and the markdown carries nothing of the host', async () => {
    // The one route that is legitimately not JSON: it is the rules document, served
    // so a harness needs nothing but HTTP (§12.5). The leak assertions still apply
    // to its *content*, because it is read from disk on the deploy box.
    const res = await raw(h, 'GET', `${PATHS.agentMd}?q=${encodeURIComponent('{"a":')}`);
    expect(res.status).toBe(200);
    expect(res.contentType).toContain('text/markdown');
    expect(res.text).toContain('THE COMPACT');
    expect(res.text).not.toMatch(/\/(?:Users|home|opt|srv|var|usr|private|root)\//);
    expect(res.text).not.toContain('node_modules');
  });

  it('a genuine throw inside a route becomes clean JSON, which is the scar itself', async () => {
    // Every other case in this file is a *refusal*. This one is the actual scar: an
    // unexpected exception on the happy path, which is what produced High Water's HTML
    // stack trace. Provoked by making the world's own state unreadable mid-request —
    // deleting the holding a served observation must read — so the throw comes from
    // inside the handler rather than from a mock.
    const a = agent('thrower');
    const enrolled = await raw(h, 'POST', PATHS.enroll, JSON.stringify({ handle: 'thrower', publicKey: publicKeyOf(a) }), {
      'content-type': 'application/json',
    });
    expect(enrolled.status).toBe(201);
    const principal = String(enrolled.json['principalId']);
    h.runtime.world.holdingByPrincipal.delete(principal as never);

    const res = await signed(h, a, 'GET', PATHS.observe);
    expect(res.status).toBe(500);
    assertNoLeak(res.text, res.contentType);
    expect(res.json['reason']).toBe('INTERNAL');
    // And it tells the agent the two things it needs: nothing was charged, and where
    // to report it (A5′'s sensor).
    expect(String(res.json['detail'])).toContain('Nothing was charged');
    expect(String(res.json['detail'])).toContain('/api/discrepancy');
  });

  it('a query string full of junk does not reach a parser that reports its input', async () => {
    const res = await raw(h, 'GET', `${PATHS.observe}?wait=%%%&limit=${'9'.repeat(400)}`);
    // Unsigned, so this is a signature refusal — the point is only that whatever it
    // is, it is clean.
    assertNoLeak(res.text, res.contentType);
  });
});

describe('SEC-6 — the fuzz surface, asserted rather than assumed', () => {
  it('a prototype-pollution body does not pollute the prototype', async () => {
    await raw(h, 'POST', PATHS.enroll, '{"__proto__": {"polluted": true}, "handle": "x", "publicKey": "y"}', {
      'content-type': 'application/json',
    });
    // If `JSON.parse` + spread had been used carelessly anywhere, this would be true.
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('a NUL byte in a handle is refused rather than stored', async () => {
    // Two builders on this project used NUL as a key separator, and `file(1)` then
    // reports the source as `data` while grep skips it entirely. A NUL that reaches
    // a stored handle would do the same to the event ledger.
    //
    // ---- THE BYTE IS BUILT, NEVER PASTED, AND THAT IS THE POINT ----------------
    //
    // This test used to carry a **literal NUL byte** in its own source. It was the only
    // file in the repo that did, `file(1)` reported all 227 lines of it as `data`, and
    // `grep -rn assertNoLeak test/api/` silently skipped every one of the seventy
    // assertions in it. The test warning about the hazard was the file demonstrating it,
    // and `tsc`, `eslint` and `vitest` were all green throughout — which is exactly the
    // failure mode described two lines above.
    //
    // `test/core/vocabulary-repo.test.ts`'s "no source file contains a NUL byte" guard
    // did not catch it because `srcFiles()` was rooted at `src/` alone, even though that
    // guard's own comment says wave 1 shipped one "in an identity test". Both halves are
    // fixed: the byte is constructed here, and the guard now walks `test/` too.
    const nul = String.fromCharCode(0);
    for (const handle of [`ab${nul}cd`, `${nul}vale`, `vale${nul}`]) {
      const res = await raw(h, 'POST', PATHS.enroll, JSON.stringify({ handle, publicKey: 'x'.repeat(43) }), {
        'content-type': 'application/json',
      });
      expect(res.status, `handle ${JSON.stringify(handle)} was not refused`).toBe(400);
      expect(res.json['reason']).toBe('FIELD_MALFORMED');
      assertNoLeak(res.text, res.contentType);
      expect(h.context.seats.rows).toBe(0);
      expect(h.runtime.world.principalOrder).toHaveLength(0);
    }
    // A space is a different mistake, and refusing it is what the original assertion
    // proved. Kept, so both are pinned rather than one standing in for the other.
    const spaced = await raw(h, 'POST', PATHS.enroll, JSON.stringify({ handle: 'ab cd', publicKey: 'x'.repeat(43) }), {
      'content-type': 'application/json',
    });
    expect(spaced.status).toBe(400);
    expect(h.context.seats.rows).toBe(0);
  });

  it('a body with no content-type is still read as bytes and refused cleanly', async () => {
    const res = await raw(h, 'POST', PATHS.enroll, 'not json');
    expect(res.status).toBe(400);
    assertNoLeak(res.text, res.contentType);
  });
});
