# THE COMPACT — STYLE DIRECTIONS

*Fifteen draft screens: five science-fiction art directions across the three surfaces that decide the
product. Written 2026-07-31 against `VISUAL-ASSET-BIBLE.md` and `RULES_VERSION` 40. Every string in
every image is real data out of the bible — no lorem, no invented mechanics.*

**Browse them:** `docs/design/graphics-2026-07-30/samples/gallery.html` — double-click it, no build step.

---

## The recommendation, in three sentences

**Build C · HARD SF OPERATING SYSTEM as the working language, and D · THE STAR CATALOGUE as the
ceremonial one.** C is the only direction that carried all three screens without needing a printed
legend or a second colour to make failure legible — its one-accent rule means the eye lands on exactly
the three orange marks that *are* the betrayal — and it is the only one implementable as a CSS re-skin
of the client that already exists. D loses the live map (an engraving cannot tick 288 times a day) but
wins the record decisively: it is the only direction where **the villain's card is printed in the ink of
loss**, which is what A5's permanence is supposed to feel like.

If only one may be built, it is **C**. The two-language recommendation is argued in §6.

---

## 1. What was generated, and what it cost

| | |
|---|---|
| Images | 15 (5 directions × 3 subjects), 16:9, 1K, `quality=medium` |
| Model | `openai/gpt-5.4-image-2` via `tools/media/gen_image.py` |
| Spend | ~**$1.20** at the draft-first rate (~$0.08/image) |
| Wall time | ~11 minutes at 5 concurrent workers |
| Reproduce | `python3 samples/render.py --only reel-c` — every prompt lives in that one file and is also shown under each image in the gallery |

The three subjects were chosen because they are the three *hardest* asks in the bible, not the three
prettiest:

| Subject | The ask |
|---|---|
| **THE MAP** | Five signals on one node at once: tier, LODE (richness), PINCH (a strait — only 10 of 35 lanes), VERGE (a reach fence), and a claim tint. |
| **THE PROFILE** | Make a stranger root for `sable` (14 honoured, zero defaults) and against `vex` (3 defaults, the last at tick 287). |
| **THE RECEIPT REEL** | Hold a lie next to its consequence. Part ledger, part transcript, part accusation. |

---

## 2. The scoreboard

Scored against the four judgements, plus build cost. **Best in column in bold.**

| | A · HOLOTABLE | B · NOSTROMO | C · HARD SF OS | D · STAR CATALOGUE | E · EVE NATIVE |
|---|---|---|---|---|---|
| **Map — five signals** | **strong** | weak | strong | good | **strong** |
| **Profile — do you care?** | strong | **fails** | good | **strongest** | good |
| **Reel — lie vs. consequence** | weak | good | **strong** | **strongest** | fails¹ |
| **Survives both clocks** | live only | either | **both** | ceremony only | live only |
| **Needs a printed legend?** | **no** | yes (4) | yes (2) | yes (6) | yes (2) |
| **Canon safety** | good | good | **good** | good | **disqualifying** |
| **Build cost on today's client** | high (WebGL) | low | **lowest** | medium | low-medium |

¹ Not because the composition is bad — the four bands in the middle of `reel-e` are clean — but because
the direction surrounded the marquee artifact with a killboard. See §3.

---

## 3. The five directions

### A · THE HOLOTABLE — *bets on live tactical drama*

**What it got right.** The map is the best of the five as a *map*. It is the **only direction that never
needed a legend**, because it is the only one with a free hue channel: claims came out blue, violet and
amber and a stranger reads "three different owners" with no key at all. `THE COMMONS` sits ringed at
centre with nothing crossing it, the two severing doors carry `stranded 3` and `4`, eight lanes notch
`10` at the waist, and `Moorage · sys-29` is visibly the biggest dot on the board. The profile is
genuinely affecting — `DEFAULTS 3` boxed in red is the first thing you see on `vex`.

**Where it broke.** The reel. An all-emissive palette has **no register for grief**: the grant, the
reassurance and the snapped ring all glow the same friendly cyan, so the worst moment in the game reads
at the same emotional temperature as a form field. The alarm colour I reserved went unused because
nothing in a hologram is allowed to be *dark*. It also spends its whole colour budget on being a
hologram, and the three-quarter perspective is a permanent tax on every line of prose.

**Cost.** Highest. Volumetric haze, bloom and depth-through-transparency mean WebGL or heavy canvas —
which ends the client's current no-build-step property.

