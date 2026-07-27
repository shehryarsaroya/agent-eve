# D15 — The `ObserveSources` adapter, specified

*2026-07-26. Written from reading only — the disk filled and `Bash` stopped working mid-task, so
nothing here is typechecked. It is a spec, not a claim about working code. Every member of the
interface is listed with its live source, and the three that do not have one are named.*

---

## Why this is the keystone

`ObserveSources` is the input to everything in `src/observe/`, and `src/observe/` holds three things
production needs and cannot currently reach:

- **`ServiceDesk`** — 664 lines, six free services (`plan_hands` · `quote_venture` ·
  `reference_split` · `stress_grant` · `dry_run` · `mandate`), instantiated in exactly one test.
  `agent.md` §12's first advice is *"Call `plan_hands` before every allocation decision"*, and SPEC
  §12.1 says without them *"agents do not flail visibly; they play blandly and identically, and the
  agent-quality gate fails silently."* For a memory-equipped planner this is the largest single lever
  in the repo, and it adds no mechanics.
- **`SensingIndex`** — `canSense` / `hasIntel`. Nothing in production imports it, so **there is no
  `SENSED` tier on the live path at all**, which is why PROP-VI2 and AGT-X8 have no live subject and
  why the information market is blocked (*you cannot trade a tier nothing produces*).
- **`sensingFaults`** in `src/observe/invariants.ts` — the guard that re-checks every published
  affordance against the sensing index rather than trusting the generator. Not running on the live
  path.

**One adapter unblocks all three.** That is why both the enrichment researcher and the architecture
critic put it in Phase B.

### It is not the duplicate-builder decision

I said twice that this "forces" the decision about `src/observe/observation.ts`'s parallel
`buildObservation`. That was wrong. Building an adapter neither deletes nor blesses that builder — it
lets production call the *other* things in the module. The duplicate remains a separate question, and
the answer now looks determinate anyway: the module holds code production needs, so it stays; what
should change is the eight test files that assert `agent.md`'s promises against the dead builder
instead of the live one. One of those was already repointed (`test/observe/promise.test.ts`).

---

## Where the adapter must live: `src/api/`, not `src/sim/`

Forced by one member. `handleOf(principal): Handle | null` needs handles, and handles live in the
**seat book** (`src/api/seats.ts`), not on `Runtime` — `src/api/observe.ts` has no handle accessor at
all, which is why `CastChip.line` is hardcoded `''` in the frame renderer (D14 §4).

So the adapter takes `(runtime, seats, clock, perRequest)` and belongs beside `src/api/observe.ts`.
Putting it in `sim/` would either invert the layering or force a second home for handles.

---

## The mapping, member by member

23 members. `tsc` is the completeness check — the interface has no optional members, so a compiling
adapter is a total one.

### Scalars (5)

| member | source |
|---|---|
| `tick` | `runtime.engine.tick` (clamp at 0 — it is `-1` before the first tick publishes) |
| `serverNowMs` | the injected clock's `nowMs()`. **Never `Date.now`** (DET-7) |
| `stateVersion` | `runtime.engine.stateVersion` |
| `status` | `runtime.engine.status` |
| `rulesVersion` | `RULES_VERSION` |

### Books and world (6)

| member | source | note |
|---|---|---|
| `world` | `runtime.world` | |
| `stores` | a `StoresRead` over `runtime.ledger` | check the existing shape in `src/api/observe.ts`'s own reads before writing a new one |
| `markPriceOf` | `runtime.ledger`'s valuation path (`valueGood`) | windowed median; already used by the live builder |
| `ventures` | `runtime.ventures.forPrincipal(p)` **or** `.all()` | the interface says *"Every venture this principal could be shown. Filtered by eligibility here"* — so pass the wider set and let the module filter |
| `grants` | `runtime.grants.all()` | same source `invariantInputs` uses |
| `grantTemplates` | **`[]`** — see below | |

### Methods (2)

| member | source |
|---|---|
| `standingOf(p)` | `runtime.standing.row(p)` — but return **`null` when no row exists**, never a zeroed row. The interface is explicit: *"a fabricated all-zero standing reads as 'clean record', which is a claim about a real agent that nothing supports"* |
| `handleOf(p)` | the seat book. **This is the member that decides the adapter's home.** |

### Per-request (3)

| member | source |
|---|---|
| `actionsRemaining` | already computed by the live `buildObservation` caller |
| `wakesRemaining` | ditto (the cast passes it; the HTTP path computes it) |
| `isWake` | *"The caller decides, because only it knows whether a wake was offered"* — pass through, do not infer |

### Per-principal blocks (7)

