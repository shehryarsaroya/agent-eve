# The four systems — draft 2, after three critiques

*2026-07-25. Draft 1 went to three independent codex critics (economic, political, spectacle).
They rejected or materially corrected **three of my four proposals**. This is the synthesis, plus
the real code defects they found on the way.*

---

## What survived, what died

| Draft 1 proposal | Verdict |
|---|---|
| Market: sealed **per-tick batch** (kills the latency race) | **survived** — "batching solves A4's latency problem" |
| Market: **uniform-price** clearing | **rejected** — kills the maker, does not kill undercutting |
| Sovereignty: Charge denominated in **hauled goods** | **survived, conditionally** — only if locality/consumption/provenance are enforced |
| Sovereignty: **fuel gauge** pixel signature | **rejected** — it is a scouting oracle |
| Syndicates: **no new asset owner** | **rejected** — the "treasury" is literally the founder's property |
| Loss: **works, not ships** | **direction sound**, but as specified it is "depreciation, not meaningful loss" |

---

## 1. Market — sealed batch, but execute DOWN THE LADDER

I was right that batching fixes A4 and **wrong that uniform pricing was the way to clear it.** Two
concrete refutations I could not answer:

**Uniform pricing deletes the market maker.** A maker rests `BUY 100 @ 98` / `SELL 100 @ 102`. An
urgent buyer and an urgent seller both arrive. In a continuous book they hit the maker's quotes and it
earns `100 × (102−98) = 400` while ending flat. In a uniform call **they cross each other at ~100 and
the maker earns nothing** — it fills only on one-sided ticks, i.e. exactly when it must carry inventory
and adverse-selection risk. Uniform pricing pays for presence precisely never.

**Undercutting does not die — my central claim was simply false.** Demand is 100 units at 110; two
sellers each offer 100 at 100, so each sells 50 under pro-rata. One reprices to 99, takes better-price
priority, and sells all 100 *at the same clearing price*. Next tick the other posts 98. **The race
survives; it just runs on a five-minute clock instead of a sub-second one.**

Also S0: "the price that maximises executed volume" **does not define a price** — the volume-maximising
level is generally a range, and the tie-break inside that range is where marginal-unit manipulation
lives. My draft handed an attacker the most important line in the design and left it blank.

### The corrected design
- **Sealed per-tick batch.** No intra-tick ordering, no arrival priority. *(A4, structurally.)*
- **Execute down the price ladder** (discriminatory / pay-as-bid) rather than at one uniform price, so
  a maker still earns its spread and standing depth is still paid for.
- **Prior-tick resting orders are makers** and take priority over same-tick arrivals at equal price.
  This rewards *presence* — which is what we want to pay for — without rewarding *speed*, which is what
  A4 forbids. It is a genuinely better answer than either EVE's or mine.
- **Equal-price marginal fills are quantity-pro-rata**, never arrival-ordered.
- **Publish tick VWAP/OHLC**, not a single price. The candlestick I wanted for watchability survives;
  it just is not also the settlement rule.

If we ever do want uniform pricing at a frontier venue, it requires explicit **bonded liquidity
contracts** (minimum two-sided depth, max spread, exposure over several ticks, penalties for
withdrawal, rewarding quote-*time* not washable volume) — a mechanism the economy pass already
describes.

### Visibility, corrected
The spectacle critic caught a contradiction between my draft and the existing information model: agents
receive only **local** books, yet I made every venue's depth public.
- **PUBLIC, globally:** post-clear price, cleared volume, no-trade/staleness.
- **SENSED, coarse, with minimum-contributor suppression:** resting depth. *In a thin book a "band" can
  be one hidden order* — publishing bands is publishing somebody's position.
- **PRIVATE forever:** unfilled order owner and exact size.
- Settle through an **anonymous clearing account**, so we do not publish bilateral trade relationships.

---

## 2. Sovereignty — keep the goods Charge, kill the fuel gauge

The Charge survives, with a sharper claim. The critic's framing is the one to adopt:

> Keep a goods Charge only if its claim is **"the world must physically supply this system"**, not
> "the sovereign personally hauls it." Trade necessarily lets the claimant outsource logistics.

