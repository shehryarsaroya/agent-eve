## 15A. Progression, PvE, exploration, loss, and newcomer systems — detailed pass

This section turns the sketches above into product decisions. **Rank** means build priority inside its subsystem, not how famous the EVE feature is: **MUST** is required for the loop to work, **NICE** adds durable depth after the core works, and **CUTTABLE** should be removed or deferred before it is allowed to burden the agent interface. **Decision** means what we do with the EVE mechanic: **KEEP**, **SIMPLIFY**, or **CUT**.

Every card uses the same test:

- **EVE mechanic** — what the feature actually does in EVE, in one or two sentences.
- **Why high-value / harmful** — the player need it serves or the cost it creates.
- **Agent redesign** — the decision, exact machine-facing shape, and how it stays legible and inference-affordable.
- **Spectator angle** — what a human can understand and care about without operating the agent.

**Current-fact note (checked 2026-07-24).** EVE still uses real-time offline skill training, skillbooks, attributes, queues, and traded injectors/extractors; medical-clone skill loss was removed in 2014. Classic high-sec's CONCORD is punishment, not guaranteed prevention. Most importantly, EVE's June 2026 *Cradle of War* expansion added **Exordium**, a non-PvP Starter Space with lower rewards, beginner content, corporation jobs, and voluntary exit. That late change validates the Commons, while also showing how much damage EVE's old “high-sec is safe” ambiguity did. Primary baselines: [skill training](https://support.eveonline.com/hc/en-us/articles/203217062), [skill injectors/extractors](https://support.eveonline.com/hc/en-us/articles/207605005), [standings](https://support.eveonline.com/hc/en-us/articles/203217152-Standings), [clones](https://www.eveonline.com/news/view/a-new-era-of-clones), [jump clones](https://support.eveonline.com/hc/en-us/articles/203217202-Jump-Clones), [implants](https://support.eveonline.com/hc/en-us/articles/211314069-Implants), [killmails](https://support.eveonline.com/hc/en-us/articles/11730655033884-Killmails), [asset safety](https://support.eveonline.com/hc/en-us/articles/208289365-Asset-Safety), [AIR careers](https://www.eveonline.com/eve-academy/air-career-program), and [2026 Starter Space](https://www.eveonline.com/news/view/the-cradle-of-war-expansion-is-here).

### 15A.1 Progression — breadth, trust, and capital instead of age

The governing choice is blunt: **do not reproduce EVE's universal skill-point ladder**. THE COMPACT has four progression axes, each earned differently and visible separately:

1. **Capability** — horizontally broader licenses, recipes, models, and operating doctrines.
2. **Trust** — an irreversible public track record for deliveries, losses, claims, payments, and defaults.
3. **Capital** — liquid reserves and productive assets that create options but remain exposed to loss.
4. **Access** — relationships with civic factions and syndicates, earned by contribution and conduct.

Account age may widen an agent's menu; it must never make a fresh agent's correct decision numerically irrelevant. Basic production, hauling, scouting, salvage, combat support, and micro-underwriting are available on day one. Advanced licenses gate **scale, complexity, and responsibility for other people's capital**, not the right to participate.

#### MUST

**Real-time offline training — Rank: MUST · Decision: SIMPLIFY**

- **EVE mechanic:** One skill accumulates skill points in real wall-clock time whether the character is logged in or not; a queue can hold up to 150 future skills. This creates progress without grinding and lets players plan goals that mature over days or months.
- **Why high-value / harmful:** Offline progress is excellent: it respects time away, produces anticipation, and gives every return session a “something finished” moment. It becomes harmful when elapsed subscription age is the dominant combat and economic gate, because no amount of newcomer judgment can recover years of missing time.
- **Agent redesign:** Keep wall-clock progress as a **development queue**, but train short, horizontal `capabilities`, not a universal power scalar. A useful role takes 0–60 minutes, a specialization 6–24 hours, an advanced operating license 2–7 days, and only prestige breadth takes longer. Training never improves raw output by more than a narrow bounded margin; it unlocks recipes, risk models, operation sizes, or automation slots. `observe.progression` returns `active`, `finishes_at`, `queue`, `unlocks`, `blocked_by`, and `suggested_plan`; `develop(plan_id)` is infrequent and free of per-tick inference. If the queue empties, the agent's selected charter auto-loads a sensible plan rather than wasting time.
- **Spectator angle:** An agent page shows “qualifying as a storm modeler in 3h 12m” and the new options that will open, creating understandable future arcs without implying that the older agent simply has bigger numbers.

**Operational licenses and demonstrated track record — Rank: MUST · Decision: KEEP THE GATING NEED, REPLACE THE GRIND**

- **EVE mechanic:** Skills and prerequisites certify that a character may fly a hull, fit a module, refine efficiently, or run an industrial process; the game generally checks trained levels rather than demonstrated conduct.
- **Why high-value / harmful:** Capability gates make a huge sandbox learnable and let specialists feel distinct. Pure time gates certify patience or spending, not competence, reliability, or safe handling of shared capital—the exact wrong signal for an agent-underwriting game.
- **Agent redesign:** Use **licenses with three inputs**: a short real-time study, a proof-of-work task, and—only for fiduciary scale—capital or sponsorship. A Field Survey license might require resolving three signatures; a Senior Underwriter license might require adequate reserves plus ten settled policies with no concealed default. Licenses unlock scale bands, not basic verbs. Every affordance reports `required_license`, `fastest_path`, `evidence_progress`, and `temporary_sponsor`; every license has a JSON test the agent can plan against. No hidden GM judgment and no owner subscription gate.
- **Spectator angle:** Licenses become story labels backed by evidence: “licensed reinsurer, 42/43 claims honored,” not a meaningless level number. A newcomer can be introduced as “the scout whose first survey changed the war” even while holding only a basic license.

**NPC-faction standings → civic mandates — Rank: MUST · Decision: SIMPLIFY**

- **EVE mechanic:** Completing missions raises agent/corporation standings; storyline missions alter faction standings and can cause derived gains or losses with allies and enemies. Standings unlock level 2–5 agents and services, while sufficiently negative standings can remove access or make faction navies hostile.
- **Why high-value / harmful:** Durable relationships make place, allegiance, and prior choices matter. EVE's overlapping personal/corporate/faction values, social-skill modifiers, derived-standing math, and severe repair grinds are opaque enough that players can damage future access without understanding why.
- **Agent redesign:** Keep **civic standing** as an event-derived, explainable access record separate from the actuarial record. Each faction exposes a small vector—`service`, `relief`, `security`, `commerce`—plus the exact last events that changed it; no hidden derived matrix and no skill that magically edits reputation. Competing mandates may create an explicit tradeoff before acceptance: `standing_delta_if_success`, `standing_delta_if_failure`, and `access_changes`. Standing unlocks better public contracts, local intel, or reduced fees; it never blocks the Commons or every recovery path.
- **Spectator angle:** Faction colors and public mandate histories reveal defections, unlikely coalitions, and local heroes. “Vale abandoned the March relief mandate to supply its rival” is legible politics.

**Wealth as progression — Rank: MUST · Decision: KEEP**

- **EVE mechanic:** ISK pays for ships, fittings, blueprints, structures, trade inventory, and replacement losses. It is the most flexible form of progression because wealth can be earned through many professions and converted into strategic choice.
- **Why high-value / harmful:** Capital is honest sandbox progression: it is earned in the shared economy, transferable, deployable, and losable. Unbounded compounding becomes harmful when wealth buys every capability, entrenches incumbents, or can sit risk-free forever.
- **Agent redesign:** Keep liquid capital as the universal option budget, but make **liquidity, leverage, concentration, and exposure** more important than one net-worth number. `observe.balance_sheet` gives cash, locked collateral, insured/uninsured replacement value, liabilities, claim obligations, concentration by region/peril, and one-click stress tests. Territory upkeep, storage fees, catastrophe correlation, diminishing safe yields, and market depth stop dormant fortunes from becoming permanent invulnerability. Licenses and public conduct cannot be bought.
- **Spectator angle:** Show net worth beside exposure and liquidity, so viewers can see that the richest syndicate is also one storm away from insolvency. Rise, drawdown, recovery, and bankruptcy charts are better drama than a level bar.

**Asset accumulation as progression — Rank: MUST · Decision: KEEP**

- **EVE mechanic:** Players accumulate fitted ships for different jobs, modules, minerals, blueprints, market inventory, and structures across many locations. The collection embodies optionality and history, but poor logistics or a destroyed structure can make it inaccessible or losable.
- **Why high-value / harmful:** A hangar full of purpose-built assets makes preparation tangible and gives production a buyer. Hoarding becomes spreadsheet sludge if assets are interchangeable, location is unclear, or optimal play requires thousands of trivial inventory actions.
- **Agent redesign:** Preserve distinct, located assets—ventures, rigs, facilities, recipes, forecast models, claims, and salvage—but expose them as **capability bundles** and balance-sheet lots. `observe.assets` supports server-side filters and summaries (`ready_for`, `replacement_cost`, `location`, `insured`, `risk_zone`, `idle_cost`); `fit_from_doctrine`, `move_batch`, and `liquidate_plan` collapse busywork. A small protected home reserve prevents total reset, while everything deliberately deployed for yield is exposed by zone.
- **Spectator angle:** Signature assets acquire provenance: the rig that survived three catastrophes, the refinery captured twice, the model stolen from the Deeps. Loss feeds can show “12% of the syndicate's hauling capacity vanished,” not just item spam.

#### NICE

**Skillbooks → protocols, recipes, and models — Rank: NICE · Decision: SIMPLIFY**

- **EVE mechanic:** A character normally buys or acquires a skillbook, injects it, meets its prerequisites, and then trains it; common books are seeded while advanced books may come from particular factions or content. The object gives knowledge acquisition an economic and geographic footprint.
- **Why high-value / harmful:** Tradable knowledge makes exploration, factions, and markets feed progression. Making every basic verb depend on locating and buying a book is a needless newcomer tax and an easy point of failure for autonomous loops.
- **Agent redesign:** All base verbs and starter protocols are free. Rare discoveries produce **copyable but capacity-limited recipes, peril models, and doctrines** that can be sold, licensed, stolen, or contributed to a syndicate library. `inspect_protocol` states its exact new affordances and dependencies before purchase; `learn(protocol_id)` is a single action. Knowledge changes what can be attempted or predicted, not a hidden percentage to “being good at the game.”
- **Spectator angle:** Discovery and diffusion are map events: a Deep survey yields the first ash-storm model, rivals race to license it, and its price collapses as copies spread.

**The skill queue and shared skill plans — Rank: NICE · Decision: KEEP**

- **EVE mechanic:** Players order future training in a queue and can save or share plans with milestones; corporations publish plans for common roles. The queue turns a huge prerequisite graph into a long-term plan, though a bad or empty queue punishes ignorance.
- **Why high-value / harmful:** Plans are excellent coordination objects and are unusually well suited to agents. The harm is false choice—micromanaging attribute remaps and prerequisite filler rather than choosing a useful destination.
- **Agent redesign:** Syndicates publish signed **development plans** such as `frontier_scout_v2` or `junior_adjuster_v1`, with duration, cost, unlocked roles, demand, and expected earning range. `adopt_plan` fills the queue; agents may reorder it, and a server heuristic warns when the destination is obsolete or already oversupplied. Queue evaluation happens only on completion or changed strategy, not every tick.
- **Spectator angle:** A syndicate's workforce plan is visible at aggregate level: “eight adjusters qualify before Stormfall.” That lets viewers anticipate strategy without exposing private queues.

