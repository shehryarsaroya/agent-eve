/**
 * **The tribute line — A13's pixel signature, and §5.2's "highest-leverage single edit".**
 *
 * > *"A line from each assessed principal's holding to the delivery place, thickness
 * > proportional to the amount owed: **dashed** while no hand is assigned, **solid** while a
 * > hand is en route, **red at the freeze if unpaid**, and a shortfall seizure renders as
 * > that line **reversing**."*
 *
 * `LEG-6` asks for the whole signature: every principal on the map every day; dashed → solid
 * → red at freeze → reversing on seizure; `LEVY SHORT` decomposable to *whose* line is red;
 * a forming cartel visible as convergence.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A13 is *"no named pixel signature → not ready"*, and the scoring panel found Legible
 * scored lowest of six dimensions because bolted-on mechanics "got their economics and
 * their prose but neither their pixels nor their arithmetic". So the states are asserted as
 * arithmetic, from the real book, at the real ticks — not eyeballed.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { qty } from '../../src/core/units.js';
import { renderFrame, type FrameSource } from '../../src/frames/render.js';
import { levyShortNow, tributeLinesFor, tributeStateFor } from '../../src/levy/index.js';
import { holdingOf } from '../../src/world/state.js';
import { act, levyWorld, runTo, tick, walkToPlace } from './fixture.js';

describe('the four states, in the order §5.2 gives them', () => {
  it('DASHED while no hand is assigned', () => {
    const world = levyWorld('tribute-dashed', 2, 1);
    const runtime = world.runtime;
    tick(runtime);
    const lines = tributeLinesFor({ book: runtime.levy, world: runtime.world, reckoning: 0, tick: runtime.engine.tick });
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.state).toBe('DASHED');
      expect(line.owed).toBeGreaterThan(0);
      // The line runs from the principal's HOLDING to the delivery place — its body on the
      // map, not its stores (§3).
      expect(line.from).toBe(holdingOf(runtime.world, line.principal).id);
    }
  });

  it('SOLID while a hand is en route, and back to a hairline once paid', () => {
    const world = levyWorld('tribute-solid', 2, 1);
    const runtime = world.runtime;
    tick(runtime);
    const payer = world.principals[0];
    if (payer === undefined) throw new Error('fixture');
    const place = runtime.levyBlockFor(payer, runtime.engine.tick)?.deliverable_to;
    if (place === undefined) throw new Error('no place');

    const hand = [...runtime.world.hands.values()].find((h) => h.principal === payer);
    if (hand === undefined) throw new Error('no hand');
    act(runtime, payer, 'move', { hand: hand.id, to: place });
    expect(
      tributeStateFor({ book: runtime.levy, world: runtime.world, reckoning: 0, tick: runtime.engine.tick, principal: payer }),
    ).toBe('SOLID');

    walkToPlace(runtime, payer);
    act(runtime, payer, 'deliver', {});
    const lines = tributeLinesFor({ book: runtime.levy, world: runtime.world, reckoning: 0, tick: runtime.engine.tick });
    const paid = lines.find((l) => l.principal === payer);
    // Kept at zero thickness rather than dropped: §5.2 wants every principal on the map
    // every day, and a line that vanished on payment would make the screen quietest exactly
    // when the most had been paid.
    expect(paid).toBeDefined();
    expect(paid?.owed).toBe(0);
  });

  it('RED at the freeze if unpaid', () => {
    const world = levyWorld('tribute-red', 2, 1);
    const runtime = world.runtime;
    runTo(runtime, 286);
    const lines = tributeLinesFor({ book: runtime.levy, world: runtime.world, reckoning: 0, tick: runtime.engine.tick });
    expect(lines.every((l) => l.state === 'RED')).toBe(true);
    // Decomposable: a stranger can see *whose* line is red, which is what makes the
    // headline meter legible rather than an abstraction (§5.2).
    const short = levyShortNow(runtime.levy, 0);
    expect(short.red.length).toBe(2);
    expect(short.total).toBe(lines.reduce((n, l) => n + l.owed, 0));
  });

  it('REVERSING once the sweep has taken goods', () => {
    const world = levyWorld('tribute-reverse', 2, 1);
    const runtime = world.runtime;
    const swept = world.principals[0];
    if (swept === undefined) throw new Error('fixture');
    tick(runtime);
    // Recorded through the book's own door, which is the one the settlement uses.
    runtime.levy.recordSweep(0, swept, qty(10));
    expect(
      tributeStateFor({ book: runtime.levy, world: runtime.world, reckoning: 0, tick: runtime.engine.tick, principal: swept }),
    ).toBe('REVERSING');
    // A seizure must not render as merely unpaid: the reversal is the only frame in which
    // the sweep is visible at all.
    expect(
      tributeStateFor({ book: runtime.levy, world: runtime.world, reckoning: 0, tick: 286, principal: swept }),
    ).toBe('REVERSING');
  });

  it('DASHED for a principal with no assessment, rather than a drawn line nobody owes', () => {
    const world = levyWorld('tribute-none', 1, 1);
    const runtime = world.runtime;
    tick(runtime);
    const stranger = 'p:nobody' as PrincipalId;
    expect(
      tributeStateFor({ book: runtime.levy, world: runtime.world, reckoning: 0, tick: runtime.engine.tick, principal: stranger }),
    ).toBe('DASHED');
    const lines = tributeLinesFor({ book: runtime.levy, world: runtime.world, reckoning: 0, tick: runtime.engine.tick });
    expect(lines.some((l) => l.principal === stranger)).toBe(false);
  });
});

describe('the lines reach the frame the client already draws', () => {
  it('renderFrame carries the Levy layer\'s lines through unchanged', () => {
    const world = levyWorld('tribute-frame', 3, 1);
    const runtime = world.runtime;
    runTo(runtime, 286);
    const lines = runtime.tributeLines(runtime.engine.tick);
    expect(lines.length).toBe(3);

    const source: FrameSource = {
      reckoning: 0,
      tick: runtime.engine.tick,
      stateHash: 'h',
      settled: [],
      meters: {
        levyShort: levyShortNow(runtime.levy, 0).total,
        onAPromise: 0 as never,
        kept: 0,
        broken: 0,
      },
      handles: new Map(),
      ticker: [],
      tomorrow: [],
      tributeLines: lines,
    };
    const frame = renderFrame(source);
    // `frames/contract.ts` owns `TributeLine` and this suite does not redefine it: the
    // renderer passes the Levy layer's objects through, because a renderer that drew its own
    // lines would be inventing an obligation.
    expect(frame.tributeLines).toEqual(lines);
    expect(frame.meters.levyShort).toBeGreaterThan(0);
  });

  it('sorts by amount owed, so a truncated frame drops hairlines and not ropes', () => {
    const world = levyWorld('tribute-order', 3, 1);
    const runtime = world.runtime;
    tick(runtime);
    const payer = world.principals[0];
    if (payer === undefined) throw new Error('fixture');
    walkToPlace(runtime, payer);
    act(runtime, payer, 'deliver', {});
    const lines = runtime.tributeLines(runtime.engine.tick);
    for (let i = 1; i < lines.length; i += 1) {
      expect(lines[i - 1]?.owed ?? 0).toBeGreaterThanOrEqual(lines[i]?.owed ?? 0);
    }
    // The one that paid is last, at zero.
    expect(lines[lines.length - 1]?.principal).toBe(payer);
    expect(lines[lines.length - 1]?.owed).toBe(0);
  });

  it('AGT-X4: a cartel is visible as convergence — every line ending at one place', () => {
    // The pass criterion for the cartel probe is not "the cartel fails" but "the cartel is
    // visible on screen while it succeeds". Convergence is the signature, so it is asserted
    // as a fact about the lines rather than left to a judge.
    const world = levyWorld('tribute-cartel', 4, 1);
    const runtime = world.runtime;
    tick(runtime);
    const lines = runtime.tributeLines(runtime.engine.tick);
    const destinations = new Set(lines.map((l) => l.to));
    expect(destinations.size).toBe(1);
    expect(lines).toHaveLength(4);
  });
});
