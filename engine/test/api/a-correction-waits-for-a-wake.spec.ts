/**
 * A VERDICT MUST NOT BE CONSUMED BY A POLL THE AGENT MADE FOR SOME OTHER REASON.
 *
 * `Runtime.takeCorrections` **drains** — "Draining, not peeking" — which is what keeps the buffer
 * bounded in practice. The server then called it on every `GET /observe` that crossed a tick,
 * regardless of whether the agent actually got a wake.
 *
 * A blind probe found the consequence and described it better than the code did. It burned 62% of a
 * Reckoning's wakes calibrating the tick length (which `agent.md` does not state), then reported that
 * refused actions produced **no correction at all** — that `accepted` came back for an action that
 * silently did nothing and no verdict ever arrived. The channel was working fine. Its verdicts had
 * been drained into `fresh: false` observations it had every reason to discount as stale.
 *
 * Its own summary is the reason this matters more here than in most games:
 *
 *   *"A stuck agent retries. A confidently-wrong agent makes commitments — and this game's entire
 *   proposition is that its record of who kept their word is trustworthy."*
 *
 * So the drain is tied to the wake. An agent that has not woken keeps its corrections, bounded by
 * `MAX_PENDING_CORRECTIONS`, which is exactly what the ring was built for.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_PENDING_CORRECTIONS } from '../../src/sim/runtime.js';
import { PATHS, agent, enrol, harness, signed, tick, type Harness } from './harness.js';

/** DET-1: a bare `.sort()` is banned, so string comparison is explicit. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

let open: Harness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

/** The observation body from a signed GET, unwrapped. */
async function observeAs(h: Harness, who: ReturnType<typeof agent>): Promise<Record<string, unknown>> {
  const res = await signed(h, who, 'GET', PATHS.observe);
  return (res.json as { observation: Record<string, unknown> }).observation;
}

describe('a refusal is delivered into a wake, not into whatever poll happens next', () => {
  it('the drain is tied to the wake, at the call site', () => {
    // Asserted at SOURCE level, and the reason is that the harness cannot reach the state that matters:
    // its wake limits are "effectively unlimited by default: a limiter is tested on purpose, not by
    // accident", so `fresh: false` never occurs there and a behavioural test would pass vacuously
    // forever. The condition under test is one argument, and one argument is exactly what a source
    // check can pin without pretending to be an integration test.
    const src = readFileSync(fileURLToPath(new URL('../../src/api/server.ts', import.meta.url)), 'utf8');
    expect(
      src,
      'GET /observe must pass `fresh` as the drain flag. Draining on every observe lets a verdict be ' +
        'consumed by a poll the agent made for another reason — and the reliable way that happens is ' +
        'an agent out of wakes, whose response comes back `fresh: false` and is reasonably discounted ' +
        'as stale. The correction is then gone and the next real wake shows `corrections: []`.',
    ).toContain('observe(who, fresh, fresh)');
  });

  it('and the verdict is not lost — a fresh wake still carries it', async () => {
    // The other half. Holding corrections back is only correct if they are still delivered; a fix that
    // merely stopped draining would have turned a lost verdict into a permanently withheld one, which
    // is the same failure with a longer fuse.
    const h = await harness({ seed: 'correction-delivered' });
    open = h;
    const who = agent('probe-delivery');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    await observeAs(h, who);

    await signed(h, who, 'POST', PATHS.act, {
      actions: [{ verb: 'refine', params: {}, clientSequence: 7 }],
    });
    tick(h, 1);

    const obs = await observeAs(h, who);
    const briefing = obs['briefing'] as Record<string, unknown>;
    const corrections = (briefing['corrections'] ?? []) as Record<string, unknown>[];
    expect(
      corrections.length,
      'a fresh wake after an in-tick refusal must carry the verdict, or the agent never learns',
    ).toBeGreaterThan(0);
    expect(
      corrections.map((c) => String(c['verb'])),
      'and it must name the verb that was refused',
    ).toContain('refine');
  }, 120_000);
});

