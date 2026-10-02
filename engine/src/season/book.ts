/**
 * The SEASON book: the grand venture's verdict, the standing baseline each season's titles are
 * measured from, and the record of every season that has closed.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS IS STATE AND NOT A PROJECTION OVER `event`.**
 *
 * Three things here cannot be recomputed from anything else the world holds:
 *
 *   1. **The verdict** — which grand candidate carried the yield — is decided at the delivery tick
 *      and read two ticks later by the settlement and the boundary. A verdict re-derived at the
 *      boundary would be re-derived from stakes that settlement had already released.
 *   2. **The baseline** — every principal's standing counters as the season opened. Standing is
 *      cumulative and never resets (A10), so *"kept the most THIS season"* is a difference, and the
 *      left-hand side of the difference is gone the moment the season moves on.
 *   3. **`closedThrough`** — which boundaries have been settled. The Levy learned this one the hard
 *      way (`runtime.ts`'s note on settlement flags): a guard held on the runtime survives an abort
 *      and resume, so a resumed boundary could close a season twice. In the hashed book it is rolled
 *      back with everything else the aborted tick touched.
 *
 * The records themselves *are* derivable — each close is a `PUBLIC` `season.closed` event row that
 * is never deleted (A5) — and they are kept here anyway, bounded, for the reason `campaign/book.ts`
 * keeps its pulse log: a frame that folded a season of rows every time it rendered is the
 * event-sourcing cliff SPEC §15.1 names by name.
 * ══════════════════════════════════════════════════════════════════════════
 */

import type { CanonicalValue } from '../core/canonical.js';
import type { GrantId, PrincipalId, SystemId, VentureId } from '../core/types.js';
import { minor, type Minor } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import {
  readArray,
  readInt,
  readObject,
  readString,
  readStringOrNull,
  readBool,
  SnapshotError,
  type StateTable,
} from '../tick/snapshot.js';
import { MAX_SEASON_RECORDS } from './params.js';

/** The standing counters a season's titles are measured from. All cumulative, all never reset. */
export interface StandingBaseline {
  readonly electiveHonoured: number;
  readonly electiveHonouredValue: Minor;
  readonly defaults: number;
  readonly distinctCounterparties: number;
}

/** One grand candidate as the verdict read it at the delivery tick. */
export interface VerdictTally {
  readonly venture: VentureId;
  readonly creator: PrincipalId;
  readonly staked: Minor;
  readonly live: boolean;
}

/** Which candidate carried the yield, decided once per season at the shared delivery tick. */
export interface GrandVerdict {
  readonly season: number;
  readonly decidedAtTick: number;
  /** The candidate that carries the yield, or null when no candidate was live. */
  readonly winner: VentureId | null;
  /** Every candidate that reached the delivery tick, in venture-id order. Bounded by the venture book. */
  readonly tallies: readonly VerdictTally[];
  /**
   * ★ The winner's roles whose election a **delegate** stated, as they stood at the verdict.
   *
   * Taken here because this is the one moment it is both final and still known: an election cannot be
   * restated in the freeze, the verdict is decided on the tick before it, and the settlement releases
   * the election book two ticks later. The season record reads it so a treasurer that elected its
   * grantor into a default at the FINALE is named on the record beside the grantor (A6, §8.1).
   */
  readonly electedBy: readonly ElectedByRow[];
}

/** One role of the winner whose election a delegate stated under a grant. */
export interface ElectedByRow {
  readonly index: number;
  readonly delegate: PrincipalId;
  readonly grant: GrantId;
}

/**
 * How the season's grand venture ended, in one word a viewer can read.
 *
 *   - `KEPT` — the yield was carried and every share owed to the crew was paid.
 *   - `BROKEN` — the yield was carried and at least one share went unpaid: a default on the creator.
 *   - `UNCLAIMED` — no candidate went live, so no yield was issued. Nothing was owed to anybody.
 *   - `OUTSTANDING` — the winner's settlement deferred (§15.3) and settles at the next Reckoning; the
 *     record says so rather than guessing which way it will go (A5′).
 */
