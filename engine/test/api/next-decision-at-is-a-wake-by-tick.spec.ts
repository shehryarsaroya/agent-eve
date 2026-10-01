/**
 * ★ `header.next_decision_at` IS THE TICK TO BE AWAKE BY — and following it never makes you late.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The landing page's paste block told every newcomer to *"Wake every ~20 minutes"*. The budget is
 * `WAKES_PER_RECKONING` 16 over `TICKS_PER_RECKONING` 288 five-minute ticks — one wake per 90 minutes —
 * so that advice spent a whole Reckoning's pool in about five hours and left the agent blind for the
 * rest of the day, including the Reckoning itself. The paste block and `agent.md` §5 now say: **sleep
 * until `header.next_decision_at`, or ~18 ticks if that is further off.**
 *
 * That advice is only as good as the field, and the field as shipped named the tick something
 * CHANGED rather than the last tick you could act on it:
 *
 *   - for a FORMING venture it published `windowClosesTick` itself. A `sign` sent while the payload
 *     reads that tick resolves one tick later, `activate` refuses (`tick > windowClosesTick`), and the
 *     formation is retired ABANDONED in the same tick — the clock pointed one tick past the last
 *     useful one;
 *   - by default it published the SETTLEMENT tick, which is after the freeze — a wake there can no
 *     longer `elect`, `seal` or deliver anything for tonight.
 *
 * So the field now carries, for each source, the last OBSERVATION tick from which an act still lands.
 * Both halves are driven below: the arithmetic, and a formation that binds when its parties sign at
 * exactly `next_decision_at` — with the old value kept as the mutation, shown to retire the venture.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { afterEach, describe, expect, it } from 'vitest';
import { WAKES_PER_RECKONING, inFreeze, isSettlementTick, TICKS_PER_RECKONING } from '../../src/core/time.js';
import { buildObservation } from '../../src/api/index.js';
import { handsOf } from '../../src/world/index.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from './harness.js';

type Row = Record<string, unknown>;

let h: Harness;

afterEach(async () => {
  await h.close();
});

function obs(body: Record<string, unknown>): Row {
  return body['observation'] as Row;
}

function decisionOf(o: Row): number {
  return Number((o['header'] as Row)['next_decision_at']);
}

function affordance(o: Row, verb: string, venture?: string): Row | undefined {
  return (o['affordances'] as Row[]).find(
    (a) => a['verb'] === verb && (venture === undefined || (a['params'] as Row)['venture'] === venture),
  );
}

/** The observation the API would serve, with no wake accounting. */
function direct(who: Agent): Row {
  return buildObservation({
    runtime: h.runtime,
    principal: who.principalId as never,
    serverNowMs: h.clock.nowMs(),
    fresh: true,
    wakesRemaining: WAKES_PER_RECKONING,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  }) as unknown as Row;
}

async function act(who: Agent, verb: string, params: unknown): Promise<void> {
  const res = await signed(h, who, 'POST', PATHS.act, { actions: [{ verb, params, clientSequence: 1 }] });
  expect(res.status, res.text.slice(0, 400)).toBe(200);
  const outcome = res.json['outcome'] as Row;
  expect(outcome['corrections'], `${verb} was corrected: ${JSON.stringify(outcome['corrections'])}`).toEqual([]);
}

/** Every hand of `who` standing idle and present at `system` now — what `resolveArrival` writes. */
function bring(who: Agent, system: string): void {
  for (const hand of handsOf(h.runtime.world, who.principalId as never)) {
    hand.location = system as never;
    hand.destination = null;
    hand.state = 'IDLE';
    hand.presentSinceTick = h.runtime.engine.tick;
  }
}

/** A creator-signed venture with both roles filled by two other principals who have NOT signed. */
async function filledUnsigned(): Promise<{ readonly venture: string; readonly fillers: readonly Agent[] }> {
  const creator = agent('nd-maker');
  expect((await enrol(h, creator)).status).toBe(201);
  tick(h, 1);
  const first = obs((await signed(h, creator, 'GET', PATHS.observe)).json);
  const create = affordance(first, 'create');
  expect(create, 'non-vacuity: create must be on a newcomer’s menu').toBeDefined();
  await act(creator, 'create', create?.['params']);
  tick(h, 1);
  const second = obs((await signed(h, creator, 'GET', PATHS.observe)).json);
  // ★ `RULES_VERSION` 41: the creator's `create` IS its countersignature, so it is offered no `sign`
  // and owes no wake inside the window. The venture is read off its own `ventures.mine[]` row.
  expect(affordance(second, 'sign'), 'a creator is never offered a sign on its own venture').toBeUndefined();
  const mineRows = ((second['ventures'] as Row)['mine'] ?? []) as Row[];
  const venture = String(mineRows[0]?.['id']);
  expect(mineRows[0]?.['i_have_signed'], 'the create signed it').toBe(true);
  tick(h, 1);

  const record = h.runtime.ventures.get(venture as never);
  expect(record?.state).toBe('FORMING');
  const fillers = [agent('nd-sarn'), agent('nd-brixe')];
  for (const f of fillers) expect((await enrol(h, f)).status).toBe(201);
  tick(h, 1);
  for (const f of fillers) {
    bring(f, String(record?.stage));
    const o = obs((await signed(h, f, 'GET', PATHS.observe)).json);
    const fill = affordance(o, 'fill_role', venture);
    expect(fill, 'non-vacuity: the filler must be offered the open role').toBeDefined();
    await act(f, 'fill_role', fill?.['params']);
    tick(h, 1);
  }
  expect(record?.roles.every((r) => r.filledByPrincipal !== null), 'both roles must be filled').toBe(true);
  return { venture, fillers };
}

