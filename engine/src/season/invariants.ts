/**
 * `SSN-1` … `SSN-5` — the season and the grand venture as executable rules rather than review items.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE TWENTY-SIX STAY TWENTY-SIX.** A prefixed family in the shape `CMP-*`, `SOV-*`, `PRD-*` and
 * `MKT-*` already use: supplied through the tick loop's `assertions` hook, merged into the same ASSERT
 * pass, halting on the same terms. Every function returns violations and none throws — a grand
 * venture is reachable from agent verbs, and a throw out of a phase is an outage where a refusal
 * would have cost one action.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The two that carry the most weight:
 *
 *   - **SSN-2 is A10 asserted every tick.** *"Frontier claims … settle and re-open on a season
 *     boundary."* A live Frontier claim that predates the current season is a boundary that did not
 *     run, and the symptom would otherwise be invisible: the incumbent simply keeps its ground.
 *   - **SSN-5 is the one-prize rule.** A second verdict, or a non-winner that delivered anything, is a
 *     second yield issued from the faucet for one prize — supply the design never budgeted.
 */

import type { InvariantViolation, SystemId } from '../core/types.js';
import type { Minor } from '../core/units.js';
import { halt } from '../invariants/registry.js';
import { compareIds } from '../ledger/order.js';
import { tierOf, type WorldMap } from '../world/map.js';
import type { VentureRecord } from '../venture/venture.js';
import type { SeasonBook } from './book.js';
import { finaleTickOf, isSeasonBoundaryTick, seasonFirstTick, seasonOf } from './clock.js';
import { grandStageFor, grandWindowOf } from './grand.js';
import { GRAND_BASE_YIELD_MINOR, GRAND_KIND } from './params.js';

export interface SeasonInvariantInputs {
  readonly tick: number;
  readonly book: SeasonBook;
  readonly map: WorldMap;
  /** The runtime's formation window plus delivery lead — the grand window's slack. */
  readonly slackTicks: number;
  /** Every grand venture still in the venture book, any state. */
  readonly grandVentures: readonly VentureRecord[];
  /** Every LIVE claim: where it is and when it was raised. */
  readonly liveClaims: readonly { readonly system: SystemId; readonly takenAtTick: number }[];
  /** What a venture's delivery issued, or null before it delivered. */
  readonly deliveredProceeds: (venture: VentureRecord) => Minor | null;
}

export function checkSeasonInvariants(input: SeasonInvariantInputs): readonly InvariantViolation[] {
  return [
    ...checkSsn1(input),
    ...checkSsn2(input),
    ...checkSsn3(input),
    ...checkSsn4(input),
    ...checkSsn5(input),
  ];
}

/**
 * **SSN-1 — every grand venture is the one the season published.** Its kind, its yield, its stage,
 * its formation tick and its settlement are all published rules (A2), and a grand venture that
 * differs from them on any one is an engine bug wearing a prize.
 */
export function checkSsn1(input: SeasonInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const v of [...input.grandVentures].sort((a, b) => compareIds(a.id, b.id))) {
    const g = v.grand;
    if (g === null) continue;
    const window = grandWindowOf(g.season, input.slackTicks);
    const stage = grandStageFor(input.map, g.season);
    const problems: string[] = [];
    if (v.kind !== GRAND_KIND) problems.push(`its kind is ${v.kind}, not ${GRAND_KIND}`);
    if (g.baseYieldMinor !== GRAND_BASE_YIELD_MINOR) {
      problems.push(`its yield is ${String(g.baseYieldMinor)}, not the published ${String(GRAND_BASE_YIELD_MINOR)}`);
    }
    if (v.stage !== stage) problems.push(`it is staged at ${v.stage}, not the season's ${String(stage)}`);
    if (v.windowOpensTick < window.opens_tick || v.windowOpensTick > window.closes_tick) {
      problems.push(
        `it was formed at tick ${String(v.windowOpensTick)}, outside the grand window ` +
          `${String(window.opens_tick)}..${String(window.closes_tick)}`,
      );
    }
    if (v.resolvesAtTick !== finaleTickOf(g.season)) {
      problems.push(`it resolves at ${String(v.resolvesAtTick)}, not the FINALE at ${String(finaleTickOf(g.season))}`);
    }
    if (problems.length > 0) {
      out.push(halt('SSN-1', input.tick, `grand venture ${v.id} (season ${String(g.season)}): ${problems.join('; ')}`));
    }
  }
  return out;
}

