/**
 * The adapter — everything the runtime needs, behind a port it can hand over in eight members.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * `D21`: *"where new code goes: **not** `sim/runtime.ts`. It is 9,700 lines and three edits landed in
 * the wrong place there in one day, all passing `tsc`."* `works/refine.ts` is the worked example and
 * states the value: *"the signature ENUMERATES what the operation can reach."*
 *
 * So the whole risk market's behaviour lives here and `runtime.ts` gains **three phase delegations
 * and three verb delegations**, each two lines. The port has no `Runtime` in it, which means every
 * function below is unit-testable against a fixture and none of them can reach a field nobody
 * declared.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { Rng } from '../core/rng.js';
import { SETTLEMENT_PHASE, TICKS_PER_RECKONING, isSettlementTick, reckoningIndex } from '../core/time.js';
import { readInt, readString } from '../core/params.js';
import type { CoverId, EventId, GoodId, PrincipalId, SystemId } from '../core/types.js';
import { bps, minor, type Minor } from '../core/units.js';
import { storesAccount } from '../ledger/accounts.js';
import type { Ledger } from '../ledger/ledger.js';
import { DEFAULT_VALUATION_RULE } from '../ledger/valuation.js';
import type { WorldMap } from '../world/map.js';
import { reject, type WorldResult } from '../world/result.js';
import { IN_FULL, type Election } from '../venture/settlement.js';
import { pinnedAt } from '../venture/terms.js';
import { RiskBook } from './book.js';
import {
  bindCover,
  coverEscrow,
  coverLine,
  cycleInChain,
  fingerprintOf,
  halvesOf,
  offerCover,
  type CoverRecord,
  type CoverSubject,
} from './cover.js';
import {
  announceIfDue,
  attachSeasoned,
  FRONT_SINK,
  lapseExpired,
  settleCohort,
  strikeFront,
  type FrontPort,
} from './run.js';
import { destroySet, isLandfallTick, stateAt } from './front.js';
import { assertRiskInvariants } from './invariants.js';
import {
  COVER_ELECTIVE_BPS_CEILING,
  COVER_ELECTIVE_BPS_FLOOR,
  COVER_MAX_DEPTH,
  COVER_OFFER_TTL_TICKS,
  COVER_TERM_TICKS,
  FRONT_COVER_FREEZE_TICKS,
} from './params.js';

/** One row on its way to the append-only record. Shaped by the caller, never built here. */
export interface RiskEventDraft {
  readonly kind: string;
  readonly actor: PrincipalId | null;
  readonly family: string;
  readonly parent: EventId | null;
  readonly payload: Readonly<Record<string, string | number>>;
}

