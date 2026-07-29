/**
 * Running the risk market — two ports, two phases, and the ordering that keeps the world alive.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ## Where this runs, and why it cannot run anywhere else
 *
 * **`HAZARD` — {@link strikeFront}.** §15.2's own note on the phase: *"hazards roll against what is
 * still standing. **After VENTURES**, so a hazard cannot pre-empt a settlement."* That is exactly
 * right for a FRONT: a venture whose cargo the front would have taken has already resolved, so the
 * two loss paths cannot both charge the same lot. The phase has existed since Phase 0 with nothing
 * registered on it and `hazards` defaulting to **false**; this is its first content.
 *
 * **`OBLIGE`, after `settleNow` — {@link settleCohort}.** Load-bearing and the one thing in this
 * module that would take a healthy world down if it were wrong.
 * `reckoning/driver.ts:verifyInputs` re-reads every payer's free balance between the freeze and the
 * settlement and **halts on any difference in either direction**. Paying an INDEMNITY moves currency
 * into a payer's STORES, so this must run *after* the venture batch — the same position the Levy
 * sweep and the Charge slash already occupy, and for the same reason. Running it before would pause
 * the world on the one tick that has an audience.
 *
 * ## The cadence (SOL2, and the pass's *"exact catastrophe settlement cadence"*)
 *
 * ```
 * announce   ── HAZARD, FRONT_CONE_RECKONINGS ahead: the CONE publishes, cover opens
 * imminent   ── FRONT_COVER_FREEZE_TICKS out: new cover refused, bound cover non-cancellable
 * strike     ── HAZARD at FRONT_LANDFALL_PHASE: goods die, the cohort opens, one cause event
 * honour     ── HONOUR_WINDOW_TICKS: payers read obligations_due and `elect`
 * settle     ── OBLIGE at SETTLEMENT_PHASE, after the venture batch: outermost cession first
 * ```
 *
 * The pass names eight steps; this is five, and the three that are missing are named in `params.ts`
 * as deliberate omissions (adjustment, the liquidity window, recovery). What survives is the shape
 * that matters: **loss, then a window in which a payer decides, then a settlement that pays inward.**
 *
 * ## The propagation, as code
 *
 * {@link settleCohort} walks the cohort in **descending depth** and carries a map of
 * `payer → the event id of a default that let it down`. When a cession defaults, the primary below it
 * gets that event id, and if the primary then defaults its row cites **the cession's failure** rather
 * than the front's. §15.4's Mode B asks that every default *"carries the event ID of the loss or the
 * missed delivery that caused it"*, and for a propagated failure the missed delivery is the one above.
 *
 * That single map is the whole difference between "three agents failed on the same day" and "one
 * failure travelled".
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { Rng } from '../core/rng.js';
import { reckoningIndex } from '../core/time.js';
import type { AccountId, EventId, PrincipalId } from '../core/types.js';
import { addMinor, minor, type Minor, type Qty } from '../core/units.js';
import { GOODS_SINK, storesAccount } from '../ledger/accounts.js';
import type { Ledger } from '../ledger/ledger.js';
import type { Lot, LotId } from '../ledger/lots.js';
import { compareIds } from '../ledger/order.js';
import type { WorldMap } from '../world/map.js';
import type { Election } from '../venture/settlement.js';
import { RiskBook } from './book.js';
import {
  isAttached,
  type CoverId,
  type CoverRecord,
} from './cover.js';
import {
  announceFront,
  destroySet,
  frontReckoningAnnouncedAt,
  isLandfallTick,
  type FrontLoss,
  type FrontRecord,
} from './front.js';
import {
  assertIndemnityExact,
  openCession,
  openPrimary,
  settleIndemnity,
  type IndemnityRecord,
  type IndemnitySettlement,
  type RiskDefault,
  type RiskHonoured,
} from './indemnity.js';
import { MAX_LIVE_FRONTS } from './params.js';

export class RiskRunError extends Error {}

// ── HAZARD ──────────────────────────────────────────────────────────────────

/**
 * What the HAZARD half reads and writes. Narrow on purpose.
 *
 * `works/refine.ts` states the argument this port is built on: *"the value here is that the signature
 * ENUMERATES the operation's reach."* Five members, and none of them is the `Runtime`.
 */
