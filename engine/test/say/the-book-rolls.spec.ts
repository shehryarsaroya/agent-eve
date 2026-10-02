/**
 * ★ **THE PARLEY BOOK ROLLS — A WORLD CARRIES FAR MORE THAN 512 LETTERS, AND EVERY PER-RECKONING LIMIT
 * STILL BINDS EXACTLY AS BEFORE** (`say/parley.ts` §5).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The book was a 512-row ring that refused once full, so the 513th parley of the WORLD'S LIFE was the
 * last one anybody could send — two days of twelve characters talking, or one morning of a launch.
 * Evicting instead was never an option: the opening count, the answer-once rule and the sends ceiling
 * are all counted off these rows, and a row evicted inside its window hands out a free opening (A15).
 *
 * The fix retires a letter only once every window that reads it has passed. These tests hold it to
 * both halves of that sentence:
 *
 *   1. **The world keeps talking.** Eight principals, eight Reckonings, the full ceiling every
 *      Reckoning: 768 letters accepted and not one refused for the book.
 *   2. **Nothing a count reads ever leaves.** Every Reckoning, each principal's fourth opening is
 *      refused (A15), its second letter before an answer is an opening and refused (A15), its 13th
 *      send is refused (INV-26), and the published counts agree with the permanent record.
 *   3. **The book's size is a function of the population, not of the world's age**, and it empties
 *      once the world falls silent.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING, reckoningIndex } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { AUDIT_LAG_TICKS } from '../../src/grant/dossier.js';
import {
  MAX_PARLEY_ENTRIES,
  MAX_PARLEYS_SENT_PER_RECKONING,
  PARLEY_ANSWER_WINDOW_TICKS,
  PARLEY_RECKONINGS_RETAINED,
  PARLEY_RETAINED_TICKS,
  PARLEY_THREAD_TICKS,
  PARLEYS_PER_RECKONING,
  PARLEYS_RETAINED_PER_PRINCIPAL,
  ParleyBook,
  parleyLastReadTick,
  type ParleyEntry,
} from '../../src/say/parley.js';
import type { Runtime } from '../../src/sim/runtime.js';
import { act, contactWorld, entitle, runTo, submit, tick } from './contact-fixture.js';

const CAST = ['p:rolla', 'p:rollb', 'p:rollc', 'p:rolld', 'p:rolle', 'p:rollf', 'p:rollg', 'p:rollh'] as PrincipalId[];
const N = CAST.length;
const RECKONINGS = 8;
/**
 * Where Reckoning `r`'s talk starts: its first tick, or once the last letter sent before it is past its
 * answer window, whichever is later — so this Reckoning's first letters are OPENINGS. Starting at the
 * boundary instead makes the first round a free ANSWER to a letter sent ~275 ticks earlier: the rolling
 * window working exactly as designed (§4), and the wrong subject for a test about the opening count.
 */
function startOf(r: number, lastSent: number): number {
  return Math.max(r * TICKS_PER_RECKONING, lastSent + PARLEY_ANSWER_WINDOW_TICKS + 1);
}

function at(i: number): PrincipalId {
  const p = CAST[((i % N) + N) % N];
  if (p === undefined) throw new Error('roster');
  return p;
}

/** One letter from every principal in the same tick, `to(i)` naming each one's recipient. */
function round(runtime: Runtime, to: (i: number) => PrincipalId, text: string): void {
  for (let i = 0; i < N; i += 1) submit(runtime, at(i), 'message', { to: to(i), act: 'counter', text }, i);
  tick(runtime);
  for (let i = 0; i < N; i += 1) {
    const refused = runtime.takeCorrections(at(i))[0];
    expect(refused, `${String(at(i))} → ${String(to(i))} ("${text}") must land`).toBeUndefined();
  }
}

/** One letter that must be refused, with the invariant it must be refused under. */
function refusedAs(runtime: Runtime, from: PrincipalId, to: PrincipalId, invariant: string, why: string): void {
  const refusal = act(runtime, from, 'message', { to, act: 'offer', text: 'one more' });
  expect(refusal?.invariant, why).toBe(invariant);
}

