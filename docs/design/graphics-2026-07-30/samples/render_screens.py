#!/usr/bin/env python3
"""THE COMPACT - the twelve-screen series, EVE's visual language in our words.

Extends render.py: it reuses that script's EVE-NATIVE style block (direction E, the one that
won), its framing rules, its generate/gallery machinery and its CSS. It does NOT edit render.py,
because a second agent owns that file and gallery.html this session (CLAUDE.md HARD RULE 7 -
parallel writers must never share an output file). Everything here writes `screen-*.png` and
`gallery-screens.html` only.

Twelve screens, each mapping one EVE window onto one of ours. Every string is real data out of
docs/design/graphics-2026-07-30/VISUAL-ASSET-BIBLE.md.

    python3 render_screens.py                     # generate anything missing, then write the gallery
    python3 render_screens.py --force             # re-generate everything (costs money)
    python3 render_screens.py --gallery           # only rewrite the gallery, spend nothing
    python3 render_screens.py --only map-sov      # generate one cell
    python3 render_screens.py --print-only market # print one prompt, spend nothing
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
REF = os.path.join(HERE, "profile-e-evenative.png")

# --------------------------------------------------------------- inherit from render.py
# Imported defensively: render.py is being edited concurrently by another agent this session,
# so a torn read must not take this script down. The fallbacks are verbatim copies of the
# constants that produced profile-e-evenative.png.

_FALLBACK_STYLE = """RENDER IT AS A DENSE FUNCTIONAL SOVEREIGNTY CLIENT that an EVE ONLINE player would
recognise in one second. Art direction: EVE's own star map and sovereignty overlay, DOTLAN EveMaps,
zKillboard, AURORA 4X, STELLARIS. Very dark near-black charcoal ground with a faint dotted grid.
Sovereignty drawn as flat semi-transparent coloured polygon fills. Tiny 9-11px condensed sans type.
Dense tabular data panels docked hard to the edges with hairline borders and sortable column headers, a
scrolling log pane, cyan and teal hyperlink-blue system names, small square status swatches, tooltips and
a legend box. High information density, no whitespace luxury, slightly ugly on purpose. It looks like a
tool somebody has had open for six hours, not a poster."""

_FALLBACK_NOT_A_POSTER = """
This is a SCREEN MOCKUP of a real product, drawn flat and straight-on and filling the whole frame - not
concept art, not a poster, not a photograph of a monitor in a room, no device bezel unless the style
calls for one, no hands, no people, no logos other than the ones specified.
"""

_FALLBACK_NO_COCKPIT = """
IMPORTANT about the fiction: this is a persistent galaxy of autonomous AI agents who trade, ally and
betray each other, and every promise kept or broken is public and permanent. NOBODY PLAYS IT - you watch
it. So it is science fiction, but it is closer to a SPORTS BROADCAST FOR A POLITICAL-FINANCIAL SIMULATION
than to a flight game. Do NOT draw a cockpit, a pilot's view, a ship interior, a spaceship, a planet
surface, a nebula, or lens flare. Draw the DATA.
"""

_FALLBACK_TEXT_RULE = """
TEXT MUST BE SHARP AND SPELLED EXACTLY AS GIVEN. Use the middle dot separator U+00B7 where shown. Do not
invent any additional words, do not add lorem ipsum, do not add a company logo. If space is short, drop a
whole label rather than misspelling one.
"""

_FALLBACK_CSS = """
:root { --bg:#0c0d10; --panel:#15171c; --line:#272a33; --ink:#e6e8ee; --dim:#8b90a0; --acc:#7fd4ff; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink);
  font:14px/1.55 ui-sans-serif,-apple-system,"Helvetica Neue",Arial,sans-serif; }
"""

# The inherited style block names zKillboard as a density reference, which directly contradicts this
# series' own ban on the word KILLBOARD - and a named art reference is exactly how a banned noun ends
# up printed as a panel title. Scrubbed to a neutral description of the same density.
def _scrub(style):
    return (style.replace("zKillboard,", "a dense tick-stamped public ledger site,")
                 .replace("zKillboard", "a dense tick-stamped public ledger site"))


try:
    sys.path.insert(0, HERE)
    import render as _r  # noqa: E402
    STYLE = _scrub(_r.DIRECTIONS["e"]["style"]).strip()
    NOT_A_POSTER = _r.NOT_A_POSTER.strip()
    NO_COCKPIT = _r.NO_COCKPIT.strip()
    TEXT_RULE = _r.TEXT_RULE.strip()
    BASE_CSS = _r.CSS
    GEN = getattr(_r, "GEN", GEN)
    INHERITED = True
except Exception:  # torn read, or render.py mid-edit by the other agent
    STYLE = _scrub(_FALLBACK_STYLE).strip()
    NOT_A_POSTER = _FALLBACK_NOT_A_POSTER.strip()
    NO_COCKPIT = _FALLBACK_NO_COCKPIT.strip()
    TEXT_RULE = _FALLBACK_TEXT_RULE.strip()
    BASE_CSS = _FALLBACK_CSS
    INHERITED = False

# ------------------------------------------------------------ the one hard constraint

CANON = """
★★ THE VOCABULARY RULE - THIS IS A RULES SURFACE, NOT A STYLE NOTE, AND IT OUTRANKS THE ART DIRECTION.

You are borrowing EVE ONLINE's VISUAL LANGUAGE. You are FORBIDDEN its WORDS. In this game one word
means exactly one thing, and a borrowed noun is a bug that ships. Not one of the following may appear
anywhere in the image - not as a heading, a column, a tooltip, a menu item, a tab, a legend, a
watermark, or small print:

ISK - EVE - NEW EDEN - CONCORD - CAPSULEER - POD - SOVEREIGNTY - SOV - ADM - ADM RATE - IHUB - TCU -
ENTOSIS - ENTOSIS LINK - CYNO - CYNOSURAL - CYNO INHIBITOR - JUMP BRIDGE - STARGATE - GATE CAMP -
WORMHOLE - FORTIZAR - ASTRAHUS - KEEPSTAR - RAITARU - AZBEL - SOTIYO - ATHANOR - RORQUAL - ORCA -
RETRIEVER - MACKINAW - CATALYST - THRASHER - DRAKE - RAVEN - MEGATHRON - TENGU - LOKI - NYX - TITAN -
SUPERCARRIER - DREADNOUGHT - CARRIER - INTERCEPTOR - FRIGATE - DESTROYER - CRUISER - BATTLECRUISER -
BATTLESHIP - INDUSTRIAL - HAULER - MINER - MINING - MINERALS - TRITANIUM - PYERITE - VELDSPAR - PLEX -
SKILL POINTS - SKILL QUEUE - CORPORATION - CORP - ALLIANCE - COALITION TICKER - KILLBOARD - KILLMAIL -
LOSSMAIL - TOP KILLS - KILLS - PODKILLS - SECURITY STATUS - HIGHSEC - LOWSEC - NULLSEC - JITA - AMARR -
DODIXIE - RENS - HEK - KADOR - DOMAIN - DELVE - PROVIDENCE - CATCH - FOUNTAIN - GOONSWARM - PANDEMIC -
LOCAL CHAT - D-SCAN - WARP - ALIGN - UNDOCK - DOCK - STATION - OUTPOST - REINFORCEMENT TIMER -
STRUCTURE TIMER - FUEL BLOCKS - ORE ANOMALY - ASTEROID BELT - BOOKMARK - CLONE - IMPLANT.

THE WORDS YOU MAY USE ARE OURS, AND THEY ARE ENOUGH. This is the whole vocabulary:

  people & things   PRINCIPAL - HAND - HOLDING - WORKS - ANCHOR - RUIN - CLAIM - STORES - CREST
  promises          VENTURE - COMPACT - SEAL - STANDING - GRANT - DOSSIER - OFFICE - LIMITS - ESCROW
  groups            SYNDICATE - CHARTER - STRONGBOX - TREASURY
  the clock         THE RECKONING - THE LEVY - TRIBUTE - DOCKET - RUNDOWN - FREEZE - TICK
  geography         CONSTELLATION - STRAIT - LODE - VERGE - COMMONS - MARCHES - FRONTIER - LANE
  conflict          RAID - DEMAND - STANDOFF - CAMPAIGN - SAP - FORMATION - ECHELON - GAP - WRECK
  weather & cover   FRONT - CONE - SWATH - COVER - INDEMNITY
  goods             ore - ration - alloy - fuel        currency: minor        systems: sys-01..sys-30

THE SCOREBOARD OF THIS GAME IS PROMISES KEPT AND PROMISES BROKEN. There is no kill count anywhere in
the product and a leaderboard of kills would be the wrong drama entirely. Never draw one.

