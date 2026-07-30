/**
 * The risk market's invariants — INV-R1 … INV-R9.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ## Where these actually run, stated first because it was nowhere
 *
 * ⚑ **INV-R WAS NOT REGISTERED WITH THE ENGINE.** `assertRiskInvariants` had exactly one caller —
 * inside `runCohortPhase` — which runs **only on a settlement tick, only per struck FRONT, and only
 * when that front's cohort is non-empty**. So on every other tick of every Reckoning, and for every
 * book a *restore* rebuilt, nothing checked any of these; and `params.ts` claimed
 * `retention.spec.ts` asserted *"an INV-R halt"* when the strongest thing available to it was a
 * checker returning a row. An unregistered invariant cannot halt anything.
 *
 * `runtime.ts`'s `assertions` array now carries a risk entry beside the market's, predation's,
 * combat's, sovereignty's and the campaign's, so {@link checkRiskInvariants} runs in `ASSERT` **every
 * tick** and any violation aborts the tick through the one halt path there is. `runCohortPhase` keeps
 * its own call, deliberately: a settlement is the one place a violation must stop the batch *before*
 * more money moves rather than at the end of the tick.
 *
 * ## Every one of these has a subject that can occur — and here is the honest state of that claim
 *
 * This project's signature defect at the invariant depth is *"a check whose subject cannot happen"* —
 * INV-22 was green over an empty journal for the project's whole life, and INV-23 was the same before
 * it. So each checker below states what its subject is, and {@link riskSubjects} publishes the
 * denominator of each so *"green"* can be told from *"empty"*.
 *
 * ⚑ **The previous version of this paragraph said `test/risk/invariants.spec.ts` *"opens every block by
 * asserting the subject occurs in a driven world"*. It did not.** Every block in that file starts
 * `new RiskBook()` and hand-builds rows, which proves the *checker* fires and proves nothing about
 * whether the world can produce its subject — the two halves of the defect, and only the cheaper one
 * was covered. What is true now:
 *
 *   - **`test/risk/conservation.spec.ts` drives a real `Runtime`** through a real FRONT for the two A5′
 *     rules — R3 and R8 — because those are the two whose subject being unreachable would be the
 *     expensive kind of wrong;
 *   - **the hand-built blocks stay** for R1, R2, R4, R5, R6, R7 and R9, and they are honest about being
 *     unit tests of a checker. Their subjects are all reachable by construction from rows the driven
 *     suite already produces (`propagates.spec.ts` has the cohort, the chain and the default).
 * ══════════════════════════════════════════════════════════════════════════════
 * ## The three that exist for A5′ rather than for correctness
 *
 * **INV-R3** (conserved interest), **INV-R5** (attributable cause) and **INV-R8** (conservation across
 * the chain) are not arithmetic hygiene. They are the false-default problem, and they fail in the
 * direction that libels a real agent:
 *
 *   - two COVERS over one holding — or two cessions over one COVER — make Σ indemnity exceed the loss,
 *     so one payer is unavoidably short **with every individual settlement arithmetically correct**: a
 *     false default that §15.4's five defences cannot see, because there is no race and no stale read;
 *   - a default with no cause event is *"the game accusing an innocent agent"* (INV-17's own words),
 *     and it is top-severity for the same reason.
 *
 * All three are therefore halts and not faults.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { PrincipalId } from '../core/types.js';
import { minor, type Minor } from '../core/units.js';
import type { Ledger } from '../ledger/ledger.js';
import { compareIds } from '../ledger/order.js';
import { RiskBook } from './book.js';
import { escrowedOutstanding, isLiveCover, type CoverRecord } from './cover.js';
import { isSettleableIndemnity, type RiskDefault } from './indemnity.js';
import {
  COVER_ELECTIVE_BPS_CEILING,
  COVER_ELECTIVE_BPS_FLOOR,
  COVER_MAX_DEPTH,
  MAX_LIVE_FRONTS,
} from './params.js';

export class RiskHalt extends Error {}

/** One failed check, in the shape the engine's other invariant modules use. */
export interface RiskViolation {
  readonly invariant: string;
  readonly detail: string;
}

