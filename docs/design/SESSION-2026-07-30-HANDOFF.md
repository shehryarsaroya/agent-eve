# SESSION HANDOFF — the spectator client rebuild

*Appended 2026-07-31. If this session dies, this file is what lets the next one continue without
re-deriving anything.*

---

## What this session did

Rebuilt `client/` from a 48 KB cream-and-serif paper almanac into the EVE-inspired charcoal console
the owner chose (`profile-e1-terminal.png` for operator density, `profile-e6-broadcast.png` for
poster scale — the same screen at two zoom levels, not two designs), and **drew the map, which had
never had a pixel drawn from it.**

## Files

| Path | What |
|---|---|
| `client/index.html` | The shell. Chrome, tab bar, backdrop, script tags. **`?v=N` on every asset — bump it in the same commit as any change under `app.css`/`app.js`/`lib/`.** |
| `client/app.css` | The design system. Palette and geometry MEASURED off the mocks, not chosen. |
| `client/app.js` | Data layer (three static frames), router, canvas starfield. |
| `client/lib/ui.js` | Shared drawing helpers: tables, panels, tiles, the venture glyph, crests, empty/skeleton states. |
| `client/lib/mapview.js` | ★ THE MAP. Layout, marching-squares VERGE, straits, bands. |
| `client/lib/screens.js` | The eight screens. |
| `client/assets/*.webp` | Five generated plates, 280 KB total. |
| `client/assets/gen-assets.py` | The prompts, re-runnable. Reuses `render_screens.py`'s ban list and canon whitelist. |
| `docs/design/graphics-2026-07-30/plates-src/` | The 2K originals, outside the rsync. |

## Deployed

`https://agentinsurance.io/compact/` — deployed with `./deploy/deploy.sh client` (static files +
nginx reload; it does **not** restart the API and must not).

## How to work on it

```bash
# a dense fixture — a mature 8-Reckoning world with real frames
cd engine && npx tsx src/sim/cli.ts --seed viz-dense --ticks 2600 --speed instant \
  --cast heuristic --principals 16 --frames /tmp/compact-fixture --quiet

# serve the client against it
mkdir -p /tmp/compact-dev && cd /tmp/compact-dev
for f in index.html app.css app.js lib assets; do ln -sf $REPO/client/$f .; done
ln -sfn /tmp/compact-fixture frames
python3 -m http.server 8791 --directory /tmp/compact-dev

# and a SPARSE one — prod's live.json alone, no latest.json. This is the state
# the live world is in for the first 288 ticks of its life and it must not look
# like an outage.
mkdir -p /tmp/compact-sparse/frames
curl -s https://agentinsurance.io/compact/frames/live.json -o /tmp/compact-sparse/frames/live.json
python3 -m http.server 8792 --directory /tmp/compact-sparse
```

Screenshots: `~/.claude/skills/gstack/browse/dist/browse goto <url> && … screenshot <path>`.
**Always pass a cache-busting query** — the browse daemon holds `max-age` like any browser and will
show you the previous build.

## The rules this client holds itself to

1. **Draw only what the frame carries.** No invented constellation names, no invented anything.
2. **RED MEANS A PROMISE WAS BROKEN**, and nothing else. Amber is value at risk or taken. A raid is
   a loss, a severing strait is geography, a ruin is destruction — none of them is a lie.
3. **An empty panel says so in one dim line**, with the argument on hover. Never a paragraph of
   frame-key names at the audience.
4. **Sparse keeps its structure.** Frames, headers and tiles present but blank read as *not yet*;
   one card in a black page reads as an outage.
5. **THE VERGE is one continuous solid outline.** No dash, no gap, no hole — a hole is a false claim
   about a real principal.
6. **No score, no grade, no gauge on STANDINGS.** Raw counts; the judging is the show.

---

## Where it ended (2026-07-31)

**Deployed and live at `https://agentinsurance.io/compact/`.** Eight screens, drawing the production
world, which settled its first Reckoning at tick 287 while this was being built.

`docs/design/graphics-2026-07-30/built/*.webp` are the eight deployed screens as shipped — the
reference for whether a later change is an improvement or a regression.

### ★ THE RECEIPT REEL FIRED, on production, for the first time

