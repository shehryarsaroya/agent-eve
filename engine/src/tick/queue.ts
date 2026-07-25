/**
 * The submission window, and the one ordering the whole design rests on.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **ORDER BY `(priority, principal_id, client_sequence)`. NEVER BY ARRIVAL.**
 * ══════════════════════════════════════════════════════════════════════════
 *
 * SPEC §15.2, and it is the structural half of A4: if resolution order followed
 * arrival, then requests-per-second would be power, and High Water proved that
 * happens by default rather than by mistake (scar #2 — wealth was a function of
 * polling rate). `arrival_ms` is still *recorded*, on the action log, for exactly
 * one purpose: the A4 audit, which has to be able to prove that response speed
 * bought nothing. It is never an input to a decision.
 *
 * That guarantee is made structural rather than tested here: {@link compareOrderKey}
 * takes an {@link OrderKey}, which **has no arrival field at all**. A comparator
 * cannot read what it was never handed. The projection {@link orderKeyOf} is the
 * only bridge, and it drops arrival on the floor.
 *
 * Two more properties this file owns:
 *
 * - **The order is total.** Two submissions from one principal sharing a
 *   `client_sequence` would be an ordering tie, and `Array.prototype.sort` is
 *   stable — so a tie silently falls back to *insertion order*, which is arrival
 *   order, which is the exploit this file exists to close. So a duplicate
 *   `client_sequence` inside one window is rejected at submit, and {@link freeze}
 *   asserts strictness anyway rather than trusting that it was.
 * - **The window is bounded.** Scar #3 was an unbounded array that became an OOM
 *   and a disk DoS, and SPEC §15.2 requires submissions to "queue (bounded, with
 *   a published cap)" while the world is PAUSED. Both caps are published
 *   constants and INV-26 counts them.
 */

import type { DecisionSource, PrincipalId } from '../core/types.js';
import { ACTIONS_PER_TICK } from '../core/time.js';
import { compareIds } from '../ledger/index.js';
import { classifyAction, reject, type ActionParams, type Rejection } from '../world/index.js';

/**
 * Published caps on the window (INV-26, scar #3).
 *
 * The per-principal cap is `ACTIONS_PER_TICK` times a small factor rather than
 * exactly `ACTIONS_PER_TICK`: an agent may legitimately submit more than it can
 * afford and let the budget refuse the tail (that is a *cheaper* mistake for it
 * than guessing), and free verbs do not consume the budget at all. The factor is
 * small on purpose — beyond it, the submission itself is the abuse.
 */
export const MAX_QUEUED_PER_PRINCIPAL = ACTIONS_PER_TICK * 8;

/**
 * Global cap on one window. At 300 principals × the per-principal cap this is
 * generous; it exists so that a single flood cannot grow the process, and it is
 * the "published cap" §15.2 requires for the PAUSED case.
 */
export const MAX_QUEUED_ACTIONS = 4096;

/**
 * Priority classes. **Lower runs first.** Only two are used in Phase 0 and the
 * gaps are deliberate: a class inserted between them later must not renumber the
 * ones already golden-filed.
 *
 * The Phase 0 assignment is derived from the Commons floor's own total verb
 * classification rather than from a second table, because a second table is a
 * second rules surface that can disagree with the first (§3, scar #1). What the
 * derivation buys: within one tick, every peaceful act resolves before every
 * hostile one, so `yield` and `flee` are not out-raced by the `demand` that
 * provoked them.
 */
export const PRIORITY = {
  /** Peaceful acts: everything that is not an act of force. */
  ORDINARY: 20,
  /** Acts of force. They resolve after the tick's peaceful acts, never before. */
  CONTEST: 40,
} as const;

export function defaultPriority(verb: string, params: ActionParams): number {
  return classifyAction(verb, params) === 'HOSTILE' ? PRIORITY.CONTEST : PRIORITY.ORDINARY;
}

/**
 * An action as an agent submits it.
 *
 * `arrivalMs` is required, not optional, and that is the point: the audit that
 * proves speed bought nothing cannot run on a field the caller may omit.
 */
