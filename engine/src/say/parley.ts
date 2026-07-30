/**
 * PARLEY — **one typed act addressed to a named principal outside any shared venture.**
 *
 * §3 canon, added deliberately (HARD RULE 4). It is **not** a MESSAGE: a MESSAGE is a typed act
 * inside a hosted negotiation over a venture, and it declassifies **at that venture's settlement**.
 * A direct address has no settlement to wait for, so it needs a declassify rule of its own — and one
 * word carrying two declassify rules is exactly the trap §3 exists to prevent. It is not a DISPATCH
 * (the letter home to an owner) and not a DOSSIER (a signed extract of figures). It is the word for
 * talking across a line to somebody you are not in business with.
 *
 * The **verb is still `message`.** §17's budget is 40 of 40, and `message` already selects its object
 * by parameter — `{venture}` produces a MESSAGE, `{to, dossier}` hands a DOSSIER — with the argument
 * written out at `Runtime.vMessage`: *"§7.3's channel is between principals, a venture is merely its
 * usual subject."* `{to, act, text}` is the third object on the same verb, the same shape as
 * `deliver {payer}` and `build {kind:...}`.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ## 1. THE VISIBILITY TIER, ARGUED FROM §11.2's FIVE RUNGS
 *
 * **`PARTIES` while live, `PUBLIC` at `sent_tick + AUDIT_LAG_TICKS`.** Every other rung was
 * considered and each fails for a different reason:
 *
 *   - **`PUBLIC` at send** is `publish_offer`, which already exists. A second verb producing an
 *     instantly-public string would be one concept with two names — the other half of HARD RULE 4 —
 *     and it would delete the drama outright: §14's receipt reel needs *"every reassuring thing the
 *     traitor said"* to have been said **in confidence**. A promise made in public is a press
 *     release; one made in private and then broken is the signature moment of the design.
 *   - **`PRIVATE`** is "never published to anyone, including its owner". That would make the one
 *     channel most likely to carry betrayal-by-persuasion the one channel §14 can never quote, and
 *     `CLAUDE.md` §6 is explicit that hosting exists for the opposite reason: *"A conversation we
 *     cannot see is one the audience can never be shown."*
 *   - **`SENSED`** is keyed to a hand in range or bought intel. A parley has no location, so the
 *     tier's own gate is undefined for it.
 *   - **`SEALED`** is for statements about the *future*, dark because publishing them hands agents a
 *     tool for verifying each other's private commitments and stabilising a collusive standoff. A
 *     parley is a statement about now, `seal` already owns the other case, and SEALED content never
 *     reaches agents at all — which would make a coalition impossible to negotiate.
 *
 * So `PARTIES`, and the declassify clock has to be **absolute** because the event a MESSAGE waits for
 * does not exist here. `AUDIT_LAG_TICKS` is the clock the design already uses for exactly this shape:
 * a DOSSIER is `PARTIES` to the two who were there and becomes `PUBLIC` *"including to its subject"*
 * at `cut_tick + AUDIT_LAG_TICKS` — **one clock for all three readerships**, which is how A9 holds by
 * construction rather than by care. A parley reuses it rather than declaring a second number, because
 * two numbers is how four visibility leaks in this codebase happened.
 *
 * **A9, checked in the direction that matters.** The recipient reads it at `sent_tick`, because it is
 * addressed to it. Every other agent and every viewer read it together at `+AUDIT_LAG_TICKS`. So the
 * spectator strictly follows the recipient, and no agent — including the sender's target — is ahead
 * of the audience on anything except its own mail.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ## 2. THE PRICE, AND WHY IT IS A15-SAFE
 *
 * An open channel is a Sybil and spam vector, and A15 decides the design: enrolment is free and must
 * stay free, so if messaging is free and unbounded then N free identities are N × the volume and the
 * correct move for every agent is to broadcast at everybody. HARD RULE 5 lists the only legal prices:
 * **produced goods, slashable capital, or an independently-capitalised counterparty.**
 *
 * Two gates, answering two different attacks. They are not interchangeable and neither alone is
 * enough — that is the whole finding:
 *
 *   **(a) REACH answers the Sybil** (`say/reach.ts`). A free identity is standing in no live campaign
 *   and holds no grant, so its reach set is **empty** and it may address nobody. Measured, not argued:
 *   `test/say/parley-price.spec.ts` enrols ten fresh identities and counts 0 addressable recipients
 *   and 0 `message {to}` affordances across all ten, which is the same experiment
 *   `test/market/endowment.test.ts` runs against the endowment.
 *
 *   **(b) ENTITLEMENT answers the free door reach cannot close.** `join {side:"DEFENDER"}` is free by
 *   design (§16.6 MUST-9 — pricing the act of helping somebody hold their home would make the
 *   aggressor's side the cheaper one to be on), and it needs only a seat. So a free identity CAN put
 *   itself on a roster and inherit a constellation's worth of reach for nothing. {@link
 *   parleyAllowanceFor} closes exactly that: the allowance is **zero** unless the sender has either
 *
 *     · `standing.distinctCounterparties > 0` — it has honoured an **elective** promise with an
 *       independently-capitalised counterparty. This is HARD RULE 5's third price *verbatim*, it is
 *       already hardened against related parties (scar #9: self-dealing earns zero, and
 *       `StandingBook.apply` halts on a self-credit rather than writing it), and it is provably 0 on
 *       an empty journal.
 *     · or `freeCash > 0` — currency somebody actually **paid** it. D7's fourth property is
 *       `freeCash ≤ earned − transferredOut`, so this is unmintable by enrolling: the endowment is
 *       withheld in full, and a fresh identity reads 0 by construction.
 *
 *   Two terms rather than one because the first is the *strong* signal and the second is the
 *   *reachable* one: a belligerent that has been paid a wage but never settled an elective half should
 *   not be mute in its own war, and a principal whose entire surplus is locked in a campaign bond
 *   still has its standing. Both are individually A15-legal, so the disjunction is.
 *
 *   **(c) The cap EXPIRES UNSPENT**, which is §9's aggression capacity and its argument transfers
 *   without amendment: *"a budget that accumulates is a war chest."* A parley budget that banked would
 *   let an agent sit silent for ten Reckonings and then broadcast at the whole map on the night it
 *   mattered — which is a tariff, not a conversation. Expiry makes the cost of addressing somebody
 *   **the other person you gave up addressing this cycle**, and that is what makes the choice of
 *   recipient the decision. `aggressionRemaining` is the worked example and this is deliberately its
 *   shape, including the derivation: capacity is counted off the parley book rather than stored, so it
 *   is correct across a restart for free (A4 — uptime is never power) and there is no second home for
 *   a quantity the record already determines (scar #5).
 *
 * **What the price is NOT, and why.** Not an action from the per-tick budget: `message` is in
 * `FREE_VERBS` and the reason is written there — *"charging for talk starves the receipt reel, which
 * is the best artifact in the design"* — and metering per-tick actions is per-identity anyway, so N
 * enrolments buy N budgets and A15 is untouched. Not standing as a *precondition* in the sense of a
 * threshold: gating cold outreach on a large standing locks out precisely the agent that needs
 * allies, and the newcomer path would dead-end. Not a bond: `post_bond` reads `freeBalance`, not
 * `freeCash`, so a bond is **postable straight out of the withheld endowment** — which would make
 * "slashable capital" a gate a free identity can pay, and is the one candidate in the brief that
 * measurement rules out rather than taste.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ## 3. WHY THE BOOK IS A RING AND NOT A CAPTURED TABLE
 *
 * `talk` — the venture negotiation channel, which is the receipt reel's raw material and has exactly
 * this shape — is a `Ring<TalkEntry>` and has never been a state table or persisted. A parley follows
 * it, and the `DossierBook`'s argument for capture does **not** transfer: that argument is about
 * `revealsAtTick` being a *stored* field that a rolled-back or replayed world could publish on a
 * different tick than the one it actually published on. A parley's reveal is `tick + AUDIT_LAG_TICKS`
 * derived from the row's own tick, so there is no second number to drift, and a row that disappears on
 * restore takes its reveal with it.
 */

