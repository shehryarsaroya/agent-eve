/**
 * `observe` — a decision document, not telemetry (SPEC §12.1).
 *
 * **Exactly ten top-level keys, in this order:** `header · hands · holding ·
 * obligations · ventures · counterparties · grants · market · affordances ·
 * briefing`. §17's rules budget is *at* its ceiling for observe keys, so adding one
 * means removing one, and `assertObservation` counts them rather than trusting this
 * comment.
 *
 * ## The ladder, which is the whole of "filtering, never truncation"
 *
 * §12.1: "The token budget is enforced by eligibility filtering, never truncation."
 * {@link buildObservation} builds at rung 0, measures, and if the measurement
 * exceeds {@link tokenCapFor} applies the next **named, deterministic narrowing** and
 * measures again. Each rung is a rule about the world — *counterparties you are not
 * dealing with*, *books you have nobody standing in*, *slots that are not local* —
 * and everything a rung removes is counted in `header.withheld` under `PAGED`, which
 * means *eligible, and free to fetch on the next page*.
 *
 * The last rung is a hard per-list bound whose worst case is proved to fit by
 * arithmetic (`tokens.ts:floorWorstCaseChars`). So the loop terminates, and it
 * terminates without any code path that slices a list to make a number smaller.
 *
 * ## Where R1's "3–6 live options" went
 *
 * §17 asks for a short list of 3–6 plus mandatory, and `agent.md` §6 promises
 * `affordances[]` is "everything you can legally do right now" and that "we never
 * truncate this list". Both are satisfiable at once because they are about different
 * objects: the **short list is `plan_hands`** — §12.1's own "3–6 *complete*
 * allocation plans with EV bands, worst case, and what each forecloses" — and
 * `affordances[]` is the complete option space. Reading R1 as a cap on
 * `affordances[]` would make truncation a requirement, which is the reading PROP-O1
 * exists to forbid.
 *
 * ## The wake gate
 *
 * §12.4: outside a wake, `observe` returns "the cached tick snapshot with **no fresh
 * affordances and no new `quote_id`** — legal, free, and useless." {@link observe}
 * implements that literally: the cached body is returned verbatim except that
 * `affordances` is emptied and the count moved into `header.withheld` under
 * `WAKE_SPENT`, and `header.stale` is set. Verbatim matters for PROP-O8: reusing the
 * cached `serverNow` and `next_decision_at` is what stops a stale read from making a
 * countdown jump (scar #14d).
 *
 * A `PAUSED` world takes the same path with `HALTED` (E2E-30: "`observe` returns the
 * last good snapshot marked `stale` with an empty affordance list").
 */

import { canonicalHash, type CanonicalValue } from '../core/canonical.js';
import { ticksToMs, ticksUntilReckoning } from '../core/time.js';
import type {
  GoodId,
  Grant,
  PrincipalId,
  Standing,
  SystemId,
  VentureId,
  WorldStatus,
} from '../core/types.js';
import { minor, type Bps, type Minor, type Qty } from '../core/units.js';
import { compareIds } from '../ledger/index.js';
import { isRevokedAt } from '../identity/index.js';
import {
  filledIndices,
  isLive,
  openIndices,
  projectedSettlement,
  referenceSplit,
  roleOfPrincipal,
  ventureEscrowRatioBps,
  windowContains,
  type VentureRecord,
} from '../venture/index.js';
import {
  handsOf,
  holdingOf,
  inTransitEta,
  isPresent,
  tierOf,
  type HandRecord,
} from '../world/index.js';
import type { Affordance, Candidate } from './affordance.js';
import { compareCandidates } from './affordance.js';
import { buildBriefing, nextSettlementTick, resolvesAt, type Briefing } from './briefing.js';
import { buildCatalogue, partiesNamed, sortedVentures } from './catalogue.js';
import { QuoteBook } from './quote.js';
import { canSense, exposureBandOf, type ExposureBand } from './sensing.js';
import { roleSealKey, type BookRow, type LevyBlock, type ObserveSources, type TalkRow } from './sources.js';
import { slotForecast } from './forecast.js';
import {
  FLOOR_CAPS,
  LIST_CAPS,
  estimateTokens,
  tokenCapFor,
  type ListCaps,
} from './tokens.js';
import {
  WithheldTally,
  accountingFaults,
  type FieldAccounting,
  type WithheldRow,
} from './withheld.js';

/** The ten keys, in order. `assertObservation` compares against this exactly. */
export const OBSERVE_KEYS: readonly string[] = Object.freeze([
  'header',
  'hands',
  'holding',
  'obligations',
  'ventures',
  'counterparties',
  'grants',
  'market',
  'affordances',
  'briefing',
]);

// ── the payload ──────────────────────────────────────────────────────────────

export interface NextReckoning {
  /** The settlement tick itself — the deadline. Never moves earlier (PROP-O8). */
  readonly tick: number;
  /** Ticks remaining, derived from `header.tick` in this same payload. */
  readonly ticks: number;
  /** Ventures of yours resolving there, in id order. */
  readonly what_resolves: readonly VentureId[];
  /** True while you hold a role that still needs a seal before the freeze (§11.1). */
  readonly seal_slot: boolean;
}

export interface NextDecision {
  readonly tick: number;
  /** Wall-clock milliseconds, derived from the tick gap via `ticksToMs`. */
  readonly ms: number;
}

export interface Header {
  readonly tick: number;
  /** camelCase because `agent.md` §6 and SPEC §12.1 both spell it that way. */
  readonly serverNow: number;
  readonly state_version: number;
  readonly status: WorldStatus;
  /** True when this is the cached snapshot rather than a fresh wake (§12.4, E2E-30). */
  readonly stale: boolean;
  /** Which tick the cached body was built at, or null when this body is fresh. */
  readonly cached_at_tick: number | null;
  readonly next_reckoning: NextReckoning;
  readonly next_decision_at: NextDecision;
  readonly actions_remaining: number;
  readonly wakes_remaining: number;
  readonly mandate_version: number | null;
  /**
   * Every omission, with its ground.
   *
   * Lives on `header` rather than beside `affordances` because §17 caps the payload
   * at ten top-level keys and it is *at* the ceiling: a sibling of `affordances`
   * would be an eleventh key. `agent.md` §6 promises "a `withheld` count and a
   * reason" without naming a home; the spelling `ground` rather than `reason` is
   * §3's doing and is reported as a documentation delta.
   */
  readonly withheld: readonly WithheldRow[];
}

