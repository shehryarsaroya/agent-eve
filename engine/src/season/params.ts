/**
 * The SEASON's published numbers, and the GRAND VENTURE's — SPEC §5, §7.6, A10.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHAT §7.6 SAYS IS MISSING, AND WHY IT IS THE PREMISE RATHER THAN A FEATURE.**
 *
 * > *With permanent public defaults and repeat play, rational default probability against an
 * > established counterparty is ~1–2%, so trust earns 1–2% and defecting costs all future access.
 * > Nobody defects, nobody pays for trust, and the Phase 0 gate fails for a correct reason.*
 *
 * Two mechanisms make defection sometimes rational, and neither existed in the engine before this
 * module: **the season horizon** (a finite horizon on future access) and **the grand venture** (one
 * un-escrowable prize per season, worth ~40× a typical margin, at a known time, sited in the
 * least-lawful space, announced in advance). Everything below is one of those two, as arithmetic an
 * agent can read before it acts (A2).
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## Nothing here is drawn from an RNG
 *
 * The season length, the FINALE, the grand venture's stage, its yield, its stake and its formation
 * window are constants or pure functions of the map and the tick. So every agent can compute the
 * whole season in advance — when it ends, where the prize is, what it pays and what it costs to
 * contest — and the only uncertainty left in the finale is *other minds*, which is the uncertainty
 * this game is about.
 *
 * Numbers marked *(calibrate)* are simulation starting points, not claims.
 */

import { TICKS_PER_RECKONING } from '../core/time.js';
import type { VentureKind } from '../core/types.js';
import { minor, type Minor } from '../core/units.js';

/**
 * **How many Reckonings a season lasts.** *(calibrate)* — the one dial, and everything else reads it.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **14, AND THE FOUR REASONS ARE MEASURED AGAINST NUMBERS ALREADY IN THIS ENGINE.**
 *
 * 1. **Long enough for trust to form.** A grant lives at most three Reckonings
 *    (`GRANT_MAX_LIFETIME_TICKS`, §8.1 #5), so fourteen hold four complete renewal links — "months of
 *    honest work" is a *visible chain of renewals*, and a season shorter than a few links has no
 *    chain to betray. A campaign runs five Reckonings (`CAMPAIGN_PULSES`), so a season holds two
 *    complete wars and a finale. The endowment window closes during the fifth Reckoning
 *    (`ENDOWMENT_WINDOW_RECKONINGS`), which leaves nine Reckonings of play on *earned* capital before
 *    the finale asks for it.
 * 2. **Short enough that the finale arrives while people are still watching.** Fourteen Reckonings
 *    at the production tick (288 × five minutes) is **two calendar weeks**, and the finale lands on
 *    the same weekday and hour the season opened on — an appointment, which is A14's whole argument.
 *    A launch audience's attention is measured in days; a 4–8 week first season asks it to come back
 *    for a climax most of it will never see.
 * 3. **The experiment is affordable.** At `fast` (10 s ticks) a season is ~11 hours, so the
 *    season-scale questions TESTING.md names — *does defection rise in the last week, is the finale
 *    watchable* — become overnight runs rather than month-long ones.
 * 4. **SPEC A10's 4–8 weeks is the steady-state band and Season 1 runs short on purpose.** That is
 *    an owner-visible calibration, recorded rather than buried: lengthening it is this one constant.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const SEASON_RECKONINGS = 14;

/** Ticks in one season. Derived, never re-declared, so the two cannot drift. */
export const TICKS_PER_SEASON = SEASON_RECKONINGS * TICKS_PER_RECKONING;

/**
 * The venture kind the grand venture is. **BUILD**, and the kind table already argued why.
 *
 * `venture/kinds.ts` names BUILD and SIEGE *"§7.6's grand venture shape: the highest-yield kinds are
 * legally un-escrowable, so the whole consideration is elective and trust is genuinely at risk"* —
 * and both carry four roles at one principal each, which is §7.2's *"top-yield kinds require ≥4
 * roles"*, the arithmetic that makes cooperation forced rather than encouraged. BUILD rather than
 * SIEGE because a grand venture takes nothing from anybody: SIEGE's own shape is a holding taken,
 * and the season's exam question should be *will you share it*, not *whose did you take*.
 *
 * A **ninth kind was not an option** (§17's venture-kind budget is 8 of 8), and it was not needed: the
 * grand venture is a parameter on `create` (`grand: true`), the same shape `build {kind}` and
 * `publish_offer {kind:"COVER"}` use to carry a second act on an existing word.
 */
export const GRAND_KIND: VentureKind = 'BUILD';

/** §7.6's "~40× a typical margin". The multiple is the canon's; the base is measured. */
export const GRAND_YIELD_MULTIPLE = 40;

/**
 * **What a typical venture yields to divide.** *(calibrate)* — measured, not chosen.
 *
 * The median proceeds of a delivered venture over two seeded twelve-member heuristic worlds
 * (`cal-a`, 31 deliveries in two Reckonings: median 8,132, mean 9,088, p90 15,204; and 213 over a
 * whole fourteen-Reckoning season: median 8,033, mean 9,005), rounded down to a round figure. §7.6 says *margin*, and at the default terms a creator that holds no role keeps a
 * residual of zero (every role's share is its marginal output and they sum to the whole), so the
 * quantity that has a typical size is what a venture delivers — which is what is divided.
 */
export const TYPICAL_VENTURE_PROCEEDS_MINOR: Minor = minor(8_000);