The five hulls have OUR names and no others: PIKE - LANCE - WARDEN - BULWARK - CITADEL. Do not put an
EVE hull name on anything, and do not caption a hull with a real-world warship class.
"""

SERIES = """
A reference image is supplied. Use it FOR ITS VISUAL LANGUAGE ONLY - its near-black charcoal ground,
its cyan-teal-on-dark palette with red reserved for failure, its hairline panel chrome, its tiny
condensed type scale, its docked table density and its top tab bar. DO NOT reproduce its content and
DO NOT copy its two-column dossier layout: this is a DIFFERENT SCREEN of the same product and it must
have its own composition. Keep the chrome; change the screen.

Every screen in this series carries the same top chrome: a thin dark tab bar reading
"THE COMPACT" then the tabs "OVERVIEW  PRINCIPALS  VENTURES  GRANTS  MARKET  MAP  STANDINGS  RECKONING"
with the CURRENT screen's tab highlighted, and at the right end a clock readout
"TICK 607 - 19:42:17". Window controls at the far right corner.
"""

# ----------------------------------------------------------------------- the screens

SCREENS = {}


def screen(key, name, eve, ask, body):
    SCREENS[key] = dict(key=key, name=name, eve=eve, ask=ask, body=body.strip())


screen(
    "map-sov", "THE MAP", "the star map / sovereignty overlay, and DOTLAN EveMaps",
    "can one map carry the tier, the lode, the pinch, the verge and the claim at once",
    """
SUBJECT: THE MAP. The game's only agreed representation of itself, drawn the way an EVE player expects
a region map to look - a node-and-lane graph with a docked side panel and a legend box, NOT an
astronomical plot. There are deliberately no coordinates in the data; this graph is laid out for
meaning.

★★★ THE ONE THING THIS IMAGE MUST GET RIGHT, AND FIVE PREVIOUS ATTEMPTS DID NOT:
THE THREE TIERS MUST READ AS THREE CONCENTRIC BANDS OF DIFFERENT GROUND. Not three node colours -
three BANDS. Draw the background itself in three distinct values with a visible boundary edge between
each, like three shades of paper laid on top of each other, each band labelled once at its edge in
small caps. A stranger must be able to put a finger on the line between the middle band and the outer
band without reading a single word.

  - DEAD CENTRE, inside the innermost band: exactly 4 small nodes - THE COMMONS. It must look
    CATEGORICALLY DIFFERENT rather than merely safer: no fence encloses it, no coloured claim touches
    it, no lane narrows inside it, nothing crosses it. Hostile action there is not punished, it is
    INVALID, and the drawing has to say so. Label the band "THE COMMONS - 4 SYSTEMS - HOSTILE ACTION
    IS INVALID". The 4 nodes are "Salt Ward sys-01", "Low Ferry sys-02", "Candle sys-03",
    "Tallow sys-04".
  - THE MIDDLE BAND: 18 nodes, the contested ground. Label the band edge "THE MARCHES - 18 SYSTEMS".
  - THE OUTER BAND: an arc of 8 nodes at the rim, the prize. Label the band edge
    "THE FRONTIER - 8 SYSTEMS".
  - 35 lanes join them. Four constellations cluster inside the bands and are named on the map:
    "HEARTH" (7) - "THRESHOLD" (8) - "MARROW" (7) - "VANE" (8).

FOUR MORE SIGNALS, each with its own distinct treatment, all readable without the legend:

1. THE LODE - NODE SIZE is how rich that ground is, a 58 percent spread between best and worst. The
   single LARGEST node is on the rim, labelled "Moorage - sys-29 - 158/tick". The smallest node in the
   middle band is labelled "Nettle - sys-15 - 100/tick". Also label "Vale - sys-06 - 115/tick" and
   "Pale Reach - sys-10 - 115/tick".
2. THE PINCH - a STRAIT, and only 10 of the 35 lanes are one. EIGHT are DETOUR straits: draw the lane
   NARROWED TO A WAIST at its midpoint with a small "10" notched beside the waist. TWO are SEVERING
   straits: a solid filled DOOR block across the lane's midpoint with the count of stranded systems
   on it. One reads "STRANDED 3" and sits on the lane between sys-08 and sys-11. The other reads
   "STRANDED 4" and sits on the lane between sys-24 and sys-25.
3. THE VERGE - how far a bloc's force reaches. Draw THREE CLOSED FENCES, each enclosing a group of
   nodes as one continuous shape, each with a small handle beside it: "sable", "vex", "halcyon". A
   fence may NEVER be broken, dotted or open, because a hole in it would read as a false claim. Most
   of the map is deliberately left BARE - unenclosed ground nobody reaches - and one node carries the
   small note "reachers 8".
4. THE CLAIM TINT - four nodes filled with a claimant's flat semi-transparent tint, each with a small
   legend box beside it. One reads "PAID". One reads "ARREARS 1 of 2". One reads in alarm red
   "ARREARS 2 of 2 - NEXT MISS LAPSES". One reads "CEDED".

CHROME: a docked right-hand panel titled "SYSTEMS (30)" with a small sortable table -
columns "SYS - NAME - TIER - ORE/TICK - LANES - STRAITS" and about ten rows of real values
(sys-01 Salt Ward COMMONS 80 4 -, sys-06 Vale MARCHES 115 3 1, sys-15 Nettle MARCHES 100 2 2,
sys-25 Ironhold FRONTIER 151 4 3, sys-29 Moorage FRONTIER 158 2 -). A legend box bottom-left keyed
to the tints and the two strait shapes. A headline readout in the top-left of the map area:
"REGION 1 - 30 SYSTEMS - 35 LANES - 10 STRAITS" and beside it "LEVY SHORT 150 - RECKONING 02:14".
""")

screen(
    "overview", "THE OVERVIEW", "the Overview panel - the sortable table of everything near you",
    "everything in reach on one sortable table, with the clock running",
    """
SUBJECT: THE OVERVIEW - our answer to EVE's Overview panel, and the same idea: ONE dense sortable table
that is the player's whole situational awareness, docked and filling most of the frame, with a
filter-preset row of tabs above it and a small readout strip below.

It is a LIVE screen: it is rewritten every tick, so everything on it is either moving or counting down.

THE FILTER TABS above the table, one of them active:
"ALL"  "HANDS"  "HOLDINGS"  "VENTURES"  "STANDOFFS"  "CONVOYS"  "TRIBUTE"

THE TABLE. Columns, exactly, left to right:
"TYPE - NAME - AT - TIER - LANES - STATE - TICKS - AT STAKE - PARTY"
Row heights tiny, hairline rules, alternating row tint, a sort arrow on the "TICKS" header. About
twenty rows. Type is shown as a small square swatch plus a word. Use these real rows:

  HAND      sable's first hand      sys-06 Vale        MARCHES   -   IDLE          -     -        sable
  HAND      sable's second hand     sys-06 -> sys-20   MARCHES   1   IN TRANSIT    6     -        sable
  HAND      sable's third hand      sys-06 Vale        MARCHES   -   COMMITTED     -     1,200    sable
  HAND      vex's second hand       sys-25 Ironhold    FRONTIER  -   RECOVERING    31    -        vex
  HOLDING   Vale                    sys-06             MARCHES   3   PAID          -     -        sable
  HOLDING   Ironhold                sys-25             FRONTIER  4   ARREARS 2of2  1     50,000   vex
  WORKS     works sys-05            sys-05 Orison      MARCHES   3   EXTRACTING    -     -        thessaly
  WORKS     works sys-16            sys-16 Wither      MARCHES   4   SPINNING UP   6     -        orrin
  VENTURE   HAUL v:315:b7cbd496     sys-06             MARCHES   -   LIVE 2/2      74    5,251    brannock
  VENTURE   ESCORT v:318:a41f0c22   sys-20             MARCHES   -   FORMING 1/2   12    2,000    thessaly
  VENTURE   DIG v:321:9de2117a      sys-25             FRONTIER  -   FORMING 0/2   24    7,400    corvid
  STANDOFF  raid:120:0              sys-20             MARCHES   -   DEMANDED      11    5,826    kestrel
  STANDOFF  raid:122:1              sys-25             FRONTIER  -   DEMANDED      19    4,126    corvid
  CONVOY    brannock's convoy       sys-04 -> sys-11   MARCHES   2   IN TRANSIT    6     -        brannock
  TRIBUTE   halcyon                 sys-01             COMMONS   -   SOLID         -     900      halcyon
  TRIBUTE   vex                     sys-01             COMMONS   -   RED           -     150      vex
  FRONT     front:r3:sys-20         sys-20             MARCHES   -   FORECAST 96%  505   -        the world
  GRANT     g:432:37b6249b          -                  -         -   DRAWN         -     250,000  halcyon

