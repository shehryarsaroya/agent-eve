/**
 * INV-22, INV-23 — the authority group.
 *
 * A6 makes betrayal-via-legitimate-authority the core loop, which means the grant
 * table is the surface an attacker works against. Both invariants here exist
 * because the *legitimate* path must be airtight: if a delegate can exceed its
 * LIMITS, or route authority through a cycle back to itself, then the betrayal
 * stops being a story about trust and becomes a bug report.
 *
 * PROP-G1 is the attack INV-22 is scaled for: "a delegate sends your hands into a
 * raid where its own accomplice waits, every action technically within bounds, your
 * loss total." Every action within bounds is the *acceptable* version. The
 * unacceptable version is the same attack with the bounds not actually enforced,
 * and the only way to know which one happened is to recompute the spend from the
 * journal rather than trust the counter on the row.
 */

import { MAX_DELEGATION_DEPTH } from '../identity/vc.js';
import type { EventId, Grant, GrantId, InvariantViolation, PrincipalId } from '../core/types.js';
import { addMinor, minor, type Minor } from '../core/units.js';
import { halt } from './registry.js';

/**
 * One draw against a grant's LIMITS.
 *
 * `direct` bounds destruction, not just transfers (PROP-G1), so a spend row
 * carries both halves separately: a delegate can burn your cargo without moving a
 * single coin, and a journal that only recorded transfers would show a clean grant
 * over a total loss.
 */
export interface GrantSpend {
  readonly grant: GrantId;
  readonly delegate: PrincipalId;
  readonly tick: number;
  readonly eventId: EventId;
  readonly direct: Minor;
  readonly contingent: Minor;
  /**
   * ★ **Which verb drew.** LIMITS are three-dimensional now — money, verbs, sight — and this
   * is the second dimension arriving in the journal so the invariant can check it.
   *
   * Without it, the fence would be enforced only at the door. `Grant.verbs` is inside
   * `state_hash` and a door check is a line of code; the journal is the thing that survives a
   * restore, a replay and an operator reading it six months later, and INV-22's whole design
   * argument is that a per-row counter can be raced where a journal cannot. A fence checked
   * only at the door is a fence with INV-22's own reasoning applied to one of its three
   * dimensions and not the other two.
   */
  readonly verb: string;
}

/**
 * Why a draw was given back. Registered rather than free-form, for `DefaultCauseKind`'s reason:
 * *"the reason it released"* as prose is a permanent record nobody can verdict on, and a release is
 * headroom returned to a limit A7 promised was the whole of it.
 *
 * `ABANDONED` is the only member, and that is the finding rather than a budget: it covers both paths
 * that retire a venture without ever binding anybody — the creator's own `abandon`, and a formation
 * window that closed with a role still open. A SETTLED or DEFAULTED venture's elective half *was*
 * owed, so there is nothing there to give back.
 */
export type GrantReleaseCause = 'ABANDONED';

export const GRANT_RELEASE_CAUSES: readonly GrantReleaseCause[] = Object.freeze(['ABANDONED']);

/**
 * ★ One draw **given back** because the obligation it was drawn against can no longer be owed.
 *
 * Deliberately the same shape as {@link GrantSpend} plus a cause, and it **names the draw it
 * reverses** through `eventId`: `GrantBook.releaseSpend` refuses a release that cannot find its
 * spend, and refuses one larger than what is still outstanding on it. So the pair of journals is
 * self-checking — every release has a draw, and Σ releases per draw can never exceed it — which is
 * the property that lets INV-22 read a *net* without the net becoming a place to hide a spend.
 *
 * `delegate` is carried even though the engine, not the delegate, performs a release: it is the
 * delegate whose mandate is being un-charged, and a journal row that cannot say whose authority it
 * is about is a row an operator cannot read under pressure.
 */
export interface GrantRelease {
  readonly grant: GrantId;
  readonly delegate: PrincipalId;
  readonly tick: number;
  /** The `eventId` of the spend this returns. Must exist in the spend journal. */
  readonly eventId: EventId;
  readonly direct: Minor;
  readonly contingent: Minor;
  readonly verb: string;
  readonly cause: GrantReleaseCause;
}