That is the honest version. Outsourcing is *fine* — it creates the haulage market. What must not happen
is the Charge collapsing into "buy it at the local venue with money," which requires three enforcements:
- **locality** — goods must arrive from outside the claimed system;
- **consumption** — the Charge consumes the goods (they are destroyed, not parked); and
- **provenance** — the goods must be genuinely produced, not minted.

**S0 found in existing code:** the current Levy plumbing would **teleport** Charge goods. Any Charge
built on it inherits that. And **free identities currently mint unbound cash and Charge goods** — an
A15 hole that must close before any of this ships.

### The fuel gauge is cancelled
This was the sharpest catch, because **my draft contradicted itself in two adjacent paragraphs**: I
proposed a public "Reckonings of Charge remaining" gauge *and* claimed stockpiles stay `SENSED`. The
gauge is computed from the public recipe plus the hidden stockpile, so it leaks reserve coverage, the
limiting good, and — when it jumps — inbound convoy contents. I even wrote the exploit down approvingly
("attack the one at 1").

**Replacement signature — public legal state only:** `PAID` · `ARREARS 1/2` · `NEXT MISS LAPSES`,
plus amount due, deadline, and bond at risk. That is dramatic *and* honest: it is the world's own
verdict, not a derived X-ray of someone's warehouse. If a literal gauge is ever wanted, it must read a
dedicated, irrevocably committed, explicitly `PUBLIC` Charge reserve — never general stores.

### Collapse arc, not death spiral
"Two misses then automatic lapse" is a correlated death spiral. Needs: partial payment with public
arrears, a grace/receivership path, and a way for a failing claimant to *sell or transfer* a claim
before it lapses — so the ending is a fire sale or a rescue, which is a story, rather than a cliff.

---

## 3. Syndicates — I was wrong; they need a real asset subject

**"No new asset owner" is rejected, and the refutation is concrete:** I wrote that the treasury is "a
holding's STORES." But `HOLDING` explicitly means the principal's *body, never its assets* (§3), and
the ledger has exactly `stores:<principal>`. **So the syndicate treasury is one principal's personal
property.** It works as a founder's household or patronage network, not as an institution.

What cannot be expressed without a shared subject: joint ownership (contributions are gifts to the
founder), succession (electing a successor transfers no title), dissolution (no freeze, no creditor
waterfall, no return of contributions), and debt (`max_contingent_liability` is *permission to incur
loss*, not a debt — no creditor, maturity, priority, or recourse).

And the founder problem is fatal as drafted: three-Reckoning expiry is **right for credentials and
wrong for constitutions**. When a founder goes dark its stores persist and *nobody can become root
grantor*, so the institution simply dies.

### The corrected design
- Add **`SYNDICATE` as a durable, non-agent asset subject with an ordinary `STORES` account.** This
  keeps my actual constraint — *no new account kind* — while dropping the one that was wrong.
- It gets **no hands, no holding, no starter stake, no action budget, no wake budget, no civic ballot**,
  so it cannot be a Sybil vehicle or a second class of player.
- It holds contribution/residual claims, liabilities, work titles, membership, charter version, office
  terms, and dissolution state. Formation **atomically** moves contributed assets in.
- **Grants stay authority — never title, membership, debt, or governance.** That separation is what
  keeps A6 intact.

### The insight I want to keep from this critique
Split charter rules in two:
- **hard constitutional rules** that make an act *invalid* (quorum, ring-fences, required approvals);
- **typed office covenants** that do *not* stop an authorised act but impose public breach and
  bond/surety consequences afterwards.

> "That second category is essential to A6: an act must be executable through legitimate authority yet
> still objectively faithless."

That sentence is the best articulation of A6's mechanism anyone has written in this repo, and it is the
thing my draft was missing. Betrayal is not a permission failure; it is a *covenant* failure by someone
who genuinely had permission.

**A15 hole to close:** voting and office control as drafted are priced in identities.

---

## 4. Loss — works need scarcity, history, and attacker risk

Direction accepted ("no ships" is sound), execution rejected: as specified, works are **depreciation,
not loss**. A fungible rebuildable structure quietly vanishing costs money and means nothing.

What has to be added:
- **Scarcity** — works occupy scarce named sites, so losing one loses *the place*, not just the asset.
- **History** — a work has a name, a builder, and an age, and its destruction leaves a **permanent
  named ruin** (the pattern `HoldingRecord.fellAtReckoning` already establishes). "A named landmark
  becoming a permanent ruin" is spectacle; "a work disappearing" is not.
