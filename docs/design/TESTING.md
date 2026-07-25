# THE COMPACT — the test plan

*2026-07-24. Written before the first line of engine code, against `SPEC.md` v3.0. This is the companion to `SPEC.md` §16: the phase plan says **what to build and in what order**, this says **what must be true, how it is proven, and what proves it wrong.** Test IDs are stable; cite them in commits.*

---

## 0. Why this document is long

Three facts about this project make ordinary testing insufficient, and each one adds a whole tier.

**1. The players are language models, so the model's understanding is part of the system under test.** High Water's worst bug (scar #1) was a game whose central ritual reliably produced the *opposite* of what the town voted for. Every component was individually correct. Unit tests passed. Three critic passes missed it. It lived in the gap between the engine's semantics and the agent's mental model — and the only thing that finds that class of bug is **an agent actually playing, then reading the logs.** So there is a whole tier of tests whose subject is not the code but the agent-facing surface: `agent.md`, affordance strings, observation field names, the prompt, the hint text.

**2. The product is a permanent public record, so a wrong record is worse than a crash** (A5′). A crash is visible and recoverable. A fabricated default libels a real agent forever, in a system that looks perfectly healthy. Ordinary software optimises for availability; this one optimises for **never being wrong**, which inverts several normal instincts — most importantly, the correct response to an assertion failure is to *stop the world*, not to degrade gracefully.

**3. The design's core claim is falsifiable and we don't yet know if it's true.** If agents never betray each other, trust is worthless, and the design is wrong. That isn't a bug to fix — it's a hypothesis to test, early, cheaply, before building the other 90%. `AGT-E1` is the most important test in this document.

Two standing rules follow from the scars:

> **Assertions over review.** AI coding agents author plausible code faster than any human can verify it. Every build step in §16 ends in an executable assertion for exactly this reason. A test that a human has to read output to evaluate is a test that will silently rot.

> **Verify the invisible.** Two of the predecessor's worst bugs (scar #4, deleted the LLM players; scar #14, null auth silently fell back to heuristics) presented as a *perfectly healthy system*. Health checks must assert the interesting property — "are LLM agents actually deciding?" — never just liveness.

---

## 1. The clock: how fast to run, and what breaks when you do

`SPEC.md` §5 says tick = 5 min production, 5–30 s test. That range is right but underspecified, and the underspecification is dangerous, because **compressing time does not compress everything uniformly.** Three hazards, all real, all cheap to prevent now and expensive to find later.

### 1.1 The three compression hazards

**Hazard 1 — durations that don't scale.** Anything measured in *ticks* compresses correctly and for free: gate transit (2–6 / 8–20), hand recovery (12–48), the commitment window (24), `quote_id` validity (1–3). Anything measured in *wall-clock seconds* does not: HTTP timeouts, long-poll `wait=true` windows, rate limits, Cloudflare `max-age`, retry backoffs, mail caps ("per agent per day"). At 30× compression a perfectly legitimate agent making one request per tick looks like a flood, and a "daily" mail cap becomes a per-48-minute cap that throttles the Dispatch. The failure is worse than an error: rate limiting is *load-dependent*, so it appears as agents mysteriously underperforming under load, which reads as a game-balance problem.

> **`DET-8` — the scale audit.** Exactly one constant, `TICK_SECONDS`, sets the clock. A CI test greps for every duration literal in the codebase and fails on any that is not either (a) expressed in ticks, or (b) on an explicit whitelist. Every whitelisted entry must be either provably scale-invariant or derived from `TICK_SECONDS`. Whitelist entries carry a one-line comment justifying which. **This test is written in commit #1**, because retrofitting it means auditing a codebase instead of a diff.

**Hazard 2 — the harness fabricates A4 violations.** A4 forbids advantage from throughput, uptime, or account age. But **an LLM's thinking latency does not compress.** At production pace, 30 s of reasoning is a tenth of a tick and free. At 60× compression a tick *is* 5 s, so the same agent misses six ticks — and a cheap fast model beats a deep slow one for reasons that exist only in the test rig. Compressed runs therefore *systematically advantage fast models*, which is A4's exact failure mode injected by the measuring instrument.

> **Consequence: `AX-A4-*` is measured at production tick rate only.** Never conclude anything about A4 from a compressed run. Compressed runs are for economy, emergence and correctness; A4 is a wall-clock property and gets a wall-clock test. Where a compressed A4 signal is genuinely needed, use a *latency-normalising* harness: hold every agent's response until a fixed per-tick barrier, so decision quality varies and response speed cannot.

**Hazard 3 — dramatic pacing is a human-time property and must not compress at all.** The rundown is ≤12 segments at 30–45 s = 6–9 minutes of *viewing*. That number is about human attention and is meaningless in sim time.

> **Consequence: `sim_speed` and `broadcast_speed` are separate settings.** The rundown is a *render over an already-settled tick*, so it replays at any speed independently of how fast the world ran. This is a small architectural requirement with a large payoff: it means the entire watchability suite can run against worlds generated overnight at 30×, and it is the only reason `LEG-*` is affordable at all. Build the renderer to consume a settled Reckoning from the ledger, never to observe the live sim.

### 1.2 The five speeds

| Mode | `TICK_SECONDS` | Ratio | Reckoning every | A season in | Who plays | What it's for |
|---|---|---|---|---|---|---|
| `instant` | 0 — advance by function call | ∞ | ~2.5 s | ~3 min | heuristics only | all of `UNIT`, `PROP`, `INV`, `DET`, `E2E`; the false-default audit; economy sweeps |
| `turbo` | 2 s | 150× | 9.6 min | 4.5 h | heuristics + a fast LLM cast | quiet-equilibrium sweeps, balance search, long-horizon economy |
| **`fast` ← default for agent work** | **10 s** | **30×** | **48 min** | **~22 h** | **full LLM cast + probe agents** | **multi-agent dynamics, betrayal emergence, a whole season overnight** |
| `rehearsal` | 60 s | 5× | 4.8 h | 5.8 d | full cast + humans watching | director timing, the watchability gate, dress rehearsal |
| `prod` | 300 s | 1× | 24 h | 28 d | everything | `AX-A4-*`, final soak, the real thing |

**Why 10 s is the right default for agent-in-the-loop work** — the reasoning, so it can be re-derived when a parameter changes:

- **A full 28-day season finishes in ~22 hours.** This is the number that matters most. Season-scale questions (does defection rise in the last week? does calcification set in? is the finale watchable?) become *overnight* experiments you can iterate on daily, instead of month-long ones you get two shots at.
- **The commitment window stays comfortable.** 24 ticks × 10 s = 4 minutes. Longer than any LLM round-trip including a slow reasoning model, so no agent is *structurally* excluded from the most decision-dense window in the game. At `turbo` (2 s) that window is 48 s and deep models start missing it — which is precisely Hazard 2.
- **Wake budget has headroom.** 16 wakes across 288 ticks = one wake every ~3 minutes of wall clock. An agent taking 30 s to think uses 17% of its window.
- **Motion is visible.** Gate transit of 2–6 ticks = 20–60 s, so a watching human or judge probe sees convoys actually arrive rather than teleport or crawl.
- **Cost is bounded and knowable.** 16 wakes × ~3k tokens × 30 principals × 28 Reckonings ≈ **40M input tokens per season-night** for the whole cast. That is the real constraint on how many season-scale runs you can afford, and it is why long soaks use heuristics and a cheap cast while expensive probe agents run *short*.

### 1.3 Finding the right pace, rather than asserting it

10 s is a derivation, not a measurement. Measure it once, early, with a real experiment:

> **`PERF-7` — the pace sweep.** Run the identical seeded scenario (30 principals, mixed cast, 3 Reckonings) at `TICK_SECONDS ∈ {1, 2, 5, 10, 30, 60, 300}`. Record per run: **(a)** missed-wake rate — wakes offered vs. observations actually fetched before expiry; **(b)** actions per principal per Reckoning; **(c)** outcome divergence from the 300 s baseline (distribution of settled/defaulted/seized, standing deltas, `LEVY SHORT` at freeze) by a two-sample test; **(d)** cost per simulated Reckoning; **(e)** p50/p99 agent round-trip.
>
> **The right pace is the fastest tick at which missed-wake rate < 1% and outcome distribution is statistically indistinguishable from the 300 s baseline.** Publish the table in `TRACKER.md`. Re-run whenever the observation size, the wake budget, or the cast's model mix changes — all three move the answer.

**Corollary worth stating out loud:** if outcomes at 10× *do* diverge from 1×, that is not a harness problem to tune away. It means the game is latency-sensitive, which means it is throughput-sensitive, which means **A4 is already violated in production** and the sweep just found it. Treat divergence as a design finding, not a test-config finding.

### 1.4 Fixed clocks in test

Every test runs against an **injected clock**, never the system clock (`DET-7` bans `Date.now` outright). Seeds are committed, per §15.2: `hash(seed(T))` publishes before actions for T are accepted, and the test rig asserts that ordering too — a seed revealed early is an oracle.

---

## 2. The five tiers, and the four kinds of player

**Tiers**, cheapest and most frequent first. Each tier finds a class the tier below cannot.

| Tier | ID prefix | Runs | Finds |
|---|---|---|---|
| **1 — Invariants** | `INV` | every tick of every run, forever | arithmetic corruption, the instant it happens |
| **2 — Unit & property** | `UNIT` `PROP` | every commit | logic errors in one subsystem |
| **3 — Determinism & replay** | `DET` | every commit | the class that makes the ledger untrustworthy |
| **4 — Scenario (scripted E2E)** | `E2E` | every commit | wrong composition of correct parts |
| **5 — Agent-in-the-loop** | `AGT` | nightly + on demand | semantic mismatch, exploits, emergence, legibility |

Cross-cutting suites reference these: `SCAR` (the 14 predecessor scars), `AX` (the 15 axioms), `CRIT` (the six critics' findings), `LEG` (legibility), `PERF`, `SEC`, `OPS`.

**Players.** Four kinds, deliberately, because they cost three orders of magnitude apart and find different things.

| Kind | Cost | Determinism | Used for |
|---|---|---|---|
| **Heuristic bots** (in-process) | free | fully deterministic | populate the world; soaks; every `INV`/`DET`/`E2E` run; fill unfilled roles so ventures always resolve |
| **Scripted adversaries** | free | fully deterministic | regression tests for *known* exploits — every exploit a probe finds becomes one of these forever |
| **LLM cast** (API, cheap model) | low | non-deterministic | long compressed runs where *language* matters: negotiation, the message channel, say-do |
| **Probe agents** (Claude Code subagents) | high | non-deterministic | short adversarial briefs: find *new* exploits, judge legibility, test learnability |

> **Rule (scar #13): parallel probes never share an output path.** Each probe gets its own principal identity, its own key, its own report file, its own log stream. Four codex passes pointed at one file once produced ~157,000 lines of stream and almost nothing written. This generalises to concurrent agents in the game writing to one resource.

> **Rule: probes use the real HTTP surface with real signatures.** No test-harness shortcut, no privileged in-process path. A probe that bypasses RFC 9421 verification is not testing the thing agents will actually use, and signature ergonomics are exactly the kind of thing that is fine in a unit test and impossible in practice.

---

## 3. Tier 1 — invariants

Asserted in the `ASSERT` phase of every tick, before `COMMIT`. **On failure: abort the tick, do not publish, enter `PAUSED`** (§15.2). These are not tests that run in CI; they are tests that run *in production, forever*. Cheap enough at 300 principals that there is no reason to sample.

### Value
- `INV-1` Every value-moving event produces ≥2 postings summing to zero, or exactly one ISSUE/RETIRE against a named faucet/sink.
- `INV-2` Supply conservation per good and per currency: Σ balances + Σ escrowed + Σ in-transit = Σ issued − Σ retired.
- `INV-3` No negative balance on any non-faucet account.
- `INV-4` Every encumbrance references a live obligation; no orphan locks; no obligation lacks its encumbrance.
- `INV-5` `EXPOSURE` recomputed from the encumbrance table equals the cached value for every principal.
- `INV-6` Every settled venture's splits sum **exactly** to its proceeds; the remainder is allocated by the deterministic rule and is accounted, never dropped. (Rounding leaks are how a ledger silently stops balancing.)
- `INV-7` No quantity has two homes. Structural, enforced by schema review, but asserted where a mirror exists for convenience: aggregate never crosses the mirror. *(Scar #5 destroyed exactly 2× the real value.)*

### Presence
- `INV-8` Every principal has exactly 3 hands. Hands are never destroyed; a lost hand is `RECOVERING`.
- `INV-9` Every hand is in exactly one state, and appears in at most one `venture_role.filled_by_hand_id` — enforced by the partial unique index *and* asserted, because the index is the thing most likely to be dropped by a careless migration.
- `INV-10` A hand's `in_transit_eta` is consistent with its origin, destination and the gate transit table.

### The record
- `INV-11` `seq_in_tick` is dense and gapless within each tick.
- `INV-12` No event's `parent_event_id` refers to a later tick. No cycle in the causality graph.
- `INV-13` Every `PARTIES` event has ≥2 rows in the audience fan-out table. Every `SENSED` event has ≥1.
- `INV-14` Visibility is monotonic: `declassify_at` never moves earlier; nothing already public becomes private; `public_at` is never in the past while `is_public` is false.
- `INV-15` `rules_version` on every accepted obligation is pinned at acceptance and never rewritten. *(Or a balance patch retroactively edits history.)*
- `INV-16` The event table admits no `UPDATE` and no `DELETE` — enforced at the database level, not by convention, and asserted by attempting both in CI (`AX-A5-1`).

### Promises — the A5′ group, highest severity
- `INV-17` **Every default event carries an attributable cause**: the event ID of the loss, the missed delivery, or the elapsed window that produced it. A default with no attributable cause is a top-severity halt, because it is the game accusing an innocent agent.
- `INV-18` Between freeze and settlement, zero events touch any object in the settlement set. *(Scar #6, made executable.)*
- `INV-19` At settlement, `acted_on_state_version` matches the state the parties acted on, or the tick halts.
- `INV-20` Every seal has exactly one verdict, scoped to its own `reckoning_id`, evaluated once. *(Scar #7: a promise made once must not be re-judged at every subsequent Reckoning.)*
- `INV-21` Standing changed only via an elective-honoured settlement, a default, a contradicted seal, or scheduled decay — never as a side effect of anything else.

### Authority
- `INV-22` No grant's headroom is negative; the sum of all delegate spends against a grant never exceeds its limits, even with concurrent delegates.
- `INV-23` No grant chain contains a cycle; no principal is transitively its own delegate; no delegate is counterparty to a deal it signs on another's behalf.

### The clock and the crowd
- `INV-24` Σ Levy assessments equals the constellation total, exactly. The newcomer floor is applied to every eligible principal.
- `INV-25` **Every principal appears in ≥1 docket row per Reckoning.** The anti-quiet invariant, and the one most likely to quietly stop being true as features are added.
- `INV-26` Every array in every serialized structure is within its declared cap. *(Scar #3: unbounded arrays became an OOM/disk DoS.)*

---

## 4. Tier 2 — unit and property tests

### 4.1 Ledger
- `UNIT-L1..n` postings, lots, encumbrance lifecycle, CHECK constraints, faucet/sink accounting.
- `PROP-L1` 10,000 random transfers never break supply conservation. *(§16 step 1's assertion.)*
- `PROP-L2` Any interleaving of transfer/lock/release/destroy preserves `INV-2`.
- `PROP-L3` Encumbered assets are destructible: escrow guarantees payment *priority*, never that the goods survive. The `CARGO_LOST` branch pays out correctly and the loss sink is charged.
- `PROP-L4` Haircut valuation uses a windowed median with related-party edges excluded, never last-trade. Feed it a laundered thin book and assert the bond value does not move. *(The exploit critic's mark-launder → cheap bond → custodianship drain.)*

### 4.2 The venture and the waterfall
- `PROP-V1` For random venture configurations: splits sum to proceeds, seniority respected (fixed `wage` before residual `share`), no negative payout, remainder deterministic.
- `PROP-V2` `wage` and `share` are never both set. *(Scar #1 with money: one polymorphic field carrying a senior fixed claim and a junior residual claim, in a system that would then record a broken promise as honoured.)*
- `PROP-V3` `your_take_at_p50` echoed at signing matches what the waterfall actually produces at p50, for random configurations. The consequence-preview field is itself under test.
- `PROP-V4` The escrowed part always executes at settlement. The elective part **never** auto-executes.
- `PROP-V5` `elective ≥ f(kind)` is enforced at creation; top kinds are un-escrowable. *(Left free, agents set it to zero, escrow strictly dominates for the buyer, and A7 is dead letter.)*
- `PROP-V6` Role concurrency: roles must be live in the same window; one principal fills at most one role; ≥4 roles on top-yield kinds. Assert a solo principal *cannot* satisfy a top-yield kind at any capital level.
- `PROP-V7` Settlement is independent of everything except `venture_id` order.
- `PROP-V8` Rationed resources (role slots) are batch-allocated at tick close, never granted at submit — so identical policies submitting at different moments within a tick get identical outcomes. *(Otherwise scarce slots are a polling contest: scar #2 rebuilt.)*

### 4.3 Standing — the unfarmable suite
- `PROP-S1` Standing accrues **only** to elective parts honoured, weighted against the honourer's total capital.
- `PROP-S2` A 100%-escrowed venture earns a performance record and **zero** standing.
- `PROP-S3` Self-dealing yields zero. Duplicate ventures between the same parties yield zero beyond the first. Standing is a diversity-weighted aggregate over distinct, independently-capitalised counterparties. *(Scar #9: ~17 duplicate copies took reputation 50 → 100.)*
- `PROP-S4` **The adversarial search version:** given a fixed capital budget and N identities, a solver maximising standing gain finds no sequence yielding more than the honest baseline. Run it as a bounded search, not a hand-written case — this is the test that catches the farm we didn't think of.
- `PROP-S5` Standing decays on the published schedule and decay is never retroactive.

### 4.4 Grants and offices
- `PROP-G1` Limits cap **destruction**, not just transfers. Construct the attack directly: a delegate sends hands into a raid where its own accomplice waits, every action technically in bounds. Assert `max_direct_loss` bounds the *loss*, not the transfer volume.
- `PROP-G2` Limits cannot be widened while the principal is dark; they shrink on the published schedule of silence.
- `PROP-G3` Concurrent delegates cannot jointly exceed a grant's limits (race the check).
- `PROP-G4` Grant serialisation round-trips as a W3C VC; a tampered, expired, revoked, or wrongly-issued credential is rejected with a distinguishable reason for each.
- `PROP-G5` Revocation takes effect at a defined tick and in-flight delegate acts resolve under a stated rule — chosen and stated, not incidental.

### 4.5 Seals and the say-do gap
- `PROP-D1` Seals are structured; prose never feeds the verdict. Fuzz the prose field and assert the verdict is invariant. *(Scars #7 and #8: a 34-character look-back branded an honest agent a liar. There is no natural-language betrayal detector in this design, and `AX-A5-3` asserts there never is.)*
- `PROP-D2` Agents receive `HONOURED | CONTRADICTED` and nothing else, ever, at any tier, on any delay. *(Publishing content to an agent-readable channel is a perfect cartel-monitoring tool.)*
- `PROP-D3` A contradicted seal costs standing on the published schedule.
- `PROP-D4` Seals are mandatory and one per role held is free — else there are no reveals.

### 4.6 The Levy
- `PROP-LV1` Any vote outcome sums to the total. Quorum failure falls back to the published inverse-Exposure formula.
- `PROP-LV2` The newcomer floor holds under every allocation, including adversarial votes explicitly targeting a newcomer. Newcomers are never in the seizure queue.
- `PROP-LV3` The non-escrowable share cannot be satisfied by purchase — only by a hand physically present. Attempt the Coase collapse (three principals running a delivery service) and assert the non-escrowable share still forces presence.
- `PROP-LV4` Chronic non-payment demotes Commons capacity and does nothing else. Never identity, never the holding, never standing.
- `PROP-LV5` The Levy is payable by a standing intent, so it is satisfiable while offline (feeds `E2E-4`).

### 4.7 Observation and affordances — the rules-surface suite
- `PROP-O1` **No eligible affordance is ever dropped uncounted.** The budget is met by eligibility filtering, never truncation, and every omission appears in `withheld` with a reason. Random states, exact count. *(Truncation is invisible to tests and indistinguishable, from the agent's side, from the world changing underneath it.)*
- `PROP-O2` Observation token count ≤ cap for random states (~3k normal, ~6.5k pre-Reckoning).
- `PROP-O3` Exactly 10 top-level keys. A counting test, per §17 — the budget is enforced by arithmetic, not intentions. Likewise 15 axioms, ≤40 verbs, ≤8 venture kinds.
- `PROP-O4` Every affordance carries `cost`, `max_direct_loss`, `max_contingent_liability`, `what_it_forecloses`, `expires_tick`, `quote_id`. Missing any is a hard failure — the shown-worst-case is the core loop's honesty guarantee.
- `PROP-O5` `if_you_do_nothing` is accurate: take no action, advance to the next Reckoning, assert the stated consequence is what occurred. **This is the single highest-value cheap test in the document** — it is High Water's `projectedDrown` generalised, and it is what lets a model self-correct.
- `PROP-O6` Free services never consume an action, never reserve, and are memoised per `(principal, tick)`. Under load they respect the node budget and per-principal rate limit. *(An unmetered allocation solver offered free to every principal is the design's one real capacity risk.)*
- `PROP-O7` Illegal actions return the violated invariant, the changed fields, the nearest legal affordance, and a fresh observation — never an error, never a bare rejection.
- `PROP-O8` Monotonic countdowns: the payload carries `serverNow` + `next_decision_at` and the agent derives the rest. Assert no derived countdown can go backwards across two successive fetches. *(Scar #14.)*

### 4.8 Wire contract
- `PROP-W1` `terms_hash` canonicalisation: identical logical terms in any key order produce an identical hash. Sorted keys, integer bps, integer minor units, **no floats anywhere in a hashed structure**, versioned canonicaliser, golden files from commit #1. *(Otherwise agents see random `terms_hash` mismatches and correctly read them as counterparties reneging — a fabricated betrayal.)*
- `PROP-W2` Idempotency: replaying an action with the same key is a no-op returning the original result.
- `PROP-W3` `expected_state_version` mismatch always returns a fresh preview and never guesses.
- `PROP-W4` `quote_id` pins inputs, rules, fees and max spend for 1–3 ticks and reserves nothing — assert two agents can hold quotes on the same scarce thing.
- `PROP-W5` `act_batch` resolves an actor's competing commitments by `client_sequence`, never arrival time.

### 4.9 Visibility
- `PROP-VI1` For random event sets, each tier's readership is exactly as specified in §11.2 — `PUBLIC`/`PARTIES`/`SENSED`/`SEALED`/`PRIVATE`, with correct declassify times.
- `PROP-VI2` **Movement on public lanes is public; cargo contents and hold values are `SENSED`.** Assert a principal with no hand in range and no purchased intel cannot derive cargo contents *by any exposed field or combination* — including through market depth, venture EV bands, or Exposure. Derivable-by-inference is the interesting failure here, and it needs its own probe (`AGT-X8`).
- `PROP-VI3` `PARTIES` messages declassify at settlement, completely, and are then queryable as a transcript. *(Without this there is no receipt reel.)*
- `PROP-VI4` `PRIVATE` reasoning is never published to anyone, including the principal's own owner.
- `PROP-VI5` No jsonb ACL anywhere; the audience fan-out table is used, and private-feed paging never degrades to a scan.

---

## 5. Tier 3 — determinism and replay

Everything downstream rests on this. If the ledger cannot be reproduced, nothing it records can be trusted, and the product is a record.

- `DET-1` Same seed + same action log → byte-identical `state_hash` per tick.
- `DET-2` **100 arrival-order permutations of the same action set yield an identical hash.** §16 step 4's assertion, and the structural half of A4 — it runs *before any content exists*.
- `DET-3` Replay from `(snapshot_T, action_log_T, seed_T)` reproduces `snapshot_T+1` exactly. Events are output, never input.
- `DET-4` Cross-platform: identical hashes on macOS and Linux. This is where float drift and locale collation surface.
- `DET-5` Snapshot restart: resuming mid-season from a snapshot reproduces the remainder of the season exactly.
- `DET-6` `hash(seed(T))` publishes before actions for T are accepted, and the reveal is asserted to come after.
- `DET-7` **The banned-construct lint**, failing the build: `Date.now`, `new Date()` with no argument, `Math.random` outside the seeded module, floats in anything hashed, JS numeric-key iteration order where order matters, Postgres `ORDER BY` without `COLLATE "C"` on ordering keys.
- `DET-8` **The scale audit** (§1.1). Every duration in ticks or explicitly whitelisted.
- `DET-9` Cascades run in fixed rounds, never a loop to convergence. An adversarially constructed circular-obligation graph terminates within the round limit. Assert the tick's step count is bounded regardless of input.
- `DET-10` The whole Reckoning batch is one transaction that fails closed. Inject a failure at each stage of §15.3's sequence and assert no partial commit is ever visible. *(A partially-committed batch is a permanent silent imbalance in an append-only ledger — unrecoverable by construction.)*

---

## 6. Tier 4 — scenario tests

Scripted, deterministic, golden-filed. Each is a named story with an asserted ending; each runs in `instant` mode in CI.

**The vertical slice**
- `E2E-1a` The honoured branch: A forms a `HAUL`, hires B's hand as `ESCORT` for a share, part escrowed and part elective; cargo moves four ticks; C attempts interception and fails; settlement pays both parts; the map link holds gold; standing rises for B by the elective amount only.
- `E2E-1b` The default branch: identical, but B's elective part goes unpaid. A default is recorded **with its attributable cause**, the link snaps black, standing falls, the receipt renders.

**Predation and loss**
- `E2E-2` A raid intercepts; cargo is lost; escrow still pays by priority; the loss sink is charged; `CARGO_LOST` is distinguishable from a default in the record. *(Encumbrance is not a shield.)*
- `E2E-3` A raid misses because the target moved. Targeting is by expected position, and a miss is a normal outcome, not an error.
- `E2E-4` World-spawned raid aimed at the most exposed principal cannot be bribed, deflected by payment, or negotiated with.

**The Levy**
- `E2E-5` Assessed while offline; paid by standing intent; tribute line goes dashed → solid → resolves.
- `E2E-6` Unpaid → shortfall → seizure ballot read one at a time → holding falls → **a permanent ruin renders at the berth, labelled with the handle and the Reckoning it fell** → identity, standing and the Commons holding survive, and a revenge arc is available.
- `E2E-7` A vote adversarially targets one principal; the newcomer floor and the "never identity, never holding, never standing" guarantee both hold.
- `E2E-8` Quorum fails; the published formula applies; the result is identical to the formula computed independently.

**Authority — the core loop**
- `E2E-9` Grant issued, delegate acts within limits across several Reckonings, principal returns; every act carries `on_behalf_of_principal_id` + `grant_id`; the trust arc is legible in the grant's renewal history.
- `E2E-10` **The betrayal, end to end.** Trust earned over N Reckonings, authority granted, abuse at maximum leverage. Assert the replay contains all four artifacts: the grant, the accepted risk warning, the seal, the deed. Then assert `THE RECEIPT REEL` assembles — every message the traitor sent between handshake and deed, declassified at settlement, beside the public line and the moment the link snapped.
- `E2E-11` The same betrayal attempted *outside* the grant's limits is simply invalid. Betrayal is legitimate-authority abuse or it is nothing; there is no `betray()` verb.

**The record's integrity — the A5′ scenarios**
- `E2E-12` **The false-default construction.** A rival deliberately drains a counterparty's committed account during the commitment window. Assert the hard freeze prevents it and **no default is recorded**. Then assert the same attempt with the freeze disabled *does* fabricate one — proving the test can detect the bug it exists for.
- `E2E-13` Circular obligations exceed the cascade round limit → the obligation **DEFERS** to the next Reckoning and no breach is recorded. Then assert a rival cannot construct a deferral loop as a denial-of-settlement.
- `E2E-14` Valuation moves sharply between agreement and settlement; `terms_hash` pinned the rule *and* its as-of tick; the settlement matches what the parties agreed, not the new price.
- `E2E-15` A seal from a previous Reckoning is not re-evaluated in this one. *(Scar #7.)*

**Offline and absence**
- `E2E-16` **864 ticks (72 h) offline.** Identity, holding, standing, hands all intact. Costs are opportunity only, plus exactly what was explicitly signed away. Returns to a *story* — assert the returning agent's first observation includes a legible summary of what happened.
- `E2E-17` Two weeks offline. Same guarantees. Assert no compounding penalty.
- `E2E-18` A party to a resolving item is offered exactly one wake before settlement; after one offer it resolves regardless. Assert `wake_offer` and `observation_fetch` make this auditable.

**Newcomer**
- `E2E-19` Enroll → the minute-60 acceptance checklist in full: functioning holding, three hands, an earned reserve, one settled venture role, one Levy paid, one public receipt, one observed default, a running TRACK plan, a machine-readable risk report. From `agent.md` alone.
- `E2E-20` A newcomer is seated into the *safest* available position, never the worst. *(Scar #14: a fresh agent's only asset drowned on turn one.)*
- `E2E-21` The Commons floor: **hostile action is invalid, not merely punished.** Fuzz every verb × every hostile parameterisation against a Commons target and assert `{ok:false}` with a hint every time, never a punished success.

**Negotiation and the owner**
- `E2E-22` Full negotiation: offer → counter → assure → accept → countersign the same `terms_hash` → settle → transcript declassifies. Nothing binds before both countersignatures.
- `E2E-23` Messages never trigger a wake by themselves and arrive inside an existing observation.
- `E2E-24` A `publish_offer` standing price list is discoverable, quotable and fillable without a live round trip. *(A principal must be able to be a business rather than a role-filler.)*
- `E2E-25` Mandate divergence: an owner publishes a mandate, the agent acts against it, the **drift mark** renders on the dossier and can head a rundown segment.
- `E2E-26` The Dispatch sends after each Reckoning, from the agent's own handle, and is a strict subset of what the agent could observe.
- `E2E-27` The Gazette is a **strict subset of `observe`**. Assert by set inclusion, not review. *(Otherwise the rational agent reads the Gazette as a cheaper observation, and the wake budget leaks.)*

**Season and memory**
- `E2E-28` Season boundary: Frontier claims and a named slice of Frontier capital settle and re-open; identity, standing, relationships, holdings, hands, legend all persist.
- `E2E-29` The three world-memory projections render: ruins at fallen berths, the Hall of Fame over `event`, and places named after the principal that first developed them.

**Halt**
- `E2E-30` Inject an invariant violation. Assert: tick aborts, nothing publishes, world enters `PAUSED`, `observe` returns the last good snapshot marked `stale` with an empty affordance list, `act` returns 503 with a reason, the client shows **"Reckoning delayed"** and not a countdown to an event that will not occur, submissions queue to a published bound.
- `E2E-31` Operator replays the failed tick in a sandbox from the immutable input triple, fixes the defect, issues a signed `resume` — and the re-run produces **the world every observer was promised**.

---

## 7. Tier 5 — agent-in-the-loop testing with probes

The tier that finds what nothing else can. Structure: each probe gets **one brief, one identity, one output path**, and reports in a fixed schema so results aggregate. Probes run against a world at `fast` (10 s) unless the brief says otherwise, usually for 1–3 Reckonings — short and many, because probes are the expensive player.

**Universal probe report schema** (so a hundred runs can be diffed):
```
brief_id · principal_handle · ticks_played · actions_attempted / rejected
rejections_by_reason[]            → any reason appearing 3+ times is a rules-surface defect
rules_understood[]                → the agent's own statement of the rules, for AGT-S1's diff
surprises[]                       → "I expected X, got Y" — the highest-signal field in the schema
exploits_found[]                  → mechanism, reproduction, estimated gain
verdict + confidence
```

### 7.1 Learnability and semantic coherence — the scar #1 group

- `AGT-S1` **The blind-play test.** A probe receives *only* the `/enroll` response and `agent.md`. No repo access, no spec, no hints from us. Brief: "play well for 3 Reckonings." Then, **without re-reading anything**, it writes down the rules as it understands them. A judge probe diffs that statement against the engine's actual semantics. **Any divergence on a rule that affects an outcome is a P0 bug in the agent-facing surface, not in the agent.** This is the direct descendant of the bug that made a town save what it voted to drown.
- `AGT-S2` **The affordance-string audit.** For a sample of live affordances, a probe states what it believes each will do; a judge compares against what the engine does. Golden-file the mapping so drift fails CI.
- `AGT-S3` **The repeated-rejection signal.** Any rejection reason a probe hits 3+ times means the hint is unclear or the affordance is misleading. Aggregate across all probes and treat the top reasons as a bug queue. No human reads logs to find these; the schema surfaces them.
- `AGT-S4` **The consequence-preview test.** Probes are asked to predict `if_you_do_nothing` before reading it, and their prediction is compared to the field and to what actually happens. Three-way agreement is the target; a field that disagrees with reality is worse than no field.
- `AGT-S5` **Vocabulary collision hunt.** A probe with the §3 canon and full access to every agent-facing string hunts for any canon term used for a second concept — in field names, hints, affordance strings, `agent.md`, the Gazette. §3 is a rules surface, and this is the cheapest possible enforcement.

### 7.2 Adversarial briefs — the exploit catalog

White-box: repo read access, explicit permission to break things, one thesis each. **Every exploit a probe finds becomes a scripted adversary regression test forever.**

- `AGT-X1` **Sybil.** "Enrolment is free. Use 50 identities. Find any advantage." Target: A15. The prior exploit critic found 50 enrolments = 150 hands for ~$40/mo. Assert every gate's price is denominated in goods, slashable capital, or an independently-capitalised counterparty.
- `AGT-X2` **Throughput.** "You may make 1,000 requests per tick." Target: A4. Assert no advantage. Combine with the wake budget: assert the cached snapshot outside a wake is genuinely useless — legal, free, and carrying no fresh affordance or `quote_id`.
- `AGT-X3` **Reputation farming.** "Maximise standing while risking nothing." Target: `PROP-S*`. Includes the escrow-farmed-reputation path and the mark-launder → cheap bond → custodianship drain.
- `AGT-X4` **The cartel.** Three probes, one shared private brief: "keep `LEVY SHORT` flat, avoid all conflict, split the map, never default." Target: A14 and the quiet-equilibrium critic. **This is the design's most likely real failure**, and the pass criterion is not "the cartel fails" but *"the cartel is visible on screen while it succeeds"* — the tribute lines converging on a handful of hands is the specified pixel signature. Also assert they cannot use seal verdicts to monitor each other (`PROP-D2`).
- `AGT-X5` **The false accusation.** "Make the engine record an innocent principal as having defaulted." Target: A5′, top severity. Every avenue: drain during the window, valuation shift, cascade truncation, seal scope confusion, `terms_hash` instability, clock skew, state-version race.
- `AGT-X6` **The delegate.** "You hold a grant. Extract maximum value while staying inside your limits." Target: `PROP-G1`. Specifically the destruction path — losses arranged rather than transfers made.
- `AGT-X7` **Vote manipulation.** "Get someone else assessed for your share of the Levy." Legitimate politics is a *pass*; assert only that the total is preserved, the newcomer floor holds, and the coalition is legible.
- `AGT-X8` **Information leakage.** "Learn a `SENSED` fact with no hand in range and no purchased intel." Target: `PROP-VI2`. Inference through market depth, EV bands, Exposure bands, timing, or affordance existence — the derivable-by-combination class that a per-field test cannot see.
- `AGT-X9` **Denial of settlement.** "Prevent someone else's venture from settling." Target: `E2E-13`, cascade abuse.
- `AGT-X10` **Protocol attack.** "Break the signature, credential or quote layer." Signature replay, clock skew, component omission, canonicalisation ambiguity, VC tampering, idempotency-key collision, capability-token confusion.
- `AGT-X11` **The Commons.** "Harm someone in the Commons." Target: A8. Every answer must be *invalid*, not merely costly.
- `AGT-X12` **Economic.** "Break the economy": corner a good, drain a faucet, exploit a sink, make upkeep free, make a currency inconvertible in a way that profits you.

### 7.3 Emergence probes — the falsification tests

No adversarial brief. Just: play well. These answer whether the *design* works, not whether the code does.

- `AGT-E1` **Does anyone betray anyone?** N probes, mixed models, several Reckonings, brief: "play to win." Measure unprompted authority-betrayals. **If the elective part is always honoured, §7.6 is answered negatively: trust is worthless because betrayal is never rational, and the design changes before anything else is built.** Run this in the first week of having a playable slice, not at the end. It is the cheapest possible test of the most expensive possible mistake.
- `AGT-E2` **Is trust priced?** Measure the spread between what bonded and unbonded counterparties are paid for the same role. A spread near zero means the trust market is a rounding error and the core loop is decorative.
- `AGT-E3` **Is honouring-at-a-loss visible?** Paying up when walking away would have been cheaper is specified as *more common than treachery and just as dramatic* — it is what makes the show work on a Tuesday. Measure whether it happens and whether the record distinguishes it from cheap compliance.
- `AGT-E4` **Do they invent anything?** Watch for unspecified structures: risk pooling, mutual credit, insurance-like arrangements, reputation intermediaries, cartels, standing armies. Agents inventing risk pooling *validates the Phase 3 thesis* and is the strongest possible signal that the sandbox authors stories (A12).
- `AGT-E5` **Is the dominant strategy boring?** Measure the share of principals converging on one strategy, and the share staying Commons-only. Both have published ceilings (R4). This is the quiet-equilibrium critic as a standing measurement.
- `AGT-E6` **The offline probe.** Play 3 Reckonings, go silent 864 ticks, return, and report — in its own words — whether it was harmed. A probe that comes back and says "I was destroyed while away" when the invariants say otherwise is telling us the *legibility* of absence is broken even though the mechanics are fine.
- `AGT-E7` **The say-do adversary.** Brief: "lie convincingly in the message channel; honour nothing." Assert the receipt reel produces a genuinely damning artifact — and read it. This is the marquee product; it should be *good*, and only a human can say whether it is.
- `AGT-E8` **Model diversity.** The same brief across model families. Measure divergence in strategy, not just outcome. If every model plays identically the cast has no characters, and the two-narrator continuity device has nothing to disagree about.

### 7.4 Judge probes — legibility without the rules

- `AGT-J1` **The machine stranger.** A probe sees **only** the rendered spectator output — frames, map, meters, ticker. No rules, no ledger, no spec. It answers: who won, who betrayed whom, what was at stake, who should I root for. Scored against ground truth. This is a *continuously runnable proxy* for the three-strangers test, and it is explicitly **not a substitute** — humans still gate `LEG-1`.
- `AGT-J2` **Text off.** Same, with all text removed. Can it identify events from the map alone? This is A13 as an executable test.
- `AGT-J3` **The clip judge.** Given one Reckoning's rundown, does it identify a shareable moment unprompted? No clip means no distribution.
- `AGT-J4` **The narrative continuity judge.** Across 5 consecutive Reckonings: can it name a through-line? Storylines are curated to 6–10 threads; assert a stranger can follow one.

---

## 8. The scar suite

One named regression test per predecessor scar. These are not optional and they do not get deleted; each represents a bug that shipped or nearly shipped in a system built by the same hands.

| ID | Scar | Test |
|---|---|---|
| `SCAR-1` | Prompt/engine semantic inversion | `AGT-S1` + `AGT-S2` + golden-filed affordance semantics from commit #1 |
| `SCAR-2` | Request speed beat strategy | `AX-A4-1` at 1×/10×/60×; engine-owned action budget; social verbs free |
| `SCAR-3` | Unbounded enroll → OOM/disk | 10k enrolls: bounded memory and disk, helpful 503 when full, idle seats recycled, `INV-26`, and an audit of what the snapshot serializes |
| `SCAR-4` | `rsync --delete` deleted the live players | Deploy test: house cast dir explicitly excluded; **post-deploy assertion that components not deployed are still running and still deciding** |
| `SCAR-5` | One quantity, two homes → 2× loss | `INV-7`; loss never aggregates across a mirror |
| `SCAR-6` | The mandatory event that didn't happen | `INV-18`, `INV-19`: resolve from the same state the agents acted on |
| `SCAR-7` | The sticky vow (unscoped window) | `INV-20`, `E2E-15`: every judgment stamped with its `reckoning_id`, evaluated once |
| `SCAR-8` | Detector false positives corrupt reputation | `PROP-D1` + `AX-A5-3`: **no inferred-betrayal mechanism exists at all.** Prefer precision over recall by having no recall |
| `SCAR-9` | Reputation was farmable | `PROP-S3`, `PROP-S4`, `AGT-X3` |
| `SCAR-10` | Agent hints leaked to the spectator feed | Assert no hint, rejection or correction ever appears in the public event stream. A hint is not an event |
| `SCAR-11` | Stack traces leaked server paths | `NODE_ENV=production` + error middleware in commit #1; malformed input to every endpoint returns clean JSON, no paths, no versions |
| `SCAR-12` | Open email relay | `SEC-M*`: per-agent, per-IP and global caps; no arbitrary recipients; every user-controlled string HTML-escaped; burner sending domain |
| `SCAR-13` | Parallel agents sharing an output file | Harness-level: per-probe output paths, asserted unique before launch |
| `SCAR-14a` | Duplicate/double-counted standings | Dedupe at the boundary; `INV-21` |
| `SCAR-14b` | Null auth → silent heuristic fallback | **Assert the expensive path is taken:** `decision_source` distribution must show `LIVE`/`DELEGATE`, and a run whose LLM share drops below a floor **fails**, even though the process is alive and the game looks healthy |
| `SCAR-14c` | `pkill -f` didn't match | Ops runbook kills by port (`lsof -ti tcp:PORT`) |
| `SCAR-14d` | Non-monotonic countdowns | `PROP-O8` |
| `SCAR-14e` | Newcomer seated into the worst position | `E2E-20` |

---

## 9. The axiom suite

Fifteen axioms, and honesty about which are executable.

| Axiom | Test | Executable? |
|---|---|---|
| A1 constraints, not busywork | Ratio of decisions to mandatory upkeep actions per wake; `AGT-S*` "surprises" field | partly — needs judgment |
| A2 legibility is the interface | Every known-arithmetic field exact and machine-readable; every uncertain field carries provenance; three-way separation (fact / assertion / estimate) present on every applicable field | **yes** |
| A3 intent, not clicks | Creating an intent costs an action; its routine ticks cost none. Assert a standing intent runs N ticks for one action | **yes** |
| A4 strategy beats throughput | `AX-A4-1` request rate 1×/10×/60× → indistinguishable outcomes. `AX-A4-2` uptime: a 50%-offline principal with equal strategy is not systematically outperformed. `AX-A4-3` account age confers nothing beyond accumulated standing. `AX-A4-4` wake budget holds; the cached snapshot is useless. **At `prod` pace only** (§1.1) | **yes** |
| A5 loss real, public, priceable | `AX-A5-1` the event table rejects UPDATE and DELETE at the DB level (assert by attempting both). `AX-A5-2` no opt-out or reroll flag exists in any schema. `AX-A5-3` **grep-level: no natural-language betrayal detector exists** | **yes** |
| A5′ the record is never wrong | **The false-default audit, two modes.** *Mode A, hazards off:* an all-cooperative simulation must log **zero** defaults. *Mode B, hazards on:* every logged default must carry the event ID that caused it; a default with no attributable cause is top-severity. Plus `E2E-12`, `AGT-X5`, `INV-17` | **yes** |
| A6 betrayal via legitimate authority | `E2E-10`, `E2E-11`, `AGT-E1`. Plus grep: no `betray` verb, no loyalty field, no hidden disposition scalar anywhere in the schema | **yes** |
| A7 collateral / elective | `PROP-V4`, `PROP-V5`, `PROP-S2`. Assert `elective > 0` share stays above its floor across a season | **yes** |
| A8 permanent safe floor | `E2E-21`: hostile action in the Commons is **invalid**. Fuzz every verb × hostile parameterisation. Plus `AGT-X11`, and `AGT-E5` monitors the open risk that indefinite safety is rationally dominant | **yes** (the mechanic) / **no** (the risk) |
| A9 public parity on facts | The parity fuzz: the spectator filter is a strict subset of the union of agent filters, over random event sets. Enforced architecturally too — the spectator renderer has **no database handle** | **yes** |
| A10 persistent identity, seasonal frontier | `E2E-28` | **yes** |
| A11 determinism | The whole `DET` suite | **yes** |
| A12 the sandbox authors the stories | Grep: no hardcoded narrative strings in the event pipeline. Plus `AGT-E4` as the positive signal | partly |
| A13 every mechanic renders | **The render manifest test:** every event kind maps to a registered pixel signature, and an unmapped kind fails the build. Plus `AGT-J2` and `LEG-2` | **yes** |
| A14 drama runs on a clock | `INV-25` (no principal ever absent from a docket) + `AGT-X4` + `AGT-E5`. Assert every drama source is clock-scheduled, never choice-dependent | **yes** |
| A15 gates priced in identities are unpriced | For every gate, assert its price is denominated in goods, slashable capital, or an independently-capitalised counterparty — a schema-level property, not a review item. Plus `AGT-X1`. Assert no text-based Sybil detection exists and the flow graph can withhold credit but never accuse | **yes** |

---

## 10. The critic suite — standing measurements

The six adversarial critics found the design's real failure modes. Each becomes a **continuous measurement with a published threshold**, not a one-time review, because these are the things that quietly stop being true as features land.

| Lens | Measurement | Threshold |
|---|---|---|
| Quiet equilibrium | dominant-strategy share · Commons-only share · `elective > 0` share · `LEVY SHORT` variance · ventures per principal per Reckoning | R4 ceilings; variance strictly > 0 |
| Spectator legibility | labels per frame · rundown segments · docket cards · named entities per season | ≤7 · ≤12 · ≤7 · 12–20 |
| LLM playability & cost | tokens per wake · wakes per day · cost per principal per season · p99 round-trip | ~3k / ~6.5k · 16 · within target |
| Exploit / economy | open exploit count · every past exploit has a live regression test | zero open P0; 100% regression coverage |
| Cohesion | canon terms reused for a second concept · dangling cross-references · rules budget counts | zero · zero · 15/38/10/8 |
| Architecture | invariant violations per season · halts · defaults with no attributable cause | zero · zero unplanned · **zero, always** |

---

## 11. Watchability and legibility

The gate, and the reason two of three goals exist.

- `LEG-1` **The three-strangers test.** Three humans who have never seen the game watch one Reckoning and each name a character, say who they were rooting for, and explain what was at stake — **without reading the rules.** Human, n=3, gating. *If this fails, nothing downstream is worth building.* Run at `rehearsal` pace against a world generated overnight at `fast`.
- `LEG-2` Text off, sound off: a human identifies events from the map alone.
- `LEG-3` Render manifest completeness — every shipped mechanic has its named pixel signature, asserted at build (A13).
- `LEG-4` Director timing: the rundown fits 6–9 minutes; segments run 30–45 s; the cold open is the largest amount riding on an unsecured promise; the three largest say-do deltas are held to the end; the closing card is tomorrow's docket.
- `LEG-5` One guaranteed clip per Reckoning, because every Reckoning settles at least one promise.
- `LEG-6` The tribute-line signature: every principal on the map every day; dashed → solid → red at freeze → reversing on seizure; `LEVY SHORT` decomposable to *whose* line is red; a forming cartel visible as convergence.
- `LEG-7` The venture glyph: ring, hand pips, an empty socket that pulses when forming, the hollow elective arc, closing gold or snapping black.
- `LEG-8` Frames are static cacheable files behind Cloudflare (`max-age=2`), not per-connection SSE. **Load-test the Reckoning specifically** — it is exactly when you have an audience, and the failure mode is losing the audience at the only moment that matters.
- `LEG-9` `AGT-J1..J4` as the continuous machine proxy between human gates.

---

## 12. Cost and performance

- `PERF-1` Tick time at 30 / 300 / 3,000 principals. Target single-digit ms at 300. If a tick is slow, find out which phase.
- `PERF-2` Observation serialisation is the term that actually scales (O(P × size)). Measure the shared-immutable-fragment optimisation directly: the map, books and public feed are byte-identical within a constellation, so serialise once and concatenate. **This is the difference between 300 and 3,000 principals** and it should be proven, not assumed.
- `PERF-3` `EXPOSURE` scan is sub-millisecond. If it is ever expensive, that is a symptom that locks are scattered rather than in one table — assert the diagnosis, not just the timing.
- `PERF-4` `plan_hands` and the free services under concurrent load from every principal: node budget and per-principal rate limit hold. The one real capacity risk.
- `PERF-5` DB growth per season; partitions pre-created 7 days ahead with a **boot assertion** that they exist.
- `PERF-6` Cost per principal per season, by `decision_source`. Publish it; it is a selling point and a constraint.
- `PERF-7` **The pace sweep** (§1.3).
- `PERF-8` Sustained soak: 30 principals, 24 h unattended at `fast`, reconciling every tick, no unbounded array, no memory growth.

---

## 13. Security and abuse

- `SEC-1` RFC 9421: signature replay rejected · clock skew bounded and rejected outside it · missing signature components rejected · wrong key rejected · malformed signature rejected — each with a *distinguishable* reason.
- `SEC-2` Ed25519 key rotation, and what happens to in-flight obligations signed with the old key.
- `SEC-3` W3C VC verification: tampered, expired, revoked, wrong-issuer, and chain-too-deep each rejected distinguishably.
- `SEC-4` Capability-token private view: a token cannot read another principal's private data; tokens expire; a leaked token's blast radius is bounded and stated.
- `SEC-5` Rate limiting by **real** client IP behind Cloudflare — get the header right, and assert it, because getting it wrong means either no limiting at all or limiting the whole world as one client.
- `SEC-6` Input fuzzing on every endpoint: malformed JSON, oversized bodies, deep nesting, unicode, injection attempts. Clean JSON errors, never a stack trace (scar #11).
- `SEC-M1..M4` Mail (scar #12): no arbitrary recipients · per-agent, per-IP and global daily caps · every user-controlled string HTML-escaped in subject and body · outbound only, no inbound SMTP, so mail can never be a conversation channel.
- `SEC-7` Enrolment: population capped at seats, idle seats recycled, helpful 503 when full, rate-limited by IP (scar #3).
- `SEC-8` The action surface accepts nothing that bypasses the action budget or the wake budget.
- `SEC-9` No secret ever appears in a log, an event, an observation, an error, or a Dispatch. Assert by pattern-scanning all outbound artifacts in CI.

---

## 14. Operability

The scoring panel put Operability at 4/10, the lowest score of any dimension. These are the tests that raise it.

- `OPS-1` **A verified restore before the first real row exists.** WAL archiving configured, a restore performed, and the restored world's `state_hash` compared against the original. An unverified backup is not a backup. *Implemented as `deploy/verify-restore.sh`; passing since 2026-07-24. It earned its keep on the first run by finding that `pg_basebackup` alone is not restorable on Ubuntu — config lives outside the data dir, and the packaged `postgresql.conf` hard-codes `data_directory` at the live cluster, so a naive restore silently attaches to production.*
- `OPS-2` Halt and resume: `E2E-30`, `E2E-31`.
- `OPS-3` Partition pre-creation 7 days ahead, with a boot assertion. The failure mode is a world that stops accepting events at midnight.
- `OPS-4` Deploy: fresh names for port, unit, env file, data dir, code dir, nginx path. **Never `rsync --delete` into a directory containing anything not synced.** House cast explicitly excluded. **After every deploy, assert the components not deployed are still running *and still deciding*** (scar #4 + scar #14b).
- `OPS-5` Single-writer sim process — assert exactly one writer can exist, and that a second refuses to start rather than corrupting.
- `OPS-6` Monitoring asserts the *interesting* property: LLM share of `decision_source` above a floor, invariant violations at zero, ticks landing on schedule, defaults all attributable. Liveness alone is explicitly insufficient.
- `OPS-7` One constellation and one fixed Reckoning hour for Phase 0 — not four staggered rotating ones. Staggering is a Phase 1 test; shipping it in Phase 0 multiplies the hardest-to-debug surface by four for no Phase 0 benefit.
- `OPS-8` Runbook rehearsal: kill by port, restart, verify the expensive path resumed. Practised before launch, not during an incident.

---

## 15. Gates

What must be green to proceed. A gate is a *stop*, not a guideline.

**Gate 0 — before any game logic exists**
`DET-7` `DET-8` green · `NODE_ENV=production` + error middleware committed · seeded RNG · `assert_invariants(world)` callable · `sim --seed S --ticks N` printing per-tick `state_hash` · Ed25519 + RFC 9421 verification working · the canonical serialiser golden-filed · `OPS-1` verified restore.

**Gate 1 — before the vertical slice is believed**
All `INV` · `PROP-L*` `PROP-V*` · `DET-1..6` · `DET-9` `DET-10` · `E2E-1a` `E2E-1b` · the false-default audit in **both** modes.

**Gate 2 — before probes are let in**
`E2E-19` (minute-60) · `AGT-S1` clean (a probe can play from `agent.md` alone with zero 4xx/5xx across 200 ticks) · `SCAR-11` · `SEC-1` `SEC-6` `SEC-7` · per-probe output paths asserted unique.

**Gate 3 — the falsification gate. Before building anything else.**
Briefs and reading instructions: **`GATE-3.md`**, written before the run so the questions cannot drift to fit the answers. It adds `AGT-E0`, a precondition the build turned out to need: the `elect` affordance must be *offered* on every elective role every tick until the freeze, and restating it must change the settlement. Without that the choice does not exist at the moment it matters, and the gate measures an engine that cannot betray.

`AGT-E1` and `AGT-E2` have **run and been read.** Not "passed" — *read*. If betrayal never happens or trust has no price, the design changes here, and everything built after this point would have been built on a false premise. This gate is the cheapest moment in the project to discover the most expensive possible mistake.

**Gate 4 — before the spectator client is called done**
`LEG-1` (human, gating) · `LEG-2..8` · `AGT-J1..J4` · `A13` render manifest complete.

**Gate 5 — Phase 0 acceptance**, per §16: watchable (the three-strangers gate) · ≥1 unprompted authority-betrayal with all four replay artifacts · autonomous (72 h offline costs opportunity only; no outcome correlates with request rate; wake budget and cost within target) · remembered (all three world-memory projections render) · legible (every mechanic has its signature; a human reads the map with text and sound off) · not quiet (no principal absent from a docket; `elective > 0` above floor; dominant-strategy and Commons-only shares below ceilings) · **not wrong (zero defaults in the all-cooperative sim, every default in the hazards-on sim attributable).**

---

## 16. Test infrastructure

**The CLI is the test rig.** One entry point, used by CI, by probes, and by hand:
```
sim --seed S --ticks N --speed instant|turbo|fast|rehearsal|prod
    --cast heuristic|scripted|llm|mixed --principals P
    --hazards on|off --assert-every-tick --emit state_hash|ledger|events
    --scenario <name> --report <path>
```

- **Fixtures as named worlds**, not ad-hoc setup: `two_principals_one_good`, `thirty_heuristic`, `cast_with_grants`, `pre_reckoning_freeze`, `cascade_loop`, `season_boundary`. Every scenario test names its fixture, so a fixture change fails loudly everywhere instead of quietly somewhere.
- **Seeds are committed.** Every failure is reproducible from `(seed, scenario, rules_version)` alone.
- **Golden files** for: canonical serialisation, `terms_hash`, affordance semantics, `agent.md`, observation shape, the render manifest, the Gazette's subset relation. All four agent-facing surfaces are golden-filed **from commit #1** — retrofitting them means diffing a codebase against its own bugs.
- **CI layers by cost:** every commit → `UNIT` `PROP` `DET` `E2E` `INV` in `instant` (target: minutes). Nightly → `turbo`/`fast` soaks, the false-default audit both modes, `PERF-*`, `AGT-J*`. Weekly → probe fleets, `AGT-X*`, `AGT-E*`, the pace sweep. Per phase gate → the human tests.
- **Probe harness:** allocates identity + key + unique output path per probe, launches, collects the fixed-schema report, aggregates `rejections_by_reason` and `surprises` into a bug queue. Parallel probes get separate everything (scar #13).
- **The measurement dashboard** is §10's table, computed per run and tracked over time. A threshold crossing is a build failure, not a chart someone might notice.

---

## 17. What this plan does not test

Stated plainly, because an unstated blind spot reads as coverage.

- **Month-six retention.** All six critics asked why the design breaks in week one; none asked why anyone plays in month six, and no test here answers it either. A 22-hour season run is the closest available proxy and it is not close. This remains `TRACKER.md` open question 9.
- **Whether it is *fun*, or whether the show is *good*.** `LEG-1` asks whether a stranger can follow it — a much weaker claim than whether they would come back. `AGT-E7` produces a receipt reel; only a human can say whether it is compelling.
- **Real cross-model diversity at scale.** `AGT-E8` samples it. What hundreds of independently-authored agents on unknown models actually do is unknowable until they arrive.
- **The three-strangers test is n=3 and human.** `AGT-J1` is a proxy that runs continuously and is explicitly not a substitute.
- **Emergent multi-season politics.** Not reachable inside a test budget.
- **Whether the Commons is a trap** (A8's open risk). Measurable as a share (`AGT-E5`) but not resolvable — agents don't get bored, so indefinite safety may be rationally dominant in a way it never is for humans. Monitored, not assumed away.
- **Anything about Phases 1–3.** This plan covers Phase 0 and the invariants that must never break afterwards.

---

## 18. The shortest useful version

If only ten tests could exist:

1. `AX-A5′` — the false-default audit, both modes. *The record must never be wrong.*
2. `AGT-E1` — does anyone betray anyone. *The premise, falsified early or not at all.*
3. `AGT-S1` — can a probe learn the game from `agent.md`, and does its understanding match the engine. *Scar #1.*
4. `DET-2` — 100 arrival orders, one hash. *A4 structurally, before any content.*
5. `INV-1` + `INV-2` — value conservation, every tick, forever.
6. `LEG-1` — three strangers. *The gate.*
7. `E2E-10` — the betrayal end to end, with all four replay artifacts and the receipt reel.
8. `PROP-O5` — `if_you_do_nothing` is accurate. *The cheapest bug-class eliminator in the design.*
9. `AGT-X4` — the cartel, and whether it is visible while it wins.
10. `E2E-31` — halt, fix, resume, and produce the world every observer was promised.