### B · THE NOSTROMO — *bets on diegesis*

**What it got right.** The reel is better than expected: amber monospace on black reads *exactly* like a
recovered log, which is the fiction the receipt reel is literally making. The transcript feels
**found** rather than presented, and that is worth something no other direction offers.

**Where it broke — and this is the disqualifying one.** On the profile, `NEVER BROKEN A PROMISE` and
`MOST BROKEN` **render almost identically**. With one ink, the only emphasis available is bold and
size, so the hero and the villain arrive at the same volume. That is a direct failure of the one gate
the bible says the whole project rests on. The map is the weakest of the five: monochrome forced it to
invent a **four-entry claim legend** to say what colour says for free, and it drew visibly fewer than 30
systems because the ASCII grammar runs out of room.

**Also:** the bezel, switch and dymo labels eat **~20% of the frame**, permanently, on a product where
the frame *is* the content.

### C · HARD SF OPERATING SYSTEM — *bets on legibility* ★ recommended

**What it got right — nearly everything, and for one reason.** The rule "exactly one accent, used only
where something is wrong" turns out to be the whole game's information design, by accident. On the
profile, orange appears **four times**: `DEFAULTS 3`, `tick 287`, the `MOST BROKEN` box, and the
`RECOVERING` hand. Nothing else competes, and `vex` is legible as the villain in under a second with no
key. On the reel, orange appears **three times**: `CONTRADICTED`, the ✕ at the ring's break, and the ✕
on the severed link — and those three marks *are* the three facts of the betrayal.

**And it is the only direction that drew the promise grammar correctly.** `reel-c`'s ring has a **solid
arc and a hollow arc** — the escrowed half and the part riding on a word — so you can read the
proportion off the shape. The bible calls that hollow width "the drama, and it needs no legend". Four of
five directions drew a generic broken circle; C drew the actual object.

**Where it is weak.** It is cold. It reads like an accident report or a credit file, and the honest
question is whether "watchable" survives that. It also needed two legend boxes on the map (claims, lanes)
because greyscale fills do not scale past about three claimants — **the one thing C must borrow from A
is a hue channel for claim tint** (see §6).

**Cost — decisive.** `client/index.html` is 48 KB of vanilla DOM and CSS with **no canvas, no SVG, no
build step**, and its palette is already abstracted behind CSS custom properties (`--paper`, `--ink`,
`--gold`, `--red`, `--rule`). C is a variable swap plus an SVG map layer. Nothing else on this list is
that cheap.

### D · THE STAR CATALOGUE — *bets on permanence* ★ recommended for the record

**What it got right.** The single best idea in the whole sweep: **`vex`'s entire card is printed in the
second ink.** Crest, `DEFAULTS 3`, the `MOST BROKEN` band — all vermilion, while `sable` stays gold. The
brief said the second ink "marks only what has been lost or broken", and the generator took that
literally and produced something with real moral weight. That is A5 — *loss is real, public and
permanent* — rendered as a printing decision rather than a UI state.

The reel is the emotional winner of the fifteen. Roman numerals `I`–`IV`, engraved rules, vermilion
`CONTRADICTED`, an engraved ring broken with a red ✕. It reads as an indictment cut into a monument. And
it made a smart move nobody asked for: **the chrome is engraved and the evidence stays monospace** — the
record is a printed thing, the transcript is a machine thing. That hybrid is a defensible system, not a
compromise.

**Where it breaks.** The clock. An engraving cannot tick. Nothing about hatching, letterpress ornament or
a compass rose survives being rewritten 288 times a day, and the map paid for the ornament with a
six-entry legend and a decorative border eating ~8% of the frame. It also duplicated node numbers
(two 13s, two 25s, two 18s), which is exactly the failure mode of a style where every element is
hand-set.

**Cost.** Medium — hatching patterns, a serif webfont, per-agent engraved crests. It is a once-a-day
artifact, so the cost amortises over a 24-hour cache.

### E · EVE NATIVE — *bets on the audience's existing language*

**What it got right.** The densest and most *plausible* of the five. Tab bar, a `SYSTEMS (30)` table with
`ID · SYSTEM · LODE · CLAIM · TIER`, a `LANES (35)` table flagging straits, a `SOV SUMMARY` with
`ARREARS` in red, an activity log, a watchlist. It is the only direction that renders the frame's
**actual budgets** honestly — 30 systems and 35 lanes really are tables. It uses hue per bloc on the map
and gets the fences right. On the profile it tints the **entire window** by standing: `sable`'s client is
teal, `vex`'s is red.

