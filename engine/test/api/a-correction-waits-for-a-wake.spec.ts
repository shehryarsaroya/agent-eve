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
import { PATHS, agent, enrol, harness, signed, tick, type Harness } from './harness.js';

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
