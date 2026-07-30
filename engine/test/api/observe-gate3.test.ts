/**
 * The seven `observe` defects Gate 3 found, each as a regression that bites.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **GATE 3 MEASURED `0/0`, NOT `0/n`.**
 *
 * Four probe agents played the live game from `agent.md` and the public API alone.
 * Across 668 attempted actions, 571 accepted, ~300 ticks and one Reckoning, **nothing
 * settled** — so `elective declines / elective roles settled`, the one number the gate
 * exists to take, had no denominator. §7.6 was neither supported nor refuted.
 *
 * The cause was arithmetic in this module, not in the design. `BoardRow` carried no
 * `terms_hash`, so a role-filler needed a **second wake** to read one before it could
 * countersign — inside a 12-tick formation window, on a budget of one wake per 18 ticks.
 * A filler playing inside the documented budget could not close a deal, and one probe's
 * first sixteen ventures all died at window close "not one on price — every single one on
 * a missing countersignature."
 *
 * So the first test here is the gate's own precondition: **can a deal be closed at all,
 * from one observation, over real signed HTTP.** Everything downstream of it is
 * unmeasurable until that is true, and a green suite that did not assert it is what let
 * the gate run in the first place.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Every test below was mutation-checked: the line it covers was broken, the test was
 * confirmed red, and the line restored. Seven guards in this project have passed while
 * testing nothing, and a guard for a defect that already shipped once is the worst place
 * to add an eighth.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING, WAKES_PER_RECKONING } from '../../src/core/time.js';
import { buildObservation } from '../../src/api/index.js';
import { engineReport, engineViolation, tickInputsFor } from '../../src/tick/halt.js';
import { storesAccount } from '../../src/ledger/index.js';
import { slotClaimAt } from '../../src/observe/forecast.js';
import { yourTakeAtP50 } from '../../src/venture/index.js';
import { tradeObstacles } from '../../src/market/index.js';
import { commonsBoundRejection, handsOf, holdingOf } from '../../src/world/index.js';
import { FORMATION_WINDOW_TICKS } from '../../src/sim/runtime.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from './harness.js';

let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'observe-gate3' });
});
afterEach(async () => {
  await h.close();
});

// ── reading the payload ──────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function obs(body: Record<string, unknown>): Row {
  const o = body['observation'];
  expect(typeof o).toBe('object');
  return o as Row;
}

function header(observation: Row): Row {
  return observation['header'] as Row;
}

function board(observation: Row): Row[] {
  return (observation['ventures'] as Row)['board'] as Row[];
}

function affordances(observation: Row): Row[] {
  return observation['affordances'] as Row[];
}

function briefing(observation: Row): Row {
  return observation['briefing'] as Row;
}

function verb(observation: Row, name: string): Row | undefined {
  return affordances(observation).find((a) => a['verb'] === name);
}

/** Build an observation with no HTTP and no wake accounting. The unit under test. */
function direct(
  who: Agent,
  options: { fresh?: boolean; wakesRemaining?: number; stale?: boolean } = {},
): Row {
  return buildObservation({
    runtime: h.runtime,
    principal: who.principalId as never,
    serverNowMs: h.clock.nowMs(),
    fresh: options.fresh ?? true,
    wakesRemaining: options.wakesRemaining ?? WAKES_PER_RECKONING,
    stale: options.stale ?? false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  }) as unknown as Row;
}

/** Submit one act over real signed HTTP and assert it was not corrected. */
async function act(who: Agent, name: string, params: unknown): Promise<Row> {
  const res = await signed(h, who, 'POST', PATHS.act, {
    actions: [{ verb: name, params, clientSequence: 1 }],
  });
  // The body, not just the code: a 500 here is a defect in the surface under test and a
  // bare status assertion would hide which one.
  expect(res.status, `${name} -> ${res.status}: ${res.text.slice(0, 600)}`).toBe(200);
  const outcome = res.json['outcome'] as Row;
  expect(
    outcome['corrections'],
    `${name} was corrected: ${JSON.stringify(outcome['corrections'])}`,
  ).toEqual([]);
  return res.json;
}

/**
 * Assert nothing was refused at resolution.
 *
 * `POST /act` answers with the refusals knowable when the response was written; a refusal
 * from VALIDATE+LOCK is not one of them (§15.2) and arrives on the *next read* instead. So
 * a test that only checks `outcome.corrections` cannot see a `sign` refused for a bad
 * `terms_hash` — which is exactly the class of defect this file is about.
 */
function expectResolved(who: Agent, what: string): void {
  const pending = h.runtime.takeCorrections(who.principalId as never);
  expect(pending.map((c) => `${c.verb}/${c.invariant}: ${c.hint}`), what).toEqual([]);
}

/**
 * A creator with a signed, fully-open venture on the board.
 *
 * Driven through the API rather than reached into, because the whole point of the first
 * test is that the *published surface* is sufficient — a fixture that wrote the venture
 * directly would prove the runtime works and say nothing about `observe`.
 */
