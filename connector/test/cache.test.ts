import { describe, expect, it } from 'vitest';
import type { EngineCall, EngineReply, EngineTransport } from '../src/engine/client.js';
import { healthFrom, rulesFrom, TtlCache } from '../src/mcp/tools.js';

function engineAnswering(answers: (EngineReply | Error)[]): EngineTransport & { calls: EngineCall[] } {
  const calls: EngineCall[] = [];
  return {
    calls,
    call: async (call) => {
      calls.push(call);
      const next = answers.shift() ?? { httpStatus: 200, body: {} };
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

describe('the shared-read cache', () => {
  it('keeps a booting engine\'s 503 as a health answer, briefly', async () => {
    let now = 0;
    const cache = new TtlCache(() => now);
    const engine = engineAnswering([{ httpStatus: 503, body: { report: { tick: 5 } } }, { httpStatus: 200, body: { report: { tick: 6 } } }]);
    expect((await healthFrom(cache, engine)).httpStatus).toBe(503);
    expect((await healthFrom(cache, engine)).httpStatus).toBe(503);
    expect(engine.calls).toHaveLength(1);
    now += 3_001;
    expect((await healthFrom(cache, engine)).httpStatus).toBe(200);
    expect(engine.calls).toHaveLength(2);
  });

  it('never keeps the rules unless they were served, and never keeps a failure', async () => {
    const cache = new TtlCache(() => 0);
    const engine = engineAnswering([{ httpStatus: 503, body: {} }, new Error('down'), { httpStatus: 200, body: { text: '# rules' } }]);
    expect((await rulesFrom(cache, engine)).httpStatus).toBe(503);
    await expect(rulesFrom(cache, engine)).rejects.toThrow('down');
    expect((await rulesFrom(cache, engine)).body['text']).toBe('# rules');
    expect((await rulesFrom(cache, engine)).body['text']).toBe('# rules');
    expect(engine.calls).toHaveLength(3);
  });
});
