/**
 * Sovereignty's one book. Every figure the mechanic owns lives here and nowhere else.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **ONE HOME PER QUANTITY** (scar #5), and the Levy's own header says why: two homes for
 * "what this claim owes tonight" would be two answers to "did it pay", and the wrong one
 * becomes a permanent public accusation — an arrears, and then a lapse (A5′).
 *
 * Stored: the claims, the per-**system** delinquency counter, the plans, the assessment
 * lines, the delivery journal, the ballots, the published cession offers, the recorded
 * shortfalls, and the bond lock ids.
 *
 * Derived every time it is asked for: what is *owed* ({@link Book.owingOf}), the claim's
 * public legal state ({@link Book.stateOf}), and the posted bond — which is derived from
 * the **ledger**, because the amount behind a lock is the ledger's fact and a copy here
 * would drift the moment a slash reduced one.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## Delinquency attaches to the SYSTEM, not to the claimant
 *
 * The economic critic's §5 exploit table names it: *"Transfer/cede/reclaim after first
 * arrears to reset the consecutive-miss counter"*, closed by *"delinquency follows the
 * anchor/system epoch"*. So {@link Book.missesAt} is keyed on `SystemId` and a claim
 * changing hands does not touch it. `ClaimRecord.epoch` counts how many times the system
 * has been claimed, which is what makes an id unique across re-claims without making the
 * arrears count part of the id.
 *
 * ## Keys use `::`, never a NUL byte
 *
 * A NUL in a source file makes `file(1)` report it as `data` and every grep-based guard
 * in this repo — including the outbound secret scan — silently stops covering the file
 * while tsc, eslint and vitest all stay green. Three agents have shipped one.
 */

import type { CanonicalValue } from '../core/canonical.js';
import { reckoningIndex } from '../core/time.js';
import type { ClaimState, ConstellationId, PrincipalId, SystemId } from '../core/types.js';
import { bps, minor, qty, type Bps, type Minor, type Qty } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import {
  readArray,
  readInt,
  readObject,
  readString,
  SnapshotError,
  type StateTable,
} from '../tick/snapshot.js';
import {
  CLAIM_RENT_BPS,
  MAX_CHARGE_BALLOTS,
  MAX_CLAIMS,
  SOVEREIGNTY_RETAINED_RECKONINGS,
} from './params.js';

/** The key separator. `::`, for the reason in this file's header. */
const SEP = '::';

export type ClaimId = string & { readonly __brand: 'ClaimId' };

/**
 * The prefix a bond lock's `obligationRef` carries.
 *
 * One home for the spelling, because two places construct it — `post_bond` when it opens the
 * lock, and {@link Book.isLive} when INV-4 asks whether the lock is an orphan — and a
 * mismatch between them halts the tick on the most ordinary act in the mechanic. It did.
 */
const BOND_REF_PREFIX = 'bond:';

/** The obligation ref a principal's bond locks name. `post_bond` and INV-4's one source. */
export function bondRefFor(principal: PrincipalId): string {
  return `${BOND_REF_PREFIX}${principal}`;
}

/** `claim:<system>:<epoch>`. The epoch is the system's claim ordinal, never its arrears. */
export function claimIdFor(system: SystemId, epoch: number): ClaimId {
  return `claim:${system}:${String(epoch)}` as ClaimId;
}

/**
 * A claim's public legal state, **re-exported from `core/types.ts` and not redeclared here.**
 *
 * `SUPPLIED · STRAINED · CONTESTED` are the live ladder; `LAPSED · CEDED` are terminal. The
 * argument for where it lives is on the declaration: the book and the frame's claim line are
 * two rules surfaces needing the same five words, and `predation/book.ts` re-exports
 * `RaidState` from `core/types.ts` for the identical reason. A second copy here would put one
 * pixel signature in two places, which `test/core/vocabulary-repo.test.ts` catches as a word
 * doing two jobs — and it would be right to.
 */
export type { ClaimState };

const CLAIM_STATES: readonly ClaimState[] = Object.freeze([
  'SUPPLIED',
  'STRAINED',
  'CONTESTED',
  'LAPSED',
  'CEDED',
]);

export function isClaimState(s: string): s is ClaimState {
  return (CLAIM_STATES as readonly string[]).includes(s);
}

export interface ClaimRecord {
  readonly id: ClaimId;
  readonly system: SystemId;
  readonly constellation: ConstellationId;
  claimant: PrincipalId;
  /** How many times this system has been claimed. Part of the id; never the arrears. */
  readonly epoch: number;
  readonly takenAtTick: number;
  /** Units of {@link import('./params.js').CHARGE_GOOD} destroyed to raise the anchor. */
  readonly anchorQty: Qty;
  /**
   * The share of extraction at this system the claimant takes, in bps. **A term, not a knob.**
   *
   * Pinned on the record rather than read from {@link import('./params.js').CLAIM_RENT_BPS} at
   * collection time, and the two reasons are different in kind:
   *
   *   - **A tenant read this rate before it spent 60,000 raising a WORKS here.** A rate that
   *     could move under a standing structure — because the constant changed, or because the
   *     claim changed hands — would make `worksQuote`'s published return a number the engine
   *     later disagreed with, which is scar #1 with the agent's capital on the end of it. A
   *     takeover therefore inherits the rate along with the arrears.
   *   - **Replay.** The rate is an input to a value-moving event every tick. A constant read
   *     live would make `(snapshot, action_log, seed) → snapshot` depend on the engine version
   *     rather than on the log, and the divergence would appear at the first extraction after
   *     any tuning pass.
   *
   * `readonly`, so nothing in the engine can raise it on a sitting tenant by accident.
   */
  readonly rentBps: Bps;
  /** The lock the claim's bond requirement is satisfied out of. Slashed on lapse. */
  bondEncumbranceId: string | null;
  state: ClaimState;
  /** Set once, when the claim reaches a terminal state. The obituary's timestamp. */
  endedAtReckoning: number | null;
  /** The principal the claim was handed to, when it was. Null on a lapse. */
  succeededBy: PrincipalId | null;
}

