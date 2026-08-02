#!/usr/bin/env python3
"""AGENT EVE — the client's generated art plates.

The screen mocks under docs/design/graphics-2026-07-30/samples/ are the house style. This script
generates the *pieces* the renderer needs as real assets, in that same language, so the CSS and the
art are one product rather than two: hull silhouettes, principal crests, good icons, the RUIN mark,
the seal stamps and a backdrop plate.

It reuses render_screens.py's prompt scaffolding on purpose — the ~90-term ban list, the positive
canon whitelist and the style block. That scaffolding is why the last eighteen images had zero
vocabulary leaks where the first sweep leaked twenty.

    python3 gen-assets.py               # generate anything missing
    python3 gen-assets.py --force       # regenerate everything (costs money)
    python3 gen-assets.py --only hulls
    python3 gen-assets.py --print-only hulls

Cost: ~$0.08 and ~240 s per plate at 1K/medium; 2K/high is slower. Five plates.

★ Two hazards, both observed live in the earlier sweeps, both handled positively here rather than
  as prohibitions:
    - the model invents handles that collide with canon (`morrow` against the constellation MARROW,
      `warden` against the WARDEN hull), so every plate below either supplies its own strings or
      asks for NO TEXT AT ALL;
    - it draws a VERGE dashed every single time it is told not to. A prohibition does not work;
      "one continuous solid outline" does. Nothing here draws a VERGE — the renderer does — but the
      lesson stands: phrase every rule positively.
"""
import argparse
import concurrent.futures as cf
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLES = os.path.abspath(os.path.join(HERE, "..", "..", "docs", "design", "graphics-2026-07-30", "samples"))
GEN = os.path.expanduser("~/Projects/ideationjul3/yc-gstack-kit/tools/media/gen_image.py")
REF = os.path.join(SAMPLES, "profile-e-evenative.png")

sys.path.insert(0, SAMPLES)
try:
    import render_screens as _rs  # noqa: E402
    CANON = _rs.CANON.strip()
    STYLE = _rs.STYLE.strip()
    TEXT_RULE = _rs.TEXT_RULE.strip()
except Exception as exc:  # pragma: no cover - the sample scripts are not ours to depend on
    print(f"! could not import render_screens ({exc}); using the inline fallback", file=sys.stderr)
    CANON = "Use only these words: PRINCIPAL HAND HOLDING WORKS ANCHOR RUIN CLAIM STORES CREST VENTURE COMPACT SEAL STANDING GRANT DOSSIER OFFICE LIMITS ESCROW SYNDICATE CHARTER STRONGBOX TREASURY RECKONING LEVY TRIBUTE DOCKET RUNDOWN FREEZE TICK CONSTELLATION STRAIT LODE VERGE COMMONS MARCHES FRONTIER LANE RAID DEMAND STANDOFF CAMPAIGN SAP FORMATION ECHELON GAP WRECK FRONT CONE SWATH COVER INDEMNITY ore ration alloy fuel minor. The five hulls are PIKE LANCE WARDEN BULWARK CITADEL and have no other names."
    STYLE = "Very dark near-black charcoal ground. Cyan and teal on dark, red reserved for failure. Hairline chrome, tiny condensed type, high information density."
    TEXT_RULE = "Text must be sharp and spelled exactly as given. Invent no additional words."

# The measured palette. Sampled out of profile-e6-broadcast.png and screen-grants.png rather than
# picked by eye, and the same six numbers are the client's CSS custom properties. Saying them to the
# image model is what keeps the generated art from being one hue off the interface.
PALETTE = """
THE EXACT PALETTE, and nothing outside it:
  ground        #00060a  near-black with a trace of blue
  panel fill    #000d12
  hairline      #123038
  dim text      #6f8288
  bright text   #cfdadd
  ACCENT CYAN   #19d7f2   - the one bright colour, used sparingly
  deep cyan     #0a6a7d
  FAILURE RED   #ca010f   - used ONLY for failure, on nothing else
  warm amber    #d89c42   - used ONLY for a value at risk
"""

BASE = f"""
{CANON}

{STYLE}

{PALETTE}

{TEXT_RULE}

This is a FLAT GAME-INTERFACE ASSET PLATE, drawn straight-on, filling the frame edge to edge. It is
not concept art, not a poster, not a photograph of a screen, no device bezel, no hands, no people,
no lens flare, no depth-of-field blur. Every edge is crisp enough to sit inside a data panel at
1:1. The ground is FLAT #00060a with no vignette and no gradient wash, so the plate composites onto
a dark interface invisibly.
"""

PLATES = {}


