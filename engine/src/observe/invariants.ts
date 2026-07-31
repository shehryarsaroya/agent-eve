/**
 * The observation's own assertions — PROP-O1, O3, O4, O8 and PROP-VI2, executable.
 *
 * ## Why these are functions and not just tests
 *
 * Because the rest of the engine is meant to run them. `TESTING.md` §2's invariants are
 * checked at tick close by `assert_invariants(world)`; these are the read surface's
 * equivalent, and {@link assertObservation} is written to be called by the API layer
 * outside production as well as by these tests. Four of the five faults below are the
 * kind that ship green: an eleventh key nobody counted, an affordance missing its worst
 * case, a countdown that moved backwards, an affordance naming a hand the reader cannot
 * see.
 *
 * ## The one thing this file will not do
 *
 * It never halts the world. `SPEC` §15.2's halt is for *our* bug inside a tick, and
 * `observe` is not inside a tick — it is a read. An agent that could make a read throw
 * has a denial-of-settlement lever (AGT-X9), so every function here returns faults and
 * only the two `assert*` wrappers throw, for callers who have decided that a broken
 * read is a test failure rather than a served request.
 */

import type { PrincipalId, SystemId } from '../core/types.js';
import { canonicalize } from '../core/canonical.js';
import { affordanceFaults, isVerb, type Affordance } from './affordance.js';
import { OBSERVE_KEYS, asCanonical, type Observation } from './observation.js';
import { canSense, type SensingIndex } from './sensing.js';
import { LIST_CAPS, estimateTokens, tokenCapFor } from './tokens.js';
import { WITHHELD_FIELDS, WITHHELD_GROUNDS } from './withheld.js';

export class ObservationFault extends Error {}

/**
 * PROP-O3 — **exactly** eleven top-level keys, in order.
 *
 * Order as well as count, because the eleven keys are read top to bottom by a model and
 * §12.1 lists them in decision order: the clock, then your body, then your
 * obligations, then what you can do about them. A payload that carried them in a
 * different order would still be eleven keys and would still be worse.
 */
export function keyFaults(observation: Observation): string[] {
  const keys = Object.keys(observation);
  const faults: string[] = [];
  if (keys.length !== OBSERVE_KEYS.length) {
    faults.push(
      `PROP-O3: an observation has exactly ${OBSERVE_KEYS.length} top-level keys (§17's budget is at its ` +
        `ceiling, so adding one means removing one); this one has ${keys.length}: ${keys.join(' ')}`,
    );
  }
  for (const [index, expected] of OBSERVE_KEYS.entries()) {
    if (keys[index] !== expected) {
      faults.push(`PROP-O3: key ${index} is '${String(keys[index])}', expected '${expected}'`);
    }
  }
  return faults;
}

/** PROP-O4 — every affordance carries all six honesty fields, with sane values. */
export function affordanceSetFaults(observation: Observation): string[] {
  const faults: string[] = [];
  for (const affordance of observation.affordances) {
    // `usesFreeAllowance` is a build-time fact and is not on the wire, so the seal
    // allowance is inferred here from the published cost. A `seal` at cost 0 is the
    // free one; anything else is checked against the engine's own charge.
    const free = affordance.verb === 'seal' && affordance.cost === 0;
    faults.push(...affordanceFaults(affordance, observation.header.tick, free));
  }
  if (observation.affordances.length > LIST_CAPS.affordances) {
    faults.push(
      `INV-26: ${observation.affordances.length} affordances against a declared cap of ` +
        `${LIST_CAPS.affordances}`,
    );
  }
  return faults;
}

/**
 * PROP-O1's payload-side half: every `withheld` row is well formed, and no row uses a
 * ground or a field outside the closed sets.
 *
 * The balance itself — `candidates === shown + Σ withheld` — is checked at build time,
 * where the denominators exist, and arrives as `BuildResult.accounting`. This is the
 * part that can be checked from the payload alone.
 */
