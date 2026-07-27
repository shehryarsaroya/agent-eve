# D20 — How a delegate actually spends a grant

*2026-07-26. A6's delegation path, specified and then built.*

> ⚑ **THE PREMISE OF §"What is missing" BELOW IS WRONG.** It says no verb accepts a mandate and that
> `grantBook.spend()` is never called — both from a grep for `grantBook.spend` / `.spend(`. **The
> method is `recordSpend`, and the grep missed it.** `create` has supported delegated action all
> along: `on_behalf_of` names the principal, `liveGrantBetween` infers the mandate, both LIMITS are
> checked, and the draw is ordered before the transfer with a note citing AGT-X9. A negative claim
> resting on one grep spelling is only as strong as the spelling.
>
> **What was actually missing is narrower:** no *cast* has ever used a mandate it holds, so no world
> has produced a single draw. That is a cast gap, not an engine gap.
>
> Kept rather than rewritten because the design reasoning below is sound and was confirmed by
> building it — with one correction, marked at §"The param", where matching `create`'s existing
> spelling beat the fresh one this file proposed.

---

## What is missing, restated exactly (⚑ see banner — this section's premise is wrong)

`grant` works end to end: issued, bounded, warned, rendered (`authorityLines=12`), revocable,
captured, VC-serialised, audited by INV-22/23. **Nothing can use one.**

- `grantBook.spend()` / `recordSpend()` are never called outside `src/grant/book.ts`
- no verb accepts a grant to act under — only `revoke` takes a `grant` param
- `onBehalfOfPrincipalId` is written `null` at every venture/seal/audit site

So betrayal via legitimate authority is impossible by construction, and INV-22 reports green over an
always-empty journal (pinned: `test/invariants/inv22-is-vacuous.test.ts`).

## The verb to do it on is `elect`, and the reason is a comment already in the code

`vElect` refuses a non-creator with this:

```ts
if (venture.creator !== req.principal) {
  return reject('PROP-V4',
    `only ${venture.creator} elects on ${venture.id}: the elective half is paid out of the payer's
     own stores, and you are not the payer here.`);
}
```

*"Anyone else electing on it would be spending another agent's money"* — which is the definition of
delegated treasury authority. **This gate is the insertion point**, and it is the whole reason `elect`
beats every other candidate:

1. **No ledger change is needed.** The elective half already pays from the *creator's* stores. A
   delegate electing on the grantor's venture moves the grantor's value through the existing path;
   nothing about value flow has to be touched, which is the part that would otherwise make this
   dangerous.
