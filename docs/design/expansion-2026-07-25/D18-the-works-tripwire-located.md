# D18 — The WORKS tripwire, reproduced and located

*2026-07-26. The `state_hash` tripwire has blocked "teach the heuristic cast to build a WORKS" for the
whole project, with four causes ruled out and no diagnosis. It now has a one-line reproduction and a
named mechanism. It is **not fixed** — this records how to reach it and what it actually is, because
the previous attempts failed on invalid harnesses rather than on the bug.*

---

## The reproduction, which is now one branch

Add a `build {kind: WORKS}` branch to `HeuristicCast.decide` — gated on
`worksQuote(...).affordable && !alreadyHeld`, placed above the `fill_role`/`create` branches — and
**six tests fail immediately**, all in the adoption path:

```
test/durability/checkpoint-adoption-audit.test.ts  (3)
test/durability/…rules-change…                     (2)
test/…assurance…                                   (1)
```

Every one with the same error, from `src/persist/boot.ts:472`:

> **TRIPWIRE at tick 300: replayed state_hash `8198caa6…` does not match the journalled snapshot
> `b89e395b…`. The record and this build disagree, so the world is NOT resumed and must not accept
> writes.**

That is a deterministic, four-minute reproduction of a blocker that previously took a full session to
fail to find.

## What it actually is, and why the earlier hunt missed it

**Replay is cast-independent.** §15.1 is explicit: `(snapshot, action_log, seed) → snapshot`, and
*"events are output, not input"*. So a new heuristic branch cannot change what replay does by
*deciding* differently — replay does not consult the cast at all. It replays the action log.

Therefore the divergence is not in the decision. **Replaying a `build {WORKS}` action produces a
different state than applying it did.** That is a determinism bug in the WORKS build path itself, and
it explains the one fact that made this so confusing: the tripwire only ever appeared once a WORKS
existed, and no amount of examining the *cast* was ever going to find it.

Four causes were ruled out earlier (the checkpoint manifest, table registration, adoption hydration,
and the append-only guard) — all of them about whether the WORKS *book* survives. It does: **19 of 19
tables round-trip with an identical `state_hash` in a world with a WORKS built and spun up**, which I
measured before touching the cast. The book is fine. The *replay of the build action* is not.

## Where to look, in order

1. **`vBuildWorks`'s use of the tick.** A build that reads anything phase- or tick-derived at apply
   time and recomputes it at replay time will diverge. `WORKS_SPINUP_TICKS` is a constant, but the
   *online-at* tick is derived — check whether it is stored or recomputed.
2. **Iteration order in `Book.sharesAt`.** The yield split uses `largestRemainder` across occupants;
   if the occupant list is built from a `Map` whose insertion order differs between apply and replay,
   the split lands on different holders for the same total. DET-6 bans exactly this class.
3. **The goods destroyed into the build.** `WORKS_BUILD_QTY` comes out of lots at a system, and lot
   selection order decides *which* lots are consumed. If that order is insertion-dependent rather than
   `compareIds`-sorted, apply and replay pick different lots — same quantity, different lot ids, and
   the lot table hashes differently. **This is the most likely of the three**, and today's
   `lotsInAccount` index change is worth re-reading with it in mind: the index returns
   `compareIds`-sorted ids and is differentially tested against the old scan, so it should be
   equivalent — but it is a lot-ordering change made the same day, and that coincidence deserves
   checking before anything else.

## All three candidates ELIMINATED — and the real suspect is the cast, not the build

Checked each with direct evidence rather than reasoning:

| candidate | verdict |
|---|---|
| the online-at tick recomputed at replay | **stored.** `WorksBook.raise` writes `onlineAtTick: args.tick + WORKS_SPINUP_TICKS` into the row |
| occupant order in `sharesAt`'s split | **sorted.** `liveAt` ends `.sort((a, b) => compareIds(a.id, b.id))`, and `splitQty` walks that order |
| lot selection order for the burned goods | **double-sorted.** `burnAnchorGoods` iterates `chargeGoodLotsAt`, which itself ends `.sort((a, b) => compareIds(a.id, b.id))` — and today's `lotsInAccount` index also returns `compareIds` order, so the same-day change is eliminated too |

**So the WORKS build path is deterministic**, and the divergence is not in it. Which reframes the whole
thing, because the tripwire still only appears when the *cast* gains a build branch.

**New leading hypothesis: an early-returning branch shifts the shared RNG stream.** The branch I added
returns as soon as a member can afford a WORKS — *before* reaching
`rng.chance(appetite, 10_000)` in the `create` branch. If the cast draws from one stream across
members in roster order, then a member that returns early **does not consume its draw**, and every
member decided after it sees a different stream position. That changes what the whole cast does from
that tick onward.

That would explain every observation: the WORKS path is clean, the divergence needs a *cast* change to
appear, and it shows up as a genesis-replay mismatch rather than a capture/restore one — because
capture/restore never re-runs the cast, and genesis replay of these tests does.

**How to settle it in one run:** log the RNG draw count per tick with and without the branch. If they
diverge from the first tick a member could afford a WORKS, it is the stream and the fix is to draw
*before* branching (or give the branch its own labelled sub-stream via `Rng.derive`, which is the
pattern `world/map.ts` already uses so that adding a consumer cannot re-wire existing draws).

**If that is right, this is not a WORKS bug at all** — it is a latent hazard in the heuristic cast that
*any* new branch would trip, and the WORKS branch merely happened to be the first one added since the
tests were written. That is a much more important finding than a faucet fix, because it means the cast
cannot be extended safely today.

## What this unblocks, and why it matters more than it looks

The heuristic never building is why **`worksLines` has been empty on every frame ever published** —
the economy's mechanic has never rendered at all, so A13 is unproven for the only system that makes
goods. It is also the confound D17 names: measuring whether the LLM cast will build is much weaker in
a world where nobody has ever built one and no `worksLines` have ever appeared on a frame.

So this single bug sits underneath: A13 for the economy, D17's behavioural measurement, and the
`levyShort: 345,588`-and-climbing drawdown.

## The honest state

The branch is **reverted** — a six-test failure is not something to leave in the tree, and the fix is
in the build path rather than in the cast. Reproducing it costs one branch and four minutes, so the
next attempt starts from a failing test rather than from a search.

And one methodological note worth more than the finding: the four previously ruled-out causes were all
about the WORKS *book*, because the tripwire *looked* like a persistence problem. It is a **replay**
problem. Those are different subsystems, and "state_hash diverges after adoption" reads as the first
when it was always the second.
