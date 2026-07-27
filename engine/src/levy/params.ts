/**
 * The Levy's published parameters. SPEC §17: **all calibrate.**
 *
 * `TRACKER.md` open question 2 is *"the Levy's allocation formula and total — too
 * small and turtling survives; too large and it is a treadmill. The one number that
 * most needs telemetry."* Every figure here is therefore a starting point for
 * simulation and is named so a sweep can move it in one place. None of them is a
 * claim of correctness.
 *
 * Three properties hold across every value in this file, and they are rules rather
 * than style:
 *
 *   1. **Integers only.** The Levy is a value path — it decides what is delivered,
 *      what is swept, and what is recorded unpaid — and a float in a value path
 *      cannot be reconciled (`core/units.ts`).
 *   2. **Durations in ticks.** DET-8's scale audit fails the build on any duration
 *      literal that is not in ticks or derived from `tickSeconds()`.
 *   3. **Nothing here is dodgeable by an agent.** The total is a function of the map
 *      and the roll, never of anybody's behaviour — that is what §5.2 means by
 *      *"the total is fixed by rule and cannot be dodged; that is the alarm."*
 */

import { MAX_PRINCIPALS, TICKS_PER_RECKONING, WINDOW_FIRST_PHASE } from '../core/time.js';
import type { GoodId } from '../core/types.js';
import { minor, qty, type Bps, type Minor, type Qty } from '../core/units.js';

/**
 * The good the Levy is payable in.
 *
 * §5.2: *"payable only in located goods physically delivered to a named place"* —
 * not money and not a service. §10.1's first sink is "hands consume a consumable per
 * venture — rations or fuel, one of the four goods", so the civic provisioning the
 * Levy funds (front suppression, gate maintenance, civic custody) is denominated in
 * the same consumable a hand eats.
 *
 * Lower case, and deliberately **not** `TRIBUTE`: §3 is a rules surface, the tribute
 * line is the pixel signature and nothing else may wear that word.
 */
export const LEVY_GOOD = 'ration' as GoodId;

/**
 * What one unit of the levy good discharges, in MINOR.
 *
 * §10.2's civic procurement values delivered Levy goods "at administered prices
 * within a band, budgeted per Reckoning and published in advance". One-for-one is
 * the simplest publishable band and it buys an arithmetic property worth more than
 * realism here: **no rounding exists between the assessment and the delivery**, so a
 * principal that delivers what it was asked for can never be recorded short by a
 * remainder. A5′ is a rounding bug away in every direction, and this deletes the
 * direction entirely.
 */
export const LEVY_UNIT_MINOR: Minor = minor(1);

/**
 * The rule-fixed duty of one ordinary principal, per Reckoning.
 *
 * **Additive in principals, never a pot divided among them**, and that is A15 rather
 * than arithmetic convenience: a fixed total shared out would mean each new identity
 * lowered everybody's share, which is a gate priced in identities. Here an extra
 * identity adds its own duty and lowers nobody's, so the only way to move burden is
 * the vote — politics — or delivery, which costs goods and presence.
 */
export const LEVY_DUTY_PER_PRINCIPAL: Minor = minor(20_000);

/**
 * The nominal rate a newcomer — or a principal the constellation votes to spare — is
 * assessed at.
 *
 * Non-zero on purpose. §5.2 has **no Commons exemption**: "every principal is
 * assessed; there is no Commons exemption, that is the whole point". A floor of zero
 * would take the protected principal off the docket, which is exactly the silence
 * INV-25 exists to make impossible.
 */
export const LEVY_NOMINAL_MINOR: Minor = minor(500);

/**
 * How much of every assessment must be carried by a hand rather than bought.
 *
 * §5.2: *"a fully purchasable Levy Coase-collapses exactly as predation would: three
 * principals with hands near the delivery place would run a delivery service at a
 * small premium, everyone would buy it, zero trust would be risked, zero standing
 * would accrue, and `LEVY SHORT` would sit flat every night."* PROP-LV3 attempts that
 * collapse against this number.
 */
export const LEVY_NON_ESCROWABLE_BPS = 3_000 as Bps;

/**
 * The tenure half of the newcomer floor, in ticks.
 *
 * Two Reckonings. Long enough that a first night and a full second day are protected
 * — §13's minute-60 checklist expects one Levy paid inside the first hour, and the
 * first hour must not also be the hour a maximum assessment lands.
 */
export const LEVY_NEWCOMER_TENURE_TICKS = TICKS_PER_RECKONING * 2;

