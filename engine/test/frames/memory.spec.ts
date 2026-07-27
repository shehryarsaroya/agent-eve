/**
 * §16'S THIRD ACCEPTANCE CRITERION: A WORLD WITH A HISTORY, NOT ONLY A STATE.
 *
 * Three world-memory projections are named in the Phase 0 acceptance list, and until now one existed:
 *
 *   - a permanent **ruin** at a fallen holding — built (`holding.fellAtReckoning`, a state on a row
 *     that keeps existing rather than a deletion, because A5 has no opt-out);
 *   - a **Hall of Fame** over the record — added here;
 *   - **places named after the principal that first developed them** — added here, and only derivable
 *     as of today, because it needs somebody to have actually developed a place and until the cast
 *     learned to `build` a WORKS nobody ever had.
 *
 * §16: *"they are the difference between a world that has a history and one that only has a state."*
 *
 * Both are read-only projections over books that already exist, so neither adds state and neither can
 * move `state_hash`. Which is also why the interesting assertions here are about **honesty** rather
 * than about plumbing: a leaderboard is the one surface people read for glory, so a row that overstates
 * what it measured is a wrong fact about a real agent (A5′) in the worst possible place.
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed } from '../../src/core/time.js';
import type { Handle, PrincipalId, Standing } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { hallOfFame, namesFor } from '../../src/frames/memory.js';
import { Runtime } from '../../src/sim/runtime.js';

function world(seed: string, ticks = 900): Runtime {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const cast = new HeuristicCast(rt, { size: 8 });
  cast.seat(seed);
  for (let i = 0; i < ticks; i += 1) {
    for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
    if (rt.runTick().halted) throw new Error(`halted at ${String(rt.engine.tick)}`);
  }
  return rt;
}

function standing(p: string, over: Partial<Standing> = {}): Standing {
  return {
    principal: p as unknown as PrincipalId,
    electiveHonoured: 0,
    electiveHonouredValue: minor(0),
    defaults: 0,
    contradictedSeals: 0,
    distinctCounterparties: 0,
    lastDefaultTick: null,
    ...over,
  };
}

const NO_HANDLES = new Map<PrincipalId, Handle>();

describe('the world remembers who built it and who kept their word', () => {
  it('both projections reach the frame a browser polls', () => {
    const frame = world('memory-frame').reckoningFrame();
    expect(frame, 'a frame must exist to carry them').not.toBeNull();
    expect((frame?.places ?? []).length, 'no place is named, so the map has no history on it').toBeGreaterThan(0);
    expect((frame?.hallOfFame ?? []).length, 'the record is legible but nothing reads it back').toBeGreaterThan(0);

    // Every named place must name a real principal and a tick it has been named since — a row with a
    // blank founder is worse than no row, because it renders as a place nobody built.
    for (const p of frame?.places ?? []) {
      expect(p.namedFor, 'a place named for nobody').toBeTruthy();
      expect(p.sinceTick, 'a place named since no tick').toBeGreaterThanOrEqual(0);
    }
  }, 180_000);

  it('a place keeps the name of whoever OPENED it, not of whoever holds it now', () => {
    // The asymmetry that makes this memory rather than state. `namesFor` reads razed WORKS as well as
    // standing ones on purpose: `WorksRecord` keeps ended rows ("the record is append-only and A5 has
    // no opt-out"), so a principal that opened a place and lost it still named it. A projection that
    // dropped razed rows would rename places as they change hands, and be a state view in a memory's
    // clothes.
    const first = {
      id: 'works:sys-01:10:p:founder' as never,
      system: 'sys-01' as never,
      holder: 'p:founder' as unknown as PrincipalId,
      raisedAtTick: 10,
      onlineAtTick: 34,
      razed: true, // gone, and it still named the place
      razedAtTick: 50,
      extracted: 0 as never,
      rentPaid: 0 as never,
      fuelExtracted: 0 as never,
    };
    const later = { ...first, id: 'works:sys-01:80:p:latecomer' as never, holder: 'p:latecomer' as unknown as PrincipalId, raisedAtTick: 80, razed: false, razedAtTick: null };

    const names = namesFor([later, first], NO_HANDLES);
    expect(names).toHaveLength(1);
    expect(names[0]?.namedFor, 'the founder names the place even though its works is razed').toBe('p:founder');
    expect(names[0]?.sinceTick).toBe(10);
    expect(names[0]?.founderStillThere, 'and the frame says the founding works is gone').toBe(false);
  });

  it('ties on the same tick break deterministically, never on Map order', () => {
    // Two WORKS raised on one system in one tick is legal, and JS Map iteration order is a determinism
    // killer this repo bans by name. Argument order is reversed between the two runs; the answer may
    // not move.
    const a = { id: 'works:sys-02:5:p:aaa' as never, system: 'sys-02' as never, holder: 'p:aaa' as unknown as PrincipalId, raisedAtTick: 5, onlineAtTick: 29, razed: false, razedAtTick: null, extracted: 0 as never, rentPaid: 0 as never, fuelExtracted: 0 as never };
    const b = { ...a, id: 'works:sys-02:5:p:zzz' as never, holder: 'p:zzz' as unknown as PrincipalId };
    expect(namesFor([a, b], NO_HANDLES)[0]?.namedFor).toBe(namesFor([b, a], NO_HANDLES)[0]?.namedFor);
  });

  it('the Hall of Fame says what it MEASURED, and omits a row it cannot support', () => {
    // §16 asks for "largest promise kept". The standing book holds CUMULATIVE value, not per-promise
    // maxima, so the title says so rather than claiming a superlative the data cannot back. A2: known
    // arithmetic is exact, and a leaderboard is the last place to round in your own favour.
    const rows = hallOfFame(
      [
        standing('p:payer', { electiveHonoured: 9, electiveHonouredValue: minor(5_000) }),
        standing('p:breaker', { defaults: 3, lastDefaultTick: 700 }),
      ],
      NO_HANDLES,
    );
    const titles = rows.map((r) => r.title);
    expect(titles, 'the value row must not claim to be one promise').toContain('MOST KEPT, BY VALUE');
    expect(titles).toContain('MOST BROKEN');
    // Nobody qualifies for a clean run (`p:payer` has honours but the row needs zero defaults AND no
    // recorded default tick; `p:breaker` has three) — so the row is ABSENT rather than showing a zero.
    // Same discipline as `characterLine` rendering "day one" instead of a row of zeros: a fabricated
    // clean record is a claim about a real agent that nothing supports.
    expect(titles, 'a row nothing supports must be omitted, not shown as zero').not.toContain('WIDEST CIRCLE');

    expect(rows.find((r) => r.title === 'MOST BROKEN')?.clause, 'and it names when').toContain('700');
  });

  it('“never broken” requires an actually clean record, not merely a high count', () => {
    // The clause that would be easiest to get wrong, and the wrong version is a libel: a principal with
    // 40 honours and one old default would top a naive "most honoured" list under a banner saying it
    // has never broken a promise. `lastDefaultTick === null` is the only thing that rules that out.
    const rows = hallOfFame(
      [
        standing('p:mostly-good', { electiveHonoured: 40, defaults: 1, lastDefaultTick: 12 }),
        standing('p:actually-clean', { electiveHonoured: 3 }),
      ],
      NO_HANDLES,
    );
    const clean = rows.find((r) => r.title === 'NEVER BROKEN A PROMISE');
    expect(clean, 'somebody genuinely clean exists, so the row belongs').toBeDefined();
    expect(clean?.principal, 'the 40-honour principal has a default and must NOT hold this row').toBe(
      'p:actually-clean',
    );
  });

  it('and a recorded default tick alone disqualifies, even with the counter at zero', () => {
    // The other half of the clause, and it had no test — mutation-checked: dropping
    // `&& lastDefaultTick === null` left every assertion above green, because the case that
    // distinguishes them is `defaults: 0` WITH a default tick on the row.
    //
    // That state should not occur, which is exactly why it is defended. The two fields are written by
    // the same code path, so a book that ever sets the tick without incrementing the counter has a bug
    // — and the consequence of trusting the counter alone would be a public banner saying a principal
    // has never broken a promise directly above a recorded default. A5′: the record must never be
    // wrong, and this is the surface where being wrong is loudest. Fail closed on the contradiction
    // rather than pick the flattering field.
    const rows = hallOfFame(
      [standing('p:contradictory', { electiveHonoured: 12, defaults: 0, lastDefaultTick: 44 })],
      NO_HANDLES,
    );
    expect(
      rows.find((r) => r.title === 'NEVER BROKEN A PROMISE'),
      'a row with a recorded default tick must not be crowned unbroken, whatever its counter says',
    ).toBeUndefined();
  });
});