/** One system's consecutive-miss counter. **Attached to the place, not the holder.** */
export interface DelinquencyRow {
  readonly system: SystemId;
  misses: number;
  lastShortReckoning: number | null;
  /** Lifetime lapses at this place. History, for the ruin and the ticker. */
  lapses: number;
}

/** How the Charge total is borne. The ballot picks one; quorum failure picks the default. */
export type ChargeRule = 'EVEN' | 'BY_CLAIMS' | 'BY_TIER';

const CHARGE_RULES: readonly ChargeRule[] = Object.freeze(['EVEN', 'BY_CLAIMS', 'BY_TIER']);

export function isChargeRule(raw: string): raw is ChargeRule {
  return (CHARGE_RULES as readonly string[]).includes(raw);
}

/** One claim's assessment line for one Reckoning: what it owes, and why that number. */
export interface ChargeLine {
  readonly claim: ClaimId;
  readonly system: SystemId;
  readonly claimant: PrincipalId;
  /** The rule-fixed part: the tier amount plus any arrears surcharge. */
  readonly ruleQty: Qty;
  /** What the vote actually assessed. Σ over the plan is exactly the plan total (SOV-4). */
  readonly amount: Qty;
  /** True iff the constellation voted to spare this claimant down to the nominal share. */
  readonly spared: boolean;
  /** Arrears the claim carried when it was assessed. Recorded, never re-derived. */
  readonly missesAtAssessment: number;
  readonly weight: number;
}

/** One constellation's Charge plan for one Reckoning. Minted once, never edited. */
export interface ChargePlan {
  readonly reckoning: number;
  readonly constellation: ConstellationId;
  readonly total: Qty;
  readonly rule: ChargeRule;
  readonly spared: PrincipalId | null;
  readonly byDefault: boolean;
  readonly lines: readonly ChargeLine[];
  readonly assessedAtTick: number;
}

/**
 * What has actually been delivered against one **system's** Charge. The audit trail.
 *
 * ## Why this is keyed on the system and not on the claim (A5′)
 *
 * The Charge is a duty on *territory*, which is what makes "a transfer never resets the
 * arrears" true. Everything else in the module already agreed with that — `missesAt`,
 * `liveAt` and `claims` are all keyed on `SystemId`, and settlement resolves the payer by
 * calling `liveAt(line.system)`. The payment row was the one exception, and the mismatch
 * was reachable: abandon a claim mid-Reckoning and re-take the same system, and the new
 * claim carries a new {@link ClaimId}, so an assessment keyed on the old id was invisible
 * to the new claim's own `observe` while settlement still billed it.
 *
 * The agent was shown `if_you_do_nothing: STAYS_SUPPLIED`, took no action because it had
 * been told it was current, and then lapsed with its bond slashed. That is A5′ — the
 * record was not merely unhelpful, it was **wrong** — and it is the consequence-preview
 * field, the one High Water shipped as `projectedDrown` precisely because an agent plans
 * against it. Keying the duty on the system makes the view, the settlement and the credit
 * read the same row by construction rather than by three call sites agreeing.
 */
export interface ChargePayment {
  readonly reckoning: number;
  readonly system: SystemId;
  paid: Qty;
  /** Deliveries credited, including third-party ones. Bounded by the assessment. */
  deliveries: number;
}

/** A Charge shortfall as the record carries it: the arithmetic, not just the answer. */
export interface ChargeShortfallRow {
  readonly reckoning: number;
  readonly claim: ClaimId;
  readonly system: SystemId;
  readonly claimant: PrincipalId;
  readonly assessment: Qty;
  readonly paid: Qty;
  readonly owed: Qty;
  /** Misses **after** this settlement recorded its verdict. */
  readonly misses: number;
  readonly state: ClaimState;
  /** What the lapse actually slashed, or zero. Never the bond requirement. */
  readonly slashed: Minor;
}

export interface ChargeBallot {
  readonly principal: PrincipalId;
  readonly constellation: ConstellationId;
  readonly forReckoning: number;
  readonly rule: ChargeRule;
  readonly spare: PrincipalId | null;
  readonly tick: number;
}

/**
 * A published offer to hand a claim over. **The fire sale, and it is `PUBLIC` on purpose.**
 *
 * `DRAFT-2-synthesis.md` §2: *"a way for a failing claimant to sell or transfer a claim
 * before it lapses — so the ending is a fire sale or a rescue, which is a story, rather
 * than a cliff."* A story needs an audience, so the offer is on the feed the moment it is
 * made: a viewer watches a strained claimant put its frontier up for sale and watches who
 * turns up. Nothing in the offer is a stockpile fact — it is a price and a place.
 */
export interface CessionOffer {
  readonly system: SystemId;
  readonly claim: ClaimId;
  readonly by: PrincipalId;
  readonly price: Minor;
  readonly openedAtTick: number;
}

export class SovereigntyBookError extends Error {}

export class Book {
  private readonly claims = new Map<SystemId, ClaimRecord>();
  private readonly delinquency = new Map<SystemId, DelinquencyRow>();
  private readonly plans = new Map<string, ChargePlan>();
  private readonly payments = new Map<string, ChargePayment>();
  private readonly ballots = new Map<string, ChargeBallot>();
  private readonly shortfalls = new Map<string, ChargeShortfallRow>();
  private readonly cessions = new Map<SystemId, CessionOffer>();
  /** Bond locks per principal, in canonical id order. The **amounts** live in the ledger. */
  private readonly bondLocks = new Map<PrincipalId, string[]>();
  /** How many times each system has been claimed. Monotonic; never pruned. */
  private readonly epochs = new Map<SystemId, number>();
  /** Reckonings whose Charge has already settled. Idempotence, and SOV-6's shape. */
  private readonly settled = new Set<number>();

