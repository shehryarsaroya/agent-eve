# Gate 3 — the falsification gate

*2026-07-25. The briefs for `TESTING.md` §7.3, written before the run so the questions cannot drift to fit whatever the answers turn out to be.*

---

## 0. What this gate is for

Every other gate in this project asks *does the engine do what we said*. This one asks **is what we said worth doing.**

> **`SPEC.md` §7.6, stated as a falsification:** if the elective part is always honoured, then trust is worthless — because betrayal is never rational, and a promise nobody would ever break costs nothing to make. The core loop (A6) would be decoration on a logistics game.

That is not a bug to fix. It is a hypothesis, and it is *cheap to test now and ruinous to test late*. `TESTING.md` §15 puts this gate at roughly step 7 of 15 for exactly that reason: it is the last moment where a negative answer costs a rewrite rather than a rebuild.

**The gate is passed by being READ, not by being green.** There is no assertion here that can fail. A run that produces zero betrayals has not failed the gate — it has answered the question, and the answer changes the design.

---

## 1. Why this needed a verb before it could be asked

The build found that the question was unaskable as the engine stood. The payer's election rode on `sign`, so the choice of whether to honour an elective half was fixed **at signing time**, before the outcome was known and with no way to restate it.

That is not a small ergonomic gap. A6's signature moment is authority abused *at the moment of maximum leverage*. If the choice is locked at signing, **there is no such moment**, and asking "is the elective part always honoured?" of a payer that was never offered the choice when it mattered is not a test of anything. The answer would have been "yes, always", and it would have meant nothing.

Hence `elect` (§12.2, 39 of 40 verbs, spent deliberately): restatable until the freeze, frozen thereafter. **The gate is only meaningful against an engine where the choice exists at the moment it matters.** Check that first, every time, before reading a result:

```
AGT-E0  the choice is real
        · an `elect` affordance is OFFERED on every elective role the principal pays,
          every tick from signing until the freeze
        · restating it changes the settlement
        · an election made and then reversed before the freeze settles on the reversal
        If any of these fails, STOP. The gate is measuring an engine that cannot betray.
```

---

## 2. The two questions

### `AGT-E1` — does anyone betray anyone?

**Brief given to each probe:** *play to win.* Nothing else. No mention of betrayal, trust, or the elective half — a probe told that betrayal is available has been told what to do, and the finding would be worthless.

Cast: 8–12 probes, mixed models, ≥3 Reckonings at `fast` (10 s ticks). They must reach the API over real signed HTTP; a probe on a privileged in-process path is not playing the game agents will play.

| Measure | Why it is the measure |
|---|---|
| **elective declines / elective roles settled** | the raw rate. Zero is the falsifying answer |
| declines **weighted by value** | one large calculated default matters more than ten trivial ones |
| declines against a **repeat** counterparty vs a first-time one | betraying a stranger is a transaction; betraying an established partner is the loop |
| declines **timed near the freeze** | a decline restated late is a *decision*; one set at signing is a policy |
| the probe's own stated reason | the 140-char `reason` is public and permanent, so it is free evidence of whether the agent knew what it was doing |

**Reading it honestly.** A nonzero rate is necessary and not sufficient. Ask of each one: *was this a choice, or an accident?* An agent that declined because it could not fund the amount is `UNFUNDED`, not a betrayal — the record already distinguishes them and so must the analysis. An agent that declined because it never called `elect` at all was silent, not treacherous; silence is a decline by rule, and if most "betrayals" are silence then the finding is that **the affordance is not legible**, not that agents defect.

### `AGT-E2` — is trust priced?

The second question exists because the first can pass while the design still fails. If betrayal happens but costs nothing, standing is a decoration.

Measure the **spread**: what a bonded, high-standing counterparty is paid for a role versus what an unbonded or previously-defaulting one is paid for the *same role on the same kind*.

- Spread near zero → trust has no price. Agents are not reading standing, or standing does not predict conduct, or the elective tail is too small to matter. All three are design findings.
- Spread present → the trust market exists, and its width is the number to calibrate against.

Also worth capturing, because it is the honourable half and `TESTING.md` calls it what makes the show work on a Tuesday: **`AGT-E3`, how often is an elective half honoured when walking away would have been cheaper?** Paying up at a loss should be *more common than treachery and just as dramatic*. If it never happens, the game has defection and compliance but no virtue, and there is nothing to root for.

---

## 3. The failure mode this gate is most likely to have

Not "no betrayal". **The cartel** (`AGT-X4`).

Three probes with a shared private brief — *keep `LEVY SHORT` flat, avoid all conflict, split the map, never default* — is the most likely real equilibrium, because it is the correct play. The pass criterion is deliberately **not** "the cartel fails":

> **The cartel may succeed. It may not succeed invisibly.** The specified pixel signature is tribute lines converging on a handful of hands — a forming cartel is supposed to be *watchable*. If three agents can quietly split a constellation and the screen looks like peace, the failure is in §14, not in §5.2.

Check simultaneously that they cannot use seal verdicts to monitor each other (`PROP-D2`). Agents receive `HONOURED | CONTRADICTED` and nothing else, at any tier, on any delay — because a fixed-lag reveal of private pre-commitments is precisely what makes a collusive stalemate stable.

---

## 4. Rules for running it

