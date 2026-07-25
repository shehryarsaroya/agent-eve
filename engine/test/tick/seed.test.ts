/**
 * DET-6 — `hash(seed(T))` publishes before actions for T are accepted; the reveal
 * comes after.
 *
 * `TESTING.md` §1.4 states the reason in one clause: **a seed revealed early is an
 * oracle.** An agent that could compute the coming tick's draws would be deciding
 * against a marked deck, and the permanent public record would be a record of that.
 */

import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import { Engine, SeedBook, SeedDisclosureError } from '../../src/tick/index.js';
import { moveEveryone, seatWorld, submission } from './harness.js';

describe('DET-6 — the seed is committed before, revealed after', () => {
  it('publishes the commitment freely and refuses the seed until the window closes', () => {
    const seeds = new SeedBook('det6');
    // The commitment is available at any time, for any tick, to anyone.
    expect(seeds.commitment(7)).toMatch(/^[0-9a-f]{64}$/);
    expect(seeds.isRevealable(7)).toBe(false);
    expect(() => seeds.reveal(7)).toThrow(SeedDisclosureError);
    expect(() => seeds.rootRng(7)).toThrow(SeedDisclosureError);
    expect(() => seeds.phaseRng(7, 'HAZARD')).toThrow(SeedDisclosureError);

    seeds.publish(7);
    // Publishing the *hash* still does not reveal the seed.
    expect(() => seeds.reveal(7)).toThrow(SeedDisclosureError);

    seeds.freeze(7);
    expect(seeds.isRevealable(7)).toBe(true);
    const revealed = seeds.reveal(7);
    // And the reveal matches the commitment, or the commitment was worthless.
    expect(Rng.seedHash(revealed)).toBe(seeds.commitment(7));
    expect(seeds.commitmentHolds(7)).toBe(true);
  });

  it('refuses to reveal a seed whose commitment was never published', () => {
    // Revealing a seed nobody could have checked in advance is the same failure as
    // revealing it early, just harder to notice.
    const seeds = new SeedBook('det6');
    expect(() => {
      seeds.freeze(3);
    }).toThrow(SeedDisclosureError);
  });

  it('gives every phase its own sub-stream, so a draw added in one cannot shift another', () => {
    const seeds = new SeedBook('det6');
    seeds.publish(1);
    seeds.freeze(1);
    const hazard = seeds.phaseRng(1, 'HAZARD');
    const predate = seeds.phaseRng(1, 'PREDATE');
    const hazardAgain = seeds.phaseRng(1, 'HAZARD');

    const first = [hazard.int(1_000), hazard.int(1_000), hazard.int(1_000)];
    const other = [predate.int(1_000), predate.int(1_000), predate.int(1_000)];
    const repeat = [hazardAgain.int(1_000), hazardAgain.int(1_000), hazardAgain.int(1_000)];

    expect(repeat).toEqual(first);
    expect(other).not.toEqual(first);
  });

  it('the engine publishes the next commitment at COMMIT, before the window opens', () => {
    const { world, principals } = seatWorld(2);
    const engine = new Engine({ world, seed: 'det6-engine' });

    // Tick 0's commitment is public before tick 0's window opens — the constructor
    // does both, commitment first.
    const before = engine.openSeedCommitment;
    expect(before).toMatch(/^[0-9a-f]{64}$/);
    expect(engine.seeds.isPublished(0)).toBe(true);
    // ...and its seed is still sealed while actions are being accepted.
    expect(engine.seeds.isRevealable(0)).toBe(false);
    expect(() => engine.seeds.reveal(0)).toThrow(SeedDisclosureError);

    for (const move of moveEveryone(world, principals)) engine.submit(move);
    // Still sealed: the window has not closed.
    expect(() => engine.seeds.reveal(0)).toThrow(SeedDisclosureError);

    const report = engine.runTick();
    // Now revealed, and it matches what was promised.
    expect(report.seedRevealed).not.toBe('');
    expect(Rng.seedHash(report.seedRevealed)).toBe(report.seedCommitment);
    expect(report.seedCommitment).toBe(before);

    // And the next tick's commitment is already public, so the next window is legal.
    expect(engine.seeds.isPublished(1)).toBe(true);
    expect(engine.seeds.isRevealable(1)).toBe(false);
    expect(engine.openSeedCommitment).toBe(engine.seeds.commitment(1));
  });

  it('refuses an action for a tick whose commitment has not published', () => {
    // The rule from the other side: nothing may be accepted against a draw nobody
    // can prove was fixed in advance.
    const { world, principals } = seatWorld(1);
    const engine = new Engine({ world, seed: 'det6-unpublished' });
    engine.seeds.prune(999); // forget every commitment, simulating the ordering bug
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');
    const refused = engine.submit(submission({ principal, verb: 'move', params: {} }));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.invariant).toBe('DET-6');
  });

  it('the commitment is checked at COMMIT every tick, not only in this test', () => {
    // The commitment is only worth something if something checks it.
    const { world } = seatWorld(1);
    const engine = new Engine({ world, seed: 'det6-check' });
    const report = engine.runTick();
    expect(report.halted).toBe(false);
    expect(engine.seeds.commitmentHolds(report.tick)).toBe(true);
  });
});
