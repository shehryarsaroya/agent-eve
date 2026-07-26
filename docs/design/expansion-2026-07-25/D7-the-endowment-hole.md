# D7 — free identities mint capital, and seat recycling makes it unbounded

*2026-07-25. Found by the economic critic as "free identities currently mint unbound cash and
Charge goods", then reproduced and sharpened. **This is a launch blocker.** It is not fixed, and it
is a genuine economy-design decision rather than a bug with an obvious patch, so it is written down
in full rather than patched at speed.*

---

## The mechanism

`Runtime.seat()` issues, per enrolment, from named faucets:

- `STARTER_STAKE` = **250,000** currency (`CURRENCY_FAUCET.STARTER_STAKE`), and
- `LEVY_STARTER_ALLOTMENT` = **50,000** located goods (`GOODS_FAUCET.PRODUCTION`).

Enrolment is free, and **must** stay free — A15 says so, and A8's permanent floor depends on it.
Measured directly:

```
STARTER_STAKE each : 250000
10 free identities -> 2500000 currency + 500000 goods
cost to create     : nothing
```

## Why the seat cap does not bound it

The obvious defence is `SeatBook`'s capacity (default 300), which caps *concurrent* seats. It does
not cap minting, for two reasons:

1. **Seat recycling frees the seat, never the capital.** `src/api/seats.ts` never touches the ledger
   — it imports only `compareIds` from it. An idle seat is recycled so a newcomer can enrol, but the
   retired principal keeps its stores, because A10 says identity and its record never reset.
2. So the loop is: **enrol (free) → mint 250k + goods → go idle → seat recycles → enrol again.**
   Total minted grows with *churn*, not with concurrency, and there is no ceiling on churn.

## Why it got worse today

Before markets, minted capital was hard to concentrate: there is no direct principal-to-principal
transfer verb, which was doing quiet work. **The market removes that friction.** A wash trade moves
it in one Reckoning:

- the sock posts an `ASK` for its allotment at a nominal price and the main account `BID`s for it —
  goods to the main account, currency to the sock; or
- the sock `BID`s far above value for the main account's junk goods — **250,000 currency to the main
  account per identity.**

Both are ordinary legal orders. Nothing in the matcher is violated. The economy simply has a faucet
whose tap is "make another keypair".

## Why the naive fixes are wrong

- **Cap enrolments per source.** A15 forbids it outright — "never text-based Sybil detection", and a
  gate priced in identities is unpriced. It also breaks A8's promise that anyone can always start.
- **Detect wash trades and punish.** A15 again: "the flow graph may withhold credit, never accuse."
  Punishment requires proving intent, and two agents trading at a silly price is legal.
- **Remove the starter stake.** Then a newcomer cannot act at all, an unowned agent can never reach
  the top (A15's own requirement), and the Levy — payable only in located goods — becomes impossible
  to meet on arrival, which is A5′ with the engine's economy as the cause. The stake exists for a
  reason and the reason is still good.

## Candidate fixes

**A. Make the endowment non-transferable rather than non-existent.** A15's sanctioned move is that
the flow graph may *withhold credit*. Starter capital funds your own work — your ventures, your
Levy, your hauling — but cannot leave you: it cannot fund a market `BID`, cannot be paid to another
principal, and starter-origin goods cannot be sold. Lots already carry `origin`, so goods provenance
exists today; currency would need an endowment watermark (a per-principal floor of "how much of my
balance is still endowment"), spent last and never transferable. A real solo agent is unaffected. A
fleet gains nothing, because the capital cannot be concentrated. **Preferred.**

**B. Earn-out.** The stake vests as the principal completes settled ventures, so an identity that
never plays never becomes capital. Elegant, but it delays a newcomer's first real move and adds a
vesting concept to a vocabulary that does not have one.

**C. Endowment from a bounded pool rather than a faucet.** A fixed seasonal allotment shared by all
newcomers; when it is drawn down, newcomers get less. Bounds total minting exactly, but makes
arriving late strictly worse, which cuts against A8's permanent floor and A10's persistent frontier.

**D. Do nothing and cap seats hard, with no recycling.** Bounds the mint at `capacity × stake`, but
kills idle-seat recycling, which the population design depends on.

**Recommendation: A**, with `origin` already in place for the goods half and a watermark for the
currency half. It is the only option that leaves a newcomer as capable as it is today while making
the sock-puppet worth exactly zero.

## What must land with it

- A test that a fleet of N enrolments cannot raise any single principal's spendable balance.
- An `agent.md` sentence, because it changes what an agent may do with its opening stake, and the
  player contract is a rules surface (scar #1).
- A decision on whether existing worlds need a `RULES_VERSION` bump — they will, since the change
  alters what a past tick computes.
