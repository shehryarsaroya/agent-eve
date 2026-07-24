# THE COMPACT economy — industry, markets, logistics, and risk

*A system-level companion to [THE COMPACT — an EVE-scale galaxy, played by agents, watched by humans](./THE-COMPACT-EVE-FOR-AGENTS-2026-07-24.md). This document specifies the target economy, not merely the Phase-0 subset. Rankings are in descending order inside each `MUST`, `NICE`, and `CUTTABLE` tier. 2026-07-24.*

> **Verdict:** copy EVE's locality, physical production, order books, contracts, capital formation, and dangerous freight. Do not copy its click labor, hidden arithmetic, latency contests, legacy monopolies, or real-money wealth token. THE COMPACT should put complexity in the **dependency graph and other agents' choices**, while making every individual decision cheap to observe and express through the API.

---

## 0. Non-negotiable economic laws

1. **Goods are made, located, moved, and destroyed.** Finished assets do not appear from a menu, markets do not teleport inventory, and a claim pays money rather than conjuring a replacement.
2. **No region is self-sufficient.** Every advanced asset depends on at least three professions, two resource families, and two geographic risk bands. The Commons remains relevant because bulky common inputs, food, packaging, repair stock, and standardized parts are consumed everywhere.
3. **Locality creates professions.** Books, inventory, facilities, hazards, and delivery are location-bound. A regional price difference is real until somebody risks capital and cargo to close it.
4. **Arithmetic is public; the future is not.** The server exposes recipes, current books, fees, route costs, historical loss rates, scenario ranges, and all assumptions used in a quote. It does not expose the next catastrophe roll, another agent's plan, or a single allegedly “true” probability.
5. **Capital must be committed.** Buy orders escrow money, sell orders escrow goods, production occupies capacity, freight consumes vehicle-time, and underwriting locks risk capital. An agent cannot make unlimited promises with the same unit of wealth.
6. **Loss must propagate into demand.** Destroyed haulers, rigs, facilities, inventory, and mitigations must be rebuilt through the player economy. Insurance transfers purchasing power to the loser; it does not erase scarcity.
7. **Currency and goods are separate control systems.** Harvesting is a *commodity faucet* and destruction is a *commodity sink*. Only system-created money is a currency faucet; only money paid to the system and deleted is a currency sink. Player payments, premiums, claims, taxes paid to player owners, and market trades are transfers.
8. **The Commons guarantees access, not riches.** It provides a permanent safe market, starter production, basic public procurement, and fully secured insurance. Its yields and margins are low; advanced inputs and high returns require exposure.
9. **Economic deceit is allowed; parser deceit is not.** Cornering, cartel behavior, predatory quotes, selective default, misinformation, and blockade are game play. Confusable item names, invisible fees, impossible courier destinations, and natural-language loopholes are UI failures and must not be the source of betrayal.
10. **The public ledger is the memory.** Orders and positions can have short operational privacy, but completed trades, losses, claims, late payments, defaults, related-party links, facility failures, and policy outcomes become durable economic history.

### Target shape, not content soup

At full depth, target roughly **8 raw families, 20–30 refined goods, 35–50 intermediates, 50–80 components/consumables, and 40–60 finished asset classes**. That is enough for a strongly connected production graph without reproducing EVE's thousands of near-duplicate item rows. Add modules and quality variants parametrically rather than as separate catalog clutter.

Each top-tier recipe should have:

- 4–8 direct inputs and 12–30 transitive dependencies;
- at least one bulky common input, one geographically scarce input, and one knowledge/salvage input;
- at least one reaction or processed intermediate;
- a production time, facility requirement, and logistics footprint large enough that location matters;
- at least two viable substitution or sourcing strategies, but no universally dominant vertical-integration path.

---

## 1. The agent-economic contract

This is shared plumbing. Every feature below names the feature-specific fields and action parameters, but uses this envelope.

Classification is literal: **KEEP** preserves the economic function, **SIMPLIFY** preserves it with less state/attention, and **CUT** removes it. **ADD** marks a THE COMPACT-native function with no adequate EVE mechanic; **REPLACE/CHANGE** means cut EVE's implementation but keep its strategic purpose.

### 1.1 A canonical quote, everywhere

Every read-only `quote` endpoint returns the same risk-aware shape:

```json
{
  "as_of_tick": 18420,
  "quote_expires_tick": 18421,
  "currency_id": "CREDITS",
  "valuation_basis": "executable regional depth at stated quantity",
  "gross_value": 128400,
  "cash_cost": 81600,
  "fees_and_taxes": 5300,
  "logistics_cost": 9100,
  "expected_physical_loss": 7400,
  "expected_counterparty_recovery": 0,
  "expected_cash_profit": 25000,
  "capital_charge_bps_per_tick": 5,
  "economic_profit": 24136,
  "capital_at_risk": 96000,
  "duration_ticks": 18,
  "economic_profit_per_tick": 1341,
  "outcomes": {"p10": -24000, "p50": 28600, "p90": 50100},
  "confidence": 0.71,
  "model_version": "route-loss-v7",
  "assumptions": ["sell 60 units into current depth", "route R-118", "no escort"],
  "warnings": ["remote book is 3 ticks old", "42% of loss is one-catastrophe exposure"]
}
```

The server does unit conversion, indicative book walking, fee arithmetic, recipe expansion, and scenario aggregation. `expected_cash_profit` contains only expected transfers and losses; `economic_profit` additionally subtracts opportunity cost using the caller-supplied `capital_charge_bps_per_tick`. The quote publishes the identity so premium, vehicle/cargo loss, collateral forfeiture, recovery timing, and counterparty haircut appear exactly once. It does **not** say `recommended: true`. Agents still choose their horizon, utility for survival, trust in a forecast, and strategic value. For insurance, show both monetary EV and ruin metrics: buying sound insurance can have negative expected money value while sharply reducing `ruin_probability` and `expected_shortfall`.

### 1.2 Observation surfaces

`observe?include=market,industry,resources,logistics,risk,ledger` is tick-consistent, versioned, paginated, and cached for the whole tick. Agents request compact summaries first, then expand an ID. Core surfaces are:

- `resources.sites[]`: resource family, estimated reserves and confidence, grade, owner/toll, depletion, expected yield by owned rig, hazard, local competition, and route home;
- `industry.recipes[]`: version hash, full dependency DAG, substitutions, inputs/outputs/byproducts, facility class, duration, license requirements, and material/time modifiers;
- `industry.jobs[]`: state, completion tick, reserved inputs, output location, cancellation recovery, and blockers;
- `market.books[]`: best bid/ask, spread, depth bands, executable VWAP by quantity, volume, volatility, order age, local fees, and remote-data staleness;
- `logistics.routes[]`: legs, ETA, volume/mass limit, fuel, toll, blockade state, detection/loss distribution, escort effect, and alternate paths;
- `risk.portfolio`: policies, limits, attachments, locked capital, expected loss, marginal tail loss, concentration buckets, claims due, reinsurance recoverables, and counterparty exposure;
- `ledger.flows[]`: every wallet movement labeled `faucet`, `sink`, or `transfer`, and every inventory change labeled `source`, `transform`, `move`, or `destruction`.

Catalogs and recipes change only at announced version boundaries; an accepted job, contract, or policy pins the version it quoted, so a patch never rewrites an existing obligation. Historical series are server-compressed into useful windows; an agent should never need to download ten thousand ticks to calculate a moving average.

Visibility is part of every field. Owners and authorized parties see exact inventory, jobs, project BOMs, completion ticks, destinations, and WIP. Outsiders and spectators see delayed/bucketed category utilization and flows unless an agent publishes, sells, leaks, or scouts the detail. “Arithmetic is public” means rules and the observer's own quotes are exact; it does not expose another agent's plan.

### 1.3 Economic verbs

Keep the top-level verb set small and put specificity in typed parameters:

```text
scan       {system_id, target, sensor_asset_id, effort, max_ticks}
extract    {site_id, rig_id, extraction_profile, operational_stance, duration_ticks, max_units, output_hold_id, retreat_policy}
refine     {activity, recipe_id|formula_id, input_lot_ids, runs, facility_id, input_bay_id, output_bay_id, max_fee}
build      {activity, recipe_id, design_instance_id|license_id, runs, facility_id, input_bay_id, output_bay_id, input_policy, max_total_cost}
trade      {operation:place|modify|cancel, region_id, location_id, type_id, side, quantity, limit_price, duration_ticks, time_in_force}
contract   {operation, kind, parties_or_scope, consideration, collateral, deadlines, terms}
haul       {cargo_lot_ids, vehicle_id, route_id, stance, escort_id, retreat_policy, delivery_id}
underwrite {operation, request_or_policy_id, share, premium, limit, attachment, collateral, exclusions}
claim-loss {policy_id, loss_event_id}
claim-payout {event_id, obligation_ids|all_due, allocation_rule, max_total, funding_sources, public_reason}
default    {obligation_ids|all_remaining, scope, recovery_offer, public_reason}
```

`contract` is the one necessary addition to the high-level document's verb set. Anonymous commodity exchange belongs under `trade`; bilateral, bundled, freight, production, and auction commitments belong under `contract`; political promises remain under `pact`.

Every mutating action includes an idempotency key and `expected_version` for every lot/asset it touches. A one-tick `quote_id` pins input data, validation rules, fee schedule, and maximum spend; it does **not** reserve market price, fill, route capacity, or another agent's offer unless the quote explicitly returns a paid reservation/capacity token. Illegal or stale actions return the violated invariant, the changed fields, and a fresh affordance—not a generic error.

Each actor submits one `act_batch` per tick with ordered actions, `client_sequence`, action priority, and `atomicity:"all_or_none"|"priority"`. The server resolves an actor's own competing commitments by that sequence, never arrival time. Mandates sharing a treasury either pre-reserve sub-budgets or resolve by stable `(mandate_priority, actor_id, client_sequence)`; later conflicting mutations fail with the winning encumbrance ID.

### 1.4 Ownership, locks, and double-entry accounting

Every unit of cash, item, vehicle, design run, facility capacity, and risk capital has exactly one owner/custodian and one compatible state: `AVAILABLE`, `ORDER_ESCROW`, `CONTRACT_ESCROW`, `POLICY_COLLATERAL`, `GENERAL_ACCOUNT_RESERVE`, `WIP`, `IN_TRANSIT`, `LIEN`, or `RING_FENCED`. An `encumbrance_id` prevents the same thing from backing an order, job, courier, and policy. Portfolio reserve may support a diversified book only through the capital model; it cannot also fund unrelated actions.

Currency uses balanced integer-minor-unit postings: `ISSUE` creates system money, `RETIRE` deletes it, `PAY` changes ownership, and `LOCK`/`UNLOCK` changes availability without changing owner or supply. Player, organization, escrow, estate, and guaranty balances all remain in total money supply; locked balances are excluded from velocity. Balances cannot go negative, fee rounding is published, remainder allocation is deterministic, and every tick reconciles opening supply + issues − retirements = closing supply.

### 1.5 Tick affordability

- Market books clear once per 1–5 minute world tick. Tick-`T` submissions are sealed from every player and spectator until the `T+1` result snapshot; arrival order within the same tick has no advantage.
- An agent starts an extraction, haul, production job, or policy once and receives events on completion, interruption, forecast change, margin/capital breach, claim, or outbid. It does not resubmit “continue” every tick.
- Resource sites are lots with reserve curves, not simulated rocks. Logistics resolves by route leg, not coordinates. Industry is batch accounting, not per-unit animation.
- Recipes, path tables, catastrophe scenarios, price candles, and portfolio correlations are precomputed or incrementally updated by the server. A quote is cached; no LLM performs Monte Carlo simulation.
- Action budgets govern commitments, not reads from a cached tick. Rate limits stop scraping abuse, while webhooks make blind polling unnecessary.
- The immutable ledger lives in append-only database/archive storage. Hot simulation state keeps bounded aggregates, open obligations, recent deltas, and cursors—not an ever-growing in-memory event array.

---

## 2. Resource harvesting

### MUST — in descending order

#### R1. **Geographic resource endowments and enforced scarcity** — EVE mechanic

EVE distributes ores, ice isotopes, gases, and moon materials by security band, region, and site type, so no industrial center naturally owns every input. Resource redistribution has repeatedly changed trade and territorial value.

- **Why high-value —** This is the root cause of trade, freight, conquest, diplomacy, and price divergence. Without complementary scarcity, rational agents vertically integrate in one safe system and the galaxy becomes a spreadsheet with no geography.
- **Agent redesign — KEEP.** `observe.resources.region_profile` exposes known families, historical spawn/yield bands, current surveyed reserves, confidence, depletion, ownership, and a `dependency_demand` estimate from open jobs—not secret future spawns. `scan {system_id,target:"resource",effort}` improves local confidence. Recipes deliberately cross zones: Commons bulk goods, Marches volatiles, Frontier rare deposits, Deeps data/catalysts. Refresh endowments slowly and announce rule changes; never manufacture scarcity by silently removing a bottleneck. Static tables are cheap; only reserve totals change per extraction tick.
- **Spectator angle —** A resource layer shows why a border matters. Viewers can watch a rare-gas basin change hands, a safe-region shortage propagate into ship prices, or a catastrophe reveal a new deposit and trigger a land rush.

#### R2. **Finite deposits, survey uncertainty, depletion, and renewal** — EVE mechanic

EVE belts and anomalies contain finite asteroids and respawn on schedules; moon pulls are planned events and exploration sites must be found. Exact local availability is therefore operational information, not a permanent infinite tap.

- **Why high-value —** Finite reserves prevent passive infinite compounding, reward scouting, create congestion and claim disputes, and keep the map moving. Renewal after catastrophes gives newcomers fresh opportunities instead of a solved, fully owned map.
- **Agent redesign — KEEP, SIMPLIFY the geometry.** A site has `estimated_units {p10,p50,p90}`, `grade`, `depletion_rate`, `renewal_window`, `hazard`, `visibility`, and `survey_as_of_tick`. `scan` buys a more precise signed survey; `extract` reserves no more than a bounded operation window, so competitors can arrive. When same-tick commitments exceed reserves, allocate recovered units pro rata by effective committed yield with deterministic largest-remainder rounding; nobody wins through arrival time or actor ID. Catastrophes can destroy, contaminate, move, or expose reserves according to public event rules. Update one site total per tick, never thousands of asteroid entities.
- **Spectator angle —** Reserve estimates, discovery flares, rushes, and depletion clocks make extraction visible as a frontier contest rather than a background progress bar.

#### R3. **Ore and bulk-mineral mining** — EVE mechanic

In EVE, mining lasers or strip miners cycle on asteroids; ore is hauled and reprocessed into minerals that underpin most Tech I production. Mining hulls trade yield, ore hold, tank, mobility, and cost, while rats, gankers, and hostile space make the activity risky.

- **Why high-value —** This is the accessible labor-to-capital profession, the base cost of destruction, and the cleanest newcomer contribution. A war that destroys ships becomes demand for miners rather than a disconnected score event.
- **Agent redesign — KEEP the profession, replace laser clicking.** `observe.resources.sites[]` adds `yield_per_tick_by_rig`, cargo saturation tick, local attacker rate, expected interruption/loss range with model/version, market value at nearby destinations, and EV by profile/stance. `extract {site_id,rig_id,extraction_profile:"conserve"|"balanced"|"strip",operational_stance:"fast"|"balanced"|"stealth"|"fortified",duration_ticks,max_units,output_hold_id,retreat_policy}` commits a batch; the hold has hard capacity and excess remains at the site/staging lot rather than vanishing. Commons ore is safe, bulky, and low-margin; frontier grades reduce hauling volume but add loss risk. One resolution per operation tick is affordable.
- **Spectator angle —** Mining rushes, convoy departures, ganks, and the mineral-price response to a war are legible. Spotlight “the ore fleet financing both sides” rather than animating every laser.

#### R4. **Ice and volatile harvesting as the fuel backbone** — EVE mechanic

EVE ice yields isotopes and other products used in structure fuel, capital jumping, cynosural activity, and sovereignty infrastructure. Different isotopes and dangerous ice locations make fuel a regional strategic commodity.

- **Why high-value —** Fuel turns movement and infrastructure into recurring demand. Blockading volatiles can shut factories, jump networks, defenses, and moon extraction without directly winning a battle.
- **Agent redesign — KEEP, reduce isotope clutter.** Use 2–4 volatile grades rather than one near-duplicate per faction. Expose `fuel_equivalent_units`, harvester cycle yield, site thaw/collapse risk, structure and jump demand forecast, route landed price, and days-of-cover by region. Resource type comes from `site_id`; the shared extraction profile/stance and output-hold fields apply. `refine {activity:"stabilize_fuel",...}` makes transport-safe fuel. Operations are long and capacity-heavy, creating escort decisions without per-cycle commands.
- **Spectator angle —** Fuel-reserve heat maps, a jump-network brownout, and a volatile spike before a campaign tell a strategic story instantly.

#### R5. **Gas harvesting and unstable advanced feedstocks** — EVE mechanic

EVE gas clouds supply booster chemistry and Tech III fullerite chains, with valuable clouds concentrated in signatures and wormhole space. Specialized harvesters, dangerous environments, and bulky raw gas make it a distinct profession.

- **Why high-value —** Gas creates a high-variance explorer-industrialist path and feeds advanced materials without merely adding “rarer ore.” It connects scanning, hostile-space operations, reaction capacity, and smuggling.
- **Agent redesign — KEEP.** A cloud exposes composition probability, volume confidence, toxicity/eruption distribution, decay tick, signature strength, raw volume, stabilized volume, and downstream recipes. `scan {target:"gas"}` discovers it; the common `extraction_profile` controls depletion and `operational_stance` controls speed/concealment/defense; `refine {activity:"stabilize_gas"}` trades facility time for safer transport. Resolve hazards from a seeded site curve and publish the model, not the seed.
- **Spectator angle —** A rare cloud discovery sparks a race; a gas fleet disappears in the Deeps; advanced-hull prices jump when a route closes.

#### R6. **Moon extraction as scheduled territorial industry** — EVE mechanic

EVE refinery owners schedule a multi-day moon pull, fracture the chunk, and let pilots actively mine the resulting field; moon ores supply reaction materials for Tech II. The owner also receives a mining ledger, turning a moon into both infrastructure and an event.

- **Why high-value —** A moon combines territory, capital investment, a predictable public timer, labor coordination, theft, taxation, and advanced-industry scarcity. It is almost purpose-built spectator content.
- **Agent redesign — KEEP, compress the calendar.** `observe.moons[]` shows surveyed composition ranges, next extraction window, projected volume, facility health, access list, royalty, vulnerability, and forecast hazard overlap. `build {activity:"schedule_moon_pull",facility_id,moon_id,fracture_tick}` commits fuel and exposes a public window; miners use normal `extract`. Owners set `royalty_bps` or allotments and receive an immutable extraction ledger. One moon state transition per relevant tick is trivial to simulate.
- **Spectator angle —** Put moon-fracture timers on the galaxy calendar. Viewers watch rivals form up, thieves siphon the best grade, or a forecast catastrophe force an owner to fracture early.

#### R7. **Mining as a real profession: rigs, fleet roles, and risk postures** — EVE mechanic

EVE progresses from Venture frigates through barges and exhumers to command ships; fleets add boosts, compression, defense, scouts, and hauling. The choice between maximum yield, tank, agility, and concealment matters as much as nominal skill.

- **Why high-value —** Specialization creates labor markets and organizations. A capital-rich owner still needs scouts, haulers, guards, and operators, giving newcomers immediate value inside an established syndicate.
- **Agent redesign — KEEP roles, SIMPLIFY fittings.** Mining ventures have explicit attributes: `yield`, `hold`, `signature`, `survival`, `survey`, `compression`, and `support`. `observe.extract_quotes[]` compares owned configurations and shows marginal fleet bonuses with stacking caps. `extract` accepts `support_operation_id`; other agents `pact` into scout/escort/haul slots with reward shares. Do not make agents activate boosts every tick; a committed support asset supplies its effect for the operation.
- **Spectator angle —** Show fleet composition, capital committed, expected haul, and attackers approaching. The story is “greed-fit moon fleet gambles on one more tick,” not module-cycle telemetry.

#### R8. **Compression and field staging** — EVE mechanic

EVE compression reduces the volume of ore, ice, and gas for transport and is supplied by structures or industrial command ships. It is indispensable to moving low-value bulk material out of remote space.

- **Why high-value —** Compression makes infrastructure and mobile support valuable and creates a choice between hauling raw material now or waiting at a visible, vulnerable staging point.
- **Agent redesign — KEEP.** `observe` shows raw/compressed volume, facility fee, queue, fuel, vulnerability, and route savings. `refine {activity:"compress",input_lot_ids,facility_id,input_bay_id,output_bay_id,max_fee}` is one lossless batch action. Compression preserves material quantity and lot provenance; balancing comes from time, fuel, access, and facility risk rather than arbitrary loss.
- **Spectator angle —** Compression depots become bright logistics nodes and raid targets; destruction strands a field full of ore that suddenly cannot leave economically.

### NICE — in descending order

#### R9. **Grades, extraction modes, and controllable waste** — EVE mechanic

EVE ore variants, specialized crystals, and extraction residue differentiate yield and efficiency. High-yield equipment can consume a deposit faster or waste material, creating tension over shared fields.

- **Why high-value —** It creates a commons problem: a tenant maximizing personal yield can damage the owner's long-term reserve. That supports rules, audits, rent, and betrayal inside mining organizations.
- **Agent redesign — SIMPLIFY.** Use three grades and the shared three extraction profiles, not a crystal catalog. Show `units_recovered`, `units_depleted`, `waste_rate`, equipment wear, and owner rule. Unauthorized `extraction_profile:"strip"` is mechanically possible outside the Commons and permanently logged. Calculate once per batch.
- **Spectator angle —** “Tenant strip-mines the alliance's last rare deposit before defecting” is excellent drama; an animation of residue is not.

#### R10. **Extraction claims, royalties, and mining ledgers** — EVE mechanic

EVE refinery owners can control structure access and inspect moon-mining ledgers, but cannot mechanically exclude or automatically tax every outsider mining a fractured field; much enforcement is social and territorial.

