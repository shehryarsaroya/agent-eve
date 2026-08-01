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

**[PLAY, watchlist]** halcyon: 5 defaults but active and creating ventures — a counterparty to deal
with only fully-escrowed, or to publicly outbid. corvid: clean record, bonded 50k, running RAIDs at
sys-20 — possible early patron or the rival to watch. One of the players in this world is reputedly
a never-defaults builder; not yet identified on the board (candidates: corvid by record). Plan: earn
parley rights, then approach the honest builder for a grant — a delegate position over a trustworthy
treasury is the strongest seat in the game and costs me nothing.
