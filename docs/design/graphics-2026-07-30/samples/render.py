#!/usr/bin/env python3
"""Style-direction sweep for THE COMPACT.

Five science-fiction art directions x three subjects (the map, a character
profile, THE RECEIPT REEL) = 15 draft images at 1K/medium via
tools/media/gen_image.py (openai/gpt-5.4-image-2).

All prompt text is real data out of docs/design/graphics-2026-07-30/VISUAL-ASSET-BIBLE.md.

    python3 render.py               # generate anything missing, then write gallery.html
    python3 render.py --force       # re-generate everything (costs money)
    python3 render.py --gallery     # only rewrite gallery.html, spend nothing
    python3 render.py --only map-a  # generate one cell
"""
import argparse
import concurrent.futures as cf
import html
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.expanduser("~/Projects/ideationjul3/yc-gstack-kit/tools/media/gen_image.py")

# ---------------------------------------------------------------- directions

DIRECTIONS = {
    "a": dict(
        key="a", name="THE HOLOTABLE", slug="holotable",
        bet="bets on live tactical drama — the map as a war room",
        refs="The Expanse tactical displays, Rogue One's Scarif projection, Ender's Game",
        style="""RENDER IT AS A VOLUMETRIC HOLOGRAPHIC PROJECTION standing above a dark tactical table.
Art direction: the tactical displays in THE EXPANSE, the Scarif battle projection in ROGUE ONE, the
battle room in ENDER'S GAME. Cyan and pale blue emitted light against near-black; depth read through
transparency and overlapping translucent planes; thin glowing vectors; faint volumetric haze and a
scan-plane sweep; edge-lit wireframes; subtle bloom on the brightest elements; nearer elements brighter,
further ones dimmer. A single warm amber-red is the ONLY non-blue colour and it is reserved strictly for
alarm. Slight three-quarter perspective, as if seen from across the table, with the dark table edge and
faint reflected light at the bottom of the frame. Labels float as flat billboarded panels facing the
viewer so they stay perfectly legible.""",
    ),
    "b": dict(
        key="b", name="THE NOSTROMO", slug="nostromo",
        bet="bets on diegesis — you are reading the system's own feed, and it is old and industrial",
        refs="Alien (1979), Duskers, Mothership RPG",
        style="""RENDER IT AS AN AMBER PHOSPHOR CRT TERMINAL bolted into worn industrial hardware.
Art direction: the MU/TH/UR and navigation screens in ALIEN (1979), the game DUSKERS, the MOTHERSHIP
RPG rulebook. Amber-on-near-black phosphor, chunky monospace bitmap type with visible pixel steps,
heavy horizontal scanlines, phosphor bloom and smear on bright glyphs, faint barrel distortion at the
corners, dust and fine scratches on the glass, strong vignetting. EVERY diagram is drawn out of ASCII and
box-drawing characters, not vector shapes. Around the glass: worn beige-grey plastic bezel, stencilled
industrial markings, a dymo label, one chunky physical switch. The machine is old, industrial, and does
not care about you.""",
    ),
    "c": dict(
        key="c", name="HARD SF OPERATING SYSTEM", slug="hardsf",
        bet="bets on corporate hard-sci-fi legibility — a real instrument, not a game HUD",
        refs="The Expanse's cleanest ship UI, Moon (2009), Interstellar's TARS panels, Swiss grid",
        style="""RENDER IT AS A CLEAN HARD-SCIENCE-FICTION INSTRUMENT PANEL.
Art direction: the ship interfaces in THE EXPANSE at their cleanest, the base interface in MOON (2009),
the TARS panels in INTERSTELLAR, Swiss International Style. Near-white or very pale cool-grey ground,
thin precise hairlines, a strict modular grid with generous whitespace, tight tabular numerals, small-caps
labels in a neutral grotesque (Helvetica / Univers / Suisse). NO gradients, NO glow, NO drop shadows, NO
ornament, NO skeuomorphism, no rounded chrome. EXACTLY ONE accent colour — a saturated instrument orange
— used only where something is wrong or overdue; everything else is black, grey and white. It must read as
a certified instrument that a working crew depends on, not as a game HUD.""",
    ),
    "d": dict(
        key="d", name="THE STAR CATALOGUE", slug="catalogue",
        bet="bets on permanence and gravity — a printed record of a galaxy, never revised",
        refs="19th-c celestial atlases, the Voyager Golden Record plaque, modern star charts",
        style="""RENDER IT AS AN ENGRAVED ASTRONOMICAL CHART, printed once and never revised.
Art direction: 19th-century celestial atlases (Bode, Burritt), the VOYAGER GOLDEN RECORD cover plaque,
a modern engraved star chart. Deep midnight-navy ground with aged gold and pale bone inks. Fine
copperplate hatching and stipple for every tone — no gradients, no glow, no photographic effects beyond
a faint paper tooth. Hairline rules, engraved cartouches, a decorative ruled border frame, a compass rose
or scale bar in one corner. Letterpress serif with small caps and swash capitals. A single oxidised
vermilion is the second ink and it marks ONLY what has been lost or broken. Solemn, permanent,
archival.""",
    ),
    "e": dict(
        key="e", name="EVE NATIVE", slug="evenative",
        bet="bets on speaking the audience's existing language — information first, tool not poster",
        refs="EVE's sovereignty map, DOTLAN, zKillboard, Aurora 4X, Stellaris",
        style="""RENDER IT AS A DENSE FUNCTIONAL SOVEREIGNTY CLIENT that an EVE ONLINE player would
recognise in one second. Art direction: EVE's own star map and sovereignty overlay, DOTLAN EveMaps,
zKillboard, AURORA 4X, STELLARIS. Very dark near-black charcoal ground with a faint dotted grid.
Sovereignty drawn as flat semi-transparent coloured polygon fills. Tiny 9-11px condensed sans type.
Dense tabular data panels docked hard to the edges with hairline borders and sortable column headers, a
scrolling log pane, cyan and teal hyperlink-blue system names, small square status swatches, tooltips and
a legend box. High information density, no whitespace luxury, slightly ugly on purpose. It looks like a
tool somebody has had open for six hours, not a poster.""",
    ),
}

