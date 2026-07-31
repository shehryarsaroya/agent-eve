#!/usr/bin/env python3
"""Style-direction sweep for THE COMPACT.

Two sweeps live in this file.

SWEEP 1 - five science-fiction art directions x three subjects (the map, a
character profile, THE RECEIPT REEL) = 15 draft images.

SWEEP 2 - the owner picked `profile-e-evenative` out of sweep 1, so six
variants around that one cell: E1 TERMINAL, E2 GLASS, E3 CARTOGRAPHIC,
E4 SINGLE SUBJECT, E5 WARM ANALOG, E6 BROADCAST. Same DNA - a split dual
dossier, a live operations console, a per-principal territory voronoi -
different bets on what the aesthetic actually is.

    ★ Sweep 2's prompts carry CANON_LOCK. Sweep 1's E direction imported EVE's
    ONTOLOGY along with its look - Rorqual, Fortizar, ISK, entosis link, Kador,
    and a KILLBOARD beside the receipt reel - none of which anything asked for.
    SPEC.md §3 is a rules surface, so the ban is explicit and the real nouns,
    handles and place names are supplied in full.

All prompt text is real data out of docs/design/graphics-2026-07-30/VISUAL-ASSET-BIBLE.md
(§6.4 for the map, §11 for the two principals).

    python3 render.py               # generate anything missing, then write gallery.html
    python3 render.py --force       # re-generate everything (costs money)
    python3 render.py --gallery     # only rewrite gallery.html, spend nothing
    python3 render.py --only map-a  # generate one sweep-1 cell
    python3 render.py --only e3     # generate one sweep-2 variant
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


# ============================================================ SWEEP 2: PROFILE E VARIANTS
#
# The owner picked profile-e-evenative. What works in it: a split dual dossier
# colour-coded cyan/red before you read a word, a live operations console rather
# than a static page, and a per-principal territory voronoi tinted by relationship.
# What is wrong with it: it is a canon hazard. It shipped KADOR - a real EVE region -
# and invented region names, and its siblings shipped Rorqual, Fortizar, ISK,
# entosis link and a KILLBOARD. Hence CANON_LOCK, which every variant carries.

CANON_LOCK = """
★ VOCABULARY IS A HARD RULE HERE AND IT OVERRIDES THE ART DIRECTION. This world is NOT EVE Online and
may not borrow one word of its ontology, even where the visual language is adjacent to it.

ABSOLUTELY FORBIDDEN - do not write any of these anywhere in the image, in any panel, tab, column header,
legend, tooltip, badge or log line:
Rorqual, Fortizar, Astrahus, Raitaru, Azbel, Keepstar, Titan, Capsuleer, Pilot, Pilots, Corporation, Corp,
Alliance, Coalition, ISK, entosis, cyno, jump bridge, jump gate, ADM, Sovereignty, Sov, Sovereignty Hub,
Outpost, Station, Docked, Undocked, Wormhole, Kador, Delve, Jita, Amarr, Caldari, Gallente, Minmatar,
Concord, Empire, Faction, Security Status, Sec Status, Loyalty Points, Local, Intel, Fleet, Warp,
Freighter, Mining Barge, Killboard, Killmail, Kills, Top Kills, Ships Destroyed, Losses, Efficiency.

THERE IS NO KILLBOARD AND NO COMBAT SCOREBOARD OF ANY KIND. Nothing in this image is killed, destroyed or
shot down; there are no ships in it at all. The only scoreboard this world has is PROMISES KEPT AND
PROMISES BROKEN, and the only bad outcome that appears anywhere is a DEFAULT.

DO NOT INVENT ANY WORDS. No invented place names, transaction types, statistics, tabs, structures,
currencies or handles. Every string in the image must come from the lists below. If you run short of room,
repeat a real row or drop a whole panel - never fill space with an invented word.
"""

CANON_NOUNS = """
THE ONLY NOUNS THAT EXIST IN THIS WORLD:
PRINCIPAL - an identity; the player. Never a person, never a pilot, never a corporation
HANDLE - a principal's name, which is literally its email address at agenttransfer.dev
HOLDING - a principal's one named body on the map    STORES - its assets, never its body
HAND - one unit of physical presence; every principal has exactly three and never more
WORKS - the production structure    ANCHOR - what a CLAIM is built from, and what burns FUEL
CLAIM - a sovereign hold on exactly one system    VENTURE - a joint act between principals
COMPACT - the signed terms of a split    GRANT - a scoped, expiring authority
DOSSIER - a signed, dated extract of private figures handed to one named principal
SEAL - a pre-committed intention, revealed one RECKONING later
STANDING - the public factual vectors, and never a score
THE LEVY - the scheduled world obligation    THE RECKONING - the daily settlement
TRIBUTE - what is paid toward the LEVY    CHARGE - what a CLAIM owes each RECKONING
SYNDICATE - the only organisation container that exists
CONSTELLATION - a group of systems    STRAIT - a lane the region cannot cheaply route around
LODE - one system's richness    VERGE - how far a bloc's force reaches    RUIN - what is left
The three tiers, running outward from the centre: COMMONS, MARCHES, FRONTIER

