# D18 — The WORKS tripwire: SOLVED. No engine bug; a fixture reaches past the API

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

## First reading (WRONG — kept because the reasoning was sound and the premise was not)

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

## The three candidates that first reading produced — all since eliminated (see below)

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

## RESOLVED: it is not a bug. The tests are fixtures whose premise a cast change moves.

Third framing, and this one holds up. Two reads settled it:

**1. The cast's RNG is derived per member per tick.** `heuristic.ts:214`:
`Rng.fromSeed(\`${seed}:cast:${member.principal}:${String(tick)}\`)`. So a member returning early cannot
shift any other member's stream, and stream position is a pure function of `(seed, principal, tick)` —
identical in apply and in replay. **The RNG-stream hypothesis is dead**, and the derivation is the DET
discipline done correctly.

**2. The failing tests build a SPECIFIC world on purpose, and say so.** From
`checkpoint-adoption-audit.test.ts`'s own header:

> *"measured on that very run it proves nothing: the heuristic cast opens **zero** encumbrances that are
> still open at a tick boundary (0 across 420 ticks and 60 snapshots), so every snapshot it adopts has an
> empty lock book and an empty book restores correctly whether or not the capture works. … So this file
> **forces the case**: raid-shaped stakes, a live obligation behind them, a journalled snapshot taken
> while they are open."*

The test exists *because* the heuristic's natural behaviour made the original claim vacuous. It
constructs a precise world, journals it, and adopts it. **A new cast branch changes what the cast does at
those ticks, so the constructed world is no longer the one the fixture was built around** — and the
tripwire fires because the premise moved, not because replay is non-deterministic.

**So there is no determinism bug, and there never was.** What exists is a set of adoption fixtures
coupled to exact heuristic behaviour. That is a real fragility and it deserves fixing — a fixture that
breaks whenever the cast is extended is a brake on extending the cast — but it is a *test-design*
problem, not an engine one, and the fix is to make those fixtures construct their world without
depending on what the cast happens to do.

**Which means "teach the cast to build a WORKS" is not blocked by anything in the engine.** It is blocked
by six fixtures that need decoupling first. That is a much smaller and much more tractable statement than
the one this file opened with.

### The exact coupling, so the decoupling is mechanical

The fixture **injects locks directly into the world**, before the cast acts and outside the action log:

```
encumbrances.lock({ tick, principal: p, account: storesAccount(p),
                    amountMinor: amount, obligationRef: `raid:audit:${p}`, maxDirectLoss: amount })
```

and the injection is **conditional on the principal's state** — it needs free balance to lock against. A
WORKS build spends 60,000, so with the branch in place a different set of principals qualifies, a
different set of locks is injected, and the world the fixture constructs is not the world it journalled.
Hence a hash mismatch with no determinism fault anywhere.

**So part of the decoupling is:** make the injected stake a fixed amount rather than
`freeStores(ledger, p) / 4`. That fraction couples the fixture to a balance the cast can move — a
`build {WORKS}` costs 60,000 — so the locked amount changes and the constructed world stops matching the
journalled one. **Done** (with an assertion that the fixed stake is still lockable, so a future
endowment change fails loudly here rather than silently locking nothing). The principal *selection* was
already cast-independent: sorted `principalOrder`, first two.

### ⚑ AND IT WAS NOT SUFFICIENT — I called this "mechanical" and it is not

With the stake fixed, I re-added the build branch and **the same six tests still fail**. So the stake
fraction was a real coupling and there is **at least one more** that I have not found.

What that eliminates, and it is worth having: the divergence is not the *locked amount*. What remains
unexamined:

- **the adopt-plus-tail replay itself.** `bootFromStore` replays from the last snapshot forward. If the
  tail replay re-runs the cast rather than the action log, and any phase ordering differs between the
  live run and the tail, a build lands at a different point. This is the first thing to instrument —
  print the action log for the divergent tick on both sides and diff it.
- **whether the build's currency retirement interacts with the injected obligation.** The fixture opens
  `raid:audit:<p>` obligations and locks against them; a build retires 60,000 from the same stores
  account. INV-4 ties open locks to live obligations, and the two now touch the same balance.
- **snapshot timing.** `SNAPSHOT_EVERY` and `LOCK_AT` are fixed ticks; a build shifts *when* other
  actions become affordable, so a snapshot may be taken at a different world state even with the same
  action set.

