/**
 * A13 — the three pixel signatures, as rows a renderer can draw without asking a question.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > *"No feature ships without a named pixel signature… If you cannot name the signature, the feature
 * > is not ready."* — A13
 *
 * The names are compounds of words the canon already holds — **FRONT · CONE · SWATH · COVER** — so
 * nothing enters `src/` through the renderer that the vocabulary table has never heard of. That
 * mattered five times already: *"`CLAIM`, `ANCHOR`, `CHARGE`, `RENT` and `FUEL` were live in `src/`
 * before they were canon"*, and `claimLines` — a frame field — was one of the doors they came through.
 *
 * ## 1. THE FRONT BAND
 *
 * A swept band across the map. **Before landfall it is the CONE**: the systems the front may strike,
 * tinted by odds, widening and then narrowing as the reckonings pass. **At landfall it becomes the
 * SWATH**: the systems it did strike, tinted by INTENSITY, with the value it took written on it.
 *
 * One row per system, so the band is a set of tinted cells rather than a polygon — the same choice
 * `MapSystem` makes for the map itself, and for the same stated reason: *"position is presentation
 * and x/y on a system would put presentation inside `state_hash`, where a layout tweak becomes a
 * replay divergence."*
 *
 * ## 2. THE COVER ARC
 *
 * An arc over a covered holding, **filled for the escrowed half and hollow for the elective half**.
 *
 * Deliberately the same grammar as A13's own venture signature — *"a venture is a ring whose hollow
 * arc is the part riding on someone's word"* — because it is the same axiom (A7) over a different
 * subject. A reader who has learned the ring reads the arc for free, and that is worth more than a
 * novel shape: §17 budgets **seven labels a frame** and a viewer who has to learn a new idiom per
 * mechanic runs out of attention long before the renderer runs out of labels.
 *
 * The arc's *fill fraction* is `escrowRatioBps`, which §7.5 requires be *"published on the venture
 * card"* — so the picture and the published number are one quantity, not two that can disagree.
 *
 * ## 3. THE COVER CHAIN
 *
 * A link per cession, drawn payer to payer. Every link carries a `state`, and the states are the
 * story: `INTACT` while the promise holds, `PAID` once it is kept, and **`SNAPPED` on a default — at
 * which point every link *inward* goes `GREYED`.**
 *
 * ⚑ **`INTACT` and not `STANDING`, and the vocabulary guard is what made the call.** The first draft
 * used `STANDING`, and `test/core/vocabulary-repo.test.ts` refused it in one line:
 * *"src/risk/lines.ts ChainLinkState = 'STANDING'"*. §3 gives STANDING to *"the public factual
 * vectors"*, so a link drawn `STANDING` next to a principal whose STANDING is a different thing
 * entirely is the collision that whole table exists to prevent — arriving through a renderer, which
 * is how `claimLines` got `CLAIM` into `src/` before it was canon. `INTACT` is already
 * `HoldingState`'s word for *"not destroyed"*, which is the same adjective about a different subject,
 * and the guard's `SHARED_MEMBERS` table records the pairing with that argument.
 *
 * That greying is the contagion, and it is why this is a chain and not three unrelated links: a
 * viewer can see how far the failure travelled and which house is next. A13 already gives the verb —
 * *"a broken compact snaps that link and scars both parties"* — and this applies it to a layer of
 * promises rather than to a pair, which is `§16.12` #4's *"one failure can propagate politically and
 * financially"* as a picture.
 *
 * **Every row here is inert data.** `frames/projection.ts:assertInertPublicFacts` refuses a
 * projection *"still holding a handle to live state"*, so these builders copy scalars out of the book
 * and never hand a record over.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { GoodId, PrincipalId, SystemId } from '../core/types.js';
import { BPS_ONE, type Bps, type Minor, type Qty } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import type { RiskBook } from './book.js';
import { escrowRatioBps, isLiveCover, type CoverId, type CoverRecord } from './cover.js';
import { coneAt, stateAt, type FrontState } from './front.js';
import { FRONT_COVER_FREEZE_TICKS } from './params.js';

/** §17's seven-labels rule, per line set. A band wider than this is a weather map, not a story. */
export const MAX_FRONT_BANDS = 12;
export const MAX_COVER_ARCS = 8;
export const MAX_COVER_CHAIN_LINKS = 6;

// ── 1. THE FRONT BAND ───────────────────────────────────────────────────────

