/**
 * **Can a deal actually be closed?** — the Gate 3 precondition, verified end to end.
 *
 * Written by an adversarial pass over the Gate 3 observe fixes, deliberately NOT reusing
 * the fixture shortcuts the fixes were developed against. Three things are different here
 * on purpose:
 *
 *   - **No teleport.** The fillers stand where the world seated them and have to `move`,
 *     because home systems differ per principal and `vFillRole` requires the hand to
 *     occupy the venture's stage. Whether an agent can play at all must not depend on
 *     where it woke up.
 *   - **The wake is counted, not assumed.** `wakesSpent` is asserted to go 0 -> 1 across
 *     the read. `expect(after).toBe(before)` alone passes vacuously if wake accounting is
 *     broken and every read is free, so the cost is pinned at both ends.
 *   - **Refusals are drained.** `POST /act` answers only with what was knowable when the
 *     response was written; a `sign` refused at VALIDATE+LOCK arrives on the *next* read.
 *     A test reading only `outcome.corrections` is testing less than it looks like.
 *
 * Mutations that turn these red: board row `terms_hash` -> null (A, B, C), the `move`
 * affordance dropping the lane's duration (A), `your_take_at_p50` reverting to
 * `yourTakeAtP50(venture, reader)` (A, B, C), and `boardDropped` leaving `withheld.count`
 * (F).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handsOf } from '../../src/world/index.js';
import { FORMATION_WINDOW_TICKS } from '../../src/sim/runtime.js';
import { storesAccount } from '../../src/ledger/index.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from './harness.js';

let h: Harness;
beforeEach(async () => {
  h = await harness({ seed: 'verify-observe' });
});
afterEach(async () => {
  await h.close();
});

type Row = Record<string, unknown>;
const obs = (b: Record<string, unknown>): Row => b['observation'] as Row;
const aff = (o: Row): Row[] => o['affordances'] as Row[];
const board = (o: Row): Row[] => (o['ventures'] as Row)['board'] as Row[];

async function act(who: Agent, name: string, params: unknown): Promise<Row> {
  const res = await signed(h, who, 'POST', PATHS.act, {
    actions: [{ verb: name, params, clientSequence: 1 }],
  });
  expect(res.status, `${name}: ${res.text.slice(0, 400)}`).toBe(200);
  const outcome = res.json['outcome'] as Row;
  expect(outcome['corrections'], `${name} corrected at boundary`).toEqual([]);
  return outcome;
}

function noPending(who: Agent, what: string): void {
  const pending = h.runtime.takeCorrections(who.principalId as never);
  expect(pending.map((c) => `${c.verb}/${c.invariant}: ${c.hint}`), what).toEqual([]);
}

/** Stage a signed, fully-open DIG. Returns the creator and the record. */
async function stage(): Promise<{ readonly creator: Agent; readonly id: string; readonly stage: string }> {
  const creator = agent('vc');
  await enrol(h, creator);
  tick(h, 1);
  const c1 = obs((await signed(h, creator, 'GET', PATHS.observe)).json);
  await act(creator, 'create', aff(c1).find((a) => a['verb'] === 'create')?.['params']);
  tick(h, 1);
  noPending(creator, 'create must resolve');
  const c2 = obs((await signed(h, creator, 'GET', PATHS.observe)).json);
  await act(creator, 'sign', aff(c2).find((a) => a['verb'] === 'sign')?.['params']);
  tick(h, 1);
  noPending(creator, "the creator's own sign must resolve");
  const v = h.runtime.ventures.all()[0];
  return { creator, id: String(v?.id), stage: String(v?.stage) };
}

function bring(who: Agent, system: string): void {
  for (const hand of handsOf(h.runtime.world, who.principalId as never)) {
    hand.location = system as never;
    hand.destination = null;
    hand.state = 'IDLE';
    hand.presentSinceTick = h.runtime.engine.tick;
  }
}

function defaultsOf(who: Agent): number {
  return h.runtime.standing.row(who.principalId as never).defaults;
}

