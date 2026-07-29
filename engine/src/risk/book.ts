/**
 * The risk book — fronts, covers, indemnities, and the record.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ## ★ WHEN ROWS LEAVE THIS BOOK, STATED FIRST AND LOUDLY
 *
 * `Book.prune` has silently destroyed a load-bearing row **five times** in this repo and *"every one
 * failed in the direction that hides"*. A COVER is the worst exposure to that this engine has yet
 * built, because it is the first object designed to **outlive several RECKONINGS**: offered before a
 * CONE exists, seasoned over a waiting period, and paid at a settlement two Reckonings after it was
 * signed. So the rule is written here rather than discovered later:
 *
 *   1. **A live COVER is never pruned. At any age, at any book size.** `CampaignBook` established
 *      this shape; the difference is what happens when the book is full. `CampaignBook` has its cap
 *      in `add` and this one does too — {@link RiskBook.addCover} **refuses the insert** rather than
 *      dropping the oldest row. A refusal at the door is a rejection an agent reads; a drop at the
 *      back is a promise that stops existing.
 *   2. **A terminal COVER and its INDEMNITY are dropped {@link RISK_RETAINED_RECKONINGS} Reckonings
 *      after they resolve, and only then.** By that point the receipt is in the append-only `event`
 *      ledger, so what leaves is a projection and never the record (§15.1).
 *   3. **{@link RiskRecord} is keyed by `PrincipalId` alone and is never pruned, cleared, capped or
 *      ringed.** It is RSK7's actuarial ledger and it is a *running total*, which
 *      `ledger/endowment.ts` identifies as *"exactly the state a prune window or a per-Reckoning
 *      reset destroys"*. Bounded by the principal roll, which never shrinks because identity is
 *      never deleted (A10).
 *   4. **Absent means the conservative answer.** An absent record row is `UNSEASONED` — RSK7's own
 *      word — never "clean". A row a prune ate, a restore dropped or an enrolment forgot therefore
 *      reverts a principal to *no history*, which is a visible loss of standing rather than a silent
 *      gain of it. `EndowmentBook` calls this *"the property that makes the whole structure safe
 *      against its own bugs"*, and it is the reason this book can be wrong without being dangerous.
 *
 * **Would a test notice a row clearing early?** Yes, by two roads, both named so the claim is
 * checkable rather than reassuring:
 *
 *   - `test/risk/retention.spec.ts` drives one COVER across `RISK_RETAINED_RECKONINGS + 1`
 *     Reckonings — *past* the window — and asserts it still pays. That is the test the
 *     `LEVY_RETAINED_RECKONINGS` incident did not have.
 *   - the same file mutation-deletes a live cover row mid-chain and asserts an **INV-R halt**, not a
 *     silent non-payment. `checkRiskInvariants` recomputes every open INDEMNITY against its cover, so
 *     a missing cover is a halt rather than an indemnity that quietly owes nothing.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { CanonicalValue } from '../core/canonical.js';
import { TICKS_PER_RECKONING } from '../core/time.js';
import type { GoodId, PrincipalId, SystemId } from '../core/types.js';
import { addMinor, minor, type Minor } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import {
  isLiveCover,
  type CoverId,
  type CoverRecord,
  type CoverState,
} from './cover.js';
import type { FrontId, FrontRecord } from './front.js';
import type { IndemnityId, IndemnityRecord } from './indemnity.js';
import {
  MAX_COVERS,
  MAX_COVERS_PER_PAYER,
  MAX_FRONTS,
  MAX_INDEMNITIES,
  RISK_RETAINED_RECKONINGS,
} from './params.js';

export class RiskBookError extends Error {}

/**
 * RSK7's decomposed record — *"never one opaque grade"*.
 *
 * ⚑ **This is NOT §6.4's STANDING, and the distinction is deliberate rather than a shortcut.**
 * STANDING is *"the public factual vectors"* written by `reckoning/standing.ts`, which is *"the only
 * writer of standing (INV-21)"*, whose `StandingDelta.venture` field is typed `VentureId`, and whose
 * journal check asserts every `DEFAULT` change cites a row in the venture-scoped `DefaultRegister`.
 * Pushing a `CoverId` through that field would be one word naming two concepts inside the type
 * system — the exact collision §3 exists to prevent — and satisfying the journal check would mean
 * minting a fake venture default.
 *
 * So a risk default **does not yet move §6.4 STANDING**, and that is a named gap rather than an
 * oversight: closing it needs `StandingDelta`'s subject widened to `VentureId | CoverId`, the
 * `DefaultRegister` widened with it, and `checkStandingJournal` taught the second shape. Three
 * coupled invariants in `src/reckoning/`, which is a separate change with a separate risk.
 *
 * What exists here instead is what RSK7 actually asks for and STANDING does not provide: *"exposure-
 * years, premiums/limits, expected versus realized frequency/severity, on-time/late/defaulted
 * claims"*. Six counters, all integers, all per-principal, never pruned.
 */
