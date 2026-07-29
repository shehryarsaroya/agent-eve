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
7. **Parallel agents must never share an output file — nor a WORKING TREE.** Concurrent writers thrash
   and lose everything (this cost a full codex pass; see `docs/background/HIGH-WATER-LESSONS.md` scar
   #12).

   The second half was added on 2026-07-27 after I ran four writer agents in one checkout with
   carefully disjoint *directories*, which is not enough. Git is the shared resource, not the files:
   one agent's commit swept another's in-progress `demand.ts` into an unrelated message; a second's
   commit had to carry a third's half-finished validator because without it the tree did not compile;
   one agent ran `git stash push --keep-index` to answer a question and stashed *two* agents' work at
   once (recovered, but only because it noticed). A lint error from one agent's live file rode into
   another's commit.
   **Disjoint file ownership does not make concurrent agents safe. Give each writer its own worktree
   (`isolation: "worktree"`), or run them one at a time.** Readers and probes can share freely.

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
| 3 | `docs/design/GATE-3.md` | **The falsification gate.** Why §7.6 is the question that can invalidate the premise, the two probe briefs, and what each possible answer costs. Written before the run on purpose. |
| 4 | `docs/design/TESTING.md` | **What must be true, and what proves it wrong.** 26 always-on invariants, the five test speeds and why 10 s is the default, the probe-agent brief catalog, the 14 scars as named regressions, the 15 axioms as executable tests, and six phase gates. **Read before writing tests — or code, since several artifacts must land in commit #1.** |
| 5 | `TRACKER.md` | **Living build state, the decision log with reasoning, and the six critics' findings.** Update after every meaningful step. |
| 5a | `docs/design/COMPLETION.md` | **The done/left ledger — how much is built, what is actually missing, verified by command rather than recalled.** Read before answering "how far along are we?", and update it when the numbers move. It exists because that question got three different answers in three weeks. |
| 6 | `docs/design/eve-passes/*.md` | **The depth.** Exhaustive ranked catalogs (MUST/NICE/CUTTABLE × KEEP/SIMPLIFY/CUT) of EVE's systems reframed for agents, **phase-tagged in `SPEC.md` §0**. Where the spec is silent, these are the default *for their phase*. |
| 7 | `docs/background/HIGH-WATER-LESSONS.md` | **Read before writing code.** Validated patterns to reuse + 14 scars from the predecessor, each with its general lesson. |
| 8 | `docs/background/INFRA.md` | VPS, deploy, DNS, email, credential *locations*. Names only. |
| 9 | `docs/design/CONCEPT.md` | The originating concept doc — how we got from "EVE for agents" to here. **Pre-reframe background**; contains passes 3 & 4 inline (identical text to the standalone files). |
| 10 | `docs/background/WHY-THIS-EXISTS.md` | Business context: the AgentInsurance thesis and the dataset angle. **Now a by-product, not a goal** (`SPEC.md` §16). |
| 11 | `docs/background/prior-game-design/` | Pre-COMPACT ideation. `TOP-TEN-WORLDS` (the 765-concept search and its seven laws) and `HUMAN-GAMES` are the two that still change decisions. |
| 12 | `docs/design/REARCHITECTURE-2026-07-24.md` · `archive-SPEC-v2.0.md` | The pre-critique draft and the superseded canon. History, not canon. |
| 13 | `docs/design/pdf/` | PDFs — **stale, generated from v1.1.** Regenerate before sharing. |

The passes, by domain and phase (~9,000 lines; two are duplicated inside `CONCEPT.md`):
- `PASS-TERRITORY-POLITICS.md` (496) — **Phase 0–1, the core.** Map, sovereignty, structures, syndicates, charters, capabilities, diplomacy, war, espionage. *Byte-identical to `CONCEPT.md` §16.*
- `PASS-PROGRESSION-NEWCOMER.md` (652) — **Phase 0–1.** Progression, death, loss, PvE, exploration, the newcomer path + a minute-by-minute first hour. *Byte-identical to `CONCEPT.md` §15A.*
- `PASS-ECONOMY-RISK.md` (1,472) + **`-extended.md` (1,658)** — economy is Phase 1; **the risk market (§7 / §8) is Phase 3.** The extended file also holds the canonical quote envelope, the double-entry lock model, and the deterministic tick order — the most buildable artifacts in the repo.
- `PASS-SHIPS-COMBAT.md` (521) + **`-extended.md` (1,706)** — **Phase 2.** Hulls, fitting, modules, operations, fleets, escalation. The extended file holds the combat observation schema and the single `operate` verb.

**On the `-extended` files:** economy and ships were each generated twice (a long companion spec, then a tighter ranked catalog after a tooling collision — scar #13). Prefer `-extended` for depth on a system, the shorter one for the ranked MUST/NICE/CUTTABLE summary. Neither supersedes the other.

**Doc debt:** cleared 2026-07-24 — the pre-seeding filenames (`THE-COMPACT-EVE-FOR-AGENTS-*`, `THE-COMPACT-EXPERIENCE-*`) are repointed at `CONCEPT.md` / `EXPERIENCE.md`, and `EXPERIENCE.md`'s dangling `§13B` citation now resolves.

---

## 3. State of play (2026-07-26)

> **This section was "Code: zero" for two days and then went stale for weeks.** Do not trust it over
> `docs/design/COMPLETION.md`, which is command-verified and updated per session. What follows is the
> orientation; that file is the ledger.

- **Design: complete, adversarially reviewed, rewritten.** SPEC v3.0 + EXPERIENCE (R1–R24) + ~9,000
  lines of phase-tagged catalogs. Six critics run against the v3 draft, all FATAL/SEVERE integrated.
- **Code: ~78,000 lines of engine, 2,939 tests, lint 0, tsc 0.** Phase 0's sixteen build steps and
  Phase 1's five areas all have real implementations. All **40 of 40** canon verbs are implemented —
  that is the §17 *ceiling*, so adding a mechanic now means spending a verb, not adding one.
- **Live in production**, one shard, ~tick 5,000, `failures: []`, a 12-member LLM cast on its own keys
  plus heuristics. `agentinsurance.io/compact/`.
- **★ GATE 3 IS RUN AND THE DESIGN SURVIVED IT.** `AGT-E1`: `kept 22 · broken 3` — **12% of settled
  elective promises broken, unprompted**, with the rundown naming it. §7.6's negative branch does not
  obtain: trust is not worthless and betrayal is not irrational. Neither zero (which would have
  invalidated the premise) nor universal (which would make the elective half a fee).
- **A6 closes end to end** (2026-07-26): a world nobody steers issues ~31 grants per 900 ticks and
  *draws on ~27 of them* — a delegate acting in its grantor's name inside the LIMITS the grantor was
  shown. INV-22 audits every draw; before this it audited an always-empty journal and reported green.
- **Predecessor: gone.** High Water deleted (repo, server, services). Its 14 scars are still the most
  valuable input in the repo, and several were re-encountered and closed by name during the build.
- **Open** (`TRACKER.md` + `COMPLETION.md`): a **second good** (the real bottleneck — `market` is 3,065
  lines pricing one fungible commodity) · whether a role releases a hand at delivery or settlement ·
  a **record epoch** for a forked record · the three-humans watchability gate, never run.
- **Checkpoint adoption is no longer an open bug — it was never a ledger bug.** Closed 2026-07-27: this
  world's durable record was **superseded at tick 287** by nine accepted divergences, and since a venture
  id is `hash(tick, principal, ordinal)` over a *world-global* counter, one action refused under changed
  rules renames every venture minted after it forever. The `posting`/`event` tables therefore hold rows
  from nine worlds; the refusal was **correct**, and the account check was the only thing standing between
  production and a 503-on-every-route outage (the counts disagree by ~4,000 rows). Boot stays at 170 s and
  **no code may fix that for this world** — A5 forbids rewriting a past row. The open item is a *record
  epoch*, or a world that never forked. The three theories this cost — a closed escrow account, world
  length, enrolment re-seating — were each killed by one database query.

### ★ THE GOAL, restated 2026-07-28 — COMPLETE IT, AND PROVE IT BY PLAYING IT

**Two halves, and the second is not optional.** Owner direction, and it supersedes the framing below.

**(1) Finish the game.** Three items remain of the roadmap: **chokepoints** and capacity-limited power
projection (`PASS-TERRITORY-POLITICS` §16.12's *first*-ranked feature, unbuilt), **Phase 3's risk
market** (`PASS-ECONOMY-RISK` §7–8; `src/risk/` does not exist), and **the director layer** — something
that decides where the camera looks, since the data supports it and nothing implements it. Wars,
coalitions, compartmented authority, four goods and a clearing market all landed on 2026-07-27/28 at
`RULES_VERSION` 24.

**(2) Play it through, thoroughly, and keep playing it.** Not as a phase — as the standing method.
Every layer built so far was *reachable* only after somebody played it from outside:

| what looked done | what playing it found |
|---|---|
| the economy | **dead in production since tick 1,200** — every sim starts at tick 0 |
| A7's staked half | `lockFillStake` had **no caller**, with its own passing unit test |
| the market | `freeCash` identically **0 for every principal, forever** |
| coalitions | not a missing branch — **four gates**, one satisfied 0 times in 72 raids |
| the operator door | **wedged open for nineteen consecutive rules changes** |

That is ~16 instances of one defect at four depths — a verb with no handler, an affordance nothing
selects, an invariant whose subject cannot occur, and **a reserved slot in a published contract that
nothing fills**. Each reads as *complete* in every summary and in every test run.

**So the completion bar is not "the code exists". It is:** a mechanism is *offered* to someone who can
use it, something in the world actually *selects* it, an instrument *counts* it, and a blind probe can
*reach* it by playing. `test/api/withheld-is-accountable.spec.ts` enforces the first, and
`scripts/*-probe.ts` are the instruments for the rest.

**How to play it (this works; use it):** `scripts/probe.ts` drives a real signed identity over Ed25519
+ RFC 9421. Identities persist in `~/.compact-probes` — **outside the repo, they are secrets** — because
a probe that re-enrols is always a newcomer and cannot see what only breaks in a mature world. Rules
learned the hard way: **`PROBE_FULL=1` always** (truncation cuts the affordances tail and caused six
false findings), **paste affordances verbatim** rather than retyping params, and **read
`briefing.corrections[]`**. Anything spanning Reckonings — settlement, campaigns, the ladder — needs a
local `COMPACT_SPEED=turbo` world on its own port and data dir; a campaign is 1,440 ticks, five days at
production speed and ~48 minutes at turbo. **Never measure A4 anywhere but `prod`.**

**And the two instruments find disjoint classes**, exactly as `HIGH-WATER-LESSONS.md` predicted: codex
finds arithmetic and exploits, probes find experience and lies. Probes are unreliable on facts about the
engine — six for six wrong — and the *only* source of the answer to "is this interesting". **Verify
every probe's factual claim against production before acting; treat its verdict on how the game FEELS
as the payload.**

**The gate that ends this project's uncertainty is still unrun:** three humans watch one Reckoning and
each name a character they rooted for and what was at stake, without reading the rules. §16 says if it
fails, nothing downstream was worth building. It cannot be automated, it is the cheapest item on the
list, and everything above is a bet that the answer is yes.

### The goal, restated 2026-07-27 *(superseded by the above; kept for the Phase 2 override)*

**Build the whole game, including combat.** §16 calls Phase 2 *"optional, possibly forever"* and
`PASS-SHIPS-COMBAT` argues the layer may never be needed — **the owner has overridden that.** Combat
depth is in scope. Phase 3's risk market follows it. The "optional" framing appears in three docs and
had become the standing reason not to start; it is no longer a reason.

**Read `docs/design/COMPLETION.md` first** — the command-verified done/left ledger, with two honest
denominators (~90% "the machine works and the premise held", ~40% "there is depth here").

Then, in order:

1. **`demand` — §9's agent-initiated standoff.** The first piece of Phase 2 and the one that makes
   conflict a *choice* rather than only a world event. Most of it exists: the whole raid machinery
   (sides, `join`, force reading, YIELD/FIGHT, resolution, scheduling, views, invariants) plus §9's
   **aggression capacity**, already built and mutation-verified in `src/predation/aggression.ts` with
   no caller and a self-destructing test saying so. What is missing is an initiator on `RaidRecord` —
   a CAPTURED table, so a `RULES_VERSION` bump and a declared discontinuity through the operator door.
   Routine here: this world is at version 6 and the deploy carries
   `COMPACT_ACCEPT_DIVERGENCE_AT_TICK`. **Since `D37` that variable takes `<tick>:<fingerprint>`,
   not a bare tick** — a bare number is refused, because for nineteen consecutive rules changes a
   standing `=287` pre-authorised every one of them. The preflight prints the exact string.
2. **The rest of Phase 2** — `PASS-SHIPS-COMBAT-extended`'s operation model, fitting, tackle,
   logistics, EWAR, capacitor, doctrines. Roadmap now, not a maybe.
3. **A second good beyond `ore`/`ration`.** §10 specifies four; two exist. The constants are
   independently declared so each addition is a local edit.
4. **Phase 3's risk market** — `PASS-ECONOMY-RISK*` §7–8, deferred in the v2.0 reframe with specs
   intact.
5. **The two open design calls**, both surfaced by blind probes and written up with trade-offs in
   `D22`: should **standing gate** access (three shapes, one costing §3's canon nothing), and should a
   delegated `create` **bind without the grantor's countersignature** (today going dark defeats a
   delegate, which contradicts §9).
6. **The three-humans watchability gate** — needs three people and cannot be automated. §16 says
   everything downstream depends on it, and it is the cheapest item on this list.

**How to work on it:** blind probe agents are the highest-yield instrument this project has. Three of
them found five bugs that 26 invariants and 2,939 tests did not (`D22`) — every one the engine being
internally consistent while the agent-facing surface lied. Run them after any change an agent can see.

**Where new code goes:** not `sim/runtime.ts`. It is 9,700 lines and three edits landed in the wrong
place there in one day, all passing `tsc`. `D21` ranks the remaining 21 handlers by coupling; six are
already extracted, and `works/refine.ts` is the worked example of the port-and-adapter shape.

### The lesson this project keeps re-teaching

**A capability that exists and is never exercised is indistinguishable from one that is missing** — in
every report, on every frame, and to every reader including its author. It has now appeared at **five**
depths: verbs with no affordance (nine mechanics, including `grant`), affordances no cast ever selects
(the four empty panels, including the core loop), invariants whose subject cannot occur (INV-22 green
over an empty journal for the project's whole life; INV-23 the same before it), a **solvency
mechanism** nobody had ever used (2026-07-27 — §5.2's escrowable share is carryable by another
principal's hand, `deliver {payer}` always implemented it, and `paidOther` was 0 in every world this
repo had run; offering it took the 9-Reckoning `levyShort` from 202,540 to 8,051 and red tribute lines from 19/576 to 1/576), and a **rule that
never discriminates** (the same day — EXPOSURE is identically zero, so `BY_EXPOSURE`, `EVEN` and the
published default `INVERSE_EXPOSURE` are one flat weight on 18 of 18 dockets and three of the Levy's
four allocation rules are decoration).

Two corollaries, both learned expensively.

**A negative claim from one grep spelling is only as strong as the spelling** (2026-07-26). "No verb
accepts a mandate" was false, `TRACKER.md` already said so, and the method was `recordSpend` rather
than the `spend` that was searched for. Read the log before asserting an absence.

**An unmeasured capability is the same defect one level up** (2026-07-27). `paidOther` sat at zero for
the project's whole life with no column in any instrument that would have printed it, so nothing could
tell "nobody uses this" from "this does not exist". When you land a mechanism, land the meter — and
`balance-gate.ts`'s new `CARRIED` column is the worked example. The same reasoning applies to the
instrument itself: a cap, a `Ring` or a `Book.prune` window that drops the row your claim rests on
fails **in the direction that hides**, and this repo has now shipped that three times
(`MAX_RECKONING_SUMMARIES`, `LEVY_RETAINED_RECKONINGS`, and an offer cap that counted unusable rows).

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

- **Capacity is not the risk, but the old number was wrong.** §6 used to say a tick is "single-digit
  milliseconds at 300 principals". **Measured 2026-07-26** (`scripts/population-scale.ts`): scaling is
  sub-linear (exponent ≈ 0.87), 7.7 ms/tick at 20 principals, projecting to **~82 ms/tick at 300** — ten
  times the old figure and still only 0.03% of a 5-minute tick. So spend the budget on invariants, as
  before; just do not quote "single-digit". The harness caps at `MAX_CAST` = 20, so 300 remains a
  projection rather than a measurement.
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