import { readString } from '../core/params.js';
import type { PrincipalId } from '../core/types.js';
import { minor, type Minor } from '../core/units.js';
import { reject, type Rejection, type WorldResult } from '../world/result.js';
import { reachTo, type ReachRow, type ReachWhy } from './reach.js';

/**
 * §7.3's five typed acts, lower case so they never read as canon terms.
 *
 * The **same five** a MESSAGE carries, deliberately: an `offer` across a line and an `offer` inside a
 * venture are the same speech act at different range, and a second vocabulary for the second channel
 * would be five more words to keep coherent forever for no gain. `assure` is the one that matters
 * most here — an unsecured promise made to somebody you have no venture with is A7's "priced part that
 * stays elective" with nothing escrowed at all.
 */
export const PARLEY_ACTS: readonly ['offer', 'counter', 'accept', 'decline', 'assure'] = Object.freeze([
  'offer',
  'counter',
  'accept',
  'decline',
  'assure',
] as const);

export type ParleyAct = (typeof PARLEY_ACTS)[number];

export function isParleyAct(s: string): s is ParleyAct {
  return (PARLEY_ACTS as readonly string[]).includes(s);
}

/** One parley, as the book stores it. */
export interface ParleyEntry {
  readonly from: PrincipalId;
  readonly to: PrincipalId;
  readonly act: ParleyAct;
  readonly text: string;
  readonly tick: number;
  /**
   * `tick + AUDIT_LAG_TICKS`. Stored so the row carries its own clock on every surface that reads
   * it, derived so it can never disagree with `tick`.
   */
  readonly revealsAtTick: number;
  /** The public situation that made the address legal, and its id. See {@link ReachRow}. */
  readonly why: ReachWhy;
  readonly about: string;
}

