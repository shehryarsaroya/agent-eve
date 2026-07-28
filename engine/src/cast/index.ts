/**
 * The house cast (SPEC §15.6).
 *
 * Two casts live here and they share one seam:
 *
 *   - {@link HeuristicCast} — a deterministic policy over the world. Cheap, always
 *     available, never interesting. Every action it submits is honestly labelled
 *     `HEURISTIC`, which is what lets `GET /health` notice that the expensive path has
 *     stopped being taken (scar #14b). A cast that labelled itself `LIVE` would make that
 *     one measurement permanently green.
 *   - {@link LlmCast} — named principals with persistent character, deciding out of band
 *     through a language model and submitting into a later tick exactly like a remote
 *     agent. **Default off.** With `COMPACT_CAST_LLM` unset it wraps the heuristic cast
 *     and returns its decisions unchanged.
 *
 * What the rest of the engine needs to know, and what a {@link Cast} therefore promises:
 *
 *   - **`decide` is synchronous and never throws.** It is called from inside the tick
 *     scheduler. An LLM call takes seconds; a tick takes single-digit milliseconds. So a
 *     decision is *started* on one tick and *submitted* on a later one.
 *   - **It returns submissions; it never submits.** The caller owns ordering, which is
 *     what lets a test shuffle the list and prove arrival buys nothing (A4).
 *   - **Every draw comes from `Rng`.** Seating and characters are seed-derived; one
 *     unseeded draw and the seating is unreplayable.
 *   - **Raiders are seated outside the Commons.** In the Commons a hostile act is
 *     invalid, not punished (A8), so a raider seated there could never act.
 *   - **The cast is never consulted during replay.** Boot seats it from the seed and then
 *     replays the action log. Decisions enter the record as logged actions.
 */

import type { Runtime } from '../sim/runtime.js';
import type { SubmittedAction } from '../tick/index.js';
import type { LlmCastReport } from './llm.js';
import { HeuristicCast, type CastMember, type CastOptions } from './heuristic.js';
import { castSettingsFromEnv, LlmCast, type LlmCastOptions } from './llm.js';
import { CastMemory } from './memory.js';
import { fileVault } from './vault.js';
import type { Clock } from '../core/time.js';
import { openAiTransport, type CastTransport } from './transport.js';

/**
 * What the scheduler needs from a cast, and the whole of it.
 *
 * Narrow on purpose: `serve()` should be able to swap one implementation for the other
 * with a single changed line, and a wide interface would make that a refactor.
 */
export interface Cast {
  seat(seed: string): readonly CastMember[];
  readonly roster: readonly CastMember[];
  /** **Synchronous, never throws.** See the module note. */
  decide(tick: number, seed: string): readonly SubmittedAction[];
  /** Release anything in flight. Optional: the heuristic cast has nothing to release. */
  close?(): void;
  /**
   * What this cast is doing and spending. Optional because the heuristic cast spends
   * nothing and has nothing to report — its absence is how `/health` distinguishes
   * "no LLM cast running" from "an LLM cast running at zero cost", which are very
   * different states to see on a dashboard.
   */
  report?(): LlmCastReport;
}

export interface CreateCastOptions extends CastOptions {
  /** Injected so a test can drive the cast without a global. Ignored when LLM is off. */
  readonly clock: Clock;
  /** Overrides the real OpenAI transport. Tests always pass one. */
  readonly transport?: CastTransport;
  readonly env?: NodeJS.ProcessEnv;
  /** Injected so a test can supply a memory with a double vault. */
  readonly memory?: CastMemory;
  readonly log?: (line: string) => void;
}

/**
 * Build the cast the environment asks for.
 *
 * **This is the whole of the wiring.** `serve()` replaces
 * `new HeuristicCast(runtime, { size })` with `createCast(runtime, { size, clock })` and
 * calls `cast.close?.()` on shutdown; nothing else changes, and with `COMPACT_CAST_LLM`
 * unset the behaviour is byte-identical to today's.
 */