THE FOUR GOODS, and there are no others: ore - ration - alloy - fuel
THE CURRENCY IS CALLED "minor". Write it as a plain grouped integer - "9,497" or "9,497 minor".
Never ISK, never credits, never a currency symbol, never a B or M or K suffix on any value.

THE ONLY HANDLES THAT EXIST - all lower case, no others may appear:
sable - vex - halcyon - brannock - thessaly - kestrel - ashlin - wren - orrin - dunmore - corvid - bram

THE ONLY PLACE NAMES THAT EXIST - no others may appear, and every one is paired with its sys id:
COMMONS:   Salt Ward sys-01 - Low Ferry sys-02 - Candle sys-03 - Tallow sys-04
MARCHES:   Orison sys-05 - Vale sys-06 - Bright Ash sys-07 - Gallow Green sys-13 - Nettle sys-15 -
           Wither sys-16 - Mirefall sys-18 - Ashen Ford sys-20 - Copper Wick sys-21
FRONTIER:  Grist sys-23 - Halyard sys-24 - Ironhold sys-25 - Jetsam sys-26 - Keelrow sys-27 -
           Lantern sys-28 - Moorage sys-29 - Nightjar sys-30
The four CONSTELLATIONS: Hearth - Threshold - Marrow - Vane
"""

DOSSIER_HEAD = """
SUBJECT: THE DOSSIER - a LIVE OPERATIONS CONSOLE, not a static profile page. Two PRINCIPALS side by side
in the identical template so a stranger can compare them line for line. This is the screen a viewer's
rooting interest has to live on: a play-test found viewers root for the one on the LEFT against the one
on the RIGHT, and the colour coding must make that legible before a single word is read.
★ THE LEFT HALF IS CYAN. THE RIGHT HALF IS RED. A hairline seam divides them down the centre.

A THIN APPLICATION HEADER runs across the top of each half with a tab bar - exactly these tabs, no others:
  "OVERVIEW"   "PRINCIPALS"   "VENTURES"   "LEDGER"   "MAP"   "RECKONING"   "DOSSIERS"
with "PRINCIPALS" the active tab, and a readout at the right: "TICK 295 - RECKONING 12 - LEVY IN 02:14"
"""

DOSSIER_SABLE = """
====================  LEFT HALF - sable - CYAN - THE ONE YOU ROOT FOR  ====================

IDENTITY BLOCK with a CREST - a small abstract, non-representational, generated-looking mark the size of
a coin, unique to this handle: a clean radial many-pointed figure, cyan.
  handle     "sable"
  address    "sable@agenttransfer.dev"
  HOLDING    "Vale - sys-06 - MARCHES"
  SYNDICATE  "ashlin-house - STRONGBOX - 1 POOLED"

"STANDING VECTORS" - six separate labelled facts, never combined and never totalled:
  "ELECTIVE HONOURED   14"    "VALUE HONOURED   9,497"    "DEFAULTS   0"
  "CONTRADICTED SEALS   0"    "COUNTERPARTIES   6"        "LAST DEFAULT   none"
one clause beneath:  "kept 14 elective promises - 6 counterparties"

"HANDS" - THREE individually distinguishable markers with their own states, NOT a number badge,
labelled "IDLE", "IN TRANSIT", "COMMITTED"

A TITLE BAND, the strongest element in this half:
  "NEVER BROKEN A PROMISE"   and beneath it   "14 elective halves honoured and not one default"

"COUNTERPARTIES (6)" - columns "HANDLE", "STANDING", "LAST ACT":
  halcyon   SYNDICATE   t.295        brannock  SYNDICATE   t.293
  thessaly  SYNDICATE   t.291        kestrel   NEUTRAL     t.290
  ashlin    SYNDICATE   t.288        wren      NEUTRAL     t.285

"VENTURES (14)" - columns "KIND", "STATE", "COUNT":
  HAUL   SETTLED  9      HAUL      LIVE      2      ELECTIVE  HONOURED  14
  ESCROWED  HONOURED  14      COMPACT  SIGNED  6      SEAL  KEPT  3

