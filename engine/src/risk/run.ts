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
import { FREEZE_FIRST_PHASE, phaseOfReckoning, reckoningIndex } from '../core/time.js';
import type { AccountId, EventId, PrincipalId } from '../core/types.js';
import { addMinor, minor, type Minor, type Qty } from '../core/units.js';
import { GOODS_SINK, storesAccount } from '../ledger/accounts.js';
import type { Ledger } from '../ledger/ledger.js';
import type { Lot, LotId } from '../ledger/lots.js';
import { compareIds } from '../ledger/order.js';
import type { WorldMap } from '../world/map.js';
import type { Election } from '../venture/settlement.js';
import { RiskBook } from './book.js';
import { isAttached, type CoverId } from './cover.js';
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
  isSettleableIndemnity,
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

/**
 * Announce the FRONT for this Reckoning, if this is its tick. Idempotent.
 *
 * ★ **The `MAX_LIVE_FRONTS` branch THROWS rather than skipping, and it used to skip silently.** A14:
 * a front *"is scheduled, announced, and undodgeable"*, so quietly not announcing one is the single
 * outcome that axiom forbids — and it would have left no row, no ticker and no fault. Meanwhile the
 * schedule makes the count unreachable (see {@link MAX_LIVE_FRONTS} for the arithmetic), so the old
 * `return null` was a guard whose subject cannot occur *guarding the wrong way*. `checkInvR9` carries
 * the same bound as a measured invariant on every tick.
 */