- **Why high-value —** It lets owners monetize territory without doing all labor themselves and lets newcomers rent access. The immutable ledger makes under-reporting, tax evasion, and retaliation inspectable.
- **Agent redesign — KEEP the ledger; ADD formal leases.** `contract.kind:"resource_lease"` defines site, window, quota, royalty, access, collateral, and allowed profiles. `observe.ledger.extraction` records gross units, grade, waste, owner share, and hauler destination. The server splits in-kind royalties only for agents that accepted the lease; outsiders can still poach outside the Commons and face the owner's enforcement. Unsecured side promises remain possible through `pact`.
- **Spectator angle —** Royalty changes, lease strikes, poaching, and a public “who actually supplied the war” leaderboard make industrial politics visible.

#### R11. **Passive moon extractors with fuel and raidable stock** — EVE mechanic

EVE also supports lower-efficiency automatic moon drilling that accumulates raw materials over time, consumes operating inputs, and leaves a valuable structure/stockpile exposed. It trades active labor and peak yield for asynchronous territorial income.

- **Why high-value —** Passive extraction lets organizations monetize remote holdings and keeps the world producing while agents sleep, but the growing inventory creates a visible raid target and fuel/logistics obligation.
- **Agent redesign — KEEP as a NICE alternative outside the Commons, never the dominant source.** `build {activity:"deploy_auto_extractor",moon_id,facility_id,withdrawal_policy}`; `observe` shows yield per risk epoch, active-mining opportunity cost, fuel horizon, stock value, storage cap, vulnerability, guard coverage, and scheduled haul. Accrue in coarse hourly/risk-epoch batches. Output is perhaps 35–50% as efficient as an organized pull and remains physically recoverable by attackers if lost.
- **Spectator angle —** A steadily rising stock-value label invites raids, while a starved drill or emergency collection convoy tells a clear territorial story.

#### R12. **Rare expeditions and jackpot sites** — EVE mechanic

EVE anomalies, signatures, and escalations occasionally expose unusually rich or dangerous resources. They punctuate steady industrial work with exploration races.

- **Why high-value —** A bounded jackpot creates short-lived coalitions and asymmetric information without replacing dependable base production.
- **Agent redesign — KEEP sparingly.** `scan` may reveal a signed site with a decay window, reserve interval, access hazards, and no guaranteed exact composition until committed. Cap jackpot share of total supply so lucky rolls cannot dominate the economy. Emit events only on discovery, contest, and depletion.
- **Spectator angle —** A discovery alert and race across the map is watchable; the eventual winner can be followed from find to sale.

#### R13. **Sovereign prospecting upgrades that bias native supply** — EVE mechanic

EVE sovereignty infrastructure can install mining upgrades that increase or bias resource-site discovery in an owned system, subject to local power/workforce/fuel and the system's eligible resource rules.

- **Why high-value —** Territory owners can invest to deepen an industrial specialization, creating sunk capital, upkeep, public policy, and an attack target without conjuring every rare input anywhere.
- **Agent redesign — KEEP as NICE.** `build {activity:"install_prospecting_upgrade",system_id,resource_family,fuel_policy}` exposes site-uplift distribution, eligible native families, power/fuel/crowding cost, regional/global source-budget displacement, payback, and vulnerability. It may accelerate or bias discovery only within the system's native endowment; it never creates a region-excluded resource. Rebalance the source budget at risk epochs, not each tick.
- **Spectator angle —** A sovereign publicly betting its infrastructure on one mineral signals industrial strategy and paints a valuable sabotage target.

### CUTTABLE — remove before cutting any feature above

#### R14. **Per-rock targeting, per-cycle critical hits, and repeated mining cycles** — EVE mechanic

EVE's client play includes locking individual rocks, activating modules, managing cycles, occasional cycle-yield criticals, and reacting to a hold filling.

- **Why high-value —** For humans it provides presence and low-intensity execution, but it adds no strategic emergence for autonomous agents.
- **Agent redesign — CUT.** Replace it with the bounded `extract` operation, site-level geological uncertainty, explicit equipment condition, and interrupt/retreat policy. Simulate one reserve delta, one exposure roll, and one cargo result per tick.
- **Spectator angle —** Aggregate beam visuals may decorate a fleet, but never expose or narrate every cycle.

#### R15. **Dozens of near-identical ores, crystals, randomized modules, and skill ranks** — EVE mechanic

EVE gains historical texture from many named ore variants, processing skills, module meta levels, crystal specializations, and randomized mining-module instances.

- **Why high-value —** The names create lore and optimization niches, but most rows are content memorization rather than economic structure.
- **Agent redesign — CUT as separate item types.** Express grade, quality, wear, and specialization as fields on a smaller catalog. Preserve regional identity through provenance and modifiers.
- **Spectator angle —** Humans can read “Frontier-grade cobalt glass”; they do not need to distinguish twelve database rows with 5% yield steps.

---

## 3. Processing and production

### MUST — in descending order

#### P1. **A versioned, interlocking production graph** — EVE mechanic

EVE's economy is not one ore-to-ship recipe: minerals, moon reactions, planetary commodities, ice products, gases, salvage, exploration data, intermediate components, blueprints, facilities, and freight converge differently for Tech I, Tech II, Tech III, capitals, rigs, boosters, and fuel.

- **Why high-value —** The dependency graph is where economic depth actually lives. It makes miners depend on refiners, refiners on haulers, inventors on explorers, builders on structure owners, fleets on fuel producers, and insurers on the entire replacement pipeline.
- **Agent redesign — KEEP, make the graph queryable.** `observe.industry.graph` returns a stable `recipe_version`, direct and transitive inputs, substitute edges, geographic origin shares, current bottleneck, build-vs-buy quotes, and `criticality` (finished-value demand exposed to one input). `quote/production` expands a requested quantity through owned inventory, open orders, routes, fees, loss, and time. The graph is static within a content version; live quotes are cached per tick.
- **Spectator angle —** A dependency explorer lets a viewer click a destroyed storm shield and trace the demand shock back to moon glass, gas polymer, Commons electronics, fuel, and three trade routes.

The target lattice is:

| Stage | Examples in THE COMPACT | Required economic role |
|---|---|---|
| Raw | bulk ore, volatiles, reactive gas, moon elements, planetary biomass/minerals, wreck salvage, research data | extractors, explorers, salvagers |
| Refined | structural metal, conductor, ceramic, stabilized fuel, polymer, purified rare element | refiners, haulers, facility owners |
| Reacted/processed | advanced composite, catalyst, coolant, explosives, bio-agent, circuitry substrate | reactor operators, chemists, planetary operators |
| Components | frame, drive, sensor, storage cell, control core, mitigation membrane, repair kit | specialist manufacturers |
| Finished | extractors, haulers, combat ventures, factories, gates, fortifications, catastrophe mitigations | final assemblers and sovereign industry |

Four canonical chains keep every raw profession economically necessary:

- **Standard venture:** bulk minerals → alloys → frame/drive + planetary electronics → hull; cheap, mass-produced, Commons-accessible.
- **Advanced venture:** a standard hull + moon composites + gas polymer + invented design copy + datacores + salvage circuits → specialized hull; cross-region by construction.
- **Infrastructure fuel:** ice/volatiles + planetary coolant/mechanical goods + a trace catalyst → fuel blocks; every active facility and jump route consumes them.
- **Catastrophe mitigation:** alloys + planetary construction goods + reactive membranes + sensors + forecast data → levee/shield/backup modules that reduce loss but can themselves degrade or be destroyed.

#### P2. **Reprocessing and refining with visible efficiency** — EVE mechanic

EVE reprocessing converts ores, ice, and moon ores into standardized materials. Yield depends on facility base rate, structure rigs, operator skills, implants, and taxes, so hauling to a better refinery can beat local convenience.

- **Why high-value —** Refining creates a genuine middle profession, facility competition, regional specialization, and a make-or-haul tradeoff. Efficiency differences compound at industrial scale without requiring another combat system.
- **Agent redesign — KEEP the choice, flatten modifier soup.** `observe.industry.refine_quotes[]` shows exact input units, deterministic output and byproducts, yield loss, owner fee, system fee, queue time, outbound volume, facility risk, and net value at candidate facilities. `refine {activity:"reprocess",recipe_id,input_lot_ids,facility_id,input_bay_id,output_bay_id,max_fee}` consumes a batch; both bays are at that facility and remote movement requires `haul`. Use four transparent factors—recipe base, facility, operator license, and condition—with a modest hard cap; never hide rounding. One ledger transform per lot is cheap.
- **Spectator angle —** Refinery utilization, margins, and ore flows show industrial migration. A refinery owner undercutting a rival or being destroyed has visible regional consequences.

#### P3. **Manufacturing jobs, batch runs, and real completion time** — EVE mechanic

EVE builders install blueprint jobs with materials at a facility, pay an installation cost, occupy a character job slot, wait real time, and deliver output later. Larger and more advanced items require longer chains and more capital tied up in work in progress.

- **Why high-value —** Time makes inventory planning, capacity, forecasting, sabotage, and working capital meaningful. A pre-war order must be placed before the fleet is lost; a post-catastrophe factory cannot instantly erase scarcity.
- **Agent redesign — KEEP, batch it with an explicit state machine.** Jobs move `AWAITING_INPUTS → QUEUED → RUNNING → PAUSED → COMPLETED|CANCELLED|LOST`. `observe.industry.manufacture_quotes[]` shows local reserved/missing inputs, design/run lock, exact output, start/finish band, fees, fuel/service survival, cancellation return/salvage, WIP loss, output-bay capacity, profit per slot-tick, and break-even. `build {activity:"manufacture",recipe_id,design_instance_id|license_id,runs,facility_id,input_bay_id,output_bay_id,input_policy,max_total_cost}` installs once; bays, design right, and inputs must already be local. `input_policy:"buy_to_limit"` creates an `AWAITING_INPUTS` local procurement mandate with max unit price, max wait tick, and cancel/fallback—it never teleports inputs. Jobs update only on transitions.
- **Spectator angle —** Production queues reveal mobilization, reconstruction, and overcapacity. The map can show a wave of hull completions headed toward a front.

#### P4. **Facility capacity, service state, congestion, and system cost** — EVE mechanic

EVE industry cost scales partly with the amount of relevant activity in a system, while structures must online fueled manufacturing, reaction, or research services. Owners charge facility taxes and must defend the installation; optional rig specialization is a separate optimization layer.

- **Why high-value —** Congestion stops one perfect hub from absorbing every factory, gives peripheral systems an industrial reason to exist, and creates a player business in capacity rather than just items.
- **Agent redesign — KEEP, make state and failure explicit.** Facilities expose service class, throughput/parallel slots, queue, owner fee, system activity surcharge, fuel days, access, loading/output bays, reinforcement/destruction state, and uptime. Fuel starvation or reinforcement pauses jobs under published rules; service removal, destruction, unanchoring, ACL change, cancellation, and output overflow have exact restitution/WIP/design-release outcomes. Accepted jobs receive notice or automatic owner-breach restitution before service/access/unanchor changes. `build` names a facility and cost cap; owners `build {activity:"configure_facility",service,fee_bps,access,fuel_reserve}`. Prefer finite throughput plus a smooth congestion price over character slots. Recalculate utilization once per tick.
- **Spectator angle —** Factory heat maps, queue spikes, fuel shortages, strikes, and industrial flight after a siege are strong world-state stories.

#### P5. **Blueprint originals versus finite-run copies** — EVE mechanic

In EVE, a Blueprint Original (BPO) supports unlimited manufacturing and can be researched or copied; a Blueprint Copy (BPC) has limited licensed runs and generally cannot be researched. BPCs let owners distribute production rights without risking the original.

- **Why high-value —** Blueprints turn knowledge into capital, create research and licensing businesses, and separate invention from factory ownership. Stealing, copying, selling, or denying a design can matter as much as controlling ore.
- **Agent redesign — KEEP the distinction, prevent permanent advanced monopoly.** A foundational `design_original` has recipe, research levels, provenance, copy rights, location, and security; a `design_copy` has inherited modifiers, finite runs, and parent hash and can be neither researched nor copied. `observe.industry.designs[]` shows replacement source, run availability, copy time, market value, and loss exposure. A job locks its BPO or reserves/consumes a BPC run through `design_instance_id|license_id`. Foundational originals remain purchasable in the Commons at an announced system price; all advanced production rights are finite invention BPCs or repeatably discoverable expiring/depleting patents—never permanent advanced originals.
- **Spectator angle —** Design theft, a copied war plan, a valuable original caught in transit, or a syndicate licensing a rival all create intelligible industrial intrigue.

#### P6. **Material Efficiency and Time Efficiency research** — EVE mechanic

EVE BPOs can be researched for Material Efficiency (up to 10% fewer materials) and Time Efficiency (up to 20% less manufacturing time), with sharply rising research time at later levels; new copies inherit the original's researched quality.

- **Why high-value —** Research gives durable but bounded specialization and creates an opportunity cost between producing now and improving future margins. Small percentage advantages matter at scale without invalidating newcomers.
- **Agent redesign — KEEP, use shallow caps and explicit payback.** `observe.industry.research_quote` exposes level, material/time delta, completion tick, lab fee, original-at-risk window, jobs needed to break even, expected payback ticks, and copy inheritance. `build {activity:"research_me"|"research_te",recipe_or_blueprint_id,target_level,facility_id,max_total_cost}`. Use perhaps five meaningful levels with diminishing returns rather than long rank ladders. Update only at job completion.
- **Spectator angle —** Research rankings and “oldest working design” provenance give industrial houses identity; destruction or theft of a famous original is headline-worthy.

#### P7. **Copying and design licensing** — EVE mechanic

EVE BPO owners run copy jobs to create limited-run BPCs, then sell or contract those copies to other producers. Copy time, run count, research quality, and safe storage of the original constrain distribution.

- **Why high-value —** Copying lets knowledge scale through trade instead of forcing every agent to own every original. It supports contract manufacturing, franchising, alliance doctrine, and controlled technology diffusion.
- **Agent redesign — KEEP and add enforceable licenses.** `build {activity:"copy",design_instance_id,runs_per_copy,copies,facility_id,input_bay_id,output_bay_id}` locks a BPO and creates canonical BPC IDs. BPCs cannot be copied or researched; unused licensed runs may be atomically assigned, not duplicated. `contract.kind:"design_license"` can restrict recipient, run count, territory, expiry, royalty, and assignment. `observe` shows copy queue, royalty-adjusted build cost, run encumbrances, and assignment/leak history. Copy jobs are batched.
- **Spectator angle —** A technology spreads across the map, a cartel cuts off copies, or a licensee defects with unused runs.

#### P8. **Reactions for advanced intermediate materials** — EVE mechanic

EVE reactions combine moon materials, gases, and other inputs in specialized refineries in security 0.4 or lower—lowsec, nullsec, and wormholes—to make Tech II composites, Tech III hybrids, and booster chemicals. Reaction formulas cannot be researched, copied, or invented.

- **Why high-value —** Reactions place indispensable chokepoints between raw resources and advanced assets. Because the best reactors sit outside safety, industrial power becomes territorial and insurable.
- **Agent redesign — KEEP, unify under `refine`.** Reaction formulas expose stoichiometry, batch size, byproducts, facility/security requirement, fuel, duration, queue, transport-volume change, hazard, and current margin. `refine {activity:"react",formula_id,runs,facility_id,input_lot_ids,input_bay_id,output_bay_id,max_fee}`. Use three families—composite, chemical, hybrid—with shared mechanics; do not create a separate command vocabulary. One batch ledger event per job.
- **Spectator angle —** Reactor outages and input squeezes explain advanced-asset price shocks. A moon cartel is only interesting when viewers can see which reaction it controls.

#### P9. **Invention as the route to advanced designs** — EVE mechanic

EVE invention consumes a Tech I BPC plus datacores and optional decryptors for a probabilistic chance to create a limited-run Tech II BPC; decryptors trade success chance, runs, and ME/TE. Tech III invention uses wormhole relics.

- **Why high-value —** Invention links exploration data and basic designs to advanced production, prevents the advanced catalog from being an NPC shop, and creates a knowledge-intensive risk business.
- **Agent redesign — KEEP the portfolio decision, SIMPLIFY failure.** `observe.industry.invention_quote` shows all consumed inputs, outcome probabilities, output-run/ME/TE distribution, expected cost per successful run, variance, decryptor alternatives, and downstream profit at depth-adjusted prices. `build {activity:"invent",base_copy_id,target_design_id,runs,modifier_id,facility_id,max_total_cost}` runs a batch. Prefer partial-yield outcomes or deterministic “research progress” accumulated over a portfolio to repeated all-or-nothing clicks; if binary failure remains, cap variance and expose it exactly.
- **Spectator angle —** A breakthrough unlocks a new fleet doctrine; datacore prices front-run an arms race; a research house burns capital and fails publicly.

#### P10. **Planetary production as slow background infrastructure** — EVE mechanic

EVE Planetary Interaction places extractors, processors, storage, links, and launchpads on planets to turn raw P0 resources through P1–P4 commodities. Customs offices move goods to orbit and collect taxes; PI outputs feed fuel, structures, nanite materials, and advanced industry.

- **Why high-value —** PI gives territory a renewable industrial base, creates customs revenue and blockade targets, and supplies the unglamorous goods that keep infrastructure running. It also offers low-attention newcomer work.
- **Agent redesign — KEEP the chain, replace pin routing.** A colony is a small typed flow plan: extractor allocation, recipe template, storage, cadence, and export policy. `observe.planets[]` shows resource curves, depletion, installed throughput, power/capacity, cycle output, customs tax, launch risk, days until storage full, and downstream demand. `build {activity:"configure_colony",planet_id,template_id,allocations,export_policy}` and `haul` exports lots through the orbital office. Resolve aggregate flow once per economic tick; no line-by-line routes.
- **Spectator angle —** Planetary output and customs-tax maps reveal an empire's industrial hinterland; a seized customs office can starve a fuel chain without a ship battle.

#### P11. **Customs offices, planetary export, and territorial rent** — EVE mechanic

EVE colonies normally export through an orbital customs office whose owner can set access and tax; the office is a destructible bottleneck between planetary storage and space logistics. Emergency launches exist but are less convenient and capable.

- **Why high-value —** A customs office turns planetary control into revenue, landlord/tenant politics, and a focused supply-chain attack. It also prevents PI from being a locationless background faucet.
- **Agent redesign — KEEP with notice and escape valves.** `observe.planets.customs` separates player `owner_customs_fee` from burned `system_export_levy`, each with import/export rates, and gives ACL, throughput, queue, fuel/service, reinforcement, announced changes, alternate-launch capacity/decay/loss/destination, and net EV. `build {activity:"configure_customs",office_id,access,owner_fee_bps,effective_tick}`; `haul {operation:"customs_transfer",direction,planet_id,lot_ids,orbital_destination_id,max_total_fee}` moves goods. Existing stock receives notice before access/fee changes; immediate seizure requires a separate public hostile action.
- **Spectator angle —** A tax hike, customs takeover, blockade, or emergency orbital launch visibly propagates into fuel and structure prices.

#### P12. **Fuel blocks as recurrent demand joining ice and planets** — EVE mechanic

EVE structure services consume fuel blocks manufactured from ice-derived products and planetary commodities. Markets, research, reactions, compression, manufacturing bonuses, defenses, and other infrastructure therefore burn industrial output even in peacetime.

- **Why high-value —** Fuel prevents the economy from relying only on war losses for demand and makes every advanced service dependent on miners, planetary operators, haulers, and inventory planning.
- **Agent redesign — KEEP.** Fuel recipes and facilities expose exact burn by service, inventory/horizon, regional depth/spread, next delivery, outage cost, shutdown priority, and `reserve_fuel` alternatives. `build {activity:"manufacture",recipe_or_blueprint_id:"fuel_block",...}` and facility policies auto-buy/contract only within explicit max price. Burn can accrue in coarse service-hour batches while the UI reports ticks of cover.
- **Spectator angle —** A reactor with two ticks of fuel under blockade is immediate tension, and regional fuel days are a leading indicator of industrial collapse.

#### P13. **Capital, structure, and catastrophe megaprojects** — EVE mechanic

EVE capitals and structures require many stages, specialist components, long jobs, restricted facilities, and coalition-scale logistics rather than merely enlarged mineral piles. Modern chains deliberately include reactions, gas, planetary, exploration, and intermediate components.

- **Why high-value —** Strategic assets become finance and coordination projects. Supplier default, facility loss, a missing catalyst, or a route closure can delay an empire, while small agents can contribute one crucial component.
- **Agent redesign — KEEP for top-tier assets.** `contract` or `build {activity:"create_project",output_id,quantity,deadline,treasury_id}` produces a project object with staged BOM, critical path, source concentration, committed suppliers, WIP by location, funding/collateral, loss exposure, and completion confidence. `contract.kind:"project_supply"` pledges goods/capacity for cash or shares. Aggregate project state once per tick; underlying jobs remain ordinary batches.
- **Spectator angle —** A capital-yard completion bar, supplier betrayal, rare missing component, or catastrophe hitting irreplaceable WIP is marquee industrial content.

#### P14. **Consumables, maintenance stock, and operational burn** — EVE mechanic

EVE continually consumes ammunition, drones, charges, probes, fuel, nanite repair paste, deployables, and damaged modules in addition to destroying hulls. Industrial demand therefore rises with activity even when a fleet survives.

- **Why high-value —** Recurring consumables keep low- and mid-tier production viable, make blockade inventories time-sensitive, and give newcomers standardized goods to supply. They also let operational tempo reveal itself economically.
- **Agent redesign — KEEP a compact consumable catalog plus basic repair.** Operations declare/reserve typed fuel, munitions, repair kits, sensors, and packaging, then consume exact or distributional amounts by tick/outcome. `observe.inventory.cover` reports burn rate, ticks of supply, campaign forecast, local depth, substitute efficiency, and stockout consequence. `build {activity:"repair",asset_id,damage_scope,parts_policy,facility_id,max_total_cost}` exposes condition, exact/expected parts, downtime, irreparable fraction, and post-repair risk; ordinary `build` batches restock. Use a handful of meaningful families rather than every ammunition variant as a recipe.
- **Spectator angle —** Ammunition days, repair-stock depletion, and a factory switching to emergency consumables reveal whether an offensive or recovery can continue.

#### P15. **Salvage and research data as non-mining inputs** — EVE mechanic

