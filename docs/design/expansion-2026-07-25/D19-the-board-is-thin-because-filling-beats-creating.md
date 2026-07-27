# D19 — The board is thin because most of the cast is idle

*2026-07-26. The `AGT-E2` probe found one seller and an empty board 8 times in 14 polls. This file
records two wrong answers and the right one, in the order I reached them, because the sequence is the
useful part.*

> ⚑ **READ §"THE MECHANISM ABOVE IS REFUTED" FIRST.** The filename and the first three sections say the
> cause is branch ordering — `create` losing to `fill_role`. **That is wrong**, and it was killed by the
> confirmation step the same document proposed. The cause is that five of eight cast members barely act
> at all. The wrong reasoning is kept in place rather than deleted because it was a *plausible* wrong
> answer that a measurement refuted in four minutes, and the next person to look at cast behaviour will
> have the same instinct. The filename is left alone so the commit trail stays resolvable.

---

## First wrong answer, and the one that was right to reject

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

## Second wrong answer: the mechanism I thought I had found (refuted below)

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

## ⚑ THE MECHANISM ABOVE IS REFUTED — by the confirmation I said to run first

I proposed counting, per member over 900 ticks, how many wakes had a fillable slot versus produced a
`create`, *before* changing any ordering. That was right, and it killed the hypothesis:

```
member       acts  creates  fills
brannock      585       67     67
kestrel       623       67     66
vex           429       51     58
thessaly      273       37     27
varrow        276       27     53
orrin          72        5     17
sable          82        1     26
halcyon        51        1     12

members that NEVER created: 0 of 8
```

**Every member creates.** `create` does not lose to `fill_role` — the two move together, roughly
one-for-one in the active members. So the branch ordering is not the cause and raising it above
`fill_role` would have changed nothing while adding a cast-ordering diff of exactly the kind D18 showed
can surface a determinism fault.

**The real variable is total activity, and it is wildly concentrated.** An 11× spread in how often a
member acts at all — 585 acts against 51 — and creates scale with it (11% of acts for brannock, 2% for
halcyon). Three of eight members do most of everything.

**That is what made the probe see one seller.** brannock and kestrel create 67 ventures each; halcyon
and sable create one. Any snapshot of live FORMING ventures is dominated by the prolific few, so a
14-poll session over 58 minutes reads as a one-seller market even though all eight eventually create.
The concentration is real; the "one creator" was a sampling consequence of it.

**So the question moves, and it is a better question:** why do five of eight members barely act? 51
acts in 900 ticks is a member that returns nothing from `decide` on ~94% of ticks. Candidates, none
tested: hands committed to long-running roles so no `idle` hand exists to act with (the `idle.length >
0` gate fronts both `fill_role` and `create`); or hands in transit for most of the run, since `move` was
the single most common action at 1003; or a seat whose holding sits somewhere with nothing reachable.
The `idle`-hand gate is the first thing to instrument, because it fronts every branch that does anything
material.

That reframes the AGT-E2 blocker too. It is not "the cast prefers not to create" — it is **"most of the
cast is idle most of the time,"** which is a different problem with a different fix and would have been
mis-solved by the ordering change I was about to make.

## The answer: filling roles is self-limiting

Instrumented the `idle`-hand gate as the refutation said to. Hand-state mix over 900 ticks, three hands
per member (2,700 hand-ticks each):

```
member      acts   ticks w/ an IDLE hand   hand-state mix
halcyon       62          49/900           COMMITTED 2595   IDLE 93    IN_TRANSIT 12
orrin         75          66/900           COMMITTED 2540   IDLE 124   IN_TRANSIT 36
sable         84          76/900           COMMITTED 2540   IDLE 141   IN_TRANSIT 19
thessaly     267         245/900           COMMITTED 2041   IDLE 371   IN_TRANSIT 288
varrow       418         375/900           COMMITTED 1575   IDLE 671   IN_TRANSIT 454
vex          564         494/900           COMMITTED 1235   IDLE 799   IN_TRANSIT 666
brannock     557         510/900           IN_TRANSIT 1385  IDLE 693   COMMITTED 622
kestrel      599         554/900           IN_TRANSIT 1221  IDLE 794   COMMITTED 685
```

**The idle members are COMMITTED, not in transit** — and that inverts the guess in the refutation
above, which offered transit as the likelier candidate because `move` was the most common action.
halcyon's three hands are locked into roles for **96% of all hand-ticks**; it has an idle hand on 49 of
900 ticks, hence 62 acts. brannock and kestrel are the mirror image: low commitment, high transit, and
they are the two prolific creators.

