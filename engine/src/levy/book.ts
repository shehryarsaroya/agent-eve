/**
 * The Levy's one book. Every figure the mechanic owns lives here and nowhere else.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **ONE HOME PER QUANTITY** (scar #5). The assessment is here; the tribute line reads
 * it, the observation reads it, the docket reads it, and the sweep reads it. Nothing
 * recomputes it. Two homes for "what this principal owes tonight" would be two answers
 * to "did it pay", and the wrong one becomes a permanent public accusation (A5′).
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## What is stored and what is derived, and why the line is where it is
 *
 * Stored: the plan (total, rule, spared, the assessment lines), the payment journal
 * (own-hand and other-hand separately), the ballots, the chronic-strike counter and the
 * Commons capacity it demotes, and the shortfalls a settlement recorded.
 *
 * Derived every time it is asked for: what is *owed* ({@link Book.owingOf}), whether a
 * hand is on its way (`payment.ts:carriageUnderway`), and the tribute line's state. A
 * derived figure cannot drift from the journal it is derived from, and the journal is
 * the thing an auditor opens.
 *
 * ## Keys use `::`, never a NUL byte
 *
 * A NUL in a source file makes `file(1)` report it as `data`, and every grep-based
 * guard in this repo — including the outbound secret scan — silently stops covering the
 * file while tsc, eslint and vitest all stay green. Three agents have shipped one.
 */

import type { CanonicalValue } from '../core/canonical.js';
import { reckoningIndex } from '../core/time.js';
import type { ConstellationId, PrincipalId, SystemId } from '../core/types.js';
import { minor, qty, type Minor, type Qty } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import {
  readArray,
  readInt,
  readObject,
  readString,
  SnapshotError,
  type StateTable,
} from '../tick/snapshot.js';
import { isLevyRule, type Allocation, type AllocationPlan, type LevyRule } from './assessment.js';
import type { LevyBallot } from './ballot.js';
import {
  LEVY_BASE_COMMONS_CAPACITY,
  LEVY_CHRONIC_STRIKES,
  LEVY_MIN_COMMONS_CAPACITY,
  LEVY_RETAINED_RECKONINGS,
  MAX_LEVY_BALLOTS,
} from './params.js';
import { owingOf as splitOwing, type Owing } from './payment.js';

/** The key separator. `::`, for the reason in this file's header. */
const SEP = '::';

function planKey(reckoning: number, constellation: ConstellationId): string {
  return `${String(reckoning)}${SEP}${constellation}`;
}

function principalKey(reckoning: number, principal: PrincipalId): string {
  return `${String(reckoning)}${SEP}${principal}`;
}

/** One constellation's plan for one Reckoning. Minted once, never edited (§5.2). */
export interface LevyPlan {
  readonly reckoning: number;
  readonly constellation: ConstellationId;
  readonly total: Minor;
  readonly rule: LevyRule;
  readonly spared: PrincipalId | null;
  readonly byDefault: boolean;
  /** The named place these assessments are payable at (§5.2, `place.ts`). */
  readonly deliverableTo: SystemId;
  readonly lines: readonly Allocation[];
  readonly assessedAtTick: number;
}

/** What has actually been delivered against one assessment. The audit trail. */
export interface PaymentRow {
  readonly reckoning: number;
  readonly principal: PrincipalId;
  paidOwn: Minor;
  paidOther: Minor;
  /** Goods taken by the shortfall sweep, in units of the levy good. */
  swept: Qty;
  /** Deliveries credited, including third-party ones. Bounded by the assessment. */
  deliveries: number;
}

/**
 * Chronic non-payment, and the only thing it costs.
 *
 * §5.2: *"never identity, never the holding, never standing · chronic non-payment
 * demotes Commons capacity, **and that is all**."* So this row holds a strike counter
 * and a capacity, and there is deliberately no third field: anything else the Levy
 * could take would have to live here, and it does not exist.
 */
export interface ChronicRow {
  readonly principal: PrincipalId;
  strikes: number;
  capacity: number;
  lastShortReckoning: number | null;
  demotions: number;
}

/**
 * One principal's EXPOSURE high-water mark for one Reckoning.
 *
 * A row rather than a bare `Minor`, for `PaymentRow`'s reason: {@link Book.prune} has to be able to
 * ask a row which cycle it belongs to without parsing it back out of the map key, and a key parse
 * is a silent-failure road in the one place a wrong answer deletes state.
 */
export interface ExposurePeakRow {
  readonly reckoning: number;
  readonly principal: PrincipalId;
  /** Σ open `max_direct_loss` at its largest, over the ticks of {@link reckoning}. */
  peak: Minor;
}

/** A shortfall as the record carries it: the arithmetic, not just the answer. */
export interface ShortfallRow {
  readonly reckoning: number;
  readonly principal: PrincipalId;
  readonly constellation: ConstellationId;
  readonly assessment: Minor;
  readonly paidOwn: Minor;
  readonly paidOther: Minor;
  readonly sweptQty: Qty;
  /** The non-escrowable part still owed. Never sweepable: presence is not for sale. */
  readonly presenceOwed: Minor;
  readonly purchasableOwed: Minor;
  readonly owed: Minor;
  /** True iff this principal was in the sweep queue — never true for a newcomer. */
  readonly inSweepQueue: boolean;
}

