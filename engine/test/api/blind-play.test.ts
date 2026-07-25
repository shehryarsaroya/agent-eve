/**
 * §16 step 7 / AGT-S1 — a scripted agent plays 200 ticks from `agent.md` alone
 * with zero 4xx and zero 5xx.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **The scripted agent below is written from `agent.md` and nothing else.**
 *
 * That constraint is the whole test. It follows §1's loop, signs the way §2
 * describes, reads the ten keys §6 names, and only ever submits affordances copied
 * out of `affordances[]` as §12's advice tells it to. It never reads SPEC.md, never
 * guesses a param name, and never uses a verb it was not offered.
 *
 * If it takes a 4xx, one of two things is true: the document promised something the
 * server does not do, or the server demands something the document does not mention.
 * **Both are P0 bugs in the agent-facing surface, not in the agent** — that is
 * AGT-S1's own wording, and it is the direct descendant of the bug that made a town
 * save what it voted to drown.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The second assertion is the one that stops this being a false green: **most of
 * what it submits must actually be applied.** A run where every action is silently
 * refused would take zero 4xx and prove nothing at all — the tick fixture's own
 * header warns about exactly this shape.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WAKES_PER_RECKONING } from '../../src/core/time.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { PATHS, agent, harness, publicKeyOf, raw, signed, type Agent, type Harness } from './harness.js';

let h: Harness;

beforeEach(async () => {
  // A cast, so there is somebody to deal with. §15.6: heuristics fill unfilled slots
  // so ventures always resolve, and a scripted agent alone in an empty world has
  // nothing social to do — which would make the test measure the wrong thing.
  h = await harness({ seed: 'blind-play', seats: 32 });
});
afterEach(async () => {
  await h.close();
});

interface Journal {
  readonly statuses: number[];
  readonly reasons: Map<string, number>;
  readonly corrections: Map<string, number>;
  applied: number;
  submitted: number;
  observations: number;
}

/**
 * The scripted agent. Every step cites the section of `agent.md` it came from.
 *
 * It is deliberately a *simple* policy. AGT-S1 is not about playing well; it is
 * about whether a competent reader of one document can play *at all* without ever
 * being punished by the transport.
 */
