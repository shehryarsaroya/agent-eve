# VISUAL — a brainstorming workspace, NOT canon

## 🚨 IF YOU ARE AN AGENT, READ THIS PARAGRAPH BEFORE ANYTHING ELSE IN THIS FOLDER

**Nothing in `docs/design/visual/` is a requirement, a spec, or a decision.** This folder is the owner
and one assistant thinking out loud about how the game should *look*. It contains sketches, rejected
ideas, half-formed layouts and arguments that may be wrong. It is deliberately not written to the
standard of `SPEC.md`.

Concretely:

- **Do not implement anything from this folder** unless the owner names the file and asks for it. A
  drawing here is not a ticket.
- **Do not treat a claim here as true about the engine.** Where this folder and the code disagree, the
  code is right and this folder is stale.
- **Canon for what must render lives elsewhere and is unchanged by anything here:** `SPEC.md` §2 (A13,
  A9), §11.2 (the five visibility tiers), and §13 (the viewer product). Each shipped feature also
  carries its own pixel signature *in its own source file*, which is the real authority.
- **Do not cite this folder in a commit message** as justification for an engine change.

If you are here because a task mentioned visuals, the safe move is to ask the owner which file applies.

---

## What this folder is for

The owner is building the actual visuals later, by hand. This is the space to work out *what the screen
should show and why* first — so that when that happens, the argument is already settled and the data is
already in the right shape.

Two questions this folder exists to answer:

1. **What does a viewer see, moment to moment, and what makes them care?** The product goal is
   *watchable* — a person with no knowledge of the rules should be able to follow a story.
2. **Is the data in the right shape for that?** If a signature needs a fact the frame does not carry,
   that is a finding for the engine, and it goes to `TRACKER.md` — not here.

---

## Ground truth, as of 2026-07-28 — verified by command, re-verify before trusting

**The frame is 20 projections, served as static JSON behind Cloudflare** at
`/compact/frames/latest.json`, plus one archived file per Reckoning and an `index.json`. The client is a
pure renderer over that file. Two consequences worth designing around:

- **Same frame → same picture, deterministically.** No client-side simulation, no drift.
- **The whole history is already on disk as frames**, so a scrubber back through every Reckoning the
  world has ever had is nearly free, and exact rather than reconstructed.

The 20 keys: `map` · `places` · `claimLines` · `worksLines` · `battleLines` · `raidLines` · `saps` ·
`authorityLines` · `syndicateLines` · `tributeLines` · `marketLines` · `standings` · `docket` ·
`nextDocket` · `rundown` · `ticker` · `hallOfFame` · `glyphs` · `meters` · plus `tick` /
`reckoningIndex` / `stateHash`.

### A client already exists, and it has a specific gap

`client/index.html` — one file, ~40 KB, live at `agentinsurance.io/compact/`. It draws **14 of the 20**.

**It draws none of these five:** `claimLines` · `battleLines` · `saps` · `glyphs` · `nextDocket`.

That is territory, battles and wars — so **the four largest features built on 2026-07-27/28 all have
designed pixel signatures and nothing renders them.** Any visual work starts from that gap rather than
from a blank page.

*(Also: the deployed client was measured 4,776 bytes behind the repo, for the same reason `agent.md`
was — it ships only on `deploy.sh`'s `client` target. The `agent.md` half of that is fixed; the client
half is not.)*

---

## The signatures already designed, in the code that shipped them

These were not invented for this folder. A13 makes a named pixel signature a **ship gate** — *"no
feature ships without one"* — so every feature argued its own, and the wording below is from the source.

**From `SPEC.md` §2's own list:**
- a **claim tints a system**
- a **compact draws a link** between two holdings — and a **broken compact snaps that link and scars
  both parties**
- a **venture is a ring whose hollow arc is the part riding on someone's word**
- a **siege closes a ring**
- a **convoy is a line that can be severed**

**THE BATTLE LINE** (combat) — two rows of bars across a **gap that narrows or widens every tick**, the
range race made visible. Bars in four ECHELON rows; width ∝ hull count; height ∝ **EHP fraction**, so a
formation **thins rather than vanishing**. Four overlays: a repair tether, a tackle chain, a **dark bar
for an empty capacitor** (undamaged and operationally dead), a command halo.

**THE SAP** (campaigns) — a notched band from depot toward objective, advancing one notch per breach and
retreating one per rebuff, so **the band is the score**. Dashed while MASSING, solid while PRESSING, and
**hollow when the depot cannot fund the next pulse** — a starving war looks starved a Reckoning before
it dies.

**THE PRINT** (market) — a claim tints a system, a WORKS marks it, a market **prints a price on it**.
Built from **fills only**, ranked by |premium|, so places that agree with everyone drop out first.

**CLEARANCE PIPS** and **DOSSIER THREADS** (compartmented authority) — one pip per compartment on the
delegate end of an authority line; and thin **dashed arcs** to each dossier recipient, tinted by
compartment, drawn from the reveal tick and **never fading**. A revocation snaps the line; the threads
stay.

Plus: **ruins** at a fallen holding, **places named after whoever first developed them**, and the Hall
of Fame.

---

## Two hard constraints on anything drawn here

**A9 — parity, then revelation.** The spectator must never see a live fact an agent's own `observe`
would not. So there is **no dramatic irony live**. But sealed intentions declassify one Reckoning later,
which gives the show a natural two-mode shape: *live*, in parity with the players; and *the Reckoning*,
where the seals open, `rundown` narrates, and you find out what people had committed to before the
outcome was known. §14's RECEIPT REEL is the payoff — negotiation is hosted, so the replay can put every
reassuring thing a traitor said beside the promise it broke.

**§11.2 — movement is public, cargo is only sensed.** *A ship at sea is visible; its manifest is not.*
So a convoy crossing contested space is drawn, and **nobody watching knows what is in it** — including
the raider. That asymmetry is a gift to the camera and should not be designed away.

---

## The open question the owner and assistant have not settled

**Is this one always-on map, or a directed broadcast that cuts to what matters?**

The data supports both. With 36 tribute lines and 16 WORKS, a static whole-map view will be busy and
low-drama; something has to decide *where to look*. The second is a much better show and needs a
**director layer** that does not exist yet — which is why `rehearsal` speed exists in the clock.

That decision is the thing this folder should resolve before any pixels get committed.

---

## Files here

*(none yet — this README is the note that keeps the folder honest)*

Convention, per `CLAUDE.md` §7: dated explorations as `TOPIC-YYYY-MM-DD.md`. Nothing in here is
undated-and-living, because nothing in here is canon.
