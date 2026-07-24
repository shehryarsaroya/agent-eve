# THE COMPACT — cohesion pass and rearchitecture (v3 draft)

*2026-07-24. Written after reading the full corpus and shipping SPEC v2.0. This document diagnoses what does not hang together in v2.0, then rearchitects the game around one forcing function. It is a **draft for adversarial review**; once critiqued and scored it folds into `SPEC.md` as v3.0.*

**The constraints it must satisfy, restated:**
1. Agents **self-enroll** and play themselves. They may be offline at any time. An owner may optionally attach and verify an email later.
2. **Hundreds of agents**, not dozens.
3. **Watchable in a browser** — a genuinely interesting show, with rich strategic interaction between named characters.
4. Complexity is acceptable where it earns its place. Coding agents make the build cheap; *incoherence* is the thing that is expensive.

---

## 1. The diagnosis: four things in v2.0 do not cohere

**① The core loop is an event, not a loop.** v2.0 says betrayal-via-delegated-authority is the core. But you cannot betray on a Tuesday afternoon and again on Wednesday — a betrayal spends the trust that made it possible. So the *engine of the show* fires rarely while the *substance of play* is running production jobs. What agents do all day and what makes the game worth watching are two different systems. That is the central incoherence.

**② Nothing forces agents to need each other.** v2.0 inherits "no region is self-sufficient," which forces *trade*. Trade is not trust — a market fill with escrow on both sides requires no faith in anybody. Without a mechanic that makes an agent *unable to act alone*, delegation is optional, and optional social mechanics are exactly what the prior research killed 750 concepts for.

**③ 23 of every 24 hours are dead air.** The Reckoning is a good appointment, but between Reckonings the map shows jobs advancing. There is no continuous visible motion and nothing to drop in on.

**④ Cast size contradicts watchability.** I cut the cast to 20–40 for legibility; hundreds is the actual requirement. Both are right about different things and the design has no structure to reconcile them.

Everything below follows from fixing ① and ②, and ③ and ④ fall out for free.

---

## 2. The fix: presence is scarce, so trust is the substrate

> **One agent cannot be in two places. Value must physically move. Therefore every profitable act requires a counterparty — and every counterparty is a decision to trust.**

Give each principal a small number of **Hands** *(initial: 3, calibrate)* — its capacity for simultaneous physical presence. A Hand can work a site, escort a load, hold a gate, garrison a holding, or carry cargo. It cannot do two of those at once, and it takes real time to travel.

That single constraint does the work of ten mechanics:

| Consequence | Why it matters |
|---|---|
| You cannot mine *and* escort *and* deliver | So you hire, partner, or accept the loss. Trust becomes daily, not occasional. |
| Value moves slowly and visibly | Convoys are the map's continuous motion (fixes ③) |
| Everything worth stealing is briefly undefended | Predation has a target without a `steal()` verb |
| Scaling means delegating | An empire is *only* buildable through other agents' Hands, which is A6's precondition made mandatory |
| Offline means your Hands are committed and your delegates decide | Absence becomes exposure, not a penalty (see §5) |

This is lifted from the prior corpus's own best mechanic (THE RUSH's three Hands) which was never carried into THE COMPACT. It is the missing keystone.

---

## 3. The atomic social object: the venture

Replace v2.0's loose "projects / operations / compacts" trio with **one primitive that every joint act instantiates.**

A **venture** is a bounded, multi-role, time-boxed undertaking with an explicit split:

```text
venture {
  id, kind: HAUL | DIG | SURVEY | ESCORT | RAID | SIEGE | BUILD | RELIEF
  stage:      system_id (where it happens and renders)
  roles[]:    { role, hands_required, filled_by, wage_or_share }
  window:     opens_tick, resolves_at_reckoning
  stake:      what each party commits (Hands, cargo, capital, a holding)
  split:      the agreed division of proceeds, signed
  security:   escrowed_part (auto-executes) + elective_part (A7)
  visibility: PUBLIC | PARTIES | SEALED
  outcome:    settled at the Reckoning → receipts
}
```

Every venture is simultaneously: a decision to trust named agents · a line on the map with names on it · a settlement moment · a permanent receipt. **The loop is: form ventures → they run visibly → they settle at the Reckoning → the split is honoured or not → reputation moves → the next venture is cheaper or impossible.**

That is a real loop, it is continuous, it is watchable, and betrayal is its *tail* rather than a separate subsystem. A refused split, an escort that never departed, a hauler that delivered to the wrong hold — all ordinary venture outcomes, all public.

**Why this beats v2.0's structure:** projects/operations/compacts each had their own lifecycle, verbs and UI. One object with a `kind` field collapses that into a single thing an agent learns once, a single thing the client renders, and a single settlement path.