async function stagedVenture(): Promise<{
  readonly creator: Agent;
  readonly venture: string;
  readonly stage: string;
}> {
  const creator = agent('quillon');
  await enrol(h, creator);
  tick(h, 1);

  const first = obs((await signed(h, creator, 'GET', PATHS.observe)).json);
  const create = verb(first, 'create');
  expect(create).toBeDefined();
  await act(creator, 'create', create?.['params']);
  tick(h, 1);

  expectResolved(creator, 'the create affordance was copied verbatim and must resolve');

  const second = obs((await signed(h, creator, 'GET', PATHS.observe)).json);
  const sign = verb(second, 'sign');
  expect(sign, 'the creator must be offered its own countersignature').toBeDefined();
  await act(creator, 'sign', sign?.['params']);
  tick(h, 1);
  // The creator's own `sign` affordance has to carry a `terms_hash` the engine accepts and
  // an echo it agrees with, or nothing this file measures downstream can bind at all.
  expectResolved(creator, 'the sign affordance was copied verbatim and must resolve');

  const mine = (second['ventures'] as Row)['mine'] as Row[];
  const id = mine[0]?.['id'];
  expect(typeof id).toBe('string');
  const record = h.runtime.ventures.get(String(id) as never);
  expect(record).toBeDefined();
  return { creator, venture: String(id), stage: String(record?.stage) };
}

/**
 * Put a principal's hands where a venture is, without spending the ticks a `move` costs.
 *
 * Home systems differ per principal, and `Runtime.vFillRole` requires the hand to
 * `occupiesSystem(venture.stage)` — so a filler seated elsewhere has to travel first.
 * That path is exercised for real in "across a lane" below; here the arrival is
 * short-circuited so the tests about the *payload* are not also tests about geography.
 * It writes exactly what `resolveArrival` writes and nothing else.
 */
function bring(who: Agent, system: string): void {
  for (const hand of handsOf(h.runtime.world, who.principalId as never)) {
    hand.location = system as never;
    hand.destination = null;
    hand.state = 'IDLE';
    hand.presentSinceTick = h.runtime.engine.tick;
  }
}

// ── 1. the deal-closing gap ──────────────────────────────────────────────────