/**
 * **INV-R1 — every open INDEMNITY has its COVER.**
 *
 * *Subject:* an open INDEMNITY. The bug it catches is a retention window or a restore that dropped a
 * live cover row: the INDEMNITY would then quietly owe nothing, the payee would be paid nothing, and
 * **nothing would fail**. That is `Book.prune`'s failure mode exactly — *"in the direction that
 * hides"* — and it is why `RiskBook.requireCover` throws instead of returning `undefined`.
 */
export function checkInvR1(book: RiskBook): readonly RiskViolation[] {
  const out: RiskViolation[] = [];
  for (const ind of book.allIndemnities()) {
    if (!isSettleableIndemnity(ind.state)) continue;
    if (book.cover(ind.cover) === undefined) {
      out.push({
        invariant: 'INV-R1',
        detail:
          `indemnity ${ind.id} is ${ind.state} and its cover ${ind.cover} is not in the book. A ` +
          'promise the engine cannot price is a promise it must not silently discharge.',
      });
    }
  }
  return out;
}

/**
 * **INV-R2 — the INDEMNITY arithmetic.**
 *
 * *Subject:* every INDEMNITY. `covered === escrowedDue + electiveDue`, `covered ≤ grossLoss`, and
 * neither half paid past its due. §7.4's property tests, and CAT6's conservation clause: a payout
 * larger than the loss makes being struck profitable and turns this layer into a currency faucet,
 * of which §10.2 permits exactly two.
 */
export function checkInvR2(book: RiskBook): readonly RiskViolation[] {
  const out: RiskViolation[] = [];
  for (const ind of book.allIndemnities()) {
    if (ind.escrowedDue + ind.electiveDue !== ind.covered) {
      out.push({
        invariant: 'INV-R2',
        detail: `indemnity ${ind.id} splits ${String(ind.escrowedDue)}+${String(ind.electiveDue)} against covered ${String(ind.covered)}`,
      });
    }
    if (ind.covered > ind.grossLoss) {
      out.push({
        invariant: 'INV-R2',
        detail: `indemnity ${ind.id} covers ${String(ind.covered)} against a loss of ${String(ind.grossLoss)} (CAT6)`,
      });
    }
    if (ind.escrowedPaid > ind.escrowedDue || ind.electivePaid > ind.electiveDue) {
      out.push({
        invariant: 'INV-R2',
        detail: `indemnity ${ind.id} paid past its due`,
      });
    }
  }
  return out;
}

/**
 * **INV-R3 — one interest, one COVER. ★ A5′.**
 *
 * *Subject:* every live COVER over goods. See the module header for why this is a false-default guard
 * and not a fairness rule. `bindCover` refuses the second one; this is the second road, and it is
 * needed because a restore could rebuild a book that violates it without any bind having run.
 */
export function checkInvR3(book: RiskBook): readonly RiskViolation[] {
  const out: RiskViolation[] = [];
  const seen = new Map<string, string>();
  for (const cover of book.allCovers()) {
    if (!isLiveCover(cover.state)) continue;
    if (cover.over.kind !== 'GOODS' || cover.payee === null) continue;
    const key = RiskBook.interestKey(cover.payee, cover.over.system, cover.over.good);
    const first = seen.get(key);
    if (first !== undefined) {
      out.push({
        invariant: 'INV-R3',
        detail:
          `covers ${first} and ${cover.id} both stand over ${key}. Σ indemnity would exceed the loss, ` +
          'one payer would be short through nobody\'s fault, and the record would call it a default.',
      });
      continue;
    }
    seen.set(key, cover.id);
  }
  return out;
}

/**
 * **INV-R4 — bounded chains, no cycles.**
 *
 * *Subject:* every COVER written over another COVER. RE6's cap and RE11's CUT. A cycle in a
 * settlement graph is an unbounded cascade, and §15.2 is explicit that cascades run *"in fixed
 * rounds, never a loop to convergence, or adversarial circular obligations make the tick
 * unbounded."*
 */