export interface FrontPort {
  readonly map: WorldMap;
  readonly rng: Rng;
  /** Every lot in the world. Filtered by {@link destroySet}, never here. */
  readonly lots: () => readonly Lot[];
  readonly destroy: (args: {
    readonly eventId: EventId;
    readonly lotId: LotId;
    readonly qty: Qty;
  }) => void;
  /** The pinned mark a COVER agreed to, for the INDEMNITY arithmetic. */
  readonly storesOf: (principal: PrincipalId) => AccountId;
}

export interface StrikeOutcome {
  readonly front: FrontRecord;
  readonly losses: readonly FrontLoss[];
  readonly destroyedQty: Qty;
  readonly indemnities: readonly IndemnityRecord[];
  /** Struck systems, for the ticker and the frame. */
  readonly swath: readonly string[];
  /** Principals that lost goods and had no COVER. The market's own measure of its reach. */
  readonly naked: readonly PrincipalId[];
}

/** Announce the FRONT for this Reckoning, if this is its tick. Idempotent. */
export function announceIfDue(port: FrontPort, book: RiskBook, tick: number): FrontRecord | null {
  const reckoning = frontReckoningAnnouncedAt(tick);
  if (reckoning === null) return null;
  if (book.liveFronts(tick).filter((f) => f.struckAtTick === null).length >= MAX_LIVE_FRONTS) {
    return null;
  }
  const front = announceFront(port.map, port.rng, reckoning, tick);
  if (book.front(front.id) !== undefined) return null;
  book.addFront(front);
  return front;
}

/**
 * The FRONT strikes: goods die, then the cohort opens.
 *
 * **Order matters and is stated: destroy, then open.** `cargoLost.ts` makes the same call in the same
 * words — *"paying first would let an implementation quietly decide the cargo survived because the
 * money was already gone."* Here the equivalent error would be opening an INDEMNITY for a loss that
 * then failed to happen, which is a claim against a principal for goods it still holds.
 *
 * The INDEMNITY is measured from **what was actually destroyed**, per `(payee, good)`, at the mark the
 * COVER pinned. Not from the lot list, not from a re-read of the holding, and never from a post-event
 * price — see `indemnity.ts`'s header on why that third one is the false default this layer is most
 * exposed to.
 */