### The next attempt should start here (and one false claim I nearly published)

I grepped `src/persist/` for `actionLog`, found nothing, and was one commit away from recording that
**the action log is never persisted** — which would have been a false architectural claim about the
design's third write artifact. It **is** persisted, as `TickRecord.actions`; `store.ts:18` calls it
*"the action log — replay's second term"* and imports `LoggedAction`. My grep missed it on naming. Fifth
wrong framing in this thread, and the first one caught before it reached a document.

So replay **is** action-log-driven and cast-independent, which sharpens the real question:

**The fixture's setup is not in the action log.** It calls `runtime.obligations.open(...)` and
`runtime.ledger.encumbrances.lock(...)` **directly on the runtime** — those are mutations, not
submitted actions, so no action-log replay can ever reproduce them. The journalled snapshot at tick 300
therefore contains locks that a genesis replay of the same journal cannot recreate.

Which means the test only passes today because **adoption normally succeeds** — it loads the snapshot
rather than replaying from genesis, so the unreproducible locks are never re-derived. The failing tests
include *"a rules change forces the slow path"*, and the slow path is exactly genesis replay. **So the
question is not "why does a build diverge" but "why does adding a build branch push these tests onto the
slow path".** That is a much better-shaped question and it is where the next attempt should start:
instrument `planCheckpoint`'s decision and print why adoption was refused with the branch present.

### ⚑ THE DECISIVE OBSERVATION: the replay does not contain the build

Stopped hypothesising and compared two runs. With the build branch present, before and after the stake
fix:

```
replayed  state_hash   8198caa6…  →  8198caa6…      IDENTICAL
journalled snapshot    b89e395b…  →  e38126c0…      MOVED
```

**The replayed hash is invariant while the journalled snapshot tracks the fixture change.** If the
replay reflected the build, its hash would have moved too — the stake change alters balances, which
alters what a build costs and when it is affordable. It did not move. So **the replay is producing a
world as though no WORKS was built.**

That reframes the blocker one final time, and this reading is grounded in measurement rather than
inference: the question is not *"why does the build diverge on replay"* but **"why is the build missing
from the replay at all."** Two candidates, and both are checkable without a hypothesis:

1. **The `build` action never reaches the action log.** Print `TickRecord.actions` for the tick the
   build was submitted. If `build` is absent while `create`/`fill_role` are present, that is a
   journalling gap on one verb and a serious one — an action that cannot be replayed breaks
   `(snapshot, action_log, seed) → snapshot` for any world containing it.
2. **The action log has it and replay skips it.** Then the verb is missing from whatever table the
   replay path dispatches through, which would be a registration gap rather than a determinism fault.

Either way it is a **one-verb** problem, not a WORKS-mechanics problem and not a fixture problem — and
the fixture's stake coupling (fixed above) was a real but separate issue that happened to move the
journalled hash and make the two effects look like one.

### The filter is located: `extract.ts:79`

The persisted action log is **not** every submitted action. `persist/extract.ts:74-80`:

```ts
const actions = runtime.engine.log
  .forTick(tick)
  // Submitted only. A null arrival ordinal marks an engine-produced intent run,
  // which the snapshot's standing intents regenerate on replay — storing it would
  // replay it twice (`replay.ts` skips exactly this).
  .filter((a) => a.arrivalOrdinal !== null)
```

`arrivalOrdinal` is passed through from the submitted action (`tick/loop.ts:1020`) and set to `null`
only for engine-produced intent runs (`:1055`). So **whether an in-process cast action survives this
filter depends entirely on what the cast puts in that field** — and the heuristic's returned action
shape (`{ ...base, verb, params }`) does not visibly set it.

**The one-line check that closes this:** for the tick a build was submitted, print
`runtime.engine.log.forTick(tick)` alongside the filtered `actions` array that `extractTick` produces.
If the `build` is in the first and not the second, the filter is eating it and the fix is one predicate.
If it is in both, the loss is downstream in `replay.ts` — which the comment above says "skips exactly
this", so that skip is the next thing to read.

Note the asymmetry that makes this worth checking rather than assuming: `undefined !== null` is `true`
in JS, so an action that simply never sets the field **passes** the filter. It would take an explicit
`null` to be dropped. That cuts against the hypothesis and is exactly why it needs the print rather than
another round of reading.