def plate(key, aspect, size, quality, prompt):
    PLATES[key] = dict(key=key, aspect=aspect, size=size, quality=quality, prompt=prompt.strip())


# ─────────────────────────────────────────────────────────────────── 1. the hull ladder
#
# The five hulls in one plate, on purpose. A consistent lighting angle and a true size
# relationship across all five matters more than any individual silhouette: they have to read as
# one fleet and as a LADDER, because that is what a hull ladder means. Generated as one image so
# the model holds the relationship itself rather than five images hoping to agree.
plate(
    "hulls", "21:9", "2K", "high",
    """
SUBJECT: FIVE HULLS IN ONE SIZE LADDER, drawn as an interface plate for a fitting screen.

Five vessels in a single horizontal row, left to right, SMALLEST TO LARGEST, on a flat near-black
ground. They are one fleet built by one shipyard: the same plating language, the same panel-line
density, the same three-quarter view from very slightly above and to the left, the same single key
light from the upper left with a cool cyan rim on the leading edge, the same neutral grey hull with
cyan running lights. Nothing is firing, nothing is damaged, nothing is in a nebula.

THE LADDER IS THE POINT. The size relationship must be true and obvious at a glance:
  1. PIKE     - a thin dart. One engine. The smallest thing here; it is a needle beside the last.
  2. LANCE    - roughly twice the PIKE. A long spine with two outboard engines and a forward spar.
  3. WARDEN   - roughly four times the PIKE. A broad flat wedge with a deep dorsal ridge, wing-like
                sponsons and visible sensor masts. It looks like it is there to hold a position.
  4. BULWARK  - roughly eight times the PIKE. Slab-sided, heavy, armoured, blunt-nosed, small
                windows in long rows. It looks like it is there to absorb.
  5. CITADEL  - roughly twenty times the PIKE. An immense angular tower of a vessel with a spine of
                docking arms; the PIKE beside it is a splinter.

Beneath each vessel, one small caption in tiny condensed uppercase, in dim grey, and these are the
ONLY five words on the whole plate:
    PIKE      LANCE      WARDEN      BULWARK      CITADEL

A single hairline rule runs beneath the row under all five captions. Nothing else. No numbers, no
statistics, no other labels, no logo, no frame.
""")

# ─────────────────────────────────────────────────────────── 2. principal crests (sliceable grid)
#
# A strict grid so the renderer can slice it deterministically. The plate carries NO TEXT at all —
# every earlier sweep that let the model letter a crest invented a handle, and one of them collided
# with a constellation name. The client letters them from the frame.
plate(
    "crests", "1:1", "2K", "high",
    """
SUBJECT: SIXTEEN PRINCIPAL CRESTS, as a strict 4 x 4 grid of identically-sized square tiles.

Each tile holds ONE crest: a small, flat, geometric emblem, centred, drawn in thin cyan line work
on the flat near-black ground, with a single darker cyan fill at most. Think a heraldic mark
reduced to instrument-panel geometry - a compass rose, a set of concentric arcs, a chevron stack, a
radiating burst, a knotted hexagon, a pair of interlocking rings, a ladder of bars, a starburst, a
spiral of dashes, a segmented ring, a trefoil of blades, a crossed pair of spars, a stepped
pyramid, a lattice diamond, a broken circle, a sheaf of lines. Sixteen DIFFERENT marks, each
instantly distinguishable from the other fifteen at 40 pixels across.

Every crest occupies the same proportion of its tile and sits dead centre with generous margin, so
the grid can be cut into sixteen equal squares without clipping any mark.

★ THERE IS NO TEXT ANYWHERE ON THIS PLATE. Not a caption, not a number, not a letter, not a
watermark. Sixteen wordless marks on a flat dark ground, and a hairline grid between the tiles.
""")

# ────────────────────────────────────────────────────────────────── 3. the four goods
plate(
    "goods", "1:1", "2K", "high",
    """
SUBJECT: FOUR GOOD ICONS, as a strict 2 x 2 grid of identically-sized square tiles.

Flat, geometric, instrument-panel icons in cyan line work on the flat near-black ground. Each fills
the same proportion of its tile, dead centre, generous margin, so the plate cuts into four equal
squares cleanly. Read clearly at 24 pixels across.

  TOP LEFT      ore     - a cluster of rough angular crystalline chunks
  TOP RIGHT     ration  - a sealed stackable supply canister with a banded lid
  BOTTOM LEFT   alloy   - a stack of three refined flat ingots seen in three-quarter view
  BOTTOM RIGHT  fuel    - a pressurised cell with a valve and a level window

The four words ore, ration, alloy, fuel appear beneath their icons in tiny condensed lowercase dim
grey, and are the only text on the plate. No numbers, no other words, no logo.
""")

