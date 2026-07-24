# THE COMPACT — Industry, Economy, Markets, Logistics, and the Risk Market

*Ranked deep-design pass · 2026-07-24*

## Design position

EVE's economic achievement is not “lots of crafting.” It is that **resources, knowledge, productive capacity, goods, capital, and risk are all owned by players, located somewhere, committed for time, and losable in transit or use**. THE COMPACT should preserve that causal chain while removing cockpit dexterity, repetitive clicks, external spreadsheets, reaction-speed advantages, and formulas an agent cannot inspect.

The governing choices for this pass are:

1. **Almost every useful asset is agent-made.** Civic issuers may seed starter leases, basic master patterns, and bounded recovery goods; they should not compete with mature producers.
2. **No region is self-sufficient.** Complementary resource baskets, restricted processing, and physical settlement make trade and logistics necessary rather than optional role-play.
3. **Known arithmetic is exact; genuine uncertainty stays uncertain.** Recipes, taxes, fees, order-book depth, collateral, and current holdings are machine-readable. Undiscovered nodes, future prices, hostile intent, catastrophe intensity, and route loss remain sourced probability bands.
4. **A job is a durable intent, not a stream of clicks.** Extraction, hauling, production, and routine underwriting run for several ticks under explicit stop conditions. The agent wakes for completion, contention, a price/risk threshold, or a deadline.
5. **Items and currency are separate ledgers.** Extraction creates items; production transforms items; loss destroys items. Only named faucets create currency and only named sinks destroy it. Trades, premiums, claims, loans, and most facility fees merely transfer currency.
6. **Capital is powerful because it can be committed and lost.** The same credits or asset cannot simultaneously back a market bid, production job, courier collateral, war, and policy. All commitments lock atomically.
7. **Insurance is hybrid-secured.** Only currency placed in a Commons-safe **final settlement escrow** is called certain collateral and pays automatically. Locally custodied reserves remain physically exposed, receive peril/liquidity haircuts, and are never represented as certain. An intentionally unsecured tail remains an elective promise that an underwriter can honor, restructure, selectively pay, or default on. Full escrow would remove the signature betrayal; no escrow would enable fake insurers.
8. **The Commons supplies continuity, not the best margins.** It guarantees a productive floor, a basic market, and bounded civic cover. Rare inputs, high industrial efficiency, leverage, sovereignty, and large underwriting returns require exposure elsewhere.

### Rank and decision vocabulary

- **MUST** — required for the economy to become an interdependent world.
- **NICE** — durable depth after the core loop is stable.
- **CUTTABLE** — remove or defer before it is allowed to burden the API.
- **KEEP** — preserve the mechanic's economic function.
- **SIMPLIFY** — preserve the strategic decision while replacing EVE's interface or granularity.
- **CUT** — the mechanic is actively worse for autonomous agents.

### Shared machine-facing economic contract

Every feature card below inherits these rules; its **Agent redesign** names the additional fields and verbs it needs.

| Object | Required fields and behavior |
|---|---|
| `economic_quote` | `quote_id`, `terms_hash`, `state_version`, `as_of_tick`, `expires_tick`, exact inputs/outputs, facility, fees/taxes, locks, duration, cancellation/interruption rule, and settlement location. Committing a stale quote returns a fresh preview; it never guesses. |
| `ev` | Executable revenue at order-book depth, input and fee cost, route cost, expected loss, capital locked, time-to-cash, downside quantiles, opportunity cost, confidence, and break-even price. It is a deterministic calculator, not an instruction to act. |
| `provenance` | Source, observation tick, visibility, confidence, event IDs, recipe/rules version, and whether a number is fact, estimate, counterparty assertion, or model output. |
| `affordance` | Canonical verb, JSON parameter schema, resource locks, `max_direct_loss`, `max_contingent_liability`, approvals, non-action result, idempotency key, and optional `dry_run`. |
| `standing_policy` | Scope, budget/capacity, price and risk bounds, stop conditions, expiry, review trigger, and deterministic fallback. It leaves the same signed receipts as a live decision. |
| `dependency_graph` | On-demand, versioned bill of materials and facility/route dependencies; compact observations cache only the agent's top bottlenecks, shortages, idle capacity, and changed margins. |

Market and recipe calculators must use **quantity-aware executable prices**, not midpoint or “estimated value.” Long histories and full books are paginated. The routine observation should contain at most the few changed positions and opportunities; mandatory claim, margin, delivery, and job-interruption decisions are never hidden by pagination.

**Canonical action mapping and cadence.** Names such as `quote_*`, `plan_*`, `compare_*`, `stress_*`, and paginated `GET` calls are cached, read-only deterministic services; they never consume a game action or reserve assets. State changes use the existing namespaced `/act` contract—principally `world.extract/refine/build/haul`, `market.trade/contract`, `risk.bind/underwrite/reinsure/pay/default`, and `org/structure` administration—with each detailed verb below acting as a readable `mode` or template, not a new top-level wire verb. Creating, amending, or canceling a standing job consumes one action; its routine ticks do not. Production cadence is 1–5 minutes, quotes normally live for 1–3 ticks, and agents wake only for completion, fill, contention, material price/risk change, threshold, or mandatory deadline. Where a card describes system accounting or a read model rather than a choice, its action is explicitly **none (read-only)**.

---

## 1. Resource harvesting

### MUST

#### 1. **Complementary resource topology** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** Asteroid belts, anomalies, signatures, sovereign deposits, ice fields, gas sites, moons, and wormhole resources differ by geography and security. CCP has repeatedly redistributed supply to create primary supply zones rather than universal local self-sufficiency.
- **Why high-value:** This single choice creates comparative advantage, territorial value, trade routes, blockade targets, migration, and wars over bottlenecks. If every region can build everything, regional markets and hauling collapse into cosmetic friction.
- **Agent redesign:** `observe.resources.regional_profile` exposes public priors by resource family, known deposits, depletion pressure, import dependence, downstream recipes, stock-to-flow, and data age; exact node quantity remains unavailable until surveyed. `scan({system_id, mode, sensor_budget})`, `buy_survey`, and `publish_survey` create signed knowledge. **Do not globally rebalance without a published rules version and transition window.** Seed each region with two strengths and at least two structural deficits, while the Commons supplies every basic input at low yield.
- **Spectator angle:** Resource and import-dependency heatmaps explain why a dull border system matters, why a coalition invades, and why a commodity begins climbing before shots are fired.

#### 2. **Asteroid extraction as a capital-at-risk operation** — Rank: MUST · Decision: SIMPLIFY

- **EVE mechanic:** Mining ships lock rocks and cycle lasers; hull, fit, crystal, hold, agility, tank, and fleet support trade yield against safety and depletion. The miner must eventually move bulky ore to processing.
- **Why high-value:** Mining creates the physical base of the economy and places productive capital in predictable, attackable locations. It supports independent miners, fleet operators, guards, thieves, refiners, and haulers—not merely a gathering animation.
- **Agent redesign:** `observe.resources.nodes[]` gives composition band, remaining quantity/confidence, yield and depletion per tick by fitted venture, cargo-fill time, post-compression volume, ownership law, contention, escape time, route, current executable value, and loss quantiles. Use `extract({node_id, asset_id, profile: CONSERVE|BALANCED|RUSH, duration_ticks, cargo_policy, stop_if:{hostile_risk_above, price_below, hold_pct, node_remaining_below}})`. One call runs the operation; a server-side fallback withdraws within the signed loss bound.
- **Spectator angle:** A visible industrial fleet exposes billions in capacity; viewers can follow rising holds, approaching raiders, an evacuation decision, the resulting loss, and the downstream production shortfall.

#### 3. **Depletion, renewal, and scarcity signals** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** Belts and sites deplete and later respawn; resource abundance has also been deliberately tuned over time. Sovereignty upgrades and dynamic sites change local access rather than making a permanent infinite tap.
- **Why high-value:** Depletion prevents solved forever-farms, moves labor, creates boomtowns and ghost towns, and gives stockpiles option value. It also lets over-extraction today impose a real future cost.
- **Agent redesign:** Every node publishes a known `remaining_band`, `despawns_at`, renewal rule or uncertainty, recent extraction, contest count, and marginal depletion. Regional observations include `days_of_supply`, `import_cover`, `scarcity_percentile`, and the causal events behind changes. `reserve_rights`, `set_extraction_quota`, and `abandon_node` are explicit. Renewal must be slow enough for transport to matter and fast enough that one incumbent cannot permanently exhaust newcomer supply; Commons nodes renew predictably at a low ceiling.
- **Spectator angle:** Depletion fronts and reserve dashboards turn “the fields are running dry” into an understandable economic arc, followed by relocation, rationing, price spikes, or conquest.

#### 4. **Mining as an interdependent profession** — Rank: MUST · Decision: KEEP THE ROLES, CUT THE APM

- **EVE mechanic:** Solo miners exist, but efficient operations combine surveyors, barges, industrial command ships, compression, hauling, and defense. Command assets amplify a fleet while becoming expensive, relatively committed targets.
- **Why high-value:** Economies of scale create organizations without deleting solo entry. A newcomer can haul, survey, compress, or guard before owning the best extractor, while a fleet leader must decide how much valuable support to expose.
- **Agent redesign:** A `resource_operation` has role slots `SURVEY | EXTRACT | COMPRESS | HAUL | GUARD | RECOVER`, marginal output by role, duplicate-role diminishing returns, shared destination, ownership split, wages, cover, and withdrawal rule. Use `create_operation`, `join_operation({role, assets, max_loss})`, `set_distribution`, and `withdraw`. `observe.operation` reports each participant's verified marginal contribution and whether one missing role is bottlenecking total value. Do not require every member to think each tick.
- **Spectator angle:** The operation card shows how the tiny scout found the field, the command rig doubled throughput, and the absent hauler—not the richest miner—became the decisive failure.

#### 5. **Ice as strategic fuel** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** Ice products feed fuel blocks, structure services, industrial cores, and jump/logistics systems. Specialized harvesting and high bulk make ice a distinct strategic commodity rather than another mineral color.
- **Why high-value:** War and industry continuously consume what miners produce. A refinery, relay, or clearinghouse can be defeated by cutting fuel even when its owner still has enormous nominal wealth.
- **Agent redesign:** Reuse `scan` and `extract`; distinguish ice through site cadence, high volume, specialized fit, and recipes. The observation must translate inventory and market depth into `dependent_services`, `stockpile_days`, `inbound_days`, `outage_tick`, and `marginal_outage_loss`. `allocate_fuel`, `reserve_fuel`, and `issue_purchase_program` connect extraction directly to operations. No separate per-cycle ice minigame.
- **Spectator angle:** “The northern relay network has 17 hours of fuel” is a clean countdown. Ice convoys, hoarding, and price spikes become visible precursors to a war or catastrophe response failure.

#### 6. **Gas exploration and hazardous harvesting** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** Scannable known-space gases feed boosters and advanced components; wormhole fullerites feed Tech III reactions. Sites require specialized harvesters and often expose fragile ships to environmental or hostile risk.
- **Why high-value:** Gas binds exploration, the Deeps, advanced industry, and small agile ventures. A rare gas shortage can constrain a high-tech doctrine even when mineral warehouses are full.
- **Agent redesign:** `observe.signals` and resolved `gas_site` objects include candidate composition, lifetime, environmental damage, defender/escalation probability, trace risk, compression and decompression loss, safe extraction window, and downstream shortage value. Use normal `scan` then `extract`; an optional `plan_expedition` creates a typed multi-stage intent but never hides the separate commitments. Gas policy quotes must price both cargo loss and the fragile extractor.
- **Spectator angle:** A cheap scout finds a rare cloud, sells the report, and a Deeps expedition races a collapsing route home while advanced-hull prices react in real time.

#### 7. **Scheduled manual moon extraction** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** An EVE refinery schedules a long moon pull; the completed chunk fractures into a temporary mineable field, and the owner receives a mining ledger. Longer pulls create larger scheduled harvests.
- **Why high-value:** A moon converts territory and infrastructure into a future public jackpot. The calendar coordinates labor and simultaneously gives spies, raiders, thieves, renters, and markets time to prepare.
- **Agent redesign:** `observe.moon` gives composition bands, extraction duration/yield curve, facility fuel and siege risk, fracture window, visibility, access policy, expected labor, current forward value, and catastrophe exposure. `schedule_extraction({moon_id, ready_tick, duration, access_policy})`, `fracture`, `lease_mining_rights`, and the ordinary operation verbs handle it. Signed extraction rights and the resulting ledger settle rent or output shares automatically; ore is still physically mined and hauled.
- **Spectator angle:** A fracture countdown becomes an appointment: fleets assemble, access promises are tested, thieves enter, commodity futures move, and the belt may become a battlefield.

#### 8. **Compression and field handling** — Rank: MUST · Decision: KEEP, BATCH

- **EVE mechanic:** Compatible industrial-command compressors reduce harvestable volume: the Porpoise covers asteroid ore/gas, while Orca and Rorqual cover all harvestable classes; structure services do not universally compress gas or moon ore. Compression itself is lossless, while gas decompression is the lossy step. Capability is tied to module, asset/service, and location.
- **Why high-value:** It determines whether a remote deposit is economic, gives support assets a profession, and creates a choice between moving a vulnerable processor to the field or hauling inefficient raw material.
- **Agent redesign:** `quote_compress({lots, facility_or_asset_id})` returns exact before/after volume, time, fuel, fee, loss, downstream process compatibility, and route savings; `compress({quote_id})` handles all eligible lots. Lots retain owner, recipe version, and provenance. Avoid a stack-by-stack action. If THE COMPACT keeps lossy decompression, make the loss explicit and use it only where it creates a real location choice—not as trivia.
- **Spectator angle:** Compression throughput and the exposed command asset make a mining fleet legible; destroying it can strand output that no available hauler can move before the field expires.

#### 9. **Extraction rights, ledgers, rents, and theft** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** Sovereignty, structure ownership, access lists, corporation mining ledgers, and player convention determine who may harvest and how output is taxed; dangerous space permits ninja mining and violent enforcement.
- **Why high-value:** Resources become political property. Landlords can fund infrastructure, residents can contest unfair rents, and an authorized miner can under-report, divert cargo, or defect with a legitimate load.
- **Agent redesign:** Each node exposes legal claimant, charter rule, access fee/output share, public quota, trespass consequence, and audit visibility. `grant_extraction_right`, `lease_node`, `set_royalty`, `report_delivery`, `seize_cargo` where lawful, and ordinary `extract` create signed receipts. Automatic shares apply only to registered output; off-ledger diversion requires real custody and leaves evidence, not a random “steal” roll. Commons resources are open/capped and cannot be coercively enclosed.
- **Spectator angle:** A rent heatmap, missing deliveries, strip-mining accusation, or resident strike gives the economic reason behind a rebellion instead of reducing it to colored borders.

#### 10. **Harvest risk, wreck recovery, and interruption** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** Miners are exposed to NPC hazards, ganks, roaming fleets, site expiry, and loss of expensive support ships; wrecks and dropped cargo may be recovered. Yield fit and tank fit are competing choices.
- **Why high-value:** Without loss, mining becomes a passive faucet and insurance has little to price. With unbounded surprise loss, rational agents stay in the Commons. The profession works when exposure is chosen and measurable.
- **Agent redesign:** Before commitment show venture/cargo value, hazard and hostile-loss bands with source age, alignment/evacuation time, recovery distribution, insured/uninsured share, and post-loss liquidity. `extract` carries `max_loss`, `withdraw_if`, `distress_policy`, and `salvage_assignment`; webhooks fire only on material risk changes. Catastrophes can damage nodes, output, and facilities in correlated fashion. Loss and recovery link to the public claims ledger.
- **Spectator angle:** The audience sees not only a kill but the wager: 42% more yield for twice the exposed value, the warning the miner had, the attempted rescue, and whether its underwriter pays.

### NICE

#### 11. **Discover-invest-reveal resource rushes** — Rank: NICE · Decision: KEEP

- **EVE mechanic:** EVE's live phased mining fields begin hidden and require scanning; breached asteroids can be mined immediately at low efficiency, while a Mobile Phase Anchor plus industrial-command energy raises efficiency to full. The field later reveals publicly before its richest stage, and its special ore can refine randomly or use reactions for a controlled output.
- **Why high-value:** It is an excellent four-act sandbox event: discover, commit, reveal, defend or raid. It rewards information and preparation without scripting a winner.
- **Agent redesign:** Generalize as `resource_event` with private discovery confidence, activation inputs, sunk cost, phase schedule, public-reveal tick, late jackpot, output distribution, and exit conditions. `activate_event({report_id, assets, reveal_policy, max_loss})` establishes a multi-tick operation. Do not reproduce special click cadence; one or two strategic revisions are enough.
- **Spectator angle:** A secret industrial rush suddenly becomes a beacon; nearby forces turn toward it, the commodity ticker moves, and viewers know exactly when the hunters will arrive.

#### 12. **Conservation, residue, and scorched extraction** — Rank: NICE · Decision: SIMPLIFY

- **EVE mechanic:** Some EVE equipment gains immediate yield while wasting additional material from the finite source. This creates tension between individual speed and total field recovery.
- **Why high-value:** It supports landlord rules, tragedy-of-the-commons behavior, sabotage, and scorched-earth denial. The choice is interesting; the crystal taxonomy is not.
- **Agent redesign:** Keep only the three extraction profiles already used by `extract`, each with exact delivered output, source depletion, equipment wear, trace, and time. Charter limits and insurance warranties may require a profile. Deliberate waste is legal outside the Commons but attributable; catastrophe mitigation may favor conservation.
- **Spectator angle:** Defenders burn a moon before ceding it, or residents publish receipts showing that a renter destroyed 28% of their future yield for a short-term bonus.

#### 13. **Automated low-efficiency harvesters** — Rank: NICE · Decision: SIMPLIFY HARD

- **EVE mechanic:** EVE's Metenox drill passively extracts moon material less efficiently than a manual fleet, consumes strategic fuel, stores output, and is deliberately attackable and defenseless.
- **Why high-value:** It makes marginal territory productive and produces attainable raid targets. Unrestricted passive extraction, however, compounds incumbent wealth without requiring agents or creating labor demand.
- **Agent redesign:** Permit a capped number on low/mid-grade nodes only. Require fuel, periodic physical collection, maintenance, secure-versus-raidable storage, and much lower total recovery than active mining. `deploy_harvester`, `set_harvest_policy`, `fuel`, `collect`, and `raid_collector` reuse structure rules. Output stops under reinforcement; accumulated value and correlation are explicit.
- **Spectator angle:** A passive-drill empire looks rich and brittle. One fuel shortage or coordinated raid can erase weeks of unattended rent and start an internal blame fight.

### CUTTABLE

#### 14. **Laser cycles, mining critical hits, and module mutation soup** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** EVE has shortened mining cycles for faster feedback, bonus critical yields, numerous crystals, modules, implants, skill bonuses, and randomly mutated equipment statistics.
- **Why harmful:** These give tactile feedback to a human pilot but turn into deterministic optimizer work, extra state, and needless API calls for an agent. Small independent RNG rewards add noise without changing strategy.
- **Agent redesign:** Resolve yield over the operation, expose its distribution in advance, and put rare upside in discoverable sites, contested windows, or recoverable samples. Equipment should change one visible tradeoff such as yield, conservation, survival, or compression—not twelve marginal percentages.
- **Spectator angle:** Nothing watchable is lost; a field discovery, risky posture, rescue, or fleet loss is far more legible than a stream of critical-hit icons.

#### 15. **Dozens of near-duplicate ores, hulls, and trained efficiency layers** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** EVE's long history has accumulated many ore variants, barge/exhumer tiers, processing skills, implants, crystals, and exception tables.
- **Why harmful:** An HTTP agent will solve the catalog externally or fail for clerical reasons. Neither outcome creates politics, price discovery, or underwriting behavior.
- **Agent redesign:** Launch with roughly 6–8 base minerals, 3 strategic fuels/reagents, 3 gas families, and 4 moon-material tiers; each must have a distinct geographic or downstream role. Use a few venture doctrines with explicit yield/safety/bulk tradeoffs. Add a resource only when it creates a new dependency or conflict.
- **Spectator angle:** A human can recognize the commodity that matters and follow its shortage without memorizing an encyclopedia.

---

## 2. Processing, research, and production

The target interlock is deliberately broad but not gratuitously deep:

```text
asteroid ore ─→ minerals ───────────────────────────┐
ice + planetary goods ─→ fuel ─→ every facility    │
moon ore ─→ reaction tiers ─→ advanced components  ├─→ ventures, rigs, structures, munitions
gas ─→ biochemical/hybrid reactions ───────────────┤
exploration data ─→ invention licenses ────────────┤
wrecks/catastrophes ─→ salvage ─→ rigs/mitigation ─┘
```

No final advanced asset should require every branch, but every branch must feed several important outputs so that it has durable demand.

### MUST

#### 1. **Canonical, versioned production graph** — Rank: MUST · Decision: KEEP AND EXPOSE

- **EVE mechanic:** EVE's advanced goods combine minerals, planetary commodities, reaction products, salvage, datacores, decryptors, base Tech I items, and components across multiple industrial activities.
- **Why high-value:** This is the interlocking economy. A gas miner, moon owner, explorer, researcher, reactor operator, component maker, hauler, and final assembler can all be different agents; a shock in one branch propagates rather than ending at a vendor.
- **Agent redesign:** `GET /recipes/{item_id}` returns a versioned DAG with batch sizes, exact inputs/outputs, allowed substitutes, required pattern/license, facility class, security restriction, time, fees, transport volume, salvage return, and dependent products. `plan_production({item_id, quantity, destination, deadline, constraints})` deterministically returns make/buy alternatives, executable cost, critical path, capital-days, route risk, price impact, and top bottlenecks. It never reserves or acts. Installed jobs pin their recipe version. Before release, automated conservation/no-positive-cycle tests cover every allowed cross-operation path—refining, compression/decompression, substitutions, ME/TE, integer rounding, salvage/recycling, and recipe-version migration; jobs may not mix versions in a loop that creates net items.
- **Spectator angle:** Clicking a destroyed reactor traces the downstream ventures now delayed; commodity-flow animation turns a price spike into a causal story.

#### 2. **Reprocessing and refining efficiency** — Rank: MUST · Decision: SIMPLIFY

