/**
 * **THE CORE LOOP, PLAYED FROM OUTSIDE, ON THE PUBLISHED WAKE BUDGET.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A play-tester ran four signed identities for two Reckonings and never once reached the decision
 * this game is about. Its report: *"`pt-corr` created 11 ventures, 9 of them had both roles filled by
 * real counterparties, and all 11 abandoned with `i_have_signed: false`. They didn't die for lack of
 * takers; they died because the one act that binds them was never on the menu."* It concluded that
 * `sign` and `elect` were missing from `affordances[]`.
 *
 * **Both verbs were on the menu, and had been for a long time.** `sign` is the FIRST row of the
 * observation after a `create`, carrying the venture id, the terms hash and the p50 echo ready to
 * send; `elect` follows one per role. `test/api/withheld-is-accountable.spec.ts` already asserted the
 * first of those non-vacuously. What no test asserted, and what turns out to decide the whole loop,
 * is **whether a lawful agent is ever awake to read them.**
 *
 * `WAKES_PER_RECKONING` is 16 over `TICKS_PER_RECKONING` 288, so an agent spending its allowance
 * evenly wakes once every 18 ticks, while `FORMATION_WINDOW_TICKS` is **12** — a venture created in
 * one wake is retired ABANDONED at +14, six ticks before its creator could legally look at the world
 * again. Measured over this very harness, with an agent that paces evenly and reads nothing:
 *
 *     created 16 · sign seen 0 · elect seen 0 · ABANDONED 16/16
 *
 * Not a low rate — **zero, deterministically**, because 18 > 13 is arithmetic and not a race. The
 * house cast decides about once per tick, so it filled every role and countersigned inside the window
 * every time. That is A4 exactly inverted: reaction speed was not an edge, it was the entry fee.
 *
 * ── WHAT THE FIX IS, AND WHY IT IS NOT A WIDER WINDOW ──────────────────────
 *
 * Widening `FORMATION_WINDOW_TICKS` past the wake gap was tried at 24 and at 18. Both work and both
 * were reverted: a formation window is also how long a filled hand is committed, and the full suite
 * priced it in the combat layer's free hands (see that constant's note for the two measurements).
 *
 * **`WAKES_PER_RECKONING` is a pool, not a rate.** `api/server.ts:spendWake` counts spends per
 * Reckoning and imposes no minimum spacing, so a creator may legally observe on two consecutive
 * ticks. The evenly-paced agent that measured `sign seen 0` was never *unable* to return inside its
 * window — it had never been told the window existed. `create` said what the escrow cost, what the
 * elective half was, how many roles it would mint and what band `elective_bps` sat in, and did not
 * mention that the thing it had just made would die unsigned. So the fix is that sentence, and the
 * agent this file drives is the one the sentence makes possible: **it reads the deadline off its own
 * affordance and comes back before it.**
 *
 * So the two halves asserted here are:
 *
 *   1. **the play-through** — a real signed identity, inside the published wake budget, gets from
 *      `create` to a moved standing without reading `agent.md` and without ever taking an act that
 *      was not on its own menu;
 *   2. **the sentence that makes it findable** — `create` names the countersignature and the exact
 *      tick, and the tick it names is the one the engine actually uses.
 *
 * Every assertion below is preceded by its non-vacuity check, because *"an invariant whose subject
 * cannot occur"* is this project's standing defect and it has already been filed against the
 * accountability sweep that was supposed to catch this one.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING, WAKES_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { FORMATION_WINDOW_TICKS, formationWindowOutlastsAWake } from '../../src/sim/runtime.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from './harness.js';

/** The gap between two wakes for an agent that spends its allowance evenly. */
const EVEN_WAKE_GAP = Math.ceil(TICKS_PER_RECKONING / WAKES_PER_RECKONING);

/** The value that shipped, and that made the core loop unreachable. Kept as the mutation. */
const THE_WINDOW_THAT_WAS_TOO_SHORT = 12;

let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'creator-binds' });
});
afterEach(async () => {
  await h.close();
});

interface Row {
  readonly verb: string;
  readonly params: Record<string, unknown>;
  readonly what_it_forecloses: string;
  readonly max_direct_loss: number;
}

async function observe(who: Agent): Promise<Record<string, unknown>> {
  const res = await signed(h, who, 'GET', PATHS.observe);
  expect(res.status, res.text.slice(0, 300)).toBe(200);
  return (res.json['observation'] ?? res.json) as Record<string, unknown>;
}