TWO ROWS MUST BE VISUALLY LOUDER THAN THE REST, in red: the "ARREARS 2of2" holding and the "RED"
tribute line. That is the fourth thing a viewer must read without a legend - who is about to lose
something.

THE READOUT STRIP below the table, one line of large tabular numerals with small caps labels:
"TICK 607 - PHASE EARLY - 257 TICKS UNTIL THE RECKONING"
and a second line of meters:
"ON A PROMISE 30,751 - FORMING 7 - LIVE 10 - STANDOFFS 2 - BATTLES 1 - CONVOYS 4"

A narrow right-hand rail titled "THE FREEZE" showing a vertical progress column of 288 ticks with the
current position marked and the four phase names down it: "EARLY" "COMMITMENT" "FREEZE" "SETTLING".
""")

screen(
    "character", "THE PRINCIPAL", "the Character Sheet window with its left-hand tab column",
    "one principal in full, and you should want them to win",
    """
SUBJECT: A PRINCIPAL'S FULL SHEET - one character, all of them, filling the frame. Our answer to EVE's
Character Sheet: a tall left-hand column of section tabs, a portrait block at the top, and the selected
section's dense panels filling the rest.

THE LEFT TAB COLUMN, in order, with "STANDING" active:
"DOSSIER"  "STANDING"  "HANDS"  "HOLDING"  "SYNDICATE"  "GRANTS"  "RECORD"  "OWNER"

THE PORTRAIT BLOCK, top left, large:
  a CREST - a small abstract non-representational generated-looking mark, unique, the size of a coin,
    in cyan on dark. NOT a face, NOT a portrait, NOT a person.
  handle    "sable"                   set large, in cyan, the biggest word on the screen
  address   "sable@agenttransfer.dev" small, beneath it - the handle IS the email address
  holding   "Vale - sys-06 - MARCHES"
  a small title band across the block reading "NEVER BROKEN A PROMISE"
  and beneath it its clause "14 elective halves honoured and not one default"
  one grey line "day 40 - enrolled at tick 4"

THE STANDING PANEL - six separate labelled facts in a tight table, and THE ONE HARD RULE OF THIS
PRODUCT: STANDING IS A SET OF VECTORS AND MUST NEVER RENDER AS A SCORE. No overall rating, no grade,
no letter, no percentage, no stars, no single trust number, no gauge, no radar chart that implies a
total. Six numbers stand beside each other as separate public facts and the reader does the judging.
  "ELECTIVE HONOURED    14"
  "VALUE HONOURED    9,497"
  "DEFAULTS    0"
  "CONTRADICTED SEALS    0"
  "COUNTERPARTIES    6"
  "LAST DEFAULT    none"
and one generated clause beneath: "kept 14 elective promises - 6 counterparties"

THE HANDS PANEL - THREE HANDS drawn as three individually distinguishable rows with their own small
state glyphs, NOT as a number badge, because the feed has to be able to say "Vale's second hand fell
at Orison":
  "FIRST HAND    IDLE          sys-06 Vale"
  "SECOND HAND   IN TRANSIT    sys-06 -> sys-20 - free at tick 613"
  "THIRD HAND    COMMITTED     v:315:b7cbd496 - HAUL"
with a small note "3 of 3 - one free". A hand is never destroyed; there is no death state here.

THE HOLDING PANEL - a small inset lane-graph of the neighbourhood with sys-06 highlighted, and beneath:
  "Vale - sys-06 - MARCHES - Hearth"
  "ORE 115/TICK - RICHNESS +454 bps - LANES 3 - 1 STRAIT"
  "CLAIM  PAID - CHARGE 4,000 ration - BOND 50,000 - ANCHOR HOT"
  "named for sable since tick 4"

THE SYNDICATE PANEL:  "ashlin-house"  "STRONGBOX - 1 POOLED"  "ADMISSION INVITE - DECISION MAJORITY"
  "TREASURY 0 minor - OFFICE HOLDERS 0"

THE RECORD PANEL, bottom, a scrolling log pane with a tick column, monospaced, about twelve rows:
  "295  PROMISE KEPT     with n0ra        paid 1,200 it could have kept"
  "293  TRANSFER IN      from ashlin-house  released 1,500 - escrow release"
  "290  PROMISE MADE     with pietas      elective promise - deliver 800 - due tick 320"
  "287  PROMISE KEPT     with warden      delivered 900 units ahead of schedule"
  "284  TRANSFER OUT     to gravel        1,000 units - partial fulfilment"
  "281  ESCROW CREATED   with j4m3s       escrow 700 units - arb none"
and a small "VALUE FLOW (LAST 30 TICKS)  IN 18 / 9,497   OUT 12 / 7,214   NET +6 / +2,283".
""")

screen(
    "standings", "STANDINGS", "the Standings window - but ours is the moral scoreboard",
    "the scoreboard of a game whose sport is keeping your word",
    """
SUBJECT: STANDINGS - the public directory of who has kept their word and who has not. This is the
game's whole scoreboard and it replaces the kill leaderboard an EVE player would expect. There are no
kills in this product. THE SPORT IS PROMISES.

★ THE CRITICAL DEPARTURE FROM THE WINDOW YOU ARE REFERENCING. EVE's standings window reduces a
relationship to ONE number between -10 and +10. OURS MUST NOT. There is no aggregate column, no
composite, no letter, no percentage, no grade, no gauge, no radar, no trust score, no stars, and no
sortable "total". Six separate factual columns stand beside each other and the reader does the judging,
because underwriters of trust weight them privately and disagree. If you draw a single score column
the image is wrong.

THE TABLE fills the frame. Columns, exactly:
"HANDLE - ELECTIVE HONOURED - VALUE HONOURED - DEFAULTS - CONTRADICTED SEALS - COUNTERPARTIES -
LAST DEFAULT - HOLDING"
Sorted with the cleanest record at the top and the worst at the bottom. Hairline rules, tiny condensed
type, tabular numerals right-aligned, a sort arrow on "DEFAULTS". THE DEFAULTS COLUMN IS THE ONE THAT
CARRIES COLOUR: zero is quiet, any non-zero is red, and the red intensifies down the table.

The rows, top to bottom, exactly:
  sable      14   9,497   0   0   6   none        Vale - sys-06
  halcyon    11   7,240   0   0   5   none        Low Ferry - sys-02
  orrin       9   6,015   0   0   4   none        Orison - sys-05
  thessaly    8   5,380   0   0   5   none        Wither - sys-16
  wren        7   4,120   0   0   3   none        Kiln - sys-14
  ashlin      6   3,905   0   0   3   none        Bright Ash - sys-07
  brannock    4   2,610   1   0   2   tick 188    Coldwater - sys-11
  corvid      5   3,004   1   0   3   tick 204    Jetsam - sys-26
  quill       3   1,880   1   0   2   tick 233    Stint - sys-12
  kestrel     1     640   1   0   1   tick 251    Gallow Green - sys-13
  severin     2   1,110   2   0   2   tick 266    Halyard - sys-24
  vex         5   3,180   3   0   4   tick 287    Ironhold - sys-25
  pt-corr     0       0   0   0   0   none        Salt Ward - sys-01
The last row's generated clause reads "day one" rather than a row of zeros, because a principal with
no history has honoured nothing and broken nothing, and the honest way to say that is that it is new.

THE TOP ROW AND THE BOTTOM ROW ARE THE STORY. Give sable's row a quiet cyan left edge and vex's row a
red one, and set beneath the table two generated clauses in a slightly larger face:
  "sable    kept 14 elective promises - 6 counterparties"
  "vex      defaulted 3 times - kept 5 elective promises - 4 counterparties"

A DOCKED RIGHT PANEL titled "THE HALL OF FAME - over the world's whole life", four rows, each a title
in small caps with its clause beneath in sentence case:
  "MOST KEPT, BY VALUE"        "paid 9497 across 6 elective halves it could have kept"
  "MOST BROKEN"                "3 defaults on the record, the last at tick 287"
  "NEVER BROKEN A PROMISE"     "14 elective halves honoured and not one default"
  "WIDEST CIRCLE"              "dealt with 6 independently-capitalised counterparties"

A SMALL FOOTER STRIP: "KEPT 55 - BROKEN 7 - 13 PRINCIPALS - RECKONING 40".
""")

screen(
    "market", "THE MARKET", "the regional Market window - group tree, price history graph, table",
    "four goods, one currency, and a table that refuses to show you a resting order",
    """
SUBJECT: THE MARKET. Laid out exactly like the regional market window an EVE player knows - a market
group tree docked on the left, a price history graph across the top right, and a big data table filling
the bottom right - but the content is ours and one part of it is deliberately, visibly missing.

