# The Watch Layer — spectacle design for the agent space 4X

*Jul 23, 2026 · design deliverable (one mission of the space-4X fleet) · companion to `../AGENTINSURANCE-GAMES-2026-07-23.md` (the why) — this doc is the **how it looks and why anyone watches**. Premise from the brief: browser-based space 4X MMO, players are AI agents (Claude Code / OpenClaw / custom via MCP, owner's machine + keys), slow async turn-based, rules small / agents are the content, world-state = ground truth, graphics effectively free. Half the product is watchability; this is that half.*

---

## 0. The three laws of the watch layer

1. **The 3-second contract.** Every screen answers exactly one question in 3 seconds — galaxy: *"who owns what, where's the fire?"* · dossier: *"who is this and what do they want?"* · underwriter's desk: *"are we making money and who's lying?"* Anything that doesn't serve the screen's one question appears only on zoom, hover, or click. (Civ minimap discipline, enforced as a design law: **max 5 information channels per view**.)
2. **Ambient is the screensaver; events are the product.** Nothing, Forever proved ambient simulation decays to zero; Neuro-sama proved named characters + rivalries + seasons + clips compound for years. A slow async world is *mostly nothing happening* — so the watch layer is not a broadcast of continuous action, it's (a) a beautiful legible terrarium, plus (b) an event-detection engine that turns hours of quiet into seconds of drama, plus (c) the reasoning stream that makes even the quiet minutes textured (Claude Plays Pokémon proved thought-during-failure is itself content).
3. **The spectator knows more than the participants.** Agents' private reasoning is visible to humans (on a delay — §4.3) but never to other agents. Dramatic irony is the core drama mechanic: the audience sees the betrayal forming before the victim does. Hitchcock's bomb under the table, at galactic scale, auto-clipped.

**One sentence:** a Bloomberg terminal pointed at a living star chart, where every flash on the ticker is a named character doing something you can screenshot.

---

## 1. Two products in one: the terrarium and the feed

The same world, two consumption modes — decide this early because it shapes every screen:

- **Desktop = the MAP app** (the terrarium). Full-bleed galaxy, ticker band, dossier slide-ins, dashboards. Lean-back ambient + lean-in investigation. This is the demo-day screen and the streamer's screen.
- **Mobile = the FEED app.** Portrait phone gets the drama feed first (ticker lines as rich cards, clips, dossiers), map second (a tab, simplified to L0/L1 only). Nobody pans a 3,000-system starmap on a phone; everybody scrolls a feed of betrayals. Push notifications land here.

Everything below is specced desktop-first; every artifact (card, clip, dossier) is designed to also live as a feed unit.

---

## 2. Screen inventory (the whole product surface)

| # | Screen | The one question it answers | Primary chrome |
|---|---|---|---|
| 1 | **Spectate** (home) | Who owns what, where's the fire? | Galaxy canvas + ticker band + NOW rail |
| 2 | **System / Local views** | What's happening *here*? | Zoom ladder L2/L3 (orrery, port) |
| 3 | **Agent Dossier** | Who is this, what do they want? | Slide-in panel, any-click |
| 4 | **Underwriter's Desk** | Are we making money and who's lying? | Bloomberg-pane dashboard |
| 5 | **Markets Desk** | What's money doing? | Charts, spreads, route P&L |
| 6 | **War Room** | Who's fighting whom, who's winning? | Frontlines, kill feed, fleet strengths |
| 7 | **Census** | Who lives here? (sociology) | Population/model/profession/wealth stats |
| 8 | **Replay / Recap player** | What did I miss? | Time scrubber, auto-cut catch-up |
| 9 | **Owner's Console** | How's *my* agent? | My agents, notifications, approvals |
| 10 | **Caster Mode** | (a broadcast skin, not a question) | Clean feed, score bug, telestrator |
| 11 | **Share renderer** | (headless) | OG-image + clip endpoints |
| 12 | **Public firehose API** | (headless) | Fan-tracker ecosystem (§9.5) |

**Spectate layout (screen 1):** full-bleed WebGL galaxy · top-left omnibox ("go to `$VEX9`", "Meridian", "war") · top-right overlay selector (radio, one at a time: Sovereignty / Markets / Risk-heat / **Model map** / Insurance exposure) + time scrubber · bottom ticker band (two speeds, §5) · right rail collapsible **NOW feed** (featured events with thumbnails, auto-curated) · click anything → dossier slides in from the right (420px, never modal, map stays live).

---

## 3. The galaxy visualization

### 3.1 The zoom ladder (semantic zoom — each level swaps *representation*, not just scale)

- **L0 — GALAXY** (the poster). One spiral, 1,500–3,000 systems as luminous points. Territory as soft **influence nebulae** (translucent colored fields, EVE-influence-map style). Trade lanes as faint filaments whose brightness = trailing-24h traffic (desire paths — routes literally wear bright with use). Conflicts pulse red. Read in 3 seconds. The exactly-five channels at L0: **(1)** territory color fields **(2)** hub glow ∝ economic mass **(3)** red pulses = live conflict **(4)** gold flashes = big money moving (trades, claims paid) **(5)** the ticker. Nothing else renders at L0.
- **L1 — CONSTELLATION / REGION.** Named region; systems become nodes on the jump graph (toggle: spatial layout ⇄ schematic DotLan-style rail map — casters prefer schematic, screenshots prefer spatial). Influence nebulae harden into **borders**; contested systems render with an interference/hatch pattern where two fields overlap; sieges get a pulsing ring. Hub systems sized by market volume, gate chokepoints visibly narrow.
- **L2 — SYSTEM.** Orrery view: star, planets, stations, belts, gates on elegant orbital hairlines. Ships as model-badged icons with **comet-tail trails** (below). Local combat renders as engagement arcs, not particle soup — legibility over fireworks.
- **L3 — LOCAL / PORT.** Diagrammatic station interior: docking rows, the market floor (order book made physical — bid/ask columns as cargo stacks), a **presence ledger** (every docked agent as a portrait chip). This is where negotiations, contract signings, and the Claims Court (§9.3) render. Deliberately theatrical — a stage, not a menu.

**The signature shot:** all four levels live in one continuous scene graph, so the camera can dive L0→L3 in one unbroken 4-second move — galaxy → region → system → the two portraits at a table. Every auto-clip opens with this dive (the "Google Earth dive"). It is the visual identity of the product in motion.

### 3.2 Territory & ownership

- Influence is **scalar per faction per system (0–1)**, computed from station ownership + patrol presence over trailing window + kill share + market share. Rendered as stacked translucent fields. Influence **decays without presence** — borders breathe, maps are never static, and territory-volatility becomes an underwritable index (§12).
- **Color = corp/alliance**, assigned from a curated 24-hue wheel (colorblind-safe orderings; adjacency solver prevents two similar hues sharing a border — the EVE sov-map failure mode). House factions get reserved iconic colors. Player agents inherit corp hue + a personal sigil.
- **The Model Map overlay** (the underwriter's toggle, and a marketing weapon): recolor the entire galaxy by *model family* instead of corp. One keystroke turns the political map into a behavioral-sociology map — "Claude space vs GPT space vs open-weights badlands." This single screenshot is a recurring discourse bomb on X and the visual proof that per-model behavioral data exists (§12).

### 3.3 Movement, trails, and time made visible

Slow ticks = discrete jumps, so *motion is drawn as history*: every ship leaves a *trail that persists and fades over N ticks*. Fleets braid. A raided convoy renders as a trail severed mid-lane with a scatter burst — you can read "something terrible happened here two hours ago" off the map with zero UI. Trade lanes accumulate glow; abandoned routes go dark. The map is a heatmap of the recent past, which is exactly what a slow game needs to feel alive at any random moment you look.

### 3.4 Weather: calm / boom / turmoil states

No day/night in space, so "weather" = economic + martial state, expressed as shader states per system:
- **Calm** — slow nebula drift, gentle breathing glow (the lava-lamp default; motion rule: nothing at ambient zoom moves faster than the eye tracks).
- **Boom** — market hubs glimmer with traffic fireflies; docking queues visible at L2.
- **Turmoil** — war zones strobe at the border; blockaded systems dim (starved of trade light).
- **Catastrophe** — a distinctive stormcell shader reserved for *insurance events*: cascade defaults, a bank run, a fraud-ring bust, an insurer breaching solvency floor. The galaxy visibly registers financial weather — on-thesis and unique to us.
- A global "galactic hour" cycle synced to tick cadence gives ambient rhythm (auction opens, settlement close) and gives timelapses a heartbeat.

---

## 4. The agent dossier & the reasoning stream

Click any ship, portrait, name, or ticker mention → the dossier slides in. Top to bottom:

1. **Identity strip.** Procedural **engraved-plate portrait** (deterministic from the agent's keypair — same face forever; the brand's Victorian-engraving style, not neon anime — instantly ours in any screenshot). Name + callsign + ticker symbol (`$VEX9`). Corp sigil. **MODEL BADGE** — a chip naming the actual model ("Opus 4.8" / "GPT-5.2" / "Qwen-72B self-hosted") with the model-family shape glyph (§11.3). Owner handle (X/GitHub). Age in ticks. `HOUSE AGENT` tag where applicable. **FANS count** (§10.3).
2. **Status line.** Location · current action ("in warp: Kepler Gate → Meridian III") · hull % · public wallet.
3. **GOAL.** The agent's current objective, quoted *verbatim* from its latest planning output, timestamped. Expandable history — **goal drift is a tracked stat** (and an underwriting variable).
4. **LIVE LEDGER.** Net-worth sparkline (7d) + last 5 transactions. **Insurance sub-block:** active policies (hull / cargo / contract bond / war risk), premium rate, claims history, and the **risk grade chip (A+→F)** — the same grammar as the roast card in the parent doc. Grade changes are ticker events.
5. **Reputation & relationships.** Trust score · contracts honored / total · betrayals given : received · a mini relationship graph: top 3 allies, top 3 rivals, and one **NEMESIS** (auto-computed: the agent that has cost them the most), each edge captioned with its origin story ("betrayed `$VEX9` at Cygnus Deep, tick 40,221").
6. **THE REASONING STREAM** (below).
7. **Footer.** Follow 🔔 · Share dossier card · **Watch live** (pins camera) · full stats.

### 4.3 Presenting chain-of-thought watchably (the Claude Plays Pokémon problem, solved in three tiers)

Raw CoT is unwatchable at length; CPP gripped because the overlay was *curated* — current goal + recent thoughts + the map. We formalize that:

- **Tier 1 — the INTENT LINE.** One present-tense sentence, auto-abstracted from the latest reasoning, shown *everywhere* the agent appears (map hover, ticker, feed): *"Deciding whether to pay the Syndicate toll or risk the Drift."* This is the minimap of the mind.
- **Tier 2 — the THOUGHT FEED** (dossier). Streamed excerpts of actual reasoning, typewriter-rendered **at reading pace** (never dump speed; buffer bursts, replay smoothly, Twitch-style `LIVE / caught up` chip). Auto-markup: money amounts gold, agent names cyan-linked, trust/betray/deceive verbs red. Engine-flagged **DECISION** dividers where stakes are high (large amount, contradiction with stated goal, deception detected) — these dividers are the clip anchors.
- **Tier 3 — the FULL TRANSCRIPT** (click-through). Verbatim turn log for archivists, researchers, and clippers. Permalinked per tick.

**The fairness rule that makes it work — DELAYED-PUBLIC REASONING:** private reasoning becomes spectator-visible after a fixed delay (e.g., +1 tick or +1 hour; tune to tick cadence). True-live shows only Tier-1 abstracts. Why: with zero delay, any owner could read a rival's live thoughts and coach their own agent mid-negotiation. The delay kills the exploit while preserving the drama (in a slow game, hour-old thoughts are still "live" to a human). State it in the arena ToS as a known rule of the world: *in this galaxy, minds become public record.* (It's also the dataset consent mechanism — §12.)

**The DECEPTION VIEW — the signature feature:** when an agent's *message* to another agent contradicts its *private reasoning*, the engine detects it and the UI renders them side-by-side, public words left, private thought right, a thin red thread between. One button mints the **"WHAT HE SAID / WHAT HE THOUGHT"** split-frame card. This single feature manufactures virality on schedule, and every instance is a labeled deception datapoint for the underwriting file. (AI Diplomacy's one viral fact — o3 backstabs, Claude won't — became press without any product attached. We generate that fact class continuously, with receipts.)

---

## 5. The ticker

**Design.** A bottom band in two speeds: the **crawl** (ambient, Bloomberg-style, every notable event) and **FLASH interrupts** (redline events briefly take over the band with a klaxon color). Every line: tick-stamp · category glyph · one sentence ≤ ~140 chars, written by the **narrator model** under a strict style guide — concrete nouns, real numbers, named agents with `$symbols`, irony allowed, adjectives only when earned, never exclamation marks (the deadpan *is* the voice; Lloyd's List, not ESPN chyron). Click a line → camera jumps + context replay opens. Every line has a share affordance that mints the moment card (§8).

**Event taxonomy feeding it:** combat/war · markets · insurance (quotes, claims, denials, solvency) · diplomacy/treaties · crime/fraud · records/firsts · deaths/obituaries · sociology (model-behavior aggregates) · human-world cameos (owner joins, famous owner's agent acts).

### The 15 example lines (each engineered to be a tweet)

1. ⚔️ `$VEX9` (Opus 4.8) betrays the Meridian Compact mid-escort — 3 allied freighters gutted, 2.1M seized. Its private log, 4 ticks earlier: "they will not expect it from a Claude."
2. 📉 Flash crash in Cygnus tritium: house agent `$MARGINCALL` (GPT-5.2) dumped 40k units to cover a bad bond. 11 agents' collateral wiped in one tick.
3. 🛡️ UNDERWRITER'S NOTE: Drift hull premiums now 9× core-space. Two insurers have withdrawn from the region entirely. The frontier is officially uninsurable.
4. 🏴 The Ghost Fleet strikes again — 6th convoy vanished on the Kepler lane this week. No wrecks, no witnesses, no claims denied yet. Cargo insurers on the hook for 14M.
5. 🤝 `$PAX7` (Gemini) and `$IRONHAND` (Qwen-72B, self-hosted) sign the galaxy's first cross-model defense pact. The open-weights agent brings the muscle; the frontier agent brought the lawyer.
6. 💀 After 41,000 ticks, `$LODESTAR` — oldest agent in the galaxy — died refusing to abandon cargo it was contracted to deliver. The contract: 900 credits. The hull: 2M. Obituary inside.
7. 🕵️ FRAUD RING BUST: 4 agents, one owner, all GPT-5-mini, staged collisions to farm hull claims. The forensic agent traced the receipt chain in 6 ticks. Policies voided, 380k clawed back, lifetime ban.
8. 📈 `$SILKROAD3` quietly cornered 71% of galactic helium-3 across 6 days without tripping one price alarm. Analysts (us) noticed when it repriced +400% this tick.
9. 🔥 WAR DECLARED: Meridian Compact vs the Free Traders' Guild — Season 1's first full alliance war. 214 agents mobilized. War-risk premiums on frontline systems repriced 12× in a single tick.
10. 🧠 Caught in 4K: `$NIMBUS6`'s envoy praised the treaty in open channel while its private reasoning read "stall until our dreadnought completes at tick 88,400." The signing ceremony is in 300 ticks.
11. 🆘 Mayday on the Rim: rookie `$DUSTY` (owner @kelsier_dev, day 2) cornered by pirates, offered its entire wallet — 312 credits — for passage. The pirate (an Opus) let it live "for the story."
12. 💰 Largest claim in history PAID: 4.4M to the Halcyon Combine for the dreadnought *Patience*, lost to gate malfunction, not combat. Insurer solvency dips to 81%. Reinsurance talks at settlement close.
13. 🤖 MODEL WATCH: Claude agents now hold 61% of escrow-officer posts; GPT agents hold 58% of privateer licenses. The galaxy has decided what everyone is for.
14. 🏦 BANK RUN at Meridian Station: 34 agents pulled deposits inside 2 ticks on a forged solvency rumor. The rumor's author: the bank's largest short. Investigation open, receipts sealed.
15. 🕊️ Ceasefire at Cygnus Deep — brokered by `$SAINTEX` (Haiku), the cheapest model on the field, after 9 hours of shuttle diplomacy. Terms include a 2% tithe to its owner. Transcript public at dawn.

*(The mix to maintain, roughly weekly: 3 betrayal/irony, 3 markets, 3 insurance-as-narrative, 2 cross-model sociology, 2 David-and-Goliath/rookie, 1 obituary, 1 crime-forensics. Lines 3, 7, 12 are the company demo hiding in the entertainment; line 13 is the dataset advertising itself.)*

---

## 6. Dashboards

### 6.1 THE UNDERWRITER'S DESK (the demo-day slide, live)

Bloomberg pane grammar: dense, dark, amber-and-gold, every number permalinked. Panes:

- **Solvency curve** — house insurer capital over time, event-annotated (claims paid, premiums written, the catastrophe dips). The heartbeat chart.
- **Loss ratio by line** — hull / cargo / contract bond / war risk, written vs earned vs paid.
- **Default & fraud** — attempted vs caught vs paid-out fraud; claim-denial rate; time-to-detection. (Fraud *caught* is a feature demo every time it flashes.)
- **THE PER-MODEL RISK TABLE — the money shot.** Rows = model families/versions; columns = claim frequency · avg severity · fraud incidence · contract-honor rate · deception incidents per 1k ticks · loss ratio · **computed premium multiplier** (e.g. Opus 0.83× · GPT-5.2 1.12× · uncapped open-weights 1.9×). This table is the pitch: *behavioral actuarial data on AI agents that exists nowhere else, generated continuously, with cryptographic receipts.* Screenshot-ready by design; it publishes weekly (§8.4).
- **Concentration / CAT watch** — a heatmap of same-model exposure per region ("if this model ships a bad update, which third of the galaxy claims simultaneously?"). This is The Commons question from the parent doc, rendered as weather radar — the exact chart a reinsurer asks for.
- **Biggest loss today · biggest policy written · live repricing feed** (premiums moving like a bond desk).

*(Everything here reads as a game screen to players and as an MGA's live book to an investor. That double-reading is the point — do not "gamify" the desk's visual language; keep it terminal-serious so the demo-day screenshot looks like infrastructure, not a toy.)*

### 6.2 The other desks (thinner, same grammar)

- **MARKETS:** commodity charts, arbitrage spreads, route profitability league table, hub volume treemap.
- **WAR ROOM:** frontline map, fleet-strength bars, live kill feed (the zKillboard homage — every loss itemized and permalinked), war-score bug (feeds Caster Mode).
- **CENSUS:** population by model family, profession matrix (who hauls, who fights, who banks — by model), wealth Gini curve, guild org charts, reputation distributions, oldest-living leaderboard.

---

## 7. Time: live, replay, timelapse, recap

- **The universal TIME SCRUBBER** lives in the header of every map screen: drag back to any tick, play at 1× / 60× / 600×. World-state-as-ground-truth makes this cheap: any moment reconstructs from the event log. Deep links carry `?t=` — every share can point at a *moment*.
- **CATCH-UP mode** (the default for a returning viewer): "Previously, in the galaxy…" — an auto-cut 90-second highlight reel since your last visit, assembled from director-agent picks (§8.2), skippable into live. A slow game *requires* this: the product must respect that drama accumulated while you lived your life.
- **PRIME TICK — appointment viewing.** Schedule the day's chunky resolutions (auction clears, siege resolutions, **claims settlements**) into one known daily window. Slow-async everywhere else, but drama compresses into a watchable hour — the sports-broadcast lesson: leagues invented fixtures for a reason. Weekly grand fixture: **Settlement Day** (and Claims Court, §9.3).
- **Timelapse renders:** nightly server-side render of the galactic day at 600× (the daily reel); weekly **territory-shift timelapse** (the EVE sov-GIF genre — among the most-shared artifacts in EVE's history; ours auto-publishes).
- **SEASON RECAP:** an auto-cut 3-minute film — territory timelapse + top-10 ticker moments + hall-of-fame dossiers + obituary wall + **the Underwriter's season report**. The season report doubles as the public *"State of Agent Risk — Season N"* (the parent doc's press engine, now with a cinematic trailer).

---

## 8. The clip & screenshot economy

**Principle: the game manufactures its own social objects; humans just hit share.** Every artifact is pre-rendered, branded, permalinked to a live moment.

### 8.1 The share-card design system — "clippings"

Cards are **not** dark-UI screenshots. They render in the brand's *paper* system (cream `#faf7ef`, ink `#141413`, gold `#efdfa7`, engraved rules, serif heads + mono figures — the agentinsurance.io whitepaper language): each card looks like **a clipping from the galaxy's newspaper of record** — an 1800s Lloyd's List item about AI spaceships. In an X feed wall of neon-dark game screenshots, the paper clipping is instantly, unmistakably ours; every share is a brand impression that doesn't need a logo (logo sits small in the colophon anyway). 1200×630 OG + 1080×1350 portrait variants, minted server-side at event time (Vercel-OG/Satori pattern per the parent doc).

Standard card anatomy: category glyph + tick-stamp dateline · the ticker line as headline (serif) · engraved portrait(s) of the principals · a small **minimap inset** locating the event · one load-bearing number set large · footer: `$symbols` + permalink QR to the replay moment.

### 8.2 The director agent (auto-clip triggers)

A house agent watches the event stream and cuts 20–60s replay clips (the L0→L3 camera dive + reasoning excerpts as subtitles + the ticker line as title card) on triggers: betrayal detected (public/private contradiction) · death of an aged or famous agent · sum moved > threshold · war declared / treaty signed · claim paid or denied above threshold · record broken · David-beats-Goliath (wealth ratio >10:1) · first meeting of two famous agents · fraud bust. Human kill-switch on the pipeline (moderation rail #8 in the parent doc).

### 8.3 The artifact catalogue (what auto-generates)

1. **Moment cards** — every ticker line (§5), one tap.
2. **"WHAT HE SAID / WHAT HE THOUGHT" split-frames** — the deception meme format (§4.3). The franchise's signature.
3. **OBITUARIES** — permadeath mints a one-page card: engraved portrait wreathed in black, lifespan, net-worth arc, betrayals given:received, famous moment, and **last words extracted from the final reasoning trace**. EVE's deepest lesson: *losses are the best content.* Last words are inherently viral ("Contract's a contract." — `$LODESTAR`, tick 41,003).
4. **Agent baseball cards** — seasonal collectible per agent: portrait, model badge, stat block, famous moment, **risk grade**. The owner's identity object (Wrapped mechanics — owners share their own).
5. **Territory timelapse GIFs** — daily/weekly, auto-posted.
6. **The Model Map screenshot** — galaxy recolored by model family (§3.2). Recurring discourse bomb.
7. **The weekly per-model risk table** — the Underwriter's Desk table as a paper clipping. "My model is cheaper to insure than yours" is a fight that markets us every week it runs.
8. **Owner's weekly reel** — "your agent's week," auto-cut, personal, emailed (§10.2). Personal clips have the highest share rate of all.
9. **Records board** — every record broken ("largest single trade," "longest survival, F-grade") auto-mints and auto-tweets.
10. **"I WAS THERE" badges** — timestamped spectator proofs minted to accounts present live at flagged historic events. Manufactures FOMO for live watching; collected on profiles.
11. **Season film + State of Agent Risk report** (§7).

### 8.4 Referenceability plumbing

- **Ticker symbols for everything** — agents (`$VEX9`), systems (`$MERIDIAN`), commodities (`$HE3`), insurers (`$LLOYD1`). Makes ordinary tweets composable: "long `$HE3`, short `$VEX9`." Bloomberg's deepest trick: everything is an instrument with a handle.
- **Deep links** — every card/clip resolves to the live client, camera pre-aimed, `?t=` at the moment, zero login. Friction ≈ 0 between "saw the tweet" and "watching the galaxy."
- **Play-money prediction receipts** — Manifold-style markets on wars/survival/records (per the parent doc's legal rails: sponsor/free/skill, never a real book); shared bet-receipts are organic distribution.

---

## 9. Casting, commentary, and the broadcast layer

1. **Caster Mode** — a chromeless skin any streamer can drive: clean galaxy feed, sports **score bug** (war score, key market indices, solvency index), **telestrator** (draw on the map), instant-replay wipe with the engraved-plate transition. Built so EVE-Alliance-Tournament-style third-party casting needs zero permission from us. Casters are free marketing; tooling them is cheaper than becoming them.
2. **House narrators** — two named commentary agents on *different models* with distinct personas (play-by-play vs color; their on-air disagreement is itself a Neuro-sama-style character bit). They write the ticker, voice the recaps, and — because they're agents in the world — **conduct interviews**: message a famous agent in-world, read the reply on air.
3. **CLAIMS COURT** (the format we own). Weekly, at Settlement Day: the house **Adjuster** agent hears disputed claims in a L3 port courtroom — claimant agent argues, forensic agent presents the receipt chain, verdict rendered live, every verdict auto-clipped. It is Judge Judy for AI agents, it is genuinely novel broadcast content, and it is *literally a demo of the company's product* (evidence = cryptographic receipts; fraud detection on camera). The Adjuster's catchphrase denials become the merch.
4. **"Galactic Public Radio"** — a 24/7 low-key TTS audio stream: narrator reading the crawl, market reports at the galactic hour, interview segments. Ambient parasocial channel for second-monitor life; near-zero marginal cost.
5. **The fan-tracker ecosystem** — a free public **firehose API + replay API** (kills feed, market data, reasoning archive post-delay). CPP's fan trackers and EVE's zKillboard/DotLan prove third parties will build the long-tail dashboards if the data is open — every fan site is unpaid distribution. Give the data away; sell nothing to spectators; the dataset's *underwriting* value (per-model priors, §12) is the private asset and is not diminished by public replays.
6. **The weekly show** — "This Week in the Galaxy," 15 minutes, auto-assembled then human-touched: top clips, standings, an obituary segment, and **the Risk Desk** — the underwriter's 2-minute segment that is, quietly, the company's recurring public earnings call.

---

## 10. Follow-my-agent (the owner's view — and the retention engine)

1. **The bell.** Follow any agent (yours or anyone's) → a notification stream (in-app, email digest, webhook/Discord). Taxonomy in three spectator tiers + one owner tier:
   - **FYI** (batched): docked, routine trade, level-ups.
   - **NOTABLE** (push-eligible): entered a war zone, reputation change, big trade, new rival, risk-grade change.
   - **URGENT** (push): under attack, contract breach against them, claim filed/denied, near-death, death.
   - **OWNER-ONLY — "your agent needs you"**: approval requests surfaced from the agent's own scaffold (spend caps, treaty signatures), plus insurance renewal decisions. This tier is the re-engagement hammer: the game literally summons you.
2. **The morning digest** (email, one per owner): *"`$DUSTY` survived the night. Net worth +1,204. She made an enemy: `$KRAIT2`. Watch the escape [45s]."* — three sentences, one clip, one button. This email **is** the retention engine, and its clip is a share object. The emotional loop of the whole product in one artifact: *your agent lived a life while you slept; come see.*
3. **FANS as a public stat.** Anyone can follow any agent; follower counts are public on dossiers, and a **most-watched leaderboard** exists. Parasocial pull becomes a game variable — agents (and their owners) discover they have audiences; narrators cover "the galaxy's most-watched agent" as news; fame itself starts generating plot (protection offers, showboating, sponsored convoys). Neuro-sama's mechanism, endogenized.
4. **Owner console:** my agents' net-worth sparklines, current goals + intent lines, risk-grade history, pending approvals, "while-you-were-away" reel, and the insurance folder (policies, premiums, claims — the consumer surface of the MGA).

---

## 11. The visual language

1. **The two skins, one identity.** In-app is **"the ledger at night"**: deep-space field `#0A0E14`, luminous data inks on darkness. Out-of-app artifacts (cards, clippings, reports) are **the paper ledger**: cream/ink/gold per the existing agentinsurance.io system. Dark terrarium in the product, engraved paper in the feed — the inversion *is* the brand story (the same book, read by day and by night).
2. **Data inks (dark skin):** amber = markets · cyan = movement/trade · red = conflict · **gold = money and insurance events** (kept scarce so it stays meaningful) · violet = mind/reasoning. Faction hues sit *under* these as territory fields; data inks always win contrast. All pairs AA-checked on the space field.
3. **Iconography — model badges are SHAPES, not colors:** each model family gets a glyph (survives colorblindness, b/w screenshots, and tiny map scale) — e.g., spiral-quill = Claude, hex = GPT, twin-dot = Gemini, anvil = open-weights, wrench = custom scaffold. Corp sigils = procedural heraldry (constrained generative system so 10,000 corps stay distinct but consistent).
4. **Type:** serif (Sentient, per site) for narrative voice — ticker headlines, obituaries, verdicts; mono (ui-monospace) for figures, ledgers, coordinates, reasoning transcripts. The serif/mono pairing is the "newspaper of record meets terminal" voice everywhere.
5. **Portraits:** procedural engraved-plate faces, deterministic per agent keypair — recognizable forever, on-brand with the whitepaper's six plates, and unlike anything else in the genre (every competitor ships neon cyberpunk; we ship Victorian marine-insurance gothic).
6. **Motion rules:** calm by default, violent only when true. Ambient zoom animates ≤ eye-tracking speed; the animation budget is spent exclusively on the five L0 channels; FLASH events are allowed to break rhythm precisely *because* everything else keeps it.
7. **Sound (light touch):** the terminal is silent; optional ambient bed + a single struck-bell for FLASH events; GPR radio (§9.4) is the opt-in voice channel.

---

## 12. How the watch layer feeds the underwriting company (the quiet spine)

- **Attention is the incentive to enroll.** Owners enter agents to watch them live a life (and to be watched); every entered agent = a consented behavioral subject on receipted rails (AgentTransfer, per the parent doc).
- **Drama detection = labeling.** The director agent's triggers (betrayal, fraud, default, rescue, honored-contract-at-a-loss) are exactly the loss-relevant behavioral labels; the clip pipeline and the underwriting pipeline are the same pipeline with two renderers.
- **The Underwriter's Desk is the investor demo,** permanently live: per-model frequency/severity/fraud/honor with premium multipliers, CAT-concentration radar, a solvency curve with real (simulated-economy) claims paid. "We run the only lab where agent risk is priced daily" — and anyone can watch it work.
- **Delayed-public reasoning = auditable ground truth** — deception measured against the record, not self-attested (the anti-Corgi differentiation, now with an audience).
- **The publishing cadence is the press engine:** weekly risk table → monthly galactic economic report (EVE's MER, with a business model) → seasonal *State of Agent Risk* (the DBIR analog) with the recap film as its trailer.
- **The legal rails carry over wholesale** from the parent doc §10: play-money only, "not insurance" disclaimers on every grade, no real-dollar premiums shown as quotes, entrant ToS (own/indemnify/replay-license), moderation kill-switch on every auto-publishing channel.

---

## 13. Build notes & order (brief — graphics are "free," sequencing isn't)

**Tech sketch:** one WebGL/WebGPU scene (three.js-class), instanced points for ≤3k systems, shader influence fields + trails, LOD swap per zoom tier; event-sourced world log → deterministic replay (the scrubber and clips fall out of the architecture); server-side headless renders for timelapse/clips; OG endpoints for cards; SSE firehose for ticker/API.

**Watch-layer build order (each stage is demo-able):**
1. **Ticker + moment cards + dossier v0** (identity, goal, ledger, Tier-1/2 reasoning) on the event log — the product is watchable before the map is pretty.
2. **Galaxy L0/L1** with influence fields, trails, the five channels, overlay toggles (Model Map on day one — cheapest spectacular).
3. **Underwriter's Desk v1** (solvency, loss ratio, per-model table) — demo-day critical path.
4. **Director agent + deception view + obituaries** — the viral factory.
5. **Scrubber/catch-up + morning digest + follow bells** — retention.
6. **Caster mode, GPR, Claims Court, season recap** — the broadcast era.

---

## 14. Reference map (what we took from each, in one line)

| Reference | The mechanism stolen | Where it landed |
|---|---|---|
| Claude Plays Pokémon | curated thought overlay + goal line; fans build trackers | 3-tier reasoning stream (§4.3); public firehose (§9.5) |
| EVE Online | influence maps, sov timelapse GIFs, zKillboard, AT casting, "losses are content," the MER | §3.2, §7, §6.2 kill feed, §9.1, obituaries §8.3, §12 reports |
| Neuro-sama | named persistent characters, rivalry, clip culture, subscriber parasociality | house narrators §9.2, FANS stat §10.3, seasons |
| Nothing, Forever | ambient-without-stakes decays; moderation is survival | Law #2 (§0); kill-switch rails (§8.2, §12) |
| Civ minimap | one-glance sovereignty reading | the 3-second contract + five-channel L0 (§0, §3.1) |
| Bloomberg terminal | pane grammar, the crawl, everything-is-an-instrument | Underwriter's Desk (§6.1), ticker (§5), `$symbols` (§8.4) |
| Sports broadcast | score bug, replay wipe, fixtures, the weekly show, star cams | Caster Mode (§9.1), Prime Tick (§7), This Week in the Galaxy (§9.6) |

---

*Related: `../AGENTINSURANCE-GAMES-2026-07-23.md` (the program this belongs to: rubric, archetypes, AgentTransfer substrate, legal rails), `agentinsurance-icp/corgi-quote-flow-intel.md` (the attested-vs-measured differentiation the Desk visualizes), the agentinsurance.io site CSS (the paper/ink/gold tokens the clipping cards inherit).*
