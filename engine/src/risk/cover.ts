/**
 * The COVER — RSK1, RSK3 and A7, over somebody else's loss.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ## What a COVER is, in one line
 *
 * **A7's two halves, written by one principal over another principal's goods.** The escrowed half
 * sits in an escrow account and executes without anybody deciding anything; the elective half is a
 * promise the payer may keep or break at the settlement, exactly like a venture's. That is the whole
 * design, and it is why the risk market costs **zero new verbs**: the promise shape, the escrow
 * account, the election and the default record all already existed for ventures, and this layer
 * points them at a different subject.
 *
 * ## Why the elective half is not optional (A7, §7.5)
 *
 * > *"Full escrow deletes the betrayal; zero escrow enables fake counterparties."*
 *
 * §7.5's argument transposes without a word changed: *"left elective, agents set it to zero —
 * escrow strictly dominates for the buyer of any promise — and then no trust is ever risked, A7 is
 * dead letter, and standing has nothing to accrue to."* So {@link COVER_ELECTIVE_BPS_FLOOR} is a
 * floor and not a default, and a COVER offered below it is refused with the reason.
 *
 * RSK3's three-mode ladder (`SECURED`/`RESERVED`/`PROMISE`) collapses into this one band on
 * purpose. Three named modes would be three spellings of one continuum, and §3 forbids a second
 * word for a concept that already has one: `escrowed` and `elective` *are* the ladder, and
 * `escrow_ratio_bps` is where a mode name would have been. RSK12 CUTS both monocultures, which is
 * precisely what a floor and a ceiling on one number do.
 *
 * ## The subject, and the whole reason contagion is possible
 *
 * ```
 * over: { GOODS, system, good }   →  a primary cover. Pays when a FRONT strikes those goods.
 * over: { COVER, cover }          →  a cover over a cover. Pays when THAT cover's INDEMNITY falls due.
 * ```
 *
 * One field, two shapes, and the second is RE1's facultative reinsurance without a second object.
 * That matters beyond elegance: it means a cover-on-a-cover has **the same two halves and the same
 * election**, so a reinsurer's refusal is the same kind of event as a primary's, renders with the
 * same signature, and lands on the same standing vector. `§16.12` #4 asks for *"typed Compacts with
 * elective fulfillment/default across defense, trade, insurance, and reinsurance… one failure can
 * propagate politically and financially"* — this is the smallest thing that delivers it.
 *
 * RE6's anti-spiral rules are {@link fingerprintOf} and {@link COVER_MAX_DEPTH}: a cession that
 * re-covers a risk already in its own chain is **refused**, not merely denied capital relief,
 * because a cycle in a settlement graph is an unbounded cascade and §15.2 forbids loops to
 * convergence.
 *
 * ## Insurable interest, and the false default it prevents (RSK1, CAT6, §15.4)
 *
 * A COVER may only be bound by a principal that **actually holds** the goods it names, at the
 * system it names, and **only one COVER may stand over one `(payee, system, good)`**. Both rules
 * are CAT6's conserved-interest registry, and the second is load-bearing for A5′ rather than for
 * fairness: two covers over one holding make Σ indemnity exceed the real loss, one payer is
 * unavoidably short, and *the record calls it a default*. That is the false-default problem arriving
 * through an economic hole rather than a race, and §15.4's five defences would not catch it, because
 * every individual settlement would be arithmetically correct.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { canonicalHash, type CanonicalValue } from '../core/canonical.js';
import type {
  AccountId,
  CoverId,
  EventId,
  GoodId,
  GrantId,
  PrincipalId,
  SystemId,
} from '../core/types.js';
import { BPS_ONE, addMinor, bps, minor, subMinor, type Bps, type Minor } from '../core/units.js';
import { reject, type WorldResult } from '../world/result.js';
import type { PinnedValuation } from '../venture/terms.js';
import {
  COVER_DEDUCTIBLE_BPS,
  COVER_ELECTIVE_BPS_CEILING,
  COVER_ELECTIVE_BPS_FLOOR,
  COVER_LIMIT_CEILING_BPS,
  COVER_MAX_DEPTH,
  COVER_MIN_LIMIT,
  COVER_WAIT_TICKS,
} from './params.js';

/**
 * Re-exported, not declared. The brand lives in `core/types.ts` beside `VentureId` and `GrantId`
 * because INV-17 has to name it — see the declaration for why.
 */