/** A fresh offer from everybody: the OFFER rung is what makes an opening to a neighbour legal. */
function advertise(runtime: Runtime, text: string): void {
  for (const p of CAST) submit(runtime, p, 'publish_offer', { text });
  tick(runtime);
  for (const p of CAST) expect(runtime.takeCorrections(p)[0], `${String(p)}'s offer must land`).toBeUndefined();
}

/** `say.parley` rows on the PERMANENT record, by sender, in one Reckoning. */
function recorded(runtime: Runtime, from: PrincipalId, reckoning: number): number {
  return runtime.events
    .ticks()
    .filter((t) => reckoningIndex(t) === reckoning)
    .flatMap((t) => runtime.events.eventsAtTick(t))
    .filter((e) => e.event.kind === 'say.parley' && e.event.payload['from'] === from).length;
}

/**
 * One Reckoning of talk at the ceiling, from the first tick of Reckoning `r`:
 *
 *   openings   P(i) → P(i+1), P(i+2), P(i+3)   — three OPENINGS each, and the fourth is refused
 *   answers    P(i) → P(i−1), P(i−2), P(i−3)   — the three letters it was sent, answered free
 *   again      P(i) → P(i−1) before it answers — an OPENING, and none are left: refused
 *   answers    P(i) → P(i+1), P(i+2), P(i+3)   — their answers, answered
 *   answers    P(i) → P(i−1), P(i−2), P(i−3)   — and theirs: twelve sends, three openings, nine free
 *   ceiling    P(i) → P(i+1)                   — owed an answer, and refused at the ceiling (INV-26)
 */
function talkAtTheCeiling(runtime: Runtime, r: number): void {
  advertise(runtime, `R${String(r)} — write to me`);
  for (const k of [1, 2, 3]) round(runtime, (i) => at(i + k), `open ${String(k)}`);
  for (let i = 0; i < N; i += 1) {
    expect(runtime.parleysFor(at(i), runtime.engine.tick + 1).openings_remaining, 'three openings spent').toBe(0);
  }
  refusedAs(runtime, at(0), at(4), 'A15', 'a FOURTH opening in one Reckoning is refused, in a book of any age');

  for (const k of [1, 2, 3]) round(runtime, (i) => at(i - k), `answer ${String(k)}`);
  refusedAs(
    runtime,
    at(0),
    at(-1),
    'A15',
    'ONE ANSWER PER LETTER: a second letter before the other side writes again is an opening, and none are left',
  );
  for (const k of [1, 2, 3]) round(runtime, (i) => at(i + k), `again ${String(k)}`);
  for (const k of [1, 2, 3]) round(runtime, (i) => at(i - k), `and again ${String(k)}`);

  for (let i = 0; i < N; i += 1) {
    const capacity = runtime.parleysFor(at(i), runtime.engine.tick + 1);
    expect(capacity.parleys_sent_this_reckoning, 'twelve sends').toBe(MAX_PARLEYS_SENT_PER_RECKONING);
    expect(capacity.sends_remaining_this_reckoning, 'at the ceiling').toBe(0);
    expect(capacity.openings_remaining, 'and every opening spent').toBe(0);
    expect(
      recorded(runtime, at(i), r),
      'the published count is the RECORD\'s count — the A15-honest half: no row a count reads has left the book',
    ).toBe(MAX_PARLEYS_SENT_PER_RECKONING);
  }
  expect(runtime.owesParleyAnswer(at(0), at(1), runtime.engine.tick + 1), 'P(1) wrote last').toBe(true);
  refusedAs(runtime, at(0), at(1), 'INV-26', 'the 13th send is refused at the ceiling, even as a free answer');
}

