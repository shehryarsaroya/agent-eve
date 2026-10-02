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
 * ## 3. THE BOOK WAS A RING OUTSIDE THE HASH, AND AT 41 IT IS A CAPTURED TABLE
 *
 * The original argument for leaving it uncaptured was sound for what it covered: a parley's reveal is
 * `tick + AUDIT_LAG_TICKS`, derived from the row's own tick, so no stored second number could drift.
 * What it did not cover is that **the gate reads the book**. Whether a principal may answer, and how
 * many conversations it has opened, are both counted off these rows — and an uncaptured book is
 * neither carried by a checkpoint nor rolled back by an aborted tick:
 *
 *   - **Adoption.** A booted world adopts the last Reckoning's checkpoint and replays the tail. While
 *     every count was scoped to the current Reckoning that was safe by accident: the checkpoint sits
 *     on the settlement tick, so every row the gate could read was in the replayed tail. The rolling
 *     answer window (§4 below) reaches back across the boundary, so a replayed answer to a letter
 *     from before the checkpoint would be refused — and because the tail past the last snapshot has
 *     no tripwire, the boot would SUCCEED into a world that had silently forked from its own journal.
 *     Measured in `test/durability/a-letter-survives-adoption.spec.ts`; A5′ through the boot path.
 *   - **Rollback.** An aborted tick drops its queued event rows; a ring entry pushed in that tick
 *     stayed, so a letter that never reached the record could still authorise an answer.
 *
 * So the book is now the `say` state table (`Runtime`, with the prose OFFER book beside it for the
 * same reason — the OFFER rung and the directory read offers across the boundary too). It is inside
 * `state_hash`, inside the abort path, and in `CHECKPOINT_REQUIRED_TABLES`. `talk`'s argument for
 * staying a ring still holds for `talk`: nothing gates on it across a Reckoning.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ## 4. ★ ANSWERS ARE FREE, OPENINGS ARE PRICED, AND THE WINDOW ROLLS (`RULES_VERSION` 41)
 *
 * §7.3 has said since v3.0: *"Push (a first message to a stranger) costs rate limit; replies inside a
 * thread are free."* The first version of this file priced both out of one allowance, and a blind
 * playtester sent two parleys to house characters and got **no answer to either** — three separate
 * defects lined up behind that silence, and this section is the two that live here (the third was the
 * cast's prompt dropping the inbox; see `cast/prompt.ts`):
 *
 *   1. **An entitled recipient answered out of its own opening allowance.** `remaining` was
 *      `allowance − sent`, and `sent` counted replies. A house character courted by four outsiders
 *      answered three and was then mute to the fourth for the rest of the Reckoning — and could start
 *      nothing of its own either. The busiest principal in the world was the quietest.
 *   2. **The reply right died at the Reckoning boundary.** A letter landing at tick 286 of 288 had to be
 *      answered inside two ticks, and the house cast wakes every eighteen. The rung the docblock above
 *      calls *"the one that keeps this a channel rather than a megaphone"* was a megaphone for any
 *      letter sent late in a cycle.
 *
 * So the allowance is split by what the send IS, and the split is §7.3's own:
 *
 *   - **An ANSWER** is a parley to a principal whose latest letter to you is still inside
 *     {@link PARLEY_ANSWER_WINDOW_TICKS} and has not been answered — a turn in a conversation the
 *     other side chose to be in. **Free of the opening allowance and of the entitlement.** Each letter
 *     buys exactly one answer, so a conversation proceeds turn by turn and never faster than the other
 *     side writes.
 *   - **An OPENING** is every other parley — a first approach, or a second letter before the other side
 *     has answered the first. It spends one of {@link PARLEYS_PER_RECKONING}, which is zero unless the
 *     sender is entitled, and which **expires unspent** at the Reckoning boundary exactly as before.
 *   - **A CEILING** of {@link MAX_PARLEYS_SENT_PER_RECKONING} sends of either kind per Reckoning, which
 *     is INV-26's bound on the book: it is per SENDER, so it is also what makes the book's size a
 *     function of the population rather than of the world's age (§5).
 *
 * **A15 is unchanged, and the argument is the structural one the first version already made for
 * replies.** A free identity's answer capacity is zero until another principal spends its own priced
 * opening on it, so N enrolments buy N × 0, and a turn-by-turn conversation is bounded by the side
 * that paid to open it. The opening price — the only thing a Sybil would want — has not moved.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ## 5. ★ THE BOOK ROLLS: A LETTER LEAVES IT ONCE EVERY WINDOW THAT READS IT HAS PASSED
 *
 * **The book held 512 letters for the WORLD'S WHOLE LIFE, and the 513th was refused.** It was a
 * `Ring` whose eviction the gate could not allow (§4's counts are read off it, so evicting a row
 * inside a window would hand a busy world free openings and free answers) and so it refused once
 * full instead. 512 letters is two days of twelve characters talking, or one morning of a launch with
 * a few hundred agents — after which nobody in the world could address anybody, for ever, and every
 * refusal said only *"the declared cap"*. Found by the Season 1 scale and contact lanes, both of
 * which flagged it rather than fixed it because the refusal was load-bearing for A15.
 *
 * **The fix keeps every reason the book exists and drops only the letters no reason reads.** Every
 * reader of the book is windowed, and the windows are few and short:
 *
 *   - the opening count, the sends ceiling and the received count — the Reckoning a letter was sent in;
 *   - the answer-once rule and the REPLY rung — {@link PARLEY_ANSWER_WINDOW_TICKS} from sending;
 *   - the map's thread (`Runtime.parleyLines`) — {@link PARLEY_THREAD_TICKS} from publication;
 *   - a correspondent's line in `counterparties[]` — whatever is still in the book, by definition.
 *
 * {@link parleyLastReadTick} is the latest of the first three for one letter, and `EXPIRE` — the phase
 * whose note is *"retire what timed out before anything can lock it"* — drops every letter whose last
 * reading tick has passed ({@link ParleyBook.retire}). Inside the hash and inside the abort path, like
 * the intent prune that phase already runs. Nothing is lost: the `say.parley` row is the permanent
 * record, PUBLIC from `revealsAtTick`, and the receipt reel reads the record.
 *
 * **And the cap is now a population book, not a lifetime one** (`test/core/capacity.spec.ts`). A
 * sender's letters still in the book were all sent inside one {@link PARLEY_RETAINED_TICKS}-tick
 * stretch, which touches at most {@link PARLEY_RECKONINGS_RETAINED} Reckonings, each capped at the
 * per-sender ceiling — so no principal ever has more than {@link PARLEYS_RETAINED_PER_PRINCIPAL} rows
 * in it, and {@link MAX_PARLEY_ENTRIES} is that times `MAX_PRINCIPALS`. The refusal stays, as INV-26's
 * tripwire, and it cannot fire on legitimate play below the world's ceiling: a principal that has sent
 * a letter has played, so its seat outlives the stretch its letters are kept for.
 *
 * **What A15 needed from the old refusal, it still has.** No count is ever taken over a row that has
 * left the book, because a row leaves only after the last tick any count could read it at — so the
 * openings, the answers and the ceiling bind exactly as before, which
 * `test/say/the-book-rolls.spec.ts` checks over a world that sends far more than 512 letters.
 *
 * **Indexed by principal, because the book can now be large.** Every count above reads ONE principal's
 * rows, so {@link ParleyPort.mailOf} hands over exactly the rows a principal sent or received, in book
 * order: an observation costs O(its own mail), never O(the world's mail), which is the shape the scale
 * lane removed the O(P²) burst for. The pure functions below take any such list — the whole book or one
 * principal's mail give the same answer, because each of them filters to that principal's rows first.
 */

import { readString } from '../core/params.js';
import { MAX_PRINCIPALS, TICKS_PER_RECKONING } from '../core/time.js';
import type { PrincipalId } from '../core/types.js';
import { minor, type Minor } from '../core/units.js';
import { AUDIT_LAG_TICKS } from '../grant/dossier.js';
import { reject, type Rejection, type WorldResult } from '../world/result.js';
import {
  PARLEY_CONSTELLATION_MIN_COUNTERPARTIES,
  REACH_LADDER_SENTENCE,
  constellationEarned,
  reachTo,
  type ReachRow,
  type ReachWhy,
} from './reach.js';

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
  /**
   * ★ True when this parley ANSWERED a letter (§4) and so spent no opening. Recorded at send rather
   * than re-derived, because "was this an answer" depends on the book as it stood at that moment, and
   * the opening count is a per-Reckoning sum over exactly this bit.
   */
  readonly answering: boolean;
}

/**
 * OPENINGS one principal may send per Reckoning — the right to speak first. *(calibrate)*
 *
 * Three, and the number is an argument rather than a round figure. One is not a negotiation — an
 * `offer` with no room to `counter` is an ultimatum. Two is `AGGRESSION_PER_RECKONING`, which prices
 * *starting a fight*; talking is meant to be cheaper than fighting or the design has inverted its own
 * preference. Three lets an agent open with three candidates inside a single cycle, and is still far
 * short of a constellation, so choosing **whom** remains the decision.
 *
 * ★ Since 41 this counts openings only (§4): an ANSWER spends none of it, so a principal that is
 * written to a great deal is no longer the one principal that cannot start anything.
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
 * ★ How long a letter stays answerable, in ticks. *(calibrate)*
 *
 * **One Reckoning-length, rolling — never cut at the boundary.** §4's second defect: a per-Reckoning
 * reply right gave a letter sent at tick 286 two ticks of life against an eighteen-tick wake. The
 * window still bounds the licence exactly the way the old scope did — a letter from last week buys
 * nothing — and it is the same length, so nothing that was answerable before stops being answerable.
 */
export const PARLEY_ANSWER_WINDOW_TICKS = TICKS_PER_RECKONING;

/**
 * ★ The ceiling on parleys one principal may SEND per Reckoning, answers and openings together
 * (INV-26). *(calibrate)*
 *
 * Twelve: three openings plus nine answers, which is a reply on most of a member's sixteen wakes. It is
 * a bound per SENDER, which is what makes the book's size a function of how many principals there are
 * rather than of how long the world has run (§5): two principals answering each other every tick can
 * fill only their own share of it, never anybody else's.
 */
export const MAX_PARLEYS_SENT_PER_RECKONING = 12;

/**
 * ★ How long a published letter stays on the map's thread (`Runtime.parleyLines`), in ticks from its
 * reveal: one Reckoning-length, so the frame a Reckoning closes on carries every letter that
 * declassified over it. One constant for the frame's window and the book's retention (§5), so the
 * thread can never ask for a letter the book has let go.
 */
export const PARLEY_THREAD_TICKS = TICKS_PER_RECKONING;

/**
 * ★ The last tick at which anything reads this letter off the book (§5), and so the last tick it is kept.
 *
 * The latest of the three windows the book serves: the Reckoning it was sent in (the opening count, the
 * sends ceiling, the received count), the answer window from its sending (the answer-once rule and the
 * REPLY rung), and the map's thread from its reveal. Derived from the letter's own two ticks, so it is
 * correct whatever the clock constants are; `test/say/the-book-rolls.spec.ts` checks each window against
 * it rather than this sentence.
 */
export function parleyLastReadTick(entry: Pick<ParleyEntry, 'tick' | 'revealsAtTick'>): number {
  const lastOfItsReckoning = entry.tick - (entry.tick % TICKS_PER_RECKONING) + TICKS_PER_RECKONING - 1;
  return Math.max(
    lastOfItsReckoning,
    entry.tick + PARLEY_ANSWER_WINDOW_TICKS,
    entry.revealsAtTick + PARLEY_THREAD_TICKS,
  );
}

/**
 * ★ The most ticks after its sending that any letter stays in the book: {@link parleyLastReadTick} for a
 * letter that reveals `AUDIT_LAG_TICKS` after it was sent, which is every letter `parley` writes.
 */
export const PARLEY_RETAINED_TICKS = Math.max(
  TICKS_PER_RECKONING - 1,
  PARLEY_ANSWER_WINDOW_TICKS,
  AUDIT_LAG_TICKS + PARLEY_THREAD_TICKS,
);

/**
 * ★ How many Reckonings one sender's letters still in the book can have been sent in: the most that any
 * run of `PARLEY_RETAINED_TICKS + 1` consecutive ticks touches. Three today — the stretch is 293 ticks,
 * five more than a Reckoning, so it can catch the tail of one, the whole of the next and the head of a
 * third.
 */
export const PARLEY_RECKONINGS_RETAINED = Math.floor((PARLEY_RETAINED_TICKS - 1) / TICKS_PER_RECKONING) + 2;

/** ★ The most rows one principal's SENT letters can occupy in the book: the ceiling, per Reckoning kept. */
export const PARLEYS_RETAINED_PER_PRINCIPAL = MAX_PARLEYS_SENT_PER_RECKONING * PARLEY_RECKONINGS_RETAINED;

/**
 * Total cap on the parley book (INV-26) — ★ **a population book, never a lifetime total** (§5).
 *
 * It used to be a flat 512 that the gate refused past, so the 513th parley of the world's life was the
 * last one anybody could send. Now a letter leaves the book once every window that reads it has passed
 * ({@link ParleyBook.retire}), no principal ever holds more than {@link PARLEYS_RETAINED_PER_PRINCIPAL}
 * rows, and this is that figure for every principal the world can hold — so the refusal is INV-26's
 * tripwire rather than a rationing rule, and it cannot fire on legitimate play below `MAX_PRINCIPALS`.
 * No row is preallocated: a world where nobody talks holds none.
 */
export const MAX_PARLEY_ENTRIES = PARLEYS_RETAINED_PER_PRINCIPAL * MAX_PRINCIPALS;

/** Unanswered letters `header.parley.awaiting_reply` quotes in full. The rest are counted. */
export const MAX_AWAITING_SHOWN = 4;

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
   * **Parleys** received this Reckoning. Published, and **no longer an allowance term** (§4).
   *
   * It used to fund the reply allowance of an unentitled principal — `min(3, received)` — and that
   * arithmetic already had to be repaired once: an allowance that shrank as it was answered subtracted
   * the same reply twice. Answers are now counted per LETTER rather than out of a pool, so there is no
   * pool to get wrong; the count stays on the header because *"how much mail did I get today"* is a
   * fact an agent budgets its wakes against.
   *
   * Monotone within a Reckoning: it only ever rises.
   */
  readonly inboundParleys: number;
}

