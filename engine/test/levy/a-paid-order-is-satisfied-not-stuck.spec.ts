/**
 * ★ A LEVY ORDER THAT HAS PAID IS SATISFIED, NOT STUCK — and since `RULES_VERSION` 41 the RECORD says so,
 * not only the text.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A blind playtest set the Levy standing order its menu offered, paid the bill, and then watched
 * `briefing.corrections[]` carry *"this assessment is already discharged in full"* with `repeats`
 * climbing to 129 — while `agent.md` §13 said a non-zero `repeats` means the intent is STUCK. The
 * launch quickfix changed the WORDS: the refusal, §13 and the affordance were taught to say "satisfied,
 * not stuck". The world still ran the order, refused it, counted a refusal and posted a correction
 * every tick.
 *
 * Season 1 changes the world instead. The engine asks the owning module, before running a due intent,
 * whether it has anything to do (`Runtime.intentSatisfaction`); a paid bill answers no, and the run is
 * recorded as `satisfied` on the intent — no run, no refusal, no correction, no action-log row. The
 * order stays armed and pays the next Reckoning's bill, which is what makes the Levy payable while
 * offline (PROP-LV5).
 * ══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import { buildObservation } from '../../src/api/index.js';
import { INTENT_SATISFIED_STATEMENT, INTENT_STOP_STATEMENT } from '../../src/tick/index.js';
import { levyWorld, submit, tick, walkToPlace } from './fixture.js';

const AGENT_MD = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');

function observe(runtime: Parameters<typeof buildObservation>[0]['runtime'], principal: Parameters<typeof buildObservation>[0]['principal']): ReturnType<typeof buildObservation> {
  return buildObservation({
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 16,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  });
}

describe('a Levy standing order after the bill is paid', () => {
  it('★ is SATISFIED on its own row, posts no correction, and keeps paying the next bill', () => {
    const world = levyWorld('order-satisfied', 2, 1);
    const runtime = world.runtime;
    const payer = world.principals[0];
    if (payer === undefined) throw new Error('fixture');
    tick(runtime);
    walkToPlace(runtime, payer);
    // Arrival is not presence: one more tick and the hand standing there can hand goods over.
    tick(runtime);

    // The order exactly as the menu offers it — copied, not composed.
    const offer = observe(runtime, payer).affordances.find(
      (a) => a.verb === 'set_delivery_intent' && (a.params as Record<string, unknown>)['obligation'] === 'LEVY',
    );
    expect(offer, 'non-vacuity: the standing order must be on the menu').toBeDefined();
    if (offer === undefined) return;
    expect(offer.what_it_forecloses, 'a second send ADDS an order; it never replaced one').toContain(
      'ADDS a second order',
    );
    expect(offer.what_it_forecloses, 'and the menu says how a paid order reads now').toContain('SATISFIED');
    submit(runtime, payer, 'set_delivery_intent', offer.params);
    for (let i = 0; i < 20; i += 1) tick(runtime);

    expect(runtime.levyBlockFor(payer, runtime.engine.tick)?.shortfall_if_unpaid, 'non-vacuity: it paid').toBe(0);
    const intent = runtime.engine.intents.liveFor(payer).find((i) => i.verb === 'deliver');
    expect(intent, 'the order is still armed').toBeDefined();
    if (intent === undefined) return;
    expect(intent.runs, 'it ran exactly once, to pay').toBe(1);
    expect(intent.satisfied, 'and was satisfied on the ticks after, rather than refused').toBeGreaterThan(5);
    expect(intent.refusals, 'REGRESSION: a paid order was counted as refused').toBe(0);
    expect(
      runtime.peekCorrections(payer).filter((c) => c.verb === 'deliver'),
      'REGRESSION: a paid order posted a correction — the stuck-looking flood',
    ).toHaveLength(0);

    // The row an agent reads.
    const rows = (observe(runtime, payer).obligations as Record<string, unknown>)['intents'] as Record<
      string,
      unknown
    >[];
    const row = rows.find((r) => r['id'] === intent.id);
    expect(row?.['status']).toBe('SATISFIED');
    expect(String(row?.['now'])).toContain('discharged in full');

    // The world: the same order pays the NEXT Reckoning's bill, through the free path.
    while (runtime.engine.tick < TICKS_PER_RECKONING + 12) tick(runtime);
    const paidBy = runtime.events
      .ticks()
      .flatMap((t) => runtime.events.eventsAtTick(t))
      .map((r) => r.event)
      .filter((e) => e.kind === 'levy.delivered' && e.actorPrincipalId === payer && e.decisionSource === 'INTENT');
    expect(paidBy.length, 'it paid tonight and it paid tomorrow — an armed order, not a stuck one').toBe(2);
    expect(runtime.engine.intents.get(intent.id)?.runs).toBe(2);
  }, 120_000);

  it('§9 and §13 say it in the engine’s own words, and §13 offers the door that now exists', () => {
    const normalised = AGENT_MD.replace(/\n> ?/g, ' ').replace(/[ \t]+/g, ' ');
    expect(normalised).toContain(INTENT_SATISFIED_STATEMENT.replace(/[ \t]+/g, ' '));
    expect(normalised).toContain(INTENT_STOP_STATEMENT.replace(/[ \t]+/g, ' '));
    const s13 = AGENT_MD.slice(AGENT_MD.indexOf('## 13. When something seems wrong'));
    expect(s13).toContain('A satisfied order never appears here.');
    expect(s13).toContain('set_delivery_intent {"stop": "<intent id>"}');
    expect(s13, 'the sentence that sent agents nowhere').not.toContain('There is no verb');
    expect(s13).toContain('not\n  necessarily consecutive');
  });
});
