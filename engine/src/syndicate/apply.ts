/**
 * `apply`, as a function of its inputs rather than a method on the world.
 *
 * ── WHY THIS LIVES HERE AND NOT IN `sim/runtime.ts` ──────────────────────────
 *
 * Third of D21's syndicate cluster. See `syndicate/form.ts`'s header for the general argument.
 *
 * This one carries the strongest local evidence for the whole exercise. Reading the handler in place, to
 * write this module, found the SAME eight-line block pasted twice — `if (row !== null && isMember(...))
 * return contributeToSyndicate(...)`, once at the top of the method and once again fourteen lines later,
 * each under its own near-identical five-line comment. The second copy is unreachable behind the first's
 * `return`. It compiled, it passed 3,692 tests, and it read as deliberate: the duplicated comment is the
 * kind of thing a reviewer skims as emphasis. That is D21's thesis restated — *a file that cannot be held
 * in view makes "verify by reading" impossible* — and it is the fourth mis-landed edit found in this file,
 * after the three D21 was written to explain. Removing it changes nothing, which is exactly why nothing
 * caught it.
 *
 * ── ONE VERB, TWO ACTS, AND WHY THAT IS NOT A HARD-RULE-4 VIOLATION ──────────
 *
 * `apply` to a syndicate you are not in asks to be admitted; `apply` to one you ARE in adds to its pool.
 * That looks like two concepts under one word until you read §16.4's membership: pooling **is** what
 * membership means, so applying puts you in and applying again deepens the same commitment. One concept
 * with a depth, which is why it rides here rather than spending one of §17's 40 verb slots — a budget
 * already at 40 of 40, so a second word was never available anyway.
 */

import type { IntRead } from '../core/params.js';
import type { EventId, PrincipalId } from '../core/types.js';
import { minor, type Minor } from '../core/units.js';
import { reject, type WorldResult } from '../world/result.js';
import { describeError } from './describe.js';
import type { Book, SyndicateId, SyndicateRecord } from './book.js';

/**
 * Everything `apply` touches beyond its own book. Three members, all called.
 *
 * `openPool` is the same operation `form` needs and is deliberately NOT shared between the two ports:
 * each port names its own operation's reach, and a shared "syndicate ledger port" would be a surface
 * whose members no single verb calls in full — the thing this project keeps finding at six depths.
 */
export interface ApplyPort {
  /**
   * **EARNINGS**, not free stores. The distinction is the whole gate — see {@link contribute}.
   */
  freeCashOf(principal: PrincipalId): Minor;
  /** Open the pooled-stores account, if absent. A contribution may be the first thing it ever holds. */
  openPool(id: SyndicateId): void;
  /**
   * Move `amount` from the member's stores into the pool. **Throws** if it could not move.
   *
   * A port method so this module owns the ordering: move the value, then announce it. Announcing first
   * would publish a treasury figure the ledger never held.
   */
  transferToPool(args: {
    readonly eventId: EventId;
    readonly tick: number;
    readonly syndicate: SyndicateId;
    readonly member: PrincipalId;
    readonly amount: Minor;
  }): void;
}

/** What the caller has to name. `stake` is only read on the contribution branch. */
export interface ApplyRequest {
  readonly applicant: PrincipalId;
  readonly syndicate: SyndicateId;
  /**
   * The contribution as it was read off the params — including **why** it is not a number, when it is
   * not one. Ignored entirely unless the applicant is already a member.
   *
   * An {@link IntRead} rather than `number | null` because `readInt`'s `null` answers two different
   * mistakes and this refusal used to give one sentence for both: an agent that sent `{"stake": "600"}`
   * was told to send `{"stake":N}`, did so again with the same JSON string, and was refused identically
   * forever. See `core/params.ts:readIntOrFault`.
   */
  readonly stake: IntRead;
  readonly tick: number;
}

/**
 * What `apply` did, so the adapter knows which row to write.
 *
 * A discriminated result rather than two functions, because the *choice* between them is a rule — it
 * depends on membership, which is book state — and a caller that had to decide which function to call
 * would be a second home for that rule.
 */
export type ApplyOutcome =
  | { readonly kind: 'JOINED'; readonly row: SyndicateRecord }
  | { readonly kind: 'POOLED'; readonly row: SyndicateRecord; readonly staked: number };

/**
 * Ask to be admitted to a syndicate — or, if already in, deepen the stake.
 *
 * The charter decides what asking means: under `OPEN` an application IS an admission, under `INVITE` it
 * is a request only a sitting member can answer, under `CLOSED` it is neither and never will be.
 *
 * ── WHY `INVITE` STORES NOTHING ──────────────────────────────────────────────
 *
 * The request is deliberately not queued. A pending-application queue is a buffer that grows with
 * enrolments — scar #3's shape — and it would need its own cap, its own place in `state_hash` and its
 * own expiry. The `message` channel already exists for asking: it costs no action, it is PARTIES-visible,
 * and it declassifies at settlement, so an approach and its answer end up where a viewer can read them.
 */