const NO_MAIL: readonly ParleyEntry[] = Object.freeze([]);

/**
 * ★ THE PARLEY BOOK (§5) — every letter some window can still read, in book order, indexed by principal.
 *
 * Replaces a 512-row `Ring` that refused the 513th letter of the world's life. Three operations change
 * it and each keeps the one property every count depends on — **the rows are the book's own sequence**
 * (`owesAnswer` reads insertion order, never ticks, to decide which letter is "the latest"):
 *
 *   - {@link push} appends, and refuses past {@link MAX_PARLEY_ENTRIES} — a tripwire the gate asks
 *     about first, so reaching it here is a bug and it says so loudly rather than evicting a row a
 *     count reads;
 *   - {@link retire} drops the letters whose {@link parleyLastReadTick} has passed. Called from
 *     `EXPIRE`, so it is inside the hash and the abort path. Letters are sent in tick order and every
 *     one is retained for the same span, so the retired rows are always a PREFIX of the book — and of
 *     every principal's mail, which is in book order too;
 *   - {@link restore} replaces the contents from a capture and rebuilds the index, which is derived.
 *
 * {@link mailOf} is the reason for the index: every count is about one principal, so a reader walks
 * that principal's rows and never the world's.
 */
export class ParleyBook {
  private readonly rows: ParleyEntry[] = [];
  private readonly mail = new Map<PrincipalId, ParleyEntry[]>();
  private dropped = 0;