describe('the default: the coming freeze, stated as the last tick you can still act', () => {
  it('names the last observation tick whose acts resolve OUTSIDE the freeze', async () => {
    h = await harness({ seed: 'nd-freeze' });
    const who = agent('nd-idle');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 2);
    const now = h.runtime.engine.tick;
    const at = decisionOf(direct(who));
    expect(at).toBeGreaterThanOrEqual(now);
    // What you send at tick T resolves at T+1, and `Runtime.committing` / `SealBook.commit` / `vElect`
    // refuse anything that resolves inside the freeze or on the settlement tick.
    expect(inFreeze(at + 1) || isSettlementTick(at + 1), 'an act sent AT next_decision_at must still land').toBe(false);
    expect(inFreeze(at + 2), 'and it must be the LAST such tick: one later resolves in the freeze').toBe(true);
    // The old value was the settlement tick itself, two ticks into the past of every useful act.
    expect(isSettlementTick(at)).toBe(false);
  });

  it('rolls to the next Reckoning once tonight’s last useful tick has passed, rather than reading "now"', async () => {
    // Inside the freeze there is nothing left to decide about tonight. A deadline equal to the current
    // tick would tell a pacing agent to spend a wake on each of those ticks.
    h = await harness({ seed: 'nd-roll', startTick: TICKS_PER_RECKONING - 4 });
    const who = agent('nd-late');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 2);
    const now = h.runtime.engine.tick;
    expect(inFreeze(now + 1) || inFreeze(now) || isSettlementTick(now + 1), 'non-vacuity: we must be past the deadline').toBe(true);
    const at = decisionOf(direct(who));
    expect(at, 'never earlier than the payload’s own tick (PROP-O8)').toBeGreaterThanOrEqual(now);
    expect(at - now, 'it must point at tomorrow’s deadline, not at the current tick').toBeGreaterThan(TICKS_PER_RECKONING / 2);
    expect(inFreeze(at + 2)).toBe(true);
  });
});

describe('a formation window: one before window_closes_tick, because a sign resolves next tick', () => {
  it('★ fillers that sleep until next_decision_at and sign THEN bind the venture', async () => {
    h = await harness({ seed: 'nd-window' });
    const { venture, fillers } = await filledUnsigned();
    const record = h.runtime.ventures.get(venture as never);
    const closes = Number(record?.windowClosesTick);

    for (const f of fillers) {
      const at = decisionOf(direct(f));
      expect(at, 'the window must be the soonest thing on this filler’s clock').toBe(closes - 1);
    }
    // Sleep until it, exactly as `agent.md` §5 now says to.
    while (h.runtime.engine.tick < closes - 1) tick(h, 1);
    for (const f of fillers) {
      const o = obs((await signed(h, f, 'GET', PATHS.observe)).json);
      expect(decisionOf(o), 'still the same tick when the agent wakes on it').toBe(h.runtime.engine.tick);
      const sign = affordance(o, 'sign', venture);
      expect(sign, 'the filler must be offered the countersignature at its decision tick').toBeDefined();
      await act(f, 'sign', sign?.['params']);
    }
    tick(h, 1);
    expect(record?.state, 'signed at next_decision_at, the venture binds inside its window').toBe('LIVE');
  });

  it('the value the field used to publish — window_closes_tick itself — is one tick too late', async () => {
    // The mutation, kept as a test: an agent that slept until the OLD `next_decision_at` and signed
    // then would have watched its venture retire ABANDONED in the same tick it signed.
    h = await harness({ seed: 'nd-window' });
    const { venture, fillers } = await filledUnsigned();
    const record = h.runtime.ventures.get(venture as never);
    const closes = Number(record?.windowClosesTick);
    while (h.runtime.engine.tick < closes) tick(h, 1);
    for (const f of fillers) {
      const o = obs((await signed(h, f, 'GET', PATHS.observe)).json);
      const sign = affordance(o, 'sign', venture);
      if (sign !== undefined) await act(f, 'sign', sign['params']);
    }
    tick(h, 1);
    expect(record?.state, 'a sign sent at window_closes_tick resolves after it').toBe('ABANDONED');
  });
});
