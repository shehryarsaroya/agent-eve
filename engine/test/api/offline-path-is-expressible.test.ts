/**
 * THE OFFLINE PATH — and the client that structurally could not express it.
 *
 * A3 makes durable intents the reason an offline agent is viable; R19 makes the Levy payable by a
 * standing intent so an absent agent can meet it. `set_delivery_intent` implements that, and it
 * accepted exactly ONE shape: `{"intent": {"verb": ..., "params": {...}}}`.
 *
 * That shape is impossible for the house cast to send. `cast/parse.ts` rejects any non-array object
 * in params as `nested-object`, and a rejected param DISCARDS THE WHOLE PLAN — so one nested key
 * costs a member its entire wake, not one action. Production logged a real member losing its wake to
 * exactly this:
 *
 *     cast: thessaly reply discarded (param-intent-nested-object)
 *
 * And AGT-R5's sweep recorded the verb as the one remaining HONEST GAP: legal, executing, offered
 * nowhere. So the mechanism that exists to protect absent players was unreachable by the client that
 * plays most of the world, and invisible to everyone else.
 *
 * Both halves are fixed here: a flat spelling the cast can send, and an affordance so nobody has to
 * know the verb exists. The nested form still works — every client that already sends it is
 * untouched, which is the test in the middle.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from './harness.js';

type Row = Record<string, unknown>;
let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'offline-path' });
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

async function refusalFor(who: Agent, verb: string): Promise<string | null> {
  const o = await observe(who);
  const rows = ((o['briefing'] as Row)['corrections'] ?? []) as readonly Row[];
  const mine = rows.find((c) => String(c['verb']) === verb);
  return mine === undefined ? null : String(mine['hint']);
}

describe('a standing order for the Levy is expressible without nesting', () => {
  it('accepts the FLAT spelling — the one a cast member can actually send', async () => {
    const who = agent('absent');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 3);

    // Non-vacuity: there must be a Levy to stand an order against.
    const levy = ((await observe(who))['obligations'] as Row)['levy'] as Row;
    expect(Number(levy['shortfall_if_unpaid']), 'nothing owed, so this proves nothing').toBeGreaterThan(0);

    await submit(
      who,
      'set_delivery_intent',
      {
        intent_verb: 'deliver',
        obligation: 'LEVY',
        amount: 100,
        until_tick: h.runtime.engine.tick + TICKS_PER_RECKONING,
      },
      1,
    );
    tick(h, 2);
    expect(
      await refusalFor(who, 'set_delivery_intent'),
      'the flat spelling must be accepted — the nested one is unsendable by the house cast',
    ).toBeNull();
  });

  it('still accepts the NESTED spelling, so no existing client breaks', async () => {
    const who = agent('legacy');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 3);
    await submit(
      who,
      'set_delivery_intent',
      {
        intent: { verb: 'deliver', params: { obligation: 'LEVY', amount: 100 } },
        until_tick: h.runtime.engine.tick + TICKS_PER_RECKONING,
      },
      1,
    );
    tick(h, 2);
    expect(await refusalFor(who, 'set_delivery_intent')).toBeNull();
  });

  it('names BOTH spellings when neither is sent, because a hint that omits one is a trap', async () => {
    const who = agent('confused');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 3);
    await submit(who, 'set_delivery_intent', { until_tick: 400 }, 1);
    tick(h, 2);
    const hint = await refusalFor(who, 'set_delivery_intent');
    expect(hint).not.toBeNull();
    expect(String(hint), 'the nested spelling must be named').toMatch(/"intent"/);
    expect(String(hint), 'and the flat one, which is the only one some clients can send').toMatch(
      /intent_verb/,
    );
  });
});

describe('the offline path is on the menu, not just in the manual', () => {
  it('is offered while a Levy is payable, in the spelling every client can send', async () => {
    const who = agent('offered');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 3);

    const o = await observe(who);
    const offer = ((o['affordances'] ?? []) as readonly Row[]).find(
      (a) => String(a['verb']) === 'set_delivery_intent',
    );
    expect(
      offer,
      'the mechanism that protects absent players must not require knowing it exists — it was ' +
        "AGT-R5's last HONEST GAP",
    ).toBeDefined();

    const params = offer?.['params'] as Row;
    expect(params['intent_verb'], 'flat, so the house cast can copy it verbatim').toBe('deliver');
    expect(params['intent'], 'and NOT nested — a nested param discards a cast plan whole').toBeUndefined();

    // The offered params must be accepted verbatim: a menu entry the engine refuses costs a real
    // action, which is the whole reason affordances are built from the engine's own quotes.
    await submit(who, 'set_delivery_intent', params, 1);
    tick(h, 2);
    expect(
      await refusalFor(who, 'set_delivery_intent'),
      'the menu offered an act the engine then refused',
    ).toBeNull();
  });

  it('states what it will keep doing while nobody is watching', async () => {
    // A3's bargain is that absence costs opportunity and never your record. That is only a fair
    // bargain if the standing order says out loud that it keeps spending — the risk of an intent is
    // precisely that it runs when you would rather it had not.
    const who = agent('warned');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 3);
    const offer = (((await observe(who))['affordances'] ?? []) as readonly Row[]).find(
      (a) => String(a['verb']) === 'set_delivery_intent',
    );
    const text = String(offer?.['what_it_forecloses']);
    expect(text, 'it must say the routine runs cost no action (A3)').toMatch(/costs? NONE|no action/i);
    expect(text, 'and that it keeps spending unattended').toMatch(/whether or not you are watching/i);
    expect(Number(offer?.['cost']), 'creating an intent costs one action').toBe(1);
  });
});
