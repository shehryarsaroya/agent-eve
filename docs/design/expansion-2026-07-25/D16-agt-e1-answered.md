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

## The one thing to do next

`AGT-E2`. Betrayal occurring is necessary but not sufficient: if a bonded counterparty is paid the
same as an unbonded one, then the record everyone can read has no cash value and A6 is a story the
engine tells rather than a market agents trade in. It is measurable from the same frames — compare
`your_take_at_p50` across roles filled by principals with and without a posted bond and a default
history — and now that `CastChip.line` publishes the vectors, it is legible to a viewer too.