export function withheldFaults(observation: Observation): string[] {
  const faults: string[] = [];
  const seen = new Set<string>();
  for (const row of observation.header.withheld) {
    if (!(WITHHELD_FIELDS as readonly string[]).includes(row.field)) {
      faults.push(`PROP-O1: withheld row names field '${row.field}', which is not one of the lists`);
    }
    if (!WITHHELD_GROUNDS.includes(row.ground)) {
      faults.push(`PROP-O1: withheld row carries ground '${row.ground}', which is not a declared ground`);
    }
    if (!Number.isSafeInteger(row.count) || row.count <= 0) {
      faults.push(
        `PROP-O1: withheld row ${row.field}/${row.ground} has count ${String(row.count)}; a row exists ` +
          'only when something was actually withheld',
      );
    }
    const key = `${row.field}::${row.ground}`;
    if (seen.has(key)) faults.push(`PROP-O1: ${key} appears twice; one row per (field, ground)`);
    seen.add(key);
  }
  return faults;
}

/** PROP-O2 — the payload is inside the tick's cap. */
export function budgetFaults(observation: Observation): string[] {
  const cap = tokenCapFor(observation.header.tick);
  const tokens = estimateTokens(asCanonical(observation));
  return tokens <= cap
    ? []
    : [
        `PROP-O2: the observation estimates ${tokens} tokens against a cap of ${cap} at tick ` +
          `${observation.header.tick}. The budget is met by eligibility filtering — add a rung, never a slice`,
      ];
}

/**
 * §12.4 — outside a wake the payload is "legal, free, and **useless**".
 *
 * Useless is the assertion. A stale payload with affordances in it would be a way to
 * read the option space for free, 288 times a day, which is A4 for cognition failing
 * quietly — the exact leak the wake budget exists to close.
 */
export function stalenessFaults(observation: Observation): string[] {
  const faults: string[] = [];
  if (!observation.header.stale) return faults;
  if (observation.affordances.length > 0) {
    faults.push(
      `§12.4: a stale observation carries ${observation.affordances.length} affordances; outside a wake ` +
        'there are no fresh affordances and no new quote_id, or the wake budget is not a budget',
    );
  }
  return faults;
}

/**
 * PROP-VI2 / AGT-X8 — **no affordance names something the reader cannot sense.**
 *
 * The leak a per-field test cannot see: offering `demand` against another principal's
 * hand *is* the assertion that the hand is there. So every param that looks like
 * another principal's hand or holding is checked against the sensing index, and the
 * reader's own hands are exempt because sensing your own body is not sensing.
 *
 * Deliberately checked on the **finished payload** rather than trusted from the
 * generator: the generator is where the rule is applied, and this is the independent
 * check on it. A future generator that forgets is caught here.
 */
export function sensingFaults(
  observation: Observation,
  principal: PrincipalId,
  sensing: SensingIndex,
  ownHandIds: ReadonlySet<string>,
): string[] {
  const faults: string[] = [];
  const own = new Set<string>([...ownHandIds]);
  for (const affordance of observation.affordances) {
    for (const [key, value] of Object.entries(affordance.params)) {
      if (typeof value !== 'string') continue;
      const looksLikeHand = key === 'hand' || key.endsWith('_hand');
      const looksLikeHolding = key === 'holding' || key.endsWith('_holding');
      if (!looksLikeHand && !looksLikeHolding) continue;
      if (own.has(value)) continue;
      // A `SENSED` subject must be sensed *somewhere*; the affordance itself names
      // where, through `at`/`to`, and if it names nowhere the fact is unsourced.
      const at = affordance.params['at'] ?? affordance.params['to'];
      if (typeof at !== 'string' || !canSense(sensing, principal, at as SystemId, value)) {
        faults.push(
          `PROP-VI2: affordance '${affordance.verb}' names ${key}=${value}, which this principal has no ` +
            'hand in range of and has bought no intel on. Affordance existence is a SENSED fact (AGT-X8)',
        );
      }
    }
  }
  return faults;
}