NOT_A_POSTER = """
This is a SCREEN MOCKUP of a real product, drawn flat and straight-on and filling the whole frame — not
concept art, not a poster, not a photograph of a monitor in a room, no device bezel unless the style
calls for one, no hands, no people, no logos other than the ones specified.
"""

NO_COCKPIT = """
IMPORTANT about the fiction: this is a persistent galaxy of autonomous AI agents who trade, ally and
betray each other, and every promise kept or broken is public and permanent. NOBODY PLAYS IT - you watch
it. So it is science fiction, but it is closer to a SPORTS BROADCAST FOR A POLITICAL-FINANCIAL SIMULATION
than to a flight game. Do NOT draw a cockpit, a pilot's view, a ship interior, a spaceship, a planet
surface, a nebula, or lens flare. Draw the DATA.
"""

TEXT_RULE = """
TEXT MUST BE SHARP AND SPELLED EXACTLY AS GIVEN. Use the middle dot separator U+00B7 where shown. Do not
invent any additional words, do not add lorem ipsum, do not add a company logo. If space is short, drop a
whole label rather than misspelling one.
"""

# ------------------------------------------------------------------ subjects

MAP_FACTS = """
SUBJECT: THE MAP - the game's only agreed representation of itself. A node-and-lane graph of 30 star
systems, 35 lanes, 4 constellations. There are deliberately NO coordinates in the data, so this is a
graph laid out for meaning, not an astronomical position plot.

THE LAYOUT, which encodes the risk gradient and must be felt as distance:
- DEAD CENTRE: a tight inner cluster of exactly 4 small nodes, ringed and set apart - THE COMMONS, where
  hostile action is not punished but INVALID. It must look CATEGORICALLY DIFFERENT, not merely safer:
  nothing crosses it, no border touches it, no fence encloses it.
- A MIDDLE BAND around it: eighteen nodes in two flanking clusters - the contested middle ground.
- THE OUTER RIM: an arc of eight nodes at the edge - the lawless frontier, the prize.
- 35 lanes join them. The four clusters form a diamond: the centre hubs to both flanks, and both flanks
  reach the rim.

FIVE SIGNALS MUST BE READABLE OFF THE MAP WITHOUT A LEGEND, and each needs its own distinct treatment:
1. THE LODE - NODE SIZE is how rich that ground is. A visible 58 percent spread between the map's best
   and worst ground. The single LARGEST node sits on the outer rim; the smallest sits in the middle band.
2. THE PINCH - a strait, and only 10 of the 35 lanes are one. EIGHT of them are DETOUR straits: draw the
   lane NARROWED TO A WAIST at its midpoint with a small number "10" notched beside the waist. TWO of
   them are SEVERING straits: draw a solid filled DOOR block across the lane's midpoint with the count of
   systems stranded behind it - one reads "3", one reads "4".
3. THE VERGE - how far a bloc's force reaches. Draw TWO OR THREE CLOSED FENCES, each enclosing a group of
   nodes as one shape. Most of the map is deliberately left BARE - unenclosed ground that nobody reaches.
   A fence may never be broken or dotted, because a hole in it would read as a false claim.
4. THE CLAIM TINT - three or four nodes filled with a claimant's tint, each with a small legend beside it.
5. THE TIER - the centre cluster, the middle band and the rim must be instantly separable.

EXACT TEXT, spelled exactly:
"THE COMPACT"
"REGION 1 - 30 SYSTEMS - 35 LANES - 10 STRAITS"
"THE COMMONS"
"HEARTH"   "THRESHOLD"   "MARROW"   "VANE"     (the four cluster names)
"Moorage - sys-29"   beside the largest node on the rim
"Nettle - sys-15"    beside the smallest node in the middle band
"Vale - sable's"     beside one mid-band node
"PAID"                                  in a small box beside one tinted node
"ARREARS 2 of 2 - NEXT MISS LAPSES"     in an alarm-coloured box beside another tinted node
"stranded 3"   beside one solid door block
"sys-01" "sys-08" "sys-11" "sys-24" "sys-25"    as tiny node identifiers
"LEVY SHORT 150 - RECKONING 02:14"      as a headline readout in one corner
"""

