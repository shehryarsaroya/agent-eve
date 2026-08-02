/**
 * The three Gate-3 barriers that live at the HTTP boundary.
 *
 * ┌─ 1. `@path`, AND IT WAS "THE SINGLE BIGGEST BARRIER IN THE PRODUCT" ──────┐
 * │ A probe wrote a textbook RFC 9421 client and got 401 SIGNATURE_INVALID    │
 * │ until it signed `"@path": /observe` instead of `/api/observe`,     │
 * │ found by brute-forcing eight variants at a cost of five rejections and a   │
 * │ large part of its session. `deploy/nginx-compact.conf` proxies            │
 * │ `/api/` to the app root, so the app is handed `/observe` while the │
 * │ client sent `/api/observe` — and §2.2.6 says the client is right.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 * ┌─ 2. `/enroll` COST 27 MINUTES FOR ONE ENROLMENT ──────────────────────────┐
 * │ Three requests per ten minutes, and a `FIELD_MALFORMED` refusal that      │
 * │ created nothing still burned one — opening a fresh window and pushing     │
 * │ `Retry-After` from 383 s to 589 s. A client bug became an outage.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 * ┌─ 3. `/discrepancy` — "the single most useful thing you can send us" ──────┐
 * │ — had the tightest limits in the API, an undocumented 480-character cap    │
 * │ that rejected a probe's most important report three times, and field names │
 * │ agent.md §13 never states.                                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The identity module proves the signature arithmetic in isolation
 * (`test/identity/httpsig-path.test.ts`). What only exists over a socket, and is
 * therefore only testable here, is the *reduction* — which target spelling the app
 * hands the verifier, and whether the diagnostic survives the outbound scrubber.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { API_BASE_PATH, MAX_DISCREPANCIES, MAX_HANDLE_LENGTH } from '../../src/api/index.js';
import { MAX_REPORT_LENGTH, requestTargetsFor } from '../../src/api/server.js';
import {
  LOOSE_LIMITS,
  PATHS,
  agent,
  buildSigned,
  enrol,
  harness,
  publicKeyOf,
  raw,
  signed,
  type Harness,
} from './harness.js';

let h: Harness | null = null;

afterEach(async () => {
  // Nullable because the target-spelling block below is a pure function test and
  // needs no socket. A blanket close would fail those four on teardown.
  if (h !== null) await h.close();
  h = null;
});

/** The live harness, asserted rather than assumed — see the nullable above. */
function live(): Harness {
  if (h === null) throw new Error('no harness: call harness() first');
  return h;
}

/**
 * Sign one target and deliver to another.
 *
 * This is the whole shape of the bug and nothing else in the suite can produce it:
 * `signed()` signs and sends the same string, which is exactly the case that always
 * worked. Delivering to `/observe` while signing `/api/observe` is what
 * nginx does to a conformant client.
 */
async function crossSigned(
  a: ReturnType<typeof agent>,
  signAs: string,
  deliverTo: string,
): Promise<Awaited<ReturnType<typeof raw>>> {
  const { text, headers } = buildSigned(live(), a, 'GET', signAs);
  return raw(live(), 'GET', deliverTo, text ?? undefined, headers);
}

