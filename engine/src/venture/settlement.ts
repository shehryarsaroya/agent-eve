/**
 * Resolution — the waterfall (SPEC §7.4, §15.3).
 *
 * > **Settlement order per venture:** proceeds computed -> wages paid in seniority
 * > order -> escrowed parts execute -> elective parts honoured, partially paid, or
 * > defaulted -> residual split by share in bps -> **deterministic remainder
 * > allocation** -> receipts posted -> standing moves -> encumbrances released.
 * > — §7.4
 *
 * > escrowed parts -> elective parts in `venture_id` order -> cascade in <=3 fixed
 * > rounds, and **an obligation still unresolved at the round limit DEFERS to the
 * > next Reckoning; it never defaults** -> split waterfall with deterministic
 * > remainder. — §15.3
 *
 * ## Where the money is, which is the whole model
 *
 * Three accounts, and which one a payment comes from *is* A7:
 *
 * 1. **The venture's escrow.** Holds `Σ escrowed` funded at signing plus the
 *    realised proceeds deposited before settlement. Engine-controlled, so
 *    everything paid out of it is **automatic**. This is A7's escrowed half and
 *    PROP-V4's first clause.
 * 2. **The creator's STORES.** Its own capital. The **elective** parts come from
 *    here and *only on an explicit election* — {@link SettleInput.elections} is an
 *    opt-in map and an absent entry pays nothing. That is PROP-V4's second clause
 *    made structural rather than conditional: there is no code path in this file
 *    that moves elective value without the payer naming the role and the amount.
 * 3. **The role-holder's STORES.** Where payouts land.
 *
 * A role's claim is attributed across the two halves by the pinned terms:
 *
 * ```text
 * escrowedDue = min(claim, terms.escrowed)     guaranteed, auto-executes
 * electiveDue = claim - escrowedDue            elective, never auto-executes
 * ```
 *
 * An escrow **shortfall** — the account was raided between signing and settlement —
 * is a **recorded loss, never a default** (§10.2, PROP-L3). "An encumbrance is a
 * claim on a thing, not a shield over it", so escrow guarantees priority and
 * automaticity, never that the value survives. Recording that as a default would
 * libel an agent that broke no promise, which is the A5' failure and strictly worse
 * than a crash.
 *
 * ## INV-6 holds by construction, not by inspection
 *
 * The residual is divided with `splitByBps` over `[...filled share roles, creator]`
 * — weights that sum to exactly `BPS_ONE` by construction, because the creator's
 * weight is defined as the remainder. `splitByBps` "allocates **every** minor unit"
 * and asserts `sum(result) === amount`, so `wagesCovered + Σ parts === proceeds`
 * exactly, and the truncation remainder lands deterministically in the weights'
 * given order. There is no arithmetic in this file that can leak a minor unit.
 *
 * ## The false-default defences that live here
 *
 * Two of §15.4's five: `acted_on_state_version` is compared and **halts the tick**
 * on mismatch, and `terms_hash` is compared against the hash recomputed from the
 * row. A third is next door — the pinned valuation rule and its as-of tick are
 * inside that hash (`terms.ts`). {@link SettlementHalt} is thrown rather than
 * returned for exactly these: SPEC §15.2 says abort the tick and halt, and a
 * `{ok:false}` an agent could ignore is not a halt.
 */

import type {
  AccountId,
  EventId,
  PrincipalId,
  VentureId,
  VentureState,
} from '../core/types.js';
import { BPS_ONE, addMinor, bps, minor, splitByBps, subMinor, type Bps, type Minor } from '../core/units.js';
import {
  assertPayoutsExact,
  compareIds,
  payByPriority,
  type Claim,
  type Ledger,
} from '../ledger/index.js';
import { CASCADE_ROUND_LIMIT, assertBoundedRounds, type StandingCause } from '../invariants/index.js';
import type { RoleLabel } from './kinds.js';
import { VentureBook } from './book.js';
import { SHARE_PRIORITY, WAGE_PRIORITY, seniorityOf } from './terms.js';
import {
  filledIndices,
  isFullyFilled,
  termsHashOf,
  type VentureRecord,
  type VentureRoleRecord,
} from './venture.js';

/**
 * §15.3's "<=3 fixed rounds" is **not redefined here.**
 *
 * `src/invariants/transaction.ts` owns `CASCADE_ROUND_LIMIT` and says why: "Exported
 * here rather than in the venture module because the reason for the number is a
 * halt-semantics reason." That is right, and a second constant with the same meaning is
 * two homes for one rule — the shape of scar #5 applied to a rule rather than to a
 * quantity, and the kind of drift where the venture module defers at 3 while the tick
 * loop asserts boundedness at 4.
 *
 * So the limit is imported, and this module re-exports the same name rather than
 * inventing a second one (§3: one word per concept).
 */
export { CASCADE_ROUND_LIMIT } from '../invariants/index.js';

/**
 * How many Reckonings one venture may defer across.
 *
 * §15.3 promises a deferral never defaults, and E2E-13 also requires that "a rival
 * cannot construct a deferral loop as a denial-of-settlement". Both hold only if the
 * deferral is bounded, so it is. What happens *at* the bound is stated in
 * {@link SettlementBatch.unattributed} and is deliberately not a default: see the
 * note there.
 */
export const MAX_DEFERRALS = 2;