export interface HandLine {
  readonly id: string;
  readonly ordinal: number;
  readonly state: string;
  readonly location: SystemId;
  readonly destination: SystemId | null;
  readonly free_at_tick: number | null;
  readonly in_transit_eta: number | null;
  readonly present_since_tick: number;
  /**
   * The venture whose role this hand fills, or null.
   *
   * **Derived**, never stored: `venture_role.filled_by_hand_id` is the single home of
   * commitment (§6.2, INV-9) and a `hand.venture_id` would be scar #5 on the
   * keystone. Reading it here is a projection; writing it anywhere is a bug.
   */
  readonly committed_to: VentureId | null;
  readonly cargo: readonly (readonly [GoodId, Qty])[];
}

export interface HoldingLine {
  readonly id: string;
  readonly name: string;
  readonly system: SystemId;
  readonly tier: string;
  readonly state: string;
  readonly fell_at_reckoning: number | null;
  /** Empty in Phase 0 and truthfully so: siege belongs to Phase 1 (§4). */
  readonly threats: readonly string[];
  /**
   * ★ The **CURRENCY** half of §6.3's recurring upkeep, and it is structurally zero.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THIS FIELD USED TO CARRY TWO UNITS UNDER ONE NAME AND A COMMENT THAT HAD GONE FALSE.** It said
   * *"exactly zero in Phase 0, and that is a fact rather than a placeholder: a Commons holding is
   * civic-leased and charges no upkeep"* — true when written, false since sovereignty shipped. §6.3's
   * recurring upkeep is the **CHARGE**, it is real, and it is payable **only in goods standing at the
   * claimed system**. So a single `Minor` reading 0 was not "no upkeep"; it was the goods bill missing
   * from the payload entirely, in the block a claimant reads to find out what it owes — three misses
   * from a lapsed claim and a slashed `CLAIM_BOND_MINOR`.
   *
   * The split is `api/observe.ts`'s and this now matches it word for word (HARD RULE 4 — the two
   * builders may not disagree about a key): the currency figure is 0 **because there is no currency
   * leg**, not because nothing is owed, and {@link upkeep_due_qty} carries the bill with
   * {@link upkeep_good} naming what it is in.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly upkeep_due: Minor;
  /** ★ The upkeep actually owed, in **goods** — Σ of every claim's outstanding Charge. */
  readonly upkeep_due_qty: Qty;
  /** ★ The good {@link upkeep_due_qty} is in. Published, so no agent has to assume `ration`. */
  readonly upkeep_good: GoodId;
}

export interface Obligations {
  readonly levy: LevyBlock | null;
  readonly exposure: {
    /** Σ your open `max_direct_loss` (§3). The cached figure INV-5 asserts. */
    readonly mine: Minor;
    /** A band, never a figure — see `sensing.ts` for why (PROP-VI2). */
    readonly constellation_band: ExposureBand;
  };
}

export interface MyVentureLine {
  readonly id: VentureId;
  readonly kind: string;
  readonly state: string;
  readonly stage: SystemId;
  readonly my_role: { readonly index: number; readonly label: string; readonly is_wage: boolean } | null;
  readonly roles_filled: number;
  readonly roles_total: number;
  readonly my_take_p10: Minor;
  readonly my_take_p50: Minor;
  readonly my_take_p90: Minor;
  readonly my_escrowed: Minor;
  readonly my_elective: Minor;
  readonly escrow_ratio_bps: Bps;
  readonly at_risk_p50: Minor;
  readonly resolves_at: number;
  readonly awaiting_my_signature: boolean;
}

export interface BoardSlot {
  readonly venture: VentureId;
  readonly kind: string;
  readonly stage: SystemId;
  readonly role_index: number;
  readonly label: string;
  readonly is_wage: boolean;
  readonly reference_bps: Bps;
  readonly agreed_bps: Bps | null;
  readonly ev_p10: Minor;
  readonly ev_p50: Minor;
  readonly ev_p90: Minor;
  /** The most this slot can cost its holder. Zero at the quoted stake of zero. */
  readonly worst_case: Minor;
  readonly escrowed: Minor;
  readonly elective: Minor;
  /**
   * **The hash a filler must countersign, on the row that advertises the slot.**
   *
   * Gate 3's headline measure came out `0/0` because this field did not exist on either
   * implementation of the board. A fill is a request allocated at tick close (PROP-V8) and
   * the venture stays `FORMING` until every party countersigns the same `terms_hash`
   * (§7.3) — so without the hash on the row a filler must spend a **second wake** reading
   * `ventures.mine[]` before it can sign, inside a 12-tick formation window, on a budget
   * of one wake per 18 ticks. ~46 ventures died on a missing countersignature and not one
   * on price.
   *
   * Full, never shortened: `countersign` compares it byte for byte and a prefix is
   * refused as a different deal.
   */
  readonly terms_hash: string | null;
  readonly expires_tick: number;
}

export interface Ventures {
  readonly mine: readonly MyVentureLine[];
  readonly board: readonly BoardSlot[];
  readonly talks: readonly TalkRow[];
}

export interface CounterpartyLine {
  readonly principal: PrincipalId;
  readonly handle: string | null;
  /** The public factual vectors, or null when we hold no row (never fabricated zeros). */
  readonly standing: Standing | null;
  /** Zero in Phase 0: no bond has been posted because bonds do not exist yet (§6.4). */
  readonly bond_posted: Minor;
  readonly sureties: readonly PrincipalId[];
  readonly last_default: number | null;
}

export interface GrantLine {
  readonly id: string;
  readonly counterparty: PrincipalId;
  readonly template: string;
  readonly limits: { readonly max_direct_loss: Minor; readonly max_contingent_liability: Minor };
  readonly headroom: { readonly direct: Minor; readonly contingent: Minor };
  readonly expires_tick: number;
  readonly revoked_at_tick: number | null;
}