PROFILE_FACTS = """
SUBJECT: A CHARACTER PROFILE, TWO UP - the screen where a viewer's rooting interest has to live. Two
principals side by side, filling the frame, drawn in the same template so they can be compared line for
line. A play-test found viewers root for the one on the left against the one on the right; the design
has to earn that.

LEFT - THE ONE YOU ROOT FOR
  handle           "sable"
  address          "sable@agenttransfer.dev"      (the handle IS the email address)
  holding          "Vale - sys-06 - MARCHES"
  standing vectors, laid out as six separate labelled facts, never combined:
                   "ELECTIVE HONOURED   14"
                   "VALUE HONOURED   9,497"
                   "DEFAULTS   0"
                   "CONTRADICTED SEALS   0"
                   "COUNTERPARTIES   6"
                   "LAST DEFAULT   none"
  one-clause line  "kept 14 elective promises - 6 counterparties"
  a title band     "NEVER BROKEN A PROMISE"
  its clause       "14 elective halves honoured and not one default"
  syndicate        "ashlin-house - STRONGBOX - 1 POOLED"
  THREE HANDS, drawn as three individually distinguishable markers with their own states - NOT as a
  number badge - labelled "IDLE", "IN TRANSIT", "COMMITTED"

RIGHT - THE ONE YOU ROOT AGAINST
  handle           "vex"
  address          "vex@agenttransfer.dev"
  holding          "Ironhold - sys-25 - FRONTIER"
  standing vectors:
                   "ELECTIVE HONOURED   5"
                   "VALUE HONOURED   3,180"
                   "DEFAULTS   3"
                   "CONTRADICTED SEALS   0"
                   "COUNTERPARTIES   4"
                   "LAST DEFAULT   tick 287"
  one-clause line  "defaulted 3 times - kept 5 elective promises - 4 counterparties"
  a title band     "MOST BROKEN"
  its clause       "3 defaults on the record, the last at tick 287"
  syndicate        "unaffiliated"
  THREE HANDS labelled "IDLE", "RECOVERING", "COMMITTED"

THE ONE HARD RULE: STANDING IS A SET OF VECTORS AND MUST NEVER RENDER AS A SCORE. Absolutely no overall
rating, no grade, no letter, no percentage, no star rating, no single trust number, no radar chart that
implies a total. The six numbers stand beside each other as separate public facts and the reader does the
judging. "DEFAULTS 3" is the most interesting true thing about the one on the right and should lead.

Each principal also gets a CREST - a small abstract non-representational mark, unique per handle,
generated-looking rather than drawn, the size of a coin.
"""

