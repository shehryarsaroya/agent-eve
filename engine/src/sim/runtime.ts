/**
 * The assembled world: one object that owns every table the API and the cast read.
 *
 * `src/tick/loop.ts` is deliberately content-free — "the tick loop never learns
 * what a venture is" — so *something* has to know how the world is wired. This is
 * that something, and it is in `src/sim/` rather than `src/api/` because the sim
 * runs headless in CI while the API is one of several front ends onto it.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **NO AGENT-REACHABLE INPUT MAY HALT THE WORLD.**
 *
 * A halt is for *our* bug. An agent that can halt the tick holds a denial of
 * settlement (AGT-X9), which is worse than a crash because it is a weapon.
 *
 * The ledger's mutators **throw** on an overdraft, by design: `transferCurrency`
 * raises `LedgerError` rather than returning a rejection, because inside a
 * settlement an overdraft is an engine bug. But a verb handler is not inside a
 * settlement — it is holding a stranger's JSON. So every ledger call reachable
 * from a verb is (a) preceded by an explicit affordability check that produces a
 * *rejection*, and (b) wrapped, so that if the check and the ledger ever disagree
 * the agent gets a hint and the world keeps running. Belt and braces, because the
 * failure mode of getting this wrong is not a wrong answer, it is an outage in
 * front of an audience.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * What lives here and why:
 *
 *   - **The venture book joins `state_hash`** through {@link ventureStateTable}.
 *     Its `restore` is absent and that is a *stated* gap, not an oversight: see the
 *     comment on that function. `engine.rollbackGaps` reports it and the sim prints
 *     it, so a halt is terminal in the sim rather than silently half-rolled-back.
 *   - **Talk, offers and claims are bounded ring buffers.** They are the only
 *     agent-writable text in Phase 0, and unbounded text written by strangers is
 *     scar #3 with a nicer name.
 *   - **The decision census** is what makes `GET /health` able to answer "are
 *     agents actually deciding?" rather than "is the process alive" (scar #14b).
 */

import { canonicalHash, type CanonicalValue } from '../core/canonical.js';
import { Rng } from '../core/rng.js';
import { TICKS_PER_RECKONING, reckoningIndex, ticksUntilReckoning } from '../core/time.js';
import type {
  DecisionSource,
  GoodId,
  HandId,
  PrincipalId,
  SystemId,
  VentureId,
} from '../core/types.js';
import { minor, type Bps, type Minor } from '../core/units.js';
import { EventLedger } from '../events/index.js';
import {
  CURRENCY_FAUCET,
  DEFAULT_VALUATION_RULE,
  Ledger,
  compareIds,
  escrowAccount,
  openStores,
  openVentureEscrow,
  storesAccount,
} from '../ledger/index.js';
import { SealBook, type SealRoleRef } from '../seal/index.js';
import {
  Engine,
  type ActionRequest,
  type PhaseContext,
  type TickReport,
  type VerbHandler,
} from '../tick/index.js';
import {
  allocateFills,
  activate,
  countersign,
  createVenture,
  electiveFloor,
  escrowRequired,
  isEscrowable,
  kindSpec,
  openIndices,
  pinnedAt,
  roleOfPrincipal,
  scaleByBps,
  shareTerms,
  vacateRole,
  VentureBook,
  VENTURE_KINDS,
  yourTakeAtP50,
  type FillRequest,
  type VentureRecord,
} from '../venture/index.js';
import type { RoleTerms, VentureKind } from '../core/types.js';
import {
  createWorld,
  enroll,
  handsOf,
  launchMap,
  reject,
  tierOf,
  type Enrolment,
  type WorldResult,
  type WorldState,
} from '../world/index.js';

/** The rules version every row this runtime writes is pinned to (INV-15). */
export const RULES_VERSION = 1;

/** The starter stake, in minor units. §12.5: "a bound starter stake". */
export const STARTER_STAKE = minor(250_000);

/** Ticks a formation window stays open by default. */
export const FORMATION_WINDOW_TICKS = 12;

/** Bound on every agent-written text buffer (INV-26, scar #3). */
export const MAX_TALK_ENTRIES = 512;
export const MAX_OFFER_ENTRIES = 256;
export const MAX_CLAIM_ENTRIES = 512;

/** §11.1: the public `reason` is hard-capped at 140 characters. */
export const MAX_REASON_LENGTH = 140;

/** §7.3: a message carries up to 480 characters of prose. */
export const MAX_MESSAGE_LENGTH = 480;

/** Ticks of decision history the health census keeps. Bounded, per scar #3. */
export const CENSUS_WINDOW_TICKS = TICKS_PER_RECKONING;

// ── Agent-written text, bounded ─────────────────────────────────────────────

export interface TalkEntry {
  readonly venture: VentureId;
  readonly from: PrincipalId;
  /** §7.3's typed acts. Lower case so it never reads as a canon term. */
  readonly act: 'offer' | 'counter' | 'accept' | 'decline' | 'assure';
  readonly text: string;
  readonly tick: number;
}

