/**
 * `CARGO_LOST` — the single most important branch in SPEC §7.4.
 *
 * > **Encumbered assets are destructible.** An encumbrance is a claim on a thing,
 * > not a shield over it — otherwise agents would encumber everything to become
 * > raid-proof and the loss sink would die. So `escrowed` guarantees *priority and
 * > automaticity of payment from the escrow account*, never that the underlying
 * > goods survive; when escrowed goods are destroyed the venture resolves as
 * > `CARGO_LOST` … the escrow pays what remains, the shortfall is a **recorded
 * > loss, not a default**, and `sum(payouts) == proceeds` holds against the
 * > reduced proceeds. — SPEC §10.2
 *
 * Three properties this file exists to hold:
 *
 * 1. **The goods die.** The destruction runs first and it does not care what is
 *    pledged. If a lien could stop it, "pledge everything" would be free armour
 *    and nothing would ever be scarce tomorrow (PROP-L3).
 * 2. **The escrow still pays, in priority order.** That is the only thing escrow
 *    ever promised (A7).
 * 3. **It is never a default.** `isDefault: false` is a literal type, not a runtime
 *    flag, because INV-17 and A5′ make a fabricated default the worst bug this
 *    system can have: it libels a real agent permanently. The cause event is
 *    carried through so the recorded loss is attributable (INV-17).
 */

import type { AccountId, EventId, GoodId, VentureId } from '../core/types.js';
import { qty, sumMinor, type Minor, type Qty } from '../core/units.js';
import { GOODS_SINK } from './accounts.js';
import { LedgerError, type Ledger } from './ledger.js';
import type { LotId } from './lots.js';
import { compareIds } from './order.js';
import { payByPriority, type Claim, type Payout } from './waterfall.js';

/** A lot, or part of one, that the world destroyed. */
export interface CargoLoss {
  readonly lotId: LotId;
  readonly qty: Qty;
}

/** Peril a lock loses because its pledged cargo no longer exists. */
export interface PerilRelease {
  readonly encumbranceId: string;
  readonly amount: Minor;
}

export interface CargoLostInput {
  readonly eventId: EventId;
  readonly tick: number;
  readonly venture: VentureId;
  /** The escrow the venture's escrowed part pays from. */
  readonly escrow: AccountId;
  readonly lost: readonly CargoLoss[];
  /** Who is owed what, with `wage` senior to `share` via the priority band. */
  readonly claims: readonly Claim[];
  /**
   * How much **peril** each lock sheds because the cargo behind it burned. The
   * ledger cannot compute this: the value of pledged cargo was pinned in
   * `terms_hash` at signing (SPEC §15.4), and re-deriving it here at the current
   * mark is precisely the false-default mechanism. Required and emptyable, so the
   * caller has to decide rather than inherit a default.
   */
  readonly perilReleased: readonly PerilRelease[];
  /**
   * The event that destroyed the cargo — the raid, the front, the interception.
   * INV-17: a loss with no attributable cause is a top-severity halt, because it
   * is the game accusing an innocent agent.
   */
  readonly causeEventId: EventId;
}

export interface CargoLostOutcome {
  readonly venture: VentureId;
  /** What the escrow could actually pay. The *reduced* proceeds. */
  readonly proceeds: Minor;
  readonly payouts: readonly Payout[];
  /** Unpaid claims. A recorded loss; standing does not move (INV-21). */
  readonly shortfall: Minor;
  /** Escrow left over once every claim was met. Returns to the funder upstream. */
  readonly surplus: Minor;
  readonly destroyed: ReadonlyMap<GoodId, Qty>;
  /** Locks whose currency shrank because the account behind them was drained. */
  readonly locksReduced: readonly { readonly id: string; readonly shed: Minor }[];
  /** Locks whose EXPOSURE fell because the cargo behind them no longer exists. */
  readonly perilShed: readonly { readonly id: string; readonly shed: Minor }[];
  readonly causeEventId: EventId;
  /** Structural, not a flag: `CARGO_LOST` can never be a default. */
  readonly isDefault: false;
}

