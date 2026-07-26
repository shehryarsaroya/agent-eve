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

describe('force is arithmetic and higher wins — no dice, no rounds, no positioning', () => {
  it('sums hands, joiners and terrain, and publishes every term', () => {
    const raid = raidRow({ force: 3, parties: [party('p:a', 'DEFENDER'), party('p:b', 'RAIDER')] });
    const reading = readForce({ raid, tier: 'MARCHES', defenderHands: 2 });

    // defender: 2 hands + 1 defender joiner + 1 terrain = 4. raider: 3 + 1 joiner = 4.
    expect(reading.terms).toEqual({
      defenderHands: 2,
      defenderJoiners: 1,
      terrain: FORCE_BY_TIER['MARCHES'],
      raidForce: 3,
      raiderJoiners: 1,
    });
    expect(reading.defenderForce).toBe(4);
    expect(reading.raiderForce).toBe(4);
  });

  it('ties go to the defender, and that is a published rule rather than a rounding accident', () => {
    const raid = raidRow({ force: 3 });
    // 3 hands + 0 terrain in the FRONTIER == the raid's 3. Exactly level.
    const level = readForce({ raid, tier: 'FRONTIER', defenderHands: 3 });
    expect(level.defenderForce).toBe(level.raiderForce);
    expect(level.verdict).toBe('REPULSED');

    const short = readForce({ raid, tier: 'FRONTIER', defenderHands: 2 });
    expect(short.verdict).toBe('PLUNDERED');
  });

  it('an unanswered raid has no defence at all — silence is the expensive answer (A14)', () => {
    const raid = raidRow({ force: 2 });
    expect(readForce({ raid, tier: 'FRONTIER', defenderHands: 0 }).verdict).toBe('PLUNDERED');
  });

  it('the Frontier gives no terrain bonus and the Marches gives one', () => {
    const raid = raidRow({ force: 2 });
    expect(readForce({ raid, tier: 'FRONTIER', defenderHands: 1 }).defenderForce).toBe(1);
    expect(readForce({ raid, tier: 'MARCHES', defenderHands: 1 }).defenderForce).toBe(2);
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