export class LevyBookError extends Error {}

export class Book {
  private readonly plans = new Map<string, LevyPlan>();
  private readonly payments = new Map<string, PaymentRow>();
  private readonly ballots = new Map<string, LevyBallot>();
  private readonly chronic = new Map<PrincipalId, ChronicRow>();
  private readonly shortfalls = new Map<string, ShortfallRow>();
  /**
   * The tick each principal enrolled at. **The newcomer floor's tenure clock.**
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THIS EXISTS BECAUSE DERIVING TENURE FROM PRESENCE IS AN EXPLOIT**, and the first
   * version of this module shipped it. `HandRecord.presentSinceTick` is the *arrival*
   * clock — `resolveArrival` rewrites it every time a hand finishes a journey — so
   * "earliest hand presence" reads as *recent* for any principal that keeps its hands
   * moving. The consequence was not cosmetic: move a hand every day and you are a
   * newcomer forever, assessed at the nominal rate for the rest of the season, which is
   * a permanent tax exemption bought with one action a Reckoning.
   *
   * There is no enrolment tick anywhere else in the engine — the world's tables hold
   * position, not history — so this is a first home rather than a second one, and it is
   * never pruned, because identity is never deleted (A10).
   * ══════════════════════════════════════════════════════════════════════════
   */
  private readonly seatedAt = new Map<PrincipalId, number>();
  /**
   * ★ The **EXPOSURE high-water mark**: the largest EXPOSURE one principal carried at any
   * tick of one Reckoning. Keyed `reckoning::principal`. The figure §5.2's two
   * exposure-shaped rules are computed from.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE INSTANTANEOUS READING MEASURED NOTHING, AND THE MEASUREMENT IS EXACT.**
   *
   * `weightOf('BY_EXPOSURE')` and `weightOf('INVERSE_EXPOSURE')` used to read EXPOSURE as it stood
   * at the tick the docket was minted. That tick is `LEVY_ASSESS_PHASE`, which is **0**, and
   * `settleVenture` releases every stake at the settlement tick — phase 287, the tick *before*.
   * So the assessment sampled the one moment in the cycle when every stake in the world had just
   * been handed back.
   *
   * Measured, `g01`, six Reckonings, open stake locks counted per phase: **phase 0 → 4**, phase 24
   * → 69, phase 144 → 89, phase 286 → 92, phase 287 → 6. A **22x trough**. Across the eight gate
   * seeds only **12 of 129 dockets** saw any EXPOSURE spread at all and three seeds saw none, so
   * `BY_EXPOSURE`, `EVEN` and the published default `INVERSE_EXPOSURE` were one flat weight on
   * seven dockets in eight — and the ballot, which closes at `WINDOW_FIRST_PHASE` in mid-cycle, was
   * cast against a reading that had evaporated before the docket it decided was cut.
   *
   * **Raising the stake cannot reach it and that attempt is already priced.** `CAST_STAKE_BPS`
   * carries the table: at 1,000 bps `levyShort` at nine Reckonings goes 0 → 11,884, and pricing the
   * bid off free STORES instead cost the world **25% of its ventures** (§7.3 resolves a contested
   * slot pro-rata by stake, so a wealth-priced bid becomes a standing wealth ranking). The defect
   * is a **schedule**, not a price, and the fix is a reading.
   *
   * ── WHY A HIGH-WATER MARK IS THE HONEST ANSWER, NOT A CONVENIENT ONE ────────
   *
   * The rule asks *"how exposed were you this cycle"*. A max over the cycle answers that question;
   * the value at one arbitrary instant answers a different one. It is the same error family as
   * `weightOf('BY_STORES')` reading a **currency** balance for a **goods** obligation and the cast's
   * `spare` pick ranking by cash — **measuring the wrong quantity at the wrong moment** — which has
   * now produced three separate bugs in this one mechanic.
   *
   * It is also monotone, which is what makes it votable: within a cycle this figure never falls, so
   * a member reading it mid-window is reading a **lower bound on the final number** rather than a
   * quantity that can move under it. Releasing a stake does not buy relief from a bill that has
   * already been earned, which is the correct incentive — otherwise the optimal play is to stake all
   * cycle and unwind an hour before the freeze.
   *
   * ── SAMPLED AT TICK BOUNDARIES, ON PURPOSE (A9) ─────────────────────────────
   *
   * {@link Book.observeExposure} is called once per tick from OBLIGE, not from inside
   * `EncumbranceBook.lock`. An intra-tick maximum would be a number no `observe` ever published and
   * no affordance ever quoted, and A9 forbids the assessment reading a fact an agent's own
   * observation could not — every other reading of EXPOSURE in this engine (the affordance's
   * `max_direct_loss`, `principalPosition`, the sweep order) is a tick-boundary reading too.
   *
   * ── WHAT DESTROYS IT, AND WHY NOTHING DOES ──────────────────────────────────
   *
   * {@link Book.prune} drops rows below `currentReckoning - LEVY_RETAINED_RECKONINGS`, and it runs at
   * the **settlement tick of Reckoning R** — so it keeps `R-3 .. R`. The deepest read is the
   * assessment at phase 0 of `R+1` asking for **row `R`**, the newest row there is. So the margin is
   * three Reckonings against a distance of one, and `test/levy/exposure-high-water.spec.ts` asserts
   * that relation **from the constants** rather than trusting it. A `Book.prune` window has now
   * silently eaten a load-bearing row four times in this repo; this is the fifth candidate and it is
   * the one that was checked in advance.
   *
   * Bounded by `roll x (LEVY_RETAINED_RECKONINGS + 1)`, and **no cap is declared** for
   * {@link Book.assess}'s reason: the roll is lifetime enrolments and a fixed cap on it is a cliff,
   * not a bound. A refusal here would lose the mark and bias the reading back toward the trough —
   * failing in exactly the direction that hides.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private readonly exposurePeaks = new Map<string, ExposurePeakRow>();
  /** Reckonings whose Levy has already settled. Idempotence, and INV-20's shape. */
  private readonly settled = new Set<number>();

