/**
 * Settled Reckoning → `ReckoningFrame`. The last mile from world to screen.
 *
 * Two of the three goals are about watching, and until this file existed the sim
 * could settle 61 ventures with nobody able to see one. The client already knows how
 * to draw a `ReckoningFrame` (`client/index.html`); this is what fills it.
 *
 * **It reads a settled outcome and nothing else.** No live sim handle, no database
 * handle. That is what keeps two guarantees structural rather than disciplined:
 *
 *   - **A9 parity.** A viewer cannot be shown a live fact a non-party agent's own
 *     `observe` would not show, because this function is not given access to one.
 *     Agents read the public feed, so any viewer privilege is immediately an agent
 *     exploit.
 *   - **`broadcast_speed` independent of `sim_speed`** (TESTING.md §1.1 hazard 3). The
 *     rundown's 6–9 minutes is *human* time. Rendering from a settled outcome means a
 *     world generated overnight at 30× replays at whatever pace a viewer needs, which
 *     is the only reason the watchability suite is affordable.
 *
 * The director's job is ordering and selection, and both are arithmetic here rather
 * than taste: ascending by stakes, biggest say-do deltas last, budgets asserted by
 * `assertFrameBudgets`. A13 says every mechanic renders; the scoring panel found
 * Legible scored lowest precisely because bolted-on mechanics got prose and no pixels.
 */

import type { Handle, PrincipalId, VentureId } from '../core/types.js';
import { addMinor, minor, type Minor } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import {
  MAX_AUTHORITY_LINES,
  MAX_DOCKET_CARDS,
  MAX_RAID_LINES,
  MAX_LABELS_PER_FRAME,
  MAX_RUNDOWN_SEGMENTS,
  assertFrameBudgets,
  type AuthorityLine,
  type CastChip,
  type DocketCard,
  type RaidLine,
  MAX_FRAME_CLAIM_LINES,
  type ClaimLine,
  MAX_FRAME_WORKS_LINES,
  MAX_FRAME_SYNDICATE_LINES,
  type MapSystem,
  type WorksLine,
  type SyndicateLine,
  type ReckoningFrame,
  type RundownSegment,
  type TributeLine,
  type VentureGlyph,
} from './contract.js';

/** Everything the renderer is allowed to know. Deliberately small. */
export interface FrameSource {
  readonly reckoning: number;
  readonly tick: number;
  readonly stateHash: string;
  readonly settled: readonly SettledView[];
  readonly meters: {
    readonly levyShort: Minor;
    readonly onAPromise: Minor;
    readonly kept: number;
    readonly broken: number;
  };
  /** Handle per principal, for labels. A frame never shows a raw id. */
  readonly handles: ReadonlyMap<PrincipalId, Handle>;
  readonly modelBadges?: ReadonlyMap<PrincipalId, string>;
  /** Ticker lines already produced by the world (140 chars, tick-stamped). */
  readonly ticker: readonly string[];
  /** What is scheduled for the next Reckoning, for the closing card. */
  readonly tomorrow: readonly UpcomingView[];
  /**
   * The Levy's tribute lines (§5.2), supplied by the Levy layer.
   *
   * Optional because a frame from a world with no Levy has none — but **absent and empty
   * are the same claim here, which is why it is passed in rather than computed**: a
   * renderer that drew its own lines would be inventing an obligation, and a drawn line
   * nobody owes is a lie on the map.
   */
  readonly tributeLines?: readonly TributeLine[];
  /**
   * The A6 authority lines (§8), supplied by the grant layer — who holds standing power
   * over whom, at this settlement. Optional and passed in for the same reason tribute
   * lines are: a renderer that drew its own would be inventing authority nobody granted.
   */
  readonly authorityLines?: readonly AuthorityLine[];
  /**
   * Predation's raid lines (§9, A13), supplied by the predation layer.
   *
   * Optional and passed in for the reason tribute and authority lines are: a renderer
   * that drew its own would be inventing a raid, and a red arc thrown at a holding
   * nobody attacked is the worst lie this frame could tell.
   */
  readonly raidLines?: readonly RaidLine[];
  /**
   * Sovereignty's claim lines (§6.3, A13), supplied by the sovereignty layer.
   *
   * Optional and passed in for the reason every other line set is: a renderer that computed
   * its own would be inventing an obligation, and a tint reading `NEXT MISS LAPSES` over a
   * claim nobody is short on is a lie about a real agent's territory that a stranger has no
   * second source for. This file cannot know what is owed and must not guess.
   */
  readonly claimLines?: readonly ClaimLine[];
  readonly worksLines?: readonly WorksLine[];
  readonly syndicateLines?: readonly SyndicateLine[];
  readonly map?: readonly MapSystem[];
}

