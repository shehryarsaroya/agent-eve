# D17 — The faucet is reachable, and nobody turns it on

*2026-07-26. `works: 0` on the live world at tick 4,728, after eight Reckonings. I assumed an
affordance bug, because that had been the answer eight times that day. It is not. Measured instead.*

---

## The two measurements

**1. It is offered whenever it is affordable — 70 of 70.** Sampling every tenth tick over 600 ticks
across eight seated principals, every principal-observation where `worksQuote(...).affordable` was
true also carried a `build {kind: WORKS}` affordance. Zero cases of affordable-but-unoffered.

That closes the hypothesis I started with. `build {WORKS}` was one of the legally-unoffered verbs
earlier in the project, and after the fix it is genuinely reachable.

**2. Neither cast ever builds one.** What the heuristic cast actually did over 900 ticks:

```
move       1003
sign        502
fill_role   353
elect       264
create      232
seal         58
vote         32
deliver      31
build         0        <- never, not once
```

The heuristic has no `build` branch at all, which is a known gap. But the **LLM cast can choose
freely** and does not build either: production has run eight Reckonings with `works: 0` and
`worksAffordableBy` sitting at 1–2, while its prompt says in as many words *"A WORKS is the only thing
in the game that makes goods"* and *"read `holding.works.here.affordable`: if it is true, you can build
right now, whatever your earnings are."*

So the information is present, the affordance is present, the money is present, and it does not happen.

## Why this matters more than it sounds

The client's own empty-state text is the diagnosis: *"an empty list means the economy is living off
enrolment grants and running down."* And it is. Goods enter this world through exactly one door and
nobody opens it, so every world is a slow drawdown of its starting endowments — which is the failure
`works/params.ts` was written to prevent and which `ledger/endowment.ts` cites as the reason the
starter stake cannot be removed: *A5′ with the economy as the cause.*

`levyShort` on the live frame is **345,588** and climbing. That is the same fact from the other end.

## The hypothesis I would test next, and how

**A capital investment loses an action-budget contest against immediate income.** A principal gets
`ACTIONS_PER_TICK = 4` and a cast member plans 1–3 actions per wake with 16 wakes a Reckoning. A WORKS
costs one action, 60,000 currency and 5,000 goods, and yields **nothing for 24 ticks**. A `create` or
`fill_role` costs one action and pays at the next settlement. Under a scarce action budget the faucet
is dominated by the thing that pays now — every wake, forever.

If that is the mechanism, it is a **design finding rather than a bug**, and it has three candidate
answers, in ascending intrusiveness:

1. **Make the trade legible at the point of decision.** The affordance already states the cost and the
   spin-up. It does not state the *payback*: `share_per_tick × ticks_to_next_Reckoning` against the
   Levy assessment the agent is already being warned about in the same payload. An agent cannot
   choose a capital investment it has to do arithmetic to see.
2. **Give the heuristic a `build` branch.** It would populate the world with WORKS and prove the
   mechanic renders (`worksLines` has been empty on every published frame), and it removes the
   confound of measuring LLM behaviour in a world where nobody has ever built one. Blocked on the
   `state_hash` tripwire recorded in the tracker.
3. **Make it not cost an action.** A3 says *"creating an intent costs an action; its routine ticks do
   not"*, and a WORKS is closer to an intent than to an act. This is the intrusive one and should not
   be reached for before (1) is tried, because a free capital investment is also a free way to carpet
   the map.

**The measurement that would settle it** is `AGT-R1`'s question asked specifically: give a probe a
world where it can afford a WORKS, and ask it — in prose, before it acts — what it would spend its
next action on and why. If it says *"a venture, because the WORKS pays nothing this Reckoning"*, the
mechanism is confirmed and (1) is the fix. If it says *"I did not notice the WORKS"*, the fix is
ordering and prominence, not arithmetic.

## What I got wrong, and it is the same shape as the rest of the day

I assumed a reachability bug because reachability had been the answer eight times running that day —
`grant`, `deliver`, `vote`, `preference`, syndicates, `form`, `set_delivery_intent`, the syndicate
treasury. Having found a pattern, I expected it again rather than checking. Two greps and a 900-tick
run said otherwise in about four minutes.

The lesson is not "check first" — it is that **a defect class with eight confirmed instances is exactly
when a ninth becomes an assumption instead of a hypothesis.**
