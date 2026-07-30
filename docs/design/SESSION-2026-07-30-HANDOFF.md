# Handoff — 2026-07-30

*Written at the end of a long session, while six agents were still working. Command-verified where
stated; anything I could not verify is marked **UNVERIFIED**. `COMPLETION.md` is the standing ledger —
this file is the state of one night and the branches it left behind.*

---

## State at handoff

| | |
|---|---|
| master | `RULES_VERSION` **34**, 291 test files, ~3,692 tests green, `tsc` 0, lint 0 |
| production | healthy, `RULES_VERSION` **31**, tick ~9,200, `failures: []` |
| deploy | **HELD DELIBERATELY** — see "Why the deploy is held" |

### ★ Why the deploy is held

An adversarial review found that in Phase 3's risk market, **being struck by a catastrophe is
profitable**. Two cessions over one COVER each pay the whole loss: measured, a primary's stores went
**435,000 → 468,803 while paying out 18,803** — net **+18,803 for being insured and struck**. No halt,
no invariant, every guard green, because every guard is per-row and all rows were individually
correct. `bindCover`'s exclusivity and ceiling checks sit **inside `if (cover.over.kind === 'GOODS')`**
so a cession gets neither, and **there is no chain-sum conservation check anywhere in `src/risk/`**.

This is verbatim what `cover.ts`'s own header says exclusivity exists to prevent. Agent 36 was fixing
it. **Do not deploy a build carrying this.** Nothing in `src/` currently writes a COVER, so it is not
reachable from the affordance surface in production today — an LLM constructing the call by hand can
reach it.

---

## The three findings that outrank everything else

### 1. ⚑ FALSE — the record DOES remember live players. What it hides is what the payer owes.

> **This section's original claim was wrong and is kept because the correction is the finding.**
> Verified with three real signed identities over Ed25519 + RFC 9421 through the HTTP API, enrol →
> create → sign → fill → elect → settle → read `standing`:
>
> | creator's election | `standing` after settlement |
> |---|---|
> | `IN_FULL` ×2 | `electiveHonoured 2 · distinctCounterparties 2 · defaults 0` |
> | silence | `defaults 2 · lastDefaultTick 287` |
> | 1 minor unit | `defaults 2` — a unit is not a payment |
>
> Recording is **not** cast-only; `finaliseVenture` keys standing off `v.creator` with no notion of
> principal class. The play-test's zeros were almost certainly a magnitude error: **28,000 and 21,000
> were the `max_direct_loss` CEILINGS on the `elect` affordance, not payments.** `electiveDue = claim
> − min(claim, escrowed)`, so the realised elective is only the slice above escrow — the repro paid
> **154 against a 2,400 quote**. Measured in a mature heuristic world, 0 of 92 settled roles had
> `electiveDue == 0`.
>
> **That is the ninth probe claim in a row to be factually wrong, and the fourth time chasing a wrong
> claim found a different real bug underneath.** What was actually broken: **every elective figure
> faced the party being *paid*, never the payer.** A bare creator read `my_elective: 0` and
> `my_elective_direction: null` on the venture whose entire elective half it would be judged on — and
> **`sign` quoted the creator `max_contingent_liability: 0`**, the verb A6's *"with `max_direct_loss`
> and `max_contingent_liability` shown before you sign"* is named after, because the expression summed
> roles *already held* and a creator countersigns before any role is filled.
>
> Fixed on `lode-40` (`82a1e35`): `venture/preview.ts` owns the arithmetic once, so the row, both
> briefing sentences and `elect`'s own quote are one expression. The decisive mutation: **removing the
> `elect` affordance turns 6/6 of the new tests red while `test/sim/standing-accrual.test.ts` stays
> fully green** — the coverage gap, demonstrated rather than asserted.
>
> Still open, verified real: `projected_settlement` is `yourTakeAtP50`, so a bare creator reads **0**
> through FORMING/LIVE/SETTLED; `elect` is offered on a FORMING venture and the election is silently
> discarded if the window closes unfilled, *after* the affordance called a decline a permanent public
> default; and two `fill_role` affordances can name the **same hand**.

### 1b. The original (wrong) claim, for the record

Four real signed identities, 888 ticks, 5 settled ventures, ~84,000 of elective value:

| | did | recorded |
|---|---|---|
| `riv-vane` | `elect IN_FULL` × 2 — **paid 28,000** | `elective_honoured 0 · defaults 0 · distinct_counterparties 0` |
| `riv-obel` | elected **1 minor unit** against a **21,000** role | `defaults 0 · last_default null` |