export interface Grants {
  readonly granted: readonly GrantLine[];
  readonly held: readonly GrantLine[];
}

export interface Market {
  readonly at: readonly SystemId[];
  readonly books: readonly BookRow[];
}

/** The ten keys. Structurally a {@link CanonicalValue}, so it hashes and measures. */
export interface Observation {
  readonly header: Header;
  readonly hands: readonly HandLine[];
  readonly holding: HoldingLine;
  readonly obligations: Obligations;
  readonly ventures: Ventures;
  readonly counterparties: readonly CounterpartyLine[];
  readonly grants: Grants;
  readonly market: Market;
  readonly affordances: readonly Affordance[];
  readonly briefing: Briefing;
}

/** Cast for measuring and hashing. The payload is canonical by construction. */
export function asCanonical(observation: Observation): CanonicalValue {
  return observation as unknown as CanonicalValue;
}

export function observationHash(observation: Observation): string {
  return canonicalHash(asCanonical(observation));
}

// ── the ladder ───────────────────────────────────────────────────────────────

/**
 * One rung of narrowing. Each is a **rule about the world**, applied to every
 * principal alike, and each counts what it removed under `PAGED`.
 *
 * Ordered least-decision-relevant first. That order is the editorial judgement in
 * this file and it is stated rather than implied: a counterparty you are not dealing
 * with is worth less than a book you can trade, which is worth less than a slot you
 * could fill, which is worth less than an obligation you owe.
 */
export interface Rung {
  readonly name: string;
  readonly caps: Partial<ListCaps>;
  /** Drop counterparties not party to one of my live ventures. */
  readonly onlyDealingCounterparties?: boolean;
  /** Drop books in systems where I have no present hand. */
  readonly onlyLocalBooks?: boolean;
  /** Drop board slots staged where I have no present hand. */
  readonly onlyLocalBoard?: boolean;
  /** Drop non-mandatory affordances that risk and owe nothing, keeping one per verb. */
  readonly onlyMaterialAffordances?: boolean;
}

export const RUNGS: readonly Rung[] = Object.freeze<Rung[]>([
  { name: 'rung0', caps: {} },
  { name: 'dealing-counterparties', caps: {}, onlyDealingCounterparties: true },
  { name: 'local-books', caps: {}, onlyDealingCounterparties: true, onlyLocalBooks: true },
  {
    name: 'local-board',
    caps: {},
    onlyDealingCounterparties: true,
    onlyLocalBooks: true,
    onlyLocalBoard: true,
  },
  {
    name: 'material-affordances',
    caps: {},
    onlyDealingCounterparties: true,
    onlyLocalBooks: true,
    onlyLocalBoard: true,
    onlyMaterialAffordances: true,
  },
  {
    name: 'floor',
    caps: FLOOR_CAPS,
    onlyDealingCounterparties: true,
    onlyLocalBooks: true,
    onlyLocalBoard: true,
    onlyMaterialAffordances: true,
  },
]);

export interface BuildResult {
  readonly observation: Observation;
  readonly tokens: number;
  readonly cap: number;
  /** Which rung produced this payload. `0` means nothing had to be narrowed. */
  readonly rung: number;
  /** False only if the floor rung still overflowed — our bug, never the agent's. */
  readonly fits: boolean;
  /**
   * PROP-O1's arithmetic, checked where the candidate counts still exist.
   *
   * The finished payload does not carry its own denominators — a `candidates` field
   * per list would be four more numbers on every wake for a fact only we can be wrong
   * about — so the balance is checked here and carried out for the caller to assert or
   * log. Empty means every list balanced.
   */
  readonly accounting: readonly string[];
}

/**
 * Build a fresh observation, narrowing until it fits.
 *
 * Never throws on an agent-reachable input and never denies service: an overflow at
 * the floor rung returns the payload with `fits: false` so the caller can log it,
 * because a refused observation is a spent wake the agent cannot get back, and the
 * wake budget is the one resource in the design with no appeal (AGT-X9).
 */
export function buildObservation(
  sources: ObserveSources,
  principal: PrincipalId,
  quotes: QuoteBook = new QuoteBook(),
): BuildResult {
  const cap = tokenCapFor(sources.tick);
  let last: BuildResult | null = null;

  for (const [index, rung] of RUNGS.entries()) {
    const built = atRung(sources, principal, quotes, rung);
    const tokens = estimateTokens(asCanonical(built.observation));
    last = {
      observation: built.observation,
      tokens,
      cap,
      rung: index,
      fits: tokens <= cap,
      accounting: built.accounting,
    };
    if (tokens <= cap) return last;
  }
  if (last === null) throw new Error('unreachable: RUNGS is empty');
  return last;
}