/** How long a published COVER offer stands. Owned by the caller so one constant serves both. */
export interface RiskWirePort {
  readonly ledger: Ledger;
  readonly book: RiskBook;
  readonly map: WorldMap;
  /** This phase's own sub-stream. Never the tick's root (`tick/seed.ts`). */
  readonly rng: Rng;
  readonly tick: number;
  readonly frozenStateVersion: number;
  /**
   * Pinned onto every COVER, because *"accepted obligations pin the version they quoted, or a balance
   * patch retroactively rewrites history"* (§15.1's event fields). Passed rather than imported so this
   * module cannot drift from the runtime's own constant.
   */
  readonly rulesVersion: number;
  readonly emit: (draft: RiskEventDraft) => void;
  /**
   * ★ **Append one row NOW and return its minted id.** INV-12 is why this exists.
   *
   * `emit` buffers to `pendingRecord` and the row is minted in `DERIVE`, so its id does not exist yet
   * — and INV-12 refuses any row whose `parentEventId` is not already in the ledger: *"a cause must
   * precede its effect."* The first run of this module cited a synthetic
   * `front:<id>:strike` string and **every `indemnity.opened` row was refused**, silently, into
   * `faults` — the record went quiet while the book was correct and nothing halted. That is
   * `haul.landed`'s bug verbatim: *"refused on every emission for the project's life, so the record
   * was silent while nothing failed."*
   *
   * INV-17 needs the cause to be *a row an auditor can open*, so the FRONT's strike is appended
   * immediately and its minted id is what every INDEMNITY it opens cites.
   */
  readonly emitNow: (draft: RiskEventDraft) => EventId | null;
  readonly step: (n: number) => void;
  /** A ≤140-char line for the ticker. §11.1's cap, so every act is quotable. */
  readonly ticker: (line: string) => void;
  /**
   * ★ **Register why the record is about to accuse somebody. INV-17, the top-severity check.**
   *
   * *"A default with no attributable cause is a top-severity halt, because it is the game accusing an
   * innocent agent."* `checkInv17` walks every event whose kind reads as an accusation and **halts the
   * world** unless the `DefaultRegister` holds a row for it whose `causeEventId` equals the event's
   * own `parent_event_id`. The first run of this module halted on exactly that at tick 1151:
   *
   * > *INV-17 default event ev:1151:0 (indemnity.default) has no attributable cause; the record is
   * > accusing p:rk03 with no evidence*
   *
   * Which is the invariant working. So a default row is appended **immediately** (its minted id is
   * what the register keys on), its `parent_event_id` is the cause, and the register gets the same
   * cause — *"the register and the permanent record"* must not disagree about why.
   */
  readonly attribute: (row: {
    readonly defaultEventId: EventId;
    readonly promisor: PrincipalId;
    readonly obligation: CoverId;
    readonly cause: 'LOSS' | 'MISSED_DELIVERY' | 'ELAPSED_WINDOW';
    readonly causeEventId: EventId;
  }) => void;
  /** `market/escrow.ts:freeCash` — the A15 gate. Passed rather than imported, so a test can move it. */
  readonly freeCash: (principal: PrincipalId) => Minor;
  /**
   * ★ **The mark a COVER pins, and §15.4's third defence depends on it being non-zero.**
   *
   * `venture/terms.ts:pinnedAt` returns `marks: []`, so a COVER built from it alone pins **nothing** —
   * and `pinnedMark` would throw at landfall while every earlier step read as correct. That was the
   * second thing this suite's first run found: `sign` refused with *"your interest at the pinned mark
   * is worth 0"*, which is the honest refusal, and the cause was an empty marks array rather than a
   * poor holding.
   *
   * The valuation is therefore pinned **here, at offer time, with the subject's own mark in it** —
   * which is exactly what §15.4 asks for: *"`terms_hash` includes the valuation rule **and** its as-of
   * tick."* A mark resolved at settlement instead would be the post-front spot price, which is the
   * false default this layer is most exposed to.
   */
  readonly markOf: (good: GoodId) => Minor;
  readonly offerTermTicks: number;
}

// ── HAZARD ──────────────────────────────────────────────────────────────────

/**
 * `HAZARD` — announce, season, strike, lapse. **Four steps, and the order is the argument.**
 *
 *   1. **announce** first, so a FRONT declared this tick is readable in the same observation an agent
 *      wakes into rather than a Reckoning later;
 *   2. **season** next, because a COVER that has served its waiting period must be ATTACHED *before*
 *      the strike test reads it — otherwise the one tick a front lands on is the one tick a
 *      just-seasoned COVER silently does not pay, which is a promise discharged by a clock;
 *   3. **strike**, which destroys goods and opens the cohort;
 *   4. **lapse last**, so a COVER expiring on the very tick a front lands still answers. Lapsing
 *      first would let the clock discharge a promise the world was about to call.
 */