  // ── tenure ────────────────────────────────────────────────────────────────

  /**
   * Record an enrolment. First write wins: identity is never re-minted (§6.1), so a
   * second call would be a principal quietly becoming newer than it is.
   */
  enrolled(principal: PrincipalId, tick: number): void {
    if (this.seatedAt.has(principal)) return;
    // ── NO CAP HERE, AND THE CAP THAT WAS HERE WAS AN EXPLOIT ────────────────
    //
    // This register used to refuse past `MAX_LEVY_ASSESSMENTS`. `Runtime.seat` catches
    // that refusal and files a fault, so the principal was seated with **no tenure row**
    // — and `tenureTicksOf` returns 0 for a principal it has never heard of, on purpose,
    // because that is the safe direction for a genuine newcomer. Together those two safe
    // choices made a permanent one: enrolment 513 and every one after it read as tenure 0
    // for the rest of the season and was assessed the nominal rate forever. Verified:
    // `seatedAtOf` null, `tenureTicksOf(p, 100_000) === 0`.
    //
    // The register is bounded by the roll, and the roll is **lifetime** enrolments — not
    // the 300 concurrent seats `api/seats.ts` enforces, because seats recycle while
    // identity is never deleted (A10). A fixed cap on a monotonically growing set is not
    // a declared bound; it is a cliff. One integer per principal ever enrolled is the
    // cost of the floor being honest, and it is the smallest row in this file.
    this.seatedAt.set(principal, tick);
  }

  /**
   * Ticks since enrolment.
   *
   * A principal the register has never heard of is treated as enrolling **now** — so it
   * is inside the newcomer floor, which is the safe direction. The unsafe direction would
   * be treating it as ancient and assessing it the full duty on its first night, which is
   * precisely the failure §5.2's floor exists to prevent.
   */
  tenureTicksOf(principal: PrincipalId, tick: number): number {
    const seated = this.seatedAt.get(principal);
    if (seated === undefined) return 0;
    return Math.max(0, tick - seated);
  }

  seatedAtOf(principal: PrincipalId): number | null {
    return this.seatedAt.get(principal) ?? null;
  }

  // ── the EXPOSURE high-water mark ───────────────────────────────────────────

  /**
   * Record one tick's EXPOSURE against this Reckoning's high-water mark.
   *
   * **Only a RISE writes**, so the row is monotone within its cycle and calling this twice in one
   * tick is identical to calling it once. Zero never inserts: a principal that was never exposed
   * has no row, {@link Book.exposurePeakOf} answers 0 for it, and `capture()` stays as small as the
   * world is quiet.
   *
   * Refuses a negative reading rather than storing it. EXPOSURE is Σ of non-negative
   * `max_direct_loss` (`EncumbranceBook.lock` rejects a negative one), so a negative here would mean
   * the cache had gone wrong upstream — and a *negative* high-water mark would flow into
   * `weightOf` as a weight below the unit, which is an exemption the Levy does not have.
   */
  observeExposure(reckoning: number, principal: PrincipalId, exposure: Minor): void {
    if (!Number.isSafeInteger(exposure) || exposure <= 0) return;
    const key = principalKey(reckoning, principal);
    const row = this.exposurePeaks.get(key);
    if (row === undefined) {
      this.exposurePeaks.set(key, { reckoning, principal, peak: minor(exposure) });
      return;
    }
    if (exposure > row.peak) row.peak = minor(exposure);
  }

  /**
   * The EXPOSURE high-water mark of one Reckoning. **The one home of the figure.**
   *
   * Zero for a Reckoning nobody was exposed in, for a principal that was never exposed, and for a
   * Reckoning older than the retention window — the three cases are deliberately one answer,
   * because all three mean *"the record shows no peril here"* and a caller that had to tell them
   * apart would be re-deriving the rule.
   */
  exposurePeakOf(reckoning: number, principal: PrincipalId): Minor {
    return this.exposurePeaks.get(principalKey(reckoning, principal))?.peak ?? minor(0);
  }

  // ── assessment ────────────────────────────────────────────────────────────