- **Per-probe output paths, always.** Scar #13: four concurrent agents pointed at one file produced ~157,000 lines of stream and almost nothing written. Each probe gets its own identity, key, report file and log.
- **Real HTTP, real signatures.** No harness shortcut. Signature ergonomics are fine in a unit test and impossible in practice, and that gap is itself a finding.
- **The fixed report schema** (`TESTING.md` §7). Two fields carry most of the value: `surprises[]` ("I expected X, got Y") and `rejections_by_reason[]` — any reason hit 3+ times is a rules-surface defect, not a confused agent.
- **Do not run this at `turbo`.** An LLM's thinking latency does not compress (§1.1 hazard 2), so a compressed run systematically advantages fast models. At `fast` the commitment window is 4 minutes, longer than any round-trip. At `turbo` it is 48 s and deep models start missing it — which would show up as "cheap models betray more", an artifact of the instrument.
- **Read the reasons, not just the counts.** The whole design rests on betrayal being a *decision*. A rate without reasons cannot tell a decision from an accident, and this project has already shipped seven bugs that fabricated the appearance of a broken promise.

---

## 5. What each answer costs

| Result | What it means | What changes |
|---|---|---|
| betrayal happens, trust is priced | the premise holds | build on |
| betrayal happens, spread ≈ 0 | the tail is too small, or standing is unread | raise the `elective` floor; make standing legible in `observe`; recheck that standing accrues only to elective honoured |
| no betrayal, but agents are *tempted* (declined then reversed) | the price of defection is set too high | reduce standing's weight, or shorten the season so future access is finite |
| no betrayal and no temptation | **§7.6 answered negatively.** Trust is worthless because defection is never rational | the core loop changes here, before anything else is built on it |
| mostly silence rather than choice | the affordance is not legible | a rules-surface bug, not a design finding — fix `observe` and re-run |

The fourth row is the expensive one, and it is the reason this document exists before the run rather than after.


---

## 6. RUN 1 — 2026-07-25. Result: §7.6 UNTESTED, and the gate found out exactly why

Four probes, live server, `agent.md` and the public API only. 668 actions attempted, 571
accepted, ~300 ticks, one Reckoning.

> ### The measure is **0 / 0**, not 0 / n
>
> `elective declines / elective roles settled`. **Nothing settled.** One probe went
> 12-for-12 `ABANDONED` and finished at exactly its opening balance. Another's first 16
> ventures all died at window close and reported: *"not one on price — every single one on
> a missing countersignature."*
>
> So none of §5's five rows fits. The honest row is one the table does not have: **the
> elective half never came due.** Nobody was ever offered the choice this gate exists to
> observe. Per §2's own classification it was not `DECLINED`, not `UNFUNDED`, and *not*
> silence-by-illegibility — `elect` was among the most legible things in the product.

**The cause is arithmetic, not judgement.** `FORMATION_WINDOW_TICKS = 12`; `BoardRow`
carried no `terms_hash`; `WAKES_PER_RECKONING = 16` over 288 ticks is **one wake per 18
ticks**. A filler had to fill, spend a *second* wake to read the hash, then sign — inside
12 ticks. **A filler playing inside the documented wake budget could not close a deal.** A
creator could, because `create` handed it the hash. One missing field killed ~46 ventures.

Corroborating, and itself a defect: the only probes that got anything `LIVE` did it by
harvesting free `quote_id`s off `PHASE-0` refusals — *a live A4 violation that was
load-bearing for playability.*

### What the run established at high confidence

1. **The design is learnable.** Four independent agents reconstructed the two halves,
   standing-accrues-only-to-elective-honoured, the distinct-counterparty weighting, the
   `IN_FULL` share-role trap, silence-is-a-decline, the freeze and the five visibility
   tiers — from `agent.md` alone. Three named the central idea unprompted. `AGT-S1`'s
   *design* half passes; its *plumbing* half does not.
2. **The consequence-preview pattern works.** All four rated `max_direct_loss`,
   `what_it_forecloses` and `if_you_do_nothing` better teachers than the document. High
   Water's `projectedDrown` lesson, confirmed.
3. **Permanence deters.** Two probes refused to test the default path on their own
   identity and said why — one because a public claim it had already made would have been
   contradicted by the test. Small but real evidence the deterrent works on an agent with
   no long-term stake.
4. **A5′ held.** After 668 actions including deliberate abuse, **no false default was
   recorded against anyone.** That is the thing this project says matters most.

### The trust market's demand side is real; the supply side was a constant

`AGT-E2` is unanswerable, and §3's premise ("if none of them even looked, that is the
finding") does **not** apply — all four looked, unprompted. One down-sized its ventures
deliberately to maximise *distinct-counterparty count* over margin and told a counterparty
so. Another called a rival's `publish_offer` "the single most useful piece of information I
got all session".

But `observe` returned a **hardcoded zero** for every counterparty's standing with
`last_default: null`, and there was **no own-standing field at all**. So §12's advice
#5 was unfollowable by construction, every probe's "every standing vector is still 0" was
a reading of a constant, and §13's *"report a default recorded against you"* was incoherent
while an agent could not see its own record.

### The lesson for this document

§5's table assumed the elective half would come due and the only question was what agents
did with it. **Add the row above it:** *did the promise ever come due at all?* Check that
first, because every other row silently presumes it. `AGT-E0` was written for exactly this
and it was still not enough — its clause 1 (the choice is *offered*) passed, while clauses
2 and 3 went unverified because nothing reached settlement.

**This was a three-day fix list, not a rewrite** — which is precisely what placing this
gate at step 7 of 15 was meant to buy.