  // ── claims ────────────────────────────────────────────────────────────────

  /**
   * Record a claim. Refuses a second live claim on one system.
   *
   * A system with two claimants is a sovereignty with two answers, and every downstream
   * figure — the Charge, the arrears, the bond at risk — would then have two homes.
   */
  take(record: ClaimRecord): void {
    const live = this.claims.get(record.system);
    if (live !== undefined && !isTerminal(live.state)) {
      throw new SovereigntyBookError(
        `${record.system} is already claimed by ${live.claimant} (${live.state}); a system has one claimant`,
      );
    }
    if (live === undefined && this.claims.size >= MAX_CLAIMS) {
      throw new SovereigntyBookError(`the claim book is at its declared cap of ${String(MAX_CLAIMS)} (INV-26)`);
    }
    this.claims.set(record.system, record);
    this.epochs.set(record.system, record.epoch);
  }

  /** The next epoch for a system. One more than the highest it has ever carried. */
  nextEpochFor(system: SystemId): number {
    return (this.epochs.get(system) ?? 0) + 1;
  }

  /** The claim standing on a system, terminal or not. `null` if it was never claimed. */
  at(system: SystemId): ClaimRecord | null {
    return this.claims.get(system) ?? null;
  }

  /** The **live** claim on a system, or null. What every gate asks. */
  liveAt(system: SystemId): ClaimRecord | null {
    const claim = this.claims.get(system);
    if (claim === undefined || isTerminal(claim.state)) return null;
    return claim;
  }

  byId(id: ClaimId): ClaimRecord | null {
    for (const claim of this.claimsInOrder()) if (claim.id === id) return claim;
    return null;
  }

  /** Every claim in the book, canonical order. Terminal ones included. */
  claimsInOrder(): readonly ClaimRecord[] {
    return [...this.claims.values()].sort((a, b) => compareIds(a.system, b.system));
  }

  /** Live claims only, canonical order. The set the Charge assesses. */
  liveClaims(): readonly ClaimRecord[] {
    return this.claimsInOrder().filter((c) => !isTerminal(c.state));
  }

  /** Live claims held by one principal. `requiredBondOf` counts these. */
  claimsOf(principal: PrincipalId): readonly ClaimRecord[] {
    return this.liveClaims().filter((c) => c.claimant === principal);
  }

  /** Live claims in one constellation, canonical order. The Charge plan's roll. */
  claimsIn(constellation: ConstellationId): readonly ClaimRecord[] {
    return this.liveClaims().filter((c) => c.constellation === constellation);
  }

  /** Constellations with at least one live claim, canonical order. */
  claimedConstellations(): readonly ConstellationId[] {
    const out = new Set<ConstellationId>();
    for (const claim of this.liveClaims()) out.add(claim.constellation);
    return [...out].sort(compareIds);
  }

  /**
   * Hand a live claim to a new claimant. **The arrears do not move, because they are the
   * system's.**
   *
   * The new claimant inherits the state it inherits: a `CONTESTED` claim taken over is
   * still `CONTESTED` until a Charge is paid in full, which is what closes the critic's
   * *"transfer to reset the consecutive-miss counter"* exploit at the one place it could
   * be opened.
   */
  succeed(system: SystemId, to: PrincipalId, bondEncumbranceId: string | null): ClaimRecord {
    const claim = this.liveAt(system);
    if (claim === null) throw new SovereigntyBookError(`there is no live claim on ${system} to hand over`);
    claim.claimant = to;
    claim.bondEncumbranceId = bondEncumbranceId;
    this.cessions.delete(system);
    return claim;
  }

  /** End a claim. Terminal, and the state says which ending it was. */
  end(system: SystemId, state: Extract<ClaimState, 'LAPSED' | 'CEDED'>, reckoning: number, to: PrincipalId | null): void {
    const claim = this.claims.get(system);
    if (claim === undefined) throw new SovereigntyBookError(`there is no claim on ${system} to end`);
    claim.state = state;
    claim.endedAtReckoning = reckoning;
    claim.succeededBy = to;
    claim.bondEncumbranceId = null;
    this.cessions.delete(system);
  }

  /** Set a live claim's public legal state. Called only by settlement. */
  setState(system: SystemId, state: ClaimState): void {
    const claim = this.claims.get(system);
    if (claim === undefined) throw new SovereigntyBookError(`there is no claim on ${system}`);
    claim.state = state;
  }

  // ── delinquency, which belongs to the system ──────────────────────────────

  delinquencyAt(system: SystemId): DelinquencyRow {
    const row = this.delinquency.get(system);
    if (row !== undefined) return row;
    const fresh: DelinquencyRow = { system, misses: 0, lastShortReckoning: null, lapses: 0 };
    this.delinquency.set(system, fresh);
    return fresh;
  }

  missesAt(system: SystemId): number {
    return this.delinquency.get(system)?.misses ?? 0;
  }

  /**
   * A Reckoning ended with this system short. Returns the new consecutive-miss count.
   *
   * Misses must be **consecutive** — a Charge paid in full resets them — because the
   * whole arc is about a claim that is *currently* failing. A counter that never reset
   * would lapse a claim for one bad night three Reckonings ago, which is the Levy's
   * `chronic` argument applied to a mechanic that takes territory rather than capacity.
   */
  miss(system: SystemId, reckoning: number): number {
    const row = this.delinquencyAt(system);
    row.misses =
      row.lastShortReckoning === reckoning - 1 || row.lastShortReckoning === null
        ? row.misses + 1
        : 1;
    row.lastShortReckoning = reckoning;
    return row.misses;
  }

  /** A Charge was discharged in full. The arrears clear completely. */
  clearMisses(system: SystemId): void {
    const row = this.delinquencyAt(system);
    row.misses = 0;
    row.lastShortReckoning = null;
  }

