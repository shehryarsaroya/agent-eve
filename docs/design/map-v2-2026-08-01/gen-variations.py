#!/usr/bin/env python3
"""MAP V2 — four concept variations, each answering the owner's complaint differently.

The complaint, from a screenshot of the live map (2026-08-01): thirty near-identical rings at
equal visual weight, lanes as undifferentiated hairlines, the tier ellipses reading as
decoration, and the night's one line of real drama ten pixels tall. "It just needs to be quite
a bit clearer" — plus hover should progressively disclose, and it must survive a phone.

Four directions, one variable each, so the pick is informative rather than a mood:

  A  HIERARCHY   — size and ink budget follow STAKES. The three systems where money or war
                   stand tonight are large and annotated; everything quiet is a dim point.
  B  HOVER CARD  — the resting map is almost silent; one hovered system shows the full card
                   (holder, works, claim state, tribute owed) pinned beside it. The variation
                   is about what the RESTING state may omit because hover carries it.
  C  TIER BANDS  — the Commons/Marches/Frontier read as three lit shelves of a physical relief
                   map, not three hairline ellipses; lanes only exist where they cross a shelf
                   edge (straits), which is the only place a lane ever matters.
  D  PHONE       — the same world as a single-column phone screen: the map as a vertical
                   ladder of constellations, thumb-sized targets, the seat pinned at top.

Reuses render_screens.py's scaffolding (canon whitelist, ban list, style, measured palette) for
the same reason gen-assets.py does: that scaffolding is why the last sweep had zero vocabulary
leaks. Reference image = the shipped tactical concept, so the variations stay in the family the
owner already picked once.

    python3 gen-variations.py            # generate all four (≈$0.32, ~4 min, parallel)
    python3 gen-variations.py --only a
"""
import argparse
import concurrent.futures as cf
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLES = os.path.abspath(os.path.join(HERE, "..", "graphics-2026-07-30", "samples"))
GEN = os.path.expanduser("~/Projects/ideationjul3/yc-gstack-kit/tools/media/gen_image.py")
REF = os.path.join(SAMPLES, "mapconcept-tactical.png")

sys.path.insert(0, SAMPLES)
import render_screens as _rs  # noqa: E402

CANON = _rs.CANON.strip()
STYLE = _rs.STYLE.strip()
TEXT_RULE = _rs.TEXT_RULE.strip()

COMMON = f"""{STYLE}

{CANON}

{TEXT_RULE}

A galaxy map screen for a dark spectator console, 16:9. The world: three concentric TIERS —
THE COMMONS (a small safe heart, four systems), THE MARCHES (the contested middle, eighteen),
THE FRONTIER (the sparse rim, eight). Systems are named ports like Salt Ward, Bright Ash,
Coldwater, Lantern. Red appears ONLY where a promise was broken. Amber marks value at risk:
tribute owed, a claim in arrears. Cyan is structure. One continuous solid outline around any
group that shares a sworn border.
"""

VARIATIONS = {
    "a": (
        "map-v2-a-hierarchy",
        COMMON
        + """
THIS VARIATION: INK FOLLOWS STAKES. Exactly three systems are LARGE — a claimed port paying
rent with an amber '258K OWED' tag, a standoff with two sides massed, a port whose holder broke
a promise tonight (one red mark). Each large system carries a two-line annotation plate. Every
other system is a small dim point with a name only, no ring, no id. Lanes are visible only
between the three large systems and their neighbours. The eye lands on the three in the first
second, the quiet twenty-seven read as background texture. A thin key bottom-left: LARGE MEANS
AT STAKE TONIGHT.""",
    ),
    "b": (
        "map-v2-b-hovercard",
        COMMON
        + """
THIS VARIATION: THE HOVER CARD IS THE HERO. The resting map is nearly silent — small dim ports,
names only, no ids, no rings. One system (Coldwater) is hovered: it glows, its lanes to
neighbours light up, and a pinned card beside it shows the full record in tiny condensed rows:
HOLDER kestrel · WORKS 2 · 51/tick · CLAIM SUPPLIED · RENT 20% · TRIBUTE 4,000 DUE · 3 defaults
as three small red triangles. A faint cursor arrow rests on the port. Everything not hovered
stays quiet, so the single lit system and its card carry the whole story.""",
    ),
    "c": (
        "map-v2-c-tierbands",
        COMMON
        + """
THIS VARIATION: THE TIERS ARE SHELVES, NOT ELLIPSES. The map reads like a physical relief chart:
THE COMMONS is a small bright inner plateau, THE MARCHES a wide mid shelf a step darker, THE
FRONTIER a sparse dark rim — three luminance bands with soft carved edges, each band labeled
once in large quiet letters. Lanes appear ONLY where they cross a shelf edge, drawn as short
bright bridges with a small gate tick — the straits — because a crossing is the only place a
lane matters. Ports sit flat on their shelves as small discs with names. Depth from luminance,
never from perspective tilt.""",
    ),
    "d": (
        "map-v2-d-phone",
        COMMON.replace("16:9", "9:16 portrait, a phone screen")
        + """
THIS VARIATION: THE SAME WORLD ON A PHONE. A single-column ladder: at top a pinned seat strip
reading THE SEAT · 15 TRIBUTE · 258K OWED in amber. Below it four constellation cards stacked
vertically, each a rounded panel holding its systems as a row of thumb-sized discs with names
beneath; one card is expanded showing its systems with two-line records, the others collapsed
to a title and a count. Bottom: a fixed tab bar with MAP · NIGHTS · NAMES. Text large enough
for a phone, targets a thumb wide, one column, no horizontal panning.""",
    ),
}


def generate(key: str, force: bool) -> str:
    name, prompt = VARIATIONS[key]
    out = os.path.join(HERE, f"{name}.png")
    if os.path.exists(out) and not force:
        return f"  = {name}.png exists, skipped"
    aspect = "9:16" if key == "d" else "16:9"
    cmd = [sys.executable, GEN, prompt, "-o", out, "--aspect", aspect, "--size", "2K",
           "--quality", "high", "--ref", REF]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        return f"  ! {name} FAILED: {r.stderr.strip()[:300]}"
    return f"  + {name}.png"


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=sorted(VARIATIONS))
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    keys = [args.only] if args.only else sorted(VARIATIONS)
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        for line in ex.map(lambda k: generate(k, args.force), keys):
            print(line)
