/**
 * The mock transport, and the rule the whole `test/cast/**` suite is built on.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **NO TEST IN THIS REPO MAY MAKE A NETWORK CALL OR NEED AN API KEY.**
 *
 * Two reasons, and the second is the one that lasts. First, the key this was written
 * against has no quota, so a live test would be red for a reason that has nothing to do
 * with the code. Second and permanently: a suite that depends on a third party's uptime
 * and billing is a suite that goes red at random, and a suite that goes red at random
 * gets ignored — which is how a real regression ships.
 *
 * So the transport is an interface, every test drives a mock, and the *only* untested
 * code in this directory is `openAiTransport`'s HTTP call. That is stated plainly in the
 * report rather than papered over.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { setSpeed } from '../../src/core/time.js';
import type { Clock } from '../../src/core/time.js';
import { Runtime } from '../../src/sim/runtime.js';
import { LlmCast, loadContractDocument, type CastTransport, type CompletionReply, type CompletionRequest, type ContractDocument, type LlmCastOptions } from '../../src/cast/index.js';

/** A clock that never moves. `serverNow` is display-only, so a constant is honest. */
export const stoppedClock: Clock = { nowMs: () => 1_700_000_000_000 };

export interface MockCall {
  readonly request: CompletionRequest;
}

/**
 * A transport whose every behaviour is chosen by the test.
 *
 * `mode` is read at call time rather than at construction, so one test can flip a cast
 * from healthy to failing mid-run — which is the only way to test that the fallback is
 * reached from a *running* world rather than from a world that never worked.
 */
export class MockTransport implements CastTransport {
  readonly calls: MockCall[] = [];
  /** Promises handed out that were never settled. Used by the "never blocks" test. */
  private readonly hanging: (() => void)[] = [];

  constructor(
    public reply: (request: CompletionRequest, n: number) => Promise<CompletionReply>,
  ) {}

  complete(request: CompletionRequest): Promise<CompletionReply> {
    this.calls.push({ request });
    return this.reply(request, this.calls.length - 1);
  }

  get count(): number {
    return this.calls.length;
  }

  /** Release anything held by {@link hangs}, so a test does not leak a pending promise. */
  release(): void {
    for (const done of this.hanging.splice(0)) done();
  }

  /** A transport that never answers. The timeout case. */
  static hangs(): MockTransport {
    const mock = new MockTransport(() => new Promise<CompletionReply>(() => undefined));
    return mock;
  }

  /** A transport that always rejects. The API-error case. */
  static fails(message: string): MockTransport {
    return new MockTransport(() => Promise.reject(new Error(message)));
  }

  /** A transport that answers with fixed text. */
  static says(text: string, usage: Partial<CompletionReply> = {}): MockTransport {
    return new MockTransport(() =>
      Promise.resolve({ text, inputTokens: usage.inputTokens ?? 2_000, outputTokens: usage.outputTokens ?? 60 , cachedInputTokens: null}),
    );
  }

  /** A transport that must never be called. Used by the replay test. */
  static forbidden(): MockTransport {
    return new MockTransport(() => {
      throw new Error('the cast was consulted when it must not have been');
    });
  }

  /**
   * A model that reads its observation and copies out an affordance.
   *
   * The most useful mock in the file, because it is the behaviour the prompt actually
   * asks for ("the safest plan is built from entries in `affordances[]`") and because it
   * produces actions the engine *accepts* — so a test can assert on a world that moved
   * rather than on a world full of refusals.
   */
  static picksAffordance(index = 0): MockTransport {
    return new MockTransport((request) => {
      const observation = observationIn(request);
      const list = observation === null ? [] : readAffordances(observation);
      const chosen = list[Math.min(index, Math.max(0, list.length - 1))];
      if (chosen === undefined) {
        return Promise.resolve({
          text: JSON.stringify({ note: 'nothing on offer', plan: [] }),
          inputTokens: 2_000,
          outputTokens: 20,
          cachedInputTokens: null,
        });
      }
      return Promise.resolve({
        text: JSON.stringify({
          note: `taking ${chosen.verb}`,
          plan: [{ verb: chosen.verb, params: chosen.params }],
        }),
        inputTokens: 2_000,
        outputTokens: 60,
        cachedInputTokens: null,
      });
    });
  }
}