export function runFrontPhase(port: RiskWirePort): void {
  const frontPort = frontPortOf(port);
  const announced = announceIfDue(frontPort, port.book, port.tick);
  if (announced !== null) {
    port.step(announced.cone.length + announced.swath.length);
    port.emit({
      kind: 'front.forecast',
      actor: null,
      family: announced.id,
      parent: null,
      payload: {
        front: announced.id,
        eye: announced.eye,
        landfallTick: announced.landfallTick,
        // ★ The CONE only. The SWATH is drawn at announcement and **withheld** until landfall:
        // publishing it here would put the outcome in a PUBLIC row two Reckonings early, which is
        // the oracle CAT11 CUTS and which CAT2's commitment exists to make unnecessary.
        cone: announced.cone.map((c) => `${c.system}:${String(c.oddsBps)}`).join(','),
      },
    });
    port.ticker(`A FRONT is forecast on ${announced.eye} — it lands in ${String(announced.landfallTick - port.tick)} ticks`.slice(0, 140));
  }

  attachSeasoned(port.book, port.tick);

  for (const front of port.book.liveFronts(port.tick)) {
    if (!isLandfallTick(front, port.tick)) continue;
    // ── THE STRIKE IS APPENDED FIRST, AND IT HAS TO BE (INV-12, INV-17) ────
    //
    // The cohort's rows cite this one as their parent and their cause, so it must be **in the ledger
    // with a minted id** before they are drafted. A synthetic string here got every
    // `indemnity.opened` row refused into `faults`. See `RiskWirePort.emitNow`.
    const provisional = strikePreview(frontPort, front);
    const cause =
      port.emitNow({
        kind: 'front.struck',
        actor: null,
        family: front.id,
        parent: null,
        payload: {
          front: front.id,
          swath: front.swath.map((c) => String(c.system)).join(','),
          lots: provisional.lots,
          destroyedQty: provisional.qty,
        },
      }) ?? (`front:${front.id}:strike` as EventId);

    const outcome = strikeFront(
      frontPort,
      port.book,
      front,
      port.tick,
      cause,
      reckoningIndex(port.tick) * TICKS_PER_RECKONING + SETTLEMENT_PHASE,
    );
    port.step(outcome.losses.length + outcome.indemnities.length);
    port.emit({
      kind: 'front.swept',
      actor: null,
      family: front.id,
      parent: cause,
      payload: {
        front: front.id,
        swath: outcome.swath.join(','),
        lots: outcome.losses.length,
        destroyedQty: outcome.destroyedQty,
        indemnities: outcome.indemnities.length,
        // ★ The market's own reach, on the record rather than in an instrument: principals the front
        // took goods from that held no COVER. Zero would mean everybody was insured; a large number
        // is the honest answer to *"is cover worth buying"* — and either way it is measured.
        naked: outcome.naked.length,
      },
    });
    port.ticker(
      `THE FRONT STRUCK ${outcome.swath.join(' ')} — ${String(outcome.destroyedQty)} goods gone, ` +
        `${String(outcome.indemnities.length)} covered, ${String(outcome.naked.length)} naked`,
    );
    for (const ind of outcome.indemnities) {
      port.emit({
        kind: 'indemnity.opened',
        actor: null,
        // ★ One event family per FRONT. **This is the correlation, as a column.** Every INDEMNITY off
        // one front shares it, which makes the cohort queryable and every default in it attributable
        // to one cause (§15.1's event fields, INV-17).
        family: front.id,
        parent: cause,
        payload: {
          indemnity: ind.id,
          cover: ind.cover,
          payer: ind.payer,
          payee: ind.payee,
          grossLoss: ind.grossLoss,
          covered: ind.covered,
          escrowedDue: ind.escrowedDue,
          electiveDue: ind.electiveDue,
          depth: ind.depth,
          dueTick: ind.dueTick,
        },
      });
    }
  }

  const lapsed = lapseExpired(port.ledger, port.book, port.tick, `risk:lapse:${String(port.tick)}` as EventId);
  for (const row of lapsed) {
    port.emit({
      kind: 'cover.lapsed',
      actor: row.payer,
      family: row.cover,
      parent: null,
      payload: { cover: row.cover, payer: row.payer, returned: row.returned, why: row.reason },
    });
  }
  if (lapsed.length > 0) port.step(lapsed.length);
}

/**
 * What the strike is *about* to take, for the row that has to be appended before it happens.
 *
 * Reads `destroySet` over the same lots the strike will, and destroys nothing. Two counts rather than
 * the whole list, because the header row is a headline and the per-lot detail is in the postings.
 */
function strikePreview(
  frontPort: FrontPort,
  front: Parameters<typeof strikeFront>[2],
): { readonly lots: number; readonly qty: number } {
  const set = destroySet(front, frontPort.lots());
  return { lots: set.length, qty: set.reduce((sum, l) => sum + l.qty, 0) };
}

function frontPortOf(port: RiskWirePort): FrontPort {
  return {
    map: port.map,
    rng: port.rng,
    lots: () => port.ledger.allLots(),
    destroy: (args) => {
      port.ledger.destroyGoods({
        eventId: args.eventId,
        tick: port.tick,
        // §10.2's own sink, whose comment has named fronts for the whole project. The named constant
        // rather than the string: a magic literal beside an exported name for the same account is two
        // homes for one fact, which is what lets a future sink land in the wrong one.
        sink: FRONT_SINK,
        lotId: args.lotId,
        qty: args.qty,
      });
    },
    storesOf: (principal) => storesAccount(principal),
  };
}

// ── OBLIGE, after the venture batch ─────────────────────────────────────────

export interface CohortReport {
  readonly fronts: number;
  readonly settled: number;
  readonly defaults: number;
  readonly honoured: number;
  readonly propagated: number;
  readonly paid: Minor;
  readonly unattributed: Minor;
  readonly deepestFailure: number;
}

/**
 * Settle every INDEMNITY off every struck FRONT, outermost cession first.
 *
 * Position in `OBLIGE` is a rule and the runtime's handler carries the argument: after `settleNow`
 * because `verifyInputs` halts on a balance that moved, and before the Levy sweep because an
 * INDEMNITY paid after the bailiff is a mechanism that is technically live and practically useless.
 */
