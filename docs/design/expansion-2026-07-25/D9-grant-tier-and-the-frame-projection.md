# D9 — what tier is a grant, and should the frame read a projection?

*2026-07-25. Two linked findings from the spectacle critique. The second is a clear
architectural improvement; the first is a **canon ambiguity I am not going to resolve by
picking**, because it decides what the A13 authority line may show.*

---

## D9a — the canon disagrees with itself about grants

§11.2's assignments put **grant terms** in `PARTIES`:

> `PARTIES`: negotiation messages, `PARTIES`-marked venture terms, **grant terms**.

But §8 says the opposite about part of a grant:

> **Renewal history is public and cumulative**, so "months of honest work" is a visible chain of
> renewals rather than one long grant — the trust arc lives in the chain.

And A13 requires every mechanic to render, which is why the authority line exists at all.

**The conflict, concretely.** The A13 authority line I shipped renders `granted` and
`grantedContingent` — the two LIMITS. Those are grant *terms*, so §11.2 says `PARTIES`, so a viewer
should not see them. But if the line shows only "there is a grant", A6's signature moment loses its
whole point: the drama is *how much authority was handed over and how much of it was drawn*, and the
receipt reel is supposed to show "the grant, the accepted warning, and the deed".

**The three readings, none obviously wrong:**

1. **Terms are PARTIES; existence and renewal history are PUBLIC.** The line shows the relationship
   and the chain of renewals, never the numbers. Preserves §11.2 exactly. Costs the pixel signature
   most of its meaning — "aaron holds authority over zoe" without magnitude is not a stake.
2. **Grant LIMITS are PUBLIC; the rest of the terms (verbs, selectors, approvals, delegation depth)
   are PARTIES.** The numbers a counterparty needs to price the risk are public; the operational
   detail is not. Matches §8's `public_if_used` and its claim that a counterparty can verify a
   delegate's mandate *before dealing with it* — which is impossible if the limits are private.
3. **Everything about a grant is PUBLIC.** Simplest, and it makes the authority render trivially
   honest, but it deletes a real strategic surface: knowing exactly how much rope a rival's delegate
   has is worth a great deal.

**My read is (2)**, because §8 already requires a counterparty to verify a mandate before dealing,
and that requirement is unsatisfiable under (1). But it changes §11.2's assignment line, which is a
**rules surface** (§3), so it should be an explicit canon edit rather than something inferred from
what the renderer happens to do today.

**Until this closes, the shipped authority line is publishing figures §11.2 arguably makes PARTIES.**
It is not a leak of anything hidden from *agents* — grants are visible to their parties and the
renewal chain is public by §8 — but it is an unresolved tier assignment on a live surface, which is
how scar #1 starts.

---

## D9b — the frame should read a projection, not live state

`Runtime.reckoningFrame()` builds the nightly frame by reading `this.world.holdings`,
`this.ventures` and `this.grantBook` **directly**. The A9 fuzz test
(`test/events/parity.test.ts`) is genuinely strong — it proves anything a viewer may read, *every*
agent may read, at the same redaction — but it guards the **event feed**, and the frame does not go
through it.

So A9 is enforced architecturally for one path and by good behaviour for the other. Everything the
frame reads today is `PUBLIC` (holdings, settled ventures) except the grant figures at issue in D9a
— but nothing *structurally* stops the next field from being sensed cargo or a hidden stockpile. The
Charge fuel gauge, which the same critique killed, is exactly that mistake one step further on: a
frame field derived from state no agent can see.

**Fix:** build the frame from a typed `publicFacts(tick)` projection with no handle to live state,
and have the parity fuzz cover the projection as well as the feed. `render.ts` already takes a
`FrameSource` and has no database handle — its header says so proudly — so the gap is only that
`reckoningFrame()` fills that struct straight out of the runtime. Making the source a projection is
a contained change and would make the header's claim true rather than aspirational.

**Sequence:** D9a first, since it decides whether the projection may carry grant limits at all.
