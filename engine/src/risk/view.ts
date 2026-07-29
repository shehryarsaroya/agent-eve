/**
 * The agent-facing surface: what an agent reads about risk, and what it may do about it.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ## The completion bar this file exists to clear
 *
 * > *"A mechanism is offered to someone who can use it, something in the world actually selects it, an
 * > instrument counts it, and a blind probe can reach it by playing."*
 *
 * Seventeen times a mechanic in this repo has been built, tested, reported complete, and used by
 * nothing. `lockFillStake` had a passing unit test and no caller. So every mechanism in `src/risk/` is
 * either **offered as an affordance** or **counted in `header.withheld` with a ground**, and the
 * standard is `test/api/withheld-is-accountable.spec.ts` — which measures the *silence rate* of a verb
 * against a payload-readable trigger and fails when a verb is absent while its trigger fired.
 *
 * The three triggers this layer adds, and they are stated here so the spec can read them off one file:
 *
 * | act | trigger | if absent |
 * |---|---|---|
 * | `publish_offer {kind:"COVER"}` | `freeCash > 0` and a live FRONT is in `FORECAST` | must be named |
 * | `sign {cover}` | an open offer exists **and** the reader holds goods at its system | must be named |
 * | `elect {cover}` | an INDEMNITY this reader owes is open | must be named |
 *
 * ## The withheld grounds, and why no new one was added
 *
 * `WithheldGround` is a **closed machine-readable set** checked against §3's canon and against every
 * other union in `src/`. Four existing grounds carry every refusal this layer produces, and using
 * them rather than minting a fifth is deliberate — an agent that has learned `SHORT_FUNDS` on a
 * venture already knows what it means here:
 *
 *   - **`SHORT_FUNDS`** — the escrowed half exceeds `freeCash`. The A15 gate, in the agent's own
 *     vocabulary.
 *   - **`WINDOW_SHUT`** — the FRONT is `IMMINENT`, so new COVER is refused (CAT12). Its doc says *"the
 *     venture's formation window does not contain this tick"*, which is the same shape: a window that
 *     closed. `withheld.ts` is amended to name both, because *"an uncanonised word is unpoliced by
 *     construction"* applies to a documented union member's meaning too.
 *   - **`NO_RECORD`** — there is no FRONT at all, so there is nothing to cover and we *"will not
 *     invent zeros that read as facts."*
 *   - **`FROZEN`** — the freeze tick; nothing may touch the settlement set (INV-18).
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { GoodId, PrincipalId, SystemId } from '../core/types.js';
import { BPS_ONE, bps, minor, type Bps, type Minor, type Qty } from '../core/units.js';
import { ENDOWMENT_GOOD } from '../ledger/endowment.js';
import { compareIds } from '../ledger/order.js';
import type { RiskBook } from './book.js';
import {
  escrowRatioBps,
  isAttached,
  isLiveCover,
  type CoverId,
  type CoverRecord,
} from './cover.js';
import { coneAt, stateAt, type FrontState } from './front.js';
import { electiveOwed, outstandingOf, type IndemnityRecord } from './indemnity.js';
import {
  COVER_DEDUCTIBLE_BPS,
  COVER_ELECTIVE_BPS_CEILING,
  COVER_ELECTIVE_BPS_FLOOR,
  COVER_WAIT_TICKS,
  FRONT_COVER_FREEZE_TICKS,
  HONOUR_WINDOW_TICKS,
} from './params.js';

// ── What an agent reads ─────────────────────────────────────────────────────

export interface FrontView {
  readonly front: string;
  readonly state: FrontState;
  readonly eye: SystemId;
  readonly landfallTick: number;
  readonly ticksToLandfall: number;
  /**
   * The CONE as it reads **now**, sharpened by how close landfall is.
   *
   * A2: *"genuine uncertainty stays uncertain and sourced."* The sharpening is published arithmetic
   * (`coneAt`), so an agent can reproduce it and disagree about what it means — never a hidden model,
   * which CAT11 CUTS by name.
   */
  readonly cone: readonly { readonly system: SystemId; readonly oddsBps: Bps }[];
  /** Populated only once it has struck. Before that this is empty and says so. */
  readonly swath: readonly { readonly system: SystemId; readonly intensityBps: Bps }[];
  /** Systems where **this reader** holds goods that the CONE names. The one line that matters. */
  readonly yourSystemsInCone: readonly SystemId[];
  /** `false` once the front is IMMINENT. CAT12's half that protects the buyer too. */
  readonly coverOpen: boolean;
  readonly note: string;
}

