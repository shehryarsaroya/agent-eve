/**
 * The resolution arithmetic and the target rule — the two things §9 makes *rules* rather
 * than rolls.
 *
 * Pure functions here, no runtime. The wired half is `wired.test.ts`; this file exists so
 * that when the wired test says "the raid was repulsed" there is a separate proof of what
 * that phrase means arithmetically.
 */

import { describe, expect, it } from 'vitest';
import type { HandId, PrincipalId, SystemId } from '../../src/core/types.js';
import { minor, qty } from '../../src/core/units.js';
import {
  Book,
  FORCE_BY_TIER,
  RAID_DEMAND_QTY,
  RAID_MAX_TAKE_BPS,
  RAID_MIN_TARGET_QTY,
  RAID_TAKE_MULTIPLE,
  RAID_VICTIM_COOLDOWN_TICKS,
  demandFor,
  payFor,
  rankCandidates,
  readForce,
  takeFor,
  type AssailablePile,
  type RaidParty,
  type TargetPort,
} from '../../src/predation/index.js';
import { GOOD, raidRow } from './fixture.js';
import { SWAY_AT_SEAT } from '../../src/world/index.js';

function party(principal: string, side: 'RAIDER' | 'DEFENDER'): RaidParty {
  return {
    principal: principal as PrincipalId,
    side,
    handId: `${principal}#1` as HandId,
    stake: side === 'RAIDER' ? minor(500) : minor(0),
    encumbranceId: side === 'RAIDER' ? `enc:${principal}` : null,
    joinedAtTick: 50,
  };
}

/**
 * Every joiner's hand is still standing at the stage. The ordinary case, and the one the
 * arithmetic tests below are about — `presence.test.ts` owns the case where it is not.
 */
function allPresent(raid: { readonly parties: readonly RaidParty[] }) {
  return (principal: PrincipalId): readonly HandId[] =>
    raid.parties.filter((p) => p.principal === principal).map((p) => p.handId);
}

/**
 * No battle is counting this raid's hulls, so its drawn force stands.
 *
 * `null` and not `0`, and the difference is the point: `0` would say *"the raid has been wiped
 * out"*, which is a repulse nobody fought for. Every arithmetic test below that is about hands and
 * terrain uses this, so it measures what it always measured.
 */
const noBattle = () => null;

/**
 * ★ §16.12 #1's SWAY term, held at full for every arithmetic test in this file.
 *
 * `noBattle`'s reason, applied to the other new term: these tests measure hands, joiners and
 * terrain, so the capacity limit is pinned open and they measure what they always measured. The
 * cap's own arithmetic — including that a raider at 0 contributes nothing and shows up in
 * `raidersOutOfSway` — is asserted in `test/world/the-map-has-borders.spec.ts` against the
 * engine's own reading rather than against a fixture built beside the assertion.
 */
const fullSway = () => SWAY_AT_SEAT;


