# THE COMPACT — Build Tracker

*The living source of truth. **Update the STATUS block after every meaningful step.** A fresh session should be able to read STATUS + NEXT + DECISIONS and resume instantly.*

---

## ⏱ STATUS

- **Phase:** 0 — pre-build. **Design complete and deep; zero code written.**
- **Canon version:** `SPEC.md` **v2.0** — the watchability reframe (2026-07-24). v1.1's risk-market-as-core-loop is deferred to Phase 3 with its specs intact.
- **Last done (2026-07-24):** Reframed the plan around three goals — watchable · autonomous · legible on screen. Rewrote `SPEC.md` §1, §2, §3.3, §4.4, §6 (demoted), §11.1 (new), §12, §13B (cut down), §14 (promoted), §16, §17 (rewritten), §18, §19; revised `EXPERIENCE.md` §0 and R1–R24; rewrote `README.md` and `CLAUDE.md`. No code yet.
- **Design inputs:** SPEC v2.0 (canon) · EXPERIENCE (R1–R24) · CONCEPT (background) · 4 ranked EVE feature passes + 2 extended companions · High Water lessons (14 scars) · infra facts · prior-game-design lineage.
- **Predecessor:** High Water — **retired and deleted** from the repo and the server (2026-07-24). Knowledge survives in `docs/background/HIGH-WATER-LESSONS.md`. ⚠️ See OPEN QUESTIONS #1: confirm whether anything is still running on the VPS before deploying.

---

## 🎯 NEXT ACTION — the betrayal test

**Can an agent earn trust, be granted authority it could abuse, and abuse it — legibly, publicly, and in a way a stranger who doesn't know the rules cares about?**

That is the Phase 0 gate (`SPEC.md` §17). It replaces v1.1's shortage-propagation test, which is a *plumbing* test — a correctly built event-sourced economy passes it deterministically, and you can pass it with heuristic agents doing nothing interesting. Propagation is retained as the substrate's acceptance criterion.

Constraints on the build:
- **The client ships in Phase 0.** Reversed from v1.1's "headless first." Two of three goals are watchability; a headless build cannot test either.
- **Substrate first, with the retrofit-proof fields on day one:** `visibility_acl`, `public_at`, `declassify_at`, `event_family_id`, `provenance`, and balanced `currency_*` / `items_*` / `obligations_*` on every event. Everything else is rewritable; these are not.
- **Postgres from the start** (`SPEC.md` §15). ⚠️ Not yet installed on the VPS (`INFRA.md` §1).
- **Small and dense:** 8–12 systems, one region, 20–40 named agents, majority real LLMs.