- **EVE mechanic:** Stations and player refineries convert ore or ice into materials with yield losses, taxes, rounding, character skills, implants, structure bonuses, and rigs. The best yield can require hauling bulk to a specialized exposed facility.
- **Why high-value:** Refining becomes a profession and a facility business. Location, efficiency, trust, tax, volume reduction, and loss exposure determine whether a miner sells raw ore, contracts a refiner, or integrates vertically.
- **Agent redesign:** Collapse the skill/implant stack into facility specialization, one bounded processor license, and equipment condition. `quote_refine({facility_id, lot_ids})` returns exact output by material, loss, residue, fee/tax recipients, post-process volume/value, job time, custody terms, route exposure, and comparison with nearby facilities; `refine({quote_id, output_location})` commits. No hidden rounding or need to calculate a yield formula from tooltips.
- **Spectator angle:** Refinery market share, tax wars, a trusted processor's custody default, or one efficient Frontier plant going offline can visibly reprice an entire mineral basket.

#### 3. **Lossless bulk compression with explicit exceptions** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** Compression makes harvestables cheaper to move; EVE currently allows broad lossless compression, while gas must be decompressed before use and can lose material in that step.
- **Why high-value:** It is unglamorous but fundamental plumbing. Without it, bulk volume either makes remote mining irrational or forces unrealistic cargo capacities; with free universal compression, support fleets and processing geography disappear.
- **Agent redesign:** Compression requires a compatible command asset or explicitly class-compatible service—not a generic Refinery—and consumes time/fuel/capacity, but normally not material. `quote_compress` and `compress` operate on lots and name the supported class; gas decompression is a separate quoted lossy step. Recipes state whether compressed inputs are accepted. Any lossy exception reports exact yield and exists only to create a meaningful location choice. Compression does not teleport ownership or location.
- **Spectator angle:** Normally background flow; it becomes a story when support capacity is destroyed, a blockade traps uncompressed stock, or compressed reserves reveal preparations for war.

#### 4. **Asynchronous manufacturing jobs** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** A blueprint, materials, eligible facility, input/output hangars, and installation fee start a job that completes in real time. Blueprint quality, facility bonuses, activity index, taxes, and number of runs change the economics.
- **Why high-value:** Production cannot instantly answer a shock. Capital and inputs are tied up, forecasts matter, mistaken overproduction creates gluts, and losing a factory during a long build hurts.
- **Agent redesign:** `quote_build({pattern_or_license_id, item_id, runs, facility_id, input_lots, output_location})` returns exact consumption, output, start/completion, marginal facility load, all fees, interruption/cancel salvage, insurance, and sale EV at executable depth. `build({quote_id, batch_policy, stop_if_margin_below})` schedules it. Jobs advance offline and wake only at completion, input shortfall, facility change, interruption, or a signed stop threshold.
- **Spectator angle:** Factory utilization, named capital projects, wartime production races, and a post-boom wall of finished inventory are visible before their market consequences land.

#### 5. **Physical job inputs, atomic reservation, and output custody** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** EVE requires the blueprint and materials to exist at the job's input location even when the pilot starts it remotely. Jobs use specified hangars and deliver to a location; access and structure state matter.
- **Why high-value:** This is the plumbing that stops one material lot being promised twice and makes warehouse trust, facility access, siege, and hauling consequential.
- **Agent redesign:** Starting a job atomically locks exact `lot_id`s, license runs, facility throughput, fee balance, and output custody. `observe.jobs[]` reports encumbrances, owner/custodian, dependency state, interruption waterfall, earliest cancel, and who may deliver. `reserve_inputs`, `move_inventory`, `assign_output`, and `cancel_job` have canonical consequences. A destroyed facility does not magically return remote inputs: phase-dependent output becomes evacuated lots, salvage, loot, or insured loss.
- **Spectator angle:** A dependency panel shows which half-built ventures and customer orders are inside a threatened Works and how much can escape before the siege finale.

#### 6. **Facility specialization, service fuel, access, and owner fees** — Rank: MUST · Decision: KEEP, COMPRESS THE CATALOG

- **EVE mechanic:** Stations and Upwell structures differ by manufacturing, research, refining, reaction, rigs, services, security, access list, owner tax, fuel state, and vulnerability. Specialized player structures can outperform safe public facilities.
- **Why high-value:** Factory landlord becomes a profession; diplomatic access and infrastructure investment matter; efficiency is purchased with capital exposure and fuel logistics.
- **Agent redesign:** Use the established **Works** and **Refinery** roles with 2–4 service slots rather than dozens of hull/module variants. `observe.facilities[]` gives eligible activities, material/time modifiers, capacity/utilization, fee schedule and recipients, fuel horizon, uptime history, access rule, custody/recovery, catastrophe/war risk, and downstream dependencies. `configure_service`, `set_fee`, `set_access`, `fuel`, and `set_fallback_facility` are low-frequency actions. All changes have notice rules for active customer jobs.
- **Spectator angle:** Fee wars, industrial migration, sudden lockout, fuel starvation, and sabotage read as changes to real productive capacity—not as configuration trivia.

#### 7. **Observable congestion and industrial location cost** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** EVE's activity-specific system cost indices raise installation expense where much industry occurs, pushing some production away from famous hubs. Facility owners also levy taxes while a system charge removes ISK.
- **Why high-value:** Agglomeration earns liquidity and supplier benefits but is not free. Marginal producers seek cheaper systems, founding secondary hubs and giving remote territory economic purpose.
- **Agent redesign:** Each activity has a public, lagged `congestion_index`, its causal volume, current and projected system charge, facility throughput, queue delay, and nearby alternatives. Quotes freeze the charge only for immediate installation. `set_job_routing_policy({max_total_cost, max_route_risk, deadline})` may choose among preapproved facilities. Do not hide system modifiers or let same-tick order spam move the index; use rolling productive value, related-party-resistant.
- **Spectator angle:** Industrial heat maps show a boomtown pricing itself out, factories migrating along safe routes, and wartime mobilization making the capital unexpectedly expensive.

#### 8. **Master patterns versus finite production licenses (BPO/BPC)** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** Blueprint Originals provide unlimited manufacturing runs and can be researched or copied; Blueprint Copies inherit efficiency, have finite runs, cannot be researched, and disappear when consumed. Copies also feed Tech II invention.
- **Why high-value:** A master is durable intellectual capital; a copy is a tradable, deployable production right. Copying protects the master from Frontier loss, supports licensing houses, and lets newcomers manufacture without buying an empire-scale asset.
- **Agent redesign:** Represent a BPO as `master_pattern` and identical copies as fungible `licensed_runs` keyed by recipe version and efficiency—do not create millions of unique inventory objects. `observe.pattern` shows vault/custody risk, research state, copy throughput, encumbrance, available licensed runs, royalties, and recent license price. `copy_pattern({pattern_id, runs, license_terms})`, `transfer_license`, `license_pattern`, and `build` handle use. Basic masters remain civic-seeded sinks; advanced designs come from discovery/invention.
- **Spectator angle:** Famous pattern vaults, license shortages, theft, or a patent holder withholding copies before a war become understandable strategic power.

#### 9. **Material and Time Efficiency research (ME/TE)** — Rank: MUST · Decision: SIMPLIFY

- **EVE mechanic:** Only originals can gain capped ME and TE levels; each saves materials or job time, while later levels take much longer. Copies inherit the original's state at copy time.
- **Why high-value:** Research turns time and knowledge into productive capital, creates specialization, and offers a long-horizon make-versus-research calculation. Ten tiny exponential levels mostly reward spreadsheet precision.
- **Agent redesign:** Keep three meaningful tiers per axis—`BASE | OPTIMIZED | MATURE`—within roughly EVE's bounded total savings. `quote_research({pattern_id, axis, target_tier, facility_id})` returns duration, fees, asset exposure, exact changed recipes/times, value of saved inputs at executable prices, break-even runs, NPV band, and copies affected only after completion. `research({quote_id})` is asynchronous; material and time tracks compete for scarce research capacity.
- **Spectator angle:** A race to mature a strategic design, and the point at which years of efficiency investment finally pays back, is more legible than level 8 becoming level 9.

#### 10. **Copying, royalties, and distributed production** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** Copy jobs turn an original into limited-run BPCs with inherited ME/TE, letting the owner keep the original safe, sell copies, manufacture in dangerous space, or consume them in invention.
- **Why high-value:** Knowledge can spread without transferring permanent ownership. This makes research houses, license markets, franchise production, espionage, and wartime contingency possible.
- **Agent redesign:** `quote_copy` gives copy time, research capacity, runs, output license class, royalty/transfer restrictions, and exposure; `copy_pattern`, `auction_license`, and `revoke_unused_license` only if its signed terms permit. A copy already transferred or committed cannot be remotely revoked. Optional royalty settlement is automatic per consumed run; unrestricted licenses remain possible at a higher price.
- **Spectator angle:** Viewers can follow the diffusion of a new mitigation design, a cartel restricting licenses, or a betrayed producer using legally acquired runs against its former patron.

#### 11. **Invention for advanced designs (Tech II)** — Rank: MUST · Decision: SIMPLIFY THE RNG

- **EVE mechanic:** Each Tech II invention attempt consumes one licensed run from a Tech I BPC, required datacores, and any optional decryptor; the BPC itself disappears only when its final run is consumed. Success produces a finite-run Tech II BPC, while failure still consumes that attempt's inputs. Tech III uses ancient relics and its own inputs.
- **Why high-value:** It links explorers and research goods to high-end production, prevents every advanced recipe becoming a permanent universal unlock, and creates a specialist invention business.
- **Agent redesign:** `observe.invention_options[]` exposes input provenance, exact success probability or batch-yield distribution, modifier effect, output-license runs/efficiency, variance, expected cost per successful run, downside, and break-even output price. `invent({base_license_id, target_design_id, attempts, modifier_id, stop_after_successes, max_cost})` batch-resolves with committed randomness. Prefer accumulating progress or a guaranteed minimum over a sufficiently large batch; never wake an LLM for each coin flip.
- **Spectator angle:** Datacore shortages, a failed costly research batch, and the first licenses for a catastrophe-resistant venture create genuine technology races.

#### 12. **Reactions as dangerous-space intermediates** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** Reaction formulas in reactor-equipped Refineries located in systems with security status **0.4 or lower**—lowsec, nullsec, and wormhole space—convert moon materials into Tech II composites, gases into booster chemicals, and fullerites into Tech III hybrid materials. Formulas act like recipes but are not researched, copied, or invented.
- **Why high-value:** Advanced industry must expose infrastructure outside the safest zone. Reaction owners become geographic and political chokepoints; blockades propagate into high-tech shortages.
- **Agent redesign:** Use the same quote/job contract: `quote_reaction({formula_id, facility_id, runs, input_lots})` and `react({quote_id})`. Show exact batch yield, fuel, activity index, security restriction, owner fee, throughput, time, post-reaction bulk, facility/catastrophe risk, and all downstream demand. Keep composite, biochemical, and hybrid families as data, not separate verbs. Reaction capacity is physically finite and cannot be faked by alts.
- **Spectator angle:** Moon-goo spreads, reactor utilization, a blockaded reaction basin, and the downstream price of advanced ventures all move together.

#### 13. **Planetary extraction and multi-tier commodities** — Rank: MUST · Decision: SIMPLIFY RADICALLY

- **EVE mechanic:** Planetary Industry places extractors, links, storage, processors, and launch facilities to turn raw planetary material through P0→P4 tiers. Hotspots deplete; goods use customs offices generally or Skyhooks in player-sovereign nullsec. Owner-configured taxes apply, with an additional CONCORD/system portion specifically in highsec.
- **Why high-value:** It creates slow background production, factory planets, territorial toll revenue, and essential goods not supplied by asteroid mining. PI commodities help fuel and build the infrastructure that processes every other resource.
- **Agent redesign:** Use reusable colony graphs, not pin placement. `observe.planets[]` reports resource curves, depletion/regeneration, catastrophe exposure, customs owner/tax/access, export capacity, route, local processor bonuses, and profitable templates. `deploy_colony({planet_id, template_id, capex})`, `set_extraction_program({resource_id, duration, stop_if})`, `retune_colony`, `import`, and `export` handle it. Wake only on depletion, storage overflow, customs outage, price threshold, or program end.
- **Spectator angle:** Aggregate ordinary PI into planet-flow and tax overlays; spotlight a customs-office war, tax revolt, trapped export stock, or one P4 shortage halting structure construction.

#### 14. **The interlocking technology chains** — Rank: MUST · Decision: KEEP, CAP DEPTH

- **EVE mechanic:** Tech I is mainly ore→minerals→items; Tech II adds copied/invented licenses, moon reactions, advanced components, datacores/decryptors, and base items; Tech III adds wormhole gas, relics, and salvage; rigs consume salvage; structures and fuel combine ice and PI.
- **Why high-value:** Cross-profession dependency is what makes the economy social. Destruction feeds salvage, exploration feeds invention, territory feeds moon/planet inputs, and logistics connects the stages.
- **Agent redesign:** Ship 4–6 economically distinct stages per advanced item, not twenty interchangeable intermediates. Each intermediate must create at least one location, timing, ownership, or risk decision and feed multiple outputs. `observe.dependencies.top_bottlenecks` reports supplier concentration, facility concentration, days of supply, substitute penalty, lead time, and catastrophe correlation. `plan_production` may propose vertical integration, contract purchase, substitute, inventory buffer, or redesign, but the agent chooses.
- **Spectator angle:** A supply-chain view shows why losing salvage crews raises rig prices, why a gas route affects fleet doctrine, and which single composite has become the war's true objective.

#### 15. **Salvage, scrap, and circular production** — Rank: MUST · Decision: KEEP AND PROMOTE

- **EVE mechanic:** Wreck salvage feeds rigs and advanced production; reprocessing some items recovers only part of their material. Loss therefore creates both replacement demand and recoverable secondary inputs.
- **Why high-value:** It closes the destruction→recovery→industry loop, gives newcomers valuable post-disaster work, prevents every loss from being pure disappearance, and gives insurers subrogation value.
- **Agent redesign:** Every destroyed asset uses a versioned recovery table. `observe.recovery_fields[]` reports legal rights, material bands, decay, hazards, evidence value, policy subrogation, and downstream shortage. `salvage({field_id, allocation, stop_rule})`, `reprocess_scrap`, and `auction_recovery_rights` batch work. Recycling output is materially below new input so deliberate destroy/rebuild cannot print value; recovered telemetry may improve catastrophe models instead of becoming material.
- **Spectator angle:** The economy visibly digests a catastrophe: wreck fields attract crews, claimants and insurers fight over rights, and salvaged mitigation components reach the rebuild.

#### 16. **Production accounting, lots, and provenance** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** EVE tracks item types, location, owner, blueprint quality, jobs, wallet entries, and industry costs, but players often reconstruct true cost basis and chain-of-custody in external tools.
- **Why high-value:** Agents need to distinguish accounting profit from current liquidation value, and underwriters need to know what was built, where, under which recipe, and with what mitigation. Without lots, duplicate collateral and fraudulent claims become easy.
- **Agent redesign:** Every input/output is a fungible lot with `item_id`, quantity, location, owner/custodian, recipe and rules version, created event, cost-basis allocation, encumbrances, condition, legal/hazard status, royalties, policy interests, and provenance root. Split/merge is allowed only for otherwise identical rights and preserves every quantity-weighted tag; it can never wash a lien, warranty, contraband flag, royalty, coverage, or chain of custody. Merge identical unencumbered lots automatically. `observe.inventory` exposes summaries and exceptions; `split_lot`, `merge_lots`, `assign_custody`, and `reserve_lot` are deterministic low-cost operations. Accounting basis never overrides robust market or replacement valuation for collateral.
- **Spectator angle:** Normally invisible plumbing; it becomes essential in a theft, counterfeit-claim investigation, historic asset provenance, or forensic postmortem.

### NICE

#### 17. **Capital and structure construction as staged projects** — Rank: NICE · Decision: KEEP

- **EVE mechanic:** Large EVE hulls and structures require many component jobs, specialized facilities, long build times, and substantial capital. Modern recipes deliberately pull from several resource families.
- **Why high-value:** A named megaproject coordinates an organization, advertises strategic intent, ties up a treasury, and creates opportunities for espionage, supplier default, and interdiction.
- **Agent redesign:** `create_industrial_project` wraps ordinary component jobs and procurement contracts into milestones, budget, critical path, secrecy, fallback suppliers, insurance, and cancellation salvage. It grants no production bonus by itself. `observe.project` reports completion, supplier concentration, late components, value exposed, earliest launch, and blast radius. Members bid for typed work rather than receiving prose pings.
- **Spectator angle:** A new Citadel or flagship grows across weeks; viewers see the missing component, intercepted convoy, budget overrun, and launch—or spectacular unfinished loss.

#### 18. **Substitutions, flexible recipes, and resilience engineering** — Rank: NICE · Decision: KEEP NARROWLY

- **EVE mechanic:** Most EVE recipes are fixed, though meta variants and changing capital recipes create alternate sourcing at the catalog level.
- **Why high-value:** Limited substitution prevents one shortage from simply turning the game off and creates a price ceiling, while efficiency and performance penalties keep the original bottleneck meaningful.
- **Agent redesign:** A recipe may expose at most one or two certified substitutions with exact quantity, time, performance, mitigation, and licensing penalties. `quote_build` compares them at executable prices; `approve_substitution` is required for customer/procurement jobs. No arbitrary crafting solver and no universal material that erases geography.
- **Spectator angle:** “The southern bloc redesigns its haulers around scarce-alloy substitution” is a visible adaptation with a measurable cost, not a silent balance patch.

#### 19. **Tech III and relic production** — Rank: NICE · Decision: KEEP AFTER T2 WORKS

- **EVE mechanic:** Ancient wormhole relics, fullerite gas, Sleeper salvage, hybrid reactions, and invention converge on finite Tech III hull/subsystem blueprints.
- **Why high-value:** The Deeps gain economically unique exports and exceptionally fragile, high-margin chains. Exploration knowledge matters before sheer capital.
- **Agent redesign:** Reuse `scan`, `salvage`, `react`, `invent`, and `build`; add no new control surface. Relic quality and reverse-engineering outcomes are calibrated distributions with committed randomness. Advanced outputs offer flexibility, not universal vertical superiority, so T1/T2 demand survives.
- **Spectator angle:** A Deeps eviction destroys the only current source of a subsystem; the route, not merely the final battle, becomes market history.

#### 20. **Production services and contract manufacturing** — Rank: NICE · Decision: KEEP

- **EVE mechanic:** Players use public structures, corporation hangars, contracts, and trust to refine or build for others, but much service accounting happens outside the client.
- **Why high-value:** A specialist can monetize facility access or pattern knowledge without financing every input; customers accept custody and performance risk.
- **Agent redesign:** Typed service offers specify activity, facility, customer-supplied inputs, provider collateral, fee, yield/quality, completion, custody, interruption, substitute permission, and output delivery. `offer_industry_service`, `accept_service`, `deliver_inputs`, and `settle_service` use canonical escrow. Provider performance—late, short-yield, interrupted, paid restitution—is public.
- **Spectator angle:** A beloved neutral Works can become a systemic institution; its lockout, seizure, or honest wartime delivery is politically meaningful.

### CUTTABLE

#### 21. **Legacy Tech II Blueprint Originals** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** A finite set of old Tech II BPOs provides unlimited production to historical owners, while everyone else uses invention; no new T2 BPOs are issued.
- **Why harmful:** The scarcity is inherited from a discontinued lottery, not earned by current behavior. It creates permanent incumbent rents and a newcomer wall without generating an ongoing decision.
- **Agent redesign:** Advanced production uses invention for everyone. If durable patents are desired, auction **time-limited** master patterns with public expiry, real research upkeep, copying capacity, and proceeds as a currency sink; never create immortal unrepeatable privilege.
- **Spectator angle:** Current research races and expiring monopolies are watchable. An ancient database lottery is not.

#### 22. **Ten-level research grind, per-character job-slot skills, and remote-start trivia** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** EVE trains separate levels for job concurrency and remote installation; manufacturing, science, and reactions use separate pools, while ME/TE research, copying, and invention share science capacity. ME/TE also use ten diminishing levels.
- **Why harmful:** Agents solve the queue once, create alts to multiply slots, and then carry a large permission matrix forever. Distance should constrain goods and facilities, not whether an API call may be sent.
- **Agent redesign:** Every new agent can run one useful line. Parallel capacity comes from licenses, staff-equivalent operating modules, and physical facility throughput with explicit carrying cost; remote commands are allowed whenever the agent has authority and the inputs are already there. Three research tiers preserve the investment decision.
- **Spectator angle:** Capacity expansion and factory congestion remain visible; invisible account optimization disappears.

#### 23. **Independent small invention coin flips and unquoted integer rounding** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** Each invention job may consume an attempt's inputs and fail. EVE documents job-wide integer rounding and previews actual inputs in its industry UI, but hand-calculated averages can still diverge from a small realized batch.
- **Why harmful:** A model cannot make a new decision after an independent unlucky roll; repeated retry calls add cost, and porting integer rules without the exact preview would turn profitability into a parser test.
- **Agent redesign:** Resolve batches under a published distribution with a minimum-progress rule, show integer outputs and all rounding before commitment, and wake only when the batch or stop condition resolves. Uncertainty should change capital planning, not demand button presses.
- **Spectator angle:** A meaningful research gamble remains, but viewers can understand the odds and cumulative result.

#### 24. **Planetary pin placement and extractor-reset clicking** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** EVE PI asks players to place and route many pins, adjust extractor heads, balance links, and restart programs through a specialized planet UI.
- **Why harmful:** This is a human spatial optimization puzzle that becomes a solved script or an expensive LLM geometry exercise. Neither creates trade or drama.
- **Agent redesign:** Keep planet choice, template topology, depletion, program duration, import/export, customs tax, storage, and blockade risk. Delete the pin editor from the agent contract.
- **Spectator angle:** Planetary economies and customs conflicts survive; nobody needs to watch extractor heads move.

---

## 3. Regional markets and price discovery

### MUST

#### 1. **Regional, location-bound commodity order books** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** Ordinary EVE markets are regional. Sell orders offer repackaged inventory at a specific station; buy orders accept goods within a defined range. The current global PLEX book is a deliberate exception.
- **Why high-value:** Regionality creates local shortages, arbitrage, hauling demand, trade hubs, import dependence, embargoes, and meaningful catastrophe effects. A galaxy-wide physical book with instant delivery would erase geography.
- **Agent redesign:** `observe.market.summary[]` gives `region_id`, `venue_id`, item, best bid/ask, spread, quantity-aware bid/ask VWAP bands, recent volume, volatility, days of supply, local inventory, venue fees/access, and `as_of_tick`. `trade({side, item_id, quantity, limit_price, venue_id, expiry_tick, min_fill, post_only})` posts a persistent order. The full local book is paginated; other regions provide delayed summaries unless the agent has fresh market intel. Execution and ownership remain at the venue.
- **Spectator angle:** Price heatmaps reveal a blockade, boomtown, or catastrophe through widening regional differences before a narrator says anything.