export interface SettledView {
  readonly venture: VentureId;
  readonly kind: string;
  readonly stage: string;
  readonly creator: PrincipalId;
  readonly rolesFilled: number;
  readonly rolesTotal: number;
  readonly electiveBps: number;
  /** The value that was riding on the elective half — what the drama is about. */
  readonly atStake: Minor;
  readonly defaulted: boolean;
  readonly deferred: boolean;
  /** Parties, in id order. The renderer never re-sorts by anything unstable. */
  readonly parties: readonly PrincipalId[];
  readonly publicLine: string | null;
  readonly sealVerdict: 'HONOURED' | 'CONTRADICTED' | null;
  /** Declassified negotiation, present only when an elective promise broke. */
  readonly messages: readonly { readonly tick: number; readonly from: PrincipalId; readonly text: string }[];
}

export interface UpcomingView {
  readonly venture: VentureId;
  readonly atStake: Minor;
  readonly parties: readonly PrincipalId[];
  readonly firstTimeTogether: boolean;
}

function handleOf(src: FrameSource, p: PrincipalId): Handle {
  return src.handles.get(p) ?? (p as unknown as Handle);
}

/**
 * How much authority a line represents, for ranking into the frame budget: BOTH of
 * §8.1 #2's LIMITS, because either one alone is a partial account of what a delegate
 * may cost its grantor. Summed with the checked helper, not `+`, so a pair that leaves
 * the safe range throws rather than silently ranking a huge grant as a small one.
 */
function authorityWeight(line: AuthorityLine): Minor {
  return addMinor(line.granted, line.grantedContingent);
}

/**
 * How close a claim is to falling. The claim-line sort's first key.
 *
 * Ordered by *what a viewer would regret not seeing*: a lapse that happened tonight, then a
 * claim one miss from lapsing, then one that is contestable right now, then ordinary arrears.
 * A `SUPPLIED` claim is last, which is right — it is the one with nothing about to happen to
 * it — and it is still drawn while there is room.
 */
function claimUrgency(line: ClaimLine): number {
  switch (line.state) {
    case 'LAPSED':
      return 5;
    case 'CONTESTED':
      return line.contestable ? 4 : 3;
    case 'STRAINED':
      return 2;
    case 'CEDED':
      return 1;
    case 'SUPPLIED':
      return 0;
  }
}

function money(n: Minor): string {
  const v = Math.abs(n);
  if (v >= 1_000_000) return `${String(Math.round(n / 100_000) / 10)}M`;
  if (v >= 1_000) return `${String(Math.round(n / 1_000))}K`;
  return String(n);
}

/**
 * Cast chips for one item, truncated to the label budget.
 *
 * Truncation is correct HERE and wrong in `observe` — the distinction matters. An
 * observation that drops an affordance hides an option the agent was entitled to
 * (PROP-O1 forbids it). A frame that names eight characters is simply unreadable: the
 * honest maximum is about seven, and hundreds of agents is fine while *naming*
 * hundreds is not. Dropping a label costs legibility nothing; keeping it costs
 * everything.
 */
function chipsFor(src: FrameSource, parties: readonly PrincipalId[]): readonly CastChip[] {
  return [...parties]
    .sort(compareIds)
    .slice(0, MAX_LABELS_PER_FRAME)
    .map((p) => {
      const badge = src.modelBadges?.get(p) ?? null;
      return {
        principal: p,
        handle: handleOf(src, p),
        line: '',
        modelBadge: badge,
      };
    });
}

function glyphFor(v: SettledView): VentureGlyph {
  const state = v.deferred
    ? ('DEFERRED' as const)
    : v.defaulted
      ? ('SNAPPED_BLACK' as const)
      : ('CLOSED_GOLD' as const);
  return {
    venture: v.venture,
    stage: v.stage as VentureGlyph['stage'],
    rolesFilled: v.rolesFilled,
    rolesTotal: v.rolesTotal,
    electiveBps: v.electiveBps,
    state,
  };
}

/**
 * One sentence a stranger reads in three seconds, plus the tension underneath it.
 *
 * Deliberately built from facts the frame already carries rather than authored: A12
 * says the sandbox authors the stories and we ship systems, never scripted narrative.
 * The template is presentation; every noun in it is a measured quantity.
 */
