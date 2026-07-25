/**
 * Durable intents — A3, and the reason an offline agent is still a player.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **CREATING AN INTENT COSTS AN ACTION. ITS ROUTINE TICKS COST NONE.**
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A3: "Jobs and operations are durable intents with stop conditions. Creating one
 * costs an action; its routine ticks do not. This is also what makes offline
 * agents viable." Two things follow that are easy to get wrong:
 *
 * 1. **A stop condition is mandatory.** An intent with no stop is an unbounded
 *    loop with an owner, which is scar #3 wearing a game mechanic: it runs 288
 *    times a day forever, it never appears in an affordance list again, and its
 *    principal has no way to discover it. So {@link IntentBook.create} refuses
 *    one, and the refusal is a rejection with a hint rather than an error.
 * 2. **Ordering against live actions is a rules surface** (§15.2's own warning:
 *    "the resolution order is itself a rules surface"). Chosen here, once, and
 *    stated in {@link INTENT_ORDER_STATEMENT} for `agent.md` to carry verbatim —
 *    the same pattern the world module uses for the arrival decision, and for the
 *    same reason (scar #1 was the engine and the agent-facing text disagreeing
 *    about one word).
 *
 * What an intent is **not**: it is not a second home for anything. It carries a
 * verb and its parameters and re-submits them through the *same* validator a live
 * action goes through, so an intent can never do something an agent could not
 * have done by hand. A separate execution path would be a second rules surface.
 */

import type { CanonicalValue } from '../core/canonical.js';
import type { PrincipalId } from '../core/types.js';
import { compareIds } from '../ledger/index.js';
import { reject, type ActionParams, type Rejection } from '../world/index.js';
import {
  canonicalParams,
  readArray,
  readCanonicalParams,
  readInt,
  readIntOrNull,
  readObject,
  readString,
  SnapshotError,
  type StateTable,
} from './snapshot.js';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * THE INTENT ORDERING DECISION, decided here, once.
 *
 * **Within a tick, live actions resolve before standing intents.**
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Why live-first:
 *   - **A3's promise is that absence costs opportunity, never control.** If a
 *     standing intent set three Reckonings ago could pre-empt a decision an agent
 *     made this tick, then the agent's own wake would be worth less than its past
 *     self, and the fix an agent would learn is *never leave an intent running* —
 *     which deletes the mechanic that makes offline play viable.
 *   - **It keeps the budget honest.** A live action is charged; an intent tick is
 *     not. Running the free thing first would let it consume a scarce hand and
 *     make the paid action fail, so an agent would be charged for nothing.
 *   - **It is the only order an agent can reason about without knowing the
 *     engine.** "What I decide now wins over what I left standing" needs no
 *     further explanation; the inverse needs a table.
 */
export const LIVE_ACTIONS_BEFORE_INTENTS = true;

/** The exact sentence `agent.md` must state, byte for byte. Golden-filed. */
export const INTENT_ORDER_STATEMENT =
  'Creating a standing intent costs one material action. Every tick it runs after that costs none. ' +
  'Within a tick, actions you submit resolve before any of your standing intents run, so a live ' +
  'decision always beats one you left running. An intent needs a stop condition and stops itself when ' +
  'it is reached.';

/** Machine-readable form of the same decision, for `agent.md` and `observe`. */
export const INTENT_RULES = {
  liveActionsBeforeIntents: LIVE_ACTIONS_BEFORE_INTENTS,
  statement: INTENT_ORDER_STATEMENT,
} as const;

/**
 * `LIVE` runs each tick. `SPENT` reached its own stop condition. `STOPPED` was
 * withdrawn by its principal. The two endings are distinguished because one is
 * the mechanic working and the other is a decision, and the record must be able
 * to tell a reader which happened.
 */
export type IntentState = 'LIVE' | 'SPENT' | 'STOPPED';

export interface IntentRecord {
  readonly id: string;
  readonly principal: PrincipalId;
  readonly verb: string;
  readonly params: ActionParams;
  readonly createdTick: number;
  /** Last tick it may run. Null means "bounded by runs instead". */
  readonly untilTick: number | null;
  /** How many times it may run in total. Null means "bounded by untilTick". */
  readonly maxRuns: number | null;
  runs: number;
  state: IntentState;
  endedAtTick: number | null;
  /** Ticks it was due and could not act. Surfaced so a dead intent is legible. */
  refusals: number;
}

export interface IntentDraft {
  readonly principal: PrincipalId;
  readonly verb: string;
  readonly params: ActionParams;
  readonly untilTick?: number;
  readonly maxRuns?: number;
}

