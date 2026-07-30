/**
 * Live tick → {@link LiveFrame}. The motion between appointments.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **WHY THIS FILE EXISTS: THE NIGHTLY FRAME IS A POST-MORTEM.**
 *
 * `render.ts` renders a *settled* Reckoning and is published on `isSettlementTick` alone. At
 * `SPEEDS.prod` that is one frame per 24 hours, against a client that polls every 15 seconds. So a
 * viewer who tunes in at an arbitrary moment sees a still image of yesterday, and every field
 * designed to animate *within* a Reckoning had no frame to appear in at all: `ticksLeft` was 0 on
 * 117 of 117 raid rows, `DEMANDED` never occurred, `FORMING` never occurred, and the battle `gap` —
 * which `contract.ts` calls the most legible thing on the board — never once moved.
 *
 * §16's three-humans gate asks three people to watch one Reckoning and name a character they rooted
 * for. Nothing to watch between Reckonings is fatal to that, and it is not a bug in any one field.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ## The two rules this file is written against
 *
 * **1. It reads a projection and nothing else** — the same discipline `render.ts` keeps, and for the
 * same two reasons. A9's parity is structural because this function has no world handle and no
 * database handle; and `broadcast_speed` stays independent of `sim_speed` because the artifact is a
 * value, so a world generated at 30× replays at whatever pace a viewer needs.
 *
 * **2. Nothing on it is expensive.** This runs once per tick, so a whole-ledger read here is an
 * outage rather than a slow frame. That is not hypothetical: the `HAZARD` phase gained a subject that
 * read every stored lot, the step budget had no term for it, and `DET-9` halted the deployed world at
 * tick 7,128. So {@link LiveMeters} is counts and one sum the glyph pass already needed, and
 * `Meters.unrefined` — which sums every lot of every principal — is deliberately absent. The caller
 * pays for: three bounded books (raids ≤ `MAX_RAID_ROWS`, engagements ≤ `MAX_ENGAGEMENT_ROWS`,
 * campaigns ≤ `MAX_LIVE_CAMPAIGNS`), one pass over the venture book, one pass over `world.hands`
 * (≤ `MAX_PRINCIPALS × HANDS_PER_PRINCIPAL`), one pass over the grant journal (see
 * `frames/authority.ts` on the quadratic that removed), and the claim/tribute reads which are bounded
 * by systems and by principals respectively.
 *
 * ## The ordering rules, and why they are the ones already written down
 *
 * Every sort here is `render.ts`'s sort for the same line set, applied to a world that can finally
 * reach it. `raidLines` puts `DEMANDED` first — a comparator that had never once seen a `DEMANDED`
 * raid. `battleLines` puts a running battle first — a comparator that had never seen one running.
 * Those two comparators were written for this artifact before it existed; this is the artifact.
 */

import { inCommitmentWindow, inFreeze, isSettlementTick, reckoningIndex, ticksUntilReckoning } from '../core/time.js';
import { canonicalize, type CanonicalValue } from '../core/canonical.js';
import { minor, type Minor } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import type { FrontBand } from '../risk/lines.js';
import {
  MAX_AUTHORITY_LINES,
  MAX_FRAME_BATTLE_LINES,
  MAX_FRAME_CLAIM_LINES,
  MAX_FRAME_COMPACT_LINKS,
  MAX_FRAME_CONVOY_LINES,
  MAX_FRAME_FRONT_BANDS,
  MAX_RAID_LINES,
  assertLiveFrameBudgets,
  type AuthorityLine,
  type BattleLine,
  type ClaimLine,
  type CompactLink,
  type ConvoyLine,
  type LiveFrame,
  type LivePhase,
  type RaidLine,
  type SapLine,
  type VentureGlyph,
} from './contract.js';

/**
 * ★ One live venture, as the live frame needs it.
 *
 * `state` is the venture's own `FORMING` / `LIVE`, which is the whole point: `render.ts:glyphFor`
 * derives a glyph state from `defaulted`/`deferred` and can therefore only ever produce
 * `CLOSED_GOLD`, `SNAPPED_BLACK` or `DEFERRED`. Two of the glyph's five states were unreachable —
 * including `FORMING`, which `contract.ts` describes as *"an unfilled role is an empty socket that
 * pulses — that is what forming looks like"*. A socket that never pulses is not a signature.
 */
export interface LiveVentureView {
  readonly venture: VentureGlyph['venture'];
  readonly stage: VentureGlyph['stage'];
  readonly state: 'FORMING' | 'LIVE';
  readonly rolesFilled: number;
  readonly rolesTotal: number;
  readonly electiveBps: number;
  /** Value riding on the elective half of the roles that are filled. Summed into `onAPromise`. */
  readonly atStake: Minor;
}

