/**
 * The CHARTER: constitutional rules, fixed at founding, enforced by the engine.
 *
 * ## Why it cannot be amended, and why that is the feature
 *
 * A charter is what a prospective member relies on when it hands over goods it cannot retrieve on
 * demand. If an incumbent majority could amend it, the terms you joined under are a preference
 * rather than a promise — and every org game that allows amendment collapses to "whoever holds the
 * votes today owns everything", which is not politics, it is just a slower kind of theft.
 *
 * So: **set once, at `form`, and never again.** A syndicate that wants different rules is a
 * different syndicate, and founding one is cheap enough to be a real answer. That also makes the
 * charter a legible object for a spectator — a fact about the org rather than a snapshot of its
 * current faction.
 *
 * The consequence a founder must be told, and is: a badly-drafted charter is permanent. That is
 * stated in the affordance, because A2 says the known arithmetic is exact and a one-way decision
 * with no warning is the graduation bug in a different costume.
 */

import type { CanonicalValue } from '../core/canonical.js';
import { readObject, readString, SnapshotError } from '../tick/snapshot.js';

/**
 * How a syndicate admits members. Constitutional, because it decides who can ever be inside.
 *
 * `OPEN` — any principal may `join` and is admitted at the next tick.
 * `INVITE` — a sitting member must `admit` an applicant.
 * `CLOSED` — the founding membership is final; nobody else ever joins.
 */
export const ADMISSION_RULES = ['OPEN', 'INVITE', 'CLOSED'] as const;
export type AdmissionRule = (typeof ADMISSION_RULES)[number];

/**
 * How a syndicate decides. Constitutional, because it decides who can ever be overruled.
 *
 * `FOUNDER` — the founder decides alone. Honest autocracy, and legible as such.
 * `MAJORITY` — more than half the sitting members.
 * `UNANIMOUS` — every sitting member. Safe and easily paralysed, which is a real trade.
 */
export const DECISION_RULES = ['FOUNDER', 'MAJORITY', 'UNANIMOUS'] as const;
export type DecisionRule = (typeof DECISION_RULES)[number];

export interface Charter {
  readonly admission: AdmissionRule;
  readonly decision: DecisionRule;
  /**
   * Whether an office may be granted authority over the pooled treasury at all.
   *
   * The single most consequential clause, and it is constitutional on purpose: a member deciding
   * whether to pool its goods is deciding whether *anyone* can ever spend them but the collective.
   * A syndicate whose charter says `false` is a strongbox; one that says `true` is a business, and
   * the difference has to be knowable before you are inside rather than after.
   */
  readonly treasuryOffices: boolean;
}

export function isAdmissionRule(value: string): value is AdmissionRule {
  return (ADMISSION_RULES as readonly string[]).includes(value);
}

export function isDecisionRule(value: string): value is DecisionRule {
  return (DECISION_RULES as readonly string[]).includes(value);
}

/** The default charter, used when `form` names no clauses. Deliberately the most cautious one. */
export const DEFAULT_CHARTER: Charter = Object.freeze({
  admission: 'INVITE',
  decision: 'MAJORITY',
  // Defaults to FALSE, because the safe default for "can one member spend the pool" is no. A
  // founder that wants a business says so explicitly, and the affordance tells it the clause is
  // permanent before it does.
  treasuryOffices: false,
});

/** The sentence a founder reads before it commits to rules it can never change. */
export const CHARTER_STATEMENT =
  'A CHARTER IS PERMANENT. It is fixed at `form` and there is no verb in this game that amends one — ' +
  'not a vote, not the founder, not a unanimous membership. That is deliberate: a charter an ' +
  'incumbent majority could amend is not a promise to the people who joined under it, and the only ' +
  'reason to pool goods you cannot withdraw on demand is that the terms cannot move once you are ' +
  'inside. If you want different rules, `form` a different syndicate. Choose `admission` (OPEN · ' +
  'INVITE · CLOSED), `decision` (FOUNDER · MAJORITY · UNANIMOUS) and `treasury_offices` (true or ' +
  'false) knowing all three are final. `treasury_offices` is the one that matters most: false makes ' +
  'the pool a strongbox nobody can spend alone, true lets an OFFICE-HOLDER spend it — which is how ' +
  'a syndicate does business, and how one is looted.';

export function parseCharter(params: Readonly<Record<string, unknown>>): Charter | { readonly fault: string } {
  // Read as strings or not at all. `String(unknown)` would turn a nested object into
  // "[object Object]" and then report it as an unknown clause — a confusing hint for what is
  // really a malformed request, and the lint rule that catches it is right to.
  const rawAdmission = params['admission'];
  const rawDecision = params['decision'];
  if (rawAdmission !== undefined && typeof rawAdmission !== 'string') {
    return { fault: 'admission must be a string, one of ' + ADMISSION_RULES.join(' · ') + '.' };
  }
  if (rawDecision !== undefined && typeof rawDecision !== 'string') {
    return { fault: 'decision must be a string, one of ' + DECISION_RULES.join(' · ') + '.' };
  }
  const admission = (rawAdmission ?? DEFAULT_CHARTER.admission).toUpperCase();
  const decision = (rawDecision ?? DEFAULT_CHARTER.decision).toUpperCase();
  const treasury = params['treasury_offices'] ?? params['treasuryOffices'] ?? DEFAULT_CHARTER.treasuryOffices;
  if (!isAdmissionRule(admission)) {
    return { fault: `admission must be one of ${ADMISSION_RULES.join(' · ')}; got "${admission}".` };
  }
  if (!isDecisionRule(decision)) {
    return { fault: `decision must be one of ${DECISION_RULES.join(' · ')}; got "${decision}".` };
  }
  if (typeof treasury !== 'boolean') {
    return { fault: 'treasury_offices must be true or false, and it is permanent — see the statement.' };
  }
  return { admission, decision, treasuryOffices: treasury };
}

export function captureCharter(charter: Charter): CanonicalValue {
  return { admission: charter.admission, decision: charter.decision, treasuryOffices: charter.treasuryOffices };
}

export function restoreCharter(value: CanonicalValue, where: string): Charter {
  const o = readObject(value, where);
  const admission = readString(o, 'admission', where);
  const decision = readString(o, 'decision', where);
  const treasury = o['treasuryOffices'];
  if (!isAdmissionRule(admission)) throw new SnapshotError(`${where}.admission unknown: ${admission}`);
  if (!isDecisionRule(decision)) throw new SnapshotError(`${where}.decision unknown: ${decision}`);
  if (typeof treasury !== 'boolean') throw new SnapshotError(`${where}.treasuryOffices must be a boolean`);
  return { admission, decision, treasuryOffices: treasury };
}