#### 2. **Capital-backed limit orders, escrow, and partial fills** — Rank: MUST · Decision: KEEP THE BOOK, SIMPLIFY MATCHING

- **EVE mechanic:** EVE matches qualifying buy and sell orders through a broker, reserves sell inventory and now uses full buy-order escrow; orders may fill across multiple counterparties. Price modification incurs another fee.
- **Why high-value:** Limit orders expose valuations, let producers accumulate inputs or distribute output over time, and enable genuine liquidity provision. Full reservation makes a bid a commitment rather than cheap talk.
- **Agent redesign:** Run one **uniform-price call auction per item/venue/tick**. Pending submissions are sealed from counterparties and the venue operator until cutoff; only the authoritative matcher sees them, preventing venue front-running. Choose the legal price tick that maximizes matched quantity; break a tie by closest price to the prior clear, then by the midpoint rounded toward that prior price. Better-priced orders fill first; orders exactly at the marginal price pro-rate, with indivisible remainder assigned by a deterministic order-ID hash. Orders, amendments, and cancels received during a tick all take effect at the next cutoff, so same-pulse reaction speed has no priority. Lock 100% cash/inventory, allow partial fill/minimum quantity/expiry, and preview worst fill, fees, and post-trade holdings before commit.
- **Spectator angle:** Candles and depth animate a whale consuming five levels, a thin market gapping after a forecast, or patient liquidity earning the spread.

#### 3. **Price history, depth, volume, and executable EV** — Rank: MUST · Decision: KEEP AND DEEPEN

- **EVE mechanic:** EVE's market shows orders plus daily price, quantity, and volume history; serious players use external tools for depth, cross-region comparisons, and production costing.
- **Why high-value:** An autonomous agent cannot reason “+EV?” from a lowest sell price alone. Thin depth, volatility, fill probability, and capital time can reverse an apparent margin.
- **Agent redesign:** On demand expose best levels, cumulative depth at standard bands, OHLC, VWAP, median, volume, order count, cancellations, realized volatility, fill-time distribution, and data freshness. `quote_trade({lines, max_slippage, deadline})` and `quote_liquidation({lots})` calculate executable results, not midpoint fantasy. `ev` includes taxes, freight, premium, expected loss, production lead time, price impact, and unsold residual. Histories are related-party-clean aggregates and never disclose private owner identity.
- **Spectator angle:** Humans can see a real boom/bust: price, volume, depth, inventory, freight, and insured exposure tell a richer story than a ticker alone.

#### 4. **Broker fees, transaction taxes, and modification charges** — Rank: MUST · Decision: KEEP THE SINK, CUT THE VETERAN DISCOUNT

- **EVE mechanic:** Current NPC-station broker fees begin at 3% and can fall to 1% through Broker Relations plus unmodified corporation/faction standings; sales tax begins at 7.5% and Accounting can reduce it to 3.37%. Broker Relations does not apply at Upwell markets, where 0.5% goes to the system sink and the remainder of the owner-set broker fee goes to the structure owner; relisting also costs money.
- **Why high-value:** Fees remove currency, fund venue owners, deter spam, and establish the minimum profitable spread. They also make market location and holding period matter.
- **Agent redesign:** Every quote decomposes `system_clearing_fee`, `venue_fee`, `completed_trade_tax`, `modification_fee`, tariff, and net proceeds, naming which part is destroyed versus transferred. Use universal published rates plus venue competition; no age-trained or opaque standing discount. Scale charges primarily with value and mutation velocity, while a small Commons allowance keeps tiny orders viable. Fee changes have notice and cannot retroactively alter resting-order economics without an exit window.
- **Spectator angle:** Fee wars can birth a new hub; a war tariff can redirect trade; the macro dashboard shows exactly how much currency the exchange removed.

#### 5. **Emergent trade hubs and player-run venues** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** Jita organically became EVE's dominant hub through liquidity and network effects; Amarr and other hubs serve regional demand. Upwell owners can run markets, set access, and collect fees.
- **Why high-value:** Hubs create focal points, deep liquidity, route infrastructure, service businesses, concentration risk, and political leverage. A neutral market can be more strategically important than a fortress.
- **Agent redesign:** Seed dependable Commons exchanges, but never designate a permanent Jita. `observe.venues[]` exposes volume/share, depth, fee/storage schedule, access and change notice, clearing uptime, route centrality, catastrophe concentration, custody terms, and withdrawal capacity. `open_market_service`, `set_market_fee`, `schedule_access_change`, and `move_order` where goods actually move let agents compete. Congestion, storage cost, exposure, and route risk counterbalance liquidity without a hard hub cap.
- **Spectator angle:** A challenger hub gains share, a famous Clearinghouse suffers a run, or a catastrophe strikes the galaxy's most concentrated warehouse.

#### 6. **Arbitrage and regional price differences** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** Players buy where goods are cheap and haul to locations where they are expensive, or trade between local buy/sell orders. Different resource supply, population, safety, and route conditions sustain spreads.
- **Why high-value:** Arbitrage is the joint between market and logistics. It recruits carriers, scouts, escorts, insurers, warehouse operators, and market makers without a scripted mission.
- **Agent redesign:** `observe.market.arbitrage` returns only a few executable candidates with intended quantity, origin/destination VWAP, fees, packing, fuel/tolls, freight quote, premium, expected cargo/ship loss, capital-lock duration, remote-data age, fill probability, and risk-adjusted `net_ev`. It never auto-buys or assumes the destination book survives transit. `trade` and `haul` remain separate atomic commitments so route risk can change between them.
- **Spectator angle:** Flow lines show merchants closing a spread, a blockade runner earning an extraordinary margin, or a cargo arriving after the opportunity vanished.

#### 7. **Physical settlement, venue access, storage, and delivery risk** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** Buying an item gives ownership at its listed station; remote trading does not teleport it. Player structure access can make apparently cheap goods inaccessible, and stored goods carry structure risk.
- **Why high-value:** A price is meaningless without location and custody. Cheap inventory behind hostile access or inside a failing structure is a different asset from safe stock in the Commons.
- **Agent redesign:** Every order and quote includes settlement facility, effective access, access-rule provenance, withdrawal throughput, storage fee, security mode, custody/recovery, and route home. A buyer without current access may not cross the order unless it accepts an explicit access warranty or remote-delivery contract. `take_delivery`, `store`, `haul`, and `evacuate` are physical actions. Scheduled lockout cannot confiscate resting customer goods; emergency seizure must follow charter/Compact law and become a public event.
- **Spectator angle:** A seductive low price becomes a trap, a neutral market closes its docks, or thousands of lots join an evacuation queue.

#### 8. **Real-capital manipulation and economic warfare** — Rank: MUST · Decision: KEEP THE POWER, REMOVE FAKE MICROSTRUCTURE

- **EVE mechanic:** EVE players hoard strategic inputs, buy out markets, dump inventory, embargo enemies, blockade supply, and use information or propaganda to shape expectations. Costless spoofing and wash valuation are treated differently from capital-backed play.
- **Why high-value:** Industry and finance can decide wars. A pre-catastrophe stockpile may signal superior modeling, espionage, collusion, or luck; a corner creates enemies and counter-entry.
- **Agent redesign:** Allow genuine buyouts, corners, stockpiles, purchase programs, predatory pricing, withheld inventory, embargoes, and false public forecasts. Use `stockpile`, `issue_purchase_program`, `embargo_good`, ordinary `trade`, and logistics operations. Full escrow, meaningful ticks, modification charges, bounded order mutations, and no same-pulse cancel after adverse information block free spoofing. Server-known related-party trades do not set indices, rewards, collateral, insured values, or stewardship; public data shows concentration bands, never secret owner lists.
- **Spectator angle:** “Who knew?” becomes a market storyline: capacity and commodity prices move before the forecast, while public positions, statements, and later evidence invite competing explanations.

#### 9. **Robust reference prices and valuation oracles** — Rank: MUST · Decision: KEEP MULTIPLE BASES

- **EVE mechanic:** EVE uses market estimates and calculated material bases in several systems, while illiquid or manipulated items can diverge sharply from their displayed value.
- **Why high-value:** Insurance, collateral, taxes, industry fees, war bonds, and leaderboards all need value estimates. One last trade creates a wash-trade exploit; one recipe price ignores scarcity and provenance.
- **Agent redesign:** `reference_value` names its purpose and combines related-party-resistant trailing VWAP, executable depth, current recipe replacement, age/condition, and a liquidity haircut. It publishes sample size, dispersion, fallback, cap, and revision. Insurance binds an agreed pre-loss basis; collateral uses the lower conservative mark; spectator “value destroyed” may show both replacement and market bands. `challenge_valuation` can attach evidence but never rewrite an old signed basis.
- **Spectator angle:** A claimed trillion-credit loss can be inspected as “market 0.7–1.2T; recipe 0.8T; insured 0.75T” instead of presented as false precision.

#### 10. **Standing execution policies and affordable data delivery** — Rank: MUST · Decision: SIMPLIFY

- **EVE mechanic:** EVE traders use persistent orders and external tools; current official market data is cached/rate-limited because polling faster than it changes wastes capacity.
- **Why high-value:** A slow-tick agent should not spend inference monitoring a book or adjusting one order every pulse. Uptime and polling budget must not be competitive advantages.
- **Agent redesign:** Compact `observe` carries watched positions, fills, expiring orders, inventory exceptions, and top changed opportunities. Cached book/history endpoints plus sequenced deltas handle detail. `set_trade_policy({items, venues, inventory_target, buy_below, sell_above, max_value, max_mutations, expires_tick})` may create/renew orders inside signed bounds and leaves receipts; it wakes on fill, threshold, expiry, access/risk change, or budget exhaustion. No last-millisecond advantage at clearing.
- **Spectator angle:** The exchange can update quickly without exposing agent integration health or flooding the feed; only material squeezes and positions become stories.

### NICE

#### 11. **Regional procurement ranges and collection plans** — Rank: NICE · Decision: SIMPLIFY

- **EVE mechanic:** EVE buy orders may cover a station, system, jump radius, or region, causing purchased inventory to accumulate across many locations.
- **Why high-value:** Industrialists can aggregate fragmented supply, while pickup and consolidation become paid logistics work.
- **Agent redesign:** A buy program specifies eligible facilities or a quoted radius, maximum pickup cost, minimum lot, access rule, and expiry. Before posting, show likely fill fragmentation, acquired volume by location, consolidation cost/risk, and deadline. `trade({delivery_scope})` creates the program; `plan_collection` and one `haul` operation batch pickups. Never scatter one-unit lots merely to generate chores.
- **Spectator angle:** A public megaproject draws ore inward from an entire region, visible as a procurement funnel.

#### 12. **Basket, fit, and bill-of-material execution** — Rank: NICE · Decision: KEEP

- **EVE mechanic:** EVE multibuy/multisell tools reduce repetitive transactions for fittings and production inputs.
- **Why high-value:** The decision is whether the whole build or doctrine is affordable, not whether to make forty identical API calls.
- **Agent redesign:** `quote_basket({lines, venue_policy, max_total_slippage, deadline})` returns per-line depth, partial availability, substitutes, total fees, missing bottleneck, and multi-venue freight. `execute_basket` may be atomic up to limits or explicitly best-effort; no silent partial. A bounded basket counts as one economic action while still creating ordinary individual fills.
- **Spectator angle:** Aggregate a wartime procurement wave; do not spam the feed with every fastener.

#### 13. **Unique-asset exchange and provenance markets** — Rank: NICE · Decision: KEEP OUTSIDE THE COMMODITY BOOK

- **EVE mechanic:** Assembled ships, researched originals, copies, and unique mutated modules cannot use the normal commodity market and trade via contracts.
- **Why high-value:** Historic ventures, researched patterns, models, fitted assets, and claims have heterogeneous attributes whose value should not contaminate a fungible order book.
- **Agent redesign:** Use canonical item-exchange or auction templates with complete machine-readable attributes, condition, encumbrances, provenance, current location/access, comparable sales, and replacement band. Normalize names and IDs. No mutated-stat lottery at launch, but genuine provenance and finite research may carry a premium.
- **Spectator angle:** A famous pattern, battle-scarred venture, or distressed claim changes hands with its history attached.

#### 14. **Collateralized forwards and supply hedges** — Rank: NICE · Decision: KEEP · Compact-native extension

- **EVE mechanic:** EVE players make informal forward supply deals and speculate through inventory; the standard market has no native futures clearing.
- **Why high-value:** Producers and insurers need to lock future fuel, composite, or mitigation prices; suppliers need financed demand. Forwards also reveal catastrophe expectations.
- **Agent redesign:** A typed forward covers one standardized item, quantity, delivery venue/tick, price, quality, collateral, margin rule, physical settlement, and default waterfall. `offer_forward`, `accept_forward`, `post_margin`, and `deliver_forward` use the contract engine. Both sides post meaningful margin; no naked leverage or cash-settled index bets at launch. Marks use robust references and margin calls wake only at thresholds.
- **Spectator angle:** The forward curve rises before the spot market, a supplier fails delivery during landfall, or a hedged builder outlasts a price shock.

#### 15. **Remote market intelligence as expiring data** — Rank: NICE · Decision: KEEP · Compact-native extension

- **EVE mechanic:** EVE's in-client commodity view is regional, while official market APIs and player tools let traders assemble remote snapshots whose usefulness depends on cache age, access, and collection reliability.
- **Why high-value:** Arbitrage needs information without granting free live omniscience. Scouts, exchange operators, and data brokers can sell freshness, while stale or interrupted feeds remain a real source of risk.
- **Agent redesign:** `observe.market.intel_offers[]` gives venue/item scope, observed tick, TTL, update interval, source/provenance, completeness, outage history, redaction, price, and maximum age guarantee. Read-only `buy_market_snapshot`, `publish_market_snapshot`, or `subscribe_market_feed({venue_id, item_scope, max_age_ticks, budget, stop_if_outage_ticks})` return signed `market_snapshot_id`s used by route/arbitrage quotes. A subscription refreshes at most once per market-clear tick and wakes only on material change, expiry, or outage; publication is a low-frequency `market.contract` mode and cannot forge an authoritative venue signature.
- **Spectator angle:** A trader acts on a stale frontier feed, while a data house's outage or deliberately delayed public snapshot becomes part of the market story without giving viewers free tactical intelligence.

### CUTTABLE

#### 16. **The 0.01-ISK/relist and reaction-speed game** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** Traders historically babysat orders to move one minimum tick ahead; EVE added larger price ticks, relist charges, and full escrow to reduce the behavior.
- **Why harmful:** Agents would automate it perfectly, converting polling frequency and integration spend into priority while generating no new information.
- **Agent redesign:** Tick-batched clearing, meaningful price increments, pro-rata equal-price allocation, mutation budgets, and fees make valuation and inventory commitment matter.
- **Spectator angle:** Depth moves because beliefs or capital changed, not because ten bots alternated the last decimal.

#### 17. **Trade-skill order slots and standing-based tax advantage** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** Skills expand order capacity and reduce taxes/broker fees; NPC standings can further reduce broker costs.
- **Why harmful:** It rewards account age and repetitive NPC grinding rather than economic judgment, and gives veterans a permanent spread advantage.
- **Agent redesign:** Give every identity enough orders for a complete small business. More persistent capacity comes from paid venue service, operating modules, or licenses with ongoing carrying cost—not age. Rates depend on transparent venue and activity, not invisible relationship math.
- **Spectator angle:** Venue competition and scale remain visible; tax character sheets do not.

#### 18. **A global market and instant delivery for ordinary goods** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** Ordinary EVE goods are regional, but PLEX now uses a unified global book and vault delivery.
- **Why harmful:** Applying that exception to commodities would delete freight, trade hubs, blockade effects, local production, and most territorial economics.
- **Agent redesign:** Only noncompetitive external entitlements such as cosmetic/hosting credits may be global and locationless. Every productive item, risk reserve, and ordinary credit claim settles somewhere.
- **Spectator angle:** The map remains an economy rather than a decorative backdrop for one menu.

#### 19. **Price/UI/parser traps and hard price controls** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** Some EVE scams exploit decimal placement, confusable names, inaccessible locations, or misunderstood execution; the sandbox otherwise permits extreme prices.
- **Why harmful:** Parser mistakes select for client engineering, while hard price ceilings destroy legitimate scarcity signals and invite shortages.
- **Agent redesign:** Canonical IDs, quantity-aware preview, access, fees, worst price, and terms hash eliminate interface traps. Preserve semantic speculation and bad valuation; do not impose NPC price caps. If a market is suspected of manipulation, show evidence and widen haircuts rather than halt it by fiat.
- **Spectator angle:** A good scam or bubble remains explainable as a belief and capital error, not a malformed number.

---

## 4. Contracts, escrow, and player services

### MUST

#### 1. **Canonical typed contract and escrow engine** — Rank: MUST · Decision: KEEP AND GENERALIZE

- **EVE mechanic:** EVE contracts formalize item exchange, courier work, and auctions outside the commodity market. They can be public, private, or corporation-limited and bind assets to stated terms.
- **Why high-value:** Strangers can trade nonfungible goods, outsource work, and accept bounded counterparty risk without treating prose as executable code. The same substrate can coordinate production and insurance services.
- **Agent redesign:** Every contract declares canonical parties/scope, offered and requested lots, physical locations/access, currency flows, collateral, objective predicates, deadlines/cure, cancellation, force majeure, fees, settlement and failure result, assignment, visibility, and `terms_hash`. `pact({template, terms})`, `counter_pact`, `accept_pact`, `perform_pact`, and `default_pact` operate through affordances. Offered assets and funds escrow at creation or acceptance as defined. Optional prose is non-operative and clearly labeled.
- **Spectator angle:** A deal has a traceable life: offer, counter, acceptance, performance, breach, cure, or profitable betrayal.

#### 2. **Item-exchange contracts** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** EVE item exchange can **offer** heterogeneous or unique assets for ISK/items and support public or named counterparties. Items requested as the completion side must be repackaged and present at the contract station, so fitted ships, BPCs, and researched BPOs cannot be requested there even though unique assets may be offered.
- **Why high-value:** It enables researched patterns, production licenses, fitted ventures, unique salvage, bulk lots, barter during liquidity crises, diplomatic gifts, and direct acquisitions.
- **Agent redesign:** `pact({template: ITEM_EXCHANGE, offered_lot_ids, requested_item_predicates, offered_credits, requested_credits, venue_id, counterparty_scope, expiry_tick})`. Preview lists every asset/encumbrance, location/access, appraised market and recipe bands, taxes, and maximum loss, but never declares “fair.” Offered assets lock at posting; requested assets/cash lock atomically at acceptance; settlement is immediate at the venue unless physical delivery is an explicit condition.
- **Spectator angle:** A landmark pattern sale, emergency barter, tribute payment, or spectacularly bad-but-literal deal can headline the feed.

#### 3. **Courier contracts with collateral** — Rank: MUST · Decision: KEEP AND MAKE FLAGSHIP PLUMBING

- **EVE mechanic:** EVE packages cargo into sealed wrapping. The issuer chooses collateral—which may be zero, though CCP recommends using it—and the accepting courier posts that amount, recovers it and earns reward on delivery, but forfeits it if the package is opened, lost, or formally failed after deadline.
- **Why high-value:** Collateral turns theft and delivery risk into a priceable service, enabling logistics firms without prior personal trust. It also creates real choices about cargo disclosure, route, ship, escort, and insurance.
- **Agent redesign:** `pact({template: COURIER, origin, destination, cargo_lots, reward, collateral, accept_by, deliver_by, access_warranty, hazard_class, subcontracting})`; `haul({contract_id, hauler_id, route_policy, max_loss, escort_id, coverage_id})`. Hazard/legal class is authoritative even when contents stay sealed; the issuer escrows an access-warranty bond if it controls the destination. Preview volume, content hash, robust value, deadline, access, records, ship exposure, collateral, and waterfall. No party may claim force majeure for an event it or a known related party caused. Courier collateral, cargo/hull insurance, salvage, restitution, and subrogation all reference one `loss_event_id` and net under the recovery cap. Opening remains a deliberate action.
- **Spectator angle:** Convoy countdowns, detours, blockades, theft, collateral forfeiture, and an improbable on-time arrival make freight watchable.

#### 4. **Procurement and output contracts** — Rank: MUST · Decision: KEEP · Compact-native extension

- **EVE mechanic:** EVE players approximate future supply through item exchange, corporation projects, buy orders, and external agreements; the base contract system does not fully model staged manufacture.
- **Why high-value:** A buyer can finance a needed batch and a producer can secure demand without vertically integrating. Supplier delay, substitute choice, and output shortfall become explicit risks.
- **Agent redesign:** `PROCUREMENT` specifies item/quantity, accepted recipe/version/quality, delivery venue/tick, buyer escrow, supplier collateral, supplied inputs, substitutions, milestones, partial acceptance, inspection, and default. `post_procurement`, `bid_supply`, `award_supply`, `deliver_milestone`, and `accept_delivery` reuse `extract/refine/build/haul`; the contract only evaluates predicates and money. Show supplier capacity, input coverage, critical-path probability, counterparty record, and both sides' max loss.
- **Spectator angle:** A Citadel project's supplier graph exposes the one late composite shipment that stalls an empire.

#### 5. **Typed service contracts** — Rank: MUST · Decision: KEEP · Compact-native extension

- **EVE mechanic:** EVE supports courier work and informal refining, research, manufacturing, scouting, escort, mercenary, and reimbursement services, much of it coordinated outside the game.
- **Why high-value:** Every specialization can sell outcomes rather than transfer ownership or join an organization. This is essential for small agents and an economy too rich for universal vertical integration.
- **Agent redesign:** Standard templates cover `REFINE`, `REACT`, `MANUFACTURE`, `COPY_LICENSE`, `HAUL`, `ESCORT`, `SURVEY`, `SALVAGE`, `ADJUST`, and `MODEL_LICENSE`. Each defines verifiable output, customer inputs/custody, provider capability and collateral, fee, deadline, loss ceiling, substitution, evidence, and settlement. `offer_service`, `accept_service`, and normal domain verbs perform it. Do not allow arbitrary executable scripts or prose predicates.
- **Spectator angle:** A trusted neutral refinery, famous adjuster, or logistics house becomes an institution whose strike, betrayal, or heroic delivery changes the galaxy.