export function checkInvR4(book: RiskBook): readonly RiskViolation[] {
  const out: RiskViolation[] = [];
  for (const cover of book.allCovers()) {
    if (cover.depth > COVER_MAX_DEPTH) {
      out.push({
        invariant: 'INV-R4',
        detail: `cover ${cover.id} is at layer ${String(cover.depth)} against a cap of ${String(COVER_MAX_DEPTH)}`,
      });
    }
    if (cover.over.kind !== 'COVER') continue;
    let chain: readonly CoverRecord[];
    try {
      chain = book.chainUnder(cover.id);
    } catch (error) {
      out.push({
        invariant: 'INV-R4',
        detail: `cover ${cover.id} chain does not terminate: ${String(error)}`,
      });
      continue;
    }
    const payers = new Set<PrincipalId>();
    for (const link of chain) {
      if (payers.has(link.payer)) {
        out.push({
          invariant: 'INV-R4',
          detail:
            `${link.payer} appears twice in the chain under ${cover.id}, so the same risk is ceded ` +
            'back to a house already holding it — false diversification (RE6).',
        });
        break;
      }
      payers.add(link.payer);
    }
  }
  return out;
}

/**
 * **INV-R5 — every default is attributable. ★ A5′, top severity.**
 *
 * *Subject:* every {@link RiskDefault} a settlement produced. §15.4's Mode B: *"every logged default
 * must be attributable — each one carries the event ID of the loss or the missed delivery that caused
 * it, and a default with no attributable cause is top-severity, because it is the game accusing an
 * innocent agent."*
 *
 * Checked against the batch rather than the book, because a default is an *event*, and by the time it
 * is a row the accusation has already been made.
 */
export function checkInvR5(defaults: readonly RiskDefault[]): readonly RiskViolation[] {
  const out: RiskViolation[] = [];
  for (const d of defaults) {
    if (d.causeEventId.length === 0) {
      out.push({
        invariant: 'INV-R5',
        detail:
          `default on ${d.indemnity} by ${d.payer} carries no cause event. A default the engine ` +
          'cannot attribute is the game accusing an innocent agent, permanently.',
      });
    }
    if (d.amount <= 0) {
      out.push({
        invariant: 'INV-R5',
        detail: `default on ${d.indemnity} is for ${String(d.amount)}; a default of nothing is not a default`,
      });
    }
    if (d.payer === d.payee) {
      out.push({
        invariant: 'INV-R5',
        detail:
          `default on ${d.indemnity} names ${d.payer} as both payer and payee. Self-dealing can never ` +
          'be a broken promise (scar #9).',
      });
    }
  }
  return out;
}

/**
 * **INV-R6 — the certain half is actually there.**
 *
 * *Subject:* every live COVER. A7 promises that the escrowed half *"executes automatically"*, and the
 * only thing that makes that true is money sitting in the escrow account. An escrow short of its
 * outstanding escrowed half is A7 as a claim rather than a fact, and it is the condition under which
 * `settleIndemnity` would produce an escrowed shortfall — which is structurally a recorded loss, so
 * **nothing downstream would fail**. Hence a halt here rather than a discovery there.
 */
export function checkInvR6(ledger: Ledger, book: RiskBook): readonly RiskViolation[] {
  const out: RiskViolation[] = [];
  for (const cover of book.allCovers()) {
    if (!isLiveCover(cover.state)) continue;
    const owed = escrowedOutstanding(cover);
    if (owed <= 0) continue;
    const account = ledger.account(cover.escrow);
    const held = account === undefined ? 0 : ledger.freeBalance(cover.escrow);
    if (held < owed) {
      out.push({
        invariant: 'INV-R6',
        detail:
          `cover ${cover.id} owes ${String(owed)} escrowed and its escrow holds ${String(held)}. A7's ` +
          'certain half is only certain while the money is in the account.',
      });
    }
  }
  return out;
}

/**
 * **INV-R7 — A7's band held.**
 *
 * *Subject:* every COVER. `elective_bps` inside `[floor, ceiling]`, and `escrowed + elective === limit`
 * exactly. §7.5's floor is *"what makes the elective part exist at all"*, and a cover that drifted to
 * zero elective would be a fee wearing a promise's name — the failure `lockFillStake` had one
 * mechanic over, where *"`elective` sat one minor unit under `f(kind)` on every venture forever"*.
 */
