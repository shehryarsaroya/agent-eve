/**
 * SEC-1, SEC-5, SEC-7 and SCAR-3 at the HTTP boundary.
 *
 * The identity module already proves RFC 9421 in isolation (`test/identity/`). What
 * is untested until here is the *boundary*: that the API passes the specific reason
 * through unchanged, that it reduces the request to the right `SignableRequest`, and
 * that it fails closed on the things that only exist over a socket.
 *
 * `agent.md` §2 makes a promise this file is the enforcement of:
 *
 * > "If a signature is rejected you get a **specific reason** — expired, wrong key,
 * > replayed nonce, missing component, digest mismatch. Never a generic failure. If
 * > you cannot tell why a signature failed, that is a bug worth reporting."
 *
 * A generic 401 would be a broken promise in the document a player learns the game
 * from, so each condition below asserts the *reason string*, not just the status.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import { CLIENT_IP_HEADER } from '../../src/api/index.js';
import { HeuristicCast } from '../../src/cast/index.js';
import {
  PATHS,
  agent,
  buildSigned,
  enrol,
  harness,
  nonce,
  publicKeyOf,
  raw,
  signed,
  tick,
  type Harness,
} from './harness.js';

let h: Harness;

afterEach(async () => {
  await h.close();
});

describe('SEC-1 — every signature refusal has its own reason', () => {
  beforeEach(async () => {
    h = await harness();
  });

  it('an unsigned request names the missing header, not "unauthorized"', async () => {
    const res = await raw(h, 'GET', PATHS.observe);
    expect(res.status).toBe(401);
    expect(res.json['reason']).toBe('SIGNATURE_INPUT_MISSING');
    expect(String(res.json['detail'])).toContain('RFC 9421');
  });

  it('a replayed nonce is distinguishable from every other refusal', async () => {
    const a = agent('vale');
    await enrol(h, a);
    const fixed = nonce('replay');
    const first = await signed(h, a, 'GET', PATHS.observe, undefined, { nonceValue: fixed });
    expect(first.status).toBe(200);
    const second = await signed(h, a, 'GET', PATHS.observe, undefined, { nonceValue: fixed });
    expect(second.status).toBe(401);
    expect(second.json['reason']).toBe('NONCE_REPLAYED');
  });

  it('a stale signature says it is too old, not that it is invalid', async () => {
    const a = agent('halcyon');
    await enrol(h, a);
    const res = await signed(h, a, 'GET', PATHS.observe, undefined, { createdOffsetSeconds: -600 });
    expect(res.status).toBe(401);
    expect(res.json['reason']).toBe('CREATED_TOO_OLD');
  });

  it('clock skew ahead of the server is its own reason', async () => {
    const a = agent('vex');
    await enrol(h, a);
    const res = await signed(h, a, 'GET', PATHS.observe, undefined, { createdOffsetSeconds: 600 });
    expect(res.status).toBe(401);
    expect(res.json['reason']).toBe('CREATED_IN_FUTURE');
  });

  it('an unknown key says to enroll first', async () => {
    const stranger = agent('nobody');
    const res = await signed(h, stranger, 'GET', PATHS.observe);
    expect(res.status).toBe(401);
    expect(res.json['reason']).toBe('KEYID_UNKNOWN');
    expect(String(res.json['detail'])).toContain('enroll');
  });

  it('a wrong key — a real keyid, somebody else\'s signature — is SIGNATURE_INVALID', async () => {
    const a = agent('brannock');
    const b = agent('sable');
    await enrol(h, a);
    await enrol(h, b);
    // Signed by B, claiming A's keyid. Exactly one header byte-range changes, so the
    // refusal is provably about the key rather than about anything else.
    const built = buildSigned(h, b, 'GET', PATHS.observe);
    const tampered = {
      ...built.headers,
      'signature-input': String(built.headers['signature-input']).replace(
        b.keypair.keyid,
        a.keypair.keyid,
      ),
    };
    const forged = await raw(h, 'GET', PATHS.observe, undefined, tampered);
    expect(forged.status).toBe(401);
    expect(forged.json['reason']).toBe('SIGNATURE_INVALID');
  });

  it('a missing Signature header, with Signature-Input present, is its own reason', async () => {
    const a = agent('orrin');
    await enrol(h, a);
    const res = await signed(h, a, 'GET', PATHS.observe, undefined, { drop: ['signature'] });
    expect(res.status).toBe(401);
    expect(res.json['reason']).toBe('SIGNATURE_MISSING');
  });

  it('a malformed Signature-Input is malformed, not invalid', async () => {
    const a = agent('thessaly');
    await enrol(h, a);
    const res = await signed(h, a, 'GET', PATHS.observe, undefined, {
      headerOverrides: { 'signature-input': 'this is not a structured field dictionary(((' },
    });
    expect(res.status).toBe(401);
    expect(res.json['reason']).toBe('SIGNATURE_INPUT_MALFORMED');
  });

  it('a digest that does not match the body is CONTENT_DIGEST_MISMATCH', async () => {
    const a = agent('kestrel');
    await enrol(h, a);
    const res = await signed(h, a, 'POST', PATHS.act, { actions: [{ verb: 'claim', params: { text: 'hi' } }] }, {
      headerOverrides: { 'content-digest': 'sha-256=:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=:' },
    });
    expect(res.status).toBe(401);
    expect(res.json['reason']).toBe('CONTENT_DIGEST_MISMATCH');
  });

  it('a body with no digest at all is CONTENT_DIGEST_MISSING', async () => {
    const a = agent('dunmore');
    await enrol(h, a);
    const res = await signed(h, a, 'POST', PATHS.act, { actions: [] }, { drop: ['content-digest'] });
    expect(res.status).toBe(401);
    // Either the digest is gone (MISSING) or the covered list still names it and the
    // message no longer has it (ABSENT). Both are specific and both are correct; what
    // must never happen is a generic failure.
    expect(['CONTENT_DIGEST_MISSING', 'COVERED_COMPONENT_ABSENT']).toContain(res.json['reason']);
  });

  it('every refusal reason in this suite is a different string', async () => {
    // The property the individual tests only imply. If two conditions collapsed onto
    // one reason, an agent could not fix its client, and the operator would see a
    // healthy server rejecting a healthy agent forever.
    const a = agent('ferren');
    await enrol(h, a);
    const reasons = new Set<string>();
    const fixed = nonce('collide');
    await signed(h, a, 'GET', PATHS.observe, undefined, { nonceValue: fixed });
    for (const res of [
      await raw(h, 'GET', PATHS.observe),
      await signed(h, a, 'GET', PATHS.observe, undefined, { nonceValue: fixed }),
      await signed(h, a, 'GET', PATHS.observe, undefined, { createdOffsetSeconds: -600 }),
      await signed(h, a, 'GET', PATHS.observe, undefined, { createdOffsetSeconds: 600 }),
      await signed(h, agent('ghost'), 'GET', PATHS.observe),
      await signed(h, a, 'GET', PATHS.observe, undefined, { drop: ['signature'] }),
    ]) {
      expect(res.status).toBe(401);
      reasons.add(String(res.json['reason']));
    }
    expect(reasons.size).toBe(6);
  });
});

describe('SEC-5 — rate limiting by the real client IP behind Cloudflare', () => {
  it('with the edge trusted, a request without CF-Connecting-IP is refused', async () => {
    // Getting this wrong means either no limiting at all or limiting the whole world
    // as one client, and both fail silently in opposite directions. So it fails loud.
    h = await harness({ trustEdge: true });
    const res = await raw(h, 'GET', PATHS.health);
    expect(res.status).toBe(400);
    expect(res.json['reason']).toBe('CLIENT_IP_UNVERIFIED');
    expect(String(res.json['detail'])).toContain(CLIENT_IP_HEADER);
  });

  it('with the edge trusted, the header is what buckets the caller', async () => {
    h = await harness({
      trustEdge: true,
      limits: { health: { burst: 2, windowSeconds: 60 } },
    });
    const first = await raw(h, 'GET', PATHS.health, undefined, { [CLIENT_IP_HEADER]: '203.0.113.7' });
    const second = await raw(h, 'GET', PATHS.health, undefined, { [CLIENT_IP_HEADER]: '203.0.113.7' });
    const third = await raw(h, 'GET', PATHS.health, undefined, { [CLIENT_IP_HEADER]: '203.0.113.7' });
    expect(first.status).not.toBe(429);
    expect(second.status).not.toBe(429);
    expect(third.status).toBe(429);
    expect(third.json['reason']).toBe('RATE_LIMITED');

    // A different edge client is a different bucket. If the socket address were used
    // instead, this would be 429 too — every caller behind the edge shares one socket.
    const other = await raw(h, 'GET', PATHS.health, undefined, { [CLIENT_IP_HEADER]: '198.51.100.2' });
    expect(other.status).not.toBe(429);
  });

  it('X-Forwarded-For is never read, because a client can write it', async () => {
    h = await harness({
      trustEdge: true,
      limits: { health: { burst: 1, windowSeconds: 60 } },
    });
    await raw(h, 'GET', PATHS.health, undefined, { [CLIENT_IP_HEADER]: '203.0.113.7' });
    // Same real client, a different forged XFF. If XFF were the key this would be a
    // free bucket and the limiter would be bypassable by anybody.
    const bypass = await raw(h, 'GET', PATHS.health, undefined, {
      [CLIENT_IP_HEADER]: '203.0.113.7',
      'x-forwarded-for': '10.0.0.1',
    });
    expect(bypass.status).toBe(429);
  });

  it('a malformed CF-Connecting-IP is refused rather than used as a bucket key', async () => {
    // An unvalidated header value is an unbounded key space, which turns the limiter's
    // own map into scar #3.
    h = await harness({ trustEdge: true });
    const res = await raw(h, 'GET', PATHS.health, undefined, {
      [CLIENT_IP_HEADER]: 'not-an-ip-at-all',
    });
    expect(res.status).toBe(400);
    expect(res.json['reason']).toBe('CLIENT_IP_UNVERIFIED');
  });

  it('the retry hint is a real number of seconds, and Retry-After is set', async () => {
    h = await harness({ trustEdge: true, limits: { health: { burst: 1, windowSeconds: 30 } } });
    await raw(h, 'GET', PATHS.health, undefined, { [CLIENT_IP_HEADER]: '203.0.113.9' });
    const res = await fetch(`${h.origin}${PATHS.health}`, {
      headers: { [CLIENT_IP_HEADER]: '203.0.113.9' },
    });
    expect(res.status).toBe(429);
    const retry = Number(res.headers.get('retry-after'));
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(30);
    await res.text();
  });

  it('the limiter is wall-clock and therefore does not compress with the tick', async () => {
    // TESTING.md §1.1 hazard 1, from the other side. The window is in real seconds,
    // so advancing the *clock* rolls it and advancing the *world* does not.
    h = await harness({ trustEdge: true, limits: { health: { burst: 1, windowSeconds: 10 } } });
    const ip = { [CLIENT_IP_HEADER]: '203.0.113.11' };
    expect((await raw(h, 'GET', PATHS.health, undefined, ip)).status).not.toBe(429);
    expect((await raw(h, 'GET', PATHS.health, undefined, ip)).status).toBe(429);
    tick(h, 50);
    expect((await raw(h, 'GET', PATHS.health, undefined, ip)).status).toBe(429);
    h.clock.advance(11_000);
    expect((await raw(h, 'GET', PATHS.health, undefined, ip)).status).not.toBe(429);
  });
});

describe('SEC-7 and SCAR-3 — enrolment is bounded, and the 503 is helpful', () => {
  it('fills to the seat cap and then refuses with a 503 that says what would change', async () => {
    h = await harness({ seats: 3 });
    for (let i = 0; i < 3; i += 1) {
      const res = await enrol(h, agent(`seated-${String(i)}`));
      expect(res.status).toBe(201);
    }
    const overflow = await enrol(h, agent('latecomer'));
    expect(overflow.status).toBe(503);
    expect(overflow.json['reason']).toBe('SEATS_FULL');
    const detail = String(overflow.json['detail']);
    expect(detail).toContain('3 of 3 seats');
    // Helpful means: what would have to change, and the reassurance that the cap is
    // on capacity rather than on who may play (A15 — enrolment is free and stays free).
    expect(detail).toMatch(/recycl/i);
    expect(detail).toContain('Enrolment is free and stays free');
  });

  it('a thousand enrolments leave a bounded number of rows, not a ghost each', async () => {
    // The scar itself: High Water's rows accumulated forever and the whole map was
    // re-serialised every 1.5 s, so "remember this agent" became an OOM and a disk DoS.
    h = await harness({ seats: 8 });
    let created = 0;
    let refused = 0;
    for (let i = 0; i < 1_000; i += 1) {
      const res = await enrol(h, agent(`flood-${String(i)}`));
      if (res.status === 201) created += 1;
      else if (res.status === 503) refused += 1;
    }
    expect(created).toBe(8);
    expect(refused).toBe(992);
    // Rows are bounded by the cap, because a refused enrolment writes nothing at all.
    expect(h.context.seats.rows).toBe(8);
    expect(h.context.keyring.size).toBe(8);
    expect(h.runtime.world.principalOrder.length).toBe(8);
  });

  it('recycles an idle seat rather than accumulating one, and keeps the identity', async () => {
    h = await harness({ seats: 1 });
    const first = agent('dormant');
    expect((await enrol(h, first)).status).toBe(201);
    const holdingBefore = h.runtime.world.holdingByPrincipal.get(first.principalId as never);
    expect(holdingBefore).toBeDefined();

    // Not yet idle: the world is full and the newcomer is told so.
    expect((await enrol(h, agent('waiting'))).status).toBe(503);

    // Silence for longer than the threshold. The seat frees; nothing else does.
    tick(h, TICKS_PER_RECKONING * 4 + 1);
    const second = agent('newcomer');
    expect((await enrol(h, second)).status).toBe(201);

    // R19, mechanically: identity, holding and hands all survive the recycling.
    expect(h.runtime.world.holdingByPrincipal.get(first.principalId as never)).toBe(holdingBefore);
    expect(h.runtime.world.handsByPrincipal.get(first.principalId as never)?.length).toBe(3);
    expect(h.context.seats.seatOf(first.principalId as never)?.occupied).toBe(false);
    expect(h.context.seats.recyclesTotal).toBe(1);
    // And the row is still there: a recycled seat is dormant, never deleted (A10).
    expect(h.context.seats.rows).toBe(2);
  });

  it('a handle is never reissued to a second principal', async () => {
    h = await harness();
    const a = agent('vale');
    expect((await enrol(h, a)).status).toBe(201);
    // Same handle, a different keypair: whoever asks second is impersonating.
    const impostor = agent('vale');
    const res = await raw(
      h,
      'POST',
      PATHS.enroll,
      JSON.stringify({ handle: 'vale', publicKey: publicKeyOf(impostor) }),
      { 'content-type': 'application/json' },
    );
    expect(res.status).toBe(409);
    expect(['HANDLE_TAKEN', 'ALREADY_ENROLLED']).toContain(res.json['reason']);
  });

  it('enrolment is rate-limited by IP, independently of the seat cap', async () => {
    // Two bounds, on purpose: the seat cap bounds the world's size and the rate limit
    // bounds the work an attacker can make us do reaching it.
    h = await harness({ seats: 100, limits: { enroll: { burst: 2, windowSeconds: 600 } } });
    expect((await enrol(h, agent('one'))).status).toBe(201);
    expect((await enrol(h, agent('two'))).status).toBe(201);
    const third = await enrol(h, agent('three'));
    expect(third.status).toBe(429);
    expect(h.context.seats.rows).toBe(2);
  });

  it('a bad public key is refused before a seat is spent', async () => {
    h = await harness({ seats: 2 });
    const res = await raw(h, 'POST', PATHS.enroll, JSON.stringify({ handle: 'sloppy', publicKey: 'nope' }), {
      'content-type': 'application/json',
    });
    expect(res.status).toBe(400);
    expect(h.context.seats.rows).toBe(0);
  });
});

/**
 * A5′ — `POST /enroll` must never bind a key to a principal it did not create.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE DEFECT THIS FILE NOW PINS.** A principal id is derived from the handle
 * (`p:<handle>`), and the house cast is seated at boot through `Runtime.seat()`, which
 * mints a holding, hands and a stake in the **world** and never touches `SeatBook`.
 * So for a cast principal the enrol handler used to see: no seat row (claim succeeds),
 * no key (register succeeds), and only then a world that already knew the principal —
 * at which point `Runtime.seat` threw and the request 500'd with the first two steps
 * already committed.
 *
 * The caller's own Ed25519 key was left bound to `p:vale`. Every signed request
 * afterwards *was* that principal: its observation readable, its actions submitted in
 * its name, and its deeds — including a declined elective part, which is a permanent
 * public default — recorded against a character it did not own. **A5′: the record made
 * wrong about a real agent, which the design calls worse than a crash.**
 *
 * `agent.md` §2's worked example is `{ "handle": "vale" }` and `CAST_NAMES[0]` is
 * `vale`, so this was the documented first request a new agent would send.
 *
 * The assertions below are ordered by what matters: no key bound, then no seat spent,
 * then a refusal an agent can act on, then — the one that would have caught it — the
 * caller cannot read or act as the principal afterwards.
 * ══════════════════════════════════════════════════════════════════════════
 */