function affordances(o: Record<string, unknown>): Row[] {
  const list = o['affordances'];
  return Array.isArray(list) ? (list as Row[]) : [];
}

/**
 * Send one action and report whether the engine **accepted** it.
 *
 * Deliberately not `expect(status).toBe(200)` and nothing else: in this engine an illegal move is a
 * 200 carrying a correction, so a helper that stops at the status cannot tell a bound venture from a
 * refused one. `test/syndicate/form-through-the-front-door.spec.ts:act` is exactly that helper, and
 * building this file on it would have let every assertion below pass over a world where nothing
 * happened.
 */
async function act(who: Agent, verb: string, params: unknown): Promise<boolean> {
  const res = await signed(h, who, 'POST', PATHS.act, {
    actions: [{ verb, params, clientSequence: 1 }],
  });
  expect(res.status, res.text.slice(0, 400)).toBe(200);
  const outcome = res.json['outcome'] as Record<string, unknown> | undefined;
  const accepted = Array.isArray(outcome?.['accepted']) ? (outcome['accepted'] as unknown[]) : [];
  return accepted.length > 0;
}

describe('the wake arithmetic this surface has to compensate for', () => {
  it('★ an evenly-paced creator has NEGATIVE room in its own window, which is why the sentence exists', () => {
    // Non-vacuity first: the measurement must be reading real constants, not zeroes.
    expect(EVEN_WAKE_GAP, 'the even-pacing gap must be a real number of ticks').toBeGreaterThan(0);
    expect(FORMATION_WINDOW_TICKS, 'the window must be a real number of ticks').toBeGreaterThan(0);

    // This is a MEASUREMENT and not a gate — see `formationWindowOutlastsAWake`'s note. It is
    // negative as shipped, and that is the whole reason `create` has to name the deadline: an agent
    // that spreads its wakes evenly and reads nothing is locked out of the core loop by arithmetic
    // rather than by any rule. Pinned so the day it goes non-negative is a day somebody notices,
    // because on that day the clock carries the guarantee and the surface no longer has to.
    expect(
      formationWindowOutlastsAWake(THE_WINDOW_THAT_WAS_TOO_SHORT),
      'the shipped window really is shorter than the gap between two evenly-spaced wakes',
    ).toBeLessThan(0);
    expect(
      formationWindowOutlastsAWake(),
      'if this has gone non-negative the window now outlasts a wake on its own, and the play-through ' +
        'below no longer depends on the creator reading its deadline — re-read both notes before ' +
        'trusting either.',
    ).toBeLessThan(0);
  });
});

