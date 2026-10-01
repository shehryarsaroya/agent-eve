/**
 * The streamed transport, and the two settings that select it.
 *
 * The GPT-6 Astra endpoint refuses a non-streaming request outright (`400
 * stream_required`, measured 2026-10-01), so a cast on it lives or dies by
 * {@link assembleStream}. These drive the REAL transport with only the socket replaced,
 * like `spend-truth.test.ts`, and cut the event stream at awkward byte boundaries,
 * because a parser that only works when every event arrives whole works on a laptop and
 * fails behind a proxy.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import { HeuristicCast } from '../../src/cast/heuristic.js';
import {
  CastTransportError,
  castSettingsFromEnv,
  castUrlFromEnv,
  createCast,
  openAiTransport,
  OPENAI_COMPLETIONS_URL,
  type CompletionRequest,
} from '../../src/cast/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { stoppedClock } from './mock.js';

/** Assembled at runtime. There is no contiguous credential-shaped literal in this file. */
const FAKE_KEY = ['zz', 'notarealkey', 'streamsuite', '00000'].join('-');

let saved: string | undefined;
beforeEach(() => {
  saved = process.env['OPENAI_API_KEY'];
  process.env['OPENAI_API_KEY'] = FAKE_KEY;
});
afterEach(() => {
  if (saved === undefined) delete process.env['OPENAI_API_KEY'];
  else process.env['OPENAI_API_KEY'] = saved;
});

const REQUEST: CompletionRequest = {
  model: 'gpt-6-astra',
  messages: [
    { role: 'system', content: 'contract' },
    { role: 'user', content: 'situation' },
  ],
  maxOutputTokens: 1500,
};

/** A 200 event stream delivered in exactly these byte pieces. */
function streamed(pieces: readonly string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

function event(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function deltas(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(event({ choices: [{ index: 0, delta: { content: text.slice(i, i + size) } }] }));
  return out;
}

/** Cut a whole stream into pieces of `size` bytes, ignoring event boundaries entirely. */
function shredded(stream: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < stream.length; i += size) out.push(stream.slice(i, i + size));
  return out;
}

function serving(response: Response): { transport: ReturnType<typeof openAiTransport>; bodies: unknown[] } {
  const bodies: unknown[] = [];
  const transport = openAiTransport({
    stream: true,
    url: 'https://provider.invalid/v1/chat/completions',
    fetchImpl: ((_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return Promise.resolve(response);
    }) as unknown as typeof fetch,
  });
  return { transport, bodies };
}

const ANSWER = '{"intent":"hold","actions":[]}';
const USAGE = { prompt_tokens: 4153, completion_tokens: 17, prompt_tokens_details: { cached_tokens: 3968 } };

describe('assembling an event stream', () => {
  it('folds deltas into the answer and reads usage from the final chunk', async () => {
    const stream = [
      ...deltas(ANSWER, 5),
      event({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      event({ choices: [], usage: USAGE }),
      'data: [DONE]\n\n',
    ].join('');
    const { transport } = serving(streamed(shredded(stream, 7)));
    const reply = await transport.complete(REQUEST);
    expect(reply.text).toBe(ANSWER);
    expect(reply.inputTokens).toBe(4153);
    expect(reply.outputTokens).toBe(17);
    expect(reply.cachedInputTokens).toBe(3968);
  });

  it('asks for a stream, and for usage inside it, only when streaming is on', async () => {
    const on = serving(streamed([...deltas(ANSWER, 50), 'data: [DONE]\n\n']));
    await on.transport.complete(REQUEST);
    expect(on.bodies[0]).toMatchObject({ stream: true, stream_options: { include_usage: true }, model: 'gpt-6-astra' });

    const bodies: unknown[] = [];
    const off = openAiTransport({
      fetchImpl: ((_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: ANSWER } }] }), { status: 200 }));
      }) as unknown as typeof fetch,
    });
    await off.complete(REQUEST);
    expect(bodies[0]).not.toHaveProperty('stream');
    expect(bodies[0]).not.toHaveProperty('stream_options');
  });

  it('survives CRLF line endings, keep-alive comments and non-data fields', async () => {
    const stream = [
      ': keep-alive\r\n\r\n',
      'event: message\r\n',
      ...deltas(ANSWER, 4).map((e) => e.replace(/\n/g, '\r\n')),
      'id: 7\r\n',
      'data: [DONE]\r\n\r\n',
    ].join('');
    const { transport } = serving(streamed(shredded(stream, 3)));
    expect((await transport.complete(REQUEST)).text).toBe(ANSWER);
  });

  it('ends at [DONE] and ignores anything after it', async () => {
    const stream = [...deltas(ANSWER, 9), 'data: [DONE]\n\n', 'data: {not json}\n\n'].join('');
    const { transport } = serving(streamed(shredded(stream, 11)));
    expect((await transport.complete(REQUEST)).text).toBe(ANSWER);
  });

  it('accepts a stream that ends without [DONE] and without a trailing newline', async () => {
    const stream = deltas(ANSWER, 6).join('').replace(/\n+$/, '');
    const { transport } = serving(streamed(shredded(stream, 13)));
    expect((await transport.complete(REQUEST)).text).toBe(ANSWER);
  });

  it('reports usage as unknown, not zero, when the provider sends none', async () => {
    const { transport } = serving(streamed([...deltas(ANSWER, 8), 'data: [DONE]\n\n']));
    const reply = await transport.complete(REQUEST);
    expect(reply.inputTokens).toBeNull();
    expect(reply.outputTokens).toBeNull();
    expect(reply.cachedInputTokens).toBeNull();
  });
});

