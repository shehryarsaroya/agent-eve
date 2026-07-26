/**
 * The frame contract — the interface between the world and the show.
 *
 * TESTING.md §1.1 hazard 3: the rundown's 6–9 minutes is *human* time and must
 * not compress with the tick. The consequence is architectural, not cosmetic:
 * **the renderer consumes a settled Reckoning from the ledger, never the live
 * sim.** `sim_speed` and `broadcast_speed` are independent, which is the only
 * reason the whole watchability suite can run against worlds generated overnight
 * at 30×. So this file is a *read model*, and nothing here may be computed from
 * live mutable state.
 *
 * A9 holds by construction (SPEC §15.5): a frame is built from one
 * `public_facts(tick)` object and the renderer has **no database handle**. A
 * viewer therefore cannot see a live fact that a non-party agent's own `observe`
 * would not — which matters because agents read the public feed, so any viewer
 * privilege is immediately an agent exploit.
 *
 * The legibility budgets below are §17 parameters and are asserted, not
 * suggested. A constellation renders ~70 handles and a viewer reads none of
 * them; the honest maximum is about seven named entities per frame. Hundreds of
 * agents is fine. *Naming* hundreds is not.
 */

import type {
  Handle,
  HoldingId,
  PrincipalId,
  RaidState,
  SealVerdict,
  SystemId,
  VentureId,
} from '../core/types.js';
import type { Minor } from '../core/units.js';

/** §17: labels rendered per frame. The legible maximum. */
export const MAX_LABELS_PER_FRAME = 7;
/** §17: docket cards. The default view. */
export const MAX_DOCKET_CARDS = 7;
/** §17: rundown segments. A broadcast, not a batch. */
export const MAX_RUNDOWN_SEGMENTS = 12;
/** §17: authority lines drawn per frame. Convergence is the signature; a hairball is not. */
export const MAX_AUTHORITY_LINES = 12;
/** §17: raid lines drawn per frame. A countdown a viewer can follow, not a weather map. */
export const MAX_RAID_LINES = 6;
/** §14.3: seconds per segment. Human time — never scaled by TICK_SECONDS. */
export const SEGMENT_SECONDS = { min: 30, max: 45 } as const;

/**
 * The three meters (§14.2). v2.0's single "total value in the open" meter fell
 * identically whether a promise was kept or broken, conflated escrow with the
 * elective tail, and could be topped by self-dealing at zero risk.
 */
export interface Meters {
  /**
   * The headline, because it is the one number **no single agent can lower**,
   * and it *rises when everyone hides* — which is exactly when the screen needs
   * to look tense. Decomposable to whose tribute line is red.
   */
  readonly levyShort: Minor;
  /**
   * Value riding on nothing but someone's word. Inflatable only by genuinely
   * trusting someone: escrowed parts contribute zero by construction.
   */
  readonly onAPromise: Minor;
  /** The scoreboard. Moves only on the event the whole game is about. */
  readonly kept: number;
  readonly broken: number;
}

/** A named character on screen. Never more than MAX_LABELS_PER_FRAME of these. */
export interface CastChip {
  readonly principal: PrincipalId;
  readonly handle: Handle;
  /** One clause a stranger can read in three seconds. */
  readonly line: string;
  /** Model family, for the one-keystroke model-map recolour (§14.5). */
  readonly modelBadge: string | null;
}

/**
 * The Levy's pixel signature (§5.2) — the highest-leverage single edit in the
 * design. Every principal on the map every day, turtling made visible rather
 * than merely taxed, continuous off-peak motion from a source that cannot go
 * quiet, and a forming cartel visible as convergence on a handful of hands.
 */
export type TributeLineState = 'DASHED' | 'SOLID' | 'RED' | 'REVERSING';

export interface TributeLine {
  readonly principal: PrincipalId;
  readonly from: HoldingId;
  readonly to: SystemId;
  /** Thickness is proportional to the amount owed. */
  readonly owed: Minor;
  /** DASHED no hand assigned · SOLID hand en route · RED unpaid at freeze · REVERSING seizure. */
  readonly state: TributeLineState;
}