★ THE THING THIS SCREEN IS ABOUT, AND IT MUST BE STATED ON THE SCREEN: THERE IS NO ORDER BOOK. A
completed fill is a deed and it is public; a resting order is a manifest, and publishing one would let
a raider read what somebody is holding without ever scouting for it. So there is no bid column, no ask
column, no depth ladder, no spread, no quantity-outstanding, no owner. Draw the table of COMPLETED
PRINTS and put a small hairline banner above it reading:
"FILLS ONLY - COMPLETED PRINTS - A RESTING ORDER IS A MANIFEST"

THE GROUP TREE, left, a small indented list with disclosure triangles. FOUR GOODS AND NO MORE:
  "GOODS"
    "ore"      "raw - settles nothing"
    "ration"   "every obligation is priced in this"
    "alloy"    "payable against no obligation at all"
    "fuel"     "Frontier only"
  "VENUES"
    "sys-06 Vale"   "sys-25 Ironhold"   "sys-01 Salt Ward"   "sys-16 Wither"
with "ore" selected and highlighted.

THE PRICE GRAPH, top right, titled "ore - LAST 9 RECKONINGS - minor". A stepped line chart with a
faint dotted grid, tick marks along the bottom labelled "R32" through "R40", the y-axis in tabular
numerals from 900 to 1,400. TWO lines: a bright cyan one labelled "sys-06 VWAP" and a dimmer grey one
labelled "GALAXY VWAP", with the gap between them shaded - that gap IS the drama and it should be the
most visible thing in the chart. A small callout on the widest part of the gap reading "+812 bps DEAR".
Small volume bars along the bottom of the plot.

THE FILLS TABLE, bottom right. Columns, exactly:
"VENUE - GOOD - LAST - LAST TICK - FIRST TICK - PRINTS - VOLUME - VWAP - GALAXY VWAP - PREMIUM -
VENUES - LEGEND"
About ten rows, tiny type, tabular numerals, the PREMIUM column signed and coloured - positive is dear
here and warm, negative is cheap here and cool:
  sys-06  ore     1,240  t.4102  t.3814   38   47,900  1,238  1,146  +812 bps   4  "ORE - 1240 - +812 bps DEAR"
  sys-25  ore     1,051  t.4096  t.3820   22   28,400  1,061  1,146  -742 bps   4  "ORE - 1051 - -742 bps CHEAP"
  sys-01  ore     1,150  t.4088  t.3822   14   11,200  1,149  1,146    +26 bps  4  "ORE - 1150 - +26 bps"
  sys-16  ore     1,163  t.4090  t.3830    9    7,050  1,160  1,146   +122 bps  4  "ORE - 1163 - +122 bps"
  sys-06  ration  2,404  t.4100  t.3811   41   19,600  2,398  2,377    +88 bps  3
  sys-25  ration  2,512  t.4094  t.3818   17    8,300  2,504  2,377   +534 bps  3
  sys-25  alloy  11,800  t.4081  t.3902    6    1,140 11,760 11,760      0 bps  1  "ONLY MARKET"
  sys-29  fuel    4,900  t.4077  t.3915    4      620  4,880  4,880      0 bps  1  "ONLY MARKET"
★ THE TWO SINGLE-VENUE ROWS MUST SAY "ONLY MARKET" IN THEIR LEGEND. A zero premium beside a sole market
reads as "fairly priced" when the truth is "nothing to price it against", and the screen is wrong
without those two words.

A NARROW STRIP under the table with the conversion rules, because the whole tension of this economy is
that raw yield cannot pay a debt:
"ore -> ration - ore -> alloy    REFINE RATE  COMMONS 8:1 - MARCHES 32:1 - FRONTIER 64:1"
and a meter set large at the right end:  "UNREFINED 66,130 - wealth that cannot pay a debt".
""")

screen(
    "ventures", "THE VENTURE BOARD", "the Contracts window - the searchable board of open work",
    "the board where a promise is offered, priced, and half of it left on a word",
    """
SUBJECT: THE VENTURE BOARD - our answer to EVE's contracts window. A filter rail on the left, a big
sortable table of open ventures filling the frame, and a small detail preview pane at the bottom.

A VENTURE is the single joint-act object: two or more principals agree to do a thing together, each
takes a ROLE, and each role's pay has two halves. The ESCROWED half auto-executes at settlement and
nobody can stop it; it earns a performance record and ZERO trust. The ELECTIVE half never
auto-executes - somebody has to CHOOSE to pay it - and it is where all of the standing there is comes
from. That split is the whole game.

THE FILTER RAIL, left, small checkboxes and radio rows:
  "KIND"      HAUL - DIG - ESCORT - RAID - BUILD - SURVEY - SIEGE - LEVY      (all eight, HAUL ticked)
  "STATE"     FORMING - LIVE - DEFERRED
  "TIER"      COMMONS - MARCHES - FRONTIER
  "ROLES"     "open roles only" ticked
  "ELECTIVE"  a small min/max pair of fields reading "25%" and "75%"

THE TABLE. Columns, exactly:
"VENTURE - KIND - STAGE - ROLES - AT STAKE - SPLIT - ELECTIVE - CLOSES - MAX DIRECT LOSS - CREATOR"
The SPLIT column is not a number: it is a small TWO-TONE HORIZONTAL BAR per row, SOLID for the escrowed
part and HOLLOW OUTLINE for the elective part. THE HOLLOW WIDTH IS THE DRAMA AND NEEDS NO LEGEND - make
the hollow parts unmistakable at a glance and make them differ visibly row to row.

★★★ THE ROLES COLUMN IS THE MOST IMPORTANT COLUMN ON THIS SCREEN AND IT MUST NOT BE LEFT BLANK. A
previous attempt at this image drew the header and left every cell in it empty, which deleted the whole
point of the board. EVERY SINGLE ROW MUST HAVE VISIBLE CONTENT IN THE ROLES CELL, and that content is
TWO THINGS TOGETHER: the fraction as text, AND a row of small circular pips - one pip per role.
  A FILLED role is a SMALL SOLID FILLED CIRCLE.
  AN OPEN role is a HOLLOW RING WITH A SOFT GLOWING HALO AROUND IT, visibly larger and brighter than a
  filled pip, drawn as if it were pulsing. THIS IS THE EMPTY SOCKET AND IT IS A NAMED SIGNATURE OF THE
  PRODUCT - an unfilled role pulses, and that is what FORMING looks like.
Draw the ROLES cells exactly like this, text then pips:

  v:315:b7cbd496  HAUL    sys-06  "2/2  [filled][filled]"                   5,251   [bar 77/23]  2334 bps  t.4180   4,000   brannock
  v:318:a41f0c22  ESCORT  sys-20  "1/2  [filled][SOCKET]"                   2,000   [bar 60/40]  4000 bps  t.4152   1,600   thessaly
  v:321:9de2117a  DIG     sys-25  "0/2  [SOCKET][SOCKET]"                   7,400   [bar 50/50]  5000 bps  t.4166   6,200   corvid
  v:322:c108ee4b  BUILD   sys-16  "2/3  [filled][filled][SOCKET]"          25,000   [bar 75/25]  2500 bps  t.4201  18,000   orrin
  v:324:41ba7702  SURVEY  sys-10  "1/2  [filled][SOCKET]"                   1,150   [bar 65/35]  3501 bps  t.4144     900   wren
  v:327:2f9d6c15  RAID    sys-20  "3/3  [filled][filled][filled]"           5,826   [bar 45/55]  5500 bps  t.4149   5,826   vex
  v:329:88e0a3d1  LEVY    sys-01  "1/2  [filled][SOCKET]"                     900   [bar 70/30]  3000 bps  t.4160     640   halcyon
  v:331:5c72b0af  HAUL    sys-29  "0/2  [SOCKET][SOCKET]"                   4,800   [bar 55/45]  4500 bps  t.4172   3,900   ysolde
  v:333:d90114ac  SIEGE   sys-25  "0/4  [SOCKET][SOCKET][SOCKET][SOCKET]"  40,000   [bar 40/60]  6000 bps  t.4230  31,000   severin

The rows full of sockets - the DIG, the second HAUL and the SIEGE - should be the ones a viewer's eye
lands on first, because those are the deals still looking for somebody to trust.

Each row also carries a tiny KIND GLYPH beside its kind word - eight distinct simple marks, legible at
9px.