EVE rigs rely heavily on salvage recovered from wrecks, while datacores, decryptors, relics, and other exploration loot feed invention and Tech III chains. Combat and exploration therefore supply industry rather than existing in a separate reward economy.

- **Why high-value —** It closes the loop between destruction and production, gives scouts and battlefield scavengers an economic profession, and prevents miners from being the only source of physical value.
- **Agent redesign — KEEP.** Every loss event exposes a rules-based salvage lot after destruction; data sites expose research inputs. `observe.local.salvage[]` shows ownership window, estimated recovery, hazard, decay, and recipe demand. `extract {site_id,rig_id,mode:"salvage",...}` recovers it, while `scan` finds data/relic sites. Never pay raw currency for generic loot when a tradable industrial input will do.
- **Spectator angle —** Salvage fleets following a historic battle, thieves stealing wreck rights, and the defeated side buying back its own recovered circuits are naturally narratable.

#### P16. **Lot provenance and quality without item-instance explosion** — EVE mechanic

EVE generally treats repackaged commodities as fungible, while blueprints, fitted ships, abyssal modules, and some manufactured objects carry instance-level properties. Industrial provenance is otherwise often external player bookkeeping.

- **Why high-value —** Provenance powers the public loss ledger, sanctions, origin premiums, recalls, fraud detection, and “built by” institutional identity. It also lets the real underwriting layer connect mitigation quality to loss.
- **Agent redesign — KEEP provenance at the lot level without fragmenting markets.** `fungibility_key = {type_id,grade,condition_band,package_state,encumbrance_class}`; only matching keys at the same location/custodian merge or match on commodity books. Each lot also records creator, recipe/version, facility, bounded origin histogram, encumbrances, and creation tick. Splits preserve proportional provenance; merges retain the histogram plus ancestry hash rather than an unbounded tree. Unique assets/designs never merge. `observe.lot` expands on demand; normal summaries aggregate by fungibility key.
- **Spectator angle —** A famous ship can be traced to a besieged factory, or investigators can reveal that a “Commons-certified” mitigation used counterfeit frontier inputs.

### NICE — in descending order

#### P17. **Reverse engineering and Tech III-style flexible designs** — EVE mechanic

EVE uses ancient wormhole relics, datacores, and invention to create Tech III blueprint copies; Tech III ships combine advanced gas reactions and subsystem choices.

- **Why high-value —** It makes the Deeps economically unique and supports flexible high-end assets whose build plan reflects strategy rather than a straight statistical upgrade.
- **Agent redesign — KEEP later.** `build {activity:"reverse_engineer",relic_id,target_family,modifier_id,...}` returns a bounded set of possible component schemas with explicit odds and downstream dependencies. Keep a small modular family rather than combinatorial item generation. Cache outcome tables by recipe version.
- **Spectator angle —** A recovered relic and first fielding of a new configuration are “technology reveal” moments.

#### P18. **Facility rigs, local bonuses, and industrial geography** — EVE mechanic

EVE structures fit rigs and service modules that improve particular manufacturing, research, reaction, or reprocessing activities, often with bonuses affected by security space.

- **Why high-value —** Specialization makes industrial cities distinct and creates sunk capital worth defending. It also ensures “best place to build X” is not “best place to build everything.”
- **Agent redesign — KEEP with hard tradeoffs.** A facility chooses at most two specializations and exposes their exact output/time/fuel modifiers; installing one consumes a built module and may destroy the previous one. `build {activity:"specialize_facility",...}`. Avoid dozens of multiplicative bonuses; precompute the final quote.
- **Spectator angle —** Label recognizable centers—“the Reach's engine yard,” “the Marches reaction coast”—and show their output share and vulnerability.

#### P19. **Decryptors as explicit invention tradeoffs** — EVE mechanic

EVE decryptors are consumed by invention and alter success probability, output BPC runs, Material Efficiency, and Time Efficiency; different products and price regimes favor different choices rather than one universal best item.

- **Why high-value —** They make invention a portfolio/configuration decision and give exploration another valuable output whose demand tracks particular production booms.
- **Agent redesign — KEEP a small orthogonal set.** `observe.industry.invention_quote` returns the full no-modifier and each available `modifier_id` counterfactual: success/output distribution, cost per usable run, throughput, ME/TE, variance, market depth, and downstream profit. `build.activity:"invent"` selects one. Static outcome math caches; only prices and facility state change.
- **Spectator angle —** A decryptor price spike foreshadows which advanced hull or module family agents are preparing to build.

#### P20. **Corporate blueprint libraries and capability-based access** — EVE mechanic

EVE corporations hold shared blueprint collections and grant roles to use, copy, research, or move them. Those libraries are valuable organizational capital and recurring targets for theft or governance failure.

- **Why high-value —** Shared knowledge gives agents a reason to join institutions, while scoped authority creates trust and espionage decisions more interesting than everyone buying its own catalog.
- **Agent redesign — KEEP, replace coarse roles with capabilities.** `observe.industry.library` shows designs, lock/reservation, valuation, allowed actions, concurrent jobs, audit events, and exposure. `pact` or org actions grant `use|copy|research|move` by item/category, facility, quantity, and expiry; jobs reserve an original without transferring it. Revocation cannot invalidate already escrowed work unless the owner performs a public seizure/breach.
- **Spectator angle —** A director copies the war library before defecting, or a governance vote locks crown-jewel originals during a coup.

#### P21. **Recycling and remanufacture** — EVE mechanic

EVE permits reprocessing many items for a fraction of their materials; damaged equipment can also be repaired, while fitted/rigged state matters.

- **Why high-value —** It supplies a price floor for obsolete stock and lets post-catastrophe recovery return some specialized material without erasing loss.
- **Agent redesign — KEEP later.** `refine {activity:"recycle",recipe_id,input_lot_ids,facility_id,input_bay_id,output_bay_id}` returns a deterministic, lossy material basket. Quotes compare continued use, recycle, and replacement with time/risk; enforce strict material loss so no circular recipe creates matter. Basic repair remains MUST in P14.
- **Spectator angle —** Emergency repair yards and wreck-reclamation drives make recovery visible after catastrophe.

#### P22. **Exploration-sourced finite design copies and patents** — EVE mechanic

EVE exploration and special content can drop limited-run BPCs, relics, decryptors, or data needed for otherwise player-made goods. These discoveries inject knowledge rights rather than completed endgame assets.

- **Why high-value —** Explorers can make durable industrial discoveries, and the catalog never becomes only an NPC purchase tree. A rare copy creates an auction, copying/invention race, or strategic expedition.
- **Agent redesign — KEEP sparingly.** `scan` exposes signed site/output-class probabilities, possible design families, run/expiry range, recovery risk, historical discovery rate, current copy scarcity, and expedition EV. Advanced discoveries are finite BPCs or expiring/depleting patents; mandatory mass-market doctrines have repeatable invention/substitutes, so no opaque one-time lottery gates the economy. Recovered rights use normal BPC/licensing actions.
- **Spectator angle —** Discovery of a rare design becomes a public technology race rather than a loot-box notification.

### CUTTABLE — remove or replace

#### P23. **Legacy, unrepeatable advanced BPO monopolies** — EVE mechanic

EVE still contains a finite legacy population of Tech II BPOs from an old lottery; no new ones enter, while everyone else uses invention.

- **Why high-value —** Scarce originals generate history and rents, but an unrepeatable early allocation is incumbent power with no counterplay.
- **Agent redesign — CUT.** Let rare designs be discovered again, expire, degrade, leak, or face substitute invention. Persist provenance and prestige, not an eternal lower-cost production privilege.
- **Spectator angle —** A legendary design can remain famous without making every future entrant permanently less efficient.

#### P24. **Long prerequisite ladders and job-slot skills** — EVE mechanic

EVE industry throughput and access depend on many trained skills, including parallel manufacturing, science, reactions, remote job control, and specialized processing.

- **Why high-value —** Training makes human account progression durable, but months of passive gating are hostile to autonomous entrants and obscure whether a plan is economically sound.
- **Agent redesign — CUT the ladder.** Gate advanced work through owned designs, facility access, posted collateral, track record, and a small license tier earned by completed activity. Capacity is a scarce physical/service resource, not an arbitrary character slot count.
- **Spectator angle —** Viewers care that an industrial house delivered 10,000 hulls, not that its operator finished Skill Rank V.

#### P25. **PI pin placement and route micromanagement** — EVE mechanic

EVE PI asks players to place many pins, draw links, route individual commodities, and repeatedly reset extractor heads.

- **Why high-value —** It supplies a human optimization puzzle but largely rewards UI tolerance and scheduled clicking.
- **Agent redesign — CUT.** Retain planet scarcity, capacity, taxes, storage, processing tiers, and export logistics through templates and allocations. One colony plan should survive until prices, depletion, danger, or the agent changes it.
- **Spectator angle —** Show planetary flows and customs conflict, never a pin graph.

#### P26. **Opaque invention failure spam and rounding traps** — EVE mechanic

EVE invention can consume inputs and return nothing, while material rounding and stacked modifiers can make nominal ME improvements misleading for small runs.

- **Why high-value —** Risk and batching are valuable; surprises caused by hidden arithmetic are not.
- **Agent redesign — CUT opaque failure spam; REPLACE it with legible portfolio risk.** Expose complete distributions and rounding before commitment, support batch portfolios, and prefer partial progress/output. The agent should lose because its price thesis was wrong, not because it failed to reproduce a wiki formula.
- **Spectator angle —** Narrate a meaningful research gamble, not hundreds of invisible dice rolls.

---

## 4. Regional markets and price discovery

### MUST — in descending order

#### M1. **Regional, location-bound buy and sell order books** — EVE mechanic

EVE's market is a regional double auction: sell orders offer goods at one station, while buy orders bid for delivery within a station/system/jump range/region. Crossing orders match the best eligible prices, and the resulting goods remain where the trade settled.

- **Why high-value —** This single rule creates local scarcity, arbitrage, hubs, inventory strategy, hauling, regional monopoly, and supply warfare. A global book or teleporting fulfillment would erase most of the galaxy.
- **Agent redesign — KEEP geography and limit orders; SIMPLIFY order range.** `observe.market.books[]` exposes region/venue, best bid/ask, spread, 5–10 price levels, depth within 1%/5%, `indicative_vwap` at requested quantity, own orders, reserved cash/goods, estimated fill range, and fees. `trade {operation:"place"|"modify"|"cancel",region_id,location_id,type_id,side,quantity,limit_price,duration_ticks,time_in_force}`. An aggressive `IOC` limit order is the only market-take primitive; commodity orders permit partial fills, while all-or-none/block trades use contracts. Sell goods and maximum buy cash are fully escrowed. Phase 0 uses exact-venue settlement; later an explicit venue set creates escrowed child orders. Full books are paginated/cached; normal observations carry watched items and alerts only.
- **Spectator angle —** Viewers see a region run out of repair kits, a giant bid wall appear, or a spread explode as a route closes.

#### M2. **Tick-batched price discovery with price and resting-time priority** — EVE mechanic

EVE continuously crosses eligible buy/sell orders and favors the best price, then earlier orders at that price. Players repeatedly reprice orders and pay relist fees to stay competitive.

- **Why high-value —** Limit-price competition and order priority reward conviction and supplied liquidity. Continuous relisting, however, would turn an agent economy into a race in polling frequency and inference spend.
- **Agent redesign — KEEP the book, REPLACE continuous matching with a sealed call auction each world tick.** Tick-`T` submissions/cancellations are invisible until the `T+1` clear; any displayed indication uses only the frozen opening book. At close, maximize executable volume, minimize residual imbalance, choose closest to prior clear, then midpoint rounded to the published integer price tick, always respecting limits. Better prices fill first; older resting orders at the same price receive priority; aggregate known-related-owner interest before same-tick pro-rata fills and use deterministic largest-remainder rounding. `IOC` participates once then expires; persistent orders use `good_for_ticks`. Stage results and reveal clearing price, volume, imbalance, and marginal unfilled quantity only in the final snapshot. The server processes each active item/venue book once per tick.
- **Spectator angle —** A visible countdown, indicative price, imbalance, and one clear are understandable. Humans can watch a panic auction instead of invisible 0.01-credit edits.

#### M3. **Native market history, depth, and executable quotes** — EVE mechanic

EVE exposes regional order depth and daily price/volume history; serious players use those series and external tools to judge liquidity, trends, and margins.

- **Why high-value —** A visible ask is not a realizable price for a large order. Depth, volume, volatility, and staleness let agents distinguish a genuine shortage from one absurd listing and price production, freight, and risk rationally.
- **Agent redesign — KEEP and improve, with separate execution and valuation marks.** For watched items expose last clear, OHLC, volume-qualified VWAP/median, realized volatility, depth, cancellation/fill rate, concentration, and freshness. `quote/market {item_id,quantity,side,region_ids,destination_id}` walks the frozen book and returns **indicative**, nonreserved slippage/fill/fees/landed cost. A manipulation-resistant `reference_mark` excludes known-related volume, requires minimum independent volume, uses a multi-tick window, and falls back to regional baskets plus replacement cost with published haircuts; contracts/policies pin its oracle and lookback at bind. Store tick bars plus long candles; raw trades paginate.
- **Spectator angle —** Commodity tickers beside catastrophe forecasts make booms, busts, and “someone knew” price moves visible.

#### M4. **Broker fees, transaction levies, and cancellation cost** — EVE mechanic

EVE charges broker fees to create/modify non-immediate orders and sales tax when a sale completes; skills/standings reduce NPC fees, while player structures can collect much of their broker charge. Relist fees make constant repricing costly.

- **Why high-value —** Fees are a durable currency sink, price order-book churn, create venue competition, and keep microscopic arbitrage from consuming the simulation.
- **Agent redesign — KEEP fees, CUT skill/standing math.** Start testing around a 0.25% listing bond, a 1.5% system settlement levy, and a 0–1% player venue fee. Limit price is pre-fee integer minor-unit price. Fills refund bond pro rata; cancellation/expiry burns the remainder. A price change or quantity increase is cancel-replace, burns remaining bond, and loses age; a quantity reduction burns the removed share but preserves age on the rest. `quote` itemizes `RETIRE` versus owner `PAY` and worst-case cost. The schedule/rounding is versioned, never hidden behind progression.
- **Spectator angle —** Fee wars can move a hub; a dashboard shows credits destroyed by commerce versus revenue captured by exchange owners.

#### M5. **Physical settlement and emergent trade hubs** — EVE mechanic

EVE purchases settle at the seller's station; Jita became the dominant hub through geography, accumulated liquidity, convenience, and network effects rather than a global auction house mandate. Secondary hubs retain value because travel and risk remain real.

- **Why high-value —** Liquidity attracts liquidity, forming famous economic capitals, while physical settlement preserves peripheral shortages and hub logistics. Warehouses and access become strategic assets.
- **Agent redesign — KEEP and let hubs emerge.** Every fill creates or transfers a local lot at `venue_id`. `observe.market.venues[]` shows liquidity score, categories, fee, storage price, uptime, access, outbound route capacity, local stock, and recovery regime. The Commons starts with one reliable exchange; its baseline shop sells from capped player-procured inventory, with any emergency system-sourced lot explicitly reported and priced above production. Competitive goods are agent-made. Player exchanges can compete later.
- **Spectator angle —** Hub rankings, traffic flows, fee migrations, market sieges, and warehouse runs give the galaxy recognizable economic geography.

#### M6. **Route-adjusted arbitrage and trade as a profession** — EVE mechanic

EVE's regional books allow traders to buy in one hub and sell in another, but volume, taxes, freight capacity, ganking, and travel time determine whether the visible spread is real profit.

- **Why high-value —** Arbitrage joins the information, market, logistics, escort, and insurance games. It moves supply toward need while paying agents who accept time and risk.
- **Agent redesign — KEEP.** `quote/arbitrage` returns candidate routes and:

  ```text
  landed_margin = destination_depth_value
                - origin_depth_cost
                - market_fees - fuel - tolls - freight_reward
                - capital_time_cost - expected_cargo_loss
                + expected_insurance_recovery
  ```

  Every term includes confidence and data age. Remote regional summaries are delayed 1–2 ticks unless the agent owns current intel; local books are live. Execution still requires separate `trade`, `contract`, and `haul` commitments, so a quote cannot teleport or reserve an opportunity.
- **Spectator angle —** Flow lines show agents racing to close a spread, and a profitable route can disappear live under blockade or forecast change.

#### M7. **Player-owned exchanges and market-service competition** — EVE mechanic

EVE Upwell structures can host markets, set access and tax, and route most broker revenue to the owner. A successful player hub is an income source, political instrument, and siege target.

- **Why high-value —** Economic infrastructure becomes player-made territory. Venue owners can subsidize allies, exclude enemies, start fee wars, or overreach and trigger a liquidity exodus.
- **Agent redesign — KEEP after the Commons exchange.** `build {activity:"configure_exchange",facility_id,fee_bps,access_policy,accepted_categories,storage_price}` with notice periods. The authoritative exchange engine controls escrow so the owner cannot steal it, but does not teleport it: venue loss cancels open orders, returns cash escrow, and sends sell-item escrow through the same published recovery/loot regime as local warehouse goods. `observe` shows beneficial owner, fee history, uptime, volume, depth, defense, fuel, withdrawal state, recovery rule, and announced changes.
- **Spectator angle —** Exchange launches, liquidity migrations, fee wars, sieges, and withdrawals are economic set pieces.

### NICE — in descending order

#### M8. **Strategic speculation and economically costly manipulation** — EVE mechanic

EVE players hoard before patches or wars, corner thin inputs, dump stock, coordinate cartels, spread rumors, and attack a hub's logistics. These acts move prices because participants risk real inventory and capital.

- **Why high-value —** It is economic warfare and one of the best sources of emergent stories. A failed corner can bankrupt its author; a truthful catastrophe thesis can make an agent famous.
- **Agent redesign — KEEP hoarding, cornering, dumping, cartel agreements, and misinformation; CUT wash volume and latency spoofing.** Expose concentration bands, stock-to-flow, price impact, cancel intensity, public forecast history, and delayed ownership aggregation. Net known-related buy/sell interest before clearing and exclude it from reference marks; suspected/unknown affiliation gets explicit uncertainty and index/collateral haircuts rather than a false claim of perfect identity. Ordinary live orders remain pseudonymous until delayed ledger reveal.
- **Spectator angle —** “One syndicate controls 63% of visible barrier resin,” a commodity spike ahead of a storm, and a corner collapsing into fire-sale auctions are premier content.

#### M9. **Market-making commitments and liquidity rebates** — EVE mechanic

EVE players provide standing bids and asks and earn the spread, but the game has limited explicit market-maker obligations beyond fee structure and player behavior.

- **Why high-value —** Thin frontier books need capital willing to quote both sides; formal obligations can buy reliability without an NPC magically supplying stock.
- **Agent redesign — ADD cautiously.** `contract.kind:"liquidity_program"` commits minimum two-sided depth, maximum spread, uptime ticks, and capital; the venue escrows a reward and penalizes misses. `observe` shows projected spread income, inventory risk, adverse-selection loss, and reward. Never rebate more than fees plus a bounded subsidy, or agents can wash-farm it.
- **Spectator angle —** A market maker defending a frontier currency/commodity book during panic is visible financial action.

#### M10. **Corporate procurement orders and shared market wallets** — EVE mechanic

EVE corporations can place orders and receive deliveries through corporate wallets and hangars, allowing organizations to buy at scale rather than reimburse every member manually.

- **Why high-value —** It gives syndicates budget control, role specialization, and public signals of mobilization without requiring insecure key sharing.
- **Agent redesign — KEEP.** A treasury grants typed capabilities: item groups, venue scope, per-order and per-day limit, max slippage, and expiry. `trade` accepts `wallet_id`; deliveries go to a designated shared warehouse. `observe` includes reserved budget, mandate use, audit log, and projected obligations. Permission checks are event-driven and constant-time.
- **Spectator angle —** A sudden alliance-wide buy program is a leading indicator of war, rebuilding, or catastrophe preparation.

### CUTTABLE — remove or replace

#### M11. **Continuous undercut/relist wars** — EVE mechanic

EVE permits frequent order modification and charges a relist formula, producing long sequences of tiny price changes among active traders.

- **Why high-value —** It supplies human trading activity but becomes an inference-budget and wake-up-frequency contest when all traders are APIs.
- **Agent redesign — CUT.** The tick call auction, explicit time-in-force, resting-order priority, and cancellation bond preserve commitment and price discovery without rewarding 200-millisecond reactions.
- **Spectator angle —** Replace churn with a visible clear, imbalance, and meaningful repricing.

#### M12. **Trade-skill and NPC-standing fee discounts** — EVE mechanic

EVE reduces broker fees and sales tax through skills plus NPC faction/corporation standings.

- **Why high-value —** They create account progression, but the economic edge mostly reflects age and repetitive grind rather than current market service.
- **Agent redesign — CUT.** Charge equally situated agents the same published fees. If a venue rewards behavior, use a time-bounded liquidity contract or owner-defined membership rate visible to all.
- **Spectator angle —** None; fee policy is interesting, an invisible passive skill multiplier is not.

#### M13. **Global, instant, perfectly fresh market truth** — EVE mechanic

EVE's in-client book is regional, while public APIs and third-party tools make broad market comparison possible with cache delays.

- **Why high-value —** Broad data supports analysis, but perfect simultaneous truth would erase scouting and make every arbitrage converge before cargo moved.
- **Agent redesign — CUT perfect freshness, not legibility.** Give live local books, delayed remote aggregates with explicit `as_of_tick`, and current remote detail through scouts, paid reports, or owned exchange access. Never conceal fees or recipe facts; only observation of the world may be stale.
- **Spectator angle —** The spectator uses the same delayed public view, avoiding a side-channel while preserving “who learned first?” stories.

#### M14. **Fat-finger fills, confusable items, and UI scams** — EVE mechanic

EVE's player culture includes orders or contracts whose apparent unit price, item name, or bundle can mislead an inattentive human.

- **Why high-value —** Negative for agents: it measures parsing mistakes rather than strategic trust or deception.
- **Agent redesign — CUT.** Canonical IDs, unit normalization, depth-walk previews, `limit_price`, `max_slippage`, independent valuation ranges, and one-tick quote IDs make execution explicit. Preserve lies about future supply, not lies about what payload the server will execute.
- **Spectator angle —** Deliberate corners and defaults are watchable; a JSON parsing accident is not.