/**
 * The A6 pixel signature (SPEC §8, §14): standing authority as a directed line from a
 * grantor to its delegate. Thickness ∝ the authority handed over (max_direct_loss), and
 * the state shows how much of that worst case the delegate has actually drawn — "an
 * offline agent is exposed, and the audience can see by how much" (§8.1). Authority
 * converging on a handful of delegates is a forming power bloc, watchable before it acts —
 * the same "convergence on a few hands" the Levy's tribute lines render for tribute.
 */
// Its own vocabulary (SPEC §3, one word per concept): `IDLE` is a hand's physical state
// and `SPENT` is an intent's, so an authority line — a different concept — gets its own.
export type AuthorityLineState = 'UNUSED' | 'DRAWN' | 'EXHAUSTED' | 'REVOKED';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * **BOTH LIMITS RENDER, BECAUSE ONLY ONE OF THEM USED TO.**
 *
 * A grant carries two worst cases (§8.1 #2) and this line drew only the first. A
 * delegate that opened un-escrowable top-yield ventures in its grantor's name moved no
 * escrow at all, so `spent` stayed 0 and the line rendered **`UNUSED`** — an
 * innocent-looking pixel signature over an unbounded contingent liability, and the
 * A13 half of the A6 defect. Thickness came off `max_direct_loss` alone too, so a grant
 * that authorised nothing direct and everything contingent drew as a hairline and sorted
 * last into the twelve-line budget: the largest exposure on the map, cut first.
 *
 * Four fields rather than two, and the state reads both.
 * ══════════════════════════════════════════════════════════════════════════
 */
export interface AuthorityLine {
  readonly grantor: PrincipalId;
  readonly delegate: PrincipalId;
  /** Thickness ∝ the authority granted. This half is its max_direct_loss. */
  readonly granted: Minor;
  /** How much of the direct worst case the delegate has drawn. */
  readonly spent: Minor;
  /** The other half of the authority granted: its max_contingent_liability. */
  readonly grantedContingent: Minor;
  /**
   * How much of the contingent worst case the delegate has drawn — value the GRANTOR is
   * asked for at settlement and defaults on by staying silent. Visible exposure that
   * moves no coin until the Reckoning, which is exactly why it has to be on screen.
   */
  readonly spentContingent: Minor;
  /**
   * UNUSED nothing drawn on EITHER limit · DRAWN some headroom used · EXHAUSTED no
   * headroom left on either limit · REVOKED ending next tick.
   */
  readonly state: AuthorityLineState;
}

/**
 * Predation's pixel signature (A13, §9) — **THE RAID LINE**.
 *
 * A red arc thrown at a stage, anchored on the target's holding, thickness ∝ the demand,
 * with a countdown on it while the window runs. Four terminal looks, each readable in
 * three seconds without knowing the rules: `PAID` fades, `REPULSED` snaps outward and
 * leaves the stage marked held, `PLUNDERED` closes onto the holding and scars it, and
 * `MISSED` closes on nothing — the raid guessed wrong and hit ballast.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **NOTHING ON THIS LINE IS A `SENSED` QUANTITY**, and that is checked rather than
 * intended. `demand` is a seeded draw from a published band and is *not* a function of
 * what the target holds — see `predation/params.ts` on why an earlier fraction-of-stock
 * design was a §11.2 leak of exactly the "Charge fuel gauge" shape. `lost` is what the
 * ledger moved, which A5 makes public. `raiderForce`/`defenderForce` are counts of hands.
 * There is no field here a viewer could invert into a hold value.
 * ══════════════════════════════════════════════════════════════════════════
 */
export interface RaidLine {
  readonly raid: string;
  readonly stage: SystemId;
  readonly target: PrincipalId;
  /** Thickness ∝ the demand, in units of the good. Never currency, never a hold value. */
  readonly demand: number;
  readonly state: RaidState;
  /** What was actually taken. Zero until it resolves, and zero on a repulse. */
  readonly lost: number;
  readonly raiderForce: number;
  readonly defenderForce: number;
  /** The countdown on the arc. Zero once it has resolved. */
  readonly ticksLeft: number;
}

/**
 * The venture glyph (§14.5): a ring on its stage, hands as pips on the rim, an
 * unfilled role as an empty socket that pulses — that is what "forming" looks
 * like — the elective share as a hollow arc, and settlement closing it gold or
 * snapping it black.
 */
export interface VentureGlyph {
  readonly venture: VentureId;
  readonly stage: SystemId;
  readonly rolesFilled: number;
  readonly rolesTotal: number;
  /** Fraction of value that is elective, in bps. The hollow arc. */
  readonly electiveBps: number;
  readonly state: 'FORMING' | 'LIVE' | 'CLOSED_GOLD' | 'SNAPPED_BLACK' | 'DEFERRED';
}

/** A docket card. Biggest stakes first, each one a sentence a stranger reads. */
export interface DocketCard {
  readonly venture: VentureId;
  /** e.g. "Halcyon's 300,000 of ore is riding on Vex's escort." */
  readonly headline: string;
  /** e.g. "Vex has never escorted for Halcyon before." */
  readonly tension: string;
  readonly atStake: Minor;
  readonly cast: readonly CastChip[];
}

/**
 * One rundown segment. Exactly one venture per segment, ascending by stakes,
 * with the three largest say-do deltas held to the end (§14.3). Resolving a
 * hundred deals simultaneously is a page refresh; nobody can follow it.
 */
export interface RundownSegment {
  readonly order: number;
  readonly venture: VentureId;
  readonly cast: readonly CastChip[];
  /** What it said — a public claim, allowed to be a lie. */
  readonly publicLine: string | null;
  /**
   * What it sealed — **the flag only, never the content.**
   *
   * §11.2's ladder gives `SEALED` to *nobody* among agents, and to viewers only as
   * "the flag at the Reckoning"; the content arrives "in the season replay… when it is
   * archaeology rather than intelligence". This frame is the nightly artifact, so the
   * content has no business in it and the field that used to carry it is gone.
   *
   * It was not leaking, and that is the point: `sealContent` existed here and the client
   * printed it, and the only reason nothing escaped was that the runtime happened to pass
   * `null`. A tier boundary held up by a coincidence in a caller is not held up. Season
   * content belongs to a separate replay artifact that does not exist yet.
   */
  readonly sealVerdict: SealVerdict | null;
  /** What it did. Ground truth. */
  readonly deed: string;
  readonly glyph: VentureGlyph;
  /** Plain language, for a stranger who does not know the rules. */
  readonly consequence: string;
  /**
   * THE RECEIPT REEL (§14). Present only when an elective promise broke: every
   * message its author sent between handshake and deed, declassified at
   * settlement. Nothing is authored — this is a query over PARTIES messages.
   */
  readonly receiptReel: readonly ReceiptLine[] | null;
}

export interface ReceiptLine {
  readonly tick: number;
  readonly from: Handle;
  readonly text: string;
}

/**
 * A settled Reckoning, rendered. Immutable once written — a settled tick never
 * changes — which is why nginx may cache frame JSON as `immutable`.
 */
export interface ReckoningFrame {
  readonly reckoningIndex: number;
  readonly tick: number;
  readonly stateHash: string;
  readonly meters: Meters;
  readonly docket: readonly DocketCard[];
  readonly rundown: readonly RundownSegment[];
  readonly tributeLines: readonly TributeLine[];
  /** The A6 authority signature: who holds standing power over whom, and by how much. */
  readonly authorityLines: readonly AuthorityLine[];
  /** Predation's signature (§9, A14): what the world came for, and how it went. */
  readonly raidLines: readonly RaidLine[];
  readonly glyphs: readonly VentureGlyph[];
  /** One line, 140 chars, tick-stamped. The export surface. */
  readonly ticker: readonly string[];
  /** Tomorrow's docket, as the closing card. */
  readonly nextDocket: readonly DocketCard[];
}

export class FrameBudgetError extends Error {}

/**
 * Assert the legibility budgets. Called before a frame is written, so an
 * over-full frame is a build failure rather than a screensaver.
 *
 * This is A13 as an executable test rather than a review item: the scoring panel
 * found that mechanics bolted on to answer critics got their economics and their
 * prose but neither their pixels nor their arithmetic, and Legible scored lowest
 * of all six dimensions as a direct result.
 */
export function assertFrameBudgets(frame: ReckoningFrame): void {
  const problems: string[] = [];

  if (frame.docket.length > MAX_DOCKET_CARDS) {
    problems.push(`docket has ${frame.docket.length} cards, budget is ${MAX_DOCKET_CARDS}`);
  }
  if (frame.rundown.length > MAX_RUNDOWN_SEGMENTS) {
    problems.push(
      `rundown has ${frame.rundown.length} segments, budget is ${MAX_RUNDOWN_SEGMENTS} — a broadcast, not a batch`,
    );
  }

  // The label budget is per *frame*, so a card with seven chips and a segment
  // with seven more is still a violation when they render together.
  for (const [i, card] of frame.docket.entries()) {
    if (card.cast.length > MAX_LABELS_PER_FRAME) {
      problems.push(`docket card ${i} names ${card.cast.length} entities, budget is ${MAX_LABELS_PER_FRAME}`);
    }
  }
  for (const seg of frame.rundown) {
    if (seg.cast.length > MAX_LABELS_PER_FRAME) {
      problems.push(`rundown segment ${seg.order} names ${seg.cast.length} entities, budget is ${MAX_LABELS_PER_FRAME}`);
    }
  }

  // Ascending by stakes is the format, not a preference: the cold open is the
  // largest amount riding on an unsecured promise and the biggest betrayals are
  // held to the end.
  for (let i = 1; i < frame.rundown.length; i++) {
    const prev = frame.rundown[i - 1];
    const cur = frame.rundown[i];
    if (prev !== undefined && cur !== undefined && cur.order <= prev.order) {
      problems.push(`rundown segment order is not strictly ascending at index ${i}`);
    }
  }

  // Seal CONTENT must never appear in a nightly frame at all (§11.2: viewers get the
  // flag on the night, the content in the season replay). The field is gone from the
  // type, so this checks the shape rather than the value — a future edit that puts it
  // back, or a hand-built frame carrying it, fails here instead of on screen.
  for (const seg of frame.rundown) {
    if (Object.prototype.hasOwnProperty.call(seg, 'sealContent')) {
      problems.push(
        `segment ${seg.order} carries seal content; §11.2 releases seal content in the ` +
          'season replay, never in a nightly frame',
      );
    }
  }

  // A receipt reel only exists where a promise broke. A reel on a kept promise
  // would be the show editorialising, which A12 forbids.
  for (const seg of frame.rundown) {
    if (seg.receiptReel !== null && seg.receiptReel.length === 0) {
      problems.push(`segment ${seg.order} has an empty receipt reel; use null when there is none`);
    }
  }

  if (frame.ticker.some((t) => t.length > 140)) {
    problems.push('a ticker line exceeds 140 characters');
  }

  if (frame.authorityLines.length > MAX_AUTHORITY_LINES) {
    problems.push(
      `${frame.authorityLines.length} authority lines, budget is ${MAX_AUTHORITY_LINES} — convergence on a few hands is the signature, a hairball is not`,
    );
  }

  if (frame.raidLines.length > MAX_RAID_LINES) {
    problems.push(
      `${frame.raidLines.length} raid lines, budget is ${MAX_RAID_LINES} — a countdown a viewer can follow, not a weather map`,
    );
  }
  for (const line of frame.raidLines) {
    // A repulse that still took goods is the arithmetic contradicting the pixel, and the
    // pixel is what a stranger believes. PRD-6 halts the tick on it; this refuses to
    // draw it, because a frame is written from a settled outcome and a settled outcome
    // that says two things is worse on screen than off.
    if (line.state === 'REPULSED' && line.lost > 0) {
      problems.push(`raid ${line.raid} renders REPULSED and carries a loss of ${line.lost}`);
    }
    if (line.lost < 0 || line.demand < 0) {
      problems.push(`raid ${line.raid} renders a negative quantity`);
    }
  }

  if (problems.length > 0) {
    throw new FrameBudgetError(
      `frame for Reckoning ${frame.reckoningIndex} violates the §17 legibility budgets:\n  - ${problems.join('\n  - ')}`,
    );
  }
}