/**
 * The partial states §7.4 names, plus the one it does not have to name.
 *
 * `FULFILLED` is the every-role-filled, nothing-lost case. The other five are §7.4's
 * own words, verbatim, because the outcome type is agent-facing text and the engine
 * and the spec disagreeing about one word is scar #1.
 */
export type ResolutionKind = 'FULFILLED' | 'PARTIAL_FILL' | 'NO_SHOW' | 'CARGO_LOST' | 'WITHDRAWN' | 'FORCE_MAJEURE';

/** Outcomes in which the escrow may legitimately be short. */
const LOSS_OUTCOMES: readonly ResolutionKind[] = Object.freeze([
  'CARGO_LOST',
  'FORCE_MAJEURE',
  'NO_SHOW',
  'WITHDRAWN',
] as ResolutionKind[]);

/** Why an elective part went unpaid. Never inferred from prose (PROP-D1, scar #8). */
export type DefaultCause = 'DECLINED' | 'UNFUNDED';

export class SettlementHalt extends Error {}

export interface SettlementAccounts {
  /**
   * A venture's pot. Escrowed parts pay from here and the surplus returns home.
   *
   * A **function of the venture**, not one account: `settleBatch` settles many
   * ventures in one call and each has its own escrow (`escrowAccount(venture,
   * funder)`). A single field here would have paid every venture in a Reckoning out
   * of the first one's pot — the whole batch balancing, every individual promise
   * wrong, and INV-2 with nothing to complain about.
   */
  escrowOf(venture: VentureRecord): AccountId;
  /** A principal's STORES. Elective parts pay from the creator's. */
  storesOf(principal: PrincipalId): AccountId;
}

export interface SettleInput {
  readonly venture: VentureRecord;
  readonly tick: number;
  /** Stamped on the postings this settlement produces. Content-derived, not a counter. */
  readonly eventId: EventId;
  readonly outcome: ResolutionKind;
  /**
   * Value the venture realised, from {@link ../proceeds.ts}. Pinned by the caller so
   * a re-settlement of a deferral divides the same pot — the residual is drawn from
   * a sub-stream keyed on the venture id, so recomputing it is reproducible.
   */
  readonly proceeds: Minor;
  /**
   * The payer's elections, role index -> amount it chooses to pay of that role's
   * elective part. **An absent entry pays nothing** (PROP-V4). Capped at the
   * elective due, so an over-election cannot become a gift the payer did not intend.
   */
  readonly elections: ReadonlyMap<number, Minor>;
  /** INV-19: what the parties acted on. A mismatch halts the tick. */
  readonly stateVersion: number;
  /**
   * The event that destroyed value, on a loss outcome. INV-17: "a default with no
   * attributable cause is a top-severity halt, because it is the game accusing an
   * innocent agent" — and the same is true of a recorded loss with no cause.
   */
  readonly causeEventId: EventId | null;
}

export interface RoleClaim {
  readonly roleIndex: number;
  readonly label: RoleLabel;
  readonly holder: PrincipalId | null;
  /**
   * Whether this role was counted as filled for the arithmetic.
   *
   * At settlement this is `holder !== null`. In a *forecast* it can be true with a
   * null holder, because `your_take_at_p50` is quoted against a full fill (see
   * {@link ../preview.ts}) — the deal as described, so the echo does not go stale
   * every time a counterparty joins mid-negotiation.
   */
  readonly counted: boolean;
  /** `WAGE_PRIORITY` or `SHARE_PRIORITY`. Lower is paid first. */
  readonly priority: number;
  /** What the role earned. Zero for a role that was not counted. */
  readonly claim: Minor;
  readonly escrowedDue: Minor;
  readonly electiveDue: Minor;
}

export interface ClaimBreakdown {
  readonly venture: VentureId;
  readonly proceeds: Minor;
  /** Σ wage claims over filled wage roles, uncapped. */
  readonly wageTotal: Minor;
  /** What the proceeds could cover of the wages. Seniority, in one number. */
  readonly wagesCovered: Minor;
  /** `proceeds - wagesCovered`. What the shares divide. */
  readonly residual: Minor;
  readonly roles: readonly RoleClaim[];
  /** `BPS_ONE - Σ filled share roles`. The creator is the residual claimant. */
  readonly creatorShareBps: Bps;
  readonly creatorPart: Minor;
}

export interface RolePayout extends RoleClaim {
  readonly escrowedPaid: Minor;
  readonly electivePaid: Minor;
  /** `electiveDue - electivePaid`. A broken promise, if it is attributable. */
  readonly electiveShortfall: Minor;
  /** `escrowedDue - escrowedPaid`. A recorded LOSS, never a default. */
  readonly escrowedShortfall: Minor;
}

export interface VentureDefault {
  readonly venture: VentureId;
  readonly roleIndex: number;
  readonly payer: PrincipalId;
  readonly payee: PrincipalId;
  readonly amount: Minor;
  readonly cause: DefaultCause;
  /** INV-17. Never null: a default with no attributable cause is a top-severity halt. */
  readonly causeEventId: EventId;
}

/**
 * The facts standing moves on. **A report, not a write** — INV-21 says standing
 * changes only via an elective-honoured settlement, a default, a contradicted seal
 * or scheduled decay, and the way to make that true is for settlement to hand the
 * facts to whoever owns the vectors rather than reaching into them.
 *
 * The weighting §6.4 requires (against the honourer's total capital,
 * diversity-weighted across distinct counterparties) is deliberately *not* here: it
 * needs the whole standing table. What is here is the unweighted fact and the
 * counterparty it was earned against, which is what the diversity term needs.
 */