export function runCohortPhase(port: RiskWirePort, elections: Map<CoverId, Election>): CohortReport {
  const report = {
    fronts: 0,
    settled: 0,
    defaults: 0,
    honoured: 0,
    propagated: 0,
    paid: minor(0),
    unattributed: minor(0),
    deepestFailure: 0,
  };
  if (!isSettlementTick(port.tick)) return report;
  const reckoning = reckoningIndex(port.tick);

  for (const front of port.book.liveFronts(port.tick)) {
    if (front.struckAtTick === null) continue;
    if (port.book.cohortOf(front.id).length === 0) continue;
    report.fronts += 1;

    const versions = new Map<CoverId, number>();
    for (const cover of port.book.allCovers()) {
      if (cover.actedOnStateVersion !== null) versions.set(cover.id, cover.actedOnStateVersion);
    }
    const outcome = settleCohort({
      ledger: port.ledger,
      book: port.book,
      front,
      tick: port.tick,
      eventId: `risk:cohort:${front.id}:${String(port.tick)}` as EventId,
      elections,
      actedOnStateVersion: versions,
      // ── THE ACCUSATION IS PUBLISHED AND REGISTERED INSIDE THE WALK ──────────
      //
      // Not after it, and that is INV-17 rather than tidiness. The walk needs the **minted** id to put
      // in `letDownBy`, and the register needs the same id to key on; publishing afterwards gave the
      // map a content-derived string and `checkInv17` halted with *"cites cause …, which is not in the
      // ledger"*. One call site, one id, three consumers.
      publishDefault: (d, s) => {
        const id = port.emitNow({
          kind: 'indemnity.default',
          actor: d.payer,
          family: front.id,
          parent: d.causeEventId,
          payload: {
            indemnity: s.indemnity,
            cover: s.cover,
            payer: s.payer,
            payee: s.payee,
            escrowedPaid: s.escrowedPaid,
            electivePaid: s.electivePaid,
            recordedLoss: s.escrowedShortfall,
            broke: s.electiveShortfall,
            state: s.state,
            cause: d.cause,
            depth: d.depth,
            line: s.line,
          },
        });
        if (id !== null) {
          port.attribute({
            defaultEventId: id,
            promisor: d.payer,
            obligation: d.cover,
            // `LOSS` when the FRONT itself caused it; `MISSED_DELIVERY` when the cause is another
            // payer's default — which is the propagation, typed. `ELAPSED_WINDOW` is a venture's shape
            // and never a cover's: a COVER's clock does not produce the breach, a loss does.
            cause: d.causeEventId === front.causeEventId ? 'LOSS' : 'MISSED_DELIVERY',
            causeEventId: d.causeEventId,
          });
        }
        return id;
      },
    });
    port.step(outcome.settlements.length * 2 + outcome.defaults.length);

    for (const s of outcome.settlements) {
      report.settled += 1;
      const payload = {
        indemnity: s.indemnity,
        cover: s.cover,
        payer: s.payer,
        payee: s.payee,
        escrowedPaid: s.escrowedPaid,
        electivePaid: s.electivePaid,
        // A7's whole point, in two columns that a reader can never confuse: what the escrow could not
        // cover is a **recorded loss** and never a default (`escrowShortIsNeverDefault`).
        recordedLoss: s.escrowedShortfall,
        broke: s.electiveShortfall,
        state: s.state,
        line: s.line,
      };
      // A settled row for every INDEMNITY that did NOT default. The default rows were already
      // appended and registered inside the walk above (see `publishDefault`), so emitting one here
      // too would publish the accusation twice — scar #5's shape in the record.
      if (s.defaults.length === 0) {
        port.emit({
          kind: 'indemnity.settled',
          actor: s.payer,
          family: front.id,
          parent: front.causeEventId,
          payload,
        });
      }
      port.ticker(s.line);
      if (s.state !== 'DEFERRED') elections.delete(s.cover);
    }
    report.defaults += outcome.defaults.length;
    report.honoured += outcome.honoured.length;
    report.propagated += outcome.propagated;
    report.paid = minor(report.paid + outcome.paid);
    report.unattributed = minor(report.unattributed + outcome.unattributed);
    report.deepestFailure = Math.max(report.deepestFailure, outcome.deepestFailure);

    if (outcome.propagated > 0) {
      // ★ The number this whole layer exists to make non-zero, on the record rather than in a report,
      // because *"an unmeasured capability is the same defect one level up"*.
      port.emit({
        kind: 'indemnity.propagated',
        actor: null,
        family: front.id,
        parent: front.causeEventId,
        payload: {
          front: front.id,
          propagated: outcome.propagated,
          deepestFailure: outcome.deepestFailure,
          defaults: outcome.defaults.length,
        },
      });
      port.ticker(
        `A FAILURE TRAVELLED — ${String(outcome.propagated)} of ${String(outcome.defaults.length)} ` +
          `defaults were caused by another default, deepest at layer ${String(outcome.deepestFailure)}`,
      );
    }
    assertRiskInvariants(port.ledger, port.book, outcome.defaults);
  }
  port.book.prune(reckoning);
  return report;
}

