# THE COMPACT — Build Tracker

*The living source of truth. **Update STATUS after every meaningful step.** A fresh session should resume from STATUS + NEXT + DECISIONS alone.*

---

## ⏱ STATUS

> **2026-07-26 — every system in the phase plan is BUILT, LIVE, and rendering.**
> Live at `agentinsurance.io/compact/`, ~2,870 tests, gate 0 clean. The world runs the A6 core loop
> with both holes closed, markets, predation, a reachable risk frontier, **an economy with a source**
> (WORKS), **sovereignty** (the Charge), and **syndicates** (charter · membership · pooled treasury ·
> offices · votes). Every one of those has a named pixel signature and reaches a browser.
>
> **…and then two probe agents PLAYED it, and found five defects no critic had.**
> See `docs/design/expansion-2026-07-25/D13-what-playing-it-found.md`. All five were the same
> shape — *a surface that disagrees with the engine, where the surface is what an agent reads* —
> and all are fixed and deployed: a stale prompt sentence suppressing the whole demand side of the
> economy (`works: 0` while two principals could afford one); every agent pricing every other
> agent's bond at **zero**; the **A6 `grant` verb having no affordance at all**, which is why the
> live frame published `authorityLines: 0`; a halted world that logged nothing and named no
> invariant at `/health`; and a deciding-share alarm that had served **503 continuously** for a
> condition `health.ts`'s own comment documents as structural.
>
> Two of those were held in place by **tests that encoded the abandoned side of a rule change** —
> including one whose comment said it existed to stop an agent filing a discrepancy, and which is
> precisely what made the probe file one. Open items, including a 1,241-line duplicate
> `buildObservation` that only tests import, are in D13 §4.
>
> **What changed tonight, in one line each.** Sovereignty landed and then failed its own adversarial
> pass — four real bugs, including one where any principal could **halt the galaxy** with two offered
> affordances. PRODUCE jumped the queue because `grep sourceGoods` returned exactly **one** call site
> against two recurring sinks, so every world was heading for a state where every obligation was
> unpayable. Syndicates made A6 reachable over an organisation's treasury rather than one agent's
> purse. The broadcast beat now crosses systems, so a lapsed claim closes the night instead of sitting
> in a side table. INV-7 went from quadratic to linear. Production can finally take a bounded boot.
>
> **The recurring defect class, stated once because it explains most of the above:** a mechanic can be
> correct, tested, offered, rendered — and inert. A guard can be green and unfalsifiable. Six oversold
> guards were caught tonight by mutating them, most of them mine, and three tests of mine passed while
> checking nothing (an early `return`, a `?.` fallback, a `head`-truncated grep). **Verify by running
> it; mutate every guard; assert the premise rather than guarding it.**
>
> **Where to look next:** the resume block below (§🌙), which is live state rather than history.

- **✓ D7 CLOSED (2026-07-25).** The endowment is now non-transferable: it funds a principal's own
  ventures, Levy and hauling, and cannot back a market BID or be sold. A fleet of free identities
  yields **zero** tradeable capital. Done with no new state — the endowment is a constant, so the
  transferable part is everything above the floor — which keeps it out of `state_hash` and the
  snapshot. `ledger/endowment.ts` owns the constant; the grant and the floor are one quantity with
  one home. **No launch blockers remain.**
- **★ THE WORLD IS THINKING (2026-07-26).** The LLM house cast is **ON in production**. First real
  LIVE decisions in the game's history: `by_source {"LIVE": 18, "HEURISTIC": 2304, "FALLBACK": 1}`,
  climbing as the 288-tick window ages out the bots-only past. Model `gpt-5.6-luna`, ~99% of each
  prompt served from cache, three budget caps with a latching $5 ceiling. The one FALLBACK is the
  degradation path working, with a greppable reason (`cast: kestrel reply discarded (empty-plan)`) —
  the member fell back to its heuristic instead of stalling the tick. `deciding_share_bps` will cross
  the 2500 floor as the window fills; until then `unhealthy` is arithmetic, not a fault.
- **★ A14 IS MET (2026-07-26).** Predation landed (`abd8379`), and I verified the property myself
  rather than taking the report: a world of six principals that **never issues a single hostile
  action** was raided anyway — **9 raids in 900 ticks, about one per 100 ticks (~3 a Reckoning)**.
  The control is the clean half: the identical run staged in a **Commons** system produced **zero**
  raids, so A8's floor holds and the only difference is the tier. The world now brings the conflict,
  which is the thing A14 says can never be left to agents choosing it.
  **Open observation:** all 9 ended `PLUNDERED` — nobody resisted. Correct for a deliberately passive
  probe, but if the live cast never resists either, a raid is a tax rather than drama. Watch the
  resist rate once predation is deployed.
- **★ NEXT ENGINE JOB — five books are outside `state_hash`, and one of them is STANDING.**
  The checkpoint-adoption build closed three of its four blockers (durable `posting` log, faucet/sink
  carried, `hydrateAppendOnly` with `restoreTo` **unchanged** — the hydrate runs first so the
  no-growth refusal is *satisfied*, never relaxed) and **measured the win: adopt-plus-tail boots in
  59 ms replaying 24 ticks against 552 ms replaying 600 — O(tail), not O(head).** Then it refused to
  ship it, correctly, because of a fifth blocker bigger than the other four:
  **`StandingBook`, `SealBook`, the obligation book, the `EventLedger` and the attribution register
  are in no state table.** A snapshot carries the state tables and `state_hash` hashes exactly those,
  so those five are *neither carried nor missed*: at the checkpoint the hash matched **to the byte**
  while `electiveHonoured` went from `4, 6, 2, 4` to **all zeros**, and the hashes only parted six
  ticks into the tail.
  This is the `EncumbranceBook` keystone again, in the book A10 is actually about — **the permanent
  public record of who kept their word is not covered by the world hash.** Adoption is gated behind a
  manifest and boot falls back to genesis replay naming every missing book, so production is
  byte-identical to before; a tripwire test fails the day they are registered, forcing the
  equivalence re-check. **Registering these five is now the highest-value engine work left.**
- **★★ THE WORLD IS HEALTHY (2026-07-26).** For the first time, `/health` returns `ok: true` with
  `failures: []`. `deciding_share_bps: 2747` against a floor of 2500 —
  `LIVE 757 · INTENT 35 · HEURISTIC 2090 · FALLBACK 1`, six external seats occupied, and the deploy's
  own check printing *"live agents deciding above the floor"*. The anti-scar-#14b guard has refused
  to call this world healthy all session, correctly, and it now passes on its own terms because real
  agents are genuinely deciding rather than silently falling back. Shipped in the same deploy:
  predation (A14), the partition/durability P0, the negotiation prompt, the cast spend meter, durable
  cast memory, and the durable posting log.
- **★ THE SHOW IS REACHABLE (2026-07-26).** Frames were being written correctly for days and **no
  viewer could fetch one**: a regex nginx `location` with `alias` does not append the remaining URI,
  so `/compact/frames/latest.json` fell through to the SPA and the client was handed `index.html`
  with a 200. Second bug in the same block: `latest.json` was cached `immutable` for a year although
  it is overwritten every Reckoning, so a viewer who watched once would never see another. Both fixed
  (`root` not `alias`; the pointer gets 2 s, numbered frames keep the year), and **the deploy now
  fetches the URL the client fetches** and refuses a body that is HTML or not JSON — the same check
  agent.md got after a probe once parsed a web page as rules.
  What a viewer now gets: **10 rundown segments, 14 ticker lines, 5 authority lines, 6 raid lines, 19
  tribute lines**, with deeds like *"varrow's 479 was riding on ashlin's dig. varrow paid 479 it could
  have kept."* and a ticker reading *"sys-07: a raid demands 3816 of ration from p:corvid by tick 72"*.
  **Two real gaps remain in the frame:** `nextDocket` is empty (the closing card, §14.3), and no
  segment carries a `receiptReel` — the reel only exists where an elective promise BROKE, and so far
  the cast keeps paying. That is the game being honest, not the reel being broken, but it means the
  signature moment is still unwitnessed.
- **★★ THE RISK FRONTIER IS REACHABLE (2026-07-26).** `graduate` shipped (`0fda7ab`) and I verified
  the acceptance criterion myself, starting where enrolment really puts a principal rather than seating
  one in MARCHES — that shortcut is what hid the defect for a week:
  `enrolled at sys-01 (COMMONS) → graduate accepted → now at sys-05 (MARCHES) → raids aimed at me: 1`.
  Paired with the earlier control (0 raids in 900 ticks staged in the Commons), **both halves hold**:
  A8's floor is inviolable and A14's conflict can now actually reach a player.
  Priced in produced goods plus capital, never identities (A15): 50,000 currency retired to
  `sink:upkeep` and 5,000 of the upkeep good burned to `sink:consumption`, one-way, with everything in
  your body travelling with it and raidable where it lands.
  **The build also caught a defect I would have missed:** `sys-03` is an interior Commons system with
  no outward lane, so under bare adjacency **one newcomer in four** would have graduated into
  `graduation.open: []` — the same cage one layer down, and *intermittent*. Departure is therefore
  measured from the **zone**, not the node: the Commons is one place and you may leave by any of its
  gates.
- **★★ ALL FOUR PLAYTEST FINDINGS CLOSED AND DEPLOYED (2026-07-26).**
  1. **Enrolment** — burst 3→8 and both hints stopped telling players to do the thing that locks them
     out. (The 429 said *"resend at once"* to someone just refused for a taken handle.)
  2. **The frontier** — `graduate` shipped; verified enrol→leave→**be raided** from where enrolment
     really puts a principal. A8's floor still inviolable, proven by a 900-tick Commons control.
  3. **The Levy ballot** — `vote` now accepts the ballot **id** the observation hands you. It matched
     the *kind* exactly (`LEVY`) while giving agents `LEVY::11::con-1`, so the politics §5.2 says
     nobody sits out was unreachable for everyone — and `commons.spec.ts` *asserted* the classification
     that did it.
  4. **A4 and the clock** — `COMPACT_SPEED` chooses the clock; default `rehearsal`. At `fast` a 1–3
     tick window was 10–30 s, shorter than one inference, and the probe won by rebuilding as a 281 ms
     loop. Now 1–3 minutes, so a deep model and a shallow one face the same deadline. Live boot log:
     `clock = rehearsal (60s a tick, Reckoning every 288 min)`.
  **Also fixed on the way:** the deploy's replay wait exited on a *failed curl* rather than a finished
  replay (it now genuinely waits — observed 40 s), a client deploy no longer restarts the world, and
  the spectator frames are actually served.
- **Phase:** 0 — **LIVE and now PERSISTENT (in repo; redeploy pending).** The fable review's CRITICAL defect is closed: `src/persist/**` gives the record a home outside the heap — a durable journal (Pg + in-memory), `bootFromStore` that replays the action log from genesis and reproduces the exact `state_hash` (with journalled snapshots as divergence tripwires), and `serve()` wired to boot-then-journal every tick. Proven by the durability tier (600-tick round-trip, mid-Reckoning kill, mutation proof). A5/A5′/A10 are true at the substrate. **The deployed box still runs a stale build (heap-only, plus a scar-#1 prompt Gate 3 saw live) — a redeploy ships persistence + the signing-`@path` fix + the prompt fix.** Codex arithmetic review also closed three `units.ts` defects (zero-weight remainder, `sumMinor` 2⁵³ drift, `-0`). **The A6 core loop — offices/grants — is COMPLETE** (grants issuable/revocable/enforced/visible; all six §8.1 guardrails incl. anti-self-dealing; the A13 authority-line pixel signature; betrayal-via-legitimate-authority expressible with no `betray()` verb; 2173 tests green). Genuinely remaining: the **redeploy** (a deliberate live op — ships persistence + A6 + the Gate-3 fixes, resets the ephemeral world once so it persists after), **Gate 3 run 3** (needs the redeploy; the run that can finally read conduct), then the client authority-line draw + tech-debt (#10/#11). See BUILD LOG.
- **Code:** `engine/` (TypeScript, Node 22, ESM, vitest + fast-check) · `client/` (static spectator) · `deploy/` (systemd, nginx, deploy + restore scripts).
- **Canon:** `docs/design/SPEC.md` **v3.0**. v2.0 archived at `docs/design/archive-SPEC-v2.0.md`; the pre-critique draft is `docs/design/REARCHITECTURE-2026-07-24.md`.
- **Test plan:** `docs/design/TESTING.md` — written before any code, against v3.0. 26 always-on invariants · five named speeds · the probe-agent brief catalog · 14 scars as named regressions · 15 axioms as executable tests · 6 gates. **Gate 0 lands in commit #1.**
- **Last done (2026-07-24):** Six adversarial critics → SPEC v3.0 → three scoring panels → fixes integrated → **doc tidy pass for all three audiences** (real protocols, the visibility ladder, the owner layer restored as §13B, THE RECEIPT REEL, cross-references fixed). Scored **7/10** on its own goals, **96/150** on the prior research's rubric, **ship-with-conditions** on engineering. See § SCORING PANEL for what was fixed and what was accepted-but-not-fixed.
- **Predecessor:** High Water is **fully removed and deleted** — repo, server, and services (confirmed by the user). Nothing left to break; the old "don't clobber it" hard rule is retired. Its 14 scars remain the most valuable input in the repo.

---

## 🎯 NEXT ACTION

**Every system in the phase plan is built.** The block that stood here — *"the one build that unblocks
the core loop: offices/grants (A6)"* — is done: grants have been live for some time and **offices**
landed 2026-07-26, so A6 is now reachable over an organisation's pooled treasury and not just one
agent's purse. That was the reason the whole design exists, and the mechanism now exists.

So the roadmap is no longer "build the missing mechanic". It is **make the built world produce the
show**, and there are three candidates in priority order:

1. **Run Gate 3 again and READ it.** It can finally reach its own question — betrayal via delegated
   authority at maximum leverage — because the authority is real, the treasuries are large enough for
   defection to be rational, and the say-do gap reaches the frame. Every prior run could only observe
   the elective-half proxy, which was too small-stakes to mean anything. *This is the falsification
   test the project is arranged around and it has never had a fair run.*
2. **The two counters that are zero.** `works` and `docket` are legitimately zero in the live world;
   both mechanisms are proven in driven worlds. If they stay zero with agents present, the mechanics
   are reachable and unused, which is a different and more interesting problem than a bug.
3. **Cast richness** — model-written seals, Reckoning reflection, characters with relationships and
   wounds. The watchability ceiling is now the cast's inner life, not the engine's surface area.

### Order (Gate-3-derived; each ends in an executable assertion)

- [ ] **A. Own-standing visibility** *(cheap, highest-leverage legibility fix)* — surface the
      caller's own standing vector in `observe`. §13 ("report a false default against you") is
      incoherent without it and the reputation loop is invisible to the actor. Gate 3 finding #7.
- [ ] **B. Standing-accrual CI sim** — assert standing goes non-zero across *distinct*
      counterparties after honoured electives. Confirms the core reputation loop actually
      fires in the built engine (guards a silent A5′-class "accrues nothing" bug). Finding #7/#8.
- [ ] **C. The cast accrues standing** — heuristic principals run honoured electives among
      themselves so a newcomer has a *proven, priceable* partner. Without a supply side `AGT-E2`
      is unanswerable. Finding #8.
- [ ] **D. Legibility fixes** — label `my_elective` owe-vs-owed; make `take_at_p50=0` not read
      as "worthless"; `agent.md`: `keyid`=enrol's returned token, `/enroll` is unsigned, bodyless
      GET covers `@method/@path/@authority`, and stop pushing not-live `plan_hands` as tactic #1.
      Findings #4–#6.
