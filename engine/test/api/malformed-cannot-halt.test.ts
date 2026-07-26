/**
 * CAN AN ORDINARY AGENT HALT THE SHARED WORLD?
 *
 * A probe agent playing the A6 loop found the local world `PAUSED` at tick 1281 — an invariant
 * failed and the tick aborted. Halting is *correct* on assertion failure ("never publish a broken
 * tick"), so the halt itself is not the defect. The question the probe could not answer is whether
 * its own input caused it: the last two actions it sent were deliberate edge-case probes, a `move`
 * to a system that does not exist and an `elect` with required fields missing, and BOTH came back
 * `accepted` from `/act` rather than refused.
 *
 * If either can halt the world, then one malformed request from any enrolled agent is a denial of
 * service on a single shared galaxy that then needs a human to resume it. That would outrank every
 * other open item, so it gets a test rather than an opinion.
 *
 * `accepted` at the wire is expected and is not itself the bug: `/act` accepts an action for
 * SUBMISSION into tick T+1, and the verdict arrives a tick later in `briefing.corrections[]`. What
 * must be true is that the refusal happens in the verb handler — a `reject(...)` that costs the
 * agent its action — and never in an invariant assertion at tick close.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PATHS, agent, enrol, harness, signed, type Agent, type Harness } from './harness.js';

type Row = Record<string, unknown>;
let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'malformed-cannot-halt' });
});
afterEach(async () => {
  await h.close();
});

async function observe(who: Agent): Promise<Row> {
  const res = await signed(h, who, 'GET', PATHS.observe);
  expect(res.status, res.text.slice(0, 300)).toBe(200);
  return res.json['observation'] as Row;
}

/** Runs ticks WITHOUT the harness's own halt assertion, so a halt is observed rather than thrown. */
function runRaw(n: number): { halted: boolean; detail: string } {
  for (let i = 0; i < n; i += 1) {
    const r = h.runtime.runTick();
    if (r.halted) {
      return {
        halted: true,
        detail: r.violations.map((v) => `${v.id} ${v.message}`).join(' | ').slice(0, 400),
      };
    }
  }
  return { halted: false, detail: '' };
}

/** Every malformed shape the probe sent, plus the neighbours a fuzzer would reach next. */
const MALFORMED: readonly (readonly [string, Row])[] = [
  ['move', { hand: 'hand:does-not-exist', to: 'sys-999' }],
  ['move', { to: 'sys-999' }],
  ['move', {}],
  ['elect', {}],
  ['elect', { venture: 'v:nope', role: 0 }],
  ['elect', { venture: 'v:nope' }],
  ['deliver', { obligation: 'LEVY', amount: -5 }],
  ['deliver', { obligation: 'NOT_A_DUTY', amount: 1 }],
  ['build', { kind: 'NOT_A_KIND', system: 'sys-999' }],
  ['grant', { to: 'p:nobody', expires_tick: -1 }],
  ['vote', { ballot: 'LEVY', rule: 'NOT_A_RULE' }],
  ['sign', { venture: 'v:nope', terms_hash: 'deadbeef', your_take_at_p50: -1 }],
  ['fill_role', { venture: 'v:nope', role: 999_999, hand: 'x', stake: -1 }],
  ['seal', { verb: 'deliver', target: 'v:nope', measure: 'NOPE', outcome_low: 5, outcome_high: 1 }],
];

describe('a malformed action costs the agent its action, never the world', () => {
  it('survives every shape the probe sent, and the neighbours of each', async () => {
    const who = agent('fuzzer');
    expect((await enrol(h, who)).status).toBe(201);
    expect(runRaw(2).halted).toBe(false);

    let seq = 1;
    for (const [verb, params] of MALFORMED) {
      const res = await signed(h, who, 'POST', PATHS.act, {
        actions: [{ verb, params, clientSequence: seq }],
      });
      seq += 1;
      // The wire may accept it for submission — that is the documented contract and not the bug.
      expect([200, 400, 422]).toContain(res.status);
      const outcome = runRaw(2);
      expect(
        outcome.halted,
        `\`${verb}\` with ${JSON.stringify(params)} HALTED THE WORLD. One malformed request from any ` +
          `enrolled agent would then stop a single shared galaxy until an operator resumes it. ` +
          `A malformed action must be refused in the handler, not caught by an assertion at tick ` +
          `close. Violations: ${outcome.detail}`,
      ).toBe(false);
    }

    // Still RUNNING, still serving, and the agent is still playable — not merely un-halted.
    expect(h.runtime.engine.status).toBe('RUNNING');
    const after = await observe(who);
    expect((after['affordances'] as readonly unknown[]).length).toBeGreaterThan(0);
  });

  it('and all of them in ONE batch, which is the shape a real fuzzer sends', async () => {
    // Submitted together they share a tick, so any cross-action interference lands here rather
    // than being smoothed out by a tick between each.
    const who = agent('batch-fuzzer');
    expect((await enrol(h, who)).status).toBe(201);
    expect(runRaw(2).halted).toBe(false);

    // MAX_ACTIONS_PER_BATCH is 8, so this goes in chunks rather than as one oversized batch.
    for (let i = 0; i < MALFORMED.length; i += 6) {
      const chunk = MALFORMED.slice(i, i + 6);
      const res = await signed(h, who, 'POST', PATHS.act, {
        actions: chunk.map(([verb, params], k) => ({ verb, params, clientSequence: i + k + 1 })),
      });
      expect([200, 400, 422]).toContain(res.status);
      const outcome = runRaw(2);
      expect(
        outcome.halted,
        `a batch of malformed actions halted the world: ${outcome.detail}`,
      ).toBe(false);
    }
    expect(h.runtime.engine.status).toBe('RUNNING');
  });
});