describe('the deal-closing gap — one observation must be enough to fill AND sign', () => {
  it('a filler closes a deal from a single wake, and the venture goes LIVE inside its window', async () => {
    const { venture, stage } = await stagedVenture();

    // Two independent fillers, because a DIG needs two distinct principals and
    // PROP-V6 will not let capital substitute for one of them.
    const fillers = [agent('sarn'), agent('brixe')];
    for (const filler of fillers) {
      await enrol(h, filler);
    }
    tick(h, 1);
    for (const filler of fillers) bring(filler, stage);

    const openedAt = h.runtime.engine.tick;
    for (const filler of fillers) {
      // ── EXACTLY ONE OBSERVATION. There is no second one anywhere below. ────
      const only = obs((await signed(h, filler, 'GET', PATHS.observe)).json);
      const spentAfterReading = h.context.wakesSpent(filler.principalId as never);

      const row = board(only).find((r) => r['venture'] === venture);
      expect(row, 'the staged venture must be on the board').toBeDefined();
      // The two fields that were missing. Without them the next two acts cannot be
      // composed without spending another wake.
      expect(typeof row?.['terms_hash']).toBe('string');
      expect(row?.['your_take_at_p50']).toBeGreaterThan(0);

      const fill = affordances(only).find(
        (a) => a['verb'] === 'fill_role' && (a['params'] as Row)['venture'] === venture,
      );
      expect(fill).toBeDefined();
      await act(filler, 'fill_role', fill?.['params']);
      tick(h, 1);

      // The signature is composed from the BOARD ROW, not from a fresh read. `POST /act`
      // is not wake-gated, so this is the whole point: the values were already in hand.
      await act(filler, 'sign', {
        venture: row?.['venture'],
        terms_hash: row?.['terms_hash'],
        your_take_at_p50: row?.['your_take_at_p50'],
      });
      tick(h, 1);

      // No second wake was spent closing the deal.
      expect(h.context.wakesSpent(filler.principalId as never)).toBe(spentAfterReading);
    }

    const record = h.runtime.ventures.get(venture as never);
    expect(record?.state, 'the venture must bind').toBe('LIVE');
    // And it bound inside the formation window it published, on the wake budget it has.
    expect(h.runtime.engine.tick - openedAt).toBeLessThan(FORMATION_WINDOW_TICKS);
    expect(record?.windowClosesTick).toBeGreaterThanOrEqual(h.runtime.engine.tick);
  });

  it('closes across a lane on one observation, because the trip’s length is published too', async () => {
    // ── THE WHOLE CHAIN, WITH REAL GEOGRAPHY ────────────────────────────────
    //
    // Home systems differ per principal and `vFillRole` requires the hand to occupy the
    // stage, so most fillers must `move` first. Before this, the `move` affordance named no
    // duration and `in_transit_eta` only appears once the hand is already under way — so an
    // agent had to spend a second wake to learn when its own hand could work. That is the
    // deal-closing gap one step earlier in the chain, and it is closed by publishing the
    // lane's `transitTicks` and the presence rule in the affordance itself.
    const { venture, stage } = await stagedVenture();
    const neighbour = [...(h.runtime.world.map.systems.get(stage as never)?.lanes ?? [])][0];
    expect(neighbour).toBeDefined();

    const filler = agent('marlin');
    await enrol(h, filler);
    tick(h, 1);
    bring(filler, String(neighbour));

    // ── EXACTLY ONE OBSERVATION for the whole three-act sequence ────────────
    const only = obs((await signed(h, filler, 'GET', PATHS.observe)).json);
    const spent = h.context.wakesSpent(filler.principalId as never);

    const row = board(only).find((r) => r['venture'] === venture);
    expect(row, 'an out-of-reach slot stays on the board — it is reachable, just not yet').toBeDefined();
    // No fill is offered, and the omission is counted and says what to do about it.
    expect(
      affordances(only).filter((a) => (a['params'] as Row)['venture'] === venture),
    ).toEqual([]);
    const withheld = header(only)['withheld'] as Row;
    expect(String(withheld['reason'])).toContain('no idle hand standing at their stage');
    expect(String(withheld['reason'])).toContain(stage);

    const move = affordances(only).find(
      (a) => a['verb'] === 'move' && (a['params'] as Row)['to'] === stage,
    );
    expect(move, 'the stage is one gate away, so a move to it must be offered').toBeDefined();
    // The agent reads the trip out of the affordance, exactly as a probe would.
    const trip = Number(/takes (\d+) tick/.exec(String(move?.['what_it_forecloses']))?.[1]);
    expect(Number.isSafeInteger(trip)).toBe(true);

    await act(filler, 'move', move?.['params']);
    // "a move that resolves in tick R puts the hand at S on tick R+N, and it becomes
    // PRESENT on tick R+N+1". The move resolves in the next tick, so that is 1 + N + 1
    // ticks from here. This is the published arithmetic, asserted rather than trusted.
    tick(h, trip + 2);
    const hand = handsOf(h.runtime.world, filler.principalId as never)[0];
    expect(hand?.location).toBe(stage);
    expect(hand?.state).toBe('IDLE');
    expect(hand?.presentSinceTick).toBeLessThanOrEqual(h.runtime.engine.tick);

    // Fill and sign, both composed from the single board row read before the trip.
    await act(filler, 'fill_role', {
      venture: row?.['venture'],
      role: row?.['role'],
      hand: hand?.id,
      stake: 0,
    });
    tick(h, 1);
    await act(filler, 'sign', {
      venture: row?.['venture'],
      terms_hash: row?.['terms_hash'],
      your_take_at_p50: row?.['your_take_at_p50'],
    });
    tick(h, 1);

    const record = h.runtime.ventures.get(venture as never);
    const filled = record?.roles.find((r) => r.index === Number(row?.['role']));
    expect(filled?.filledByPrincipal).toBe(filler.principalId);
    expect(record?.countersigned.has(filler.principalId as never)).toBe(true);
    // Inside the window it published, and on one wake.
    expect(h.runtime.engine.tick).toBeLessThanOrEqual(Number(row?.['expires_tick']));
    expect(h.context.wakesSpent(filler.principalId as never)).toBe(spent);
  });

  it('puts the slots a hand can actually reach at the head of the board', async () => {
    // `board[]` is capped at MAX_LIST_ROWS, and a cap over an arbitrary order can bury the
    // only slot a principal could fill behind a screenful it cannot reach. The remote
    // venture is created FIRST here, so its id sorts ahead of the local one and the
    // reachability term is the only thing that can put the local slot first.
    const { venture: remote, stage: remoteStage } = await stagedVenture();

    const near = agent('ashenvale');
    await enrol(h, near);
    tick(h, 1);
    const nearHome = handsOf(h.runtime.world, near.principalId as never)[0]?.location;
    expect(nearHome, 'the two creators must be seated apart for this to test anything').not.toBe(
      remoteStage,
    );
    const first = obs((await signed(h, near, 'GET', PATHS.observe)).json);
    await act(near, 'create', verb(first, 'create')?.['params']);
    tick(h, 1);
    const local = String(
      ((direct(near)['ventures'] as Row)['mine'] as Row[])[0]?.['id'],
    );
    expect(local < remote, 'the remote venture must sort first by id, or nothing is proved').toBe(
      false,
    );

    const filler = agent('teal');
    await enrol(h, filler);
    tick(h, 1);
    bring(filler, String(nearHome));

    const rows = board(direct(filler));
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0]?.['venture']).toBe(local);
    // The property, not just the first row: no unreachable slot precedes a reachable one.
    const reachable = rows.map((r) => r['stage'] === nearHome);
    expect(reachable.indexOf(true)).toBeLessThan(reachable.lastIndexOf(false));
    expect(reachable.lastIndexOf(true)).toBeLessThan(reachable.indexOf(false));
  });

  it('the board row publishes the venture’s own terms_hash, never a stale or invented one', async () => {
    const { venture, stage } = await stagedVenture();
    const filler = agent('tesk');
    await enrol(h, filler);
    tick(h, 1);
    bring(filler, stage);

    const only = direct(filler);
    const row = board(only).find((r) => r['venture'] === venture);
    const record = h.runtime.ventures.get(venture as never);
    // Compared against the venture rather than against a literal: a hash the row invents
    // is refused by `countersign`, which is the failure this row exists to prevent.
    expect(row?.['terms_hash']).toBe(record?.termsHash);
  });

  it('the fill_role affordance names the signature as the next act, with both literal values', async () => {
    const { venture, stage } = await stagedVenture();
    const filler = agent('oram');
    await enrol(h, filler);
    tick(h, 1);
    bring(filler, stage);

    const only = direct(filler);
    const row = board(only).find((r) => r['venture'] === venture);
    const fill = affordances(only).find(
      (a) => a['verb'] === 'fill_role' && (a['params'] as Row)['venture'] === venture,
    );
    const text = String(fill?.['what_it_forecloses']);
    // A filler that reads only this string has to be able to close the deal from it.
    expect(text).toContain('sign');
    expect(text).toContain(String(row?.['terms_hash']));
    expect(text).toContain(String(row?.['your_take_at_p50']));
    // And it has to know *when*, because the echo is zero until the fill lands.
    expect(text).toContain('NEXT tick');
  });
});