describe('★ the parley book rolls: a world that talks for eight Reckonings', () => {
  it(
    'carries 768 letters — far past the old lifetime cap of 512 — with every per-Reckoning limit binding as before',
    () => {
      const w = contactWorld('the-book-rolls', CAST);
      for (const p of CAST) entitle(w.runtime, p);
      const runtime = w.runtime;
      let peak = 0;
      let lastSent = -PARLEY_ANSWER_WINDOW_TICKS;
      for (let r = 0; r < RECKONINGS; r += 1) {
        runTo(runtime, startOf(r, lastSent));
        talkAtTheCeiling(runtime, r);
        lastSent = runtime.engine.tick;
        expect(reckoningIndex(lastSent), 'the whole script ran inside Reckoning r').toBe(r);
        const book = runtime.parleyBookSize();
        peak = Math.max(peak, book.size);
        expect(book.size + book.dropped, 'every letter accepted is in the book or has left it').toBe(
          (r + 1) * N * MAX_PARLEYS_SENT_PER_RECKONING,
        );
      }
      const total = RECKONINGS * N * MAX_PARLEYS_SENT_PER_RECKONING;
      expect(total, 'the world sent far more than the old lifetime cap').toBeGreaterThan(512);
      expect(
        runtime.events
          .ticks()
          .flatMap((t) => runtime.events.eventsAtTick(t))
          .filter((e) => e.event.kind === 'say.parley').length,
        'and every one of them is on the permanent record',
      ).toBe(total);
      expect(peak, 'the book holds at most one rolling stretch of letters per sender').toBeLessThanOrEqual(
        PARLEYS_RETAINED_PER_PRINCIPAL * N,
      );
      expect(peak, 'and never the world\'s whole history').toBeLessThan(total);

      // Silence for two Reckonings: every window passes, and the book empties.
      runTo(runtime, (RECKONINGS + 2) * TICKS_PER_RECKONING);
      const after = runtime.parleyBookSize();
      expect(after.size, 'nothing reads a letter from two Reckonings ago, so none is kept').toBe(0);
      expect(after.dropped, 'and every one of them left by retirement, never by eviction').toBe(total);
      expect(runtime.parleysFor(at(0), runtime.engine.tick + 1).openings_remaining, 'a whole allowance again').toBe(
        PARLEYS_PER_RECKONING,
      );
    },
    120_000,
  );

  it('keeps a late letter answerable across the boundary, in a world whose book has turned over', () => {
    const w = contactWorld('the-book-rolls-late', CAST);
    for (const p of CAST) entitle(w.runtime, p);
    const runtime = w.runtime;
    let lastSent = -PARLEY_ANSWER_WINDOW_TICKS;
    for (let r = 0; r < 3; r += 1) {
      runTo(runtime, startOf(r, lastSent));
      talkAtTheCeiling(runtime, r);
      lastSent = runtime.engine.tick;
    }
    expect(runtime.parleyBookSize().dropped, 'the book has already let letters go').toBeGreaterThan(0);
    // A letter a few ticks before a settlement, answered on the last tick of its window — a Reckoning
    // later, across the boundary, in a book that has been retiring letters the whole time.
    runTo(runtime, 4 * TICKS_PER_RECKONING - 10);
    advertise(runtime, 'still here');
    const asker = at(0);
    const late = at(5);
    expect(act(runtime, asker, 'message', { to: late, act: 'offer', text: 'Late, I know.' })).toBeNull();
    const sentAt = runtime.engine.tick;
    runTo(runtime, sentAt + PARLEY_ANSWER_WINDOW_TICKS - 1);
    expect(runtime.owesParleyAnswer(late, asker, runtime.engine.tick + 1), 'still owed, a Reckoning on').toBe(true);
    const answered = act(runtime, late, 'message', { to: asker, act: 'accept', text: 'Still yes.' });
    expect(answered, 'answered on the last tick of the window, the letter still in the book').toBeNull();
    expect(
      runtime.parleysFor(late, runtime.engine.tick + 1).openings_remaining,
      'and it was an ANSWER: no opening spent',
    ).toBe(PARLEYS_PER_RECKONING);
  });
});

