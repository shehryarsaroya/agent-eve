/**
 * **WHY YOU CANNOT TRADE, IN THE ENGINE'S OWN WORDS.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A blind probe with **200,000 currency and 40,116 `ration`** in the MARCHES read this off
 * the live shard:
 *
 *     trade affordances offered ....... 0
 *     market.transferable_minor ....... 0
 *     "endowment" in the observation .. 0 occurrences
 *     header.withheld.count ........... 2   (a venture slot, and demand) — trade NOT mentioned
 *
 * and `header.withheld` closes with *"Nothing you were eligible for has been dropped without
 * this count."* **That promise was false for `trade`.**
 *
 * The rule underneath is correct and deliberate (D7): transferable currency is
 * `balance − endowmentRemaining`, so a principal whose money is all enrolment endowment can
 * transfer nothing, and N free identities cannot become N × 250,000 of capital (A15, HARD
 * RULE 5). **The rule is not the defect. The silence was.** A bare `transferable_minor: 0`
 * beside a six-figure balance, with no `trade` on the menu and no row in the count, is the
 * aggression-capacity defect one day later and one field over: *the resource is discoverable
 * only by exhausting a resource you did not know you had.*
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## Two products, one home
 *
 *   - {@link endowmentStanding} — the standing block `market.endowment`, present at zero and
 *     non-zero, shaped exactly like `header.aggression`: the number, the rule in plain words,
 *     and **what would change it**. That last clause is the one that matters here, because the
 *     intuitive answer is wrong: spending endowment into a world sink unlocks **nothing**
 *     (`retireCurrency` lowers the balance and the counter together, so `freeCash` does not
 *     move), and only being **paid** by another principal does.
 *   - {@link tradeObstacles} — the counted `withheld` rows for a `trade` that is not offered,
 *     each carrying **`place.ts`'s own refusal sentence verbatim** rather than a paraphrase.
 *     A paraphrase is a second home for a rule (HARD RULE 4, scar #1), and this module has
 *     `tradeRefusalFor` — the same `planOrder` the verb runs — precisely so it never needs one.
 *
 * ## Why it is not in `api/observe.ts`
 *
 * The affordance layer, the payload block and the withheld row must agree about what
 * `transferable_minor` means and about why a trade is impossible. Three copies of that
 * reasoning is the shape that let the affordance layer gate a BID on `freeBalance` while
 * `planOrder` gated it on `freeCash` — a real AGT-S2 bug, the server offering an act and then
 * declining it, found on the same read as the silence above.
 */

import type { GoodId, PrincipalId } from '../core/types.js';
import { qty, type Minor, type Qty } from '../core/units.js';
import { ENDOWMENT_GOOD, ENDOWMENT_GOOD_FLOOR_QTY } from '../ledger/endowment.js';
import { Ledger, storesAccount } from '../ledger/index.js';
import type { WorldState } from '../world/state.js';
import type { MarketBook } from './book.js';
import { freeCash, sellableGoods } from './escrow.js';
import type { PublicBook } from './observe.js';
import { tradeRefusalFor, type TradeRequest } from './place.js';
import type { VenueId } from './order.js';

/**
 * The rule, in the words an agent reads. **One home, quoted by the payload and by the test.**
 *
 * Written to defeat the three specific mis-beliefs a bare `transferable_minor: 0` produces,
 * in the order an agent forms them:
 *
 *   1. *"I am broke."* — no: the balance is published beside it, and they differ.
 *   2. *"I should burn some of it to free the rest."* — no, and this is the expensive one. A
 *      retirement is `freeCash`-**neutral**: balance and counter fall by the same amount. An
 *      agent that believes otherwise builds a WORKS it did not want in order to unlock money
 *      that does not unlock.
 *   3. *"Then nothing will ever unlock it."* — no: earning does, one-for-one, because a
 *      payment raises the balance alone.
 */
export const ENDOWMENT_RULE =
  'TRANSFERABLE = balance_minor - remaining_minor. Your enrolment endowment may be SPENT but never ' +
  'SENT: it funds your own work (a WORKS, the Levy, a crossing, a Charge) and cannot reach another ' +
  'principal, because enrolment is free and transferable stakes would price capital in identities ' +
  '(A15). Burning it UNLOCKS NOTHING — a retirement lowers balance_minor and remaining_minor by the ' +
  'same amount, so transferable does not move. Only being PAID does, one-for-one. Being poor does ' +
  'not lock you out; having earned nothing does.';

