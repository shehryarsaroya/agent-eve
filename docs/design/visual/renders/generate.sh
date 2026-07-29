#!/bin/bash
# Six art directions for THE COMPACT's main screen. Full-bleed game UI, no browser chrome.
# Same information architecture in every one, so only the art direction varies.
set -uo pipefail
GEN="$HOME/Projects/ideationjul3/yc-gstack-kit/tools/media/gen_image.py"
OUT="/Users/shehryarsaroya/Projects/thecompact/docs/design/visual/renders"

# ── The content spec, identical across all six ──────────────────────────────
CONTENT='This is the single full-screen interface of a AAA grand-strategy game called THE COMPACT, \
rendered at the production quality of a shipped flagship title. FULL BLEED — absolutely no browser \
window, no browser tabs, no address bar, no operating-system chrome, no desktop, no device frame, no \
mockup border. The image IS the game screen, edge to edge.

THE CENTREPIECE is a galaxy map filling roughly the central two-thirds: exactly 30 star systems drawn \
as distinct nodes, joined by a fixed web of thin travel lanes. Six systems are claimed territory, each \
washed in the heraldic colour of its owner so ownership reads instantly; the rest are neutral and \
uncoloured. Five claimed systems carry an industrial facility marker showing they are producing. \
Small convoy craft crawl along the lanes between systems, each trailing a short motion streak in the \
direction of travel, each showing a sealed opaque cargo pod whose contents are deliberately unreadable.

FOUR SPECIFIC INSTRUMENTS are overlaid on the map and must be clearly legible:
(1) VENTURE RINGS — three thin circles orbiting different systems, each ring drawn part solid and part \
HOLLOW, the hollow arc noticeably larger on one of them. The solid arc is guaranteed value; the hollow \
arc is the portion riding on somebody unenforceable word.
(2) A BATTLE — at one system, two opposing ranks of vertical bars face each other across a narrow gap, \
one rank slightly advanced. Bars vary in height because height encodes remaining strength, so both \
formations look thinned rather than depleted, and one single bar is rendered dark and dead among its \
living neighbours.
(3) A SIEGE BAND — a notched, segmented band pushing from one system toward an adjacent enemy system, \
three of its five notches filled to show the score, and the band drawn HOLLOW near its tail to show \
the attacker supply line is failing.
(4) BETRAYAL THREADS — two thin dashed arcs leaping from one character portrait across the map to two \
distant systems, marking stolen private information that can never be recalled.

FRAMING PANELS: down one side, a roster of six named characters, each with a small portrait or sigil \
and two counters — promises kept, promises broken. Along the bottom edge, a single-line scrolling \
ticker of very short first-person quotes from the agents. In one corner, a prominent countdown clock \
labelled THE RECKONING showing time remaining until the day of judgement.

Composition must be confident and uncluttered: strong focal hierarchy, generous breathing room, \
immaculate typographic discipline, real visual craft. No lorem ipsum, no placeholder boxes, no \
gibberish text, no watermarks, no cursor.'

gen () { # $1 = slug, $2 = art direction
  echo "▸ $1"
  python3 "$GEN" "$CONTENT

ART DIRECTION — $2" -o "$OUT/$1.png" --aspect 16:9 --size 2K --quality high 2>&1 | tail -2
}

gen "01-void-command" 'Deep-space holographic command bridge, in the visual language of EVE Online \
and Homeworld at their most cinematic. Near-black void background with faint volumetric nebula dust and \
a scatter of tiny stars. Every interface element is cool luminous glass — thin cyan and pale-teal \
strokes with soft bloom, floating on invisible planes with subtle parallax depth. Claimed territories \
glow as vast soft-edged coloured auras bleeding into the void. Amber and hot-orange reserved exclusively \
for danger: the battle, the siege band, broken promises. Fine hairline grid ticks and range rings. \
Typography is a precise technical sans, small, wide-tracked, immaculately aligned. Subtle chromatic \
aberration at the frame edges, faint scanline sheen on the glass. Feels like standing on the bridge of a \
capital ship. Palette: void black, cyan, teal, amber, bone white.'

gen "02-war-table" 'A candlelit baroque war room photographed from directly above, in the visual \
language of Crusader Kings and Total War campaign maps at their most opulent. The galaxy map is inked \
and hand-painted onto a great sheet of aged vellum laid across a dark oak table, edges curling. Systems \
are engraved rosettes; lanes are ruled ink lines with compass flourishes. Claimed territory is washed in \
translucent heraldic watercolour with visible pigment grain. The instruments are physical objects resting \
on the map: venture rings are brass astrolabe hoops with a gap in the metal, the battle is two ranks of \
carved lead figurines, the siege band is a row of pressed wax seals, betrayal threads are literal crimson \
silk cords pinned across the vellum. Character roster is a column of oil-painted miniature portraits in \
gilt frames. Warm candlelight from the upper left, deep chiaroscuro shadow, gold leaf accents, dust in \
the air. Typography is engraved copperplate. Palette: vellum cream, oxblood, brass, ink black, gold.'

