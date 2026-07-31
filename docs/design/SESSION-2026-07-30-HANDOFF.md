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