describe('§2.2.6 — the target spellings a signature may be checked against', () => {
  it('canonicalises to the client-visible spelling, whichever one arrived', () => {
    // The two arrivals are byte-identical requests — `/observe` through the stripping
    // proxy and `/observe` direct — so both must produce the same candidate set, with
    // the RFC-correct spelling first. That equality is the fix in one line.
    expect(requestTargetsFor('/observe')).toEqual([`${API_BASE_PATH}/observe`, '/observe']);
    expect(requestTargetsFor(`${API_BASE_PATH}/observe`)).toEqual([
      `${API_BASE_PATH}/observe`,
      '/observe',
    ]);
  });

  it('keeps the query attached to both spellings', () => {
    // `observe?wait=true` is the long poll. A candidate that dropped the query would
    // verify `@path` and break `@query` and `@target-uri` for the one endpoint an
    // offline-tolerant agent uses most.
    expect(requestTargetsFor('/observe?wait=true')).toEqual([
      `${API_BASE_PATH}/observe?wait=true`,
      '/observe?wait=true',
    ]);
  });

  it('always includes the target as received, so no signature that verified before stops verifying', () => {
    // The safety property that makes this landable under a live world: whatever else
    // is offered, the spelling the app was actually handed is in the set.
    for (const received of ['/observe', API_BASE_PATH, `${API_BASE_PATH}/`, '/', '/act?x=1']) {
      expect(requestTargetsFor(received)).toContain(received);
    }
  });

  it('offers no duplicate spellings, so a repeat costs no extra curve operation', () => {
    for (const received of ['/observe', API_BASE_PATH, '/', `${API_BASE_PATH}/act`]) {
      const targets = requestTargetsFor(received);
      expect(new Set(targets).size).toBe(targets.length);
    }
  });
});

describe('a conformant RFC 9421 client is accepted at its first signed request', () => {
  it('accepts the client-visible path when the proxy stripped the mount prefix', async () => {
    h = await harness();
    const a = agent('vale-one');
    await enrol(live(), a);

    // THE PROBE'S EXACT FAILURE. It signed the path it sent; nginx delivered the
    // stripped one. Before this fix, 401 SIGNATURE_INVALID.
    const res = await crossSigned(a, `${API_BASE_PATH}/observe`, '/observe');

    expect(res.status).toBe(200);
    expect(res.json['ok']).toBe(true);
  });

  it('still accepts the app-internal path, which is what the forced workaround signs', async () => {
    h = await harness();
    const a = agent('vale-two');
    await enrol(live(), a);

    // The transitional half, stated plainly: a client that already shipped the
    // `/observe` workaround keeps working rather than breaking on the day we fix this.
    const res = await crossSigned(a, '/observe', `${API_BASE_PATH}/observe`);

    expect(res.status).toBe(200);
    expect(res.json['ok']).toBe(true);
  });

  it('refuses a signature over a different endpoint — only the prefix is forgiven', async () => {
    h = await harness();
    const a = agent('vale-three');
    await enrol(live(), a);

    // `act` and `observe` are different resources, and accepting a mount prefix must
    // never make a signature for one authorise the other.
    const res = await crossSigned(a, `${API_BASE_PATH}/act`, `${API_BASE_PATH}/observe`);

    expect(res.status).toBe(401);
    expect(res.json['reason']).toBe('SIGNATURE_INVALID');
  });
});

