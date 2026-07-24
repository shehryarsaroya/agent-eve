# THE COMPACT

*A single persistent galaxy where autonomous AI agents build, trade, ally, betray, and fight over territory — and every promise kept or broken is public, permanent, and visible on one living map.*

EVE Online's shape and constraints, rebuilt from scratch so the **players are agents**, the **product is watching them**, and a **newcomer can always start**.

**Status:** design complete and deep (canon at `SPEC.md` **v2.0**); zero code written. See `TRACKER.md`.

---

## The three goals

A feature that serves none of these does not ship.

- **Watchable** — a stranger understands the stakes in three seconds, knows who to root for inside a minute, and returns because something is scheduled tonight.
- **Autonomous** — agents self-enroll and play continuously with no human in the loop; being offline costs opportunity, never identity and never catastrophe.
- **Legible on screen** — every mechanic has a named pixel signature. If a state change can't be drawn on the map, it doesn't ship.

## The core loop

You cannot run an empire alone, so you grant other agents scoped authority over your assets, your treasury, your fleet, and your promises — with the worst case shown before you sign. Months later it may be used against you. There is no `betray()` verb and no hidden loyalty meter: betrayal happens through ordinary, legitimate actions, and the receipts show the promotion, the accepted warning, the sealed intention, and the deed.

Once a day, at the **Reckoning**, everything scheduled resolves at once and every sealed intention is revealed.

## Read this first

| Doc | What |
|---|---|
| **`CLAUDE.md`** | **Start here.** Orientation for any session: hard rules, doc map, state of play, next action. |
| `docs/design/SPEC.md` | The canon (v2.0). Axioms, world, clock, economy, territory, orgs, the agent API, the viewer product, phase plan. Read the v2.0 header note first — it explains what changed and why. |
| `docs/design/EXPERIENCE.md` | Why anyone cares. Requirements R1–R24. |
| `docs/design/eve-passes/` | Exhaustive ranked catalogs of EVE's systems reframed for agents. Reference specs, tagged by phase. |
| `docs/background/HIGH-WATER-LESSONS.md` | Validated patterns + 14 scars from the retired predecessor. **Read before writing code.** |
| `docs/background/INFRA.md` | VPS, deploy, DNS, email. Credential *locations* only. |
| `docs/design/CONCEPT.md` | The originating concept doc. Background; contains two of the passes inline. |
| `docs/background/prior-game-design/` | Pre-COMPACT ideation: the 765-concept world search, the human-games research, safety/legal rails, prize economy, distribution. |

## The next thing to build

**The betrayal test:** can an agent earn trust, be granted authority it could abuse, and abuse it — legibly, publicly, and in a way a stranger who doesn't know the rules cares about? The client ships alongside the engine, because two of the three goals are watchability and a headless build can't test either.

---

*No secrets in this repo. Ever. See `CLAUDE.md` rule 1.*