/**
 * Parleys one principal may SEND per Reckoning. *(calibrate)*
 *
 * Three, and the number is an argument rather than a round figure. One is not a negotiation — an
 * `offer` with no room to `counter` is an ultimatum. Two is `AGGRESSION_PER_RECKONING`, which prices
 * *starting a fight*; talking is meant to be cheaper than fighting or the design has inverted its own
 * preference. Three lets an agent open with two candidates and answer one of them inside a single
 * cycle, and is still far short of a constellation, so choosing **whom** remains the decision.
 */
export const PARLEYS_PER_RECKONING = 3;

/**
 * Characters of text one parley carries (INV-26).
 *
 * **The same 480 as `MAX_MESSAGE_LENGTH`, declared twice and pinned by a test rather than shared.**
 * Sharing it would mean importing from `sim/runtime.ts`, which imports this file — a cycle, for a
 * number. Two declarations of one published quantity is scar #5's shape, so the mitigation is the one
 * scar #5 actually asks for: `test/say/parley.spec.ts` asserts they are equal, and the day somebody
 * changes one the test names the other. `agent.md` promises agents a single figure for "how long a
 * message can be", and it must not become two.
 */
export const MAX_PARLEY_LENGTH = 480;

/**
 * Total cap on the parley book (INV-26).
 *
 * A bound, not a clock. `MAX_TALK_ENTRIES` is 512 for a channel every venture in the world shares;
 * this is the same order for the same reason, and the ring evicts oldest-first rather than refusing —
 * which is acceptable here and is *not* acceptable for a dossier, because a parley's evidentiary role
 * is the receipt reel (best-effort, and already ring-bounded for MESSAGEs) rather than a disclosure
 * somebody's record depends on.
 */
export const MAX_PARLEY_ENTRIES = 512;

/**
 * The two figures the entitlement is read off, so the refusal and the header block agree exactly.
 *
 * Named with their units per `one-word-two-units.spec.ts`: one is a **count of counterparties** and
 * one is **minor currency**, and a bare pair of integers side by side is that trap one payload later.
 */
