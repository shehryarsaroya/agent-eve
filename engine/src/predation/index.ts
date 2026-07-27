/**
 * PREDATION — SPEC §9 and §16 step 12. **The mechanic A14 was missing.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY IT EXISTS, because every choice in this module follows from it.**
 *
 * A14: *"Drama runs on a clock, not on hope. Never ship a mechanic whose drama depends
 * on agents choosing conflict — they won't; silence is their rational default."* The
 * live world ran thousands of ticks with no conflict in it at all, because `PREDATE` was
 * a documented no-op hook and nothing in the game forced any. Smart agents cooperate
 * into silence, and they get there faster than humans do because they never get bored.
 *
 * So the **world** spawns predation, on a **published** clock, at a target chosen by a
 * **published** rule, and nobody has to want it for it to arrive. Nobody owns a world
 * raid, so nobody can be bribed to call one off — which is §9's answer to the
 * Coase-collapse that turns ownable predation into a toll cartel that renders
 * identically to peace.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## What the rest of the engine needs to know
 *
 *   - **`runPredate` in the `PREDATE` phase, and nowhere else.** It resolves what is
 *     due, then spawns, then prunes. The slot existed as an explicit no-op from commit
 *     #1 precisely so that filling it would shift no other phase's seeded sub-stream.
 *   - **`raidStateTable` is registered unconditionally.** A live demand decides what a
 *     future tick does to a principal's goods, so a hash blind to it would call two
 *     worlds identical, and an abort would leave a credited `yield` behind.
 *   - **`checkPredationInvariants` belongs in the tick's `assertions` hook.** PRD-1 is
 *     A8 (a Commons stage halts the world) and PRD-3 is A5′ (a recorded loss must equal
 *     what the posting log moved).
 *   - **`liveObligations().isLive` must be extended with `book.isLive`**, or a joiner's
 *     locked stake reads to INV-4 as an orphan lock and halts the tick.
 *   - **No new verb and no new canon word.** `yield`, `fight`, `join` and `demand` are all
 *     already in SPEC §12.2 and already classified in `world/commons.ts`; the budget is
 *     untouched.
 *   - **Nothing here halts the world on an agent's input.** Every agent-reachable path
 *     returns a sentence; the phase itself reports faults and never throws.
 *
 * ## What this module deliberately does not do
 *
 *   - **It does not touch identity, hands-as-capacity, holdings or standing.** A hand
 *     taken goes `RECOVERING` (INV-8: loss is time, never capacity); a holding is never
 *     reached; standing never moves, because INV-21 permits it to move only on an
 *     elective-honoured settlement, a default, a contradicted seal, or decay — and a
 *     raid is none of those.
 *   - **It records no default, ever** (`RaidOutcome.isDefault` is the literal `false`,
 *     and PRD-5 halts on a raid and a default landing on one principal in one tick).
 *
 * ## Both of §9's forms are now here, and `initiator` is the whole difference
 *
 * `demand.ts` adds the **agent-initiated** half: a principal spends from an aggression
 * capacity that expires unspent, states one explicit demand, and opens a standoff in the
 * **same book** with the same window, the same `join` on either side, the same `YIELD |
 * FIGHT`, the same arithmetic and the same pixel signature. There is no second raid engine,
 * which is what §9 means by *"use the corpus's own deterministic engine, which was already
 * written"*.
 *
 * One field on the record carries it — {@link RaidRecord.initiator}, `null` for weather —
 * and six rules read it. The two worth naming here:
 *
 *   - a demand brings **no force of its own**; all of it is hands, counted at resolution, so
 *     one hand ties the Marches and loses, and beats the Frontier;
 *   - a demand **writes neither the stage hold nor the victim cooldown**, because those are
 *     the ownerless raid's price for losing, and an agent able to write them could mint a
 *     Reckoning of world-raid immunity for a friend by arranging to be attacked.
 */

export {
  AGGRESSION_PER_RECKONING,
  aggressionNote,
  aggressionRemaining,
  type AggressionSpend,
} from './aggression.js';

export {
  Book,
  demandIdFor,
  isRaidAnswer,
  isRaidSide,
  isRaidState,
  raidIdFor,
  RaidBookError,
  raidStateTable,
  type RaidAnswer,
  type RaidId,
  type RaidParty,
  type RaidRecord,
  type RaidSide,
  type RaidState,
} from './book.js';

export {
  DEMAND_OWN_FORCE,
  DEMAND_RULE_STATEMENT,
  demandRefusal,
  demandsRemaining,
  demandsRemainingNote,
  LAST_DEMAND_PHASE,
  openDemand,
  type DemandPort,
  type DemandRequest,
} from './demand.js';

export {
  checkPredationInvariants,
  checkPrd1,
  checkPrd2,
  checkPrd3,
  checkPrd4,
  checkPrd5,
  checkPrd6,
  checkPrd7,
  raidArithmeticProblems,
  type PredationInvariantInputs,
} from './invariants.js';

export {
  assertRaidSchedule,
  DEMAND_WINDOW_TICKS,
  FORCE_BY_TIER,
  FORCE_PER_HAND,
  FORCE_PER_JOINER,
  MAX_LIVE_RAIDS,
  MAX_SEIZE_LOTS,
  MAX_RAID_PARTIES,
  MAX_RAID_ROWS,
  RAID_DEMAND_QTY,
  RAID_FORCE,
  RAID_JOIN_STAKE_MINOR,
  RAID_MAX_TAKE_BPS,
  RAID_MIN_TARGET_QTY,
  RAID_SPAWN_PHASES,
  RAID_STAGE_HELD_TICKS,
  RAID_TAKE_MULTIPLE,
  RAID_VICTIM_COOLDOWN_TICKS,
  RaidScheduleError,
} from './params.js';

export {
  payDemand,
  runPredate,
  windowWasHonest,
  type PredateReport,
  type PredationPort,
  type RaidOutcome,
} from './predate.js';

export {
  demandFor,
  payFor,
  readForce,
  takeFor,
  type ForceReading,
  type Verdict,
} from './resolve.js';

export {
  isSpawnTick,
  nextSpawnTick,
  RAID_TARGET_STATEMENT,
  raidsPerReckoning,
  resolvesAt,
  scheduleAt,
  type RaidSchedule,
} from './schedule.js';

export {
  rankCandidates,
  type AssailablePile,
  type RaidCandidate,
  type TargetPort,
} from './target.js';

export {
  RAID_SILENCE_MULTIPLE,
  raidLinesFor,
  raidTickerLine,
  raidViewsFor,
  type RaidView,
  type RaidViewPort,
} from './view.js';
