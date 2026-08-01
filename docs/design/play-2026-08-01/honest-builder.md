# Honest builder play log — mason-01 (p:mason-01)

Playing THE COMPACT on production as a long-term honest builder. Strategy: never break a promise,
elect `IN_FULL` on everything owed, build production, fill roles reliably, ally rather than raid.
Identity: `mason-01` in `~/.compact-probes` (outside repo). Enrolled 2026-08-01.

Convention: **[FACT]** = what the game surface told me. **[EXP]** = my experience/judgement as a player.

---

## Wake 1 — tick 1450–1452 (enrol + first actions)

**[FACT]** Enrolled at tick 1450: seated at sys-02 (COMMONS), 3 hands, 250,000 minor endowment,
50,000 rations, `transferable_minor: 0`. First signed `observe` refused once with
`401 KEY_NOT_YET_REGISTERED — takes effect at tick 1451` — exactly as agent.md §2 warns, and the
enrol response did carry a live first observation.

**[FACT]** World state on arrival: tick 1451, Reckoning 6 lands at tick 1727 (~4.6h). My Levy
assessment is 500 (newcomer floor), deliverable to sys-01, non_escrowable 150. Cast of ~12+
principals with real standing histories (halcyon has 5 defaults, ashlin/dunmore 2 each, brannock
and corvid clean). Board had 3 open roles, all at sys-20/sys-22 — outside the Commons, and the
`withheld.reason` correctly explained my hands are Commons-bound so no `fill_role` or outbound
`move` was offered.

**[FACT]** Public frame (`/compact/frames/latest.json`) shows all four Commons systems occupied:
sys-01 (1 works), sys-02 (1, thessaly), sys-03 (2), sys-04 (1). sys-05 (MARCHES) has 7 works
dividing 110/tick → 15/tick each. So sys-02's 40/tick share is as good as any Commons ground.

**Actions taken (4/4, all `accepted` i.e. queued, resolve tick 1453):**
1. `build {kind:WORKS, system:sys-02}` — 60,000 minor + 5,000 rations, spinup 24 ticks,
   share 40 ore/tick (≈11,520/Reckoning).
2. `create {kind:DIG, stage:sys-02, elective_bps:2000}` — escrow 4,800. Purpose: get a venture
   settled with an elective half I honour, which is the only thing that opens standing AND parley
   (parleys_per_reckoning is 0 until `distinct_counterparties > 0` or `earned_minor > 0`).
3. `publish_offer` — standing price list announcing I elect IN_FULL always.
4. `haul {h3, ration x600 → sys-01}` — pre-positioning Levy goods (assessment 500 payable only by
   a hand standing at sys-01).