export type { CoverId } from '../core/types.js';

/**
 * A COVER's six states.
 *
 * `OFFERED → BOUND → ATTACHED → (STRUCK) → SETTLED | LAPSED`
 *
 *   - **`OFFERED`** — the payer has posted capacity and **the escrowed half is already in escrow**.
 *     See {@link offerCover} for why the money moves here rather than at bind.
 *   - **`BOUND`** — a payee has countersigned. Not yet covering anything: {@link COVER_WAIT_TICKS}
 *     has to pass first (CAT5's waiting period).
 *   - **`ATTACHED`** — live. Non-cancellable by either side for the rest of its term (CAT12).
 *   - **`STRUCK`** — a FRONT has taken its subject and an INDEMNITY is open.
 *   - **`SETTLED`** — the INDEMNITY was paid, part-paid or defaulted, and the row is history.
 *   - **`LAPSED`** — expired unbound, or expired without a front ever striking. The escrow goes
 *     home. **This is the payer's whole business model**: a premium earned for a promise that was
 *     never called, which is what makes writing cover a strategy rather than a donation.
 */
export type CoverState = 'OFFERED' | 'BOUND' | 'ATTACHED' | 'STRUCK' | 'SETTLED' | 'LAPSED';

export const LIVE_COVER_STATES: readonly CoverState[] = Object.freeze([
  'OFFERED',
  'BOUND',
  'ATTACHED',
  'STRUCK',
] as CoverState[]);

export function isLiveCover(state: CoverState): boolean {
  return LIVE_COVER_STATES.includes(state);
}

/** What a COVER is written over. Two shapes, one field. */
export type CoverSubject =
  | { readonly kind: 'GOODS'; readonly system: SystemId; readonly good: GoodId }
  | { readonly kind: 'COVER'; readonly cover: CoverId };

export interface CoverRecord {
  readonly id: CoverId;
  /** The principal that promises to pay. `venture/settlement.ts`'s word for this role. */
  readonly payer: PrincipalId;
  /** The principal it owes. `null` while `OFFERED` — an offer names no counterparty. */
  payee: PrincipalId | null;
  readonly over: CoverSubject;
  /** The most this COVER can ever pay. `escrowed + elective`, exactly. */
  readonly limit: Minor;
  /** What the payee pays for it, once, at bind. */
  readonly premium: Minor;
  readonly electiveBps: Bps;
  /** A7's certain half. Sits in {@link coverEscrow} from the moment the offer is posted. */
  readonly escrowed: Minor;
  /** A7's promise. Never escrowed, never automatic, and the only half standing accrues to. */
  readonly elective: Minor;
  state: CoverState;
  readonly offeredTick: number;
  boundTick: number | null;
  /** `boundTick + COVER_WAIT_TICKS`. Before this the COVER pays nothing (CAT5). */
  attachesTick: number | null;
  /**
   * When an **unbound** offer stops standing. RSK2's `valid_through_tick`.
   *
   * A second field and not the same one as {@link expiresTick}: see
   * {@link import('./params.js').COVER_OFFER_TTL_TICKS} for the bug that made this necessary, which was
   * every COVER lapsing before the FRONT it was written for landed.
   */
  readonly offerExpiresTick: number;
  /** When a **bound** COVER stops covering. Long enough to span a whole FRONT. */
  readonly expiresTick: number;
  termsHash: string | null;
  /**
   * §15.4's second defence, pinned exactly once at bind and compared at settlement.
   *
   * The same field, the same comparison and the same halt as `Venture.actedOnStateVersion`. The two
   * values a caller must not pass are documented on `SettleInput.actedOnStateVersion` and the
   * warning transfers verbatim.
   */
  actedOnStateVersion: number | null;
  /** The escrow account holding the certain half. */
  readonly escrow: AccountId;
  readonly valuation: PinnedValuation;
  readonly rulesVersion: number;
  /** 1 for a primary COVER; one more for each cession above it. Capped at {@link COVER_MAX_DEPTH}. */
  readonly depth: number;
  /** RE6's stable risk fingerprint. Equal fingerprints in one chain is a refused cycle. */
  readonly fingerprint: string;
  /** Cumulative over every settlement pass, exactly like a venture role's markers. */
  settledEscrowedMinor: Minor;
  settledElectiveMinor: Minor;
  readonly boundByGrant: GrantId | null;
  readonly actedBy: PrincipalId | null;
}

