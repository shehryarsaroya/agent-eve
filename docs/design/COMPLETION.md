# COMPLETION — how much of the game is built, and what is actually left

*Verified against the running code and the live world on 2026-07-26, not recalled. Every claim here
was checked by a command; the ones I could not check are marked **UNVERIFIED**. Re-verify before
trusting — this file goes stale the moment someone commits.*

> **Read this first each session, then update it.** The percentage question ("how far along are we?")
> has been answered three different ways in three different weeks because nobody wrote down what was
> being counted. This file fixes the denominator.

---

## The one-paragraph answer

**The machine is built and correct, the core loop closes without a human in it, and 12 of 13 show
surfaces carry data. The gap is no longer mechanics; as of `RULES_VERSION` 18 it is no longer the
number of goods; and as of `RULES_VERSION` 19 it is no longer the absence of a price. **THE MARKET
PRINTS FILLS.** D7's endowment floor is now a per-principal counter that falls as a principal spends
into world sinks, so `freeCash` stops being identically zero, and the buy side is reachable for the
first time in the project's life: **18 fills across 8 seeds at six Reckonings**, 500 `alloy` at 12
minor, between principals nobody funded by hand. What is left is depth. See §1.**

Phase 0's sixteen build steps all have real implementations, Phase 1's five areas do too, and **3,274
tests** pass against them (2026-07-27, `RULES_VERSION` **18**; **17** is the last version deployed). Phase 2 and Phase 3 do not exist
as *complete* layers, by design — §16 marks Phase 2 "optional, possibly forever" and the owner has
overridden that; combat is partly in.

As of 2026-07-26 (late), a world nobody steers hands out authority *and draws on it* (~31 grants, ~27
draws per 900 ticks), raises WORKS so goods have a source, founds syndicates, and carries all three of
§16's world-memory projections. The four empty panels were a **cast** gap in every case: the mechanic
built, the affordance offered, and no branch ever selecting it.

**2026-07-27: the same gap, ninth instance, at the deepest level yet.** §5.2's escrowable share may be
carried by another principal's hand, `deliver {payer}` had always implemented it, and `paidOther` was
**0 in every world this repo had ever run** — no affordance, no cast branch, and no column in any
instrument that would have shown the zero. Offering it took the nine-Reckoning `levyShort` from
**202,540 to 8,051** and red tribute lines from **19/576 to 1/576** (`TRACKER.md` `D26`). Read that as
the standing warning this file exists for: *the gap is rarely the mechanic.*

**2026-07-27 (later): the tenth and eleventh instances, and the eleventh was hiding inside the tenth.**
§3's EXPOSURE — *Σ open `max_direct_loss`* — was **identically zero for every principal at every phase
of every Reckoning**, so three of the Levy's four allocation rules (`BY_EXPOSURE`, `EVEN`, and the
published default `INVERSE_EXPOSURE`) handed everybody one flat weight on 18 of 18 dockets, and A7's
*staked* half had no instance anywhere. `D30` blamed the cast passing `stake: 0`; that was half of it.
**`venture/settlement.ts:lockFillStake` — the function that implements §7.3's escrow-at-fill-time, with
the section quoted above it and its own unit test — had no caller in `src/`.** Fixing both took the
nine-Reckoning `levyShort` from **8,051 to 0** and red tribute lines from **1/576 to 0/576**, eight of
eight seeds spotless (`RULES_VERSION` 16, `D31`). Exercising it then surfaced a live defect within the
hour: `weightOf('BY_EXPOSURE')` was `1 + exposure`, a cardinality against a MINOR quantity, and the
first docket with any EXPOSURE at all billed one member **118,449 of 120,000 over 450 of peril**
(`D32`). Two lessons compound here — *read the log before asserting an absence*, and **a capability's
first real exercise is a bug-finding instrument in its own right.**

**2026-07-27 (later still): the twelfth instance, and it was a CLOCK rather than a caller.** Making the
cast stake was necessary and not sufficient: the two exposure-shaped rules still agreed on **117 of 129
dockets**, because `settleVenture` releases every stake at the settlement tick and `LEVY_ASSESS_PHASE`
mints the docket on the **next** one, so the assessment sampled a **22x trough**. A capability can be
built, called, and exercised, and *still* be measured at the one moment it reads zero. The fix is a
**per-Reckoning EXPOSURE high-water mark** — a new hashed field, `RULES_VERSION` **17** — and on the 40
dockets in eight seeds that can discriminate at all, spread goes from **12 (30%) to 37 (93%)** with the
gate held at `levyShort` 0 and 0 red lines at three, six and nine Reckonings (`D34`). The new lesson is
narrower than the old one and worth its own line: **measuring a real quantity at the wrong moment is
indistinguishable from not measuring it**, and it is the third bug in this one mechanic from that
family — after a currency balance sizing a goods bill and a cash-poverty `spare` pick.