function headlineFor(src: FrameSource, v: SettledView): string {
  const payer = handleOf(src, v.creator);
  const other = v.parties.find((p) => p !== v.creator);
  const counterparty = other === undefined ? 'nobody' : handleOf(src, other);
  return `${payer}'s ${money(v.atStake)} was riding on ${counterparty}'s ${v.kind.toLowerCase()}.`;
}

/**
 * The docket's version, for a venture that has not resolved yet.
 *
 * Same discipline as {@link headlineFor}: a template whose every noun is a measured
 * quantity. The docket looks FORWARD, so it names what is at risk rather than what
 * happened — a viewer arriving cold needs the largest thing at stake tonight, which is
 * why §14.1 makes the docket the default view rather than the map.
 */
function headlineForUpcoming(src: FrameSource, u: UpcomingView): string {
  const named = [...u.parties].sort(compareIds);
  const first = named[0];
  const second = named[1];
  if (first === undefined) return `${money(u.atStake)} is riding on a promise.`;
  if (second === undefined) return `${handleOf(src, first)} has ${money(u.atStake)} riding on a promise.`;
  return `${handleOf(src, first)}'s ${money(u.atStake)} is riding on ${handleOf(src, second)}.`;
}

function consequenceFor(src: FrameSource, v: SettledView): string {
  const payer = handleOf(src, v.creator);
  if (v.deferred) return `${payer}'s ${v.kind.toLowerCase()} did not resolve. It carries to tomorrow.`;
  if (v.defaulted) return `${payer} walked away from ${money(v.atStake)} it had promised.`;
  return `${payer} paid ${money(v.atStake)} it could have kept.`;
}

/**
 * Build the frame.
 *
 * Ordering is the format, not a preference (§14.3): ascending by stakes, with the
 * largest say-do deltas held to the end. A broken promise is the largest delta there
 * is, so defaults sort last — which is Tribal Council's oldest trick and the reason
 * the rundown is a broadcast rather than a batch.
 */
