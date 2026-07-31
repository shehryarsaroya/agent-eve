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
 * | `sign {cover}` | an open offer exists, the reader holds goods at its system, **and `freeCash` covers the premium** | must be named |
 * | `elect {cover}` | an INDEMNITY this reader owes is open | must be named |
 *
 * The third clause on `sign` was added after a play-test: the affordance was offered to a principal
 * with `freeCash` of 0, which spent its action on a `PROP-R1` refusal the payload could have
 * predicted. `publish_offer` had checked the same thing since it was written, and the asymmetry
 * survived because both halves were individually correct — the shape this repo keeps finding.
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

import type { GoodId, PrincipalId, SystemId, ZoneTier } from '../core/types.js';
import { reckoningIndex } from '../core/time.js';
import { BPS_ONE, bps, minor, type Bps, type Minor, type Qty } from '../core/units.js';
import { ENDOWMENT_GOOD } from '../ledger/endowment.js';
import { compareIds } from '../ledger/order.js';
import type { RiskBook } from './book.js';
import {
  electiveOutstanding,
  escrowRatioBps,
  isAttached,
  isLiveCover,
  type CoverId,
  type CoverRecord,
} from './cover.js';
import { announceTickOf, coneAt, isFrontReckoning, landfallTickOf, stateAt, type FrontState } from './front.js';
import { electiveOwed, outstandingOf, type IndemnityRecord } from './indemnity.js';
import {
  COVER_DEDUCTIBLE_BPS,
  COVER_ELECTIVE_BPS_CEILING,
  COVER_ELECTIVE_BPS_FLOOR,
  COVER_WAIT_TICKS,
  FRONT_CONE_RECKONINGS,
  FRONT_COVER_FREEZE_TICKS,
  FRONT_EVERY_RECKONINGS,
  HONOUR_WINDOW_TICKS,
  INTENSITY_MAX_BPS,
  VULNERABILITY_BY_TIER,
  frontSparesFor,
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
    `yours. COVER shuts ${String(FRONT_COVER_FREEZE_TICKS)} ticks before landfall, and whatever it owes ` +
    `falls due ${String(HONOUR_WINDOW_TICKS)} ticks after it lands — that window is when a payer decides.`
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
    // `electiveOutstanding`, not the subtraction: one home for "what is still riding on its word", so
    // the offer card and the arc's hollow part cannot disagree by an arithmetic slip.
    onItsWord: electiveOutstanding(cover),
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

// ── The `risk` observe key ──────────────────────────────────────────────────

/**
 * ★ **THE ELEVENTH OBSERVE KEY, AND THE A9 VIOLATION IT CLOSES.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * A9: *"the spectator client never shows a live fact an agent's own `observe` wouldn't."*
 *
 * For this layer's whole life it did. The public frame carried `frontBands` — a player watched
 * `front:r3:sys-20 · sys-20 96% · lands in 555` scroll past on the spectator feed — while
 * `observe.risk` was **not a key at all**: `OBSERVE_KEYS` was a closed list of ten, and
 * {@link riskViewFor} above, complete and unit-tested since Phase 3 landed, had **zero callers**.
 * Two independent play-tests found it the same way, from opposite ends: one could not price a
 * COVER, one could not tell that a storm was coming.
 *
 * It also stranded the acts. `publish_offer {kind:"COVER"}`, `sign {cover}` and `elect {cover}`
 * were all on the menu, correctly priced, with **no block to price them from** — the
 * affordance-with-no-state shape this repo has now found at five depths.
 *
 * ## A9 in the OTHER direction, which is the half that constrains this function
 *
 * *Whatever the frame shows, an agent may see — and nothing more.* The frame carries
 * `frontBands` (front · state · eye · system · tint · ticksToLandfall · took), `coverArcs`
 * (cover · payer · payee · system · good · limit · filledBps · onItsWord · struck) and
 * `coverChains` (every link's payer, payee, depth, limit, state and what broke). So every field
 * below is either **already on that frame**, or **the reader's own state**, or **published
 * arithmetic the reader can reproduce**. Three consequences worth naming, because each was a
 * candidate field that did not survive:
 *
 *   - **The SWATH stays sealed until landfall.** `FrontRecord.swath` is drawn at *announcement*
 *     and withheld — *"which is what SEALED means everywhere else in this engine"* — so
 *     {@link frontViewFor} publishes it only once struck and this block copies that gate rather
 *     than re-deciding it. Publishing it early would hand every reader a solved game and would be
 *     a fact the frame does not carry either.
 *   - **`offers[]` is `PUBLIC` state read through a filter, never a private view.** Every event
 *     this layer emits is appended at `visibility: 'PUBLIC'` (`runtime.ts:riskPort`), `cover.offered`
 *     included, so an open offer with its payer, limit, premium and `termsHash` is already on the
 *     feed the moment it is written. What the block does is *narrow* that to the offers this reader
 *     could actually bind (RSK1's insurable interest), which is the direction §12.1's eligibility
 *     filtering is allowed to move in — less than public, never more.
 *   - **No other principal's holdings.** `your_systems_in_cone` and {@link stakeInCone} are
 *     computed from the *reader's* lots. A "who else is exposed" list would be §11.2's `SENSED`
 *     tier published as `PUBLIC` — the same call that kept `tributeLines` off the live frame,
 *     because its state derived from `hand.destination`.
 *   - **`payer_record` is `null` for an UNSEASONED payer, never zeros.** A fabricated clean record
 *     is a claim about a real agent that nothing supports (A5′).
 *
 * ## What it must let an agent answer, without a wiki (A2)
 *
 * *Is a front coming · will it reach ground I hold · how hard · when · what would cover cost me.*
 * In order: {@link riskScheduleAt} answers the first **even when there is no front** — the front
 * is scheduled (A14), so its next announcement is arithmetic, and an empty `fronts[]` beside a
 * live countdown is honest where a bare `[]` would read as *"this world has no weather"*.
 * `your_systems_in_cone` answers the second, {@link stakeInCone} the third, `ticks_to_landfall`
 * the fourth, and `offers[]` + `terms` the fifth.
 * ══════════════════════════════════════════════════════════════════════════════
 */
export interface RiskSchedule {
  readonly every_reckonings: number;
  readonly cone_reckonings: number;
  /** The RECKONING the next unlanded FRONT belongs to. */
  readonly next_reckoning: number;
  readonly next_announce_tick: number;
  readonly next_landfall_tick: number;
  /** Zero once it is announced — at which point it is a row in `fronts[]`. */
  readonly ticks_to_announce: number;
  readonly ticks_to_landfall: number;
  readonly announced: boolean;
}

/**
 * The next FRONT the calendar will produce, announced or not.
 *
 * **Pure arithmetic on the tick**, which is the point: `raid_schedule`'s argument
 * (*"a raid an agent could not see coming is a dice roll"*) applies to weather with more force,
 * because the only cheap answer to a front is to `haul` out of the cone and that takes ticks. A
 * world between fronts must still be able to say when the next one lands.
 *
 * The scan is bounded by {@link FRONT_EVERY_RECKONINGS} + 1 candidates: every `FRONT_EVERY_RECKONINGS`th
 * reckoning has one, so one full period always contains a hit.
 */
export function riskScheduleAt(tick: number): RiskSchedule {
  const from = reckoningIndex(tick);
  for (let r = from; r <= from + FRONT_EVERY_RECKONINGS + FRONT_CONE_RECKONINGS + 1; r += 1) {
    if (!isFrontReckoning(r)) continue;
    const landfall = landfallTickOf(r);
    if (landfall < tick) continue;
    const announce = announceTickOf(r);
    return {
      every_reckonings: FRONT_EVERY_RECKONINGS,
      cone_reckonings: FRONT_CONE_RECKONINGS,
      next_reckoning: r,
      next_announce_tick: announce,
      next_landfall_tick: landfall,
      ticks_to_announce: Math.max(0, announce - tick),
      ticks_to_landfall: landfall - tick,
      announced: announce <= tick,
    };
  }
  // Unreachable while `FRONT_EVERY_RECKONINGS` is finite and positive; thrown rather than
  // returned as a zero, because a schedule reading 0/0 is exactly the fabricated-fact shape
  // this block exists to remove.
  throw new Error(`no FRONT reckoning within one period of tick ${String(tick)}`);
}

/** One good's worst case at one FRONT, over the reader's own lots. */
export interface StakeRow {
  readonly good: GoodId;
  readonly qty_in_cone: number;
  /** The per-good floor, charged **once** across every struck system (`front.ts:destroySet`). */
  readonly spared: number;
  readonly worst_case_qty: number;
  readonly worst_case_minor: number;
}

export interface FrontStake {
  readonly goods: readonly StakeRow[];
  readonly worst_case_minor: number;
}

/** Reads a system's tier. Supplied by the caller — this module never opens the map. */
export type TierRead = (system: SystemId) => ZoneTier;

/**
 * ★ **"HOW HARD", AS A BOUND RATHER THAN A FORECAST** — the `projectedDrown` pattern, over weather.
 *
 * The reader's own goods standing in a live CONE, per good, priced at the marks the block already
 * carries, at the **worst intensity the tier allows**:
 *
 *   `taken(system) = trunc(exposed × trunc(INTENSITY_MAX_BPS × VULNERABILITY_BY_TIER[tier] / 10⁴) / 10⁴)`
 *
 * Every term is published: `agent.md` §11F already states the tier shares and the floors, and this
 * is those numbers applied to the reader's own lots so it does not have to. It is an **upper
 * bound over the systems the CONE names**, exactly, and never a prediction — three things can only
 * make it smaller. The SWATH is `span` systems wide and may not include yours; intensity falls off
 * per hop from the eye; and the centre is drawn in `[INTENSITY_MIN_BPS, INTENSITY_MAX_BPS]` from a
 * seed nobody may read before landfall. A2 wants genuine uncertainty left uncertain *and sourced*,
 * so the number is the bound and `note` says which way it can only move.
 *
 * ⚑ **"OVER THE SYSTEMS THE CONE NAMES" IS A REAL QUALIFIER AND IT IS MEASURED, NOT HEDGING.**
 * `coneOf` publishes {@link CONE_SYSTEMS} = 8 cells and `swathOf` draws `span` ∈ [2, 5], both
 * ranked nearest-first from the same eye — but from **different sub-streams**, so their tie-breaks
 * at equal distance can disagree. Swept over 500 fronts on the launch map twice, on two seed
 * families, **3 and 4 fronts (0.6–0.8%) had one struck system the cone did not name**, never more
 * than one cell in either sweep. So a reader holding at that
 * cell can lose more than this figure, and the honest statement is the one this function makes:
 * the bound is over the published cone. Widening it would mean publishing systems the CONE does
 * not — an oracle CAT11 CUTS by name — and narrowing the SWATH is a `front.ts` rules change with a
 * `state_hash` behind it. Stated here, in `rule`, and in `agent.md` §11F rather than left for a
 * reader to discover from a shortfall.
 *
 * The floor is charged **once per good across the whole cone**, in `compareIds` order over systems,
 * which is `destroySet`'s own rule and its own ordering — a second, prettier rule here would be a
 * preview that disagrees with the settlement it previews (scar #1, with goods attached).
 */
/** The hardest a FRONT may hit ground of this tier: the band's ceiling, times the tier's share. */
function worstIntensityAt(tier: ZoneTier): number {
  return Math.trunc((INTENSITY_MAX_BPS * VULNERABILITY_BY_TIER[tier]) / BPS_ONE);
}

export function stakeInCone(
  input: RiskViewInput,
  tierOf: TierRead,
): ReadonlyMap<string, FrontStake> {
  const out = new Map<string, FrontStake>();
  for (const front of input.book.liveFronts(input.tick)) {
    if (stateAt(front, input.tick, FRONT_COVER_FREEZE_TICKS) === 'PASSED') continue;
    const coned = new Set(coneAt(front, input.tick).map((c) => c.system));
    const byGood = new Map<GoodId, HoldingRead[]>();
    for (const held of input.holdings) {
      if (held.qty <= 0 || !coned.has(held.system)) continue;
      const rows = byGood.get(held.good);
      if (rows === undefined) byGood.set(held.good, [held]);
      else rows.push(held);
    }

    const goods: StakeRow[] = [];
    let total = 0;
    for (const good of [...byGood.keys()].sort(compareIds)) {
      // ★ **THE FLOOR IS SPENT WHERE IT SAVES THE LEAST, AND THAT IS WHAT MAKES THIS A BOUND.**
      //
      // `destroySet` charges the per-good floor **once across every struck system**, in its own lot
      // order — so which system gets the spare depends on which ones the SWATH actually hit, and
      // nothing here can know that. Sorting by system id (the first version) therefore produced a
      // number the real strike could *exceed*: spare the floor at a COMMONS cell at 2,250 bps while
      // the storm spares it at a FRONTIER cell at 9,000, and the bound is short by the difference.
      //
      // Ascending worst-intensity is the safe assignment: the floor is assumed to protect the
      // cheapest goods, so every other placement can only take less. Ties by system id, so the
      // ordering is total and the number is the same on replay (DET-1).
      const rows = [...(byGood.get(good) ?? [])].sort(
        (a, b) => worstIntensityAt(tierOf(a.system)) - worstIntensityAt(tierOf(b.system)) || compareIds(a.system, b.system),
      );
      let floorLeft = frontSparesFor(good);
      let inCone = 0;
      let spared = 0;
      let taken = 0;
      for (const row of rows) {
        const spare = Math.min(row.qty, floorLeft);
        floorLeft -= spare;
        spared += spare;
        inCone += row.qty;
        taken += Math.trunc(((row.qty - spare) * worstIntensityAt(tierOf(row.system))) / BPS_ONE);
      }
      // One mark per good (`Runtime.markOf`), so any row's price is the good's price.
      const unitPrice = rows[0]?.unitPrice ?? 0;
      const worth = taken * unitPrice;
      total += worth;
      goods.push({
        good,
        qty_in_cone: inCone,
        spared,
        worst_case_qty: taken,
        worst_case_minor: worth,
      });
    }
    out.set(front.id, { goods: Object.freeze(goods), worst_case_minor: total });
  }
  return out;
}

/**
 * What the reader may be told about a FRONT it can still act on, and the one rule behind it.
 *
 * One short sentence rather than the three-paragraph statement `holding.sovereignty` used to be:
 * *"static prose crowded out the agent's own choices"* cost a twelve-member cast 20 LIVE decisions
 * in one Reckoning, and this block is published on every wake in every world.
 */
const RISK_RULE =
  'A FRONT is weather on a clock: announced, then it lands and destroys located goods in the ' +
  'systems it actually hit. Goods IN TRANSIT are spared, so `haul` out of the CONE is always an ' +
  'answer. `at_stake.worst_case_minor` bounds what it can take FROM THE SYSTEMS THIS CONE NAMES — ' +
  "every one of them struck at its tier's maximum INTENSITY, the per-good floor charged once. The " +
  'SWATH is sealed until landfall so nobody reads it early, including us, and it is drawn ' +
  'separately from the CONE: rarely (measured 3-4 of 500 fronts) it reaches one system the cone ' +
  'does not name, and goods there are outside this figure.';

/** The published terms every COVER is written on. Constants, so a price is checkable without a wiki. */
function coverTerms(): Readonly<Record<string, unknown>> {
  return {
    deductible_bps: COVER_DEDUCTIBLE_BPS,
    attaches_in_ticks: COVER_WAIT_TICKS,
    shuts_ticks_before_landfall: FRONT_COVER_FREEZE_TICKS,
    honour_window_ticks: HONOUR_WINDOW_TICKS,
    elective_bps_floor: COVER_ELECTIVE_BPS_FLOOR,
    elective_bps_ceiling: COVER_ELECTIVE_BPS_CEILING,
  };
}

export interface RiskBlockInput {
  readonly tick: number;
  /**
   * The reader's risk state, or `null` in a world with **no risk layer at all**.
   *
   * `null` is not "nothing is happening" — that is `fronts: []` beside a live
   * {@link riskScheduleAt} countdown. It exists for the fixture builder in `src/observe/`, which
   * carries no `RiskBook`, and it is the only caller that may pass it: fabricating an empty view
   * out of a missing book is how a projection starts reporting facts nobody computed.
   */
  readonly read: { readonly input: RiskViewInput; readonly tierOf: TierRead } | null;
}

/**
 * The `risk` key, wire-shaped.
 *
 * snake_case here and camelCase in {@link RiskView}, deliberately: the wire is `agent.md`'s
 * surface and every other block in the payload is snake_case, so a `ticksToLandfall` arriving in
 * one key of eleven is a second convention an agent has to learn. `agent.md` §11F already
 * documented the snake spelling for three years' worth of fields that were never serialised;
 * this is that document being satisfied rather than corrected.
 */
export function riskBlock(input: RiskBlockInput): Readonly<Record<string, unknown>> {
  const schedule = riskScheduleAt(input.tick);
  if (input.read === null) {
    return Object.freeze({
      schedule,
      fronts: [],
      offers: [],
      covered: [],
      due: [],
      owed_to_you: [],
      your_record: { written: 0, honoured: 0, defaulted: 0, unseasoned: true },
      terms: coverTerms(),
      rule: RISK_RULE,
    });
  }

  const view = riskViewFor(input.read.input);
  const stakes = stakeInCone(input.read.input, input.read.tierOf);
  return Object.freeze({
    schedule,
    fronts: view.fronts.map((f) => ({
      front: f.front,
      state: f.state,
      eye: f.eye,
      landfall_tick: f.landfallTick,
      ticks_to_landfall: f.ticksToLandfall,
      cone: f.cone.map((c) => ({ system: c.system, odds_bps: c.oddsBps })),
      // Empty until it has struck. `frontViewFor` owns that gate; copying the condition here
      // would be a second place for the SEALED rule to be got wrong.
      swath: f.swath.map((c) => ({ system: c.system, intensity_bps: c.intensityBps })),
      your_systems_in_cone: f.yourSystemsInCone,
      at_stake: stakes.get(f.front) ?? { goods: [], worst_case_minor: 0 },
      cover_open: f.coverOpen,
      note: f.note,
    })),
    offers: view.offers.map(offerWire),
    covered: view.covered.map(offerWire),
    due: view.due.map(dueWire),
    owed_to_you: view.owedToYou.map(dueWire),
    your_record: {
      written: view.yourRecord.written,
      honoured: view.yourRecord.honoured,
      defaulted: view.yourRecord.defaulted,
      unseasoned: view.yourRecord.unseasoned,
    },
    terms: coverTerms(),
    rule: RISK_RULE,
  });
}

function offerWire(o: CoverOfferView): Readonly<Record<string, unknown>> {
  return {
    cover: o.cover,
    payer: o.payer,
    system: o.system,
    good: o.good,
    limit: o.limit,
    premium: o.premium,
    escrow_ratio_bps: o.escrowRatioBps,
    escrowed: o.escrowed,
    on_its_word: o.onItsWord,
    expires_tick: o.expiresTick,
    attaches_in_ticks: o.attachesInTicks,
    deductible_bps: o.deductibleBps,
    payer_record:
      o.payerRecord === null
        ? null
        : {
            written: o.payerRecord.written,
            honoured: o.payerRecord.honoured,
            defaulted: o.payerRecord.defaulted,
            defaulted_value: o.payerRecord.defaultedValue,
          },
    terms_hash: o.termsHash,
    note: o.note,
  };
}

function dueWire(d: ObligationDueView): Readonly<Record<string, unknown>> {
  return {
    indemnity: d.indemnity,
    cover: d.cover,
    front: d.front,
    payee: d.payee,
    covered: d.covered,
    escrowed_due: d.escrowedDue,
    elective_due: d.electiveDue,
    elective_paid: d.electivePaid,
    outstanding: d.outstanding,
    due_tick: d.dueTick,
    ticks_to_decide: d.ticksToDecide,
    depth: d.depth,
    recoverable_from: d.recoverableFrom,
    note: d.note,
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
  //
  // ★ **THE PREMIUM IS CHECKED AGAINST `freeCash` HERE, AND A PLAY-TEST IS WHY.**
  //
  // A probe read a well-formed offer, copied the `sign` affordance verbatim — `max_direct_loss:
  // 1250`, `expires_tick`, a real `terms_hash` — sent it, and got `PROP-R1: the premium is 1250 and
  // your free cash is 0. **Nothing was bound.**` The refusal was correct and the *menu* was the lie:
  // §12.1 says `affordances[]` is *"everything you can legally do right now"*, and an act the tick
  // will refuse on arrival is not that. It cost the probe an action to learn a number the payload
  // already knew.
  //
  // `publish_offer` below has had this branch since the module was written; `sign` did not, and the
  // asymmetry survived because both halves were individually correct. Same ground (`SHORT_FUNDS`),
  // same sentence shape, and **counted as one row for the ACT** rather than one per offer — the
  // rule `demand` and `trade` already follow, because the thing withheld is the verb.
  const offers = coverOffersFor(input);
  const affordable = offers.filter((o) => o.premium <= input.freeCash);
  const tooDear = offers.filter((o) => o.premium > input.freeCash);
  for (const offer of affordable) {
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
  if (tooDear.length > 0 && !input.frozen) {
    const cheapest = tooDear.reduce((a, b) => (b.premium < a.premium ? b : a));
    withheld.push({
      verb: 'sign',
      ground: 'SHORT_FUNDS',
      text:
        `\`sign {cover}\` is withheld on ${String(tooDear.length)} open COVER offer(s) over goods you ` +
        `hold: the cheapest premium is ${String(cheapest.premium)} and your free cash is ` +
        `${String(input.freeCash)}. A premium is paid on the tick it binds, so nothing binds — and ` +
        'your starter stake is withheld from it (A15). They are still in `risk.offers[]` with their ' +
        'prices, so you can see what being covered would cost before you can afford it.',
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
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⚑ **AND FOR THE MODULE'S FIRST LIFE THIS RECOMMENDED GROUND THAT WOULD NOT BURN.**
 *
 * `coneOf` truncated its candidate systems by **system id** rather than by distance from the eye, so the
 * cone's highest-odds cell was routinely a system the SWATH never touched — measured: the eye published
 * at 9,209 bps and spared, while four of the five struck systems appeared nowhere in the cone. This
 * function faithfully returned the strongest published cell, and the suggestion an agent copies verbatim
 * therefore aimed its escrow at the wrong place. **A correct read of a wrong number.**
 *
 * ★ **This function's correctness now DEPENDS on two properties of `front.ts`, and they are stated here
 * because nothing local to this file could detect them breaking:**
 *
 *   1. the SWATH is truncated **nearest-first**, so the eye is always in its own swath;
 *   2. `CONE_ODDS_PER_HOP_BPS > 2 × CONE_JITTER_BPS`, so ranking the cone by odds *is* ranking it by
 *      distance and the strongest cell is always the eye.
 *
 * `test/risk/forecast.spec.ts` asserts both directly and asserts this function's output is in the swath
 * over 200 fronts. A change to either ranking that left this file untouched would put the defect back.
 * ══════════════════════════════════════════════════════════════════════════════
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
