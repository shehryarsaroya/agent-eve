/**
 * `form`, as a function of its inputs rather than a method on the world.
 *
 * ── WHY THIS LIVES HERE AND NOT IN `sim/runtime.ts` ──────────────────────────
 *
 * D21's order, and this is the syndicate domain's turn. `src/syndicate/` already owned the book, the
 * charter parser and the published params; the four *handlers* were the only part of the domain still
 * living in `runtime.ts`, 11,000 lines from the rules they enforce. So this is **moving logic home**
 * rather than inventing a home — D21's own distinction — and the port shape is the one `works/refine.ts`
 * and `predation/demand.ts` already establish: a narrow port of exactly what the operation reads and
 * writes, the domain book passed alongside it, and the runtime method reduced to an adapter that parses
 * params and emits the row.
 *
 * The file it came out of is now over 16,000 lines, which is 6,300 more than when D21 was written and
 * measured the cost: three mechanical edits landed in the wrong place in it in one day and **all three
 * passed `tsc`**. Reading `vApply` to write this module found a fourth — the same
 * `isMember → contribute` block pasted twice, the second copy unreachable behind the first's `return`.
 * That is what a file nobody can hold in view costs, and it is why the gates below are worth having
 * somewhere a reviewer can see all of them at once.
 *
 * ── ONE THING THIS EXTRACTION DELIBERATELY DID NOT FIX ───────────────────────
 *
 * `api/observe.ts` keeps its **own copy** of both gates below — `syndicates.of(...).length < MAX` and
 * `free >= FOUNDING_COST_MINOR` — to decide whether to offer the `form` affordance. Two copies of one
 * rule is the drift that `demand.ts` fixed by having the affordance and the verb call one predicate,
 * and the same fix belongs here. It is not applied because `api/observe.ts` was owned by another writer
 * this round; {@link formRefusal} is exported and shaped for it, and its ONLY caller today is
 * {@link form} below. Wiring the affordance to it is the follow-up, and until then the drift is real
 * and named rather than silently tolerated.
 */

import type { EventId, PrincipalId } from '../core/types.js';
import type { Minor } from '../core/units.js';
import { reject, type Rejection, type WorldResult } from '../world/result.js';
import { describeError } from './describe.js';
import { CHARTER_STATEMENT, type Charter } from './charter.js';
import { FOUNDING_COST_MINOR, MAX_SYNDICATES_PER_PRINCIPAL } from './params.js';
import type { Book, SyndicateId, SyndicateRecord } from './book.js';

/**
 * The longest a syndicate name may be.
 *
 * Declared here rather than in `params.ts` only because that file was being edited by another writer
 * this round; it belongs there, and moving it costs one line whenever somebody is next in both.
 */
export const MAX_NAME_CHARS = 48;

/**
 * Everything `form` touches beyond its own book. Nothing else is reachable from here.
 *
 * Three members, all of them called by {@link form} — a port member nothing calls is this project's
 * signature defect, so the count is the operation's actual reach and not a convenience surface.
 */
export interface FormPort {
  /**
   * Unencumbered currency in the founder's STORES, or zero when it has no account yet.
   *
   * The zero-for-absent case is the port's job rather than the caller's: a founder that has never
   * held currency and a founder that spent it are the same answer to this question, and making the
   * function branch on account existence would put a ledger detail in a rule about affording things.
   */
  freeStoresOf(principal: PrincipalId): Minor;
  /**
   * Retire {@link FOUNDING_COST_MINOR} from the founder's stores to the UPKEEP sink. **Throws** if it
   * could not be paid.
   *
   * A port method rather than something the adapter does afterwards, so that this module owns the
   * ORDERING: pay, then write the row. Writing the syndicate first and paying after would leave a
   * founded house nobody paid for if the charge failed.
   */
  retireFoundingCost(args: { readonly eventId: EventId; readonly tick: number; readonly principal: PrincipalId }): void;
  /**
   * Open the pooled-stores account for a newly formed syndicate, if it does not exist.
   *
   * The pool is opened here and the syndicate is deliberately **not** registered as a principal: it
   * holds value and is spent through an office, but it never acts, so giving it a seat would put a
   * non-player in every population count in the game.
   */
  openPool(id: SyndicateId): void;
}