2. **The abuse is self-dealing with no new mechanic.** A delegate that holds a role on the grantor's
   venture cannot elect to itself (`role.filledByPrincipal === req.principal` is refused, scar #9) —
   but it can elect `IN_FULL` on a role held by its *ally*, or decline on a role held by the
   grantor's ally, draining or defaulting the grantor's promises with ordinary legitimate verbs. That
   is A6's "no `betray()` verb" satisfied exactly.
3. It is one verb, and the verb budget is at its §17 ceiling (40/40), so this must be a **param**, not
   a new verb.

## The param — ⚑ CORRECTED: there is no param

This file argued for a `grant: <id>` param, reasoning that a delegate holding authority from several
principals should say which mandate it draws on. Sound in general, wrong here, for a reason this file
could not see while its premise was wrong: **`create` already does this, and does it differently.**
`on_behalf_of` names the PRINCIPAL and `liveGrantBetween` infers the grant.

Two spellings for "I am acting under delegated authority" is one concept wearing two words in a rules
surface — §3, and scar #1's shape — so `elect` matches `create` instead. And inference is
*unambiguous* here in a way it is not for `create`: the elective half is paid by `venture.creator` and
nobody else, so the grantor is a fact about the venture rather than a choice the actor makes. Nothing
needs disambiguating, so `elect` takes **no extra field at all** — acting as a delegate is simply
electing on a venture you did not create.

The original argument, kept because it is the right instinct in the general case:

## ~~The param is `grant`, not `on_behalf_of`~~

`on_behalf_of` is **already taken** — `grant` uses it to name the *syndicate* an office is appointed
for (`officeGrantorFor`). Reusing it for "the principal I am acting for" would be one canon word
wearing two concepts in a rules surface: HARD RULE 4, scar #1. `revoke` already spells this `grant`,
so:

```json
{"venture": "v:…", "role": 2, "election": "IN_FULL", "grant": "g:4895:117e86ad"}
```

Gates, in order: the grant exists · `delegate === req.principal` · `grantor === venture.creator` ·
`isLive(id, tick)` · headroom sufficient.

## ~~The spend is recorded at SETTLEMENT, not at election~~ — ⚑ CORRECTED

**It is recorded at ELECTION time.** This section's blocker was that `recordSpend` requires an
`eventId` and `vElect` emits no event — true, and it turned out not to matter: **INV-22 reads `eventId`
only for sort identity and for its own messages, and never dereferences it.** So `elect:<venture>:<role>`
is honest provenance, and the whole settlement detour is unnecessary.

Recording at election is also the *better* answer, not merely the cheaper one. `recordSpend`'s own
contract is that the caller checks headroom "before it moves any value, so a refusal leaves the world
untouched" — and a limit enforced only at settlement is not a limit, because by then the promise is
public and breaking it is a default on somebody's record. `create`'s delegated path independently
reached the same conclusion, with a comment explaining why the draw is ordered before the transfer.

The `direct`/`contingent` mapping below stands and shipped: `IN_FULL` → contingent, a fixed amount →
direct.

Original reasoning:

### ~~Why settlement looked like the home~~

`recordSpend` requires an `eventId`. **`vElect` emits no event at all** — it sets
`this.elections.set(key, raw)` and returns. So there is no id to record against at election time.

That is not an obstacle, it is the design telling you where the spend belongs. An election is a
*stated intention to pay*; value moves at settlement. And settlement *does* have event ids
(`settlementHandle(reckoning, venture)`, `d.eventId` in `driver.ts`). So:

| when | what happens |
|---|---|
| `elect` | authorise the delegate, refuse if no live grant with headroom |
| settlement | pay as normal, then `recordSpend` with the settlement event id and the **actual** amount |

And the two LIMITS map onto the two election forms exactly as §8 intends:

- a **fixed amount** is knowable now → `direct`
- **`IN_FULL`** on a share role is not knowable until resolution → `contingent`

Which is what `max_direct_loss` and `max_contingent_liability` were always for. The affordance already
shows both.

## ~~Why this cannot be split~~ — ⚑ CORRECTED: it needed no split, and it is built

Everything below follows from recording the spend at settlement, and that premise is wrong (above). At
election time the mandate is in hand, so nothing needs to be carried forward: **no field on
`electionsStateTable`, no captured-schema change, no `RULES_VERSION` bump, no discontinuity.** The
spend journal is already inside `grantsStateTable`'s capture, so a draw is an ordinary state change.

Built and shipped the same day: `test/grant/a-delegate-can-spend.test.ts`, four tests, every gate
mutation-verified except the headroom branch. The one genuinely new rule is **one delegate election per
role** — `elect` is restatable, and under a mandate each restatement would draw fresh headroom, so a
delegate could charge the grantor's LIMIT repeatedly for one promise. That guard needs no state either.

The warning below was still the right instinct and is worth keeping: an authorisation gate must never
ship without its accounting.

### ~~The original argument~~

The election must carry which grant authorised it, so settlement knows whose limit to charge. That
means **`electionsStateTable` gains a field — a captured state table.** Which means:

- a `RULES_VERSION` bump,
- a divergence at every existing election row,
- a declared discontinuity through the operator door,
- and, until the closed-account bug in `COMPLETION.md` §7 is fixed, a fresh genesis replay on every
  boot after it.

**And the authorisation gate cannot ship without the accounting.** Opening the PROP-V4 gate while the
spend journal stays empty would let a delegate elect *unbounded* amounts of the grantor's money with
no limit enforced anywhere — strictly worse than the current state, where it simply cannot act. INV-22
is the backstop, not the gate: `recordSpend`'s own doc says the caller checks headroom "before it
moves any value, so a refusal leaves the world untouched."

So it is one atomic change across `vElect`, a captured state table, and the settlement path, on the
action pipeline — the most safety-critical surface in the engine, and the one where today already
supplied a demonstration of what enabling a never-exercised path costs (checkpoint adoption, four
minutes of downtime). It wants a session that starts with it, not the tail of one.

**What is done here is the hard part that is easy to get wrong:** the insertion point, the reason no
ledger change is needed, the param spelling that avoids a scar-#1 collision, the placement of the
spend at settlement rather than election, and the `direct`/`contingent` mapping. Implementation from
here is mechanical, and it is bounded by one schema field.