export interface SubmittedAction {
  readonly principal: PrincipalId;
  readonly verb: string;
  readonly params: ActionParams;
  /** §12.3: one `act_batch` per tick with ordered actions and `client_sequence`. */
  readonly clientSequence: number;
  /** Wall-clock arrival. **For the A4 audit only.** Never an ordering key. */
  readonly arrivalMs: number;
  readonly decisionSource: DecisionSource;
  /** Optional overrides. Omitted means "derive it". */
  readonly priority?: number;
  readonly idempotencyKey?: string;
  /** PROP-W3: a mismatch returns a fresh preview and never guesses. */
  readonly actedOnStateVersion?: number;
}

/** A submission that has been accepted into a window. */
export interface QueuedAction {
  readonly principal: PrincipalId;
  readonly verb: string;
  readonly params: ActionParams;
  readonly clientSequence: number;
  readonly priority: number;
  readonly decisionSource: DecisionSource;
  readonly idempotencyKey: string | null;
  readonly actedOnStateVersion: number | null;
  /** The tick this will resolve in: the window's tick + 1. */
  readonly targetTick: number;
  /**
   * Wall-clock arrival, and the order it arrived in. **Both are audit fields.**
   * They exist so the A4 audit can compare arrival order against resolution
   * order and show no correlation; nothing in the engine reads them.
   */
  readonly arrivalMs: number;
  readonly arrivalOrdinal: number;
}

/**
 * The ordering key, and **the only thing the comparator ever sees.**
 *
 * There is no `arrivalMs` here and there must never be one. A reviewer checking
 * "does resolution depend on arrival?" only has to read this type.
 */
export interface OrderKey {
  readonly priority: number;
  readonly principal: PrincipalId;
  readonly clientSequence: number;
}

export function orderKeyOf(action: QueuedAction): OrderKey {
  return {
    priority: action.priority,
    principal: action.principal,
    clientSequence: action.clientSequence,
  };
}

/**
 * SPEC §15.2's comparator. `compareIds` is the ledger's byte-order string
 * compare — never locale collation, which is the Postgres `ORDER BY` trap named
 * in §15.5 and would make two hosts disagree (DET-4).
 */
export function compareOrderKey(a: OrderKey, b: OrderKey): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const byPrincipal = compareIds(a.principal, b.principal);
  if (byPrincipal !== 0) return byPrincipal;
  return a.clientSequence - b.clientSequence;
}

export interface FrozenWindow {
  /** The tick these actions resolve in. */
  readonly tick: number;
  /** In `(priority, principal_id, client_sequence)` order. Strictly increasing. */
  readonly actions: readonly QueuedAction[];
  /** Total submissions offered to this window, including the ones refused. */
  readonly offered: number;
}

export class QueueError extends Error {}

/**
 * The window. One instance per engine; it holds the submissions for the *next*
 * tick while the current one resolves — which is the mechanical form of "an agent
 * acts from snapshot T; all valid actions become part of T+1".
 */
export class SubmissionQueue {
  private pending: QueuedAction[] = [];
  private readonly perPrincipal = new Map<PrincipalId, number>();
  /** `(principal, clientSequence)` already used in this window. Keeps order total. */
  private readonly sequences = new Set<string>();
  private arrivals = 0;
  private offered = 0;
  /** The tick actions accepted now will resolve in. */
  private target: number;
  private open = false;

  constructor(firstTargetTick: number) {
    this.target = firstTargetTick;
  }

  /** The tick that submissions accepted right now will resolve in. */
  get targetTick(): number {
    return this.target;
  }

  get depth(): number {
    return this.pending.length;
  }

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * Open the window for a target tick. Called once the seed commitment for that
   * tick has published — a seed revealed, or even accepted-against, before its
   * hash is public would be an oracle (DET-6).
   */
  openFor(tick: number): void {
    if (tick < this.target) {
      throw new QueueError(`the window cannot reopen for tick ${tick}; it is already at ${this.target}`);
    }
    this.target = tick;
    this.open = true;
  }

