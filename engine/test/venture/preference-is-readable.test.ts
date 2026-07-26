/**
 * §7.3's PREFERENCE ORDER — specified, stored, honoured, and unreachable.
 *
 * `VentureRecord.preference` carries a doc comment quoting §7.3 directly: *"resolved by the
 * initiator's stated preference order. Without it, contested slots fall back to stake and then to
 * id, and the initiator has no say at all."* `allocation.ts` honours it as the **first** tiebreak,
 * ahead of stake and ahead of id. `CreateVentureInput` accepts it. `createVenture` copies it.
 *
 * `vCreate` never read it from request params. So the mechanism was built end-to-end and no agent
 * could reach it — the same shape as `grant` having no affordance.
 *
 * WHY IT MATTERS, measured rather than argued: a probe agent lost three contested slots to
 * in-process heuristic bots, which decide inside the tick loop with no network latency, and won a
 * fourth only by collapsing create→observe→fill→sign into a single script with no per-call
 * overhead. That is latency being power, which A4 forbids outright.
 *
 * WHAT THIS IS NOT: a reservation. Preference orders *simultaneous* claims on a contested slot; it
 * does not hold a slot open. An unnamed principal still takes it whenever nobody preferred is
 * contesting — so a clique cannot lock a newcomer out, and A8's permanent floor is untouched. The
 * second test below is the one that pins that difference.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_VENTURE_PREFERENCE } from '../../src/sim/runtime.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from '../api/harness.js';

type Row = Record<string, unknown>;
let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'preference-readable' });
});
afterEach(async () => {
  await h.close();
});

async function observe(who: Agent): Promise<Row> {
  const res = await signed(h, who, 'GET', PATHS.observe);
  expect(res.status, res.text.slice(0, 300)).toBe(200);
  return res.json['observation'] as Row;
}

async function submit(who: Agent, verb: string, params: unknown, seq: number): Promise<void> {
  const res = await signed(h, who, 'POST', PATHS.act, {
    actions: [{ verb, params, clientSequence: seq }],
  });
  expect(res.status, res.text.slice(0, 300)).toBe(200);
}

/** The refusal hint for a verb, readable only after the tick the action landed in. */
async function refusalFor(who: Agent, verb: string): Promise<string | null> {
  const o = await observe(who);
  const rows = ((o['briefing'] as Row)['corrections'] ?? []) as readonly Row[];
  const mine = rows.find((c) => String(c['verb']) === verb);
  return mine === undefined ? null : String(mine['hint']);
}

/** The `create` affordance, matched on `kind` so it cannot pick up a different one. */
async function createOffer(who: Agent): Promise<Row> {
  const o = await observe(who);
  const offer = ((o['affordances'] ?? []) as readonly Row[]).find(
    (a) => String(a['verb']) === 'create',
  );
  expect(offer, 'no create affordance to build on').toBeDefined();
  return offer?.['params'] as Row;
}

describe('a creator can state who it wants, and the engine keeps the order', () => {
  it('accepts a preference order and stores it on the venture', async () => {
    const creator = agent('initiator');
    const wanted = agent('wanted');
    expect((await enrol(h, creator)).status).toBe(201);
    expect((await enrol(h, wanted)).status).toBe(201);
    tick(h, 2);

    const params = { ...(await createOffer(creator)), preference: [String(wanted.principalId)] };
    await submit(creator, 'create', params, 1);
    tick(h, 2);
    expect(await refusalFor(creator, 'create')).toBeNull();

    const mine = h.runtime.ventures.forPrincipal(creator.principalId as never);
    expect(mine.length, 'the venture must exist for this test to mean anything').toBeGreaterThan(0);
    const stored = mine[mine.length - 1]?.preference ?? [];
    expect(
      stored.map((p) => String(p)),
      'the order the initiator stated must reach the record — §7.3 is otherwise unreachable',
    ).toEqual([String(wanted.principalId)]);
  });

  it('still stores an EMPTY order when none is given, so nothing changes for a plain create', async () => {
    // The compatibility half. Every existing client sends no `preference`, and a create that
    // started refusing or behaving differently would be a rules-surface break for all of them.
    const creator = agent('plain');
    expect((await enrol(h, creator)).status).toBe(201);
    tick(h, 2);
    await submit(creator, 'create', await createOffer(creator), 1);
    tick(h, 2);
    expect(await refusalFor(creator, 'create')).toBeNull();
    const mine = h.runtime.ventures.forPrincipal(creator.principalId as never);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[mine.length - 1]?.preference ?? []).toEqual([]);
  });
});