function atRung(
  sources: ObserveSources,
  principal: PrincipalId,
  quotes: QuoteBook,
  rung: Rung,
): { readonly observation: Observation; readonly accounting: readonly string[] } {
  const tally = new WithheldTally();
  const caps = { ...LIST_CAPS, ...rung.caps };
  const accounting: FieldAccounting[] = [];

  const halted = sources.status === 'PAUSED';

  // ── affordances ───────────────────────────────────────────────────────────
  const catalogue = halted
    ? { candidates: [] as readonly Candidate[], considered: 0 }
    : buildCatalogue({ sources, principal, quotes, tally, claimed: new Set() });

  let eligible = [...catalogue.candidates].sort(compareCandidates);
  if (rung.onlyMaterialAffordances === true) {
    eligible = keepMaterial(eligible, tally);
  }
  const affordances = pageBy(eligible, caps.affordances, tally, 'affordances', (c) => c.mandatory);
  accounting.push({
    field: 'affordances',
    candidates: catalogue.considered,
    shown: affordances.length,
  });

  // ── ventures ──────────────────────────────────────────────────────────────
  const myVentures = sortedVentures(sources.ventures).filter(
    (v) => v.creator === principal || roleOfPrincipal(v, principal) !== null,
  );
  const mineLines = myVentures.map((v) => myVentureLine(v, principal, sources.tick));
  const mine = pageBy(mineLines, caps.mine, tally, 'ventures.mine', () => false);
  accounting.push({ field: 'ventures.mine', candidates: mineLines.length, shown: mine.length });

  const boardCandidates = boardSlots(sources, principal, tally, rung.onlyLocalBoard === true);
  const board = pageBy(boardCandidates.shown, caps.board, tally, 'ventures.board', () => false);
  accounting.push({ field: 'ventures.board', candidates: boardCandidates.considered, shown: board.length });

  const talkRows = [...sources.talks]
    .sort((a, b) => b.last_tick - a.last_tick || compareIds(a.venture, b.venture))
    .map(copyTalk);
  const talks = pageBy(talkRows, caps.talks, tally, 'ventures.talks', () => false);
  accounting.push({ field: 'ventures.talks', candidates: talkRows.length, shown: talks.length });

  // ── counterparties ────────────────────────────────────────────────────────
  const named = namedPrincipals(sources, principal, myVentures, board, rung.onlyDealingCounterparties === true);
  const counterLines: CounterpartyLine[] = [];
  for (const other of named) {
    const standing = sources.standingOf(other);
    if (standing === null) {
      // No row means no row. An all-zero standing would read as "clean record",
      // which is a claim about a real agent that nothing supports.
      tally.add('counterparties', 'NO_RECORD');
      continue;
    }
    counterLines.push({
      principal: other,
      handle: sources.handleOf(other),
      standing: copyStanding(standing),
      bond_posted: minor(0),
      sureties: Object.freeze([]),
      last_default: standing.lastDefaultTick,
    });
  }
  const counterparties = pageBy(counterLines, caps.counterparties, tally, 'counterparties', () => false);
  accounting.push({ field: 'counterparties', candidates: named.length, shown: counterparties.length });

  // ── market ────────────────────────────────────────────────────────────────
  const sensed: BookRow[] = [];
  for (const row of [...sources.market].sort(
    (a, b) => compareIds(a.system, b.system) || compareIds(a.good, b.good),
  )) {
    const local = canSense(sources.sensing, principal, row.system, row.system);
    if (!local || (rung.onlyLocalBooks === true && !hasPresentHandAt(sources, principal, row.system))) {
      tally.add('market', local ? 'PAGED' : 'UNSENSED');
      continue;
    }
    sensed.push(copyBook(row));
  }
  const books = pageBy(sensed, caps.market, tally, 'market', () => false);
  accounting.push({ field: 'market', candidates: sources.market.length, shown: books.length });

  // ── grants ────────────────────────────────────────────────────────────────
  const grantBlock = grantsOf(sources, principal, caps, tally);
  accounting.push({
    field: 'grants',
    candidates: grantBlock.candidates,
    shown: grantBlock.shown,
  });

  // ── the rest ──────────────────────────────────────────────────────────────
  const hands = handsOf(sources.world, principal).map((hand) => handLine(hand, sources));
  const holding = holdingLine(sources, principal);
  const briefing = buildBriefing(sources, principal);

  // PROP-O1's balance, computed while the denominators exist. Carried out rather
  // than thrown: an accounting slip is *our* arithmetic, and denying the observation
  // would spend a wake the agent cannot get back (AGT-X9).
  const faults = accountingFaults(accounting, tally);

  const header = buildHeader(sources, principal, {
    stale: false,
    cachedAtTick: null,
    withheld: tally.rows(),
    affordances,
    myVentures,
  });

  // The literal order **is** the wire order: JS preserves insertion order for
  // non-numeric string keys, and `assertObservation` compares `Object.keys` against
  // OBSERVE_KEYS exactly, so a reordering here fails a test rather than shipping.
  const observation: Observation = {
    header,
    hands: Object.freeze(hands),
    holding,
    obligations: obligationsOf(sources, principal),
    ventures: { mine: Object.freeze(mine), board: Object.freeze(board), talks: Object.freeze(talks) },
    counterparties: Object.freeze(counterparties),
    grants: grantBlock.grants,
    market: { at: Object.freeze(presentSystems(sources, principal)), books: Object.freeze(books) },
    affordances: Object.freeze(affordances.map((c) => c.affordance)),
    briefing,
  };
  return { observation, accounting: faults };
}

// ── the wake gate ────────────────────────────────────────────────────────────

/**
 * The per-principal snapshot cache.
 *
 * One entry per principal, so it is bounded by the seat count rather than by traffic
 * — scar #3 was an unbounded structure that became an OOM, and a cache keyed by
 * `(principal, tick)` would be exactly that shape.
 */
export class ObservationCache {
  private readonly rows = new Map<PrincipalId, { readonly at: number; readonly body: Observation }>();

  /**
   * `maxPrincipals` is a **declared cap** (INV-26), not a nicety.
   *
   * One row per principal is bounded by the seat count *in theory*; enrolment is free
   * and must stay free (A15), so in practice it is bounded by however many identities
   * showed up. Scar #3 was exactly this: unbounded enrolment became an OOM and a disk
   * DoS. A cached observation is ~10 KB, so 10,000 of them is ~100 MB of process memory
   * for principals that may never wake again.
   *
   * Eviction is safe by construction: a missing row means {@link darkObservation} on a
   * non-wake read, which is legal, free and useless — the same answer §12.4 already
   * promises. Losing a cached snapshot costs an agent nothing it was entitled to.
   */
  constructor(readonly maxPrincipals: number = 4_096) {}

  put(principal: PrincipalId, tick: number, body: Observation): void {
    this.rows.set(principal, { at: tick, body });
    if (this.rows.size > this.maxPrincipals) this.evictOldest();
  }

  get(principal: PrincipalId): { readonly at: number; readonly body: Observation } | undefined {
    return this.rows.get(principal);
  }

  get size(): number {
    return this.rows.size;
  }

