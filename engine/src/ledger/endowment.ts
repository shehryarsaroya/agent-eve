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
 * ## ★ AND AT `RULES_VERSION` 20, THE GOODS HALF — THE SAME DEFECT, ONE FIELD OVER
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `ENDOWMENT_GOOD_FLOOR_QTY` was `LEVY_STARTER_ALLOTMENT` (50,000) and **static**, so the
 * goods half of D7 was the currency half before 19 with the same shape and the same size of
 * error. Measured over eight seeded worlds at nine Reckonings, 576 observations at the
 * settlement tick (`scripts/d7-sellable-probe.ts`): **123 of 576 hold `ration` and can sell
 * none of it**, and the median holding is 66,791 against a floor of 50,000 — so what was
 * withheld was not "the allotment" but a flat 50,000 off every holding forever. On the live
 * shard `p:probe-scout-01` holds 40,116 at Reckoning ~22 with no production, and its sellable
 * quantity is 0 **permanently**, because a static floor above a static holding never opens.
 *
 * And the repo's own {@link import('../levy/params.js').ENDOWMENT_WINDOW_RECKONINGS} is the
 * measurement that says the allotment is *gone* during the fifth Reckoning — 49,500 · 49,000 ·
 * 29,000 · 9,000 at ticks 287/575/863/1151. Past that the static floor withheld 50,000 units
 * of goods that were provably not endowment: a claim against a balance the principal earned,
 * for a stake it no longer had. `ration` is the good every obligation in the game is priced
 * in, which makes this the most important good in the world being untradeable.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * So {@link EndowmentBook} carries a **second** per-principal counter, `goods`, initialised to
 * `LEVY_STARTER_ALLOTMENT` and decremented only by `Ledger.destroyGoods` — the single door
 * through which goods are destroyed, chosen for exactly the reason `retireCurrency` was: nine
 * call sites destroy goods today (a Levy delivery, a WORKS build, an anchor's fuel, a refine, a
 * hull, a graduation crossing, a Charge, a cargo loss, a seizure) and the tenth is unwritten.
 * `sellableGoods` is `held − goods` rather than `held − LEVY_STARTER_ALLOTMENT`.
 *
 * **The four properties transfer without amendment**, with "retire" reading "destroy" and
 * "transfer" reading "escrow or hand to a buyer": a fresh identity's allotment is withheld in
 * full so it can sell nothing; a destruction is `sellable`-NEUTRAL while any allotment is left
 * and consumes production afterwards; a *sale* never decrements, so what a principal may sell
 * is bounded by what it produced or was paid; and therefore
 * `sellable ≤ produced + received − sent`, always.
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
 *
 * **The goods counter shares the row rather than opening a table**, for the same three
 * wirings and one more: `all()` is already walked by `ledgerStateTable.capture`, by INV-7's
 * fourth mirror and by `restoreTo`, so a second map inside this class is seen by every road
 * that already looks, while a sibling book would be three more places to remember. One
 * consequence is stated so it is chosen rather than discovered: a row now exists as soon as
 * **either** counter has moved, so a principal that has destroyed goods and never retired
 * currency carries a row whose `remaining` is the untouched `ENDOWMENT_FLOOR_MINOR`. That is
 * the value the absent row would have answered anyway, and INV-7's mirror computes the same
 * number from the log, so the two roads still agree.
 */

import type { PrincipalId } from '../core/types.js';
import { minor, qty, type Minor, type Qty } from '../core/units.js';
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

/**
 * The goods minted to each principal at enrolment (§6.1).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS DECLARATION MOVED HERE FROM `levy/params.ts` AT `RULES_VERSION` 38, AND THE MOVE IS THE
 * SECOND HALF OF A FIX WHOSE FIRST HALF SHIPPED AT 20.**
 *
 * The header above records why `ENDOWMENT_GOOD` stopped being an alias of `LEVY_GOOD`: *"it also
 * forced `ledger/` and `works/` to import from `levy/`, inverting the layering — the ledger has no
 * business depending on the Levy for the name of a good."* `test/core/goods-are-independent.test.ts`
 * then made that permanent for the four **good ids** and stopped there. The **quantity** was left in
 * `levy/params.ts`, so `ledger/endowment.ts` kept importing from `levy/` anyway — for the size of the
 * enrolment grant instead of the name of the good, which is the same inversion one field over, and it
 * was the last edge closing the `ledger → levy → ledger` cycle.
 *
 * The ledger is where it belongs on the same argument `STARTER_STAKE` makes directly above: the
 * enrolment mint and the withheld floor must be one number, and this is the module that mints.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * §6.1 mints "a starter stake of **bound goods**"; the build had issued that stake as currency only,
 * so there was nothing located anywhere for a goods-only obligation to be paid in. Two and a half
 * Reckonings' worth of Levy duty: enough that a newcomer can pay, and *not* enough that anybody can
 * pay forever without production. That second clause is the point — a principal that only ever
 * delivers from stock runs dry, and `LEVY SHORT` starts to rise on its own. Which is the meter
 * working, not the model failing.
 */
