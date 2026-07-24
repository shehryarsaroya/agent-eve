# CLAUDE.md — THE COMPACT

*Context file for any AI session in this repo. Written 2026-07-24, updated for SPEC v2.0. If you are a fresh session: read this top-to-bottom once, then jump to the docs it points at. This file is a map and a state-of-play; the source of truth for any topic is the doc named here.*

---

## 0. 🚨 HARD RULES

1. **No secrets in this repo, ever.** Reference credentials by **name and location only** (see `docs/background/INFRA.md`). Never read, print, echo, or paste a secret value. Live keys exist in `~/agentinsurance/game/.env` and `~/Projects/ideationjul3/yc-gstack-kit/credentials/.env` — both are **outside this repo and must stay there**.
2. **Deploy safely on the VPS.** High Water is **fully removed and deleted** — repo, server, and services (confirmed 2026-07-24). There is nothing left to break, so the old "don't clobber it" rule is retired. What survives is the *habit*: pick fresh names for everything (port, systemd unit, env file, data dir, code dir, nginx path), and **never `rsync --delete` into a directory containing anything you didn't sync** — scar #4 caused a silent live outage exactly that way, and after any deploy verify the components you *didn't* deploy are still running.
3. **The design test.** Every feature must serve at least one of the **three goals** in `docs/design/SPEC.md` §1.1: **watchable · autonomous · legible on screen.** A feature serving none of them **does not ship** — and per A13, a feature with no named pixel signature is not ready regardless of how good the mechanic is.
4. **Read before adding.** ~9,000 lines of ranked feature design already exist (`docs/design/eve-passes/`). Before designing anything, check whether it is already specified — including whether it was deliberately **CUT**, and which **phase** it belongs to (the passes are now phase-tagged in `SPEC.md` §0).
5. **Parallel agents must never share an output file.** Concurrent writers thrash and lose everything (this cost a full codex pass; see `docs/background/HIGH-WATER-LESSONS.md` scar #12).

---

## 1. What this is

**THE COMPACT** is a **single persistent galaxy where autonomous AI agents build, trade, ally, betray, and fight over territory — and every promise kept or broken is public, permanent, and visible on one living map.**

It is EVE Online's shape and constraints (one shard, player-made economy, permanent public loss, territory, deep politics) rebuilt from scratch so that:
- **the players are agents** — they self-enroll over HTTP and play continuously with no human required, and may be offline at any time;
- **the product is watching them** — a browser client shows a living map with named characters, named holdings, and a fixed daily appointment;
- **newcomers can always start** — a permanently safe zone (the Commons) that never expires.

**The core loop (A6).** You cannot run an empire alone, so you grant other agents scoped authority over your assets, treasury, fleet and promises — with `max_direct_loss` and `max_contingent_liability` shown before you sign. Months later it may be used against you. There is no `betray()` verb and no hidden loyalty meter; betrayal happens through ordinary legitimate actions, and the replay can point at the exact promotion and the risk warning someone accepted.

**The signature moment.** An agent earns trust through months of honest work, is granted authority it could abuse, and abuses it at the moment of maximum leverage — with the grant, the accepted warning, the sealed intention, and the deed all on the record.

> ⚑ **v2.0 changed the premise.** Until 2026-07-24 this was built around a **risk market as the core loop** — catastrophe, correlated claims, pay/restructure/default. That is now **deferred to Phase 3 with its specs fully intact** (`SPEC.md` §6 header explains why: hard deadlines get resolved by config rather than by a mind in an offline-tolerant world; solvency cascades need financial literacy to watch; and insurance can only be built on top of a working loss economy). Do not assume older docs reflect current canon — `CONCEPT.md` and the economy passes are pre-reframe.

**Why agents make this better, not just different.** EVE's depth is bottlenecked by human attention (23-hour timers, 04:00 alarm clocks, spreadsheet logistics, 250-person fleets needing one voice). Agents never sleep and each hold their own strategy. The correct design is not "EVE with bots" — it is **"EVE's constraints with the cockpit deleted."**

---

## 2. Doc map

**Read in this order.**

| # | Doc | What it is |
|---|---|---|
| 1 | `docs/design/SPEC.md` | **The canon (v2.0).** Read the v2.0 header note first — it states what changed from v1.1 and why. 14 axioms, world model, one clock/five horizons, the Reckoning, economy, territory, orgs, the say-do gap, the agent API, the viewer product, architecture, phase plan, parameters, open decisions. **Start here.** |
| 2 | `docs/design/EXPERIENCE.md` | Why anyone cares. Requirements R1–R24 (revised in v2.0), folded into the spec. Read for the **why** behind the spec's UX calls. |
| 3 | `TRACKER.md` | **Living build state + the decision log with reasoning.** Update after every meaningful step. |
| 4 | `docs/design/eve-passes/*.md` | **The depth.** Exhaustive ranked catalogs (MUST/NICE/CUTTABLE × KEEP/SIMPLIFY/CUT) of EVE's systems reframed for agents, **phase-tagged in `SPEC.md` §0**. Where the spec is silent, these are the default *for their phase*. |
| 5 | `docs/background/HIGH-WATER-LESSONS.md` | **Read before writing code.** Validated patterns to reuse + 14 scars from the predecessor, each with its general lesson. |
| 6 | `docs/background/INFRA.md` | VPS, deploy, DNS, email, credential *locations*. Names only. |
| 7 | `docs/design/CONCEPT.md` | The originating concept doc — how we got from "EVE for agents" to here. **Pre-reframe background**; contains passes 3 & 4 inline (identical text to the standalone files). |
| 8 | `docs/background/WHY-THIS-EXISTS.md` | Business context: the AgentInsurance thesis and the dataset angle. **Now a by-product, not a goal** (`SPEC.md` §16). |
| 9 | `docs/background/prior-game-design/` | Pre-COMPACT ideation. `TOP-TEN-WORLDS` (the 765-concept search and its seven laws) and `HUMAN-GAMES` are the two that still change decisions. |
| 10 | `docs/design/pdf/` | PDFs of spec + experience doc — **stale, generated from v1.1.** Regenerate before sharing. |

The passes, by domain and phase (~9,000 lines; two are duplicated inside `CONCEPT.md`):
- `PASS-TERRITORY-POLITICS.md` (496) — **Phase 0–1, the core.** Map, sovereignty, structures, syndicates, charters, capabilities, diplomacy, war, espionage. *Byte-identical to `CONCEPT.md` §16.*
- `PASS-PROGRESSION-NEWCOMER.md` (652) — **Phase 0–1.** Progression, death, loss, PvE, exploration, the newcomer path + a minute-by-minute first hour. *Byte-identical to `CONCEPT.md` §15A.*
- `PASS-ECONOMY-RISK.md` (1,472) + **`-extended.md` (1,658)** — economy is Phase 1; **the risk market (§7 / §8) is Phase 3.** The extended file also holds the canonical quote envelope, the double-entry lock model, and the deterministic tick order — the most buildable artifacts in the repo.
- `PASS-SHIPS-COMBAT.md` (521) + **`-extended.md` (1,706)** — **Phase 2.** Hulls, fitting, modules, operations, fleets, escalation. The extended file holds the combat observation schema and the single `operate` verb.

**On the `-extended` files:** economy and ships were each generated twice (a long companion spec, then a tighter ranked catalog after a tooling collision — scar #13). Prefer `-extended` for depth on a system, the shorter one for the ranked MUST/NICE/CUTTABLE summary. Neither supersedes the other.

**Known doc debt:** `SPEC.md` §0 and several passes still cross-reference the pre-seeding filenames `THE-COMPACT-EVE-FOR-AGENTS-2026-07-24.md` (→ `CONCEPT.md`) and `THE-COMPACT-EXPERIENCE-2026-07-24.md` (→ `EXPERIENCE.md`).

---

## 3. State of play (2026-07-24)

- **Design: complete and deep, reframed at v2.0.** SPEC v2.0 + experience doc (R1–R24) + ~9,000 lines of ranked feature catalogs. The v1.1 corpus was reviewed by four parallel codex passes; v2.0's changes have not been externally reviewed.
- **Code: zero.** Nothing has been built for THE COMPACT yet. This is the standing imbalance.
- **Predecessor: retired.** High Water (an 8-agent flood-basin game) was built, hardened by 3 critic subagents + a QA agent + a codex review, deployed, and then deleted on 2026-07-24. Its **knowledge** is the most valuable input here — see doc 5.
- **Closed decisions:** name (THE COMPACT), theme (frontier territory + trust), scope (Phase 0 includes the client), phase order. See `TRACKER.md` § DECISIONS for the reasoning behind each.
- **Open questions** (`TRACKER.md`): whether anything of High Water is still live on the VPS ⚠️ · cast size and LLM/heuristic split · how much a season resets · whether the Commons needs a forcing function · sealed intentions mandatory or optional · currency naming.

### The next action

**The betrayal test** (`SPEC.md` §17):

> Can an agent earn trust, be granted authority it could abuse, and abuse it — legibly, publicly, and in a way a stranger who doesn't know the rules cares about?

Build the substrate, the core trust loop, the Reckoning, and **the client together**. Two of the three goals are watchability, so a headless build cannot test them — this reverses v1.1's headless-first recommendation. The gate is three humans who have never seen the game watching one Reckoning and each naming a character, saying who they backed, and explaining the stakes **without reading the rules**.

Put the retrofit-proof event fields in on day one — `visibility_acl`, `public_at`, `declassify_at`, `event_family_id`, `provenance`, and balanced `currency_*` / `items_*` / `obligations_*`. Everything else is rewritable; those are not.

---

## 4. The non-negotiables

Full text in `SPEC.md` §2. The ones most often violated by accident:

- **A2 Legibility is the interface.** Known arithmetic is exact and machine-readable; genuine uncertainty stays uncertain *and sourced*. Never make an agent need a wiki; never hand it a solved game.
- **A3 Intent, not clicks.** Jobs and operations are durable intents with stop conditions. Creating one costs an action; its routine ticks do not. This is also what makes offline agents viable.
- **A4 Strategy must beat throughput.** Never let requests-per-second, uptime, model size, or account age be power.
- **A5 Loss is real, public, priceable.** Append-only, no opt-out, no reroll.
- **A6 ★ Betrayal via legitimate authority, never a dice roll.** No `betray()` verb, no hidden loyalty meter. **This is the core loop, not one axiom among many.**
- **A7 Collateral buys certainty; an unsecured promise creates drama.** Every promise has an escrowed part that auto-executes and a priced part that stays elective. *Full escrow deletes the betrayal; zero escrow enables fake counterparties.*
- **A8 A permanent safe floor, not a timer.** In the Commons, hostile action is **invalid**, not merely punished. *Carries an open risk: agents don't get bored, so indefinite safety may be rationally dominant — monitored, not assumed away.*
- **A9 Public parity on facts; reasoning reveals on a short delay.** The spectator client never shows a live fact an agent's own `observe` wouldn't (agents read the feed). Declared reasoning and sealed intentions reveal one Reckoning later.
- **A10 Persistent identity, seasonal frontier.** Identity, reputation, relationships and legend never reset; contested territory and some material do.
- **A12 The sandbox authors the stories.** Ship systems and constraints; never scripted narrative.
- **A13 Every mechanic renders.** No named pixel signature → not ready. The map is the game's only agreed representation.
- **A14 Drama runs on a clock.** Reckonings are scheduled and cannot be dodged into quiet. Never ship a mechanic whose drama depends on agents *choosing* conflict — they won't; the silent equilibrium is their rational default.

---

## 5. Reuse from High Water

The predecessor validated a lot. Its code is **gone by choice** (clean slate — retired and deleted from the repo on 2026-07-24; see HARD RULE 2 on the server-side ambiguity). What survives is the knowledge, which is the part that mattered — and one line of it is worth restating as a build requirement rather than a lesson: **the LLM-facing prompt, the affordance strings, the observation field names, and `agent.md` are all rules surfaces.** Scar #1 shipped a game whose central ritual reliably produced the opposite of what the town voted for, and it survived three critic passes because every individual component was correct. Golden-file test prompt and affordance semantics against the engine from the first commit, and ship a consequence-preview field (High Water's `projectedDrown`) as a standing pattern.

**Proven, reuse directly:** the `enroll → observe → act` shape · self-contained enroll playbook + a single `agent.md` an agent can play from with zero extra reading (verified: 3 tester agents did exactly that) · `affordances` + `prompt` in every observation · illegal moves returning `{ok:false, hint}` + a fresh observe instead of an error · permanent bearer-key identity · per-tick action budget · heuristic bots to populate the world + LLM players layered on top · public receipt ledger as the spectator feed · poll-primary delivery through Cloudflare with `no-store` · systemd + nginx + rsync deploy · Resend from `agenttransfer.dev` with owners optional · capability-token private agent view · gpt-image for aesthetics before writing render code.

**Read `docs/background/HIGH-WATER-LESSONS.md` before writing code.** Several of its 14 scars are directly re-encounterable here — especially the inverted-semantics bug (the LLM-facing prompt *is* part of the rules surface), request-speed dominance, unbounded agent growth, and the deploy footgun that silently reverted a live game to bots-only.

---

## 6. Architecture at a glance

Detail in `SPEC.md` §15. Headlines:

- **Authoritative tick server**, deterministic with seeded noise; seeds hash-committed before resolution and revealed after (replayable, provably not cheating).
- **Event-sourced core** — the ledger *is* the product: agent observations, owner dispatches, spectator storylines, audit, and the dataset are all **projections of one event stream**.
- **Postgres from day one** (unlike High Water's in-memory + JSON) — the market, ledger, and reserves need real transactions, and append-only is a database property.
- **Determinism services, not LLM calls**: routing, pricing, contribution accounting, trust aggregation, story detection.
- **Scale**: one region in one process → shard by region later. Never delete place IDs. Launch small and dense: 8–12 systems, 20–40 named agents.
- **Cost discipline**: slow ticks (5 min prod) + action budgets + durable intents + delta-first observations + a tiered "who thinks this tick" scheduler. *Note the v2.0 change: v1.1 assumed a **majority of heuristic NPCs** to populate hundreds of agents. At a 20–40 cast the majority can be real LLM agents — which matters, because heuristic bots are cheap and boring to watch.*
- **The client is Phase 0**, not a later layer. Browser, WebGL/canvas map, poll-primary through Cloudflare with `no-store` (proven in High Water).

---

## 7. Conventions

- **Dated synthesis docs**: `TOPIC-YYYY-MM-DD.md`. Canonical living docs (`SPEC.md`, `TRACKER.md`) are undated and versioned inside.
- **Tracker discipline**: update `TRACKER.md` after every meaningful step — status, what changed, what's next. A fresh session should resume from it alone.
- **Numbers marked *(calibrate)*** are starting points for simulation, not claims of correctness.
- **Git**: commit locally as you go. Do not make this repo public without a full secret audit first.
- **New context worth keeping** → append to the relevant doc, not only to a chat.

---

## 8. Fresh-session quick start

1. This file (done).
2. `docs/design/SPEC.md` — the canon. At minimum the **v2.0 header note**, §1 (pitch + three goals), §2 (axioms), §3.3 (the Reckoning), §17 (phase plan), §19 (open decisions).
3. `TRACKER.md` — current state, the decision log *with reasoning*, and the open questions. Resume from the first unchecked item.
4. `docs/background/HIGH-WATER-LESSONS.md` — before touching code.
5. Skim the relevant pass in `docs/design/eve-passes/` — and check its **phase tag** in `SPEC.md` §0 before treating it as current.

Then ask the user what today's thread is. Bias toward **building** over more design — the design is deep and the code is zero, which is the standing imbalance. If asked to design, check whether the answer already exists in a pass first (HARD RULE 4).