describe('a creator pacing its published wake budget can bind its own venture', () => {
  it('★ create → sign → LIVE → elect → settle → standing moves, all from the menu', async () => {
    const creator = agent('pt-corr');
    const sable = agent('p-sable');
    const vex = agent('p-vex');
    for (const a of [creator, sable, vex]) expect((await enrol(h, a)).status).toBe(201);
    tick(h, 1);

    // ── HOW THIS AGENT DECIDES WHEN TO WAKE, WHICH IS THE WHOLE POINT ──────
    //
    // Not a fixed cadence. It reads `window_closes_tick` off its own `ventures.mine[]` row — the
    // deadline `create` told it about in words — and books its next wake for that tick. When it has
    // nothing outstanding it falls back to the even gap. That is a strategy an agent can form from
    // the payload alone, it never exceeds `WAKES_PER_RECKONING`, and it is exactly what the old
    // surface made unformulable: with no deadline published, an even cadence is the only rational
    // default, and the even cadence is the one that misses.
    //
    // The fillers keep the even gap, staggered, so they are the ordinary players they were before.
    const offset = new Map<string, number>([
      [sable.handle, 6],
      [vex.handle, 12],
    ]);
    /** The tick the creator has booked its next wake for. Its first is the moment it can act at all. */
    let creatorNextWake = h.runtime.engine.tick;
    let wakesSpent = 0;
    /** A filler signs BLIND next tick off the board row's hash — the documented no-second-wake path. */
    const pending: { who: Agent; venture: string; hash: string; at: number }[] = [];

    let created = 0;
    let sawSign = 0;
    let signedFromMenu = 0;
    let sawElect = 0;
    let electedFromMenu = 0;
    let stage = '';

    for (let step = 0; step < TICKS_PER_RECKONING; step += 1) {
      const now = h.runtime.engine.tick;
      for (const p of pending.filter((x) => x.at === now)) {
        await act(p.who, 'sign', { venture: p.venture, terms_hash: p.hash });
      }
      for (const who of [creator, sable, vex]) {
        if (who === creator) {
          if (now !== creatorNextWake) continue;
          // Never more than the published allowance, and the assertion below proves it stayed under.
          if (wakesSpent >= WAKES_PER_RECKONING) continue;
          wakesSpent += 1;
        } else if (now % EVEN_WAKE_GAP !== offset.get(who.handle)) {
          continue;
        }
        const o = await observe(who);
        const rows = affordances(o);

        if (who === creator) {
          // ── THE SCHEDULE, DERIVED ONLY FROM WHAT THE SURFACE SAID ────────
          //
          // An unsigned FORMING venture publishes `window_closes_tick`, so the deadline is a field
          // once the venture exists. It does NOT exist yet in the wake that creates it — the action
          // resolves next tick — so for that one hop the agent is following the sentence `create`
          // now carries: *"`sign` will be the first row of your next observation."* Booking `now+1`
          // after a create is the literal reading of it, and it needs no prose parsing.
          //
          // ⚑ This is the sharp edge of the defect and it is worth naming: at the moment of the
          //    decision the deadline exists ONLY as prose in `what_it_forecloses`. A2 wants known
          //    arithmetic machine-readable, and `expires_tick` on a `create` row is already spoken
          //    for — it is the QUOTE pin (`tick + QUOTE_PIN_TICKS`), not the formation deadline.
          //    Overloading it would be HARD RULE 4. So the sentence carries it, and this is the
          //    strategy the sentence makes formulable.
          const mineRows = ((o['ventures'] as Record<string, unknown>)['mine'] ?? []) as Record<
            string,
            unknown
          >[];
          const deadlines = mineRows
            .filter((v) => v['state'] === 'FORMING' && v['i_have_signed'] === false)
            .map((v) => Number(v['window_closes_tick']))
            .filter((n) => Number.isFinite(n) && n > now);
          creatorNextWake = deadlines.length > 0 ? Math.min(...deadlines) : now + EVEN_WAKE_GAP;
        }

        if (who === creator) {
          if (rows.some((r) => r.verb === 'sign')) sawSign += 1;
          if (rows.some((r) => r.verb === 'elect')) sawElect += 1;
        }

        const sign = rows.find((r) => r.verb === 'sign');
        if (sign !== undefined && (await act(who, 'sign', sign.params)) && who === creator) {
          signedFromMenu += 1;
        }
        // Every role, not just the first: an unelected role is a real default and this test is
        // about the honoured path.
        for (const elect of rows.filter((r) => r.verb === 'elect')) {
          if ((await act(who, 'elect', elect.params)) && who === creator) electedFromMenu += 1;
        }

        if (who === creator) {
          if (sign === undefined) {
            const create = rows.find((r) => r.verb === 'create');
            if (create !== undefined) {
              stage = String(create.params['stage']);
              if (await act(who, 'create', create.params)) {
                created += 1;
                // The sentence the affordance now carries, acted on literally.
                creatorNextWake = now + 1;
              }
            }
          }
        } else {
          const hands = (o['hands'] ?? []) as Record<string, unknown>[];
          if (!hands.some((x) => x['location'] === stage && x['state'] === 'IDLE')) {
            const mv = rows.find((r) => r.verb === 'move' && r.params['to'] === stage);
            if (mv !== undefined) await act(who, 'move', mv.params);
          }
          const fill = rows.find((r) => r.verb === 'fill_role');
          if (fill !== undefined && (await act(who, 'fill_role', fill.params))) {
            const board = ((o['ventures'] as Record<string, unknown>)['board'] ?? []) as Record<
              string,
              unknown
            >[];
            const found = board.find((b) => b['venture'] === fill.params['venture']);
            const raw = found?.['terms_hash'];
            const hash = typeof raw === 'string' ? raw : '';
            if (hash !== '') {
              pending.push({ who, venture: String(fill.params['venture']), hash, at: now + 1 });
            }
          }
        }
      }
      tick(h, 1);
    }

    const mine = h.runtime.ventures.all().filter((v) => String(v.creator) === creator.principalId);

    // ── NON-VACUITY, IN THE ORDER THE CHAIN DEPENDS ON ─────────────────────
    // Each of these has been the thing that was actually zero at some point in this project's life,
    // so each is asserted before the claim that rests on it.
    expect(created, 'the creator must have opened at least one venture from its own menu').toBeGreaterThan(0);
    expect(
      wakesSpent,
      'this whole run must fit inside the PUBLISHED allowance — a play-through that needed a ' +
        '17th wake would be proving something no lawful agent can do',
    ).toBeLessThanOrEqual(WAKES_PER_RECKONING);
    expect(
      sawSign,
      'REGRESSION: `sign` never appeared in a wake-budgeted creator\'s affordances. This is the ' +
        'exact reading a play-tester got, and it means the formation window has fallen back below ' +
        'the wake gap.',
    ).toBeGreaterThan(0);
    expect(signedFromMenu, 'the creator must have countersigned by copying its own affordance').toBeGreaterThan(0);

    const bound = mine.filter((v) => v.countersigned.has(creator.principalId as PrincipalId));
    expect(bound.length, 'at least one venture must carry the creator\'s countersignature').toBeGreaterThan(0);

    // A role filled by a real counterparty, which is what makes the elective half a promise to
    // somebody rather than a transfer to yourself (scar #9).
    const staffed = mine.filter((v) =>
      v.roles.some((r) => r.filledByPrincipal !== null && String(r.filledByPrincipal) !== creator.principalId),
    );
    expect(
      staffed.length,
      'no venture was ever staffed by another principal, so the elective half was never owed to ' +
        'anyone and this test would prove nothing about `elect`',
    ).toBeGreaterThan(0);

    expect(sawElect, '`elect` must reach a creator that owes an elective half to somebody else').toBeGreaterThan(0);
    expect(electedFromMenu, 'and it must be takeable exactly as offered').toBeGreaterThan(0);

    // ── AND THE RECORD HAS TO MOVE, or none of the above bought anything ───
    const standing = h.runtime.standing.row(creator.principalId as PrincipalId);
    expect(
      standing.electiveHonoured,
      'the whole chain closed and standing did not move: an honoured elective is the only thing ' +
        'that mints the currency PARLEY, cover-writing and the ladder are all priced in, so a loop ' +
        'that settles without moving this is still closed to a player.',
    ).toBeGreaterThan(0);
    expect(standing.electiveHonouredValue).toBeGreaterThan(0);
    expect(standing.distinctCounterparties).toBeGreaterThan(0);
  });
});