  recordLapse(system: SystemId): void {
    const row = this.delinquencyAt(system);
    row.lapses += 1;
    row.misses = 0;
    row.lastShortReckoning = null;
  }

  // ── assessment ────────────────────────────────────────────────────────────

  /**
   * Record a constellation's Charge plan.
   *
   * Refuses a second plan for the same pair rather than replacing it: an assessment does
   * not move once minted, and a silent replace would let a later tick re-bill a claim
   * that had already delivered — the Levy's `assess` makes the same refusal for the same
   * reason (A5′).
   */
  assess(plan: ChargePlan): void {
    const key = pairKey(plan.reckoning, plan.constellation);
    if (this.plans.has(key)) {
      throw new SovereigntyBookError(
        `${plan.constellation} already holds a Charge plan for Reckoning ${String(plan.reckoning)}; an ` +
          'assessment never moves once minted, or a claim can be re-billed for goods it already handed over',
      );
    }
    this.plans.set(key, plan);
  }

  isAssessed(reckoning: number, constellation: ConstellationId): boolean {
    return this.plans.has(pairKey(reckoning, constellation));
  }

  planFor(reckoning: number, constellation: ConstellationId): ChargePlan | null {
    return this.plans.get(pairKey(reckoning, constellation)) ?? null;
  }

  plansIn(reckoning: number): readonly ChargePlan[] {
    return [...this.plans.values()]
      .filter((p) => p.reckoning === reckoning)
      .sort((a, b) => compareIds(a.constellation, b.constellation));
  }

  /**
   * The assessment line for one **system**, or null if it holds none this Reckoning.
   *
   * Keyed on the system for the reason {@link ChargePayment} gives in full: the duty is
   * territorial, a plan mints at most one line per system per Reckoning, and a claim id
   * changes under abandon-and-retake while the duty does not.
   */
  lineFor(reckoning: number, system: SystemId): { readonly plan: ChargePlan; readonly line: ChargeLine } | null {
    for (const plan of this.plansIn(reckoning)) {
      for (const line of plan.lines) {
        if (line.system === system) return { plan, line };
      }
    }
    return null;
  }

  assessmentOf(reckoning: number, system: SystemId): Qty {
    return this.lineFor(reckoning, system)?.line.amount ?? qty(0);
  }

  /** Every line this principal is the claimant on, canonical order. */
  linesFor(reckoning: number, principal: PrincipalId): readonly ChargeLine[] {
    const out: ChargeLine[] = [];
    for (const plan of this.plansIn(reckoning)) {
      for (const line of plan.lines) if (line.claimant === principal) out.push(line);
    }
    return out.sort((a, b) => compareIds(a.system, b.system));
  }

  // ── payment ───────────────────────────────────────────────────────────────

  /**
   * What has been paid against one Charge. **A READ, and it used to be a write.**
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THIS INSERTED A ZERO ROW INTO A HASHED MAP, SO *ASKING* CHANGED `state_hash`.**
   *
   * `payments` is inside `capture()` — deliberately, and the note there is right about why. But
   * this method lazily `set` the row it did not find, so any caller that merely *looked* at a
   * (reckoning, system) pair with no delivery against it permanently altered the world's hash. The
   * state then depended on **which reads had happened**, not on what the world had done, and that
   * is DET-1 failing in the one direction nothing else can catch: both worlds are internally
   * consistent and each one's arithmetic is correct.
   *
   * Found by `test/durability/checkpoint-adoption.test.ts`'s crossing case, which is exactly the
   * shape that exposes it. `settle.ts` reads a payment for every shortfall row, so a claim that
   * paid nothing in Reckoning 0 got `{"reckoning":0,"system":"sys-07","paid":0,"deliveries":0}`
   * written into the book at that settlement. A genesis replay re-runs that settlement and writes
   * it again; an adopted boot replays only the tail, never re-runs it, and diverges by one row for
   * the rest of the world's life. The two hashes were `9be64f49…` and `ecb61c86…`.
   *
   * It had no subject until claims existed, which is why it has sat here undetected: with
   * `claimLines: 0` there were no shortfall rows to read. `levy/book.ts` carried the identical
   * defect and is fixed with it — that one is worse still, because the *frame renderer*
   * (`tribute.ts`) reads it, so drawing a picture of the world mutated it.
   *
   * The read now returns a **copy**, never the stored row, so no caller can write through it
   * either. {@link Book.paymentRowFor} is the writer's road and the only thing that inserts.
   * ══════════════════════════════════════════════════════════════════════════
   */
  paymentOf(reckoning: number, system: SystemId): ChargePayment {
    const row = this.payments.get(pairKey(reckoning, system));
    if (row === undefined) return { reckoning, system, paid: qty(0), deliveries: 0 };
    return { ...row };
  }

  /** The stored row, inserted if absent. **Writers only** — see {@link Book.paymentOf}. */
  private paymentRowFor(reckoning: number, system: SystemId): ChargePayment {
    const key = pairKey(reckoning, system);
    const row = this.payments.get(key);
    if (row !== undefined) return row;
    const fresh: ChargePayment = { reckoning, system, paid: qty(0), deliveries: 0 };
    this.payments.set(key, fresh);
    return fresh;
  }

  /**
   * What one Charge still owes. **The only shortfall arithmetic in the module.**
   *
   * Partial payment is the point (`DRAFT-2-synthesis.md` §2), so this is a subtraction
   * rather than an all-or-nothing predicate, and the number it returns is the number the
   * observation shows *before* the deadline and the number settlement records *after*.
   */
  owingOf(reckoning: number, system: SystemId): { readonly assessment: Qty; readonly paid: Qty; readonly owed: Qty } {
    const assessment = this.assessmentOf(reckoning, system);
    const paid = qty(Math.min(assessment, this.payments.get(pairKey(reckoning, system))?.paid ?? 0));
    return { assessment, paid, owed: qty(Math.max(0, assessment - paid)) };
  }

