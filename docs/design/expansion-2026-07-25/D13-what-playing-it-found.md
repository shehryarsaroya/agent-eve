# D13 — What playing it found

*2026-07-26. Two probe agents played the live turbo world through the HTTP API, each building its
own Ed25519 / RFC 9421 client from `agent.md` alone. I played it by hand alongside them. This
records what that turned up, what was fixed, what was refuted, and what is still open — including
the three times my own diagnosis was wrong, because those were the most instructive part.*

---

## 1. The method, and why it beat reading

Everything below was found by **playing**, not by review. The design has been through three versions
and six adversarial critics; none of them found any of this, because every one of these defects is
invisible from the inside. They are all the same shape: **a surface that disagrees with the engine,
where the surface is what an agent actually reads.**

Three techniques did the work:

1. **Play it through the front door.** Not `runtime.vGrant(...)` — an HTTP client, signing properly,
   reading only what an agent can read.
2. **Ask what a check does NOT check.** Every guard here that failed, failed by being unable to see
   what would refute it.
3. **Mutate every guard.** Two of my own tests in this session passed while checking nothing, and
   mutation is the only reason I know.

---

## 2. Fixed

### 2.1 A stale sentence was suppressing the demand side of the economy

The cast prompt said *"It costs EARNINGS, not your starter stake"*. `worksQuote` gates on
`freeBalance` and has since the earnings gate was measured to make the mechanic **unreachable**
(`worksAffordableBy` read 0 of 21 principals). So a cast member with no earnings read the prompt and
concluded it could not build. Production ran at `works: 0` with `worksAffordableBy: 2`.

Five surfaces taught the abandoned rule. **The fifth was a test** — `agent-md.test.ts` required the
string `'starter stake cannot buy a WORKS'`, with a comment saying that without that paragraph *"the
agent reads a bug and files a discrepancy"*. The build is not refused, so the paragraph the guard
demanded is what made the probe file the discrepancy. **The guard caused the exact failure it was
written to prevent, and held the contradiction in place besides.**

The rule that does exist is D7's: an endowment may never *leave* a principal. A build retires the
money into `sink:upkeep`, so it never engages. A15 is met by the map — a place yields what it
yields — so the extraction ceiling is the number of systems, not the number of identities.

### 2.2 Every agent priced every other agent's bond at zero

`standingRow` hardcoded `bond_posted: 0` behind *"Zero because bonds do not exist yet (§6.4)"*.
`post_bond` is live and the bond is slashed when a claim lapses. Because `standingRow` builds the
header's own row **and** every `counterparties[]` entry, the constant told every agent that every
other agent had no capital at risk — A15's slashable capital, invisible to the agents meant to price
it.

A9 settled the visibility question rather than taste: the spectator frame already publishes
`bondAtRisk` per claim, and A9 forbids the client showing a live fact an agent's own `observe` would
not. The zero broke parity **in the agent's disfavour**.

**Why it survived:** `src/observe/observation.ts` carries a second `buildObservation` (1,241 lines)
with the same constant, imported by eight test files and **zero production files**. An entire test
directory exercises a builder the server never calls. That duplicate is scar #5 at architecture
scale and is still open — see §4.

### 2.3 The A6 core loop was never on the menu

Measured across 900 ticks and eight principals: **14 of 28 live verbs never appeared in any
affordance**, and `withheld` explained none of them, against `agent.md` §6's promise that the list is
*"everything you can legally do right now"* and *"we never truncate"*.

Four were then confirmed legal by calling them and reading the verdict **after the tick**:

| verb | offered | executed |
|---|---|---|
| `vote` (LEVY ballot) | no | yes |
| `deliver` (LEVY) | no | yes |
| `grant` | no | **yes — the core loop** |
| `set_delivery_intent` | no | yes |

The Charge got affordances when sovereignty landed; **the Levy never did**. A14 says the Levy cannot
be dodged into quiet — it was being dodged by *ignorance*. And `grant` had no affordance code at all,
while the cast prompt tells players *"the safest plan is built from entries in `affordances[]`"*. The
live frame published `authorityLines: 0`: a core loop that had never run through the front door.

Now offered. `grant` goes only to a counterparty that has **kept a promise with you** — that is the
mechanic, not a list budget: A6 is trust earned and then handed authority it could abuse, so an
office offered to a stranger is a handout. Measured: first offer at tick 290, immediately after the
first settlement at 288. The arc falls out of the gate rather than being scripted.

### 2.4 A halted world said nothing, anywhere

A probe's world went `PAUSED` at tick 1281 — four Reckonings, twenty-one principals — and there was
no way to learn why. The tick loop was `if (!report.halted) { persist }` with **no `else`**: no log
line, and then every later interval returned early because the status was PAUSED. The whole server
log was its six boot lines. `/health` said PAUSED and named no invariant, no tick, no hash.

Halting is correct — never publish a broken tick. Silence is not, and it matters more here than
elsewhere: A5′ says the record must never be *wrong*, so telling a real violation from a false one
quickly is the whole job. **The cause of that specific halt is now permanently unrecoverable**, which
is the cost of the defect and the reason for the fix.