// ── 2. your_take_at_p50 on the board ────────────────────────────────────────

describe('your_take_at_p50 is the price of the SLOT, not of the reader’s empty hands', () => {
  it('is non-zero on every share slot a newcomer is eligible for', async () => {
    const { venture, stage } = await stagedVenture();
    const newcomer = agent('vessel');
    await enrol(h, newcomer);
    tick(h, 1);
    bring(newcomer, stage);

    const rows = board(direct(newcomer)).filter((r) => r['venture'] === venture);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // "The recruiting surface tells every newcomer that every seat pays nothing" was
      // the probe's sentence. A share slot with a positive escrowed half pays something.
      expect(
        row['your_take_at_p50'],
        `slot ${String(row['label'])} priced at zero on the recruiting surface`,
      ).toBeGreaterThan(0);
    }
  });

  it('equals what the signer will be asked to echo once the fill has landed', async () => {
    const { venture, stage } = await stagedVenture();
    const filler = agent('ashenvale');
    await enrol(h, filler);
    tick(h, 1);
    bring(filler, stage);

    const row = board(direct(filler)).find((r) => r['venture'] === venture);
    const quoted = row?.['your_take_at_p50'];

    const fill = affordances(direct(filler)).find(
      (a) => a['verb'] === 'fill_role' && (a['params'] as Row)['venture'] === venture,
    );
    await act(filler, 'fill_role', fill?.['params']);
    tick(h, 1);

    // `countersign` compares the echo against exactly this, and refuses on PROP-V3
    // otherwise. So the board's number and the server's demand are one number or the
    // affordance is not copyable.
    const record = h.runtime.ventures.get(venture as never);
    expect(record).toBeDefined();
    if (record === undefined) return;
    expect(quoted).toBe(yourTakeAtP50(record, filler.principalId as never));
    // And it is the settlement's own arithmetic, lifted, not a second implementation.
    expect(quoted).toBe(slotClaimAt(record, Number(row?.['role']), 'p50').claim);
  });
});

// ── 3. standing ─────────────────────────────────────────────────────────────

describe('standing is read from the book, and an agent can see its own', () => {
  it('header.standing carries the reader’s own row, in the counterparties[] shape', async () => {
    const a = agent('lumen');
    await enrol(h, a);
    tick(h, 1);

    const own = header(direct(a))['standing'] as Row;
    expect(own['principal']).toBe(a.principalId);
    const vectors = own['standing'] as Row;
    // §13's "report a default recorded against you" is incoherent while these are absent.
    expect(Object.keys(vectors).sort((x, y) => (x < y ? -1 : 1))).toEqual([
      'contradicted_seals',
      'defaults',
      'distinct_counterparties',
      'elective_honoured',
      'elective_honoured_value',
    ]);
    expect(own['last_default']).toBeNull();
  });

  it('a counterparty’s vectors move when the book moves — they were a constant', async () => {
    const { creator, venture, stage } = await stagedVenture();
    const filler = agent('coreen');
    await enrol(h, filler);
    tick(h, 1);
    bring(filler, stage);

    const fill = affordances(direct(filler)).find(
      (a) => a['verb'] === 'fill_role' && (a['params'] as Row)['venture'] === venture,
    );
    await act(filler, 'fill_role', fill?.['params']);
    tick(h, 1);

    const before = obs({ observation: direct(filler) })['counterparties'] as Row[];
    const creatorBefore = before.find((c) => c['principal'] === creator.principalId);
    expect(creatorBefore, 'the creator of a venture I hold a role in is a counterparty').toBeDefined();
    expect((creatorBefore?.['standing'] as Row)['elective_honoured']).toBe(0);

    // The only writer of standing, driven directly. No tick is run afterwards: a
    // synthetic journal entry cites no real event and INV-21 would rightly halt on it.
    h.runtime.standing.apply({
      tick: h.runtime.engine.tick,
      credits: [
        {
          delta: {
            cause: 'ELECTIVE_HONOURED',
            principal: creator.principalId as never,
            counterparty: filler.principalId as never,
            venture: venture as never,
            electiveHonoured: 1,
            electiveHonouredValue: 900 as never,
            defaults: 0,
            defaultedValue: 0 as never,
            actedBy: null,
            boundByGrant: null,
          },
          eventId: 'ev:test:honoured' as never,
        },
      ],
      charges: [],
    });

    const after = obs({ observation: direct(filler) })['counterparties'] as Row[];
    const creatorAfter = after.find((c) => c['principal'] === creator.principalId);
    const vectors = creatorAfter?.['standing'] as Row;
    expect(vectors['elective_honoured']).toBe(1);
    expect(vectors['elective_honoured_value']).toBe(900);
    expect(vectors['distinct_counterparties']).toBe(1);
  });

  it('last_default is the tick of a recorded default, so agent.md §12 advice #5 is followable', async () => {
    const { creator, venture, stage } = await stagedVenture();
    const filler = agent('mattock');
    await enrol(h, filler);
    tick(h, 1);
    bring(filler, stage);

    const fill = affordances(direct(filler)).find(
      (a) => a['verb'] === 'fill_role' && (a['params'] as Row)['venture'] === venture,
    );
    await act(filler, 'fill_role', fill?.['params']);
    tick(h, 1);

    const at = h.runtime.engine.tick;
    h.runtime.standing.apply({
      tick: at,
      credits: [
        {
          delta: {
            cause: 'DEFAULT',
            principal: creator.principalId as never,
            counterparty: filler.principalId as never,
            venture: venture as never,
            electiveHonoured: 0,
            electiveHonouredValue: 0 as never,
            defaults: 1,
            defaultedValue: 900 as never,
            actedBy: null,
            boundByGrant: null,
          },
          eventId: 'ev:test:default' as never,
        },
      ],
      charges: [],
    });

    const rows = obs({ observation: direct(filler) })['counterparties'] as Row[];
    const row = rows.find((c) => c['principal'] === creator.principalId);
    // The field the document tells an agent to read before trusting somebody.
    expect(row?.['last_default']).toBe(at);
    expect((row?.['standing'] as Row)['defaults']).toBe(1);
    // And the defaulter's own header says so too, which is what §13 needs.
    const own = header(direct(creator))['standing'] as Row;
    expect((own['standing'] as Row)['defaults']).toBe(1);
    expect(own['last_default']).toBe(at);
  });

  it('the prompt reads the payer’s record, so the board names who may not pay', async () => {
    const { creator, venture, stage } = await stagedVenture();
    const filler = agent('dressel');
    await enrol(h, filler);
    tick(h, 1);
    bring(filler, stage);

    const at = h.runtime.engine.tick;
    h.runtime.standing.apply({
      tick: at,
      credits: [
        {
          delta: {
            cause: 'DEFAULT',
            principal: creator.principalId as never,
            counterparty: filler.principalId as never,
            venture: venture as never,
            electiveHonoured: 0,
            electiveHonouredValue: 0 as never,
            defaults: 1,
            defaultedValue: 900 as never,
            actedBy: null,
            boundByGrant: null,
          },
          eventId: 'ev:test:default' as never,
        },
      ],
      charges: [],
    });

    const prompt = String(briefing(direct(filler))['prompt']);
    expect(prompt).toContain('1 recorded default(s)');
    expect(prompt).toContain(creator.principalId);
  });
});