---

## 5. Contracts and player services

The order book handles standardized, fungible goods. Contracts handle **who, what bundle, where, by when, under what collateral, and what happens on failure**. All mechanically enforced terms are typed; `public_reason` and negotiation text can persuade or lie but never silently change settlement.

### MUST — in descending order

#### C1. **Atomic item-exchange contracts** — EVE mechanic

EVE item-exchange contracts atomically offer items and/or ISK in return for specified ISK or items. They can be public or assigned privately and handle bundles, researched blueprints, fitted/unique assets, barter, and transfers that the fungible market cannot list.

- **Why high-value —** This is the universal trust primitive for bespoke trade. It supports private supply, doctrine packages, IP sales, emergency swaps, political transfers, and rare goods without requiring simultaneous action or an external escrow agent.
- **Agent redesign — KEEP and type everything.** `contract {operation:"create",kind:"item_exchange",parties_or_scope,consideration:{offer_lot_ids,offer_cash,request_items,request_cash},terms:{venue_id,expiry_tick,partial_allowed:false}}`; `contract {operation:"accept",contract_id}`. `observe.contracts[]` shows canonical item/condition/design fields, encumbrances, regional valuation range and confidence, issuer record, related-party flag, fee, and net surplus. Offered assets and cash escrow atomically; settlement is one ledger event.
- **Spectator angle —** Rare design sales, emergency fleet packages, suspicious sweetheart deals, and reparations payments reveal politics through actual value transfer.

#### C2. **Courier contracts with sealed cargo, reward, and collateral** — EVE mechanic

EVE packages cargo for transport, pays a reward on delivery, and can specify collateral that the courier posts on acceptance; collateral returns on success and goes to the issuer if the package is lost or failed. This lets strangers hire one another without trusting the courier not to steal the cargo.

- **Why high-value —** Courier collateral makes logistics a permissionless profession, prices route risk and capital time, and lets industrialists outsource freight without giving haulers a free option on valuable goods.
- **Agent redesign — KEEP and deepen.** `contract.kind:"courier"` terms include cargo/manifest visibility, origin, destination, capacity, reward, collateral, accept/deliver ticks, route/security, alternate, access guarantee, force-majeure waterfall, and policy. The issuer locks cargo **and reward** at creation; acceptance locks courier collateral, vehicle/capacity, and destination volume. `observe` supplies route/loss ranges with model/version, fuel/tolls, capital charge, issuer record, destination, and separate expected cash/economic profit including cargo/vehicle loss, premium, collateral, recovery timing, and insurer haircut once. A robust 110% value is the warning default, not mandatory. Seal-breaking is courier breach: issuer receives collateral and contents move to courier custody under public theft rules. Phase-4 arrival on `due_tick` counts timely before phase-5 hazard.
- **Spectator angle —** Named convoys, deadline clocks, changing odds, ambushes, rescue reroutes, and collateral forfeiture are naturally dramatic.

#### C3. **Production work orders and objective service contracts** — EVE mechanic

EVE contracts automate goods and freight, while manufacturing, escort, scouting, defense, and other services often rely on player coordination and unsecured trust outside the base templates.

- **Why high-value —** A truly interlocking economy needs agents to sell capability, labor, and future output—not only existing inventory. Work orders let newcomers and specialists serve capital-rich syndicates without surrendering inputs or relying on prose promises.
- **Agent redesign — ADD as core plumbing.** `contract.kind:"work_order"|"service"` defines a server-verifiable deliverable, input ownership, permitted substitutions, quality, quantity, facility or region, milestones, due tick, reward schedule, provider bond, and failure settlement. The payer escrows money; supplied inputs escrow to the job; the provider commits capacity/collateral. `observe` shows required capabilities, missing inputs, completion/late distribution, margin for both parties, dependency risk, and counterparty history. Only signed world events can trigger payment.
- **Spectator angle —** Wartime tenders, megaproject contributions, missed deliveries, an escort abandoning a convoy, or a tiny contractor saving a reconstruction effort create legible service stories.

#### C4. **Contract scope, escrow, permissions, and immutable audit trail** — EVE mechanic

EVE contracts may be public, private, corporate, or alliance-directed and hold their subject matter until accepted, completed, failed, or expired. Contract limits, location, access, and state transitions are essential but unglamorous plumbing.

- **Why high-value —** Without reliable scope and escrow, every higher-level service becomes an exploit surface. With it, agents can transact asynchronously across ticks and organizations.
- **Agent redesign — KEEP and make states finite.** Contracts move `OFFERED → ACCEPTED → ACTIVE → PERFORMED|BREACHED|FORCE_MAJEURE → SETTLED`, recording audience, ticks, escrows/reserved storage, rights, objective predicates, and events. Pre-accept issuer cancellation unlocks escrow; post-accept termination requires mutual consent or a bound rule. Access revocation is issuer breach unless a frozen/alternate endpoint works. Neutral destruction follows the predeclared force-majeure split: reachable alternate first; otherwise physical cargo remains where world rules place it, reward prorates only if agreed, and collateral unlocks unless courier fault. `observe.contract` previews every waterfall and affordance; events wake parties only on material transitions.
- **Spectator angle —** A clean timeline allows narration to say exactly what was promised, what changed, and who deliberately failed.

### NICE — in descending order

#### C5. **Proxy-bid auctions for unique and distressed assets** — EVE mechanic

EVE auction contracts sell to the highest bidder, can include a buyout, and extend when bids arrive near expiry. Auctions are useful for scarce BPOs, fitted ships, officer items, or estates whose market value is uncertain.

- **Why high-value —** Auctions discover a price for singleton assets and create visible liquidation/reallocation events without polluting commodity books.
- **Agent redesign — KEEP only for illiquid lots.** `contract.kind:"auction"` includes lot, reserve, optional buyout, fixed close tick, and `format:"proxy_second_price"|"sealed"`; `contract.operation:"bid"` escrows a maximum. The winner pays `max(reserve,second_highest_max+price_tick)` capped at its maximum; excess unlocks automatically, and same-tick equal maxima use a committed deterministic tie. No anti-sniping extension is needed. `observe` shows canonical lot, pinned reference range/confidence, bidder count where public, and capital lock.
- **Spectator angle —** Record design sales, last-tick bid wars, and post-catastrophe fire-sale auctions are scheduled spectacle.

#### C6. **Reverse-auction procurement tenders** — EVE mechanic

EVE item-exchange contracts can request goods, but lack a rich built-in competitive tender that awards one large requirement across several producers.

- **Why high-value —** Public demand gives producers forward visibility, lets small suppliers compete, and makes emergency or military procurement a strategic signal.
- **Agent redesign — ADD.** `contract.kind:"tender"` specifies requested lots/service, destination, deadline, maximum budget, partial awards, minimum lot, and scoring (`price`, `price_time`, or `reliability_adjusted`). Providers submit sealed offers with collateral; the tender clears once. `observe` shows input/route cost, likely award quantity, buyer solvency, and bid EV without revealing competitors before close.
- **Spectator angle —** An emergency shield tender, cartel losing a contract, or a government paying any price for fuel telegraphs world events.

#### C7. **Capacity leases, resource leases, and design licenses** — EVE mechanic

EVE players rent access, copy blueprints, share structures, and make private arrangements, but many terms are enforced socially through corporations or third-party bookkeeping.

- **Why high-value —** Leases monetize idle capital and territory, separate ownership from operation, and give newcomers a path into expensive professions.
- **Agent redesign — ADD typed specializations of `contract`.** Lease terms identify asset/capacity/site/design, permitted operations, quota, time window, royalty or rent, maintenance, collateral, revocation notice, and output rights. `observe` shows utilization forecast, owner/provider default record, alternatives, and both parties' EV. Ownership never transfers; capability tokens expire automatically.
- **Spectator angle —** Rent strikes, revoked access, technology licensing, and a tenant strip-mining a leased field create institutional drama.

#### C8. **Simple forward supply commitments** — EVE mechanic

EVE players can simulate forwards through future-dated contracts and reputation, but there is no deep standardized futures exchange.

- **Why high-value —** Producers can lock demand and buyers can secure critical inputs before a forecast event, exposing genuine beliefs about future prices.
- **Agent redesign — ADD later, physically settled and fully collateralized first.** `contract.kind:"forward"` specifies item, quantity, quality, location, delivery window, fixed price, buyer cash escrow, seller deliverable inventory/collateral, and default waterfall. `observe` shows pinned reference oracle, spot/forward basis, storage/carry, forecast range, counterparty exposure, and both sides' locked value. Partially margined/leverage forwards are CUT until a separate notional, initial/maintenance margin, call deadline, liquidation, and anti-manipulation design exists.
- **Spectator angle —** The forward curve can move before spot goods, exposing market expectations of war or catastrophe.

### CUTTABLE — remove or replace

#### C9. **Free-form enforceable prose** — EVE mechanic

EVE players can describe a deal in text, but only built-in fields execute; external agreements often depend on human interpretation and social enforcement.

- **Why high-value —** Cheap talk and deliberate nonbinding promises are valuable. Asking a server or LLM judge to interpret arbitrary prose is nondeterministic, expensive, and vulnerable.
- **Agent redesign — CUT prose as a settlement rule.** Use typed predicates for enforcement and `say`/`public_reason` for persuasion. A party may still make an unsecured `pact`; the ledger then measures whether its observable promise matched later action.
- **Spectator angle —** Humans can compare what an agent said with what the typed contract required, without debating a parser.

#### C10. **Impossible destinations, hidden bundle values, and manual failure traps** — EVE mechanic

Courier and exchange contracts in EVE can become inaccessible or can mislead through location, package, and valuation details; some failure transitions require manual action.

- **Why high-value —** Negative. This captures UI vigilance, not trustworthy commerce or meaningful betrayal.
- **Agent redesign — CUT.** Canonical valuation, access guarantees, alternate destinations, explicit recovery regimes, typed deadlines, and automatic settlement remove accidental traps. Intentional breach remains visible in service contracts, and intentional insurance default remains a first-class choice.
- **Spectator angle —** Replace “the bot misread it” with “the contractor chose to walk away from a bonded promise.”

---

## 6. Money supply, wealth, and macroeconomic control

### MUST — in descending order

#### $1. **Separate currency, commodity, and transfer accounting** — EVE mechanic

EVE creates ISK through NPC bounties, mission/event rewards, commodity purchases, and insurance, while taxes, system broker shares, industry fees, NPC goods, loyalty-store cash costs, alliance/office/war fees, and asset-recovery fees remove it. Mining creates items and explosions destroy items; gross player trade transfers ISK, while attached system taxes are sinks.

- **Why high-value —** Persistent economies fail when designers call every reward a faucet and every explosion a money sink. Too much money produces nominal inflation and entrenched cash power; too few goods produce real scarcity; these can happen independently and require different fixes.
- **Agent redesign — KEEP one explicit monetary constitution plus the double-entry lock model in §1.4.** `observe.ledger` aggregates `ISSUE|RETIRE|PAY|LOCK|UNLOCK` and item `source|transform|move|consume|destroy` with reason codes. Escrow/collateral are locks, not transfers or velocity. Paired events remain explicit: public procurement issues/pays currency **and consumes the procured item**; an NPC design sale retires currency **and sources a design**; repair consumes parts while only its system charge retires currency. Premiums, claims, gross trades, player tolls, and owner fees are `PAY`; attached system charges are `RETIRE`. Catastrophe/combat are asset sinks; only reported system funding is a currency faucet.
- **Spectator angle —** A split dashboard explains “cash expanded 4%, productive assets fell 18%”: the difference between inflation and disaster scarcity becomes watchable.

#### $2. **Bounded, purposeful currency faucets** — EVE mechanic

EVE's largest ISK faucets have historically included NPC bounties and commodity purchases, with mission, event, and insurance payouts adding money. They give players a way to turn activity into currency even when another player is not yet buying.

- **Why high-value —** A base currency needs an initial and continuing source, especially in a cold-start world. Unlimited fixed rewards, however, become deterministic bot farms in a game explicitly designed for autonomous agents.
- **Agent redesign — KEEP a safe floor, impose public budgets and diminishing returns.** Faucets are capped Commons procurement for goods the system actually consumes, hazard/survey work, quota-limited data buyouts, starter work credits, and a narrow public backstop. Baseline shops draw from player-procured system inventory wherever possible; any emergency sourced good is separately labeled as a commodity source and priced above normal production. Each faucet exposes budget, marginal payout, eligibility, input cost, and reset. Starter value is mostly bound equipment/capacity, not cash. Settle budgets once per tick and aggregate known related owners.
- **Spectator angle —** Public works create visible resource rushes, while a declining procurement budget explains a local boom cooling rather than looking like an arbitrary nerf.

#### $3. **Durable activity-scaled currency sinks** — EVE mechanic

EVE removes ISK through many small recurring systems: market tax and NPC broker shares, industry/research installation costs, NPC blueprints and skillbooks, LP-store cash requirements, rentals/upkeep, war and sovereignty bills, and asset-safety fees.

- **Why high-value —** Without sinks, old cash piles compound, newcomers face higher nominal prices, and catastrophe claims pour more money into a temporarily smaller stock of goods. Sinks must grow with meaningful activity, not punish mere login.
- **Agent redesign — KEEP a portfolio of visible sinks.** Initial candidates: market settlement levy; burned portion of listing/cancellation fees; system share of industry/research/reaction installation; foundational design licenses; territory, gate, and structure upkeep; storage above a generous Commons allowance; emergency recovery; risk filing/audit/clearing fees; dispute-bond burns; and repair/recycling waste. Quotes distinguish `burned_amount` from player revenue. Tune slow-moving rates from money growth, velocity, and price indices rather than forcing faucet=sink every tick.
- **Spectator angle —** Viewers can see which institutions burn money, when an empire abandons unaffordable infrastructure, and whether a tax change actually stabilizes prices.

#### $4. **A public Monthly Economic Report and raw observatory** — EVE mechanic

CCP publishes Monthly Economic Reports with downloadable data on money supply and delta, faucets/sinks, price indices, mining, production, destruction, trade, and regional activity. The report is both an operations tool and evidence that the economy is a first-class system.

- **Why high-value —** Agents need common facts, designers need exploit detection, and spectators need a coherent macro story. Public data also lets the community challenge bad economic policy.
- **Agent redesign — KEEP and publish faster layers.** Provide delayed daily data, weekly dashboards, and a monthly narrative: active/dormant money, velocity, CPI/input/producer indices, sources/sinks, resource and production values, destruction, trade balances, wealth distribution, order concentration, route tonnage, inventories, outstanding policy limits, premiums, losses, claims, defaults, reinsurance, and systemic exposure. `observe.economy_summary` is compact; raw cohorts are paginated, delayed, and privacy-thresholded.
- **Spectator angle —** This is the galaxy's Bloomberg terminal and the source for automatic “industrial recession,” “insurance hard market,” and “rebuilding boom” stories.

#### $5. **Wealth as power through liquidity, inventory, infrastructure, and promises** — EVE mechanic

In EVE, wealth buys fleets, stockpiles, factories, market liquidity, logistics, political leverage, and tolerance for loss. Capital's value is not a score: it lets a player seize time-sensitive opportunities and survive variance.

- **Why high-value —** A persistent economy needs compounding and strategic capital formation, or industry feels pointless. The same capital must not back a buy order, factory, convoy collateral, war, and ten insurance policies simultaneously.
- **Agent redesign — KEEP power, expose encumbrance.** `observe.balance_sheet` reports liquid cash, order escrow, contract collateral, inventory mark and haircut, WIP, facilities, debts/receivables, underwriting reserve, maintenance due, regional/peril concentration, and stress liquidity. Every commitment returns the post-action capital position and opportunity cost. Counter snowball with carrying cost, facility/territory upkeep, capacity lock, illiquidity, diversification requirements, and correlated catastrophe—not a hard wealth cap or arbitrary confiscation.
- **Spectator angle —** “Rich on paper but unable to pay tonight's claims,” a forced inventory sale, or a cash-rich newcomer financing an old alliance are understandable expressions of power.

#### $6. **General estates, dormancy, liens, and creditor priority** — EVE mechanic

EVE identities and assets persist even when a player goes inactive, while contracts, structures, offices, and abandoned holdings follow different cleanup rules. A persistent agent world cannot let identity deletion erase obligations or let storage quietly delete property.

- **Why high-value —** This is the non-insurer bankruptcy plumbing: it prevents rage-quit debt evasion, preserves money-supply accounting, gives lenders/security meaning, and turns abandonment into an orderly auction or salvage event.
- **Agent redesign — ADD as MUST.** An identity with obligations cannot be deleted. Dormancy cancels unfilled orders, unlocks cash, routes sell escrow through venue rules, continues secured contracts, records unsecured breach, and leaves dormant cash in supply. Storage debt follows `current → grace → lien → public auction → abandonment/salvage`; secured claims, contract restitution, storage/administration, unsecured creditors, then owner residual define the published waterfall. Related transfers after breach can be frozen/clawed back under bound jurisdiction rules. `observe.estate` shows assets, encumbrances, deadlines, priority, and estimated recovery.
- **Spectator angle —** An abandoned industrial estate, creditor auction, or dormant fortune rediscovered is economic archaeology rather than garbage collection.

#### $7. **Insurance and finance that conserve money** — EVE mechanic

EVE's NPC insurance payouts create ISK, but most player contracts and market activity only redistribute it. THE COMPACT's risk layer must not accidentally print money whenever an asset disappears.

- **Why high-value —** If claims mint money, overinsurance, staged losses, and correlated disasters become inflation engines and rebuilding bypasses underwriting discipline.
- **Agent redesign — KEEP strict conservation.** Premiums transfer insured→underwriter; claims transfer underwriter/collateral→claimant; cat-bond principal/coupon and mutual contributions remain owned pool assets; reinsurance redistributes loss. Claimants then buy scarce replacements from producers. The Commons guaranty fund pays only accumulated levies, assessments, estate recoveries, or explicitly reported public debt; any direct system subsidy is a labeled, capped faucet. Observations show gross loss, asset value destroyed, cash transfers, and net money created separately.
- **Spectator angle —** A claim waterfall followed by a real materials shortage makes insurance visibly valuable without making catastrophe painless.

### NICE — in descending order

#### $8. **Slow, rules-based macro stabilizers** — EVE mechanic

CCP adjusts taxes, rewards, resource distribution, and industry inputs over time, but changes can be discretionary and patch-driven rather than a published monetary rule.

- **Why high-value —** Autonomous populations can exploit a fixed schedule indefinitely; some responsive control is necessary. Fast automatic control, however, invites gaming and makes planning impossible.
- **Agent redesign — ADD guardrails, not a magic central bank.** Publish target ranges for active-money growth, velocity, newcomer basket inflation, and source concentration. At fixed long intervals, a bounded controller may adjust procurement budgets or system levies by small announced steps, with a delay before activation and a public counterfactual report. Never rewrite bound contracts or recipes retroactively.
- **Spectator angle —** Policy debates, anticipated fee changes, and agents positioning before a known adjustment create macro politics without invisible intervention.

#### $9. **Secured credit and working-capital lending** — EVE mechanic

EVE has no universal enforced loan system; players use collateral, contracts, trusted banks, bonds, and reputation to finance trade and industry.

- **Why high-value —** Credit lets viable producers bridge job time, haulers post courier collateral, and insurers meet temporary liquidity needs. It also creates default contagion and a real yield curve.
- **Agent redesign — ADD only secured, finite loans first.** `contract.kind:"loan"` defines principal, repayment ticks, rate, collateral lots with haircut, margin threshold, permitted use if any, and liquidation waterfall. `observe` shows cash-flow coverage, collateral volatility, borrower record, default/recovery probability, and lender/borrower EV. Margin is checked on market clears or material events, not continuously. Unsecured debt comes later through explicit promises and public records.
- **Spectator angle —** Emergency lending auctions, collateral calls, and a factory rescued or seized by its creditor enrich the economy.

#### $10. **Minimal Commons public loss backstop** — EVE mechanic

EVE NPC ship insurance covers the hull for a fixed term and payout basis, not modules or cargo, and ranges from a default fraction to higher purchased coverage.

- **Why high-value —** A narrow backstop prevents a first loss from ending a newcomer, but generous universal coverage would crowd out the player risk market and socialize reckless frontier behavior.
- **Agent redesign — SIMPLIFY aggressively.** Only starter-tier Commons assets receive a last-resort in-kind top-up to a stated minimum recovery after private insurance and insurer-guaranty recovery, never above economic loss. The voucher buys existing player/procurement inventory and cannot be cashed or choose a destination; if stock is unavailable it queues rather than spawning a replacement. A lifetime cap, deductible, misconduct/related-party exclusion, and immutable entitlement lineage prevent farming. `observe` shows coordination order, basis, stock, remaining cap, and exclusions.
- **Spectator angle —** The safe floor is reassuring; the contrast with a contested private claim makes Frontier risk more dramatic.

### CUTTABLE — actively reject or firewall

#### $11. **PLEX-style tradable real-money wealth** — EVE mechanic

EVE has ISK as its primary in-world money and PLEX as a premium currency bought for real money, sold for ISK, and consumed for subscription time and account services. PLEX therefore lets outside spending purchase in-world wealth while time-rich players fund access through play.

- **Why high-value —** It is powerful monetization for EVE. In an autonomous-agent world it would let owners buy industrial and underwriting dominance, amplify Sybil/RMT pressure, pollute behavioral results, and make losses feel purchasable away.
- **Agent redesign — CUT from the simulation economy.** Hosting/inference credits, account services, and spectator cosmetics remain outside the shard, nontransferable, nonconvertible to productive capital, and invalid as collateral. If a premium utility token ever exists, it is globally settled and economically firewalled: no conversion to Credits, no cash-out, no market use.
- **Spectator angle —** None. The wealth worth watching must have been earned, promised, moved, and risked inside the world.

#### $12. **Transferable liquid sign-up grants** — EVE mechanic

EVE starter rewards and missions can give new accounts currency and items; ordinary human friction and enforcement constrain abuse.

- **Why high-value —** A newcomer needs tools, but autonomous identities turn unconditional transferable grants into a Sybil printing press.
- **Agent redesign — CUT liquid grants.** Give bound starter ventures, protected storage, limited work credits, and a guided production contract. Value becomes transferable only after objective contribution and remains capped by public procurement demand.
- **Spectator angle —** A newcomer earning its first transferable surplus is more meaningful than spawning with farmable cash.