/**
 * One dossier row, for INV-22's custody clause — the shape `grant/dossier.ts` writes,
 * narrowed to what the invariant reads.
 *
 * Declared here rather than imported so `invariants/` stays a leaf: an invariant that
 * imports the book it audits can be made to agree with it by editing one file.
 */
export interface CustodyRow {
  readonly id: string;
  readonly subject: PrincipalId;
  readonly compartment: string;
  readonly cutBy: PrincipalId;
  readonly grant: GrantId | null;
  readonly parent: string | null;
  readonly cutAtTick: number;
  readonly revealsAtTick: number;
  /** The lag the book applies. Passed in so the invariant checks the rule, not a copy of it. */
  readonly lagTicks: number;
}

/**
 * INV-22 — no delegate ever exceeds the scope its grantor signed: no grant's headroom is
 * negative, the sum of all spends against a grant never exceeds its LIMITS even with
 * concurrent delegates, **no draw is on a verb the grant does not carry, and no DOSSIER
 * was cut without the CLEARANCE to read it.**
 *
 * "Even with concurrent delegates" is the clause that forces the recomputation. A
 * per-row counter incremented by two writers is exactly the read-modify-write race
 * that produces a spend over the limit with a counter that looks fine, so the
 * journal is summed and the counter is treated as a cache to be checked — the same
 * shape as INV-5 for EXPOSURE.
 *
 * ── WHY THE TWO NEW CLAUSES ARE HERE AND NOT IN AN INV-27 ────────────────────
 *
 * LIMITS gained dimensions; they did not gain a second property. INV-22's subject has
 * always been *"a delegate never exceeds what its grantor signed"* — that is the sentence
 * the register carries — and until now a grant only had one axis to exceed. A grant now
 * bounds money (the two LIMITS), acts (`Grant.verbs`) and sight (`Grant.clearance`), so an
 * overrun on any axis is the same violation reported against the same guarantee. Splitting
 * the sight axis into its own id would mean an operator reading a halt has to know which of
 * two invariants owns "the delegate did more than it was allowed", which is exactly the kind
 * of two-homes-one-rule split scar #5 names.
 */
/**
 * The composite key a draw is indexed under: **one function, both sides.**
 *
 * The spend side and the release side of the clause below were written as two template literals
 * fifty lines apart, and they disagreed about the separator — so every release reported *"names no
 * draw in the spend journal"* and halted the world on a legitimate `abandon`. Caught by an existing
 * test that ran a delegated world to its window close, which is the only kind of test that could
 * have: both literals were individually correct.
 */
function drawKey(grant: GrantId, eventId: EventId): string {
  return `${grant}::${eventId}`;
}