**Where it breaks — and this one is a project risk, not a taste call.** The direction imports EVE's
**ontology** along with its look, and `SPEC.md` §3 is a *rules surface*, not a style guide. Across the
three E screens the generator produced, unprompted:

- EVE's **ships and structures** — `Rorqual`, `Fortizar`, `Astrahus`, `Raitaru`, `Azbel`
- EVE's **currency** — *"Unusual ISK transfer activity detected"*, values in `12.34B`
- EVE's **mechanics** — `entosis link`, `cyno inhib online`, `jump bridge`, `ADM RATE`,
  `Sovereignty Hub`, `wormhole verified`, `Outposts`
- EVE's **map** — `Kador`, an actual EVE region name
- **facts the engine cannot produce** — `Systems Held 12` for a principal that gets exactly one HOLDING,
  `PILOT COUNT 18,452`, `SYSTEMS 842`, plus `loan`, `fee` and `partial fulfillment` as transaction types

That is HARD RULE 4 in `CLAUDE.md`: *"No word may name two concepts anywhere — not in code, not in a
label, not in a legend, not on a mock."* This is a mock, and it breaks it about twenty times. **The look
is borrowable; the noun set is not** — and the sweep is evidence that they arrive together unless
somebody is actively policing the boundary, because nothing in the prompt asked for any of it.

**And the reel is the specific failure.** The four bands themselves came out clean — correct text, red
`CONTRADICTED`, a properly hollow-arced ring. But they occupy barely half the frame, flanked by a
`KILLBOARD` tab, a `TOP KILLS` table and an `INTEL FEED`. The receipt reel is described in the bible as
*"the marquee artifact, the thing the whole design exists to produce"*. This direction's instinct is to
put a killboard next to it — and a killboard is a scoreboard for destroying ships, in a game whose
scoreboard is promises kept and broken. **The genre pull is toward the wrong drama**, which is a deeper
problem than the vocabulary and cannot be fixed by a find-and-replace.

---

## 4. The three screens run at three speeds — and that is the real constraint

This is the finding that makes a single-language answer difficult, and it comes straight out of the
bible's §12 and §13.2.

| Surface | Cadence | What it is |
|---|---|---|
| `frames/live.json` | **every tick — 288×/day** | Countdowns count down, battle gaps close, convoys move, `FORMING` sockets pulse. Genuine motion. |
| `frames/latest.json` | **once per Reckoning** | The ceremony. 30–45 minutes, typeset, immutable. |
| `frames/r-000015.json` | **written once, never changes** | The archive. A free, exact scrubber over the world's whole life. |

A style that only works at one of those speeds is only half a style — and **four of the five are exactly
that.** A and E are live languages that would look absurd as a printed record. D is a record language
that cannot animate. B is the only other one that is plausibly speed-neutral, and it fails the profile
gate.

**C is the only direction that is credible at all three speeds**, because a hairline grid with one accent
is as happy holding a countdown as holding a settled docket. That, more than its looks, is the argument
for it.

The corollary worth stating plainly: **the live map and the nightly record are different products with
different jobs**, and the bible already says so — the live frame deliberately omits `map`, `swayLines`,
`tributeLines`, `standings` and every settlement artifact. Two languages is not indecision; it is
matching the artifact.

---

## 5. What the audience already expects

The owner's correction was right and worth writing down: **the audience is people who download and run
AI agents.** They are science-fiction natives and a meaningful fraction are EVE-literate. They arrive
with priors, and there are only three things to do with a prior.

**Match it (E).** Cheapest comprehension. An EVE player reads a sovereignty overlay with zero onboarding,
and the game genuinely *is* one shard, player-made economy, permanent public loss, territory. The cost is
the vocabulary hazard in §3 — and a second, subtler one: matching the prior invites the comparison
"this is EVE but worse", against a game with twenty years of content.

**Break it deliberately (D).** The Star Catalogue says *this is a record, not a client*. That is a true
claim about the product — A5 makes every row permanent, and there is a free exact scrubber over the
world's whole life — and it is the claim least likely to be made by anything else in the category.

**Sidestep it (C).** The hard-SF instrument reads as competent infrastructure rather than as a game. For
an audience that runs agents for a living, "this looks like a real instrument" may land harder than
"this looks like a game you already play". It is also the only one that would not look out of place
beside a terminal.