describe('one observation, one wake, real geography', () => {
  it('a filler that must travel closes the deal inside the window on ONE wake', async () => {
    const { id, stage: at } = await stage();
    const v = h.runtime.ventures.get(id as never);
    const opens = Number(v?.windowOpensTick);
    const closes = Number(v?.windowClosesTick);
    expect(closes - opens).toBe(FORMATION_WINDOW_TICKS);

    const fillers = [agent('vf1'), agent('vf2')];
    for (const f of fillers) await enrol(h, f);
    tick(h, 1);
    for (const f of fillers) {
      const where = new Set(handsOf(h.runtime.world, f.principalId as never).map((x) => x.location));
      expect(where.has(at as never), `${f.handle} must NOT start at the stage`).toBe(false);
    }

    const plans: { filler: Agent; only: Row }[] = [];
    for (const f of fillers) {
      expect(h.context.wakesSpent(f.principalId as never), 'nothing spent yet').toBe(0);
      const only = obs((await signed(h, f, 'GET', PATHS.observe)).json);
      // Not a tautology: the read must actually COST a wake, or "one wake" is vacuous.
      expect(h.context.wakesSpent(f.principalId as never), 'the read costs one wake').toBe(1);
      plans.push({ filler: f, only });
    }

    const rows = plans.map((p, i) => {
      const r = board(p.only).filter((x) => x['venture'] === id)[i];
      expect(r).toBeDefined();
      expect(String(r?.['terms_hash']).length, 'full 64-hex hash').toBe(64);
      expect(r?.['your_take_at_p50']).toBeGreaterThan(0);
      return r as Row;
    });

    let trip = -1;
    for (const [i, p] of plans.entries()) {
      const move = aff(p.only).find(
        (a) => a['verb'] === 'move' && (a['params'] as Row)['to'] === rows[i]?.['stage'],
      );
      expect(move, 'a move to the stage must be offered').toBeDefined();
      const m = /takes (\d+) tick/.exec(String(move?.['what_it_forecloses']));
      expect(m, 'the move affordance must publish the lane duration').not.toBeNull();
      trip = Number(m?.[1]);
      await act(p.filler, 'move', move?.['params']);
    }
    tick(h, trip + 2);
    for (const p of plans) noPending(p.filler, 'the move must resolve');

    for (const [i, p] of plans.entries()) {
      const hand = handsOf(h.runtime.world, p.filler.principalId as never).find(
        (x) => x.location === (at as never) && x.state === 'IDLE',
      );
      await act(p.filler, 'fill_role', {
        venture: rows[i]?.['venture'],
        role: rows[i]?.['role'],
        hand: hand?.id,
        stake: 0,
      });
    }
    tick(h, 1);
    for (const p of plans) noPending(p.filler, 'the fill must resolve');

    for (const [i, p] of plans.entries()) {
      await act(p.filler, 'sign', {
        venture: rows[i]?.['venture'],
        terms_hash: rows[i]?.['terms_hash'],
        your_take_at_p50: rows[i]?.['your_take_at_p50'],
      });
    }
    tick(h, 1);
    for (const p of plans) noPending(p.filler, 'the signature must resolve');

    expect(h.runtime.ventures.get(id as never)?.state).toBe('LIVE');
    expect(h.runtime.engine.tick).toBeLessThanOrEqual(closes);
    for (const p of plans) expect(h.context.wakesSpent(p.filler.principalId as never)).toBe(1);
  });

  it('a STAGGERED close still binds: the echo does not go stale when another role fills', async () => {
    // The board quotes `slotClaimAt(..., 'p50')` at a FULL fill; `countersign` compares
    // `yourTakeAtP50`, also at a full fill. If either used the currently-filled set the
    // first signer's echo would rot the moment the second role filled, and the venture
    // would die ABANDONED on a number the server itself published.
    const { id, stage: at } = await stage();
    const a = agent('stag-a');
    const b = agent('stag-b');
    for (const f of [a, b]) await enrol(h, f);
    tick(h, 1);
    bring(a, at);
    bring(b, at);

    const rowsA = board(obs((await signed(h, a, 'GET', PATHS.observe)).json)).filter(
      (r) => r['venture'] === id,
    );
    const rowsB = board(obs((await signed(h, b, 'GET', PATHS.observe)).json)).filter(
      (r) => r['venture'] === id,
    );
    const handA = handsOf(h.runtime.world, a.principalId as never)[0];
    const handB = handsOf(h.runtime.world, b.principalId as never)[0];

    // A fills and signs FIRST, alone. B is not even in the venture yet.
    await act(a, 'fill_role', { venture: id, role: rowsA[0]?.['role'], hand: handA?.id, stake: 0 });
    tick(h, 1);
    await act(a, 'sign', {
      venture: id,
      terms_hash: rowsA[0]?.['terms_hash'],
      your_take_at_p50: rowsA[0]?.['your_take_at_p50'],
    });
    tick(h, 1);
    noPending(a, "the first signer's echo must be accepted while the other role is still open");

    // Now B fills the second role and signs with the number IT read before A ever filled.
    await act(b, 'fill_role', { venture: id, role: rowsB[1]?.['role'], hand: handB?.id, stake: 0 });
    tick(h, 1);
    await act(b, 'sign', {
      venture: id,
      terms_hash: rowsB[1]?.['terms_hash'],
      your_take_at_p50: rowsB[1]?.['your_take_at_p50'],
    });
    tick(h, 1);
    noPending(b, "the second signer's echo must not have gone stale");
    expect(h.runtime.ventures.get(id as never)?.state).toBe('LIVE');
  });
});