/** Everything the live renderer is allowed to know. Deliberately smaller than `FrameSource`. */
export interface LiveSource {
  readonly tick: number;
  readonly stateHash: string;
  /** The last Reckoning that settled, or null before the first. Lets a client pair the two files. */
  readonly lastReckoning: number | null;
  readonly ventures: readonly LiveVentureView[];
  readonly raidLines?: readonly RaidLine[];
  readonly battleLines?: readonly BattleLine[];
  readonly convoyLines?: readonly ConvoyLine[];
  readonly compactLinks?: readonly CompactLink[];
  readonly authorityLines?: readonly AuthorityLine[];
  readonly claimLines?: readonly ClaimLine[];
  readonly saps?: readonly SapLine[];
  readonly frontBands?: readonly FrontBand[];
  readonly ticker?: readonly string[];
}

/**
 * The clock, as one word.
 *
 * Derived from `core/time.ts` on every branch rather than by arithmetic against
 * `COMMITMENT_WINDOW_TICKS`, so this and the tick loop can never disagree about where a window
 * starts — the same rule `opensCommitmentWindowNext` is written to.
 */
export function livePhase(tick: number): LivePhase {
  if (isSettlementTick(tick)) return 'SETTLING';
  if (inFreeze(tick)) return 'FREEZE';
  if (inCommitmentWindow(tick)) return 'COMMITMENT';
  return 'EARLY';
}

/**
 * ★ The glyph for a venture that has NOT resolved. The half `glyphFor` cannot express.
 *
 * `FORMING` exactly when a role is unfilled, which is what the socket means. Not derived from
 * `rolesFilled < rolesTotal` here but read off the venture's own `state`, because the state machine
 * is the one home of that fact (`venture/venture.ts:LIVE_STATES`) and a second derivation could
 * disagree with the engine about whether a compact is crewed.
 */
function liveGlyph(v: LiveVentureView): VentureGlyph {
  return {
    venture: v.venture,
    stage: v.stage,
    rolesFilled: v.rolesFilled,
    rolesTotal: v.rolesTotal,
    electiveBps: v.electiveBps,
    state: v.state,
  };
}

/** Build the live frame. Pure, total, and asserted before it can be written. */
export function renderLiveFrame(src: LiveSource): LiveFrame {
  const forming = src.ventures.filter((v) => v.state === 'FORMING');
  const live = src.ventures.filter((v) => v.state === 'LIVE');

  const raidLines = [...(src.raidLines ?? [])]
    // The comparator `render.ts` has always carried and no frame has ever exercised: live raids
    // first, because a countdown is the thing a viewer looks at.
    .sort(
      (a, b) =>
        Number(b.state === 'DEMANDED') - Number(a.state === 'DEMANDED') ||
        b.demand - a.demand ||
        compareIds(a.raid, b.raid),
    )
    .slice(0, MAX_RAID_LINES);

  const battleLines = [...(src.battleLines ?? [])]
    // Likewise: a battle still running beats one that ended, and among the ended ones the one that
    // destroyed the most. `fieldControl === null` is exactly "still running".
    .sort(
      (a, b) =>
        Number(a.fieldControl === null) - Number(b.fieldControl === null) ||
        b.wrecks.length - a.wrecks.length ||
        compareIds(a.engagement, b.engagement),
    )
    .slice(0, MAX_FRAME_BATTLE_LINES);

  const frame: LiveFrame = {
    tick: src.tick,
    reckoningIndex: reckoningIndex(src.tick),
    ticksUntilReckoning: ticksUntilReckoning(src.tick),
    phase: livePhase(src.tick),
    stateHash: src.stateHash,
    lastReckoning: src.lastReckoning,
    meters: {
      onAPromise: minor(src.ventures.reduce((n, v) => n + v.atStake, 0)),
      forming: forming.length,
      live: live.length,
      raidsLive: raidLines.filter((r) => r.state === 'DEMANDED').length,
      battlesLive: battleLines.filter((b) => b.fieldControl === null).length,
      convoys: (src.convoyLines ?? []).length,
    },
    raidLines,
    battleLines,
    // FORMING first, because the socket is the thing that pulses and the thing a filler is looking
    // for. Then by what is riding on it. `render.ts` sorts glyphs by broadcast order, which is a
    // *settled* night's running order and has no meaning for a venture that has not resolved.
    glyphs: [...src.ventures]
      .sort(
        (a, b) =>
          Number(b.state === 'FORMING') - Number(a.state === 'FORMING') ||
          b.atStake - a.atStake ||
          compareIds(a.venture, b.venture),
      )
      .map(liveGlyph),
    // Already selected and ordered by their own builders (`frames/motion.ts`, `frames/authority.ts`),
    // which own the significance rule for each — snaps first, landings first, drawn first. Re-sorting
    // here would be a second opinion about what matters, which is two homes for one rule.
    compactLinks: (src.compactLinks ?? []).slice(0, MAX_FRAME_COMPACT_LINKS),
    convoyLines: (src.convoyLines ?? []).slice(0, MAX_FRAME_CONVOY_LINES),
    authorityLines: (src.authorityLines ?? []).slice(0, MAX_AUTHORITY_LINES),
    claimLines: (src.claimLines ?? []).slice(0, MAX_FRAME_CLAIM_LINES),
    saps: src.saps ?? [],
    frontBands: (src.frontBands ?? []).slice(0, MAX_FRAME_FRONT_BANDS),
    ticker: (src.ticker ?? []).filter((t) => t.length <= 140),
  };

  assertLiveFrameBudgets(frame);
  return frame;
}