export type GrandOutcome = 'KEPT' | 'BROKEN' | 'UNCLAIMED' | 'OUTSTANDING';

export const GRAND_OUTCOMES: readonly GrandOutcome[] = Object.freeze([
  'KEPT',
  'BROKEN',
  'UNCLAIMED',
  'OUTSTANDING',
] as GrandOutcome[]);

export function isGrandOutcome(s: string): s is GrandOutcome {
  return (GRAND_OUTCOMES as readonly string[]).includes(s);
}

/** One crew member's line on the record: what it was owed and what it was paid. */
export interface CrewLine {
  readonly index: number;
  readonly label: string;
  readonly principal: PrincipalId;
  /** The share it was owed at settlement, all of it elective. */
  readonly dueMinor: Minor;
  readonly paidMinor: Minor;
  /** The principal that stated the election on this role, when it was a delegate. Null otherwise. */
  readonly electedBy: PrincipalId | null;
}

/** The grand venture's line on a season's record. */
export interface GrandResult {
  readonly outcome: GrandOutcome;
  readonly venture: VentureId | null;
  readonly creator: PrincipalId | null;
  /** The delegate that formed it in the creator's name under a grant (A6), or null. */
  readonly formedBy: PrincipalId | null;
  readonly grant: GrantId | null;
  /** What the delivery actually issued. Zero when `UNCLAIMED`. */
  readonly proceedsMinor: Minor;
  /** Σ of the winner's stakes — what carried the verdict. */
  readonly stakedMinor: Minor;
  /** How many candidates reached the delivery tick, the winner included. */
  readonly candidates: number;
  readonly crew: readonly CrewLine[];
}

/** One season title — the Hall of Fame's shape, scoped to one season. Handles resolve at render. */
export interface SeasonTitle {
  readonly title: string;
  readonly principal: PrincipalId;
  readonly value: number;
  readonly clause: string;
}

/** A Frontier claim the boundary closed. */
export interface ClosedClaim {
  readonly system: SystemId;
  readonly claimant: PrincipalId;
}

/** Everything a closed season leaves on the record. Immutable once written. */
export interface SeasonRecord {
  readonly season: number;
  readonly firstTick: number;
  readonly finaleTick: number;
  readonly stage: SystemId | null;
  readonly baseYieldMinor: Minor;
  readonly grand: GrandResult;
  readonly titles: readonly SeasonTitle[];
  readonly closedClaims: readonly ClosedClaim[];
  readonly mootedCampaigns: readonly string[];
}

export class SeasonBookError extends Error {}

export class SeasonBook {
  /** The last season whose boundary has been settled. 0 until the first FINALE closes. */
  private closedThroughSeason = 0;
  private currentVerdict: GrandVerdict | null = null;
  /** The season the baseline below was taken at the start of. */
  private baselineSeasonNumber = 1;
  private readonly baselineRows = new Map<PrincipalId, StandingBaseline>();
  private readonly closed: SeasonRecord[] = [];

  get closedThrough(): number {
    return this.closedThroughSeason;
  }

  get baselineSeason(): number {
    return this.baselineSeasonNumber;
  }

  /**
   * Open a FRESH book at `season`: a world whose first tick falls in a later season starts with every
   * earlier season counted as closed and none of them on the record, because nothing happened in them
   * that this world saw. Refused on a book that already holds anything — a restore is not an opening.
   */
  openAt(season: number): void {
    if (this.closed.length > 0 || this.currentVerdict !== null || this.closedThroughSeason !== 0) {
      throw new SeasonBookError('openAt is for a fresh book; this one already holds a season');
    }
    if (!Number.isSafeInteger(season) || season < 1) {
      throw new SeasonBookError(`a season is a positive integer, got ${String(season)}`);
    }
    this.closedThroughSeason = season - 1;
    this.baselineSeasonNumber = season;
  }