export interface CoverOfferView {
  readonly cover: CoverId;
  readonly payer: PrincipalId;
  readonly system: SystemId;
  readonly good: GoodId;
  readonly limit: Minor;
  readonly premium: Minor;
  /** §7.5: the escrow ratio is published, or the unsecured tail is hidden rather than priced. */
  readonly escrowRatioBps: Bps;
  readonly escrowed: Minor;
  /** What you would be relying on this payer's word for. The number the whole design is about. */
  readonly onItsWord: Minor;
  readonly expiresTick: number;
  readonly attachesInTicks: number;
  readonly deductibleBps: Bps;
  /** RSK7's record, decomposed. `null` when the payer is UNSEASONED — never a zero that reads clean. */
  readonly payerRecord: {
    readonly written: number;
    readonly honoured: number;
    readonly defaulted: number;
    readonly defaultedValue: Minor;
  } | null;
  readonly termsHash: string;
  readonly note: string;
}

export interface ObligationDueView {
  readonly indemnity: string;
  readonly cover: CoverId;
  readonly front: string;
  readonly payee: PrincipalId;
  readonly covered: Minor;
  /** Pays itself. Nothing to decide. */
  readonly escrowedDue: Minor;
  /** ★ The decision. `elect` this, or the record says you refused it. */
  readonly electiveDue: Minor;
  readonly electivePaid: Minor;
  readonly outstanding: Minor;
  readonly dueTick: number;
  readonly ticksToDecide: number;
  readonly depth: number;
  /** What is standing behind you: a cession over this COVER, if you bought one. */
  readonly recoverableFrom: readonly PrincipalId[];
  readonly note: string;
}

export interface RiskView {
  readonly fronts: readonly FrontView[];
  readonly offers: readonly CoverOfferView[];
  /** COVERS this reader bought. What it is protected by. */
  readonly covered: readonly CoverOfferView[];
  /** INDEMNITIES this reader owes. RSK5's `obligations_due`. */
  readonly due: readonly ObligationDueView[];
  /** INDEMNITIES this reader is owed. The other side of the same table. */
  readonly owedToYou: readonly ObligationDueView[];
  readonly yourRecord: {
    readonly written: number;
    readonly honoured: number;
    readonly defaulted: number;
    readonly unseasoned: boolean;
  };
}

/** What a reader's holding looks like to this module. Supplied, never derived here. */
export interface HoldingRead {
  readonly system: SystemId;
  readonly good: GoodId;
  readonly qty: Qty;
  /** The mark the world would pin for this good right now. */
  readonly unitPrice: Minor;
}

export interface RiskViewInput {
  readonly book: RiskBook;
  readonly principal: PrincipalId;
  readonly tick: number;
  readonly holdings: readonly HoldingRead[];
  /** `market/escrow.ts:freeCash`. The A15 gate, and the only thing that funds an offer. */
  readonly freeCash: Minor;
}

export function frontViewFor(input: RiskViewInput): readonly FrontView[] {
  const mine = new Set(input.holdings.filter((h) => h.qty > 0).map((h) => h.system));
  return Object.freeze(
    input.book.liveFronts(input.tick).map((front) => {
      const state = stateAt(front, input.tick, FRONT_COVER_FREEZE_TICKS);
      const cone = coneAt(front, input.tick);
      const struck = state === 'STRUCK' || state === 'PASSED';
      const yours = cone
        .filter((c) => mine.has(c.system))
        .map((c) => c.system)
        .sort(compareIds);
      return {
        front: front.id,
        state,
        eye: front.eye,
        landfallTick: front.landfallTick,
        ticksToLandfall: front.landfallTick - input.tick,
        cone: cone.map((c) => ({ system: c.system, oddsBps: c.oddsBps })),
        swath: struck
          ? front.swath.map((c) => ({ system: c.system, intensityBps: c.intensityBps }))
          : [],
        yourSystemsInCone: Object.freeze(yours),
        coverOpen: state === 'FORECAST',
        note: frontNote(state, yours.length, front.landfallTick - input.tick),
      };
    }),
  );
}

