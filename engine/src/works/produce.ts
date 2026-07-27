/**
 * The PRODUCE phase: the world hands over what its places yield — and the ground takes its cut.
 *
 * ## Why this posts EXTRACTION and not PRODUCTION
 *
 * `ledger/accounts.ts` has carried two goods faucets since commit #1. The endowment
 * posts `PRODUCTION` — the world simply making goods appear because a newcomer needs a
 * floor. This posts `EXTRACTION`, because what happens here is a *place* giving up a bounded
 * amount, and the distinction is the one the audit needs: total EXTRACTION over a window is
 * checkable against the map, while total PRODUCTION is checkable against enrolments. Merged
 * into one faucet, neither claim could be tested.
 *
 * ## Why it runs after MARKETS and why the phase order asserts it
 *
 * §15.2's *clear-before-produce*: a job may not buy at market in the same tick it produces,
 * or a principal could see this tick's clearing price and then decide what to make. The tick
 * loop already refuses to start a world whose phase order breaks that, which is why this
 * file only has to fill the slot.
 *
 * ## THE RENT, AND WHY IT IS ONE READ SITE AND NOT A NEW PHASE
 *
 * A claim-holder takes {@link RentTerms.bps} of everything extracted at its system by anyone
 * else (`sovereignty/params.ts:CLAIM_RENT_BPS` carries the argument and the calibration). It is
 * collected **here**, inside the same walk that hands the goods over, for three reasons that are
 * all about the record rather than about tidiness:
 *
 *   - **Nothing can be extracted and then not taxed.** A separate phase reading a stock would
 *     tax whatever survived until it ran, so a tenant could refine or sell between the two and
 *     the landlord's income would depend on the tenant's reflexes — which is A4's forbidden
 *     shape (throughput as power) wearing a rent.
 *   - **The rent is a split, not a transfer.** `rent + net === gross` is checked against the
 *     share the yield cap already fixed, so no rent can mint a unit (`rent.ts`, INV-W4). A
 *     later transfer out of the tenant's stores could not make that guarantee: the stores may
 *     hold goods from ten other sources.
 *   - **It is located where it was dug.** Rent appears at the claimed system, in the landlord's
 *     stores, in the RAW good — never at the landlord's seat. That keeps §10.2's rule intact and
 *     it is what makes a blockade mean something: a landlord whose body has graduated away
 *     collects goods it must come back for, or hire a hand to reach.
 *
 * ## FUEL, AND WHY THE RENT IS GATED ON IT RATHER THAN THE CHARGE
 *
 * A FRONTIER system yields a second good (`params.ts:FUEL_YIELD_PER_TICK`) and a FRONTIER claim
 * burns `ANCHOR_FUEL_BY_TIER` of it once a Reckoning to keep collecting. Both halves are here for
 * the same reason the rent is — this is where the goods move — and three properties are worth
 * stating because each of them was a choice:
 *
 *   - **Fuel is extracted, never rented.** The rent is taken in the raw ORE only. So a landlord
 *     that works none of its own ground receives *no* fuel from its residents and has to buy it
 *     from them, every Reckoning, at a venue where they are the only seller. That is the bilateral
 *     trade with no substitute the economy has never had, and folding fuel into the rent would
 *     delete it.
 *   - **The burn is atomic, and cold is free.** A partial burn would destroy a claimant's fuel and
 *     light nothing, so the port either takes the whole amount or takes none. Being cold costs the
 *     income and nothing else — no arrears, no lapse, no slash (`ANCHOR_FUEL_BY_TIER` carries the
 *     A5′ argument).
 *   - **It re-checks every tick until it succeeds.** Fuel arriving mid-Reckoning lights the anchor
 *     for the rest of it. A once-per-Reckoning check at a fixed phase would make the mechanic turn
 *     on being awake at the right tick, which is A4's forbidden shape.
 */

import type { EventId, PrincipalId, SystemId } from '../core/types.js';
import { qty, type Qty } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import { GOODS_FAUCET, storesAccount, type Ledger } from '../ledger/index.js';
import { tierOf, type WorldMap } from '../world/map.js';
import type { Book, WorksId } from './book.js';
import { FUEL_GOOD, WORKS_YIELD_GOOD } from './params.js';
import { rentApplies, rentOn, type RentTerms } from './rent.js';

