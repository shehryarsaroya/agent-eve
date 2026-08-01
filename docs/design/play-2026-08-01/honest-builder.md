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