**2026-07-27: the thirteenth instance, and it is the biggest one yet because it is a PRICE.**
`market/` is 3,065 lines that had never held an order in the project's life, and the diagnosis in this
file had always been *"it prices a single fungible commodity"*. That was true and it was not the
binding constraint. `market/escrow.ts:freeCash` funded a BID from `freeBalance − ENDOWMENT_FLOOR_MINOR`;
D7 set that floor to the **whole** 250,000 `STARTER_STAKE`; and every cast member in every world sits
between **62,000 and 203,000**. So `freeCash` was **identically zero for every principal that has ever
played**, and the buy side was unreachable by construction since the market landed.
`ledger/endowment.ts` predicted the over-withholding in its own comment and **no instrument had ever
printed the figure**, which is the same shape as `paidOther` one layer up.

**★ CLOSED THE SAME DAY, `RULES_VERSION` 19 (`D36`).** The floor is now a per-principal counter
(`Ledger.endowments`) initialised to the stake and decremented only by `Ledger.retireCurrency` — so it
falls exactly as a principal burns currency into a world sink, and `freeCash = freeBalance −
remaining`. **A15 survives as an exact identity rather than an argument**: `balance − remaining =
received − sent`, the endowment cancels out, a retirement is `freeCash`-neutral, and a fresh identity
is still worth **zero** to its operator. Measured over every principal of eight real worlds. The
market now prints fills.

What is left is depth, not machinery. The distance between the two numbers below is no longer "one
good", and no longer "nothing can be bought" — it is **how much there is to decide** once you can.

## Two honest denominators

Both numbers are defensible; they answer different questions, and quoting either alone misleads.

| Question | Answer | What it counts |
|---|---|---|
| Does the machine work, and did the premise survive falsification? | **~90%** | Phase 0+1 systems, invariants, determinism, durability, Gate 3 |
| Is there enough strategic depth for months of interesting agent decisions? | **~50%** | Distinct goods, real tradeoffs, mechanics the cast actually uses. Up from ~45%: `RULES_VERSION` 19 gives the order book a **demand side** (`D36`), so the fourth good's geographic price gradient is finally a price somebody pays — and the ore fork (tonight's tribute or tomorrow's ground) now has a third arm, which is what took `CAST_ALLOY_RESERVE_RECKONINGS` from 2 to 3. Still capped well below 90%, and the cap has moved again: it is no longer "one good" and no longer "nobody can buy". It is that **only one good is actually traded** — the cast's market branches name `alloy` and nothing else — and Phase 2's depth is not built |
| Phase 2 (combat depth) | **~70%** | ⚑ **NO LONGER OPTIONAL** — owner decision 2026-07-27 overrides §16's "possibly forever". **Built and live at `RULES_VERSION` 16**: `src/combat/` 6,407 loc, the `engage` verb, 5 hulls, 29 modules, four slot rows with CPU/grid/calibration/hardpoints, a published stacking curve, four damage types against three tank layers, five roles *earned from what is fitted*, the ENGAGEMENT phase clock, and THE BATTLE LINE on the frame. The cast flies it — 18 hulls, 25 battles, 16 world hulls killed across 32 seeds — and composition provably pays at coalition scale (a 1:5 support wing holds the field identically while turning 17 lost hulls into **zero**). What is missing is not the layer: **no cast branch uses `join`**, so no sim has ever reached even 8 of the 12 allowed parties, and the thing that makes composition matter is unexercised |
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
| **Watchable (2):** ≥1 authority-betrayal occurs unprompted, replay shows grant + warning + seal + deed | ⚠️ **now MEASURABLE, not yet measured.** `AGT-E1` found `kept 22 · broken 3` (12%) — but via *ventures*, not authority. As of 2026-07-26 grants are issued AND drawn on (~27 draws/900 ticks), so the seat betrayal happens from finally exists and production produces the artifact. Whether an LLM in that seat turns a mandate against its grantor is the open measurement, and §7.6 requires the answer be allowed to come back "no" |
| **Remembered:** permanent ruin at a fallen holding | ✅ implemented |
| **Remembered:** Hall of Fame projection | ✅ built — 4 rows on the frame, honesty mutation-tested |
| **Remembered:** places named after the principal that first developed them | ✅ built — razed WORKS included, so a place keeps its founder's name |
| **Watchable (the gate):** three humans watch one Reckoning and each name a character, say who they rooted for, and what was at stake — *without reading the rules* | ❌ **never run.** Needs humans; cannot be automated. §16 calls this "the gate" and says if it fails, nothing downstream is worth building |

---

## Phase 1 — all five areas have implementations

`src/sovereignty/` (3,958 loc), syndicates, `src/works/` (574 loc), season boundary, siege/campaign
code. **`works` is by far the thinnest module in the tree** and it is the one the economy runs on.