describe('a stream that answered badly is a charged failure, not an empty answer', () => {
  it('a reasoning-starved stream raises the max-output-tokens message', async () => {
    const stream = [event({ choices: [{ index: 0, delta: {}, finish_reason: 'length' }] }), 'data: [DONE]\n\n'].join('');
    const { transport } = serving(streamed([stream]));
    const failure = await transport.complete(REQUEST).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CastTransportError);
    expect((failure as CastTransportError).message).toMatch(/COMPACT_CAST_MAX_OUTPUT_TOKENS/);
    expect((failure as CastTransportError).reachedProvider).toBe(true);
  });

  it('a stream with no choices at all is refused', async () => {
    const { transport } = serving(streamed([event({ choices: [], usage: USAGE }), 'data: [DONE]\n\n']));
    const failure = await transport.complete(REQUEST).catch((error: unknown) => error);
    expect((failure as CastTransportError).message).toMatch(/no choices/);
    expect((failure as CastTransportError).status).toBe(200);
  });

  it('an error event inside the stream is raised, stamped with the answered status, and redacted', async () => {
    const stream = [...deltas('{"inte', 3), event({ error: { message: `upstream rejected Bearer ${FAKE_KEY}` } })].join('');
    const { transport } = serving(streamed([stream]));
    const failure = await transport.complete(REQUEST).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CastTransportError);
    const message = (failure as CastTransportError).message;
    expect(message).toMatch(/stream reported an error/);
    expect(message).not.toContain(FAKE_KEY);
    expect((failure as CastTransportError).reachedProvider).toBe(true);
  });

  it('an event that is not JSON is refused, not skipped', async () => {
    const { transport } = serving(streamed(['data: {"choices": [\n\n']));
    const failure = await transport.complete(REQUEST).catch((error: unknown) => error);
    expect((failure as CastTransportError).message).toMatch(/not JSON/);
  });

  it('a non-200 is read as text and raised before any stream parsing', async () => {
    const response = new Response('{"error":{"code":"stream_required"}}', { status: 400 });
    const { transport } = serving(response);
    const failure = await transport.complete(REQUEST).catch((error: unknown) => error);
    expect((failure as CastTransportError).status).toBe(400);
    expect((failure as CastTransportError).message).toMatch(/stream_required/);
  });

  it('a stream cut off by the deadline is charged: the provider was already generating', async () => {
    const encoder = new TextEncoder();
    const transport = openAiTransport({
      stream: true,
      fetchImpl: ((_url: string, init: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(deltas(ANSWER, 4)[0] ?? ''));
            init.signal?.addEventListener('abort', () => {
              controller.error(new DOMException('aborted', 'AbortError'));
            });
          },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
      }) as unknown as typeof fetch,
    });
    const outer = new AbortController();
    const pending = transport.complete({ ...REQUEST, signal: outer.signal }).catch((error: unknown) => error);
    outer.abort();
    const failure = await pending;
    expect(failure).toBeInstanceOf(CastTransportError);
    expect((failure as CastTransportError).reachedProvider).toBe(true);
  });
});

describe('selecting the endpoint and the stream from the environment', () => {
  it('defaults to OpenAI and to no stream', () => {
    const settings = castSettingsFromEnv({});
    expect(settings.url).toBe(OPENAI_COMPLETIONS_URL);
    expect(settings.stream).toBe(false);
  });

  it('reads an https endpoint and an explicit affirmative', () => {
    const settings = castSettingsFromEnv({
      COMPACT_CAST_URL: 'https://api.movingatoms.ai/v1/chat/completions',
      COMPACT_CAST_STREAM: 'on',
    });
    expect(settings.url).toBe('https://api.movingatoms.ai/v1/chat/completions');
    expect(settings.stream).toBe(true);
  });

  it('treats anything but a listed affirmative as off', () => {
    for (const value of ['0', 'off', 'false', 'no', 'enabled', ' ', 'TRUE!']) {
      expect(castSettingsFromEnv({ COMPACT_CAST_STREAM: value }).stream).toBe(false);
    }
  });

  it('refuses an unusable endpoint instead of falling back to the default', () => {
    for (const value of ['http://api.example.com/v1/chat/completions', 'ftp://x/y', 'not a url', 'https://user:pw@host/v1']) {
      expect(castUrlFromEnv({ COMPACT_CAST_URL: value })).toBeNull();
    }
    expect(castUrlFromEnv({ COMPACT_CAST_URL: 'http://127.0.0.1:9000/v1/chat/completions' })).toBe(
      'http://127.0.0.1:9000/v1/chat/completions',
    );
  });

  it('createCast runs heuristics, says why, and never names the key, when the endpoint is unusable', () => {
    setSpeed('instant');
    const lines: string[] = [];
    const cast = createCast(new Runtime({ seed: 'stream-url' }), {
      size: 2,
      clock: stoppedClock,
      log: (line) => lines.push(line),
      env: { COMPACT_CAST_LLM: 'on', OPENAI_API_KEY: FAKE_KEY, COMPACT_CAST_URL: 'http://api.example.com/v1/chat/completions' },
    });
    expect(cast).toBeInstanceOf(HeuristicCast);
    expect(lines.join('\n')).toMatch(/COMPACT_CAST_URL/);
    expect(lines.join('\n')).not.toContain(FAKE_KEY);
  });
});
