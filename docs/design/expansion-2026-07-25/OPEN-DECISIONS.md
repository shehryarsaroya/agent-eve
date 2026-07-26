# Open decisions — expansion 2026-07-25

*Live list. Each entry: the decision, why it is open, what would close it.*

---

## D1. Market matching rule: continuous double auction vs per-tick call auction

**Status: OPEN, and I have already created an inconsistency.**

- `PASS-ECONOMY-RISK-extended.md` §M1 (pre-existing, ranked MUST) specifies EVE's **continuous**
  double auction with IOC as the only market-take primitive.
- A market build is **in flight right now** implementing exactly that, because I briefed it from §M1
  before doing this design pass.
- `DRAFT-1-four-systems.md` §1 then argues for a **per-tick uniform-price call auction** instead, on
  three grounds: A4 becomes structural rather than enforced (one price per tick ⇒ speed has nothing to
  buy), it kills 0.01-undercutting labour, and it renders as an honest candlestick.

**Why I did not stop the build.** The two designs share most of their machinery: order records, both-
sided escrow through the `EncumbranceBook`, the registered state table, the conservation invariants,
the `market.books[]` observation, and the venue/location binding. **Only the matching function
differs.** So the in-flight build is a usable first cut under either rule, and swapping `match()` later
is a contained change rather than a rewrite.

**What closes it:** the codex economic critique, specifically —
- does uniform-price clearing kill the liquidity provider and leave books thin?
- is a per-tick batch *easier* to manipulate by a coordinated group than a continuous book?

If liquidity collapses under call-auction clearing, the fallback is a **hybrid**: continuous resting
orders with a per-tick batch cross (so there is a queue for depth, but no intra-tick speed race).

**Bias:** toward the call auction. A4 is an axiom, and "enforced by tie-break" is weaker than
"structurally impossible". But this is exactly the kind of confident-and-wrong I have been burned by
this session, so it waits for the critique.

---

## D2. Is a goods-denominated Charge really not a currency upkeep?

The claim in §2 is that denominating sovereignty upkeep in **produced goods that must be physically
present** makes logistics the sovereignty game. The obvious objection: agents can trade, so a rich
claimant simply buys the goods at the local venue and the Charge becomes currency with extra steps.

Candidate answers, none yet chosen:
- require goods **hauled from outside the claimed system** (so local purchase cannot satisfy it);
- make the Charge a basket that no single region produces (comparative advantage, per the economy
  pass's "complementary, not self-sufficient" seeding);
- price the Charge in goods whose local venue is thin, so buying locally moves the price against you —
  self-limiting rather than prohibited.

The third is the most elegant and the most in keeping with a market-driven world, but it needs the
market to exist first before it can be tuned.

---

## D3. Do syndicates need a real shared-asset object?

§3 asserts a syndicate is "a charter plus standing A6 grants" with **no new asset owner**, to avoid a
second treasury concept (§3 vocabulary canon). Open: whether payroll, joint ownership, succession,
dissolution, and debt can all be expressed that way, or whether at least one of them forces a real
object. Referred to the political critic.

---

## D4. Is "works, not ships" enough stake?

Hands never die, so the physical-loss engine is cargo + works. Open whether that gives conflict enough
weight, or whether the absence of a destructible *mobile* unit makes raids feel weightless. Referred to
the political critic.

---

## D5. Build order

Proposed: market → predation/world raids → sovereignty → syndicates. The argument is that each supplies
what the next needs, and that predation is second because **A14 compliance is currently absent
entirely** — the live world has no forced conflict, which is a large part of why it is quiet.
