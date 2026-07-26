# The four missing systems — draft 1

*2026-07-25. Written after reading the engine, not before. Draft for adversarial critique;
nothing here is canon until it survives that and lands in `SPEC.md`.*

---

## 0. What the code already decided (and why it constrains everything below)

Five facts from the engine that a design has to obey rather than re-litigate.

1. **`PREDATE`, `MARKETS`, `PRODUCE` are already named phases** in the 14-phase tick, present as
   explicit no-op hooks with documented fill-points (`src/tick/phases.ts`, `UNBUILT_PHASES`). The
   ordering was chosen once, with two adjacencies called load-bearing. **These four systems slot into
   existing holes; none of them needs a new phase.**
2. **The Levy is the maintained-service pattern, already built and tested.** §5.2's two halves:
   *the total is fixed by rule and cannot be dodged* (that is the alarm) and *the allocation is a
   vote* (that is the drama). Sovereignty upkeep should be the same object with a different subject —
   not a new invention.
3. **Holdings deliberately have no siege clock and no arrears.** `HoldingState` is `INTACT | FALLEN`
   and the header says the third state belongs to Phase 1 and is "deliberately absent rather than
   stubbed, because a field nobody writes is a field an agent will read." So sovereignty *extends*
   holdings; it does not introduce a rival structure concept.
4. **A6 grants are a complete authority system**: scoped, priced (`max_direct_loss`,
   `max_contingent_liability`), expiring (max ~3 Reckonings — no sticky vows), revocable,
   anti-self-dealing, and they already **render as authority lines**. Any organisation design that
   invents a second authority mechanism is wrong by construction (§3, one word per concept).
5. **Hands never die** (loss is time), and `state_hash`/rollback correctness is hard-won. Anything
   new must be a registered state table or it is invisible to DET-1 and survives an abort.

And the three-layer say-do gap (`public reason may lie → seal is a pre-commitment → deed is truth`)
is the answer to "watchable without deleting strategy": **we do not hide the fact, we stage when it
is revealed.**

---

## 1. Market — a per-tick uniform-price call auction, not EVE's continuous book

`docs/design/eve-passes/PASS-ECONOMY-RISK-extended.md` §M1 specifies location-bound double-auction
order books. I want to **deviate from EVE on the matching rule**, and the reason is our axioms.

### The problem with copying EVE here
EVE's market is a *continuous* double auction. Two consequences we cannot accept:
- **It pays for speed.** Queue position is won by reacting first. That is A4's exact prohibition
  ("never let requests-per-second be power"). Deterministic tie-breaks fix replay, but they do not fix
  the underlying incentive: with continuous matching, being early is still worth something.
- **0.01-ISK undercutting.** EVE's most-complained-about labour: relisting a fraction below the best
  ask, forever. It is pure throughput grinding, it is invisible on screen, and an agent fleet would do
  it perfectly and endlessly.

### The proposal: one clearing price per venue per tick
At the `MARKETS` phase, each `(venue, good)` book runs a **uniform-price call auction**: all orders
resting at that tick are crossed at the single price that maximises executed volume; every filled
order trades at that same price.

Why this is better *for us*, not merely different:
- **A4 becomes structural, not enforced.** Everyone in the tick gets the same price. There is no queue
  to be early for. Speed is not merely tie-broken away — it has nothing to buy.
- **Undercutting dies.** There is no queue position, so shaving a minor unit gains nothing.
- **It renders.** One clearing price per tick per venue is exactly a candlestick. The price chart is
  free, honest, and legible — a viewer watching a lane close and the price at the far venue spike
  understands the whole causal chain without a tutorial. This is the strongest A13 signature in the
  economy.
- **It is trivially deterministic**, which matters because replay is the record.

Retained from §M1: location-bound venues (goods settle where they trade — this is what creates trade
routes and makes blockades worth running), full escrow on both sides via the `EncumbranceBook`,
integer prices, partial fills, and the existing manipulation-resistant windowed median as the
reference mark.