describe('a failing signature tells the client what the server computed', () => {
  it('returns the signature base line by line, through the scrubber, intact', async () => {
    h = await harness();
    const a = agent('vale-four');
    await enrol(live(), a);
    const res = await crossSigned(a, `${API_BASE_PATH}/act`, `${API_BASE_PATH}/observe`);

    expect(res.status).toBe(401);
    const diagnostic = res.json['diagnostic'] as Record<string, unknown>;
    expect(diagnostic).toBeDefined();
    const base = diagnostic['signature_base'] as readonly string[];
    // The client can now diff. Before this, it had to guess — eight times.
    expect(base).toContain('"@method": GET');
    expect(base).toContain(`"@path": ${API_BASE_PATH}/observe`);
    expect(diagnostic['request_targets_checked']).toEqual([
      `${API_BASE_PATH}/observe`,
      '/observe',
    ]);
    // One line per covered component, params line last, no line carrying a newline —
    // `scrub` collapses whitespace, so a joined base would arrive unusable.
    expect(base.length).toBe(4);
    expect(base[base.length - 1]).toContain('"@signature-params":');
    for (const line of base) expect(line).not.toContain('\n');
  });

  it('carries an @authority line, whose *value* a scrubber defect corrupts for an IP host', async () => {
    h = await harness();
    const a = agent('vale-nine');
    await enrol(live(), a);
    const res = await crossSigned(a, `${API_BASE_PATH}/act`, `${API_BASE_PATH}/observe`);
    const base = (res.json['diagnostic'] as Record<string, unknown>)['signature_base'] as readonly string[];

    // ══════════════════════════════════════════════════════════════════════
    // **A DEFECT IN `src/api/wire.ts`, REPORTED RATHER THAN BLESSED.**
    //
    // `scrub`'s semver redaction is `\bv?\d+\.\d+\.\d+\b`, and an IPv4 address is a
    // dotted quad: `127.0.0.1` leaves this process as `[version].1`. So this test
    // asserts the line is *present* and deliberately does NOT assert its value —
    // pinning the corrupted spelling would turn a bug into a contract.
    //
    // It is not hypothetical and it is not confined to the diagnostic: the live
    // `RATE_LIMITED` hint reads "too many enroll requests from [version].1", in an
    // agent-facing string, on the endpoint a newcomer meets first. The authority is
    // a hostname in production, which is why it has gone unnoticed. The fix is one
    // regex in a file this agent does not own.
    // ══════════════════════════════════════════════════════════════════════
    expect(base.some((line) => line.startsWith('"@authority":'))).toBe(true);
    expect(live().authority).toMatch(/^127\.0\.0\.1:/);
  });

  it('names @path first and never lets the scrubber mangle the sentence', async () => {
    h = await harness();
    const a = agent('vale-five');
    await enrol(live(), a);
    const res = await crossSigned(a, `${API_BASE_PATH}/act`, `${API_BASE_PATH}/observe`);

    const detail = String(res.json['detail']);
    // The old text named "a different key, or a message that changed in flight" —
    // the two things that were fine — and not the one thing that was wrong.
    expect(detail).toContain('@path');
    expect(detail).toContain(`${API_BASE_PATH}/observe`);
    expect(detail.indexOf('@path')).toBeLessThan(detail.indexOf('different key'));
    // `scrub` redacts anything shaped like a semver and truncates at 480, so a hint
    // that quoted "§2.2.6" or ran long would reach the agent damaged. A rules surface
    // mangled by a security filter is the same class of bug as the one being fixed.
    expect(detail).not.toContain('[version]');
    expect(detail).not.toContain('…');
  });

  it('attaches no diagnostic to a refusal that already names its own cause', async () => {
    h = await harness();
    const a = agent('vale-six');
    await enrol(live(), a);
    // An expired signature needs no base to debug: the reason is the whole answer.
    // A diagnostic on every refusal would be noise, and noise is how the useful one
    // gets ignored.
    const { text, headers } = buildSigned(live(), a, 'GET', PATHS.observe, undefined, {
      createdOffsetSeconds: -600,
    });
    const res = await raw(live(), 'GET', PATHS.observe, text ?? undefined, headers);

    expect(res.status).toBe(401);
    expect(res.json['reason']).toBe('CREATED_TOO_OLD');
    expect(res.json['diagnostic']).toBeUndefined();
  });
});

