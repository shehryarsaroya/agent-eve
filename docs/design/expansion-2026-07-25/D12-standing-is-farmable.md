# D12 — standing is farmable with free identities, and the code says it is not

*2026-07-26. Found by asking the question that found the seal exploit an hour earlier: **is the mirror
of this check present?** For the seal it was — a band nothing can land in was refused and a band
everything lands in was not. Here the check is not one-sided; it is absent, while the field names and
the doc comments assert it exists.*

*Written up rather than fixed, because the fix changes standing accrual, which is past-tick
computation — a `RULES_VERSION` bump and a declared generation boundary. Shipping that carelessly is
the A5′ failure this document is about.*

---

## The claim the code makes about itself

`core/types.ts`, on the standing row:

> **`distinctCounterparties`** — Count of distinct independently-capitalised counterparties. **The
> anti-farm term.**

`invariants/promises.ts`:

> the anti-farm term counts distinct **independently-capitalised** counterparties and self-dealing
> earns zero (scar #9)

Two names for a defence — *independently-capitalised*, *anti-farm* — and both are load-bearing in
§6.4's reading of what standing means.

## What the code actually does

`reckoning/standing.ts`, the accrual, in full:

```ts
const isNew = !seen.has(delta.counterparty);
seen.add(delta.counterparty);
// …
distinctCounterparties: row.distinctCounterparties + (isNew ? 1 : 0),
```

**There is no independence check.** The only thing excluded anywhere is self-dealing
(`counterparty !== principal`). A counterparty that is a free identity created five minutes ago,
funded by nothing, controlled by the same operator, counts exactly as much as a stranger who has
built its own capital.

## Why that is reachable rather than theoretical

Three mechanics line up, and each is individually correct:

1. **Filling a role is free.** `runtime.ts`: `stake: minor(readInt(req.params, ['stake',
   'stake_minor']) ?? 0)` — the stake **defaults to zero**, and `lockRoleStake` returns early on
   `stake <= 0`. So a principal with no capital at all can take a role.
2. **Enrolment is free and must stay free** (A15, and A8's floor depends on it).
3. **The elective half is paid at settlement, not by a verb**, so D7's `freeCash` withholding — which
   guards the market BID, the cession price and a syndicate stake — does not apply to it.

The loop:

```
operator creates a venture with an elective half
  → puppet fills the role (stake 0, costs nothing, needs nothing)
  → operator HONOURS the elective half, paying the puppet
  → operator gains electiveHonoured +1, electiveHonouredValue +N, distinctCounterparties +1
  → the puppet's money is now EARNED, so it is above D7's floor
  → puppet returns it through the market or a cession
```

Net cost to the operator: **zero.** Net gain: standing, on the permanent public record, in the one
column every other agent reads to decide whether to deal.

## Why this is the worst class of bug this project has

It is the same shape as the seal band-width exploit closed earlier today, and worse in degree. That
one let an agent be recorded as keeping a promise it never made. This one lets an agent be recorded as
having *a history of keeping promises to a diverse set of counterparties* — which is precisely,
exactly, the thing the game exists to measure.

A5′ says the record must never be **wrong**. §1 says the product is *"a record of who kept their word
— public, permanent, and visible on one living map."* If that record is farmable, the product is not
merely inaccurate; it is actively misleading every agent that relies on it, and we generated the
misleading part ourselves.

It also inverts A15. The axiom's letter is *"any gate priced in identities is unpriced"* — cost side.
Its spirit is that free identities must not be power, and a **reward** priced in identities is the
same failure with the sign flipped. A15's remedy is named: the flow graph *"may withhold credit, never
accuse."*

## The fix, and why it is not a one-liner

Withholding credit is the sanctioned move, so the diversity term should not count a counterparty that
is not independently capitalised. The cheap, deterministic proxy — computable at accrual time from
state the book already holds:

> **Count `P → C` toward `distinctCounterparties` only if `C` has at least one counterparty other
> than `P`.**

One map lookup (`counterparties.get(C)`), no new state, no graph walk. A puppet that only ever fills
its operator's roles has exactly one counterparty and never counts. An agent that deals across the
world counts immediately.

**Three things to settle before building it, and none is obvious:**

1. **A closed honest pair earns no diversity.** Two real agents who only ever deal with each other
   would stop accruing the term. That is arguably *correct* — it is a diversity term and a closed pair
   has no diversity — but it is a real change to what standing means, and it should be a decision
   rather than a side effect.
2. **Order dependence.** `C`'s second counterparty may arrive *after* `P → C` settled. Either the term
   is recomputed when that happens (retroactive, and standing is append-only) or it is counted late
   (a first honour that never counts even once the puppet becomes real). The second is simpler and
   the direction A15 prefers — withhold, do not accuse — but it must be stated.
3. **It changes past-tick computation**, so it needs a `RULES_VERSION` bump and the operator
   divergence door, on a live world at ~4,500 ticks. That is the same door sovereignty used; it is
   routine, but it is not free and it must not be waved through.

`electiveHonoured` and `electiveHonouredValue` are **deliberately left alone.** They are counts of
things that really happened — the operator really did pay — and rewriting them would be the record
lying in the other direction. The diversity term is the one that claims something about *whom* the
promises were to, and it is the only one making a claim that is false.

## ⚠ ATTEMPTED, REVERTED — and the attempt eliminated the obvious fix

*Added after implementing the proxy above and reverting it. The three "decisions to settle" were
not bureaucracy; the first attempt ran straight into one.*

I implemented exactly the rule proposed above — **count `P → C` only if `C` has dealt with somebody
other than `P`** — in both the live accrual and the restore path (which has to rebuild in journal
order, evaluating before adding, or a restored world holds a larger count than the live one and
INV-21 correctly halts it). Four tests went red, and one of them was the finding:

`books-in-the-hash.test.ts` has `p:a` crediting `p:b` and then `p:c` — two genuinely different
principals — and asserts a diversity of 2. Under my rule it is **0**, because `p:b` and `p:c` are
themselves leaves that never credited anyone.

**That is not the property the field claims.** The name is *independently-**capitalised***, and my
proxy tests *independently-**connected***. They are different, and the difference lands on the wrong
party: `p:a` did nothing wrong and cannot control whether its counterparties go on to deal elsewhere.
A real agent that hires a genuinely new principal would earn no diversity credit for it — the rule
punishes the honest crediting agent for somebody else's lack of breadth.

Worse, it is *gameable in the other direction*: two operators with puppet farms can cross-credit each
other's puppets once, making every puppet "connected" and restoring the farm at trivial cost.

**So the connectivity proxy is eliminated.** What is actually needed is capital provenance: *does `C`
hold value that did not come from `P`?* A puppet's capital is entirely its operator's; a real agent's
is not. That is a flow question, and the honest options are:

1. **Track inflow provenance per principal** — the direct answer, and real new state inside
   `state_hash`, which is the cost `ledger/endowment.ts` explicitly refused to pay for D7.
2. **Require the counterparty to have EXTRACTED** — production is the one way capital enters a
   principal without another principal handing it over (`GOODS_FAUCET.EXTRACTION`, and a WORKS costs
   earnings to raise). "Has this counterparty ever extracted?" is one book lookup, needs no new
   state, and a puppet farm cannot fake it without buying a WORKS per puppet out of *earned* money —
   which is precisely the cost D7 was designed to impose. **This is the most promising line.**
3. **Cap the diversity term's contribution to standing** rather than gating the count, so a farm
   raises a number that is worth little. Cheapest, and it dodges the question rather than answering it.

Option 2 also has the property the others lack: it makes the anti-farm term mean something an
operator must *pay the world* for, not something it must arrange socially.

## ⏳ SEQUENCING: option 2 is right and cannot ship yet — measured

Option 2 gates diversity on the counterparty having **extracted**, and the live world reports
`works: 0` with `worksAffordableBy: 2`. **Nobody has built a WORKS.** So shipping it today would set
every principal's diversity term to zero on the next genesis replay and make it unearnable until
production is adopted — a strictly worse record than the farmable one, because it would be wrong about
everybody rather than wrong about farmers.

**The anti-farm fix is therefore blocked on production adoption, not on design.** That is a real
sequencing constraint and it is the reason to hold: the gate is correct precisely *because* extraction
costs earned capital, and that pressure does not exist until agents are extracting. Watch `works` go
non-zero; the fix becomes shippable when it does.

## ★ WHY `works` IS 0, WHICH IS THE REAL BLOCKER — and it is not the agents

Chasing the sequencing constraint above found the cause, and it is mechanical rather than
behavioural. **The heuristic cast knows nothing of `build`, `graduate` or `post_bond`** — measured
as zero occurrences in `src/cast/heuristic.ts` — and it produces the overwhelming majority of
decisions in the live world: **1,957 HEURISTIC against 330 LIVE** in a 288-tick window, because the
twelve LLM members wake only every `DEFAULT_WAKE_GAP_TICKS` (18) and fall back to the heuristic in
between.

So **every system built on 2026-07-26 is reachable by twelve agents on a slow clock and by nobody
else**: WORKS, sovereignty, syndicates, offices. That is why `works: 0` with `worksAffordableBy: 2`,
why the frontier is empty, and why D12's fix is unshippable.

§15.6's clause is that heuristics exist so the world always does what the mechanic needs — *"heuristics
fill unfilled slots so ventures always resolve."* A world where goods never enter is the same failure
one system over.

**Attempted and reverted.** Teaching the heuristic to raise a WORKS when it can afford one (guarded on
`affordable`, placed after the mandatory sign/elect/seal/fill steps) worked and then tripped a
`state_hash` TRIPWIRE in `checkpoint-adoption-audit`: the replayed hash at tick 300 did not match the
journalled snapshot. Replay drives from the action log rather than re-deciding, so a heuristic change
should not affect it — which means the divergence has a cause I did not find, and a determinism
failure is the one class in this codebase that must never be shipped on a guess. Reverted.

It did earn its keep on the way: the same change exposed that `PRODUCE` was emitting a `PUBLIC` event
per WORKS **per tick** into the append-only record — 204 rows to 2,194 in one soak run — which is now
fixed, since A3 makes a durable intent's routine ticks free and the postings already carry the value.

**So the order of work is: diagnose that tripwire → teach the heuristic the new systems → watch
production adopt WORKS → then ship D12's extraction gate.** Each step unblocks the next, and the first
one is a determinism question rather than a design one.

### ⚠ THE TRIPWIRE: a real determinism bug in WORKS, with four causes ruled out

**It is not the fixture and it is not the heuristic.** `build {"kind":"WORKS"}` replayed from the
action log produces different state than when it ran live: `checkpoint-adoption-audit` reports
*"TRIPWIRE at tick 300: replayed state_hash … does not match the journalled snapshot"*. Sovereignty's
ANCHOR build shares most of that path, so **claims are likely affected too** and simply have never
been exercised under replay — nothing in the heuristic cast has ever built anything.

Ruled out, each by measurement:

1. **The world halting.** Eight WORKS build cleanly to tick 399 with no violations.
2. **The event-ledger flood.** `PRODUCE` was emitting a `PUBLIC` event per WORKS per tick and the
   event ledger is hashed state, so this was the leading hypothesis. Fixed separately (`ccfe439`) —
   **the tripwire persists**, so it was not the cause.
3. **Capture/restore of the works book.** Round-tripping every state table through its own
   `restore(capture())` leaves `state_hash` **identical** with eight WORKS present. Serialisation is
   sound.
4. **Lot-selection order in `burnAnchorGoods`.** `chargeGoodLotsAt` sorts by `compareIds(a.id, b.id)`
   — canonical, so the goods burned are the same in both runs.

**The remaining suspect, and where to start:** `vBuildWorks` **re-validates on replay**. It calls
`worksQuote` and gates on `affordable`, so any difference in free balance at that instant flips the
gate — the build succeeds live and is *refused* during replay, which diverges everything after it.
A verb whose re-execution can be refused is not replay-safe, and the fix is probably that a replayed
action must not re-run an affordability gate the live tick already passed. Check whether any other
verb has the same shape before fixing this one alone.

Reverted rather than shipped. A determinism failure is the one class in this codebase that must never
be shipped on a guess, and `state_hash` divergence on a live world at ~4,500 ticks means a boot that
refuses to resume.

## The deeper thing this exposed about D7's floor

Chasing the round trip surfaced something about `freeCash` that is worth stating separately, because it
is not specific to standing.

D7's floor is *"free balance above the starter stake"*, so **any inflow makes value transferable** —
including inflow the operator arranged. A puppet that receives an elective payment is instantly above
the floor and may send that money anywhere, which is what closes the farm's loop. The floor stops the
endowment leaving *directly*; it does not stop one round trip through any principal converting
endowment into "earned" money, because the floor cannot tell where an inflow came from.

That is the same missing fact — **capital provenance** — that option 1 above needed. Two independent
problems want the same primitive, which is usually the signal that the primitive is the real work:

> a per-principal record of how much value arrived from *outside the closure of principals it has paid*

Neither problem is worth building that for alone. Both together might be, and it belongs in the same
decision as option 1 rather than being discovered a third time.

## The method note

Three of today's findings came from one question: *what does this check NOT check?* The seal band
(inverted refused, everything-band not), the Levy's territorial duty (`missesAt` by system, `owingOf`
by claim), and this one. In each case a name asserted a property — "anti-farm", "contradicted by
construction", "a transfer never resets the arrears" — that the code beside it did not implement.

**A name is not an implementation, and a doc comment is the easiest place in a codebase to state a
guarantee nobody wrote.** Grepping for the strongest claims and then reading only the code they sit on
top of has now found three real exploits in one day.
