/**
 * Does the spend cap cap?
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A CAP THAT UNDER-COUNTS IS NOT A CAP, AND IT FAILS SILENTLY.**
 *
 * `budget.ts` refunds a charge for a call that "provably never reached the provider",
 * and the whole safety of the cumulative cap rests on that phrase being answered
 * correctly. It was originally answered by asking a *different* question — "is there an
 * HTTP status on this error?" — and the two questions disagree on the two most ordinary
 * provider-answered failures there are:
 *
 *   1. **A 200 with no readable content.** OpenAI's refusal shape is
 *      `{choices:[{message:{content:null, refusal:"…"}}]}`, and a proxy or CDN returning
 *      an HTML error page with a 200 is the other. `readReply` raises these, and it
 *      cannot see the response, so it raised them with `status: null`.
 *   2. **A call the cast aborted at its deadline.** Three ticks is 30 s at `fast`; a slow
 *      completion crossing that is routine, and the provider finishes and bills it.
 *
 * Both were refunded. Measured before the fix, through the real `openAiTransport` with an
 * injected `fetch`: **96 provider-answered calls, `spentMicros: 0`, cap never tripped,
 * cast still live.** A world in that state spends without limit and its own report says
 * it has spent nothing.
 *
 * So these tests drive the REAL transport (the network is the only mocked part) and
 * assert on money rather than on plumbing. The two halves are equally load-bearing and
 * pull in opposite directions, which is why the refund cases are here too: a connection
 * that never opened must still be refunded, or a world with no key or no DNS latches its
 * own cap having spent nothing.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import {
  CastBudget,
  CastTransportError,
  createCast,
  openAiTransport,
  type CastTransport,
} from '../../src/cast/index.js';
import { HeuristicCast } from '../../src/cast/heuristic.js';
import { Runtime } from '../../src/sim/runtime.js';
import { MockTransport, harness, stoppedClock } from './mock.js';

/** Assembled at runtime. There is no contiguous credential-shaped literal in this file. */
const FAKE_KEY = ['zz', 'notarealkey', 'forthetestsuite', '00000'].join('-');

/** A cap one honest call nearly exhausts, so "did it trip" is answered in a few ticks. */
const TIGHT = { spendCapMicros: 20_000, callsPerReckoning: 1_000_000 };
/** A cap that cannot bind, for tests that measure the charge rather than the trip. */
const LOOSE = { spendCapMicros: 1_000_000_000, callsPerReckoning: 1_000_000 };

let saved: string | undefined;
beforeEach(() => {
  setSpeed('instant');
  saved = process.env['OPENAI_API_KEY'];
  process.env['OPENAI_API_KEY'] = FAKE_KEY;
});
afterEach(() => {
  if (saved === undefined) delete process.env['OPENAI_API_KEY'];
  else process.env['OPENAI_API_KEY'] = saved;
});