### The filter is EXONERATED, and the next link is located

Ran the print. At the tick a build was submitted:

```
raw log entries for that tick    7
surviving the extract.ts filter  7
build in RAW log                 1   arrivalOrdinal=6
build SURVIVES the filter        1
```

**The build is in the persisted action log.** The filter drops nothing — as the `undefined !== null`
asymmetry predicted it would not. Sixth framing eliminated, and this one was eliminated by the check I
wrote *because* I had noted the evidence cut against it.

**The next link, located:** `boot.ts:509-524` reconstructs a `SubmittedAction` from each logged action
to resubmit it. It copies `principal`, `verb`, `params`, `clientSequence`, `arrivalMs`,
`decisionSource`, `priority`, `idempotencyKey`, `actedOnStateVersion` — and **not `arrivalOrdinal`**.
That is the one field provably present on the original tick and absent on its replay.

`CLAUDE.md` §6 says ordering is `(priority, principal_id, client_sequence)`, *"never arrival"*, so this
*should* be harmless. Two reasons to check rather than accept that:

1. Every "should" in this thread has been wrong six times.
2. `arrivalOrdinal` is the field the extractor and the replay guard both key on, so it is load-bearing
   for *something* — and a field that is load-bearing for one purpose and absent on replay is worth one
   grep.

**The check:** `grep -rn arrivalOrdinal src/` and read every consumer. If anything orders, dedupes, or
tie-breaks on it, that is the divergence. If nothing does, the divergence is elsewhere and this thread
has eliminated seven candidates — which is itself worth having, because the remaining surface is small.

### `arrivalOrdinal` is exonerated too — seventh candidate out

Ran the grep. Three facts settle it:

- **`tick/queue.ts:270`** assigns `arrivalOrdinal: this.arrivals` at enqueue time. So boot's
  resubmission does not produce a *missing* ordinal — the queue mints a fresh one. The field being
  absent from the reconstruction is therefore invisible downstream.
- **`tick/halt.ts:93`** states it directly: *"`arrivalMs` and `arrivalOrdinal` are kept in the triple
  even though nothing reads"* them.
- **`tick/actionLog.ts:155`** is the only real consumer — the **A4 audit**, counting
  `arrivalOrdinal > resolutionOrdinal` disagreements so that arrival order never becomes power. And the
  action log is **not** a registered state table (the 19 in the INV-26 map do not include it), so that
  count never reaches `state_hash`.

Dropping it on replay is harmless. **Seven candidates eliminated.**

### What this thread actually achieved, and where it stops

Seven framings, each closed by evidence rather than argument:

| # | framing | eliminated by |
|---|---|---|
| 1–4 | the WORKS **book** doesn't survive adoption | 19/19 tables round-trip with identical `state_hash` |
| 5 | the **build path** is non-deterministic | all three ordering candidates `compareIds`-sorted |
| 6 | an early branch shifts the **RNG stream** | RNG derived per member per tick |
| 7 | the **fixture stake** couples to balances | real, fixed — and insufficient |
| 8 | the **action log isn't persisted** | false; caught before publishing |
| 9 | the **extract filter** eats the build | print: 7 of 7 survive, `arrivalOrdinal=6` |
| 10 | **`arrivalOrdinal`** dropped on replay | queue-assigned, unread, unhashed |

And one measurement that outweighs all of them: **the replayed hash is invariant (`8198caa6`) while the
journalled snapshot moves.** Whatever the cause is, it makes replay produce a world *as if no cast
action after some point applied at all* — that hash not moving when the fixture changed is the strongest
single clue in the file and it has not yet been explained by anything eliminated above.

**So the next session should start from that invariance, not from a new candidate.** Concretely: print
the replayed world's venture/works counts at tick 300 beside the journalled world's. If the replayed
world is *sparse* rather than merely *different*, the loss is wholesale and early — which is a different
search than a single verb going missing, and every candidate above assumed the latter.

## ✅ SOLVED — replay is sound; the fixture's setup is not replayable

The measurement that closes it. A 120-tick cast-driven world, journalled, then **fully replayed from
genesis** into a fresh runtime with adoption forced off:

```
LIVE     tick 119  ventures 23  hash 6e3a28fe…
REPLAYED tick 119  ventures 23  hash 6e3a28fe…      ticksReplayed 120, adoptedAtTick null
MATCH
```

