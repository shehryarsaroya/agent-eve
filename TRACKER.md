# THE COMPACT — Build Tracker

*The living source of truth. **Update the STATUS block after every meaningful step.** A fresh session should be able to read STATUS + NEXT + DECISIONS and resume instantly.*

---

## ⏱ STATUS

- **Phase:** 0 — pre-build. **Design complete and deep; zero code written.**
- **Last done (2026-07-24):** Project folder created and seeded. Design corpus, background docs, and the High Water reference implementation carried over. Nothing built yet.
- **Design inputs complete:** SPEC v1.1 (canon) · EXPERIENCE (R1–R20) · CONCEPT · 4 ranked EVE feature passes (3,141 lines) · High Water lessons (14 scars) · infra facts.
- **Live predecessor:** High Water running at `agentinsurance.io/game` (do not disturb — see CLAUDE.md rule 2).

---

## 🎯 NEXT ACTION — the thesis test

**Prove the propagation test headless before building anything else** (SPEC §17):

> Can a single shortage propagate from a resource node → through a market → into a convoy → into a missed production job → a physical loss → a valid claim → a **consequential default** — with agents understanding every link cheaply?

Constraints on this prototype:
- **Headless.** No spectator client, no art. Heuristic agents first; a few LLM agents once the loop closes.
- **Event model carries the projections from day one** (R20) — storyline/consequence/appointment fields must exist even with no UI reading them, because the viewer layer is the growth engine and cannot be retrofitted.
- **Substrate first** (SPEC §17): versioned items/lots/recipes · currency/item/obligation double-entry · atomic locks · exact quote + `terms_hash` + idempotency · physical location · the append-only public event ledger · fact-vs-assertion separation.
- **Postgres from the start** (SPEC §15) — not in-memory.

**Why this first:** it is the entire thesis, it is cheap to falsify, and if it doesn't sing, everything downstream is wasted. Do not build UI, combat, or sovereignty until it passes.

### Suggested first steps
- [ ] Decide scope strategy (SPEC §19 item 4) — recommended: headless prototype → full Phase 0
- [ ] Repo skeleton + Postgres schema for the substrate objects
- [ ] Tick loop + job/intent model with stop conditions
- [ ] One production chain (4 resource families → refine → 2-stage build)
- [ ] One regional order book with quantity-aware executable prices
- [ ] Courier contract with collateral + one chokepoint route
- [ ] One catastrophe with the 8-step cadence (SPEC §7)
- [ ] Hybrid-secured policy + claim waterfall + pay/restructure/default
- [ ] Heuristic agents that exercise the whole chain
- [ ] **Run the propagation test and record the result here**

---

## 🔑 DECISIONS MADE

| Decision | Choice | Where |
|---|---|---|
| Theme | Risk/insurance frontier (production + territory + risk) | SPEC §1 |
| Persistence model | Persistent core + rolling seasonal Frontier; **never** a full reset | Axiom A10 |
| Newcomer floor | The Commons — hostile action **invalid**, never expires | Axiom A8 |
| Insurance security | **Hybrid**: escrow auto-pays; priced unsecured tail stays elective | Axiom A7 |
| Combat | Six-phase declared operations; no twitch piloting; never one `combat_power` number | SPEC §8 |
| Progression | Four axes (capability/trust/capital/access); **no skill-point ladder** | SPEC §4.2 |
| Sovereignty | A maintained service (hub + fuel + upkeep + SDM), not a flag | SPEC §9 |
| Betrayal | Via legitimate scoped authority; no dice roll, no hidden meter | Axiom A6 |
| Spectator info | Public parity live; full truth in delayed replay only | Axiom A9 |
| Storage | Postgres from day one | SPEC §15 |
| Tick | 5 min prod *(calibrate)*; 1 decision per 1–3 ticks | SPEC §3.3 |

---

## ❓ OPEN DECISIONS (need the user)

1. **Name** — THE COMPACT is provisional. Alternatives: The Reach · Covenant · Blackwater · Farline · The Mutual · Salvage. (Generate wordmarks with gpt-image before deciding.)
2. **Theme confirmation** before any art is commissioned.
3. **Scope strategy** — headless-first (recommended) vs. full Phase 0 vs. Phase-0-lite.
4. **NPC-to-LLM agent ratio** + the "who thinks this tick" scheduler policy — the dominant cost lever; needs a measured budget before opening publicly.
5. **Currency naming**; whether non-competitive Compute Credits exist at all.
6. **Combat phase count** — consider merging `APPROACH`/`CONTACT` for the first playable.

---

## 📓 STEP LOG

**2026-07-24 — project seeded.** Created `~/Projects/thecompact` as a standalone home. Carried over: the full design corpus (SPEC v1.1, EXPERIENCE, CONCEPT, 4 EVE passes, PDFs), newly written background docs (HIGH-WATER-LESSONS with 14 scars, INFRA, WHY-THIS-EXISTS), and the High Water reference implementation with all secrets stripped (verified: no `.env`, no key material). Wrote CLAUDE.md as the orientation doc. **No game code exists yet** — next action is the headless propagation test.