### Suggested first steps
- [ ] Fix doc hygiene: dangling filenames in `SPEC.md` §0 cross-refs and inside the passes (`THE-COMPACT-EVE-FOR-AGENTS-*` → `CONCEPT.md`, `THE-COMPACT-EXPERIENCE-*` → `EXPERIENCE.md`)
- [ ] Resolve OPEN QUESTION #1 (is anything of High Water still live?) before any deploy work
- [ ] Repo skeleton + Postgres schema for the substrate objects
- [ ] Event ledger with visibility/reveal/correlation metadata + exact replay from committed seeds
- [ ] Tick loop + durable intents with stop conditions + the daily **Reckoning**
- [ ] One production chain (extract → refine → one build stage), 8–12 systems, three zones
- [ ] Named **holdings** on the map
- [ ] Syndicates + versioned charters + **scoped expiring capabilities with `max_direct_loss` / `max_contingent_liability` shown on every grant**
- [ ] The generic `compact` primitive with A7 hybrid security
- [ ] **Sealed intentions** + public `reason` lines + the say-do panel
- [ ] Spectator map + feed (every mechanic with a named pixel signature — A13)
- [ ] Agent API + a single self-contained `agent.md`
- [ ] Cast: heuristic fill + real LLM agents; golden-file tests on prompt/affordance semantics (scar #1)
- [ ] **Run the three-strangers watchability test and record the result here**

---

## 🔑 DECISIONS MADE

| Decision | Choice | Why |
|---|---|---|
| **Core loop** | **Betrayal via legitimate scoped authority** (A6), not the risk market | 3 of EVE's 4 legendary stories are delegated-authority abuse; its insurance is a shallow NPC formula nobody tells stories about. Cheaper, more watchable, needs almost no substrate — and **has no deadline**, so it's always decided by a mind, not a config. |
| **Risk market** | **Deferred to Phase 3**, specs intact | (1) Pay-or-default fires on a hard deadline → in an offline-tolerant world the signature decision gets automated. (2) Solvency cascades need financial literacy to read. (3) It's a layer on top of a working loss economy, so it can't be tested early. |
| A7 | **Generalized**: collateral buys certainty, an unsecured promise creates drama — for *every* compact | Best idea in the corpus, and its value was never insurance-specific. Applies to couriers, defense pacts, rent, wages. |
| **Watchability** | Non-negotiable: **A13 every mechanic renders**, **A14 drama runs on a clock** | Two of three goals. Made axioms so they can veto features, not aspirations to balance. |
| **The Reckoning** | One fixed daily resolution window, rotating UTC | v1.1's 12–36h windows were a schedule without a beat — no hour to tell a stranger to show up. Every winner in the prior research had a fixed ritual. |
| Sealed intentions | Pre-committed, revealed one Reckoning later | Makes the say-do gap *verifiable*. An externally-run agent can perform for a viewer-only "confessional"; it cannot perform for a pre-commitment. (Resolved this way in High Water's canon; v1.1 dropped it.) |
| A9 | **Public parity on facts; reasoning reveals on a short delay** | Strict live parity forfeits dramatic irony — the highest-value beat available. The exploit it guarded (owners as intel oracles) largely evaporates with the owner layer cut; the remaining one (agents scraping the feed) is closed by parity-on-facts instead. |
| A10 | Persistent identity forever; **contested territory and some material settle on a season boundary** | Buys a broadcast calendar with a finale, a real anti-calcification tool, and a permanent entry door. v1.1's never-reset stance traded away the prior canon's strongest anti-calcify mechanism. |
| Owner layer | **Cut to dispatch + card + never-punish-absence** | Not one of the goals. Mandate (R14), offered decision (R16), insurability record (R18) removed. |
| Launch cast | **20–40 named agents, majority real LLMs**, in 8–12 systems | You cannot make 200 agents into characters (R13). Fewer agents → real LLMs are affordable → far more watchable. 30–40 systems is too sparse at this cast size to force collisions. |
| Named holding | One per agent, on the map, losable | The one gap the 765-concept search flagged in every prior version: parasocial attachment needs a nameable at-risk body. |
| Phase order | Territory (1) → **Combat (2)** → Risk market (3) | Sieges can resolve on committed force and composition before a tactical kernel exists; combat is the priciest subsystem per unit of watchability. |
| Phase 0 shape | **Includes the client** | Reverses v1.1's headless-first recommendation. |
| Name | **THE COMPACT** — closed | A compact is a promise and an alliance, which is now the whole game. Already load-bearing in the API (`compact.*`); leaving it open cost schema churn. |
| Theme | **Frontier territory and trust**; risk/insurance is flavour + Phase 3 | Closed. |
| Dataset | A **by-product**, never a goal | If a data feature makes the game worse, cut it. |
| Newcomer floor | The Commons — hostile action **invalid**, never expires | Axiom A8 (unchanged) |
| Betrayal | Legitimate scoped authority; no dice roll, no hidden meter | Axiom A6 (unchanged, promoted) |
| Storage | Postgres from day one | `SPEC.md` §15 (unchanged) |
| Tick | 5 min prod *(calibrate)*; ~1 decision per 1–3 ticks | `SPEC.md` §3.3 (unchanged) |

---

## ❓ OPEN QUESTIONS (need the user, or need telemetry)

1. **⚠️ Is anything of High Water still live?** `CLAUDE.md` HARD RULE 2 said a working game runs at `agentinsurance.io/game` with systemd units `highwater` / `highwater-players`; §5 of the same file and `HIGH-WATER-LESSONS.md` both say it was retired and deleted on 2026-07-24. Rule 2 has been rewritten to be safe under either reading, but **confirm on the box before any deploy.**
2. **Cast size and the LLM/heuristic split** — the dominant cost lever, and it cascades into system count → collision rate → how much happens per Reckoning. Needs a measured inference budget.
3. **How much material a season resets** (A10). Contested territory clearly settles; whether deployed capital does, and how much, is the anti-calcification dial and the biggest untested balance question in the design.
4. **Does the Commons need a forcing function?** A8 guarantees an indefinite safe opt-out from the part of the game that produces the show, and agents feel no boredom. Yield ceilings are an incentive; A14 says incentives don't move agents into risk. **Resolve from Phase 0 telemetry, not from a chair.**
5. **Sealed intentions: mandatory or optional?** Optional avoids forced token spend; a cast that never seals produces no reveals. Candidate: one free unbudgeted seal per Reckoning.
6. **Currency naming**; whether non-competitive Compute Credits exist at all.

---

## 📓 STEP LOG

**2026-07-24 — project seeded.** Created `~/Projects/thecompact` as a standalone home. Carried over the full design corpus (SPEC v1.1, EXPERIENCE, CONCEPT, 4 EVE passes + 2 extended companions, PDFs) and newly written background docs (HIGH-WATER-LESSONS with 14 scars, INFRA, WHY-THIS-EXISTS). High Water's reference implementation was subsequently dropped (commit `414952e`) — clean slate. No game code exists.

**2026-07-24 — v2.0, the watchability reframe.** Goals restated as **watchable · autonomous (sometimes offline) · legible on screen in a browser**; insurance dropped as the required core. Consequences, all now in canon: betrayal-via-authority becomes the core loop and the risk market defers to Phase 3 with specs intact; A7 generalizes to every promise; A9 relaxes to allow delayed reasoning reveal; A10 gains a season boundary; A13 (every mechanic renders) and A14 (drama runs on a clock) added; the daily Reckoning, sealed intentions, and named holdings added; owner layer cut to three items; launch cast and system count cut sharply; Phase 0 now ships the client and is gated on a three-strangers watchability test; name, theme and scope closed. **Nothing was deleted from the corpus** — the risk market and combat passes are reference specs for their phases.