export function strikeFront(
  port: FrontPort,
  book: RiskBook,
  front: FrontRecord,
  tick: number,
  causeEventId: EventId,
  dueTick: number,
): StrikeOutcome {
  if (!isLandfallTick(front, tick)) {
    throw new RiskRunError(
      `front ${front.id} lands at tick ${String(front.landfallTick)} and was asked to strike at ` +
        `${String(tick)} (struck: ${String(front.struckAtTick)})`,
    );
  }

  // ── 1. The goods die. ─────────────────────────────────────────────────────
  const losses = destroySet(front, port.lots());
  let destroyed = 0;
  for (const [i, loss] of losses.entries()) {
    port.destroy({
      // One strike, many lots: a distinct id per lot so the record can point at the one that burned.
      // Same convention as `cargoLost.ts`'s `${eventId}#${i}`.
      eventId: `${causeEventId}#${String(i)}` as EventId,
      lotId: loss.lotId,
      qty: loss.qty,
    });
    destroyed += loss.qty;
  }
  front.struckAtTick = tick;
  front.state = 'STRUCK';
  front.causeEventId = causeEventId;

  // ── 2. What each payee lost, per good, from the destruction itself. ───────
  const byPayee = new Map<string, number>();
  const stores = new Map<AccountId, PrincipalId>();
  for (const loss of losses) {
    const lot = port.lots().find((l) => l.id === loss.lotId);
    const owner = lot === undefined ? null : ownerOfStores(lot.account);
    if (owner === null) continue;
    stores.set(lot!.account, owner);
    const key = `${owner}::${loss.good}::${loss.system}`;
    byPayee.set(key, (byPayee.get(key) ?? 0) + loss.qty);
  }

  // ── 3. The cohort. Primaries first, then cessions over them, layer by layer. ──
  const opened: IndemnityRecord[] = [];
  const lostBy = new Set<PrincipalId>();
  for (const cover of book.allCovers()) {
    if (cover.over.kind !== 'GOODS') continue;
    if (cover.payee === null) continue;
    if (!isAttached(cover, tick)) continue;
    const key = `${cover.payee}::${cover.over.good}::${cover.over.system}`;
    const qtyLost = byPayee.get(key) ?? 0;
    if (qtyLost <= 0) continue;
    const ind = openPrimary({
      cover,
      front: front.id,
      qtyLost: qtyLost as Qty,
      good: cover.over.good,
      tick,
      dueTick,
      causeEventId,
    });
    assertIndemnityExact(ind);
    book.addIndemnity(ind);
    cover.state = 'STRUCK';
    opened.push(ind);
    lostBy.add(cover.payee);
  }

  // Cessions, in ascending depth so a layer's parent INDEMNITY already exists. Bounded by
  // COVER_MAX_DEPTH rather than looping to convergence (§15.2).
  for (let depth = 2; depth <= 8; depth += 1) {
    let openedAtDepth = 0;
    for (const cover of book.allCovers()) {
      if (cover.over.kind !== 'COVER') continue;
      if (cover.depth !== depth) continue;
      if (cover.payee === null) continue;
      if (!isAttached(cover, tick)) continue;
      const under = book.indemnityForCover(cover.over.cover);
      if (under === undefined) continue;
      if (book.indemnityForCover(cover.id) !== undefined) continue;
      const ind = openCession({ cover, under, tick, dueTick });
      assertIndemnityExact(ind);
      book.addIndemnity(ind);
      cover.state = 'STRUCK';
      opened.push(ind);
      openedAtDepth += 1;
    }
    if (openedAtDepth === 0) break;
  }

  // ── 4. Who was naked. The market's own reach, measured rather than assumed. ──
  const covered = new Set(opened.map((i) => i.payee));
  const naked = [...new Set([...stores.values()])].filter((p) => !covered.has(p)).sort(compareIds);

  return {
    front,
    losses,
    destroyedQty: destroyed as Qty,
    indemnities: Object.freeze(opened),
    swath: Object.freeze(front.swath.map((c) => String(c.system))),
    naked: Object.freeze(naked),
  };
}

/**
 * `stores:<principal>` → the principal. `null` for anything else.
 *
 * A string parse rather than a ledger lookup, and it is the *narrower* of the two: `destroySet`
 * already filters to `stores:` accounts, and an escrow whose id happened to contain the prefix would
 * be admitted by a lookup that only checked `account.principal !== null`.
 */
export function ownerOfStores(account: AccountId): PrincipalId | null {
  if (!account.startsWith('stores:')) return null;
  const rest = account.slice('stores:'.length);
  return rest.length === 0 ? null : (rest as PrincipalId);
}

/** The goods sink a FRONT charges. §10.2's `LOSS`, which its own comment already names fronts for. */
export const FRONT_SINK: AccountId = GOODS_SINK.LOSS;

// ── OBLIGE ──────────────────────────────────────────────────────────────────

export interface SettleCohortInput {
  readonly ledger: Ledger;
  readonly book: RiskBook;
  readonly front: FrontRecord;
  readonly tick: number;
  readonly eventId: EventId;
  /** `cover → what its payer elected`. Absent pays nothing; silence is a default, not an escape. */
  readonly elections: ReadonlyMap<CoverId, Election>;
  /** INV-19: per-cover, as the freeze captured it. */
  readonly actedOnStateVersion: ReadonlyMap<CoverId, number>;
  readonly storesOf?: (p: PrincipalId) => AccountId;
  /** True when the cascade hit the round limit. Only then may a funding shortfall defer. */
  readonly truncated?: boolean;
  /**
   * ★ **Publish a default and return the id the ledger minted for it.**
   *
   * The propagation channel is a map of `payer → the event that let it down`, and INV-17 requires that
   * event to be **a row an auditor can open**: *"cites cause …, which is not in the ledger"* is a halt.
   * A content-derived string would satisfy the map and fail the invariant, which is what the first
   * wiring did — so the id comes from whoever owns the record, and this module only decides *which*
   * failure caused which.
   */
  readonly publishDefault?: (d: RiskDefault, settlement: IndemnitySettlement) => EventId | null;
}