Dropped: IOC as a distinct primitive (meaningless in a call auction — an order either clears this tick
or rests/expires), and time-in-force beyond `duration_ticks`.

### What is hidden
- **PUBLIC:** the clearing price, cleared volume, and depth *bands* per venue. The price signal is the
  show; it must be public or the economy is not legible.
- **PARTIES:** who traded with whom, post-clear.
- **PRIVATE until clear:** resting order ownership and exact size. You can see there is a wall; you
  cannot see whose, or precisely how big. *A ship at sea is visible; its manifest is not*, applied to
  liquidity.

### Open question for critique
A call auction weakens one EVE pleasure: the market-maker earning a spread by being continuously
present. Uniform-price clearing compresses that. Is the loss of "market making as a profession"
acceptable? My instinct is yes — providing liquidity across *ticks* and *venues* (inventory risk and
hauling) is still profitable, and that version is watchable while spread-scalping is not.

---

## 2. Sovereignty — the Charge, an upkeep denominated in hauled goods

The Levy's shape, applied to territory.

### Claiming
A system in `MARCHES` or `FRONTIER` is claimed by (a) posting a **slashable bond**, and (b) delivering
an **anchor** — a work built from produced goods — to that system. Both are A15-clean: the gate costs
produced goods and slashable capital, never "acquire another identity."

### Holding: the Charge
Each Reckoning, a claimed system assesses a **Charge**: a quantity of *specific produced goods that
must be physically present* at the claimant's holding in that system.

The critical choice: **the Charge is denominated in goods, not currency.** Currency can be hoarded and
paid from anywhere; goods must be *made and hauled*. That single decision makes logistics the
sovereignty game — which is what sovereignty actually is in EVE, underneath the timers — and it wires
territory directly into the market and the map.

- Total is **fixed by rule** from the system's tier and what it yields (undodgeable — the alarm).
- Which member of a syndicate bears which share is **a vote** (the drama).
- Miss it → the claim enters **`ARREARS`**, public and rendered.
- Two consecutive arrears → the claim **lapses**, the system becomes claimable, and the bond is
  slashed.

### Why this produces EVE's actual political dynamics
- **Overextension is automatic.** Every additional system adds a recurring haul. Empires reach a size
  their logistics cannot feed, and collapse without anyone attacking them.
- **Blockade becomes strategic rather than annoying.** Interdicting a lane starves a Charge two
  Reckonings out. That is a *legible causal chain* — a viewer sees the lane close, then the fuel gauge
  fall, then the claim lapse.
- **Drama is scheduled (A14).** Claims are contestable only in a published **vulnerability window**
  each Reckoning. Nobody can dodge into quiet.

### The pixel signature
Every claim renders with a **fuel gauge: Reckonings of Charge remaining.** Empires visibly run dry.
This is honest (it is public), it is a strategy surface (attack the one at 1), and it is the map
telling a story without commentary.

Hidden: your stockpile composition and inbound convoy contents stay `SENSED`. A besieger knows you are
low; it does not know exactly what is arriving or when it lands.

---

## 3. Syndicates — a charter plus standing grants, and *no new asset owner*

The temptation is a corporation object with its own wallet and hangar. That is wrong here, and §3 says
why: it would create a second treasury concept next to STORES, and a second authority concept next to
grants.

### The proposal
**A syndicate is a charter plus a standing set of A6 grants.**
- The **charter** names **offices** (e.g. Quartermaster, Marshal, Chancellor) and states what each
  office may bind.
- Members **grant offices** scoped authority using the existing grant machinery — the same
  `max_direct_loss` / `max_contingent_liability` shown before signing, the same expiry, the same
  revocation, the same anti-self-dealing.
- The "treasury" is simply **a holding's STORES with grants over it**. No new account kind.

### Why this is the better version of EVE's legendary betrayal
EVE's corp-theft works because a director has unbounded access to a shared hangar; the theft is a
surprise because nothing was ever priced. Here the same act is available — a Quartermaster with a wide
grant can walk off with the treasury — but **the grant, the priced worst case, and the accepted risk
warning are all on the record**, and the replay can point at the promotion that made it possible.

