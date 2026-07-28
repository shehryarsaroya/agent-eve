import type { HallOfFameRow, PlaceName } from './memory.js';
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

import type { Handle, PrincipalId, VentureId,
  Standing,
} from '../core/types.js';
import { addMinor, minor, qty, type Minor, type Qty } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import {
  MAX_AUTHORITY_LINES,
  MAX_DOCKET_CARDS,
  MAX_RAID_LINES,
  MAX_FRAME_BATTLE_LINES,
  MAX_LABELS_PER_FRAME,
  MAX_RUNDOWN_SEGMENTS,
  assertFrameBudgets,
  type AuthorityLine,
  type CastChip,
  type DocketCard,
  type RaidLine,
  type BattleLine,
  MAX_FRAME_CLAIM_LINES,
  type ClaimLine,
  type SapLine,
  MAX_FRAME_WORKS_LINES,
  MAX_FRAME_MARKET_LINES,
  MAX_FRAME_SYNDICATE_LINES,
  type MapSystem,
  type MarketLine,
  type WorksLine,
  type SyndicateLine,
  type ReckoningFrame,
  type RundownSegment,
  type TributeLine,
  type VentureGlyph,
  type BeatKind,
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
    /** Raw yield nobody has converted. Optional so older fixtures stay valid; defaults to 0. */
    readonly unrefined?: Qty;
  };
  /** Handle per principal, for labels. A frame never shows a raw id. */
  readonly handles: ReadonlyMap<PrincipalId, Handle>;
  readonly modelBadges?: ReadonlyMap<PrincipalId, string>;
  /**
   * The public standing vectors, for the one clause under each name.
   *
   * Absent means "no row", not "a clean record" — the same distinction `standingOf` makes in the
   * observation port, and for the same reason: a fabricated all-zero standing reads as a clean
   * record, which is a claim about a real agent that nothing supports.
   */
  readonly standings?: ReadonlyMap<PrincipalId, Standing>;
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
   * Combat's battle lines (§9A, A13), supplied by the combat layer.
   *
   * Optional and passed in for the reason every other line set is, with one addition specific to
   * this one: a renderer that computed its own bar heights would be inventing damage. `ehpBps` is
   * the only field on this frame that says how badly a named principal's asset is hurt, and a
   * half-empty bar over a fleet that took no fire is a lie a stranger has no second source for.
   */
  readonly battleLines?: readonly BattleLine[];
  /**
   * Sovereignty's claim lines (§6.3, A13), supplied by the sovereignty layer.
   *
   * Optional and passed in for the reason every other line set is: a renderer that computed
   * its own would be inventing an obligation, and a tint reading `NEXT MISS LAPSES` over a
   * claim nobody is short on is a lie about a real agent's territory that a stranger has no
   * second source for. This file cannot know what is owed and must not guess.
   */
  readonly claimLines?: readonly ClaimLine[];
  /**
   * ★ THE SAPs (§16.6, A13), supplied by the campaign layer.
   *
   * Passed in for the reason every other line set is: a renderer that computed its own notches would
   * be inventing a war's score, and a band drawn at the wall over a campaign that has not taken
   * anything is a claim about a real agent's territory that a stranger has no second source for.
   * This file cannot know how many breaches landed and must not guess.
   */
  readonly saps?: readonly SapLine[];
  readonly worksLines?: readonly WorksLine[];
  /**
   * ★ The market's prints (§10, A13), supplied by the market layer.
   *
   * Optional and passed in for the reason every other line set is, and the reason bites hardest
   * here: a renderer that computed its own prices would be inventing an economy. `premiumBps` is
   * the field a viewer reads as "this good is dear here, haul it in" — and a gap drawn between
   * two places that traded at the same price is a lane that does not exist. This file cannot know
   * what anything sold for and must not guess.
   */
  readonly marketLines?: readonly MarketLine[];
  /** §16 world memory. Optional so an `emptyFrame` and older fixtures stay valid. */
  readonly places?: readonly PlaceName[];
  readonly hallOfFame?: readonly HallOfFameRow[];
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
  /** NEVER · HELD · BROKEN. A boolean here printed "and it held" about defaults (A5′). */
  readonly priorDealings: 'NEVER' | 'HELD' | 'BROKEN';
  /**
   * The principal whose money is riding on this, when a **delegate** committed it rather than the
   * principal itself. Null on an ordinary venture.
   *
   * Optional so `emptyFrame` and the existing fixtures stay valid, and so a caller that does not know
   * says nothing rather than asserting "this was signed by its creator" — which for a delegated
   * venture would be false, and A5′ is specifically about the record being wrong.
   */
  readonly boundGrantor?: PrincipalId | null;
  /** The delegate that bound it, when one did. See {@link boundGrantor}. */
  readonly boundBy?: PrincipalId | null;
  /**
   * The proportion of this venture that is elective, in bps — what the creator OFFERED.
   *
   * Optional and defaulted to 0 by the renderer rather than computed: a docket card that invented an
   * arc would be drawing a proportion nobody agreed to, the same reason tribute and authority lines
   * are passed in. Zero draws no arc, which is honest for a caller that does not know.
   */
  readonly electiveBps?: number;
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
/**
 * The one clause under a name — §14.1's answer to *"who am I watching"*.
 *
 * This was hardcoded `''`, so every chip rendered as a bare handle and a stranger had no basis on
 * which to root for anyone. A spectacle critic called it the fastest high-value fix available and it
 * is: the vectors were already public (`SPEC` §11.2), already computed, and already carried past this
 * function.
 *
 * Built from the vectors and never a score (§3): the numbers are stated, and what they mean is left
 * to the viewer. `defaults` leads when there are any, because a broken promise is the most
 * interesting true thing about a principal — and `contradicted_seals` is named separately, because
 * saying one thing and doing another is a different failure from not paying.
 *
 * Absent row → *"day one"* rather than a row of zeros. A principal with no history has honoured
 * nothing and broken nothing, and the honest way to say that is that it is new.
 */