// ── The three verb shapes ───────────────────────────────────────────────────

/**
 * `publish_offer {kind:"COVER"}` — write cover.
 *
 * The third shape of a verb that already had two. `say/offer.ts` states the precedent: *"naming a
 * claim (`cede`) publishes an offer with a subject the engine can actually transfer"*. Cover is such
 * a subject, so it goes through the same door rather than spending one of §17's 40.
 *
 * **The escrow moves here and not at `sign`**, which is RSK2's firm capacity and §7.3's own argument
 * one system over: *"otherwise filling a slot is a free option and sybils can hold a stage's entire
 * capacity all day and no-show."* It is also where A15 becomes arithmetic — the escrow is funded from
 * `freeCash`, which withholds the endowment, so a fresh identity can write **nothing**.
 */
export function publishCover(
  port: RiskWirePort,
  principal: PrincipalId,
  params: Readonly<Record<string, unknown>>,
): WorldResult<null> {
  const limit = readInt(params, ['limit', 'cover', 'amount']);
  const premium = readInt(params, ['premium', 'price']);
  const electiveBps = readInt(params, ['elective_bps', 'electiveBps']) ?? COVER_ELECTIVE_BPS_FLOOR;
  const overCover = readString(params, ['over', 'over_cover', 'reinsure']) as CoverId | null;
  const system = readString(params, ['system', 'at']) as SystemId | null;
  const good = readString(params, ['good', 'goods']) as GoodId | null;

  if (limit === null || premium === null) {
    return reject(
      'A2',
      'publish_offer {"kind":"COVER"} needs {"limit":N,"premium":N} plus either ' +
        '{"system":"<id>","good":"<good>"} for a primary COVER, or {"over":"<coverId>"} to stand behind ' +
        `somebody else's promise. \`elective_bps\` is optional and defaults to ` +
        `${String(COVER_ELECTIVE_BPS_FLOOR)} — the floor, because a promise with no elective half is a fee.`,
    );
  }

  let over: CoverSubject;
  let depth = 1;
  let fingerprint: string;
  if (overCover !== null) {
    const parent = port.book.cover(overCover);
    if (parent === undefined) return reject('PROP-R5', `there is no cover ${overCover}.`);
    if (parent.payee === null) {
      return reject(
        'PROP-R5',
        `cover ${overCover} is not bound, so there is no promise behind it to stand behind. A cession ` +
          'attaches to an obligation somebody has actually taken on.',
      );
    }
    if (cycleInChain(port.book.chainUnder(overCover), principal)) {
      return reject(
        'PROP-R5',
        `you are already a payer in the chain under ${overCover}, so this would cede the same risk back ` +
          'to a house already holding it. A cycle in a settlement graph is false diversification and an ' +
          'unbounded cascade (RE6, §15.2).',
      );
    }
    over = { kind: 'COVER', cover: overCover };
    depth = parent.depth + 1;
    fingerprint = fingerprintOf(over, parent);
    if (depth > COVER_MAX_DEPTH) {
      return reject(
        'PROP-R5',
        `that would be layer ${String(depth)} and ${String(COVER_MAX_DEPTH)} is the limit (RE6).`,
      );
    }
  } else {
    if (system === null || good === null) {
      return reject(
        'A2',
        'a primary COVER needs {"system":"<id>","good":"<good>"} — the located goods it stands over. ' +
          'Send {"over":"<coverId>"} instead to stand behind another payer.',
      );
    }
    if (port.map.systems.get(system) === undefined) return reject('A2', `there is no system ${system}.`);
    over = { kind: 'GOODS', system, good };
    fingerprint = fingerprintOf(over, undefined);
  }

  if (electiveBps < COVER_ELECTIVE_BPS_FLOOR || electiveBps > COVER_ELECTIVE_BPS_CEILING) {
    return reject(
      'PROP-R2',
      `elective_bps is between ${String(COVER_ELECTIVE_BPS_FLOOR)} and ` +
        `${String(COVER_ELECTIVE_BPS_CEILING)} and you sent ${String(electiveBps)}. Full escrow deletes the ` +
        'promise; zero escrow is how a counterparty with nothing sells cover (A7).',
    );
  }

  const halves = halvesOf(minor(limit), bps(electiveBps));
  const cash = port.freeCash(principal);
  if (cash < halves.escrowed) {
    return reject(
      'PROP-R1',
      `the escrowed half of a ${String(limit)} limit is ${String(halves.escrowed)} and your free cash is ` +
        `${String(cash)}. Writing cover costs capital that can be taken — your starter stake is withheld ` +
        'from it, so a fresh identity is worth zero here (A15, D7).',
    );
  }

  const offered = offerCover({
    tick: port.tick,
    payer: principal,
    over,
    limit: minor(limit),
    premium: minor(premium),
    electiveBps: bps(electiveBps),
    offerExpiresTick: port.tick + COVER_OFFER_TTL_TICKS,
    expiresTick: port.tick + COVER_TERM_TICKS,
    // ★ The mark goes IN, at offer time. See `RiskWirePort.markOf`.
    valuation: {
      ...pinnedAt(DEFAULT_VALUATION_RULE, port.tick),
      marks: over.kind === 'GOODS' ? [{ good: over.good, unitPrice: port.markOf(over.good) }] : [],
    },
    rulesVersion: port.rulesVersion,
    depth,
    fingerprint,
    boundByGrant: null,
    actedBy: null,
  });
  if (!offered.ok) return offered;
  const cover = offered.value;

  // The account, then the money. In that order: an account that exists holding nothing is a readable
  // zero; a transfer into an account that does not exist is a throw inside a phase.
  const escrow = coverEscrow(cover.id, cover.payer);
  if (port.ledger.account(escrow) === undefined) {
    port.ledger.openAccount(escrow, 'ESCROW', cover.payer);
  }
  if (halves.escrowed > 0) {
    port.ledger.transferCurrency({
      eventId: `${cover.id}:escrow` as EventId,
      tick: port.tick,
      from: storesAccount(cover.payer),
      to: escrow,
      amount: halves.escrowed,
    });
  }
  port.book.addCover(cover);
  port.emit({
    kind: 'cover.offered',
    actor: principal,
    family: cover.id,
    parent: null,
    payload: {
      cover: cover.id,
      payer: cover.payer,
      limit: cover.limit,
      premium: cover.premium,
      escrowed: cover.escrowed,
      elective: cover.elective,
      depth: cover.depth,
      fingerprint: cover.fingerprint,
      termsHash: cover.termsHash ?? '',
      subject: over.kind === 'GOODS' ? `${over.system}::${over.good}` : `over:${over.cover}`,
    },
  });
  return { ok: true, value: null };
}

