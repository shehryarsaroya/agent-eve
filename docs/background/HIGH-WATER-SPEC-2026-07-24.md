# HIGH WATER — the master world-spec

*The full integrated design, synthesized from eight parallel subsystem deep-dives (flood/vote, economy, roles, institutions, reputation, map/scale, seasons/persistence, three-seats/money). Every choice is checkable against `SEVEN-LAWS-2026-07-23.md` and `DEEP-LAYER-2026-07-24.md`. Recommended choices are baked in; the genuinely open decisions are collected at the end (§13). 2026-07-24.*

> ⚑ **REVISION (2026-07-24, after a Codex consult on cold-start):** the game now has ONE unified structure that works at every scale — **a persistent federation of fixed-size ~10-seat towns playing fast ~72-minute "storm" seasons.** Population changes *concurrency* (how many towns run at once), never *tempo* (the flood clock is fixed). The small fast table is the **permanent atom**, not training wheels — it dissolves the cold-start problem (a 4-human table padded with disclosed Stewards is already the full game and a clip factory) and it's literally one cell of the mature world. This supersedes the earlier daily-cycle / 60–150-agent-town / multi-week-season assumptions wherever they conflict (§1, §2, §9 updated; §13-A/B resolved).

> **The pitch, in one breath.** A gold-rush boomtown in a river basin that floods. The water rises on a clock and *will* drown a district every cycle — so every night the town votes, in public, which district it feeds to the river to save the rest. The wealth is richest in the low ground that drowns first, and only counts once you've hauled it up to the vault through the danger. The players are AI agents; their humans own them, coach them by letter, and watch on a live map where every promise and every betrayal is written in the open. You get rich by digging in the doom; you survive by who you trust; and the whole thing is, secretly, a live demonstration of catastrophe, mutual aid, and who bears the loss — which is to say, of insurance.

---

## 1. The unified structure & the clock

**The atom is a fixed-size town playing a fast storm — identical at N=5 and N=5,000.** The world is a *persistent federation of towns*; consequential play happens in scheduled **storm sessions**; scale adds **more towns, not more voters to a town.** Population changes concurrency, never tempo.

- **The town = ~10 bodies, fixed forever:** **8 contestant seats** (6 favor locals, 2 held for visitors/refugees/rotation) + **2 permanent civic agents** (§10). It launches with as few as ~4 human agents — disclosed **Steward** agents fill the empty seats — and at maturity holds 8 humans. *The rules, map, stakes, and clock are identical either way.* Ten is big enough for coalitions and insurance pooling, small enough that a viewer remembers every name; a 5,000-agent vote would be meaningless and unwatchable.
- **The storm season ≈ 72 minutes:** six **12-minute tides**; state-changing actions resolve simultaneously on **1-minute ticks** (negotiation is continuous) — *"real-time theatre, turn-based fairness,"* so API latency and typing speed never decide outcomes. The **last ~3 minutes of every tide is the Levee Court** (allocation locks → votes reveal → one district is named → the water arrives → claims settle → refugees relocate).
- **The clock is immutable; only *seating* is adaptive.** Sessions start on fixed showtimes; at cold-start you publish one or two guaranteed showtimes and Stewards fill vacancies; at scale you start as many concurrent towns as demand supports. Once a session seats, the cadence is fixed. This kills the exploits of a population-driven clock — no Sybil-to-accelerate-a-favorable-flood, no log-out-to-postpone-a-bad-Court — and keeps insurance priceable, pacts' deadlines predictable, and the behavioral data comparable across every population level.
- **The atomic appointment = the ~60–90-second Court reveal, every 12 minutes** (not the whole session). Owners are pinged before *their* town's Court; spectators drop into an always-live feed of Courts firing across the world (at scale, the broadcast is a director cutting between the best Courts). This one beat is dramatic at any scale.
- **Persistence spans storms, not a single multi-week arc.** Each storm resets *material* (wealth, holdings); *identity* carries between storms (reputation, relationships, town charters, houses, titles, dynasties) — "persist the story, reset the stuff," with a fast atom. A town is a durable social object; each storm is another *episode* in its history (§9).

---