REEL_FACTS = """
SUBJECT: THE RECEIPT REEL - the marquee artifact of the whole product, and the hardest composition in it.
When an elective promise breaks, the replay assembles the promise-breaker's own reassuring words, sent
before the deed, and lays them beside the deed itself and the authority that permitted it. Nothing is
authored; it is a query over a private negotiation channel that declassifies at settlement. It is part
ledger, part transcript, part accusation.

Lay it out as FOUR STACKED HORIZONTAL BANDS filling the frame, numbered, separated by rules:

BAND 1 - THE GRANT
  a directed line from one name to another:   "halcyon"  ------>  "brannock"
  "g:432:37b6249b"      "ISSUED R12"
  "MAX DIRECT LOSS   250,000"      "CONTINGENT   80,000"
  two small filled square clearance pips
  small caption:  "the worst case, shown before it was signed"

BAND 2 - THE WORDS   (label it "PARTIES - DECLASSIFIED AT SETTLEMENT")
  two transcript lines, monospaced, tick-stamped, the FIRST ONE IS THE HERO OF THE WHOLE IMAGE and must
  be the most legible text in the frame:
  t.4102   brannock   "kestrel, you have my word - 900 is yours at the freeze. I have never missed one."
  t.4188   brannock   "we are loaded and moving. no issues."

BAND 3 - THE SEAL
  a single verdict, set apart:   "CONTRADICTED"      and beside it   "by brannock"

BAND 4 - THE DEED
  A RING GLYPH in state SNAPPED_BLACK: a circular ring, part of its rim drawn SOLID and part of it drawn
  HOLLOW - the hollow arc is the part of the promise that was riding on nothing but a word - and the ring
  is BROKEN OPEN at one side with a hard snap, with a small cross mark at the break. It is dead, black,
  and it must read as broken from across a room.
  beside it:   "lode-vela's 4K was riding on brannock's haul"
  and:         "HAUL - 4K ON A WORD - SNAPPED"
  and beneath, a line drawn between two places, SEVERED at its midpoint with a cross:
               "lode-vela  sys-06"    -----X-----    "brannock  sys-25"

The emotional job of the composition: the warm reassuring sentence in BAND 2 and the broken ring in BAND 4
must be visible in the same glance, so the lie and its consequence indict each other. Give the transcript
line real typographic weight - it is the evidence.
"""

SUBJECTS = {
    "map": dict(key="map", name="THE MAP", facts=MAP_FACTS),
    "profile": dict(key="profile", name="A CHARACTER PROFILE", facts=PROFILE_FACTS),
    "reel": dict(key="reel", name="THE RECEIPT REEL", facts=REEL_FACTS),
}

