import type { GoodId } from '../core/types.js';
/**
 * The endowment, and the one thing it may not do.
 *
 * ## Why this file exists (D7)
 *
 * Enrolment is free and **must stay free** — A15 says so, and A8's permanent floor
 * depends on it. So enrolment mints capital, and free identities mint capital without
 * limit. Worse, the seat cap does not bound it the way it looks: `api/seats.ts` never
 * touches the ledger, so recycling an idle seat frees the *seat* and leaves the *stores*
 * (A10 — identity never resets). The loop is enrol → mint → go idle → seat recycles →
 * enrol again, and total minted grows with churn, which has no ceiling. Measured: ten
 * free identities minted 2,500,000 currency and 500,000 goods at zero cost.
 *
 * Before the market existed this was hard to exploit: there is no principal-to-principal
 * transfer verb, and that absence was quietly doing the work. The market removes it — a
 * sock puppet bids far above value for its operator's junk goods and the entire stake
 * moves, through ordinary legal orders that violate nothing in the matcher.
 *
 * ## Why the endowment is withheld rather than removed or policed
 *
 * A15 rules out the obvious answers. Capping enrolments per source **is** a gate priced
 * in identities. Detecting and punishing wash trades needs intent, and A15 is explicit
 * that "the flow graph may **withhold credit**, never accuse". Removing the stake is
 * worse than the disease: the Levy is payable only in located goods, so a newcomer with
 * no allotment holds an obligation the rules make impossible to meet, which is A5′ with
 * our own economy as the cause.
 *
 * Withholding credit is precisely the sanctioned move, so that is what happens. **The
 * endowment funds a principal's own work — its ventures, its Levy, its hauling — and
 * cannot leave it.** It cannot fund a market BID and its goods cannot be sold. A real
 * agent playing alone never notices. A sock puppet is worth exactly zero, because the
 * only thing it can do with its stake is play, which is what we wanted anyway.
 *
 * ## Why there IS new state now — and what the argument against it got wrong
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS SECTION USED TO SAY "WHY THERE IS NO NEW STATE", AND THE REASONING WAS SOUND
 * GIVEN WHAT WAS KNOWN.** It is kept here rather than deleted, because the record should
 * show what changed. It argued:
 *
 * > *The endowment is a constant, so "how much of this balance is endowment" needs no
 * > tracking: the transferable part is everything above the floor... A principal that
 * > spends endowment on legitimate costs keeps the floor, so its transferable balance
 * > stays smaller than a perfectly-accounted version would allow. That is deliberate:
 * > for a Sybil guard, erring toward withholding is the safe direction, and the
 * > alternative is per-principal accounting inside the hash **for a rounding difference
 * > nobody can spend.***
 *
 * **The rounding difference nobody can spend was the entire buy side of the market.**
 * Measured, and it is not a rounding difference: every cast member in every world this
 * repo has ever run sits between 62,000 and 203,000 against a floor of 250,000, because
 * the Levy, a WORKS, a graduation and a founding all charge the stake. So
 * `freeBalance − ENDOWMENT_FLOOR_MINOR` was **identically zero for every principal that
 * has ever played this game**, no BID could be funded by anyone, and 3,065 lines of
 * `market/` never printed a fill. The direction of the error was safe; its *size* was
 * never measured, which is this project's signature failure arriving inside a deliberate
 * decision rather than an oversight.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * So the accounting is now real: {@link EndowmentBook} carries a per-principal
 * `remaining`, and `freeCash` is `freeBalance − remaining` rather than
 * `freeBalance − STARTER_STAKE`.
 *
 * ## Why tracking it down is still A15-safe — the four properties
 *
 *   1. **A fresh identity still cannot transfer a penny.** `remaining` is the whole
 *      `STARTER_STAKE`, so `freeCash` is 0. The Sybil funnel is closed exactly as before,
 *      and `test/market/endowment.test.ts` still measures ten free identities at zero
 *      transferable capital.
 *   2. **A retirement is `freeCash`-NEUTRAL, which is the correctness property.** Spend
 *      `X` into a world sink and the balance falls by `X` *and* `remaining` falls by `X`,
 *      so `freeBalance − remaining` does not move. You cannot launder endowment into
 *      transferable currency by burning it — burning it destroys it.
 *   3. **`remaining` falls on RETIREMENT ONLY, never on a transfer.** A transfer out is
 *      already capped at `freeCash` and lowers the balance alone, which lowers `freeCash`
 *      by what left. `TRACKER.md` sketched the rule as
 *      `floor = STARTER_STAKE − retired − transferredOut`; that third term is wrong and
 *      is corrected here — subtracting it too would leave `freeCash` unchanged after a
 *      transfer, i.e. an unbounded one. **Retirement and transfer are different acts** is
 *      the same distinction `works/params.ts` drew for the WORKS gate.
 *   4. **Therefore `freeCash ≤ earned − transferredOut`, always.** The only way to hold
 *      transferable currency is to have been paid it by somebody, or minted it from a
 *      faucet that the map — not the population — bounds.
 *
 * ## Why the cost is now worth paying
 *
 * The old argument's ledger of costs was accurate: this is hashed per-principal state, it
 * joins the rollback set, the snapshot and `CHECKPOINT_REQUIRED_TABLES`, and it costs a
 * `RULES_VERSION` bump (18 → 19) with a declared discontinuity. Against that: without it
 * the market has no buyers, and a market with no buyers has no price, and without a price
 * the goods economy, hauling, comparative advantage between tiers and every gate priced in
 * produced goods are all decoration. That was not a trade the old text was in a position
 * to weigh, because nobody had measured the left-hand side.
 *
 * ## Where it lives, and why not in its own table
 *
 * Inside `Ledger`, captured by `ledgerStateTable` alongside `EncumbranceBook`. The `ledger`
 * table is already in `state_hash`, already in `CHECKPOINT_REQUIRED_TABLES` and already
 * rolled back by `Ledger.restoreTo`, so a nested book inherits three wirings instead of
 * needing them re-done — `syndicate/book.ts` makes the same argument for the same reason.
 * It also puts the counter in the only module that can decrement it: `retireCurrency` is
 * the single door through which currency is destroyed, so the hook cannot be forgotten by
 * a future sink the way five separate call-site edits could be.
 */

