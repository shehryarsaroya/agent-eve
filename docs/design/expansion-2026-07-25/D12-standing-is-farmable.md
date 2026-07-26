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

## The method note

Three of today's findings came from one question: *what does this check NOT check?* The seal band
(inverted refused, everything-band not), the Levy's territorial duty (`missesAt` by system, `owingOf`
by claim), and this one. In each case a name asserted a property — "anti-farm", "contradicted by
construction", "a transfer never resets the arrears" — that the code beside it did not implement.

**A name is not an implementation, and a doc comment is the easiest place in a codebase to state a
guarantee nobody wrote.** Grepping for the strongest claims and then reading only the code they sit on
top of has now found three real exploits in one day.