export interface StandingDelta {
  /**
   * The cause, in `src/seal/standing.ts`'s **own spelling**, imported rather than
   * re-declared. `checkInv21` takes a `StandingCause[]` and asserts that nothing moved
   * without one, so the two surfaces have to agree on the literal — and two modules
   * agreeing about a word by coincidence is exactly scar #1.
   */
  readonly cause: Extract<StandingCause, 'ELECTIVE_HONOURED' | 'DEFAULT'>;
  readonly principal: PrincipalId;
  readonly counterparty: PrincipalId;
  readonly venture: VentureId;
  readonly electiveHonoured: number;
  readonly electiveHonouredValue: Minor;
  readonly defaults: number;
  readonly defaultedValue: Minor;
}

export interface VentureSettlement {
  readonly venture: VentureId;
  readonly outcome: ResolutionKind;
  readonly claims: ClaimBreakdown;
  readonly payouts: readonly RolePayout[];
  /** Escrow returned to the creator: unearned funding plus its residual share. */
  readonly escrowReturned: Minor;
  /** Σ escrowed shortfall. A recorded loss; standing does not move (INV-21). */
  readonly recordedLoss: Minor;
  readonly defaults: readonly VentureDefault[];
  readonly standing: readonly StandingDelta[];
  /**
   * Elective value left unpaid that this engine will **not** attribute — the
   * deferral bound was reached. See {@link SettlementBatch.unattributed}.
   */
  readonly unattributed: Minor;
  readonly terminalState: Extract<VentureState, 'SETTLED' | 'DEFAULTED' | 'DEFERRED'>;
  /** One line for the ticker. Never called `reason`: §11.1 owns that word. */
  readonly line: string;
}

export interface SettlementBatch {
  readonly settlements: readonly VentureSettlement[];
  readonly defaults: readonly VentureDefault[];
  readonly standing: readonly StandingDelta[];
  /** Rounds actually used. Asserted <= `CASCADE_ROUND_LIMIT` (DET-9). */
  readonly roundsUsed: number;
  /**
   * True when the round loop hit {@link CASCADE_ROUNDS} **while still making
   * progress**, so some elective parts were left unpaid by the engine rather than by a
   * payer. This is the flag the deferral decision turns on.
   *
 * §15.3: "an obligation still unresolved **at the round limit** DEFERS to the next
 * Reckoning; it never defaults ... a truncated cascade recording a breach is an
 * engine-fabricated default, and a rival can construct one deliberately."
 *
 * The first version of this file tested whether the payer was still owed money by an
 * unsettled venture in the same batch. Tracing a four-venture reverse chain showed
 * that test producing a **false default**: round 3 pays venture `v-b`'s creator, but
 * `v-b` was visited earlier in that same round, so it is left unpaid — and by then
 * nothing in the batch owes it anything, so the pending-credit test says "attributable"
 * and writes a default against a payer that has the money and was simply never
 * retried. That is exactly the fabricated default §15.4 calls the top engineering
 * risk.
 *
 * The round limit is the honest test, because it is the *engine's* limitation and the
 * engine knows when it hit it:
 *
 *   - the loop exits because **nothing moved** -> no new money can arrive, so every
 *     remaining shortfall is the payer's own balance and is attributable. Default.
 *   - the loop exits because it **ran out of rounds while still moving** -> the
 *     shortfall may be ours. Defer.
 *
 * The residual conservatism is deliberate and one-directional: a payer that is
 * genuinely broke inside a batch that happened to truncate defers instead of
 * defaulting, and after {@link MAX_DEFERRALS} its shortfall becomes an unattributed
 * loss rather than a default. Never fabricating a breach is worth occasionally
 * declining to name one (A5', scar #8 — when the penalty is permanent and public,
 * precision beats recall).
   */
  readonly truncated: boolean;
  /**
   * Elective value nobody was charged for.
   *
   * At the deferral bound the engine knows an elective part is unpaid and knows it
   * cannot say why: the payer elected to pay and was short because a counterparty in
   * the same circular batch had not settled, three Reckonings running. A5' forbids
   * the convenient answer — a default with no attributable cause is the game
   * accusing an innocent agent — and DET-9 forbids the other one, deferring forever.
   * So the value is recorded as an unattributed loss, standing does not move, and
   * the number is published rather than swallowed.
   */
  readonly unattributed: Minor;
}

// ── Claims ───────────────────────────────────────────────────────────────────

/**
 * What every role earned, and how it splits across A7's two halves.
 *
 * Pure, and **shared with the preview** ({@link ../preview.ts}) on purpose. §7.1's
 * failure was the engine and the agent-facing number disagreeing, so there is one
 * implementation of "what you are owed" and both the echo and the payout read it.
 * PROP-V3 then tests the thing that can still go wrong: that the *paid* amount is
 * the *claimed* amount.
 */