export interface ParleyEntitlement {
  /** `standing.distinctCounterparties` — elective promises honoured with somebody new. */
  readonly distinctCounterparties: number;
  /**
   * `freeCash` — balance less every lock, less the endowment still unspent — **at its high-water
   * mark for the Reckoning containing this tick**, never as it stands this instant.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **A FIELD CALLED `per_reckoning` MUST MEAN PER RECKONING, AND THIS ONE DID NOT.**
   *
   * Measured by a player driving a real identity: `earned_minor` fell **1,629 → 0** and
   * `parleys_per_reckoning` fell **3 → 0** *between two reads*, because the principal escrowed
   * 12,000 into a venture in between. Both sends after it were refused under A15. Nothing was
   * wrong with the price; the **evaluation** was wrong. `freeCash` is
   * `max(0, freeBalance − endowmentRemaining)` and `vCreate` moves the escrow out of `stores` with
   * a `transferCurrency`, so an ordinary, legal, entirely intended act revoked the right to speak
   * mid-Reckoning, unannounced, from a field whose own name promised it would not.
   *
   * Note the company it kept: {@link inboundParleys} one field down already carried the note
   * *"Monotone within a Reckoning: it only ever rises, so it is a denominator rather than a
   * balance."* The file knew the distinction and this term was on the wrong side of it.
   *
   * ── WHY A HIGH-WATER MARK RATHER THAN A BOUNDARY SNAPSHOT ─────────────────
   *
   * A snapshot taken at the Reckoning boundary would mute a principal that earns its first
   * currency mid-cycle until the next one — a newcomer tax, and A15 says enrolment is free and
   * must stay free. The high-water mark opens the channel the moment the principal qualifies and
   * never closes it inside the cycle it opened in, which is the only reading under which the
   * published `refreshes_at_tick` is true.
   *
   * ── AND THE PRICE IS EXACTLY UNCHANGED, WHICH IS THE POINT ────────────────
   *
   * A maximum over a set of values that are all zero is zero. A free identity never holds free
   * cash at any tick of any Reckoning, so it never latches, and `reach 0 · allowance 0 · accepted
   * 0` still holds by hand and past the menu. The latch can only ever preserve an entitlement the
   * principal genuinely had — it cannot mint one.
   *
   * **Sampled once per tick for every principal**, in `Runtime.runTick`, and never lazily on read.
   * `WakeBook.rollTo` states the reason in as many words: *"a budget that rolled on first use would
   * give an agent that acted early in a Reckoning a different allowance from one that acted late,
   * which is A4 through a side door."* Latching on `observe` would be that with the axis changed
   * from *when you acted* to *how often you looked*, which is A4 through the same door.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly earnedMinor: Minor;
  /**
   * **Parleys** received this Reckoning. The third term, and it is not an entitlement — it is
   * capacity somebody else's priced allowance paid to create.
   *
   * ⚑ A **count of messages**, deliberately, and not the count of principals still waiting. The first
   * version of this used *unanswered senders* and it had a real bug: `remaining` is
   * `allowance − sent`, so an allowance that shrank as it was answered subtracted the same reply
   * twice. Measured on the arithmetic — a principal written to by **two** others could answer
   * **one** of them and was then mute to the second for the rest of the Reckoning, which is the
   * megaphone defect this term exists to prevent, one layer in.
   *
   * Monotone within a Reckoning: it only ever rises, so it is a denominator rather than a balance.
   */
  readonly inboundParleys: number;
}

/**
 * The high-water mark of {@link ParleyEntitlement.earnedMinor}, per principal, per Reckoning.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE SMALLEST THING THAT MAKES `per_reckoning` TRUE.** The argument for its existence is on
 * {@link ParleyEntitlement.earnedMinor}; this is the mechanism.
 *
 * Shaped on `tick/wake.ts`'s {@link import('../tick/wake.js').WakeBook} — a map cleared on the
 * Reckoning boundary, rolled from a **write** the world performs on a schedule rather than from a
 * read an agent chooses to make. That is the whole of its A4 safety and it is why {@link sample}
 * is separate from {@link highWater} instead of one lazily-latching accessor.
 *
 * ## Not captured, deliberately, and that is a smaller claim than it looks
 *
 * `Runtime.parleys` is a `Ring` that is itself neither captured nor persisted (`RULES_VERSION` 31
 * declared exactly that), so `parleysRemaining`'s `used` count already restarts at a restore and
 * the allowance is already restore-sensitive in the *generous* direction. A latch that restarts
 * with it is consistent with that treatment, degrades to the old live reading rather than to
 * something wrong, and is fully rebuilt within one tick of the next sample. Buying a captured
 * table for it would be a larger change than the defect, and A5 has nothing to say here: no row of
 * the permanent record is derived from this.
 * ══════════════════════════════════════════════════════════════════════════
 */
export class ParleyEntitlementBook {
  private readonly peak = new Map<PrincipalId, Minor>();
  private reckoning = -1;

  /**
   * Record what this principal holds now, if it is more than it has held before this Reckoning.
   *
   * Called for **every** principal once a tick, from the world's own clock. Callers pass
   * `reckoningOf` rather than importing it so this module stays free of the clock, which is the
   * same shape {@link parleysRemaining} uses.
   */
  sample(principal: PrincipalId, tick: number, earnedNow: Minor, reckoningOf: (t: number) => number): void {
    const here = reckoningOf(tick);
    if (here !== this.reckoning) {
      this.reckoning = here;
      this.peak.clear();
    }
    const seen = this.peak.get(principal) ?? 0;
    if (earnedNow > seen) this.peak.set(principal, earnedNow);
  }

  /**
   * The most this principal has held free this Reckoning, or `live` when nothing has been sampled.
   *
   * The fallback is the **live** figure and not zero, for A5′-adjacent reasons one layer down: a
   * book that answered 0 for an unsampled principal would revoke an entitlement the principal
   * demonstrably has, which is the defect this class exists to remove, reintroduced as its own
   * cold-start. `Math.max` against `live` also means a sample that has not landed yet can never
   * make the answer worse than the old behaviour.
   */
  highWater(principal: PrincipalId, tick: number, live: Minor, reckoningOf: (t: number) => number): Minor {
    if (reckoningOf(tick) !== this.reckoning) return live;
    return minor(Math.max(Number(live), Number(this.peak.get(principal) ?? 0)));
  }

