/**
 * The correction channel — **an illegal action is not an error** (SPEC §12.2,
 * PROP-O7).
 *
 * > "Illegal actions never error: return the violated invariant, the changed fields,
 * > the nearest legal affordance, and a fresh observation. Hints go to the agent's
 * > correction channel and **never** to the public feed (scar #10)."
 *
 * `agent.md` §7 promises the same thing in the same order: *"You get back: the
 * invariant you violated, what changed, the nearest legal thing you could do instead,
 * and a fresh observation. Never a stack trace, never a bare rejection. Correction
 * goes to you privately — it never appears in the public feed."*
 *
 * ## Four fields, and each is a different failure if it is missing
 *
 * - **`invariant`** — without it the agent knows only *no*, and it will retry. High
 *   Water's validated pattern was `{ok:false, hint}` plus a fresh observe, and it is
 *   the reason three tester agents could play from the docs alone.
 * - **`changed`** — the agent acted on a snapshot; the useful part of a refusal is
 *   *what moved since*. Computed by diffing the top-level keys of the observation it
 *   acted on against the fresh one, so it is a fact rather than a guess.
 * - **`nearest`** — a refusal with no next move is a dead end, and a dead end in a
 *   game an agent plays continuously is where it starts looping.
 * - **`observation`** — the retry has to be against current state, or the agent
 *   burns another action learning the same thing.
 *
 * ## Nothing here is public
 *
 * Scar #10 was a correction that reached the public feed. This module returns a value
 * to one caller and appends nothing anywhere: there is no `EventLedger` import in this
 * file, and there must never be one. A public "X tried something illegal" line is a
 * permanent record of somebody's mistake, which is the opposite of the record this
 * game keeps.
 */

import type { PrincipalId } from '../core/types.js';
import { canonicalize, type CanonicalValue } from '../core/canonical.js';
import { compareIds } from '../ledger/index.js';
import type { Rejection } from '../world/index.js';
import type { Affordance } from './affordance.js';
import { OBSERVE_KEYS, asCanonical, type Observation } from './observation.js';
import { LIST_CAPS, line } from './tokens.js';

/**
 * A refusal, in full. Never thrown, never logged publicly, never an HTTP 5xx.
 *
 * `ok: false` matches High Water's proven shape and `agent.md`'s own description; the
 * literal is part of the wire contract, so it is not a boolean the caller invents.
 */
export interface Correction {
  readonly ok: false;
  /** The invariant or property id the act would have violated. Never a stack trace. */
  readonly invariant: string;
  readonly hint: string;
  /** Top-level observation keys that moved since the state the agent acted on. */
  readonly changed: readonly string[];
  readonly nearest: Affordance | null;
  readonly observation: Observation;
}

/**
 * Which of the ten keys differ between two observations.
 *
 * Compared through `canonicalize` rather than by reference or by `JSON.stringify`:
 * canonical form sorts keys, so two payloads that differ only in property order are
 * correctly reported as *unchanged*, and a float or a `Map` sneaking into either one
 * throws here rather than producing a silent false "changed".
 */
export function changedKeys(before: Observation | null, after: Observation): readonly string[] {
  if (before === null) return Object.freeze([...OBSERVE_KEYS]);
  const a = asCanonical(before) as Record<string, CanonicalValue>;
  const b = asCanonical(after) as Record<string, CanonicalValue>;
  const changed: string[] = [];
  for (const key of OBSERVE_KEYS) {
    const left = a[key];
    const right = b[key];
    // A missing key is itself a difference, and it is one `keyFaults` will also
    // report — never silently equal.
    if (left === undefined || right === undefined) {
      changed.push(key);
      continue;
    }
    if (canonicalize(left) !== canonicalize(right)) changed.push(key);
  }
  return Object.freeze(changed.sort((x, y) => compareIds(x, y)));
}

/**
 * Pick the nearest legal act to one that was refused.
 *
 * Same verb first, then the most valuable thing on offer. Deliberately *not* a
 * similarity metric over params: a plausible-looking near-miss ("did you mean this
 * other hand?") is a suggestion the agent did not ask for and might act on, and
 * suggesting a *different target* for a refused act is how an engine helpfully aims
 * somebody at the wrong hand.
 */
export function nearestLegal(
  affordances: readonly Affordance[],
  verb: string,
): Affordance | null {
  const sameVerb = affordances.filter((a) => a.verb === verb);
  if (sameVerb.length > 0) {
    return [...sameVerb].sort((x, y) => y.max_direct_loss - x.max_direct_loss)[0] ?? null;
  }
  return affordances[0] ?? null;
}

export interface CorrectionInput {
  readonly principal: PrincipalId;
  /** What the world module refused, verbatim — its invariant id and its hint. */
  readonly rejection: Rejection;
  readonly verb: string;
  /** The fresh observation to return with the refusal. */
  readonly observation: Observation;
  /** The observation the agent acted on, if we still hold it. */
  readonly actedOn: Observation | null;
}

export function correctionFor(input: CorrectionInput): Correction {
  return Object.freeze({
    ok: false,
    invariant: input.rejection.invariant,
    // Capped like every other prose field, so a refusal cannot be the one unbounded
    // string in the payload (INV-26).
    hint: line(input.rejection.hint),
    changed: changedKeys(input.actedOn, input.observation).slice(0, LIST_CAPS.withheldRows),
    nearest: nearestLegal(input.observation.affordances, input.verb),
    observation: input.observation,
  });
}

/**
 * Everything wrong with a correction, or empty. PROP-O7 as a checker.
 *
 * The one clause worth reading twice: a correction whose `observation` carries
 * affordances but whose `nearest` is null has told the agent "no, and there is nothing
 * you can do" while holding a list of things it can do. That is the dead end this
 * shape exists to prevent, so it is a fault rather than a stylistic preference.
 */
export function correctionFaults(correction: Correction): string[] {
  const faults: string[] = [];
  if (correction.ok !== false) faults.push('PROP-O7: a correction is never ok:true');
  if (correction.invariant.length === 0) {
    faults.push('PROP-O7: a correction names the invariant it violated, never a bare rejection');
  }
  if (correction.hint.length === 0) {
    faults.push('PROP-O7: a correction carries a hint an agent can act on');
  }
  if (correction.nearest === null && correction.observation.affordances.length > 0) {
    faults.push(
      'PROP-O7: a correction with legal affordances available must name the nearest one; a refusal ' +
        'with no next move is where an agent starts looping',
    );
  }
  if (/\n\s+at\s/.test(correction.hint)) {
    faults.push('PROP-O7: the hint looks like a stack trace; agent.md promises never a stack trace');
  }
  return faults;
}