/**
 * PROP-O8 — no derived countdown moves backwards across two successive fetches
 * (scar #14d).
 *
 * Two claims, and the second is the one that would actually hurt an agent:
 *
 * 1. **`next_reckoning.ticks` never rises** while the deadline is unchanged. It is
 *    derived from `header.tick` inside a single payload, so this holds by arithmetic;
 *    the assertion is here because the derivation could be moved.
 * 2. **`next_reckoning.tick` never moves earlier.** An announced deadline that comes
 *    forward is a lie an agent has already planned against. Moving *later* is legal —
 *    that is the next Reckoning — so only the earlier direction is a fault.
 *
 * `next_decision_at.tick` is exempt from clause 2 on purpose: it legitimately moves
 * earlier when a nearer option appears, which is information rather than a broken
 * promise. What it may not do is move earlier than the current tick, which is checked.
 */
export function countdownFaults(before: Observation, after: Observation): string[] {
  const faults: string[] = [];
  if (after.header.tick < before.header.tick) {
    faults.push(
      `PROP-O8: tick went backwards ${before.header.tick} -> ${after.header.tick}; the world does not rewind`,
    );
  }
  if (after.header.next_reckoning.tick < before.header.next_reckoning.tick) {
    faults.push(
      `PROP-O8: the announced Reckoning moved earlier, ${before.header.next_reckoning.tick} -> ` +
        `${after.header.next_reckoning.tick}. An agent has already planned against the first one`,
    );
  }
  if (
    after.header.next_reckoning.tick === before.header.next_reckoning.tick &&
    after.header.next_reckoning.ticks > before.header.next_reckoning.ticks
  ) {
    faults.push(
      `PROP-O8: the countdown to the same Reckoning rose ${before.header.next_reckoning.ticks} -> ` +
        `${after.header.next_reckoning.ticks}; send serverNow plus the deadline and derive nothing twice`,
    );
  }
  for (const observation of [before, after]) {
    if (observation.header.next_decision_at.tick < observation.header.tick) {
      faults.push(
        `PROP-O8: next_decision_at ${observation.header.next_decision_at.tick} is before the payload's own ` +
          `tick ${observation.header.tick}`,
      );
    }
  }
  return faults;
}

/** Every fault a single payload can be checked for. */
export function checkObservation(observation: Observation): string[] {
  return [
    ...keyFaults(observation),
    ...affordanceSetFaults(observation),
    ...withheldFaults(observation),
    ...budgetFaults(observation),
    ...stalenessFaults(observation),
    ...serialisationFaults(observation),
  ];
}

/**
 * The payload canonicalises. Proves no float, no `undefined` in an array, no `Map`,
 * and therefore that it can be hashed and golden-filed.
 */
export function serialisationFaults(observation: Observation): string[] {
  try {
    canonicalize(asCanonical(observation));
    return [];
  } catch (error) {
    return [`the observation is not canonical: ${error instanceof Error ? error.message : String(error)}`];
  }
}

/** Throw on any fault. For tests and for a non-production API build. */
export function assertObservation(observation: Observation): void {
  const faults = checkObservation(observation);
  if (faults.length > 0) {
    throw new ObservationFault(`observation is not well formed:\n  - ${faults.join('\n  - ')}`);
  }
}

export function assertCountdownMonotonic(before: Observation, after: Observation): void {
  const faults = countdownFaults(before, after);
  if (faults.length > 0) {
    throw new ObservationFault(`PROP-O8 violated:\n  - ${faults.join('\n  - ')}`);
  }
}

/** Every verb an observation currently publishes. For the coverage audit. */
export function verbsOffered(observation: Observation): readonly string[] {
  const seen = new Set<string>();
  for (const affordance of observation.affordances) {
    if (isVerb(affordance.verb)) seen.add(affordance.verb);
  }
  return [...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Affordances for one verb, in payload order. A convenience for tests and the client. */
export function affordancesFor(observation: Observation, verb: string): readonly Affordance[] {
  return observation.affordances.filter((a) => a.verb === verb);
}
