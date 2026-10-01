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
 *
 * ── ★ `RULES_VERSION` 41: THE SENTENCE WAS NOT THE END OF IT ────────────────
 *
 * The sentence made the loop *findable*; it did not make it *forgiving*. An agent that paced evenly
 * and did not book a second wake still lost every venture, and a blind playtester and a design review
 * both read the deadline as busywork — a clock, not a decision. So the owner took the third option:
 * **the creator's own `create` is its countersignature** (`venture/create.ts:boundAtFormation`), and
 * `formationWindowOutlastsAWake()` reads +12. The play-through below is now the harder version — a
 * creator that wakes ONLY on the even gap and never books a deadline — and it still gets from
 * `create` to a moved standing without ever being offered, or sending, a `sign`.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING, WAKES_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import {
  CREATOR_WAKES_INSIDE_FORMATION_WINDOW,
  FORMATION_WINDOW_TICKS,
  formationWindowOutlastsAWake,
} from '../../src/sim/runtime.js';
import { CREATE_IS_COUNTERSIGNATURE } from '../../src/venture/index.js';
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

describe('the wake arithmetic the creator no longer has to compensate for', () => {
  it('★ an evenly-paced creator has the WHOLE window, because its create is its countersignature', () => {
    // Non-vacuity first: the measurement must be reading real constants, not zeroes.
    expect(EVEN_WAKE_GAP, 'the even-pacing gap must be a real number of ticks').toBeGreaterThan(0);
    expect(FORMATION_WINDOW_TICKS, 'the window must be a real number of ticks').toBeGreaterThan(0);

    // The history, kept as the mutation: while the creator had to come back inside the window to
    // `sign`, a 12-tick window against an 18-tick even gap was −6, and an agent that paced evenly and
    // read nothing was locked out of the core loop by arithmetic rather than by any rule.
    expect(
      formationWindowOutlastsAWake(THE_WINDOW_THAT_WAS_TOO_SHORT, 1),
      'one wake owed inside a 12-tick window really was shorter than the gap between two even wakes',
    ).toBeLessThan(0);

    // ★ Now. No wake is owed inside the window, so the room is the whole window. Pinned so the day a
    // rule sends the creator back inside its window is a day somebody notices: that day this goes
    // negative again and the play-through below has to start booking wakes.
    expect(CREATOR_WAKES_INSIDE_FORMATION_WINDOW, 'the creator owes no wake inside its own window').toBe(0);
    expect(
      formationWindowOutlastsAWake(),
      'if this has gone negative a rule has sent the creator back inside its window — re-read ' +
        '`venture/create.ts:boundAtFormation` before trusting the play-through below.',
    ).toBeGreaterThanOrEqual(0);
    expect(formationWindowOutlastsAWake()).toBe(FORMATION_WINDOW_TICKS);
  });
});

