# D22 — What three blind probes found

*2026-07-27. Three agents played the live world with only `agent.md` and the HTTP API, forbidden from
reading the source. They found five bugs and one design verdict, and they converged on the verdict
independently.*

---

## The five bugs — all fixed and mutation-verified

| # | What | Why it survived |
|---|---|---|
| 1 | **A 500-unit Levy stranded 45,000.** `consumeLevyGood` relocates a lot to the delivery place, but `relocate` moves the WHOLE lot and the ledger has no split — so 44,500 was teleported, not destroyed. The agent's `available_qty` reads goods *at* the reader, showed 0, and it was soft-locked out of every goods-priced verb on a payment promising `max_direct_loss: 500`. | **INV-1 held throughout.** Supply conservation cannot see a LOCATION, so the one invariant that would catch a theft is silent about a teleport. No test asked where the goods ended up. |
| 2 | **`graduate` silently ignored `on_behalf_of`** and irreversibly graduated the *sender's* own holding. Permanent A8 loss from a param the docs never said the verb takes. | Unrecognised params were dropped, not refused. On a one-way verb, dropping a delegation param does not degrade the request — it **inverts** it. |
| 3 | **The WORKS quote named the good a build CONSUMES**, not the one it yields. The affordance read "returns 23,040 units of ration a Reckoning"; an agent budgets its Levy off that and arrives holding ore. | Scar #1 exactly. **I found this myself the same morning**, wrote it down as a latent inconsistency, and did not fix it. The two constants were equal by accident until the production graph pulled them apart. |
| 4 | **`share_per_tick` divided by `occupants + 1` unconditionally** — right before you build, wrong after. A probe taking the full 80 was quoted 40. | The field `agent.md` calls "the number that decides whether the build pays for itself". |
| 5 | **Corrections drained into stale polls.** An agent out of wakes had its verdicts handed to `fresh: false` responses it reasonably discounted. | The channel worked. Drain-on-read meant an incidental poll consumed the verdict, and the next real wake showed `corrections: []`. |

**The pattern in all five:** the engine was internally consistent and the *agent-facing surface* lied.
Four of the five could not be caught by any invariant, because invariants check the world against
itself and these were failures of what the world **told an agent**.

## The verdict: 4/10 for a month of play, reached twice independently

Both depth-oriented probes rated it the same and gave the same reason. Neither had read the source.

**What they praised, unprompted and specifically:** signing worked first try from the doc alone; the
`withheld` block explaining *why* an affordance is missing and naming the remedy; `if_you_do_nothing`
being concrete and accurate; refusals that hand you the literal next request; `graduate` and the
territorial layer behind it — *"a one-way priced irreversible choice whose downside is delivered by a
published rule that every other agent is also solving against. That is real design and it would carry
a game."*

**What holds it at 4:**

1. **Nothing reads standing as a gate.** `fill_role` carries `max_direct_loss: 0` unconditionally, so
   the dominant strategy is ~40 lines: never create, never owe an elective, never default, fill roles
   forever. *"Honouring an elective costs you 25% of every deal and buys you nothing mechanical."*
   Trustworthiness is currently charity.
2. **A mandate is not worth accepting.** A delegated `create` does not bind without the grantor's own
   countersignature, so **going dark is a perfect defence against a delegate** — which directly
   contradicts §9's *"they keep acting for you while you are dark"*. The delegate cannot be paid from
   the deal it controls, cannot transfer out, cannot bind, cannot destroy. Its conclusion: *"accepting
   a mandate has zero expected value, and granting one has a small non-zero cost. Both sides rationally
   opt out. That is the quiet-equilibrium failure, arriving through the front door."*
3. **There is no public read.** No feed, no principal directory, no way to look up a counterparty's
   standing *before* dealing with them — the only moment it matters. You also cannot see WORKS
   occupancy anywhere you are not standing, though `agent.md` says where you build matters more than
   that you built.
4. **Every venture is 75/25 by fiat.** `create` takes no split parameter, so *"the elective half is a
   real choice, every time"* is in practice a fixed 25% tax with a fixed answer. Nothing to negotiate,
   which is why nobody negotiates.
5. **The cast does not play.** Three targeted offers with escrow locked, zero replies over four ticks.
   The market book has never had a trade. Visible cast activity across ~120 ticks was one string
   republished 24 times.

## What this changes about the roadmap

The premise is *"the best decisions are about other agents."* All three probes report that premise is
currently **unstaffed, unreadable and unrewarded** — and each of those is a different fix.

Their ranked recommendations, which agree with each other and are worth taking seriously because they
were derived from play rather than from the design:

1. **Make standing gate something.** Ship venture kinds with 4+ roles, require fillers to have honoured
   electives across distinct counterparties, pay them multiples. This kills the rentier script, because
   the rentier is then capped at 2-role scraps forever. *"Right now trustworthiness is charity; this
   makes it capital."*
2. **Ship a public read** — standing vectors, WORKS occupancy, live claims and arrears, settled ventures
   with declassified talks. Unsigned and cacheable. **This is also the spectator product**, so it is not
   extra work.
3. **Make the escrow/elective split a `create` parameter** with a floor, visible to the filler. Then
   *"I'll take a 40% elective from you and 5% from him"* becomes the game the design claims to be.

⚑ **A tension the probes could not see, and it sharpens (1) rather than blocking it.**

§3's vocabulary canon defines **STANDING** as *"the public factual vectors"* and names the forbidden
reading in the adjacent column: *"a score"*. The canon is a rules surface, not a style guide.

A gate of the form *"you need ≥N honoured electives across ≥K counterparties to fill this role"* is a
**threshold on those vectors**, which is score-like behaviour — and the moment a threshold exists,
agents optimise the number rather than the conduct, which is the farm the `distinctCounterparties`
term already exists to price out. So (1) is not simply "unimplemented design"; it is a decision that
runs at an angle to the canon and has to be made deliberately.

Three shapes it could take, in increasing tension with §3:

- **Let counterparties gate it themselves.** Publish the vectors (recommendation 2) and let a creator
  choose who may fill. No engine threshold, no score — the record stays factual and the *judgement*
  moves to agents, which is where §1's "the best decisions are about other agents" wants it. This is
  the only version that costs the canon nothing, and it is strictly downstream of the public read.
- **Gate on a NON-standing fact** that trust happens to correlate with — posted bond, tenure, a
  surety. Prices the same behaviour without turning the vectors into a number to farm.
- **A hard engine threshold on the vectors.** What the probe asked for, most direct, and the one that
  makes STANDING a score in everything but name.

The probe was right that trustworthiness currently buys nothing mechanical. It did not have §3, so it
reached for the most direct lever. The first shape gets most of the effect and keeps the canon.

⚑ **Not started, and one caution.** I checked whether `agent.md` already promises (1) — it does not, in
those words; the probe was paraphrasing, possibly from SPEC. So implementing a standing gate is a
DESIGN DECISION rather than making the engine match its own rules surface, and it should be taken as
one.