"VALUE FLOW - LAST 30 TICKS" - columns "DIRECTION", "COUNT", "VALUE":
  in  18  9,497        out  12  7,214        net  +6  +2,283

"EVENT LOG - sable" - a scrolling monospaced pane, columns "TICK", "TYPE", "PARTY", "DETAIL":
  295  VENTURE CREATED     halcyon   HAUL - 1,200 ore - due t.320
  293  ELECTIVE HONOURED   brannock  delivered 900 ration - ahead of schedule
  291  COUNTERSIGNED       thessaly  both roles filled - compact signed
  290  SETTLED             kestrel   escrowed half released
  288  DOSSIER HANDED      ashlin    STORES compartment - signed extract
  287  GRANT ISSUED        wren      max direct loss 250 - clearance STORES
  285  ELECTIVE HONOURED   halcyon   750 minor - paid at settlement
  284  HAUL ARRIVED        brannock  Vale sys-06 - 600 ore
  283  SEAL DECLARED       thessaly  reveals next RECKONING
  281  TRIBUTE PAID        -         THE LEVY - 480 ration

"STORES" - five horizontal bars with their values, and fuel is genuinely zero because fuel exists only
on the FRONTIER and sable holds in the MARCHES:
  ore 5,043      ration 1,920      alloy 812      fuel 0      minor 4,180
"""

DOSSIER_VEX = """
====================  RIGHT HALF - vex - RED - THE ONE YOU ROOT AGAINST  ====================

IDENTITY BLOCK with a CREST - a different abstract generated mark, same size: a broken concentric burst
with one arc missing, red.
  handle     "vex"
  address    "vex@agenttransfer.dev"
  HOLDING    "Ironhold - sys-25 - FRONTIER"
  SYNDICATE  "unaffiliated"

"STANDING VECTORS":
  "ELECTIVE HONOURED   5"     "VALUE HONOURED   3,180"    "DEFAULTS   3"
  "CONTRADICTED SEALS   0"    "COUNTERPARTIES   4"        "LAST DEFAULT   tick 287"
★ "DEFAULTS 3" is the most interesting true thing about this principal and must be the row the eye lands
on. It gets the alarm colour and no other vector row does.
one clause beneath:  "defaulted 3 times - kept 5 elective promises - 4 counterparties"

"HANDS" - three markers labelled "IDLE", "RECOVERING", "COMMITTED"

A TITLE BAND:
  "MOST BROKEN"   and beneath it   "3 defaults on the record, the last at tick 287"

"COUNTERPARTIES (4)" - columns "HANDLE", "STANDING", "LAST ACT":
  orrin    HOSTILE  t.290        dunmore  HOSTILE  t.294
  corvid   NEUTRAL  t.292        bram     NEUTRAL  t.287

"VENTURES (11)" - columns "KIND", "STATE", "COUNT":
  HAUL  SETTLED  6      HAUL  LIVE  1      ELECTIVE  HONOURED  5
  ELECTIVE  DEFAULTED  3   <- this row in the alarm colour
  ESCROWED  HONOURED  8      COMPACT  SIGNED  4

"VALUE FLOW - LAST 30 TICKS":
  in  9  3,180        out  15  6,940        net  -6  -3,760

"EVENT LOG - vex" - same columns:
  294  DEFAULT             dunmore   failed to deliver 700 ration - elective half
  292  ELECTIVE HONOURED   corvid    delivered 400 ore - partial settlement
  290  DEFAULT             orrin     non-delivery at settlement - 900 minor
  287  DEFAULT             bram      failed to deliver 600 ration - deadline missed
  285  VENTURE CREATED     corvid    HAUL - 500 ore - due t.312
  283  ANCHOR BURNED       -         Ironhold sys-25 - 10 fuel
  281  TRIBUTE SHORT       -         THE LEVY - 150 short
  279  COUNTERSIGNED       dunmore   compact signed
  276  CHARGE PAID         -         CLAIM Ironhold - 220 ration
  274  SETTLED             corvid    escrowed half released - elective refused
★ the three DEFAULT rows are the story of this half and are the only saturated red text in the log.

"STORES" - five bars, and vex has fuel because it holds on the FRONTIER:
  ore 1,420      ration 980      alloy 420      fuel 260      minor 1,180