export interface FrontBand {
  readonly front: string;
  readonly state: FrontState;
  /** The eye. The one label a viewer needs if only one fits. */
  readonly eye: SystemId;
  readonly system: SystemId;
  /**
   * Odds while the front is a CONE; INTENSITY once it is a SWATH.
   *
   * **One field and not two**, because a cell is only ever one of the two things and a renderer with
   * two nullable fields has to decide which to trust — which is where a picture starts disagreeing
   * with the record. `state` says which meaning this is.
   */
  readonly tintBps: Bps;
  /** Ticks until it lands. Negative once it has. A countdown a viewer can follow. */
  readonly ticksToLandfall: number;
  /** Value the front took at this system, at the pinned marks. Zero before landfall. */
  readonly took: Minor;
  /** Goods it took here. Zero before landfall. */
  readonly tookQty: Qty;
  /** ≤140 chars, so it can be a ticker line (§11.1). */
  readonly legend: string;
}

export function frontBands(
  book: RiskBook,
  tick: number,
  tookBySystem: ReadonlyMap<SystemId, { readonly value: Minor; readonly qty: Qty }>,
  limit: number = MAX_FRONT_BANDS,
): readonly FrontBand[] {
  const out: FrontBand[] = [];
  for (const front of book.liveFronts(tick)) {
    const state = stateAt(front, tick, FRONT_COVER_FREEZE_TICKS);
    const cells =
      state === 'STRUCK' || state === 'PASSED'
        ? front.swath.map((c) => ({ system: c.system, tintBps: c.intensityBps }))
        : coneAt(front, tick).map((c) => ({ system: c.system, tintBps: c.oddsBps }));
    for (const cell of [...cells].sort((a, b) => b.tintBps - a.tintBps || compareIds(a.system, b.system))) {
      const took = tookBySystem.get(cell.system);
      out.push({
        front: front.id,
        state,
        eye: front.eye,
        system: cell.system,
        tintBps: cell.tintBps,
        ticksToLandfall: front.landfallTick - tick,
        took: took?.value ?? (0 as Minor),
        tookQty: took?.qty ?? (0 as Qty),
        legend: bandLegend(state, cell.system, cell.tintBps, front.landfallTick - tick).slice(0, 140),
      });
    }
  }
  // Selection, then ordering — the split `frames/render.ts` insists on. Strongest tint first, so a
  // truncated band still shows a viewer where the storm is worst.
  return Object.freeze(
    out.sort((a, b) => b.tintBps - a.tintBps || compareIds(a.system, b.system)).slice(0, limit),
  );
}

function bandLegend(state: FrontState, system: SystemId, tintBps: Bps, ticksOut: number): string {
  const pct = Math.trunc((tintBps * 100) / BPS_ONE);
  if (state === 'STRUCK' || state === 'PASSED') return `${system} STRUCK · ${String(pct)}% taken`;
  if (state === 'IMMINENT') return `${system} ${String(pct)}% · IMMINENT, cover shut`;
  return `${system} ${String(pct)}% · lands in ${String(ticksOut)}`;
}

// ── 2. THE COVER ARC ────────────────────────────────────────────────────────

export interface CoverArc {
  readonly cover: CoverId;
  readonly payer: PrincipalId;
  readonly payee: PrincipalId;
  /** Where the arc is drawn: the system whose goods are covered. */
  readonly system: SystemId;
  readonly good: GoodId;
  readonly limit: Minor;
  /** ★ The arc's **filled** fraction. `escrowRatioBps`, the same number §7.5 publishes. */
  readonly filledBps: Bps;
  /** The **hollow** part, in money. What is riding on the payer's word. */
  readonly onItsWord: Minor;
  /** True once the front has struck it: the arc is now a live obligation, not a standing promise. */
  readonly struck: boolean;
  /** True while the covered system is inside a live CONE. The arc is about to matter. */
  readonly inCone: boolean;
  readonly legend: string;
}

export function coverArcs(
  book: RiskBook,
  tick: number,
  limit: number = MAX_COVER_ARCS,
): readonly CoverArc[] {
  const coned = new Set<SystemId>();
  for (const front of book.liveFronts(tick)) {
    if (front.struckAtTick !== null) continue;
    for (const cell of front.cone) coned.add(cell.system);
  }

  const out: CoverArc[] = [];
  for (const cover of book.allCovers()) {
    if (!isLiveCover(cover.state)) continue;
    if (cover.over.kind !== 'GOODS' || cover.payee === null) continue;
    const onItsWord = (cover.elective - cover.settledElectiveMinor) as Minor;
    out.push({
      cover: cover.id,
      payer: cover.payer,
      payee: cover.payee,
      system: cover.over.system,
      good: cover.over.good,
      limit: cover.limit,
      filledBps: escrowRatioBps(cover),
      onItsWord,
      struck: cover.state === 'STRUCK',
      inCone: coned.has(cover.over.system),
      legend:
        `${cover.payer} covers ${cover.payee} · ${String(cover.limit)}, ` +
        `${String(onItsWord)} on its word`.slice(0, 140),
    });
  }
  // Struck first, then in-cone, then largest promise. A truncated set shows what is at stake now.
  return Object.freeze(
    out
      .sort(
        (a, b) =>
          Number(b.struck) - Number(a.struck) ||
          Number(b.inCone) - Number(a.inCone) ||
          b.onItsWord - a.onItsWord ||
          compareIds(a.cover, b.cover),
      )
      .slice(0, limit),
  );
}