export const STARTER_ALLOTMENT: Qty = qty(50_000);

/**
 * A principal's withheld allotment of {@link ENDOWMENT_GOOD} **on the day it enrols** — the
 * starting value of {@link EndowmentBook}'s per-principal goods counter, not a constant every
 * principal carries forever.
 *
 * It was the latter until `RULES_VERSION` 20, and the header records what that cost: a floor
 * that never moved while the holding did meant 123 of 576 measured observations held the good
 * every obligation is priced in and could sell none of it, and a principal past the four-
 * Reckoning endowment window was having 50,000 units withheld against a stake it had already
 * delivered. The number is unchanged; what changed is that it is now a starting point.
 *
 * Still declared as an alias of {@link STARTER_ALLOTMENT} rather than as its own literal,
 * for {@link ENDOWMENT_FLOOR_MINOR}'s reason: the allotment granted and the allotment withheld
 * must be the same quantity, and two homes for one number is scar #5.
 */
export const ENDOWMENT_GOOD_FLOOR_QTY: Qty = STARTER_ALLOTMENT;

/**
 * One principal's row. Both counters are monotone non-increasing and neither is ever
 * re-credited.
 *
 * `remaining` is currency in MINOR and `goods` is a count of {@link ENDOWMENT_GOOD} in QTY.
 * Two units one field apart is the adjacency `test/levy/one-word-two-units.spec.ts` catalogues
 * nine real bugs from, so the names carry their units the way the published fields do
 * (`remaining_minor` beside `floor_qty`).
 */
export interface EndowmentRow {
  readonly principal: PrincipalId;
  readonly remaining: Minor;
  /** Units of {@link ENDOWMENT_GOOD} still withheld from sale. */
  readonly goods: Qty;
}

/**
 * What {@link EndowmentBook.restore} accepts, and the one place `goods` is optional.
 *
 * A `RULES_VERSION` 19 capture has rows with no `goods` key at all, and **absent means
 * {@link ENDOWMENT_GOOD_FLOOR_QTY} — maximum withholding**, so such a row reverts its principal
 * to exactly the pre-20 behaviour: a visible loss of selling power, never a silent gain. The
 * asymmetry is deliberate — {@link EndowmentBook.all} always emits the field, so nothing this
 * engine writes can be read back through the lenient branch.
 */
export type EndowmentRowIn = Omit<EndowmentRow, 'goods'> & { readonly goods?: Qty };

/**
 * ★ **THE TWO PER-PRINCIPAL ENDOWMENT COUNTERS.** How much of a principal's balance is still
 * the stake it was given rather than money it earned, and how much of its {@link ENDOWMENT_GOOD}
 * is still the allotment it was given rather than goods it produced.
 *
 * ── WHEN THEY RESET: **NEVER.** ──────────────────────────────────────────────
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
 *   - **Absent ⇒ {@link ENDOWMENT_FLOOR_MINOR} and {@link ENDOWMENT_GOOD_FLOOR_QTY}, which is
 *     MAXIMUM withholding on both counters.** This is the property that makes the whole
 *     structure safe against its own bugs. A row that a prune ate, a restore dropped or an
 *     enrolment forgot reverts the principal to *exactly the pre-19 (currency) or pre-20
 *     (goods) behaviour* — the endowment fully withheld — which is a visible loss of buying and
 *     selling power, not a silent gain. Contrast `standing.ts:334`, where an empty book was
 *     maximum *permission* and therefore had to throw. Here empty is the safe direction, so
 *     rows are created lazily on the first charge and the common case stores nothing at all.
 *
 * **Who reads them:** {@link import('../market/escrow.js').freeCash}, the single gate on the
 * market BID, the sovereignty cession price and the syndicate contribution; and
 * {@link import('../market/escrow.js').sellableGoods}, the single gate on a market ASK. Nothing
 * else. **Who writes them:** `Ledger.retireCurrency` and `Ledger.destroyGoods`, and nothing
 * else — the two doors through which value is destroyed.
 *
 * **Would a test notice either clearing?** Yes, deliberately, and by two roads:
 * `test/ledger/endowment-book.test.ts`'s *"INV-7's fourth mirror"* block mutation-drops the row
 * and asserts a halt on each counter independently, and its *"genuinely IN the hash input"* block
 * proves the capture stops seeing each counter when its key is deleted; and INV-7's fourth mirror
 * recomputes **both** counters from the posting log on **every tick in production**, so a cleared
 * row halts the world rather than quietly re-withholding.
 *
 * ⚑ **This paragraph used to cite `test/durability/books-in-the-hash.test.ts`'s per-book pair, and
 * that citation was wrong.** That file's `BOOKS` list is the seven tables that were in no state
 * table at all — `standing · seal · obligation · event · attribution · mint · delivery` — and
 * `ledger` is not one of them, so nothing there has ever looked at this book. Corrected rather
 * than deleted, because `levy/params.ts` names this exact failure: *a doc pointing at a file
 * nobody can open reads exactly like a test that was never written.*
 */
