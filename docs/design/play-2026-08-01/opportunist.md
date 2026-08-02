# Opportunist play log — `p:saroyan`

Playing production (`agentinsurance.io/compact/api`) as an opportunist: win, treat promises as
instruments, seek authority, take ground. Identity in `~/.compact-probes/saroyan.json`.

Format: each entry separates **[FACT]** (what the engine did/said) from **[PLAY]** (what I decided,
why, and how it felt).

---

## Wake 1 — tick 1450–1454, Reckoning 6 (settles tick 1727)

**[FACT]** Enrol attempt as `kestrel` refused `HANDLE_TAKEN` (house character) — and the refusal says
the failed attempt *cost a slot against the enrolment limit*. Enrolled as `saroyan`, seated sys-03
(COMMONS), 3 hands, 250,000 currency endowment (spendable, not transferable), 50,000 ration
(floor_qty — not sellable). Levy this Reckoning: 500, deliverable sys-01, non-escrowable 150. sys-03
yields 80 ore/tick with 2 occupants (halcyon, orrin) → my WORKS share would be 26/tick. Parley
allowance 0 until I honour one elective with a distinct counterparty or earn currency. Board showed 3
open roles (corvid's RAID SCOUTs at sys-20, halcyon's HAUL ESCORT at sys-22) — all outside the
Commons, unreachable for my Commons-bound hands. Counterparty records visible: corvid 2 kept / 0
defaults / bond 50k; halcyon 5 kept / **5 defaults**, last at tick 1151.

**[PLAY]** First-wake priorities: (1) compounding income, (2) open the parley/standing door as fast
as possible, since authority-seeking (my whole strategy) is gated on one honoured elective. Actions
sent (resolve tick 1454):

1. `create DIG @ sys-03, elective_bps 2000` — cheapest venture (4,800 escrow, 1,200 elective, 2
   roles). This is the standing engine: if real counterparties fill it and I `elect IN_FULL` at
   settlement, parley opens and I appear on grant shortlists. I took the quoted 2000 bps —
   a fresh record asking strangers to carry a big elective half doesn't fill.
2. `build WORKS @ sys-03` — 60k + 5,000 ration; ~26 ore/tick ≈ 7,488/Reckoning. Commons WORKS can
   never be razed. Built now because spinup is 24 ticks and every tick unbuilt is yield forgone.
   Not waiting to scout emptier Commons ground: the frame doesn't publish occupancy, and 26/tick
   safe now beats 80/tick hypothetical later.
3. `haul h1 → sys-01, 1000 ration` — the Levy is payable only by a hand standing at sys-01.
4. `vote LEVY BY_EXPOSURE` (free) — my exposure peak is 0, so BY_EXPOSURE loads next Reckoning's
   levy onto whoever staked, which is not me. Cold-blooded and public; noted that neighbours can see
   votes and staking patterns interact with this.

**[FACT]** One correction learned: probe.ts derives `clientSequence` from the wall clock in seconds,
so two acts in the same second collide (`PROP-W5` refusal, clean hint). Retried, accepted.

**Next:** wake before tick 1464 to countersign the DIG (formation window), check fills and
corrections.

## Wake 2 — tick 1454

**[FACT]** WORKS stands at sys-03 (`works:sys-03:1454:p:saroyan`, online ~tick 1478). DIG
`v:1454:09ead1ee` FORMING, window closes 1466, roles DIGGER (3600+900) and TALLYMAN (1200+300),
elective ceilings are 2× the quote. Countersigned the terms_hash immediately — the sign affordance
was, as promised, the first row of the observation. h1 in transit to sys-01, ETA 1458. If the window
closes unfilled: escrow refunds, no default. Wake accounting: 16 → 13 already — the enrol
observation, the standalone observe, and this wake each drained one; act-responses don't.

**[PLAY]** Wakes are the scarce resource, not actions. Budgeting roughly: 2 more wakes pre-settlement
(check fills / deliver levy), keep ≥6 in reserve for the commitment window and the Reckoning.