  /**
   * Record a constellation's plan for a Reckoning.
   *
   * Refuses a second plan for the same pair rather than replacing it: §5.2's whole
   * timing argument is that an assessment does not move once minted, and a silent
   * replace would let a later tick re-bill a principal that had already delivered.
   */
  assess(plan: LevyPlan): void {
    const key = planKey(plan.reckoning, plan.constellation);
    if (this.plans.has(key)) {
      throw new LevyBookError(
        `${plan.constellation} is already assessed for Reckoning ${String(plan.reckoning)}; an assessment ` +
          'never moves once minted, or a principal can be re-billed for goods it already handed over',
      );
    }
    // ── NO CAP ON THE LINE COUNT, AND THE CAP THAT WAS HERE HALTED THE WORLD ──
    //
    // A plan holds one line per principal on the roll, so a cap on the lines is a cap on
    // the roll. `MAX_LEVY_ASSESSMENTS` was 512 and was chosen "against the seat cap the
    // API enforces" — but a seat is the right to be *served* and it recycles, while
    // identity and the holding are never deleted (A10, `api/seats.ts`). So the roll is
    // lifetime enrolments and grows without bound, and this throw was reachable through
    // `POST /enroll`, which is free and unauthenticated by design (A15).
    //
    // What it cost: `assessCycle` propagates, `Runtime.assessLevyNow` catches and files a
    // fault, **nothing at all is assessed**, `docketRowsFor` returns an empty array, and
    // INV-25 halts the world once per principal. Verified at the boundary — 512 principals
    // publish a clean tick, 513 halt with 513 INV-25 violations, permanently, because a
    // re-run fails the same way.
    //
    // INV-26's discipline is kept where it can be kept honestly: the ballot book still
    // declares a cap (its refusal reaches the agent as a hint from `vVote`, so it cannot
    // strand a Reckoning) and `MAX_TRIBUTE_LINES` still bounds the frame. An assessment is
    // not that kind of array — it is the roll, and the roll is the bound.
    this.plans.set(key, plan);
  }

  isAssessed(reckoning: number, constellation: ConstellationId): boolean {
    return this.plans.has(planKey(reckoning, constellation));
  }

  /**
   * Add a principal that enrolled *after* its constellation was assessed.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **INV-25 IS WHY THIS EXISTS, and it is not a loophole in "an assessment never
   * moves".** Enrolment is free and continuous, so a principal can appear at phase 150
   * of a cycle whose plan was minted at phase 0. Without this it would hold no
   * assessment, appear on no docket row, and INV-25 — *"every principal appears in ≥1
   * docket row per Reckoning"*, the anti-quiet invariant — would halt the world on the
   * arrival of a legitimate newcomer.
   *
   * What moves and what does not:
   *
   *   - **No existing line changes.** The newcomer's duty is *added* to the total, which
   *     is what `Σ duty` means and why the total is additive in the first place (A15).
   *     Nobody already on the roll pays a unit more or less because somebody enrolled.
   *   - **The newcomer is on the floor.** It has zero tenure by construction, so its
   *     line is the nominal rate and `newcomerFloored` is true — the protection §5.2
   *     demands, applied at the one moment it is most needed.
   * ══════════════════════════════════════════════════════════════════════════
   */
  admitLate(reckoning: number, constellation: ConstellationId, line: Allocation): boolean {
    const key = planKey(reckoning, constellation);
    const plan = this.plans.get(key);
    if (plan === undefined) return false;
    if (plan.lines.some((l) => l.principal === line.principal)) return false;
    // No cap, for the reason stated on {@link Book.assess}: a refusal here strands a
    // legitimate mid-cycle enroller with no assessment and no docket row, and INV-25
    // halts the world on its arrival — which is the exact failure this method exists to
    // prevent.
    this.plans.set(key, {
      ...plan,
      total: minor(plan.total + line.amount),
      lines: [...plan.lines, line].sort((a, b) => compareIds(a.principal, b.principal)),
    });
    return true;
  }

  planFor(reckoning: number, constellation: ConstellationId): LevyPlan | null {
    return this.plans.get(planKey(reckoning, constellation)) ?? null;
  }

  plansIn(reckoning: number): readonly LevyPlan[] {
    return [...this.plans.values()]
      .filter((p) => p.reckoning === reckoning)
      .sort((a, b) => compareIds(a.constellation, b.constellation));
  }

  /** The assessment line for one principal, or null if it holds none this Reckoning. */
  lineFor(reckoning: number, principal: PrincipalId): { readonly plan: LevyPlan; readonly line: Allocation } | null {
    for (const plan of this.plansIn(reckoning)) {
      for (const line of plan.lines) {
        if (line.principal === principal) return { plan, line };
      }
    }
    return null;
  }

  assessmentOf(reckoning: number, principal: PrincipalId): Minor {
    return this.lineFor(reckoning, principal)?.line.amount ?? minor(0);
  }

  // ── payment ───────────────────────────────────────────────────────────────