export interface RiskRecord {
  readonly principal: PrincipalId;
  /** COVERS this principal has written and bound. RSK7's exposure denominator. */
  written: number;
  /** Σ limits written. What it has promised, ever. */
  limitWritten: Minor;
  /** Σ premiums earned. */
  premiumEarned: Minor;
  /** INDEMNITIES whose elective half it paid in full. */
  honoured: number;
  /** INDEMNITIES whose elective half it left short. */
  defaulted: number;
  /** Σ of the amounts it left short. The number a counterparty prices. */
  defaultedValue: Minor;
  /** Σ escrowed + elective actually paid out. What it has honoured, in money. */
  paidOut: Minor;
}

const ZERO_RECORD = (principal: PrincipalId): RiskRecord => ({
  principal,
  written: 0,
  limitWritten: minor(0),
  premiumEarned: minor(0),
  honoured: 0,
  defaulted: 0,
  defaultedValue: minor(0),
  paidOut: minor(0),
});

export class RiskBook {
  private readonly fronts = new Map<FrontId, FrontRecord>();
  private readonly covers = new Map<CoverId, CoverRecord>();
  private readonly indemnities = new Map<IndemnityId, IndemnityRecord>();
  /** Never pruned. See the header, rule 3. */
  private readonly records = new Map<PrincipalId, RiskRecord>();
  /**
   * CAT6's conserved interest registry: `payee::system::good` → the live COVER over it.
   *
   * A map rather than a scan, because the check runs on every bind and a scan over `MAX_COVERS`
   * would make the cost of binding grow with the book — which is how a gate stops being a gate.
   */
  private readonly interests = new Map<string, CoverId>();
  /** Terminal rows and the reckoning they resolved in, for the retention window. */
  private readonly resolvedAt = new Map<string, number>();

  // ── Fronts ────────────────────────────────────────────────────────────────

  addFront(front: FrontRecord): void {
    if (this.fronts.size >= MAX_FRONTS && !this.fronts.has(front.id)) {
      throw new RiskBookError(
        `the risk book holds ${String(MAX_FRONTS)} fronts and prune has not run`,
      );
    }
    this.fronts.set(front.id, front);
  }

  front(id: FrontId): FrontRecord | undefined {
    return this.fronts.get(id);
  }

  /** Canonical order, always. A `Map` iteration order is insertion order and that is not a rule. */
  allFronts(): readonly FrontRecord[] {
    return [...this.fronts.values()].sort((a, b) => compareIds(a.id, b.id));
  }

  /** The one front an agent needs to read now: unstruck, or struck this Reckoning. */
  liveFronts(tick: number): readonly FrontRecord[] {
    return this.allFronts().filter(
      (f) => f.struckAtTick === null || f.struckAtTick >= tick - TICKS_PER_RECKONING,
    );
  }

  // ── Covers ────────────────────────────────────────────────────────────────

  /**
   * Insert a COVER. **Refuses when full; never drops.** See the header, rule 1.
   *
   * Two caps, and the per-payer one is the load-bearing half: without it one principal could fill the
   * whole book with offers nobody will take and shut the market for everyone, which is a denial of
   * service priced in nothing but actions.
   */
  addCover(cover: CoverRecord): void {
    if (this.covers.has(cover.id)) throw new RiskBookError(`cover ${cover.id} is already in the book`);
    if (this.covers.size >= MAX_COVERS) {
      throw new RiskBookError(
        `the risk book holds ${String(MAX_COVERS)} covers. A live COVER is never dropped to make ` +
          'room — a promise that stops existing is worse than a promise refused — so this is refused.',
      );
    }
    const mine = this.coversBy(cover.payer).filter((c) => isLiveCover(c.state)).length;
    if (mine >= MAX_COVERS_PER_PAYER) {
      throw new RiskBookError(
        `${cover.payer} already has ${String(MAX_COVERS_PER_PAYER)} live COVERS, which is the limit ` +
          'per payer.',
      );
    }
    this.covers.set(cover.id, cover);
  }