// ── 3. THE COVER CHAIN ──────────────────────────────────────────────────────

/**
 * `STANDING → PAID | SNAPPED`, plus `GREYED` for a link downstream of a snap.
 *
 * `GREYED` is not a promise state — it is a *drawing* state, and it says "this link has not failed;
 * the one outside it has, so what it will do is now in doubt." Keeping it distinct from `SNAPPED`
 * matters for the same reason the record distinguishes `DECLINED` from `UNFUNDED`: a viewer must be
 * able to tell the house that refused from the house that was let down.
 */
export type ChainLinkState = 'INTACT' | 'PAID' | 'SNAPPED' | 'GREYED';

export interface CoverChainLink {
  readonly cover: CoverId;
  readonly payer: PrincipalId;
  readonly payee: PrincipalId;
  readonly depth: number;
  readonly limit: Minor;
  readonly state: ChainLinkState;
  /** The amount that failed here, if it did. Zero otherwise. */
  readonly broke: Minor;
}

export interface CoverChain {
  /** The primary at the bottom. The chain's identity. */
  readonly primary: CoverId;
  /** The located goods every layer ultimately stands behind. RE6's fingerprint, rendered. */
  readonly fingerprint: string;
  readonly links: readonly CoverChainLink[];
  /** The deepest layer that failed, or 0. What the caption names. */
  readonly snappedAt: number;
  readonly legend: string;
}

export function coverChains(
  book: RiskBook,
  tick: number,
  limit: number = MAX_COVER_CHAIN_LINKS,
): readonly CoverChain[] {
  const out: CoverChain[] = [];
  // One chain per primary that has something over it. A lone primary is a COVER ARC, not a chain,
  // and drawing it twice would spend two of seven labels on one fact.
  for (const primary of book.allCovers()) {
    if (primary.over.kind !== 'GOODS') continue;
    if (book.cessionsOver(primary.id).length === 0) continue;

    const links: CoverChainLink[] = [];
    let snappedAt = 0;
    // Outermost first, so a reader follows the money the way it travels.
    const layers = [primary, ...walkOut(book, primary.id)].sort((a, b) => b.depth - a.depth);
    for (const cover of layers) {
      if (cover.payee === null) continue;
      const ind = book.indemnityForCover(cover.id);
      const broke = ind === undefined ? (0 as Minor) : ((ind.electiveDue - ind.electivePaid) as Minor);
      const failed = ind !== undefined && ind.state === 'DEFAULTED';
      if (failed) snappedAt = Math.max(snappedAt, cover.depth);
      links.push({
        cover: cover.id,
        payer: cover.payer,
        payee: cover.payee,
        depth: cover.depth,
        limit: cover.limit,
        state: failed
          ? 'SNAPPED'
          : ind !== undefined && ind.state === 'PAID'
            ? 'PAID'
            : 'INTACT',
        broke: failed ? broke : (0 as Minor),
      });
    }
    // ★ The grey. Every link INWARD of the deepest snap is in doubt, and says so.
    const greyed: CoverChainLink[] = links.map((l) =>
      snappedAt > 0 && l.depth < snappedAt && l.state === 'INTACT'
        ? { ...l, state: 'GREYED' satisfies ChainLinkState }
        : l,
    );
    out.push({
      primary: primary.id,
      fingerprint: primary.fingerprint,
      links: Object.freeze(greyed.slice(0, limit)),
      snappedAt,
      legend:
        snappedAt > 0
          ? `chain of ${String(greyed.length)} SNAPPED at layer ${String(snappedAt)}`
          : `chain of ${String(greyed.length)} intact on ${primary.fingerprint}`,
    });
  }
  void tick;
  return Object.freeze(
    out.sort((a, b) => b.snappedAt - a.snappedAt || compareIds(a.primary, b.primary)).slice(0, limit),
  );
}

/** Everything written over `cover`, transitively, bounded. Never a loop (INV-R4, §15.2). */
function walkOut(book: RiskBook, cover: CoverId): readonly CoverRecord[] {
  const out: CoverRecord[] = [];
  let layer = book.cessionsOver(cover);
  for (let i = 0; i < MAX_COVER_CHAIN_LINKS && layer.length > 0; i += 1) {
    out.push(...layer);
    layer = layer.flatMap((c) => book.cessionsOver(c.id));
  }
  return out;
}