  constructor(private readonly cap: number = MAX_PARLEY_ENTRIES) {}

  /** Every letter still in the book, oldest first. */
  get all(): readonly ParleyEntry[] {
    return this.rows;
  }

  get size(): number {
    return this.rows.length;
  }

  /** Letters that have left the book since the world began — retired, never evicted. The meter. */
  get droppedCount(): number {
    return this.dropped;
  }

  /** The letters this principal sent or received that are still in the book, oldest first. */
  mailOf(principal: PrincipalId): readonly ParleyEntry[] {
    return this.mail.get(principal) ?? NO_MAIL;
  }

  push(entry: ParleyEntry): void {
    if (this.rows.length >= this.cap) {
      throw new Error(
        `the parley book is at its cap of ${String(this.cap)} rows; the gate refuses before this, so a push ` +
          'here is a bug — evicting a row a count still reads would hand out free openings (A15)',
      );
    }
    this.rows.push(entry);
    this.index(entry);
  }

  /**
   * Drop every letter whose last reading tick is before `tick`. Returns how many left.
   *
   * Walks from the front and stops at the first letter still read, so the cost is the letters retired
   * plus one. A letter cannot be read past {@link parleyLastReadTick}, and every reader of the book is
   * one of the windows that function takes the latest of, so no count changes by a row leaving.
   */
  retire(tick: number): number {
    let n = 0;
    for (const entry of this.rows) {
      if (parleyLastReadTick(entry) >= tick) break;
      n += 1;
    }
    if (n === 0) return 0;
    const gone = this.rows.splice(0, n);
    // Each principal's mail is in book order, so its retired rows are a prefix of it too: count, then
    // cut once, rather than shifting a popular principal's mail one letter at a time.
    const cut = new Map<PrincipalId, number>();
    for (const entry of gone) {
      cut.set(entry.from, (cut.get(entry.from) ?? 0) + 1);
      if (entry.to !== entry.from) cut.set(entry.to, (cut.get(entry.to) ?? 0) + 1);
    }
    for (const [principal, count] of cut) {
      const list = this.mail.get(principal);
      if (list === undefined) continue;
      list.splice(0, count);
      if (list.length === 0) this.mail.delete(principal);
    }
    this.dropped += n;
    return n;
  }

