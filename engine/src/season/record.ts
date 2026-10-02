/**
 * What a closed season leaves on the record: its titles and its grand venture's outcome.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE TITLES ARE THE HALL OF FAME'S OWN RULES, OVER ONE SEASON'S DIFFERENCE.**
 *
 * SPEC §16's *Remembered* criterion names a Hall of Fame of *"season champions, largest promise
 * kept, largest broken, longest unbroken streak"*, and `frames/memory.ts:hallOfFame` already decides
 * those four titles honestly — each row says what its number IS, and an empty row is omitted rather
 * than shown as a fabricated zero. A second set of title rules for seasons would be two homes for the
 * question *"who earned this"* (scar #5), so a season's titles are that same function applied to
 * **this season's standing minus the season's opening baseline**. Standing itself never resets
 * (A10); the season's champions are measured on the season's own play, which is what lets a newcomer
 * hold one in its first season while the all-time board still belongs to the incumbents.
 * ══════════════════════════════════════════════════════════════════════════
 */

import type { GrantId, PrincipalId, Standing, VentureId } from '../core/types.js';
import { addMinor, minor, type Minor } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import { hallOfFame } from '../frames/memory.js';
import type { VentureSettlement } from '../venture/settlement.js';
import type { CrewLine, GrandOutcome, GrandResult, GrandVerdict, SeasonTitle, StandingBaseline } from './book.js';

/**
 * Each principal's standing **over the season**: current counters less the season's baseline.
 *
 * `lastDefaultTick` is kept only when the default fell inside the season, so the NEVER-BROKEN title's
 * streak clause reads this season's conduct and not a default from three seasons ago. Rows with no
 * movement at all are dropped — a fabricated clean season is a claim nothing supports.
 */
export function seasonDeltaStandings(
  current: readonly Standing[],
  baselineOf: (principal: PrincipalId) => StandingBaseline,
  seasonFirstTick: number,
): readonly Standing[] {
  const out: Standing[] = [];
  for (const s of [...current].sort((a, b) => compareIds(a.principal, b.principal))) {
    const b = baselineOf(s.principal);
    const delta: Standing = {
      principal: s.principal,
      electiveHonoured: Math.max(0, s.electiveHonoured - b.electiveHonoured),
      electiveHonouredValue: minor(Math.max(0, s.electiveHonouredValue - b.electiveHonouredValue)),
      defaults: Math.max(0, s.defaults - b.defaults),
      contradictedSeals: 0,
      distinctCounterparties: Math.max(0, s.distinctCounterparties - b.distinctCounterparties),
      lastDefaultTick: s.lastDefaultTick !== null && s.lastDefaultTick >= seasonFirstTick ? s.lastDefaultTick : null,
    };
    if (
      delta.electiveHonoured === 0 &&
      delta.electiveHonouredValue === 0 &&
      delta.defaults === 0 &&
      delta.distinctCounterparties === 0
    ) {
      continue;
    }
    out.push(delta);
  }
  return out;
}

/** The season's titles: the Hall of Fame's four rules over the season's difference. */
export function seasonTitlesFrom(deltas: readonly Standing[]): readonly SeasonTitle[] {
  return hallOfFame(deltas, new Map()).map((row) => ({
    title: row.title,
    principal: row.principal,
    value: row.value,
    clause: row.clause,
  }));
}

/** The next season's baseline: every principal's counters as this one closes. */
export function baselineFrom(current: readonly Standing[]): ReadonlyMap<PrincipalId, StandingBaseline> {
  const out = new Map<PrincipalId, StandingBaseline>();
  for (const s of [...current].sort((a, b) => compareIds(a.principal, b.principal))) {
    out.set(s.principal, {
      electiveHonoured: s.electiveHonoured,
      electiveHonouredValue: s.electiveHonouredValue,
      defaults: s.defaults,
      distinctCounterparties: s.distinctCounterparties,
    });
  }
  return out;
}