export class EndowmentBook {
  /**
   * Only principals that have destroyed currency or goods. Absent means "untouched stake and
   * untouched allotment".
   *
   * One map with a two-field value rather than two maps, so the two counters cannot get
   * different lifetimes: a second map would be a second thing for `restore` to clear, for
   * `capture` to emit and for a future prune to miss, and the whole hazard this class is
   * written around is a counter that goes missing in the direction that hides.
   */
  private readonly rows = new Map<PrincipalId, { remaining: Minor; goods: Qty }>();

  /** How much of this principal's balance is still endowment. Never negative. */
  remaining(principal: PrincipalId): Minor {
    return this.rows.get(principal)?.remaining ?? ENDOWMENT_FLOOR_MINOR;
  }

  /**
   * How many units of {@link ENDOWMENT_GOOD} are still the enrolment allotment. Never negative.
   *
   * The goods twin of {@link remaining}, and named for the same reason its published field is:
   * this is a QTY and that one is a MINOR, one method apart.
   */
  remainingGoods(principal: PrincipalId): Qty {
    return this.rows.get(principal)?.goods ?? ENDOWMENT_GOOD_FLOOR_QTY;
  }

  /** The row as it will be captured, materialising the defaults. Internal to the two charges. */
  private row(principal: PrincipalId): { remaining: Minor; goods: Qty } {
    const hit = this.rows.get(principal);
    if (hit !== undefined) return hit;
    const fresh = { remaining: ENDOWMENT_FLOOR_MINOR, goods: ENDOWMENT_GOOD_FLOOR_QTY };
    this.rows.set(principal, fresh);
    return fresh;
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
    // Pin the row even at zero rather than leaving it absent: absent means the full stake.
    const row = this.row(principal);
    row.remaining = minor(Math.max(0, row.remaining - amount));
  }

  /**
   * Charge a destruction of {@link ENDOWMENT_GOOD} against the allotment, allotment-first.
   *
   * The exact twin of {@link retire}, and the argument transfers verbatim with "burn" for
   * "retire": charging production first would keep `goods` high and destroy produced units on
   * paper while the allotment sat untouched, which is the pre-20 behaviour wearing a counter.
   * Allotment-first makes a destruction `sellable`-neutral while any allotment is left (the
   * holding and the counter fall by the same amount), and once the allotment is exhausted the
   * excess correctly consumes production: at `goods = 0` a further burn lowers the holding
   * alone, which is `sellable` falling by what was destroyed.
   *
   * A15 survives it because `sellable = held − goods` can only ever be raised by goods
   * ARRIVING — production, a purchase, a delivery — never by goods leaving under any accounting.
   *
   * **Called for every good, filtered to one.** The caller (`Ledger.destroyGoods`) passes only
   * {@link ENDOWMENT_GOOD}, because that is the only good an allotment is minted in; burning
   * `ore` or `alloy` must not open the ration floor, which would be a cross-good laundering
   * route with no enrolment cost. `test/core/goods-are-independent.test.ts` is the file that
   * keeps the four goods constants from collapsing into one, and this is the same rule stated
   * as behaviour.
   */
  retireGoods(principal: PrincipalId, amount: Qty): void {
    if (amount <= 0) return;
    const row = this.row(principal);
    row.goods = qty(Math.max(0, row.goods - amount));
  }

  /** Every row that exists, in canonical principal order. The capture and the audit. */
  all(): readonly EndowmentRow[] {
    return [...this.rows.entries()]
      .sort((a, b) => compareIds(a[0], b[0]))
      .map(([principal, row]) => ({ principal, remaining: row.remaining, goods: row.goods }));
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
  restore(rows: readonly EndowmentRowIn[]): void {
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
      // ── The goods counter, on exactly the same two rules ──────────────────────
      //
      // ABSENT is lenient and means maximum withholding (see `EndowmentRowIn`), because a 19
      // capture cannot carry a field 20 invented. PRESENT and malformed is a refusal, for the
      // reason the currency side gives: a capture we cannot read is a corrupt triple, and
      // clamping it would publish a number nobody wrote.
      const goods = row.goods ?? ENDOWMENT_GOOD_FLOOR_QTY;
      if (!Number.isSafeInteger(goods) || goods < 0) {
        throw new EndowmentError(
          `endowment: ${row.principal} has goods ${String(goods)}, which is not a count`,
        );
      }
      if (goods > ENDOWMENT_GOOD_FLOOR_QTY) {
        throw new EndowmentError(
          `endowment: ${row.principal} has goods ${String(goods)} above the ` +
            `${String(ENDOWMENT_GOOD_FLOOR_QTY)} it started with; an allotment never grows`,
        );
      }
      this.rows.set(row.principal, { remaining: row.remaining, goods: qty(goods) });
    }
  }
}

export class EndowmentError extends Error {}