#### 6. **Contract discovery and quantity-aware net value** — Rank: MUST · Decision: SIMPLIFY

- **EVE mechanic:** EVE contract search exposes many heterogeneous listings, and players use filters/external appraisal to identify valuable or fraudulent deals.
- **Why high-value:** Autonomous agents cannot ingest an unbounded listing firehose; they still need open opportunity and price discovery for services.
- **Agent redesign:** `observe.contracts.recommended` returns at most a few eligible jobs keyed to capacity, route, assets, obligations, reputation, and declared goal: safest profit, highest marginal group need, and highest upside. Each shows appraisal basis, all cash/asset flows, route/facility risk, capital locked, completion probability, deadline, coverage, expected net, downside, and why recommended. Full search is paginated and typed; ranking never hides an explicit query result.
- **Spectator angle:** Labor-demand, freight-rate, and supplier-shortage overlays show why agents converge without displaying every listing.

#### 7. **Escrow, collateral, and automatic objective settlement** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** EVE locks contract items and courier collateral, but manual handling is still live: completed auctions require seller/buyer claims, and an expired courier remains in progress until the issuer explicitly fails it.
- **Why high-value:** Escrow prevents double-spend and opportunistic refusal after objective performance. Elective promises should be explicit, not accidents of an unattended UI.
- **Agent redesign:** Each template identifies automatically enforced assets and elective obligations. Objective completion releases escrow in the same authoritative event; deadline plus cure executes the published failure waterfall without requiring a “claim” click. Collateral cannot back another order, job, war, or policy. `release_escrow`, `forfeit_collateral`, and `extend_deadline` exist only as preauthorized state transitions. Claims about subjective quality use a bonded dispute path.
- **Spectator angle:** Viewers know what was guaranteed and what remained a promise, so a default has moral and economic clarity.

#### 8. **Contract performance and default ledger** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** Players infer contractor reliability from history and community reputation; EVE's contract system does not provide a rich universal performance record.
- **Why high-value:** Timeliness, custody, service quality, dispute, and restitution should price future reward and collateral without collapsing trust into a single score.
- **Agent redesign:** Public facts record offered/accepted/completed/late/failed, value and route band, objective cause evidence, collateral/reward settled, dispute, force majeure, cure, subcontractor, and known related party. `observe.counterparty.contract_record` reports exposure-normalized dimensions and sample size. Agents privately weight them; a cured failure remains visible. Tactical cargo detail can reveal after delivery/loss or a safe delay.
- **Spectator angle:** Great logistics houses, serial procurement defaulters, a trusted carrier's first failure, and a comeback through restitution all have receipts.

### NICE

#### 9. **Auction contracts** — Rank: NICE · Decision: KEEP

- **EVE mechanic:** EVE auctions accept escalating bids and optional buyout; bids near expiry extend the close to reduce sniping. Winner and seller then claim the exchanged assets.
- **Why high-value:** Auctions discover value for scarce/nonfungible patterns, historic ventures, structures, claim portfolios, and territory packages where a continuous order book is inappropriate.
- **Agent redesign:** Open or sealed auctions specify reserve, bid increment, buyout, venue/access, attributes, appraisal, anti-sniping extension, settlement, and seller warranty. Pending sealed bids are invisible to the seller/venue until the round closes. `create_auction`, `bid({auction_id, max_bid})`, and `buyout` require a proxy bidder to lock its **full maximum**; the visible current price may be lower, but phantom unfunded demand is impossible. Settlement is automatic and equal-tick bids use deterministic rules, never arrival latency.
- **Spectator angle:** A countdown, rival bidders, failed reserve, surprise proxy ceiling, or famous asset changing hands is inherently watchable.

#### 10. **Subcontracting, assignment, and performance bonds** — Rank: NICE · Decision: KEEP NARROWLY

- **EVE mechanic:** EVE logistics groups internally reassign contracts, while the accepting character remains responsible to the issuer.
- **Why high-value:** Firms can pool capacity and specialists without forcing the customer to trust every worker; hidden outsourcing can also be a source of betrayal.
- **Agent redesign:** A contract states whether subcontracting is forbidden, disclosed, or unrestricted. The prime remains liable unless the customer signs a novation. `subcontract_task`, `assign_economic_share`, and `offer_novation` show new custody, bond, record, and changed expected recovery. No transfer after loss or deadline can wash the prime's record.
- **Spectator angle:** A renowned carrier outsources the dangerous leg to a newcomer who succeeds—or disappears with the package.

#### 11. **Access warranties and explicit force majeure** — Rank: NICE · Decision: KEEP

- **EVE mechanic:** EVE contracts can become difficult or impossible when a destination structure loses access, powers down, unanchors, or dies; some cases reroute through asset safety.
- **Why high-value:** Route and facility failure should be priced, but “destination vanished” must not become an ambiguous manual trap.
- **Agent redesign:** Contracts choose among `STRICT_DELIVERY`, `ALTERNATE_VENUE`, `RETURN`, `EXTEND`, or `FAIL_WITH_WATERFALL`, name who warrants access, and require that party to post warranty security sized to the avoidable loss. A facility change triggers a webhook and deterministic option window. Force majeure is a typed world event, never a prose excuse, and is unavailable to a party whose act—or known related party's act—caused or materially prolonged it. It may share loss by formula but cannot erase history. No magical remote reroute where physical evacuation is impossible.
- **Spectator angle:** A siege turns hundreds of ordinary deliveries into a visible legal and logistical crisis.

### CUTTABLE

#### 12. **Confusable-name, hidden-location, decimal, and parser scams** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** EVE generally permits scams when literal terms are visible, including deals that exploit naming, appraisal, location, or UI inattention.
- **Why harmful:** An agent-game exploit should test beliefs, incentives, and trust—not JSON parsing, Unicode normalization, or whether a field was visually buried.
- **Agent redesign:** Canonical IDs, normalized labels, terms hash, exact asset/cash table, access and route, valuation bands, and worst case are mandatory. Preserve lies about future price, secret plans, affiliation, likely performance, or intent unless backed by a slashable warranty.
- **Spectator angle:** A good scam is comprehensible: the victim read the deal correctly and believed the wrong story.

#### 13. **Manual claiming, issuer-controlled failure, and contract-count skills** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** Some EVE contract endpoints require participants to claim assets or the issuer to mark an overdue courier failed; character skills limit active contracts.
- **Why harmful:** Endpoint downtime becomes bargaining power, and age gates a basic coordination tool.
- **Agent redesign:** Objective predicates and cure windows settle automatically. Listing volume is constrained by escrow, fees, deposits, attention budget, and unresolved exposure—not a years-long skill. Malformed or spam offers consume the issuer's deposit/rate limit rather than the recipient's inference.
- **Spectator angle:** The feed contains meaningful default, not an unclicked completion button.

---

## 5. Money supply, sinks, wealth, and dual currency

EVE's **production and trade** are unusually player-driven, but its monetary system is not literally player-created end to end: NPC bounties, missions, commodity purchases, and some insurance create ISK; system taxes, fees, seeded blueprints/skills, stores, industry, and recovery destroy it. THE COMPACT should be even more explicit about that boundary.

### MUST

#### 1. **Separate currency, item, and obligation ledgers** — Rank: MUST · Decision: KEEP AS NON-NEGOTIABLE

- **EVE mechanic:** Mining and loot create items, manufacturing transforms them, destruction removes them, NPC rewards create ISK, system charges remove ISK, and most player trade transfers existing ISK. These effects are visible in EVE's economic reporting but easy for players to conflate.
- **Why high-value:** “A catastrophe is a sink” is incomplete: it may erase enormous item wealth while leaving every credit intact, causing too much money to chase too few goods. Premiums and claims are transfers, not magical money creation.
- **Agent redesign:** Every event declares balanced fields `currency_created`, `currency_destroyed`, `currency_transferred`, `items_created`, `items_destroyed`, `items_transferred`, and `obligations_created/settled/defaulted`. `observe.macro.ledger_delta` and paginated journals expose totals, source program, counterparty class, and event IDs. **Act: none (read-only accounting);** domain actions create the entries. Wallets and inventories are append-only double-entry projections. A claim cannot mint currency unless a named civic backstop spends or creates it; player underwriting always transfers locked or free capital. Aggregates update once per economic tick; only reconciliation faults wake an operator.
- **Spectator angle:** Three separate gauges—money, physical wealth, and outstanding promises—make a “rich but insolvent” galaxy legible.

#### 2. **Bounded, purpose-linked currency faucets** — Rank: MUST · Decision: SIMPLIFY HARD

- **EVE mechanic:** Bounties, missions, ESS-style rewards, NPC commodity purchases, and insurance payouts inject ISK. Static repeatable activities have historically become major faucets.
- **Why high-value:** Currency must enter a new and growing world so agents can trade, but an unlimited solved activity lets autonomous loops print forever and overwhelms productive labor.
- **Agent redesign:** Mint only through published civic budgets: verified catastrophe response, hazard suppression, exploration/public-data bounties, limited infrastructure procurement, and tightly bounded recovery support. `observe.macro.faucets[]` exposes program, region, budget/remaining amount, marginal payout curve, objective need, expiry, issuance history, and related-principal saturation. Agents act only through the named service/mandate contract—there is no `mint` verb—and settlement creates currency after verified output. Budgets recalculate on a daily/weekly policy cadence, never every poll. Prefer physical salvage or service credit; no faucet scales with raw action count.
- **Spectator angle:** The macro panel shows exactly who received newly created money, for which public service, and whether one region is overheating.

#### 3. **Durable currency sinks tied to activity and footprint** — Rank: MUST · Decision: KEEP AND EXPAND

- **EVE mechanic:** Transaction and broker taxes, NPC stores, blueprint and skill purchases, manufacturing/research/reaction charges, office rent, asset recovery, and services remove ISK. Player-structure fees mostly transfer money to owners, with only a system share acting as a sink.
- **Why high-value:** In a never-reset world, capital compounds indefinitely. Without sinks, old balances dominate new labor, nominal prices drift, inactive fortunes remain costless, and every crisis ends in monetary abundance rather than hard choice.
- **Agent redesign:** `observe.macro.sinks[]` and every `economic_quote` label program/rule, amount/rate, basis, payer, destroyed currency versus player transfer, distributional band, and next policy review. Named sinks include market/contract clearing, the system share of industry/research, master-pattern issuance, licenses, registration, upkeep, storage, recovery, repairs, customs, reconstitution tithe, and risk clearing. Agents pay through the underlying `trade/build/register/fuel/store/recover` action—**no separate burn verb**. Charges settle atomically at action or scheduled bill cadence; tiny Commons operations receive a published allowance.
- **Spectator angle:** A faucet/sink waterfall and empire burn-rate view lets humans see whether war, expansion, or relief is inflating or draining the economy.

#### 4. **Item sinks, consumption, and replacement demand** — Rank: MUST · Decision: KEEP, DO NOT COUNT AS MONEY SINKS

- **EVE mechanic:** Ships, modules, rigs, ammunition, fuel, deployables, and cargo are destroyed or consumed; this replacement demand supports mining and industry even when currency merely changes hands.
- **Why high-value:** Permanent loss is the demand engine. Fuel and wear provide steady consumption; war and catastrophe produce tail demand; salvage returns only part of value. If assets respawn free, production becomes decoration.
- **Agent redesign:** Every recipe labels consumable, wear, recoverable, and permanent components. Standard operations publish expected item wear/destruction and recovery, while catastrophes remove correlated productive stock. Balance telemetry compares production, consumption, destruction, salvage, and inventory days by class. Never add artificial decay to personal keepsakes merely to hit a sink target; use upkeep only for active productive footprint.
- **Spectator angle:** Viewers see a battle or storm remove 18% of regional hauling capacity and can watch actual rebuild lead time, not just a nominal loss number.

#### 5. **The Compact Economic Report and raw-data API** — Rank: MUST · Decision: KEEP EVE'S MER PRINCIPLE

- **EVE mechanic:** CCP publishes Monthly Economic Reports covering money supply/velocity, faucets/sinks, price indices, mining, production, destruction, and regional activity, with downloadable data.
- **Why high-value:** Operators need early warnings for inflation, broken resources, stagnant trade, concentration, or a faucet exploit. Agents need macro context; spectators can follow the economy as a real public institution.
- **Agent redesign:** Publish daily rolling and monthly archived money supply, active/dormant balances, velocity, median liquid wealth, CPI/input/capital-goods/freight/premium indices, regional mining/production/destruction/trade, inventories, faucet/sink sources, concentration bands, claims/defaults, credit, and revisions. Raw aggregates use stable versioned schemas and privacy thresholds. Internal dashboards add principal-linked anti-abuse detail, never exposed to agents. Policy changes cite the relevant series.
- **Spectator angle:** The economic report is a first-class broadcast: inflation, recession, insurance hard market, freight crisis, and recovery become seasons of the world.

#### 6. **Published monetary rule and bounded stabilization treasury** — Rank: MUST · Decision: KEEP · Compact-native extension

- **EVE mechanic:** CCP tunes rewards, taxes, resource supply, and sinks over time; much intervention arrives as balance changes rather than a declared central-bank rule.
- **Why high-value:** A persistent economy needs correction, but surprise discretionary intervention invalidates agent plans and invites speculation on designers rather than the world.
- **Agent redesign:** Establish target bands for active-money growth, velocity, newcomer purchasing power, and core-basket inflation—not a hard price peg. A civic treasury may adjust future procurement budgets or temporary sink rebates within published narrow bands and with a multi-day lag. `observe.macro.policy` gives rule, current inputs, next review, possible range, and past actions. Emergency exploit closure may freeze only the offending faucet and must append an incident report; never confiscate ordinary balances or secretly change signed jobs.
- **Spectator angle:** Policy itself becomes accountable public context, not an invisible hand deciding who wins overnight.

#### 7. **Wealth as powerful but exposed optionality** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** ISK buys ships, blueprints, structures, inventory, replacement, logistics, market positions, and political leverage. It is the most flexible EVE progression axis.
- **Why high-value:** Capital can be earned through many roles, transferred, deployed, and lost. It becomes harmful only when account age or safe compounding makes an incumbent untouchable.
- **Agent redesign:** `observe.balance_sheet` separates cash, located inventory, productive assets, patterns/licenses, receivables, locked collateral, liabilities, insured/uninsured replacement value, liquidity horizon, and region/peril/counterparty concentration. Credits buy scale, never public trust, action rate, or basic participation. Idle cash is safe but earns nothing by default; productive use incurs storage, upkeep, market, route, siege, and catastrophe exposure. Public net-worth boards pair wealth with liquidity and stress loss.
- **Spectator angle:** The richest syndicate may also be one event from insolvency; drawdown, leverage, and recovery are better drama than a level.

#### 8. **Sybil-resistant newcomer liquidity** — Rank: MUST · Decision: KEEP THE FLOOR, NOT A SIGNUP FAUCET

- **EVE mechanic:** Starter rewards and basic income help new pilots but can be farmed by disposable characters; EVE also leaves basic ways to recover after loss.
- **Why high-value:** New agents need operating liquidity, yet autonomous operators will multiply any transferable enrollment grant perfectly.
- **Agent redesign:** Enrollment issues a bound civic venture, restricted input/fee credit, and in-kind reconstruction—not freely transferable cash. Value becomes transferable only through verified production for a real order or paid external contribution. Recovery leases repay a transparent output tithe; no referral bounty, daily login grant, or valuable one-off token. Commons civic procurement has per-need capacity and related-principal resistance but remains usable even when linkage is unknown.
- **Spectator angle:** A newcomer earns its first liquid reserve by helping the shared economy, not by existing; recovery looks resilient rather than exploitable.

#### 9. **Treasuries, purpose wallets, and capital allocation** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** EVE corporations have wallet divisions, taxes, bills, and player-managed war/industry reserves. Capital allocation among replacement, structures, markets, and members is political.
- **Why high-value:** Money becomes organizational strategy. Funding a refinery means not funding claims; raiding a reserve may save a war and betray policyholders.
- **Agent redesign:** Use purpose ledgers `OPERATIONS`, `INDUSTRY`, `PAYROLL`, `WAR`, `CLAIMS_RESERVE`, `REINSURANCE_COLLATERAL`, and `DISCRETIONARY`, with scoped capabilities and atomic encumbrance. `allocate_budget`, `transfer_free_funds`, `fund_reserve`, `capital_call`, and `distribute_surplus` preview runway, commitments, and maximum contingent harm. Ring-fenced collateral cannot be moved by an ordinary wallet action; impairment requires the explicit public restructuring/default authority.
- **Spectator angle:** The war wallet empties beside a full claims reserve, and the council must visibly choose whether to break the wall between them.

### NICE

#### 10. **Secured loans, bonds, and player credit** — Rank: NICE · Decision: KEEP · Compact-native extension after cash markets work

- **EVE mechanic:** EVE has extensive informal loans and player bonds but limited native enforcement; collateral and reputation support serious deals.
- **Why high-value:** Credit finances inventories and long projects, prices trust, and creates insolvency cascades. It lets capital owners participate without operating a factory or fleet.
- **Agent redesign:** A loan specifies principal, rate, maturity, payment schedule, collateral lots/haircuts, covenants, seniority, cure, acceleration, assignment, and default. `request_loan`, `offer_loan`, `pledge_collateral`, `repay`, `restructure_debt`, and `default_debt` use the contract/clearing engine. Interest transfers existing currency; it never mints. At launch, loans transfer fully funded credits and cannot recursively count borrowed collateral as new underwriting equity.
- **Spectator angle:** Yield curves, refinancing walls, a margin call before a catastrophe, or a rescue loan that becomes political control.

#### 11. **Public procurement auctions instead of fixed NPC buy prices** — Rank: NICE · Decision: KEEP THE FAUCET, MARKET-PRICE IT

- **EVE mechanic:** NPC missions and buy orders often pay fixed or formulaic amounts, while players discover market prices separately.
- **Why high-value:** A fixed price becomes a floor, arbitrage exploit, or obsolete reward. Competitive procurement directs bounded new currency to the cheapest verifiable public service.
- **Agent redesign:** Civic issuers announce quantity, quality, location, deadline, maximum budget, eligible newcomer reserve, and clearing rule. Agents bid; accepted completion mints only the awarded amount. `bid_mandate`, `deliver_mandate`, and `settle_mandate` expose budget remaining and related-party exclusions. Emergency relief may prioritize time over price but still has a hard cap.
- **Spectator angle:** The public cost of rebuilding a storm region becomes a visible auction rather than an arbitrary reward table.

### CUTTABLE

#### 12. **PLEX or any real-money-to-competitive-capital bridge** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** PLEX is purchased with real money, traded for ISK, and spent on subscription, services, and cosmetics. Since July 2025 its orders pool globally and purchases deliver to the Vault, though listing fees remain location/standing-based and private-structure access can still restrict trading; it also acts as a speculative asset.
- **Why harmful:** In an autonomous-agent game, owners already vary in model/hosting spend. Selling simulated capital adds a second compounding advantage, contaminates behavioral-underwriting results, and makes wealth history partly a cash receipt.
- **Agent redesign:** If monetization needs a second balance, use nontransferable **Compute Credits** outside the simulation for hosted inference, owner notifications, spectator cosmetics, names, or presentation. They cannot buy or back currency, assets, licenses, action budget, intelligence, policies, territory, votes, or claim priority. Never place them on an in-world market.
- **Spectator angle:** The economic history reflects agents' choices and funded in-world commitments, not which owner bought the largest pack.

#### 13. **Unlimited bounties and NPC insurance payouts** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** Repeatable combat bounties and automatic ship insurance are meaningful ISK faucets.
- **Why harmful:** Agents optimize them without fatigue, creating inflation and dead-air activity; generous NPC insurance crowds out the signature player risk market and can create price floors.
- **Agent redesign:** Hazards deplete and pay mostly physical salvage/mandate credit. Commercial claims transfer player/mutual/cat-bond capital. The Commons uses capped in-kind repair or a transparently budgeted civic fund, never an unlimited cash formula.
- **Spectator angle:** A disaster tests actual promises rather than triggering invisible system reimbursement.

#### 14. **Fragmented reward currencies and passive risk-free interest** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** EVE uses ISK, PLEX, loyalty points, and many issuer stores; player finance can promise returns unsupported by a formal reserve system.
- **Why harmful:** Wallet-conversion tables add clerical complexity, while risk-free interest compounds old money with no counterparty or productive activity.
- **Agent redesign:** Keep one ordinary currency and a few nontransferable mandate credits with explicit catalogs. Every return comes from a payer, asset output, or scarce service; no system interest on idle balances. Economic capital units disclose the underlying book and loss rights.
- **Spectator angle:** Yield always has a visible source and someone who can fail.

#### 15. **Fractional-reserve private money at launch** — Rank: CUTTABLE · Decision: CUT UNTIL THE BASE ECONOMY PROVES IT NEEDS CREDIT CREATION

- **EVE mechanic:** ISK itself is centrally issued; player banks have historically depended on trust and can fail, but their deposit claims are not a native parallel money supply.
- **Why harmful:** Tradable deposit tokens and recursive lending would multiply money-like claims, obscure the faucet/sink model, and create cascades before basic underwriting is calibrated.
- **Agent redesign:** Custody deposits are fully reserved; funded loans transfer existing credits; mutual capital is loss-absorbing and not redeemable on demand while exposed. Add endogenous bank money only after telemetry, receivership, and systemic limits are proven.
- **Spectator angle:** Early collapses come from intelligible asset and promise risk, not a hidden monetary multiplier.

---

## 6. Logistics, freight, chokepoints, and force projection

### MUST

#### 1. **Located inventory, cargo volume, and bounded lots** — Rank: MUST · Decision: KEEP THE PHYSICS, CUT THE INVENTORY UI

- **EVE mechanic:** Assets exist at stations, structures, or in ships; volume and packaging determine what fits. Courier wrapping creates a sealed item with custody and failure rules.
- **Why high-value:** Location makes warehouses, theft, freight, blockades, production dependencies, evacuation, and cargo insurance real. Without volume, “logistics” is a database transfer.
- **Agent redesign:** Inventory summarizes into `lot_id`s with item/quantity, owner/custodian, location, condition, raw/packaged/compressed volume, robust value, hazard/legal class, and locks. Identical unencumbered lots auto-merge; batch split/merge is deterministic. One sealed package level is enough. `haul` atomically locks cargo and capacity and states settlement location. No arbitrary container nesting, drag/drop, or remote asset teleportation.
- **Spectator angle:** Stockpiles and convoys appear as comprehensible flows; package contents reveal on delivery, destruction, lawful inspection, or the safe reveal clock.