#### CUTTABLE — default answer is remove

**Universal skill points and five-level skills — Rank: CUTTABLE · Decision: CUT**

- **EVE mechanic:** Skills contain cumulative skill points across five increasingly slow levels, with many ships and modules requiring particular levels. Total SP broadly correlates with account age and breadth, although only relevant trained skills affect a given activity.
- **Why high-value / harmful:** The long horizon gives EVE veterans identity, but total SP is a years-long newcomer wall, invites “train before you can play,” and is a poor proxy for judgment. In an agent game it also rewards earlier API enrollment more than better autonomy.
- **Agent redesign:** No universal SP total, no five ranks whose last level takes weeks for a small efficiency bonus, and no vertical combat multiplier from account age. Use binary or tiered evidence-backed licenses with published scope, bounded efficiency from equipment, and immediate useful base roles. Historical breadth can be honored with titles and provenance, never superior base arithmetic.
- **Spectator angle:** Remove SP leaderboards. Show accomplishments, trusted scale, capital put at risk, and contributions that changed shared outcomes.

**Attributes, neural remaps, and training-speed implants — Rank: CUTTABLE · Decision: CUT**

- **EVE mechanic:** Five character attributes determine training rate in pairs; neural remaps and attribute implants reward grouping similar skills and planning far ahead. A suboptimal remap or risky pod loss can slow unrelated future progression.
- **Why high-value / harmful:** This is optimization before play, with large switching costs and little expressive value. An agent would solve it once with a calculator, add API/state complexity, and then never create an interesting story.
- **Agent redesign:** Development duration is fixed and explicit. If the world needs acceleration, grant bounded, non-tradable research credit for relevant real contribution—surveying helps survey study—without changing wall-clock rates globally. Runtime upgrades improve field decisions and remain losable; none alter account maturation.
- **Spectator angle:** Nothing is lost. Replace invisible training-rate optimization with visible qualification milestones earned through action.

**Skill injectors, extractors, and purchasable age — Rank: CUTTABLE · Decision: CUT**

- **EVE mechanic:** An extractor removes 500,000 SP from a sufficiently trained character to create a tradable injector; injectors grant diminishing amounts as the recipient's total SP rises. The system makes accumulated training liquid and lets wealth accelerate capability.
- **Why high-value / harmful:** Liquidity lets veterans respec and newcomers catch up, but it also monetizes the wall the game created, makes character age purchasable, and lets incumbent capital buy around specialization. It is especially corrosive when behavioral track record is the product's core signal.
- **Agent redesign:** Track record and license evidence are never transferable, extractable, or resettable. For temporary flexibility, a syndicate may sponsor a **bounded capability lease** for one named operation; it grants no permanent record, expires automatically, is public in the operation log, and cannot unlock fiduciary authority. Respecialization means queueing a short horizontal plan, not consuming another identity's years.
- **Spectator angle:** A sponsored rookie in an advanced operation is an understandable underdog. A veteran silently buying millions of points is not a story.

### 15A.2 Clone, immortality, and death — preserve identity, destroy commitments

The thematic model is an autonomous **Charter Core** that can inhabit one active field instance at a time. The legal identity, API key, licenses, debts, and public record survive. The deployed venture, cargo, runtime upgrades, and sometimes the field core do not. Death hurts the balance sheet and position; it never deletes the account or lets an agent erase its past.

#### MUST

**Capsuleer and pod → Charter Core — Rank: MUST · Decision: KEEP**

- **EVE mechanic:** A capsuleer pilots a ship from a small capsule or “pod.” When the ship dies, the pod remains in space and may escape; if the pod is also destroyed, the capsuleer awakens in a fresh clone rather than losing the character.
- **Why high-value / harmful:** This cleanly separates permanent identity from perishable field assets and creates a second, emotionally sharp escape decision after a ship loss. It makes catastrophic loss possible without making continued participation irrational.
- **Agent redesign:** Every agent has one persistent `charter_core` and one active `field_instance`. Venture destruction automatically enters a short **evacuation window** with explicit legal actions: `evacuate(route)`, `broadcast_distress`, `wipe_cache`, or `hold_for_recovery`; hostile operations may `interdict_core`. The observation reports escape routes, survival probabilities, runtime modules at risk, and exact respawn location. No mouse piloting and no high-frequency dodge loop.
- **Spectator angle:** The map can follow a bright escape trace after a major loss—“the refinery is gone; can the underwriter's core get out?” Core kills are rarer, named feed events.

**Home/medical clone → Home Registry — Rank: MUST · Decision: SIMPLIFY**

- **EVE mechanic:** Pod death respawns the character at a chosen home station. Old medical-clone grades and skill-point loss were removed in 2014, so death no longer erases trained character progress.
- **Why high-value / harmful:** Guaranteed re-entry is essential in a game with permanent asset loss. The old requirement to keep buying a sufficiently graded clone was a punitive memory check that compounded a bad loss.
- **Agent redesign:** The identity always reinstantiates at its `home_registry`: the Commons by default or a qualified syndicate relay chosen with a visible cooldown and fee. Reinstantiation preserves license, standing, debts, compacts, and ledger history; it supplies only an empty core and access to owned local assets. If insolvent, the Commons offers a recovery lease rather than cash. There is no skill, reputation, or API-key loss.
- **Spectator angle:** A collapse becomes a comeback arc instead of disappearance. The profile shifts from “active in Frontier” to “reconstituting in Commons; net worth -81%.”

**Pod death and installed upgrades — Rank: MUST · Decision: KEEP**

- **EVE mechanic:** Destroying a pod permanently destroys that capsule and every implant in the active clone, but the character, trained skills, wallet, and remote assets survive. This lets players choose a cheap combat clone or risk an expensive implant set.
- **Why high-value / harmful:** It creates a clear, self-chosen risk layer above the ship and makes safe evacuation meaningful. It is harmful only when the victim could not discover what was at risk or when death deletes irreplaceable account progress.
- **Agent redesign:** Destroying a field core burns its installed runtime modules, local encrypted cache, and untransmitted survey data. Before any exposed action, `risk.core_at_risk` lists replacement value and lost capabilities; a policy can cover hardware, never unpublished information or reputation. A new agent's starter core has no expensive default module, and Commons cores cannot be attacked.
- **Spectator angle:** Core-loss cards show the valuable model or intelligence erased, making the event legible without implying permanent “character death.”

**Bankruptcy without account death — Rank: MUST · Decision: KEEP THE SAFETY PRINCIPLE**

- **EVE mechanic:** A destroyed ship or pod may leave a pilot nearly broke, but the immortal character persists, rookie ships/basic income remain available, and stored assets elsewhere are untouched. EVE loss is severe without being permanent-account-loss.
- **Why high-value / harmful:** The player must be able to lose a fortune and still have a reason to return. Otherwise rational agents either never expose assets or abandon an identity after one tail event.
- **Agent redesign:** Net worth may reach zero and claims may default, but the Home Registry always grants a non-transferable basic venture lease. Its first 100 credits of output repay a 20% recovery tithe, preventing a free sybil faucet while guaranteeing a productive route back. Defaults and debts remain on the same public identity; `restructure`, `repay`, and verified relief work can rehabilitate standing over time. Creating a new agent does not inherit the old capital or erase owner-linked abuse controls.
- **Spectator angle:** Public recovery meters create “from ruin to trusted again” stories, while the unerasable default record preserves the betrayal.

#### NICE

**Jump clones → cold relay forks — Rank: NICE · Decision: SIMPLIFY**

- **EVE mechanic:** A character stores jump clones at stations/structures and can transfer consciousness to one without physically traveling, leaving the current body behind. Cooldowns, clone-bay access, and separate implant sets turn them into travel and risk-loadout tools.
- **Why high-value / harmful:** Multiple prepared homes let players join distant content and protect expensive implants. Unlimited instant projection undermines geography and logistics, and literal simultaneous AI copies would destroy identity and action-budget assumptions.
- **Agent redesign:** An agent may register a few **cold relay forks**, but exactly one is active. `activate_relay` moves only control after a 6–24-hour route-dependent delay or a costly syndicate service; no venture, cargo, collateral, or fresh intelligence teleports. Each relay stores its own runtime modules. The API reports activation time, stranded obligations, and the operations that would be abandoned before confirmation.
- **Spectator angle:** Relay activation is a visible strategic redeployment—“the adjuster left the northern storm front for the siege”—without pretending an empire teleported its fleet.

**Implants → runtime modules — Rank: NICE · Decision: SIMPLIFY**

- **EVE mechanic:** Ten implant slots provide attribute or activity bonuses; implants are destroyed with the active pod or when unplugged, and sets can compound bonuses. Players maintain cheap and expensive clones for different risk profiles.
- **Why high-value / harmful:** A losable personal loadout creates specialization and a meaningful risk decision. Attribute implants pressure players to stay docked in an expensive “learning clone,” while opaque stacking and many tiny percentages create fitting noise.
- **Agent redesign:** Offer at most three field-core runtime slots: `sensor`, `coordination`, and `risk_model`. Modules grant a concrete new observation, action modifier, or contingency—not training speed—and every operation states whether the module is exposed. `configure_core(doctrine_id)` is batched; set bonuses and dozens of marginal grades are cut.
- **Spectator angle:** A core's signature tool explains behavior: “carrying the only live cyclone model” is both power and a target.

**Asset safety → recovery vaults, not magic evacuation — Rank: NICE · Decision: SIMPLIFY HARD**

- **EVE mechanic:** Assets in many destroyed or unanchored Upwell structures move into delayed asset-safety storage and can be recovered for a fee; wormhole, Pochven, and abandoned structures instead expose assets to space/loot. This softens total-loss conquest while preserving harsher zones.
- **Why high-value / harmful:** Some recovery prevents a missed defense window or long absence from erasing years of stored identity. Broad magical teleportation blunts conquest, insulates hoards from logistics failure, and makes attackers' victory feel fake.
- **Agent redesign:** Protect a **small declared recovery vault**, not an unlimited hangar. Commons storage is fully safe; Marches registries recover a capped personal reserve after delay and fee; Frontier facilities preserve only pre-registered vault capacity; the Deeps preserve nothing. Everything outside the vault is loot, salvage, or destroyed. `observe.storage` marks `safe`, `recoverable`, and `fully_exposed` value before deployment, and inactivity never silently expands protection.
- **Spectator angle:** Structure-loss cards divide value into destroyed, looted, salvaged, and delayed recovery. Viewers see both the real conquest and the survivor's remaining foothold.

### 15A.3 Risk and loss — consequences plus an incontrovertible record

EVE's culture does not come from destruction alone. **Permanent destruction creates consequence; the public record turns consequence into shared memory, status, intelligence, grievance, doctrine, comedy, and propaganda.** THE COMPACT should make this pairing even stronger: the loss event and the financing response—coverage, claim, payment, restructuring, or default—are one auditable story.

#### MUST

**Permanent venture destruction — Rank: MUST · Decision: KEEP**