export function checkInv22(
  grants: readonly Grant[],
  spends: readonly GrantSpend[],
  tick: number,
  custody: readonly CustodyRow[] = [],
  /**
   * ★ The release journal (`GrantRelease`). Defaulted to empty so every existing caller keeps
   * checking exactly what it checked before — a world that has released nothing sums the same
   * either way — and so the clause below is *additive* rather than a new reading of an old journal.
   */
  releases: readonly GrantRelease[] = [],
): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const summed = new Map<GrantId, { readonly direct: Minor; readonly contingent: Minor }>();
  const known = new Map<GrantId, Grant>();
  for (const g of grants) known.set(g.id, g);
  // Draws by (grant, eventId), so the release clause can check each give-back against the exact
  // draw it names rather than against the grant's total — a release that exceeded its own draw
  // while staying under the grant's total is headroom laundered out of an unrelated act.
  const drawnByEvent = new Map<string, { direct: number; contingent: number }>();
  for (const s of spends) {
    const key = drawKey(s.grant, s.eventId);
    const acc = drawnByEvent.get(key) ?? { direct: 0, contingent: 0 };
    acc.direct += s.direct;
    acc.contingent += s.contingent;
    drawnByEvent.set(key, acc);
  }

  for (const spend of [...spends].sort(
    (a, b) => cmp(a.grant, b.grant) || a.tick - b.tick || cmp(a.eventId, b.eventId),
  )) {
    if (spend.direct < 0 || spend.contingent < 0) {
      out.push(
        halt(
          'INV-22',
          tick,
          `spend ${spend.eventId} against grant ${spend.grant} is negative ` +
            `(direct ${spend.direct}, contingent ${spend.contingent}); a spend never returns headroom`,
        ),
      );
    }
    const grant = known.get(spend.grant);
    if (grant === undefined) {
      out.push(
        halt(
          'INV-22',
          tick,
          `spend ${spend.eventId} draws on grant ${spend.grant}, which is not in the grant table`,
        ),
      );
      continue;
    }
    if (spend.delegate !== grant.delegate) {
      out.push(
        halt(
          'INV-22',
          tick,
          `spend ${spend.eventId} on grant ${spend.grant} was made by ${spend.delegate}, but the grant ` +
            `names ${grant.delegate}`,
        ),
      );
    }
    if (spend.tick > grant.expiresTick) {
      out.push(
        halt(
          'INV-22',
          tick,
          `spend ${spend.eventId} on grant ${spend.grant} is at tick ${spend.tick}, after it expired at ` +
            `${grant.expiresTick}`,
        ),
      );
    }
    if (grant.revokedAtTick !== null && spend.tick > grant.revokedAtTick) {
      out.push(
        halt(
          'INV-22',
          tick,
          `spend ${spend.eventId} on grant ${spend.grant} is at tick ${spend.tick}, after it was revoked at ` +
            `${grant.revokedAtTick}`,
        ),
      );
    }
    // ── ★ THE FENCE (SPEC §8: a grant specifies VERBS × … × limits) ───────────
    //
    // A draw on a verb the grant does not carry is a delegate acting outside the scope its
    // grantor signed, and it is the same class of failure as an overrun limit: the worst case
    // shown before signing was not the worst case enforced. Checked here as well as at the
    // door because a fence enforced only at the door survives neither a restore nor a replay,
    // and because a wrong row in this journal is a permanent public accusation (A5′).
    if (!grant.verbs.includes(spend.verb)) {
      out.push(
        halt(
          'INV-22',
          tick,
          `spend ${spend.eventId} on grant ${spend.grant} drew on verb "${spend.verb}", which the grant does ` +
            `not carry (it carries ${grant.verbs.length === 0 ? 'nothing' : grant.verbs.join(', ')}). The ` +
            'grantor delegated a scope, not a budget',
        ),
      );
    }
    // `addMinor`, not `+=`. A bare accumulator that crosses 2^53 rounds SILENTLY and
    // the wrong total is itself a safe integer, so the journal-vs-cache comparison
    // below would compare two different wrong numbers and could agree. The checked
    // helper throws instead — and an invariant whose own arithmetic can drift is a
    // guard that reads exactly like a clean bill of health (the same reasoning that
    // put `sumMinor` in `core/units.ts`).
    const acc = summed.get(spend.grant) ?? { direct: minor(0), contingent: minor(0) };
    summed.set(spend.grant, {
      direct: addMinor(acc.direct, spend.direct),
      contingent: addMinor(acc.contingent, spend.contingent),
    });
  }

  // ── ★ THE RELEASE CLAUSE ─────────────────────────────────────────────────────
  //
  // A release returns headroom to a limit A7 promised was the whole of it, so it is audited at
  // exactly the strength a spend is: every give-back must name a draw that exists, must not exceed
  // what is still outstanding on that draw, and must be attributed to the grant's own delegate. An
  // unaudited release is a way to spend a mandate twice while both the counter and the spend journal
  // look clean — which is the read-modify-write race this invariant was written for, wearing a
  // refund.
  const returnedByEvent = new Map<string, { direct: number; contingent: number }>();
  for (const release of [...releases].sort(
    (a, b) => cmp(a.grant, b.grant) || a.tick - b.tick || cmp(a.eventId, b.eventId),
  )) {
    if (release.direct < 0 || release.contingent < 0) {
      out.push(
        halt(
          'INV-22',
          tick,
          `release ${release.eventId} against grant ${release.grant} is negative (direct ${release.direct}, ` +
            `contingent ${release.contingent}); a release never charges a limit`,
        ),
      );
    }
    const grant = known.get(release.grant);
    if (grant === undefined) {
      out.push(
        halt(
          'INV-22',
          tick,
          `release ${release.eventId} returns headroom to grant ${release.grant}, which is not in the ` +
            'grant table',
        ),
      );
      continue;
    }
    if (release.delegate !== grant.delegate) {
      out.push(
        halt(
          'INV-22',
          tick,
          `release ${release.eventId} on grant ${release.grant} is attributed to ${release.delegate}, but ` +
            `the grant names ${grant.delegate}`,
        ),
      );
    }
    if (!GRANT_RELEASE_CAUSES.includes(release.cause)) {
      out.push(
        halt(
          'INV-22',
          tick,
          `release ${release.eventId} on grant ${release.grant} cites cause "${String(release.cause)}", ` +
            `which is not one of ${GRANT_RELEASE_CAUSES.join(', ')}`,
        ),
      );
    }
    const key = drawKey(release.grant, release.eventId);
    const drawn = drawnByEvent.get(key);
    if (drawn === undefined) {
      out.push(
        halt(
          'INV-22',
          tick,
          `release ${release.eventId} on grant ${release.grant} names no draw in the spend journal; ` +
            'headroom can only be returned to a limit it was charged to',
        ),
      );
      continue;
    }
    const back = returnedByEvent.get(key) ?? { direct: 0, contingent: 0 };
    back.direct += release.direct;
    back.contingent += release.contingent;
    returnedByEvent.set(key, back);
    if (back.direct > drawn.direct || back.contingent > drawn.contingent) {
      out.push(
        halt(
          'INV-22',
          tick,
          `grant ${release.grant} draw ${release.eventId} was charged ${drawn.direct}/${drawn.contingent} ` +
            `(direct/contingent) and has had ${back.direct}/${back.contingent} returned; a release can never ` +
            'exceed the draw it names',
        ),
      );
    }
    const acc = summed.get(release.grant) ?? { direct: minor(0), contingent: minor(0) };
    summed.set(release.grant, {
      direct: minor(acc.direct - release.direct),
      contingent: minor(acc.contingent - release.contingent),
    });
  }

  for (const grant of [...known.values()].sort((a, b) => cmp(a.id, b.id))) {
    if (grant.maxDirectLoss < 0 || grant.maxContingentLiability < 0) {
      out.push(
        halt(
          'INV-22',
          tick,
          `grant ${grant.id} has negative LIMITS (direct ${grant.maxDirectLoss}, contingent ` +
            `${grant.maxContingentLiability})`,
        ),
      );
    }
    if (grant.spentDirect < 0 || grant.spentContingent < 0) {
      out.push(
        halt(
          'INV-22',
          tick,
          `grant ${grant.id} has negative spend (direct ${grant.spentDirect}, contingent ` +
            `${grant.spentContingent})`,
        ),
      );
    }
    if (grant.spentDirect > grant.maxDirectLoss) {
      out.push(
        halt(
          'INV-22',
          tick,
          `grant ${grant.id} headroom is negative: spent ${grant.spentDirect} of a max_direct_loss of ` +
            `${grant.maxDirectLoss}. The grantor was shown that number before it signed (A7)`,
        ),
      );
    }
    if (grant.spentContingent > grant.maxContingentLiability) {
      out.push(
        halt(
          'INV-22',
          tick,
          `grant ${grant.id} headroom is negative: contingent ${grant.spentContingent} of a max of ` +
            `${grant.maxContingentLiability}`,
        ),
      );
    }
    const acc = summed.get(grant.id) ?? { direct: minor(0), contingent: minor(0) };
    if (acc.direct !== grant.spentDirect) {
      out.push(
        halt(
          'INV-22',
          tick,
          `grant ${grant.id}: the spend journal nets to ${acc.direct} direct, the row caches ` +
            `${grant.spentDirect}. Concurrent delegates race a counter; they cannot race a journal`,
        ),
      );
    }
    if (acc.contingent !== grant.spentContingent) {
      out.push(
        halt(
          'INV-22',
          tick,
          `grant ${grant.id}: the spend journal nets to ${acc.contingent} contingent, the row caches ` +
            `${grant.spentContingent}`,
        ),
      );
    }
  }

  out.push(...checkCustody(known, custody, tick));
  return out;
}