  /** The verdict for `season`, or null before its delivery tick. */
  verdictFor(season: number): GrandVerdict | null {
    return this.currentVerdict !== null && this.currentVerdict.season === season ? this.currentVerdict : null;
  }

  /**
   * Record a season's verdict. **Once per season**: a second verdict would be a second winner, which
   * is a second yield issued from the faucet for one prize.
   */
  recordVerdict(verdict: GrandVerdict): void {
    if (this.verdictFor(verdict.season) !== null) {
      throw new SeasonBookError(`season ${String(verdict.season)} already has a grand verdict`);
    }
    if (this.currentVerdict !== null && this.currentVerdict.season > verdict.season) {
      throw new SeasonBookError(
        `season ${String(verdict.season)}'s verdict arrives after season ${String(this.currentVerdict.season)}'s`,
      );
    }
    if (verdict.season <= this.closedThroughSeason) {
      throw new SeasonBookError(`season ${String(verdict.season)} is already closed; its verdict is on the record`);
    }
    this.currentVerdict = verdict;
  }

  /** What a principal's standing counters read as the baseline season opened. Absent means zero. */
  baselineOf(principal: PrincipalId): StandingBaseline {
    return (
      this.baselineRows.get(principal) ?? {
        electiveHonoured: 0,
        electiveHonouredValue: minor(0),
        defaults: 0,
        distinctCounterparties: 0,
      }
    );
  }

  /**
   * Close `record.season`: append its record, clear its verdict, and open the next season's baseline.
   *
   * Refuses anything but the next season in order, so a boundary can neither skip a season nor
   * close one twice (SSN-4 audits the same thing from the list).
   */
  closeSeason(record: SeasonRecord, nextBaseline: ReadonlyMap<PrincipalId, StandingBaseline>): void {
    if (record.season !== this.closedThroughSeason + 1) {
      throw new SeasonBookError(
        `season ${String(record.season)} cannot close: the last closed season is ${String(this.closedThroughSeason)}`,
      );
    }
    this.closed.push(record);
    // Bounded (scar #3). The oldest leaves the working list; its event row never leaves the record.
    while (this.closed.length > MAX_SEASON_RECORDS) this.closed.shift();
    this.closedThroughSeason = record.season;
    // The verdict is KEPT until the next season records its own: the boundary tick's ASSERT still
    // checks the winner's delivery against it (SSN-5), and `verdictFor` is keyed by season, so a kept
    // verdict can never be read as the next season's.
    this.baselineRows.clear();
    for (const [principal, row] of [...nextBaseline.entries()].sort((a, b) => compareIds(a[0], b[0]))) {
      this.baselineRows.set(principal, row);
    }
    this.baselineSeasonNumber = record.season + 1;
  }

  /** Every closed season on the working list, oldest first. */
  records(): readonly SeasonRecord[] {
    return this.closed;
  }

  /** The most recently closed season, or null before the first FINALE. */
  last(): SeasonRecord | null {
    return this.closed[this.closed.length - 1] ?? null;
  }

  // ── capture / restore ──────────────────────────────────────────────────────

  capture(): CanonicalValue {
    const verdict = this.currentVerdict;
    return {
      closedThrough: this.closedThroughSeason,
      baselineSeason: this.baselineSeasonNumber,
      baseline: [...this.baselineRows.entries()]
        .sort((a, b) => compareIds(a[0], b[0]))
        .map(([principal, b]) => ({
          principal,
          electiveHonoured: b.electiveHonoured,
          electiveHonouredValue: b.electiveHonouredValue,
          defaults: b.defaults,
          distinctCounterparties: b.distinctCounterparties,
        })),
      verdict:
        verdict === null
          ? null
          : {
              season: verdict.season,
              decidedAtTick: verdict.decidedAtTick,
              winner: verdict.winner,
              tallies: verdict.tallies.map((t) => ({
                venture: t.venture,
                creator: t.creator,
                staked: t.staked,
                live: t.live,
              })),
              electedBy: verdict.electedBy.map((e) => ({ index: e.index, delegate: e.delegate, grant: e.grant })),
            },
      records: this.closed.map(captureRecord),
    };
  }