describe('my_elective_direction disambiguates who owes the elective (Gate 3 #4)', () => {
  it('is OWED_TO_ME on a role you filled, and never OWED_TO_ME on your own venture', async () => {
    // Two capable probes read bare `my_elective` opposite ways — one thought a filler
    // OWES it. The engine rule (elect is the creator's, §5.1/observe.ts:546): the elective
    // on a role you HOLD is paid TO you by the venture's creator. This pins the direction.
    const { creator, venture, stage } = await stagedVenture();
    const filler = agent('darrow');
    await enrol(h, filler);
    tick(h, 1);
    bring(filler, stage);

    const fill = affordances(direct(filler)).find(
      (a) => a['verb'] === 'fill_role' && (a['params'] as Row)['venture'] === venture,
    );
    expect(fill, 'the filler is offered the open role').toBeDefined();
    await act(filler, 'fill_role', fill?.['params']);
    tick(h, 1);

    const fRow = ((obs({ observation: direct(filler) })['ventures'] as Row)['mine'] as Row[]).find(
      (v) => v['id'] === venture,
    );
    expect(fRow?.['my_role'], 'the filler now holds a role').not.toBeNull();
    expect(fRow?.['my_elective_direction']).toBe('OWED_TO_ME');

    const cRow = ((obs({ observation: direct(creator) })['ventures'] as Row)['mine'] as Row[]).find(
      (v) => v['id'] === venture,
    );
    // On your OWN venture your own role is self-paid (scar #9): you are never OWED on it,
    // and what you OWE as the payer is the `elect` affordance, never `my_elective`.
    expect(cRow?.['my_elective_direction']).not.toBe('OWED_TO_ME');
    if (cRow?.['my_role'] !== null && cRow?.['my_role'] !== undefined) {
      expect(cRow?.['my_elective_direction']).toBe('SELF');
    }
  });
});

// ── 4. the prompt ───────────────────────────────────────────────────────────

describe('briefing.prompt tells a filler the truth about standing (scar #1)', () => {
  it('never claims the board role’s elective half will build the FILLER’s standing', async () => {
    const { stage } = await stagedVenture();
    const filler = agent('inda');
    await enrol(h, filler);
    tick(h, 1);
    bring(filler, stage);

    const prompt = String(briefing(direct(filler))['prompt']);
    // The exact sentence that shipped. A filler is the payee: `elect` is generated only
    // for `venture.creator === principal`, and standing accrues to whoever HONOURS.
    expect(prompt).not.toContain('the only part that will ever build your standing');
    expect(prompt).toContain('builds no standing of your own');
    expect(prompt).toContain('HONOURS an elective part');
  });

  it('names the price, the part at risk, and how to close it', async () => {
    const { creator, venture, stage } = await stagedVenture();
    const filler = agent('sedge');
    await enrol(h, filler);
    tick(h, 1);
    bring(filler, stage);

    const only = direct(filler);
    const row = board(only).find((r) => r['venture'] === venture);
    const prompt = String(briefing(only)['prompt']);
    expect(prompt).toContain(String(row?.['your_take_at_p50']));
    expect(prompt).toContain(String(row?.['elective']));
    expect(prompt).toContain(creator.principalId);
    expect(prompt).toContain(String(row?.['terms_hash']));
  });
});

// ── 5. the not-a-wake reasons ───────────────────────────────────────────────