  cover(id: CoverId): CoverRecord | undefined {
    return this.covers.get(id);
  }

  requireCover(id: CoverId): CoverRecord {
    const hit = this.covers.get(id);
    if (hit === undefined) {
      throw new RiskBookError(
        `cover ${id} is not in the book. An INDEMNITY whose COVER has vanished is a promise the ` +
          'engine cannot price, and halting is the only honest answer (A5′).',
      );
    }
    return hit;
  }

  allCovers(): readonly CoverRecord[] {
    return [...this.covers.values()].sort((a, b) => compareIds(a.id, b.id));
  }

  coversBy(payer: PrincipalId): readonly CoverRecord[] {
    return this.allCovers().filter((c) => c.payer === payer);
  }

  coversFor(payee: PrincipalId): readonly CoverRecord[] {
    return this.allCovers().filter((c) => c.payee === payee);
  }

  /** Unbound offers anyone may take. The market's supply side. */
  openOffers(tick: number): readonly CoverRecord[] {
    return this.allCovers().filter((c) => c.state === 'OFFERED' && c.offerExpiresTick >= tick);
  }

  /** Every COVER written directly over `cover`. One level, not the chain. */
  cessionsOver(cover: CoverId): readonly CoverRecord[] {
    return this.allCovers().filter((c) => c.over.kind === 'COVER' && c.over.cover === cover);
  }

  /**
   * The chain from `cover` down to the located goods at the bottom, innermost last.
   *
   * Bounded by {@link import('./params.js').COVER_MAX_DEPTH} + 1 iterations and it throws past that
   * rather than looping, because §15.2 forbids *"a loop to convergence"* and a cycle here would be an
   * unbounded tick. `offerCover` already refuses to create one; this is the second road.
   */
  chainUnder(cover: CoverId): readonly CoverRecord[] {
    const out: CoverRecord[] = [];
    let at: CoverId | null = cover;
    for (let i = 0; i <= MAX_COVERS; i += 1) {
      if (at === null) return Object.freeze(out);
      const row: CoverRecord | undefined = this.covers.get(at);
      if (row === undefined) return Object.freeze(out);
      out.push(row);
      at = row.over.kind === 'COVER' ? row.over.cover : null;
      if (out.length > MAX_COVERS_PER_PAYER) {
        throw new RiskBookError(`cover ${cover} is in a cycle; a settlement graph may not loop (RE6)`);
      }
    }
    throw new RiskBookError(`cover ${cover} chain did not terminate`);
  }

  // ── CAT6's interest registry ──────────────────────────────────────────────

  static interestKey(payee: PrincipalId, system: SystemId, good: GoodId): string {
    return `${payee}::${system}::${good}`;
  }

  /** Is there already a live COVER over this `(payee, system, good)`? See `cover.ts`'s header. */
  interestTaken(payee: PrincipalId, system: SystemId, good: GoodId): boolean {
    const held = this.interests.get(RiskBook.interestKey(payee, system, good));
    if (held === undefined) return false;
    const row = this.covers.get(held);
    return row !== undefined && isLiveCover(row.state) && row.payee === payee;
  }

  claimInterest(cover: CoverRecord): void {
    if (cover.over.kind !== 'GOODS' || cover.payee === null) return;
    this.interests.set(
      RiskBook.interestKey(cover.payee, cover.over.system, cover.over.good),
      cover.id,
    );
  }

  releaseInterest(cover: CoverRecord): void {
    if (cover.over.kind !== 'GOODS' || cover.payee === null) return;
    const key = RiskBook.interestKey(cover.payee, cover.over.system, cover.over.good);
    if (this.interests.get(key) === cover.id) this.interests.delete(key);
  }

  // ── Indemnities ───────────────────────────────────────────────────────────