  /** Principals latched this Reckoning. The meter, so "this never fires" is answerable. */
  get size(): number {
    return this.peak.size;
  }
}

/**
 * The allowance: `PARLEYS_PER_RECKONING` when entitled, otherwise **exactly enough to answer**.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A CHANNEL YOU CANNOT ANSWER IS A MEGAPHONE, AND THE FIRST VERSION OF THIS WAS ONE.**
 *
 * The entitlement prices **cold outreach** — the act of addressing somebody who did not ask to be
 * addressed. It has nothing to say about answering, and a flat `entitled ? N : 0` made every
 * unentitled recipient mute: measured on the campaign fixture, the ally an attacker recruited held
 * `freeCash` 0 and `distinct_counterparties` 0, so it could read *"I pay 20000 per hand"* and had no
 * way to say yes. That is precisely the defect `talksFor` closed for venture channels, with the arrow
 * reversed, and it would have shipped as *"the channel works between the already-connected"*.
 *
 * So an unentitled principal's allowance is the number of people **waiting on it**, capped at the
 * ordinary allowance. It cannot start a conversation and it can finish every one it is in.
 *
 * **Still A15-safe, and the argument is structural rather than numeric.** A free identity's reply
 * capacity is zero until some *other* principal spends its own priced capacity addressing it, so N
 * enrolments buy N × 0. The channel opens only where somebody who paid chose to open it, which is the
 * same shape that makes `join {side:"DEFENDER"}` free: the cost sits on the initiator, and no volume
 * exists that an initiator did not fund.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Binary in the entitled branch rather than scaled with standing, deliberately: an allowance that
 * grew with `distinctCounterparties` would be a second, unmeasured knob on a quantity the Levy and
 * the venture board already price, and A4 forbids anything that turns accumulated advantage into
 * throughput. What is bought here is *the right to speak first*, and that is a threshold.
 */
export function parleyAllowanceFor(
  entitlement: ParleyEntitlement,
  allowance: number = PARLEYS_PER_RECKONING,
): number {
  const entitled = entitlement.distinctCounterparties > 0 || entitlement.earnedMinor > 0;
  if (entitled) return allowance;
  return Math.min(allowance, Math.max(0, entitlement.inboundParleys));
}

/**
 * How many parleys this principal may still send in the Reckoning containing `tick`.
 *
 * Counts only sends **inside the same Reckoning**, which is what makes the allowance expire: last
 * cycle's silence buys nothing this cycle. Never negative — an over-send is a bug in the caller's
 * gate rather than a debt to carry, and a negative would silently net against next cycle.
 *
 * Structurally `aggressionRemaining`, and that is on purpose: two per-Reckoning allowances that
 * expire unspent should be counted by two functions with the same shape, or one of them will
 * eventually be counted per-tick by somebody reading only the other.
 */
export function parleysRemaining(
  entries: readonly ParleyEntry[],
  from: PrincipalId,
  tick: number,
  reckoningOf: (t: number) => number,
  allowance: number,
): number {
  return Math.max(0, allowance - parleysSent(entries, from, tick, reckoningOf).length);
}

/**
 * The sends themselves, in canonical recipient order — what {@link parleysRemaining} counts.
 *
 * Extracted rather than duplicated so the published `parleys_sent_this_reckoning` and the
 * allowance arithmetic cannot disagree about which rows are in the Reckoning (scar #5). Returns
 * recipients rather than entries: the *text* declassifies on `AUDIT_LAG_TICKS` and this block is
 * read by the sender at `sent_tick`, so handing back the row would put a tier decision in a
 * caller's hands.
 */
export function parleysSent(
  entries: readonly ParleyEntry[],
  from: PrincipalId,
  tick: number,
  reckoningOf: (t: number) => number,
): readonly PrincipalId[] {
  const here = reckoningOf(tick);
  const out: PrincipalId[] = [];
  for (const entry of entries) {
    if (entry.from !== from) continue;
    if (reckoningOf(entry.tick) !== here) continue;
    out.push(entry.to);
  }
  return out;
}

