/**
 * ★ **A WORKS ONLY DIVIDES THE YIELD WHILE ITS HOLDER PLAYS — DORMANT** (`RULES_VERSION` 41).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Measured on the live world on 2026-10-01: three QA identities that played only on day one, and one
 * outside agent idle since tick ~3,170, still held WORKS taking **18.5% of world output** (160 of 864
 * ore a tick), and on three Commons systems they halved the income of the one active player sharing
 * each. A WORKS kept dividing its system's yield whether or not anybody behind it was still playing.
 *
 * The rule: a principal with no ACCEPTED action for `WORKS_DORMANT_AFTER_RECKONINGS` Reckonings is
 * DORMANT, and its WORKS neither extracts nor counts in its system's split. Nothing is confiscated
 * (R19, A10) and it resumes the tick after the principal acts again.
 *
 * This file is the arithmetic, against the book alone. `dormant-works-in-a-world.spec.ts` is the same
 * claim played through a seeded heuristic world, the frame and the observation.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { IDLE_SEAT_TICKS } from '../../src/api/seats.js';
import { Book, worksStateTable } from '../../src/works/book.js';
import { checkYieldCap } from '../../src/works/invariants.js';
import { launchMap } from '../../src/world/map.js';
import {
  DORMANT_STATEMENT,
  WORKS_DORMANT_AFTER_RECKONINGS,
  WORKS_DORMANT_AFTER_TICKS,
  WORKS_SPINUP_TICKS,
  YIELD_PER_TICK,
} from '../../src/works/params.js';

const SYS = 'sys-01' as SystemId;
const ACTIVE = 'p:active' as PrincipalId;
const ABSENT = 'p:absent' as PrincipalId;
const YIELD = YIELD_PER_TICK.COMMONS;

function shares(book: Book, tick: number): Map<PrincipalId, number> {
  const out = new Map<PrincipalId, number>();
  for (const [id, amount] of book.sharesAt(SYS, YIELD, tick)) {
    const w = book.at(id);
    if (w !== null) out.set(w.holder, amount);
  }
  return out;
}

/** Two WORKS on one Commons system, both raised at tick 0, and one holder that keeps playing. */
function pair(): Book {
  const book = new Book();
  book.raise({ system: SYS, holder: ACTIVE, tick: 0 });
  book.raise({ system: SYS, holder: ABSENT, tick: 0 });
  return book;
}

describe('the rules surface says it once', () => {
  it('★ DORMANT_STATEMENT is in agent.md verbatim, and the observation carries it', () => {
    const agentMd = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');
    const normalised = agentMd.replace(/\n> ?/g, ' ').replace(/[ \t]+/g, ' ');
    expect(normalised).toContain(DORMANT_STATEMENT.replace(/[ \t]+/g, ' '));
    // The observe block that carries the rule beside the agent's own WORKS.
    const observeSrc = readFileSync(new URL('../../src/api/observe.ts', import.meta.url), 'utf8');
    expect(observeSrc).toContain('dormant_rule: DORMANT_STATEMENT');
  });
});

describe('the clock is the seat lease’s clock', () => {
  it('★ four Reckonings, the same span after which a played seat is recycled', () => {
    // Two constants on purpose — one is a host resource, one a world rule — pinned to agree so the
    // world and the host never disagree about when a principal stopped playing.
    expect(WORKS_DORMANT_AFTER_RECKONINGS).toBe(4);
    expect(WORKS_DORMANT_AFTER_TICKS).toBe(TICKS_PER_RECKONING * WORKS_DORMANT_AFTER_RECKONINGS);
    expect(WORKS_DORMANT_AFTER_TICKS).toBe(IDLE_SEAT_TICKS);
    // And longer than the three Reckonings R19 promises are harmless.
    expect(WORKS_DORMANT_AFTER_TICKS).toBeGreaterThan(TICKS_PER_RECKONING * 3);
  });
});

