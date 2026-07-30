/**
 * **A CAP THAT DROPS A ROW MUST DROP THE LEAST URGENT ONE.**
 *
 * `raidViewsFor` carried this comment above its slice:
 *
 * > *"Own rows first **and never truncated**: the reader's own deadline outranks somebody else's, and
 * > a widened radius that pushed a target's own standoff off the end of the list would be a
 * > regression dressed as a feature."*
 *
 * The second clause was false above `limit`, and the sentence was three lines above the code that
 * falsified it. `Book.forPrincipal` returns rows in **every** state, the book retains up to
 * `MAX_RAID_ROWS` (96), and the agent path passes `limit = 24` — so a principal party to more than 24
 * standoffs silently lost its own.
 *
 * Worse than the truncation was the **order**: there was no comparator at all. The drop fell in
 * `Book.all()` order, which is `compareIds` over `raid:{tick}:{index}` — lexicographic on a
 * *stringified* tick, so `raid:1000:0` sorts before `raid:99:0`. The rows lost were therefore neither
 * the oldest nor the newest nor the least urgent. They were arbitrary, and a dropped own-row is a
 * demand with a countdown against the reader that the reader is never shown.
 *
 * This is the test that would have caught it. Every existing `raidViewsFor` test passes a limit above
 * the number of raids it builds (`runtime.raidsFor(..., 8)` with a handful), so the cap was never
 * reached by anything — the exact shape of all six of this repo's cap defects.
 *
 * ── MUTATION ────────────────────────────────────────────────────────────────
 *
 * Delete the `.sort(byUrgency)` calls in `predation/view.ts:raidViewsFor` and the second and third
 * cases below must go red. Restoring only one of the two sorts must also fail the third.
 */

import { describe, expect, it } from 'vitest';

import type { GoodId, HandId, PrincipalId, SystemId, ZoneTier } from '../../src/core/types.js';
import { minor, qty, type Qty } from '../../src/core/units.js';
import { Book, raidIdFor, type RaidRecord } from '../../src/predation/book.js';
import { raidViewsFor, type RaidViewPort } from '../../src/predation/view.js';

const TARGET = 'p:target' as PrincipalId;
const GOOD = 'ration' as GoodId;
const STAGE = 'sys-a' as SystemId;

/** A minimal port: nothing here is under test except the ordering of the rows that survive. */
const PORT: RaidViewPort = {
  tierOf: (): ZoneTier => 'MARCHES',
  handsDefending: (): readonly HandId[] => [],
  standingOf: (): Qty => qty(0),
  worksAt: () => [],
  raidForceLeft: () => null,
  marchTo: () => null,
  swayAt: () => 0,
};

function raid(spawnTick: number, index: number, resolvesAtTick: number, state: RaidRecord['state']): RaidRecord {
  return {
    id: raidIdFor(spawnTick, index),
    initiator: null,
    target: TARGET,
    stage: STAGE,
    good: GOOD,
    demandQty: qty(100),
    force: 1,
    spawnedAtTick: spawnTick,
    resolvesAtTick,
    state,
    answer: null,
    answeredAtTick: null,
    parties: [],
    resolvedAtTick: state === 'DEMANDED' ? null : resolvesAtTick,
    lostQty: qty(0),
    forfeited: minor(0),
    defenderForce: 0,
    raiderForce: 0,
  };
}

describe('raidViewsFor: the cap keeps the reader’s most urgent own standoffs', () => {
  it('the fixture really does exceed the cap, or the two cases below prove nothing', () => {
    // Non-vacuity, first and deliberately. Every pre-existing test of this function passed a limit
    // ABOVE the row count, so the slice never ran; a fixture that did the same here would restate that
    // omission as a passing test.
    const book = new Book();
    for (let i = 0; i < 30; i += 1) book.spawn(raid(1_000, i, 2_000 + i, 'DEMANDED'));
    expect(book.forPrincipal(TARGET).length).toBe(30);
    expect(book.forPrincipal(TARGET).length).toBeGreaterThan(24);
  });

  it('keeps the SOONEST-resolving own rows when there are more than the limit', () => {
    const book = new Book();
    // Deadlines deliberately anti-correlated with the id order: raid index 0 resolves LAST. Under the
    // old code the survivors were `Book.all()`'s first 5 — indices 0..4, the five least urgent.
    const count = 30;
    for (let i = 0; i < count; i += 1) {
      book.spawn(raid(1_000, i, 5_000 - i, 'DEMANDED'));
    }
    const views = raidViewsFor({ book, port: PORT, principal: TARGET, tick: 1_500, limit: 5 });
    expect(views).toHaveLength(5);

    const kept = views.map((v) => v.resolves_tick);
    const soonest = [4_971, 4_972, 4_973, 4_974, 4_975]; // indices 29..25
    expect(kept, 'the cap must drop the far deadlines, never the near ones').toEqual(soonest);
  });

  it('sorts LIVE standoffs ahead of settled ones, so a countdown is never dropped for a closed row', () => {
    const book = new Book();
    // 20 already-resolved rows with early ids, then 4 live ones with late ids. Lexicographic id order
    // put the closed rows first, so a limit of 4 published four rows with nothing left to decide.
    for (let i = 0; i < 20; i += 1) book.spawn(raid(1_000, i, 1_100 + i, 'REPULSED'));
    for (let i = 0; i < 4; i += 1) book.spawn(raid(9_000, i, 9_500 + i, 'DEMANDED'));
    expect(book.forPrincipal(TARGET).length).toBe(24);

    const views = raidViewsFor({ book, port: PORT, principal: TARGET, tick: 9_100, limit: 4 });
    expect(views).toHaveLength(4);
    expect(
      views.map((v) => v.state),
      'every surviving row must be the live one; a resolved raid has no decision left in it',
    ).toEqual(['DEMANDED', 'DEMANDED', 'DEMANDED', 'DEMANDED']);
  });

  it('is stable under insertion order, so two hosts publish the same rows', () => {
    // DET: the comparator must be total. `Book.all()` is id-ordered, but the *inputs* here arrive in
    // opposite sequences, and a comparator that fell back on insertion would diverge on replay.
    const forward = new Book();
    const backward = new Book();
    const rows = Array.from({ length: 12 }, (_, i) => raid(1_000, i, 3_000 - i, 'DEMANDED'));
    for (const r of rows) forward.spawn(r);
    for (const r of [...rows].reverse()) backward.spawn(r);

    const a = raidViewsFor({ book: forward, port: PORT, principal: TARGET, tick: 1_500, limit: 5 });
    const b = raidViewsFor({ book: backward, port: PORT, principal: TARGET, tick: 1_500, limit: 5 });
    expect(a.map((v) => v.raid)).toEqual(b.map((v) => v.raid));
  });
});