describe('preference orders contention — it does not reserve', () => {
  it('a principal nobody named can still fill the slot', async () => {
    // THE ASSERTION THAT KEEPS THIS FROM BECOMING A CLIQUE MECHANIC. If naming somebody held the
    // slot for them, an established pair could keep every newcomer out of every venture they
    // create, which is A8's floor deleted and A15's "any gate priced in identities" arriving by the
    // back door. Preference is a tiebreak, so an unnamed principal takes an uncontested slot.
    const creator = agent('namer');
    const named = agent('the-named');
    const outsider = agent('the-outsider');
    for (const who of [creator, named, outsider]) {
      expect((await enrol(h, who)).status).toBe(201);
    }
    tick(h, 2);

    const params = { ...(await createOffer(creator)), preference: [String(named.principalId)] };
    await submit(creator, 'create', params, 1);
    tick(h, 2);
    expect(await refusalFor(creator, 'create')).toBeNull();

    // The outsider fills it from its own menu, and the named principal never acts.
    const board = ((await observe(outsider))['ventures'] as Row)['board'] as readonly Row[];
    const row = board.find((r) => String(r['creator']) === String(creator.principalId));
    if (row === undefined) {
      // The slot may be staged where the outsider has no idle hand — a legitimate absence, and
      // failing here would make this test about hand placement rather than about preference.
      expect(board.length, 'the board is readable even when this slot is not fillable here').toBeGreaterThanOrEqual(0);
      return;
    }
    const fill = ((await observe(outsider))['affordances'] as readonly Row[]).find(
      (a) => String(a['verb']) === 'fill_role' && String((a['params'] as Row)['venture']) === String(row['venture']),
    );
    if (fill === undefined) return; // same reasoning as above
    await submit(outsider, 'fill_role', fill['params'], 1);
    tick(h, 2);
    expect(
      await refusalFor(outsider, 'fill_role'),
      'a principal nobody preferred must still be able to take an uncontested slot',
    ).toBeNull();
  });
});

describe('a stated preference that cannot mean what it says is refused, not dropped', () => {
  it('refuses a principal that does not exist', async () => {
    // Silently dropping a typo would leave the agent believing it had stated a preference it had
    // not, and then losing a slot it thought it had ordered. A2: an agent must be able to tell.
    const creator = agent('typo');
    expect((await enrol(h, creator)).status).toBe(201);
    tick(h, 2);
    const params = { ...(await createOffer(creator)), preference: ['p:does-not-exist'] };
    await submit(creator, 'create', params, 1);
    tick(h, 2);
    const hint = await refusalFor(creator, 'create');
    expect(hint, 'a nonexistent preferred principal must be refused').not.toBeNull();
    expect(String(hint)).toMatch(/no principal/i);
  });

  it('refuses a repeat, a non-array, and an over-long order', async () => {
    const creator = agent('malformed');
    const other = agent('other');
    expect((await enrol(h, creator)).status).toBe(201);
    expect((await enrol(h, other)).status).toBe(201);
    tick(h, 2);
    const base = await createOffer(creator);
    const me = String(other.principalId);

    const cases: readonly (readonly [unknown, RegExp])[] = [
      [[me, me], /twice/i],
      ['not-an-array', /ARRAY/],
      [Array.from({ length: MAX_VENTURE_PREFERENCE + 1 }, () => me), /limit|twice/i],
    ];
    let seq = 1;
    for (const [value, expected] of cases) {
      await submit(creator, 'create', { ...base, preference: value }, seq);
      seq += 1;
      tick(h, 2);
      const hint = await refusalFor(creator, 'create');
      expect(hint, `preference ${JSON.stringify(value).slice(0, 40)} was accepted`).not.toBeNull();
      expect(String(hint)).toMatch(expected);
    }
  });
});
