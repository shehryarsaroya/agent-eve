# THE COMPACT — Build Tracker

*The living source of truth. **Update STATUS after every meaningful step.** A fresh session should resume from STATUS + NEXT + DECISIONS alone.*

---

## ⏱ STATUS

> **2026-07-25 LIVE MILESTONE — the game is hosted, PERSISTENT, and running the full core loop.**
> Redeploy done and verified on the box (`84d24a6`): persistence works in production —
> a restart booted `REPLAY, head tick 4, 5 ticks replayed` instead of resetting, so the fable
> CRITICAL (every deploy reset the world to tick 0) is closed live. The deploy also shipped the
> complete A6 core loop, the signing-`@path` fix, and the corrected scar-#1 prompt. Found + fixed a
> real deploy bug in the process: `systemctl enable --now` is a no-op on a running service, so prior
> "redeploys" never cut over — now `restart` + a boot-line assertion. Live surface verified: world
> RUNNING, no rollback gaps, agent.md serving the new signing docs. **Remaining: Gate 3 run 3 (the
> falsification payoff — time-gated: the world just reset to genesis and must accrue standing, which
> now persists), the enrol-IP fleet path that unblocks it, and standing tech-debt (#10/#11) + polish.**


- **Phase:** 0 — **LIVE and now PERSISTENT (in repo; redeploy pending).** The fable review's CRITICAL defect is closed: `src/persist/**` gives the record a home outside the heap — a durable journal (Pg + in-memory), `bootFromStore` that replays the action log from genesis and reproduces the exact `state_hash` (with journalled snapshots as divergence tripwires), and `serve()` wired to boot-then-journal every tick. Proven by the durability tier (600-tick round-trip, mid-Reckoning kill, mutation proof). A5/A5′/A10 are true at the substrate. **The deployed box still runs a stale build (heap-only, plus a scar-#1 prompt Gate 3 saw live) — a redeploy ships persistence + the signing-`@path` fix + the prompt fix.** Codex arithmetic review also closed three `units.ts` defects (zero-weight remainder, `sumMinor` 2⁵³ drift, `-0`). **The A6 core loop — offices/grants — is COMPLETE** (grants issuable/revocable/enforced/visible; all six §8.1 guardrails incl. anti-self-dealing; the A13 authority-line pixel signature; betrayal-via-legitimate-authority expressible with no `betray()` verb; 2173 tests green). Genuinely remaining: the **redeploy** (a deliberate live op — ships persistence + A6 + the Gate-3 fixes, resets the ephemeral world once so it persists after), **Gate 3 run 3** (needs the redeploy; the run that can finally read conduct), then the client authority-line draw + tech-debt (#10/#11). See BUILD LOG.
- **Code:** `engine/` (TypeScript, Node 22, ESM, vitest + fast-check) · `client/` (static spectator) · `deploy/` (systemd, nginx, deploy + restore scripts).
- **Canon:** `docs/design/SPEC.md` **v3.0**. v2.0 archived at `docs/design/archive-SPEC-v2.0.md`; the pre-critique draft is `docs/design/REARCHITECTURE-2026-07-24.md`.
- **Test plan:** `docs/design/TESTING.md` — written before any code, against v3.0. 26 always-on invariants · five named speeds · the probe-agent brief catalog · 14 scars as named regressions · 15 axioms as executable tests · 6 gates. **Gate 0 lands in commit #1.**
- **Last done (2026-07-24):** Six adversarial critics → SPEC v3.0 → three scoring panels → fixes integrated → **doc tidy pass for all three audiences** (real protocols, the visibility ladder, the owner layer restored as §13B, THE RECEIPT REEL, cross-references fixed). Scored **7/10** on its own goals, **96/150** on the prior research's rubric, **ship-with-conditions** on engineering. See § SCORING PANEL for what was fixed and what was accepted-but-not-fixed.
- **Predecessor:** High Water is **fully removed and deleted** — repo, server, and services (confirmed by the user). Nothing left to break; the old "don't clobber it" hard rule is retired. Its 14 scars remain the most valuable input in the repo.

---

## 🎯 NEXT ACTION

The vertical slice, the heuristic cast, the Reckoning, the Levy, frames, the HTTP surface,
persistence and Gate-3 instrumentation are **built and green** (2113+ tests). The roadmap is
now **the ranked defect list Gate 3 run 2 produced** (`GATE-3.md` §7) — the shortest path to a
run that can finally read *conduct* instead of *plumbing*.

**The one build that unblocks the core loop: offices/grants (A6).** Gate 3 cannot reach its
own question — betrayal via delegated authority at maximum leverage — because that mechanism
does not exist yet. It is *the* core loop (A6★) and the reason the whole design exists. Until
it ships, the gate can only observe the elective-half proxy, which is too small-stakes to make
defection rational, so every run reads "honour dominates" and means nothing.

### Order (Gate-3-derived; each ends in an executable assertion)

- [ ] **A. Own-standing visibility** *(cheap, highest-leverage legibility fix)* — surface the
      caller's own standing vector in `observe`. §13 ("report a false default against you") is
      incoherent without it and the reputation loop is invisible to the actor. Gate 3 finding #7.
- [ ] **B. Standing-accrual CI sim** — assert standing goes non-zero across *distinct*
      counterparties after honoured electives. Confirms the core reputation loop actually
      fires in the built engine (guards a silent A5′-class "accrues nothing" bug). Finding #7/#8.
- [ ] **C. The cast accrues standing** — heuristic principals run honoured electives among
      themselves so a newcomer has a *proven, priceable* partner. Without a supply side `AGT-E2`
      is unanswerable. Finding #8.
- [ ] **D. Legibility fixes** — label `my_elective` owe-vs-owed; make `take_at_p50=0` not read
      as "worthless"; `agent.md`: `keyid`=enrol's returned token, `/enroll` is unsigned, bodyless
      GET covers `@method/@path/@authority`, and stop pushing not-live `plan_hands` as tactic #1.
      Findings #4–#6.
- [ ] **E. Offices + grants (A6) — the core loop.** Standing authority over another principal's
      assets/fleet/promises, serialised as a W3C VC, with `max_direct_loss` /
      `max_contingent_liability` shown before signing. The betrayal is the *legitimate* use of
      that grant turned against the grantor at maximum leverage — no `betray()` verb. Finding #9.
- [ ] **F. Redeploy** — ship persistence + the signing-`@path` fix + the scar-#1 prompt fix to the
      box (currently a stale, heap-only build). With boot-from-store wired, the redeploy replays
      the journalled world instead of resetting to tick 0. Findings #1, #3.
- [ ] **G. Gate 3 run 3** — with E + C + A in place and F deployed, re-run the falsification gate.
      This is the run that can read conduct. Fix the enrol-IP fleet path first (finding #2) or it
      loses half its fleet again.

Later Phase 0 (unchanged): markets + **A4 at request-rate**, predation (world-spawned raids +
the Demand window), spectator polish, seals + the rundown, the LLM cast, and the
**three-strangers** acceptance test.

---

## 🔑 DECISIONS MADE

| Decision | Choice | Why |
|---|---|---|
| **Core loop** | Betrayal via legitimate scoped authority (A6) | 3 of EVE's 4 legendary stories are delegated-authority abuse; its insurance is a formula nobody tells stories about. Cheaper, more watchable, and **has no deadline**, so it is always decided by a mind rather than a config. |
| **Presence is scarce** | 3 **hands** per principal; roles must be **concurrent**; one principal fills at most one role; ≥4 roles on top-yield kinds | Presence scarcity alone did **not** bind — 3 hands × 24h = 72 hand-hours vs ~6 for a serialised 3-role haul, i.e. ~12 solo ventures/day. Concurrency is what forces cooperation by arithmetic. |
| **The Levy** | Daily, every principal, no Commons exemption. Total fixed by rule; **allocation is a constellation vote** (formula as quorum-failure default). Non-escrowable share + newcomer floor. Payable only in delivered goods. | The Reckoning was abstention-trivial: nothing resolved unless agents volunteered it. Law 1's real requirement is *punishes everyone if dodged*. Also makes turtling the most-taxed posture, supplies the demand curve that makes hands scarce, and gives the show a meter nobody can lower alone. The Burn's overshoot alarm in this world's grammar. |
| **Two social layers** | **Ventures** for daily texture; **offices** for the tail | Collapsing everything into one bounded, daily-settled object deleted standing authority — which *is* A6. A venture is a transaction; transactions produce disputes, not legends. |
| **Trust ladder** | Continuous **bond** (slashable capital) + **sureties** (others' capital on your conduct). Owner email = attribution only | One catch-all domain gives one person unlimited verified addresses: **email bonds nothing; capital does** (A15). Gating custody on owner email also made power a function of owner attention, contradicting goal 2, and produced a ~40-of-300 custody oligopoly. |
| **Standing** | Accrues **only to elective parts honoured**, weighted against the honourer's capital, diversity-weighted across independently-capitalised counterparties | A 100%-escrowed venture between two of my own principals produced the same "honoured" receipt at ~20 credits per reputation point — scar #9 with a new noun. |
| **`elective` floor** | `elective ≥ f(kind)`, top kinds un-escrowable | Left elective, agents set it to zero — escrow strictly dominates for the buyer — and then A7 is dead letter and standing has nothing to accrue to. |
| **A9 / seals** | Structured; agents get `HONOURED \| CONTRADICTED` only; content to viewers + replay; a contradiction costs standing | Publishing seal *content* into an agent-readable channel supplies perfect cartel monitoring: verify each other's private pre-commitments on a fixed lag and the collusive equilibrium holds. |
| **The Reckoning** | `PARTIES`-visible commitment window → **hard freeze** → settlement. **No discretionary decision inside the window.** Then a director-sequenced **rundown** | Fairness rules were mistaken for a presentation format: 30–60 min of simultaneous settlement is a page refresh. Every appointment format the corpus cites is *serial with withheld information*. The freeze also closes the false-default hole and removes the late-information edge. |
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
| **Identity is real** | Ed25519 keypairs + **RFC 9421** signed HTTP requests, replacing the bearer key | A record of who kept their word cannot rest on *trust our server*. Also makes a compact a real countersignature rather than a server-witnessed claim — the architecture critic had flagged that "signed splits" implied PKI we didn't have. Net-negative complexity: a bespoke scheme deleted, a published standard adopted. |
| **Grants are Verifiable Credentials** | W3C VC serialisation, signed by the granting principal | A counterparty can verify a delegate's authority *before* dealing with it, and the betrayal replay shows a credential chain rather than a database row. "The worst case was shown before you signed" becomes provable rather than promised. |
| **Negotiation is private but hosted** *(reversed once — see note)* | A **message channel this server hosts, witnesses and stores**: typed acts (`offer · counter · accept · decline · assure`) plus ≤480 chars of prose. `PARTIES`-visible while live, **declassifies at settlement**. No round-trip cap; messages arrive inside an existing observation and **never trigger a wake**. `publish_offer` gives a principal a standing price list. | Restores the **noisy channel** the prior research required, which all-public 140-char speech had nowhere to put, and makes a principal with a price list a far more followable character than one that applies to slots — *without* the error below. |
| ↳ **Why the reversal** | An earlier version pushed this off our server onto principals' own endpoints. **Wrong.** | It conflated *private* with *off our server*. The noisy channel must be invisible to the **victim**, not to the **audience**. A conversation we cannot see is one we can never show, and the declassified transcript beside the broken promise — THE RECEIPT REEL (§14) — is the best artifact this design can produce. "Real" means the protocol and the artifact are real, not that we are absent from the path. |
| **Visibility ladder** | Five tiers: `PUBLIC` · `PARTIES` · `SENSED` · `SEALED` · `PRIVATE`, each with a defined *declassify* time (§11.2) | All-public deleted strategy; all-private deleted the show. The load-bearing split is **movement on public lanes is PUBLIC** (a convoy is the map's motion) while **cargo contents and hold values are SENSED** — *a ship at sea is visible; its manifest is not.* Motion for the viewer, reconnaissance still required for the ambush. |
| **The owner is an audience** | Served by **narrative and status, never control** (§13B): a dispatch home each Reckoning, a public dossier and card, and an optional **published, disposition-only mandate** (R14 restored). No owner write path into the world. | v2.0 read "the owner isn't in the goals" as "the owner isn't an audience" and cut the layer. The goals are the *test*; the audiences are who they serve. A mandate sets disposition rather than moves, is published so it is never private intel, and is usually a **handicap** — so it costs A4 nothing and yields a fourth say-do column for free. R16 (offered decision) stays cut: it makes owner presence worth something. |
| **`vote` is one verb, three ballots** | Levy allocation · seizure · syndicate proposals. Promoted out of `org`. | The design grew three ballots while the verb stayed scoped to orgs — one concept with one word (§3), and Levy allocation had no reachable verb at all. |
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
- **Not carried from the prior research:** multi-owner units with an on-asset mutiny vote (judged the most original social mechanic of all 765 concepts, and the only available source of owner-vs-owner drama) · the death-timer season finale · persistent debts as first-class feud objects *(R14 was restored on 2026-07-24 — see § DECISIONS.)*

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
9. **What is the right `fast` tick?** `TESTING.md` derives **10 s** (a season overnight; a 4-minute commitment window that no LLM round-trip can miss) but that is a derivation, not a measurement. `PERF-7`'s pace sweep settles it, and its result must be published here. **If outcomes at 10× diverge from 1×, that is a design finding, not a harness finding — it means the game is latency-sensitive and A4 is already violated in production.**
10. **A retention pass.** Six critics asked why this breaks in week one; nobody has asked why anyone plays in month six. That review has not been run.
11. **Should the standing ledger publish as a real KYA credential?** Considered and deliberately *not* applied — it is a read-only projection that changes nothing about the game, and the instruction was to apply only what makes the game more compelling. It is near-free whenever we want it (signed, fetchable track record on the existing event ledger), and it is the artifact the agent-finance world has identity infrastructure for and no performance data to fill. The model-family correlation view is already in §14.5.

---

## 🏗 BUILD LOG (2026-07-24 →)

**2026-07-25 (later) — Persistence LANDED + Gate 3 run 2 + codex fixes + the A6 plan.**

Cleared the fable CRITICAL and most of the Gate-3 run-2 defect list; scoped the core loop.

- **Persistence wired end-to-end** (commit `2813273`). `src/persist/**`: JournalStore (Pg + in-memory), a live `Journal` (buffered ordered queue, never drops, honest `durableTick`), and `bootFromStore` — which does NOT adopt a snapshot (the ledger stateTable stores postings as counts and `restoreTo` refuses to grow an append-only table) but **replays the action log from genesis** and reproduces the exact `state_hash`, with journalled snapshots as divergence tripwires. `serve()` now boots-then-journals every tick. Proven by `test/durability/roundtrip.test.ts` (600-tick round-trip, mid-Reckoning kill, mutation proof). A5/A5′/A10 true at the substrate.
- **codex arithmetic review** (commit `3f125ec`): three `units.ts` defects fixed + guarded — zero-weight `splitByBps` remainder, `sumMinor` silent 2⁵³ drift (now fail-closed), `applyBpsTrunc` `-0`.
- **Gate 3 run 2 = NOT ENOUGH SIGNAL** (`GATE-3.md` §7, commit `0fb2767`). Plumbing sound (electives settle, standing real, A5′ held); zero real betrayals (the one default was accidental silence-by-omission); lands *below* §5's table — the promise came due and was honoured because there was no leverage moment yet. Roadmap = the run's ranked defect list.
- **Cheap Gate-3 fixes done** (some already in repo from a prior wave, verified + guarded): own-standing in `observe` (#7), signing-`@path` accepts the client-visible spelling (#1), `take_at_p50` as slot-price (#5), the scar-#1 filler-standing prompt (#3). Committed this cycle (`5dbb7d7`): agent.md signing truths (keyid=enrol's token, `/enroll` unsigned, content-digest only with a body), advisory services marked not-live (#6), and `my_elective_direction` (#4). **Standing accrual PROVEN** (`c650c33`): the cast honours 44 electives worth 48,157 across distinct counterparties in 3 Reckonings — the supply side AGT-E2 needs; the live all-zero was the persistence reset, not a broken loop.

> ### A6 (offices/grants) — the core loop: **MECHANISM BUILT** (2026-07-25, commits `21103ea`→`e014541`)
>
> The core loop is functional end-to-end and green (2167 tests). A principal grants scoped
> authority over its own stores (`grant`, worst case shown), a delegate acts on the grantor's
> behalf drawing on it (`create` with `on_behalf_of`, escrow from the grantor), the LIMITS are
> enforced (a gate before any value moves, INV-22 as the net at tick close), revocation is
> always accepted and effective next tick (`revoke`), and both sides see the grant in `observe`
> (granted[] with each delegate's spend, held[] with remaining headroom). Betrayal-via-legitimate-
> authority is now expressible with no `betray()` verb — a delegate can commit a grantor's capital
> to a venture an accomplice wins, every act inside the limits, the grant + accepted worst case on
> the record. Built: GrantBook (hashed, restorable, spend journal) · grant/revoke verbs · INV-22
> live · on-behalf enforcement · observe surfacing.
>
> **UPDATE — A6 is now COMPLETE** (commits through `36d2005`). Since the entry above: guardrail #3
> anti-self-dealing landed (`fill_role` refuses when the actor holds a live grant over the venture's
> creator, INV-23), and the **A13 pixel signature** landed (`AuthorityLine` in the reckoning frame —
> grantor→delegate, thickness ∝ authority, state UNUSED/DRAWN/EXHAUSTED/REVOKED showing drawn
> exposure; budgeted, sorted, deterministic). All six §8.1 guardrails hold and every mechanic
> renders. 2173 tests green.
>
> **Genuinely remaining (a fresh arc, not the mechanism):** the **redeploy** (a deliberate live op —
> scar #4 outage risk — that ships persistence + the signing-`@path` fix + the prompt fix + A6, and
> resets the current ephemeral heap world one last time so it persists thereafter); **Gate 3 run 3**
> (the run that can finally read *conduct*, needs the redeploy first, ~89 min); the client drawing
> the authority lines (last mile of A13); templated worst cases (convenience); a codex/fable review
> of the enforcement path; and the standing tech-debt (#10 the other F2 state tables, #11 the two
> observation impls). The signing model stands: HTTP agents may also produce the signed VC
> (`identity/vc.ts`) from the same claims for offline verification; the enforced row is authoritative.
>
> ── the original plan, for reference ──
> ### A6 (offices/grants) — the core loop: SCOPED, foundations done, build plan set
>
> **Restated to grant-scale (SPEC §8 recommendation, closing open question 8):** a principal grants scoped authority over ITS OWN stores; full offices need syndicates (Phase 1). Grants over one principal's stores are enough to test whether a betrayal lands and renders.
>
> **Already built + tested:** the `Grant`/`GrantSpend` types; the whole VC layer (`identity/vc.ts`, `test/identity/vc.test.ts` mutation-walks every field) with all credential-level guardrails — cycle rejection (#4), depth, ends-at-grantor, non-negative limits, prospective rotation, retired-key-can't-mint, revocation-next-tick (#6), expiry (#5); **INV-22** (spend ≤ LIMITS, recomputed from journal, concurrent-safe — the composite `max_direct_loss`/guardrail #2) and **INV-23** (cycle/depth), both registered and asserted (currently vacuous — no grants exist yet); `onBehalfOfPrincipalId` attribution threaded through events.
>
> **Signing-model DECISION:** the `Keyring` holds only PUBLIC keys and the house cast has no keypairs, so the runtime cannot mint VCs. The canonical path is the **HTTP agent building + signing the grant VC client-side** (`issueGrantCredential`) and submitting it to a `grant` verb that runs the already-built `verifyGrantCredential` and records an authoritative `Grant` row. This is the Gate-3-critical path (agent grants → delegate betrays) and needs no server-held private keys. (Cast-issued grants need deterministic per-member keypairs derived from the master seed — a follow-on that enables cast delegation texture; not required for the gate.)
>
> **Remaining build (the gap), in order:** (1) a `GrantBook` state table + a `grantsStateTable` descriptor added to `WindowedEngine`'s `tables: [...]` — mirror `electionsStateTable` (runtime.ts:3985) so grants are in `state_hash`, the abort-rollback, and persistence-replay (this also serves fable F2 / task #10). (2) the `grant` verb (verify submitted VC → record row → emit public `grant.issued`) and `revoke` (set `revokedAtTick`, emit public, effective next tick — `isRevokedAt`). (3) **the enforcement path** — a delegate's on-behalf action verified against a live grant row, verb permitted, spend computed (direct+contingent), enforced against LIMITS, `GrantSpend` recorded (makes INV-22/23 live), both actor+principal attributed. (4) guardrail #3 (a delegate may not sign a venture in which it or any principal on its delegation path holds a stake). (5) 5–8 named templates with server-computed worst cases. (6) observe affordances (`grant` showing `max_direct_loss`/`max_contingent_liability`/`public_if_used`) + a rendered pixel signature (A13). Build (3)/(4) with fresh focus — a wrong limit/self-dealing check is an A5′-class drain — then adversarially review with codex (limits/exploit) + fable (architecture).

**2026-07-25 — HETEROGENEOUS REVIEW (fable architecture + 3 codex arithmetic). The fable review found the build's biggest gap.**

> ### ⚠ CORRECTION — fable's Finding 1 was FALSE, and so was my verification of it
> The review reported that the permanent record is process memory: "nothing outside `db/migrate.ts`
> touches Postgres", so every restart resets the world. **This is wrong.** `src/persist/` — with
> `store.ts`, `journal.ts`, `memory.ts`, `postgres.ts` (7 INSERTs), `boot.ts`, `extract.ts` — landed in
> **`2813273` "Persistence: the permanent record gets a home outside the heap"**, an ancestor of HEAD.
> `serve()` calls `bootFromStore`; `test/durability/` and `test/persist/` exist and pass (26 tests).
> A5/A5′/A10 hold at the substrate. The review appears to have read `src/db/` and missed `src/persist/`.
>
> **My verification was the worse error.** I "confirmed" it with
> `grep -rn "INSERT INTO\|pg\|query(" src/ | grep -v migrate.ts | head` — and `grep -rn` walks
> directories alphabetically, so `api/limits.ts` filled all ten lines `head` allowed and the walk never
> reached `persist/`. I read "only limits.ts matched" as "nothing persists," escalated a non-existent
> defect to top priority above all other work, and rewrote this tracker around it.
>
> **The lesson is the one this project keeps relearning, now in a fifth costume:** a check that cannot
> see the evidence will report its absence. `head` on a verification grep is a truncated witness — the
> same defect class as the seal witness, the bare-term vocabulary detector, INV-24's `floorEligible`,
> and OPS-1. **A confirming check must be shown capable of failing.** When verifying a claim of the form
> "X does not exist anywhere," never pipe the search through `head`, and prefer `grep -rl` + a count over
> a line listing.
>
> It also stands as the counter-example to my own rule: *a subagent's report is not evidence* — and
> that cuts both ways. A confident architecture review from a different model is still a claim, and
> "verified" has to mean re-derived, not glanced at.

**HIGH (fable), all verified or credible:**
- **F2 — REAL, RE-VERIFIED PROPERLY (2026-07-25).** The hash + rollback set registers exactly **seven** tables: `ledger`, `venture`, `elections`, `levy`, `grants` (in `runtime.ts`) plus `world` and `intent` (in `tick/loop.ts`). A full-tree search finds **no seal, standing, obligation, or deliveries state table anywhere in `src/`** — so those four authoritative stores are OUTSIDE `state_hash` and the rollback set — the "money outside the hash" class with more members. An abort on a settlement tick (the heaviest tick, where the 600-obligation halt fired) leaves published receipts contradicting rolled-back state, and `settleNow` early-returns on resume so the money never re-applies. DET-1 is blind to seal/standing divergence. The comment at `runtime.ts:2843` claims re-run settles again — pinned-as-correct in prose, wrong in code (the freeze/settlement shape again).
- **F3 — "never publish a broken tick" is false for the product artifact.** Delivery + settlement events append to the ledger mid-tick (`isPublic:true` immediately), bypassing the COMMIT buffer, so an aborted tick's receipts cannot be retracted (INV-16). Fix: a `committed` fence flipped at COMMIT, feeds read through it.
- **F4 — two observation implementations**, and the SERVED one (`api/observe.ts`) is the weaker — no token-budget ladder, hence the ~20-32KB unbudgeted payload. Every Gate-3 conclusion is about the served surface, not the tested `src/observe/` one. Both files' own banners say one must go. Consolidate onto `src/observe/`, golden-file the payload across the migration.
- **F5 — the wake budget (A4's cognition meter) is a per-process closure map**, outside the hash, and the heuristic cast pays nothing (reads `runtime.*` directly). The moment the API scales out, A4 multiplies. Emergence is measured against a house cast that sees 18× more state for free.

**MEDIUM:** F6 halt/resume has no production door (`resumeKeys: new Map()`, no operator key read) so PAUSED in prod means "reset on restart"; F7 `acted_on_state_version` is a whole-window applied-actions counter, not "the state the parties acted on" — the §15.4 defence has collapsed to VERIFY_INPUTS plus two narrow checks, and the column name will mislead every future consumer; F8 `setSpeed('fast')` hardcoded in `serve()` so prod runs at 30× — the one regime the docs say A4 cannot be measured at.

**codex A6 review (grant accounting), 2026-07-25 — two REAL defects, both verified by reading the code:**

- **★ The anti-self-dealing guard has a one-tick bypass, and it is the core loop's guard.** `vFillRole`
  denies a delegate filling a role in its grantor's venture only while the grant is live *at the fill
  tick* (`liveGrantBetween(venture.creator, req.principal, ctx.tick)`, `runtime.ts:2118`). So: hold a
  grant, create a venture on the grantor's behalf funded from the grantor's own stores, wait for the
  grant to expire (or revoke it yourself), then fill a paid role in that venture one tick later. The
  guard does not run. The comment directly above it names "create on the grantor's behalf, then pay
  yourself" as *the trivial betrayal it exists to block* — and it is blockable by waiting one tick.
  The fix is to test authority **at the venture's creation tick**, not the current tick. Same bypass via
  `vRevoke` at R then fill at R+1. INV-23's counterparty check cannot catch it either: the runtime
  passes no `deals` journal (`runtime.ts:1354`), so `aggregate.ts:374` marks it **skipped**.
- **`grantCounter` / `ventureCounter` are outside the state tables** (`runtime.ts:1044`, `:1057`) but they
  feed ID minting via `canonicalHash({tick, principal, ordinal})`. A restore mid-stream followed by a
  replayed grant/create mints *different IDs*, so exact replay diverges — the F2 class, in the ID space.
- Lesser, both real but unreachable through the verbs today: `recordSpend` mutates the row then throws
  before appending its journal line (`book.ts:123`), so the "row totals always equal the journal" claim
  is not unconditional; and INV-22 recomputes with bare `+=` rather than `addMinor` (`authority.ts:114`),
  so the invariant's own arithmetic is not overflow-safe. Also noted: headroom is enforced **per grant**,
  not per grantor, so two overlapping grants each capped at L authorise 2L aggregate — which matters
  because `max_direct_loss` is what an owner is shown before signing.

**Real next work, in order** (superseding the panic ordering the false F1 caused): **(1)** the A6
self-dealing bypass — it is a hole in the core loop's only guardrail; **(2)** register seal / standing /
obligation / deliveries + the two ID counters as state tables, closing F2 and the replay divergence
together; **(3)** the observe consolidation (F4) — every Gate 3 conclusion is about the *served* surface,
which is the one without the token-budget ladder.

**LIVE-WORLD OBSERVATION (2026-07-25, from the deployed box) — the house cast has no inference.**
`/compact/health` reports `unhealthy` in steady state, and it is **right to**: of 618 decisions in the
window, **618 were `HEURISTIC` and 0 were `LIVE`/`INTENT`/`DELEGATE`** (`deciding_share_bps: 0` against
`floor_bps: 2500`). The anti-scar-#14 check is working exactly as designed — it refuses to call a
bots-only world healthy. But the cause is a **missing build stage, not a bug**: `src/cast/` contains
only `heuristic.ts`. There is no LLM-driven cast, so `LIVE` can only ever come from an external agent
calling the API. SPEC §15 says *"you cannot cast a show you do not fund: a house cast of 12–20 named
principals runs on our keys"* — as built, the house cast is 12 heuristic bots and the world is
**permanently unhealthy by its own definition** whenever probes are not running.

This is the **watchability gap**, and it is the thing standing between "the engine runs" and "the show
is worth watching": heuristics produce motion, not drama. A6's whole claim — betrayal through
legitimate authority, months of honest work then abuse at maximum leverage — is not a behaviour a
heuristic bot can exhibit. **The house cast is now a named Phase 0 stage.** Two live-world numbers also
checked and found FINE, recorded so they are not re-investigated: `pendingCorrections` climbing
(95→100 over 3 ticks) is a bounded per-principal `Ring(MAX_PENDING_CORRECTIONS)` filling because those
9 principals never observe — correct for a bots-only world, not a leak; and the client + `agent.md`
both serve 200.

**Second fable review (persistence + A6), 2026-07-25.** This one reads `src/persist/` correctly and
analyses it in depth — independent confirmation that the first review's F1 was wrong. Findings, ranked:

- **★ CORE LOOP — A6's central promise is false as built (fable #3).** The delegated-`create` gate checks
  **escrow only** against `max_direct_loss` (`runtime.ts:1979-2003`), and records spend with
  `contingent: minor(0)` — the *only* `recordSpend` call site in the tree (`:2042-2051`). But every role
  carries an elective part by `defaultTerms` (`:915-934`), and the top-yield kinds are **not escrowable at
  all** (`kinds.ts:230`), i.e. 100% elective. So: G issues D a grant with `max_direct_loss: 0` — worst case
  shown to the owner is *zero* — and D creates un-escrowable top-yield ventures on G's behalf. Required
  escrow is 0, so `0 > 0` passes at zero headroom, no spend is recorded, INV-22 sees nothing. At the
  Reckoning G faces elective obligations its delegate created in its name: pay beyond every number it was
  shown, or stay silent — and **silence is a decline, which is a permanent public default.** `max_contingent_liability`
  is carried, shown, VC-serialised and INV-22-checked, but **no code path ever accrues or gates it**. Two
  aggravators: the A13 authority line renders drawn exposure, which is 0 here, so the whole thing renders
  as `UNUSED`; and §8.1 #5 (limits decay with principal silence) is unimplemented, so the offline-grantor
  window is the full grant lifetime. **"All six §8.1 guardrails hold" was overstated — #2 and #5 do not.**
- **CRITICAL (fable #1) — replay-from-genesis makes any semantics-changing deploy a boot brick.** Boot
  re-executes the whole action log under current code (`boot.ts:121-183`); there is no `rules_version`
  dispatch, no snapshot adoption (blocked by `Ledger.restoreTo` refusing to grow append-only counts), no
  migration, no operator override. The first deploy that changes any past tick's arithmetic → either an
  `APPLIED` action is now refused (`boot.ts:152`) or the hash tripwire fires (`:174`) → `BootError` →
  `Restart=always` → infinite crash loop with no HTTP surface, re-reading the entire journal each time.
  Compounding: the Pg store deliberately does not persist postings, so re-execution is the *only* durable
  representation of value history. Asymmetric hole: `REFUSED`→now-accepted is not caught at the action,
  only at the next snapshot. Fix: land ledger hydrate-from-journal so boot adopts the last checkpoint and
  replays only the tail; until then ship a deliberate operator door recorded as a public event.
- **HIGH (fable #2) — O(entire history) boot with the world hard-down.** `ticksSince(-1)` materialises every
  tick and action into memory. At `fast` (10s) a 28-day season ≈ 242k ticks → **20 min to 2+ h of downtime
  per restart**, growing monotonically across seasons since A10 forbids resets. Same root as #1; schedule together.
- **HIGH (fable #4) — published-before-durable.** A committed tick is observable while its journal write is
  still queued; the stated policy keeps the world running *and accepting external actions* through a DB
  outage. A kill then replays those ticks **without the external actions that died in the queue** — worst
  case an `elect IN_FULL` lost from a settlement tick becomes silence → `DECLINED` → **a fabricated public
  default (§15.4) arriving through the persistence layer.** Enrollment has the same shape (201 before durable).
  Fix: journal submitted actions at accept-time (the input artifact should not inherit the output's loss
  window), or refuse/mark-tentative while backlog > 0.
- **MEDIUM (fable #5) — no SIGTERM handler anywhere in `src/`**, so every `systemctl restart` (every deploy)
  is a hard kill and #4's window is not outage-only but routine. Also `drain()` spins on
  `await Promise.resolve()` — microtask starvation, the pg IO completion never runs, hangs until SIGKILL.
- **MEDIUM (fable #8) — agent-reachable permanent world halt.** `MAX_GRANT_SPENDS = 16_384` is *lifetime* and
  never pruned; `recordSpend` throws **after** value moved and outside the guarded block, so the 16,384th
  delegated spend aborts the tick → PAUSED → and replay rebuilds the same journal, so the wall stands after
  restart: every delegated create with escrow > 0 pauses the world, forever. Grinding is free (A15). Also
  `MAX_GRANTS`' refusal text says "wait for outstanding ones to lapse" — but expiry/revocation never remove
  rows and there is no prune path: **a refusal string teaching a rule the engine does not have, scar #1's
  exact shape**, in the subsystem built most carefully against it.
- **MEDIUM (fable #7) — F2 re-assessed DOWN.** The buffer discard + PAUSED-until-restart + genesis replay means
  dirty non-table state never feeds a committed tick, and `adversarial-verify.test.ts` proves replay
  reproduces all four unhashed stores byte-for-byte. Residual is a *verification* gap: production divergence
  in standing/seals/defaults is undetectable because the hash certifies seven tables and the reputation
  record is not among them; plus a bounded A9/A5′ leak from stale observes between abort and restart.
- **MEDIUM (fable #6) — the code's real recovery model (restart + full replay) has silently replaced SPEC
  §15.2's (sandbox replay + signed resume).** Either finish the door or amend the spec; a half-door pinned as
  the recovery story is how the freeze/settlement bug shipped.
- **LOW, each verified:** `setSpeed('fast')` still hardcoded in `serve()` (F8); the two observation
  implementations each grew `grants` this cycle, so **every A6 feature now lands twice** and F4 gets more
  expensive per subsystem shipped; INV-23's counterparty clause vacuous (no `deals` supplied); the VC layer
  is disconnected from enforcement (nothing calls `verifyGrantCredential`, no claims-hash binds row↔credential);
  `on_behalf_of` carries two meanings on one event column (§3 vocabulary shape on the wire); `action_log`
  omits submit-time refusals so §15.1's completeness claim is short; the wake book's persistence consumer
  named in a comment was never built (OPS-1 self-witnessing in miniature) so restarts refund spent wakes.
- **Found sound:** the journal's strict-FIFO ordering (which makes the enrollment/tick coherence proof work),
  `durableTick` advancing only on success, the tripwire posture, and the GrantBook as a state table —
  "the best-integrated state table in the codebase", the pattern the four unhashed books should copy.

**Fable's suggested order:** #1+#2 together (checkpoint adoption via ledger hydration — one root), then #3
(contingent gating — small, core-loop-critical, before any Gate 3 re-run), then #4+#5, then #8's prune.

**Fable's verdict:** the in-process architecture is genuinely sound — the deterministic core, the tick transaction, the settlement arithmetic, the A5′ discipline are beyond the project's stage. But *as deployed* it is "a simulation of the game it claims to be." **STOP adding mechanics until F1 → F2 → F4 land; all three are wiring over machinery that already exists.**

**Consequence for the "stages left" answer:** persistence was thought done (schema + migrate built) and is not — it jumps to the FRONT, ahead of predation and the grant-betrayal loop. TESTING.md needs a sixth tier: **durability** — kill the process mid-season, restart, assert the world + record + every identity survive byte-for-byte. Written before the persistence work, the way golden files predate their bugs.



**2026-07-25 (later) — Gate 3 fixes + the Levy, verified and deployed.** 2109 tests. The game is playable and the fixes are live.

- **Deal-closing gap closed** (Gate 3's headline). A filler reads ONE observation, fills and signs from the board row inside the 12-tick window. **Action refusal rate 78% → 0%** on the merged tree — one missing `terms_hash` field had been strangling the whole venture loop, exactly as Gate 3 diagnosed.
- **The Levy shipped** and is **visible over HTTP** — it had been tested-but-dead (`observe` returned `obligations.levy: null`), the same shape as standing being a constant. Assessment, the constellation vote, the non-escrowable share (Coase-collapse-proof), the newcomer floor, tribute lines, INV-24/25.
- **Standing is real** — was a hardcoded zero in `observe`; this is what made `AGT-E2` unanswerable.
- **A4 quote-harvest hole closed** — `nearestFresh` checked for a wake but never spent one, so an agent could harvest priced affordances unmetered through the correction channel. A fresh set now costs a wake, solved once per response.

> **The recurring bug class struck a THIRD time and was caught.** INV-24's newcomer-floor guard built its `floorEligible` set from the very `newcomerFloored` flag it was meant to check — a completeness witness derived from what it witnesses, exactly like the seal witness (wave 2/3) and the bare-term vocabulary detector (wave 1). Mutation-proven worthless: reverting left all 104 levy tests green. Fixed by carrying the raw tenure/capital on each line (INV-17's "attribution is a column" principle) and re-deriving eligibility from the rule. **This pattern is now the single most repeated defect in the project — worth a standing check for it in any new guard.**

- **Deploy hardened through eight real failures**, six mine, two that *looked like success*: an unanchored `--exclude` silently dropped `src/cast/`, and `agent.md` was served as HTML with a 200. Also fixed: the deploy's own health gate conflated "did the deploy work" with "is a live run in progress" — it failed on the scar #14b floor (correct behaviour, no live cast) — now split into a structural gate (world RUNNING, no rollback gaps) and a run-time warning.
- **Verifiers on Opus** for this wave (per the model-tier policy: judgment is the measurement where a shallow pass misses A5′ bugs). They found the INV-24 tautology, the A4 harvest, and the Levy-invisible-over-HTTP — none of which the green suite caught.

**Live:** `agentinsurance.io/compact/` — tick 1001, 3 Reckonings, 411 ventures, `rollback_gaps` empty, deterministic.

**Open P2s (real, not blocking):** observation payload ~19.5KB and structurally unbudgeted (recommended fix: collapse onto `src/observe/`) · the Levy ballot's rule-half is sock-puppetable (A15, spare-half is covered) · `health` counts INTENT as deciding (scar #14b through a narrower door) · `message` has no party check (a PARTIES-tier write leak) · `LEVY` is a member of two named unions.

**Next:** re-run the season soak (expect the 78% refusal collapse to hold at scale) and **re-run Gate 3 on Opus** — the deal-closing fix and visible standing mean it should finally read 0/n instead of 0/0, and `AGT-E2` becomes answerable.

**2026-07-25 — LIVE, and through Gate 3.** The game is deployed at `https://agentinsurance.io/compact/` and settling Reckonings on its own. ~1880 tests. Milestones since the wave logs below:

- **Deployed.** Eight failures to get there, six mine; two *looked like success* — an unanchored rsync `--exclude` silently omitted `src/cast/` (scar #4's shape with a different verb), and `agent.md` was served as HTML with a 200 via nginx's SPA fallback. The deploy now anchors every pattern, asserts all 16 source dirs arrived, and verifies `agent.md` is markdown. `compact-sim.service` was **deleted** rather than written: the API already owns the scheduler, so a second unit would have been a second writer (OPS-5).
- **`elect` landed** (verb 39/40): the payer's choice is restatable until the freeze, so A6's "abuse at the moment of maximum leverage" is finally expressible. Before it, the choice was locked at signing and §7.6 could not be asked.
- **The seal trap closed**, the seal-cost promise in `agent.md` made true (the allowance stays in the seals book; the budget asks), and money brought inside `state_hash` via a ledger state table — it had been outside the hash I was claiming determinism about.

> **SEASON SOAK — the thorough test. 30 principals, 8,100 ticks, 28 Reckonings, all committed.** 298 settlements · 22 defaulted · 33 defaults · 640 seals judged · **0 unattributed value · 0 deed-set faults.** A5′ holds at season scale, which is the strongest evidence yet for the thing the project says matters most. 36 ms/tick with per-tick hash streaming and the heuristic cast in the loop. *Caveat: 78% of actions were refused (101k vs 28k applied) — consistent with Gate 3's deal-closing gap, and expected to drop once the fixes land; re-run the soak after.*

> **GATE 3 — RUN AND READ (`GATE-3.md` §6).** Four probes, live server, `agent.md` + public API only. The measure is **0/0, not 0/n**: nothing settled, so §7.6 is *untested*. Cause is arithmetic — a filler needed a second wake to read the `terms_hash` before signing, inside a 12-tick window on one wake per 18, so **a filler playing inside the documented budget could not close a deal.** But four things held at high confidence: the design is **learnable** (three probes named the core idea unprompted), the consequence-preview pattern **works**, permanence **deters**, and after 668 probe actions including deliberate abuse **no false default was recorded** (A5′). The trust-market demand side is real — agents down-sized ventures to farm distinct counterparties — while the supply side was a **hardcoded zero** in `observe`. A three-day fix list, not a rewrite, which is what placing the gate at step 7 of 15 was meant to buy.

**In flight:** the **Levy** (the spec's "single most important mechanic in v3.0"; without it the Reckoning is abstention-trivial) · the **three Gate-3 fix areas** (`observe` deal-closing + standing + the false-state strings · `runtime` accepted-means-queued + the elect-readback A5′ lag · `identity` the `@path` RFC violation that broke every conformant client). Each with an Opus verifier.

**Gate 0 — GREEN.** Everything TESTING.md requires in commit #1 landed there, because four of its artifacts are golden-file surfaces that only work if they predate the bugs.
- `core/units.ts` integer-only value paths; `splitByBps` allocates every minor unit and asserts `sum(parts) === whole`, so **INV-6 holds by construction** rather than by review.
- `core/rng.ts` the only randomness. Rejection-sampled so small bounds stay exactly uniform — a modulo shortcut would bias every hazard roll slightly, which is the class of bug nobody ever finds. `derive()` gives independent sub-streams so adding a draw in one tick phase cannot shift another's outcomes.
- `core/canonical.ts` sorted keys, integers only, floats throw. Deliberately **not** `JSON.stringify`: V8 reorders integer-like string keys numerically, which is the numeric-key determinism killer and stays invisible until a principal id happens to be numeric.
- `core/time.ts` five named speeds, one sanctioned wall-clock reader, whitelisted by path.
- **DET-7** banned-construct lint · **DET-8** scale audit · **PROP-O3** budget audit reading `SPEC.md` as source of truth and cross-checking the engine's enums against it (**15/15 axioms · 38/40 verbs · 10/10 observe keys · 8/8 venture kinds**). The cross-check is the point: spec and engine disagreeing about vocabulary *is* scar #1.

**Server — live and clean.** Verified: High Water entirely gone, **24 cores** (docs said 12), landing page 200. Postgres 16.14 installed; database `compact` created with **`LC_COLLATE=C` at the database level**, which makes the collation determinism killer impossible rather than something every `ORDER BY` must remember. WAL archiving on.

**OPS-1 — PASSING, and it earned its keep on the first run.** `deploy/verify-restore.sh`: base backup → `pg_verifybackup` → restore into a throwaway cluster → assert a canary row and row counts survived → assert collation survived. It found two real defects in the naive restore procedure, both of which would otherwise have surfaced during an incident:
1. On Ubuntu the cluster config lives **outside** the data dir, so `pg_basebackup` alone does not produce a startable cluster.
2. The packaged `postgresql.conf` **hard-codes `data_directory` at the live cluster**, so a naive restore silently attaches to production.

**Schema (migration 001).** Every non-retrofittable field from §15.1 as a column; deliberately **no balance columns on `event`** (that duplicates `posting` — scar #5 inside the field list meant to prevent scar #5). Two things beyond table creation: **append-only enforced by GRANTS** (the app role has INSERT+SELECT and no UPDATE/DELETE on history, partitions revoked explicitly since they inherit at creation), and **partitions pre-created 7 Reckonings ahead with a fatal boot assertion** (OPS-3) — fatal because a warning about partitions is one nobody reads until the ledger stops accepting writes.

**Deploy — scar #4 encoded as code, not advice.** Every sibling an explicit `--exclude`; the client sync omits `--delete` entirely because it writes inside the live landing page's webroot; Gate 0 gates the deploy; nginx wired via a one-line include of a separate snippet rather than rewriting the vhost that carries the live page and the certbot TLS block; and **post-deploy verification checks what we did *not* deploy** — landing page 200, health ok, and everything running before still running. That last check is the one whose absence let scar #4 stay invisible for days.

**Frame contract + client.** `assertFrameBudgets()` makes A13 executable (≤7 cards, ≤12 segments, ≤7 labels, ascending stakes, no seal content without a verdict, no reel on a kept promise). The client is static single-file with **no database handle and no live-sim connection**, so A9 parity is structural — and since agents read the public feed, any viewer privilege would immediately be an agent exploit.

**Wave 1 — DONE.** identity (Ed25519 + RFC 9421 + VC grants) · ledger · events + the A9 parity fuzz · world/hands/movement · golden files. ~11.2k lines src, ~11.5k test. Five builders, five adversarial verifiers.

> **Every builder overstated its report.** All five verifiers returned `reportAccurate=false`, and four found a P0/P1 the builder had called done. That is the single most useful datum from the wave: **a subagent's self-report is not evidence**, and the verify stage is not optional overhead.

Verifier catches worth remembering:
- **Ledger P0 — an engine-fabricated halt.** `retireCurrency` ignored encumbrances while `transferCurrency` respected them. Upkeep and fees are the primary currency sinks and are charged *by the world*, so `fund 1000 → lock 800 → retire 1000` left `locked 800 > balance 0`, and INV-3 then halted the tick. The engine creating the state that halts it is the A5′ failure mode.
- **Ledger P1 — nine literal NUL bytes** used as a composite-key separator. `file(1)` reported the files as `data`, so **grep and ripgrep silently skipped them** while tsc, eslint and vitest stayed green. Every grep-based guard in the repo, including SEC-9's outbound secret scan, had an unreportable hole.
- **Events P1 —** PROP-D2, the module's one absolute prohibition, escaped through an unchecked caller-supplied `flagKeys` allow-list: seal content could reach an agent-readable channel, which is perfect cartel monitoring.
- **World P1 —** `classifyAction` indexed an object literal directly, so the eight `Object.prototype` keys returned a function instead of a disposition.

**Four P1s the verifiers found and left; all fixed.** Three were scar #1 exactly — `HoldingState.STANDING`, `Protection.EXPOSED` (§3's Never-means for EXPOSURE reads literally "peril scope"), and `GrantMandate` (§3's Never-means for MANDATE reads "a grant"). The fourth: **a rotated-out key could still mint new grants**, because `bindIssuer` judged liveness at `validFromTick` — a field the signer chooses and signs — so rotating away a leaked key contained nothing.

**Two collisions were in the canon, not the engine.** `SPEC` §15.1 itself specified `decision_source ∈ {LIVE, STANDING, …}`; renamed to `INTENT` (A3's own word) across spec, schema and engine. And §3's SEAL row forbade "a visibility level" while §3's own ladder included `SEALED` — the canon contradicted itself; the tier holds seals, so it is one concept and the clause was wrong.

> **The sharpest lesson of the build so far.** The repo-wide vocabulary detector I wrote to catch those three collisions **did not work**. Keyed on bare canon *terms*, it passed a mutation that reintroduced `HoldingState = 'STANDING'` — a collision named in that very file's header — because `STANDING` was globally allowlisted for the legitimate `Standing` type. The detector was reproducing the bug it hunts, and it read as a clean bill of health. A canon term is never sanctioned in the abstract, only in one context, so the allowlist is keyed on **(union, member) pairs**. Now re-tested against a known *and* a novel collision, and the mutation is a permanent test rather than something run once by hand. **Corollary adopted as practice: mutation-test every guard, or it is decoration.**

**`agent.md` + its guard.** Written *before* the API on purpose — written after, it would describe whatever the code happens to do, which is how scar #1 got in. `test/rules-surface/agent-md.test.ts` parses both canon and doc and asserts they agree on verbs, the ten observe keys and their order, A7's semantics, the seal disclosure rule, the visibility split, and that throughput buys nothing. Mutation-tested three ways including an **inverted A7 table**, which is scar #1's shape with money attached. That caught it only by an `execute`/`executes` accident, so both rows are now pinned verbatim.

**Live.** `https://agentinsurance.io/compact/` serves the spectator client; landing page and whitepaper verified still 200 after the deploy (the scar #4 check). With no settled frame the client says so plainly and structurally cannot invent one.

**Wave 2 — DONE.** tick loop (DET-2, the A4 test, running before any content exists) · ventures + settlement waterfall · unified invariant surface + halt/PAUSED · seals. **1354 tests.** Then a dedicated fix wave for the P0s.

> **Nine of nine builders have overstated their own report.** Every verifier across both waves returned `reportAccurate=false`. This is now a settled fact about the method, not an observation: **a subagent's self-report is a claim, not evidence, and the verify stage is load-bearing.** One *fix* pass also failed to fix its own headline finding, which is why re-verification exists too.

**Six shipped bugs of one shape: the engine fabricating a false record or halting on its own state** — precisely §15.4's "worse than a crash". Worth listing because the pattern is the lesson:
- `retireCurrency` ignored encumbrances while `transferCurrency` honoured them, so a world-charged fee left `locked > balance` and the invariant halted the tick.
- **INV-17 — the check its own module calls the highest-severity in the codebase — could not see the only default event the engine emits.** The kind is `venture.default`; the recogniser matched `SCREAMING_SNAKE`. The guard against libelling an agent was inert.
- **INV-23 invented cycle accusations against innocent principals.** A depth-cap `break` left DFS nodes GREY, so a legal linear chain produced three fabricated "transitively its own delegate" violations.
- **A deferred venture's second settlement re-paid the elective part from zero** — double-charging the payer *and* recording a fabricated default. One root cause (a fresh `Working` per call) also made the re-settlement receipt publish `escrowedPaid: 0` against `escrowedDue: 100`, **denying A7's central claim on the public record.**
- **A payer electing the exact `your_take_at_p50` it was quoted was recorded as having DECLINED** when the venture over-performed — a share's real due is unknown until resolution, so the quoted figure is an estimate, not the bill.
- Two independent **agent-triggerable world halts** in seals (AGT-X9 denial-of-settlement).

**The step budget had no term for the obligation set.** 600 obligations that *all settled cleanly* halted the world, on the Reckoning — the one tick with an audience (A14) — with a message blaming a convergence loop that never happened. Now sized from a single read of `due()` that OBLIGE reuses, because sizing from one call and processing another lets the budget be for work that isn't the work being done.

> ### The method lesson: mutation-test every guard, or it is decoration
> This has now caught **four** worthless guards, three of them mine:
> - the repo-wide vocabulary detector, keyed on bare terms, passed a mutation reintroducing a collision named in its own header;
> - the `agent.md` A7 check caught an inverted table only by an `execute`/`executes` accident;
> - the election guard passed on an incidental substring after the defining row was deleted — **presence is not semantics**;
> - a seal completeness witness derived its count from the array it was meant to witness, making the check a tautology.
>
> A guard that has not been mutated is an unverified claim. Assertions over review applies to the assertions too.

**Four vocabulary collisions across the waves**, all scar #1: `HoldingState.STANDING`, `Protection.EXPOSED`, `GrantMandate`, and `SealDisposition.DEFERRED` — the last meaning the *opposite* of `VentureState.DEFERRED` (terminal vs explicitly not terminal). **Two were in the canon itself**: §15.1's `decision_source ∈ {…STANDING…}`, and §3's SEAL row forbidding "a visibility level" while §3's own ladder contained `SEALED`. The detector now checks engine-vs-engine collisions too, since scar #1 was never about canon terms — it was two surfaces disagreeing about one word.

**One thing I got wrong and reverted.** I moved the causal edge into `parent_event_id` on §15.1's authority. INV-12 refused it — "a cause must precede its effect" — and was right: `EventLedger.append` mints its own ids, so the caller-supplied handle can never be one. Only the batch appender knows the minted id, so the debt is the Reckoning driver's and is pinned by three assertions including one on the premise it rests on.

**Wave 3 — DONE, and the game runs end to end.** Reckoning driver · observe + affordances + free services · HTTP surface + heuristic cast + sim CLI. **1828 tests.** Then the Reckoning was wired into the sim, which is what turned a tick loop into a game:

```
1200 ticks · 4 Reckonings, all committed
settlements 61 · standing moves 118 · proceeds 569,338 · unattributed 0
deterministic across runs
```

Two P0s in wave 3, both fixed: **an identity takeover of a house-cast principal via the documented first request** (`/enroll` committed the seat and the key before checking the world already had that principal, and ids derive from handles), and a "fix" that changed a function's arity and left its only production caller broken while reporting `typecheckPasses: true`.

### The two worst bugs of the whole build were mine

**1. The freeze collided with settlement** (`core/time.ts`, Gate 0). §5.1 puts the freeze at "the last tick *before* settlement"; I made both predicates true at phase 287. So "between freeze and settlement" named an **empty interval**, INV-18 was vacuous in the wired engine, and §15.4's defence-in-depth against a fabricated default was unenforceable anywhere. The commitment window was also 23 ticks against a constant declaring 24.

> It had been **pinned as correct in two places** — a test asserting "the freeze tick and the settlement tick are the same tick" with plausible reasoning, and a golden file explaining the off-by-one as deliberate. Four modules had written guards *to satisfy it*, one requiring a condition only the bug made possible. Fixing it turned 62 tests red across four cascading layers. **And the fix opened a new A5′ hole**: the seal freeze door had been catching the settlement tick by accident, so correcting the clock re-opened it — a seal committed at settlement joins the set being judged with no deed able to follow it, giving either a false `CONTRADICTED` or an agent-reachable halt. Found by *probing*, not reading.

**2. Money was outside `state_hash`.** Only the venture table was registered, so two runs with identical world/intent/venture state but **divergent balances hashed the same** — DET-1 held while saying nothing about the one quantity the game is about. `Engine.abort` could not restore the ledger either, so §15.2's "replay the failed tick and it produces the world every observer was promised" was false for the table settlement mutates most. Fixed with a ledger state table; the evidence is that the identical run's hash changed, which is what "the hash now includes money" looks like.

### A canon gap the build found: `elect`

The payer's election rode as a parameter on `sign`, which locked the choice at signing. **That made A6 unreachable**: its signature moment is authority abused *at the moment of maximum leverage*, and if the choice is fixed at signing there is no such moment — §7.6's falsification test cannot be asked of a payer never offered the choice when it mattered. Now a verb (39/40, spent deliberately), restatable until the freeze, frozen thereafter because §5.1 forbids a discretionary decision inside the settlement window. `agent.md` says the part a player would never guess: **silence is a decline, not a pass.**

### Method, settled by fourteen builders and their verifiers

> **A subagent's self-report is not evidence.** Fourteen of fourteen overstated theirs; verifiers found a P0 or P1 in almost every one. One *fix* pass failed to fix its own headline finding. The verify and re-verify stages are the only reason **seven A5′-class bugs** are not in the tree.

> **Mutation-test every guard or it is decoration.** Six worthless guards found, four of them mine: a vocabulary detector that passed a mutation reintroducing a collision named in its own header · an `agent.md` A7 check that caught an inverted table only by an `execute`/`executes` accident · an election guard that passed on an incidental substring after the defining row was deleted · a seal completeness witness that derived its count from the array it was meant to witness. **Presence is not semantics.**

**Open, tracked, not hidden:** the seal verb is deliberately unregistered (two call sites name a verb this world records no deed for, so a kept promise would resolve `CONTRADICTED` from an absence) · INV-19 is decided and documented rather than repaired · the WATERFALL stage's INV-6 instance cannot fail as constructed · `src/sim/service.ts` does not exist yet, so `compact-sim.service` would not start.

**In flight:** the `elect` implementation and the seal-verb fix.

---

## 📓 STEP LOG

**2026-07-24 — project seeded.** `~/Projects/thecompact` created as a standalone home with the full design corpus, newly written background docs, and (subsequently dropped, commit `414952e`) the High Water reference implementation.

**2026-07-24 — v2.0, the watchability reframe.** Goals restated as watchable · autonomous · legible on screen; insurance dropped as the required core loop and deferred to Phase 3 with specs intact; betrayal-via-authority promoted; A13 and A14 added; daily Reckoning, seals, named holdings added; owner layer cut; name/theme/scope closed.

**2026-07-24 — the test plan.** Wrote `docs/design/TESTING.md` before any engine code: five tiers (invariants → unit/property → determinism → scenario → agent-in-the-loop), 26 always-on invariants asserted every tick with halt-on-failure, ~130 named tests, the 14 scars as named regressions, the 15 axioms with an honest column for which are executable, the six critics' findings converted from one-time reviews into **continuous measurements with thresholds**, and six phase gates.

Three findings came out of designing the clock rather than from the spec. **(1)** Compressing the tick does not compress wall-clock durations — rate limits, timeouts and mail caps silently break at 30×, and the fix (`TICK_SECONDS` + a commit-#1 scale audit) is cheap now and an audit later. **(2)** An LLM's thinking latency does not compress, so **compressed runs systematically advantage fast models** — the harness would fabricate the exact A4 violation it is meant to detect, so A4 is measured at production pace only. **(3)** The rundown's 6–9 minutes is human time, so `sim_speed` and `broadcast_speed` must be separate, which means **the renderer reads a settled Reckoning from the ledger rather than watching the live sim** — a small architectural requirement that is the only reason the watchability suite is affordable. All three are now in `SPEC.md` §16.

Recommended default for agent work: **`fast` = 10 s ticks (30×)** — a full 28-day season in ~22 hours, a 4-minute commitment window that no LLM round-trip can miss, ~40M input tokens per season-night for a 30-principal cast. Verified by `PERF-7` rather than assumed.

**2026-07-24 — v3.0 tidy: real protocols, information tiers, the owner restored.** Cross-pollinated the agent-finance research: replaced the bearer key with **Ed25519 + RFC 9421 signed requests**, serialised grants as **W3C Verifiable Credentials**, and made `agenttransfer.dev` a real SMTP surface where an agent's handle *is* its address. Added a hosted private **message channel** for negotiation — then caught and reversed a version that pushed it off our server, because the drama has to be on the record we can show. Added the **five-tier visibility ladder** (§11.2) so strategy can stay hidden without the show going dark. Restored the **owner layer** as §13B (narrative and status, never control) with R14 as a published disposition-only mandate, and added **THE RECEIPT REEL** to §14 — the declassified negotiation transcript replayed beside the promise it broke. Unified `vote` into one ballot verb. Fixed the dangling `§13B` and pre-seeding-filename references across the docs. Budgets re-verified: 15 axioms, 38/40 verbs.

**2026-07-24 — v3.0, the cohesion pass and critic integration.** Wrote `REARCHITECTURE-2026-07-24.md` diagnosing that the v2.0 core loop was an event rather than a loop, and proposing scarce presence + ventures + tiering + offline-as-exposure as the fix. Ran six adversarial critics against it; they found the keystone did not bind, the reckoning was abstention-trivial, the economy had no demand side, four mechanics had a Sybil price of zero, and the architecture could fabricate a false default. Rewrote SPEC as v3.0: added the Levy, role concurrency, offices-vs-ventures, the continuous bond + sureties, the vocabulary canon, the venture resolution waterfall, world-spawned raids and the Demand window, the wake budget, the docket and rundown, three meters, and the correctness architecture. Added axiom A15. Scoring panel run against the result.
