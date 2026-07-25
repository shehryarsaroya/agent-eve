/**
 * The seal book — mandatory, free per role, scoped to one Reckoning, evaluated
 * exactly once (SPEC §11.1, INV-20, PROP-D4).
 *
 * ## Scar #7 is closed by construction, not by care
 *
 * High Water's "hollow vow" detector compared an agent's last public statement
 * against its vote, and `lastSay` **persisted across tides** — so one promise was
 * re-judged at every subsequent court, grinding an honest agent's reputation down
 * for a single utterance. Three separate things here make that unreachable:
 *
 * 1. `reckoningIndex` is **derived from the sealing tick**, never accepted from a
 *    caller. There is no argument by which a seal can be aimed at another window.
 * 2. {@link SealBook.resolve} refuses to run unless it is the settlement tick *of
 *    the Reckoning it names*. Reckoning 4's seals cannot be resolved during
 *    Reckoning 5 because the call itself halts.
 * 3. Every record counts its own evaluations, and {@link ./invariants.ts} asserts
 *    the count is exactly 1 for a resolved Reckoning and 0 for an unresolved one.
 *    "Evaluated once" is therefore a witnessed fact rather than a property of the
 *    control flow.
 * 4. A seal may not be **backdated**: `commit` refuses a tick behind the book's
 *    watermark, the same rule and the same reason the event ledger has one.
 *
 * One door is left open on purpose, and it is documented at the line that would
 * otherwise close it: a seal whose Reckoning has *already* resolved is accepted, so
 * that INV-20's "resolved Reckoning with a verdict-less seal" clause stays
 * constructible. That state is unreachable under a monotonic tick loop and reachable
 * from a restored snapshot, which is the case the invariant is actually for.
 *
 * ## What comes back out of `commit`
 *
 * A receipt: the seal's id, its Reckoning, and what it cost. **Not the record.**
 * The record carries the intent and the prose, and an HTTP layer that serialises
 * whatever the engine handed it is exactly how PROP-D2 escapes — wave 1's events
 * verifier found this same prohibition leaking through a caller-supplied
 * allow-list. The agent already knows what it sealed; echoing it back buys nothing
 * and risks the one rule with no exceptions. Content is reachable only through
 * {@link SealBook.auditRecord}, whose name is the warning.
 *
 * ## Why hedged seals need no rule
 *
 * An agent could file two seals with adjacent bands so one is guaranteed
 * HONOURED. It gains nothing: honouring a seal earns **zero** standing (§6.4 —
 * standing accrues only to the elective part honoured), while the contradicted
 * one costs a step. Hedging is strictly dominated, so there is no duplicate-seal
 * rule to be gamed, only the INV-26 cap.
 */

import type {
  EventId,
  InvariantViolation,
  PrincipalId,
  Seal,
  SealId,
  SealVerdict,
  VentureId,
} from '../core/types.js';
import { inFreeze, isSettlementTick, reckoningIndex } from '../core/time.js';
import { compareIds } from '../ledger/order.js';
import { accept, reject, type Rejection, type WorldResult } from '../world/result.js';
import type { Deed } from './deed.js';
import {
  MAX_PROSE_LENGTH,
  intentFaults,
  intentToCanonical,
  intentWorldFaults,
  type SealIntent,
  type SealWorldIndex,
} from './intent.js';
import { chargeForContradiction, type SealStandingCharge } from './standing.js';
import {
  SealHalt,
  judge,
  sealViolation,
  type SealDisposition,
  type VerdictBasis,
} from './verdict.js';

/**
 * INV-26 — bound every array. 64 seals per principal per Reckoning is far above
 * any legitimate use (one per role held is free, everything beyond costs a
 * material action out of `ACTIONS_PER_TICK`), and it stops a free-ish verb from
 * becoming the unbounded-growth DoS of scar #3.
 */
export const MAX_SEALS_PER_PRINCIPAL_PER_RECKONING = 64;

/** A role, by the only address a role has: its venture and its index (§7). */
export interface SealRoleRef {
  readonly venture: VentureId;
  readonly roleIndex: number;
}

/** Canonical key for a role. Used for set membership, never stored as truth. */
export function roleKey(ref: SealRoleRef): string {
  return `${ref.venture}#${String(ref.roleIndex)}`;
}

export interface SealCommit {
  readonly principal: PrincipalId;
  readonly tick: number;
  /** The state version the agent acted on. Pinned, and compared at settlement. */
  readonly actedOnStateVersion: number;
  /**
   * The world's **current** state version, from the caller.
   *
   * Supply it. `actedOnStateVersion` is an agent's claim about what it saw, and a
   * claim ahead of the world is a pin no deed can ever satisfy — which used to make
   * every deed "unjudgeable" and halt the settlement tick (AGT-X9's second route).
   * With this present the impossible pin is refused at the door instead, which is
   * INV-19's submit-time half.
   *
   * Optional only because the seal book cannot invent it and several fixtures have
   * no version to give. Where it is absent the resolver disregards an impossible pin
   * rather than trusting it, so the lever is closed either way — but the door is the
   * better place, because the agent gets a sentence it can act on.
   */
  readonly stateVersion?: number;
  readonly intent: SealIntent;
  /**
   * Prose for the broadcast. Stored, bounded, and **never** an input to the
   * verdict — {@link ./verdict.ts} does not take it as an argument (PROP-D1).
   */
  readonly prose: string;
  /** The role whose free slot this seal claims, or null to spend an action. */
  readonly role: SealRoleRef | null;
  /**
   * The roles this principal holds right now.
   *
   * Passed in, never stored: `venture_role.filled_by_hand_id` is the single home
   * of commitment (§6.2), and a second copy here would be scar #5 — one quantity,
   * two homes — on the field that decides what a seal costs.
   */
  readonly rolesHeld: readonly SealRoleRef[];
}