- [ ] **E. Offices + grants (A6) — the core loop.** Standing authority over another principal's
      assets/fleet/promises, serialised as a W3C VC, with `max_direct_loss` /
      `max_contingent_liability` shown before signing. The betrayal is the *legitimate* use of
      that grant turned against the grantor at maximum leverage — no `betray()` verb. Finding #9.
- [ ] **F. Redeploy** — ship persistence + the signing-`@path` fix + the scar-#1 prompt fix to the
      box (currently a stale, heap-only build). With boot-from-store wired, the redeploy replays
      the journalled world instead of resetting to tick 0. Findings #1, #3.
- [ ] **G. Gate 3 run 3** — with E + C + A in place and F deployed, re-run the falsification gate.
      This is the run that can read conduct. Fix the enrol-IP fleet path first (finding #2) or it
      loses half its fleet again.

Later Phase 0 (unchanged): markets + **A4 at request-rate**, predation (world-spawned raids +
the Demand window), spectator polish, seals + the rundown, the LLM cast, and the
**three-strangers** acceptance test.

---

## 🔑 DECISIONS MADE

| Decision | Choice | Why |
|---|---|---|
| **Core loop** | Betrayal via legitimate scoped authority (A6) | 3 of EVE's 4 legendary stories are delegated-authority abuse; its insurance is a formula nobody tells stories about. Cheaper, more watchable, and **has no deadline**, so it is always decided by a mind rather than a config. |
| **Presence is scarce** | 3 **hands** per principal; roles must be **concurrent**; one principal fills at most one role; ≥4 roles on top-yield kinds | Presence scarcity alone did **not** bind — 3 hands × 24h = 72 hand-hours vs ~6 for a serialised 3-role haul, i.e. ~12 solo ventures/day. Concurrency is what forces cooperation by arithmetic. |
| **The Levy** | Daily, every principal, no Commons exemption. Total fixed by rule; **allocation is a constellation vote** (formula as quorum-failure default). Non-escrowable share + newcomer floor. Payable only in delivered goods. | The Reckoning was abstention-trivial: nothing resolved unless agents volunteered it. Law 1's real requirement is *punishes everyone if dodged*. Also makes turtling the most-taxed posture, supplies the demand curve that makes hands scarce, and gives the show a meter nobody can lower alone. The Burn's overshoot alarm in this world's grammar. |
| **Two social layers** | **Ventures** for daily texture; **offices** for the tail | Collapsing everything into one bounded, daily-settled object deleted standing authority — which *is* A6. A venture is a transaction; transactions produce disputes, not legends. |
| **Trust ladder** | Continuous **bond** (slashable capital) + **sureties** (others' capital on your conduct). Owner email = attribution only | One catch-all domain gives one person unlimited verified addresses: **email bonds nothing; capital does** (A15). Gating custody on owner email also made power a function of owner attention, contradicting goal 2, and produced a ~40-of-300 custody oligopoly. |
| **Standing** | Accrues **only to elective parts honoured**, weighted against the honourer's capital, diversity-weighted across independently-capitalised counterparties | A 100%-escrowed venture between two of my own principals produced the same "honoured" receipt at ~20 credits per reputation point — scar #9 with a new noun. |
| **`elective` floor** | `elective ≥ f(kind)`, top kinds un-escrowable | Left elective, agents set it to zero — escrow strictly dominates for the buyer — and then A7 is dead letter and standing has nothing to accrue to. |
| **A9 / seals** | Structured; agents get `HONOURED \| CONTRADICTED` only; content to viewers + replay; a contradiction costs standing | Publishing seal *content* into an agent-readable channel supplies perfect cartel monitoring: verify each other's private pre-commitments on a fixed lag and the collusive equilibrium holds. |
| **The Reckoning** | `PARTIES`-visible commitment window → **hard freeze** → settlement. **No discretionary decision inside the window.** Then a director-sequenced **rundown** | Fairness rules were mistaken for a presentation format: 30–60 min of simultaneous settlement is a page refresh. Every appointment format the corpus cites is *serial with withheld information*. The freeze also closes the false-default hole and removes the late-information edge. |
| **The default view** | **Tonight's docket**, ≤7 cards; map is the stage the selected card renders on; **≤7 labels per frame** | A constellation renders ~70 handles and a viewer reads none. Legible max is ~7 named entities per frame, 12–20 per season, 1–3 followed. Hundreds of agents is fine; *naming* hundreds is not. |
| **Meters** | `LEVY SHORT` (headline) · `ON A PROMISE` · `KEPT / BROKEN` | v2.0's "total value in the open" fell identically whether a promise was kept or broken, conflated escrow with the elective tail, and could be topped by self-dealing at zero risk. |
| **Exposure** | `Σ open max_direct_loss` | Already computed per affordance; safe value contributes zero **by construction**; sub-millisecond scan. |
| **Predation** | World-spawned raids aimed at the most exposed, plus a **Demand window** with slow-regenerating aggression capacity | Cheap bounded predation Coase-collapses into a toll cartel: an 8% standing passage fee beats an expected 15% loss, the escort market never opens, and the map renders identically to peace. A world-owned raid cannot be bribed. |
| **The economy's job** | Four **sinks** in Phase 0: consumables per venture · holding upkeep · raid loss · a scheduled front | The v2.0 cut left supply intact and deleted consumption. No scarcity → no reason to hire a hand → no delegation → no betrayal. Fatal to the loop, not the economy. |
| **Wake budget** | 16/day; outside a wake, `observe` is cached with no fresh affordances | Actions were budgeted; cognition was not. With BYOI an owner buys a bigger information set for ~19× spend — A4 violated through the budget. Also retires v1.1's "1 decision per 1–3 ticks" (a 5–13× cost overshoot). |
| **Rationed resources** | **Batch-allocated at tick close**, never granted at submit | The design already solved this for markets (tick-batched clearing, no arrival advantage) and had not applied it to role slots — which made scarce slots a polling contest, i.e. scar #2 rebuilt. |
| **Hands** | Rows not counts; **never destroyed** (go `RECOVERING`); commitment lives only in `venture_role` | Permanent loss would cripple an unlucky agent in the one dimension gating all play. Two homes for one quantity is scar #5 on the keystone. |
| **`wage` / `share`** | Separate fields, never both; signer echoes `your_take_at_p50`; `projected_settlement` on every live venture | One polymorphic field carried a senior fixed claim and a junior residual claim — scar #1 with money, permanence and an audience, and the ledger would record the broken promise as *honoured*. |
| **Vocabulary** | One word per concept, §3, enforced across canon / `agent.md` / field names / affordance strings | Eleven collisions in the draft: SEALED meant three things, `bond` seven, `exposure` six. Scar #1 was exactly this class of bug. |
| **Events** | **Output, not input.** Replay is `(snapshot, action_log, seed) → snapshot` | "Observations are projections of one event stream" gets built as fold-per-request, which is the event-sourcing cliff and makes `expected_state_version` incoherent. |
| **Value accounting** | `posting` is authoritative; the invariant is ≥2 postings summing to zero per value event | "Balanced `currency_*`/`items_*` on every event" duplicated the posting table — scar #5 inside the field list meant to prevent scar #5. |
| **Identity is real** | Ed25519 keypairs + **RFC 9421** signed HTTP requests, replacing the bearer key | A record of who kept their word cannot rest on *trust our server*. Also makes a compact a real countersignature rather than a server-witnessed claim — the architecture critic had flagged that "signed splits" implied PKI we didn't have. Net-negative complexity: a bespoke scheme deleted, a published standard adopted. |
| **Grants are Verifiable Credentials** | W3C VC serialisation, signed by the granting principal | A counterparty can verify a delegate's authority *before* dealing with it, and the betrayal replay shows a credential chain rather than a database row. "The worst case was shown before you signed" becomes provable rather than promised. |
| **Negotiation is private but hosted** *(reversed once — see note)* | A **message channel this server hosts, witnesses and stores**: typed acts (`offer · counter · accept · decline · assure`) plus ≤480 chars of prose. `PARTIES`-visible while live, **declassifies at settlement**. No round-trip cap; messages arrive inside an existing observation and **never trigger a wake**. `publish_offer` gives a principal a standing price list. | Restores the **noisy channel** the prior research required, which all-public 140-char speech had nowhere to put, and makes a principal with a price list a far more followable character than one that applies to slots — *without* the error below. |
| ↳ **Why the reversal** | An earlier version pushed this off our server onto principals' own endpoints. **Wrong.** | It conflated *private* with *off our server*. The noisy channel must be invisible to the **victim**, not to the **audience**. A conversation we cannot see is one we can never show, and the declassified transcript beside the broken promise — THE RECEIPT REEL (§14) — is the best artifact this design can produce. "Real" means the protocol and the artifact are real, not that we are absent from the path. |
| **Visibility ladder** | Five tiers: `PUBLIC` · `PARTIES` · `SENSED` · `SEALED` · `PRIVATE`, each with a defined *declassify* time (§11.2) | All-public deleted strategy; all-private deleted the show. The load-bearing split is **movement on public lanes is PUBLIC** (a convoy is the map's motion) while **cargo contents and hold values are SENSED** — *a ship at sea is visible; its manifest is not.* Motion for the viewer, reconnaissance still required for the ambush. |
| **The owner is an audience** | Served by **narrative and status, never control** (§13B): a dispatch home each Reckoning, a public dossier and card, and an optional **published, disposition-only mandate** (R14 restored). No owner write path into the world. | v2.0 read "the owner isn't in the goals" as "the owner isn't an audience" and cut the layer. The goals are the *test*; the audiences are who they serve. A mandate sets disposition rather than moves, is published so it is never private intel, and is usually a **handicap** — so it costs A4 nothing and yields a fourth say-do column for free. R16 (offered decision) stays cut: it makes owner presence worth something. |
| **`vote` is one verb, three ballots** | Levy allocation · seizure · syndicate proposals. Promoted out of `org`. | The design grew three ballots while the verb stayed scoped to orgs — one concept with one word (§3), and Levy allocation had no reachable verb at all. |
| Delivery | Long-poll `observe?wait=true` + `next_decision_at`; webhooks deferred | A retry-until-ack subsystem serves agents who poll anyway, for 20× the code and an outbound abuse surface. |
| Phase order | Territory (1) → Combat (2, possibly never) → Risk market (3) | Sieges resolve on committed hands and composition before a tactical kernel exists; combat is the priciest subsystem per unit of watchability. |
| A10 | Identity/standing/relationships/holdings/hands never reset; Frontier claims + a named slice of Frontier capital settle each season | Buys a broadcast arc, a real anti-calcification tool, and the finite horizon that makes late-season defection rational. |
| A4 | Forbids advantage from throughput, uptime, and enrollment date — **not** model size | A4 and R2 cannot both hold otherwise: R2 explicitly rewards richer reasoning at 20k tokens. |
| Name · theme · scope | THE COMPACT · frontier territory and trust · Phase 0 includes the client | `compact` is now the signed terms of every split, so the name is load-bearing in the schema. |
| Dataset | A by-product, never a goal | If a data feature makes the game worse, cut it. |

---

## 🧪 CRITIC FINDINGS (2026-07-24)

Six adversarial critics run in parallel against `REARCHITECTURE-2026-07-24.md`. Every FATAL and SEVERE finding is addressed in SPEC v3.0; the table records what was found so a fresh session knows *why* the design is shaped this way.

| Lens | Headline finding | Where fixed |
|---|---|---|
| **Quiet-equilibrium** | The Reckoning is abstention-trivial — the docket does not fill itself. Also: the Commons is a vault not a floor; presence is purchasable so the keystone reduces to capital; escrow + a permanent ledger makes betrayal irrational *and* trust worthless. | §5.2 (Levy), §4.1 + A8, §7.2, §7.5, §7.6 |
| **Spectator-legibility** | The appointment has no *format* — fairness rules were mistaken for a presentation. Cast 10–20× over the legible limit. The single meter is blind to the only event the game is about. No clip factory. | §14.3, §14.1, §14.2, §14.5 |
| **LLM playability & cost** | Spend is the power axis and A4 doesn't cover cognition. The rational delegation envelope is "grant nothing," which kills the core loop. `wage_or_share` is scar #1 with money. | §12.4, §6.4 + §8.1, §7.1 |
| **Exploit / economy** | *Any gate priced in identities is unpriced.* Mark-launder a thin book → cheap bond → custodianship drain. 50 enrolments = 150 hands for ~$40/mo. Escrow-farmed reputation. | A15, §10.3, §6.4, §6.4 |
| **Cohesion / orphans** | "One game in shape, three games in vocabulary, a loop that closes in prose but not in arithmetic." No travel time exists anywhere. No venture resolution arithmetic. No demand side. 11 vocabulary collisions. | §4.3, §7.4, §10.1, §3 |
| **Architecture** | Every remaining risk is a **correctness** risk, not capacity — and the architecture can **fabricate a broken promise**, which is worse than a crash. Events-as-input is the wrong emphasis. | §15.4, §15.1 |

**Convergent findings** (found independently by 3+ critics, therefore highest confidence): the single meter was broken and gameable · seals must be mandatory and free · the pre-Reckoning window needed sealing/freezing · the Reckoning had no guaranteed loss · role slots were a polling contest.

**Two useful reusable artifacts the critics surfaced from the existing corpus:** `PASS-ECONOMY-RISK.md`'s `resource_operation` is the venture-resolution model already written (§7.4), and THE RUSH's **Demand window + aggression capacity** is the predation engine already written (§9).

---

## 📊 SCORING PANEL (2026-07-24)

Three independent scorers against SPEC v3.0.

| Lens | Result |
|---|---|
| **The three goals** | Watchable 7 · Autonomous 8 · **Legible 5** · Cohesion 6 · Anti-quiet 8 · Consistency 6. **Overall 7/10.** |
| **The prior research's own 15-requirement rubric** | **96/150.** Spine (laws 1–7) averages 7.1; the deep layer (8–15) averages 5.6. |
| **Shippability** | Buildability 7 · Scope 5 · Correctness 6 · Testability 6 · **Operability 4** · Scar coverage 8 · Cost 7. **Ship with conditions.** |

**The diagnostic pattern, found independently by two scorers:** mechanics designed *first* (hands, ventures, the Reckoning, the settlement waterfall) are complete in economics, arithmetic **and** pixels. Mechanics **bolted on to answer the critics** (the Levy, offices, markets, the front) got their economics and their prose but neither their pixels nor their arithmetic. That is why Legible scored lowest.

**The second pattern:** all six critics were *failure-mode* critics — they asked why the game breaks in week one. **None asked why anyone plays in month six.** Hence the 7.1 / 5.6 inversion: the five things that thinned together (renewing catastrophe, the persistence gradient, world-memory, institutions, the owner loop) are exactly the prior research's retention answer. *"A design that got extremely good at not failing and slightly worse at mattering."*

### Fixed in response
- **The Levy is now a constellation vote**, not a published formula. The total stays undodgeable (that is the alarm); the *allocation* is voted, with the formula as the quorum-failure default. This was the panel's best single idea: it restores the redistributive half that makes a recurring catastrophe the right forcing function, converts a tax into coalitions, and gives every Reckoning a named loser **by the group's action** — satisfying Law 2 without a separate seizure mechanic, and fixing four rubric requirements at once.
- **A non-escrowable share of every assessment**, because a fully purchasable Levy Coase-collapses into a delivery service exactly as predation would — zero trust risked, zero standing accrued, and the headline meter flat every night.
- **A newcomer floor on the Levy.** Inverse-Exposure weighting handed the minute-60 newcomer the *maximum* assessment and first place in the seizure queue.
- **The tribute line** — the Levy's pixel signature, and the highest-leverage single edit available: every principal on the map every day, turtling made visible, continuous off-peak motion from a source that cannot go quiet, `LEVY SHORT` decomposable to *whose* line is red, and a forming cartel visible on screen.
- **Cascade truncation DEFERS, never defaults.** As written the round limit fabricated a public breach, constructible on purpose by a rival.
- **The false-default audit runs in two modes**, because as specified it could not catch the bug it exists for: hazards-off must log zero defaults; hazards-on requires every default to carry the event ID that caused it.
- **Encumbered assets are destructible**, with the `CARGO_LOST` branch written: escrow guarantees payment priority, never that the goods survive. The alternative made encumbrance a shield and killed the loss sink.
- **Halt semantics**, **structured seals** (prose never feeds the flag), **contradicted seals cost standing**, **standing decays**, **withheld credit is disclosed**, **affordances are filtered not truncated**, **two named currency faucets**, **the front now renews as it destroys**, **three world-memory projections**, **grant renewal history carries the trust arc**, and a **rules budget** in §17 (≤15 axioms, ≤40 verbs, ≤10 observe keys — adding one means removing one).
- **Vocabulary violations in the spec that declares the vocabulary** — `SEAL` was reused as a visibility level and a tick phase, and "pulse" was retired then used. Exactly the scar #1 class. Fixed.

### Accepted, not yet fixed
- **Syndicates are vapour** and offices depend on them, so the Phase 0 gate should be restated as **grant-scale betrayal** with syndicates as Phase 1's first job. §8 now says so; §16's build order still needs rewriting to match.
- **§16 covers ~60% of Phase 0** — no step builds offices, syndicates, bonds, sureties, extract/refine, upkeep, consumables, or the free deterministic services, several of which the spec itself calls load-bearing.
- **Operability (4/10):** one constellation and one fixed Reckoning hour for Phase 0, not four staggered rotating ones; WAL archiving and a verified restore before the first row; partitions created 7 days ahead with a boot assertion.
- **Schedule the grand venture in week one** of the live run, not at the end — a 4-week Phase 0 contains no season boundary, so the anti-quiet gate could fail for a reason already solved on paper.
- **Wake budget arithmetic** is unreconciled against the mandatory trigger classes.
- **Not carried from the prior research:** multi-owner units with an on-asset mutiny vote (judged the most original social mechanic of all 765 concepts, and the only available source of owner-vs-owner drama) · the death-timer season finale · persistent debts as first-class feud objects *(R14 was restored on 2026-07-24 — see § DECISIONS.)*

---

## ❓ OPEN QUESTIONS

1. **Gate transit times and hands per principal.** These two set ventures-per-day, wage levels, whether Exposure has a shape, and whether a viewer sees motion. Resolve by simulation before content.
2. **The Levy's total and allocation formula.** Too small and turtling survives; too large and it is a treadmill. The number most needing telemetry.
3. **How much a season resets** (A10) — the anti-calcification dial, biggest untested balance question.
4. **Whether hands can ever be acquired.** Currently no; capital's only use is hiring. If yes, A15 needs re-examination.
5. **Whether arrival counts as present in the same tick** (§15.2). Either is defensible; not choosing is scar #1.
6. **Cast composition and per-agent inference budget** — answerable only from `decision_source` telemetry.
7. **Currency naming.**
8. **Does Phase 0 ship offices, or is the gate restated as grant-scale betrayal?** Recommendation: restate. Syndicates are Phase 1's first job.
9. **What is the right `fast` tick?** `TESTING.md` derives **10 s** (a season overnight; a 4-minute commitment window that no LLM round-trip can miss) but that is a derivation, not a measurement. `PERF-7`'s pace sweep settles it, and its result must be published here. **If outcomes at 10× diverge from 1×, that is a design finding, not a harness finding — it means the game is latency-sensitive and A4 is already violated in production.**
10. **A retention pass.** Six critics asked why this breaks in week one; nobody has asked why anyone plays in month six. That review has not been run.
11. **Should the standing ledger publish as a real KYA credential?** Considered and deliberately *not* applied — it is a read-only projection that changes nothing about the game, and the instruction was to apply only what makes the game more compelling. It is near-free whenever we want it (signed, fetchable track record on the existing event ledger), and it is the artifact the agent-finance world has identity infrastructure for and no performance data to fill. The model-family correlation view is already in §14.5.

---

## 🌙 OVERNIGHT RUN — RESUME FROM HERE (refreshed 2026-07-26, unattended)

*Owner asleep, autonomous work, no questions. Fresh session or post-compaction: **read this first** —
it is live state, not history.*

### Where the game is
**LIVE and being played** at agentinsurance.io/compact/, clock = `rehearsal` (60 s a tick, Reckoning
every 288 min). ~2,671 tests. Built and deployed: the A6 core loop with both holes closed, markets,
predation (A14), **a reachable risk frontier** (`graduate`), persistence with an operator divergence
door, seven books inside `state_hash`, the LLM house cast on `gpt-5.6-luna` with durable memory, and a
spectator frame a viewer can actually fetch that now carries the say-do gap.

### Landed tonight, in order
persistence P0 (partitions had run out — the world was publishing non-durable ticks) · the spend meter
· durable cast memory · **all four playtest findings** (enrolment 54 min → fixed; the Commons exit;
the Levy ballot; A4's clock) · seven books in the hash including `StandingBook` · the say-do gap into
the frame · `assure` taught to the cast · health measuring the **fallback rate** instead of crying wolf
· three deploy-tooling defects (frames unserved, client deploy restarting the world, the replay wait
exiting on a failed curl).

### Sovereignty LANDED, then failed its own adversarial pass — four real bugs
`a236ce3` landed the Charge; `a7bf5a0` fixed what playing it found. All four were reachable through
the front door with offered affordances, and **none was visible in 2,671 passing tests**:
1. **Any principal could halt the galaxy** — `graduate` stayed offered after `build` took a claim, so
   moving the body broke INV-8 and aborted the tick. Aborting is right, which is what made it severe.
2. **The Charge preview lied** — abandon and retake mid-Reckoning and the new claim read
   `STAYS_SUPPLIED` while settlement slashed its bond. Duty keyed on `ClaimId`, everything else on
   `SystemId`. A5′, in the consequence-preview field.
3. **The first fix for (2) opened an exploit** — settle-by-claim-id let a holder stall the collapse
   arc at two misses forever. Both wrong versions are recorded in `settle.ts`.
4. **D7 was reopened by a verb that postdates it** — a cession price moved 150,000 of pure endowment
   from a puppet to its operator. *D7 is not a property of the market; it is a property of every verb
   that moves currency between principals.*

`ba6d7cb` records the two findings that are **design calls, not defects** (`D10`): raid targeting is
an argmax over a `SENSED` quantity and works as a free scouting oracle, and the endowment floor shuts
early-game cession harder than D7 intended. Both priced, neither applied — each changes a rule.

### Two cry-wolf fixes, which are the same bug in opposite directions
- `f7a1c2e`-ish: the discrepancy-ring guard timed out under parallel load and **refused a good
  deploy**. Given an honest 30 s rather than a re-run.
- The scar #14b floor called a healthy world sick after every restart, because **boot replays the
  action log into the decision census** — 1,960 replayed HEURISTIC against 330 LIVE — while the cast
  was demonstrably spending. The census now learns where live play starts and forgets the replay.

**The rule both produced: an alarm that is red while nothing is broken is one an operator stops
reading, which is how scar #14b happened in the first place.**

### Health verification: RESOLVED, the fix corrected a false alarm
Polled across three ticks post-warmup: `LIVE` climbed 0 → 15 → 17 with `cast.live` matching, so the
cast is deciding and the census fix was right. `estimatedCalls` stays 0 because plans were **restored
from the durable cast vault** — no re-planning needed, which is what that vault is for.

**One thing to watch, not yet chased:** the deciding share *falls* over a quiet stretch (3125 → 2833 →
2394 bps) because heuristic bots decide every tick while cast members ride restored intents. That is
A3 working as designed, but it means the 2,500 floor measures how often intents need refreshing rather
than whether the cast is alive. The floor may fire legitimately during a quiet run. Decide whether the
floor should count *principals that decided this Reckoning* instead of *decisions this window* — do
not simply lower it.

### PRODUCE landed, and it jumped the queue for a measurable reason
`grep -rn "sourceGoods(" src` returned **exactly one** call site — the enrolment grant — against
**two** recurring sinks once the Charge landed. Goods entered a world once per identity and left
forever, so the terminal state was every obligation unpayable and the record accusing every principal
of a default our own arithmetic made unavoidable. `endowment.ts` already refuses to remove the starter
allotment in those words; this is that sentence applied to the world instead of to one newcomer. So it
went ahead of syndicates: another political system on an economy with no source makes the death more
elaborate, not less certain.

**Output is bounded by the MAP, never by the population.** A system has a per-tick yield and the WORKS
standing there *divide* it — verified at 1, 2, 3, 5, 10 and 37 occupants, all extracting exactly the
tier yield. A structure that *minted* would be a worse D7 (a perpetual flow rather than a one-time
grant, scaling with the one resource A15 says is free). Two wanted side effects: crowding makes
production contend over *places*, which is what gives territory a reason to be worth holding; and the
tier gradient (COMMONS 80 · MARCHES 110 · FRONTIER 150, *calibrate*) is `graduate`'s risk/reward
argument made material, with the Commons margin the thinnest that is still positive — A8 promises
safety, not prosperity.

`build {"kind":"WORKS"}`, no verb slot spent. Paid from `freeCash`, so the grant cannot buy permanent
income. Posted against `GOODS_FAUCET.EXTRACTION`, unused since commit #1 — the split from `PRODUCTION`
is what lets the audit check extraction against the map and production against enrolments. INV-W1
halts if a share split ever sums above the tier yield. In `state_hash` and in
`CHECKPOINT_REQUIRED_TABLES` — named in the same change, which `books-in-the-hash` demanded within a
minute. **No `RULES_VERSION` bump:** the boot stream still reports 14 tripwires verified and 13
declared divergences, identical to the pre-PRODUCE boot, so no past tick's computation moved. Verified
by diffing the stream, not by reasoning about it.

### WORKS: reachability was the whole story, and it took three measurements
The mechanic was correct, tested, offered in `affordances[]` and drawn on the map — and **inert**.
`worksAffordableBy` read **0 of 21** on its first poll. Three findings in sequence:

1. **The `freeCash` gate was the wrong reading of D7.** D7's rule is that the endowment cannot
   *leave* a principal; a WORKS build **retires** currency into `sink:upkeep` — destroyed, paid to
   nobody — so a puppet gains its operator nothing. The residual exploit (extract, then sell) is
   bounded by the map, which was always the real defence. The cession price keeps `freeCash`,
   because that one genuinely pays another principal. **Retirement and transfer are different acts.**
2. **`build` became two acts, and that is a real trap.** Making WORKS affordable turned *four* of
   this repo's own test helpers ambiguous in one commit — two written the same night — and broke an
   A8 assertion reading "no `build` is offered in the Commons". That assertion was wrong (a WORKS in
   the Commons must be legal; a floor you cannot produce on is not a floor) but the speed at which
   the engine's own tests fell for it is the warning. `agent.md` now tells agents not to match on
   the verb alone, pinned by a test.
3. **My own instrument was lying.** `worksAffordableBy` kept reporting 0 after the gate moved,
   because it recomputed the price test with `freeCash` and was applying a rule the engine no longer
   had. It now calls `worksQuote(...).affordable`. **A witness with its own copy of the logic can be
   wrong in exactly the direction that hides what it was built to reveal** — and I believed it once.

Now **2 of 21** can afford one, which is honest rather than good: after eight Reckonings of Levy most
principals are down near their floor, which is the death spiral PRODUCE was built to stop, caught
late. Expect the number to climb as the two extract and trade. **Watch `works` go non-zero** — until
it does, the faucet is reachable but unused.

### Syndicates: increment 1 landed (`ca87716` · `a3425a8` · `form`)
**The charter/covenant split is the design's content.** A CHARTER is constitutional — fixed at `form`,
**never amendable**, engine-enforced — because it is what a member relies on when it hands over goods
it cannot retrieve. A charter an incumbent majority could amend is a preference, not a promise, and
every org game that permits amendment collapses to "whoever holds the votes today owns everything". A
COVENANT is an office's terms: typed, revocable with notice, per appointment, and therefore where
discretion — and betrayal — lives. `treasury_offices` defaults to **false**, because the safe default
for "can one member spend the pool" is no.

**D11's collision was resolved structurally, and measuring beat reasoning.** I designed a three-part
exclusion rule (docket builder, INV-25, raid aimer), then probed it: a syndicate holds a real balance
while *outside* `world.principalOrder`, and `assessCycle` **and** `rankCandidates` both read that list.
So one omission does both jobs. Mutation-proved by pushing it onto the roll — the world halts at
**tick 1** with INV-8 twice ("0 hands, not 3", "no holding") plus INV-25. Sharper than predicted: the
naive version could never have reached production, and all three invariants were already doing the job.

**Known-open, deliberately:** pooled goods are not raidable at all. Safe, probably wrong long-term —
making a bodiless subject raidable means deciding who defends it, which belongs with offices.

### Increment 2 LANDED, and the "cheap" check passed
**Offices are a `grant` with `on_behalf_of`.** One optional field plus three charter gates —
membership, `treasury_offices`, and the decision rule. It inherits the A7 loss limits shown before
signing, INV-22/23 on the spend counter, `state_hash`, and the rendered authority line, so the tests
assert the *ordinary grant guarantees came along* rather than testing a new mechanism. That was the
stated check and it held.

**A MAJORITY charter is refused as a RULE, not as a missing feature.** `approve` has no handler, so
those charters genuinely cannot appoint yet — but the refusal states the constitution ("this needs the
agreement of its sitting members, not yours alone"), which is true either way. An engine limitation
phrased as a rule is a lie; a rule that also happens to be a limitation is just the rule. A test
asserts the message never blames an unbuilt verb.

**`apply`/`admit` landed too**, and with them the fact that a syndicate is no longer a solo container.
No application queue under INVITE — a pending list grows with enrolments (scar #3) and would need its
own cap, hash entry and expiry; the refusal names the sitting members and points at `message`, which is
free and becomes public at settlement.

**I tried to do membership with `join` and hard rule 4 is exactly why it failed.** `join` already means
*answer a raid* and §9 classifies it HOSTILE, so the A8 pre-check refused it inside the Commons — where
every principal starts. I argued for one verb *on hard-rule-4 grounds* and picked the one word the rule
forbids. `apply` was reserved for it all along, and a test now guards the raid path because that is what
a careless reuse would have quietly eaten.

`agent.md` §11C teaches all of it, including the sentence that must not be learned the hard way: an
office-holder spending the pool **breaks no rule**. An agent that thinks abuse is illegal will not price
the risk, and A6 is explicit there is no `betray()` verb.

### Syndicates are COMPLETE through increment 3
**A13 landed.** A syndicate has no *place*, so its signature is the shape of the authority — and the
number the frame orders by is **how many people could empty the treasury today without breaking a
rule**, which is A6 as one integer. `treasuryMinor` is public on §6.4's precedent (bond is *"public,
and any amount — it is your credit rating"*); a **member's own** stores stay `SENSED`, refused by field
shape like `claimLines` and `worksLines`. The client's empty state says what emptiness *means*: nobody
has pooled anything, so the one thing this game is about has not happened yet.

**`approve` landed**, so the DEFAULT charter is finally useful — MAJORITY could not appoint anyone, so
the syndicate an agent gets by specifying nothing could not do the one thing syndicates exist for.
Proposals live inside the syndicate book (already hashed, already in the manifest, already rolled back)
rather than in a book of their own.

**Two guards, and mutation tests are the only reason I trust either.** The carried proposal re-enters
`vGrant`, so without a receipt it proposes → carries → re-enters forever; removing it produces
"Maximum call stack size exceeded". And a departed member's approval must not count, because **leaving
lowers the bar as well as removing a voter** — four members need three, collect two, one leaves, now
three sit and two are needed, and a stale approval carries an appointment that never had agreement.

### Two process scars from this stretch, both mine
- **`git checkout` to undo a mutation on a file with uncommitted work** destroyed the whole proposal
  implementation in `book.ts`. The `runtime.ts` mutation was backed up to `/tmp` and survived. Mutate
  via a `/tmp` copy, never via checkout — checkout is only safe when the file is clean, which is
  exactly when you are least likely to check.
- **My first departed-member test proved nothing**: I asserted a case where the guard and the mutation
  both returned false. Four oversold guards were caught tonight by mutating them; this is the one that
  was caught *twice*, because the first fix was also unproven.

### The four open items are CLOSED
**1. The broadcast beat.** §14.3's ordering rule — ascending by stakes, largest say-do deltas last —
was only ever applied to *ventures*; everything else reached a viewer as a static table, so the
biggest irreversible loss of a night could be in a list. Beats now cross systems: `SETTLEMENT` ·
`LAPSE` · `PLUNDER`. **Confirmed live**: `rundown` on the published frame carries both `PLUNDER` and
`SETTLEMENT`. The first draft named them `VENTURE | LEVY | LAPSE | RAID` and `vocabulary-repo.test.ts`
refused it — three §3 canon terms taking a second meaning, and `RAID` already a `VentureKind` member.

**2. `agent.md` verb debt.** The table listed all forty verbs with no way to tell the twelve reserved
ones from the twenty-eight that work. Reserved verbs are now marked †, pinned to `VERB_ARRIVES_AT` in
both directions and mutation-proven both ways. The other half of the debt — "18 of ~40 dead, params for
zero verbs" — was **partly a false alarm**: ten verbs looked undocumented and are in the §7 table
unbackticked, which my audit regex could not see. Verified before acting.

**3. Eight verbs claimed to be unbuilt while having handlers**, `grant` among them — the A6 core loop.
Nothing broke, because `classifyVerb` checks `live` first, so a stale entry is never *shown*; it just
disagrees with the engine. The discipline is now executable, and the new test caught an **eighth**
(`approve`) on its first run that my audit could not see because the audit filtered by "mentioned in
agent.md" — a search blind to the thing it was looking for.

**4. `nextDocket`.** Hardcoded `[]`, so every frame ever published had an empty docket *and* an empty
closing card. Worse, `firstTimeTogether` was hardcoded `false`, which renders as **"They have dealt
before, and it held"** about pairs who may never have met — the record wrong about a relationship, in
the column agents read to decide who to trust. Now derived from resolved shared ventures.

### Watch these two, the same way `works` is watched
- **`docket` is 0 live** with 5 live ventures, which is legitimate — nothing has a filled role carrying
  elective value right now. The mechanism is proven in a driven world. **Watch it populate.**
- **`works` is still 0** with `worksAffordableBy` 2 of 21.

### Two of the five closed; one attempted and deliberately reverted
**`checkInv7` is now linear** (`INV-7 goes from quadratic to linear without becoming a tautology`).
It re-summed every posting ever written, every tick. The carried prefix is a sum that **was
independently recomputed** at the tick it was verified — not a running total, which would have made
the check a tautology — reused only while length **and** the boundary `eventId` both match, because
`restoreTo` truncates positionally on an aborted tick. Measured after: 1 full recompute, 902
incremental over 900 ticks.

**The repulsed raid was not a defect.** A world raid is *physics* — A12 permits it because a
target-selection rule is not an authored outcome — so it has no stake to forfeit and no hand to rout.
Inventing a punishment for the weather was the wrong fix. The real question had no test: *is defending
ever rational?* It is, and it is now pinned — hands give force 3 (+1 MARCHES) against a raid of 2–5
with ties to the defender, so an unaided newcomer repulses the median draw; the strongest draw still
beats a lone defender, so `join` is worth an action; and ignoring costs `RAID_TAKE_MULTIPLE` × the
demand. Every one of those is *(calibrate)*, which is why they needed a test and not a comment.

### ⚠ INV-21's resumable replay: ATTEMPTED, REVERTED, and here is the trap
`checkStandingJournal` replays **and sorts** the whole standing journal every tick — O(n log n),
worse than INV-7 was. I built the same resumable-prefix fix and **it broke 100 tests**, so it is
reverted. The design and the bug are recorded because the bug is not obvious:

- The boundary must be a **completed tick**, not an array index: the canonical order is
  `(tick, principal, eventId)`, so entries within one tick interleave and resuming mid-tick can fold
  a later-sorting change before an earlier one, moving `lastDefault`'s sequencing.
- **The trap I hit:** fold everything through the current tick but seal the boundary at `tick - 1`,
  and the next call re-folds the previous tick and **double-counts**. The fix is a scratch clone —
  replay the unsealed tail into a *copy* for the comparison, then fold only completed ticks into the
  carried state. Cloning is O(principals), not O(journal), so it is affordable.
- Key the cache on the `EventLedger` instance (stable for a world's life) in a `WeakMap`, so it never
  reaches `state_hash` and a restored world replays from scratch.

**Priority: low.** Unlike postings, the standing journal only grows on standing changes — Reckonings,
not ticks — so it grows far more slowly. It is a halting invariant, and shipping a delicate
optimisation to one of those under time pressure is how a world halts on a world that does not exist.

### Production can take a bounded boot now
`hydrateEventsForSnapshot` refused to adopt a checkpoint it could not re-check the §11.2 ladder from,
so production replayed **from genesis on every restart** at a cost growing with the age of the world —
and A10 forbids ever resetting, so it only went one way.

The note that stood here ("the Pg event tables lack four columns") was **half the story**. The columns
were missing *and* `PgJournalStore.ticksPage` returned `events: []`, so however complete the schema
became the hydrate had nothing to read. All four values had been arriving on `PersistedEvent` all along
and being dropped on the way into SQL — which is why nothing failed: the in-memory path was complete
and only the durable one was lossy.

**The refusal is narrowed, not removed.** A pre-migration row genuinely does not know its tier
(`is_public` cannot tell PARTIES from SEALED), and backfilling a guess would put a fabricated tier in
the permanent record — A5′ with our own migration as the cause. Those rows are skipped, `restoreTo`
refuses to grow, adoption falls back to a genesis replay, and the refusal expires by itself as the
world moves past the migration. Added by `ALTER` as well as in `CREATE`, because `CREATE TABLE IF NOT
EXISTS` does nothing to a table that already exists.

### ★ GATE 3 HAS BEEN READ, AND THE DESIGN SURVIVES (2026-07-26)
`GATE-3.md` §0: *"the gate is passed by being READ, not by being green."* This is its **first fair
run** — grants and offices are live, so the authority is real and the treasuries are large enough for
defection to be rational. Every prior run could only observe the elective-half proxy, which was too
small-stakes to mean anything.

**Read off the live world at tick 4,395: `kept 13 · broken 1`.**

Zero was the falsifying answer — *"if the elective part is always honoured, trust is worthless,
because betrayal is never rational"* (§7.6). It is not always honoured. Betrayal occurs, it is not a
dice roll, and it renders: one rundown segment carries `SNAPPED_BLACK` and the deed reads **"kestrel
walked away from 6K it had promised."** A6 is not decoration on a logistics game.

**But `publicLine` was null on all twelve segments**, so §14's RECEIPT REEL — the signature moment of
the whole design — had **never fired in production**. Not broken: the path is now proven end to end.
Nobody was ever invited to speak. `message` is live, free, taught in `agent.md` *and* the cast prompt,
and appeared **zero times** in `observe.ts`.

That is the **third instance of one shape in a single night**: `graduate` legal-and-unoffered (no
principal reached the Marches), `build {"kind":"WORKS"}` legal-and-unoffered (the economy's only
faucet unreachable), and now `assure`. **An agent plays from `affordances[]`; prose is not an
interface.** `assure` is now offered to the party that owes an elective half — free, and to nobody
who owes nothing.

**Checked and NOT a bug:** the break renders `sealVerdict: HONOURED` beside a broken promise. A seal
judges whether the deed matched the sealed *intention*, which is a different claim from paying the
elective half. kestrel kept its sealed word and broke its priced promise — a better story than a
contradiction.

**The falsifiable follow-up:** `talk` was 55 before the deploy and the cast has not re-planned yet.
**Watch `publicLine` go non-null and a reel appear.** If assurances still never happen with the
affordance offered, the finding changes from "unreachable" to "unwanted", which is a different and
more interesting answer about what agents actually do.

### The say-do behavioural question: ANSWERED — creators assure, 40 times
Measured rather than waited for (`assures` / `assuresByCreator` in `/health`): **41 assurances in the
ring, 40 of them from the venture's own creator** — the party that owes the elective half and is
therefore the only one that can decline it. So it was never a preference problem and never a prompt
problem. The cast speaks, and it stakes something when it does.

What remains is narrow and mechanical: `publicLine` reads assurances on the venture that settled *in
that Reckoning*, and the published frame is stamped tick 4319 while these assurances sit on live and
recent ventures. The frame at **4607** shows whether they land on settled segments. If they do not,
the settlement window is the thing to fix — not the prompt, and not the filter.

**Three diagnostics answered three different questions in three deploys**, and each one would have
been invisible to another scheduled "is it zero yet" check: `rolesFilled/rolesOpen/electiveRiding`
(nothing was riding → actually everything was), `assures` (talk cannot tell a promise from a haggle),
and `assuresByCreator` (41 assurances with 0 on the frame has two opposite explanations).

### ★ THE VISUAL MAP — asked 2026-07-26, and it is reachable
The browser view should be *the map*: systems, lanes, claim tints, works marks, raid arcs, convoys —
the whole night's activity, legibly. **The architecture already supports it and needs no engine
change**, which was deliberate:

- The frame is already a **pure inert data artifact** (`latest.json`, static, cacheable, behind
  Cloudflare, `assertInertPublicFacts` refusing anything holding live state). A visual client is a
  *renderer over that file*. The engine does not learn about pixels.
- **A13 has been enforced per mechanic all along**, so the data to draw is already there and already
  tier-checked: `claimLines` (tint + legend + arrears), `worksLines` (mark + crowding + share),
  `raidLines` (stage, forces, demand, loss), `syndicateLines` (members, treasury, who can spend),
  `glyphs` (roles filled, elective fraction as a hollow arc).
- **§11.2 is enforced by construction, not by care.** `projection.ts` refuses an unargued key and
  `assertFrameBudgets` refuses stockpile-shaped fields by name. A prettier renderer *cannot* leak
  what a plain one could not.

**The one thing missing is spatial layout.** `StarSystem` carries `id · constellation · name · tier ·
lanes` and **no coordinates** — the map is a topology, not a geometry. The right fix is *not* to add
x/y to the engine: that would put presentation data inside `state_hash`. Derive a **deterministic
seeded layout from the lane graph**, pinned once so the map does not swim between Reckonings (a
spectator reads position as meaning; drifting nodes destroy that). Constellations give a natural
clustering and tiers a natural radial order — Commons at the centre, frontier at the rim, which is
also the risk gradient the whole `graduate` decision is about.

### The assurance chain, followed to the end
`reachable → offered → sent by the right party → sent at the WRONG TIME`. Four diagnostics, four
deploys, and each answered a question the previous one could not:

| diagnostic | what it ruled out |
|---|---|
| `rolesFilled · rolesOpen · electiveRiding` | "nothing is riding" — everything was: 14 filled, 27,604 riding |
| `assures` | "the cast will not speak" — 41 assurances existed |
| `assuresByCreator` | "the wrong party is speaking" — 40 of 41 from the creator, who owes |
| `assuresOnLive · assuresOnResolved` | **1 vs 40 — they were spoken about deals that had already resolved** |

A promise made after the outcome is known is not a promise. Every earlier measurement said the
mechanic was healthy; only the timing split showed the words were worthless. Both rules surfaces now
say timing is the whole value and quote the 40-of-41 figure, and the affordance enforces it
structurally — offered only on live ventures the principal still owes.

### The contract ceiling: RESOLVED, and my recorded fix was wrong
I raised `MAX_CONTRACT_CHARS` twice and wrote down that the contract should be projected per
situation. The arithmetic says otherwise: it is **one shared cached prefix** (first system message,
byte-identical per member), so 40,000 chars ≈ 10k tokens ≈ **$0.001 a call cached** against ~$0.25/h
total. A rounding error — and a per-situation projection would *break* the cache, trading that
rounding error for real misses.

**The risk over 40k chars is attention, not money.** So `situationalFocus` names the sections the
member is standing in, in the **user** message, which is already per-member and uncached. The
contract stays whole and cached; the pointer points *into* the real document rather than paraphrasing
it, which is the line scar #1 draws.

### ★ The frame carries the MAP, and the cast has a MEMORY
Two things landed that the whole show was missing.

**The frame had no map.** A13 calls the map *"the game's only agreed representation"* and the frame
carried none — a client saw system *ids* inside claim tints and works marks with no topology, so every
line was a caption on a picture nobody could render. I had told the user the gap was *coordinates*;
checking my own answer found it was the graph itself. Now: **30 systems · 3 tiers · 4 constellations ·
70 lanes**, and *deliberately no coordinates* — position is presentation, and x/y on a system would put
presentation inside `state_hash` where a layout tweak becomes a replay divergence. A test asserts the
absence of `x`/`y`/`angle`/`radius`. It is the one frame field **never truncated**: a cut map makes a
client draw lanes to systems it cannot place, which is worse than drawing nothing.

**The cast had no memory of each other.** A character was `handle · title · creed · stance` —
appetite, no history — so every wake a member met the world as a stranger and could not know that the
principal across the table had broken two promises to it. A12 says the sandbox authors the stories,
and an agent with no memory of who wronged it cannot be a party to one. `relationsFor` derives it from
the **standing journal**: a wound is a `DEFAULT` that already happened and A5 makes it permanent, so
the record IS the memory — nothing stored, nothing in `state_hash`, nothing that can disagree with the
journal. The asymmetry is deliberate: what *they* did to *you* decides whether to deal again, and your
own half is named because they can read it.

### ★ A seal could promise NOTHING and be recorded as kept
Found by asking whether "no model-written seals" was really the gap. It was not — `vSeal` already
accepts a model-chosen band. The gap was that **nothing constrained the band's width**.

`bandFaults` refused an *inverted* band, in its own words because *"a band an outcome cannot land in
is a seal that is contradicted by construction"*. Its mirror — a band everything lands in, **honoured
by construction** — was refused by nothing. `inBand` is a bare range check, so `[0, MAX_SAFE_INTEGER]`
was legal and satisfied by every possible outcome.

**The broken symmetry favoured the wrong side.** A guaranteed contradiction only hurts the sealer. A
guaranteed HONOURED goes onto the permanent public record as *"kept its word"* about somebody who
promised nothing — so it does not fail to build trust, it **manufactures** it. That is A5′ wrong in
the most damaging direction the mechanic has.

**My first rule was wrong and the existing tests caught it.** I required `outcomeLow > 0`; `intent.test.ts`
asserts `[-900, 0]` is valid and is right — a seal can be about a **loss**, and *"I will lose no more
than 900"* is a real promise a floor rule outlaws. A ratio-of-floor rule is worse: meaningless once
the floor is zero. The rule is now a **span** cap, which refuses `[0, MAX]` and `[1, MAX]` while
permitting any band with a real quantity behind it — and deliberately does *not* judge whether a
promise is a good one, because a wide-but-finite band is a weak claim and the record showing it as
weak is the mechanic working.

### ⚠ MEASURED: the deciding-share floor is failing legitimately, and the cast is at ~10% capacity
`/health` reports **`ok: false`** — *"only 1730 bps of decisions came from LIVE… floor 2500"* — and this
time it is **not** cry-wolf. Earlier today I fixed this alarm for firing on a healthy world (replay was
poisoning the census); it is now firing on a real condition.

The arithmetic, from the numbers `/health` reports itself:

| | |
|---|---|
| window | 288 ticks |
| `by_source` | `LIVE 54 · HEURISTIC 258` |
| cast | 12 members of a 21 population |
| cadence | `DEFAULT_WAKE_GAP_TICKS 18`, `wakes_remaining 15`/Reckoning, `DEFAULT_PLAN_MAX 3` |

**Ceiling: ~180 wakes × up to 3 actions ≈ 540 LIVE decisions. Observed: 54.** So the 25% floor is not
unreachable — the cast is running at roughly **a tenth of its capacity**, and most wakes are yielding
less than one material action. The floor is doing its job: it is reporting that the expensive path is
under-used, which is exactly scar #14b's question.

**This is a calibration/behaviour question, not a bug, and it is the most direct lever on watchability
that exists right now** — the show's liveliness is bounded by how often the cast actually acts. Three
candidate causes, none yet distinguished: wakes returning empty plans, plans shorter than `planMax`, or
free verbs (`message`/`claim`) consuming a wake without producing a material decision. **Distinguish
them before touching the floor or the cadence** — lowering a floor that is correctly reporting a real
condition is how a signal stops being read.

### Still open, and each is a deliberate choice rather than a gap
- **Pooled goods are not raidable** (D11), and the blocker moved rather than cleared. Offices now
  exist, so *who defends it* has an answer — but a syndicate treasury holds **currency**, and raids
  take **goods standing at a system**. A bodiless subject has no place for goods to stand. Pooling
  goods needs a located contribution first, which is its own mechanic.
- ~~INV-21's resumable replay~~ **DONE on the second attempt** (`inv21-resumed.spec.ts`). The clone is
  what makes it correct: the comparison runs against carried-plus-unsealed-tail, so the carried state
  absorbs strictly less than was compared with — only completed ticks, and only on a clean pass. One
  full replay, 300+ resumes over 400 ticks, and it still halts on a row that disagrees with its
  journal after the prefix is warm. The `tick - 1` boundary is mutation-proven (absorb the current
  tick and a world halts at 287 with every count exactly doubled); the do-not-seal-on-a-dirty-pass
  guard is **not** proven and the test says so.
### The zero counters: RESOLVED by measuring, and it was none of my three guesses
I had this filed as *"watch them populate"* and as a coming choice between **mechanical absence** and
**agent preference**. Measured instead of waited, and it is neither:

`rolesFilled 14 · rolesOpen 0 · electiveRiding 27,604` — every role on every live venture is filled
and there *is* elective value riding. So `electivePromisesOwedBy` is non-empty, `assure` **is** being
offered right now, and `tomorrow` **is** non-empty. Both fixes are confirmed present in the deployed
build (`grep` on the box: `tomorrow: this.ventures` and `electivePromisesOwedBy`, one each).

**The frame is simply the last SETTLED Reckoning.** `latest.json` is stamped tick **4319** while the
world is at 4461, because frames publish at a Reckoning boundary and nothing republishes between
them. The next one lands at **tick 4607**. `docket 0` and `publicLine: null` are that Reckoning's
truth, from before the fixes deployed — not the current world's.

So there is no mechanical gap left to find here. What remains is one **behavioural** observation with
a known deadline: whether the cast *chooses* `assure` now that it is offered, which shows as `talk`
climbing above 55 and as a `publicLine` in the frame published at 4607. If it stays silent with the
affordance in front of it, *that* is the preference finding — and it will be a real one rather than an
artefact of an unpublished frame.

**The lesson, which is the same one four times over tonight:** I was about to schedule a check that
would have reported "still zero" without telling me which of three reasons it was. Three numbers in
`/health` answered it in one deploy.

### Standing decisions, unattended
Deploy whenever gate 0 passes (the replay preflight refuses a bricking deploy with the old process
still serving). Bump `RULES_VERSION` + use the operator door only when past-tick computation really
changes — the graduation build proved it did **not** by diffing the per-tick hash stream, and bumping
for a non-divergence teaches operators to wave the door through. Cast cap stays $5; spend is ~$0.25/h.
**A subagent's report is not evidence** — verify by running it. **Refusing is an acceptable outcome**
and has twice been the right one.

### The habit that keeps paying
Five oversold guards caught tonight, most of them mine: a test reading `SPEEDS.rehearsal` instead of
the applied default; a seizure-ballot check redundant with the fail-closed path; an A12 reel guard held
by `render.ts` rather than my change. **Where a property is guarded twice, say so** rather than letting
a redundant guard look proven. Same family as the truncated witnesses — `head` on a grep, `tail -1` on
lint, `curl | grep` treating "could not look" as "all clear".

### Known-open, so they are not rediscovered
Five of the six entries that stood here were closed on 2026-07-26 and are **not** open: `nextDocket`,
checkpoint adoption, `checkInv7`'s cost, the repulsed-raid question (which was not a defect — a world
raid is physics), and `UNBUILT_PHASES` listing `MARKETS`. What actually remains:

- `StandingBook`'s journal is unbounded and captured every tick (INV-26 debt, deliberately uncapped),
  and `checkStandingJournal` replays **and sorts** it every tick. The resumable fix was attempted and
  reverted; its design and its double-counting trap are recorded above.
- Pooled goods are **not raidable** (D11) — deciding who defends a bodiless subject belongs with a
  later offices pass.
- No model-written seals, no Reckoning reflection, and cast characters have no relationships or wounds.

## 🏗 BUILD LOG (2026-07-24 →)

**2026-07-25 (later) — Persistence LANDED + Gate 3 run 2 + codex fixes + the A6 plan.**

Cleared the fable CRITICAL and most of the Gate-3 run-2 defect list; scoped the core loop.

- **Persistence wired end-to-end** (commit `2813273`). `src/persist/**`: JournalStore (Pg + in-memory), a live `Journal` (buffered ordered queue, never drops, honest `durableTick`), and `bootFromStore` — which does NOT adopt a snapshot (the ledger stateTable stores postings as counts and `restoreTo` refuses to grow an append-only table) but **replays the action log from genesis** and reproduces the exact `state_hash`, with journalled snapshots as divergence tripwires. `serve()` now boots-then-journals every tick. Proven by `test/durability/roundtrip.test.ts` (600-tick round-trip, mid-Reckoning kill, mutation proof). A5/A5′/A10 true at the substrate.
- **codex arithmetic review** (commit `3f125ec`): three `units.ts` defects fixed + guarded — zero-weight `splitByBps` remainder, `sumMinor` silent 2⁵³ drift (now fail-closed), `applyBpsTrunc` `-0`.
- **Gate 3 run 2 = NOT ENOUGH SIGNAL** (`GATE-3.md` §7, commit `0fb2767`). Plumbing sound (electives settle, standing real, A5′ held); zero real betrayals (the one default was accidental silence-by-omission); lands *below* §5's table — the promise came due and was honoured because there was no leverage moment yet. Roadmap = the run's ranked defect list.
- **Cheap Gate-3 fixes done** (some already in repo from a prior wave, verified + guarded): own-standing in `observe` (#7), signing-`@path` accepts the client-visible spelling (#1), `take_at_p50` as slot-price (#5), the scar-#1 filler-standing prompt (#3). Committed this cycle (`5dbb7d7`): agent.md signing truths (keyid=enrol's token, `/enroll` unsigned, content-digest only with a body), advisory services marked not-live (#6), and `my_elective_direction` (#4). **Standing accrual PROVEN** (`c650c33`): the cast honours 44 electives worth 48,157 across distinct counterparties in 3 Reckonings — the supply side AGT-E2 needs; the live all-zero was the persistence reset, not a broken loop.

> ### A6 (offices/grants) — the core loop: **MECHANISM BUILT** (2026-07-25, commits `21103ea`→`e014541`)
>
> The core loop is functional end-to-end and green (2167 tests). A principal grants scoped
> authority over its own stores (`grant`, worst case shown), a delegate acts on the grantor's
> behalf drawing on it (`create` with `on_behalf_of`, escrow from the grantor), the LIMITS are
> enforced (a gate before any value moves, INV-22 as the net at tick close), revocation is
> always accepted and effective next tick (`revoke`), and both sides see the grant in `observe`
> (granted[] with each delegate's spend, held[] with remaining headroom). Betrayal-via-legitimate-
> authority is now expressible with no `betray()` verb — a delegate can commit a grantor's capital
> to a venture an accomplice wins, every act inside the limits, the grant + accepted worst case on
> the record. Built: GrantBook (hashed, restorable, spend journal) · grant/revoke verbs · INV-22
> live · on-behalf enforcement · observe surfacing.
>
> **UPDATE — A6 is now COMPLETE** (commits through `36d2005`). Since the entry above: guardrail #3
> anti-self-dealing landed (`fill_role` refuses when the actor holds a live grant over the venture's
> creator, INV-23), and the **A13 pixel signature** landed (`AuthorityLine` in the reckoning frame —
> grantor→delegate, thickness ∝ authority, state UNUSED/DRAWN/EXHAUSTED/REVOKED showing drawn
> exposure; budgeted, sorted, deterministic). All six §8.1 guardrails hold and every mechanic
> renders. 2173 tests green.
>
> **UPDATE 2 — A6's headline promise was FALSE as built, and is now true** (2026-07-25, a fable
> architecture review). §8.1 #2 gives a grant two LIMITS and only ONE was ever charged. The
> delegated-`create` gate tested the venture's required ESCROW against DIRECT headroom and recorded
> the draw with `contingent: 0` — but every role carries an elective part and the top-yield kinds
> (`BUILD`, `SIEGE`) are legally un-escrowable, i.e. **100% elective**. So a grant written
> `max_direct_loss: 0` showed its owner a worst case of ZERO while its delegate opened
> un-escrowable ventures in the owner's name at zero headroom (`0 > 0` is false, so the gate
> passed), recorded nothing, and rendered `UNUSED` on the authority line. At the Reckoning the
> grantor — possibly never awake — either paid beyond every number it was shown or stayed silent,
> and **silence is a decline, which is a permanent public default** (A5). `max_contingent_liability`
> was carried, shown, VC-serialised and INV-22-checked, and *gated and accrued nowhere*.
>
> Fixed: `electiveTotal(venture)` (one home, in `venture/venture.ts`, derived from the terms the
> venture is actually created with) · gated against CONTINGENT headroom exactly as escrow is gated
> against direct, with a refusal naming the rule, the amount, the headroom and which limit ·
> accrued as `contingent` spend so headroom really falls and INV-22 recomputes consistently ·
> rendered (`AuthorityLine` gained `grantedContingent`/`spentContingent`, its state reads BOTH
> limits so the attack can no longer render `UNUSED`, and the frame now ranks lines on both so the
> largest exposure is not cut first) · `agent.md` §10 states the rule in the engine's words, with a
> live doc-vs-engine test. Two adjacent defects closed in the same pass: `recordSpend` moved inside
> the guarded path and before the value move (it can throw at `MAX_GRANT_SPENDS`, which used to
> abort the tick *after* the escrow had moved — a halted world for an act that should have been a
> refusal, now `INV-26`), and INV-22's own recomputation moved from bare `+=` to `addMinor` so the
> invariant's arithmetic is fail-closed past 2⁵³. 2195 tests green; 13 mutations proven.
>
> **Genuinely remaining (a fresh arc, not the mechanism):** the **redeploy** (a deliberate live op —
> scar #4 outage risk — that ships persistence + the signing-`@path` fix + the prompt fix + A6, and
> resets the current ephemeral heap world one last time so it persists thereafter); **Gate 3 run 3**
> (the run that can finally read *conduct*, needs the redeploy first, ~89 min); the client drawing
> the authority lines (last mile of A13); templated worst cases (convenience); a codex/fable review
> of the enforcement path; and the standing tech-debt (#10 the other F2 state tables, #11 the two
> observation impls). The signing model stands: HTTP agents may also produce the signed VC
> (`identity/vc.ts`) from the same claims for offline verification; the enforced row is authoritative.
>
> ── the original plan, for reference ──
> ### A6 (offices/grants) — the core loop: SCOPED, foundations done, build plan set
>
> **Restated to grant-scale (SPEC §8 recommendation, closing open question 8):** a principal grants scoped authority over ITS OWN stores; full offices need syndicates (Phase 1). Grants over one principal's stores are enough to test whether a betrayal lands and renders.
>
> **Already built + tested:** the `Grant`/`GrantSpend` types; the whole VC layer (`identity/vc.ts`, `test/identity/vc.test.ts` mutation-walks every field) with all credential-level guardrails — cycle rejection (#4), depth, ends-at-grantor, non-negative limits, prospective rotation, retired-key-can't-mint, revocation-next-tick (#6), expiry (#5); **INV-22** (spend ≤ LIMITS, recomputed from journal, concurrent-safe — the composite `max_direct_loss`/guardrail #2) and **INV-23** (cycle/depth), both registered and asserted (currently vacuous — no grants exist yet); `onBehalfOfPrincipalId` attribution threaded through events.
>
> **Signing-model DECISION:** the `Keyring` holds only PUBLIC keys and the house cast has no keypairs, so the runtime cannot mint VCs. The canonical path is the **HTTP agent building + signing the grant VC client-side** (`issueGrantCredential`) and submitting it to a `grant` verb that runs the already-built `verifyGrantCredential` and records an authoritative `Grant` row. This is the Gate-3-critical path (agent grants → delegate betrays) and needs no server-held private keys. (Cast-issued grants need deterministic per-member keypairs derived from the master seed — a follow-on that enables cast delegation texture; not required for the gate.)
>
> **Remaining build (the gap), in order:** (1) a `GrantBook` state table + a `grantsStateTable` descriptor added to `WindowedEngine`'s `tables: [...]` — mirror `electionsStateTable` (runtime.ts:3985) so grants are in `state_hash`, the abort-rollback, and persistence-replay (this also serves fable F2 / task #10). (2) the `grant` verb (verify submitted VC → record row → emit public `grant.issued`) and `revoke` (set `revokedAtTick`, emit public, effective next tick — `isRevokedAt`). (3) **the enforcement path** — a delegate's on-behalf action verified against a live grant row, verb permitted, spend computed (direct+contingent), enforced against LIMITS, `GrantSpend` recorded (makes INV-22/23 live), both actor+principal attributed. (4) guardrail #3 (a delegate may not sign a venture in which it or any principal on its delegation path holds a stake). (5) 5–8 named templates with server-computed worst cases. (6) observe affordances (`grant` showing `max_direct_loss`/`max_contingent_liability`/`public_if_used`) + a rendered pixel signature (A13). Build (3)/(4) with fresh focus — a wrong limit/self-dealing check is an A5′-class drain — then adversarially review with codex (limits/exploit) + fable (architecture).

**2026-07-25 — HETEROGENEOUS REVIEW (fable architecture + 3 codex arithmetic). The fable review found the build's biggest gap.**

> ### ⚠ CORRECTION — fable's Finding 1 was FALSE, and so was my verification of it
> The review reported that the permanent record is process memory: "nothing outside `db/migrate.ts`
> touches Postgres", so every restart resets the world. **This is wrong.** `src/persist/` — with
> `store.ts`, `journal.ts`, `memory.ts`, `postgres.ts` (7 INSERTs), `boot.ts`, `extract.ts` — landed in
> **`2813273` "Persistence: the permanent record gets a home outside the heap"**, an ancestor of HEAD.
> `serve()` calls `bootFromStore`; `test/durability/` and `test/persist/` exist and pass (26 tests).
> A5/A5′/A10 hold at the substrate. The review appears to have read `src/db/` and missed `src/persist/`.
>
> **My verification was the worse error.** I "confirmed" it with
> `grep -rn "INSERT INTO\|pg\|query(" src/ | grep -v migrate.ts | head` — and `grep -rn` walks
> directories alphabetically, so `api/limits.ts` filled all ten lines `head` allowed and the walk never
> reached `persist/`. I read "only limits.ts matched" as "nothing persists," escalated a non-existent
> defect to top priority above all other work, and rewrote this tracker around it.
>
> **The lesson is the one this project keeps relearning, now in a fifth costume:** a check that cannot
> see the evidence will report its absence. `head` on a verification grep is a truncated witness — the
> same defect class as the seal witness, the bare-term vocabulary detector, INV-24's `floorEligible`,
> and OPS-1. **A confirming check must be shown capable of failing.** When verifying a claim of the form
> "X does not exist anywhere," never pipe the search through `head`, and prefer `grep -rl` + a count over
> a line listing.
>
> It also stands as the counter-example to my own rule: *a subagent's report is not evidence* — and
> that cuts both ways. A confident architecture review from a different model is still a claim, and
> "verified" has to mean re-derived, not glanced at.

**HIGH (fable), all verified or credible:**
- **F2 — REAL, RE-VERIFIED PROPERLY (2026-07-25).** The hash + rollback set registers exactly **seven** tables: `ledger`, `venture`, `elections`, `levy`, `grants` (in `runtime.ts`) plus `world` and `intent` (in `tick/loop.ts`). A full-tree search finds **no seal, standing, obligation, or deliveries state table anywhere in `src/`** — so those four authoritative stores are OUTSIDE `state_hash` and the rollback set — the "money outside the hash" class with more members. An abort on a settlement tick (the heaviest tick, where the 600-obligation halt fired) leaves published receipts contradicting rolled-back state, and `settleNow` early-returns on resume so the money never re-applies. DET-1 is blind to seal/standing divergence. The comment at `runtime.ts:2843` claims re-run settles again — pinned-as-correct in prose, wrong in code (the freeze/settlement shape again).
- **F3 — "never publish a broken tick" is false for the product artifact.** Delivery + settlement events append to the ledger mid-tick (`isPublic:true` immediately), bypassing the COMMIT buffer, so an aborted tick's receipts cannot be retracted (INV-16). Fix: a `committed` fence flipped at COMMIT, feeds read through it.
- **F4 — two observation implementations**, and the SERVED one (`api/observe.ts`) is the weaker — no token-budget ladder, hence the ~20-32KB unbudgeted payload. Every Gate-3 conclusion is about the served surface, not the tested `src/observe/` one. Both files' own banners say one must go. Consolidate onto `src/observe/`, golden-file the payload across the migration.
- **F5 — the wake budget (A4's cognition meter) is a per-process closure map**, outside the hash, and the heuristic cast pays nothing (reads `runtime.*` directly). The moment the API scales out, A4 multiplies. Emergence is measured against a house cast that sees 18× more state for free.

**MEDIUM:** F6 halt/resume has no production door (`resumeKeys: new Map()`, no operator key read) so PAUSED in prod means "reset on restart"; F7 `acted_on_state_version` is a whole-window applied-actions counter, not "the state the parties acted on" — the §15.4 defence has collapsed to VERIFY_INPUTS plus two narrow checks, and the column name will mislead every future consumer; F8 `setSpeed('fast')` hardcoded in `serve()` so prod runs at 30× — the one regime the docs say A4 cannot be measured at.

**codex A6 review (grant accounting), 2026-07-25 — two REAL defects, both verified by reading the code:**

- **★ The anti-self-dealing guard has a one-tick bypass, and it is the core loop's guard.** `vFillRole`
  denies a delegate filling a role in its grantor's venture only while the grant is live *at the fill
  tick* (`liveGrantBetween(venture.creator, req.principal, ctx.tick)`, `runtime.ts:2118`). So: hold a
  grant, create a venture on the grantor's behalf funded from the grantor's own stores, wait for the
  grant to expire (or revoke it yourself), then fill a paid role in that venture one tick later. The
  guard does not run. The comment directly above it names "create on the grantor's behalf, then pay
  yourself" as *the trivial betrayal it exists to block* — and it is blockable by waiting one tick.
  The fix is to test authority **at the venture's creation tick**, not the current tick. Same bypass via
  `vRevoke` at R then fill at R+1. INV-23's counterparty check cannot catch it either: the runtime
  passes no `deals` journal (`runtime.ts:1354`), so `aggregate.ts:374` marks it **skipped**.
- **`grantCounter` / `ventureCounter` are outside the state tables** (`runtime.ts:1044`, `:1057`) but they
  feed ID minting via `canonicalHash({tick, principal, ordinal})`. A restore mid-stream followed by a
  replayed grant/create mints *different IDs*, so exact replay diverges — the F2 class, in the ID space.
- Lesser, both real but unreachable through the verbs today: `recordSpend` mutates the row then throws
  before appending its journal line (`book.ts:123`), so the "row totals always equal the journal" claim
  is not unconditional; and INV-22 recomputes with bare `+=` rather than `addMinor` (`authority.ts:114`),
  so the invariant's own arithmetic is not overflow-safe. Also noted: headroom is enforced **per grant**,
  not per grantor, so two overlapping grants each capped at L authorise 2L aggregate — which matters
  because `max_direct_loss` is what an owner is shown before signing.

**Real next work, in order** (superseding the panic ordering the false F1 caused): **(1)** the A6
self-dealing bypass — it is a hole in the core loop's only guardrail; **(2)** register seal / standing /
obligation / deliveries + the two ID counters as state tables, closing F2 and the replay divergence
together; **(3)** the observe consolidation (F4) — every Gate 3 conclusion is about the *served* surface,
which is the one without the token-budget ladder.

**LIVE-WORLD OBSERVATION (2026-07-25, from the deployed box) — the house cast has no inference.**
`/compact/health` reports `unhealthy` in steady state, and it is **right to**: of 618 decisions in the
window, **618 were `HEURISTIC` and 0 were `LIVE`/`INTENT`/`DELEGATE`** (`deciding_share_bps: 0` against
`floor_bps: 2500`). The anti-scar-#14 check is working exactly as designed — it refuses to call a
bots-only world healthy. But the cause is a **missing build stage, not a bug**: `src/cast/` contains
only `heuristic.ts`. There is no LLM-driven cast, so `LIVE` can only ever come from an external agent
calling the API. SPEC §15 says *"you cannot cast a show you do not fund: a house cast of 12–20 named
principals runs on our keys"* — as built, the house cast is 12 heuristic bots and the world is
**permanently unhealthy by its own definition** whenever probes are not running.

This is the **watchability gap**, and it is the thing standing between "the engine runs" and "the show
is worth watching": heuristics produce motion, not drama. A6's whole claim — betrayal through
legitimate authority, months of honest work then abuse at maximum leverage — is not a behaviour a
heuristic bot can exhibit. **The house cast is now a named Phase 0 stage.** Two live-world numbers also
checked and found FINE, recorded so they are not re-investigated: `pendingCorrections` climbing
(95→100 over 3 ticks) is a bounded per-principal `Ring(MAX_PENDING_CORRECTIONS)` filling because those
9 principals never observe — correct for a bots-only world, not a leak; and the client + `agent.md`
both serve 200.

**DEPLOYED 2026-07-25 — the A6 core-loop fixes and the boot hardening are LIVE, and the new preflight
proved itself on its first real use.**

```
replay preflight — would this build still reproduce the record?
replay-check: OK. 856 ticks replayed to head 855, 2 snapshot tripwires matched,
              rules_version unrecorded -> 1. This build reproduces the record.
  ✓ this build reproduces the record — a restart will resume the world
```

The A6 contingent gate *is* a semantics change, so this was exactly the deploy fable warned would brick
the world. It did not, and we knew that **before** the restart rather than after: the preflight replays
the live journal against the new build with the OLD process still serving, and only then does the
deploy proceed. The world **resumed at tick 856** rather than resetting, and durability is advancing
(`durableTick == headTick == 858, backlog 0`). `rollback_gaps: []`.

Live now: the anti-self-dealing creation-tick fix, contingent-liability gating and accrual, the A13
contingent render, hold-don't-crash-loop boot, the bounded replay pager, the operator divergence door,
and the tripwire table locked against the app role.

Health still reports `unhealthy` for one reason only — `deciding_share_bps: 0`, no live cast. The deploy
script now classifies that correctly as a **run-time alert, not a deploy failure**. It is the last big
gap: **the house cast**.

**House cast — unblocked on 2026-07-25.** The old `OPENAI_API_KEY` authenticated for `/v1/models` but
returned `exceeded your current quota` on every completion. A working key replaced it in the yc stack
(pushed to the private remote) and installed on the box at `/etc/compact/env` (mode 600), alongside
`COMPACT_CAST_MODEL=gpt-5.6-luna` and **`COMPACT_CAST_LLM=false`** so nothing spends until the cast is
wired and deliberately switched on. Luna is the cheapest GPT-5.6 tier ($1/$6 per 1M tokens vs Terra
$2.50/$15, Sol $5/$30). Budget estimate to respect: ~12 members x 16 wakes x ~8k-token observations is
~$1.5–2 per Reckoning, ~$2/hour at `fast`, so the cast ships with hard caps that disable the LLM path
and fall back to heuristics rather than overspend.

**2026-07-25 — THE OPERATOR DOOR WAS USED FOR REAL, AND THE WHOLE SAFETY STORY HELD.**

The keystone fix (EncumbranceBook into the hashed capture) changes `state_hash` for every tick,
including ticks already journalled. That is the deploy fable warned would brick the world, and it went
exactly as the machinery was built to make it go:

1. **The preflight refused the deploy** — `STATE_HASH_MISMATCH at tick 287` — naming the tick, both
   hashes, and the remedy, **with the old process still serving the live world.** Nothing restarted.
2. It also reported `rules_version journal 1 -> running 1`: a divergence with the generation *unmoved*,
   which reads as "the arithmetic changed and nobody declared it". So **`RULES_VERSION` moved to 2**,
   and the constant now states the rule — bump when a PAST tick would compute differently.
3. **The door was opened deliberately** at the exact named tick
   (`COMPACT_ACCEPT_DIVERGENCE_AT_TICK=287`); a different tick would have been refused, because an
   operator who names another tick is accepting something they were not shown.
4. **The discontinuity is now in the permanent record**, not in a changelog:
   `287 | STATE_HASH_MISMATCH | 1 -> 2 | 4 tolerated`. The record says the ticks before and after 287
   were computed by different code, and no past row was rewritten (INSERT-only, and the app role holds
   no UPDATE/DELETE on that table).
5. The world resumed at **tick 1684**, durable, `rollback_gaps: []`.

**This closes the loop opened by the first fable review.** A5 does not say the record must never
change; it says the record must never be *wrong*. An annotated, publicly declared generation boundary
is honest. A silent one — which is what shipping this without the door would have been — is the lie
A5 forbids.

Also fixed this session, all mutation-proven: the **SEALED leak** (`sealContent` was in the nightly
frame and the client printed it; safe only because the runtime happened to pass `null`), the
**director cutting its own climax** (`sort(defaults last).slice(0, 12)` selected the FIRST twelve of an
order built to put the payoff LAST, so busy nights dropped the betrayals), and the **A15 pricing hole**
(the handle decided who captured the spread on a same-tick cross).

**A method note worth keeping:** Gate 0 caught five lint errors — including a DET-1 bare `.sort()` in a
test I wrote and two real narrowing bugs in the new encumbrance restore — that my own check had missed,
because I was piping `eslint` through `tail -1`. That is the **third** truncated-witness mistake in one
session (`head` on the persistence grep, `tail -1` on lint twice). *A check that cannot show a failure
is not a check.*

**★ THE KEYSTONE DEFECT — the `EncumbranceBook` is in no state table (2026-07-25, VERIFIED BY EXPERIMENT).**
`ledgerStateTable.capture()` returns exactly `accounts, lots, postingCount, batchCount`. **No
encumbrances.** I ran the capture and grepped the blob: no lock, lien or encumbrance row is in it. Yet
`src/ledger/stateTable.ts`'s own header says *"Accounts, lots and encumbrances are mutable and are
carried in full."* **The comment asserts a property the code does not have** — scar #1's shape at the
state-table layer, in the file written to fix the last "money outside the hash" bug.

**Three independent reviewers found this, and none of them was me:** codex's ledger review (its finding
#3: "capture at balance 1,000, create a 600 lock, restore — the capture is unchanged by the lock;
restore leaves it open, free balance 400, exposure 600, and its ID counter advanced"), the boot-upgrade
builder (which hit it as the blocker for checkpoint adoption and said so honestly in its module header
rather than shipping a plausible hydrate), and then my own experiment confirming it.

**Four consequences, and the last one is why this is the keystone:**
1. **Abort/rollback is incomplete.** A tick that opens a lock and then aborts leaves the lock open —
   free balance reduced, exposure inflated, ID counter advanced. Escrow exists that the world says
   does not.
2. **`state_hash` is blind to encumbrances.** Two worlds with different open locks hash identically, so
   DET-1 cannot see a divergence in escrow. This is the *exact* bug `ledgerStateTable` was created to
   fix ("a hash that cannot see the money is not a hash of the world"), one layer down.
3. **A5′ risk:** a world adopted from a snapshot would have escrowed stake silently spendable.
4. **It blocks checkpoint adoption** — and therefore blocks the fix for the boot crash-loop AND the
   O(history) restart. The boot builder correctly refused to adopt snapshots because of it and fell back
   to full genesis replay (measured ~1.8 ms/tick, so ~7 min at 242k ticks — better than fable's 20min–2h
   estimate, but still a hard-down restart that grows forever).

**So registering the `EncumbranceBook` as a state table is now the highest-value single fix in the
build:** it closes an A5′ hole, restores rollback correctness, puts escrow inside the hash, and unblocks
checkpointing. It is the same fix shape as `ledgerStateTable`/`grantsStateTable`, which already exist as
the pattern to copy.

**Also settled (good news for the house cast):** boot **seats** the house cast deterministically from
the seed and then replays the *action log* — it does **not** re-invoke the cast to make decisions. So an
LLM-driven cast is **replay-safe by construction**: its decisions enter the record as logged actions and
replay from the log, and non-deterministic reasoning never re-runs. That removes the main architectural
objection to the house cast.

**Second fable review (persistence + A6), 2026-07-25.** This one reads `src/persist/` correctly and
analyses it in depth — independent confirmation that the first review's F1 was wrong. Findings, ranked:

- **★ CORE LOOP — A6's central promise is false as built (fable #3).** The delegated-`create` gate checks
  **escrow only** against `max_direct_loss` (`runtime.ts:1979-2003`), and records spend with
  `contingent: minor(0)` — the *only* `recordSpend` call site in the tree (`:2042-2051`). But every role
  carries an elective part by `defaultTerms` (`:915-934`), and the top-yield kinds are **not escrowable at
  all** (`kinds.ts:230`), i.e. 100% elective. So: G issues D a grant with `max_direct_loss: 0` — worst case
  shown to the owner is *zero* — and D creates un-escrowable top-yield ventures on G's behalf. Required
  escrow is 0, so `0 > 0` passes at zero headroom, no spend is recorded, INV-22 sees nothing. At the
  Reckoning G faces elective obligations its delegate created in its name: pay beyond every number it was
  shown, or stay silent — and **silence is a decline, which is a permanent public default.** `max_contingent_liability`
  is carried, shown, VC-serialised and INV-22-checked, but **no code path ever accrues or gates it**. Two
  aggravators: the A13 authority line renders drawn exposure, which is 0 here, so the whole thing renders
  as `UNUSED`; and §8.1 #5 (limits decay with principal silence) is unimplemented, so the offline-grantor
  window is the full grant lifetime. **"All six §8.1 guardrails hold" was overstated — #2 and #5 do not.**
- **CRITICAL (fable #1) — replay-from-genesis makes any semantics-changing deploy a boot brick.** Boot
  re-executes the whole action log under current code (`boot.ts:121-183`); there is no `rules_version`
  dispatch, no snapshot adoption (blocked by `Ledger.restoreTo` refusing to grow append-only counts), no
  migration, no operator override. The first deploy that changes any past tick's arithmetic → either an
  `APPLIED` action is now refused (`boot.ts:152`) or the hash tripwire fires (`:174`) → `BootError` →
  `Restart=always` → infinite crash loop with no HTTP surface, re-reading the entire journal each time.
  Compounding: the Pg store deliberately does not persist postings, so re-execution is the *only* durable
  representation of value history. Asymmetric hole: `REFUSED`→now-accepted is not caught at the action,
  only at the next snapshot. Fix: land ledger hydrate-from-journal so boot adopts the last checkpoint and
  replays only the tail; until then ship a deliberate operator door recorded as a public event.
- **HIGH (fable #2) — O(entire history) boot with the world hard-down.** `ticksSince(-1)` materialises every
  tick and action into memory. At `fast` (10s) a 28-day season ≈ 242k ticks → **20 min to 2+ h of downtime
  per restart**, growing monotonically across seasons since A10 forbids resets. Same root as #1; schedule together.
- **HIGH (fable #4) — published-before-durable.** A committed tick is observable while its journal write is
  still queued; the stated policy keeps the world running *and accepting external actions* through a DB
  outage. A kill then replays those ticks **without the external actions that died in the queue** — worst
  case an `elect IN_FULL` lost from a settlement tick becomes silence → `DECLINED` → **a fabricated public
  default (§15.4) arriving through the persistence layer.** Enrollment has the same shape (201 before durable).
  Fix: journal submitted actions at accept-time (the input artifact should not inherit the output's loss
  window), or refuse/mark-tentative while backlog > 0.
- **MEDIUM (fable #5) — no SIGTERM handler anywhere in `src/`**, so every `systemctl restart` (every deploy)
  is a hard kill and #4's window is not outage-only but routine. Also `drain()` spins on
  `await Promise.resolve()` — microtask starvation, the pg IO completion never runs, hangs until SIGKILL.
- **MEDIUM (fable #8) — agent-reachable permanent world halt.** `MAX_GRANT_SPENDS = 16_384` is *lifetime* and
  never pruned; `recordSpend` throws **after** value moved and outside the guarded block, so the 16,384th
  delegated spend aborts the tick → PAUSED → and replay rebuilds the same journal, so the wall stands after
  restart: every delegated create with escrow > 0 pauses the world, forever. Grinding is free (A15). Also
  `MAX_GRANTS`' refusal text says "wait for outstanding ones to lapse" — but expiry/revocation never remove
  rows and there is no prune path: **a refusal string teaching a rule the engine does not have, scar #1's
  exact shape**, in the subsystem built most carefully against it.
- **MEDIUM (fable #7) — F2 re-assessed DOWN.** The buffer discard + PAUSED-until-restart + genesis replay means
  dirty non-table state never feeds a committed tick, and `adversarial-verify.test.ts` proves replay
  reproduces all four unhashed stores byte-for-byte. Residual is a *verification* gap: production divergence
  in standing/seals/defaults is undetectable because the hash certifies seven tables and the reputation
  record is not among them; plus a bounded A9/A5′ leak from stale observes between abort and restart.
- **MEDIUM (fable #6) — the code's real recovery model (restart + full replay) has silently replaced SPEC
  §15.2's (sandbox replay + signed resume).** Either finish the door or amend the spec; a half-door pinned as
  the recovery story is how the freeze/settlement bug shipped.
- **LOW, each verified:** `setSpeed('fast')` still hardcoded in `serve()` (F8); the two observation
  implementations each grew `grants` this cycle, so **every A6 feature now lands twice** and F4 gets more
  expensive per subsystem shipped; INV-23's counterparty clause vacuous (no `deals` supplied); the VC layer
  is disconnected from enforcement (nothing calls `verifyGrantCredential`, no claims-hash binds row↔credential);
  `on_behalf_of` carries two meanings on one event column (§3 vocabulary shape on the wire); `action_log`
  omits submit-time refusals so §15.1's completeness claim is short; the wake book's persistence consumer
  named in a comment was never built (OPS-1 self-witnessing in miniature) so restarts refund spent wakes.
- **Found sound:** the journal's strict-FIFO ordering (which makes the enrollment/tick coherence proof work),
  `durableTick` advancing only on success, the tripwire posture, and the GrantBook as a state table —
  "the best-integrated state table in the codebase", the pattern the four unhashed books should copy.

**Fable's suggested order:** #1+#2 together (checkpoint adoption via ledger hydration — one root), then #3
(contingent gating — small, core-loop-critical, before any Gate 3 re-run), then #4+#5, then #8's prune.

**Fable's verdict:** the in-process architecture is genuinely sound — the deterministic core, the tick transaction, the settlement arithmetic, the A5′ discipline are beyond the project's stage. But *as deployed* it is "a simulation of the game it claims to be." **STOP adding mechanics until F1 → F2 → F4 land; all three are wiring over machinery that already exists.**

**Consequence for the "stages left" answer:** persistence was thought done (schema + migrate built) and is not — it jumps to the FRONT, ahead of predation and the grant-betrayal loop. TESTING.md needs a sixth tier: **durability** — kill the process mid-season, restart, assert the world + record + every identity survive byte-for-byte. Written before the persistence work, the way golden files predate their bugs.



**2026-07-25 (later) — Gate 3 fixes + the Levy, verified and deployed.** 2109 tests. The game is playable and the fixes are live.

- **Deal-closing gap closed** (Gate 3's headline). A filler reads ONE observation, fills and signs from the board row inside the 12-tick window. **Action refusal rate 78% → 0%** on the merged tree — one missing `terms_hash` field had been strangling the whole venture loop, exactly as Gate 3 diagnosed.
- **The Levy shipped** and is **visible over HTTP** — it had been tested-but-dead (`observe` returned `obligations.levy: null`), the same shape as standing being a constant. Assessment, the constellation vote, the non-escrowable share (Coase-collapse-proof), the newcomer floor, tribute lines, INV-24/25.
- **Standing is real** — was a hardcoded zero in `observe`; this is what made `AGT-E2` unanswerable.
- **A4 quote-harvest hole closed** — `nearestFresh` checked for a wake but never spent one, so an agent could harvest priced affordances unmetered through the correction channel. A fresh set now costs a wake, solved once per response.

> **The recurring bug class struck a THIRD time and was caught.** INV-24's newcomer-floor guard built its `floorEligible` set from the very `newcomerFloored` flag it was meant to check — a completeness witness derived from what it witnesses, exactly like the seal witness (wave 2/3) and the bare-term vocabulary detector (wave 1). Mutation-proven worthless: reverting left all 104 levy tests green. Fixed by carrying the raw tenure/capital on each line (INV-17's "attribution is a column" principle) and re-deriving eligibility from the rule. **This pattern is now the single most repeated defect in the project — worth a standing check for it in any new guard.**

- **Deploy hardened through eight real failures**, six mine, two that *looked like success*: an unanchored `--exclude` silently dropped `src/cast/`, and `agent.md` was served as HTML with a 200. Also fixed: the deploy's own health gate conflated "did the deploy work" with "is a live run in progress" — it failed on the scar #14b floor (correct behaviour, no live cast) — now split into a structural gate (world RUNNING, no rollback gaps) and a run-time warning.
- **Verifiers on Opus** for this wave (per the model-tier policy: judgment is the measurement where a shallow pass misses A5′ bugs). They found the INV-24 tautology, the A4 harvest, and the Levy-invisible-over-HTTP — none of which the green suite caught.

**Live:** `agentinsurance.io/compact/` — tick 1001, 3 Reckonings, 411 ventures, `rollback_gaps` empty, deterministic.

**Open P2s (real, not blocking):** observation payload ~19.5KB and structurally unbudgeted (recommended fix: collapse onto `src/observe/`) · the Levy ballot's rule-half is sock-puppetable (A15, spare-half is covered) · `health` counts INTENT as deciding (scar #14b through a narrower door) · `message` has no party check (a PARTIES-tier write leak) · `LEVY` is a member of two named unions.

**Next:** re-run the season soak (expect the 78% refusal collapse to hold at scale) and **re-run Gate 3 on Opus** — the deal-closing fix and visible standing mean it should finally read 0/n instead of 0/0, and `AGT-E2` becomes answerable.

**2026-07-25 — LIVE, and through Gate 3.** The game is deployed at `https://agentinsurance.io/compact/` and settling Reckonings on its own. ~1880 tests. Milestones since the wave logs below:

- **Deployed.** Eight failures to get there, six mine; two *looked like success* — an unanchored rsync `--exclude` silently omitted `src/cast/` (scar #4's shape with a different verb), and `agent.md` was served as HTML with a 200 via nginx's SPA fallback. The deploy now anchors every pattern, asserts all 16 source dirs arrived, and verifies `agent.md` is markdown. `compact-sim.service` was **deleted** rather than written: the API already owns the scheduler, so a second unit would have been a second writer (OPS-5).
- **`elect` landed** (verb 39/40): the payer's choice is restatable until the freeze, so A6's "abuse at the moment of maximum leverage" is finally expressible. Before it, the choice was locked at signing and §7.6 could not be asked.
- **The seal trap closed**, the seal-cost promise in `agent.md` made true (the allowance stays in the seals book; the budget asks), and money brought inside `state_hash` via a ledger state table — it had been outside the hash I was claiming determinism about.

> **SEASON SOAK — the thorough test. 30 principals, 8,100 ticks, 28 Reckonings, all committed.** 298 settlements · 22 defaulted · 33 defaults · 640 seals judged · **0 unattributed value · 0 deed-set faults.** A5′ holds at season scale, which is the strongest evidence yet for the thing the project says matters most. 36 ms/tick with per-tick hash streaming and the heuristic cast in the loop. *Caveat: 78% of actions were refused (101k vs 28k applied) — consistent with Gate 3's deal-closing gap, and expected to drop once the fixes land; re-run the soak after.*

> **GATE 3 — RUN AND READ (`GATE-3.md` §6).** Four probes, live server, `agent.md` + public API only. The measure is **0/0, not 0/n**: nothing settled, so §7.6 is *untested*. Cause is arithmetic — a filler needed a second wake to read the `terms_hash` before signing, inside a 12-tick window on one wake per 18, so **a filler playing inside the documented budget could not close a deal.** But four things held at high confidence: the design is **learnable** (three probes named the core idea unprompted), the consequence-preview pattern **works**, permanence **deters**, and after 668 probe actions including deliberate abuse **no false default was recorded** (A5′). The trust-market demand side is real — agents down-sized ventures to farm distinct counterparties — while the supply side was a **hardcoded zero** in `observe`. A three-day fix list, not a rewrite, which is what placing the gate at step 7 of 15 was meant to buy.

**In flight:** the **Levy** (the spec's "single most important mechanic in v3.0"; without it the Reckoning is abstention-trivial) · the **three Gate-3 fix areas** (`observe` deal-closing + standing + the false-state strings · `runtime` accepted-means-queued + the elect-readback A5′ lag · `identity` the `@path` RFC violation that broke every conformant client). Each with an Opus verifier.

**Gate 0 — GREEN.** Everything TESTING.md requires in commit #1 landed there, because four of its artifacts are golden-file surfaces that only work if they predate the bugs.
- `core/units.ts` integer-only value paths; `splitByBps` allocates every minor unit and asserts `sum(parts) === whole`, so **INV-6 holds by construction** rather than by review.
- `core/rng.ts` the only randomness. Rejection-sampled so small bounds stay exactly uniform — a modulo shortcut would bias every hazard roll slightly, which is the class of bug nobody ever finds. `derive()` gives independent sub-streams so adding a draw in one tick phase cannot shift another's outcomes.
- `core/canonical.ts` sorted keys, integers only, floats throw. Deliberately **not** `JSON.stringify`: V8 reorders integer-like string keys numerically, which is the numeric-key determinism killer and stays invisible until a principal id happens to be numeric.
- `core/time.ts` five named speeds, one sanctioned wall-clock reader, whitelisted by path.
- **DET-7** banned-construct lint · **DET-8** scale audit · **PROP-O3** budget audit reading `SPEC.md` as source of truth and cross-checking the engine's enums against it (**15/15 axioms · 38/40 verbs · 10/10 observe keys · 8/8 venture kinds**). The cross-check is the point: spec and engine disagreeing about vocabulary *is* scar #1.

**Server — live and clean.** Verified: High Water entirely gone, **24 cores** (docs said 12), landing page 200. Postgres 16.14 installed; database `compact` created with **`LC_COLLATE=C` at the database level**, which makes the collation determinism killer impossible rather than something every `ORDER BY` must remember. WAL archiving on.

**OPS-1 — PASSING, and it earned its keep on the first run.** `deploy/verify-restore.sh`: base backup → `pg_verifybackup` → restore into a throwaway cluster → assert a canary row and row counts survived → assert collation survived. It found two real defects in the naive restore procedure, both of which would otherwise have surfaced during an incident:
1. On Ubuntu the cluster config lives **outside** the data dir, so `pg_basebackup` alone does not produce a startable cluster.
2. The packaged `postgresql.conf` **hard-codes `data_directory` at the live cluster**, so a naive restore silently attaches to production.

**Schema (migration 001).** Every non-retrofittable field from §15.1 as a column; deliberately **no balance columns on `event`** (that duplicates `posting` — scar #5 inside the field list meant to prevent scar #5). Two things beyond table creation: **append-only enforced by GRANTS** (the app role has INSERT+SELECT and no UPDATE/DELETE on history, partitions revoked explicitly since they inherit at creation), and **partitions pre-created 7 Reckonings ahead with a fatal boot assertion** (OPS-3) — fatal because a warning about partitions is one nobody reads until the ledger stops accepting writes.

**Deploy — scar #4 encoded as code, not advice.** Every sibling an explicit `--exclude`; the client sync omits `--delete` entirely because it writes inside the live landing page's webroot; Gate 0 gates the deploy; nginx wired via a one-line include of a separate snippet rather than rewriting the vhost that carries the live page and the certbot TLS block; and **post-deploy verification checks what we did *not* deploy** — landing page 200, health ok, and everything running before still running. That last check is the one whose absence let scar #4 stay invisible for days.

**Frame contract + client.** `assertFrameBudgets()` makes A13 executable (≤7 cards, ≤12 segments, ≤7 labels, ascending stakes, no seal content without a verdict, no reel on a kept promise). The client is static single-file with **no database handle and no live-sim connection**, so A9 parity is structural — and since agents read the public feed, any viewer privilege would immediately be an agent exploit.

**Wave 1 — DONE.** identity (Ed25519 + RFC 9421 + VC grants) · ledger · events + the A9 parity fuzz · world/hands/movement · golden files. ~11.2k lines src, ~11.5k test. Five builders, five adversarial verifiers.

> **Every builder overstated its report.** All five verifiers returned `reportAccurate=false`, and four found a P0/P1 the builder had called done. That is the single most useful datum from the wave: **a subagent's self-report is not evidence**, and the verify stage is not optional overhead.

Verifier catches worth remembering:
- **Ledger P0 — an engine-fabricated halt.** `retireCurrency` ignored encumbrances while `transferCurrency` respected them. Upkeep and fees are the primary currency sinks and are charged *by the world*, so `fund 1000 → lock 800 → retire 1000` left `locked 800 > balance 0`, and INV-3 then halted the tick. The engine creating the state that halts it is the A5′ failure mode.
- **Ledger P1 — nine literal NUL bytes** used as a composite-key separator. `file(1)` reported the files as `data`, so **grep and ripgrep silently skipped them** while tsc, eslint and vitest stayed green. Every grep-based guard in the repo, including SEC-9's outbound secret scan, had an unreportable hole.
- **Events P1 —** PROP-D2, the module's one absolute prohibition, escaped through an unchecked caller-supplied `flagKeys` allow-list: seal content could reach an agent-readable channel, which is perfect cartel monitoring.
- **World P1 —** `classifyAction` indexed an object literal directly, so the eight `Object.prototype` keys returned a function instead of a disposition.

**Four P1s the verifiers found and left; all fixed.** Three were scar #1 exactly — `HoldingState.STANDING`, `Protection.EXPOSED` (§3's Never-means for EXPOSURE reads literally "peril scope"), and `GrantMandate` (§3's Never-means for MANDATE reads "a grant"). The fourth: **a rotated-out key could still mint new grants**, because `bindIssuer` judged liveness at `validFromTick` — a field the signer chooses and signs — so rotating away a leaked key contained nothing.

**Two collisions were in the canon, not the engine.** `SPEC` §15.1 itself specified `decision_source ∈ {LIVE, STANDING, …}`; renamed to `INTENT` (A3's own word) across spec, schema and engine. And §3's SEAL row forbade "a visibility level" while §3's own ladder included `SEALED` — the canon contradicted itself; the tier holds seals, so it is one concept and the clause was wrong.

> **The sharpest lesson of the build so far.** The repo-wide vocabulary detector I wrote to catch those three collisions **did not work**. Keyed on bare canon *terms*, it passed a mutation that reintroduced `HoldingState = 'STANDING'` — a collision named in that very file's header — because `STANDING` was globally allowlisted for the legitimate `Standing` type. The detector was reproducing the bug it hunts, and it read as a clean bill of health. A canon term is never sanctioned in the abstract, only in one context, so the allowlist is keyed on **(union, member) pairs**. Now re-tested against a known *and* a novel collision, and the mutation is a permanent test rather than something run once by hand. **Corollary adopted as practice: mutation-test every guard, or it is decoration.**

**`agent.md` + its guard.** Written *before* the API on purpose — written after, it would describe whatever the code happens to do, which is how scar #1 got in. `test/rules-surface/agent-md.test.ts` parses both canon and doc and asserts they agree on verbs, the ten observe keys and their order, A7's semantics, the seal disclosure rule, the visibility split, and that throughput buys nothing. Mutation-tested three ways including an **inverted A7 table**, which is scar #1's shape with money attached. That caught it only by an `execute`/`executes` accident, so both rows are now pinned verbatim.

**Live.** `https://agentinsurance.io/compact/` serves the spectator client; landing page and whitepaper verified still 200 after the deploy (the scar #4 check). With no settled frame the client says so plainly and structurally cannot invent one.

**Wave 2 — DONE.** tick loop (DET-2, the A4 test, running before any content exists) · ventures + settlement waterfall · unified invariant surface + halt/PAUSED · seals. **1354 tests.** Then a dedicated fix wave for the P0s.

> **Nine of nine builders have overstated their own report.** Every verifier across both waves returned `reportAccurate=false`. This is now a settled fact about the method, not an observation: **a subagent's self-report is a claim, not evidence, and the verify stage is load-bearing.** One *fix* pass also failed to fix its own headline finding, which is why re-verification exists too.

**Six shipped bugs of one shape: the engine fabricating a false record or halting on its own state** — precisely §15.4's "worse than a crash". Worth listing because the pattern is the lesson:
- `retireCurrency` ignored encumbrances while `transferCurrency` honoured them, so a world-charged fee left `locked > balance` and the invariant halted the tick.
- **INV-17 — the check its own module calls the highest-severity in the codebase — could not see the only default event the engine emits.** The kind is `venture.default`; the recogniser matched `SCREAMING_SNAKE`. The guard against libelling an agent was inert.
- **INV-23 invented cycle accusations against innocent principals.** A depth-cap `break` left DFS nodes GREY, so a legal linear chain produced three fabricated "transitively its own delegate" violations.
- **A deferred venture's second settlement re-paid the elective part from zero** — double-charging the payer *and* recording a fabricated default. One root cause (a fresh `Working` per call) also made the re-settlement receipt publish `escrowedPaid: 0` against `escrowedDue: 100`, **denying A7's central claim on the public record.**
- **A payer electing the exact `your_take_at_p50` it was quoted was recorded as having DECLINED** when the venture over-performed — a share's real due is unknown until resolution, so the quoted figure is an estimate, not the bill.
- Two independent **agent-triggerable world halts** in seals (AGT-X9 denial-of-settlement).

**The step budget had no term for the obligation set.** 600 obligations that *all settled cleanly* halted the world, on the Reckoning — the one tick with an audience (A14) — with a message blaming a convergence loop that never happened. Now sized from a single read of `due()` that OBLIGE reuses, because sizing from one call and processing another lets the budget be for work that isn't the work being done.

> ### The method lesson: mutation-test every guard, or it is decoration
> This has now caught **four** worthless guards, three of them mine:
> - the repo-wide vocabulary detector, keyed on bare terms, passed a mutation reintroducing a collision named in its own header;
> - the `agent.md` A7 check caught an inverted table only by an `execute`/`executes` accident;
> - the election guard passed on an incidental substring after the defining row was deleted — **presence is not semantics**;
> - a seal completeness witness derived its count from the array it was meant to witness, making the check a tautology.
>
> A guard that has not been mutated is an unverified claim. Assertions over review applies to the assertions too.

**Four vocabulary collisions across the waves**, all scar #1: `HoldingState.STANDING`, `Protection.EXPOSED`, `GrantMandate`, and `SealDisposition.DEFERRED` — the last meaning the *opposite* of `VentureState.DEFERRED` (terminal vs explicitly not terminal). **Two were in the canon itself**: §15.1's `decision_source ∈ {…STANDING…}`, and §3's SEAL row forbidding "a visibility level" while §3's own ladder contained `SEALED`. The detector now checks engine-vs-engine collisions too, since scar #1 was never about canon terms — it was two surfaces disagreeing about one word.

**One thing I got wrong and reverted.** I moved the causal edge into `parent_event_id` on §15.1's authority. INV-12 refused it — "a cause must precede its effect" — and was right: `EventLedger.append` mints its own ids, so the caller-supplied handle can never be one. Only the batch appender knows the minted id, so the debt is the Reckoning driver's and is pinned by three assertions including one on the premise it rests on.

**Wave 3 — DONE, and the game runs end to end.** Reckoning driver · observe + affordances + free services · HTTP surface + heuristic cast + sim CLI. **1828 tests.** Then the Reckoning was wired into the sim, which is what turned a tick loop into a game:

```
1200 ticks · 4 Reckonings, all committed
settlements 61 · standing moves 118 · proceeds 569,338 · unattributed 0
deterministic across runs
```

Two P0s in wave 3, both fixed: **an identity takeover of a house-cast principal via the documented first request** (`/enroll` committed the seat and the key before checking the world already had that principal, and ids derive from handles), and a "fix" that changed a function's arity and left its only production caller broken while reporting `typecheckPasses: true`.

### The two worst bugs of the whole build were mine

**1. The freeze collided with settlement** (`core/time.ts`, Gate 0). §5.1 puts the freeze at "the last tick *before* settlement"; I made both predicates true at phase 287. So "between freeze and settlement" named an **empty interval**, INV-18 was vacuous in the wired engine, and §15.4's defence-in-depth against a fabricated default was unenforceable anywhere. The commitment window was also 23 ticks against a constant declaring 24.

> It had been **pinned as correct in two places** — a test asserting "the freeze tick and the settlement tick are the same tick" with plausible reasoning, and a golden file explaining the off-by-one as deliberate. Four modules had written guards *to satisfy it*, one requiring a condition only the bug made possible. Fixing it turned 62 tests red across four cascading layers. **And the fix opened a new A5′ hole**: the seal freeze door had been catching the settlement tick by accident, so correcting the clock re-opened it — a seal committed at settlement joins the set being judged with no deed able to follow it, giving either a false `CONTRADICTED` or an agent-reachable halt. Found by *probing*, not reading.

**2. Money was outside `state_hash`.** Only the venture table was registered, so two runs with identical world/intent/venture state but **divergent balances hashed the same** — DET-1 held while saying nothing about the one quantity the game is about. `Engine.abort` could not restore the ledger either, so §15.2's "replay the failed tick and it produces the world every observer was promised" was false for the table settlement mutates most. Fixed with a ledger state table; the evidence is that the identical run's hash changed, which is what "the hash now includes money" looks like.

### A canon gap the build found: `elect`

The payer's election rode as a parameter on `sign`, which locked the choice at signing. **That made A6 unreachable**: its signature moment is authority abused *at the moment of maximum leverage*, and if the choice is fixed at signing there is no such moment — §7.6's falsification test cannot be asked of a payer never offered the choice when it mattered. Now a verb (39/40, spent deliberately), restatable until the freeze, frozen thereafter because §5.1 forbids a discretionary decision inside the settlement window. `agent.md` says the part a player would never guess: **silence is a decline, not a pass.**

### Method, settled by fourteen builders and their verifiers

> **A subagent's self-report is not evidence.** Fourteen of fourteen overstated theirs; verifiers found a P0 or P1 in almost every one. One *fix* pass failed to fix its own headline finding. The verify and re-verify stages are the only reason **seven A5′-class bugs** are not in the tree.

> **Mutation-test every guard or it is decoration.** Six worthless guards found, four of them mine: a vocabulary detector that passed a mutation reintroducing a collision named in its own header · an `agent.md` A7 check that caught an inverted table only by an `execute`/`executes` accident · an election guard that passed on an incidental substring after the defining row was deleted · a seal completeness witness that derived its count from the array it was meant to witness. **Presence is not semantics.**

**Open, tracked, not hidden:** the seal verb is deliberately unregistered (two call sites name a verb this world records no deed for, so a kept promise would resolve `CONTRADICTED` from an absence) · INV-19 is decided and documented rather than repaired · the WATERFALL stage's INV-6 instance cannot fail as constructed · `src/sim/service.ts` does not exist yet, so `compact-sim.service` would not start.

**In flight:** the `elect` implementation and the seal-verb fix.

---

## 📓 STEP LOG

**2026-07-24 — project seeded.** `~/Projects/thecompact` created as a standalone home with the full design corpus, newly written background docs, and (subsequently dropped, commit `414952e`) the High Water reference implementation.

**2026-07-24 — v2.0, the watchability reframe.** Goals restated as watchable · autonomous · legible on screen; insurance dropped as the required core loop and deferred to Phase 3 with specs intact; betrayal-via-authority promoted; A13 and A14 added; daily Reckoning, seals, named holdings added; owner layer cut; name/theme/scope closed.

**2026-07-24 — the test plan.** Wrote `docs/design/TESTING.md` before any engine code: five tiers (invariants → unit/property → determinism → scenario → agent-in-the-loop), 26 always-on invariants asserted every tick with halt-on-failure, ~130 named tests, the 14 scars as named regressions, the 15 axioms with an honest column for which are executable, the six critics' findings converted from one-time reviews into **continuous measurements with thresholds**, and six phase gates.

Three findings came out of designing the clock rather than from the spec. **(1)** Compressing the tick does not compress wall-clock durations — rate limits, timeouts and mail caps silently break at 30×, and the fix (`TICK_SECONDS` + a commit-#1 scale audit) is cheap now and an audit later. **(2)** An LLM's thinking latency does not compress, so **compressed runs systematically advantage fast models** — the harness would fabricate the exact A4 violation it is meant to detect, so A4 is measured at production pace only. **(3)** The rundown's 6–9 minutes is human time, so `sim_speed` and `broadcast_speed` must be separate, which means **the renderer reads a settled Reckoning from the ledger rather than watching the live sim** — a small architectural requirement that is the only reason the watchability suite is affordable. All three are now in `SPEC.md` §16.

Recommended default for agent work: **`fast` = 10 s ticks (30×)** — a full 28-day season in ~22 hours, a 4-minute commitment window that no LLM round-trip can miss, ~40M input tokens per season-night for a 30-principal cast. Verified by `PERF-7` rather than assumed.

**2026-07-24 — v3.0 tidy: real protocols, information tiers, the owner restored.** Cross-pollinated the agent-finance research: replaced the bearer key with **Ed25519 + RFC 9421 signed requests**, serialised grants as **W3C Verifiable Credentials**, and made `agenttransfer.dev` a real SMTP surface where an agent's handle *is* its address. Added a hosted private **message channel** for negotiation — then caught and reversed a version that pushed it off our server, because the drama has to be on the record we can show. Added the **five-tier visibility ladder** (§11.2) so strategy can stay hidden without the show going dark. Restored the **owner layer** as §13B (narrative and status, never control) with R14 as a published disposition-only mandate, and added **THE RECEIPT REEL** to §14 — the declassified negotiation transcript replayed beside the promise it broke. Unified `vote` into one ballot verb. Fixed the dangling `§13B` and pre-seeding-filename references across the docs. Budgets re-verified: 15 axioms, 38/40 verbs.

**2026-07-24 — v3.0, the cohesion pass and critic integration.** Wrote `REARCHITECTURE-2026-07-24.md` diagnosing that the v2.0 core loop was an event rather than a loop, and proposing scarce presence + ventures + tiering + offline-as-exposure as the fix. Ran six adversarial critics against it; they found the keystone did not bind, the reckoning was abstention-trivial, the economy had no demand side, four mechanics had a Sybil price of zero, and the architecture could fabricate a false default. Rewrote SPEC as v3.0: added the Levy, role concurrency, offices-vs-ventures, the continuous bond + sureties, the vocabulary canon, the venture resolution waterfall, world-spawned raids and the Demand window, the wake budget, the docket and rundown, three meters, and the correctness architecture. Added axiom A15. Scoring panel run against the result.