  /**
   * Replace the contents with a captured state — the inverse of reading {@link all} and
   * {@link droppedCount}. Refuses a capture larger than the cap, because a restore must never produce a
   * state `push` could not.
   */
  restore(items: readonly ParleyEntry[], dropped: number): void {
    if (items.length > this.cap) {
      throw new Error(`a parley book of cap ${String(this.cap)} cannot hold the ${String(items.length)} captured rows`);
    }
    this.rows.length = 0;
    this.mail.clear();
    for (const entry of items) {
      this.rows.push(entry);
      this.index(entry);
    }
    this.dropped = dropped;
  }

  private index(entry: ParleyEntry): void {
    this.mailFor(entry.from).push(entry);
    if (entry.to !== entry.from) this.mailFor(entry.to).push(entry);
  }

  private mailFor(principal: PrincipalId): ParleyEntry[] {
    let list = this.mail.get(principal);
    if (list === undefined) {
      list = [];
      this.mail.set(principal, list);
    }
    return list;
  }
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
 * The parley BOOK is captured since 41 (§3), because the gate reads it across a Reckoning boundary.
 * This latch does not need the same treatment, and the reason is its scope: it is cleared at every
 * Reckoning and re-sampled every tick from `freeCash`, which IS captured, so a booted world that
 * adopts the settlement-tick checkpoint rebuilds it tick for tick across the replayed tail. A table
 * for it would hash a quantity the ledger already determines, and A5 has nothing to say here: no row
 * of the permanent record is derived from this.
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
 * Is this principal entitled to speak FIRST — to send an OPENING (§4)?
 *
 * The two A15-legal terms of §2, unchanged since 31: an elective promise honoured to an
 * independently-capitalised counterparty, or currency somebody actually paid it.
 */
export function isEntitledToOpen(entitlement: ParleyEntitlement): boolean {
  return entitlement.distinctCounterparties > 0 || entitlement.earnedMinor > 0;
}

/**
 * Openings per Reckoning: {@link PARLEYS_PER_RECKONING} when entitled, **zero otherwise**.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A CHANNEL YOU CANNOT ANSWER IS A MEGAPHONE — AND ANSWERING NO LONGER COMES OUT OF THIS NUMBER.**
 *
 * This function used to return *"exactly enough to answer"* for an unentitled principal —
 * `min(3, parleys received)` — because answers and openings shared one pool. They do not any more
 * (§4): an answer is free of this allowance for everybody, so the allowance is what it always claimed
 * to price, **the right to speak first**, and an unentitled principal simply has none of it.
 *
 * The A15 argument is unchanged and still structural: a free identity's answer capacity is zero until
 * another principal spends its own priced opening on it, so N enrolments buy N × 0, and no volume
 * exists that an opener did not fund.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Binary rather than scaled with standing, deliberately: an allowance that grew with
 * `distinctCounterparties` would be a second, unmeasured knob on a quantity the Levy and the venture
 * board already price, and A4 forbids anything that turns accumulated advantage into throughput. What
 * is bought here is *the right to speak first*, and that is a threshold.
 */
export function parleyOpeningsFor(entitlement: ParleyEntitlement): number {
  return isEntitledToOpen(entitlement) ? PARLEYS_PER_RECKONING : 0;
}

/**
 * ★ Does `from` owe `to` an answer at `tick`? **The one predicate an ANSWER is decided by** (§4).
 *
 * True when `to`'s latest letter to `from` is still inside {@link PARLEY_ANSWER_WINDOW_TICKS} and
 * `from` has written nothing to `to` since. Order is the book's own insertion order, never the tick:
 * two letters landing in the same tick are applied in `(priority, principal_id, client_sequence)`
 * order, and comparing ticks would call both of them "at once" and let each side answer the other
 * for free forever inside one tick.
 *
 * `entries` is the book or `from`'s mail ({@link ParleyBook.mailOf}) — the same answer either way,
 * because only rows between the two of them are read and the mail keeps the book's order. The same is
 * true of every count below that names one principal.
 */
export function owesAnswer(
  entries: readonly ParleyEntry[],
  from: PrincipalId,
  to: PrincipalId,
  tick: number,
): boolean {
  let lastIn = -1;
  let lastOut = -1;
  for (const [index, entry] of entries.entries()) {
    if (entry.from === to && entry.to === from && entry.tick <= tick) lastIn = index;
    else if (entry.from === from && entry.to === to) lastOut = index;
  }
  if (lastIn < 0 || lastIn < lastOut) return false;
  const letter = entries[lastIn];
  return letter !== undefined && tick - letter.tick <= PARLEY_ANSWER_WINDOW_TICKS;
}

/**
 * ★ Every letter this principal has not answered yet, one per sender — the LATEST — newest first.
 *
 * This is what `header.parley.awaiting_reply` quotes and what the house cast's prompt puts at the top
 * of a wake. One home with {@link owesAnswer}: a letter is listed here exactly when sending to its
 * author would be an answer, so the inbox and the gate cannot disagree about who is waiting.
 */
export function lettersAwaitingAnswer(
  entries: readonly ParleyEntry[],
  reader: PrincipalId,
  tick: number,
): readonly ParleyEntry[] {
  const latestFrom = new Map<PrincipalId, number>();
  const answeredAt = new Map<PrincipalId, number>();
  for (const [index, entry] of entries.entries()) {
    if (entry.to === reader && entry.tick <= tick) latestFrom.set(entry.from, index);
    else if (entry.from === reader) answeredAt.set(entry.to, index);
  }
  const out: ParleyEntry[] = [];
  for (const [sender, index] of latestFrom) {
    if ((answeredAt.get(sender) ?? -1) > index) continue;
    const letter = entries[index];
    if (letter === undefined) continue;
    if (tick - letter.tick > PARLEY_ANSWER_WINDOW_TICKS) continue;
    out.push(letter);
  }
  // Newest first, then by sender, so two reads in one observation cannot disagree.
  return out.sort((a, b) => b.tick - a.tick || (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/**
 * The sends themselves, in canonical recipient order, inside the Reckoning containing `tick`.
 *
 * Extracted rather than duplicated so the published `parleys_sent_this_reckoning` and the ceiling
 * arithmetic cannot disagree about which rows are in the Reckoning (scar #5). Returns recipients
 * rather than entries: the *text* declassifies on `AUDIT_LAG_TICKS` and this block is read by the
 * sender at `sent_tick`, so handing back the row would put a tier decision in a caller's hands.
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
 * Openings this principal has spent in the Reckoning containing `tick`.
 *
 * Counts only sends **inside the same Reckoning**, which is what makes the allowance expire: last
 * cycle's silence buys nothing this cycle. Answers are excluded by the bit recorded at send.
 */
export function openingsSent(
  entries: readonly ParleyEntry[],
  from: PrincipalId,
  tick: number,
  reckoningOf: (t: number) => number,
): number {
  const here = reckoningOf(tick);
  let n = 0;
  for (const entry of entries) {
    if (entry.from !== from || entry.answering) continue;
    if (reckoningOf(entry.tick) === here) n += 1;
  }
  return n;
}

/**
 * How many OPENINGS this principal may still send in the Reckoning containing `tick`.
 *
 * Never negative — an over-send is a bug in the caller's gate rather than a debt to carry, and a
 * negative would silently net against next cycle. Structurally `aggressionRemaining`, on purpose: two
 * per-Reckoning allowances that expire unspent should be counted by two functions with the same shape.
 */
export function parleysRemaining(
  entries: readonly ParleyEntry[],
  from: PrincipalId,
  tick: number,
  reckoningOf: (t: number) => number,
  openings: number,
): number {
  return Math.max(0, openings - openingsSent(entries, from, tick, reckoningOf));
}

/** Sends of either kind still possible under the ceiling this Reckoning. */
export function sendsRemaining(
  entries: readonly ParleyEntry[],
  from: PrincipalId,
  tick: number,
  reckoningOf: (t: number) => number,
): number {
  return Math.max(0, MAX_PARLEYS_SENT_PER_RECKONING - parleysSent(entries, from, tick, reckoningOf).length);
}

/** The counts {@link parleyNote} is written from, named so the sentence and the block agree. */
export interface ParleyCounts {
  readonly openingsRemaining: number;
  readonly openingsPerReckoning: number;
  readonly answersOwed: number;
  readonly sendsRemaining: number;
  readonly reachable: number;
}

/**
 * The sentence an agent reads **before** it spends one, and the reason when it has none.
 *
 * A2: the arithmetic is exact and the *reason* is stated, because "you may not" without "and here is
 * what would change that" costs an agent an action every wake while it guesses. §9's capacity spent
 * this project's whole life reachable only through the refusal that fires when it hits zero, and the
 * docblock on `aggressionNote` records what that cost. This one is published at zero, at full, at
 * **not entitled**, at **somebody waiting**, and at **the ceiling** — every state an agent can be in.
 */
export function parleyNote(counts: ParleyCounts, entitlement: ParleyEntitlement): string {
  const answers =
    counts.answersOwed > 0
      ? `${String(counts.answersOwed)} principal(s) are waiting on your answer — header.parley.awaiting_reply ` +
        'quotes each letter, and answering is FREE: it spends no opening and needs no record. '
      : '';
  if (counts.sendsRemaining === 0) {
    return (
      `You have sent ${String(MAX_PARLEYS_SENT_PER_RECKONING)} parleys this Reckoning, which is the ceiling on ` +
      'answers and openings together. It refreshes at the next Reckoning. The ceiling is per sender, so no ' +
      'correspondent can crowd anybody else\'s letters out of the book every principal shares. A MESSAGE ' +
      'inside a venture you already share is free and unrationed.'
    );
  }
  if (!isEntitledToOpen(entitlement)) {
    return (
      answers +
      'You may START no conversation: the right to send the FIRST letter is priced, and you need EITHER one ' +
      'elective promise honoured with a counterparty that is not you (`header.standing.standing.' +
      'distinct_counterparties` above 0 — a fully escrowed venture earns a performance record and ZERO trust) ' +
      'OR currency somebody actually paid you. Enrolment mints neither: your starter stake is withheld from ' +
      'transfer, so it counts for nothing here. Settle one venture with an elective half and keep it, and this ' +
      'opens. Answering somebody who wrote to you needs none of it — the price is always on whoever starts. The ' +
      'price is a deal, never another account (A15).'
    );
  }
  const earned = constellationEarned(entitlement.distinctCounterparties)
    ? ' Your record has EARNED the constellation rung: anyone seated in your constellation is reachable.'
    : ` Honour elective promises to ${String(PARLEY_CONSTELLATION_MIN_COUNTERPARTIES)} distinct counterparties ` +
      `(you have ${String(entitlement.distinctCounterparties)}) and anyone seated in your constellation becomes ` +
      'reachable.';
  if (counts.reachable === 0) {
    return (
      answers +
      `You have ${String(counts.openingsRemaining)} opening(s) of ${String(counts.openingsPerReckoning)} this ` +
      `Reckoning and NOBODY to send them to. ${REACH_LADDER_SENTENCE} Join a raid or a campaign, finish a ` +
      'venture with somebody, sit in a syndicate, or `grant`, and the names appear in `affordances[]`.' +
      earned +
      ' Unspent openings DO NOT CARRY.'
    );
  }
  if (counts.openingsRemaining > 0) {
    return (
      answers +
      `You may open ${String(counts.openingsRemaining)} more conversation(s) this Reckoning, of ` +
      `${String(counts.openingsPerReckoning)}, with any of ${String(counts.reachable)} reachable principal(s) — ` +
      '`affordances[]` names the first few and `counterparties[].parley_reach` says why each is legal. Unspent ' +
      'openings DO NOT CARRY — what you do not use this cycle is gone, so the cost of addressing somebody is the ' +
      'other person you could have addressed instead. Every letter is PARTIES-private to the two of you now and ' +
      'PUBLIC afterwards, printed beside what you both actually did.' +
      earned
    );
  }
  return (
    answers +
    `You have opened all ${String(counts.openingsPerReckoning)} of this Reckoning's conversations. Openings refresh ` +
    'at the next Reckoning, unspent ones DO NOT CARRY, and nothing accumulates: a budget that banked would let an agent stay silent for ten ' +
    'cycles and then broadcast at the whole map, which is a tariff rather than a conversation. ANSWERING is still ' +
    'free — a letter written to you buys one answer whatever your openings — and a MESSAGE inside a venture you ' +
    'already share is free and unrationed.'
  );
}

/**
 * One unanswered letter, as `header.parley.awaiting_reply` quotes it to its recipient.
 *
 * A9: this is the reader's own mail — the one thing a party sees ahead of the audience — and
 * `publishes_at_tick` is the tick every agent and every viewer read it together. The text is the
 * sender's own words, delivered verbatim and binding nothing (§7.3: *"prose never executes"*).
 */
export interface AwaitingLetter {
  readonly from: PrincipalId;
  readonly act: ParleyAct;
  readonly text: string;
  readonly tick: number;
  readonly publishes_at_tick: number;
  /** The last tick an answer to this letter is free. After it, writing back is an opening. */
  readonly answer_by_tick: number;
  /** The situation the sender wrote to you under. */
  readonly why: ReachWhy;
  readonly about: string;
}

/**
 * §2's price as a standing block on `header`, present at zero, at full, and at not-entitled alike.
 *
 * On `header` for `aggression`'s reason and it is the same one: §17's observe budget is at eleven of eleven
 * (`OBSERVE_KEYS` is counted, not trusted), and `header` is where the payload keeps the facts about
 * the reader that hold regardless of what it is doing this tick — its clock, its budgets, its record.
 * A per-Reckoning allowance is a budget, and **the mail is on it too** since 41: `header` is the one
 * key the house cast's prompt never drops (`cast/prompt.ts:DROP_ORDER`), and an inbox that lived only
 * in `counterparties[]` was the second key that prompt dropped when an observation ran long — which is
 * the third reason a playtester's two parleys to house characters went unanswered.
 *
 * Every numeric key carries its unit in its name: counts in **parleys**, **principals** or
 * **counterparties**, one in **minor currency**, and the clocks in **ticks**.
 */
export interface ParleyCapacity {
  /**
   * Parleys you could still send right now, if you used every right you hold: the openings you have
   * left plus one answer per letter waiting on you, under the ceiling. The single number to budget
   * a wake against; the parts are below.
   */
  readonly parleys_remaining: number;
  /** OPENINGS per Reckoning — the right to speak first. Zero means not entitled. */
  readonly parleys_per_reckoning: number;
  /** ★ OPENINGS left this Reckoning. Expire unspent at `refreshes_at_tick`. */
  readonly openings_remaining: number;
  /**
   * Principals whose latest letter to you is unanswered and still inside the answer window, in
   * **principals**. Each is owed exactly one free answer.
   */
  readonly principals_awaiting_your_reply: number;
  /** ★ Those letters, newest first, quoted in full — at most {@link MAX_AWAITING_SHOWN}. */
  readonly awaiting_reply: readonly AwaitingLetter[];
  /** ★ Letters waiting on you beyond what `awaiting_reply` quotes. Their senders are in `counterparties[]`. */
  readonly awaiting_reply_unlisted: number;
  /** ★ Sends of either kind left under the per-Reckoning ceiling. */
  readonly sends_remaining_this_reckoning: number;
  /** ★ The ceiling itself, so the count above has a denominator. */
  readonly max_sends_per_reckoning: number;
  /** How many principals you may address at all. Zero is a fact, not an omission. */
  readonly reachable_principals: number;
  /** ★ The EARNED rung: whether your record has opened your whole constellation, and its price. */
  readonly constellation_reach: {
    readonly earned: boolean;
    readonly distinct_counterparties_needed: number;
    /** Your holding's constellation, or null for an unseated principal. */
    readonly constellation: string | null;
  };
  /** The entitlement's first term. Above zero opens the allowance. */
  readonly distinct_counterparties: number;
  /** The entitlement's second term, in minor units. Above zero opens the allowance. */
  readonly earned_minor: Minor;
  /** Parleys sent TO you this Reckoning, in **parleys**. Informational since 41 — see §4. */
  readonly parleys_received_this_reckoning: number;
  /**
   * ★ Parleys **you** sent this Reckoning, answers and openings together, and who to. The sender's
   * own record of its own acts.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **A SENT PARLEY LEFT NO TRACE ANYWHERE IN THE SENDER'S VIEW, WHICH IS THE WRONG
   * INSTRUMENTATION FOR A RESOURCE THAT EXPIRES UNSPENT.**
   *
   * Measured by a player: after sending, `last_parley` read `null`, `parleys_received` read `0` and
   * `talks[]` was empty — all three correct, because all three are about **inbound** mail
   * (`talks` is the venture MESSAGE ring and can never hold a parley at all). The only evidence
   * that an act had occurred was `parleys_remaining` dropping 3 → 2. `parleysVisibleTo` already
   * returned the sender's own rows and the observation layer discarded them with one `continue`, so
   * this is not new data and not a new visibility tier: it is the half of a PARTIES-tier record its
   * own author could not read.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly parleys_sent_this_reckoning: number;
  /** Who you addressed this Reckoning, in canonical order. Empty is a fact, not an omission. */
  readonly parleyed_this_reckoning: readonly PrincipalId[];
  /** When the OPENINGS and the ceiling reset. Absolute, so it compares directly against `header.tick`. */
  readonly refreshes_at_tick: number;
  /** ★ Ticks a letter stays answerable for free. Rolling — never cut at a Reckoning boundary. */
  readonly answer_window_ticks: number;
  /** Ticks a parley stays PARTIES-private before it publishes to everyone at once. */
  readonly declassifies_after_ticks: number;
  /** Always 0, published rather than implied: reading your mail is free. */
  readonly reading_costs_parleys: number;
  /** ★ Always 0, published rather than implied: answering a letter spends no opening. */
  readonly answering_costs_openings: number;
  /** {@link parleyNote}, verbatim. The price and the expiry, in the payload that carries the count. */
  readonly rule: string;
}

/** What the gate reads. One home, two callers — the affordance and the verb (AGT-S2). */
export interface ParleyPort {
  readonly reach: (principal: PrincipalId) => readonly ReachRow[];
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
  /**
   * ★ The book's rows this principal sent or received, oldest first ({@link ParleyBook.mailOf}).
   * Answers and openings are both counted off it (§4), and every count is about one principal, so the
   * port hands over exactly those rows: O(its own mail), never O(the world's) (§5).
   */
  readonly mailOf: (principal: PrincipalId) => readonly ParleyEntry[];
  readonly reckoningOf: (tick: number) => number;
  readonly isSeated: (principal: PrincipalId) => boolean;
  readonly bookSize: () => number;
}

/** The capacity block's clocks, passed in so this module stays free of the runtime's config. */
export interface ParleyClock {
  readonly ticksPerReckoning: number;
  readonly auditLagTicks: number;
  /** The reader's holding's constellation, for `constellation_reach`. */
  readonly constellation: string | null;
}

/** The counts the gate, the note and the header block all read. One home (scar #5). */
export function parleyCountsFor(port: ParleyPort, principal: PrincipalId, tick: number): ParleyCounts {
  return countsWith(port, principal, tick, port.entitlement(principal), port.reach(principal).length);
}

/**
 * §2's price as a standing block on `header` — built here rather than in the runtime so the block,
 * the gate and the note share one set of counts.
 */
export function parleyCapacityFor(
  port: ParleyPort,
  principal: PrincipalId,
  tick: number,
  clock: ParleyClock,
): ParleyCapacity {
  const entries = port.mailOf(principal);
  const entitlement = port.entitlement(principal);
  const counts = parleyCountsFor(port, principal, tick);
  const waiting = lettersAwaitingAnswer(entries, principal, tick);
  const sent = parleysSent(entries, principal, tick, port.reckoningOf);
  return {
    parleys_remaining: Math.min(counts.sendsRemaining, counts.openingsRemaining + counts.answersOwed),
    parleys_per_reckoning: counts.openingsPerReckoning,
    openings_remaining: counts.openingsRemaining,
    principals_awaiting_your_reply: counts.answersOwed,
    awaiting_reply: waiting.slice(0, MAX_AWAITING_SHOWN).map((letter) => ({
      from: letter.from,
      act: letter.act,
      text: letter.text,
      tick: letter.tick,
      publishes_at_tick: letter.revealsAtTick,
      answer_by_tick: letter.tick + PARLEY_ANSWER_WINDOW_TICKS,
      why: letter.why,
      about: letter.about,
    })),
    awaiting_reply_unlisted: Math.max(0, waiting.length - MAX_AWAITING_SHOWN),
    sends_remaining_this_reckoning: counts.sendsRemaining,
    max_sends_per_reckoning: MAX_PARLEYS_SENT_PER_RECKONING,
    reachable_principals: counts.reachable,
    constellation_reach: {
      earned: constellationEarned(entitlement.distinctCounterparties),
      distinct_counterparties_needed: PARLEY_CONSTELLATION_MIN_COUNTERPARTIES,
      constellation: clock.constellation,
    },
    distinct_counterparties: entitlement.distinctCounterparties,
    earned_minor: entitlement.earnedMinor,
    parleys_received_this_reckoning: entitlement.inboundParleys,
    parleys_sent_this_reckoning: sent.length,
    // Deduplicated and canonically ordered: two parleys to one principal is one conversation,
    // and `compareIds`' byte order is the repo's one ordering for principal ids (never a bare `.sort()`).
    parleyed_this_reckoning: [...new Set(sent)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    refreshes_at_tick: tick - (tick % clock.ticksPerReckoning) + clock.ticksPerReckoning,
    answer_window_ticks: PARLEY_ANSWER_WINDOW_TICKS,
    declassifies_after_ticks: clock.auditLagTicks,
    reading_costs_parleys: 0,
    answering_costs_openings: 0,
    rule: parleyNote(counts, entitlement),
  };
}

/**
 * **Every gate on `message {to, act, text}`, in published order.** Called by the affordance and by
 * the verb, so a menu row the handler then refuses is impossible by construction rather than by
 * agreement — AGT-S2, and `campaignDeclareRefusalFor` is the precedent named for it.
 *
 * The order is the order an agent can act on: who, then the ceiling (nothing else matters past it),
 * then whether this send is an ANSWER — which needs nothing more — and only then the three walls an
 * OPENING has to clear: the entitlement, the reach, and the openings left.
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
  const entries = port.mailOf(from);
  const entitlement = port.entitlement(from);
  // Reach is the one expensive read, so it is taken at most once and only where it decides
  // something: an ANSWER needs none of it, and a refusal note needs only its length.
  let reachRows: readonly ReachRow[] | null = null;
  const reach = (): readonly ReachRow[] => (reachRows ??= port.reach(from));
  const note = (): string => parleyNote(countsWith(port, from, tick, entitlement, reach().length), entitlement);

  if (sendsRemaining(entries, from, tick, port.reckoningOf) <= 0) return reject('INV-26', note());
  // ── INV-26's TRIPWIRE, NOT A RATION (§5) ─────────────────────────────────
  //
  // The book is population-sized and rolls, so this cannot fire on legitimate play below the world's
  // ceiling. It used to be the 513th letter of the world's life, refused for ever.
  if (port.bookSize() >= MAX_PARLEY_ENTRIES) {
    return reject(
      'INV-26',
      `the parley book holds ${String(MAX_PARLEY_ENTRIES)} letters still inside a window, which is its cap for ` +
        'a world at its ceiling of principals. Nothing was spent; letters leave it as their windows pass.',
    );
  }
  // ── AN ANSWER NEEDS NOTHING MORE ─────────────────────────────────────────
  //
  // `owesAnswer` implies the REPLY rung (the letter is inside the window, which is exactly what
  // `approachedBy` reads), so reach is satisfied by construction and the entitlement is not asked:
  // the price of a conversation is on whoever started it.
  if (owesAnswer(entries, from, to, tick)) return null;

  if (!isEntitledToOpen(entitlement)) return reject('A15', note());
  const row = reachTo(reach(), to);
  if (row === null) {
    return reject(
      'A15',
      `${to} is not reachable: the world does not stand the two of you in any situation that admits it. An ` +
        'open directory of every enrolled principal is a gate priced in identities, which A15 forbids. ' +
        `${REACH_LADDER_SENTENCE} \`affordances[]\` names principals you may address, with the situation that ` +
        'makes each one legal, and `ventures.directory` names who is dealing near you. To reach somebody new, ' +
        'get into a situation with them: `join` their raid or their war on either side, fill a role in their ' +
        'venture, or `grant` them something.',
    );
  }
  if (parleysRemaining(entries, from, tick, port.reckoningOf, parleyOpeningsFor(entitlement)) <= 0) {
    return reject('A15', note());
  }
  return null;
}

/** {@link parleyCountsFor} with the entitlement and the reach count already in hand. */
function countsWith(
  port: ParleyPort,
  principal: PrincipalId,
  tick: number,
  entitlement: ParleyEntitlement,
  reachable: number,
): ParleyCounts {
  const entries = port.mailOf(principal);
  const openingsPerReckoning = parleyOpeningsFor(entitlement);
  return {
    openingsRemaining: parleysRemaining(entries, principal, tick, port.reckoningOf, openingsPerReckoning),
    openingsPerReckoning,
    answersOwed: lettersAwaitingAnswer(entries, principal, tick).length,
    sendsRemaining: sendsRemaining(entries, principal, tick, port.reckoningOf),
    reachable,
  };
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
  // Decided BEFORE the write, against the book as it stands — the bit the opening count is summed over.
  const answering = owesAnswer(port.mailOf(from), from, to, tick);
  // Non-null: `parleyRefusal` returns a rejection when it is not, and an answer is REPLY-reachable.
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
    answering,
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