/** The receipt. Carries no content; see the module header. */
export interface SealAccepted {
  readonly sealId: SealId;
  readonly reckoningIndex: number;
  readonly sealedAtTick: number;
  /** True when this seal was beyond the free allowance and costs a material action. */
  readonly costsAction: boolean;
  readonly freeSlotsRemaining: number;
}

/**
 * The full record, content included.
 *
 * Named "audit" so that every call site that reads one is visibly asking for
 * something an agent may never see. The agent-facing and viewer-facing shape is
 * `SealDisclosure` in {@link ./disclosure.ts}.
 */
export interface SealAuditRecord {
  readonly id: SealId;
  readonly principal: PrincipalId;
  /** Derived from `sealedAtTick`. Never supplied by a caller (scar #7). */
  readonly reckoningIndex: number;
  readonly sealedAtTick: number;
  readonly actedOnStateVersion: number;
  readonly role: SealRoleRef | null;
  readonly intent: SealIntent;
  readonly prose: string;
  /**
   * Was this seal's `target` confirmed against the world at commit?
   *
   * `false` means the book had no {@link SealWorldIndex} attached, so it cannot tell
   * "the agent did not do it" from "the agent spelled the target a way no deed will
   * ever match". A verdict that rests on the *absence* of a deed is withheld in that
   * case — see {@link SealBook.resolve}.
   */
  readonly targetWitnessed: boolean;
  /**
   * How the seal closed: `null` until judged, then one of three. `DEFERRED` means
   * judged once and closed with **no mark** — see {@link ./verdict.ts}'s header.
   *
   * `verdict` below is the published half of the same fact and is `null` exactly
   * when this is `DEFERRED`. Both are written in one place, from one judgement, so
   * there is no second home to drift (scar #5); `verdict` exists separately because
   * `core/types.ts`'s `Seal.verdict` is the contract shape and is two-valued.
   */
  readonly disposition: SealDisposition | null;
  readonly verdict: SealVerdict | null;
  readonly verdictAtTick: number | null;
  /** Audit-side only. Never disclosed: it is a second fact about the intention. */
  readonly basis: VerdictBasis | null;
  /** The attributable cause of a permanent public mark. Audit-side only. */
  readonly citedDeedEventId: EventId | null;
  /** INV-20's witness. Exactly 1 once its Reckoning has resolved, never 2. */
  readonly evaluations: number;
}

/**
 * The exact sentence a completeness witness asserts. Spelled out so a caller
 * cannot supply the witness by accident, or by spreading an unrelated object.
 */
export const ALL_DEEDS_CLAIM = 'THESE_ARE_ALL_THIS_RECKONINGS_DEEDS';

/**
 * One principal's deed count for one Reckoning, **counted where the deeds were
 * written**.
 *
 * `deedCount` is the whole load-bearing field of the completeness witness, and its
 * only requirement is the one a type cannot express: *it must not be computed from
 * the deed array it is checked against.* The first version of this witness carried
 * a single total and shipped a helper that filled it in with `deeds.length` — so
 * `resolve`'s comparison was a tautology, and a query that dropped a row still
 * marked the principal it dropped, which is the §15.4 defect the witness exists to
 * stop. A count derived from the thing it is meant to witness is not a witness.
 *
 * So the count is **per principal** and it comes from the producer: whatever wrote
 * the deed rows for this Reckoning knows how many it wrote for each principal, and
 * that tally reaches {@link SealBook.resolve} by a different road than the rows do.
 * Two roads is the entire mechanism. See {@link allDeedsWitness}, which cannot see
 * the deeds at all.
 */
export interface DeedTally {
  readonly principal: PrincipalId;
  /**
   * How many deeds this principal recorded **in this Reckoning**, per the producer.
   *
   * The same population as {@link SealResolveInput.deeds} — *every* deed row, not
   * only the ones that happen to name a sealed verb, because the resolver counts
   * rows and cannot know which ones the producer thought were relevant. Deeds
   * outside the Reckoning are not counted on either side.
   *
   * Zero is a real and important answer: it is a witnessed abstention, and it is the
   * only thing that lets a seal be contradicted by an act that never happened.
   */
  readonly deedCount: number;
}