  /**
   * Credit a delivery. **The caller has already destroyed the goods.**
   *
   * The A5′ order, exactly as the Levy states it: the ledger moves first, then this is
   * called. A credit written before the goods moved would record a payment that did not
   * happen; a credit written after a failed destruction would record one that failed.
   */
  credit(reckoning: number, system: SystemId, amount: Qty): void {
    if (amount <= 0) return;
    const row = this.paymentRowFor(reckoning, system);
    row.paid = qty(row.paid + amount);
    row.deliveries += 1;
  }

  // ── ballots ───────────────────────────────────────────────────────────────

  /** Cast or restate a ballot. **Replaces**, never appends — one claimant, one ballot (A4). */
  castBallot(ballot: ChargeBallot): void {
    const key = pairKey(ballot.forReckoning, ballot.principal);
    if (!this.ballots.has(key) && this.ballots.size >= MAX_CHARGE_BALLOTS) {
      throw new SovereigntyBookError(
        `the Charge ballot book is at its declared cap of ${String(MAX_CHARGE_BALLOTS)} (INV-26)`,
      );
    }
    this.ballots.set(key, ballot);
  }

  hasVoted(forReckoning: number, principal: PrincipalId): boolean {
    return this.ballots.has(pairKey(forReckoning, principal));
  }

  ballotsFor(forReckoning: number, constellation: ConstellationId): readonly ChargeBallot[] {
    return [...this.ballots.values()]
      .filter((b) => b.forReckoning === forReckoning && b.constellation === constellation)
      .sort((a, b) => compareIds(a.principal, b.principal));
  }

  ballotsInOrder(): readonly ChargeBallot[] {
    return [...this.ballots.values()].sort(
      (a, b) =>
        a.forReckoning - b.forReckoning ||
        compareIds(a.constellation, b.constellation) ||
        compareIds(a.principal, b.principal),
    );
  }

  // ── cession offers ────────────────────────────────────────────────────────

  /** Publish or restate a cession offer. Replaces: one claim, one asking price. */
  offerCession(offer: CessionOffer): void {
    this.cessions.set(offer.system, offer);
  }

  cessionAt(system: SystemId): CessionOffer | null {
    return this.cessions.get(system) ?? null;
  }

  withdrawCession(system: SystemId): void {
    this.cessions.delete(system);
  }

  cessionsInOrder(): readonly CessionOffer[] {
    return [...this.cessions.values()].sort((a, b) => compareIds(a.system, b.system));
  }

  // ── bond locks ────────────────────────────────────────────────────────────

  /**
   * Register a bond lock. **Ids only: the amount is the ledger's fact.**
   *
   * A copy of the amount here would be a second home for posted capital, and a slash
   * reduces the ledger's row — so the copy would go on reporting a bond the world had
   * already taken. `bond.ts:postedBondOf` reads the ledger through a narrow port.
   */
  addBondLock(principal: PrincipalId, encumbranceId: string): void {
    const ids = this.bondLocks.get(principal) ?? [];
    if (ids.includes(encumbranceId)) return;
    ids.push(encumbranceId);
    ids.sort(compareIds);
    this.bondLocks.set(principal, ids);
  }

  bondLocksOf(principal: PrincipalId): readonly string[] {
    return this.bondLocks.get(principal) ?? [];
  }

  dropBondLock(principal: PrincipalId, encumbranceId: string): void {
    const ids = (this.bondLocks.get(principal) ?? []).filter((id) => id !== encumbranceId);
    if (ids.length === 0) this.bondLocks.delete(principal);
    else this.bondLocks.set(principal, ids);
  }

  principalsWithBond(): readonly PrincipalId[] {
    return [...this.bondLocks.keys()].sort(compareIds);
  }

  /**
   * Is this **obligation** still live? INV-4's question, answered for bond refs.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **IT TAKES THE OBLIGATION REF, NOT THE LOCK ID, AND THE FIRST VERSION TOOK THE LOCK
   * ID.** INV-4's clause is *"every encumbrance references a live obligation"*, so what it
   * hands this function is `Encumbrance.obligationRef` — `bond:p:brannock` — and a version
   * that searched the stored lock ids (`enc:bond:p:brannock:1:50000:0`) answered `false` for
   * every posted bond in the world. Measured: one `post_bond` in a four-member cast world
   * produced `INV-4 … locks 50000 for dead obligation bond:p:brannock` and **halted the tick**
   * — an agent-reachable halt (AGT-X9) from the most ordinary act in the mechanic.
   *
   * The market and predation both widened `isLive` the same way and both keyed it on the ref
   * the lock actually carries. This is that, plus the ref's spelling in one home
   * ({@link bondRefFor}) so `post_bond` and INV-4 cannot disagree about it — which is the
   * defect stated as a rule rather than as a memory.
   * ══════════════════════════════════════════════════════════════════════════
   *
   * A bond is *continuous* (§3), so it is live for exactly as long as the book lists a lock
   * for its principal. Answering from the book rather than registering it in
   * `SimpleObligationBook` is deliberate and is the market's argument: this book is a state
   * table, so an aborted tick's registration disappears with the rollback for free.
   */
  isLive(ref: string): boolean {
    if (!ref.startsWith(BOND_REF_PREFIX)) return false;
    const principal = ref.slice(BOND_REF_PREFIX.length) as PrincipalId;
    return (this.bondLocks.get(principal) ?? []).length > 0;
  }

  // ── shortfalls ────────────────────────────────────────────────────────────

  /**
   * File one Reckoning's verdict on one **system**.
   *
   * Keyed territorially like the assessment and the payment, and for the same reason: a
   * retake mints a new {@link ClaimId} while the duty stays put, so a verdict filed under
   * the claim id was invisible to INV-20's lookup by the assessed line — the mechanic's
   * own "no claim was silently skipped" check. The row still *names* the claim that was
   * short, because that is the fact the record publishes; only the key is the territory.
   */
  recordShortfall(row: ChargeShortfallRow): void {
    this.shortfalls.set(pairKey(row.reckoning, row.system), row);
  }