/**
 * Published cap on live intents per principal (INV-26).
 *
 * Small on purpose: an intent is a standing commitment of a hand's attention, and
 * a principal has three hands. Room for a delivery intent per hand plus a spare.
 */
export const MAX_LIVE_INTENTS_PER_PRINCIPAL = 4;

export class IntentBook {
  private readonly rows = new Map<string, IntentRecord>();
  private minted = 0;

  /**
   * Create one. **The caller charges the action** — the budget belongs to the
   * tick loop, and an intent book that also charged would be a second place the
   * cost of an action is decided.
   */
  create(draft: IntentDraft, tick: number): { readonly ok: true; readonly intent: IntentRecord } | Rejection {
    const untilTick = draft.untilTick ?? null;
    const maxRuns = draft.maxRuns ?? null;

    if (untilTick === null && maxRuns === null) {
      return reject(
        'A3',
        `a standing intent needs a stop condition: give it an until_tick, a max_runs, or both. Without one it ` +
          `runs every tick forever, and you would have no affordance that could ever show it to you again.`,
      );
    }
    if (untilTick !== null && untilTick <= tick) {
      return reject(
        'A3',
        `until_tick ${String(untilTick)} is not in the future (the tick is ${String(tick)}), so this intent would ` +
          `never run. Set it past the tick you are acting in.`,
      );
    }
    if (maxRuns !== null && (!Number.isSafeInteger(maxRuns) || maxRuns < 1)) {
      return reject('A3', `max_runs must be a positive integer, got ${String(maxRuns)}`);
    }

    // Checked here, at creation, where it can still be a hint. An intent whose
    // parameters cannot be serialised canonically is unreplayable, and it would
    // only be discovered days later when a snapshot was taken (DET-3).
    try {
      canonicalParams(draft.params, `intent(${draft.verb})`);
    } catch (error: unknown) {
      return reject(
        'DET-3',
        `this intent's parameters cannot be recorded: ${error instanceof Error ? error.message : String(error)}. ` +
          `Use whole numbers, strings, booleans and null only — the world must be able to replay the intent later.`,
      );
    }

    const live = this.liveFor(draft.principal).length;
    if (live >= MAX_LIVE_INTENTS_PER_PRINCIPAL) {
      return reject(
        'INV-26',
        `you already hold ${live} standing intents, the published cap. Withdraw one before setting another; ` +
          `three hands cannot serve more than that anyway.`,
      );
    }

    // Ids are derived, never random: a replay from a snapshot must not invent a
    // different name for the same intent (DET-3).
    const id = `${draft.principal}:i${String(tick)}:${String(this.minted)}`;
    this.minted += 1;
    const intent: IntentRecord = {
      id,
      principal: draft.principal,
      verb: draft.verb,
      params: draft.params,
      createdTick: tick,
      untilTick,
      maxRuns,
      runs: 0,
      state: 'LIVE',
      endedAtTick: null,
      refusals: 0,
    };
    this.rows.set(id, intent);
    return { ok: true, intent };
  }

  get(id: string): IntentRecord | undefined {
    return this.rows.get(id);
  }

  /** Withdrawn by its principal, as distinct from reaching its own stop. */
  stop(id: string, tick: number): boolean {
    const intent = this.rows.get(id);
    if (intent === undefined || intent.state !== 'LIVE') return false;
    intent.state = 'STOPPED';
    intent.endedAtTick = tick;
    return true;
  }

  /**
   * The `EXPIRE` phase: retire intents whose stop condition has been reached.
   *
   * Runs before `VALIDATE+LOCK` so a lapsed intent cannot lock anything — the
   * same reason EXPIRE precedes VALIDATE in the pipeline at all.
   */
  expire(tick: number): readonly IntentRecord[] {
    const ended: IntentRecord[] = [];
    for (const intent of this.inOrder()) {
      if (intent.state !== 'LIVE') continue;
      const runsUp = intent.maxRuns !== null && intent.runs >= intent.maxRuns;
      const timeUp = intent.untilTick !== null && tick > intent.untilTick;
      if (!runsUp && !timeUp) continue;
      intent.state = 'SPENT';
      intent.endedAtTick = tick;
      ended.push(intent);
    }
    return ended;
  }

  /**
   * Intents due to run this tick, in canonical `(principal, intent_id)` order.
   *
   * Never Map insertion order: insertion order is creation order, which depends
   * on when agents happened to act, and a phase that iterates in a different
   * order every run is DET-1 failing quietly.
   */
  due(tick: number): readonly IntentRecord[] {
    return this.inOrder().filter(
      (i) =>
        i.state === 'LIVE' &&
        i.createdTick < tick &&
        (i.untilTick === null || tick <= i.untilTick) &&
        (i.maxRuns === null || i.runs < i.maxRuns),
    );
  }