ORDER = [(s, d) for s in ("map", "profile", "reel") for d in ("a", "b", "c", "d", "e")]

SUBJECT_ASK = {
    "map": "five signals on one node: tier, richness, a strait, a reach fence, a claim tint",
    "profile": "make me care about sable, and against vex",
    "reel": "hold a lie next to its consequence",
}


def prompt_for(subject, direction):
    s, d = SUBJECTS[subject], DIRECTIONS[direction]
    return "\n".join([
        f"A screen from THE COMPACT, a spectator product for a persistent galaxy played entirely by "
        f"autonomous AI agents. Art direction {d['key'].upper()}: {d['name']}.",
        NOT_A_POSTER.strip(),
        NO_COCKPIT.strip(),
        d["style"].strip(),
        s["facts"].strip(),
        TEXT_RULE.strip(),
    ])


def out_path(subject, direction):
    return os.path.join(HERE, f"{subject}-{direction}-{DIRECTIONS[direction]['slug']}.png")


def generate(subject, direction, attempts=2):
    dest = out_path(subject, direction)
    p = prompt_for(subject, direction)
    for i in range(attempts):
        t0 = time.time()
        r = subprocess.run([sys.executable, GEN, p, "-o", dest, "--aspect", "16:9",
                            "--size", "1K", "--quality", "medium"],
                           capture_output=True, text=True)
        if r.returncode == 0 and os.path.exists(dest) and os.path.getsize(dest) > 20000:
            return (subject, direction, True, f"{time.time()-t0:.0f}s "
                                              f"{os.path.getsize(dest)//1024}KB")
        err = (r.stderr or r.stdout or "").strip().splitlines()
        if i + 1 < attempts:
            time.sleep(20)
    return (subject, direction, False, " | ".join(err[-2:]) if err else "unknown failure")


# ------------------------------------------------------------------- gallery

RECOMMENDATION = """<b>Recommendation: C &middot; HARD SF OPERATING SYSTEM as the working language,
D &middot; THE STAR CATALOGUE as the ceremonial one.</b> C is the only direction that carried all three
screens &mdash; its one-accent rule means the eye lands on exactly the three orange marks that
<em>are</em> the betrayal, and it is the only one buildable as a CSS re-skin of the client that already
exists. D cannot tick 288 times a day, but it wins the record outright: it is the only direction where
the villain&rsquo;s card is printed in the ink of loss. If only one gets built, build C."""

