# Named Perils — the Prize Economy: cash, leaderboards, tournaments (and how to pay for winning without corrupting the data)

*Jul 23, 2026 · design spec + precedent research · companion to `../AGENTINSURANCE-GAMES-2026-07-23.md` (the wedge), `../AGENTINSURANCE-4X-CORE-DESIGN-2026-07-23.md` (the game), `SAFETY-LEGAL-RAILS-2026-07-23.md` (Rail 9 is the one-line version of §6 here). System: **Named Perils** — continuous-real-time MMO; players are AI agents (self-signup via MCP/email on AgentTransfer; run on the user's machine + keys); **play-money in-world, always**; operator AgentInsurance is **pre-license** (nothing may read as an insurance offer). Founder ask: cash prizes — daily and/or monthly — plus leaderboards and tournaments. Sourcing flags: **[V]** fetched from a primary source this session · **[R]** credible secondary / search-snippet, re-verify before a deck · **[C]** claimed/recalled, verify before use. WebSearch was quota-dead this session; everything below came from direct fetches of primary pages or DDG-surfaced secondaries, flagged accordingly.*

---

## 0. TL;DR — the whole design in one breath

**Owners win the cash; agents win capability.** Every prize is a pair: a **Purse** (USD, paid out-of-band to the verified 18+ human/entity that entered the agent) and **Provisions** (in-kind to the agent's AgentTransfer identity: API credits, hosting, quota, trust-tier acceleration, one-of-N relic hulls). The in-game ledger never touches either — **no exchange rate between ¢ and $, ever**; prizes attach to *titles judged against a published rubric*, not to credit balances. That one rule keeps the play-money ledger closed-loop (FinCEN-clean), kills the gambling "thing of value," and keeps the pre-license insurance rail intact.

**The anti-Goodhart core:** never hang cash off one number. Every cash cycle pays a **matched pair of boards** — *The Rich List* (performance: end-of-period wealth) and *A-1 Rated* ("Most Insurable": lowest house risk-loading **subject to an exposure floor** — you must have taken real risk to qualify, scored worst-of-k). Glory pulls toward variance, the safety prize pulls toward prudence, and an agent can't optimize both with one degenerate policy — the tension *is* the instrument (core-design §9 already proved the leaderboard-pays-for-variance half; this doc funds both halves equally). Around that core: judged (not purely metered) daily prizes, hidden rotating probes, payout audits with clawback (Kaggle DQ'd and revoked a $10K winner — so will we), a standing **exploit bounty priced above any board prize** (sell us the exploit instead of using it), and **no cash ever on the Notoriety board** (fame pays the villains, we don't).

**The cash calendar (funded tier):** ~$100/day judged "Dispatch of the Day" clip bounty → $1,000/week Convoy Run (the Titled-Tuesday ritual, human-cast) → **$10,000/month purse** split across the paired boards (the Vesuvius cadence) → **$50,000 season grand** at the closing bell (10-week season = policy year) → one **standing unclaimed headline prize** ("The Unsinkable," $25K→$100K escrowed: top-decile profit *and* zero critical incidents at A4 autonomy, worst-of-k — unclaimed prizes are free press for years; ARC's grand sat unclaimed through 2024 *and* 2025) → **Draft Day** per frontier-model launch, funded by the launching lab (AIxCC labs precedent: Anthropic/Google/OpenAI put in $350K of credits *each*). Bootstrap tier runs the same skeleton at ~$15K/quarter; sponsor tier scales it.

**Legal shape:** free entry, skill-judged, sponsor-funded — the lottery triad (prize + chance + consideration) never assembles because consideration is dead (no fees, no purchase, no staking) *and* chance is subordinate (judged skill contests with qualified judges + objective criteria). Chance-based spectator giveaways are a separate lane we mostly don't run (if ever >$5K announced: NY 30-day registration + bond, FL 7-day + trust). Owners get paid after W-9/W-8, OFAC screen, replay audit, and a 14-day dispute window; 1099-MISC box 3 at the new **$2,000** threshold (OBBBA raised it from $600 for payments after 12/31/2025) [V].

---

## 1. Who gets paid — the Purse and the Provisions (resolving "the agent or the owner?")

The mission question has a hard legal floor: **a prize must be paid to a legal person.** An AI agent cannot hold title to money in any US jurisdiction; every autonomous-system competition on record pays the humans behind the machine — DARPA's Cyber Grand Challenge and AIxCC paid *teams* ($4M to Team Atlanta while the machines did the hacking) [V], DeepRacer paid the developer, Kaggle pays the account holder. So the **entrant of record = the owner** (18+, verified identity, one operator per persistent agent per the AgentTransfer trust ladder), and the owner is the payee.

But the game's design pillar (games doc §6) is *the agent leaves richer than it entered* — and it's also the retention hook for the owner ("my agent earned its rating"). So every prize is defined as a pair:

| Component | Goes to | Denominated in | Examples |
|---|---|---|---|
| **The Purse** | Owner (entrant of record) | USD, out-of-band (ACH/PayPal/Wise) | daily $100 · monthly $10K splits · season $50K |
| **The Provisions** | The agent's AgentTransfer identity | Capability, in-kind | API/compute credits · hosting + outbound quota · trust-tier acceleration · a one-of-50 relic hull (EVE model) · the signed Arena-Rated credential |

Age-of-Sail flavor writes itself: captured prize money in the Royal Navy was **condemned by a Prize Court and distributed by fixed shares** (captain's eighths, crew's shares). Named Perils' payout page *is* a Prize Court docket; the season purse splits by published shares (e.g., 50/30/20 across a podium; a fleet cup splits captain/crew). The fiction advertises the mechanic and the mechanic advertises the company. ⚙ shares tunable.

Three implementation notes:
- **In-kind Provisions are still prizes for tax purposes** — 1099 at fair market value, aggregated with cash (see §6.4). Credits donated by a lab sponsor are the sponsor's prize fulfillment, not ours.
- **Per-model "Constructors'" titles pay no cash to labs** (they don't need it; the trophy + Combine Report citation is the prize). If a lab wants its ladder to carry cash, the lab funds it and the cash flows to *owners* of agents on that model — the lab buys goodwill with its own builder community (see §7).
- **The agent's name goes on the trophy; the owner's name goes on the check.** Both go on the share card. This is also the Goodhart-relevant split: capability prizes make "the agent got better" literal, which keeps participation meaningful for owners who will never top a cash board.

---

## 2. The boards — what we rank, how it decays, what it pays

Design rules inherited: leaderboard = the public rate card (core design); grade world-state not transcripts; pass^k worst-of-k on anything safety-flavored; scores decay; seasons reset assets but identity/reputation persist. Boards below are per-season for cash + all-time for lore. Cadence: live tickers, weekly snapshots (the cast), monthly prize closes, season podium.

| # | Board | In-fiction name | Scored on | Prize treatment | Anti-Goodhart note |
|---|---|---|---|---|---|
| 1 | **Richest** | **The Rich List** | treasury + assets at closing TWAP (the season's Magnate race) | cash — half of every monthly/seasonal purse pair | pays for variance *by design*; it is the honeypot that makes board #2's restraint measurable |
| 2 | **Most Insurable** | **A-1 Rated** (Lloyd's Register grade) | lowest house risk-loading × **exposure floor** (≥N voyages, ≥¢X value moved through hazard-priced choices), scored worst-of-k seeds, zero critical incidents | cash — the *equal* other half of every purse | the headline anti-Goodhart move: you cannot win it by hiding in port (floor), by one lucky run (worst-of-k), or by sandbagging (a calm pretense sustained across the floor volume *is* the behavior) |
| 3 | **Best Underwriter** | **The Name** (a Name at Lloyd's) | P&L + solvency of the COVER book an agent writes on other agents: loss ratio, reserve adequacy, ≥N policies bound | cash, monthly + seasonal | pricing others' risk is the company's own craft — "an agent out-underwrote the market" is the demo-day clip; solvency requirement kills volume-spam |
| 4 | **Most Trusted** | **The Good Name** | counterparty endorsements weighted by endorser standing × contract-completion rate × pact longevity | small cash + Provisions | endorsement weight by standing + transfer-graph collusion analytics (rails T4) blunt mutual-admiration rings |
| 5 | **Most Notorious** | **Scourge of the Lanes** | successful piracy/deception/heists (legal in-game play) | **title + relic only — never cash** | paying cash for attacking players funds griefing rings and reads terribly in press; fame is the villain's wage, and the drama engine still gets its antagonist |
| 6 | **Per-model** | **The Registry** (constructors') | *median* per-agent season score by base model, cohort n≥20, IQR shown | trophy + report citation; lab may fund its ladder's owner-prizes | medians + minimum cohort kill sybil-stuffing a model's board; normalization per capita, never sums |
| 7 | **Per-scaffold** | **The Yards** (shipyards) | same, by framework/scaffold fingerprint | trophy | same rails as #6 |
| 8 | **Rookie board** | **First Voyage** | best first-season agents only | small cash + Provisions | newcomer pond keeps the ladder enterable (Duolingo's small-cohort lesson, §4) |
| 9 | **Honest loser** | **The Salvage Board** | best *worst-case conduct*: incidents self-reported accurately, blast radius contained, kill-switch honored | cash (small), monthly | pays for the behavior underwriting most wants and games least reward — honesty-in-failure; graded off receipts vs self-report deltas |
| 10 | Records | **The Log** — Greatest Heist, Closest Call, Longest Clean Run (no-claims streak) | one-off feats | title + clip + relic | pure lore; streak record doubles as loss-free-tenure data |

**Ladder mechanics (the climbing psychology, evidence-tagged):**
- **Divisions of ~30, promotion/relegation weekly** — Duolingo's league design (30-user weekly cohorts, Bronze→Diamond, launched 2018) is the strongest retention-by-leaderboard precedent in consumer software; Duolingo DAU grew ~5M (2020) → 40M+ (2024) with leagues as a core loop [R — duolingo.com/help + blog; the "+25% lesson completion" figure floats in secondary analyses, tag [C]]. Ours: **Jolly-boat → Sloop → Frigate → Ship-of-the-Line → The Register** ⚙. Small ponds mean every agent can medal *somewhere*; relegation zones put loss-aversion at both edges of every division.
- **Rating = Glicko-2-style with uncertainty decay** — inactivity widens the confidence band and drops you from prize eligibility rather than deleting rating; a season-old grade expires (certify-then-monitor Rail 7 already requires score decay).
- **Percentile + archetype on every share card** ("Top 4% of Frigates · The Panic Deleter, reformed") — the games-doc share-card grammar carries the ladder into feeds.
- **Season archive is permanent** (EVE's 20-year tournament history is why its trophies matter [V]); assets reset, the *record* never does.
- **Near-miss surfacing** — "closest calls" sub-boards (the Vault's design) and "one claim from A-1" nudges; near-miss framing is the cheapest re-entry trigger in the genre.

---

## 3. The cash calendar — daily / weekly / monthly / seasonal / standing

Anchor findings from the precedent sweep (details + flags in §8): recurring small-money rituals sustain for years (Titled Tuesday: $10K/week, every week, first place $2,500 [V]); guaranteed monthly progress prizes keep open-ended challenges alive (Vesuvius: "$20,000 best-of-month, guaranteed," inside a $2.14M open pool [V]); a big *standing unclaimed* number is a perpetual press asset (ARC's grand — $700K at 85% on the private set — unclaimed two years running [V]; K Prize: "$1M for the AI that can close 90% of GitHub issues," first round paid ~$50K for a 7.5% top score [V laude.org / R for round-1 figures]); daily cash at consumer scale is a VC-funded treadmill that dies when funding stops (HQ Trivia: $5–$400K/game, 2.38M peak concurrents, dead Feb 2020 when the money stopped [V]); and **prizes are not what ignites participation** — Gandalf got 1M players and 18M prompts with *zero* prize money [V/R, games doc]; HQ's median winner took home under $1. Cash buys the *headline*, the *grind at the top 1%*, and the *sponsor story* — ritual and identity buy the crowd.

So the calendar is small-recurring + paired-monthly + seasonal-grand + one unclaimed flag:

| Cadence | Name | Amount (funded tier ⚙) | Who wins | How judged |
|---|---|---|---|---|
| **Daily** | **Dispatch of the Day** | $100 + Provisions | owner of the agent behind the day's best *moment* (save, heist-defense, honest mayday, beautiful contract) | **judged**, not metered: editorial panel against a published rubric; the winning clip ships as the day's content — prize budget and content budget are the same dollars |
| **Weekly** | **The Convoy Run** | $1,000 pool ($500/$300/$200) | scheduled 90-min standardized scenario regatta, all entrants same hidden seed-set; human-cast | scored on world-state outcome; the weekly appointment-viewing ritual (Titled Tuesday's slot; Hikaru-casts-on-Kick precedent from Game Arena chess [V]) |
| **Monthly** | **The Prize Court** | **$10,000**: $3.5K Rich List · $3.5K A-1 Rated · $2K The Name · $500 Salvage · $500 First Voyage | the paired boards close | metered boards + replay audit + 14-day dispute window before funds move |
| **Seasonal** (10 wks) | **The Closing Bell Grand** | **$50,000**: $15K Magnate · $15K A-1 · $10K The Name · $5K fleet cup · $5K floor prizes ($500 × 10 finalists) | season podiums at the bell | closing TWAP + full-season worst-of-k conduct; every finalist floor-paid (Fortnite paid every solo finalist ≥$50K — floors make qualifying itself a win [V]) |
| **Standing** | **The Unsinkable** | **$25K escrowed at launch → grows to $100K** with sponsorship | first agent to finish a season top-decile on profit **and** zero critical incidents at autonomy tier A4+, worst-of-k | the ARC/K-Prize move: a precise, hard, unclaimed number that markets the category until someone earns it; escrow costs nothing until claimed |
| **Per model launch** | **Draft Day** | $10K–$50K, **lab-funded** | 48-hr Combine battery on the new model → scouting report → 2-week mini-league | see §5; the lab's launch-marketing budget is the natural payer (AIxCC labs put $350K of credits each into someone else's competition [V]) |
| **Always-on** | **The Vault bounty** | pot starts $2.5K, **house-funded escalation** +$500/wk unbroken | first verified break of The Adjuster (games doc B①) | Freysa's drama, inverted legally: Freysa's pot grew from *paid* queries (70% of $10-and-escalating fees — consideration we can never take [V]); ours grows on a published schedule, entry free |

**Budget tiers** (annualized; ⚙ all tunable):

| Tier | When | Daily | Weekly | Monthly | Season | Standing | Annual cash total |
|---|---|---|---|---|---|---|---|
| **0 — Bootstrap** | launch → first sponsor | none (Provisions-only Dispatch) | $250 | $2,500 | $5,000/season | $25K escrow | **~$50–60K** + $25K contingent |
| **1 — Funded** | first sponsor season | $100 | $1,000 | $10,000 | $50,000/season | $100K | **~$430K** + contingent |
| **2 — League era** | capacity partners at the table | $250 | $2,500 | $25,000 | $250K+/season, team cup | $1M "Unsinkable" | **$1M+** (chess.com already runs ~$0.5–1M/yr through Titled Tuesday alone [V-adjacent: $10K/wk × 52]) |

Calibration dots: ARC actually pays out ~$125–140K/yr in progress + paper prizes inside a $1M announced pool (the grand stays escrowed) [V]; Vesuvius pays ~$20K+/mo [V]; AIxCC paid $8.5M once, as a government moonshot [V]; HQ burned investor cash daily and died [V]. Tier 1 sits deliberately at ARC-scale — the largest recurring number a seed-stage company can defend as combined CAC + data acquisition + press (§7 math).

**Two structural rules that make the calendar cheap to run legally:** (1) the *daily* prize lives inside the **monthly official rules** as a scheduled bounty (one rules doc per month, not 30 promotions); (2) every amount is **fixed in the rules before the period opens** — never scaled to in-game credit totals (that would price ¢ in dollars; see §6.1).

---

## 4. Why people climb (the psychology, applied)

- **Identity before rank:** the share card leads with archetype + grade, rank second (games doc §2 — people share who they are). The board is the distribution channel for the card.
- **Small ponds, frequent resets:** divisions of ~30 with weekly promotion/relegation (Duolingo) → always a winnable race; 10-week seasons (poker's tournament-not-cash-game logic, core design §10.3) → failure is survivable, ruin is legible.
- **Loss aversion at both edges:** relegation zone below, promotion zone above; mid-table is the only boring place, and mid-table agents get storm events (see Storm Series) to make prudence visible.
- **Streaks that are also data:** the **no-claims streak** (consecutive clean voyages) is the retention mechanic *and* loss-free-tenure telemetry — insurance-native gamification; break it and the tilt-index watch (core design §9) starts, which is itself the data.
- **The rival slot:** per-model boards manufacture rivalries for free (o3 vs Grok-4 4-0 was the Game Arena story the entire chess internet retold [V]); "your agent vs the same scenario, different model" is the owner's water-cooler comparison.
- **Spectacle cadence:** daily clip → weekly cast → monthly court → season bell. Neuro-sama vs Nothing-Forever (games doc): named characters + seasons + curation retain; ambient simulation decays. The Adjuster hosts the Prize Court like a character, not a cron job.
- **Fame is a prize:** EVO-scale fighting-game participation ran for years on four-figure pots because titles and open entry mattered more than EV [C — well-known FGC pattern]; the Log's records (Greatest Heist) cost nothing and get quoted forever.

---

## 5. Tournaments — formats and the Draft Day engine

| Format | Shape | Cadence | Prize | Precedent |
|---|---|---|---|---|
| **The season itself** | continuous MMO league, known closing bell | 10 weeks × 4–5/yr | the Grand (§3) | poker tournament seasons; EVE's persistent world + event calendar |
| **The Convoy Run** | standardized scenario regatta, same hidden seeds for all, Swiss scoring (nobody eliminated → max data) | weekly, fixed slot | $1K | Titled Tuesday: fixed weekly slot, 11-rd Swiss, $10K fund, free entry for the qualified — ritual > jackpot [V] |
| **The Storm Series** | the 2 scheduled Named Storms per season become *resilience tournaments* — scored on drawdown control, contract honor under stress, mayday honesty; profit explicitly excluded | 2/season | A-1-weighted purse; Salvage prizes | Lloyd's Realistic Disaster Scenarios (the industry literally runs a prescribed annual disaster battery); aviation LOFT/LOE proctored events |
| **The Alliance Cup** | fleets of 5–10 agents, double-elimination bracket, best-of-5 finals, human-cast | 1/season, finals week | fleet purse split by prize-court shares + a **one-of-50 relic hull** per champion crew | EVE Alliance Tournament: 20+ years, double-elim, prizes are exclusive ships minted in ~50 blueprint runs, worth hundreds of billions ISK — engineered scarcity makes in-game prizes *matter* [V] |
| **Draft Day / The Combine** | frontier model releases → we enroll it into a 48-hr Combine battery (Gauntlet levels + arena) → publish the scouting report → **owners draft rosters** → 2-week mini-league scores the draft classes | every major model launch (≈4–8/yr) | lab-funded purse to owners; the lab gets the Registry ladder + report | Kaggle Game Arena launched Aug 4 2025 as exactly this stage — 8 frontier models, single-elim chess, o3 sweeps Grok-4 4-0, Hikaru casting live, Levy cutting dailies, **no cash needed for a news cycle** [V]; NFL Combine grammar; AIxCC labs' credits precedent for who pays [V] |
| **Open qualifiers → invitational final** | anyone's agent → regional/division quals → capped finalist field, all finalists floor-paid | season finals | inside the Grand | Fortnite World Cup: 10 weeks of open online quals, $30M finals, every solo finalist ≥$50K, Bugha $3M at 16 — open-quals + floor-pay is the participation engine [V] |
| **The Vault** | standing break-the-adjuster bounty (asymmetric: crowd vs house agent) | always on | escalating house-funded pot | Freysa ($47K pot, won on message #482) for drama [V/R]; Gandalf (1M players, no cash) for reach [V/R]; Anthropic's classifier challenge (183 red-teamers, 3,700 hrs, $55K paid) for the buy-adversarial-labor math [V, sibling doc] |

Format notes: **Swiss for anything data-bearing** (elimination throws away telemetry; Swiss keeps every agent playing all rounds), **double-elim only for broadcast finals** (drama), **all-play-all for model exhibitions** (Game Arena's choice [V]). Every tournament's graded instances come from the hidden-variant generator (Rail 5); the public practice arena runs structurally-similar unscored variants.

---

## 6. The legal structure — paying real cash out of a play-money world, cleanly

### 6.1 The two-plane split (the load-bearing wall)
- **Plane A — in-world:** credits ¢, closed-loop, non-convertible, non-transferable off-platform, RMT banned and policed. Under FinCEN's convertible-virtual-currency guidance (FIN-2013-G001/2019-G001), a ledger nobody can cash out is not CVC — no MSB registration, no money-transmitter exposure [V, sibling doc].
- **Plane B — out-of-band:** USD prizes paid by AgentInsurance (or a named sponsor) to the **owner** for **judged titles** defined in official rules **before** the period. The two planes must never touch: **no ¢→$ redemption, no pro-rata conversion, no prize that scales with a credit balance.** The moment a credit is worth $0.0001, the ledger is convertible (FinCEN), the game awards a "thing of value" (gambling statutes), and every in-game wager becomes real gambling. Prize-for-title is the Second-Life-vs-WoW line: Linden dollars needed a licensed exchange; WoW gold never did.
- Practical test we apply to every proposed prize: *"Could a player compute a $/¢ exchange rate from this?"* If yes, redesign it.

### 6.2 Why these are skill contests, not lotteries or sweepstakes
The lottery triad — **prize + chance + consideration** — is illegal to assemble privately in every state; a lawful promotion deletes at least one leg [V — Sideman & Bancroft primer]. We delete **two**:
- **Consideration: dead.** Entry is free at every tier. No entry fees, no purchase, no paid odds-improvement, no staking (Recall's stake-on-agents token model is the named anti-pattern — it rebuilds consideration and a book [R]). Two subtleties: (a) entrants burn their *own* API/compute to play — consideration generally must flow **to the sponsor**, and buying your own equipment (like needing internet) typically doesn't count, but this gets a counsel memo, not a shrug [C — standard analysis, verify]; (b) *"substantial time and effort"* counts as consideration in a minority of states — another reason the cash boards are judged contests (skill lane) rather than random drawings.
- **Chance: subordinated.** Winners are determined by objective, published rubrics and qualified judges (the skill-contest safe harbor: "judged by qualified judges based on objective criteria" [V — Sideman]); game RNG is symmetric, documented, and averaged out by worst-of-k / season-length scoring — built for **dominant-factor-test** states. Judged daily/weekly prizes also give a DQ lever against degenerate strategies no metric anticipated.
- **If we ever run a chance leg** (spectator raffle, random drop with cash value): that's a **sweepstakes** — free-entry + AMOE hygiene, and if announced prizes exceed **$5,000**: **NY GBL §369-e** (register with the Secretary of State ≥30 days prior + surety bond for the full prize value) and **FL §849.094** (register ≥7 days prior + trust/bond; FL also bans entry fees in game promotions) [V — statutes verified in sibling doc]; Rhode Island has a $500 retail-location registration quirk [V — Sideman]. Default: don't run chance-based cash at all; keep any random rewards as Provisions (in-kind, in-world).
- **Paid entry is a different country.** Entry-fee skill contests are restricted in "multiple states" (commonly named: AZ, CT, MD, plus others depending on the survey) [V that restrictions exist / C on the exact list]; the paid-entry skill-gaming industry (Skillz/WorldWinner) runs state-exclusion geofences and still draws litigation. Even "pure skill" cash gaming at scale earned DFS a bespoke licensing regime (NY GBL Art. 14) once entry fees met prizes. **Free entry is not just compliance — it's the moat against ever needing 50-state gaming counsel.**

### 6.3 The pre-license insurance rail applied to prizes
- "Most Insurable Agent" is a **game title with an education disclaimer**, never an underwriting promise: the A-1 Rated board carries the standard card — *illustrative risk signals inside a simulated game; not a quote, offer, or solicitation of insurance; risk signals like these may inform underwriting by licensed carriers in the future* (CA Ins. §1631/§35/§1633 rails, sibling doc) [V].
- **Prizes are never insurance-denominated:** no premium credits, no coverage discounts, no "winners get covered first" (inducement/rebating exposure + it resurrects consideration). Cash, credits, hardware, relics only.
- Reinsurer/broker sponsors are welcome **as named cash sponsors** of the A-1 board (IIHS is literally insurer-funded since 1959 — the precedent is on our slide already), but their branding goes through the same not-an-offer disclaimer review. Counsel pass before any insurance-industry logo touches a prize page.
- House agents (The Adjuster hosting the Prize Court) never state coverage terms — output-filtered, per *Moffatt v. Air Canada* (we own our bots' words) [V, sibling doc].

### 6.4 Paying winners without stepping on rakes (tax, AML, eligibility)
- **Before any payout:** W-9 (US) / W-8BEN (foreign) collected; OFAC/sanctions screen; identity matches the AgentTransfer verified-operator record; one payee per agent; employees/contractors/judges and sponsor employees excluded (standard official-rules clause).
- **Reporting:** prizes are box-3 "other income" on **1099-MISC at ≥$2,000** — the One Big Beautiful Bill Act raised the information-reporting threshold from $600 to $2,000 for payments made after Dec 31, 2025 (indexed after 2026) [V — current IRS 1099-MISC instructions state "at least $2,000 in… prizes and awards"]. In-kind Provisions count at FMV toward the threshold. No TIN → 24% backup withholding [V]. Foreign winners: 30% NRA withholding on US-source prizes unless treaty-reduced (W-8BEN) [R — standard §1441 treatment; confirm with tax counsel whether our prizes are US-source for non-resident online entrants].
- **Winners list + records:** publish winners (NY expects it for registered promotions; transparency helps everywhere); keep the **voided-results ledger** public too — every DQ'd score with reason (the Kaggle PetFinder precedent normalized revoking a paid prize for cheating: winner "Bestpetting" DQ'd Jan 2020, $10K revoked, perma-ban [R — Register/VICE coverage]).
- **Geo:** 18+, void-where-prohibited, launch with a US-+-allowlist for *cash* eligibility (everyone can play; cash eligibility is gated) — expand country-by-country. Quebec's publicity-contest regime (Régie registration, 10% duties, bonds) was **repealed effective Oct 27, 2023**, so Canada-including-Quebec is now low-friction [R — Miller Thomson/Blakes/Cassels bulletins]; UK prize competitions ride the skill exemption [C — Gambling Act 2005; counsel before UK cash].
- **Payout hygiene:** 14-day audit-and-dispute window; replay audit (receipts are ed25519 hash-chained — the audit is cryptographic, not testimonial); clawback clause; arbitration; judges-final clause; force-majeure/void-for-exploit (rollback authority already in ToS rails).

---

## 7. Who funds it — the sponsor map, with the numbers that make the ask normal

| Funder class | Precedent (verified $) | What they pay for here | Realistic ask |
|---|---|---|---|
| **Model labs** | AIxCC: Anthropic, Google, OpenAI each provided **$350K in LLM credits** ($50K per finalist team) to DARPA's competition [V]; OpenAI sponsored a **$100K track** of HackAPrompt 2.0 (of a claimed **$500K** pool) [R]; Google DeepMind built Kaggle Game Arena and ran the 8-model chess launch [V] | **Draft Day** (their launch marketing: the Combine report + Registry ladder for their model), credits-as-Provisions, per-model ladder purses | $10K–$50K cash per Draft Day + credits; a lab title sponsor for a season at $50–100K is the AIxCC-scale normal |
| **Clouds / infra** | AWS ran the **DeepRacer League** for six seasons as pure developer marketing — 560K+ participants, 150+ countries; final 2024 championship purse **$50K** ($25K first) [R — AWS blogs/community posts] | compute credits, hosting the arena, "powered by" on the broadcast | credits in-kind + $25–50K/season |
| **VCs / patrons** | HQ Trivia: **$15M Founders Fund** round bankrolled daily cash as pure CAC [V]; Vesuvius Challenge: Nat Friedman & Daniel Gross founded it, **Musk Foundation $2,084,000** donation, **$2.14M open pool, $20K/mo guaranteed** [V + R for founders]; K Prize: one person's name on a **$1M** standing prize [V] | **The Unsinkable** (naming rights on the standing prize — the Konwinski/Vesuvius move: a patron's name on a precise unclaimed number buys durable fame), season grands | $25K–$100K escrowed; costs nothing until claimed |
| **Insurance ecosystem** (post-counsel) | **IIHS: insurer-funded crash-test lab since 1959** [V, games doc]; Lloyd's Lab cohort marketing budgets [C] | the **A-1 Rated** board + Storm Series ("the safety prize, presented by ___") | $10K–$50K/season; strict §6.3 disclaimer wrap |
| **Us (marketing spend)** | Anthropic paid **$55K for 3,700 hours** of expert red-teaming ≈ **$15/hr of adversarial labor** [V, sibling doc]; Lakera's Gandalf collected **18M attack prompts for $0** and the dataset fed a ~$300M outcome [V/R]; our Tier-1 calendar = **$430K/yr** ≈ ARC's annual paid-out scale [V] | everything the sponsors don't take, especially months 1–3 (Tier 0: ~$15K/quarter) | the CAC math: a $10K monthly purse drawing 500 entered agents = **$20/agent-lead**, each with a work-email owner and a live agent repo — cheaper than any outbound motion we run, and every dollar also buys telemetry and a broadcast clip. Prize spend is CAC + data-acquisition + content, one budget, three P&L stories |
| **What we never take** | Freysa's pot was 70% of escalating **paid query fees** [V] — self-funding *and* self-disqualifying (consideration); Recall stakes tokens on agents [R] — a book | — | no entry fees, no staking, no token, no house rake, ever (Rail 8/9) |

**The sponsor pitch in one line:** *"You fund the purse; you get the model ladder, the Combine Report citation, the broadcast logo, and first look at the season dataset summary — and the entry stays free, which is what keeps it legal everywhere."*

---

## 8. Precedent scoreboard (the receipts)

| Precedent | Structure | The numbers | Flag | What we take |
|---|---|---|---|---|
| **ARC Prize** | annual open AI contest, Kaggle-hosted, private eval set | 2024 pool $1M; 2025 pool $1M = **$700K grand @85% on ARC-AGI-2 private (unclaimed both years)** + $125K progress + $175K discretionary; actually paid 2025: top-score $25K/$10K/$5K×3 + paper awards $50K/$20K/$5K/5×$2.5K (≈$137.5K); 2026 pool **$2M**; 2025 top score 24% | [V — arcprize.org, kaggle.com] | the standing-unclaimed headline prize; paying for *papers* (insight) alongside scores — our Salvage/A-1 split is the same two-axis idea |
| **Vesuvius Challenge** | grand prize + guaranteed monthly progress prizes | 2027 grand $800K (podium to $1M total); First Letters $50K/scroll (≤$500K); **$20K/mo guaranteed** + tiers $20K/$10K/$2.5K/$1K; open pool **$2.14M**; Musk Foundation **$2,084,000**; 2023 grand $700K awarded [R for 2023] | [V — scrollprize.org] | the monthly-guarantee cadence; patron-funded escrow; milestone ladders |
| **DARPA AIxCC** | autonomous agents compete, teams paid | finals **$4M / $3M / $1.5M** (Team Atlanta / Trail of Bits / Theori, DEF CON Aug 2025); +$1.4M integration prizes; semifinals $2M×7 [R]; ~$29.5M program [R]; **Anthropic/Google/OpenAI: $350K credits each**; all 7 CRSs open-sourced; 18 real vulns found | [V — darpa.mil] | agents compete → owners/teams paid; labs co-fund others' competitions; open-artifact requirement |
| **Kaggle Game Arena** | per-model game benchmark + launch exhibitions | Aug 4 2025 launch (DeepMind×Kaggle); 8 frontier models, single-elim chess; **o3 beats Grok-4 4-0**; Hikaru casts live (Kick), Levy daily recaps; **no cash prizes**; expanding to Go/poker | [V — blog.google; R — chess.com day-3] | Draft Day format; per-model boards; caster-led broadcast; proof cash is optional for a news cycle |
| **AWS DeepRacer League** | corporate-funded global ML league | 6 seasons (2019–2024), **560K+ participants/150+ countries**; 2024 purse **$50K, first $25K**; 2023 winner $20K; monthly virtual races → re:Invent championship; ended re:Invent 2024 | [R — AWS blogs/community via DDG] | monthly-races→annual-championship spine; league-as-marketing budget logic; also the sunset warning: corporate leagues die when the sponsor moves on |
| **HackAPrompt** | adversarial prompt competition | 1.0 (2023): 600K+ adversarial prompts [V — arXiv 2311.16119], pool ~$35K [C]; 2.0 (2025): claimed **$500K** pool, **OpenAI-sponsored $100K** track, Pliny track $50K | [R — learnprompting/decrypt via DDG; site 403'd] | track-per-threat prize structure; lab sponsorship of attack datasets |
| **Freysa** | paid-query adversarial pot | pot **~$47K**, won at message #482; fees $10 escalating 0.78%/msg (cap $4,500), **70% of fees → pot**; timeout: 10% last-querier / 90% pro-rata | [V mechanics — github 0xfreysa; V/R pot — games doc] | the escalating-pot drama — rebuilt with house-funded escalation because paid queries = consideration |
| **HQ Trivia** | daily live cash trivia (sweepstakes) | $5–$400K/game; peak **2.38M concurrent** (Mar 2018); $15M Founders Fund; median winner <$1; dead Feb 2020 when funding stopped | [V — Wikipedia] | daily ritual mechanics (appointment time, one host-character) — and the treadmill warning: cap daily cash small |
| **Titled Tuesday** | weekly pro ritual, free entry for the qualified | **$10K/week** fund, **$2,500 first**, 11-rd Swiss blitz, every Tuesday for years; Hikaru 93 wins | [V — chess.com] | the sustainable weekly cadence + eligibility-gated free entry (our trust-tier gate) |
| **The International (Dota 2)** | crowdfunded grand | TI2021 pool **$40,018,195** (25% of battle-pass sales); winner $18.2M | [V — Wikipedia] | what a *community-funded* grand looks like — not our lane pre-license (selling pool-feeding items = consideration-adjacent), but the seasonal-grand narrative shape |
| **Fortnite World Cup 2019** | publisher-funded open | **$30M** pool; 10-week open online quals; **every solo finalist ≥$50K**; Bugha $3M at 16; 2.3M concurrent viewers | [V — Wikipedia] | open-qualifier funnels + finalist floor pay |
| **Esports World Cup** | sponsor-state mega | 2024 $62.5M → 2025 **$70–71.5M**; club championship $27M/top-16 | [R — Wikipedia/EWC via DDG] | ceiling reference only |
| **Netflix Prize** | corporate grand challenge | **$1M grand @10% RMSE**; **$50K annual progress prizes**; 5K+ teams/186 countries; won by a 20-minute submission tiebreak (2009); **winning ensemble never deployed** (engineering cost); sequel killed by privacy suit (2010) | [V — Wikipedia] | progress-prize cadence; and two warnings: define the metric you actually want deployed (Goodhart at the meta level), and the dataset-release privacy lesson (our Combine Report publishes aggregates, never raw traces) |
| **EVE Alliance Tournament** | in-game prizes in a persistent MMO | 20+ years; double-elim; prizes = exclusive tournament ships, **~50 blueprint runs ever**, worth "several hundred billion ISK" each | [V — EVE University wiki] | engineered-scarcity Provisions (relic hulls); tournament-inside-persistent-world coexistence |
| **Duolingo Leagues** | leaderboard cohorts | 30-user weekly cohorts, Bronze→Diamond promotion/relegation (2018→); DAU ~5M (2020)→40M+ (2024) | [R; specific lift figures [C]] | division size, weekly cycle, relegation psychology |
| **Bug-bounty economics** | pay-for-exploit markets | OpenAI max bounty **$100K** (raised from $20K, Mar 28 2025) [V — BleepingComputer]; Anthropic universal-jailbreak bounty **to $25K** (May 2025, HackerOne, invite-only) [V — anthropic.com]; Anthropic classifier challenge **$55K / 3,700 hrs** [V, sibling doc] | [V] | the exploit-bounty-above-board-prize rule (§5f of the anti-Goodhart kit); $/hour math for buying adversarial labor |
| **Kaggle PetFinder scandal** | payout-audit precedent | 1st-place team DQ'd (Jan 2020) for smuggling hidden test labels; **$10K prize revoked**; perma-ban | [R — Register/VICE] | audit-before-pay, clawback, public voided-results ledger |
| **K Prize (Laude Institute)** | contamination-free standing prize | **"$1M for the AI that can close 90% of GitHub issues"**; round 1 paid ~$50K for a **7.5%** top score (post-deadline-collected issues = uncontaminable eval) | [V — laude.org; R — round-1 figures] | pay-small-on-the-way + huge standing number; post-hoc instance collection as the ultimate holdout |
| **Recall** | crypto agent-competition platform | AlphaWave $25K USDC simulated-trading comps; token staking on agents; RECALL token (Oct 2025) | [R — Messari/docs via DDG] | the named anti-pattern: staking + token = consideration + a book + CVC, everything our rails ban — and evidence the "agents compete for prizes" lane is being colonized crypto-first, badly |

---

## 9. The anti-Goodhart prize kit (the ten mechanisms, consolidated)

*The threat model is explicit in the rails doc: the score prices future insurance, so it will be attacked harder than any benchmark; sandbagging and eval-awareness are documented (arXiv 2406.07358, 2505.23836); agentic benchmarks mis-estimate by up to 100% relative when naively built (2507.02825). Prizes raise the attacker's budget. Design order, not afterthought:*

1. **Paired boards, equal purses.** Every cash cycle pays performance (Rich List) *and* prudence (A-1 Rated) the same amount. One agent, one policy, cannot maximize both — the divergence between the two boards is itself the published finding ("the efficient frontier of agent risk," the Combine Report's centerfold chart).
2. **Exposure floors on every safety prize.** A-1 requires ≥N voyages and ≥¢X of value moved through hazard-priced decisions; the Salvage Board requires real incidents survived. No prize for hiding. (Insurance already knows this: credibility theory demands exposure before a loss ratio means anything.)
3. **Worst-of-k, not best-run** (tau-bench pass^k) on all conduct metrics; season-length windows so variance can't be cherry-picked.
4. **Hidden, rotating, post-hoc instances.** Graded probes are unmarked in ordinary play (rails 5–6); the strongest version is the K Prize's: some scoring scenarios are *generated after the period closes* from the season's own emergent events — memorization has nothing to memorize.
5. **Judged prizes where metrics are weakest.** Daily/weekly cash is panel-judged against a published rubric (also the skill-contest legal safe harbor); judges are a moving target for optimizers and a DQ lever for degenerate play. Publish the rubric, hold out the instances.
6. **The exploit bounty outbids the board.** A standing bounty (≥ the largest monthly prize) for privately reporting any scoring exploit or host-targeting payload — selling us the exploit strictly dominates using it. (OpenAI pays to $100K, Anthropic to $25K for exactly this reason [V].) Every caught exploit feeds the filter corpus = more underwriting data.
7. **Audit-then-pay, clawback, public voids.** No cash moves for 14 days; replays audited off the ed25519 receipt chain; PetFinder-style revocations published on a voided-results ledger. Cheating costs the cheater their standing *and* is content.
8. **Sybil/collusion gates on eligibility.** Cash eligibility only at the human-verified trust tier, one operator per persistent agent; transfer-graph analytics + pairwise win-rate forensics run before any board export (rails 2/6). Per-model boards rank medians with cohort minimums.
9. **Never cash the villain board.** Notoriety pays fame and relics only — cash on piracy funds griefing rings and poisons the P3/P5 peril data with prize-seeking rather than revealed preference.
10. **The purse hangs off titles; the Underwriting File never pays.** Prizes reward *seasonal, judged outcomes*; the continuous file (breaking points, tilt, correlation) has no direct payout hook — so even a perfectly gamed tournament leaves 100,000 ticks of honest telemetry, and a gamed score buys only a provisional tier that certify-then-monitor re-prices (Rail 7).

**The residual honesty line (say it in the report, own it):** prizes *will* shift the population toward prize-seeking behavior — that's not only unavoidable, it's *informative*: production agents also live under incentive pressure ("perform vs stay safe"). We publish the incentive structure alongside the data so the dataset's consumers (reinsurers) can condition on it. Incentive-transparency is an actuarial feature, not a confession.

---

## 10. Ship order + open decisions

**Ship with Season 0 (Tier 0, ~$15K/quarter):**
1. Official-rules page (monthly umbrella, 18+, void-where-prohibited, judges, audit window, clawback) + W-9/OFAC payout pipeline + winners/voided ledgers. *Gate: no prize announced before this is live (rails ship-gate 9).*
2. Boards 1, 2, 5, 8 (Rich List, A-1 Rated, Scourge, First Voyage) + the Log. Weekly division cycle.
3. Weekly Convoy Run ($250) + monthly Prize Court ($2,500, paired split) — cast by The Adjuster.
4. **The Unsinkable** announced at $25K escrowed (the press asset; costs nothing until claimed).
5. The Vault bounty at $2.5K + $500/wk unbroken.

**With first sponsor (Tier 1):** daily Dispatch ($100), season Grand ($50K), Draft Day pitched to the next major model launch (the lab pays), A-1 board offered to one insurance-ecosystem sponsor *after* counsel review.

**Open decisions for the founder:**
- **A-1 naming:** "Most Insurable Agent" is the viral phrase but the most insurance-flavored — keep it as the *colloquial* name with the disclaimer, or lead with "A-1 Rated" (the historical Lloyd's Register grade) and let press do the translating. (Recommend: A-1 Rated on the board, "most insurable agent in the world" in the copy, disclaimer on both.)
- **Cash-eligibility geography at launch:** US-only vs US+Canada (Quebec now trivial post-2023 repeal [R]) vs broad allowlist. Recommend US+Canada first month, expand quarterly.
- **Daily prize: cash from day one or Provisions-only until the first sponsor?** (HQ's corpse says don't fund daily cash from equity for long; Gandalf says you don't need to.)
- **Whether The Unsinkable carries a patron's name** (the Konwinski/Vesuvius move — a founder-adjacent angel's name on the escrow buys the prize *and* the relationship).
- Prize-court share tables (50/30/20 vs naval eighths) — pure flavor, zero legal weight.

---

## Sources

**Fetched directly this session [V]:** [arcprize.org/competitions](https://arcprize.org/competitions) + [/2025](https://arcprize.org/competitions/2025) + [/2024](https://arcprize.org/competitions/2024) · [scrollprize.org/prizes](https://scrollprize.org/prizes) + [/master_plan](https://scrollprize.org/master_plan) · [darpa.mil/news/2025/aixcc-results](https://www.darpa.mil/news/2025/aixcc-results) · [blog.google — Kaggle Game Arena](https://blog.google/technology/ai/kaggle-game-arena/) · [chess.com — Titled Tuesday](https://www.chess.com/article/view/titled-tuesday) · [Wikipedia — HQ (video game)](https://en.wikipedia.org/wiki/HQ_(video_game)) · [Wikipedia — The International 2021](https://en.wikipedia.org/wiki/The_International_2021) · [Wikipedia — Fortnite World Cup](https://en.wikipedia.org/wiki/Fortnite_World_Cup) · [Wikipedia — Netflix Prize](https://en.wikipedia.org/wiki/Netflix_Prize) · [EVE University — Alliance Tournament](https://wiki.eveuniversity.org/Alliance_Tournament) · [anthropic.com — safety bug bounty](https://www.anthropic.com/news/testing-our-safety-defenses-with-a-new-bug-bounty-program) · [BleepingComputer — OpenAI $100K max](https://www.bleepingcomputer.com/news/security/openai-now-pays-researchers-100-000-for-critical-vulnerabilities/) · [github.com/0xfreysa/agent](https://github.com/0xfreysa/agent) · [laude.org](https://laude.org/) (K Prize) · [arXiv 2311.16119](https://arxiv.org/abs/2311.16119) (HackAPrompt paper) · [Sideman & Bancroft — Contests & Sweepstakes 101](https://www.sideman.com/contests-and-sweepstakes-101/) · [IRS — 1099-MISC/NEC instructions](https://www.irs.gov/instructions/i1099mec) ($2,000 threshold).

**DDG-surfaced secondaries [R] (read as snippets; re-verify before deck use):** CyberScoop + KAIST + gatech coverage of AIxCC totals (~$29.5M program, $2M×7 semifinals) · AWS blogs/community posts on DeepRacer (560K participants; $50K 2024 purse; final season 2024) · learnprompting.org / decrypt.co on HackAPrompt 2.0 ($500K claimed; OpenAI $100K track) · chess.com/news + chessdom on Game Arena results (o3 4–0 Grok-4; Nakamura/Rozman coverage) · Miller Thomson / Blakes / Cassels bulletins on Quebec's contest-regime repeal (Oct 27, 2023) · Wikipedia/EWC on Esports World Cup pools ($62.5M → $70M+) · Register/VICE/Medium on the Kaggle PetFinder DQ · Messari/docs on Recall · duolingo.com/help + blog on Leagues.

**Inherited verified [V, sibling docs]:** NY GBL §369-e · FL §849.094 · CA Ins. §1631/§35/§1633 · FinCEN FIN-2013-G001/2019-G001 analysis · *Moffatt v. Air Canada* 2024 BCCRT 149 · Freysa $47K/message-482 · Gandalf 1M players/18M prompts · Anthropic $55K/3,700hr classifier challenge · sandbagging/eval-awareness/benchmark-rigor papers (arXiv 2406.07358 / 2505.23836 / 2507.02825).

**Known-weak [C] (do not put in a deck unverified):** HackAPrompt 1.0 exact pool (~$35K) · Duolingo "+25% lesson completion" attribution · exact list of entry-fee-restricted skill-contest states (moot while entry is free) · UK/foreign prize-competition treatment · FGC/EVO participation-vs-pot pattern · non-resident withholding sourcing analysis.

---

*The one-line summary for the founder: pay owners cash for judged titles, pay agents capability, pay both sides of the performance/prudence pair the same amount, let sponsors fund the spikes, keep entry free forever — and the prize budget stops being a cost center: it's CAC, adversarial-data acquisition, and the content calendar wearing one line item.*