/**
 * Resolve a venture whose cargo was destroyed.
 *
 * Order matters and is stated: destroy, then pay, then release. Paying first would
 * let an implementation quietly decide the cargo survived because the money was
 * already gone, which is the shield this branch exists to refuse.
 */
export function resolveCargoLost(l: Ledger, input: CargoLostInput): CargoLostOutcome {
  if (input.lost.length === 0) {
    throw new LedgerError('CARGO_LOST needs at least one destroyed lot; use the ordinary waterfall');
  }

  // ── 1. The goods die, pledged or not. ────────────────────────────────────
  const destroyed = new Map<GoodId, Qty>();
  const touchedAccounts = new Set<AccountId>();
  const ordered = [...input.lost].sort((a, b) => compareIds(a.lotId, b.lotId));
  for (const [i, loss] of ordered.entries()) {
    const lot = l.requireLot(loss.lotId);
    touchedAccounts.add(lot.account);
    destroyed.set(lot.good, qty((destroyed.get(lot.good) ?? 0) + loss.qty));
    l.destroyGoods({
      // One destruction event, many lots: each posting batch is stamped with a
      // distinct id so the record can point at the individual lot that burned.
      eventId: `${input.eventId}#${i}` as EventId,
      tick: input.tick,
      sink: GOODS_SINK.LOSS,
      lotId: loss.lotId,
      qty: loss.qty,
    });
  }

  // ── 2. The escrow pays what remains, in priority order. ──────────────────
  // Proceeds are what is *in* the escrow now, not what the venture hoped for.
  // Pinning them here is what makes `sum(payouts) == proceeds` hold against the
  // reduced proceeds rather than against a stale valuation (SPEC §15.4).
  const proceeds = l.freeBalance(input.escrow);
  const result = payByPriority(proceeds, input.claims);
  for (const p of result.payouts) {
    if (p.paid <= 0) continue;
    l.transferCurrency({
      eventId: `${input.eventId}#pay:${p.key}` as EventId,
      tick: input.tick,
      from: input.escrow,
      to: p.account,
      amount: p.paid,
    });
  }

  // ── 3. Locks yield to reality. ───────────────────────────────────────────
  // The currency side first: a drained account cannot keep backing its locks.
  const locksReduced: { id: string; shed: Minor }[] = [];
  for (const account of [...touchedAccounts, input.escrow].sort(compareIds)) {
    locksReduced.push(...l.reduceLocksToBalance(account));
  }
  // Then the peril side: cargo that no longer exists cannot be lost again, so
  // EXPOSURE falls. Note that the lock itself stays **open** even if it is now
  // empty — auto-releasing it would make a secured obligation abruptly lack its
  // encumbrance and halt the tick on INV-4 in response to legitimate predation,
  // which is the false-default class of bug (SPEC §15.4).
  const perilShed: { id: string; shed: Minor }[] = [];
  for (const rel of [...input.perilReleased].sort((a, b) => compareIds(a.encumbranceId, b.encumbranceId))) {
    if (!l.encumbrances.isOpen(rel.encumbranceId)) continue;
    const shed = l.encumbrances.reducePeril(rel.encumbranceId, rel.amount);
    if (shed > 0) perilShed.push({ id: rel.encumbranceId, shed });
  }

  const paid = sumMinor(result.payouts.map((p) => p.paid));
  if (result.shortfall > 0 && paid !== proceeds) {
    // Belt and braces on the one arithmetic the SPEC calls out by name.
    throw new LedgerError(
      `INV-6: CARGO_LOST paid ${paid} against reduced proceeds ${proceeds} with ${result.shortfall} unpaid`,
    );
  }

  return {
    venture: input.venture,
    proceeds,
    payouts: result.payouts,
    shortfall: result.shortfall,
    surplus: result.surplus,
    destroyed,
    locksReduced,
    perilShed,
    causeEventId: input.causeEventId,
    isDefault: false,
  };
}
