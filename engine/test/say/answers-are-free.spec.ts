/**
 * ★ **ANSWERS ARE FREE, OPENINGS ARE PRICED, AND THE WINDOW ROLLS (`RULES_VERSION` 41).**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A blind playtester sent two parleys to house characters and got **no answer to either.** Three
 * defects stood behind that silence and this file is the regression for the two that lived in the
 * price (`say/parley.ts` §4); the third — the cast's prompt dropping its own inbox — is
 * `test/cast/the-prompt-shows-the-mail.spec.ts`.
 *
 *   1. **An entitled recipient answered out of its own opening allowance**, so a principal courted by
 *      four others answered three and was then mute to the fourth and could start nothing itself.
 *   2. **The reply right died at the Reckoning boundary**, so a letter that landed two ticks before
 *      settlement was unanswerable by an agent waking every eighteen.
 *
 * §7.3 has said since v3.0: *"Push (a first message to a stranger) costs rate limit; replies inside a
 * thread are free."* These tests hold the engine to that sentence, and to the two bounds that keep a
 * free reply from being a free megaphone: one answer per letter, and a ceiling per Reckoning.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import {
  MAX_PARLEYS_SENT_PER_RECKONING,
  PARLEY_ANSWER_WINDOW_TICKS,
  PARLEYS_PER_RECKONING,
} from '../../src/say/parley.js';
import { act, contactWorld, entitle, runTo, tick } from './contact-fixture.js';

const HOUSE = 'p:ahouse' as PrincipalId;
const ASKERS = ['p:aask1', 'p:aask2', 'p:aask3', 'p:aask4'] as PrincipalId[];

/**
 * A house character addressed by `n` entitled askers through the OFFER rung — it advertised, they
 * answered the advertisement. Every asker is entitled, so the letters are real openings.
 */
function courted(seed: string, n: number): ReturnType<typeof contactWorld> {
  const w = contactWorld(seed, [HOUSE, ...ASKERS]);
  for (const asker of ASKERS) entitle(w.runtime, asker);
  entitle(w.runtime, HOUSE);
  expect(act(w.runtime, HOUSE, 'publish_offer', { text: 'BUILDING CREW WANTED — ASK ME' })).toBeNull();
  for (const asker of ASKERS.slice(0, n)) {
    expect(
      act(w.runtime, asker, 'message', { to: HOUSE, act: 'offer', text: `${asker} will crew for 9000.` }),
      `${asker}'s opening must land`,
    ).toBeNull();
  }
  return w;
}

describe('★ an entitled principal courted by many can answer them ALL, and still open its own', () => {
  it('four letters in, four answers out, and the three openings are untouched', () => {
    const w = courted('answers-four', 4);
    const before = w.runtime.parleysFor(HOUSE, w.runtime.engine.tick);
    expect(before.principals_awaiting_your_reply, 'four principals are waiting on the house').toBe(4);
    expect(before.openings_remaining, 'and it has spent none of its own').toBe(PARLEYS_PER_RECKONING);
    const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
    expect(before.awaiting_reply.map((l) => String(l.from)).sort(byId), 'the inbox quotes every letter').toEqual(
      [...ASKERS].map(String).sort(byId),
    );

    for (const asker of ASKERS) {
      expect(
        act(w.runtime, HOUSE, 'message', { to: asker, act: 'counter', text: 'Eight thousand, and you sign tonight.' }),
        `the answer to ${asker} must land. Under the old pool this was refused for the FOURTH asker — the ` +
          'busiest principal in the world was the quietest',
      ).toBeNull();
    }
    const after = w.runtime.parleysFor(HOUSE, w.runtime.engine.tick);
    expect(after.principals_awaiting_your_reply, 'every letter answered').toBe(0);
    expect(
      after.openings_remaining,
      'ANSWERS SPEND NO OPENING — §7.3: replies inside a thread are free',
    ).toBe(PARLEYS_PER_RECKONING);
    expect(after.parleys_sent_this_reckoning, 'and the ceiling still counts them').toBe(4);
  });

  it('an UNENTITLED principal can answer, and start nothing', () => {
    const NOBODY = 'p:anobody' as PrincipalId;
    const ASKER = 'p:aasker' as PrincipalId;
    const w = contactWorld('answers-unentitled', [NOBODY, ASKER]);
    entitle(w.runtime, ASKER);
    expect(act(w.runtime, NOBODY, 'publish_offer', { text: 'NEW HERE, HANDS FREE' })).toBeNull();
    expect(act(w.runtime, ASKER, 'message', { to: NOBODY, act: 'offer', text: 'Escort for me?' })).toBeNull();

    const capacity = w.runtime.parleysFor(NOBODY, w.runtime.engine.tick);
    expect(capacity.parleys_per_reckoning, 'not entitled to open').toBe(0);
    expect(capacity.principals_awaiting_your_reply).toBe(1);
    expect(capacity.parleys_remaining, 'exactly the one answer it is owed').toBe(1);
    expect(act(w.runtime, NOBODY, 'message', { to: ASKER, act: 'accept', text: 'Yes. Name the venture.' })).toBeNull();
    const second = act(w.runtime, NOBODY, 'message', { to: ASKER, act: 'assure', text: 'And I will be there.' });
    expect(
      second?.invariant,
      'ONE ANSWER PER LETTER: a second letter before the asker writes again is an opening, and an unentitled ' +
        'principal has none — so a free identity can never turn one approach into a stream',
    ).toBe('A15');
  });
});