  /**
   * Record that an intent ticked. Returns the run count.
   *
   * `acted` is false when the intent was due but its action was refused — a
   * convoy intent whose hand is still in transit, say. A refusal is **not** a
   * run: counting it against `maxRuns` would silently shorten an intent whenever
   * the world was busy, which an agent would experience as the engine cancelling
   * its plans.
   */
  ran(intent: IntentRecord, acted: boolean): number {
    if (acted) intent.runs += 1;
    else intent.refusals += 1;
    return intent.runs;
  }

  liveFor(principal: PrincipalId): readonly IntentRecord[] {
    return this.inOrder().filter((i) => i.state === 'LIVE' && i.principal === principal);
  }

  liveCount(): number {
    return this.inOrder().filter((i) => i.state === 'LIVE').length;
  }

  inOrder(): readonly IntentRecord[] {
    return [...this.rows.values()].sort((a, b) => {
      const byPrincipal = compareIds(a.principal, b.principal);
      return byPrincipal !== 0 ? byPrincipal : compareIds(a.id, b.id);
    });
  }

  /**
   * Drop intents that ended before `keepFromTick`. Bounded storage (scar #3): a
   * season is 8,064 ticks and an intent row that is never removed is an array
   * that only grows. Ended rows are already in the event ledger, which is the
   * permanent record; this map is state, and state forgets.
   */
  prune(keepFromTick: number): number {
    let dropped = 0;
    for (const [id, intent] of [...this.rows]) {
      if (intent.state === 'LIVE') continue;
      if (intent.endedAtTick !== null && intent.endedAtTick < keepFromTick) {
        this.rows.delete(id);
        dropped += 1;
      }
    }
    return dropped;
  }

  /** For the snapshot. Sorted, integer-only, no `undefined`. */
  rowsForCapture(): readonly IntentRecord[] {
    return this.inOrder();
  }

  /** Replace the whole book. Used by snapshot restore and by the halt rollback. */
  replaceAll(rows: readonly IntentRecord[], minted: number): void {
    this.rows.clear();
    for (const row of rows) this.rows.set(row.id, row);
    this.minted = minted;
  }

  get mintedCount(): number {
    return this.minted;
  }
}

const INTENT_STATE_SET: ReadonlySet<string> = new Set<IntentState>(['LIVE', 'SPENT', 'STOPPED']);

/**
 * The intent book as a state table.
 *
 * Registered by the Engine unconditionally, and that is load-bearing rather than
 * tidy: a live standing intent changes what future ticks do, so a `state_hash`
 * that could not see it would call two different worlds identical. `mintedCount`
 * is captured too, because ids are derived from it — a restore that reset the
 * counter would mint a second intent under a name the ledger already used.
 */
export function intentStateTable(book: IntentBook): StateTable {
  return {
    name: 'intent',
    capture(): CanonicalValue {
      return {
        minted: book.mintedCount,
        rows: book.rowsForCapture().map((i) => ({
          id: i.id,
          principal: i.principal,
          verb: i.verb,
          params: canonicalParams(i.params, `intent(${i.id})`),
          createdTick: i.createdTick,
          untilTick: i.untilTick,
          maxRuns: i.maxRuns,
          runs: i.runs,
          state: i.state,
          endedAtTick: i.endedAtTick,
          refusals: i.refusals,
        })),
      };
    },
    restore(captured: CanonicalValue): void {
      const root = readObject(captured, 'intent');
      const rows = readArray(root['rows'] ?? [], 'intent.rows').map((raw, index) => {
        const where = `intent.rows[${String(index)}]`;
        const o = readObject(raw, where);
        const state = readString(o, 'state', where);
        if (!INTENT_STATE_SET.has(state)) throw new SnapshotError(`${where}: unknown intent state ${state}`);
        const row: IntentRecord = {
          id: readString(o, 'id', where),
          principal: readString(o, 'principal', where) as PrincipalId,
          verb: readString(o, 'verb', where),
          params: readCanonicalParams(o['params'] ?? {}, `${where}.params`),
          createdTick: readInt(o, 'createdTick', where),
          untilTick: readIntOrNull(o, 'untilTick', where),
          maxRuns: readIntOrNull(o, 'maxRuns', where),
          runs: readInt(o, 'runs', where),
          state: state as IntentState,
          endedAtTick: readIntOrNull(o, 'endedAtTick', where),
          refusals: readInt(o, 'refusals', where),
        };
        return row;
      });
      book.replaceAll(rows, readInt(root, 'minted', 'intent'));
    },
  };
}