import type { PrincipalId } from '../core/types.js';
import { minor, type Minor, type Qty } from '../core/units.js';
import { LEVY_STARTER_ALLOTMENT } from '../levy/params.js';
import { compareIds } from './order.js';

/**
 * The currency minted to each principal at enrolment (§12.5).
 *
 * Defined here rather than in the runtime because the floor and the grant must be the
 * same number — one quantity with two homes is scar #5, and a drift between them would
 * silently open the hole this file closes.
 */
export const STARTER_STAKE: Minor = minor(250_000);

/**
 * A principal's withheld endowment **on the day it enrols** — the starting value of
 * {@link EndowmentBook}'s per-principal counter, not a constant every principal carries
 * forever.
 *
 * It was the latter until `RULES_VERSION` 19, and that is the defect the header records:
 * a floor that never moved while the balance did meant `freeBalance − floor` was zero for
 * everybody. The number is unchanged; what changed is that it is now a starting point.
 *
 * Still declared as an alias of {@link STARTER_STAKE} rather than as its own literal,
 * because the endowment granted and the endowment withheld must be the same quantity —
 * two homes for one number is scar #5, and a drift between them reopens D7 silently.
 */
export const ENDOWMENT_FLOOR_MINOR: Minor = STARTER_STAKE;

/** The good minted at enrolment. The Levy is payable only in this. */
/**
 * Equal to the other three goods constants TODAY, and **not an alias of them.**
 *
 * These four were `X = LEVY_GOOD`, so changing the Levy's good silently changed the WORKS yield, the
 * Charge, and the endowment at once — one constant wearing four meanings, which is scar #5's
 * shape in the type system rather than in a table. It also forced `ledger/` and `works/` to import
 * from `levy/`, inverting the layering: the ledger has no business depending on the Levy for the name
 * of a good.
 *
 * They are equal because this build has ONE good, which is a decision (`D17`), not a fact about the
 * engine — everything below `GoodId` is already good-agnostic. `test/core/goods-are-independent.test.ts`
 * pins both halves: that all four agree today, and that each is declared on its own so the day a second
 * good lands, changing one cannot move the others.
 */
export const ENDOWMENT_GOOD = 'ration' as GoodId;

/** Units of {@link ENDOWMENT_GOOD} below which a principal may not sell. */
export const ENDOWMENT_GOOD_FLOOR_QTY: Qty = LEVY_STARTER_ALLOTMENT;

/** One principal's row. Monotone non-increasing; `remaining` is never re-credited. */
export interface EndowmentRow {
  readonly principal: PrincipalId;
  readonly remaining: Minor;
}

