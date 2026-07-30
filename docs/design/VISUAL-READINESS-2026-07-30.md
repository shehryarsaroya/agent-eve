# VISUAL READINESS — can THE COMPACT be rendered?

*A13 audit, 2026-07-30. Read-only pass; no engine file was changed. Written for someone starting the
renderer cold.*

---

## 0. How to read this document

The owner will build the visuals by hand, later. The question this answers is **not** "does it look
good" but **"when you sit down to draw it, is the data already there?"**

A13 makes a named pixel signature a ship gate: *"Every mechanic renders. No named pixel signature →
not ready. The map is the game's only agreed representation."* The frame contract
(`engine/src/frames/contract.ts`, 1,969 lines) is one of the best-argued files in this repo — nearly
every field carries a written §11.2 argument for why it may be published, and `assertFrameBudgets`
turns a dozen of those arguments into executable refusals. **The contract is not the problem.**

The problem is the one this project keeps re-teaching, at the pixel layer: *a field that is always
zero, always null, or always empty is indistinguishable from a field that does not exist.* So every
row below carries a **measured value from a real world**, not a type signature.

### Measurement provenance — re-run these before trusting the numbers

| Instrument | What it did |
|---|---|
| `runSim` (`engine/src/sim/cli.ts`) with `framesDir`, heuristic cast, `speed: instant` | Wrote real `r-NNNNNN.json` frames to a temp dir, then censused every array key and every field a renderer would draw |
| Worlds measured | seeds **`g01`**, **`g02`** at 6 Reckonings × 16 members (1,734 ticks); seed **`g07`** at 9 Reckonings × 16 members (2,598 ticks); seed **`viz-a`** at 6R × 16m as a shape check |
| Frames read | **21** archived frames across `g01`/`g02`/`g07`, plus 7 frame-reads on `viz-a` |
| Direct `Runtime` probes | seed `g01` at tick 1,733 (grant journal vs. frame); seed `g01` at tick 899 (event-family and visibility-tier census) |

Two limits on this pass, stated rather than hidden:

- **Nothing here was measured on `prod`.** Production runs a 12-member LLM cast on its own keys, which
  selects verbs the heuristic cast does not. Where a production figure appears below it is quoted from
  a repo docblock and labelled as such.