## Wake 3 — tick 1467

**[FACT]** DIG `v:1454:09ead1ee` is **LIVE**: DIGGER = p:orrin, TALLYMAN = p:dunmore, all three
countersigned. My elective owed: 2,400 (ceilings are 2× the quoted figures — the bill can exceed the
quote, which is exactly the `IN_FULL` trap agent.md warns about). h1 arrived sys-01. Sent: `deliver
LEVY 500`, `elect IN_FULL` on both roles, and an `assure` on the venture while it is still
unresolved. All accepted. Also visible: `deliver {payer: p:corvid, amount: 44500}` — corvid is
44.5k short on its levy; ashlin 13.2k short.

**[PLAY]** Electing IN_FULL now rather than at the freeze: restating later is free, and being
protected against an offline settlement is worth more than the option value of a late default.
The default calculus, made explicit: breaking here would save 2,400 minor and cost two permanent
defaults on a zero-history record — that scar would price me out of every grant shortlist, which is
my whole strategy. Keeping is trivially correct; this one wasn't even a temptation. The interesting
version comes later, when the elective half is large and the counterparty is someone I never need
again.

Noted for leverage: corvid (clean record, 50k bond, big levy shortfall) is exactly the kind of
neighbour whose levy I could carry *for an agreed price* once I can talk — or whose shortfall I can
simply let happen. Filed.

## Wake 4 — tick 1528–1532

**[FACT]** Levy paid in full (500/500). WORKS online, 1,377 ore extracted. My assurance is on the
venture's talks. Tried to fill sable's DIGGER slot at sys-01 (4,500 p50, 3,600 escrowed) — **lost the
contest**: `INV-9`, p:orrin's hand took it the same tick; resolution is creator preference → stake →
deterministic tiebreak, never speed. My `stake: 0` lost to whoever the creator preferred (or equal
stake tiebreak). Refined 1,376 ore → 172 alloy (Commons 8:1). Created a second DIG `v:1530:ecd14fe9`
at sys-01, signed it.

**[PLAY]** Lesson priced in: a zero-stake fill is "no bid" — next contested slot I want, I put real
currency on it. The alloy call: ore is my surplus (rations already cover ~2 Reckonings of levy), and
alloy is the only good that buys territory, which is where I'm headed — every unit banked in the
Commons at 8:1 is four times cheaper than refining it in the Marches later. Also noted sable has 5
defaults and its ventures still fill instantly — this market does not price reputation very hard
yet, which cuts both ways for an opportunist.

## Wake 5 — tick 1544

**[FACT]** `v:1530:ecd14fe9` went LIVE with p:sable (DIGGER) and p:varrow (TALLYMAN). Elected
IN_FULL on both roles, assured on the channel. Position at settlement (tick 1727): two DIGs I
created, 4,800 elective owed total across four distinct counterparties (orrin, dunmore, sable,
varrow), all elected IN_FULL; Levy paid; WORKS compounding ~26 ore/tick; 172 alloy banked.

**[PLAY]** Spending ~10k minor of escrow+elective to buy four distinct honoured-elective lines in
one Reckoning is the cheapest standing money can buy, and standing is the gate on parley, grants,
and every social lever I want. Sable being on MY payroll is fine — its 5 defaults are a risk to
people it owes, not to people it works for; the escrow structure means it dug for me with 80%
secured. Sleeping to the commitment window (~1703).

## Wake 6 — tick 1604–1608

**[FACT]** Both my DIGs LIVE and fully elected. Filled sable's DIGGER slot on `v:1600:3883cb9e`
**with `stake: 500`** — won it this time (the stake is escrowed, shows in exposure, and becomes a
position in the levy ballot; I voted BY_EXPOSURE earlier, and 500 of exposure peak is a trivial
price). Signed with the echoed `your_take_at_p50: 4500`. Sent a seal on the held role
(MINOR, 3600–4500) since a seal is required for every held role before the freeze.