/**
 * ★ **ONE ROW PER REFUSED ACTION — THREE IN, THREE OUT.**
 *
 * The test above proves a verdict survives to the next wake. It does **not** prove that *all* of
 * them do, and they did not: `POST /act` attaches an observation to its own response, that
 * observation drained the ring, and `POST /act` is not a wake. So a batch of refusals spread over
 * consecutive ticks arrived one at a time into `fresh: false` payloads and the wake got the last one.
 *
 * Measured from outside on a live turbo world before the fix, and this test is that run:
 *
 *     tick 43 act abandon : accepted=1  nested observation.briefing.corrections=0
 *     tick 44 act withdraw: accepted=1  nested observation.briefing.corrections=1  <- abandon, eaten
 *     tick 45 act graduate: accepted=1  nested observation.briefing.corrections=1  <- withdraw, eaten
 *     === ONE WAKE ===  CORRECTIONS RETURNED: 1   [graduate]
 *
 * Two verdicts gone, and the survivor made the batch read as 2-for-3 successful. §13's promise is
 * *"an accepted no-op with no verdict is the one thing this API promises never to do"* — and this is
 * that, twice, in the channel an agent is told to read when it suspects exactly this.
 *
 * **Why the source-level test above could not catch it.** It pins the argument at ONE call site
 * (`observe(who, fresh, fresh)` in `GET /observe`). The defect was at two OTHER call sites that took
 * a defaulted `drain = true`. A source check on the right line is silent about the lines beside it,
 * which is the general lesson: pin the *property*, not the spelling. The parameter now has no
 * default, so `tsc` enforces at every call site what this test enforces behaviourally.
 */
describe('three refusals in three ticks arrive as three rows', () => {
  it('drops nothing when POST /act is the only traffic between them', async () => {
    const h = await harness({ seed: 'corrections-batch' });
    open = h;
    const who = agent('probe-batch');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    await observeAs(h, who); // clear anything enrolment left, then never wake again until the end

    // Three verbs that pass `submit` and lose at VALIDATE+LOCK — the only class that CAN be
    // dropped, because a submit-time refusal comes back in `outcome.corrections` immediately.
    const batch = [
      { verb: 'refine', params: {} },
      { verb: 'graduate', params: { system: 'sys-99' } },
      { verb: 'abandon', params: { claim: 'sys-99' } },
    ] as const;

    for (const [index, action] of batch.entries()) {
      const res = await signed(h, who, 'POST', PATHS.act, {
        actions: [{ ...action, clientSequence: 100 + index }],
      });
      const outcome = (res.json as { outcome: { accepted: unknown[]; corrections: unknown[] } }).outcome;
      // ── NON-VACUITY, FIRST ────────────────────────────────────────────────
      //
      // If any of these were refused at SUBMIT the row would never enter the ring, and the test
      // would be asserting that nothing is dropped from a channel nothing was put into — this
      // project's signature failure, in the test written to catch it.
      expect(
        outcome.accepted.length,
        `${action.verb} must be ACCEPTED at submit and refused by the handler, or this test is vacuous: ` +
          `${JSON.stringify(outcome.corrections)}`,
      ).toBe(1);
      // And no wake in between: the whole point is that the agent has not read anything.
      tick(h, 1);
    }

    const briefing = (await observeAs(h, who))['briefing'] as Record<string, unknown>;
    const rows = (briefing['corrections'] ?? []) as Record<string, unknown>[];
    expect(
      rows.map((c) => String(c['verb'])).sort(cmp),
      `one row per refused action (§13). Got ${String(rows.length)}: ${JSON.stringify(rows.map((c) => c['verb']))}`,
    ).toEqual(['abandon', 'graduate', 'refine']);
    // Each row must be matchable to what the agent sent. `clientSequence` is the only key an HTTP
    // agent has — `params` is dropped by `buildObservation` — so if it is wrong the rows are a bag.
    expect(rows.map((c) => Number(c['clientSequence'])).sort((a, b) => a - b)).toEqual([100, 101, 102]);
    expect(briefing['corrections_dropped'], 'nothing hit the ring cap in a batch of three').toBe(0);
  }, 120_000);

  it('a non-wake response reports the pending verdicts without consuming them', async () => {
    // The half a `drain: false` fix alone would have got wrong. Returning `[]` on a non-wake
    // response is §13's forbidden shape one level down: the agent asks, verdicts exist, and the
    // field says none. A peek is honest AND non-destructive, and this pins both halves at once —
    // the act response SEES the row, and the wake afterwards still DELIVERS it.
    const h = await harness({ seed: 'corrections-peek' });
    open = h;
    const who = agent('probe-peek');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    await observeAs(h, who);

    await signed(h, who, 'POST', PATHS.act, {
      actions: [{ verb: 'refine', params: {}, clientSequence: 11 }],
    });
    tick(h, 1);

    // A second, genuinely DIFFERENT act — identical refusals are collapsed on purpose (see the
    // flood test below), so two `refine`s would be one row and this test would be about the dedupe
    // rather than about the peek.
    const second = await signed(h, who, 'POST', PATHS.act, {
      actions: [{ verb: 'graduate', params: { system: 'sys-99' }, clientSequence: 12 }],
    });
    const attached = (second.json as { observation: Record<string, unknown> }).observation;
    const peeked = ((attached['briefing'] as Record<string, unknown>)['corrections'] ?? []) as Record<
      string,
      unknown
    >[];
    expect(
      peeked.map((c) => Number(c['clientSequence'])),
      'POST /act attaches an observation, and an observation that hides a waiting verdict is the bug',
    ).toEqual([11]);

    // …and must not have eaten it. The wake is what delivers — after the second one resolves,
    // since a VALIDATE+LOCK refusal is not knowable until its tick has run.
    tick(h, 1);
    const wake = (await observeAs(h, who))['briefing'] as Record<string, unknown>;
    const delivered = (wake['corrections'] ?? []) as Record<string, unknown>[];
    expect(
      delivered.map((c) => Number(c['clientSequence'])).sort((a, b) => a - b),
      'the peek must consume nothing: the wake still owes both verdicts',
    ).toEqual([11, 12]);

    // Delivered once. A drain that fired twice would let an agent act on one refusal twice.
    tick(h, 1);
    expect(((await observeAs(h, who))['briefing'] as Record<string, unknown>)['corrections']).toEqual([]);
  }, 120_000);

  it('and the ring says how many it threw away, so short is never silent', async () => {
    // `Ring` has counted its drops since it was written and nothing read the counter. It matters
    // more now than before: until this session every `POST /act` emptied the ring, so the cap was
    // effectively unreachable and a test for it would have passed vacuously forever. A bound that
    // drops the row a claim rests on fails in the direction that hides, and this repo has shipped
    // that three times (`MAX_RECKONING_SUMMARIES`, `LEVY_RETAINED_RECKONINGS`, an offer cap).
    const h = await harness({ seed: 'corrections-cap' });
    open = h;
    const who = agent('probe-cap');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    await observeAs(h, who);

    // DISTINCT refusals, one per tick: an identical `(verb, invariant, hint)` is collapsed into one
    // row with a `repeats` count (see the flood test), so sending the same refusal nineteen times
    // would test the dedupe and leave the cap untouched. A nonexistent system id per call puts the
    // id in the hint, which is what makes each row distinct.
    const over = MAX_PENDING_CORRECTIONS + 3;
    for (let i = 0; i < over; i += 1) {
      const res = await signed(h, who, 'POST', PATHS.act, {
        actions: [{ verb: 'graduate', params: { system: `sys-x${String(i)}` }, clientSequence: 500 + i }],
      });
      expect(
        (res.json as { outcome: { accepted: unknown[] } }).outcome.accepted.length,
        'every one must reach the ring, or the cap is never tested',
      ).toBe(1);
      tick(h, 1);
    }

    const briefing = (await observeAs(h, who))['briefing'] as Record<string, unknown>;
    const rows = (briefing['corrections'] ?? []) as Record<string, unknown>[];
    expect(rows.length, 'the ring is bounded (INV-26, scar #3)').toBe(MAX_PENDING_CORRECTIONS);
    expect(
      briefing['corrections_dropped'],
      'and it says how many it lost, so an agent can tell "dropped" from "never recorded"',
    ).toBe(over - MAX_PENDING_CORRECTIONS);
    // FIFO: the oldest go. The surviving window must be the newest, so the agent's most recent
    // mistakes are the ones it is told about.
    expect(Math.min(...rows.map((c) => Number(c['clientSequence'])))).toBe(500 + over - MAX_PENDING_CORRECTIONS);
  }, 180_000);
});

