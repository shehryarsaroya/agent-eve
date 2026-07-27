# D21 — Splitting `runtime.ts`, in coupling order

*2026-07-26. The sequencing for a refactor that is mechanical once you know the order. Written after
`refine` was extracted as the worked example, and after three edits landed in the wrong place in this
file in one day.*

---

## Why this is a correctness item, not tidiness

`src/sim/runtime.ts` is **9,745 lines** — 12% of the engine in one class: 27 verb handlers, ~141
private helpers, 9 books. The handlers alone span **7,194 lines**.

On 2026-07-26 three separate mechanical edits landed in the wrong place in it, and **all three passed
`tsc`**:

1. A mutation test hit the wrong one of **two `recordSpend` calls 400 lines apart**. It appeared to
   pass, and the finding drawn from it — that a guard was untested — was false. A compile error
   exposed it, not the test.
2. The `refine` affordance was spliced **inside** the `build` affordance's
   `if (worksHere.affordable && !worksHere.alreadyHeld)`. That is false for everyone holding ore, since
   holding ore implies holding a WORKS — so the affordance was offered to nobody while reading as
   shipped. Found only by instrumenting the live world.
3. An earlier brace-matching edit cut a method in half.

A file that cannot be held in view makes *verify by reading* impossible and pushes the whole burden
onto tests, which only catch what they were written to catch. Two of the three above were caught by
luck rather than by a suite.

**And Phase 2 adds verbs to this file.**

## The shape that replaces it, with a current example

`src/works/refine.ts` is the worked example: a pure function over a **narrow port**, with the runtime
method reduced to an adapter that gathers inputs. The pattern already existed in the codebase —
`TargetPort`, `PredationPort`, `RaidViewPort`, and the verb logic in `world/movement.ts` — but had no
recent example, which made it archaeology rather than a convention.

The port is deliberately narrow. Passing the whole `Runtime` compiles and buys nothing: the value is
that the signature **enumerates the operation's reach**, so a reviewer sees it touches lots, the
ledger, and nothing else.

Behaviour must not move. `state_hash` covers the state tables, not the file layout, so an extraction is
safe by construction — and the check is that the suite is byte-identical before and after, which it was
(2,952 green both ways).

## The order: fewest couplings first

Extract from the top. Each row's `this.*` count is the number of distinct runtime members the handler
reaches, which is exactly the size of the port it needs. The first four need a port of one or two
members and are close to mechanical.

Two notes before starting:

- **Several helpers already live in the right module.** `vSign` reaches only `this.ventures`, and its
  helpers `countersign` and `yourTakeAtP50` are *already* in `venture/`. Extractions like that are
  moving logic home rather than inventing a home.
- **The span column is not the handler's own length** — it is the distance to the next handler, so it
  includes interleaved private helpers. Those helpers usually want to move with it, which is why the
  span is the better estimate of the diff.

| handler | `this.*` deps | span | touches |
|---|---|---|---|
| `vSay` | 1 | 13 | `claims` |
| `vSign` | 1 | 49 | `ventures` |
| `vPublishOffer` | 2 | 18 | `offerCession`, `offers` |
| `vWithdraw` | 2 | 23 | `ventures`, `world` |
| `vMessage` | 3 | 58 | `mayTalkIn`, `talk`, `ventures` |
| `vApply` | 3 | 112 | `contributeToSyndicate`, `emitRow`, `syndicateBook` |
| `vAbandon` | 4 | 32 | `abandonClaim`, `refundEscrow`, `ventures`, `world` |
| `vFight` | 4 | 35 | `emitRaidAnswer`, `raidNamedBy`, `raidTargetMismatch`, `raids` |
| `vRevoke` | 4 | 120 | `elections`, `electionsInFlight`, `emitRow`, `grantBook` |
| `vForm` | 4 | 173 | `carryOffice`, `emitRow`, `ledger`, `syndicateBook` |
| `vApprove` | 5 | 198 | `carryOffice`, `emitRow`, `ledger`, `syndicateBook`, `vGrant` |
| `vYield` | 6 | 35 | `emitRaidResolved`, `faults`, `predationPort`, `raidNamedBy`, `raidTicker`, `raids` |
| `vGrant` | 6 | 126 | `emitRow`, `grantBook`, `mintGrantId`, `officeGrantorFault`, `officeGrantorFor`, `world` |
| `vDeliver` | 6 | 134 | `consumeLevyGood`, `deliverCharge`, `emitRow`, `levy`, `levyGoodAvailable`, `world` |
| `vRefine` | 6 | 149 | `goodLotsAt`, `grantCounter`, `ledger`, `proposeOffice`, `syndicateBook`, `world` |
| `vFillRole` | 6 | 161 | `grantBook`, `pendingFills`, `sequenceIndex`, `sequenceOf`, `ventures`, `world` |
| `vElect` | 6 | 211 | `electionMandate`, `elections`, `electiveCeilingOf`, `goodLotsAt`, `grantBook`, `ventures` |
| `vAdmit` | 7 | 158 | `chargeGoodAt`, `emitRow`, `engine`, `ledger`, `syndicateBook`, `worksBook` … |
| `vBuildWorks` | 7 | 158 | `burnAnchorGoods`, `emitRow`, `faults`, `ledger`, `worksBook`, `worksQuote` … |
| `vCreate` | 7 | 327 | `emitRow`, `grantBook`, `ledger`, `mintVentureId`, `syndicateBook`, `ventures` … |
| `vGraduate` | 8 | 245 | `burnUpkeepGoods`, `carryStoresTo`, `emitRow`, `faults`, `graduationQuote`, `ledger` … |
| `vPostBond` | 11 | 388 | `bondRead`, `emitRow`, `grantBook`, `ledger`, `relationsFor`, `sovereignty` … |
| `vBuild` | 17 | 919 | `bondRead`, `burnAnchorGoods`, `chargeAssessedReckoning`, `chargeGoodAt`, `chargeGoodLotsAt`, `chargeOutcome` … |
| `vSeal` | 23 | 481 | `appendPublic`, `attemptObligation`, `deliver`, `deliveries`, `deliveryTickOf`, `emitRow` … |
| `vTrade` | 36 | 709 | `accounts`, `consumeLevyGood`, `deedTallyFor`, `deedsFor`, `deliveries`, `elections` … |
| `vVote` | 38 | 1130 | `accounts`, `claimLines`, `deliveries`, `deliveriesIn`, `deliveryTickOf`, `elections` … |
| `vJoin` | 71 | 1032 | `admitLateToLevy`, `census`, `claims`, `committing`, `commonsCapacityRejection`, `deliveries` … |

## What to do about the tail

`vVote` (1,130), `vJoin` (1,032), `vBuild` (919) and `vTrade` (709) are ~40% of the file between them
and sit at the high-coupling end. Do them **last**, and expect each to be a session rather than an
afternoon: their spans include large helper clusters that need to move with them, and their ports will
be wide enough to be worth arguing about.

Do not let them block the cheap ones. Extracting the first ten in coupling order removes the handlers
most likely to be edited casually — which is where the placement errors actually happen.

## The rule that makes this safe

**One extraction per commit, full suite between each.** All three of the day's mis-landed edits were
inside multi-part changes where a green suite covered for a wrong placement elsewhere. A refactor whose
only claim is "behaviour unchanged" earns nothing from being batched.