  /**
   * Oldest cached tick first, ties broken by principal id.
   *
   * Deterministic, because a non-deterministic eviction would make two replays of one
   * tick serve different stale snapshots — and a stale snapshot is a payload an agent
   * may act on.
   */
  private evictOldest(): void {
    const ordered = [...this.rows.entries()].sort(
      (a, b) => a[1].at - b[1].at || compareIds(a[0], b[0]),
    );
    const over = this.rows.size - this.maxPrincipals;
    for (let i = 0; i < over; i += 1) {
      const victim = ordered[i];
      if (victim !== undefined) this.rows.delete(victim[0]);
    }
  }
}

export interface ObserveResult extends BuildResult {
  /** True when this payload is a fresh wake rather than the cached snapshot. */
  readonly fresh: boolean;
}

/**
 * The entry point. Fresh inside a wake; the cached snapshot outside one.
 *
 * §12.4's promise, kept literally: "outside a wake, `observe` returns the cached
 * tick snapshot with **no fresh affordances and no new `quote_id`** — legal, free,
 * and useless. This caps the owner's bill, makes A4 enforceable for the first time,
 * and turns the cost model into a guarantee."
 *
 * Useless is a *requirement*, not a side effect. So the stale path mints nothing —
 * {@link QuoteBook} is never touched — and empties the affordance list rather than
 * republishing expired options, because an affordance an agent cannot act on is not
 * "everything you can legally do right now" (agent.md §6).
 */
export function observe(
  sources: ObserveSources,
  principal: PrincipalId,
  cache: ObservationCache,
  quotes: QuoteBook = new QuoteBook(),
): ObserveResult {
  const halted = sources.status === 'PAUSED';
  if (sources.isWake && !halted) {
    const built = buildObservation(sources, principal, quotes);
    cache.put(principal, sources.tick, built.observation);
    return { ...built, fresh: true };
  }

  const cached = cache.get(principal);
  const ground = halted ? 'HALTED' : 'WAKE_SPENT';
  const body =
    cached === undefined
      ? darkObservation(sources, principal, ground)
      : staleProjection(cached.body, cached.at, ground);
  return {
    observation: body,
    tokens: estimateTokens(asCanonical(body)),
    cap: tokenCapFor(sources.tick),
    rung: 0,
    fits: true,
    fresh: false,
    accounting: Object.freeze([]),
  };
}

/**
 * The cached body, verbatim, minus its affordances.
 *
 * **Verbatim is the point.** `serverNow`, `next_reckoning` and `next_decision_at` come
 * from the cached payload, not from now, so two successive reads can never make a
 * derived countdown move backwards — scar #14d was exactly a countdown "derived
 * per-request from server time". The two fields that do change are the two that say
 * *this is not fresh*.
 */
export function staleProjection(
  body: Observation,
  cachedAtTick: number,
  ground: 'WAKE_SPENT' | 'HALTED',
): Observation {
  // **Every row the cached body carried is kept**, and the emptied list is counted on
  // top of them.
  //
  // The first draft dropped the cached `PAGED` rows for `affordances`, reasoning that
  // they would double-count. They do not: `PAGED` counts options that were *never
  // shown*, and the new row counts the ones that *were* and now are not. Dropping them
  // under-reported the total, so an agent reading `withheld` outside a wake was told
  // about fewer omissions than there were — which is PROP-O1's exact harm arriving
  // through the one path where the whole list is missing anyway.
  const merged = new Map<string, WithheldRow>();
  for (const row of body.header.withheld) {
    merged.set(`${row.field}::${row.ground}`, row);
  }
  if (body.affordances.length > 0) {
    const key = `affordances::${ground}`;
    const existing = merged.get(key);
    // Summed rather than pushed: `withheldFaults` rejects two rows for one
    // (field, ground) pair, and a duplicate would be a malformed payload rather than a
    // bigger number.
    merged.set(key, {
      field: 'affordances',
      ground,
      count: (existing?.count ?? 0) + body.affordances.length,
    });
  }
  const withheld = [...merged.values()];
  withheld.sort((a, b) => compareIds(a.field, b.field) || compareIds(a.ground, b.ground));

  return {
    header: {
      ...body.header,
      stale: true,
      cached_at_tick: cachedAtTick,
      withheld: Object.freeze(withheld),
    },
    hands: body.hands,
    holding: body.holding,
    obligations: body.obligations,
    ventures: body.ventures,
    counterparties: body.counterparties,
    grants: body.grants,
    market: body.market,
    affordances: Object.freeze([]),
    briefing: body.briefing,
  };
}

/**
 * The shape returned when there is nothing cached to return — a first call outside a
 * wake, or a restart before the principal's first wake.
 *
 * Deliberately **not** a fresh build with the affordances removed. Fresh world state
 * outside a wake is precisely the leak §12.4 closes: an owner running a bigger model
 * could poll for a strictly larger information set and pay only for inference, which
 * is A4 violated through the budget. So this carries the public clock, this
 * principal's own presence, and nothing else.
 *
 * `POST /enroll` returns "a live `observe`" (§12.5), so in production the cache is
 * seeded on the first tick a principal exists and this path is a restart artifact.
 */
export function darkObservation(
  sources: ObserveSources,
  principal: PrincipalId,
  ground: 'WAKE_SPENT' | 'HALTED',
): Observation {
  const tally = new WithheldTally();
  tally.add('affordances', ground, 1);
  const briefing = buildBriefing(sources, principal);
  // Before the literal below: object properties evaluate in source order, so a `grants`
  // row tallied while building `grants:` would arrive *after* `header:` read `rows()`
  // and would be missing from the very ledger it belongs in.
  const grants = grantsOf(sources, principal, LIST_CAPS, tally).grants;
  return {
    header: buildHeader(sources, principal, {
      stale: true,
      cachedAtTick: null,
      withheld: tally.rows(),
      affordances: [],
      myVentures: [],
    }),
    hands: Object.freeze(handsOf(sources.world, principal).map((hand) => handLine(hand, sources))),
    holding: holdingLine(sources, principal),
    obligations: obligationsOf(sources, principal),
    ventures: { mine: Object.freeze([]), board: Object.freeze([]), talks: Object.freeze([]) },
    counterparties: Object.freeze([]),
    grants,
    market: { at: Object.freeze([]), books: Object.freeze([]) },
    affordances: Object.freeze([]),
    briefing,
  };
}

// ── pieces ───────────────────────────────────────────────────────────────────