/**
 * `sign {cover}` — take an offer.
 *
 * The second shape of `sign`, whose whole current body is *"countersign a venture's terms"*. Same
 * `terms_hash` echo, same idempotence, same rule — because it is the same act: *"nothing binds until
 * both parties countersign the same terms_hash"* (§7.3).
 */
export function signCover(
  port: RiskWirePort,
  principal: PrincipalId,
  params: Readonly<Record<string, unknown>>,
  stateVersion: number,
): WorldResult<null> {
  const coverId = readString(params, ['cover', 'cover_id']) as CoverId | null;
  const hash = readString(params, ['terms_hash', 'termsHash']);
  if (coverId === null || hash === null) {
    return reject(
      'PROP-W1',
      'sign {"cover":"<id>","terms_hash":"<hash>"} binds a COVER. Echo the hash off the offer — nothing ' +
        'binds until both parties countersign the same one.',
    );
  }
  const cover = port.book.cover(coverId);
  if (cover === undefined) return reject('PROP-R3', `there is no cover ${coverId}.`);

  if (cover.over.kind === 'COVER') {
    // A cession protects the house that wrote the promise below it, and nobody else. There is nothing
    // here to shop for, so the refusal names the only principal that may bind it.
    const under = port.book.cover(cover.over.cover);
    if (under === undefined || under.payer !== principal) {
      return reject(
        'PROP-R4',
        `cover ${coverId} stands behind ${cover.over.cover}, so only that cover's payer may bind it. A ` +
          'reinsurance layer protects the house that made the promise, not the holder of the goods.',
      );
    }
  }

  const held = interestOf(port, principal, cover);
  const bound = bindCover({
    cover,
    payee: principal,
    tick: port.tick,
    echoedTermsHash: hash,
    stateVersion,
    interestQty: held.qty,
    unitPrice: held.unitPrice,
    interestTaken:
      cover.over.kind === 'GOODS' &&
      port.book.interestTaken(principal, cover.over.system, cover.over.good),
    frontCoverFrozen: coverFrozenFor(port, cover),
  });
  if (!bound.ok) return bound;

  if (cover.premium > 0) {
    const cash = port.freeCash(principal);
    if (cash < cover.premium) {
      // Unbind rather than half-bind. A COVER whose premium never arrived would be cover the payee
      // did not pay for and a liability the payer did not sell — and both sides would read the row
      // as binding, which is scar #1 with money on both sides of it.
      cover.payee = null;
      cover.state = 'OFFERED';
      cover.boundTick = null;
      cover.attachesTick = null;
      cover.actedOnStateVersion = null;
      return reject(
        'PROP-R1',
        `the premium is ${String(cover.premium)} and your free cash is ${String(cash)}. **Nothing was ` +
          'bound** — a COVER whose premium never arrived is cover you did not buy.',
      );
    }
    port.ledger.transferCurrency({
      eventId: `${cover.id}:premium` as EventId,
      tick: port.tick,
      from: storesAccount(principal),
      to: storesAccount(cover.payer),
      amount: cover.premium,
    });
  }
  port.book.claimInterest(cover);
  port.book.noteWritten(cover.payer, cover.limit, cover.premium);
  port.emit({
    kind: 'cover.bound',
    actor: principal,
    family: cover.id,
    parent: null,
    payload: {
      cover: cover.id,
      payer: cover.payer,
      payee: principal,
      premium: cover.premium,
      limit: cover.limit,
      escrowed: cover.escrowed,
      elective: cover.elective,
      attachesTick: cover.attachesTick ?? 0,
      depth: cover.depth,
    },
  });
  // `coverLine` rather than a second spelling of the same sentence: the ticker and the receipt must
  // agree, and two hand-rolled strings about one promise is scar #1's shape in prose.
  port.ticker(coverLine(cover));
  return { ok: true, value: null };
}