function frontNote(state: FrontState, yours: number, ticksOut: number): string {
  if (state === 'STRUCK' || state === 'PASSED') {
    return 'It has landed. Located goods in the SWATH are gone; every COVER over them is now an INDEMNITY.';
  }
  if (state === 'IMMINENT') {
    return (
      `IMMINENT — no new COVER binds against this FRONT and none can be cancelled either. ` +
      `Moving goods out with \`haul\` still works: a lot in transit is at no struck system.`
    );
  }
  return (
    `Lands in ${String(ticksOut)} ticks. ${String(yours)} of the systems it may strike hold goods of ` +
    `yours. COVER shuts ${String(FRONT_COVER_FREEZE_TICKS)} ticks before landfall.`
  );
}

function offerView(book: RiskBook, cover: CoverRecord, tick: number): CoverOfferView | null {
  if (cover.over.kind !== 'GOODS') return null;
  const unseasoned = book.isUnseasoned(cover.payer);
  const record = book.record(cover.payer);
  return {
    cover: cover.id,
    payer: cover.payer,
    system: cover.over.system,
    good: cover.over.good,
    limit: cover.limit,
    premium: cover.premium,
    escrowRatioBps: escrowRatioBps(cover),
    escrowed: cover.escrowed,
    onItsWord: minor(cover.elective - cover.settledElectiveMinor),
    expiresTick: cover.offerExpiresTick,
    attachesInTicks: cover.attachesTick === null ? COVER_WAIT_TICKS : Math.max(0, cover.attachesTick - tick),
    deductibleBps: COVER_DEDUCTIBLE_BPS,
    payerRecord: unseasoned
      ? null
      : {
          written: record.written,
          honoured: record.honoured,
          defaulted: record.defaulted,
          defaultedValue: record.defaultedValue,
        },
    termsHash: cover.termsHash ?? '',
    note:
      `${String(Math.trunc((escrowRatioBps(cover) * 100) / BPS_ONE))}% of this limit is escrowed and pays ` +
      `itself. The rest — ${String(cover.elective)} — is ${cover.payer}'s word` +
      (unseasoned ? ', and it has no record yet (UNSEASONED, not untrustworthy).' : '.'),
  };
}

export function coverOffersFor(input: RiskViewInput): readonly CoverOfferView[] {
  const mine = new Map(input.holdings.map((h) => [`${h.system}::${h.good}`, h] as const));
  const out: CoverOfferView[] = [];
  for (const cover of input.book.openOffers(input.tick)) {
    if (cover.payer === input.principal) continue;
    if (cover.over.kind !== 'GOODS') continue;
    // Only offers this reader could actually bind: RSK1's insurable interest, applied to the *menu*
    // rather than only to the bind. An offer a reader may not take is an action it would spend on a
    // refusal — the exact cost `test/campaign/reachable.spec.ts` names.
    const held = mine.get(`${cover.over.system}::${cover.over.good}`);
    if (held === undefined || held.qty <= 0) continue;
    if (input.book.interestTaken(input.principal, cover.over.system, cover.over.good)) continue;
    const view = offerView(input.book, cover, input.tick);
    if (view !== null) out.push(view);
  }
  return Object.freeze(out.sort((a, b) => a.premium - b.premium || compareIds(a.cover, b.cover)));
}

export function obligationsDueFor(input: RiskViewInput): readonly ObligationDueView[] {
  return Object.freeze(input.book.dueBy(input.principal).map((i) => dueView(input, i)));
}

