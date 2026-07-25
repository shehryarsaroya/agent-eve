/**
 * The sim: the assembled world, and the headless runner over it.
 *
 * What the rest of the engine needs to know about this module:
 *
 *   - **`Runtime` is the only place the world is wired.** `src/tick/loop.ts` is
 *     content-free by design, so the venture book, the ledger, the seals and the
 *     verb table are joined here and nowhere else.
 *   - **No agent-reachable input may halt the world.** Every ledger call reachable
 *     from a verb is preceded by an affordability *rejection* and wrapped as well,
 *     because the ledger throws on an overdraft by design and a thrown error inside
 *     a verb would be a denial of settlement (AGT-X9).
 *   - **The venture table is captured but not restorable.** That is a stated gap
 *     with its reasoning recorded at the site; `engine.rollbackGaps` names it and
 *     the CLI prints it on a halt.
 *   - **`sim` prints one `tick<TAB>state_hash` line per tick to stdout** and
 *     everything else to stderr, so two runs are diffed with `diff` and nothing else.
 */

export {
  CENSUS_WINDOW_TICKS,
  DecisionCensus,
  FORMATION_WINDOW_TICKS,
  MAX_CLAIM_ENTRIES,
  MAX_MESSAGE_LENGTH,
  MAX_PENDING_CORRECTIONS,
  MAX_OFFER_ENTRIES,
  MAX_REASON_LENGTH,
  MAX_TALK_ENTRIES,
  RULES_VERSION,
  Runtime,
  STARTER_STAKE,
  defaultTerms,
  freeStores,
  nextSettlementAtOrAfter,
  reckoningOf,
  ventureStateTable,
  type ClaimEntry,
  type OfferEntry,
  type PendingCorrection,
  type RuntimeOptions,
  type TalkEntry,
} from './runtime.js';

export {
  ArgError,
  DEFAULT_ARGS,
  main,
  parseArgs,
  runSim,
  type SimArgs,
  type SimLine,
  type SimResult,
} from './cli.js';