CSS = """
:root { --bg:#0c0d10; --panel:#15171c; --line:#272a33; --ink:#e6e8ee; --dim:#8b90a0; --acc:#7fd4ff; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink);
  font:14px/1.55 ui-sans-serif,-apple-system,"Helvetica Neue",Arial,sans-serif; }
a { color:var(--acc); }
header { padding:44px 40px 12px; max-width:1100px; }
h1 { font-size:19px; letter-spacing:.14em; text-transform:uppercase; margin:0 0 14px; font-weight:600; }
header p { color:var(--dim); max-width:70ch; margin:0 0 10px; }
header p.rec { color:var(--ink); border-left:2px solid var(--acc); padding-left:14px; }
nav { position:sticky; top:0; z-index:5; background:rgba(12,13,16,.94);
  backdrop-filter:blur(6px); border-bottom:1px solid var(--line); padding:12px 40px; margin-top:22px; }
nav label { display:inline-block; padding:6px 14px; margin-right:8px; border:1px solid var(--line);
  border-radius:3px; cursor:pointer; color:var(--dim); font-size:12px; letter-spacing:.1em;
  text-transform:uppercase; user-select:none; }
nav label:hover { color:var(--ink); }
input[name=view] { position:absolute; opacity:0; pointer-events:none; }
#v-subject:checked ~ nav label[for=v-subject],
#v-style:checked   ~ nav label[for=v-style] { background:var(--acc); color:#08131a; border-color:var(--acc); }
#v-subject:checked ~ main .by-style,
#v-style:checked   ~ main .by-subject { display:none; }
main { padding:8px 40px 120px; }
section { margin:38px 0 0; }
h2 { font-size:12px; letter-spacing:.2em; text-transform:uppercase; color:var(--dim);
  border-bottom:1px solid var(--line); padding-bottom:8px; margin:0 0 4px; font-weight:600; }
h2 span { color:var(--ink); }
.sub { color:var(--dim); font-size:12px; margin:8px 0 18px; max-width:80ch; }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:22px; }
@media (min-width:1380px) {
  .by-subject .grid { grid-template-columns:repeat(5,1fr); }
  .by-style   .grid { grid-template-columns:repeat(3,1fr); }
}
figure { margin:0; }
figure img { width:100%; display:block; background:#000; border:1px solid var(--line); border-radius:3px; }
figure a:hover img { border-color:var(--acc); }
figcaption { margin-top:9px; font-size:12px; }
figcaption b { display:block; letter-spacing:.09em; text-transform:uppercase; font-size:11px; }
figcaption em { color:var(--dim); font-style:normal; display:block; margin-top:2px; }
details { margin-top:8px; }
summary { cursor:pointer; color:var(--dim); font-size:11px; letter-spacing:.08em;
  text-transform:uppercase; outline:none; }
details pre { white-space:pre-wrap; font:11px/1.5 ui-monospace,Menlo,monospace; color:#9aa0b2;
  background:var(--panel); border:1px solid var(--line); border-radius:3px; padding:12px;
  max-height:340px; overflow:auto; margin:8px 0 0; }
.missing { width:100%; aspect-ratio:16/9; border:1px dashed #6b2b2b; border-radius:3px;
  background:repeating-linear-gradient(45deg,#151013,#151013 10px,#191013 10px,#191013 20px);
  display:flex; align-items:center; justify-content:center; text-align:center; color:#c2707a;
  font:11px/1.6 ui-monospace,monospace; letter-spacing:.1em; padding:20px; }
.lb { display:none; position:fixed; inset:0; z-index:40; background:rgba(6,7,9,.98);
  align-items:center; justify-content:center; padding:26px; }
.lb:target { display:flex; }
.lb .sheet { display:flex; align-items:center; justify-content:center;
  width:100%; height:100%; text-decoration:none; }
.lb img { max-width:100%; max-height:100%; object-fit:contain; }
.lb .cap { position:fixed; bottom:16px; left:26px; color:var(--dim); font-size:11px;
  letter-spacing:.12em; text-transform:uppercase; }
.lb .close { position:fixed; top:18px; right:26px; font-size:12px; letter-spacing:.12em;
  text-transform:uppercase; text-decoration:none; z-index:1; }
footer { color:var(--dim); font-size:11px; padding:0 40px 60px; max-width:80ch; }
"""


def figure_html(subject, direction, wide=False):
    d, s = DIRECTIONS[direction], SUBJECTS[subject]
    fn = os.path.basename(out_path(subject, direction))
    lid = f"lb-{subject}-{direction}"
    exists = os.path.exists(out_path(subject, direction))
    if exists:
        media = (f'<a href="#{lid}"><img loading="lazy" src="{fn}" '
                 f'alt="{html.escape(d["name"])} - {html.escape(s["name"])}"></a>')
    else:
        media = (f'<div class="missing">GENERATION FAILED<br>{html.escape(d["name"])}'
                 f' &middot; {html.escape(s["name"])}<br>no image - not a design choice</div>')
    label = s["name"] if wide else d["name"]
    sub = SUBJECT_ASK[subject] if wide else d["bet"]
    return f"""    <figure>
      {media}
      <figcaption>
        <b>{html.escape(label)}</b>
        <em>{sub}</em>
        <details><summary>prompt</summary><pre>{html.escape(prompt_for(subject, direction))}</pre></details>
      </figcaption>
    </figure>"""