/**
 * **The completeness witness.** The caller's claim that `deeds` is every deed this
 * Reckoning recorded for the principals it tallies.
 *
 * Without it, "the agent abstained" and "the caller's query missed this principal"
 * are the same input to {@link SealBook.resolve}, and the second publishes a
 * permanent public `CONTRADICTED` plus a standing charge against an innocent agent
 * — with no invariant firing anywhere, because `checkInv20` sees a verdict and one
 * evaluation and `checkInv21` sees an authorised `CONTRADICTED_SEAL` cause. SPEC
 * §15.4 calls that shape the top engineering risk; this is it on the other permanent
 * mark the design can make.
 *
 * Three fields are **checked against settlement** and disagreeing on any of them is
 * a caller bug that halts: the Reckoning, the state version, and the claim itself.
 * The fourth — {@link DeedTally} — is checked against the deeds **per principal**,
 * and a principal whose tally does not reconcile is simply *not witnessed*: its
 * seals defer, with no mark and no charge. That asymmetry is deliberate. A
 * reconciliation failure is the one witness fault whose cause might be the tally
 * rather than the query, so the module cannot prove it is beyond agent influence,
 * and *a halt is for our bug, never for their input* (AGT-X9).
 *
 * `tallies` must include principals with **zero** deeds. That is the whole point: a
 * principal tallied at 0 with 0 deeds present is a witnessed abstention and is
 * marked; a principal absent from the tally is an unanswered question and defers.
 */
export interface DeedSetWitness {
  /** The Reckoning the set was gathered for. Must equal the one being resolved. */
  readonly reckoningIndex: number;
  /** The state version it was gathered at. Must equal settlement's own. */
  readonly stateVersion: number;
  /**
   * Per principal, how many deeds the producer recorded. Every principal this set
   * is complete for appears exactly once, including those with no deeds.
   */
  readonly tallies: readonly DeedTally[];
  /** Always {@link ALL_DEEDS_CLAIM}. */
  readonly claim: typeof ALL_DEEDS_CLAIM;
}

/**
 * Build a witness from the producer's own per-principal tally.
 *
 * **This function cannot see the deed array, and that is the fix.** Its predecessor
 * took `deeds` and filled in `deedCount: deeds.length`, which made the resolver's
 * comparison a tautology for every caller that used the documented helper — the
 * §15.4 false-mark route, reproduced verbatim under the fix's own instructions. A
 * helper with no access to the rows cannot derive the count from them, so the two
 * numbers `resolve` compares necessarily have two sources.
 *
 * `tally` is `(principal, count)` pairs from wherever the deeds were **written**:
 * the per-principal count the deed producer kept as it appended, or a count taken
 * from the venture/role records — never `deeds.filter(...).length` at the call site,
 * which reintroduces the tautology one layer up and is the one thing a caller must
 * not do.
 *
 * Duplicates are **preserved, not folded**. A caller that tallies one principal
 * twice with two different counts has a bug the resolver must be able to see; a
 * helper that quietly kept the first would hide it.
 */
export function allDeedsWitness(
  reckoningIndex: number,
  stateVersion: number,
  tally: Iterable<readonly [PrincipalId, number]>,
): DeedSetWitness {
  const tallies = [...tally]
    .map(([principal, deedCount]) => Object.freeze({ principal, deedCount }))
    .sort((a, b) => compareIds(a.principal, b.principal));
  return Object.freeze({
    reckoningIndex,
    stateVersion,
    tallies: Object.freeze(tallies),
    claim: ALL_DEEDS_CLAIM,
  });
}

export interface SealResolveInput {
  readonly reckoningIndex: number;
  /** Must be the settlement tick of `reckoningIndex`, or the call halts. */
  readonly atTick: number;
  /** The state version settlement is running against (INV-19). */
  readonly stateVersion: number;
  /** Ground truth. Deeds outside the Reckoning window are ignored, not an error. */
  readonly deeds: readonly Deed[];
  /**
   * The completeness witness. **Supply it**: without it no seal can be marked from
   * the absence of a deed, so a Reckoning resolved unwitnessed produces no reveals
   * at all. See {@link DeedSetWitness} for why it is not simply assumed, and
   * {@link DeedTally} for the one requirement a type cannot state — the counts must
   * come from wherever the deeds were *written*, not from `deeds` above.
   */
  readonly deedSet?: DeedSetWitness;
}

/** A seal judged once and closed with no mark. Audit-side; nothing publishes it. */
export interface SealDeferral {
  readonly sealId: SealId;
  readonly principal: PrincipalId;
  /** Which input could not be accounted for. Never disclosed (PROP-D2). */
  readonly basis: VerdictBasis;
}

export interface SealResolution {
  readonly reckoningIndex: number;
  readonly atTick: number;
  /** Ids in canonical order, with their verdicts. Content stays in the book. */
  readonly verdicts: readonly {
    readonly sealId: SealId;
    readonly principal: PrincipalId;
    readonly verdict: SealVerdict;
  }[];
  readonly charges: readonly SealStandingCharge[];
  /**
   * Seals that closed with no mark, and why.
   *
   * **Nothing publishes these.** A `SEAL_RESOLVED` event carries a flag, and "this
   * agent's seal could not be judged" is a second fact about a sealed intention,
   * which PROP-D2 does not permit — so a deferred seal looks, to every reader,
   * exactly like a seal whose Reckoning has not come. This list is for the batch: a
   * healthy Reckoning defers **nothing**, so anything here is an operator's alarm
   * that the resolver is being called without its witnesses.
   */
  readonly deferred: readonly SealDeferral[];
  /**
   * Every way the deed set and its own witness failed to reconcile, in canonical
   * principal order. **Operator-facing only**; nothing publishes it and no agent can
   * read it.
   *
   * These are the faults that used to be halts, and each one now costs exactly the
   * seals of the principal it names — those defer. A healthy Reckoning has **none**,
   * so a non-empty list means the deed query and the deed tally disagree, which is a
   * bug worth paging someone about *without* stopping the world for it (AGT-X9).
   */
  readonly deedSetFaults: readonly string[];
}