export class CoverError extends Error {}

// ── Ids and accounts ────────────────────────────────────────────────────────

/**
 * Content-derived, never a counter (DET-3, DET-5).
 *
 * ⚑ **Deliberately NOT `hash(tick, principal, ordinal)`, which is what a venture id is.** That
 * choice cost this project a production outage: because the ordinal is a *world-global* counter,
 * *"one action refused under changed rules renames every venture minted after it forever"*, and the
 * `posting`/`event` tables ended up holding rows from nine worlds. A COVER's id is a pure function
 * of its own terms, so a refusal elsewhere in the tick cannot rename it.
 */
export function coverId(tick: number, payer: PrincipalId, over: CoverSubject, limit: Minor): CoverId {
  const subject =
    over.kind === 'GOODS' ? `goods:${over.system}:${over.good}` : `cover:${over.cover}`;
  return `cover:${canonicalHash([
    'cover',
    tick,
    payer,
    subject,
    limit,
  ] as CanonicalValue).slice(0, 24)}` as CoverId;
}

/**
 * A COVER's escrow.
 *
 * The same `escrow:` prefix and the same shape as `ledger/accounts.ts:escrowAccount`, because it is
 * the same *kind* of thing and INV-2 sums both under `isWorldAccount('ESCROW')`. It is not that
 * function because that one is typed to a `VentureId`, and widening its signature to accept two
 * unrelated brands would make one function mean two things — which is the collision §3 exists to
 * prevent, arriving through a type parameter.
 */
export function coverEscrow(cover: CoverId, payer: PrincipalId): AccountId {
  return `escrow:${cover}:${payer}` as AccountId;
}

// ── The two halves ──────────────────────────────────────────────────────────

/**
 * Split a limit into A7's halves. Integer, and every minor unit is accounted.
 *
 * The elective half is computed and the escrowed half is the remainder, never the other way round.
 * Rounding *toward* the escrowed half is the direction that cannot manufacture a default: a unit
 * that lands in escrow is a unit that pays itself, and a unit that lands in the elective half is a
 * unit somebody can be recorded as having refused.
 */
export function halvesOf(limit: Minor, electiveBps: Bps): { escrowed: Minor; elective: Minor } {
  const elective = minor(Math.trunc((limit * electiveBps) / BPS_ONE));
  return { escrowed: subMinor(limit, elective), elective };
}

/** `escrowed / limit`, in bps. §7.5: *"the escrow ratio is published on the venture card."* */
export function escrowRatioBps(cover: CoverRecord): Bps {
  if (cover.limit <= 0) return bps(0);
  return bps(Math.trunc((cover.escrowed * BPS_ONE) / cover.limit));
}

// ── RE6's fingerprint ───────────────────────────────────────────────────────

/**
 * The risk this COVER ultimately stands behind, as a stable string.
 *
 * RE6: *"every exposure/layer carries a stable `risk_fingerprint` derived from event, peril,
 * subject, and coverage layer."* Here it is derived from the **primary subject** — the located goods
 * at the bottom of the chain — so every layer above shares it. That is what makes
 * {@link cycleInChain} a one-line check instead of a graph traversal, and what makes "four
 * apparently diversified houses passed the same storm risk in a circle" detectable rather than
 * merely regrettable.
 */
export function fingerprintOf(
  over: CoverSubject,
  parent: CoverRecord | undefined,
): string {
  if (over.kind === 'GOODS') return `${over.system}::${over.good}`;
  if (parent === undefined) throw new CoverError(`cover ${over.cover} is not in the book`);
  return parent.fingerprint;
}