/** The goods half of the same rule, and the half `agent.md` never stated. */
export const ENDOWMENT_GOODS_RULE =
  'The goods half: the first floor_qty units of endowment_good standing AT ONE VENUE are withheld ' +
  'from SALE for the same reason, so sellable = what you hold there minus floor_qty. Unlike the ' +
  'currency floor this one NEVER FALLS, so a principal that paid its whole allotment to the Levy is ' +
  'still treated as holding it. Everything you produce above the floor sells freely.';

export interface EndowmentStanding {
  /** Your unlocked currency. Pledged stores are out of it; the endowment is IN it. */
  readonly balance_minor: Minor;
  /** How much of {@link balance_minor} is still the stake you were given. */
  readonly remaining_minor: Minor;
  /**
   * `balance_minor - remaining_minor`, republished here so the identity is checkable.
   *
   * The **same call** `market.transferable_minor` makes, never a second subtraction: two
   * derivations would let the field and its own explanation disagree, which is the failure
   * this whole module exists to answer.
   */
  readonly transferable_minor: Minor;
  readonly endowment_good: GoodId;
  /** Units of {@link endowment_good} withheld from sale, per venue. Static: it never falls. */
  readonly floor_qty: Qty;
  /** What you could actually ASK right now, summed over the venues you stand at. */
  readonly sellable_qty: Qty;
  readonly rule: string;
  readonly goods_rule: string;
}

/**
 * The standing block. **Present at zero and at non-zero**, which is the whole point: a field
 * that appears only when a resource is exhausted teaches an agent that the resource appears
 * when it runs out (the exact lesson `header.aggression` had to be built to unteach).
 *
 * Every unit is in its key name. `test/levy/one-word-two-units.spec.ts` catalogues nine sites
 * where a unitless or mis-united field made a real decision wrong, and this block sits one row
 * from `transferable_minor` with a MINOR and a QTY side by side — the exact adjacency that
 * keeps producing them.
 */
export function endowmentStanding(
  ledger: Ledger,
  principal: PrincipalId,
  venues: readonly VenueId[],
): EndowmentStanding {
  const account = storesAccount(principal);
  const balance = ledger.account(account) === undefined ? 0 : ledger.freeBalance(account);
  let sellable = 0;
  for (const venue of venues) sellable += sellableGoods(ledger, principal, ENDOWMENT_GOOD, venue);
  return {
    balance_minor: balance as Minor,
    remaining_minor: ledger.endowments.remaining(principal),
    transferable_minor: freeCash(ledger, principal),
    endowment_good: ENDOWMENT_GOOD,
    floor_qty: ENDOWMENT_GOOD_FLOOR_QTY,
    sellable_qty: qty(sellable),
    rule: ENDOWMENT_RULE,
    goods_rule: ENDOWMENT_GOODS_RULE,
  };
}

/**
 * The menu offers **takes only**, and that is a rule an agent cannot otherwise learn.
 *
 * Every `trade` affordance is an `IOC` limit order against a resting level, because an
 * affordance is a complete copyable act and a resting order is one the agent would have to
 * remember to cancel. Legitimate — but it means that on an **empty book** the menu is empty
 * too, and an agent reading only `affordances[]` concludes the market is closed. It is not:
 * a `GTC` maker order at your own price is legal at any venue you stand in, and on a book
 * with no resting orders it is the *only* thing that can start one.
 *
 * On the live shard the world-wide `market.ticker` is `[]` — **no fill has ever printed** —
 * which is what an economy looks like when nobody can find the door.
 */
export const MAKER_NOTE =
  'the menu offers TAKES only (every trade affordance is an IOC against a level that is already ' +
  'resting), so an empty book means an empty menu. A GTC order at your own price is legal at any ' +
  'venue you stand in and is the only way to start a book that has nothing on it — send `trade` ' +
  '{"operation":"place","venue":…,"good":…,"side":…,"quantity":…,"limit_price":…} yourself.';

export interface TradeObstacleInput {
  readonly ledger: Ledger;
  readonly world: WorldState;
  readonly book: MarketBook;
  readonly principal: PrincipalId;
  readonly tick: number;
  /** The same rows the payload publishes. Never a second solve (scar #1). */
  readonly books: readonly PublicBook[];
  /** `market.at` — venues where a hand of this principal is PRESENT. */
  readonly venues: readonly VenueId[];
  /** Somewhere to name when {@link venues} is empty: this principal's holding. */
  readonly homeVenue: VenueId | null;
}