  restore(captured: CanonicalValue): void {
    const where = 'season';
    const o = readObject(captured, where);
    this.closedThroughSeason = readInt(o, 'closedThrough', where);
    this.baselineSeasonNumber = readInt(o, 'baselineSeason', where);
    this.baselineRows.clear();
    for (const [i, raw] of readArray(o['baseline'] ?? [], `${where}.baseline`).entries()) {
      const bw = `${where}.baseline[${String(i)}]`;
      const b = readObject(raw, bw);
      this.baselineRows.set(readString(b, 'principal', bw) as PrincipalId, {
        electiveHonoured: readInt(b, 'electiveHonoured', bw),
        electiveHonouredValue: minor(readInt(b, 'electiveHonouredValue', bw)),
        defaults: readInt(b, 'defaults', bw),
        distinctCounterparties: readInt(b, 'distinctCounterparties', bw),
      });
    }
    const v = o['verdict'];
    if (v === null || v === undefined) {
      this.currentVerdict = null;
    } else {
      const vw = `${where}.verdict`;
      const vo = readObject(v, vw);
      const winner = readStringOrNull(vo, 'winner', vw);
      this.currentVerdict = {
        season: readInt(vo, 'season', vw),
        decidedAtTick: readInt(vo, 'decidedAtTick', vw),
        winner: winner === null ? null : (winner as VentureId),
        tallies: readArray(vo['tallies'] ?? [], `${vw}.tallies`).map((raw, j) => {
          const tw = `${vw}.tallies[${String(j)}]`;
          const t = readObject(raw, tw);
          return {
            venture: readString(t, 'venture', tw) as VentureId,
            creator: readString(t, 'creator', tw) as PrincipalId,
            staked: minor(readInt(t, 'staked', tw)),
            live: readBool(t, 'live', tw),
          };
        }),
        electedBy: readArray(vo['electedBy'] ?? [], `${vw}.electedBy`).map((raw, j) => {
          const ew = `${vw}.electedBy[${String(j)}]`;
          const e = readObject(raw, ew);
          return {
            index: readInt(e, 'index', ew),
            delegate: readString(e, 'delegate', ew) as PrincipalId,
            grant: readString(e, 'grant', ew) as GrantId,
          };
        }),
      };
    }
    this.closed.length = 0;
    for (const [i, raw] of readArray(o['records'] ?? [], `${where}.records`).entries()) {
      this.closed.push(restoreRecord(raw, `${where}.records[${String(i)}]`));
    }
  }
}

function captureRecord(r: SeasonRecord): CanonicalValue {
  return {
    season: r.season,
    firstTick: r.firstTick,
    finaleTick: r.finaleTick,
    stage: r.stage,
    baseYieldMinor: r.baseYieldMinor,
    grand: {
      outcome: r.grand.outcome,
      venture: r.grand.venture,
      creator: r.grand.creator,
      formedBy: r.grand.formedBy,
      grant: r.grand.grant,
      proceedsMinor: r.grand.proceedsMinor,
      stakedMinor: r.grand.stakedMinor,
      candidates: r.grand.candidates,
      crew: r.grand.crew.map((c) => ({
        index: c.index,
        label: c.label,
        principal: c.principal,
        dueMinor: c.dueMinor,
        paidMinor: c.paidMinor,
        electedBy: c.electedBy,
      })),
    },
    titles: r.titles.map((t) => ({ title: t.title, principal: t.principal, value: t.value, clause: t.clause })),
    closedClaims: r.closedClaims.map((c) => ({ system: c.system, claimant: c.claimant })),
    mootedCampaigns: [...r.mootedCampaigns],
  };
}