function characterLine(src: FrameSource, principal: PrincipalId): string {
  const row = src.standings?.get(principal);
  if (row === undefined) return 'day one';
  const parts: string[] = [];
  if (row.defaults > 0) {
    parts.push(row.defaults === 1 ? 'defaulted once' : `defaulted ${String(row.defaults)} times`);
  }
  if (row.electiveHonoured > 0) {
    parts.push(
      row.electiveHonoured === 1
        ? 'kept 1 elective promise'
        : `kept ${String(row.electiveHonoured)} elective promises`,
    );
  }
  if (row.contradictedSeals > 0) {
    parts.push(
      row.contradictedSeals === 1 ? 'contradicted a seal' : `contradicted ${String(row.contradictedSeals)} seals`,
    );
  }
  if (row.distinctCounterparties > 0) {
    parts.push(`${String(row.distinctCounterparties)} counterparties`);
  }
  // Nothing to say is itself the story: enrolled, and has risked nothing yet.
  if (parts.length === 0) return 'nothing at risk yet';
  // Capped at three, because §14.1 asks for a clause a stranger reads in three seconds.
  return parts.slice(0, 3).join(' \u00b7 ');
}

function chipsFor(src: FrameSource, parties: readonly PrincipalId[]): readonly CastChip[] {
  return [...parties]
    .sort(compareIds)
    .slice(0, MAX_LABELS_PER_FRAME)
    .map((p) => {
      const badge = src.modelBadges?.get(p) ?? null;
      return {
        principal: p,
        handle: handleOf(src, p),
        line: characterLine(src, p),
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

/**
 * The clause under a docket headline — **and a delegated binding outranks every other one.**
 *
 * Three prior-dealings states, because two of them used to share one sentence, and `BROKEN` is the
 * better card anyway: a pair with a default between them is the most watchable row on a docket.
 *
 * But a venture a **delegate** committed in someone else's name beats all three, because it is the one
 * card where the party with the money at risk did not agree to *this deal* at all — it agreed to a set
 * of LIMITS, and this is what came out of them. That is A6 in one sentence, and it is the sentence
 * §14.1 wants a cold viewer to read first.
 */
function tensionFor(src: FrameSource, u: UpcomingView): string {
  const delegate = u.boundBy ?? null;
  const grantor = u.boundGrantor ?? null;
  if (delegate !== null && grantor !== null) {
    return (
      `${handleOf(src, delegate)} committed ${handleOf(src, grantor)} to this under a grant. ` +
      `${handleOf(src, grantor)} never signed it.`
    );
  }
  if (u.priorDealings === 'NEVER') return 'These two have never dealt with each other before.';
  if (u.priorDealings === 'BROKEN') return 'They have dealt before, and a promise between them was broken.';
  return 'They have dealt before, and it held.';
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
    .map((r) => {
      // ── THE RAIDER'S NAME, AND `?? null` RATHER THAN TRUSTING THE FIELD ────
      //
      // A world raid is weather and a demand is somebody's decision (§9), and A13 asks for a
      // *named* pixel signature — so the beat says who, when there is a who. Coerced because a
      // frame source crosses a boundary: an absent initiator printed into a deed would read
      // "undefined took it" on a screen a stranger is using to decide who to root for.
      const by = r.initiator ?? null;
      return {
      kind: 'PLUNDER' as const,
      subject: String(r.stage),
      // A plunder took something and belongs late; a repulse is a win and belongs early.
      defaulted: r.state === 'PLUNDERED',
      atStake: r.lost > 0 ? r.lost : r.demand,
      venture: null,
      cast: [] as readonly CastChip[],
      publicLine: null,
      sealVerdict: null,
      // "forfeited", never "lost". `lost` is what the TARGET does in the plundered branch, and
      // a repulse deed carrying the word made the rundown's own ordering test unable to tell a
      // win from a loss by reading its text — which is what a viewer does too.
      deed:
        r.state === 'REPULSED'
          ? `${String(r.stage)} held — ${String(r.defenderForce)} stood against ${String(r.raiderForce)}` +
            (by === null ? '' : `, and ${String(by)} forfeited the stake it opened with`)
          : `${String(r.stage)} — ${by === null ? '' : String(by) + ' took it: '}` +
            `${String(r.target)} ${r.state === 'PAID' ? 'paid' : 'lost'} ${String(r.lost > 0 ? r.lost : r.demand)}`,
      glyph: null,
      // ── THE CONSEQUENCE LINE HAD TO LEARN THE DIFFERENCE ─────────────────────
      //
      // "the stage is closed to raiders for a Reckoning" is TRUE OF A WORLD RAID AND FALSE OF A
      // DEMAND: `grantWorldProtections` writes the stage hold only for the ownerless kind,
      // because an agent that could mint world-raid immunity for a friend by losing on purpose
      // would have found the Coase-collapse running backwards. A frame that claimed the peace
      // anyway would be the pixel contradicting the arithmetic, and the pixel is what a stranger
      // believes — the same defect `assertFrameBudgets` refuses a REPULSED-with-a-loss line over.
      consequence:
        r.state === 'REPULSED'
          ? by === null
            ? 'the stage is closed to raiders for a Reckoning'
            : 'the defender keeps everything and takes the raider’s stake; the stage stays open'
          : `${String(r.lost)} taken, and A5 makes the loss permanent`,
      receiptReel: null,
      };
    });

  // ── BEAT CLASS, BECAUSE `atStake` MIXES CURRENCY WITH UNITS OF A GOOD ─────
  //
  // The old comparator was `defaulted` (false first) then `atStake` ascending, and it summed
  // three different quantities on one numeric axis:
  //
  //     settlement  atStake = electiveDue        MINOR      (currency)
  //     lapse       atStake = slashed            MINOR      (currency)
  //     plunder     atStake = lost || demand     QTY        (units of a good)
  //
  // `contract.ts` says so about the last one in as many words: *"in units of the good. Never
  // currency, never a hold value."* With `RAID_DEMAND_QTY` topping out at 6,000 and
  // `RAID_TAKE_MULTIPLE` of 2, a plunder of 7,000 ORE outranked a default of 6,000 MINOR every
  // time — and 6,000 minor is the size of a typical elective half, so it was not an edge case.
  //
  // Measured on the live world: the night's one broken promise sat at beat 7 of 12 and three
  // plunders followed it. §14.3 says *"largest say-do deltas held to the end, because a broken
  // promise is the largest delta there is"* — the show was not choosing to end on ore, an integer
  // in one unit was beating an integer in another.
  //
  // Also `defaulted` was doing duty as "big delta" for three unrelated things: lapses set it
  // unconditionally and plunders set it on `PLUNDERED`. A plunder has NO say-do gap at all — its
  // `publicLine`, `sealVerdict` and `cast` are null and empty by construction — so it must never
  // be able to outrank one.
  //
  // A beat CLASS fixes both: rank across classes, magnitude only WITHIN a class, so two different
  // units are never compared.
  const beatRank = (b: { readonly kind: BeatKind; readonly defaulted: boolean }): number =>
    b.kind === 'SETTLEMENT' && b.defaulted
      ? 3 // a broken elective promise — the say-do delta itself
      : b.kind === 'LAPSE'
        ? 2 // permanent territorial loss with a bond slashed
        : b.kind === 'PLUNDER' && b.defaulted
          ? 1 // goods taken: a real loss, but nobody said anything they then didn't do
          : 0; // a promise kept, a raid repulsed

  const allBeats = [...ventureBeats, ...lapseBeats, ...raidBeats];

  // SELECT, then ORDER — the same separation the venture-level cut above already makes, applied
  // to the combined set. Sorting ascending and slicing the first N would cut the highest-ranked
  // beats, which is exactly the "show cutting its own climax" failure documented above, one level
  // up and reintroduced by the lapse and raid beats joining the list.
  const chosen = [...allBeats]
    .sort(
      (a, b) =>
        beatRank(b) - beatRank(a) || b.atStake - a.atStake || compareIds(a.subject, b.subject),
    )
    .slice(0, MAX_RUNDOWN_SEGMENTS);

  const rundown: RundownSegment[] = chosen
    .sort(
      (a, b) => beatRank(a) - beatRank(b) || a.atStake - b.atStake || compareIds(a.subject, b.subject),
    )
    .map((beat, i) => ({ ...beat, order: i + 1 }));

  // The docket is the DEFAULT view and it looks forward, not back: biggest stakes
  // first, because a viewer arriving cold needs the largest thing at risk tonight.
  const docket: DocketCard[] = [...src.tomorrow]
    .sort((a, b) => (b.atStake - a.atStake) || compareIds(a.venture, b.venture))
    .slice(0, MAX_DOCKET_CARDS)
    .map((u) => ({
      venture: u.venture,
      headline: headlineForUpcoming(src, u),
      tension: tensionFor(src, u),
      atStake: u.atStake,
      electiveBps: u.electiveBps ?? 0,
      cast: chipsFor(src, u.parties),
    }));

  const frame: ReckoningFrame = {
    reckoningIndex: src.reckoning,
    tick: src.tick,
    stateHash: src.stateHash,
    meters: { ...src.meters, unrefined: src.meters.unrefined ?? qty(0) },
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
    // Live battles first, then the bloodiest, then by id. Same argument as the raid lines, with the
    // tiebreak chosen for what a viewer came for: a battle still running beats one that ended, and
    // among those that ended the one that destroyed the most is the one worth the screen.
    battleLines: (src.battleLines ?? [])
      .slice()
      .sort(
        (a, b) =>
          Number(a.fieldControl === null) - Number(b.fieldControl === null) ||
          b.wrecks.length - a.wrecks.length ||
          compareIds(a.engagement, b.engagement),
      )
      .slice(0, MAX_FRAME_BATTLE_LINES),
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
    // Read-only projections: passed through in the order the source computed them, which is already
    // canonical (system order / principal order). No re-sorting here — a second ordering rule would be
    // a second home for it.
    // The public read. Sorted by principal so the directory is stable between frames rather than
    // reordering on Map iteration — a viewer diffing two frames should see records change, not rows move.
    standings: [...(src.standings?.entries() ?? [])]
      .sort((a, b) => compareIds(a[0], b[0]))
      .map(([principal, row]) => ({
        principal,
        handle: String(src.handles.get(principal) ?? principal),
        electiveHonoured: row.electiveHonoured,
        electiveHonouredValue: row.electiveHonouredValue,
        defaults: row.defaults,
        contradictedSeals: row.contradictedSeals,
        distinctCounterparties: row.distinctCounterparties,
        lastDefaultTick: row.lastDefaultTick,
      })),
    places: src.places ?? [],
    hallOfFame: src.hallOfFame ?? [],
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
    // ── SORTED BY THE GAP, BECAUSE THE GAP IS THE STORY ──────────────────────
    //
    // Widest premium first, in absolute terms: a good 8% dear at one place and 8% cheap at
    // another are the two ends of the same haul, and both belong on screen ahead of a market
    // that agrees with everyone. Overflow therefore drops the places with nothing to say.
    // (The market layer already ranks this way; re-stated here because the frame's budget is
    // the renderer's to enforce, and a caller that supplied an unsorted list must still get a
    // legible frame.)
    marketLines: (src.marketLines ?? [])
      .slice()
      .sort(
        (a, b) =>
          Math.abs(b.premiumBps) - Math.abs(a.premiumBps) ||
          b.volume - a.volume ||
          compareIds(a.venue, b.venue) ||
          compareIds(a.good, b.good),
      )
      .slice(0, MAX_FRAME_MARKET_LINES),
    // Already selected and ordered by `sapLinesFor` (significance first, then the cap), so this is a
    // pass-through rather than a second sort. Two orderings of one line set is scar #5 with a war in
    // it — and the module that owns the score is the one that knows which of two 1-1 campaigns is
    // closer to deciding something.
    saps: src.saps ?? [],
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
    meters: { levyShort: minor(0), onAPromise: minor(0), kept: 0, broken: 0, unrefined: qty(0) },
    docket: [],
    rundown: [],
    tributeLines: [],
    authorityLines: [],
    raidLines: [],
    battleLines: [],
    claimLines: [],
    saps: [],
    worksLines: [],
    // Present and empty, not absent. To a client the two are the same, and "nothing has traded
    // yet" is a fact this artifact has to be able to state.
    marketLines: [],
    standings: [],
    places: [],
    hallOfFame: [],
    syndicateLines: [],
    map: [],
    glyphs: [],
    ticker: [],
    nextDocket: [],
  };
  assertFrameBudgets(frame);
  return frame;
}