export function announceIfDue(port: FrontPort, book: RiskBook, tick: number): FrontRecord | null {
  const reckoning = frontReckoningAnnouncedAt(tick);
  if (reckoning === null) return null;
  // ★ **IDEMPOTENCE BEFORE THE CAP, AND THE ORDER IS THE WHOLE POINT OF PUTTING A THROW HERE.**
  // `announceFront` is a pure function of the map, the reckoning and a `derive`d sub-stream, so calling
  // it early consumes nothing. Checking the cap first would make a *second* call for the same tick —
  // a retried tick, a re-entered phase — halt on the front it had itself just announced, which is a
  // guard punishing its own success. The docblock the old silent skip carried said "Idempotent" and it
  // was; a throw that broke that would be a worse bug than the one it replaced.
  const front = announceFront(port.map, port.rng, reckoning, tick);
  if (book.front(front.id) !== undefined) return null;
  const unstruck = book.allFronts().filter((f) => f.struckAtTick === null);
  if (unstruck.length >= MAX_LIVE_FRONTS) {
    throw new RiskRunError(
      `reckoning ${String(reckoning)} is due a FRONT and ${String(unstruck.length)} are still unstruck ` +
        `at tick ${String(tick)}: ${unstruck.map((f) => `${f.id} lands at ${String(f.landfallTick)}`).join(', ')}` +
        `, against a cap of ${String(MAX_LIVE_FRONTS)}. A scheduled front may not be skipped — A14 — so ` +
        'the honest answer is to halt rather than to quietly not announce it. A landfall tick in the ' +
        'FUTURE means the schedule overlaps (check FRONT_EVERY_RECKONINGS against ' +
        'FRONT_CONE_RECKONINGS); one in the PAST means a world was adopted across a strike it never ran.',
    );
  }
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
  //
  // ★ **THE LOT INDEX IS BUILT ONCE, BEFORE ANYTHING IS DESTROYED, AND BOTH HALVES MATTER.**
  //
  // ══════════════════════════════════════════════════════════════════════════════
  // Step 2 used to call `port.lots().find((l) => l.id === loss.lotId)` **per destroyed lot**, and
  // `port.lots()` is `ledger.allLots()`, which sorts every lot in the galaxy. Measured: **37 calls over
  // 15,828 rows on a landfall tick** against 6 over 2,483 on a quiet one. It is unbudgeted work, so it
  // shows up as latency rather than a halt — but it is the same shape as the O(lots²) in `riskHoldings`
  // that *did* hold production for four minutes at tick 7,128, and `tick/loop.ts` asserts this phase is
  // O(lots), which that loop made false.
  //
  // And the latent correctness bug underneath it: the `find` ran **after** `port.destroy`, so a lot
  // taken in full could already be gone from `allLots()`. `lot === undefined` then hit `continue` and
  // the loss silently left both `byPayee` and `stores` — a destroyed holding with **no INDEMNITY opened
  // and no naked row either**, which is a payee that paid a premium, lost its goods and is recorded as
  // having lost nothing. It needs intensity at 10,000 bps to fire, which `FRONTIER` reaches exactly.
  // Indexing first removes the reachability and the cost in one line.
  // ══════════════════════════════════════════════════════════════════════════════
  const lotsBefore = new Map(port.lots().map((l) => [l.id, l]));
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
    const lot = lotsBefore.get(loss.lotId);
    if (lot === undefined) {
      // `destroySet` draws from the same list this map was built from, so this is unreachable — and it
      // throws rather than `continue`ing, because the old `continue` is precisely how a destroyed
      // holding could vanish from the record with nothing failing.
      throw new RiskRunError(
        `front ${front.id} destroyed lot ${loss.lotId}, which was not in the pre-strike index; a loss ` +
          'the record cannot attribute to an owner is a payee silently uninsured (A5′).',
      );
    }
    const owner = ownerOfStores(lot.account);
    if (owner === null) continue;
    stores.set(lot.account, owner);
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
  /**
   * ⚑ **THERE IS NO `actedOnStateVersion` MAP HERE ANY MORE.**
   *
   * There was, and `runCohortPhase` filled it by walking `book.allCovers()` and reading
   * `cover.actedOnStateVersion` — then `settleCohort` read the *same live objects* back out, so
   * `guardIndemnity` compared one field to itself. A map whose only possible source is the row it is
   * meant to check is not a freeze; it is a longer way of writing the same read. §15.4's second defence
   * now lives on the INDEMNITY, captured at landfall — see
   * {@link import('./indemnity.js').IndemnityRecord.pinnedStateVersion}.
   */
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
    if (!isSettleableIndemnity(ind.state)) continue;
    const cover = input.book.requireCover(ind.cover);

    const settlement = settleIndemnity(
      input.ledger,
      {
        indemnity: ind,
        cover,
        tick: input.tick,
        eventId: `${input.eventId}#${ind.id}` as EventId,
        election: input.elections.get(cover.id),
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

// ── ⚑ `defaultEventId` USED TO LIVE HERE AND IT WAS A LOADED GUN ────────────
//
// It built `${batch}#default:${d.indemnity}` — a **content-derived** id for a default row — and it was
// exported from the barrel with a docblock saying, in its own words, that using it reintroduces an
// INV-17 halt. It was the module's first wiring of the propagation channel, replaced by
// `SettleCohortInput.publishDefault` (read that field's docs) because INV-17 requires the cited cause to
// be *"a row an auditor can open"* and a synthetic string satisfies the `letDownBy` map while failing
// the invariant. It halted the world at tick 1151 exactly once, was fixed, and then **stayed exported**
// — a superseded function whose only remaining property is that calling it breaks A5′.
//
// Deleted rather than made private. A dead export is an affordance: the next caller finds it by name,
// the shape type-checks, and the failure is a top-severity halt two Reckonings later.

// ── Marking due (the `DUE` state's only writer) ──────────────────────────────

/**
 * ★ **Promote OPEN indemnities to `DUE` once the freeze has taken them.**
 *
 * `'DUE'` was in {@link IndemnityState}'s union, tested by **seven** predicates, and **assigned by
 * nothing** — see that type's docblock for the list. This is its writer, and the tick it fires on is
 * what gives the state a meaning: at {@link FREEZE_FIRST_PHASE} the election that will settle an
 * INDEMNITY stops being restatable in any way the settlement can see, so `OPEN` (you may still decide)
 * and `DUE` (the decision is taken, the money has not moved) are genuinely different situations for a
 * payer reading `obligations_due` — which is what RSK5 asks the field to publish.
 *
 * Idempotent and cheap: one pass, one comparison per open row, no ledger read and no RNG. Called from
 * `HAZARD` beside `attachSeasoned`, which is the other pure-bookkeeping promotion in the phase and
 * carries the same argument — *"pure bookkeeping, so the state means what it says."*
 */
export function markDue(book: RiskBook, tick: number): number {
  if (phaseOfReckoning(tick) < FREEZE_FIRST_PHASE) return 0;
  let marked = 0;
  for (const ind of book.allIndemnities()) {
    if (ind.state !== 'OPEN') continue;
    ind.state = 'DUE';
    marked += 1;
  }
  return marked;
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
    // ★ **THE REASON IS READ BEFORE THE STATE IS OVERWRITTEN, AND IT USED TO BE READ AFTER.**
    //
    // `resolveCover(cover, 'LAPSED', …)` sets `cover.state = 'LAPSED'`, and the `reason` below used to
    // be computed from `cover.state` *after* that call — so the `'OFFERED' ? 'UNTAKEN'` test could
    // never be true and **every** lapse was recorded as `NO_LOSS`. Since an offer nobody takes is by
    // far the most frequent risk row a quiet world produces, the append-only record's most common
    // statement about this market was *"the storm missed"* when the truth was *"nobody wanted it"* —
    // two different facts about the payer's business, and the docblock above exists specifically to
    // keep a viewer able to tell them apart. Scar #1's shape with no agent-facing string involved.
    const reason: LapseOutcome['reason'] = cover.state === 'OFFERED' ? 'UNTAKEN' : 'NO_LOSS';
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
    out.push({ cover: cover.id, payer: cover.payer, returned: left, reason });
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