  /**
   * What has been paid against one assessment. **A READ, and it used to be a write.**
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THIS INSERTED A ZERO ROW INTO A HASHED MAP, AND THE FRAME RENDERER READS IT.**
   *
   * `payments` is inside `capture()` and `levyStateTable` puts that capture into `state_hash`. This
   * method lazily `set` the row it did not find, so a caller that merely *looked* changed the
   * world's hash — and `tribute.ts:tributeLineState` looks, once per principal, every time a
   * tribute line is drawn. **Rendering a picture of the world mutated the world.** A frame is a
   * projection (§15's "three write artifacts, two projections"); a projection that writes is the
   * event-sourcing cliff with the hash on the other side of it.
   *
   * It was found in `sovereignty/book.ts`'s identical copy, by
   * `test/durability/checkpoint-adoption.test.ts`'s crossing case: a genesis replay and an adopted
   * boot read different sets of pairs, so they hashed differently forever while each one's
   * arithmetic stayed correct. That is DET-1 failing in the only way nothing else catches. The
   * sovereignty copy had no subject until claims existed; this one has had one all along, and the
   * reason it never diverged is that every road into it happens to have been re-run on both paths.
   * "It has not bitten yet" is not a property.
   *
   * The read returns a **copy**, never the stored row, so no caller can write through it either.
   * {@link Book.paymentRowFor} is the writer's road and the only thing that inserts.
   * ══════════════════════════════════════════════════════════════════════════
   */
  paymentOf(reckoning: number, principal: PrincipalId): PaymentRow {
    const row = this.payments.get(principalKey(reckoning, principal));
    if (row === undefined) {
      return {
        reckoning,
        principal,
        paidOwn: minor(0),
        paidOther: minor(0),
        swept: qty(0),
        deliveries: 0,
      };
    }
    return { ...row };
  }

  /** The stored row, inserted if absent. **Writers only** — see {@link Book.paymentOf}. */
  private paymentRowFor(reckoning: number, principal: PrincipalId): PaymentRow {
    const key = principalKey(reckoning, principal);
    const row = this.payments.get(key);
    if (row !== undefined) return row;
    const fresh: PaymentRow = {
      reckoning,
      principal,
      paidOwn: minor(0),
      paidOther: minor(0),
      swept: qty(0),
      deliveries: 0,
    };
    this.payments.set(key, fresh);
    return fresh;
  }

  /** What one assessment still owes, bucket by bucket. The only shortfall arithmetic. */
  owingOf(reckoning: number, principal: PrincipalId): Owing {
    const row = this.payments.get(principalKey(reckoning, principal));
    return splitOwing(this.assessmentOf(reckoning, principal), {
      paidOwn: row?.paidOwn ?? minor(0),
      paidOther: row?.paidOther ?? minor(0),
    });
  }

  /**
   * Credit a delivery. **The caller has already moved the goods.**
   *
   * The order is deliberate and it is the A5′ order: the ledger moves first, then this
   * is called. A credit written before the goods moved would record a payment that did
   * not happen; a credit written after a failed move would record one that failed. The
   * delivery handler in `runtime.ts` therefore destroys the lot and only then calls
   * this, and it reports rather than halts if the destruction throws.
   */
  credit(reckoning: number, principal: PrincipalId, amount: Minor, byOwnHand: boolean): void {
    if (amount <= 0) return;
    const row = this.paymentRowFor(reckoning, principal);
    if (byOwnHand) row.paidOwn = minor(row.paidOwn + amount);
    else row.paidOther = minor(row.paidOther + amount);
    row.deliveries += 1;
  }

  /** Record what the sweep took. Reported in the shortfall row, never as a payment. */
  recordSweep(reckoning: number, principal: PrincipalId, taken: Qty): void {
    if (taken <= 0) return;
    const row = this.paymentRowFor(reckoning, principal);
    row.swept = qty(row.swept + taken);
  }

  // ── ballots ───────────────────────────────────────────────────────────────

  /**
   * Cast or restate a ballot. **Replaces**, never appends.
   *
   * One principal, one ballot: appending would let a principal vote as many times as it
   * has actions, which is a gate priced in throughput (A4) rather than in judgement.
   */
  castBallot(ballot: LevyBallot): void {
    const key = principalKey(ballot.forReckoning, ballot.principal);
    if (!this.ballots.has(key) && this.ballots.size >= MAX_LEVY_BALLOTS) {
      throw new LevyBookError(`the ballot book is at its declared cap of ${MAX_LEVY_BALLOTS} (INV-26)`);
    }
    this.ballots.set(key, ballot);
  }

  hasVoted(forReckoning: number, principal: PrincipalId): boolean {
    return this.ballots.has(principalKey(forReckoning, principal));
  }

  ballotsFor(forReckoning: number, constellation: ConstellationId): readonly LevyBallot[] {
    return [...this.ballots.values()]
      .filter((b) => b.forReckoning === forReckoning && b.constellation === constellation)
      .sort((a, b) => compareIds(a.principal, b.principal));
  }

  ballotsInOrder(): readonly LevyBallot[] {
    return [...this.ballots.values()].sort(
      (a, b) =>
        a.forReckoning - b.forReckoning ||
        compareIds(a.constellation, b.constellation) ||
        compareIds(a.principal, b.principal),
    );
  }

  // ── chronic non-payment ───────────────────────────────────────────────────

  chronicOf(principal: PrincipalId): ChronicRow {
    const row = this.chronic.get(principal);
    if (row !== undefined) return row;
    const fresh: ChronicRow = {
      principal,
      strikes: 0,
      capacity: LEVY_BASE_COMMONS_CAPACITY,
      lastShortReckoning: null,
      demotions: 0,
    };
    this.chronic.set(principal, fresh);
    return fresh;
  }

  /** Commons capacity: concurrent venture roles a Commons-bound principal may hold. */
  capacityOf(principal: PrincipalId): number {
    return this.chronic.get(principal)?.capacity ?? LEVY_BASE_COMMONS_CAPACITY;
  }