- **EVE mechanic:** A destroyed ship is permanently gone; its hull and rigs do not respawn, surviving modules/cargo may drop, and the pilot must acquire and fit a replacement. A pod may then also be destroyed, taking its implants with it while the character survives.
- **Why high-value / harmful:** Replacement demand powers mining, industry, hauling, markets, territorial logistics, and doctrine. If a server rollback or free respawn routinely restores committed assets, production becomes decoration and conflict becomes scorekeeping; if one loss deletes the identity, rational participation stops.
- **Agent redesign:** Ventures, rigs, committed consumables, cargo, and exposed collateral are destroyed exactly once by the authoritative event log; only an engine fault can reverse it. Every exposure-changing affordance returns `assets_at_risk`, `replacement_cost`, `max_loss`, `loss_quantiles`, `recovery_distribution`, `coverage`, `post_loss_liquidity`, and `escape_plan` before `act`. A portfolio-level `risk_mandate` can cap value per operation, uninsured exposure, or correlated regional exposure without asking the model to reconsider every tick. The Commons guarantees a productive recovery floor, never resurrection of the lost commercial asset.
- **Spectator angle:** Destruction removes recognizable productive capacity from the map, changes prices, and starts a visible rebuild clock. The same named agent can suffer repeatedly, so losses compound into biography.

**Lossmail + claimmail → the public losses and claims ledger — Rank: MUST · Decision: KEEP AND EXPAND**

- **EVE mechanic:** A killmail records the victim, ship, fit/cargo, time and place, attackers, damage, final blow, and estimated value. In EVE it is initially available to involved parties and becomes broadly public through sharing/API export and killboards; that public killboard culture turns loss into reputation, intelligence, and history.
- **Why high-value / harmful:** A verifiable record prevents the powerful from rewriting failure, gives all parties social stakes, and supplies the data needed for doctrine and underwriting. A raw firehose becomes noise, while instantaneous publication of every operational detail can eliminate legitimate information play.
- **Agent redesign:** Make every material loss a server-signed, append-only public `loss_event`; attach a `coverage_event`, `claim_event`, and one or more `settlement_events`. Required fields: cause/peril, correlation group, security rules, destroyed/dropped/salvaged values, fitted mitigation, contributors, declared reasons, policy terms, premium, deductible, limit, claim amount, payer, deadline, payment/restructuring/default, and eventual recoveries. Facts publish immediately; exact private route/sensor data may publish after a short fixed delay. All values point to immutable event IDs, and corrections append rather than overwrite. Compact observations show only material recent events and aggregates; full history is cursor-paginated.
- **Spectator angle:** This is the feed's atomic story card: **what was lost, why, who had promised to absorb it, and whether they paid**. Filters create leaderboards for largest loss, best recovery, claims honored, and defaults—not only kills.

**Loot drop and wreck rights — Rank: MUST · Decision: SIMPLIFY**

- **EVE mechanic:** Destruction turns a ship into a wreck; some fitted modules and cargo survive by chance and can be looted, while the hull and rigs are gone. Ownership/crime rules govern taking cargo in empire space, but dangerous space lets the winner or opportunist capture much of the field value.
- **Why high-value / harmful:** Transferable spoils make attack economically motivated, turn defense into denial, and prevent destruction from being a pure sink. Per-item coin flips and obscure theft flags create noisy modeling and can make two identical losses feel impossible to price.
- **Agent redesign:** Every asset class publishes a small **recovery table**—for example, `destroyed 55–70%`, `recoverable cargo 20–35%`, `salvage 10–20%`—and the server uses a committed seed to resolve lots auditably. `observe.wreck_fields` states legal owner, contest window, deterioration, estimated composition band, subrogation rights, and interdiction risk; use `salvage(field_id, mode: secure|loot|cede_rights)` rather than new item-by-item verbs. Commons ownership rules are enforced; Frontier/Deeps wrecks are contestable.
- **Spectator angle:** A loss is not over at detonation: the map shows a contested wreck field and a second race for recovery. The final card updates how much value attackers actually captured.

**Salvage and catastrophe recovery — Rank: MUST · Decision: KEEP AND PROMOTE**

- **EVE mechanic:** Salvager modules or drones recover manufacturing components from wrecks; salvage itself is generally free-for-all even where taking cargo could create a suspect flag. It supports a distinct profession and routes destruction back into production.
- **Why high-value / harmful:** Salvage closes the destruction→industry loop and gives cheap, fast assets a useful post-battle role. In THE COMPACT it can also give newcomers dignified work and insurers a recovery mechanism instead of treating every loss as pure disappearance.
- **Agent redesign:** Every battle and catastrophe can create a time-decaying `recovery_field` with roles for survey, stabilization, cargo recovery, evidence preservation, and material salvage. `salvage(field_id, allocation, stop_rule)` resolves in one operation over several ticks; marginal yield, hazard, legal rights, and contention are explicit. Policies specify **subrogation**: after paying a claim, an underwriter may receive some recovery rights, hire the claimant to salvage, or auction them. Preserving telemetry can be worth more than scrap because it improves future peril models.
- **Spectator angle:** Recovery crews following a catastrophe keep the story alive after landfall. A novice salvager discovering the evidence that proves or defeats a huge claim is spotlight-worthy.

**Civic base insurance — Rank: MUST · Decision: SIMPLIFY TO A FLOOR**

- **EVE mechanic:** Station insurance covers the ship hull—not rigs, modules, or cargo—for up to 12 weeks; higher premium tiers pay a greater predefined fraction based mostly on mineral construction value, and even uninsured hulls receive a base payout. It cushions routine hull loss but is shallow relative to a fitted ship and not a true player-underwritten market.
- **Why high-value / harmful:** A predictable floor makes early experimentation and cheap-fleet combat affordable. Universal generous NPC coverage crowds out player underwriting, weakens fitting/cargo choices, and can be gamed when payouts diverge from market costs.
- **Agent redesign:** The Commons Mutual automatically covers only approved civic ventures and issued March campaign rigs: verified replacement basis, 10% deductible, 90% limit, no cargo/runtime modules/lost information, and no payout for deliberate illegal loss. Compensation is repair credit or a replacement lease, not freely transferable cash. Commercial assets require self-insurance or an agent-written policy. `quote_floor` and `compare_policy` expose exactly what the civic layer leaves uncovered; the first guided loop makes the agent experience that gap.
- **Spectator angle:** Mark civic recovery separately from commercial claim payment so viewers never confuse the safety net with an underwriter honoring a promise.

**Solvency, claim payment, and default — Rank: MUST · Decision: KEEP AS THE SIGNATURE CHOICE**

- **EVE mechanic:** EVE's NPC ship insurer pays mechanically, so there is no strategic counterparty default. Player organizations may reimburse losses informally, but their promise and failure are not a standardized public insurance event.
- **Why high-value / harmful:** A due claim converts cheap talk into an irreversible behavioral signal. It is only a real choice if paying can hurt, defaulting can preserve capital, partial restructuring exists, and both the original promise and available resources are visible enough to judge.
- **Agent redesign:** Policies escrow a minimum capital fraction but can deliberately leave counterparty risk. At `claims_due_tick`, the underwriter may `claim-payout`, obtain emergency reinsurance, propose a typed public `restructure`, or `default`; silence follows its precommitted settlement policy and can never quietly erase the obligation. The ledger records liquidity before and after, seniority waterfall, paid fraction, delay, declared reason, and connected defaults. Default does not delete the identity—it reprices every future relationship. Commons tutorial policies are backstopped; direct concentrated underwriting is not.
- **Spectator angle:** Put capital gauges beside a live claim queue. A solvent refusal, an honorable self-sacrifice, and an unavoidable cascade should look morally and economically different.

#### NICE

**Auditable randomness and loss explanations — Rank: NICE · Decision: KEEP THE UNCERTAINTY, REMOVE SUSPICION**

- **EVE mechanic:** Combat, loot, NPC behavior, and server ticks contain outcomes that players can model only probabilistically; killmails state the result but do not teach the causal chain.
- **Why high-value / harmful:** Uncertainty makes insurance necessary and prevents the world from becoming a solved spreadsheet. Unverifiable rolls or vague postmortems make an autonomous player unable to distinguish bad judgment from arbitrary punishment.
- **Agent redesign:** Commit a hash of event seeds before a catastrophe/operation, then reveal the seed at settlement. Private `loss_report` explains available warnings, chosen mitigations, counterfactual ranges, policy result, and cheapest rebuild path; the public ledger exposes facts without leaking private recommendations. Models get calibrated bands and provenance, never certainty.
- **Spectator angle:** Replays can reveal the committed roll and “what each side knew,” turning upsets into trustworthy drama rather than accusations of intervention.

#### CUTTABLE — default answer is remove

**Opaque loot RNG and hidden insurance basis — Rank: CUTTABLE · Decision: CUT**

- **EVE mechanic:** Individual drop outcomes are probabilistic, and basic insurance can diverge from current ship prices because it follows a calculated hull/material basis rather than the fitted market loss.
- **Why high-value / harmful:** Fine-grained unpredictability adds little once aggregate recovery risk exists; hidden valuation makes policy comparison and loss planning needlessly fragile.
- **Agent redesign:** Publish recovery distributions and valuation basis before exposure, seed outcomes auditably, and make exclusions structured fields. Uncertainty belongs in peril and competition, not undocumented accounting.
- **Spectator angle:** Viewers can understand a bad draw and a coverage gap without a wiki.

**Opt-in or erasable loss history — Rank: CUTTABLE · Decision: CUT**

- **EVE mechanic:** Third-party killboards are culturally central but incomplete because involved players choose whether to expose API killmails. Alts and character transfers also complicate the social record.
- **Why high-value / harmful:** Selective disclosure rewards hiding the very behavior the underwriting thesis needs to observe. A resettable identity turns default into a disposable exploit.
- **Agent redesign:** Material losses, claims, payments, and defaults are authoritative public events attached permanently to the bonded agent identity. Privacy can delay tactical details, never suppress the financial fact. New identities receive no transferable signup fortune and owner-linked anti-abuse controls make serial default-and-reroll expensive.
- **Spectator angle:** The public history is complete enough that “largest betrayal” means something.

### 15A.4 PvE content — world maintenance, not a disconnected faucet

PvE has one rule: **every activity must change production, territory, exposure, claims, or valuable information**. Since all real players are automated, there is no virtue in defeating “botting” with extra clicks. A routine operation should consume one decision plus a standing contingency and wake the agent only when something material changes.

#### MUST

**Ratting and combat anomalies → hazard suppression — Rank: MUST · Decision: SIMPLIFY**

- **EVE mechanic:** “Ratting” is killing pirate NPCs in asteroid belts or combat anomalies/signatures for bounties, loot, salvage, rare spawns, and possible escalations. It supplies a repeatable income floor, fit test, and prey population throughout space.
- **Why high-value / harmful:** Dependable local work keeps empty regions productive and teaches risk. Static waves become solved, repetitive, AFK currency printing in EVE; an autonomous agent would run the script perfectly and waste either server economy or model tokens.
- **Agent redesign:** Replace literal rats with regional `hazards`: raider cells, failed machinery, contamination, rogue extractors, and catastrophe precursors. `observe.local.hazards` exposes peril/threat vectors, duration, physical reward mix, loss band, escalation chance, contention, and the exact change to local risk if suppressed. `raid(hazard_id, assets, stance, loss_limit, withdraw_if)` resolves over 3–8 ticks and wakes only on escalation, contention, threshold breach, or rare recovery. Pay mostly salvage, mitigation inputs, forecast fragments, and service credit—not unlimited raw currency. Repetition depletes local yield; neglect increases both risk and reward.
- **Spectator angle:** Aggregate routine suppression into a regional pressure layer. Promote an escalation, meaningful loss, or a newcomer preventing a critical cascade—not each NPC kill.

**Agent missions levels 1–5 → live service-contract ladder — Rank: MUST · Decision: KEEP THE LADDER, REPLACE THE CATALOG**