function dueView(input: RiskViewInput, ind: IndemnityRecord): ObligationDueView {
  const cessions = input.book
    .cessionsOver(ind.cover)
    .filter((c) => isAttached(c, input.tick) || c.state === 'STRUCK')
    .map((c) => c.payer)
    .sort(compareIds);
  const owed = electiveOwed(ind);
  return {
    indemnity: ind.id,
    cover: ind.cover,
    front: ind.front,
    payee: ind.payee,
    covered: ind.covered,
    escrowedDue: ind.escrowedDue,
    electiveDue: ind.electiveDue,
    electivePaid: ind.electivePaid,
    outstanding: outstandingOf(ind),
    dueTick: ind.dueTick,
    ticksToDecide: ind.dueTick - input.tick,
    depth: ind.depth,
    recoverableFrom: Object.freeze(cessions),
    note:
      `${String(ind.escrowedDue)} pays itself from escrow. ${String(owed)} is your word: send ` +
      `{"verb":"elect","params":{"cover":"${ind.cover}","election":"IN_FULL"}} before the freeze, or ` +
      'the record says you refused it.' +
      (cessions.length > 0 ? ` ${String(cessions.length)} layer(s) stand behind you.` : ''),
  };
}

export function riskViewFor(input: RiskViewInput): RiskView {
  const record = input.book.record(input.principal);
  const covered: CoverOfferView[] = [];
  for (const cover of input.book.coversFor(input.principal)) {
    if (!isLiveCover(cover.state)) continue;
    const view = offerView(input.book, cover, input.tick);
    if (view !== null) covered.push(view);
  }
  return {
    fronts: frontViewFor(input),
    offers: coverOffersFor(input),
    covered: Object.freeze(covered.sort((a, b) => compareIds(a.cover, b.cover))),
    due: obligationsDueFor(input),
    owedToYou: Object.freeze(input.book.dueTo(input.principal).map((i) => dueView(input, i))),
    yourRecord: {
      written: record.written,
      honoured: record.honoured,
      defaulted: record.defaulted,
      unseasoned: input.book.isUnseasoned(input.principal),
    },
  };
}

// ── Affordances ─────────────────────────────────────────────────────────────

/** One offerable act, in the shape `api/observe.ts` needs to publish it. */
export interface RiskAffordance {
  readonly verb: 'publish_offer' | 'sign' | 'elect';
  readonly params: Readonly<Record<string, string | number>>;
  readonly maxDirectLoss: Minor;
  readonly maxContingentLiability: Minor;
  readonly forecloses: readonly string[];
  readonly expiresTick: number;
}

/** One omission, tagged with the verb whose absence it accounts for. */
export interface WithheldRisk {
  readonly verb: 'publish_offer' | 'sign' | 'elect';
  readonly ground: 'SHORT_FUNDS' | 'WINDOW_SHUT' | 'NO_RECORD' | 'FROZEN';
  readonly text: string;
}

export interface CoverAffordanceInput extends RiskViewInput {
  /** The freeze tick refuses everything that touches the settlement set (INV-18). */
  readonly frozen: boolean;
  /** How long an offer stands, in ticks. Published so the affordance's `expires_tick` is exact. */
  readonly offerTermTicks: number;
  /** A default limit and premium, so a blind copier can take the affordance verbatim. */
  readonly suggestedLimit: Minor;
  readonly suggestedPremium: Minor;
}

/**
 * Every risk act this reader may take now, plus a tagged row for every one it may not.
 *
 * The rule the whole file turns on: **nothing is dropped uncounted.** `withheld.ts` makes truncation
 * unrepresentable by having no `TRUNCATED` ground to write in the column; this function follows the
 * same discipline by returning both lists from one call, so a caller cannot publish the offers and
 * forget the omissions.
 */