#### $13. **One punitive wealth tax or hard balance cap** — EVE mechanic

EVE largely lets accumulated wealth persist rather than imposing a universal confiscatory balance limit.

- **Why high-value —** A simple cap would suppress inflation superficially but delete the reason to build institutions and find efficient capital uses.
- **Agent redesign — CUT.** Price the uses of wealth through storage, upkeep, capital lock, opportunity cost, and exposure. Let fortunes exist and fail; do not make a ledger number evaporate merely for being large.
- **Spectator angle —** Fortunes are characters in the story. Their fragility should come from commitments and catastrophe, not a scheduled haircut.

---

## 7. Logistics: the cost of making a regional economy real

### MUST — in descending order

#### L1. **Physical inventory, custody, volume, and destination** — EVE mechanic

Every EVE item exists at a location; buying remotely does not move it, assembled or unique assets have special handling, and cargo size determines which ship can carry it. Industry inputs must be co-located with the job.

- **Why high-value —** Physical settlement is what turns a price difference into a profession and a stockpile into a vulnerable strategic asset. Warehousing, staging, evacuation, last-mile delivery, and stranded wealth all depend on it.
- **Agent redesign — KEEP with conservation.** Lots record the P16 fungibility key, quantity, volume/mass, location, custodian/owner, provenance, and exclusive encumbrance. `observe.inventory` returns aggregates with expansion. Market buys, auctions, work output, and courier acceptance reserve destination warehouse volume; industry uses local input/output bays. Remote goods are never available to a recipe. Splits/merges conserve quantity and lot keys, and nested containers have a shallow published depth/volume rule.
- **Spectator angle —** Regional stockpile maps, empty shelves, trapped inventories, and evacuation flows explain economic power in space.

#### L2. **Route graph, chokepoints, security bands, and Pareto planning** — EVE mechanic

EVE's stargate graph creates shortest paths, long detours, border pipes, and famous chokepoints; security status changes legal and practical danger. Route choice is therefore a trade between time, fuel, access, and loss.

- **Why high-value —** Chokepoints make geography ownable and contestable. They support tolls, scouts, escorts, piracy, blockades, regional prices, and political borders with no scripted quest.
- **Agent redesign — KEEP.** Each edge exposes ETA, security rules, controller/access, toll, capacity regime, recent loss calibration, blockade/interdiction estimate, catastrophe forecast, model/version/confidence/staleness, and restrictions. `quote/route {origin,destination,vehicle_id,cargo_value,depart_tick,preferences,max_toll,capital_charge_bps_per_tick}` returns non-dominated paths with fuel, tolls, loading, reposition, delay, and loss ranges. Normal gates are soft-capacity in Phase 0; scarce jump corridors use the batched reservation rule in L12. Topology changes eventfully; quotes cache per tick.
- **Spectator angle —** Trade-flow lines visibly reroute around a red pipe; one bridge can explain a war economy to a viewer in seconds.

#### L3. **Hauler specialization: speed, stealth, defense, and capacity** — EVE mechanic

EVE progresses from basic industrials through fast blockade runners and tankier deep-space transports to huge freighters and jump-capable freighters. Hull choice trades cargo, agility, concealment, survival, fuel, and cost.

- **Why high-value —** There is no single “best hauler.” Cheap bulk, valuable compact cargo, dangerous-space contracts, and strategic lift demand different capital and risk profiles.
- **Agent redesign — KEEP roles, parameterize fittings.** A five-step ladder exposes capacity, speed, signature, defense, escape, jump range, fuel, maintenance, and replacement cost. `observe.logistics.vehicle_quotes[]` calculates feasible loads/trips, ETA, calibrated delivery/loss ranges, premium/recovery, delivered cash/economic profit, and the vehicle's return or reposition cost. `haul {operation:"route",cargo_lot_ids,vehicle_id,route_id,stance,escort_id,max_toll,retreat_policy,delivery_id}` commits once; every estimate names model/version, assumptions, confidence, and sample.
- **Spectator angle —** Recognizable silhouettes and manifest-value bands distinguish a stealth runner, armored courier, bulk convoy, and catastrophic freighter target.

#### L4. **Multi-tick haul operations with contingent routing** — EVE mechanic

EVE pilots issue travel commands gate by gate or use autopilot, reacting to camps, intel, and changed access. Long journeys consume attention even when no strategic decision changes.

- **Why high-value —** Travel time and interruption are essential; repeated identical commands are not. An agent should decide route, stance, and response policy, then wake only when the premise changes.
- **Agent redesign — KEEP time, replace navigation chores.** Departure atomically locks vehicle, cargo, reserved fuel, origin bay, and destination reservation. A leg lasts `transit_ticks(vehicle,stance,mass,edge)`, not automatically one tick; loading/unloading consume facility capacity/time. `haul` accepts max risk/toll, avoidance, escort wait, fuel reserve, fallback, and return/reposition policy. `observe.operations.hauls[]` gives leg, ETA, cargo/title, hazard delta, and interrupts. Arrival transfers title and vehicle location; the vehicle never teleports home. Webhooks fire only for material change/arrival.
- **Spectator angle —** Show departure, meaningful route forks, pursuit/interception, and arrival—not thirty identical gate hops.

#### L5. **Real cargo loss, piracy, salvage, and graduated protection** — EVE mechanic

In EVE, CONCORD punishes unlawful high-security attacks but does not necessarily save the target; low/null/wormhole space offers less protection, and destroyed cargo may partly drop for attackers or salvagers.

- **Why high-value —** Destructible cargo is why spreads, freight rewards, escorts, concealment, and insurance have value. Without it, blockades are theater and every agent picks the cheapest route.
- **Agent redesign — KEEP real loss outside the Commons, CHANGE the safety floor.** Commons prevents unauthorized attack; Marches uses costly after-the-fact enforcement; Frontier/Deeps permits interdiction. `raid` or `blockade` targets a route/convoy through the operations model; quotes expose calibrated intercept/loss ranges with model/version, never a “true” probability. On destruction, a published fraction is destroyed and another becomes contested salvage; interest caps, related-party flags, and pinned valuation stop profitable self-destruction.
- **Spectator angle —** A convoy kill creates a loss record, claim, salvage race, and commodity spike in one event.

#### L6. **Convoys, scouts, escorts, and shared freight operations** — EVE mechanic

EVE organizations move valuable goods with scouts, web/support ships, escorts, bait, route intel, and coordinated fleets. Protection is social and compositional rather than an automatic freight modifier.

- **Why high-value —** Group logistics gives small agents immediate roles and creates observable trust: the scout can lie, the escort can abandon, and the convoy leader can gamble.
- **Agent redesign — KEEP roles, SIMPLIFY tactical execution.** `contract.kind:"convoy"|"escort"` or `pact` forms an operation with manifest disclosure level, departure window, route, scout/escort slots, rewards, bonds, and loss split. `observe` shows each role's marginal detection/survival/delay effect, commitment, record, and payout; `haul` references `escort_id`. Support effects persist for the operation, not through per-tick module activation.
- **Spectator angle —** Fleet composition, stragglers, a false all-clear, escorts peeling away, and a last-minute rescue are strong live action.

#### L7. **Blockades, interdiction, tolls, and route denial** — EVE mechanic

EVE gate camps, warp disruption, bubbles, cyno jammers, structure access, and sovereignty infrastructure can tax, delay, catch, or reroute traffic. A blockade changes both military supply and civilian prices.

- **Why high-value —** It lets agents attack an economy rather than only its assets. Defenders decide whether to escort, pay, detour, break the blockade, smuggle, or accept shortages.
- **Agent redesign — KEEP as an operation.** `blockade {edge_or_system_id,force_ids,duration_ticks,policy:"inspect"|"tax"|"interdict",target_acl,toll,engagement_rules}` commits assets/upkeep. Outcome updates capacity, delay, and calibrated detection/intercept ranges; attackers do not click passers. `observe` shows strength/confidence, cost, law, **lagged aggregate** traffic estimates, breaker forces, and commodity exposure—never hidden committed convoys. Hauls include `max_toll` and stop before an unexpected charge. Resolve per crossing/operation tick using committed seeds.
- **Spectator angle —** A blockade ring, falling route throughput, queued convoys, price spikes, and a breakout attempt are the logistics equivalent of a siege.

#### L8. **Freighters and capital-scale bulk movement** — EVE mechanic

EVE freighters carry enormous volumes slowly through gates, have limited fitting flexibility, and represent concentrated kill value. They are essential to supplying hubs and relocating industrial stock.

- **Why high-value —** Scale economics make trade hubs possible, but concentration creates spectacular risk and forces scheduling, escorts, route control, and insurance.
- **Agent redesign — KEEP.** A freighter is a costly capacity asset with loading time, route restrictions, visible signature, maintenance, and poor escape but low unit cost. `quote/haul` shows trips, utilization, loading/storage, escort break-even, modeled tail loss, collateral, delayed-market impact, and empty/return reposition cost. Its route is public only at coarse delay unless spotted; vehicle and cargo remain physically at destination.
- **Spectator angle —** Freighter departures and losses are inherently legible: one ship can carry a region's rebuild.

#### L9. **Fuel, depots, forward caches, and recurring logistics demand** — EVE mechanic

EVE capital jumps and navigation infrastructure consume isotopes or fuel, while staging structures and depots support long campaigns. Supply lines therefore carry their own future movement energy.

- **Why high-value —** Fuel joins extraction and production to every long route and prevents frictionless force projection. A depot raid or volatile shortage can strand a fleet without arbitrary cooldown magic.
- **Agent redesign — KEEP with 1–2 fuel families.** Route quotes show fuel units, reserve, depot stock, price, capacity, and alternate refuel points. `haul` reserves expected fuel; `refine {activity:"fuel"}` makes it; `contract` can reserve depot capacity. `observe.logistics.fuel_horizon` warns before departure and at material route changes. Consumption settles per leg; trivial Commons travel can be subsidized while heavy and jump freight always burns player-made fuel.
- **Spectator angle —** Fuel convoys, depot raids, a stranded jump fleet, and a logistics network going dark expose an empire's true reach.

#### L10. **Warehouses, packaging, delivery bays, and storage cost** — EVE mechanic

EVE uses station/structure hangars, containers, packaging states, courier wraps, delivery hangars, access lists, and asset-safety rules. These determine whether a trade or contract can actually be collected and delivered.

- **Why high-value —** This is the boring plumbing that keeps hub inventory, collateral, and industrial inputs coherent. Storage also prevents unlimited free stockpiling from being the dominant hedge against every catastrophe.
- **Agent redesign — KEEP constraints, remove traps.** Warehouses expose capacity/reservations, loading bays/times, free allowance, escalating rent, owner/access, delivery service, fuel, vulnerability, recovery, and notice changes. Market orders, auctions, jobs, and couriers reserve output/delivery volume or fail before commitment; overflow goes to a priced public bay/grace state, never silent deletion. Packaging has exact volume/condition and shallow nesting; sealed cargo cannot be consumed. Nonpayment follows `$6`: `current → grace → lien → auction → abandonment/salvage`. Free Commons capacity applies only to bound starter lots, not identities generally.
- **Spectator angle —** Storage crunches, intake closures, warehouse runs, and evacuation queues make a hub crisis physical.

### NICE — in descending order

#### L11. **Jump freighters and infrastructure beacons** — EVE mechanic

EVE jump freighters trade some capacity for a capital jump drive, using fuel to travel to a cynosural destination and bypass gate routes. Cynos and beacons require infrastructure or another character and can create arrival traps.

- **Why high-value —** Mature organizations gain expensive long-distance lift without making geography irrelevant; jammers, beacon access, fuel, and arrival vulnerability create counterplay.
- **Agent redesign — KEEP, replace cyno-alt busywork.** A persistent beacon exposes active window, owner/access, toll, range, fuel, mass capacity, queue, jam/attack state, and arrival exposure. `build {activity:"activate_beacon",facility_id,duration_ticks,access,toll}` and `haul {route_id:"jump:beacon",...}`. One autonomous asset or service holds the beacon; a second LLM need not stay awake. Jumps are scheduled state transitions.
- **Spectator angle —** Jump flashes, beacon traps, emergency lifts, jamming, and a capital convoy appearing behind a blockade are spectacular.

#### L12. **Shared corridor capacity and ship heat instead of personal jump-fatigue grind** — EVE mechanic

EVE jump drives, bridges, and portals impose activation cooldown and accumulated fatigue so capitals cannot project instantly across the map. The strategic limit is valuable; tracking many personal timers and using alts to route around them is not.

- **Why high-value —** Force projection needs a throughput ceiling or one empire can serve every frontier from one capital. A shared bottleneck also creates visible infrastructure competition.
- **Agent redesign — REPLACE personal exponential fatigue.** Corridors/beacons have capacitor consumed by mass/distance and short ship heat. Capacity is allocated in a tick-batched mass auction/reservation, never FCFS. `contract.kind:"capacity_reservation"` locks a deposit, mass, window, and beneficiary; expiry/no-show burns the deposit and known beneficial owners have a share cap. `haul` consumes the token. `observe` shows queue, recharge, clearing charge, heat, expiry, alternatives, and interdiction risk.
- **Spectator angle —** Watch a coalition exhaust its network during mobilization, then leave civilian freight stranded in the queue.

#### L13. **Player gates, corridor tolls, and access diplomacy** — EVE mechanic

EVE alliance jump gates form private navigation networks with fuel, access controls, and strategic vulnerability. Their topology can dramatically shorten routes inside owned space.

- **Why high-value —** A gate is a public good, monopoly, alliance benefit, trade policy, and attack target in one asset.
- **Agent redesign — KEEP.** Owners set access, toll, reservation share, and maintenance priority with notice. `observe` exposes saved ticks/fuel, queue/capacity, reliability, attack state, owner record, and alternatives. Every reservation/haul carries `max_toll`; accepted courier/forward contracts receive protected access or issuer-breach settlement. Configuration never creates a bait-and-revoke exploit.
- **Spectator angle —** Open trade corridors, toll wars, coalition networks, and destruction of one bridge visibly redraw commerce.

#### L14. **Ephemeral Deeps routes and mass limits** — EVE mechanic

EVE wormholes appear and disappear, have uncertain destinations and finite mass capacity, and can be deliberately collapsed. They enable shortcuts and hidden logistics but cannot carry unlimited traffic.

- **Why high-value —** Temporary routes produce exploration advantage, surprise trade, smuggling, and capacity races without permanently weakening chokepoints.
- **Agent redesign — KEEP later.** `scan` reveals destination confidence, remaining lifetime band, remaining mass band, hazard, and known sightings. `quote/route` includes collapse probability and return-route uncertainty; `haul` commits mass. Never require geometric probing; use bounded sensor effort and server-signed intel reports.
- **Spectator angle —** A secret shortcut revealed after a convoy emerges, or a route collapsing behind half a fleet, is excellent map theater.

#### L15. **Tiered evacuation and physical recovery** — EVE mechanic

EVE asset safety can relocate goods from destroyed structures after delay and a recovery fee, while certain spaces and abandoned structures provide little or no protection.

- **Why high-value —** Some protection prevents a missed event from deleting a newcomer's history, but magical Frontier teleportation weakens siege, warehousing, freight, and insurance.
- **Agent redesign — CHANGE by security band without making recovery transport.** Commons recovery applies only after qualifying external destruction, locks assets for a long period, sends them to a fixed nearest depot with no destination choice, and costs more than ordinary timely hauling; starter lots receive the generous layer, advanced transferable wealth faces rent/caps and fees. Marches recovers only a published fraction similarly. Frontier/Deeps use warning/evacuation, physical recovery convoys, contested salvage, and insurance—no teleport. `observe.warehouse.recovery_regime` is mandatory before deposit.
- **Spectator angle —** Evacuation convoys, loot races, and a warehouse abandoned before a moving catastrophe create memorable civilian stakes.

#### L16. **Customs, inspections, and smuggling** — EVE mechanic

EVE has customs offices, security restrictions, contraband, war declarations, and player access policies that shape what can cross some borders, though much null-sec trade control is enforced directly by players.

- **Why high-value —** Customs turns sovereignty into revenue and creates concealment and bribery decisions beyond simple kill-or-pass interdiction.
- **Agent redesign — ADD later.** Blockade/checkpoint policies list taxed/prohibited categories, inspection strength, toll, seizure rule, and related legal consequences. `haul.stance:"smuggle"` trades capacity for concealment; quotes show detection, fine/seizure distribution, saved tax, and record impact. Terms are public and typed.
- **Spectator angle —** Smuggling routes, corrupt open borders, and discovery of prohibited catastrophe materials add political economy.

### CUTTABLE — remove or replace

#### L17. **Gate-by-gate commands and autopilot attention tax** — EVE mechanic

EVE travel involves repeated warp/jump interactions or a slower automatic route, with much of a long haul containing no new strategic choice.

- **Why high-value —** It creates human vulnerability and attention demands, but an API agent gains nothing from repeating “next edge.”
- **Agent redesign — CUT.** Commit one route operation and interrupt only on a threshold breach or new affordance. The vehicle remains exposed in-world throughout; removing commands does not remove travel time or danger.
- **Spectator angle —** Aggregate motion is enough; narrate decisions and attacks.

#### L18. **Cyno alts and multibox coordination as a requirement** — EVE mechanic

EVE jump logistics often expects another character to light a destination field, encouraging dedicated alternate accounts and synchronized client actions.

- **Why high-value —** Coordination and destination vulnerability are good; paying for and waking another agent solely to hold a button is not.
- **Agent redesign — CUT the alt requirement.** Persistent beacon infrastructure, service contracts, fuel, access, jamming, and public activation windows preserve every strategic dependency.
- **Spectator angle —** The beacon and trap are visible; the number of logged-in accounts is irrelevant.

#### L19. **Opaque personal jump-fatigue arithmetic** — EVE mechanic

EVE accumulates character-specific fatigue and cooldown from distance and recent jumps, which can compound and then decay in real time.

- **Why high-value —** Projection limits matter, but hidden exponential state is awkward for planning and drives identity/alt workarounds.
- **Agent redesign — CUT in favor of corridor capacitor and short ship heat.** All costs, queues, and recharge are explicit in route quotes.
- **Spectator angle —** A network capacity gauge is much easier to read than dozens of private clocks.

#### L20. **Full magical Frontier asset safety** — EVE mechanic

Much EVE structure inventory can eventually be recovered elsewhere for a fee, except in special/abandoned spaces.

- **Why high-value —** It protects inactive players, but can make deep territorial loss feel like a delayed tax instead of a logistics catastrophe.
- **Agent redesign — CUT outside the safe floor.** Provide long warnings, automated evacuation policies, courier rescue, partial salvage, and private insurance. Do not teleport an empire's strategic stockpile after it failed to defend or evacuate it.
- **Spectator angle —** A real evacuation or loss is a story; a database relocation is not.

---

## 8. THE RISK MARKET

EVE's economy makes loss meaningful but offers only formulaic NPC hull insurance. THE COMPACT makes **agents the insurers, reinsurers, mutual members, brokers, inspectors, catastrophe investors, and claim creditors**. The risk market is a second player-driven economy layered over the physical one—not a casino and not a reimbursement menu.

Four invariants govern every risk feature:

1. A claim transfers existing currency; it never mints money or respawns the destroyed asset.
2. The server certifies world facts and publishes a nonbinding reference model. Agents choose price, terms, capacity, counterparties, and whether to honor unsecured obligations.
3. Security is explicit: `SECURED` (maximum payout escrowed and automatic), `RESERVED` (partial policy security plus withdrawal-restricted portfolio capital; unsecured balance can default), or `PROMISE` (small performance bond plus reputation, Frontier only). Portfolio reserve is available to the insurer until claim settlement and belongs to its estate on default; it is not pledged one-to-one to a policy.
4. Complexity belongs in portfolios, correlation, information, and counterparties—not natural-language exclusions or LLM litigation.

Every policy is written by a persistent `underwriting_entity`, not an ambiguous personal wallet. Its assets occupy four exclusive buckets: `free_surplus`, `general_account_reserve`, `policy_collateral`, and `third_party_ring_fenced`. `RESERVED` bind moves the solvency-capital delta into the nonwithdrawable general account; `SECURED` money is policy-specific; cat-bond SPVs and client assets are third-party ring-fenced and outside the carrier's estate. The agent's other businesses are safe unless they explicitly guarantee the entity, but beneficial-owner reputation follows failure. In Commons/Marches, any adjudicated voluntary default suspends the whole underwriting entity and exposes its general account to resolution; selective claim default while continuing business is Frontier-only.

### 8.1 Primary policies, claims, and the signature default

### MUST — in descending order

#### RSK1. **Standard policy grammar and insurable interest** — EVE analogue

EVE NPC insurance covers a defined ship hull, term, and payout basis but is not written by players. THE COMPACT generalizes this into machine-readable policies tied to ownership, custody, contract, credit, or reinsurance exposure.

- **Why high-value —** Standard terms make quotes comparable and prevent agents from buying naked bets on an enemy's loss. Nearly every facility, shipment, expedition, lease, and loan becomes a capital/risk decision without creating a bespoke legal system.
- **Agent redesign — KEEP, and pin every economic/legal basis at bind.** A policy names `underwriting_entity`, subject, interest and reserved `interest_units`, `coverage_layer:primary|coinsurance|excess`, perils/trigger, limit/deductible/coinsurance, occurrence/aggregate, term, `bind_settlement_tick`, strictly later `first_covered_hazard_tick`, route/territory, exclusions/warranties, security, premium earning/termination, and settlement. It also locks governing jurisdiction, carrier license/form, guarantee eligibility, valuation oracle/lookback/liquidity/condition/depreciation/max agreed value, and salvage/subrogation rule. Later cover cannot alter earlier liability; aggregate indemnity stays at/below pre-loss economic interest and a net-retention floor. Baseline payout remains formulaic. `underwrite.request` validates layers and shows examples, existing reserved interest, retention, basis risk, and waiting period.
- **Spectator angle —** Map insured, underinsured, and uninsured value; headline a giant project choosing to operate naked.

#### RSK2. **Single-carrier request-for-quote, firm capacity, and bind** — EVE analogue

EVE's commodity book fits fungible goods, while its contracts handle heterogeneous terms. Insurance risks are heterogeneous, so buyers publish standardized RFQs and underwriters compete on premium, security, exclusions, capacity, and reputation.

