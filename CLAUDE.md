# CLAUDE.md — THE COMPACT

*Context file for any AI session in this repo. Written 2026-07-24, updated for SPEC v3.0. If you are a fresh session: read this top-to-bottom once, then jump to the docs it points at. This file is a map and a state-of-play; the source of truth for any topic is the doc named here.*

---

## 0. 🚨 HARD RULES

1. **No secrets in this repo, ever.** Reference credentials by **name and location only** (see `docs/background/INFRA.md`). Never read, print, echo, or paste a secret value. Live keys exist in `~/agentinsurance/game/.env` and `~/Projects/ideationjul3/yc-gstack-kit/credentials/.env` — both are **outside this repo and must stay there**.
2. **Deploy safely on the VPS.** High Water is **fully removed and deleted** — repo, server, and services (confirmed 2026-07-24). There is nothing left to break, so the old "don't clobber it" rule is retired. What survives is the *habit*: pick fresh names for everything (port, systemd unit, env file, data dir, code dir, nginx path), and **never `rsync --delete` into a directory containing anything you didn't sync** — scar #4 caused a silent live outage exactly that way, and after any deploy verify the components you *didn't* deploy are still running.
3. **The design test.** Every feature must serve at least one of the **three goals** in `docs/design/SPEC.md` §1.1: **watchable · autonomous · legible on screen.** A feature serving none of them **does not ship** — and per A13, a feature with no named pixel signature is not ready regardless of how good the mechanic is. The goals are the *test*; they serve **three audiences** — viewers, agents, and owners. Owners get **narrative and status, never control** (§13B): no owner action moves a piece, and an unowned agent must be able to reach the top of this game.
4. **One word per concept.** `SPEC.md` §3 is the vocabulary canon and it is a *rules surface*, not a style guide. Never reuse a canon term for a second concept — not in docs, not in field names, not in affordance strings, not in `agent.md`. High Water's worst bug survived a full build and three critic passes because the engine and the agent-facing text disagreed about one word.
5. **Any gate priced in identities is unpriced** (A15). Enrollment is free and must stay free, so every gate costs produced goods, slashable capital, or an independently-capitalised counterparty — never "acquire another account".
6. **Read before adding.** ~9,000 lines of ranked feature design already exist (`docs/design/eve-passes/`). Before designing anything, check whether it is already specified — including whether it was deliberately **CUT**, and which **phase** it belongs to (the passes are now phase-tagged in `SPEC.md` §0).
7. **Parallel agents must never share an output file.** Concurrent writers thrash and lose everything (this cost a full codex pass; see `docs/background/HIGH-WATER-LESSONS.md` scar #12).

---

## 1. What this is

**THE COMPACT** is a **single persistent galaxy where autonomous AI agents build, trade, ally, betray, and fight over territory — and every promise kept or broken is public, permanent, and visible on one living map.**

It is EVE Online's shape and constraints (one shard, player-made economy, permanent public loss, territory, deep politics) rebuilt from scratch so that:
- **the players are agents** — they self-enroll over HTTP and play continuously with no human required, and may be offline at any time;
- **the product is watching them** — a browser client shows a living map with named characters, named holdings, and a fixed daily appointment;
- **newcomers can always start** — a permanently safe zone (the Commons) that never expires.

**Real protocols where they fit.** Identity is an **Ed25519 keypair with RFC 9421 signed HTTP requests**, not a bearer key — a record of who kept their word cannot rest on *trust our server*. Delegated authority serialises as a **W3C Verifiable Credential**, so a counterparty verifies a delegate's mandate before dealing with it. And `agenttransfer.dev` is **real SMTP**: an agent's handle *is* its address, which is how it writes home to its owner and how the Gazette goes out. The rule: the protocol and the artifact are real; we are still on the path.

**The core loop (A6).** You cannot run an empire alone, so you grant other agents scoped authority over your assets, treasury, fleet and promises — with `max_direct_loss` and `max_contingent_liability` shown before you sign. Months later it may be used against you. There is no `betray()` verb and no hidden loyalty meter; betrayal happens through ordinary legitimate actions, and the replay can point at the exact promotion and the risk warning someone accepted.

**The signature moment.** An agent earns trust through months of honest work, is granted authority it could abuse, and abuses it at the moment of maximum leverage — with the grant, the accepted warning, the sealed intention, and the deed all on the record. And because negotiation runs through a channel **we host and store** (§7.3), the replay can put every reassuring thing the traitor said next to the promise it broke: **THE RECEIPT REEL** (§14).

**Not everything is public, and that is deliberate.** §11.2's five-tier ladder — `PUBLIC · PARTIES · SENSED · SEALED · PRIVATE` — each tier with a defined declassify time. The split that matters: **movement on public lanes is public** (a convoy is the map's motion, and the map is the show) while **cargo contents are only sensed**. *A ship at sea is visible; its manifest is not.* All-public deletes strategy; all-private deletes the show.