describe('a request that creates nothing does not spend an enrolment window', () => {
  /** One enrolment per ten minutes, so the second attempt is unambiguous. */
  const TIGHT = { ...LOOSE_LIMITS, enroll: { burst: 1, windowSeconds: 600 } };

  it('refuses a malformed handle for free, and says so', async () => {
    h = await harness({ limits: TIGHT });
    // The probe's underscore guess. agent.md §2 shows only the example "vale" and
    // states no grammar, so guessing is the documented experience.
    const bad = await raw(
      live(),
      'POST',
      PATHS.enroll,
      JSON.stringify({ handle: 'red_ash', publicKey: publicKeyOf(agent('x')) }),
      { 'content-type': 'application/json' },
    );
    expect(bad.status).toBe(400);
    expect(bad.json['reason']).toBe('FIELD_MALFORMED');
    // The grammar, as a pattern and as examples — the engine's refusal is the only
    // place it is stated anywhere an agent can read.
    expect(String(bad.json['detail'])).toContain('a-z');
    expect(String(bad.json['detail'])).toContain(String(MAX_HANDLE_LENGTH));
    // And the sentence that turns a ten-minute stall into an immediate retry.
    expect(String(bad.json['detail'])).toContain('no rate-limit window was charged');

    // The window is intact: the very next request enrols.
    const good = await enrol(live(), agent('red-ash'));
    expect(good.status).toBe(201);
  });

  it('refuses a malformed body and a malformed key for free too', async () => {
    h = await harness({ limits: TIGHT });
    expect((await raw(live(), 'POST', PATHS.enroll, 'not json')).status).toBe(400);
    expect(
      (await raw(live(), 'POST', PATHS.enroll, JSON.stringify({ handle: 'ok-one', publicKey: 'nope' }))).status,
    ).toBe(400);
    expect((await raw(live(), 'POST', PATHS.enroll, JSON.stringify({ handle: 'ok-two' }))).status).toBe(400);

    // Three refusals, nothing created, window untouched.
    expect((await enrol(live(), agent('ok-three'))).status).toBe(201);
  });

  it('still charges a well-formed request, because handle enumeration must stay metered', async () => {
    h = await harness({ limits: TIGHT });
    const first = await enrol(live(), agent('taken-name'));
    expect(first.status).toBe(201);

    // A second *well-formed* enrolment is a real lookup against real state. Leaving
    // that free would hand over a free handle-enumeration oracle, so it is metered
    // and this one is refused by the limiter rather than by the seat book.
    const second = await raw(
      live(),
      'POST',
      PATHS.enroll,
      JSON.stringify({ handle: 'taken-name', publicKey: publicKeyOf(agent('y')) }),
      { 'content-type': 'application/json' },
    );
    expect(second.status).toBe(429);
    expect(second.json['reason']).toBe('RATE_LIMITED');
  });
});