**The honest payer and the explicit defaulter have identical, all-zero records.** The heuristic cast's
counters move normally in the same world (`p:varrow` 18 honoured, `p:vex` 3 defaults). So the
mechanism works for one class of principal and not the other.

A5, A6, A7, standing tiers, `INVERSE_EXPOSURE` and PARLEY's entitlement all read this ledger. **Every
promise measurement this project has ever taken — including Gate 3's `kept 22 · broken 3` — was taken
on heuristics.** Agent 40 was on it.

### 2. `src/observe/` is 5,796 lines production does not use

`buildObservation` is declared **twice** — `src/observe/observation.ts:421` and
`src/api/observe.ts:496` — and the server imports the `api/` one. Production reaches exactly two
symbols from the module (`slotClaimAt`, and a type). **21 test files assert against the unserved one.**

This explains three drift bugs that were each *"fixed on the served path"* while the parallel build
kept old behaviour: `freeCash`/`freeMinor`, `electiveTotal`/`maxElectiveLiability`, and a duplicated
levy-owed. **Owner decision needed: migrate the server onto it, or delete it and its tests.**

### 3. Nobody competes because emptiness is not published

`holding.graduation.ground[]` publishes `yield_per_tick`, `richness_bps`, `gate` — and **hides
`occupants`, `share_per_tick`, `rent_bps`, `rent_to`**, all four of which `works.here` publishes for
where you already stand.

Measured: a system advertising `yield_per_tick: 110` delivered `share_per_tick: 36` on landing and
**22/tick** once two rivals built there — *less than the 26/tick the player left behind in the Commons
for free*. **THE LODE spreads a tier ~15%; occupancy spreads it 430%.** A one-way 50,000 + 5,000
decision publishes the 15% term and hides the 430% one.

Three separate measurements said the cast never competes for rich ground. It cannot: emptiness is
invisible. Agent 35 was fixing this.

---

## Branches left open

All in `.claude/worktrees/`. None deployed. Versions were pre-assigned to avoid collision.

| version | lane | state at handoff |
|---|---|---|
| 35 | surface lies + the occupancy field | in flight |
| 36 | Phase 3's five criticals | in flight — **blocks the deploy** |
| 37 | live frames, A6 rendering, RECEIPT REEL join | in flight |
| **none spent** | `lode-38` — architecture, commit `bd2cdcd` | 3R/6R gates match master exactly; 9R + full suite were still running |
| 39 | `runtime.ts` handler extraction | in flight |
| 40 | the blank standing ledger | in flight — **the premise** |

**Version numbering protocol, which paid for itself four times tonight:** pre-assign to avoid the
collision, **renumber to the tail at merge**, and stack rather than blend — an operator reading a
`RULES_VERSION_MISMATCH` has to know which change moved which table.

---

## What landed tonight

Five features merged: **chokepoints** (THE PINCH, 10 of 35 lanes; threshold picked from a structural
break in the detour histogram, so any cutoff in 5..10 selects the same lanes), **capacity-limited
projection** (THE VERGE; reach 26 → 2–12; *offence is projected, defence is present*), **per-system
yield** (THE LODE; band `40..46`, tier totals conserved exactly), **destructible works** (THE RUIN),
**PARLEY** (`message {to, act, text}` — a third object on an existing verb, so verbs stay 40/40), and
**Phase 3's risk market** (`src/risk/`, 11 files).

Plus: the `haul` world-halts, A5′ attribution (`actedBy`), the A7 worst-case bound, the corrections
channel, and the served rulebook (`✓ the served rulebook matches this repo` is now a deploy gate).

---

## The outage, and the two gaps it exposed

Deploying 31 held production for ~90 minutes: `DET-9` at tick 7,128 in phase `HAZARD`.

**Cause.** `HAZARD` was an explicit no-op hook from commit #1 — the slot deliberately held so filling
it later would not shift any other phase's seeded draws. So its missing step-budget term was
*unobservable* for the project's whole life. Phase 3 gave the phase a subject and the first deploy
found it. Compounded by `riskHoldings` being O(lots²).

**Then I made it worse.** I added `STEP_BUDGET.perStoredLot` and wired the caller into the wrong file
— the call site is `tick/loop.ts:817`, not `sim/runtime.ts` — using a **string replace that does not
assert its match**, so it silently did nothing. It deployed twice, changed nothing, cap stuck at
1,760. Then the guard I wrote for it was vacuous: `typeof engine[hook] === 'function'` can never fail
when the field is `options.x ?? (() => 0)`.