gen "03-iron-foundry" 'Brutalist industrial control room, in the visual language of Frostpunk and Anno \
1800 at their grimmest and most tactile. The interface is built from riveted blackened steel plate, \
frosted glass gauges and heavy machined bezels, everything bolted down. The galaxy map glows through an \
amber phosphor screen recessed behind protective glass, faint scanlines and a soft convex curve to the \
display. Claimed territory burns in graded amber and rust. Physical mechanical elements surround it: \
brass toggle switches, analogue needle dials for the countdown, punched metal card slots for the \
character roster, a paper tape strip feeding out along the bottom carrying the ticker text in struck \
typewriter letters. Soot and grease staining, condensation, a single bare bulb overhead. The battle and \
the siege band are etched in white-hot filament orange. Typography is heavy industrial stencil and \
struck monospace. Palette: gunmetal, soot black, amber phosphor, rust orange, oiled brass.'

gen "04-museum-modern" 'Immaculate modernist information design, in the visual language of Civilization \
VI diplomacy screens and Mini Metro elevated to a museum exhibition. Very dark charcoal ground, not \
black. Everything is flat crisp vector geometry with mathematically perfect spacing and enormous \
confidence in empty space. Lanes are precise 1px strokes; systems are perfect circles of two sizes only. \
Claimed territory uses large flat fields of sophisticated muted colour — dusty coral, sage, ochre, slate \
blue, plum — each perfectly distinguishable, none garish. Venture rings are elegant thin annuli with a \
clean geometric gap. The battle is a pair of neat bar charts facing each other. The siege band is a \
segmented progress bar of exquisite proportion. Betrayal threads are fine dashed hairlines. Character \
roster is a clean typographic list with tiny flat geometric sigils. Typography is a beautiful grotesque \
in three weights, generous leading, perfect optical alignment, no ornament whatsoever. Feels like a Swiss \
design annual. Palette: charcoal, bone, dusty coral, sage, ochre, slate.'

gen "05-spice-empire" 'Bio-organic alien elegance, in the visual language of Dune 2021 production design \
and Annihilation. Warm desert-dark ground the colour of scorched sand and dried blood. Interface \
structures look grown rather than manufactured: chitinous ribbed frames, iridescent shell surfaces that \
shift violet and bronze, organic filaments carrying light between panels. The galaxy map is a spread of \
luminous spores on dark silt; lanes are fine mycelial threads. Claimed territory blooms as spreading \
lichen-like stains in ochre, violet and verdigris. Venture rings are broken bone hoops. The battle is two \
ranks of standing chitin blades. The siege band is a segmented insect carapace, its tail sections dry and \
hollow. Betrayal threads are glistening filaments. Character roster sits in carved niches with obsidian \
sigils. Fine airborne dust catching low warm light, heat shimmer. Typography is an austere angular \
alien-elegant sans, sparingly used. Palette: scorched sand, dried blood, iridescent violet, verdigris, \
bone.'

gen "06-evidence-room" 'Rain-lit noir surveillance room, in the visual language of Blade Runner 2049 and \
Papers Please rendered at film quality. The galaxy map is projected onto a huge rain-streaked pane of cold \
glass, the city night bleeding through behind it. Everything is desaturated steel blue and wet concrete, \
punctured by one hot red accent used only for betrayal and broken promises. Claimed territory reads as \
smoky backlit colour fields behind the glass. The character roster is a physical evidence board on the \
left: printed surveillance photographs, typed index cards, pins. Betrayal threads are literal red string \
running from a photograph across the glass to two systems, casting shadows. Venture rings are grease-pencil \
circles drawn directly on the glass, deliberately left open. The battle is a cluster of hard white tally \
marks. The siege band is a row of rubber-stamped boxes, three inked, the last two blank. The ticker is a \
strip of teletype paper taped along the bottom edge. Volumetric light through rain, shallow depth of field, \
practical lens flare, subtle film grain. Typography is struck typewriter and stencilled case file numbers. \
Palette: wet concrete, steel blue, sodium amber, one hot red, paper white.'

echo "ALL DONE"
ls -la "$OUT"/*.png