/**
 * ★ **AND THE OTHER FACE OF THE SAME DEFECT: THE FLOOD.**
 *
 * Fixing the drain buys an agent a channel that no longer loses its mail. It does not buy a channel
 * with anything readable in it, and a second probe measured why: a **durable intent** (A3) whose
 * refusal is a *standing condition* is refused on every tick, and every refusal was a fresh row.
 *
 *     set_delivery_intent, 16 identical rows in 16 ticks
 *     A14 — "this assessment is already discharged in full"
 *     nearest_legal: create DIG        (its own report: "neither near nor legal")
 *     world-wide pendingCorrections: 130 across 11 principals
 *
 * A sixteen-slot ring holding sixteen copies of one sentence has lost every real verdict in it, so
 * the drop and the flood are one defect with two symptoms — and a fix for either alone leaves the
 * channel useless. `IntentBook.ran` counts a refused run into `refusals` and deliberately never
 * stops the intent on it, which is correct for a convoy still in transit and is exactly what makes
 * a terminal condition repeat for ever.
 *
 * Collapsed rather than dropped, because *"refused for the same reason on 16 consecutive ticks"* is
 * a **stronger** signal than one refusal — it says stop the intent rather than wait — and it costs
 * one slot.
 */
describe('an identical refusal is one row with a count, not N rows', () => {
  it('collapses a repeated verdict and says how many times it happened', async () => {
    const h = await harness({ seed: 'corrections-flood' });
    open = h;
    const who = agent('probe-flood');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    await observeAs(h, who);

    // The same refusal, six times, one per tick — a hand-driven stand-in for an intent re-firing.
    // Same verb, same params, so the engine produces the same invariant and the same hint.
    const times = 6;
    for (let i = 0; i < times; i += 1) {
      const res = await signed(h, who, 'POST', PATHS.act, {
        actions: [{ verb: 'refine', params: {}, clientSequence: 700 + i }],
      });
      expect(
        (res.json as { outcome: { accepted: unknown[] } }).outcome.accepted.length,
        'each must be accepted at submit and refused by the handler, or nothing reaches the ring',
      ).toBe(1);
      tick(h, 1);
    }

    const briefing = (await observeAs(h, who))['briefing'] as Record<string, unknown>;
    const rows = (briefing['corrections'] ?? []) as Record<string, unknown>[];
    expect(
      rows.length,
      `six copies of one standing condition must occupy ONE slot, not six: ${JSON.stringify(
        rows.map((c) => [c['verb'], c['repeats']]),
      )}`,
    ).toBe(1);
    const row = rows[0];
    expect(row?.['verb']).toBe('refine');
    expect(
      row?.['repeats'],
      'and the count must be the information the collapsed rows carried — a stuck intent, not a busy world',
    ).toBe(times - 1);
    // `tick` is the LATEST occurrence, so "is it still happening?" is answerable and the first of a
    // consecutive run is `tick - repeats`. Measured against the engine's own clock, not a literal.
    expect(Number(row?.['tick']), 'the row must carry the most recent occurrence').toBe(h.runtime.engine.tick);
    expect(Number(row?.['tick']) - Number(row?.['repeats']), 'so the run started here').toBe(
      h.runtime.engine.tick - (times - 1),
    );
    expect(briefing['corrections_dropped'], 'and nothing was dropped: it never filled').toBe(0);
  }, 180_000);

  it('does not collapse two DIFFERENT refusals of the same verb', async () => {
    // The dedupe must not become a second way to lose a verdict. Two `graduate`s naming two
    // different nonexistent systems are two facts, and the hint carries the difference — which is
    // why the key is `(verb, invariant, hint)` and not `verb` alone.
    const h = await harness({ seed: 'corrections-distinct' });
    open = h;
    const who = agent('probe-distinct');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    await observeAs(h, who);

    for (const [i, system] of ['sys-aa', 'sys-bb'].entries()) {
      await signed(h, who, 'POST', PATHS.act, {
        actions: [{ verb: 'graduate', params: { system }, clientSequence: 800 + i }],
      });
      tick(h, 1);
    }

    const rows = (((await observeAs(h, who))['briefing'] as Record<string, unknown>)['corrections'] ??
      []) as Record<string, unknown>[];
    expect(rows.length, 'two distinct refusals of one verb are two rows').toBe(2);
    expect(rows.every((c) => c['repeats'] === 0)).toBe(true);
  }, 180_000);

  it('nearest_legal is null rather than an unrelated affordance', async () => {
    // `?? affordanceSet.list[0]` used to be the last term, so a refused verb with no matching
    // affordance came back pointed at whatever was first in the list — a probe's refused
    // `set_delivery_intent` was answered with `create DIG`. PROP-O7 promises "the nearest LEGAL
    // thing you could do instead", and an unrelated act is worse than an honest null: an agent
    // copies this row.
    const h = await harness({ seed: 'corrections-nearest' });
    open = h;
    const who = agent('probe-nearest');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    const first = await observeAs(h, who);
    const offered = new Set(
      (first['affordances'] as Record<string, unknown>[]).map((a) => String(a['verb'])),
    );
    // NON-VACUITY: this only says anything if `abandon` is genuinely NOT offered — otherwise a
    // matching affordance exists and the fallback was never reached.
    expect(offered.has('abandon'), 'a newcomer holds no claim, so `abandon` must be unoffered').toBe(false);

    await signed(h, who, 'POST', PATHS.act, {
      actions: [{ verb: 'abandon', params: { claim: 'sys-99' }, clientSequence: 900 }],
    });
    tick(h, 1);

    const rows = (((await observeAs(h, who))['briefing'] as Record<string, unknown>)['corrections'] ??
      []) as Record<string, unknown>[];
    const row = rows.find((c) => c['verb'] === 'abandon');
    expect(row, 'the refusal must have arrived').toBeDefined();
    expect(
      row?.['nearest_legal'],
      'no affordance matches the refused verb, so the honest answer is null and not the first row of a list',
    ).toBeNull();
    expect(String(row?.['hint']).length, 'the prose hint still carries the invariant and the fix').toBeGreaterThan(
      20,
    );
  }, 180_000);
});
