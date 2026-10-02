/**
 * The season as an agent reads it in `header.season`, and as a viewer sees it on the frame.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **ONE BUILDER FOR BOTH READERSHIPS, AND THE REDACTION IS THE ONLY DIFFERENCE.**
 *
 * A9: *"the spectator client never shows a fact an observing agent's own `observe` would not
 * contain."* So the frame's season line is this function called with **no viewer**, and an agent's
 * header block is the same function called with the agent as viewer — which can only ADD facts the
 * agent is party to (its own crew's sealed stakes), never remove one the frame carries. Two builders
 * would be two answers to *"how much has that crew staked"*, and the first disagreement would be a
 * viewer seeing a figure no agent can (A9 inverted) or an agent missing a figure the screen shows.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## The commitment window seals a crew's late stakes
 *
 * §5.1: *"commitments made in this window are `PARTIES`-visible only … this is what stops late
 * information from being superior information (A4)."* The grand contest is decided by stake, so it is
 * the one place where publishing a late stake would hand the last crew to fill a free look at every
 * rival's bid. A stake committed inside the FINALE's commitment window is therefore counted in
 * `sealed_fills` and left out of the public `staked`, and only the crew's own parties see their full
 * total (`your_crew_staked`). The verdict, once decided, publishes every tally — it is a settled fact.
 */

import { WINDOW_FIRST_PHASE } from '../core/time.js';
import type { PrincipalId, SystemId, VentureId, VentureKind } from '../core/types.js';
import { addMinor, minor, type Bps, type Minor } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import type { VentureRecord, VentureRoleRecord } from '../venture/venture.js';
import type { GrandVerdict, SeasonRecord } from './book.js';
import { seasonClockAt, type SeasonClock } from './clock.js';
import { inGrandWindow, type GrandWindow } from './grand.js';
import {
  GRAND_BASE_YIELD_MINOR,
  GRAND_KIND,
  GRAND_ROLE_STAKE_MINOR,
  GRAND_VENTURE_SUMMARY,
  MAX_LISTED_GRAND_CANDIDATES,
} from './params.js';

/** One crew slot on a candidate. The holder is public, as every venture's role-holder is. */
export interface GrandSlotLine {
  readonly index: number;
  readonly label: string;
  /** The role's share of the yield, in bps. Every BUILD share is its marginal output. */
  readonly share_bps: Bps;
  readonly holder: PrincipalId | null;
}

/** One grand candidate, as everybody may read it. */
export interface GrandCandidateLine {
  readonly venture: VentureId;
  readonly creator: PrincipalId;
  /** The delegate that formed it in the creator's name under a grant (A6), or null. */
  readonly formed_by: PrincipalId | null;
  readonly state: string;
  readonly roles_filled: number;
  readonly roles_total: number;
  /** Σ of the stakes committed BEFORE the FINALE's commitment window. Public. */
  readonly staked: Minor;
  /** Fills inside the commitment window, whose stakes stay sealed until the verdict. */
  readonly sealed_fills: number;
  /** Present only for the candidate's own parties: its full stake, sealed fills included. */
  readonly your_crew_staked?: Minor;
  readonly slots: readonly GrandSlotLine[];
}

/** The verdict, once the delivery tick has decided it. Every tally is public from then on. */
export interface GrandVerdictLine {
  readonly decided_at_tick: number;
  readonly winner: VentureId | null;
  readonly tallies: readonly { readonly venture: VentureId; readonly staked: Minor; readonly live: boolean }[];
}

/** `header.season.grand` — the announcement, the contest, and the rule that decides it. */
export interface GrandBlock {
  /** The Frontier system it is staged at, or null on a map with no Frontier. */
  readonly stage: SystemId | null;
  readonly kind: VentureKind;
  /** What it yields at a full fill — in place of the kind's own yield. */
  readonly base_yield: Minor;
  readonly opens_tick: number;
  /** The last tick a candidate may be formed and still settle at the FINALE. */
  readonly closes_tick: number;
  readonly finale_tick: number;
  /** The least each role stakes, out of earned cash (`market.transferable_minor`). */
  readonly stake_per_role: Minor;
  /** True on the ticks a grand `create` is accepted. */
  readonly open_now: boolean;
  readonly candidates: readonly GrandCandidateLine[];
  readonly verdict: GrandVerdictLine | null;
  /** {@link GRAND_VENTURE_SUMMARY}: one line and the `agent.md` section that carries the statement. */
  readonly rule: string;
}

/** The last closed season, in the shape a newcomer can read in one line per fact. */
export interface LastSeasonLine {
  readonly season: number;
  readonly outcome: string;
  readonly venture: VentureId | null;
  readonly creator: PrincipalId | null;
  readonly formed_by: PrincipalId | null;
  readonly proceeds: Minor;
  readonly unpaid_shares: number;
  readonly titles: readonly { readonly title: string; readonly principal: PrincipalId; readonly value: number }[];
}

