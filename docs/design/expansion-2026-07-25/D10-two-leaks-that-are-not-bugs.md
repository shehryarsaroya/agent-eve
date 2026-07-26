# D10 — two findings from sovereignty's adversarial pass that are design calls, not defects

*2026-07-26. Written while fixing four real bugs in the same pass (commit `a7bf5a0`). These two are
different in kind: nothing is broken, the engine does what it was told, and the question is whether
what it was told is right. Both are recorded rather than fixed because fixing either changes a rule,
and a rule change wants a decision, not a patch.*

---

## D10a — the world's raid targeting is a free scouting oracle

### What was measured

Two worlds identical except for **the claimant's hidden stores** produce different public event
streams. The divergence:

```
A: {"k":"raid.spawned","target":"p:mark","stage":"sys-06", …}
B: {"k":"raid.spawned","target":"p:mark","stage":"sys-05", …}
```

### Why it happens, and why it is not an A9 violation

`raid_schedule.rule` is published verbatim to every agent, and it says raids are aimed at *"the
principal with the most goods standing **outside the Commons**, breaking ties toward the one with
fewest present hands there."* So:

- **A9 parity holds.** Every agent reads the same raid feed the spectator does, at the same
  redaction. Nobody sees a fact an `observe` would not return. The invariant that governs this is
  satisfied, and `test/events/parity.test.ts` still proves it.
- **But the raid feed is an argmax over a `SENSED` quantity.** §11.2 gives `SENSED` to "cargo
  contents and hold values" — *a ship at sea is visible; its manifest is not.* Every spawn, the
  world announces which principal is holding the most goods outside the Commons, and **where**.

That is a strictly weaker leak than publishing hold values, and it is *derived from a published rule
rather than a private read* — but it is the same shape the `projection.ts` "fuel gauge" argument
rejected: a public formula applied to a private stockpile. It got in through the events, not the
frame, which is why the frame's guard did not catch it.

### The consequence for gameplay

Scouting is supposed to be work. If the raid feed reports the biggest hoard and its location every
spawn, an agent that wants to know where value sits does not scout — **it reads the news.** That
devalues exploration before exploration is built (`PASS-PROGRESSION-NEWCOMER` is Phase 0–1), and it
quietly rewards keeping goods *inside* the Commons, which cuts against the whole risk frontier the
`graduate` work exists to open.

### Three ways out, with what each costs

1. **Publish the target, withhold the stage.** A raid names *who* and the map shows motion when it
   arrives, but the staging system is not in `raid.spawned`. Cheapest, and it keeps A5's public loss
   intact — the loss is still published when it happens. Costs some pre-raid drama: the audience
   cannot watch a convoy race a countdown to a named place.
2. **Aim by rule but not by argmax.** Draw the target from a *seeded band* over principals outside
   the Commons, weighted by presence rather than stock. A14 only requires the clock be
   undodgeable, not that the aim be optimal. Removes the oracle entirely; costs the narrative
   cleanliness of "the world comes for the richest".
3. **Accept it and make it the point.** Declare that holding wealth outside the Commons is *loudly*
   visible, and let hiding value be a real strategic problem agents solve with structures and
   distribution. Costs nothing to build, and turns the leak into a mechanic — but it needs saying in
   §11.2, because right now the tier table implies the opposite.

**Leaning toward (1) as the minimum and (3) as the framing** — the stage is the part that turns "who
is rich" into "where their goods are", and it is the part §11.2 most clearly reserves. Not applied:
it changes an event's published shape, which is a canon edit.

---

## D10b — the endowment floor closes early-game territory trade harder than D7 intended

### What was measured

A principal that has crossed out of the Commons and posted a claim bond has a **transferable balance
of exactly zero**, and stays there until it earns more than the entire starter stake.

The arithmetic, from `ledger/endowment.ts` and a real run:

```
starter stake        250,000     (ENDOWMENT_FLOOR_MINOR is the same number, by design)
after graduate      -50,000  →  200,000
bond posted          50,000 locked → free balance 150,000
freeCash = max(0, 150,000 - 250,000) = 0
```

So a cession price — the one principal-to-principal transfer in sovereignty — cannot be paid at all
until income lifts the **free** balance clear of the **whole** floor, which for this principal means
earning over 100,000 before its first purchasable unit of currency exists.

### Why the engine is right and the outcome is still worth a look

This is `endowment.ts`'s own stated choice, and the reasoning is sound:

> *A principal that spends endowment on legitimate costs keeps the floor, so its transferable balance
> stays smaller than a perfectly-accounted version would allow. That is deliberate: for a Sybil
> guard, erring toward withholding is the safe direction, and the alternative is per-principal
> accounting inside the hash.*

Keeping it out of `state_hash` was the right call — the last thing added to the hashed capture
changed every tick's hash and needed a declared generation boundary.

But D7's objective was *"a sock puppet is worth exactly zero, and a real agent playing alone never
notices."* The second half is now false for one specific act: a genuine agent that graduated and
posted a bond **cannot buy a ceded claim**, however legitimately it came by its money, until it has
earned six figures. Cession is the *friendly* road into territory — the one that does not require
waiting for a CONTESTED window — and it is shut for exactly the newcomers it was meant to serve.

### Options

1. **Leave it.** Territory should not be bought with the faucet, and a newcomer buying a claim in its
   first hours is arguably wrong anyway. Zero work. Accepts that the cession market only opens
   mid-game.
2. **Amortise the floor against recorded endowment spend.** Track how much stake a principal has
   consumed on rule-fixed costs (graduation upkeep, bond, Charge) and lower its floor by that much.
   Exact and fair — and it puts per-principal state in the hash, which is the thing the file
   deliberately avoided. Real cost, and a generation boundary.
3. **Exempt rule-fixed costs from the floor instead.** Do not lower the floor; make graduation and
   bond draw from a notional "own work" bucket first, so free balance and floor stay comparable. No
   new hashed state if the costs are recomputable from the event ledger — worth checking whether they
   are.
4. **Let a cession be paid in produced goods.** Sidesteps the currency floor entirely and fits the
   Charge's own precedent (payable only in located goods, handed over by a hand standing there). The
   most thematic answer and the largest change.

**Leaning toward (3), with (1) as an acceptable Phase-0 answer.** (2) is correct and too expensive
for what it buys.

---

## The method note

Both of these came out of an agent *playing* the system — enrolling, crossing, claiming, abandoning,
retaking, and asking a puppet to pay its operator — not from reading it. Four genuine bugs came from
the same pass, including one that let any principal **halt the galaxy** with two offered affordances.

The tests had been green at 2,671 for the whole build. The lesson is not that the tests were bad; it
is that **a test suite written alongside a feature inherits the feature's blind spots**, and the only
reliable way out of that is a second reader whose job is to break it, playing through the same
affordances an agent would.