/**
 * ★ **THE PER-PRINCIPAL ENDOWMENT COUNTER.** How much of a principal's balance is still
 * the stake it was given rather than money it earned.
 *
 * ── WHEN IT RESETS: **NEVER.** ───────────────────────────────────────────────
 *
 * Stated first and loudly, because `Book.prune` has silently destroyed a load-bearing row
 * five times in this repo — in the engine (`MAX_RECKONING_SUMMARIES`), in a fix
 * (`LEVY_RETAINED_RECKONINGS`), in an instrument (`balance-gate.ts` accumulating off a
 * bounded ring), as a `Ring` cap that ate 109 `kept` from a nine-Reckoning sweep, and as
 * the engagement `prune` whose §9 fix evaporated in production. **Every one failed in the
 * direction that hides.** A running total is exactly the state a prune window or a
 * per-Reckoning reset destroys, so:
 *
 *   - **Keyed by `PrincipalId` alone**, never by `reckoning::principal`. Every window prune
 *     in this codebase keys off the compound form; nothing can reach a bare principal key.
 *     Same shape as `levy.seatedAt`, `levy.chronic` and `sovereignty.epochs`, all three
 *     documented as never pruned because identity is never deleted (A10).
 *   - **No `prune`, no `clear()` outside {@link restore}, no `Ring`, no cap.** Bounded by
 *     the principal roll, which is the bound `levy/book.ts:222` argues for over a hard cap:
 *     *"a refusal here would lose the mark... failing in exactly the direction that hides."*
 *   - **Absent ⇒ {@link ENDOWMENT_FLOOR_MINOR}, which is MAXIMUM withholding.** This is the
 *     property that makes the whole structure safe against its own bugs. A row that a prune
 *     ate, a restore dropped or an enrolment forgot reverts the principal to *exactly the
 *     pre-19 behaviour* — the endowment fully withheld — which is a visible loss of buying
 *     power, not a silent gain. Contrast `standing.ts:334`, where an empty book was maximum
 *     *permission* and therefore had to throw. Here empty is the safe direction, so rows are
 *     created lazily on the first retirement and the common case stores nothing at all.
 *
 * **Who reads it:** {@link import('../market/escrow.js').freeCash}, which is the single
 * gate on the market BID, the sovereignty cession price and the syndicate contribution.
 * Nothing else. **Who writes it:** `Ledger.retireCurrency`, and nothing else.
 *
 * **Would a test notice it clearing?** Yes, three of them, deliberately:
 * `test/ledger/endowment-book.test.ts` mutation-drops the row and asserts the buyer stops
 * being able to bid; `test/durability/books-in-the-hash.test.ts`'s per-book pair proves the
 * hash stops seeing the book when the capture is neutered; and INV-7's fourth mirror
 * recomputes every row from the posting log on **every tick in production**, so a cleared
 * row halts the world rather than quietly re-withholding.
 */
export class EndowmentBook {
  /** Only principals that have retired currency. Absent means "untouched stake". */
  private readonly rows = new Map<PrincipalId, Minor>();

  /** How much of this principal's balance is still endowment. Never negative. */
  remaining(principal: PrincipalId): Minor {
    return this.rows.get(principal) ?? ENDOWMENT_FLOOR_MINOR;
  }

  /**
   * Charge a world-facing retirement against the endowment, endowment-first.
   *
   * **Endowment-first is deliberate and it is the generous direction**, so it needs the
   * argument. Charging earnings first would keep `remaining` high and destroy earned
   * currency on paper while the endowment sat untouched — which is the pre-19 behaviour
   * wearing a counter. Charging endowment first makes a retirement exactly
   * `freeCash`-neutral while any endowment is left (balance and `remaining` fall by the
   * same amount), and once the endowment is exhausted the excess correctly consumes
   * earnings: at `remaining = 0` a further retirement lowers the balance alone, which is
   * `freeCash` falling by what was burned.
   *
   * A15 survives it because the identity `freeCash = balance − remaining` can only ever be
   * raised by currency ARRIVING, never by currency leaving under any accounting. See the
   * header's four properties.
   */
  retire(principal: PrincipalId, amount: Minor): void {
    if (amount <= 0) return;
    const left = this.remaining(principal);
    if (left <= 0) {
      // Pin the row at zero rather than leaving it absent: absent means the full stake.
      this.rows.set(principal, minor(0));
      return;
    }
    this.rows.set(principal, minor(Math.max(0, left - amount)));
  }

  /** Every row that exists, in canonical principal order. The capture and the audit. */
  all(): readonly EndowmentRow[] {
    return [...this.rows.entries()]
      .sort((a, b) => compareIds(a[0], b[0]))
      .map(([principal, remaining]) => ({ principal, remaining }));
  }

  /**
   * Replace every row. The rollback path and the snapshot adoption path.
   *
   * Clears first, like every other book's `restore`. That is safe here **only** because
   * {@link all} is in the capture — the failure mode `books-in-the-hash` exists to catch is
   * a map that is cleared on restore but absent from `capture`, which makes every aborted
   * tick zero it while the hash never notices. INV-7's fourth mirror is the second road
   * that catches it anyway.
   */
  restore(rows: readonly EndowmentRow[]): void {
    this.rows.clear();
    for (const row of rows) {
      if (!Number.isSafeInteger(row.remaining) || row.remaining < 0) {
        throw new EndowmentError(
          `endowment: ${row.principal} has remaining ${String(row.remaining)}, which is not a count`,
        );
      }
      if (row.remaining > ENDOWMENT_FLOOR_MINOR) {
        // A row above the starting stake is endowment that grew, which is the one thing
        // this counter must never do — it would hand a puppet transferable capital.
        throw new EndowmentError(
          `endowment: ${row.principal} has remaining ${String(row.remaining)} above the ` +
            `${String(ENDOWMENT_FLOOR_MINOR)} it started with; an endowment never grows`,
        );
      }
      this.rows.set(row.principal, row.remaining);
    }
  }
}

export class EndowmentError extends Error {}
