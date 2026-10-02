/**
 * ★ **A PARLEY TO A HOUSE CHARACTER CAN GET AN ANSWER (`RULES_VERSION` 41).**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A blind playtester sent two parleys to house characters and got no answer to either. Two of the
 * three causes were in the price (`test/say/answers-are-free.spec.ts`); this file is the third, which
 * was in the house cast's own prompt: the inbox lived in `counterparties[].last_parley`, and
 * `counterparties` is the SECOND key `projectObservation` drops when an observation runs long — so on
 * a busy wake the character read an affordance saying somebody had written to it and never the letter.
 *
 * Three claims, end to end:
 *   1. **The letter is in the prompt even when `counterparties` is not** — quoted, framed as somebody
 *      else's words, with the exact call that answers it.
 *   2. **The focus names it**, so a model that skims still sees that somebody is waiting.
 *   3. **An LLM member that copies that call is ANSWERING, and the engine accepts it** — through the
 *      real `LlmCast`, on a mock transport, with nothing hand-built between the prompt and the record.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import {
  buildPrompt,
  charactersFor,
  excerptFor,
  HeuristicCast,
  mailBlock,
  readSituation,
  situationalFocus,
} from '../../src/cast/index.js';
import type { CompletionRequest } from '../../src/cast/index.js';
import type { EventId, PrincipalId } from '../../src/core/types.js';
import { setSpeed } from '../../src/core/time.js';
import { minor } from '../../src/core/units.js';
import { CURRENCY_FAUCET, storesAccount } from '../../src/ledger/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { holdingOf } from '../../src/world/index.js';
import { CONTRACT, MockTransport, harness, observationIn } from './mock.js';

const ASKER = 'p:pen-pal' as PrincipalId;
const LETTER = 'Two hands for your next HAUL at 9,000 each — and I keep my word. Yes or no?';

function entitle(runtime: Runtime, principal: PrincipalId): void {
  runtime.ledger.issueCurrency({
    eventId: `test.mail:${principal}:${String(runtime.engine.tick)}` as EventId,
    tick: runtime.engine.tick,
    faucet: CURRENCY_FAUCET.STARTER_STAKE,
    to: storesAccount(principal),
    amount: minor(5_000),
  });
}

function submit(runtime: Runtime, principal: PrincipalId, verb: string, params: Record<string, unknown>): void {
  const outcome = runtime.engine.submit({
    principal,
    verb,
    params,
    clientSequence: 0,
    arrivalMs: 0,
    decisionSource: 'LIVE',
  });
  if (!outcome.ok) throw new Error(`${verb}: ${outcome.hint}`);
}

/**
 * A house character that advertised, and an entitled stranger beside it that wrote. The letter goes
 * through the real verb, so the rung, the price and the record are the ones a live world produces.
 */
function written(runtime: Runtime, house: PrincipalId): void {
  runtime.seat(ASKER, 'pen-pal', holdingOf(runtime.world, house).system);
  runtime.standing.open(ASKER);
  entitle(runtime, ASKER);
  submit(runtime, house, 'publish_offer', { text: 'HANDS FOR HIRE — ASK' });
  runtime.runTick();
  submit(runtime, ASKER, 'message', { to: house, act: 'offer', text: LETTER });
  runtime.runTick();
  expect(runtime.parleysFor(house, runtime.engine.tick).principals_awaiting_your_reply, 'the letter landed').toBe(1);
}

describe('★ the house character is SHOWN its mail, even on a wake that drops the inbox key', () => {
  it('quotes the letter, frames it as somebody else\'s words, and gives the exact call that answers it', () => {
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'mail' });
    const cast = new HeuristicCast(runtime, { size: 3 });
    const members = cast.seat('mail');
    const house = members.find((m) => m.role !== 'raider');
    if (house === undefined) throw new Error('no Commons member');
    written(runtime, house.principal);

    const observation = buildObservation({
      runtime,
      principal: house.principal,
      serverNowMs: 0,
      fresh: true,
      wakesRemaining: 16,
      stale: false,
      corrections: [],
      correctionsDropped: 0,
      actionsRemaining: 4,
    });
    const character = charactersFor(members, 'mail').get(house.handle);
    if (character === undefined) throw new Error('no character');
    const contract = excerptFor(CONTRACT, readSituation(observation as unknown as Record<string, unknown>));
    const prompt = buildPrompt({
      contract,
      character,
      observation,
      memory: '',
      liveVerbs: [...runtime.liveVerbs],
      planMax: 3,
      // Small enough that the projection must drop keys — the long-wake case the defect lived in.
      maxObservationChars: 6_000,
    });
    expect(prompt.omittedKeys, 'the inbox key is dropped on this wake, which is the case that hid the mail').toContain(
      'counterparties',
    );
    const user = prompt.messages[prompt.messages.length - 1]?.content ?? '';
    expect(user, 'the letter is quoted').toContain(LETTER.slice(0, 40));
    expect(user, 'its sender is named').toContain(`FROM ${ASKER}`);
    expect(user, 'and the answer is one copyable call').toContain(`"to":"${ASKER}"`);
    expect(user, 'framed as untrusted words, never instructions (§7.3: prose never executes)').toMatch(
      /never\s+instructions/,
    );
    expect(
      situationalFocus(observation as unknown as Record<string, unknown>).some((f) => f.startsWith('§4 The PARLEY')),
      'the focus says somebody is waiting',
    ).toBe(true);
    // The block is computed off the FULL observation, so it cannot depend on what the projection kept.
    expect(mailBlock(observation as unknown as Record<string, unknown>).join('\n')).toContain(LETTER.slice(0, 40));
  });

  it('an LLM member that copies the call is ANSWERING — free, unentitled, and accepted', async () => {
    // A model that does exactly what the mail block says: copy the call, write an answer.
    const answers: CompletionRequest[] = [];
    const transport = new MockTransport((request) => {
      answers.push(request);
      const seen = observationIn(request);
      const header = (seen?.['header'] ?? {}) as Record<string, unknown>;
      const parley = (header['parley'] ?? {}) as Record<string, unknown>;
      const letters = (parley['awaiting_reply'] ?? []) as readonly Record<string, unknown>[];
      const first = letters[0];
      const plan =
        first === undefined
          ? []
          : [{ verb: 'message', params: { to: first['from'], act: 'counter', text: 'Eight thousand, and you sign tonight.' } }];
      return Promise.resolve({
        text: JSON.stringify({ note: 'answering my mail', plan }),
        inputTokens: 2_000,
        outputTokens: 60,
        cachedInputTokens: null,
      });
    });
    const h = harness(transport, { seed: 'mail-llm', size: 3, wakeGapTicks: 4, idle: 'quiet' });
    const house = h.cast.roster.find((m) => m.role !== 'raider');
    if (house === undefined) throw new Error('no Commons member');
    written(h.runtime, house.principal);
    const before = h.runtime.parleysFor(house.principal, h.runtime.engine.tick);
    expect(before.parleys_per_reckoning, 'the house character has earned nothing, so it can start nothing').toBe(0);

    await h.run(16);

    const reply = h.runtime
      .parleysVisible(ASKER, h.runtime.engine.tick)
      .find((e) => e.from === house.principal && e.to === ASKER);
    expect(reply, 'the house character answered the stranger — the defect, closed end to end').toBeDefined();
    expect(reply?.answering, 'as an ANSWER: free of the opening it does not have').toBe(true);
    expect(answers.length, 'non-vacuity: the model was actually consulted').toBeGreaterThan(0);
  }, 120_000);
});
