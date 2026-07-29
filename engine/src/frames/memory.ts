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

/**
 * ★ **THE RUIN** — one destroyed WORKS, still on the map, labelled with who lost it and when.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE NAMED PIXEL SIGNATURE FOR RAZING, AND IT HAD TO BE A POSITIVE MARK.**
 * A13: no named pixel signature, not ready. The obvious rendering of a razed WORKS is that its mark
 * *disappears* from `worksLines` — and that is not a signature, it is this project's signature
 * DEFECT arriving at the pixel layer: **a mark that vanished is indistinguishable from a mark that
 * was never there**, to a viewer and to every reader of every frame. The system that stopped
 * producing would look exactly like the system that never produced.
 *
 * So a razing leaves something behind. §16's Phase 0 acceptance already asks for exactly this shape
 * for the other structure — *"a permanent ruin at a fallen holding's berth labelled with the handle
 * and the Reckoning it fell"* — so this is the canon term applied to the second thing that can fall,
 * not a new one (HARD RULE 4: one word per concept, and `ruin` already means this).
 *
 * **The vocabulary, beside the four the map already has:** a claim tints a system · a convoy is a
 * line that can be severed · THE SAP is a notched band whose advance is the score · a broken compact
 * snaps the link and scars both parties · **and A RUIN is a dark mark where production used to be,
 * carrying the handle that built it, the handle that ended it, and the Reckoning it fell.**
 *
 * It is memory, not state, and the distinction is load-bearing: a ruin never leaves. `worksLines`
 * draws what extracts, this draws what stopped, and a system carrying both is a place that was
 * fought over and rebuilt — which is the one thing a map of current facts can never show.
 * ══════════════════════════════════════════════════════════════════════════
 */
export interface Ruin {
  readonly works: string;
  readonly system: SystemId;
  /** Who built it. A ruin is named for its builder, exactly as a place is. */
  readonly holder: PrincipalId;
  readonly handle: string;
  /** Who ended it, or `null` when the world did — a world-spawned raid has no principal. */
  readonly razedBy: PrincipalId | null;
  /** `null` for the world, so a renderer never prints a handle nobody owns. */
  readonly razedByHandle: string | null;
  /** The Reckoning it fell in. THE RUIN's label, with the handle. */
  readonly fellAtReckoning: number;
  readonly fellAtTick: number;
  /** Cumulative units the place handed it before it fell. The epitaph, as a number. */
  readonly extracted: number;
  /** `RUIN · fell R12 to vex` — the one line a viewer reads. */
  readonly legend: string;
}

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
 * The ruins, newest first — what this world has destroyed, and who destroyed it.
 *
 * **Newest first, unlike every other projection in this file**, and the reason is what the field is
 * for: `places` is a gazetteer and reads in map order, while a ruin is *news*. The Reckoning a works
 * fell in is the story, so the most recent falls sit at the top and the cap below drops the oldest
 * — which is the only direction a cap may drop in, because a viewer reading a legend of ruins is
 * asking what just happened.
 *
 * Ties on `razedAtTick` break on `compareIds`, never on Map order: two WORKS razed in one tick is
 * reachable (three raids resolve at three phases, but a campaign pulse and a raid can land together),
 * and JS Map iteration order is a determinism killer this repo bans by name.
 */
export function ruinsFor(
  works: readonly WorksRecord[],
  handles: ReadonlyMap<PrincipalId, Handle>,
  limit: number,
): readonly Ruin[] {
  const out: Ruin[] = [];
  for (const w of works) {
    // Both labels required, never defaulted. INV-W7 halts a world that carries a razed row without
    // them, so a row reaching here without them is a bug — and inventing `R0` for it would put a
    // Reckoning this world never had on a permanent public mark (A5′). Skipping is the honest
    // failure: the invariant is what reports it, not the renderer.
    if (!w.razed || w.razedAtTick === null || w.fellAtReckoning === null) continue;
    const by = w.razedBy;
    const byHandle = by === null ? null : handleOf(handles, by);
    out.push({
      works: String(w.id),
      system: w.system,
      holder: w.holder,
      handle: handleOf(handles, w.holder),
      razedBy: by,
      razedByHandle: byHandle,
      fellAtReckoning: w.fellAtReckoning,
      fellAtTick: w.razedAtTick,
      extracted: w.extracted,
      // "to the world" rather than a handle when nobody ordered it: a world-spawned raid has no
      // author, and naming one would be a permanent public claim that a real agent did this.
      legend: `RUIN · fell R${String(w.fellAtReckoning)} to ${byHandle ?? 'the world'}`,
    });
  }
  return out
    .sort((a, b) => b.fellAtTick - a.fellAtTick || compareIds(a.works, b.works))
    .slice(0, Math.max(0, limit));
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