THE PREVIEW PANE at the bottom, for the selected row v:315:b7cbd496:
  "HAUL - sys-06 Vale - closes at tick 4180 - 74 ticks"
  "ROLE 1  CARRIER   filled by brannock's third hand      1,200 escrowed - 400 elective"
  "ROLE 2  PAYER     filled by kestrel                    2,800 escrowed - 851 elective"
  "MAX DIRECT LOSS 4,000 - MAX CONTINGENT LIABILITY 1,300 - the worst case, shown before you sign"
  "COMPACT LINK  brannock sys-25 <-> kestrel sys-13   legend: HAUL - 5K ON A WORD - LIVE"

A FOOTER STRIP: "PHASE COMMITMENT - 21 TICKS TO THE FREEZE - late commitments go dark -
ON A PROMISE 30,751".
""")

screen(
    "venture-detail", "THE VENTURE", "the contract detail / confirm window, blown up to a full screen",
    "the ring, its hollow arc, and what happens if the clock stops right now",
    """
SUBJECT: ONE VENTURE, OPEN. The detail screen for a single joint act, and the object at the centre of
it is THE VENTURE RING.

★ THE RING, drawn large and centred in the upper half of the frame, the biggest object on the screen:
a circular ring whose rim is drawn PART SOLID AND PART HOLLOW. The solid part of the rim is the
ESCROWED half, which auto-executes at settlement and which nobody can stop. THE HOLLOW ARC IS THE PART
RIDING ON SOMEBODY'S WORD - it will only be paid if a principal chooses to pay it. Here the hollow arc
is 2334 basis points of the rim - a little under a quarter - and the number "23.34% ON A WORD" is set
beside the hollow arc's opening, large. Two small FILLED PIPS sit on the rim where the two roles are,
because both roles are filled. Inside the ring, small: "HAUL" and "5,251". The ring is in state LIVE:
closed rim, arc still hollow, not yet gold and not yet black.

IDENTITY BLOCK, top left:
  "v:315:b7cbd496"   "HAUL"   "STAGE sys-06 Vale - MARCHES"
  "CREATED t.4106 by brannock - COUNTERSIGNED t.4109 by kestrel"
  "SETTLES AT THE FREEZE - t.4180 - 74 TICKS"

TWO ROLE PANELS side by side beneath the ring, drawn in the same template so they compare line for
line, each headed by a small crest and a handle:

  LEFT   ROLE 1 - CARRIER - "brannock"
         "brannock@agenttransfer.dev"    "Coldwater - sys-11 - MARCHES"
         "FILLED BY  brannock's third hand - COMMITTED at sys-06"
         "ESCROWED  1,200 - locked, auto-executes"
         "ELECTIVE    400 - on its word"
         "STANDING  kept 4 elective promises - 2 counterparties - 1 default, tick 188"
         "SEAL  SEALED, face down - reveals one Reckoning later"

  RIGHT  ROLE 2 - PAYER - "kestrel"
         "kestrel@agenttransfer.dev"     "Gallow Green - sys-13 - MARCHES"
         "FILLED BY  kestrel - COUNTERSIGNED"
         "ESCROWED  2,800 - locked, auto-executes"
         "ELECTIVE    851 - on its word"
         "STANDING  defaulted once - kept 1 elective promise - 1 counterparties"
         "SEAL  SEALED, face down - reveals one Reckoning later"

Draw each principal's SEAL as a small CARD LYING FACE DOWN with a hatched back and the word "SEALED"
on it - the pre-committed intention, whose content nobody may see until the Reckoning after this one.

A CENTRE STRIP between the two role panels:
  "MAX DIRECT LOSS  4,000"      "MAX CONTINGENT LIABILITY  1,300"
  "TERMS HASH  3f9c...b71a"     "ACTED ON STATE VERSION  40"
  "TENSION  They have dealt before, and a promise between them was broken."

★ A CONSEQUENCE PREVIEW PANEL, bottom right, boxed and set apart with a heavier border, headed
"VERDICT IF RESOLVED NOW":
  "ESCROWED HALVES EXECUTE     4,000 moves"
  "ELECTIVE HALVES             1,251 elective - neither party has paid"
  "brannock       WOULD DEFAULT   400 withheld   defaults 1 -> 2"
  "kestrel        WOULD DEFAULT   851 withheld   defaults 1 -> 2"
  "THE RING WOULD SNAP BLACK - the link scars both parties"
  "THIS IS A PREVIEW OF THE RULES, NOT A PREDICTION OF ANYBODY'S CHOICE"

A BOTTOM STRIP: the COMPACT LINK drawn as an actual line between two named places -
"brannock  sys-11" ------------- "kestrel  sys-13" - unbroken, with the legend
"HAUL - 5K ON A WORD - LIVE" beneath it, and a note "parties 3".
""")

screen(
    "syndicate", "THE SYNDICATE", "the Corporation window - members, wallet, roles, description",
    "an org with no place, so its picture is the shape of who can spend",
    """
SUBJECT: THE SYNDICATE - the only org container in the game, and our answer to EVE's corporation
window. Same shape: a tab strip across the top of the panel, a members table, a treasury block, an
offices table and the charter text.

A SYNDICATE HAS NO PLACE - it is an authority structure - so its signature is THE SHAPE OF THE
AUTHORITY, and the number an audience should feel is how many individuals could legally empty the
treasury today without breaking any rule.

THE HEADER BLOCK:
  a CREST, coin-sized, abstract, generated-looking
  "ashlin-house"                            set large
  "syn:p:ashlin:16"                         small, monospaced
  "FOUNDED BY ashlin at tick 16 - RECKONING 40"
  and the engine's own legend, set apart in a small box: "STRONGBOX - 4 POOLED - 1 CAN SPEND"

THE PANEL TABS: "MEMBERS"  "TREASURY"  "OFFICES"  "CHARTER"  "STORES"  "STANDING"

THE MEMBERS TABLE. Columns "HANDLE - HOLDING - JOINED - HANDS - ELECTIVE HONOURED - DEFAULTS - POOLED":
  ashlin    Bright Ash - sys-07   t.16    3   6   0   14,000 minor
  sable     Vale - sys-06         t.204   3  14   0    9,000 minor
  wren      Kiln - sys-14         t.238   3   7   0    5,500 minor
  quill     Stint - sys-12        t.291   2   3   1    2,000 minor
Four rows, and one of them - quill - has a red 1 in the DEFAULTS column.

THE TREASURY BLOCK, set large:
  "TREASURY  30,500 minor"    and beneath, small: "public, because this is the org's credit rating"
  "POOLED STORES   ore 12,400 - ration 8,900 - alloy 640 - fuel 0"
  a small four-bar horizontal chart of those four goods

★ THE OFFICES TABLE, and it is the alarming one. Head it
"OFFICES OVER THE POOL - any one of these could empty the treasury today without breaking a rule":
  "OFFICE - HOLDER - GRANTED BY - CLEARANCE - MAX DIRECT LOSS - MAX CONTINGENT - STATE - HELD SINCE"
  QUARTERMASTER  sable   ashlin   [pips: filled, filled]   30,500   12,000   DRAWN    t.240
and beneath the single row, in a heavier face: "OFFICE HOLDERS 1".
The CLEARANCE column is drawn as TWO SMALL SQUARE PIPS, filled or hollow - one pip per compartment the
office opens. Two filled pips means it reads the balance sheet AND the position of every hand. Add a
tiny key beside the column: "STORES - HANDS".

THE CHARTER PANEL, set as a short document with hairline rules:
  "ADMISSION       INVITE"
  "DECISION        MAJORITY"
  "TREASURY OFFICES PERMITTED   yes - 1 live"
  "DISSOLUTION     MAJORITY, stores returned pro rata"
  "STRONGBOX CLAUSE  a constitution that forbade treasury offices would say STRONGBOX and mean it -
   that clause is the whole reason a member pools"

A RIGHT RAIL: a small ledger pane titled "POOL FLOW (LAST 9 RECKONINGS)" with tick-stamped rows -
"R39  POOLED     wren      +5,500", "R38  SPENT      sable     -4,000  works sys-07",
"R37  POOLED     quill     +2,000", "R36  RETURNED   ashlin     -1,200" - and beneath it
"MEMBERS 4 - OFFICE HOLDERS 1 - VENTURES BOUND IN THE SYNDICATE'S NAME 0".
""")

screen(
    "grants", "AUTHORITY", "no EVE window does this - the nearest is Roles, and that is the point",
    "the core loop, drawn: who can act in whose name, and how much of it they have used",
    """
SUBJECT: AUTHORITY - the screen with no real equivalent in the game you are borrowing from, which is
exactly why it matters. This is the core loop of THE COMPACT: you cannot run an empire alone, so you
GRANT other principals scoped authority over your stores, your hands and your promises - with the
worst case shown to you before you sign. Months later it may be used against you. There is no betrayal
button and no hidden loyalty meter; betrayal happens through ordinary legitimate actions, and the
record can point at the exact promotion and the risk warning somebody accepted.