describe('the withheld reason states the world’s actual status (the two were swapped)', () => {
  it('does not claim PAUSED while the world is RUNNING and wakes remain', async () => {
    const a = agent('wren');
    await enrol(h, a);
    tick(h, 1);

    expect(h.runtime.engine.status).toBe('RUNNING');
    const reason = String((header(direct(a, { fresh: false }))['withheld'] as Row)['reason']);
    // Four probes read a false assertion about world state here.
    expect(reason).not.toContain('PAUSED');
    expect(reason).toContain('RUNNING');
    expect(reason).toContain('wake');
  });

  it('is consistent with briefing.prompt in the same payload', async () => {
    const a = agent('halloran');
    await enrol(h, a);
    tick(h, 1);

    const outside = direct(a, { fresh: false });
    const reason = String((header(outside)['withheld'] as Row)['reason']);
    const prompt = String(briefing(outside)['prompt']);
    // The bug was two fields in one payload disagreeing about whether the world was
    // running. `prompt` was right and `withheld.reason` was wrong.
    expect(prompt).toContain('outside a wake');
    expect(reason).not.toContain('PAUSED');
  });

  it('an action response carries the RUNNING reason, not the paused one', async () => {
    const a = agent('kettle');
    await enrol(h, a);
    tick(h, 1);

    const read = obs((await signed(h, a, 'GET', PATHS.observe)).json);
    const claim = verb(read, 'claim');
    const res = await signed(h, a, 'POST', PATHS.act, {
      actions: [{ verb: 'claim', params: { text: 'HANDS FOR HIRE' }, clientSequence: 1 }],
      expectedStateVersion: header(read)['state_version'],
    });
    expect(claim).toBeDefined();
    expect(res.status).toBe(200);
    // This is the path four probes actually read: the observation attached to /act.
    const attached = res.json['observation'] as Row;
    const reason = String((header(attached)['withheld'] as Row)['reason']);
    expect(reason).not.toContain('PAUSED');
    expect(String(header(attached)['stale'])).toBe('false');
  });

  it('says PAUSED when, and only when, the engine says PAUSED', async () => {
    const a = agent('thole');
    await enrol(h, a);
    tick(h, 2);

    const at = h.runtime.engine.tick;
    h.runtime.engine.controller.haltTick(
      engineReport(at, [engineViolation('INV-9', at, 'synthetic halt, for the PAUSED surface')], ['ASSERT']),
      tickInputsFor(h.runtime.engine.snapshot(), [], at, 'observe-gate3'),
    );
    expect(h.runtime.engine.status).toBe('PAUSED');

    const reason = String(
      (header(direct(a, { fresh: false, stale: true }))['withheld'] as Row)['reason'],
    );
    expect(reason).toContain('PAUSED');
  });

  it('still explains an exhausted wake budget as an exhausted wake budget', async () => {
    const a = agent('poll');
    await enrol(h, a);
    tick(h, 1);

    const reason = String(
      (header(direct(a, { fresh: false, wakesRemaining: 0 }))['withheld'] as Row)['reason'],
    );
    expect(reason).toContain('wakes');
    expect(reason).toContain(String(WAKES_PER_RECKONING));
    expect(reason).not.toContain('PAUSED');
  });
});

// ── 6. "we never truncate this list" ────────────────────────────────────────

