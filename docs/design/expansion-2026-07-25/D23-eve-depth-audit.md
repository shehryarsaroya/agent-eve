# D23 — THE COMPACT against EVE's eight depth sources

*2026-07-27. A fourth probe played the live world AND cross-read the corpus and the engine. It found
what three blind probes could not, because it checked the design docs against the code.*

---

## ⚑ THE CORRECTION THAT MATTERS MOST: §6.4 ALREADY SPECIFIES THE TRUST TIERS

`D22` recorded the standing gate as a **design decision in tension with §3's canon**, and I put it to
the owner as one. **That was wrong, and the error was mine.** I grepped `agent.md` for the promise,
did not find it, and concluded the probe was paraphrasing.

**`SPEC.md` §6.4 has the trust-tier table verbatim** — `OPEN` / `VOUCHED` / `BONDED`, where `VOUCHED`
is *"N honoured **elective** settlements across distinct counterparties"* and unlocks *"Marches,
Frontier claims, venture roles at any value."*

So implementing a gate is **making the engine match its own canon**, not a new call against §3 — and
the tension I described dissolves, because §6.4's gate is coarse and keyed to *vectors with sample
sizes* rather than to a scalar score. §3 forbids a score; §6.4 specifies tiers. Those are compatible,
and the corpus already resolved it.

The owner chose "counterparties gate it themselves" **on my incorrect framing**. That choice is still
a good one and is not wasted — it is what makes the split parameter bite — but it should be revisited
knowing §6.4 exists, because the two are complementary rather than alternatives.

## The eight properties, ranked by distance from the mark

| # | Property | State |
|---|---|---|
| 1 | Permanent public loss | **Present, best thing in the build, NOT load-bearing** — standing has one writer and no verb, affordance, market, venture, grant or claim check reads it. And world raids are explicitly standing-neutral, so *the loss that happens and the loss that is recorded never meet.* Total unsecured trust in the world: `electiveRiding: 17751` — a third of one graduation fee. |
| 2 | Scoped trust / delegation | **Built, ZERO usage, and the cause is engine not cast.** `DELEGATE: 0` decisions in a 288-tick window. A delegate can `create` but cannot `sign`, so nothing it does binds. *"A mandate that cannot bind is not authority, it is a suggestion"* — no rational agent accepts one, so a cast branch would produce zero draws again. |
| 3 | One shard | Structurally present, **empty in practice** — 23 of 30 systems have no visible activity. Violates the passes' own CUT #2 (*"start dense"*) and §4.2 (*"the variable was never system count"*). The map is ~4× too big for the population. |
| 4 | Territory worth fighting over | **ANTI-load-bearing.** A claim confers no yield, no tax, no toll, no access control, no exclusion, no raid immunity, no market privilege. Every one of its four read sites is you paying or giving it up. Costs 5,000 ration + a 50,000 slashable bond + a recurring Charge. The correct answer to "should I take a claim?" is *never*, and the agents have worked it out: `claimLines: 0`. |
| 5 | Logistics as strategy | **Thin, by one sentence.** No `haul` ⇒ no consignment object ⇒ no manifests ⇒ §11.2's SENSED tier is decorative, and reconnaissance, ambush and escort demand go with it. The cut was aimed at *autopilot clicking* (L17); it took *cargo as an object* (L4, C2) with it. |
| 6 | Player-made economy | **ABSENT, and it is the bottleneck.** Two goods, one lossless 1:1 conversion. **No comparative advantage exists anywhere in the world** — every agent needs the same good and can make it at the same rate. That is why the book has never cleared, and why more market code cannot fix it. |
| 7 | Market where information is power | **Absent twice.** Book has never cleared; and a newly enrolled principal *cannot place an order of any size* — the endowment is destructible-but-not-transferable and no `observe` field says so. Also no remote price visibility, so there is no asymmetry to trade on. |
| 8 | Deep politics | **ABSENT.** A grep for `alliance\|wardec\|diplomacy\|treaty\|belliger\|hostil` across `engine/src` returns no relational matches. No org-to-org standing, no war state, no treaty. This is the largest corpus-to-build gap in the project. |