`VISUAL-READINESS-2026-07-30.md` §5 measured `rundown[].receiptReel` as **null on all 180 segments
across three seeds**, and recorded that no cast in this repo had ever produced one. On the production
frame for Reckoning 0 it is populated, and §14's signature artifact renders with real content:

```
2  THE WORDS   PARTIES · DECLASSIFIED AT SETTLEMENT
   t37   vex   "I will pay my elective share IN_FULL at settlement;
                protection is a contract, not a sentiment."
   t127  vex   "I will pay my elective share in full on every role I hold."
4  THE DEED
   vex's 2K was riding on halcyon's escort. vex walked away from 566 of
   the 2K it had promised.
```

The LLM cast talks, and the say-do gap is on screen. Two of the four acts are still empty on that
beat — no grant bound it, and the seal was HONOURED — and both say so in one line each.

### Frame fields the client wants and the engine does not publish

| Field | Why |
|---|---|
| `map[].constellationName` | The frame publishes `con-1`…`con-4`. The mock series invented HEARTH / THRESHOLD / MARROW / VANE and `MARROW` collides with the live handle `p:marrow`. The map draws the ids and the legend says the counts exclude the Commons. |
| a hand roster on any principal | The mocks show a HANDS strip (IDLE · IN TRANSIT · COMMITTED · RECOVERING). No key carries one, so the dossier cannot draw it. |
| a principal-scoped read | Every key is a world-scoped array capped for broadcast. A quiet principal simply is not on tonight's frame, which is not the same as never having dealt — the dossier says so rather than implying zero. |
| `StandingRow.storesByGood` | THE GOODS on MARKET can show what the world traded, never what a principal holds. |
| a crest / sigil per principal | Assigned client-side by hashing into a generated 16-tile plate. Deterministic, but it is the client's choice, not the world's. |

### ⚑ One engine discrepancy the client surfaced

On the dense fixture, `meters.kept` / `meters.broken` equal `sum(standings[])` **exactly on eight of
nine frames** — 25/13 · 65/17 · 101/23 · 140/24 · 182/26 · 217/29 · 256/32 · 299/33 — and part company
on the ninth: **318/20 against 343/33**. So `meters.broken` goes 33 → 20 between R7 and R8, a
cumulative counter running backwards on a published frame. Not diagnosed. The client draws both
sources and prints a line saying they disagree rather than picking one.

### The critic loop

Four rounds, each against the mock PNGs at matched width with numeric deltas demanded. Round 4's
verdict was still STRUCTURAL; everything it named is fixed. The three findings worth remembering
because they were *correctness*, not taste:

1. **THE VERGE, three times.** Labels over the fence punched holes in it; the fence over the labels
   struck 12 of 30 names through. Neither paint order was the answer — a label on a bloc member is
   always inside its own fence, so the label has to move past `VERGE_R`.
2. **THE FREEZE read 91% elapsed at tick 7 of 288**, because the current phase and the elapsed
   portion were two indistinguishable alphas and EARLY is 262 of 288 ticks. It had also been wrong
   about the phase boundaries entirely (0/144/240/276 against the real 0/262/286/287).
3. **`flex: 0 0 208px` meant 745px**, because a flex item defaults to `min-height: auto`. Fixing that
   globally then removed the floor under the tile strip and cut every headline number in half. Both
   are in `app.css` with the reasoning at the call site.

---

# ★ THE MAP, REBUILT FROM TWO CONCEPTS (2026-07-31)

*Client only. No engine file touched, no restart. Four commits, `?v=22`, live at
`agentinsurance.io/compact/#/map`.*

Owner picked two of the seven renders in `docs/design/graphics-2026-07-30/samples/`:
**`mapconcept-tactical.png`** became the MAP screen, **`mapconcept-zoomed.png`** became a new
drill-down. The PROMISES rail was stolen from **`mapconcept-terrace.png`**.

## What shipped

| | |
|---|---|
| `client/lib/mapview.js` | full-bleed layout with an `inset`, the seeded canvas star field, the reticle + callout, THE SEAT |
| `client/lib/zoomview.js` | **new.** `#/zoom/<con-N \| sys-NN>` — one constellation at 5× |
| `client/lib/screens.js` | `mapScreen` rewritten as floats; `zoomScreen`; `promisesRail` |
| `client/lib/ui.js` | `U.guard` — a deferred draw that throws must still say what broke |
| `client/app.css` | the tier ladder moved off the fills onto the edges; ~15 new mark classes |