/**
 * ★ **The custody clause — the third dimension of LIMITS, audited.**
 *
 * A DOSSIER is private figures that travelled, and the record of who has whose secrets is
 * the one thing in this feature that a wrong row libels somebody over (A5′): "Vex handed
 * Halcyon's balance sheet to Corvid" is permanent and public. So every row must be
 * *provable*, and this is where that is asserted:
 *
 *   1. **Provenance is exclusive.** Exactly one of `grant` (a first cut) or `parent` (a
 *      re-hand of something already held) — never both, never neither. A row with neither is
 *      a leak the engine cannot attribute and must not publish.
 *   2. **A first cut had the clearance.** The named grant must exist, must have named the
 *      compartment in its CLEARANCE, must have named the cutter as its delegate, and must
 *      have been live at `cutAtTick`. **Revocation after the cut is not a violation** — that
 *      is §16.7 MUST-5's rule that revocation stops future reads and never erases what was
 *      already observed, and it is the reason `revoke` is not a cure.
 *   3. **The clock is the rule, not a per-row field.** `revealsAtTick` is exactly
 *      `cutAtTick + lagTicks`. A row with its own offset is a second copy of the delay,
 *      free to disagree with the number the affordance quoted the grantor.
 *   4. **A re-hand names a row that exists.** A dangling parent means a chain the replay
 *      cannot walk, which is an attribution we would be asserting rather than proving.
 *
 * Note what is deliberately **not** checked: whether the re-hander *should* have had the
 * dossier, and whether the recipient was a rival. The first is settled by rule 2 at the root
 * of the chain; the second is a judgement, and §16.7 MUST-9 forbids the engine making one.
 */