/**
 * The sentence an agent reads **before** it spends one, and the reason when it has none.
 *
 * A2: the arithmetic is exact and the *reason* is stated, because "you may not" without "and here is
 * what would change that" costs an agent an action every wake while it guesses. §9's capacity spent
 * this project's whole life reachable only through the refusal that fires when it hits zero, and the
 * docblock on `aggressionNote` records what that cost. This one is published at zero, at full, and at
 * **not entitled**, which is the third state that block did not have.
 */
export function parleyNote(
  remaining: number,
  allowance: number,
  entitlement: ParleyEntitlement,
  reachable: number,
): string {
  if (allowance === 0) {
    return (
      'You may START no conversation outside a venture you already share, and nobody is waiting on you. A ' +
      'parley reaches a principal you have never dealt with, and the right to send the FIRST one is priced: ' +
      'you need EITHER one elective promise honoured with a counterparty that is not you ' +
      '(`header.standing.standing.distinct_counterparties` above 0 — a fully escrowed venture earns a ' +
      'performance record and ZERO trust) OR currency somebody actually paid you. Enrolment mints neither: ' +
      'your starter stake is withheld from transfer, so it counts for nothing here. Settle one venture with ' +
      'an elective half and keep it, and this opens. Answering somebody who addresses you needs none of it ' +
      '— the price is always on whoever starts. The price is a deal, never another account (A15).'
    );
  }
  if (reachable === 0) {
    return (
      `You have ${String(remaining)} parley(s) of ${String(allowance)} this Reckoning and NOBODY to send them ` +
      'to. A parley reaches only principals the world already stands you beside: the attacker, the defender, ' +
      'the roster and the objective-constellation holders of a live campaign you are in, and the counterparty ' +
      'of a live grant. Declare or `join` a campaign, or `grant`, and the names appear in `affordances[]`. ' +
      'Unspent parleys DO NOT CARRY.'
    );
  }
  const coldEntitled = entitlement.distinctCounterparties > 0 || entitlement.earnedMinor > 0;
  if (!coldEntitled && remaining > 0) {
    // The reply-only state, named rather than left to be inferred from a smaller number. An agent
    // that reads "3 of 3" here and plans a recruiting round would find its second address refused
    // for a reason the count did not contain.
    return (
      `You may send ${String(remaining)} more reply(s) this Reckoning and START nothing: your allowance is the ` +
      `${String(entitlement.inboundParleys)} parley(s) sent TO you, capped at ${String(PARLEYS_PER_RECKONING)}. ` +
      'Answering is free of the entitlement — the price of a parley is always on whoever speaks first, and you ' +
      'may only answer principals that addressed you. To address somebody who has not, you need one elective ' +
      'promise honoured with a counterparty that is not you, or currency somebody paid you. None of this ' +
      'carries to the next Reckoning.'
    );
  }
  return remaining > 0
    ? `You may send ${String(remaining)} more parley(s) this Reckoning, of ${String(allowance)}, to any of ` +
        `${String(reachable)} reachable principal(s) named in \`affordances[]\`. Unspent capacity DOES NOT ` +
        'CARRY — what you do not use this cycle is gone, so the cost of addressing somebody is the other ' +
        'person you could have addressed instead. It is PARTIES-private to the two of you now and PUBLIC ' +
        'afterwards, printed beside what you both actually did.'
    : `You have sent all ${String(allowance)} of this Reckoning's parleys. It refreshes at the next Reckoning ` +
        'and does not accumulate: a budget that banked would let an agent stay silent for ten cycles and then ' +
        'broadcast at the whole map, which is a tariff rather than a conversation. Replies to you cost you ' +
        'nothing to READ, and a MESSAGE inside a venture you already share is free and unrationed.';
}

/**
 * §2's price as a standing block on `header`, present at zero, at full, and at not-entitled alike.
 *
 * On `header` for `aggression`'s reason and it is the same one: §17's observe budget is at ten of ten
 * (`OBSERVE_KEYS` is counted, not trusted), and `header` is where the payload keeps the facts about
 * the reader that hold regardless of what it is doing this tick — its clock, its budgets, its record.
 * A per-Reckoning allowance is a budget.
 *
 * Every numeric key carries its unit in its name. Two counts are denominated in **parleys**, one in
 * **principals**, one in **counterparties**, one in **minor currency** and two in **ticks**.
 */