**Genesis replay is faithful.** It reproduces a cast-driven world exactly — every cast action, the
right venture count, an identical `state_hash`. So replay is not lossy, not sparse, and not
verb-selective, and the eighth reframe ("the loss is wholesale and early") is wrong too.

### Which makes the invariant hash explain itself

`8198caa6` was invariant across my stake change because it is **the genesis replay of the action log,
and the fixture's locks were never in the action log.** The audit test creates them by calling
`runtime.obligations.open(...)` and `runtime.ledger.encumbrances.lock(...)` **directly on the runtime** —
those are mutations, not submitted actions. So:

- the **journalled snapshot** contains the locks → its hash moved when I changed the stake;
- the **genesis replay** never sees them → its hash could not move, whatever the stake was.

Two observations, one cause. That invariance was the whole answer and I read it three different wrong
ways before measuring the thing it was actually about.

### Why the test passes today and fails with a cast branch

Normal run: `adoptedAtTick = TICKS - 1`, `ticksReplayed = 0`. **Adoption succeeds, so no genesis replay
happens and no comparison is ever made** — the unreproducible locks are simply loaded from the snapshot.
Add a cast branch and something pushes these cases onto the verify-or-replay path, at which point the
locks cannot be reconstructed and the tripwire fires. Correctly: the tripwire is doing exactly its job,
refusing to resume a world the record and the build disagree about.

### The fix, and it is a test fix

**Make the fixture's setup go through the action log** — submit the stake as an action rather than
mutating the runtime — so genesis replay can reproduce it. Then the fixture works on both paths and a
cast change cannot break it.

If that is impractical (there may be no verb that opens a bare obligation with a lock behind it, which
is *why* the fixture reaches past the API), the alternative is to **assert only the adoption path and
skip the genesis comparison explicitly**, with a comment saying the setup is deliberately
non-replayable. That is honest and keeps the test's real purpose — proving locks survive *adoption* —
which never needed genesis replay to be meaningful.

**Either way: no engine bug. The engine has been correct throughout.** Nine framings, eight wrong, and
the one that held is a test whose setup reaches around the interface it is testing through.

### ⚠ One caveat on this solution, stated rather than glossed

**Two of the six failing tests deliberately force the genesis path** — *"a rules change forces the slow
path, because adoption re-derives nothing"* — and they **pass today**. If the injected locks were simply
unreproducible on genesis replay, those two would fail already, with or without a cast branch. They do
not.

So the locks are probably reconstructed on the genesis path after all — most likely from the
**persisted postings**, which `store.ts` lists as the third write artifact and which
`hydrateLedgerForSnapshot` exists to read. A `lock` moves value, so it leaves postings, and postings are
durable.

That means the account above is **incomplete, not wrong**: replay is sound (measured), the invariant
hash is explained (measured), and the fixture's setup does bypass the action log (read). What is not yet
established is *why* that bypass is harmless today and harmful with a cast branch. The likely shape:
the locks are rebuilt from postings, but a build's own postings shift the batch sequence those locks are
reconstructed from — so the reconstruction lands differently rather than not at all.

**The check:** print the encumbrance rows in the genesis-replayed world with and without the branch. If
both worlds have the locks but with different ids or batch indices, it is a reconstruction-ordering
problem inside the ledger hydrate, not a missing-input problem — and that is a different fix from either
of the two proposed above.

I am recording this rather than pursuing it because the honest state of a nine-framing investigation is
"measured what I measured, and here is the seam I did not close."

### ⚑ THE CAVEAT ABOVE IS WRONG — the seam is closed, and the withdrawal was the overcorrection

Ran the print. Injected two locks at tick 40 into a cast-driven world, journalled it, forced a genesis
replay — **with no build branch at all** — and boot threw:

```
BootError … operatorInstruction: 'COMPACT_ACCEPT_DIVERGENCE_AT_TICK=40'
```

**Divergence at tick 40, which is exactly the injection tick, with no cast change involved.** So the
injected locks *are* unreproducible on genesis replay, measured directly. The original account was
correct.