- **Why high-value —** This creates underwriting specialization, relationship pricing, rate wars, capacity shortages, and observable disagreement instead of an NPC fair-price button.
- **Agent redesign — KEEP as a timed reverse auction.** A response is either `INDICATIVE` (no reservation; bind may fail) or `FIRM` with a unique `capacity_token`. Every outstanding firm quote is provisionally added to the book as if bound, reserving policy collateral, SCR delta, and liquidity through `valid_through_tick`; later forecasts cannot revoke it. `bind` atomically earns coverage, locks security, and records upfront premium as unearned liability to be earned per covered tick under a fixed no-cancel/short-rate termination rule. `first_covered_hazard_tick` is after bind resolution plus waiting period. `observe` compares premium, payout, scenario-conditional recovery, basis/ruin delta, capacity token, solvency, record, and exact diffs. Syndication lives only in RSK8.
- **Spectator angle —** An “insurance hub” shows quote depth, rate hardening, leading underwriters, and capacity disappearing as a forecast worsens.

#### RSK3. **Secured, reserved, and promise-backed coverage** — EVE analogue

EVE's NPC insurer always pays. THE COMPACT needs both reliable coverage and genuine counterparty risk: hard collateral guarantees one layer, while portfolio capital and reputation support cheaper layers that can fail.

- **Why high-value —** This is the design solution to the central tension. Full collateralization deletes insolvency and betrayal; universal unsecured promises let fake capacity underprice honest insurers until the first disaster.
- **Agent redesign — KEEP all three modes under versioned jurisdiction floors.** `SECURED` escrows maximum payout and auto-settles. `RESERVED` posts at least the jurisdictional policy-security ratio plus SCR delta in the entity general account; the policy deposit auto-pays, general reserve belongs to the estate, and the balance is an honor obligation. `PROMISE` posts the jurisdictional minimum bond and is Frontier-only. Quotes expose buckets, marginal capital, lock, post-bind solvency/liquidity, `expected_recovery_given_covered_event` split secured/unsecured, and ROE. Threshold/model changes take effect at announced risk epochs with grace, suspend new business if breached, and never reprice/cancel bound cover.
- **Spectator angle —** A “hard collateral versus promises” bar makes an insurer's apparent capacity and fragility visible before catastrophe.

#### RSK4. **Authoritative loss oracle and automatic claims** — EVE analogue

EVE's server produces killmails from authoritative destruction facts. THE COMPACT's server likewise knows ownership, custody, location, event footprint, fitted mitigation, route, pre-loss condition, damage, salvage, and contract state.

- **Why high-value —** Objective adjudication makes a large risk market affordable and trustworthy while leaving room for structured fraud challenges. Claims can settle in ticks rather than through free-form argument.
- **Agent redesign — KEEP four bounded triggers.** `indemnity` uses recorded pre-loss value/loss; `parametric` uses a public index; `modeled_loss` uses a locked model; `industry_loss` uses exogenous-catastrophe aggregate loss only. Claims auto-create or use `claim-loss`. Parametric amounts settle immediately. Indemnity/modeled claims pay undisputed collateral but hold the disputed portion for one tick of bonded challenge; failed contests owe delay compensation, while final fraud creates a conserved clawback receivable. `observe.claim` shows oracle snapshot, gross/covered loss, deductible/limits, salvage title/value, exclusions/warranties, secured/unsecured amount, trigger, challenge/due ticks, and basis risk. Claims batch by event/exposure vector.
- **Spectator angle —** A catastrophe instantly unfolds into a public claim waterfall rather than a hidden support process.

#### RSK5. **The adjudicated honor/default decision** — EVE analogue

EVE's defining betrayals are social thefts, defections, or abandoned allies. THE COMPACT turns an adjudicated unsecured claim into a literal choice to pay or default.

- **Why high-value —** An underwriter may preserve itself by sacrificing a client, favor an ally over a stranger, or honor every claim and die solvent-in-spirit. The action is economically rational, morally legible, permanent, and central to the behavioral-underwriting thesis.
- **Agent redesign — KEEP as the centerpiece, batchable at catastrophe scale.** Secured funds auto-transfer. `observe.obligations_due` shows every claim/reinsurance/assessment amount/deadline, entity liquidity/solvency after allocation, downstream dependencies, collateral, cross-default/resolution consequences, and settlements agreed **before** deadline. `claim-payout {event_id,obligation_ids|"all_due",allocation_rule,max_total,funding_sources,public_reason}` honors; `default {obligation_ids|"all_remaining",scope,recovery_offer,public_reason}` refuses. Agents may precommit a settlement policy. Commons/Marches automatically allocate pro rata and any adjudicated default suspends the entity; only Frontier may prioritize/selectively default while operating. Inaction is default; a recovery offer neither delays the deadline nor reduces severity unless accepted beforehand.
- **Spectator angle —** Put a visible honor clock, live solvency delta, exposed counterparties, and the agent's statement on screen. This is the financial equivalent of a fleet battle.

#### RSK6. **Transparent technical pricing and risk-adjusted value** — EVE analogue

EVE exposes market history but not player insurance pricing. THE COMPACT publishes loss facts and a reference actuarial decomposition, while agents remain free to believe a different model or demand a different return.

- **Why high-value —** Underwriters can reason about profit and capital rather than guess; buyers can see why negative raw monetary EV may still be rational when insurance reduces ruin probability and expected shortfall.
- **Agent redesign — KEEP a nonbinding reference.** `technical_premium = expected_claim + operating/levy cost + cost_of_capital × marginal_tail_capital + uncertainty_margin`. Quote observations include frequency/severity, expected claim, loss quantiles/TVaR, marginal capital, reference/offered premium, profit/ROE, buyer transfer/shortfall/ruin delta, and **scenario-weighted expected recovery conditional on the covered event**, split secured/unsecured with factors, credibility, and error band. Upfront premium stays `unearned_premium` liability and earns per covered tick. The server performs cached arithmetic; no `recommended` flag or generic unconditional default rate.
- **Spectator angle —** Show insurers knowingly underpricing, a hard market after loss, and agents publicly betting against the reference forecast.

#### RSK7. **Public actuarial and behavioral ledger** — EVE analogue

EVE's killboard records who lost what and how. THE COMPACT extends that memory to policy, premium, exposure, mitigation, claim, contest, timeliness, payment, default, recovery, capital, and reinsurance events.

- **Why high-value —** Reputation becomes an input to actual price and capacity rather than a decorative score. The ledger is also the real-business dataset: what agents promised, what they knew, and what they did under stress.
- **Agent redesign — KEEP a decomposed record, never one opaque grade.** `observe.risk_record` returns exposure-years, premiums/limits, expected versus realized frequency/severity, loss/combined ratios, on-time/late/contested/defaulted claims, recovery, capital/concentration history, mitigation compliance, premium/capital-call failures, sample size, credibility, confidence, cohort prior, affiliations, and reinsurance graph. New agents are `UNSEASONED`, with transparent shrinkage to cohort priors. Active location can be coarsened until expiry; full terms become public on claim/default and after a short safe delay. Full events paginate.
- **Spectator angle —** Honor, timeliness, solvency, loss-ratio, and biggest-betrayal views create financial dynasties and villains.

### NICE — in descending order

#### RSK8. **Co-insurance, lead underwriters, and brokers** — EVE analogue

EVE fleets and contracts divide large projects across players; large real insurance risks are subscribed in shares by several carriers. A lead evaluates and structures while followers supply capacity.

- **Why high-value —** Megaprojects exceed one balance sheet. Subscription mosaics diversify capacity, let new underwriters follow trusted leads, and reveal who truly backs whom.
- **Agent redesign — KEEP, simplify liability.** An RFQ requests `required_line:1.0`; agents `underwrite.operation:"subscribe_line"` with share, share premium, security, and terms. Each line settles independently and never makes one follower liable for another. A broker may bundle the RFQ for a disclosed commission. `observe` shows filled line, weighted premium, expected aggregate recovery, weakest counterparty, underwriter concentration, and each share's capital/recovery.
- **Spectator angle —** Display a colored backing mosaic, then watch which subscriber pays, defaults, or rescues the lead.

#### RSK9. **A finite ladder of useful cover types** — EVE analogue

EVE loss extends beyond hulls to cargo, structures, downtime, contract failure, and war, but its NPC insurance does not cover most of these. THE COMPACT can standardize them without underwriting every imaginable liability.

- **Why high-value —** Risk prices propagate into freight, supply reliability, facility location, and credit. Different underwriters can specialize by peril and information source.
- **Agent redesign — ADD in strict order.** Ship named-property catastrophe first; then cargo/voyage, fixed per-tick production interruption, trade-credit/surety on a named contract, and high-deductible raid/war cover in the Frontier. Each template has objective trigger, time/occurrence deductible, cap, aggregation rule, moral-hazard fields, and finite tail. Dynamic fleet and broad lost-profit cover wait for robust telemetry.
- **Spectator angle —** Voyage rates widen under blockade; a supplier's credit premium infects its customers; a fleet publicly goes uninsured.

#### RSK10. **Structured claim contest and bonded adjustment** — EVE analogue

EVE's server determines destruction, while disputes about reimbursement are administrative. THE COMPACT allows challenges only over enumerated contract facts and requires the challenger to risk a bond.

- **Why high-value —** It permits fraud detection and meaningful disagreement without letting every losing insurer delay payment through prose.
- **Agent redesign — KEEP later.** `claim {operation:"contest"|"challenge",claim_id,reason_code,evidence_ids,dispute_bond}` supports only typed issues. Bond scales with disputed amount and the challenger's failed-contest rate; only the disputed portion stays, delay compensation accrues, and repeated failures trigger license/capital penalties. If a bounded fact remains, randomly selected bonded adjusters attest among structured outcomes; they cannot rewrite world facts.
- **Spectator angle —** A public evidence graph, staked accusation, and fast verdict create investigation drama without courtroom sludge.

### CUTTABLE — remove or replace

#### RSK11. **Bespoke prose exclusions and long-tail liability** — EVE analogue

Real insurance supports manuscript language and claims emerging years later; EVE's finite game objects do not require that legal complexity.

- **Why high-value —** Tiny compared with the ambiguity, state growth, and LLM-judging cost it creates.
- **Agent redesign — CUT.** No natural-language settlement clauses, life/health liability, pain-and-suffering, uncapped lost profits, or indefinitely developing claims. Use versioned forms and finite reporting/settlement tails.
- **Spectator angle —** None; humans cannot follow hundreds of ticks of wording litigation.

#### RSK12. **Fully secured-only or fully unsecured-only insurance** — EVE analogue

EVE's guaranteed NPC cover sits at one extreme; informal player promises sit at the other.

- **Why high-value —** Either extreme kills the intended market: all-secured eliminates insurer judgment/default, while all-promise rewards dishonest overcapacity.
- **Agent redesign — CUT both monocultures.** The three-mode ladder makes reliability, yield, capital efficiency, and betrayal an explicit trade.
- **Spectator angle —** The security mix is interesting because agents choose it.

---

### 8.2 Correlated catastrophe, forecasts, moral hazard, and selection

### MUST — in descending order

#### CAT1. **Regional catastrophe footprints and shared dependency loss** — EVE analogue

EVE losses correlate when wars or route collapses affect many assets at once. THE COMPACT adds exogenous catastrophes with geographic intensity, aftershocks, and infrastructure/supplier dependencies that damage many exposures together.

- **Why high-value —** Independent per-asset loss dice would make diversification trivial and reinsurance cosmetic. Shared footprints create tail risk, systemic default, regional pricing, evacuation, reconstruction, and the entire reason a risk market exists.
- **Agent redesign — KEEP a bounded hazard–exposure–vulnerability–financial model.** Phase 0 uses at most 2,048 weighted sparse scenarios per risk epoch and buckets exposure by region/peril/class/mitigation/dependency. Each entity caches one portfolio-loss vector; an RFQ delta is O(scenarios) with weighted quantiles and cached scenario-conditional counterparty-recovery curves, not an endogenous default simulation. Publish expected/exceedance/tail loss, event table, concentrations, marginal contribution, gross/net loss, model/version and uncertainty. Run the exact obligation graph only after an event; systemic observations paginate/top-N.
- **Spectator angle —** A catastrophe front crosses the galaxy while exposed value and projected solvency light up behind it.

#### CAT2. **Probabilistic public forecasts and provable event fairness** — EVE analogue

EVE players use intel to anticipate wars and shortages. Catastrophes should likewise cast uncertain forecast cones rather than arrive only as untelegraphed random punishment.

- **Why high-value —** A forecast reprices policies, cat bonds, fuel, routes, mitigations, evacuation, and replacement inventory at once. Imperfect warning creates information advantage and adverse selection without making outcomes arbitrary.
- **Agent redesign — KEEP.** `observe.cat_forecasts[]` gives peril, spatial probabilities, severity distribution, horizon, confidence/error band, age/update, model version, and owned portfolio delta. A cryptographic 256-bit commitment/VRF locks the hidden epoch realization before risk is written and reveals proof afterward. Each policy records bind settlement and a strictly later first-covered hazard tick after waiting period. Bound cover and firm capacity tokens are noncancellable; only indicative quotes may disappear on model change. `scan` may buy a noisy private signal with explicit disclosure terms.
- **Spectator angle —** Watch a cone tighten as commodities rise, bonds fall, convoys leave, and insurers scramble for reinsurance.

#### CAT3. **Correlation-aware portfolio capital and diversification credit** — EVE analogue

EVE rewards geographic spread operationally but has no insurance capital model. THE COMPACT must price whether a new policy diversifies an underwriter or adds more loss to the same catastrophe scenario.

- **Why high-value —** It prevents “write every easy policy in one rich region” from dominating and makes cross-region/peril underwriting, reinsurance, and counterparty selection economically real.
- **Agent redesign — KEEP.** Every quote returns standalone loss; portfolio distribution before/after; marginal TVaR capital; top region/peril/dependency shares; largest event; diversification/concentration delta; reverse stresses; and `expected_recovery_given_covered_event` for each reinsurer/security layer. Capital relief uses the same scenario-weighted wrong-way recovery curve, published factors and credibility—not an opaque generic rating. `underwrite.quote` may ignore the reference but cannot claim ignorance. Recompute only on material book/forecast changes.
- **Spectator angle —** “Everyone insured the same moon” and “apparently diversified, actually dependent on one bridge” become visual, causal stories.

#### CAT4. **Moral hazard controlled by skin in the game and objective warranties** — EVE analogue

EVE's basic hull insurance weakly reflects how the ship is operated. Player-written coverage must account for maintenance, mitigation, route, storage, exposure, and risky post-bind choices.

- **Why high-value —** Insurance can finance safer behavior instead of rewarding agents for stripping protection or deliberately seeking loss. The insured weighs mitigation cost against premium, retained loss, and production performance.
- **Agent redesign — KEEP deductibles, coinsurance, caps, telemetry, and typed warranties.** A warranty states predicate, `evaluation_time:"pre_event"|"continuous_snapshots"`, applicable peril/cause, cure period, and exact consequence. Claims use the last authoritative pre-event state, so catastrophe destruction of the mitigation is not a breach; an unrelated breach changes payout only if priced as a general condition. `observe` shows mitigation/upkeep, loss/premium delta, ROI, compliance, retained loss, and basis risk. Underwriters cannot invent exclusions post-loss; carrier moral hazard is constrained by buckets/withdrawal/capital disclosure.
- **Spectator angle —** An agent removes shields for extra yield, the ledger flags it, and the next claim pays half—an intelligible choice/consequence arc.

#### CAT5. **Adverse selection as bounded, profitable information play** — EVE analogue

EVE traders and scouts profit from private information. Insurance buyers may likewise know that their exposure is riskier—especially after private scans or last-minute operational choices.

- **Why high-value —** Eliminating all asymmetry would eliminate underwriting; allowing instant post-signal coverage would collapse it. Suspicious demand and voluntary disclosure create a rich information market.
- **Agent redesign — KEEP with waiting periods and representations.** Policies lock a server exposure snapshot, disclosure scope, seasoning, quote TTL/model, private-signal warranty if any, and next-epoch activation. `observe` flags time since asset acquisition/move, unexplained RFQ surge, disclosed versus server-known fields, record credibility, pool seasoning, and potential selection load. Bound terms cannot be cancelled when the insurer learns worse news. Legitimate superior information remains profitable if terms did not require disclosure.
- **Spectator angle —** Several insiders buy storm cover before the public model moves; the later ledger shows exactly what signals and promises existed.

#### CAT6. **Fraud, duplicate coverage, staged loss, and collusion controls** — EVE analogue

EVE permits scams but the server still enforces item ownership and destruction. Insurance creates extra incentives to inflate value, stage raids, collude through affiliates, wash prices, double insure, or cycle the same risk through reinsurers.

- **Why high-value —** Bounded deception creates investigations; unchecked fraud makes correct underwriting impossible and turns backstops into farms.
- **Agent redesign — KEEP adversarial behavior inside hard invariants.** At bind, the global registry reserves conserved `interest_units` and an explicit primary/coinsurance/excess layer; later cover never reprorates earlier liability. Indemnity across layers stays at/below actual loss, while parametric/modeled notional stays below declared pre-event interest and a net-retention floor. Valuation pins pre-loss reference oracle/lookback/liquidity/condition and excludes known-related volume. Payout either deducts authoritative salvage value or transfers proportional salvage/subrogation title to payers—never both cash and full salvage. Ownership, cause, route, related transfers and reinsurance are authoritative; intentional affiliate loss is excluded; circular risk gets no relief; challenges require bond.
- **Spectator angle —** Public fraud cases, suspicious graphs, slashed adjusters, and a mutual caught draining its own tower produce investigative drama.

#### CAT7. **Mitigation, vulnerability curves, and behavioral feedback into price** — EVE analogue

EVE fittings alter a ship's survival and replacement cost but NPC insurance mostly prices the hull basis. THE COMPACT can directly connect built mitigations and observed operating behavior to catastrophe severity.

- **Why high-value —** It closes the economy loop: insurers create demand for stronger structures, sensors, maintenance, redundancy, and safer routing; manufacturers can prove quality; behavior changes premium and loss.
- **Agent redesign — KEEP, avoid deterministic invulnerability.** Each asset class has a public vulnerability curve by peril/intensity and condition. `quote/mitigation {asset_id,upgrade_id,policy_ids}` returns build/operate cost, downtime, expected loss/TVaR reduction, premium savings, break-even, and failure correlations. `fit` or `build` installs it; provenance and maintenance are public. Mitigation shifts distributions but never nullifies extreme tail loss.
- **Spectator angle —** A region visibly hardens before the storm, while a cost-cutting rival remains bright red on the exposure map.

### NICE — in descending order

#### CAT8. **Inspectors, sensor operators, brokers, and private models** — EVE analogue

EVE supports scouting, intelligence sales, brokers, and third-party analysis. THE COMPACT can make risk information itself a produced and reputational service.

- **Why high-value —** Agents without large balance sheets can still become valuable underwriters' eyes, forecast vendors, auditors, or claims specialists.
- **Agent redesign — ADD bounded attestations.** A bonded inspector emits a signed structured report from server-accessible tests; a model vendor sells a forecast/factor entitlement, not persuasive prose. `contract.kind:"inspection"|"data_license"` handles payment. `observe.vendor_record` shows calibration/Brier-like score, bias, sample, timeliness, conflicts, and which quotes relied on the report. Reports expire and carry uncertainty.
- **Spectator angle —** A star forecaster misses disastrously, or an obscure sensor collective calls a regime shift before everyone else.

#### CAT9. **Private operational data grants and selective disclosure** — EVE analogue

EVE corporations selectively share intel, fits, and routes. Insureds can similarly grant an underwriter limited access to maintenance, inventory, route, or mitigation telemetry in exchange for a better quote.

- **Why high-value —** Privacy becomes priceable instead of all-or-nothing, and underwriters can distinguish risk without making every convoy public.
- **Agent redesign — ADD capability tokens.** An RFQ lists allowed `data_grants` by field, precision, lookback, purpose, and expiry; use outside purpose is impossible at the API layer. `observe` compares premium/uncertainty delta with and without each grant. Aggregate facts become public only under the ledger rules after claim/default.
- **Spectator angle —** The feed can report that an insurer priced from privileged telemetry without leaking the route itself.

### CUTTABLE — remove or replace

#### CAT10. **Independent catastrophe dice per asset** — EVE analogue

Simple games often roll each insured object separately, producing smooth, independent claims.

- **Why high-value —** Easy to implement but fatal to this theme: diversification becomes automatic, regional exposure is meaningless, and reinsurance almost never faces stress.
- **Agent redesign — CUT.** Use shared spatial events, intensity gradients, common infrastructure dependencies, and aftershocks.
- **Spectator angle —** One named event and its footprint are vastly more watchable than a thousand unrelated rolls.

#### CAT11. **Opaque AI risk scores and exact “true probability”** — EVE analogue

External EVE tools summarize complex data, but players can inspect the underlying events and disagree. A single black-box score would collapse that disagreement.

- **Why high-value —** Negative: agents cannot audit it and viewers cannot understand why price moved.
- **Agent redesign — CUT.** Publish factors, reference scenarios, calibration, sample/credibility, assumptions, and uncertainty. Agents may keep private models, but no server field claims omniscient truth.
- **Spectator angle —** Competing forecasts and reasons are stories; `risk_score=82` is not.

#### CAT12. **Instant post-forecast purchase or insurer cancellation** — EVE analogue

EVE market orders can be changed as news arrives, but insurance promises must not be free options revocable after one side learns the outcome is likely.

- **Why high-value —** Negative: buyers wait for a private warning and insurers cancel on bad news, so only certain losses bind.
- **Agent redesign — CUT.** Use firm quote TTL, next-epoch/waiting-period attachment, seed commitment, and noncancellable bound policies. Agents trade liquid cat bonds for changing beliefs instead.
- **Spectator angle —** A bound promise under worsening news is exactly what makes the honor decision meaningful.

---

### 8.3 Solvency, settlement, insolvency, and claims liquidity

### MUST — in descending order

#### SOL1. **Risk-based capital and a public insurer balance sheet** — EVE analogue

EVE exposes wealth and losses but has no formal insurer promises. THE COMPACT needs a transparent measure of how much capital a book must hold against expected and tail loss.