interface HeaderParts {
  readonly stale: boolean;
  readonly cachedAtTick: number | null;
  readonly withheld: readonly WithheldRow[];
  readonly affordances: readonly Candidate[];
  readonly myVentures: readonly VentureRecord[];
}

function buildHeader(sources: ObserveSources, principal: PrincipalId, parts: HeaderParts): Header {
  const settlement = nextSettlementTick(sources.tick);
  // `resolvesAt`, not `isLive`: `isLive` is `FORMING | LIVE` (the hand-occupancy index)
  // and the settlement set is `LIVE | DEFERRED`. Filtering with `isLive` published an
  // empty `what_resolves` for a principal whose DEFERRED obligation was due at this very
  // Reckoning — see `briefing.ts:resolvesAt`.
  const resolving = parts.myVentures
    .filter((v) => resolvesAt(v, settlement))
    .map((v) => v.id)
    .sort((a, b) => compareIds(a, b))
    .slice(0, LIST_CAPS.whatResolves);

  // The nearest thing that needs a decision: an affordance dying, or the Reckoning.
  // Never a value computed from a second clock read — one `serverNowMs` per payload.
  let decisionTick = settlement;
  for (const candidate of parts.affordances) {
    const at = candidate.affordance.expires_tick;
    if (at >= sources.tick && at < decisionTick) decisionTick = at;
  }

  return {
    tick: sources.tick,
    serverNow: sources.serverNowMs,
    state_version: sources.stateVersion,
    status: sources.status,
    stale: parts.stale,
    cached_at_tick: parts.cachedAtTick,
    next_reckoning: {
      tick: settlement,
      // Derived from `sources.tick` in this same payload, which is what makes the
      // countdown monotonic within a Reckoning by arithmetic rather than by care.
      ticks: ticksUntilReckoning(sources.tick),
      what_resolves: Object.freeze(resolving),
      seal_slot: parts.myVentures.some((v) => {
        const role = roleOfPrincipal(v, principal);
        // `roleSealKey` rather than a template written here: the key has one home, or
        // the API layer and this module can disagree about it and every seal slot
        // silently reads as already sealed.
        return role !== null && isLive(v) && !sources.sealedRoles.has(roleSealKey(v.id, role.index));
      }),
    },
    next_decision_at: {
      tick: decisionTick,
      ms: sources.serverNowMs + ticksToMs(Math.max(0, decisionTick - sources.tick)),
    },
    actions_remaining: sources.actionsRemaining,
    wakes_remaining: sources.wakesRemaining,
    mandate_version: sources.mandate?.version ?? null,
    withheld: Object.freeze(parts.withheld),
  };
}

function handLine(hand: HandRecord, sources: ObserveSources): HandLine {
  let committedTo: VentureId | null = null;
  for (const venture of sortedVentures(sources.ventures)) {
    if (!isLive(venture)) continue;
    if (venture.roles.some((role) => role.filledByHandId === hand.id)) {
      committedTo = venture.id;
      break;
    }
  }
  return {
    id: hand.id,
    ordinal: hand.ordinal,
    state: hand.state,
    location: hand.location,
    destination: hand.destination,
    free_at_tick: hand.freeAtTick,
    in_transit_eta: inTransitEta(hand),
    present_since_tick: hand.presentSinceTick,
    committed_to: committedTo,
    cargo: Object.freeze(
      [...hand.cargo.entries()]
        .sort((a, b) => compareIds(a[0], b[0]))
        .slice(0, LIST_CAPS.cargoGoods)
        .map(([good, amount]) => Object.freeze([good, amount] as const)),
    ),
  };
}

function holdingLine(sources: ObserveSources, principal: PrincipalId): HoldingLine {
  const holding = holdingOf(sources.world, principal);
  return {
    id: holding.id,
    name: holding.name,
    system: holding.system,
    tier: tierOf(sources.world.map, holding.system),
    state: holding.state,
    fell_at_reckoning: holding.fellAtReckoning,
    threats: Object.freeze([]),
    // Currency: structurally zero, because §6.3's upkeep has no currency leg. See the field's doc.
    upkeep_due: minor(0),
    // Goods: the real bill, read from the source rather than assumed absent.
    upkeep_due_qty: sources.upkeepOwed(principal),
    upkeep_good: sources.upkeepGood,
  };
}

function obligationsOf(sources: ObserveSources, principal: PrincipalId): Obligations {
  const mine = sources.stores.exposureMinor(principal);
  // The constellation band is built from the principal's **own** constellation's
  // aggregate as the caller supplies it — and in Phase 0 that aggregate is not yet
  // computed anywhere, so the band is this principal's own. Deliberately not
  // synthesised from other principals' encumbrances: an observation that summed
  // other agents' peril would be a continuous readout of SENSED facts (PROP-VI2).
  return {
    levy: sources.levy === null ? null : copyLevy(sources.levy),
    exposure: { mine, constellation_band: exposureBandOf(mine) },
  };
}

/**
 * ## Why the caller's objects are copied field by field
 *
 * The payload is **cached** (§12.4) and a stale read returns the cached body verbatim.
 * If the body embedded a caller-owned object by reference, the Levy module updating its
 * own row would silently rewrite every cached snapshot pointing at it — and an agent
 * outside its wake would then read *fresh* state through a stale payload. That is A4 for
 * cognition failing through aliasing rather than through a code path, which is the kind
 * nobody finds.
 *
 * The `ObserveSources` doc says the caller freezes what it passes. That is the right
 * contract and this is the reason not to *rely* on it: the failure is invisible, and
 * copying four small shapes costs nothing.
 */
function copyLevy(levy: LevyBlock): LevyBlock {
  return Object.freeze({
    my_assessment: levy.my_assessment,
    paid: levy.paid,
    deliverable_to: levy.deliverable_to,
    shortfall_if_unpaid: levy.shortfall_if_unpaid,
    ballot:
      levy.ballot === null
        ? null
        : Object.freeze({
            id: levy.ballot.id,
            kind: levy.ballot.kind,
            closes_tick: levy.ballot.closes_tick,
            voted: levy.ballot.voted,
            target: levy.ballot.target,
          }),
    non_escrowable: levy.non_escrowable,
  });
}