export function checkInvR7(book: RiskBook): readonly RiskViolation[] {
  const out: RiskViolation[] = [];
  for (const cover of book.allCovers()) {
    if (cover.electiveBps < COVER_ELECTIVE_BPS_FLOOR || cover.electiveBps > COVER_ELECTIVE_BPS_CEILING) {
      out.push({
        invariant: 'INV-R7',
        detail:
          `cover ${cover.id} is at ${String(cover.electiveBps)} bps elective, outside ` +
          `[${String(COVER_ELECTIVE_BPS_FLOOR)}, ${String(COVER_ELECTIVE_BPS_CEILING)}]`,
      });
    }
    if (cover.escrowed + cover.elective !== cover.limit) {
      out.push({
        invariant: 'INV-R7',
        detail:
          `cover ${cover.id} halves are ${String(cover.escrowed)}+${String(cover.elective)} against a ` +
          `limit of ${String(cover.limit)}; every minor unit of a promise is in one half or the other`,
      });
    }
  }
  return out;
}

/**
 * ★★ **INV-R8 — NO PRINCIPAL RECOVERS MORE THAN IT LOST. A5′, AND THE ONLY CHAIN-WIDE RULE HERE.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ## The statement, exactly
 *
 * > **For every FRONT `F` and every principal `P`:**
 * >
 * > ```
 * > Σ { ind.covered : ind.front = F ∧ ind.payee = P }   ≤   lossOf(P, F)
 * >
 * > lossOf(P, F) = Σ { max grossLoss per distinct primary subject (P, system, good) }   ← goods P lost
 * >              + Σ { ind.covered : ind.front = F ∧ ind.payer = P }                    ← what P owes
 * > ```
 * >
 * > *Σ indemnity receivable may not exceed the recipient's own loss.* CAT6: *"indemnity across layers
 * > stays at/below actual loss."*
 *
 * ## Why it is per-payee and not a naive Σ over the chain
 *
 * A chain `holder ← primary ← reinsurer` legitimately moves the loss **three** times: the holder is
 * paid, the primary is reimbursed, the reinsurer pays. Gross Σ over the chain is `3 × loss` and nothing
 * is wrong — money is flowing *inward*, and each layer is made whole for **its own** outlay. So a rule
 * that summed the chain would fire on the healthy case and could only be silenced by deleting it. The
 * quantity that must be conserved is **per recipient**: nobody ends the front richer for having been in
 * it. That is also exactly the sentence CAT6 and RSK1 are both making.
 *
 * ## The three ways it fires, and every one is A5′ rather than fairness
 *
 *   1. ★ **N cessions over one primary.** `openCession` gives each of them `grossLoss = under.covered`
 *      — the whole obligation below — so the primary is owed `N ×` what it owes. **Measured, driven,
 *      seed `dbl`:** actual loss 20,892; the primary collected 18,803 + 18,803 = 37,606 while paying
 *      out 18,803, **net +18,803 for being struck**, and no guard anywhere went red because all three
 *      settlements were individually correct. `bindCover` now refuses the second cession; this is the
 *      road that does not depend on a gate sitting inside the right `if`.
 *   2. **Two COVERS over one holding** — {@link checkInvR3}'s subject, which this **subsumes** and
 *      states in money rather than in keys. R3 stays because it names the offending pair, which is what
 *      a halt message needs; R8 is what catches the same economics arriving through a shape R3's key
 *      grammar does not cover.
 *   3. **A cession whose limit exceeds its parent's.** Refused at bind now; caught here in a book that
 *      got one anyway.
 *
 * And the direction of the harm is the reason it is a halt: once somebody is owed more than the loss,
 * **some payer in the chain is unavoidably short**, and a short payer produces a full-sized
 * `indemnity.default` row against a real agent for a shortfall *the engine manufactured*. §15.4's five
 * defences are all blind to it — there is no race, no stale read and no price move — which is precisely
 * why the conservation rule has to exist as arithmetic and not as a bind-time gate alone.
 *
 * *Subject:* every principal that is the payee of at least one INDEMNITY. Counted as
 * `RiskSubjects.payeesWithReceivables`, so *"green"* is distinguishable from *"empty"*.
 * ══════════════════════════════════════════════════════════════════════════════
 */