"""

DOSSIER_RULE = """
★ THE ONE HARD RULE OF THIS SCREEN: STANDING IS A SET OF VECTORS AND MUST NEVER RENDER AS A SCORE.
No overall rating, no grade, no letter, no percentage, no single trust number, no star rating, no gauge,
no progress bar toward a total, and no radar chart that implies one. The six numbers stand beside each
other as separate public facts and the reader does the judging. The design never editorialises; the
numbers do.
"""

TERRITORY_HEAD = """
★ THE PER-PRINCIPAL TERRITORY MAP - each principal carries its own, and it is the best idea on this
screen. A VORONOI DIAGRAM: irregular polygon cells packed edge to edge with no gaps, one cell per system,
each cell FLAT-TINTED by that system's relationship to THIS principal, with the system's name and sys id
set inside the cell and a faint dot at the cell's seed. Cells are separated by hairlines. Thin lane lines
run between the seeds over the tints.

THE TINT LEGEND, drawn once - exactly these five, plus the COMMONS:
  "HELD"       this principal's own HOLDING and CLAIMS - the strongest tint of its own colour
  "SYNDICATE"  systems held by fellow syndicate members
  "NEUTRAL"    held by someone it has no relationship with - the dimmest, greyest tint
  "HOSTILE"    held by a principal it has defaulted with, or that has defaulted on it
  "CONTESTED"  a system two principals both claim - the alarm colour
  "COMMONS - HOSTILE ACTION INVALID" - the four central cells, drawn CATEGORICALLY DIFFERENTLY from
     everything else. Not a sixth tint but visibly outside the contest entirely: no border touches them,
     nothing crosses them, no fence encloses them, and they carry no claimant marking at all.

Two further marks on each map, both small: a NARROW WAIST pinched into one lane at its midpoint with "10"
notched beside it - that is a STRAIT with a detour of ten lanes - and ONE CLOSED, UNBROKEN fence line
around the group of cells this principal's force reaches, which is its VERGE. A VERGE fence may never be
dotted or broken, because a hole in it would read as a false claim.
"""

TERRITORY_SABLE = """
sable's MAP - centred on its HOLDING in the MARCHES, close in to the COMMONS:
  HELD: Vale sys-06.   SYNDICATE: Orison sys-05, Bright Ash sys-07, Ashen Ford sys-20.
  NEUTRAL: Gallow Green sys-13, Nettle sys-15, Mirefall sys-18, Copper Wick sys-21.
  CONTESTED: Wither sys-16.
  COMMONS, at the centre: Salt Ward sys-01, Low Ferry sys-02, Candle sys-03, Tallow sys-04.
  Constellation names set large and very faint behind the cells: "HEARTH" and "THRESHOLD".
"""

TERRITORY_VEX = """
vex's MAP - centred on its HOLDING far out on the FRONTIER, a long way from the COMMONS:
  HELD: Ironhold sys-25.   SYNDICATE: none at all - vex is unaffiliated, so no cell carries that tint
  and its legend row reads as empty.
  HOSTILE: Halyard sys-24, Moorage sys-29, Jetsam sys-26.
  NEUTRAL: Grist sys-23, Keelrow sys-27, Lantern sys-28, Nightjar sys-30.
  CONTESTED: Wither sys-16.
  The COMMONS appears only as a small far-off cluster at the very edge of the frame, and that distance is
  the point: vex is a long way from safety.
  Constellation names behind the cells: "VANE" and "MARROW".
"""

VARIANTS = {
    "e1": dict(
        key="e1", name="TERMINAL", slug="terminal",
        bet="bets that density IS the aesthetic - a professional terminal, not a game UI",
        refs="a Bloomberg Terminal, Refinitiv Eikon, a Level-2 order book, htop",
        style="""RENDER IT AS A PROFESSIONAL FINANCIAL TRADING TERMINAL.
Art direction: a BLOOMBERG TERMINAL, Refinitiv Eikon, a Level-2 equity order book, htop.
EVERY SINGLE GLYPH IS MONOSPACE - labels, headings, numbers, the title bands, all of it. Pure black
ground. NO rounded corners anywhere; radius zero on every rectangle. NO gradients, NO glow, NO bloom, NO
drop shadows, NO translucency, NO icons, NO chrome of any kind. Panels are separated by single-pixel
hairline rules only, never by filled cards. Rows are TIGHT - the vertical rhythm compressed as far as
legibility permits, tabular figures right-aligned, columns ruled, small sort carets on header cells.
Colour is purely functional: amber for headings and keys, white for values, CYAN for everything belonging
to sable, RED for everything belonging to vex, and one saturated red-orange reserved strictly for a
default. A thin function-key strip runs along the very bottom in reverse video reading
"F1 OVERVIEW   F2 PRINCIPALS   F3 VENTURES   F4 LEDGER   F5 MAP   F8 RECKONING".
Fill the frame edge to edge - no margins, no padding, no whitespace luxury, no breathing room. It should
look like the most information anyone has ever put on one screen, and still be readable.""",
        parts=("head", "sable", "vex", "rule", "map_head", "map_sable", "map_vex"),
    ),
    "e2": dict(
        key="e2", name="GLASS", slug="glass",
        bet="bets that it should feel expensive - the same instrument, rendered in glass and light",
        refs="The Expanse's Rocinante displays, Oblivion (2013), visionOS material, Blade Runner 2049",
        style="""RENDER IT WITH GLASSY OPTICAL DEPTH, AS IF EVERY PANEL WERE A FLOATING SHEET OF LIT GLASS.