describe('the surface tells a creator what create actually costs it', () => {
  it('★ `create` names the countersignature and the exact tick it is due', async () => {
    const creator = agent('pt-c');
    expect((await enrol(h, creator)).status).toBe(201);
    tick(h, 1);

    const o = await observe(creator);
    const create = affordances(o).find((r) => r.verb === 'create');
    expect(create, 'non-vacuity: `create` must be on the menu at all').toBeDefined();
    const text = create?.what_it_forecloses ?? '';

    // The act that creates the obligation to countersign has to mention that one exists. It did
    // not, and a play-tester lost eleven ventures to the omission before concluding the verb was
    // missing rather than the sentence.
    expect(text, 'create must name the act that binds it').toContain('sign');
    expect(text.toLowerCase(), 'and say the window can close on it').toContain('window closes');

    // Exact, not "soon" (A2). `create` resolves next tick and the window opens there.
    const closes = h.runtime.engine.tick + 1 + FORMATION_WINDOW_TICKS;
    expect(text, `the deadline must be the tick the engine will actually use (${String(closes)})`).toContain(
      String(closes),
    );

    // And the promise has to be true: take it, and `sign` is really there next tick.
    expect(await act(creator, 'create', create?.params)).toBe(true);
    tick(h, 1);
    const next = affordances(await observe(creator));
    expect(
      next.some((r) => r.verb === 'sign'),
      'create promised `sign` would be on the next observation; it must be',
    ).toBe(true);
    // The venture the engine actually minted must close its window when the sentence said it would.
    const minted = h.runtime.ventures.all().filter((v) => String(v.creator) === creator.principalId);
    expect(minted.length, 'non-vacuity: the create must have minted a venture').toBe(1);
    expect(minted[0]?.windowClosesTick, 'the published deadline must be the real one').toBe(closes);
  });
});
