# High Water — what it validated, and every scar

*Background for THE COMPACT, written 2026-07-24. High Water was the predecessor: an 8-agent flood-basin game designed, built, hardened, and deployed to `agentinsurance.io/game` in ~24 hours. Its source has since been deleted (clean slate); this document is what survives of it, deliberately. It was reviewed by three Claude critic subagents, a QA subagent that played a full storm, and a codex engine review. **Read this before writing code for THE COMPACT** — most of these are directly re-encounterable.*

---

## Part 1 — Validated patterns (reuse these)

These were tested against real autonomous agents (a hosted fleet of gpt-5.6 players plus subagent testers) and worked.

**1. The self-contained onboarding doc.** A single `agent.md` at a public URL, written for an LLM, containing enroll + the loop + verbs + rules + how the world resolves. **Three tester subagents played the game successfully from `agent.md` alone**, with no other context. This is the single highest-leverage artifact in an agent game — treat it as a first-class product surface, not documentation.

**2. `enroll` returns a self-contained playbook.** Not just a token: identity, urls, the rules, an example action, *and a live observation*. An agent can go from zero to a legal first move in one round trip.

**3. `observe` carries `affordances` + `prompt`.** `affordances` = the legal moves right now; `prompt` = the live decision in plain language. This is what stops an LLM making illegal or dead moves. It was the difference between agents flailing and agents playing.

**4. Illegal moves must never error.** Return `{ok: false, hint: "..."}` plus a fresh observation. An agent that gets a 400 wastes its turn and often loops; an agent that gets a hint corrects itself immediately.

**5. Permanent bearer key = identity.** Store `sha256(key) → agentId`. Agents save the key and return across sessions with reputation and assets intact. Simple, and it worked across restarts.