Art direction: the Rocinante's displays in THE EXPANSE, the interfaces in OBLIVION (2013), Apple visionOS
material, the holographic surfaces in BLADE RUNNER 2049. Near-black ground with a very faint cool
gradient. Each panel is a subtly TRANSLUCENT plate over a soft blur, with a 1px bright hairline border
catching light along its top and left edges and a long soft shadow beneath, so panels visibly float at
slightly different depths and overlap a little. Soft CYAN BLOOM on the brightest text and rules of the
left half; a matching deep crimson bloom on the right. Thin bright rules, a refined light-weight sans for
labels, a precise tabular numeric face for figures, spacing generous but never wasteful. A faint film
grain and a barely-there chromatic edge on the brightest strokes.
It must feel like expensive hardware in a dark room - restrained, cool, slightly luminous. NO
skeuomorphism, no bevels, no plastic, no lens flare, no sci-fi ornament. And the glass may never cost
legibility: every number stays crisp and every hairline stays a hairline.""",
        parts=("head", "sable", "vex", "rule", "map_head", "map_sable", "map_vex"),
    ),
    "e3": dict(
        key="e3", name="CARTOGRAPHIC", slug="cartographic",
        bet="bets that the map is the character - a principal's territory IS its story",
        refs="a nautical chart, a geopolitical atlas plate, election-night cartograms, Voronoi tessellation",
        style="""RENDER IT AS A CARTOGRAPHIC INSTRUMENT IN WHICH THE TWO TERRITORY MAPS DOMINATE THE FRAME.
★ LAYOUT OVERRIDE, and it is the entire point of this variant: THE TWO VORONOI TERRITORY MAPS OCCUPY
ROUGHLY SEVENTY PERCENT OF THE IMAGE - one large map per principal, side by side, each running nearly the
full height of its half. Every table is DEMOTED to a narrow vertical rail down the outer edge of each
half, set small and quiet, with the event log the only one given any width. The identity block, the six
standing vectors and the title band sit as a compact CARTOUCHE in one corner of each map, laid over the
cells.
Art direction: a nautical chart, a geopolitical atlas plate, an election-night cartogram. Near-black
ground. The cells are the hero: large, flat-tinted, hairline-separated, each carrying a legible system
name with its sys id beneath and its tier smaller again. Constellation names set LARGE and very faint
behind the cells the way an ocean is labelled on a chart. Fine graticule ticks around the map edge, a
small scale bar, a legend box in a corner. Cyan family for sable's half, red family for vex's, one hot
alarm colour reserved for CONTESTED and for a default. The maps must be the first thing you look at and
the last thing you leave.""",
        parts=("head", "map_head", "map_sable", "map_vex", "sable", "vex", "rule"),
    ),
    "e4": dict(
        key="e4", name="SINGLE SUBJECT", slug="single",
        bet="bets that intimacy beats comparison - one villain, full frame, nowhere to hide",
        refs="a full-bleed athlete profile, a case file, a single-instrument monitoring console",
        style="""RENDER IT AS ONE PRINCIPAL'S DOSSIER FILLING THE ENTIRE FRAME.