export function apply(port: ApplyPort, book: Book, req: ApplyRequest): WorldResult<ApplyOutcome> {
  const row = book.at(req.syndicate);
  // ── AN ALREADY-MEMBER APPLYING AGAIN IS CONTRIBUTING ────────────────────────
  //
  // Checked BEFORE the not-a-syndicate refusal below, guarded on `row !== null`, exactly as it stood in
  // the runtime. This is the block that was present twice there; once is enough.
  if (row !== null && book.isMember(req.syndicate, req.applicant, req.tick)) {
    return contribute(port, row, req);
  }
  if (row === null) {
    return reject(
      'A2',
      `there is no syndicate ${req.syndicate}. Syndicates and their charters are PUBLIC — read them off the ` +
        'feed before you ask to join one, because the terms cannot change after you are inside.',
    );
  }
  // `admissionFault` is the book's own predicate, shared with the affordance. It carries CLOSED, the
  // member cap and the per-principal cap, so `apply` needs no copy of any of them.
  const fault = book.admissionFault(req.syndicate, req.applicant, req.tick);
  if (fault !== null) return reject('A2', fault);

  if (row.charter.admission === 'INVITE') {
    return reject(
      'A2',
      `${req.syndicate}'s charter is INVITE: a sitting member has to bring you in, and there is no ` +
        'application queue for me to put you in. Its members are ' +
        `${book.sittingMembers(req.syndicate, req.tick).join(' · ')} — \`message\` one of them, which ` +
        'costs no action, and it will admit you by naming you itself. What you say there becomes ' +
        'public at settlement, so it is also how you build the case.',
    );
  }

  try {
    book.admit(req.syndicate, req.applicant, req.tick);
  } catch (error: unknown) {
    return reject('A2', describeError(error));
  }
  return { ok: true, value: { kind: 'JOINED', row } };
}

/**
 * Put earnings into a syndicate's pool.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **EARNINGS ONLY, BECAUSE THIS IS THE TRANSFER VERB THE GAME DELIBERATELY LACKED.**
 * D7's note is explicit that before the market existed the endowment hole was hard to exploit because
 * *"there is no principal-to-principal transfer verb, and that absence was quietly doing the work"*. A
 * contribution is exactly such a transfer, and the pool can be spent by an office-holder — so without
 * this gate an operator founds a syndicate, takes the office, and has every puppet contribute its
 * starter stake to a treasury it controls. That is D7 reopened for the third time and by the largest
 * door yet, and it is priced in identities, which A15 forbids outright.
 *
 * So a contribution spends **earnings only**. A puppet can pool nothing, and a real agent's pooled
 * capital is capital it produced.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Exported for the tests, which pin this gate directly rather than through `apply`'s membership branch.
 */
export function contribute(
  port: ApplyPort,
  row: SyndicateRecord,
  req: ApplyRequest,
): WorldResult<ApplyOutcome> {
  // ── ABSENT, MALFORMED AND NON-POSITIVE ARE THREE DIFFERENT MISTAKES ─────────
  //
  // They used to be one sentence. The pooling terms are repeated in all three because they are what
  // makes the refusal actionable — the clause that decides whether the pool can ever be spent is
  // PERMANENT, so an agent must read it before pooling regardless of which mistake it made.
  const POOL_TERMS =
    'It leaves your stores and becomes the syndicate\'s, and ' +
    'whether anyone can ever spend it is fixed by the charter clause `treasury_offices`, which ' +
    'cannot change. Read it before you pool anything.';
  if (req.stake.kind === 'MALFORMED') {
    return reject(
      'A2',
      `you are already a member of ${row.id}, and \`${req.stake.key}\` has to be a JSON number — you sent ` +
        `${req.stake.saw}. Send {"syndicate":"${row.id}","stake":N} with N a positive integer, unquoted ` +
        `and whole. ${POOL_TERMS}`,
    );
  }
  if (req.stake.kind === 'ABSENT') {
    return reject(
      'A2',
      `you are already a member of ${row.id}. To add to its pool send {"syndicate":"${row.id}","stake":N} — ` +
        `a positive integer of currency. ${POOL_TERMS}`,
    );
  }
  const amount = req.stake.value;
  if (amount <= 0) {
    return reject(
      'A2',
      `you are already a member of ${row.id} and asked to pool ${String(amount)}. A contribution has to be ` +
        `a POSITIVE integer — pooling nothing would publish a payment you did not make. ${POOL_TERMS}`,
    );
  }
  const spendable = port.freeCashOf(req.applicant);
  if (spendable < amount) {
    return reject(
      'A15',
      `you can pool ${String(spendable)} and asked to pool ${String(amount)}. That figure is your ` +
        'EARNINGS: locked stores do not count, and neither does the starter stake — a pooled treasury ' +
        'can be spent by an office-holder, so letting the grant reach it would make free enrolment into ' +
        'somebody else\'s capital (D7/A15). Earn it by hauling, trading or completing ventures.',
    );
  }
  port.openPool(row.id);
  try {
    port.transferToPool({
      eventId: `syndicate.pool:${row.id}:${req.applicant}:${String(req.tick)}` as EventId,
      tick: req.tick,
      syndicate: row.id,
      member: req.applicant,
      // `minor()` and not `as Minor`: it runs `checkInt`, which is a real guard that throws loudly on a
      // non-safe-integer. `readInt` upstream already promises one, so this never fires — but a cast here
      // would silently delete the second lock on a value entering the ledger.
      amount: minor(amount),
    });
  } catch (error: unknown) {
    return reject('INV-3', `the stake could not be pooled (${describeError(error)}); nothing moved.`);
  }
  return { ok: true, value: { kind: 'POOLED', row, staked: amount } };
}