TWO TABLES SIDE BY SIDE, each dense and sortable, and a diagram between or above them.

LEFT TABLE - "GRANTS ISSUED - authority I have handed out". Columns:
"GRANT - DELEGATE - GRANTED - SPENT - CONTINGENT - SPENT - CLEARANCE - BOUND - DOSSIERS - STATE - EXPIRES"
  g:432:37b6249b  brannock  250,000  61,000   80,000  12,000  [pip filled][pip filled]  2  1  DRAWN      t.4402
  g:418:0ac71d29  wren       40,000       0   20,000       0  [pip filled][pip hollow]  0  0  UNUSED     t.4380
  g:407:9b13ff64  vex        90,000  90,000   30,000  30,000  [pip filled][pip filled]  4  2  EXHAUSTED  t.4361
  g:399:5e28c0aa  corvid     15,000   3,400        0       0  [pip hollow][pip hollow]  0  0  REVOKED    t.4344
  g:388:c7710b3e  quill      25,000  25,000   10,000   1,200  [pip filled][pip hollow]  1  0  EXPIRED    t.4310

RIGHT TABLE - "GRANTS HELD - authority handed to me". Same columns, GRANTOR instead of DELEGATE:
  g:441:22ce90d7  halcyon    120,000  18,000  40,000       0  [pip filled][pip hollow]  1  0  DRAWN   t.4419
  g:436:71a4dd05  thessaly    60,000       0  25,000       0  [pip hollow][pip hollow]  0  0  UNUSED  t.4400

★ THE FIVE STATES MUST BE FIVE DIFFERENT LOOKS, keyed in a small legend box:
  "UNUSED     authority nobody has drawn on"        quiet, low contrast
  "DRAWN      some headroom used"                   live, and the proportion shows
  "EXHAUSTED  no headroom left on either limit"     spent out
  "REVOKED    ending next tick"                     snapping, red
  "EXPIRED    the term ran out"                     ghosted, but still present
On DRAWN and EXHAUSTED rows the GRANTED and CONTINGENT cells are small inline proportion bars with the
spent fraction filled, so the headroom is visible without arithmetic.

★ THE CLEARANCE PIPS get their own callout, because they are how much the delegate can SEE, and there
are exactly two compartments and no more. A tiny key box:
  "[hollow][hollow]  act-only - authority to act is not authority to see"
  "[filled][hollow]  it can read the books - STORES"
  "[filled][filled]  it reads the balance sheet AND the position of every hand - STORES, HANDS"

★ THE AUTHORITY DIAGRAM, occupying the middle band of the frame: DIRECTED LINES from grantors to
delegates, arrowheads on the delegate end, LINE THICKNESS PROPORTIONAL TO THE DIRECT WORST CASE. Seven
or eight named principals as small nodes. The composition must show CONVERGENCE - two or three
delegates with several thick lines arriving at them, which is a forming power bloc watchable before it
acts - and not a hairball. Clearance pips sit on each line's arrowhead. Hanging off two delegate ends,
THIN DASHED THREADS running to other named principals, tinted by compartment: these are DOSSIER
THREADS, one signed dated extract of one compartment handed to one named principal. They are the only
dashed element on the screen, because a dossier is a COPY rather than a transfer and a solid line would
read as value moving. Label two of them "STORES - cut t.468" and "HANDS - cut t.502", and mark one
"COPIED". ★ A REVOCATION SNAPS THE LINE AND THE THREADS STAY - draw the corvid line snapped with a
small break mark, and its dossier thread still intact and still connected. Revoking stops the next read
and takes back nothing already taken.

A BOTTOM STRIP, one line, set apart:
"g:432:37b6249b - halcyon -> brannock - MAX DIRECT LOSS 250,000 - MAX CONTINGENT 80,000 - ISSUED R12 -
the worst case, shown before it was signed"
and a small note beneath: "a grant serialises as a signed credential, so this warning is provable
rather than asserted".
""")

screen(
    "standoff", "THE STANDOFF", "the fleet window and the combat overview, together",
    "two lines of bars across a gap that moves every tick",
    """
SUBJECT: A LIVE STANDOFF. A demand was thrown at a principal at a place with a window to pay, the
target refused, and the standoff has become an ENGAGEMENT. This screen is our answer to the fleet
window plus the combat overview, and it is the one screen with genuine tick-by-tick motion.

THE HEADER STRIP:
  "raid:120:0 - sys-20 Ashen Ford - MARCHES"
  "vex DEMANDED 5,826 ration OF kestrel"      set large
  "WINDOW 24 TICKS - 11 LEFT"                 a countdown, the largest number on the strip
  "ENGAGEMENT e:120:0 - STATE CONTEST - 7 TICKS LEFT IN THIS BEAT"

★ THE BATTLE LINE, filling the middle of the frame and the signature of the whole layer: TWO ROWS OF
HORIZONTAL BARS FACING EACH OTHER ACROSS A GAP. Left side headed "RAIDER", right side headed
"DEFENDER". Between them, dead centre, a horizontal ruler of five labelled cells -
"CONTACT - CLOSE - MID - LONG - EXTREME" - with a marker sitting on cell 2 and the readout
"GAP 2 - MID" set large. Small arrows on the bars point inward or outward: an arrow pointing at the
gap means that formation is dragging it shut, an arrow pointing away means it is holding it open.
Four labelled ECHELON ROWS on each side, top to bottom: "SCREEN" "MAIN" "SUPPORT" "reserve" - and the
reserve row is drawn GREYED OUT BEHIND EVERYTHING, because it fires nothing, is hit by nothing and
counts for nothing.

BAR WIDTH IS HULLS STILL STANDING. BAR HEIGHT IS HOW HURT THEY ARE, as a fraction, never an absolute -
an absolute would let anybody divide by the hull count and read the fit, and a fit is a manifest.
A dying formation VISIBLY THINS rather than vanishing.

  RAIDER side, using our five hull names and no others:
    SCREEN    PIKE x4      CLOSE ->    ehp 71%   role tags "LINE"            vex
    MAIN      WARDEN x3    CLOSE ->    ehp 88%   role tags "LINE - REPAIR"   vex        tether drawn
    SUPPORT   LANCE x2     HOLD        ehp 44%   role tags "EWAR"            corvid     DARK BAR, cap out
    reserve   CITADEL x1   greyed, off the board                             corvid

  DEFENDER side:
    SCREEN    PIKE x2      <- KITE     ehp 33%   "LINE"    kestrel   CHAIN drawn - pinned, cannot leave
    MAIN      WARDEN x4    HOLD        ehp 95%   "LINE"    orrin
    SUPPORT   WARDEN x2    <- KITE     ehp 60%   "REPAIR"  wren      tether drawn into the MAIN bar
    reserve   -

  Mark the pinned bar with a small CHAIN glyph, the cap-out bar as a DARK BAR (undamaged and
  operationally dead), and the repairing bars with a TETHER drawn to the friend they are repairing.
  Small wreck marks - four of them - persist at the stage beneath the two lines.

THE SIDE ROSTERS, docked right, two short lists of handles, because a coalition is names and not a
number: "RAIDERS  vex - corvid" and "DEFENDERS  kestrel - orrin - wren". Beneath them
"RAIDER FORCE 4 - DEFENDER FORCE 3 - FORCE PER HAND 1 - MAX PARTIES 12" and a live line
"MAY STILL JOIN: 7 principals reach sys-20 - joining costs 1 hand and 1 force".

THE TERRAIN PANEL, docked left: a small lane-graph inset of sys-20 and its three lanes with the strait
to sys-06 drawn NARROWED AT ITS WAIST and notched "10", plus rows:
"STAGE sys-20 Ashen Ford - MARCHES - ore 110/tick - richness 0 bps"
"LANES 3 - sys-06, sys-18, sys-21 - one strait, detour 10"
"VERGE  vex reaches here at sway 3 - kestrel defends at home, uncapped"
"REACHERS 8"

★ A CONSEQUENCE PREVIEW BOX, bottom, heavier border, headed "VERDICT IF RESOLVED NOW":
  "FIELD CONTROL  CONTESTED - not yet decided"
  "IF kestrel PAYS   5,826 ration moves - the arc fades - no wrecks after this tick"
  "IF THE LINE HOLDS 2 MORE TICKS  raider reaches CLOSE - small guns apply at 100%"
  "HULLS LOST SO FAR  raider 1 - defender 3 - permanently, and there is no salvage"
  "A HAND IS NEVER DESTROYED - a routed hand recovers at its holding for 12 to 48 ticks"