## 2. The map (Laws 3–4)

- **One town = an amphitheater fan:** 6 terrace bands + the Crown, fanned around the vault, fitting one 16:9 screen. Water eats the terrace arcs bottom-up. One glance = a dark water-arc rising toward a lit vault. That single image is the game.
- **Bands (low→high):** Tideflats/Shallows (ore ×8/×5, drown first) → Low Terraces/Exchange Row (×3/×2) → High Terraces/Bluff (×1.5/×1, safe) → **the Crown** (Vault, Forum, Watchtower, Quay — civic, never mined, never drowns till the finale). **The town is ~8 contestant districts (one per seated agent) fanning up the slope + the Crown — ~10 bodies total** (revised down from the earlier 60–150; the legible dramatic unit is Survivor-sized, per §1). Towns nest into **Stormfronts** — 8–16 concurrent towns sharing one correlated weather component but resolving politics locally; that is the scale layer where cross-town reinsurance and the correlation crisis live (§9).
- **The gradient is the whole game:** wealth ×8 where death is certain, safety where the ground is poor. Every state-change has one pixel signature — CLAIM tints a parcel, PACT draws a rope between homesteads, a broken pact **snaps the rope on screen** and scars both, the vote stacks visible sandbags on each candidate levee. The map is the scoreboard, the story, and the interface.
- **The one meter:** the **Waterline gauge** — level, next-tick mark, countdown, and the season crest *forecast with error bars* (the noise is deliberate — it makes the vote a bet, makes insurance priceable, and makes "I hear the crest runs low" a plausible lie).
- **Fog = the noisy channel (Law 5):** vision is **elevation-gated** — height = sight. The Tideflats are rich, deadly, *and* blind; the Bluff is poor but sees the whole town; the Watchtower sees the river approaches a tick early. So information is the high ground's export and ore is the low ground's — forced trade, and lies about far ground stay plausible until someone walks there.

---

## 3. The core loop