function checkCustody(
  known: ReadonlyMap<GrantId, Grant>,
  custody: readonly CustodyRow[],
  tick: number,
): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const ids = new Set(custody.map((d) => d.id));
  for (const row of [...custody].sort((a, b) => cmp(a.id, b.id))) {
    if ((row.grant === null) === (row.parent === null)) {
      out.push(
        halt(
          'INV-22',
          tick,
          `dossier ${row.id} names ${row.grant === null ? 'neither' : 'both'} a grant and a parent; a cut is ` +
            'authorised by a clearance or it is a copy of one that was, and never both or neither',
        ),
      );
    }
    if (row.revealsAtTick !== row.cutAtTick + row.lagTicks) {
      out.push(
        halt(
          'INV-22',
          tick,
          `dossier ${row.id} was cut at ${row.cutAtTick} and reveals at ${row.revealsAtTick}, but the audit ` +
            `lag is ${row.lagTicks} ticks. A per-row reveal time is a second copy of the delay the grantor ` +
            'was quoted',
        ),
      );
    }
    if (row.parent !== null && !ids.has(row.parent)) {
      out.push(
        halt(
          'INV-22',
          tick,
          `dossier ${row.id} is a re-hand of ${row.parent}, which is not in the dossier table; a chain the ` +
            'replay cannot walk is an attribution we assert rather than prove',
        ),
      );
    }
    if (row.grant === null) continue;
    const grant = known.get(row.grant);
    if (grant === undefined) {
      out.push(
        halt('INV-22', tick, `dossier ${row.id} was cut under grant ${row.grant}, which is not in the grant table`),
      );
      continue;
    }
    if (grant.delegate !== row.cutBy) {
      out.push(
        halt(
          'INV-22',
          tick,
          `dossier ${row.id} was cut by ${row.cutBy} under grant ${row.grant}, which names ${grant.delegate}`,
        ),
      );
    }
    if (grant.grantor !== row.subject) {
      out.push(
        halt(
          'INV-22',
          tick,
          `dossier ${row.id} is about ${row.subject} but grant ${row.grant} is over ${grant.grantor}'s ` +
            'compartments; a clearance opens its own grantor and nobody else',
        ),
      );
    }
    if (!grant.clearance.includes(row.compartment)) {
      out.push(
        halt(
          'INV-22',
          tick,
          `dossier ${row.id} reads ${row.subject}'s ${row.compartment} under grant ${row.grant}, whose ` +
            `CLEARANCE is ${grant.clearance.length === 0 ? 'empty' : grant.clearance.join(', ')}. The grantor ` +
            'gave authority to act, not to see',
        ),
      );
    }
    // Expiry is checked; revocation deliberately is not — see rule 2 in the header.
    if (row.cutAtTick > grant.expiresTick) {
      out.push(
        halt(
          'INV-22',
          tick,
          `dossier ${row.id} was cut at ${row.cutAtTick} under grant ${row.grant}, which expired at ` +
            `${grant.expiresTick}`,
        ),
      );
    }
  }
  return out;
}