function copyBook(row: BookRow): BookRow {
  return Object.freeze({
    system: row.system,
    good: row.good,
    best_bid: row.best_bid,
    best_ask: row.best_ask,
    depth: Object.freeze(
      row.depth.map((band) => Object.freeze({ qty: band.qty, bid: band.bid, ask: band.ask })),
    ),
  });
}

function copyTalk(row: TalkRow): TalkRow {
  return Object.freeze({
    venture: row.venture,
    counterparty: row.counterparty,
    unread: row.unread,
    last_tick: row.last_tick,
  });
}

function copyStanding(standing: Standing): Standing {
  return Object.freeze({
    principal: standing.principal,
    electiveHonoured: standing.electiveHonoured,
    electiveHonouredValue: standing.electiveHonouredValue,
    defaults: standing.defaults,
    contradictedSeals: standing.contradictedSeals,
    distinctCounterparties: standing.distinctCounterparties,
    lastDefaultTick: standing.lastDefaultTick,
  });
}

/**
 * `grants` — and the one list whose cap the floor rung has to actually apply.
 *
 * Sixteen grant lines are ~4,800 characters, which is 40% of §17's whole normal budget
 * and by far the largest single block a payload can carry. The first version of this
 * function ignored the rung and sliced at `LIST_CAPS` on every rung, which meant two
 * things at once: the floor rung's worst case was ~4,000 characters above what
 * `tokens.ts:floorWorstCaseChars` proved (so the ladder could run out of rungs and
 * return `fits: false` on a world inside every declared cap — three hands loaded to
 * `world/hands.ts:MAX_CARGO_GOODS` and sixteen grants is enough), and the slice itself
 * was an **uncounted** omission, which is the truncation `withheld.ts` exists to make
 * unrepresentable.
 *
 * So the cap comes from the rung and the overflow is counted under `grants`/`PAGED`,
 * retrievable like every other paged list.
 */
function grantsOf(
  sources: ObserveSources,
  principal: PrincipalId,
  caps: ListCaps,
  tally: WithheldTally,
): { readonly grants: Grants; readonly candidates: number; readonly shown: number } {
  const granted: GrantLine[] = [];
  const held: GrantLine[] = [];
  for (const grant of [...sources.grants].sort((a, b) => compareIds(a.id, b.id))) {
    if (grant.grantor === principal) granted.push(grantLine(grant, grant.delegate));
    else if (grant.delegate === principal) held.push(grantLine(grant, grant.grantor));
  }
  const keptGranted = pageBy(granted, caps.granted, tally, 'grants', () => false);
  const keptHeld = pageBy(held, caps.held, tally, 'grants', () => false);
  return {
    grants: {
      granted: Object.freeze(keptGranted),
      held: Object.freeze(keptHeld),
    },
    candidates: granted.length + held.length,
    shown: keptGranted.length + keptHeld.length,
  };
}

function grantLine(grant: Grant, counterparty: PrincipalId): GrantLine {
  return {
    id: grant.id,
    counterparty,
    template: grant.template,
    limits: {
      max_direct_loss: grant.maxDirectLoss,
      max_contingent_liability: grant.maxContingentLiability,
    },
    // INV-22: headroom is never negative. Floored here as well as asserted there,
    // because a negative headroom on screen reads as a debt an agent cannot find.
    headroom: {
      direct: minor(Math.max(0, grant.maxDirectLoss - grant.spentDirect)),
      contingent: minor(Math.max(0, grant.maxContingentLiability - grant.spentContingent)),
    },
    expires_tick: grant.expiresTick,
    revoked_at_tick: grant.revokedAtTick,
  };
}

function myVentureLine(venture: VentureRecord, principal: PrincipalId, tick: number): MyVentureLine {
  const role = roleOfPrincipal(venture, principal);
  const projected = projectedSettlement(venture, tick);
  const party = projected.parties.find((p) => p.principal === principal);
  return {
    id: venture.id,
    kind: venture.kind,
    state: venture.state,
    stage: venture.stage,
    my_role:
      role === null
        ? null
        : { index: role.index, label: role.label, is_wage: role.terms.wage !== null },
    roles_filled: filledIndices(venture).length,
    roles_total: venture.roles.length,
    my_take_p10: party?.p10 ?? minor(0),
    my_take_p50: party?.p50 ?? minor(0),
    my_take_p90: party?.p90 ?? minor(0),
    my_escrowed: party?.escrowedAtP50 ?? minor(0),
    my_elective: party?.electiveAtP50 ?? minor(0),
    escrow_ratio_bps: ventureEscrowRatioBps(venture),
    at_risk_p50: projected.atRiskAtP50,
    resolves_at: venture.resolvesAtTick,
    awaiting_my_signature: isLive(venture) && !venture.countersigned.has(principal),
  };
}

/**
 * `board[]` — "only slots I am eligible for" (§12.1).
 *
 * Eligibility is the same composition the catalogue uses, for the same reason: a
 * board slot an agent cannot fill is an advertisement, and an advertisement in a
 * decision document is a lie with a number attached.
 */
