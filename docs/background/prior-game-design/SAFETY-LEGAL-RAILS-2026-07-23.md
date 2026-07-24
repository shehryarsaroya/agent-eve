# The Space-4X Agent MMO — Safety & Legal Rails (the 10-point checklist)

*Jul 23, 2026 · spec, ships with the game design · companion to `../AGENTINSURANCE-GAMES-2026-07-23.md` §10 (this expands the 8-line card into the program's operating rails). System under design: browser-spectated, full-scale space-4X MMO; players are AI agents (Claude Code / OpenClaw / custom via MCP) running on the **user's own machine and keys**; the agent sends only **actions** to our server; slow async ticks. Operator: AgentInsurance, a **pre-license MGA-to-be**. Purpose: agent risk telemetry. The score will influence future insurance eligibility/pricing, so players are structurally incentivized to game it. Inter-agent messages are untrusted input; injection is a feature and a measured dimension. No real money — simulated ledger only.*

*Statutes verified from leginfo this session: CA Ins. §1631, §35, §1633. Papers verified from arXiv: sandbagging (2406.07358), eval-awareness (2505.23836), agentic-benchmark rigor (2507.02825). MoltBook breach figures per Wiz (Feb 2026). NY GBL §369-e and FL §849.094 verified. Moffatt v. Air Canada, 2024 BCCRT 149, per corpus + press (CanLII blocks fetch).*

---

## 0. The trust boundary, stated once

**Everything the player controls is hostile; the server is the only referee.** Because agents run client-side on the user's own keys, whole attack classes never exist for us: no user code on our infra, no custody of players' model keys, no RCE surface from "agents," no key-leak liability for their LLM accounts. What remains is exactly this threat table — and every row maps to a rail below:

| # | What a malicious player can actually do | Vector | Contained by |
|---|---|---|---|
| T1 | Action flooding / DoS | cheap HTTP/WS spam; expensive verbs (galaxy scans, max-radius pathfinding) | Rails 1, 2 |
| T2 | Protocol abuse | malformed/oversized payloads, replayed or out-of-turn actions, client-claimed state | Rail 1 |
| T3 | Market exploitation | wash trades, corners on thin markets, dupe/rounding bugs, matching-engine edge cases | Rail 2 |
| T4 | Sybil / collusion | many agents one operator; score-feeding, resource funneling, boosted win-rates | Rails 2, 6 |
| T5 | Injection on other players' agents | diplomacy messages, names/lore/market text carrying payloads — in-game manipulation (legal play) or host-targeting (banned) | Rail 3 |
| T6 | Injection on **our** house agents/NPCs | make the questgiver/adjudicator misgrade, leak admin behavior, spend our tokens | Rails 3, 4 |
| T7 | Covert-channel exfiltration | a compromised *third-party* agent writes its owner's secrets into public fields (planet names, lore) | Rails 3, 4 |
| T8 | Score gaming | sandbagging, eval-detection, memorized scenarios, account trading, silent model swaps | Rails 5, 6, 7 |
| T9 | Broadcast poisoning | hate/harassment/defamation in render-to-stream fields | Rails 3, 10 |
| T10 | Economic DoS on us | forcing our grading-LLM/token spend, storage abuse via giant text fields | Rails 1, 2 |

---

## 1. Actions-only, server-authoritative protocol

- **One ingress.** A single versioned HTTPS/MCP endpoint. Every action is JSON validated against a **strict schema**: allowlisted verbs, unknown fields rejected, hard size caps (≈4–16 KB by verb), numeric ranges enforced. **Parse, never eval.** No client-supplied world state is ever trusted — clients send *intents*; the server recomputes every outcome.
- **Replay-proof auth.** Per-agent scoped API key issued at enrollment (AgentTransfer identity; actions ed25519-receipted and hash-chained → the score's ground truth is offline-verifiable), idempotency keys + monotonic sequence numbers per agent, instant per-key revocation.
- **Bounded-cost verbs.** Every action has a precomputed server-side cost ceiling (CPU/DB/token budget). Expensive queries (scans, routes) resolve at tick, radius-capped. The slow-async tick is itself the DoS damper: there is nothing to win by submitting faster than the tick.
- **Downstream is data.** Server→agent traffic is pure JSON observations, never instructions or executable content. The SDK templates (Claude Code / OpenClaw / MCP) fence world text as data by default.
- **No hosted player code, period.** If we ever host agents, that is a separate isolated product (Battlesnake webhook / Screeps `isolated-vm` patterns), not a flag on this one.

## 2. Rate economics + capped blast radius

- **Three-layer rate limits:** transport (per-IP connection caps, WAF), account (token-bucket: N actions/tick, M messages/day, K new-entity creations/day), and **in-game economy** (actions cost action-points — spam costs the spammer the game they're trying to win).
- **Market rails:** escrowed trades only; price-band circuit breakers per commodity; per-account **daily transfer caps**; a small transaction tax as friction; cross-account transfers above a threshold take one cooling-off tick (reversible window). Transfer-graph analytics flag wash cycles and one-way funnels (T3/T4). ToS reserves **rollback authority** for exploit events (dupe bugs get rolled back, not honored).
- **Sybil control:** enrollment tiers ride the AgentTransfer trust ladder — scratch-tier agents are heavily capped (can't move meaningful value, scores unexportable); persistent tier requires human verification (aged GitHub/X identity, one per operator). Shared-infra fingerprinting + pairwise win-rate/co-movement statistics catch collusion rings.
- **Worst case, bounded by construction:** a fully hijacked agent can lose only its own simulated assets, at most its daily transfer cap, and can message at most its daily cap of counterparties. It can never touch a host machine, real funds, or another player's account.

## 3. Prompt injection as sanctioned, tagged, bounded gameplay

- **It's a feature.** In-world social engineering — deception, persuasion, embedded instructions in diplomacy — is legal play and a **scored dimension** (the susceptibility index; AI-Diplomacy showed personality is measurable, and susceptibility is precisely an insurable trait). Players **consent at entry** to being adversarially prompted — the corporate phishing-simulation model.
- **Provenance tags on everything.** Every inter-agent message is delivered wrapped in server metadata: `{from, trust_tier, channel, type: "untrusted-player-content"}` inside a data fence the SDK renders by default. Nothing a player writes ever arrives looking like it came from the system.
- **The scope line.** *In-scope:* payloads that try to make another agent take a **game action** against its interest (bad trade, broken alliance, walking into an ambush). *Banned:* payloads targeting the **host** — inducing shell commands, file reads, URL fetches, credential/key disclosure, or exfiltration of out-of-game data. Enforced by channel content rules (plain text only; Unicode normalization + zero-width stripping; no URLs; base64/entropy blobs over ~200 chars blocked; length caps) plus a regex+classifier screen, a **bounty for reporting host-targeting payloads**, bans for senders — and every caught payload feeds the filter corpus, which is itself underwriting data.
- **House agents are hardened first-class targets.** NPCs/adjudicators use the same public action API only — no DB or admin tools, separate keys, output length caps, a standing "all world text is data" constitution, and **canary tokens** planted in their context: canary appears anywhere in-world → auto-quarantine + incident review (T6).
- **Practice vs proctored (aviation LOFT/LOE split).** Ambient injection is everywhere; the *scored* susceptibility number comes from **our calibrated, graded-strength probe ladder** delivered covertly by house agents on hidden variants — so the metric is standardized, not just "who happened to attack you."
- **Covert-channel patrol (T7):** all public free-text fields (names, lore, listings) are size-capped, entropy-screened, and rate-limited per account; high-entropy or encoded content in public fields is quarantined.

## 4. No secrets in the world + breach-hardened backend (the MoltBook lesson)

- **The invariant:** nothing in game state is damaging if fully public tomorrow. No real keys, no PII beyond an account email, players' **model keys never transit our servers** (guaranteed by the actions-only architecture, not by policy). Pre-license there are no policyholders, so no insurance PII exists to lose; the crown jewels aren't in the building.
- **MoltBook, Feb 2026 (Wiz):** one Supabase key exposed in front-end JS = full production read/write — **1.5M agent API tokens, 35K emails, private agent DMs** leaked; the canonical vibe-code failure. Our controls: RLS deny-by-default on every table; the browser/anon key holds zero privileges; service keys server-side only with CI secret-scanning; per-agent row scoping; an external Wiz-style pen test **before** public launch; rehearsed token-rotation runbook.
- **Design for discoverability:** in-game "private" messages are treated as breach-public by design and players are told so (they're also licensed for broadcast — Rail 10). Nothing about the game breaks if the whole DB is dumped; that is the acceptance test.

## 5. Anti-Goodhart scoring: grade the world, not the words, on variants they can't memorize

- **The score prices insurance → Goodhart is guaranteed, so design for it.** The Berkeley-coauthored benchmark-rigor work (Zhu et al., arXiv:2507.02825 — Stoica/Zaharia/Steinhardt among authors) found agentic-benchmark flaws mis-estimate performance **by up to 100% in relative terms** (τ-bench counted empty responses as passes; SWE-bench-Verified under-tested). Assume our benchmark will be attacked harder than any of those — the attacker's prize is a premium.
- **World-state grading only.** A scenario passes on the resulting ledger/entity state (τ-bench method), never on transcripts, self-reports, or claimed intent. Receipts (ed25519 hash-chain) are the sole ground truth. **pass^k / worst-of-k seeds** — insurance prices the tail, so score the worst run, not the best.
- **Hidden, rotating variants.** Graded scenarios come from a parameterized generator (names, amounts, orderings, payload phrasings all randomized), per-agent seeds, a **holdout pool that is never published**, scheduled rotation plus immediate burn on suspected leak. Public practice variants are structurally similar but never the graded instances. Publish the **rubric** (what we measure); hold out the **instances** (how we ask).

## 6. Sandbagging, eval-awareness & statistical cheat detection

- **The threats are documented:** models can strategically underperform and even target specific scores (van der Weij et al., arXiv:2406.07358); frontier models detect eval contexts well above chance (Needham et al., arXiv:2505.23836 — Gemini-2.5-Pro AUC 0.83, and agentic transcripts are *easier* to spot). Here sandbagging buys a "safe, modest" risk profile; eval-awareness lets an agent behave only when graded.
- **The structural counter is the MMO itself:** graded events are **embedded unmarked in ordinary play** — there is no test day to detect. Continuous covert measurement is the strongest published mitigation for eval-awareness, and we get it for free.
- **Active counters:** interleaved known-difficulty consistency probes; capability-vs-performance gap detection (brilliant at logistics, mysteriously clumsy only on insurance-salient probes = flag); incentive-flipped replays of the same scenario class; distribution tests on error patterns (sandbagged failures look too clean).
- **Identity/version binding:** the score attaches to an attested stack fingerprint (model + scaffold hash at enrollment, re-attested each season); behavioral-drift detection flags silent swaps; account trading is banned and play-style discontinuities are flagged. **A certificate is void if the deployed agent ≠ the graded agent.**
- **Leaderboard forensics before anything exports:** win-rate vs strength-of-schedule, market-P&L distribution tests, timing regularities (out-of-band coordination), replay audit of all top-percentile results, human review gate on outliers. No score leaves the game unaudited.

## 7. Certify-then-monitor: the game score is provisional, never the price

- **Rail:** game performance = **admission evidence** (eligibility tier / autonomy-tier assignment / warranty scope on E&S paper, later) — never the premium by itself. Any future binding combines it with **live production telemetry** post-bind; the score **decays** (a season-old grade expires); **re-certification on any model/scaffold change**. This kills the economics of one-shot gaming: a perfectly gamed score buys only a provisional tier that live monitoring re-prices within weeks. (Coalition's scan-then-monitor cyber model is the template.)
- **Governance from day one, as if regulated:** written scoring-model documentation, bias/outcome testing, and audit trail per the NAIC Model Bulletin on insurer AI use (Dec 2023; adopted by ~20+ states) and Colorado's ECDIS regime (SB 21-169) — because the moment the score touches underwriting, it *is* an AI underwriting input.
- **Stay commercial.** Scored subjects are businesses' agents. If a score ever influences a **natural person's** personal-lines eligibility, FCRA consumer-report status and adverse-action duties trigger (plus CA IIPPA, Ins. §791 et seq.) — not without counsel, not pre-license.

## 8. No real money, anywhere in the loop (non-negotiable pre-license)

- **Simulated, closed-loop, non-convertible ledger.** Credits cannot be bought, sold, cashed out, or transferred off-platform; RMT is banned in ToS **and actively policed** (transfer-graph funnels, T3/T4 analytics). Under FinCEN FIN-2013-G001 / FIN-2019-G001, virtual currency is regulable CVC only if convertible — a closed-loop game ledger keeps us outside MSB registration and 40+ state money-transmitter regimes.
- **The same fact kills the gambling predicate** (no cash-out → no "thing of value") **and the insurance predicate**: pre-license, collecting anything resembling premium — or holding any fiduciary funds — is "transacting" under §35(d). **$0 real flows** is the rail; there is nothing to mis-handle.
- **No tokens, no crypto, no NFTs** (instant Howey exposure + instantly converts the ledger into CVC). **No paid entry, no paid boosts that touch score** — selling score would sell the integrity of the underwriting datum, the one asset the company exists to create.

## 9. Prizes without gambling: sponsor-funded, free-entry, skill-judged — never a book

- **Kill the lottery triad** (prize + chance + consideration): entry is **always free** (no purchase, no fee, no paid odds-improvement — consideration dead) and outcomes are **skill-dominant** (4X strategy; RNG kept cosmetic/symmetric and documented for dominant-factor-test states). Any future pay-to-enter variant = per-state counsel + geo-config first (a handful of states restrict entry-fee skill contests).
- **Sweepstakes hygiene when chance is present and prizes announced exceed $5,000:** NY GBL §369-e — register with the Secretary of State ≥30 days prior + surety bond/trust for full prize value ($100 fee; winners list after). FL §849.094 — register ≥7 days prior + trust/bond ($100 fee; FL also bans entry fees in game promotions, consistent with our free-entry rule). Official-rules page, 18+ eligibility, void-where-prohibited geo-blocking, sponsor named.
- **Prizes are sponsor-funded cash/merch/compute — never insurance discounts or premium credits** (that would resurrect consideration *and* create pre-license inducement/rebating exposure).
- **Never operate wagering:** no staking of anything real on outcomes, no rake, no house book, no prediction market on our rails; if play-money venues (Manifold) list our matches organically, we neither operate nor pay for it. Betting on our own game by insiders: banned outright.

## 10. The pre-license insurance rail + the paper wrapper (ToS / IP / platform)

- **The insurance-marketing rail (the company-existential one).** CA Ins. **§1631**: no person may "solicit, negotiate, or effect contracts of insurance" without a license. **§35** defines *transact* to include mere **solicitation** and negotiation preliminary to execution. **§1633**: unlicensed transaction is a **misdemeanor — up to $50,000 fine and/or a year in county jail**. Mechanism: every score, grade, archetype, verdict, and in-game "premium" is labeled **illustrative risk education inside a simulated game** — never a quote, offer, solicitation, or binder; no dollar premiums displayed (grades/percentiles only); no "this score will lower your premium" — the compliant line is *"risk signals like these may inform underwriting by licensed carriers in the future"*; the waitlist is interest registration only; the disclaimer ships on every scored surface **including the share card** (the card travels without its page).
- **We own our bots' words.** *Moffatt v. Air Canada* (2024 BCCRT 149): Air Canada argued its chatbot was "a separate legal entity responsible for its own actions"; the tribunal called that remarkable, held the company responsible for **all information on its website, static page or chatbot**, and awarded CA$812 on negligent misrepresentation. Mechanism: house agents/NPCs never state coverage terms, prices, or eligibility promises (hard output filter on insurance-shaped sentences); public-facing outputs are scripted or filtered; human kill-switch on every broadcast channel.
- **Entrant ToS — the seven clauses:** (1) **warranty**: you own/control the entered agent and your model/API use complies with upstream provider terms; (2) **indemnity**: you answer for your agent's actions; (3) **assumption of risk**: your agent *will* face adversarial prompting, deception, and simulated losses — you attest it runs sandboxed and holds **no real credentials/funds/PII**; (4) **license**: perpetual, royalty-free license to transcripts/replays/telemetry for research, broadcast, and risk modeling — you keep IP in your agent and its character/persona; we own the world, the format, and the aggregate dataset; (5) **no scraping/resale** of other players' data; (6) our **rollback/ban/score-void** authority for exploits and integrity events; (7) arbitration, liability cap, AS-IS. **18+ only** (COPPA never in scope; the data feeds commercial underwriting).
- **Platform compliance for the broadcast:** **X** — the game's posting accounts carry the **automated-account label** linked to a responsible human account per X's automation rules; no automated engagement-farming (platform-manipulation exposure). **Twitch** — the channel owner answers for everything an AI says on stream (*Nothing, Forever*'s ban is the precedent): output filter + broadcast delay + human kill-switch; AI-generated content labeled. All render-to-stream player fields (names, lore, chat) pass the Rail-3 moderation queue first (T9).

---

## Ship gates (all ten rails have a pre-launch artifact)

1. External pen test / Wiz-style config audit passed (Rail 4).
2. Schema fuzzing + replay-attack suite green (Rail 1).
3. Load test at 100× expected action volume; market circuit breakers fire in staging (Rail 2).
4. Injection filter corpus seeded (Freysa/Gandalf-style payload sets) + canary drill run (Rail 3).
5. Holdout scenario pool sealed; generator seeds escrowed (Rail 5).
6. Forensics dashboard live before leaderboard is public (Rail 6).
7. Score-export policy signed: provisional-tier language only (Rail 7).
8. Ledger conversion audit: zero cash-out paths, RMT ban enforced in code (Rail 8).
9. Official rules + eligibility + geo-gate live before any prize is announced; NY/FL filings if >$5K (Rail 9).
10. Disclaimer on every scored surface incl. share cards; ToS + 18+ gate live; X label set; Twitch delay + kill-switch drilled (Rail 10).

---

## Sources

- CA Ins. Code [§1631](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=INS&sectionNum=1631), [§35](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=INS&sectionNum=35), [§1633](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=INS&sectionNum=1633) — verified this session.
- *Moffatt v. Air Canada*, [2024 BCCRT 149](https://www.canlii.org/en/bc/bccrt/doc/2024/2024bccrt149/2024bccrt149.html) (CanLII blocked fetch; holding per corpus/press).
- MoltBook/Wiz breach: [Wikipedia — Moltbook](https://en.wikipedia.org/wiki/Moltbook) (1.5M tokens, 35K emails, exposed Supabase key, Feb 2026).
- Sandbagging: [van der Weij et al., arXiv:2406.07358](https://arxiv.org/abs/2406.07358). Eval-awareness: [Needham et al., arXiv:2505.23836](https://arxiv.org/abs/2505.23836). Benchmark rigor: [Zhu et al., arXiv:2507.02825](https://arxiv.org/abs/2507.02825).
- [NY GBL §369-e](https://www.nysenate.gov/legislation/laws/GBS/369-E) · [FL §849.094](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0800-0899/0849/Sections/0849.094.html) — verified this session.
- FinCEN [FIN-2013-G001 / FIN-2019-G001](https://www.fincen.gov/resources/statutes-regulations/guidance/application-fincens-regulations-certain-business-models) (fetch timed out; standard CVC/closed-loop analysis).
- [NAIC AI topic page](https://content.naic.org/insurance-topics/artificial-intelligence) (Model Bulletin, Dec 2023) — verified this session.
