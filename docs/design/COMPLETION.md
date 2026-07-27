# COMPLETION — how much of the game is built, and what is actually left

*Verified against the running code and the live world on 2026-07-26, not recalled. Every claim here
was checked by a command; the ones I could not check are marked **UNVERIFIED**. Re-verify before
trusting — this file goes stale the moment someone commits.*

> **Read this first each session, then update it.** The percentage question ("how far along are we?")
> has been answered three different ways in three different weeks because nobody wrote down what was
> being counted. This file fixes the denominator.

---

## The one-paragraph answer

**The machine is built and correct. The show is running on 8 of 13 surfaces. The cast does not
exercise four of the richest mechanics, and one of those four is the core loop.**

Phase 0's sixteen build steps all have real implementations, Phase 1's five areas do too, and 2,916
tests pass against them. Phase 2 and Phase 3 do not exist, which is by design — §16 marks Phase 2
"optional, possibly forever." The gap between "built" and "good" is not missing systems. It is that
the world has **one good**, and that the live cast has never once issued a grant, built a WORKS, or
formed a syndicate.

## Two honest denominators

Both numbers are defensible; they answer different questions, and quoting either alone misleads.

| Question | Answer | What it counts |
|---|---|---|
| Does the machine work, and did the premise survive falsification? | **~90%** | Phase 0+1 systems, invariants, determinism, durability, Gate 3 |
| Is there enough strategic depth for months of interesting agent decisions? | **~30%** | Distinct goods, real tradeoffs, mechanics the cast actually uses |
| Phase 2 (combat depth) | **0%** | Optional by design — §16 says "possibly forever" |
| Phase 3 (risk market) | **0%** | Deferred deliberately in the v2.0 reframe |

---

## Phase 0 — all sixteen steps have implementations

Checked by locating the module and its tests, not by reading the tracker.

| Step | Status | Evidence |
|---|---|---|
| 0 Test rig, Ed25519 + RFC 9421, seeded RNG, canonical golden files | ✅ | `src/identity/`, `src/core/rng.ts`, det-lint in `eslint.config.js` |
| 1 Ledger — accounts, postings, lots, encumbrances | ✅ | `src/ledger/` 3,564 loc · 71 test files |
| 2 Events — partitioning, audience fan-out, filters | ✅ | `src/events/` 1,862 loc · 18 test files |
| 3 World + hands + movement | ✅ | `src/world/` 3,045 loc · 58 test files |
| 4 Tick loop + frozen snapshot + ordered queue | ✅ | `src/tick/` 4,088 loc · 28 test files |
| 5 Ventures + settlement waterfall | ✅ | `src/venture/` 4,656 loc · 40 test files |
| 6 The Reckoning + hard freeze | ✅ | `src/reckoning/` 3,391 loc |
| 7 HTTP surface + `agent.md` | ✅ | `src/api/` 6,791 loc · 34 test files |
| 8 Heuristic cast | ✅ | `src/cast/` 3,615 loc · 43 test files |
| 9 Grants + offline semantics | ✅ | spread over **65 files** — `src/grant/book.ts` is only the book |
| 10 The Levy | ✅ | `src/levy/` 2,818 loc · 16 test files |
| 11 Markets | ✅ | `src/market/` 3,065 loc · 12 test files |
| 12 Predation / raids | ✅ | `src/predation/` 2,299 loc · 10 test files |
| 13 Spectator frames | ✅ | `src/frames/` 1,748 loc · 10 test files |
| 14 Seals + rundown | ✅ | `src/seal/` 3,280 loc · 19 test files |
| 15 LLM cast | ✅ | live in production, 12 members |

**All 40 of 40 canon verbs are implemented** — that is the §17 rules-budget *ceiling*, so the verb
surface is full rather than partial. Adding a mechanic now means spending a verb, not adding one.

### Phase 0 acceptance criteria — the honest column

§16 lists these, and they are the actual definition of Phase 0 being done.

| Criterion | Status |
|---|---|
| **Not wrong:** false-default audit logs zero defaults in an all-cooperative sim | ✅ tested |
| **Autonomous:** R19 — 864 ticks offline keeps identity, holding, standing | ✅ tested |
| **A4:** no outcome correlates with request rate | ✅ tested |
| **A9:** spectator filter is a strict subset of agent filters | ✅ tested |
| Supply conservation across 10k transfers | ✅ tested |
| Replay determinism — identical `state_hash` | ✅ tested |
| **Watchable (2):** ≥1 authority-betrayal occurs unprompted, replay shows grant + warning + seal + deed | ⚠️ **betrayal yes, grant no** — `AGT-E1` measured `kept 22 · broken 3` (12%), but via ventures; no *grant* has ever been issued in the live world, so the A6 replay artifact does not exist yet |
| **Remembered:** permanent ruin at a fallen holding | ✅ implemented |
| **Remembered:** Hall of Fame projection | ❌ **not built** |
| **Remembered:** places named after the principal that first developed them | ❌ **not built** |
| **Watchable (the gate):** three humans watch one Reckoning and each name a character, say who they rooted for, and what was at stake — *without reading the rules* | ❌ **never run.** Needs humans; cannot be automated. §16 calls this "the gate" and says if it fails, nothing downstream is worth building |

