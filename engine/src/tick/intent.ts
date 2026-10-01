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
 *
 * ★ **`STOPPED` had no door until `RULES_VERSION` 41.** {@link IntentBook.stop} existed and nothing
 * could call it, so an intent ended only at its own `until_tick` or `max_runs` — and the cap message
 * below told an agent *"there is no verb that withdraws one"*. It is now reached by the verb that
 * makes intents, with the parameter that ends one: `set_delivery_intent {"stop": "<intent id>"}`
 * (A3: *creating or amending one costs an action*). No verb is spent; the budget is 40 of 40.
 */
export type IntentState = 'LIVE' | 'SPENT' | 'STOPPED';

/**
 * The sentence `agent.md` carries about ending an intent, byte for byte (golden-filed beside
 * {@link INTENT_ORDER_STATEMENT}).
 */
export const INTENT_STOP_STATEMENT =
  'You end a standing intent early with the verb that made it: set_delivery_intent {"stop": "<intent id>"} ' +
  'costs one action, takes effect the tick it lands — before the intent would run — and is final. ' +
  'obligations.intents lists every intent you hold, with its id and what it last did.';

/**
 * The sentence `agent.md` carries about a satisfied intent, byte for byte.
 *
 * **A satisfied intent is not a stuck one, and the record says which.** An order to pay the Levy that
 * finds the bill already paid has nothing to do until the next assessment; it used to be refused every
 * tick — sixteen identical corrections in sixteen ticks, and a playtester reading "stuck". Now the run
 * is recorded as `satisfied`, posts no correction, writes no action-log row, and does not count
 * against `max_runs`.
 */
export const INTENT_SATISFIED_STATEMENT =
  'A standing intent with nothing left to do this Reckoning — its bill already paid, its ballot already ' +
  'cast as stated — is SATISFIED, not stuck: it does not run, posts no correction, uses none of its ' +
  'max_runs, and stays armed for the next one. A REFUSED run is a real obstacle, and briefing.corrections ' +
  'says what it is.';

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
  /**
   * ★ Ticks it was due and had **nothing to do** — the obligation it carries already met, or not yet
   * open (`RULES_VERSION` 41). Never a run and never a refusal: see {@link INTENT_SATISFIED_STATEMENT}.
   */
  satisfied: number;
  /** The last tick it acted, or null. With the two below, what `obligations.intents[]` calls its status. */
  lastRanTick: number | null;
  /** The last tick it was due and refused. A refusal is an obstacle; the correction names it. */
  lastRefusedTick: number | null;
  /** The last tick it was due and satisfied. */
  lastSatisfiedTick: number | null;
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
        `you already hold ${live} standing intents, the published cap. An intent ends at its own ` +
          `until_tick or max_runs, or when you stop it — set_delivery_intent {"stop": "<intent id>"}, one ` +
          `action, ids in obligations.intents — so end one before setting another; three hands cannot serve more ` +
          `than that anyway.`,
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
      satisfied: 0,
      lastRanTick: null,
      lastRefusedTick: null,
      lastSatisfiedTick: null,
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
   * ★ **Withdraw an intent at its principal's request** — the door {@link stop} never had.
   *
   * Refuses anything that is not this principal's own LIVE intent, with a sentence: a stop that
   * silently did nothing would leave an agent believing an order had ended while it kept spending
   * goods, which is the exact misreading this door exists to end.
   */
  stopFor(principal: PrincipalId, id: string, tick: number): { readonly ok: true; readonly intent: IntentRecord } | Rejection {
    const intent = this.rows.get(id);
    if (intent === undefined || intent.principal !== principal) {
      const yours = this.liveFor(principal).map((i) => i.id);
      return reject(
        'A3',
        `you hold no standing intent ${id}. ` +
          (yours.length === 0
            ? 'You hold no live intents at all.'
            : `Your live intents are ${yours.join(', ')} — obligations.intents lists them with what each last did.`),
      );
    }
    if (intent.state !== 'LIVE') {
      return reject(
        'A3',
        `intent ${id} already ended (${intent.state} at tick ${String(intent.endedAtTick)}), so there is nothing ` +
          'to stop. An ended intent never runs again.',
      );
    }
    this.stop(id, tick);
    return { ok: true, intent };
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
  ran(intent: IntentRecord, acted: boolean, tick: number): number {
    if (acted) {
      intent.runs += 1;
      intent.lastRanTick = tick;
    } else {
      intent.refusals += 1;
      intent.lastRefusedTick = tick;
    }
    return intent.runs;
  }

  /**
   * Record that an intent was due and had nothing to do (`RULES_VERSION` 41). **Not a run** — so it
   * cannot shorten a `max_runs` budget the way a counted refusal would have — and not a refusal, so a
   * satisfied order never reads as a stuck one.
   */
  satisfiedAt(intent: IntentRecord, tick: number): void {
    intent.satisfied += 1;
    intent.lastSatisfiedTick = tick;
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
          // ★ Inside the hash (`RULES_VERSION` 41): whether an order was satisfied is a fact about what
          // it did, and two worlds that disagreed about it would disagree about what an agent is told.
          satisfied: i.satisfied,
          lastRanTick: i.lastRanTick,
          lastRefusedTick: i.lastRefusedTick,
          lastSatisfiedTick: i.lastSatisfiedTick,
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
          // Strict, like every other field: a `RULES_VERSION` bump already refuses adopting a capture
          // written before these existed (`persist/boot.ts`), so absence here is a malformed capture.
          satisfied: readInt(o, 'satisfied', where),
          lastRanTick: readIntOrNull(o, 'lastRanTick', where),
          lastRefusedTick: readIntOrNull(o, 'lastRefusedTick', where),
          lastSatisfiedTick: readIntOrNull(o, 'lastSatisfiedTick', where),
        };
        return row;
      });
      book.replaceAll(rows, readInt(root, 'minted', 'intent'));
    },
  };
}