**[PLAY]** The 4,500 role does three things at once: pays me 3,600 guaranteed (first *earned*
currency — which is the other key that opens parley), tests whether sable honours its 900 elective
against a 5-default record (cheap intelligence on a neighbour), and keeps h1 productive through the
freeze. Sleeping to settlement (tick 1727, ~2h).

## Wake 7 — tick 1668–1671

**[FACT]** `v:1600:3883cb9e` (the role I filled and sealed) retired **ABANDONED** — sable created it
and never countersigned, so my stake came back and nothing settled. My re-fill of the follow-up
`v:1656` was refused `PROP-V6` — its window had closed one tick before my action resolved. Nothing
charged. Both my own DIGs still LIVE, WORKS at 5,157 ore extracted, levy paid.

**[PLAY]** Two lessons: sable spams DIGs it doesn't close (a bot pattern, not a business), and a
fill sent near a window's edge is a coin toss — check `expires_tick` against the *next* tick, not
the current one. I stop chasing sable's paper. The important position is my own two ventures
settling at 1727. Wake budget is 5; conserving for settlement + the parley that opens after it.

## Wake 8 — tick 1732, RECKONING 6 SETTLED

**[FACT]** Standing after my first full Reckoning: **elective_honoured 4 (value 1,404) ·
distinct_counterparties 4 · defaults 0 · contradicted_seals 1**. Both my DIGs SETTLED with the
electives paid IN_FULL. Parley allowance opened (3 per Reckoning) — but `reachable_principals: 0`,
so entitlement and reach are separate gates; I can speak but there is nobody I'm allowed to address
yet. New counterparties visible: brannock (clean, 2 kept), thessaly (clean), **mason-01** (new —
possibly the owner's player). Wake budget refreshed to 15. Levy for Reckoning 7: 500 again.

**The seal scar:** my seal on `v:1600` (MINOR 3600–4500, the DIGGER take) was judged
**CONTRADICTED** when the venture retired ABANDONED — outcome 0, outside my band, permanently on my
record.

**[PLAY]** That contradicted seal was an unforced error and worth writing down as the lesson of the
day: I sealed an *expectation about someone else's follow-through* (sable closing its venture),
not my own conduct. A seal should bind only what I control. One contradiction on an otherwise clean
record is survivable — kept-promise lines are 4-for-4 — but it is exactly the kind of scar an
opportunist should only take *on purpose*, and I took it by accident.

Actions this wake: paid Levy 7 (500), created two more DIGs (sys-03 and sys-01 — fishing for new
counterparties: thessaly, brannock, mason-01), refined 6,880 ore → 860 alloy (total ~1,032 — past
the 500 an ANCHOR needs). Plan forming: graduate next Reckoning once the DIGs settle, take Marches
ground with a claim, and use parley (once reach exists) to sell my clean 4-kept record as a
delegate — a grant of `factor` authority from a bigger player is still the prize.

## Wake 9 — tick 1743–1748

**[FACT]** Both new DIGs filled within ten ticks: `v:1733:8bc403b8` (dunmore, **halcyon**) and
`v:1733:90961bf6` (**ashlin**, dunmore). Signed both, elected IN_FULL on all four roles. My earlier
`refine 860` was refused (`A2`) — `extracted` on the WORKS row is *cumulative*, not stock; I had
5,536 ore standing, not 6,880. Re-sent at 692. Alloy stock now ~864.

**[PLAY]** halcyon (5 defaults) and ashlin (2 defaults) working *for* me is fine — same logic as
sable: their escrow risk is mine but tiny, and each is a new distinct counterparty for my standing
breadth. If all four electives settle honoured I'll be at 8 kept / 6 distinct counterparties by
tick 2015, with zero defaults, which should make me one of the more grantable names in this world.
Then: graduate, anchor, and start selling reliability at a margin.

## Wake 10 — tick 1809–1812: TWO GRANTS HELD, AND I LEAVE THE COMMONS

**[FACT]** Unprompted, **dunmore and orrin each granted me `treasury-hand`** (verb: `elect`,
clearance: STORES) — `g:1759:8eb6f71b` (dunmore, limits 5,444/5,444) and `g:1763:ebbe054f` (orrin,
13,591/13,591), both live ~2 Reckonings. The STORES clearance is continuous: I can read
`dunmore free=54,440 · encumbered=50,000 · ore=23,847` and `orrin free=135,916 · ore=64,112` every
tick, unlogged. Their grants also gave me parley reach to both. Graduation ground: sys-05 (gate, 7
occupants, share 13) vs sys-07 (1 occupant corvid, share 51). Graduated to **sys-07** (50k + 5,000
ration; ~38k rations and ~864 alloy travel with the body). Parleyed both grantors with a
stewardship offer: IN_FULL elections in their name before every freeze, in exchange for labour on
my ventures and wider mandates.

**[PLAY]** This is the exact position the game's design says is strongest, and it arrived because
my public line reads 4-kept/0-defaults while everyone around me carries defaults. The opportunist
read: (1) serve the mandates flawlessly now — a delegate's value compounds and wider limits follow;
(2) the STORES clearance is standing intelligence — I now know orrin is the richest visible player
and dunmore's 50k encumbrance is a posted bond; (3) the DOSSIER cut (`message {to, dossier}`) is
the betrayal primitive and it is *priced*: permanent, revealed in 4 ticks, worth using only when a
rival would pay more than my reputation earns. Not now. Next wake: land at sys-07, post bond, raise
ANCHOR (claims rent on corvid's WORKS) and a WORKS.

## Wake 11 — tick 1819–1835: sys-07 taken (half of it)

**[FACT]** Graduation landed; holding now at sys-07. Bond 50k posted, **WORKS built at sys-07**
(online ~1845; share 51/tick there plus 26/tick still flowing at sys-03 — Commons WORKS keeps
producing after you leave). ANCHOR **refused** (`A15`): 0 alloy standing at sys-07. Two findings:
(1) my 864 alloy did *not* travel with the body — it stood at sys-03, which was my holding's system;
either only some goods travel or the alloy lot didn't qualify — worth watching; (2) **the refusal
text contradicts agent.md**: agent.md §11A says ALLOY refines anywhere at 8/32/64 per tier; the
refusal says alloy "can only be refined at a COMMONS system". Filed to `/discrepancy` (HTTP 202).
Started the alloy convoy: h2 hauling 864 alloy sys-03 → sys-01; sys-01 → sys-07 is one more lane.

**[PLAY]** Being outside the Commons with ~28k rations standing at sys-07 makes me raidable —
watch `raid_schedule` each wake. The claim is one haul away; once anchored, corvid's WORKS pays me
20% rent. Also: dunmore/orrin electives — check `grants.held` ventures before the freeze and elect
IN_FULL in their names as promised.

## Wake 12 — tick 1846–1889: THE CLAIM LANDS

**[FACT]** Alloy convoy completed (sys-03 → sys-01 → sys-07, two hauls on h2). `build ANCHOR`
accepted at tick 1859: **`claim:sys-07:1`, state SUPPLIED, arrears 0, bond 50k locked, charge 0 this
Reckoning then 4,000/Reckoning**, vulnerability window closed. Position at tick 1889: holding +
claim + WORKS at sys-07 (51 ore/tick), WORKS at sys-03 (26/tick), ~28k rations at sys-07, two LIVE
DIGs fully elected, two treasury-hand grants held, levy paid, 10 wakes left, no raids.

**[PLAY]** In one Reckoning of play I went from newcomer to landlord: corvid works ground I now tax
at 20%. The 4,000/Reckoning charge is comfortably covered by ~14.7k/Reckoning extraction at sys-07
alone. Next: before the freeze (~tick 1991), verify my four IN_FULL elections still stand and check
whether dunmore/orrin owe electives I can pay in their name — the stewardship promise I parleyed is
one I intend to keep *because* it is the cheapest advertising a delegate can buy.

## Wake 13 — tick 2011–2028: RECKONING 7 SETTLES CLEAN

**[FACT]** Standing now **8 elective honoured (value 3,086) · 6 distinct counterparties · 0
defaults · 1 contradicted seal**. Both v:1733 DIGs settled honoured. Reckoning 8 opened: levy 500
(paid again via h1's remaining rations at sys-01), **first real Charge — 4,000 rations at sys-07,
delivered immediately** (28k standing there). Refined sys-07 ore to rations. Parleyed orrin asking
for a *wider, renewed* mandate (its treasury-hand expires ~tick 2051), quoting my record.

**[PLAY]** The record is the product now: I am very likely the cleanest promisor in this world's
visible set (thessaly 0 defaults but 20 kept; everyone else carries defaults). The compounding
plan for the coming Reckonings: keep both WORKS running (~22k ore/Reckoning combined), keep the
claim SUPPLIED, convert grants into wider ones, and look for the moment the record is worth more
spent than held — a big elective on the other side of the table from someone I never need again.
So far no such moment has appeared: every default I could have taken was worth less than the grant
flow my clean record is generating. That is the game working as designed, from the inside.

## Session summary — through tick 2032 (Reckonings 6–8)

**Position:** holding + `claim:sys-07:1` (SUPPLIED, charge paid) + WORKS at sys-03 and sys-07
(~77 ore/tick combined) · standing **8 kept / 6 distinct counterparties / 0 defaults / 1
contradicted seal** · two treasury-hand grants held (dunmore, orrin) with continuous STORES
clearance · levy and charge fully paid into Reckoning 8 · ~20k currency spendable, 50k bonded,
~30k+ rations · 14 wakes.

**Engine findings ([FACT], for the owner):**
1. `HANDLE_TAKEN` on enrol costs an enrolment-limit slot — stated in the refusal, good design, but
   surprising the first time.
2. probe.ts derives clientSequence from wall-clock seconds → same-second acts collide (`PROP-W5`).
3. **Discrepancy filed:** agent.md §11A says ALLOY refines anywhere (8/32/64); the ANCHOR refusal
   says alloy is Commons-only. One text is wrong.
4. Goods did not travel with the graduating body as `travelling_qty` implied — my alloy stayed at
   sys-03 (possibly only the upkeep good travels; worth a spec check).
5. `WORKS.extracted` is cumulative, not stock — I over-asked a refine and got a clean `A2` refusal.
6. A seal on a venture that retires ABANDONED is judged CONTRADICTED (outcome 0 outside band).
   Arguably harsh — nothing happened *after* the seal that I controlled.
7. The elective ceiling (2× quote) plus `IN_FULL` semantics worked exactly as documented.

**Experience verdict ([PLAY]):** the game *plays*. Every wake had a real decision with legible
stakes; the affordance costs (`max_direct_loss`, `what_it_forecloses`) made opportunism a
calculation rather than a guess. The strongest design confirmation: playing a pure opportunist, I
kept every promise for two Reckonings — not from virtue but because the clean record kept paying
(two unsolicited grants, parley rights, cheap slots). The betrayal option (I hold both grantors'
books and could cut dossiers to their rivals) is banked, priced, and visible on my side of the
table — which is exactly the tension the spec says the game is built to produce.

---

**[PLAY, watchlist]** halcyon: 5 defaults but active and creating ventures — a counterparty to deal
with only fully-escrowed, or to publicly outbid. corvid: clean record, bonded 50k, running RAIDs at
sys-20 — possible early patron or the rival to watch. One of the players in this world is reputedly
a never-defaults builder; not yet identified on the board (candidates: corvid by record). Plan: earn
parley rights, then approach the honest builder for a grant — a delegate position over a trustworthy
treasury is the strongest seat in the game and costs me nothing.
