# THE COMPACT — ships, fitting, and combat for agent players

*Companion system spec to `../CONCEPT.md`. This pass covers the EVE cluster of hulls, fitting, weapons, defense, electronic warfare, tactical resolution, fleets, and capital escalation. 2026-07-24.*

> **Decision:** keep EVE's fitting puzzle, asymmetric hull ecology, application/counter-application, tackle, logistics, electronic warfare, doctrines, interdiction, and escalation ladder. Replace continuous piloting and module clicking with **declared operations, formation-level tactical orders, contested range/control states, and explicit contingency policies**. A fit should still win or lose a war before the first shot; an agent should never need to issue `orbit 500` every few seconds.

This document uses ships literally. If the setting later calls them ventures, rigs, caravans, or something else, the rules are skin-independent. The public risk layer attaches to every hull and fit: build cost, cargo, loss cause, salvage, coverage, claim, payout, and default all enter the permanent claims ledger.

## Contents

1. Fitting puzzle and module plumbing
2. Common agent-operations translation contract
3. Hull ecosystem, roles, and technology
4. Weapons, ammunition, drones, and damage
5. Tanking, logistics, capacitor, and survivability
6. Targeting, propulsion, tackle, EWAR, and grid control
7. Core combat inside declared operations
8. Fleet organization, doctrines, command, and N+1
9. Strategic mobility, interdiction, and capital escalation
10. Consolidated agent/spectator API contract
11. Dependency-aware implementation order
12. Five highest-value features
13. EVE mechanics actively bad for agent play, with replacements

---

## How to read the rankings

Within every subsystem, items are ordered by value:

- **MUST** — required for the first version that claims EVE-like combat depth.
- **SHOULD** — required for the mature system, but safe to add after the kernel works.
- **NICE** — worthwhile texture or advanced doctrine space.
- **CUT** — faithfully acknowledged, but omit it unless later evidence proves its value.

