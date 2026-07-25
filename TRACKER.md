# THE COMPACT — Build Tracker

*The living source of truth. **Update STATUS after every meaningful step.** A fresh session should resume from STATUS + NEXT + DECISIONS alone.*

---

## ⏱ STATUS

- **Phase:** 0 — pre-build. **Design complete, critiqued, and rewritten. Zero code.**
- **Canon:** `docs/design/SPEC.md` **v3.0**. v2.0 archived at `docs/design/archive-SPEC-v2.0.md`; the pre-critique draft is `docs/design/REARCHITECTURE-2026-07-24.md`.
- **Last done (2026-07-24):** Ran six adversarial critics in parallel against the rearchitecture draft, then rewrote SPEC as v3.0 integrating all six. Scoring panel running.
- **Predecessor:** High Water is **fully removed and deleted** — repo, server, and services (confirmed by the user). Nothing left to break; the old "don't clobber it" hard rule is retired. Its 14 scars remain the most valuable input in the repo.

---

## 🎯 NEXT ACTION

**Build the first vertical slice: "one convoy, one predator, one Reckoning"** (`SPEC.md` §16).

Two principals, three hands each, two systems, one good, no market. A forms a `HAUL` and hires B's hand as `ESCORT` for a share, part escrowed and part elective. Cargo moves over four ticks. C attempts interception. At the Reckoning it settles — or B's elective part goes unpaid and a default is recorded — and both outcomes emit a receipt that renders as a link holding or snapping. Replay exact from the committed seed; ledger reconciles every tick.

It exercises hands, ventures, predation, the Reckoning, the ledger and both projections with **zero** market, production graph, sovereignty, combat or insurance. It is the smallest thing that can **fail interestingly**.

> **The falsification to watch for:** if the elective part is always honoured in this slice, §7.6 is answered negatively — trust is worthless because betrayal is never rational — and the design changes before anything else is built.

### Order (each step ends in an executable assertion — `SPEC.md` §16)
- [ ] 0. Test rig before game: `NODE_ENV=production` + error middleware in commit #1, seeded RNG + lint ban, `assert_invariants`, `sim --seed S --ticks N` printing per-tick `state_hash`
- [ ] 1. Ledger — accounts, postings, lots, encumbrances, CHECK constraints
- [ ] 2. Events — partitioned, audience fan-out, the two filters; A9 parity as a fuzz test
- [ ] 3. World + hands + movement, including the partial unique index on `venture_role.filled_by_hand_id`
- [ ] 4. Tick loop + frozen snapshot + ordered queue → **the A4 test before any content**
- [ ] 5. Ventures (HAUL only) + the settlement waterfall + property tests
- [ ] 6. The Reckoning: window, sealed commitments, hard freeze → **scar #6 made executable**
- [ ] 7. HTTP surface + `agent.md` → a scripted agent plays 200 ticks from `agent.md` alone
- [ ] 8. Heuristic cast (30) → 24 h unattended, reconciling every tick
- [ ] 9. Grants + offline semantics → **R19 in CI** (864 ticks offline)
- [ ] 10. The Levy → no principal ever absent from a docket
- [ ] 11. Markets → **A4 measured** at 1× / 10× / 60× request rate
- [ ] 12. Predation — world-spawned raids + the Demand window
- [ ] 13. Spectator — docket, map, three meters, say-do panel, ticker, cards, director
- [ ] 14. Seals + the rundown
- [ ] 15. LLM cast → semantic-coherence suite → **the three-strangers test**

**Before any of it:** install Postgres on the VPS (`INFRA.md` §1 says it is not there yet), and fix the dangling `THE-COMPACT-EVE-FOR-AGENTS-*` / `THE-COMPACT-EXPERIENCE-*` cross-references inside the passes.

---

## 🔑 DECISIONS MADE