- **The full test suite was not run** (another agent's gate was live). All findings come from targeted
  sims, targeted greps, and reading source.

---

## 1. The frame, as it actually exists

**27 keys**, written as static JSON, one file per settled Reckoning:

```
reckoningIndex tick stateHash meters
map swayLines places ruins hallOfFame standings
claimLines worksLines marketLines syndicateLines tributeLines
raidLines battleLines saps frontBands coverArcs coverChains
authorityLines glyphs docket nextDocket rundown ticker
```

Delivery (verified in `deploy/nginx-compact.conf`, `engine/src/frames/write.ts`):

- `GET /compact/frames/latest.json` — `Cache-Control: public, max-age=2`. A full byte-for-byte copy of
  the newest frame, not a reference.
- `GET /compact/frames/r-<6 digits>.json` — `public, max-age=31536000, immutable`. Note the **six-digit
  zero padding**: `r-000015.json`, not `r-15.json`.
- `GET /compact/frames/index.json` — `public, max-age=2`. `{ reckonings: [{ reckoning, tick, file,
  stateHash, levyShort, kept, broken, beats }] }`.
- Writes are atomic (`.tmp` + `rename`) and ordered frame → pointer → index, so a viewer never reads a
  pointer naming a file that does not exist. **There is no archive pruning at all** — no cap, no
  retention window in `write.ts`. The whole history is on disk and a scrubber back through every
  Reckoning is nearly free.

**`engine/src/api/server.ts` serves zero frame routes.** The Node process only writes frames; nginx
serves them. The whole API is `POST /enroll`, `GET /observe`, `POST /act`, `GET /health`,
`POST /discrepancy`. This is good news for a renderer: it is a pure static-file consumer.

### The client that exists today

`client/index.html` — one file, **40,435 bytes**, last modified **2026-07-28 16:28**, tracked in git.
Vanilla JS, no build step. Fetches `frames/index.json` then `frames/latest.json` (both
`cache: 'no-store'`), polls every 15 s.

**It draws 16 of the 27 keys.** It contains *zero* references to these eleven:

```
map(frame.map)  swayLines  claimLines  battleLines  saps  ruins
frontBands  coverArcs  coverChains  glyphs  nextDocket
```

(The 24 `map` hits in the file are all `Array.prototype.map`; there is no `frame.map` access anywhere.)
So territory, wars, battles, ruins, the whole risk layer, the venture glyph **and the map topology
itself** are serialised into every frame and drawn by nothing. `deploy.sh:430` asserts
`body_has '"marketLines"'` on the live frame — it checks a key reached the **wire**, not that anything
renders it. The instrument is one level short of the claim.

---

## 2. THE TABLE — mechanic · signature · field · measured value · renderable

Verdicts: **WORKS** = field populated and the quantity the signature is named for actually varies ·
**PARTIAL** = rows present but the load-bearing field is constant or a state set is unreachable ·
**EMPTY** = field exists, zero rows in every world measured · **NO FIELD** = named in A13/SPEC, nothing
on the frame.

| # | Mechanic | Named pixel signature | Frame field | Measured value (heuristic world) | Renderable? |
|---|---|---|---|---|---|
| 1 | Chokepoints | **THE PINCH** — a lane narrowed at its waist, notched with the detour | `map[].straits[]` (`StraitEdge`) | **117 of 270** system-rows carry ≥1 strait; **36** are `severs: true`. Symmetry checked both ends by `assertFrameBudgets` | **WORKS** |
| 2 | Resource geography | **THE LODE** — the node sized by what its ground yields | `map[].yieldPerTick`, `.fuelPerTick`, `.richnessBps` | **189 of 270** rows have `richnessBps != 0`; **72** have `fuelPerTick > 0` | **WORKS** |
| 3 | Power projection | **THE VERGE** — one closed fence per bloc; bare ground drawn bare | `swayLines[]` | **234 rows.** `sway` spread `0=108 · 1=9 · 2=63 · 3=54`; 108 rows are bare ground (`principal: null`); 117 are strait gates. Never truncated by design | **WORKS** |
| 4 | The map | the game's only agreed representation | `map[]` (id, name, tier, constellation, lanes) | **30 systems**, real lane graph. No x/y — deliberately, since position would enter `state_hash` | **WORKS** |
| 5 | The Levy | tribute lines: DASHED / SOLID / RED / REVERSING | `tributeLines[]` | **144 rows** at 9R: `SOLID=140 · RED=4`. `owed > 0` on 4. At 6R: `SOLID=94 · DASHED=2`, **zero RED**, `levyShort = 0`. `REVERSING` **never observed** | **WORKS** (needs ≥9R to show stress) |
| 6 | Standing / reputation | the public directory a counterparty is priced from | `standings[]` | **139 rows**; `defaults > 0` on **84**. Real vectors | **WORKS** |
| 7 | World memory | place names, the Hall of Fame | `places[]`, `hallOfFame[]` | `places` **81 rows**; `hallOfFame` **36 rows**, 4 titles × 9 frames | **WORKS** |
| 8 | Sovereignty | **THE CLAIM TINT AND ITS LEGEND** — *A13's own first example* | `claimLines[]` | **24 rows across 9 frames — `SUPPLIED` on every single one.** `arrears>0`, `slashed>0`, `forSale`, `contestable`, `fuelDue>0`, `anchorHot=false`, `rentTaken>0`, `tenants>0`: **all zero, always** | **PARTIAL** |
| 9 | Production | a WORKS **marks** a system | `worksLines[]` | **144 rows — `EXTRACTING` on every one.** `rentBps`, `rentPerTick`, `rentPaid`, `fuelPerTick`, `fuelExtracted`: **all zero, always** | **PARTIAL** |
| 10 | The market | **THE PRINT** — a price on a place, and the gap to everywhere else | `marketLines[]` | **7 rows across 9 frames, `alloy` only.** `premiumBps != 0`: **0 of 7** — the field the signature exists for is always zero | **PARTIAL** |
| 11 | Predation | **THE RAID LINE** — a red arc with a countdown | `raidLines[]` | **117 rows across 3 seeds.** States: `PAID=109 · REPULSED=8`. **`DEMANDED` never once.** `ticksLeft > 0`: **0 of 117.** `initiator != null`: **0 of 117.** `raiderForce>0` / `defenderForce>0`: 6 each. Coalition (`defenders > 1`): 7 | **PARTIAL** |
| 12 | The venture | **a ring whose hollow arc is the part riding on someone's word**; an unfilled role is an empty socket that pulses | `glyphs[]`, `rundown[].glyph` | **193 rows.** States: `CLOSED_GOLD=170 · SNAPPED_BLACK=23`. **`FORMING`, `LIVE`, `DEFERRED` never occur** — 2 of 5 states reachable. `electiveBps` does vary | **PARTIAL** |
| 13 | Offices and grants (A6, the core loop) | **THE AUTHORITY LINE** + **CLEARANCE PIPS** | `authorityLines[]` | **96 rows: `UNUSED=93 · DRAWN=3`.** `boundVentures>0`: **0.** `spent>0`: **0.** `spentContingent>0`: 3. **CLEARANCE PIPS work — `clearance` non-empty on 96/96.** See §3.1: the draws happen and the frame cannot show them | **PARTIAL** |
| 14 | Compartmented authority | **THE DOSSIER THREADS** — dashed arcs that never fade | `authorityLines[].dossiers[]` | **0 threads in every frame of every world.** `dossierBook` held **0 rows** at tick 1,733 | **EMPTY** |
| 15 | Catastrophe (Phase 3) | **THE FRONT BAND** — a swept band of tinted systems | `frontBands[]` | **53 rows**; `FORECAST=48 · PASSED=5`. **But `took` and `tookQty` are hardcoded zero** — `runtime.ts:12970` passes `new Map()` unconditionally, so the two fields carrying "what the storm cost" are structurally 0 | **PARTIAL** |
| 16 | Syndicates | the shape of a pooled authority; *"N POOLED · M CAN SPEND"* | `syndicateLines[]` | **72 rows.** `members > 1`: **0.** `treasuryMinor > 0`: **0.** `officeHolders > 0`: **0.** `treasuryOffices`: **0.** Every syndicate is a solo founder with an empty strongbox | **PARTIAL** (decoration) |
| 17 | Combat | **THE BATTLE LINE** — two rows of bars across a gap that narrows every tick | `battleLines[]` | **2 rows across 9 frames** (g07), 1 across 6 (g01), 0 (g02) — **both `AFTERMATH`**. `MUSTER`/`CONTACT`/`CONTEST`/`BREAK` never observed; `gap` and `rangeName` therefore never animate | **EMPTY→PARTIAL** |
| 18 | Campaigns | **THE SAP** — a notched band whose advance is the score | `saps[]` | **0 rows in every frame of every world.** Structurally unreachable: `src/cast/heuristic.ts` has **no `build{CAMPAIGN}` branch** | **EMPTY** |
| 19 | Razing | **THE RUIN** — a dark mark labelled with who fell and when | `ruins[]` | **0 rows in every frame of every world.** `RAZE_FORCE_MARGIN = 4` (`src/works/raze.ts:175`), and its own docblock records the measurement: **0 razings over 8 seeds × 9 Reckonings, unchanged at 16 members** | **EMPTY** |
| 20 | Risk / cover (Phase 3) | **THE COVER ARC** — filled for escrow, hollow for the elective half | `coverArcs[]` | **0 rows, always.** `coverArcs()` iterates `book.allCovers()`, and the heuristic cast never emits `publish_offer{kind:'COVER'}` — **zero `publish_offer` calls of any kind** in `heuristic.ts` | **EMPTY** |
| 21 | Contagion (Phase 3) | **THE COVER CHAIN** — snaps at the link that broke; every link inward greys | `coverChains[]` | **0 rows, always.** Same missing cast branch, plus it requires a cession over a primary | **EMPTY** |
| 22 | The say-do gap | **THE RECEIPT REEL** — the traitor's own words beside the promise it broke | `rundown[].receiptReel` | **`null` on all 180 segments measured.** `publicLine` also **null on all 180**. **Zero `PARTIES`-tier events** exist in a 900-tick world. See §5 | **EMPTY** |
| 23 | The default view | the docket — ≤7 cards, stakes descending | `docket[]`, `nextDocket[]` | **2 cards across 9 frames** against a budget of 7. And `nextDocket` **is the same array object** as `docket` (`render.ts:783`) — the closing card is byte-identical to the opening view | **PARTIAL** |
| 24 | The broadcast | the rundown — ≤12 segments, largest say-do delta last | `rundown[]` | **180 segments.** `kind`: `SETTLEMENT=104 · PLUNDER=76`; **`LAPSE` never occurs.** `sealVerdict`: `HONOURED=104 · null=76` — **`CONTRADICTED` never occurs** | **PARTIAL** |
| 25 | Compacts | **a compact draws a link between two holdings**; **a broken compact snaps that link and scars both parties** | — | **NO FIELD.** A venture renders as a ring at one `stage` system. Nothing draws a holding→holding link; nothing carries a scar on a holding. (`standings.defaults`/`lastDefaultTick` is a per-principal scar, so the *scar* half is partially served; the *link* half is not served at all) | **NO FIELD** |
| 26 | Hauling | **a convoy is a line that can be severed** | — | **NO FIELD.** Verified: zero convoy/haul keys on `ReckoningFrame`. The phrase appears **five times in `contract.ts` as the justification for making *other* fields public** and has no field of its own. `haul.departed`/`haul.landed` events exist and balance (4 = 4 at 900 ticks) | **NO FIELD** |
| 27 | Siege | **a siege closes a ring** | — | **NO FIELD**, and truthfully so — `src/observe/observation.ts:191`: *"Empty in Phase 0 and truthfully so: siege belongs to Phase 1"* | **NO FIELD** |

### Score

| Verdict | Count |
|---|---|
| **WORKS** — signature carries live, varying data | **7** |
| **PARTIAL** — rows present, load-bearing field constant or states unreachable | **9** (rows 8–13, 15–16, 23–24 collapse to 9 distinct mechanics) |
| **EMPTY** — field exists, zero rows in every world measured | **7** |
| **NO FIELD** — named in A13/SPEC, nothing on the frame | **3** |

**15 of 26 named mechanics put something on screen; 11 draw nothing at all** (7 empty + 3 no-field +
combat, which is 2 rows in 21 frames and only ever in its final state).

---

## 3. Every gap, ranked by what it costs the show

### GAP 1 — THE FRAME IS A POST-MORTEM. One frame per Reckoning; in production that is once per 24 hours.

The most expensive finding, because it invalidates roughly a dozen fields at once and it is not a bug
in any of them.

A frame is published **only** on `report.clock.isSettlementTick` (`engine/src/api/server.ts:1941`).
`SPEEDS.prod = 300` seconds and `TICKS_PER_RECKONING = 288` (`engine/src/core/time.ts:28,38`), so one
Reckoning is exactly **86,400 s = 24 hours**. `latest.json` is served `max-age=2` and the client polls
it every 15 seconds — **against a file whose content changes once a day.**

Every field designed to animate *within* a Reckoning therefore has no frame to appear in. Measured
consequences, all from the census:

| Field | What it is for | Measured |
|---|---|---|
| `raidLines.ticksLeft` | "the countdown on the arc" | **0 on 117 of 117 rows** |
| `raidLines.state` | `DEMANDED` is the live standoff | **never once**; only `PAID`/`REPULSED` |
| `battleLines.gap`, `.rangeName` | "the gap that narrows or widens **every tick**" — the range race, called the most legible thing on the board | both battles observed were `AFTERMATH`; the race never renders |
| `battleLines.state` | 5 beats, 5 looks | only `AFTERMATH` observed |
| `BattleFormationLine.pinned/capOut/repairing/withdrawn` | the four live overlays | unobservable — all four are within-battle states |
| `glyphs.state: FORMING` | *"an unfilled role is an empty socket that pulses — that is what forming looks like"* | **never occurs** |
| `saps.dashed`, `.nextPulseTick`, `.hollow` | the published notice window; a starving war | unreachable (and `saps` is empty anyway) |
| `claimLines.contestable` | the published vulnerability window | **0 of 24** |
| `authorityLines.state: REVOKED` | *"ending next tick"* | never occurs |

The sort functions in `render.ts` are written for a world that does not exist: `raidLines` sorts
`DEMANDED` first (a state that never reaches a frame), `battleLines` sorts `fieldControl === null`
first (ditto). §14.1's *"motion is drawn as persisting, fading history so a 5-minute tick still reads
as alive"* has no artifact to read from.

**What a renderer needs and cannot get:** a **live frame** on the tick cadence, or a per-tick delta
stream. Everything else in this document is a smaller problem than this one.

### GAP 2 — A6, the core loop, renders `UNUSED` in a world where it fires 98 times.

The prompt flagged this as a past defect. **The field was fixed; the selection was not.** Measured
directly on seed `g01` at tick 1,733:

```
grants total              = 158
spend journal rows        =  98   (all nonzero)
distinct grants DRAWN on  =  41
grants LIVE at the tick   =  41   <- what the frame filters to
  of which DRAWN          =   3
grants EXPIRED and drawn  =  38   <- draws the frame can never show
frame.authorityLines      =  12 of 41 live (cap 12)
frame states              = UNUSED=12
```

Two independent causes stack:

1. **The filter.** `runtime.ts:15383` keeps only `g.expiresTick >= outcome.tick`. Grant lifetimes are
   592–1,959 ticks (median 1,236), and draws happen throughout — so **38 of the 41 grants ever drawn on
   had expired before any frame was written.** The frame is structurally incapable of showing them.
2. **The sort.** `render.ts:638-646` ranks by `authorityWeight` — both LIMITS summed — with **no term
   for whether anything was ever drawn**. It is the only line set in the file without one:
   `raidLines` puts live first, `battleLines` puts live first, `claimLines` puts about-to-fall first.
   So the 3 live-drawn grants lost the 12-line cap to bigger untouched ones, deterministically.

The code at `runtime.ts:15391-15410` correctly reads **gross draws from the journal** and its comment
names the exact defect it was fixing. The fix was right and insufficient: the field now tells the
truth about a grant nobody selects.

**Cost to the show:** the core loop — *"betrayal via legitimate authority"* — is the thing CLAUDE.md
calls the signature moment, and on 21 of 21 frames measured it renders as twelve identical hairlines
labelled *nobody has used this*.

**What a renderer needs:** either a `drawn` term in the sort, or a per-Reckoning *gross draws* line set
that survives grant expiry. Neither exists.

### GAP 3 — THE RECEIPT REEL has no raw material, and no join to the grant.

§14 calls this *"the best thing this design can produce"*. Measured: `receiptReel` is `null` on **all
180 rundown segments** across three seeds, despite **23 `SNAPPED_BLACK` glyphs** (real broken promises)
in `g07` alone. Full analysis in §5. Two distinct causes:

- **No negotiation exists to declassify.** The reel is gated `v.defaulted && v.messages.length > 0`
  (`render.ts:469-472`). A 900-tick tier census found **zero `PARTIES`-tier events** — the ledger held
  `PUBLIC=654 · PRIVATE=14 · SENSED=4`. `src/say/parley.ts` is the `PARTIES` emitter and
  `src/cast/heuristic.ts` contains **one** occurrence of the string `message` in 3,600+ lines, in an
  unrelated comment. The reel's raw material is not produced.
- **No frame field carries a `GrantId`.** Verified: `grep GrantId src/frames/contract.ts` → zero hits.
  `AuthorityLine` is keyed `(grantor, delegate)`; `RundownSegment` names a `venture`. A venture's
  `boundByGrant` exists in the engine (`runtime.ts:6973`) and is captured, but is **not published**.
  So a renderer cannot put *the grant* beside *the deed* on one strip — §14's literal requirement —
  because there is no key to join on.

### GAP 4 — Three of A13's own six named examples have no field at all.

A13 (`SPEC.md:93`) names six: *a claim tints a system · a compact draws a link between two holdings ·
a broken compact snaps that link and scars both parties · a venture is a ring whose hollow arc is the
part riding on someone's word · a siege closes a ring · a convoy is a line that can be severed.*

- **the convoy line** — no field. Cited five times inside `contract.ts` as the *reason other fields
  may be public* (*"a convoy is visible to anyone, because it is the map's motion and the map is the
  show"*), and it has no field of its own. §11.2's most quotable asymmetry — the ship is visible, the
  manifest is not — cannot be drawn.
- **the compact link between two holdings** — no field. A venture renders as a ring at a single
  `stage` system. Nothing draws the link; nothing scars a holding. (`standings.defaults` and
  `lastDefaultTick` give a per-principal scar, so the "scars both parties" half is partly served.)
- **the siege ring** — no field, and honestly labelled Phase 1 in the source. Not a defect; listed for
  completeness.

### GAP 5 — Three signatures are structurally unreachable, not merely rare.

| Signature | Why it can never fire in a heuristic world |
|---|---|
| **THE SAP** (`saps`) | `src/cast/heuristic.ts` has **no `build{CAMPAIGN}` branch** — `grep CAMPAIGN src/cast/` hits only `prompt.ts`. `scripts/campaign-sim.ts` says so in its header and supplies the decision itself. Also: a campaign is 1 Reckoning of notice + up to 5 pulse-Reckonings, so it only completes inside a 6R world if declared in Reckoning 0 |
| **THE COVER ARC / THE COVER CHAIN** | `heuristic.ts` emits **zero `publish_offer` calls of any kind** and never reads the risk book. `test/risk/cast-hook.spec.ts` and `scripts/risk-probe.ts` both state this as a known, deliberate gap and provide the exact six-call transcription a branch would need |
| **THE RUIN** (`ruins`) | `RAZE_FORCE_MARGIN = 4` (`src/works/raze.ts:175`). The docblock at `raze.ts:145-162` publishes the measurement: **0 razings over 8 seeds × 9 Reckonings**, unchanged at 16 members, because `FORCE_BY_TIER.MARCHES = 1`, the world-raid force band tops at 5, and A8 makes every Commons member's WORKS unrazable. The agent road needs a `demand` with three joiners, and **`heuristic.ts` has no `demand` branch** (it says so at line 3309) |

None is hardcoded `[]` — the wiring is real and tested. They are empty one layer up.

### GAP 6 — Rules that never discriminate: the rent fields, the premium, the claim states.

The repo's own named defect class — *a rule that never discriminates* — is live in three places on the
frame:

- **The three rent fields** (`worksLines.rentBps/rentPerTick/rentPaid` and
  `claimLines.rentBps/rentTaken/tenants`) are described in `contract.ts:1026` as *"THE TERRITORY
  LAYER'S ONLY INCOME"*. Measured: **zero on all 144 works rows and all 24 claim rows.** A viewer can
  watch a claim and never learn why anybody wants the ground — the exact failure the comment says the
  fields were added to fix.
- **`marketLines.premiumBps`** is the field `contract.ts:822` says THE PRINT *exists for*. Measured
  **0 on 7 of 7 rows**, all `alloy`. Two systems 8% apart is the whole story; the world never produces
  one.
- **`claimLines.state`** is `SUPPLIED` on **24 of 24** rows. `STRAINED`, `CONTESTED` and `LAPSED` never
  occur, so the legend logic (`ARREARS 1 of 2`, `NEXT MISS LAPSES`) and the `LAPSE` rundown beat are
  all unreachable. `rundown.kind: LAPSE` never occurred in 180 segments.

### GAP 7 — `FrontBand.took` / `.tookQty` are hardcoded zero.

`engine/src/sim/runtime.ts:12970` is `return frontBands(this.risk, tick, new Map());` — the
`tookBySystem` argument is an unconditional empty map. `lines.ts:125-126` reads
`took: took?.value ?? 0`. So the two fields of nine that carry *what the storm actually cost* are
structurally zero in every production frame, contradicting their own doc comments. No test asserts
them. THE FRONT BAND draws its tint and never its price.

### GAP 8 — `nextDocket` is the same array as `docket`.

`render.ts:783` is literally `nextDocket: docket`. §14.3's closing card — *"the closing card:
tomorrow's docket"* — is byte-identical to §14.1's default view. And the docket itself carried **2
cards across 9 frames** against a budget of 7, because it is built from `ventures.live()` at the
settlement tick and almost everything has already settled by then. The primary view of the product is
nearly empty and its closing beat is a duplicate.

### GAP 9 — `MAX_FRAME_COVER_CHAINS` is 4; the builder's default limit is 6.

`coverChains(book, tick, limit = MAX_COVER_CHAIN_LINKS /* 6 */)` uses `limit` for both links-per-chain
and *number of chains* (`src/risk/lines.ts:291,301`), and `runtime.ts:12980` passes no limit while
`runtime.ts:15561` does not clamp — unlike its neighbour `claimLines`, which does
`.slice(0, MAX_FRAME_CLAIM_LINES)`. Five primaries-with-cessions would trip `assertFrameBudgets` and
**drop the whole frame**. Latent today only because `coverChains` is always empty. Bands (12/12) and
arcs (8/8) match; chains do not.

### GAP 10 — `CoverArc.legend` is not truncated (operator precedence).

`src/risk/lines.ts:193-195`: `.slice(0, 140)` binds to the trailing string literal only, not to the
concatenation, so the `payer`/`payee`/`limit` prefix is unbounded. Compare the correct form at
`lines.ts:127`. `assertFrameBudgets` validates `arc.filledBps` but never `legend.length`.

### GAP 11 — A9 parity on the frame is prose plus a name-regex, not a comparison.

`PUBLIC_FACT_KEYS` (`src/frames/projection.ts:220`) is a real runtime allowlist: an unargued key means
the frame is **refused, not published** (`assertInertPublicFacts`, called at `runtime.ts:15618`), and
the projection is canonicalised so a live getter or book throws rather than rendering. That is genuinely
good.

But **no test compares a frame key, or a frame line's fields, against what `observe` actually returns
to an agent.** `test/events/parity.test.ts` is the real fuzzed parity test and its subject is the
*event feed*, not the frame. `test/frames/projection.test.ts` tests only the refusal mechanism. The
content-level defence is six field-name regexes in `assertFrameBudgets`
(`contract.ts:1362,1525,1634,1740,1851,1955`) which catch *a known leak shape spelled a known way*.

`projection.ts:202-211` records this failing in production: `roleTags` was documented as an
already-published effect but implemented as a resolution of the formation's **fit**, so the frame
published `REPAIR` for a module that had never fired while the agent in the fight saw nothing. A9
inverted, for the layer's whole life, caught by hand-audit and by no test.

**For a renderer this matters concretely:** you cannot currently prove that something you draw is
something the players can see. Treat any new frame field as needing its own argument.

---

## 4. Measured but not renderable · renderable but not measured

### Measured, and a renderer cannot use it

| Thing the engine measures | Why the frame cannot show it |
|---|---|
| **98 grant draws across 41 grants** (`g01`, 1,733 ticks) | Expiry filter + size-only sort ⇒ `UNUSED` on every line (GAP 2) |
| **`venture.boundByGrant`** — which grant bound which venture | Not on the frame at all; no `GrantId` anywhere (GAP 3) |
| **`haul.departed` = 4, `haul.landed` = 4** — convoys arrive, and the tiers are now correct | No convoy field (GAP 4) |
| **`SEAL_RESOLVED` = 128 events** in 900 ticks | Only the verdict reaches the frame (correct per §11.2), and the **season replay artifact that would carry seal content does not exist** — `contract.ts:1159` says so |
| **A raid's live window**, a battle's per-tick gap, a venture forming | No frame is written during them (GAP 1) |
| **`ruinsInOrder()`**, `sapLinesFor`, `coverArcs` — all exercised by tests through real verbs | Nothing in a heuristic world selects the mechanism (GAP 5) |

### On the frame, and nothing draws it

Eleven keys are serialised into every frame and referenced **zero** times by `client/index.html`:
`map` · `swayLines` · `claimLines` · `battleLines` · `saps` · `ruins` · `frontBands` · `coverArcs` ·
`coverChains` · `glyphs` · `nextDocket`.

Three of those are among the **best**-populated keys in the whole frame — `map` (30 rows, full lane
graph), `swayLines` (234 rows with real variation), and the strait/lode data hanging off `map`. THE
PINCH, THE LODE and THE VERGE are the three signatures in the strongest shape in this audit, and no
pixel has ever been drawn from any of them.

**This is the single most encouraging finding in the document.** For rows 1–4 of the table, a renderer's
work is pure drawing: the topology, the borders, the chokepoints and the resource weighting are all
present, varying, budget-checked and unread.

### Renderable-ready and safe to build on today

Position, identity, magnitude and change-over-time all present, verified row by row:

- `map[]` → nodes (sized by `richnessBps`), edges, tiers, constellations, straits
- `swayLines[]` → one fence per principal, contested seams, bare ground
- `claimLines[].system` + `worksLines[].system` + `marketLines[].venue` → every line set keys to a
  system id that is guaranteed present in the same frame's `map` (`assertFrameBudgets` checks it)
- `standings[]` → the character sheet for anyone on screen
- `index.json` → a free, exact scrubber across every Reckoning the world has ever had

---

## 5. THE RECEIPT REEL — is the data all present?

§14: *"When an elective promise breaks, the replay assembles every message its author sent between the
handshake and the deed — warm, reassuring, now re-readable as lies — beside the public line, the seal
verdict, and the moment the link snapped."*

`TESTING.md` `E2E-10` names five artifacts. Component by component:

| Component | On the record? | On the frame? | Measured |
|---|---|---|---|
| **1. The grant** | **YES** — `grant.issued` PUBLIC event (`runtime.ts:8135`); serialised as a W3C VC (`src/identity/vc.ts`, cryptosuite `eddsa-compact-c1`) | `authorityLines[]`, keyed `(grantor, delegate)` | **58 `grant.issued` events** in 900 ticks; 158 grants at 1,733 |
| **2. The accepted warning** (the LIMITS shown before signing) | **YES** — `maxDirectLoss` / `maxContingentLiability` are the VC's signed claims; *"the worst case was shown before you signed"* is provable, not asserted | `authorityLines[].granted` / `.grantedContingent` | Present on 96/96 rows |
| **3. The seal** | **PARTIAL** — the **verdict** is public and correct; the **content** is `SEALED` and deliberately absent from a nightly frame (§11.2), but the season-replay artifact that would carry it **does not exist** (`contract.ts:1159`) | `rundown[].sealVerdict` | `HONOURED=104 · null=76` on 180 segments. **`CONTRADICTED` never occurs**, so the say-do gap the seal exists to expose has never once been exposed |
| **4. The deed** | **YES** | `rundown[].deed` + `.consequence` + `glyph.state: SNAPPED_BLACK` | **23 `SNAPPED_BLACK`** in `g07` alone; the `assertFrameBudgets` rule at `contract.ts:1469-1479` forces the night to *end* on one |
| **5. The negotiation text** | **NO, in practice** | `rundown[].receiptReel` | **`null` on all 180 segments.** `publicLine` also **null on all 180.** **Zero `PARTIES`-tier events** in a 900-tick world |

### The verdict

**The wiring is complete and proven; the content is absent in every world this repo can currently
produce, and one join a renderer needs does not exist.**

- **The path works.** `test/frames/receipt-reel.spec.ts` drives a real `message {venture, act:'assure'}`
  through the engine on a real world and proves the assurance reaches the settled segment and that a
  broken promise brings the reel with it. This is a behavioural gap, not a wiring gap — and that file
  exists precisely because the two were indistinguishable before.
- **The mechanism is offered.** `assure` is a live affordance (`src/api/observe.ts:2449`) and is taught
  in the LLM prompt (`src/cast/prompt.ts:2846`). So an LLM cast *can* produce a reel.
- **It has never fired.** `receipt-reel.spec.ts:5-7` records the production reading: *"Read off the
  live frame at tick 4,395: 12 segments, one genuine break … and `publicLine: null` on every single
  segment."* That is the **LLM** cast in production, not the heuristic one. My measurements confirm the
  heuristic cast cannot produce one at all.
- **And even with content, §14's strip cannot be assembled.** There is no `GrantId` on any frame field
  and no `boundByGrant` published, so a renderer holding a `SNAPPED_BLACK` segment has no way to find
  the grant that authorised the deed. Component 1 and component 4 cannot be put side by side.

---

## 6. The five most dramatic moments the current data already supports end to end

Ranked by how little new engine work each needs. Every figure is from the census.

### 1. THE WORD — an unsecured promise settles, gold or black. **Fully supported today.**

§14.5's daily clip. `rundown[]` gives the ordered beats; `glyph.electiveBps` gives the hollow arc;
`glyph.state` closes it `CLOSED_GOLD` or snaps it `SNAPPED_BLACK`; `deed` and `consequence` are
pre-written plain language; `cast[]` gives portrait chips with a ≤60-char character line.

Measured: **180 segments** across three seeds, **193 glyphs**, `CLOSED_GOLD=170 · SNAPPED_BLACK=23`.
`assertFrameBudgets` **enforces** that a night carrying a broken promise ends on one
(`contract.ts:1469`), so the climax is guaranteed by the contract rather than hoped for. *Honoured at a
loss* is the more common case and reads just as well: `"quill paid 2K it could have kept."`

This is the appointment viewing, and it needs nothing from the engine.

### 2. THE VERGE — two blocs' fences meeting on a contested seam. **Fully supported, drawn by nothing.**

**234 sway rows** with a real spread (`sway 0=108 · 1=9 · 2=63 · 3=54`), **117 strait gates**, **108
systems of bare ground**, and a **30-system lane graph** with **36 severing chokepoints** and **189
systems of differentiated richness**. Group `swayLines` by principal, draw one closed fence per group,
tint by `sway`, size nodes by `richnessBps`, narrow lanes at `straits[].detourHops`.

A viewer learns in one glance which four or five lanes the whole map must pass through, and where a
small holder can still live. Every number is present, varying and budget-checked. **`client/index.html`
references none of it.**

### 3. THE PLUNDER — a raid lands and takes something real. **Supported as an after-the-fact beat.**

**117 raid lines**, `PAID=109 · REPULSED=8`, `lost > 0` on **78**, and `rundown.kind: PLUNDER` on **76
of 180 segments**. `defenders[]` names who rode out — measured **7 coalitions** where more than one
principal stood with the target, which `contract.ts:401` correctly insists is the difference between a
coalition and a lone defender.

The limit is GAP 1: the countdown, the window and the `DEMANDED` state never reach a frame, so this is
a result, not a standoff. Still a genuine beat: *"p:kestrel demanded 5,749 of p:tolen; p:orrin rode
out to meet it."*

### 4. THE LEVY TIGHTENS — a red tribute line and a shortfall nobody can lower alone. **Supported at ≥9 Reckonings.**

§14.2's headline meter. At 9R, seed `g07`: `levyShort` reached **90,986**, **4 tribute lines went
`RED`**, and `owed > 0` on 4. At 6R the same instrument reads `levyShort = 0` and zero red lines.

So the meter works and **the world has to be old enough to be under strain.** Any watchability
rehearsal should run ≥9 Reckonings; a 6R world will look placid because it is.

`REVERSING` (a seizure) was never observed at any length.

### 5. THE RECEIPT REEL — the marquee artifact. **Supported only with an LLM cast, and still missing a join.**

See §5. The frame shape is right, the test proves the path, `assure` is offered to agents, and
`SNAPPED_BLACK` deeds are plentiful. What is missing is (a) any cast that talks, and (b) a `GrantId` on
the frame so the grant can sit beside the deed.

**Two runners-up worth naming, both blocked on GAP 5 rather than on data shape:** THE SAP (a war
visibly starving a Reckoning before it dies — the `hollow` bit is a genuinely good piece of design)
and THE RUIN (the only signature that makes destruction permanent on screen). Both have complete,
tested builders and nothing in the world that selects them.

---

## 7. If the renderer starts tomorrow, in this order

1. **Draw the map.** `map[]` + `swayLines[]` + `straits[]` + `richnessBps`. Best-populated, entirely
   unread, and it unblocks every other line set — `claimLines`, `worksLines`, `marketLines`,
   `raidLines`, `saps` and `battleLines` all key to a `SystemId` that is guaranteed present in the same
   frame's `map`.
2. **Draw THE WORD.** `rundown[]` + `glyphs[]`. The one story the data fully tells today.
3. **Build the scrubber.** `index.json` + immutable `r-NNNNNN.json`. Nearly free, exact rather than
   reconstructed, and it is how you will notice a field going empty.
4. **Then raise GAP 1 as a design decision, not a bug.** A live frame (or a tick-delta stream) is worth
   more to the show than any remaining mechanic, because it is what a dozen already-built fields are
   waiting for.

### Two habits this audit suggests, offered without touching code

- **Land the meter with the mechanism, at the frame.** Every `EMPTY` row above has a passing unit test
  against its *builder*. Only `battleLines` has a test that asserts non-empty on an actual
  `ReckoningFrame` (`test/combat/the-cast-goes-to-war.spec.ts:499-517`). Delete the three risk
  assignments at `runtime.ts:15559-15561` and `test/risk/` stays green.
- **A frame census is cheap.** The two throwaway scripts behind this document took ~60 s per 6-Reckoning
  world and found eleven gaps. A standing `scripts/frame-census.ts` printing *rows per key* and *rows
  per non-default field*, run after any change an agent can see, would have caught GAP 2, GAP 7 and
  GAP 8 on the day each landed.

---

## 8. Things I could not verify

- **Any production figure.** Nothing here was measured on `prod`. The tick-4,395 reading in §5 is quoted
  from `test/frames/receipt-reel.spec.ts:5-7`, not re-measured. **UNVERIFIED** whether an LLM cast has
  ever produced a non-null `publicLine`, a `PARTIES` message, a COVER, or a campaign.
- **Whether the deployed client matches the repo.** `docs/design/visual/README.md` records it as 4,776
  bytes behind as of 2026-07-28. Not re-checked. **UNVERIFIED.**
- **The full test suite.** Not run (another agent's gate was live), so no claim here rests on a green
  suite.
- **`scripts/combat-sim.ts:10-11`** still states the heuristic cast *"does not build hulls and does not
  engage"*, which contradicts `heuristic.ts:3504` (`hullFor`) and `heuristic.ts:3147` (`engageFor`).
  That header is stale; **UNVERIFIED** when it diverged.
- **The third "cap that hides"** named in `CLAUDE.md:240` ("an offer cap that counted unusable rows")
  was not located by name. `MAX_RECKONING_SUMMARIES = 8` (`runtime.ts:2225`) and
  `LEVY_RETAINED_RECKONINGS = 3` (`levy/params.ts:270`) were. **UNVERIFIED.**
- **`MAX_TABLE_FAULTS`** bounds the operator-fault `Ring`, which drops the oldest. Measured **0 faults,
  0 dropped** at 900 ticks, so nothing is hidden today — but the ring is a cap over exactly the signal
  that would reveal the next `haul.landed`-class refusal.

## 9. One piece of good news to end on

The `haul.landed` bug — a malformed visibility tier that made the record refuse **every single row**,
so no frame could ever show a convoy arriving — is **fixed and stays fixed**. The tier contract is now
a table the append path *checks* rather than a convention it hopes for (`VISIBILITY_RULES`,
`src/events/visibility.ts:254-300`), enforced at `src/events/ledger.ts:368`.

Measured on seed `g01` at 900 ticks: **26 event families, 672 ledger rows, 0 faults, 0 dropped**, with
`haul.departed = 4` and `haul.landed = 4` — **matching**, which is the exact check that found the
original bug. Tier split: `PUBLIC=654 · PRIVATE=14 · SENSED=4 · PARTIES=0 · SEALED=0`.

The two zeros are behavioural (nobody negotiates, nobody seals prose), not malformed. **No event family
is being silently refused today.** For a renderer, that means the five visibility tiers can be trusted:
what reaches the frame is what the ladder permits, and `assertInertPublicFacts` refuses a frame rather
than publishing an unargued key.