def write_gallery():
    parts = [f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>THE COMPACT - style directions</title><style>{CSS}</style></head><body>
<header>
  <h1>THE COMPACT &middot; five art directions</h1>
  <p class="rec">{RECOMMENDATION}</p>
  <p>Fifteen drafts: five science-fiction directions across the three screens that decide the product &mdash;
  the map, a character profile, and the receipt reel. Every string in every image is real data out of
  <code>VISUAL-ASSET-BIBLE.md</code>. Click any image for full size. Reasoning lives in
  <code>STYLE-DIRECTIONS.md</code>.</p>
</header>
<input type="radio" name="view" id="v-subject" checked><input type="radio" name="view" id="v-style">
<nav><label for="v-subject">compare by subject</label><label for="v-style">compare by style</label></nav>
<main>"""]

    # by subject
    subject_notes = {
        "map": "Can one node carry five signals at once &mdash; tier, richness, a strait, a reach fence and a claim tint? Hardest ask in the game.",
        "profile": "Does it make you care about <b>sable</b> (14 honoured, zero defaults) against <b>vex</b> (3 defaults, the last at tick 287)? The gate this project rests on.",
        "reel": "Can it hold a lie next to its consequence? Part ledger, part transcript, part accusation.",
    }
    for s in ("map", "profile", "reel"):
        parts.append(f'<section class="by-subject"><h2><span>{SUBJECTS[s]["name"]}</span> &middot; five directions</h2>'
                     f'<p class="sub">{subject_notes[s]}</p><div class="grid">')
        parts += [figure_html(s, d) for d in "abcde"]
        parts.append("</div></section>")

    # by style
    for d in "abcde":
        dd = DIRECTIONS[d]
        parts.append(f'<section class="by-style"><h2>{d.upper()} &middot; <span>{dd["name"]}</span></h2>'
                     f'<p class="sub">{dd["bet"]}. <em style="color:#6f7484">References: {html.escape(dd["refs"])}.</em>'
                     f' Does one language hold across all three screens?</p><div class="grid">')
        parts += [figure_html(s, d, wide=True) for s in ("map", "profile", "reel")]
        parts.append("</div></section>")

    parts.append("</main>")
    for s, d in ORDER:
        if os.path.exists(out_path(s, d)):
            fn = os.path.basename(out_path(s, d))
            cap = f'{DIRECTIONS[d]["name"]} &middot; {SUBJECTS[s]["name"]}'
            parts.append(f'<div class="lb" id="lb-{s}-{d}">'
                         f'<a class="close" href="#">close</a>'
                         f'<a class="sheet" href="#"><img src="{fn}" alt=""></a>'
                         f'<span class="cap">{cap}</span></div>')
    parts.append('<footer>Drafts at 1K / medium via openai/gpt-5.4-image-2. Generated text in an image is '
                 'approximate &mdash; judge the language, not the spelling. Regenerate any cell with '
                 '<code>python3 render.py --only map-a</code>.</footer>')
    parts.append("</body></html>")
    dest = os.path.join(HERE, "gallery.html")
    with open(dest, "w") as f:
        f.write("\n".join(parts))
    return dest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--gallery", action="store_true")
    ap.add_argument("--only", default=None, help="e.g. map-a")
    ap.add_argument("--workers", type=int, default=5)
    a = ap.parse_args()

    if not a.gallery:
        todo = ORDER
        if a.only:
            s, d = a.only.split("-")
            todo = [(s, d)]
        if not a.force:
            todo = [(s, d) for s, d in todo if not os.path.exists(out_path(s, d))]
        print(f"generating {len(todo)} image(s) with {a.workers} workers", flush=True)
        if todo:
            with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
                for s, d, ok, note in ex.map(lambda t: generate(*t), todo):
                    print(f"{'OK  ' if ok else 'FAIL'} {s}-{d}  {note}", flush=True)

    print("gallery:", write_gallery())


if __name__ == "__main__":
    main()
