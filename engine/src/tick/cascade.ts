/**
 * Cascades in fixed rounds. DET-9, and the A5′ failure it exists to prevent.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **AN OBLIGATION UNRESOLVED AT THE ROUND LIMIT DEFERS. IT NEVER DEFAULTS.**
 * ══════════════════════════════════════════════════════════════════════════
 *
 * SPEC §15.3, in full, because every clause of it is load-bearing: "cascade in
 * ≤3 fixed rounds, and **an obligation still unresolved at the round limit DEFERS
 * to the next Reckoning; it never defaults** (a truncated cascade recording a
 * breach is an engine-fabricated default, and a rival can construct one
 * deliberately)."
 *
 * Two distinct failures are being closed at once:
 *
 * 1. **Unboundedness.** A loop to convergence over an obligation graph an agent
 *    can shape is an agent-controlled amount of work inside a tick. Three
 *    principals paying each other in a ring is enough. So the rounds are fixed
 *    and the step count is bounded by `rounds × items` — not by the graph.
 * 2. **The fabricated default.** This is the worse one. If truncation recorded a
 *    breach, then a rival could *build* the cycle on purpose and get an innocent
 *    principal permanently marked in an append-only public record — A5′, the one
 *    thing this design says is worse than a crash. So the outcome type here has
 *    **no variant for a breach at all**: {@link CascadeStatus} is `RESOLVED` or
 *    `DEFERRED` and nothing else. The cascade cannot express a default, so no
 *    amount of caller confusion can make it emit one. Its resolver *may* report a
 *    breach it found on the merits — that is {@link CascadeStep.breached}, which
 *    can only be set by a resolver that ran, never by the limit being hit.
 *
 * §14's `DEFERRED` is already a `VentureState` in `core/types.ts`, so a deferral
 * has a home in the record and does not need a new word (§3).
 *
 * **The round limit lives in one place.** `CASCADE_ROUND_LIMIT` is the invariants
 * module's constant, imported here rather than restated, because the number that
 * bounds the cascade and the number `assertBoundedRounds` checks against must be
 * the same number — two copies of a limit is a limit that will eventually disagree
 * with itself. The import is from that file directly rather than through its index,
 * to keep the coupling to exactly the one rule.
 */

import { CASCADE_ROUND_LIMIT } from '../invariants/transaction.js';

/** Two endings, and there is deliberately no third. */
export type CascadeStatus = 'RESOLVED' | 'DEFERRED';

/**
 * What a resolver may report about one attempt.
 *
 * `WAITING` means "this one depends on something not settled yet" — try again
 * next round. It is the only way an item survives a round, and it is why the
 * round limit exists.
 */
export type CascadeAttempt =
  | { readonly done: true; readonly breached: boolean; readonly note: string }
  | { readonly done: false; readonly waitingOn: string };

export interface CascadeStep {
  readonly round: number;
  readonly id: string;
  readonly done: boolean;
  /**
   * A breach found **on the merits by a resolver that ran**. The round limit can
   * never set this; see the file header.
   */
  readonly breached: boolean;
  readonly note: string;
}

export interface Deferral {
  readonly id: string;
  /** What it was still waiting for when the rounds ran out. */
  readonly waitingOn: string;
  /**
   * The reason string that goes on the record. Fixed text, because a deferral is
   * not a judgment about anybody and must never read like one.
   */
  readonly reason: string;
}

export interface CascadeResult {
  readonly rounds: number;
  /** Resolver invocations. Asserted bounded: `≤ rounds × items` (DET-9). */
  readonly steps: number;
  readonly resolved: readonly CascadeStep[];
  /** Unresolved at the limit. **Deferred, never defaulted.** */
  readonly deferred: readonly Deferral[];
  /** True when the limit was reached with work outstanding. */
  readonly truncated: boolean;
}

export class CascadeError extends Error {}

export const DEFERRAL_REASON =
  'unresolved after the fixed cascade rounds; deferred to the next Reckoning. This is not a default and ' +
  'no promise was broken: the engine ran out of rounds, not the parties out of good faith.';

/**
 * Run a cascade.
 *
 * `ids` must already be in a canonical order — settlement order is `venture_id`
 * (§15.3, PROP-V7) — because the round order is the resolution order and a set
 * iterated differently on two runs is DET-1 failing quietly. This function does
 * **not** sort for you: sorting here would hide the fact that the caller had an
 * order to choose, and the caller is the one that knows the canonical key.
 */
export function runCascade(
  ids: readonly string[],
  attempt: (id: string, round: number) => CascadeAttempt,
  rounds: number = CASCADE_ROUND_LIMIT,
): CascadeResult {
  if (!Number.isSafeInteger(rounds) || rounds < 1) {
    throw new CascadeError(`a cascade needs at least one fixed round, got ${String(rounds)}`);
  }
  if (new Set(ids).size !== ids.length) {
    // A duplicate id would be resolved twice, which for a settlement means paying
    // twice. Scar #14a was exactly a helper concatenating two overlapping lists.
    throw new CascadeError('cascade ids must be unique; a duplicate would resolve the same obligation twice');
  }

  const resolved: CascadeStep[] = [];
  let pending = [...ids];
  let waitingOn = new Map<string, string>();
  let steps = 0;
  let roundsRun = 0;

  for (let round = 1; round <= rounds && pending.length > 0; round += 1) {
    roundsRun = round;
    const next: string[] = [];
    const stillWaiting = new Map<string, string>();
    for (const id of pending) {
      steps += 1;
      const outcome = attempt(id, round);
      if (outcome.done) {
        resolved.push({ round, id, done: true, breached: outcome.breached, note: outcome.note });
      } else {
        next.push(id);
        stillWaiting.set(id, outcome.waitingOn);
      }
    }
    // No progress this round means no progress in any later round either: the
    // same inputs produce the same answers. Stopping early is not a shortcut past
    // the fixed-round rule — it is the same result with fewer steps, and it keeps
    // the bound tight for the adversarial ring case.
    if (next.length === pending.length) {
      pending = next;
      waitingOn = stillWaiting;
      break;
    }
    pending = next;
    waitingOn = stillWaiting;
  }

  const deferred: Deferral[] = pending.map((id) => ({
    id,
    waitingOn: waitingOn.get(id) ?? 'unknown',
    reason: DEFERRAL_REASON,
  }));

  const maxSteps = rounds * ids.length;
  if (steps > maxSteps) {
    // Unreachable by construction; asserted because DET-9's claim is that the
    // tick's step count is bounded *regardless of input*, and an assertion is the
    // only form of that claim a reader can check.
    throw new CascadeError(`cascade took ${steps} steps, above the bound of ${rounds} x ${ids.length}`);
  }

  return { rounds: roundsRun, steps, resolved, deferred, truncated: pending.length > 0 };
}