So the chain is:

```
fill_role commits a hand for the venture's life
  -> a committed hand cannot act
    -> the members who WORK most ACT least
      -> the free members are the ones creating
        -> creation concentrates in whoever is not locked in
```

**Filling roles is self-limiting**, and the 11× activity spread is that, not a preference.

## Is this a bug? No — and that is the interesting part

A hand is *"one unit of simultaneous physical presence"* and three hands is the design's tightest
constraint by intent. A member that fills three roles **should** be fully committed until they resolve.
So every step above is the specification working.

What it produces, though, is a world where the supply side is staffed by whoever happens to be
unemployed — which is a real economic result and not obviously the intended one. §4's arithmetic is that
three hands is *"enough to run small things forever by yourself, not enough to run anything worth
running"*, and the observed consequence is sharper than that: **participating as a worker removes you
from the market as a principal.**

The lever is not the cast. It is **role duration against hand count**. If a role holds a hand for a
large fraction of a Reckoning, three hands is full lockup after three fills, and the number of active
principals collapses to whoever is between jobs. That is worth measuring directly — mean ticks a hand
spends COMMITTED per fill, against `TICKS_PER_RECKONING` — before anyone tunes a cast branch, because no
cast ordering can fix a capacity constraint.

And it gives `AGT-E2` its real precondition: competing offers need several *uncommitted* principals at
the same time, which is a function of how long work holds a hand.

## The lever, measured: it is not duration, it is WHEN you fill

Mean COMMITTED ticks per fill, over 900 ticks and 239 completed spans:

```
mean   60.4 ticks   = 21.0% of a Reckoning
median 11   ticks
p90    276  ticks
max    293  ticks
```

**Bimodal, and the tail is the whole story.** Half of all commitments end within 11 ticks; a tenth run
276–293, which is essentially a full Reckoning (288). So it is not that filling a role is expensive on
average — it is that filling one *at the wrong moment* costs a third of your capacity for an entire
cycle.

**And the cause is structural, not incidental.** A venture's `resolvesAtTick` is
`nextSettlementAtOrAfter(closes + DELIVERY_LEAD_TICKS)` — it resolves at a **Reckoning boundary**. So a
hand committed at phase 10 is held until phase 288; a hand committed at phase 270 is free in a few
ticks. Same act, same venture kind, same pay, and an ~25× difference in what it costs you.

That closes the chain from the probe's null result all the way down:

```
ventures resolve at the Reckoning boundary
  -> filling early locks a hand for the whole cycle
    -> a member that fills three early is inert for a Reckoning
      -> the active principals are whoever filled late or not at all
        -> creation concentrates in those few  (11x activity spread, measured)
          -> the board shows one or two sellers at any moment
            -> trust has no competing offers to be priced against
              -> AGT-E2 cannot be measured
```

## What to do about it, and it is an A2 problem before it is a balance one

**Nothing tells an agent this.** The board publishes `resolvesInTick`, so the information is *present* —
but framed as *when the venture pays*, never as *how long your hand is gone*. Those are the same number
and completely different decisions, and an agent optimising for pay-per-action has no reason to compute
the second. This is the WORKS payback problem again in a third place: the surface states the reward and
leaves the cost to be derived.

The cheap fix is one field on a board row — `hand_committed_ticks`, or the same number under a name that
says what it costs — plus a line in the affordance that contrasts an early fill with a late one. That is
legibility, and it should be tried before any balance change, because if agents are simply not seeing
the opportunity cost then the capacity constraint is not actually binding on *judgement* yet.

**The balance question, if legibility does not move it:** should a role release a hand at delivery rather
than at settlement? Delivery is when the work is done; settlement is when the money moves. Holding
physical presence until the accounting completes is defensible but it is not obviously the intent, and
§4's *"three hands is the tightest constraint in the game"* becomes a much tighter constraint than
three-at-once when one fill can cost a whole cycle.

## The correction worth keeping

I recorded "8 of 14 empty boards" as an economy-liveness fact and then wrote two candidates rather than
guessing — which was right, because my first instinct was (a) and (a) is wrong. Seated members never
had an empty board. The probe's empty boards were real thinness, not filtering, and the difference
between those two readings is the difference between "fix the newcomer path" and "fix the cast's
priorities."