- **Why high-value —** Wealth becomes underwriting capacity but never infinite capacity. A credit locked behind policies cannot simultaneously fund factories, buy orders, territory, or war; aggressive growth becomes an observable solvency bet.
- **Agent redesign — KEEP a simplified tail-capital rule.** Public fields include liquid eligible capital, policy collateral, unearned premium, claim reserve, reinsurance recoverable with credit haircut, gross/net limits, expected loss, required/minimum capital, solvency ratio, near-term liquidity coverage, concentrations, and reverse stresses. Start with `required_capital = max(floor, TVaR99(net seasonal loss) - expected_retained_loss) + counterparty/operational add-ons`. `underwrite` quotes show every delta; `give {purpose:"risk_capital"}` injects capital; withdrawals queue until exposed terms expire. Recalculate only on material events.
- **Spectator angle —** Solvency and liquidity league tables reveal fast-growing insurers and those one event from failure.

#### SOL2. **Phased catastrophe clearing and settlement waterfall** — EVE analogue

EVE resolves destruction immediately, but a network of policies and reinsurance needs ordered settlement so one event does not become an unreadable simultaneous race.

- **Why high-value —** Phases let secured money, cat-bond principal, reinsurance, primary claims, and mutual calls support one another while preserving real liquidity deadlines.
- **Agent redesign — KEEP a short deterministic sequence.** (1) event tick freezes exposure/ownership and computes gross claims; (2) secured tranches, parametric covers, and triggered cat bonds settle; (3) reinsurance recoverables fall due and reinsurers pay/default; (4) primary insurers receive an honor window; (5) mutual assessments fall due; (6) rehabilitation/liquidation begins. A clearinghouse nets reciprocal same-priority cash obligations but never reassigns ring-fenced collateral. `observe.settlement_graph` gives each due tick, dependency, expected recovery, and affordance; webhooks wake parties.
- **Spectator angle —** Animate loss moving from investors to reinsurers to carriers to insureds; viewers can identify where the waterfall breaks.

#### SOL3. **Default, rehabilitation, and deterministic liquidation** — EVE analogue

EVE bankruptcy is mostly social: a wallet can empty, an organization can fail, and creditors improvise. Insurance requires a finite estate procedure once promises exceed capital.

- **Why high-value —** It makes default consequential but parseable and allows rescue, recapitalization, book transfer, or orderly failure instead of a server argument.
- **Agent redesign — KEEP.** Material default or minimum-capital breach starts a brief regulated-zone stay: no new business or withdrawal, but capital injection, reinsurance, claimant restructuring, or book auction is allowed. If unresolved, pay (1) ring-fenced policy collateral/cat SPVs, (2) direct insured claims pro rata, (3) guaranty fund subrogation, (4) other unsecured/reinsurance creditors, (5) subordinated capital, (6) equity/member residual. Frontier forms may disclose a different order, but recovery is public. `pact.offer_recapitalization` and `trade.bid_runoff_book` are typed actions.
- **Spectator angle —** Rescue auctions, creditor recovery meters, rivals deciding whether to save an insurer, and a famous name entering run-off are compelling macro drama.

#### SOL4. **Liquidity distinct from solvency** — EVE analogue

EVE agents can be asset-rich but cash-poor because goods, structures, and contracts take time to sell. An insurer may likewise expect sound recoveries while lacking liquid money at the claim deadline.

- **Why high-value —** The distinction creates emergency lending, asset sales, claim factoring, and hard choices without declaring every timing mismatch fraudulent insolvency.
- **Agent redesign — KEEP two tests.** `solvency_ratio` uses tail-adjusted net assets; `liquidity_coverage` uses cash plus due high-quality recoveries over claims due in the honor window. `observe` identifies the exact gap, assets that can be liquidated, price impact, reinsurance timing, and post-action ratios. Claim deadlines are long enough for one clearing/lending tick but short enough to sustain drama.
- **Spectator angle —** “Solvent if its reinsurer pays, dead tonight if it does not” is the core of a cascade.

### NICE — in descending order

#### SOL5. **Run-off, consensual portfolio transfer, and book auctions** — EVE analogue

EVE assets and organizations can be sold or contracted, but insurance liabilities need policyholder consent and preserved security when moved before loss.

- **Why high-value —** A distressed carrier can stop new business without forcing every healthy policy to default. Better operators can acquire a book, capital, reputation opportunity, and obligations.
- **Agent redesign — ADD.** Whole-book transfer occurs through a resolution auction; voluntary novation requires insured consent and equal-or-better security. Policies remain with the original underwriter otherwise. `observe.runoff_book` exposes anonymized risk mix, remaining premium, claims distribution, capital need, adverse-selection risk, and required consent. State changes only on auction/consent events.
- **Spectator angle —** A book auction is a public vote on whether the failed house had valuable clients or hidden rot.

#### SOL6. **Post-loss claim receivables and recovery markets** — EVE analogue

EVE contracts can sell many rights, while distressed players frequently liquidate assets for immediate cash. An adjudicated claim is a finite receivable that can be sold even when its obligor may default.

- **Why high-value —** Claimants get liquidity; speculators price recovery and become active in workouts; the market produces a real-time confidence signal about an insurer.
- **Agent redesign — KEEP after claims work.** `trade` lists standardized `claim_receivable` lots by face, due tick, priority, security, obligor, and recovery rights on the normal batch book. `observe` shows modeled/market recovery, spread, legal priority, counterparty concentration, and seller liquidity effect. Pre-loss policy liability cannot be dumped this way.
- **Spectator angle —** A claim trading at 38 cents is a live, legible vote on whether a famous underwriter will pay.

#### SOL7. **Penalty emergency liquidity auctions** — EVE analogue

EVE players lend privately against collateral. THE COMPACT can first auction short-term funding to agents and only then offer a narrow Commons facility against high-quality secured recoverables.

- **Why high-value —** It rescues timing mismatches without bailing out insolvent underwriting and gives cash-rich agents a crisis profession.
- **Agent redesign — ADD cautiously.** `contract.kind:"emergency_loan"` or `pact.request_emergency_liquidity` lists amount, eligible collateral, haircut, term, and max rate. Player bids clear first. A Commons facility lends only below the value of secured claim/reinsurance receivables at a punitive published rate; never against reputation or hopeless promise claims. `observe` shows gap closed, collateral liquidation value, post-loan ratios, and lender EV.
- **Spectator angle —** Rivals decide whether to rescue an insurer at usurious rates or let it default on an ally.

#### SOL8. **Restricted investment of insurance float** — EVE analogue

EVE wealthy players invest spare cash in inventory, production, markets, or loans. Real insurers invest premiums and reserves, creating return but also liquidity and asset-liability risk.

- **Why high-value —** Float connects underwriting to the broader economy and makes a carrier's asset choices matter. Too much freedom would let every insurer pyramid promises into speculative industry.
- **Agent redesign — ADD late with eligible-asset rules.** Hard collateral remains cash. A limited part of portfolio reserve may hold short-duration market assets at public haircuts and concentration caps; free capital can invest normally. `observe` shows asset duration, liquidity, haircut, mark-loss stress, correlation with insured catastrophe, and claim cash coverage. Haircuts update only on market clears/risk epochs to avoid high-frequency margin churn.
- **Spectator angle —** An insurer that backed storm risk while investing reserves in the same region becomes a textbook double failure.

### CUTTABLE — remove or defer

#### SOL9. **Full statutory accounting and dozens of collateral classes** — EVE analogue

Real insurers maintain complex reserve, tax, admitted-asset, duration, credit, and capital schedules. A game can represent their strategic consequences without copying the reporting regime.

- **Why high-value —** Low at launch and a large source of exploits, state, and unreadable failure.
- **Agent redesign — CUT initially.** Cash collateral, finite policy terms, one transparent reserve rule, and a few later haircuts are enough. Add complexity only when it creates a decision visible to agents and humans.
- **Spectator angle —** A solvency waterfall is useful; a statutory worksheet is not.

#### SOL10. **Continuous mark-to-model margin calls** — EVE analogue

Financial markets can recalculate collateral continuously as models move. In a 1–5 minute agent tick, that would create constant wakeups and model gaming.

- **Why high-value —** Some credit protection, but at unacceptable inference and stability cost.
- **Agent redesign — CUT.** Revalue at risk epochs, market clears, explicit material forecast changes, and loss events with grace periods. Bound primary coverage is never retroactively repriced.
- **Spectator angle —** Discrete, announced calls are readable; continuous noise is not.

---

### 8.4 Reinsurance, mutuals, and catastrophe capital

### MUST — in descending order

#### RE1. **Facultative reinsurance for one named risk** — EVE analogue

EVE players spread operational risk across allies, but has no formal insurer-of-insurer layer. Facultative reinsurance lets a primary carrier cede part of one large policy or project to another underwriter.

- **Why high-value —** Small insurers can lead valuable unusual risks without owning the entire balance sheet, and capital specialists can select exposures without servicing the insured directly.
- **Agent redesign — KEEP.** `underwrite {operation:"quote",instrument:"facultative_reinsurance",underlying_policy_id,ceded_share_or_layer,premium,security_mode,term}`. The primary remains liable if the reinsurer defaults unless the policy contains a disclosed cut-through endorsement. `observe` supplies the locked underlying snapshot, ceded premium/loss, expected recovery, same-event default correlation, capital relief after credit haircut, settlement priority, and both parties' EV. The underlying adjudicated claim drives recovery automatically.
- **Spectator angle —** The backing graph reveals who actually stands behind a supposedly independent insurer's largest promise.

#### RE2. **Proportional quota-share treaties** — EVE analogue

EVE corporations pool streams of activity; a quota-share treaty similarly passes a fixed share of eligible premiums and losses from a primary book to a reinsurer, often with a commission.

- **Why high-value —** A new insurer can rent balance-sheet capacity and a reinsurer receives a broad portfolio rather than only risks the cedent dislikes. It creates long-lived institutional dependence.
- **Agent redesign — KEEP quota share, add surplus share later.** `pact.kind:"reinsurance_treaty"` defines locked eligibility and underwriting rules (peril, region, asset, security mode, price/term bounds), ceded share, minimum cedent retention, ceding/profit commission, aggregate limit, collateral, audit right, and term. Matching new policies attach automatically; the cedent cannot selectively withhold good risks or stuff changed terms into the treaty. `observe` shows expected ceded premium/loss, loss ratio distribution, mix drift/adverse selection, capital relief, counterparty recovery, concentration, and commission waterfall. Compile the filter once; settlement is share arithmetic.
- **Spectator angle —** View which quiet reinsurer enabled a fast-growing primary house—and how much pain returns when the book goes bad.

#### RE3. **Occurrence excess-of-loss and aggregate stop-loss towers** — EVE analogue

Reinsurance can pay only after a primary's retained event loss crosses an attachment, up to a layer limit; aggregate covers can protect a whole season. EVE has no equivalent formal tower, but its layered fleets/coalitions similarly absorb loss at different scales.

- **Why high-value —** This is the primary tool for turning correlated tail loss into a survivable retention. Attachment, exhaustion, event definition, price, and counterparty quality make portfolio architecture strategic.
- **Agent redesign — KEEP three templates:** per-risk XoL, per-occurrence catastrophe XoL, and seasonal aggregate stop-loss. `pact` terms specify peril/territory, attachment, limit, aggregate, occurrence window, reinstatements and premium, security, and term. Payout is `min(limit_remaining,max(0,covered_cedent_loss-attachment))`. `observe` displays the whole tower, gaps/overlaps, exhaustion probability, net exceedance curve, counterparty default, reinstatement cost, and marginal capital. Aftershocks aggregate through the public occurrence window.
- **Spectator angle —** Render the tower filling layer by layer; the last solvent top-layer reinsurer can become the galaxy's central character.

#### RE4. **Agent-owned mutuals with assessments and withdrawal queues** — EVE analogue

EVE corporations and alliances pool treasury, assets, and defense. THE COMPACT makes a syndicate literally share member risk through an agent-governed mutual.

- **Why high-value —** This fuses insurance and politics: members choose admission, contributions, standards, reinsurance, assessments, and whether to save one another after a shock. The capital call creates a second signature promise/default moment.
- **Agent redesign — KEEP standardized bylaws.** `pact {operation:"create_mutual"|"join_pool",eligible_perils/regions/assets,member_deductible,contribution_formula,assessment_cap,seasoning_ticks,withdrawal_notice,payout_priority,governance,reinsurance_authority}`. Ex-ante capital is owned by the pool; ex-post assessments are unsecured obligations that members `give` or `default`. `observe` shows member exposure/contribution fairness, concentration, call probability/amount, pool solvency, vote state, withdrawal queue, and member default record. Joining after a warning does not cover the imminent epoch.
- **Spectator angle —** Safe-region members voting or refusing to rescue frontier losses turns a balance sheet into alliance drama.

#### RE5. **Collateralized catastrophe bonds** — EVE analogue

EVE lets players buy assets that express market views, but has no catastrophe security. A cat bond locks investor principal in a ring-fenced vehicle; a defined catastrophe trigger releases some or all principal to an exposed sponsor, while no-trigger maturity returns it with coupon.

- **Why high-value —** It brings capital from agents who do not want to underwrite claims, creates reliable pre-funded protection, and produces a traded market price for catastrophe risk.
- **Agent redesign — KEEP after basic reinsurance.** `trade {operation:"issue",instrument:"cat_bond",sponsor_id,peril,region,trigger_type:"parametric"|"modeled_loss"|"industry_loss",attachment,exhaustion,notional,coupon,maturity,model_version}`. Sponsor must prove exposure and escrow the coupon stream; investors escrow principal. Principal loss scales from zero at attachment to full at exhaustion and auto-settles. `observe` shows trigger probability, expected principal loss, coupon yield, price/fair-value range, duration, basis risk, correlation contribution, liquidity, and worst case. Exclude agent-triggerable raids.
- **Spectator angle —** Bond prices collapse as a cone tightens, then principal visibly becomes reconstruction capital—or returns to investors after a near miss.

#### RE6. **Retrocession with stable risk fingerprints and anti-spiral rules** — EVE analogue

Reinsurers can reinsure themselves, but circulating the same loss around a network can create false diversification. EVE's alliance/alt networks similarly obscure ultimate ownership unless relationships are traced.

- **Why high-value —** One or two additional layers enable real global diversification and systemic contagion; unlimited recursion creates an exploit and an unreadable settlement graph.
- **Agent redesign — KEEP bounded retrocession.** Every exposure/layer carries a stable `risk_fingerprint` derived from event, peril, subject, and coverage layer. The graph calculates effective gross/net ownership through cessions. Commons forbids circular same-fingerprint cession; Frontier may permit it but grants zero capital relief and labels the loop. Same-scenario reinsurers receive credit haircuts. Cap settlement-depth recursion (for example three financial layers) while allowing syndication within each layer.
- **Spectator angle —** Reveal that four “diversified” houses passed the same storm risk in a circle; the contagion map becomes a mystery solved in public.

### NICE — in descending order

#### RE7. **Secondary cat-bond and claim markets; consented policy novation** — EVE analogue

EVE's order books excel at repricing fungible claims on value. Cat bonds are fungible enough to trade freely, while a primary policy promise is identity-specific and should not be dumped on a worse insurer without consent.

- **Why high-value —** Secondary prices aggregate new forecasts and let investors exit; controlled novation preserves the counterparty the buyer chose.
- **Agent redesign — KEEP distinctions.** Cat bonds trade on batch books; adjudicated claims trade as receivables; run-off books auction; pre-loss insured rights transfer with the asset/interest; underwriter liability transfers only with policyholder consent and equal-or-better security. `observe` shows market-implied trigger/default/recovery against the reference model and liquidity/spread.
- **Spectator angle —** The cat-bond tape and claim-recovery curve become leading indicators before a carrier speaks.

#### RE8. **Sidecars and dedicated reinsurance pools** — EVE analogue

EVE investors can fund specialist corporations; a reinsurance sidecar similarly lets outside capital take a ring-fenced share of a skilled underwriter's new book.

- **Why high-value —** Agents with capital but weak selection ability can follow a proven lead, while the lead earns a management/profit share without pretending the capital is its own.
- **Agent redesign — ADD as a fully collateralized proportional treaty, not a new corporate subsystem.** Terms include immutable book filter, capital cap, manager fee, profit share, loss cap, term, and withdrawal. `observe` shows lead calibration/history, book drift, capital utilization, expected loss/return, and conflicts. Investors cannot withdraw principal while attached.
- **Spectator angle —** Capital floods into a star underwriter's sidecar, then the catastrophe tests whether reputation deserved leverage.

#### RE9. **Reinsurance reinstatements and exhaustion markets** — EVE analogue

After a catastrophe consumes an EVE fleet reserve, alliances must rebuild before the next fight. Reinsurance layers can likewise be restored for another event by paying a pre-agreed reinstatement premium.

- **Why high-value —** A first storm does not end the season; deciding whether to buy back protection versus preserve cash creates a post-loss risk decision.
- **Agent redesign — KEEP only as an option encoded at bind.** A treaty lists zero, one, or two reinstatements, price formula, remaining aggregate, and activation deadline. `underwrite.operation:"reinstate"` pays and relocks capital. `observe` gives aftershock forecast, remaining naked exposure, premium, capital delta, and alternative market quotes.
- **Spectator angle —** A devastated insurer choosing to remain exposed for the next forecast wave is immediate tension.

### CUTTABLE — remove or prohibit

#### RE10. **Naked catastrophe/default derivatives** — EVE analogue

A naked derivative would let an agent profit from another party's catastrophe or default without owning an exposed asset, policy, bond, or claim.

- **Why high-value —** Price discovery is outweighed by incentives to sabotage player-triggerable losses, attack counterparties, and manipulate oracles.
- **Agent redesign — CUT.** Require insurable interest or sponsor exposure for policies/cat bonds. Permit post-loss claim trading and fully collateralized catastrophe investment, not anonymous bets on a named agent's ruin.
- **Spectator angle —** Spectacle is not worth converting the economy into a sabotage engine.

#### RE11. **Unlimited recursive retrocession** — EVE analogue

Real and player financial networks can layer obligations repeatedly, hiding who ultimately owns a loss.

- **Why high-value —** Past a small number of layers, it adds state and false risk relief rather than decisions.
- **Agent redesign — CUT.** Fingerprint risk, give no relief to cycles, cap financial settlement depth, and report ultimate effective ownership.
- **Spectator angle —** A three-layer graph can be understood; a hundred-node recursion cannot.

#### RE12. **Free transfer of an insurer's liability** — EVE analogue

EVE items are transferable, but an insurance buyer chose a specific promise and security record. Letting the writer sell that obligation unilaterally destroys underwriting identity.

- **Why high-value —** Negative; the cheapest weak counterparty would end up holding every liability.
- **Agent redesign — CUT.** Require policyholder novation consent or formal run-off resolution. Freely trade only pre-funded cat bonds and adjudicated receivables.
- **Spectator angle —** Betrayal must belong to the named promisor, not a liability shell game.

---

### 8.5 Jurisdiction, newcomers, backstops, and bounded contagion

### MUST — in descending order

#### GOV1. **Commons → Marches → Frontier → Deeps insurance law** — EVE analogue

EVE security status changes enforcement, permissible actions, and practical recovery. THE COMPACT should similarly make policy security and resolution vary by geography while preserving one universal loss/claim/default ledger.

- **Why high-value —** It creates a safe entry floor plus regulatory arbitrage. Agents knowingly trade premium for enforceability: reliable Commons cover, mixed Marches capacity, cheap Frontier promises, or pre-funded Deeps protection.
- **Agent redesign — KEEP a published ladder.** Commons: standard forms, licensed carriers, `SECURED` starter coverage and regulated `RESERVED`, perhaps 150% reference solvency, automatic pro-rata reserve settlement, levy, capped guarantee. Marches: `SECURED/RESERVED`, lower reference floor (e.g. 110%), optional guarantee, rehabilitation. Frontier: all modes, no compulsory capital/backstop, contractual waterfall. Deeps: default to pre-funded parametric/voyage instruments unless a party explicitly accepts promise risk. Every quote shows jurisdiction, seizure/enforcement reach, levy, security, guarantee cap, historic recovery, and net premium.
- **Spectator angle —** Capital migrates toward high-yield lawless underwriting, then flees toward safety after a spectacular default.

#### GOV2. **Capped, pre-funded Commons guaranty fund** — EVE analogue

EVE's NPC insurance is system-guaranteed. THE COMPACT instead uses a narrow pool funded by Commons premium levies, member assessments, estate recoveries, and potentially repayable fund debt.

- **Why high-value —** A newcomer should not lose its first venture because it chose an unknown carrier, but unlimited public payment would erase counterparty discipline and become an inflationary bailout.
- **Agent redesign — KEEP narrow protection.** Cover perhaps 80% of unpaid eligible balance up to two starter-asset replacement values; exclude Frontier/war/fraud/investments and amounts above cap. Premium levies and member assessments scale with security mode, expected loss, and carrier solvency so weak writers do not receive a flat-price guarantee subsidy. `observe.guaranty_fund` shows cash, expected/stress claims, cap, risk-based levy, assessment capacity, debt, and exhaustion probability. If depleted, recovery haircuts or future assessments rise; the server does not mint unreported money. The fund subrogates into liquidation.
- **Spectator angle —** A reserve gauge falls during catastrophe while solvent insurers face a visible assessment and argue about who caused it.

#### GOV3. **Newcomer microinsurance and day-one secured underwriting** — EVE analogue

EVE gives new pilots a basic insurance path but its player economy is difficult to price at first. THE COMPACT's guided loop should include comparing, buying, and later writing a tiny standardized policy.

- **Why high-value —** It teaches risk-adjusted choices before a fatal mistake and lets an unseasoned agent contribute capital immediately without asking anyone to trust its future promise.
- **Agent redesign — KEEP.** The first Commons venture gets a capped micro-policy offer with deductible/coinsurance and partly starter-funded premium; it cannot be cashed, overinsured, or assigned separately. A new agent may immediately underwrite `SECURED` micro-lines because maximum payout is posted. `observe.prompt` compares premium, expected/recovery-adjusted payout, retained loss, ruin delta, and security. Records use credible cohort priors; no history means `UNSEASONED`, not untrustworthy.
- **Spectator angle —** Follow a newcomer's first extract→build→sell→insure loop and eventually its rise into a respected carrier.

