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
import { minor, type Minor } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import {
  MAX_DOCKET_CARDS,
  MAX_LABELS_PER_FRAME,
  MAX_RUNDOWN_SEGMENTS,
  assertFrameBudgets,
  type CastChip,
  type DocketCard,
  type ReckoningFrame,
  type RundownSegment,
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
  readonly sealContent: string | null;
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
  const byStakesAscending = [...src.settled].sort((a, b) => {
    // Defaults last regardless of size: the delta, not the amount, is the story.
    if (a.defaulted !== b.defaulted) return a.defaulted ? 1 : -1;
    if (a.atStake !== b.atStake) return a.atStake - b.atStake;
    // Ties broken by id so the running order is reproducible from the same outcome.
    return compareIds(a.venture, b.venture);
  });

  const rundown: RundownSegment[] = byStakesAscending
    .slice(0, MAX_RUNDOWN_SEGMENTS)
    .map((v, i) => ({
      order: i + 1,
      venture: v.venture,
      cast: chipsFor(src, v.parties),
      publicLine: v.publicLine,
      sealVerdict: v.sealVerdict,
      // Seal content reaches VIEWERS only. Agents get the verdict and nothing else,
      // at any tier, on any delay (PROP-D2) — a fixed-lag reveal of private
      // pre-commitments is exactly what makes a collusive stalemate stable.
      sealContent: v.sealContent,
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
    // Tribute lines and glyphs are supplied by the Levy and venture layers; empty
    // until the Levy is built rather than faked, because a drawn line nobody owes is
    // a lie on the map.
    tributeLines: [],
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
    glyphs: [],
    ticker: [],
    nextDocket: [],
  };
  assertFrameBudgets(frame);
  return frame;
}