---

## What is actually left, in priority order

### 1. ~~The world has THREE goods and ONE tradeable one~~ → FOUR, and the bottleneck moved somewhere nobody had looked

**Updated 2026-07-27 (`RULES_VERSION` 18, `D35`).** `alloy` lands as §10's fourth good — refined from
`ore` by `refine {kind:"ALLOY"}` at a rate set by the **tier** (`COMMONS 8:1 · MARCHES 32:1 ·
FRONTIER 64:1`), a gradient that runs **opposite** to the ore yield (80 · 110 · 150). The tier with the
least ore converts it best, so ore flows inward and alloy flows outward and neither side can
substitute. It buys territory and nothing else, and it is payable against **no obligation**, so nobody
can be recorded short of it. `haul` — a canon verb filed under *"step 11"* since the canon was written
— goes live with it, so goods can move for the first time. `audit:budgets` reads 40/40 before and
after.

**The Levy is untouched and the gate is spotless at all three horizons.** All four obligation constants
still read `ration`, `goods-are-independent.test.ts` is green, and 8 seeds give `levyShort` **0** and
red tribute lines **0/192 · 0/384 · 0/576** at 3, 6 and 9 Reckonings — eight of eight, matching master,
on the only two meters a null control leaves standing.

**What it costs is territory, and the number is large enough to state plainly:** `claims` 28 → **17** at
3R and 29 → 23 at 6R, with `rent` falling further because the claims that do happen happen later. An
anchor now needs 16,000 ore of somebody's industry and the cast will not divert that until its tribute
is two Reckonings covered. That reserve took **four measurements** to get right and three plausible
readings of it each failed differently at nine Reckonings (`D35`) — including one that guarded a stock
the spend never touched, and one that approved a 16,000-ore decision four thousand at a time.

#### ★ The answer to "why has the market never cleared" was not the number of goods — and it is FIXED

Measured before anything was built, four seeded worlds at six Reckonings: **0 orders placed, 0 fills
printed, ever.** The cause was one expression:

```
market/escrow.ts:freeCash = freeBalance − ENDOWMENT_FLOOR_MINOR      floor = STARTER_STAKE = 250,000
every cast member, every world, after play ................... 62,000 – 203,000
so freeCash ..................................................         0, for everyone, always
```

**No principal that had ever played this game could fund a market BID.** `ledger/endowment.ts`
predicted it — *"erring toward withholding is the safe direction"* — and nothing had measured what the
erring cost. It cost the entire buy side.

**`RULES_VERSION` 19 (`D36`) makes the floor per-principal and mobile.** `Ledger.endowments` starts at
the stake and is decremented by `Ledger.retireCurrency` alone, so `freeCash` is `freeBalance −
remaining` and a principal keeps what it earned however much endowment it has burned. Measured, 8
seeds × 6 Reckonings, cast only, nobody funded by hand:

```
fills ...............................  18   (was 0, in every world this repo has ever run)
principals with transferable_minor > 0   5 of 8   (was 0 of 8, always)
levyShort · red lines ...............   0 · 0/192 · 0/384 · 0/576   (unchanged from master)
rent (9 Reckonings) .................  22,869 → 72,732
```

A15 is preserved as an exact identity — `balance − remaining = received − sent`, so the endowment
cancels out and transferable currency is bounded by what a principal was **paid** — proved over every
principal of eight worlds in `test/market/the-buy-side-is-funded.spec.ts`, alongside the fill itself.
`test/works/a-good-only-the-commons-makes.spec.ts` remains the hand-funded fixture that proved the
chain works; it is no longer the only place a fill exists.

#### And one sink was built and then removed, which is the honest half