**THE MAP.** Galaxy full-bleed; SYSTEMS + PROMISES float over it at 0.72 alpha with a 3 px backdrop
blur; the key is bottom-left, collapsed to its two colour ramps by default; the layer toggles are a
21 px chip row bottom-right. A selected system is ringed by a reticle and answered by a callout
carrying the claim, the pinch, the works, the sway, the place and a `▸ DRILL INTO CON-N` affordance.

**THE DRILL-DOWN.** `#/zoom/con-2`. Reached by clicking a constellation arc, double-clicking a node,
or the callout's CTA. Per system: THE LODE as disc size, one hatched square per WORKS (hollow while
SPINNING UP), the ANCHOR solid when hot and hollow+captioned when cold, a RUIN as a crossed square,
venture rings in their own band, a raid arc, exit stubs naming what is on the other side, a locator
inset, and a rail carrying `WORKS AT sys-XX` with holder / share / extracted / state.

## ⚑ Five things worth carrying forward

1. **FLOATING PANELS ARE ONLY SAFE BECAUSE THE LAYOUT KNOWS WHERE THEY ARE.** The very first map build
   floated its legend onto a live FRONTIER system, which is why everything got docked. `MapView.layout`
   now takes an `inset` and the ellipse is centred in the FREE area. Translucency is a bonus (you can
   watch a lane run behind the rail), never the mitigation. `ZoomView.place` does the same with an
   `avoid` rect list.
2. **"FULL-BLEED" WAS A LOSS UNTIL IT WAS MEASURED.** The first build came out **1251×759 against the
   docked build's 1257×776** — six pixels narrower. `RX = FW * 0.435` was the docked build's margin
   kept on top of an inset that now reserves every panel, and `t:33 / b:30` reserved full-width strips
   for panels 460 px and 306 px wide *at the left* while the ellipse's extremes are at `cx`. Now
   1300×902, +16%. **Never claim a layout win you have not measured against the thing it replaced.**
3. **A CAPABILITY IN THE DOM IS NOT A CAPABILITY ON SCREEN.** The star field went through three rounds:
   390 stars at 1 px that `querySelectorAll` found and no viewer could see; then 2,100 at 2.6 px that
   overshot so far the brightest *decoration* out-punched nine of thirty charted *systems*; then the
   realisation that the container was the constraint. Four `<path>`s inside the pan group means a
   28,000-subpath re-raster per drag frame. **Canvas for the field, SVG for the data** — the brief said
   so — and density stopped being a cost decision. 28,000 stars, **8.3 ms median while dragging.**
4. **A rAF THAT THROWS BLANKS A SCREEN IN SILENCE.** `app.js` wraps `paint()` so a broken screen is
   never blank; both map screens then defer the canvas draw to `requestAnimationFrame`, which runs
   outside that catch. A hoisting error blanked the whole drill-down, printed nothing the harness
   could see, and left the rails around 1450×960 of black — **indistinguishable from an empty
   constellation, which is a state this world genuinely has.** `U.guard` now wraps every deferred draw.
5. **A RULE FIXED AT THREE SITES IS NOT FIXED.** The handle/badge split — a defaulter's handle keeps its
   bloc colour, only the `▲N` is red — took four commits to land at all four of its sites, and the last
   one to be found was the KEY's collapsed bar: the panel whose entire job is to teach the encoding,
   on screen by default, teaching the opposite of the map 40 px above it.

## THE SEAT — `tributeLines[]` had 13 rows and no pixel

The third critic's sharpest line: *"your map answers where things are; the concept's answers who is
about to lose something."* The field that answers it was already on the frame. `tributeLines[]` has
carried thirteen rows since it was written and **nothing had ever drawn one**. A14 makes the Levy the
one promise nobody can dodge into quiet, and it was the one promise with no mark on A13's "only agreed
representation of the world".

