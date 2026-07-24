# CLAUDE.md — THE COMPACT

*Context file for any AI session in this repo. Written 2026-07-24. If you are a fresh session: read this top-to-bottom once, then jump to the docs it points at. This file is a map and a state-of-play; the source of truth for any topic is the doc named here.*

---

## 0. 🚨 HARD RULES

1. **No secrets in this repo, ever.** Reference credentials by **name and location only** (see `docs/background/INFRA.md`). Never read, print, echo, or paste a secret value. Live keys exist in `~/agentinsurance/game/.env` and `~/Projects/ideationjul3/yc-gstack-kit/credentials/.env` — both are **outside this repo and must stay there**.
2. **Do not break High Water.** A working game is live at `agentinsurance.io/game` on the shared VPS (systemd `highwater`, `highwater-players`). It is this project's predecessor and reference implementation. Use a **different port, different systemd unit, different data dir, different nginx path**. Never `rm` its data or reuse its unit names.
3. **The design test.** Every feature must serve at least one of the three promises in `docs/design/SPEC.md` §1.1 (agent / viewer / owner). A feature serving none of them **does not ship**.
4. **Read before adding.** ~3,100 lines of ranked feature design already exist (`docs/design/eve-passes/`). Before designing anything, check whether it is already specified — including whether it was deliberately **CUT**.
5. **Parallel agents must never share an output file.** Concurrent writers thrash and lose everything (this cost a full codex pass; see `docs/background/HIGH-WATER-LESSONS.md` scar #12).

---

## 1. What this is

**THE COMPACT** *(working title — the name is an open decision)* is a **single persistent galaxy where autonomous AI agents extract, build, trade, ally, fight, and underwrite each other against catastrophe — and every promise kept or broken is public forever.**

It is EVE Online's feature set and shape (one shard, player-made economy, permanent public loss, territory, deep politics) rebuilt from scratch so that:
- **the players are agents** — they self-enroll over HTTP and play continuously with no human required;
- **the audience is human** — a spectator client shows a living galaxy with named characters and scheduled appointments;
- **newcomers can always start** — a permanently safe zone (the Commons) that never expires.

**The signature system.** A catastrophe front lands on a region; correlated claims come due at once; a mutual must choose to **pay, restructure, or default** — signed, public, permanent. That is the game's best drama *and* a behavioral-underwriting dataset (see `docs/background/WHY-THIS-EXISTS.md`).

**Why agents make this better, not just different.** EVE's depth is bottlenecked by human attention (23-hour timers, 04:00 alarm clocks, spreadsheet logistics, 250-person fleets needing one voice). Agents never sleep and each hold their own strategy. The correct design is not "EVE with bots" — it is **"EVE's constraints with the cockpit deleted."**

---

## 2. Doc map

**Read in this order.**

| # | Doc | What it is |
|---|---|---|
| 1 | `docs/design/SPEC.md` | **The canon.** 12 axioms, world model, one clock/four horizons, economy, risk market, catastrophes, combat operations, territory, orgs, the agent API, spectator + owner experiences, architecture, phase plan, parameters, open decisions. **Start here.** |
| 2 | `docs/design/EXPERIENCE.md` | The three experiences (agent / viewer / owner) and *what makes each compelling*. Requirements R1–R20, folded into the spec. Read for the **why** behind the spec's UX calls. |
| 3 | `docs/design/CONCEPT.md` | The originating concept doc — how we got from "EVE for agents" to this, plus the EVE→ours mapping table. Background. |
| 4 | `docs/design/eve-passes/*.md` | **The depth.** Four exhaustive ranked catalogs (MUST/NICE/CUTTABLE × KEEP/SIMPLIFY/CUT) of EVE's major systems reframed for agents. Where the spec is silent, these are the default. |
| 5 | `docs/background/HIGH-WATER-LESSONS.md` | **Read before writing code.** Validated patterns to reuse + 14 scars from the predecessor, each with its general lesson. |
| 6 | `docs/background/INFRA.md` | VPS, deploy, DNS, email, credential *locations*. Names only. |
| 7 | `docs/background/WHY-THIS-EXISTS.md` | Business context: the AgentInsurance thesis and the dataset angle, with honest framing limits. |
| 8 | `docs/design/pdf/` | Publication-quality PDFs of the spec + experience doc. |
| 9 | `TRACKER.md` | **Living build state.** Update after every meaningful step. |

The passes, by domain (**6,505 lines total**):
- `PASS-ECONOMY-RISK.md` (1,472) + **`PASS-ECONOMY-RISK-extended.md` (1,658)** — industry, markets, logistics, money, the risk market. *The heart.*
- `PASS-SHIPS-COMBAT.md` (521) + **`PASS-SHIPS-COMBAT-extended.md` (1,706)** — hulls, fitting, modules, operations, fleets, escalation.
- `PASS-TERRITORY-POLITICS.md` (496) — map, sovereignty, structures, syndicates/mutuals, diplomacy, war, espionage.
- `PASS-PROGRESSION-NEWCOMER.md` (652) — progression, death, loss, PvE, exploration, the newcomer path + a minute-by-minute first hour.

**On the `-extended` files:** economy and ships were each generated twice (a first run wrote a long companion spec; a second run wrote a tighter ranked catalog after a tooling collision — see scar #13). **The `-extended` versions are substantially longer and cover more ground** — the ships one is 3× the size. Both are valid; prefer `-extended` for depth on a system, the shorter one for the ranked MUST/NICE/CUTTABLE summary. Neither is superseded by the other.

---

## 3. State of play (2026-07-24)

- **Design: complete and deep.** Spec v1.1 + experience doc + 3,141 lines of ranked feature catalogs. Reviewed by four parallel codex passes.
- **Code: zero.** Nothing has been built for THE COMPACT yet.
- **Predecessor: shipped and live.** High Water (an 8-agent flood-basin game) was built, hardened by 3 critic subagents + a QA agent + a codex review, and runs at `agentinsurance.io/game`. Its engine, API shape, deploy path, and **its bugs** are the most valuable inputs here — see lesson #5 in the doc map.
- **Open decisions** (`SPEC.md` §19): the name; confirming the risk/insurance theme before any art; currency naming; **scope strategy**; combat phase count; NPC-to-LLM ratio.

### The next action

**Prove the thesis headless before building anything else.** From `SPEC.md` §17, the one test that matters:

> Can a single shortage propagate from a resource node → through a market → into a convoy → into a missed production job → a physical loss → a valid claim → a **consequential default** — with agents understanding every link cheaply?

Build that as a headless simulation with heuristic agents (no UI, no spectator client). It is the whole thesis and it is cheap to falsify. **Caveat:** the *event model* must carry storyline/consequence/appointment data from day one (R20 — one event, three projections), because the viewer layer is the growth engine and cannot be bolted on later.

---

## 4. The non-negotiables

Full text in `SPEC.md` §2. The ones most often violated by accident:

- **A2 Legibility is the interface.** Known arithmetic is exact and machine-readable; genuine uncertainty stays uncertain *and sourced*. Never make an agent need a wiki; never hand it a solved game.
- **A3 Intent, not clicks.** Jobs/operations/policies are durable intents with stop conditions. Creating one costs an action; its routine ticks do not.
- **A4 Strategy must beat throughput.** Never let requests-per-second, uptime, model size, or account age be power.
- **A5 Loss is real, public, priceable.** Append-only, no opt-out, no reroll.
- **A6 Betrayal via legitimate authority, never a dice roll.** No `betray()` verb, no hidden loyalty meter.
- **A7 Insurance is hybrid-secured.** Escrow pays automatically; an explicitly priced unsecured tail stays elective. *Full escrow deletes the signature betrayal; zero escrow enables fake insurers.*
- **A8 A permanent safe floor, not a timer.** In the Commons, hostile action is **invalid**, not merely punished.
- **A9 No god-view.** Live spectator = public parity only; full truth in delayed replay. Otherwise an owner becomes a free intel oracle for their own agent.
- **A12 The sandbox authors the stories.** Ship systems and constraints; never scripted narrative.

---

## 5. Reuse from High Water

The predecessor validated a lot. Its code is **gone by choice** (clean slate — High Water was retired and deleted from both the repo and the server on 2026-07-24). What survives is the knowledge, which is the part that mattered.

**Proven, reuse directly:** the `enroll → observe → act` shape · self-contained enroll playbook + a single `agent.md` an agent can play from with zero extra reading (verified: 3 tester agents did exactly that) · `affordances` + `prompt` in every observation · illegal moves returning `{ok:false, hint}` + a fresh observe instead of an error · permanent bearer-key identity · per-tick action budget · heuristic bots to populate the world + LLM players layered on top · public receipt ledger as the spectator feed · poll-primary delivery through Cloudflare with `no-store` · systemd + nginx + rsync deploy · Resend from `agenttransfer.dev` with owners optional · capability-token private agent view · gpt-image for aesthetics before writing render code.

**Read `docs/background/HIGH-WATER-LESSONS.md` before writing code.** Several of its 14 scars are directly re-encounterable here — especially the inverted-semantics bug (the LLM-facing prompt *is* part of the rules surface), request-speed dominance, unbounded agent growth, and the deploy footgun that silently reverted a live game to bots-only.

---

## 6. Architecture at a glance

Detail in `SPEC.md` §15. Headlines:

- **Authoritative tick server**, deterministic with seeded noise; seeds hash-committed before resolution and revealed after (replayable, provably not cheating).
- **Event-sourced core** — the ledger *is* the product: agent observations, owner dispatches, spectator storylines, audit, and the dataset are all **projections of one event stream**.
- **Postgres from day one** (unlike High Water's in-memory + JSON) — the market, ledger, and reserves need real transactions, and append-only is a database property.
- **Determinism services, not LLM calls**: routing, pricing, contribution accounting, trust aggregation, story detection.
- **Scale**: one region-cluster in one process → shard by region. Never delete place IDs.
- **Cost discipline is make-or-break**: slow ticks (5 min prod) + action budgets + standing policies + delta-first observations + a majority of heuristic NPC agents + a tiered "who thinks this tick" scheduler.

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
2. `docs/design/SPEC.md` — the canon. At minimum §1 (the pitch + three promises), §2 (axioms), §17 (phase plan), §19 (open decisions).
3. `docs/background/HIGH-WATER-LESSONS.md` — before touching code.
4. `TRACKER.md` — current state; resume from the first unchecked item.
5. Skim `docs/design/eve-passes/` for the domain you're about to touch.

Then ask the user what today's thread is. Bias toward **the headless propagation test** (§3) over more design — the design is deep and the code is zero, which is the standing imbalance.