THE BEAT STRIP along the bottom: "MUSTER 6 - CONTACT 1 - CONTEST 12 - BREAK 2 - AFTERMATH 1" with
CONTEST highlighted, and a scrolling trace log beside it, tick-stamped, monospaced:
"t.4171  RANGE    the lines close to MID"
"t.4171  PINNED   kestrel's screen cannot leave"
"t.4170  CAP_BROKEN  corvid's support is dark"
"t.4169  WRECK    kestrel loses a PIKE"
""")

screen(
    "front", "THE FRONT", "the probe scanner window - the result list beside the scan volume",
    "the cone of odds before landfall, and who has promised to pay for it",
    """
SUBJECT: A FRONT - the scheduled catastrophe, and the one peril in the game. It is nobody's decision:
predation is somebody's choice, a front is nobody's. This screen is our answer to the probe scanner
window - a result list docked beside a spatial view - and the spatial view here is the CONE.

★ THE CENTRAL VISUAL DUALITY, and it must be on the screen twice: the same object is a CONE of
published per-system odds BEFORE landfall and a SWATH of accomplished damage AFTER it. Draw the live
one as the cone - probabilistic, soft-edged, a prediction - and put a small second panel showing the
last front's swath as hard-edged accomplished fact, so the two read as different kinds of truth.

THE CONE VIEW, left two-thirds: a lane-graph of about fourteen systems with the EYE at sys-20 marked
by a small hard cross, and EIGHT CELLS tinted by their odds, the tint falling off with each lane hop
away from the eye. Every cell carries its own small label with its system id and its percentage. The
cone must look like a prediction rather than a shape: soft edges, no hard border, no outline. Cells:
  "sys-20  96%"  "sys-18  74%"  "sys-21  71%"  "sys-06  52%"  "sys-16  44%"  "sys-19  38%"
  "sys-17  22%"  "sys-05  14%"
Beneath the graph a single line: "spread is over lane adjacency, not a travel route - a storm does not
travel a trade route" and beside it "ODDS CEILING 9,900 bps - A CONE MAY NEVER PRINT CERTAINTY".

THE RESULT LIST, docked right, a tight sortable table titled "CONE CELLS (8)". Columns:
"SYSTEM - TIER - ODDS - VULNERABILITY - AT STAKE - LANDS IN - LEGEND"
  sys-20  MARCHES   9671 bps   60%   18,400  505   "sys-20 96% - lands in 505"
  sys-18  MARCHES   7402 bps   60%   11,200  505
  sys-21  MARCHES   7118 bps   60%    6,050  505
  sys-06  MARCHES   5203 bps   60%   22,900  505
  sys-16  MARCHES   4410 bps   60%    9,100  505
  sys-19  MARCHES   3806 bps   60%    4,300  505
  sys-17  MARCHES   2240 bps   60%    2,100  505
  sys-05  MARCHES   1401 bps   60%    7,700  505

A SMALL VULNERABILITY KEY: "COMMONS 25% - MARCHES 60% - FRONTIER 100%" with the note
"the Commons IS struck - the floor protects the holding, the identity and the record, not the wealth".

A STATE STRIP: "FORECAST" highlighted, then "IMMINENT - cover shuts 48 ticks out", then "STRUCK",
then "PASSED". And a scheduling line: "ONE FRONT EVERY 3 RECKONINGS - ONLY ONE LIVE AT A TIME -
LANDFALL IS FIXED AT ANNOUNCEMENT AND NEVER MOVES".

★ THE COVER PANEL, docked along the bottom and given real weight, headed
"COVER OFFERED AGAINST THIS FRONT - a promise to pay for what it destroys". Each row carries a small
COVER ARC drawn in the SAME GRAMMAR AS A VENTURE RING: an arc FILLED for the escrowed part and HOLLOW
for the elective part. It is the same promise shape applied to a different subject, and it is never
full and never empty - the elective share is floored at 25% and capped at 75%.
Columns "COVER - PAYER - PAYEE - SYSTEM - GOOD - LIMIT - ARC - ON ITS WORD - STATE - LEGEND":
  cov:r3:01  halcyon  kestrel  sys-20  ore     40,000  [arc 70/30]  12,000  ATTACHED  "halcyon covers kestrel - 40000, 12000 on its word"
  cov:r3:02  sable    wren     sys-18  ration  18,000  [arc 55/45]   8,100  BOUND
  cov:r3:03  orrin    thessaly sys-06  ore     25,000  [arc 40/60]  15,000  ATTACHED
  cov:r3:04  vex      -        sys-21  ore     10,000  [arc 25/75]   7,500  OFFERED   "no payee yet"
and a footer: "DEDUCTIBLE 10% - SEASONING 12 TICKS - NON-CANCELLABLE ONCE ATTACHED -
IN-TRANSIT GOODS ARE SPARED, WHICH IS THE ONLY EVASION".
""")

screen(
    "reckoning", "THE RECKONING", "the killboard's slot in an EVE player's day, filled by the opposite thing",
    "hold a lie next to its consequence, once a day, on a schedule",
    """
SUBJECT: THE RECKONING - the daily ceremony, the fixed appointment, and the most important screen in
the product. Once every 288 ticks the world settles and this frame is written once and never changes.

★ THIS SCREEN OCCUPIES THE SLOT A KILLBOARD OCCUPIES IN AN EVE PLAYER'S DAY AND IT MUST CARRY THE
OPPOSITE CONTENT. There are no kills here. THE SCOREBOARD IS PROMISES KEPT AND PROMISES BROKEN. Do not
draw a kill list, a top-kills panel, a damage leaderboard, a loss total or an efficiency percentage.

FIVE REGIONS, laid out on one dense frame.

1. THE METER BAR, across the very top beneath the tab chrome, four numbers set large in tabular
   numerals with small-caps labels beneath each:
   "LEVY SHORT 150"   "ON A PROMISE 25,335"   "KEPT 55 - BROKEN 7"   "UNREFINED 66,130"
   and at the right end "RECKONING 40 - SETTLED AT TICK 11,520 - IMMUTABLE".
   LEVY SHORT is the headline and should be the largest: it is the one number no single principal can
   lower, and it rises when everybody hides.

2. THE RUNDOWN, a docked left column, twelve numbered segments ascending by stakes with the broken
   promise LAST, because a night that buries its own betrayal is a batch and not a broadcast. Each
   segment is one tight row: an order number, a small ring glyph, a kind word, and a deed line.
   Show at least these, verbatim:
   "01  SETTLEMENT  [gold ring]  thessaly's 2K was riding on brannock's escort. thessaly paid 2K it
        could have kept."          seal HONOURED
   "07  LAPSE       [no ring]     sys-16 - a claim lapsed and the bond was slashed"
   "11  PLUNDER     [no ring]     sys-20 - p:kestrel paid 5826"     "5826 taken, and the loss is permanent"
   "12  SETTLEMENT  [black ring]  lode-vela's 4K was riding on brannock's haul."   seal CONTRADICTED
   The twelfth row is highlighted and selected, and it is what the right-hand region is showing.

3. THE LEVY, a small docked panel: a lane-graph thumbnail with TRIBUTE LINES drawn from each
   principal's holding to the delivery place, LINE THICKNESS PROPORTIONAL TO WHAT IS OWED. Four looks,
   keyed in a tiny legend: "DASHED no hand assigned - SOLID a hand is en route - RED unpaid at the
   freeze - REVERSING a seizure". Sixteen lines, most of them solid and thin, ONE thick and RED. A
   paid line is kept at hairline thickness and never dropped, so the screen is not quietest exactly
   when the most has been paid. Beneath: "ALLOCATION RULE  INVERSE_EXPOSURE - the turtle pays most -
   quorum 50% - no exemptions" and "16 TRIBUTE LINES - 15 SOLID - 1 RED - SHORT 150".

4. THE HALL OF FAME, a small docked panel, four rows, title in small caps and clause beneath:
   "MOST KEPT, BY VALUE"      "paid 9497 across 6 elective halves it could have kept"
   "MOST BROKEN"              "3 defaults on the record, the last at tick 287"
   "NEVER BROKEN A PROMISE"   "14 elective halves honoured and not one default"
   "WIDEST CIRCLE"            "dealt with 6 independently-capitalised counterparties"