describe('a DORMANT WORKS divides nothing, and its neighbours divide the whole yield', () => {
  it('★ splits 40/40, then gives the whole 80 to the one still playing, then splits again on return', () => {
    const book = pair();
    const online = WORKS_SPINUP_TICKS + 1;
    // Non-vacuity: both share while both are fresh.
    expect(shares(book, online)).toEqual(new Map([[ACTIVE, YIELD / 2], [ABSENT, YIELD / 2]]));

    // The active holder plays once a Reckoning; the absent one never again after raising its WORKS.
    for (let t = TICKS_PER_RECKONING; t < WORKS_DORMANT_AFTER_TICKS * 2; t += TICKS_PER_RECKONING) {
      book.notePlayed(ACTIVE, t);
    }
    // One tick before the lease runs out, still sharing.
    expect(shares(book, WORKS_DORMANT_AFTER_TICKS - 1).get(ABSENT)).toBe(YIELD / 2);
    expect(book.isDormant(ABSENT, WORKS_DORMANT_AFTER_TICKS - 1)).toBe(false);
    // From the first tick of the fifth Reckoning: DORMANT.
    const asleep = WORKS_DORMANT_AFTER_TICKS;
    expect(book.isDormant(ABSENT, asleep)).toBe(true);
    expect(book.dormantFromTick(ABSENT)).toBe(asleep);
    const whileAsleep = shares(book, asleep);
    expect(whileAsleep.get(ABSENT), 'a dormant WORKS takes no share').toBeUndefined();
    expect(whileAsleep.get(ACTIVE), 'and does not dilute the one still playing').toBe(YIELD);
    expect(book.extractorsAt(SYS, asleep)).toBe(1);
    // Nothing was confiscated: the WORKS still stands, with its history.
    expect(book.liveAt(SYS)).toHaveLength(2);
    expect(book.ofPrincipal(ABSENT)[0]?.razed).toBe(false);

    // The holder acts. The tick after, it works again — the book's half of "the tick after".
    const back = asleep + 100;
    book.notePlayed(ABSENT, back);
    expect(book.isDormant(ABSENT, back + 1)).toBe(false);
    expect(shares(book, back + 1)).toEqual(new Map([[ACTIVE, YIELD / 2], [ABSENT, YIELD / 2]]));
  });

  it('A15 is untouched: whoever is asleep, Σ shares is exactly the yield while anybody works', () => {
    const book = new Book();
    const holders = [0, 1, 2, 3, 4].map((n) => `p:h${String(n)}` as PrincipalId);
    for (const h of holders) book.raise({ system: SYS, holder: h, tick: 0 });
    const later = WORKS_DORMANT_AFTER_TICKS + 10;
    // Wake two of five; three stay dormant.
    book.notePlayed(holders[0] as PrincipalId, later - 5);
    book.notePlayed(holders[3] as PrincipalId, later - 5);
    const split = [...book.sharesAt(SYS, YIELD, later).values()];
    expect(split).toHaveLength(2);
    expect(split.reduce((a, b) => a + b, 0)).toBe(YIELD);
    // And INV-W1's cap holds over the same book.
    const map = launchMap();
    expect(checkYieldCap({ book, map, tick: later })).toEqual([]);
  });

  it('a system whose every WORKS is dormant yields nothing at all — no faucet looking for an owner', () => {
    const book = pair();
    const late = WORKS_DORMANT_AFTER_TICKS + 1;
    expect(book.sharesAt(SYS, YIELD, late).size).toBe(0);
    expect(book.extractorsAt(SYS, late)).toBe(0);
  });

  it('notePlayed is monotone, and ignores a principal that never raised a WORKS (bounded, INV-26)', () => {
    const book = pair();
    book.notePlayed(ACTIVE, 500);
    book.notePlayed(ACTIVE, 400);
    expect(book.lastPlayedTick(ACTIVE)).toBe(500);
    book.notePlayed('p:stranger' as PrincipalId, 600);
    expect(book.lastPlayedTick('p:stranger' as PrincipalId)).toBeNull();
    // With no record a holder is NOT dormant — absence of evidence is not read as absence.
    expect(book.isDormant('p:stranger' as PrincipalId, 1_000_000)).toBe(false);
  });

  it('the clock is inside the hash: capture → restore reproduces it, and a pre-41 capture reads awake', () => {
    let book = pair();
    book.notePlayed(ACTIVE, 700);
    const table = worksStateTable(
      () => book,
      (b) => {
        book = b;
      },
    );
    const captured = table.capture();
    table.restore?.(captured);
    expect(book.lastPlayedTick(ACTIVE)).toBe(700);
    expect(book.lastPlayedTick(ABSENT)).toBe(0);
    expect(JSON.stringify(table.capture())).toBe(JSON.stringify(captured));

    // A capture written before the clock existed has no `played` key; restored, nobody is dormant.
    const legacy = JSON.parse(JSON.stringify(captured)) as Record<string, unknown>;
    delete legacy['played'];
    table.restore?.(legacy as never);
    expect(book.isDormant(ABSENT, WORKS_DORMANT_AFTER_TICKS * 3)).toBe(false);
  });
});