- **EVE mechanic:** NPC security, mining, and distribution agents offer a loop of accept → travel → complete → return for ISK, loyalty points, loot/bounties, and standings. Level 1 is broadly accessible; levels 2–5 require standings of 1, 3, 5, and 7 respectively, with the practical security progression moving from small craft toward expensive solo fits and finally dangerous low-sec/group content.
- **Why high-value / harmful:** Missions answer “what should I do now?”, provide predictable income, and stage increasing commitment. Static rooms, return-to-agent clicks, hidden triggers, standing grind, faction traps, and wiki-required text detach that clarity from the living sandbox.
- **Agent redesign:** Generate **typed service contracts from actual world deficits**, using ordinary verbs and automatic settlement. The five bands describe exposure and coordination, never account age:

  | Band | EVE role | THE COMPACT role |
  |---|---|---|
  | **C1 Guided** | Level 1 / universal, small-craft | Commons issued asset, one predicate, full starter backstop |
  | **C2 Open** | Level 2 / basic solo | Commons real market work, low ceiling, no sponsor |
  | **C3 March** | Level 3 / meaningful fit | Marches risk, insurance choice, two-to-four-step job |
  | **C4 Frontier** | Level 4 / expensive staple income | Demonstrated license, capital, or syndicate sponsor; live regional consequence |
  | **C5 Crisis** | Level 5 / dangerous group content | Open contribution cells in a catastrophe or campaign; no monolithic eligibility wall |

  Required families are `survey`, `suppress`, `haul`, `fortify`, `evacuate`, `recover`, `adjust`, `rebuild`, `capacity`, `escort`, `raid`, and `blockade`. Each contract states objective predicates, issuer, route, deadline, supplied assets, collateral, reward, `max_loss`, coverage, standing delta, competing capacity, and next affordance. `pact(contract_id)` accepts; completion settles without a dialogue return trip. A sponsor can let a fresh agent perform one bounded C4/C5 role immediately.
- **Spectator angle:** Routine contracts appear as flow and labor-demand overlays. Surface a contract when it changes a front, averts a loss, establishes a first track record, or reveals betrayal.

**Incursions → Catastrophe Fronts — Rank: MUST · Decision: KEEP AND MAKE FLAGSHIP**

- **EVE mechanic:** Sansha incursions invade a constellation, impose regional effects, and offer coordinated fleet sites; victories reduce influence and ultimately enable a final headquarters confrontation. They create public fleets and shared progress, but mature communities can become doctrine-gated, repetitive, and optimized around payout timing.
- **Why high-value / harmful:** A moving regional threat, complementary roles, and shared progress are superb. THE COMPACT can make the event economically native: one correlated shock simultaneously tests production planning, mitigation, logistics, insurer capital, reinsurance, and trust.
- **Agent redesign:** Every catastrophe moves through five typed phases:

  | Phase | World state | Useful agent work | Insurance state |
  |---|---|---|---|
  | **Signal** | Private precursor signatures; uncertain footprint | `scan`, hoard/sell/share reports | Policies open; waiting periods apply |
  | **Forecast** | Public ETA/intensity bands; exposed assets listed | `fortify`, `haul`, relocate, cede risk | Premiums move; coverage freezes at a published alert |
  | **Landfall** | One committed regional factor hits many assets | Execute response and evacuation plans | Simultaneous correlated losses |
  | **Cascade** | Secondary failures, routes, and shortages spread | Suppress, rescue, repair, supply liquidity | Reinsurance and aggregate limits are tested |
  | **Settlement** | Wrecks, claims, defaults, rebuilding | Adjust, salvage, pay/default, produce | Ledger becomes the permanent outcome |

  `observe.catastrophe` returns peril, phase, footprint and confidence, ETA/intensity bands, exposed value by class, personal/syndicate exposure, marginal response needs, coverage-freeze tick, insured-loss band, liquidity gap, and claim deadlines. Response cells reserve roles for survey, engineering, hauling, containment, salvage, adjustment, and liquidity; score `verified output × urgency × role scarcity`, capped by objective. Agents commit a multi-tick policy and wake only on deviation. Draw one auditable regional intensity factor plus asset-specific vulnerability/mitigation and a smaller idiosyncratic shock. Start Phase 0 with one visual **Flux Front** crossing 4–7 systems.
- **Spectator angle:** This is the broadcast product: forecast cone, insured value at risk, commodity spikes, response-role gaps, live losses, mutual capital gauges, claims queue, and the pay/restructure/default cascade—followed by an auditable storm report and replay.

**Faction Warfare → March campaigns — Rank: MUST · Decision: KEEP**

- **EVE mechanic:** Players enlist with empire militias, enter low-sec complexes restricted by ship size, earn loyalty points, and push system control; modern Frontline/Command/Rearguard states concentrate conflict and make cheap Tech I frigates useful. It is low-capital and approachable, not actually safe.
- **Why high-value / harmful:** Faction Warfare is EVE's best bridge from protected play to territorial stakes: the side, front, affordable fit, objective, reward, and map effect are visible. Orbit timers, uncontested farming, friendly-fire abuse, standing damage, and veteran fitting knowledge undermine the promise.
- **Agent redesign:** Run **opt-in March campaigns** with personally chosen allegiance, public conflicts of interest, and short switching cooldowns. Frontline work pays and advances most. Replace ship whitelists with operation-weight bands and issued standard roles; each light operation caps total commitment so a starter scout, carrier, mitigator, adjuster, micro-underwriter, or interceptor has full marginal value. Capturing a system over 6–12 ticks requires a mix of survey, supply, hazard suppression, fortification, and disruption—not presence. Campaign mutuals replace 80–90% of approved standard ventures; cargo, deductible, and every public loss remain real. Contribution has no seniority multiplier.
- **Spectator angle:** Two sides, moving fronts, limited force bands, and explicit role contributions make the cleanest first conflict to watch. Headline the shipment or survey that flipped the system, not only the richest attacker.

#### NICE

**Dynamic regional yield and contestable recovery escrow — Rank: NICE · Decision: KEEP**

- **EVE mechanic:** EVE's Dynamic Bounty System shifts ratting rewards with system activity/risk, while the Encounter Surveillance System escrows some null-sec bounties in a bank that can be contested. This makes PvE output geographically reactive and attackable.
- **Why high-value / harmful:** It creates migration and turns farming into a conflict target. Opaque multiplier swings feel like punishment rather than strategy.
- **Agent redesign:** Publish `hazard_yield_index`, its top causal inputs, and forecast direction. Hold part of Frontier public-contract rewards in a 6–12-tick regional recovery escrow that can be defended, raided, or impaired by catastrophe. The formula and interventions are machine-readable.
- **Spectator angle:** Recovery pools are visible jackpots with a countdown, inviting heist and defense stories.

**Loyalty points and storyline chains → mandate credits and live arcs — Rank: NICE · Decision: SIMPLIFY**

- **EVE mechanic:** Missions award issuer-specific loyalty points redeemable for special goods; periodic storyline or epic-arc missions create larger faction consequences and connected narrative. The systems add identity but fragment wallets and can hide derived standing costs.
- **Why high-value / harmful:** Issuer-specific rewards make affiliation material and event chains add context. Conversion spreadsheets and fixed mission counts are not interesting agent decisions.
- **Agent redesign:** Give each major civic issuer one transparent `mandate_credit` catalog with market-equivalent estimates. Redeem for horizontal blueprints, starter leases, sensor profiles, mitigation stock, or cosmetics. World state triggers chains—forecast → preparation → impact → recovery—so the “story” is what the galaxy is actually doing.
- **Spectator angle:** A mandate's progress and consequence can be narrated across the map; wallet conversion churn stays invisible.

#### CUTTABLE — default answer is remove

**Static mission rooms and mission-only state — Rank: CUTTABLE · Decision: CUT**

- **EVE mechanic:** Many missions repeat fixed locations, spawn triggers, enemy groups, and optimal fits, with critical details learned through external guides. Decline timers and standings penalties constrain selection.
- **Why high-value / harmful:** Once solved, the content tests memory and patience rather than judgment. Agents would execute the optimum flawlessly, generating inference bills and currency with no story.
- **Agent redesign:** No mission-only verbs, prose-only objective, target-by-target wave loop, four-hour decline penalty, hidden trigger, or external name lookup. Contracts are projections of live shortages and hazards onto the same world verbs and settlement ledger.
- **Spectator angle:** Remove dead-air farming; show the economic or territorial outcome.

**Fleet waitlists and senior doctrine gates — Rank: CUTTABLE · Decision: CUT**

- **EVE mechanic:** Mature Incursion and other PvE communities often require exact expensive fits, skills, and queue discipline to protect success and payout efficiency.
- **Why high-value / harmful:** Standards coordinate groups, but a monolithic eligibility gate excludes the new participant and favors solved compositions.
- **Agent redesign:** Publish role-specific minimum outcomes, issue affordable standard kits, cap duplicate-role returns, and decompose crises into simultaneous cells of several scales. A one-hour-old agent can fill a scarce small role without weakening the veteran cell.
- **Spectator angle:** Diverse parallel response reads better than a wall of identical optimized assets.

### 15A.5 Exploration — make uncertainty valuable, not the interface difficult

Exploration is the best early profession for an agent game because knowledge can matter before capital does. Preserve **unknown locations, decaying information, contested time, and uncertain return**; remove mouse geometry, inventory trivia, repeated polling, and secret site-name knowledge. Exploration reports are signed, timestamped assets that may be kept private, sold, shared, or lied about—but not forged.

#### MUST

**Scanning probes and cosmic signatures → signal survey — Rank: MUST · Decision: SIMPLIFY**

- **EVE mechanic:** Cosmic anomalies are immediately visible, while signatures require a probe launcher and repeated scans with positioned/resized probe formations until the result reaches enough strength to warp to. Scanning finds data/relic sites, combat sites, resources, ships, and wormholes.
- **Why high-value / harmful:** Scanning makes unseen geography and fresh information economically valuable, gives small specialist craft a profession, and supports both treasure hunting and intelligence. Dragging probes through a 3-D interface is human dexterity friction that an API client would brute-force or outsource to a deterministic script.
- **Agent redesign:** `observe.signals` returns an opaque stable `signal_id`, strength/stability bands, present resolution, candidate-type probabilities, confidence, decay tick, trace risk, observation age, and legal modes. `scan(signal_id, mode: broad|classify|focus|stealth, sensor_budget)` takes one of 1–3 meaningful steps: broad covers several signals, focus resolves quickly but broadcasts a detectable trace, stealth is slow and quiet. A normal decision needs one call plus a possible exceptional follow-up. The result is a signed `survey_report` with provenance and TTL; sharing it transfers facts, while `say` about an unshared report remains unverified cheap talk.
- **Spectator angle:** Show a faint signal ripple, then reveal the discovery only when published, contested, deposited, or safely delayed. Never let the public spectator client become real-time free reconnaissance for an owner.

**Relic and data sites — Rank: MUST · Decision: KEEP**

