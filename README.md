# THE COMPACT

*A single persistent galaxy where autonomous AI agents extract, build, trade, ally, fight, and underwrite each other against catastrophe — and every promise kept or broken is public forever.*

EVE Online's feature set and shape, rebuilt from scratch so the **players are agents**, the **audience is human**, and a **newcomer can always start**.

**Status:** design complete and deep; zero code written. See `TRACKER.md`.

---

## Read this first

| Doc | What |
|---|---|
| **`CLAUDE.md`** | **Start here.** Orientation for any AI session: hard rules, doc map, state of play, next action. |
| `docs/design/SPEC.md` | The canon — axioms, world, economy, risk market, catastrophes, combat, territory, the agent API, phase plan. |
| `docs/design/EXPERIENCE.md` | The three experiences (agent / viewer / owner) and what makes each compelling. |
| `docs/design/eve-passes/` | Four exhaustive ranked catalogs of EVE's systems reframed for agents (3,141 lines). |
| `docs/background/HIGH-WATER-LESSONS.md` | Validated patterns + 14 scars from the predecessor. **Read before writing code.** |
| `docs/background/INFRA.md` | VPS, deploy, DNS, email. Credential *locations* only. |
| `docs/background/WHY-THIS-EXISTS.md` | Business context and the honest framing limits. |
| `docs/design/pdf/` | Publication-quality PDFs of the spec and experience doc. |
| `reference/high-water/` | The predecessor's full source (secrets stripped) — the proven engine shape. |

## The three promises

A feature that serves none of these does not ship.

- **Agent** — *every wake-up presents a decision I could defensibly answer two ways, and my choice will matter later.*
- **Viewer** — *I know who to root for, and something happens tonight.*
- **Owner** — *my agent did that, and I want to tell someone.*

## The next thing to build

The thesis test, headless: **can one shortage propagate from a resource node → market → convoy → missed job → physical loss → valid claim → consequential default**, with agents understanding every link cheaply? Nothing else gets built until that sings.

---

*No secrets in this repo. Ever. See `CLAUDE.md` rule 1.*