  shortfallOf(reckoning: number, system: SystemId): ChargeShortfallRow | null {
    return this.shortfalls.get(pairKey(reckoning, system)) ?? null;
  }

  shortfallsIn(reckoning: number): readonly ChargeShortfallRow[] {
    return [...this.shortfalls.values()]
      .filter((s) => s.reckoning === reckoning)
      .sort((a, b) => compareIds(a.system, b.system));
  }

  /** `CHARGE SHORT` for one Reckoning: Σ owed. The headline meter's sovereignty half. */
  shortFor(reckoning: number): Qty {
    let total = 0;
    for (const row of this.shortfallsIn(reckoning)) total += row.owed;
    return qty(total);
  }

  markSettled(reckoning: number): void {
    this.settled.add(reckoning);
  }

  isSettled(reckoning: number): boolean {
    return this.settled.has(reckoning);
  }

  // ── housekeeping ──────────────────────────────────────────────────────────

  /**
   * Forget Reckonings older than the retention window, and terminal claims with them.
   *
   * A season is 8,064 ticks and a row that is never removed is an array that only grows
   * (scar #3). Everything dropped here is already in the append-only event ledger, which
   * is the permanent record; this book is *state*, and state forgets. The **epoch** map
   * and the delinquency rows are deliberately not pruned: they are what makes a re-claim
   * inherit its place's history, and they are one integer per system.
   */
  prune(currentReckoning: number): number {
    const keepFrom = currentReckoning - SOVEREIGNTY_RETAINED_RECKONINGS;
    let dropped = 0;
    for (const [key, plan] of [...this.plans]) {
      if (plan.reckoning >= keepFrom) continue;
      this.plans.delete(key);
      dropped += 1;
    }
    for (const [key, row] of [...this.payments]) {
      if (row.reckoning >= keepFrom) continue;
      this.payments.delete(key);
      dropped += 1;
    }
    for (const [key, row] of [...this.shortfalls]) {
      if (row.reckoning >= keepFrom) continue;
      this.shortfalls.delete(key);
      dropped += 1;
    }
    for (const [key, ballot] of [...this.ballots]) {
      if (ballot.forReckoning >= keepFrom) continue;
      this.ballots.delete(key);
      dropped += 1;
    }
    for (const reckoning of [...this.settled]) {
      if (reckoning >= keepFrom) continue;
      this.settled.delete(reckoning);
      dropped += 1;
    }
    for (const [system, claim] of [...this.claims]) {
      if (!isTerminal(claim.state)) continue;
      if ((claim.endedAtReckoning ?? currentReckoning) >= keepFrom) continue;
      this.claims.delete(system);
      dropped += 1;
    }
    return dropped;
  }

  sizes(): Readonly<Record<string, number>> {
    return {
      claims: this.claims.size,
      claimDelinquency: this.delinquency.size,
      chargePlans: this.plans.size,
      chargePayments: this.payments.size,
      chargeBallots: this.ballots.size,
      chargeShortfalls: this.shortfalls.size,
      cessions: this.cessions.size,
      bondLocks: this.bondLocks.size,
    };
  }

  // ── serialisation ─────────────────────────────────────────────────────────

  capture(): CanonicalValue {
    return {
      claims: this.claimsInOrder().map((c) => ({
        id: c.id,
        system: c.system,
        constellation: c.constellation,
        claimant: c.claimant,
        epoch: c.epoch,
        takenAtTick: c.takenAtTick,
        anchorQty: c.anchorQty,
        rentBps: c.rentBps,
        bondEncumbranceId: c.bondEncumbranceId,
        state: c.state,
        endedAtReckoning: c.endedAtReckoning,
        succeededBy: c.succeededBy,
      })),
      delinquency: [...this.delinquency.values()]
        .sort((a, b) => compareIds(a.system, b.system))
        .map((d) => ({
          system: d.system,
          misses: d.misses,
          lastShortReckoning: d.lastShortReckoning,
          lapses: d.lapses,
        })),
      plans: [...this.plans.values()]
        .sort((a, b) => a.reckoning - b.reckoning || compareIds(a.constellation, b.constellation))
        .map((plan) => ({
          reckoning: plan.reckoning,
          constellation: plan.constellation,
          total: plan.total,
          rule: plan.rule,
          spared: plan.spared,
          byDefault: plan.byDefault,
          assessedAtTick: plan.assessedAtTick,
          lines: [...plan.lines]
            .sort((a, b) => compareIds(a.system, b.system))
            .map((line) => ({
              claim: line.claim,
              system: line.system,
              claimant: line.claimant,
              ruleQty: line.ruleQty,
              amount: line.amount,
              spared: line.spared,
              missesAtAssessment: line.missesAtAssessment,
              weight: line.weight,
            })),
        })),
      payments: [...this.payments.values()]
        .sort((a, b) => a.reckoning - b.reckoning || compareIds(a.system, b.system))
        .map((row) => ({
          reckoning: row.reckoning,
          system: row.system,
          paid: row.paid,
          deliveries: row.deliveries,
        })),
      ballots: this.ballotsInOrder().map((b) => ({
        principal: b.principal,
        constellation: b.constellation,
        forReckoning: b.forReckoning,
        rule: b.rule,
        spare: b.spare,
        tick: b.tick,
      })),
      shortfalls: [...this.shortfalls.values()]
        .sort((a, b) => a.reckoning - b.reckoning || compareIds(a.system, b.system))
        .map((row) => ({
          reckoning: row.reckoning,
          claim: row.claim,
          system: row.system,
          claimant: row.claimant,
          assessment: row.assessment,
          paid: row.paid,
          owed: row.owed,
          misses: row.misses,
          state: row.state,
          slashed: row.slashed,
        })),
      cessions: this.cessionsInOrder().map((o) => ({
        system: o.system,
        claim: o.claim,
        by: o.by,
        price: o.price,
        openedAtTick: o.openedAtTick,
      })),
      bondLocks: this.principalsWithBond().map((principal) => ({
        principal,
        ids: [...this.bondLocksOf(principal)],
      })),
      // Never pruned and inside the hash: the epoch decides a claim's id, and two worlds
      // that disagree about it would mint two ids for one thing — the `mint` table's
      // failure, in a book that names systems on a permanent public record.
      epochs: [...this.epochs.entries()]
        .sort((a, b) => compareIds(a[0], b[0]))
        .map(([system, epoch]) => ({ system, epoch })),
      settled: [...this.settled].sort((a, b) => a - b),
    };
  }