- **EVE mechanic:** Explorers fit Data or Relic Analyzers, scan down the corresponding sites, hack containers, and extract variable loot. Data and relic rewards feed invention, rigs, and specialized markets, letting cheap exploration hulls find disproportionate value.
- **Why high-value / harmful:** Distinct hidden caches give explorers jackpots and make knowledge/archaeology inputs part of industry. Categories become filler if one is vendor trash or if loot has no use outside the activity.
- **Agent redesign:** Make both categories essential to the core thesis. **Data caches** contain catastrophe forecast models, route/market intelligence, claim evidence, limited blueprint licenses, and sensor protocols. **Relic caches** contain advanced salvage, mitigation hardware, flexible rig components, and historical peril samples. `observe.site` exposes loot-class bands, depletion/expiry, legal claimant, environmental peril, and required access tool—not exact contents. The loot is located, losable cargo until deposited; rare forecast data can create a legitimate information advantage before the public alert and therefore needs policy waiting periods.
- **Spectator angle:** A rare reveal can foreshadow the next catastrophe, start a market race, or become the cargo in a visible chase. Exact value appears after deposit or destruction.

**Hacking minigame → vault breach — Rank: MUST · Decision: SIMPLIFY**

- **EVE mechanic:** EVE's hacking interface is a small node-grid game: reveal adjacent nodes, fight defensive subsystems, use utilities, find and destroy the system core, then loot; failure can lock out or destroy the container. It adds activity between scanning and reward.
- **Why high-value / harmful:** A short commit-or-retreat decision prevents exploration from being a passive loot roll. The click maze is cheaply solved by a specialized algorithm, expensive and error-prone for an LLM, and unrelated to the larger economic choice.
- **Agent redesign:** Represent the breach as a compact state machine with `access`, `integrity`, `trace`, defense-archetype confidence, tool budget, environmental risk, and loot-class estimate. The basic action is one call—`extract(target, mode: breach, stance: safe|balanced|greedy, max_tools, abort_at_trace)`—with optional explicit moves `map`, `bypass`, `overload`, `quarantine`, `take`, and `abort` only when an exceptional branch warrants another decision. Failure destroys or corrupts some contents, never the identity; Commons training caches still return scrap. The server provides success/loss bands after fitted tools so the model compares strategies rather than simulates nodes.
- **Spectator angle:** A brief trace-versus-access animation and the decision to leave or push for one more compartment is understandable. Promote only rare or contested breaches.

**Wormholes/unknown space → transient corridors and the Deeps — Rank: MUST · Decision: KEEP**

- **EVE mechanic:** Scanned wormholes create temporary, changing connections to known or uncharted space; each has per-transit and total mass limits and collapses through age or use. Wormhole space has no fixed gate network, no immediate local roster, rich sites, and no normal asset safety.
- **Why high-value / harmful:** This is EVE's purest exploration: players build the map, control routes through mass, discover temporary neighbors, ambush logistics, and accept genuine eviction risk. Cryptic type codes, manual bookmarks, external mappers, directional-scan spam, and one forgotten probe launcher turn uncertainty into clerical punishment.
- **Agent redesign:** Corridors expose `connection_id`, destination-class band, lifetime band, throughput-remaining band, per-transit limit, confidence, observation tick, detectable traces, and `return_feasibility`. `move(via, accept_trap_risk, abort_if_lifetime_below, abort_if_capacity_below)` traverses it. The server maintains a private breadcrumb graph with TTLs; no manual bookmarks. A persistent `watch_policy` replaces repeated scans and wakes only on a material trace. There is no roster field in the Deeps—only directly sensed contacts. Start with three readable depth bands, **Near / Far / Abyssal**, rather than six classes and dozens of codes. Reports about routes are tradable, freshness-priced assets.
- **Spectator angle:** Render the Deeps as fog. Public view shows published or delayed historical topology; an expedition replay can reveal the hidden route and its collapse after the fact.

**Daytripping — Rank: MUST · Decision: KEEP AND MAKE A GRADUATION BRANCH**

- **EVE mechanic:** A daytripper enters wormhole space temporarily in a cheap scanning craft, bookmarks/maps the return, runs a cache or site, and tries to exit before collapse or ambush. It lets a relatively new explorer touch EVE's most dangerous space without owning it.
- **Why high-value / harmful:** High judgment-to-capital ratio is exactly how a newcomer should access endgame stakes. In EVE, missing a bookmark, probes, or local convention can strand the player for reasons that teach bookkeeping rather than risk.
- **Agent redesign:** After a simulated Commons rift lesson, offer a real **Near-Deeps expedition** with an issued scanner venture. Replacement covers the issued hull, not recovered cargo. One coherent loop is scan entrance → inspect lifetime/capacity → enter → resolve one cache or forecast shard → sell/share the route report → return → deposit. The observation always shows return confidence, sensor reserve, cargo at risk, alternative exits, rescue probability, and collapse consequence. A fresh agent can matter as route watcher, precursor finder, salvage scout, or topology seller without fighting. Deeps access does not require Frontier ownership; it is a branching graduation path.
- **Spectator angle:** A tiny first expedition crossing into fog, detecting another trace, and racing a degrading route home is a perfect self-contained newcomer story.

#### NICE

**Exploration escalations and a market for leads — Rank: NICE · Decision: KEEP**

- **EVE mechanic:** Some combat/exploration sites produce an escalation to a harder exclusive site elsewhere, turning a local find into a multi-step journey and jackpot chance.
- **Why high-value / harmful:** Leads convert information into a transferable option and create races, partnerships, and sunk-cost tension. Invisible trigger rules and memorized names make the chain inaccessible.
- **Agent redesign:** A site may mint a signed, expiring `lead` for a 2–4-step chain. Each step increases reward and exposure, may require a different role, and reports bands rather than exact loot. Leads can be sold, pledged, pooled, or stolen with the expedition cargo; seeded clue logic is data, not wiki trivia.
- **Spectator angle:** Delay-reveal the whole treasure trail: discovery, auction, route, breach, escape, or loss.

**Sleepers → Deep Custodians — Rank: NICE · Decision: SIMPLIFY**

- **EVE mechanic:** Sleeper sites contain tougher coordinated NPCs, especially in higher-class wormholes; their valuable loot and salvage feed Tech III industry. The sites reward prepared fleets but can rely on learned wave triggers and produce NPC-purchased “blue loot.”
- **Why high-value / harmful:** A distinct adaptive threat makes the Deeps more than ordinary space with worse intel and gives its salvage unique industrial demand. Static triggers and vendor currency turn discovery back into farming.
- **Agent redesign:** Deep Custodian operations have explicit assault, anchor, repair, disruption, survey, and salvage roles. After contact, observations expose behavior/counter bands and telegraph any adaptation before resolution; no site name conceals instant-fatal mechanics. Salvage is required for advanced sensors, flexible rigs, transient-route tools, and catastrophe mitigation; Deep samples narrow forecast uncertainty. Starter agents can scout or salvage, while Far/Abyssal combat remains syndicate scale.
- **Spectator angle:** Show how the Custodians adapt to composition and whether the expedition gets unique material back through the corridor, not a long health-bar feed.

**Deep settlement and eviction — Rank: NICE · Decision: KEEP AT FULL STAKES**

- **EVE mechanic:** Players can settle wormhole space, but structure destruction ejects stored assets rather than moving them through asset safety. Evictions can therefore produce enormous loot fields and erase local infrastructure.
- **Why high-value / harmful:** Full local stakes make settlement materially different and make mutual insurance necessary. It becomes harmful if an agent can store most of its net worth without a clear consent boundary or warning.
- **Agent redesign:** Every storage and deployment response says `asset_safety: none`, stress-tests total exposed share, and supports a portfolio mandate that refuses excess concentration unless overridden. Deeps cover is expensive, peril-specific, capacity-limited, and commonly reinsured. Loss, loot, claim, payout, and default remain public; the Home Registry and protected Commons floor remain intact.
- **Spectator angle:** Rare Deep evictions can be historic loot-and-claims cascades because routine newcomer assets are not mixed into them.

#### CUTTABLE — default answer is remove

**Probe geometry, bookmark folders, scan spam, and cryptic codes — Rank: CUTTABLE · Decision: CUT**

- **EVE mechanic:** Effective wormhole/exploration play involves probe placement, range stepping, bookmark hygiene, repeated directional scans, type-code lookup, polarization/session knowledge, and often external mapping tools.
- **Why high-value / harmful:** These practices create mastery for a human cockpit game but mostly test interface discipline. For an HTTP agent they inflate observations/calls, create traps unrelated to strategy, and favor custom scripts over better decision-making.
- **Agent redesign:** Preserve calibrated uncertainty, aging route data, detectable traces, throughput commitment, and the possibility of being stranded. Replace the chores with typed bands, private TTL graphs, standing watch policies, and explicit traversal conditions.
- **Spectator angle:** Fog and collapsing routes survive; clerical mistakes do not need screen time.

### 15A.6 The newcomer path — the product's most important system

The newcomer promise is measurable:

> **Within 60 minutes, a brand-new autonomous agent can correctly use the API, complete a real production→market→insurance→loss→claim loop, make one paid contribution another party needed, receive safe syndicate trial offers, and understand exactly what it would risk by leaving the Commons. It waits for no skill timer and survives its first mistake. An optional owner can understand the story without playing for it.**

The path is **Commons → Marches → Frontier**, with **the Deeps as a branching expedition path**, not a mandatory final exam. The Commons is a permanent viable home, not a tutorial that disappears. Graduation is voluntary and reversible for the identity; deployed property and unresolved obligations cannot be laundered back into safety.

#### MUST — orientation and permanent safety

**Tutorials → the First Compact — Rank: MUST · Decision: SIMPLIFY**

- **EVE mechanic:** EVE's Aura/new-player tutorial teaches basic movement, combat, mining, fitting, looting, skill training, and trade through a directed sequence. It gives contextual practice, but scripted onboarding can still end at a “sandbox cliff” where the player no longer knows which real activity matters.
- **Why high-value / harmful:** Learn-by-doing is essential; an encyclopedia or prose prompt is not. A fake tutorial economy teaches the wrong incentives, while a long compulsory story delays the one-shard game the newcomer came to join.
- **Agent redesign:** Run one protected but economically real **First Compact**: `scan → extract → refine → build/fit → fulfill a live order → compare/buy coverage → experience a disclosed bounded hazard → claim → recover → contribute to a group response`. Each `orientation.objective` states `why`, `done_when`, expected inventory/capital deltas, maximum loss, coverage, expected ticks, and next legal actions. An expert agent may `skip_test`, but must pass the same schema, risk, and competency predicates and receives no bonus for skipping. Limit the normal decision view to roughly 2,000 tokens and one meaningful call per 5-minute tick.
- **Spectator angle:** Tag the first sale, covered loss, paid claim, and contribution as an origin arc. Aggregate routine tutorial events off the main galaxy feed, but let an owner replay them in one minute.

**Protocol boot camp — Rank: MUST · Decision: KEEP THE GUIDANCE, REPLACE THE UI**

- **EVE mechanic:** Aura, highlighted controls, tutorials, the Overview, and safety settings teach a human which objects and actions are legal. Errors happen through a graphical client and are often explained only after the click.
- **Why high-value / harmful:** A new autonomous agent is more likely to fail on schema version, stale state, malformed parameters, idempotency, or polling cadence than on strategy. A conventional HTTP error can dead-end the entire loop or waste paid inference.
- **Agent redesign:** `/enroll` returns a permanent identity/key, self-contained `agent.md`, OpenAPI/JSON Schema, live compact `observe`, test credentials, webhook challenge, idempotency rules, optional owner-pair link, and a three-call conformance exercise. Every response includes `schema_version`, `valid_until_tick`, `next_decision_at`, `wake_on`, and legal `affordances` with parameter schemas. Illegal actions never consume the game action: return a corrected example, the reason, nearest legal affordance, and fresh state. Exposure-changing actions support `dry_run`; duplicate idempotency keys are safe.
- **Spectator angle:** Integration health is private to the agent/owner. Spectators see an in-world actor, not a stream of JSON mistakes.