function restoreRecord(raw: CanonicalValue, where: string): SeasonRecord {
  const o = readObject(raw, where);
  const gw = `${where}.grand`;
  const g = readObject(o['grand'] ?? null, gw);
  const outcome = readString(g, 'outcome', gw);
  if (!isGrandOutcome(outcome)) throw new SnapshotError(`${gw}: unknown grand outcome ${outcome}`);
  const venture = readStringOrNull(g, 'venture', gw);
  const creator = readStringOrNull(g, 'creator', gw);
  const formedBy = readStringOrNull(g, 'formedBy', gw);
  const grant = readStringOrNull(g, 'grant', gw);
  const stage = readStringOrNull(o, 'stage', where);
  return {
    season: readInt(o, 'season', where),
    firstTick: readInt(o, 'firstTick', where),
    finaleTick: readInt(o, 'finaleTick', where),
    stage: stage === null ? null : (stage as SystemId),
    baseYieldMinor: minor(readInt(o, 'baseYieldMinor', where)),
    grand: {
      outcome,
      venture: venture === null ? null : (venture as VentureId),
      creator: creator === null ? null : (creator as PrincipalId),
      formedBy: formedBy === null ? null : (formedBy as PrincipalId),
      grant: grant === null ? null : (grant as GrantId),
      proceedsMinor: minor(readInt(g, 'proceedsMinor', gw)),
      stakedMinor: minor(readInt(g, 'stakedMinor', gw)),
      candidates: readInt(g, 'candidates', gw),
      crew: readArray(g['crew'] ?? [], `${gw}.crew`).map((rawCrew, j) => {
        const cw = `${gw}.crew[${String(j)}]`;
        const c = readObject(rawCrew, cw);
        const electedBy = readStringOrNull(c, 'electedBy', cw);
        return {
          index: readInt(c, 'index', cw),
          label: readString(c, 'label', cw),
          principal: readString(c, 'principal', cw) as PrincipalId,
          dueMinor: minor(readInt(c, 'dueMinor', cw)),
          paidMinor: minor(readInt(c, 'paidMinor', cw)),
          electedBy: electedBy === null ? null : (electedBy as PrincipalId),
        };
      }),
    },
    titles: readArray(o['titles'] ?? [], `${where}.titles`).map((rawTitle, j) => {
      const tw = `${where}.titles[${String(j)}]`;
      const t = readObject(rawTitle, tw);
      return {
        title: readString(t, 'title', tw),
        principal: readString(t, 'principal', tw) as PrincipalId,
        value: readInt(t, 'value', tw),
        clause: readString(t, 'clause', tw),
      };
    }),
    closedClaims: readArray(o['closedClaims'] ?? [], `${where}.closedClaims`).map((rawClaim, j) => {
      const cw = `${where}.closedClaims[${String(j)}]`;
      const c = readObject(rawClaim, cw);
      return {
        system: readString(c, 'system', cw) as SystemId,
        claimant: readString(c, 'claimant', cw) as PrincipalId,
      };
    }),
    mootedCampaigns: readArray(o['mootedCampaigns'] ?? [], `${where}.mootedCampaigns`).map((rawId, j) => {
      if (typeof rawId !== 'string') throw new SnapshotError(`${where}.mootedCampaigns[${String(j)}]: expected a string`);
      return rawId;
    }),
  };
}

/**
 * The season book inside `state_hash` and the rollback set, from the change that added it.
 *
 * Its `CHECKPOINT_REQUIRED_TABLES` entry lands in the same change for the reason every other book's
 * did: a restorable table missing from the manifest is a book an adoption drops while the gate
 * reports nothing missing — here, a world that comes up with its grand verdict forgotten two ticks
 * before the yield it decided is paid, or with a closed season open again.
 */
export function seasonStateTable(getBook: () => SeasonBook, setBook: (book: SeasonBook) => void): StateTable {
  return {
    name: 'season',
    capture(): CanonicalValue {
      return getBook().capture();
    },
    restore(captured: CanonicalValue): void {
      const fresh = new SeasonBook();
      fresh.restore(captured);
      setBook(fresh);
    },
  };
}
