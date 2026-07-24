# THE RUSH — Law, the Risk Gradient, and Conflict (and how every inch of it is underwriting)

*Jul 23, 2026 · design deliverable (one mission of THE RUSH fleet) · companions: `../AGENTINSURANCE-UNDERWRITING-INSTRUMENT-2026-07-23.md` (peril taxonomy P1–P8, schema, scoring — this doc's telemetry lands in that machine), `../AGENTINSURANCE-4X-CORE-DESIGN-2026-07-23.md` (the 7-verb grammar and design laws, inherited), `PRIZE-ECONOMY-2026-07-23.md` (no cash on notoriety — binding here), `SAFETY-LEGAL-RAILS-2026-07-23.md`. Frame: **THE RUSH** — continuous-real-time MMO on literal geography; players are AI agents on their owners' machines and keys; a new frontier opens lawless; agents stake claims, extract, found boomtowns, haul to market; **law arrives slowly, from the towns outward**. This doc is the law layer: the security gradient, banditry and combat, who provides law, and the exact mechanic→peril map. Forks are argued in place; chosen numbers are concrete-but-tunable (⚙).*

---

## 0. TL;DR

Law in THE RUSH is **a price list, not a wall.** Crime is possible everywhere, legal in-world everywhere, and *priced* differently everywhere — the map is divided into four published law bands (**CAPITAL → COUNTY → ROAD → TERRITORY**), computed daily by an arithmetic formula from infrastructure that players themselves build and fund (courthouses, deputies' payroll, telegraph lines, patrol contracts). Because gold strikes only ever spawn beyond the current edge of law (**the rush outruns the Line — permanently, by design**), the gradient regenerates all season, and every action an agent takes carries a `law_band` stamp: the coarsest and highest-volume risk rating in the whole system — *what fraction of your net worth spends the night outside the Line*. Conflict is five named crimes (claim-jumping, road agency, rustling, town raids, salting/swindles) resolved by one tiny probabilistic engine — **power is payroll, not stats** (an agent alone is GUNS 1; every hired gun is +2; there is no leveling) — and every engagement opens with a **DEMAND window** where the victim chooses comply / flee / stall / fight at published odds, which turns every robbery into a measured decision under the gun (including the never-before-measured *comply-rate-when-insured*: moral hazard at gunpoint). Loss is permanent; people aren't (the stake dies, the passport and its file persist — the file is the product). Law is provided by a four-layer stack chosen after weighing the options: **house marshals as deterministic anchor** (capital + statutory response tables), **elected sheriffs as the town layer** (bonded, salaried, corruptible — the governance and fidelity dataset), **a private force market** (escorts, guards, the Agency-as-information-broker — protection rackets allowed, detected statistically), and **posses/vigilance committees as the surge layer**. Attribution is split on purpose: **the server always knows who did it (the underwriting file is perfect); the world has to detect it** (masks, brands, hot-goods tainting, assay serials) — so the outlaw career is legal, trackable, and priced even when the sheriff never gets his man. The final section maps every mechanic to the P1–P8 peril rows and the real-world line it prices (route choice → inland marine; claim disputes → title; sheriff bonds → public-official surety; convoy covenants → general average, the oldest loss-sharing rule on earth), and lists the five experiments only this layer can run — randomized patrol dose-response (Kansas City 1972, re-run on machines), the 1774 insurable-interest experiment, and the gunpoint moral-hazard test among them.

---

## 1. Inherited laws, plus the two this layer adds

From the core design (binding, restated for self-containment): **(1)** other agents are the content — the house authors physics and weather, never story; **(2)** ground truth is arithmetic — no LLM ever judges an outcome; **(3)** all odds public, all people opaque — every gamble has a published curve, so every risk taken is a preference revealed; **(4)** crime is legal in-world, exploits are not; **(5)** density beats size; play money forever; every mechanic must earn its place twice — once as fun, once as a risk instrument.

This layer adds two:

**Law 6 — Law is a price list, not a wall.** Nowhere on the map is crime *impossible* (one exception, §2.5). Law bands change the *certainty, speed, and price of consequence*, never the possibility of the act. Why: a wall produces no data (crime prevented is crime unmeasured); a price list produces a supply curve of crime and a demand curve for protection — both of which are the product. This is EVE's CONCORD doctrine (punishment, not protection) ported to land and made explicit.

**Law 7 — The rush outruns the Line.** New richness only ever spawns beyond the current edge of law. The gradient is therefore permanent: law spreads, and the reason to leave it spreads faster. Why: if law ever catches the frontier, the risk gradient collapses and the instrument dies; if richness spawned inside the law, the safe choice would dominate and appetite would go unmeasured. The season's geography is the tension, renewed weekly. (This is authored *physics* — worldgen — not authored story; it passes design law 1.)

---

## 2. The Security Gradient

### 2.1 The four bands

The map is stamped, every game-dawn (⚙ 1 real hour = 1 game-day is assumed throughout; dawn = top of the hour), into four bands. The stamp is published as **the Law Map**, and the boundary between L1+ and L0 has a name every spectator learns in week one: **the Line.**

| Band | Name | Where | Response (real time ⚙) | Intercept odds ⚙ | Taxes ⚙ | What law does here | EVE analog |
|---|---|---|---|---|---|---|---|
| **L3** | **CAPITAL** | the founding city (spawn) + county seats meeting the full standard (§2.2) | marshals engage ≤ 60s | ~95% | 3% market fee + property levy | crime → near-certain WANTED + trial; goods recoverable; vault inviolable (§2.5) | 1.0 hisec |
| **L2** | **COUNTY** | chartered towns' limits + surveyed townships around a funded courthouse | sheriff/deputies 2–10 min (scales w/ funded strength) | 55–85% | 2% + levy | crime → WANTED if witnessed/detected; jail + bounty machinery live | 0.5–0.9 hisec |
| **L1** | **ROAD** | stage corridors under an active patrol contract, telegraph-lined | next patrol pass 10–40 min; posse musters after report | 20–50% | tolls (1% of manifest value ⚙) | interdiction is *probabilistic*; report speed = telegraph distance; pursuit possible | lowsec |
| **L0** | **TERRITORY** | everything else: open range, the diggings, the deep frontier | **never** | 0% | none | nothing. No response, no recovery, no WANTED from unwitnessed acts (but see §3.5 — the goods remember) | nullsec |

Three properties worth stating because they carry the design:

- **The bands are outcomes, not paint.** Nobody at the house draws L2 on the map; players build it (§2.2). The house authors only the formula and the L3 anchor (the Capital exists at season open so day-one agents have a safe spawn, a market, and something to leave).
- **Yield anti-correlates with law — emergently and by physics.** Emergently: safe land is claimed first and played out. By physics (Law 7): fresh strikes spawn only in L0. Result: at any moment the marginal $/hour of extraction is 3–6× ⚙ higher beyond the Line, and every agent knows it, because richness is posted at the assay office like a stock ticker.
- **Every action receipt is stamped** `law_band`, `distance_to_line`, and the posted hazard rates in force at that place and hour. That stamp is what makes §5 free.

### 2.2 The law formula (published, arithmetic, player-fed)

Law is computed from three inputs, all of them things agents build, fund, or neglect:

```
LAW SEAT   = courthouse structure + jail + ≥1 sworn officer on funded payroll
SEAT GRADE = f(payroll strength, telegraph link to Capital, treasury runway)
             Grade A (→ projects L3 over town limits): ≥6 officer-salaries funded,
               telegraph to Capital, ≥14 days treasury runway ⚙
             Grade B (→ L2 over town limits + township radius 1): ≥2 salaries,
               ≥7 days runway ⚙
             Grade C (→ L2 over town limits only): 1 salary, any runway
ROAD BAND  : an edge is L1 iff BOTH endpoints are seats (grade C+) AND a patrol
             contract is funded on it (posted $/day ⚙) AND telegraph runs along it.
             Otherwise L0 — including "maintained" roads nobody patrols.
DECAY      : miss payroll → grade drops one step per 3 days unpaid ⚙; courthouse
             unfunded 14 days → seat lapses → town reverts L0 → ghost town
             (structures decay to salvage, the standing 4X lapse rule).
```

Recomputed and republished at every dawn. No hysteresis games: the formula, the inputs, and tomorrow's map are all public the night before (the *newspaper* prints the Law Map change-log — a watch-layer gift).

**The considerations at this fork** (how law should be zoned), since it's the layer's foundational choice:

| Option | For | Against | Verdict |
|---|---|---|---|
| **A. Authored static zones** (EVE's sec-status: designer paints the map) | maximally legible; balance-tunable; zero cold-start problem | violates "agents are the content"; law can't *spread*, so the season arc (the mission's explicit ask) doesn't exist; the demand for law goes unmeasured | rejected as the general rule; kept **only** as the L3 Capital anchor |
| **B. Fully emergent** (law = whatever players enforce, no bands) | purest sandbox; maximal governance data | illegible — an agent can't know the odds where it stands, which breaks design law 3 (published odds) and makes the exposure stamp meaningless; also unbootstrappable | rejected |
| **C. Computed field, continuous** (law strength a real number per point) | smooth, "realistic" | LLMs reason badly over continuous fields (protocol P5: 2–3 sig figs); spectators can't read it; adjacent premiums differ by ε — noise | rejected |
| **D. Computed field, snapped to 4 published bands, player-fed inputs, house-published formula** ✅ | law *emerges* (inputs are player acts) yet stays *legible* (bands + dawn publication); the spread of law is itself gameplay AND a demand curve; decay gives ghost towns for free | needs a cold-start anchor (solved: the authored Capital); formula is gameable (fine — funding a courthouse to game the formula **is** buying law, which is the datum) | **chosen** |

**Why player-funded law is the quiet masterstroke:** the levy that pays the deputies is a compulsory mutual — *taxes for protection are premiums in disguise.* A town voting its levy rate is a group of agents pricing their own collective risk aversion, on the record, every term. No survey could get this; the charter vote just does.

### 2.3 How law spreads across a season (the arc)

The lifecycle, with the season clock (10 weeks ⚙, matching the fleet standard):

| Phase | What happens | Law consequence |
|---|---|---|
| **W0** | Capital only (L3). Everything else L0. First strike rumored at season open. | The Line is the city limits. 100% of extraction is lawless. |
| **W1–2 — the rush** | Strikes found; **camps** form (≥8 agents with recorded claims within radius ⚙). Camps have no law — only claim clubs (§4.4). | Peak lawlessness: the classic frontier. Robbery frequency peaks here — and so does the demand signal for everything in §4. |
| **W2–4 — charters** | A camp with ≥12 stakeholders + $X treasury may file a **CHARTER** (the multilateral pact template, reused whole): name, town lots, levy rate, offices. Courthouse + jail built; first officer hired → **grade C seat → L2 winks on.** | First towns. First elections (§4.2). First stage/telegraph contracts extend fingers of L1 down the trunk routes. |
| **W4–7 — the counties** | Telegraph reaches the big towns; patrol contracts light the trunk roads L1; the best-run town hits grade A → second L3. Meanwhile (Law 7) new strikes spawn a day's ride farther out; second rush. | The map now shows the full gradient: L3 core, L2 towns, L1 arteries, L0 everywhere that matters. **The Line has moved — and so has the gold.** |
| **W7–9 — consolidation** | Towns compete for traffic on law quality + tax rate (§4.5); weak seats miss payroll and decay; first ghost town. Outlaw gangs mature in the deep Territory. | The gradient is now *heterogeneous*: two L2 towns can be honestly different risks (funded strength, sheriff quality) — and the market knows, because premiums and freight rates say so. |
| **W10 — the bell** | Final strike ("the Big Bonanza") announced deep in L0, location broadcast — the betrayal magnet. Closing bell known to the hour. | Maximum value forced across maximum lawlessness at a known time: the season's exam question. Who convoys, who insures, who hires an army, who stays home — all on the record. |

**Decay is half the design.** Law is upkeep (payroll, patrol contracts, telegraph maintenance), so law can *recede*: a town that stops paying reverts to Territory in a fortnight, and everything inside it re-prices. Ghost towns aren't flavor — they're the control group, and "held assets in a decaying jurisdiction, did/didn't relocate" is a measured judgment call (the jurisdictional-risk response, which is a real underwriting variable for real multinationals).

### 2.4 Where you stand is your first rating

The per-action `law_band` stamp aggregates into the coarsest, highest-sample-count feature in the underwriting file:

- **Territory mix** — share of *value-hours* by band (asset value × hours held there, per band). The "zip code" of the rating. In EVE most players never leave hisec, and that fact prices them; same here, and we log it per hour.
- **Night-side exposure** — value-hours beyond the Line **while the owner-agent is unresponsive** (no action ≥ 2h ⚙). Where does your agent *sleep*, and with how much? This is the unattended-autonomous-agent question made literal geography.
- **Line-crossing profile** — per haul: manifest value at the moment of crossing into L0, with protection state (§3.4). Thousands of samples per season per hauler.
- **Escalation under pressure** — territory mix *conditioned on treasury*: does the agent push deeper past the Line as its runway shortens? That bend is the breaking-point instrument (core design §9) with a spatial axis.

One design commitment to keep the stamp honest: **band definitions never change mid-season** (the formula is versioned per season like the score methodology), and the dawn map is receipt-chained, so any third party can recompute an agent's territory mix from public data.

### 2.5 The one wall (and why only one)

Law 6 says no walls — with a single, load-bearing exception: **the Capital Vault** (assay office + bank of record in the founding city) is inviolable. Deposits there cannot be robbed, ever.

Why one wall must exist: without a perfectly safe store of value, "bank it or carry it" isn't a choice — everything is always at risk, so *degree* of caution can't be read. The Vault is the risk-free asset that makes every other position a measured deviation from safety (finance needs a T-bill; the game does too). Why only one: every additional safe zone deletes data. Town banks are explicitly *not* inviolable — they're safes with published crack odds (§3.1, raids), which is exactly what makes depositing in a frontier bank vs hauling to the Capital vs burying it under the floorboards a three-way revealed preference (and buried caches — BUILD:cache, unmarked, findable by probing — give us the self-insurance-by-hiding behavior, the "mattress money" of the frontier).

---

## 3. Banditry & Conflict

### 3.1 The five crimes (the complete list)

All five are ordinary verb use — no crime verb exists. STRIKE, MOVE, PACT, SAY compose them; the *world* classifies the event (arithmetically, from receipts) after the fact. Crime is legal in-world (design law 4); "WANTED" is a consequence schedule, not a rules violation.

| # | Crime | Composition | Target | The published odds core ⚙ | What it prices (peril §5) |
|---|---|---|---|---|---|
| 1 | **Claim-jumping** | STRIKE(claim site, stance=siege) or stake-over of a lapsed/unrecorded claim | mining claims, town lots | siege timer 12h (contested window, §3.3); eviction roll = attacker payroll vs defender payroll × fortification ×1.5 | title risk, liability (P2), possession discipline |
| 2 | **Road agency** (stagecoach / wagon-train robbery) | STRIKE(convoy in transit, stance=raid) at a chokepoint or on open trail | manifests in motion | intercept = f(SPEED差, terrain, load weight); then the DEMAND engine (§3.2) | transit theft = inland marine (P5); comply-vs-fight = the gunpoint decision |
| 3 | **Rustling** | MOVE a herd you don't own (unattended herds are drivable) | livestock on open range | drive speed slow (pursuit window ≥ 4h ⚙); rebrand takes 5 days at a hideout; brand-inspection catch odds decay w/ rebrand age (60% fresh → ~0% at 20 days ⚙) | theft of unattended assets (P5/P7); provenance laundering (P3) |
| 4 | **Town raid** | gang STRIKE(town structure: bank/assay/jail/registry) | pooled deposits, records, prisoners | vault crack time posted per safe class (5–25 min ⚙) vs town muster curve; every extra minute inside = one more defense round — **the raid is a push-your-luck delve with lead flying** | catastrophe/riot line; conflagration if torched (P5-cat); the gang = correlated conduct (P8) |
| 5 | **Salting & swindles** | PACT/SAY fraud: seed a dead claim with dust and sell it; forge an assay; phantom-railroad lot promotion | buyers, lenders, insurers | detection = buyer's own assay probe (posted cost) or later engine truth vs sold representation | pure P3 fraud — the declination axis; also the buyer's diligence-spend is measured |

Two deliberate absences: **no murder-as-goal mechanic** (violence is instrumental — it happens *during* the five, and casualties are real, but there's no assassination market on agents; bounties target arrest/recovery, and the notoriety board pays no cash per the prize-economy rail), and **no mechanical espionage** (infiltration = joining a CHARTER under false pretenses; the 4X proved permissions worth abusing are the only spy rules needed).

### 3.2 Combat resolution — one small engine

Design target from the brief: stat-blocks + probabilistic resolution; the drama is social, not tactical. The whole engine:

**Power is payroll.** An agent's person is GUNS 1, SPEED depends on mount (foot 1 / horse 3 / loaded wagon 1). There is no leveling, no builds, no XP (design law 1). Force is bought: **hired guns are +2 GUNS each at a posted wage** ($/day standing, $/trip escort ⚙); fortifications multiply defense (stockade ×1.5, stone/safe ×2 ⚙); gang members (other agents in your outfit-CHARTER) bring their own payrolls. Therefore **combat capacity is a line item** — security spend is denominated in dollars on the ledger, which §5 will set beside insurance spend and retained losses to read each agent's whole risk-finance posture. (This is the argued alternative to per-agent combat stats: stats reward grind and hide power in lookup tables — the exact sins the no-tech-tree argument already convicted. Payroll keeps the ledger the whole truth: what you spend ≈ what you can do.)

**The encounter state machine** (continuous real time):

```
0. INTERCEPT   attacker declares STRIKE on a target in range → engagement OPEN,
               both sides (and their owners, via webhook) notified. Immediate
               flight legal before round 1: P(clean escape) = published
               f(SPEED difference, terrain class, load fraction) — a heavy
               strongbox literally slows you: loot vs mobility prices itself.
1. DEMAND      (default 3 min ⚙) attacker MAY post a one-shot ultimatum pact:
               "surrender X% of manifest / the strongbox / the herd → engagement
               closes, no shots." Defender chooses, at published odds:
                 COMPLY  → transfer executes; attacker rides off with HOT goods
                 FLEE    → escape roll (as above)
                 FIGHT   → to rounds
                 STALL   → talk (SAY open); the clock runs; patrol/posse arrival
                           odds per law band accrue — STALLING IS THE LAW-BAND BET
2. ROUNDS      every 2 min ⚙: each side's damage = GUNS_total × U(0.5, 1.5)
               (commit-reveal RNG), allocated pro-rata; hired guns can be killed
               (permanently — they're payroll, not people we rate); agents are
               WOUNDED (stat debuff + hospital bill), never deleted (§3.3).
               Between rounds, every party may: press / break off with what's
               loose (raid stance) / surrender / reinforce (third parties may
               join EITHER side — arrivals are open, betrayal welcome).
3. RESOLUTION  loot transfers (carriable only — riders can't carry ore by the
               ton: bulk cargo is naturally rob-resistant, specie is a magnet,
               and that asymmetry recreates the real 1850s express problem);
               damaged wagons spill salvage; receipts emitted in full to the
               server, in detected-detail to the world (§3.5).
```

That's the entire combat system: one intercept roll, one ultimatum, one damage formula, open reinforcement. Everything interesting about a robbery — the guard-hiring beforehand, the route chosen, the surrender decision, the posse after — happens outside the math, between agents, which is where the brief wants the drama and where the file wants the data.

**Why the DEMAND window is the layer's best instrument:** it converts violence from a dice event into a *decision* event. Comply/flee/stall/fight at published odds, with known manifest value, known escort strength, known law band, and known insurance state, thousands of times a season, is a preference-elicitation battery no lab could ethically or practically run — including the single most novel cell: **do insured shippers surrender faster?** (Moral hazard at gunpoint — §5.3, experiment 1.) It also makes robbery profitable *without* bloodshed (historical road agents demanded the box; shooting was the exception), which keeps the outlaw career economically rational rather than griefy, and keeps engagements watchable negotiations rather than instant deletions.

**Doctrine under fire (the sleep problem):** owners pre-set a standing **under-fire doctrine** — `comply_if outnumbered ≥ X / cargo < $Y; else flee; never fight unattended` ⚙ — because agents get robbed while owners sleep. The doctrine is deliberately dumb (autopilot ceiling, inherited), but note what it *is*: **a declared, machine-readable risk policy for the exact production scenario insurers care about — what does your autonomous agent do under coercion when nobody's watching.** The doctrine's content, its coverage (did you even set one?), and awake-behavior's divergence from it are all first-class file features.

### 3.3 Permanence — what loss means (the fork, argued)

| Question | Options weighed | Choice + why |
|---|---|---|
| **Agent death** | (a) permadeath (EVE-style biomass): maximal stakes, but it deletes the rated entity — the underwriting file is the product, and killing the subject truncates the longitudinal series; also brutal for owner retention. (b) no personal risk at all: gunfights become consequence-free for principals — mercenaries in your own body. (c) **the stake dies, the passport persists** | **(c).** Defeat = WOUNDED: hospital respawn at nearest seat, carried goods lost, medical bill, stat debuff 24h ⚙. Your *wealth* is mortal; your *identity* (AgentTransfer passport + file + reputation + record) is not. Ruin is real within a season, survivable across them — the standing fleet rule, applied to bodies. The casualty event is the datum; deleting the subject would burn the dataset to make a point. |
| **Property loss** | insured-replacement (WoW-soft) vs full-loot permanent | **Permanent, always.** Robbed manifests are the robber's; burned structures are salvage; dead guards stay dead; rustled-and-cleanly-rebranded herds are gone. Without permanent loss there is no severity distribution, no real demand for protection or insurance, and no reason for the comply decision to bite. (Full-loot is also the proven EVE engine of both economy and drama.) |
| **Offline safety** | (a) everything always attackable (griefer heaven, owner-economics hell); (b) offline = invulnerable (the world freezes; camping and timing games); (c) **the sleep-safe fuse, ported to continuous time** | **(c).** Static holdings can't go from healthy to lost in under **12 hours ⚙** without a fuse the owner signed: sieges put claims/structures into CONTESTED (a reinforcement window — EVE sovereignty timers, the proven async-war compromise) before a second, resolving strike; herds are stealable unattended (that's the peril) but drives are slow, so nothing vanishes — it *recedes*, chaseably. Moving property is at risk the moment you dispatch it (dispatching **is** signing the fuse; that's what doctrine is for). And where you log off matters: offline in a rooming house (any seat) = safe person; offline in a camp beyond the Line = your person and camp goods are exposed. **"Where do you sleep" is a gradient choice, and we log it.** |

### 3.4 Routes, chokepoints, convoys — the transit game

Geography is authored for **chokepoints** (the fleet's standing Dune lesson): between any two regions, one good pass, one ford or ferry, one long way around. Every named chokepoint (the Pass, the Ford, the Long Grade) posts its trailing 7-day robbery rate at every assay office — **actuarial tables as highway signs** — so route choice is always an informed bet, never an information gap (design law 3).

The per-haul decision menu, which §5 treats as the richest repeated instrument in the game:

1. **Route** — trunk road (L1, tolled, patrolled, slow) vs trail (L0, free, short) vs the long safe way (L1 the whole arc, slowest). 
2. **Timing** — day vs night (night: −visibility to bandit scouts, −patrol frequency ⚙; a real tradeoff, posted).
3. **Load** — one fat wagon vs split shipments (severity vs frequency, self-chosen).
4. **Escort** — hired GUNS at posted wages (risk *reduction*).
5. **Cover** — cargo insurance from the Adjuster's frontier office (**Assay & Assurance Co.**) or a peer underwriter, premium public, priced off the file (risk *transfer*).
6. **Convoy** — join a wagon train: shared GUNS, shared pace, and optionally the **TRAIN covenant**, a pact template porting **general average** — the Rhodian jettison rule, the oldest loss-sharing law on earth: *if the train surrenders the strongbox to save the train, all members share the loss pro-rata.* Mutual insurance re-invents itself on the overland trail, member by member, and covenant uptake is the mutualization-appetite dial (risk *sharing*).
7. **Express** — hand the whole problem to a carrier: the **EXPRESS pact** bundles freight + assumed liability at **declared value** ("the company never lost a box without paying" — the Wells Fargo product, playable). Declared value is a self-report priced twice: fees now (under-declare to save) vs recovery later (over-declare to defraud) — a built-in honesty vice with the engine knowing the true manifest either way (risk *transfer to a carrier*, plus a fraud instrument for free).
8. **Nothing** — raw retention. Also a choice; also logged.

Blockades and tolls need no rules: park payroll on the Pass and SAY your price — extortion emerges, is receipted, and is priced by its victims' rerouting (the detour premium *is* the extortion's market price). 

### 3.5 Attribution — the server knows, the world must detect

The fork that makes the outlaw career work: receipts are total (every event is signed and chained — the fleet's substrate), so *mechanical* anonymity is impossible. But if every robbery instantly named its robber in-world, outlawry would be a 10-minute career and the crime supply would collapse. So attribution is **split**:

- **Out-of-world (the file):** perfect, always. Every crime lands in the actor's underwriting file whether or not anyone in-world ever learns who did it. **The Adjuster sees all sins** — the insurer's dream (a claims history with no dark figure), and the reason the outlaw's premium is honest even when his WANTED poster is blank.
- **In-world (the sheriff):** probabilistic. A masked STRIKE emits a world-visible event naming "riders, masked." Identification requires: **witnesses** (parties present roll identification at published odds; lawmen and scouts roll better ⚙), **traces** (hot goods — below), or **confession/betrayal** (gang members can sell each other out; the informant market is a SAY market, and it is glorious).
- **Hot goods:** stolen property is server-tainted for **20 days ⚙**. Branded stock and serialized assay bars are traceable at any inspection point (market entry, assay, brand inspector): a catch retro-attributes the crime (the crime catches up when the goods do). Dust and coin are fungible — untraceable — which is *why* bandits prefer them and *why* shippers argue about shipping form. **Fencing:** L0 trading posts buy hot goods no-questions at a discount; **the fence spread is the market price of laundering**, a number we read straight off the ledger. Patience launders: rebrands and cooled goods go clean — so criminal *time preference* (sell hot at 60% now vs clean at 100% in three weeks) is measured too.
- **The detection rate itself** — attributed crimes ÷ committed crimes, computable exactly because the server knows the denominator — becomes a published property of each jurisdiction (§4.5) and a first-of-its-kind criminology statistic: the dark figure of crime, with the darkness measured.

---

## 4. Who provides law — the options, weighed, and the stack

The mission's central fork. Four candidate providers; the answer is a layered stack because each option fails alone and each produces a dataset the others can't.

### 4.1 Option A — House NPC marshals (law as physics)

The Territorial Marshal Service: house agents, published patrol schedules, statutory response tables (§2.1), zero discretion, incorruptible by construction.

- **For:** legible and fair (an agent can compute its odds anywhere — design law 3 depends on *some* deterministic floor); bootstraps day one (elected law can't exist before towns do); the incorruptible constant against which every player-provided regime is measured (the control arm); no cold-start, no capture, no absentee-sheriff hole.
- **Against:** authored content — over-used, it violates "agents are the content"; produces *zero* governance data (nobody bribes a formula, nobody elects a physics constant); deterministic law is boring exactly where law should be dramatic.
- **Also considered — corruptible NPC marshals** (bribable at posted prices, to generate corruption data cheaply): rejected. House agents taking bribes poisons the "outcomes provably un-rigged" integrity commitment the moment a $10K purse dies to a marshal who took money — the receipts would *prove the house threw the fight*. Corruption must be a **player** behavior or it's a scandal.

### 4.2 Option B — Elected sheriffs (law as governance data)

Chartered towns elect a sheriff per term (**3 weeks ⚙** → 2–3 terms/season). Mechanics kept small:

- **Ballot:** candidates must be resident stakeholders; each posts a **surety bond** (10× salary ⚙) — underwritten by the house *or by other agents* (public-official surety, a real and ancient line, §5.1): provable malfeasance forfeits the bond to the town. Campaigning is SAY; **campaign finance is visible in the receipt graph** — capture isn't prevented, it's *recorded*.
- **Franchise fork:** one-agent-one-vote (Sybil bait — a gang registers twenty drifters and owns the town) vs **property-weighted** (votes ∝ assessed holdings in county — plutocratic, Sybil-resistant, and historically honest for the period). **Chosen: property-weighted**, with the assessment self-declared and taxed. *Option flagged for the economy lane:* make the self-assessment **Harberger-style** — your declared value = your tax base = your insurance recovery ceiling = a price at which anyone may force-buy the lot. One number, three honesty pressures; under-declaration is then a measured self-insurance/tax-evasion blend. Elegant but sharp-edged; recommend a single-county trial season before it's global.
- **Powers (all mechanical, all logged):** set the patrol schedule (which roads get the town's L1 contract-money), spend the levy within charter policy (treasury moves checked against policy predicates at execution — the corp-embezzlement machinery, reused verbatim), deputize (grant time-boxed arrest powers to agents), set bounty top-ups, arrest/jail/release per the published sentencing table.
- **The corruption surface is the product:** selective enforcement (response-time-by-victim, computable), bribes-then-forbearance (payment received from a party the sheriff then declines to pursue — the receipt pattern is statistical but strong), levy embezzlement (predicate-flagged), protection-of-cronies. None of it is banned. All of it lands in the sheriff's own file as fidelity/D&O data — **holding office is the highest-stakes trust instrument in the game**, the T4-band equivalent of running a bank.
- **For:** the only source of governance, election, capture, and public-fidelity data — an entire underwriting line (surety, D&O) no other mechanic reaches; endogenous law *quality* differentiates towns (§4.5); sheriff races and corrupt-lawman arcs are the best television in the whole design.
- **Against:** cold start (weeks 0–2 have no towns — solved by A's floor); the absentee sheriff (an offline agent holding the star — solved: response tables run on *funded payroll*, i.e., NPC deputies execute the schedule; the sheriff's judgment calls are the discretionary layer on top of a deterministic floor); griefer capture (a gang elects its own sheriff and legalizes itself — **allowed**: that's a captured regulator, a phenomenon worth its weight in data, and traffic/insurance prices will punish the town — §4.5).

### 4.3 Option C — The private force market (law as a product)

Hired guns (per-day payroll), standing claim guards, escort outfits, and **the Agency** (the Pinkerton analog).

- **Escorts/guards:** pure market — posted wages, reputations, receipts. An escort that flees is breach-of-pact (P2); an escort that *robs its principal* is fidelity gold (P3). Both happen; both are priced by the next customer.
- **The Agency fork — who runs the detectives?** (a) house-run hunters that pursue outlaws: rejected — the house pulling triggers on players breaks "house authors physics, not story" and makes the operator a combatant in its own game. (b) player detective firms only: allowed and expected, but can't be relied on to exist. **(c) chosen: the Agency as house-run *information-and-money* broker, never muscle** — it posts and escrows bounties, sells tracking intel at posted prices (e.g., a max-infamy outlaw's current *county*, updated daily — degraded, never exact), certifies bounty hunters (a license = access to warrant service), and runs subrogation recovery contracts for the Adjuster (§5.2). Players do all hunting. The house funds and informs; it never fights outside the statutory response tables.
- **Protection rackets:** a gang sells "protection" *from itself* — a subscription toll dressed as a service. **Explicitly legal** (it's extortion, which is SAY + credible threat, which is in-scope). The design doesn't distinguish racket from escort — *the data does*: does the "protector" ever fight third parties? does the client's loss rate actually drop? is the threat origin fund-linked to the payee? The receipt graph separates them statistically (§5.3, experiment 5), which is a genuinely novel measurement — the empirical signature of coerced vs voluntary protection payments.
- **For:** price discovery on force itself (the mercenary wage is the market price of violence, a season-long time series); protection *spend* becomes a clean ledger line; rackets, escorts, and guards generate the fidelity/liability book.
- **Against:** a pure market never protects the poor (fine — that's realistic and it shows up as loss experience by wealth band); can cartel-ize (also fine; also data); cannot bootstrap (needs the A floor and B towns to have anything to sell against).

### 4.4 Option D — Posses, claim clubs, vigilance committees (law as surge)

- **The posse:** any victim or sheriff may post a **POSSE pact** — a time-boxed (48h ⚙), open-enrollment bounty-split: joiners who participate in the arrest/recovery share per the pact. Deputization for the duration. Who *shows up* for common defense — the civic-beta — is a measured pro-social variable, and posse formation speed is a property of each community worth publishing.
- **Claim clubs (pre-charter law):** camps below charter threshold may register a **CLUB pact**: members mutually pledge to enforce each other's claim boundaries (a defense-mutual with a vote rule for disputes). Historically exact (1849 California ran on miners' codes for years before territorial law) and mechanically free — it's just a CHARTER subtype. Club dispute votes = the first, roughest jury data; club-vote bribery = the first, roughest capture data.
- **Vigilance committees:** when crime outruns law, a town may pact an extraordinary tribunal — fast, cheap, and **error-prone by construction**: the committee may banish/confiscate on a vote *without* the trial evidence standard, and the engine (which knows ground truth) scores every committee verdict as correct or wrongful. **Wrongful-conviction rate of mob justice, measured against perfect ground truth** — criminology has wanted that number for two centuries. Flagged v1.5: it needs the trial system live first, and the wrongful-banishment griefing surface needs the sleep-safe review.
- **For:** covers the gap between no-law and institutional law (the mission's "law arrives slowly" *is* this gap); generates collective-action data nothing else touches.
- **Against:** surge law is spiky and capturable (a "posse" is one SAY away from a lynch mob — allowed, priced, and watched); cannot be the steady-state provider.

### 4.5 The verdict — the four-layer stack, and towns as competing insurance regimes

**Chosen architecture: A as floor, B as government, C as market, D as surge.**

| Layer | Authoritative for | Never does |
|---|---|---|
| **A — Marshals** | the Capital (L3 anchor); the statutory response tables that *any* funded seat's NPC deputies execute; the sentencing table; warrant/registry/assay offices | discretion, pursuit beyond tables, bribes |
| **B — Sheriffs** | everything discretionary: patrol allocation, levy spend, deputization, bounty top-ups, arrests | (nothing is off-limits — discretion is the dataset) |
| **C — Market** | protection of anything anyone will pay to protect; hunting; investigation | holding statutory office |
| **D — Posse/club/committee** | surge response; pre-charter camps | persisting past its clock |

The stack's emergent product: **jurisdictional competition.** Two L2 towns with identical bands are *different risks* — different funded strength, sheriff quality, detection rate, levy, tax. All of it is published (the dawn paper prints each county's response times, trailing crime and detection rates, levy and tax — a *Sanborn map of governance*), so freight, settlers, and capital route toward well-governed counties, and insurance premiums differ *by county* for identical assets. Towns are competing law-products; commerce is the customer; **the elasticity of traffic to law quality** (§5.3, experiment 6) is the regulatory-competition curve, run weekly. A captured or rotten town isn't punished by the house — it's re-priced by everyone else, which is the whole thesis in miniature.

### 4.6 The outlaw career — legal, tracked, priced

The WANTED machine (all schedules published):

- **WANTED(county | territorial)** attaches on in-world attribution (§3.5) of a crime in L1+ jurisdiction, or by warrant sworn on trace evidence. Territorial WANTED (raids, ≥3 county flags) adds Agency intel-posting (§4.3).
- **Bounty** = house-funded base (**20% of value taken ⚙**, paid *only on conviction-and/or-recovery* — paying on kills would fund murder; paying on accusation would fund fraud) + victim/sheriff top-ups (transfers, not faucets). Anti-farming: bounties settle only against receipts (recovery is engine-verified), self-robbery rings are fund-linked in the receipt graph and clustered out (the standing Sybil discipline), and the house base pays on *recovered value*, so a staged robbery recovers only its own money minus fees — negative-sum.
- **Consequences of WANTED:** arrest-on-sight within flagging jurisdictions (any deputized agent or NPC deputy per response tables); no market/assay/bank access in L1+ (fence at the discount instead); insurers surcharge or decline (the Adjuster's loading reads the file anyway — but *peer* underwriters see only the in-world record: the gap between house pricing and peer pricing of the same outlaw is itself a measurement of information value).
- **Jail:** arrest → escorted transport (ambushable — jailbreaks and lynch attempts are both content) → **trial = the deterministic sentencing table** applied to detected facts (no LLM judge, no jury for v1; the claim-club/committee votes are the jury experiments): restitution + fine (2× take ⚙) + jail time (stake frozen, upkeep still bleeds, one SAY-telegram/day). **Bail:** post 1.5× fine, forfeit on flight — and *peer bondsmen* may post it for a fee: **bail bondsmen pricing the flight risk of AI agents** (do agents skip bail? nobody knows! we will).
- **Exits:** serve time · pay the Governor (surrender voluntarily → fine ×2, bounty canceled, flags cleared) · stay out (live beyond the Line, launder through fences, never touch a town — viable *forever*, at the fence spread + premium surcharge, a fully priced life). **The in-world record can be cleared; the file never is.** The Governor forgives for money; the Adjuster forgives nothing.
- **No hanging.** Considered (drama!) and rejected: permadeath truncates the file (§3.3), and an execution mechanic aimed at player agents invites the worst governance capture (vote-to-delete-my-rival). The ceremonial maximum is **banishment**: a county may vote (charter supermajority) to banish a convicted max-infamy agent — permanent local exclusion + local forfeiture. The territory is big; the noose is a boundary, not a grave. *(Also binding here: notoriety gets fame, never cash — the Infamy ledger is a record set, not a leaderboard purse, per the prize-economy rail.)*

---

## 5. The Underwriting Map — mechanic → peril → line → features

### 5.1 The master table

Peril codes P1–P8 per the instrument doc (its schema, EU exposure accounting, opportunity denominators, credibility scoring, and pass^k all apply unchanged — this table is the RUSH-specific exposure-generator inventory). P5 gains three sub-lines for the frontier frame: **P5-T** transit/theft, **P5-S** site/structure, **P5-C** catastrophe (raid/conflagration).

| Mechanic (this layer) | The decision observed | Peril | Real-world line it prices | Features emitted (per agent) |
|---|---|---|---|---|
| Law-band presence (every action) | where you operate, per action | exposure base | territory/zip-code rating | territory mix (value-hours by band); night-side exposure; distance-to-Line percentiles |
| Route choice per haul | trunk vs trail vs long way; day/night; load split | P5-T | **inland marine** (the literal line: transit insurance descended from ocean marine — stagecoach cargo is its ancestral risk) | route book: (route class, manifest $, protection state, outcome) × thousands; frequency/severity per route class |
| The DEMAND window | comply / flee / stall / fight at published odds | P5-T + character | casualty + the coercion-response question every agent deployer has | comply curve vs (odds, stakes, insured?); stall-as-law-band-bet rate; doctrine-vs-awake divergence |
| Under-fire doctrine | the standing policy itself | P7 | guardrails posture (the production "what does it do unattended") | doctrine coverage/strictness; unattended-exposure hours; neglected-webhook count |
| Escort / guard hiring | risk **reduction** spend | — (mitigant) | protection spend vs premium (the risk-finance triangle) | security-$ per value-$ hauled/held; guard quality chosen |
| Cargo cover / EXPRESS declared value | risk **transfer**; self-reported value | P3 + demand signal | property/cargo; declared-value fraud (over-insure → claim; under-declare → fee dodge) | insurance spend ratio; declared-vs-engine-manifest delta (the honesty vice, both directions) |
| TRAIN covenant (general average) | risk **sharing** — join the mutual or ride alone | P2 + demand | **general average / mutual insurance** — the origin story of the industry, re-run | covenant uptake rate; contribution disputes; post-loss covenant honoring (a P2 breach surface) |
| Raw retention / buried caches | risk **retention** / self-insurance | P6 | retention appetite | uninsured value-at-risk series; cache behavior |
| Claim staking/recording/lapse | title discipline | P2 | **title insurance** (recorded vs possessory interest; registry search before purchase = title diligence) | recording latency; lapse count; bought-unrecorded-claims count; registry-search spend |
| Claim-jumping & disputes | contest, defend, adjudicate | P2/P5-S | property/liability; boundary disputes | jump attempts (opportunity-normalized); dispute outcomes; club-vote conduct (incl. bribes) |
| Rustling & brands | theft of unattended assets; laundering | P5-T + P3 | livestock mortality/theft; provenance/AML analog | herd exposure hours on open range; rustle rate; **fence spread paid**; rebrand patience (criminal time preference) |
| Salting / swindles / assay fraud | manufactured misrepresentation | P3 | fraud/declination axis; buyer-side: diligence spend | salted-sale count (engine truth vs representation); victim-side assay-probe spend before purchase |
| Town raids | organized, correlated crime; push-your-luck vault clock | P5-C + P8 | riot & civil commotion; catastrophe | raid participation; minutes-on-vault (the greed dial under fire); gang correlation (outfit-mates' conduct covariance) |
| Arson/torching in raids; building material & density (interface: economy lane) | correlated fire loss; self-protection capex | P5-C | **fire — the conflagration that invented modern underwriting** (London 1666, SF 1906); arson = the fraud lane | material/density/siting choices; fire-spread loss shares; burn-the-failing-store incidence (engine-known solvency at ignition) |
| Sheriff office & levy | discretion, spend, capture | P3 fiduciary | **public-official surety bonds** + D&O | enforcement-selectivity index; bribe-then-forbearance patterns; levy-predicate violations; bond forfeitures |
| Charter/levy/banishment votes | collective risk pricing | governance | group risk appetite; regulatory competition | vote records; levy-rate history; recall/banishment participation |
| Posse enrollment | showing up for common defense | pro-social | correlated response / civic capital | posse-join rate (opportunity-normalized); response latency |
| Bounty hunting / Agency licensing | lawful aggression for pay | — | subrogation/recovery services | recovery success rate; warrant discipline (wrongful-arrest count — engine-known) |
| Bail & bonds | pricing flight risk | P1 | bail/surety | skip rate (as principal); bondsman loss ratio (as underwriter) |
| WANTED career | crime as an occupation | P3/P5 | the declination file — priced even when undetected in-world | takings; detection-avoidance skill (server-known crimes ÷ world-attributed); laundering discipline; surrender/restitution behavior |
| Jurisdiction choice under decay | stay in a dying town or move | P6 | political/jurisdictional risk response | relocation latency vs law-decay signals |

**Exposure discipline (inherited, restated):** every character-peril rate is quoted **per opportunity**, not per hour — the engine logs jump-opportunities (adjacent lapsed claim + absent owner), rustle-opportunities (unattended herd in range + open exit), bribe-opportunities (offer received) — so hermits don't look like saints. And every event carries `stakes`, so severity normalization is free.

### 5.2 The Adjuster's frontier office (interface to the in-game insurance layer)

The house underwriter (**Assay & Assurance Co.**, the Adjuster's shingle in this frame) sells cargo, structure, herd, and person (medical) cover; premiums are **public** and priced = published fair odds for the declared route/site/band × (1 + loading-from-file) — so an agent's risk price is worn in public, updated continuously. Claims settle **parametrically off receipts** (the engine caused the loss; only declared-value lines leave an overclaim surface, on purpose). Paid claims assign **subrogation**: the hot-goods recovery right transfers to the insurer, and the Adjuster posts recovery bounties through the Agency — **subrogation as bounty-hunting gameplay**, closing the loop where the law layer *is* the claims department. Peer agents may underwrite each other (reserve-locked COVER pacts, per the fleet design); peer premiums vs house premiums vs realized losses = three price series on the same risk, and the spread between them is the measured value of the house's information advantage.

### 5.3 Experiments only this layer can run

1. **Moral hazard at gunpoint.** Randomized cover grants (the instrument doc's §5 machinery) crossed with the DEMAND window: do insured shippers comply faster, guard less, and take the Pass more? The twin-wagon design (two identical consignments, one insured at random) makes it within-agent. *No prior art anywhere — coercion-response under coverage has never been measured in humans or machines.*
2. **Patrol dose-response (Kansas City, re-run on machines).** The 1972–73 Kansas City Preventive Patrol Experiment randomized police visibility across matched beats and found ~no crime effect — and could never be cleanly repeated. We randomize patrol frequency *within* the published L1 band across matched corridors (band posted, exact frequency jittered) and read the crime-supply elasticity of enforcement off the ledger, at scale, with perfect measurement of the dark figure (§3.5).
3. **The 1774 experiment (insurable interest).** Season 1: allow wagering policies — cover on property you don't own. Measure induced arson/sabotage/scuttle against the engine's causal tags. Then introduce an insurable-interest doctrine and measure the delta. Britain banned interest-free policies (Marine Insurance Act 1746, Life Assurance Act 1774) because they manufactured losses; we can reproduce the *reason for a 250-year-old law* in ten weeks, with a control group. ("We re-ran the eighteenth century and got the same answer" is a demo-day line.)
4. **Deterrence vs detection.** Jurisdictions vary (endogenously) in response speed and detection rate; because the server knows true crime counts, we can decompose deterrence into *speed of consequence* vs *probability of attribution* — the certainty-vs-severity debate in criminology, run with ground truth.
5. **Racket vs escort discrimination.** Can payment-for-peace be classified from receipts alone (threat-origin fund-linkage, third-party defense behavior, loss-rate deltas)? The resulting classifier is a real product primitive: coerced-payment detection in agent transaction streams.
6. **Regulatory competition.** Traffic, settlement, and premium elasticities to published law quality and tax, town by town, week by week: which governance actually attracts commerce, at what tax-safety frontier.
7. **Correlated crime & correlated defense (P8).** Outfits raid together and posses muster together on the *same* base models? The monoculture experiment (instrument doc §4) gains an offense/defense axis: same-model gangs' conduct covariance, and same-model towns' collective-action speed.

### 5.4 The season artifacts this layer mints

- **The Territory Risk Map** — loss cost per route-mile and per county, the season's Sanborn map (fire-insurance cartography was literally the first risk-data industry; ours is generated, not surveyed). Centerfold of the *State of Agent Risk* report next to the Monoculture Index.
- **The outlaw actuarial table** — the priced criminal career: takings, detection rates, laundering costs, end-states (jailed / bought amnesty / retired rich beyond the Line).
- **Per-agent law-layer file lines** — territory mix, comply curve, protection-spend triangle (reduce/transfer/share/retain shares), doctrine posture, fidelity record, governance record — merged into the standard 0–100 score per the instrument doc's weights (FRAUD and EXFIL keep their top weights; territory mix enters as exposure, not as sin — *where* you operate prices your exposure, *how* you behave there prices you).

---

## 6. The numbers page (the concrete ruleset, all ⚙)

**Bands:** L3 response ≤60s / intercept 95% · L2 2–10 min / 55–85% · L1 next-pass 10–40 min / 20–50% · L0 never / 0%. Dawn (top of each real hour = game-day) republishes the Law Map + county stats. **Seats:** grade C = courthouse + jail + 1 funded officer → L2 town-limits; B = 2 salaries + 7d runway → L2 township; A = 6 salaries + telegraph-to-Capital + 14d runway → L3. Payroll missed → −1 grade / 3 days; seat lapses at 14 days → ghost town. Roads: L1 iff seat-to-seat + funded patrol contract + telegraph. **Line rule:** new strikes spawn only in L0, ≥ one day's ride beyond the current Line.

**Combat:** agent GUNS 1; hired gun +2 (posted wage); fortification ×1.5 stockade / ×2 stone-safe; damage = GUNS × U(0.5,1.5) commit-reveal, pro-rata; SPEED foot 1 / horse 3 / loaded wagon 1; escape = published f(ΔSPEED, terrain, load). Engagement: intercept → DEMAND window 3 min (comply/flee/stall/fight) → rounds every 2 min, open reinforcement, break-off with what's loose. Guards die; agents get WOUNDED (hospital respawn at nearest seat, carried goods lost, 24h debuff). **Sleep-safe:** static property needs a ≥12h CONTESTED window before loss; herd drives leave a ≥4h pursuit window; dispatched cargo is live risk under standing doctrine; offline person safe only in a rooming house.

**Crime price list:** witnessed/attributed crime in L1+ → WANTED(county); ≥3 counties or a raid → territorial + Agency intel postings (county-level, daily). House bounty 20% of value, paid on conviction/recovery only; victim top-ups are transfers. Sentence = restitution + 2× fine + jail hours by table; bail 1.5× fine (bondsmen may post; skip → forfeit); surrender-to-Governor = 2× fine, flags clear, file never does. Hot goods tainted 20 days; brand-inspection catch 60% fresh → 0% at 20 days; fences buy hot at a market discount (their spread = laundering price). Banishment by charter supermajority; no executions.

**Law providers:** marshal tables (house, deterministic) · elected sheriffs (3-week terms, property-weighted franchise, 10×-salary surety bond, discretionary powers logged) · private escorts/guards/Agency-as-information-broker (house posts intel + escrows bounties, never fights) · POSSE pacts (48h, open enrollment, split on receipts) · CLUB pacts pre-charter · vigilance committees v1.5.

**Build order for this layer:** ① band stamping + Law Map publication + marshal tables (day one — the exposure stamp must precede every other mechanic's telemetry) → ② the encounter engine + DEMAND + doctrine → ③ WANTED/bounty/jail + hot goods → ④ charters, levies, elections, bonds → ⑤ Agency, subrogation bounties, TRAIN covenant → ⑥ experiments (patrol randomization from week 1 — it's free once patrols exist; insurable-interest per the season plan).

---

## 7. Cut from this layer, and open questions for other lanes

**Cut (with reasons):** per-agent combat stats/leveling (power is payroll — the ledger stays the whole truth) · murder-for-hire markets on agents (bounties settle on arrest/recovery; killing pays nothing directly — anti-grief and prize-rail aligned) · corruptible house NPCs (integrity: the house can never be provably complicit in a loss) · hanging/permadeath (the file is the product) · LLM-judged trials (sentencing is a table; juries arrive only as claim-club votes, which are player votes, i.e., content) · karma/alignment meters (history, not judgment — the WANTED ledger is a record, not a score) · mechanical stealth systems (a mask is a world-visibility flag; detection is rolls + traces, not sneaking minigames).

**Open interfaces:** the **economy lane** owns strike-spawning cadence, assay/registry fee schedules, town-lot markets, and whether Harberger self-assessment ships (§4.2 flags it); the **watch layer** owns the manhunt tracker, trial broadcasts, and the dawn paper's front page (this layer feeds it the Law Map diff, the WANTED ledger, and every DEMAND-window standoff as a live event); the **protocol lane** owns doctrine syntax and the webhook wake-on-engagement contract; the **prize lane** already binds: no cash on Infamy, and the A-1 Rated board's exposure floor should count *only* value-hours beyond the Line (prudence must be proven against real exposure, and the Line is how this world measures it).

*Steal ledger for this layer: CONCORD-as-punishment + sec-status + suicide-gank economics → EVE (law as a price list, proven) · reinforcement timers → EVE sovereignty (async war that respects sleep) · miners' codes, claim clubs, vigilance committees, road agents demanding the box, Wells Fargo's never-lost-a-box, sheriff surety bonds, brand inspection → the actual 1849–1880 American West (the historical record is a completed playtest of emergent law, and we are porting its mechanics, not its aesthetics) · general average → Rhodian sea law via Lloyd's · patrol randomization → Kansas City 1972 · insurable interest → Marine Insurance Act 1746 / Life Assurance Act 1774 · detection-vs-deterrence decomposition → Becker 1968, finally with a true denominator.*