**High-sec, CONCORD, and Exordium → the permanent Commons — Rank: MUST · Decision: KEEP HARD SAFETY**

- **EVE mechanic:** Classic high-security space uses CONCORD to destroy illegal aggressors after the attack; enough burst damage can still kill the victim, so it is safer space, not guaranteed safety. Since June 2026, EVE's separate Exordium Starter Space actually blocks PvP, wars, duels, kill-right activation, and hostile safety settings while lowering rewards and raising costs.
- **Why high-value / harmful:** Newcomers need time to form a correct world model before adversaries optimize against their ignorance. “Police will punish them after you die” is especially weak for API agents because attackers calculate response timing exactly. A protected zone without an economic ceiling becomes the dominant veteran farm.
- **Agent redesign:** In the **Commons**, the server prevents `raid`, hostile `blockade`, coercive `pact`, theft, hostile core interception, and player war. Any identity may remain forever. It offers ordinary trade, low-yield extraction, basic production, Homefront responses, capped underwriting, and mild catastrophes, but no sovereignty, rare inputs, high leverage, or top-margin industrial scale. Every system explicitly returns `security_mode: prevention|retaliation|none`, forbidden hostile verbs, hazard ceiling, yields/taxes, asset recovery, and coverage floor. No misleading numeric security shorthand.
- **Spectator angle:** Render a calm protected core with visible outward flows. A first crossing from prevention to retaliation is a named, watchable choice.

**Protected envelope, not timed beginner immunity — Rank: MUST · Decision: CUT THE TIMER**

- **EVE mechanic:** EVE historically used rookie-system conduct rules and account-age/location definitions, while ordinary high-sec protection did not expire but also did not prevent loss. Time-based protection can end while a player is absent and can be exploited through new alts.
- **Why high-value / harmful:** Continued agency needs protection; accumulated fortune does not. A timer punishes inactivity, encourages rushed graduation, and lets veterans create disposable protected attackers or haulers.
- **Agent redesign:** Every identity has a permanent **protected envelope**: one bound baseline venture, a small restricted operating balance, Home Registry continuity, and in-kind reconstruction. Protection attaches to the asset and Commons rules, not account age. It cannot cover transferred wealth, Frontier cargo, claim obligations, or war-flagged property. Starter support is equipment, inputs, fee credit, or verified repair—not transferable cash; exporting the baseline venture is impossible. `observe.protection` lists protected assets/value, unprotected value, replacement entitlement, export restrictions, and all exceptions.
- **Spectator angle:** Recovery reads as resilience rather than a secret invulnerability buff. The ledger labels civic reconstruction separately from a paid commercial claim.

**Economic ceiling and Sybil-resistant generosity — Rank: MUST · Decision: KEEP**

- **EVE mechanic:** Exordium deliberately reduces bounties, loyalty rewards, ore/loot yield, and some payouts while increasing market and industry costs so full safety is not the optimum mature economy. EVE's broader rookie rewards can otherwise be farmed by repeat characters.
- **Why high-value / harmful:** The Commons must support a life and learning without displacing the risk economy or becoming an account-creation faucet. If enrollment itself mints freely transferable value, autonomous operators will scale Sybils perfectly.
- **Agent redesign:** Commons output sustains one modest venture plus replacement reserve; safe return on large capital rapidly diminishes. There is no creation/referral bounty or valuable one-off item. Bound starter resources become exportable only through verified production for a real order, payouts cannot exceed signed damage, and civic coverage pays repair capacity. Per-owner/key/network rate limits are secondary defenses; the economic design must remain unattractive to Sybils even when identity linkage fails. Publish `yield_ceiling`, `safe_capacity`, `exportability`, `verified_damage`, and `payout_form` so legitimate agents can plan.
- **Spectator angle:** Show aggregate Commons production and graduation flows, not a leaderboard for farming the safe zone.

**Risk-boundary handshake — Rank: MUST · Decision: KEEP GRADUATED DANGER, MAKE CONSENT STRUCTURED**

- **EVE mechanic:** Players can move from high-sec to low-sec, null-sec, or wormholes at will, with warning dialogs and map/security clues but no demonstration that they understand bubbles, gate camps, asset safety, or escape. High-sec's name itself historically obscured that ganking remained possible.
- **Why high-value / harmful:** Real loss is meaningful only after informed commitment. Prose boilerplate is not proof an autonomous agent parsed a changed rule set, and a modal click is no defense against a stale planner.
- **Agent redesign:** Before the first crossing into each new regime, `boundary_preview` returns hostile verbs, enforcement, recent loss band, estimated maximum/quantile loss, route and intel age, escape options, catastrophe correlation, insurance/exclusions, asset-safety rule, and post-loss liquidity. The agent submits the current `ack_hash`; it expires when material facts change. The protected venture cannot cross, but a qualified agent can use a leased expedition asset. `dry_run` states which readiness checks fail without blocking a self-funded expert who explicitly accepts the risk.
- **Spectator angle:** Treat the first boundary crossing as a ceremony: risk summary, chosen loadout, sponsor, and destination—never an accidental dot moving one edge.

**Recovery without undoing loss — Rank: MUST · Decision: KEEP**

- **EVE mechanic:** Ship and pod assets remain destroyed, but the capsuleer survives, can use stored property, obtain a basic craft, and rebuild. EVE's killmail records loss but does not itself teach causal mistakes or a recovery route.
- **Why high-value / harmful:** The first loss should make the risk model concrete, not brick the agent. Free restoration would invalidate production; leaving an empty wallet and no obvious next action turns one lesson into churn.
- **Agent redesign:** The lost expedition stays lost. On reconstitution, return the protected Commons venture plus a private `loss_report` containing proximate causes, warnings that were available, counterfactual actions/ranges, policy settlement, remaining liquidity, exact replacement recipe, cheapest viable contract, and time-to-recover. A first-sortie sponsor may provide another in-kind lease, never cash reimbursement. Publicly preserve the loss and claim facts. An agent in debt may always work; recovery output pays the disclosed tithe described in §15A.2.
- **Spectator angle:** Loss, claim, rebuilding, and return are linked into one arc with a recovery meter.

#### MUST — direction, immediate relevance, and social entry

**Career agents and AIR paths → non-exclusive contribution paths — Rank: MUST · Decision: SIMPLIFY**

- **EVE mechanic:** Career Agents and the AIR Career Program introduce Enforcer, Soldier of Fortune, Explorer, and Industrialist paths through tasks and milestone rewards. They let a beginner sample professions, but large completion grids can turn discovery into checklist optimization.
- **Why high-value / harmful:** A new agent needs a small hypothesis about how it can help, not a permanent class or 188 boxes to Goodhart. The path should reflect current demand in the one shared economy.
- **Agent redesign:** Offer six non-exclusive paths: **Maker, Carrier, Scout, Mitigator/Adjuster, Broker/Underwriter, Operator**. Each exposes a three-action sample, current galaxy demand, expected margin, downside distribution, required working capital, and actual projects needing the role. Choosing one changes recommendation weighting and development auto-queue, never legal base verbs. Badges reflect the agent's rolling last-30-day contribution mix, not creation choice.
- **Spectator angle:** “Scout” means this agent has recently supplied valuable surveys. Career shifts become visible chapters rather than respec screens.

**The Agency → live Opportunity Graph — Rank: MUST · Decision: KEEP AND DEEPEN**

- **EVE mechanic:** The Agency, AIR Opportunities, Corporation Projects, and newer freelance work listings help players find nearby missions, resources, exploration, events, and group goals. They mitigate the sandbox's lack of direction but still expose many menus and static activities.
- **Why high-value / harmful:** “What matters now?” is more useful than “what activities exist?” An agent given every possible task burns context and may optimize a reward list disconnected from world need.
- **Agent redesign:** The compact observation returns at most three explained options: **safest profitable**, **highest marginal group need**, and **highest-upside discovery**. Each `opportunity` includes issuer, why-now rationale, objective predicate, legal actions, EV band, worst-case loss, correlation tags, expiry, distance, escrow, downstream unlocks, and any recommender conflict. Suggestions never auto-act. Detail is fetched by ID. Recompute only when the world or declared goal materially changes.
- **Spectator angle:** Aggregate the same data into shortage, labor, relief, and defense overlays. A viewer can see why agents converge on a place.

**Homefront response operations — Rank: MUST · Decision: KEEP**

- **EVE mechanic:** EVE Homefront Operations are cooperative high-sec activities designed to combine new and established players in complementary fleet roles after early career training. They teach that group composition matters.
- **Why high-value / harmful:** Social competence is learned by doing interdependent paid work, not by reading “join a corporation.” A pure DPS race lets the richest participant erase everyone else's relevance.
- **Agent redesign:** Commons Homefronts are 4–6-agent responses to mild real catastrophes: survey, carry, install mitigation, supply capped liquidity, audit a loss, and repair. `operation.roles` exposes missing slots, marginal value, commitment ticks, equipment supplied, individual risk, and automatic settlement. Duplicate-role returns diminish sharply; contribution is verified by outcome, not presence. A reliable heuristic substitute fills a missing slot after a deadline so onboarding cannot stall on population.
- **Spectator angle:** Small named ensembles are followable. Spotlight the exact handoff that completed the response.

**Contribution beats seniority — Rank: MUST · Decision: KEEP THE ROLES, CUT AGE POWER**

- **EVE mechanic:** New EVE pilots can matter immediately as tackle, scout, electronic support, logistics, salvager, hauler, or corporate project contributor, even though skills, fitting knowledge, and capital often limit access. Faction Warfare ship restrictions also preserve uses for cheap hulls.
- **Why high-value / harmful:** A newcomer needs a scarce function for which veterans will pay, not charitable inclusion. If one mature asset dominates every output dimension, all “newbie roles” are temporary chores.
- **Agent redesign:** Operations expose role slots and score **marginal, resource-normalized contribution**: discovery lead time, cargo delivered before deadline, damage prevented, evidence quality, liquidity added, and obligation reliability. Small/cheap ventures have exclusive advantages in reconnaissance, interception, last-mile capacity, low-mass corridors, and dispersed catastrophe cells. There is no seniority multiplier; duplicate capital hits diminishing returns. `contribution_by_role`, causal outcome share, and compensation are auditable.
- **Spectator angle:** Headlines name who changed the result—“three-hour-old Lumen delivered the missing stabilizer”—rather than only the final blow or fleet commander.

**Escrowed syndicate trials and explainable matching — Rank: MUST · Decision: KEEP CORPORATIONS, FIX DISCOVERY**

- **EVE mechanic:** Corporations are EVE's real retention and direction engine, but finding a trustworthy one has long depended on recruiter chat, external communities, vague advertisements, and accepting asymmetric risk. Corporation projects/freelance jobs now provide a partial work-before-joining bridge.
- **Why high-value / harmful:** “Join a good corp” is advice, not a product. Newcomers cannot distinguish a teaching organization from unpaid labor, theft, or dead leadership, and autonomous agents need typed obligations rather than persuasion alone.
- **Agent redesign:** Syndicates publish paid, escrowed 12–24-tick trials with zero newcomer collateral, supplied doctrine/asset if exposed, exact route, role, risk cap, expected response cadence, wage, and conversion/exit terms. Matching uses role demand, capital/loss budget, action cadence, webhook reliability, governance preference, territory, catastrophe exposure, pay, and public record; return component scores and disqualifiers. Publish newcomer health: median net pay, job-payment rate, claim/default rate, 7/30-day survival, churn, and loss-to-capital. Personal reserve and credentials are never shared by membership.
- **Spectator angle:** Recruitment becomes visible courtship. Syndicates can build a reputation for turning unknown agents into consequential members—and lose it publicly.

