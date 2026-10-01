/**
 * ★ A LEVY ORDER THAT HAS PAID IS SATISFIED, NOT STUCK — and the surfaces now say so.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A blind playtest set the Levy standing order its menu offered, paid the bill, and then watched
 * `briefing.corrections[]` carry *"this assessment is already discharged in full"* with `repeats`
 * climbing to 129 — while `agent.md` §13 said a non-zero `repeats` means the intent is STUCK and to
 * "stop the intent rather than wait for it". Following that would have meant abandoning the order that
 * pays the next Reckoning's bill, and it could not be followed anyway: no verb withdraws an intent.
 *
 * The order is SUPPOSED to keep running — it stays armed across Reckonings, which is what makes the
 * Levy payable while offline (PROP-LV5). So the world is unchanged here and asserted unchanged; what
 * changed is the text: the refusal, §13, and the affordance (which said a second send would "replace"
 * the order, and in fact adds one).
 * ══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import { buildObservation } from '../../src/api/index.js';
import { levyWorld, submit, tick, walkToPlace } from './fixture.js';

const AGENT_MD = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');

describe('a Levy standing order after the bill is paid', () => {
  it('★ reads as satisfied in the correction an agent is handed, and keeps paying the next bill', () => {
    const world = levyWorld('order-satisfied', 2, 1);
    const runtime = world.runtime;
    const payer = world.principals[0];
    if (payer === undefined) throw new Error('fixture');
    tick(runtime);
    walkToPlace(runtime, payer);
    // Arrival is not presence: one more tick and the hand standing there can hand goods over.
    tick(runtime);

    // The order exactly as the menu offers it — copied, not composed.
    const offer = buildObservation({
      runtime,
      principal: payer,
      serverNowMs: 0,
      fresh: true,
      wakesRemaining: 16,
      stale: false,
      corrections: [],
      correctionsDropped: 0,
      actionsRemaining: 4,
    }).affordances.find((a) => a.verb === 'set_delivery_intent');
    expect(offer, 'non-vacuity: the standing order must be on the menu').toBeDefined();
    if (offer === undefined) return;
    expect(offer.what_it_forecloses, 'a second send ADDS an order; it never replaced one').toContain(
      'ADDS a second order',
    );
    expect(offer.what_it_forecloses).not.toContain('replace this one');
    submit(runtime, payer, 'set_delivery_intent', offer.params);
    for (let i = 0; i < 20; i += 1) tick(runtime);

    expect(runtime.levyBlockFor(payer, runtime.engine.tick)?.shortfall_if_unpaid, 'non-vacuity: it paid').toBe(0);
    const rows = runtime.peekCorrections(payer).filter((c) => c.verb === 'deliver');
    expect(rows.length, 'one collapsed row, not one per tick').toBe(1);
    const row = rows[0];
    expect(row?.repeats, 'non-vacuity: the order kept meeting the same answer').toBeGreaterThan(5);
    expect(row?.hint, 'the matching key is kept verbatim').toContain('already discharged in full');
    expect(row?.hint, 'and the row says what that means').toContain('satisfied, not stuck');

    // The world is unchanged: the same order pays the NEXT Reckoning's bill, through the free path.
    while (runtime.engine.tick < TICKS_PER_RECKONING + 12) tick(runtime);
    const paidBy = runtime.events
      .ticks()
      .flatMap((t) => runtime.events.eventsAtTick(t))
      .map((r) => r.event)
      .filter((e) => e.kind === 'levy.delivered' && e.actorPrincipalId === payer && e.decisionSource === 'INTENT');
    expect(paidBy.length, 'it paid tonight and it paid tomorrow — an armed order, not a stuck one').toBe(2);
  }, 120_000);

  it('§13 carves the satisfied case out of "stuck", and stops telling agents to use a verb that does not exist', () => {
    const s13 = AGENT_MD.slice(AGENT_MD.indexOf('## 13. When something seems wrong'));
    expect(s13).toContain('*"already discharged in full"* is SATISFIED, not stuck');
    expect(s13).toContain('There is no verb\n    that withdraws an intent');
    expect(s13, 'the instruction that could not be followed').not.toContain('stop the intent rather than wait');
    expect(s13).toContain('not\n  necessarily consecutive');
  });
});