And the inference that made me withdraw it was wrong. I reasoned: *the two slow-path tests pass, so the
locks must be reconstructible.* They pass because **neither of them completes a genesis replay to a hash
comparison** — one asserts `planCheckpoint` *refuses* on a rules change (which happens before any
replay), the other asserts what an adopted boot verifies. Neither reaches the tripwire. And the test
does not use `acceptDivergenceFromTick`; only `boot.ts` defines it.

So the count is now **ten framings, nine wrong** — and the tenth error was *withdrawing a correct
answer* on an untested assumption about what two tests do. That is a new failure mode for this thread:
every previous one was over-confidence, and this one was over-correction. Both came from the same
habit — reasoning about code instead of running it — and the fix was the same one print.

**The conclusion stands:** no engine bug; replay is faithful; the audit fixture's setup bypasses the
action log and cannot be genesis-replayed; adoption normally hides that because it never replays; and a
cast branch exposes it by pushing the case onto a path the fixture was never able to survive. The
remedies proposed above are the right ones.

### The one question left, and the fact that frames it

**Why does a cast branch push these cases onto the genesis path at all?** The failing test passes
`requiredTables: registeredTables(adopted)`, which is satisfied, and the rules version is unchanged — so
`planCheckpoint` should return a snapshot and boot should adopt with `ticksReplayed: 0`, never replaying.
With the branch it replays anyway.

**The framing fact,** from `boot.ts:360-372`: boot builds `snapByTick` from `store.snapshotHashes()` and
then, while replaying, compares its replayed hash against **every snapshot hash it passes** — that is
what `tripwiresChecked` counts. So the tick-300 tripwire is the snapshot at 300 being checked against a
genesis replay that reached it. This confirms the failing case is on the genesis path rather than the
adoption path, which is what makes "why was adoption refused" the whole remaining question.

**The measurement:** call `planCheckpoint` on two stores — one built with a build in the world, one
without — and print `refusal` and `snapshot.tick` for each. Mind the signature; my first attempt at this
passed the wrong argument shape and threw inside `hydrate.ts`, which is why this is written as a note
rather than an answer.

**Do not trust the word "mechanical" in the section above.** I wrote it after finding one coupling and
before testing whether it was the only one, which is the same mistake this file already records twice —
the fourth framing in a row where I found a plausible cause and stopped looking. The fixture fix is kept
because it is a genuine improvement (a fixture should not depend on incidental balances), but the blocker
stands.

And note what this vindicates: the test was **right** to force the case. Its header says the original
claim was vacuous because the heuristic opens zero qualifying encumbrances, and it is. The fixture is
doing necessary work in a way that happens to be brittle.

## What this unblocks, and why it matters more than it looks

The heuristic never building is why **`worksLines` has been empty on every frame ever published** —
the economy's mechanic has never rendered at all, so A13 is unproven for the only system that makes
goods. It is also the confound D17 names: measuring whether the LLM cast will build is much weaker in
a world where nobody has ever built one and no `worksLines` have ever appeared on a frame.

So this single bug sits underneath: A13 for the economy, D17's behavioural measurement, and the
`levyShort: 345,588`-and-climbing drawdown.

## The honest state

The branch is **reverted** — a six-test failure is not something to leave in the tree. Reproducing it
costs one branch and four minutes, so the next attempt starts from a failing test rather than a search,
and it should start by counting RNG draws per tick with and without the branch.

**Read this file in order, because it records two wrong turns.** The first reading (above) argued the
divergence had to be in the WORKS build path, on the sound premise that replay is cast-independent. The
three candidates it produced were each checked and each clean — so the premise was right and the
inference from it was wrong, which usually means the premise does not apply to the *test* rather than to
the engine. These tests replay from genesis in a way that does re-run the cast.

Two methodological notes, both worth more than the finding:

1. **The four originally ruled-out causes were all about the WORKS *book*, because the tripwire *looked*
   like a persistence problem.** Then my three were all about the WORKS *build*, because it looked like a
   replay problem. Both framings were reading the symptom's location as the cause's location. The
   symptom appears when a WORKS exists; the cause is most likely in what *adding any cast branch* does
   to a shared RNG stream.
2. **If that is right, "teach the cast to build a WORKS" was never the blocked thing.** Extending the
   cast *at all* is blocked, and the WORKS branch was simply the first extension anyone tried since
   these tests were written. D19's proposed ordering change would have hit the identical wall — which is
   exactly why D19 says to wait for this.