export interface CohortOutcome {
  readonly front: string;
  readonly settlements: readonly IndemnitySettlement[];
  readonly defaults: readonly RiskDefault[];
  readonly honoured: readonly RiskHonoured[];
  readonly paid: Minor;
  readonly unattributed: Minor;
  /**
   * ★ **The propagation, counted.** Defaults whose cause is another default rather than the FRONT.
   *
   * This is the number the whole layer exists to make non-zero, and it is a field rather than
   * something a reader infers, because *"an unmeasured capability is the same defect one level up"*.
   */
  readonly propagated: number;
  /** The deepest layer that failed. For the CHAIN frame's caption. */
  readonly deepestFailure: number;
}

/**
 * Settle every INDEMNITY off one FRONT, **outermost cession first**.
 *
 * SOL2's phased clearing, reduced to the one ordering that carries the design: a reinsurer answers
 * before the primary it stands behind, so the primary decides knowing what it did or did not receive.
 * RE1 keeps the primary liable either way — there is no cut-through here, deliberately, because
 * cut-through is the clause that *stops* contagion.
 */
export function settleCohort(input: SettleCohortInput): CohortOutcome {
  const storesOf = input.storesOf ?? storesAccount;
  const cohort = input.book.cohortOf(input.front.id);
  const reckoning = reckoningIndex(input.tick);

  /** `payer → the default that left it short`. The propagation channel, as one map. */
  const letDownBy = new Map<PrincipalId, EventId>();
  const settlements: IndemnitySettlement[] = [];
  const defaults: RiskDefault[] = [];
  const honoured: RiskHonoured[] = [];
  let paid = minor(0);
  let unattributed = minor(0);
  let propagated = 0;
  let deepestFailure = 0;

  for (const ind of cohort) {
    if (ind.state !== 'OPEN' && ind.state !== 'DUE' && ind.state !== 'DEFERRED') continue;
    const cover = input.book.requireCover(ind.cover);
    const version = input.actedOnStateVersion.get(cover.id) ?? cover.actedOnStateVersion ?? 0;

    const settlement = settleIndemnity(
      input.ledger,
      {
        indemnity: ind,
        cover,
        tick: input.tick,
        eventId: `${input.eventId}#${ind.id}` as EventId,
        election: input.elections.get(cover.id),
        actedOnStateVersion: version,
        truncated: input.truncated ?? false,
        // ★ The one line that makes a chain a chain.
        upstreamDefaultEventId: letDownBy.get(ind.payer) ?? null,
      },
      storesOf,
    );
    assertIndemnityExact(ind);
    settlements.push(settlement);
    paid = addMinor(paid, addMinor(settlement.escrowedPaid, settlement.electivePaid));
    unattributed = addMinor(unattributed, settlement.unattributed);

    for (const d of settlement.defaults) {
      defaults.push(d);
      if (d.causeEventId !== ind.causeEventId) propagated += 1;
      deepestFailure = Math.max(deepestFailure, d.depth);
      input.book.noteDefaulted(d.payer, d.amount, settlement.electivePaid);
      // The payee of a defaulted INDEMNITY is short. If it is itself a payer one layer in, its own
      // decision now has an attributable excuse — which is the propagation, and also the thing that
      // stops the record calling an unfunded primary a liar.
      //
      // The id must be the LEDGER's, not ours: see `publishDefault`.
      const minted = input.publishDefault?.(d, settlement) ?? null;
      if (minted !== null) letDownBy.set(d.payee, minted);
    }
    for (const h of settlement.honoured) {
      honoured.push(h);
      input.book.noteHonoured(h.payer, settlement.electivePaid);
    }

    if (settlement.state !== 'DEFERRED') {
      input.book.resolveIndemnity(ind, reckoning);
      input.book.resolveCover(cover, 'SETTLED', reckoning);
    }
  }

  return {
    front: input.front.id,
    settlements: Object.freeze(settlements),
    defaults: Object.freeze(defaults),
    honoured: Object.freeze(honoured),
    paid,
    unattributed,
    propagated,
    deepestFailure,
  };
}