/** Zero-padded so ids sort in creation order under {@link compareIds}. */
function sealIdFor(principal: PrincipalId, reckoning: number, ordinal: number): SealId {
  return `seal:${principal}:${String(reckoning)}:${String(ordinal).padStart(4, '0')}` as SealId;
}

function scopeKey(principal: PrincipalId, reckoning: number): string {
  return `${principal}@${String(reckoning)}`;
}

export class SealBook {
  private readonly byId = new Map<SealId, SealAuditRecord>();
  /** Reckoning -> seal ids, in creation order. */
  private readonly byReckoning = new Map<number, SealId[]>();
  /** (principal, reckoning) -> seal ids. The allowance and compliance index. */
  private readonly byScope = new Map<string, SealId[]>();
  /** Reckonings already resolved. INV-20's exactly-once gate. */
  private readonly resolvedReckonings = new Set<number>();
  /**
   * Highest tick a seal has been committed at. Time only moves forward here for
   * the same reason it does in the event ledger: a seal backdated into a window
   * that has already been judged is a promise arriving at a closed court, which is
   * scar #7 approached from the other side.
   */
  private watermark = -1;

  /**
   * What the book asks the world before accepting a seal, or `null` when nothing was
   * attached.
   *
   * **Attach it in production.** With it, the two agent-supplied fields a verdict is
   * computed from — `target` and `measure` — are checked at the door, so a formatting
   * slip costs one action and a hint instead of a permanent public mark. Without it
   * the book runs in a degraded mode that refuses to mark any seal from the *absence*
   * of a deed, because it cannot tell a target that names nothing from an act the
   * agent chose not to perform.
   */
  constructor(private readonly world: SealWorldIndex | null = null) {}

  // ── Commit ─────────────────────────────────────────────────────────────────