export function checkInvR8(book: RiskBook): readonly RiskViolation[] {
  const out: RiskViolation[] = [];
  /** `front::principal` → what it is owed off that front. */
  const receivable = new Map<string, Minor>();
  /** `front::principal` → what it owes off that front. Half of its own loss. */
  const owed = new Map<string, Minor>();
  /**
   * `front::payee` → (`system::good` → the largest gross loss any primary claims for that subject).
   *
   * **Max per subject, never a sum**, and that is what makes case 2 fire: two COVERS over one holding
   * each report the *same* destroyed goods, so summing their `grossLoss` would hand the payee twice the
   * allowance it lost and the check would pass over the defect it exists for. Distinct subjects — a
   * payee holding cover on `ration` and on `ore` at one system — are legitimately additive, and the key
   * is what tells the two cases apart.
   */
  const destroyed = new Map<string, Map<string, Minor>>();
  /** The `(front, principal)` pair behind each key, so nothing has to parse a key back apart. */
  const who = new Map<string, { readonly front: string; readonly principal: PrincipalId }>();

  for (const ind of book.allIndemnities()) {
    const rk = `${ind.front}::${ind.payee}`;
    receivable.set(rk, minor((receivable.get(rk) ?? 0) + ind.covered));
    who.set(rk, { front: ind.front, principal: ind.payee });
    const ok = `${ind.front}::${ind.payer}`;
    owed.set(ok, minor((owed.get(ok) ?? 0) + ind.covered));
    who.set(ok, { front: ind.front, principal: ind.payer });
    const cover = book.cover(ind.cover);
    if (cover === undefined || cover.over.kind !== 'GOODS') continue;
    // Nested rather than a composite string key: ids in this engine contain `:`, and a rule that has to
    // `split` its own key back apart to work is a rule one naming convention away from being wrong.
    const bySubject = destroyed.get(rk) ?? new Map<string, Minor>();
    const sk = `${cover.over.system}::${cover.over.good}`;
    bySubject.set(sk, minor(Math.max(bySubject.get(sk) ?? 0, ind.grossLoss)));
    destroyed.set(rk, bySubject);
  }

  for (const [key, gets] of [...receivable.entries()].sort((a, b) => compareIds(a[0], b[0]))) {
    const lostGoods = [...(destroyed.get(key)?.values() ?? [])].reduce((sum, v) => sum + v, 0);
    const loss = minor(lostGoods + (owed.get(key) ?? 0));
    if (gets <= loss) continue;
    const at = who.get(key);
    const front = at?.front ?? key;
    const principal = at?.principal ?? key;
    out.push({
      invariant: 'INV-R8',
      detail:
        `${String(principal)} is owed ${String(gets)} off front ${String(front)} against a loss of ` +
        `${String(loss)} (${String(lostGoods)} in goods, ${String(owed.get(key) ?? 0)} owed ` +
        `onward). Σ indemnity across the chain may never exceed the real loss: being struck would be ` +
        'profitable, this layer would be a third currency faucet, and some payer would be short through ' +
        "nobody's fault — which the record would call a default (CAT6, A5′).",
    });
  }
  return out;
}

/**
 * **INV-R9 — one unstruck FRONT at a time.**
 *
 * *Subject:* every FRONT that has not struck. Counted as `RiskSubjects.unstruckFronts`, which is 1 for
 * most of the cycle, so this checker has a live denominator rather than a hypothetical one.
 *
 * {@link MAX_LIVE_FRONTS}'s own docblock carries the history: the bound existed as a **silent skip**
 * inside `announceIfDue` and the schedule made its condition unreachable, so it was a guard whose
 * subject cannot occur *and* whose action A14 forbids. Here it is measured instead. A13 is the reason
 * for the number — §17 budgets seven labels a frame and two CONES plus two SWATHS is a weather map
 * rather than a story.
 */