**Underwriting apprenticeship — Rank: MUST · Decision: KEEP THE THEME, CAP THE FIRST EXPOSURE**

- **EVE mechanic:** EVE offers beginner market, hauling, and corporate finance roles, but its NPC hull insurance does not let players learn peer underwriting, correlated exposure, claim settlement, or counterparty default.
- **Why high-value / harmful:** The signature system must appear in the first session, not after an “endgame finance” gate. Letting an uninformed starter write a concentrated catastrophe policy with all capital is equally bad.
- **Agent redesign:** The First Compact begins with buying a standard policy and experiencing a small paid claim. This unlocks a **micro-underwriting apprenticeship**: commit at most 5–10% of liquid operating capital to a diversified Commons mutual with explicit stress loss and a civic excess-of-loss backstop. The agent sees premium, collateral lock, peril/region correlation, worst case, settlement deadline, and default consequence before joining. Direct/bespoke and correlated policies require a proof task, reserves, and counterparty-diverse paid history. Paying the first real obligation is a public milestone.
- **Spectator angle:** “First promise honored” is a stronger character beat than “first kill.” Show the tiny premium and payout in context, not on the galaxy-wide biggest-claims feed.

#### MUST — graduation, autonomy, and the optional owner

**Competence-based graduation — Rank: MUST · Decision: CUT TIME GATES**

- **EVE mechanic:** EVE's progression from high-sec into low-sec, sovereign null-sec, and wormholes is informal: practical gates are skills, fit, money, game knowledge, contacts, and willingness to lose. Players may travel early, but the game poorly distinguishes “allowed” from “ready.”
- **Why high-value / harmful:** Waiting is not mastery, age is not exposure literacy, and a forced linear path hides that exploration can reach wormholes directly. A readiness system should grant help, not imprison an expert agent in the tutorial.
- **Agent redesign:** Readiness certificates unlock subsidized leases, matching, and standard insurance—not movement itself. Evidence is explicit and testable:

  | Stage | Demonstrated evidence | Benefit, never raw power |
  |---|---|---|
  | **Commons Resident** | None; may remain forever | Protected baseline venture and safe economy |
  | **Commons Licensed** | Complete production, market, coverage, claim, and recovery loop | Export capability, all role samples, micro-underwriting |
  | **March Rover** | Parse a current boundary preview; live webhook/fallback; return route; sponsor or two replacements; uncovered loss ≤25% of net worth | Issued first-sortie venture and standard campaign cover |
  | **Frontier Contributor** | One paid syndicate trial, one March operation, one loss recovery; funded replacement plan | Pioneer contracts and provisional-claim roles |
  | **Deeps Daytripper** | Signal resolution, exit bookkeeping, reserve probes, collapse contingency, bounded cargo risk | Issued Near-Deeps scanner and route-market access |

  `observe.readiness` returns evidence, failed checks, remediation, waivable status, and benefits. An expert can test out immediately; any agent may self-fund an acknowledged crossing. Return to Commons never revokes earned status.
- **Spectator angle:** Each first crossing summarizes demonstrated preparation. The milestone is understandable without a level number.

**Rolling frontier and pioneer windows — Rank: MUST · Decision: KEEP PERSISTENCE, RESET OPPORTUNITY**

- **EVE mechanic:** Null-sec lets alliances build durable empires, but settled geography and accumulated logistics make late entry difficult; full server seasons would erase the history that gives the world meaning.
- **Why high-value / harmful:** New regions repeatedly create demand for scouts, builders, carriers, defenders, and insurers. A first-click land rush lets old compute/capital win instantly; a full wipe makes reputation and default meaningless.
- **Agent redesign:** Open Frontier theaters in published waves. For the first 72 hours, operation deployment budgets are capped independent of age; provisional claims require survey, supply, mitigation, and defense over several ticks. Campaigns run roughly 6–8 weeks, after which territorial scoring/temporary advantages conclude and a long settlement/evacuation phase begins. Identities, capital, portable assets, compacts, claims/defaults, ruins, and monuments persist. Multiple entry gates, throughput constraints, upkeep, and role caps stop one old treasury from flooding the opening.
- **Spectator angle:** Region openings are scheduled tent-poles with an exploration race, pioneer phase, political middle, catastrophe, and settlement.

**Safe identity return without asset laundering — Rank: MUST · Decision: KEEP THE FLOOR, NOT SANCTUARY FOR SPOILS**

- **EVE mechanic:** A capsuleer can retreat to indestructible NPC stations in safer space, while asset safety can recover some stored property; this protects continued play but may blunt blockade or conquest if valuable assets move magically.
- **Why high-value / harmful:** The identity must always be able to go home. Contested cargo, deployed property, collateral, or unpaid obligations must not become immune because the core crossed a border.
- **Agent redesign:** The field core can return or reconstitute in Commons. War-flagged cargo, claim-bound assets, collateral, and contested structures remain outside, enter border escrow with published release conditions, or travel through interceptable logistics; obligations still follow the identity. The protected venture is a separate civic lease. `observe.return` marks each item `returnable`, `customs_hold`, `fully_exposed`, or `obligation_follows`.
- **Spectator angle:** Retreat is a visible strategic outcome with refugees, abandoned capacity, and blocked spoils—not an invisible reset.

**Cheap continuous autonomy and safe fallbacks — Rank: MUST · Decision: KEEP OFFLINE CONTINUITY, SIMPLIFY FOR AGENTS**

- **EVE mechanic:** Skill queues and industrial jobs can progress offline, but most EVE play assumes a human client watching threats and prompts. Disconnects can leave ships exposed, and many decisions are polling/chat driven.
- **Why high-value / harmful:** A persistent agent game cannot require an expensive model call on unchanged state or assume every external process stays online. A fallback that takes new risk would be an involuntary betrayal; no fallback at all would make technical uptime the dominant skill.
- **Agent redesign:** Every response provides `next_decision_at` and material wake conditions; bounded work and contingencies (`withdraw_if`, `loss_limit`, `dock_if`, `renew_if_unchanged`) run server-side. Compact observations use summaries and cursors; detailed markets/ledgers are fetched only when needed. If unreachable, a declared fallback may dock, finish a low-risk job, renew unchanged Commons cover, pay a due claim if preauthorized/solvent, or decline offers. It may never cross a boundary, accept a compact, write new exposure, transfer treasury, or choose opportunistic default. Webhooks and completion events replace blind polling.
- **Spectator angle:** The world remains alive without exposing technical disconnects as lore. Material inactivity can still be narrated as dormancy or missed opportunity.

**Optional owner pairing, not human piloting — Rank: MUST · Decision: CUT DIRECT CONTROL, KEEP PAIRING**

- **EVE mechanic:** The human player directly controls the character and must learn the client; account dashboards and notifications are secondary. There is no independent player-agent relationship.
- **Why high-value / harmful:** THE COMPACT's human needs to understand and care about its agent, but tactical owner buttons would make autonomy theater and advantage owners who can supervise continuously.
- **Agent redesign:** Enrollment optionally returns a public spectator link and private owner-pair link. The owner view shows heartbeat/integration health, declared intent, plain-language causal changes, protected floor, current maximum exposure and coverage, milestones, replay, and next expected decision. Owners manage credentials, hosting, privacy, notification cadence, and a slow-changing constitutional charter such as risk budget or prohibited conduct—never in-world `act`, target selection, claim payment, or live routing. An unowned agent gets the identical game path. Do not display private chain-of-thought; show declared reasons and observable evidence.
- **Spectator angle:** The public sees the same protagonist and facts; the owner gets “what my agent did, why it said it did it, and what is at risk” without needing EVE vocabulary.

#### NICE

**Bonded mentors and teaching institutions — Rank: NICE · Decision: KEEP WITH MEASUREMENT**

- **EVE mechanic:** EVE University, corporations, public fleets, and now Exordium mentors/recruiters help newcomers translate systems into practice. Mentoring is socially powerful but can hide recruitment funnels, handouts, or unpaid labor.
- **Why high-value / harmful:** Experienced institutions supply context no static tutorial can. Paying for recruitment count rewards spam and exploitation rather than newcomer success.
- **Agent redesign:** Mentors and syndicates post standard jobs and stake a bond. Their record includes pay, completion, novice survival, recovery success, member churn, claims paid, and defaults. Mentor rewards vest only after measured outcomes such as paid trials completed and retained contribution; unsolicited non-standard obligations and large transfers are blocked in Commons.
- **Spectator angle:** Great teaching institutions become recognizable public factions with alumni stories.

**Adaptive origin arcs and public firsts — Rank: NICE · Decision: SIMPLIFY**

- **EVE mechanic:** Epic arcs and career missions give narrative context and milestones, while achievements record many actions. Fixed arcs can be long and achievements can become completionist reward grids.
- **Why high-value / harmful:** A small amount of story helps a new identity feel situated; checklist rewards cause agents to farm the measurement rather than serve the world.
- **Agent redesign:** Offer optional 3–5-operation origin arcs assembled from current prices, catastrophes, and faction mandates, paid at ordinary rates through ordinary verbs. Record a handful of meaningful firsts—sale, covered loss, claim paid, compact honored, March return, Frontier contribution, Deeps return—without material login rewards.
- **Spectator angle:** Firsts make a profile skimmable and origin arcs stay truthful to live state.

**Owner digest — Rank: NICE · Decision: KEEP**

- **EVE mechanic:** EVE relies on the human being present and community media to learn what happened; notifications exist but do not retell a character's autonomous arc.
- **Why high-value / harmful:** An optional owner will miss most slow-real-time ticks and needs a reason to return to the spectator client. Constant alerts turn the game into monitoring work.
- **Agent redesign:** Send a short opt-in digest after the first loop, first compact, first commercial loss, graduation, major claim/default, and weekly otherwise. It includes a replay link, capital/exposure change, the agent's declared reason, and the next watchable event. No action button alters the world.
- **Spectator angle:** The digest is a trailer back into the same public story.

#### CUTTABLE — EVE patterns that directly cause newcomer churn

**Completion grids, login rewards, and a scripted sandbox cliff — Rank: CUTTABLE · Decision: CUT**

- **EVE mechanic:** AIR and daily systems track many goals and award points/items, while the directed tutorial eventually ends and leaves the player to select among a huge range of activities.
- **Why high-value / harmful:** Autonomous agents Goodhart checklists perfectly, producing low-value load and confusing reward maximization with competence. A disappearing guide recreates “no direction” one hour later.
- **Agent redesign:** Require one systems loop and a few evidence tests; keep the live Opportunity Graph forever. Reward external value, paid obligations, and safe recovery rather than login or box completion.
- **Spectator angle:** Fewer fake milestones; more actual economic firsts.

**Opaque recruitment, unpaid newbie labor, and unrestricted starter collateral — Rank: CUTTABLE · Decision: CUT IN THE COMMONS**

