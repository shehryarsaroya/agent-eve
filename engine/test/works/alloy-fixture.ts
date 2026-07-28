/**
 * A fixture that puts `alloy` where a test needs it — and the argument for why that is honest.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE PROBLEM THIS SOLVES.** `ALLOY_ANCHOR_QTY` made every claim in the game depend on a good that
 * **cannot be produced anywhere a claim can exist**: `ALLOY_TIER` is COMMONS and a Commons claim is
 * INVALID rather than refused. So the front door to a single anchor is now
 *
 *   `graduate` → `build {WORKS}` → wait out the spin-up → `refine {kind:"ALLOY"}` → `move` a hand →
 *   `trade` a BID → wait for the MARKETS phase to clear it → `haul` it back, once per lane
 *
 * — several hundred ticks, a counterparty, and a book that clears. That road **is** the feature, and
 * `a-good-only-the-commons-makes.spec.ts` walks all of it end to end, through the HTTP surface, with
 * no fixture at all. That test is where the claim "an outsider can obtain alloy" is earned.
 *
 * Everywhere else it would be a lie dressed as rigour. `the-ground-takes-a-share.spec.ts` is about
 * RENT; `anchored-and-territorial.spec.ts` is about the Charge and the lapse ladder;
 * `cession-endowment.spec.ts` is about D7. Making each of them run a supply chain would (a) make them
 * fail for reasons that have nothing to do with their subject, which is how a suite stops being read,
 * and (b) hide a regression in rent behind a regression in trade.
 *
 * ── WHY IT IS THE PRODUCTION FAUCET AND NOT A BACK DOOR ──────────────────────
 *
 * This posts through `GOODS_FAUCET.PRODUCTION` — **the exact faucet `refine` posts through** — so the
 * ledger, INV-1 and INV-7 see precisely what they would see if the units had been refined in the
 * Commons and hauled in. Nothing here bypasses supply conservation, nothing writes a lot the engine
 * would not write, and a test using this is still subject to every invariant. What it skips is the
 * *journey*, not the *accounting*.
 * ══════════════════════════════════════════════════════════════════════════
 */

import type { EventId, PrincipalId, SystemId } from '../../src/core/types.js';
import { qty } from '../../src/core/units.js';
import { GOODS_FAUCET, storesAccount } from '../../src/ledger/index.js';
import type { Runtime } from '../../src/sim/runtime.js';
import { ALLOY_ANCHOR_QTY, ALLOY_GOOD } from '../../src/works/params.js';

/**
 * Stand `amount` units of {@link ALLOY_GOOD} at `system` in this principal's stores.
 *
 * Defaults to exactly one anchor's worth, because that is what every caller wants and a bigger
 * default would quietly mask a gate that had grown.
 */
export function giveAlloy(
  runtime: Runtime,
  principal: PrincipalId,
  system: SystemId,
  amount: number = Number(ALLOY_ANCHOR_QTY),
): void {
  runtime.ledger.sourceGoods({
    // Tagged `fixture` so a grep over the posting log can tell supplied units from produced ones —
    // a test that could not be distinguished from the real economy in the record would make the
    // record's own audit unreadable.
    eventId: `fixture.alloy:${principal}:${system}:${String(runtime.engine.tick)}` as EventId,
    tick: runtime.engine.tick,
    faucet: GOODS_FAUCET.PRODUCTION,
    to: storesAccount(principal),
    good: ALLOY_GOOD,
    qty: qty(amount),
    location: system,
    origin: principal,
  });
}
