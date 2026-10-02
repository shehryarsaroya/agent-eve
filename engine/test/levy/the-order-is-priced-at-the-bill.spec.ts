/**
 * ★ **THE STANDING LEVY ORDER IS PRICED AT THE BILL IT CAN TAKE, NOT AT ONE RUN.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The `set_delivery_intent` row said *"hands over up to 500 of ration each Reckoning"* with
 * `max_direct_loss: 500`. The order is due EVERY tick (`IntentBook.due`) and each run pays up to its
 * `amount` until the bill is paid, so a probe's 500-a-run order paid 6,656 in one Reckoning — 13x what
 * the honesty field said it could. The row now quotes the bill still owed as `max_direct_loss` and
 * names the per-tick rate beside it.
 *
 * The engine half is asserted too, because the sentence is only true if the engine does what it says:
 * an order whose per-run amount is a fifth of the bill pays the whole bill, a run per tick.
 *
 * Mutation, run: restoring "each Reckoning" fails ★1. Restoring `max_direct_loss: levyQuote.payable`
 * does NOT fail here, and that is a limit of the fixture stated rather than hidden: `payable` is
 * `min(owed, goods held)`, and a newcomer holding 50,000 against a 500 bill makes the two equal. They
 * part only when holdings fall short of the bill, which no cheap act on a fresh world produces.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import { levyWorld, tick } from './fixture.js';

type Row = Record<string, unknown>;

describe('★ the standing Levy order', () => {
  it('★1 quotes the bill still owed and the per-tick rate, and the engine pays the bill a run per tick', () => {
    const world = levyWorld('order-priced-at-bill', 2);
    const runtime = world.runtime;
    const payer = world.principals[0];
    if (payer === undefined) throw new Error('fixture');
    tick(runtime);

    const owed = runtime.levyBlockFor(payer, runtime.engine.tick)?.shortfall_if_unpaid ?? 0;
    expect(owed, 'non-vacuity: a bill is owed').toBeGreaterThan(0);
    const payload = buildObservation({
      runtime,
      principal: payer,
      serverNowMs: 0,
      fresh: true,
      wakesRemaining: 9,
      stale: false,
      corrections: [],
      correctionsDropped: 0,
      actionsRemaining: 4,
    }) as unknown as Row;
    const row = (payload['affordances'] as Row[]).find(
      (a) => a['verb'] === 'set_delivery_intent' && (a['params'] as Row)['obligation'] === 'LEVY',
    );
    expect(row, 'non-vacuity: the order is offered').toBeDefined();
    expect(row?.['max_direct_loss'], 'the most it can take this Reckoning is the bill still owed').toBe(owed);
    const text = String(row?.['what_it_forecloses']);
    expect(text).toContain('PER TICK');
    expect(text).toContain(`this one: ${String(owed)} still owed`);
    expect(text, 'the old per-Reckoning reading').not.toMatch(/up to \d+ of \w+ each Reckoning/);

    // The engine half: the same order with a per-run amount of a fifth of the bill.
    const amount = Math.ceil(owed / 5);
    const params = { ...(row?.['params'] as Row), amount };
    const submitted = runtime.engine.submit({
      principal: payer,
      verb: 'set_delivery_intent',
      params,
      clientSequence: 0,
      arrivalMs: 0,
      decisionSource: 'LIVE',
    });
    expect(submitted.ok).toBe(true);
    for (let n = 0; n < 8; n += 1) tick(runtime);
    const after = runtime.levyBlockFor(payer, runtime.engine.tick);
    expect(after?.paid, 'one run is a fifth of the bill; the order paid it ALL, a run per tick').toBe(owed);
    expect(Number(after?.paid)).toBeGreaterThan(amount);
  });
});