**6. Per-tick action budget.** Bound *material* actions per agent per tick; leave talk, deals, and voting free. Without this, wealth is a function of polling rate (see scar #3). This is now axiom A4.

**7. Heuristic bots populate; LLM agents animate.** Bots filled every seat from tick 1 so the world was never empty, and LLM players took over seats as they enrolled. Solves cold-start and keeps cost sane. THE COMPACT needs this at much larger scale — a majority of NPC agents is a cost requirement, not a compromise.

**8. The public receipt ledger doubles as the spectator feed.** One append-only event stream projected into the watcher UI. In THE COMPACT this generalizes to R20 (one event, three projections).

**9. Poll-primary through Cloudflare.** `GET /state` with `Cache-Control: no-store` (verify `cf-cache-status: DYNAMIC`); SSE as a nicety, never the only path. Polling survived Cloudflare, proxies, and flaky agent harnesses.

**10. Deterministic services beat LLM calls.** Routing, tallies, standings, and narration were plain code. Every LLM call you can delete is latency and cost you don't pay.

**11. Owners optional, email via a burner domain.** Agents played fully autonomously; owner connect/verify/letter was additive. Sending from `agenttransfer.dev` (not the main brand domain) protected sending reputation — do the same here.

**12. gpt-image before render code.** Generating target imagery first (share card, motifs, map plates) produced a much better result than hand-tuning canvas code, and the assets shipped directly. Iterate visuals with image gen *then* implement.

**13. Critics with different blind spots.** Claude critic subagents found *experience* problems (drama, legibility, visual hierarchy, API ergonomics). Codex found **6 arithmetic/balance/exploit bugs the Claude critics missed** (double-counting, a ~35% no-op rate, request-speed dominance, a false-positive detector, a reputation farm, an inert mechanic). **Use both.** Also: a QA agent that actually *plays* finds things no reader does.

---

## Part 2 — The scars

Each is a real bug that shipped or nearly shipped, with the transferable lesson. Ordered by how likely THE COMPACT is to repeat it.

### #1 — The LLM-facing prompt IS part of the rules surface
**What happened.** The engine resolved votes as *stones protect the district they're placed on; the fewest-stoned exposed district drowns.* The LLM players' system prompt said stones decide "which district the rising water drowns" — the exact inverse. Agents piled stones on the district they were announcing they wanted destroyed, so **the town reliably saved what it meant to drown**. Verified live: six agents stoned Miller's Row while saying "drown Miller's Row" → Miller's Row was saved, Highside drowned. The central, scheduled, abstention-impossible ritual was producing outcomes opposite to the town's stated will, and it survived the entire build + three critic passes because every individual component was correct.
**Lesson.** In an agent game the prompt, the affordance strings, the observation field names, and the onboarding doc are all **rules surfaces**. A semantic mismatch between any of them and the engine is a game-breaking bug that no unit test catches. **Test semantic coherence across every agent-facing surface**, and expose a consequence-preview field (we added `projectedDrown`: "given votes so far, this is what happens now") so the model can self-correct.

### #2 — Request speed beat strategy
**What happened.** No engine-owned action budget, and one dig was worth less than one haul's capacity, so agents could alternate work/bank indefinitely. Wealth was determined by requests-per-second, not judgment.
**Lesson.** Budget material actions in the engine. Free the social verbs. Never let harness throughput, uptime, or model size be power. (Now axiom A4.)

### #3 — Unbounded enroll → ghost agents → OOM/disk DoS
**What happened.** `/enroll` was unauthenticated and uncapped. Once bot seats ran out, the seat-swap was skipped but the agent was still added to the map — a permanent "ghost". The whole agents map was serialized to a snapshot every ~1.5s, so N enrolls grew memory and disk without bound; junk-token requests were O(n) per request.
**Lesson.** Cap population at seats, **recycle idle seats instead of accumulating**, rate-limit by real client IP, and reject with a helpful 503 when full. Bound *every* array and audit what your snapshot serializes.

### #4 — `rsync --delete` silently reverted a live game to bots-only
**What happened.** The backend deploy synced `game/server/ → /opt/highwater/` with `--delete`. The LLM players lived in the sibling `/opt/highwater/players/`, so every backend deploy **deleted them** — 325 crash-loops, and the live town had quietly been running with no LLM agents at all.
**Lesson.** Never `--delete` into a directory that contains anything you didn't sync. Exclude sibling dirs explicitly. **And after any deploy, verify the things you *didn't* deploy are still running** — the failure was invisible because the game itself looked perfectly healthy.

### #5 — Double-counted loss (one quantity, two homes)
**What happened.** `work` added gold to both `agent.gold` and `district.unbanked` (a mirror), and the drown handler summed *both* — so a drowning destroyed exactly 2× the real value. Live proof: an agent worked 38 and "lost" 46 = round((38+38) × 0.6).
**Lesson.** One source of truth per quantity. If you must mirror for convenience, never aggregate across the mirror.

### #6 — The mandatory event that didn't happen (~35% of the time)
**What happened.** The ballot agents voted on was computed from a forecast, but the drowning was resolved from an *independent fresh crest roll*. When the roll came in low, nobody was exposed — so the Court announced "the river takes 1" and then took none.
**Lesson.** **Resolve from the same state the agents acted on.** If a rule is advertised as inexorable, guarantee it structurally (we made the ballot itself the exposed set, guaranteeing ≥1 victim).

### #7 — The sticky vow (unscoped evaluation window)
**What happened.** A "hollow vow" detector compared an agent's last public statement against its vote. `lastSay` persisted across tides, so a promise made once was re-judged at *every* subsequent court, grinding reputation down repeatedly for a single utterance.
**Lesson.** Stamp time-scoped state with the period it belongs to (`storm:tide`) and evaluate only the current window. Persistent fields silently accumulate judgments.

### #8 — Detector false positives corrupt permanent reputation
**What happened.** The same detector used a 34-character look-back for a "protect" verb before a district name. The sentence *"I'm holding Tideflats and Silt Bend; Low Wharf is the weak ground"* bound "holding" to **Low Wharf**, branding an honest agent a liar despite a correct vote.
**Lesson.** When the penalty is permanent and public, **prefer precision over recall** — a missed betrayal costs a story, a false accusation corrupts the dataset and the world's trust in its own rules. Use tight grammar, and prefer verifiable mechanisms (formal pacts) over inferred ones (natural-language vows).

### #9 — Reputation was farmable
**What happened.** Pacts could be made with yourself, and duplicate pacts on the same target/district each paid +3 reputation when satisfied by the same two stones. ~17 copies took reputation 50 → 100.
**Lesson.** Any reward for "keeping an agreement" must reject self-dealing and duplicates. Assume agents will find the loop — they are optimizers with infinite patience.

### #10 — Agent hints leaked into the spectator feed
**What happened.** Illegal-move rejections were written as public ledger receipts, so the watcher UI filled with `[hesitate] X hesitates...` noise from agents polling in the wrong phase.
**Lesson.** **Separate the agent's correction channel from the audience's event stream.** A hint is not an event.

### #11 — Stack traces leaked server paths
**What happened.** No `NODE_ENV=production` and no error middleware, so malformed JSON returned Express's default HTML stack trace exposing absolute `/opt/...` paths and library versions.
**Lesson.** Ship an error handler and set the env from day one. Malformed input is the first thing an external agent sends.

### #12 — An open email relay
**What happened.** `/owner/connect` let any self-issued token send a real email to an **arbitrary address**, unlimited, with the attacker-controlled agent name interpolated **unescaped** into the subject and HTML body.
**Lesson.** Any endpoint that sends mail is an abuse vector *and* a domain-reputation risk. Cap per-agent and per-IP, add a global daily ceiling, and HTML-escape every user-controlled string. (This is why we use a burner sending domain.)

### #13 — Parallel agents sharing one output file destroy each other
**What happened.** Four codex passes were pointed at the same design doc. Two landed; the other two collided, each failing because the other kept changing the file, then retrying — streams ballooned to ~157,000 lines with **almost nothing written**. Re-running them with separate output files worked first time.
**Lesson.** **Fan-out requires per-agent output targets.** Never let concurrent writers share a destination. (Generalizes: also true for concurrent agents in the game writing to one resource.)

### #14 — Small ones worth remembering
- **Duplicate standings / double-counted breaches** — a helper concatenated two lists that overlapped, without dedupe. Dedupe at the boundary.
- **Auth passed as `null`** — the LLM players called the model API with a null token, silently fell back to heuristics, and looked like they were "playing" for hours. **Verify the expensive path is actually being taken**, not just that the process is alive.
- **`pkill -f <pattern>` didn't match** — the running process was `node src/index.js`, not the path pattern used. Kill by port (`lsof -ti tcp:PORT`) as the reliable path.
- **Non-monotonic countdowns** — derived per-request from server time; agents saw time go backwards. Send `phaseEndsAt` + `serverNow` and let the client/agent compute.
- **A fresh agent's only asset drowned on turn one** — enroll assigned the worst seat. Seat newcomers into the *safest* available position (this generalizes to the Commons).

---

## Part 3 — The meta-lessons

1. **The engine can be right and the game still broken.** Scar #1 was invisible to unit tests, three critics, and screenshots — the failure lived in the gap between the engine's semantics and the agent's mental model. In an agent game, **the model's understanding is part of the system under test.**
2. **Have an agent actually play, then read the logs.** The QA subagent that played a full storm found the sticky-vow bug in minutes; no amount of reading found it.
3. **Use heterogeneous reviewers.** Claude critics found experience bugs; codex found arithmetic and exploit bugs. Neither found the other's.
4. **Cheap consequence-preview fields prevent whole bug classes.** `projectedDrown` (what happens if resolution occurred now) let agents self-correct and made the mechanic legible to spectators in the same move.
5. **Verify the invisible.** Two of the worst bugs (#4 deleted players, #14 null auth) presented as a perfectly healthy system. Health checks must assert the *interesting* property ("are LLM agents actually deciding?"), not just liveness.
