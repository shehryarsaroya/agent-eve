## Verdict

Keep sealed per-tick batching; reject uniform-price settlement in its current form. Batching solves A4’s latency problem. Uniform pricing creates a new thin-market power problem, weakens market-making, and does not actually eliminate undercutting.

Keep a goods Charge only if its claim is “the world must physically supply this system,” not “the sovereign personally hauls it.” Trade necessarily lets the claimant outsource logistics.

### Severity ranking

1. **S0 — Current Levy plumbing would teleport Charge goods.**
2. **S0 — “Maximise volume” does not define a price and enables marginal-unit manipulation.**
3. **S1 — Uniform clearing removes endogenous compensation for same-tick liquidity.**
4. **S1 — A goods Charge collapses to local procurement for the claimant unless locality, consumption, and provenance are enforced.**
5. **S1 — Two misses followed by automatic lapse is a correlated death spiral, not yet a collapse arc.**
6. **S1 — Free identities currently mint unbound cash and Charge goods.**
7. **S2 — Arrears reset, unlimited stockpiles, deadline corners, and tick-level undercutting remain open.**

There is not yet a live economy to calibrate against: `MARKETS` and `PRODUCE` remain no-ops, while ventures calculate abstract proceeds and mint currency from civic procurement rather than producing or hauling goods ([phases.ts](/Users/shehryarsaroya/Projects/thecompact/engine/src/tick/phases.ts:67), [runtime.ts](/Users/shehryarsaroya/Projects/thecompact/engine/src/sim/runtime.ts:3041)).

## 1. What the call auction loses

The economically important EVE behavior was not 0.01-ISK clicking. It was decentralized payment for keeping capital and inventory immediately available at a venue.

Concrete example:

- Maker rests `BUY 100 @ 98` and `SELL 100 @ 102`.
- An urgent seller and urgent buyer each arrive for 100 units.

In a continuous book, they hit the maker’s quotes. The maker earns `100 × (102−98) = 400` while ending flat.

In a uniform call, the urgent buyer and seller cross each other around 100. The maker is unnecessary and earns zero. The maker fills primarily on one-sided ticks—exactly when it must carry inventory and adverse-selection risk.

Cross-tick dealing can still work:

`expected spread > both-leg fees + inventory risk + capital cost`

But it is no longer reliably paid for presence. At 99/101 with 1% fees on each leg, the 200 gross spread on 100 units is entirely consumed by fees before risk. Cross-venue arbitrage remains viable because goods are located, but that is hauling/warehousing, not local liquidity provision.

What survives:

- Hub formation.
- Regional basis trades.
- Warehousing and hauling.
- Corners and supply warfare.
- Inventory speculation.

What is lost or weakened:

- Same-tick spread income.
- Compensation for standing two-sided depth.
- The price ladder showing executable impact.
- The bid/ask spread as a stress signal.
- Reliable thin-venue liquidity.

Also, undercutting does not die. Suppose demand is 100 units at 110 and two sellers each offer 100 at 100. With marginal pro-rata, each sells 50. One seller changes to 99, receives better-price priority, and may sell all 100 at the same uniform clearing price near 100. Next tick the other seller posts 98. The race is now five-minute undercutting rather than sub-second undercutting.

This directly conflicts with the claim that there is “no queue” and with the existing SPEC’s resting-time priority ([draft](/Users/shehryarsaroya/Projects/thecompact/docs/design/expansion-2026-07-25/DRAFT-1-four-systems.md:51), [SPEC](/Users/shehryarsaroya/Projects/thecompact/docs/design/SPEC.md:423)).

Recommended fix: retain sealed tick batching but execute down the price ladder, with prior-tick resting orders treated as makers. No arrival ordering inside a tick; equal-price marginal fills are quantity-pro-rata. Publish tick VWAP/OHLC instead of insisting on one price.

If uniform pricing is retained, frontier venues need explicit bonded liquidity contracts: minimum two-sided depth, maximum spread, several exposed ticks, inventory limits, and penalties for withdrawal. Reward quote-time, not washable fill volume. The earlier economy pass already describes this mechanism ([liquidity program](/Users/shehryarsaroya/Projects/thecompact/docs/design/eve-passes/PASS-ECONOMY-RISK-extended.md:576)).