★ LAYOUT OVERRIDE: THIS IS A SINGLE-SUBJECT SCREEN. There is NO split and NO second principal anywhere in
it. Draw ONLY vex, in red, and give every element the room the two-up version could not.
Art direction: a full-bleed sports profile page, a case file, a single-instrument monitoring console.
Near-black ground with a deep desaturated crimson cast that deepens toward the frame edges. A generous
three-column grid. The crest is LARGE - a hand's width, not a coin. The handle "vex" is set enormous at
the top left. "DEFAULTS 3" is the second largest thing in the frame. The six standing vectors get a full
band to themselves, each figure large with its label small above it. The event log runs the full width
with comfortable row height so all ten lines read easily, and its three DEFAULT rows are the only
saturated red in the image. The territory map is large, on the right, and must show how far Ironhold
sits from the COMMONS. Restrained everywhere else: hairlines, no glow, no ornament, no badges.
It should read as an indictment assembled entirely from public records - never as a villain poster.""",
        parts=("head", "vex", "rule", "map_head", "map_vex"),
    ),
    "e5": dict(
        key="e5", name="WARM ANALOG", slug="analog",
        bet="bets that warmth reads as RECORD rather than dashboard - same density, different light",
        refs="amber phosphor CRT, a bound ledger, a Teletype printout, a warm 1970s control room",
        style="""RENDER IT IN WARM AMBER AND BONE ON DARK BROWN, WITH THE GENTLEST CRT CURVATURE.
★ Keep the density and the layout of a live operations console EXACTLY - this variant changes the light,
not the structure. Every panel, table, log and map stays where it was and keeps every row.
Art direction: an amber phosphor CRT, a bound ledger book, a Teletype printout, a warm 1970s control
room. The ground is a deep warm brown-black, never neutral black. Type is amber and bone-white with a
faint phosphor bloom and a soft warm halo on the brightest glyphs. Rules and table borders are a dim warm
ochre. A FAINT barrel curvature bends the frame's straight lines just perceptibly toward the corners,
with light vignetting and a whisper of scanline texture - present, but never enough to cost a number its
legibility.
The colour coding survives the palette change and is the one thing that is not warm: sable's half is
keyed by PALE BONE and a cool desaturated ivory, vex's half by a hot rust-orange, and a single saturated
blood-red is reserved strictly for a DEFAULT and appears nowhere else in the frame. The territory maps
are tinted in washes of amber, ochre and umber. It should feel like a record being kept rather than a
dashboard being watched.""",
        parts=("head", "sable", "vex", "rule", "map_head", "map_sable", "map_vex"),
    ),
    "e6": dict(
        key="e6", name="BROADCAST", slug="broadcast",
        bet="bets a spectator needs a third less information at twice the size",
        refs="F1 timing graphics, a Premier League match-centre, an election-night network board",
        style="""RENDER IT AS A LIVE BROADCAST GRAPHIC, STAGED FOR A VIEWER RATHER THAN AN OPERATOR.
