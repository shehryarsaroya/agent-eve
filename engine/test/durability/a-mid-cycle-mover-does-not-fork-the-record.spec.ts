/**
 * A PRINCIPAL THAT CHANGES CONSTELLATION MID-RECKONING MUST NOT FORK THE RECORD.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE BUG THIS PINS WAS UNREACHABLE FOR THE WHOLE LIFE OF THE BUILD, AND BECAME REACHABLE THE DAY
 * THE CAST COULD CROSS THE COMMONS.**
 *
 * `Runtime.assessLevyNow` runs in every OBLIGE phase — deliberately, so a world constructed mid-cycle
 * is assessed at all — and guards itself with `levyAssessedReckoning`, a plain field that is **not a
 * state table**. Its own comment says *"the memo is a fast path, never the authority."* It was the
 * authority: it was the only thing stopping a second `assessCycle` from finding a constellation that
 * had gained a principal since phase 0 and minting it a plan.
 *
 * Nothing could gain one, because a holding could not move. `graduate` across a constellation
 * boundary is what changes that.
 *
 * Measured before the fix — seed `unforked-1`, 8 members, 200 ticks, `p:kestrel` crossing into
 * `con-4`:
 *
 *   - the continuous world held **one** plan for Reckoning 0;
 *   - an adopted boot replaying from tick 100 held **two**, the second stamped
 *     `assessedAtTick: 101` — the first tick after adoption, because a fresh process starts with an
 *     empty memo;
 *   - `state_hash` parted company, and the event counters were one row apart (80 against 81).
 *
 * Two worlds, the same action log, different hashes: DET-1 failing in the way nothing else catches,
 * because each world's arithmetic is correct. And the *second* plan is the wrong one — it puts one
 * principal on two dockets for one Reckoning, which is a double assessment and an A5′ accusation
 * waiting to be recorded. `levy/cycle.ts` now refuses to assess a constellation whose whole roll is
 * already on a docket, which makes the live behaviour a rule instead of a cache.
 *
 * MUTATION: delete the `roll.every(... lineFor ...)` guard in `assessCycle`. RED here, on the hash.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed, reckoningIndex } from '../../src/core/time.js';
import { InMemoryJournalStore, Journal, bootFromStore } from '../../src/persist/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { constellationOf } from '../../src/levy/index.js';

/** The seat pattern this needs is one member on a constellation gate. `unforked-1` has one. */
const SEED = 'unforked-1';
const CAST = 8;
/** Long enough to cross a checkpoint (every 100) and stay inside Reckoning 0 (288 ticks). */
const TICKS = 200;

describe('a mid-cycle constellation change leaves one world, not two', () => {
  it('adopt-plus-tail reaches the same state_hash as the continuous world', async () => {
    setSpeed('instant');
    const live = new Runtime({ seed: SEED });
    const cast = new HeuristicCast(live, { size: CAST });
    const members = cast.seat(SEED);
    const store = new InMemoryJournalStore();
    const journal = new Journal(store, { snapshotEveryTicks: 100 });
    await bootFromStore(live, store, { seed: SEED });

    // Which constellation each member started in, so the crossing can be asserted rather than hoped.
    const born = new Map(members.map((m) => [m.principal, constellationOf(live.world, m.principal)]));
    for (let i = 0; i < TICKS; i += 1) {
      for (const a of cast.decide(live.engine.tick + 1, SEED)) live.engine.submit(a);
      const report = live.runTick();
      expect(report.halted, `halted at ${String(report.tick)}`).toBe(false);
      journal.record(live, report);
      await journal.flushPending();
    }
    await journal.drain();

    // ── NON-VACUITY FIRST, because this test is worthless without the mover ──
    const movers = members.filter((m) => constellationOf(live.world, m.principal) !== born.get(m.principal));
    expect(
      movers.length,
      'no member changed constellation, so the state this test exists for never occurred — re-pick a ' +
        'seed that seats a member adjacent to another constellation rather than deleting the test',
    ).toBeGreaterThan(0);
    // And inside ONE Reckoning, which is what makes the assessment memo decide anything.
    expect(reckoningIndex(live.engine.tick), 'the run must stay inside the cycle it was assessed in').toBe(0);

    const adopted = new Runtime({ seed: SEED });
    new HeuristicCast(adopted, { size: CAST }).seat(SEED);
    const result = await bootFromStore(adopted, store, { seed: SEED });
    expect(result.adoptedAtTick, 'a sound record must be adopted, or this proves nothing').not.toBeNull();
    expect(result.ticksReplayed, 'and the tail must be a tail').toBeLessThan(TICKS);
    expect(adopted.engine.stateHash).toBe(live.engine.stateHash);

    // The specific artifact, named: one plan per constellation per Reckoning, and the mover stays on
    // the docket it was assessed on.
    const plans = adopted.levy.plansIn(0);
    const seen = new Set(plans.map((p) => p.constellation));
    expect(seen.size, 'a constellation must not be assessed twice in one Reckoning').toBe(plans.length);
    for (const mover of movers) {
      const line = adopted.levy.lineFor(0, mover.principal);
      expect(line, `${mover.handle} crossed and fell off the docket`).not.toBeNull();
      expect(
        line?.plan.constellation,
        `${mover.handle} was re-assessed in the constellation it moved INTO; a principal keeps the ` +
          'docket it was assessed on, which is what `vDeliver` reads its delivery place from',
      ).toBe(born.get(mover.principal));
    }
  }, 300_000);
});