## 2. Coordinated manipulation

Call auctions are harder to manipulate with latency, but easier to manipulate with market power because the marginal unit reprices every inframarginal unit.

Using the referenced prior-price tie-break:

- Previous price: 50.
- Supply: 100 units at 50, then one unit at 90.
- Buyer cartel values all 101 units at 100.

Truthful demand:

- Buy 101 at 100.
- Volume: 101.
- Clearing price: 90.
- Payment: `101 × 90 = 9,090`.
- Surplus: `10,100 − 9,090 = 1,010`.

Coordinated demand reduction:

- Cartel bids for only 100 units.
- The balanced clearing price becomes 50.
- Payment: `100 × 50 = 5,000`.
- Surplus: `10,000 − 5,000 = 5,000`.

The cartel refuses one trade worth 10 in order to gain 4,000 on the first hundred units: a net gain of 3,990.

In a continuous price ladder, buying everything costs `100×50 + 1×90 = 5,090`. The final unit does not retrospectively reprice the first hundred, so including it increases surplus by 10.

This attack uses genuine orders and no self-trading. Related-party filtering cannot stop it.

There is also a specification blocker: with a bid at 100 and ask at 50, every integer price from 50 through 100 maximises volume. The draft’s “trivially deterministic” claim is false and violates A2’s requirement for written arithmetic ([A2](/Users/shehryarsaroya/Projects/thecompact/docs/design/SPEC.md:71)).

At minimum specify:

- Candidate prices.
- Volume and imbalance ordering.
- Tie-break against prior price.
- Better-price and marginal allocation.
- Rounding.
- Self-cross treatment.
- One principal’s multiple-order aggregation.
- Reference-mark eligibility.

Best economic fix: batch the book without uniform settlement. Alternative: test a trade-reduction auction where the first excluded bid/ask sets the price and one marginal lot is withheld. Multi-unit and false-identity behavior must be property-tested; McAfee-style truthfulness does not transfer automatically to arbitrary multi-unit schedules.

## 3. Is the Charge really different from currency upkeep?

For the claimant, a tradable Charge of quantity `Q` has cash cost:

`Q × local market price + procurement fees`

So yes, with a deep local book it collapses to “buy locally.” Requiring a parked hand does not change that.

At the world level it remains different if goods are genuinely conserved and located:

- A currency bill can always be paid from a liquid balance.
- An empty local goods book cannot be paid with money.
- Somebody must produce and transport the goods.
- A blockade changes availability and local basis, not merely wealth.

Therefore the defensible claim is “goods force aggregate logistics,” not “goods force claimant logistics.” Outsourced neutral hauling should remain a recovery valve.

The existing Levy attempts a 30% own-hand requirement, but currently verifies only hand presence. It selects any available ration lot in the payer’s stores without checking location, relocates the entire lot, and then burns only the requested portion ([selection](/Users/shehryarsaroya/Projects/thecompact/engine/src/sim/runtime.ts:3606), [relocation](/Users/shehryarsaroya/Projects/thecompact/engine/src/sim/runtime.ts:3621)).

Numeric exploit:

- Store 1,000,000 rations in the core.
- Park one hand at the frontier claim.
- Pay a 10,000 Charge.
- The whole lot relocates; 10,000 burns and 990,000 appears behind the blockade.

A robust Charge contract should require:

- Recipe and quantity fixed at least one Reckoning ahead.
- Exact unencumbered lots already `AVAILABLE` in a dedicated anchor buffer before freeze.
- Atomic split-and-burn at settlement; the Charge handler must never call `relocate`.
- At least one input category not producible in the charged system.
- Lot production-origin provenance that survives trade.
- Multiple substitutes within the imported category, preventing one exact good from holding every claim hostage.
- A raidable buffer capped around two or three Charges, preventing whole-season pre-fuelling.
- If sovereign participation is desired, perhaps 20–30% must actually traverse an inbound lane on a bonded member’s hand after assessment. Verify the carried lot, not merely the hand’s destination.
- Starter-bound goods are ineligible for Charge, bonds, markets, and third-party delivery.