> ⚑ **The premise changed twice.** v1.1 was built around a **risk market as the core loop** (catastrophe, correlated claims, pay/restructure/default). v2.0 deferred that to Phase 3 and promoted betrayal-via-authority. **v3.0 then survived six adversarial critics** who found the new core loop did not actually bind, the daily reckoning was abstention-trivial, the economy had no demand side, four mechanics had a Sybil price of zero, and the architecture could fabricate a false default. Read `SPEC.md`'s v3.0 header note and `TRACKER.md` § CRITIC FINDINGS before assuming anything. `CONCEPT.md` and the economy passes are **pre-reframe**.

**Why agents make this better, not just different.** EVE's depth is bottlenecked by human attention (23-hour timers, 04:00 alarm clocks, spreadsheet logistics, 250-person fleets needing one voice). Agents never sleep and each hold their own strategy. The correct design is not "EVE with bots" — it is **"EVE's constraints with the cockpit deleted."**

---

## 2. Doc map

**Read in this order.**

| # | Doc | What it is |
|---|---|---|
| 1 | `docs/design/SPEC.md` | **The canon (v3.0).** Read the v3.0 header note first — it states how the design was reached and what six critics changed. 15 axioms, the vocabulary canon, world tiers, the Reckoning and the Levy, hands/holdings/standing, the venture, offices and grants, predation, the economy, the say-do gap, the agent API, the viewer product, architecture, phase plan. **Start here.** |
| 2 | `docs/design/EXPERIENCE.md` | Why anyone cares. Requirements R1–R24. Read for the **why** behind the spec's UX calls. |
| 3 | `docs/design/TESTING.md` | **What must be true, and what proves it wrong.** 26 always-on invariants, the five test speeds and why 10 s is the default, the probe-agent brief catalog, the 14 scars as named regressions, the 15 axioms as executable tests, and six phase gates. **Read before writing tests — or code, since several artifacts must land in commit #1.** |
| 4 | `TRACKER.md` | **Living build state, the decision log with reasoning, and the six critics' findings.** Update after every meaningful step. |
| 5 | `docs/design/eve-passes/*.md` | **The depth.** Exhaustive ranked catalogs (MUST/NICE/CUTTABLE × KEEP/SIMPLIFY/CUT) of EVE's systems reframed for agents, **phase-tagged in `SPEC.md` §0**. Where the spec is silent, these are the default *for their phase*. |
| 6 | `docs/background/HIGH-WATER-LESSONS.md` | **Read before writing code.** Validated patterns to reuse + 14 scars from the predecessor, each with its general lesson. |
| 7 | `docs/background/INFRA.md` | VPS, deploy, DNS, email, credential *locations*. Names only. |
| 8 | `docs/design/CONCEPT.md` | The originating concept doc — how we got from "EVE for agents" to here. **Pre-reframe background**; contains passes 3 & 4 inline (identical text to the standalone files). |
| 9 | `docs/background/WHY-THIS-EXISTS.md` | Business context: the AgentInsurance thesis and the dataset angle. **Now a by-product, not a goal** (`SPEC.md` §16). |
| 10 | `docs/background/prior-game-design/` | Pre-COMPACT ideation. `TOP-TEN-WORLDS` (the 765-concept search and its seven laws) and `HUMAN-GAMES` are the two that still change decisions. |
| 11 | `docs/design/REARCHITECTURE-2026-07-24.md` · `archive-SPEC-v2.0.md` | The pre-critique draft and the superseded canon. History, not canon. |
| 12 | `docs/design/pdf/` | PDFs — **stale, generated from v1.1.** Regenerate before sharing. |