  restore(captured: CanonicalValue): void {
    const root = readObject(captured, 'sovereignty');
    this.claims.clear();
    this.delinquency.clear();
    this.plans.clear();
    this.payments.clear();
    this.ballots.clear();
    this.shortfalls.clear();
    this.cessions.clear();
    this.bondLocks.clear();
    this.epochs.clear();
    this.settled.clear();

    for (const [i, raw] of readArray(root['claims'] ?? [], 'sovereignty.claims').entries()) {
      const where = `sovereignty.claims[${String(i)}]`;
      const o = readObject(raw, where);
      const state = readString(o, 'state', where);
      if (!isClaimState(state)) throw new SnapshotError(`${where}: unknown claim state ${state}`);
      const record: ClaimRecord = {
        id: readString(o, 'id', where) as ClaimId,
        system: readString(o, 'system', where) as SystemId,
        constellation: readString(o, 'constellation', where) as ConstellationId,
        claimant: readString(o, 'claimant', where) as PrincipalId,
        epoch: readInt(o, 'epoch', where),
        takenAtTick: readInt(o, 'takenAtTick', where),
        anchorQty: qty(readInt(o, 'anchorQty', where)),
        // Tolerant on ONE field and for one reason: a snapshot written before the rent landed
        // has no rate on its claims, and the only honest answer for a claim raised under the
        // old rules is the published rate. Strictness here would refuse to restore the live
        // world across the deploy that introduces the field, which is a worse failure than a
        // documented default — and every claim raised after this lands writes the field.
        rentBps: o['rentBps'] === undefined ? CLAIM_RENT_BPS : bps(readInt(o, 'rentBps', where)),
        bondEncumbranceId: readStringOrNull(o, 'bondEncumbranceId', where),
        state,
        endedAtReckoning: readIntOrNullAt(o, 'endedAtReckoning', where),
        succeededBy: readStringOrNull(o, 'succeededBy', where) as PrincipalId | null,
      };
      this.claims.set(record.system, record);
    }

    for (const [i, raw] of readArray(root['delinquency'] ?? [], 'sovereignty.delinquency').entries()) {
      const where = `sovereignty.delinquency[${String(i)}]`;
      const o = readObject(raw, where);
      const row: DelinquencyRow = {
        system: readString(o, 'system', where) as SystemId,
        misses: readInt(o, 'misses', where),
        lastShortReckoning: readIntOrNullAt(o, 'lastShortReckoning', where),
        lapses: readInt(o, 'lapses', where),
      };
      this.delinquency.set(row.system, row);
    }

    for (const [i, raw] of readArray(root['plans'] ?? [], 'sovereignty.plans').entries()) {
      const where = `sovereignty.plans[${String(i)}]`;
      const o = readObject(raw, where);
      const rule = readString(o, 'rule', where);
      if (!isChargeRule(rule)) throw new SnapshotError(`${where}: unknown Charge rule ${rule}`);
      const lines = readArray(o['lines'] ?? [], `${where}.lines`).map((rawLine, j) => {
        const lineWhere = `${where}.lines[${String(j)}]`;
        const l = readObject(rawLine, lineWhere);
        const line: ChargeLine = {
          claim: readString(l, 'claim', lineWhere) as ClaimId,
          system: readString(l, 'system', lineWhere) as SystemId,
          claimant: readString(l, 'claimant', lineWhere) as PrincipalId,
          ruleQty: qty(readInt(l, 'ruleQty', lineWhere)),
          amount: qty(readInt(l, 'amount', lineWhere)),
          spared: readBool(l, 'spared', lineWhere),
          missesAtAssessment: readInt(l, 'missesAtAssessment', lineWhere),
          weight: readInt(l, 'weight', lineWhere),
        };
        return line;
      });
      const plan: ChargePlan = {
        reckoning: readInt(o, 'reckoning', where),
        constellation: readString(o, 'constellation', where) as ConstellationId,
        total: qty(readInt(o, 'total', where)),
        rule,
        spared: readStringOrNull(o, 'spared', where) as PrincipalId | null,
        byDefault: readBool(o, 'byDefault', where),
        lines,
        assessedAtTick: readInt(o, 'assessedAtTick', where),
      };
      this.plans.set(pairKey(plan.reckoning, plan.constellation), plan);
    }

    for (const [i, raw] of readArray(root['payments'] ?? [], 'sovereignty.payments').entries()) {
      const where = `sovereignty.payments[${String(i)}]`;
      const o = readObject(raw, where);
      const row: ChargePayment = {
        reckoning: readInt(o, 'reckoning', where),
        system: readString(o, 'system', where) as SystemId,
        paid: qty(readInt(o, 'paid', where)),
        deliveries: readInt(o, 'deliveries', where),
      };
      this.payments.set(pairKey(row.reckoning, row.system), row);
    }

    for (const [i, raw] of readArray(root['ballots'] ?? [], 'sovereignty.ballots').entries()) {
      const where = `sovereignty.ballots[${String(i)}]`;
      const o = readObject(raw, where);
      const rule = readString(o, 'rule', where);
      if (!isChargeRule(rule)) throw new SnapshotError(`${where}: unknown Charge rule ${rule}`);
      const ballot: ChargeBallot = {
        principal: readString(o, 'principal', where) as PrincipalId,
        constellation: readString(o, 'constellation', where) as ConstellationId,
        forReckoning: readInt(o, 'forReckoning', where),
        rule,
        spare: readStringOrNull(o, 'spare', where) as PrincipalId | null,
        tick: readInt(o, 'tick', where),
      };
      this.ballots.set(pairKey(ballot.forReckoning, ballot.principal), ballot);
    }

    for (const [i, raw] of readArray(root['shortfalls'] ?? [], 'sovereignty.shortfalls').entries()) {
      const where = `sovereignty.shortfalls[${String(i)}]`;
      const o = readObject(raw, where);
      const state = readString(o, 'state', where);
      if (!isClaimState(state)) throw new SnapshotError(`${where}: unknown claim state ${state}`);
      const row: ChargeShortfallRow = {
        reckoning: readInt(o, 'reckoning', where),
        claim: readString(o, 'claim', where) as ClaimId,
        system: readString(o, 'system', where) as SystemId,
        claimant: readString(o, 'claimant', where) as PrincipalId,
        assessment: qty(readInt(o, 'assessment', where)),
        paid: qty(readInt(o, 'paid', where)),
        owed: qty(readInt(o, 'owed', where)),
        misses: readInt(o, 'misses', where),
        state,
        slashed: minor(readInt(o, 'slashed', where)),
      };
      this.shortfalls.set(pairKey(row.reckoning, row.system), row);
    }

    for (const [i, raw] of readArray(root['cessions'] ?? [], 'sovereignty.cessions').entries()) {
      const where = `sovereignty.cessions[${String(i)}]`;
      const o = readObject(raw, where);
      const offer: CessionOffer = {
        system: readString(o, 'system', where) as SystemId,
        claim: readString(o, 'claim', where) as ClaimId,
        by: readString(o, 'by', where) as PrincipalId,
        price: minor(readInt(o, 'price', where)),
        openedAtTick: readInt(o, 'openedAtTick', where),
      };
      this.cessions.set(offer.system, offer);
    }

    for (const [i, raw] of readArray(root['bondLocks'] ?? [], 'sovereignty.bondLocks').entries()) {
      const where = `sovereignty.bondLocks[${String(i)}]`;
      const o = readObject(raw, where);
      const principal = readString(o, 'principal', where) as PrincipalId;
      const ids = readArray(o['ids'] ?? [], `${where}.ids`).map((id, j) => {
        if (typeof id !== 'string') throw new SnapshotError(`${where}.ids[${String(j)}] must be a string`);
        return id;
      });
      this.bondLocks.set(principal, [...ids].sort(compareIds));
    }

    for (const [i, raw] of readArray(root['epochs'] ?? [], 'sovereignty.epochs').entries()) {
      const where = `sovereignty.epochs[${String(i)}]`;
      const o = readObject(raw, where);
      this.epochs.set(readString(o, 'system', where) as SystemId, readInt(o, 'epoch', where));
    }

    for (const raw of readArray(root['settled'] ?? [], 'sovereignty.settled')) {
      if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) {
        throw new SnapshotError('sovereignty.settled holds a non-integer Reckoning index');
      }
      this.settled.add(raw);
    }
  }
}

