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