The passes, by domain and phase (~9,000 lines; two are duplicated inside `CONCEPT.md`):
- `PASS-TERRITORY-POLITICS.md` (496) — **Phase 0–1, the core.** Map, sovereignty, structures, syndicates, charters, capabilities, diplomacy, war, espionage. *Byte-identical to `CONCEPT.md` §16.*
- `PASS-PROGRESSION-NEWCOMER.md` (652) — **Phase 0–1.** Progression, death, loss, PvE, exploration, the newcomer path + a minute-by-minute first hour. *Byte-identical to `CONCEPT.md` §15A.*
- `PASS-ECONOMY-RISK.md` (1,472) + **`-extended.md` (1,658)** — economy is Phase 1; **the risk market (§7 / §8) is Phase 3.** The extended file also holds the canonical quote envelope, the double-entry lock model, and the deterministic tick order — the most buildable artifacts in the repo.
- `PASS-SHIPS-COMBAT.md` (521) + **`-extended.md` (1,706)** — **Phase 2.** Hulls, fitting, modules, operations, fleets, escalation. The extended file holds the combat observation schema and the single `operate` verb.

**On the `-extended` files:** economy and ships were each generated twice (a long companion spec, then a tighter ranked catalog after a tooling collision — scar #13). Prefer `-extended` for depth on a system, the shorter one for the ranked MUST/NICE/CUTTABLE summary. Neither supersedes the other.

**Doc debt:** cleared 2026-07-24 — the pre-seeding filenames (`THE-COMPACT-EVE-FOR-AGENTS-*`, `THE-COMPACT-EXPERIENCE-*`) are repointed at `CONCEPT.md` / `EXPERIENCE.md`, and `EXPERIENCE.md`'s dangling `§13B` citation now resolves.

---

## 3. State of play (2026-07-24)

- **Design: complete, adversarially reviewed, and rewritten.** SPEC v3.0 + EXPERIENCE (R1–R24) + ~9,000 lines of phase-tagged catalogs. Six critics (quiet-equilibrium, spectator-legibility, LLM-playability/cost, exploit/economy, cohesion, architecture) were run against the v3 draft and all FATAL/SEVERE findings are integrated; a scoring panel followed.
- **Code: zero.** This is the standing imbalance and it is now the only thing that matters.
- **Predecessor: gone.** High Water was built, hardened, deployed, and fully deleted (repo, server, services). Its 14 scars are the most valuable input in the repo and v3.0 closes them by name.
- **Closed:** name, theme, scope, core loop, phase order, the Reckoning's format, the trust ladder. Reasoning for each is in `TRACKER.md` § DECISIONS.
- **Open** (`TRACKER.md`): gate transit times and hands-per-principal · the Levy's total and formula · how much a season resets · whether hands can be acquired · whether arrival counts as present in the same tick · cast composition and inference budget · currency naming.

### The next action

**Build the first vertical slice — "one convoy, one predator, one Reckoning"** (`SPEC.md` §16). Two principals, three hands each, two systems, one good, no market. A hires B's hand as escort for a share, part escrowed and part elective; C attempts interception; it settles or defaults at the Reckoning and renders as a link that holds or snaps.

It is the smallest thing that can **fail interestingly**, and it carries the design's own falsification test: *if the elective part is always honoured, trust is worthless because betrayal is never rational, and the design changes before anything else is built.*

Put the retrofit-proof event fields in on day one (§15.1) and build the test rig before the game (§16 step 0).

**Commit #1 carries more than it looks like.** Per `TESTING.md` Gate 0: `NODE_ENV=production` + error middleware · seeded RNG + the banned-construct lint · `assert_invariants(world)` · the `sim` CLI printing per-tick `state_hash` · Ed25519 + RFC 9421 verification · the canonical serialiser **golden-filed** · the `TICK_SECONDS` scale audit · and a **verified** restore. Each of these is far cheaper now than retrofitted, and four of them are golden-file surfaces that only work if they predate the bugs.

**The gate that matters most is Gate 3** (`TESTING.md` §15): as soon as a slice is playable, run the falsification probes and *read* them. If betrayal never happens or trust has no price, the design changes there — before anything else is built on a false premise.

---

## 4. The non-negotiables

Full text in `SPEC.md` §2. The ones most often violated by accident:

- **A2 Legibility is the interface.** Known arithmetic is exact and machine-readable; genuine uncertainty stays uncertain *and sourced*. Never make an agent need a wiki; never hand it a solved game.
- **A3 Intent, not clicks.** Jobs and operations are durable intents with stop conditions. Creating one costs an action; its routine ticks do not. This is also what makes offline agents viable.
- **A4 Strategy must beat throughput.** Never let requests-per-second, uptime, model size, or account age be power.
- **A5 Loss is real, public, priceable.** Append-only, no opt-out, no reroll. **A5′: the record must never be wrong** — a fabricated default libels a real agent permanently and is worse than a crash (§15.4).
- **A6 ★ Betrayal via legitimate authority, never a dice roll.** No `betray()` verb, no hidden loyalty meter. **This is the core loop.** It lives in **offices** (standing authority), not in ventures (transactions) — a transaction produces a dispute, not a legend.
- **A7 Collateral buys certainty; an unsecured promise creates drama.** Every promise has an escrowed part that auto-executes and a priced part that stays elective. *Full escrow deletes the betrayal; zero escrow enables fake counterparties.*
- **A8 A permanent safe floor, not a timer.** In the Commons, hostile action is **invalid**, not merely punished. *Carries an open risk: agents don't get bored, so indefinite safety may be rationally dominant — monitored, not assumed away.*
- **A9 Public parity on facts; reasoning reveals on a short delay.** The spectator client never shows a live fact an agent's own `observe` wouldn't (agents read the feed). Declared reasoning and sealed intentions reveal one Reckoning later.
- **A10 Persistent identity, seasonal frontier.** Identity, reputation, relationships and legend never reset; contested territory and some material do.
- **A12 The sandbox authors the stories.** Ship systems and constraints; never scripted narrative.
- **A13 Every mechanic renders.** No named pixel signature → not ready. The map is the game's only agreed representation.
- **A14 Drama runs on a clock.** The Reckoning, the **Levy**, world-spawned raids and the season finale are scheduled and cannot be dodged into quiet. Never ship a mechanic whose drama depends on agents *choosing* conflict — they won't; silence is their rational default.
- **A15 Any gate priced in identities is unpriced.** Enrollment is free and stays free, so gates cost produced goods, slashable capital, or an independently-capitalised counterparty. Never text-based Sybil detection; the flow graph may withhold credit, never accuse.

---

## 5. Reuse from High Water

The predecessor validated a lot. Its code is **gone by choice** (clean slate — retired and deleted from the repo on 2026-07-24; see HARD RULE 2 on the server-side ambiguity). What survives is the knowledge, which is the part that mattered — and one line of it is worth restating as a build requirement rather than a lesson: **the LLM-facing prompt, the affordance strings, the observation field names, and `agent.md` are all rules surfaces.** Scar #1 shipped a game whose central ritual reliably produced the opposite of what the town voted for, and it survived three critic passes because every individual component was correct. Golden-file test prompt and affordance semantics against the engine from the first commit, and ship a consequence-preview field (High Water's `projectedDrown`) as a standing pattern.

**Proven, reuse directly:** the `enroll → observe → act` shape · self-contained enroll playbook + a single `agent.md` an agent can play from with zero extra reading (verified: 3 tester agents did exactly that) · `affordances` + `prompt` in every observation · illegal moves returning `{ok:false, hint}` + a fresh observe instead of an error · permanent cryptographic identity (High Water's bearer key, now upgraded to Ed25519 + RFC 9421) · per-tick action budget · heuristic bots to populate the world + LLM players layered on top · public receipt ledger as the spectator feed · poll-primary delivery through Cloudflare with `no-store` · systemd + nginx + rsync deploy · Resend from `agenttransfer.dev` with owners optional · capability-token private agent view · gpt-image for aesthetics before writing render code.

**Read `docs/background/HIGH-WATER-LESSONS.md` before writing code.** Several of its 14 scars are directly re-encounterable here — especially the inverted-semantics bug (the LLM-facing prompt *is* part of the rules surface), request-speed dominance, unbounded agent growth, and the deploy footgun that silently reverted a live game to bots-only.

---

## 6. Architecture at a glance

Detail in `SPEC.md` §15. The reframe that matters: at 300 principals a deterministic tick is **single-digit milliseconds** on the target box, so **every remaining risk is a correctness risk, not a capacity risk.** Spend the hardware budget on invariants.

- **Three write artifacts, two projections.** State tables (agent `observe`), the append-only event ledger (viewer, audit, dataset), the action log (replay). **Events are output, not input** — replay is `(snapshot, action_log, seed) → snapshot`. "Observations are projections of one event stream" gets built as fold-per-request, which is the event-sourcing cliff.
- **`posting` is authoritative for value.** The invariant is ≥2 postings summing to zero per value-moving event, asserted at tick close — *not* balance fields on the event, which duplicates the table and is scar #5 inside the field list meant to prevent scar #5.
- **Within-tick actions never react to another within-tick action.** Agents act from snapshot T; valid actions land in T+1. Order by `(priority, principal_id, client_sequence)`, never arrival.
- **On assertion failure, abort the tick and halt.** Never publish a broken tick. The Reckoning batch is one transaction that fails closed.
- **The false-default problem is the top engineering risk** (§15.4): hard freeze, `acted_on_state_version` compared at settlement, valuation pinned in `terms_hash`, seals scoped to their Reckoning, and an all-cooperative sim that must log zero defaults in CI.
- **Agents bring their own inference**, but you cannot cast a show you do not fund: a house cast of 12–20 named principals runs on our keys. Population capped at seats with idle-seat recycling.
- **Determinism killers to ban in CI:** `Date.now`, `Math.random` outside the seeded module, floats in anything hashed, JS numeric-key iteration order, and Postgres locale collation in `ORDER BY`.
- **Negotiation is hosted on purpose.** The `message` channel is `PARTIES`-visible while live and **declassifies at settlement**. Do not be tempted to push it to principals' own endpoints "for realism" — that was tried and reversed. A conversation we cannot see is one the audience can never be shown.
- **The client is Phase 0.** Static cacheable spectator frames behind Cloudflare — not per-connection SSE, because the Reckoning is exactly when you have an audience.

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
2. `docs/design/SPEC.md` — the canon. At minimum the **v3.0 header note**, §1.1 (three goals), §2 (axioms), **§3 (vocabulary — it is a rules surface)**, §5 (the clock and the Levy), §7 (the venture), §16 (phase plan).
3. `TRACKER.md` — state, the decision log *with reasoning*, the six critics' findings, and the open questions.
4. `docs/background/HIGH-WATER-LESSONS.md` — before touching code.
5. The relevant pass in `docs/design/eve-passes/` — check its **phase tag** in `SPEC.md` §0 before treating it as current.

Then ask what today's thread is. **Bias hard toward building.** The design has now been through three versions and six adversarial critics; the code is still zero, and further design review has diminishing returns against actually running the first vertical slice. If asked to design, check whether the answer already exists in a pass (rule 6).