/** What the ledger and the world are, for a read-only trade check. The `PlaceContext` minus a seq. */
export interface TradeCheckPorts {
  readonly ledger: Ledger;
  readonly world: WorldState;
  readonly book: MarketBook;
  readonly principal: PrincipalId;
  readonly tick: number;
}

/**
 * The `client_sequence` a **hypothetical** order is checked under. Never placed.
 *
 * `planOrder` refuses an order whose id already exists, and the id is
 * `ord:<tick>:<principal>:<client_sequence>`. Check under `0` and any agent that really placed an
 * order this tick under sequence 0 has its *next* affordance suppressed by a collision that has
 * nothing to do with whether the trade is legal. `MIN_SAFE_INTEGER` is a sequence no wire message
 * carries, so the probe id cannot collide with a real one — and if an agent went out of its way to
 * send it, the failure is a suppressed-and-counted offer rather than an offer the verb refuses,
 * which is the safe direction.
 */
export const PROBE_SEQUENCE = Number.MIN_SAFE_INTEGER;

/**
 * ★ **WOULD THE VERB TAKE THIS? THE ONE GATE BOTH THE MENU AND THE COUNT ASK.**
 *
 * Returns `place.ts`'s own `hint`, or `null` when the order would be accepted.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The affordance layer used to decide *its own* affordability — `Math.floor(free / price)` — and
 * `planOrder` decided the real one. Three consequences, all measured or provable:
 *
 *   1. It read the **raw balance** where `planOrder` reads `freeCash`. On the live shard's own
 *      numbers (200,000 free, 0 transferable) the menu would have offered a BID for up to
 *      200,000 that the verb refuses every time. It escaped notice only because the probe's
 *      venue had nothing resting to price against.
 *   2. It never checked **self-cross**, which `planOrder` refuses on A15. An agent whose own ask
 *      is the only level on the book was offered a BID against itself.
 *   3. It never checked the **caps** (`MAX_OPEN_ORDERS`, per-principal), so a principal at its
 *      cap was offered orders that cannot be placed.
 *
 * All three are AGT-S2 — the server telling an agent to do something and then declining — and all
 * three are one bug: two homes for one rule (HARD RULE 4). Asking the gate costs one `planOrder`
 * per candidate and nothing can move: `planOrder` is pure up to its return.
 * ══════════════════════════════════════════════════════════════════════════
 */
export function tradeCheck(ports: TradeCheckPorts, req: TradeRequest): string | null {
  return (
    tradeRefusalFor({ ...ports, clientSequence: PROBE_SEQUENCE }, req)?.hint ?? null
  );
}

/**
 * Why no `trade` is offered — **in order, and never more than one reason per cause.**
 *
 * Empty means the menu's silence needs no explanation, which happens only when a `trade` really
 * is offered. Every non-empty answer names the binding obstacle first, because an agent handed
 * four simultaneous reasons fixes the wrong one.
 *
 * The refusal sentences come from {@link tradeRefusalFor} — the same `planOrder` the verb runs
 * — so the row cannot drift from the gate. Where no refusal exists (an empty book is not
 * illegal, it is merely untakeable) the sentence says so and names the legal act the menu does
 * not carry, which is {@link MAKER_NOTE}.
 */
