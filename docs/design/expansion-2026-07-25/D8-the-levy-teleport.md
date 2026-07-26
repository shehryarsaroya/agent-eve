# D8 — CORRECTED: the Levy does not teleport hauling; it compresses cargo carriage

*2026-07-25. **This document originally claimed hauling was optional. That was wrong, and the error
was mine.** The correction and what it cost are kept in full below, because the mistake is more
instructive than the finding.*

---

## What I originally wrote, and why it was wrong

I read `Runtime.levyGoodLots` — which filters on good, lien and state but **not** on location — saw
`consumeLevyGood` call `ledger.relocate(lot.id, { location: args.place })`, and concluded that the
Levy could be paid with goods sitting anywhere in the galaxy, so "hauling is currently voluntary
work". I then wrote **"do not build the Charge on the current path"** on the strength of it.

I did not read the function's own header, or the verb that calls it.

## What is actually enforced

`vDeliver` → `deliveryFault` refuses the delivery unless a hand is physically there:

```
carrierAt(world, deliverer, place, tick) === null
  → "a Levy is paid in goods physically delivered, so one of your hands has to be
     standing at {place}. Move a hand there — or set a delivery intent, which fires
     the moment one arrives."
```

And part of the assessment — `presenceOwed`, the non-escrowable share PROP-LV3 turns on — can only
be discharged by the payer's **own** hand, not a delivery service's. That is the anti-Coase-collapse
mechanism, and it is the strongest presence requirement in the game.

So the logistics cost is real and enforced: **a hand must travel and be standing at the delivery
place**, and for part of the duty it must be *your* hand.

## What is genuinely compressed, and why

Only the **cargo carriage**. The goods are treated as riding with the hand rather than being tracked
as an independently-located consignment in transit — which is why the lot is relocated at the moment
of payment, so that the consumption is *posted at the place it happened* rather than at the payer's
holding. §10.2 says everything is located; a destruction recorded at the holding while the hand stood
at the berth would be a located fact that was false.

The reason is stated in the module header rather than hidden: **`haul` is §16 step 11 and does not
exist.** Until there is a verb that puts a consignment on a hand and moves it, there is nothing for
the engine to check except presence — and, as the header notes, §5.2 and PROP-LV3 both turn on
presence rather than payment, "so the compression costs the mechanic nothing it depends on."

The header even labels itself: *"it is the one place this module is thinner than the fiction."*

## The residual, stated honestly

There is a real gap, and it is much smaller than I claimed: **goods cannot be intercepted in
transit**, because they are not in transit — the hand is. So a convoy carrying Levy goods cannot be
raided for its cargo before it arrives, and cargo-as-loot does not exist for this path.

That matters for predation and for the Charge, but it is a **missing feature pending `haul`**, not a
loophole in the Levy. It closes when §16 step 11 lands, and closing it is additive: give the
consignment its own located existence, then drop the relocate because the goods will already be
where the hand is.

## Consequences for the expansion design

- **The Charge is NOT blocked.** My earlier "do not build the Charge on the current path" was based
  on the misreading and is withdrawn. A Charge built on this path inherits an enforced presence
  requirement, which is the property the sovereignty design actually needs — "the world must
  physically supply this system" is satisfied by a hand having to stand there with the goods.
- **What the Charge should wait for is `haul`,** if and only if we want the *interception* story —
  starving a claim by raiding its convoy. That is a genuinely good story and an argument for
  sequencing `haul` before the Charge, but it is an argument about ambition, not about correctness.
- The economic critic's S0 ("current Levy plumbing would teleport Charge goods") is best read as a
  warning about the *cargo* half specifically, and it is right about that much.

## The method note, which is the real finding

This is the **second** time today I amplified an outside critique without checking it, and the
pattern is identical to the fable persistence claim: a reviewer described a mechanism, the shape of
the code was consistent with the description, and I confirmed it by reading the one function that
looked wrong rather than the caller that constrained it.

**A missing filter is not a missing rule.** The check I skipped — "who calls this, and what do they
require first?" — is two greps, and it is the same class of omission as the truncated `head` and
`tail -1`: a verification that cannot see the thing that would refute it.
