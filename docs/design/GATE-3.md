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