/**
 * A countersigned deal, for INV-23's third clause.
 *
 * `signer` is the principal whose key signed; `onBehalfOf` is the principal whose
 * assets are bound. When both are set and the signer is also on the other side of
 * the table, the delegate is trading with itself using someone else's money — a
 * self-deal wearing a grant, and the one form of betrayal that must be *invalid*
 * rather than merely legible (E2E-11: betrayal is legitimate-authority abuse or it
 * is nothing).
 */
export interface SignedDeal {
  readonly eventId: EventId;
  readonly signer: PrincipalId;
  readonly onBehalfOf: PrincipalId | null;
  readonly grant: GrantId | null;
  readonly counterparties: readonly PrincipalId[];
}

/**
 * Whether a grant is a link in a real delegation chain rather than a root grant.
 *
 * A chain needs a parent: "B may act for A, and C may act for A **through B**". `Grant`
 * (`core/types.ts`) has no `parentGrantId`, so in this build the answer is always no — every grant
 * is a root over its own grantor's stores. Written as a predicate rather than as a deleted branch
 * so that the fact is stated in one place, testable, and impossible to forget when parentage lands.
 */
function hasDelegationParentage(grant: Grant): boolean {
  return Object.prototype.hasOwnProperty.call(grant, 'parentGrantId');
}

/**
 * INV-23 — no grant chain contains a cycle; no principal is transitively its own
 * delegate; no delegate is counterparty to a deal it signs on another's behalf.
 *
 * Cycles are checked over grants **live at `tick`**, because an expired grant is
 * not authority and a revoked one is not either — a cycle through a dead edge is a
 * historical curiosity, and halting the world over it would be a false halt.
 */