export function computeClaims(
  venture: VentureRecord,
  proceeds: Minor,
  /**
   * Role indices to treat as filled. Omitted at settlement, where the rows are the
   * truth; supplied by the forecast, which quotes a full fill.
   */
  treatAsFilled?: readonly number[],
): ClaimBreakdown {
  if (proceeds < 0) {
    throw new SettlementHalt(`${venture.id} cannot settle against negative proceeds ${proceeds}`);
  }

  const filled = new Set(treatAsFilled ?? filledIndices(venture));

  let wageTotal = 0;
  for (const role of venture.roles) {
    if (!filled.has(role.index)) continue;
    if (role.terms.wage !== null) wageTotal += role.terms.wage;
  }
  // Seniority in one line: a fixed claim is paid before any residual exists, so the
  // residual is what is left *after* the wages, floored at zero. A wage that exceeds
  // proceeds does not create a negative residual; it creates a shortfall, which the
  // escrowed and elective halves below account for.
  const wagesCovered = minor(Math.min(wageTotal, proceeds));
  const residual = subMinor(proceeds, wagesCovered);

  const shareRoles = venture.roles.filter((r) => filled.has(r.index) && r.terms.share !== null);
  let shareTotal = 0;
  for (const role of shareRoles) shareTotal += role.terms.share ?? 0;
  if (shareTotal > BPS_ONE) {
    // Refused at creation, so this is the independent check on that refusal.
    throw new SettlementHalt(
      `${venture.id} allots ${shareTotal} bps of residual across its roles, more than the ${BPS_ONE} ` +
        'there is; the creator’s residual weight would be negative',
    );
  }
  const creatorShareBps = bps(BPS_ONE - shareTotal);

  // Weights sum to exactly BPS_ONE by construction, which is what lets `splitByBps`
  // allocate every minor unit and assert it. The creator is last, so the truncation
  // remainder walks the roles first — a deterministic rule, stated rather than
  // incidental (INV-6, DET-1).
  const weights: Bps[] = [...shareRoles.map((r) => r.terms.share ?? bps(0)), creatorShareBps];
  const parts = splitByBps(residual, weights);
  const creatorPart = parts[parts.length - 1] ?? minor(0);

  const shareByIndex = new Map<number, Minor>();
  for (const [i, role] of shareRoles.entries()) {
    shareByIndex.set(role.index, parts[i] ?? minor(0));
  }

  const roles: RoleClaim[] = venture.roles.map((role) => {
    if (!filled.has(role.index)) {
      return {
        roleIndex: role.index,
        label: role.label,
        holder: null,
        counted: false,
        priority: seniorityOf(role.terms),
        claim: minor(0),
        escrowedDue: minor(0),
        electiveDue: minor(0),
      };
    }
    const claim =
      role.terms.wage !== null ? role.terms.wage : (shareByIndex.get(role.index) ?? minor(0));
    const escrowedDue = minor(Math.min(claim, role.terms.escrowed));
    return {
      roleIndex: role.index,
      label: role.label,
      holder: role.filledByPrincipal,
      counted: true,
      priority: role.terms.wage !== null ? WAGE_PRIORITY : SHARE_PRIORITY,
      claim,
      escrowedDue,
      electiveDue: subMinor(claim, escrowedDue),
    };
  });

  const breakdown: ClaimBreakdown = {
    venture: venture.id,
    proceeds,
    wageTotal: minor(wageTotal),
    wagesCovered,
    residual,
    roles,
    creatorShareBps,
    creatorPart,
  };
  assertClaimsExact(breakdown);
  return breakdown;
}

/**
 * INV-6, asserted on the claim arithmetic rather than trusted.
 *
 * "Every settled venture's splits sum **exactly** to its proceeds; the remainder is
 * allocated by the deterministic rule and is accounted, never dropped. (Rounding
 * leaks are how a ledger silently stops balancing.)"
 */
export function assertClaimsExact(b: ClaimBreakdown): void {
  let shareSum = 0;
  for (const r of b.roles) {
    if (!r.counted) continue;
    if (r.priority === SHARE_PRIORITY) shareSum += r.claim;
    if (r.claim < 0) throw new SettlementHalt(`INV-6: ${b.venture} role ${r.roleIndex} claims ${r.claim}`);
    if (addMinor(r.escrowedDue, r.electiveDue) !== r.claim) {
      throw new SettlementHalt(
        `INV-6: ${b.venture} role ${r.roleIndex} splits ${r.claim} into ${r.escrowedDue} escrowed + ` +
          `${r.electiveDue} elective, which do not add up`,
      );
    }
  }
  const allocated = shareSum + b.creatorPart;
  if (allocated !== b.residual) {
    throw new SettlementHalt(
      `INV-6: ${b.venture} divides a residual of ${b.residual} into parts totalling ${allocated}`,
    );
  }
  if (addMinor(b.wagesCovered, b.residual) !== b.proceeds) {
    throw new SettlementHalt(
      `INV-6: ${b.venture} covers ${b.wagesCovered} of wages and leaves ${b.residual}, which is not ` +
        `its ${b.proceeds} of proceeds`,
    );
  }
}

// ── The batch ────────────────────────────────────────────────────────────────

interface Working {
  readonly input: SettleInput;
  readonly claims: ClaimBreakdown;
  readonly escrowedPaid: Map<number, Minor>;
  readonly electivePaid: Map<number, Minor>;
  readonly defaults: VentureDefault[];
  escrowReturned: Minor;
  recordedLoss: Minor;
  /** True once every elective part is either paid in full or defaulted. */
  resolvedElective: boolean;
}