export function createCast(runtime: Runtime, options: CreateCastOptions): Cast {
  const env = options.env ?? process.env;
  const settings = castSettingsFromEnv(env);
  if (!settings.enabled) return new HeuristicCast(runtime, options);

  // ── ASKED FOR, BUT NOT POSSIBLE ─────────────────────────────────────────
  //
  // `COMPACT_CAST_LLM=true` with no key set is a configuration mistake, and the graceful
  // degradation path handles it *correctly but expensively*: every wake would start a
  // call, fail instantly, and fall back — burning 192 wakes a Reckoning to accomplish
  // nothing, and filling the log with the same failure. So it is caught here, loudly,
  // once, and the world runs on heuristics exactly as if the flag were unset.
  //
  // The message names the VARIABLE and never its value. That is the only fact about a
  // key this codebase is permitted to state (HARD RULE 1).
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  if (options.transport === undefined && (env['OPENAI_API_KEY'] ?? '').trim().length === 0) {
    log(
      'compact: ⚑ COMPACT_CAST_LLM is on but OPENAI_API_KEY is not set. The LLM cast is OFF ' +
        'and the world is running on heuristics. Set the variable and restart.',
    );
    return new HeuristicCast(runtime, options);
  }

  // Memory survives a restart when a path is given. Without one the cast is a goldfish
  // between deploys, which quietly caps A6's "months of honest work" at the interval
  // between releases — on this project, hours. Not game state: it is never hashed,
  // snapshotted, replayed or published, and losing the file costs continuity, not truth.
  const memoryPath = (env['COMPACT_CAST_MEMORY'] ?? '').trim();
  const memory =
    options.memory ??
    (memoryPath.length > 0
      ? new CastMemory(undefined, undefined, fileVault(memoryPath))
      : new CastMemory());

  const llmOptions: LlmCastOptions = {
    ...options,
    memory,
    clock: options.clock,
    transport:
      options.transport ??
      // The deadline is handed to the transport in **ticks**, not milliseconds: it
      // converts with `ticksToMs` at the call site so the wall-clock timeout scales with
      // the world's speed (DET-8, TESTING.md §1.1 hazard 1).
      openAiTransport({ deadlineTicks: settings.deadlineTicks }),
    model: settings.model,
    limits: settings.limits,
    wakeGapTicks: settings.wakeGapTicks,
    deadlineTicks: settings.deadlineTicks,
    planMax: settings.planMax,
    idle: settings.idle,
    ...(options.log === undefined ? {} : { log: options.log }),
  };
  return new LlmCast(runtime, llmOptions);
}

export {
  CAST_ARMS_RESERVE_MULTIPLE,
  CAST_ANSWER_GRACE_TICKS,
  CAST_COALITION_MAX_DEFICIT,
  CAST_COALITION_SPARE_HANDS,
  CAST_DOCTRINE,
  CAST_ENGAGE_FAVOUR_BPS,
  CAST_NAMES,
  CAST_ROLES,
  CAST_WITHDRAW_BELOW_BPS,
  DEFAULT_CREATE_CHANCE_BPS,
  HeuristicCast,
  MAX_CAST,
  type CastMember,
  type CastOptions,
  type CastRole,
} from './heuristic.js';

export {
  CAST_STANCES,
  STANCE_CREED,
  characterOf,
  charactersFor,
  roleForName,
  type CastCharacter,
  type CastStance,
} from './characters.js';

export {
  CastBudget,
  CHARS_PER_TOKEN,
  DEFAULT_CAST_LIMITS,
  formatMicros,
  type BudgetRefusal,
  type CastBudgetLimits,
  type CastSpendReport,
} from './budget.js';

export { CastMemory, type CastNote } from './memory.js';

export { hasControlBytes, stripControlBytes } from './text.js';

export {
  MAX_NOTE_CHARS,
  MAX_PARAM_ARRAY,
  MAX_PARAM_KEYS,
  MAX_PARAM_STRING,
  MAX_REPLY_CHARS,
  parseReply,
  type ParsedAction,
  type ParseResult,
} from './parse.js';

export {
  CONTRACT_ACTS,
  CONTRACT_CATALOG,
  CONTRACT_CEILING_MARGIN,
  CONTRACT_MULTI_MEANING_VERBS,
  CONTRACT_NOT_EXCERPTED,
  CONTRACT_POSITIONS,
  CONTRACT_SECTIONS,
  DROP_ORDER,
  EVERY_SITUATION,
  MAX_CONTRACT_CHARS,
  MAX_OBSERVATION_CHARS,
  NO_SITUATION,
  REPLY_SCHEMA,
  actTokensOf,
  buildPrompt,
  citedSection,
  discriminatorsOf,
  excerptFor,
  loadContract,
  loadContractDocument,
  projectObservation,
  readSituation,
  situationalFocus,
  unitGrade,
  unitName,
  type BuiltPrompt,
  type ContractDocument,
  type ContractExcerpt,
  type ContractOmission,
  type ContractSituation,
  type ContractUnit,
  type PromptInput,
  type UnitGrade,
} from './prompt.js';

export {
  CastTransportError,
  DEFAULT_CAST_MODEL,
  OPENAI_COMPLETIONS_URL,
  REDACTED,
  describeFailure,
  openAiTransport,
  readReply,
  redactSecrets,
  type CastTransport,
  type CompletionMessage,
  type CompletionReply,
  type CompletionRequest,
} from './transport.js';

export {
  DEFAULT_DEADLINE_TICKS,
  DEFAULT_IDLE_POLICY,
  DEFAULT_PLAN_MAX,
  DEFAULT_WAKE_GAP_TICKS,
  LlmCast,
  castSettingsFromEnv,
  llmCastEnabled,
  type CastEnvSettings,
  type CastIdlePolicy,
  type LlmCastOptions,
  type LlmCastReport,
} from './llm.js';
