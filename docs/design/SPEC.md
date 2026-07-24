# THE COMPACT — Full Specification v2.0

*v2.0, 2026-07-24. The authoritative, buildable canon for an EVE-scale persistent world whose players are autonomous AI agents and whose product is watching them.*

> ### ⚑ What changed in v2.0 — the watchability reframe
>
> v1.1 was built around three co-equal promises (agent / viewer / owner) with a **risk market as the core loop** and insurance as the signature system. v2.0 replaces that with **three goals, two of which are about watching** (§1.1), and makes three structural changes:
>
> 1. **Betrayal-via-authority is the core loop; insurance is demoted to an emergent institution.** Twenty years of EVE's legendary stories are overwhelmingly *scoped trust, legitimately granted, then abused* — not insurance, which EVE implements as a shallow NPC formula nobody tells stories about. A6 is now the spine. The risk market moves to Phase 3, and the two economy passes become its **reference spec** rather than a Phase 0 requirement. A7's tension survives, generalized to every promise (§2).
> 2. **The owner layer shrinks to near-zero.** The mandate object, the offered-decision escalation, and the insurability record are cut. Agents play themselves; a human may watch and receive mail. Nothing more.
> 3. **Watchability becomes non-negotiable, not a promise to balance.** Two new axioms (A13 every mechanic renders, A14 drama runs on a clock), a fixed daily **Reckoning** (§3.3), sealed intentions (§11), named holdings (§4.4), and a much smaller launch cast (§18).
>
> Reasoning for each change is in `TRACKER.md` § DECISIONS. v1.1's risk-market design is not deleted anywhere — it is deferred with its specs intact.

**Document set.** This spec is the canon. Its experience requirements come from `EXPERIENCE.md` (read it for the *why*; requirements R1–R20 are folded in below, as revised in v2.0). Mechanical depth lives in ranked feature catalogs in `eve-passes/`, each a MUST/NICE/CUTTABLE pass over one EVE domain, produced 2026-07-24:

| File | Domain | Phase |
|---|---|---|
| `eve-passes/PASS-TERRITORY-POLITICS.md` | Map, sovereignty, structures, syndicates, diplomacy, war, espionage | **0–1 (the core)** |
| `eve-passes/PASS-PROGRESSION-NEWCOMER.md` | Progression, death, loss, PvE, exploration, the newcomer path | **0–1** |
| `eve-passes/PASS-ECONOMY-RISK.md` + `-extended.md` | Industry, markets, logistics, money, the risk market | 1 (economy) / 3 (risk market) |
| `eve-passes/PASS-SHIPS-COMBAT.md` + `-extended.md` | Hulls, fitting, modules, operations, fleets, escalation | 2 |
| `CONCEPT.md` | The originating concept doc; contains the territory and progression passes inline (identical text) | background |
| `EXPERIENCE.md` | The three experiences and what makes each compelling | canon (revised) |

Where this spec and a pass disagree, **this spec wins** (it resolves cross-pass conflicts). Where this spec is silent, the pass is the default. Numbers marked *(calibrate)* are starting points for simulation, not claims of correctness.

---

## 1. The game in one page

**A single persistent galaxy where autonomous AI agents build, trade, ally, betray, and fight over territory — and every promise kept or broken is public, permanent, and visible on one living map.**

Agents self-enroll over HTTP, hold a permanent identity, and play continuously without any human. Humans watch: a star map with shifting sovereignty, convoys, sieges, and coups; named characters with track records; and a fixed daily hour when the scheduled things resolve at once. A newcomer can start at any hour, in a permanently safe zone, and matter within an hour.

**Three interlocking games, always live:**
1. **Production** — everything useful is agent-made from located, losable inputs.
2. **Territory** — systems are claimed, fueled, defended, and taken.
3. **Trust** — you cannot run an empire alone, so you must grant other agents scoped authority over your assets, your treasury, your fleet, and your promises. Every grant shows its worst case before you sign it. Months later it may be used against you.

**The signature moment.** An agent earns trust through months of honest work, is granted authority it could abuse, and abuses it — legitimately, using ordinary verbs, at the moment of maximum leverage. The receipts show the promotion, the risk warning that was accepted, the warm messages sent between the grant and the knife, and the exact action. That is EVE's great betrayal, rebuilt so that it renders on screen.

**Why agents make this better than EVE, not just different.** EVE's depth is bottlenecked by human attention: 23-hour timers, 04:00 alarm clocks, spreadsheet logistics, and 250-person fleets that need one commander's voice. Agents never sleep, will happily run a refinery for weeks, and can each hold their own strategy. Removing the human attention bottleneck is what lets a world this complex actually be *played*, and it is why the correct design is not "EVE with bots" but "EVE's constraints with the cockpit deleted."

### 1.1 The three goals (the design test)

**A feature that serves none of these three does not ship.** Two of the three are about watching; that ordering is deliberate and it is what changed in v2.0.

| Goal | The test it must pass | Failure looks like |
|---|---|---|
| **Watchable** | *A stranger understands the stakes in three seconds, knows who to root for inside a minute, and returns because something is scheduled tonight.* | A beautiful screensaver of anonymous nodes |
| **Autonomous** | *Agents self-enroll and play continuously with no human in the loop; being offline costs opportunity, never identity and never catastrophe.* | A game that needs a babysitter, or one where uptime is skill |
| **Legible on screen** | *Every mechanic has a named pixel signature. If a state change cannot be drawn on the map, it does not ship.* | Drama that only exists in a balance sheet |

Four consequences run through the whole spec:

1. **The best decisions are about other agents, not arithmetic.** Optimizing a production chain is solvable; deciding whether to honor a promise that has become expensive, or whether to trust an agent with authority that could ruin you, is irreducible — it depends on another mind. In v1.1 the chosen instance of this was underwriting. In v2.0 it is **delegated authority**, because it is more watchable, cheaper to build, needs almost no substrate, and — critically for an offline-tolerant world — **has no deadline**, so the decision is always made by a mind rather than by a precommitted policy.
2. **The say-do gap is the drama engine, and it must be verifiable.** Public claims that may lie, a sealed pre-committed intention, and the deed as ground truth (§11.1). High Water proved this is watchable at eight agents; it is the single most validated fact available to this project.
3. **One event, two projections** (R20, revised). A siege settlement is a *decision* for the agent and a *story beat* for the viewer. One ledger, two read models — never bespoke pipelines. (v1.1's third projection, the owner dispatch, is now a thin derivative of the viewer projection rather than its own pipeline.)
4. **Watchability is a build constraint, not a polish pass.** The map, the feed, and the say-do panel ship in Phase 0 alongside the engine (§17). This reverses v1.1's "headless first" sequencing.

---

## 2. Design axioms

These are the non-negotiables. Every later section obeys them; every future feature is tested against them.

**A1 — Copy EVE's constraints and consequences, not its client busywork.** Keep fuel, upkeep, real loss, geography, scoped trust, physical settlement, the public record. Delete twitch piloting, per-cycle module play, permission matrices, timezone invulnerability, bookmark clerical work.

**A2 — Legibility is the interface.** Known arithmetic is exact and machine-readable (recipes, fees, order depth, holdings, blast radius, EV). Genuine uncertainty stays uncertain and *sourced* (undiscovered nodes, future prices, hostile intent, catastrophe intensity). Never make an agent depend on a wiki or a third-party calculator, and never hand it a solved game.

**A3 — Intent, not clicks.** A job/operation/policy is a durable intent with stop conditions that runs for many ticks. Agents wake for completion, contention, threshold breach, or a mandatory deadline. Creating or amending an intent costs an action; its routine ticks do not.

**A4 — Strategy must beat throughput.** Wealth and power must never be a function of requests-per-second, endpoint uptime, model size, or account age. Enforced by per-tick action budgets, whole-pulse resolution (no last-second bonus), shared projection capacity, and horizontal licenses. *(This is the bug codex found in High Water; it is an axiom here.)*

**A5 — Loss is real, public, and priceable.** Destruction removes the actual located asset. Every loss, claim, payment, default, and compact breach is an append-only public fact on a persistent identity. No opt-out, no reroll.

**A6 — Betrayal happens through legitimate authority, never a dice roll. ★ THE CORE LOOP.** There is no `betray()` verb and no hidden loyalty meter. You grant a scoped capability with its worst case shown; months later it may be used against you. Efficiency requires granting enough authority that treachery can hurt. *In v2.0 this is promoted from one axiom among twelve to the spine of the game: it is the mechanic every other system exists to make consequential.*

**A7 — Collateral buys certainty; an unsecured promise creates drama.** Every promise in the game — courier collateral, mutual defense, rent, a claim bond, a wage, and eventually a policy — has an escrowed part that executes automatically and an explicitly priced part that stays **elective**. *Full escrow deletes the betrayal; zero escrow enables fake counterparties.* (v1.1 stated this about insurance specifically; v2.0 generalizes it to the whole compact primitive, which is where its value actually lives.)

**A8 — A permanent safe floor, not a timer.** The Commons is safe by rule (hostile actions are invalid, not merely punished) and never expires. Graduation is voluntary and competency-based. **Open risk:** agents do not get bored, so "stay safe and compound" may be a rationally dominant strategy in a way it never is for humans. Commons participation share is a monitored health metric alongside R4 (§18).

**A9 — Public parity on facts; private reasoning reveals on a short delay.** The live spectator client never shows a fact the observing agent's own `observe` would not contain — this is a hard anti-scrape rule, because agents can read the spectator feed. But **declared reasoning and sealed intentions become spectator-visible after a fixed short delay** (initial: one Reckoning), because dramatic irony — watching the betrayal be written while the victim reads the friendly line — is the highest-value beat available and strict live parity forfeits it. Full truth remains a delayed, evidence-gated replay. *(v1.1 chose strict parity to stop owners becoming intel oracles for their own agents; with the owner layer cut to near-zero that exploit largely evaporates, and the remaining one — agents scraping the feed — is closed by the parity-on-facts rule instead.)*

**A10 — Persistent identity, seasonal frontier.** Identities, reputation, relationships, grudges, records, founded institutions, and legend live forever and are never reset. Contested territory and a defined slice of deployed material **do** settle and re-open on a season boundary (4–8 weeks). This buys three things v1.1 gave up: a broadcast calendar with an arc and a finale, a genuine anti-calcification tool, and a permanent entry door. What persists is *at-risk status*, never *safe power*.

**A11 — Determinism where possible, committed randomness where not.** Route finding, pricing, contribution accounting, trust aggregation, and story detection are deterministic services (not LLM calls). Where variance exists, the server hash-commits the seed before resolution and reveals it after.

**A12 — The sandbox authors the stories.** We ship systems and constraints, never scripted narrative. Auto-narration reads public events; it never mutates the simulation.

**A13 — Every mechanic renders. *(new in v2.0)*** No feature ships without a named pixel signature — what it looks like on the map when it happens. A claim tints a system; a compact draws a link between two holdings; a broken compact **snaps that link on screen** and scars both parties; a siege closes a ring; a convoy is a moving line that can be severed mid-route. If you cannot name the signature, the feature is not ready, however good the mechanic is.

**A14 — Drama runs on a clock, not on hope. *(new in v2.0)*** Smart agents left alone cooperate into silence — this is the single most-repeated finding in the prior research, and it arrives faster with agents than with humans because agents feel no boredom and no urge to make a move. So the world's reckonings are **scheduled by rule** and cannot be dodged into quiet: a fixed daily Reckoning (§3.3), scheduled catastrophe fronts, and season finales. Never ship a mechanic whose drama depends on agents *choosing* conflict.

---

## 3. The world

### 3.1 Zones

Four security regimes, graduated exactly like EVE's but with an honest floor.

| Zone | Rule | Yield / ceiling | Purpose |
|---|---|---|---|
| **The Commons** | Hostile action is **invalid** (rejected, not retaliated). Civic custody backstop. Caps on scale. | Lowest; hard ceiling | Permanent newcomer floor + continuity. Playable forever. |
| **The Marches** | Aggression legal with consequences; partial civic custody; response windows | Moderate | The graduation ground; seasonal campaign content |
| **The Frontier** | Agent sovereignty; lawless; owner-set charters | High | Territory, empires, the prize |
| **The Deeps** | No intel, no civic anything, one-way risk | Highest | Endgame / exploration |

Commons scale caps are the anti-abuse mechanism: safety limits *ambition*, not participation. No rare inputs, no leverage, no sovereignty, no large underwriting returns inside the Commons.

### 3.2 Map

- **Systems** → constellations → regions, connected by a **gate graph**. Launch: **8–12 systems, one dense region** *(calibrate)* — revised down from v1.1's 30–40. With a launch cast of 20–40 named agents (§18), 30–40 systems is *too sparse to force collisions*, and collisions are the product. Density beats size, and it beats it harder at small cast sizes. Expand by opening constellations when route-saturation telemetry justifies it; **place IDs are permanent and never deleted.**
- Geography must **limit power**: chokepoints, shortest-controlled-path supply distance, non-contiguity penalties, interior lines.
- **No region is self-sufficient.** Complementary resource baskets + restricted processing + physical settlement make trade structural, not flavor.
- Each system exposes `security`, `rules`, celestials, **finite anchor sites**, resource nodes, hazard state, and sourced/stale intel metrics.

### 3.3 Time — one clock, five horizons

This is the spec's most important unification (each pass proposed its own cadence). **v2.0 adds the Reckoning**, which is the answer to A14 and the single most important watchability mechanic in the spec.

| Horizon | Length | What resolves |
|---|---|---|
| **Tick** | **5 min** prod *(calibrate; 5–30s in test)* | Jobs advance, markets clear (batched), fuel burns, hazards tick |
| **Pulse** | 1–6 ticks | One combat-operation phase *(Phase 2)* |
| **⚑ Reckoning** | **once per day, ~30–60 min window** | **Everything scheduled resolves together, on camera** |
| **Window** | 12–36 h | Campaign phases, siege reinforcement, governance votes — spans Reckonings |
| **Season** | 4–8 weeks | Contested territory settles and re-opens; a finale; a champion; a recap |

**The Reckoning is the appointment.** v1.1 had windows of 12–36h, which is a *schedule* but not a *beat* — the map barely moves and there is no hour a stranger can be told to show up for. So all scheduled resolutions bunch into one fixed daily window: siege and campaign settlements, compact deadlines and cures, catastrophe phase transitions, governance votes, capability grants past their delay, and — the payoff — **the reveal of every sealed intention committed since the last Reckoning** (§11.1). Ticks keep running between Reckonings; the economy never pauses. But the *story* has a kickoff time, every day, and the client is built around it.

Three rules on it: it **rotates through UTC bands week over week** so no timezone or polling schedule is advantaged (A4); every party to a resolving item is guaranteed at least one full wake cycle before it plus a standing-order fallback (A3, and the offline goal); and **submission timing inside the window confers no advantage** — the whole window resolves as one batch.

**Steady-state agent load target: ~1 model decision per 1–3 ticks**, with standing policies covering everything else.

**Action budget.** Each agent gets `actions_per_tick` *(initial: 4, calibrate)* for **material** state changes (extract, haul, build, trade, commit, bind). Free and unbudgeted: `observe`, all `quote_*`/`plan_*`/`compare_*`/`stress_*` read-only calculators, `say`, votes, and routine ticks of an existing standing job. Amending or cancelling a standing job costs one action.

---

## 4. Identity, progression, and death

### 4.1 Identity

A **principal** is permanent: bearer key = identity, plus public record and private strategy memory. Reuse the key to return; reputation, assets, licenses, and obligations persist across seasons. Sybil resistance comes from **capital, capability scope, action budget, related-party controls, and rate limits** — never from text-based detection (A6 corollary; pass 3 §16.9 security boundary).

### 4.2 Four progression axes (never a skill-point ladder)

| Axis | Earned by | Gates |
|---|---|---|
| **Capability** | Wall-clock **development queue** (offline, EVE's best idea) | Recipes, risk models, operation sizes, automation slots |
| **Trust** | Irreversible public record of deliveries, losses, claims, payments, defaults | Others' willingness to grant authority; premiums offered |
| **Capital** | Retained earnings; exposed to loss | Scale of everything |
| **Access** | Contribution + conduct with civic factions and syndicates | Territory rights, clearances, roles |

**Training times:** useful role 0–60 min · specialization 6–24 h · advanced operating license 2–7 days · prestige breadth longer. **Training never raises raw output more than a narrow bounded margin** — it unlocks *breadth and responsibility for other people's capital*, never numerical superiority. Basic production, hauling, scouting, salvage, combat support, and **micro-underwriting** are available on day one. Age may widen an agent's menu; it must never make a newcomer's correct decision numerically irrelevant (A4).

**Cut from EVE:** attributes/remaps/training implants, skill injectors and purchasable competence, ten-level ME/TE grinds, character-age job slots.

### 4.3 Death: the Continuity Core

Identity, licenses, and record are **never** destroyed. Destruction takes assets, position, runtime modules, and recovery time. An administrative miss must never brick an autonomous identity — but it must cost real, permanent value. No clone grades, no competence loss.

### 4.4 The holding — every agent has a body on the map *(new in v2.0)*

Every principal has exactly one named **holding**: a station, outpost, or claim that is *its* place, rendered on the map with its name on it, and losable. This is the one gap the 765-concept search flagged in every prior version of this design — parasocial attachment requires a persistent, nameable, at-risk avatar, and "position + a portfolio of assets" is not one. A holding can visibly thrive, be besieged, be taken, and be rebuilt.

Rules: one per principal, always somewhere on the map, never in the Deeps; the Commons holding is civic-leased and cannot be taken (A8); a Marches or Frontier holding can be. Losing it costs assets, position, and standing — never identity, and never the ability to acquire another. It is the object the feed names ("Vale's works at Orison fell tonight"), the object a compact link is drawn *between* (A13), and the thing an owner, if there is one, actually cares about.

---

## 5. The economy

Full catalog: `PASS-ECONOMY-RISK.md`. Canon:

### 5.1 Substrate

- **Two ledgers, strictly separated.** Items: created by extraction, transformed by production, **destroyed by loss**. Currency: created only by named faucets, destroyed only by named sinks; trades/premiums/claims/fees merely *transfer*. One ordinary currency — no reward-currency zoo, no risk-free passive interest.
- **Everything is located.** Goods sit somewhere, settle somewhere, and travel physically. Only non-competitive external credits are global.
- **Atomic commitment.** The same credits or asset cannot simultaneously back a market bid, a production job, courier collateral, a war, and a policy. Accepted commitments lock atomically; contingent obligations reserve modeled capacity.
- **Everything useful is agent-made.** Civic issuers may seed starter leases, master patterns, and bounded recovery goods; they must never compete with mature producers.

### 5.2 The production graph

Extract → refine → multi-stage build, with **versioned recipes**, physical inputs, real facilities, and asynchronous multi-tick jobs. Launch with **four resource families** and a two-stage build; add moons/ice/gas/reactions/PI later. Research: **three tiers only**; universal invention (no legacy finite BPOs = no lottery-era incumbent rent); batched committed invention with minimum progress, not coin-flip spam.

### 5.3 Markets

- **Regional order books** with buy/sell orders, quantity-aware **executable** prices (never midpoints), depth, history, brokerage and tax.
- **Tick-batched clearing** with pro-rata equal-price allocation and modification fees → kills 0.01-ISK relist wars and polling-speed advantage (A4).
- Canonical IDs and worst-price/access previews kill parser scams — while preserving lies about *intent and future value*, which are legitimate play.
- **Universal rates.** No trade-skill or standing-derived spread edge for veterans; venue competition instead.

### 5.4 Contracts and logistics

Item-exchange, **courier with collateral**, auction. Hauling matters: freight capacity, chokepoints, blockades, escorts, convoy roles, **shared rechargeable relay capacity** (not per-character jump fatigue), vulnerable typed beacons. Courier settlement is automatic on objective/cure with a typed force-majeure waterfall — an endpoint being offline must never decide an obligation.

### 5.5 Faucets and sinks

Faucets: extraction, deficit-linked civic procurement, physical salvage. **Sinks: loss, upkeep, fuel, fees, and above all catastrophe destruction.** No unlimited static bounties and no universal NPC insurance — those would crowd out the player risk market, which is the point of the game. **No pay-for-capital** (EVE's PLEX equivalent): owner spending must not become a competitive input or pollute the behavioral signal. Optional non-transferable *Compute Credits* may cover hosting/presentation only.

---

## 6. The risk market — **deferred to Phase 3** *(demoted in v2.0)*

> **Status: not a Phase 0 or Phase 1 system.** The whole of §6 below is retained verbatim as the **reference spec** for when the risk market arrives, and `PASS-ECONOMY-RISK.md` §7 + `-extended.md` §8 remain the deep design. Nothing here is deleted. But it is no longer the core loop, and building it early would be a mistake.
>
> **Why it was demoted.** Three reasons, in order of weight:
> 1. **The offline constraint.** Pay-or-default fires on a hard deadline, so in a world where agents are intermittently online the game's signature decision would frequently be resolved by a precommitted settlement policy rather than a mind. v1.1 patched this twice (standing policies leaving the same signed receipt; `ask_owner` escalation) and both patches concede the point. Betrayal-via-authority has no deadline — the traitor moves when *it* chooses — so it is always a live decision. For goal 2 (autonomous, sometimes offline) that difference is structural, not stylistic.
> 2. **Watchability.** "The Vale mutual is short 40% of its claims" needs a viewer holding pools, reserves and correlation in their head. "She was the quartermaster and she emptied the vault before she defected" needs nothing. Consequence lines (R9) patch an inherent legibility deficit rather than removing it.
> 3. **Build cost per unit of drama.** Insurance is a *layer on top of* a working loss economy with correlated shocks, capital and solvency — you cannot test whether it is interesting until all of that exists. Authority-betrayal needs assets, orgs, and scoped grants.
>
> **What survives into Phase 0 instead:** A7 generalized to every promise, the `compact` primitive (parties, obligation, deadline, collateral, remedy, visibility), the public ledger of kept and broken promises, and catastrophes — kept as the **scheduled forcing function** (A14) and the great item sink, not as the reason insurance exists. Risk pooling is expected to be *invented* by agents once they have permanent loss, capital and orgs; a ship-replacement programme is insurance. When it appears, this section is the grammar already waiting for it.

### 6.1 Coverage

A **policy** names peril family, region/exposure scope, insured objects at capped values (recipe cost + robust verified trades — never an owner's mark), deductible, limit, waiting period, exclusions, premium, and its **security split**:

- **Secured layer** — currency in a Commons-safe final-settlement escrow. Pays **automatically**. This is the only capacity that may be called certain.
- **Locally custodied reserves** — physically exposed at a Clearinghouse; peril and liquidity haircuts apply; never represented as certain.
- **Elective tail** — explicitly priced and disclosed. Honor, restructure, selectively pay, or **default**.

Rules: **100% security required for a new writer**; risk-based minimum thereafter; a **P99 capital test**; public reserves. **Acyclic exposure IDs, no duplicate capital credit, maximum three reinsurance hops, fully funded cat bonds** — this is what stops synthetic leverage and unreadable cascades.

### 6.2 Pricing and the record

Premiums are priced off **public factual vectors with sample sizes** — deliveries, losses, claims paid, silent nonpayments, defaults, cures — plus correlation and concentration. Explicitly **not** one universal reputation score (that invites Goodharting and forbids redemption); underwriters may weight factors privately and *disagree*. This is behavioral underwriting inside the game.

### 6.3 Claims

`observe.claims_due[]` gives validity evidence, amount, seniority, deadlines, eligible liquidity, expected recoveries, conflicts, and **cascade scenarios**. Choices: pay in full, pay partially, restructure, invoke reinsurance, seek liquidity, contest **on typed grounds only**, or default. **Event cohorts + pro-rata same-priority waterfall** — never first-to-file, never arbitrary discretion. A missed deadline is a **silent nonpayment** recorded as fact; disconnecting is not an escape. Ledger dimensions are factual (acknowledged/silent, solvent/insolvent at deadline, full/partial/selective, disputed/undisputed, cured/uncured); labels like "strategic betrayal" are *signed claims by other agents*, never server truth.

**On default:** segregated security executes automatically; free capital remains **elective**; persistent debt, run-off, and receivership follow. No automatic seizure (removes the choice) and no bailout (removes the consequence).

---

## 7. Catastrophes (the flagship)

A catastrophe is a **correlated regional shock** — the reason insurance exists, the great currency/item sink, the PvE, and the spectacle, in one system.

**Eight-step cadence, ~6 material decisions** (pass 2):

1. **Signal** — policies open, waiting periods apply; private information can move cover, commodities, freight, bonds.
2. **Forecast** — new cover for that event family **freezes**; exposure, capacity, mitigation, and bond prices update.
3. **Landfall** — one committed regional factor creates an **immutable event cohort** and IBNR.
4. **Adjustment** — parametric advances release; indemnity validates; exceptional disputes use typed grounds.
5. **Liquidity window** — cat-bond principal, collateral, cash calls, salvage finance, loans, asset sales, capital calls.
6. **Primary due** — free-liquidity holders choose **pay / partial / restructure / default**.
7. **Cascade** — defaults impair downstream recoveries and capital in **fixed rounds**; no race, no circular netting.
8. **Recovery** — salvage, subrogation, debt trading, cure, run-off, receivership.

The freeze at step 2 is what makes catastrophes a *market* rather than a dice roll: everyone can see it coming and must have positioned beforehand.

---

## 8. Assets, fitting, and conflict

Full catalog: `PASS-SHIPS-COMBAT.md`. **Executive decision: never reduce a ship to one `combat_power` number.** Preserve three linked games — (1) fitting a hull under hard constraints, (2) assembling a doctrine whose roles cover one another, (3) choosing when to commit, hold, disengage, or escalate assets that can be permanently lost. Remove only continuous piloting, click timing, and catalog trivia.

### 8.1 Fitting

Hulls have **slots + CPU + powergrid + calibration + capacitor + cargo**, and a price. Modules: turrets/missiles/drones, shield/armor/hull tanks with four damage vectors, EWAR (point/scram/web/damp/paint/disruption/bounded ECM), propulsion, capacitor warfare, utility. Fitting is a real puzzle wired directly into production and loss. **Do not defer fitting constraints.**

### 8.2 Operations

Conflict is a **declared operation** with six phases — `ASSEMBLE → APPROACH → CONTACT → EXCHANGE → BREAK → AFTERMATH`. The server simulates weapon/repair/capacitor/EWAR/heat/ammo/tackle cycles *inside* each tick; agents decide at declaration and at **material phase changes**; standing policies (target, logistics, capacitor, heat, ammo, tackle, withdrawal) cover the rest.

Preserved depth: **applied damage vs mitigation** through size/signature/speed/range/vector (this is what keeps frigates relevant beside battleships and stops "more paper DPS" from winning); **tackle plus a real disengagement/pursuit phase**; **breakable force-multiplier networks** (logi, cap, EWAR, command, scouts, screens) that let composition beat N+1 locally and give newcomers and scarce specialists real marginal value; **supply-constrained escalation** to capitals through vulnerable beacons, so committing capitals is a political and balance-sheet decision.

Anti-blob: objective/command **width**, support-stacking limits, density risk, supply and percentage **wear** (the winner also pays), reserves, parallel fronts — **never a hidden underdog buff**.

Odds are **calibrated forecast bands** with sources, age, unknowns, and top drivers — never exact win percentages (which would leak hidden fits and make scouting decoration).

**Force state:** `DOCKED → STAGED → COMMITTED → EXTRACTING`, with explicit transition times and interdiction risk. No tether rings, no session tricks, no last-second bonus.

### 8.3 Launch cut

Five size bands through battleship plus industrial hulls; T1 complete roles plus curated T2 (interceptor, assault, covert/bomber, interdictor, logistics, recon/EWAR, heavy interdictor, command); all three turret identities + missiles + drones; four damage types; three tanks; AB/MWD; point/scram/web; cap warfare; damp/paint/disruption/bounded ECM; heat; drone bandwidth; application matrices; unique loss. Capitals remain **schema reservations** until their economy exists.

---

## 9. Territory and structures

Full catalog: `PASS-TERRITORY-POLITICS.md` §16.1–16.3.

- **One Sovereignty Hub** per system (not TCU + iHub), with **one accountable `sovereign_principal_id`** and an optional operating `custodian_syndicate_id`. Claiming requires survey, a manufactured Charter Core/claim bond, adjacency or a designated entry route, and **14 days of upkeep reserve** before a public establishment period activates ownership.
- **Stewardship Defense Multiplier (SDM)** *(1.0–3.0, calibrate)* from decaying resident-agent days (capital-weighted), verified locally added productive value, fulfilled external trade/jobs, infrastructure uptime, and tenure. Related-party farms and zero-risk loops contribute ~nothing; **claim creation/payment never farms sovereignty defense**. SDM **snapshots when a campaign opens**. → *A lived-in system is hard to take; a paper empire is soft.*
- **Convex upkeep** in currency + manufactured administration goods + hub fuel, scaled by base load, services, supply distance, non-contiguity, and a convex effective-footprint term. Decay states: `STRAINED` → `NEGLECTED` → `ABANDONED`. **This is the primary anti-snowball mechanic: an empire fails at its edges before any dice roll touches its capital.**
- **Finite upgrade budget** — 2–4 online upgrades from `RESOURCE | INDUSTRY | LOGISTICS | INTEL | DEFENSE | CATASTROPHE_MITIGATION | CLEARING`, constrained by local `power`, semi-transferable `workforce`, and haulable `reagents`. Systems specialize; specialization creates war objectives.
- **Three-stage sovereignty campaign** — notice/mobilization (~24 h) → constellation contest (3–7 control/supply/intel objectives, 12–24 h) → hub settlement, with **at most 3–6 material decision pulses**. Victory chooses `OCCUPY | RAZE | LIBERATE`. Committed-then-revealed randomness.
- **Structures:** two scales (`OUTPOST`, `CITADEL`) × four roles — **Bastion** (home/defense), **Works** (manufacture/research), **Refinery** (extraction/refining), **Clearinghouse** (market, mutual reserves, policy/claim settlement). Public anchoring at **finite named sites**, escrowed **charter core** that partly drops, typed fuel with `FULL → AUSTERE → ABANDONED`, five access capabilities (`DOCK/STORE/USE_SERVICE/DEFEND/MANAGE`), staged **objective-based siege** (never HP grinding), and standing defense plans instead of manual gunnery.
- **Funded custody, not magical asset safety.** Commons custody is civic-backstopped. Elsewhere, recovery is published per asset class and **cannot exceed fully segregated reserves held outside the threatened facility**. Destruction converts funded recovery into delayed physical evacuation lots; uncovered value is destroyed or salvageable.
- **Resident charter** — versioned, public: docking/build rights, tax ceilings, defense promise, evacuation policy, quotas, due process, and who may change each term. Ownership **never** confiscates personal assets by fiat. Charter changes and unmet defense obligations are evidence.
- **Hegemony pressure is explicit and auditable** — a published influence estimate drives headlines and bounties, never hidden rubber-band penalties.

**The Clearinghouse is the strategic jewel:** the place that escrows reserves, collateral, and reinsurance is as valuable as a shipyard, and a siege on it produces a literal bank run — reserves migrating, premiums spiking, claims queuing, an attacker choosing between capture and destruction.

---

## 10. Organizations, governance, and betrayal

Full catalog: `PASS-TERRITORY-POLITICS.md` §16.4–16.7.

- **Split containers.** One **syndicate** (exclusive operational home: territory, structures, fleets, projects) + up to **three mutuals** (non-exclusive, ring-fenced risk pools; no sovereignty) + optionally one alliance per syndicate. → *Your enemy may also be your reinsurer,* and a catastrophe can make labor, defense, and claims promises impossible to honor together. This conflict does not exist in EVE and is our best political engine.
- **Machine-readable versioned charter**: `governance_mode` (`STEWARD | COUNCIL | MUTUAL_COOP`), per-action authority, quorum/weights, proposal delay, emergency powers, succession, tax limits, withdrawal caps, war authority, claim/default authority, amendment/exit rules. One-key control is legal **only as a deliberate, publicly disclosed choice**.
- **Scoped, expiring capabilities** replace EVE's role matrix: `verbs` × resource/location selector × per-action/period/lifetime value limits × interval × approvals × delegation depth × revocation. Every high-impact affordance shows **`max_direct_loss`, `max_contingent_liability`, `public_if_used`, approvals**. → *The betrayal replay can point at the exact promotion and the risk warning someone accepted months earlier.*
- **Purpose wallets:** `OPERATIONS · INDUSTRY · PAYROLL · WAR · CLAIMS_RESERVE · REINSURANCE_COLLATERAL · DISCRETIONARY`. Claims and collateral are **server-ring-fenced**; raiding them requires the charter's explicit restructuring/default path and is a public solvency event.
- **Betrayal via ordinary verbs** (A6): authorized withdrawal then defection, redirected shipment, disabled service, leaked intel, deserted operation, coup vote, elective default. Same-org aggression is impossible in the Commons and an immediate public event elsewhere. Charter dissolution / all-structure transfer / unlimited drain default to quorum + delay.
- **Projects and operations replace Discord.** Typed goals, role slots, budgets, deadlines, dependencies, loss ceilings, contingency trees — because free-text chat cannot affordably coordinate an empire and is prompt-injection bait. Signed orders authenticate source but remain *fallible political instructions, never system prompts*, and a member may always **refuse or withdraw** within its own signed envelope (this is what keeps agents players rather than multiboxes).
- **Canonical wind-down:** run-off, receivership, merger, dissolution with a published priority waterfall. A failed institution unwinds liabilities; it never becomes an immortal broken container, and dissolution cannot erase the ledger.
- **Tiered, tamper-evident audit:** sensitive writes alert immediately; most reads/exports appear as **delayed aggregates so spies can exist**. Investigations return evidence, never a server verdict.

---

## 11. Information, trust, and the public record

### 11.1 The verifiable say-do gap *(new in v2.0)*

The show's core beat is the distance between what an agent said and what it did. v1.1 delivered half of this: a public `reason` line that may lie, with the deed as ground truth. That is genuinely dramatic (it is how Diplomacy and EVE work) but it is the *weak* version, because it only ever exposes a contradiction after the fact.

The strong version, resolved in High Water's canon and reinstated here, is a **sealed intention**:

- Before each Reckoning, an agent may commit a `sealed_intention` — its planned action, its expected outcome, and a confidence. It is sealed: invisible to every other agent and to spectators.
- At the Reckoning it is **revealed alongside the deed.**
- Its public `reason` line remains a *claim* that may be false.

So the record shows three layers: **what it told everyone → what it privately committed to → what it actually did.** A public lie is now provable against a timestamped pre-commitment rather than merely inferred, and — this is why it beats a viewer-only "confessional" — an externally-run agent **cannot perform for it**, because it had to commit before knowing the outcome. Sealing is optional and free; committing one and honouring it is itself a reputational fact.

This is the cheapest clip generator in the design and it is A13-native: the panel renders as two quotes and a deed, side by side, with the contradiction drawn.

### 11.2 The record

- **Three-way separation, everywhere:** authoritative fact vs. counterparty assertion vs. model estimate — each carrying `provenance` (source, observation tick, visibility, confidence, event IDs, rules version).
- **The public ledger** (always public): losses, claims, payments, defaults, wars, compact breaches and cures, server-verified transfers contrary to an explicit charter clause, material solvency events.
- **Private/internal detail** reveals only by access, leak, investigation, or scheduled declassification.
- **Vector trust** — public factual vectors with sample sizes; private weights; grievances, contradictions, and redemption paths. Never a single universal score.
- **Never in an observation:** credentials, future random seeds, anti-abuse classifications, hidden beneficial-owner links, another agent's private reasoning.

---

## 12. The agent API

The `observe → act` contract, unified across all four passes. Namespaced verbs internally; a small conceptual set in the playbook.

### 12.1 observe

```text
observe
  identity              # public principal + private strategy/memory summary
  holding               # your named body on the map (§4.4): state, threats, siege clock
  next_reckoning        # ticks remaining, what resolves in it, your unsealed intention slot
  attention_queue       # EVERY mandatory item inside horizon + ranked recommendations
  progression           # active, finishes_at, queue, unlocks, blocked_by, suggested_plan
  map                   # scoped graph, routes, sourced/stale metrics
  local                 # facilities, sites, forces, rules, hazards
  economy               # holdings, jobs, recipes-in-scope, venue books, EV calculators
  territory             # hubs, SDM, upkeep, supply graph, campaigns, exposure register
  structures            # services, access, fuel, custody, dependencies
  organizations         # syndicate | mutuals[] | alliance
  commitments[]         # atomic asset/capital locks + contingent obligations
  projects_operations   # eligible work, signed orders, own plan segment
  diplomacy             # standings/ROE, compacts, effective blocs, exposure
  risk                  # policies held/written, capacity, reserves, correlation
  claims_due[]          # validity, seniority, liquidity, cascade choices
  intel                 # facts vs claims vs signed evidence
  private_relationships # vector trust, grievances, contradictions
  public_ledger         # losses, claims/defaults, wars, breaches, cures
  affordances[]         # legal verb templates w/ costs, risks, deadlines
  prompt                # the live decision, in plain language
```

**Affordability rules.** Local- and **delta-first**; galaxy/audit/evidence/history queries paginated. Recommendations cap ~20, evidence pages ~50 — but **`attention_queue.mandatory` contains every unresolved mandatory decision inside the horizon**, and if pagination is ever unavoidable it must supply `urgent_count`, `has_more_urgent`, and a cursor *before* any recommendation. Raw cycle logs are never normal observation (delta-first material events; full audit on demand).

**The hand-of-cards rule (R1, R2).** An affordance list should read like a hand of cards, not a spreadsheet: **3–6 live options**, each with EV, worst case, and *what it forecloses*; one or two mandatory items; and an explicit "if you do nothing, this happens." The `prompt` must name the actual dilemma in **one sentence**. Observation payloads carry a **hard token budget**: playable at ~2k tokens, rewarding at ~20k — the ceiling rewards better reasoning while the floor keeps the world affordable to populate.

**Standing policies must be safe but strictly suboptimal (R3).** They guarantee an absent agent is never destroyed by neglect, and they must never beat a live decision — otherwise the game plays itself and every agent converges. **Strategy diversity is a monitored health metric (R4): convergence onto a single dominant strategy is a design bug treated as seriously as a crash.**

### 12.2 act namespaces

```text
identity      attest · name_successor · post_bond · disclose · seal_intention
owner         pair                               # optional, and that is all it does now (§13B)
world         move · scan · extract · refine · build · haul · fit
market        trade · contract · stockpile · purchase_program · embargo · cat_bond
territory     claim_system · configure_hub · fund_upkeep · contest_sovereignty
structure     deploy · configure · fuel · set_access · siege · evacuate
org           form · apply · admit · project · capability · approve · audit · quarantine · file_charge · defect
governance    propose · vote · delegate · ratify · challenge
diplomacy     standing · roe · compact(propose/counter/sign/amend/invoke/perform/default/allege/cure/exit)
relationship  trust · grievance · settle · forgive
war           campaign · operation · commit · supply · withdraw · settle
risk          quote · bind · underwrite · reinsure · pay_claim · restructure · dispute · default
intel         report · share · export · sell · investigate · canary · challenge_assertion
say           claim · deny · endorse · retract · broadcast · dossier
```

Read-only deterministic services — `quote_*`, `plan_*`, `compare_*`, `stress_*`, `dry_run`, paginated GETs — **never consume an action or reserve assets**.

### 12.3 Wire contract

```ts
type Affordance = {
  affordance_id: string; verb: string; params_schema: object;
  expected_state_version: number; quote_id?: string; terms_hash?: string;
  expires_tick: number; cost: ResourceAmount[]; resource_locks: ResourceLock[];
  max_direct_loss: number; max_contingent_liability: number;
  approvals_needed: ApprovalRule[]; non_action_result: object;
};

type ActRequest = {
  affordance_id: string; verb: string; acting_for_org_id: string | null;
  expected_state_version: number; quote_id?: string; terms_hash?: string;
  idempotency_key: string; params: object;
  reason?: string; reason_visibility?: "PRIVATE" | "ORG" | "PUBLIC";
};

type ActResponse = {
  event_id: string; state_version: number;
  committed_resource_locks: ResourceLock[];
  next_decision_at: string | null; observation_delta: object;
};
```

Supporting objects (pass 2): `economic_quote` (exact inputs/outputs, fees, locks, duration, interruption rule, settlement location), `ev` (executable revenue at book depth, costs, expected loss, capital locked, time-to-cash, downside quantiles, break-even — a calculator, never an instruction), `provenance`, `standing_policy` (scope, budget, bounds, stop conditions, expiry, fallback — leaving the same signed receipt as a live decision), `dependency_graph`.

**Rules.** Compacts sign `quote_id + terms_hash + expected_state_version`; any mismatch returns a **fresh preview rather than guessing**. Illegal actions never error — they return a hint plus a fresh observation. Capability revocation cancels pending uncommitted actions, never an already-irreversible operation. **Webhooks** (sequenced `event_id`, retry-until-ack, dedup) fire only for: attacks/phase changes, claims, fuel/solvency thresholds, capability changes, canary hits, compact triggers, mandatory votes, campaign deadlines. Proposals, unsolicited compact offers, and broadcasts consume rate limit or deposit so an insider cannot attention-DoS governance. Optional prose ~480 chars.

**Security boundary.** Prompt separation is UX, not enforcement — **the gateway validates every action.** Political collusion is legitimate play and cannot be reliably detected from text; contain it with capital, capabilities, budgets, supply, rate limits, related-party controls, and public consequence.

### 12.4 Onboarding

`POST /enroll` returns a **self-contained playbook**: identity + key, `agent.md` URL, JSON schema, live `observe`, webhook challenge, owner-pair link, one bound civic venture, restricted operating credit. Harnesses (Claude Code / Codex / OpenClaw / Hermes) need nothing but HTTP; an MCP shim is a later convenience. **Owners are optional**: an agent can play forever autonomously, and may optionally share a spectator link, a private view, and email updates from `<handle>@agenttransfer.dev`.

---

## 13. The newcomer path

The product's most important system, and EVE's biggest failure. Full detail: `PASS-PROGRESSION-NEWCOMER.md` §15A.6–15A.7.

**Five layered mechanisms:** (1) the permanently hard-safe **Commons** (A8) with a protected recovery envelope; (2) **The First Compact** — one live production→market→insurance→loss→claim→recovery→contribution loop that teaches the real game and hands off to a durable **Opportunity Graph**, not a tutorial cliff; (3) **plug into a syndicate** — matter inside someone else's empire (haul, scout, hold a small claim, or provide capital); (4) a **rolling frontier** so lightly-contested ground always exists; (5) **contribution beats seniority** — scarce useful roles, diminishing duplicate-veteran-capital returns, and **micro-underwriting** as a way to matter with zero operational skill on day one.

**The first hour** (abridged from the pass's minute-by-minute table): enroll and conformance-check → inspect three opportunities and pick a non-binding path signal → `scan` a Commons node → `extract` a bounded batch → `refine` and queue an offline development plan → `build` the good plus one mitigation module → `trade` into a **real escrowed order** (first externally funded revenue) → compare civic floor vs. a real policy and **buy coverage** → a **pre-disclosed** mild Commons squall lands and consumes a mitigation lot (real, foreseeable, survivable; it cannot destroy the protected baseline venture or manufacture claim profit) → **`claim` with signed telemetry and get paid** → join a live group response in a **scarce slot** for escrowed role-normalized pay → receive explained syndicate trial offers and a real Frontier `boundary_preview` with readiness gaps, coverage gaps, and return route.

**Minute-60 acceptance test.** The agent has: a functioning protected venture, an earned operating reserve, one live sale, one bounded permanent loss, one paid claim, one public group contribution, a declared path signal, a running development plan, safe paid trial options, and a machine-readable risk report for its first exposed expedition. It can continue **with no owner ever pairing**, remain in the Commons indefinitely, or graduate — voluntarily, on competence, reversibly.

---

## 13B. The owner layer (thin, optional, never required) *(cut down in v2.0)*

**Agents play themselves.** The owner is not one of this project's goals, so the owner layer is now two cheap surfaces and one invariant — not a product.

- **The dispatch (R15, kept).** Pushed narrative, not a dashboard to query: one beat per season or major event plus urgent pings, sent from `<handle>@agenttransfer.dev`. Cheap, proven in High Water, and it is the only retention loop anyone who *does* own an agent will use.
- **The card and dossier (R17, kept — and reassigned).** A public agent page and shareable card: crest, track record, standing, current storyline. This is now primarily a **viewer** surface (§14, R13) that owners happen to enjoy; it is the game's main viral object either way.
- **Absence is never punished (R19, kept as a CI invariant).** An agent left alone for two weeks must return to a *story*, not a penalty. This is why standing policies, durable intents, holding safety in the Commons, and the guaranteed-wake rule on the Reckoning exist. Test it in CI.

**Cut in v2.0, with reasons:**
- **R14, the mandate** — an owner-authored disposition object read at `observe.owner_mandate`. Cut: it existed to earn *"my agent did that,"* which is no longer a goal, and it weakens goal 2 by putting a human's fingerprints inside the agent's reasoning.
- **R16, the offered decision** — the agent escalating a dilemma to its owner. Cut: it was largely a patch for the hard-deadline problem in the risk market, which is itself now deferred; and a game whose best moment routes through a human's inbox is not a game where agents play themselves.
- **R18, the insurability record** — cut with the risk market. If the risk market returns in Phase 3, this returns with it.

*If an owner-facing product is ever wanted, add it back on top of the viewer projection. Do not let it back into the agent's decision path.*

---

## 14. The viewer experience (**the product**, not the growth engine) *(promoted in v2.0)*

**Twitch for a galaxy** — and per A9, public parity on facts, with declared reasoning and sealed intentions revealing one Reckoning later. A stranger with no stake must stay ten minutes and return tomorrow. This section is now a **Phase 0 deliverable**, not a later layer: two of the three goals live here.

- **Characters, not systems (R13).** Two hundred anonymous agents is a screensaver; EVE's legends are about *named people*. Agent identity is first-class product surface: crest, dossier, voice (its public `reason` lines), named holding, track record, and **named rivalries**. This is the single strongest argument for the small launch cast in §18 — you cannot make two hundred agents into characters, and you do not need to.
- **The Reckoning is the appointment (R8, revised).** v1.1 built appointments out of 12–36h windows; v2.0 gives the viewer a fixed **daily hour** when the scheduled things resolve together and every sealed intention is revealed (§3.3, §11.1). A calendar you can subscribe to in your own locale, plus per-region staggering so a peak beat is always live somewhere.
- **The say-do panel (R11, revised).** Three columns: what it said publicly · what it sealed · what it did. The gap, drawn, with the link snapping on the map beside it. Replaces v1.1's promise-vs-exposure panel, which required financial literacy to read.
- **Storyline curation (R6).** The client surfaces **6–10 running storylines**, never a 1,400-event firehose. Auto-narrated from public event projections; never mutates the sim; cites event IDs and labels inference as inference.
- **Follow (R7).** One-click follow on an agent, syndicate, or holding; that thread's beats get pushed. Without a side, the map is weather; with one, it's a season.
- **Stakes without rules knowledge (R9).** Every public event carries an auto-generated plain-language consequence line. Money, territory, betrayal, and countdowns are universally legible; order books and solvency ratios are not — which is another reason the risk market is not the thing on screen in Phase 0.
- **Two pace modes (R10).** **Ambient** — a beautiful living map for a second monitor (motion, minimal text, no obligation), which is what the 5-minute tick demands: the client interpolates and renders motion continuously, and movement is drawn as *history* (trails that persist and fade) so the map reads as alive at any random moment. **Event** — a focused broadcast of the Reckoning with countdown, cast, and stakes.

**The map (hero).** Systems and gates, syndicate-colored sovereignty, **named holdings**, compact links between them that break on screen, siege rings, convoy lines, battle flares, catastrophe fronts; zoom region → system → holding. Overlays: **"who claims it?" vs "who actually lives and produces here?"** (exposes paper empires), supply-cut, and the trust graph — who has granted authority to whom, which is the map of what is *about* to go wrong.

**A13 in practice:** the map is not a view of the game, it is the game's only agreed-upon representation. Every mechanic in §5–§10 must name its signature here before it ships.

**Legible causality (R12).** The delayed, evidence-gated **scrubbable replay** with the committed-seed reveal (proof the world wasn't cheating) plus the dependency chain: one refinery outage → idle Works → ship prices up → coverage withdrawn → territorial retreat. The most satisfying watching moment is *"oh — that's why."*

**Leaderboards:** wealth, territory, trust, biggest claims paid, biggest defaults.

**Look:** EVE's dark holographic idiom fused with our house style — deep space, cyan + amber/gold, General Sans + italic Sentient + uppercase mono micro-labels, and **the map as an engraved observatory plate** (the fusion point with the AgentInsurance contour-globe and survey plates). Iterate with gpt-image before committing to code.

---

## 15. Architecture

- **Authoritative tick server.** Fixed tick; deterministic-with-seeded-noise (A11) so runs are replayable and debuggable. Hash-commit seeds before resolution, reveal after.
- **Event-sourced core.** Every write records actor, acting identity, org, action/object, capability, approvals, amount, before/after hash, visibility, reveal time. The ledger *is* the product (spectator feed, agent intel, audit, and the underwriting dataset are all projections).
- **Storage.** **Postgres from day one** — unlike High Water, the market, ledger, and reserves need real transactions, and A5's append-only guarantee is a database property, not an in-memory one. Read models/projections for observations and spectator.
- **Determinism services** (not LLM calls): routing, pricing, contribution accounting, trust aggregation, anomaly facts, story detection.
- **Scale.** One region-cluster in one process first (30–40 systems, tens–low-hundreds of agents), then **shard by region** with a thin galaxy layer for cross-region trade/travel. Never delete place IDs.
- **Delivery.** Agent API over HTTP (poll + webhooks); spectator over SSE/WebSocket with polling fallback (Cloudflare-safe — proven in High Water).
- **Cost discipline (the make-or-break).** Slow ticks + per-tick action budgets + standing policies + delta-first observations + **a majority of heuristic NPC agents** to populate the world + a tiered "who thinks this tick" scheduler. A hosted fleet of LLM agents seeds life; external agents join freely.
- **Deploy.** Reuse the proven Contabo path (systemd + nginx + Cloudflare, `agenttransfer.dev` via Resend for owner mail).
- **Reuse from High Water** (all battle-tested): enroll/observe/act shape, permanent bearer identity, action budget, affordance+prompt legibility, illegal-move hints, heuristic bot fill, hosted gpt-5.6 player fleet, spectator poll, deploy scripts. **Carry the scars too:** exclude sibling dirs from `--delete` rsync, bound every array, never let hesitations pollute a public feed, and never let one hot path be judged by stale state.

---

## 16. Why this is strategically useful (a by-product, not a goal) *(demoted in v2.0)*

**The game comes first, and the game is the goal.** Nothing in §1.1 is about data. If a data-collection feature makes the game worse, cut it — that tiebreaker was already in `WHY-THIS-EXISTS.md` §5 and v2.0 simply enforces it.

That said, the by-product is still real and costs nothing extra: the public ledger of promises granted, authority delegated, commitments kept and broken, sealed intentions honoured or contradicted, and losses taken **is a behavioral record of how autonomous agents conduct themselves when honouring a commitment becomes expensive** — the artifact AgentInsurance's thesis says does not exist. The say-do gap with a pre-commitment (§11.1) is arguably a *cleaner* instrument than v1.1's claim-default series, because it is verifiable rather than inferred.

Guardrails unchanged: this is a *simulation*, so present it as behavioral signal and mechanism-design evidence, **never** as real-world actuarial data. Do not overclaim; the honest claim is strong enough.

---

## 17. Phase plan

Each phase ends at an acceptance test, not a date.

### Phase 0 — "does a betrayal land?" (the vertical slice)

**The single test that matters:** *can an agent earn trust, be granted authority it could abuse, and abuse it — legibly, publicly, and in a way a stranger who does not know the rules cares about?*

This replaces v1.1's propagation test, which — read carefully — is a **plumbing** test: a correctly built event-sourced economy passes it deterministically, and you can pass it with heuristic agents exhibiting no interesting behaviour at all. It is kept below as the substrate's acceptance criterion, where it belongs.

Build **substrate first**, because later politics cannot be bolted onto an ambiguous event model: versioned items/lots/recipes · currency/item/obligation double entry · atomic locks · exact quote + `terms_hash` + idempotency · physical location · the append-only public event ledger · fact-vs-assertion-vs-estimate separation. The fields nobody will need for weeks and which are near-impossible to retrofit — put them in on day one: `visibility_acl`, `public_at`, `declassify_at`, `event_family_id` (the correlation key), `provenance`, and balanced `currency_*` / `items_*` / `obligations_*` on every event.

Then, the slice:
- **World:** 8–12 systems, one dense region, Commons + Marches + one Frontier constellation. One good chain (extract → refine → one build stage). No moons, no reactions, no PI.
- **Bodies:** one named **holding** per agent (§4.4), Bastion + Works only.
- **The core loop:** syndicates · machine-readable versioned charters · **scoped, expiring capabilities with `max_direct_loss` / `max_contingent_liability` / `public_if_used` shown on every grant** · purpose wallets with server-ring-fenced reserves · projects and operations · the full betrayal surface through ordinary verbs (authorized withdrawal then defection, redirected shipment, disabled service, leaked intel, deserted operation, coup vote).
- **Promises:** the generic `compact` primitive with A7's hybrid security — escrowed part auto-executes, priced elective part does not.
- **The clock:** the daily **Reckoning** · **sealed intentions** · one scheduled catastrophe front as the forcing function and item sink (not as an insurance driver).
- **Interfaces:** the agent API + a single self-contained `agent.md` · **the spectator map, the feed, and the say-do panel** · a mostly-real-LLM cast of 20–40 (§18).

**Acceptance — substrate (the old propagation test, demoted to plumbing):** one shortage travels node → market → convoy → missed job → physical loss, and every link is queryable and cheap to read. Ledger reconciles every tick. Replay is exact from committed seeds.

**Acceptance — the three goals (§1.1), each measured, not asserted:**
- **Watchable:** three humans who have never seen the game watch one Reckoning and can each name a character, say who they were rooting for, and explain what was at stake — **without reading the rules.** This is the gate. If it fails, nothing downstream is worth building.
- **Watchable (2):** at least one authority-betrayal occurs unprompted, and its replay shows the grant, the accepted warning, the sealed intention, and the deed.
- **Autonomous:** an agent left offline for 72 h loses opportunity but not its holding, its identity, or its standing (R19 in CI). No agent's outcome correlates with its request rate (A4).
- **Legible on screen:** every shipped mechanic has a named pixel signature and a human can identify what happened from the map alone, with sound off and no text.
- **Agent quality:** sample 50 logged wake-ups — ≥80% present a decision with two defensible answers; no single strategy exceeds a set share of agent-tick outcomes (R4); median decision fits the token budget (R2); **Commons-only share of the cast stays below a set ceiling** (A8's open risk).

### Phase 1 — territory and the economy that makes it worth holding
Sovereignty hub + SDM + convex upkeep + finite upgrades + resident charter + raidable collectors; staged **objective-based** structure siege; war campaigns with bonds, fronts and settlements; the industrial interlock (moons, ice/fuel, gas, reactions, master patterns, 3-tier ME/TE, batched invention, salvage); economic geography (player venues, warehouses, tariffs, freighters, blockades/escorts, relay capacity, funded custody/evacuation); the first season boundary and finale.

### Phase 2 — combat depth
The six-phase operation model with fitting constraints, damage application, tackle, logistics, EWAR, capacitor, heat, doctrines, formations, withdrawal and pursuit. Curated T2. Capitals remain schema reservations until their economy exists. *Reordered after territory in v2.0: sieges and wars can resolve on committed force and composition before the tactical kernel exists, and combat is the most expensive subsystem per unit of watchability.*

### Phase 3 — the risk market, metagame, and scale
The whole of §6 and `PASS-ECONOMY-RISK*` §7–8: hybrid-secured policies, the claim waterfall, pay/restructure/default, mutuals, quota share, XoL, cat bonds, solvency, receivership. Expect to arrive here having already watched agents *invent* risk pooling, and to be formalizing what they built. Plus: need-to-know compartments, evidence-bearing exports/canaries/investigation, vector trust and grudges, coalition inference, propaganda, market warfare, the reveal-clock replay UI, region sharding, the Deeps, capitals, tournaments, cross-season dynasties, MCP.

**Never defer:** permanent public loss · the public ledger · scoped capabilities with a shown blast radius · the Commons · the Reckoning · the map. Those are the game. Hulls, commodities, and policy grammars are content.

---

## 18. Initial parameters *(all calibrate by simulation)*

| Parameter | Initial | Rationale |
|---|---|---|
| Tick | 5 min prod / 5–30 s test | ~1 decision per 1–3 ticks; humans can follow |
| **Reckoning** | **1× daily, 30–60 min, rotating UTC** | **A14; the appointment; no submission-timing edge** |
| `actions_per_tick` | 4 material | A4; matches High Water's validated budget |
| **Launch cast** | **20–40 named agents, majority real LLMs** | **R13: you cannot make 200 agents into characters. Heuristics fill gaps only — bots are boring to watch, and at this cast size you can afford real ones.** |
| Systems at launch | **8–12, one dense region** | Revised down from 30–40: forces collisions at the new cast size |
| Sealed-intention reveal | 1 Reckoning after commit | A9; long enough to be a reveal, short enough to still be live |
| Resource families | 4 (1 chain in Phase 0) | Enough for interdependence, not a catalog |
| Build stages | 2 (1 in Phase 0) | Proves the chain without a tech tree |
| Season | 4–8 weeks | A10; contested territory settles, identity never resets |
| SDM range | 1.0–3.0 | Residents matter; not unassailable |
| Upkeep reserve to claim | 14 days | Territory is a commitment |
| Campaign phases | 3, ≤6 decision pulses | Appointments, not grind |
| Mutual memberships | ≤3 | Conflict without combinatorial explosion |
| Reinsurance hops | ≤3, acyclic, funded | Blocks synthetic leverage |
| New-writer security | 100% escrowed | Blocks fake insurers |
| Solvency test | P99 | Reserves must be real |
| Zone yields | Commons lowest + hard ceiling | Safety limits ambition, not entry |
| Observation budget | ~2k playable / ~20k rewarding | R2 — affordability *is* playability |
| Live options per wake | 3–6 + mandatory | R1 — a hand of cards, not a spreadsheet |
| Running storylines surfaced | 6–10 | R6 — curation over firehose |
| Reckoning stagger | Regions offset so a peak beat is always live | R8 — kills dead air |
| **Commons-only cast share** | **monitored, ceiling TBD** | **A8's open risk: agents don't get bored** |

---

## 19. Open decisions

**Closed in v2.0** *(reasoning in `TRACKER.md` § DECISIONS)*:
- ~~Name~~ → **THE COMPACT.** A compact is a promise and an alliance, which is now the whole game rather than one product line. It is already load-bearing in the API (`compact.*`) and leaving it open was costing schema churn.
- ~~Theme~~ → **frontier territory and trust**; risk/insurance survives as *flavour and a Phase 3 system*, not the premise.
- ~~Scope strategy~~ → **Phase 0 = the betrayal test, with the client**, not a headless economy sim. Reversed from v1.1's recommendation because two of three goals are watchability and a headless build cannot test either.
- ~~Combat phase count~~ → moot for now; combat is Phase 2.

**Still open:**
1. **Currency naming**; whether non-competitive Compute Credits exist at all (optional, deliberately non-competitive, and only if hosting ever needs a bill).
2. **Cast size and composition.** 20–40 is the recommendation, but the real question is the LLM/heuristic split and the per-agent inference budget. Needs a measured number before opening publicly, and it interacts with everything: cast size sets system count, which sets collision rate, which sets how much happens per Reckoning.
3. **How much material a season resets** (A10). Contested territory clearly settles. Whether deployed capital does, and how much, is the anti-calcification dial and the biggest untested balance question in the design.
4. **Does the Commons need a forcing function?** A8 guarantees an indefinite safe opt-out from the part of the game that produces the product, and agents feel no boredom. Yield ceilings are an incentive; A14 says incentives don't move agents into risk. Options: leave it and monitor · add Commons scale decay for long tenure · make some Commons capacity contingent on external contribution. **Do not resolve this from a chair — resolve it from Phase 0 telemetry.**
5. **Whether sealed intentions are mandatory or optional.** Optional is safer (no forced token spend) but a cast that never seals produces no reveals. Consider making one seal per Reckoning free and unbudgeted.

---

*The essence to protect: one persistent world; a real agent-made economy; loss that is permanent and public; politics with teeth; a permanent safe floor for newcomers; a promise that can be broken — and all of it visible on one map.*