  addIndemnity(ind: IndemnityRecord): void {
    if (this.indemnities.size >= MAX_INDEMNITIES && !this.indemnities.has(ind.id)) {
      throw new RiskBookError(
        `the risk book holds ${String(MAX_INDEMNITIES)} indemnities and prune has not run`,
      );
    }
    this.indemnities.set(ind.id, ind);
  }

  indemnity(id: IndemnityId): IndemnityRecord | undefined {
    return this.indemnities.get(id);
  }

  allIndemnities(): readonly IndemnityRecord[] {
    return [...this.indemnities.values()].sort((a, b) => compareIds(a.id, b.id));
  }

  /** The cohort off one FRONT, in **settlement order**: outermost cession first (SOL2). */
  cohortOf(front: FrontId): readonly IndemnityRecord[] {
    return this.allIndemnities()
      .filter((i) => i.front === front)
      .sort((a, b) => b.depth - a.depth || compareIds(a.id, b.id));
  }

  /** Open INDEMNITIES a payer owes. What `observe` publishes as its obligations due (RSK5). */
  dueBy(payer: PrincipalId): readonly IndemnityRecord[] {
    return this.allIndemnities().filter(
      (i) => i.payer === payer && (i.state === 'OPEN' || i.state === 'DUE' || i.state === 'DEFERRED'),
    );
  }

  dueTo(payee: PrincipalId): readonly IndemnityRecord[] {
    return this.allIndemnities().filter(
      (i) => i.payee === payee && (i.state === 'OPEN' || i.state === 'DUE' || i.state === 'DEFERRED'),
    );
  }

  indemnityForCover(cover: CoverId): IndemnityRecord | undefined {
    return this.allIndemnities().find((i) => i.cover === cover);
  }

  // ── RSK7's record ─────────────────────────────────────────────────────────

  /** Absent means `UNSEASONED`, never "clean". See the header, rule 4. */
  record(principal: PrincipalId): RiskRecord {
    return this.records.get(principal) ?? ZERO_RECORD(principal);
  }

  /** True when this principal has no history at all — RSK7's own word for it. */
  isUnseasoned(principal: PrincipalId): boolean {
    return !this.records.has(principal);
  }

  private row(principal: PrincipalId): RiskRecord {
    const hit = this.records.get(principal);
    if (hit !== undefined) return hit;
    const fresh = ZERO_RECORD(principal);
    this.records.set(principal, fresh);
    return fresh;
  }

  noteWritten(payer: PrincipalId, limit: Minor, premium: Minor): void {
    const row = this.row(payer);
    row.written += 1;
    row.limitWritten = addMinor(row.limitWritten, limit);
    row.premiumEarned = addMinor(row.premiumEarned, premium);
  }

  noteHonoured(payer: PrincipalId, paid: Minor): void {
    const row = this.row(payer);
    row.honoured += 1;
    row.paidOut = addMinor(row.paidOut, paid);
  }

  noteDefaulted(payer: PrincipalId, amount: Minor, paid: Minor): void {
    const row = this.row(payer);
    row.defaulted += 1;
    row.defaultedValue = addMinor(row.defaultedValue, amount);
    row.paidOut = addMinor(row.paidOut, paid);
  }

  allRecords(): readonly RiskRecord[] {
    return [...this.records.values()].sort((a, b) => compareIds(a.principal, b.principal));
  }

  // ── Terminal marking and the one window ───────────────────────────────────

  resolveCover(cover: CoverRecord, state: CoverState, reckoning: number): void {
    cover.state = state;
    this.releaseInterest(cover);
    this.resolvedAt.set(cover.id, reckoning);
  }

  resolveIndemnity(ind: IndemnityRecord, reckoning: number): void {
    this.resolvedAt.set(ind.id, reckoning);
  }