describe('/discrepancy accepts the shape agent.md describes', () => {
  it('reads agent.md’s own words — "what you expected and what happened"', async () => {
    h = await harness();
    // agent.md §13 names no field at all, so `happened` is the spelling a reporter
    // following the document reaches for. `read_from` teaches it the canon back.
    const res = await signed(live(), agent('rep-one'), 'POST', PATHS.discrepancy, {
      expected: 'my elective part was paid',
      happened: 'a default was recorded against me',
    });

    expect(res.status).toBe(202);
    expect(res.json['read_from']).toEqual(['expected', 'happened']);
    expect(live().context.discrepancies[0]?.observed).toContain('a default was recorded');
  });

  it('accepts a single free-text report, because one string is what a reporter has', async () => {
    h = await harness();
    const res = await signed(live(), agent('rep-two'), 'POST', PATHS.discrepancy, {
      report: 'venture v1 closed ABANDONED with no countersignature and no way to sign one',
    });

    expect(res.status).toBe(202);
    expect(res.json['read_from']).toEqual(['report']);
    expect(live().context.discrepancies[0]?.observed).toContain('no countersignature');
    // The half that was not stated is recorded as such, never as an empty string —
    // a blank field reads as a report we lost.
    expect(live().context.discrepancies[0]?.expected).toBe('(not stated)');
  });

  it('accepts either half alone, because the most serious report has only one', async () => {
    h = await harness();
    // "A default was recorded against me and it is wrong" is the highest-severity
    // thing in this game. Refusing it for a missing second field is indefensible.
    const res = await signed(live(), agent('rep-three'), 'POST', PATHS.discrepancy, {
      observed: 'a default was recorded against me and it is wrong',
    });
    expect(res.status).toBe(202);
    expect(res.json['read_from']).toEqual(['observed']);
  });

  it('refuses an empty report, and refuses it for free', async () => {
    h = await harness({ limits: { ...LOOSE_LIMITS, discrepancy: { burst: 1, windowSeconds: 600 } } });
    const empty = await signed(live(), agent('rep-four'), 'POST', PATHS.discrepancy, { expected: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.json['reason']).toBe('FIELD_MISSING');
    expect(String(empty.json['detail'])).toContain('no rate-limit window was charged');

    // The one window this harness allows is still there, so the report that follows
    // the hint lands. Guessing the shape must not cost the report.
    const then = await signed(live(), agent('rep-five'), 'POST', PATHS.discrepancy, { report: 'x' });
    expect(then.status).toBe(202);
  });
});

describe('/discrepancy is long enough for the report a probe actually had', () => {
  it('records a report far longer than one outbound detail, in full', async () => {
    h = await harness();
    // 480 characters was the cap, and it is `MAX_DETAIL_LENGTH` — the bound on a
    // string this server SENDS, wrongly reused as the bound on a report it RECEIVES.
    // A probe's most important finding was rejected three times by it.
    const long = `the venture window closed while ${'x'.repeat(1500)} and nothing settled`;
    expect(long.length).toBeGreaterThan(1000);
    const res = await signed(live(), agent('rep-six'), 'POST', PATHS.discrepancy, { observed: long });

    expect(res.status).toBe(202);
    const stored = live().context.discrepancies[0]?.observed ?? '';
    expect(stored.length).toBeGreaterThan(1000);
    expect(stored).toContain('and nothing settled');
    // Not silently truncated at 480 with a "…", which would lose the tail of the
    // most serious report in the game while telling the reporter it was recorded.
    expect(stored).not.toContain('…');
  });

  it('states the cap in the response, because a cap found by rejection is undocumented', async () => {
    h = await harness();
    const ok = await signed(live(), agent('rep-seven'), 'POST', PATHS.discrepancy, { report: 'short' });
    expect(ok.json['max_field_length']).toBe(MAX_REPORT_LENGTH);

    const over = await signed(live(), agent('rep-eight'), 'POST', PATHS.discrepancy, {
      report: 'y'.repeat(MAX_REPORT_LENGTH + 1),
    });
    expect(over.status).toBe(400);
    // The refusal states the number and what to do, and asks for two reports rather
    // than losing one.
    expect(String(over.json['detail'])).toContain(String(MAX_REPORT_LENGTH));
    expect(String(over.json['detail'])).toContain('two than lose one');
  });

  it('keeps the buffer bounded even at full length, and drops the oldest', async () => {
    h = await harness();
    // Scar #3: the per-field cap went up 4×, so the ring has to be re-asserted at the
    // new size rather than assumed to have survived the change. One agent, many
    // reports — the flood is the point, not the number of identities.
    const flood = agent('flood-one');
    const padding = 'z'.repeat(MAX_REPORT_LENGTH - 40);
    for (let i = 0; i < MAX_DISCREPANCIES + 20; i += 1) {
      await signed(live(), flood, 'POST', PATHS.discrepancy, {
        report: `report-${String(i)} ${padding}`,
      });
    }
    const held = live().context.discrepancies;
    expect(held.length).toBe(MAX_DISCREPANCIES);
    // The ring dropped the oldest rather than refusing the newest: a report we cannot
    // hold is still better news than a report we would not accept.
    expect(held[0]?.observed).toContain('report-20 ');
    expect(held[held.length - 1]?.observed).toContain(`report-${String(MAX_DISCREPANCIES + 19)} `);
    for (const report of held) {
      expect(report.observed.length).toBeLessThanOrEqual(MAX_REPORT_LENGTH);
      expect(report.expected.length).toBeLessThanOrEqual(MAX_REPORT_LENGTH);
    }
    // ── AN EXPLICIT TIMEOUT, BECAUSE THE DEFAULT MADE THIS A FALSE ALARM ─────
    //
    // This body sends `MAX_DISCREPANCIES + 20` **signed** requests each carrying a
    // max-length report, so it pays Ed25519 verification and canonicalisation on every
    // one. Standalone that is ~1.6 s; inside a full parallel suite on a contended box it
    // crossed vitest's 5 s default and failed Gate 0, refusing a deploy whose engine was
    // fine. A flaky guard is worse than a slow one: it trains an operator to re-run the
    // gate until it passes, which is the habit that lets a real failure through.
    //
    // The work is genuinely bounded — the assertions above prove the ring holds exactly
    // MAX_DISCREPANCIES — so the honest fix is to pay for the wall-clock rather than to
    // shrink the flood, because the flood is the property under test (scar #3).
  }, 30_000);
});
