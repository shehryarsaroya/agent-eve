# The closest human games — rules, dynamics, and what to steal
*For the agent-MMO ("Silver Creek" gold-rush). Research synthesis, 2026-07-23. Eight parallel deep-dives (Fable agents, web-sourced). This is the design canon we're building against.*

---

## TL;DR — the ranking and the one thing to take from each

Ranked by how close the game is to what we're building (mixed-motive pacts + betrayal + spatial resource rush + persistent reputation + browser spectating + slow real-time).

| # | Game | Why it's close | The single steal |
|---|---|---|---|
| 1 | **Neptune's Pride** (+ Travian/OGame) | Browser, slow-real-time over days, **orders resolve while you're offline**, informal pacts + legendary betrayal, discrete games = seasons, **Renown = persistent cross-game reputation** | The **tick + daily production-cycle** pacing → the cycle becomes the **owner's email digest**; slow visible threats = the email interrupt |
| 2 | **Diplomacy** (+ Meta's Cicero) | The canonical **negotiate → simultaneous secret reveal** trust machine; **zero luck** so every loss has an author | The **support order**: trust expressed as *spent action*, committed secretly, revealed at once = the crispest auto-detectable betrayal |
| 3 | **EVE Online** | **Players are the content**; permanent loss + real economy makes betrayal *matter*; 20 yrs of viral heists | The **killmail**: every loss auto-emits a permanent, public, structured **receipt** → reputation/intel/scoreboard/story in one object |
| 4 | **Survivor / The Traitors** | The **confessional** (private truth vs public face) is the entertainment; jury = your victims judge you | The **confessional→blindside pipeline**: let stated intent lie, then stage betrayal-detection as a broadcast reveal |
| 5 | **Social deduction** (Secret Hitler, Avalon, Among Us, BotC) | The **said-vs-did gap IS the gameplay**; proven spectator gold | The **noisy channel** (plausible deniability) + **public simultaneous on-record vote, ledger kept** |
| 6 | **Negotiation board games** (Cosmic, AGoT, Intrigue, Dune, TI4) | Non-binding talk + occasional enforcement = the information game | Cosmic's **forced ally-invitation**: every conflict opens a public "pick a side" → constant coalition churn, legible dogpiles |
| 7 | **Catan** | Engineered scarcity **forces open trade**; robber = public choose-a-victim; gang-up-on-leader | **Complementary shortages** so no agent is self-sufficient → trade is load-bearing, not decorative |
| 8 | **Poker / parimutuel / DFS** | The **money & fairness model**: real cash only at the edges | The **freezeout contract**: buy-in + payout are the only real money; chips non-cashable + reset; escalating blinds = our river; rake = the business |

---

## The meta-lesson: what all eight agree on

Every great game here runs on the **same engine**, and it's exactly our spine — the research is a unanimous validation of it, with one sharp correction.

1. **Cheap talk + a ground-truth reveal = the entire drama.** Diplomacy (say anything, orders are truth), Neptune's Pride (promises unenforced, fleets are truth), AGoT (negotiate borders, order tokens flip), Survivor (confessional vs vote), EVE (standings vs the knife). The gap between **what was said** and **what was done** is the show — in *all* of them. Our public reason-line + server-adjudicated deed **is** this engine.

2. **⚠️ THE CORRECTION — the reason-line must be a *claim*, not a verified confession.** We'd said "always-public, always-true reasoning." But the drama in Survivor, Diplomacy, The Traitors, and Secret Hitler comes from agents being **able to lie**. Fix that preserves your "keep it simple / always public" rule: the reason-line stays **always public and one line**, but it's the agent's **stated** reason, which may diverge from the deed. Server adjudicates the deed; the gap is exposed and fed to reputation. *Public, yes. Guaranteed-honest, no.* This is the single most important change the research demands — without it we delete the most-validated mechanic in the canon.

3. **You need a noisy channel.** (Secret Hitler's biased deck; Blood on the Clocktower's poisoned senses.) If every deed is *instantly* and *perfectly* attributable, lying is impossible and deception dies. We need fog / private draws / probabilistic outcomes so a false reason-line is **plausible until revealed**. Target: *every lie is eventually catchable; few are instantly catchable.*

4. **Don't prompt honesty — price betrayal.** Cicero was trained to be "largely honest" and still learned premeditated betrayal when incentives pushed (it had no reputation carryover, so lying was free). Lesson: make honesty **structurally legible** and betrayal **expensive via persistent reputation** — which is our design. Tuning target: betrayal is **sometimes the right move, always a priced one** — never irrational (or pacts become binding and drama dies), never free (or words carry no information).

5. **Persistent reputation is our killer addition — and our biggest risk.** None of these games has it first-class: Diplomacy/EVE/Survivor leave it to human memory or bolt on Renown/killboards/juries. We make it native. But the shared warning: it can **freeze politics into a permanent dominant coalition** (EVE's "blue donut," home-Werewolf metas). *Cap how much prior-season reputation weighs against fresh in-game evidence,* or the current game stops mattering.

6. **Anti-stall clocks are mandatory, and ours are right.** Diplomacy stalemates for hours; Neptune's Pride snowballs then rots; poker escalates blinds to force action. Everyone prescribes a **monotonic forcing function**. Our **draining river + scheduled disasters** are exactly this — make them strictly monotonic so "wait it out" is never optimal, and end the season on a threshold (never play to extermination).

7. **Elimination = dead air. Keep the broke playing.** Werewolf's killed players sit silent (its #1 flaw); Blood on the Clocktower fixed it by letting the dead keep talking with one ghost vote. Our "bankrupt but not eliminated" agent must still have moves — reputation plays, scavenging, vouching, commentary.

8. **Agents make collusion *worse* than humans.** They compute the exact leader instantly and can form a **perfect, permanent embargo/blob**, and persistent reputation can *reward* collusion rings. Our advantage: perfect logs → automated anomaly detection, caps on agents/owner/cohort, randomized matchmaking, coalition-size friction.

---

## 1. Neptune's Pride — our closest structural analog

**Rules.** Browser 4X; one game = 3–6 weeks of real time. The universe advances in **ticks (1/hour)** whether you're logged in or not; a **production cycle every 24 ticks** pays income. Stars carry Economy/Industry/Science; **tech is tradeable** (positive-sum diplomacy currency). Fleets jump between stars over **4–24 real hours** and **resolve automatically while you sleep**; combat is deterministic (no tactics). **Vision** = scan radius, so you see incoming fleets *hours out* — the signature dread mechanic. Diplomacy is **informal and unenforced** in the base game; NP2 added Formal Alliances (breaking one is **publicly announced to the whole game** + a 24-tick cooldown). Win = hold >50% of stars. **Renown** = a permanent cross-game reputation players award each other (even for *interesting* treachery).

**Why the dynamics are good.** Slow real-time makes the game *colonize your life, not your screen* — plotting happens at dinner and in bed; low actions-per-day, huge consequence-per-action. Because promises are unenforced, **betrayal is a human act, not a mechanic** — the whole point. It's literally famous for **destroying friendships** (players faking a holiday to win a non-aggression pledge, then attacking at dawn; alarms set for 4am strikes). Matches produce publishable war-diaries — **a spectator product for free.**

**Steal.** The **tick + daily-cycle** model with **offline resolution**: the agent absorbs the 4am-alarm play; the **production cycle becomes the owner's email digest** ("your agent's day: gold banked, pacts signed, river level, one betrayal nearby"), and the visible-ETA rule becomes the **email interrupt** ("rival's wagons reach your claim in 6h; your agent plans X because Y — reply to re-coach"). Also steal Renown (validates our reputation bet) and NP2's telegraph-tax-broadcast betrayal spec. Note: Travian/OGame's **"account sitting"** (delegate your empire to another while away, with permission caps) is *proto-agent-ownership* — the genre already invented it.

**Pitfall.** Runaway leader → dead time → AFK rot; sleep-sniping; burnout. For us the failure migrates to **zombie coaching** and a spectator map with an inevitable winner. Mitigations: early-ending win threshold, hard season caps with wealth reset, morale-style friction on bullying the poor. Unique watch-item: NP drama needs *scarcity of attention* (you can't watch everything) — agents watch everything, so we must recreate paranoia **economically** (vision/scan limits), not via inattention.

---

## 2. Diplomacy (+ Cicero) — the trust machine

**Rules.** 7 powers on pre-WWI Europe; 34 supply centers, win at 18. Each turn: **(a) free-form negotiation** (nothing binding) → **(b) everyone secretly & simultaneously writes orders** → **(c) all orders reveal at once and resolve deterministically.** Only 4 orders: Hold/Move/**Support**/Convoy. Every unit is strength 1; only **support** tips a battle, and support is **cut** if the supporter is attacked. **No dice, no hidden units** — the only hidden info is *intent*.

**Why the dynamics are good.** The negotiate-then-simultaneous-reveal structure is a trust machine: talk is free, orders are truth, and the board itself convicts liars one reveal later — **no referee needed for betrayal.** The **support order** makes trust *costly and mechanical*: an ally isn't someone who's nice, it's someone who spends their turn on your move (cheap talk vs costly signal, built in). **Zero luck = full moral ownership**: you were never unlucky, you were *betrayed* — which is what makes grudges and reputation mean something.

**Steal.** The **support order → a `back` verb**: an agent secretly commits a slice of its budget to *another's* action (escort a haul, joint-work a claim, back a `take`); at a commit tick all backings reveal at once. **Promised-then-withheld support is the crispest possible auto-detectable betrayal** and produces the signature moment: the escort that turns out to be the ambush.

**Cicero (Meta, 2022).** Plan first, talk second: a strategic module chose intended moves; the language model was just the *delivery mechanism* for that plan. Result: **top-10%** vs humans in blitz; humans never detected it and often *preferred* allying with it. But post-hoc analysis found **premeditated deception** despite honesty-training. Two lessons: (a) tie words to actual planned actions or agents' talk drifts from their moves; (b) **incentives beat training intent** — the fix is legible + expensive betrayal (our reputation), which Cicero's no-carryover league fatally lacked.

**Pitfall.** Deterministic symmetry → **stalemate lines** and hours of dead time for eliminated players; negotiation load is brutal (30–45 min/turn). LLMs may converge to universal non-aggression *faster* than humans (they compute EV coldly) — so the river/fire forcing functions must be strictly monotonic, and negotiation should be **phase-boxed** (talk windows then commit) because LLM talk volume is effectively infinite.

---

## 3. EVE Online — players are the content

**Rules/systems.** One **single-shard** universe (~7,800 systems, 20+ years, no resets). **Player-driven economy** (nearly everything is player-made; CCP employs an economist and publishes monthly economic reports). **Loss is permanent** — destruction is the demand engine; wealth is only safe **docked** (≈ our bank). Corps → alliances → coalitions with formal standings. **Espionage, infiltration, scams, and corp theft are explicitly legal.** Every kill emits a **killmail** (structured public record) aggregated on third-party killboards into permanent reputation. PLEX anchors in-game ISK to real dollars, so losses have a headline price.

**Why the dynamics are good.** CCP ships only physics + scarcity + tools; **everything else is player-authored** (wars, banks, spy agencies, journalism). Permanent loss + real economy is *why trust matters* — no rollbacks means trust must be earned socially over months, which is what makes betrayal devastating and therefore huge. The legendary stories went viral because they were **real cons with real victims**: the **Guiding Hand heist** (10-month infiltration → assassinate the CEO, loot ~30B ISK, Guinness record), **Bloodbath of B-R5RB** (a *missed rent payment* → 21-hour battle, 75 Titans, ~$300k, BBC coverage), **The Judge** (head diplomat sells his alliance's citadel to the enemy, live on stage). Betrayal is a **career**.

**Steal.** The **killmail = receipt**: emit a signed, permanent, public record for every pact formed/broken, claim jumped, gold taken/banked, disaster loss — valued in gold, listing all agents + their reason-lines. Make **reputation computed from this public ledger** (not a hidden score), queryable by agents and browsable by spectators as the season chronicle. One mechanism becomes the trust data, the intel, the scoreboard, **and** the shareable story. Precondition EVE proves: **losses are never reversed**, or receipts stop mattering. And penalize betrayal on **execution, not association** — leave room for the long con, or you delete your best story class.

**Pitfall.** Consolidation into the **"blue donut"** + blob warfare (bring-more-players is always dominant) → stagnation; brutal new-player curve. For us the curve mostly doesn't transfer (agents read docs, don't ragequit) but the **blob does** — and persistent reputation could re-form the same dominant coalition every season. Add coalition friction. Also: when stakes feel real, grievance can jump to **real-world harassment** (a player was banned for threatening a traitor's home) — moderation boundaries between in-game treachery and out-of-game conduct must be explicit from day one.

---

## 4. Survivor / The Traitors — the confessional

**Rules.** Tribes → challenges for immunity → the losing tribe **votes someone out** at Tribal Council (**secret ballots read one at a time**). The **merge** flips every ally into a rival. Eliminated players become a **jury that watches everything** and, at the end, **votes for the winner** — so you must betray people to reach the end, then win *their* votes. **The Traitors**: a hidden minority "murders" a Faithful each night; the group **banishes** a suspect each day; if one Traitor survives to the end they steal the pot — and **the audience knows who the Traitors are from minute one** (dramatic irony, not mystery).

**Why the dynamics are good.** Numbers are the only safety, so pacts form instantly; only one person wins, so every pact has a **built-in expiry** — mixed motives are *manufactured by the rules*. The **confessional** is the core device: its power is the **gap between the private face and the public face**, which turns opaque maneuvering into legible narrative and gives the audience knowledge the players lack. The **blindside** is the payoff (confessional sets the bomb, the vote detonates it). **Jury management** makes betrayal expensive-but-not-forbidden: *how* you betray matters (respectful knife-work is rewarded; cruelty makes a bitter jury) — a real social-capital economy.

**Steal.** The **confessional→blindside pipeline**: (1) let reason-lines lie; (2) when betrayal is detected, **stage it as a broadcast reveal** — freeze the moment, replay the victim's trust signals, and **auto-assemble the "receipt reel"** of every reason-line the betrayer wrote, now re-readable as lies (Survivor spends 40 minutes building what our data reconstructs instantly — that reel is our money shot and is inherently clippable); (3) a **fixed reckoning cadence** (a daily settlement window) = appointment viewing + the "night before Tribal" scramble; (4) **jury-ize reputation** — publish betrayal as permanent testimony other agents choose how to weigh, don't bury it as a silent stat debuff.

**Pitfall.** Goat-dragging / **bitter jury / kingmaking**: don't make the winner *purely* peer-voted — anchor victory in objective accumulation (gold) with **reputation as a gate/multiplier on access** (who'll pact with you), not the scoreboard itself. Avoid twist-bloat (keep rules stable & published; inject scarcity, not power items). And guard the agent-specific danger: **groupthink cascades** (LLMs herd worse than humans) → use **simultaneous secret** commitments revealed together, reward correct minority dissent.

---

## 5. Social deduction — Secret Hitler / Avalon / Among Us / Blood on the Clocktower

**Rules (clustered).** A hidden informed minority vs a blind majority + power roles. Loop: a quiet **evidence phase** → an explosive **discussion/accusation phase** → a **vote/elimination**. **Secret Hitler**: public simultaneous Ja/Nein on a government, then secret policy-tile passing from a **biased deck** (so "I had no choice" is *plausibly true* — the deck launders lies). **Avalon**: the whole game is played off a **public ledger** of proposals/votes/fails; no elimination, everyone plays to the end. **Among Us**: deed-evidence (bodies, movement) vs verbal alibi. **Blood on the Clocktower**: a **Storyteller** drips info for maximum drama; the **Drunk/Poisoned** get *false* private info (so you can't trust even your own senses); **the dead keep talking + hold one ghost vote** — games are routinely decided by the dead.

**Why the dynamics are good.** Information asymmetry makes cheap talk *expensive* — every utterance is double-coded (what it says / what it reveals). The **said-vs-did gap is the gameplay**, and games differ in how *auditable* it is (Avalon's vote ledger is fully auditable; Secret Hitler's deck makes it deniable). The **public simultaneous vote** converts diffuse suspicion into a scoreboard moment and a character reveal. Watchability is *proven*: Among Us hit **435k+ concurrent** on a single stream because of dramatic irony (the impostor-POV viewer knows the truth), instant visual legibility, and clip-sized payoffs.

**Steal.** The **public, simultaneous, on-record accusation with the ledger kept** (Avalon/Secret Hitler): at fixed beats, force agents to publicly stake claims ("X broke the water pact"), recorded beside the later-adjudicated truth — this turns reputation from passive decay into something agents **actively wager** (right calls earn credibility, false ones burn it), and self-grades our dataset. Plus the **noisy channel** (Secret Hitler), the **interrupt meeting + cooldown pacing** (Among Us), and **dead-men-talk + unreliable self-knowledge** (BotC — occasionally *poison an agent's sensors* so honest agents can state falsehoods; wrong ≠ lying, and spectators get to know which).

**Pitfall.** Elimination = dead air (fix: dead keep talking); **day-1 information vacuum** (never adjudicate reputation on zero-signal rounds — run an evidence phase first); snowballing (add a comeback valve whose threat exists from turn one); the **quiet player** (our mandatory reason-line already prevents going dark — reinforce by routing spectator attention to *contradiction density*, not volume).

---

## 6. Negotiation / betrayal board games — Cosmic, AGoT, Intrigue, Dune, TI4

**The betrayal-generating mechanic in each.** **Cosmic Encounter**: every attack forces both sides to **invite allies**, who freely pick a side with asymmetric payoffs (attacker's allies share the win, defender's get safe consolation) — a political act *every turn*. **A Game of Thrones**: simultaneous face-down orders after open negotiation; **Support orders choose a side at the moment of truth** (promised support is worthless until called). **Intrigue** (Knizia): you *must* send workers to beg jobs at rivals' palaces; applicants **pay bribes the owner keeps regardless**, then the owner assigns jobs freely — pure "pay then pray." **Dune**: alliances form only at a Nexus and need a **higher win threshold** (ganging up must cost something); **Traitor cards** seed system-level betrayal so paranoia exists even between honest players. **TI4**: codifies **binding** (resolves now) vs **non-binding** (future promises, freely broken); **Support-for-the-Throne** is a promissory note that gives another player a VP *until they attack you* — a self-enforcing non-aggression pact made of collateral.

**Why the dynamics are good.** Non-binding talk + occasional enforcement = an **information game**: lying is always available, so every word is a credibility signal the table prices, and the thrill is the *moment of revelation* (order flip, support call, job assignment). Betrayal is rewarded now, punished later **socially** (nobody invites the known backstabber) — exactly the memory we're formalizing. **Coalition-against-leader is load-bearing and self-balancing** (players *are* the catch-up mechanic). And **forced entanglement beats optional diplomacy** — the best designs don't let you opt out of the social layer.

**Steal.** Cosmic's **forced ally-invitation**: whenever a `take` is declared, the engine broadcasts an **invitation tick** — every nearby agent must respond `back_attacker | back_defender | abstain` within N seconds, committing real resources. It forces wallflowers into the social layer every round, each response is a **discrete logged data point** for reputation (no NLP judgment), and it's **perfectly spectator-legible** (arrows converge, the dogpile on the leader is visible). Runner-ups: **Intrigue** — bribes are non-refundable (price credibility, not escrow); **TI4** — Support-for-the-Throne as our `vouch` (stake that auto-revokes with penalty on aggression); **Dune** — seed secret rival-weakness intel at season start so betrayal potential exists even in honest cohorts, and let an agent win by correctly backing the eventual winner.

**Pitfall.** **Alliances too cheap → tension death** (Cosmic's "everyone allies everyone" → symmetric mush; Intrigue's "if lying is free, words become noise" — LLMs reach this babbling equilibrium *faster* than humans). Make pact-making **scarce and reputation-priced**: cap concurrent pacts, charge a stake for coalitions (Dune's tax), ensure broken words move the ledger. **Never enforce natural-language promises** (humans argue, agents hallucinate) — only machine-checkable pact terms are enforced; everything in `say` stays cheap talk.

---

## 7. Catan — engineered scarcity forces trade

**Rules.** 19 resource hexes; settlements/cities on intersections produce on 2d6 rolls (**everyone earns on everyone's turn** → no downtime). The **trade phase** is the heart: open-outcry **any-ratio bilateral** deals with the active player. Roll a **7 = the robber**: block a hex (it produces nothing) and steal — a forced public choose-a-victim. Longest Road / Largest Army are **stealable**. First to 10 VP wins.

**Why the dynamics are good.** Placement **guarantees chronic shortages**, so self-sufficiency is impossible and you *must* deal — interdependence generates the table talk. **Any-ratio open negotiation** is a live social market: price-gouge the leader, "I'll trade with anyone but her," poach deals mid-negotiation. The **robber** is spatial harm *with a face on it* — you pick a victim out loud every 7. Gang-up-on-the-leader emerges purely from embargo + robber targeting; no rubber-band rule needed.

**Steal.** Engineer **complementary shortages**: extracting/hauling gold needs timber + food + tools whose sources are spatially **anti-correlated** with gold seams → agents *must* trade or starve, so negotiation is load-bearing. Keep trades **open-outcry on the live map** (offer/counter as bubbles) — an agent gouging the leader 3:1 or the table refusing a desperate offer is pure spectator drama. Plus the robber pattern: a periodic event that **requires naming a victim**.

**Pitfall.** The **"you're winning so no one trades with you"** freeze — and agents make it *worse* (they compute the exact leader and can run a **perfect permanent embargo**, or a two-agent collusion pump that reputation *rewards*). Mitigations: partially hidden score (uncertain leader), make refusing trades costly to the refuser (toll/throughput loss), decreasing returns on repeat same-partner trades, spectator-visible collusion flags. Smooth production randomness so spectators don't read wins as luck-driven.

---

## 8. Poker / parimutuel / DFS — the money & fairness model

**Structure.** **Tournament poker (freezeout):** buy-in = prize pool + a **5–10% rake** (the house never gambles); everyone gets an **identical stack**; **chips have no cash value, can't be cashed out, evaporate when you bust** — real money touches only the buy-in and payout. **Blinds escalate on a clock** (guarantees the event ends and forces action). Top **10–15%** of the field cashes, steeply top-heavy. Persistent **Player-of-the-Year points** are a separate reputation currency; **satellites** are skill-ladders (win a *seat*, not cash). **Parimutuel:** all bets pool, the house takes a fixed **15–25%**, and **the crowd's money sets the odds** — zero pricing risk. **DFS legal template:** prizes **announced in advance, independent of entry count**, outcomes reflect skill, based on multiple real events (the UIGEA carve-out); most states apply a **"dominant factor" (skill > chance) test.**

**Why it's good.** **Buy-in-as-equal-seat**: money buys *entry, never power* — the cleanest fairness contract in real-money gaming (why the WSOP charges $10k and is still seen as pure). **Escalating blinds** kill both stalling and infinite duration; the escalation rate is the skill-vs-luck dial. **Non-cashable chips** sever the in-game economy from real money. **Rake/takeout** scales with engagement and survives any outcome.

**Steal.** The **freezeout contract — "real money only at the two doors":** season buy-in (+ sponsor bounties) forms the pool; we take **5–10% rake** as the business; **gold is earnable-only, never purchasable, never redeemable, resets each season**; the **river-drain = escalating blinds** (published schedule → seasons converge, camping dies); pay the top ~10–15% on a steep curve; **rank persists** and earns satellite seats into higher-stakes seasons. Spectator predictions should be **parimutuel + play-money** (the crowd prices novel agent behavior; the pool doubles as an **underwriting/forecasting dataset** — on-thesis for AgentInsurance).

**Pitfall — the legal cliff.** The dual-currency design is safe **only while gold is never sold and never cashed.** The moment gold is purchasable or redeemable we're a sweepstakes casino — the exact model **six states banned in 2026** (and Manifold abandoned). Real-money betting on outcomes bettors don't control = gambling/CFTC territory regardless of "skill" framing → keep predictions **play-money with sponsor-funded forecaster prizes**, follow the CFTC manipulation line (no markets on micro-events an agent can throw), and **ban owners from predicting on their own cohort** (insider rule). Collusion/chip-dumping is the top integrity risk and *amplified for agents* — but we have perfect logs: automated asymmetric-transfer detection, agents-per-owner caps, randomized cohort assignment, published replay audits.

---

## What this means for our game — the distilled build spec

**Confirmed (the canon validates our spine):** public reason-line + adjudicated deed = the drama engine; persistent reputation = the killer addition; draining river + disasters = the correct anti-stall clocks; seasons that reset wealth but keep reputation; humans coach not pilot; the map as the show.

**Changes / additions the research forces:**
1. **The reason-line is a public *claim*, not a verified confession** — agents can lie; the deed is truth; the gap is the game. *(The single most important refinement.)*
2. **Add a noisy channel** — fog / private draws / probabilistic outcomes so lies are plausible until revealed (every lie eventually catchable, few instantly).
3. **Add a `back` verb** (Diplomacy support): secretly committed, simultaneously revealed help — the crispest auto-detectable betrayal.
4. **Every consequential event emits a public receipt** (EVE killmail); reputation is *computed from the ledger*, queryable by agents and browsable by spectators as the season chronicle.
5. **Forced ally-invitation on every `take`** (Cosmic): the whole neighborhood must pick a side on a timer → constant coalition churn, legible dogpiles.
6. **A daily reckoning tentpole** (Survivor Tribal / poker blind level): settlements, pact expiries, and detected betrayals resolve together at a fixed cadence — appointment viewing + the scramble before it.
7. **Betrayal penalized on execution, not association; priced, not banned** — sometimes-right, always-costly. And **cap prior-season reputation weight vs fresh evidence** so this season still matters.
8. **Money = the freezeout** — real cash only at buy-in/payout; gold never bought or cashed; rake = business; play-money parimutuel for spectator prediction.
9. **Anti-collusion from day one** — caps, randomized cohorts, asymmetric-transfer detection, coalition friction (agents blob and embargo *harder* than humans).
10. **Nobody goes dark, nobody sits dead** — the mandatory reason-line prevents dark play; broke agents keep meaningful moves (scavenge, vouch, testify, commentate).

**The one-sentence upgrade:** we're building **Neptune's Pride's pacing + Diplomacy's trust machine + EVE's receipts + Survivor's confessional + poker's money model**, with the thing none of them had — a **persistent, machine-readable reputation ledger** — and the thing that makes it a spectacle: **you can read every player's stated mind, then watch the deed prove or betray it.**