export function renderFrame(src: FrameSource): ReckoningFrame {
  const broadcastOrder = (a: SettledView, b: SettledView): number => {
    // Defaults last regardless of size: the delta, not the amount, is the story.
    if (a.defaulted !== b.defaulted) return a.defaulted ? 1 : -1;
    if (a.atStake !== b.atStake) return a.atStake - b.atStake;
    // Ties broken by id so the running order is reproducible from the same outcome.
    return compareIds(a.venture, b.venture);
  };

  // ── SELECT THE CLIMAX FIRST, THEN FILL AROUND IT ──────────────────────────
  //
  // The cut used to be `sort(defaults last).slice(0, MAX)`, which selects by taking the
  // FIRST twelve of an order that deliberately puts the payoff at the END. On any
  // Reckoning with more than twelve settled ventures that silently dropped the defaults
  // — the show cutting its own climax and broadcasting only the setup, most reliably on
  // the busiest and most interesting nights.
  //
  // Selection and ordering are now separate concerns, which is the actual fix: choose
  // what must be shown, then order what was chosen. A default is never cut while a kept
  // promise is available to cut instead; if defaults alone overflow the budget, the
  // biggest ones win.
  const defaults = src.settled.filter((v) => v.defaulted);
  const kept = src.settled.filter((v) => !v.defaulted);
  const bigFirst = (a: SettledView, b: SettledView): number =>
    b.atStake - a.atStake || compareIds(a.venture, b.venture);

  // Every settled venture, in broadcast order. The GLYPHS use this rather than the cut:
  // the map shows the whole night's work even though the rundown narrates only part of it.
  const byStakesAscending = [...src.settled].sort(broadcastOrder);

  const climax = [...defaults].sort(bigFirst).slice(0, MAX_RUNDOWN_SEGMENTS);
  const setup = [...kept].sort(bigFirst).slice(0, MAX_RUNDOWN_SEGMENTS - climax.length);

  const ventureBeats = [...climax, ...setup]
    .sort(broadcastOrder)
    .map((v) => ({
      kind: 'SETTLEMENT' as const,
      subject: String(v.venture),
      defaulted: v.defaulted,
      atStake: v.atStake,
      venture: v.venture,
      cast: chipsFor(src, v.parties),
      publicLine: v.publicLine,
      sealVerdict: v.sealVerdict,
      // Seal content reaches VIEWERS only. Agents get the verdict and nothing else,
      // at any tier, on any delay (PROP-D2) — a fixed-lag reveal of private
      // pre-commitments is exactly what makes a collusive stalemate stable.
      // What it did, phrased as the deed; the headline above it says what was riding.
      deed: `${headlineFor(src, v)} ${consequenceFor(src, v)}`,
      glyph: glyphFor(v),
      consequence: consequenceFor(src, v),
      // THE RECEIPT REEL (§14). Present only where an elective promise broke; a reel
      // on a kept promise would be the show editorialising, which A12 forbids.
      receiptReel:
        v.defaulted && v.messages.length > 0
          ? v.messages.map((m) => ({ tick: m.tick, from: handleOf(src, m.from), text: m.text }))
          : null,
    }));

  // ── THE OTHER SYSTEMS GET BEATS, NOT JUST PANELS (§14.3) ──────────────────
  //
  // A lapsed claim is permanent territorial loss with a bond slashed. Under the ordering rule
  // — largest say-do delta last — that belongs at the END of the night beside the defaults,
  // and it was being shown in a table off to the side. The Levy's result and a raid that took
  // something are beats for the same reason: they are things that HAPPENED at a time, and a
  // running order is how a viewer follows a night.
  //
  // Built from the same lines the panels use, so a beat can never claim something the panel
  // contradicts — one source, two presentations.
  const lapseBeats = (src.claimLines ?? [])
    .filter((c) => c.state === 'LAPSED')
    .map((c) => ({
      kind: 'LAPSE' as const,
      subject: String(c.system),
      // A lapse is the largest delta the territorial system has, so it sorts with the defaults.
      defaulted: true,
      atStake: c.slashed,
      venture: null,
      cast: [] as readonly CastChip[],
      publicLine: null,
      sealVerdict: null,
      deed: `${String(c.system)} LAPSED — ${String(c.claimant)} missed the Charge ${String(c.arrears)} times and the bond was slashed`,
      glyph: null,
      consequence: `${String(c.slashed)} of posted bond taken; the system is open to any claimant`,
      receiptReel: null,
    }));

  const raidBeats = (src.raidLines ?? [])
    .filter((r) => r.state === 'PLUNDERED' || r.state === 'PAID' || r.state === 'REPULSED')
    .map((r) => ({
      kind: 'PLUNDER' as const,
      subject: String(r.stage),
      // A plunder took something and belongs late; a repulse is a win and belongs early.
      defaulted: r.state === 'PLUNDERED',
      atStake: r.lost > 0 ? r.lost : r.demand,
      venture: null,
      cast: [] as readonly CastChip[],
      publicLine: null,
      sealVerdict: null,
      deed:
        r.state === 'REPULSED'
          ? `${String(r.stage)} held — ${String(r.defenderForce)} stood against ${String(r.raiderForce)}`
          : `${String(r.stage)} — ${String(r.target)} ${r.state === 'PAID' ? 'paid' : 'lost'} ${String(r.lost > 0 ? r.lost : r.demand)}`,
      glyph: null,
      consequence:
        r.state === 'REPULSED'
          ? 'the stage is closed to raiders for a Reckoning'
          : `${String(r.lost)} taken, and A5 makes the loss permanent`,
      receiptReel: null,
    }));

  const rundown: RundownSegment[] = [...ventureBeats, ...lapseBeats, ...raidBeats]
    .sort(
      (a, b) =>
        (a.defaulted === b.defaulted ? 0 : a.defaulted ? 1 : -1) ||
        a.atStake - b.atStake ||
        compareIds(a.subject, b.subject),
    )
    .slice(0, MAX_RUNDOWN_SEGMENTS)
    .map((beat, i) => ({ ...beat, order: i + 1 }));

  // The docket is the DEFAULT view and it looks forward, not back: biggest stakes
  // first, because a viewer arriving cold needs the largest thing at risk tonight.
  const docket: DocketCard[] = [...src.tomorrow]
    .sort((a, b) => (b.atStake - a.atStake) || compareIds(a.venture, b.venture))
    .slice(0, MAX_DOCKET_CARDS)
    .map((u) => ({
      venture: u.venture,
      headline: headlineForUpcoming(src, u),
      tension: u.firstTimeTogether
        ? 'These two have never dealt with each other before.'
        : 'They have dealt before, and it held.',
      atStake: u.atStake,
      cast: chipsFor(src, u.parties),
    }));

  const frame: ReckoningFrame = {
    reckoningIndex: src.reckoning,
    tick: src.tick,
    stateHash: src.stateHash,
    meters: src.meters,
    docket,
    rundown,
    // Tribute lines come from the Levy layer, glyphs from the venture layer. Neither is
    // computed here: a drawn line nobody owes is a lie on the map, and this file has no
    // way to know what is owed.
    tributeLines: src.tributeLines ?? [],
    // Selection is arithmetic, not taste: the most authority first (the convergence a
    // viewer should see), ties broken by id for determinism, capped to the budget. A
    // line nobody granted is never drawn — these come from the grant layer.
    //
    // "The most authority" is BOTH limits summed, not `max_direct_loss` alone. A grant
    // written `max_direct_loss: 0, max_contingent_liability: 900000` authorises the
    // largest exposure on the map and used to sort dead last, so the twelve-line budget
    // cut the one line the audience most needed (A13, §8.1 #2).
    authorityLines: (src.authorityLines ?? [])
      .slice()
      .sort(
        (a, b) =>
          authorityWeight(b) - authorityWeight(a) ||
          compareIds(a.grantor, b.grantor) ||
          compareIds(a.delegate, b.delegate),
      )
      .slice(0, MAX_AUTHORITY_LINES),
    // Live raids first — a countdown is what a viewer looks at — then by the size of
    // the demand, then by id. Same argument as the authority lines: if the budget bites,
    // what survives is what the audience most needs, and the order is arithmetic.
    raidLines: (src.raidLines ?? [])
      .slice()
      .sort(
        (a, b) =>
          Number(b.state === 'DEMANDED') - Number(a.state === 'DEMANDED') ||
          b.demand - a.demand ||
          compareIds(a.raid, b.raid),
      )
      .slice(0, MAX_RAID_LINES),
    // Claims about to fall first, then the largest shortfall, then by id. Same argument as
    // the raid lines: if the budget bites, what survives is what the audience most needs,
    // and the order is arithmetic rather than taste. A discharged claim is a hairline and it
    // is the first thing dropped — but it is still *drawn* while there is room, because a
    // map that showed only failing claims would make the screen quietest on the night the
    // most upkeep was supplied.
    // Ordered by HOW MANY CAN SPEND IT first, then by size. The story a viewer should find is the
    // treasury with the most people able to empty it, which is the one where A6 is closest to
    // happening — not simply the richest org.
    // The topology, passed through unchanged and sorted so the file is diffable. Not truncated by
    // any budget: a partial map is a map with holes in it, which is worse than none — a client
    // would draw lanes to systems it cannot place.
    map: [...(src.map ?? [])].sort((a, b) => compareIds(a.id, b.id)),
    syndicateLines: (src.syndicateLines ?? [])
      .slice()
      .sort(
        (a, b) =>
          b.officeHolders - a.officeHolders ||
          b.treasuryMinor - a.treasuryMinor ||
          b.members - a.members ||
          compareIds(a.syndicate, b.syndicate),
      )
      .slice(0, MAX_FRAME_SYNDICATE_LINES),
    // Ordered by CROWDING first, because the story a viewer should find is the contested
    // seam, not the biggest total. A sort by `extracted` would rank the oldest WORKS top
    // forever and make the map a leaderboard of tenure.
    worksLines: (src.worksLines ?? [])
      .slice()
      .sort(
        (a, b) =>
          b.occupants - a.occupants ||
          b.yieldPerTick - a.yieldPerTick ||
          compareIds(a.system, b.system) ||
          compareIds(a.works, b.works),
      )
      .slice(0, MAX_FRAME_WORKS_LINES),
    claimLines: (src.claimLines ?? [])
      .slice()
      .sort(
        (a, b) =>
          claimUrgency(b) - claimUrgency(a) ||
          b.owed - a.owed ||
          compareIds(a.system, b.system),
      )
      .slice(0, MAX_FRAME_CLAIM_LINES),
    glyphs: byStakesAscending.map(glyphFor),
    ticker: src.ticker.filter((t) => t.length <= 140),
    nextDocket: docket,
  };

  // A13 as arithmetic. Throws rather than shipping an unreadable frame.
  assertFrameBudgets(frame);
  return frame;
}

/** An honest empty frame, for a Reckoning that settled nothing. */
export function emptyFrame(reckoning: number, tick: number, stateHash: string): ReckoningFrame {
  const frame: ReckoningFrame = {
    reckoningIndex: reckoning,
    tick,
    stateHash,
    meters: { levyShort: minor(0), onAPromise: minor(0), kept: 0, broken: 0 },
    docket: [],
    rundown: [],
    tributeLines: [],
    authorityLines: [],
    raidLines: [],
    claimLines: [],
    worksLines: [],
    syndicateLines: [],
    map: [],
    glyphs: [],
    ticker: [],
    nextDocket: [],
  };
  assertFrameBudgets(frame);
  return frame;
}
