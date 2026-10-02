/**
 * ★ **THE OFFER BOOK STANDS — EVERY PRINCIPAL KEEPS ITS STANDING OFFER FOR ITS WHOLE WINDOW, HOWEVER
 * MUCH ANYBODY ELSE PUBLISHES** (`say/offer.ts` §2).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The book was a 256-row ring for the whole world that evicted its oldest row. Two things followed, and
 * neither is display: the directory lists a principal as OFFERING by its latest offer, and the OFFER
 * reach rung makes it addressable by the same row (`say/directory.ts:freshOfferOf`).
 *
 *   - **At launch volume a fresh offer left the board inside its own 288-tick freshness window** — 257
 *     offers anywhere in the world in a Reckoning was enough;
 *   - **one principal publishing every tick cleared the board of everybody else** — and with it their
 *     directory rows and the openings their advertisements were supposed to invite.
 *
 * The book now holds each principal's STANDING offer (SPEC §7.3, *"a standing price list"*: a new one
 * replaces the last, which is the only one the freshness rule ever read) and `EXPIRE` retires it once
 * no freshness read can say yes. These tests hold it to that:
 *
 *   1. **A spammer holds one row**, and 280 of its offers in one window — more than the old ring held —
 *      leave another principal's offer on the board, in the directory and on the reach rung.
 *   2. **The window is exact**: listed at 288 ticks old, retired at 289 — never a tick early.
 *   3. **The size is a function of the population**: a thousand authors, a thousand rows; a captured
 *      book comes back exactly, and a capture `push` could not have produced is refused.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { readSayCapture, sayCapture } from '../../src/say/capture.js';
import { DIRECTORY_OFFER_FRESH_TICKS } from '../../src/say/directory.js';
import { MAX_OFFER_ENTRIES, OfferBook, offerLastReadTick, type OfferEntry } from '../../src/say/offer.js';
import type { Runtime } from '../../src/sim/runtime.js';
import { act, contactWorld, observe, runTo, submit, tick } from './contact-fixture.js';

type Row = Readonly<Record<string, unknown>>;

const READER = 'p:oreader' as PrincipalId;
const VICTIM = 'p:ovictim' as PrincipalId;
const SPAMMER = 'p:ospammer' as PrincipalId;

/** More offers than the old ring held, all inside one freshness window. */
const SPAM = 280;

function directoryRows(runtime: Runtime, reader: PrincipalId): readonly Row[] {
  const directory = observe(runtime, reader).ventures['directory'] as Readonly<Record<string, unknown>>;
  return directory['rows'] as readonly Row[];
}

function listedAsOffering(runtime: Runtime, reader: PrincipalId, principal: PrincipalId): string | null {
  const row = directoryRows(runtime, reader).find((r) => r['principal'] === principal);
  const offering = row?.['offering'] as Row | null | undefined;
  return (offering?.['text'] as string | undefined) ?? null;
}

function reachRungFor(runtime: Runtime, reader: PrincipalId, principal: PrincipalId): string | null {
  return runtime.reachFor(reader, runtime.engine.tick).find((r) => r.principal === principal)?.why ?? null;
}

function offersBy(runtime: Runtime, principal: PrincipalId): readonly OfferEntry[] {
  return runtime.publishedOffers().filter((o) => o.by === principal);
}

describe('★ 1. one principal publishing every tick holds one row, and clears nobody else', () => {
  it(`leaves another principal's offer listed and addressable through ${String(SPAM)} offers of its own`, () => {
    const w = contactWorld('offer-book-stands', [READER, VICTIM, SPAMMER]);
    expect(act(w.runtime, VICTIM, 'publish_offer', { text: 'HANDS FOR HIRE — 8% OF CARGO' })).toBeNull();
    const published = offersBy(w.runtime, VICTIM)[0]?.tick;
    if (published === undefined) throw new Error('the offer did not reach the book');

    for (let i = 0; i < SPAM; i += 1) {
      submit(w.runtime, SPAMMER, 'publish_offer', { text: `CHEAPEST HANDS IN THE GALAXY ${String(i)}` });
      tick(w.runtime);
      expect(w.runtime.takeCorrections(SPAMMER)[0], `spam offer ${String(i)} lands`).toBeUndefined();
    }
    expect(w.runtime.engine.tick - published, 'still inside the victim offer\'s window').toBeLessThanOrEqual(
      DIRECTORY_OFFER_FRESH_TICKS,
    );

    expect(offersBy(w.runtime, SPAMMER).map((o) => o.text), 'the spammer holds its STANDING offer — one row').toEqual([
      `CHEAPEST HANDS IN THE GALAXY ${String(SPAM - 1)}`,
    ]);
    expect(
      offersBy(w.runtime, VICTIM).map((o) => o.text),
      'MUTATION: the old 256-row ring evicted this at the spammer\'s 256th offer',
    ).toEqual(['HANDS FOR HIRE — 8% OF CARGO']);
    expect(w.runtime.publishedOffers(), 'the book is one row per author, nothing else').toHaveLength(2);

    expect(listedAsOffering(w.runtime, READER, VICTIM), 'the directory still lists it as offering').toBe(
      'HANDS FOR HIRE — 8% OF CARGO',
    );
    expect(reachRungFor(w.runtime, READER, VICTIM), 'and its advertisement still makes it addressable').toBe('OFFER');

    const board = observe(w.runtime, READER).market['offers'] as readonly Row[];
    expect(board.filter((o) => o['by'] === VICTIM), 'market.offers still shows it').toHaveLength(1);
    expect(board.filter((o) => o['by'] === SPAMMER), 'and shows the spammer once').toHaveLength(1);
  });
});

