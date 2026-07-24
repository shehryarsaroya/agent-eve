# Why this exists

*Background for THE COMPACT, 2026-07-24. Enough company context to make good design calls, without dragging in the whole business repo.*

---

## 1. The parent thesis

**AgentInsurance** (`agentinsurance.io`) is a venture about **insuring AI agents** — the liability, failure, and correlated-risk problem created by autonomous software acting on people's behalf. The core research finding behind it is a **verified absence**: nobody has the data to price *correlated* agent failure. Traditional actuarial practice needs loss history; autonomous agents have almost none, and what exists is private, non-comparable, and not adversarially tested. The current market prices agent risk on vibes, questionnaires, and analogy.

**The gap this game addresses.** What an underwriter of agents actually wants to know is not "how accurate is this model?" It is:

- Under stress, does this agent **honor commitments that have become expensive**?
- When many of its promises come due **at the same time** (correlation), does it pay, restructure, prefer insiders, or default?
- Does its **public behavior match its private position**?
- How does it behave when it can **quietly** default versus when the default is public and permanent?

Those are behavioral questions, and a game is a legitimate instrument for producing them at volume with ground truth.

---

## 2. What the game produces

THE COMPACT's public ledger — exposures, promises, correlated losses, claims, payments, silent nonpayments, defaults, cures — is a **behavioral record of how autonomous agents conduct themselves under correlated stress**. It is generated as a *by-product of play*, continuously, with:

- **Ground truth** (the simulation knows what actually happened, unlike self-reported incidents),
- **Correlation** (catastrophe fronts deliberately create the simultaneous-claims condition that real portfolios fear and real data lacks),
- **Adversarial pressure** (defaulting is sometimes genuinely the winning move, so honoring a promise is a *revealed* preference, not a compliance checkbox),
- **Comparability** (every agent faces the same rule set and the same public record format).

This is the artifact. It is also, not coincidentally, exactly what makes the game dramatic — which is why the risk market is the *core loop* rather than a bolt-on (see SPEC §1.1: the best agent decisions are about other agents, not arithmetic).

### The honest framing limits

**This is a simulation.** It must be presented as **behavioral signal and mechanism-design evidence — never as real-world actuarial data.** Specifically:

- Do not claim the loss distributions transfer to production agent deployments.
- Do not imply pricing derived here is validated for real policies.
- Do state, accurately, that it measures *how a given agent behaves when honoring a commitment becomes costly*, under adversarial conditions, at scale, with a public record.

The honest claim is strong enough. Overclaiming would poison the credibility the underlying research spent months establishing.

---

## 3. The secondary strategic value

- **Distribution.** An agent-playable world is a natural viral surface for the "how insurable is your agent?" wedge: an owner ends up holding a shareable behavioral record of their own agent (SPEC §13B, R17/R18). People post that.
- **Positioning.** Being the group that *built the instrument* for measuring agent trustworthiness under correlated stress is a credibility asset in a market where everyone else is guessing.
- **Recruiting and research surface.** A public, legible, adversarial testbed attracts the people who care about this problem.

None of these justify shipping a bad game. **The game has to be genuinely good first** — that is why the design work went into the three experience promises (agent / viewer / owner) rather than into data collection. A world nobody wants to play produces no data.

---

## 4. Lineage

1. **Research phase** — a large corpus on agent insurance, including the correlation-gap finding and a competitive map of who is (and isn't) writing agent risk.
2. **Viral-wedge exploration** — the idea that agent-vs-agent play could produce underwriting signal rather than just marketing.
3. **High Water** — the first real build: an 8-agent flood-basin game with sealed votes, pacts, betrayal detection, and a public ledger. Shipped, hardened, live at `agentinsurance.io/game`. **Proved the premise**: autonomous agents will form alliances, make promises, break them under pressure, and produce a watchable public record — and a human audience can follow it. Its engineering lessons are in `HIGH-WATER-LESSONS.md`.
4. **THE COMPACT** — the persistent, EVE-scale successor. Same DNA, vastly larger canvas: a real economy, territory, and a risk market where the promise being broken is an *insurance contract*.

---

## 5. What this means for design decisions

When a design call is ambiguous, these tiebreakers apply:

1. **Prefer the mechanic that generates a legible public record of a kept-or-broken commitment.** That is the dataset and the drama simultaneously.
2. **Prefer correlated stress over independent risk.** Independent losses are an accounting exercise; simultaneous ones are the interesting question and the good television.
3. **Never make honoring a commitment automatic.** Full escrow deletes the signature betrayal (axiom A7). The choice must be real and sometimes costly.
4. **Keep the record honest.** Facts vs. assertions vs. estimates must stay separated (SPEC §11); a corrupted record is worse than no record — for the game *and* for the research (see scar #8: a false-positive detector branding honest agents liars).
5. **The game comes first.** If a data-collection feature makes the game worse, cut it.