/**
 * `elect {cover}` — the decision. Pay in full, pay a part, or (by silence) refuse.
 *
 * ★ **The shape that makes this whole layer cost no verb.** `Election = Minor | IN_FULL` is already
 * **pay · part-pay · default**, which is §7.4 MUST-5's `pay_claim | pay_partial | default_claim` with
 * nothing added. Restatable every tick until the freeze, exactly like a venture's.
 *
 * `IN_FULL` is not a convenience: a payer cannot know its `electiveDue` at the tick it is offered the
 * affordance, because the loss is valued at landfall. Forcing it to guess a number would turn a
 * larger-than-expected loss into a `DECLINED` default against a payer that refused nothing — A5′
 * through a parameter, which is the failure `settlement.ts:IN_FULL` was added to fix.
 */
export function electCover(
  port: RiskWirePort,
  principal: PrincipalId,
  params: Readonly<Record<string, unknown>>,
  elections: Map<CoverId, Election>,
  maxElections: number,
): WorldResult<null> {
  const coverId = readString(params, ['cover', 'cover_id']) as CoverId | null;
  if (coverId === null) return reject('A2', 'elect {"cover":"<id>","election":"IN_FULL"}.');

  // ── ★ A NAMED GRANT IS REFUSED HERE, BY NAME, AND THE GAP IS THE REASON ────
  //
  // **`grant`, not `on_behalf_of`, and finding that out is the point.** The first version of this
  // branch checked `on_behalf_of` and was **dead code**: `elect` is not in `HONOURS_ON_BEHALF`, so the
  // runtime's own `unhonouredOnBehalf` guard refuses that spelling before this function runs. A
  // venture's election delegates through `electionMandate`, which reads `['grant', 'grant_id']` and
  // charges the named grantor's limits — *"a delegate may hold authority from several principals … a
  // draw against the wrong grantor's limit is a wrong row in a journal INV-22 halts the world over."*
  //
  // A COVER's election does not resolve a mandate at all, so the door is shut rather than half-wired,
  // and it says so. A refusal reading *"X is the payer, not you"* would be true and would describe the
  // **wrong rule** — a delegate holding a perfectly good grant would go looking for a fence problem
  // that does not exist, which is scar #1's shape in the agent-facing text.
  //
  // ⚑ Named as a gap because it is A6's own shape with a bigger number on it: a delegate that could
  // refuse its grantor's insurance obligation at the moment of maximum leverage is the signature moment.
  const namedGrant = readString(params, ['grant', 'grant_id']);
  if (namedGrant !== null) {
    return reject(
      'A2',
      `elect on a COVER cannot be delegated yet, and it will not quietly ignore grant=${namedGrant} ` +
        'either — an election a delegate believes it made and did not is a payer the record calls a ' +
        "defaulter (A5\u2032). Only the COVER's own payer may decide. Nothing was elected. A venture " +
        "role's election IS delegable; a COVER's is not, because it would have to draw against the " +
        'grantor\u2019s limits and that journal is what INV-22 halts the world over.',
    );
  }

  const cover = port.book.cover(coverId);
  if (cover === undefined) return reject('PROP-R3', `there is no cover ${coverId}.`);
  if (cover.payer !== principal) {
    return reject(
      'PROP-R4',
      `${cover.payer} is the payer on ${coverId}, not you. Only the principal that promised may decide ` +
        'whether to keep the promise.',
    );
  }
  const ind = port.book.indemnityForCover(coverId);
  if (ind === undefined) {
    return reject(
      'PROP-R3',
      `no FRONT has struck ${coverId}, so nothing is due on it yet. An election is a decision about a ` +
        'live obligation, not a standing instruction.',
    );
  }
  if (ind.state !== 'OPEN' && ind.state !== 'DUE' && ind.state !== 'DEFERRED') {
    return reject('PROP-R3', `indemnity ${ind.id} is ${ind.state}; what was paid is already permanent (A5).`);
  }
  // The same argument `vElect` makes for ventures: an election on a finished obligation is a key that
  // is never released, and the book is a shared resource with a published cap. An agent could fill it
  // and force `DECLINED` defaults on principals that were trying to pay — A5′ reached through a buffer.
  if (elections.size >= maxElections && !elections.has(coverId)) {
    return reject('INV-26', `the election book is full at its published cap of ${String(maxElections)}.`);
  }

  const raw = params['election'] ?? params['elect'] ?? params['pay'];
  if (raw === undefined || raw === IN_FULL) {
    elections.set(coverId, IN_FULL);
    return { ok: true, value: null };
  }
  const amount = readInt(params, ['election', 'elect', 'pay']);
  if (amount === null || amount < 0) {
    return reject(
      'A2',
      'an election is "IN_FULL" or a non-negative number of minor units. IN_FULL pays the elective half ' +
        'whatever it turns out to be, which is the honest answer while the loss is still being valued.',
    );
  }
  elections.set(coverId, minor(amount));
  return { ok: true, value: null };
}