/**
 * Would binding this cession put the same risk twice in one chain?
 *
 * Commons/Marches **forbid** it (RE6: *"Commons forbids circular same-fingerprint cession"*). This
 * engine forbids it everywhere and states why: RE6's Frontier allowance is *"may permit it but
 * grants zero capital relief and labels the loop"*, and this layer has no capital-relief model for
 * the allowance to bite on — so permitting the loop would buy an unbounded settlement graph for a
 * penalty that is not implemented. RE11 is the CUT and this is it.
 */
export function cycleInChain(chain: readonly CoverRecord[], candidatePayer: PrincipalId): boolean {
  return chain.some((c) => c.payer === candidatePayer);
}

// ── Offering (RSK2) ─────────────────────────────────────────────────────────

export interface OfferCoverInput {
  readonly tick: number;
  readonly payer: PrincipalId;
  readonly over: CoverSubject;
  readonly limit: Minor;
  readonly premium: Minor;
  readonly electiveBps: Bps;
  readonly offerExpiresTick: number;
  readonly expiresTick: number;
  readonly valuation: PinnedValuation;
  readonly rulesVersion: number;
  /** 1 for a primary; `parent.depth + 1` for a cession. */
  readonly depth: number;
  readonly fingerprint: string;
  readonly boundByGrant: GrantId | null;
  readonly actedBy: PrincipalId | null;
}

/**
 * Post capacity. **The escrowed half is committed here, not at bind**, and that is a decision.
 *
 * RSK2 wants a `FIRM` quote whose capacity is *"provisionally added to the book as if bound,
 * reserving policy collateral"*. §7.3 makes the same call one system over and gives the argument:
 * *"filling a role escrows the stake at fill time. Otherwise filling a slot is a free option and
 * sybils can hold a stage's entire capacity all day and no-show."*
 *
 * Two things follow, and both are the point:
 *
 *   1. **Published capacity is real capacity.** A payer cannot advertise cover it could not pay,
 *      so the offer board is not a list of lies and `max_direct_loss` on the affordance is exact.
 *   2. ★ **A15 becomes arithmetic rather than an argument.** The escrow is funded from
 *      `market/escrow.ts:freeCash`, which is `freeBalance − endowments.remaining` — so a fresh
 *      identity, whose whole balance is withheld endowment, can offer **zero**. The gate on writing
 *      cover is therefore *capital that is slashable*, exactly as A15 demands, and it is measured
 *      rather than asserted: see `scripts/risk-probe.ts`'s N = 1/4/16 sweep.
 */
