/**
 * The `say` state table — the PARLEY book and the prose OFFER book, captured (`RULES_VERSION` 41).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **TWO BOOKS THE GATE READS ACROSS A RECKONING BOUNDARY, AND NEITHER WAS IN THE HASH.**
 *
 * `state_hash` hashes exactly the registered state tables and a checkpoint carries exactly those, so
 * a book outside them is *neither carried nor missed* — the shape this repo has found eight times
 * (`test/durability/books-in-the-hash.test.ts` names them). Both books here were rings beside `talk`,
 * which was safe while nothing read them past the current Reckoning: a booted world adopts the
 * settlement-tick checkpoint and replays the tail, and every row a per-Reckoning count could read was
 * in that tail.
 *
 * At 41 three readers reach back across the boundary — the rolling answer window
 * (`say/parley.ts` §4), the OFFER reach rung, and the directory's offer freshness
 * (`say/directory.ts`) — so an adopted world replaying an answer to a letter from before the
 * checkpoint would have refused it. **Measured, and worse than an outage**: the tail past the last
 * snapshot carries no tripwire, so the boot succeeds and serves a world that has silently forked from
 * the journal it was booted from — the answer the record holds never happened, and every later tick
 * hashes differently (`test/durability/a-letter-survives-adoption.spec.ts`, mutation proof). A5′. And
 * an aborted tick left its ring entries behind while its event rows were dropped, so a letter that
 * never reached the record could authorise an answer. Both are closed by being a table: carried by the
 * checkpoint, rolled back by the abort.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **Contents, not counts.** The event ledger captures counts because its rows are immutable and the
 * truncation is an exact inverse; these books are working sets whose membership is part of the state —
 * the parley book retires a letter once no window reads it (`say/parley.ts` §5) and the offer book is a
 * 256-row ring — so the rows themselves are the only faithful capture. `parleysDropped` counts the
 * letters that have left the book. The cost is bounded by the caps, and both are empty in a world where
 * nobody talks.
 *
 * Parsed strictly, with located errors, for `StandingBook.restore`'s reason: a restore that quietly
 * dropped a malformed letter would silently revoke an answer somebody was owed.
 */

import type { CanonicalValue } from '../core/canonical.js';
import type { PrincipalId } from '../core/types.js';
import { readArray, readBool, readInt, readObject, readString } from '../tick/snapshot.js';
import type { OfferEntry } from './offer.js';
import { isParleyAct, type ParleyEntry } from './parley.js';
import { REACH_RUNGS, type ReachWhy } from './reach.js';

/** The table's name, in one place: the runtime registers it and the manifest requires it. */
export const SAY_TABLE = 'say';

export class SayRestoreError extends Error {}

/** What the table holds once read back. */
export interface SayCaptured {
  readonly parleys: readonly ParleyEntry[];
  readonly parleysDropped: number;
  readonly offers: readonly OfferEntry[];
  readonly offersDropped: number;
}

/**
 * The capture. **Book order, never sorted**: the ring IS a sequence, the answer predicate reads its
 * insertion order (`owesAnswer`), and re-ordering it would change which letter is "the latest".
 */
export function sayCapture(state: SayCaptured): CanonicalValue {
  return {
    parleys: state.parleys.map((p) => ({
      from: p.from,
      to: p.to,
      act: p.act,
      text: p.text,
      tick: p.tick,
      revealsAtTick: p.revealsAtTick,
      why: p.why,
      about: p.about,
      answering: p.answering,
    })),
    parleysDropped: state.parleysDropped,
    offers: state.offers.map((o) => ({ by: o.by, text: o.text, tick: o.tick })),
    offersDropped: state.offersDropped,
  };
}

const RUNGS: ReadonlySet<string> = new Set<string>(REACH_RUNGS);

/** The inverse of {@link sayCapture}. Strict: a shape error is a bug and it throws, located. */
export function readSayCapture(captured: CanonicalValue): SayCaptured {
  const root = readObject(captured, SAY_TABLE);
  const parleys = readArray(root['parleys'] ?? [], `${SAY_TABLE}.parleys`).map((raw, i): ParleyEntry => {
    const where = `${SAY_TABLE}.parleys[${String(i)}]`;
    const o = readObject(raw, where);
    const act = readString(o, 'act', where);
    if (!isParleyAct(act)) throw new SayRestoreError(`${where}.act is "${act}", which is not one of the five acts`);
    const why = readString(o, 'why', where);
    if (!RUNGS.has(why)) throw new SayRestoreError(`${where}.why is "${why}", which is not a reach rung`);
    const tick = readInt(o, 'tick', where);
    const revealsAtTick = readInt(o, 'revealsAtTick', where);
    if (revealsAtTick < tick) {
      throw new SayRestoreError(`${where} reveals at ${String(revealsAtTick)}, before it was sent at ${String(tick)}`);
    }
    return {
      from: readString(o, 'from', where) as PrincipalId,
      to: readString(o, 'to', where) as PrincipalId,
      act,
      text: readString(o, 'text', where),
      tick,
      revealsAtTick,
      why: why as ReachWhy,
      about: readString(o, 'about', where),
      answering: readBool(o, 'answering', where),
    };
  });
  const offers = readArray(root['offers'] ?? [], `${SAY_TABLE}.offers`).map((raw, i): OfferEntry => {
    const where = `${SAY_TABLE}.offers[${String(i)}]`;
    const o = readObject(raw, where);
    return { by: readString(o, 'by', where) as PrincipalId, text: readString(o, 'text', where), tick: readInt(o, 'tick', where) };
  });
  return {
    parleys,
    parleysDropped: readInt(root, 'parleysDropped', SAY_TABLE),
    offers,
    offersDropped: readInt(root, 'offersDropped', SAY_TABLE),
  };
}