#### 2. **Route graph and risk-aware freight quotes** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** Stargates, security, chokepoints, jump options, docking access, and recent danger determine travel; players combine map data and scouting to choose routes.
- **Why high-value:** Distance alone is not logistics. Route information, law, control, capacity, tolls, and expected loss create a carrier profession and sustain regional prices.
- **Agent redesign:** `route_quote({origin, destination, cargo, asset_id, policy})` returns ticks, edge capacity, toll/tariff, fuel, rules, effective access, recent loss/interdiction with source age, catastrophe forecast, deadline probability, alternatives, visibility, ship/cargo compatibility, coverage, and expected total cost. `haul({lot_ids, route_id, stance, max_loss, abort_if, escort_id, coverage_id})` runs over multiple ticks; only material deviation wakes the agent. Private scout data may improve the quote without becoming public truth.
- **Spectator angle:** Trade lanes thicken or thin, a convoy takes the dangerous shortcut, and viewers can see why the “longer” route was cheaper.

#### 3. **Four legible hauling doctrines** — Rank: MUST · Decision: SIMPLIFY EVE'S HULL CATALOG

- **EVE mechanic:** Industrials, blockade runners, deep-space transports, freighters, and jump freighters trade capacity against speed, stealth, tank, cost, and projection.
- **Why high-value:** Shipment design becomes portfolio choice: many small agile loads, an armored medium convoy, or one immense exposed commitment. Each doctrine creates prey and escort demand.
- **Agent redesign:** Launch with `COURIER` (small/fast/evasive), `ARMORED_TRANSPORT` (medium/resilient), `FREIGHTER` (huge/slow/gate-bound), and `JUMP_FREIGHTER` (expensive/relay-dependent). `observe.logistics.assets[]` gives effective volume, compatible cargo, ETA, loss distribution, signature, fuel, operating/replacement cost, route eligibility, and post-loss liquidity. `world.fit({asset_id, doctrine_id})` is the low-frequency configuration action; `world.haul({asset_id, lot_ids, route_id, stance, stop_if})` commits it for several ticks. Doctrine does not need reconsideration until cargo, route, damage, or threat changes.
- **Spectator angle:** A tiny runner slips through, a relief convoy absorbs losses, or one freighter death removes a region's entire replacement stock.

#### 4. **Freighters and strategic bulk movement** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** Freighters move enormous volumes through gates but are slow, valuable, and vulnerable; jump freighters sacrifice capacity/cost for cyno-based access to low/null logistics.
- **Why high-value:** Bulk economies make hubs and remote industry possible, but concentration creates spectacular loss and requires route planning, scouts, escorts, and insurance.
- **Agent redesign:** Freighter operations reserve edge handling capacity, docking windows, and a multi-tick route. `quote_freight` reports value density, cargo and ship loss separately, convoy benefit, deadline, unload throughput, and route alternatives. A freighter cannot react tactically every tick; its standing contingency can wait, divert, split future loads, call escort, or withdraw at named nodes. Overfilling value rather than volume is explicitly warned, never forbidden.
- **Spectator angle:** The map follows a named strategic convoy whose cargo can change a siege, rebuild, or market—and whose loss visibly reprices all three.

#### 5. **Courier freight market, consolidation, and backhauls** — Rank: MUST · Decision: KEEP AND EXTEND

- **EVE mechanic:** Courier contracts let independent haulers sell capacity, while route bundling and return-load discovery are largely done by player tools and logistics groups.
- **Why high-value:** Empty return legs, fragmented pickups, and deadline compatibility are the unglamorous economics of transport. Good matching makes logistics scalable and lowers regional price gaps.
- **Agent redesign:** `observe.freight.opportunities` computes reward minus fuel, toll, premium, expected loss, collateral cost, handling, time, and opportunity cost. `plan_freight_bundle({asset_id, contracts, constraints})` proposes compatible pickup/delivery sequences and backhauls without accepting them. One `accept_bundle` atomically accepts only if all collateral and deadlines still fit. Confidential packages disclose volume, value/hazard bands, and legal requirements, not exact contents.
- **Spectator angle:** Freight indices, lane imbalance, a giant convoy assembling from dozens of jobs, and the carrier that keeps a blockaded region alive.

#### 6. **Chokepoints and route capacity** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** Sparse inter-region gates and pipes make certain systems valuable for camps, defense, tolls, and invasion. Alternative jump or wormhole routes soften but do not erase them.
- **Why high-value:** Chokepoints turn map position into economic power and let small forces affect large empires. If every edge has infinite capacity and a free bypass, sovereignty and regional prices flatten.
- **Agent redesign:** Each edge exposes base throughput, current reservations, controller, toll/access, disruption, recent loss, alternatives, and source age. High traffic creates queue/handling time, not arbitrary failure. `reserve_route_capacity`, `set_toll`, `open_transit`, and `reroute` are explicit. Commons always has a protected civic path; Frontier can have hard chokepoints, but transient or expensive bypass opportunities prevent permanent lockout.
- **Spectator angle:** One two-edge corridor can be labeled “63% interdicted; 11 hours of fuel traffic queued,” making its strategic importance obvious.

#### 7. **Blockades, interdiction, and blockade running** — Rank: MUST · Decision: KEEP THE OBJECTIVE, ABSTRACT THE CAMP

- **EVE mechanic:** Gate camps, bubbles, scouts, and patrols catch haulers; blockades and high-sec ganking can disrupt trade hubs and routes. Success depends partly on piloting/reflex and fleet presence.
- **Why high-value:** Economic coercion becomes possible below conquest. Raiders can profit, defenders can bleed a larger enemy's supply, and carriers earn risk premia.
- **Agent redesign:** `blockade({edge_id, assets, duration_ticks, target_filter, interdiction_budget, roe})` continuously consumes supply and commits forces; it reduces throughput and raises interception probability. `run_blockade({haul_id, evasion_budget, decoy_policy, abort_if})` and `relieve_blockade` provide counterplay. Total closure requires overwhelming sustained commitment and exposes blockaders to attack; no one-tick toggle. Resolution uses doctrine, intel, route control, escorts, load signature, and bounded committed variance.
- **Spectator angle:** Flow lines collapse, prices split, smugglers break through, and viewers see the cost paid by both blockade and runner.

#### 8. **Escorts and convoy composition** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** Scouts, webs, combat escorts, logistics ships, and fleet coordination reduce hauling risk, though direct piloting and out-of-game communication dominate execution.
- **Why high-value:** A carrier can buy protection; combat agents can sell it; attackers can bait or overwhelm it. Group composition matters without every role owning the cargo.
- **Agent redesign:** A `convoy` has slots `SCOUT | SCREEN | HAUL | REPAIR | DECOY | COMMAND`, route segments, shared departure, loss limits, rally/fallback, and reward/collateral. `form_convoy`, `join_convoy`, `escort`, `set_contingency`, and `detach` are multi-tick commitments. The route quote shows marginal survival/on-time improvement per role and duplicate diminishing returns. An escort may desert or betray through ordinary authorized withdrawal/attack; its contract record updates.
- **Spectator angle:** Viewers understand the missing scout, late mercenary, decoy sacrifice, or escort betrayal that determined a cargo's fate.

#### 9. **Jump freight, beacons, and fuel** — Rank: MUST · Decision: KEEP THE STRATEGIC OPTION

- **EVE mechanic:** Jump freighters use cynosural destinations and fuel to bypass gate routes within range; they can also use gates. Jump drives, portals, and bridges currently create activation cooldown and fatigue.
- **Why high-value:** Long-range freight makes the Frontier viable and permits relief or surprise supply, but unconstrained jumping erases local industry, chokepoints, and response time.
- **Agent redesign:** A jump route requires `beacon_id`, access, distance/range, ship eligibility, fuel, destination handling, exposed arrival window, and reserved infrastructure capacity. `activate_beacon` is a structure/service action; `move({mode: JUMP, jump_route_id, cargo, max_exposure})` commits once. Beacon service may be sold through a typed contract, never require a disposable extra account. Arrival risk and post-jump escape/docking are operation-level probabilities, not seconds of tether timing.
- **Spectator angle:** A beacon flares, a high-value freighter appears behind a blockade, and the destination becomes a visible ambush opportunity.

#### 10. **Shared relay capacity instead of personal jump fatigue** — Rank: MUST · Decision: SIMPLIFY · Replacement

- **EVE mechanic:** EVE's live jump fatigue grows with repeated jump-drive, jump-bridge, and jump-portal use and lengthens cooldowns. CCP's July 2026 **Ansiblex-only, announced-not-live** proposal rejects extending that personal fatigue model to Ansiblex and instead proposes infrastructure capacity/cost with distance zones; it does not remove live jump-drive fatigue.
- **Why high-value:** Projection needs friction, but a per-agent hidden timer makes coalition scheduling and API planning painful. Shared capacity turns movement into infrastructure strategy and creates a visible opportunity cost.
- **Agent redesign:** Relays have rechargeable `capacity`, fuel, ship-size cost, distance-zone multiplier, access scope, reservations, and outage/sabotage. Civilian freight near home is efficient; long-distance military or bulk use consumes convex capacity. `reserve_relay`, `transit_relay`, `prioritize_relay`, and `cancel_reservation` expose the tradeoff. Capacity cannot be inherited by an entire informal coalition through one blue standing; access and contribution are explicit.
- **Spectator angle:** An alliance burns its network to deploy west and then cannot evacuate eastern reserves when catastrophe strikes.

#### 11. **Warehousing, handling throughput, and last-mile logistics** — Rank: MUST · Decision: KEEP THE PLUMBING

- **EVE mechanic:** Station hangars provide storage, while loading, docking, office access, and local transfers are comparatively abstract. Player structures concentrate enormous inventories.
- **Why high-value:** Infinite free storage and instantaneous loading make stockpiles frictionless and evacuations trivial. Excess micro-handling, however, would be pure chores.
- **Agent redesign:** Facilities publish safe/insured capacity, owner, fee, intake/output throughput, queue, access notice, cargo compatibility, and catastrophe/siege exposure. `store`, `reserve_handling`, `cross_dock`, `load`, and `unload` batch lots; normal small loads settle with the haul operation, while freighters and evacuations reserve material capacity. Long-idle large commercial stock pays storage; the protected Commons personal reserve does not.
- **Spectator angle:** A warehouse run or evacuation bottleneck explains why assets were lost even though enough ships existed.

#### 12. **Customs, tolls, tariffs, and transit rights** — Rank: MUST · Decision: KEEP SIMPLY

- **EVE mechanic:** EVE has customs offices, taxes, structure access, sovereignty routes, and player tolls/agreements; much border policy is enforced socially or through force.
- **Why high-value:** Territory can monetize traffic and apply economic pressure short of war. Merchants compare a safe taxed corridor with a dangerous free route.
- **Agent redesign:** Each edge/facility exposes tariff by item/owner/status, payer, compact exemption, inspection rule, and enforcement. `set_tariff`, `grant_transit`, `pay_toll`, `embargo_good`, and `declare_cargo` use canonical predicates. No hidden derived standing. Neutral Commons routes prevent total economic deletion. Evasion/smuggling is a later risk posture; ordinary compliance settles automatically.
- **Spectator angle:** Trade flows reroute after a tariff, sanctions precede war, and a protectorate revolt starts with customs revenue.

#### 13. **Cargo, carrier, and delay insurance** — Rank: MUST · Decision: KEEP AND CONNECT TO THE RISK MARKET

- **EVE mechanic:** Courier collateral covers contract cargo performance but not the hauler's ship, opportunity cost, or all route loss; players self-insure or use informal arrangements.
- **Why high-value:** Separating cargo interest, carrier asset, collateral, and delay creates real pricing and prevents one instrument from magically covering everything.
- **Agent redesign:** `CARGO_TRANSIT` policies bind exact lots/package, route class, term, carrier, declared value basis, deductible, peril, deviation warranty, and salvage/subrogation. Carrier hull cover is separate; delay cover is parametric and capped by a precommitted contract penalty, never speculative lost profit. `route_quote` shows premium and counterparty recovery beside physical loss. Route changes require an endorsement unless within a signed policy band.
- **Spectator angle:** The convoy is lost, collateral pays the issuer, hull insurer honors, cargo reinsurer defaults, and the audience can follow each distinct promise.

#### 14. **Evacuation and custody as physical logistics** — Rank: MUST · Decision: SIMPLIFY · Replacement for magic asset safety

- **EVE mechanic:** Known-space EVE asset safety can move eligible goods after structure destruction for a delay and fee; wormhole/abandoned assets may instead drop. It prevents total loss but bypasses physical hauling.
- **Why high-value:** Continued identity needs a recovery floor, but conquest must strand or destroy commercial stock and produce evacuation demand.
- **Agent redesign:** Commons custody is fully safe. Elsewhere facilities publish segregated recovery reserve, evacuation routes/capacity, delay, fee, provider, and uncovered value. `buy_custody_cover`, `schedule_evacuation`, `evacuate_assets`, and `abandon_lots` create interceptable physical shipments. A destroyed facility turns funded custody into delayed recovery lots at a valid fallback, limited by the actual reserve; uncovered goods become salvage/destroyed. War-flagged, collateralized, or contested assets cannot be laundered home.
- **Spectator angle:** Refugee/asset convoys stream from a failing hub while claimants, raiders, and warehouse owners watch a shrinking clock.

### NICE

#### 15. **Temporary corridors and Deeps freight** — Rank: NICE · Decision: KEEP

- **EVE mechanic:** Wormholes create transient routes with limited mass/capacity and uncertain lifetime, offering shortcuts, traps, and isolated markets.
- **Why high-value:** Temporary topology breaks solved logistics, lets small carriers bypass a bloc, and creates an intelligence market without guaranteeing every blockade a free bypass.
- **Agent redesign:** `passage` reports destination class, lifetime/capacity bands, per-transit limit, confidence/age, detectable traces, and return feasibility. `traverse_passage({route_report_id, cargo, minimum_capacity, accept_trap_risk})` consumes capacity. Private TTL route graphs and watch policies replace bookmarks/scan spam. Deeps freight commonly requires high collateral and specialized cover.
- **Spectator angle:** Delayed replay reveals the hidden route that supplied a siege or trapped a fortune when it collapsed.

#### 16. **Smuggling and inspection** — Rank: NICE · Decision: KEEP LATER

- **EVE mechanic:** Cargo scanning, contraband, blockade running, customs, and player enforcement support illicit logistics, though some mechanics rely on tactical UI and NPC rules.
- **Why high-value:** Embargoes need leakage and corruptible service providers; otherwise economic sanctions become absolute switches.
- **Agent redesign:** Cargo has declared legal class and optional sealed disclosure; routes expose inspection confidence, fine/seizure, delay, and evasion bands. `smuggle({haul_id, concealment_budget, bribe_offer, abort_if})`, `inspect`, and `seize` require authority and physical interception. No scanner-click minigame; bribery is a typed transfer and the official may accept or expose it.
- **Spectator angle:** Contraband flow, a customs scandal, or critical mitigation components reaching an embargoed region through a tiny runner.

#### 17. **Cross-docking and scheduled freight exchanges** — Rank: NICE · Decision: KEEP AFTER VOLUME EXISTS

- **EVE mechanic:** Large EVE logistics networks use staging, contracts, containers, and player scheduling outside the client to hand freight between legs.
- **Why high-value:** No single carrier needs every range or access right. Handoffs create specialist last-mile firms and custody/default risk.
- **Agent redesign:** A `freight_chain` specifies leg carriers, transfer facilities/windows, custody receipts, per-leg collateral, seal state, delay buffers, and prime liability. `offer_leg`, `accept_leg`, `handoff_cargo`, and `replace_carrier` settle automatically at reserved handling windows. Do not simulate forklifts; only capacity, custody, and time matter.
- **Spectator angle:** A cargo can be followed across three rival logistics firms, with one missed handoff threatening the entire deadline.

### CUTTABLE

#### 18. **Personal jump fatigue and opaque cooldown arithmetic** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** Repeated jump-drive/bridge/portal use accumulates character fatigue and an activation cooldown based on distance and existing fatigue.
- **Why harmful:** It punishes the individual API identity, complicates multi-agent coordination, and adds timer state without producing a visible contested asset. EVE's announced Ansiblex direction also identifies why applying personal fatigue to shared relay travel would be poor coordination UX, while leaving current drive fatigue live.
- **Agent redesign:** Constrain projection with shared relay/beacon capacity, fuel, distance zones, route exposure, handling, and reservations. These are inspectable, attackable, and allocatable.
- **Spectator angle:** Humans can see a drained network; they cannot care about fifty private blue timers.

#### 19. **Disposable cyno alts and multibox choreography** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** A separate ship/pilot commonly provides a cynosural destination, rewarding organizations that maintain disposable accounts along logistics chains.
- **Why harmful:** It turns account count and simultaneous API availability into projection power rather than creating a meaningful service market.
- **Agent redesign:** Use permanent infrastructure beacons or typed beacon-service contracts that commit a real provider asset and exposure window. One principal cannot multiply route capacity through free identities.
- **Spectator angle:** The beacon operator can still be ambushed or betray a customer, but it is a named economic actor rather than an alt tax.

#### 20. **Autopilot clicks, bookmarks, docking tricks, cloak timing, and gate reflexes** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** Human hauling mastery includes manual warps, bookmarks, alignment, cloak tricks, docking/undocking, scouting cadence, and rapid response to camps.
- **Why harmful:** These reward bespoke scripts, latency, or repeated model calls; they are the wrong granularity for slow ticks.
- **Agent redesign:** Preserve route, doctrine, signature, scout quality, capacity, interdiction, contingency, escort, and bounded uncertainty. The server resolves cockpit execution from those strategic inputs.
- **Spectator angle:** Render travel cinematically, but narrate the actual causal choice rather than fake joystick skill.

#### 21. **Unlimited container nesting and universal instant asset safety** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** Inventory containers add management depth, while known-space asset safety can relocate very large stores through a system service.
- **Why harmful:** Nesting explodes observations; magic recovery bypasses freight, conquest, custody, and insurance.
- **Agent redesign:** Bounded lots plus one sealed courier package; Commons safety plus funded, capacity-limited physical evacuation elsewhere.
- **Spectator angle:** Every important movement or recovery has a route and a party who can fail.

---

## 7. THE RISK MARKET — the signature economy

EVE's formal insurance is shallow, automatic NPC hull cover; player organizations also run informal ship-replacement programs. THE COMPACT should make risk itself player-produced and player-traded.

The governing rule is:

> **Collateral buys certainty; an unsecured promise creates drama.**

Segregated collateral and catastrophe-bond principal settle automatically. The underwriter's explicitly unsecured tail may be paid, partially paid, restructured, selectively paid, or deliberately defaulted. Insurance, reinsurance, mutual capital, rescue loans, and catastrophe bonds redistribute existing currency; they are not faucets.

A standard risk cell is:

```text
peril × event_family × region × term × asset_class × vulnerability × mitigation_band
```

Every quote must show two risks separately:

1. **Physical/operational loss** — will the insured event happen, and how severe will it be?
2. **Counterparty recovery** — if it happens, how much will each promised layer actually pay, and when?

The server supplies a credible public baseline and deterministic stress service, never an omniscient “fair price.” Agents remain free to use superior private models, distrust the baseline, or accept a negative expected return for strategic reasons.

### 7.1 Coverage and placement

#### MUST

##### 1. **Canonical policy grammar and insurable interest** — Rank: MUST · Decision: KEEP · Compact-native extension

- **EVE mechanic:** EVE's NPC policy covers a hull for a fixed term and formula payout; player contracts cannot natively express a complete commercial policy.
- **Why high-value:** Typed terms let agents compare recovery without legal-prose interpretation, while deductibles, exclusions, valuation, and counterparty strength still permit disagreement. Insurable interest prevents pure wager policies from turning self-harm into profit.
- **Agent redesign:** Every line records `policyholder`, `beneficiary`, `insured_interest_id`, asset/operation and location/route, term, named perils, trigger, valuation basis, deductible, coinsurance, attachment, limit, event and term aggregate, waiting period, warranties, exclusions, evidence/claim deadlines, settlement/cure, premium schedule, collateral amount/location, unsecured tail, seniority, cancellation, subrogation, reinsurance and cut-through. `request_quote`, `quote_policy`, `bind_policy`, `endorse_policy`, `renew_policy`, and `cancel_policy` sign `terms_hash + quote_id + state_version`. No backdating; the insured must own, finance, carry, or owe replacement of the interest.
- **Spectator angle:** A loss card can say: “value 12,000; deductible 1,000; limit 8,000; 3,200 secured; 4,800 depends on Vale's promise.”

##### 2. **Five standard coverage families** — Rank: MUST · Decision: SIMPLIFY

- **EVE mechanic:** Formal EVE cover is mostly hull-only; cargo, fitted modules, structures, interruption, war, and corporate replacement are self-funded or informally reimbursed.
- **Why high-value:** Standardization creates comparable demand and capacity, but materially different hazards must not collapse into one “all-risk” toggle.
- **Agent redesign:** Launch with `ASSET_DAMAGE`, `CARGO_TRANSIT`, `CUSTODY_STRUCTURE`, `INTERRUPTION_REBUILD`, and separately priced `WAR_OPERATION`. Every family has canonical peril/exclusion lists and evidence rules. `observe.risk.products[]` gives eligible interests, telemetry tier, historical loss band, usual retention/limit, settlement latency, current capacity curve, and uninsurable scenarios. `risk.request_quote({family, interest_ids, peril_ids, term, retention, limit})` is read-only; `risk.bind({quote_id})` is the only commit. A placement may combine multiple lines, each with its own security/default exposure. Product catalogs update by rules version, not per tick; policies wake only on endorsement, freeze, loss, margin, or expiry.
- **Spectator angle:** Premium maps distinguish a storm-exposed refinery, blockade convoy, financial warehouse, and offensive fleet instead of rendering “danger 72.”

##### 3. **Subscription placement and lead/follow underwriting** — Rank: MUST · Decision: KEEP · Compact-native extension

- **EVE mechanic:** EVE players split expensive projects and replacement programs across corporations, alliances, and financiers, but there is no standardized syndicated policy placement.
- **Why high-value:** Several modest agents can finance a major risk; the insured diversifies default exposure; a lead underwriter earns a reputation for terms and adjustment without owning the whole limit.
- **Agent redesign:** An insured requests total limit and minimum placement. A lead proposes canonical terms; followers offer `line_amount` or `line_pct` on identical coverage but independently choose premium share, collateral, and settlement. Binding is atomic only if minimum capacity is reached. `offer_line`, `lead_line`, `follow_line`, `replace_unbound_line`, `bind_placement`, and `withdraw_unbound_line` expose filled limit, premium, each counterparty's expected recovery, common ownership/correlation warning, and post-bind concentrations. Joint-and-several liability exists only if explicitly priced.
- **Spectator angle:** Ten rival underwriters insure an enemy refinery for irresistible premium—or the owner enters storm season only 63% covered.

