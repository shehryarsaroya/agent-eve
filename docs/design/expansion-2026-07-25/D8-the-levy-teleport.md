# D8 — the Levy teleports goods, so hauling is currently optional

*2026-07-25. Flagged by the economic critic as an S0 the Charge would inherit; confirmed as a
**live defect in the shipped Levy**, not just a future risk. Not fixed, because the fix must land
with a second change or it defaults the entire world at once. Recorded like D7.*

---

## The defect

`Runtime.consumeLevyGood` selects lots with `levyGoodLots(principal)`, which filters on good, lien
and state — **and never on location** — then does this:

```ts
this.ledger.relocate(lot.id, { location: args.place });   // teleport
this.ledger.destroyGoods({ ... });                        // then consume
```

So a lot sitting anywhere in the galaxy is **moved to the delivery place at the instant of payment**
and consumed there. Location is *assigned* by the payment rather than *required* by it.

§5.2 says the Levy is payable only in **located** goods delivered to `deliverableTo`. As built, that
sentence is not enforced anywhere: the goods are always located, just not until you need them to be.

## Why it matters more than it looks

1. **It deletes hauling as gameplay.** Moving goods to where they are owed is the entire logistics
   loop. If payment relocates for free, a hand that spends four ticks carrying rations is doing
   voluntary work.
2. **It is the premise of the sovereignty design.** DRAFT-2 argues the Charge should be denominated
   in hauled goods precisely so that *logistics is the political game*. Built on this path, the
   Charge would inherit the teleport and the whole argument evaporates — which is exactly the S0 the
   critic named.
3. **It hides a real economic constraint.** Nobody has ever had to be in the right place with the
   right goods, so no agent has had to plan for it and no test has exercised it.

## Why it is not a one-line fix

`deliverableTo` is **one place per constellation** (`levy/cycle.ts`), while principals are seated
across that constellation's systems and their starter allotment is minted **at their own holding's
system**. So the moment lot selection is restricted to `lot.location === place`:

- every principal not seated at the delivery place is instantly short;
- the heuristic cast does not haul toward the Levy, so it stays short;
- `LEVY SHORT` rises across the board and the sweep fires on principals that were paying fine
  yesterday.

Those defaults would be *true* — they really did fail to deliver — so this is not an A5′ fabrication.
But it is a rules change landed under a population that was never told, and the resulting mass
default would be an artifact of the change rather than a story about anyone's conduct.

## What has to land together

1. **Location-strict consumption** — `levyGoodLots(principal, at)` filters on `lot.location === at`,
   and `consumeLevyGood` stops calling `relocate`.
2. **A location-aware affordance** — `levyGoodAvailable` must answer "how much can I pay *at the
   delivery place*", not "how much do I own anywhere". It is already public precisely so an agent can
   see this before committing a hand to a journey; today it answers the wrong question.
3. **A cast that hauls** — the heuristic cast needs to move the levy good toward `deliverableTo`
   before the freeze, or the house cast defaults every night by construction.
4. **`agent.md`** — the player contract must say goods must *be there*. It is a rules surface.
5. **`RULES_VERSION`** — this changes what a past tick computes, so it bumps, and the live world
   crosses through the operator door as the keystone did.

## Suggested sequencing

Land it with the **PRODUCE** phase or immediately after, so a principal that has hauled its stock out
can make more. Until then, a location-strict Levy plus a finite starter allotment plus no production
is a world that runs out and stays out.

**Do not build the Charge on the current path.** If the Charge ships before this is fixed it inherits
the teleport, and the sovereignty design's central claim — that logistics *is* the political game —
becomes decorative.