describe('the hands that were not offered are counted (PROP-O1)', () => {
  it('counts one fill_role per slot as an omission of the other idle hands', async () => {
    const { venture, stage } = await stagedVenture();
    const filler = agent('gallow');
    await enrol(h, filler);
    tick(h, 1);
    bring(filler, stage);

    const only = direct(filler);
    const rows = board(only).filter((r) => r['venture'] === venture);
    const offered = affordances(only).filter((a) => a['verb'] === 'fill_role');
    const idle = handsOf(h.runtime.world, filler.principalId as never);

    expect(rows.length).toBeGreaterThan(0);
    expect(idle.length).toBeGreaterThan(1);
    // One act per slot is offered, and the rest are counted rather than dropped.
    expect(offered.length).toBe(rows.length);
    const withheld = header(only)['withheld'] as Row;
    // ── THE TOTAL IS THE SUM OF ITS NAMED PARTS, AND THERE ARE TWO NOW ──────
    //
    // The second term arrived with `graduate`: a Commons-bound principal is no longer
    // offered `move` onto the lanes leaving the Commons, because the engine refuses them
    // (A15) and an affordance the engine refuses costs a real action. Every principal in
    // this fixture is Commons-seated, so the term is non-zero, and PROP-O1's property is
    // that the omission is **counted** rather than that it does not exist. Recomputed
    // here from the same predicate the observation uses, so the assertion stays exact
    // instead of relaxing to `>=` — a `>=` here would have accepted the silent drop this
    // test exists to catch.
    const boundLanes = handsOf(h.runtime.world, filler.principalId as never)
      .filter((hand) => hand.state === 'IDLE')
      .reduce(
        (n, hand) =>
          n +
          [...(h.runtime.world.map.systems.get(hand.location)?.lanes ?? [])].filter(
            (lane) => commonsBoundRejection(h.runtime.world, hand, lane) !== null,
          ).length,
        0,
      );
    expect(boundLanes).toBeGreaterThan(0);
    // ── AND A THIRD TERM, WHICH ARRIVED WITH WORKS AND THEN WENT TO ZERO ─────
    //
    // Written when a WORKS cost EARNINGS, so a fixture principal holding only its starter stake
    // could not afford one and the omission was counted. Then reachability was measured on the
    // live world — `worksAffordableBy` read 0 of 21 — and the gate moved to the free balance,
    // because a WORKS build RETIRES currency rather than paying anybody and D7 has no claim on
    // it. The build is now affordable from the grant, so the term is legitimately zero.
    //
    // Recomputed from the quote either way rather than pinned, so this stays exact through the
    // next recalibration instead of becoming a literal nobody trusts.
    const worksQuote = h.runtime.worksQuote(
      filler.principalId as never,
      h.runtime.graduationQuote(filler.principalId as never)?.from ?? ('sys-01' as never),
    );
    const worksWithheld = !worksQuote.affordable && !worksQuote.alreadyHeld ? 1 : 0;
    // ── AND A FOURTH TERM: `trade`, WHICH HAD NO TERM AT ALL AND WAS THE BUG ─────
    //
    // A blind probe holding 200,000 currency and 40,116 `ration` in the MARCHES was offered no
    // `trade`, and `withheld` counted a venture slot and `demand` and said nothing about it —
    // so the payload's closing promise was false. Measured on a swept world before the fix:
    // silent in 497 of 576 observations, every one with a reachable venue.
    //
    // Recomputed from `tradeObstacles`, the SAME function the observation calls, exactly as the
    // three terms above are recomputed from `commonsBoundRejection` and `worksQuote`. A literal
    // `1` here would be a second answer to the question the payload already answered, which is
    // the two-homes shape this whole file's exactness discipline exists to prevent.
    const marketAt = ((direct(filler)['market'] as Row)['at'] ?? []) as never[];
    const tradeWithheld =
      affordances(only).some((a) => a['verb'] === 'trade') ||
      tradeObstacles({
        ledger: h.runtime.ledger,
        world: h.runtime.world,
        book: h.runtime.market,
        principal: filler.principalId as never,
        tick: h.runtime.engine.tick,
        books: ((direct(filler)['market'] as Row)['books'] ?? []) as never[],
        venues: marketAt,
        homeVenue: holdingOf(h.runtime.world, filler.principalId as never).system,
      }).length === 0
        ? 0
        : 1;
    // Non-vacuity: this fixture really is in the state the probe was in, or the term is a zero
    // that proves nothing about the branch it is here to pin.
    expect(marketAt.length, 'the filler must be standing in a market').toBeGreaterThan(0);
    expect(tradeWithheld, 'and its trade must really be withheld').toBe(1);
    // ── AND A FIFTH TERM: PHASE 3's RISK ACTS, RECOMPUTED THE SAME WAY ──────────
    //
    // `src/risk/` adds `publish_offer {kind:"COVER"}` / `sign {cover}` / `elect {cover}` to the menu,
    // and a tagged row for each one it withholds. Read off `runtime.riskAffordances` — the SAME
    // function the observation calls, for the reason the `trade` term above states in full: a literal
    // count here would be a second answer to a question the payload already answered.
    //
    // Non-vacuity below: at this tick no FRONT is in FORECAST, so exactly one row is withheld under
    // `NO_RECORD`. If that ever becomes zero this term stops proving anything and the assertion after
    // it says so.
    const riskWithheld = h.runtime.riskAffordances(
      filler.principalId as never,
      h.runtime.engine.tick,
    ).withheld.length;
    expect(riskWithheld, 'no FRONT is announced this early, so the COVER act is withheld and counted').toBe(
      1,
    );
    // ── AND A SIXTH: `grant`, THE A6 CORE LOOP, WHICH WAS NEVER ACCOUNTED FOR ──
    //
    // The affordance existed and the ACCOUNTING did not: a blind player went 21 observations with no
    // `grant` offer and no row, then sent it blind and it WORKED. `withheld-is-accountable.spec.ts`
    // had measured the silence at 45.7% and filed it `OPEN` on a reason describing a gate the code
    // does not have (*"offices are voted into being"* — `officeShape('treasury-hand')` is a constant).
    //
    // Recomputed from `grantCandidates`, the SAME function the observation calls, for the reason every
    // other term here is: a literal count would be a second answer to a question the payload answered.
    const grantWithheld =
      h.runtime.grantCandidates(filler.principalId as never, h.runtime.engine.tick).length === 0 ? 1 : 0;
    // Non-vacuity: the shortlist gates on a counterparty having HONOURED an elective half TO this
    // principal, and nothing has settled this early — so it is empty and the row fires. If that ever
    // becomes zero here the term stops proving anything and this says so.
    expect(grantWithheld, 'no elective half has settled to this filler yet, so `grant` is withheld').toBe(1);
    expect(Number(withheld['count'])).toBe(
      rows.length * (idle.length - 1) +
        boundLanes +
        worksWithheld +
        tradeWithheld +
        riskWithheld +
        grantWithheld,
    );
    expect(
      (withheld['verbs'] ?? []) as string[],
      'and the core loop is named machine-readably, not only in the prose',
    ).toContain('grant');
    expect(String(withheld['reason']), 'and the row says which thing is missing').toContain('no trade is offered');
    expect((withheld['verbs'] ?? []) as string[], 'and names the verb, machine-readably').toContain('trade');
    expect(String(withheld['reason'])).toContain('further legal fill_role act(s) exist');
    expect(String(withheld['reason'])).toContain('lanes leaving the Commons');
    if (worksWithheld > 0) {
      expect(String(withheld['reason']), 'a withheld WORKS names its own price').toContain('a WORKS at');
    }
    // The claim it used to make while dropping them.
    expect(String(withheld['reason'])).not.toBe(
      'nothing was withheld: this is every legal act, with its full cost.',
    );
  });

  it('the un-offered hands really are legal, which is why the count is owed', async () => {
    const { venture, stage } = await stagedVenture();
    const filler = agent('rooke');
    await enrol(h, filler);
    tick(h, 1);
    bring(filler, stage);

    const only = direct(filler);
    const offeredHands = new Set(
      affordances(only)
        .filter((a) => a['verb'] === 'fill_role')
        .map((a) => String((a['params'] as Row)['hand'])),
    );
    const mine = handsOf(h.runtime.world, filler.principalId as never);
    const unoffered = mine.find((hand) => !offeredHands.has(hand.id));
    expect(unoffered, 'the point of the count is that these exist').toBeDefined();

    const row = board(only).find((r) => r['venture'] === venture);
    await act(filler, 'fill_role', {
      venture: row?.['venture'],
      role: row?.['role'],
      hand: unoffered?.id,
      stake: 0,
    });
    tick(h, 1);

    const record = h.runtime.ventures.get(venture as never);
    const filled = record?.roles.find((r) => r.index === Number(row?.['role']));
    expect(filled?.filledByHandId).toBe(unoffered?.id);
  });

  it('counts every slot it cannot offer, and never offers a hand that is not present yet', async () => {
    const { venture, stage } = await stagedVenture();
    const filler = agent('nell');
    await enrol(h, filler);
    tick(h, 1);
    bring(filler, stage);

    // Every hand IDLE, at the stage, and **not present** — the state a hand is in for one
    // tick after it arrives. `fillRole` refuses it by name (INV-9), so offering it is the
    // server telling an agent to act and then declining (AGT-S2). No tick runs after this.
    const at = h.runtime.engine.tick;
    for (const hand of handsOf(h.runtime.world, filler.principalId as never)) {
      hand.presentSinceTick = at + 5;
    }

    const only = direct(filler);
    const rows = board(only).filter((r) => r['venture'] === venture);
    expect(rows.length, 'the slots are still eligible; only the hand is unready').toBeGreaterThan(0);
    expect(affordances(only).filter((a) => a['verb'] === 'fill_role')).toEqual([]);

    // Not offered is not the same as not counted (PROP-O1).
    const withheld = header(only)['withheld'] as Row;
    expect(Number(withheld['count'])).toBeGreaterThanOrEqual(rows.length);
    expect(String(withheld['reason'])).toContain('no fill_role offered');
    expect(String(withheld['reason'])).toContain('not present until the');
  });
});