# ───────────────────────────────────────────────────────── 4. the marks — RUIN, seals, hand states
plate(
    "marks", "1:1", "2K", "high",
    """
SUBJECT: TWELVE INTERFACE MARKS, as a strict 4 x 3 grid of identically-sized square tiles, all flat
geometric line work on the flat near-black ground, all cutting cleanly into twelve equal tiles.

ROW 1 - the seal stamps, drawn like a wax seal reduced to a stamped ring of line work:
  1. a closed circular seal stamp, unbroken, drawn in CYAN - it was kept
  2. a circular seal stamp with a jagged break splitting it in half, drawn in RED #ca010f - it was
     contradicted
  3. a circular seal stamp still shut, its centre filled with a solid dark disc, drawn in dim grey -
     it is still sealed
  4. a circular seal stamp with its lower arc missing entirely, drawn in dim grey - it lapsed

ROW 2 - the RUIN mark and its neighbours, all in dim grey and RED #ca010f:
  5. THE RUIN - a heavy dark irregular blot with a cracked broken ring around it, the darkest and
     most solid mark on the whole plate; it must read as something permanently destroyed
  6. a WRECK - a small broken angular hull fragment
  7. an ANCHOR - a squat holdfast plinth planted on a short baseline
  8. a WORKS - a small extraction rig of three braced legs over a shaft

ROW 3 - the hand states, each a simple ring with one distinguishing element, in CYAN:
   9. IDLE       - a plain open ring
  10. IN TRANSIT - a ring with a double chevron pointing right through it
  11. COMMITTED  - a hexagon inscribed inside a ring
  12. RECOVERING - a ring drawn as a broken clockwise arc with a gap at the top

★ THERE IS NO TEXT ANYWHERE ON THIS PLATE. No captions, no numbers, no letters. Twelve wordless
marks and a hairline grid.
""")

# ───────────────────────────────────────────────────────────────── 5. the backdrop plate
#
# Backdrop only, and it must stay backdrop: the map's data is drawn in SVG on top of this, so
# anything here bright enough to compete with a node is a bug. Deliberately almost empty.
plate(
    "backdrop", "16:9", "2K", "medium",
    """
SUBJECT: A BACKDROP PLATE for a dark data map. It sits UNDERNEATH a node-and-lane graph and must
never compete with it.

An almost-black field, flat #00060a, carrying only: a very faint regular dotted measurement grid;
a scattering of small dim stars, none of them bright, none of them flaring, no lens flare, no
diffraction spikes; and two or three enormous extremely faint cool-teal dust clouds that are barely
distinguishable from the ground - suggestions of depth, not features. The overall impression at a
glance is FLAT DARK, and only on a second look does the texture appear.

The four corners and the centre are the emptiest parts, because panels and nodes go there.

★ NOTHING BRIGHT. The brightest pixel on the plate is a dim grey star, far dimmer than a cyan
interface line would be. No planets, no vessels, no cockpit, no horizon, no sun, no text, no logo,
no frame, no vignette.
""")


def build(spec):
    return "\n\n".join([BASE.strip(), spec["prompt"]])


def generate(spec, force):
    out = os.path.join(HERE, f"{spec['key']}.png")
    if os.path.exists(out) and not force:
        print(f"· {spec['key']}: exists, skipping")
        return spec["key"], True
    cmd = [sys.executable, GEN, build(spec), "-o", out,
           "--aspect", spec["aspect"], "--size", spec["size"], "--quality", spec["quality"]]
    if os.path.exists(REF):
        cmd += ["--ref", REF]
    print(f"→ {spec['key']}: generating {spec['size']} {spec['aspect']} …", flush=True)
    r = subprocess.run(cmd, capture_output=True, text=True)
    ok = r.returncode == 0 and os.path.exists(out)
    print(f"{'✓' if ok else '✗'} {spec['key']}: rc={r.returncode} {r.stderr.strip()[-400:]}", flush=True)
    return spec["key"], ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", action="append", default=[])
    ap.add_argument("--print-only")
    a = ap.parse_args()
    if a.print_only:
        print(build(PLATES[a.print_only]))
        return
    keys = a.only or list(PLATES)
    with cf.ThreadPoolExecutor(max_workers=len(keys)) as pool:
        results = list(pool.map(lambda k: generate(PLATES[k], a.force), keys))
    bad = [k for k, ok in results if not ok]
    print(f"\ndone. {len(results) - len(bad)}/{len(results)} plates" + (f"; FAILED: {bad}" if bad else ""))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
