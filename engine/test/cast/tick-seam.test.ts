/**
 * The seam between the tick and the network, guarded structurally.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A TICK MUST NEVER BE ABLE TO WAIT ON A MODEL.**
 *
 * Tick resolution is deterministic and measured in single-digit milliseconds; a
 * completion is measured in seconds. If `decide()` ever awaited the transport, the whole
 * world would run at the speed of the slowest API call and an outage would stop it dead
 * — and the failure would not show up in a unit test, because a mock answers instantly.
 * It would show up in production, once, as a stalled world.
 *
 * `llm.test.ts` proves the property behaviourally (a hanging transport, ticks still
 * landing). This file proves it **structurally**, which is the form that catches the
 * regression at the moment it is written rather than at the moment it is deployed: there
 * is no `await` and no `async` in `llm.ts` at all, so there is nothing for a tick to
 * block on. A future edit that adds one fails here with the reason attached.
 *
 * The second half covers the other way the seam can break: a transport that does not
 * honour its own interface. Every mock in this suite returns a well-formed promise, and
 * a real transport behind a proxy, a stub, or a half-finished refactor may not.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import type { CastTransport, CompletionReply } from '../../src/cast/index.js';
import { harness } from './mock.js';

/** Source with block comments, line comments and JSDoc stripped, so prose cannot trip it. */
function codeOf(file: string): string {
  const raw = readFileSync(new URL(`../../src/cast/${file}`, import.meta.url), 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

describe('the tick cannot wait on the network, by construction', () => {
  it('llm.ts contains no `await` and no `async` — there is nothing to block on', () => {
    const code = codeOf('llm.ts');
    expect(
      /\bawait\b/.test(code),
      'llm.ts runs inside tick resolution. An `await` here makes the world run at the ' +
        'speed of the model and stop when the API does. Start the call, return, and pick ' +
        'the reply up from the inbox on a later decide().',
    ).toBe(false);
    expect(/\basync\b/.test(code), 'same reason: nothing on this path may return a promise').toBe(false);
    // Positive control: the file really was read and stripped to something substantial,
    // so the two assertions above cannot be passing on an empty string.
    expect(code).toContain('decide(');
    expect(code.length).toBeGreaterThan(2_000);
  });

  it('decide() returns an array, not a thenable', () => {
    setSpeed('instant');
    const h = harness(
      {
        complete: () => new Promise<CompletionReply>(() => undefined),
      },
      { size: 4, wakeGapTicks: 1 },
    );
    const out = h.cast.decide(h.runtime.engine.tick + 1, h.seed);
    expect(Array.isArray(out)).toBe(true);
    expect((out as unknown as { then?: unknown }).then).toBeUndefined();
    h.cast.close();
  });
});

describe('a transport that breaks its own interface still cannot break the world', () => {
  const rogues: { name: string; transport: CastTransport }[] = [
    {
      name: 'returns undefined instead of a promise',
      transport: {
        complete: (): Promise<CompletionReply> => undefined as unknown as Promise<CompletionReply>,
      },
    },
    {
      name: 'returns a promise of a reply whose text is not a string',
      transport: {
        complete: (): Promise<CompletionReply> =>
          Promise.resolve({ text: 42 as unknown as string, inputTokens: null, outputTokens: null }),
      },
    },
    {
      name: 'returns a promise of null',
      transport: {
        complete: (): Promise<CompletionReply> => Promise.resolve(null as unknown as CompletionReply),
      },
    },
    {
      name: 'throws a non-Error',
      transport: {
        complete: (): Promise<CompletionReply> => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'a bare string, which is not an Error';
        },
      },
    },
  ];

  for (const rogue of rogues) {
    it(`${rogue.name}: the world keeps ticking and the spend total stays a number`, async () => {
      setSpeed('instant');
      const h = harness(rogue.transport, { size: 4, wakeGapTicks: 1, deadlineTicks: 2 });
      const before = h.runtime.engine.tick;
      await expect(h.run(20)).resolves.toBeUndefined();
      expect(h.runtime.engine.tick).toBe(before + 20);
      expect(h.runtime.engine.status).toBe('RUNNING');
      expect(Number.isFinite(h.cast.report().spend.spentMicros)).toBe(true);
      h.cast.close();
    });
  }
});