// ── 7. if_you_do_nothing and the escrow ─────────────────────────────────────

describe('if_you_do_nothing is right about the escrow (PROP-O5)', () => {
  it('does not claim the escrow stays locked until the creator abandons the venture', async () => {
    const { creator } = await stagedVenture();
    const statement = String(briefing(direct(creator))['if_you_do_nothing']);
    expect(statement).not.toContain('escrow stays locked until you abandon');
    expect(statement).toContain('retired ABANDONED without your acting');
    expect(statement).toContain('refunded in full');
  });

  it('and reality agrees: the window closes, the escrow comes back, no action spent', async () => {
    const creator = agent('sabra');
    await enrol(h, creator);
    tick(h, 1);

    const account = storesAccount(creator.principalId as never);
    const before = h.runtime.ledger.freeBalance(account);

    const create = verb(direct(creator), 'create');
    await act(creator, 'create', create?.['params']);
    tick(h, 1);
    expect(h.runtime.ledger.freeBalance(account)).toBeLessThan(before);

    const record = h.runtime.ventures.get(
      String(((direct(creator)['ventures'] as Row)['mine'] as Row[])[0]?.['id']) as never,
    );
    expect(record?.state).toBe('FORMING');

    // Take no action at all. The statement says the world does this by itself.
    tick(h, FORMATION_WINDOW_TICKS + 3);
    expect(record?.state).toBe('ABANDONED');
    expect(h.runtime.ledger.freeBalance(account)).toBe(before);
    expect(h.runtime.engine.status).toBe('RUNNING');
  });
});

describe('the Levy is visible over the API, not tested-but-dead', () => {
  it('obligations.levy reflects the runtime block once a Reckoning has assessed', async () => {
    // A verifier found `src/api/observe.ts` returning `obligations.levy: null`
    // unconditionally while the Levy settled correctly in the sim — the same shape as
    // standing being a hardcoded constant. An agent over HTTP could never see its own
    // assessment, so §5's "the total cannot be dodged" was unfollowable and
    // set_delivery_intent never surfaced. The observation now calls
    // runtime.levyBlockFor, so the wire matches what the engine holds.
    // Enrol a principal the ordinary way, then advance to the first assessment.
    const who = agent('levyseer');
    await enrol(h, who);
    for (let i = 0; i < TICKS_PER_RECKONING; i++) tick(h);

    const block = h.runtime.levyBlockFor(who.principalId as never, h.runtime.engine.tick);
    const obs = direct(who);
    const obligations = obs['obligations'] as { levy: unknown };

    if (block !== null) {
      expect(obligations.levy).not.toBeNull();
      expect((obligations.levy as { my_assessment: number }).my_assessment).toBe(block.my_assessment);
    } else {
      expect(obligations.levy).toBeNull();
    }
    // Either way, the wire equals the engine: the whole point.
    expect(obligations.levy).toEqual(block);
  });
})