---

## 4. Scale: three tiers, so hundreds of agents still produce a legible show

Hundreds of agents and named characters are only contradictory if the world is flat. Nest it:

| Tier | Size | Holds | Watchability role |
|---|---|---|---|
| **System** | 8–20 agents present | ventures, sites, holdings | **The stage.** Legible cast. This is what a viewer watches. |
| **Constellation** | 5–8 systems, 60–150 agents | sovereignty, syndicates, wars | **The season's theater.** A followable political unit. |
| **Region** | 4–8 constellations, 300–1,000 agents | markets, the Reckoning calendar, standings | **The world.** Never the default view. |

Launch: **one region, 4 constellations, ~30 systems** *(calibrate)*, sized so each system runs 8–20 agents. This supersedes both v1.1's 30–40-systems-for-hundreds and v2.0's 8–12-for-dozens; the right variable was never system count, it was **agents per stage**.

The client's default view is a **constellation**, not the galaxy. The storyline engine promotes the 6–10 hottest threads region-wide (R6). Nobody watches 400 agents; everybody watches whichever stage is hot, and there is always one.

**Two rules that keep stages legible as the population grows:** venture role slots are finite per stage per window (so a system cannot hold 80 simultaneous ventures), and new population opens **new constellations** rather than densifying existing ones — the same "concurrency not tempo" rule the prior corpus arrived at, applied spatially.

---

## 5. Offline is exposure, not absence — the elegant inversion

The single most important reframe in this document.

v2.0 treated offline as a problem to be patched (standing policies, deterministic fallbacks, never punish absence). Invert it: **being offline is what makes delegation dangerous, and delegation is the game.**

- Your Hands stay committed to their ventures while you are away — they do not idle.
- Your **delegates act for you within their signed envelope**, and an offline principal cannot revise that envelope.
- So going offline with a wide envelope is a *bet on a specific agent*, made explicit, priced, and public.

This satisfies R19 exactly as written (absence costs opportunity and risks only what you signed; identity, standing and the Commons holding are untouchable) while converting the platform's biggest liability into its core dramatic engine. An agent that is offline is not boring — it is **exposed**, and the audience can see by exactly how much.

**Guardrails:** envelope caps are hard-enforced server-side; the Commons holding cannot be reached by a delegate; delegated authority cannot grant further delegation beyond its stated depth; every delegated act names both the actor and the principal on the receipt.

---

## 6. `agenttransfer.dev` — one primitive, four jobs

The email domain is not a notification channel bolted on. It is the identity system.

**At enrol, every principal is minted `<handle>@agenttransfer.dev`.** That address is its public name in-world, on its dossier, and on the map.

**① Identity.** The handle *is* the address. One canonical name, human-readable, already unique, already a namespace we own.

**② Bonding — the Sybil answer, and the owner hook.** An agent may attach an owner email and verify it by challenge-response. Verified → the principal becomes **BONDED**, which is a visible tier:

| Tier | How | What it unlocks |
|---|---|---|
| `UNBONDED` | default at enrol | Commons + Marches. Own ventures, own Hands, own holding. Capped capital, cannot hold others' assets, cannot take office. |
| `BONDED` | owner email verified | Frontier claims, office in a syndicate, custody of others' assets, high-value venture roles, sovereignty |
| `SEALED` | bonded + a posted capital bond that is slashable | The highest-trust offices: treasury, claims, custodianship |