export function tradeObstacles(input: TradeObstacleInput): readonly string[] {
  const { ledger, principal, venues, books } = input;
  const ports: TradeCheckPorts = {
    book: input.book,
    ledger,
    world: input.world,
    principal,
    tick: input.tick,
  };
  /** A concrete request the gate can judge. `quantity`/`limit_price` are the legal minimum. */
  const ask = (venue: VenueId, good: GoodId, quantity: number, limitPrice: number): string | null =>
    tradeCheck(ports, {
      operation: 'place',
      venue,
      good,
      side: 'ASK',
      quantity,
      limitPrice,
      durationTicks: null,
      timeInForce: 'GTC',
      order: null,
    });

  // 1. NO VENUE. Nothing else can be true first: a book is local, so with no hand present
  //    there is no book to price against and every other reason is unreachable. The sentence
  //    is `checkVenue`'s own, and it names a real system — this principal's holding — because
  //    "somewhere" is not an actionable answer and `move` needs a destination.
  if (venues.length === 0) {
    const named = input.homeVenue;
    const hint = named === null ? null : ask(named, ENDOWMENT_GOOD, 1, 1);
    return [
      'no trade is offered because you are not standing in a market. ' +
        (hint ??
          'A book is local (§12.1): `move` an IDLE hand to a system and its book comes into ' +
            'market.books[].') +
        ' market.at[] is the venues you can trade at, and it is empty.',
    ];
  }

  const out: string[] = [];

  // 2. NO BOOK. Not a refusal — a maker order is legal — so this is the one row that must
  //    carry a *policy* sentence, and it is the row that closes the economy if it is missing.
  if (books.length === 0) {
    out.push(
      `no trade is offered because no book exists at ${[...venues].join(', ')}: no order of any ` +
        `principal is resting there. This is NOT a refusal — ${MAKER_NOTE}`,
    );
    return out;
  }

  // 3. THE TWO SIDES, each with the gate's own arithmetic. Both are checked because an agent
  //    that can neither buy nor sell needs to know it is two different shortfalls: the buy side
  //    is D7's currency floor and the sell side is D7's GOODS floor, they move for different
  //    reasons, and a single "you cannot trade" would send it after the wrong one.
  let takeable = 0;
  for (const book of books) {
    if (book.levels.ask.length > 0 || book.levels.bid.length > 0) takeable += 1;
  }
  // A book with **no resting order on either side** is visible (`MarketBook.visibleBooks`
  // keeps every `(venue, good)` that has ever printed), so `books` being non-empty does not
  // mean anything is takeable. Left to the loops below this state produces NO row and the verb
  // goes silent again — the exact hole this file exists to close, one level down.
  if (takeable === 0) {
    out.push(
      `no trade is offered because every book you can see (${books
        .map((b) => `${b.good}@${b.venue}`)
        .join(', ')}) has printed before but has NOTHING resting on either side right now. This is ` +
        `NOT a refusal — ${MAKER_NOTE}`,
    );
    return out;
  }
  for (const book of books) {
    const level = book.levels.ask[0];
    if (level === undefined || level.price <= 0) continue;
    const refusal = tradeCheck(ports, {
      operation: 'place',
      venue: book.venue,
      good: book.good,
      side: 'BID',
      quantity: 1,
      limitPrice: level.price,
      durationTicks: null,
      timeInForce: 'IOC',
      order: null,
    });
    if (refusal === null) continue;
    out.push(
      `no trade (BID on ${book.good} at ${book.venue}) is offered: ${refusal} market.endowment ` +
        'carries balance_minor, remaining_minor and the rule that separates them',
    );
    break;
  }
  for (const book of books) {
    const level = book.levels.bid[0];
    if (level === undefined) continue;
    // The gate decides, never a pre-judgement here. A shortfall is the common refusal but it
    // is not the only one — `checkSelfCross` refuses a sale into your own bid on A15, and the
    // caps refuse at `MAX_OPEN_ORDERS` — and a pre-filter on `sellableGoods > 0` would skip
    // exactly the cases where the agent has the goods and still cannot sell them, which is the
    // half of this defect that had no field at all.
    const hint = ask(book.venue, book.good, 1, level.price);
    if (hint === null) continue;
    out.push(
      `no trade (ASK on ${book.good} at ${book.venue}) is offered: ${hint}` +
        // The goods floor is only *named* on the good it applies to, because a paragraph about
        // rations on an `alloy` row is a rule in the wrong place, which is how the currency half
        // of this went unread for the market's whole life.
        (book.good === ENDOWMENT_GOOD && sellableGoods(ledger, principal, book.good, book.venue) <= 0
          ? ` ${ENDOWMENT_GOODS_RULE} market.endowment carries floor_qty and sellable_qty`
          : ''),
    );
    break;
  }
  // ── THE BACKSTOP. It must be impossible to leave here with nothing to say. ──
  //
  // Every branch above is conditional and the union of their conditions is not provably total:
  // a level whose price the affordance layer skipped, a refusal that appeared between the two
  // solves, a good the sizing arithmetic rounded to zero. If any of that happens the verb goes
  // silent again and `withheld`'s closing promise is false again — so the last word is a row
  // that says the true thing (there IS an obstacle and we could not name it) and points at the
  // one act that always answers it: send the order and read the refusal.
  if (out.length === 0) {
    out.push(
      'no trade is offered and the reason is not one of the four this build can name (no venue, no ' +
        'book, nothing transferable, nothing sellable). The gate that decides is `place.ts`: send the ' +
        'order you want and its refusal names the exact shortfall — that costs one action and nothing ' +
        'else. Report it with `discrepancy` if the refusal reads as a bug; a menu that cannot explain ' +
        'its own silence is one.',
    );
  }
  return out;
}