/**
 * Settle a batch of ventures.
 *
 * The single implementation. {@link settleVenture} is this with one input, so there
 * is no second settlement path that could drift from the first.
 *
 * Order, exactly §15.3's: escrowed parts for every venture in `venture_id` order,
 * then elective parts in `venture_id` order across <=3 fixed rounds, then defaults
 * or deferrals, then releases.
 */
export function settleBatch(
  ledger: Ledger,
  book: VentureBook,
  inputs: readonly SettleInput[],
  accounts: SettlementAccounts,
): SettlementBatch {
  // §15.3: `venture_id` order, and nothing else. Sorting here rather than trusting
  // the caller is what makes PROP-V7 a property of this function instead of a
  // convention its callers might break.
  const ordered = [...inputs].sort((a, b) => compareIds(a.venture.id, b.venture.id));

  const working: Working[] = [];
  for (const input of ordered) {
    guardSettleable(ledger, input, accounts);
    working.push({
      input,
      claims: computeClaims(input.venture, input.proceeds),
      escrowedPaid: new Map<number, Minor>(),
      electivePaid: new Map<number, Minor>(),
      defaults: [],
      escrowReturned: minor(0),
      recordedLoss: minor(0),
      resolvedElective: false,
    });
  }

  // ── Phase 1: escrowed parts execute. Automatic, always (PROP-V4). ──────────
  for (const w of working) {
    // A deferral has already had its escrowed parts paid and its escrow returned.
    // Re-running them would pay twice out of an account that is now empty, which
    // would present as an escrow shortfall — a recorded loss the engine invented.
    if (w.input.venture.deferrals > 0) continue;
    payEscrowedParts(ledger, w, accounts);
  }

  // ── Phase 2: elective parts, in venture_id order, in fixed rounds. ─────────
  //
  // `truncated` is the whole reason this loop tracks anything: it distinguishes a
  // cascade that ran out of *rounds* from one that ran out of *money*, and those are
  // two completely different stories about the same unpaid amount. The full argument
  // is on `SettlementBatch.truncated`.
  let roundsUsed = 0;
  let truncated = false;
  for (let round = 1; round <= CASCADE_ROUND_LIMIT; round += 1) {
    roundsUsed = round;
    let progressed = false;
    for (const w of working) {
      if (w.resolvedElective) continue;
      const moved = payElectiveParts(ledger, w, accounts);
      if (moved > 0) progressed = true;
      if (outstandingElective(w) === 0) w.resolvedElective = true;
    }
    if (working.every((w) => w.resolvedElective)) break;
    // Fixed rounds, never a loop to convergence (§15.2, DET-9). A round that moved
    // nothing will move nothing next round either — no new money can arrive — so the
    // remaining shortfalls are genuine funding failures and are attributable.
    if (!progressed) break;
    // Progress was still being made when the round limit stopped us. Every remaining
    // shortfall is therefore an artifact of the limit, not of the payer.
    if (round === CASCADE_ROUND_LIMIT) truncated = true;
  }

  // ── Phase 3: what is still unpaid is a default, a deferral, or unattributed. ─
  const settlements: VentureSettlement[] = [];
  let unattributedTotal = 0;
  for (const w of working) {
    const outcome = finaliseVenture(ledger, book, w, truncated);
    unattributedTotal += outcome.unattributed;
    settlements.push(outcome);
  }

  // DET-9, through the invariants module's own assertion rather than a private copy:
  // "the tick's step count is bounded regardless of input."
  assertBoundedRounds(roundsUsed);

  return {
    settlements,
    defaults: settlements.flatMap((s) => s.defaults),
    standing: settlements.flatMap((s) => s.standing),
    roundsUsed,
    truncated,
    unattributed: minor(unattributedTotal),
  };
}

/** One venture. The batch of one, so there is one implementation (PROP-V7). */
export function settleVenture(
  ledger: Ledger,
  book: VentureBook,
  input: SettleInput,
  accounts: SettlementAccounts,
): VentureSettlement {
  const batch = settleBatch(ledger, book, [input], accounts);
  const only = batch.settlements[0];
  if (only === undefined) throw new SettlementHalt(`${input.venture.id} produced no settlement`);
  return only;
}

// ── Guards ───────────────────────────────────────────────────────────────────

/**
 * The pre-settlement guards, and the two §15.4 defences that live here.
 *
 * Throws {@link SettlementHalt} rather than returning a rejection: SPEC §15.2 says
 * "on assertion failure, abort the tick and halt. Never publish a broken tick", and
 * every condition below means the settlement about to be written would be wrong.
 */
