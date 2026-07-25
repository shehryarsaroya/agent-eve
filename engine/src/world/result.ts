/**
 * Rejections carry the rule and the hint, and they live next to the rule.
 *
 * SPEC §12.2: "Illegal actions never error: return the violated invariant, the
 * changed fields, the nearest legal affordance, and a fresh observation." High
 * Water proved the same thing from the other side (validated pattern 4): an agent
 * that gets a 400 wastes its turn and often loops, while an agent that gets a
 * hint corrects itself immediately.
 *
 * The reason the hint text is authored *here*, in the rules layer, rather than in
 * the HTTP layer: the hint is a **rules surface** (scar #1). If the engine
 * rejects a move for reason X and the transport layer writes its own sentence
 * about reason Y, the agent's model of the world is wrong and no unit test sees
 * it. One rule, one sentence, one place.
 */

export interface Rejection {
  readonly ok: false;
  /** The rule that refused: an axiom (`A8`) or an invariant (`INV-8`). */
  readonly invariant: string;
  /** One sentence, addressed to the agent, naming what to do instead. */
  readonly hint: string;
}

export interface Accepted<T> {
  readonly ok: true;
  readonly value: T;
}

export type WorldResult<T> = Accepted<T> | Rejection;

export function reject(invariant: string, hint: string): Rejection {
  return { ok: false, invariant, hint };
}

export function accept<T>(value: T): Accepted<T> {
  return { ok: true, value };
}