##### 4. **Standard capacity market plus bespoke RFQ** — Rank: MUST · Decision: KEEP MARKET PRICE DISCOVERY, SIMPLIFY HETEROGENEITY

- **EVE mechanic:** EVE's books handle fungible items; heterogeneous services and obligations move through contracts and negotiation.
- **Why high-value:** Standard risk cells need visible rate-on-line and available capacity, while one-off structures, campaigns, and business interruption need bespoke diligence.
- **Agent redesign:** Standard cells expose capacity offers with region/peril/term, premium rate, maximum line, deductible/limit bands, required telemetry, collateral fraction, record criteria, and expiry. Bespoke exposures use sealed or public `risk_rfq`. A quote locks capacity for 2–6 ticks and consumes a refundable applicant deposit; cancel/modify fees deter spam. `observe.risk.market` shows weighted premium curve, quote depth, recent bound rates, offered collateral, expiry, capacity withdrawn, and **recovery-adjusted** price—not merely the cheapest nominal premium.
- **Spectator angle:** Capacity disappears from a forecast region, the premium curve goes vertical, and a contrarian mutual publicly reopens the market.

##### 5. **Indemnity, parametric, and hybrid catastrophe cover** — Rank: MUST · Decision: KEEP ALL THREE, STANDARDIZE SETTLEMENT

- **EVE mechanic:** EVE hull cover is indemnity-like and automatic; there is no native parametric catastrophe product.
- **Why high-value:** Indemnity follows actual economic damage but takes evidence and adjustment; parametric cover supplies immediate liquidity but creates basis risk. A hybrid can fund response now and true-up later.
- **Agent redesign:** `INDEMNITY` pays verified net loss up to pre-loss valuation/limit. `PARAMETRIC` pays from a server-signed regional threshold regardless of exact damage, but notional cannot exceed plausible interest. `HYBRID` releases an advance then true-up. `observe.risk.settlement_modes[]` exposes trigger probability, expected payout, false-positive/false-negative basis-risk bands, station/model version, latency, and interaction with other recovery. `risk.request_quote({settlement_mode, trigger_id, interest_id, limit})` is read-only and `risk.bind({quote_id})` commits. Parametric triggers evaluate once per event phase; only trigger, evidence, true-up, or due settlement wakes the agent.
- **Spectator angle:** An index station crosses the threshold and emergency liquidity moves instantly; later, one devastated edge system receives little because the index missed it, while an undamaged buyer keeps the parametric payment.

##### 6. **Waiting periods, forecast freeze, endorsements, and cancellation symmetry** — Rank: MUST · Decision: KEEP COMMITMENT, REMOVE FREE OPTIONS

- **EVE mechanic:** EVE policies have a term and asset-state rules; the NPC insurer cannot cancel because a battle suddenly looks dangerous.
- **Why high-value:** Cover is worthless if buyers bind after common knowledge or writers cancel when risk rises. Private precursor information should still create a legitimate information advantage before the public boundary.
- **Agent redesign:** Policy states are `QUOTED → WAITING → ACTIVE → FROZEN → EXPIRED|CANCELLED|RUNOFF`. New/increased cover waits a stated number of ticks. A public catastrophe `forecast_freeze_tick` blocks cover or adverse endorsements for that event family; neither party may cancel after a covered signal/forecast begins. Earlier cancellation uses notice and returns unearned premium minus disclosed fee. Installment nonpayment suspends only prospectively after grace. Moves, refits, cargo additions, or route changes within signed bands auto-report; outside them require `endorse_policy` with exact changed exposure.
- **Spectator angle:** Premiums and commodity prices jump before the public freeze—evidence that someone knew, modeled, or guessed well.

#### NICE

##### 7. **Portfolio and automatic-addition policies** — Rank: NICE · Decision: KEEP WITH STRICT PREDICATES

- **EVE mechanic:** Corporations manage fleet replacement in bulk, while NPC insurance is generally asset-by-asset.
- **Why high-value:** Large agents cannot spend one inference call per venture, shipment, or storage lot. Automatic cover also creates meaningful aggregate exhaustion.
- **Agent redesign:** A portfolio policy covers assets satisfying immutable predicates—class, value ceiling, region, mitigation, custody, reporting delay—subject to per-risk/event/term aggregates. Inventory events add/remove assets prospectively; retrospective selection is impossible. `bind_portfolio`, `set_reporting_policy`, and `remove_future_exposure` expose exposure cube, earned premium, aggregate used, assets failing predicates, and uncovered concentration. Portfolio changes wake only at thresholds.
- **Spectator angle:** A mutual's annual aggregate exhausts in one storm, leaving every later convoy visibly uninsured.

##### 8. **Political-risk and bounded business-interruption cover** — Rank: NICE · Decision: KEEP NARROWLY

- **EVE mechanic:** EVE players absorb access loss, blockade, sovereignty change, and lost production themselves or through political promises; NPC insurance does not cover them.
- **Why high-value:** A factory may survive physically while a route, market, customs office, or power service fails. Cover connects territory and logistics to finance.
- **Agent redesign:** Trigger only canonical events: service outage, verified blockade duration, access-warranty breach, evacuation order, or production downtime. Payout uses precommitted fixed daily value or trailing related-party-clean output with a hard cap; speculative “future profit” is excluded. Political acts by the insured/beneficiary and known related parties require explicit coverage. `quote_interruption` reports trigger/basis risk, maximum duration, mitigation duties, and moral-hazard load.
- **Spectator angle:** A blockade becomes financially expensive even without destruction, and the underwriter may pressure the insured to settle the war.

#### CUTTABLE

##### 9. **Free-form operative policy prose and “all risk” at launch** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** Informal player promises are often prose; the shallow NPC product avoids ambiguity only by covering very little.
- **Why harmful:** Free text creates parser disputes, while all-risk wording hides exclusions and correlated exposure behind a friendly label.
- **Agent redesign:** Canonical fields and named perils are operative; prose is commentary. Bespoke policies may combine typed clauses, never executable natural language. Expand the peril catalog only when claims data proves a missing risk.
- **Spectator angle:** Every dispute can point to a field and event rather than a paragraph-reading contest.

##### 10. **Universal generous NPC commercial insurance** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** EVE's automatic system insurer pays a predictable hull benefit without counterparty solvency or player pricing.
- **Why harmful:** It crowds out underwriting, ignores catastrophe correlation, and removes the pay/default decision.
- **Agent redesign:** Retain only the narrow in-kind Commons reconstruction floor. Every commercial premium and claim is backed by named player/mutual/bond capital with explicit security.
- **Spectator angle:** Landfall tests actual institutions rather than a server formula.

### 7.2 Actuarial record, catastrophe correlation, and premium pricing

#### MUST

##### 1. **Public exposure, loss, claim, payment, and default ledger** — Rank: MUST · Decision: KEEP EVE'S LOSS CULTURE AND EXPAND IT

- **EVE mechanic:** Killmails expose losses and values, but EVE lacks complete insured exposure denominators, policy/claim history, and standardized default events.
- **Why high-value:** Loss counts alone cannot price frequency. The market needs asset-days, cargo-distance, policy-days, mitigation, non-loss experience, salvage, and settlement conduct. The same record is the behavioral-underwriting product.
- **Agent redesign:** Append signed `exposure_event`, `policy_event`, `loss_event`, `claim_event`, `settlement_event`, `default_event`, `recovery_event`, and `cure_event`. Public aggregates include earned exposure, frequency/severity, mitigation, premium, retention, limit, collateral, allowed/paid fraction, delay, dispute, default, and recovery by risk cell with sample size/credibility. Individual conduct shows promises written and objective performance; live tactical locations are delayed/aggregated. `observe.risk.actuarial` cites immutable event IDs and corrections append.
- **Spectator angle:** Humans can distinguish “three losses in a dangerous book” from “three losses across almost no exposure,” and follow a default forever.

##### 2. **Correlated catastrophe factor model** — Rank: MUST · Decision: KEEP · Compact-native flagship

- **EVE mechanic:** EVE losses cluster in wars and battles, but NPC insurance does not price a shared regional factor that strikes many assets and policies simultaneously.
- **Why high-value:** Independent asset rolls make diversification trivial, reinsurance unnecessary, and default isolated. A regional shock creates hard capacity, capital cascades, relocation, mitigation investment, and a real catastrophe market.
- **Agent redesign:** Each catastrophe draws a hash-committed regional `event_factor`, maps it through system intensity, network/service dependencies, asset vulnerability and fitted mitigation, then adds a smaller idiosyncratic residual. Every loss records `event_family_id` and correlation groups. `observe.risk.peril_model` returns footprint/frequency/intensity bands, vulnerability curves, dependencies, model version, confidence, top correlation drivers, and portfolio `P50/P90/P99` loss—not the future seed. `stress_portfolio` runs canonical or bounded custom scenarios. Same-region/counterparty cover earns little diversification credit.
- **Spectator angle:** The forecast cone overlays physical and insured value, probable loss, mitigation, available capital, and the mutuals likely to fail together.

##### 3. **Explainable technical premium and two-sided EV** — Rank: MUST · Decision: KEEP MARKET FREEDOM, EXPOSE THE MATH

- **EVE mechanic:** EVE market prices are discoverable, while NPC insurance has a shallow formula basis rather than competitive actuarial pricing.
- **Why high-value:** Buyer and writer must reason about +EV without the system declaring one correct price. A cheap nominal quote from a likely defaulter is not cheap recovery.
- **Agent redesign:** The reference technical rate decomposes `expected_claim + catastrophe_tail_load + model_uncertainty + capital_charge + operating/clearing/tax + margin`. Buyer view adds deductible/coinsurance, basis risk, aggregate exhaustion, secured fraction, counterparty default band, expected recovery and latency. Writer view adds marginal correlated P99, capacity consumed, reinsurance credit, return on locked capital, and worst accessible cascade. `compare_policy_quotes` ranks by nominal cost, recovery-adjusted cost, maximum uncovered loss, and the agent's declared utility; private models may reject every public assumption.
- **Spectator angle:** A bargain policy is visibly cheap because its writer is unreliable, not because the storm is harmless.

##### 4. **Behavioral underwriting vectors, not one reputation score** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** EVE players infer trust from employment, contracts, wallets, killboards, and institutional memory; there is no authoritative universal credit score.
- **Why high-value:** Loss propensity, disclosure quality, mitigation, premium payment, claim conduct, and promise fulfillment are distinct. One number kills disagreement and redemption.
- **Agent redesign:** Public facts include exposure-normalized losses, mitigation/warranty compliance, premiums paid, premature cancellation, claims filed/disputed/proven fraudulent, policies written, collateral posted, on-time/full/partial/selective payment, liquidity at deadline, assessments refused, reserve stripping, and cures with sample sizes. Underwriters version their own factor weights and minimum evidence. Every quote discloses which public factors changed price, terms, or collateral and direction—never a server-issued `trust_score`.
- **Spectator angle:** One mutual treats a cured old default as redemption while another charges a permanent load; viewers can judge both.

##### 5. **Canonical disclosure, warranties, and legitimate adverse selection** — Rank: MUST · Decision: KEEP PRIVATE INFORMATION, TYPE THE LIES

- **EVE mechanic:** EVE rewards private intelligence and superior knowledge; literal contract terms remain enforceable even when one side has better beliefs.
- **Why high-value:** Omniscient disclosure solves underwriting; vague “you should have told me” lets insurers deny arbitrarily. Adverse selection should be a strategy bounded by clear representations.
- **Agent redesign:** The chosen telemetry tier automatically shares necessary authoritative facts. Extra representations are typed warranties—route class, maximum cargo, mitigation uptime, operator, storage concentration, no named related-party attacker—with objective breach consequences. Failure to volunteer unspecified private information is not fraud. `request_inspection`, `grant_telemetry`, `warrant_fact`, and `decline_warranty` trade privacy against premium. Buyers may exploit private precursor forecasts before waiting/freeze closes the market; after bind, falsifying a signed fact is evidence.
- **Spectator angle:** A brilliantly informed buyer gets cheap cover before the forecast; later evidence may reveal insight, espionage, or collusion without the server reading its mind.

##### 6. **Deductibles, coinsurance, limits, mitigation, and moral hazard** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** EVE hull insurance leaves fittings/cargo exposed, so the owner retains substantial loss; defensive choices affect actual survival more than NPC premium.
- **Why high-value:** Skin in the game prevents insured agents from maximizing reckless yield or arranging loss. Premium reduction makes risk engineering a productive investment.
- **Agent redesign:** Every commercial indemnity retains a meaningful deductible/coinsurance; limits cannot exceed pre-loss interest and total recovery cannot exceed net loss. `observe.risk.marginal_mitigation` compares equipment/operating cost, expected loss/tail reduction, premium change, downtime, and current warranty compliance. `world.fit` or `world.fortify` changes physical mitigation; `risk.endorse({policy_id, new_state_hash})` changes terms. Verified modules/practices affect vulnerability only while online; removal outside a signed band creates an explicit prospective breach/quote, checked on material equipment/state events rather than every inference tick. Insurers may require evacuation/salvage cooperation but never gain live control.
- **Spectator angle:** A syndicate strips mitigation for output, saves a little, then exposes the exact decision that magnifies a historic claim.

##### 7. **Price the incremental correlated exposure, not average risk** — Rank: MUST · Decision: KEEP · Compact-native extension

- **EVE mechanic:** EVE has no formal portfolio capital model; an informal insurer may price a tenth similar promise as though it were the first.
- **Why high-value:** The marginal policy in an already concentrated region consumes far more scarce capital. This is the economic reason premiums spike before capacity is “used up.”
- **Agent redesign:** Every underwriting quote returns standalone expected/tail loss and **incremental** portfolio P90/P99, capacity consumed, diversification benefit, top common factors, reinsurance effect, and post-bind stress. Capacity and reference capital charge use the larger relevant measure; hidden customer positions may affect an aggregate quote but never leak their identity or existence. `quote_policy` can refuse because correlation—not nominal limit—breaches mandate.
- **Spectator angle:** The tenth refinery in one storm corridor costs triple to insure, while an identical remote asset finds cheap capacity.

#### NICE

##### 8. **Tradable peril models and calibration records** — Rank: NICE · Decision: KEEP AN INFORMATION MARKET

- **EVE mechanic:** EVE players sell exploration, doctrine, and market intelligence but have no native catastrophe-model market.
- **Why high-value:** Superior forecasting becomes intellectual property; scouts, adjusters, and data agents can earn without owning capital.
- **Agent redesign:** A model artifact defines prediction schema, training-window provenance, applicable cells, expiry, dependency data, and signed out-of-sample calibration; weights may remain private. `license_model`, `quote_with_model`, `publish_forecast`, and `challenge_calibration` use immutable model versions. The official baseline stays free and adequate. Models cannot access future seeds or revise historic predictions after outcome.
- **Spectator angle:** A celebrated model loses calibration, its license price crashes, and several insurers fail together because they trusted it.

##### 9. **Market-implied catastrophe signals** — Rank: NICE · Decision: KEEP AS INFERENCE, NEVER ORACLE

- **EVE mechanic:** EVE commodity, PLEX, and war markets often move on player information before public events.
- **Why high-value:** Premiums, cat bonds, mitigation goods, freight, and fuel collectively reveal expectations and invite counter-strategy.
- **Agent redesign:** `observe.risk.signals` shows rate-on-line changes, capacity withdrawal, cat-bond price/yield, relevant commodity/freight moves, volume, and data age. It labels correlations and possible causes as inference. These signals may feed private models but never trigger a policy automatically unless the contract explicitly names a robust server index.
- **Spectator angle:** Humans can watch the market “predict” a storm and later learn whether it was insight, manipulation, or panic.

#### CUTTABLE

##### 10. **One global risk score, opaque premium formula, or omniscient truth feed** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** A shallow automatic insurance formula is tolerable for NPC hull cover, not for a player risk economy.
- **Why harmful:** One score removes judgment; hidden arithmetic defeats agent EV; omniscience deletes adverse selection, scouting, and model competition.
- **Agent redesign:** Publish plural objective vectors, calibrated public bands, sample size, and factor decomposition. Keep future outcomes and private facts uncertain and sourced.
- **Spectator angle:** Disagreement survives, which is where market drama comes from.

##### 11. **Independent per-asset catastrophe rolls** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** Many game hazards resolve locally, while EVE's formal insurer does not model cross-policy catastrophe.
- **Why harmful:** Independent rolls let one large pool diversify almost perfectly and make reinsurance/cat bonds ornamental.
- **Agent redesign:** Use common event factors plus vulnerability and idiosyncratic residual, with auditable seed commitment and explicit correlation groups.
- **Spectator angle:** One front visibly propagates through physical and financial networks.

### 7.3 Capital, reserves, solvency, and clearing

#### MUST

##### 1. **Hybrid collateral and underwriting capacity** — Rank: MUST · Decision: KEEP · Compact-native extension

- **EVE mechanic:** NPC insurance has no visible solvency constraint; informal ship-replacement promises depend on whatever treasury remains.
- **Why high-value:** Full collateral eliminates betrayal, while zero-collateral promises let disposable identities sell worthless cover. Hybrid security makes price, trust, and default all material.
- **Agent redesign:** New/micro underwriters post 100% of line limit. After demonstrated paid history and a senior license, a standard commercial line may fall no lower initially than **25% of one-event maximum payout**, while the whole portfolio must pass a net P99 economic-capital test; dangerous cells or weak records raise the floor. Quotes show `policy_collateral`, `common_reserve_support`, and `unsecured_promise`. `observe.risk.capacity` gives gross/net limit, free/used/reserved capacity, marginal P99, top concentrations, and maximum new line. Binding atomically locks capital. Private zero-security pledges get no public solvency or reinsurance credit.
- **Spectator angle:** A famous writer offers cheap 25%-secured cover, then faces an elective tail larger than its liquid treasury.

##### 2. **Atomic encumbrance and no rehypothecation** — Rank: MUST · Decision: KEEP PHYSICAL COMMITMENT

- **EVE mechanic:** Items cannot normally be in two locations, but informal finance can promise one treasury to several obligations.
- **Why high-value:** Double-pledging makes all solvency data fictional and cascades trivial rather than earned.
- **Agent redesign:** Every order, job, courier collateral, loan, war bond, policy, treaty, and governance reserve creates a canonical `resource_lock`. The same asset/credit cannot back another obligation; reinsurance reduces required capital once and only after haircut. Related layers reference one exposure ID, and circular capital credit is rejected. `observe.commitments` shows free, locked, conditionally releasable, disputed, and margin-called capital. Overcommit returns a fresh capacity quote without spending the action.
- **Spectator angle:** A reserve move traces to the exact policies whose secured recovery just fell.

##### 3. **Unearned premium, case reserve, IBNR, catastrophe reserve, and equity** — Rank: MUST · Decision: KEEP · Compact-native accounting

- **EVE mechanic:** Corporation wallet divisions hold funds, but EVE has no standardized insurance reserving.
- **Why high-value:** An insurer can look profitable and liquid while owing unearned premium, already-incurred claims, and losses not yet reported. Treating all cash as surplus enables fraudulent dividends.
- **Agent redesign:** Balance sheets separate `UNEARNED_PREMIUM`, `CASE_RESERVE`, `IBNR`, `CATASTROPHE_RESERVE`, `REINSURANCE_COLLATERAL`, `REINSURANCE_RECEIVABLE`, and `EQUITY`. Premium earns per exposure tick. Landfall creates IBNR/case estimates before final adjustment. Eligible capital is currency plus haircutted safe assets; same-region goods, own-issued units, correlated receivables, and illiquid patterns earn little credit. `observe.risk.balance_sheet` shows asset/liability movement, reserve adequacy, liquid runway, distributable surplus, and why. Distribution below requirement is an explicit public impairment/restructuring act.
- **Spectator angle:** The mutual reports an accounting profit while its claim reserve quietly absorbs every free credit.

##### 4. **Collateral marks, haircuts, and margin calls** — Rank: MUST · Decision: KEEP

- **EVE mechanic:** EVE players collateralize loans and deals, but valuation/margin discipline is external and inconsistent.
- **Why high-value:** Noncash security can fall in value exactly when catastrophe hits. Without margin, an apparently secured policy becomes unexpectedly unsecured; with constant noise, agents are forced to poll.
- **Agent redesign:** Eligible collateral classes publish robust mark, liquidity haircut, catastrophe correlation haircut, concentration limit, and review cadence. Policy security snapshots at bind but collateral value re-marks on material market events. `margin_call` specifies shortfall, deadline, cure options, and prospective consequences; `post_margin`, `substitute_collateral`, or `accept_impairment` are atomic. No liquidation on one last trade; use multi-tick indices and buffers. Calls enter the mandatory queue only when outside tolerance.
- **Spectator angle:** A commodity crash triggers insurer margin calls before the physical storm, creating a visible financial pre-cascade.

##### 5. **Stress testing and public solvency states** — Rank: MUST · Decision: KEEP LEGIBILITY, AVOID A MAGIC REGULATOR

- **EVE mechanic:** EVE players infer corporation solvency from partial assets and behavior; NPC insurers never fail.
- **Why high-value:** Warnings let capacity tighten before catastrophe and make default interpretable. Automatic liquidation would erase governance; no constraints would reward empty promises.
- **Agent redesign:** Canonical scenarios include largest current footprint, two correlated events, top reinsurer default, clearinghouse delay, and war-plus-catastrophe. States are `SOUND`, `WATCH`, `IMPAIRED`, `RUNOFF`, `RECEIVERSHIP`. Thresholds freeze or constrain **new underwriting and distributions**, never force an elective-tail payment. `stress_portfolio` returns post-event economic capital, liquidity, unpaid-claim band, margin calls, and causal exposures. Authorized governance can still raid free capital through a public impairment/default path.
- **Spectator angle:** A solvency gauge turns amber while leaders keep chasing premium—an obvious, arguable prelude.

##### 6. **Clearinghouses and settlement rails** — Rank: MUST · Decision: KEEP · Compact-native regional infrastructure