function guardSettleable(ledger: Ledger, input: SettleInput, accounts: SettlementAccounts): void {
  const v = input.venture;

  if (v.state !== 'LIVE' && v.state !== 'DEFERRED') {
    throw new SettlementHalt(
      `${v.id} is ${v.state}; only a LIVE venture or a DEFERRED obligation settles`,
    );
  }
  if (v.deferrals > MAX_DEFERRALS) {
    throw new SettlementHalt(
      `${v.id} has deferred ${v.deferrals} times, past the bound of ${MAX_DEFERRALS}; a deferral loop ` +
        'must terminate (DET-9)',
    );
  }

  // INV-19 / §15.4: "acted_on_state_version compared at settlement, halting the
  // tick on mismatch". Settling against a world the parties never saw is how a
  // healthy-looking system fabricates a broken promise.
  if (v.actedOnStateVersion === null) {
    throw new SettlementHalt(
      `INV-19: ${v.id} never pinned acted_on_state_version, so there is nothing to compare at ` +
        'settlement and no way to know the parties saw this world',
    );
  }
  if (v.actedOnStateVersion !== input.stateVersion) {
    throw new SettlementHalt(
      `INV-19: ${v.id} was agreed against state version ${v.actedOnStateVersion} but settlement is ` +
        `running at ${input.stateVersion}; halting rather than settling against a world the parties ` +
        'never saw',
    );
  }

  // §15.4: `terms_hash` pins the valuation rule and its as-of tick. Recomputing it
  // from the row and comparing is what makes the pin real — a row edited after
  // signing produces a different hash and this is where that is caught.
  if (v.termsHash === null) {
    throw new SettlementHalt(`${v.id} has no terms_hash; nothing was countersigned`);
  }
  const recomputed = termsHashOf(v);
  if (recomputed !== v.termsHash) {
    throw new SettlementHalt(
      `${v.id}'s terms no longer hash to what was countersigned (${v.termsHash.slice(0, 12)} vs ` +
        `${recomputed.slice(0, 12)}); the pinned valuation rule or a role's terms were edited after signing`,
    );
  }

  if (input.proceeds < 0) {
    throw new SettlementHalt(`${v.id} cannot settle against negative proceeds ${input.proceeds}`);
  }

  // A loss outcome must name what destroyed the value (INV-17). Without it the
  // record says value vanished and points at nobody, which reads as an accusation.
  if (LOSS_OUTCOMES.includes(input.outcome) && input.causeEventId === null) {
    throw new SettlementHalt(
      `INV-17: ${v.id} resolves ${input.outcome} with no causeEventId; a loss with no attributable ` +
        'cause is the game accusing an innocent agent',
    );
  }
  if (input.outcome === 'FULFILLED' && !isFullyFilled(v)) {
    throw new SettlementHalt(
      `${v.id} resolves FULFILLED with open roles; that outcome is PARTIAL_FILL and the distinction is ` +
        'what an agent reads off the receipt',
    );
  }

  for (const amount of input.elections.values()) {
    if (amount < 0) throw new SettlementHalt(`${v.id} elects to pay a negative amount ${amount}`);
  }

  // Every account a payment could reach must exist before any of them moves. A
  // half-applied settlement in an append-only ledger is a permanent silent
  // imbalance, "unrecoverable by construction" (§15.3).
  requireAccount(ledger, accounts.escrowOf(v), v.id, 'escrow');
  requireAccount(ledger, accounts.storesOf(v.creator), v.id, `creator ${v.creator}`);
  for (const role of v.roles) {
    if (role.filledByPrincipal === null) continue;
    requireAccount(ledger, accounts.storesOf(role.filledByPrincipal), v.id, `role holder ${role.filledByPrincipal}`);
  }
}

function requireAccount(ledger: Ledger, id: AccountId, venture: VentureId, what: string): void {
  if (ledger.account(id) === undefined) {
    throw new SettlementHalt(`${venture} cannot settle: no ${what} account ${id}`);
  }
}

// ── Phase 1 ──────────────────────────────────────────────────────────────────

/**
 * Pay the escrowed parts, in seniority order, from the escrow account.
 *
 * `payByPriority` does the work: pro-rata within a band, wage senior to share, and
 * `assertPayoutsExact` on the way out. Using the ledger's waterfall rather than a
 * second implementation is deliberate — it already encodes "a junior band is never
 * paid while a senior band is short", which is §7.1's inversion, and two copies of
 * that rule is one copy too many.
 */
function payEscrowedParts(ledger: Ledger, w: Working, accounts: SettlementAccounts): void {
  const v = w.input.venture;
  const escrow = accounts.escrowOf(v);
  const available = ledger.freeBalance(escrow);

  const claims: Claim[] = [];
  for (const r of w.claims.roles) {
    if (r.holder === null || r.escrowedDue <= 0) continue;
    claims.push({
      account: accounts.storesOf(r.holder),
      priority: r.priority,
      amount: r.escrowedDue,
      // Zero-padded so the code-unit tiebreak inside a band is role-index order for
      // any venture with fewer than 100 roles (the cap is 8).
      key: `${v.id}:${String(r.roleIndex).padStart(2, '0')}`,
    });
  }

  let escrowedTotal = 0;
  for (const c of claims) escrowedTotal += c.amount;

  if (available < escrowedTotal && !LOSS_OUTCOMES.includes(w.input.outcome)) {
    // A short escrow on a delivered venture is not predation, it is an unfunded
    // signature — and silently turning a guaranteed part into a recorded loss is
    // exactly the class of bug §15.4 exists to prevent. Halt.
    throw new SettlementHalt(
      `${v.id} resolves ${w.input.outcome} but its escrow holds ${available} against ${escrowedTotal} of ` +
        'escrowed parts. The escrowed half auto-executes, so it must be funded at signing; a shortfall ' +
        'here would be recorded as a loss nobody caused',
    );
  }

  const result = payByPriority(minor(Math.min(available, escrowedTotal)), claims);
  assertPayoutsExact(minor(Math.min(available, escrowedTotal)), result);

  for (const p of result.payouts) {
    const roleIndex = Number.parseInt(p.key.slice(p.key.lastIndexOf(':') + 1), 10);
    w.escrowedPaid.set(roleIndex, addMinor(w.escrowedPaid.get(roleIndex) ?? minor(0), p.paid));
    if (p.paid <= 0) continue;
    ledger.transferCurrency({
      eventId: `${w.input.eventId}#escrowed:${roleIndex}` as EventId,
      tick: w.input.tick,
      from: escrow,
      to: p.account,
      amount: p.paid,
    });
  }
  w.recordedLoss = result.shortfall;

  // Everything left in the escrow goes home: the unearned funding for roles that
  // stayed open, plus the creator's residual share of the proceeds. Returning the
  // whole remainder rather than a computed figure is what makes escrow conservation
  // exact — every unit that entered leaves, so INV-2 has nothing to reconcile.
  const remaining = ledger.freeBalance(escrow);
  if (remaining > 0) {
    ledger.transferCurrency({
      eventId: `${w.input.eventId}#escrow-return` as EventId,
      tick: w.input.tick,
      from: escrow,
      to: accounts.storesOf(v.creator),
      amount: remaining,
    });
    w.escrowReturned = remaining;
  }
}