/** The real transport, with only the socket replaced. */
function transportServing(respond: () => Response): { transport: CastTransport; served: () => number } {
  let served = 0;
  const transport = openAiTransport({
    fetchImpl: (() => {
      served += 1;
      return Promise.resolve(respond());
    }) as unknown as typeof fetch,
  });
  return { transport, served: () => served };
}

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('a call the provider ANSWERED is charged, whatever it answered with', () => {
  it("a 200 carrying OpenAI's refusal shape (content: null) trips the cap", async () => {
    // Before the fix: 96 calls served, spentMicros 0, disabled false.
    const { transport, served } = transportServing(() =>
      ok({
        choices: [{ message: { role: 'assistant', content: null, refusal: 'I cannot help.' } }],
        usage: { prompt_tokens: 9_000, completion_tokens: 30 },
      }),
    );
    const h = harness(transport, { size: 6, wakeGapTicks: 1, limits: TIGHT });
    await h.run(200);

    const spend = h.cast.report().spend;
    expect(spend.spentMicros).toBeGreaterThan(0);
    expect(spend.disabled).toBe(true);
    expect(h.cast.live).toBe(false);
    // The cap is what stopped it, not the run ending: a handful of calls, not ninety.
    expect(served()).toBeLessThan(10);
    h.cast.close();
  });

  it('a 200 whose body is not JSON at all (a proxy or CDN error page) trips the cap', async () => {
    const { transport, served } = transportServing(
      () =>
        ({
          ok: true,
          status: 200,
          json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
        }) as unknown as Response,
    );
    const h = harness(transport, { size: 6, wakeGapTicks: 1, limits: TIGHT });
    await h.run(200);

    expect(h.cast.report().spend.spentMicros).toBeGreaterThan(0);
    expect(h.cast.report().spend.disabled).toBe(true);
    expect(served()).toBeLessThan(10);
    h.cast.close();
  });

  it('a call the cast ABORTS at its deadline is charged — the provider still generated it', async () => {
    // The routine case: DEFAULT_DEADLINE_TICKS is 3, which is 30 s at `fast`, and a
    // completion slower than that is not an anomaly. Refunding these was half the hole.
    let served = 0;
    const transport = openAiTransport({
      fetchImpl: ((_url: string, init: RequestInit) => {
        served += 1;
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('This operation was aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }) as unknown as typeof fetch,
    });
    const h = harness(transport, { size: 6, wakeGapTicks: 1, deadlineTicks: 2, limits: LOOSE });
    await h.run(120);

    expect(served).toBeGreaterThan(5);
    expect(h.cast.report().spend.spentMicros).toBeGreaterThan(0);
    h.cast.close();
  });

  it('a 500 stays charged, as it always did', async () => {
    const { transport } = transportServing(
      () => ({ ok: false, status: 500, text: () => Promise.resolve('upstream boom') }) as unknown as Response,
    );
    const h = harness(transport, { size: 6, wakeGapTicks: 1, limits: TIGHT });
    await h.run(200);
    expect(h.cast.report().spend.disabled).toBe(true);
    h.cast.close();
  });
});

describe('a call that never REACHED a provider is still refunded', () => {
  it('no key: every wake fails instantly, nothing is billed, the cap never latches', async () => {
    delete process.env['OPENAI_API_KEY'];
    const transport = openAiTransport({
      fetchImpl: (() => {
        throw new Error('fetch must not be called without a key');
      }) as unknown as typeof fetch,
    });
    const h = harness(transport, { size: 4, wakeGapTicks: 1, limits: TIGHT });
    await h.run(60);

    expect(h.cast.report().spend.calls).toBeGreaterThan(10);
    expect(h.cast.report().spend.spentMicros).toBe(0);
    expect(h.cast.report().spend.disabled).toBe(false);
    expect(h.cast.live).toBe(true);
    h.cast.close();
  });

  it('a connection failure (DNS, ECONNREFUSED) is refunded — a dead network must not latch the cap', async () => {
    // This is the case the refund exists for and the one my fix had to not break: the
    // socket never opened, so there is nothing on any invoice.
    let served = 0;
    const transport = openAiTransport({
      fetchImpl: (() => {
        served += 1;
        return Promise.reject(new TypeError('fetch failed'));
      }) as unknown as typeof fetch,
    });
    const h = harness(transport, { size: 4, wakeGapTicks: 1, limits: TIGHT });
    await h.run(60);

    expect(served).toBeGreaterThan(10);
    expect(h.cast.report().spend.spentMicros).toBe(0);
    expect(h.cast.report().spend.disabled).toBe(false);
    h.cast.close();
  });

  it('the transport labels each class correctly, at the source', async () => {
    const call = async (t: CastTransport): Promise<CastTransportError> => {
      try {
        await t.complete({ model: 'm', messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 8 });
      } catch (error: unknown) {
        return error as CastTransportError;
      }
      throw new Error('expected a failure');
    };

    const refusal = await call(transportServing(() => ok({ choices: [{ message: { content: null } }] })).transport);
    expect(refusal.reachedProvider).toBe(true);
    expect(refusal.status).toBe(200);

    const server = await call(
      transportServing(() => ({ ok: false, status: 503, text: () => Promise.resolve('x') }) as unknown as Response)
        .transport,
    );
    expect(server.reachedProvider).toBe(true);

    const dead = await call(
      openAiTransport({
        fetchImpl: (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch,
      }),
    );
    expect(dead.reachedProvider).toBe(false);

    delete process.env['OPENAI_API_KEY'];
    const keyless = await call(openAiTransport({ fetchImpl: (() => undefined) as unknown as typeof fetch }));
    expect(keyless.reachedProvider).toBe(false);
    expect(keyless.message).toContain('OPENAI_API_KEY is not set');
  });
});

describe('the total can never stop being a number', () => {
  it('a transport that reports a non-finite figure stops the cast rather than disabling the cap', () => {
    // `NaN >= cap` is false forever, so a poisoned total would switch the cumulative cap
    // off silently and permanently. The safe reading of "we no longer know what we have
    // spent" is stop spending.
    const budget = new CastBudget({ spendCapMicros: 5_000_000 }, stoppedClock);
    const reserved = budget.charge(1_000);
    budget.settle(reserved, { inputTokens: null, outputTokens: null }, Number.NaN);
    expect(Number.isFinite(budget.spentMicros)).toBe(true);
    expect(budget.disabled).toBe(true);
    expect(budget.mayCall().ok).toBe(false);
  });
});

describe('default off, proven against the guard that actually enforces it', () => {
  it('a key in the environment does NOT turn the cast on by itself', () => {
    // The existing default-off tests pass `env: {}` — no flag AND no key — so they are
    // satisfied by the missing-key guard and would still pass with the `enabled` check
    // deleted (verified: that mutation leaves them green). On the deployed box the key
    // IS set, because that is how the cast is turned on, so this is the case that
    // decides whether an unset flag can spend money.
    const runtime = new Runtime({ seed: 'default-off-with-key' });
    const cast = createCast(runtime, {
      size: 4,
      clock: stoppedClock,
      env: { OPENAI_API_KEY: FAKE_KEY },
    });
    expect(cast).toBeInstanceOf(HeuristicCast);
  });

  it('only an explicit affirmative turns it on, even with a key present', () => {
    for (const value of ['0', 'false', 'no', 'off', '', ' ', 'maybe', 'null', 'undefined']) {
      const cast = createCast(new Runtime({ seed: 'off' }), {
        size: 2,
        clock: stoppedClock,
        env: { COMPACT_CAST_LLM: value, OPENAI_API_KEY: FAKE_KEY },
      });
      expect(cast, `COMPACT_CAST_LLM=${JSON.stringify(value)} must stay off`).toBeInstanceOf(HeuristicCast);
    }
  });
});

describe('what the prompt cap actually bounds', () => {
  it('maxPromptChars bounds the OBSERVATION, not the prompt — and the charge is honest anyway', async () => {
    // Pinned because `COMPACT_CAST_MAX_PROMPT_CHARS` reads like a cost control and is not
    // one: the contract is deliberately outside it (scar #1 — a player must not reason
    // from a shaved copy of the rules). An operator lowering it to cut the bill needs to
    // find that out here rather than from an invoice.
    const transport = MockTransport.says('{"note":"n","plan":[{"verb":"move","params":{}}]}');
    const h = harness(transport, { size: 4, wakeGapTicks: 1, limits: { ...LOOSE, maxPromptChars: 2_000 } });
    await h.run(6);

    const sizes = transport.calls.map((c) => c.request.messages.reduce((n, m) => n + m.content.length, 0));
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeGreaterThan(20_000);

    // The part that matters: the budget prices what was really sent, not the cap.
    const spend = h.cast.report().spend;
    expect(spend.spentMicros).toBeGreaterThan(0);
    h.cast.close();
  });
});