export interface ParleyCapacity {
  /** Parleys this principal may still SEND in the Reckoning containing the observed tick. */
  readonly parleys_remaining: number;
  /** The whole allowance, so `remaining` has a denominator. Zero means not entitled. */
  readonly parleys_per_reckoning: number;
  /** How many principals `affordances[]` will name. Zero is a fact, not an omission. */
  readonly reachable_principals: number;
  /** The entitlement's first term. Above zero opens the allowance. */
  readonly distinct_counterparties: number;
  /** The entitlement's second term, in minor units. Above zero opens the allowance. */
  readonly earned_minor: Minor;
  /**
   * Principals that addressed you this Reckoning and have had no answer, in **principals**.
   *
   * The actionable count — how many conversations are open on your side. Not the allowance term; see
   * the field below, and {@link ParleyEntitlement.inboundParleys} for why they are two numbers.
   */
  readonly principals_awaiting_your_reply: number;
  /**
   * Parleys sent TO you this Reckoning, in **parleys**. The allowance term when you are not
   * otherwise entitled: you may answer as often as you were addressed, capped at the ordinary
   * allowance, and you may start nothing.
   */
  readonly parleys_received_this_reckoning: number;
  /**
   * ★ Parleys **you** sent this Reckoning, and who to. The sender's own record of its own acts.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **A SENT PARLEY LEFT NO TRACE ANYWHERE IN THE SENDER'S VIEW, WHICH IS THE WRONG
   * INSTRUMENTATION FOR A THREE-PER-RECKONING RESOURCE THAT EXPIRES UNSPENT.**
   *
   * Measured by a player: after sending, `last_parley` read `null`, `parleys_received` read `0` and
   * `talks[]` was empty — all three correct, because all three are about **inbound** mail
   * (`talks` is the venture MESSAGE ring and can never hold a parley at all). The only evidence
   * that an act had occurred was `parleys_remaining` dropping 3 → 2.
   *
   * `parleysVisibleTo` already returns the sender's own rows — `e.to === reader || e.from ===
   * reader` — and the observation layer discarded the outbound half with a single `continue`. So
   * this is not new data and not a new visibility tier: it is the half of a PARTIES-tier record
   * that its own author could not read. An agent budgeting a scarce, expiring, non-bankable
   * allowance has to be able to see what it spent it on, or the budget is a number that moves for
   * reasons it cannot reconstruct — A2's "never make an agent need a wiki", applied to its own
   * history.
   *
   * Deliberately on the **capacity block** rather than on the counterparty rows: this is the
   * denominator's other half and it belongs next to `parleys_remaining`, where
   * `remaining + sent === per_reckoning` is checkable by eye.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly parleys_sent_this_reckoning: number;
  /** Who you addressed this Reckoning, in canonical order. Empty is a fact, not an omission. */
  readonly parleyed_this_reckoning: readonly PrincipalId[];
  /** When the allowance resets. Absolute, so it compares directly against `header.tick`. */
  readonly refreshes_at_tick: number;
  /** Ticks a parley stays PARTIES-private before it publishes to everyone at once. */
  readonly declassifies_after_ticks: number;
  /** Always 0, published rather than implied: reading your mail is free, and so is replying. */
  readonly reading_costs_parleys: number;
  /** {@link parleyNote}, verbatim. The price and the expiry, in the payload that carries the count. */
  readonly rule: string;
}

/** What the gate reads. One home, two callers — the affordance and the verb (AGT-S2). */
export interface ParleyPort {
  readonly reach: (principal: PrincipalId) => readonly ReachRow[];
  readonly remaining: (principal: PrincipalId, tick: number) => number;
  /**
   * The three real figures, never a derived boolean.
   *
   * The first version of this port exposed `allowance(): number` and the two refusal branches
   * therefore **fabricated** an entitlement to hand {@link parleyNote} — `{distinctCounterparties: 0,
   * earnedMinor: 0}` in one and `{1, 0}` in the other, neither of them true of anybody. That is
   * `standingRow`'s hardcoded zero in miniature: *a constant that looks like data is worse than a
   * missing field*, and it would have printed "you need a kept elective promise" at an agent that had
   * three.
   */
  readonly entitlement: (principal: PrincipalId) => ParleyEntitlement;
  readonly isSeated: (principal: PrincipalId) => boolean;
  readonly bookSize: () => number;
}

/**
 * **Every gate on `message {to, act, text}`, in published order.** Called by the affordance and by
 * the verb, so a menu row the handler then refuses is impossible by construction rather than by
 * agreement — AGT-S2, and `campaignDeclareRefusalFor` is the precedent named for it.
 */