/** Terminal states end a claim. A terminal claim is not on the roll and owes nothing. */
export function isTerminal(state: ClaimState): boolean {
  return state === 'LAPSED' || state === 'CEDED';
}

function pairKey(reckoning: number, id: string): string {
  return `${String(reckoning)}${SEP}${id}`;
}

function readBool(o: Readonly<Record<string, CanonicalValue>>, key: string, where: string): boolean {
  const value = o[key];
  if (typeof value !== 'boolean') throw new SnapshotError(`${where}.${key} must be a boolean`);
  return value;
}

function readStringOrNull(
  o: Readonly<Record<string, CanonicalValue>>,
  key: string,
  where: string,
): string | null {
  const value = o[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new SnapshotError(`${where}.${key} must be a string or null`);
  return value;
}

function readIntOrNullAt(
  o: Readonly<Record<string, CanonicalValue>>,
  key: string,
  where: string,
): number | null {
  const value = o[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new SnapshotError(`${where}.${key} must be an integer or null`);
  }
  return value;
}

/**
 * Sovereignty as a state table.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **REGISTERED UNCONDITIONALLY, AND THAT IS LOAD-BEARING.** Seven books were found
 * outside the hash on one night, one of them `StandingBook`, and the measured symptom was
 * a snapshot that matched byte-for-byte while reputation silently reset. This book is
 * strictly worse to lose than that one: a claim decides who holds territory, an arrears
 * counter decides whether the *next* Reckoning lapses a claim and slashes a bond, and a
 * bond lock id is the only thing that says which capital is at risk. A `state_hash` blind
 * to it would call two worlds identical while one of them was about to take a principal's
 * frontier and 50,000 of its capital — and an aborted tick would leave a credited Charge
 * delivery, or a half-slashed bond, behind.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `getBook`/`setBook` rather than a captured reference, for the Levy's reason: the
 * rollback **replaces** the object, and every reader must go through the accessor or half
 * the engine keeps talking to the pre-abort book.
 */
export function sovereigntyStateTable(getBook: () => Book, setBook: (book: Book) => void): StateTable {
  return {
    name: 'sovereignty',
    capture(): CanonicalValue {
      return getBook().capture();
    },
    restore(captured: CanonicalValue): void {
      const fresh = new Book();
      fresh.restore(captured);
      setBook(fresh);
    },
  };
}

/** The Reckoning index a tick sits in. One home, so the book and the clock agree. */
export function chargeReckoningOf(tick: number): number {
  return reckoningIndex(tick);
}