/**
 * **The grand venture's yield at a full fill.** 40 × 8,000 = 320,000.
 *
 * About a third of a twelve-member world's starter capital, or two and a half Reckonings of every
 * venture in it — large enough that keeping it is a real temptation against a permanent record, and
 * small enough that the world's money supply survives one season's worth of it.
 *
 * ── WHERE IT COMES FROM, BECAUSE A15 AND §10.2 BOTH ASK ───────────────────────
 *
 * It is issued at delivery from **`faucet:civic_procurement`** — the faucet every venture's proceeds
 * already come from (§10.2: *"the constellation buys delivered … goods at administered prices,
 * budgeted per Reckoning and published in advance"*). Nothing is minted from a new source: §10.2
 * says there are exactly two faucets and a third would be a constitutional change. What makes it
 * honest is that it is **published from the season's first tick** and **issued at most once per
 * season**, whatever the population — so its size cannot be scaled by enrolling (A15), and an agent
 * can price the whole contest before it commits a hand.
 */
export const GRAND_BASE_YIELD_MINOR: Minor = minor(GRAND_YIELD_MULTIPLE * TYPICAL_VENTURE_PROCEEDS_MINOR);

/**
 * **The least a role in the grand venture must stake, out of EARNED capital.** *(calibrate)*
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A15 DECIDES THE SHAPE: THE STAKE IS COUNTED AGAINST `freeCash`, NOT AGAINST THE BALANCE.**
 *
 * A grand venture needs four distinct principals, and four distinct principals is a gate priced in
 * identities — which A15 calls *unpriced*, because enrolment is free and must stay free. Siting it in
 * the Frontier is not enough on its own: a fresh identity can pay a crossing out of its own starter
 * stake (`GRADUATION_UPKEEP_MINOR` is a fifth of it), so four free identities could walk to the stage
 * and capture the yield for their operator at no cost to anybody.
 *
 * So every role stakes at least this much, and the stake must fit inside the filler's **`freeCash`**
 * — balance less every lock **less the endowment still unspent** (`market/escrow.ts`). D7 makes that
 * figure *exactly* zero for a fresh identity (`freeCash ≤ earned − transferredOut`), so the gate costs
 * capital somebody actually paid you, per role, whichever operator is behind the four keys. That is
 * HARD RULE 5's *"capital that is slashable"*: §7.3 forfeits a withdrawn stake to the other parties.
 *
 * The same figure gates the **creator**: whoever's name the grand venture is in must hold at least
 * this much `freeCash` when it is formed, or a free identity could stand up a candidate, recruit an
 * honest crew, carry the yield and default on all of them with a record that was worth nothing.
 *
 * **10,000 is about one Reckoning of an ordinary principal's earning.** Measured over two seeded
 * twelve-member worlds through a whole season (`cal-a`, `cal-b`): median `freeCash` climbs roughly
 * 10,000 a Reckoning, from ~10,000 at the first to ~135,000 at the FINALE, with the poorest member
 * still above 80,000 by then. So every working principal qualifies easily by the FINALE, a crew bids
 * above the floor with real money, and a fresh identity — `freeCash` exactly 0 — never can.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const GRAND_ROLE_STAKE_MINOR: Minor = minor(10_000);

/**
 * How many closed seasons the book keeps on its working list. Every array has a bound (scar #3).
 *
 * Not the record: each season's close is a `PUBLIC` event row that is never deleted (A5), and this
 * list is the projection the frame and the header read. Sixty-four seasons of fourteen Reckonings is
 * about two and a half years at production pace.
 */
export const MAX_SEASON_RECORDS = 64;

/** How many closed seasons a frame carries, newest first. The legible maximum, not the history. */
export const MAX_FRAME_SEASON_RECORDS = 8;

/** How many grand candidates a frame or a header lists, largest stake first. */
export const MAX_LISTED_GRAND_CANDIDATES = 6;

/**
 * **A RULES SURFACE** (HARD RULE 4). What a season is and what its boundary resets, in one sentence
 * the engine and `agent.md` both carry. `test/season/rules-surface.spec.ts` pins the document to it.
 */
export const SEASON_STATEMENT =
  `A season is ${String(SEASON_RECKONINGS)} Reckonings, and its last Reckoning is the FINALE. At the ` +
  'FINALE’s settlement every Frontier CLAIM closes and its system re-opens for anyone to anchor — an ' +
  'ANCHOR buys territory for the rest of its season and no longer — and any campaign aimed at a closed ' +
  'claim ends MOOT with its bond returned. Nothing else resets: your identity, standing, record, ' +
  'holding, hands, stores, grants and syndicates carry into the next season unchanged.';

/**
 * **A RULES SURFACE** (HARD RULE 4). The grand venture, in the sentence an agent reads in
 * `header.season.grand.rule` and in `agent.md`. Built from the constants above so the numbers in the
 * prose cannot drift from the numbers the engine enforces (scar #1).
 */
export const GRAND_VENTURE_STATEMENT =
  'Every season has one GRAND VENTURE, published from its first tick in `header.season.grand`: a ' +
  `${GRAND_KIND} staged at the Frontier system farthest from the Commons, yielding ` +
  `${String(GRAND_BASE_YIELD_MINOR)} at a full fill and settling at the FINALE. During the FINALE ` +
  'anyone holding at least the stake in earned cash may `create` a candidate with `"grand": true`; every ' +
  'role must be filled by a hand standing at the stage, staking at least ' +
  `${String(GRAND_ROLE_STAKE_MINOR)} of the filler’s earned cash, and a principal may be party to one ` +
  'candidate at a time. Several crews may form: at delivery the live candidate whose roles staked the ' +
  'most carries the yield, and every other candidate delivers nothing and owes nothing. ' +
  `${GRAND_KIND} is top-yield, so every share is ELECTIVE — the yield lands with the creator, and the ` +
  'creator, or a delegate electing in its name under a grant, decides at the FINALE whether the crew ' +
  'is paid.';