export interface OfferEntry {
  readonly by: PrincipalId;
  readonly text: string;
  readonly tick: number;
}

/**
 * A refusal that could only be known once the tick resolved.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **Why this buffer exists at all**, because it is the least obvious thing in this
 * file. `Engine.submit` gives an honest *submit-time* verdict — the Commons floor,
 * the verb table, the queue caps — but it does not run the verb handler, and it
 * must not: the handler mutates, and running it at submit would be an action
 * reacting to a within-tick decision (§15.2).
 *
 * So a `move` to a non-adjacent system is **accepted at submit and refused at
 * VALIDATE+LOCK**, one tick later. `agent.md` §7 promises the agent gets back "the
 * invariant you violated, what changed, the nearest legal thing you could do
 * instead" — and for this class of refusal there is nothing to give back yet when
 * the response is written.
 *
 * Dropping it is not an option: an agent whose action silently evaporated cannot
 * tell that from the world changing underneath it, which is PROP-O1's failure shape
 * applied to writes. So the refusal is held here, per principal, bounded, and
 * delivered on the agent's next read. It is a **hint, not an event** — it is never
 * appended to the ledger (scar #10).
 * ══════════════════════════════════════════════════════════════════════════
 */
export interface PendingCorrection {
  readonly tick: number;
  readonly verb: string;
  readonly clientSequence: number;
  readonly invariant: string;
  readonly hint: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** Corrections held per principal awaiting delivery. Bounded (INV-26, scar #3). */
export const MAX_PENDING_CORRECTIONS = 16;

export interface ClaimEntry {
  readonly by: PrincipalId;
  readonly text: string;
  /** True for `deny`, false for `claim`. One buffer, because both are just words. */
  readonly denial: boolean;
  readonly tick: number;
}

/** A bounded FIFO. Drops the oldest, and says how many it has dropped. */
class Ring<T> {
  private readonly items: T[] = [];
  private dropped = 0;

  constructor(private readonly cap: number) {}

  push(item: T): void {
    this.items.push(item);
    while (this.items.length > this.cap) {
      this.items.shift();
      this.dropped += 1;
    }
  }

  get all(): readonly T[] {
    return this.items;
  }

  get size(): number {
    return this.items.length;
  }

  get droppedCount(): number {
    return this.dropped;
  }
}

// ── The decision census (scar #14b) ─────────────────────────────────────────

/**
 * Who decided, over a rolling window of ticks.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **SCAR #14b.** High Water ran for hours looking perfectly healthy while its LLM
 * players had silently fallen back to heuristics. Every liveness probe was green.
 * The interesting property — *are agents actually deciding?* — was never measured,
 * so nobody could have noticed.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `decision_source` is a non-retrofittable event field for exactly this reason
 * (§15.1: "without which R3, R4 and the A4 audit are unmeasurable"). This class is
 * the projection that makes it answerable in one HTTP call.
 */
export class DecisionCensus {
  private readonly byTick = new Map<number, Map<DecisionSource, number>>();

  constructor(private readonly windowTicks: number = CENSUS_WINDOW_TICKS) {}

  record(tick: number, source: DecisionSource): void {
    const row = this.byTick.get(tick) ?? new Map<DecisionSource, number>();
    row.set(source, (row.get(source) ?? 0) + 1);
    this.byTick.set(tick, row);
    for (const t of [...this.byTick.keys()]) {
      if (t <= tick - this.windowTicks) this.byTick.delete(t);
    }
  }

  /** Totals over the window, in a fixed key order so the output is diffable. */
  distribution(): Readonly<Record<DecisionSource, number>> {
    const out: Record<DecisionSource, number> = {
      LIVE: 0,
      INTENT: 0,
      DELEGATE: 0,
      HEURISTIC: 0,
      FALLBACK: 0,
    };
    for (const row of this.byTick.values()) {
      for (const [source, n] of row) out[source] += n;
    }
    return out;
  }

  get total(): number {
    let n = 0;
    for (const value of Object.values(this.distribution())) n += value;
    return n;
  }

  /** Ticks retained. Asserted by the soak test: this is the boundedness claim. */
  get retainedTicks(): number {
    return this.byTick.size;
  }
}

// ── The venture state table ─────────────────────────────────────────────────

/**
 * The venture book, as a hashed state table.
 *
 * **`restore` is deliberately absent, and this is the reason.** Rebuilding a
 * `VentureRecord` from a canonical blob means re-authoring, in this file, the
 * shape that `src/venture/venture.ts` owns — a second constructor for the
 * keystone object, which is scar #5 (one quantity, two homes) applied to the
 * social object the whole design rests on. The two would drift the first time a
 * field was added, and the failure would present as a replay that reproduces a
 * *slightly different* world while every hash comparison it is checked by passes.
 *
 * So: capture, so ventures are inside `state_hash` and DET-1 is honest. No
 * restore, so `engine.rollbackGaps` names this table, the sim prints the gap, and
 * a halt is terminal rather than half-undone. The durable rollback is the
 * database snapshot, which is where §15.2 puts it anyway.
 */
export function ventureStateTable(book: VentureBook): { readonly name: string; capture(): CanonicalValue } {
  return {
    name: 'venture',
    capture(): CanonicalValue {
      return book
        .all()
        .map((v) => ({
          id: v.id,
          kind: v.kind,
          creator: v.creator,
          state: v.state,
          visibility: v.visibility,
          stage: v.stage,
          windowOpensTick: v.windowOpensTick,
          windowClosesTick: v.windowClosesTick,
          resolvesAtTick: v.resolvesAtTick,
          termsHash: v.termsHash,
          actedOnStateVersion: v.actedOnStateVersion,
          resolvedAtTick: v.resolvedAtTick,
          deferrals: v.deferrals,
          escrowExecutedAtTick: v.escrowExecutedAtTick,
          rulesVersion: v.rulesVersion,
          preference: [...v.preference],
          countersigned: [...v.countersigned].sort(compareIds),
          roles: v.roles.map((r) => ({
            index: r.index,
            label: r.label,
            wage: r.terms.wage,
            share: r.terms.share,
            escrowed: r.terms.escrowed,
            elective: r.terms.elective,
            filledByHandId: r.filledByHandId,
            filledByPrincipal: r.filledByPrincipal,
            filledAtTick: r.filledAtTick,
            settledEscrowedMinor: r.settledEscrowedMinor,
            settledElectiveMinor: r.settledElectiveMinor,
          })),
        }));
    },
  };
}

// ── Options ─────────────────────────────────────────────────────────────────

export interface RuntimeOptions {
  readonly seed: string;
  /** Seats. Bounded per SEC-7; the API's `SeatBook` holds the same number. */
  readonly startTick?: number;
  readonly actionsPerTick?: number;
  /**
   * Hazards on or off. Phase 0 has no hazard content yet, so this is recorded and
   * reported rather than acted on — and it is recorded so that the false-default
   * audit's two modes (§15.4) have a switch to read when the content lands.
   */
  readonly hazards?: boolean;
}

/** Default terms for a kind, derived from the kind's own template. */
export function defaultTerms(kind: VentureKind, value: Minor): readonly RoleTerms[] {
  const spec = kindSpec(kind);
  const out: RoleTerms[] = [];
  for (const role of spec.roles) {
    // A role's share of the residual is its marginal contribution to the yield:
    // one number, used both to price the slot and to divide the proceeds, so the
    // quote an agent is shown and the split it is paid come from one place.
    const share = role.marginalOutputBps;
    const consideration = scaleByBps(value, share);
    const priced = consideration > 0 ? consideration : minor(1);
    if (!isEscrowable(kind)) {
      out.push(shareTerms(share, minor(0), priced));
      continue;
    }
    const floor = electiveFloor(kind, priced);
    const elective = floor > priced ? priced : floor;
    out.push(shareTerms(share, minor(priced - elective), elective));
  }
  return out;
}

// ── The runtime ─────────────────────────────────────────────────────────────

export class Runtime {
  readonly world: WorldState;
  readonly ledger: Ledger;
  readonly events = new EventLedger();
  readonly ventures = new VentureBook();
  readonly seals = new SealBook();
  readonly engine: Engine;
  readonly census = new DecisionCensus();
  readonly hazards: boolean;

  /** Resolution-time refusals awaiting delivery, per principal. See the type's note. */
  private readonly pendingCorrections = new Map<PrincipalId, Ring<PendingCorrection>>();
  private readonly talk = new Ring<TalkEntry>(MAX_TALK_ENTRIES);
  private readonly offers = new Ring<OfferEntry>(MAX_OFFER_ENTRIES);
  private readonly claims = new Ring<ClaimEntry>(MAX_CLAIM_ENTRIES);

  /** Fill requests collected this tick, resolved once in VENTURES (PROP-V8). */
  private pendingFills: FillRequest[] = [];
  private ventureCounter = 0;

  constructor(options: RuntimeOptions) {
    this.world = createWorld(launchMap());
    this.ledger = new Ledger();
    this.hazards = options.hazards ?? false;

    this.engine = new Engine({
      world: this.world,
      seed: options.seed,
      ...(options.startTick === undefined ? {} : { startTick: options.startTick }),
      ...(options.actionsPerTick === undefined ? {} : { actionsPerTick: options.actionsPerTick }),
      tables: [ventureStateTable(this.ventures)],
      verbs: this.verbTable(),
      roleFills: () => this.ventures.roleFills(),
      handlers: {
        VENTURES: (ctx) => {
          this.resolveFills(ctx);
        },
      },
      assertions: [(tick) => this.ventures.checkVentureInvariants(tick)],
      invariantInputs: (tick) => ({
        ledger: this.ledger,
        presence: this.world,
        roleFills: this.ventures.roleFills(),
        events: this.events,
        eventScope: 'TICK',
        sealBook: this.seals,
        atReckoning: Math.floor(tick / TICKS_PER_RECKONING),
      }),
    });
  }

  // ── Enrolment ─────────────────────────────────────────────────────────────

  /**
   * Seat a principal: a Commons holding, three hands, a funded STORES account.
   *
   * §12.5's list, minus the parts that are the HTTP layer's job. The starter stake
   * is issued from the named faucet rather than transferred from nowhere, because
   * `INV-2` counts supply against a closed set of faucets and a stake that appears
   * without one is unaccounted currency.
   */
  seat(principal: PrincipalId, handle: string, seatAt?: SystemId): Enrolment {
    const tick = this.engine.tick + 1;
    const enrolment = enroll(this.world, principal, handle, tick, seatAt);
    openStores(this.ledger, principal);
    this.ledger.issueCurrency({
      eventId: `enrol:${principal}` as never,
      tick: Math.max(0, tick),
      faucet: CURRENCY_FAUCET.STARTER_STAKE,
      to: storesAccount(principal),
      amount: STARTER_STAKE,
    });
    return enrolment;
  }

  /** A Commons seat with the fewest holdings, or a named tier for the cast. */
  seatInTier(tier: 'COMMONS' | 'MARCHES' | 'FRONTIER', rng: Rng): SystemId | undefined {
    const candidates = [...this.world.map.systems.keys()]
      .filter((id) => tierOf(this.world.map, id) === tier)
      .sort(compareIds);
    if (candidates.length === 0) return undefined;
    return rng.pick(candidates);
  }

  // ── Reads the API needs ───────────────────────────────────────────────────

  talksFor(principal: PrincipalId): readonly TalkEntry[] {
    return this.talk.all.filter((t) => {
      const venture = this.ventures.get(t.venture);
      if (venture === undefined) return false;
      if (venture.creator === principal) return true;
      return venture.roles.some((r) => r.filledByPrincipal === principal);
    });
  }

  publishedOffers(): readonly OfferEntry[] {
    return this.offers.all;
  }

  publicClaims(): readonly ClaimEntry[] {
    return this.claims.all;
  }

  /**
   * Take this principal's undelivered corrections. **Draining, not peeking.**
   *
   * Draining on read is what makes the buffer bounded in practice as well as in
   * principle: a principal that never reads accumulates at most
   * {@link MAX_PENDING_CORRECTIONS}, and one that does read carries none.
   */
  takeCorrections(principal: PrincipalId): readonly PendingCorrection[] {
    const ring = this.pendingCorrections.get(principal);
    if (ring === undefined) return [];
    const out = [...ring.all];
    this.pendingCorrections.delete(principal);
    return out;
  }

  private holdCorrection(principal: PrincipalId, correction: PendingCorrection): void {
    const ring = this.pendingCorrections.get(principal) ?? new Ring<PendingCorrection>(MAX_PENDING_CORRECTIONS);
    ring.push(correction);
    this.pendingCorrections.set(principal, ring);
  }

  /** Every bounded buffer's size, for the soak test's no-unbounded-array claim. */
  bufferSizes(): Readonly<Record<string, number>> {
    return {
      talk: this.talk.size,
      offers: this.offers.size,
      claims: this.claims.size,
      pendingFills: this.pendingFills.length,
      censusTicks: this.census.retainedTicks,
      ventures: this.ventures.size,
      pendingCorrections: [...this.pendingCorrections.values()].reduce((n, r) => n + r.size, 0),
      pendingCorrectionPrincipals: this.pendingCorrections.size,
    };
  }

  /** Verbs this runtime actually implements. The API compares against the canon. */
  get liveVerbs(): ReadonlySet<string> {
    return new Set([...Object.keys(this.verbTable()), 'move', 'set_delivery_intent']);
  }

  // ── The tick ──────────────────────────────────────────────────────────────

  /**
   * Run one tick and fold the census.
   *
   * The census is read from the engine's own action log rather than from the API,
   * because an in-process cast never touches HTTP and a census that only counted
   * HTTP requests would report a world full of heuristics as having no decisions at
   * all — measuring the wrong thing in the same direction as the bug.
   */
  runTick(): TickReport {
    const report = this.engine.runTick();
    if (!report.halted) {
      for (const entry of this.engine.log.forTick(report.tick)) {
        this.census.record(report.tick, entry.decisionSource);
        if (entry.outcome === 'REFUSED' && entry.rejection !== null) {
          this.holdCorrection(entry.principal, {
            tick: report.tick,
            verb: entry.verb,
            clientSequence: entry.clientSequence,
            invariant: entry.rejection.invariant,
            hint: entry.rejection.hint,
            params: entry.params,
          });
        }
      }
    }
    // Fill requests never survive a tick: they are resolved in VENTURES or refused.
    this.pendingFills = [];
    return report;
  }

  // ── Verbs ─────────────────────────────────────────────────────────────────

  private verbTable(): Readonly<Record<string, VerbHandler>> {
    return {
      create: (ctx, req) => this.vCreate(ctx, req),
      fill_role: (ctx, req) => this.vFillRole(ctx, req),
      sign: (ctx, req) => this.vSign(ctx, req),
      withdraw: (ctx, req) => this.vWithdraw(ctx, req),
      abandon: (ctx, req) => this.vAbandon(ctx, req),
      publish_offer: (ctx, req) => this.vPublishOffer(ctx, req),
      message: (ctx, req) => this.vMessage(ctx, req),
      claim: (ctx, req) => this.vSay(ctx, req, false),
      deny: (ctx, req) => this.vSay(ctx, req, true),
      // ── `seal` IS DELIBERATELY NOT REGISTERED. Read this before adding it. ──
      //
      // It was registered, and the cast found the consequence in 288 ticks: INV-20
      // requires every seal made in a Reckoning to be resolved exactly once when that
      // Reckoning closes, and **nothing in this build resolves seals**. Seal resolution
      // belongs to the Reckoning driver — it needs the deeds to judge the intentions
      // against — so the first settlement tick after any agent sealed produced 60
      // HALT-severity violations and PAUSED the world.
      //
      // That is AGT-X9 exactly: an agent-reachable input that halts the tick is a
      // denial of settlement, and it is worse than a crash because it is a weapon. One
      // free `seal` from one principal would have taken the world down at tick 287.
      //
      // The tempting fix is to resolve seals here with no deeds. **It is the worst
      // available option**: with nothing to judge against, every seal resolves
      // CONTRADICTED or UNMARKED, and a fabricated CONTRADICTED is a permanent public
      // lie about a real agent — A5′, the one failure the design says is worse than a
      // crash. So the verb stays unregistered, the API tells agents it lands at step 14
      // (`VERB_ARRIVES_AT`), and `test/sim/runtime.test.ts` holds the regression.
      //
      // {@link vSeal} is kept, wired and correct, so that turning this on is one line
      // once the driver resolves seals at the settlement tick.
    };
  }

  /**
   * The seal handler, kept ready for the Reckoning driver.
   *
   * Not in {@link verbTable} — see the note there. Exposed so the wiring is one line
   * and so its role-scoping fix cannot be lost while it waits.
   */
  get sealHandler(): VerbHandler {
    return (ctx, req) => this.vSeal(ctx, req);
  }

  private vCreate(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const kind = readEnum(req.params, ['kind'], VENTURE_KINDS);
    if (kind === null) {
      return reject(
        'A2',
        `create needs a kind: {"kind": "HAUL"}. The kinds are ${VENTURE_KINDS.join(' · ')}.`,
      );
    }
    const stage = readString(req.params, ['stage', 'system', 'at']) as SystemId | null;
    const hands = handsOf(this.world, req.principal);
    const here = stage ?? hands[0]?.location;
    if (here === undefined || !this.world.map.systems.has(here)) {
      return reject(
        'A2',
        'create needs a stage — the system it happens in. Name one where you have a hand.',
      );
    }
    const value = readInt(req.params, ['value', 'value_minor']) ?? kindSpec(kind).baseYieldMinor;
    if (value <= 0 || value > 1_000_000_000) {
      return reject('PROP-V5', `value must be a positive amount under 1000000000, got ${String(value)}.`);
    }

    const opens = ctx.tick;
    const closes = opens + FORMATION_WINDOW_TICKS;
    const resolves = nextSettlementAtOrAfter(closes);
    const id = this.mintVentureId(ctx.tick, req.principal);

    const made = createVenture({
      id,
      kind,
      creator: req.principal,
      stage: here,
      terms: defaultTerms(kind, minor(value)),
      windowOpensTick: opens,
      windowClosesTick: closes,
      resolvesAtTick: resolves,
      valuation: pinnedAt(DEFAULT_VALUATION_RULE, ctx.tick),
      rulesVersion: RULES_VERSION,
    });
    if (!made.ok) return made;

    // A7: the escrowed half is locked **up front**, out of the creator's own free
    // balance. Checked here as a rejection so the ledger's throw is unreachable
    // from a request; wrapped below in case the two ever disagree.
    const required = escrowRequired(made.value);
    const stores = storesAccount(req.principal);
    if (this.ledger.account(stores) === undefined) {
      return reject('INV-1', 'you have no stores account; enroll before creating a venture.');
    }
    const free = this.ledger.freeBalance(stores);
    if (free < required) {
      return reject(
        'A7',
        `${kind} at value ${String(value)} needs ${String(required)} escrowed up front and your stores have ` +
          `${String(free)} free. Lower the value, or price more of it elective — the elective half is the ` +
          'only part standing can accrue to anyway.',
      );
    }
    try {
      openVentureEscrow(this.ledger, id, req.principal);
      if (required > 0) {
        this.ledger.transferCurrency({
          eventId: `escrow:${id}` as never,
          tick: ctx.tick,
          from: stores,
          to: escrowAccount(id, req.principal),
          amount: required,
        });
      }
    } catch (error: unknown) {
      // Never a halt from a request. The world is unchanged: the venture has not
      // been added to the book yet, and the escrow account is empty if it opened.
      return reject(
        'A7',
        `the escrow for ${id} could not be funded (${describeError(error)}). Nothing was created.`,
      );
    }

    this.ventures.add(made.value);
    ctx.emit({
      tick: ctx.tick,
      kind: 'venture.formed',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: id,
      parentEventId: null,
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: null,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource,
      payload: { venture: id, kind, stage: here, escrowed: required, termsHash: made.value.termsHash },
      visibility: 'PUBLIC',
      audience: [],
    });
    return { ok: true, value: null };
  }

  private vFillRole(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const ventureId = readString(req.params, ['venture', 'venture_id']) as VentureId | null;
    const roleIndex = readInt(req.params, ['role', 'role_index', 'roleIndex']);
    const handId = readString(req.params, ['hand', 'hand_id']) as HandId | null;
    if (ventureId === null || roleIndex === null || handId === null) {
      return reject(
        'A2',
        'fill_role needs {"venture": "<id>", "role": <index>, "hand": "<hand_id>"}. The open roles you are ' +
          'eligible for are in ventures.board[].',
      );
    }
    const venture = this.ventures.get(ventureId);
    if (venture === undefined) return reject('PROP-V6', `there is no venture ${ventureId}.`);
    const hand = this.world.hands.get(handId);
    if (hand === undefined) return reject('A2', `there is no hand ${handId}.`);
    if (hand.principal !== req.principal) {
      return reject('INV-9', `hand ${handId} is not yours. You fill a role with your own hand.`);
    }
    if (roleIndex < 0 || roleIndex >= venture.roles.length) {
      return reject('PROP-V6', `${ventureId} has roles 0..${String(venture.roles.length - 1)}.`);
    }
    if (this.pendingFills.length >= MAX_TALK_ENTRIES) {
      return reject('INV-26', 'the fill queue for this tick is full; try the next tick.');
    }
    // A request, not a grant (PROP-V8). Resolved once at VENTURES, from the set.
    this.pendingFills.push({
      venture: ventureId,
      roleIndex,
      principal: req.principal,
      hand: handId,
      clientSequence: this.pendingFills.length,
      stake: minor(readInt(req.params, ['stake', 'stake_minor']) ?? 0),
    });
    return { ok: true, value: null };
  }

  private vSign(_ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const ventureId = readString(req.params, ['venture', 'venture_id']) as VentureId | null;
    const hash = readString(req.params, ['terms_hash', 'termsHash']);
    if (ventureId === null || hash === null) {
      return reject(
        'PROP-W1',
        'sign needs {"venture": "<id>", "terms_hash": "<hash>"}. Nothing binds until both parties ' +
          'countersign the same terms_hash.',
      );
    }
    const venture = this.ventures.get(ventureId);
    if (venture === undefined) return reject('PROP-V6', `there is no venture ${ventureId}.`);
    const echoed = readInt(req.params, ['your_take_at_p50', 'take_at_p50']);
    const server = yourTakeAtP50(venture, req.principal);
    const signed = countersign(venture, req.principal, hash, minor(echoed ?? server), server);
    return signed.ok ? { ok: true, value: null } : signed;
  }

  private vWithdraw(_ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const ventureId = readString(req.params, ['venture', 'venture_id']) as VentureId | null;
    if (ventureId === null) return reject('A2', 'withdraw needs {"venture": "<id>"}.');
    const venture = this.ventures.get(ventureId);
    if (venture === undefined) return reject('PROP-V6', `there is no venture ${ventureId}.`);
    if (venture.state !== 'FORMING') {
      return reject(
        'PROP-V6',
        `${ventureId} is ${venture.state}. You may withdraw from a venture while it is FORMING; once it is ` +
          'LIVE the way out is to decline the elective part at settlement, and that is a default on the record.',
      );
    }
    const role = roleOfPrincipal(venture, req.principal);
    if (role === null) return reject('PROP-V6', `you hold no role in ${ventureId}.`);
    const freed = vacateRole(venture, role.index);
    if (freed !== null) {
      this.ventures.indexRelease(freed);
      const hand = this.world.hands.get(freed);
      if (hand !== undefined && hand.state === 'COMMITTED') hand.state = 'IDLE';
    }
    return { ok: true, value: null };
  }

  private vAbandon(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const ventureId = readString(req.params, ['venture', 'venture_id']) as VentureId | null;
    if (ventureId === null) return reject('A2', 'abandon needs {"venture": "<id>"}.');
    const venture = this.ventures.get(ventureId);
    if (venture === undefined) return reject('PROP-V6', `there is no venture ${ventureId}.`);
    if (venture.creator !== req.principal) {
      return reject('PROP-V6', `only ${venture.creator} can abandon ${ventureId}.`);
    }
    if (venture.state !== 'FORMING') {
      return reject('PROP-V6', `${ventureId} is ${venture.state}; only a FORMING venture can be abandoned.`);
    }
    for (const hand of this.ventures.resolve(ventureId, 'ABANDONED', ctx.tick)) {
      const record = this.world.hands.get(hand);
      if (record !== undefined && record.state === 'COMMITTED') record.state = 'IDLE';
    }
    // The escrow returns to the funder. Checked, wrapped, and never a halt.
    this.refundEscrow(ctx.tick, venture);
    return { ok: true, value: null };
  }

  private vPublishOffer(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const text = readString(req.params, ['text', 'offer', 'reason']);
    if (text === null || text.length > MAX_REASON_LENGTH) {
      return reject(
        'INV-26',
        `publish_offer needs {"text": "..."} of at most ${String(MAX_REASON_LENGTH)} characters — a price ` +
          'list, not an essay: HANDS FOR HIRE — 8% OF CARGO, NO DEEP RUNS.',
      );
    }
    this.offers.push({ by: req.principal, text, tick: ctx.tick });
    return { ok: true, value: null };
  }

  private vMessage(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const ventureId = readString(req.params, ['venture', 'venture_id']) as VentureId | null;
    const act = readEnum(req.params, ['act', 'type'], [
      'offer',
      'counter',
      'accept',
      'decline',
      'assure',
    ] as const);
    const text = readString(req.params, ['text', 'body']) ?? '';
    if (ventureId === null || act === null) {
      return reject(
        'A2',
        'message needs {"venture": "<id>", "act": "offer|counter|accept|decline|assure", "text": "..."}.',
      );
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      return reject('INV-26', `a message carries at most ${String(MAX_MESSAGE_LENGTH)} characters of text.`);
    }
    const venture = this.ventures.get(ventureId);
    if (venture === undefined) return reject('PROP-V6', `there is no venture ${ventureId}.`);
    this.talk.push({ venture: ventureId, from: req.principal, act, text, tick: ctx.tick });
    return { ok: true, value: null };
  }

  private vSay(ctx: PhaseContext, req: ActionRequest, denial: boolean): WorldResult<null> {
    const text = readString(req.params, ['text', 'reason', 'claim']);
    if (text === null || text.length > MAX_REASON_LENGTH) {
      return reject(
        'INV-26',
        `${denial ? 'deny' : 'claim'} carries at most ${String(MAX_REASON_LENGTH)} characters. It is public ` +
          'and permanent, and it is how anyone watching knows who you are.',
      );
    }
    this.claims.push({ by: req.principal, text, denial, tick: ctx.tick });
    return { ok: true, value: null };
  }

  private vSeal(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const verb = readString(req.params, ['verb', 'intent_verb']);
    const target = readString(req.params, ['target']);
    const measure = readEnum(req.params, ['measure'], ['MINOR', 'QTY', 'BPS'] as const);
    const low = readInt(req.params, ['outcome_low', 'outcomeLow']);
    const high = readInt(req.params, ['outcome_high', 'outcomeHigh']);
    if (verb === null || target === null || measure === null || low === null || high === null) {
      return reject(
        'PROP-D1',
        'seal needs a structured intention: {"verb": "...", "target": "...", "measure": "MINOR|QTY|BPS", ' +
          '"outcome_low": N, "outcome_high": N}. Prose never feeds the verdict.',
      );
    }
    const held = this.rolesHeldBy(req.principal);

    // ── The role this seal claims a free slot against ─────────────────────────
    //
    // Resolved from what the agent NAMED, never "the first role it happens to
    // hold". The first draft did the latter and it was a live defect the cast
    // found within 120 ticks: a principal holding two roles sealed its second, the
    // handler charged the slot of its *first*, the slot was already spent, so the
    // seal fell through to the paid path and was accepted — and the agent, whose
    // own free-slot arithmetic said a slot was available, tried again every tick
    // until it hit INV-26's cap. 311 refusals from a correct agent, caused
    // entirely by the engine and the affordance disagreeing about which role a
    // seal was for. One name, two meanings: scar #1's exact shape.
    const named = readString(req.params, ['role_venture', 'roleVenture']) ?? target;
    const namedIndex = readInt(req.params, ['role', 'role_index', 'roleIndex']);
    const matching =
      held.find((r) => r.venture === named && (namedIndex === null || r.roleIndex === namedIndex)) ?? null;
    // No named match: claim the first held role that still has its free slot, so a
    // mandatory seal is free even when the agent did not spell the role out.
    const unspent =
      matching ??
      held.find(
        (r) => this.seals.freeSlotsRemaining(req.principal, reckoningOf(ctx.tick), [r]) > 0,
      ) ??
      null;

    const committed = this.seals.commit({
      principal: req.principal,
      tick: ctx.tick,
      actedOnStateVersion: ctx.frozenStateVersion,
      stateVersion: ctx.frozenStateVersion,
      intent: { verb, target, measure, outcomeLow: low, outcomeHigh: high },
      prose: readString(req.params, ['prose']) ?? '',
      role: unspent,
      rolesHeld: held,
    });
    return committed.ok ? { ok: true, value: null } : committed;
  }

  /**
   * The roles this principal fills right now, read from the venture rows.
   *
   * Never cached and never mirrored: `venture_role.filled_by_hand_id` is the single
   * home of commitment (§6.2, INV-9), and a copy here would be scar #5 on the field
   * that decides what a seal costs.
   */
  private rolesHeldBy(principal: PrincipalId): SealRoleRef[] {
    const held: SealRoleRef[] = [];
    for (const venture of this.ventures.forPrincipal(principal)) {
      const role = roleOfPrincipal(venture, principal);
      if (role !== null) held.push({ venture: venture.id, roleIndex: role.index });
    }
    return held;
  }

  // ── VENTURES phase ────────────────────────────────────────────────────────

  /**
   * Resolve this tick's fill requests, then activate whatever is ready.
   *
   * Ordering matters and is not arrival: `allocateFills` sorts its own input and is
   * pure with respect to the order the requests were handed over (PROP-V8), so two
   * agents racing for one slot get the same answer whichever packet landed first.
   */
  private resolveFills(ctx: PhaseContext): void {
    if (this.pendingFills.length > 0) {
      ctx.step(this.pendingFills.length);
      allocateFills(this.ventures, this.pendingFills, {
        tick: ctx.tick,
        handOf: (id) => this.world.hands.get(id),
      });
      this.pendingFills = [];
    }
    for (const venture of this.ventures.live()) {
      ctx.step();
      if (venture.state !== 'FORMING') continue;
      if (openIndices(venture).length > 0) continue;
      const live = activate(venture, ctx.frozenStateVersion, ctx.tick);
      if (live.ok) {
        for (const party of venture.roles) {
          if (party.filledByPrincipal !== null) {
            ctx.offerWake(party.filledByPrincipal, 'VENTURE', venture.id);
          }
        }
      }
    }
  }

  private refundEscrow(tick: number, venture: VentureRecord): void {
    const account = escrowAccount(venture.id, venture.creator);
    if (this.ledger.account(account) === undefined) return;
    const held = this.ledger.freeBalance(account);
    if (held <= 0) return;
    try {
      this.ledger.transferCurrency({
        eventId: `escrow.return:${venture.id}:${String(tick)}` as never,
        tick,
        from: account,
        to: storesAccount(venture.creator),
        amount: held,
      });
    } catch {
      // Leaving value in an escrow account is a visible imbalance the ledger's own
      // invariants will report; throwing here would halt the world over a refund.
    }
  }

  /**
   * Venture ids are derived, never random and never a counter alone.
   *
   * Derived from `(tick, principal, ordinal)` so a replay of the same action log
   * mints the same id — a random id would make every downstream hash differ on a
   * replay that was otherwise identical.
   */
  private mintVentureId(tick: number, principal: PrincipalId): VentureId {
    this.ventureCounter += 1;
    const stamp = canonicalHash({ tick, principal, ordinal: this.ventureCounter }).slice(0, 8);
    return `v:${String(tick)}:${stamp}` as VentureId;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** The Reckoning a tick belongs to. One home, so the seal book and the API agree. */
export function reckoningOf(tick: number): number {
  return reckoningIndex(tick);
}

/** The settlement tick at or after `tick`. Settlement is the last tick of a day. */
export function nextSettlementAtOrAfter(tick: number): number {
  return tick + ticksUntilReckoning(tick) - 1;
}

function readString(params: Readonly<Record<string, unknown>>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function readInt(params: Readonly<Record<string, unknown>>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  }
  return null;
}

function readEnum<T extends string>(
  params: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  allowed: readonly T[],
): T | null {
  const raw = readString(params, keys);
  if (raw === null) return null;
  return allowed.includes(raw as T) ? (raw as T) : null;
}

/** An error's text, with nothing of the host in it. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message.split('\n')[0] ?? 'unknown';
  return 'unknown';
}

/** Re-exported so the API never has to reach into the ledger for a balance. */
export function freeStores(ledger: Ledger, principal: PrincipalId): Minor {
  const id = storesAccount(principal);
  return ledger.account(id) === undefined ? minor(0) : ledger.freeBalance(id);
}

export type { Bps, GoodId };