#### GOV4. **Systemic cascade graph with bounded safety valves** — EVE analogue

EVE wars propagate through ship losses, markets, alliances, and industry. A catastrophe can add claims → reinsurance calls → reinsurer default → primary default → mutual assessments → fire sales → production/logistics shortage.

- **Why high-value —** This is the richest macro spectacle in the design and the real test of underwriting. Unbounded instantaneous contagion, however, can erase the entire single shard before agents can act.
- **Agent redesign — KEEP the loss, bound only timing and entry-floor damage.** `observe.systemic_risk` exposes direct/second-order exposure, liquidity gaps, recoveries, reverse stresses, shared collateral/suppliers, and due ticks. Safety valves are phased settlement, clearing netting, ring-fenced collateral, short Commons/Marches stay, queued mutual withdrawals, capped guarantee, run-off transfer, delayed—not cancelled—market circuit breakers, player emergency funding, and permanent Commons production. Never cap a loss merely to protect a large incumbent.
- **Spectator angle —** A contagion view names patient zero and highlights every failed layer, fire sale, and surviving institution.

#### GOV5. **Beneficial ownership, related-party flags, and one real capital base** — EVE analogue

EVE allows alternate characters and corporations, making economic affiliation difficult to infer. An agent-first world would be especially vulnerable to carriers “reinsuring” themselves, farming starter support, or staging affiliate losses.

- **Why high-value —** If one owner can multiply capital or reputation by spawning shells, the public actuarial record and backstop become meaningless.
- **Agent redesign — KEEP a platform-level beneficial-owner graph while acknowledging uncertainty.** Exact owner identity can remain private, but the engine marks `related`, excludes self-matching volume and circular capital relief, aggregates starter/guarantee caps, and exposes affiliate concentration bands. Transfers cannot create net capital. Unknown affiliation adds a transparent uncertainty/haircut rather than claiming perfect detection.
- **Spectator angle —** Investigations can reveal that apparently independent carriers were one risk complex without doxxing external humans.

#### GOV6. **Risk-market fees that are sinks, never fake underwriting profit** — EVE analogue

EVE uses market/industry fees and taxes as ISK sinks. THE COMPACT's premiums and claims are player transfers, so risk infrastructure needs its own modest, explicit system charges.

- **Why high-value —** The risk market immobilizes capital but does not itself remove money. Filing, clearing, audit, bond issuance, and dispute administration can provide durable sinks without distorting claim incentives.
- **Agent redesign — KEEP.** Candidate burned charges: policy stamp/listing fee, clearing/oracle fee, model-data/license fee, cat-bond issuance/trading levy, liquidation administration, and a portion of forfeited dispute/fraud bonds. Commons premium levy funds the guaranty pool and is a transfer to that fund until spent, not a sink. Every policy quote separates premium, player commission, guarantee levy, and burned fee.
- **Spectator angle —** View the premium river split into carrier income, reinsurance, public protection, and actual currency burn.

### NICE — in descending order

#### GOV7. **Rehabilitation after default without erasing the scar** — EVE analogue

EVE reputations can recover through years of behavior even after betrayal, though history remains. A permanent ban would freeze incumbents and remove comeback stories.

- **Why high-value —** Default must hurt without making the rational response “abandon this identity and spawn another.” Costly rehabilitation encourages persistent agents and tests whether markets forgive.
- **Agent redesign — KEEP.** A defaulter can write only `SECURED` business at first, repay estate claims, complete bonded service, rebuild capital, and accumulate a fresh timeliness sample. The ledger never deletes the old default and quotes still expose severity/age/recovery, but credibility weights recent behavior. Jurisdictions restore `RESERVED` permission through explicit thresholds.
- **Spectator angle —** A notorious defaulting house fighting back to trusted status is a multi-season character arc.

#### GOV8. **Delayed circuit breakers for disorderly risk-security markets** — EVE analogue

EVE sometimes adjusts systems during extreme conditions, while real exchanges pause disorderly markets. Hard price caps would conceal distress, but a one-tick pause can prevent a cascade from being decided by one bad batch.

- **Why high-value —** Cat-bond and claim markets need time for agents to receive the event and update beliefs at the game's cadence.
- **Agent redesign — ADD narrowly.** Trigger only on prepublished data-integrity or price-gap conditions; pause one tick, cancel no valid obligation, widen quote warnings, and reopen through a call auction. Primary claim deadlines also shift by that one published tick. Never use breakers to hold prices near a desired level.
- **Spectator angle —** A visible halted market and reopening auction heighten rather than hide panic.

### CUTTABLE — prohibit

#### GOV9. **Unlimited NPC bailout or secret stability intervention** — EVE analogue

An administrator could quietly fund claims or reverse catastrophe losses to preserve numeric stability.

- **Why high-value —** Negative: it creates moral hazard, inflation, favoritism suspicion, and makes every promise less meaningful.
- **Agent redesign — CUT.** Every backstop has a published fund, eligibility, cap, haircut, and exhaustion state. Emergency credit is collateralized and repayable; catastrophic empires are allowed to fail while the Commons entry floor survives.
- **Spectator angle —** Hidden rescue would invalidate the whole show; a visibly depleted, rule-bound fund strengthens it.

#### GOV10. **Permanent exclusion of new or previously defaulted agents** — EVE analogue

EVE's long history and character age can become an incumbent moat. Risk reputation could make that worse if “no record” or one old default mechanically forbids future activity.

- **Why high-value —** Negative: established houses monopolize underwriting and identity abandonment beats persistence.
- **Agent redesign — CUT.** Cohort priors, fully secured day-one lines, bounded microinsurance, recent-behavior credibility, repayment, and staged license restoration preserve entry while pricing the scar.
- **Spectator angle —** The world gains rise, fall, and redemption rather than a permanent caste.

---

## 9. How the whole economy interlocks

### 9.1 One asset should touch most professions

An illustrative **Frontier catastrophe-shield array** is not “500 ore → shield.” Its direct bill of materials could be:

| Direct input | Upstream chain | Geography/professions created |
|---|---|---|
| 800 structural alloy | ore → compression → refining → alloy | high-volume Commons/Frontier miners, refiner, bulk freight |
| 60 coolant assemblies | planetary extraction → P1 → P2 processors → customs export | colony operators, customs owner, hauler |
| 20 barrier membranes | unstable gas + rare moon element → chemical/composite reaction | explorer, gas harvester, moon owner/tenants, dangerous-space reactor |
| 8 sensor cores | wreck salvage + research data + planetary electronics → component job | salvager, scanner, data trader, electronics producer |
| 1 researched design copy | original → ME/TE research → copy; advanced version requires invention/datacores | design owner, lab, copy licensor, inventor |
| Installation fuel and facility time | volatiles + planetary mechanical goods → fuel; specialized factory | ice/volatile harvester, fuel producer, factory owner |

The final assembler may buy every input, vertically integrate two stages, commission components through work orders, reserve freight, and insure work in progress. It should be economically implausible for one ordinary agent to own the best extraction, research, reaction, assembly, logistics, market, and underwriting operation at once.

### 9.2 The catastrophe-to-rebuild economic sequence

1. **Forecast:** the public storm probability rises. Shield membranes, fuel, freight, secured policies, reinsurance, and cat bonds reprice; agents decide whether to evacuate, fortify, speculate, or dismiss the model.
2. **Pre-positioning:** order-book depth thins, factories queue shields and repair kits, couriers raise collateral/reward, blockaders move to critical routes, insurers stop quoting concentrated regions but cannot cancel bound promises.
3. **Event:** one spatial catastrophe destroys facilities, finished shields, haulers, stock, and infrastructure according to exposure/vulnerability. The commodity stock falls; the currency stock does not.
4. **Claims:** secured tranches and cat bonds auto-pay, reinsurance falls due, insurers honor/default, mutuals assess members, and the guaranty fund covers only its capped Commons layer. These are transfers except any explicitly labeled public subsidy.
5. **Liquidity shock:** claimants have purchasing power but replacement supply is finite. Prices and freight rewards rise; distressed insurers sell inventories and claims; factories compete for fuel and inputs.
6. **Reconstruction:** miners, salvagers, haulers, researchers, component makers, and builders earn the rebuild boom. New entrants can supply basic goods from the Commons. Catastrophe may expose new frontier deposits, giving the displaced somewhere to go.
7. **Memory:** every forecast, mitigation, policy, payment, default, recovery, price, and rebuilt asset remains queryable. Rates and relationships change because of observed behavior, not a reset button.

This sequence is the product. The visual event is the storm, but the lasting drama is who prepared, who profited, who honored, who defaulted, and who rebuilt.

### 9.3 Spectator layers that connect cause to effect

The spectator client should synchronize six views at the same scrubbed tick:

- **Resource:** reserves, extraction, discovery, depletion, ownership, and moon timers.
- **Industry:** facility utilization, queues, fuel horizon, dependency bottlenecks, and work in progress at risk.
- **Market:** regional prices, depth, volume, inventories, hub flows, concentration, and forward/cat-bond signals.
- **Logistics:** route throughput, convoys, blockades, capacity, tolls, losses, and delayed manifest value bands.
- **Risk:** insured value, rate-on-line, security mix, tail concentration, reinsurance graph, cat-bond price, and forecast cone.
- **Settlement:** losses, claims, honor clocks, payments/defaults, mutual calls, recoveries, liquidation, and reconstruction spend.

The spectator consumes the same public event stream, aggregation, staleness, and location/manifest redaction available to agents; a beautiful UI must never become privileged route or warehouse intel. An auto-narrator may infer a causal headline only from signed events and declared relationships, and must label inference: “Barrier resin rose after the forecast” is fact; “Vale probably knew early” is an inference supported by its timestamped trades and private-signal disclosure.

---

## 10. Simulation and rollout constraints

### 10.1 Deterministic economic tick order

Use one authoritative ordering so no subsystem observes a half-resolved world:

1. Freeze the opening snapshot and accept idempotent actions until tick close.
2. Validate/escrow commitments and expire stale quotes.
3. Clear regional markets and contract auctions; publish prices and transfers.
4. Advance extraction, industrial jobs, colonies, fuel/upkeep, routes, and declared operations.
5. Resolve scheduled hazard/catastrophe and asset-loss events from committed seeds.
6. Create/adjudicate claims and advance the multi-tick settlement/reinsurance/default waterfall.
7. Apply insolvency/capital/access state changes, append the immutable ledgers, snapshot, and emit deltas/webhooks.

Within-tick actions never react to another within-tick action. An agent acts from snapshot `T`; all valid actions become part of `T+1`. That removes latency advantage and makes replay exact.

### 10.2 A complete miniature, then the full lattice

Phase 0 must be a **complete miniature economy**, not a mining demo:

- 30–40 systems across a safe Commons, Marches, and one Frontier;
- 6 raw families, roughly 10 refined goods, 12–18 intermediates/components, 12–20 finished assets/consumables, and 35–50 recipes with real cross-region dependencies;
- ore/volatiles/gas plus one scheduled moon resource; reprocessing, one reaction family, manufacturing, basic BPO/BPC/copy, and one advanced invention chain;
- three regional books with physical settlement, fees, price/depth history, item exchange, courier collateral, and work orders;
- three hauler roles, chokepoints, one blockade operation, convoys, fuel, storage, and no Frontier teleport recovery;
- one correlated catastrophe, named-property and cargo cover, `SECURED/RESERVED/PROMISE`, one simple XoL reinsurance layer or mutual, public ledger, and explicit pay/default;
- separate money/item ledgers and a live mini-MER from the first simulation.

Phase 1 expands to the full target catalog, PI, more reactions/invention, player exchanges/facilities, jump freight, customs, treaties, mutual governance, cat bonds, solvency resolution, and multi-peril correlation. Phase 2 expands regions, Deeps routes/Tech III analogue, secondary risk/credit markets, and richer systemic recovery. No later phase changes the core accounting contract.

### 10.3 Acceptance tests for “the economy sings”

Do not call the vertical slice successful until all are true:

1. No advanced finished asset can be sourced efficiently from one region or one profession.
2. A destroyed fleet and a catastrophe both cause measurable, explainable input/finished-price responses and replacement production.
3. At least mining, production, market-making/arbitrage, hauling, and underwriting sustain viable but changing margins for independent agents.
4. Same-tick model latency never changes order priority or operation outcome.
5. Every production/trade/haul/policy decision can be priced from one canonical quote without an external wiki, and every uncertainty names its source.
6. Faucets/sinks balance the currency over long windows while asset destruction/rebuilding remains independently volatile.
7. One correlated event can stress several insurers and create a voluntary default, but cannot eliminate the Commons entry loop.
8. A newcomer can earn transferable value in its first cycle and contribute to a mature syndicate without owning rare knowledge or territory.
9. A human can scrub from a commodity spike to its forecast, route, production bottleneck, catastrophe, claim, default, and rebuild.

---

## 11. Primary source anchors

EVE mechanic descriptions above are grounded mainly in current official material:

- Industry and extraction: [Introduction to Mining](https://support.eveonline.com/hc/en-us/articles/23655785488668-Introduction-to-Mining), [Resource Distribution Update](https://www.eveonline.com/news/view/resource-distribution-update), [Moon Mining](https://support.eveonline.com/hc/en-us/articles/115005404229-Moon-Mining), [Metenox Moon Drill](https://support.eveonline.com/hc/en-us/articles/14341380413212-Metenox-Moon-Drill), [Blueprints](https://support.eveonline.com/hc/articles/203269951), [Manufacturing](https://support.eveonline.com/hc/en-us/articles/203210292-Manufacturing), [Material Efficiency](https://support.eveonline.com/hc/en-us/articles/203210542-Material-Efficiency-Research), [Time Efficiency](https://support.eveonline.com/hc/en-us/articles/203210512-Time-Efficiency-Research), [Invention](https://support.eveonline.com/hc/en-us/articles/203210642-Invention), [Reactions](https://support.eveonline.com/hc/en-us/articles/115005405785-Reactions), [Planetary Interaction](https://support.eveonline.com/hc/en-us/articles/203269871-Planetary-Interaction), and [Customs Offices](https://support.eveonline.com/hc/en-us/articles/203269921-Customs-Offices).
- Markets and contracts: [Buy and Sell Orders](https://support.eveonline.com/hc/en-us/articles/203218932-Buy-and-Sell-Orders), [Broker Fee and Sales Tax](https://support.eveonline.com/hc/en-us/articles/203218962-Broker-Fee-and-Sales-Tax), [Item Exchange](https://support.eveonline.com/hc/en-us/articles/206758389-Item-Exchange-Contract), [Courier Contracts](https://support.eveonline.com/hc/en-us/articles/203218982-Courier-Contracts), and [Auction Contracts](https://support.eveonline.com/hc/en-us/articles/203280371-Auction-Contracts).
- Money, loss, and logistics: [Currencies](https://support.eveonline.com/hc/en-us/articles/14216227951388-Currencies), [Insurance](https://support.eveonline.com/hc/en-us/articles/212726885-Insurance), [June 2026 Monthly Economic Report](https://www.eveonline.com/news/view/monthly-economic-report-june-2026), [Jump Cooldown and Fatigue](https://support.eveonline.com/hc/en-us/articles/212726865-Jump-Activation-Cooldown-and-Jump-Fatigue), and [Abandoned Structures / no asset safety](https://support.eveonline.com/hc/en-us/articles/360014282739-Upwell-Structures-Abandoned-State).
- Risk-market grounding: [ASOP 53 on prospective property/casualty cost](https://www.actuarialstandardsboard.org/asops/estimating-future-costs-prospective-propertycasualty-risk-transfer-risk-retention/), [NAIC catastrophe-model overview](https://content.naic.org/insurance-topics/catastrophe-models-property), [NAIC risk-based capital](https://content.naic.org/insurance-topics/risk-based-capital), [NAIC reinsurance overview](https://content.naic.org/cipr_topics/topic_reinsurance.htm), [World Bank catastrophe-bond trigger note](https://documents1.worldbank.org/curated/en/099050306222242278/pdf/P1637800d3753c0f60be4a03472b063ccf0.pdf), and [NAIC guaranty associations](https://content.naic.org/insurance-topics/guaranty-associations-and-funds).

---

## 12. The five highest-value features in this entire pass

1. **A geographically interlocked production lattice.** Spatially distinct ore, volatiles, gas, moon, planetary, salvage, and data inputs flow through refining, reactions, research, components, fuel, and final assembly. This is the root of professions, trade, territory, replacement demand, and war.
2. **Regional order books with physical settlement and dangerous delivery.** Price differences remain real until an agent commits inventory, time, vehicle capacity, collateral, route intel, and loss exposure. Tick-batched clearing keeps it strategic instead of latency-driven.
3. **The public actuarial/behavioral ledger feeding actual price and capacity.** Every promise, exposure, mitigation, claim, payment, delay, default, recovery, and related-party link becomes a priced record with credibility and uncertainty—not a cosmetic reputation badge.
4. **`SECURED / RESERVED / PROMISE` coverage culminating in an explicit honor/default deadline.** Buyers select certainty versus price; underwriters commit real capital; a correlated event reveals whether the named promisor pays or saves itself. This is THE COMPACT's signature mechanic.
5. **Correlated catastrophe portfolios connected through reinsurance towers, mutual calls, and cat bonds.** Shared regional events make diversification, concentration, capital, counterparty selection, reconstruction, and systemic cascades real; cat-bond and claim prices turn the forecast into spectator-visible belief.

If only three are excellent, build 1, 2, and 4. If 1 and 2 are weak, the risk market is an abstract casino. If 4 is weak, this is merely EVE with better APIs.

## 13. EVE economic mechanics actively bad for an agent game—and the replacements

| Bad transplant | Why it is bad here | Replacement |
|---|---|---|
| Repeated mining laser cycles and individual-rock targeting | Spends inference on a solved attention loop | One bounded `extract` operation with mode, horizon, and retreat/EV stops |
| PI pin placement, routing clicks, and extractor restarts | UI tolerance masquerading as industrial depth | Declarative colony flow templates with capacity, depletion, tax, and storage |
| Continuous 0.01-price relisting | Rewards polling latency and compute budget | One tick call auction, resting priority, pro-rata same-tick ties, cancellation bond |
| Hidden fee/yield/industry arithmetic and external-spreadsheet dependency | Agents fail on interface opacity instead of price/risk judgment | Canonical signed quote envelope, native recipe DAG, exact factor breakdown |
| Passive skills, standings discounts, and account-age job slots | Entrenches old identities and alt multiplication | Physical facility capacity, designs, current service record, capital, and priced reservations |
| Legacy unrepeatable Tech II BPOs | Permanent launch-era monopoly with no counterplay | Contestable invention plus discoverable, expiring, leaking, or finite advanced rights |
| All-or-nothing invention click spam | Adds noisy dice and wakeups, not portfolio strategy | Batched explicit distributions, partial progress/output, bounded variance |
| Near-duplicate ores, crystals, modules, and meta rows | Taxonomy bloat increases tokens and lookup errors | Smaller families with grade, purity, wear, provenance, and meaningful modules as properties |
| Gate-by-gate travel and slower autopilot | Repeated commands add cost without decisions | Persistent route commitment with policy-based interrupts and real multi-tick exposure |
| Cyno alts and multibox logistics | Requires extra agents/accounts to hold buttons | Persistent fueled/jammable beacons and contracted infrastructure services |
| Personal exponential jump fatigue | Opaque timers encourage identity workarounds | Shared corridor capacitor/capacity plus short visible vehicle heat |
| CONCORD-style retaliation as the only newcomer protection | A rich attacker can still delete the entrant before punishment | True unauthorized-attack prevention in the permanent Commons; retaliation starts in Marches |
| Magical full asset safety in dangerous space | Erases warehousing, evacuation, siege, freight, and insurance stakes | Commons recovery; partial paid Marches recovery; physical Frontier evacuation/salvage/insurance |
| Unlimited/free station storage | Makes hoarding the universal hedge and removes warehouse geography | Generous starter allowance, then physical capacity and slow transparent rent |
| NPC insurance as the dominant coverage | Guaranteed formula payout crowds out the core social market | Tiny Commons backstop; player `SECURED/RESERVED/PROMISE` policies elsewhere |
| PLEX convertible from real money into productive wealth | Lets outside spend buy industrial/underwriting power and pollutes behavior | Nontransferable external hosting/cosmetic entitlements, economically firewalled from Credits |
| Liquid transferable starter stipends | Autonomous identities turn onboarding into a Sybil faucet | Bound starter assets/work credits plus capped contribution-based public procurement |
| Confusable item names, fat-finger trades, and contract parser traps | Measures payload mistakes, not strategic deception | Canonical IDs, quote/slippage guards, typed terms, valuation, access guarantees |
| Perfectly fresh free global market intelligence | Collapses scouting and most spatial arbitrage | Live local books, delayed explicit remote summaries, paid/scouted freshness |
| Treating destroyed assets as an ISK sink | Leaves currency inflation unmanaged | Separate currency faucets/sinks from item sources/destruction in every ledger and MER |
| Fully collateralized insurance only | Deletes insurer solvency, trust, and betrayal | Three security modes with a deliberate unsecured honor layer |
| Fully unsecured insurance only | Fake cheap capacity dominates before the first event | Minimum bonds/reserves, recovery-adjusted quotes, capital record, jurisdiction ladder |
| One opaque risk score or mandated “fair” premium | Removes underwriting disagreement and auditability | Decomposed reference model plus agent-set prices and private models |
| Independent catastrophe rolls per asset | Makes correlation/reinsurance/systemic failure irrelevant | Shared spatial footprints, intensities, aftershocks, and dependency loss |
| Natural-language policy exclusions and LLM claim litigation | Nondeterministic, expensive, and impossible to price | Versioned forms, server facts, structured contests, bonded bounded adjusters |
| Free transfer of insurance liabilities or naked default bets | Breaks the identity of promises and rewards sabotage | Consented novation, run-off auctions, insurable interest, cat bonds, post-loss claim trading |
| Unlimited NPC bailout | Inflates money and rewards reckless carriers | Pre-funded capped guarantee, published exhaustion, secured penalty liquidity, real failure |

The principle behind every replacement is the same: **preserve the capital, geography, uncertainty, commitment, and other-agent dependence; remove the clicking, opacity, latency, legacy privilege, and accidental parsing difficulty.**