describe('force is arithmetic and higher wins — no dice, no rounds, no positioning', () => {
  it('sums hands, joiners and terrain, and publishes every term', () => {
    const raid = raidRow({ force: 3, parties: [party('p:a', 'DEFENDER'), party('p:b', 'RAIDER')] });
    const reading = readForce({ raid, tier: 'MARCHES', defenderHands: 2, handsAtStage: allPresent(raid), raidForceLeft: noBattle, swayAt: fullSway });

    // ── ★ AT 35 THE ALLY TERMS ARE HANDS, NOT PARTY ROWS ────────────────────
    //
    // defender: 2 target hands + `allPresent` hands for the one DEFENDER ally + 1 terrain.
    // raider: the raid's own 3 + `min(hands standing, sway)` for the one RAIDER ally.
    //
    // `allPresent(raid)` answers every party's own hand at the stage, so each ally supplies 1 here
    // and the sums are unchanged at 4 and 4 — which is the point: this fixture has one hand per ally,
    // so the unit change is invisible in the TOTAL and visible only in the new terms. The arithmetic
    // that separates hands from rows is asserted where it can bind, two tests down.
    expect(reading.terms).toEqual({
      defenderHands: 2,
      defenderJoiners: 1,
      defenderAllyHands: 1,
      terrain: FORCE_BY_TIER['MARCHES'],
      raidForce: 3,
      raidForceAtSpawn: 3,
      raiderHands: 1,
      raiderJoiners: 1,
      // ★ §16.12 #1's meter. Zero here because `fullSway` holds the capacity limit open for every
      // arithmetic test in this file; it is asserted non-zero in
      // `test/world/the-map-has-borders.spec.ts`, where a raider is genuinely out of reach. The
      // field is in this exhaustive comparison on purpose — `toEqual` over the whole `terms` object
      // is what makes a NEW published term impossible to add without a reader noticing.
      raidersOutOfSway: 0,
    });
    expect(reading.defenderForce).toBe(4);
    expect(reading.raiderForce).toBe(4);
  });

  it('ties go to the defender, and that is a published rule rather than a rounding accident', () => {
    const raid = raidRow({ force: 3 });
    // 3 hands + 0 terrain in the FRONTIER == the raid's 3. Exactly level.
    const level = readForce({ raid, tier: 'FRONTIER', defenderHands: 3, handsAtStage: allPresent(raid), raidForceLeft: noBattle, swayAt: fullSway });
    expect(level.defenderForce).toBe(level.raiderForce);
    expect(level.verdict).toBe('REPULSED');

    const short = readForce({ raid, tier: 'FRONTIER', defenderHands: 2, handsAtStage: allPresent(raid), raidForceLeft: noBattle, swayAt: fullSway });
    expect(short.verdict).toBe('PLUNDERED');
  });

  it('an unanswered raid has no defence at all — silence is the expensive answer (A14)', () => {
    const raid = raidRow({ force: 2 });
    expect(readForce({ raid, tier: 'FRONTIER', defenderHands: 0, handsAtStage: allPresent(raid), raidForceLeft: noBattle, swayAt: fullSway }).verdict).toBe(
      'PLUNDERED',
    );
  });

  it('the Frontier gives no terrain bonus and the Marches gives one', () => {
    const raid = raidRow({ force: 2 });
    expect(readForce({ raid, tier: 'FRONTIER', defenderHands: 1, handsAtStage: allPresent(raid), raidForceLeft: noBattle, swayAt: fullSway }).defenderForce).toBe(1);
    expect(readForce({ raid, tier: 'MARCHES', defenderHands: 1, handsAtStage: allPresent(raid), raidForceLeft: noBattle, swayAt: fullSway }).defenderForce).toBe(2);
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════
 * **WINNING THE BATTLE MUST WIN THE STANDOFF — the arithmetic half.**
 *
 * The defect these tests were written from, measured: seed `fz-13` tick 192. `brannock` answered
 * FIGHT with one missile WARDEN, **destroyed all three world LANCEs**, held the field at 2,395 EHP of
 * 4,400 — and the standoff resolved **PLUNDERED 2-3**, because `raiderForce` read `raid.force` off
 * the record and `applyLoss` returns early on a world hull. `engage` against the weather was
 * therefore all downside: hulls are destroyed permanently and could not move the outcome, so YIELD
 * was the only rational answer and A14's scheduled drama rendered identically to peace.
 *
 * The wired half — that this actually fires in a world nobody steers — is
 * `test/combat/the-cast-goes-to-war.spec.ts`. This file owns what the phrase means arithmetically.
 *
 * MUTATION: in `readForce`, restore `const raidForce = args.raid.force` — every `it` below goes red
 * except the two that assert nothing changed.
 * ══════════════════════════════════════════════════════════════════════════
 */
describe("★ the raid's own force is measured at resolution, not drawn once at spawn", () => {
  it('a destroyed world fleet takes the raid down with it — a repulse the defender earned', () => {
    const raid = raidRow({ force: 3 });
    // Two hands on the Frontier: 2 against 3, which is exactly the reading `fz-13` lost on.
    const before = readForce({ raid, tier: 'FRONTIER', defenderHands: 2, handsAtStage: allPresent(raid), raidForceLeft: noBattle, swayAt: fullSway });
    expect(before.verdict, 'the pre-fix reading, kept as the contrast').toBe('PLUNDERED');

    const wiped = readForce({
      raid,
      tier: 'FRONTIER',
      defenderHands: 2,
      handsAtStage: allPresent(raid),
      raidForceLeft: () => 0, swayAt: fullSway,
    });
    expect(wiped.raiderForce, 'nothing of the raid is left on the field').toBe(0);
    expect(wiped.terms.raidForce).toBe(0);
    expect(wiped.terms.raidForceAtSpawn, 'and what it arrived with is still on the record').toBe(3);
    expect(wiped.verdict).toBe('REPULSED');
  });

  it('a HALF-destroyed fleet still takes the goods — the losing branch A14 needs', () => {
    // The over-correction guard. A mechanic with no losing branch has no drama, and if defending
    // always beat yielding the Levy's raid pressure would evaporate. Two of five LANCEs dead is a
    // battle the defender did not win, and the standoff says so.
    const raid = raidRow({ force: 5 });
    const partial = readForce({
      raid,
      tier: 'FRONTIER',
      defenderHands: 2,
      handsAtStage: allPresent(raid),
      raidForceLeft: () => 3, swayAt: fullSway,
    });
    expect(partial.raiderForce).toBe(3);
    expect(partial.verdict).toBe('PLUNDERED');
  });

  it('never hands the raid strength it was never given, whatever the book says', () => {
    // The cap is `Math.min` against the spawn draw. A book that reported more hulls than the raid
    // was ever fielded would otherwise make the world stronger for having been fought.
    const raid = raidRow({ force: 2 });
    const inflated = readForce({
      raid,
      tier: 'MARCHES',
      defenderHands: 9,
      handsAtStage: allPresent(raid),
      raidForceLeft: () => 99, swayAt: fullSway,
    });
    expect(inflated.raiderForce).toBe(2);
    expect(inflated.terms.raidForce).toBe(2);
  });

  it('a negative reading is clamped rather than turned into a bonus for the raid', () => {
    const raid = raidRow({ force: 3 });
    const reading = readForce({
      raid,
      tier: 'FRONTIER',
      defenderHands: 1,
      handsAtStage: allPresent(raid),
      raidForceLeft: () => -4,
      swayAt: fullSway,
    });
    expect(reading.raiderForce).toBe(0);
  });

  it('NULL is not zero: no battle means the drawn force stands, and nobody wins for free', () => {
    // The A5′ half. `null` reaches `readForce` from three roads — the standoff was never answered
    // FIGHT, the engagement book has no row for it (pruned, or never opened), or the world's fleet
    // was never fielded. Reading any of those as 0 would write a repulse nobody fought for against
    // a real agent's name, permanently.
    const raid = raidRow({ force: 3 });
    const reading = readForce({
      raid,
      tier: 'FRONTIER',
      defenderHands: 2,
      handsAtStage: allPresent(raid),
      raidForceLeft: noBattle, swayAt: fullSway,
    });
    expect(reading.raiderForce).toBe(3);
    expect(reading.verdict).toBe('PLUNDERED');
  });

  it("a demand's zero force is untouched by any of this — all of its force is hands", () => {
    // An agent-initiated demand carries `DEMAND_OWN_FORCE` = 0 and brings no fleet, so
    // `worldForceLeft` reports `null` and the initiator's own strength is counted the way every
    // other party's is: as a RAIDER party's hand at the stage.
    const raid = raidRow({ force: 0, parties: [party('p:raider', 'RAIDER')] });
    const reading = readForce({
      raid,
      tier: 'FRONTIER',
      defenderHands: 0,
      handsAtStage: allPresent(raid),
      raidForceLeft: noBattle, swayAt: fullSway,
    });
    expect(reading.terms.raidForce).toBe(0);
    expect(reading.raiderForce, "one raider joiner's hand and nothing else").toBe(1);
    expect(reading.verdict).toBe('PLUNDERED');
  });
});

describe('the demand is a function of the seed and NOT of what the target holds (§11.2)', () => {
  it('clamps a draw into the published band and never reads a stock', () => {
    // The signature itself is the guarantee: `demandFor` takes a draw and nothing else,
    // so there is no stockpile in scope for it to leak. An earlier design took the
    // target's standing stock and multiplied — a SENSED hold value recoverable from a
    // PUBLIC event through a published formula, which is the "Charge fuel gauge" shape.
    expect(demandFor(RAID_DEMAND_QTY.min - 1_000)).toBe(RAID_DEMAND_QTY.min);
    expect(demandFor(RAID_DEMAND_QTY.max + 1_000)).toBe(RAID_DEMAND_QTY.max);
    const mid = Math.floor((RAID_DEMAND_QTY.min + RAID_DEMAND_QTY.max) / 2);
    expect(demandFor(mid)).toBe(mid);
  });
});

describe('what a raid takes — and the two caps that keep an absent agent from ruin', () => {
  it('paying costs exactly the demand, capped at what is actually there', () => {
    expect(payFor(qty(3_000), qty(10_000))).toBe(3_000);
    expect(payFor(qty(3_000), qty(200))).toBe(200);
    expect(payFor(qty(3_000), qty(0))).toBe(0);
  });

  it('ignoring costs the multiple — strictly more than paying', () => {
    // Deep stock, so neither cap binds: the multiple is the whole difference between
    // the two branches, and it is the reason the window is a decision.
    const deep = qty(1_000_000);
    expect(takeFor(qty(3_000), deep)).toBe(3_000 * RAID_TAKE_MULTIPLE);
    expect(takeFor(qty(3_000), deep)).toBeGreaterThan(payFor(qty(3_000), deep));
  });

  it('never takes more than half of what is standing — "offline costs opportunity, not catastrophe"', () => {
    // A demand far above the stock. Without the cap, the multiple would clear the shelf.
    const standing = qty(1_000);
    const taken = takeFor(qty(9_999_999), standing);
    expect(taken).toBe(Math.floor((standing * RAID_MAX_TAKE_BPS) / 10_000));
    expect(taken).toBeLessThan(standing);
  });

  it('takes nothing from an empty place — the raid guessed wrong and hit ballast', () => {
    expect(takeFor(qty(6_000), qty(0))).toBe(0);
  });
});

describe('the target rule is published, deterministic, and cannot reach into the Commons', () => {
  function port(rows: Readonly<Record<string, readonly AssailablePile[]>>, hands: Readonly<Record<string, number>> = {}): TargetPort {
    return {
      principals: () => Object.keys(rows) as PrincipalId[],
      assailableOf: (p) => rows[p] ?? [],
      presentHandsAt: (p) => hands[p] ?? 0,
    };
  }

  function pile(location: string, amount: number): AssailablePile {
    return { lotId: `lot:${location}:${String(amount)}`, good: GOOD, qty: qty(amount), location: location as SystemId };
  }

  it('ranks by the most standing, then the fewest hands, then by id', () => {
    const ranked = rankCandidates(
      port(
        {
          'p:c': [pile('sys-1', 9_000)],
          'p:a': [pile('sys-2', 9_000)],
          'p:b': [pile('sys-3', 20_000)],
        },
        { 'p:c': 0, 'p:a': 3 },
      ),
      new Book(),
      100,
    );
    // Most standing first; then the level pair split by who is least defended; then id.
    expect(ranked.map((c) => c.principal)).toEqual(['p:b', 'p:c', 'p:a']);
  });

  it('skips anything below the minimum worth raiding', () => {
    const ranked = rankCandidates(port({ 'p:a': [pile('sys-1', RAID_MIN_TARGET_QTY - 1)] }), new Book(), 0);
    expect(ranked).toEqual([]);
  });

  it('sums per (place, good) and never across places — a raid happens at ONE stage', () => {
    // The D8 shape: an obligation computed across two systems is one the target cannot
    // discharge from where it is standing.
    const ranked = rankCandidates(
      port({ 'p:a': [pile('sys-1', 4_000), pile('sys-2', 3_000)] }),
      new Book(),
      0,
    );
    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.standing).toBe(4_000);
    expect(ranked[1]?.standing).toBe(3_000);
  });

  it('skips a principal inside its victim cooldown — scar #14, by name', () => {
    const book = new Book();
    book.coolVictim('p:a' as PrincipalId, 100 + RAID_VICTIM_COOLDOWN_TICKS);
    const rows = { 'p:a': [pile('sys-1', 50_000)], 'p:b': [pile('sys-2', 3_000)] };
    expect(rankCandidates(port(rows), book, 100).map((c) => c.principal)).toEqual(['p:b']);
    // And it ends: a cooldown that never expired would be permanent immunity bought by
    // being raided once.
    expect(rankCandidates(port(rows), book, 100 + RAID_VICTIM_COOLDOWN_TICKS).map((c) => c.principal)).toEqual([
      'p:a',
      'p:b',
    ]);
  });

  it('skips a stage where a raid was repulsed — the only thing a world raid can lose', () => {
    const book = new Book();
    book.holdStage('sys-1' as SystemId, 500);
    const ranked = rankCandidates(port({ 'p:a': [pile('sys-1', 50_000), pile('sys-2', 3_000)] }), book, 100);
    expect(ranked.map((c) => c.stage)).toEqual(['sys-2']);
  });
});