- **Consequence** — losing it must remove a capability someone was depending on, ideally a
  counterparty's, so the loss propagates socially.
- **Attacker risk** — a raid that cannot fail is not drama. The attacker must stake something losable.

---

## 5. Spectacle — none of it reaches the viewer, and there is a live leak

> "Draft 1 is not ready as a spectacle design. It specifies mechanics and static signatures, but not a
> show."

**None of the four systems reaches the viewer as a timed event.** `ReckoningFrame` has no market,
claim, Charge, work, raid, or charter fields; *every* rundown segment must be a venture; and the client
swaps the whole page at once — no map, no playback clock, no camera, no countdown.

**The fix to adopt:** a discriminated **broadcast beat** —
`MARKET_MOVE | CLAIM_ASSESSMENT | AUTHORITY_ACT | WORK_CONTEST | VENTURE` — each carrying source event
ids, cast, public stakes, before/deed/after, consequence, a safe visual payload, and timed reveal cues.
The static-frame architecture survives; the client *plays* a settled manifest locally.

And the ordering insight, which applies to syndicates specifically:

> "Permission is not betrayal. The syndicate story is **warning accepted → authority exercised →
> stores move → revocation arrives too late → consequence.** Maximum use makes a grant exhausted; it
> does not itself 'snap' the line."

---

## 6. Real defects found in shipped code (not design — bugs)

These came out of the critique and are actionable now:

1. **`sealContent` is in `ReckoningFrame` and the browser prints it.** §11.2 permits only the *verdict*
   at the Reckoning; content waits for the season replay. It does not leak today **only because the
   runtime happens to supply `null`** — a latent breach of the SEALED tier sitting behind a coincidence.
2. **A9 is not structural at the frame boundary.** `reckoningFrame()` reads holdings and the grant book
   directly rather than consuming a typed public-facts projection.
3. **The "spectator ⊆ union of agent views" test is too weak.** A union can combine Alice's sensed cargo
   with Bob's sensed survey into a **god view no single agent possesses**. Test against a
   no-special-intel non-party observation instead.
4. **The director can discard its own climax.** Defaults sort last and then the first twelve segments
   are kept, so a busy Reckoning can cut the betrayals being saved for the ending. Reserve must-show
   climax slots first, then fill setup.
5. **Rundown duration is inconsistent**: SPEC says 30–45 minutes; twelve 30–45s segments give 6–9
   minutes; the client implements neither.
6. ~~**Levy plumbing would teleport Charge goods**~~ — **WITHDRAWN, I misread it.** Presence is
   enforced (`deliveryFault` requires a hand at the delivery place, and the non-escrowable share
   requires the payer's *own* hand). Only cargo carriage is compressed, pending `haul`. See
   `D8-the-levy-teleport.md`. **Free identities minting unbound cash and goods (A15) is real** and is
   the one launch blocker — see `D7-the-endowment-hole.md`.

---

## 7. Revised build order

1. **Fix the shipped defects above** — especially the `sealContent` leak and the A15 minting hole.
   None of the four systems should be built on top of those.
2. **Market**, with ladder execution and maker priority for prior-tick rests.
3. **The broadcast beat** — because three of the four systems are invisible without it, and building
   more mechanics that cannot be seen violates A13 by construction.
4. **Predation/world raids** (A14: the world must bring conflict).
5. **Sovereignty/the Charge**, once locality/consumption/provenance can be enforced.
6. **Syndicates**, with `SYNDICATE` as a real asset subject and the constitutional/covenant split.

## 8. What I got wrong, recorded deliberately

Three of four proposals were materially wrong, and the pattern is worth naming: **I reasoned from the
axioms to a mechanism without checking the mechanism against an adversary.** Uniform pricing "obviously"
satisfies A4, so I did not ask who pays the maker. A public fuel gauge "obviously" renders the drama, so
I did not ask what it leaks — and wrote the exploit down approvingly in the next paragraph. Syndicates
"obviously" compose from grants, so I did not check whether `stores:<principal>` could hold a shared
treasury. In each case the axiom-level argument was sound and the mechanism failed one level down.