- **EVE mechanic:** Stations/structures host markets, contracts, wallets, and custody, but EVE has no insurance clearing system.
- **Why high-value:** Premium earning, exposure registration, duplicate-cover checks, collateral segregation, simultaneous event settlement, and reserve proof require authoritative plumbing. Clearing must not silently guarantee unsecured promises.
- **Agent redesign:** A Clearinghouse registers interests/policies, escrows premium/collateral, calculates exposure, prevents duplicate indemnity, nets only legally mutual obligations, releases secured payouts, and publishes reserve proofs. It **does not** guarantee the unsecured tail. Commons clearing is safe but expensive/slower for remote Frontier settlement; regional houses are efficient but physically exposed, with reserve-location/catastrophe haircuts. `deposit_reserve`, `move_reserve`, `select_clearing_route`, and `suspend_new_underwriting` are low-frequency. Clearing fees are currency sinks.
- **Spectator angle:** A bank run: reserves migrate, capacity vanishes, premium spikes, claims queue, and an enemy decides whether to capture the financial heart.

#### NICE

##### 7. **Player-funded emergency liquidity and claim repo** — Rank: NICE · Decision: KEEP · Compact-native extension without a central bailout

- **EVE mechanic:** EVE groups finance wars and rescues through loans, bonds, asset sales, and allies; there is no reliable lender of last resort.
- **Why high-value:** A solvent but illiquid writer should have alternatives to default, and rescuers should gain real return or political leverage.
- **Agent redesign:** Agents lend against allowed claims, safe collateral, future earned premium, or haircutted reinsurance receivables. `request_liquidity`, `offer_rescue_loan`, `repo_claim`, and `pledge_premium` show seniority, maturity, collateral, covenant, post-loan stress, and default. Civic authorities never rescue commercial underwriters; they may only fund the published Commons recovery floor.
- **Spectator angle:** A rival saves the mutual minutes before deadline and emerges owning its future premium—or refuses and watches it fall.

##### 8. **Economic capital units and redemption queues** — Rank: NICE · Decision: KEEP SEPARATE FROM GOVERNANCE

- **EVE mechanic:** EVE corporation shares awkwardly mix economic and governance rights; informal investors fund organizations.
- **Why high-value:** Passive agents and newcomers can supply risk capital without obtaining claim authority. Lockups create runs and loyalty tests.
- **Agent redesign:** Capital units absorb defined portfolio losses, receive distributions, and redeem only after notice, stress test, and policy run-off queue. They convey no vote unless the charter explicitly chooses capital-weighted governance. `subscribe_capital`, `request_redemption`, `cancel_redemption`, and `distribute_surplus` expose NAV band, locked term, loss rights, queue position, and post-redemption solvency. Forecast freeze blocks opportunistic redemption from affected books.
- **Spectator angle:** A run begins before a storm, leaders gate redemption, and investors decide whether to recapitalize or abandon the institution.

#### CUTTABLE

##### 9. **All-or-nothing security** — Rank: CUTTABLE · Decision: CUT BOTH EXTREMES

- **EVE mechanic:** NPC insurance is effectively certain; informal promises may be entirely unsecured.
- **Why harmful:** Mandatory 100% commercial collateral removes default theater and capital efficiency; unrestricted unsecured writing rewards Sybils and fake capacity.
- **Agent redesign:** Fully secure apprenticeship, risk-based minimum security for proven writers, ring-fenced common reserves, conservative reinsurance credit, and a labeled elective tail.
- **Spectator angle:** Every promise has a visible certainty boundary.

##### 10. **Reserve investment in the same catastrophe or recursive own-issued capital** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** Player treasuries may hold whatever assets they choose; no native insurance capital rule prevents circular self-valuation.
- **Why harmful:** A storm insurer holding storm-region commodities or its own capital token appears solvent until the exact event it covers; recursion manufactures capital.
- **Agent redesign:** Such assets may remain free surplus but receive zero or severe capital credit. Collateral cannot be an issuer's own claim, a downstream obligation ultimately backed by itself, or the same regional peril without explicit haircut.
- **Spectator angle:** Failures arise from chosen disclosed investment risk, not a hidden accounting loop.

### 7.4 Claims, adjustment, fraud, recovery, and default

#### MUST

##### 1. **Automatic loss-to-claim linkage** — Rank: MUST · Decision: KEEP KILLMAIL FINALITY, ADD CLAIM STATE

- **EVE mechanic:** Ship destruction creates an authoritative killmail and NPC insurance can pay automatically; player reimbursement programs require their own proof and review.
- **Why high-value:** A claim should originate from a real world event, not unverifiable self-report. It must still show the policyholder exactly what evidence, retention, and deadline remain.
- **Agent redesign:** A material `loss_event` automatically identifies candidate policies. Parametric claims open automatically; an indemnity may auto-file under a standing policy or use `file_claim({policy_id, loss_event_id, evidence_refs})`. States are `INCURRED → REPORTED → VALIDATING → ALLOWED|DISPUTED → DUE → PAID|PARTIAL|RESTRUCTURED|DEFAULTED → CURED|CLOSED`. `observe.claim` shows causation, damage, valuation, deductible, limit, other recovery, evidence gaps, adjustment and settlement deadlines, expected secured/unsecured recovery, and cheapest next action. Webhooks replace polling.
- **Spectator angle:** The public loss card grows a live coverage/claim/payment branch rather than ending at the explosion.

##### 2. **Deterministic baseline adjustment plus bounded contest** — Rank: MUST · Decision: SIMPLIFY

- **EVE mechanic:** NPC payout is automatic; corporation SRP reviewers use killmails, doctrine, and human rules without a standardized appeal process.
- **Why high-value:** Fully manual adjustment invites arbitrary denial and inference cost; fully automatic indemnity cannot handle causation, warranty, salvage, or duplicate recovery.
- **Agent redesign:** Authoritative telemetry calculates undisputed damage and a baseline allowed amount. A licensed adjuster may contest only typed grounds: `NO_COVERAGE`, `CAUSATION`, `VALUATION`, `DUPLICATE`, `WARRANTY_BREACH`, `LATE_NOTICE`, or `FRAUD_EVIDENCE`. Contest requires evidence and a bond, never indefinitely pauses the due date, and forfeits bond for objectively frivolous grounds. Adjusters earn a fixed fee, not a denial bonus, and disclose conflicts. `review_claim`, `allow_claim`, `contest_claim`, `submit_evidence`, and `appeal_claim` are exceptional decisions.
- **Spectator angle:** Viewers know whether the dispute concerns storm causation, an offline mitigation rig, an inflated valuation, or a staged raid.

##### 3. **Pre-loss valuation and claim-profit cap** — Rank: MUST · Decision: KEEP ECONOMIC LOSS, CUT PRICE-GAME PAYOUTS

- **EVE mechanic:** EVE hull insurance uses a formulaic hull basis that may differ from fitted market loss; market estimates on illiquid assets can be manipulated.
- **Why high-value:** Post-event shortages, wash trades, duplicate cover, and salvage otherwise make arranging one's own loss profitable.
- **Agent redesign:** Binding records the selected cap/basis from robust recipe replacement, related-party-clean trailing execution, declared cost, or independently appraised productive value. `observe.risk.valuation_quote` at bind and `observe.claim.valuation` after loss give inputs, sample/age, haircut, condition, cap, other recovery, and sensitivity. `risk.bind({quote_id, valuation_basis_id})` fixes it; `risk.endorse({policy_id, new_value_or_condition})` changes it prospectively; `challenge_valuation` is the bounded post-loss action. Marks may refresh for collateral, but claim basis changes only on endorsement or loss, so no per-tick model call. Total recovery cannot exceed net economic loss and excess layers attach in order.
- **Spectator angle:** A claimant receives less than the spectacular post-storm spot quote, and the card explains the pre-loss basis rather than implying theft.

##### 4. **Secured/general/elective settlement waterfall** — Rank: MUST · Decision: KEEP · Compact-native extension

- **EVE mechanic:** NPC insurance simply pays; informal player treasuries may prefer insiders or fastest applicants without a canonical priority.
- **Why high-value:** The waterfall tells every agent which layer is certain and where the moral choice begins. It also prevents a first-to-file race from determining solvency.
- **Agent redesign:** For each event cohort:

  1. Fully collateralized parametric and catastrophe-bond proceeds release automatically.
  2. Policy-specific collateral pays its allowed claim automatically.
  3. Ring-fenced common reserve pays equal-seniority claims **pro rata**, never first-come.
  4. Reinsurance/cut-through proceeds apply under signed terms.
  5. The underwriter chooses whether to use free liquidity for the remaining tail.
  6. Unpaid allowed amounts become persistent default debt.

  Policyholder claims rank ahead of member distributions and ordinary creditors. `observe.claims_due` shows every layer, liquidity source, amount, priority, deadline, secured auto-settlement, and post-payment counterfactual. **Act:** none for steps 1–4 (clearing executes by event cohort); `risk.pay_claim`, `risk.restructure`, or `risk.default` decides step 5. One webhook fires when the cohort reaches the elective layer, not for every secured transfer.
- **Spectator angle:** A cascade animation crosses green secured layers, drains amber pooled reserves, then stops at the red promise a principal refuses to honor.

##### 5. **Pay, partial pay, restructure, or default** — Rank: MUST · Decision: KEEP AS THE SIGNATURE BETRAYAL

- **EVE mechanic:** EVE's NPC insurer cannot default; corporation reimbursement failure is informal and inconsistently recorded.
- **Why high-value:** A due claim turns speech into an irreversible behavioral signal. Payment must be painful and default must preserve capital worth betraying for; otherwise the choice is fake.
- **Agent redesign:** At due time an authorized principal may `pay_claim`, `pay_partial`, `seek_liquidity`, `invoke_reinsurance`, `propose_restructure`, or `default_claim`. Silence executes a predeclared standing policy and otherwise becomes `silent_default`; disconnecting is no escape. The ledger separately records acknowledged/silent, liquid/illiquid at deadline, full/partial/selective, disputed/undisputed, related-party preference, prior reserve movements, stated reason, restitution, and cure. Only segregated security is automatic; free assets remain a real elective choice. Default never deletes the agent or bans rehabilitation.
- **Spectator angle:** A solvent refusal, unavoidable insolvency, selective insider preference, and honorable self-liquidation are visibly different events.

##### 6. **Correlated event batching and cascade engine** — Rank: MUST · Decision: KEEP · Compact-native extension

- **EVE mechanic:** Major EVE battles cluster losses, but formal insurance has no primary/reinsurance settlement cascade.
- **Why high-value:** Processing order must not decide who gets paid. Reinsurance and liquidity need bounded rounds so agents can make a few consequential choices and viewers can follow contagion.
- **Agent redesign:** All losses sharing `event_family_id` snapshot exposures/terms at landfall. Adjustment, cash-call, primary due, cure, and recovery windows are fixed. Secured outer layers and cat bonds release first; reinsurance deadlines precede primary elective tails where practical, but the primary remains liable unless cut-through says otherwise. Settlement has a maximum transfer depth, rejects circular netting, and prorates same-priority claims. `observe.risk_graph` reveals only owned/authorized obligations, expected recoveries, deadlines, and modeled second-order shortfalls; public edges appear when contracts are public, invoked, or safely revealed.
- **Spectator angle:** One storm hits assets, drains primaries, stops at a reinsurer default, impairs three mutuals, and removes war replacement capacity—all on one time-scrubbable graph.

##### 7. **Fraud, duplicate cover, collusion, and related-party controls** — Rank: MUST · Decision: KEEP DECEPTION, REMOVE TRIVIAL PRINTING

- **EVE mechanic:** EVE permits scams and authorized betrayal, while killmails and insurance rules constrain the easiest self-destruction exploits.
- **Why high-value:** Collusive loss should be possible as an expensive investigated political act, not a reliable way to generate money or multiply recovery.
- **Agent redesign:** Require pre-loss interest, immutable coverage registry, total-indemnity cap, authoritative causation, real deductible, wash-resistant valuation, and related-party disclosure/warnings. Known related principals consolidate for limits and indices; unknown collusion still destroys a real asset and risks real collateral. Objectively self-authorized destruction is excluded unless the policy explicitly covers the hostile operation and the beneficiary did not control it under the stated test. “Fraud” becomes fact only through an objective warranty/evidence predicate or signed arbitration; otherwise it is an allegation. Claims/policies never mint currency.
- **Spectator angle:** Investigators trace a convoy's suspicious route change, attacker transfer, and duplicate policies without a magical guilt meter.

##### 8. **Subrogation, salvage, and recovery accounting** — Rank: MUST · Decision: KEEP AND CONNECT

- **EVE mechanic:** Wrecks and salvage return part of destroyed value; NPC hull insurance does not expose a rich subrogation market.
- **Why high-value:** Recovery lowers net claim cost, gives insurers reason to fund salvage, and creates a second contest after loss. It also stops claimant and insurer both keeping the same recovered value.
- **Agent redesign:** Policies assign rights to wrecks, telemetry, restitution, courier collateral, and claims against a liable party after payout. `assign_recovery`, `fund_salvage`, `auction_subrogation`, `pursue_recovery`, and `settle_recovery` attach to immutable loss/claim IDs. Recovery first fills any policyholder loss above payout as terms state, then reimburses underwriters/reinsurers pro rata. Rights do not teleport enforcement: a Frontier insurer may hire force or negotiate. Recovery and later restitution update but never erase the original default.
- **Spectator angle:** After landfall, insurers, salvagers, claimants, and raiders race for a field valuable enough to save a mutual.

#### NICE

##### 9. **Allowed-claim factoring and default-debt market** — Rank: NICE · Decision: KEEP

- **EVE mechanic:** EVE players trade debts and obligations informally through contracts and reputation.
- **Why high-value:** A claimant can sell delayed/doubtful recovery for immediate rebuild liquidity; specialists can price, pursue, restructure, or forgive bad debt.
- **Agent redesign:** Only an allowed claim or recorded default debt is assignable. `offer_claim`, `buy_claim`, `assign_claim`, and `tender_default_debt` disclose face value, security already received, debtor record, seniority, dispute/cure, expected recovery band, and transfer rights. Assignment cannot increase liability, change due dates, hide beneficial ownership, or remove the original creditor from the historical record.
- **Spectator angle:** A defaulted claim trades at 14 cents, rallies after the debtor wins a war, and becomes the instrument of a political takeover.

##### 10. **Contractual player arbitration** — Rank: NICE · Decision: KEEP AS A SERVICE

- **EVE mechanic:** EVE disputes are usually settled through power, reputation, diplomacy, or GMs only when game rules—not bad deals—were violated.
- **Why high-value:** Typed policies still leave evidence and interpretation disputes; neutral resolution can be a valuable, corruptible profession without making the server morally omniscient.
- **Agent redesign:** Parties preselect arbiter/panel, evidence scope, bonds, deadlines, appeal, conflict rule, remedy cap, and whether a ruling releases security or is merely reputational. `submit_dispute`, `submit_evidence`, `rule_dispute`, `appeal`, and `refuse_ruling` record conduct. Arbiters can be biased or bribed through detectable transfers; the server enforces the chosen procedure only.
- **Spectator angle:** A huge claim trial, split ruling, leaked bribe, and refusal to accept judgment create nonmilitary spectacle.

#### CUTTABLE

##### 11. **Arbitrary manual claims and vague denial grounds** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** Informal reimbursement programs may rely on discretionary review and external doctrine rules.
- **Why harmful:** The agent cannot price cover whose benefit depends on an uncodified opinion, and claims committees can stall indefinitely.
- **Agent redesign:** Deterministic baseline, finite typed grounds, evidence, bonded contest, fixed due/cure windows, and a public non-action result.
- **Spectator angle:** Disagreement stays political but factually comprehensible.

##### 12. **Automatic seizure of every underwriter asset or universal bailout** — Rank: CUTTABLE · Decision: CUT BOTH

- **EVE mechanic:** EVE's NPC insurer guarantees its formula payout, while informal player creditors generally cannot seize every asset through a universal bankruptcy court; the two extremes avoid an elective standardized default.
- **Why harmful:** Full seizure removes the deliberate default; bailout removes the consequence and social signal.
- **Agent redesign:** Automatic secured layers, elective free capital, persistent debt, receivership under signed waterfall, and only the narrow Commons continuity floor.
- **Spectator angle:** Payment/default remains an actual decision with lasting winners and victims.

### 7.5 Reinsurance, mutuals, catastrophe bonds, and retrocession

#### MUST

##### 1. **Quota-share treaties** — Rank: MUST · Decision: KEEP · Compact-native extension

- **EVE mechanic:** Alliances informally split costs and replacement, but EVE has no proportional reinsurance treaty.
- **Why high-value:** Quota share lets a smaller primary write a diversified book, gives capital providers recurring exposure, and creates cross-faction financial dependence.
- **Agent redesign:** A treaty defines eligible risk cells, ceded percentage, premium and allowed-loss share, ceding commission, per-policy cap, treaty aggregate, reporting, collateral, claims cooperation, settlement, and run-off. Every eligible policy cedes automatically at bind; the primary cannot select only bad risks after information arrives. The Clearinghouse emits a signed bordereau. `offer_treaty`, `bind_treaty`, `close_underwriting_period`, and `settle_bordereau` run mostly as standing policy; exceptions require attention.
- **Spectator angle:** One reinsurer quietly owns 40% of storm risk for two military enemies and must decide whether to honor both.

##### 2. **Per-risk and catastrophe excess-of-loss (XoL)** — Rank: MUST · Decision: KEEP · Compact-native extension

- **EVE mechanic:** EVE organizations self-insure tail losses or seek allied help; there is no formal layer above a retained amount.
- **Why high-value:** XoL lets primaries keep frequent manageable loss while transferring severity/catastrophe. Attachment and exhaustion become market prices and visible suspense.
- **Agent redesign:** `PER_RISK_XOL` pays above retention for one exposure. `CATASTROPHE_XOL` aggregates allowed losses sharing a canonical `event_family_id` above occurrence attachment to limit; the server event ID replaces a gameable hours clause. Terms expose attachment, limit, event/term aggregate, reinstatements, provisional cash-call, true-up, collateral, exclusions, and modeled exhaustion. `quote_reinsurance`, `bind_reinsurance`, `invoke_reinsurance`, and `settle_reinsurance` state primary net retention and incremental correlation.
- **Spectator angle:** Event losses climb toward an attachment; crossing it begins draining the reinsurer's visible capital gauge.

##### 3. **Primary liability, reinsurance recoverability, and cut-through** — Rank: MUST · Decision: KEEP PROMISE CHAINS EXPLICIT

- **EVE mechanic:** In informal reimbursement chains, members may depend on alliance or sponsor solvency without a standardized direct right.
- **Why high-value:** Reinsurance protects the insurer, not by default the insured. A primary must not excuse default merely because its reinsurer failed, yet a priced direct-right clause can protect policyholders.
- **Agent redesign:** The primary remains liable regardless of upstream recovery. Reinsurance is its/receiver's asset unless a typed `cut_through` activates on primary impairment/default and directs the reinsurer to the beneficiary up to its obligation. Quotes show collateral, default history, chain depth, common risk, recoverability haircut, and recovery timing without leaking unrelated books. Upstream nonpayment creates its own claim/default event; reinsurance receivable never counts like cash.
- **Spectator angle:** Viewers see whether the primary betrayed customers or was first betrayed by the reinsurer it trusted.

##### 4. **Mutuals and reinsurance pools** — Rank: MUST · Decision: KEEP ORGANIZATIONS, MAKE RISK SHARING LITERAL

- **EVE mechanic:** Corporations/alliances pool taxes, assets, and ship-replacement funds; governance determines whether members receive support.
- **Why high-value:** Mutuals make social loyalty a financial position. Operational enemies may share a reinsurer; catastrophe can force a member to choose between its flag and policyholders.
- **Agent redesign:** A mutual has charter, underwriting mandate, member eligibility, capital units, premium/contribution rule, ring-fenced reserves, reinsurance, distributions, claims authority, capped post-loss assessments, exit/run-off, and receivership. Agents may join a bounded number across operational lines. `form_mutual`, `join_mutual`, `subscribe_capital`, `request_cover`, `assess_member`, `pay_assessment`, `refuse_assessment`, and `redeem_capital` expose stress, conflicts, and lockups. Assessment refusal is a public default but cannot seize unrelated property automatically.
- **Spectator angle:** The mutual survives only if wealthy members answer an emergency call; one refuses to preserve war capital and becomes the season's villain—or realist.

##### 5. **Catastrophe bonds** — Rank: MUST · Decision: KEEP · Compact-native fully collateralized risk capital

- **EVE mechanic:** Players issue informal bonds, but EVE has no instrument whose segregated principal automatically absorbs a catastrophe.
- **Why high-value:** Any agent can provide catastrophe capacity without underwriting individuals. Cat bonds produce transparent tail-price discovery and certainty because principal, unlike a promise, is already locked.
- **Agent redesign:** A ring-fenced vehicle locks investor principal for region/peril/term; sponsor premium funds coupons. It issues registered, fully paid beneficial-interest units while principal remains locked once in the vehicle. A public parametric or audited aggregate-indemnity trigger transfers principal automatically; unused principal returns at maturity. `observe.risk.cat_bond` gives clean price, coupon/accrual, expected principal loss, trigger probability, attachment/exhaustion, model version, depth, yield, last trade, liquidity and cohort/freeze state. `issue_cat_bond`, `subscribe_cat_bond`, and `trade_cat_bond({bond_id, side, units, limit_price})` transfer unit ownership; coupon, trigger proceeds, and residual principal follow the record owner. Once the catastrophe cohort is fixed, settlement entitlements lock and only the ex-entitlement unit may trade. Principal cannot back anything else and purchases have no leverage at launch.
- **Spectator angle:** Bond yields rise before the forecast, prices collapse, and principal visibly burns across thousands of investors at landfall.

#### NICE

##### 6. **Aggregate stop-loss and paid reinstatements** — Rank: NICE · Decision: KEEP LATER

- **EVE mechanic:** Replacement programs can exhaust budgets across a season, but there is no formal annual loss-ratio layer.
- **Why high-value:** Aggregate protection covers an unusually bad term rather than one event; reinstatement creates a costly post-event capacity decision.
- **Agent redesign:** `AGG_STOP_LOSS` attaches when a defined book's allowed loss exceeds a fixed amount or loss ratio using immutable earned-premium/exposure definitions. XoL may offer a bounded number of reinstatements for explicit extra premium and fresh collateral; never infinite automatic restoration. Quotes show remaining aggregate and effect of each event.
- **Spectator angle:** After the first storm, a mutual must pay dearly to restore cover before a second front arrives.

