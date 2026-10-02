/**
 * ★ **THE PARLEY THREAD REACHES BOTH FRAMES — FROM THE TICK THE LETTER PUBLISHES, AND NOT ONE TICK
 * BEFORE (`RULES_VERSION` 41).**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `scripts/frame-census.ts` on a twelve-member heuristic world, three Reckonings: `directoryLines`
 * 5,120 rows on the live frames, **`parleyLines` 0 rows on every frame, FROZEN** — the house heuristic
 * never writes a letter, so no seeded world this repo runs ever puts a thread on the map. Letters come
 * from the LLM cast and from outside agents, and neither is in a seeded world. That left the key a
 * capability nothing measured: the client draws a thread from it and no test had ever seen a row.
 *
 * So this file is the key's non-vacuity proof, and it pins the one property only a frame can break:
 * §11.2's clock. A letter is `PARTIES` for `AUDIT_LAG_TICKS` and `PUBLIC` after, and the viewer is
 * never ahead of a non-party agent (A9). A thread on the map one tick early would be the disclosure
 * arriving before the rule says it may.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { MAX_FRAME_PARLEY_EXCERPT } from '../../src/frames/contract.js';
import { act, contactWorld, entitle, runTo, SETTLEMENT, tick } from './contact-fixture.js';

const SENDER = 'p:tsender' as PrincipalId;
const RECIPIENT = 'p:trecipient' as PrincipalId;
const BYSTANDER = 'p:tbystander' as PrincipalId;

const LONG = 'I have three hands idle at the stage and I would rather fill your HAUL than open a rival one. ' +
  'Name the split and the tick, and I will sign the terms as they stand.';

describe('★ a declassified letter is a thread on both frames, and an answer is its return stroke', () => {
  it('appears on the live frame at its publish tick, never before, with both holdings and an excerpt', () => {
    const w = contactWorld('thread-map', [SENDER, RECIPIENT, BYSTANDER]);
    entitle(w.runtime, SENDER);
    // The OFFER rung: an advertiser in your own constellation invited the address.
    expect(act(w.runtime, RECIPIENT, 'publish_offer', { text: 'HANDS FOR HIRE' })).toBeNull();
    expect(act(w.runtime, SENDER, 'message', { to: RECIPIENT, act: 'offer', text: LONG })).toBeNull();

    const entry = w.runtime.parleysVisible(SENDER, w.runtime.engine.tick).find((e) => e.from === SENDER);
    if (entry === undefined) throw new Error('the letter was not recorded');

    // ── EARLY: the parties read it; the map and the bystander do not ──
    while (w.runtime.engine.tick < entry.revealsAtTick) {
      expect(w.runtime.liveFrame().parleyLines, `no thread at tick ${String(w.runtime.engine.tick)}`).toEqual([]);
      expect(
        w.runtime.parleysVisible(BYSTANDER, w.runtime.engine.tick),
        'and a bystander agent reads exactly what the map shows',
      ).toEqual([]);
      tick(w.runtime);
    }

    // ── PUBLISHED: one thread, from holding to holding, the sender's own words cut to the excerpt ──
    const lines = w.runtime.liveFrame().parleyLines;
    expect(lines, 'the thread is drawn on the tick the letter publishes').toHaveLength(1);
    const line = lines[0];
    expect(line?.from).toBe(SENDER);
    expect(line?.to).toBe(RECIPIENT);
    expect(line?.fromAt, 'both ends are holdings the map can draw between').toBe(w.stage);
    expect(line?.toAt).toBe(w.stage);
    expect(line?.why, 'the rung that made it legal is on the record').toBe('OFFER');
    expect(line?.answering, 'a first letter is an opening').toBe(false);
    expect(line?.sentTick).toBe(entry.tick);
    expect(line?.publishedTick).toBe(entry.revealsAtTick);
    expect(line?.excerpt.length, 'the frame quotes, it does not republish').toBeLessThanOrEqual(MAX_FRAME_PARLEY_EXCERPT);
    expect(LONG.startsWith((line?.excerpt ?? '').replace(/…$/, '')), 'and the quote is the sender\'s own words').toBe(true);
    expect(
      w.runtime.parleysVisible(BYSTANDER, w.runtime.engine.tick).map((e) => e.text),
      'A9: the bystander agent can read the whole letter at the same tick the viewer sees the thread',
    ).toEqual([LONG]);

    // ── THE ANSWER: free for the unentitled recipient, and drawn as the return stroke ──
    expect(act(w.runtime, RECIPIENT, 'message', { to: SENDER, act: 'accept', text: 'Done. Sign it.' })).toBeNull();
    const answer = w.runtime.parleysVisible(RECIPIENT, w.runtime.engine.tick).find((e) => e.from === RECIPIENT);
    if (answer === undefined) throw new Error('the answer was not recorded');
    expect(answer.answering, 'the recipient was never entitled, so this could only land as an answer').toBe(true);
    runTo(w.runtime, answer.revealsAtTick);
    const both = w.runtime.liveFrame().parleyLines;
    expect(both.map((l) => [l.from, l.answering]), 'newest first: the answer, then the letter').toEqual([
      [RECIPIENT, true],
      [SENDER, false],
    ]);
  });

  it('the Reckoning frame carries the same threads at its settlement tick', () => {
    const w = contactWorld('thread-reckoning', [SENDER, RECIPIENT]);
    entitle(w.runtime, SENDER);
    expect(act(w.runtime, RECIPIENT, 'publish_offer', { text: 'HANDS FOR HIRE' })).toBeNull();
    expect(act(w.runtime, SENDER, 'message', { to: RECIPIENT, act: 'offer', text: 'Your price?' })).toBeNull();
    runTo(w.runtime, SETTLEMENT + 1);
    const frame = w.runtime.reckoningFrame();
    if (frame === null) throw new Error('no Reckoning frame after the first settlement');
    expect(frame.parleyLines.map((l) => [l.from, l.to, l.excerpt])).toEqual([[SENDER, RECIPIENT, 'Your price?']]);
    expect(frame.parleyLines, 'one builder: the live frame at the same tick agrees').toEqual(
      w.runtime.parleyLines(frame.tick),
    );
  });
});