**Gap 1, now fixed (`replayCheck.ts`).** The preflight passed `acceptDivergence: null` always, so for
a **pre-accepted** divergence it replayed to the declared tick and stopped — verifying 287 of ~9,000
ticks. The restart was the first thing that ever executed the other 8,700. It now runs a second boot
*through* the door to head. Its subject is **execution, not agreement**: once a divergence is accepted
the world is knowingly forked, so downstream hash tripwires stop being authority. An earlier revision
of the test asserted the hash case and passed a broken build straight through.

**Gap 2, still open.** The operator door computes its fingerprint **after** a ~12-minute gate 0.
Printing it first would have roughly halved the outage window. The door itself refused seven times
tonight and was right every time.

---

## Lessons worth keeping

- **A string replace that does not assert its match is a silent no-op.** Use edits that fail loudly on
  anything load-bearing. This cost the outage's second hour.
- **An unmoved number is the strongest evidence a fix did not land** — stronger than confirming the
  code is present. The budget printed `1760` twice and I read past it.
- **Assert non-vacuity before anything else.** Three guards written tonight, by me and by agents, were
  vacuous on first writing.
- **A pin that is arithmetic on the previous pin agrees with itself and nothing else.** Four times two
  branches each pinned the contract's unit count correctly for a tree without the other; every figure
  was stale at merge. Re-measure, never adjust.
- **`as never` does not launder a brand — it disables argument checking.** `world/lode.ts` used it on
  the one call INV-W1's integer-ness rests on. A `string` would have compiled.
- **The spelling trap, twice more:** `tick/loop.ts` held a `readString` under the name `readParam`, and
  a ninth reader copy (`readStringOrNullAt`) was found by a test after a name-based sweep missed it.
- **Probes are unreliable narrators and excellent detectors.** Wrong on engine facts eight times out
  of eight; three times chasing a wrong claim found a *different* real bug underneath.
- **Worktrees isolate a branch, not a file an agent edits outside its own tree.** Two agents collided
  in the main checkout; one reset the other's branch and committed onto it. Nothing was lost only
  because the victim noticed and *reported* it.
- **Four concurrent writers plus their sub-agents saturate the box.** Load hit 138 with 83 test
  processes; six suite runs were lost to contention. Run the suite alone.

---

## Ready for the visual layer?

`docs/design/VISUAL-READINESS-2026-07-30.md` is the specification — read it before drawing anything.
**15 of 26 named mechanics put something on screen; 11 draw nothing.**

The blocker is not a missing field, it is the **cadence**: a frame is published only on
`isSettlementTick`, which in production is **once per 24 hours**, while the client polls every 15
seconds. So `raidLines.ticksLeft` is 0 on 117 of 117 rows, `DEMANDED` never occurs, `FORMING` never
occurs, and `battleLines.gap` — which the code itself calls the most legible thing on the board — has
**never animated**. Agent 37 was adding live frames between Reckonings.

Good news for whoever draws: **THE PINCH (117 straits), THE LODE (189 differentiated systems) and THE
VERGE (234 rows)** are complete, varying, budget-checked, and referenced **zero** times by the client.
Eleven of 27 frame keys are drawn by nothing — pure drawing work, no engine change.

---

## Two calls that are the owner's

1. **Re-seed production.** The live shard has `kept: 0, broken: 0` across all 14 members after thirty
   Reckonings, 16 of 16 WORKS in the Commons, one claim in the galaxy, eight grants all `UNUSED`,
   `coverArcs: []`, `levyShort: 710,152`. A fresh world on the same code does `kept: 51, broken: 11`
   and `levyShort: 0` in two Reckonings. **Every "the cast never competes" measurement came from the
   dead shard.** A re-seed wipes a public record (A5/A10), so it must be a deliberate decision, not a
   cleanup.
2. **The three-humans watchability gate.** Three people watch one Reckoning and each name a character
   they rooted for and what was at stake, without reading the rules. §16 says everything downstream
   depends on it. Still unrun, still the cheapest item on the list, and it cannot be automated.

---

## The best moment anyone has had in this game

A delegate used its `steward` mandate to create a 40,000-value venture in its grantor's name **and**
cut a DOSSIER on its grantor's stores, handing it to that grantor's rival. The grantor's next briefing:

> *"Authority you granted is being USED, most of it by p:riv-obel: 1 venture(s) were signed in your
> name — v:507:84a0937e, **which you did not create and cannot unsign**; 1 DOSSIER(s) on your STORES
> have been cut and handed to p:riv-corr — permanent, re-handable forever, and nothing un-cuts one.
> **This is legitimate and none of it can be undone** — `revoke` bounds only what is LEFT."*