describe('★ a conversation goes turn by turn, and the opener pays for every turn it takes out of order', () => {
  it('writing twice before an answer spends two openings; answering an answer spends none', () => {
    const A = 'p:aturna' as PrincipalId;
    const B = 'p:aturnb' as PrincipalId;
    const w = contactWorld('answers-turns', [A, B]);
    entitle(w.runtime, A);
    entitle(w.runtime, B);
    expect(act(w.runtime, B, 'publish_offer', { text: 'TALK TO ME' })).toBeNull();

    expect(act(w.runtime, A, 'message', { to: B, act: 'offer', text: 'one' })).toBeNull();
    expect(act(w.runtime, A, 'message', { to: B, act: 'offer', text: 'two' })).toBeNull();
    expect(
      w.runtime.parleysFor(A, w.runtime.engine.tick).openings_remaining,
      'two letters with no answer between them are two openings',
    ).toBe(PARLEYS_PER_RECKONING - 2);
    expect(w.runtime.parleysFor(B, w.runtime.engine.tick).principals_awaiting_your_reply, 'one sender').toBe(1);

    expect(act(w.runtime, B, 'message', { to: A, act: 'counter', text: 'three' })).toBeNull();
    expect(act(w.runtime, A, 'message', { to: B, act: 'accept', text: 'four' })).toBeNull();
    expect(
      w.runtime.parleysFor(A, w.runtime.engine.tick).openings_remaining,
      'A answering B\'s answer is a turn in a conversation B chose to be in — free',
    ).toBe(PARLEYS_PER_RECKONING - 2);
    expect(w.runtime.parleysFor(B, w.runtime.engine.tick).openings_remaining).toBe(PARLEYS_PER_RECKONING);
  });
});