export function checkInvR9(book: RiskBook): readonly RiskViolation[] {
  const unstruck = book.allFronts().filter((f) => f.struckAtTick === null);
  if (unstruck.length <= MAX_LIVE_FRONTS) return [];
  return [
    {
      invariant: 'INV-R9',
      detail:
        `${String(unstruck.length)} FRONTs are unstruck against a cap of ${String(MAX_LIVE_FRONTS)}: ` +
        // ★ The landfall ticks are in the message on purpose. Two *pending* fronts is a schedule that
        // overlaps (check FRONT_EVERY_RECKONINGS against FRONT_CONE_RECKONINGS); one whose landfall is
        // already in the PAST is an adopted world that skipped a strike, which is a different repair
        // entirely. An operator reading this at 3am should not have to query to tell them apart.
        `${unstruck.map((f) => `${f.id} lands at ${String(f.landfallTick)}`).join(', ')}. Two cones and ` +
        'two swaths is a weather map instead of a story (A13, §17’s seven labels a frame).',
    },
  ];
}

/** All nine, in order, deterministically. */
export function checkRiskInvariants(
  ledger: Ledger,
  book: RiskBook,
  defaults: readonly RiskDefault[] = [],
): readonly RiskViolation[] {
  return Object.freeze(
    [
      ...checkInvR1(book),
      ...checkInvR2(book),
      ...checkInvR3(book),
      ...checkInvR4(book),
      ...checkInvR5(defaults),
      ...checkInvR6(ledger, book),
      ...checkInvR7(book),
      ...checkInvR8(book),
      ...checkInvR9(book),
    ].sort((a, b) => compareIds(a.invariant, b.invariant) || compareIds(a.detail, b.detail)),
  );
}

/** Halt on any violation. §15.2: *"abort the tick and halt. Never publish a broken tick."* */
export function assertRiskInvariants(
  ledger: Ledger,
  book: RiskBook,
  defaults: readonly RiskDefault[] = [],
): void {
  const faults = checkRiskInvariants(ledger, book, defaults);
  if (faults.length === 0) return;
  throw new RiskHalt(faults.map((f) => `${f.invariant}: ${f.detail}`).join(' · '));
}

/**
 * The non-vacuity report an instrument prints, so *"green"* can be distinguished from *"empty"*.
 *
 * This exists because of the corollary this repo learned twice: an invariant is only as strong as the
 * occurrence of its subject, and nothing could tell INV-22's silence from INV-22's success. Every
 * count here is the denominator of one checker above.
 */
export interface RiskSubjects {
  readonly fronts: number;
  readonly struckFronts: number;
  /** INV-R9's denominator. 1 for most of the cycle; 0 between a landfall and the next announcement. */
  readonly unstruckFronts: number;
  readonly covers: number;
  readonly liveCovers: number;
  readonly boundCovers: number;
  readonly cessions: number;
  readonly indemnities: number;
  readonly openIndemnities: number;
  /** INDEMNITIES the freeze has taken. `DUE`'s only counter, and it was 0 by construction before 36. */
  readonly dueIndemnities: number;
  /**
   * ★ **INV-R8's denominator: principals owed something off some FRONT.**
   *
   * Without it, "no principal recovered more than it lost" and "no principal was owed anything" print
   * the same green — which is the distinction this whole file exists to keep, and the one the
   * conservation rule's absence hid for the module's first life.
   */
  readonly payeesWithReceivables: number;
  readonly deepestChain: number;
}

export function riskSubjects(book: RiskBook): RiskSubjects {
  const covers = book.allCovers();
  const inds = book.allIndemnities();
  const fronts = book.allFronts();
  return {
    fronts: fronts.length,
    struckFronts: fronts.filter((f) => f.struckAtTick !== null).length,
    unstruckFronts: fronts.filter((f) => f.struckAtTick === null).length,
    covers: covers.length,
    liveCovers: covers.filter((c) => isLiveCover(c.state)).length,
    boundCovers: covers.filter((c) => c.payee !== null).length,
    cessions: covers.filter((c) => c.over.kind === 'COVER').length,
    indemnities: inds.length,
    openIndemnities: inds.filter((i) => i.state === 'OPEN' || i.state === 'DUE').length,
    dueIndemnities: inds.filter((i) => i.state === 'DUE').length,
    payeesWithReceivables: new Set(inds.map((i) => `${i.front}::${i.payee}`)).size,
    deepestChain: covers.reduce((max, c) => Math.max(max, c.depth), 0),
  };
}