describe('A5-prime — enrolment cannot take over a principal the world already has', () => {
  it('refuses a house-cast handle without binding a key, spending a seat, or 500ing', async () => {
    h = await harness({ seed: 'cast-takeover', seats: 64 });
    const cast = new HeuristicCast(h.runtime, { size: 20 });
    const roster = cast.seat('cast-takeover');
    const victim = roster[0];
    expect(victim, 'the cast seated nobody, so this test would prove nothing').toBeDefined();
    if (victim === undefined) return;
    // The precondition that made it exploitable: in the world, absent from the SeatBook,
    // and holding no key of its own.
    expect(h.runtime.world.holdingByPrincipal.has(victim.principal)).toBe(true);
    expect(h.context.seats.seatOf(victim.principal)).toBeUndefined();
    expect(h.context.keyring.activeFor(victim.principal)).toBeNull();

    const attacker = agent(victim.handle);
    const res = await enrol(h, attacker);

    // A named refusal, not the 500 that hid this.
    expect(res.status).toBe(409);
    expect(res.json['reason']).toBe('HANDLE_TAKEN');
    expect(String(res.json['detail'])).toContain('never');

    // Nothing was committed on the way to refusing.
    expect(h.context.keyring.activeFor(victim.principal)).toBeNull();
    expect(h.context.seats.seatOf(victim.principal)).toBeUndefined();
    expect(h.context.seats.rows).toBe(0);

    // And the consequence that actually mattered: the caller is not that principal.
    tick(h, 1);
    const read = await signed(h, attacker, 'GET', PATHS.observe);
    expect(read.status).toBe(401);
    expect(read.json['reason']).toBe('KEYID_UNKNOWN');
    const acted = await signed(h, attacker, 'POST', PATHS.act, {
      actions: [{ verb: 'claim', params: { text: 'not mine to say' }, clientSequence: 1 }],
    });
    expect(acted.status).toBe(401);
    tick(h, 2);
    expect(h.runtime.publicClaims().some((c) => c.by === victim.principal)).toBe(false);
  });

  it('every cast handle is refused, and a real newcomer still gets a seat', async () => {
    // The cheaper half of the same defect: twenty 500s used to leave twenty seats
    // occupied by principals the world never gained, so a genuine newcomer was told
    // SEATS_FULL by a world that was empty.
    h = await harness({ seed: 'cast-burn', seats: 8 });
    const cast = new HeuristicCast(h.runtime, { size: 20 });
    for (const member of cast.seat('cast-burn').slice(0, 8)) {
      const res = await enrol(h, agent(member.handle));
      expect(res.status, `${member.handle} answered ${String(res.status)}`).toBe(409);
    }
    expect(h.context.seats.occupied).toBe(0);
    const newcomer = await enrol(h, agent('newcomer'));
    expect(newcomer.status).toBe(201);
  });

  it('a second enrolment of a live principal is a named 409, and the first key still works', async () => {
    h = await harness({ seed: 're-enrol' });
    const first = agent('twice');
    expect((await enrol(h, first)).status).toBe(201);
    // A different keypair on the same handle: identity is never re-minted (A10), and it
    // must not be rotatable by anyone who can spell the handle.
    const impostor = agent('twice');
    const res = await enrol(h, impostor);
    expect(res.status).toBe(409);
    expect(res.json['reason']).toBe('ALREADY_ENROLLED');
    // The rightful owner is unaffected; the impostor is nobody.
    impostor.principalId = first.principalId;
    expect((await signed(h, first, 'GET', PATHS.observe)).status).toBe(200);
    expect((await signed(h, impostor, 'GET', PATHS.observe)).status).toBe(401);
  });
});