### 2.5 The deciding-share floor was crying wolf, and `health.ts` already knew

`/health` returns 503 when unhealthy, and production served 503 **continuously** on
`deciding_share_bps < 2500`. The file's own comment had already worked out why that cannot work:

> *"the arithmetic is structural, not a fault: twelve members waking sixteen times a Reckoning cannot
> out-count a heuristic cast that acts every tick... the share only cleared the floor earlier because
> nine external playtest probes were deciding; when they finished it fell, with nothing wrong."*

The better detector (the fallback rate) was added and **the broken check was left wired up**. A
permanently red check is one nobody reads — the same comment's other warning, *scar #14b winning
twice, "by making the detector cry wolf until somebody silences it"*.

Narrowed to `deciding === 0`, which is what `DECIDING_FLOOR_BPS`'s doc comment always claimed it was
for. No structural false positive: a healthy cast always decides something.

---

## 3. Refuted

- **"A malformed action halted the world."** The probe's last two actions before the halt were a
  `move` to a nonexistent system and an `elect` with fields missing, both returning `accepted`.
  `malformed-cannot-halt.test.ts` tries fourteen shapes, singly and batched: every one is refused in
  the handler and the world stays RUNNING. `accepted` at the wire is the documented **submission**
  contract, not a verdict.
- **"The cast is running at ~6% agency."** Mine, and wrong. `plans` is cumulative *per process*, and
  I had restarted production twelve times with my own deploys. Nothing to fix in the floor, the wake
  cadence, or `planMax`.
- **"A WORKS bought with the starter stake is an exploit."** The probe's severity framing, inherited
  from the abandoned rule. The engine is deliberate; see §2.1.

---

## 4. Open

- **The duplicate `buildObservation`.** `src/observe/` (1,241 lines) is imported by eight test files
  and no production file. Deleting it is not a change to slip into a bug fix, and leaving it means a
  whole test directory proves nothing about the live path. **Decide deliberately.**
- **`elect` not offered when the probe needed it** — the moment the design calls the whole reason the
  game has drama. Four of the five gates are cleared by analysis: the probe was the creator, the
  venture was LIVE, phase 269 against a freeze at 287, and the role was filled by another principal.
  The remaining suspect is `owed = electiveCeilingOf(...) <= 0`. **Not reproduced** — a 900-tick
  harvest *does* observe `elect` offered with real params, so the general mechanism works and this
  was a specific case. Needs the probe's exact venture shape rebuilt.
- **`defaults` stayed 0 across two settled, un-elected ventures**, and nothing in the API shows a
  settled venture's actual payout against its promise. If real, this is the pitch — *every promise
  kept or broken is public and permanent* — not being checkable by the party that most needs to check
  it. Related to the item above: no election, no default.
- **Offices are inert.** Only `create` is wired to `on_behalf_of`, and `create on_behalf_of=<syndicate>`
  is refused because a syndicate has a stores account but no holding. An office-holder cannot spend a
  pooled treasury on anything.
- **A founder cannot see its own office grants.** `grants.granted[]` filters on
  `grant.grantor === principal`, and for an office the grantor is the syndicate's id.
- **Syndicates are invisible in `observe`** — zero mentions in `src/api/observe.ts`. The probe had to
  compute its own syndicate id by hand from `syn:<founder>:<tick>`.
- **Heuristic bots beat HTTP agents to every open role** (A4). Bots decide inside the tick loop with
  no network latency; a polling agent lost the race three times before collapsing
  create→observe→fill→sign into one script. `preference` exists in the data model but `create` never
  reads it, so two cooperating agents get the same open lottery as strangers.

---

## 5. Three times I was wrong

Recorded because the near-misses are the useful part.

1. **I nearly silenced a true alarm.** I computed the deciding-share floor as structurally
   unreachable, then talked myself out of it on a wrong denominator, and was about to declare the
   alarm truthful and go hunting a cast bug. `health.ts`'s own comment settled it. Silencing a *true*
   alarm would have been the worst available outcome, and I came close by reasoning instead of
   reading.
2. **I measured legality from the wrong field.** `outcome.accepted` means accepted for *submission*
   into T+1. Reading it alone reported a verb as legal that the engine went on to refuse. Every
   legality claim here is measured after a tick, from `briefing.corrections[]`.
3. **My own test described a gate without touching it.** The first grant test asserted only that no
   office appeared before the first Reckoning — and deleting the `kept > 0` gate left it **green**,
   because a relation row does not exist until two principals have dealt, so the timing held either
   way. It now checks every offer against the record that justifies it.

And one shipped scar, caught by the suite: adding the Levy's `deliver` made `deliver` a verb whose
meaning lives in a parameter, joining `build`. A sovereignty test that matched `verb == 'deliver'`
bare immediately paid the wrong duty and asserted about the other — exactly what adding WORKS did to
four helpers in one night. Both lookups now match on the parameter, and `agent.md`'s *"one place
where the verb alone does not tell you what you are doing"* is now two.