/** The permanent row a downstream default cites. Content-derived, so a replay names it identically. */
export function defaultEventId(batch: EventId, d: RiskDefault): EventId {
  return `${batch}#default:${d.indemnity}` as EventId;
}

// ── Lapsing ─────────────────────────────────────────────────────────────────

export interface LapseOutcome {
  readonly cover: CoverId;
  readonly payer: PrincipalId;
  readonly returned: Minor;
  readonly reason: 'UNTAKEN' | 'NO_LOSS';
}

/**
 * Expire COVERS whose term ran out, and send the escrow home.
 *
 * ★ **This is the payer's business model and it must actually happen**, or writing cover is a
 * donation and nobody ever does it twice. Two reasons a COVER lapses and they are distinguished on
 * the record, because a viewer should be able to tell *"nobody wanted it"* from *"the storm missed"*:
 *
 *   - `UNTAKEN` — offered, never bound. The premium was never paid either.
 *   - `NO_LOSS` — bound, attached, expired with nothing struck. **The premium is kept.** That is the
 *     whole return on writing risk, and it is what makes the escrow ratio a decision rather than a
 *     tax.
 */
export function lapseExpired(
  ledger: Ledger,
  book: RiskBook,
  tick: number,
  eventId: EventId,
  storesOf: (p: PrincipalId) => AccountId = storesAccount,
): readonly LapseOutcome[] {
  const out: LapseOutcome[] = [];
  const reckoning = reckoningIndex(tick);
  for (const cover of book.allCovers()) {
    if (cover.state !== 'OFFERED' && cover.state !== 'BOUND' && cover.state !== 'ATTACHED') continue;
    // ★ TWO CLOCKS. An unbound offer lapses on its TTL; a bound COVER lapses on its term. Reading one
    // field for both is what made every COVER expire before its FRONT landed.
    const deadline = cover.state === 'OFFERED' ? cover.offerExpiresTick : cover.expiresTick;
    if (tick <= deadline) continue;
    const left = ledger.account(cover.escrow) === undefined ? minor(0) : ledger.freeBalance(cover.escrow);
    if (left > 0) {
      ledger.transferCurrency({
        eventId: `${eventId}#lapse:${cover.id}` as EventId,
        tick,
        from: cover.escrow,
        to: storesOf(cover.payer),
        amount: left,
      });
    }
    book.resolveCover(cover, 'LAPSED', reckoning);
    out.push({
      cover: cover.id,
      payer: cover.payer,
      returned: left,
      reason: cover.state === 'OFFERED' ? 'UNTAKEN' : 'NO_LOSS',
    });
  }
  return Object.freeze(out);
}

/** A COVER that has seasoned promotes itself. Pure bookkeeping, so the state means what it says. */
export function attachSeasoned(book: RiskBook, tick: number): number {
  let attached = 0;
  for (const cover of book.allCovers()) {
    if (cover.state !== 'BOUND') continue;
    if (cover.attachesTick === null || tick < cover.attachesTick) continue;
    cover.state = 'ATTACHED';
    attached += 1;
  }
  return attached;
}

/** Every live cover a payer stands behind, for the affordance's `max_contingent_liability`. */
export function contingentLiabilityOf(book: RiskBook, payer: PrincipalId): Minor {
  let total = minor(0);
  for (const cover of book.coversBy(payer)) {
    if (cover.state === 'SETTLED' || cover.state === 'LAPSED') continue;
    total = addMinor(total, minor(cover.elective - cover.settledElectiveMinor));
  }
  return total;
}

/** Every cover row a reader needs to price a counterparty, cheapest first. */
export function offersRanked(book: RiskBook, tick: number): readonly CoverRecord[] {
  return [...book.openOffers(tick)].sort(
    (a, b) =>
      a.premium - b.premium || b.escrowed - a.escrowed || compareIds(a.id, b.id),
  );
}