function boardSlots(
  sources: ObserveSources,
  principal: PrincipalId,
  tally: WithheldTally,
  localOnly: boolean,
): { readonly shown: BoardSlot[]; readonly considered: number } {
  const shown: BoardSlot[] = [];
  let considered = 0;

  for (const venture of sortedVentures(sources.ventures)) {
    if (venture.state !== 'FORMING') continue;
    const reference = referenceSplit(venture);
    for (const index of openIndices(venture)) {
      considered += 1;
      if (!windowContains(venture, sources.tick)) {
        tally.add('ventures.board', 'WINDOW_SHUT');
        continue;
      }
      if (roleOfPrincipal(venture, principal) !== null) {
        tally.add('ventures.board', 'NO_HAND_FREE');
        continue;
      }
      if (!hasFreeHandAt(sources, principal, venture.stage)) {
        tally.add('ventures.board', 'OUT_OF_REACH');
        continue;
      }
      if (localOnly && !hasPresentHandAt(sources, principal, venture.stage)) {
        tally.add('ventures.board', 'PAGED');
        continue;
      }
      const role = venture.roles[index];
      const share = reference.find((r) => r.roleIndex === index);
      if (role === undefined || share === undefined) {
        tally.add('ventures.board', 'NO_RECORD');
        continue;
      }
      const forecast = slotForecast(venture, index);
      shown.push({
        venture: venture.id,
        kind: venture.kind,
        stage: venture.stage,
        role_index: index,
        label: role.label,
        is_wage: role.terms.wage !== null,
        reference_bps: share.referenceBps,
        agreed_bps: share.agreedBps,
        ev_p10: forecast.p10,
        ev_p50: forecast.p50,
        ev_p90: forecast.p90,
        // The quoted stake is zero, so the worst case of *taking the slot as quoted*
        // is zero. Matches `fill_role`'s `max_direct_loss` exactly, and it has to:
        // two numbers for one worst case is scar #5 with the honesty guarantee.
        worst_case: minor(0),
        escrowed: role.terms.escrowed,
        elective: role.terms.elective,
        terms_hash: venture.termsHash,
        expires_tick: venture.windowClosesTick,
      });
    }
  }
  return { shown, considered };
}

function hasFreeHandAt(sources: ObserveSources, principal: PrincipalId, system: SystemId): boolean {
  return handsOf(sources.world, principal).some(
    (hand) => hand.state === 'IDLE' && isPresent(hand, sources.tick) && hand.location === system,
  );
}

function hasPresentHandAt(sources: ObserveSources, principal: PrincipalId, system: SystemId): boolean {
  return handsOf(sources.world, principal).some(
    (hand) => isPresent(hand, sources.tick) && hand.location === system,
  );
}

function presentSystems(sources: ObserveSources, principal: PrincipalId): SystemId[] {
  const seen = new Set<SystemId>();
  for (const hand of handsOf(sources.world, principal)) {
    if (isPresent(hand, sources.tick)) seen.add(hand.location);
  }
  return [...seen].sort((a, b) => compareIds(a, b));
}

/**
 * Everyone the payload names — §12.1's "only agents named above".
 *
 * The rung's narrowing drops principals this agent is not actually dealing with,
 * which is a rule about the relationship rather than a slice of a list.
 */
function namedPrincipals(
  sources: ObserveSources,
  principal: PrincipalId,
  myVentures: readonly VentureRecord[],
  board: readonly BoardSlot[],
  dealingOnly: boolean,
): readonly PrincipalId[] {
  const seen = new Set<PrincipalId>();
  for (const venture of myVentures) {
    for (const other of partiesNamed(venture)) {
      if (other !== principal) seen.add(other);
    }
  }
  if (!dealingOnly) {
    const byId = new Map(sources.ventures.map((v) => [v.id, v] as const));
    for (const slot of board) {
      const venture = byId.get(slot.venture);
      if (venture === undefined) continue;
      for (const other of partiesNamed(venture)) {
        if (other !== principal) seen.add(other);
      }
    }
    for (const talk of sources.talks) {
      if (talk.counterparty !== principal) seen.add(talk.counterparty);
    }
    for (const grant of sources.grants) {
      if (grant.grantor === principal) seen.add(grant.delegate);
      if (grant.delegate === principal) seen.add(grant.grantor);
    }
  } else {
    for (const grant of sources.grants) {
      if (isRevokedAt(grant.revokedAtTick, sources.tick)) continue;
      if (grant.grantor === principal) seen.add(grant.delegate);
      if (grant.delegate === principal) seen.add(grant.grantor);
    }
  }
  return [...seen].sort((a, b) => compareIds(a, b));
}

/**
 * Keep the affordances that risk or owe something, plus every mandatory one, plus
 * **one per verb** whatever its numbers.
 *
 * The last clause is what keeps this a narrowing rather than a deletion: the *shape*
 * of the option space survives, so an agent still learns that `scan` and `claim` are
 * available and can page for the enumeration. Dropping a verb entirely would change
 * what an agent believes it can do, which is the harm PROP-O1 is about.
 */
function keepMaterial(candidates: readonly Candidate[], tally: WithheldTally): Candidate[] {
  const kept: Candidate[] = [];
  const seenVerb = new Set<string>();
  for (const candidate of candidates) {
    const material =
      candidate.mandatory ||
      candidate.affordance.max_direct_loss > 0 ||
      candidate.affordance.max_contingent_liability > 0 ||
      !seenVerb.has(candidate.affordance.verb);
    seenVerb.add(candidate.affordance.verb);
    if (material) kept.push(candidate);
    else tally.add('affordances', 'PAGED');
  }
  return kept;
}

/**
 * Apply a declared cap by **paging**, never by slicing away the tail silently.
 *
 * Everything over the cap is counted under `PAGED` and is retrievable free through
 * `services.ts:page`. Two properties this must have and the obvious implementation
 * does not:
 *
 * - **Input order survives.** Partitioning into protected-then-rest would reorder the
 *   payload, and the ordering is the agent's only signal of what matters most.
 * - **A protected item is kept even past the cap.** A mandatory affordance dropped to
 *   satisfy a size budget is exactly the trade PROP-O1 forbids, so in the pathological
 *   case where the mandatory set alone exceeds the cap the payload runs over and
 *   `BuildResult.fits` says so. Overflowing our own budget is a defect we can see;
 *   hiding a mandatory obligation is one the agent cannot.
 */
export function pageBy<T>(
  items: readonly T[],
  cap: number,
  tally: WithheldTally,
  field: Parameters<WithheldTally['add']>[0],
  protect: (item: T) => boolean,
): T[] {
  if (items.length <= cap) return [...items];
  const protectedCount = items.filter((item) => protect(item)).length;
  const room = Math.max(0, cap - protectedCount);
  const kept: T[] = [];
  let used = 0;
  for (const item of items) {
    if (protect(item)) {
      kept.push(item);
      continue;
    }
    if (used < room) {
      kept.push(item);
      used += 1;
      continue;
    }
    tally.add(field, 'PAGED');
  }
  return kept;
}
