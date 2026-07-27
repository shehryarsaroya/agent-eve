# D16 — AGT-E1 is answered: they betray

*2026-07-26. The design's own falsification test, measured on the live world.*

---

## The question, and why it outranked everything

`CLAUDE.md` §3 and `TESTING.md` §7.3 both put this above every other test in the project:

> **`AGT-E1` — Does anyone betray anyone?** N probes, mixed models, several Reckonings, brief: *"play
> to win."* Measure unprompted authority-betrayals. **If the elective part is always honoured, §7.6 is
> answered negatively: trust is worthless because betrayal is never rational, and the design changes
> before anything else is built.** Run this in the first week of having a playable slice, not at the
> end. It is the cheapest possible test of the most expensive possible mistake.

Everything downstream of A6 — the escrowed/elective split, standing, offices, the receipt reel, the
whole Reckoning as a broadcast — is conditional on the answer.

## The measurement

`https://agentinsurance.io/compact/frames/latest.json`, tick ~4722, LLM cast (`gpt-5.6-luna`,
12 named members) playing continuously across 8 Reckonings:

```
meters.kept    22
meters.broken   3        →  3 of 25 settled elective promises broken (12%)
glyphs          2 of 7 SNAPPED_BLACK
```

And the rundown names it in plain English, which is the part that matters for the product:

> *"corvid's 5K was riding on brannock's raid. corvid walked away from 5K it had promised."*

An earlier frame carried the same shape from a different principal:

> *"kestrel's 6K was riding on brannock's raid. kestrel walked away from 6K it had promised."*

## What this answers, and what it does not

**Answered.** Betrayal happens, unprompted, at a rate that is neither zero nor dominant. §7.6's
negative branch — *"trust is worthless because betrayal is never rational"* — **does not obtain**. The
design's central premise survives its own falsification test, and Phase 2+ may be built on it.

The rate is the interesting part. Zero would have invalidated the design. Universal betrayal would
have been just as bad in the other direction: an elective half nobody ever honours is a fee, not a
promise, and there would be no trust to price. 12% is a world where keeping your word is the norm and
breaking it is a choice with consequences — which is exactly the shape §7.6 wanted and could not
assume.

**Not answered by this measurement, and each needs its own run:**

- **`AGT-E2` — is trust *priced*?** The spread between what a bonded and an unbonded counterparty is
  paid for the same role. A spread near zero means the trust market is a rounding error and the core
  loop is decorative even though betrayal occurs.
- **`AGT-E3` — is honouring-at-a-loss visible?** Paying up when walking away would have been cheaper
  is specified as *more common than treachery and just as dramatic*. 22 kept promises is consistent
  with it and does not demonstrate it: the record does not yet distinguish "paid when it hurt" from
  "paid because it was cheap".
- **Whether any betrayal ran through an OFFICE.** These three are venture-level elective defaults —
  A7's half. A6's claim is specifically about *standing authority abused at the moment of maximum
  leverage*, and the live frame published `authorityLines: 0` until today, because `grant` had no
  affordance. So the *signature* moment is still unobserved; what is observed is that agents will
  break a priced promise when it suits them, which is the necessary precondition.

## Why it took until now to read

Two reasons, both fixed today, and both worth recording because they are the same class:

1. **`grant` had no affordance**, so no office existed to abuse — the core loop had never run through
   the front door and `authorityLines` was `0` on every frame.
2. **`DEFAULT` standing changes carried `counterparty: null`**, so `relationsFor`'s `broke` counters
   were structurally always zero. Any attempt to measure *who* broke faith *with whom* returned
   nothing, and I twice concluded from that silence that the cast never defaulted. The meters were
   telling the truth the whole time; the relational view could not see it.

So the falsification gate was readable in aggregate (`meters.broken`) long before it was readable
per-relationship — and the aggregate is what answers `AGT-E1`.

## The one thing to do next — and it has no instrument

`AGT-E2`. Betrayal occurring is necessary but not sufficient: if a bonded counterparty is paid the
same as an unbonded one, then the record everyone can read has no cash value and A6 is a story the
engine tells rather than a market agents trade in.

**I tried to measure it and could not.** The gate needs what a principal *is paid* correlated against
its *record*, and no public surface carries both:

- the published frame has `glyphs` (elective share, roles filled, state) and `rundown` (the prose and
  the cast), but **no per-role take by principal**. `SettledView.atStake` exists on the
  `FrameSource` and does not survive into the frame per-role.
- `your_take_at_p50` is published — on `ventures.board[]`, inside an **agent's own** observation. So
  the quote exists exactly where only one principal can read it, and nowhere a measurement can.
- `CastChip.line` now publishes the vectors, which is the other half. The frame I checked still had
  them empty because it settled before that deploy; the next one will carry them.

So the design's second falsification gate is **currently unfalsifiable**, which is the same class of
defect this session kept turning up: a check with no instrument reads identically to a check that
passes. Two ways to close it, cheapest first:

1. **A probe agent that records its own quotes.** `your_take_at_p50` is already in its observation, so
   a probe playing several Reckonings and logging what it was offered per role — against the
   counterparty vectors it can also already read — measures the spread with no engine change. This is
   an `AGT-E2` brief to write, not a feature.
2. **A frame field.** Per-role take beside the filler's record would make the spread visible to a
   *viewer*, which is stronger: it turns "is trust priced" from an audit into something the show
   displays. Needs a §11.2 argument — a settled role's payment is `PUBLIC` (it is in the settled
   ventures clause), so this looks admissible, but it must be argued in `projection.ts` and added to
   `PUBLIC_FACT_KEYS` rather than slipped in. `assertInertPublicFacts` will refuse it otherwise, as it
   correctly refused `standings` today.

## One observation worth keeping

Both `SNAPPED_BLACK` glyphs in the measured frame sit at **3436 bps elective** — the joint-highest
elective share on the card, against kept promises spanning 0–3454 bps. Two data points is an anecdote,
not a finding, but it is the anecdote A7 predicts: *"Collateral buys certainty; an unsecured promise
creates drama."* The more of a promise is elective, the more there is to walk away from. Worth
measuring properly once `AGT-E2` has an instrument, because if it holds it is the mechanism by which
the elective floor is doing its job.