/** The observation JSON the prompt carried, or null. Mirrors what a model would read. */
export function observationIn(request: CompletionRequest): Record<string, unknown> | null {
  for (const message of request.messages) {
    for (const line of message.content.split('\n')) {
      if (!line.startsWith('{"header"')) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function readAffordances(
  observation: Record<string, unknown>,
): { verb: string; params: Record<string, unknown> }[] {
  const raw = observation['affordances'];
  if (!Array.isArray(raw)) return [];
  const out: { verb: string; params: Record<string, unknown> }[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const verb = row['verb'];
    const params = row['params'];
    if (typeof verb !== 'string') continue;
    out.push({
      verb,
      params: typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {},
    });
  }
  return out;
}

/**
 * A reply naming one legal, always-available action.
 *
 * `move` with a bogus destination would be refused, which is a *legitimate* outcome and
 * still proves the LIVE path — but a refusal every tick is AGT-S3 noise inside the
 * suite. So tests that care about acceptance build the plan from a real affordance; tests
 * that only care about the plumbing use this.
 */
export function planJson(verb: string, params: Record<string, unknown>, note = 'because'): string {
  return JSON.stringify({ note, plan: [{ verb, params }] });
}

/** Flush the microtask queue so a settled mock promise reaches the cast's inbox. */
export async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * The real `agent.md`, parsed once. Tests that need a contract share it.
 *
 * The **document**, not one excerpt: the cast cuts a per-wake excerpt from each member's own
 * observation, so handing it a frozen excerpt here would leave the live selection path
 * untested by the entire cast suite.
 */
export const CONTRACT: ContractDocument = (() => {
  const loaded = loadContractDocument();
  if (loaded === null) throw new Error('agent.md could not be read; the cast suite needs it');
  return loaded;
})();

export interface HarnessOptions extends Partial<Omit<LlmCastOptions, 'transport' | 'clock'>> {
  readonly seed?: string;
  readonly size?: number;
}

export interface Harness {
  readonly runtime: Runtime;
  readonly cast: LlmCast;
  readonly seed: string;
  readonly logs: string[];
  /** Run `n` ticks, letting settled promises land between them. */
  run(n: number): Promise<void>;
}

/**
 * Seat a world with an LLM cast on a mock transport.
 *
 * `setSpeed('instant')` because the tick has no wall-clock length in a test and the cast
 * must not need one: every deadline it enforces is counted in ticks.
 */
export function harness(transport: CastTransport, options: HarnessOptions = {}): Harness {
  setSpeed('instant');
  const seed = options.seed ?? 'cast-llm';
  const runtime = new Runtime({ seed });
  const logs: string[] = [];
  const cast = new LlmCast(runtime, {
    size: options.size ?? 4,
    transport,
    clock: stoppedClock,
    contract: options.contract === undefined ? CONTRACT : options.contract,
    log: (line) => logs.push(line),
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.wakeGapTicks === undefined ? {} : { wakeGapTicks: options.wakeGapTicks }),
    ...(options.deadlineTicks === undefined ? {} : { deadlineTicks: options.deadlineTicks }),
    ...(options.planMax === undefined ? {} : { planMax: options.planMax }),
    ...(options.idle === undefined ? {} : { idle: options.idle }),
    ...(options.memory === undefined ? {} : { memory: options.memory }),
  });
  cast.seat(seed);

  return {
    runtime,
    cast,
    seed,
    logs,
    async run(n: number): Promise<void> {
      for (let i = 0; i < n; i += 1) {
        for (const action of cast.decide(runtime.engine.tick + 1, seed)) {
          runtime.engine.submit(action);
        }
        runtime.runTick();
        // Between ticks, not inside one: this is where a real scheduler's event loop
        // would deliver a completed HTTP response.
        await settle();
      }
    },
  };
}
