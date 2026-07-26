# D14 — Three critics, and what to build next

*2026-07-26. An enrichment researcher and two adversarial critics (spectacle, architecture) read the
codebase after the D13 playthrough. This records what they found, what I verified and fixed in the
same session, and the build order the three of them converge on. Everything below is either measured
or cited to `file:line` — where I could not verify a claim I say so.*

---

## 1. The pattern that dominates everything else

D13 found three mechanics that were **fully built and unreachable from the API**. The three reports
found **eleven more**. This is now the repo's defining defect class, and it has a name and a cause:

> **The defect is created by shipping, not by neglect.** Every instance was written by someone who
> finished the engine work and did not close the loop to the menu. No invariant can see it — the
> mechanic is correct, tested, and rendered.

Verified and fixed this session:

| Primitive | Was | Now |
|---|---|---|
| `grant` (the A6 core loop) | no affordance at all; frame published `authorityLines: 0` | offered to counterparties with a kept promise |
| `deliver` / `vote` (LEVY) | legal, executing, never offered | offered when payable / ballot open |
| §7.3 `preference` | stored, honoured as the **first** tiebreak, never read from `create` | read, validated, bounded |
| syndicates in `observe` | absent entirely; ids had to be guessed from `syn:<founder>:<tick>` | published under `grants` |
| office grants | grantor could not see what it issued | visible to members of the issuing house |
| `form` | legal, priced, offered nowhere | offered with a deterministic name suggestion |
| `set_delivery_intent` | **unsendable by the house cast** — see §3 | flat spelling + affordance |
| syndicate treasury | **unspendable by construction** — see §2 | office-holders can spend it |

`AGT-R5` in `TESTING.md` §7.4 is now an automated sweep (`test/api/agt-r5-reachability.test.ts`) that
reconciles every live verb against the affordances a real world publishes. **Its first run found
`form`.** Its exception list requires each entry to classify itself as `RESPONSE-ONLY`, `REACHABLE
ELSEWHERE`, or `HONEST GAP`, and it runs in **both** directions — when `set_delivery_intent` became
offered, the rot check failed by name before I had thought to delete the entry.

Still unreachable, from the reports and unverified by me:

- `GOODS_SINK.PRODUCTION_INPUT` — the refine step's destroy-leg, opened at construction, **zero call
  sites** (`ledger/accounts.ts:110`).
- `AudienceBasis = 'INTEL'` — no writer anywhere; `AudienceRow.admittedAtTick` exists *specifically*
  so a SENSED audience can grow when somebody buys intel.
- `SensingIndex.hasIntel` / `sensingFromWorld(..., purchased)` — the `purchased` parameter has no
  caller, and **the production observe path never imports the sensing module at all**.
- `extract` · `refine` · `scan` · `haul` — canon verbs inside the 40 budget, marked *"step 11
  (markets and the production graph)"*. **A production chain costs zero verb budget.**
- `MAX_DELEGATION_DEPTH` + full VC chain validation — built and tested for a chain `Grant` cannot
  express (see §2).
- Lane `transitTicks` and the deliberately-generated single INTER lane per constellation pair —
  *"it is the chokepoint that makes interception a real game"* — **nothing in the engine reads lane
  identity.** A hand `IN_TRANSIT` is at neither endpoint, so **a convoy on a lane is invulnerable**
  and `ESCORT` has nothing to escort against.
- `ServiceDesk` — 664 lines, six free services, instantiated in one test. `agent.md` §12's first
  advice is *"Call `plan_hands` before every allocation decision"*, and §12.1 says without them
  *"agents do not flail visibly; they play blandly and identically, and the agent-quality gate fails
  silently."* Its methods take `ObserveSources` (21 fields, `observe/sources.ts:226`), all of which
  exist on the live `Runtime` — so the adapter is **M, not L**, and it is the same adapter the sensing
  tier needs.
- `'DECAY'` — a declared `StandingCause` with no writer. §6.4 requires a recency half-life;
  `reckoning/standing.ts:44` says outright *"**Nothing here ever falls**… this module has no decay
  path"*. Standing is therefore a **permanent monotonic moat**, which is A10's calcification failure,
  and it blocks any structural standing gate.
- `offer_surety` — canon, unbuilt, and fully designed in §6.4: *"a betrayal slashes them too, so it
  is multi-victim, it cascades, it renders as the trust graph."*

---

## 2. The halt I made likelier, and the predicate that made A6 a demo

**INV-23 halted the world on four legal grants.** Measured directly:

```
a→b, b→c, c→d, d→e   →   HALT INV-23: "grant chain from p:a is 5 deep"
```

Nobody re-delegated anything. `vGrant` sets `grantor` to the actor and the grant binds the
grantor's **own** stores; `Grant` has no `parentGrantId`, so holding a grant from A does not let you
delegate A's authority onward. Read as *who may spend whose money*, `a→b→a` is two neighbours trusting
each other and `a→b→c→d` is four principals trusting one other. Neither amplifies anything.

`loop.ts` calls an agent-reachable halt *"worse than a crash because it is a weapon"*, and enrolment
is free. **The `grant` affordance I shipped that morning offers exactly this shape**, turning a latent
halt into a likely one. Three existing tests asserted the false halt — the credential-chain model
applied to the grant book — the same shape as the `agent.md` test that pinned an abandoned WORKS rule
and held it in place.

Fixed with a named `hasDelegationParentage()` predicate plus a **tripwire** that fails the moment
`parentGrantId` appears, naming the four rules that must land with it. The real property is untouched:
`identity/vc.ts` still refuses `CREDENTIAL_CHAIN_CYCLE` where chains actually exist.

**And offices were inert because of one existence check.** `vCreate` refused
`on_behalf_of=<syndicate>` because a syndicate has a stores account and no holding, and `create` is
the only verb wired to `on_behalf_of`. So a house could pool a treasury, vote an office by MAJORITY,
and issue a grant that rendered correctly on both sides — and the holder could not spend the pool on
**anything**. §8's own complaint is *"there is no quartermaster who could empty the vault at any
moment"*; there was one, behind that predicate. Both critics named this, independently, as the highest
value change available.

Two findings from fixing it, both worth more than the fix:

- **There is no `contribute` verb.** Pooling rides on `apply` (*"applying again deepens the
  commitment. One concept, not two"*) — defensible and completely undiscoverable.
- **A freshly enrolled founder cannot fund a house at all.** `contributeToSyndicate` gates on
  `freeCash` — earnings only, never the starter stake (D7). So the org-scale A6 loop is now spendable
  in principle and unfundable in practice until somebody has earned.

---

## 3. Where a rules surface was impossible rather than merely wrong

`set_delivery_intent` accepted only `{"intent": {"verb": ..., "params": {...}}}`. `cast/parse.ts:199`
rejects any non-array object in params as `nested-object`, and **a rejected param discards the whole
plan** — so one nested key costs a cast member its entire wake. Production had logged it verbatim:

```
cast: thessaly reply discarded (param-intent-nested-object)
```

I had read that line hours earlier and filed it as *the model malformed a param*. It was the
opposite: the model was right and the surface was unsendable. A3 makes durable intents the reason an
offline agent is viable and R19 makes the Levy payable by one — so the mechanism protecting absent
players was unreachable by the client that plays most of the world.

---

## 4. The show: structurally short, not just visually rough

The spectacle critic's verdict was *"a spreadsheet with very good prose"*, and the frame contract is
the best-argued file in the repo. Filtering to what **no later client work can fix** — i.e. data the
frame never carried:

**Fixed this session.** The running order had a **category error**: `atStake` is `Minor` for
settlements and lapses and `Qty` — units of a good — for plunders, all compared on one axis. With
demands topping 6,000 and a take multiple of 2, a plunder of 7,000 ore outranked a default of 6,000
minor every time, and 6,000 minor is the size of a typical elective half. The live frame put its one
broken promise at beat 7 of 12 with three plunders after it: not a directorial choice, an integer in
one unit beating an integer in another. Now a beat **class** ranks across kinds, magnitude compares
only within a class, and select-then-order means the climax is never what truncation drops. §14.3 is
**arithmetic** now — `assertFrameBudgets` refuses a frame carrying a broken promise that does not end
on one.

Also fixed: the docket said **"They have dealt before, and it held"** about pairs whose only prior
deal was a *default*, because `haveDealtBefore` never checked whether it held. A5′ — the record being
wrong about a named relationship, on the surface other agents price each other from.

**Still missing from the frame** (not client work):

- `CastChip.line` is hardcoded `''` and `modelBadges` has no producer, so every handle renders bare.
  §14.1's answer to *"who am I watching"* is two dead fields. **One line in the renderer** turns
  `kestrel` into `kestrel — 41 ventures, never defaulted`, which is what lets a stranger root for
  anyone.
- `nextDocket` is literally `docket` aliased, so **the show has no closing card** — the thing that
  makes a viewer come back tomorrow.
- `AuthorityLine` has no `issuedAtTick`/`renewals`, so the **age** of an office — the whole substance
  of "months of honest work, then the grant" — is invisible, while §11.2 explicitly makes the renewal
  chain PUBLIC. An unimplemented permission, not a withheld one.
- **No convoy motion exists at any layer.** No movement event kind, no frame field. §11.2's headline
  asset (*"a convoy is the map's motion, and the map is the show"*) is quoted in four files and built
  nowhere.
- The mandated 140-char `reason` corpus — collected specifically because it *"yields the entire ticker
  corpus for free"* — never reaches the ticker, which carries raids only.
- `MISSED` raids are filtered out of the rundown. That is the one beat dramatising why cargo is
  SENSED, and it is the only raid outcome that never reaches the screen.

### ⚠ The finding I would escalate: SENSED is arithmetically empty

A WORKS is the only faucet, and every outflow is public **and attributed**:
`worksLines.extracted` − `claimLines(due−owed)` − `tributeLines` − `raidLines.lost` − `market.filled`
(which names `buyer` and `seller`). So a principal's holdings are not estimable, they are a
**subtraction**. Frames are immutable and cached, so the series is permanently available.

Parity holds perfectly, which makes it **worse** than an A9 violation: it is a §11.2 violation that A9
guarantees every attacker can read. And it removes the price of reconnaissance — `SURVEY` becomes
decoration, decoys pointless, `MISSED` impossible.

The structural cause matters more than the fix: `projection.ts` argues each field against §11.2
**individually** and never asks whether the admitted set, accumulated across frames, is *invertible*.
Cheapest remedy: publish market prints **unattributed** (a chart needs no names). The test this needs
is an **invertibility probe** — given N frames plus the public feed, try to reconstruct a principal's
SENSED holdings and assert the residual exceeds a stated band.

---

## 5. INV-26 has never checked a single structure

The invariant whose entire job is bounded growth (scar #3) always takes its skip branch:

```
aggregate.ts:399   skip('INV-26', 'no serialized structures supplied; the cap walker only sees what it is handed')
```

`grep "capped:" src/` returns **nothing** — no producer ever supplies them — and
`requireAllInvariants ?? false` makes the skip silent. **Scar #14b inside the invariant layer.**

I mapped every array in every registered state table to size the fix. Sampled at tick 400 with six
principals:

```
world        principals[6] holdings[6] hands[18] hands.0.cargo[0]
ledger       accounts[132] lots[6] encumbrances.rows[0] encumbrances.exposure[0] encumbrances.perEvent[0]
venture      (root)[115] .0.preference[0] .0.countersigned[2] .0.roles[2]
levy         plans[4] plans.0.lines[5] payments[12] ballots[12] chronic[6] shortfalls[6] seatedAt[6] settled[1]
grant        grants[0] spends[0]
seal         resolved[1] seals[24]
standing     rows[3] changes[10]
sovereignty  claims[0] delinquency[0] plans[0] payments[0] ballots[0] shortfalls[0] cessions[0] bondLocks[0] epochs[0] settled[1]
market       orders[0] fills[0] closed[0]
raid         raids[1] raids.0.parties[0] victimCooldown[1] stageHeld[0]
election     (root)[14]   syndicate  syndicates[0] proposals[0]   works  works[0]
obligation   live[7] secured[0]   delivery  (root)[5] .0.holders[2]   attribution  (root)[0]
```

**Wiring must be opt-in per structure**, because *"an array with no declared cap is itself a
violation"* — passing a book with one undeclared array would halt the world. Note `venture (root)`
already held 115 rows at tick 400 with no cap constant, which the architecture critic identifies as
the largest uncapped structure in hashed state.

---

## 6. The scaling claim is no longer true

`CLAUDE.md` §6 says *"every remaining risk is a correctness risk, not a capacity risk."* The
architecture critic's arithmetic (which I did not independently verify) says otherwise, and the
failure mode is a **halt**, not lag — `stepBudgetFor` has no term for goods, books, lots, locks,
ventures or positions, and exceeding `stepCap` aborts the tick by the same path as an invariant
failure:

- **INV-5 is O(P × R)** where R is every encumbrance row ever created, because `release()` sets a flag
  and nothing deletes rows. At 300 principals with modest churn, R ≈ 10⁶ after a season → ~1.5 s/tick,
  plus serialising all R rows into `state_hash` every tick.
- **`clearMarkets` sorts every lot in the galaxy**, once per ask principal per book. At 240 books and
  10⁴ lots: ~10⁸ comparator calls, seconds per tick. **Not history-dependent** — it bites now.
- INV-7's posting sum was fixed with a prefix cache, but **mirror 3 still walks every batch ever**,
  and **INV-1 accepts `sinceIndex` and nobody passes it**.
- Three live caps have the shape *"constant bound on a population-scaling list"* — the shape that has
  already halted this world once. `MAX_LEVY_BALLOTS = 512` binds at ~171 concurrently-voting
  principals, below `DEFAULT_SEATS = 300`. (It refuses a vote rather than halting; the critic's
  summary overstated this and its own calibration section withdrew it.)

---

## 7. The build order all three converge on

**Phase A — before any enrichment.** Bound the encumbrance table (nothing reads a released lock; every
scan filters them out), index `lotsInAccount`, fix the three population-scaling caps, wire INV-26
opt-in. These are correctness, not features, and two of them are agent-reachable halts.

**Phase B — the cheapest depth per line of code.** The `ObserveSources` adapter, which unblocks the
six free services **and** the sensing tier **and** forces the duplicate-`buildObservation` decision.
SPEC §12.1's own argument is the strongest on the list: hand allocation × role filling × counterparty
selection × split × limits is *"the exact shape LLMs are worst at"*, and a memory-equipped planner is
bottlenecked precisely there. Zero budget — they are explicitly not verbs.

**Phase C — standing decay.** Small, specified, and it gates everything about structural standing.
Without it early honesty is a permanent advantage and there is no live trust market to reason about.

**Phase D — the production chain.** Highest ceiling of the eight ideas and the only one rated L. The
engine is already good-agnostic below **one** string literal (`levy/params.ts:39`), and `extract` /
`refine` are pre-paid canon verbs. But its value is in step 4 — giving a venture a goods leg — because
today **proceeds are minted from a faucet with no goods leg at all**: a `HAUL` moves no cargo, a `DIG`
extracts nothing. That is exactly the failure §10.1 calls fatal (*"venture proceeds came from an NPC
buy order"*). Steps 1–2 alone add catalogue without demand.

**Phase E — chokepoints.** The topology is deliberately built and nothing reads it. Do **cargo-on-lane
before hand interception**, because INV-10 ties a hand's ETA to the transit table and cargo loss
leaves it alone.

**Deferred.** Delegation chains (after the INV-23 tripwire fires, since the narrowing rule has never
been written down and A2's corollary is that a formula nobody has written cannot ship). The
information market (blocked on there being no SENSED tier on the live path — *you cannot trade a tier
nothing produces*). Treaties as a real clause table (do offices first and see whether a bloc forms).

**Do not build prediction markets.** The corpus ranks them CUT twice with reasoning specific to this
design, and the argument is decisive: **paying money on defaults inverts all five of §15.4's
false-default defences.** Today nobody profits from a fabricated default, which is why those five
suffice. `offer_surety` is the same strategic content with insurable interest, already canon, already
designed in §6.4, already carrying a cascade render — and M rather than XL.

---

## 8. Where I was wrong, again

Three more this session, all the same shape as D13 §5 — **reasoning where I should have been
reading.**

1. **I nearly silenced a true alarm, then nearly kept a false one.** On the deciding-share floor I
   first computed it structurally unreachable, then talked myself out of it on a wrong denominator,
   and was about to call the alarm truthful and hunt a cast bug. `health.ts`'s own comment had
   already settled it. Silencing a *true* alarm would have been the worst available outcome.
2. **My own test described a gate without touching it.** The grant test asserted only that no office
   appeared before the first Reckoning — and deleting the `kept > 0` gate left it **green**, because a
   relation row does not exist until two principals have dealt. Rewritten to check every offer against
   the record justifying it.
3. **The docket's A5′ assertion is vacuous and I labelled it rather than dressing it up.** I know it
   is vacuous because I mutated the fix and it stayed green. The cause is worth more than the test:
   **the heuristic cast never breaks a promise** — zero DEFAULT pairs across six seeds × 900 ticks — so
   no heuristic-driven test can reach that path, and `AGT-E1` ("does anyone betray anyone?") is
   unanswerable without LLM agents. Nor can the state be faked: a DEFAULT must cite an eventId in the
   `DefaultRegister`, so a synthetic one halts. A5′ enforced structurally.

And a live HARD RULE 4 violation the critics flagged that I have **not** fixed: **"claim" names two
agent-facing concepts** — a territorial claim and a public statement. That is scar #1's exact shape,
already shipped, and §3 is a rules surface rather than a style guide.