describe('★ 2. the window is exact — listed for its whole freshness window, retired the tick after', () => {
  it(`keeps an offer through ${String(DIRECTORY_OFFER_FRESH_TICKS)} ticks and retires it at the next`, () => {
    const w = contactWorld('offer-book-window', [READER, VICTIM]);
    expect(act(w.runtime, VICTIM, 'publish_offer', { text: 'ALLOY AT 12' })).toBeNull();
    const published = offersBy(w.runtime, VICTIM)[0]?.tick;
    if (published === undefined) throw new Error('the offer did not reach the book');
    expect(offerLastReadTick({ tick: published })).toBe(published + DIRECTORY_OFFER_FRESH_TICKS);

    runTo(w.runtime, published + DIRECTORY_OFFER_FRESH_TICKS);
    expect(offersBy(w.runtime, VICTIM), 'MUTATION: retire a tick early and this is gone').toHaveLength(1);
    expect(listedAsOffering(w.runtime, READER, VICTIM), 'still fresh at exactly the window').toBe('ALLOY AT 12');
    expect(reachRungFor(w.runtime, READER, VICTIM)).toBe('OFFER');

    tick(w.runtime);
    expect(offersBy(w.runtime, VICTIM), 'retired once no freshness read can say yes').toHaveLength(0);
    expect(listedAsOffering(w.runtime, READER, VICTIM), 'and listed by nothing').toBeNull();
    expect(reachRungFor(w.runtime, READER, VICTIM), 'and addressable through nothing').not.toBe('OFFER');
    expect(observe(w.runtime, READER).market['offers'], 'the board is empty').toEqual([]);
  });

  it('a republished offer starts its window again', () => {
    const w = contactWorld('offer-book-renew', [READER, VICTIM]);
    expect(act(w.runtime, VICTIM, 'publish_offer', { text: 'ALLOY AT 12' })).toBeNull();
    const first = offersBy(w.runtime, VICTIM)[0]?.tick ?? -1;
    runTo(w.runtime, first + 200);
    expect(act(w.runtime, VICTIM, 'publish_offer', { text: 'ALLOY AT 11' })).toBeNull();
    runTo(w.runtime, first + DIRECTORY_OFFER_FRESH_TICKS + 50);
    expect(offersBy(w.runtime, VICTIM).map((o) => o.text), 'the new price stands, the old one is gone').toEqual([
      'ALLOY AT 11',
    ]);
    expect(listedAsOffering(w.runtime, READER, VICTIM)).toBe('ALLOY AT 11');
  });
});

describe('★ 3. a population book', () => {
  const entry = (by: string, tick: number, text = 'OFFER'): OfferEntry => ({ by: by as PrincipalId, text, tick });

  it('holds a thousand authors — four times the old world-wide ring — and one row each however often they publish', () => {
    const book = new OfferBook();
    for (let i = 0; i < 1_000; i += 1) book.push(entry(`p:author${String(i)}`, i));
    for (let t = 1_000; t < 2_000; t += 1) book.push(entry('p:author7', t, `SPAM ${String(t)}`));
    expect(book.size).toBe(1_000);
    expect(book.of('p:author0' as PrincipalId)?.tick, 'the first author is untouched').toBe(0);
    expect(book.of('p:author7' as PrincipalId)?.text).toBe('SPAM 1999');
    expect(book.all.at(-1)?.by, 'a republished offer moves to the back: publish order').toBe('p:author7');
    expect(book.droppedCount, 'replaced offers have left the book, and the meter says so').toBe(1_000);
    expect(MAX_OFFER_ENTRIES).toBeGreaterThanOrEqual(10_000);
  });

  it('retires exactly a prefix — the offers no freshness read can see — and counts them', () => {
    const book = new OfferBook();
    for (let i = 0; i < 10; i += 1) book.push(entry(`p:a${String(i)}`, i * 10));
    expect(book.retire(50 + DIRECTORY_OFFER_FRESH_TICKS)).toBe(5);
    expect(book.all.map((o) => o.tick)).toEqual([50, 60, 70, 80, 90]);
    expect(book.retire(50 + DIRECTORY_OFFER_FRESH_TICKS), 'idempotent at the same tick').toBe(0);
    expect(book.droppedCount).toBe(5);
  });

  it('comes back from the say table exactly, and refuses a capture push could not have produced', () => {
    const book = new OfferBook();
    book.push(entry('p:x', 3, 'HANDS'));
    book.push(entry('p:y', 4, 'ALLOY'));
    book.push(entry('p:x', 9, 'HANDS, CHEAPER'));
    const captured = readSayCapture(
      sayCapture({ parleys: [], parleysDropped: 0, offers: book.all, offersDropped: book.droppedCount }),
    );
    const back = new OfferBook();
    back.restore(captured.offers, captured.offersDropped);
    expect(back.all).toEqual(book.all);
    expect(back.droppedCount).toBe(1);

    expect(() => new OfferBook().restore([entry('p:x', 1), entry('p:x', 2)], 0), 'two standing offers').toThrow(
      /second standing offer/,
    );
    expect(() => new OfferBook().restore([entry('p:x', 5), entry('p:y', 2)], 0), 'out of publish order').toThrow(
      /publish order/,
    );
    expect(() => new OfferBook(1).restore([entry('p:x', 1), entry('p:y', 2)], 0), 'past the cap').toThrow(/cap/);
    expect(() => {
      const full = new OfferBook(1);
      full.push(entry('p:x', 1));
      full.push(entry('p:y', 2));
    }, 'the tripwire is loud, and never evicts').toThrow(/cap/);
  });
});