/**
 * **SSN-2 — no live Frontier claim predates the current season.** A10's reset, asserted rather than
 * hoped: the boundary ends every Frontier claim at the FINALE (`SEASON_ENDED`), so one raised before
 * this season's first tick and still standing is a season that did not close.
 */
export function checkSsn2(input: SeasonInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  if (input.tick < 0) return out;
  const opened = seasonFirstTick(seasonOf(input.tick));
  for (const c of [...input.liveClaims].sort((a, b) => compareIds(a.system, b.system))) {
    if (tierOf(input.map, c.system) !== 'FRONTIER') continue;
    if (c.takenAtTick >= opened) continue;
    out.push(
      halt(
        'SSN-2',
        input.tick,
        `the Frontier claim on ${c.system} was raised at tick ${String(c.takenAtTick)}, before this season opened ` +
          `at ${String(opened)}, and is still live — the season boundary did not close it (A10)`,
      ),
    );
  }
  return out;
}

/**
 * **SSN-3 — the book and the clock agree about which seasons are closed.** Off the boundary tick the
 * last closed season is the one before this; on it, after the boundary step, it is this one.
 */
export function checkSsn3(input: SeasonInvariantInputs): readonly InvariantViolation[] {
  if (input.tick < 0) return [];
  const season = seasonOf(input.tick);
  const want = isSeasonBoundaryTick(input.tick) ? season : season - 1;
  if (input.book.closedThrough === want) return [];
  return [
    halt(
      'SSN-3',
      input.tick,
      `the season book says seasons are closed through ${String(input.book.closedThrough)}; at tick ` +
        `${String(input.tick)} the clock says ${String(want)}`,
    ),
  ];
}

/** **SSN-4 — the record of closed seasons is contiguous and each one closed at its own FINALE.** */
export function checkSsn4(input: SeasonInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const records = input.book.records();
  for (const [i, r] of records.entries()) {
    const prev = records[i - 1];
    if (prev !== undefined && r.season !== prev.season + 1) {
      out.push(halt('SSN-4', input.tick, `season records jump from ${String(prev.season)} to ${String(r.season)}`));
    }
    if (r.finaleTick !== finaleTickOf(r.season)) {
      out.push(
        halt('SSN-4', input.tick, `season ${String(r.season)} records its FINALE at ${String(r.finaleTick)}, not ${String(finaleTickOf(r.season))}`),
      );
    }
  }
  const last = records[records.length - 1];
  if (last !== undefined && last.season !== input.book.closedThrough) {
    out.push(
      halt(
        'SSN-4',
        input.tick,
        `the last season record is ${String(last.season)} and the book says closed through ${String(input.book.closedThrough)}`,
      ),
    );
  }
  return out;
}

/**
 * **SSN-5 — one prize.** The verdict names a live candidate with the largest stake of any live
 * candidate, and no candidate but the winner delivered anything.
 *
 * Checked per venture against **its own season's** verdict, so the check is as true on the boundary
 * tick (the verdict is kept until the next season records its own) as on the delivery tick. A venture
 * of a season whose verdict has since been replaced is history and is not re-judged here — its
 * delivery is on the record, and the record is append-only.
 */
export function checkSsn5(input: SeasonInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const season = input.tick < 0 ? 1 : seasonOf(input.tick);
  const verdict = input.book.verdictFor(season);
  if (verdict !== null && verdict.winner !== null) {
    const win = verdict.tallies.find((t) => t.venture === verdict.winner);
    if (win === undefined || !win.live) {
      out.push(halt('SSN-5', input.tick, `season ${String(season)}'s winner ${verdict.winner} is not a live candidate`));
    } else {
      for (const t of verdict.tallies) {
        if (t.live && t.staked > win.staked) {
          out.push(
            halt('SSN-5', input.tick, `${t.venture} staked ${String(t.staked)}, more than the winner's ${String(win.staked)}`),
          );
        }
      }
    }
  }
  for (const v of [...input.grandVentures].sort((a, b) => compareIds(a.id, b.id))) {
    if (v.grand === null) continue;
    const delivered = input.deliveredProceeds(v);
    if (delivered === null || delivered === 0) continue;
    const own = input.book.verdictFor(v.grand.season);
    if (own === null && v.grand.season < season) continue;
    if (own !== null && own.winner === v.id) continue;
    out.push(
      halt(
        'SSN-5',
        input.tick,
        `grand candidate ${v.id} delivered ${String(delivered)} without carrying the verdict — a second yield ` +
          'for one prize',
      ),
    );
  }
  return out;
}