describe('★ the answer window ROLLS across the Reckoning boundary', () => {
  it('a letter landing two ticks before settlement is still answerable the next Reckoning', () => {
    const NEWCOMER = 'p:alate' as PrincipalId;
    const ASKER = 'p:aearly' as PrincipalId;
    const w = contactWorld('answers-late', [NEWCOMER, ASKER]);
    entitle(w.runtime, ASKER);
    expect(act(w.runtime, NEWCOMER, 'publish_offer', { text: 'AVAILABLE' })).toBeNull();
    runTo(w.runtime, TICKS_PER_RECKONING - 4);
    expect(act(w.runtime, ASKER, 'message', { to: NEWCOMER, act: 'offer', text: 'Late, I know.' })).toBeNull();
    const sentAt = w.runtime.engine.tick;
    expect(sentAt, 'the letter landed inside Reckoning 0').toBeLessThan(TICKS_PER_RECKONING);

    runTo(w.runtime, TICKS_PER_RECKONING + 20);
    const capacity = w.runtime.parleysFor(NEWCOMER, w.runtime.engine.tick);
    expect(
      capacity.principals_awaiting_your_reply,
      'the old rule killed the reply right at the boundary — two ticks of life against an 18-tick wake',
    ).toBe(1);
    const letter = capacity.awaiting_reply[0];
    expect(letter?.answer_by_tick, 'and the inbox says until when').toBe(sentAt + PARLEY_ANSWER_WINDOW_TICKS);
    expect(act(w.runtime, NEWCOMER, 'message', { to: ASKER, act: 'accept', text: 'Still yes.' })).toBeNull();
  });

  it('and closes at the end of the window, so a licence does not accumulate', () => {
    const NEWCOMER = 'p:astale' as PrincipalId;
    const ASKER = 'p:asender' as PrincipalId;
    const w = contactWorld('answers-window-end', [NEWCOMER, ASKER]);
    entitle(w.runtime, ASKER);
    expect(act(w.runtime, NEWCOMER, 'publish_offer', { text: 'AVAILABLE' })).toBeNull();
    expect(act(w.runtime, ASKER, 'message', { to: NEWCOMER, act: 'offer', text: 'Hello.' })).toBeNull();
    const sentAt = w.runtime.engine.tick;
    runTo(w.runtime, sentAt + PARLEY_ANSWER_WINDOW_TICKS + 1);
    expect(w.runtime.parleysFor(NEWCOMER, w.runtime.engine.tick).principals_awaiting_your_reply).toBe(0);
    const refusal = act(w.runtime, NEWCOMER, 'message', { to: ASKER, act: 'accept', text: 'Too late?' });
    expect(refusal?.invariant, 'past the window, writing back is an opening — and this principal has none').toBe('A15');
  });

  it('the MENU and the VERB agree on every tick around the window\'s end (AGT-S2)', () => {
    const NEWCOMER = 'p:aedge' as PrincipalId;
    const ASKER = 'p:aedger' as PrincipalId;
    const w = contactWorld('answers-edge', [NEWCOMER, ASKER]);
    entitle(w.runtime, ASKER);
    expect(act(w.runtime, NEWCOMER, 'publish_offer', { text: 'AVAILABLE' })).toBeNull();
    expect(act(w.runtime, ASKER, 'message', { to: NEWCOMER, act: 'offer', text: 'Edge.' })).toBeNull();
    const sentAt = w.runtime.engine.tick;
    runTo(w.runtime, sentAt + PARLEY_ANSWER_WINDOW_TICKS - 3);
    const seen = new Set<boolean>();
    while (w.runtime.engine.tick <= sentAt + PARLEY_ANSWER_WINDOW_TICKS + 2) {
      const at = w.runtime.engine.tick + 1;
      const published = w.runtime.parleysFor(NEWCOMER, at).parleys_remaining > 0;
      const gate = w.runtime.parleyRefusalFor(NEWCOMER, ASKER, at) === null;
      expect(gate, `at tick ${String(at)} the published count and the shared gate disagree`).toBe(published);
      seen.add(published);
      tick(w.runtime);
    }
    expect(seen.size, 'the sweep must see both answers or it asserts an equivalence over one value').toBe(2);
  });
});

describe('★ the ceiling bounds the shared book', () => {
  it(`no principal sends more than ${String(MAX_PARLEYS_SENT_PER_RECKONING)} parleys a Reckoning, answers included`, () => {
    const A = 'p:aceila' as PrincipalId;
    const B = 'p:aceilb' as PrincipalId;
    const w = contactWorld('answers-ceiling', [A, B]);
    entitle(w.runtime, A);
    entitle(w.runtime, B);
    expect(act(w.runtime, B, 'publish_offer', { text: 'TALK' })).toBeNull();
    expect(act(w.runtime, A, 'message', { to: B, act: 'offer', text: 'open' })).toBeNull();
    // Turn by turn, both sides answering, until A hits the ceiling.
    let turns = 1;
    while (turns < MAX_PARLEYS_SENT_PER_RECKONING) {
      expect(act(w.runtime, B, 'message', { to: A, act: 'counter', text: `b${String(turns)}` })).toBeNull();
      expect(act(w.runtime, A, 'message', { to: B, act: 'counter', text: `a${String(turns)}` })).toBeNull();
      turns += 1;
    }
    expect(w.runtime.parleysFor(A, w.runtime.engine.tick).sends_remaining_this_reckoning).toBe(0);
    expect(
      act(w.runtime, B, 'message', { to: A, act: 'counter', text: 'my twelfth' }),
      'B has sent eleven, so its twelfth lands',
    ).toBeNull();
    const capped = act(w.runtime, A, 'message', { to: B, act: 'counter', text: 'one more' });
    expect(capped?.invariant, 'the ceiling is INV-26 — a bound on a shared buffer, not a price').toBe('INV-26');
    expect(w.runtime.parleysFor(A, w.runtime.engine.tick).rule, 'and the note names it').toMatch(/ceiling/i);
  });
});