// ── Two reads the verbs share ───────────────────────────────────────────────

/** What `principal` holds of a COVER's named good at its named system, and the pinned mark. */
export function interestOf(
  port: RiskWirePort,
  principal: PrincipalId,
  cover: CoverRecord,
): { readonly qty: number; readonly unitPrice: Minor } {
  if (cover.over.kind !== 'GOODS') {
    // A cession's interest is the promise below it, which is money and not goods. `offerCover`'s
    // depth rules bound it instead, so this returns a unit interest at the parent's own limit.
    return { qty: 1, unitPrice: minor(cover.limit) };
  }
  const subject = cover.over;
  let qty = 0;
  for (const lot of port.ledger.lotsInAccount(storesAccount(principal))) {
    if (lot.good !== subject.good) continue;
    if (lot.location !== subject.system) continue;
    if (lot.state === 'IN_TRANSIT') continue;
    qty += lot.qty;
  }
  const pinned = cover.valuation.marks.find((m) => m.good === subject.good)?.unitPrice ?? minor(0);
  return { qty, unitPrice: pinned };
}

/**
 * Is the FRONT this COVER would answer already IMMINENT? CAT12's free-option CUT.
 *
 * Checked against the CONE *and* the SWATH: the cone is what an agent can see, and the swath is what
 * will happen. Using only the cone would let a cover bind against a system the front will strike but
 * never named — which is not adverse selection, it is a hole.
 */
export function coverFrozenFor(port: RiskWirePort, cover: CoverRecord): boolean {
  if (cover.over.kind !== 'GOODS') return false;
  const subject = cover.over;
  for (const front of port.book.liveFronts(port.tick)) {
    if (stateAt(front, port.tick, FRONT_COVER_FREEZE_TICKS) === 'FORECAST') continue;
    const named =
      front.cone.some((c) => c.system === subject.system) ||
      front.swath.some((c) => c.system === subject.system);
    if (named) return true;
  }
  return false;
}