  /**
   * A Reckoning ended with this principal short. Returns true iff capacity demoted.
   *
   * Strikes must be **consecutive** — a clean Reckoning resets them — because §5.2's
   * word is *chronic*, and a counter that never reset would demote a principal for one
   * bad night three Reckonings ago.
   */
  strike(principal: PrincipalId, reckoning: number): boolean {
    const row = this.chronicOf(principal);
    row.strikes = row.lastShortReckoning === reckoning - 1 || row.lastShortReckoning === null
      ? row.strikes + 1
      : 1;
    row.lastShortReckoning = reckoning;
    if (row.strikes < LEVY_CHRONIC_STRIKES) return false;
    row.strikes = 0;
    if (row.capacity <= LEVY_MIN_COMMONS_CAPACITY) return false;
    row.capacity -= 1;
    row.demotions += 1;
    return true;
  }

  /** A Reckoning ended clean. Strikes reset; capacity is never restored by this call. */
  clearStrikes(principal: PrincipalId): void {
    const row = this.chronicOf(principal);
    row.strikes = 0;
    row.lastShortReckoning = null;
  }

  // ── shortfalls ────────────────────────────────────────────────────────────

  recordShortfall(row: ShortfallRow): void {
    this.shortfalls.set(principalKey(row.reckoning, row.principal), row);
  }

  shortfallOf(reckoning: number, principal: PrincipalId): ShortfallRow | null {
    return this.shortfalls.get(principalKey(reckoning, principal)) ?? null;
  }

  shortfallsIn(reckoning: number): readonly ShortfallRow[] {
    return [...this.shortfalls.values()]
      .filter((s) => s.reckoning === reckoning)
      .sort((a, b) => compareIds(a.constellation, b.constellation) || compareIds(a.principal, b.principal));
  }

  /** `LEVY SHORT` for one Reckoning: Σ owed after the sweep. The headline meter. */
  shortFor(reckoning: number): Minor {
    let total = 0;
    for (const row of this.shortfallsIn(reckoning)) total += row.owed;
    return minor(total);
  }

  markSettled(reckoning: number): void {
    this.settled.add(reckoning);
  }

  isSettled(reckoning: number): boolean {
    return this.settled.has(reckoning);
  }

  // ── housekeeping ──────────────────────────────────────────────────────────

  /**
   * Forget Reckonings older than the retention window.
   *
   * A season is 8 064 ticks and a row that is never removed is an array that only grows
   * (scar #3). Everything dropped here is already in the append-only event ledger, which
   * is the permanent record; this book is *state*, and state forgets.
   */
  prune(currentReckoning: number): number {
    const keepFrom = currentReckoning - LEVY_RETAINED_RECKONINGS;
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
    // ── AND THE HIGH-WATER MARKS, ON THE SAME WINDOW AND WITH THREE RECKONINGS TO SPARE ──
    //
    // This is the fifth `Book.prune` candidate in this repo and the first one checked before it bit.
    // `prune(R)` runs at the settlement tick of Reckoning R and keeps `R-3 .. R`; the deepest read
    // is the assessment at phase 0 of `R+1` asking for **row R**, which is the newest row here. So
    // the window would have to be *negative* to lose it, and
    // `test/levy/exposure-high-water.spec.ts` asserts that from `LEVY_RETAINED_RECKONINGS` rather
    // than from this comment. Keyed by the cycle it was MEASURED in, never rolled over into a
    // "previous"/"current" pair — a rollover is a one-tick race against `assessCycle` and is exactly
    // how a retention window destroys a row one tick before it is read.
    for (const [key, row] of [...this.exposurePeaks]) {
      if (row.reckoning >= keepFrom) continue;
      this.exposurePeaks.delete(key);
      dropped += 1;
    }
    return dropped;
  }

  sizes(): Readonly<Record<string, number>> {
    return {
      levyPlans: this.plans.size,
      levyPayments: this.payments.size,
      levyBallots: this.ballots.size,
      levyShortfalls: this.shortfalls.size,
      levyChronic: this.chronic.size,
      levyTenure: this.seatedAt.size,
      levyExposurePeaks: this.exposurePeaks.size,
    };
  }

  // ── serialisation ─────────────────────────────────────────────────────────

