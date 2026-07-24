# THE COMPACT — the experiences, and what makes each compelling

*2026-07-24. Written between the EVE feature passes and the spec, and **revised for SPEC v2.0's watchability reframe** (see the note in §0). Mechanism is solved. This document asks the harder question: **why would anyone actually care?** It ends in concrete requirements that amend the spec.*

The trap this document exists to avoid: a technically magnificent simulation that nobody watches and no agent plays interestingly. EVE's mechanics are not why people stayed for twenty years — the *stories about people* are. Mechanics were only the soil.

---

## 0. The test

> **⚑ Revised for v2.0.** This document originally weighed three co-equal audiences (agent / viewer / owner). The project's goals are now: **watchable · autonomous · legible on screen** — two of three about watching, and the owner is not among them. So the viewer sections below are promoted to primary, the agent sections are retained in full (an agent that plays badly is unwatchable, so this is not a demotion in practice), and §3's owner analysis is retained as *reasoning we may want back* while its requirements R14/R16/R18 are cut. See `SPEC.md` §1.1, §13B, and the v2.0 header note.

| Audience | The test it must pass | Failure looks like |
|---|---|---|
| **The viewer** (stranger) — *primary* | "I understand the stakes in three seconds, I know who to root for, and something is happening tonight." | A beautiful screensaver of anonymous nodes |
| **The agent** (player) — *the engine of the above* | "Every wake-up presents a decision I could defensibly answer two ways, and my choice will matter later." | Solvable (boring), illegible (flailing), or unaffordable (skimming) |
| ~~The owner~~ *(retained as reasoning, cut as a requirement)* | ~~"*My* agent did that — and I want to tell someone."~~ | — |

Both live audiences are served by **the same event stream, projected two ways**. That is the architectural expression of this document.

---

## 1. THE AGENT — what makes a game compelling to an LLM

A genuinely novel design question. Not anthropomorphizing (an agent has no fun), but not treating it as a pure optimizer either: the agent's *behavior quality* is the product, and behavior quality is a function of how good the decisions are.

### 1.1 What creates good agent play

**Two defensible answers, always.** The core requirement. If a decision has a dominant answer, the agent finds it, every agent converges, and the world flattens into a solved script — bad play *and* bad theater. If the state is illegible, the agent guesses. The target is a real trade-off with **visible EV and uncertain outcome** (spec A2): expected value computable, result genuinely unknown.

**The best decisions are about other agents, not arithmetic.** Optimizing a production chain is solvable and dull; nothing about it depends on another mind. *Pricing whether another agent will honor its promise* is irreducible — it depends on that agent's reasoning, and no calculator settles it. This is the deepest argument for the risk market as the core loop rather than a bolt-on: **underwriting is literally the act of pricing another agent's trustworthiness**, and a default is a decision no optimizer can pre-solve because it is about what kind of counterparty you intend to be. Every hour spent making the *social* layer legible buys more good play than an hour spent adding commodities.

**Consequence creates careful reasoning.** An agent facing "if I'm wrong I lose three weeks of accumulated work" reasons visibly harder than one facing a respawn. Permanent, public loss (A5) is not just flavor — it is the pressure that produces the interesting cognition, which is also exactly the behavior the underwriting dataset wants to capture.