★ LAYOUT OVERRIDE: KEEP THE SPLIT AND THE COLOUR CODING, BUT CUT THE INFORMATION BY A THIRD AND DOUBLE
THE SIZE OF WHAT REMAINS. DROP the ventures table, DROP the value-flow table, DROP the stores bars and
DROP the counterparties table entirely - they are not in this image. What survives, at broadcast scale:
the crest, the handle, the holding, the six standing vectors, the three hands, the territory map, and
only the top SIX event log rows for each principal.
★ THE STANDING VERDICT IS THE HERO ELEMENT. "NEVER BROKEN A PROMISE" on the left and "MOST BROKEN" on the
right are the largest type in the frame after the two handles, each set in a full-width band across its
half with its clause beneath at comfortably readable size.
★ AN F1-STYLE LOWER THIRD spans the whole bottom of the frame across both halves: a solid dark strip with
a bright accent edge, carrying in large broadcast type "sable   14 KEPT   0 DEFAULTS" and
"vex   5 KEPT   3 DEFAULTS" and, at the right, "RECKONING 12 - SETTLEMENT IN 02:14".
Art direction: Formula 1 timing graphics, a Premier League match-centre, an election-night network board.
Confident flat colour blocks, strong horizontal bands, one heavy geometric sans, very large tabular
numerals, generous padding, high contrast, a slight forward lean on the accent shapes. No hairline
tables, no dense monospace, no scrolling panes. It must be legible from across a room on a television and
readable in three seconds by someone who has never seen it before.""",
        parts=("head", "sable", "vex", "rule", "map_head", "map_sable", "map_vex"),
    ),
}

VARIANT_ORDER = ["e1", "e2", "e3", "e4", "e5", "e6"]

VARIANT_PARTS = {
    "head": DOSSIER_HEAD, "sable": DOSSIER_SABLE, "vex": DOSSIER_VEX, "rule": DOSSIER_RULE,
    "map_head": TERRITORY_HEAD, "map_sable": TERRITORY_SABLE, "map_vex": TERRITORY_VEX,
}


def variant_prompt_for(vid):
    """Content first, art direction LAST.

    These prompts run ~3.4x the length of sweep 1's because of the canon lock and
    the full data payload, so the style block goes at the end where it stays
    freshest, with a one-line closer after it.
    """
    v = VARIANTS[vid]
    return "\n".join([
        f"A screen from THE COMPACT, a spectator product for a persistent galaxy played entirely by "
        f"autonomous AI agents. Variant {v['key'].upper()}: {v['name']}.",
        NOT_A_POSTER.strip(),
        NO_COCKPIT.strip(),
        CANON_LOCK.strip(),
        CANON_NOUNS.strip(),
        "\n".join(VARIANT_PARTS[p].strip() for p in v["parts"]),
        TEXT_RULE.strip(),
        "★ THE ART DIRECTION, which governs every pixel above:",
        v["style"].strip(),
        f"To restate it in one line: this is variant {v['key'].upper()}, {v['name']} - it "
        f"{v['bet']}. Nothing in the frame may carry a word this world does not own.",
    ])


def variant_out_path(vid):
    return os.path.join(HERE, f"profile-{vid}-{VARIANTS[vid]['slug']}.png")


def _gen(dest, p, attempts=2):
    err = []
    for i in range(attempts):
        t0 = time.time()
        r = subprocess.run([sys.executable, GEN, p, "-o", dest, "--aspect", "16:9",
                            "--size", "1K", "--quality", "medium"],
                           capture_output=True, text=True)
        if r.returncode == 0 and os.path.exists(dest) and os.path.getsize(dest) > 20000:
            return (True, f"{time.time()-t0:.0f}s {os.path.getsize(dest)//1024}KB")
        err = (r.stderr or r.stdout or "").strip().splitlines()
        if i + 1 < attempts:
            time.sleep(20)
    return (False, " | ".join(err[-2:]) if err else "unknown failure")


def run_job(job):
    """job is ("s", subject, direction) or ("v", variant_id, None)."""
    kind, a, b = job
    if kind == "s":
        ok, note = _gen(out_path(a, b), prompt_for(a, b))
        return (f"{a}-{b}", ok, note)
    ok, note = _gen(variant_out_path(a), variant_prompt_for(a))
    return (a, ok, note)


def job_path(job):
    kind, a, b = job
    return out_path(a, b) if kind == "s" else variant_out_path(a)


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
  .variants   .grid { grid-template-columns:repeat(3,1fr); }
}
section.variants { margin-top:30px; }
section.variants h2 { color:var(--acc); border-bottom-color:var(--acc); }
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


def variant_figure_html(vid):
    v = VARIANTS[vid]
    fn = os.path.basename(variant_out_path(vid))
    lid = f"lb-{vid}"
    if os.path.exists(variant_out_path(vid)):
        media = (f'<a href="#{lid}"><img loading="lazy" src="{fn}" '
                 f'alt="{html.escape(v["name"])}"></a>')
    else:
        media = (f'<div class="missing">GENERATION FAILED<br>{html.escape(v["name"])}'
                 f'<br>no image - not a design choice</div>')
    return f"""    <figure>
      {media}
      <figcaption>
        <b>{v["key"].upper()} &middot; {html.escape(v["name"])}</b>
        <em>{html.escape(v["bet"])}</em>
        <details><summary>prompt</summary><pre>{html.escape(variant_prompt_for(vid))}</pre></details>
      </figcaption>
    </figure>"""


VARIANT_INTRO = """<b>Six variants on <code>profile-e-evenative</code>, the one the owner picked.</b>
Same DNA every time &mdash; a split dual dossier colour-coded <span style="color:#7fd4ff">cyan</span> for
<code>sable</code> against <span style="color:#e0555f">red</span> for <code>vex</code>, a live operations
console rather than a static page, and a per-principal territory voronoi tinted by relationship. Six
different bets on what the aesthetic actually <em>is</em>."""

VARIANT_CANON_NOTE = """&#9733; <b>Every prompt in this section carries a canon lock.</b> The parent
direction was a vocabulary hazard: unprompted, it produced <code>Rorqual</code>, <code>Fortizar</code>,
<code>Astrahus</code>, <code>ISK</code>, <code>entosis link</code>, <code>ADM RATE</code> and
<code>Kador</code> &mdash; a real EVE region &mdash; and put a <code>KILLBOARD</code> beside the receipt
reel. <code>SPEC.md</code> &sect;3 is a rules surface, so these prompts name ~45 banned words explicitly and
supply the real ones: the twelve house handles, the twenty real place names out of bible &sect;6.4, the four
goods, and <code>minor</code> as the currency. The scoreboard is promises kept and broken; there is no
killboard."""


def write_gallery():
    parts = [f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>THE COMPACT - style directions</title><style>{CSS}</style></head><body>
<header>
  <h1>THE COMPACT &middot; art directions</h1>
  <p class="rec">{VARIANT_INTRO}</p>
  <p>Six variants on the chosen direction, then the original fifteen drafts below them &mdash; five
  science-fiction directions across the three screens that decide the product: the map, a character
  profile, and the receipt reel. Every string in every image is real data out of
  <code>VISUAL-ASSET-BIBLE.md</code>. Click any image for full size. Reasoning lives in
  <code>STYLE-DIRECTIONS.md</code>.</p>
  <p class="rec" style="border-left-color:#c9a227">{VARIANT_CANON_NOTE}</p>
</header>
<input type="radio" name="view" id="v-subject" checked><input type="radio" name="view" id="v-style">
<nav><label for="v-subject">compare by subject</label><label for="v-style">compare by style</label></nav>
<main>
<section class="variants"><h2><span>THE DOSSIER</span> &middot; six variants on the chosen direction</h2>
<p class="sub">Does one of these make you care about <b>sable</b> (14 honoured, zero defaults) against
<b>vex</b> (3 defaults, the last at tick 287)? <b>E3</b> and <b>E4</b> and <b>E6</b> change the layout on
purpose; <b>E1</b>, <b>E2</b> and <b>E5</b> hold the layout and change only the light.</p>
<div class="grid">"""]
    parts += [variant_figure_html(v) for v in VARIANT_ORDER]
    parts.append("</div></section>")
    parts.append('<section class="variants"><h2>the original fifteen</h2>'
                 f'<p class="sub">{RECOMMENDATION}</p></section>')

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
    for vid in VARIANT_ORDER:
        if os.path.exists(variant_out_path(vid)):
            fn = os.path.basename(variant_out_path(vid))
            cap = f'{vid.upper()} &middot; {VARIANTS[vid]["name"]} &middot; THE DOSSIER'
            parts.append(f'<div class="lb" id="lb-{vid}">'
                         f'<a class="close" href="#">close</a>'
                         f'<a class="sheet" href="#"><img src="{fn}" alt=""></a>'
                         f'<span class="cap">{cap}</span></div>')
    for s, d in ORDER:
        if os.path.exists(out_path(s, d)):
            fn = os.path.basename(out_path(s, d))
            cap = f'{DIRECTIONS[d]["name"]} &middot; {SUBJECTS[s]["name"]}'
            parts.append(f'<div class="lb" id="lb-{s}-{d}">'
                         f'<a class="close" href="#">close</a>'
                         f'<a class="sheet" href="#"><img src="{fn}" alt=""></a>'
                         f'<span class="cap">{cap}</span></div>')
    parts.append('<footer>Drafts at 1K / medium via openai/gpt-5.4-image-2. Generated text in an image is '
                 'approximate &mdash; judge the language, not the spelling, but <em>do</em> read every '
                 'string for a word this world does not own. Regenerate any cell with '
                 '<code>python3 render.py --only map-a</code> or '
                 '<code>python3 render.py --only e3</code>.</footer>')
    parts.append("</body></html>")
    dest = os.path.join(HERE, "gallery.html")
    with open(dest, "w") as f:
        f.write("\n".join(parts))
    return dest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--gallery", action="store_true")
    ap.add_argument("--only", default=None,
                    help="a sweep-1 cell (map-a, profile-e) or a sweep-2 variant (e3, profile-e3)")
    ap.add_argument("--variants", action="store_true", help="restrict to the six profile-E variants")
    ap.add_argument("--workers", type=int, default=5)
    a = ap.parse_args()

    if not a.gallery:
        todo = [("v", v, None) for v in VARIANT_ORDER]
        if not a.variants:
            todo = [("s", s, d) for s, d in ORDER] + todo
        if a.only:
            key = a.only[len("profile-"):] if a.only.startswith("profile-e") \
                and a.only[len("profile-"):] in VARIANTS else a.only
            if key in VARIANTS:
                todo = [("v", key, None)]
            else:
                s, d = key.split("-")
                todo = [("s", s, d)]
        if not a.force:
            todo = [j for j in todo if not os.path.exists(job_path(j))]
        print(f"generating {len(todo)} image(s) with {a.workers} workers", flush=True)
        if todo:
            with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
                for name, ok, note in ex.map(run_job, todo):
                    print(f"{'OK  ' if ok else 'FAIL'} {name}  {note}", flush=True)

    print("gallery:", write_gallery())


if __name__ == "__main__":
    main()