Making the local venue deliberately thin is the worst proposed solution: it produces hostage pricing, not logistics. Combined with uniform clearing and a public deadline, a cartel’s marginal ask reprices its entire inventory.

There is also a current A15 hole: enrolment issues 250,000 ordinary currency and 50,000 rations into normal stores, while lots have no bound-use field ([enrolment](/Users/shehryarsaroya/Projects/thecompact/engine/src/sim/runtime.ts:1423), [lot schema](/Users/shehryarsaroya/Projects/thecompact/engine/src/ledger/lots.ts:39)). Once trade exists, free identities become a Charge-fuel faucet.

## 4. Death spiral or satisfying collapse?

As written, it is a death spiral.

Suppose six claims behind one choke each require 10,000 goods daily and post a 500,000 bond. Holding one choke for two Reckonings makes all six lapse and removes 3,000,000 in bonds plus anchors and productive access. Attacker cost is approximately fixed; defender loss scales with every downstream claim.

The feedback loop is:

`blockade → local shortage → first arrears → public low-fuel signal → suppliers withdraw / attackers concentrate → second miss → bond slash and lost production → less ability to resupply remaining claims`

That is mechanically foreclosed after the first miss. The public gauge makes the second miss more likely, which is good theatre only if meaningful rescue and triage choices remain.

Use a staged state machine:

- `SUPPLIED → STRAINED`: first miss disables upgrades or halves output; burn perhaps 10% of bond into a public emergency-haul bounty.
- Cure with the current Charge plus a bounded surcharge. Do not accumulate impossible back arrears.
- `STRAINED → CONTESTED`: second miss opens the scheduled vulnerability window.
- Lapse requires an attacker to post meaningful stake and win a SIEGE, or a later third miss.
- Allow voluntary cession before freeze with partial bond/anchor salvage so an empire can sacrifice its edge.
- A topology-changing loss grants unaffected claims one rerouting Reckoning.
- Transfer or reclaim must inherit delinquency; arrears attach to the anchor/system epoch, not the current claimant identity.

That produces a satisfying arc: shortage, public distress, relief convoy, political triage, contested collapse. Automatic deletion after two correlated misses produces a solved targeting algorithm.

Also make a claim increase the claimant’s continuous **BOND** requirement; do not use BOND as a one-time claim deposit, contrary to the canonical vocabulary ([SPEC](/Users/shehryarsaroya/Projects/thecompact/docs/design/SPEC.md:127)).

## 5. First fleet exploits

| Design | First tireless-agent play | Required closure |
|---|---|---|
| Auction | Withhold one marginal unit to move the uniform price on every filled unit. | Non-uniform batch ladder or trade reduction. |
| Auction | Undercut one price tick to capture better-price priority while still receiving the common price. | Meaningful tick size, cancel-replace burn, quantity-pro-rata marginal fills. |
| Auction | Submit stair-step one-unit probes across identities to reconstruct hidden depth. | Minimum notional, one aggregate curve per principal/side, accept that active probing defeats secrecy. |
| Auction | Repeat matched high-volume trades to dominate a volume-weighted reference window. | Fees, related-interest netting, per-tick mark caps, minimum independent multi-tick flow. |
| Charge | Reuse the same merely “present” stockpile every Reckoning. | Explicit consumption and exclusive locking. |
| Charge | Reuse the current Levy relocation path to teleport a large remote lot. | Charge consumes only already-local lots; only traversal changes location. |
| Charge | Enrol shells, aggregate their starter currency/rations, and abandon their identities. | Enforced bound-use starter assets. |
| Charge | Transfer/cede/reclaim after first arrears to reset the consecutive-miss counter. | Delinquency follows the anchor/system epoch. |
| Charge | Pre-stock an entire season or corner the mandatory good before the public deadline. | Raidable 2–3 Charge buffer and substitutable imported inputs. |

The core design choice is straightforward: **batching is sound; uniform pricing is not yet sound. Goods upkeep is sound as aggregate physical demand; it is not proof of sovereign self-hauling.**