## The three things most missing, in its words

1. **Comparative advantage — one good some agents need and cannot make.** Precondition for four of the
   eight. Cheapest version: a third good produced only at FRONTIER systems, consumed by the WORKS build
   and the Charge. That single asymmetry creates a reason to hold frontier ground, to haul, to hire
   someone elsewhere, and a first price — unblocking #4, #5, #6 and #7 at once.
2. **A way for one agent to take something from another, on purpose.** Every loss today is
   world-caused; raids never move standing; territory cannot be taken; treasuries cannot be looted;
   mandates cannot bind. *"The game's entire premise is betrayal, and there is currently no object a
   betrayal can move."*
3. **A public read of other principals before dealing with them.** `counterparties[]` stayed `[]` for a
   whole session despite naming eight principals. `standings[]` exists in `frames/contract.ts` and is
   **not on the deployed frame**.

## Eight defects the three blind probes did not find

1. **`create {kind:"BUILD"}` — 4 roles, 40,000 value, ZERO escrow, 100% elective — is legal, works, and
   has NEVER appeared in `affordances[]`.** Never counted in `withheld` either, against §6's promise
   *"we never truncate this list."* It is the only venture that can generate trust at scale, the LLM
   cast is prompted from the same observation, so **no agent in this world has ever been shown the
   four-role venture the entire social premise rests on.** Second independent cause for D19's thin
   board. Scar #1's class again.
2. **Three fields, three meanings of "free"** in one observation: `stores_free: 235000` and
   `available_qty: 50000` both say funded; `trade` says *"you have 0 free"*.
3. **`talks[]` returns your own OUTBOUND messages with no `to` field** — documented as "unread
   messages". You cannot tell who you are negotiating with or whether anyone replied.
4. **`create` silently accepts and drops `elective_bps` and `roles`** while honouring `value`. Same
   class as the `graduate` param drop, on the two params that were the interesting ones.
5. **The public frame is 256 ticks stale** (tick 4895 vs world 5151) and `frames/r-15/16/17.json` all
   **404** — the immutable per-Reckoning archive is not served. `standings`, `hallOfFame`, `places` are
   in the contract and absent from the deployed file.
6. **The board is stage-local**: you can only learn a role exists if you already have an idle hand
   standing there. With no public read, the labour market has no exchange.
7. `assure` timing improved but 74% still land on already-resolved deals.
8. **The Levy is universally unpaid: 22 of 22 tribute lines RED, `levyShort: 410698`, `levyChronic: 22`
   of 31.** §14.2 wanted *"a world fact nobody can lower alone"*; it got one nobody lowers at all,
   because its only sanction is reduced Commons capacity, which the population has correctly priced at
   zero.

## On the CUT list

The 55 CUT cards are *"overwhelmingly right"* and several are implemented as replacements rather than
asserted — arrival-order neutrality in `market/order.ts` is called out specifically. Three to revisit:

- **The "thousands of empty systems" cut was made and then violated.** Fix by *shrinking the shipped
  map*, not by adding anything.
- **`haul` was cut too broadly** — cut the clicking, restore the cargo object.
- **EVE's sovereignty shape was copied bill-first.** Null-sec sov is EVE's least-loved system, and this
  build took its *upkeep* half with none of its *rent* half. **Build the rent before the upkeep.** *"A
  claim that pays nothing is not EVE sovereignty simplified; it is EVE sovereignty with the reason
  removed."*

And one thing that should be on no CUT list: **market manipulation is NICE in the extended pass and
MUST in the main file — the main file is right.** Cornering is the cheapest way to make information
valuable and needs only depth plus a related-party-resistant reference price, both already specified.