export function parleyRefusal(
  port: ParleyPort,
  from: PrincipalId,
  to: PrincipalId,
  tick: number,
): Rejection | null {
  if (to === from) {
    return reject(
      'A2',
      'you cannot parley yourself. Your own reasoning is PRIVATE and stays that way (§11.2) — nothing in ' +
        'this game publishes it, including to your owner.',
    );
  }
  if (!port.isSeated(to)) {
    return reject('A2', `there is no principal ${to} to address; name one that has enrolled and holds a seat.`);
  }
  const entitlement = port.entitlement(from);
  const allowance = parleyAllowanceFor(entitlement);
  const reach = port.reach(from);
  if (allowance === 0) {
    return reject('A15', parleyNote(0, 0, entitlement, reach.length));
  }
  const row = reachTo(reach, to);
  if (row === null) {
    return reject(
      'A15',
      `${to} is not reachable: the world does not stand the two of you in any live situation. An open ` +
        'directory of every enrolled principal is a gate priced in identities, which A15 forbids — so a ' +
        'parley reaches only the attacker, the defender, the roster and the objective-constellation holders ' +
        'of a live campaign you are standing in, and the counterparty of a live grant. `affordances[]` names ' +
        'every principal you may address, with the situation that makes each one legal. To reach somebody ' +
        'new, get into a situation with them: `join` their war on either side, or `grant` them something.',
    );
  }
  const remaining = port.remaining(from, tick);
  if (remaining <= 0) {
    return reject('A15', parleyNote(0, allowance, entitlement, reach.length));
  }
  if (port.bookSize() >= MAX_PARLEY_ENTRIES) {
    return reject(
      'INV-26',
      `the parley book holds ${String(MAX_PARLEY_ENTRIES)} entries, which is the declared cap. Nothing was spent.`,
    );
  }
  return null;
}

/** What the operation writes. */
export interface ParleyWritePort extends ParleyPort {
  readonly record: (entry: ParleyEntry) => void;
  readonly auditLagTicks: number;
}

/**
 * `message {to, act, text}` — send one parley.
 *
 * A pure function of its inputs plus one write, the shape `say.ts` and `offer.ts` established under
 * `D21`: the signature enumerates everything the operation can reach.
 */
export function parley(
  port: ParleyWritePort,
  from: PrincipalId,
  params: Readonly<Record<string, unknown>>,
  tick: number,
): WorldResult<ParleyEntry> {
  const to = readString(params, ['to', 'recipient']) as PrincipalId | null;
  if (to === null) {
    return reject(
      'A2',
      'a parley goes to exactly one named principal: {"to": "<principal>", "act": ' +
        '"offer|counter|accept|decline|assure", "text": "..."}. It is a letter, not a broadcast — say it in ' +
        'public with `claim` or `publish_offer` if that is what you meant.',
    );
  }
  const rawAct = readString(params, ['act', 'type']);
  if (rawAct === null || !isParleyAct(rawAct)) {
    return reject(
      'A2',
      `a parley carries one of the five typed acts — ${PARLEY_ACTS.join(' · ')} — the same five a MESSAGE ` +
        `inside a venture carries. Got ${rawAct === null ? 'nothing' : `"${rawAct}"`}.`,
    );
  }
  const text = readString(params, ['text', 'body']);
  if (text === null || text.length > MAX_PARLEY_LENGTH) {
    return reject(
      'INV-26',
      `a parley carries between 1 and ${String(MAX_PARLEY_LENGTH)} characters of text. An empty one spends ` +
        'capacity that does not carry and says nothing, and it publishes under your name either way.',
    );
  }
  const refusal = parleyRefusal(port, from, to, tick);
  if (refusal !== null) return refusal;
  // Non-null: `parleyRefusal` returns a rejection when it is not.
  const row = reachTo(port.reach(from), to);
  if (row === null) return reject('A15', `${to} is not reachable.`);

  const entry: ParleyEntry = {
    from,
    to,
    act: rawAct,
    text,
    tick,
    revealsAtTick: tick + port.auditLagTicks,
    why: row.why,
    about: row.about,
  };
  port.record(entry);
  return { ok: true, value: entry };
}

/**
 * The parleys one principal may READ at this tick.
 *
 * Three readerships, one predicate, and the order of the clauses is the A9 argument: the two parties
 * always, then everyone once the clock has run. A viewer's list is `reader: null`, which takes the
 * third clause alone — so a viewer is never ahead of a non-party agent, and a non-party agent is never
 * ahead of a viewer.
 */
export function parleysVisibleTo(
  entries: readonly ParleyEntry[],
  reader: PrincipalId | null,
  tick: number,
): readonly ParleyEntry[] {
  return entries.filter((e) => {
    if (reader !== null && (e.to === reader || e.from === reader)) return true;
    return tick >= e.revealsAtTick;
  });
}