  /**
   * Drop terminal rows older than the window. **Live rows are untouchable at any age.**
   *
   * Returns how many rows went, so a caller can report it rather than assume it — the
   * `MAX_RECKONING_SUMMARIES` incident was invisible precisely because nothing counted.
   */
  prune(currentReckoning: number): number {
    const keepFrom = currentReckoning - RISK_RETAINED_RECKONINGS;
    let dropped = 0;
    for (const cover of [...this.covers.values()].sort((a, b) => compareIds(a.id, b.id))) {
      if (isLiveCover(cover.state)) continue; // ★ rule 1. No age, no size, no exception.
      const at = this.resolvedAt.get(cover.id);
      if (at === undefined || at >= keepFrom) continue;
      this.covers.delete(cover.id);
      this.resolvedAt.delete(cover.id);
      dropped += 1;
    }
    for (const ind of [...this.indemnities.values()].sort((a, b) => compareIds(a.id, b.id))) {
      if (ind.state === 'OPEN' || ind.state === 'DUE' || ind.state === 'DEFERRED') continue;
      const at = this.resolvedAt.get(ind.id);
      if (at === undefined || at >= keepFrom) continue;
      this.indemnities.delete(ind.id);
      this.resolvedAt.delete(ind.id);
      dropped += 1;
    }
    for (const front of [...this.fronts.values()].sort((a, b) => compareIds(a.id, b.id))) {
      if (front.struckAtTick === null) continue;
      // A front is dropped only once every INDEMNITY it caused has left, or the cohort would
      // lose the row its `causeEventId` points at — INV-17 with the evidence pruned.
      if (this.allIndemnities().some((i) => i.front === front.id)) continue;
      const at = Math.trunc(front.struckAtTick / TICKS_PER_RECKONING);
      if (at >= keepFrom) continue;
      this.fronts.delete(front.id);
      dropped += 1;
    }
    return dropped;
  }

  size(): number {
    return this.covers.size + this.indemnities.size + this.fronts.size;
  }

  // ── Durability ────────────────────────────────────────────────────────────

  /**
   * The whole book, canonically, for the state table and the hash.
   *
   * Every row, in id order, including the record — `test/durability/books-in-the-hash.test.ts`'s
   * lesson is that a book outside the hash is a book a checkpoint silently forgets, and this one
   * holds promises.
   */
  capture(): CanonicalValue {
    return {
      fronts: this.allFronts().map((f) => ({
        id: f.id,
        state: f.state,
        announcedTick: f.announcedTick,
        landfallTick: f.landfallTick,
        eye: f.eye,
        struckAtTick: f.struckAtTick,
        causeEventId: f.causeEventId,
        swath: f.swath.map((c) => ({ system: c.system, intensityBps: c.intensityBps })),
        cone: f.cone.map((c) => ({ system: c.system, oddsBps: c.oddsBps })),
      })),
      covers: this.allCovers().map((c) => ({
        id: c.id,
        payer: c.payer,
        payee: c.payee,
        state: c.state,
        limit: c.limit,
        premium: c.premium,
        electiveBps: c.electiveBps,
        escrowed: c.escrowed,
        elective: c.elective,
        offeredTick: c.offeredTick,
        boundTick: c.boundTick,
        attachesTick: c.attachesTick,
        expiresTick: c.expiresTick,
        termsHash: c.termsHash,
        actedOnStateVersion: c.actedOnStateVersion,
        depth: c.depth,
        fingerprint: c.fingerprint,
        settledEscrowedMinor: c.settledEscrowedMinor,
        settledElectiveMinor: c.settledElectiveMinor,
        over:
          c.over.kind === 'GOODS'
            ? { kind: 'GOODS', system: c.over.system, good: c.over.good, cover: null }
            : { kind: 'COVER', system: null, good: null, cover: c.over.cover },
      })),
      indemnities: this.allIndemnities().map((i) => ({
        id: i.id,
        cover: i.cover,
        front: i.front,
        payer: i.payer,
        payee: i.payee,
        grossLoss: i.grossLoss,
        deductible: i.deductible,
        covered: i.covered,
        escrowedDue: i.escrowedDue,
        electiveDue: i.electiveDue,
        escrowedPaid: i.escrowedPaid,
        electivePaid: i.electivePaid,
        openedTick: i.openedTick,
        dueTick: i.dueTick,
        causeEventId: i.causeEventId,
        depth: i.depth,
        state: i.state,
        deferrals: i.deferrals,
      })),
      records: this.allRecords().map((r) => ({
        principal: r.principal,
        written: r.written,
        limitWritten: r.limitWritten,
        premiumEarned: r.premiumEarned,
        honoured: r.honoured,
        defaulted: r.defaulted,
        defaultedValue: r.defaultedValue,
        paidOut: r.paidOut,
      })),
    };
  }
}
