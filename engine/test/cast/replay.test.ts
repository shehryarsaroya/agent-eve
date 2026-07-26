/**
 * A non-deterministic player inside a deterministic world.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE CAST IS NEVER CONSULTED DURING REPLAY.**
 *
 * This is the property that makes a language model safe here at all. The world's
 * replay contract is `(snapshot, action_log, seed) -> snapshot`: boot seats the cast
 * deterministically from the seed and then **re-submits logged actions**; it never asks
 * anybody to decide again. A decision enters the record as a logged action carrying
 * `decision_source: 'LIVE'`, and the record is what reproduces.
 *
 * If that ever stopped being true — if some future boot path called `decide()` to fill a
 * gap — the world would be unreplayable the moment the model answered differently, and
 * replay is the only thing that makes a permanent public record trustworthy (A5′). So
 * this file asserts it two ways: **behaviourally**, by replaying a world the LLM cast
 * played and proving the transport was called zero times and the hash reproduced; and
 * **structurally**, by grepping the engine for `decide(` call sites.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import { LlmCast } from '../../src/cast/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import type { SubmittedAction } from '../../src/tick/index.js';
import { CONTRACT, MockTransport, settle, stoppedClock } from './mock.js';

const SEED = 'replay-cast';

describe('replay reproduces a world the LLM cast played, without the cast', () => {
  it('re-submitting the action log lands on the same state hash, and calls nothing', async () => {
    setSpeed('instant');

    // ── the live world: an LLM cast, deciding ──
    const source = new Runtime({ seed: SEED });
    const transport = MockTransport.picksAffordance();
    const cast = new LlmCast(source, {
      size: 4,
      transport,
      clock: stoppedClock,
      contract: CONTRACT,
      wakeGapTicks: 2,
      planMax: 2,
      log: () => undefined,
    });
    cast.seat(SEED);

    const ticks = 40; // Inside ACTION_LOG_TICKS_RETAINED, so the whole run is still in the log.
    const logged: SubmittedAction[][] = [];
    for (let i = 0; i < ticks; i += 1) {
      for (const action of cast.decide(source.engine.tick + 1, SEED)) source.engine.submit(action);
      const report = source.runTick();
      expect(report.halted).toBe(false);
      logged.push(
        source.engine.log.forTick(report.tick).map((entry) => ({
          principal: entry.principal,
          verb: entry.verb,
          params: entry.params,
          clientSequence: entry.clientSequence,
          arrivalMs: entry.arrivalMs ?? 0,
          decisionSource: entry.decisionSource,
          priority: entry.priority,
          ...(entry.idempotencyKey === null ? {} : { idempotencyKey: entry.idempotencyKey }),
          ...(entry.actedOnStateVersion === null
            ? {}
            : { actedOnStateVersion: entry.actedOnStateVersion }),
        })),
      );
      await settle();
    }

    const callsDuringPlay = transport.count;
    expect(callsDuringPlay).toBeGreaterThan(0);
    // The run really did produce live decisions, or this proves nothing about them.
    const live = logged.flat().filter((a) => a.decisionSource === 'LIVE');
    expect(live.length).toBeGreaterThan(0);

    // ── the replay: same seed, same seating, the LOG re-submitted, nobody asked ──
    const replayed = new Runtime({ seed: SEED });
    const forbidden = MockTransport.forbidden();
    const replayCast = new LlmCast(replayed, {
      size: 4,
      transport: forbidden,
      clock: stoppedClock,
      contract: CONTRACT,
      wakeGapTicks: 2,
      planMax: 2,
      log: () => undefined,
    });
    // This is exactly what `bootWorld` does: seat, then replay. It never calls `decide`.
    replayCast.seat(SEED);
    for (const tick of logged) {
      for (const action of tick) replayed.engine.submit(action);
      replayed.runTick();
    }

    expect(replayed.engine.tick).toBe(source.engine.tick);
    expect(replayed.engine.stateHash).toBe(source.engine.stateHash);
    expect(replayed.engine.stateVersion).toBe(source.engine.stateVersion);
    // The claim: replay asked the model nothing.
    expect(forbidden.count).toBe(0);
    expect(transport.count).toBe(callsDuringPlay);

    cast.close();
    replayCast.close();
  });

  it('the same log replays twice to the same hash, even though the cast would not', async () => {
    setSpeed('instant');
    const source = new Runtime({ seed: 'twice' });
    const cast = new LlmCast(source, {
      size: 3,
      transport: MockTransport.picksAffordance(),
      clock: stoppedClock,
      contract: CONTRACT,
      wakeGapTicks: 2,
      log: () => undefined,
    });
    cast.seat('twice');

    const logged: SubmittedAction[][] = [];
    for (let i = 0; i < 20; i += 1) {
      for (const action of cast.decide(source.engine.tick + 1, 'twice')) source.engine.submit(action);
      const report = source.runTick();
      logged.push(
        source.engine.log.forTick(report.tick).map((entry) => ({
          principal: entry.principal,
          verb: entry.verb,
          params: entry.params,
          clientSequence: entry.clientSequence,
          arrivalMs: entry.arrivalMs ?? 0,
          decisionSource: entry.decisionSource,
          priority: entry.priority,
        })),
      );
      await settle();
    }

    const hashes: string[] = [];
    for (let run = 0; run < 2; run += 1) {
      const world = new Runtime({ seed: 'twice' });
      new LlmCast(world, {
        size: 3,
        transport: MockTransport.forbidden(),
        clock: stoppedClock,
        contract: CONTRACT,
        log: () => undefined,
      }).seat('twice');
      for (const tick of logged) {
        for (const action of tick) world.engine.submit(action);
        world.runTick();
      }
      hashes.push(world.engine.stateHash);
    }
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[0]).toBe(source.engine.stateHash);
    cast.close();
  });
});

describe('structurally, nothing but a live driver may call decide()', () => {
  function decideCallSites(): readonly string[] {
    const root = fileURLToPath(new URL('../../src/', import.meta.url));
    const hits = new Set<string>();
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith('.ts')) continue;
        const source = readFileSync(full, 'utf8');
        for (const line of source.split('\n')) {
          const code = line.replace(/\/\/.*$/, '');
          if (/\.decide\s*\(/.test(code)) hits.add(relative(root, full).split('\\').join('/'));
        }
      }
    };
    walk(root);
    return [...hits].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  it('has exactly three call sites, and every one of them is a live driver', () => {
    // `api/server.ts` is the tick scheduler, `sim/cli.ts` is the offline sim driver, and
    // `cast/llm.ts` delegates to the heuristic for its fallback. A FOURTH file appearing
    // here is what this test exists to catch — most likely a boot or replay path that
    // decided to ask the cast to fill a gap, which would make the world unreplayable the
    // first time the model answered differently (A5').
    expect(decideCallSites()).toEqual(['api/server.ts', 'cast/llm.ts', 'sim/cli.ts']);
  });

  it('the persistence layer seats the cast and NEVER asks it to decide', () => {
    // Seating is genesis and must happen on both sides — `replayCheck.ts` builds its
    // fresh runtime with `cast.seat(seed)`, and `LlmCast.seat` delegates to exactly the
    // same code, so a world played by the LLM cast re-seats identically. Deciding is the
    // opposite: the log already holds every decision, and re-deriving one would replace
    // the record with a guess.
    expect(decideCallSites().some((file) => file.startsWith('persist/'))).toBe(false);

    const dir = fileURLToPath(new URL('../../src/persist/', import.meta.url));
    const seats = readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) => /\.seat\s*\(/.test(readFileSync(join(dir, name), 'utf8')));
    // Positive control: if this ever becomes empty, the assertion above is vacuous
    // because persistence has stopped seating a cast at all.
    expect(seats.length).toBeGreaterThan(0);
  });
});
