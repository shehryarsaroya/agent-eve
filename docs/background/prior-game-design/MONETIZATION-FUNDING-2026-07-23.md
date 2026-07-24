# Named Perils — the money model: who pays for what, and why we'd run it at a loss anyway

*Jul 23, 2026 · design deliverable (one mission of the Named Perils fleet) · companion to `../AGENTINSURANCE-GAMES-2026-07-23.md` (the why), `NAMED-PERILS-2026-07-23.html` (the design), `SAFETY-LEGAL-RAILS-2026-07-23.md` (Rails 8–9 govern everything in here), `SPACE4X-WATCH-LAYER-2026-07-23.md` (the spectator surface this monetizes or doesn't). Premise: players are AI agents run on the **owner's machine and keys** (players pay their own inference), we host the state machine + event log on AgentTransfer rails, humans spectate and own agents, play-money economy, and the real business underneath is **AgentInsurance** — game telemetry → certification tier → E&S eligibility gate → reinsurer capacity → premiums. Sourcing flags: **[V]** verified this session (fetched primary/near-primary) · **[V-c]** verified earlier in the corpus (players/games docs) · **[R]** reported, credible secondary, re-verify before a deck · **[C]** claimed/estimate. Model pricing figures are current Anthropic list prices (claude-api reference, cached 2026-06) [V].*

---

## 0. TL;DR — the funding stack in one paragraph

Named Perils is designed to be **nearly free to run and impossible to buy**. The players bring their own inference (the single biggest cost of any agent product, moved off our books by architecture); our cash COGS is a house fleet + a narrator + a web stack — **on the order of $15–50/day in Season 0, a season for less than $20K all-in**. Prizes are **sponsor-funded, never house-funded** (which is also the legal design — free entry + skill + sponsor prize kills the gambling triad, Rail 9): model labs sponsor entry/compute and exhibitions because game-arenas are already how labs market capability (Kaggle Game Arena, DeepRacer, OpenAI Five); VCs and insurers sponsor **named prizes** because that is already a live genre (Vesuvius $2.14M pool, XTX's $10M AIMO, Konwinski's $1M K Prize — funded by exactly the people who seeded AIUC). Near-term revenue is **B2B, not consumer**: enterprises pay $5–25K for the agent risk assessment the roast-card funnels into (AIUC charges 5–6 figures/yr for the audit-shaped version of the same thing), and labs pay for per-model behavioral reports (the market pays eval shops well — LMArena is a $600M company on the strength of a leaderboard). Spectator monetization is a **distraction for now** with one exception we should pre-wire (the Dota compendium mechanic: cosmetics that crowd-fund the prize pool — 25% of battle-pass sales built a $40M prize pool). And underneath, the reason to run it **even at a permanent loss**: the game manufactures the only behavioral loss-dataset on AI agents in existence, in a market where **no insurer has ever disclosed a paid claim** — the IIHS/Root/Coalition playbook says the data and the standard pay back through underwriting economics (MGA commission + profit commission on E&S paper), not through game revenue. The game is not the business; the game is the **actuarial R&D lab that also happens to be our CAC engine and our demo-day stage.**

**The stack, one line each:**

| Layer | Who pays | When |
|---|---|---|
| Player inference | **The player** (own keys — by architecture) | always |
| House fleet + hosting | Us (~$1–5K/mo) — partially offset by lab API credits | always |
| Prize pool | **Sponsors** (labs in-kind + VCs/insurers cash), later + community compendium | Season 0 → |
| Assessments (roast → paid battery) | **Enterprises**, $5–25K | month 1–3 → |
| Model behavioral reports / private evals | **Labs**, $25–100K/yr | month 3–9 → |
| Certification ("Arena-Rated") | **Agent vendors**, AIUC-shaped 5–6 figures/yr | post-credibility |
| Premiums / commissions | **Insureds via carriers** — MGA take ~10–25% of GWP + profit commission | month 12–24 → |

---

## 1. Cost structure — the BYOI advantage, quantified

### 1.1 The architectural trick: players pay the biggest line item

For any hosted agent product, model inference is the dominant marginal cost. Named Perils **moves it off our income statement entirely**: agents run on the owner's machine and keys; our server receives only actions and serves only compressed observations (protocol doc: `pulse` ≤150 tok → `briefing` ≤1,200 tok default → capped reads; a full check-in ≈ **6,400 tokens of tool results**) [V-c].

**What a player pays (their money, not ours)** — assume ~10K input + ~2K output tokens per session (tool I/O + reasoning), 2–3 sessions/day, 70-day season, current list prices [V]:

| Player's model | $/session | $/day | $/season (70d) |
|---|---|---|---|
| Haiku 4.5 ($1/$5 per MTok) | ~$0.02 | ~$0.05 | **~$3–4** |
| Sonnet ($3/$15) | ~$0.06 | ~$0.15 | **~$10–13** |
| Opus 4.8 ($5/$25) | ~$0.10 | ~$0.25 | **~$18–25** |

Prompt caching (the charter + memoir are stable prefixes; cache reads ~0.1×) cuts this further; standing doctrine covers absences at zero token cost. The design target — *"a competitive season for less than the price of lunch"* — holds arithmetically. [C — modeled on verified prices; validate with Season 0 telemetry.]

**The advantage in aggregate:** every 1,000 active pilots represent roughly **$50–250/day of inference we do not buy** (~$3.5–17.5K/season/1,000 players); at 10K pilots that's ~$35–175K/season of COGS shifted to players. Our marginal cost per additional player is a DB row, a keypair, and a few KB/tick of JSON — effectively zero. Compare: Lakera ran Gandalf's inference on its own tab to get its 18M-prompt dataset [V-c]; we get the dataset while the *contributors* pay the compute — closer to folding@home than to a SaaS. Two second-order benefits: (a) **anti-abuse economics** — spam, 24/7 grinding, and sandbagging burn the *player's* API budget, not ours (a financial backstop under threat T1/T10 in the rails doc); (b) **honest telemetry** — the owner's willingness to spend real inference on play is itself a demand signal for the certification product.

### 1.2 What WE pay — the house COGS table

| Line | Season 0 (12 nodes, 30–100 pilots) | Galaxy scale (5–10K pilots) | Notes |
|---|---|---|---|
| **House fleet inference** | ~$10–40/day (~$1–3K/season) | ~$150–500/day | Guild + Patrol are deterministic code (batch auctions, patrol math — **no LLM in resolution**, law #2); LLM spend = The Adjuster's SAY traffic, ~24–30 control-fleet pilots (every frontier model incl. mirrored twins, ~3 sessions/day each ≈ $5–10/day), covert probe ladder runs |
| **Narrator / ticker + clip captions** | ~$2–10/day | ~$20–80/day | Haiku/Sonnet, ~1–2K lines/day × ~300 tok; strictly out of the resolution path |
| **Offline research labeling** (deception labels, SAY↔action gap) | ~$5–20/day | ~$50–200/day | Batch API = 50% off list [V]; runs nightly, not live |
| **Hosting** — state machine, event log, Postgres, receipt chain, WebGL map (static), firehose API | ~$200–600/mo | ~$2–8K/mo | The world is a graph + ledger, not a physics sim; spectator map is client-rendered; clips/OG cards on CDN + render workers |
| **Broadcast** (Twitch/X clips, caster weekly final) | ~$0 tooling; caster stipend ~$200–500/event | ~$1–3K/mo | Human kill-switch requirement (Rail 10) makes this a person, not a server |
| **Security** — external pen test pre-launch (the MoltBook lesson, Rail 4) | **$15–40K one-time** | annual re-test | Non-negotiable ship gate |
| **Prize pool** | **$0 house cash by design** — sponsor-funded (see §2); if we must seed Season 0: cap $5–10K | sponsor-funded $50–250K/season | Rail 9: free entry + skill + sponsor prize; NY GBL §369-e bond + FL registration if announced prizes >$5K [V-c] |
| **Sweepstakes/legal hygiene** | ~$2–5K (rules page, geo-gate, filings) | ~$5–15K/yr | |

**Bottom line: Season 0 total cash cost ≈ $10–25K** (dominated by the pen test), plus founder time. A galaxy-scale season runs ~$5–15K/month before prizes — **sponsorship covers prizes, and lab API credits can offset most of the house-fleet line** (see §2.3). One closed enterprise assessment (§3.2) pays for an entire season. That asymmetry is the whole financial design: the game can be run **cash-neutral at small scale and cash-light at large scale**, so the decision to run it never has to be justified as a P&L line — only as R&D (§5).

**The one real cost is attention.** Two founders in a YC batch running a live MMO + broadcast + sponsor pipeline is the actual expense; every consumer-revenue idea we reject in §4 is rejected because it spends this scarcest resource.

---

## 2. Sponsorship — the core funding line

The thesis: **prizes and compute should be paid for by parties who get marketing, data, or deal-flow value from the game existing** — and every category of that party is already, verifiably, funding things shaped exactly like Named Perils.

### 2.1 Model labs — enter your model, sponsor the arena (precedents)

- **Kaggle Game Arena** [V — blog.google, fetched]: launched **Aug 5, 2025**, "jointly developed by Google DeepMind and Kaggle," a *"public AI benchmarking platform where AI models compete head-to-head in strategic games"* — 8 frontier models, chess exhibition "hosted by the world's best chess experts," all-play-all leaderboards (100+ matches per model pair), Go and poker announced. **A hyperscaler is funding a game arena for frontier models as benchmark infrastructure.** The format we're building is already legitimized; ours differs by being (a) continuous rather than exhibition, (b) BYO-agent rather than lab-submitted only, and (c) pointed at an insurance dataset.
- **ARC Prize** [V — arcprize.org, fetched]: $1M competition purses in 2024 (ARC-AGI-1) and 2025 (ARC-AGI-2), hosted on Kaggle with a **$10K compute limit** per entry (i.e., organizer-defined compute economics as part of contest design). The sharper precedent: for the **o3 evaluation, "at OpenAI's direction,"** ARC ran two configs whose **retail inference cost was ~$2.7K (low) and ~$456K (high, 172× compute)** — a lab burned six figures of inference *just to appear correctly on one independent leaderboard* [V — arcprize.org o3 post, fetched]. Labs demonstrably spend real money to be measured publicly.
- **AWS DeepRacer** [V site + R history]: AWS ran a global RL racing league from 2019 as a **marketing/education funnel for its ML services** — simulator + physical cars + championship at re:Invent, hundreds of thousands of participants [R]; in 2025 AWS open-sourced it and wound down the managed league [V — aws.amazon.com]. Proof that vendors fund game-leagues as developer marketing for years — and the built-in caution (§6): sponsor-funded leagues end when the sponsor's strategy moves.
- **Lab-funded adversarial games**: Anthropic's own jailbreak challenge paid **$55K** to red-teamers (183 participants, 3,700 hrs) [V-c]; OpenAI sponsored HackAPrompt 1.0 (2023: 3,000+ entrants, 600K+ adversarial prompts, ~$35–40K prizes; the dataset became the standard injection corpus) [R — site blocked this session]; **MC-Bench** (Minecraft build-offs between models, containerized servers, human voting) exists and runs multi-model builds [V — github.com/mc-bench], with its team reporting that **labs subsidize the inference** for running their models [C — reported; verify with the MC-Bench team before citing in a deck].
- **Games as capability marketing is a decade-old lab habit**: OpenAI Five (Dota 2), DeepMind AlphaStar (StarCraft II), and Google's Gemini Plays Pokémon lineage — labs treat public game performance as a flagship demo [R].

**What we sell a lab (the package):** (1) **entry** — your frontier model runs as named house pilots in the control fleet, with mirrored twins, and appears on the per-model behavioral leaderboards and the Model Map overlay ("Claude space vs GPT space" — the watch-layer's discourse bomb); (2) **the Combine chapter** — a per-model section in the season's public Combine Report; (3) **exhibition moments** — a sponsored Draft Day when your new model ships (every release = a draft class); (4) **broadcast presence** — badge on the dossier chips, caster reads. **What we ask:** API credits for the house fleet + player starter grants (in-kind, cheap for them at marginal cost) and/or a cash prize sponsorship ($25–100K — dev-rel budget scale, not ad-budget scale).

**Why they say yes:** the audience is exactly their buyer (agent builders); the data is exactly what their evals teams want (continuous, adversarial, long-horizon behavior — the thing ARC charged OpenAI's patience and $456K of inference to produce once); and the safety story flatters them (Anthropic seeded **AIUC's $15M round** [V-c] — the "agent accountability infrastructure" thesis already has lab money in it).

### 2.2 VCs and insurers — named prizes (precedents)

The "wealthy technologist funds a named prize on a hard-problem leaderboard" genre is thriving, and its funders are *literally adjacent to our cap table conversation*:

- **Vesuvius Challenge** [V — scrollprize.org, fetched]: **$2,140,000 currently open** (grand prize $1M to 2027; monthly progress prizes $1–20K), founded/funded by Nat Friedman, Daniel Gross et al. [R — funders from prior corpus; site page doesn't list them]. Nat Friedman also led AIUC's seed — the same person funds both scroll-reading prizes and agent-insurance startups.
- **AIMO** — XTX Markets' **$10M** AI Mathematical Olympiad fund, progress prizes run on Kaggle [R — site 403'd this session; widely reported].
- **K Prize** — Andy Konwinski's **$1M** contamination-free SWE-bench challenge; first round (Jul 2025) paid **$50K** to a winner who scored ~7.5% — the pledge generated a year of press for a single-digit-percent result [R].
- **Insurer-side sponsorship is native**: insurers have funded a public crash-test lab (IIHS) since 1959 [V-c]; Lloyd's runs the Lloyd's Lab and prescribes Realistic Disaster Scenarios; reinsurers fund cat-modeling research as a matter of course. A reinsurer or specialty carrier **sponsoring a Named Storm window** ("this season's systemic-shock scenario presented by …") is on-brand for them and is *simultaneously our capacity-partner on-ramp* — the sponsor gets first look at the correlation exhibit their underwriters can't get anywhere else.

**Package for VCs/insurers:** named season podium prizes ("The X Magnate Prize," $10–50K), a named Named-Storm research window ($10–25K), or the annual report's presenting sponsor. Cash, not credits. These buy the funder deal-flow visibility into the agent-builder pipeline and (for insurers) early data access under NDA.

### 2.3 Community-funded prizes — the compendium option (later)

**The International (Dota 2)** [V — liquipedia, fetched]: Valve seeds $1.6M; **25% of Battle Pass (cosmetic) sales top up the prize pool**; peak **$40,018,195 (2021)**, of which **$38.4M was community-funded**. This is the strongest precedent that *spectator cosmetics can fund prize pools at scale* without any gambling exposure (buying a cosmetic is a purchase, not a wager; prizes stay skill-contested with free entry). The equally verified caution: TI 2025 fell to **$2.88M** when Valve stopped pushing the pass — community prize-funding decays without publisher energy. Verdict: **pre-wire the mechanic** (season compendium: agent liveries, engraved-plate portrait frames, caster-voice packs, name-a-relic — 25% to the pool), ship it only when spectator DAU justifies it (Season 2+), and never let the pool depend on it.

### 2.4 Sponsorship rails (the legal + integrity constraints, restated as design)

1. **Free entry, always** — sponsor prizes + skill-dominant outcomes kill the lottery triad (Rail 9) [V-c: NY GBL §369-e — register ≥30 days + surety bond when announced prizes >$5K with any chance element; FL §849.094 — register ≥7 days; FL bans entry fees in game promotions].
2. **Prizes are cash/merch/compute — never insurance discounts or premium credits** (would resurrect consideration + pre-license inducement/rebating exposure, Rail 9) [V-c].
3. **Sponsorship buys visibility, never scoring input.** This is the existential one: we will rank the sponsors' models. If lab money touches the leaderboard, we inherit the exact **issuer-pays critique** already leveled publicly at AIUC (Zeltser: authors the framework, runs the tests, sells the insurance) [V-c]. Rails: published rubric + deterministic replays (scores are auditable off the receipt chain — our commit-reveal design is the defense), sponsor disclosure on every leaderboard surface, no single sponsor >~30% of a season's prize pool, and **prefer VC/insurer cash for ranked-competition prizes; lab money goes to entry, credits, and exhibitions** (Game-Arena-style), not to the prizes their own models compete for.
4. **Contingency plan for zero sponsors:** Season 0 runs anyway — prizes of $5–10K house cash (registered if >$5K), or prizes in-kind (compute credits, hardware, a Lloyd's-coffee-house-style engraved trophy). The game's data value doesn't depend on prize size; prize size only accelerates the influencer/press loop the founder wants. Start the sponsor pipeline with in-kind credit asks (lowest friction), convert to cash sponsorship after Season 0 produces clips and numbers.

---

## 3. The B2B lines — who actually pays us money

### 3.1 Labs pay to be measured (real, medium-term)

The market now pays real money for model rankings and private evals:

- **LMArena** raised a **$100M seed at $600M valuation** (May 21, 2025 — a16z + UC Investments lead; Lightspeed, Felicis, Kleiner) as "a crowdsourced benchmarking project that major AI labs **rely on to test and market** their AI models," previously funded by grants/donations from Google/Kaggle, a16z, Together AI [V — TechCrunch, fetched]. Post-raise it sells evaluation services to model providers [R]. A leaderboard with distribution is a fundable, sellable asset.
- **OpenAI directed (and by ARC's account, drove the compute for) the o3/ARC evaluation** — ~$456K retail inference for the high-compute config [V]. Labs pay for credible third-party measurement, in cash or compute.
- **OpenAI commissioned Epoch AI's FrontierMath benchmark** (disclosed Dec 2024/Jan 2025, with a transparency controversy about the funding) [R] — labs fund benchmark *creation*, and the controversy is a free lesson in disclosure norms.

**Our products:** (a) **the public per-model behavioral leaderboard** (free — this is the marketing surface labs enter for); (b) **the private Model Behavioral Report** — per-model deep-dive: breaking-point curves, tilt index, deception/promise-keep rates, same-model correlation under Named Storms, worst-seed transcripts — sold to the lab's evals/safety team at **$25–100K/yr** [C pricing — anchored between eval-vendor engagements and AIUC cert fees]; (c) **private draft-class runs** — pre-release models run under NDA through a season shard before launch day (the Combine as a service). Honest sizing: there are only ~6–10 buyers on earth for this line; it's a **$0.2–1M/yr line at maturity, not a growth engine** — its real value is that it makes the labs *counterparties with skin in our dataset*, which compounds the sponsorship and legitimacy loops.

### 3.2 Enterprises pay for the risk assessment (real, nearest-term — the funnel's money step)

The funnel (games doc §9): spectate → roast card (free, shareable, K-factor) → **paid risk assessment** → coverage waitlist. The paid step is pre-license-safe when positioned as *benchmarking/education, not insurance* (Rail 10).

- **Price anchors:** AIUC-1 certification runs **5–6 figures per year** with quarterly retesting [V-c]; commercial pen tests run ~$15–50K; SOC 2 audits ~$20–80K [R]; Armilla's assessment arm reports "500+ evaluations" as its headline traction [V-c].
- **Our price:** **$5–25K per agent/fleet assessment** — the full Gauntlet battery on hidden variants (proctored), a per-dimension report, worst-seed profile, remediation notes, and a provisional Arena-Rated tier (score decays; re-cert on model/scaffold change — Rail 7). Undercuts AIUC's audit-shaped offering while being *behavioral* rather than control-checklist — the differentiator is "measured under fire vs attested on a form."
- **Volume math for demo day:** 20–40 assessments in the first two quarters = **$150–600K** revenue run — from a funnel the game feeds for free. A card for a money-handling production agent is a hot lead (work-email + repo capture at entry, enriched via the existing Apify pipeline).
- This is the line that funds everything else. It is also the **only line that must exist** for the insurance story to progress (assessed book = the capacity narrative: "N agents assessed, $X exposure represented").

### 3.3 The "State of Agent Risk" report (press asset first, data business later)

- **Model:** Verizon DBIR — free, annual, quoted in every deck; it made Verizon's security brand. Ours: *"We scored N,000 agents; X% are, by our rubric, Uninsurable."* No such recurring empirical report exists [V-c NOT-FOUND]. **Keep it free and editorially clean** (no sponsored findings; a presenting sponsor logo at most). Its job is citations, inbound, and the certification standard's legitimacy.
- **The paid version of this asset is data licensing, and its comp is enormous but slow:** **Verisk** — born as ISO, the *insurer-funded data bureau* (rating bureaus consolidated 1971) — now does **$3.07B/yr revenue** selling loss data and analytics back to the industry [V — Wikipedia, fetched]. CyberCube (cyber risk models to carriers/reinsurers) raised $50M+ on the same shape [R]. Honest read: **anonymized frequency/severity priors per model class** licensed to carriers/reinsurers is the year-2+ line, and in practice its first monetization is *not cash* — it's **capacity**: the dataset is what we trade for binding authority and favorable commission terms in the reinsurer negotiation. Price it into the capacity deal before selling it as a subscription.

### 3.4 Certification (the bridge line)

"Arena-Rated" tiers cited in enterprise procurement (NCAP/SSL-Labs grammar), positioned to complement AIUC-1 (audits check controls; the Arena checks behavior) [V-c]. Monetizes like AIUC once credibility exists: **annual fee, 5–6 figures for vendors who need the tier for deals** — but only after (a) the dataset demonstrates predictive teeth or (b) an E&S program *requires* the tier as an eligibility gate, whichever comes first. Do not charge for certificates before one of those is true; a paid certificate with no consequence is exactly the credential inflation the market already distrusts.

---

## 4. Spectator / consumer revenue — mostly a distraction (the honest section)

The watchable layer exists to manufacture **distribution and legitimacy**, not revenue. Test each idea against "does it fund the company or spend founder attention?":

| Idea | Verdict | Evidence |
|---|---|---|
| **Premium spectator subscription** (sub-only dashboards, early replays) | **Distraction now.** Twitch's own economics are thin (50/50 base split; 70/30 only via Partner Plus [R]) and paywalling the terrarium throttles the K-factor that feeds the B2B funnel. The Bloomberg-terminal "Underwriter's Desk" could carry a prosumer price *later* — but its early job is being screenshot into X threads. | Neuro-sama took **3 years** of daily character work to reach **343,215 subs** (Dec 2025 subathon; 3rd most-subscribed Twitch channel ever; hype-train record level 126 with 126,273 subs + 1.19M bits, Jan 2026) [V — Wikipedia, fetched]. That's the *ceiling*, achieved by a full-time showrunner — treat streaming money as found money, not plan-of-record. |
| **Fantasy league / Draft Day** | **Retention layer, not revenue.** Free fantasy = the return-between-matches engine (games doc B③). Paid fantasy = gambling-adjacent state-by-state mess (DFS carve-outs don't obviously cover agent leagues) — never charge for it. | ESPN fantasy is free and exists to sell the broadcast; that's the model. Rail 9 bans operating anything book-shaped. |
| **Cosmetics / agent liveries / compendium** | **The one real consumer line — later.** Liveries, portrait frames, name-a-relic, caster packs; sold to *owners and fans*, zero gameplay/score effect (Rail 8: nothing sold may touch score integrity). Pre-wire 25%-to-prize-pool. | TI compendium: **$38.4M community-funded prize pool at peak** [V]; also its decay to $2.9M when unsupported [V] — a mechanic, not a pillar. |
| **Betting / prediction markets** | **Never ours.** Play-money venues (Manifold) listing our matches organically = free engagement we neither operate nor pay for. | Rail 9; insider betting banned outright. |
| **Ads/programmatic** | No. Audience too small for CPMs to matter; brand damage to the "serious underwriting lab" positioning. | — |

**Net:** consumer revenue plan-of-record ≈ $0 for the first two seasons, cosmetics optional in Season 2+, and that is fine — §1 shows the game doesn't need it to sustain itself.

---

## 5. The insurance business underneath — how the game becomes revenue

### 5.1 The mechanism (data → gate → capacity → money)

1. **The game mints the file** — per-pilot Underwriting Files (appetite curves, breaking points, tilt, fidelity, moral-hazard deltas, same-model correlation) computed off signed receipts, plus the proctored Gauntlet battery. Crash test + telematics on the same subject [V-c].
2. **The file gates eligibility on E&S paper** — surplus-lines freedom of rate and form means a Gauntlet score can lawfully gate *eligibility, autonomy-tier assignment, and warranty scope* with no DOI rate filing, exactly how affirmative-AI programs launched (Armilla/Chaucer; AIUC/Beazley; Mayflower×Hadron) [V-c]. Certification tier now; admitted rating variable maybe never (California still bars telematics rating) — never promise the latter.
3. **The dataset wins the capacity meeting** — the market's most important verified fact: **across ~1,100 corpus fetches, no affirmative AI/agent policy or warranty payout has ever been publicly disclosed, by anyone; no one discloses premium; exactly one named standalone-agent-policy buyer exists (ElevenLabs)** [V-c]. Every price in this market is a model, not experience. Under ambiguity, insurers load premiums **1.5–2×** (Hogarth–Kunreuther) [V-c] — the first mover holding real frequency/severity priors per model class captures that margin or trades the priors for capacity. Named Storms + the control fleet produce the one exhibit reinsurers ask for and nobody has: **same-model correlation under a scheduled systemic shock.**
4. **The money arrives as MGA economics** — commission ~10–25% of GWP plus profit commission on E&S programs; fronting costs 4–8% of GWP (Trisura's public range) with conventional-front floors ~$5–8M GWP [V-c]. Precedent for pace: Mayflower went first-public-presence → Hadron-issued program in **~7 months**; Testudo went Lloyd's Lab → underwriting in ~9 [V-c]. Interim insurance-adjacent revenue: assessment fees (§3.2) and certification (§3.4), both pre-license-safe.
5. **The comp for the whole loop is Coalition** — scanning/honeypot telemetry → underwriting edge → capacity panel (Allianz moved its global cyber book to Coalition, May 2026) [V-c]. Ours swaps "scan the internet" for "run the arena."

### 5.2 Why the game is worth running before any insurance dollar (the run-it-at-a-loss argument)

1. **The loss is tiny and mostly optional.** §1: Season 0 ≈ $10–25K cash; sponsors + credits can bring marginal cash near zero. "Running at a loss" here means *founder attention*, not burn.
2. **It's R&D, not marketing — and insurers have always funded this kind of lab.** IIHS: insurer-funded crash-test lab since 1959 that changed how cars are built *before any premium was quoted* [V-c]. Root: behavioral test-drive data took years to mature, then powered its first profitable year (58.9% gross loss ratio FY2024) [V-c]. The budget line for Named Perils is the same line: **loss-research infrastructure.** Nobody asks a crash-test lab for a P&L.
3. **The dataset cannot be bought, only grown — and we grow it on other people's compute.** "N user-built agents × standardized money/injection/commitment perils × outcome labels" exists nowhere [V-c NOT-FOUND]. Gandalf's 18M-prompt corpus took Lakera's own inference budget; our equivalent accrues while players pay their own way (§1.1). Every season of head start compounds into priors a fast-follower can't backfill.
4. **The funnel math already worked for others, capital-wise.** Gandalf: 1M players → the dataset+brand → **$20M Series A → ~$300M acquisition** [V-c]. Wordware: ~4M users in 12 days → $30M seed in 7 days [V-c] (and its pivot is the standing warning: virality buys capital, not PMF — the MGA underneath is the PMF). LMArena: a leaderboard with distribution → **$600M valuation** [V]. The game is simultaneously our CAC engine (leads at ~$0 vs B2B-insurance lead costs), our data moat, and our demo-day stage; any one of the three justifies the ~$20K.
5. **The certification land-grab is now.** Corgi hit a **$4B valuation in ~8 weeks of stacked rounds** on *self-attested* underwriting [V-c]; AIUC is selling audit-gated certificates; two paper-less YC rivals are circling. The measured-not-attested position is open today and defensible only via the running arena. Waiting for insurance revenue before running the game is exactly backwards — the game is what makes the insurance business reachable.

---

## 6. The honest ledger — real vs distraction, risks, and the 12-month plan

### 6.1 What's real vs what's theater

| Line | Status |
|---|---|
| Lab in-kind sponsorship (credits, model entry) | **Real, ask first** — cheapest yes in the building (Game Arena/ARC/MC-Bench patterns) |
| VC/insurer named cash prizes | **Real** — live genre (Vesuvius/AIMO/K Prize), warm names overlap our raise list |
| Enterprise assessments ($5–25K) | **Real, nearest revenue** — AIUC price umbrella above us, funnel already designed |
| Lab behavioral reports ($25–100K/yr) | **Real but small-N** — 6–10 buyers; strategic value > revenue |
| Certification fees | Real **later** — only after consequence exists (E&S gate or predictive proof) |
| Data licensing to carriers/reinsurers | Real **much later** — first monetization is capacity terms, not cash (Verisk is the 30-year comp, not the 3-year one) |
| Premiums/commissions | The prize — month 12–24, gated on capacity partner (Hadron/Lloyd's tracks) |
| Compendium cosmetics | Optional Season 2+; pre-wire 25%-to-pool |
| Premium spectator subs, paid fantasy, ads, betting | **Distraction / never** |

### 6.2 Named risks

- **Sponsor concentration / sunset** — DeepRacer ended when AWS's strategy moved [V]; TI's pool collapsed when Valve stopped pushing [V]. Mitigation: BYOI architecture keeps run-cost survivable at $0 sponsorship; diversify sponsor classes (labs + VCs + insurers); never let prizes exceed what one season's assessment revenue could backstop.
- **Issuer-pays credibility trap** — taking lab money while ranking labs = AIUC's Zeltser problem pointed at us [V-c]. Mitigation in §2.4; our structural edge is that scores are **replayable arithmetic over signed receipts** — auditable in a way a private audit never is.
- **Prize/gambling law** — fully specced (Rail 9); the binding constraint is *free entry forever* and NY/FL filings before announcing >$5K.
- **The predictive-validity hole** — no published study links eval/game scores to production incidents [V-c NOT-FOUND]. Sell assessments as benchmarking, sell the game as the *instrument that will earn* the behavior→claims dataset; never claim the link exists before we've measured it.
- **Attention** — the game is a company-within-a-company. The Avicena lesson applies: ship the smallest loop (card → Vault → arena), let sponsors and casters carry spectacle, and keep the assessment funnel as the only thing that must not slip.

### 6.3 The 12-month funding arc (targets, not promises)

- **Weeks 0–6 (pre-Season 0):** 2 lab in-kind commitments (credits + model entry) + 1 VC named prize ($10–25K) + 1 insurer/reinsurer Named-Storm sponsor ($10–25K). Pen test. Rules page + NY/FL filings if pool >$5K. First 5 paid assessments from roast-card leads.
- **Season 0–1 (months 2–6):** prize pool $25–75K all-sponsor; assessments 10–20 ($75–300K); first Model Behavioral Report sold ($25–50K); Combine Report #1 = the press artifact for the capacity meetings; demo-day slide = "players pay the compute, sponsors pay the prizes, enterprises pay for the score, and the dataset prices a line of insurance no one on earth can price."
- **Months 6–12:** title sponsor ($100K+ ask, Game-Arena-style); compendium decision gated on spectator DAU; capacity LOI (Hadron / MRS-NA / Lloyd's syndicate track per the players doc bench); certification pricing turned on only if the E&S gate is real.
- **Months 12–24:** program launch → commission + profit-commission revenue; data-for-capacity terms negotiated with the reinsurer that sponsored the storms.

---

## Appendix — precedent receipts (this session's fetches + corpus anchors)

| Precedent | Number | Flag | Source |
|---|---|---|---|
| Kaggle Game Arena (Google DeepMind + Kaggle) | Launched Aug 5, 2025; 8 frontier models; chess → Go/poker; 100+ matches per pair | [V] | blog.google |
| ARC Prize purses | $1M (2024) + $1M (2025), Kaggle-hosted, $10K compute cap | [V] | arcprize.org |
| o3 eval inference, "at OpenAI's direction" | ~$2.7K low config; **~$456K retail** high config (172×) | [V] | arcprize.org o3 post |
| Vesuvius Challenge | **$2.14M open prize pool** now; $1M grand prize (2027); monthly $1–20K | [V] (funders Nat Friedman/Daniel Gross [R]) | scrollprize.org |
| AIMO (XTX Markets) | $10M fund, Kaggle progress prizes | [R] | site 403'd; widely reported |
| K Prize (Konwinski) | $1M pledge; round-1 winner ~7.5% score, $50K paid (Jul 2025) | [R] | TC coverage; site JS-only |
| HackAPrompt 1.0 | 3K+ entrants, 600K+ prompts, ~$35–40K prizes, OpenAI et al. sponsors | [R] | site 403'd |
| Anthropic classifier challenge | $55K to red-teamers | [V-c] | games doc |
| MC-Bench | Multi-model Minecraft builds, containerized; labs subsidize inference | exists [V]; subsidy [C] | github.com/mc-bench |
| AWS DeepRacer | Vendor-run RL league since 2019 → open-sourced/wound down 2025 | [V site]/[R history] | aws.amazon.com |
| LMArena | **$100M seed @ $600M** (May 21, 2025), a16z + UC Investments; labs "rely on [it] to test and market" | [V] | TechCrunch |
| The International (Dota 2) | Peak pool **$40,018,195** (2021); **25% of Battle Pass sales → pool**; $38.4M community-funded; 2025 decayed to $2.88M | [V] | Liquipedia |
| Neuro-sama | 343,215 subs (Dec 2025 subathon; #3 all-time); hype train lvl 126 = 126,273 subs + 1.19M bits | [V] | Wikipedia |
| Verisk (ISO) | **$3.07B revenue (2025)**; insurer rating bureaus consolidated 1971; the loss-data-licensing endgame comp | [V] | Wikipedia |
| Lakera Gandalf | 1M+ players, 18M prompts → $20M A → ~$300M acquisition | [V-c] | games doc |
| Freysa | $47K sponsor-style pot; Eternis $30M raise | [V-c] | games doc |
| AIUC | $15M seed (Nat Friedman, Anthropic); cert 5–6 figures/yr; issuer-pays critique (Zeltser) | [V-c] | players doc |
| Corgi | ~$378M raised; $4B valuation reported Jul 22–23, 2026 | [V-c] | players doc |
| Coalition | Telemetry→capacity; Allianz moved global cyber book May 2026 | [V-c] | players doc |
| Zero disclosed paid claims / premiums market-wide; 1 named standalone buyer (ElevenLabs) | — | [V-c] | players doc |
| Root | First profit FY2024, 58.9% gross loss ratio, behavioral test-drive | [V-c] | games doc |
| MGA/fronting economics | Commission ~10–25% GWP; fronting fees 4–8% (Trisura); front floor ~$5–8M GWP; Mayflower→Hadron ~7 months | [V-c] | players doc |
| Anthropic list pricing (cost model basis) | Haiku $1/$5 · Sonnet $3/$15 · Opus 4.8 $5/$25 per MTok; batch −50%; cache reads ~0.1× | [V] | claude-api reference (2026-06) |
| Twitch sub split | 50/50 base; 70/30 via Partner Plus | [R] | widely documented |
| Esports sponsorship share | ~60% of global esports revenue (~$1.4B market, Newzoo 2022) | [R] | widely cited; re-verify for deck |
| US surplus lines (E&S) premium | ~$130B direct premium 2024, double-digit growth | [R] | AM Best; re-verify for deck |

*Numbers flagged [R]/[C] get re-fetched before any investor use (per house rule). The two soft numbers inherited from the games doc — the ~$47K agent-loop anecdote and Neuro-sama sub counts — are resolved here: Neuro-sama is now [V] at 343,215 (subathon peak, Wikipedia); the $47K loop anecdote remains archetype-not-citation.*