export function offerCover(input: OfferCoverInput): WorldResult<CoverRecord> {
  if (input.limit < COVER_MIN_LIMIT) {
    return reject(
      'PROP-R1',
      `a COVER promises at least ${String(COVER_MIN_LIMIT)}; you offered ${String(input.limit)}. ` +
        'Below that the row costs more to publish than it could ever pay.',
    );
  }
  if (input.premium < 0) {
    return reject('PROP-R1', `a premium cannot be negative, got ${String(input.premium)}.`);
  }
  if (input.electiveBps < COVER_ELECTIVE_BPS_FLOOR) {
    return reject(
      'PROP-R2',
      `a COVER needs elective_bps >= ${String(COVER_ELECTIVE_BPS_FLOOR)} and you offered ` +
        `${String(input.electiveBps)}. The elective half is the only part standing can accrue to, so ` +
        'no promise in this game may be entirely secured — full escrow deletes the betrayal (A7).',
    );
  }
  if (input.electiveBps > COVER_ELECTIVE_BPS_CEILING) {
    return reject(
      'PROP-R2',
      `a COVER needs elective_bps <= ${String(COVER_ELECTIVE_BPS_CEILING)} and you offered ` +
        `${String(input.electiveBps)}. At least ${String(BPS_ONE - COVER_ELECTIVE_BPS_CEILING)} bps of ` +
        'every limit is escrowed, because zero escrow is how a counterparty with nothing sells cover.',
    );
  }
  if (input.depth > COVER_MAX_DEPTH) {
    return reject(
      'PROP-R5',
      `this would be layer ${String(input.depth)} of a chain and ${String(COVER_MAX_DEPTH)} is the ` +
        'limit. Past three layers a settlement graph stops being readable and starts manufacturing ' +
        'false diversification (RE6).',
    );
  }
  if (input.expiresTick <= input.tick || input.offerExpiresTick <= input.tick) {
    return reject('PROP-R1', 'a COVER must expire after the tick it is offered on.');
  }
  if (input.offerExpiresTick > input.expiresTick) {
    return reject(
      'PROP-R1',
      'an offer cannot stand longer than the COVER it offers. The two clocks are separate on purpose ' +
        '(see COVER_OFFER_TTL_TICKS) and this is the direction that would make the second one a lie.',
    );
  }

  const { escrowed, elective } = halvesOf(input.limit, input.electiveBps);
  const id = coverId(input.tick, input.payer, input.over, input.limit);
  const cover: CoverRecord = {
    id,
    payer: input.payer,
    payee: null,
    over: input.over,
    limit: input.limit,
    premium: input.premium,
    electiveBps: input.electiveBps,
    escrowed,
    elective,
    state: 'OFFERED',
    offeredTick: input.tick,
    boundTick: null,
    attachesTick: null,
    offerExpiresTick: input.offerExpiresTick,
    expiresTick: input.expiresTick,
    termsHash: null,
    actedOnStateVersion: null,
    escrow: coverEscrow(id, input.payer),
    valuation: input.valuation,
    rulesVersion: input.rulesVersion,
    depth: input.depth,
    fingerprint: input.fingerprint,
    settledEscrowedMinor: minor(0),
    settledElectiveMinor: minor(0),
    boundByGrant: input.boundByGrant,
    actedBy: input.actedBy,
  };
  cover.termsHash = coverTermsHash(cover);
  return { ok: true, value: cover };
}

// ── terms_hash (§15.4's third defence) ──────────────────────────────────────

/**
 * Everything a party is bound to, and **the valuation rule with its as-of tick**.
 *
 * §15.4: *"`terms_hash` includes the valuation rule *and* its as-of tick."* That clause is the one
 * that matters most here, and the reason is specific to a risk market: after a FRONT, the goods it
 * destroyed are scarce and their spot price spikes. Valuing the loss at the post-event mark would
 * inflate every INDEMNITY past the limit the payer agreed to, make the payer short through no act of
 * its own, and **record a default that the engine invented from a price move.** So the mark is
 * pinned at bind and the pin is inside the hash.
 *
 * The field set mirrors `venture/terms.ts:termsCanonical` deliberately, including writing nulls
 * explicitly — an absent key and a null key canonicalise differently, and *"a `terms_hash` mismatch
 * agents correctly read as a counterparty reneging."*
 *
 * **Not in the hash**, for the same reasons as a venture's: `boundByGrant`, `actedBy`, `state`, the
 * progress markers, and `payee` — a payee that countersigns is agreeing to the terms *it was shown*,
 * and those terms were published without its name on them.
 */
export function coverTermsHash(cover: CoverRecord): string {
  return canonicalHash(coverCanonical(cover));
}

export function coverCanonical(cover: CoverRecord): CanonicalValue {
  return {
    v: 1,
    cover: cover.id,
    payer: cover.payer,
    over:
      cover.over.kind === 'GOODS'
        ? { kind: 'GOODS', system: cover.over.system, good: cover.over.good, cover: null }
        : { kind: 'COVER', system: null, good: null, cover: cover.over.cover },
    limit: cover.limit,
    premium: cover.premium,
    electiveBps: cover.electiveBps,
    escrowed: cover.escrowed,
    elective: cover.elective,
    deductibleBps: COVER_DEDUCTIBLE_BPS,
    waitTicks: COVER_WAIT_TICKS,
    offeredTick: cover.offeredTick,
    offerExpiresTick: cover.offerExpiresTick,
    expiresTick: cover.expiresTick,
    depth: cover.depth,
    fingerprint: cover.fingerprint,
    rulesVersion: cover.rulesVersion,
    valuation: {
      asOfTick: cover.valuation.asOfTick,
      rule: {
        windowTicks: cover.valuation.rule.windowTicks,
        haircutBps: cover.valuation.rule.haircutBps,
        minIndependentQty: cover.valuation.rule.minIndependentQty,
        minIndependentPrints: cover.valuation.rule.minIndependentPrints,
        minDistinctPairs: cover.valuation.rule.minDistinctPairs,
      },
      marks: [...cover.valuation.marks]
        .sort((a, b) => (a.good < b.good ? -1 : a.good > b.good ? 1 : 0))
        .map((m) => ({ good: m.good, unitPrice: m.unitPrice })),
    },
  };
}