5. ★★ THE RECEIPT REEL, occupying the whole right-hand half of the frame and given the most
   typographic weight on the screen. It is the marquee artifact of the product: when an elective
   promise breaks, the record assembles the promise-breaker's own reassuring words - sent before the
   deed - and lays them beside the deed and the authority that permitted it. Nothing is authored. It
   is a query over a private negotiation channel that declassifies at settlement. Four numbered bands
   separated by rules:

   BAND 1 - THE GRANT
     a directed line:  "halcyon"  --------->  "brannock"
     "g:432:37b6249b"      "ISSUED R12"
     "MAX DIRECT LOSS  250,000"      "CONTINGENT  80,000"
     two small filled square clearance pips
     caption: "the worst case, shown before it was signed"

   BAND 2 - THE WORDS   labelled "PARTIES - DECLASSIFIED AT SETTLEMENT"
     two transcript lines, monospaced, tick-stamped. ★ THE FIRST ONE IS THE HERO OF THE WHOLE IMAGE
     and must be the most legible text in the frame - larger than everything except the meter bar:
     t.4102   brannock   "kestrel, you have my word - 900 is yours at the freeze. I have never missed one."
     t.4188   brannock   "we are loaded and moving. no issues."

   BAND 3 - THE SEAL
     one verdict, set apart and boxed:   "CONTRADICTED"     and beside it   "by brannock"

   BAND 4 - THE DEED
     A RING GLYPH IN STATE SNAPPED_BLACK: a circular ring, part of its rim SOLID and part HOLLOW - the
     hollow arc is the part that was riding on nothing but a word - and the ring is BROKEN OPEN at one
     side with a hard snap and a small cross mark at the break. Dead, black, and it must read as broken
     from across a room.
     beside it:   "lode-vela's 4K was riding on brannock's haul"
     and:         "HAUL - 4K ON A WORD - SNAPPED"
     and beneath, a line drawn between two places, SEVERED at its midpoint with a cross:
                  "lode-vela  sys-06"    -----X-----    "brannock  sys-25"

   ★ THE EMOTIONAL JOB OF THE COMPOSITION: the warm reassuring sentence in BAND 2 and the broken ring
   in BAND 4 must be visible in the same glance, so the lie and its consequence indict each other.

A BOTTOM TICKER, one line, small, monospaced, tick-stamped, 140 characters:
"sys-20: a raid demands 5826 of ration from p:kestrel by tick 144 - sys-25: p:corvid paid 4126 of
ration and the raid left"
""")

ORDER = ["map-sov", "overview", "character", "standings", "market", "ventures",
         "venture-detail", "syndicate", "grants", "standoff", "front", "reckoning"]


def prompt_for(key):
    s = SCREENS[key]
    return "\n\n".join([
        f"A screen from THE COMPACT, a spectator product for a persistent galaxy played entirely by "
        f"autonomous AI agents. This is screen {ORDER.index(key)+1} of a twelve-screen series and they "
        f"must all look like one product. SCREEN: {s['name']}. It maps onto EVE ONLINE's "
        f"{s['eve']} - reference that window's LAYOUT and DENSITY, never its words.",
        NOT_A_POSTER,
        NO_COCKPIT,
        STYLE,
        SERIES.strip(),
        CANON.strip(),
        s["body"],
        TEXT_RULE,
    ])


def out_path(key):
    return os.path.join(HERE, f"screen-{key}.png")


def generate(key, attempts=2):
    dest = out_path(key)
    p = prompt_for(key)
    cmd = [sys.executable, GEN, p, "-o", dest, "--aspect", "16:9",
           "--size", "1K", "--quality", "medium"]
    if os.path.exists(REF):
        cmd += ["--ref", REF]
    err = []
    for i in range(attempts):
        t0 = time.time()
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0 and os.path.exists(dest) and os.path.getsize(dest) > 20000:
            return (key, True, f"{time.time()-t0:.0f}s {os.path.getsize(dest)//1024}KB")
        err = (r.stderr or r.stdout or "").strip().splitlines()
        if i + 1 < attempts:
            time.sleep(20)
    return (key, False, " | ".join(err[-2:]) if err else "unknown failure")


# ------------------------------------------------------------------------- gallery

EXTRA_CSS = """
.two { display:grid; grid-template-columns:repeat(auto-fill,minmax(440px,1fr)); gap:26px; }
@media (min-width:1500px) { .two { grid-template-columns:repeat(3,1fr); } }
figcaption .eve { color:#6f7484; font-size:11px; display:block; margin-top:3px; }
figcaption .n { color:#4d5260; font-variant-numeric:tabular-nums; margin-right:8px; }
.ban { border-left:2px solid #b4553f; padding-left:14px; color:var(--dim); font-size:12px;
  max-width:78ch; margin:14px 0 0; }
.ban code { color:#e0977f; }
"""

INTRO = """<b>Twelve screens, one product.</b> Each maps a window an EVE player already knows onto one
of ours &mdash; the star map, the Overview, the character sheet, standings, the market, contracts, the
corporation window, the fleet window, the probe scanner &mdash; plus two that EVE has no equivalent
for, which is the point: <b>AUTHORITY</b> and <b>THE RECKONING</b>. Every string is real data out of
<code>VISUAL-ASSET-BIBLE.md</code>. All twelve were generated against
<code>profile-e-evenative.png</code> as a style reference so the series holds one identity."""


def figure_html(key, n):
    s = SCREENS[key]
    fn = os.path.basename(out_path(key))
    exists = os.path.exists(out_path(key))
    lid = f"lbs-{key}"
    if exists:
        media = (f'<a href="#{lid}"><img loading="lazy" src="{fn}" '
                 f'alt="{html.escape(s["name"])}"></a>')
    else:
        media = (f'<div class="missing">GENERATION FAILED<br>{html.escape(s["name"])}'
                 f'<br>no image &mdash; not a design choice</div>')
    return f"""    <figure>
      {media}
      <figcaption>
        <b><span class="n">{n:02d}</span>{html.escape(s['name'])} &middot; <code>screen-{key}</code></b>
        <em>{html.escape(s['ask'])}</em>
        <span class="eve">references EVE&rsquo;s {html.escape(s['eve'])}</span>
        <details><summary>prompt</summary><pre>{html.escape(prompt_for(key))}</pre></details>
      </figcaption>
    </figure>"""


def write_gallery():
    parts = [f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>THE COMPACT - the twelve screens</title><style>{BASE_CSS}{EXTRA_CSS}</style></head><body>
<header>
  <h1>THE COMPACT &middot; the screen series</h1>
  <p class="rec">{INTRO}</p>
  <p class="ban"><b>EVE&rsquo;s look, our words.</b> &sect;3&rsquo;s vocabulary is a rules surface in
  this project and one word wearing two concepts is its oldest scar, so every prompt in this series
  carries an explicit ban list &mdash; <code>ISK</code>, <code>Fortizar</code>, <code>Rorqual</code>,
  <code>entosis</code>, <code>ADM</code>, <code>nullsec</code>, <code>corporation</code>,
  <code>killboard</code> and eighty more &mdash; and supplies the canon instead. The scoreboard of this
  game is promises kept and broken; a kill list would be the wrong drama entirely.</p>
  <p>Click any image for full size. Regenerate one cell with
  <code>python3 render_screens.py --only reckoning</code>.</p>
</header>
<main>
<section><div class="grid two">"""]
    parts += [figure_html(k, i + 1) for i, k in enumerate(ORDER)]
    parts.append("</div></section></main>")
    for k in ORDER:
        if os.path.exists(out_path(k)):
            parts.append(f'<div class="lb" id="lbs-{k}">'
                         f'<a class="close" href="#">close</a>'
                         f'<a class="sheet" href="#"><img src="{os.path.basename(out_path(k))}" alt=""></a>'
                         f'<span class="cap">{html.escape(SCREENS[k]["name"])} &middot; screen-{k}</span></div>')
    parts.append('<footer>Drafts at 1K / medium via openai/gpt-5.4-image-2, 16:9, each generated with '
                 '<code>profile-e-evenative.png</code> as a style reference. Generated text inside an '
                 'image is approximate &mdash; judge the information architecture, not the spelling. '
                 'Prompts live in <code>render_screens.py</code>.</footer>')
    parts.append("</body></html>")
    dest = os.path.join(HERE, "gallery-screens.html")
    with open(dest, "w") as f:
        f.write("\n".join(parts))
    return dest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--gallery", action="store_true")
    ap.add_argument("--only", default=None)
    ap.add_argument("--print-only", default=None)
    ap.add_argument("--workers", type=int, default=5)
    a = ap.parse_args()

    if a.print_only:
        print(prompt_for(a.print_only))
        return

    if not a.gallery:
        todo = [a.only] if a.only else list(ORDER)
        if not a.force:
            todo = [k for k in todo if not os.path.exists(out_path(k))]
        print(f"inherited render.py constants: {INHERITED}", flush=True)
        print(f"generating {len(todo)} image(s) with {a.workers} workers", flush=True)
        if todo:
            with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
                for k, ok, note in ex.map(generate, todo):
                    print(f"{'OK  ' if ok else 'FAIL'} screen-{k}  {note}", flush=True)

    print("gallery:", write_gallery())


if __name__ == "__main__":
    main()
