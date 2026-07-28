/**
 * `src/campaign/` — §16.6's **campaigns**: bonded, objective, supply-driven wars with a sunset.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHAT WAS MISSING, IN ONE SENTENCE.** Battles worked and wars did not. §9 had a 24-tick standoff
 * and §9A had a fleet fight inside it, but there was no mobilization, no attacker risk, no allies on
 * a side, no supply, and nothing with an ending anybody could retell. And sovereignty had the
 * complementary hole, written into its own code: `sovereignty/params.ts` records that *"the critic
 * asks for lapse to require an attacker to win a SIEGE; that is a venture kind this build does not
 * implement, so the third miss is the whole lapse trigger here."* So a claimant that paid its Charge
 * was **invulnerable at any price**, and `claim.ts` said so to every agent that asked.
 *
 * This module is the second lapse trigger. It is the only route to territory somebody is paying for.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## The five files, and what each owns
 *
 *   - `params.ts` — every published number, three rules-surface statements, and
 *     `assertCampaignSchedule`, which refuses at construction any calibration in which a campaign
 *     could run out of clock with no verdict.
 *   - `book.ts` — the rows, the pulse log, `capture`/`restore`, and the **retention rule**, which is
 *     the highest-risk thing here: a campaign outlives every other window in the engine.
 *   - `declare.ts` — the gate on `build {kind:"CAMPAIGN"}`. Adjacency is the clause that makes
 *     geography the mechanic.
 *   - `pulse.ts` — the once-per-Reckoning resolution and every ending. Reads, decides, moves nothing.
 *   - `roster.ts` — `join {campaign}` and `withdraw {campaign}`.
 *   - `view.ts` — the agent's view, the ticker, and **THE SAP** (A13).
 *   - `invariants.ts` — `CMP-1..7`, supplied through the tick loop's `assertions` hook.
 *
 * ## Three budgets this module spends nothing from
 *
 * **No verb.** `build {kind:"CAMPAIGN"}` · `join {campaign}` · `withdraw {campaign}` — three words
 * already in §12.2's forty, each carrying the same concept at a longer horizon.
 * **No tick phase.** Pulses resolve inside `PREDATE`, after raids, because adding a phase changes the
 * set of `Rng.derive(phase)` labels and therefore every seeded draw in the world.
 * **No top-level `observe` key.** §12.1's `holding` row already reads `state · threats · siege clock ·
 * upkeep_due`, and the campaign block is the *siege clock* — a slot the canon reserved and nothing
 * had filled.
 */

export {
  Book,
  campaignIdFor,
  campaignStateTable,
  CampaignBookError,
  isCampaignSide,
  isCampaignState,
  isLiveCampaign,
  isPulseOutcome,
  nextPulseTickOf,
  type CampaignId,
  type CampaignParty,
  type CampaignRecord,
  type CampaignSide,
  type PulseRow,
} from './book.js';

export {
  declareRefusal,
  firstPulseReckoningFor,
  firstPulseTickFor,
  openCampaign,
  type DeclarePort,
  type DeclareRequest,
} from './declare.js';

export {
  duePulses,
  liftEnding,
  pulseIsDue,
  readCampaignForce,
  resolvePulse,
  type CampaignEnding,
  type CampaignForceReading,
  type PulsePlan,
  type PulsePort,
} from './pulse.js';

export { joinRefusal, joinStakeFor, liftRefusal, type RosterPort } from './roster.js';

export {
  campaignClockAt,
  campaignLegend,
  campaignTickerLine,
  campaignViewsFor,
  sapLinesFor,
  type CampaignClock,
  type CampaignStanding,
  type CampaignView,
  type CampaignViewPort,
} from './view.js';

export {
  checkCampaignInvariants,
  checkCmp1,
  checkCmp2,
  checkCmp3,
  checkCmp4,
  checkCmp5,
  checkCmp6,
  checkCmp7,
  type CampaignInvariantInputs,
} from './invariants.js';

export {
  assertCampaignSchedule,
  breachesToTake,
  BREACHES_TO_TAKE_STRAINED,
  BREACHES_TO_TAKE_SUPPLIED,
  CAMPAIGN_BOND_MINOR,
  CAMPAIGN_ENDINGS_STATEMENT,
  CAMPAIGN_JOIN_STAKE_MINOR,
  CAMPAIGN_PULSE_PHASE,
  CAMPAIGN_PULSES,
  CAMPAIGN_RETAINED_RECKONINGS,
  CAMPAIGN_ROSTER_STATEMENT,
  CAMPAIGN_SALVAGE_BPS,
  CAMPAIGN_STATEMENT,
  CampaignScheduleError,
  LAST_DECLARE_PHASE,
  MATERIEL_GOOD,
  MAX_CAMPAIGN_PARTIES,
  MAX_CAMPAIGNS,
  MAX_LIVE_CAMPAIGNS,
  MAX_SAP_LINES,
  PULSE_MATERIEL_QTY,
  rebuffsToStand,
  STARVES_TO_END,
} from './params.js';
