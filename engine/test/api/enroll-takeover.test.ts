/**
 * A5′ at the front door: can a stranger's `POST /enroll` become a named principal?
 *
 * ┌─ WHY THIS IS THE WORST BUG THIS PROJECT COULD SHIP ───────────────────────┐
 * │ A principal id is derived from the handle (`p:<handle>`). The house cast is │
 * │ seated in the *world* at boot and never touches the API's `SeatBook`. If     │
 * │ `/enroll` checked only its own tables, an attacker enrolling a cast handle   │
 * │ would bind its own Ed25519 key to that principal — and every deed recorded   │
 * │ afterwards, including a declined elective part, is a **permanent public      │
 * │ default against a character it does not own.** That is A5′ exactly: the      │
 * │ record made wrong about a real agent, which SPEC §15.4 calls worse than a    │
 * │ crash.                                                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The Gate-3 fix reordered this route to `callerOf → validate → meter → create`, and
 * the reorder moved the guard. So the guard is re-proved here rather than assumed to
 * have survived: refusal, **and no side effect on any of the three tables**, which is
 * the half a status-code assertion cannot see.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { CAST_NAMES } from '../../src/cast/index.js';
import { API_BASE_PATH } from '../../src/api/index.js';
import { agent, harness, publicKeyOf, raw, signed, type Harness } from './harness.js';

let h: Harness | null = null;

afterEach(async () => {
  if (h !== null) await h.close();
  h = null;
});

function live(): Harness {
  if (h === null) throw new Error('no harness');
  return h;
}

/** The first house-cast handle, read from the cast rather than written out here. */
const CAST_HANDLE = CAST_NAMES[0] ?? 'varrow';

describe('A5′ — /enroll cannot take over a principal that already exists in the world', () => {
  it('refuses a house-cast handle and leaves all three tables untouched', async () => {
    h = await harness();
    // Seated in the WORLD, exactly as boot does it — and deliberately not through the
    // SeatBook, because that asymmetry is the whole hazard.
    live().runtime.seat(`p:${CAST_HANDLE}` as never, CAST_HANDLE);
    const attacker = agent(CAST_HANDLE);

    const res = await raw(
      live(),
      'POST',
      `${API_BASE_PATH}/enroll`,
      JSON.stringify({ handle: CAST_HANDLE, publicKey: publicKeyOf(attacker) }),
      { 'content-type': 'application/json' },
    );

    expect(res.status).toBe(409);
    expect(res.json['reason']).toBe('HANDLE_TAKEN');

    // 1. No key bound. This is the one that turns a refusal into a takeover.
    expect(live().context.keyring.activeFor(`p:${CAST_HANDLE}` as never)).toBeNull();
    // 2. No seat flipped to occupied, so the seat is not silently spent either.
    expect(live().context.seats.isSeated(`p:${CAST_HANDLE}` as never)).toBe(false);
    // 3. And the attacker's key is unknown to the verifier, so it cannot sign as anyone.
    const attempt = await signed(live(), attacker, 'GET', `${API_BASE_PATH}/observe`);
    expect(attempt.status).toBe(401);
    expect(attempt.json['reason']).toBe('KEYID_UNKNOWN');
  });

  it('refuses every cast handle the same way, not just the first', async () => {
    h = await harness();
    for (const handle of CAST_NAMES.slice(0, 4)) {
      live().runtime.seat(`p:${handle}` as never, handle);
      const res = await raw(
        live(),
        'POST',
        `${API_BASE_PATH}/enroll`,
        JSON.stringify({ handle, publicKey: publicKeyOf(agent(handle)) }),
        { 'content-type': 'application/json' },
      );
      expect(res.status, `enrolling as ${handle}`).toBe(409);
      expect(live().context.keyring.activeFor(`p:${handle}` as never)).toBeNull();
    }
  });

  it('does not let a refused takeover be retried into existence by a rate-limit reorder', async () => {
    // The Gate-3 change made malformed enrolments free. A *well-formed* attempt on a
    // taken handle must stay metered, or the takeover attempt is also free to repeat —
    // and the 409 body distinguishes "already enrolled" from "in the world", which is
    // handle enumeration if it is unmetered.
    h = await harness({ limits: { enroll: { burst: 2, windowSeconds: 600 } } });
    live().runtime.seat(`p:${CAST_HANDLE}` as never, CAST_HANDLE);
    const body = JSON.stringify({ handle: CAST_HANDLE, publicKey: publicKeyOf(agent(CAST_HANDLE)) });
    const headers = { 'content-type': 'application/json' };

    expect((await raw(live(), 'POST', `${API_BASE_PATH}/enroll`, body, headers)).status).toBe(409);
    expect((await raw(live(), 'POST', `${API_BASE_PATH}/enroll`, body, headers)).status).toBe(409);
    const third = await raw(live(), 'POST', `${API_BASE_PATH}/enroll`, body, headers);
    expect(third.status).toBe(429);
    expect(third.json['reason']).toBe('RATE_LIMITED');
  });

  it('the handle agent.md documents is not a cast name, so the documented first request works', async () => {
    // Reported during verification as a doc gap ("the documented first request is
    // guaranteed to 409"). It is not: `vale` is not in CAST_NAMES. Pinned here so the
    // claim cannot be re-made, and so renaming the cast to include it fails loudly.
    expect(CAST_NAMES).not.toContain('vale');
    h = await harness();
    const res = await raw(
      live(),
      'POST',
      `${API_BASE_PATH}/enroll`,
      JSON.stringify({ handle: 'vale', publicKey: publicKeyOf(agent('vale')) }),
      { 'content-type': 'application/json' },
    );
    expect(res.status).toBe(201);
  });
});