/**
 * The keys a live frame may be built from, each admitted by a clause already argued.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **A9 IS A THEOREM HERE RATHER THAN A REVIEW ITEM, AND THIS LIST IS HALF OF THE PROOF.**
 *
 * Every entry except `convoyLines` and `compactLinks` is a member of `PUBLIC_FACT_KEYS`, whose §11.2
 * argument is written out at length in `projection.ts` and was reached with an outside critic. So a
 * live frame does not need eighteen new arguments — it needs exactly two, plus the claim that
 * **publishing an already-`PUBLIC` fact at a different tick is not publishing a different fact.**
 *
 * That claim has one real exception and it is the reason this list is short: §11.2 has three tiers
 * whose clause is a *clock* — `PARTIES` declassifies at settlement, `SENSED` at the Reckoning
 * boundary, `SEALED` in the season replay — and for those, publishing earlier IS a disclosure. So
 * **no field of any of the three is on this frame**, which is enforced three ways: the rundown (the
 * only carrier of declassified `PARTIES` text, the seal verdict and the receipt reel) is absent
 * entirely; `assertLiveFrameBudgets` refuses those field names; and `test/frames/live.spec.ts`
 * asserts this set against `PUBLIC_FACT_KEYS` so a key added without an argument fails the build.
 * ══════════════════════════════════════════════════════════════════════════════
 */
export const LIVE_FACT_KEYS: readonly (keyof LiveSource)[] = Object.freeze([
  'tick',
  'stateHash',
  'lastReckoning',
  // The live ventures. `tomorrow` is the same read on `PUBLIC_FACT_KEYS` — the docket is built from
  // `ventures.live()` — so the tier question is answered: a forming venture's terms are what a
  // counterparty reads before it signs, and `venture.formed` is `PUBLIC`.
  'ventures',
  'raidLines',
  'battleLines',
  // ── ★ THE TWO NEW ONES. Arguments on their types in `contract.ts`. ────────
  //
  // `convoyLines` is a re-read of the `PUBLIC` `haul.departed` row and carries strictly fewer fields
  // than that row does — no good, no qty, no lot ids. `compactLinks` is `venture.formed` /
  // `role_filled` / `settled` (all `PUBLIC`) joined to two HOLDING systems, and a holding is the
  // clause `handles` and the whole of `swayLines` are already admitted on.
  'convoyLines',
  'compactLinks',
  'authorityLines',
  // ── ★ `tributeLines` IS DELIBERATELY ABSENT, AND IT IS THE ONE A9 REFUSED ──
  //
  // `tributeStateFor` derives `SOLID` from `carriageUnderway`, which reads `hand.destination` — a
  // HAND DISPOSITION, which §11.2 puts at `SENSED` by name and which `world/sway.ts` refuses as an
  // input for precisely this reason. No agent's `observe` answers it about any principal but itself.
  // The full argument, and the distinction from `raidLines`/`battleLines`, is on `LiveFrame`.
  'claimLines',
  'saps',
  'frontBands',
  'ticker',
]);

export class LiveProjectionError extends Error {}

/**
 * Prove the live projection is inert data carrying only admissible keys.
 *
 * `projection.ts:assertInertPublicFacts`' twin, and it exists for the same two failures. An
 * **unknown key** means somebody published a field without arguing it against §11.2. A
 * **canonicalisation failure** means the projection is still holding a handle to live state — a
 * getter, a bound method, a live book — which on an artifact written every tick would be a frame
 * whose content depends on what the world happens to contain when the renderer runs.
 */
export function assertInertLiveFacts(facts: LiveSource): void {
  const allowed = new Set<string>(LIVE_FACT_KEYS as readonly string[]);
  const extra = Object.keys(facts).filter((k) => !allowed.has(k));
  if (extra.length > 0) {
    throw new LiveProjectionError(
      `live frame projection carries ${extra.join(', ')}, which no §11.2 clause admits for a ` +
        'mid-Reckoning artifact. Add it to LIVE_FACT_KEYS with the tier that permits it — and check ' +
        'first that the tier is not one of the three that declassify on a clock.',
    );
  }
  try {
    canonicalize(facts as unknown as CanonicalValue);
  } catch (error: unknown) {
    throw new LiveProjectionError(
      'live frame projection is not inert data — it is still holding a handle to live state ' +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
  }
}
