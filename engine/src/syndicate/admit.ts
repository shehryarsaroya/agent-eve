/**
 * `admit`, as a function of its inputs rather than a method on the world.
 *
 * ── WHY THIS LIVES HERE AND NOT IN `sim/runtime.ts` ──────────────────────────
 *
 * Second of D21's syndicate cluster, same reasons as {@link ../syndicate/form.js} and the same shape.
 * See that file's header for the cost this refactor is paying down.
 *
 * ── THE PORT IS ONE MEMBER, AND THAT IS THE ARGUMENT FOR PORTS ───────────────
 *
 * `admit` reads its own book for everything except a single question — *has the principal I am naming
 * actually enrolled?* — which belongs to the world's holdings, not to the syndicate. So the port is
 * exactly one method wide, and the signature says so: this verb touches the syndicate book, one
 * holdings lookup, and nothing else in a 16,000-line class. That is the property D21 wanted and the
 * reason not to pass the whole `Runtime`, which would compile and buy nothing.
 */

import type { PrincipalId } from '../core/types.js';
import { reject, type Rejection, type WorldResult } from '../world/result.js';
import { describeError } from './describe.js';
import type { Book, SyndicateId, SyndicateRecord } from './book.js';

/** Everything `admit` touches beyond its own book. One member, and it is called. */
export interface AdmitPort {
  /**
   * Has this principal enrolled — does it have a standing holding?
   *
   * Asked of the world rather than inferred from the book, because a principal that has never joined
   * anything and a principal that does not exist are the same answer in the book and different facts
   * to an agent (A2). Admitting a name nobody holds would write a membership row for a ghost.
   */
  isSeated(principal: PrincipalId): boolean;
}

/** What the caller has to name. Both fields are the agent's own statement. */
export interface AdmitRequest {
  /** The sitting member doing the admitting. */
  readonly member: PrincipalId;
  readonly syndicate: SyndicateId;
  /** The principal being brought in. */
  readonly who: PrincipalId;
  readonly tick: number;
}

/**
 * **Every gate on `admit`, in one place, in published order.** Returns the refusal, or `null`.
 *
 * Order is preserved exactly as it stood in the runtime, because it is observable: a non-member naming
 * a non-existent principal under a CLOSED charter reads *one* of these sentences, and which one is the
 * difference between "you may not do this" and "that is not a thing". Reordering them would silently
 * change what an agent is told without moving a single state table — so `state_hash` could not catch it
 * and only this comment and the tests can.
 */
export function admitRefusal(port: AdmitPort, book: Book, req: AdmitRequest): Rejection | null {
  const row = book.at(req.syndicate);
  if (row === null) return reject('A2', `there is no syndicate ${req.syndicate}.`);
  if (!book.isMember(req.syndicate, req.member, req.tick)) {
    return reject('A2', `you are not a sitting member of ${req.syndicate}, so you cannot admit anyone to it.`);
  }
  if (row.charter.admission === 'CLOSED') {
    return reject(
      'A2',
      `${req.syndicate}'s charter is CLOSED: its founding membership is final and nobody may ever be admitted. ` +
        'That clause is permanent and no vote changes it.',
    );
  }
  if (!port.isSeated(req.who)) {
    return reject('A2', `there is no principal ${req.who} to admit; name one that has enrolled.`);
  }
  // ── THIS GATE IS REDUNDANT FOR THE VERB, AND KEPT ON PURPOSE ────────────────
  //
  // `Book.admit` calls `admissionFault` itself and throws the fault string, which {@link admit}'s catch
  // turns into the same `A2` hint — the fault strings are single-line, so `describeError` changes
  // nothing. Both roads therefore produce **byte-identical** refusals, and deleting this line passes
  // every test. That was checked by mutation rather than assumed, and it is the reason the mutation
  // survives: a redundancy, not a coverage gap. `admit-gates.spec.ts` pins the equivalence, so if the
  // check is ever removed from `Book.admit` this line stops being decoration and the test says so.
  //
  // Kept because this predicate's *purpose* is to be shared with the affordance, which must not offer
  // an admission the verb would refuse. An affordance calling a version of this that skipped the fault
  // would offer `admit` to a full syndicate — the exact "affordance offers an illegal move" failure the
  // one-predicate rule exists to prevent.
  const fault = book.admissionFault(req.syndicate, req.who, req.tick);
  if (fault !== null) return reject('A2', fault);
  return null;
}

/**
 * A sitting member brings somebody in under an INVITE charter.
 *
 * The counterpart to `apply`'s refusal under INVITE, and the reason that refusal can name a concrete
 * next step — *`message` a member and it will admit you* — instead of an apology. Under `OPEN` a
 * newcomer admits itself through `apply`; under `CLOSED` nobody is ever admitted; this verb is what
 * makes the middle rule mean something.
 *
 * Returns the row, for the adapter to announce.
 */
export function admit(port: AdmitPort, book: Book, req: AdmitRequest): WorldResult<SyndicateRecord> {
  const refusal = admitRefusal(port, book, req);
  if (refusal !== null) return refusal;
  const row = book.at(req.syndicate);
  // Unreachable — `admitRefusal` returns on a null row. Re-read rather than cast, so a future reorder
  // that dropped that gate refuses here instead of dereferencing null in front of an agent.
  if (row === null) return reject('A2', `there is no syndicate ${req.syndicate}.`);
  try {
    book.admit(req.syndicate, req.who, req.tick);
  } catch (error: unknown) {
    return reject('A2', describeError(error));
  }
  return { ok: true, value: row };
}