  /**
   * The `seal` verb's engine path.
   *
   * Returns a {@link WorldResult}: an illegal seal comes back as
   * `{ok:false, invariant, hint}` with a fresh, actionable sentence, never as a
   * throw. High Water pattern 4 — an agent that gets a 400 wastes its turn and
   * loops; an agent that gets a hint corrects itself immediately.
   */
  commit(input: SealCommit): WorldResult<SealAccepted> {
    if (!Number.isSafeInteger(input.tick) || input.tick < 0) {
      return reject('INV-20', `a seal needs a non-negative integer tick, got ${String(input.tick)}`);
    }
    if (!Number.isSafeInteger(input.actedOnStateVersion) || input.actedOnStateVersion < 0) {
      return reject(
        'INV-19',
        'a seal pins the state version you acted on; supply a non-negative integer version so the' +
          ' verdict can be computed against the state you actually saw.',
      );
    }
    // INV-19's submit-time half. A pin ahead of the world names a state that never
    // existed, and every deed that could honour the seal would be "measured against
    // an older state" — which is AGT-X9's second route to stopping the settlement
    // tick. Refused here, where it costs one action and returns a sentence.
    if (input.stateVersion !== undefined && input.actedOnStateVersion > input.stateVersion) {
      return reject(
        'INV-19',
        `you pinned state version ${input.actedOnStateVersion}, which is ahead of this world's` +
          ` ${input.stateVersion}: nothing has happened at that version yet, so no deed of yours could` +
          ' ever be measured against it. Pin the version your last observation carried.',
      );
    }

    // §11.1: the seal is committed *before the freeze*. In the freeze nothing may
    // touch the settlement set (INV-18), and a seal joining the set inside it is
    // the scar #6 shape — the outcome resolved from a different state than the one
    // the reveal was computed from.
    //
    // THE SETTLEMENT TICK IS EXPLICITLY INCLUDED, and it is not redundant. While
    // core/time.ts wrongly had `inFreeze` true at the settlement phase, this door
    // caught both ticks by accident. Fixing that bug re-opened the settlement tick
    // here, and a verifier probed the consequence: commit at 285 ok, 286 refused,
    // **287 accepted**. Because VALIDATE+LOCK (phase 3) runs long before OBLIGE
    // (phase 10), such a seal lands in the very set the driver is about to judge,
    // with no deed able to follow it in the same tick. That is either a CONTRADICTED
    // mark against a promise that had zero ticks in which to be kept — A5′, a false
    // mark on an innocent agent — or an unjudged seal in a resolved Reckoning, which
    // checkInv20 reports as a HALT, i.e. an agent-reachable world stop (AGT-X9).
    // Both are reachable today: `seal` is gated off HTTP, but src/sim/runtime.ts
    // passes ctx.tick straight through, so the cast can do it.
    if (inFreeze(input.tick) || isSettlementTick(input.tick)) {
      return reject(
        'INV-18',
        'the freeze has begun: no seal may join this Reckoning now. Seal before the freeze tick;' +
          ' this seal would belong to a settlement set whose inputs are already hashed.',
      );
    }

    const faults = intentFaults(input.intent);
    if (faults.length > 0) {
      return reject(
        'PROP-D1',
        `a seal is typed fields, never prose: ${faults.join('; ')}. Supply verb, target, measure` +
          ' and an integer outcome band; put anything you want said out loud in `prose`.',
      );
    }
    // The A5′ door. Scar #8: when the penalty is permanent and public, prefer
    // precision over recall — so a target or a unit the world does not recognise is
    // refused *now*, in private, recoverably, rather than becoming a mark at the
    // Reckoning that the agent is never even told the reason for (PROP-D2).
    if (this.world !== null) {
      const worldFaults = intentWorldFaults(input.intent, this.world);
      if (worldFaults.length > 0) {
        return reject(
          'A5',
          `this seal could only ever be judged against you, so it is refused here instead:` +
            ` ${worldFaults.join('; ')}`,
        );
      }
    }
    if (input.prose.length > MAX_PROSE_LENGTH) {
      return reject(
        'INV-26',
        `prose is capped at ${MAX_PROSE_LENGTH} characters, got ${input.prose.length}.` +
          ' Prose is broadcast only and never affects your verdict, so shorten it freely.',
      );
    }

    if (input.tick < this.watermark) {
      return reject(
        'INV-20',
        `tick ${input.tick} is behind this book's watermark ${this.watermark}: a seal cannot be` +
          ' backdated into a window that has already been played.',
      );
    }

    // Deliberately **not** refused here: a seal whose Reckoning has already
    // resolved. Under a monotonic tick loop the state is unreachable anyway — a
    // seal's Reckoning is derived from its own tick, so it cannot arrive after that
    // Reckoning's settlement — and the case that *does* happen is a restored
    // snapshot or a mis-migrated row, which is what INV-20 exists to catch in
    // production. Closing the door here would leave that clause unconstructible in a
    // test, and a checker that cannot be shown to fire is indistinguishable from a
    // clean bill of health. `test/invariants/aggregate.test.ts` builds exactly that
    // mutant through this path.
    const reckoning = reckoningIndex(input.tick);
    const scope = scopeKey(input.principal, reckoning);
    const existing = this.byScope.get(scope) ?? [];
    if (existing.length >= MAX_SEALS_PER_PRINCIPAL_PER_RECKONING) {
      return reject(
        'INV-26',
        `you already hold ${existing.length} seals this Reckoning, which is the cap of` +
          ` ${MAX_SEALS_PER_PRINCIPAL_PER_RECKONING}. Seals resolve at the Reckoning; wait for it.`,
      );
    }

    const held = new Set(input.rolesHeld.map(roleKey));
    if (input.role !== null && !held.has(roleKey(input.role))) {
      // The free slot is priced in a role you actually hold. Left unchecked, the
      // allowance would be priced in nothing at all, which is A15's exact
      // prohibition read against a budget rather than an identity.
      return reject(
        'PROP-D4',
        `you do not hold role ${roleKey(input.role)}, so it grants you no free seal.` +
          ' Cite a role you hold, or seal without one and spend an action.',
      );
    }

    const usedFreeRoles = this.freeRolesUsed(scope);
    const claimsFreeSlot = input.role !== null && !usedFreeRoles.has(roleKey(input.role));

    const ordinal = existing.length;
    const id = sealIdFor(input.principal, reckoning, ordinal);
    const record: SealAuditRecord = Object.freeze({
      id,
      principal: input.principal,
      reckoningIndex: reckoning,
      sealedAtTick: input.tick,
      actedOnStateVersion: input.actedOnStateVersion,
      role: input.role === null ? null : Object.freeze({ ...input.role }),
      intent: Object.freeze({ ...input.intent }),
      prose: input.prose,
      // Recorded, not recomputed at settlement: whether the target was witnessed is a
      // fact about the moment the seal was accepted, and a book that gained a world
      // afterwards must not retroactively make an old seal markable.
      targetWitnessed: this.world !== null,
      disposition: null,
      verdict: null,
      verdictAtTick: null,
      basis: null,
      citedDeedEventId: null,
      evaluations: 0,
    });

    this.byId.set(id, record);
    push(this.byReckoning, reckoning, id);
    push(this.byScope, scope, id);
    this.watermark = input.tick;

    return accept({
      sealId: id,
      reckoningIndex: reckoning,
      sealedAtTick: input.tick,
      costsAction: !claimsFreeSlot,
      freeSlotsRemaining: this.freeSlotsRemaining(input.principal, reckoning, input.rolesHeld),
    });
  }

  /** Roles that have already spent their one free slot in this scope. */
  private freeRolesUsed(scope: string): Set<string> {
    const used = new Set<string>();
    for (const id of this.byScope.get(scope) ?? []) {
      const rec = this.byId.get(id);
      if (rec !== undefined && rec.role !== null) used.add(roleKey(rec.role));
    }
    return used;
  }

  /**
   * PROP-D4's free half: **one seal per role held is free**. Unheld roles grant
   * nothing, and a role's slot is spent once.
   */
  freeSlotsRemaining(
    principal: PrincipalId,
    reckoning: number,
    rolesHeld: readonly SealRoleRef[],
  ): number {
    const used = this.freeRolesUsed(scopeKey(principal, reckoning));
    let remaining = 0;
    const seen = new Set<string>();
    for (const ref of rolesHeld) {
      const key = roleKey(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!used.has(key)) remaining += 1;
    }
    return remaining;
  }

  // ── The mandatory half ─────────────────────────────────────────────────────