export function coverAffordances(input: CoverAffordanceInput): {
  readonly offered: readonly RiskAffordance[];
  readonly withheld: readonly WithheldRisk[];
} {
  const offered: RiskAffordance[] = [];
  const withheld: WithheldRisk[] = [];
  const fronts = input.book.liveFronts(input.tick);
  const forecast = fronts.filter((f) => stateAt(f, input.tick, FRONT_COVER_FREEZE_TICKS) === 'FORECAST');
  const imminent = fronts.filter((f) => stateAt(f, input.tick, FRONT_COVER_FREEZE_TICKS) === 'IMMINENT');

  // ── elect: the decision. Offered first, because it is the one with a deadline. ──
  const due = input.book.dueBy(input.principal);
  for (const ind of due) {
    if (input.frozen) {
      withheld.push({
        verb: 'elect',
        ground: 'FROZEN',
        text:
          `\`elect\` on ${ind.id} is withheld: this is the freeze tick and nothing may touch the ` +
          'settlement set. You could have elected any tick in the honour window; the election you ' +
          'last sent still stands.',
      });
      continue;
    }
    offered.push({
      verb: 'elect',
      params: { cover: ind.cover, election: 'IN_FULL' },
      // The elective half is what an election can cost. The escrowed half is already gone.
      maxDirectLoss: electiveOwed(ind),
      maxContingentLiability: minor(0),
      forecloses: [
        `${String(electiveOwed(ind))} of your free stores`,
        'refusing it is permanent and public',
      ],
      expiresTick: ind.dueTick,
    });
  }

  // ── sign: take an offer. ──
  const offers = coverOffersFor(input);
  for (const offer of offers) {
    if (input.frozen) continue;
    offered.push({
      verb: 'sign',
      params: { cover: offer.cover, terms_hash: offer.termsHash },
      maxDirectLoss: offer.premium,
      maxContingentLiability: minor(0),
      forecloses: [
        `${String(offer.premium)} in premium, paid now`,
        `no second COVER over ${offer.good} at ${offer.system}`,
      ],
      expiresTick: offer.expiresTick,
    });
  }

  // ── publish_offer {kind:"COVER"}: write cover. ──
  const target = pickTarget(input);
  if (target === null) {
    withheld.push({
      verb: 'publish_offer',
      ground: 'NO_RECORD',
      text:
        '`publish_offer {"kind":"COVER"}` is withheld: nobody in the CONE holds goods you could write ' +
        'cover over, so there is no interest to insure. It returns when a FRONT is announced over ' +
        'somebody who is holding.',
    });
  } else if (input.frozen) {
    withheld.push({
      verb: 'publish_offer',
      ground: 'FROZEN',
      text: '`publish_offer {"kind":"COVER"}` is withheld: the freeze tick refuses new obligations.',
    });
  } else if (forecast.length === 0 && imminent.length > 0) {
    withheld.push({
      verb: 'publish_offer',
      ground: 'WINDOW_SHUT',
      text:
        '`publish_offer {"kind":"COVER"}` is withheld: the FRONT is IMMINENT, so no new COVER binds ' +
        `against it (it shuts ${String(FRONT_COVER_FREEZE_TICKS)} ticks out). Cover written after the ` +
        'odds have resolved is a free option, and the same rule stops a payer cancelling on bad news.',
    });
  } else if (forecast.length === 0) {
    withheld.push({
      verb: 'publish_offer',
      ground: 'NO_RECORD',
      text:
        '`publish_offer {"kind":"COVER"}` is withheld: no FRONT is in FORECAST, so there is no peril ' +
        'to write against. Fronts are scheduled and announced — the CONE arrives first.',
    });
  } else {
    // ★ THE MIDPOINT OF A7's BAND, NOT ITS FLOOR — and the reason is this project's own lesson.
    //
    // The first version suggested `COVER_ELECTIVE_BPS_FLOOR`, which is the *safest* number for the
    // payer and the wrong one for the affordance. `escrowedDue = min(covered, escrowed)` makes the
    // elective half the TOP slice of a claim (`indemnity.ts:openPrimary`), so at the floor a COVER's
    // promise is only tested by a loss above 75% of its limit — and *"an affordance nothing selects is
    // indistinguishable from one that does not exist."* A blind copier taking the default would write
    // cover whose elective half is decoration, and this repo's whole method is that what gets copied
    // is what exists.
    //
    // So the suggestion is the band's midpoint: half certain, half on the payer's word, and a promise a
    // moderate loss actually reaches. Both ends of the band remain available and the offer publishes
    // `elective_bps` explicitly, so this is a *default* rather than a rule.
    const suggestedElectiveBps = bps(
      Math.trunc((COVER_ELECTIVE_BPS_FLOOR + COVER_ELECTIVE_BPS_CEILING) / 2),
    );
    const escrowNeeded = minor(
      input.suggestedLimit - Math.trunc((input.suggestedLimit * suggestedElectiveBps) / BPS_ONE),
    );
    if (input.freeCash < escrowNeeded) {
      withheld.push({
        verb: 'publish_offer',
        ground: 'SHORT_FUNDS',
        text:
          `\`publish_offer {"kind":"COVER"}\` is withheld: the escrowed half of a ` +
          `${String(input.suggestedLimit)} limit is ${String(escrowNeeded)} and your free cash is ` +
          `${String(input.freeCash)}. Writing cover costs capital that can be taken, not an identity — ` +
          'your starter stake is withheld from it (A15).',
      });
    } else {
      offered.push({
        verb: 'publish_offer',
        params: {
          kind: 'COVER',
          system: target.system,
          good: target.good,
          limit: input.suggestedLimit,
          premium: input.suggestedPremium,
          elective_bps: suggestedElectiveBps,
        },
        maxDirectLoss: escrowNeeded,
        maxContingentLiability: minor(input.suggestedLimit - escrowNeeded),
        forecloses: [
          `${String(escrowNeeded)} escrowed until it lapses or pays`,
          `up to ${String(minor(input.suggestedLimit - escrowNeeded))} on your word`,
        ],
        expiresTick: input.tick + input.offerTermTicks,
      });
    }
  }

  return { offered: Object.freeze(offered), withheld: Object.freeze(withheld) };
}