describe('a creator pacing its published wake budget evenly can bind its own venture', () => {
  it('★ create → LIVE → elect → settle → standing moves, on the even gap, with no sign ever owed', async () => {
    const creator = agent('pt-corr');
    const sable = agent('p-sable');
    const vex = agent('p-vex');
    for (const a of [creator, sable, vex]) expect((await enrol(h, a)).status).toBe(201);
    tick(h, 1);

    // ── EVERYONE PACES EVENLY, AND NOBODY BOOKS A DEADLINE ─────────────────
    //
    // This is the agent the old rule locked out: it wakes every EVEN_WAKE_GAP ticks, never earlier,
    // and reads nothing about deadlines. The fillers keep the even gap too, staggered, and sign blind
    // the next tick off the board row's hash — the documented no-second-wake path.
    //
    // Their offsets are the one thing chosen here, and the reason is the FILLERS' arithmetic, not the
    // creator's: a filler's `fill_role` and its blind `sign` each resolve one tick after they are
    // sent, so both land inside a window that opens at +1 and closes at +13 only if the filler wakes
    // at +11 or earlier. 5 and 9 are two ordinary wakes inside that; the creator's schedule is the
    // bare even gap and nothing else.
    const offset = new Map<string, number>([
      [creator.handle, 0],
      [sable.handle, 5],
      [vex.handle, 9],
    ]);
    let creatorWakes = 0;
    const pending: { who: Agent; venture: string; hash: string; at: number }[] = [];

    let created = 0;
    let sawSign = 0;
    let sawElect = 0;
    let electedFromMenu = 0;
    let stage = '';

    for (let step = 0; step < TICKS_PER_RECKONING; step += 1) {
      const now = h.runtime.engine.tick;
      for (const p of pending.filter((x) => x.at === now)) {
        await act(p.who, 'sign', { venture: p.venture, terms_hash: p.hash });
      }
      for (const who of [creator, sable, vex]) {
        if (now % EVEN_WAKE_GAP !== offset.get(who.handle)) continue;
        if (who === creator) creatorWakes += 1;
        const o = await observe(who);
        const rows = affordances(o);

        if (who === creator) {
          if (rows.some((r) => r.verb === 'sign')) sawSign += 1;
          if (rows.some((r) => r.verb === 'elect')) sawElect += 1;
          // Every role, not just the first: an unelected role is a real default and this test is
          // about the honoured path.
          for (const elect of rows.filter((r) => r.verb === 'elect')) {
            if (await act(who, 'elect', elect.params)) electedFromMenu += 1;
          }
          const create = rows.find((r) => r.verb === 'create');
          if (create !== undefined) {
            stage = String(create.params['stage']);
            if (await act(who, 'create', create.params)) created += 1;
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
    expect(created, 'the creator must have opened at least one venture from its own menu').toBeGreaterThan(0);
    expect(
      creatorWakes,
      'this whole run must fit inside the PUBLISHED allowance, spent evenly',
    ).toBeLessThanOrEqual(WAKES_PER_RECKONING);
    expect(
      sawSign,
      'REGRESSION: a creator was offered `sign` on its own venture — its create is its countersignature',
    ).toBe(0);

    const bound = mine.filter((v) => v.countersigned.has(creator.principalId as PrincipalId));
    expect(bound.length, 'every venture must carry the creator’s countersignature from its create').toBe(
      mine.length,
    );
    const wentLive = mine.filter((v) => v.state !== 'FORMING' && v.state !== 'ABANDONED');
    expect(
      wentLive.length,
      'at least one venture must have bound and gone past FORMING with the creator never signing',
    ).toBeGreaterThan(0);

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
  }, 300_000);
});

describe('the surface tells a creator what create actually costs it', () => {
  it('★ `create` says it IS the countersignature, and names the tick the window closes', async () => {
    const creator = agent('pt-c');
    expect((await enrol(h, creator)).status).toBe(201);
    tick(h, 1);

    const o = await observe(creator);
    const create = affordances(o).find((r) => r.verb === 'create');
    expect(create, 'non-vacuity: `create` must be on the menu at all').toBeDefined();
    const text = create?.what_it_forecloses ?? '';

    // The engine's own sentence, verbatim — the same constant `agent.md` is held to.
    expect(text, 'create must carry the countersignature rule').toContain(CREATE_IS_COUNTERSIGNATURE);
    expect(text.toLowerCase(), 'and say when the window closes on the fillers').toContain('window closes');

    // Exact, not "soon" (A2). `create` resolves next tick and the window opens there.
    const closes = h.runtime.engine.tick + 1 + FORMATION_WINDOW_TICKS;
    expect(text, `the deadline must be the tick the engine will actually use (${String(closes)})`).toContain(
      String(closes),
    );

    // And the promise has to be true: take it, and NO `sign` is waiting next tick.
    expect(await act(creator, 'create', create?.params)).toBe(true);
    tick(h, 1);
    const next = affordances(await observe(creator));
    expect(
      next.some((r) => r.verb === 'sign'),
      'create said it was the countersignature; a `sign` on the next observation would contradict it',
    ).toBe(false);
    // The venture the engine actually minted must carry the creator already, and close its window
    // when the sentence said it would.
    const minted = h.runtime.ventures.all().filter((v) => String(v.creator) === creator.principalId);
    expect(minted.length, 'non-vacuity: the create must have minted a venture').toBe(1);
    expect(minted[0]?.countersigned.has(creator.principalId as PrincipalId)).toBe(true);
    expect(minted[0]?.windowClosesTick, 'the published deadline must be the real one').toBe(closes);
  });
});