/** What the boundary knows about the winning candidate after the FINALE settled. */
export interface WinnerFacts {
  readonly venture: VentureId;
  readonly creator: PrincipalId;
  readonly formedBy: PrincipalId | null;
  readonly grant: GrantId | null;
  /** The venture's state after settlement. */
  readonly state: string;
  readonly proceedsMinor: Minor;
}

/**
 * The grand venture's line on the record.
 *
 * **Read off the settlement that actually ran**, never re-derived: the payouts are what the ledger
 * moved, and the outcome word follows from them — `BROKEN` exactly when the settlement wrote a
 * default, which is the one thing A5′ allows the record to say about a payer.
 */
export function grandResultFrom(args: {
  readonly verdict: GrandVerdict | null;
  readonly winner: WinnerFacts | null;
  readonly settlement: VentureSettlement | null;
  readonly electedBy: (roleIndex: number) => PrincipalId | null;
}): GrandResult {
  const verdict = args.verdict;
  const candidates = verdict === null ? 0 : verdict.tallies.length;
  const winnerTally = verdict?.tallies.find((t) => t.venture === verdict.winner) ?? null;
  if (verdict === null || verdict.winner === null || args.winner === null) {
    return {
      outcome: 'UNCLAIMED',
      venture: null,
      creator: null,
      formedBy: null,
      grant: null,
      proceedsMinor: minor(0),
      stakedMinor: minor(0),
      candidates,
      crew: [],
    };
  }
  const s = args.settlement;
  const crew: CrewLine[] = [];
  if (s !== null) {
    for (const p of [...s.payouts].sort((a, b) => a.roleIndex - b.roleIndex)) {
      if (p.holder === null) continue;
      crew.push({
        index: p.roleIndex,
        label: p.label,
        principal: p.holder,
        dueMinor: addMinor(p.escrowedDue, p.electiveDue),
        paidMinor: addMinor(p.escrowedPaid, p.electivePaid),
        electedBy: args.electedBy(p.roleIndex),
      });
    }
  }
  let outcome: GrandOutcome;
  if (s !== null) {
    outcome = s.terminalState === 'DEFERRED' ? 'OUTSTANDING' : s.defaults.length > 0 ? 'BROKEN' : 'KEPT';
  } else {
    // No settlement row in tonight's batch: read the venture's own terminal state. A venture still
    // live here is one the boundary cannot speak for yet, and the record says so.
    outcome = args.winner.state === 'DEFAULTED' ? 'BROKEN' : args.winner.state === 'SETTLED' ? 'KEPT' : 'OUTSTANDING';
  }
  return {
    outcome,
    venture: args.winner.venture,
    creator: args.winner.creator,
    formedBy: args.winner.formedBy,
    grant: args.winner.grant,
    proceedsMinor: args.winner.proceedsMinor,
    stakedMinor: winnerTally?.staked ?? minor(0),
    candidates,
    crew,
  };
}

/** One line a viewer reads about the finale. ≤140 characters, like every ticker line (§11.1). */
export function finaleLine(season: number, grand: GrandResult, handleOf: (p: PrincipalId) => string): string {
  const tag = `SEASON ${String(season)} FINALE`;
  if (grand.outcome === 'UNCLAIMED' || grand.creator === null) {
    return `${tag}: the grand venture went unclaimed — no crew went live.`.slice(0, 140);
  }
  const who = handleOf(grand.creator);
  const by = grand.formedBy === null ? '' : ` (formed by ${handleOf(grand.formedBy)})`;
  const unpaid = grand.crew.filter((c) => c.paidMinor < c.dueMinor).length;
  if (grand.outcome === 'KEPT') {
    return `${tag}: ${who}${by} carried ${String(grand.proceedsMinor)} and paid every share.`.slice(0, 140);
  }
  if (grand.outcome === 'BROKEN') {
    return `${tag}: ${who}${by} carried ${String(grand.proceedsMinor)} and left ${String(unpaid)} share(s) unpaid.`.slice(
      0,
      140,
    );
  }
  return `${tag}: ${who}${by} carried ${String(grand.proceedsMinor)}; the shares settle next Reckoning.`.slice(0, 140);
}