export function checkInv23(
  grants: readonly Grant[],
  deals: readonly SignedDeal[],
  tick: number,
): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const live = grants
    .filter((g) => g.expiresTick >= tick && (g.revokedAtTick === null || g.revokedAtTick >= tick))
    .sort((a, b) => cmp(a.id, b.id));

  const edges = new Map<PrincipalId, PrincipalId[]>();
  for (const g of live) {
    if (g.grantor === g.delegate) {
      out.push(
        halt(
          'INV-23',
          tick,
          `grant ${g.id} makes ${g.grantor} its own delegate; authority over yourself is not a grant`,
        ),
      );
      continue;
    }
    // ── THE EDGE THAT DOES NOT EXIST ────────────────────────────────────────
    //
    // This used to be unconditional, and it manufactured a permanent, agent-reachable HALT out of
    // entirely legal play. Measured: four grants — a→b, b→c, c→d, d→e — produce
    // `HALT INV-23: grant chain from p:a is 5 deep`. Nobody re-delegated anything. Each of those
    // five principals granted authority over ITS OWN stores to one other principal, which is the
    // single most ordinary thing a cast of neighbours does, and it is exactly what the `grant`
    // affordance now offers to every counterparty with a kept promise.
    //
    // The walk models a relationship this build cannot have. `vGrant` sets `grantor` to the actor
    // (or the syndicate it holds an office in) and the grant binds the GRANTOR'S OWN stores; `Grant`
    // has no `parentGrantId`, so holding a grant from A does not let you delegate A's authority
    // onward. Read as a graph of "who may spend whose money", the two shapes this walk halts on are:
    //
    //     a -> b -> a        two neighbours who each trust the other
    //     a -> b -> c -> d   four principals who each trust one other
    //
    // Both are legal, desirable, and the point of A6. "A chain nobody can audit is authority nobody
    // granted" is the right sentence about the wrong graph: nobody granted TRANSITIVE authority
    // here, because every grant is explicit, bounded, and shown to its grantor before signing.
    //
    // So no edge is added, and the walk below runs over an empty graph. It is kept rather than
    // deleted because it is correct code for the model that lands with `parentGrantId` — and
    // `test/invariants/authority-no-false-halt.test.ts` FAILS the moment that field appears, so the
    // walk cannot stay inert once there is a real chain to check. The self-grant refusal above is
    // untouched: authority over yourself is meaningless whatever the model.
    if (!hasDelegationParentage(g)) continue;
    const to = edges.get(g.grantor);
    if (to === undefined) edges.set(g.grantor, [g.delegate]);
    else to.push(g.delegate);
  }

  // Iterative DFS with an on-path set. Recursion would be fine at 300 principals,
  // but a cycle is exactly the input that makes a recursive walk blow the stack,
  // and this runs inside a tick (DET-9: bounded step count regardless of input).
  const colour = new Map<PrincipalId, 'GREY' | 'BLACK'>();
  for (const start of [...edges.keys()].sort(cmp)) {
    if (colour.get(start) === 'BLACK') continue;
    const stack: { readonly node: PrincipalId; index: number }[] = [{ node: start, index: 0 }];
    colour.set(start, 'GREY');
    let depth = 1;
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const children = edges.get(frame.node) ?? [];
      if (frame.index >= children.length) {
        colour.set(frame.node, 'BLACK');
        stack.pop();
        depth -= 1;
        continue;
      }
      const next = children[frame.index];
      frame.index += 1;
      if (next === undefined) continue;
      if (colour.get(next) === 'GREY') {
        const path = stack.map((f) => f.node);
        out.push(
          halt(
            'INV-23',
            tick,
            `grant chain cycle: ${path.join(' -> ')} -> ${next}; ${next} is transitively its own delegate`,
          ),
        );
        continue;
      }
      if (colour.get(next) === 'BLACK') continue;
      colour.set(next, 'GREY');
      stack.push({ node: next, index: 0 });
      depth += 1;
      if (depth > MAX_DELEGATION_DEPTH + 1) {
        out.push(
          halt(
            'INV-23',
            tick,
            `grant chain from ${start} is ${depth} deep, past the limit of ${MAX_DELEGATION_DEPTH}; ` +
              'a chain nobody can audit is authority nobody granted',
          ),
        );
        // Abandoning the walk must not leave GREY nodes behind. A later `start`
        // treats a GREY node as on its own path and reports a cycle — so a legal
        // linear chain p0->p1->…->p6 that merely exceeds the depth cap used to also
        // publish "p2 is transitively its own delegate" about three principals whose
        // grants form no cycle at all. A halt record is permanent and operator-facing;
        // inventing an accusation inside one is the A5' failure in miniature.
        for (const frame of stack) colour.set(frame.node, 'BLACK');
        break;
      }
    }
  }

  for (const deal of [...deals].sort((a, b) => cmp(a.eventId, b.eventId))) {
    if (deal.onBehalfOf === null) continue;
    if (deal.counterparties.includes(deal.signer)) {
      out.push(
        halt(
          'INV-23',
          tick,
          `deal ${deal.eventId} is signed by ${deal.signer} on behalf of ${deal.onBehalfOf} with ` +
            `${deal.signer} as counterparty; a delegate may not sit on both sides of the table`,
        ),
      );
    }
    if (deal.counterparties.includes(deal.onBehalfOf)) {
      out.push(
        halt(
          'INV-23',
          tick,
          `deal ${deal.eventId} names ${deal.onBehalfOf} as both the principal bound and a counterparty`,
        ),
      );
    }
  }

  return out;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