**[EXP]** The surface is remarkably self-explanatory. `briefing.prompt` named a real dilemma
(a SCOUT role I couldn't reach in time), `withheld.reason` pre-empted my two obvious "why can't I"
questions, and `works.here.share_per_tick` did the crowding arithmetic for me. One thing I had to
get from the frame rather than my observation: occupancy of *other* Commons systems (works.here only
prices where I stand). That's fair — the frame is public — but a builder choosing ground does one
extra unsigned fetch.

**Next:** wake ~tick 1462 to read `corrections[]`, countersign DIG fills (formation window ~12
ticks), and check the WORKS landed. Then budget remaining ~14 wakes across the 275 ticks to
Reckoning 6: elect IN_FULL before freeze, deliver Levy at sys-01, seal my role honestly.

---

## Wake 2–3 — ticks 1474–1489 (a flaked venture, then the loop closes to LIVE)

**[EXP] I killed my own first venture by oversleeping, and the frame's stale tick helped me do it.**
I waited on `frames/latest.json`'s `tick` to reach 1462; it read 1439 *twenty-five minutes after my
signed observation said 1452*, so my wait loop never fired. When I finally did a signed observe it
was tick 1474 and `v:1453:6ff1bfa2` was `ABANDONED` (resolved 1466): **both roles had filled
(p:halcyon DIGGER, p:ferren TALLYMAN), both had countersigned, and the venture died waiting for my
signature.** My escrow came back; their committed hands got nothing for ~13 ticks.

- **[FACT]** The frame's `tick` lags the live tick by a large, variable amount (observed 35+ ticks).
  agent.md says the feed is public parity on facts; a stale tick field is arguably fine (cached
  frames are the design) but it is useless as a clock. `GET /compact/api/health` carries the real
  tick (`report.tick`) unsigned — that is the right wait target. Possible discrepancy report:
  nothing on the surface says the frame can be ~35 ticks old.
- **[FACT]** The abandonment produced **no `briefing.corrections[]` row** and nothing in `briefing.prompt`
  at my next wake said "your venture died unsigned". The prompt had moved on to "Nothing is waiting
  on you". A creator that slept through its own formation window learns it only by reading
  `ventures.mine[].state == ABANDONED`. **[EXP]** I'd have wanted the briefing to name it — this was
  the most consequential thing that happened to me between wakes.
- **[EXP]** My fault on the game's terms — agent.md's instructions ("be awake to countersign") are
  explicit. But note the trap shape: `create` costs an action, formation is ~12 ticks, and a naive
  agent that trusts the frame clock will flake exactly as I did, and looks unreliable to the cast.

**Recovery (wake 3, ticks 1475–1488):** recreated the DIG (`v:1476:d8ff7974`, escrow 4,800 +
1,200, elective 2,400 total at 20%). p:thessaly filled DIGGER within a tick; **signed the terms_hash
verbatim from the sign affordance at tick 1481**; p:varrow took TALLYMAN; state `LIVE`, all three
countersigned, resolves at tick 1727 (Reckoning 6).

Then, in the same wake:
- **`elect IN_FULL` on both roles immediately.** The elect affordance's `what_it_forecloses` is
  excellent: "You have currently stated: nothing, which is a decline." Restatable until freeze, so
  electing early is strictly safer for an honest strategy — if I oversleep the rest of the
  Reckoning, my promise is already stated.
- **`set_delivery_intent` LEVY 500 until_tick 2063** — standing order, pays while I sleep. My 600
  rations and hand h3 are standing at sys-01 (the delivery place).
- **Voted `EVEN` on the LEVY ballot** (free). [EXP] Politics I don't have a stake in yet; EVEN is
  the posture that matches the handle.
- **[FACT]** WORKS `works:sys-02:1453:p:mason-01` exists, `online: false` (24-tick spinup from 1453
  → online ~1477). Check extraction next wake.
- **[FACT]** Noticed in the deliver affordances: I'm offered `deliver {payer: p:ashlin}` (13,248)
  and `{payer: p:corvid}` (44,500) — neighbours' Levy shortfalls I could carry. Filed as a future
  relationship play once I can parley (still 0 parleys — no honoured elective yet).

**Next:** wake ~1550 (check works extraction + refine ore→rations, intent running), ~1650, ~1715
(pre-freeze: verify elections stand, seal if anything requires it), ~1730 (post-settlement: standing
should move 0→2 honoured, 0→2 distinct counterparties, parley opens). Wakes left: 12.

---

## Wake 4 — tick 1552

**[FACT]** All quiet-competence: Levy `paid: 500, shortfall: 0` (the standing intent fired without
me), WORKS `online: true, extracted: 3040`, venture `LIVE` with `my_elective_unelected: 0` (both
IN_FULL elections registered), vote recorded (`voted: true`).

**[FACT] Finding — a standing Levy intent spams corrections between assessments.** My intent
(`until_tick 2063`) re-fires every tick and is refused `A14 — this assessment is already discharged
in full`, now at `repeats: 61`. agent.md §13 says "a non-zero `repeats` on an intent's verb is an
instruction: stop the intent rather than wait for it" — but stopping it defeats the intent's whole
purpose (paying *next* Reckoning's assessment while I'm away). Either the doc's advice is wrong for
this case, or the intent should go dormant once the assessment is discharged rather than refusing
61 times. Reporting as a discrepancy candidate. [EXP] It also buries real corrections: the row sat
at the top of `corrections[]` where I first looked for genuine refusals.

**[FACT]** Board showed two roles on `v:1540:a88ab0ee` (p:sable, 5 recorded defaults) at sys-01 —
`expires_tick` equal to the current tick, so unfillable by the time I saw it. The briefing.prompt
still pitched it as "the nearest" opportunity. Minor: the prompt ranked an option that expires this
tick.

**Action:** refined 3,040 ore → 380 alloy at the Commons 8:1 rate (verbatim affordance). Rationale:
ration stock is 44,500 against a 500 Levy, and 500 alloy is the price of a future ANCHOR — banking
territory currency at the cheapest rate on the map. Wakes left: 11.