  /**
   * PROP-D4's mandatory half: roles this principal holds with no seal against
   * them this Reckoning.
   *
   * Optional seals mean a cast that never seals, which means no reveals, which
   * means the design's only guaranteed clip generator produces nothing — so this
   * is audited rather than hoped for. Sealing is free for exactly these roles, so
   * the requirement is always satisfiable.
   */
  unsealedRoles(
    principal: PrincipalId,
    reckoning: number,
    rolesHeld: readonly SealRoleRef[],
  ): SealRoleRef[] {
    const sealed = this.freeRolesUsed(scopeKey(principal, reckoning));
    const out: SealRoleRef[] = [];
    const seen = new Set<string>();
    for (const ref of rolesHeld) {
      const key = roleKey(ref);
      if (seen.has(key) || sealed.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
    return out.sort((a, b) => compareIds(roleKey(a), roleKey(b)));
  }

  /**
   * The predicate the venture module calls before a role is carried into the
   * freeze. A rejection, or null when every held role is sealed.
   *
   * It is a validator and not a penalty for the same reason the Commons floor is
   * (A8): the cure is free and immediate, so refusing the act is fair, while
   * charging standing for a missing seal would be a penalty for a rule the agent
   * could still satisfy.
   */
  sealComplianceRejection(
    principal: PrincipalId,
    tick: number,
    rolesHeld: readonly SealRoleRef[],
  ): Rejection | null {
    const missing = this.unsealedRoles(principal, reckoningIndex(tick), rolesHeld);
    if (missing.length === 0) return null;
    return reject(
      'PROP-D4',
      `seal your intention for ${missing.map(roleKey).join(', ')} before the freeze — one seal per` +
        ' role you hold is free and costs no action. A seal is typed fields: verb, target, measure' +
        ' and an outcome band.',
    );
  }

  // ── Resolve ────────────────────────────────────────────────────────────────

  /**
   * Resolve one Reckoning's seals. **Exactly once, and only its own** (INV-20).
   *
   * Halts rather than returning a rejection **for a caller bug**: the caller is the
   * Reckoning batch, not an agent, and there is no turn to save. SPEC §15.2 — abort
   * the tick and halt; never publish a broken tick.
   *
   * ## What halts, and what defers
   *
   * The line is the one AGT-X9 was found on the wrong side of: *a halt is for our
   * bug, never for their input.*
   *
   * **Halts** — the wrong Reckoning, the wrong tick, a second resolution, a deed
   * valued ahead of settlement, and a witness that disagrees with *settlement itself*
   * about the Reckoning, the state version, or its own claim. Every one is an
   * engine-side defect with no agent input anywhere near it, reproducible from
   * `(snapshot, action_log, seed)`, fixable, resumable.
   *
   * **Defers** — anything that rests on an agent-supplied field the engine cannot
   * account for. See {@link ./verdict.ts}'s four bases. A deferred seal is judged
   * once and closed with no mark; it is never re-judged, because re-judging a seal at
   * a later court is scar #7 itself.
   *
   * **Two things that look like halts and are not**, both narrowed here after a
   * re-verification found them re-opening AGT-X9 by a new road:
   *
   * - *A deed for a principal the witness does not tally.* A principal owes a seal
   *   only for the **roles it holds**, so an agent that hauls while holding no role
   *   produces a perfectly legitimate deed that no witness of the sealing principals
   *   covers. Halting on it would let any agent stop every Reckoning with one
   *   ordinary act. The deed is kept for attribution — it can only ever *honour* a
   *   seal — and the principal is simply not witnessed, so nothing may be marked
   *   against it from an absence.
   * - *A tally that does not reconcile with the deeds that arrived.* That is the
   *   query bug the witness exists to catch, and the answer A5′ permits is to make no
   *   mark: only that principal's seals defer, and the mismatch is reported in
   *   {@link SealResolution.deedSetFaults}.
   *
   * ## Two things the caller must supply, and what happens if it does not
   *
   * `input.deedSet` witnesses that the deeds are complete; a {@link SealWorldIndex}
   * on the constructor witnesses that targets name real entities. Absence-based marks
   * need both, because *without them "the agent abstained" and "our query missed it"
   * are the same input* (§15.4). A Reckoning resolved without them produces no
   * reveals at all — which is loud in `SealResolution.deferred` and silent nowhere.
   */
  resolve(input: SealResolveInput): SealResolution {
    const { reckoningIndex: r, atTick, stateVersion } = input;
    const violations: InvariantViolation[] = [];

    if (!Number.isSafeInteger(r) || r < 0) {
      violations.push(sealViolation('INV-20', atTick, `bad reckoning index ${String(r)}`));
    }
    // A seal belongs to one court. Resolving Reckoning 4's seals at any tick that
    // is not Reckoning 4's settlement is scar #7 with the window widened by a
    // caller instead of by a persistent field.
    if (reckoningIndex(atTick) !== r || !isSettlementTick(atTick)) {
      violations.push(
        sealViolation(
          'INV-20',
          atTick,
          `tick ${atTick} is not the settlement tick of Reckoning ${String(r)}` +
            ` (it is in Reckoning ${reckoningIndex(atTick)}); a seal is judged at its own Reckoning` +
            ' and never at a later one',
        ),
      );
    }
    if (this.resolvedReckonings.has(r)) {
      violations.push(
        sealViolation(
          'INV-20',
          atTick,
          `Reckoning ${String(r)} has already resolved its seals; every seal has exactly one verdict`,
        ),
      );
    }
    if (!Number.isSafeInteger(stateVersion) || stateVersion < 0) {
      violations.push(
        sealViolation('INV-19', atTick, `bad settlement state version ${String(stateVersion)}`),
      );
    }
    for (const deed of input.deeds) {
      if (deed.valuedAtStateVersion > stateVersion) {
        // A measurement from a state later than settlement's own is the
        // state-version race AGT-X5 hunts. It cannot produce a trustworthy
        // verdict, so it stops the tick.
        violations.push(
          sealViolation(
            'INV-19',
            atTick,
            `deed ${deed.eventId} was valued at state version ${deed.valuedAtStateVersion}, ahead of` +
              ` settlement's ${stateVersion}`,
          ),
        );
      }
    }

    // Three things the witness must agree with *settlement itself* about. None of the
    // three can be reached by anything an agent sends, so all three halt: a witness
    // gathered for another Reckoning, at another state version, or carrying no claim
    // at all, is the batch wiring its own inputs together wrongly.
    const witness = input.deedSet;
    if (witness !== undefined) {
      if (witness.claim !== ALL_DEEDS_CLAIM) {
        violations.push(
          sealViolation('INV-20', atTick, `deed-set witness carries no claim of completeness`),
        );
      }
      if (witness.reckoningIndex !== r) {
        violations.push(
          sealViolation(
            'INV-20',
            atTick,
            `deed-set witness was gathered for Reckoning ${witness.reckoningIndex}, not ${String(r)}`,
          ),
        );
      }
      if (witness.stateVersion !== stateVersion) {
        violations.push(
          sealViolation(
            'INV-19',
            atTick,
            `deed-set witness was gathered at state version ${witness.stateVersion}, not settlement's` +
              ` ${stateVersion}; a set gathered at another version is not this Reckoning's set`,
          ),
        );
      }
    }
    if (violations.length > 0) throw new SealHalt(violations);

    const deedsByPrincipal = new Map<PrincipalId, Deed[]>();
    for (const deed of input.deeds) {
      const list = deedsByPrincipal.get(deed.principal);
      if (list === undefined) deedsByPrincipal.set(deed.principal, [deed]);
      else list.push(deed);
    }

    const { witnessed, deedSetFaults } = reconcile(witness, input.deeds, r);

    const ids = [...(this.byReckoning.get(r) ?? [])].sort(compareIds);
    const verdicts: SealResolution['verdicts'][number][] = [];
    const charges: SealStandingCharge[] = [];
    const deferred: SealDeferral[] = [];

    for (const id of ids) {
      const rec = this.byId.get(id);
      if (rec === undefined) continue;
      if (rec.evaluations !== 0) {
        // Unreachable while `resolvedReckonings` is honoured, and asserted anyway:
        // the whole value of INV-20 is that it does not depend on control flow.
        throw new SealHalt([
          sealViolation(
            'INV-20',
            atTick,
            `seal ${id} has already been evaluated ${rec.evaluations} time(s)`,
          ),
        ]);
      }
      const judgement = judge(
        {
          principal: rec.principal,
          reckoningIndex: rec.reckoningIndex,
          sealedAtTick: rec.sealedAtTick,
          actedOnStateVersion: pinnedVersion(rec, stateVersion),
          intent: rec.intent,
          deedSetWitnessed: witnessed.has(rec.principal),
          targetWitnessed: rec.targetWitnessed,
        },
        deedsByPrincipal.get(rec.principal) ?? [],
        atTick,
      );

      this.byId.set(
        id,
        Object.freeze({
          ...rec,
          disposition: judgement.disposition,
          verdict: judgement.verdict,
          verdictAtTick: judgement.verdict === null ? null : atTick,
          basis: judgement.basis,
          citedDeedEventId: judgement.citedDeedEventId,
          evaluations: rec.evaluations + 1,
        }),
      );
      if (judgement.verdict === null) {
        deferred.push({ sealId: id, principal: rec.principal, basis: judgement.basis });
        continue;
      }
      verdicts.push({ sealId: id, principal: rec.principal, verdict: judgement.verdict });
      if (judgement.verdict === 'CONTRADICTED') {
        charges.push(chargeForContradiction(rec.principal, id, rec.reckoningIndex));
      }
    }

    this.resolvedReckonings.add(r);
    return Object.freeze({ reckoningIndex: r, atTick, verdicts, charges, deferred, deedSetFaults });
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  get size(): number {
    return this.byId.size;
  }

  isResolved(reckoning: number): boolean {
    return this.resolvedReckonings.has(reckoning);
  }

  resolved(): readonly number[] {
    return [...this.resolvedReckonings].sort((a, b) => a - b);
  }

  /** Ids in one Reckoning, canonical order. */
  idsInReckoning(reckoning: number): readonly SealId[] {
    return [...(this.byReckoning.get(reckoning) ?? [])].sort(compareIds);
  }

  idsOf(principal: PrincipalId, reckoning: number): readonly SealId[] {
    return [...(this.byScope.get(scopeKey(principal, reckoning)) ?? [])].sort(compareIds);
  }

  /**
   * The full record, **content included**. Audit, invariants and the season
   * replay only — see the module header on why `commit` does not return one.
   */
  auditRecord(id: SealId): SealAuditRecord | null {
    return this.byId.get(id) ?? null;
  }

  /** Every record, canonical order. For the invariant pass and the replay. */
  auditRecords(): readonly SealAuditRecord[] {
    const out: SealAuditRecord[] = [];
    for (const id of [...this.byId.keys()].sort(compareIds)) {
      const rec = this.byId.get(id);
      if (rec !== undefined) out.push(rec);
    }
    return out;
  }

  /**
   * The `core/types.ts` contract shape for one seal. Its `intent` is the closed
   * five-key record and its `verdict` is the flag — the storage projection, still
   * not an agent-facing one.
   */
  asSeal(id: SealId): Seal | null {
    const rec = this.byId.get(id);
    if (rec === undefined) return null;
    return Object.freeze({
      id: rec.id,
      principal: rec.principal,
      reckoningIndex: rec.reckoningIndex,
      intent: intentToCanonical(rec.intent),
      verdict: rec.verdict,
    });
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing === undefined) map.set(key, [value]);
  else existing.push(value);
}

/**
 * Reconcile the producer's tally against the rows that actually arrived, and return
 * the principals for whom an **absence** is now evidence.
 *
 * This is the whole of the completeness witness. `witnessed` is what
 * {@link ./verdict.ts} consults before it will mark a seal from the absence of a
 * deed, and a principal earns a place in it only by having its independently-sourced
 * count match the rows in front of us. Everything that does not match produces a
 * sentence for the operator and **no mark for anyone** — never a halt, because a
 * tally is a caller's claim and a claim the engine cannot account for is data
 * (AGT-X9; SPEC §15.3's rule that the unresolvable defers and never defaults).
 *
 * Only deeds **inside `r`** are counted, because that is what a tally of "this
 * Reckoning's deeds" means. `resolve` deliberately tolerates out-of-window deeds in
 * its argument (a naive "all deeds so far" query hands them over, and scar #7 says
 * they must be ignored rather than judged) — counting them here would turn that
 * tolerated sloppiness into a reconciliation failure and defer honest seals.
 */
function reconcile(
  witness: DeedSetWitness | undefined,
  deeds: readonly Deed[],
  r: number,
): { readonly witnessed: ReadonlySet<PrincipalId>; readonly deedSetFaults: readonly string[] } {
  const witnessed = new Set<PrincipalId>();
  const deedSetFaults: string[] = [];
  if (witness === undefined) return { witnessed, deedSetFaults };

  const arrived = new Map<PrincipalId, number>();
  for (const deed of deeds) {
    if (reckoningIndex(deed.tick) !== r) continue;
    arrived.set(deed.principal, (arrived.get(deed.principal) ?? 0) + 1);
  }

  const tallied = new Map<PrincipalId, number[]>();
  for (const t of witness.tallies) push(tallied, t.principal, t.deedCount);

  for (const p of [...tallied.keys()].sort(compareIds)) {
    const counts = tallied.get(p) ?? [];
    const distinct = new Set(counts);
    if (distinct.size > 1) {
      // Two answers is no answer. Identical duplicates are merely untidy and are
      // allowed through, because deferring an honest seal over a repeated row would
      // cost the reveal for nothing.
      //
      // Reported in the order given rather than sorted: `NaN` is a reachable count
      // here, and a numeric comparator against it returns `NaN`, which leaves the
      // order to the engine rather than to us (DET-1).
      deedSetFaults.push(
        `the deed-set witness tallies ${p} more than once and the counts disagree` +
          ` (${counts.map((c) => String(c)).join(', ')}); ${p}'s seals defer`,
      );
      continue;
    }
    const expected = counts[0];
    if (expected === undefined || !Number.isSafeInteger(expected) || expected < 0) {
      deedSetFaults.push(
        `the deed-set witness tallies ${p} at ${String(expected)}, which is not a deed count;` +
          ` ${p}'s seals defer`,
      );
      continue;
    }
    const present = arrived.get(p) ?? 0;
    if (present !== expected) {
      // The §15.4 route this witness exists for: the producer wrote N rows and N-1
      // reached us, so the principal we dropped looks exactly like one that abstained.
      deedSetFaults.push(
        `the deed-set witness tallies ${expected} deed(s) for ${p} in Reckoning ${String(r)} but` +
          ` ${present} arrived; a set that lost a row would mark whoever it dropped, so ${p}'s` +
          ' seals defer',
      );
      continue;
    }
    witnessed.add(p);
  }

  return { witnessed, deedSetFaults };
}

/**
 * The state version a seal's rule 4 is enforced against.
 *
 * `actedOnStateVersion` is the agent's own claim about what it saw, countersigned by
 * nobody. A claim **ahead of settlement's own version** names a state that did not
 * exist even at the Reckoning, so scar #6's rule — *resolve from the same state the
 * agents acted on* — has nothing to say about it, and applying it anyway filters out
 * every honest deed the agent produced.
 *
 * Three answers were possible and two are wrong. **Halting** is AGT-X9: an agent
 * chooses the number, so an agent chooses the outage. **Deferring** hands every agent
 * a one-integer way to make its mandatory seal weightless, which deletes the reveal.
 * So an impossible pin is **disregarded**: the seal is judged on its deeds like any
 * other, and the agent gains nothing by lying about what it saw.
 *
 * The honest case is untouched, and the door in `commit` refuses the impossible one
 * outright wherever the caller supplies `stateVersion` — this is the floor under
 * that, not a substitute for it.
 */
function pinnedVersion(rec: SealAuditRecord, settlementStateVersion: number): number {
  return rec.actedOnStateVersion <= settlementStateVersion ? rec.actedOnStateVersion : 0;
}