---

## Phase 1 — all five areas have implementations

`src/sovereignty/` (3,958 loc), syndicates, `src/works/` (574 loc), season boundary, siege/campaign
code. **`works` is by far the thinnest module in the tree** and it is the one the economy runs on.

---

## What is actually left, in priority order

### 1. The world has ONE good — this is the bottleneck

Every economic mechanic works and has nothing to chew on. `LEVY_GOOD`, `WORKS_GOOD`, `CHARGE_GOOD`
and `ENDOWMENT_GOOD` were a single constant with four names until 2026-07-26; they are now four
independent declarations with the same value (`'ration'`), which makes a second good a *local* edit
instead of one that silently moves three mechanics. Nothing below `GoodId` assumes one good.

With one commodity there is no trade, no specialization, no comparative advantage and no supply
chain — so `market` (3,065 loc, fully built) prices a single fungible thing. **This is the whole
distance between the 30% and the 90%.**

### 2. Four of the show's thirteen surfaces are empty, and one is the core loop

The live frame publishes 13 keys. Eight carry data: `map` 30 rows, `tributeLines` 21, `ticker` 14,
`rundown` 12, `glyphs` 7, `raidLines` 6, `docket` 1, `meters` 4. Four are empty:

| Surface | Rows | Why — verified, not guessed |
|---|---|---|
| `authorityLines` | 0 | **No grant has ever been issued in the live world.** A6 is the core loop and has no pixel signature live. The verb, the book, the invariants (INV-22/23), the VC serialisation and the renderer all exist and are wired |
| `worksLines` | 0 | Nobody has built a WORKS (D17). The affordance is offered in 70/70 observations and states its payback; the cast still never chooses it |
| `syndicateLines` | 0 | No syndicate has ever been formed |
| `claimLines` | 0 | 424 claims exist in the world, but `claimLinesFor` filters to the current Reckoning and none fall in it |

**All four render paths are implemented and wired into `FrameSource` in `src/sim/runtime.ts`.** The
emptiness is behavioural, not structural — the cast does not do these things. That is a different and
harder problem than a missing feature, and it is the same defect class as the earlier
"legal-but-unoffered" sweep, one layer up: the mechanics are now *offered* and still not *chosen*.

### 3. Role commitment makes the board thin (D19)

Filling a role commits a hand for the venture's life, and ventures resolve at Reckoning boundaries —
so filling early costs a third of your capacity for a whole cycle, while filling late costs a few
ticks. Measured: mean 60.4 committed ticks, median 11, p90 276. Consequence: the members who work
most act least, an 11× activity spread, and the supply side staffed by whoever is unemployed. Live
world right now: **4 live ventures out of 1,019 total.**

`hand_committed_ticks` was added to the board row as the legibility fix. **Whether it changed fill
timing has not been measured** — that is the open question, and the balance lever behind it (release
a hand at delivery rather than at settlement) is a design decision, not a bug fix.

### 4. Two "Remembered" projections, both read-only over an existing ledger

Hall of Fame and places-named-after-first-developer. §16 calls these three projections "the
difference between a world that has a history and one that only has a state." Ruins exist; these two
do not. Both are projections over `event`, so neither needs new state.

### 5. The three-humans watchability gate has never been run

It cannot be automated and §16 makes it the gate that decides whether anything downstream matters.

### 6. Docs contain refuted conclusions

`D18` and `D19` both have filenames and opening sections asserting causes their own measurements
later killed. Both carry contradiction banners, but a reader who skims the title gets the wrong
answer. Deliberate (the wrong reasoning is instructive and the commit trail must stay resolvable) —
but it means the doc set cannot be handed to anyone without a warning.

---

## Fixed on 2026-07-26, worth not re-finding

- **Boot replayed from genesis on every restart** — 4,809 ticks, 2m12s, growing without bound.
  `planCheckpoint` gated adoption on `journal_meta.rules_version`, which is **write-once** and
  records what the world was *born* under, so the first rules change made the mismatch permanent.
  Snapshots now carry the `RULES_VERSION` that produced them and adoption gates on that: one genesis
  replay per rules change, self-healing, same safety. **UNVERIFIED in production** — the first
  stamped snapshot writes at tick 4896; the restart after that is the proof.
- **The four goods constants were aliases** of one another (scar #5 in the import graph).

---

## How to keep this file honest

Each loop iteration: re-run the checks (module presence, live frame row counts, `/health` failures,
test count), update the numbers, and **change the prose when the numbers change.** The failure mode
this file exists to prevent is a status report assembled from memory — which happened, and produced a
confident diagnosis of a production outage read from a stale local file after a failed `curl`.