export interface ExtractionRow {
  readonly works: string;
  readonly system: string;
  readonly holder: string;
  /** GROSS — what the place handed over, before the ground took its share. */
  readonly qty: Qty;
  /** What the claim-holder of this system took out of it. Zero on unclaimed ground. */
  readonly rent: Qty;
  /** Who took it, or null when nobody did. */
  readonly rentTo: PrincipalId | null;
  /** Units of {@link FUEL_GOOD} this WORKS was handed. Zero outside the Frontier, always. */
  readonly fuel: Qty;
}

/**
 * Everything the rent needs to know about a place, injected rather than imported.
 *
 * The `refine.ts` port pattern, and here it also keeps the layering honest: `works/` has no
 * business importing the sovereignty book to learn who owns the ground, and a direct import
 * would make the production phase untestable without a claim book.
 */
export type RentPort = (system: SystemId) => RentTerms | null;

/**
 * Destroy exactly `want` units of {@link FUEL_GOOD} standing at `system` in the claimant's stores.
 *
 * **All or nothing**, and the return value says which: `true` means the anchor is lit for this
 * Reckoning, `false` means nothing was taken. A port that burned what it found would leave a
 * claimant poorer with a cold anchor, which is the worst of both outcomes and unrecoverable.
 */
export type AnchorFuelPort = (args: {
  readonly claimant: PrincipalId;
  readonly system: SystemId;
  readonly want: Qty;
  readonly tick: number;
}) => boolean;

/**
 * Run one tick of extraction. Returns what was extracted, for the event rows and the frame.
 *
 * Deterministic by construction: systems in `compareIds` order, and within a system the
 * share map is built in canonical WORKS order. Nothing here reads the clock or the RNG.
 */
export function produce(args: {
  readonly book: Book;
  readonly ledger: Ledger;
  readonly map: WorldMap;
  readonly tick: number;
  readonly reckoning: number;
  /** Who takes rent at a system, and at what rate. Absent means nowhere does (tests, and D22). */
  readonly rentAt?: RentPort;
  /** Burns a claim's fuel to light its anchor. Absent means no claim needs fuel. */
  readonly fuelAnchor?: AnchorFuelPort;
}): readonly ExtractionRow[] {
  const { book, ledger, map, tick, reckoning } = args;
  const rentAt = args.rentAt;
  const out: ExtractionRow[] = [];

  for (const system of [...book.workedSystems()].sort(compareIds)) {
    const tier = tierOf(map, system);
    const shares = book.sharesAt(system, tier, tick);
    const fuelShares = book.fuelSharesAt(system, tier, tick);
    // Read ONCE per system, not once per WORKS: the terms are a property of the ground, and
    // asking twice inside a loop is how two tenants at one system could ever be quoted
    // different rates by the same tick.
    const claimed = rentAt === undefined ? null : rentAt(system);
    // ── THE ANCHOR HAS TO BE HOT BEFORE ANY RENT IS TAKEN ────────────────────
    //
    // Resolved once per system per tick, before a unit moves, because the answer decides whether
    // EVERY tenant here pays this tick — and a per-WORKS resolution would burn one Reckoning's fuel
    // once per tenant.
    const terms = collectingAt({ book, claimed, shares, system, reckoning, tick, fuelAnchor: args.fuelAnchor });
    for (const [id, amount] of [...shares.entries()].sort((a, b) => compareIds(a[0], b[0]))) {
      if (amount <= 0) continue;
      const works = book.at(id);
      if (works === null) continue;
      const split = rentOn({ terms, extractor: works.holder, gross: amount });
      // ── THE TENANT'S HALF FIRST, THEN THE LANDLORD'S ────────────────────────
      //
      // Both are EXTRACTION postings against the same share, so the faucet total is unchanged
      // whether or not the ground is claimed — which is what makes "total output is a property
      // of the map" still checkable with a rent in the world (A15, INV-W1).
      if (split.net > 0) {
        ledger.sourceGoods({
          eventId: `works.extract:${id}:${String(tick)}` as EventId,
          tick,
          // The place gave this up, and the audit can compare the total against the map.
          faucet: GOODS_FAUCET.EXTRACTION,
          to: storesAccount(works.holder),
          // RAW. `refine` turns it into the consumable the Levy wants — §10's one build step.
          good: WORKS_YIELD_GOOD,
          qty: split.net,
          // Extracted where it stands, never at the holder's seat. §10.2: everything is
          // located, and goods that appeared at a holding the hand had left would be a
          // located fact that was false — the same error D8 corrected in the Levy.
          location: system,
          origin: works.holder,
        });
      }
      if (split.rent > 0 && terms !== null) {
        ledger.sourceGoods({
          // A DISTINCT event id, because it is a distinct value movement to a distinct account.
          // Reusing the extraction id would collide the moment both halves are positive, which
          // is every tick on claimed ground.
          eventId: `works.rent:${id}:${String(tick)}` as EventId,
          tick,
          faucet: GOODS_FAUCET.EXTRACTION,
          to: storesAccount(terms.claimant),
          good: WORKS_YIELD_GOOD,
          qty: split.rent,
          // At the CLAIMED SYSTEM, not at the landlord's seat. See the header.
          location: system,
          // The origin is the WORKS holder: the goods came out of a place this principal is
          // working, and provenance follows the labour rather than the title.
          origin: works.holder,
        });
        book.creditRent(id, split.rent, reckoning, terms.claimant);
      }
      // GROSS on the WORKS's own counter: the place handed this much over, which is what
      // `extracted` means everywhere else it is read (`worksLines`, `places`, the audit).
      book.credit(id, amount);

      // ── AND THE SECOND GOOD, WHICH ONLY ONE TIER HAS ────────────────────────
      //
      // No rent is taken on it: see the header. It goes to whoever worked the ground, whole, so a
      // frontier resident is the only source of the thing its landlord needs.
      const fuel = fuelShares.get(id) ?? qty(0);
      if (fuel > 0) {
        ledger.sourceGoods({
          eventId: `works.fuel:${id}:${String(tick)}` as EventId,
          tick,
          faucet: GOODS_FAUCET.EXTRACTION,
          to: storesAccount(works.holder),
          good: FUEL_GOOD,
          qty: fuel,
          location: system,
          origin: works.holder,
        });
        book.creditFuel(id, fuel);
      }

      out.push({
        works: id,
        system,
        holder: works.holder,
        qty: qty(amount),
        rent: split.rent,
        rentTo: split.rent > 0 && terms !== null ? terms.claimant : null,
        fuel,
      });
    }
  }
  return out;
}