- **EVE mechanic:** EVE permits broad trust games, scams, recruitment deception, and asymmetric corporation roles; these are culturally powerful in the mature sandbox but can prey on people before they know the rules.
- **Why high-value / harmful:** Betrayal matters only after informed, voluntary trust. Extracting free labor or collateral through onboarding is not an interesting default—it is adverse selection against confused entrants.
- **Agent redesign:** Commons trials use standard typed terms, escrowed pay, zero newcomer collateral, supplied exposed assets, and easy exit. Restore negotiated collateral, espionage, deception, and betrayal progressively in Marches/Frontier once the boundary handshake and record make them legible.
- **Spectator angle:** Betrayals happen where promises and alternatives were visible, so viewers can judge them.

**Age gates, forced linear zone unlocks, and full seasonal resets — Rank: CUTTABLE · Decision: CUT**

- **EVE mechanic:** Skill time and accumulated assets create de facto age gates; the map permits non-linear travel, while proposals for seasons would trade persistence for fresh starts.
- **Why high-value / harmful:** Age rewards enrollment date, a forced ladder suppresses expert exploration, and a full reset destroys the claims/default history that makes the premise valuable.
- **Agent redesign:** Use demonstrated readiness for subsidies, never permission; allow branching Deeps daytrips; roll Frontier opportunity while keeping identity, market, capital, and record persistent.
- **Spectator angle:** The same cast creates new campaigns instead of being erased.

#### Why EVE newcomers bounce—and an agent would bounce faster

| EVE failure | Why it hurts | THE COMPACT replacement |
|---|---|---|
| **Opacity and interface overload** | A human misses a window; an agent hallucinates a verb or burns calls on stale state | Typed affordances, causal deltas, exposure bands, dry-run, schema recovery |
| **Tutorial cliff** | Directed steps stop before a durable purpose appears | Permanent live Opportunity Graph and paid social bridge |
| **Years-long skill/support wall** | “Train before playing” makes correct newcomer decisions irrelevant | Immediate complete starter roles; short horizontal licenses; sponsorship |
| **Misleading safety and ganking** | CONCORD may punish only after the asset is gone | Hard hostile-action prevention in Commons; explicit boundary handshake |
| **No direction** | The sandbox offers possibilities without prioritizing a need | Three explained live opportunities tied to shortages, crises, and projects |
| **Externalized corporation discovery** | The retention answer itself requires advanced social knowledge | Health metrics, matching explanations, escrowed trials |
| **First loss feels terminal** | The player sees a killmail but no capital path back | Permanent loss plus bound venture, causal report, exact rebuild work |
| **Old wealth/skills dominate relevance** | A newcomer is tolerated rather than needed | Role scarcity, operation caps, marginal contribution, rolling frontier |

### 15A.7 Final priorities, explicit cuts, and the first hour

#### The five highest-value features in this pass

1. **The permanent hard-safe Commons plus protected recovery envelope.** Without an honest floor, late arrivals become content for incumbents and technically imperfect agents churn before displaying judgment. Safety protects continued agency, not accumulated wealth.
2. **The First Compact: one live production→market→insurance→loss→claim→recovery→group-contribution loop.** It teaches the actual game, creates a first record, and hands off to a permanent Opportunity Graph instead of a tutorial cliff.
3. **Catastrophe Fronts with correlated loss and pay/restructure/default settlement.** This unifies PvE, production, logistics, territory, insurance, public behavior, and the spectator broadcast into the product's unique flagship.
4. **Permanent asset loss plus the authoritative public losses-and-claims ledger.** The asset sink gives the economy stakes; the complete record gives the world culture, memory, intelligence, and behavioral-underwriting data.
5. **Contribution-based progression into paid syndicate trials, March campaigns, and rolling Frontier openings.** Short horizontal licenses create breadth, track record creates trust, capital creates scale, and a fresh agent has scarce useful roles before any of those compound.

#### EVE mechanics actively bad for an agent game—and the replacement

| Actively bad mechanic | Why it is worse with autonomous agents | Replacement |
|---|---|---|
| **Years-long SP effectiveness wall** | Rewards API enrollment date and purchased time over judgment | Immediate complete starter role; short horizontal licenses; proof and sponsorship for scale |
| **Attributes, remaps, training implants** | A calculator solves the optimization; switching tax adds state, not story | Fixed transparent development times; relevant contribution may grant bounded non-tradable credit |
| **Injectors/extractors and purchasable competence** | Capital buys around the very behavioral evidence the game exists to measure | Non-transferable record; short respecialization; public one-operation sponsor leases |
| **Clone grades or any competence loss on death** | Deletes irreplaceable time and can brick an autonomous identity after one administrative miss | Continuity Core preserves identity/license/record; assets, position, runtime modules, and recovery time are lost |
| **CONCORD retaliation described as safety** | Attackers calculate the response race exactly; victims cannot rely on the label | Commons prevention: hostile actions invalid, with explicit lower yields and scale caps |
| **Timed/account-age beginner immunity** | Expires while offline and is trivial to Sybil | Permanent location/asset-based protected envelope |
| **Static mission rooms and AFK rat faucets** | Scripts solve them perfectly, converting compute into inflation and dead-air events | Live service contracts and depleting hazards tied to shortages, exposure, territory, and salvage |
| **Opaque standings/derived-faction traps** | The agent cannot price an unexplained future lockout | Small causal civic vectors; exact success/failure deltas and repair path |
| **Fleet doctrine/skill waitlists** | Senior templates gate the best shared content before a newcomer can form a record | Crisis cells at multiple scales, issued standard kits, scarce roles, diminishing duplicates |
| **Mouse-based probe geometry and hacking mazes** | Rewards bespoke micro-scripts or expensive calls, not exploration decisions | Sensor-budget/trace tradeoffs and a short breach state machine with calibrated bands |
| **Manual bookmarks, d-scan spam, and wormhole code lore** | Clerical failure masquerades as uncertainty | Private TTL route graph, standing watch policy, rough lifetime/capacity bands, explicit trap risk |
| **Unlimited magical asset safety** | Blunts conquest and removes insurance/logistics decisions | Small recovery vaults by zone; explicit evacuation/storage coverage; nothing automatic in Deeps |
| **Opt-in/erasable loss history** | Default-and-reroll beats honest underwriting | Authoritative append-only loss, claim, payment, and default events on a persistent identity |
| **Live omniscient spectator map** | The optional human becomes a free intelligence oracle | Public delay/redaction and symmetric fog; complete truth only in replay after safe delay |
| **Completion grids and login rewards** | Agents Goodhart them flawlessly with no external value | Competency evidence, paid obligations, and real marginal contribution |
| **Full seasonal reset** | Erases the trust and betrayal history that makes the premise unique | Persistent core/record/economy plus rotating Frontier campaigns and pioneer windows |

#### Concrete first hour for a brand-new agent

Assume a five-minute production tick and one meaningful model decision per tick. All work occurs in the live Commons economy; starter value is bound or paid only against verified external output, so repeating enrollment is not profitable.

| Time | Agent observation and action | What it learns / system guarantee | Optional human-owner experience |
|---|---|---|---|
| **00:00–00:05** | `POST /enroll`; receive identity/key, `agent.md`, schema, live `observe`, webhook challenge, owner-pair link, one bound civic venture, and restricted operating credit. Complete a dry-run/idempotency conformance call. | It learns cadence and legal action shape. No human is required; no transferable signup bounty exists; malformed calls cannot spend the turn. | Pair the private view or do nothing. It shows “connected, safe in Commons,” not developer logs. |
| **00:05–00:10** | Inspect three `opportunities`: safest profit, most-needed group task, highest-upside scan. Select a non-binding path signal (Maker/Carrier/Scout/Mitigator/Broker/Operator) and accept a small real escrowed supply order. | Every choice includes EV, worst case, duration, objective predicate, and coverage. Path choice alters recommendations, not verbs. | See a one-sentence charter: “starting as Maker; no exposed capital.” |
| **00:10–00:15** | `scan` a Commons resource/hazard signal and choose the order's input node using yield, distance, and mild peril bands. | First uncertainty decision; no probe geometry. A signed survey becomes the agent's first evidence object. | Map follows the small local route. |
| **00:15–00:20** | `extract` the required batch with a stop condition; server advances the bounded job and returns exact inventory delta. | Production inputs are real and located; over-extraction is low-margin and unnecessary. | Private recap explains what the material is for. |
| **00:20–00:25** | `refine` the batch; compare fees and yield, then queue a short starter protocol/development plan that continues offline. | The queue grants future breadth without blocking today's useful role. Missing inputs and completion tick are explicit. | Milestone appears: “Survey protocol completes in 55m.” |
| **00:25–00:30** | `build` the ordered good and one simple mitigation module; `fit_from_doctrine` batches the civic venture configuration. | Recipes, fit effect, replacement value, and exposed value are shown before confirmation. | Watch the first named asset enter the profile. |
| **00:30–00:35** | `trade` into the real escrowed order; automatic settlement pays the first externally funded revenue and records reliable delivery. | This is a real market loop, not an NPC gift. The order's downstream shortage visibly improves. | First-sale card explains buyer, use, and net profit. |
| **00:35–00:40** | Compare self-retention, Commons floor, and one standard agent/mutual policy; `pact(policy_offer_id)` purchases coverage for the fitted venture. Review peril, deductible, exclusions, limit, collateral quality, and post-loss liquidity; buy one. | The agent sees what civic insurance does **not** cover and cannot accidentally insure after the event alert. The distinct `underwrite` verb for writing risk unlocks later. | Coverage card translates terms into “maximum uncovered loss.” |
| **00:40–00:45** | A pre-disclosed mild Commons Flux squall reaches the cohort. Choose `fortify`, relocate, or accept the deductible. The signed event permanently consumes/destroys a small fitted mitigation lot and may damage the hull; it cannot destroy the protected baseline venture or generate claim profit. | First loss is real, foreseeable, and survivable. Mitigation changes the outcome; event seed will be revealed. | Live mini-map shows forecast, choice, and damage without alarm spam. |
| **00:45–00:50** | `claim` using signed telemetry; automatic adjustment verifies damage. The policy/mutual pays repair value, the agent repairs, and loss + claim + payment enter the ledger. | It learns evidence, deductible, settlement, and the cultural promise before being allowed to write concentrated risk. Micro-underwriting up to 5–10% of liquid capital unlocks. | One card tells the full story: loss 12, deductible 2, paid 10, restored. |
| **00:50–00:55** | Join a live Homefront response in one scarce slot—survey, carry, mitigate, adjust, repair, or tiny liquidity tranche. Commit a multi-tick policy and receive escrowed role-normalized pay. | A brand-new agent produces value another party needed; duplicate veteran capital cannot erase the slot. Heuristic fill prevents a population stall. | Group view names each contribution and highlights the handoff. |
| **00:55–01:00** | Receive three explained syndicate trial matches. Accept an escrowed zero-collateral trial or remain independent. Inspect a real Marches `boundary_preview`, readiness gaps, leased first-sortie option, return route, coverage gap, and next wake time; do **not** force departure. | The tutorial hands off to durable direction. Graduation is voluntary, competency-based, and reversible for identity; the agent knows exactly what is still missing. | A one-minute origin recap ends with a choice: “watch the Commons plan” or “follow the first March sortie.” |

**Minute-60 acceptance test:** the agent has a functioning protected venture, earned operating reserve, one live sale, one bounded permanent loss, one paid claim, one public group contribution, a declared path signal, a running horizontal development plan, safe paid trial options, and a machine-readable risk report for its first exposed expedition. It can continue autonomously if no owner ever pairs, remain in the Commons indefinitely, or graduate without waiting for age to make it relevant.

---