async function play(
  harnessed: Harness,
  me: Agent,
  ticks: number,
  journal: Journal,
): Promise<void> {
  // §1: "POST /enroll once, to get your identity."
  const enrolled = await raw(
    harnessed,
    'POST',
    PATHS.enroll,
    JSON.stringify({ handle: me.handle, publicKey: publicKeyOf(me) }),
    { 'content-type': 'application/json' },
  );
  journal.statuses.push(enrolled.status);
  if (enrolled.status !== 201) {
    journal.reasons.set(String(enrolled.json['reason']), 1);
    return;
  }
  me.principalId = String(enrolled.json['principalId']);

  for (let n = 0; n < ticks; n += 1) {
    // §7: "16 wakes per day — outside a wake, observe returns a cached snapshot with
    // no fresh affordances." So read only when a wake is worth spending, and read the
    // budget out of the header rather than counting locally.
    const read = await signed(harnessed, me, 'GET', PATHS.observe);
    journal.statuses.push(read.status);
    journal.observations += 1;
    if (read.status !== 200) {
      journal.reasons.set(String(read.json['reason']), (journal.reasons.get(String(read.json['reason'])) ?? 0) + 1);
      break;
    }

    const observation = read.json['observation'] as Record<string, unknown>;
    const header = observation['header'] as Record<string, unknown>;
    const affordances = observation['affordances'] as Record<string, unknown>[];

    // §13: "This document disagreeing with the server" is worth reporting. A scripted
    // agent that finds an affordance missing its cost has found exactly that.
    for (const affordance of affordances) {
      if (affordance['max_direct_loss'] === undefined || affordance['quote_id'] === undefined) {
        const told = await signed(harnessed, me, 'POST', PATHS.discrepancy, {
          expected: 'every affordance carries cost, max_direct_loss and quote_id (agent.md §6)',
          observed: `an affordance for '${String(affordance['verb'])}' did not`,
        });
        journal.statuses.push(told.status);
      }
    }

    // §12.3: "Check max_direct_loss on every affordance before acting." Prefer the
    // things that build standing, then anything free, then anything at all.
    const preference = ['sign', 'seal', 'fill_role', 'create', 'publish_offer', 'move', 'claim'];
    const chosen: Record<string, unknown>[] = [];
    for (const verb of preference) {
      const candidate = affordances.find((x) => x['verb'] === verb);
      if (candidate === undefined) continue;
      // §12.3 again: never take an act whose worst case is unknown.
      if (!Number.isInteger(candidate['max_direct_loss'])) continue;
      chosen.push(candidate);
      // §7: four material actions per tick. Stay inside the budget the header states
      // rather than assuming the number.
      if (chosen.length >= Math.max(1, Number(header['actions_remaining']))) break;
    }

    if (chosen.length > 0) {
      // §7: "POST /act { actions: [...], idempotencyKey, expectedStateVersion }".
      const acted = await signed(harnessed, me, 'POST', PATHS.act, {
        actions: chosen.map((affordance, index) => ({
          verb: affordance['verb'],
          params: affordance['params'],
          clientSequence: index + 1,
        })),
        idempotencyKey: `${me.handle}-${String(n)}`,
        expectedStateVersion: header['state_version'],
      });
      journal.statuses.push(acted.status);
      journal.submitted += chosen.length;
      if (acted.status !== 200) {
        journal.reasons.set(String(acted.json['reason']), (journal.reasons.get(String(acted.json['reason'])) ?? 0) + 1);
        break;
      }
      const outcome = acted.json['outcome'] as Record<string, unknown>;
      journal.applied += (outcome['accepted'] as unknown[]).length;
      for (const correction of outcome['corrections'] as Record<string, unknown>[]) {
        const key = `${String(correction['verb'])} ${String(correction['invariant'])}`;
        journal.corrections.set(key, (journal.corrections.get(key) ?? 0) + 1);
      }
      // §6: the delivered-later corrections, read out of briefing so a repeated
      // rejection reason shows up as a rules-surface defect (AGT-S3).
      const observed = acted.json['observation'] as Record<string, unknown>;
      const briefing = observed['briefing'] as Record<string, unknown>;
      for (const correction of (briefing['corrections'] ?? []) as Record<string, unknown>[]) {
        const key = `${String(correction['verb'])} ${String(correction['invariant'])}`;
        journal.corrections.set(key, (journal.corrections.get(key) ?? 0) + 1);
      }
    }

    // The world advances. An agent does not do this; the sim does. Here the test is
    // the scheduler.
    harnessed.runtime.runTick();
  }
}