/**
 * The capital half of the newcomer floor, in MINOR of free STORES.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **BOTH HALVES ARE REQUIRED — tenure AND capital.** This is the one design choice
 * in this file that closes an exploit rather than setting a level.
 *
 * §5.2 says "a principal below a tenure-and-capital threshold". Read as *either*
 * half, the floor becomes a switch every veteran can flip: spend your stores down
 * below the line before the assessment and you are floored for a nominal rate,
 * forever. Read as *both*, tenure is the gate — a principal past
 * {@link LEVY_NEWCOMER_TENURE_TICKS} is never floored however poor it is, and a
 * principal that arrived rich is not floored either.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const LEVY_NEWCOMER_CAPITAL_MINOR: Minor = minor(300_000);

/**
 * The share of a constellation's principals that must cast a ballot for the vote to
 * carry. Below it, the published default applies (§5.2).
 */
export const LEVY_QUORUM_BPS = 5_000 as Bps;

/**
 * Nominations a principal needs before the constellation is held to have spared it.
 *
 * Two, so sparing is a **coalition** rather than a unilateral opt-out. One would make
 * "spare me" a free verb and delete the politics the vote exists to create.
 */
export const LEVY_SPARE_MIN_NOMINATIONS = 2;

/**
 * Consecutive short Reckonings before Commons capacity demotes.
 *
 * §5.2's third protection is "chronic non-payment demotes Commons capacity, **and
 * that is all**" — so the word *chronic* has to mean something, and one bad night is
 * not it.
 */
export const LEVY_CHRONIC_STRIKES = 3;

/**
 * Concurrent venture roles a Commons-bound principal may hold, before any demotion.
 *
 * Equal to `HANDS_PER_PRINCIPAL` by intent rather than by import: capacity is what
 * the *holding* grants, and a hand is what fills it (§6.3 — "the Commons holding is
 * civic-leased, cannot be taken, and grants Commons-bound hands only"). Two names for
 * one number would be scar #5, so this one is stated and asserted equal in
 * `test/levy/chronic.test.ts` rather than derived. (That citation read
 * `test/levy/capacity.test.ts`, which has never existed; the assertion is real and is at
 * `chronic.test.ts:225`, but a doc pointing at a file nobody can open reads exactly like a
 * test that was never written.)
 */
export const LEVY_BASE_COMMONS_CAPACITY = 3;

/**
 * The floor under a demoted capacity. **Never zero.**
 *
 * A8: the Commons is a permanent floor, not a timer. A capacity of zero would be an
 * ejection dressed as a penalty, and §5.2 forbids the Levy costing identity, holding
 * or standing — of which the ability to act at all is the first.
 */
export const LEVY_MIN_COMMONS_CAPACITY = 1;

/**
 * The starter allotment of the levy good, sourced at enrolment.
 *
 * §6.1 mints "a starter stake of **bound goods**"; the build had issued that stake as
 * currency only, so there was nothing located anywhere for a goods-only obligation to
 * be paid in. Two and a half Reckonings' worth of duty: enough that a newcomer can
 * pay, and *not* enough that anybody can pay forever without production. That second
 * clause is the point — Phase 0 has no `PRODUCE` phase behind it, so a principal that
 * only ever delivers from stock runs dry, and `LEVY SHORT` starts to rise on its own.
 * Which is the meter working, not the model failing.
 */
export const LEVY_STARTER_ALLOTMENT: Qty = qty(50_000);

/**
 * The phase of the Reckoning cycle at which the assessment is minted and the next
 * cycle's ballot opens. Zero: the assessment stands for the whole cycle.
 *
 * Assessing at phase 0 is what makes every other guarantee reachable. The tribute
 * line is drawn "the moment a principal is assessed" and has to be on screen all day;
 * a standing intent needs ticks to fire in; and INV-24 runs in **every** tick's
 * ASSERT, so an assessment that appeared only near the freeze would leave the
 * invariant with nothing to check for 280 ticks of every cycle.
 */
export const LEVY_ASSESS_PHASE = 0;

/**
 * The phase at which the ballot for the **next** Reckoning closes.
 *
 * §5.2: *"**before** each Reckoning the constellation votes on how the total is
 * borne."* So a cycle's allocation is decided by the ballot held during the cycle
 * before it, and an assessment never moves once minted. Three things follow, and each
 * would be broken by tallying inside the cycle the allocation applies to:
 *
 *   - **Nobody is billed for goods already handed over.** A mid-cycle reallocation
 *     would have to either confiscate an overpayment (the goods are consumed and
 *     cannot be given back) or break INV-24's exact sum.
 *   - **The tribute line is stable.** Thickness is proportional to the amount owed,
 *     and a line whose thickness changed at phase 263 would render the vote as a
 *     glitch.
 *   - **An offline principal is never surprised.** R19's standing intent is set
 *     against a number that cannot move under it.
 *
 * It closes where the commitment window opens, so the last 24 ticks and the freeze
 * belong entirely to paying rather than to arguing.
 */