// ── Phase 2 ──────────────────────────────────────────────────────────────────

/** What this venture still owes on its elective parts. */
function outstandingElective(w: Working): Minor {
  let total = 0;
  for (const r of w.claims.roles) {
    if (r.holder === null) continue;
    const want = electionFor(w, r);
    const paid = w.electivePaid.get(r.roleIndex) ?? 0;
    total += Math.max(0, want - paid);
  }
  return minor(total);
}

/**
 * How much of a role's elective part the payer elected to pay, capped at the due.
 *
 * **An absent entry is zero.** That single line is PROP-V4's second clause: the
 * elective part never auto-executes, because there is no default that pays and no
 * branch that infers an intention to pay. §7.5: left free, agents set the elective
 * part to zero — so the floor makes it exist, and this makes it optional.
 */
function electionFor(w: Working, r: RoleClaim): Minor {
  const elected = w.input.elections.get(r.roleIndex) ?? minor(0);
  return minor(Math.min(elected, r.electiveDue));
}

/**
 * Pay what the payer elected and can fund, this round. Returns what moved.
 *
 * The self-dealt branch is checked **first**, before the election and before the
 * funding test. The first version of this file checked it last, so a creator holding
 * one of its own roles and not electing to pay itself produced a default with
 * `payer === payee` — the record accusing an agent of breaking a promise to itself,
 * which `checkSettlementExact` correctly flags as INV-17 and which would have halted
 * the tick on an entirely ordinary venture.
 */
function payElectiveParts(ledger: Ledger, w: Working, accounts: SettlementAccounts): Minor {
  const v = w.input.venture;
  const payerStores = accounts.storesOf(v.creator);
  let moved = 0;

  for (const r of w.claims.roles) {
    if (r.holder === null) continue;
    const to = accounts.storesOf(r.holder);

    if (to === payerStores) {
      // Self-dealing. Nothing moves — the money is already in the account it is owed
      // to — and nothing was *promised*, so no standing accrues and no default can be
      // recorded (§6.4, scar #9: ~17 duplicate pacts once took reputation 50 -> 100).
      // Booked as fully paid, not as an election, so it can never read as a breach.
      if ((w.electivePaid.get(r.roleIndex) ?? 0) < r.electiveDue) {
        w.electivePaid.set(r.roleIndex, r.electiveDue);
      }
      continue;
    }

    const want = electionFor(w, r);
    const already = w.electivePaid.get(r.roleIndex) ?? minor(0);
    const remainingWant = want - already;
    if (remainingWant <= 0) continue;

    const free = ledger.freeBalance(payerStores);
    const pay = minor(Math.min(remainingWant, Math.max(0, free)));
    if (pay <= 0) continue;

    ledger.transferCurrency({
      eventId: `${w.input.eventId}#elective:${r.roleIndex}:${String(already)}` as EventId,
      tick: w.input.tick,
      from: payerStores,
      to,
      amount: pay,
    });
    w.electivePaid.set(r.roleIndex, addMinor(already, pay));
    moved += pay;
  }
  return minor(moved);
}

// ── Phase 3 ──────────────────────────────────────────────────────────────────

/**
 * Turn what happened into defaults, a deferral, or an unattributed loss — and
 * release the venture's locks.
 */