| member | source | note |
|---|---|---|
| `mandate` | see below | |
| `levy` | `runtime.levyBlockFor(p, tick)` | already returns exactly `LevyBlock` |
| `market` | the market book's rows for this principal's venue | `src/api/observe.ts` already builds this |
| `talks` | derive from `runtime.talksFor(p)` | **shape differs**: `TalkRow` is `{venture, counterparty, unread, last_tick}` — *counts and ticks, never bodies*. The live payload carries bodies in `ventures.talks[]`, so this needs aggregating, not copying |
| `ballots` | the Levy ballot from `levyBlockFor` plus the Charge ballot | `BallotRef[]`; both already exist as blocks |
| `sensing` | `sensingFromWorld(runtime.world, tick, purchased)` | pass `new Set()` for `purchased` until an intel market exists — the parameter has no caller today |
| `sealedRoles` | `runtime.seals` — keys via the module's own `roleSealKey(venture, roleIndex)` | use the exported helper, *"in one place, so the API layer and this module cannot disagree"* |

---

## The three members with no live source

1. **`grantTemplates` → supply `[]`, and it degrades nothing.** The interface wants a per-template
   *worst case*. The live runtime has `GRANT_TEMPLATES: readonly string[]` — labels only — and its own
   comment defers the worst cases. The interface sanctions the gap: *"Empty until the office module
   ships; present so `grant` is a real affordance with a real worst case rather than a verb an agent
   has to guess the shape of."*
   <br><br>
   **Correction to this document's first draft**, which said `stress_grant` was the service most likely
   degraded and should be checked before being promised. Checked: `ServiceDesk.stressGrant` reads
   **`sources.grants`, never `sources.grantTemplates`**, computing headroom from the grant's own
   `maxDirectLoss − spentDirect` and `maxContingentLiability − spentContingent`. Unaffected. Its note
   is worth quoting because it is A6 stated inside a decision-support tool: *"A delegate inside these
   bounds can still cost you all of it, through ordinary legitimate actions. There is no betray verb
   and no loyalty meter."*
2. **`mandate: MandateRead | null` → `null` is a correct answer, not a degradation.** Also a
   correction. `ServiceDesk.mandate` is a pure passthrough of `sources.mandate`, and the member is
   §13B's **owner** mandate — *"Advice, and the agent is told so in the payload itself"*, deliberately
   a free read because *"shipping a page of prose on all 16 wakes a day is waste the owner pays for"*.
   A principal whose owner has set no mandate has none, so `null` is the truth rather than a gap and
   nothing needs saying in `agent.md`.
3. **`talks` → aggregate, do not copy.** The one genuine shape mismatch. `TalkRow` is deliberately
   counts-and-ticks because *"a talk row is cheap"* and `agent.md` §4 promises messages *"never wake
   you up"*. The live payload carries bodies in `ventures.talks[]`; copying them would break that
   promise and put `PARTIES` content in a per-wake payload.

**So there are no known blockers.** Of the three members flagged as unsourced, two were fine on
inspection and the third is an aggregation.

---

## Order of work, and the one thing to do first

1. **Write the adapter and let `tsc` prove it total.** No behaviour change, nothing wired — the
   compiler is the completeness check because the interface has no optional members.
2. **Wire `ServiceDesk` behind one service: `plan_hands`.** It is the one `agent.md` §12 names first.
   Free services consume no action, so they cannot violate an invariant; the risk is entirely that a
   service *lies*, which is why each needs a golden-file test against a known world.
3. **Then `sensing`,** which is the bigger prize: it puts a `SENSED` tier on the live path for the
   first time and gives PROP-VI2 and AGT-X8 a subject. Enable `sensingFaults` on the live payload in
   the same change, since its whole purpose is to re-check what the generator published.
4. **Only then the remaining four services.** `stress_grant` last, because of `grantTemplates` above.

**Do not** add the six services to `agent.md`'s live list until each has a golden-file test. `agent.md`
currently marks them *"Not yet live (Phase 0)"*, which is honest; a service that exists and answers
wrongly is worse than one that is absent, and this repo has spent a day proving that a rules surface
which overstates is the most expensive kind of bug it produces.

---

## Caveat on this document

Written with `Read` only. `Bash` was unavailable — the disk hit 100% and the tool harness could not
write its own output files — so **no line here has been typechecked and no claim tested.** Two members
(`mandate`, and `ServiceDesk`'s behaviour under an empty `grantTemplates`) are marked as needing
verification precisely because I could not run the greps that would settle them.

Every previous time in this session that I asserted something about this codebase without running the
check, I was wrong: the deciding-share floor, the grant gate test, the skip list, the encumbrance
prune, the ballot cap. Treat the mapping above as a starting point that removes the exploration, not
as a result.