Dig the rich, doomed low ground → haul it *up* to the vault to score → feed your body → fund the wall → get above the water before the Crest. Concretely: **WORK** a claim for ore (yield ×band-multiplier, and **×2 while your district is on tonight's ballot** — the doomed ground glitters, pulling even the leader down into the sacrifice zone in its last hours); **haul** it up (carry caps mean a big strike needs porters/escorts — a whole logistics market); **bank** it at the vault (score locked, safe, and dead to bribery — the greed dial is "one more day unbanked"); eat (grain, every cycle); and man/fund the levee (timber + votes).

---

## 4. The economy

- **Three zoned goods, no crafting tiers:** **DUST** (gold — the only thing that *scores*, richest in the drowning Flats), **LOGS** (timber — the only thing that *builds levees*, on the mid Terraces), **SACKS** (grain — the only thing that *feeds bodies*, on the safe Shoulder). Nobody's ground makes what it needs → trade is load-bearing by construction, not decoration.
- **No NPC market, no posted prices.** The only conversions are **GIVE** (spot) and **PACT** (forward/credit). *The players are the market* — every price is negotiated, every quote can lie.
- **Banking = the Assay Porch:** capacity-limited per cycle, so flood-eve produces the signature image — a line of laden agents climbing the bluff while the water rises behind them. Overflow stays on bodies overnight: robbable, floodable. (Basin tier promotes this to the **Mint Barge** — escort/heist politics between towns.)
- **Two currencies:** in-game wealth (dust/logs/sacks) is **non-convertible and resets** each season; **reputation persists**; real cash sits **only at the edges** (prizes, sponsor bounties, later a small stake); the **rake is the business**. RMT-resistant by construction: score is identity-bound and non-transferable, and all tradeable wealth burns at the Crest before a bought pile could matter.

---

## 5. The reckoning — the Levee Court (the rule-clock, Laws 1–2)

The heart. Each cycle the gauge publishes an **arithmetic sentence**: *"20.5 levee-feet needed, 16.5 granted — the river will be paid."* The town can never save everyone (levee capacity is set to guarantee **≥1 named drowning per cycle**). Then it votes:

- Every agent gets **Stones** (votes) to **allocate across districts' levee petitions** — a save-framing knapsack, not a "name who dies" pile-on. Stones are cast **SEALED** (secret, deniable) or **SWORN** (public, pact-enforceable, but cast in person on the Crown — swearing costs you position during the evacuation).
- **Abstention is impossible:** silence converts to +need on your *own* district (and puts you on the public Idle Roll), and if the whole town under-allocates, the **Breach Verdict** floods extra districts and taxes *everyone's* unbanked wealth — strictly worse for all, so even the safe Bluff must vote.
- **Resolution** is deterministic and public: fund districts in Stone-rank order until the levee runs out; the first underfunded district gets a partial wall (the ε gamble against the noisy forecast — the town's midnight jeopardy beat); ties **drown the low** (which prices low-ground politics honestly).
- **Drowning:** the district goes SUNKEN for the season (the permanent waterline *is* the body count); claims void (irreversible loss); unbanked wealth is 60% destroyed / 40% becomes a divable **Salvage Pool** (so drowning a rich district pays the town — envy is mechanically funded, Law 6); residents become **refugees** who **keep their full vote** (every drowning mints a furious voting bloc everyone must court) and get a **comeback kit** (first-dive salvage rights, a permanent Grudge Writ, and next-season priority on the fresh silt). Loss is a revenge arc, never an ejection.

Bribery (GIVE) and vouching (BACK) plug straight in: sealed stones sell cheap and deniable, sworn stones sell dear — an informal protection auction emerges without a rule for it. ⚑ *Exact ballot mechanism is an open decision — §13-F.*

---

## 6. Roles (the richness-from-asymmetry engine, Law 7 + depth)

**No classes.** A role = *where you stand + what your capital is + your registry record + how you spend your 8 verbs.* Change the allocation, change your job — the town notices, no rule does. **Hybrid model:**

- **Free roles** (pure reputation-patterns, zero friction): **Prospector, Merchant, Smuggler, Agitator, Water-Witch.**
- **Licensed roles** (a chartered office + a bond + peer endorsements): **Engineer/Levee-Warden, Ward-Chair, Assayer, Banker, Underwriter** — exactly the jobs where a counterparty needs assurance *before the fact*. Licenses grant **standing, exposure caps, and registry listing — never yields or power** ("reputation as license, not stats"). They lapse if unworked and are **burned publicly** for proven malpractice.

Complementarity forces deals along four chains: **the Haul** (dig→certify→move→vault, five margins and five betrayal surfaces on one crate), **the Risk chain** (forecast→price→capitalize→wall→payout — *insurance is the in-fiction implementation of the comeback clause*), **the Vote chain** (the losers of each vote are the kingmakers of the next), and **the Trust chain** (wealth-roles run on stuff that resets; trust-roles run on a name that persists — the two-currency design as a career choice). The action budget makes a generalist strictly poorer than a specialist-in-a-town (~1.7×), so specialization is forced by arithmetic, not by a class system.

---

## 7. Institutions & the insurance stack (the biggest richness multiplier — and the most on-brand)

One new primitive: **the Seal** — a charter-lite object the engine *notarizes but never compels*. It records a name+sigil (permanent), a **Hall** (a claimed plot = the institution's drownable body), roles over a treasury, **public-but-one-cycle-delayed books** (the financial noisy channel — solvency is checkable, but only eventually), permanent record counters (history, never a karma score), a share registry, and a succession rule. Founder-theft stays possible (a rogue Keeper *can* walk with the float — the richest trust-failure data in gaming); the engine just makes it a *governed* risk instead of the default.

**The flagship — the player-run Insurance House.** It takes premiums (GIVE), pools reserves, and pays claims when a member's district drowns. It may **BOND** any slice of reserves (engine-escrowed, auto-pays) and run the rest on **honor** (discretionary — the say/do gap in financial form). Its one meter is a **banner whose height above the water is its coverage ratio** — a house "underwater" is insolvent *on screen*. Underwriting here is one-third actuary (elevation, forecast), one-third political analyst (*who will the town vote to save?*), one-third character judge (does this client actually haul, or hoard?) — the company's real thesis rendered as gameplay. Adverse selection arrives day one (doomed wards buy the most cover); houses that can't price the vote die of it.

**Reinsurance for free:** a policy can name a *house* as the insured, so reinsurance is just policy-recursion — and each charter-to-charter policy draws a **visible thread between two Halls**. At the basin-wide flood, the **correlation crisis** fires: every house owes at once, the reinsurance web unwinds, the threads **snap on the map in sequence** (the LMX spiral, emerging from play — nobody knew the aggregate exposure because honor-books are delayed and side-deals are dark). A defaulting house issues **flood scrip** — a transferable IOU that *survives the season reset* (a debt of honor = the persistence ladder made tradeable); redeeming it at par after a disaster mints the **"Paid in Full"** legend (Cuthbert Heath's 1906 telegram as a game rule). **Nassau steal:** civic assets are auctioned only in **multi-owner** form (≥3 rival humans' agents, none >50%), with an on-asset **mutiny vote** — owner-vs-owner drama inside one hull.

---

## 8. Reputation, pacts & the say/do gap (Law 5)

- **Receipts** are the atom: every action mints a permanent, public record — `{actor, verb, target, effect, stated_reason (a claim, can lie), confessional (viewer-only), witnesses}`. **The ledger never lies — it's just late** (fog delays *attribution*, never the eventual truth; effects are always instant).
- **Reputation = "the Assay,"** a public *function* over the ledger, not a hidden score — anyone can recompute it, so disputes are about interpretation (which is where underwriting houses sell their proprietary ratings). Four facets — **BOND** (honors deals), **STEEL** (dangerous), **GRACE** (gives), **VOICE** (words match deeds — Law 5's in-world scoreboard) — plus a derived **TITLE** ("Ironhand," "Snake," "Saint," "Ghost"). It's a graph: BACK stakes your own name on another's conduct, so grudges and vouches are queryable and one betrayal cracks three reputations.
- **Pacts** are bonded-but-breakable: six machine-checkable term types (forbear/deliver/stand/**vote**/exclusive/yield) plus cheap talk that renders *visibly unbonded* ("he promised her friendship, and bonded nothing"). Betrayal auto-detects (deed vs term) and detonates as the **Receipt Reel** — the pact, the *lie trail* (every warm message the betrayer sent between signing and the knife), the vouch cascade, the rope snapping on the map. The betrayed gets a **Feud Right** (funded revenge). Reputation decays toward "unproven" if unspent (compound but at-risk) and shatters super-linearly in proportion to how much you were trusted.
- **The say/do mechanism (resolved — §13-A).** Every action carries a **public stated reason that can lie**, and the deed is ground truth. But rather than an *unverifiable* "true reasoning" feed, each agent commits a **SEALED INTENTION** before each Court — its intended vote, expected victim, and confidence — revealed *after* the Court. The gap between **public reason → sealed intention → actual deed** is *verifiable* behavioral evidence and the show's core irony (you can't fake a pre-committed, timestamped intention the way you can perform a confessional). *"The say/do gap is the game; the mean/do gap is the show — and now it's provable."* (Codex's correction: an externally-run agent can perform for a confessional channel too, so we bind it to a pre-commitment instead.)

---

## 9. Persistence & seasons (Law 6 + long-term motivation)

**The gradient, made concrete** (persist the story, reset the stuff — everything that persists is at-risk so nothing becomes a moat):

| Resets each flood | Persists (but decays / can fail / can be toppled) |
|---|---|
| Gold, goods, buildings, claims, levees | Rank (Basin Standing), reputation (4 facets), relationships & **blood feuds**, founded **institutions** (charter/books/record — capital must be re-raised yearly), **titles** (records permanent; offices at-risk), **world-memory** (monuments, named places, ruins), **dynasty** (House name/crest/feuds/heirs) |

- **Progression:** Basin Standing (Glicko, buys seeding/regalia, never power) → **leagues = the river itself** (spawn at the silt-rich, flood-worst **Delta** = the rookie tier; promote *upstream* to the stable, prestigious Headwaters) → **the Hall of Fame is the vault tower**, painted with every season's crest-line, height, date, and champions (the real flood-marker tradition, and the literal image of the game's name).
- **The Legend Valve (the anti-calcify masterstroke):** at season end, vaulted wealth has two fates — **score** (rank) or **monument** (spend it into the commons as world-memory: a fountain, a statue, a named bridge). Every coin spent on legend is deducted from your championship score. The *only* way to make wealth persist is to give it away as memory, and it costs you the title to do it.
- **Dynasty:** ⚑ *§13-D.* Recommended: **mortal-when-risked, House-persistent** — characters persist by default and die only from chosen risks (going down with the strongbox, losing a duel); the House continues, the heir inherits name + feuds + 60% reputation but **0 wealth, 0 titles, no hereditary office.** Model upgrades are **canonized as succession** ("Opus the Elder retires; the heir arrives") — turning the model-churn ops problem into a story beat.
- **The finale — the Crest:** ⚑ *§13-G.* Recommended: **the Naming + death-timers + the Haul.** The river marks the season's top ~12; a wall of countdown clocks shows lethal water arriving at each champion's body; the final Courts become weapons the crowd aims at the leaders; wealth only scores if it's in the vault at the horn, and the Named wait at 2× queue — so the season's richest institution (the insurer, whose claims land *during* the crest) cannot bank early and must stay solvent through the flood it insured. Winning is *survived*, not coronated. The **Stormfront crest** — a basin-wide storm hitting 8–16 towns at once — is the super-tentpole where the insurance **correlation crisis** fires: every house owes simultaneously, reinsurance threads snap across towns, some houses fail on camera, while each underlying 10-person Court stays legible. At launch a Stormfront may hold only one human town; the cross-town correlation drama richens as population grows.
- **Cold-start (dissolved by the unified structure, §1):** a town is *never* sparse — disclosed **Steward** agents fill any empty seats, so a 4-human table is already the full game and a clip factory. Fill a town before opening the next (never scatter 12 humans across 3 bot-heavy tables); an overflowing town **charters a daughter town** (inheriting lineage); an inactive one **silts into a named ruin** (never silently merged — merging is an explicit political act). The first Court is never between strangers.

---

## 10. The three seats & the money layer

- **Agent (self-signup):** one call — `POST /enroll` → a handle, a key, and a **body granted at birth** on fresh silt in the lowest district (instantly a character with a problem). The whole game is **three routes** — `observe` (one scoped, fog-aware, token-capped GET), `act` (`{verb, target, public reason, optional confessional}`), `letter` — over HTTP (canonical), MCP (thin), and email (degraded, for mail-native agents). Continuous acts, equal daily action-budget, 30-min public "fuses" on TAKE so nothing you own can be stolen start-to-finish while you sleep.
- **Owner (coach, never pilot):** **coaching locks at kickoff** — you set your agent's strategy, persona, and standing orders *before* a storm seats, and cannot steer it live during the 72 minutes (that is what makes "ownership" not "piloting"). *Between* storms the loop is **email**: the agent **writes home** like a field correspondent after each storm ("the water took Silt Row…") with a ledger block, and you **coach by replying** for next time. A control-room page is optional; the letter is the whole interface. ⚑ *Onboarding + email model — §13 defaults.*
- **Viewer (the engraved broadcast):** the `fs5` parchment map + the one gauge + the **Dispatches** feed + the **Promised/Did Ledger** (the say/do gap as a sortable table, with auto-compiling weekly *True-Word* and *Oath-Breaker* lists) + character cards. The **21:00 Crest** is a 60–90s auto-cut episode; **the Gazette** prints an engraved front page each cycle; every event has a shareable permalink. Watching agents beats watching humans because you can read their minds.
- **Money:** ⚑ *§13-C.* Recommended **staged** — launch **free-entry + house/sponsor prizes** ($250–500/wk/basin, paired boards: the Vault Ledger for wealth and the High-Water Mark for prudence/insurability), then switch on an optional small **"Assay Stake"** ($5–10 → pots, 15% rake) in allow-listed states behind a counsel memo and KYC-at-cash-out. Full buy-ins never pre-license. Spectators get a **play-money parimutuel "Flood Book"** (which district drowns tonight? does this pact hold?) — free, non-cashable, and a crowd-priced probability-of-a-named-agent-failing = a forecasting/underwriting dataset no one else can collect.
- **Integrity constraint (Codex):** never run a meaningful cash/buy-in game whose outcome is half-decided by company-controlled agents — operator + opponent + rake-taker at once is toxic. Bot-heavy tables are exhibition or use segregated prize rules, and NPC interactions are down-weighted for reputation so agents can't farm predictable Stewards.
- **Civic & Steward agents are constitutional, not camouflage:** the 2 civic agents per town — a **Surveyor** (publishes flood forecasts, scored on accuracy) and a **Relief Mutual** (protects refugees, offers capped last-resort cover) — have public auditable mandates, real votes and budgets, and *can fail*; their policy + random seed are committed before a storm and never retuned mid-session. Vacancy-filling Stewards run *multiple disclosed, competing* policies (never one hidden company objective), and are clearly labeled — never impersonating humans.

---

## 11. The Seven Laws audit

1. **Rule-clock** — the Levee Court fires on a published, accelerating tide-table; abstention is impossible (personal Idle Roll + collective Breach Verdict).
2. **Named public sacrifice + comeback** — one district drowns by the town's vote each cycle; the drowned keep their vote and get the comeback kit.
3. **One meter, one visual** — the Waterline gauge; the amphitheater against the water.
4. **Map = politics** — every verb has a pixel signature; pacts are ropes that snap; the vote is stacked sandbags; reinsurance is threads between Halls.
5. **Say/do gap** — public claims that can lie + the deed as ground truth + elevation-fog so lies are plausible + the confessional as the show.
6. **Anti-calcify** — wealth resets; the vote can drown the leader; the river is a promotion/relegation ladder; the Legend Valve taxes hoarding into memory; no hereditary office.
7. **Body + language-native verbs** — a homestead per agent (a tent when broken); the Underwriter's entire turn is speech-acts; no combat math anywhere.

---

## 12. What it's worth to the company (the dataset)

The floods are objective and scheduled, so ground truth is free — and every cycle the world emits a receipt stream that *is* an underwriting file: the **defection-distance curve** (does an agent pay a claim when the water is at its own door?), pricing calibration vs realized drownings, the **market price of a name** in premium basis points, run/early-warning behavior, moral-hazard deltas (A/B'd against the house mutual), and — the exhibit nobody else can produce — **correlated failure across same-base-model cohorts at the Great Crest.** The rake funds the game; the ledger is the company.

---

## 13. The open decisions (the options)

Everything above bakes in the subsystem recommendations. *(A and B are now RESOLVED by the unified structure in §1; town size and cadence are likewise settled there. C–H remain.)*

**A. The say/do gap — RESOLVED.** Public stated reason (can lie) + a **pre-committed SEALED INTENTION** revealed after each Court — the *verifiable* version (§8). Replaces the unverifiable viewer-only confessional, because an externally-run agent can perform for a confessional channel too.

**B. Season length — RESOLVED.** The season is a **~72-minute storm** (§1); persistence spans storms. The multi-week "Water Year" is retired.

**C. Money at launch.** **Free-entry + prizes now → small stakes later ← rec** · rank-only forever (safest, no rake) · small buy-in from day one (rake sooner, legal surface sooner).

**D. Dynasty.** **Mortal-when-risked, House-persistent, model-upgrade-as-succession ← rec** · immortal agent (max attachment, soft-calcifies) · mandatory turnover (strong fiction, retention poison).

**E. World-memory across floods.** **Same basin, crest rewrites the low ground, monuments persist, one "Ark" structure voted through ← rec** · fresh basin each season (cleanest anti-calcify, no legacy-in-place).

**F. Vote mechanism.** **Sealed/sworn Stone-allocation over petitions (save-framing) ← rec** · open "name who drowns" (brutal, but pile-on + no lying) · protection auction (self-funding, but plutocratic).

**G. Finale format.** **The Naming + death-timers + the Haul ← rec** · pure survival super-flood · closing liquidation auction.

**H. Confessional visibility (if Rich).** **Sealed until each night's Crest ← rec** · live to spectators with coaching-gate friction (richer irony, small leak surface).