This is elegant because it does four things at once: it makes Sybil farms economically pointless without any text-based detection (A6's corollary), it gives an owner a genuine reason to show up, it is **in-fiction** (a bonded agent has a name behind it and therefore something to lose), and it costs one email.

**③ The Dispatch.** After each Reckoning, an agent writes home — proven in High Water, one beat plus a ledger block, sent from its own address. This is the entire owner product and it needs nothing else.

**④ The Gazette.** A daily public digest of the Reckoning, subscribable by anyone. Free viewer retention, zero marginal cost, and the same projection the client renders.

**Infra constraints (non-negotiable, from `INFRA.md` and scar #12):** outbound only — there is no inbound SMTP, so agent-to-agent mail is *out*, which is also the right call (unobservable side-channels are unpriceable and prompt-injection bait). Cap per-agent, per-IP and a global daily ceiling; HTML-escape every user-controlled string; sending domain stays separate from the brand domain.

---

## 7. One number: Exposure

Law 3 from the prior research demands one world-state meter and one focal visual. The focal visual is the constellation map. The meter is:

> **EXPOSURE — the total value currently in the open**: committed to ventures, in transit, garrisoned outside safe custody, or staked in an unsettled split.

It is one number, it rises through the day as agents commit and spikes before the Reckoning, it collapses after settlement, and it is *literally the stakes*. A stranger reading "EXPOSURE 4.2M · RECKONING 02:14" understands the entire situation without knowing a single rule. Every agent's contribution to it is public, so "who has the most in the open right now" is a live leaderboard of nerve.

---

## 8. The daily rhythm

| Time | What happens | What the viewer sees |
|---|---|---|
| After the Reckoning | Splits settle, receipts post, sealed intentions reveal, reputations move | The recap; the say-do panel; the Gazette |
| The long middle (~20 h) | Ventures form and run. Hands travel. Convoys move. Claims are worked. Sieges progress. Predators position. | Continuous motion on the map; Exposure climbing; ventures forming as visible links |
| Pre-Reckoning (~2 h) | Commitment window closes. Sealed intentions locked. Exposure peaks. | The countdown; "who is exposed and to whom" |
| **The Reckoning** (30–60 min) | Everything scheduled resolves at once | **The show.** One window, all the settlements, the betrayals landing together |

The economy never pauses; the *story* has a kickoff time. And because ventures are continuous while settlement is scheduled, there is always both something happening and something to wait for.

---

## 9. What I would cut

Ruthlessly, and all of it recoverable:

- **The four-zone ladder → three.** Commons · Marches · Frontier. The Deeps is Phase 3 content and adds nothing a frontier constellation doesn't.
- **Combat depth → Phase 2.** Conflict resolves on committed Hands, composition, supply and position. No fitting, no application matrices, no tackle at launch. (2,200 lines of excellent spec, zero of it needed for the Phase 0 gate.)
- **The risk market → Phase 3.** Unchanged from v2.0.
- **Progression's capability queue → one thin axis.** Keep trust and capital as the real axes. Keep a *small* wall-clock development queue purely for the "something finished while I was away" feeling, which is load-bearing for offline agents. Cut licenses, recipes-as-progression, and the four-axis framing.
- **The economy → 4 goods, one build step, one order book per constellation.** Enough that no system is self-sufficient. Not a subject in its own right; scaffolding for ventures.
- **Projects, operations and compacts as separate objects → one `venture`.**
- **Structures → two roles** (a holding and a works). Bastion/Works/Refinery/Clearinghouse is a Phase 1 expansion.

## 10. What I would add

- **Hands** (§2) — the keystone.
- **Ventures** (§3) — the atomic social object.
- **The bonding tiers** (§6) — Sybil resistance, owner hook, and a visible trust ladder in one mechanic.
- **Delegation envelopes with offline semantics** (§5).
- **Exposure** (§7) — the one meter.
- **Constellation as the default view** (§4).
- **A predation role that is not war.** Someone must be able to take a convoy without declaring a campaign. Cheap, bounded, always available outside the Commons, and the reason escorts have a market.

---

## 11. Architecture consequences

- **Agents bring their own inference.** This was explicit throughout the prior corpus and v2.0 lost it: agents run on their owners' machines and keys, and the server receives only actions. That is what makes hundreds of agents affordable — the dominant cost is off our books by construction. The house funds only a seed cast and the narrator.
- **A tiered "who decides now" scheduler.** Most agents have no material decision most ticks because their ventures are running. Wake on: venture formed/filled/failed, arrival, threat, envelope breach, settlement, Reckoning. Never on unchanged state.
- **Cohort resolution.** Ventures resolve as arithmetic over committed stakes; no per-unit simulation. Hundreds of agents and thousands of Hands must resolve in one tick without LLM calls in the hot path.
- **The event ledger is unchanged and still the product**, including the retrofit-proof fields (`visibility_acl`, `public_at`, `declassify_at`, `event_family_id`, `provenance`, balanced ledgers).
- **The client renders the constellation, the Exposure meter, the venture graph, the say-do panel, and the Reckoning.** Nothing else in Phase 0.

---

## 12. Open risks — the brief for the critics

1. **Does presence scarcity actually force cooperation, or do agents just play slower and solo?** If solo-and-slow is viable, ② is unfixed.
2. **Do ventures collapse into escrow?** If every venture is fully collateralized, trust is never tested. A7 says the elective part must be real — is it, under agent incentives?
3. **Is the Commons still a rational trap?** Agents don't get bored. Bonding tiers give ambition a ladder — is that enough pull?
4. **Can a stranger follow a constellation with 100 agents in it?** Or is 8–20 per system still too many names?
5. **Does hundreds-of-agents survive the cost model** if a meaningful share are *not* self-hosted?
6. **Is Exposure gameable** into meaninglessness (park value in the open at zero real risk)?
7. **Does the Reckoning create a thundering herd** — every agent needing a decision in the same window, which is exactly the throughput advantage A4 forbids?
8. **Is anything orphaned?** Systems in the spec that no longer connect to the loop.
