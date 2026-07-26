# D11 — syndicates: the pooled-stores decision, and the Levy collision it walks into

*2026-07-26, written **before** the build rather than after, because the collision below is the kind
that is cheap to design around and expensive to retrofit. `SPEC.md` §363 already flagged that
syndicates need "pooled stores, a charter, membership, and vote resolution" and deferred them to
Phase 1's first job; this is what that job actually runs into.*

---

## Why syndicates matter enough to get this right

A6 is the core loop: **betrayal through legitimate authority, never a dice roll.** It is live today at
*grant scale* — one principal grants another scoped authority over its own stores, and months later
that authority is used against it.

`SPEC.md` §365 is explicit that the real object is bigger: an **office** is standing, revocable-with-
notice authority over *a syndicate's* stores and structures, some things can **only** be operated by a
named office-holder, and offices are scarce per constellation so holding one is a status object. §363
says plainly: *"Offices require syndicates."*

So the signature moment the whole design is arranged around — trusted agent, months of honest work,
authority it could abuse, abused at maximum leverage — is currently only reachable over **one
principal's** stores. The prize for building syndicates is that it becomes reachable over **an
organisation's**, which is where the sums are large enough for the betrayal to be a legend rather than
a dispute.

---

## The decision: a syndicate has to be a principal

Pooled stores means a real ledger account. `schema.sql` constrains it:

```sql
CHECK (
  (kind IN ('STORES', 'ESCROW') AND principal_id IS NOT NULL) OR
  (kind IN ('FAUCET', 'SINK')   AND principal_id IS NULL AND name IS NOT NULL)
)
-- and: principal_id text REFERENCES principal(id)
```

So a `STORES` account **must** name a principal that exists. Three ways out:

| option | what it costs |
|---|---|
| **A. A syndicate IS a principal** — a principal row with no keypair, which cannot sign and cannot act | one new rule (below), and the Levy collision |
| B. A new `SYNDICATE` account kind | a schema migration plus every `AccountKind` switch, `isWorldAccount`, INV-7's posting sum, and the two projections |
| C. Pool into the founder's account, governed by charter | not pooled at all; the founder can spend it with no office, which deletes the mechanic |

**Take A.** It is the option where "SYNDICATE is a real asset subject" is *literally* true rather than
emulated, and — the part that matters most — **the entire `grant` machinery works unchanged.** A grant
is already authority over another principal's stores, with `max_direct_loss` and
`max_contingent_liability` shown before signing, INV-22/23 asserting the spend counter, and the book
inside `state_hash`. An office is then not a new mechanism at all: it is a grant whose grantor is a
syndicate. Every A6 guarantee, every invariant and every rendered authority line comes along for free.

C is disqualified outright: if the founder can spend the pool without holding an office, there is no
authority to abuse and therefore no A6.

---

## The collision, which is the actual finding

**A syndicate has no hands. The Levy is payable only in goods physically delivered by a hand standing
at the place. So a syndicate-as-principal defaults every single Reckoning, forever.**

The pieces, each verified in the engine rather than assumed:

- §5.2 has **no exemption**: *"every principal is assessed; there is no Commons exemption, that is the
  whole point"*, and `LEVY_NOMINAL_MINOR` is deliberately non-zero so that nobody can be assessed zero
  and thereby fall off the docket.
- `INV-25`, the anti-quiet invariant, **halts the tick** if an assessed principal is missing from a
  docket. It exists so a legitimate newcomer's arrival cannot silently produce a quiet Reckoning.
- `deliveryFault` → `carrierAt` refuses a delivery unless a hand is standing at the place, and
  `presenceOwed` requires the payer's **own** hand for the non-purchasable share (D8 established both,
  after I got them wrong once).

A default is not a cosmetic outcome. A5′ is the axiom that *the record must never be wrong*, and
`ledger/endowment.ts` already refuses to remove the starter allotment using exactly this reasoning:

> a newcomer with no allotment holds an obligation the rules make impossible to meet, **which is A5′
> with our own economy as the cause**

A syndicate assessed a Levy is that sentence again, with our own *org model* as the cause — and worse,
because it is permanent and it accrues against a name that other agents are supposed to be able to
read for trustworthiness. An org that shows a hundred consecutive defaults teaches every reader that
the default column is noise, which corrodes the one signal the whole game publishes.

### The resolution, stated as one rule

**A syndicate is not a Levy subject, because the Levy is a duty on a BODY and a syndicate has none.**

That is not an exemption carved for convenience — it is the same principle §5.2 already runs on. The
Levy is deliberately payable only in located goods carried by a present hand, *specifically* so it
cannot Coase-collapse into a purchasable service. A subject with no body cannot satisfy a duty defined
by presence, so it is not a subject of that duty. The members are, individually, and they already are
today.

Three consequences to implement together, or the rule is half-applied:

1. `Book.admit` / the docket builder must not enrol syndicates as Levy subjects.
2. `INV-25` must not count them as missing — and this is the half that bites, because the invariant is
   written to be paranoid about omissions on purpose. It needs to know *why* the omission is legal, in
   its own message, or the next reader will "fix" it back.
3. The same question has to be answered for the **Charge** (§6.3) and for **raids** (§9). Charge:
   *yes*, a syndicate can hold a claim, and this is desirable — but the goods must be deliverable by
   **any** hand, which `vDeliver` already permits for the purchasable share, so an office-holder hauls
   for it. Raids: a syndicate's *stores* should be raidable (goods standing somewhere are goods), but
   the target-selection rule reads "principal with the most goods outside the Commons", so a syndicate
   would become the permanent raid magnet the moment pooling works. Needs its own call — probably
   weight by *hands present to defend*, which a syndicate has none of, so it is never the aimed target
   while its members are.

Point 3 is the one most likely to be missed, and it is why this document exists before the build: the
Levy is the collision I found by reading, and the raid magnet is the one it led me to.

---

## Scope, honestly

Increment 1 is the book, the charter, membership, and pooled stores with the syndicate as a
no-keypair principal — plus the three consequences above, because a syndicate that halts the world on
INV-25 is not a partial feature, it is an outage.

**Offices are increment 2**, and they should be *cheap*: `grant` already does the work, so the job is
to let a grant name a syndicate as grantor, gate that on a charter-defined office, and render the
authority line that already exists. If it turns out expensive, something has been designed wrong.

`charter` and `form` are both already reserved verbs in `verbs.ts` with no handler, so **no verb slot
is spent** — the same position sovereignty was in with `build` and `deliver`.

## The method note

The Levy collision took two greps and one reading of `schema.sql`. It would have taken a halted
production world to find after the fact, because a syndicate founded on a quiet Reckoning would look
fine until the first assessment.

That is the third time in this expansion that reading the *caller* rather than the function answered
the question — D8's `deliveryFault`, sovereignty's `INV-20`, and now this. The general form: **a new
subject inherits every rule written for the old ones, including the ones nobody thought of as rules.**