A surcharge on any crossing beyond the Commons (§10.1's *"convex in footprint"*) **closed the
Frontier** — the seat a crossing departs from holds no WORKS and therefore no ore — and
`HULL_COST_GOODS` needs FRONTIER-only fuel, so it closed the combat layer with it. The constant is
deleted rather than zeroed, and the diagnosis sits where it used to be.

### 1b. The old entry, kept because its diagnosis was right and its denominator was not

**Updated 2026-07-27.** There are now three: `ore` (what a WORKS yields), `ration` (what `refine` makes)
and `fuel` (FRONTIER-only, the economy's first comparative advantage). §10 specifies four.

But the sentence that matters is unchanged, and it is narrower than "one good": **every obligation is
still priced in `ration`.** `LEVY_GOOD`, `WORKS_GOOD`, `CHARGE_GOOD` and `ENDOWMENT_GOOD` are four
independent declarations that all read `'ration'` — deliberately, so the Levy stays payable from
domestic production, and `test/core/goods-are-independent.test.ts` asserts both the agreement *and*
the independence so a fourth good is a one-line edit. `ore` exists only to be refined and `fuel` only
to be burned by an anchor, so neither is something an agent *chooses between*.

So there is still no substitution, no specialization worth the name, and no supply chain to reason
about — `market` (3,065 loc, fully built) still prices a single fungible thing. **This remains the whole
distance between the 40% and the 90%**, and it is now the largest item in the repo that is specified,
unblocked, and untouched.

### 2. ~~Four of the show's thirteen surfaces are empty~~ → ONE, and it is not a cast gap

The live frame publishes 13 keys (15 with the two world-memory projections; **16 since `D38`, with the
market's `marketLines`**). Every one carries data except `claimLines`. All four that were empty on 2026-07-26 morning turned out to be the SAME
defect — the mechanic built, the affordance offered, and **no cast branch ever selecting it** — which is
the "legal-but-unoffered" sweep one layer up, and reads in every report exactly like a missing feature:

**Production fills FORWARD, not retroactively.** Boot replays the recorded action log, and those ticks
were produced by the old cast, so a restart does not backfill the panels — they populate as the world
runs on from the deploy.

| Surface | Rows | Why — verified, not guessed |
|---|---|---|
| `authorityLines` | ~~0~~ **FIXED** | The cast had no `grant` branch. Now 12 lines on a 900-tick world — see §"Fixed" below. Production will fill as the new build runs |
| `worksLines` | ~~0~~ **FIXED** | The cast had no `build` branch. Now 3 WORKS per 900-tick world, `EXTRACTING`, 35,040 goods — the economy has a source for the first time |
| `syndicateLines` | ~~0~~ **FIXED** | The cast had no `form` branch. Now 8 houses per 900-tick world |
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

### 4. ~~Two "Remembered" projections~~ — DONE 2026-07-26

All three of §16's world-memory projections now exist. Ruins already did (`holding.fellAtReckoning`);
`hallOfFame` and `places` were added as read-only projections in `src/frames/memory.ts` — no new state,
no `state_hash` movement, both on the frame.

`places` reads **razed** WORKS as well as standing ones, deliberately: a principal that opened a place
and lost it still named it, which is the asymmetry between history and state. A projection that dropped
razed rows would rename places as they change hands.

The Hall of Fame titles say what they MEASURED. §16 asks for "largest promise kept" and the standing
book holds cumulative value, not per-promise maxima, so the row reads `MOST KEPT, BY VALUE` rather than
claiming a superlative the data cannot support — and a row nothing supports is omitted rather than shown
as zero. `NEVER BROKEN A PROMISE` requires `defaults === 0` **and** `lastDefaultTick === null`, because
crowning someone unbroken above a recorded default is A5′ on the loudest surface in the game.

### 4b. ⚠ `src/sim/runtime.ts` is 9,664 lines — 12% of the codebase in one file

Not a correctness problem and not on any critic's list, but it is the biggest structural liability in
the tree and it was found by surveying rather than by recall. It holds **26 verb handlers, 141 private
helpers and 9 books** in a single class:

```
vYield vFight vJoin vCreate vFillRole vSign vElect vGrant vRevoke vWithdraw vAbandon
vPublishOffer vMessage vSay vSeal vTrade vPostBond vForm vApprove vApply vAdmit
vBuildWorks vBuild vGraduate vDeliver vVote
```

Why it matters in practice rather than in principle: every edit to it during 2026-07-26 needed careful
anchor-matching because the file cannot be held in view, and **one mutation test hit the wrong call
site** as a direct result — there were two `recordSpend` calls 400 lines apart, the test appeared to
pass, and the conclusion drawn was wrong until the tsc error gave it away. A file this size makes
"verify by reading" impossible and pushes everything onto tests.

The split is mechanical (verb handlers to per-domain files, the books they own alongside) and safe —
`state_hash` covers the state tables, not the file layout — but it touches the most safety-critical
surface in the engine and wants a session that starts with it. **Nothing else in this file is blocked
on it**, which is exactly why it will keep being deferred.

For scale: the next largest are `api/observe.ts` (2,866), `api/server.ts` (2,236), `tick/loop.ts`
(1,464). Nothing else exceeds 1,300.

### Not a gap, and worth stating so nobody re-audits it

- **All 26 invariants (INV-1…26) are declared and wired**, with 17 `skip()` sites in `aggregate.ts` so
  an invariant whose inputs are absent reports as SKIPPED rather than silently passing. That mechanism
  is what surfaced INV-22's vacuity — and note it did *not* catch it, because the journal was supplied
  and merely empty. Supplied is not non-empty.
- **`UNBUILT_PHASES` is empty.** All 13 tick phases exist: FREEZE_QUEUE · EXPIRE · MOVE · PREDATE ·
  MARKETS · PRODUCE · VENTURES · HAZARD · OBLIGE · DERIVE · ASSERT · COMMIT · WAKE.
- **Zero `TODO`/`FIXME`/`HACK` markers in 78,466 lines.** Deferred work is argued in prose with a
  reason, or it is not deferred.

### 4c. Scale: MEASURED at last — the number is wrong by ~10×, the conclusion survives

`SPEC.md` §15 and `CLAUDE.md` §6 both rest on *"at 300 principals a deterministic tick is **single-digit
milliseconds** on the target box, so every remaining risk is a correctness risk, not a capacity risk."*
That sentence decided where the entire engineering budget went — invariants over performance — and it
had **never been measured**, because it could not be: `--principals P` feeds `HeuristicCast({size: P})`
and the roster caps at `MAX_CAST` (20 names, since a cast name may never collide with a handle
`agent.md` uses as a worked example). Load-bearing and unfalsifiable at once, which is this project's
signature defect class one level above the code.

`scripts/population-scale.ts` is the instrument. 300 ticks per run, 20 warm-up ticks discarded:

```
  pop   total ms   per-tick ms   per-tick-per-principal   ventures
    4        569         1.895                   0.4738         55
    8       1243         4.143                   0.5178         94
   12       1123         3.745                   0.3121         71
   16       1468         4.894                   0.3059         75
   20       2318         7.727                   0.3864        110

  population ×5.0 → per-tick cost ×4.08   (scaling exponent ≈ 0.87)
```

**Sub-linear** — fixed overhead still dominates at these sizes, which is the good outcome. Naive
projection at 300: **~82 ms/tick**, an order of magnitude above "single-digit". So the *number* in the
docs is wrong.

**The conclusion it was used to justify is nevertheless sound, with enormous margin.** At the 5-minute
production tick, 82 ms is 0.03% of the budget; even at the 10-second `fast` speed it is 0.8%. Capacity
is genuinely not the risk. The docs should say "tens of milliseconds and comfortably inside any tick
budget" rather than a figure that is precise and false.

**Three caveats, because the measurement is worth exactly what its method is worth:**

- It is a **projection**, not a measurement at 300. Nothing here observed the target population.
- It ran on a dev machine, not on the VPS the claim names as "the target box".
- The curve is **non-monotonic** (pop 8 costs more per tick than pop 12) because different populations
  grow different worlds — 94 ventures against 71. Per-tick cost tracks *world content* at least as much
  as population, so a 300-principal world with proportionally more live ventures could sit well above
  the projection.

Known super-linear costs that will bend this curve upward eventually, both recorded as INV-26 debt:
INV-7 sums the whole posting log every tick, and `checkStandingJournal` replays **and sorts** its
journal every tick. Neither binds at 20.

### 4d. ★ THREE BLIND PROBES PLAYED IT, AND THE VERDICT IS 4/10

See `docs/design/expansion-2026-07-25/D22-what-three-blind-probes-found.md`. Five bugs, all fixed and
mutation-verified — including a Levy that stranded 45,000 units, `graduate` irreversibly graduating the
wrong principal from a dropped param, and the WORKS quote naming the wrong good.

**The pattern in all five: the engine was internally consistent and the agent-facing surface lied.**
Four could not have been caught by any invariant, because invariants check the world against itself and
these were failures of what the world *told an agent*.

The design verdict, reached independently by two probes: the API is excellent and the territorial layer
around `graduate` is genuinely good, but the premise — *"the best decisions are about other agents"* —
is **unstaffed, unreadable and unrewarded**. Nothing reads standing as a gate, so the dominant strategy
is a 40-line rentier; a mandate has zero expected value because a delegated `create` cannot bind
without the grantor; and there is no public read, so a reputation cannot be priced before it matters.

Those three are the highest-value remaining work in the project, and they are **design decisions**
rather than defects.

### 5. The three-humans watchability gate has never been run

It cannot be automated and §16 makes it the gate that decides whether anything downstream matters.

### 6. Docs contain refuted conclusions

`D18` and `D19` both have filenames and opening sections asserting causes their own measurements
later killed. Both carry contradiction banners, but a reader who skims the title gets the wrong
answer. Deliberate (the wrong reasoning is instructive and the commit trail must stay resolvable) —
but it means the doc set cannot be handed to anyone without a warning.

---

## 7. ⚠ CHECKPOINT ADOPTION IS BROKEN AND DISABLED IN PRODUCTION

The boot-cost problem below is **back on purpose**, and this is the most important open item.

`planCheckpoint` gated adoption on `journal_meta.rules_version`, which is write-once and records what
the world was *born* under — so the first rules change made the mismatch permanent and every boot
replayed from genesis forever. That gate was fixed (snapshots now carry the `RULES_VERSION` that
produced them, so it is one replay per rules change, self-healing).

**Which revealed that the adopt path had never once executed in production, and does not work:**

```
CHECKPOINT_UNUSABLE at tick 4895
posting (tick 2830, batch 0, index 1) moves value in account
escrow:v:2830:117e86ad:p:vale, which the snapshot's ledger capture does not contain.
The posting log and the snapshot describe different worlds.
```

The world **HELD** — the correct fail-closed answer, refusing to serve a record it could not
reproduce — but it was down ~4 minutes and the only lever was `UPDATE snapshot SET rules_version =
NULL` over SSH.

### ✅ RESOLVED 2026-07-27 — the record was superseded, and the refusal is CORRECT

**The ledger was never missing an account. The world was appending to a record it had been declared not
to own.** Diagnosed by querying the production database instead of reasoning about it:

```
journal_divergence   9 rows, EVERY one at tick 287, STATE_HASH_MISMATCH, rules 1 -> 2,4,5,6…9
posting log @ 2830   escrow:v:2830:117e86ad:p:vale    escrow:v:2830:69c52d4d:p:varrow
capture   @ 4895     escrow:v:2830:516e910d:p:vale    escrow:v:2830:f34917a2:p:varrow
counts    @ 4895     capture 5,542 postings / 2,791 events;  log 1,495 / 3,180
posting log min tick 2810   (action_log / event / tick_seed all start at 0)
```

Same tick, same principals, same two ventures — **different ids**. A venture id is
`hash(tick, principal, ordinal)` over a world-**global** counter (`Runtime.mintVentureId`), so a single
action refused under changed rules shifts the ordinal and **renames every venture minted after it,
forever.** The operator has accepted that discontinuity at tick 287 nine times; each acceptance forks
the live world from its own record at 287, while the world keeps appending to the *same* `posting` and
`event` tables. Those tables therefore hold rows from as many worlds as there have been rules changes,
and every snapshot after 287 describes only the current one.

So `p:vale` being an enrolled principal was **a coincidence** — `stores:p:vale` is present and
re-seating works fine. The enrolment/re-seating theory was chasing the one detail that did not matter.

**And the account check was the only thing standing between production and an outage.**
`hydrateAppendOnly` refused a count mismatch with a plain `LedgerError`, which boot could only turn into
a `BootError` with `operatorInstruction: null` — a HELD world, 503 on every route. Production's counts
disagree by **~4,000 rows**. It escaped that solely because a renamed account happened to appear 20
ticks into the log first.

**Boot time: 170 s → 170 s, and that is the answer, not a failure to fix it.** No code may reconcile
this record: A5 forbids rewriting a past row and A5′ says a wrong ledger is worse than a slow boot. A
world that has *not* forked adopts today and boots bounded, and the suite now pins that so the fix
cannot degrade into quietly disabling adoption. Moving the number requires a **decision, not a patch**:
a *record epoch* (on accepting a divergence, re-journal the re-derived ticks under a new epoch id —
append-only, nothing rewritten — and have adoption read only the current epoch; needs `epoch` on
`posting`/`event` plus the feed and archive readers), or a world that was never forked.

What landed: `planCheckpoint` refuses `RECORD_SUPERSEDED` **before reading a row**, naming the
discontinuity and both rules versions; refusals carry a machine-readable `CheckpointRefusalKind`
(prose is what let this survive three sessions); both count checks became **pre-mutation**
`CheckpointUnusableError`s; boot reads and checks **both** append-only halves before applying either
(getting this backwards produced a genesis replay running on an already-hydrated ledger — INV-1 ×30);
and adoption is refused outright on any boot carrying an accepted divergence tick. Reproduced first, in
`test/durability/a-forked-record-cannot-be-adopted.test.ts`.

**A second bug fell out of building the reproduction:** an adopted boot **named the wrong tick for the
operator door** — adopting at 575 it reported "first divergence at 576", while a genesis replay of the
same journal finds **66**. An operator who accepted 576 would be refused by the next boot that replayed
further back. A surface reporting a confidently wrong number, with a test that agreed with it.

---

*Everything below is the investigation trail, retained because its refuted theories are the lesson —
three sessions of confident reasoning that checking overturned in one. The conclusions in it are
**superseded** by the section above; the negative results still stand.*

Adoption now **degrades to a genesis replay instead of holding the world**, and this was verified
against the real production condition rather than a fixture: the tick-4895 snapshot was re-stamped,
adoption re-enabled, and the boot log reads

```
checkpoint adoption abandoned at tick 4895 and the world was replayed from genesis instead:
posting (tick 2830 …) moves value in account escrow:v:2830:117e86ad:p:vale …
boot REPLAY, head tick 4909, 4910 ticks replayed, 17 snapshot tripwires verified
```

— healthy, `failures: []`. `COMPACT_CHECKPOINT_ADOPTION` is back **on**, because a failed adoption now
costs exactly the genesis replay we were already paying and nothing more.

**[SUPERSEDED — the account check's premise was right, and it prevented an outage. See above.]** It claimed to
compare against "the accounts the snapshot itself held AT that tick" — but the snapshot is at 4895 and
the postings start at genesis, so an escrow that opened and closed in between is legitimately absent.
It assumed the final account set is a superset of every account ever referenced. Downgraded to
recoverable rather than deleted, because it still catches a genuinely mismatched log and the honest
fix needs a record of account closures that does not exist yet.

**So boot is still O(history)** — 4,910 ticks, ~139 s, growing — and will be until that is fixed. What
changed is that it can no longer take the world down. *(Confirmed 2026-07-27 at 170 s, and now known to
be unfixable in code for THIS world — the record is forked. See the resolution above.)*

**★ NARROWED 2026-07-26 (late), and the first theory was wrong.** The working explanation was "the
escrow closed before the checkpoint and its account was removed, so the capture no longer lists it."
**Both halves are false**, and checking beat reasoning:

- `ledgerStateTable.capture()` includes **every** account — `allAccounts()`, sorted, no filter and no
  cap — so nothing is omitted from a capture by policy;
- and there is **no account deletion anywhere in `ledger.ts`**. Accounts are never removed.

So the account genuinely was **not in the tick-4895 ledger at all**, while the durable posting log still
holds postings against it from tick 2830. That is a much sharper statement than "it closed", and it
points somewhere specific: **the two artifacts are rebuilt by different mechanisms.** The posting log is
durable and append-only; the ledger is rebuilt by REPLAYING the action log, and enrolments are re-seated
by a separate hook (`onEnrollment`) rather than by replayed actions.

So the candidate is: an account whose creator is not faithfully reproduced by replay — an enrolment
re-seated in a different order, or an action that once APPLIED and would now be refused — leaves a
replayed ledger that lacks the account while the posting log remembers it. `p:vale` being an externally
enrolled principal fits that shape exactly, and the house cast (re-seated deterministically from the
master seed, never stored) does not.

**Suspect 1 is now partly eliminated, by reading rather than guessing.** Seat recycling does NOT delete
a principal or its accounts: `seats.ts` says the seat row is *"never deleted"* and a returning dormant
principal *"keeps its identity, its holding and its standing; all it lost was the seat."* So recycling
cannot by itself remove an account from the ledger. What it could still do is change whether a
principal is RE-SEATED at boot — and `bootFromStore` deliberately does not re-seat enrolments inside an
adopted prefix ("already in the snapshot's `world` capture, so they must NOT be re-seated"), which is
the seam worth examining next.

**The instrument to build next:** a durability fixture that ENROLS a principal over HTTP, journals, and
adopts. `test/durability/` currently has none — every fixture there is cast-only, which is precisely why
900 ticks of heuristic world adopts cleanly and production does not. That gap is the reason this bug
survived.

**Also still true, and still the negative results that narrow it.** A 700-tick heuristic world
adopts correctly (hash-identical). Two fixture attempts failed instructively: dropping an account
from the capture is refused two gates earlier, and recomputing the hash makes the genesis replay trip
on that snapshot — because production's snapshot was **not wrong**, so any fixture that corrupts one
tests a different bug. `p:vale` is an externally **enrolled** principal and no local fixture enrols
agents; idle-seat recycling is the first mechanism to check.

**The deploy preflight cannot catch this and could not have.** `replayCheck` replays from genesis,
which works. Nothing exercises the adopt path against the real journal — the gap to close before
adoption is relied on for speed.

## Fixed on 2026-07-26, worth not re-finding

- **The four goods constants were aliases** of one another (scar #5 in the import graph).
- **A6 could not happen.** The heuristic cast emitted eight verbs and `grant` was not one of them, so
  ~83% of production decisions structurally could not exercise the core loop. `authorityLines: 0` was
  read for eight Reckonings as "the cast chooses not to delegate"; it was a missing branch. Now
  `grant=27` of 2,881 actions over 900 ticks and `authorityLines=12` on the frame — **A13 for the core
  loop, true for the first time.** The branch fires only when no hand is idle, so it adds a move for
  the hand-starved member (D19's halcyon, 96% committed) without displacing the busy one.

### ⚠ A6 IS ONE-THIRD BUILT, AND THE MISSING TWO-THIRDS IS NOT A CAST PROBLEM

### ⚑ Two corrections, both mine, in one day

**First I recorded this as "the cast never acts on delegated authority."** Then I "corrected" it to
"no delegate CAN — the capability does not exist," citing that `grantBook.spend()` is never called and
no verb accepts a mandate. **That second claim was wrong**, and it came from grepping for
`grantBook.spend` and `.spend(` when the method is `recordSpend`. `create` has supported delegated
action all along — `on_behalf_of` names the principal, `liveGrantBetween` infers the mandate, both
LIMITS are checked, and the draw is deliberately ordered before the transfer (AGT-X9).

So the *first* framing was closer to right. **What is true: the capability exists on two verbs and no
cast has ever used it.** The heuristic cast passes `on_behalf_of` on nothing and the LLM prompt never
mentions acting for another principal, so no world this project has run has produced a single draw —
every grant `UNUSED`, `spent: 0`, INV-22 auditing an empty journal, and the betrayal §16 asks for
never given a chance. `AGT-E1`'s measured 12% came through *ventures*, not authority.

That is a **cast gap, not an engine gap**, and much cheaper to close: a branch that acts under a held
mandate, not an authorisation path.

| A6 link | state |
|---|---|
| trust accrues from kept promises | ✅ standing, relations, `AGT-E1` answered |
| authority is granted, bounded, warned, rendered, revocable | ✅ built and exercised |
| a delegate CAN act under that authority | ✅ `create` (always) and `elect` (2026-07-26) |
| a cast actually does so | ✅ **31 grants, 23 draws** per 900-tick world |
| that action *can* be abused = betrayal | ✅ **possible for the first time** — same branch, different outcome |
| it *has* been abused, unprompted, on the record | ⏳ needs a live measurement, and must be allowed to come back "no" |

**A6 closes end to end.** A world nobody steers now hands out authority and draws on it: `halcyon` —
D19's 96%-hand-committed member — states elections out of another principal's treasury under a live
mandate, 1,800 contingent at a time, and INV-22 audits every draw. Nothing in that branch checks
whether paying is in the grantor's interest, deliberately (§16 forbids scripting the story): the same
code produces stewardship and treachery, and only the outcome differs. The grant, the accepted
warning and the deed are all on one record either way.

What remains is not a build step but a **measurement**: does an LLM in that seat turn a mandate
against its grantor? That is `AGT-E1`'s question for authority rather than ventures, and the design
insists the answer be allowed to come back "no".

**INV-22 audits the spend journal and reports green over an always-empty list.** `aggregate.ts` skips
the clause only when `grantSpends` is `undefined`, and `Runtime` always supplies
`grantBook.allSpends()` — so it is *supplied and empty*, INV-22 counts as having run, and no report can
tell that apart from an invariant that is genuinely holding. Pinned by
`test/invariants/inv22-is-vacuous.test.ts`, which fails the day the loop closes and says so in its
message. Same unfalsifiable-witness shape as INV-23 before `hasDelegationParentage`.

This is the **largest single piece of unbuilt design in the repo** and it is the thing the whole
project is named for. **It is now fully specified** — see
`docs/design/expansion-2026-07-25/D20-how-a-delegate-spends-a-grant.md`, which resolves the parts that
are easy to get wrong:

- the insertion point is `vElect`'s PROP-V4 creator gate, whose own comment ("anyone else electing on
  it would be spending another agent's money") is the definition of delegated treasury authority;
- **no ledger change is needed** — the elective half already pays from the *creator's* stores;
- the param is `grant` (as `revoke` spells it) and **not** `on_behalf_of`, which `grant` already uses
  for the syndicate an office is appointed for — reusing it is scar #1;
- the spend is recorded at **settlement**, not at election, because `vElect` emits no event and so has
  no `eventId`, while settlement has both the id and the real amount;
- `IN_FULL` → `contingent`, a fixed amount → `direct`, which is what §8's two LIMITS were for.

**It cannot be split, and that is why it is not half-built.** The election must record which grant
authorised it, so `electionsStateTable` — a captured table — gains a field, which means a
`RULES_VERSION` bump and a declared discontinuity. And the authorisation gate must not ship without
the accounting: opening the gate with an empty spend journal would let a delegate elect *unbounded*
amounts of the grantor's money with nothing enforcing the limit, which is strictly worse than being
unable to act at all. INV-22 is the backstop, not the gate.

Implementation from D20 is mechanical and bounded by one schema field.
- **"enrolment grant" violated HARD RULE 4** — `grant` is canon for delegated authority (§8, A6) and
  the engine calls enrolment goods an ENDOWMENT. The agent-facing text disagreed with the engine
  about the design's most load-bearing noun. Guarded by a banned-phrase test.
- **The event-persistence probe was a cry-wolf** that had been passing vacuously, and false refusals
  there cost an unbounded genesis replay. Now escalates to a bounded 288-tick window.

---

## How to keep this file honest

Each loop iteration: re-run the checks (module presence, live frame row counts, `/health` failures,
test count), update the numbers, and **change the prose when the numbers change.** The failure mode
this file exists to prevent is a status report assembled from memory — which happened, and produced a
confident diagnosis of a production outage read from a stale local file after a failed `curl`.