describe('★ the retention rule covers every window that reads the book', () => {
  function letter(sent: number): ParleyEntry {
    return {
      from: 'p:a' as PrincipalId,
      to: 'p:b' as PrincipalId,
      act: 'offer',
      text: 'x',
      tick: sent,
      revealsAtTick: sent + AUDIT_LAG_TICKS,
      why: 'OFFER',
      about: 'offer',
      answering: false,
    };
  }

  it('is never earlier than the end of any window, and never later than the stretch the cap is sized for', () => {
    for (let sent = 0; sent < 3 * TICKS_PER_RECKONING; sent += 1) {
      const entry = letter(sent);
      const last = parleyLastReadTick(entry);
      const endOfItsReckoning = (reckoningIndex(sent) + 1) * TICKS_PER_RECKONING - 1;
      expect(last, 'the opening count, the ceiling and the received count').toBeGreaterThanOrEqual(endOfItsReckoning);
      expect(last, 'the answer window and the REPLY rung').toBeGreaterThanOrEqual(sent + PARLEY_ANSWER_WINDOW_TICKS);
      expect(last, 'the map\'s thread').toBeGreaterThanOrEqual(entry.revealsAtTick + PARLEY_THREAD_TICKS);
      expect(last - sent, 'and inside the stretch the cap is derived from').toBeLessThanOrEqual(PARLEY_RETAINED_TICKS);
    }
  });

  it('sizes the cap from the Reckonings one stretch can touch, for every principal the world can hold', () => {
    let most = 0;
    for (let start = 0; start < 2 * TICKS_PER_RECKONING; start += 1) {
      const touched = new Set<number>();
      for (let t = start; t <= start + PARLEY_RETAINED_TICKS; t += 1) touched.add(reckoningIndex(t));
      most = Math.max(most, touched.size);
    }
    expect(PARLEY_RECKONINGS_RETAINED, 'the most Reckonings any retained stretch touches').toBe(most);
    expect(PARLEYS_RETAINED_PER_PRINCIPAL).toBe(MAX_PARLEYS_SENT_PER_RECKONING * most);
    expect(MAX_PARLEY_ENTRIES, 'no longer a lifetime figure').toBeGreaterThan(512);
  });

  it('retires a prefix, keeps every principal\'s mail in book order, and restores exactly', () => {
    const book = new ParleyBook();
    const a = 'p:a' as PrincipalId;
    const b = 'p:b' as PrincipalId;
    const c = 'p:c' as PrincipalId;
    const rows: ParleyEntry[] = [];
    for (let sent = 0; sent < 600; sent += 50) {
      const one = { ...letter(sent), from: a, to: b };
      const two = { ...letter(sent), from: c, to: a, answering: true };
      book.push(one);
      book.push(two);
      rows.push(one, two);
    }
    expect(book.size).toBe(rows.length);
    expect(book.mailOf(a)).toHaveLength(rows.length);
    expect(book.mailOf(b)).toHaveLength(rows.length / 2);

    const now = 400;
    const gone = book.retire(now);
    const kept = rows.filter((e) => parleyLastReadTick(e) >= now);
    expect(gone, 'exactly the letters no window reads at this tick').toBe(rows.length - kept.length);
    expect(book.all, 'the rest, in book order').toEqual(kept);
    expect(book.mailOf(a), 'a principal\'s mail is the book filtered to it').toEqual(
      kept.filter((e) => e.from === a || e.to === a),
    );
    expect(book.mailOf(c)).toEqual(kept.filter((e) => e.from === c || e.to === c));
    expect(book.droppedCount).toBe(gone);
    expect(book.retire(now), 'idempotent at one tick').toBe(0);

    const copy = new ParleyBook();
    copy.restore(book.all, book.droppedCount);
    expect(copy.all).toEqual(book.all);
    expect(copy.mailOf(b)).toEqual(book.mailOf(b));
    expect(copy.droppedCount).toBe(book.droppedCount);

    const small = new ParleyBook(1);
    small.push(letter(0));
    expect(() => small.push(letter(1)), 'past the cap is a bug, never an eviction').toThrow(/cap/);
    expect(() => small.restore([letter(0), letter(1)], 0)).toThrow(/cap/);
  });
});