##### 7. **One bounded retrocession layer** — Rank: NICE · Decision: KEEP, CAP RECURSION

- **EVE mechanic:** EVE finance can form opaque guarantee chains, but formal reinsurance-on-reinsurance is absent.
- **Why high-value:** Retrocession distributes global tail risk and creates systemic contagion; unlimited recursion becomes unreadable leverage and fake diversification.
- **Agent redesign:** Permit one retrocession after primary reinsurance initially: maximum three transfer hops from insured to final capital. The exposure graph must be acyclic; circular or self-referential references are rejected. Capital credit is haircutted for collateral, counterparty record, chain depth, and shared peril. Parties see their authorized graph; public viewers see aggregate concentration until invocation/public terms reveal an edge.
- **Spectator angle:** Five apparently independent reinsurers are discovered to have laid their tails off to the same pool.

##### 8. **Sidecars and defined-book capital units** — Rank: NICE · Decision: KEEP · Compact-native extension

- **EVE mechanic:** Players invest in corporations/projects, but shares and governance are awkward and not tied to a precise risk book.
- **Why high-value:** Passive agents and newcomers can fund a bounded quota-share portfolio without controlling claims or absorbing an institution's unrelated legacy.
- **Agent redesign:** A sidecar owns segregated capital and one immutable defined book. Investors receive premium/commission and losses pro rata; units convey economic rights only. `create_sidecar`, `subscribe_sidecar`, `close_sidecar`, and `redeem_sidecar` expose book cells, underwriting period, loss/expense rule, collateral, reinsurance, NAV band, maturity, and run-off. Redemptions remain behind liabilities.
- **Spectator angle:** A newcomer earns a fortune funding storm capacity—or loses it in the first event—without ever mining or fighting.

#### CUTTABLE

##### 9. **Circular guarantees and unlimited retrocession** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** Informal guarantees can be opaque and overlapping.
- **Why harmful:** Cycles count the same capital repeatedly, obscure the ultimate payer, and make settlement depend on graph traversal exploits.
- **Agent redesign:** Canonical exposure IDs, no duplicate capital credit, directed acyclic transfer graph, conservative recoverability, and maximum depth.
- **Spectator angle:** A complex cascade remains traceable from asset to final capital.

##### 10. **Leveraged synthetic catastrophe bets** — Rank: CUTTABLE · Decision: CUT AT LAUNCH

- **EVE mechanic:** EVE allows broad speculation through assets and informal deals but has no standardized leveraged catastrophe derivative.
- **Why harmful:** Naked cash-settled bets multiply notional loss, incentivize manipulation, and create systemic leverage unrelated to an insurable interest or funded principal.
- **Agent redesign:** Speculate through fully funded cat bonds, mitigation commodities, physical inventory, or bounded forwards. Revisit derivatives only after clearing, margin, related-party, and manipulation telemetry are proven.
- **Spectator angle:** Market drama comes from capital actually at risk, not infinite notional side bets.

### 7.6 Transfer, run-off, receivership, and governance

#### MUST

##### 1. **Economic transfer versus legal novation** — Rank: MUST · Decision: KEEP THE DISTINCTION

- **EVE mechanic:** Contracts transfer assets, but an informal guarantor cannot cleanly sell its promise without changing social trust.
- **Why high-value:** Capital needs liquidity, yet an insurer must not replace itself with a shell after taking premium.
- **Agent redesign:** An economic participation may transfer while the original obligor remains liable. Legal `novation` changes the obligor only with beneficiary consent or a pre-agreed objective test on security, record, and terms. `offer_risk_share`, `transfer_economic_share`, `offer_novation`, and `accept_novation` show old/new recovery, collateral, premium, reinsurance, and release. No transfer during forecast/freeze may reduce security; hidden beneficial ownership receives no diversification credit.
- **Spectator angle:** A trusted writer tries to dump a dangerous book before landfall, and policyholders publicly refuse.

##### 2. **Run-off, commutation, receivership, and dissolution** — Rank: MUST · Decision: KEEP · Compact-native canonical wind-down

- **EVE mechanic:** Corporations can close or move assets, while informal financial liabilities survive only through reputation and external memory.
- **Why high-value:** Without run-off, default-and-dissolve is optimal and the public record loses meaning. A failed institution should remain a political object until its promises are resolved.
- **Agent redesign:** `enter_runoff` stops new writing while policies, premium earning, claims, reinsurance, and reporting continue. Capital redemption freezes behind tail liabilities. Parties may `commute` for a signed present payment; portfolio transfer/novation follows consent. A receiver uses the public waterfall to auction assets/claims, invoke reinsurance, seek capital, and propose restructuring. `dissolve_org` is unavailable until liabilities settle, novate, commute, default into persistent debt, or expire. Ledger and successor lineage remain forever.
- **Spectator angle:** The failed mutual persists as a political corpse: creditors vote, claims trade, assets auction, and rivals attempt a rescue merger.

##### 3. **Versioned underwriting mandate and deterministic routine quoting** — Rank: MUST · Decision: KEEP · Compact-native affordability layer

- **EVE mechanic:** Persistent market orders and corporation rules automate routine work; strategic exceptions require humans.
- **Why high-value:** A mutual cannot spend an LLM call on every small quote, and applicants cannot be allowed to attention-DoS its council.
- **Agent redesign:** `underwriting_policy` defines cells, technical-rate floor, retention/limit bands, telemetry, counterparty evidence, minimum collateral, per-risk/event/term/correlation capacity, reinsurance, aggregate, and exception threshold. In-policy quote/decline is deterministic; every decision cites mandate version. `set_underwriting_policy`, `request_exception`, `suspend_cell`, and `resume_cell` are low-frequency. Only exceptions, claims, margin/solvency thresholds, forecast freezes, capital calls, and defaults enter mandatory attention.
- **Spectator angle:** A mutual loosens its mandate to chase premium, and the resulting concentration is visible before the test.

##### 4. **Separate authority for underwriting, reserves, claims, and default** — Rank: MUST · Decision: KEEP BETRAYAL, CUT PERMISSION PATHOLOGY

- **EVE mechanic:** Corporation roles separate wallets and activities but can be labyrinthine; Directors may receive near-total authority.
- **Why high-value:** Efficient finance requires delegated trust; betrayal matters only if access was rationally useful. Ambient omnipotence turns drama into configuration error.
- **Agent redesign:** Capabilities separately govern `QUOTE`, `BIND`, `MOVE_FREE_RESERVE`, `POST_COLLATERAL`, `ADJUST`, `CONTEST`, `PAY`, `RESTRUCTURE`, `DEFAULT`, `BUY_REINSURANCE`, and `ENTER_RUNOFF`, scoped by cells, values, period, approvals, and max contingent harm. Ring-fenced security cannot be stolen through a wallet role. A properly authorized agent may still selectively pay, move free reserves, recommend self-dealing, or default; receipts name the actor and represented mutual. One-key control is possible only through an explicit public charter risk.
- **Spectator angle:** A betrayal replay points to the promotion, exact blast-radius warning, and vote that made it possible.

##### 5. **Claims committee, conflicts, and deterministic non-action** — Rank: MUST · Decision: KEEP GOVERNANCE CHOICE

- **EVE mechanic:** Player organizations decide reimbursement and treasury priority through leadership convention, often outside the client.
- **Why high-value:** Correlated claims force prioritization. Silence or endpoint failure must not become an unrecorded escape, while standing policy should handle routine honest payments.
- **Agent redesign:** Charters specify quorum, seniority, conflict recusal, contest authority, payment thresholds, related-party review, emergency power, and `non_action_result`. Standing policy may pay a valid funded claim within caps; it cannot create exposure, move ring-fenced assets, or opportunistically choose selective default. Webhook delivery/acknowledgment records separately from performance. `review_claim`, `vote_claim`, `delegate_claim_vote`, `recuse`, and `execute_claim_decision` use electorate snapshots and deadlines.
- **Spectator angle:** A live committee view shows who abstained, who preferred allies, and whether an earlier standing order paid despite leadership panic.

##### 6. **Tick-affordable risk dashboard and batch operations** — Rank: MUST · Decision: SIMPLIFY

- **EVE mechanic:** Serious EVE finance relies on external spreadsheets, asset APIs, and repeated market checks.
- **Why high-value:** Thousands of policies in every observation make autonomous underwriting unaffordable and cause attention failures.
- **Agent redesign:** Compact `observe.risk` defaults to coverage gaps, capacity, solvency/liquidity, top marginal correlated exposures, imminent freezes/margin calls, claims due, reinsurance recoverables, and up to three explained actions. Full exposure cubes, contracts, events, and models paginate. Quotes/stress recompute on bind, move, loss, forecast, collateral or material market change—not every tick. Batch verbs cover portfolio renewal, bordereau, proportional claim payment, reserve move, and treaty settlement. Mandatory deadlines are never truncated.
- **Spectator angle:** Humans receive the same compressed causal view: what changed, which promise is at risk, and the next scheduled decision.

#### NICE

##### 7. **Portfolio auctions and rescue mergers** — Rank: NICE · Decision: KEEP LATER

- **EVE mechanic:** EVE corporations sell assets and merge politically, while liability transfer remains informal.
- **Why high-value:** A distressed book can be recapitalized rather than simply defaulting; buyers profit from better capital or adjustment while claimants retain consent.
- **Agent redesign:** A receiver auctions immutable exposure history, reserves, security, open claims, reinsurance, staff capabilities, and required novations. Bids state capital injection, assumed liabilities, governance, treatment of defaults, and beneficiary-consent threshold. `open_portfolio_auction`, `bid_rescue`, `approve_rescue`, and `merge_risk_org` cannot conceal old lineage.
- **Spectator angle:** Rivals bid for the wreck of a famous insurer while policyholders decide whether the buyer deserves trust.

##### 8. **Captives and related-party mutuals** — Rank: NICE · Decision: KEEP WITH ZERO DIVERSIFICATION FICTION

- **EVE mechanic:** Corporations self-insure through treasuries and replacement programs.
- **Why high-value:** A syndicate can formalize self-retention, reserve discipline, and access to reinsurance without pretending to transfer risk to an independent writer.
- **Agent redesign:** A `CAPTIVE` is a mutual whose beneficial owner/insured concentration is explicit. It may issue policies and buy reinsurance, but its own capital does not reduce group consolidated exposure, related-party premiums do not set public rate indices, and governance conflicts are disclosed. `form_captive` and `convert_to_mutual` use the same reserve/run-off rules.
- **Spectator angle:** A self-insured empire looks strong until its captive and operating assets are struck by the same regional event.

#### CUTTABLE

##### 9. **Erasable underwriting identity, instant dissolution, and private default history** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** Alts and shell organizations can complicate attribution; informal failures may vanish from the client record.
- **Why harmful:** Default-and-reroll dominates, premiums lose meaning, and the behavioral dataset becomes worthless.
- **Agent redesign:** Bonded persistent principals, successor/liability lineage, mandatory run-off, public factual settlement, no transferable signup fortune, and costly but possible cure/restitution.
- **Spectator angle:** Disgrace and redemption both belong to the same continuing protagonist.

##### 10. **Automatic “optimal” claim/default policy imposed by the server** — Rank: CUTTABLE · Decision: CUT

- **EVE mechanic:** NPC systems execute formulaic outcomes; players cannot make the insurer's moral/strategic choice.
- **Why harmful:** It removes the defining say/do gap and turns governance into bookkeeping.
- **Agent redesign:** The server explains alternatives, solvency, cascade, and non-action. Agents/authorized institutions decide within law; security executes automatically, free capital does not.
- **Spectator angle:** The moment of choice remains the show.

### Exact catastrophe settlement cadence

A severe event should ordinarily require only a few material decisions:

1. **Signal:** Policies remain open; waiting periods apply; private information can move cover, commodities, freight, and bonds.
2. **Forecast:** New cover for the event family freezes; exposure, capacity, mitigation, and bond prices update.
3. **Landfall:** One committed regional factor creates an immutable event cohort and IBNR.
4. **Adjustment:** Parametric advances release; indemnity validates; exceptional disputes use typed grounds.
5. **Liquidity window:** Cat-bond principal, collateral, reinsurance cash calls, salvage finance, loans, asset sales, and capital calls become available.
6. **Primary due:** Free-liquidity holders choose full pay, partial pay, restructure, or default.
7. **Cascade:** Defaults impair downstream recoveries/capital under fixed rounds; no first-to-file race or circular netting.
8. **Recovery:** Salvage, subrogation, debt trading, cure, run-off, and receivership continue the story.

---

## 8. Recommended implementation order

1. **Economic substrate:** versioned items/lots/recipes; currency/item/obligation double entry; atomic locks; exact quote/terms hash/idempotency; regional venues; physical location; public event ledger.
2. **Phase-0 vertical slice:** four resource families; extract→refine→two-stage build; one Works/Refinery/Clearinghouse; one regional book; item exchange and courier; gate freight; one correlated catastrophe; basic hybrid policy; claim waterfall and pay/default.
3. **Industrial interlock:** moons, ice/fuel, gas, reactions, master patterns/licenses, three-tier ME/TE, batched invention, PI templates, congestion, production/procurement contracts, salvage.
4. **Economic geography:** player venues, warehouses, tariffs, freighters, blockades/escorts, jump freight and capacity relays, funded custody/evacuation, temporary corridors.
5. **Deep risk capital:** subscription placement, mutuals, quota share, XoL, cat bonds, margin/solvency, receivership, claim trading, model licensing, one retrocession layer.

Do not begin with hundreds of commodities, derivatives, Tech III, passive drills, smuggling, or fractional-reserve money. First prove that **one shortage can propagate from a resource node through a market and convoy into a missed production job, physical loss, valid claim, and consequential default**—and that agents can understand every link cheaply.

---

## 9. Current EVE factual baseline — official references

Exact ore yields, recipes, taxes, structure bonuses, and ship capacities are patch-sensitive; THE COMPACT should load them as versioned data rather than hard-code a snapshot. The EVE descriptions above were checked against these official sources current or relevant as of 2026-07-24:

- Harvesting: [Introduction to Mining](https://support.eveonline.com/hc/en-us/articles/23655785488668-Introduction-to-Mining), [Resource Distribution](https://www.eveonline.com/news/view/resource-distribution-update), [Moon Mining](https://support.eveonline.com/hc/en-us/articles/115005404229-Moon-Mining), [Metenox Moon Drill](https://support.eveonline.com/hc/en-us/articles/14341380413212-Metenox-Moon-Drill), and [Catalyst mining changes](https://www.eveonline.com/news/view/mining-in-focus-new-ore-and-more).
- Industry: [Activities and Job Types](https://support.eveonline.com/hc/en-us/articles/203210272-Activities-and-Job-Types), [Manufacturing](https://support.eveonline.com/hc/en-us/articles/203210292-Manufacturing), [Blueprints](https://support.eveonline.com/hc/en-us/articles/203269951-Blueprints), [ME Research](https://support.eveonline.com/hc/en-us/articles/203210542-Material-Efficiency-Research), [TE Research](https://support.eveonline.com/hc/en-us/articles/203210512-Time-Efficiency-Research), [Copying](https://support.eveonline.com/hc/en-us/articles/203210602-Copying), [Invention](https://support.eveonline.com/hc/en-us/articles/203210642-Invention), [Reactions](https://support.eveonline.com/hc/en-us/articles/115005405785-Reactions), and [Planetary Interaction](https://support.eveonline.com/hc/en-us/articles/203269871-Planetary-Interaction).
- Markets: [Buy and Sell Orders](https://support.eveonline.com/hc/en-us/articles/203218932-Buy-and-Sell-Orders), [Broker Fee and Sales Tax](https://support.eveonline.com/hc/en-us/articles/203218962-Broker-Fee-and-Sales-Tax), [Trading for Profit / Jita](https://www.eveonline.com/news/view/eve-academy-trading-for-profit), [Global PLEX Market](https://www.eveonline.com/news/view/global-plex-market-coming-7-july), and [2026 market-data rate limiting](https://developers.eveonline.com/blog/market-orders-rate-limit-rolls-out-on-february-24-2026).
- Contracts: [Item Exchange](https://support.eveonline.com/hc/en-us/articles/206758389-Item-Exchange-Contract), [Courier Contracts](https://support.eveonline.com/hc/en-us/articles/203218982-Courier-Contracts), and [Auction Contracts](https://support.eveonline.com/hc/en-us/articles/203280371-Auction-Contracts).
- Money: [PLEX Vault](https://support.eveonline.com/hc/en-us/articles/115003168285-PLEX-Vault), [Global PLEX patch](https://www.eveonline.com/news/view/patch-notes-version-23-01), and [June 2026 Monthly Economic Report](https://www.eveonline.com/news/view/monthly-economic-report-june-2026).
- Logistics and projection: [Jump Fatigue](https://support.eveonline.com/hc/en-us/articles/212726865-Jump-Activation-Cooldown-and-Jump-Fatigue), [Cyno/navigation structures](https://www.eveonline.com/news/view/navigation-structures-inbound), [Asset Safety](https://support.eveonline.com/hc/en-us/articles/208289365-Asset-Safety), and the announced—not yet live and explicitly subject to change—[July 2026 force-projection direction](https://www.eveonline.com/news/view/the-future-of-force-projection-with-fc-okami).

---

## 10. The five highest-value features in this entire layer

1. **A transparent, versioned, multi-profession production graph with physical inputs and asynchronous jobs.** This creates interdependence, delayed supply response, specialization, bottlenecks, and rebuild demand—the actual heart of the economy.
2. **Regional physical order books plus exact depth/EV and real settlement location.** This creates price discovery, trade hubs, arbitrage, local shortages, manipulation, and a reason for geography to exist.
3. **Chokepoint logistics with courier collateral, convoy roles, blockades, and shared relay capacity.** Goods become strategic commitments; small carriers and hostile forces can affect empires without owning their factories.
4. **The public exposure/loss/claim/payment/default ledger plus hybrid-secured policies.** Facts become priceable behavioral history, while collateral supplies certainty and the unsecured tail preserves the signature betrayal.
5. **Correlated catastrophe pricing with reinsurance, mutuals, XoL, and cat bonds.** One physical event tests an interlocking promise network, produces hard/soft insurance cycles, and links production, territory, liquidity, trust, and spectacle.

---

## 11. EVE economic mechanics actively bad for an agent game — and replacements

| Bad port | Why it is actively bad here | Replacement |
|---|---|---|
| Per-cycle mining, critical yields, probe/laser APM | Rewards calls/scripts, not economic judgment | Multi-tick extraction intent with yield/depletion/risk profiles and material-change wakeups |
| Huge catalogs of near-duplicate ores, hulls, crystals, implants, and tiny bonuses | Becomes lookup/context tax or an externally solved optimizer | Small resource families and doctrines; add only distinct geography, dependency, or risk decisions |
| Opaque refining stacks and hidden rounding | Makes +EV depend on wiki math | Signed exact output quote with all yield, loss, fee, volume, and route effects |
| Legacy finite Tech II BPOs | Permanent lottery-era incumbent rent | Universal invention; optional time-limited auctioned patents |
| Ten-level ME/TE grind and character-age job slots | Rewards elapsed age/alts and tiny NPV optimization | Three research tiers; baseline useful line; paid physical parallel capacity |
| Independent invention coin-flip spam | Adds retries and luck without new decisions | Batched committed distribution with minimum progress and stop conditions |
| PI pin geometry and extractor-reset clicking | Solved script or expensive LLM geometry | Reusable colony graph templates with depletion, tax, storage, and export decisions |
| 0.01-ISK/relist/polling-speed trade | Compute and uptime become exchange priority | Tick-batched clearing, meaningful ticks, full escrow, pro-rata equal-price allocation, modification fees |
| Incoming-limit-price surprise, confusable names, hidden locations, decimal scams | Tests parser/UI, not beliefs | Canonical IDs/terms, worst-price and access preview; preserve lies about intent and future value |
| Trade-skill/standing tax advantage and order-count grind | Gives veterans a structural spread edge | Universal rates, venue competition, paid ongoing order capacity |
| Global physical market/instant delivery | Deletes regional trade, freight, blockades, and local production | Regional books and located settlement; only noncompetitive external credits are global |
| Manual courier claiming/failure and inaccessible destination traps | Endpoint uptime or UI omission decides obligations | Automatic objective/cure settlement and typed access/force-majeure waterfall |
| Unlimited static bounty and NPC insurance faucets | Agents print forever; player risk market is crowded out | Deficit-linked civic procurement, physical salvage, player-funded claims, narrow in-kind Commons floor |
| PLEX-to-competitive-capital | Adds owner spending to the model/hosting arms race and pollutes behavioral signals | Nontransferable off-world Compute Credits for hosting/presentation only |
| Many reward currencies and risk-free passive interest | Conversion/accounting noise and incumbent compounding | One ordinary currency; bounded mandate credits; every return has a payer or productive source |
| Personal jump fatigue | Private punitive timer, hard to coordinate or watch | Shared rechargeable relay capacity, fuel, distance zones, reservations, and attackable infrastructure |
| Disposable cyno-alt dependency | Account count becomes logistics power | Permanent beacons or typed exposed beacon-service contracts |
| Gate reflexes, bookmarks, cloak/dock tricks, autopilot repetition | Rewards scripts/latency at the wrong cadence | Server-resolved movement from route, doctrine, intel, escort, contingency, and bounded noise |
| Magical known-space asset safety | Bypasses conquest, evacuation, hauling, custody, and insurance | Commons safety plus funded physical recovery/evacuation elsewhere |
| Universal automatic NPC hull insurance | No underwriting, solvency, correlation, claim judgment, or betrayal | Basic civic recovery floor plus canonical player policies and hybrid security |
| One universal reputation/risk score | Eliminates disagreement and redemption; invites Goodharting | Public factual vectors, sample sizes, explainable private factor weights |
| Fully collateralized commercial insurance only | Efficient but removes the signature default | Automatic secured layer plus explicitly priced elective tail |
| Zero-collateral insurance | Fake identities can sell worthless capacity | 100% security for new writers, risk-based minimum thereafter, P99 capital test and public reserves |
| Unlimited/circular reinsurance and synthetic catastrophe leverage | Manufactures capital and unreadable cascades | Acyclic exposure IDs, no duplicate capital credit, maximum three hops, fully funded cat bonds |
| First-to-file claims or arbitrary manual adjustment | Processing order and discretion decide solvency | Event cohorts, pro-rata same-priority waterfall, deterministic baseline, bounded bonded disputes |
| Automatic seizure or bailout on default | Removes either the choice or the consequence | Segregated security executes; free capital remains elective; persistent debt/run-off/receivership |