/**
 * The terms actually in force at a system this tick — `null` if nothing is collected.
 *
 * Separated out and **exported** because the question has three parts and each of them can answer
 * no: is the ground claimed, is anybody but the claimant working it, and is the anchor fuelled.
 * Inline in the loop above it read as a thicket, and this is the one decision in the phase that
 * moves goods *out* of a principal's stores rather than into them — the `refine.ts` argument for a
 * narrow port applies to it exactly: the signature enumerates its reach, and a test can drive every
 * branch without a world or a ledger.
 */
export function collectingAt(args: {
  readonly book: Book;
  readonly claimed: RentTerms | null;
  readonly shares: ReadonlyMap<WorksId, Qty>;
  readonly system: SystemId;
  readonly reckoning: number;
  readonly tick: number;
  readonly fuelAnchor: AnchorFuelPort | undefined;
}): RentTerms | null {
  const { book, claimed, system, reckoning } = args;
  if (claimed === null) return null;
  if (claimed.fuelWant <= 0) return claimed;
  if (book.anchorHot(system, reckoning)) return claimed;

  // Only light it if there is somebody to collect FROM. A lone claimant working its own ground
  // would otherwise burn a Reckoning's fuel to tax itself nothing, which is a rule nobody would
  // have written down on purpose.
  let payer = false;
  for (const id of args.shares.keys()) {
    const works = book.at(id);
    if (works !== null && rentApplies(claimed, works.holder)) {
      payer = true;
      break;
    }
  }
  if (!payer) return null;
  if (args.fuelAnchor === undefined) return null;
  if (!args.fuelAnchor({ claimant: claimed.claimant, system, want: qty(claimed.fuelWant), tick: args.tick })) {
    // COLD. The tenants keep their whole share this tick, and nothing is recorded against
    // anybody — `ANCHOR_FUEL_BY_TIER` carries the argument for why that is the only penalty.
    return null;
  }
  book.lightAnchor(system, reckoning);
  return claimed;
}