The player's verdict: *"That landed."* And: *"I would keep playing one more session, and only because
of the grant. I would not keep playing past that if the record still refused to remember it."*

**That is the honest state of this project. A6 works and lands. The ledger beneath it does not.**

---

## ⚠️ ONE BRANCH LEFT UNMERGED — `lode-35-surface`

**Everything else landed.** Master is `RULES_VERSION` **36** at `1467566`, with the five features, the
architecture pass, the elective fix, live frames, and all five Phase 3 criticals in. `lode-35-surface`
(commit `c9f8a3e`, worktree `.claude/worktrees/lode-35-surface`) is **fully gated and green on its own**
— `tsc` 0, lint 0, budgets 40/40, sweep `levyShort 0` / red `0/192 · 0/384 · 0/576` — and I aborted its
merge rather than rush it.

**Why:** three conflicts in `src/api/observe.ts`, plus one each in `server.ts` and `runtime.ts`.

⚑ **Corrected attribution.** I first wrote that the `observe.ts` conflicts were with the *live-frames*
agent's work. They are not — that agent's lane was `src/frames/`, the frame routes in `server.ts` and
`client/`, and it never opened `observe.ts`; it checked and told me so. The conflict is with **agent 40's**
minimal `src/api/observe.ts` edit (the elective fix: `my_elective_owed`, `my_elective_unelected`,
`OWED_BY_ME`, `sign`'s contingent column). The `server.ts` conflict *is* the frames agent's, over the
`publishLiveFrame` import. Getting this wrong would send the next reader to the wrong diff. Resolving
that needs real attention, and I was out of context — a botched merge of two agents' observation work is
worse than an unmerged branch. `git merge --abort` left the tree clean.

**How to finish it:**

1. `git merge lode-35-surface`
2. **`server.ts`** — union the imports. Ours has `publishLiveFrame` (frames agent); theirs adds `join`
   from `node:path` plus `FRAME_INDEX`, `frameFileName`, `LATEST`. Both are needed.
3. **`runtime.ts`** — union the version notes, then **renumber 35 → 37** (master took 36 for the risk
   market). Protocol: *pre-assign to avoid the collision, renumber to the tail at merge*, stacked not
   blended.
4. **`observe.ts`** — the three real ones. Read both sides; they are additive in intent (new published
   fields on one side, new affordance text on the other), but check by hand rather than unioning: a
   union cut a docblock in half earlier tonight and duplicated a declaration twice.
5. **Re-measure the contract pins, do not adjust them.** This branch reports analytic max **101,273**
   and worst reachable **94,754** — but master has moved twice since, so both are stale. The re-measure
   rule earned itself again inside this very branch: its own first reading was 101,272 and its second
   101,273, *because reflowing one pinned sentence added a newline*.

### What is in it, and why it is worth finishing

- **The occupancy field**, measured over 516 crossing decisions across 8 worlds: ranking by the old
  row's only signal lands on mean `share_per_tick` **40.06**; ranking by the new field lands on
  **47.72**, and in **242 of 516 (47%)** the old row picks strictly worse ground. Launch map: the
  richest MARCHES system with four occupants pays an arriving fifth **23**; the poorest empty one pays
  **100** — a **4.35×** spread against the lode's 15%.
- **★ And the honest finding that resolves the whole "nobody competes" question:** the heuristic cast's
  destination choice **does not move**, because `graduateFor` reads `worksQuote(...).sharePerTick`
  directly off the engine rather than through the observation. *The cast was never blind — only agents
  were.* So the field changes nothing for the cast and everything for a real player, which is exactly
  why three separate measurements read "the cast never competes for rich ground."
- Underneath it: `worksQuote`'s `held` asked a **global** question (`ofPrincipal`), so a principal
  holding a WORKS anywhere was quoted `yield / occupants` for every *other* system — 22% high at four
  occupants — while `alreadyHeld`, two dozen lines away, was already per-system.
- **`sealVerdict` printed `HONOURED` over a contradiction standing had already been charged for.**
  `if (rec.role === null) continue` dropped the seal `SealBook.resolve` had charged, and the map keyed
  on `rec.role.venture` (the free *slot*) instead of `intent.target` (what was promised).
  `test/frames/` had **zero** `CONTRADICTED` assertions before this.
- **Hands on your own demand.** `readForce` scored the raider one point per *principal* with sway read
  as a boolean, while the target's own hands counted one each — contradicting `SWAY_STATEMENT`, which
  ships verbatim, and `campaign/pulse.ts`, which already computes `min(present, sway)`. No verb spent;
  `move` is the act. And the `your_side !== null` arm of the raid affordance chain **did not exist**:
  an initiator got no offer, no withheld row, and no counter.
- `build {ANCHOR}` named every cost except **rent**, so a claim over ground nobody works read identically
  to a good one. `move` said nothing about a **STRAIT**, which at 35 decides whether the walk buys force.

### Three claims it proved FALSE, worth keeping

- `sealVerdict` was **not** hardcoded — there is a live `CONTRADICTED` branch. The symptom was real and
  the cause was two filters.
- `join {campaign}` offering a Commons-seated principal both sides **was fixed at 24**. One live
  instance of that shape remained, and it is not keyed on tier at all: it fires on `targets.length === 0`
  — a *missing param* — and then prints a sentence about the Commons.
- `grant`'s absence was **not** an unfixed affordance. The 5C fix added the affordance; the *accounting*
  was never added, and `withheld-is-accountable.spec.ts` had already **measured** 45.7% silence and
  filed it `OPEN` against a reason describing a gate the code does not have.

## ⚠️ A SECOND BRANCH LEFT UNMERGED — `lode-39` (the monolith extraction)

Same call and the same reason as `lode-35-surface`: green on its own, one conflict in `runtime.ts`
where **ours is 26,282 characters against theirs at 353** (the risk market's block against the
extraction's), and I was out of context. `git merge --abort` left the tree clean. Branch `lode-39`,
five commits, worktree `.claude/worktrees/lode-39-runtime`. `RULES_VERSION` unspent — nothing in it
changes legality, so no operator door is needed.

**Its `state_hash` evidence is the model to copy:** per-tick streams, not just final hashes,
byte-identical against a detached master worktree across four 900-tick seeds plus one at 1,800 ticks ×
16 principals. And it stated its own non-vacuity honestly: the cast applies `form` 12× (real evidence)
but **never issues `admit` or `apply` in 900 ticks**, so hash equality there is necessary and *vacuous*
— it proves nothing else broke, and those two rest on tests plus mutation instead.

**It also reported line counts against itself, as asked:** `runtime.ts` 16,075 → 16,021 (**−54**) while
new production code is **+631**, so **net +577**. The coupling argument is the real one: `vForm` no
longer touches `this.ledger`, `vAdmit` no longer touches `this.world`, and `test/syndicate` went 4
files/37 tests → 7/67.

### ★ THE FINDING THAT MATTERS MORE THAN THE REFACTOR

**`form-through-the-front-door`'s `act()` helper asserts only HTTP 200 — and in this engine an illegal
move IS a 200 carrying `{ok:false, hint}`.** So it cannot distinguish success from refusal, and every
widening mutation passed it. **All 5 of `admit`'s gates and 3 of `form`'s were untested.** 19 previously
surviving mutations now fail.

This is the vacuous-guard defect in the *test harness* rather than in a guard, so it silently weakens
every test built on that helper. **Whoever continues must fix `act()` to assert on the refusal rather
than the status code**, or the same survivals recur in every syndicate-adjacent extraction.

### Also found by reading

- **A fourth mis-landed edit in `runtime.ts`**, after the three D21 was written to explain: the
  `isMember → contribute` block is present **twice** in `vApply`, the second copy unreachable, each
  under its own near-duplicate comment. It compiled and passed everything.
- **`sim --hazards on|off` is inert** — proven with identical 300-tick hash streams, not argued.
  `Runtime.hazards` never had a reader and `HAZARD` now runs `frontNow` unconditionally. Field deleted,
  option kept so `cli.ts` compiles. *Whether `frontNow` should be behind that switch is a design call.*
- **`api/observe.ts:3755` duplicates both `form` gates**, and `formRefusal` is exported and shaped to
  replace them — left unwired because that file was another lane.

### Next three, re-measured (D21's table predates 6,300 lines of growth — 39 handlers now, not 27)

1. **`vApprove` + `proposeOffice` + `carryOffice`** — finishes the syndicate cluster; the module, port
   convention and fixtures now exist. Wrinkle: `carryOffice` re-enters `vGrant`, so the port needs a
   callback member.
2. **`vSeal`** — heuristic-exercised at 110 seals/900 ticks, so the last big handler where `state_hash`
   gives *non-vacuous* evidence, and the largest line win at low coupling.
3. **`vRevoke`** — establishes the grant-book port that `vGrant`, A6's core loop, will reuse.

### One process note it disclosed itself

It ran `pkill -f vitest` to relieve load at 250 — which matched **every** agent's vitest, not just its
own — and saw `lode-37-frames` re-running specs afterward. Disclosed rather than hidden, which is why
it is written down. A shared box needs a shared convention for this; killing by worktree path is the
obvious one.