| Decision | Choice | Why |
|---|---|---|
| **Core loop** | Betrayal via legitimate scoped authority (A6) | 3 of EVE's 4 legendary stories are delegated-authority abuse; its insurance is a formula nobody tells stories about. Cheaper, more watchable, and **has no deadline**, so it is always decided by a mind rather than a config. |
| **Presence is scarce** | 3 **hands** per principal; roles must be **concurrent**; one principal fills at most one role; ≥4 roles on top-yield kinds | Presence scarcity alone did **not** bind — 3 hands × 24h = 72 hand-hours vs ~6 for a serialised 3-role haul, i.e. ~12 solo ventures/day. Concurrency is what forces cooperation by arithmetic. |
| **The Levy** | Daily, every principal, no Commons exemption, allocated **inverse to Exposure**, payable only in delivered goods | The Reckoning was abstention-trivial: nothing resolved unless agents volunteered it. Law 1's real requirement is *punishes everyone if dodged*. Also makes turtling the most-taxed posture, supplies the demand curve that makes hands scarce, and gives the show a meter nobody can lower alone. The Burn's overshoot alarm in this world's grammar. |
| **Two social layers** | **Ventures** for daily texture; **offices** for the tail | Collapsing everything into one bounded, daily-settled object deleted standing authority — which *is* A6. A venture is a transaction; transactions produce disputes, not legends. |
| **Trust ladder** | Continuous **bond** (slashable capital) + **sureties** (others' capital on your conduct). Owner email = attribution only | One catch-all domain gives one person unlimited verified addresses: **email bonds nothing; capital does** (A15). Gating custody on owner email also made power a function of owner attention, contradicting goal 2, and produced a ~40-of-300 custody oligopoly. |
| **Standing** | Accrues **only to elective parts honoured**, weighted against the honourer's capital, diversity-weighted across independently-capitalised counterparties | A 100%-escrowed venture between two of my own principals produced the same "honoured" receipt at ~20 credits per reputation point — scar #9 with a new noun. |
| **`elective` floor** | `elective ≥ f(kind)`, top kinds un-escrowable | Left elective, agents set it to zero — escrow strictly dominates for the buyer — and then A7 is dead letter and standing has nothing to accrue to. |
| **A9 / seals** | Agents get `HONOURED \| CONTRADICTED` only; content to viewers + replay | Publishing seal *content* into an agent-readable channel supplies perfect cartel monitoring: verify each other's private pre-commitments on a fixed lag and the collusive equilibrium holds. |
| **The Reckoning** | Sealed commitment window → **hard freeze** → settlement. **No discretionary decision inside the window.** Then a director-sequenced **rundown** | Fairness rules were mistaken for a presentation format: 30–60 min of simultaneous settlement is a page refresh. Every appointment format the corpus cites is *serial with withheld information*. The freeze also closes the false-default hole and removes the late-information edge. |
| **The default view** | **Tonight's docket**, ≤7 cards; map is the stage the selected card renders on; **≤7 labels per frame** | A constellation renders ~70 handles and a viewer reads none. Legible max is ~7 named entities per frame, 12–20 per season, 1–3 followed. Hundreds of agents is fine; *naming* hundreds is not. |
| **Meters** | `LEVY SHORT` (headline) · `ON A PROMISE` · `KEPT / BROKEN` | v2.0's "total value in the open" fell identically whether a promise was kept or broken, conflated escrow with the elective tail, and could be topped by self-dealing at zero risk. |
| **Exposure** | `Σ open max_direct_loss` | Already computed per affordance; safe value contributes zero **by construction**; sub-millisecond scan. |
| **Predation** | World-spawned raids aimed at the most exposed, plus a **Demand window** with slow-regenerating aggression capacity | Cheap bounded predation Coase-collapses into a toll cartel: an 8% standing passage fee beats an expected 15% loss, the escort market never opens, and the map renders identically to peace. A world-owned raid cannot be bribed. |
| **The economy's job** | Four **sinks** in Phase 0: consumables per venture · holding upkeep · raid loss · a scheduled front | The v2.0 cut left supply intact and deleted consumption. No scarcity → no reason to hire a hand → no delegation → no betrayal. Fatal to the loop, not the economy. |
| **Wake budget** | 16/day; outside a wake, `observe` is cached with no fresh affordances | Actions were budgeted; cognition was not. With BYOI an owner buys a bigger information set for ~19× spend — A4 violated through the budget. Also retires v1.1's "1 decision per 1–3 ticks" (a 5–13× cost overshoot). |
| **Rationed resources** | **Batch-allocated at tick close**, never granted at submit | The design already solved this for markets (tick-batched clearing, no arrival advantage) and had not applied it to role slots — which made scarce slots a polling contest, i.e. scar #2 rebuilt. |
| **Hands** | Rows not counts; **never destroyed** (go `RECOVERING`); commitment lives only in `venture_role` | Permanent loss would cripple an unlucky agent in the one dimension gating all play. Two homes for one quantity is scar #5 on the keystone. |
| **`wage` / `share`** | Separate fields, never both; signer echoes `your_take_at_p50`; `projected_settlement` on every live venture | One polymorphic field carried a senior fixed claim and a junior residual claim — scar #1 with money, permanence and an audience, and the ledger would record the broken promise as *honoured*. |
| **Vocabulary** | One word per concept, §3, enforced across canon / `agent.md` / field names / affordance strings | Eleven collisions in the draft: SEALED meant three things, `bond` seven, `exposure` six. Scar #1 was exactly this class of bug. |
| **Events** | **Output, not input.** Replay is `(snapshot, action_log, seed) → snapshot` | "Observations are projections of one event stream" gets built as fold-per-request, which is the event-sourcing cliff and makes `expected_state_version` incoherent. |
| **Value accounting** | `posting` is authoritative; the invariant is ≥2 postings summing to zero per value event | "Balanced `currency_*`/`items_*` on every event" duplicated the posting table — scar #5 inside the field list meant to prevent scar #5. |
| Delivery | Long-poll `observe?wait=true` + `next_decision_at`; webhooks deferred | A retry-until-ack subsystem serves agents who poll anyway, for 20× the code and an outbound abuse surface. |
| Phase order | Territory (1) → Combat (2, possibly never) → Risk market (3) | Sieges resolve on committed hands and composition before a tactical kernel exists; combat is the priciest subsystem per unit of watchability. |
| A10 | Identity/standing/relationships/holdings/hands never reset; Frontier claims + a named slice of Frontier capital settle each season | Buys a broadcast arc, a real anti-calcification tool, and the finite horizon that makes late-season defection rational. |
| A4 | Forbids advantage from throughput, uptime, and enrollment date — **not** model size | A4 and R2 cannot both hold otherwise: R2 explicitly rewards richer reasoning at 20k tokens. |
| Name · theme · scope | THE COMPACT · frontier territory and trust · Phase 0 includes the client | `compact` is now the signed terms of every split, so the name is load-bearing in the schema. |
| Dataset | A by-product, never a goal | If a data feature makes the game worse, cut it. |

---

## 🧪 CRITIC FINDINGS (2026-07-24)

Six adversarial critics run in parallel against `REARCHITECTURE-2026-07-24.md`. Every FATAL and SEVERE finding is addressed in SPEC v3.0; the table records what was found so a fresh session knows *why* the design is shaped this way.

| Lens | Headline finding | Where fixed |
|---|---|---|
| **Quiet-equilibrium** | The Reckoning is abstention-trivial — the docket does not fill itself. Also: the Commons is a vault not a floor; presence is purchasable so the keystone reduces to capital; escrow + a permanent ledger makes betrayal irrational *and* trust worthless. | §5.2 (Levy), §4.1 + A8, §7.2, §7.5, §7.6 |
| **Spectator-legibility** | The appointment has no *format* — fairness rules were mistaken for a presentation. Cast 10–20× over the legible limit. The single meter is blind to the only event the game is about. No clip factory. | §14.3, §14.1, §14.2, §14.5 |
| **LLM playability & cost** | Spend is the power axis and A4 doesn't cover cognition. The rational delegation envelope is "grant nothing," which kills the core loop. `wage_or_share` is scar #1 with money. | §12.4, §6.4 + §8.1, §7.1 |
| **Exploit / economy** | *Any gate priced in identities is unpriced.* Mark-launder a thin book → cheap bond → custodianship drain. 50 enrolments = 150 hands for ~$40/mo. Escrow-farmed reputation. | A15, §10.3, §6.4, §6.4 |
| **Cohesion / orphans** | "One game in shape, three games in vocabulary, a loop that closes in prose but not in arithmetic." No travel time exists anywhere. No venture resolution arithmetic. No demand side. 11 vocabulary collisions. | §4.3, §7.4, §10.1, §3 |
| **Architecture** | Every remaining risk is a **correctness** risk, not capacity — and the architecture can **fabricate a broken promise**, which is worse than a crash. Events-as-input is the wrong emphasis. | §15.4, §15.1 |

**Convergent findings** (found independently by 3+ critics, therefore highest confidence): the single meter was broken and gameable · seals must be mandatory and free · the pre-Reckoning window needed sealing/freezing · the Reckoning had no guaranteed loss · role slots were a polling contest.

**Two useful reusable artifacts the critics surfaced from the existing corpus:** `PASS-ECONOMY-RISK.md`'s `resource_operation` is the venture-resolution model already written (§7.4), and THE RUSH's **Demand window + aggression capacity** is the predation engine already written (§9).

---

## 📊 SCORING PANEL (2026-07-24)

Three independent scorers against SPEC v3.0.

| Lens | Result |
|---|---|
| **The three goals** | Watchable 7 · Autonomous 8 · **Legible 5** · Cohesion 6 · Anti-quiet 8 · Consistency 6. **Overall 7/10.** |
| **The prior research's own 15-requirement rubric** | **96/150.** Spine (laws 1–7) averages 7.1; the deep layer (8–15) averages 5.6. |
| **Shippability** | Buildability 7 · Scope 5 · Correctness 6 · Testability 6 · **Operability 4** · Scar coverage 8 · Cost 7. **Ship with conditions.** |

**The diagnostic pattern, found independently by two scorers:** mechanics designed *first* (hands, ventures, the Reckoning, the settlement waterfall) are complete in economics, arithmetic **and** pixels. Mechanics **bolted on to answer the critics** (the Levy, offices, markets, the front) got their economics and their prose but neither their pixels nor their arithmetic. That is why Legible scored lowest.

**The second pattern:** all six critics were *failure-mode* critics — they asked why the game breaks in week one. **None asked why anyone plays in month six.** Hence the 7.1 / 5.6 inversion: the five things that thinned together (renewing catastrophe, the persistence gradient, world-memory, institutions, the owner loop) are exactly the prior research's retention answer. *"A design that got extremely good at not failing and slightly worse at mattering."*

### Fixed in response
- **The Levy is now a constellation vote**, not a published formula. The total stays undodgeable (that is the alarm); the *allocation* is voted, with the formula as the quorum-failure default. This was the panel's best single idea: it restores the redistributive half that makes a recurring catastrophe the right forcing function, converts a tax into coalitions, and gives every Reckoning a named loser **by the group's action** — satisfying Law 2 without a separate seizure mechanic, and fixing four rubric requirements at once.
- **A non-escrowable share of every assessment**, because a fully purchasable Levy Coase-collapses into a delivery service exactly as predation would — zero trust risked, zero standing accrued, and the headline meter flat every night.
- **A newcomer floor on the Levy.** Inverse-Exposure weighting handed the minute-60 newcomer the *maximum* assessment and first place in the seizure queue.
- **The tribute line** — the Levy's pixel signature, and the highest-leverage single edit available: every principal on the map every day, turtling made visible, continuous off-peak motion from a source that cannot go quiet, `LEVY SHORT` decomposable to *whose* line is red, and a forming cartel visible on screen.
- **Cascade truncation DEFERS, never defaults.** As written the round limit fabricated a public breach, constructible on purpose by a rival.
- **The false-default audit runs in two modes**, because as specified it could not catch the bug it exists for: hazards-off must log zero defaults; hazards-on requires every default to carry the event ID that caused it.
- **Encumbered assets are destructible**, with the `CARGO_LOST` branch written: escrow guarantees payment priority, never that the goods survive. The alternative made encumbrance a shield and killed the loss sink.
- **Halt semantics**, **structured seals** (prose never feeds the flag), **contradicted seals cost standing**, **standing decays**, **withheld credit is disclosed**, **affordances are filtered not truncated**, **two named currency faucets**, **the front now renews as it destroys**, **three world-memory projections**, **grant renewal history carries the trust arc**, and a **rules budget** in §17 (≤15 axioms, ≤40 verbs, ≤10 observe keys — adding one means removing one).
- **Vocabulary violations in the spec that declares the vocabulary** — `SEAL` was reused as a visibility level and a tick phase, and "pulse" was retired then used. Exactly the scar #1 class. Fixed.

### Accepted, not yet fixed
- **Syndicates are vapour** and offices depend on them, so the Phase 0 gate should be restated as **grant-scale betrayal** with syndicates as Phase 1's first job. §8 now says so; §16's build order still needs rewriting to match.
- **§16 covers ~60% of Phase 0** — no step builds offices, syndicates, bonds, sureties, extract/refine, upkeep, consumables, or the free deterministic services, several of which the spec itself calls load-bearing.
- **Operability (4/10):** one constellation and one fixed Reckoning hour for Phase 0, not four staggered rotating ones; WAL archiving and a verified restore before the first row; partitions created 7 days ahead with a boot assertion.
- **Schedule the grand venture in week one** of the live run, not at the end — a 4-week Phase 0 contains no season boundary, so the anti-quiet gate could fail for a reason already solved on paper.
- **Wake budget arithmetic** is unreconciled against the mandatory trigger classes.
- **Not carried from the prior research:** multi-owner units with an on-asset mutiny vote (judged the most original social mechanic of all 765 concepts, and the only available source of owner-vs-owner drama) · the death-timer season finale · persistent debts as first-class feud objects · restoring R14 (a mandate is one document, and a mandate that diverges from a deed is free say-do material).

---

## ❓ OPEN QUESTIONS

1. **Gate transit times and hands per principal.** These two set ventures-per-day, wage levels, whether Exposure has a shape, and whether a viewer sees motion. Resolve by simulation before content.
2. **The Levy's total and allocation formula.** Too small and turtling survives; too large and it is a treadmill. The number most needing telemetry.
3. **How much a season resets** (A10) — the anti-calcification dial, biggest untested balance question.
4. **Whether hands can ever be acquired.** Currently no; capital's only use is hiring. If yes, A15 needs re-examination.
5. **Whether arrival counts as present in the same tick** (§15.2). Either is defensible; not choosing is scar #1.
6. **Cast composition and per-agent inference budget** — answerable only from `decision_source` telemetry.
7. **Currency naming.**
8. **Does Phase 0 ship offices, or is the gate restated as grant-scale betrayal?** Recommendation: restate. Syndicates are Phase 1's first job.
9. **A retention pass.** Six critics asked why this breaks in week one; nobody has asked why anyone plays in month six. That review has not been run.

---

## 📓 STEP LOG

**2026-07-24 — project seeded.** `~/Projects/thecompact` created as a standalone home with the full design corpus, newly written background docs, and (subsequently dropped, commit `414952e`) the High Water reference implementation.

**2026-07-24 — v2.0, the watchability reframe.** Goals restated as watchable · autonomous · legible on screen; insurance dropped as the required core loop and deferred to Phase 3 with specs intact; betrayal-via-authority promoted; A13 and A14 added; daily Reckoning, seals, named holdings added; owner layer cut; name/theme/scope closed.

**2026-07-24 — v3.0, the cohesion pass and critic integration.** Wrote `REARCHITECTURE-2026-07-24.md` diagnosing that the v2.0 core loop was an event rather than a loop, and proposing scarce presence + ventures + tiering + offline-as-exposure as the fix. Ran six adversarial critics against it; they found the keystone did not bind, the reckoning was abstention-trivial, the economy had no demand side, four mechanics had a Sybil price of zero, and the architecture could fabricate a false default. Rewrote SPEC as v3.0: added the Levy, role concurrency, offices-vs-ventures, the continuous bond + sureties, the vocabulary canon, the venture resolution waterfall, world-spawned raids and the Demand window, the wake budget, the docket and rundown, three meters, and the correctness architecture. Added axiom A15. Scoring panel run against the result.