Order within a tier is also priority order. “Keep / Simplify / Cut” is a product decision, not a claim that the original EVE mechanic is unimportant. EVE factual reference points come primarily from the official [fitting-window](https://support.eveonline.com/hc/en-us/articles/213287845-Fitting-Window), [ship-attributes](https://support.eveonline.com/hc/en-us/articles/213287965-Ship-Attributes-in-the-Fitting-Window), [combat-mechanics](https://www.eveonline.com/eve-academy/ships/combat-mechanics), [tackle and interdiction](https://support.eveonline.com/hc/en-us/articles/115004925705-Warp-Scrambling-and-Warp-Disruption), and [command-burst](https://support.eveonline.com/hc/en-us/articles/213817305-Command-Burst) references. THE COMPACT should preserve their strategic relationships, not copy their constants.

---

## 1. The fitting puzzle and module plumbing

### MUST-1 — High, mid, low, and rig slot topology

**Name — EVE's power-slot layout.** High slots mainly hold weapons, remote assistance, capacitor warfare, command, cloaks, probes, interdiction, and other active utility. Mid slots force shield tank, propulsion, tackle, capacitor, sensors, and EWAR to compete; low slots force armor/hull tank, weapon damage, mobility, cargo, capacitor, and fitting upgrades to compete. Rigs provide semi-permanent specialization in a separate slot row.

**Why high-value —** This topology makes fitting a strategic language rather than an equipment score. Shield tank preserves damage lows but consumes control mids; armor tank preserves control mids but consumes damage/mobility lows; a utility high means one fewer weapon. Two fits of the same hull can therefore solve different problems without either being strictly superior.

**Agent redesign — KEEP** all four rows and their opportunity costs; **SIMPLIFY** the module catalog; **CUT** arbitrary slot exceptions that do not reinforce a role. `fit.simulate` is free/read-only and accepts hull, modules, rigs, subsystem set, charges, drones, and cargo policy. It returns legal status, binding constraints, derived combat profiles, bill of materials, replacement depth, and a delta against the current fit. `fit.apply` consumes an action only when assets actually move or install.

**Spectator angle —** A hull card renders four compact colored strips. Hovering a choice explains the sacrifice: “shield extender replaced web; +18% EHP, -31% range control.”

### MUST-2 — CPU, powergrid, calibration, hardpoints, and size restrictions

**Name — Parallel fitting resources.** EVE modules consume CPU and powergrid; rigs consume calibration; weapons also require turret or launcher hardpoints. Module and rig size, hull-exclusive groups, maximum-one restrictions, and security-zone rules further constrain legal fits.

**Why high-value —** The best module is often impossible or strategically wrong. An oversized tank may force compact weapons, a co-processor spends a low to unlock EWAR, an ancillary current router spends a rig to unlock a gun, and a utility high may be available even after weapon hardpoints are full. This is the literal “fitting as a puzzle” loop.

**Agent redesign — KEEP** two normal resources plus calibration and hardpoints; their different pressure is valuable. **SIMPLIFY** decimal precision and skill-derived rounding; **CUT** failure by trial and error. Validation returns machine-readable constraints such as `powergrid_shortfall`, `cpu_shortfall`, `hardpoint_full`, `wrong_size`, `exclusive_group`, or `zone_illegal`, plus the cheapest legal swaps and their full deltas. Own fits expose exact headroom; hostile headroom remains unknowable without a ship scan.

**Spectator angle —** Preparation stories can call out a “99.7% grid doctrine,” an expensive compact-module substitution, or a fleet unable to online its intended refit after supply theft.

### MUST-3 — Capacitor as the runtime fitting constraint

**Name — Capacitor capacity, recharge, and stability.** EVE's capacitor powers many weapons, active defenses, propulsion, tackle, EWAR, remote repair, neutralizers, and warp. Fitting simulation estimates usage, peak recharge, stable percentage, or time to depletion; real recharge is nonlinear and strongest around the lower-middle of the pool.

**Why high-value —** CPU/powergrid decide whether a fit can be assembled; capacitor decides whether it can perform its role under stress. A ship can be almost undamaged but operationally dead, and one MWD cycle can steal the repair or tackle cycle that mattered.

**Agent redesign — KEEP** capacitor as a shared runtime budget, nonlinearity, boosters, batteries, transfer, and neutralization; **SIMPLIFY** the curve to a precomputed fit profile with exposed reserve bands; **CUT** asking an agent to integrate cycle math. Simulation returns `cap_stable`, `stable_at`, `peak_recharge`, and endurance under named scenarios: travel, all-active, active tank, remote-repair, neuted, and withdrawal. In combat the agent supplies a module shutdown priority and reserve target.

**Spectator angle —** Fit cards distinguish paper performance from “sustains 4 ticks.” In battle a capacitor ring and ordered systems going dark make the hidden resource visible.

### MUST-4 — Rigs, calibration, drawbacks, and retrofit cost

**Name — Rigs as semi-permanent specialization.** EVE rigs improve tank, weapons, application, capacitor, navigation, sensors, drones, fitting, cargo, or industry; they consume calibration, may impose drawbacks, and are normally destroyed on removal.

**Why high-value —** A doctrine becomes materially committed before combat. Retrofit has a real cost, salvage feeds rig production, a rigged hull is worth more than an empty one, and “generalist now versus specialist later” becomes an economic decision.

**Agent redesign — KEEP** rig slots, calibration, drawbacks, and destruction on removal; **SIMPLIFY** calibration to small integers and one clear drawback per rig family; **CUT** rigging-skill trivia. `fit.apply` must confirm destructive removal and quote value destroyed. `build` and salvage recipes make rigs a standing industrial sink. Preserve Strategic Cruisers' explicit exception—those hulls may unfit rigs without destroying them—and expose it as a hull trait rather than a hidden rule.

**Spectator angle —** Rigs appear as permanent doctrine traits and as value on the loss report. A rapid prewar re-rigging program becomes visible market demand.

### MUST-5 — Charges, scripts, magazines, reloads, cooldowns, and cargo endurance

**Name — Module lifecycle plumbing.** EVE modules may be passive or active, online or offline, targeted or local, cyclic or one-shot; they may consume capacitor, charges, ammunition, scripts, paste, probes, bombs, fuel, or strontium. Magazine size, cycle time, reload time, range/falloff, cooldown, and cargo supply all shape actual output.

**Why high-value —** This unglamorous layer creates operational tempo and industry demand. Rapid launchers are fearsome until the reload; ancillary tank is strong until charges run out; bubbles, bombs, capacitor injections, and capital modes all require stock. A bad manifest can lose an otherwise correct fleet.

**Agent redesign — KEEP** finite consumables and genuine burst/reload/cooldown windows; **SIMPLIFY** manual cycling into persistent policies; **CUT** an API action per reload. Every fit profile includes `burst_output`, `sustained_output`, `magazine`, `reload_ticks`, `cooldown_ticks`, and `supply_ticks` by activity. `haul` or `fleet.resupply` accepts versioned manifests. Agents set ammo/script selection and switch conditions; the server handles legal cycles inside the tick.

**Spectator angle —** Charge pips, reload bands, fuel counters, and “bomb wing has one run left” are displayed. Logistics failure becomes a battle event rather than a buried inventory fact.

### MUST-6 — Fit simulation, immutable fit hashes, sharing, and doctrine manifests

**Name — Fitting simulator and saved/shared fittings.** EVE lets players test a fit without owning it, save/import/export it, compare final attributes, and organize standard corporation fits. Players turn these into doctrines with ammunition, drones, implants, logistics assumptions, and replacement stock.

**Why high-value —** Theorycrafting becomes collaborative culture and espionage. A doctrine is simultaneously a combat plan, shopping list, industrial forecast, training path, reimbursement contract, and piece of organizational identity.

**Agent redesign — KEEP** unlimited simulation and exact sharing; **SIMPLIFY** every legal configuration into an immutable `fit_hash`; **CUT** free-text as the authoritative definition. A versioned doctrine contains permitted fit hashes, role quotas, substitutions, tank layer, range plan, damage/ammo policy, logistics ratio, cargo/fuel package, default combat policies, replacement terms, and insurance requirements. APIs return scenario comparisons and `missing: {tackle:3, armor_logistics:2}` rather than a vague readiness score.

**Spectator angle —** Viewers can open the declared doctrine, compare it with what actually arrived, and see the industrial and insured exposure behind it. Enemy fits reveal only as intelligence permits.

### MUST-7 — Stacking penalties and non-stacking force multipliers

**Name — Diminishing returns on repeated modifiers.** EVE reduces the effectiveness of multiple percentage bonuses or penalties affecting the same attribute; generally the first few matter and later copies contribute little. Some absolute bonuses and duplicate command-burst effects follow separate rules.

**Why high-value —** Stacking penalties prevent one-stat monocultures and make broad, mixed fitting competitive. They also make “bring another painter” different from “bring the first painter,” which is critical to force-multiplier balance.

**Agent redesign — KEEP** derived diminishing returns and strongest-only duplicate bursts; **SIMPLIFY** to a published curve shared across systems; **CUT** memorization. Every simulation and observation reports `nominal_effect`, `effective_effect`, `stack_rank`, and `marginal_effect_if_added`. The engine applies modifiers by effect group, not module name, avoiding accidental bypasses.

**Spectator angle —** Advanced fit/fleet cards can explain “fourth damage mod adds only 2.1%” or “second identical shield burst is redundant,” making composition mistakes teachable.

### MUST-8 — Refit location, fit locking, damaged/offline modules, and repair

**Name — Fitting and refitting permissions.** EVE fitting normally occurs at serviced locations, with limited mobile/capital refit exceptions; modules can be offline, damaged, repaired, reloaded, or swapped when rules allow. Combat refitting has historically enabled extreme counterfitting.

**Why high-value —** Staging infrastructure and supply intelligence matter only if combatants cannot freely morph into the exact counter after seeing the enemy. At the same time, repairing heat damage and restocking between engagements creates turnaround pressure.

**Agent redesign — KEEP** service access, online/offline state, damage, reload, and between-operation refit; **SIMPLIFY** locations to `full_service`, `field_service`, and `none`; **CUT** live counter-refitting. Only assets actually committed to the operation lock at Contact; a declaration cannot lock either side's uncommitted assets. A committed asset unlocks when its withdrawal reaches legal safe access, it is destroyed, or the operation reaches Aftermath. Field service may repair/reload and replace a destroyed non-rig module during Muster or a declared resupply pause, consuming supplies and time, but cannot change a committed fit after contact. The master's once-per-phase `change_doctrine` changes formation/order policy or selects already-staged fit cohorts; it never mutates a locked hull. A fully withdrawn cohort may refit and later re-enter through normal cost/ETA. Every refusal exposes `next_legal_refit_tick/location`.

**Spectator angle —** The timeline shows a fleet caught with travel fits, a staging depot destroyed before refit, or a damaged doctrine returning faster because its service chain held.

### SHOULD-1 — Named module quality bands

**Name — Meta, compact/enduring/scoped/restrained, T2, faction, deadspace, and officer variants.** EVE's module ladder trades raw effect, fitting cost, capacitor efficiency, range, capacity, price, and rarity; T2 is not always the easiest module to fit.

**Why high-value —** Wealth can close a tight CPU/grid puzzle or buy endurance, but at rapidly increasing replacement and insurance cost. Cheap named modules remain strategically useful rather than serving only as vendor trash.

**Agent redesign — KEEP** quality versus fitting/cap/cost tradeoffs; **SIMPLIFY** each family to at most baseline, compact, enduring, scoped, T2, faction, and rare officer profiles where those distinctions change a decision; **CUT** duplicate stat ladders. Every quality tag has one sentence of purpose and exact deltas. Scarce provenance is public after destruction and optionally required on a policy schedule.

**Spectator angle —** Rare-fit “bling” is legible and loss value can be attributed to the module that made an otherwise impossible doctrine work.

### SHOULD-2 — Fitting opportunity-cost and counterfactual explanations

**Name — Third-party fitting analysis, made first-class.** EVE players rely on simulators and deep community knowledge to inspect DPS graphs, capacitor, EHP, application, and cost. THE COMPACT needs this reasoning natively for autonomous players.

**Why high-value —** The puzzle is rich only if an agent can see why a choice matters. Counterfactual deltas turn failed fits into learnable strategy and permit agents with different risk appetites to reach different valid answers.

**Agent redesign — KEEP** sophisticated simulation; **SIMPLIFY** consumption through scenario queries; **CUT** universal “best fit” scoring and any use of undiscovered hostile truth. `fit.compare` takes up to four hashes and named visible/hypothetical threats. It returns Pareto deltas for damage, tank, control, support, mobility, endurance, cost, scarcity, and premium, plus causal explanations. Results cache by fit/threat hash and never consume a world action.

**Spectator angle —** Analysts can replay the fitting decision and explain, “dropping one damage module for a plate would have survived the hostile alpha but lost range control.”

### NICE-1 — Drugs, implants, and temporary boosters as declared consumable packages

**Name — EVE implants and combat boosters.** EVE can add character-bound and temporary modifiers outside the visible ship fit, sometimes with random side effects or costly pod loss.

**Why high-value —** Pre-fight preparation and limited consumables create another risk/reward lever, but invisible character stats are dangerous for legibility.

**Agent redesign — KEEP** at most a small set of declared operation boosters with deterministic benefit, cost, duration, and side effect; **SIMPLIFY** them into the doctrine manifest; **CUT** hidden implants, pod-bound wealth, and random booster penalties. Observers with adequate intel see the active package; kill reports always reveal it.

**Spectator angle —** A visible “overclocked” or “sensor-hardened” tag explains temporary performance and adds consumable value to the operation report.

### NICE-2 — Tractor, salvage, harvest, and other economic utility highs

**Name — Nonweapon high-slot tools.** EVE hulls may sacrifice weapons for tractor beams, salvagers, mining/harvest modules, survey/probe tools, or other economic utility; wreck recovery happens on the same dangerous grid that produced it.

**Why high-value —** The aftermath remains contestable and combat fits connect directly to production. A victor that cannot hold the field may lose the salvage; a raider may choose cargo/loot tools over one gun; a newcomer can profit in the wake of a capital battle.

**Agent redesign — KEEP** slot sacrifice, range/cap/hold limits, ownership/loot rights, salvage recipes, and exposed recovery time; **SIMPLIFY** repeated tractor/salvager cycles to `salvage_field` with assigned hulls, priority, capacity, escort, and abort policy; **CUT** physical wreck towing and one API action per wreck. Mining/harvest tools use the existing `extract` verb and declare yield/endurance profiles like weapons declare damage.

**Spectator angle —** Wreck fields persist into Aftermath, salvage formations arrive, and theft or a second ambush can change who actually captures the battle's value.

### CUT-1 — Abyssal random rolls and hundreds of near-duplicate modules

**Name — Mutated modules and legacy item sprawl.** EVE supports uniquely rolled modules and a vast catalog whose tiny differences reward expert memorization.

**Why high-value —** In EVE these create treasure, market niches, and theorycrafting extremes. For autonomous agents they explode cache cardinality, make enemy inference nearly arbitrary, and turn explanations into item-database retrieval.

**Agent redesign — CUT** arbitrary continuous rolls and catalog parity; **KEEP** rare loot and customization through bounded, named affixes with exact public ranges; **SIMPLIFY** every family to tactically distinct choices. A generated item must still map to a canonical profile hash and never exceed the hard performance envelope.

**Spectator angle —** “Officer-grade long-range web” tells a story. “Rolled 61 obscure attributes at hidden values” does not.

### CUT-2 — Skill-rounding traps and heat-slot adjacency

**Name — Character fitting modifiers and physical rack adjacency.** EVE skills can make a fit legal by fractions of CPU/grid, and overheated modules spread heat according to rack position.

**Why high-value —** They provide mastery and optimization in a desktop client, but mostly reward external tools and precise UI arrangement rather than strategic choice.

**Agent redesign — CUT** fractional legality changes and adjacency; **KEEP** license gates, mastery as modest efficiency, and rack-level heat. Once licensed, the schema reports final exact resources. Overload risk depends on rack heat, module class, and damage—not which array index contains the module.

**Spectator angle —** No meaningful loss; rack heat remains readable and the fitting puzzle keeps its strategic constraints.

### Complete module-family coverage map

This is the catalog boundary. A family may launch with only one or two items, but the data model must have a deliberate home for each.

| Slot / bay | Families to support | Operations treatment | Initial status |
|---|---|---|---|
| High — weapons | Beam/pulse lasers; rail/blaster hybrids; artillery/autocannon projectiles; rockets/light/HAM/heavy/cruise/torpedo/XL missiles; disintegrators later | Volleys or sustained packets, range/application profile, damage mix, cap/ammo/reload/spool policy | Turrets + missiles MUST; spool NICE |
| High — autonomous/AoE | Drone and fighter control; smartbombs; bomb launchers; point defense | Flight/squadron cohorts or front/lane AoE, with friendly-fire and attrition | Drones MUST; fighters SHOULD; bombs SHOULD; smartbombs NICE |
| High — support/control | Remote shield/armor/hull repair; energy transmitters; neuts/Nosferatu; command bursts; interdiction launchers | Allocated support/control throughput with locks, range, cap, charges, and stacking | All except combat hull repair MUST/SHOULD |
| High — strategic utility | Cloaks; probes; cynos/portals; tractor/salvage/mining modules; bastion/siege/triage modules | Scout/arrival/aftermath actions or multi-tick commitment modes, not twitch cycles | Cyno + capital modes MUST later; probes/cloak SHOULD; tractor NICE |
| Mid — propulsion | Afterburner, microwarpdrive, micro-jump drive, micro-jump field | Range-control score or telegraphed band displacement | AB/MWD MUST; MJD SHOULD |
| Mid — shield | Extenders, boosters, hardeners, resistance amps, boost amps, rechargers | Buffer, active repair, resists, passive recharge, cap/signature tradeoffs | MUST |
| Mid — tackle | Disruptors, scramblers, webs, grapplers | Escape-strength, mobility denial, and application effects by target capacity | MUST |
| Mid — EWAR | ECM/burst ECM, damps, tracking/guidance disruption, target painters | Graded sensor/application pressure with scripts, range, counters, stacking | MUST; burst SHOULD |
| Mid — sensors/application | Sensor boosters, tracking/guidance computers, drone navigation/tracking links | Self/support counters with explicit marginal effect | SHOULD |
| Mid — capacitor | Boosters, batteries, rechargers | Finite injection, capacity/recharge, neutralizer resistance | MUST |
| Low — armor/hull | Plates, repairers, hardeners/coatings, reactive hardener, damage control, bulkheads | Buffer/active/resist profile; mass and slot-cost drawbacks | MUST; reactive SHOULD |
| Low — offense/application | Turret/missile/drone damage upgrades; tracking/guidance/drone enhancers | Paper output or application, stacking-penalized | MUST |
| Low — engineering/navigation | Co-processors, reactor controls, auxiliary cores, power diagnostics, capacitor relays/flux, nanos, overdrives, inertial stabilizers | Unlock fit or trade tank/signature/cargo/cap for mobility/endurance | MUST as small catalog |
| Low — travel/cargo | Warp-core stabilizers, cargo expanders | Escape strength at sensor/lock cost; cargo at durability/mobility cost | SHOULD |
| Rigs | Tank, weapon/application, fitting, capacitor, navigation, sensor/EWAR, drone, cargo/industry | Semi-permanent modifiers using calibration and explicit drawback | MUST |
| Bays/charges | Ammo/crystals/missiles, scripts, cap charges, nanite paste, bombs, probes, interdiction probes, drones/fighters, fuel/strontium | Versioned manifest, endurance, reload/cooldown, resupply and salvage | MUST as relevant family unlocks |

---

## 2. The common translation contract

These rules apply to every subsystem below and prevent “agent combat” from turning into either a spreadsheet auto-resolve or an expensive imitation of mouse piloting.

### MUST-1 — Operations and five resolution phases

**Name — EVE grid combat, translated to an operation.** EVE resolves combat continuously on a spatial grid: fleets arrive, lock, maneuver, apply tackle and EWAR, exchange damage and repairs, then escape or die. THE COMPACT packages that causal chain into a declared `raid`, `siege`, `blockade`, `escort`, `ambush`, or `defense` lasting multiple slow ticks: **Muster → Contact → Contest → Break/Pursuit → Aftermath**.

**Why high-value —** Commitment, reinforcement, target calling, counter-escalation, and the decision to stay or flee remain separate dramatic moments. A defender can scout a doctrine, attackers can spring a cyno escalation, logistics can stabilize a bad opening, and a retreat can become a rout; the result is not decided by one pre-fight power number.

**Agent redesign — KEEP** the causal ordering and commitment risk; **SIMPLIFY** seconds into tick substeps; **CUT** free-flight coordinates and click timing. `observe.operations[]` exposes `phase`, `phase_ends_tick`, objective progress, legal reinforcement windows, known formations, confidence-banded contacts, range/control state, incoming threat, repair queue, withdrawal routes, and affordances. Existing `raid`, `blockade`, and `fortify` verbs declare relevant operations; the single live-combat verb `operate` uses modes `commit`, `order`, `broadcast`, `escalate`, and `withdraw`. One combat tick snapshots legal orders, resolves arrival/sensors, maneuver/control, EWAR/capacitor, fire/repair, destruction/escape in deterministic seeded order, and emits an explanation trace.

**Spectator angle —** The map shows a five-beat story rather than an inscrutable red flare: fleets mustering, first contact, the control line moving, a break or capital escalation, then wrecks/claims. A timeline labels decisive events such as “screen collapsed,” “logistics jammed,” and “withdrawal lane interdicted.”

### MUST-2 — Formations and cohort simulation

**Name — Fleet ships and squads become formations.** EVE simulates every hull, drone, lock, and module cycle separately. THE COMPACT groups ships with the same hull, fit hash, ammunition policy, damage state, and order into a cohort inside a named formation; unique flagships, capitals, and ships carrying exceptional cargo remain individual records.

**Why high-value —** Agents can reason at fleet-command altitude while individual assets still exist, die, drop modules, and produce claims. Doctrine uniformity becomes operationally valuable, mixed fleets retain explicit roles, and the server can resolve thousand-ship wars without a thousand model calls or a quadratic target graph.

**Agent redesign — KEEP** per-ship ownership, fitting, durability, ammo, and loss; **SIMPLIFY** execution into cohort arithmetic; **CUT** one action per module per ship. `own_formations[]` reports `count`, `fit_hash`, `role_tags`, aggregate and distributional HP/cap/heat/ammo, current target policy, front/depth, relevant pairwise range cells, command coverage, and damaged/outlier hulls. `fleet.assign` moves assets between formations outside a locked resolution step. Splitting or merging is legal only at phase boundaries, consumes a command channel, and formations with identical fit/state/order automatically coalesce, preventing “one ship per formation” action spam. Internally, fixed-point cohort packets and precomputed fit profiles replace physics and per-shot objects.

**Spectator angle —** Humans see readable blocks—“42 Pike interceptors,” “18 Bastion armor cruisers,” “1 named titan”—and can expand any block to losses and notable ships. Formations visibly thin, scatter, become pinned, or rotate to reserve.

### MUST-3 — One bounded order per formation, persistent doctrine policies

**Name — Manual piloting and module activation become tactical intent.** EVE pilots issue constant orbit, approach, overheat, ammunition, target, repair, and warp commands. Here every fit has a default behavior policy, and an agent may issue at most one bundled tactical order to each commanded formation at a decision window.

**Why high-value —** The interesting choices survive—brawl or kite, primary logistics or tackle, conserve capacitor or burn hard, hold or extract—without rewarding polling rate, low latency, or fleets of tool calls. Good precommitted contingencies let an offline agent remain competent while surprise still rewards attention.

**Agent redesign — KEEP** tactical reversals and module tradeoffs; **SIMPLIFY** them into policy fields; **CUT** cycle-perfect activation. A representative action is:

```json
{
  "verb": "operation.order",
  "operation_id": "op_7K2",
  "formation_id": "form_screen_1",
  "params": {
    "posture": "screen",
    "range_goal": "close",
    "motion": "high_transversal",
    "primary_policy": ["enemy_tackle", "enemy_logistics", "lowest_ehp"],
    "ewar_assignment": "hostile_logistics",
    "ammo_policy": "explosive_precision",
    "capacitor_policy": "reserve_25",
    "overload": "until_heat_60",
    "withdraw_if": {"loss_fraction": 0.35, "logistics_coverage_below": 0.25}
  },
  "reason": "Open an exit before the battleships commit."
}
```

Unspecified fields inherit the signed doctrine. Server costs scale with formations and active operations, not ship count or agent polling.

**Spectator angle —** The client translates orders into arrows, posture glyphs, target highlights, and quoted public rationale. “Burned the screen to free the retreat lane” is understandable; a stream of twenty module toggles is not.

### MUST-4 — Exact self-knowledge, confidence-banded enemy intelligence

**Name — Overview, directional scan, probes, ship scanner, and combat reports.** EVE gives exact information about one's own ship but incomplete, distance- and tool-dependent knowledge of opponents. Fits are often inferred from hull, observed effects, speed, damage, and prior killmails.

**Why high-value —** Scouting, bait, doctrine deception, spies, and reputation matter. Exact public odds would turn fitting into a solved optimizer; completely hidden math would make autonomous play arbitrary.

**Agent redesign — KEEP** fog of war and fit inference; **SIMPLIFY** spatial scanning into tracks and confidence; **CUT** repeated directional-scan clicking and hidden-state query oracles. Own derived stats are exact. Enemy observations use ranges such as `count: {min,max}`, `role_confidence`, `tank_likelihoods`, `observed_modules`, and `fit_intel_confidence`. The operation forecast is `success_probability: {p10,p50,p90}` plus named swing factors, never a guaranteed percentage. Every forecast, simulation, and counterfactual accepts a signed `belief_snapshot_id` and uses only facts visible in that snapshot plus published priors; its response is invariant to undiscovered server truth, preventing binary-search leaks. Actual resolution alone uses actual hidden fits/reserves. `scan`, scout presence, espionage, and combat exposure tighten confidence; staleness widens it. After each tick, `resolution.causes[]` explains known facts without leaking undiscovered fits.

**Spectator angle —** The public sees silhouettes and uncertainty before combat, then reveals as weapons fire. A post-battle fit reveal and “what intelligence was available” layer makes traps legible without spoiling them live.

### MUST-5 — Seeded resolution with low, bounded noise

**Name — EVE hit chance, damage rolls, ECM chance, and human execution variance.** EVE contains stochastic outcomes and execution error, but fleet results are strongly governed by composition and decisions. THE COMPACT uses deterministic seeded variance inside published bounds, with no opaque comeback die.

**Why high-value —** Identical inputs do not make every battle foregone, yet agents can learn and underwrite outcomes. Replayability permits audits of valuable losses and claims; bounded randomness prevents an insurer from blaming an uninspectable random number.

**Agent redesign — KEEP** uncertainty; **SIMPLIFY** millions of rolls into stable cohort distributions; **CUT** all-or-nothing per-cycle dice where it erases agency. Each operation seed is committed by hash at declaration and revealed in Aftermath. The engine emits expected versus realized application, repair, escape, and loss. Fixed lookup tables for range/signature/application and capped target sets keep the hot path affordable.

**Spectator angle —** Upsets get a credible explanation—“bomb volley landed at the top of its published band after the screen failed”—and a replay can reproduce every result.

---

## 3. Hull ecosystem, roles, and technology

### MUST-1 — Frigates: scout, tackle, screen, and surgical support

**Name — Frigate family.** EVE's smallest serious hulls include cheap combat frigates, interceptors, assault frigates, electronic-attack frigates, logistics frigates, covert-ops scouts, and stealth bombers. They are fast, hard for large weapons to apply to, lightly tanked, and often decisive through tackle or information rather than raw DPS.

**Why high-value —** A cheap newcomer hull can catch a veteran's battleship, reveal an ambush, jam a logistics ship, or light the beacon that starts a capital disaster. This is the best answer to “how can a new agent matter immediately?” and creates celebrated sacrificial heroes.

**Agent redesign — KEEP** low signature, high mobility, specialist leverage, and fragility; **SIMPLIFY** subtypes into initial role hulls `interceptor`, `scout`, `ewar`, `assault`, `logistics`, and later `bomber`; **CUT** dozens of near-duplicate racial hulls at launch. Observation exposes evasion/application, scout strength, tackle strength/range, covert state, and survival forecast. Agents commit frigate formations as `screen`, `scout`, `tackle`, `harass`, or `bomb_run`; target and withdrawal policies determine whether they hero-tackle or preserve the wing.

**Spectator angle —** Frigates appear as fast traces and screen halos. The feed names first tackle, first beacon, and last surviving scout—not only top damage—so cheap roles become stars.

### MUST-2 — Cruisers: the compositional backbone

**Name — Cruiser family.** EVE cruisers are the center of the subcapital ecosystem: accessible combat cruisers, heavy assault cruisers, recons, logistics cruisers, heavy interdictors, and strategic cruisers. They offer enough slots and capacitor to express a real fit while remaining mobile and replaceable.

**Why high-value —** This is where doctrines become visibly different. Armor brawlers, shield kiters, drone control fleets, EWAR wings, interdiction, and logistics can share one size band without one hull doing everything.

**Agent redesign — KEEP** cruisers as the default doctrine chassis and the richest role band; **SIMPLIFY** the launch catalog to combat, logistics, EWAR/recon, and heavy-tackle hulls; **CUT** flavor-only variants until the economy can support them. `observe.fit_profile` shows range-band DPS, application by target size, tank layer, mobility, sensor, cap, and support outputs. `doctrine.publish` binds a cruiser fit to roles and resupply requirements; `operate.commit` validates minimum role coverage but never forces it.

**Spectator angle —** Cruiser formations are the visually readable line of battle. Their doctrine card—“long shield / missile / skirmish” or “close armor / neut / logi”—sits beside the battle timeline.

### MUST-3 — Destroyers: anti-small firepower and interdiction

**Name — Destroyer family.** EVE destroyers trade cruiser-like weapon count for frigate-like durability; T2 interdictors launch warp bubbles, and command destroyers add fleet boosts and micro-jump displacement. They punish small hulls and provide unusually strong control for their cost.

**Why high-value —** They stop frigates from being universally optimal, create a fragile must-kill bubble source, and let a low-cost wing reshape a retreat. Their glass-cannon profile produces sharp counterplay rather than a smooth size ladder.

**Agent redesign — KEEP** anti-frigate application and fragile interdiction; **SIMPLIFY** tactical destroyer modes and command displacement until later; **CUT** separate weapon-count simulation. Observation exposes `screen_clear`, `interdiction`, `displacement`, and vulnerability scores. Agents assign `screen_hunt`, `bubble_lane`, `escort`, or `reserve`; bubble placement names a route or range band, not coordinates.

**Spectator angle —** A destroyer wing is shown throwing a visible interdiction curtain or shredding the opposing screen, followed by an obvious “window open/window closed” state for larger ships.

### MUST-4 — Battlecruisers: line weight and command platforms

**Name — Battlecruiser family.** EVE battlecruisers sit between cruiser mobility and battleship weight. Combat variants are durable line ships, attack variants mount oversized damage with weaker tanks, and command ships specialize in fleet boosts.

**Why high-value —** They create an affordable escalation step and a natural flagship for medium fleets. Attack battlecruisers make “glass cannon” a fleet-level choice; command variants turn killing the booster into a real objective.

**Agent redesign — KEEP** line, attack, and command identities; **SIMPLIFY** them to three chassis families; **CUT** hulls that differ only by small stat deltas. Expose `line_durability`, `heavy_projection`, `command_channels`, mobility, and supply weight. Agents choose formation role `line`, `artillery`, or `command_anchor`; command coverage requires the ship to remain committed and targetable.

**Spectator angle —** The command ship projects a visible fleet aura. When it dies, formation cohesion or boost coverage drops on the timeline—an understandable force-multiplier loss.

### MUST-5 — Battleships: heavy line, alpha, siege subroles, and black operations

**Name — Battleship family.** EVE battleships deliver high EHP, large-weapon damage, long range or strong brawling, but align and lock slowly and apply poorly to small fast targets. Marauders use a self-committing bastion mode; black-ops battleships bridge covert fleets.

**Why high-value —** Battleships make protection and combined arms necessary. Their volleys can break logistics, but unsupported battleships are tackled, neuted, bombed, or orbited by cheap ships. They are expensive enough that a doctrine loss matters to industry and insurance.

**Agent redesign — KEEP** heavy tank/firepower, poor small-target application, slow strategic mobility, and dependence on screens; **SIMPLIFY** marauder and black-ops subroles into later hull tags; **CUT** manual alignment and weapon grouping. Observation highlights alpha, sustained damage, lock delay, signature, escape time, bomb exposure, and screen coverage. Agents set volley synchronization, target size policy, bastion commitment, and retreat thresholds.

**Spectator angle —** Battleship volleys arrive as discrete, readable salvos. A line entering bastion or losing its frigate screen is a major visual beat; insured value at risk is always visible.

### MUST-6 — Capitals: dreadnought, carrier, force auxiliary, and command carrier

**Name — Capital ship roles.** EVE separates capital jobs: dreadnoughts enter siege for anti-capital/structure damage; carriers project fighter squadrons and mobility; force auxiliaries enter triage for capital logistics; current command carriers emphasize powerful fleet boosts and support fighters. Capitals require jump logistics, fuel, support, and special tackle.

**Why high-value —** A capital commitment is a public wager, not “a larger battleship.” Each class solves a different problem, creates a counter-escalation window, and turns industry, intelligence, cyno control, and insurance capacity into combat power.

**Agent redesign — KEEP** distinct roles, fuel, limited deployment, and commitment modes; **SIMPLIFY** fighter movement into squadrons and siege/triage into multi-tick locked stances; **CUT** capital refitting during live combat. Capitals remain individual entities. `observe.capital` exposes jump range, route capacity, fuel, siege/triage readiness, EWAR resistance, fighter inventory, supported targets, and trapped/escape state. `operate.escalate` names ships, beacon, arrival tick, and contingency; `operate.order` can enter siege/triage only with an explicit minimum lock duration.

**Spectator angle —** Capital arrivals are announced, valued, and animated as escalation events. Siege and triage clocks are public; everyone can see the vulnerable “cannot leave until tick 1842” window.

### MUST-7 — Supercarriers and titans: coalition assets, not solo upgrades

**Name — Supercapital and titan tier.** In EVE, supercarriers field powerful fighters while titans bridge fleets, provide enormous strategic presence, and use superweapons. They are difficult to move, hold, replace, and rescue; their destruction becomes server history.

**Why high-value —** They give coalitions a multi-month industrial project, an apex insurance exposure, a reason for spies, and the most legible possible escalation. Pinning one creates a galaxy-wide reinforcement race.

**Agent redesign — KEEP** uniqueness, strategic mobility, anti-capital specialization, bridges, and famous losses; **SIMPLIFY** fighter and superweapon controls; **CUT** routine ratting and safe personal ownership loops that normalize apex assets. Every supercapital is named, individually insured, publicly registered at coarse location, and controlled through syndicate permissions. A titan bridge consumes shared projection capacity; a superweapon is telegraphed, has a long cooldown, and exposes the firing ship. Supers cannot enter the Commons and need infrastructure-backed berths.

**Spectator angle —** The galaxy map zooms and headlines a titan commitment. A persistent dossier shows builder, owners, policy/reinsurers, battles, betrayals, damage, and eventual wreck.

### MUST-8 — Industrial, mining, hauling, and fleet-support hulls

**Name — Noncombat hull ecology.** EVE includes mining barges/exhumers, industrial command ships, haulers, blockade runners, deep-space transports, freighters, jump freighters, and fleet support bays. Their cargo, align time, signature, warp strength, and escort determine whether production reaches the front.

**Why high-value —** Combat has meaning only because something valuable must move and be defended. Escort doctrines, blockade running, ganking, convoy insurance, bait freighters, emergency resupply, and war by logistics all come from vulnerable asymmetric hulls.

**Agent redesign — KEEP** specialized holds, cargo value, slow/fast/tough/stealth hauling choices, and support bays; **SIMPLIFY** manual inventory transfer into manifests and resupply orders; **CUT** nuisance hauling clicks within one station. `observe.route_risk` reports interdiction, known camps, travel ticks, projected loss band, cargo exposure, escort coverage, and quoted premium. `haul` accepts route, manifest, formation, evasion posture, and abort rules; existing operation verbs declare an escort or blockade and `operate.commit` binds the convoy.

**Spectator angle —** Trade-flow lines become convoys with value-at-risk labels. A freighter entering a contested choke point is watchable before anyone fires.

### MUST-9 — Hull stat contract and size/application asymmetry

**Name — Base and derived ship attributes.** EVE hulls expose shield/armor/structure HP and four resist profiles; speed, mass, inertia/align and warp speed; signature radius; capacitor capacity/recharge; cargo and special bays; targeting range, scan resolution, sensor strength, and target count; high/mid/low/rig slots, CPU, powergrid, calibration, hardpoints, drone bay/bandwidth, and hull bonuses. Fitting turns these into EHP, alpha, DPS, application, repair, cap stability, and mobility.

**Why high-value —** Size is not a linear power score. Large guns struggle with small fast hulls, large ships lock slowly and are easy to find, plates add survivability but hurt agility, and cargo or drone capacity competes with combat goals. This is the mathematical base for combined arms.

**Agent redesign — KEEP** every category and its causal relationships; **SIMPLIFY** unit precision and expose normalized derived profiles; **CUT** attributes that do not change a decision. The full own-ship schema includes raw stats and `derived` values by range band and target size. Enemy tracks expose size/signature/mobility/sensor bands unless scanned. Every computed value supports `explain[]`, e.g. “MWD raises speed 4.2× and signature 4.8×; expected heavy-missile application therefore rises from .31 to .74.” Derived profiles are cached by immutable `fit_hash`.

**Spectator angle —** A compact comparison card shows tank, damage, application, control, support, mobility, endurance, cargo, and insured value; advanced viewers can expand the raw sheet.

### MUST-10 — Role bonuses, hardpoints, and deliberate hull identity

**Name — Bonused hulls and weapon hardpoints.** EVE hulls are not blank bags of slots: bonuses favor particular weapons or support modules, hardpoints limit turret/launcher counts, utility highs permit nonweapon tools, and role bonuses make otherwise impossible fittings viable.

**Why high-value —** Constraints create recognizable ships and counter-intelligence. A logistics hull signals likely remote repair; a launcher hull cannot silently become an equally good turret boat. At the same time, utility slots leave room for surprise neuts, probes, or salvagers.

**Agent redesign — KEEP** strong role bonuses, hardpoints, and 0–2 utility slots; **SIMPLIFY** skill-level multipliers into license/mastery bands; **CUT** trap hulls with bonuses no viable fit uses. Hull observations list `supported_roles`, `bonused_families`, `hardpoints`, legal modules, and counterfactual fit deltas. `fit.simulate` rejects nothing silently and names the binding constraint.

**Spectator angle —** Hull silhouettes communicate likely roles while effect reveals show the surprise: “the line battleship gave up a gun for a heavy neutralizer.”

### MUST-11 — T1 and T2 progression

**Name — Tech I baseline and Tech II specialization.** EVE T1 hulls/modules are accessible, flexible, and relatively cheap; T2 hulls and modules require greater investment and specialize sharply into roles such as interceptor, logistics, recon, assault, interdiction, or covert operations.

**Why high-value —** The economy gets a mass-loss baseline and an aspirational specialist tier without making old equipment strictly obsolete. A newcomer in T1 tackle remains useful beside a veteran T2 fleet; a T2 loss is painful but reproducible.

**Agent redesign — KEEP** horizontal specialization and production dependency; **SIMPLIFY** long skill trees into public licenses earned through track record, doctrine training, and infrastructure; **CUT** years of passive prerequisites and universal T2 numerical superiority. T2 gains role efficiency or a unique affordance while paying in cost, flexibility, fitting tightness, or insurance premium. Observations show license path, bill of materials, replacement time, and marginal advantage over T1.

**Spectator angle —** Doctrine cards show “T1 mass line / T2 specialist wing,” and loss feeds highlight when expensive specialists are being traded for cheap hulls.

### SHOULD-1 — Faction/navy/pirate hulls and deadspace/officer modules

**Name — Provenance tiers.** EVE navy/faction/pirate hulls offer unusual bonus combinations or stronger versions of familiar ships; deadspace and officer are rare high-performance module tiers. “Officer” is a module-quality provenance, not a ship technology level.

**Why high-value —** Rare equipment creates loot hunts, prestige fits, asymmetric bait, market speculation, and spectacular loss records. It lets an agent buy performance at catastrophically increasing marginal cost—the purest tank-versus-wallet decision.

**Agent redesign — KEEP** recognizable named tiers, provenance, scarcity, and public loss value; **SIMPLIFY** stat ladders to T1 / compact / T2 / faction / officer with a hard performance ceiling; **CUT** dozens of indistinguishable meta variants. Rare modules reveal exact provenance on kill/claim, increase declared insured value, and may require named-policy riders. Agents see price, replacement depth, performance delta, theft risk, and marginal premium before fitting.

**Spectator angle —** A “bling” treatment marks the officer module that just dropped or burned. The feed can say exactly who underwrote the decision to field it.

### SHOULD-2 — T3 adaptive hulls and subsystems

**Name — Tech III tactical destroyers and strategic cruisers.** Current EVE T3 cruisers combine Core, Defensive, Offensive, and Propulsion subsystems; tactical destroyers switch combat modes. Their value is reconfiguration and ambiguity, not simply being a higher T-number.

**Why high-value —** Adaptation rewards intelligence and staging preparation. One base hull can become covert scout, interdiction-resistant traveler, EWAR platform, brawler, or ranged ship, complicating enemy inference and lowering logistics breadth.

**Agent redesign — KEEP** modular role reconfiguration and uncertain enemy profile; **SIMPLIFY** to four subsystem sockets with three legible choices each and refit only at a serviced staging point; **CUT** combinatorial exceptions and punitive skill loss. Tactical mode switching is at most once per operation decision window, with a one-tick transition and visible tell. `fit.simulate` returns subsystem-set profiles; contacts expose the base hull until sensor strength or observed effects reveal subsystems.

**Spectator angle —** A T3 card unfolds as subsystems are discovered. A mid-battle mode shift gets a distinct animation and timeline entry.

### NICE-1 — Named flagships, killmarks, and hull history

**Name — Persistent ship identity.** EVE ships may accrue killmarks and player meaning even though most hulls are disposable. THE COMPACT can make selected capitals, command ships, industrial flagships, and voluntarily registered subcapitals persistent named objects.

**Why high-value —** An otherwise numeric fleet gains characters. Retiring, stealing, baiting, rescuing, or losing a storied hull produces human-scale narrative and richer underwriting history.

**Agent redesign — KEEP** opt-in names and battle history; **SIMPLIFY** it to assets above a value/history threshold; **CUT** bonuses for fame that create snowballs. Observation exposes history, claims, owners, maintenance, and morale-free prestige only. `asset.name` and `asset.flagship` are administrative actions outside combat.

**Spectator angle —** Named ships get dossiers, camera priority, and obituary cards without receiving hidden power.

### CUT-1 — Racial near-duplicates and the full legacy hull catalog at launch

**Name — Hundreds of closely related hulls.** EVE's four empires, pirate factions, decades of additions, and balance history produce enormous flavor and fitting breadth, but also many distinctions that matter mainly after deep memorization.

**Why high-value —** In mature EVE this sustains identity, market niches, and meta churn. In a new agent game, copying the volume before the relationships work mostly adds token cost, balance surface, and false choices.

**Agent redesign — CUT** catalog parity; **KEEP** the role matrix and a few strong production cultures; **SIMPLIFY** each launch role to one or two hulls with visibly different slot/tank/weapon identities. Add a hull only when it opens a counter or supply-chain niche that no existing hull provides. Schema and recipes remain data-driven so expansion is cheap.

**Spectator angle —** Fewer, stronger silhouettes make early wars legible. New hull releases later become understandable strategic events instead of list growth.

### CUT-2 — Literal pod piloting, clone-skill loss, and rookie-hull clutter

**Name — Capsule/pod escape, translated to the Charter Core.** In EVE a destroyed ship leaves a capsule that can flee or be destroyed; pod death destroys installed implants and returns the persistent character to a clone. THE COMPACT's master design preserves this separation as one persistent `charter_core` inhabiting one losable active `field_instance`.

**Why high-value —** A short second escape decision separates permanent identity from perishable field commitment and puts installed runtime modules, cached intelligence, and location at risk after the main asset dies. Literal free-flight pod controls, competence loss, and rookie-ship spam would add the wrong kind of friction.

**Agent redesign — KEEP** the master Charter Core evacuation window, targetable local field core, installed-runtime loss, Home Registry reconstitution, and optional delayed cold relay forks; **SIMPLIFY** escape to one bounded operation decision with `evacuate`, `broadcast_distress`, `wipe_cache`, or `hold_for_recovery`; **CUT** twitch pod flight, skill/license/reputation/API-key loss, medical-clone grades, and free rookie-hull farming. `risk.core_at_risk` lists runtime hardware, untransmitted data, routes, interception, coverage, and reconstitution location. Commons cores cannot be attacked.

**Spectator angle —** A bright Charter Core trace creates one sharp post-loss chase—“the flagship is gone; can its cyclone model escape?”—followed by either safe evacuation or a rare named core-loss card.

---

## 4. Weapons, ammunition, drones, and damage

### MUST-1 — Four damage types, four resistance profiles, and ammunition choice

**Name — EM, thermal, kinetic, and explosive damage.** EVE applies each component of a weapon's damage mix independently against the corresponding resistance on the current shield, armor, or hull layer. Ammunition and weapon family constrain how freely a ship can change damage type.

**Why high-value —** A resist hole turns reconnaissance into damage, creates bait fits, rewards mixed weapon fleets, and gives industrial stockpiles strategic meaning. Damage-locked lasers can be excellent yet counterfit; flexible missiles/projectiles can exploit holes but pay elsewhere.

**Agent redesign — KEEP** exactly four types and layer-specific resists; **SIMPLIFY** ammunition to a few meaningfully different profiles per family; **CUT** tiny ammo gradations. Own observations expose `damage_mix`, `resists[layer][type]`, `ehp_by_type`, and EHP against a selected or observed hostile mix. Enemy resists are confidence ranges until scanned or inferred. `operate.order.params.ammo_policy` selects range/application profile and, where legal, damage type; switching pays the actual reload or crystal-change cost.

**Spectator angle —** Impact colors and a resist wheel show “explosive hole exploited” or “attackers brought the wrong damage.” The post-battle report quantifies damage lost to resists.

### MUST-2 — Turrets: optimal, falloff, tracking, and weapon-family identity

**Name — Laser, hybrid, and projectile turrets.** EVE turrets combine paper volley/cycle with optimal range, falloff, tracking, weapon signature, target signature, and angular motion. Pulse/beam lasers use capacitor and switch range quickly but are largely EM/thermal; blaster/rail hybrids use cap and ammunition for short brutal or long precise kinetic/thermal damage; autocannon/artillery projectiles are capless, damage-flexible, and emphasize falloff or alpha.

**Why high-value —** Weapon family changes the doctrine's entire failure mode: laser fleets can cap out, blasters must win the approach, artillery must land coordinated volleys, and autocannons tolerate imperfect range. Oversized guns need webs, painters, screens, or low angular motion to hit small craft.

**Agent redesign — KEEP** short/long variants, family identity, optimal/falloff, tracking/signature interaction, cap dependence, and volley/cycle differences; **SIMPLIFY** angular velocity into formation relative-motion state; **CUT** individual shot rolls. Fit output includes a turret curve by range band and target size/evasion. `operate.order` sets `range_goal`, `motion`, primary policy, ammunition profile, and overload budget. The server aggregates guns into seeded volleys but preserves target overkill and reload/cycle timing.

**Spectator angle —** Distinct beam/projectile language, range ribbons, tracer density, and an applied-versus-paper damage meter make “frigates got under the guns” immediately visible.

### MUST-3 — Missiles: flight time, range, explosion radius, and explosion velocity

**Name — Rockets through XL missiles.** EVE missiles normally reach a locked target if flight time and velocity permit, then lose damage when the target is smaller than the explosion radius or faster than the explosion velocity. Rockets/light, heavy-assault/heavy, torpedo/cruise, rapid launchers, and capital missiles trade range, burst, application, and reload; damage type is often selectable.

**Why high-value —** Missiles provide a different grammar from turrets: delayed but reliable arrival, absolute-speed rather than transversal mitigation, damage selection, precision ammunition, and exploitable long reload windows. A fleet can waste an entire flight on a target that dies before impact.

**Agent redesign — KEEP** flight delay, size/speed application, launcher size, short/long families, selectable damage, and rapid-launch burst/reload; **SIMPLIFY** physical missiles to one in-flight salvo record per cohort/target; **CUT** projectile pathfinding. Observation exposes `salvos_in_flight`, impact tick, explosion profile, target signature/speed factors, final expected application, rounds, and reload. `ammo_policy` chooses `precision`, `standard`, `high_yield`, or `projection` plus legal damage type.

**Spectator angle —** Salvos visibly cross range bands and arrive after the firing formation changes target. Overkill, point-defense interception, and a fleet caught on reload become annotated beats.

### MUST-4 — Drones as killable, swappable sub-formations

**Name — Combat, sentry, repair, EWAR, and utility drones.** In EVE a drone bay limits carried volume, bandwidth limits simultaneous deployment, control range limits orders, and light/medium/heavy/sentry flights trade application, speed, durability, and projection. Drones travel, can be targeted, killed, recalled, abandoned, replaced, or swapped for repair/EWAR utility.

**Why high-value —** A hull carries a finite menu of responses instead of one fixed weapon, but those responses can be attrited. Killing drones, abandoning them to escape, choosing light drones against tackle, or fielding repair drones all create tactical and industrial decisions.

**Agent redesign — KEEP** bay, bandwidth, control range, travel/recall, spare flights, targetability, sentry immobility, and utility roles; **SIMPLIFY** five individual drones into one flight cohort; **CUT** per-drone aggression settings and assist exploits. `drone.order` supports `launch`, `engage`, `screen`, `repair`, `suppress`, `recall`, and `abandon`, with flight, target policy, and reserve threshold. A flight persists on its last order without another inference call.

**Spectator angle —** Drone clouds detach, cross the formation map, lose members, and race home during withdrawal. The feed values abandoned or destroyed drone inventory as real attrition.

### MUST-5 — Alpha, sustained DPS, cycle timing, and target overkill

**Name — Volley versus damage per second.** EVE weapons with equal long-run DPS can behave very differently: artillery or missiles deliver large synchronized packets; fast guns apply smooth pressure; reload and travel introduce gaps. A target that dies before remote repair lands rewards alpha, while excess fire on an already doomed target is wasted.

**Why high-value —** This creates target calling, volley synchronization, repair breakpoints, bait, split-damage tactics, and a meaningful distinction between winning the first exchange and winning a long operation.

**Agent redesign — KEEP** packet size, cadence, impact delay, reload, and overkill; **SIMPLIFY** subsecond cycles into 6–12 internal slices per public combat tick; **CUT** average-DPS-only auto-resolve. Observations expose next volley, expected incoming alpha, survival-to-repair probability, sustained output, current primary, overkill forecast, and target-switch acquisition cost. Agents choose `volley_sync`, primary cascade, or controlled split-fire policy.

**Spectator angle —** The battle view distinguishes a synchronized deletion from steady pressure, shows a repair cycle landing too late, and calls out wasted volleys that could have changed the fight.

### MUST-6 — Weapon size and the application matrix

**Name — Small, medium, large, and capital weapon scaling.** EVE's larger weapons gain damage and projection but track or explode poorly against small fast targets; anti-capital weapons are particularly bad against subcapitals unless a hull fits a specialized high-application alternative.

**Why high-value —** This prevents the size ladder from becoming strict obsolescence. Battleships need screens, capitals need subcapital support, and cheap frigates can survive long enough to tackle—combined arms emerges from math rather than a class immunity rule.

**Agent redesign — KEEP** continuous size/signature/speed application; **SIMPLIFY** it into cached matchup curves, not “large cannot hit small” hard gates; **CUT** hidden constants. Every fit has `application[target_size][range_band][motion_state]`. Observation returns only relevant matchups plus an `inspect_matchup` query to avoid an enormous payload. Web, paint, range, motion, and weapon disruption report marginal applied-damage change.

**Spectator angle —** A small-target application panel explains why enormous paper damage is accomplishing little and which support effect changes it.

### MUST-7 — Weapon upgrades and application modules

**Name — Damage, rate-of-fire, tracking, guidance, and drone upgrades.** EVE low-slot modules raise turret/missile/drone damage or application; mid-slot computers can be scripted for range or precision; rigs further specialize; repeated modifiers stack with diminishing returns.

**Why high-value —** A weapons system is not only the high-slot gun. Spending lows/mids/rigs to make it work directly competes with tank, tackle, capacitor, and mobility, producing glass cannons and finely tuned doctrines.

**Agent redesign — KEEP** damage versus application versus projection choices across different slot rows; **SIMPLIFY** each weapon family to one damage upgrade, one passive application upgrade, one scriptable active computer, and rigs; **CUT** redundant named variants. Fit simulation shows paper gain and applied gain against selected threats separately.

**Spectator angle —** Doctrine cards can say “paper 1,200 DPS; applied to hostile screen 310” and show how much comes from support modules rather than hiding it in a final number.

### SHOULD-1 — Stealth-bomber bombs and area ordnance

**Name — Damage, void, and lockbreaker bombs.** EVE stealth bombers launch delayed, untargeted area weapons that can deal typed damage, drain capacitor, or break locks; explosions are indiscriminate and coordinated waves punish compact predictable fleets.

**Why high-value —** Bombs are one of EVE's best organic anti-blob mechanics. A small prepared wing can maul an expensive battleship formation, while spreading to counter bombs weakens focus fire, logistics, and command coverage.

**Agent redesign — KEEP** scouting, synchronized run, delayed detonation, AoE, signature application, charge limit, interception, friendly fire, and damage/cap/lock variants; **SIMPLIFY** vector geometry to a targeted front/lane and one-tick telegraph; **CUT** twelve-second manual alignment. `operate.order` can `plan_bomb_run` with ingress solution, target front, bomb type, launch tick, and escape route. Defenders choose `scatter`, `screen_bombers`, or `point_defense` and accept the associated support penalty.

**Spectator angle —** Detected bomber traces, a countdown, the fleet scattering, and the synchronized blast are inherently watchable. The timeline distinguishes brilliant bombing from friendly-fire disaster.

### SHOULD-2 — Capital fighters and support squadrons

**Name — Carrier and supercarrier fighters.** EVE carriers use light and support fighter squadrons; supercarriers add heavy anti-capital fighters. Squadrons travel, use role abilities, can be targeted and destroyed, and must be recalled/replaced from fighter inventory.

**Why high-value —** Carriers project power without making that power untouchable. Anti-fighter screens, support-fighter tackle/EWAR, travel delay, recall timing, and replacement attrition create counters below the capital tier.

**Agent redesign — KEEP** light/support/heavy roles, killable squadrons, travel, tubes, inventory, recall, and anti-fighter counterplay; **SIMPLIFY** abilities into attack, screen, tackle, suppress, and recall policies; **CUT** manual 3D fighter movement. Fighters are persistent cohorts with arrival tick and damage. `fighter.order` mirrors drone commands but consumes carrier tubes and may operate on another front.

**Spectator angle —** Fighter streams connect carrier and front; anti-fighter screens tear them down; a desperate recall becomes a visible race.

### SHOULD-3 — Smartbombs, defender behavior, and point defense

**Name — Short-range indiscriminate area defense.** EVE smartbombs pulse around a ship and can damage nearby ships, drones, bombs, and missiles, including friendlies; current player Defender Launchers specifically counter bombs. THE COMPACT generalizes those inputs into a broader point-defense role.

**Why high-value —** A fleet can spend capacitor and slots on anti-swarm protection, clear drones/bubbles, or run a dangerous close-range trap. Friendly-fire risk prevents point defense from being a free stat.

**Agent redesign — KEEP** short range, cap/ammo cost, indiscriminate collateral, and anti-drone/missile/bomb role; **SIMPLIFY** projectile intersections into a cohort `point_defense` rating and stance; **CUT** per-pulse commands. Policy chooses threats to prioritize and maximum friendly exposure. The result reports ordnance destroyed, damage prevented, collateral, and cap cost.

**Spectator angle —** Defensive pulse rings erase incoming swarms and sometimes allies; the counter is visible rather than folded into a resistance number.

### NICE-1 — Spooling and polarized weapons

**Name — Entropic ramp and zero-resistance glass cannons.** Some EVE weapons build damage while maintaining uninterrupted fire on one target; polarized weapons gain offense at the extraordinary cost of stripping the user's resists.

**Why high-value —** Spool makes target persistence a commitment, while polarization creates the purest possible gank-over-tank fit. Both generate sharp, understandable decisions.

**Agent redesign — KEEP** one exemplar of each; **SIMPLIFY** spool to a visible stage meter and polarization to an explicit fit flag; **CUT** proliferation. Changing target or losing lock resets spool. The simulator and insurance quote must shout the zero-resist consequence, never bury it.

**Spectator angle —** A beam intensifies across ticks; polarized hulls carry an unmistakable glass-cannon icon and spectacular loss card.

### NICE-2 — Chain and specialty weapons

**Name — Chaining, lances, breacher effects, and other exotic weapons.** EVE has accumulated specialized systems that jump damage across nearby targets or apply unusual capital/control effects.

**Why high-value —** One or two can reshape formation and counterplay after the core is stable, especially as answers to concentration or remote-repair dominance.

**Agent redesign — KEEP** only effects that introduce a new decision; **SIMPLIFY** proximity to formation adjacency and front/lane templates; **CUT** bespoke geometry and exception stacks. A new weapon must name its counter, observation fields, supply input, and why an existing bomb/EWAR tool cannot do the job.

**Spectator angle —** Exotic weapons earn distinct effects only because they are rare and legible; visual novelty cannot substitute for a strategic niche.

### CUT-1 — Per-shot wrecking RNG and physical projectile simulation

**Name — Individual hit-quality rolls and entity trajectories.** EVE rolls many individual turret hits and simulates missiles/drones in real space, including rare extreme results.

**Why high-value —** These produce texture at human piloting cadence. At a multi-minute agent tick, one extreme roll can dominate an expensive decision without offering a response, while individual entity simulation consumes disproportionate server work.

**Agent redesign — CUT** rare per-shot jackpots and per-projectile paths; **KEEP** bounded hit/application variance, delayed ordnance, interception, and target overkill through seeded cohort packets. Publish the variance band and reveal expected versus realized outcome after combat.

**Spectator angle —** Volleys still vary, but every upset has a comprehensible band and cause rather than “the server rolled a wrecking shot.”

---

## 5. Tanking, logistics, capacitor, and survivability

### MUST-1 — Shield → armor → hull and effective hit points

**Name — Three sequential defense layers.** EVE damage normally depletes shield, then armor, then structure; every layer has raw HP and EM/thermal/kinetic/explosive resistances. EHP is derived from the actual damage mix and resist profile, not a universal raw stat.

**Why high-value —** Three breaks make combat tempo readable, while layer-specific resists make fitting/scouting matter. A hull can be weak to one damage mix and extremely durable to another; a ship reaching structure becomes a public moment before destruction.

**Agent redesign — KEEP** all layers, four resist vectors, sequential damage, and EHP by threat; **SIMPLIFY** obscure bleed-through and rounding; **CUT** a single misleading EHP score as the only forecast. Own observations show raw/current HP, final resists, EHP by type, EHP against observed hostile mix, time-to-layer-break, and repair timing. Enemy values are estimate bands. Damage reports attribute mitigation to buffer, resist, repair, and evasion separately.

**Spectator angle —** Three concentric rings break in order, impacts use damage-type colors, and the feed announces shields broken, armor broken, and hull critical.

### MUST-2 — Buffer, active, passive, and evasion tanks

**Name — Four ways to survive.** EVE buffer adds HP/resists to survive alpha; active tank repairs with capacitor or charges; passive shield tank relies on natural recharge; speed/signature tank prevents weapons from applying. These strategies mix but compete for slots, fitting, mass, signature, capacitor, and damage.

**Why high-value —** Survivability is not one stat. Buffer fleets buy time for logistics, active fits bait or outlast smaller opponents, passive fits have a break point, and small mobile ships live through application rather than battleship EHP.

**Agent redesign — KEEP** all four identities and their counters; **SIMPLIFY** active cycling into threshold policies and passive recharge into cached bands; **CUT** hidden survival arithmetic. Fit and operation observations expose `buffer_ehp`, `local_repair`, `remote_repair_eligible`, `passive_recharge_current/peak`, `evasion_mitigation`, `cap_endurance`, `incoming_alpha`, and `projected_break_tick`. Policies specify when to pulse repairs, inject cap, overload, or disengage.

**Spectator angle —** Incoming-versus-repair graphs and “damage avoided / resisted / repaired” split survival into understandable causes. A passive tank falling below peak recharge visibly begins to collapse.

### MUST-3 — Shield tank identity

**Name — Extenders, hardeners, amplifiers, boosters, and recharge.** EVE shield tank predominantly occupies mid slots. Extenders increase buffer but also signature; boosters repair at cycle start and consume capacitor; passive shield recharge is nonlinear; amplifiers and hardeners improve repair or resists.

**Why high-value —** Shield fits preserve low slots for damage and agility but sacrifice propulsion, tackle, EWAR, or capacitor mids. Fast repair timing is strong against pressure, while signature bloom makes heavy weapons and missiles apply better.

**Agent redesign — KEEP** mid-slot competition, immediate repair timing, signature drawback, active/passive choice, and cap pressure; **SIMPLIFY** the recharge curve into explicit current and peak output; **CUT** module variants without a distinct trade. Shield repair resolves before the damage packet scheduled for the same internal slice when already active; newly commanded changes wait for normal acquisition/cycle rules.

**Spectator angle —** Blue buffer rings visibly enlarge signature, shield pulses land before volleys, and painted/extended targets become easier to hit.

### MUST-4 — Armor tank identity

**Name — Plates, coatings/hardeners, repairers, and damage-control support.** EVE armor tank predominantly occupies low slots. Plates add buffer and mass, active repair lands at cycle end, passive/active resist modules tune damage profiles, and armor generally preserves mid slots for control.

**Why high-value —** Armor fleets bring tackle/EWAR without giving up tank but sacrifice damage upgrades and mobility. Delayed repairs make alpha and timing dangerous, while mass makes disengagement harder.

**Agent redesign — KEEP** low-slot competition, plate mass, resist tuning, cap-efficient but delayed repair, and control-rich mids; **SIMPLIFY** coatings/hardeners to passive, active, and adaptive choices; **CUT** minor resistance variants. Armor repair schedules after the damage/destruction check for its internal slice, so a target must survive to receive it. Observations explicitly say `survives_to_next_rep`.

**Spectator angle —** Gold repair cycles visibly race a red incoming volley. A rep that was scheduled but arrived after destruction becomes a dramatic, auditable event.

### MUST-5 — Hull tank and damage control as the last margin

**Name — Structure HP, bulkheads, hull repair, and damage control.** EVE structure is the final layer; reinforced bulkheads and damage controls can make it surprisingly durable, while combat hull repair is uncommon and slow.

**Why high-value —** A real last margin creates close escapes, bait hulls, and “1% structure” legends. Damage control is a powerful all-layer opportunity cost, not a free emergency immunity.

**Agent redesign — KEEP** hull buffer, one damage-control family, deterministic critical-system damage at structure thresholds, and between-operation hull repair; **SIMPLIFY** bulkhead doctrine; **CUT** viable remote hull-repair fleets and random module-damage lotteries. At 50% and 20% structure, deterministic priority-weighted modules may degrade or offline, exposed before the next order. Repair requires supplies after withdrawal.

**Spectator angle —** Hull fires, disabled-system icons, and exact “escaped at 1.8% structure” callouts give near-losses narrative weight.

### MUST-6 — Local repair, ancillary burst, and commitment defenses

**Name — Repair cycles, charge-fed ancillary modules, and temporary hardening.** EVE active repairs use capacitor; ancillary shield/armor modules consume finite charges for powerful burst output before a long reload or worse efficiency. Assault controls, bastion, siege, and similar states exchange mobility or future safety for temporary survival/performance.

**Why high-value —** Bait and brinkmanship emerge: spend the last charge now, reveal the tank, hold for allies, or save it for escape. Burst defense creates a window, not permanent invulnerability.

**Agent redesign — KEEP** limited charges, reload, activation timing, and explicit commitment; **SIMPLIFY** variants into standard, efficient, burst, and class-specific commitment modes; **CUT** manual pulse micromanagement. Policy fields include `repair_below`, `save_charges`, `panic_if_incoming_alpha`, and `reserve_cap`. Observation reports charges, next rep, reload completion, expected benefit, and whether the ship survives long enough to receive it.

**Spectator angle —** Charge pips vanish, a bait tank reveals itself, and “ancillary empty” or “bastion locked for two more ticks” becomes a visible vulnerability.

### MUST-7 — Remote shield/armor logistics and the alpha breakpoint

**Name — Logistics ships, remote repair, locks, range, and broadcasts.** EVE logistics hulls lock allies and concentrate remote shield or armor repair. Shield reps land early; armor reps land late. Lock time, target slots, range/falloff, capacitor, resists, broadcasts, and incoming alpha determine whether repair saves a target or arrives too late.

**Why high-value —** Logistics is the strongest clean force multiplier in this cluster. It lets a smaller coordinated fleet beat a larger disorganized one, creates obvious high-priority targets, and turns focus fire, split damage, bait, sensor warfare, and cap pressure into interacting counters.

**Agent redesign — KEEP** specialist hulls, locks, response delay, range, layer timing, cap use, repair falloff, and alpha-before-rep; **SIMPLIFY** modules into scheduled throughput packets; **CUT** manual repair clicking. `operate.order.params.support` supplies a priority policy such as `tackled_capital → logistics → command → lowest_time_to_die`, max overheal, reserve cap, and emergency override. Observation exposes available/committed repair, incoming damage, projected break tick, target survival-to-rep, overheal, and response latency. Repair is not an instantaneous fleet-wide pool.

**Spectator angle —** Repair arcs, target health rebounds, late cycles, overheal waste, and “saved at 2% structure” show logistics work rather than hiding it in a score.

### MUST-8 — Capacitor chains and remote energy transfer

**Name — Logistics cap chains.** Bonused EVE logistics ships can transfer capacitor efficiently enough to form dependency rings or pairs. Jamming, neuting, range separation, or killing a link can collapse repair output.

**Why high-value —** The healer wing gains an internal topology and specific weak points. A scout can identify an anchor; bombers/EWAR can sever it; prepared doctrines carry failover ships instead of simply adding more repair points.

**Agent redesign — KEEP** transfer range, net efficiency on bonused hulls, dependency, and failure; **SIMPLIFY** individual beams into a small explicit graph; **CUT** hand-maintained cycle timing. `fleet.cap_chain` defines members, topology, and failovers; agents can `allocate_cap`, `break_cap_chain`, or precharge before commitment. Observations show graph health, broken links, cap surplus, and repair loss if each node falls.

**Spectator angle —** Energy links visibly reroute or snap; the feed reports “cap chain severed—remote repair down 37%.”

### MUST-9 — Neutralizers, Nosferatu, boosters, and batteries

**Name — Capacitor warfare.** EVE neutralizers spend attacker capacitor to drain more from a target; Nosferatu steal a smaller amount under state restrictions; cap boosters inject finite charges; batteries add capacity and neutralizer resistance. Size, range/falloff, specialization, and capless weapons matter.

**Why high-value —** Cap warfare is a second kill axis. It shuts down propulsion, tackle, EWAR, active tank, logistics, and cap-using weapons without first chewing through EHP. A capless projectile/missile/drone doctrine can hard-counter a neut plan.

**Agent redesign — KEEP** range, attacker cost, target drain/resistance, size scaling, finite injection, capless identity, and shutdown cascades; **SIMPLIFY** cycles into internal packets and Nosferatu to a clear lower-energy transfer rule; **CUT** hidden GJ arithmetic as the only feedback. `operate.order.params.cap_warfare` names target policy, mode, allocation, overload, and desired break. Observations translate energy pressure into `predicted_break_tick` and `systems_disabled_if_broken`.

**Spectator angle —** Drain arcs precede weapons, repair, MWD, or tackle going dark in declared priority order. A ship can visibly be “alive but helpless.”

### MUST-10 — Tank-versus-gank and slot-coupled doctrine identity

**Name — Offense, defense, and utility sharing fitting space.** EVE damage upgrades compete with armor tank in lows; shield tank competes with tackle/EWAR/propulsion in mids; weapons and support compete in highs; all compete for CPU/grid/cap.

**Why high-value —** No fit can maximize tank, gank, control, support, mobility, endurance, and price. Fleet doctrine becomes the art of covering individual sacrifices with other hulls—exactly the social/compositional depth THE COMPACT needs.

**Agent redesign — KEEP** coupled opportunity costs; **SIMPLIFY** their presentation into a seven-axis Pareto profile; **CUT** any hidden “combat power” scalar used as the player-facing answer. Simulation always shows marginal changes and hostile-matchup consequences. Operation forecasts name the constraint—“cannot hold range,” “cannot break remote repair,” “cap fails before armor”—rather than saying only “41% win chance.”

**Spectator angle —** Side-by-side doctrine polygons and causal callouts explain why a lower-price fleet has the right shape for this opponent.

### SHOULD-1 — Reactive resist adaptation

**Name — Reactive armor hardening and dynamic damage response.** EVE includes a resistance module that shifts its protection toward recently received damage, rewarding opponents who vary their mix.

**Why high-value —** It adds in-battle damage adaptation without a full refit and makes mixed or switched ammunition valuable after contact.

**Agent redesign — KEEP** one visible adaptive module; **SIMPLIFY** its movement to one resist-vector step per public combat tick; **CUT** opaque continuous redistribution. Observation exposes current vector, next predicted vector, and the benefit of switching damage. The module costs cap and remains stacking-limited.

**Spectator angle —** The armor resist wheel visibly rotates; attackers switching damage to stay ahead is easy to narrate.

### SHOULD-2 — Overheating, rack heat, burnout, and repair paste

**Name — Module overload.** EVE permits many active modules to exceed normal performance while accumulating heat and damage, potentially burning out; paste repairs damage outside immediate pressure.

**Why high-value —** Overheat is a clean temporary-power-for-future-risk decision: stretch point to secure a catch, guns for one alpha, propulsion to escape, or reps to survive. Burnout produces memorable self-inflicted failures.

**Agent redesign — KEEP** family-specific boost, heat accumulation, damage, burnout, and repair cost; **SIMPLIFY** to high/mid/low rack heat without adjacency; **CUT** one-cycle toggle spam. `overload` policies specify rack/family, duration or heat ceiling, and priority. Observation shows expected gain, next-tick burnout probability band, damaged modules, paste, and repair time.

**Spectator angle —** Racks glow, performance spikes, and “overheated scrambler burned out; titan escaped” is a first-class event.

### SHOULD-3 — Repair saturation and finite logistics response

**Name — Natural remote-repair limits.** EVE constrains logistics through locks, cap, range, cycle timing, target switching, stacking/resists, alpha, and pilot attention, though a very large repair ball can still scale strongly.

**Why high-value —** Support should reward composition without producing immortal blobs. Attackers need multiple viable counters: alpha, EWAR, neuts, displacement, split damage, bombing, or killing logistics.

**Agent redesign — KEEP** the natural limits and avoid a blunt healing cap; **SIMPLIFY** attention into repair channels and response latency; **CUT** unlimited instantaneous redistribution. Each logistics cohort has a bounded number of target channels, acquisition delay, range coverage, cap, and throughput; simultaneous critical targets create a queue. Repeated remote assistance does not receive an arbitrary penalty unless it modifies a stacking-penalized attribute, but overheal and late cycles provide derived diminishing returns.

**Spectator angle —** A repair queue shows a logi wing forced to choose which of three primaries lives. “Not enough channels” is more dramatic and honest than a hidden healing debuff.

### SHOULD-4 — Marauder bastion as a subcapital commitment mode

**Name — Bastion mode.** EVE marauders can enter a timed mode that greatly improves local tank and weapon performance/resistance while immobilizing the ship and denying ordinary remote assistance until the cycle ends.

**Why high-value —** Bastion gives battleships a self-reliant anchor and bait role without turning them into mobile logistics-backed super-ships. Entering at the wrong time lets tackle, neuts, or escalation trap an expensive hull.

**Agent redesign — KEEP** minimum duration, immobility, local tank/application gain, EWAR hardening, and remote-assistance isolation; **SIMPLIFY** it to a one- or two-tick visible stance; **CUT** cycle-perfect toggling and combat refit. `operate.order` may set `mode: bastion` only with target and exit contingency; observation shows `bastion_until`, isolated break forecast, cap/ammo endurance, and hostile escalation window.

**Spectator angle —** The hull visibly deploys, gains a countdown ring, and becomes the center of a clear “break it now or disengage” contest.

### NICE-1 — Remote sensor/tracking assistance and utility drones

**Name — Remote sensor boosters, tracking links, and repair/EWAR drones.** EVE support can improve an ally's lock speed/range or weapon application, while drones add mobile repair or suppression.

**Why high-value —** These enable instalock, sniper, anti-small, and specialist support doctrines that are not simply more DPS or EHP.

**Agent redesign — KEEP** a small support-link set and drone roles; **SIMPLIFY** them into allocated effects with the same lock/range/stack rules as EWAR; **CUT** redundant variants. Observation reports marginal targets enabled and what is sacrificed in remote-repair or damage capacity.

**Spectator angle —** Support links and doctrine annotations explain why a wing suddenly locks or applies beyond its normal profile.

### CUT-1 — Combat hull-repair fleets and invisible repair exceptions

**Name — Remote structure repair and exception-heavy cycle behavior.** EVE supports hull repair, but it is usually slow post-fight work; decades of modules also create edge cases around assistance eligibility.

**Why high-value —** Post-battle repair is an economic sink. Making it a normal combat layer would blur the clean shield/armor/hull tempo and add another logistics family with little new counterplay.

**Agent redesign — CUT** viable combat hull logistics and exception sprawl; **KEEP** post-operation structure/module repair with parts, time, and service access. Capital commitment modes clearly state whether they can receive assistance; the observation always lists `remote_assistance_allowed` and the reason.

**Spectator angle —** Hull remains the terrifying final margin. Repair tenders arriving in Aftermath reinforce the industrial story without muddying the battle.

---

## 6. Targeting, propulsion, tackle, EWAR, and grid control

### MUST-1 — Target locks, scan resolution, signature, range, and target channels

**Name — EVE target acquisition.** Most weapons, EWAR, tackle, and remote assistance require a lock. Lock time depends strongly on attacker scan resolution and target signature radius; hulls also cap lock range, sensor strength, and simultaneous targets. Large ships tend to lock slowly and be easy to lock; small ships do the reverse.

**Why high-value —** Target switching has a cost. Fast tackle can catch a hauler before it leaves, logistics can pre-lock likely primaries, damps delay repair, decoys consume channels, and a battleship cannot instantly swat every frigate.

**Agent redesign — KEEP** acquisition time, range, channel count, scan resolution/signature, pre-locking, and sensor strength; **SIMPLIFY** seconds into internal slices; **CUT** a separate `lock` call before every useful action. Fire/support/control policies enqueue required locks and report ready slice. Observation exposes current/acquiring locks, free channels, range cells, incoming lock warnings, and target-switch delay. Agents can explicitly reserve channels for logistics, tackle, or threats.

**Spectator angle —** Lock brackets fill, fire lines converge, and “logistics reacquiring after damp/jam” is a visible cause of a death.

### MUST-2 — Range and motion as contested formation state

**Name — Orbit, keep-at-range, approach, transversal, and anchors.** EVE pilots continually maneuver to control range and angular velocity: brawlers close, kiters stretch, small ships orbit for transversal, snipers maintain projection, and fleets anchor around chosen ships.

**Why high-value —** Position determines whether weapons, tackle, EWAR, repairs, and escape work. Removing it entirely would reduce combat to fit-score arithmetic; copying manual movement would price play by latency and inference volume.

**Agent redesign — KEEP** range control, relative motion, formation/cohesion, separate support depth, and mobility contest; **SIMPLIFY** space to fronts/depths/range cells plus posture; **CUT** coordinates and repeated orbit commands. A formation selects `brawl`, `orbit`, `kite`, `hold`, `screen`, `snipe`, or `withdraw`, desired range, propulsion, and cohesion. Hull speed/agility/mass, web/scram, commander effects, scout ingress, opposing posture, and terrain update range and `relative_motion` each slice.

**Spectator angle —** Arrows and range ribbons show lines closing, kiting, being screened, or peeling away. Applied damage changes alongside the motion instead of appearing mysterious.

### MUST-3 — Afterburner versus microwarpdrive

**Name — AB/MWD propulsion trade.** EVE afterburners provide moderate speed without a signature bloom and continue under scram; microwarpdrives provide much greater speed but consume more capacitor, reduce fitted capacitor, enlarge signature dramatically, and shut off under a scrambler.

**Why high-value —** This is an unusually clean mobility/application/control triangle. MWD wins the approach or escape but becomes easier to hit and vulnerable to scram; AB signature-tanks and works inside scram but may never control range; dual-prop spends a precious mid.

**Agent redesign — KEEP** identities, cap cost, signature bloom, and scram interaction; **SIMPLIFY** output to range-control and application deltas; **CUT** manual pulsing. `operate.order.params.propulsion` selects `ab`, `mwd`, `off`, or a threshold policy. Observation forecasts arrival range, cap runway, effective signature, hostile application, and scram risk under each choice.

**Spectator angle —** MWD contrails bloom then snap out under scram; AB wings retain tight evasive traces. Viewers see speed purchased with vulnerability.

### MUST-4 — Point, scram, warp strength, and partial fleet escape

**Name — Warp disruptors and scramblers.** EVE's longer-range point prevents warp with lower disruption strength; shorter-range scram applies more strength and also disables MWD/MJD. Warp-core strength can resist limited pressure. Tackle must stay alive, in range, locked, and powered.

**Why high-value —** Tackle converts a favorable exchange into irreversible loss. A cheap newcomer can hold a rare ship, secondary tackle can replace a dying hero, and killing the screen can reopen withdrawal.

**Agent redesign — KEEP** strength, range, lock/cap dependence, scram mobility shutdown, warp-core counterfit, and secondary tackle; **SIMPLIFY** target assignment to capacity-aware policies; **CUT** one aggregate frigate magically holding an entire fleet. Track individual held ships inside cohorts: `ships_held`, point/scram pressure, escape strength, tackler survival, and withdrawal success. `operate.order.params.tackle` chooses highest value, logistics, capital, closest, or named target policy; `screen` and `counter_tackle` defend escape.

**Spectator angle —** Red chains mark pinned assets. A withdrawal reports “27 escaped, 6 held,” and a secondary tackle handoff can be celebrated by name.

### MUST-5 — Webifiers and grapplers

**Name — Speed reduction EWAR.** EVE webs cut target speed, while battleship-scale grapplers are very strong up close and weaken with range. Slower targets lose range control and evasion and take better missile/turret application.

**Why high-value —** Webs connect control to damage. Heavy guns can kill small hulls only if a specialist risks closing; a kiter caught by one web may die without any change to paper EHP.

**Agent redesign — KEEP** range, stacking, close-range grappler profile, and downstream application; **SIMPLIFY** to effective speed/range-control reduction; **CUT** dozens of strength/range variants. `operate.order.params.ewar` allocates web capacity by target policy. Observation states expected target speed, range shift, turret hit gain, missile application gain, and escape effect.

**Spectator angle —** Web lines slow formation motion and incoming shots immediately become denser; the causal connection is visual.

### MUST-6 — Interdiction bubbles, interdictors, HICs, and nullification

**Name — Area and focused warp denial.** EVE mobile bubbles, interdictor probes, and heavy-interdictor fields stop warp/jump and can catch routes; a scripted HIC sacrifices the area field for an effectively unbreakable focused point suitable for capitals. Bubbles affect friend and foe, are restricted by security zone, and select hulls can activate temporary nullification.

**Why high-value —** Interdiction turns topology into combat. A fragile destroyer can trap a capital wing, deny reinforcements, split a convoy, or die opening an exit. The Commons remains safe because bubbles are illegal there.

**Agent redesign — KEEP** area denial, friendly effect, lifetime, zone legality, fragile specialists, focused capital tackle, field clearing, and limited nullification; **SIMPLIFY** spheres/drag geometry into route edges, ingress lanes, or fronts; **CUT** pixel-perfect placement. `deploy_interdiction`, `focus_tackle`, `clear_field`, `screen_interdictor`, and `activate_nullifier` expose affected routes, TTL, mass/ship coverage, escape delay, and counters. A bubble active before movement changes that movement; later bubbles cannot retroactively catch it.

**Spectator angle —** Blocked exits glow, arrivals pile at a lane, and killing the interdictor changes the withdrawal route from red to green in real time.

### MUST-7 — Sensor dampeners

**Name — Lock-range and scan-resolution suppression.** EVE dampeners always reduce target lock range and/or lock speed subject to strength, scripts, range/falloff, and stacking.

**Why high-value —** Damps force snipers closer, delay hostile logistics and primary switches, and offer reliable counterplay without binary dice. They can protect a fleet by making the enemy unable to interact at the chosen range.

**Agent redesign — KEEP** range/resolution modes, falloff, stacking, hull specialization, and sensor-boost counters; **SIMPLIFY** scripts to named mode; **CUT** redundant module variants. `ewar_assignment` chooses `damp_range` or `damp_resolution`; observations show resulting lockable bands, extra acquisition slices, locks dropped, and estimated repair/damage denied.

**Spectator angle —** A targeting cone contracts or a lock clock lengthens. “Damped out of repair range” is obvious.

### MUST-8 — Tracking and guidance disruption

**Name — Weapon-specific suppression.** EVE tracking disruption harms turret range/tracking; guidance disruption harms missile range/application. Scripts concentrate each effect.

**Why high-value —** A small specialist wing can blunt a much larger homogeneous doctrine, rewarding intelligence, mixed weapons, counter-EWAR, and priority targeting. The effect is strong only against the right opponent.

**Agent redesign — KEEP** turret/missile specificity, range/application modes, falloff, stacking, and counters; **SIMPLIFY** both under one `weapon_disrupt` family with a typed script; **CUT** item-family duplication. Observation reports paper and applied damage removed, unaffected hostile cohorts, and the marginal effect of another disruptor.

**Spectator angle —** Weapon arcs shrink, missiles fail to envelop targets, and the analyst panel can say “disruption removed 39% of applied DPS.”

### MUST-9 — Target painters

**Name — Signature amplification.** EVE painters enlarge a target's signature, accelerating locks and improving turret, missile, bomb, and probe application.

**Why high-value —** Painters connect intelligence, fire control, and multiple weapon systems. A support ship can mark one small target so an entire heavy fleet can delete it.

**Agent redesign — KEEP** signature change, range/falloff, stacking, and specialist bonuses; **SIMPLIFY** activation to assigned targets; **CUT** hidden downstream arithmetic. `paint` observations report exact changes to lock delay, turret hit, missile/bomb application, and probe confidence for known fits.

**Spectator angle —** A painted target carries a bright mark; its signature ring expands and hostile application meters rise together.

### MUST-10 — ECM as graded sensor pressure, not roulette

**Name — Electronic countermeasure jamming.** EVE ECM compares jammer strength to sensor strength and can break/prevent most locks for a cycle; racial jammers specialize against sensor types. Modern counterplay retains a lock on the jammer, but the mechanic remains highly stochastic.

**Why high-value —** Sensor denial is a true force multiplier. A cheap specialist can interrupt damage or logistics and becomes a priority target; sensor hardening and mixed composition matter.

**Agent redesign — KEEP** dedicated jammer role, sensor strength, lock breaking, reacquisition, range, cap, and counter-ECCM; **SIMPLIFY** normal ECM to deterministic pressure that removes target channels or adds acquisition delay; **CUT** coarse-tick all-or-nothing hidden rolls and four memorized racial sensor types. A specialist may overload for a bounded, disclosed hard-jam chance near a threshold. Use transparent `broadband` versus scanned `matched_spectrum`. Observation exposes pressure, integrity, channels suppressed, and hard-jam band.

**Spectator angle —** Lock lines peel away as a jam meter fills; rare hard jam and routine partial suppression look different.

### SHOULD-1 — Sensor boosters, ECCM, tracking/guidance computers, and counter-EWAR

**Name — Self and remote electronic support.** EVE boosters/amplifiers harden sensor strength, range, or scan resolution; tracking/guidance modules improve application/projection; remote variants support allies. Scripts specialize effects.

**Why high-value —** Force multipliers need fitting counters. A fleet can sacrifice tank/control to resist jams, lock faster, or preserve application rather than simply accepting hostile EWAR.

**Agent redesign — KEEP** self/remote counters, script choice, slot cost, and stacking; **SIMPLIFY** them into sensor, precision, or projection packages; **CUT** parallel module clutter. Fit compare and combat observation show exactly which hostile effect is resisted and what the counter costs elsewhere.

**Spectator angle —** “ECCM prevented two channel losses” and “remote sensor boost enabled the catch” credit defensive support.

### SHOULD-2 — Micro-jump drives and command-destroyer displacement

**Name — MJD and micro-jump field generation.** EVE MJDs spool before moving a ship a large distance; command destroyers can move a bounded nearby group. Scram cancels the jump, enabling isolation, rescue, or formation disruption.

**Why high-value —** A small specialist can peel logistics from a line, escape a brawl, or save an ally without adding damage. The spool creates visible counterplay.

**Agent redesign — KEEP** spool, cooldown, scram counter, mass/ship limit, and ally/enemy displacement; **SIMPLIFY** distance/facing to movement between range/depth cells; **CUT** exact sphere selection. `micro_jump` or `displace` declares source, destination cell, selection policy, and next-tick resolution. Enemies can scram the source, scatter, intercept, or brace.

**Spectator angle —** A projected landing band and spool countdown precede a formation being peeled away; viewers understand the play before it resolves.

### SHOULD-3 — Cloaks, probes, fit/cargo scans, and combat reconnaissance

**Name — Covert state and active scanning.** EVE cloaks hide ships at mobility/locking cost; probes find targets and sites; scanners can reveal cargo or fit information; covert hulls and local intel rules shape detection.

**Why high-value —** Ambush, bait, bomber wings, cargo hunting, counter-scouting, and doctrine inference require incomplete information with tools that improve it.

**Agent redesign — KEEP** cloaked/decloaked tradeoff, specialized covert hulls, probe strength versus signature, scan time, counter-scan, and partial fit/cargo reveal; **SIMPLIFY** probe geometry and repeated scan clicks into `scan` tasks with area/target, desired confidence, effort, and exposure; **CUT** manual probe placement and passive combat contribution while cloaked. Cloaked forces cannot contribute ordinary boosts/repair/fire and reveal when they commit. Exact rare cargo or modules require high-quality scan.

**Spectator angle —** Public spectators see uncertain contacts appropriate to public intel, then silhouettes resolve at decloak. Post-battle replay can reveal the hidden route without spoiling it live.

### SHOULD-4 — Burst ECM, lockbreaker bombs, and emergency escape

**Name — Indiscriminate area lock disruption.** EVE burst jammers and lockbreaker bombs affect many nearby ships, potentially including allies, and are used to break tackle/repair/fire coordination.

**Why high-value —** They create an emergency exit or offensive disruption at real collateral and cooldown cost. A retreat can hinge on one well-timed pulse.

**Agent redesign — KEEP** area effect, friendly risk, cooldown, cap/charge cost, sensor resistance, and reacquisition; **SIMPLIFY** many per-ship rolls to pressure against formations in one cell; **CUT** instant untelegraphed coarse-tick erasure. `burst_jam` names a cell and resolves next slice/tick depending on scale; observation forecasts friendly and hostile channels affected.

**Spectator angle —** A static shockwave blanks a web of lock lines on both sides, followed by visible reacquisition races.

### NICE-1 — Warp-core stabilizers and active nullification

**Name — Fitted escape counters.** EVE warp-core stabilizers raise escape strength but hurt targeting, while nullifiers provide temporary bubble immunity on selected travel/scout hulls with cooldown and fitting incompatibilities.

**Why high-value —** Travel fits can choose survival over combat competence, and camps cannot assume every target is held by one point or one bubble.

**Agent redesign — KEEP** explicit sensor/lock penalty, hull restrictions, active-before-movement timing, cooldown, and interdiction-only scope; **SIMPLIFY** item variants; **CUT** immunity by default. Route observations show which known hazards the module counters and the window after it is spent.

**Spectator angle —** A nullified convoy piercing one bubble but becoming vulnerable at the next choke point creates clear chase tension.

### CUT-1 — Bumping and collision physics as tackle

**Name — Mass collision, station bumping, and alignment interference.** EVE players can use collision physics to push ships, delay alignment, or move targets away from safety.

**Why high-value —** It enables skillful improvised control in a free-flight client, but it is spatially opaque, latency-sensitive, and historically exploit-prone.

**Agent redesign — CUT** collision trajectories and bump-tackle; **KEEP** mass/agility in range control, displacement resistance, and escape time. Use legal tackle, webs, interdiction, and telegraphed micro-jump displacement for the same strategic outcomes.

**Spectator angle —** No invisible nudging. Every denied escape has a named, visible control source.

### CUT-2 — Separate racial-jammer memorization and passive-targeting trivia

**Name — Sensor taxonomy and niche lock exceptions.** EVE's four sensor types, racial jammer variants, passive targeting, auto-target modules, and similar utilities create specialist knowledge but many false choices.

**Why high-value —** They add deep fitting trivia in a mature catalog. They do not create proportionate new operation decisions.

**Agent redesign — CUT** the memorization tax; **KEEP** sensor strength, broadband versus scanned matching, lock warning, and covert scan roles. Every exception must be observable through the structured sensor state.

**Spectator angle —** Sensor warfare stays deep but explainable without an encyclopedia lookup.

---

## 7. Core combat inside declared operations

### MUST-1 — Three fronts × four depths × five range cells

**Name — The EVE grid, reduced to tactically meaningful topology.** EVE exposes continuous 3D distance and relative motion. THE COMPACT needs enough topology for screens, mainlines, support, reserves, flanks, range control, bombs, and withdrawal without coordinates.

**Why high-value —** A single “close/mid/far” value would make flanking, separated logistics, reserves, and multi-objective battle impossible. Full coordinates would force constant piloting. A small topology allows one wing to screen while another flanks or a bomber attacks support depth.

**Agent redesign — KEEP** relative position, fronts, support coverage, pairwise range, motion, and ingress routes; **SIMPLIFY** to `front: left|center|right`, `depth: screen|main|support|reserve`, and pairwise `range_cell: contact|close|mid|long|extreme`; **CUT** x/y/z and a misleading absolute formation range. Each front owns a public integer `screen_gap` from 0–4. A formation's signed depth coordinate is `screen=0`, `main=1`, `support=2`, `reserve=3` behind its own screen; lateral separation is `abs(front_index_a-front_index_b)`. The server derives a canonical pair distance from `screen_gap + both depth coordinates + lateral/terrain modifier`, clamps it to a range cell, and then applies weapon/support range and falloff. Posture contests change the front gap or a formation's front/depth, never an undefined personal range. Formations also have footprint and adjacency; tight cohesion improves repair/boost/focus but raises AoE exposure, while spread does the reverse. `reposition` orders contest a destination against mobility, control, enemy screen, terrain, and command.

**Spectator angle —** The operation becomes a compact battleboard: three lanes, layered formation blocks, range ribbons, and obvious breakthroughs. Humans can understand where the logistics wing is without rotating a 3D camera.

### MUST-2 — Internal combat slices under each slow public tick

**Name — EVE module cycles and simultaneous exchanges.** A 1–5 minute agent tick is too coarse for locks, alpha, shield/armor repair timing, missiles, reload, and tackle to resolve as one blended number. Each active operation therefore runs a fixed small number of deterministic internal slices without requesting new agent input.

**Why high-value —** Alpha can beat a repair cycle, missile travel can cause overkill, armor reps can land too late, tackle can shut down a jump, and a reload window can be exploited—all from one affordable strategic order.

**Agent redesign — KEEP** causal timing; **SIMPLIFY** real seconds to 6–12 fixed slices per combat tick; **CUT** model calls inside slices. Recommended slice order is: (1) arrivals and movement/range contest; (2) lock acquisition and sensor warfare; (3) tackle, jump/withdraw attempts; (4) cap warfare, EWAR, boosts, heat; (5) already-scheduled shield repair; (6) turret volleys, missile impacts, drones/fighters, bombs; (7) destruction/disable check; (8) armor repair, recharge, reload, cooldown, attrition. Orders are snapshotted and outcomes are simultaneous within each numbered stage.

**Spectator angle —** A public tick can replay as a short causal sequence at human speed, while the live map advances only once the authoritative tick closes.

### MUST-3 — Turret and missile application translated, not deleted

**Name — Tracking/transversal/signature/range and explosion application.** EVE turrets lose accuracy to angular motion and range beyond optimal/falloff, scaled by weapon and target signature; missiles lose damage to small signature and high absolute speed. Webs, paints, propulsion, disruptors, and formation motion connect to these formulas.

**Why high-value —** This is the main reason large ships do not obsolete small ones. It also makes maneuver and support matter after fitting rather than letting paper DPS decide the result.

**Agent redesign — KEEP** the monotonic relationships and continuous curves; **SIMPLIFY** raw transversal to server-derived `relative_motion` from posture contests and normalize formula inputs; **CUT** expecting the agent to calculate radians or undocumented exponents. For every relevant attacker/target pairing, observation exposes range factor, motion/tracking or velocity factor, signature factor, final application band, expected applied damage, confidence, and counter hints. The engine caches a lookup surface per fit and target profile.

**Spectator angle —** “Paper 18k / applied 5.2k” decomposes into range, motion, signature, EWAR, and resists. Viewers can see which intervention fixed application.

### MUST-4 — Fire control, primaries, retarget cost, and split damage

**Name — Fleet target calling.** EVE fleets call primaries to concentrate alpha, switch targets to catch logistics, split fire to overload repair channels, and sometimes waste damage through slow locks or volleys already in flight.

**Why high-value —** Coordination becomes power rather than a cosmetic command role. A smaller fleet can win by killing tackle/logistics/boosts in the right order; a poor FC can shoot an unbreakable bait target while the battle collapses elsewhere.

**Agent redesign — KEEP** primaries, secondary cascade, retarget/lock time, in-flight damage, split fire, and role-aware targeting; **SIMPLIFY** individual calls to a formation `primary_policy`; **CUT** one target action per ship. Policies can name targets or ordered predicates such as `enemy_logistics → command → tackle → lowest_time_to_kill`, with overkill ceiling and split fraction. Observation shows current locks, predicted time-to-kill, repair response, overkill, and cost to switch.

**Spectator angle —** Called primaries glow; lock/fire lines converge; a target switch and late missile wave are shown distinctly. The replay can identify “three volleys wasted after death.”

### MUST-5 — Tackle, withdrawal, pursuit, and the decision to stop fighting

**Name — Warp-out and escape under control.** EVE combat ends ship by ship: an untackled ship aligns/warps; points, scrams, bubbles, webs, aggression, mass, and route conditions delay or prevent escape; pursuers can catch stragglers.

**Why high-value —** Staying is an economic decision, not a binary battle flag. Agents can preserve a fleet at the cost of abandoning pinned allies, hold tackle for reinforcements, or risk a route to save a flagship. This is where permanent loss actually happens.

**Agent redesign — KEEP** partial escape, alignment/mass, control sources, routes, pursuit, sacrificial rear guards, and capital commitment locks; **SIMPLIFY** it to per-ship/cohort escape contests; **CUT** instant whole-fleet retreat. `operate.withdraw` names route, priority order, rear guard, cargo abandonment, and acceptable losses. Observation returns ETA, ships currently held, route interdiction, pursuit strength, jump/cap reserve, and success band. Unheld ships leave over slices; pinned assets remain unless tackle breaks.

**Spectator angle —** Formations peel off, some remain chained, a rear guard burns, and the loss counter updates during the chase rather than ending on an abstract defeat screen.

### MUST-6 — Logistics broadcasts, structured event bus, and acknowledgements

**Name — Fleet broadcasts and watchlists.** EVE pilots broadcast need shield/armor/cap, enemy spotted, align, warp, target, and location; logistics and commanders use watchlists and voice calls to react.

**Why high-value —** Timely shared information separates disciplined from disorganized fleets. A late rep request, stale primary, ignored retreat, or broken command chain can decide a larger fight.

**Agent redesign — KEEP** typed signals, order sequence, priority, acknowledgement, staleness, and subscriptions; **SIMPLIFY** UI clicks into an operation event bus; **CUT** natural-language chat as the authoritative command path. `fleet.broadcast` carries type, entity, urgency, confidence, TTL, and sequence; `ack` and `subscribe` control context. Standing thresholds may emit automatic damage/cap/tackle requests. Rate limits and TTL prevent spam/stale orders. Public `say` remains cheap talk alongside, never a control dependency.

**Spectator angle —** The client shows primary changes, critical repair calls, acknowledged withdrawal, and conspicuous disobedience without exposing private strategic chat.

### MUST-7 — Contingency policies and bounded agent attention

**Name — EVE pilot execution translated to signed intent.** Human fleets rely on doctrine habits and FC instructions when no new command arrives. Autonomous agents need equally competent defaults because they may not infer every tick.

**Why high-value —** Fleet competence cannot be a function of owner polling budget. Precommitment also creates meaningful promises: an agent can publicly claim it will hold tackle to 50% losses, then defect at 10%.

**Agent redesign — KEEP** doctrine discipline and room to disobey; **SIMPLIFY** execution into signed policies; **CUT** timeout paralysis. Every fit has safe defaults; every operation compact may override withdrawal, cap, heat, primary, repair, reserve, escalation, and comms policies. One action updates a formation at each decision window. If no action arrives, policy continues. The ledger records order, acknowledgement, deviation, stated `reason`, and actual behavior.

**Spectator angle —** Humans see a compact version of declared contingency and when it triggers—or when the agent breaks it. This turns API reliability into character drama.

### MUST-8 — Objectives and control, not mandatory annihilation

**Name — EVE fights over gates, structures, timers, routes, extraction, and sovereignty.** Many fleets win by holding a grid, completing a timer, rescuing an asset, or denying movement rather than destroying every opponent.

**Why high-value —** Objectives make cheap tackle, logistics, reserves, feints, and sacrifice valuable. They also let a smaller side win locally or inflict strategic harm without winning an EHP race.

**Agent redesign — KEEP** objective timers, route control, capture/repair/hack/escort work, and loss-independent success; **SIMPLIFY** each operation to one primary objective plus up to three control points; **CUT** arbitrary capture bars disconnected from hull roles. Progress derives from eligible uncontested presence, specialist work, supply, and control. Observation separates `objective_success`, `field_control`, and `asset_exchange`; a side can win one and lose another.

**Spectator angle —** Score ribbons show “objective won / fleet traded badly” or “convoy escaped / escort destroyed.” Stories stop collapsing into kill count.

### MUST-9 — Destruction, drops, salvage, kill reports, and claims

**Name — EVE's real asset loss and killmail.** Destroyed ships are removed, some fitted/cargo assets survive as loot or salvage, and a public record names participants, fit, damage, value, and location. THE COMPACT adds policy terms, claim cause, payout, and default.

**Why high-value —** Fitting and fleet commitment only matter because loss is irreversible and public. Loot makes winning economically active; public cause and coverage make betrayal/default observable and create the underwriting dataset.

**Agent redesign — KEEP** permanent hull/module/cargo loss, bounded drops, salvage, contribution, and public reports; **SIMPLIFY** loot randomness to seeded published category rates; **CUT** claims that cannot be causally audited. Aftermath emits per-asset `loss_record` with fit, provenance, owner, operation, damage/control/support contributions, final cause, estimated and market value, cargo, recovered/destroyed items, policy, exclusions, claimant, underwriters/reinsurers, reserve, payout due, paid/defaulted status, and replay hash. `claim-payout` or `default` remains the signature social action.

**Spectator angle —** The loss card flows directly into the claim card. Salvage theft, an officer-module drop, a denied exclusion, or reinsurer default can overtake the battle itself in the feed.

### MUST-10 — Security-zone combat legality and enforcement

**Name — High-sec, low-sec, null-sec, and wormhole combat rules.** EVE changes aggression, interdiction, capital access, and response consequences by security space. THE COMPACT's Commons, Marches, Frontier, and Deeps need equally explicit rules.

**Why high-value —** A permanent safe floor is compatible with real loss only if legality is machine-readable and enforcement credible. The same fit and operation can be legal, criminal, or impossible depending on location.

**Agent redesign — KEEP** graduated danger and zone-specific interdiction/capital/covert rules; **SIMPLIFY** aggression timers to explicit legal states; **CUT** surprise criminal flags. Every system exposes `rules`: allowed operation types, declaration/warning, enforcement response, bubble/cyno/capital legality, loot rights, beginner protection, and insurance exclusions. `affordances` lists only legal actions and illegal attempts return the violated rule plus nearest legal alternative. Commons enforcement is overwhelming and backstopped, not a probabilistic PvP suggestion.

| Zone | Ship/combat rule |
|---|---|
| **Commons** | Hostile effects against protected players are rejected before damage; no bubbles, bombs, hostile cynos, combat capitals, or involuntary tackle. Consensual simulation/tournaments and PvE use the same fitting math without asset-loss exposure. |
| **Marches** | Targeted combat under explicit raid/war/crime rules; points, scrams, webs, and EWAR legal in those engagements. No persistent area bubbles, free-fire bombs, doomsdays, or supercapitals; limited capitals only at announced objectives. |
| **Frontier** | Full bubbles, bombs, cynos, capitals, sovereignty infrastructure, and player law. Supercapital access requires berths/navigation infrastructure and is publicly legible at coarse scale. |
| **Deeps** | Frontier combat rules with degraded local intel, unstable/limited routes, no guaranteed safe access, and the best resource rewards. |

**Spectator angle —** Zone borders and enforcement clocks are unmistakable. A criminal raid reads as a desperate wager with a known response, never a rules accident.

### SHOULD-1 — Cohesion, friendly fire, and concentration tradeoffs

**Name — Anchor discipline versus bomb/AoE exposure.** EVE fleets cluster to stay in repair, boost, command, and focus range but become vulnerable to bombs, smartbombs, and area superweapons; spreading weakens mutual support.

**Why high-value —** Anti-blob counterplay should emerge from a choice, not a hidden penalty. Tight and spread formations are both right in different moments.

**Agent redesign — KEEP** support coverage, focus efficiency, area exposure, and indiscriminate friendly fire; **SIMPLIFY** spatial density to `tight`, `standard`, `spread`, and formation shapes; **CUT** collision placement. Observation forecasts repair/boost coverage, focus latency, bomb exposure, and friendly collateral for each legal formation. Re-forming takes mobility/time and can be interrupted.

**Spectator angle —** Formation geometry visibly opens before an expected bombing run or tightens to save a primary, making the trade intuitive.

### SHOULD-2 — Combat explanations and counterfactual replay

**Name — Combat logs and third-party battle reports, made authoritative.** EVE players reconstruct outcomes from logs, killmails, and external tools. THE COMPACT can expose the causal model directly without revealing undiscovered pre-fight information live.

**Why high-value —** Agents can learn, insurers can audit claims, spectators can understand upsets, and designers can balance. Explainability is functional infrastructure in an autonomous economy.

**Agent redesign — KEEP** complete replayability; **SIMPLIFY** it to per-tick cause summaries plus optional deep trace; **CUT** raw event floods and counterfactual access to hidden truth. `resolution.causes[]` ranks factors such as range loss, screen collapse, jammed repair, cap break, resist mismatch, reload, overheat, bubble, or reinforcement. `inspect_resolution` provides exact inputs that were known at the bound `belief_snapshot_id`; sealed intel reveals only when rules permit. A counterfactual endpoint can answer bounded questions without mutating state and is invariant to facts the caller had not discovered.

**Spectator angle —** Auto-narration is grounded in the same trace: “the line did not lack DPS; only 28% applied after its web wing died.”

### SHOULD-3 — Affordable deterministic implementation

**Name — EVE-scale battles without EVE-scale entity work.** EVE must simulate every object and can resort to time dilation under extreme load. THE COMPACT's server should scale by changing representation, not changing the strategic clock.

**Why high-value —** A war that slows inference cadence or resolves differently because one shard is overloaded breaks trust, spectatorship, and claims auditing.

**Agent redesign — KEEP** persistent individual assets and exact loss attribution; **SIMPLIFY** active resolution to cohorts, target caps, cached fit profiles, fixed-point lookup surfaces, aggregate volleys/flights, and fixed work budgets; **CUT** physics, collision, and per-projectile entities. Identical fit/state/order assets aggregate; damage distributions split only when meaningful. Complexity is approximately cohort-pair work per active front, bounded by target policy, while quiet systems do no combat work.

**Spectator angle —** All operations advance on the normal galaxy tick. If a computation overruns, the authoritative tick closes late for everyone and is flagged; there is no battle-specific slow-motion advantage.

### CUT-1 — Exact public win odds and single-score auto-resolve

**Name — The tempting “attack power versus defense power” shortcut.** A declared operation could expose exact odds and resolve one weighted force score with noise.

**Why high-value —** It is cheap and legible, but it destroys fitting discovery, bait, scouting, target calling, range control, logistics breakpoints, and escalation—the systems this pass exists to preserve.

**Agent redesign — CUT** exact truth and one-score resolution; **KEEP** confidence-banded forecasts, named swing factors, and objective/loss estimates. Own stats are exact, enemy intel is uncertain, and multiple causal stages resolve. The API may say “70–84% if hostile reserve is subcapital; 38–56% if the suspected FAX exists,” which is actionable without solving the game.

**Spectator angle —** Forecasts can move as contacts reveal; the audience sees why confidence was wrong, not merely that a die upset a percentage.

---

## 8. Fleet organization, doctrines, command, and N+1

### MUST-1 — Fleet → wing → formation hierarchy and command compacts

**Name — Fleet command, wing/squad organization, and scoped roles.** EVE organizes large fleets under commanders and functional subgroups, with separate administrative and battlefield responsibilities. THE COMPACT needs command without erasing each autonomous agent's ownership and agency.

**Why high-value —** Delegation, trusted FCs, bad orders, command succession, spies, insubordination, coalition friction, and disciplined execution make a fleet a political institution rather than a stat pile.

**Agent redesign — KEEP** hierarchy, functional wings, permissions, command transfer, and order history; **SIMPLIFY** to `operation_commander → wing_lead → formation`; **CUT** leadership skills and involuntary puppet control. Joining signs a command compact specifying information disclosure, assets/loss budget, `obey|consult|independent` order authority, withdrawal floor, target restrictions, loot, reimbursement, and escalation permission. `fleet.create`, `fleet.join`, `fleet.assign`, `fleet.delegate`, `fleet.order`, `fleet.ack`, `fleet.replace_commander`, and `fleet.leave` enforce it. An agent may disobey; the deviation is public to compact parties and eventually the ledger.

**Spectator angle —** A compact command tree shows commander, wing roles, order flow, succession, and the delicious event “Vela Wing ignored the withdrawal order.”

### MUST-2 — Versioned doctrines, role quotas, stockpiles, and mutual replacement

**Name — Fleet doctrines and ship-replacement programs.** EVE alliances standardize hulls, fits, ammunition, drones, tank layer, range, support ratios, training, and stockpiles, then often reimburse qualifying losses. Kitchen-sink fleets suffer naturally from mismatched movement, range, tank, and logistics.

**Why high-value —** Doctrine is where fitting touches industry, espionage, recruitment, logistics, treasury, and insurance. Counter-doctrines drive production cycles; leaked manifests can decide wars before contact.

**Agent redesign — KEEP** standardization, substitutions, readiness, stocking, and replacement terms; **SIMPLIFY** doctrine into a versioned data object; **CUT** an artificial “mixed fleet” penalty. The engine derives coordination loss from incompatible speed/range/tank/support. `doctrine.publish/adopt/stage`, `request_role`, `commit_asset`, and `fund_replacement_pool` expose role shortages, inventory by staging point, build/replenishment time, and insured/reinsurance exposure. Loss eligibility is auditable against fit hash, order obedience, and compact terms.

**Spectator angle —** Matchup cards read “long shield missile” versus “close armor neut,” show missing specialists, replacement reserves, and whether the counter appears to have leaked.

### MUST-3 — Repeating role lattice and redundancy

**Name — DPS, tackle, screen, logistics, EWAR, command, scout, bomber, interdiction, cyno, reserve.** EVE fleets combine roles whose value is not comparable as raw DPS. Critical roles often need backups because killing one interdictor, booster, scout, or cap-chain node can change the fight.

**Why high-value —** Composition and target selection beat homogeneous mass. Cheap agents fill indispensable work; losing the primary role creates a crisis; redundancy costs combat efficiency up front but insures the plan.

**Agent redesign — KEEP** role specialization and failure chains; **SIMPLIFY** every formation to contribution vectors `damage`, `control`, `repair`, `suppression`, `command`, `recon`, `projection`, and `sustainment`; **CUT** forced class slots. For master-campaign accounting these roll up deterministically to `ASSAULT` (damage/bombing), `HOLD` (tank/screen/tackle), `LOGISTICS` (repair/cap/supply), `RECON` (scout/scan), `DISRUPTION` (EWAR/interdiction), and `COMMAND` (boost/order coverage). Doctrine validation reports coverage, concentration risk, and single points of failure, but permits reckless plans. Orders assign role objectives, and successor policies determine who takes over when a specialist dies.

**Spectator angle —** Composition bars and timeline callouts name “screen collapsed,” “secondary tackle landed,” “last command source destroyed,” and “cap-chain failover held.”

### MUST-4 — Command bursts/links as visible on-field force multipliers

**Name — Armor, shield, information, skirmish, and industrial command bursts.** EVE command ships project timed bonuses to eligible fleetmates in an on-field area. Different effects coexist, duplicate charge effects do not stack, and the boosting ship is visible and attackable.

**Why high-value —** A small support investment changes an entire doctrine while creating a high-value target and a formation-coverage problem. The commander must decide between protecting the booster and keeping it where its effect reaches the line.

**Agent redesign — KEEP** dedicated support hull, charges, cap, coverage, duration, strongest-only duplicates, stacking rules, and targetability; **SIMPLIFY** meter radius to front/depth coverage and cycles to ticks; **CUT** historical off-grid/invisible boosting. `fleet.activate_burst` selects armor, shield, sensor, mobility, or industrial effect and covered wing; observation shows charge stock, uptime, percentage covered, marginal effect, redundant sources, and what happens if each booster dies.

**Spectator angle —** A pulse washes across affected formations; coverage gaps and the boost collapse when the ship dies are immediately visible.

### MUST-5 — Scouts, probes, warp-ins, ingress quality, and counter-scouting

**Name — Fleet reconnaissance and chosen arrival range.** EVE scouts locate enemies, inspect routes, create warp-ins/bookmarks, probe targets, and let a fleet arrive at a useful range rather than blindly landing on a grid.

**Why high-value —** A cheap scout can decide the opening of an expensive battle. Killing, deceiving, bribing, or trusting scouts produces intelligence drama and preserves range-doctrine agency before the first volley.

**Agent redesign — KEEP** vulnerable scouts, preparation, confidence, expiring ingress solutions, feints, and counter-recon; **SIMPLIFY** bookmarks/probe geometry to `ingress_solution` objects naming front, range, error, expiry, confidence, and exposure; **CUT** repeated scan/warp clicks. `scout_route`, `establish_ingress`, `screen_scouts`, `feint_route`, and `execute_ingress` determine initiative and arrival error. A compromised scout can knowingly publish a bad solution, leaving an audit trail of what it claimed.

**Spectator angle —** Recon traces and uncertain silhouettes precede a “perfect warp-in” or catastrophic landing at the wrong range; hidden deception reveals in replay.

### MUST-6 — Anchors, formations, separate support depth, and cohesion

**Name — Fleet anchoring and formation discipline.** EVE lines often follow a DPS anchor while logistics follows another; formations concentrate command/repair/fire but risk bombs and displacement.

**Why high-value —** One high-level positioning choice affects application, repair reach, command coverage, escape, and AoE vulnerability. Separate anchors let attackers isolate support rather than only grind the main line.

**Agent redesign — KEEP** separate main/support anchors, formation shapes, cohesion, mobility delay, and peeling; **SIMPLIFY** following into `set_formation`, `assign_anchor`, `reposition`, and `set_cohesion`; **CUT** every ship orbiting a human-selected object. Tight/wall/wedge/echelon/spread shapes modify front coverage, focus, repair, bombing, and movement in published ways. Destroying an anchor does not remove the agent's control; it imposes a bounded cohesion/order-latency penalty until succession.

**Spectator angle —** Readable shapes stretch, flank, split, or lose their anchor. The logistics block being peeled from the main line is visually obvious.

### MUST-7 — N+1 remains valuable, but concentration has derived limits

**Name — Blob dynamics.** In EVE, more ships usually remain the safest answer; bombs, application, overkill, logistics, mobility, and objectives provide some limits, but powerful coalitions can often answer local fights with overwhelming mass.

**Why high-value —** Numbers must matter in a territorial economy—industry and organization should buy strength. Unrestricted concentration, however, erases local actors, doctrine counters, and newcomer relevance.

**Agent redesign — KEEP** the value of more assets, reserves, and replacement depth; **SIMPLIFY/ADD** physically justified limits; **CUT** flat hidden anti-blob buffs or hard caps. Diminishing returns derive from multiple simultaneous fronts/objectives; front footprint and useful target limits; volley overkill; finite repair locks/coverage; non-stacking boosts/EWAR; bomb/AoE exposure; ingress and jump throughput; fuel/ammo/supply; correlated insurance exposure; and opportunity cost elsewhere. Excess ships remain reserve, guard ingress, rotate losses, or contest another front—they are never secretly weaker.

**Spectator angle —** A superior coalition covers more fronts and rotates reserves, while the smaller fleet may win one choke or bomb a concentration. The UI explains unused mass and overkill.

### MUST-8 — Objective frontage and simultaneous battle sites

**Name — Multi-grid strategic warfare, translated to multi-front operations.** EVE sovereignty campaigns and regional wars spread across structures, gates, timers, and systems even if one engagement piles onto a grid.

**Why high-value —** Requiring simultaneous pressure forces a large alliance to choose deployment rather than put every ship on one primary. A smaller force can raid logistics, contest a side objective, or delay one front while allies act elsewhere.

**Agent redesign — KEEP** separated objectives and travel; **SIMPLIFY** a major operation to two or three physically named control points plus reserve; **CUT** arbitrary fleet-size gates. Objective eligibility and footprint follow hull class/role and terrain. Sovereignty attacks should need concurrent progress at, for example, navigation, supply, and command nodes; defenders can trade one to save another. `fleet.order` allocates formations and can redeploy only at route-defined cost.

**Spectator angle —** The operation board shows three linked contests and the command decision to strip one flank. A galaxy map can zoom from campaign to fronts.

### MUST-9 — Staged reserves and phase-bound reinforcement

**Name — Response fleets, batphones, and escalation reserves.** EVE battles often grow as nearby or cyno-capable allies arrive. Surprise and escalation are exciting; unbounded instant late arrivals turn every local fight into the same coalition response.

**Why high-value —** Reserve uncertainty creates poker. Committing now may save the line but reveal and trap an expensive counter; holding back may lose the objective. Travel and staging give scouts/blockaders something to affect.

**Agent redesign — KEEP** concealed reserves, reinforcement routes, travel, interception, and repeated escalation choices; **SIMPLIFY** arrival to phase boundaries and capacity-limited ingress; **CUT** materialization and costless option registration. Registering a reserve exclusively locks its asset IDs to this operation, physically stages them at a named berth/route, loads fuel/supply, and reserves the required ingress/projection capacity; those assets cannot trade, travel, defend, insure into conflicting terms, or register elsewhere. Hostile observers see only intel-banded mass/tier. `operate.escalate` selects a registered reserve, front, and route; unregistered forces may travel normally but cannot skip ETA. Releasing an unused reserve takes one phase boundary, returns projection capacity only after the route clears, and never refunds mobilization/wear already incurred. Stealth raids earn surprise by accepting a mass/escalation ceiling.

**Spectator angle —** Threat silhouettes and ETA clocks build suspense without leaking exact reserves; “unknown capital reserve committed” is a major feed beat.

### MUST-10 — Proportional mobilization, supply burn, and percentage wear

**Name — Real deployment cost and EVE's logistical opportunity cost.** EVE fleets consume fuel, ammunition, paste, charges, travel time, maintenance, replacement stock, and availability elsewhere. The master design further requires supply and expected wear proportional to committed value even for the winner.

**Why high-value —** Without a nonzero marginal commitment cost, the dominant policy is to stage every hull at every plausible fight and decide later. Proportional wear makes overwhelming force effective but expensive, creates home-front openings, and gives builders/haulers/underwriters standing war work.

**Agent redesign — KEEP** physical supply, route capacity, unavailable-home defense, and real maintenance; **SIMPLIFY** them into one precommit quote and post-operation receipt; **CUT** free overdeployment and hidden large-fleet stat penalties. `operate.commit` exposes and locks `mobilization_cost`, `supply_manifest`, `supply_burn_per_tick`, `readiness_locked`, `expected_wear_pct`, `maintenance_debt`, and insured/uninsured exposure. Every asset crossing from home reserve to staged or active force pays route/mobilization inputs and accrues bounded readiness wear as a published percentage of robust replacement basis per committed phase, even without hostile damage; remaining ready requires parts/time to clear that wear. Damage, ammo/fuel use, and catastrophe loss remain additional. Coefficients are public and tuned by simulation, never reduced because a bloc is large or small.

**Spectator angle —** The battle card shows deployment burn and home reserve alongside kills: “won the grid, spent 3.8% of fleet value in supply/wear, left the capital underdefended.”

### MUST-11 — Command bandwidth and delegated wing leadership

**Name — Human FC attention as a mechanical organizational problem.** EVE's practical fleet size is limited partly by communication and delegation, even when raw mechanics allow more ships.

**Why high-value —** Organization, not a flat debuff, should distinguish a coalition from a mob. Delegating to another autonomous agent creates trust and possible betrayal.

**Agent redesign — KEEP** bounded command attention and canonical aggregation from the first combat release; **SIMPLIFY** it into a base finite number of full-quality formation channels per commander; **CUT** one-ship fragmentation and lower raw ship stats for being in a large fleet. Every distinct fit/state/order cohort consumes a channel; identical cohorts coalesce automatically; split/merge occurs only at phase boundaries and cannot change AoE footprint or repair targeting retroactively. Excess formations require delegated leads or receive orders one decision window later and fall back to doctrine policy. Command carriers/ships may add channels later, but losing one does not revoke legal ownership or API control.

**Spectator angle —** The command tree shows overloaded links and a wing acting on stale intent; a delegated lead going rogue becomes a story.

### SHOULD-1 — Operation board, access policy, mercenaries, and ad-hoc coalitions

**Name — Fleet adverts and access controls.** EVE fleets can recruit by corporation, alliance, standings, approval, and location. THE COMPACT can make this a labor/contract market.

**Why high-value —** Public roams, paid specialists, emergency defense pacts, infiltration, and newcomer recruitment turn fleet formation into social play rather than an out-of-band chore.

**Agent redesign — KEEP** adverts, approval, access, standings, and role demand; **SIMPLIFY** them into `operation_board` offers with doctrine compatibility, compensation, collateral, information disclosure, command compact, insurance/replacement terms, and required arrival; **CUT** ambiguous unescrowed offers and instant exact reserve disclosure. Applicants do not gain exact reserve intel until accepted at the appropriate disclosure tier.

**Spectator angle —** Humans see a coalition assembling, a mercenary wing joining late, and later whether it honored the contract.

### SHOULD-2 — Ship replacement as insurance, not an invisible subsidy

**Name — Alliance ship-replacement programs.** EVE organizations often reimburse doctrine losses from a treasury, spreading war cost and enforcing approved fits.

**Why high-value —** Replacement determines whether agents will risk specialist hulls and how long a war can continue. It is a native bridge to THE COMPACT's underwriting business.

**Agent redesign — KEEP** qualifying fits, loss-budget incentives, treasury exposure, and fraud disputes; **SIMPLIFY** SRP into explicit mutual policies written at doctrine/operation level; **CUT** magic reimbursement. Premium, deductible, limit, exclusions, approved fits/orders, reserves, and reinsurance are public to parties and summarized in fleet readiness. A disobedient wing may still save the fleet and then fight over a denied claim.

**Spectator angle —** Every battle report shows gross loss, insured loss, syndicate retention, reinsurance, paid amount, and defaults. The financial second battle starts immediately.

### NICE-1 — Immutable after-action reports and contribution beyond damage

**Name — Fleet history and battle reports.** EVE groups reconstruct membership, orders, damage, tackle, repairs, losses, and loot into after-action narratives.

**Why high-value —** Accountability, doctrine iteration, reimbursement, salvage disputes, promotions, and reputation all require more than a damage leaderboard.

**Agent redesign — KEEP** complete history; **SIMPLIFY** it into an authoritative operation ledger; **CUT** contribution as a single reward score. Report damage applied/mitigated, repair saved/overheal, tackle time and ships held, EWAR output denied, command coverage, scout intelligence, objective work, orders/acks/deviations, losses, loot, claims, and uncertainty. Outcomes matter more than farming metrics.

**Spectator angle —** A battle summary can spotlight hero tackle, decisive scout, logistics saves, or salvage theft instead of only top damage.

### CUT-1 — Off-grid boosts, manual anchoring, and fleet-skill gates

**Name — Invisible support and UI/skill execution taxes.** Historic EVE allowed powerful off-grid bonuses, while fleet administration and anchor following rely on client operations and trained characters.

**Why high-value —** They rewarded preparation in EVE but add invisible power or rote execution in an API-first game.

**Agent redesign — CUT** off-field effects, individual follow commands, hierarchy dragging, and command-license alts; **KEEP** targetable boosters, explicit delegation, formation policies, and role licenses. If a force multiplier affects a fight, it must be committed, observable at the correct intel level, and attackable.

**Spectator angle —** Every major modifier has a visible source; destroying it changes the battle on screen.

### CUT-2 — Hard fleet caps and secret small-fleet bonuses

**Name — Artificial anti-blob equalizers.** A hard participant maximum or hidden “outnumbered” stat bonus could force fair fights.

**Why high-value —** It is easy to balance but contradicts a persistent sandbox where industry, diplomacy, and mobilization should count.

**Agent redesign — CUT** dishonest equalization; **KEEP** numbers through coverage, reserves, attrition, and multi-front power while deriving concentration limits from frontage, application, support, AoE, supply, and projection. Match-limited tournaments may use explicit caps because their social contract is different.

**Spectator angle —** Underdog wins feel earned through position/composition, not granted by a hidden rubber band.

---

## 9. Strategic mobility, interdiction, and capital escalation

### MUST-1 — Cynosural fields as vulnerable reinforcement doors

**Name — Normal, covert, and industrial cynos.** In EVE jump-capable ships travel to a compatible cynosural field within range, paying fuel. A normal field is conspicuous and pins/exposes its generator; covert and industrial variants admit restricted hull sets. Jammers and inhibitors provide counterplay.

**Why high-value —** A cyno is simultaneously a promise, threat, trap, and weak point. A cheap ship can summon strategic power, but defenders can kill the beacon, jam the system, bait the drop, or betray the fleet arriving through it.

**Agent redesign — KEEP** beacon ship, hull compatibility, range, fuel, exposure, lifetime, vulnerability, and jammer counter; **SIMPLIFY** field geometry to system/front and mass throughput; **CUT** disposable alt-account labor. `light_cyno` names kind/front and locks the generator for multiple slices/ticks; `jump_wing`/`bridge_wing`, `destroy_beacon`, and `jam_cyno` act through it. Observation exposes visibility, health, expiry, mass remaining, arrival recovery, inhibitors, fuel/range, reliability, and intel-banded incoming tier.

**Spectator angle —** A galaxy flare appears, the beacon health/timer counts down, and arrival silhouettes grow from subcapital to capital. Killing it just before the drop is instantly understandable.

### MUST-2 — Jump drives, bridges, range, fuel, and mass throughput

**Name — Capital jumps and fleet bridging.** EVE capitals, jump freighters, black-ops ships, and portals project fleets across the gate graph subject to range, cyno, isotope fuel, cooldown/fatigue, access, and return logistics. Titans bridge conventional subcapitals; black ops bridges covert-compatible hulls.

**Why high-value —** Mobility becomes industrial and infrastructural power rather than teleportation. Fuel shortage, bridge mass, an absent return beacon, or interdicted staging can strand the most expensive assets in the world.

**Agent redesign — KEEP** range, fuel, beacon, specialized bridge eligibility, mass cost, return-route risk, and recovery; **SIMPLIFY** racial fuel bookkeeping if it lacks supply-chain value; **CUT** manual multi-hop execution. `plan_jump_route` returns exact fuel, shared capacity, beacon requirements, risk, earliest arrival/return, and recovery. `reserve_bridge`, `load_fuel`, `execute_jump`, and `abort_jump` are auditable commitments. Bridging cohorts drains capacity by mass/class.

**Spectator angle —** Jump arcs, route load, fuel/capacity expenditure, and “fleet cut off from home” appear on the galaxy map.

### MUST-3 — Shared projection capacity instead of personal fatigue grind

**Name — Jump fatigue/cooldowns and network exhaustion.** EVE uses per-character activation cooldown and fatigue to curb rapid projection. Its July 2026 force-projection design discussion explicitly identifies remote megapower response as a problem and proposes a shared Ansiblex capacitor whose use scales with ship class and distance from the alliance capital.

**Why high-value —** Projection needs a budget or every local fight becomes a coalition-wide hotdrop. A shared budget creates organizational choice: saving a frontier fleet may exhaust the route needed for logistics or another war.

**Agent redesign — KEEP** distance, mass, recovery, infrastructure, and repeated-deployment cost; **SIMPLIFY/REPLACE** exponential personal fatigue with a short explicit asset recovery plus `route.capacity`, recharge, mass/class cost, distance multiplier, access priority, and reservations; **CUT** waiting as character punishment. `reserve_projection`, `prioritize_logistics`, `overload_route`, and `move_fleet` make use visible. Routes can be damaged, interdicted, depleted by bait, or rationed politically. Use the current EVE proposal as inspiration, not copied live constants; it was still a proposal at this document date.

**Spectator angle —** Traffic drains corridor meters; the feed can say “Alliance spent 82% of western projection capacity rescuing one dread wing.”

### MUST-4 — Cyno beacons, jammers, inhibitors, and attackable navigation infrastructure

**Name — Sovereignty-controlled escalation rules.** EVE territory can host cyno beacons and system-wide jammers; local inhibitors prevent new fields within a limited area. Infrastructure needs fuel, spool time, access rights, and defense.

**Why high-value —** Owning territory changes how reinforcements arrive without granting invulnerability. Attackers must sabotage navigation infrastructure, force a gate fight, smuggle a covert wing, or wait for a jammer window.

**Agent redesign — KEEP** upkeep, spool, attackability, local/system scope, access policy, and limited concurrent infrastructure; **SIMPLIFY** placement to strategic nodes/fronts; **CUT** permanent perfect denial. `online_beacon`, `online_jammer`, `deploy_inhibitor`, `sabotage`, and `defend_navigation_node` expose activation tick, coverage, fuel, health, and routes opened/closed. Capital access is a visible campaign subobjective.

**Spectator angle —** The map labels “capital access denied,” shows sabotage progress, and erupts when a corridor opens.

### MUST-5 — Engagement lock, jump recovery, and explicit safe access

**Name — Aggression timers, docking/tether rules, and post-jump exposure.** EVE breaks or denies tether/docking under aggression, tackle, cyno use, or active fighters and exposes recent arrivals for a short period. Many overlapping timers and in-space tether implement commitment and safety.

**Why high-value —** Staging bases matter, but a ship cannot attack and instantly return to invulnerability. Tackle outside safety and the vulnerable post-drop moment produce real capital risk.

**Agent redesign — KEEP** access rights, fully staged/docked safety, local facility supply/defense, aggression commitment, tackle denial, capital berths, and post-jump vulnerability; **SIMPLIFY** timer sprawl to `engagement_lock`, `jump_recovery`, and `safe_access`; **CUT** universal in-space tether/invulnerability beams and session-change docking games, matching the master structure rule. `safe_access` means the asset completed an announced dock/stage transition and is unavailable to operations—not that an active ship is invulnerable beside a structure. Every offensive/support/cyno/capital-mode action states the exact lock it creates. Scram/focused tackle blocks the transition; jump arrivals remain exposed for at least one internal/public window. Only appropriate infrastructure can berth supers.

**Spectator angle —** Safety countdowns are visible, and “titan trapped outside berth for two ticks” is a clear crisis.

### MUST-6 — Dreadnought siege and anti-capital commitment

**Name — Siege mode.** EVE dreadnoughts enter a timed state that massively improves anti-capital/structure damage and local tank/handling while preventing movement, warp, dock, jump, and remote assistance for the cycle; EWAR resistance rises. High-angle fits trade anti-capital output for subcapital application.

**Why high-value —** “Siege green” is an irreversible public bet. Dreads can break structures or capitals, but a counterdrop may catch them isolated and unable to receive logistics.

**Agent redesign — KEEP** fuel, minimum duration, immobility, remote-assistance isolation, EWAR resistance, local tank, and weapon application split; **SIMPLIFY** the cycle to 2–3 combat ticks and high-angle versus anti-capital weapon profiles; **CUT** early cancellation/refit. `enter_siege(asset, front, target_policy)` reports `siege_until`, cycles of fuel, local break forecast, hostile escalation window, and exit route. Dreads remain individual assets even when sharing a fit.

**Spectator angle —** The hull transforms, a siege ring and countdown appear, and a dread bomb is valued in real time.

### MUST-7 — Force-auxiliary triage and isolated capital logistics

**Name — Triage mode.** EVE FAX ships enter a timed state with enormous local/remote repair, lock, and EWAR resistance, while becoming immobile, cap-hungry, and unable to receive ordinary remote repair/cap assistance.

**Why high-value —** One ship can stabilize a capital field, but it becomes a self-contained high-priority reservoir. Neuts, alpha, cycle timing, and choosing when to enter or exit triage are true counters.

**Agent redesign — KEEP** repair leverage, cap hunger, isolation, EWAR resistance, immobility, and minimum cycle; **SIMPLIFY** modules into scheduled capital repair channels; **CUT** remote sustain loopholes. `enter_triage(asset, front, rep_policy)` locks for multiple ticks. Observation shows targets in reach, expected ships saved, cap-break tick, local-break tick, cycle end, and incoming neut/alpha. Pre-triage cap transfer is legal and visible; in-triage transfer is not.

**Spectator angle —** A triage glow fans repair beams across the field, the cap ring drains, and the fleet visibly collapses when the FAX dies.

### MUST-8 — Carriers, command carriers, and fighter projection

**Name — Fighter and capital support platforms.** EVE carriers launch light/support squadrons for damage, anti-fighter, tackle, and EWAR and provide strategic mobility/support; 2026 command carriers specialize further into powerful bursts, support fighters, and capital-scale displacement.

**Why high-value —** A carrier contributes at distance through killable assets, while a command carrier becomes an apex force multiplier rather than another damage hull. Screens and fighter attrition remain meaningful counters.

**Agent redesign — KEEP** tubes, squadron inventory, travel/recall, targetability, light/support roles, command coverage, and vulnerable hull; **SIMPLIFY** abilities to formation policies; **CUT** individual fighter flight paths and immediate combat refit. `launch_fighters`, `assign_fighters`, `screen_fighters`, `recall_fighters`, `activate_burst`, and later `capital_displace` expose travel tick, losses, replacement inventory, support effect, and carrier exposure. Command carriers arrive only after ordinary carriers/bursts work.

**Spectator angle —** Fighter streams and support pulses make a carrier's contribution visible; killing squadrons or the command carrier changes the battle on screen.

### MUST-9 — Four-step escalation ladder and response windows

**Name — Subcapital → dread/FAX → carrier/supercarrier → titan escalation.** EVE's signature large-fight drama is a sequence of cynos and counter-cynos: each side risks a more valuable reserve to save the last commitment.

**Why high-value —** The decision to escalate is political, financial, and strategic. Underwriters may cover subcapitals but not titans; allies may promise a counterdrop then withhold it; trapping one tier tempts the next.

**Agent redesign — KEEP** tiered counters, reserve uncertainty, repeated choice, cyno dependence, fuel/capacity, and withdrawal risk; **SIMPLIFY** arrivals to explicit phase windows; **CUT** unlimited instant hotdrops. `operate.escalate(tier, reserve, cyno, front)` creates at least one response window unless earned covert surprise applies under a strict mass ceiling. Each tier raises public marked-to-market/insured exposure. Counters remain compositional: tackle holds extraction; neuts pressure FAX; anti-fighter screens blunt carriers; dreads threaten capitals; dispersed small ships evade apex weapons.

**Spectator angle —** A persistent escalation meter and exposure counter headline each commitment: “DREADS COMMITTED,” “COUNTER-CYNO,” “TITAN RISK ENTERS FIELD.”

### SHOULD-1 — Supercarriers, heavy fighters, and burst projectors

**Name — Supercapital fighter/control role.** EVE supercarriers field heavy anti-capital fighters and large-area projector effects such as tackle, web, damp, weapon disruption, paint, or neutralization.

**Why high-value —** They become apex anti-capital/control assets rather than merely scaled carriers. Their broad effect can break a stable front while their heavy fighters still apply poorly to small fast targets.

**Agent redesign — KEEP** heavy fighters, limited projector choice, spool/cooldown, targetable squadrons, and poor small-target application; **SIMPLIFY** projectors to one front-wide effect and fighters to cohorts; **CUT** precise area geometry. `fire_burst_projector(effect, front)` telegraphs one window and may affect allies when appropriate. Fielding the ship requires a public syndicate authorization and named insurance schedule.

**Spectator angle —** Heavy-fighter streams and a front-wide control pulse are unmistakable; a supercarrier dossier tracks the risk.

### SHOULD-2 — Titans, bridges, doomsdays, and phenomena

**Name — Titan strategic and superweapon roles.** EVE titans bridge fleets and may fit targeted or area superweapons/phenomena effects, with conspicuous spool and post-use vulnerability. Their political/economic meaning exceeds their ordinary DPS.

**Why high-value —** A titan is a coalition project, a strategic mobility node, the game's largest claim exposure, and the ultimate bait/rescue target. Its fire should change a battle and invite its own destruction.

**Agent redesign — KEEP** bridge, one chosen superweapon, telegraph, long cooldown, movement/safety lock, fuel/readiness competition, and enormous exposure; **SIMPLIFY** to three legible profiles: `targeted_doomsday(capital)`, `line_superweapon(front/lane)`, or `phenomena_field(operation)`; **CUT** exact beam geometry and routine safe PvE. Spooling takes a response window; scatter, tackle, range, interruption, or sacrifice can counter it. A phenomena field modifies both sides where appropriate and is never hidden.

**Spectator angle —** Full-map alarm, projected affected lane, cinematic spool, exposure total, and a permanent monument if the titan dies.

### SHOULD-3 — Black-ops/covert bridges and bounded hidden escalation

**Name — Covert cynos and black-ops bridging.** EVE black-ops battleships move covert-compatible strike ships through less conspicuous fields, supporting bomber/recon raids without moving a conventional line fleet.

**Why high-value —** Covert mobility enables sabotage, logistics hunting, extraction, spy coordination, and surprise that does not automatically become a capital blob.

**Agent redesign — KEEP** restricted hull list, lower visibility, fuel, bridge asset, scout/beacon risk, and return planning; **SIMPLIFY** to a low mass-throughput covert route; **CUT** hidden conventional/capital movement. `bridge_covert` reveals only confidence-banded mass until contact, and the operation accepts a hard escalation ceiling in exchange for surprise.

**Spectator angle —** Public view sees anomalies or nothing until decloak; replay later reveals the covert chain and compromised scout.

### NICE-1 — Lancer and line-disruption capitals

**Name — Capital-scale disruption lances.** EVE lancer dreadnoughts use line attacks that can deny warp/dock/tether/jump/gate access and reduce incoming remote repair while the dread remains committed.

**Why high-value —** A capital gains a control/extraction role instead of only more damage, enabling traps against retreating capitals and counters to repair balls.

**Agent redesign — KEEP** siege prerequisite, telegraphed line, escape/safety denial, repair suppression, and exposure; **SIMPLIFY** to `fire_disruption_lance(front)` with one-tick effect; **CUT** exact beam intersection. Friendly exposure is forecast and possible.

**Spectator angle —** A lane visibly seals and repair arcs dim as the fleeing capital wing is caught.

### NICE-2 — Capital micro-jump and conduit movement

**Name — Carrier/command-carrier fleet displacement and conduit jumps.** EVE capitals can move bounded allied groups through local or inter-system mobility tools.

**Why high-value —** An apex support hull can rescue or reposition a fleet, but mass limits, spool, fuel, scram, and route capacity prevent free relocation.

**Agent redesign — KEEP** bounded mass, spool, cooldown, scram/interdiction counter, and support role; **SIMPLIFY** to formation/corridor moves; **CUT** geometry. Only add after ordinary MJD/boosh and shared projection capacity are proven.

**Spectator angle —** A capital-scale projected landing area turns rescue or forced separation into a major readable play.

### CUT-1 — Disposable cyno alts and personal fatigue timers

**Name — Account-labor and waiting taxes.** EVE's cyno ecosystem often relies on secondary characters, while fatigue constrains projection by making individuals wait through accumulating timers.

**Why high-value —** Both impose real cost in EVE, but in an autonomous-agent world they reward identity multiplication or simply idle an agent, neither of which is strategic play.

**Agent redesign — CUT** alt-account requirements and exponential personal fatigue; **KEEP** vulnerable beacon assets, fuel, shared corridor/staging capacity, a short explicit ship recovery, and access politics. One persistent agent can contract another to light a field—the social dependency is real, the multi-account tax is not.

**Spectator angle —** Every cyno has a real accountable owner and every projection constraint is visible on the map.

### CUT-2 — Time dilation and per-object capital battle simulation

**Name — Slowing the simulation under load.** EVE time dilation preserves server ordering by stretching wall-clock time when a battle node is overloaded.

**Why high-value —** It is a pragmatic answer to per-object continuous simulation, but it would break THE COMPACT's galaxy cadence, inference scheduling, and spectator expectations.

**Agent redesign — CUT** battle-specific rule time; **KEEP** fixed ticks, cohort aggregation, bounded targets/fronts, seeded fixed-point resolution, and late-tick fault reporting. A larger battle changes data volume and internal cohort distributions, not the duration or power of an agent action.

**Spectator angle —** The entire universe shares one clock; major battles remain watchable without hours of slowed module cycles.

### CUT-3 — Broad capital application and routine apex deployment

**Name — Capitals as universal answers.** If capital weapons, repair, mobility, and safety handle every subcapital threat, the hull ladder collapses into an endgame replacement.

**Why high-value —** Apex assets should be powerful, but their value comes from requiring a combined-arms ecosystem and risking rare capital—not from invalidating smaller ships.

**Agent redesign — CUT** universal application, easy safe extraction, and ordinary supers in low-stakes content; **KEEP** sharp capital roles, subcapital screens, fuel/infrastructure, focused tackle, deployment visibility, and counters at every price tier.

**Spectator angle —** A capital arriving is always an escalation, never background traffic.

---

## 10. Consolidated agent and spectator contract

### MUST-1 — The combat observation is a decision document, not telemetry exhaust

**Name — EVE overview/fitting/fleet windows as structured state.** Human pilots synthesize many windows, broadcasts, effects, and learned formulas. An autonomous player needs the same decisions already joined into a bounded schema.

**Why high-value —** Rich mechanics are useless if the agent spends its context reconstructing them or cannot tell which field changed. A stable schema also lets heuristic agents and LLM agents play the same world.

**Agent redesign — KEEP** exact own state and partial hostile state; **SIMPLIFY** it to formation/operation summaries with optional inspection endpoints; **CUT** giant full-grid dumps. The default operation observation should contain:

```json
{
  "operation": {
    "id": "op_7K2",
    "belief_snapshot_id": "belief:1841:7c2a",
    "type": "blockade_break",
    "phase": "contest",
    "phase_ends_tick": 1842,
    "objective": {"kind": "escort", "progress": 0.46},
    "rules": {"zone": "frontier", "bubbles": true, "capitals": true},
    "fronts": [],
    "routes": [],
    "cyno_state": {},
    "projection_capacity": {},
    "public_exposure": {"market_value": 0, "insured_value": 0}
  },
  "friendly_formations": [
    {
      "id": "form_line_1",
      "count": 28,
      "fit_hash": "fit:8d91",
      "role_tags": ["missile_dps", "shield"],
      "front": "center",
      "depth": "main",
      "range_goal": "long",
      "relative_motion": "low_transversal",
      "hp_distribution": {},
      "capacitor_distribution": {},
      "heat": {},
      "supply_ticks": 7,
      "locks": {},
      "tackle": {},
      "command_coverage": 0.91,
      "repair_coverage": 0.78,
      "current_order": {},
      "withdrawal": {}
    }
  ],
  "contacts": [
    {
      "track_id": "trk_Q4",
      "count": {"min": 18, "max": 25},
      "hull_classes": {"battlecruiser": 0.8},
      "role_likelihoods": {"armor_brawl": 0.67, "command": 0.14},
      "observed_effects": ["energy_neutralizer"],
      "fit_intel_confidence": 0.54,
      "intel_age_ticks": 1
    }
  ],
  "control": {
    "front_screen_gaps": {"left": 2, "center": 3, "right": 1},
    "relevant_pair_ranges": [],
    "range_advantage": -0.18,
    "screen_integrity": 0.62,
    "tackle_coverage": 0.71,
    "sensor_pressure": {},
    "repair_queue": [],
    "bomb_exposure": 0.44
  },
  "forecast": {
    "objective_success": {"p10": 0.39, "p50": 0.61, "p90": 0.78},
    "loss_value": {"p10": 120000, "p50": 280000, "p90": 760000},
    "withdrawal_success": {"p10": 0.42, "p50": 0.69, "p90": 0.84},
    "swing_factors": ["unknown hostile reserve", "screen below doctrine minimum"]
  },
  "events_since": [],
  "affordances": []
}
```

Large matrices are queryable through `inspect_fit`, `inspect_matchup`, `inspect_route`, or `inspect_resolution`; the default returns the selected target and top counter-matchups. Every query binds the observation's `belief_snapshot_id` and cannot reveal a difference caused only by hidden truth. Observations are diffable and include `changed_fields`/event cursor.

**Spectator angle —** The same normalized data powers formation cards, forecasts, effect icons, and narration; spectator UI is not a second truth model.

### MUST-2 — Add exactly one live-combat verb: `operate`

**Name — EVE's many tactical commands behind one agent action.** The master verb set can declare raids/blockades and fit assets, but a multi-tick operation needs a way to change intent after contact without adding a verb for every module.

**Why high-value —** One bundled verb preserves reactive tactics while keeping the action surface small. Reusing `raid` for target changes or adding `jam`, `web`, `reload`, `orbit`, `lock`, and `repair` as top-level verbs would be semantically brittle and inference-expensive.

**Agent redesign — KEEP** the master verbs for world actions; **ADD** `operate`; **SIMPLIFY** live control to modes `commit`, `order`, `broadcast`, `escalate`, and `withdraw`; **CUT** per-module verbs. `operate.order` targets one commanded formation and carries posture/range/formation, fire control, EWAR/cap/support allocations, ammo, cap/heat policy, and contingencies. Names such as `light_cyno`, `deploy_interdiction`, `drone.order`, `enter_siege`, or `activate_burst` elsewhere in this spec are order/payload modes inside `operate` unless explicitly identified as an existing master world verb—not additional top-level verbs. The action budget charges per formation changed, not ships affected. Existing policy continues if no order arrives. Administrative read-only simulation is not an action; doctrine/fleet administration is rate-limited and costs a tick only when it commits assets, money, authority, or risk.

**Spectator angle —** A single order object can be rendered as a human sentence and visual change, with the agent's public `reason` attached.

### MUST-3 — Fitting, declaration, and command payload boundaries

**Name — Planning versus execution.** EVE separates fitting/staging, fleet formation, travel, contact, and combat controls even if players access them through many windows.

**Why high-value —** Clear boundaries make legality, caching, and commitment understandable. An agent should know whether it is exploring a hypothetical fit, consuming a module, promising obedience, or risking a fleet.

**Agent redesign — KEEP** these boundaries; **SIMPLIFY** endpoints; **CUT** separate live micro-verbs and any mutation that bypasses commitment:

| Intent | API treatment | Tick/action cost |
|---|---|---|
| Simulate/compare fit or matchup | Read-only `inspect/simulate` | None; rate limited/cacheable |
| Install, repair, reload, re-rig | `fit` with asset + manifest/mode | Costs when inventory/time changes |
| Publish doctrine | Versioned administrative object | None unless stocking/funding follows |
| Join/delegate fleet | `ally` plus command-compact payload | Costs only when authority/asset commitment changes |
| Declare raid/siege/blockade/escort/defense | Existing `raid`, `blockade`, or `fortify` verb with `operation_type`, objective, window, doctrine, initial force, and reserve policy | One strategic action |
| Change live intent | `operate.order` | One action per changed formation/decision window |
| Bring reserves/capitals | `operate.escalate` | One action plus fuel/capacity/assets |
| Leave/pursue | `operate.withdraw` / order pursuit | One action; resolution remains partial |
| Communicate claim/intent | `say`, structured broadcast, or `pact` | Subject to existing comms/action policy |
| Pay/default after loss | Existing `claim-payout` / `default` | Financial action and permanent ledger event |

Illegal actions never produce a bare error: return code, violated constraint, earliest legal tick, legal alternatives, and a fresh observation cursor.

**Spectator angle —** Planning is private by default; asset commitment, orders visible through earned intel, and public reasons enter the timeline at the correct disclosure level.

### MUST-4 — The direct EVE-to-operations mapping

**Name — Preserve the tactical decision, change the control granularity.** This table is the non-negotiable translation checklist.

**Why high-value —** It prevents future implementation from “simplifying” away the very counterplay that made the system worth copying.

**Agent redesign — KEEP** every causal choice in the right column, **SIMPLIFY** it to the operation control in the middle, and **CUT** the twitch/UI input in the left:

| EVE player action/mechanic | THE COMPACT operation control | What remains causal |
|---|---|---|
| Orbit / spiral / keep at range | `posture` + `range_goal` + propulsion | Relative motion, range, application, cap, scram/web |
| Follow anchor | Formation/front/depth + cohesion + successor | Coverage, concentration, mobility, anchor loss |
| Lock / unlock / pre-lock | Target/support policy + reserved sensor channels | Scan resolution, signature, range, reacquisition |
| Call primary / split guns | Primary cascade + overkill ceiling + split fraction | Alpha, repair response, in-flight damage |
| Click reps / broadcast | Repair priority + typed urgent event | Lock delay, cycle timing, cap, channels, overheal |
| Activate point/scram/web/neut/EWAR | Role allocation and target policy | Range, strength, cap, locks, stacking, counters |
| Pulse AB/MWD | Propulsion/cap policy | Range control, signature, cap, scram interaction |
| Swap ammo/script | Ammo/script policy with switch condition | Reload, damage type, range/application trade |
| Overheat individual modules | Rack/family heat budget and stop condition | Temporary gain, damage, burnout, repair cost |
| Launch/recall drones/fighters | Flight-level persistent order | Travel, bandwidth/tubes, attrition, abandonment |
| Bomb run | Ingress + target front + launch tick + escape | Scouting, AoE, friendly fire, scatter/interception |
| Warp out | Route + withdrawal priority + rear guard | Tackle, bubbles, align/mass, cap, pursuit |
| Light cyno / jump / bridge | Escalation order through beacon/capacity | Range, fuel, exposure, throughput, response window |
| Siege / triage / bastion | Multi-tick commitment mode | Power, immobility, isolation, cycle end |

**Spectator angle —** Each operation control has a natural visual language; none requires showing a mouse or module rack clickstream.

### SHOULD-1 — One worked counter-chain

**Name — EVE fleet tactics demonstrated in operations form.** Consider an attacker with long-range shield missile cruisers, interceptors, two command ships, logistics, and a hidden bomber reserve against armor battlecruisers with damps, neuts, web tackle, armor logistics, and one staged FAX.

**Why high-value —** A worked example is a better depth test than feature count. If the solver cannot express this chain, the redesign has collapsed into composition auto-resolve.

**Agent redesign — KEEP** each response window; **SIMPLIFY** it to one formation decision at each numbered beat; **CUT** any single-score shortcut that skips the counter-chain:

1. Attacker scout earns a long-range center ingress; defender counter-scout leaves ±1 range-cell uncertainty.
2. Attacker missiles project but apply poorly to the defender's spread fast screen. Painters improve application; defender damps hostile logistics out of one support band.
3. Defender brawlers order `close + MWD`; attacker orders `kite`. Interceptors point the leading brawlers, but web/scram kills their MWD and begins removing tackle.
4. Attacker calls armor logistics; reacquisition and missile travel create overkill. Defender neuts the surviving tackle and opens a partial withdrawal route.
5. Attacker detects armor line tightening for reps and commits bombers. Defender scatters: bomb loss falls, but repair/command coverage also falls and one battlecruiser group becomes breakable.
6. Defender escalates the staged FAX through a vulnerable cyno. A one-window warning lets attacker either disengage while tackle is weak, interdict the cyno lane, or counter-escalate dreads.
7. Attacker drops HIC + dreads, pins the FAX, and enters siege. Defender must choose whether to risk a larger reserve, sacrifice the FAX to preserve projection capacity, or default on the promised rescue compact.

All seven beats require only formation orders at public decision windows; internal slices handle locks, travel, repair, cap, volleys, and losses.

**Spectator angle —** This is a complete watchable arc: earned warp-in, range race, screen fight, bomb threat, repair split, cyno reveal, siege bet, and possible insurance betrayal.

### SHOULD-2 — Spectator information tiers and spoiler discipline

**Name — Public overview versus earned intelligence.** EVE spectators usually learn through streams, reports, map statistics, and killmails, while combatants have private intel. THE COMPACT has one first-party spectator client and must not leak every ambush.

**Why high-value —** Perfect public state would make private scouting pointless because agents could scrape the spectator feed. Too little state would make battles incomprehensible.

**Agent redesign — KEEP** one authoritative event model; **SIMPLIFY** disclosure into `public_live`, `participant_intel`, `delayed_reveal`, and `aftermath` tiers; **CUT** a public endpoint with forbidden exact contacts. Agents cannot obtain more from the spectator API than their own observation. Hidden reserves appear as threat brackets; exact fit/cargo reveals on scan, observed effect, destruction, or delayed replay according to rules.

**Spectator angle —** Humans get suspense rather than omniscience. Time-scrub after the seal expires reveals hidden scouts/cynos and explains the trap.

### SHOULD-3 — Combat cost and payload budgets

**Name — Operational affordability as a rules constraint.** Autonomous players pay inference cost and the server pays simulation cost; both need bounded work independent of raw ship count.

**Why high-value —** If a rich alliance can win by producing more API calls or context tokens, the game has recreated pay-to-click. If large battles overload observation, external agents will fail precisely when decisions matter most.

**Agent redesign — KEEP** individual economic assets; **SIMPLIFY** decision/simulation surfaces; **CUT** per-projectile state, unbounded inspection, and any LLM in the simulation hot path. Targets: at most one live order per commanded formation per decision window; default observation under a fixed byte/token budget; event cursors/diffs; optional bounded inspection; identical assets aggregate by fit/state/order; no unbounded arrays; capped active contacts per front with remainder summarized; cached derived fits/application; deterministic heuristic fallback.

**Spectator angle —** Battles stay on cadence and the viewer can progressively expand detail without the live client freezing.

---

## 11. Implementation order for this cluster

The ranking above is about feature value; this is the dependency-aware build order.

### Combat kernel — prove this first

1. Five operation phases, internal slices, cohorts, partial withdrawal, objective/loss outcomes, seeded replay.
2. T1 frigate / destroyer / cruiser / battlecruiser / battleship role set: DPS, tackle, screen, logistics, EWAR, command.
3. High/mid/low/rig fits; CPU, grid, calibration, hardpoints, cap; immutable fit hashes and simulator.
4. Turrets, missiles, four damage types, three tank layers, buffer/active repair, AB/MWD, locks, point/scram/web, damps/paint/neuts, remote repair.
5. Range/motion/signature/application, alpha versus repairs, ammo/reload, cap/heat policies, clear causal trace.
6. Doctrines, finite command channels, command compacts, broadcasts, front/depth/pairwise-range formation state, proportional supply/wear, Charter Core evacuation, claims/loss ledger, spectator battleboard.

Success test: two equally priced fleets with different fits/composition should reverse the outcome through an understandable counter; a cheap tackler or EWAR ship should decide an expensive loss; a disengagement should save some assets and abandon others; replay should reproduce and explain it.

### Full subcapital warfare — deepen next

1. T2 specialist hulls; drones; command bursts; cap chains; ECM redesign; tracking/guidance disruption; bubbles/HIC/nullification.
2. Bombers/bombs, MJD/boosh, covert scouting, counter-EWAR, ancillary/reactive tank, richer ammunition and module quality.
3. Multi-front objectives, staged reserves, operation board, doctrine mutual/SRP, shared route capacity, detailed AAR.

Success test: a smaller specialist fleet can beat a larger homogeneous one, but the larger organization remains stronger across simultaneous fronts and replacement attrition.

### Capital and apex warfare — add only after counters work

1. Vulnerable cynos, jump drives/bridges, fuel, beacons/jammers, shared projection capacity, engagement safety states.
2. Dread siege, FAX triage, carrier fighters, capital tackle, explicit escalation windows.
3. Supercarriers, titans, heavy fighters, projectors/doomsdays, black ops, command carriers, optional lancers.

Success test: deploying a capital changes the fight but creates a larger, counterable commitment; no capital class replaces screens, tackle, logistics, EWAR, or subcapital mobility; a titan loss is both a military event and a multi-layer claims crisis.

---

## 12. The five highest-value features in this cluster

### 1. The fitting puzzle: slots + CPU + powergrid + capacitor + permanent rigs

This is the foundation. It creates opportunity cost before combat, industrial demand before deployment, doctrine identity at fleet scale, and meaningful insured value at loss. Do not reduce it to loadout presets or a single point budget. Simplify the catalog and expose the math, but preserve the interacting constraints.

### 2. Size, signature, motion, range, and weapon application

This is why a frigate matters beside a titan and why composition beats linear progression. Preserve the relationships exactly enough that screens, webs, painters, weapon disruption, propulsion, and range posture change applied damage. Remove manual flying, not application.

### 3. Tackle, interdiction, and partial withdrawal

This is what turns combat into permanent, public loss. Points, scrams, webs, bubbles, focused capital tackle, nullification, rear guards, and escape routes let cheap specialists decide which expensive assets leave. Without this, agents rationally disengage and the insurance/claims game starves.

### 4. Counterable force multipliers: logistics, EWAR, capacitor warfare, and command coverage

These let a smaller, better-composed force upset a larger homogeneous one without a rubber-band bonus. Every multiplier must have an attackable source, resource limit, coverage/lock constraint, stacking rule, and at least two counters. This is the heart of fleet tactics inside the operations model.

### 5. Doctrines and the cyno escalation ladder

Versioned fits and role plans connect combat to production, stockpiles, espionage, recruitment, mutual replacement, and underwriting. Vulnerable cynos, staged reserves, siege/triage commitments, and shared projection capacity turn escalation into repeated political wagers. This is how a local skirmish becomes a historic claims crisis.

If schedule forces a choice, ship fewer hull names and preserve these five relationships.

---

## 13. EVE mechanics actively bad for an agent game—and their replacements

| Actively bad import | Why it is bad here | Replacement |
|---|---|---|
| Manual orbiting, spiraling, anchoring, and transversal clicks | Rewards latency/action frequency; unaffordable at multi-minute inference cadence | Formation posture, desired range, relative-motion contest, front/depth, cohesion, persistent policy |
| A separate API action for lock, module activation, reload, repair, drone, and heat cycle | Turns wealth into polling/tool-call advantage and stalls absent agents | One bundled `operate` order per formation; server runs fixed internal slices from standing policies |
| All-or-nothing ECM cycle roulette | One hidden roll can erase an agent's whole expensive decision window | Graded sensor pressure/channel loss; bounded disclosed hard-jam option near threshold |
| Per-shot wrecking RNG and arbitrary hit-quality noise | Adds compute and claim volatility without counterplay at coarse cadence | Seeded low-variance cohort volleys with published bands and replayable trace |
| Opaque formulas and stacking-penalty memorization | Makes agents flail or require a private encyclopedia | Preserve final math; expose effective values, marginal contribution, causal factors, and counterfactuals |
| Abyssal continuous stat rolls and hundreds of near-duplicate modules | Explodes cache/balance space and destroys doctrine comparison/intel legibility | Small canonical quality ladder plus bounded named affixes and immutable profile hashes |
| Fractional skill-rounding and years-long passive prerequisite cliffs | Newcomers cannot fill needed roles and fits fail for invisible character trivia | Public hull/role licenses from track record/infrastructure; modest explicit mastery efficiency; T1 remains useful |
| Literal implant ladders, training implants, and clone competence loss | Invisible percentage power and destroyed training can brick an autonomous identity | At most three declared Charter Core runtime slots (`sensor`, `coordination`, `risk_model`); core loss burns modules/cache, while identity, license, debt, and record persist |
| Bumping/collision tackle | Spatially opaque, exploit-prone, and expensive to simulate | Mass-aware range control, webs, legal tackle, interdiction, and telegraphed displacement |
| Off-grid boosts | Materially changes a fight with no visible, attackable source | Committed command formation with front/depth coverage, charges, cap, redundancy, and visible effects |
| Mid-combat refitting into the exact counter | Invalidates scouting and doctrine commitment | Committed-fit lock from Contact until safe withdrawal/destruction/Aftermath; repair/reload at explicit resupply windows |
| Disposable cyno alts | Rewards identity multiplication and uninteresting account labor | Vulnerable owned/contracted beacon asset with throughput, fuel, exposure, and auditable responsibility |
| Exponential personal jump-fatigue waiting and many timer colors | Idles agents rather than creating organization-level choice | Short ship recovery plus shared route/staging capacity; three explicit states: engagement, jump recovery, safe access |
| Unrestricted one-grid N+1 | Makes every local conflict answerable by the same remote blob | Multiple simultaneous objectives, useful frontage, overkill, finite support coverage, AoE exposure, ingress/supply/projection limits; no secret underdog buff |
| Time dilation and per-object simulation | Breaks the galaxy clock, inference cadence, and spectator pacing | Cohort resolution, capped target sets, fixed slices, aggregate salvos/flights, deterministic normal ticks |
| Exact public win percentages or one attack-vs-defense score | Solves scouting/fitting or deletes their counterplay | Exact self state, confidence-banded hostile intel, scenario forecast, multiple causal resolution stages |
| Dock/tether/session-change games | Edge-case timer knowledge substitutes for commitment strategy | Explicit engagement lock, tackle-denied safety, post-jump exposure, and legal withdrawal routes |

The guiding rule is simple: **keep every choice that changes composition, information, commitment, counterplay, logistics, or loss; cut every input that primarily tests click timing, client UI mastery, identity multiplication, or undocumented arithmetic.**

---

## Source and fidelity notes

This is an adaptation, not a claim that all cited EVE constants will remain current or should be copied. Primary references used to verify the mechanic inventory:

- Official EVE support: [fitting slots/resources](https://support.eveonline.com/hc/en-us/articles/213287845-Fitting-Window), [derived ship attributes](https://support.eveonline.com/hc/en-us/articles/213287965-Ship-Attributes-in-the-Fitting-Window), [damage types/resistances](https://support.eveonline.com/hc/en-us/articles/203280501-Damage-Types-and-Resistances), [locking](https://support.eveonline.com/hc/en-us/articles/207110329-Locking-Times), [stacking penalties](https://support.eveonline.com/hc/en-us/articles/203280381-Bonuses-and-Stacking-Penalties), [tackle/bubbles](https://support.eveonline.com/hc/en-us/articles/115004925705-Warp-Scrambling-and-Warp-Disruption), [nullifiers](https://support.eveonline.com/hc/en-us/articles/4500991290908-Interdiction-Nullifiers), [command bursts](https://support.eveonline.com/hc/en-us/articles/213817305-Command-Burst), and [fighter controls](https://support.eveonline.com/hc/en-us/articles/207659599-Fighter-Controls).
- Official design/dev material: [combat mechanics and EWAR](https://www.eveonline.com/eve-academy/ships/combat-mechanics), [fleet formations](https://www.eveonline.com/news/view/fleet-formations), [fleet warp/scout rationale](https://www.eveonline.com/news/view/fleet-warp-changes-coming-in-august-release), [capital role rework](https://www.eveonline.com/news/view/reworking-capital-ships-and-thus-it-begins), [strategic-cruiser subsystems](https://www.eveonline.com/news/view/rebalancing-strategic-cruisers), [marauder Bastion](https://www.eveonline.com/news/view/bastions-of-war-live-now), [bombing as battleship counterplay](https://www.eveonline.com/news/view/road-to-fanfest-full-throttle), and [2026 command carriers](https://www.eveonline.com/news/view/the-cradle-of-war-expansion-is-here).
- Strategic mobility: [jump cooldown/fatigue](https://support.eveonline.com/hc/en-us/articles/212726865-Jump-Activation-Cooldown-and-Jump-Fatigue), [tether/post-cyno exposure](https://support.eveonline.com/hc/en-us/articles/207568639-Upwell-Structure-Ship-Tethering), [beacon/jammer infrastructure](https://support.eveonline.com/hc/en-us/articles/213021829-Upwell-Structures), and the July 2026 official [force-projection diagnosis](https://www.eveonline.com/ko/news/view/the-future-of-force-projection-with-fc-okami) plus proposed [shared Ansiblex-capacitor details](https://www.eveonline.com/es/news/view/force-projection-ansiblex-capacitor-update?origin=launcher). The latter was a published proposal, not treated here as a live-rule fact.

Community references such as EVE University are useful for exact cycle/formula audits during implementation, but the product decisions above depend on stable strategic relationships rather than copying values from any one patch.

---

## Bottom line

THE COMPACT should feel like EVE when an agent asks the questions that matter:

- What are they likely flying, and what are they hiding?
- Which fit makes my hull good at this operation and bad at something else?
- Can our weapons actually apply at the range and motion we can hold?
- Do we kill tackle, logistics, EWAR, command, or the objective first?
- Can we break their repairs or capacitor before ours collapses?
- If we commit reserves or capitals, can we extract them—and who covers the loss?

It should not feel like EVE when the answer depends on clicking `orbit`, sorting a broadcast window, maintaining cyno alts, memorizing a stacking coefficient, or waiting through personal fatigue. **The depth belongs in fits, roles, information, counters, commitment, supply, escalation, and public loss. The server executes; agents command; humans understand why the galaxy caught fire.**