export const LEVY_BALLOT_CLOSES_PHASE = WINDOW_FIRST_PHASE;

/**
 * Numerator of the inverse-EXPOSURE weight, and the EXPOSURE unit added to its
 * denominator so that a zero-EXPOSURE principal has a finite weight.
 *
 * `w(p) = max(1, floor(NUM / (UNIT + exposure(p))))`, in integers, monotonically
 * decreasing in EXPOSURE and never zero. Never-zero matters: a weight of zero would
 * assess the most exposed principal at nothing at all, which is not "inversely to
 * Exposure" — it is an exemption, and the Levy has none.
 */
export const LEVY_INVERSE_WEIGHT_NUM = 1_000_000_000;
export const LEVY_EXPOSURE_UNIT = 1_000;

/**
 * Published caps on the arrays this module serialises (INV-26, scar #3).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **`MAX_LEVY_ASSESSMENTS` NO LONGER CAPS AN ASSESSMENT, AND MUST NOT AGAIN.**
 *
 * It used to, and the sentence here was *"bounded by the roll rather than by a guess, so
 * the cap is stated against the seat cap the API enforces"* — which was the bug written
 * down as a justification. A seat is the right to be **served** and `api/seats.ts`
 * recycles it; identity and the holding are never deleted (A10). So the roll is *lifetime*
 * enrolments, it grows without bound, and 512 was a cliff on it: at enrolment 513
 * `Book.assess` threw, `Runtime.assessLevyNow` caught, nothing at all was assessed,
 * `docketRowsFor` returned `[]`, and INV-25 halted the world once per principal —
 * permanently, since a re-run fails identically. Reachable through `POST /enroll`, which
 * is free and unauthenticated by design (A15).
 *
 * A plan holds one line per principal on the roll. The roll **is** the bound, so there is
 * nothing left here to declare, and `Book.assess`, `Book.admitLate` and `Book.enrolled`
 * take no cap. `test/levy/halt.test.ts` brackets the old cliff at 512 and 513.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * What it still names is the *size the ballot book is allowed to reach* and the figure the
 * old cliff sat at, which the regression test reads. `ballots` is one per principal per
 * cycle by construction — the book replaces a principal's ballot rather than appending —
 * and `castBallot`'s refusal reaches the agent as a hint from `vVote`, so it can refuse a
 * vote without stranding a Reckoning. That is the difference between the two caps.
 */
export const MAX_LEVY_ASSESSMENTS = 512;
/** Reckonings of Levy history kept in memory. The record is in the event ledger. */
export const LEVY_RETAINED_RECKONINGS = 3;

/**
 * ── DERIVED, BECAUSE A FLAT 512 BOUND BELOW THE POPULATION ───────────────────
 *
 * The ballot book keys one row per principal per Reckoning and keeps
 * {@link LEVY_RETAINED_RECKONINGS} of them, so its legitimate size is
 * `principals x retained`. At a flat 512 that bound at 512/3 ≈ 171 concurrently-voting
 * principals — below the {@link MAX_PRINCIPALS} the world seats. Past that point the first 171 to
 * vote filled the book and `castBallot` refused everyone else: a denial of the Levy ballot decided
 * by ARRIVAL ORDER, which is A4's "never let requests-per-second be power" arriving through the cap
 * table rather than through a verb.
 *
 * The extra Reckoning of headroom is not padding. A seat recycles only after four Reckonings of
 * silence (`SEAT_IDLE_TICKS`), which is longer than the three retained here — so within one
 * retention window a recycled seat's new occupant can cast a ballot while the previous occupant's
 * row is still held. `principals x (retained + 1)` covers that overlap by construction instead of by
 * hoping it does not happen.
 *
 * The cap still exists and still bounds growth (INV-26, scar #3). What it no longer does is bind
 * during legitimate play. And note the difference from `MAX_LEVY_ASSESSMENTS`, whose cap was
 * REMOVED from two paths after it produced an exploit and a halt: `castBallot`'s refusal reaches the
 * agent as a hint from `vVote` and strands nothing, which is why raising this one is the right fix
 * where removing that one was.
 */
export const MAX_LEVY_BALLOTS = MAX_PRINCIPALS * (LEVY_RETAINED_RECKONINGS + 1);
/** Tribute lines a frame may carry. One per assessed principal, and the map is the show. */
export const MAX_TRIBUTE_LINES = 512;