/** `header.season`: the clock, the grand venture, and the season that just closed. */
export interface SeasonBlock extends SeasonClock {
  readonly grand: GrandBlock;
  readonly last_season: LastSeasonLine | null;
}

/** What the builder reads. Narrow on purpose: the signature enumerates what the view can see. */
export interface SeasonViewPort {
  readonly tick: number;
  readonly stage: SystemId | null;
  readonly window: GrandWindow;
  /** This season's grand ventures, any state. */
  readonly candidates: readonly VentureRecord[];
  /** The stake one role locked at fill, or zero. Read off the ledger's lock, never a copy of it. */
  stakeOf(role: VentureRoleRecord): Minor;
  readonly verdict: GrandVerdict | null;
  readonly last: SeasonRecord | null;
}

/** The first tick of the FINALE's commitment window: stakes committed from here on are sealed. */
export function sealedFromTick(window: GrandWindow): number {
  return window.opens_tick + WINDOW_FIRST_PHASE;
}

/** Is a candidate one the viewer is party to (its creator or a role-holder)? */
function partyTo(venture: VentureRecord, viewer: PrincipalId | null): boolean {
  if (viewer === null) return false;
  if (venture.creator === viewer) return true;
  return venture.roles.some((r) => r.filledByPrincipal === viewer);
}

export function grandCandidateLine(
  port: SeasonViewPort,
  venture: VentureRecord,
  viewer: PrincipalId | null,
): GrandCandidateLine {
  const sealedFrom = sealedFromTick(port.window);
  let publicStake = minor(0);
  let fullStake = minor(0);
  let sealed = 0;
  for (const role of venture.roles) {
    if (role.filledByPrincipal === null) continue;
    const stake = port.stakeOf(role);
    fullStake = addMinor(fullStake, stake);
    if ((role.filledAtTick ?? 0) >= sealedFrom) sealed += 1;
    else publicStake = addMinor(publicStake, stake);
  }
  const line: GrandCandidateLine = {
    venture: venture.id,
    creator: venture.creator,
    formed_by: venture.actedBy,
    state: venture.state,
    roles_filled: venture.roles.filter((r) => r.filledByPrincipal !== null).length,
    roles_total: venture.roles.length,
    staked: publicStake,
    sealed_fills: sealed,
    slots: venture.roles.map((r) => ({
      index: r.index,
      label: r.label,
      share_bps: (r.terms.share ?? 0) as Bps,
      holder: r.filledByPrincipal,
    })),
  };
  return partyTo(venture, viewer) ? { ...line, your_crew_staked: fullStake } : line;
}

export function grandBlockFor(port: SeasonViewPort, viewer: PrincipalId | null): GrandBlock {
  const lines = port.candidates
    .filter((v) => v.state === 'FORMING' || v.state === 'LIVE')
    .map((v) => grandCandidateLine(port, v, viewer))
    .sort((a, b) => (b.staked !== a.staked ? b.staked - a.staked : compareIds(a.venture, b.venture)))
    .slice(0, MAX_LISTED_GRAND_CANDIDATES);
  const verdict = port.verdict;
  return {
    stage: port.stage,
    kind: GRAND_KIND,
    base_yield: GRAND_BASE_YIELD_MINOR,
    opens_tick: port.window.opens_tick,
    closes_tick: port.window.closes_tick,
    finale_tick: port.window.finale_tick,
    stake_per_role: GRAND_ROLE_STAKE_MINOR,
    open_now: port.stage !== null && inGrandWindow(port.tick, port.window),
    candidates: lines,
    verdict:
      verdict === null
        ? null
        : {
            decided_at_tick: verdict.decidedAtTick,
            winner: verdict.winner,
            tallies: verdict.tallies.map((t) => ({ venture: t.venture, staked: t.staked, live: t.live })),
          },
    rule: GRAND_VENTURE_SUMMARY,
  };
}

export function lastSeasonLine(record: SeasonRecord | null): LastSeasonLine | null {
  if (record === null) return null;
  return {
    season: record.season,
    outcome: record.grand.outcome,
    venture: record.grand.venture,
    creator: record.grand.creator,
    formed_by: record.grand.formedBy,
    proceeds: record.grand.proceedsMinor,
    unpaid_shares: record.grand.crew.filter((c) => c.paidMinor < c.dueMinor).length,
    titles: record.titles.map((t) => ({ title: t.title, principal: t.principal, value: t.value })),
  };
}

/** `header.season`, for `viewer` — or the public version, with `viewer` null, for the frame. */
export function seasonBlockFor(port: SeasonViewPort, viewer: PrincipalId | null): SeasonBlock {
  return {
    ...seasonClockAt(port.tick),
    grand: grandBlockFor(port, viewer),
    last_season: lastSeasonLine(port.last),
  };
}