  accept(action: SubmittedAction): { readonly ok: true; readonly queued: QueuedAction } | Rejection {
    if (!this.open) {
      return reject(
        'A3',
        `the window for tick ${this.target} is closed: a tick is resolving, and an action submitted now would ` +
          `react to a decision inside it. Retry once the tick closes; nothing is lost by waiting.`,
      );
    }
    if (!Number.isSafeInteger(action.clientSequence) || action.clientSequence < 0) {
      return reject(
        'A2',
        `client_sequence must be a non-negative integer, got ${String(action.clientSequence)}; it is the only ` +
          `thing that orders your own competing commitments, so it cannot be absent or fuzzy.`,
      );
    }
    if (this.pending.length >= MAX_QUEUED_ACTIONS) {
      return reject(
        'INV-26',
        `the window holds its published cap of ${MAX_QUEUED_ACTIONS} actions and is refusing more. ` +
          `Nothing already accepted is lost; submit again for the next tick.`,
      );
    }
    const mine = this.perPrincipal.get(action.principal) ?? 0;
    if (mine >= MAX_QUEUED_PER_PRINCIPAL) {
      return reject(
        'INV-26',
        `you already have ${mine} actions in this window, the published per-principal cap. Only ` +
          `${ACTIONS_PER_TICK} material actions can resolve per tick, so the rest would be refused anyway.`,
      );
    }
    // `|` and not a NUL byte: a raw NUL in source makes `file(1)` report this
    // file as binary data and makes grep skip it entirely, so every grep-based
    // guard in the repo — including SEC-9's outbound secret scan — silently stops
    // covering it while tsc, eslint and vitest all stay green. A handle is
    // `[a-z0-9-]{3,20}`, so a pipe cannot collide.
    const seqKey = `${action.principal}|${String(action.clientSequence)}`;
    if (this.sequences.has(seqKey)) {
      // Not a nicety. A tie in the order key falls back to insertion order,
      // which is arrival order, which is the A4 hole this whole file closes.
      return reject(
        'PROP-W5',
        `client_sequence ${action.clientSequence} is already used in this window. Your competing commitments are ` +
          `resolved by that number and never by arrival time, so two actions cannot share one.`,
      );
    }

    this.offered += 1;
    const queued: QueuedAction = {
      principal: action.principal,
      verb: action.verb,
      params: action.params,
      clientSequence: action.clientSequence,
      priority: action.priority ?? defaultPriority(action.verb, action.params),
      decisionSource: action.decisionSource,
      idempotencyKey: action.idempotencyKey ?? null,
      actedOnStateVersion: action.actedOnStateVersion ?? null,
      targetTick: this.target,
      arrivalMs: action.arrivalMs,
      arrivalOrdinal: this.arrivals,
    };
    this.arrivals += 1;
    this.sequences.add(seqKey);
    this.perPrincipal.set(action.principal, mine + 1);
    this.pending.push(queued);
    return { ok: true, queued };
  }

  /** Count a submission that never entered the window, for the offered total. */
  countRefused(): void {
    this.offered += 1;
  }

  /**
   * Close the window and hand over its contents, ordered.
   *
   * Sorting on a *copy* keyed by the projection, then asserting strict
   * increase: if two entries ever compare equal the sort has silently fallen
   * back to arrival order, and this throws rather than publishing a tick whose
   * outcome depended on who was fastest.
   */
  freeze(): FrozenWindow {
    this.open = false;
    const actions = [...this.pending].sort((a, b) => compareOrderKey(orderKeyOf(a), orderKeyOf(b)));
    for (let i = 1; i < actions.length; i += 1) {
      const prev = actions[i - 1];
      const cur = actions[i];
      if (prev === undefined || cur === undefined) continue;
      if (compareOrderKey(orderKeyOf(prev), orderKeyOf(cur)) >= 0) {
        throw new QueueError(
          `the frozen window is not strictly ordered: ${prev.principal}/${prev.clientSequence} and ` +
            `${cur.principal}/${cur.clientSequence} compare equal, so their order would be arrival order (A4)`,
        );
      }
    }
    const frozen: FrozenWindow = { tick: this.target, actions, offered: this.offered };
    this.pending = [];
    this.perPrincipal.clear();
    this.sequences.clear();
    this.arrivals = 0;
    this.offered = 0;
    return frozen;
  }
}