describe('AGT-S1 / §16 step 7 — the blind-play gate', () => {
  it('plays 200 ticks from agent.md alone with zero 4xx and zero 5xx', async () => {
    const cast = new HeuristicCast(h.runtime, { size: 8 });
    cast.seat('blind-play');

    const journal: Journal = {
      statuses: [],
      reasons: new Map(),
      corrections: new Map(),
      applied: 0,
      submitted: 0,
      observations: 0,
    };
    const me = agent('probe');

    // The cast plays alongside, so the board has ventures on it.
    const original = h.runtime.runTick.bind(h.runtime);
    h.runtime.runTick = (): ReturnType<typeof original> => {
      for (const action of cast.decide(h.runtime.engine.tick + 1, 'blind-play')) {
        h.runtime.engine.submit(action);
      }
      return original();
    };

    await play(h, me, 200, journal);

    const bad = journal.statuses.filter((s) => s >= 400);
    expect(
      bad,
      `4xx/5xx seen: ${JSON.stringify([...journal.reasons])}. Per AGT-S1 this is a P0 in the agent-facing surface, not in the agent.`,
    ).toEqual([]);

    // ── The anti-false-green clause ────────────────────────────────────────
    //
    // A run where every action was refused would also have taken zero 4xx, and the
    // tick fixture's own header warns about exactly that shape. So the test asserts
    // that the agent really played.
    //
    // The numbers are bounded by the design, not by the agent's appetite: §12.4 gives
    // 16 wakes per Reckoning and 200 ticks is less than one Reckoning, so a
    // well-behaved reader of agent.md gets 16 useful observations and acts on each.
    // That is the guarantee working, not the agent underperforming — and asserting the
    // *floor* rather than a ratio alone is what stops a regression that quietly stops
    // serving affordances from passing.
    expect(journal.observations).toBe(200);
    expect(journal.submitted).toBeGreaterThanOrEqual(WAKES_PER_RECKONING);
    expect(journal.applied).toBeGreaterThanOrEqual(WAKES_PER_RECKONING);
    expect(journal.applied / journal.submitted).toBeGreaterThan(0.9);

    // AGT-S3: any rejection reason a probe hits three or more times means the hint is
    // unclear or the affordance is misleading. Treated as a bug queue, not noise.
    const repeated = [...journal.corrections].filter(([, count]) => count >= 3);
    expect(
      repeated,
      'a rejection reason hit 3+ times is a rules-surface defect (AGT-S3), not agent error',
    ).toEqual([]);
  });

  it('reaches a legal first move in one round trip, from the enroll response alone', async () => {
    // High Water's validated pattern #2, and the property that makes a harness need
    // nothing but HTTP (§12.5). The enrolment reply carries a live observation, so the
    // very next call can be a legal act.
    const me = agent('one-trip');
    const enrolled = await raw(
      h,
      'POST',
      PATHS.enroll,
      JSON.stringify({ handle: me.handle, publicKey: publicKeyOf(me) }),
      { 'content-type': 'application/json' },
    );
    expect(enrolled.status).toBe(201);
    me.principalId = String(enrolled.json['principalId']);

    const observation = enrolled.json['observation'] as Record<string, unknown>;
    const affordances = observation['affordances'] as Record<string, unknown>[];
    expect(affordances.length).toBeGreaterThan(0);
    const first = affordances[0];
    const acted = await signed(h, me, 'POST', PATHS.act, {
      actions: [{ verb: first?.['verb'], params: first?.['params'], clientSequence: 1 }],
    });
    expect(acted.status).toBe(200);
    expect((acted.json['outcome'] as Record<string, unknown>)['corrections']).toEqual([]);
  });

  it('tells the agent, at enrolment, which canon verbs are not live yet', async () => {
    // agent.md §7 lists 38 verbs and Phase 0 implements a subset. An agent that has to
    // discover the gap by spending actions on refusals is an agent we misled.
    const enrolled = await raw(
      h,
      'POST',
      PATHS.enroll,
      JSON.stringify({ handle: 'reader', publicKey: publicKeyOf(agent('reader')) }),
      { 'content-type': 'application/json' },
    );
    expect(Array.isArray(enrolled.json['liveVerbs'])).toBe(true);
    expect(Array.isArray(enrolled.json['notYetLive'])).toBe(true);
    expect(enrolled.json['liveVerbs']).toContain('create');
    expect(enrolled.json['notYetLive']).toContain('trade');
    // And it says how to sign, so §2 is actionable without a second document.
    const signing = enrolled.json['signing'] as Record<string, unknown>;
    expect(signing['algorithm']).toBe('ed25519');
    expect(signing['coveredComponents']).toContain('content-digest');
  });

  it('spends no more than the stated wake budget in a Reckoning', async () => {
    // §12.4 is a cost guarantee to the owner as much as an A4 rule. If the server
    // handed out more fresh observations than it said, the guarantee would be a
    // marketing claim rather than a bound.
    const me = agent('frugal');
    const enrolled = await raw(
      h,
      'POST',
      PATHS.enroll,
      JSON.stringify({ handle: me.handle, publicKey: publicKeyOf(me) }),
      { 'content-type': 'application/json' },
    );
    expect(enrolled.status).toBe(201);
    me.principalId = String(enrolled.json['principalId']);

    for (let n = 0; n < 40; n += 1) {
      const read = await signed(h, me, 'GET', PATHS.observe);
      expect(read.status).toBe(200);
      h.runtime.runTick();
    }
    // The enrolment reply carried one observation and the loop asked for 40 more, all
    // inside one Reckoning. The budget is what the header promised.
    expect(h.context.wakesSpent(me.principalId as never)).toBeLessThanOrEqual(WAKES_PER_RECKONING);
  });
});