Eleven of tonight's thirteen converge on `sys-01`, one on `sys-08`, one on `sys-16` — the
*"convergence on a handful of hands"* the frame contract says the key exists to render. Now: **six
spokes pointing inward** (not a fourth dotted ring — the COMMONS boundary, the fuel ring and an
arrears outline were already three) plus `◈ 11 TRIBUTE · 31K OWED`, amber when a line into that seat
is REVERSING or DASHED. And TRIBUTE rows in the PROMISES rail, which took it from 36 to 49.

## Which of the zoomed concept's fields turned out to have no data

| concept shows | status |
|---|---|
| `worksLines[]` occupants, per-holder share, `extracted` | **live and now drawn.** `sys-05` carries SEVEN holders at 15/tick with totals 20,249 → 13,696 |
| `SPINNING UP 9 ticks` | **live.** `worksLines[].legend`; drawn as a hollow square + a state line. No WORKS is spinning up tonight |
| `claimLines[].anchorHot` | **live and now drawn.** `true` on both claims tonight, so `ANCHOR COLD · COLLECTING NOTHING` is written and untested against real data |
| `CEDED` | **live as a `ClaimState`.** No claim is CEDED tonight; the ramp and the `.zstate.ce` colour exist and have never rendered |
| `ruins[]` | **live, and empty.** Every field exists (`legend`, `fellAtReckoning`, `razedByHandle`, `extracted`); `ruins.length === 0` in this world, so `.zruin` has never drawn |
| `swayLines[].reachers` | **live and now drawn** |
| **hand states — `vex · COMMITTED`, `orrin · RECOVERING 31`** | **NO FRAME FIELD.** `HandState` is `IDLE \| IN_TRANSIT \| COMMITTED \| RECOVERING` in the engine and no frame key carries a roster. The nearest live analogue is `convoyLines[]` (an IN_TRANSIT hand on a lane) and it is **empty on every frame measured**. The ring of labels is drawn from WORKS holders instead and the concept's two exact strings are not drawn, because this client does not invent |

**And one field the drill-down found by drawing it:** when every visible holder shares a state, the
ring prints `extracted` instead. `EXTRACTING` printed ten times is a decoration that looks like data —
which is the same defect as `BARE` printed eight times on `con-4`, found one round later and fixed
with `richnessBps` (+533 · +333 · +66 · −133 · −600).

## The critic loop — three rounds, and what each caught that the last did not

| round | the finding that mattered |
|---|---|
| 1 | The full-bleed was **−2.7%**. Measured, not argued. Also: the tier ladder was 1.35:1 on the step a stranger needs most, and the fill was the wrong instrument for it |
| 2 | **There is no stake on the canvas.** 170 red px on the map field against the concept's 2,290, and 71% of ours inside the legend box. That is what produced THE SEAT |
| 3 | The star density **had not moved in two rounds** (11.5 → 12.5 per 10k against 160.7) while size and brightness converged — and the reason was the container, not the constant |

Every round demanded numeric deltas and every round found something the previous one had not, which is
the argument for running it more than twice.

## What I would do next

1. **Constellation boundaries on the map.** It names `CON 1 · 3`, `CON 2 · 8`, `CON 3 · 7` in large dim
   letterforms and draws a boundary for **none** of them — the three ellipses are TIERS. A viewer
   cannot answer "which systems are in CON 2" from the map, which is a question the drill-down now
   makes them want to ask.
2. **`VERGE_R = 30` is the map's own unresolved version of the argument the drill-down settled.** The
   drill-down does not draw a fence because at 250 px spacing a union of discs is a fence made of gaps
   — and on the map, at `VERGE_R = 30` with members 100–260 px apart, **every bloc's verge is already a
   set of disconnected circles** (`brannock` is printed twice, 260 px apart, with nothing between).
   Either disconnected loops are acceptable — and the drill-down should draw them and get the concept's
   signature mark — or `VERGE_R` is a bug. Both positions cannot be held.
3. **Nothing on either screen renders an arrears or a lapse, because nothing is in arrears.** Both
   claims are `SUPPLIED · PAID · 0 of 2`. The three-step claim ramp, `CEDED`, `LAPSED`, `RUIN` and
   `ANCHOR COLD` are all built and all untested against real data. A turbo world driven to a lapse
   would exercise five marks at once, and it is the cheapest confidence available.