That is precisely the signature moment `SPEC.md` describes, and it needs no new mechanism: it needs a
shared asset worth stealing, which the Charge and the market now supply.

Offices are filled with the existing `vote` verb; office authority **expires and must be renewed**,
which is already enforced (the ~3-Reckoning cap, scar #7's sticky vow).

### The pixel signature
Already built. Authority lines converge on office-holders — a syndicate is a visible star. When a line
snaps at maximum leverage, the render already shows it.

---

## 4. Loss — works and cargo, not ships

The honest framing: **we already have permanent loss.** Standing is permanent; a holding can be
`FALLEN` with a remembered ruin. What is missing is loss of the *means of production* — something you
built, that others can take.

### Do not build ships
A hull/fitting/module system is the largest build of the four, it is a poor fit for `A3` (intent, not
clicks), and a tactical combat sim is not watchable at the pace this game runs. Most importantly our
loss model is deliberately not "your stuff explodes": hands never die, because loss is time.

### The proposal: works
A **work** is a structure built from produced goods at a system that confers a capability — a refinery
bonus, a market venue, lane protection, an anchor for a claim. Works are:
- **built** from hauled goods (so they consume market output),
- **visible** on the map (so their loss is legible),
- **destructible**, and
- **not identity** — losing every work costs you position and capital, never your ability to come back.

### Predation resolves as a venture, not a combat sim
`RAID` and `SIEGE` are already venture kinds, and `PREDATE` is already a phase. Predation is therefore
a *committed operation*: attacker commits hands and goods, defender commits hands and goods, and the
outcome is a deterministic function of committed force, terrain, and the seeded roll. The loser loses
**goods and works** — never identity, never hands.

This keeps A3, avoids a click-game, and puts loss exactly where the economy is, so predation feeds
back into the market and the Charge.

### World-spawned raids (A14)
The `PREDATE` phase also spawns **world raids** on a published schedule. This is the non-negotiable
part: A14 says never ship a mechanic whose drama depends on agents *choosing* conflict, because they
will not — silence is their rational default. The world must bring the conflict.

---

## 5. How the four interlock

The reason to build them together is that each one supplies what the others need:

- The **market** gives goods a price, which makes the **Charge** a real cost and a **work** a real
  investment.
- **Sovereignty** creates sustained demand for hauled goods, which gives the market something to
  price other than speculation.
- **Syndicates** are the only way to carry a Charge at scale, which creates the shared asset that makes
  **A6 betrayal** consequential rather than theoretical.
- **Predation** destroys goods and works, which resets the market and threatens the Charge — and it
  runs on a clock, so the whole loop cannot go quiet.

The failure mode if we build only one: a market with nothing to buy for, sovereignty with nothing to
haul, syndicates with nothing to steal, or predation with nothing worth taking.

## 6. Build order (proposed)

1. **Market** (in flight) — everything else prices against it.
2. **Predation + world raids** — A14 compliance; the world currently has no forced conflict at all.
3. **Sovereignty/the Charge** — needs the market to source goods and predation to threaten them.
4. **Syndicates** — needs something worth co-owning; is mostly composition of existing grant machinery.

## 7. What I most want attacked

1. Is the **call auction** right, or does losing continuous trading cost more emergence than it saves
   in A4 and legibility?
2. Is a **goods-denominated Charge** actually undodgeable, or does it collapse into "buy goods at the
   local venue with currency" — i.e. currency upkeep wearing a costume?
3. Does **syndicate-as-grants** actually hold, or does it need a real shared-asset object, and if so
   how do we avoid a second treasury concept?
4. Is **works-not-ships** enough physical loss to give the game stakes, or does the absence of a
   destructible mobile unit make conflict feel weightless?
5. What breaks when a **fleet of agents** plays each of these adversarially — where is the Sybil
   surface, and where is the throughput exploit?