function finaliseVenture(
  ledger: Ledger,
  book: VentureBook,
  w: Working,
  truncated: boolean,
): VentureSettlement {
  const v = w.input.venture;
  const payouts: RolePayout[] = w.claims.roles.map((r) => {
    const escrowedPaid = w.escrowedPaid.get(r.roleIndex) ?? minor(0);
    const electivePaid = w.electivePaid.get(r.roleIndex) ?? minor(0);
    return {
      ...r,
      escrowedPaid,
      electivePaid,
      escrowedShortfall: subMinor(r.escrowedDue, escrowedPaid),
      electiveShortfall: subMinor(r.electiveDue, electivePaid),
    };
  });

  // A venture defers only when every shortfall is a *funding* shortfall **and the
  // cascade was truncated**. Anything the payer declined is a choice, and a choice is
  // attributable, so it defaults now. See `SettlementBatch.truncated` for why
  // truncation is the right test and a pending-credit test is not.
  let declined = 0;
  let unfunded = 0;
  for (const p of payouts) {
    if (p.holder === null || p.electiveShortfall <= 0) continue;
    const want = electionFor(w, p);
    declined += subMinor(p.electiveDue, want);
    unfunded += Math.max(0, want - p.electivePaid);
  }
  const canDefer = declined === 0 && unfunded > 0 && truncated && v.deferrals < MAX_DEFERRALS;

  const defaults: VentureDefault[] = [];
  const standing: StandingDelta[] = [];
  let unattributed = 0;

  if (!canDefer) {
    for (const p of payouts) {
      if (p.holder === null) continue;
      const selfDealt = p.holder === v.creator;

      if (p.electiveShortfall > 0) {
        const want = electionFor(w, p);
        const roleDeclined = subMinor(p.electiveDue, want);
        const atBound = roleDeclined === 0 && truncated && v.deferrals >= MAX_DEFERRALS;
        if (atBound) {
          // The deferral bound. See `SettlementBatch.unattributed` — this engine
          // will not write a default it cannot attribute (A5').
          unattributed += p.electiveShortfall;
        } else {
          defaults.push({
            venture: v.id,
            roleIndex: p.roleIndex,
            payer: v.creator,
            payee: p.holder,
            amount: p.electiveShortfall,
            cause: roleDeclined > 0 ? 'DECLINED' : 'UNFUNDED',
            // INV-17: the attributable cause. On a loss outcome it is the event that
            // destroyed the value; otherwise it is this settlement — the elapsed
            // window, which is a fact in the ledger and not an inference.
            causeEventId: w.input.causeEventId ?? w.input.eventId,
          });
          if (!selfDealt) {
            standing.push({
              cause: 'DEFAULT',
              principal: v.creator,
              counterparty: p.holder,
              venture: v.id,
              electiveHonoured: 0,
              electiveHonouredValue: minor(0),
              defaults: 1,
              defaultedValue: p.electiveShortfall,
            });
          }
        }
      } else if (p.electiveDue > 0 && !selfDealt) {
        // §6.4: standing accrues **only** to the elective part honoured. A
        // 100%-escrowed role has `electiveDue === 0` and therefore produces no entry
        // at all — PROP-S2 by construction rather than by a filter downstream.
        standing.push({
          cause: 'ELECTIVE_HONOURED',
          principal: v.creator,
          counterparty: p.holder,
          venture: v.id,
          electiveHonoured: 1,
          electiveHonouredValue: p.electivePaid,
          defaults: 0,
          defaultedValue: minor(0),
        });
      }
    }
  }

  const terminalState: VentureSettlement['terminalState'] = canDefer
    ? 'DEFERRED'
    : defaults.length > 0
      ? 'DEFAULTED'
      : 'SETTLED';

  // Encumbrances released last (§7.4's own order). A deferral releases them too:
  // the obligation carries over, but the lock does not, or a deferral loop becomes a
  // way to freeze a competitor's capital.
  releaseStakes(ledger, v, w.input.tick);
  book.resolve(v.id, terminalState, w.input.tick);

  return {
    venture: v.id,
    outcome: w.input.outcome,
    claims: w.claims,
    payouts,
    escrowReturned: w.escrowReturned,
    recordedLoss: w.recordedLoss,
    defaults,
    standing,
    unattributed: minor(unattributed),
    terminalState,
    line: settlementLine(v, w.input.outcome, terminalState, payouts),
  };
}

/**
 * Release every lock this venture opened (INV-4: no orphan locks, and no obligation
 * lacking its encumbrance).
 */
export function releaseStakes(ledger: Ledger, venture: VentureRecord, tick: number): readonly string[] {
  const released: string[] = [];
  for (const enc of ledger.encumbrances.open()) {
    if (enc.obligationRef !== venture.id) continue;
    ledger.encumbrances.release(enc.id, tick);
    released.push(enc.id);
  }
  for (const role of venture.roles) role.stakeEncumbranceId = null;
  return released.sort(compareIds);
}

/**
 * §7.3's "filling a role escrows the stake at fill time". Otherwise filling a slot
 * is a free option and sybils can hold a stage's whole capacity all day and no-show.
 *
 * The lock's `maxDirectLoss` is the stake itself: §7.3 forfeits an abandoned stake
 * to the other parties, so it genuinely can be lost and EXPOSURE must say so.
 */
export function lockFillStake(
  ledger: Ledger,
  args: {
    readonly venture: VentureRecord;
    readonly role: VentureRoleRecord;
    readonly principal: PrincipalId;
    readonly stores: AccountId;
    readonly stake: Minor;
    readonly eventId: EventId;
    readonly tick: number;
  },
): string | null {
  if (args.stake <= 0) return null;
  const id = ledger.encumbrances.lock({
    eventId: args.eventId,
    tick: args.tick,
    principal: args.principal,
    account: args.stores,
    amountMinor: args.stake,
    obligationRef: args.venture.id,
    maxDirectLoss: args.stake,
  });
  args.role.stakeEncumbranceId = id;
  return id;
}

function settlementLine(
  venture: VentureRecord,
  outcome: ResolutionKind,
  terminal: VentureSettlement['terminalState'],
  payouts: readonly RolePayout[],
): string {
  const broken = payouts.filter((p) => p.electiveShortfall > 0);
  const head = `${venture.kind} ${venture.id} ${outcome} -> ${terminal}`;
  if (broken.length === 0) return head.slice(0, 140);
  const names = broken.map((p) => `${p.label}`).join(', ');
  return `${head}; elective unpaid to ${names}`.slice(0, 140);
}