describe('A5-prime — no new way to record a false default', () => {
  it('a half-signed venture whose window shuts records NO default and refunds every minor', async () => {
    const { creator, id, stage: at } = await stage();
    const filler = agent('halfway');
    await enrol(h, filler);
    tick(h, 1);
    bring(filler, at);

    const before = h.runtime.ledger.balance(storesAccount(creator.principalId as never));
    const rows = board(obs((await signed(h, filler, 'GET', PATHS.observe)).json)).filter(
      (r) => r['venture'] === id,
    );
    const hand = handsOf(h.runtime.world, filler.principalId as never)[0];
    // The filler takes a role, escrows, signs — and the OTHER role is never filled.
    await act(filler, 'fill_role', { venture: id, role: rows[0]?.['role'], hand: hand?.id, stake: 0 });
    tick(h, 1);
    await act(filler, 'sign', {
      venture: id,
      terms_hash: rows[0]?.['terms_hash'],
      your_take_at_p50: rows[0]?.['your_take_at_p50'],
    });
    tick(h, 1);
    noPending(filler, 'the signature must resolve');

    const closes = Number(h.runtime.ventures.get(id as never)?.windowClosesTick);
    tick(h, closes - h.runtime.engine.tick + 3);

    const dead = h.runtime.ventures.get(id as never);
    expect(dead?.state, 'the window shut on a half-filled venture').toBe('ABANDONED');
    // NOBODY defaulted. The venture never bound, so there was no promise to break.
    expect(defaultsOf(creator), 'the creator must carry no default').toBe(0);
    expect(defaultsOf(filler), 'the honest filler must carry no default').toBe(0);
    expect(h.runtime.standing.row(creator.principalId as never).lastDefaultTick).toBeNull();
    expect(h.runtime.standing.row(filler.principalId as never).lastDefaultTick).toBeNull();
    // And the escrow came home, in full: `before` was taken AFTER `create` had already
    // moved every role's escrowed half out, so the refund is the whole of it.
    const escrowed = (dead?.roles ?? []).reduce((n, r) => n + Number(r.terms.escrowed), 0);
    expect(escrowed).toBeGreaterThan(0);
    expect(h.runtime.ledger.balance(storesAccount(creator.principalId as never))).toBe(
      before + escrowed,
    );
  });

  it('the whole payload can be read every tick of a Reckoning without minting a default', async () => {
    // The observe surface is a read. If reading it can move standing, A5-prime is gone.
    const watchers = [agent('w1'), agent('w2'), agent('w3')];
    for (const w of watchers) await enrol(h, w);
    tick(h, 1);
    const { creator, id, stage: at } = await stage();
    bring(watchers[0] as Agent, at);
    const rows = board(obs((await signed(h, watchers[0] as Agent, 'GET', PATHS.observe)).json));
    expect(rows.length).toBeGreaterThan(0);

    for (let i = 0; i < 40; i += 1) {
      for (const w of watchers) {
        const res = await signed(h, w, 'GET', PATHS.observe);
        expect(res.status).toBe(200);
      }
      tick(h, 1);
    }
    for (const w of [...watchers, creator]) {
      expect(defaultsOf(w), `${w.handle} was libelled by a read`).toBe(0);
      expect(h.runtime.standing.row(w.principalId as never).lastDefaultTick).toBeNull();
    }
    expect(h.runtime.engine.status, 'the world must not have halted').not.toBe('HALTED');
    expect(id).toBeTruthy();
  });
});

describe('PROP-O1 one level up — the board truncates, so it must say so', () => {
  it('counts the eligible board rows its own cap drops', async () => {
    const creators: Agent[] = [];
    for (let i = 0; i < 18; i += 1) creators.push(agent(`fc${String(i)}`));
    for (const c of creators) await enrol(h, c);
    tick(h, 1);
    for (const c of creators) {
      const o = obs((await signed(h, c, 'GET', PATHS.observe)).json);
      const create = aff(o).find((a) => a['verb'] === 'create');
      if (create !== undefined) await act(c, 'create', create['params']);
    }
    tick(h, 1);

    const reader = agent('freader');
    await enrol(h, reader);
    tick(h, 1);
    const only = obs((await signed(h, reader, 'GET', PATHS.observe)).json);
    const rows = board(only);

    // How many slots is this reader ACTUALLY eligible for, per boardFor's own filter?
    let eligible = 0;
    for (const v of h.runtime.ventures.all()) {
      if (v.state !== 'FORMING') continue;
      if (h.runtime.engine.tick > v.windowClosesTick) continue;
      eligible += v.roles.filter((r) => r.filledByPrincipal === null).length;
    }
    const withheld = (only['header'] as Row)['withheld'] as Row;
    expect(eligible, 'the fixture must overflow the cap').toBeGreaterThan(rows.length);
    const droppedRows = eligible - rows.length;
    // THE CLAIM UNDER TEST, from the payload's own words. It closes with "nothing you were
    // eligible for has been dropped without this count", so the count has to include the
    // rows the board's own cap threw away.
    expect(droppedRows).toBeGreaterThan(0);
    expect(String(withheld['reason'])).toContain(
      `${String(droppedRows)} further slot(s) you are eligible for are not on ventures.board[] at all`,
    );
    expect(
      Number(withheld['count']),
      'the dropped rows must be inside the count the same sentence vouches for',
    ).toBeGreaterThanOrEqual(droppedRows);
  });
});