// ── Binding (RSK2's atomic bind) ────────────────────────────────────────────

export interface BindCoverInput {
  readonly cover: CoverRecord;
  readonly payee: PrincipalId;
  readonly tick: number;
  readonly echoedTermsHash: string;
  readonly stateVersion: number;
  /** What the payee actually holds of the named good at the named system, right now. */
  readonly interestQty: number;
  /** The pinned unit price of the named good, from the COVER's own valuation. */
  readonly unitPrice: Minor;
  /** True when some other live COVER already stands over this `(payee, system, good)`. */
  readonly interestTaken: boolean;
  readonly frontCoverFrozen: boolean;
}

/**
 * Countersign a COVER. Idempotent, exactly like `venture/venture.ts:countersign`.
 *
 * Five refusals, and each is a MUST item rather than a validation:
 *
 *   - **the echoed `terms_hash` must match** — §7.3's *"nothing binds until both parties countersign
 *     the same terms_hash"*, and the one thing that makes §15.4's third defence checkable;
 *   - **the payee must hold the goods** — RSK1's insurable interest: *"the insured must own,
 *     finance, carry, or owe replacement of the interest"*, which is what stops a naked bet on an
 *     enemy's loss (RE10 CUTS those outright);
 *   - **the limit may not exceed the pinned value of that interest** — RSK1's aggregate-indemnity
 *     ceiling, so nobody profits from being struck;
 *   - **the interest must be free** — CAT6's conserved registry. See the header: this is an A5′
 *     defence, not a fairness rule;
 *   - **the FRONT's cover window must be open** — CAT12, the free-option CUT.
 */
export function bindCover(input: BindCoverInput): WorldResult<CoverRecord> {
  const cover = input.cover;
  if (cover.state !== 'OFFERED') {
    return reject('PROP-R3', `cover ${cover.id} is ${cover.state}, not OFFERED, and cannot be bound.`);
  }
  if (input.tick > cover.offerExpiresTick) {
    return reject(
      'PROP-R3',
      `this offer stood until tick ${String(cover.offerExpiresTick)} and it is now ${String(input.tick)}. ` +
        'The escrow behind it has gone home.',
    );
  }
  if (input.payee === cover.payer) {
    return reject(
      'PROP-R4',
      'a principal cannot cover its own loss: the escrowed half would pay it back its own money and ' +
        'the elective half would be a promise to itself. Standing would accrue for nothing, which is ' +
        'A7 farmed at zero risk (§7.5).',
    );
  }
  if (cover.termsHash !== input.echoedTermsHash) {
    return reject(
      'PROP-W1',
      `the terms_hash you echoed is not this cover's. Yours: ${input.echoedTermsHash}; the cover's: ` +
        `${String(cover.termsHash)}. Nothing binds until both parties countersign the same terms_hash, ` +
        'and re-reading it is how you find out the terms moved.',
    );
  }
  if (input.frontCoverFrozen) {
    return reject(
      'PROP-R6',
      'this FRONT is IMMINENT and no longer accepts new COVER. Cover bought after the odds have ' +
        'resolved is not a transfer of risk, it is a free option — and the same rule stops the payer ' +
        'cancelling on bad news, which is the half that protects you (CAT12).',
    );
  }
  if (cover.over.kind === 'GOODS') {
    if (input.interestQty <= 0) {
      return reject(
        'PROP-R4',
        `you hold none of ${cover.over.good} at ${cover.over.system}, so you have no insurable ` +
          'interest to cover. A COVER pays for goods you actually lose; it is not a bet on somebody ' +
          "else's weather.",
      );
    }
    const interestValue = minor(input.interestQty * input.unitPrice);
    const ceiling = minor(Math.trunc((interestValue * COVER_LIMIT_CEILING_BPS) / BPS_ONE));
    if (cover.limit > ceiling) {
      return reject(
        'PROP-R4',
        `this cover's limit is ${String(cover.limit)} and your interest at the pinned mark is worth ` +
          `${String(ceiling)}. Cover may not exceed what you could lose, or being struck becomes ` +
          'profitable and the loss sink dies (RSK1).',
      );
    }
    if (input.interestTaken) {
      return reject(
        'PROP-R4',
        `another live COVER already stands over your ${cover.over.good} at ${cover.over.system}. One ` +
          'interest, one cover: two would make the total owed exceed the loss, one payer would be ' +
          'short through nobody\'s fault, and the record would call that a default (A5′).',
      );
    }
  }

  cover.payee = input.payee;
  cover.state = 'BOUND';
  cover.boundTick = input.tick;
  cover.attachesTick = input.tick + COVER_WAIT_TICKS;
  cover.actedOnStateVersion = input.stateVersion;
  return { ok: true, value: cover };
}

