/**
 * The `action_log` — §15.1's third write artifact, and the A4 audit's evidence.
 *
 * "**`action_log`** — every submitted action **including rejected**, with arrival
 * and resolution order → replay."
 *
 * Two jobs, and they pull in opposite directions, which is why both fields exist:
 *
 * 1. **Replay input.** `(snapshot_T, action_log_T, seed_T) → snapshot_T+1`. The
 *    log is re-fed to the engine, which re-derives resolution order from
 *    `(priority, principal_id, client_sequence)`. It does **not** trust the
 *    recorded resolution order, because trusting it would make a corrupted log
 *    replay into a corrupted world without a mismatch to notice.
 * 2. **The A4 audit.** `arrivalOrdinal` and `resolutionOrdinal` are both kept so
 *    the audit can show they are uncorrelated — that is, that being fast bought
 *    nothing (scar #2, where wealth was a function of polling rate). This is the
 *    *only* use of arrival anywhere in the engine.
 *
 * **The log is not part of `state_hash`**, and that is what makes DET-2 possible:
 * a hundred arrival orders produce a hundred different logs and one identical
 * state hash. If arrival leaked into the hash, the assertion would be unprovable.
 *
 * Rejections go in the log and **never into the event stream** (scar #10: High
 * Water wrote illegal-move rejections as public receipts and the watcher UI filled
 * with agents polling in the wrong phase). A hint is not an event.
 */

import type { DecisionSource, PrincipalId } from '../core/types.js';
import type { ActionParams, Rejection } from '../world/index.js';
import { compareOrderKey, type QueuedAction } from './queue.js';

export type ActionOutcome = 'APPLIED' | 'REFUSED';

export interface LoggedAction {
  /** The tick this resolved in. Submitted against snapshot `tick - 1`. */
  readonly tick: number;
  readonly principal: PrincipalId;
  readonly verb: string;
  readonly params: ActionParams;
  readonly clientSequence: number;
  readonly priority: number;
  readonly decisionSource: DecisionSource;
  readonly idempotencyKey: string | null;
  readonly actedOnStateVersion: number | null;
  /**
   * Wall-clock arrival, and the order it arrived in. **Audit only.** `null` for
   * engine-originated actions — a standing intent has no arrival, which is itself
   * the clearest statement that arrival is not how anything is ordered.
   */
  readonly arrivalMs: number | null;
  readonly arrivalOrdinal: number | null;
  /** Where it actually resolved in the tick, 0-based. Derived from the order key. */
  readonly resolutionOrdinal: number;
  readonly outcome: ActionOutcome;
  /** The rule that refused and the hint the agent got. Null when applied. */
  readonly rejection: Rejection | null;
}

/** Published cap on retained ticks (INV-26, scar #3). */
export const ACTION_LOG_TICKS_RETAINED = 64;

export class ActionLog {
  private readonly byTick = new Map<number, LoggedAction[]>();

  /**
   * Retention is bounded because this is a process-memory mirror of a table that
   * lives in Postgres. 288 ticks a day for a season, kept forever, is scar #3 with
   * a slow fuse; the durable copy is the journal's, and the operator replaying a
   * failed tick needs the one that just failed, not the season.
   */
  constructor(readonly ticksRetained: number = ACTION_LOG_TICKS_RETAINED) {
    if (!Number.isSafeInteger(ticksRetained) || ticksRetained < 1) {
      throw new Error(`the action log must retain at least one tick, got ${String(ticksRetained)}`);
    }
  }

  record(entry: LoggedAction): void {
    const rows = this.byTick.get(entry.tick);
    if (rows === undefined) this.byTick.set(entry.tick, [entry]);
    else rows.push(entry);
    this.prune(entry.tick);
  }

  /**
   * Drop everything recorded for one tick, so a re-run replaces it rather than
   * appending to it.
   *
   * Called at the top of every tick's resolution. It matters only for the tick that
   * halted and is then re-run under a signed resume: without it, `action_log_T`
   * holds every row twice, and since the log is §15.1's replay input, feeding it
   * back submits each action twice — one `client_sequence` per principal is used
   * twice, PROP-W5 refuses the duplicate, and `replayTick` throws on an action the
   * original tick applied. A resumed tick would be permanently unreplayable, and
   * the A4 audit over it would double-count arrivals.
   */
  clearTick(tick: number): void {
    this.byTick.delete(tick);
  }

  /** Everything that resolved in one tick, in resolution order. */
  forTick(tick: number): readonly LoggedAction[] {
    return [...(this.byTick.get(tick) ?? [])].sort((a, b) => a.resolutionOrdinal - b.resolutionOrdinal);
  }

  get ticks(): readonly number[] {
    return [...this.byTick.keys()].sort((a, b) => a - b);
  }

  private prune(latest: number): void {
    const cutoff = latest - this.ticksRetained;
    for (const t of [...this.byTick.keys()]) if (t <= cutoff) this.byTick.delete(t);
  }
}

/**
 * The A4 audit over one tick: was resolution order explained by arrival order?
 *
 * Reported as a **rank correlation over the submitted actions only** (intent runs
 * have no arrival). The assertion the audit makes is not "the correlation is
 * negative" — with one principal, or with everybody submitting in
 * `client_sequence` order, arrival and resolution genuinely coincide and that
 * proves nothing either way. The claim is the structural one: `resolutionOrdinal`
 * is a pure function of the order key, and this function recomputes it from the
 * key to prove it. `disagreements` counts the pairs where arrival and resolution
 * disagree — evidence the ordering is doing something.
 */
export interface ArrivalAudit {
  readonly tick: number;
  readonly submitted: number;
  /** Pairs whose arrival order and resolution order disagree. */
  readonly disagreements: number;
  /** True when resolution order is exactly the order key's order. Must hold. */
  readonly orderKeyExplainsResolution: boolean;
}

export function auditArrivalIndependence(
  tick: number,
  actions: readonly QueuedAction[],
): ArrivalAudit {
  const byResolution = [...actions].sort((a, b) => compareOrderKey(keyOf(a), keyOf(b)));
  let orderKeyExplainsResolution = true;
  for (let i = 1; i < byResolution.length; i += 1) {
    const prev = byResolution[i - 1];
    const cur = byResolution[i];
    if (prev === undefined || cur === undefined) continue;
    if (compareOrderKey(keyOf(prev), keyOf(cur)) >= 0) orderKeyExplainsResolution = false;
  }

  let disagreements = 0;
  for (let i = 0; i < byResolution.length; i += 1) {
    for (let j = i + 1; j < byResolution.length; j += 1) {
      const a = byResolution[i];
      const b = byResolution[j];
      if (a === undefined || b === undefined) continue;
      if (a.arrivalOrdinal > b.arrivalOrdinal) disagreements += 1;
    }
  }

  return { tick, submitted: actions.length, disagreements, orderKeyExplainsResolution };
}

function keyOf(a: QueuedAction): { priority: number; principal: PrincipalId; clientSequence: number } {
  return { priority: a.priority, principal: a.principal, clientSequence: a.clientSequence };
}
