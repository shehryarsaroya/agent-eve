/**
 * INV-20 and INV-21, asserted in the `ASSERT` phase of every tick — in
 * production, forever (TESTING.md §3).
 *
 * - **INV-20** — every seal has exactly one verdict, scoped to its own
 *   `reckoning_id`, evaluated once. *(Scar #7: a promise made once must not be
 *   re-judged at every subsequent Reckoning.)*
 * - **INV-21** — standing changed only via an elective-honoured settlement, a
 *   default, a contradicted seal, or scheduled decay — never as a side effect of
 *   anything else. Lives in {@link ./standing.ts} with the cause table.
 *
 * These return violations rather than throwing, for the reason
 * `src/world/invariants.ts` gives: the tick loop owns the halt, because halting is
 * a world-level decision with defined semantics (`PAUSED`, the last good snapshot,
 * queued submissions), and a module that throws from inside a phase bypasses all
 * of it. {@link assertSealInvariants} is the throwing wrapper for callers that are
 * the batch itself.
 *
 * ## Why the evaluation count is stored rather than reasoned about
 *
 * "Evaluated once" is a claim about history, and a snapshot cannot show history —
 * so every record counts its own evaluations and this file checks the count. The
 * alternative is inspecting the control flow of `SealBook.resolve` and concluding
 * it can only run once per Reckoning, which is precisely the reasoning that held
 * for High Water's `lastSay` right up until it did not.
 */

import type { InvariantViolation } from '../core/types.js';
import { reckoningIndex } from '../core/time.js';
import type { SealBook } from './book.js';
import { SealHalt, sealViolation } from './verdict.js';

/**
 * INV-20 — one verdict per seal, in its own Reckoning, evaluated exactly once.
 *
 * Four separate claims, all needed:
 *
 * ## How "exactly one verdict" is read against a DEFERRED seal
 *
 * A seal that closed `DEFERRED` was judged once and carries **no** verdict, so the
 * literal reading of INV-20 would fire on it. That reading cannot be the right one:
 * it forces the engine to publish a mark it has just established it cannot justify,
 * which is the A5′ failure §15.4 names as worse than a crash. So the clause is read
 * as **exactly one evaluation, and never a second** — `evaluations === 1` is asserted
 * for every resolved seal without exception, and the verdict clause exempts the one
 * disposition that records *why* there is no mark.
 *
 * The exemption is deliberately narrow: it requires `disposition === 'UNMARKED'`
 * positively, so a seal that is verdict-less for any other reason — including a
 * record with no disposition at all, which is what a mis-migrated row looks like —
 * still fires. `test/seal/book.test.ts`'s mutation suite holds that line.
 *
 * A healthy Reckoning defers **nothing**: `SealResolution.deferred` is the operator's
 * alarm that the resolver is being called without its witnesses.
 *
 * 1. a seal in a **resolved** Reckoning has a verdict — or a recorded deferral — and
 *    `evaluations === 1`;
 * 2. a seal in an **unresolved** Reckoning has no verdict and `evaluations === 0`
 *    — this is the clause that catches a seal being judged early, or twice with
 *    the book's bookkeeping bypassed;
 * 3. its `reckoningIndex` is the one its own sealing tick implies (the scope is
 *    derived, and this is the independent check on that derivation);
 * 4. a verdict was stamped at its own Reckoning's settlement, never a later one —
 *    scar #7 stated as an arithmetic fact about two ticks.
 */
export function checkInv20(book: SealBook, tick: number): InvariantViolation[] {
  const out: InvariantViolation[] = [];

  for (const rec of book.auditRecords()) {
    const resolved = book.isResolved(rec.reckoningIndex);

    if (reckoningIndex(rec.sealedAtTick) !== rec.reckoningIndex) {
      out.push(
        sealViolation(
          'INV-20',
          tick,
          `seal ${rec.id} was sealed at tick ${rec.sealedAtTick} (Reckoning ` +
            `${reckoningIndex(rec.sealedAtTick)}) but is scoped to Reckoning ${rec.reckoningIndex}`,
        ),
      );
    }

    if (resolved) {
      // Positively `DEFERRED`, never merely "not something else": a record with no
      // disposition is what a mis-migrated row looks like, and it must still fire.
      if (rec.verdict === null && rec.disposition !== 'UNMARKED') {
        out.push(
          sealViolation(
            'INV-20',
            tick,
            `seal ${rec.id} is in resolved Reckoning ${rec.reckoningIndex} with no verdict`,
          ),
        );
      }
      if (rec.evaluations !== 1) {
        out.push(
          sealViolation(
            'INV-20',
            tick,
            `seal ${rec.id} was evaluated ${rec.evaluations} times; a promise made once is judged once`,
          ),
        );
      }
      if (rec.verdictAtTick !== null && reckoningIndex(rec.verdictAtTick) !== rec.reckoningIndex) {
        out.push(
          sealViolation(
            'INV-20',
            tick,
            `seal ${rec.id} (Reckoning ${rec.reckoningIndex}) was judged at tick ${rec.verdictAtTick},` +
              ` in Reckoning ${reckoningIndex(rec.verdictAtTick)}`,
          ),
        );
      }
    } else {
      if (rec.verdict !== null) {
        out.push(
          sealViolation(
            'INV-20',
            tick,
            `seal ${rec.id} carries a verdict but its Reckoning ${rec.reckoningIndex} has not resolved`,
          ),
        );
      }
      if (rec.evaluations !== 0) {
        out.push(
          sealViolation(
            'INV-20',
            tick,
            `seal ${rec.id} has been evaluated ${rec.evaluations} times before its Reckoning resolved`,
          ),
        );
      }
    }
  }

  return out;
}

/**
 * The throwing wrapper, for the Reckoning batch. Never publish a broken tick
 * (SPEC §15.2); the whole batch is one transaction that fails closed (DET-10).
 */
export function assertSealInvariants(book: SealBook, tick: number): void {
  const violations = checkInv20(book, tick);
  if (violations.length > 0) throw new SealHalt(violations);
}
