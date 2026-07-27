# D19 — The board is thin because filling beats creating

*2026-07-26. The `AGT-E2` probe found one seller and an empty board 8 times in 14 polls. I wrote two
candidate explanations into the brief and said one poll would separate them. It did, and the answer is
the same mechanism as D17 one verb over.*

---

## The two candidates, and which one it is

**(a) The newcomer's vantage.** A fresh principal is Commons-bound, so if the board is filtered toward
what the reader could fill, a newcomer sees an empty board by construction and "one seller" is an
artifact of where the probe stood.

**(b) The cast suppressing creates.** If live members plan around `create` the way D17 shows they plan
around `build`, the board is genuinely thin.

**Measured: (b).** In a local heuristic world at tick 300 with **7 live ventures**:

```
cast members with an EMPTY board   0 of 8
cast members with rows             8 of 8
distinct creators across all 8 boards   2
```

So filtering is not the cause — every seated member sees rows whenever ventures exist. But **only two
of eight members ever created one**, and that is the thin supply the probe was reading. The empty
boards correspond to moments with too few live FORMING ventures, not to rows being hidden.

## The mechanism, and it is the one D17 named

`heuristic.ts` decides in this order:

```
seal  ->  ballot  ->  fill_role  (if any open slot)  ->  create  (20% chance)
```

`create` is **last**, behind `fill_role`, and gated on a 2000 bps roll. So a member with any fillable
slot fills instead of creating — every wake. Creating work is what *makes* slots, so the cast converges
on consuming a backlog it under-produces, and the board thins until only members with nothing to fill
ever create.

That is exactly D17's finding transposed: **an act that pays now beats an act that makes the world
work.** There it was `build` (a faucet that pays in 24 ticks) losing to `create` (pays at settlement).
Here it is `create` (which produces a slot someone else fills) losing to `fill_role` (which pays *this*
venture). The same ordering bias, one verb along, and both leave a structural mechanic idle.

## Why this gates AGT-E2 rather than merely inconveniencing it

**Trust cannot be priced in a market with one seller.** With two creators in eight members — and one in
the live world's sample — the trust vectors on the offer side are constants, so there is no spread for
`AGT-E2` to measure regardless of how long it polls. The gate is not blocked on instrumentation; it is
blocked on the board carrying competing offers at all.

Which makes the chain: `create` loses an action contest → few creators → thin board → no competing
offers → **trust has no observable price** → A6's central claim is unmeasurable. One ordering decision
in the heuristic sits under the design's second falsification gate.

## What I would try, and what I would not

**Not** raising `createChanceBps`. That makes more ventures without changing the ordering, so members
with fillable slots still never create and the *diversity* of creators does not move — which is the
variable `AGT-E2` needs, not the volume.

**The candidate worth testing** is the ordering itself: let a member create when it holds no role in any
live venture, ahead of `fill_role`, so every member participates on the supply side at least sometimes.
That is a two-line change of the same shape as the `build`-branch attempt in D18, and it should be
attempted **after** D18's replay bug is fixed, because that attempt showed a cast-ordering change can
surface a determinism fault that has nothing to do with the ordering.

**And the measurement that would confirm the mechanism** before changing anything: count, per cast
member over 900 ticks, how many wakes had a fillable slot available versus how many produced a
`create`. If members with slots essentially never create, the ordering is confirmed as the cause rather
than the 20% roll.

## The correction worth keeping

I recorded "8 of 14 empty boards" as an economy-liveness fact and then wrote two candidates rather than
guessing — which was right, because my first instinct was (a) and (a) is wrong. Seated members never
had an empty board. The probe's empty boards were real thinness, not filtering, and the difference
between those two readings is the difference between "fix the newcomer path" and "fix the cast's
priorities."