/** What the caller has to name. `name` is raw — trimming and length are rules, so they live below. */
export interface FormRequest {
  readonly founder: PrincipalId;
  readonly name: string;
  /**
   * The parsed charter, **or the parse fault**.
   *
   * The union rides in rather than being resolved by the adapter because *when* a malformed charter is
   * reported is observable: the membership cap is checked first, so a founder already in three
   * syndicates is told about the cap even if its charter is also junk. Resolving the fault earlier
   * would silently reorder two refusals an agent reads.
   */
  readonly charter: Charter | { readonly fault: string };
  readonly tick: number;
}

/**
 * **Every gate on `form`, in one place, in published order.** Returns the refusal, or `null` when the
 * act is legal right now.
 *
 * Split out from {@link form} so the affordance can share it — see this file's header for why that
 * second caller does not exist yet, and why that is stated rather than hidden.
 */
export function formRefusal(port: FormPort, book: Book, req: FormRequest): Rejection | null {
  if (req.name.length > MAX_NAME_CHARS) {
    return reject(
      'A2',
      `a syndicate name is at most ${String(MAX_NAME_CHARS)} characters; yours is ${String(req.name.length)}.`,
    );
  }
  const already = book.of(req.founder, req.tick).length;
  if (already >= MAX_SYNDICATES_PER_PRINCIPAL) {
    return reject(
      'A15',
      `you already sit in ${String(already)} syndicates, which is the cap of ` +
        `${String(MAX_SYNDICATES_PER_PRINCIPAL)}. Divided loyalty is interesting; unlimited is noise. ` +
        'Give notice on one first.',
    );
  }
  if ('fault' in req.charter) {
    // Refused rather than defaulted. Silently defaulting a constitutional clause would be the
    // worst failure available here: permanent, invisible, and not what was asked for.
    return reject('A2', `${req.charter.fault} ${CHARTER_STATEMENT}`);
  }
  const free = port.freeStoresOf(req.founder);
  if (free < FOUNDING_COST_MINOR) {
    return reject(
      'A15',
      `founding a syndicate costs ${String(FOUNDING_COST_MINOR)} and you have ${String(free)} free ` +
        '(locked stores do not count). The money is RETIRED, not paid to anybody, so your starter stake ' +
        'can cover it — this gate is priced in capital and never in identities.',
    );
  }
  return null;
}

/**
 * Found a SYNDICATE: a pooled treasury under a charter that can never be amended.
 *
 * §16.4's organisation, and the only way one comes into existence. The cost is **retired** rather than
 * paid to anybody, which is what makes the gate A15-clean: it is priced in capital a founder had to
 * hold, so it cannot be paid by acquiring another identity.
 *
 * Returns the row, for the adapter to announce. The charter is the most public thing about a syndicate
 * — a prospective member has to read the terms before handing over goods it cannot retrieve — but
 * publishing is the adapter's job, exactly as it is for `demand`.
 */
export function form(port: FormPort, book: Book, req: FormRequest): WorldResult<SyndicateRecord> {
  const refusal = formRefusal(port, book, req);
  if (refusal !== null) return refusal;
  // `formRefusal` already returned on the fault branch, so this is unreachable — but TypeScript cannot
  // narrow `req.charter` across a call, and the honest options are a re-check or a cast. The re-check,
  // because a future reorder that moved the charter gate out of `formRefusal` would then refuse here
  // rather than found an unchartered house off a lie the cast silenced.
  const charter = req.charter;
  if ('fault' in charter) return reject('A2', `${charter.fault} ${CHARTER_STATEMENT}`);

  // ── PAY FIRST, THEN WRITE ───────────────────────────────────────────────────
  //
  // `refine`'s destroy-then-source rule in the other direction: if the second half fails after the
  // first, pay-then-fail leaves the founder poorer — visible and recoverable — where write-then-fail
  // leaves a syndicate in the book that nobody paid to found.
  try {
    port.retireFoundingCost({
      eventId: `syndicate.form:${req.founder}:${String(req.tick)}` as EventId,
      tick: req.tick,
      principal: req.founder,
    });
  } catch (error: unknown) {
    return reject('INV-3', `the founding cost could not be paid (${describeError(error)}); nothing was founded.`);
  }

  let row: SyndicateRecord;
  try {
    row = book.form({
      founder: req.founder,
      name: req.name.trim(),
      charter,
      tick: req.tick,
    });
  } catch (error: unknown) {
    return reject('INV-26', describeError(error));
  }

  port.openPool(row.id);
  return { ok: true, value: row };
}