**One prior is worth honouring regardless of direction:** this audience reads dense tables happily. The
`MAX_LABELS_PER_FRAME = 7` budget governs *named entities on the stage* — it is not a licence to hide
the data. E's `SYSTEMS (30)` and `LANES (35)` panels are the right instinct even if E's noun set is not.

---

## 6. Why two languages, and where the seam goes

If the recommendation is taken, the seam is not arbitrary — it is already cut into the frame contract.

| | **THE INSTRUMENT** (C) | **THE RECORD** (D) |
|---|---|---|
| Serves | `frames/live.json`, the map, the agent-facing surfaces | `frames/latest.json`, the rundown, the receipt reel, profiles, the archive |
| Cadence | 288×/day | 1×/day, then immutable forever |
| Palette | near-white, hairlines, **one** instrument orange | midnight navy, gold, **one** oxidised vermilion |
| Shared | the same monospace for all data; the same `·` separator; UPPERCASE objects, sentence-case narration; integers only, basis points for percentages | ← identical |

The shared row is what makes it one product rather than two. Both directions already converged on
monospace for evidence and both use a single reserved second colour for failure — they differ in
*temperature*, not in grammar. `reel-d` demonstrates the seam working inside a single image: engraved
chrome, monospace transcript.

**Three things to fix before either is built:**

1. **Give the claim tint a hue channel.** C and D both needed a legend on the map purely because their
   palettes could not tell four claimants apart. A got this free. Reserve 4–6 hues for claimants and
   spend the accent colour only on failure — do not let the style's discipline eat the one signal that
   most needs colour.
2. **Do not draw a HAND as a human hand.** Three of five directions rendered `HANDS` as literal
   engraved or iconic human hands. A HAND is a unit of simultaneous presence — labourer, trucker and
   soldier at once — in a galaxy with no people in it. `profile-c`'s abstract square / arrow /
   dashed-circle is the canon-safe reading.
3. **Budget for the four states you will never see.** Per bible §14.3, today's worlds only ever produce
   `SUPPLIED` claims, `CLOSED_GOLD` and `SNAPPED_BLACK` glyphs, `HONOURED` seals and an empty
   `receiptReel`. Every reel in this sweep draws a `CONTRADICTED` seal that **has never occurred in a
   real world.** Design the states; do not expect the screenshots.

---

## 7. What the generator could not do — read the images with this in hand

These are artifacts of the tool, not of the directions. Judge the *language*, not the spelling.

- **It invented place names.** Only `Moorage · sys-29`, `Nettle · sys-15` and `Vale — sable's` were
  supplied, so the rest of the gazetteer is fiction. `sys-` ids are frequently attached to the wrong
  node, and D duplicated several node numbers outright. The real 30-row table is bible §6.4 — draw from
  that, never from these.
- **Tier did not survive.** No direction rendered Commons / Marches / Frontier as three legible bands.
  Every one of them got `THE COMMONS` right — ringed, central, uncrossed — and then let the outer two
  tiers blur together. This is the one map signal the sweep failed on, five for five, and it is worth a
  targeted re-run.
- **E invented mechanics, ships and a currency.** See §3. Nothing in `profile-e`'s or `reel-e`'s tables
  should be read as a data shape. This one is *not* purely a tool artifact, though — the prompt named
  no EVE noun, so the pull came from the visual reference itself, which is the finding.
- **`reel-e` needed one retry** (first attempt errored, second succeeded). All 15 cells are present. Had
  any failed permanently, the gallery renders a labelled placeholder rather than dropping the cell — a
  missing cell would read as "this direction has no reel", which is the exact class of
  absence-that-looks-like-a-choice this project keeps getting wrong.

---

## 8. What to do next

1. **Show the gallery.** `samples/gallery.html`, grid-by-subject first — comparing five maps to each
   other is the judgement; scrolling fifteen unrelated images is not.
2. **If C wins:** it is a CSS re-skin of `client/index.html` plus a new SVG map layer. The map has
   **never been drawn at all** — `map`, `swayLines`, `claimLines` and `compactLinks` are among the
   best-populated keys on the frame and are referenced by zero renderers (bible §14.1), so that work is
   pure drawing against live data.
3. **Re-run the tier question** at `--size 2K --quality high` on the two or three finalists only. It is
   the one signal that failed across the board and it is cheap to retest.
4. **Then the gate that actually matters.** None of this is the watchability test. Three humans, one
   Reckoning, each names a character they rooted for and what was at stake, without reading the rules.
   It is still unrun, it cannot be automated, and §16 says everything downstream depends on it.