/** `BOUND` and seasoned. The one predicate that decides whether a COVER pays. */
export function isAttached(cover: CoverRecord, tick: number): boolean {
  if (cover.attachesTick === null) return false;
  if (tick < cover.attachesTick) return false;
  if (tick > cover.expiresTick) return false;
  return cover.state === 'BOUND' || cover.state === 'ATTACHED';
}

/** What is still owed of the certain half. Never negative. */
export function escrowedOutstanding(cover: CoverRecord): Minor {
  return minor(Math.max(0, cover.escrowed - cover.settledEscrowedMinor));
}

/** What is still owed of the promise. Never negative. */
export function electiveOutstanding(cover: CoverRecord): Minor {
  return minor(Math.max(0, cover.elective - cover.settledElectiveMinor));
}

/**
 * The **only** writer of the paid-so-far markers, so they can only grow.
 *
 * Copied from `venture/venture.ts:recordPaid` including this note, because the failure it guards is
 * the same: a second settlement pass that reports `escrowedPaid: 0` for a guaranteed half which
 * executed on the first pass is *the record denying A7's own claim*.
 */
export function recordCoverPaid(cover: CoverRecord, escrowed: Minor, elective: Minor): void {
  if (escrowed < 0 || elective < 0) {
    throw new CoverError(`a payment cannot be negative: ${String(escrowed)}/${String(elective)}`);
  }
  cover.settledEscrowedMinor = addMinor(cover.settledEscrowedMinor, escrowed);
  cover.settledElectiveMinor = addMinor(cover.settledElectiveMinor, elective);
  if (cover.settledEscrowedMinor > cover.escrowed || cover.settledElectiveMinor > cover.elective) {
    throw new CoverError(
      `cover ${cover.id} paid past its limit: ${String(cover.settledEscrowedMinor)}/` +
        `${String(cover.settledElectiveMinor)} against ${String(cover.escrowed)}/${String(cover.elective)}`,
    );
  }
}

/** For the receipt line and the frame caption. Bounded, so the payload's size is computable. */
export function coverLine(cover: CoverRecord): string {
  const subject =
    cover.over.kind === 'GOODS' ? `${cover.over.good}@${cover.over.system}` : `layer ${String(cover.depth)}`;
  return (
    `${cover.payer} covers ${String(cover.payee ?? 'anyone')} on ${subject}: ` +
    `${String(cover.escrowed)} escrowed, ${String(cover.elective)} on its word`
  );
}

/** Never used for control flow; the event id a settlement stamps its postings with. */
export function coverEventId(cover: CoverId, what: string, tick: number): EventId {
  return `${cover}:${what}:${String(tick)}` as EventId;
}