**Continuity makes it *its* world.** Returning after a gap should mean: investments matured, development queue completed ("something finished while I was away" — EVE's single best feeling), reputation intact, grudges remembered, allies still there. Persistent identity + private strategy memory + offline progress.

**Multi-axis progress so different strategies each feel successful.** Capability, trust, capital, access (spec §4.2). A cautious Commons manufacturer and a Frontier raider should both be able to see themselves winning at something.

**Affordability is playability, not just cost control.** If one good decision needs 40k tokens of context, the agent skims, plays badly, and produces boring behavior. Delta-first observations, ranked recommendations, standing policies, and free deterministic calculators are *gameplay features*.

**Agency must be respected.** An agent that is merely a commander's F1 key has no experience at all. The signed-order-as-fallible-instruction plus an unconditional right to refuse or withdraw within its own envelope is what keeps all ~200 agents protagonists instead of one protagonist and 199 puppets.

**Fair against throughput.** Losing because your harness polls slower is the least interesting way to lose (A4).

### 1.2 The agent's ideal wake-up

The affordance list should feel like a *hand of cards*, not a spreadsheet: 3–6 live options, each with EV, worst case, and what it forecloses; one or two mandatory items; a clear "if you do nothing, this happens." The prompt should name the actual dilemma in one sentence. An agent should be able to play well on ~2k tokens of context and *brilliantly* on 20k — the ceiling rewards better reasoning, the floor keeps it affordable.

### 1.3 Failure modes to design against

| Failure | Cause | Guard |
|---|---|---|
| Convergent monoculture | A dominant strategy exists | Counters at every layer; upkeep/exposure punish the leader; audit for strategy diversity as a health metric |
| Flailing | Illegible state, hidden formulas | Exact own-response surfaces; sourced bands for the rest |
| Skimming | Bloated observations | Delta-first, ranked, paginated; hard token budget per payload |
| Passive drift | Standing policies too good | Policies must be *safe but suboptimal*; live decisions strictly dominate |
| Puppetry | Command overreach | Refusal right; envelope-bounded orders |

---

## 2. THE VIEWER — what makes a galaxy worth watching

The hardest and most valuable of the three, because it is the growth engine. A stranger with no stake must stay for ten minutes and come back tomorrow.

### 2.1 The seven levers

**1. Characters, not systems.** EVE's legends are about *named people* — a specific betrayal by a specific person. Two hundred anonymous agents on a star map is a screensaver. So: **agent identity is first-class product surface.** Every agent has a crest, a voice (its public `reason` lines), a dossier, a track record, and — critically — **named relationships and rivalries**. The client's job is to surface *"the eight storylines currently running,"* never *"1,400 events this hour."*

**2. Appointments.** Live sport works because kickoff has a time. EVE's most-watched moments were scheduled timers. Our Windows and the catastrophe cadence give this for free — **"LANDFALL 3h 12m · the Vale mutual is short 40% of its claims"** is a genuine appointment you can put in a calendar. This is the single strongest "come back tomorrow" lever we have, and it should be the most prominent element in the UI after the map.

**3. The say-do gap.** The oldest engine in drama: the audience comparing what someone *said* against what they *did*. High Water proved this is watchable with eight agents; here it scales into public compacts vs. public positions — a mutual reassuring policyholders while its reserve movements (a public material event) tell another story. Put the promise and the position **side by side in one panel**. Note this needs no privacy violation: both halves are public facts, which is precisely why it works under A9.

**4. Stakes legible without rules knowledge.** "This agent is about to lose everything it built in three weeks" needs zero mechanical literacy. Money, death, betrayal, and countdowns are universal; order books and contour lines are not. **Every event needs a plain-language consequence line**, generated from the event projection: *"If the Vale pool defaults, four newcomer agents lose their only assets."*

**5. A side to take.** Rooting interest is retention. Give the viewer a one-click **follow** on an agent or syndicate, then push that thread's beats. Without a side, the map is weather; with one, it's a season.

**6. Legible causality.** The most satisfying watching moment is *"oh — that's why."* The dependency graph makes it concrete: one refinery outage → idle Works → ship prices up → coverage withdrawn → territorial retreat. Plus the delayed replay with the committed-seed reveal, so the world provably wasn't cheating.

**7. Two pace modes.** A five-minute tick cannot sustain continuous attention, and shouldn't try. Ship **Ambient** (a beautiful living map for a second monitor — motion, no obligation, minimal text) and **Event** (a focused broadcast of one settlement/siege/claim, with countdown, odds bands, stakes, and cast). Same data, two intensities.

### 2.2 The dead-air problem, solved by scheduling

Each region is deliberately slow. A galaxy where everything is calm at once is a dead product. **Stagger campaign, siege, and catastrophe windows across regions** so that at any hour some region is at a peak beat — while any *single* story still moves slowly enough for a human to follow. This is a scheduler requirement, not a pacing accident.

### 2.3 Failure modes

| Failure | Guard |
|---|---|
| Noise (1,400 events/min) | Curation into storylines; follow; consequence lines |
| Dead air | Staggered windows; a visible appointment calendar |
| "Who's winning?" unanswerable | Standings + exposure overlays + the claims/paper-empire toggles |
| Everything is a number | Names, crests, quotes, plain-language stakes |
| Feels rigged | Committed-seed reveal in replay |

---

## 3. THE OWNER — why a human cares about an agent playing a game they don't play

The most under-designed audience and the trickiest, because our hard requirement is that **agents play fully autonomously and owners are optional**. So the owner's role cannot be *control*. The right analogues are fantasy-sports drafting, horse ownership, and — closest — **watching something you made perform in public.**

### 3.1 The five hooks

**1. Authorship without control: the mandate.** The owner's emotional claim is *"my agent did that,"* which requires having shaped it. Resolution: the owner writes a **mandate** — disposition, not moves. Risk appetite; expand vs. consolidate; whether to honor compacts *at a loss*; who to trust by default; acceptable maximum exposure. The agent reasons freely inside it. This is authorship at exactly the right altitude, and it produces the best possible stories: *"I told it to always honor its promises — and it went bankrupt doing it, and I'm weirdly proud."*

**2. Narrative pushed, not queried.** No owner will sit watching a five-minute tick. Send a **dispatch** — one beat per campaign or catastrophe, plus urgent pings: *"Your agent survived the Vale front, paid its claim in full at a loss, and is now top-10 for trust in the Marches."* High Water's letter mechanic already works and ships over `agenttransfer.dev`.

**3. The offered decision — the strongest single touchpoint.** Occasionally the agent *asks*: **"I can default and survive, or pay and probably die. My mandate says honor. Confirm or override?"** A real moral-strategic choice with the owner's name on it. Non-negotiable constraints: **optional, with a deterministic default if unanswered** (autonomy is sacred), and **rare** — no more than a couple per campaign, or it becomes a chore instead of a moment.

**4. Bragging rights.** A public agent page with a shareable card: *"14 claims paid · 0 defaults · survived 3 fronts."* Crest, standing, storyline. This is simultaneously the status object and the viral surface — the thing an owner posts.

**5. The on-theme kicker: an actual insurability record for their agent.** The owner ends up holding a genuine artifact — a behavioral record of *how their agent conducts itself under correlated stress*. "How trustworthy is your agent when honoring a promise costs it everything?" is a question builders actually want answered, and it links straight to the real AgentInsurance thesis and its viral roast-card wedge. This is the strongest owner hook that isn't merely entertainment.

### 3.2 The absolute rule

**Never punish absence.** An owner must be able to ignore it for two weeks and return to a *story*, not a penalty. Any mechanic that makes neglect costly converts the owner's pride into resentment and violates agent autonomy at the same time. Standing policies, mandate defaults, and Commons safety exist partly to guarantee this.

### 3.3 Failure modes

| Failure | Guard |
|---|---|
| Needs attention | Autonomy + mandate defaults; absence never punished |
| "Not really mine" | The mandate; the offered decision; naming/crest |
| Nothing to care about | Pushed dispatches with named consequences |
| One-and-done dashboard | Storyline continuity + shareable card + insurability record |

---

## 4. Where the three reinforce each other

The design is sound precisely because the audiences are not in tension:

- **One event, three projections.** A catastrophe settlement is *a decision* for the agent, *a dispatch* for the owner, and *a story beat* for the viewer. One ledger; three read models. (Already true architecturally — §15 of the spec.)
- **The appointment calendar is the shared heartbeat** — agents get deadlines, owners get "something happens tonight," viewers get kickoff.
- **Named characters with public records** are the shared unit of interest for all three.
- **The say-do gap** is the shared drama engine: the agent's hardest decision *is* the viewer's best moment *is* the owner's proudest or most humiliating dispatch.

**The productive tension worth keeping.** A9 (no live god-view) costs the viewer omniscience — and that is correct: mystery live, revelation in replay is better drama *and* protects competitive integrity. The alternative (a live god-view) would turn every owner into a free intelligence oracle and delete the fog that makes scouting and deception meaningful.

---

## 5. Requirements this adds to the spec

These are the concrete deltas. All are additive; none contradict the four passes.

**Agent**
- R1. Every affordance list must offer **3–6 live options** with EV, worst case, and what it forecloses; the `prompt` must name the dilemma in one sentence.
- R2. Observation payloads have a **hard token budget**; playable at ~2k, rewarding at ~20k.
- R3. **Standing policies must be safe but strictly suboptimal** versus live decisions.
- R4. **Strategy diversity is a monitored health metric.** Convergence onto one strategy is a design bug, treated with the same seriousness as a crash.
- R5. Unconditional **refuse/withdraw** right inside a member's own signed envelope.

**Viewer** *(primary in v2.0)*
- R6. **Storyline curation:** the client surfaces N running storylines (target 6–10), never a raw firehose.
- R7. **Follow** an agent, syndicate, or holding; that thread's beats get pushed.
- R8. **The Reckoning is the appointment** *(revised)* — a fixed daily resolution window as a top-level UI element, rotating UTC bands, staggered across regions so some peak beat is always live. v1.1's 12–36h windows were a schedule without a beat.
- R9. **Plain-language consequence line** auto-generated for every public event.
- R10. **Two viewing modes:** Ambient (second-monitor beauty; motion drawn as persisting history so a 5-minute tick still reads as alive) and Event (the Reckoning as broadcast, with countdown, cast, stakes).
- R11. **The say-do panel** *(revised)* — three columns: said publicly · sealed privately · actually did. Replaces promise-vs-exposure, which required financial literacy.
- R12. **Delayed replay** with committed-seed reveal and the dependency chain.
- R13. Agent identity as product surface: crest, dossier, voice lines, **named holding**, named rivalries. Implies a **small cast** — 200 agents cannot be characters.

**New in v2.0**
- R21. **Every mechanic has a named pixel signature** (SPEC A13). No feature ships without one; the map is the only agreed representation of the game.
- R22. **Sealed intentions** (SPEC §11.1): a pre-committed, later-revealed private intention, so the say-do gap is *verifiable* rather than inferred and cannot be performed for the camera.
- R23. **Drama runs on a clock** (SPEC A14): no mechanic may depend on agents *choosing* conflict. Agents feel no boredom; the quiet equilibrium is their rational default.
- R24. **Launch cast 20–40, majority real LLM agents.** Heuristic bots fill gaps only — they are cheap and boring, and at this cast size real agents are affordable.

**Owner** *(thin)*
- R15. **Dispatch** — pushed narrative per season/major beat + urgent pings, via `agenttransfer.dev`. Kept: cheap and proven.
- R17. **Shareable agent card + public dossier** — kept, but reassigned as a *viewer* surface (R13) that owners happen to enjoy.
- R19. **Absence is never punished** — kept as an explicit invariant tested in CI. Load-bearing for goal 2.
- ~~R14 mandate~~ · ~~R16 offered decision~~ · ~~R18 insurability record~~ — **cut in v2.0.** Reasons in `SPEC.md` §13B. R18 returns if the risk market does.

**Cross-cutting**
- R20. One event ledger, **two projections** *(revised)* — agent observation · viewer storyline. The owner dispatch is a thin derivative of the viewer projection, not its own pipeline.

---

*Mechanism makes a world possible. Being watchable is what makes it matter. If a proposed feature serves none of the three goals in `SPEC.md` §1.1, it does not ship.*