/**
 * Where to write cover: **the system in a live CONE with the highest published odds.**
 *
 * ⚑ **The first version read the reader's OWN holdings and that was backwards.** A payer writes cover
 * over *somebody else's* goods, so gating the offer on what the payer holds meant a would-be
 * underwriter with a full treasury and no `ration` at the eye of the storm was never offered the act —
 * `publish_offer {kind:"COVER"}` was silent for exactly the principal best placed to use it, and
 * `reachable.spec.ts` caught it with *"expected 0 to be greater than 0"*.
 *
 * So the target is the CONE's own strongest cell and {@link ENDOWMENT_GOOD} — *"the one good every
 * obligation in the game is priced in"*, and therefore the one somebody is certain to be holding.
 *
 * **Whether anybody actually takes it is the payer's business risk, not the menu's problem.** The
 * `sign` side already filters to principals with a real insurable interest (RSK1), so an offer nobody
 * can bind lapses `UNTAKEN` and its escrow goes home — which is a published outcome with its own row,
 * not a silent loss.
 */
function pickTarget(input: RiskViewInput): { readonly system: SystemId; readonly good: GoodId } | null {
  let best: { system: SystemId; odds: number } | null = null;
  for (const front of input.book.liveFronts(input.tick)) {
    if (stateAt(front, input.tick, FRONT_COVER_FREEZE_TICKS) !== 'FORECAST') continue;
    for (const cell of [...coneAt(front, input.tick)].sort(
      (a, b) => b.oddsBps - a.oddsBps || compareIds(a.system, b.system),
    )) {
      if (best === null || cell.oddsBps > best.odds) best = { system: cell.system, odds: cell.oddsBps };
    }
  }
  return best === null ? null : { system: best.system, good: ENDOWMENT_GOOD };
}

/** The band published to agents, so `agent.md` and the engine cannot disagree about it. */
export const COVER_BAND_STATEMENT =
  `A COVER's elective share is between ${String(COVER_ELECTIVE_BPS_FLOOR)} and ` +
  `${String(COVER_ELECTIVE_BPS_CEILING)} bps. Full escrow is refused — it would delete the promise — ` +
  `and so is zero escrow, which is how a counterparty with nothing sells cover (A7).`;

/** The clock, published. */
export const FRONT_CLOCK_STATEMENT =
  `A FRONT is announced two RECKONINGS out, shuts to new COVER ${String(FRONT_COVER_FREEZE_TICKS)} ` +
  `ticks before it lands, strikes, and then its INDEMNITIES fall due at that RECKONING's settlement — ` +
  `${String(HONOUR_WINDOW_TICKS)} ticks later. A COVER attaches ${String(COVER_WAIT_TICKS)} ticks ` +
  `after you sign it.`;