  capture(): CanonicalValue {
    return {
      plans: [...this.plans.values()]
        .sort((a, b) => a.reckoning - b.reckoning || compareIds(a.constellation, b.constellation))
        .map((plan) => ({
          reckoning: plan.reckoning,
          constellation: plan.constellation,
          total: plan.total,
          rule: plan.rule,
          spared: plan.spared,
          byDefault: plan.byDefault,
          deliverableTo: plan.deliverableTo,
          assessedAtTick: plan.assessedAtTick,
          lines: [...plan.lines]
            .sort((a, b) => compareIds(a.principal, b.principal))
            .map((line) => ({
              principal: line.principal,
              amount: line.amount,
              newcomerFloored: line.newcomerFloored,
              tenureTicks: line.tenureTicks,
              freeStores: line.freeStores,
              spared: line.spared,
              weight: line.weight,
            })),
        })),
      payments: [...this.payments.values()]
        .sort((a, b) => a.reckoning - b.reckoning || compareIds(a.principal, b.principal))
        .map((row) => ({
          reckoning: row.reckoning,
          principal: row.principal,
          paidOwn: row.paidOwn,
          paidOther: row.paidOther,
          swept: row.swept,
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
      chronic: [...this.chronic.values()]
        .sort((a, b) => compareIds(a.principal, b.principal))
        .map((row) => ({
          principal: row.principal,
          strikes: row.strikes,
          capacity: row.capacity,
          lastShortReckoning: row.lastShortReckoning,
          demotions: row.demotions,
        })),
      shortfalls: [...this.shortfalls.values()]
        .sort(
          (a, b) =>
            a.reckoning - b.reckoning ||
            compareIds(a.constellation, b.constellation) ||
            compareIds(a.principal, b.principal),
        )
        .map((row) => ({
          reckoning: row.reckoning,
          principal: row.principal,
          constellation: row.constellation,
          assessment: row.assessment,
          paidOwn: row.paidOwn,
          paidOther: row.paidOther,
          sweptQty: row.sweptQty,
          presenceOwed: row.presenceOwed,
          purchasableOwed: row.purchasableOwed,
          owed: row.owed,
          inSweepQueue: row.inSweepQueue,
        })),
      // The tenure register is inside `state_hash` and inside the abort path, because it
      // decides who the newcomer floor protects — a restore that lost it would reassess
      // every principal as brand new and hand the whole constellation a nominal rate.
      seatedAt: [...this.seatedAt.entries()]
        .sort((a, b) => compareIds(a[0], b[0]))
        .map(([principal, tick]) => ({ principal, tick })),
      // ── ★ THE HIGH-WATER MARKS ARE INSIDE `state_hash`, AND THAT IS THE POINT ──
      //
      // This is the new hashed field `RULES_VERSION` 17 exists for. It has to be here for the reason
      // the tenure register does: it **decides a future tick's arithmetic**, so a `state_hash` that
      // could not see it would call two worlds identical while one of them was about to bill its most
      // exposed member three times what the other did. Being inside the hash also puts it inside the
      // abort path — an aborted tick must not leave a mark recorded, because `resume()` re-runs that
      // tick and would record it twice (harmless for a max, but the two worlds would have different
      // captures until the next rise, which is DET-1 failing in the only way nothing else catches).
      //
      // Emitted UNCONDITIONALLY, empty array and all. A key that appeared only when the map had rows
      // would make `capture()`'s *shape* a function of state — a new class of thing in this engine
      // and a trap for the next reader — in exchange for narrowing a discontinuity that is declared
      // anyway. The live journal snapshots only at settlement ticks, so the first tripwire this moves
      // is tick 287, which is already on the record.
      exposurePeaks: [...this.exposurePeaks.values()]
        .sort((a, b) => a.reckoning - b.reckoning || compareIds(a.principal, b.principal))
        .map((row) => ({ reckoning: row.reckoning, principal: row.principal, peak: row.peak })),
      settled: [...this.settled].sort((a, b) => a - b),
    };
  }

  restore(captured: CanonicalValue): void {
    const root = readObject(captured, 'levy');
    this.plans.clear();
    this.payments.clear();
    this.ballots.clear();
    this.chronic.clear();
    this.shortfalls.clear();
    this.seatedAt.clear();
    this.exposurePeaks.clear();
    this.settled.clear();

    for (const [i, raw] of readArray(root['plans'] ?? [], 'levy.plans').entries()) {
      const where = `levy.plans[${String(i)}]`;
      const o = readObject(raw, where);
      const rule = readString(o, 'rule', where);
      if (!isLevyRule(rule)) throw new SnapshotError(`${where}: unknown Levy rule ${rule}`);
      const lines = readArray(o['lines'] ?? [], `${where}.lines`).map((rawLine, j) => {
        const lineWhere = `${where}.lines[${String(j)}]`;
        const l = readObject(rawLine, lineWhere);
        const allocation: Allocation = {
          principal: readString(l, 'principal', lineWhere) as PrincipalId,
          amount: minor(readInt(l, 'amount', lineWhere)),
          newcomerFloored: readBool(l, 'newcomerFloored', lineWhere),
          tenureTicks: readInt(l, 'tenureTicks', lineWhere),
          freeStores: minor(readInt(l, 'freeStores', lineWhere)),
          spared: readBool(l, 'spared', lineWhere),
          weight: readInt(l, 'weight', lineWhere),
        };
        return allocation;
      });
      const plan: LevyPlan = {
        reckoning: readInt(o, 'reckoning', where),
        constellation: readString(o, 'constellation', where) as ConstellationId,
        total: minor(readInt(o, 'total', where)),
        rule,
        spared: readStringOrNull(o, 'spared', where) as PrincipalId | null,
        byDefault: readBool(o, 'byDefault', where),
        deliverableTo: readString(o, 'deliverableTo', where) as SystemId,
        lines,
        assessedAtTick: readInt(o, 'assessedAtTick', where),
      };
      this.plans.set(planKey(plan.reckoning, plan.constellation), plan);
    }

    for (const [i, raw] of readArray(root['payments'] ?? [], 'levy.payments').entries()) {
      const where = `levy.payments[${String(i)}]`;
      const o = readObject(raw, where);
      const row: PaymentRow = {
        reckoning: readInt(o, 'reckoning', where),
        principal: readString(o, 'principal', where) as PrincipalId,
        paidOwn: minor(readInt(o, 'paidOwn', where)),
        paidOther: minor(readInt(o, 'paidOther', where)),
        swept: qty(readInt(o, 'swept', where)),
        deliveries: readInt(o, 'deliveries', where),
      };
      this.payments.set(principalKey(row.reckoning, row.principal), row);
    }

    for (const [i, raw] of readArray(root['ballots'] ?? [], 'levy.ballots').entries()) {
      const where = `levy.ballots[${String(i)}]`;
      const o = readObject(raw, where);
      const rule = readString(o, 'rule', where);
      if (!isLevyRule(rule)) throw new SnapshotError(`${where}: unknown Levy rule ${rule}`);
      const ballot: LevyBallot = {
        principal: readString(o, 'principal', where) as PrincipalId,
        constellation: readString(o, 'constellation', where) as ConstellationId,
        forReckoning: readInt(o, 'forReckoning', where),
        rule,
        spare: readStringOrNull(o, 'spare', where) as PrincipalId | null,
        tick: readInt(o, 'tick', where),
      };
      this.ballots.set(principalKey(ballot.forReckoning, ballot.principal), ballot);
    }

    for (const [i, raw] of readArray(root['chronic'] ?? [], 'levy.chronic').entries()) {
      const where = `levy.chronic[${String(i)}]`;
      const o = readObject(raw, where);
      const row: ChronicRow = {
        principal: readString(o, 'principal', where) as PrincipalId,
        strikes: readInt(o, 'strikes', where),
        capacity: readInt(o, 'capacity', where),
        lastShortReckoning: readIntOrNullAt(o, 'lastShortReckoning', where),
        demotions: readInt(o, 'demotions', where),
      };
      this.chronic.set(row.principal, row);
    }

    for (const [i, raw] of readArray(root['shortfalls'] ?? [], 'levy.shortfalls').entries()) {
      const where = `levy.shortfalls[${String(i)}]`;
      const o = readObject(raw, where);
      const row: ShortfallRow = {
        reckoning: readInt(o, 'reckoning', where),
        principal: readString(o, 'principal', where) as PrincipalId,
        constellation: readString(o, 'constellation', where) as ConstellationId,
        assessment: minor(readInt(o, 'assessment', where)),
        paidOwn: minor(readInt(o, 'paidOwn', where)),
        paidOther: minor(readInt(o, 'paidOther', where)),
        sweptQty: qty(readInt(o, 'sweptQty', where)),
        presenceOwed: minor(readInt(o, 'presenceOwed', where)),
        purchasableOwed: minor(readInt(o, 'purchasableOwed', where)),
        owed: minor(readInt(o, 'owed', where)),
        inSweepQueue: readBool(o, 'inSweepQueue', where),
      };
      this.shortfalls.set(principalKey(row.reckoning, row.principal), row);
    }

    for (const [i, raw] of readArray(root['seatedAt'] ?? [], 'levy.seatedAt').entries()) {
      const where = `levy.seatedAt[${String(i)}]`;
      const o = readObject(raw, where);
      this.seatedAt.set(readString(o, 'principal', where) as PrincipalId, readInt(o, 'tick', where));
    }

    // `?? []`, so a checkpoint written before `RULES_VERSION` 17 restores without a migration: it
    // holds no marks, every peak reads 0, and the two exposure rules are flat until the world has
    // been observed for a cycle. That is the same answer a genesis world gives on its first
    // Reckoning, and it is the safe direction — a *fabricated* peak would bill a real principal for
    // peril the record cannot show (A5′).
    for (const [i, raw] of readArray(root['exposurePeaks'] ?? [], 'levy.exposurePeaks').entries()) {
      const where = `levy.exposurePeaks[${String(i)}]`;
      const o = readObject(raw, where);
      const row: ExposurePeakRow = {
        reckoning: readInt(o, 'reckoning', where),
        principal: readString(o, 'principal', where) as PrincipalId,
        peak: minor(readInt(o, 'peak', where)),
      };
      if (row.peak < 0) throw new SnapshotError(`${where}.peak is negative (${String(row.peak)})`);
      this.exposurePeaks.set(principalKey(row.reckoning, row.principal), row);
    }

    for (const raw of readArray(root['settled'] ?? [], 'levy.settled')) {
      if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) {
        throw new SnapshotError('levy.settled holds a non-integer Reckoning index');
      }
      this.settled.add(raw);
    }
  }
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
 * The Levy as a state table.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **REGISTERED UNCONDITIONALLY, AND THAT IS LOAD-BEARING.** The assessment decides what
 * a future tick does, so a `state_hash` that could not see it would call two worlds
 * identical while one of them owed 240 000 of goods and the other owed nothing — and a
 * halt would leave the book dirty for the next tick. The venture book and the election
 * map were both outside the hash and the abort path once, and a verifier found each.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `getBook` and `setBook` rather than a captured reference, for the same reason the
 * venture table takes them: the rollback **replaces** the object, and every reader must
 * go through the accessor or half the engine keeps talking to the pre-abort book.
 */
export function levyStateTable(getBook: () => Book, setBook: (book: Book) => void): StateTable {
  return {
    name: 'levy',
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
export function levyReckoningOf(tick: number): number {
  return reckoningIndex(tick);
}

export type { AllocationPlan };
