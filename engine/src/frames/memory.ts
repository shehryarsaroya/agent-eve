/**
 * WORLD MEMORY — the two §16 projections that make this a world with a history rather than a state.
 *
 * §16's Phase 0 acceptance names three, and only the first existed:
 *
 *   1. **A permanent ruin** at a fallen holding, labelled with the handle and the Reckoning it fell.
 *      Already built — `holding.fellAtReckoning`, deliberately a state on a row that keeps existing
 *      rather than a deletion, because A5 has no opt-out.
 *   2. **A Hall of Fame** over the record — largest promise kept, largest broken, longest unbroken run.
 *   3. **Places named after the principal that first developed them**, which §16 calls "trivial given
 *      permanent place IDs".
 *
 * Both of the missing two are **read-only projections over books that already exist**. Neither adds
 * state, neither can move `state_hash`, and neither needs a new event field. (3) only became derivable
 * today, because it needs somebody to have actually developed a place and until the cast learned to
 * `build` a WORKS nobody ever had.
 *
 * ── WHY THIS IS NOT DECORATION ───────────────────────────────────────────────
 *
 * §16: *"they are the difference between a world that has a history and one that only has a state."*
 * A spectator arriving at Reckoning 40 sees a map of current facts; these two are what tell them the
 * map was *earned*. A13 says every mechanic needs a named pixel signature, and "months of honest work"
 * — the arc A6 is built on — has no signature at all unless the record can be read backwards.
 *
 * ── AND WHY A PLACE KEEPS ITS NAME AFTER THE WORKS IS GONE ────────────────────
 *
 * `namesFor` reads razed WORKS as well as standing ones, and that is the whole point rather than an
 * oversight. `WorksRecord` keeps ended rows on purpose ("the record is append-only and A5 has no
 * opt-out"), so the principal that first opened a place named it whether or not it still holds it —
 * which is how real toponymy works and is exactly the asymmetry between history and state. A projection
 * that dropped razed rows would rename places as they changed hands, and then it would be a state view
 * wearing a memory's clothes.
 */

import { compareIds } from '../ledger/index.js';
import type { Handle, PrincipalId, Standing, SystemId } from '../core/types.js';
import type { WorksRecord } from '../works/book.js';

/** A place, and who opened it. */
export interface PlaceName {
  readonly system: SystemId;
  readonly namedFor: PrincipalId;
  readonly handle: string;
  /** The tick its first WORKS was raised. The place has carried the name since. */
  readonly sinceTick: number;
  /** Whether that founding WORKS is still standing. The name does not depend on it. */
  readonly founderStillThere: boolean;
}

/** One line of the Hall of Fame: a title, a holder, and the clause that earned it. */
export interface HallOfFameRow {
  readonly title: string;
  readonly principal: PrincipalId;
  readonly handle: string;
  readonly value: number;
  readonly clause: string;
}

function handleOf(handles: ReadonlyMap<PrincipalId, Handle>, p: PrincipalId): string {
  return String(handles.get(p) ?? p);
}

/**
 * Which principal first developed each place, in system order.
 *
 * Ties on `raisedAtTick` break on `compareIds`, never on map order: two WORKS raised on one system in
 * one tick is legal, and JS object/Map iteration order is a determinism killer this repo bans by name.
 */
export function namesFor(
  works: readonly WorksRecord[],
  handles: ReadonlyMap<PrincipalId, Handle>,
): readonly PlaceName[] {
  const firstBySystem = new Map<string, WorksRecord>();
  for (const w of works) {
    const held = firstBySystem.get(String(w.system));
    if (
      held === undefined ||
      w.raisedAtTick < held.raisedAtTick ||
      (w.raisedAtTick === held.raisedAtTick && compareIds(w.id, held.id) < 0)
    ) {
      firstBySystem.set(String(w.system), w);
    }
  }
  return [...firstBySystem.values()]
    .sort((a, b) => compareIds(a.system, b.system))
    .map((w) => ({
      system: w.system,
      namedFor: w.holder,
      handle: handleOf(handles, w.holder),
      sinceTick: w.raisedAtTick,
      founderStillThere: !w.razed,
    }));
}

/**
 * The Hall of Fame, from the standing book.
 *
 * **Each row says what the number IS, not what it suggests.** `electiveHonouredValue` is the cumulative
 * value of elective halves paid, not the size of one promise — §16 asks for "largest promise kept" and
 * the book does not hold per-promise maxima, so the title says CUMULATIVE rather than claiming a
 * superlative the data cannot support. A2: known arithmetic is exact, and a leaderboard that overstates
 * what it measured is a wrong fact about a real agent (A5′) in the one place people read for glory.
 *
 * Empty rows are omitted rather than shown as zero, for the same reason `characterLine` renders "day
 * one" instead of a row of zeros: a fabricated clean record is a claim nothing supports.
 */
export function hallOfFame(
  standings: readonly Standing[],
  handles: ReadonlyMap<PrincipalId, Handle>,
): readonly HallOfFameRow[] {
  const out: HallOfFameRow[] = [];
  const ordered = [...standings].sort((a, b) => compareIds(a.principal, b.principal));

  const best = (
    title: string,
    pick: (s: Standing) => number,
    clause: (s: Standing, v: number) => string,
    eligible: (s: Standing) => boolean = (): boolean => true,
  ): void => {
    let top: { s: Standing; v: number } | null = null;
    for (const s of ordered) {
      if (!eligible(s)) continue;
      const v = pick(s);
      if (v <= 0) continue;
      // `>` not `>=`, so the first in canonical order wins a tie and the table is replay-stable.
      if (top === null || v > top.v) top = { s, v };
    }
    if (top === null) return;
    out.push({
      title,
      principal: top.s.principal,
      handle: handleOf(handles, top.s.principal),
      value: top.v,
      clause: clause(top.s, top.v),
    });
  };

  best(
    'MOST KEPT, BY VALUE',
    (s) => s.electiveHonouredValue,
    (s, v) => `paid ${String(v)} across ${String(s.electiveHonoured)} elective halves it could have kept`,
  );
  best(
    'MOST BROKEN',
    (s) => s.defaults,
    (s, v) =>
      `${String(v)} default${v === 1 ? '' : 's'} on the record` +
      `${s.lastDefaultTick === null ? '' : `, the last at tick ${String(s.lastDefaultTick)}`}`,
  );
  best(
    'NEVER BROKEN A PROMISE',
    (s) => s.electiveHonoured,
    (s, v) => `${String(v)} elective halves honoured and not one default`,
    // The streak clause. Cumulative honours mean nothing as a "clean run" unless there is genuinely no
    // default behind them, and `lastDefaultTick === null` is the only thing that says so.
    (s) => s.defaults === 0 && s.lastDefaultTick === null,
  );
  best(
    'WIDEST CIRCLE',
    (s) => s.distinctCounterparties,
    (s, v) => `dealt with ${String(v)} independently-capitalised counterparties`,
  );
  return out;
}
