/**
 * **The false-default audit, over the real Reckoning** (SPEC §15.4, `AX-A5′`).
 *
 * > Naively specified it cannot catch the bug it exists for: with hazards off it never
 * > exercises the raid-drains-the-account path, and with hazards on some defaults are
 * > legitimate so zero cannot be asserted. So it runs in two modes. **Mode A, hazards
 * > off:** an all-cooperative simulation must log **zero** defaults. **Mode B, hazards
 * > on:** every logged default must be *attributable* — each one carries the event ID of
 * > the loss or the missed delivery that caused it, and a default with no attributable
 * > cause is top-severity, because it is the game accusing an innocent agent.
 *
 * ## Why this exists next to `src/invariants/audit.ts`
 *
 * That file is the same two modes over a **reference model**, and it says so at length:
 *
 * > There is no venture module yet, so the settlement here is a **reference model** ...
 * > When the venture module lands, the two `settle` passes below must be replaced by
 * > calls into it ... Until then the audit proves the *plumbing*, not the real waterfall.
 *
 * The venture module has landed and so has the driver, so this is that audit run against
 * the real thing: real `computeClaims`, real escrow, real cascade, real seals, real
 * `DefaultRegister`, real freeze arithmetic, real `runReckoning` transaction, real
 * aggregate ASSERT. Two audits over two implementations is not duplication — the
 * reference one proves the invariants can fire at all, this one proves the engine that
 * will actually publish the record does not fire them. The names are deliberately
 * different (`runReckoningAudit`, `verifyNoInventedDefault`,
 * `verifyEveryDefaultAttributable`) so no call site can mean one and get the other.
 *
 * ## The world it builds, and why every part of it is load-bearing
 *
 * Two creators, two role-holders, one world raider, `HAUL`s with two **wage** roles.
 *
 *   - **Creators are never payees.** A creator that is also a role-holder somewhere else
 *     is refilled by its own counterparty's settlement in the same batch, and then no
 *     raid can ever produce a default: the audit reports zero and reads exactly like a
 *     clean bill of health. `src/invariants/audit.ts` learned this twice and wrote both
 *     lessons down.
 *   - **The raider is outside the promise graph.** A raider that is also a counterparty
 *     is draining an account it is about to be paid from.
 *   - **Wage roles, not share roles.** A `share` claim is a slice of the proceeds, so a
 *     venture whose cargo was destroyed owes its share-holders *nothing* and cannot
 *     default at all — correct, and useless for this audit. A `wage` is a senior fixed
 *     claim that survives the loss of the cargo, which is exactly the promise a raid can
 *     break.
 *   - **The raid drains the escrow *and* the payer's stores.** Draining only the stores
 *     proves nothing: the escrow returns the unearned proceeds to the creator at
 *     settlement, which would refund it enough to pay. §15.4's sentence is "my convoy is
 *     raided and X is drained", and both accounts are X.
 *
 * The escrow shortfall that results is a **recorded loss and never a default** (§10.2,
 * PROP-L3); the unpaid *elective* half is a default, and its attributable cause is the
 * raid. Both come out of the same settlement, which is why E2E-2's distinction is
 * asserted here as well as in the venture module.
 */

import { Rng } from '../core/rng.js';
import { canonicalHash } from '../core/canonical.js';
import { FREEZE_TICKS, TICKS_PER_RECKONING, inFreeze, isSettlementTick } from '../core/time.js';
import type { EventId, InvariantViolation, PrincipalId, SystemId, VentureId } from '../core/types.js';
import { minor, type Minor } from '../core/units.js';
import { EventLedger, type NewEvent } from '../events/index.js';
import {
  CURRENCY_FAUCET,
  DEFAULT_VALUATION_RULE,
  Ledger,
  SimpleObligationBook,
  escrowAccount,
  openStores,
  openVentureEscrow,
  storesAccount,
} from '../ledger/index.js';
import {
  DefaultRegister,
  HaltController,
  freezeTriple,
  halting,
  type DefaultAttribution,
  type TickInputs,
} from '../invariants/index.js';
import { SealBook, sealWorldIndex, type Deed } from '../seal/index.js';
import {
  IN_FULL,
  VentureBook,
  activate,
  countersign,
  createVenture,
  fillRole,
  pinnedAt,
  signatoriesRequired,
  wageTerms,
  yourTakeAtP50,
  type VentureRecord,
} from '../venture/index.js';
import {
  commitHand,
  commonsSystems,
  createWorld,
  enroll,
  handsOf,
  launchMap,
  type HandRecord,
  type WorldState,
} from '../world/index.js';
import { runReckoningBatch, type ReckoningOutcome, type ReckoningWorld } from './driver.js';
import { freezeReckoning, type ObligationPlan } from './set.js';
import { StandingBook } from './standing.js';

/** The rules version every row in the audit pins (INV-15). */
const RULES_VERSION = 1;
/** What each creator is topped up to at the start of every Reckoning. */
const STORES_TARGET = 4_000;
/** A7's two halves, per role. Both roles are wages, so the claim survives a lost cargo. */
const ESCROWED_PART = 100;
const ELECTIVE_PART = 1_000;
/**
 * What a delivered venture realises. Issued from the civic-procurement faucet (§10.1).
 *
 * **Smaller than the elective total on purpose.** Phase 1 returns everything left in the
 * escrow to the creator *before* the elective parts are paid, so a payer whose stores were
 * drained is refunded the proceeds and can pay anyway if the proceeds are large enough.
 * With `2 x ELECTIVE_PART = 2000` against an escrow return of 1200, a drain genuinely
 * costs the payer its ability to pay — which is the only configuration in which E2E-12's
 * mutation can fabricate a default at all. The first version of this file had the
 * inequality the other way round and the mutation silently proved nothing.
 */
const PROCEEDS = 1_200;
/** The tick within a Reckoning at which hazards fire. Well before the freeze. */
const HAZARD_PHASE = 100;
/** Ventures per Reckoning. Two, so one can be raided and one cannot. */
const VENTURES_PER_RECKONING = 2;
/** How often a *further* venture is raided. The draw is what makes the seed matter. */
const RAID_ODDS_NUMERATOR = 2;
const RAID_ODDS_DENOMINATOR = 3;

const CREATORS = ['p-payer-a', 'p-payer-b'] as PrincipalId[];
const HOLDERS = ['p-hand-a', 'p-hand-b'] as PrincipalId[];
/** Never a promisor and never a promisee. See the module header. */
const RAIDER = 'p-world-raider' as PrincipalId;

export interface ReckoningAuditOptions {
  readonly seed: string;
  /** §15.4's Mode A is `false`; Mode B is `true`. */
  readonly hazards: boolean;
  readonly reckonings?: number;
  /**
   * ⚠ Run with §15.3's input-hash assertion off **and** a rival draining a committed
   * account inside the freeze. E2E-12's second half: the proof that the audit can detect
   * the bug it exists for.
   */
  readonly disableFreeze?: true;
}

export interface ReckoningAuditResult {
  readonly hazards: boolean;
  readonly reckonings: number;
  readonly ventures: number;
  readonly settled: number;
  readonly deferred: number;
  /** Raids that fired. Mode B proves nothing without at least one. */
  readonly raids: number;
  /** Value destroyed on the guaranteed half. **Never** a default (§10.2, PROP-L3). */
  readonly recordedLoss: Minor;
  readonly defaults: readonly DefaultAttribution[];
  readonly outcomes: readonly ReckoningOutcome[];
  readonly violations: readonly InvariantViolation[];
  /** Per-Reckoning `state_hash`. Two runs of the same seed must match (DET-1). */
  readonly stateHashes: readonly string[];
  /** Reckonings whose transaction did not commit, with the stage that failed. */
  readonly uncommitted: readonly string[];
  readonly world: ReckoningWorld;
}

export interface ReckoningAuditVerdict {
  readonly ok: boolean;
  readonly failures: readonly string[];
}

/**
 * Run the audit. Deterministic in `seed` and nothing else: no clock, no unseeded draw.
 */
export function runReckoningAudit(options: ReckoningAuditOptions): ReckoningAuditResult {
  const reckonings = options.reckonings ?? 2;
  const rng = Rng.fromSeed(options.seed).derive('reckoning-audit');

  const map = launchMap();
  const world = createWorld(map);
  const stage = commonsSystems(map)[0];
  if (stage === undefined) throw new Error('the launch map has no Commons system');

  const ledger = new Ledger();
  const events = new EventLedger();
  const register = new DefaultRegister();
  const obligations = new SimpleObligationBook();
  const standing = new StandingBook();
  const book = new VentureBook();

  for (const principal of [...CREATORS, ...HOLDERS]) {
    enroll(world, principal, `holding::${principal}`, 0, stage);
    openStores(ledger, principal);
    standing.open(principal);
  }
  openStores(ledger, RAIDER);

  // The seal book asks the world before accepting a seal, so a formatting slip costs one
  // action and a hint instead of a permanent public mark (scar #8).
  const seals = new SealBook(
    sealWorldIndex(
      [...CREATORS, ...HOLDERS, stage, ...ventureIdsFor(reckonings)],
      (verb) => (verb === 'haul' ? 'MINOR' : null),
    ),
  );

  const reckoningWorld: ReckoningWorld = {
    ledger,
    book,
    events,
    register,
    seals,
    standing,
    obligations,
    accounts: {
      escrowOf: (venture) => escrowAccount(venture.id, venture.creator),
      storesOf: (principal) => storesAccount(principal),
    },
    presence: world,
  };

  const controller = new HaltController({
    startTick: -1,
    startStateHash: canonicalHash({ world: 'audit:start' }),
    resumeKeys: new Map(),
  });

  const outcomes: ReckoningOutcome[] = [];
  const violations: InvariantViolation[] = [];
  const stateHashes: string[] = [];
  const uncommitted: string[] = [];
  let ventures = 0;
  let settled = 0;
  let deferred = 0;
  let raids = 0;
  let recordedLoss = 0;
  let version = 0;
  const bump = (): number => {
    version += 1;
    return version;
  };

  for (let r = 0; r < reckonings; r += 1) {
    const base = r * TICKS_PER_RECKONING;
    const formTick = base + 1;
    const hazardTick = base + HAZARD_PHASE;
    const settleTick = base + TICKS_PER_RECKONING - 1;
    /**
     * Where the settlement set is computed. **One tick before the settlement**, because
     * SPEC §5.1 puts the freeze at "the last tick *before* settlement" and INV-18 ranges
     * over the interval between the two. Derived from `FREEZE_TICKS` rather than written
     * as `- 1`, so a wider freeze moves the audit with it.
     */
    const freezeTick = settleTick - FREEZE_TICKS;
    if (!isSettlementTick(settleTick)) {
      throw new Error(`the audit computed ${settleTick} as a settlement tick and core/time disagrees`);
    }
    if (!inFreeze(freezeTick)) {
      throw new Error(`the audit computed ${freezeTick} as a freeze tick and core/time disagrees`);
    }

    for (const creator of CREATORS) topUp(ledger, events, creator, formTick);

    const plans: ObligationPlan[] = [];
    const deeds: Deed[] = [];
    /**
     * The deed producer's own running count, kept **as each row is appended**.
     *
     * Not `deeds.filter(...).length`: `src/seal/book.ts` rewrote `allDeedsWitness` so it
     * cannot see the deed array, precisely because a count derived from the rows makes
     * the resolver's reconciliation a tautology — and a tautology there is the §15.4
     * false-mark route with a witness bolted on. Holders are tallied at zero below, so
     * their abstention is witnessed rather than unanswered.
     */
    const tally = new Map<PrincipalId, number>();
    for (const holder of HOLDERS) tally.set(holder, 0);
    // Which ventures the hazard will hit, decided here and applied at `hazardTick`. The
    // event ledger's watermark only moves forward, so every append has to happen in tick
    // order — which means the three phases below are ordered by *tick* and not by
    // venture. Interleaving them appended at `formTick` after a raid at `hazardTick` and
    // the ledger correctly refused it.
    const raided = new Map<VentureId, boolean>();

    // ── formTick: open, fund, seal, and realise the proceeds of what will survive ──
    for (let i = 0; i < VENTURES_PER_RECKONING; i += 1) {
      const creator = CREATORS[i % CREATORS.length];
      if (creator === undefined) continue;
      const id = ventureId(r, i);
      openHaul({ book, world, ledger, events, obligations, id, creator, stage, formTick, bump });
      ventures += 1;

      // A seal per creator per Reckoning, so the SEALS stage is exercised and the
      // `reckoning_id` stamp is real rather than assumed. `role: null` — a creator holds
      // no role here, so this is a seal it paid an action for.
      const sealed = seals.commit({
        principal: creator,
        tick: formTick,
        actedOnStateVersion: version,
        stateVersion: version,
        intent: {
          verb: 'haul',
          target: id,
          measure: 'MINOR',
          // The band a delivered venture lands in. A raided one lands at 0 and the seal
          // is contradicted, which is the say-do gap doing its job rather than a fault.
          outcomeLow: options.hazards ? 1 : 0,
          outcomeHigh: PROCEEDS,
        },
        prose: 'the load goes through',
        role: null,
        rolesHeld: [],
      });
      if (!sealed.ok) throw new Error(`audit seal: ${sealed.invariant} ${sealed.hint}`);

      // The first venture of every Reckoning is raided unconditionally when hazards are
      // on, and the rest are drawn. The unconditional one is what makes Mode B's
      // assertion non-vacuous — "a run where no hazard fired has not exercised the
      // raid-drains-the-account path" — and the draw is what makes the seed matter.
      const hit =
        options.hazards && (i === 0 || rng.chance(RAID_ODDS_NUMERATOR, RAID_ODDS_DENOMINATOR));
      raided.set(id, hit);

      if (!hit) {
        // The venture delivered, so its proceeds arrive in the pot. A raided one realises
        // nothing at all: the cargo is what was lost.
        ledger.issueCurrency({
          eventId: appendPublic(events, {
            tick: formTick,
            kind: 'venture.proceeds_realised',
            actor: creator,
            payload: { venture: id, amountMinor: PROCEEDS },
          }),
          tick: formTick,
          faucet: CURRENCY_FAUCET.CIVIC_PROCUREMENT,
          to: escrowAccount(id, creator),
          amount: minor(PROCEEDS),
        });
      }
    }

    // ── formTick + 1: the deeds the seals are judged against ──────────────────
    for (let i = 0; i < VENTURES_PER_RECKONING; i += 1) {
      const creator = CREATORS[i % CREATORS.length];
      if (creator === undefined) continue;
      const id = ventureId(r, i);
      const delivered = raided.get(id) === true ? 0 : PROCEEDS;
      // Strictly after the seal, in the same Reckoning, measured at a version the
      // settlement can see (judge's rules 2, 3 and 4).
      deeds.push({
        principal: creator,
        tick: formTick + 1,
        verb: 'haul',
        target: id,
        measure: 'MINOR',
        outcome: delivered,
        valuedAtStateVersion: bump(),
        eventId: appendPublic(events, {
          tick: formTick + 1,
          kind: 'venture.delivery',
          actor: creator,
          payload: { venture: id, deliveredMinor: delivered },
        }),
      });
      tally.set(creator, (tally.get(creator) ?? 0) + 1);
    }

    // ── hazardTick: the raids, well before the freeze ─────────────────────────
    for (let i = 0; i < VENTURES_PER_RECKONING; i += 1) {
      const creator = CREATORS[i % CREATORS.length];
      if (creator === undefined) continue;
      const id = ventureId(r, i);
      const hit = raided.get(id) === true;
      const causeEventId: EventId | null = hit
        ? raid(ledger, events, { venture: id, creator, tick: hazardTick })
        : null;
      if (hit) raids += 1;
      plans.push({
        venture: id,
        outcome: hit ? 'CARGO_LOST' : 'FULFILLED',
        proceeds: minor(hit ? 0 : PROCEEDS),
        // Every elective part elected IN_FULL. An all-cooperative world: nobody here ever
        // declines, so every default this audit logs is a *funding* failure and Mode A's
        // zero is a claim about the engine and not about the agents.
        elections: new Map([
          [0, IN_FULL],
          [1, IN_FULL],
        ]),
        causeEventId,
      });
    }

    // ── the freeze, one tick before the settlement ─────────────────────────────
    //
    // `freezeReckoning` derives `settlementTick = freezeTick + FREEZE_TICKS` and reads the
    // due set at *that* tick, so the set is still exactly the ventures resolving tonight.
    // This used to be called with `settleTick`, which was satisfiable only while
    // `core/time.ts` had `inFreeze` and `isSettlementTick` both true at phase 287 — the
    // collision that made INV-18's interval empty.
    const frozen = freezeReckoning({
      tick: freezeTick,
      stateVersion: bump(),
      ledger,
      book,
      accounts: reckoningWorld.accounts,
      plans,
    });

    // E2E-12's mutation: a rival drains the payer's account *after* the freeze, at the
    // settlement tick — which is now a genuinely later tick than the freeze, so the drain
    // lands inside the interval INV-18 protects rather than merely at a higher seq.
    //
    // The **stores only**, not the escrow. §15.4's sentence is "I commit to pay from
    // account X; during the window my convoy is raided and X is drained", and X is the
    // account the elective half is paid from. Draining the escrow as well would trip
    // `payEscrowedParts`' own guard — a short escrow on a delivered venture is an
    // unfunded signature and halts — so the run would stop at a *different* defence and
    // the mutation would prove nothing about the fabricated default.
    if (options.disableFreeze === true) {
      const victim = plans[0];
      if (victim !== undefined) {
        const creator = book.require(victim.venture).creator;
        drainPayerStores(ledger, events, { venture: victim.venture, creator, tick: settleTick });
      }
    }

    const outcome = runReckoningBatch({
      world: reckoningWorld,
      frozen,
      rulesVersion: RULES_VERSION,
      controller,
      inputs: tickInputs(settleTick, options.seed),
      deeds,
      deedTally: [...tally.entries()],
      ...(options.disableFreeze === true ? { disableFreeze: true as const } : {}),
    });

    outcomes.push(outcome);
    violations.push(...(outcome.report?.violations ?? []));
    stateHashes.push(ledger.stateHash());
    if (!outcome.transaction.committed) {
      uncommitted.push(
        `Reckoning ${r} did not commit (failed at ${String(outcome.transaction.failedAt)}): ` +
          (outcome.transaction.haltRecord?.reason ?? 'no halt record'),
      );
    }
    for (const s of outcome.settlements) {
      if (s.terminalState === 'DEFERRED') deferred += 1;
      else if (s.terminalState === 'SETTLED') settled += 1;
      recordedLoss += s.recordedLoss;
    }
  }

  return {
    hazards: options.hazards,
    reckonings,
    ventures,
    settled,
    deferred,
    raids,
    recordedLoss: minor(recordedLoss),
    defaults: register.all(),
    outcomes,
    violations,
    stateHashes,
    uncommitted,
    world: reckoningWorld,
  };
}

/**
 * §15.4's **Mode A** — hazards off, an all-cooperative simulation logs **zero** defaults.
 *
 * Nothing goes wrong in that world: every escrow is funded, every venture delivers, every
 * elective part is elected `IN_FULL`, and every payer can afford it. A default here is
 * the engine inventing one, which is the A5′ failure.
 */
export function verifyNoInventedDefault(result: ReckoningAuditResult): ReckoningAuditVerdict {
  const failures: string[] = [];
  if (result.hazards) failures.push('Mode A must run with hazards off');
  if (result.defaults.length > 0) {
    failures.push(
      `Mode A logged ${result.defaults.length} default(s) in an all-cooperative world: ` +
        result.defaults.map((d) => `${d.defaultEventId} against ${d.promisor}`).join(', ') +
        '. Every one of these is the engine accusing an innocent agent',
    );
  }
  if (result.recordedLoss > 0) {
    failures.push(`Mode A recorded ${result.recordedLoss} of loss with no hazard to cause it`);
  }
  failures.push(...sharedFailures(result));
  if (result.settled === 0) {
    // A run that settled nothing satisfies "zero defaults" trivially.
    failures.push('Mode A settled zero ventures, so its zero-defaults result is vacuous');
  }
  if (result.settled !== result.ventures) {
    failures.push(
      `Mode A settled ${result.settled} of ${result.ventures} ventures; in a world where nothing goes ` +
        'wrong every one of them settles',
    );
  }
  return { ok: failures.length === 0, failures };
}

/**
 * §15.4's **Mode B** — hazards on, every logged default carries the event id that caused
 * it.
 *
 * Zero is not assertable here: a raid really did drain the account and the promise really
 * was broken. What must hold is that the record can point at *why*, for every single one,
 * with a row an auditor can open.
 */
export function verifyEveryDefaultAttributable(
  result: ReckoningAuditResult,
): ReckoningAuditVerdict {
  const failures: string[] = [];
  if (!result.hazards) failures.push('Mode B must run with hazards on');
  if (result.raids === 0) {
    failures.push('Mode B fired zero raids, so it never exercised the drained-account path');
  }
  if (result.defaults.length === 0) {
    // Mode B's clause is "every default is attributable", which is vacuously true over
    // zero defaults — and `src/invariants/audit.ts` passed exactly that way for a full
    // run once, because every drained account was refilled before its elective part was
    // evaluated. If the model stops producing defaults, that is the finding.
    failures.push(
      `Mode B fired ${result.raids} raid(s) and logged zero defaults, so its attribution clause is ` +
        'vacuous. Either the world no longer reaches the default branch, or losses are being absorbed',
    );
  }
  if (result.recordedLoss === 0) {
    failures.push(
      'Mode B recorded no loss on the guaranteed half, so E2E-2’s distinction between a destroyed ' +
        'escrow and a broken promise was never exercised',
    );
  }

  for (const d of result.defaults) {
    if (d.causeEventId.length === 0) {
      failures.push(`default ${d.defaultEventId} carries no cause event id`);
      continue;
    }
    // The column, not the payload. INV-17: the evidence has to be joinable by an
    // auditor who does not have our code.
    const row = result.world.events.get(d.defaultEventId);
    if (row === null) {
      failures.push(`default ${d.defaultEventId} is attributed but is not in the record`);
      continue;
    }
    if (row.event.parentEventId !== d.causeEventId) {
      failures.push(
        `default ${d.defaultEventId} names parent ${String(row.event.parentEventId)} but is attributed ` +
          `to ${d.causeEventId}`,
      );
    }
    const cause = result.world.events.get(d.causeEventId);
    if (cause === null) {
      failures.push(`default ${d.defaultEventId} cites cause ${d.causeEventId}, which is not in the record`);
      continue;
    }
    if (
      cause.event.tick > row.event.tick ||
      (cause.event.tick === row.event.tick && cause.event.seqInTick >= row.event.seqInTick)
    ) {
      failures.push(`default ${d.defaultEventId} cites a cause that does not precede it`);
    }
  }
  failures.push(...sharedFailures(result));
  return { ok: failures.length === 0, failures };
}

/** What both modes assert: the world stayed up and broke nothing. */
function sharedFailures(result: ReckoningAuditResult): readonly string[] {
  const out: string[] = [...result.uncommitted];
  for (const v of halting(result.violations)) out.push(`${v.id} at tick ${v.tick}: ${v.message}`);
  for (const outcome of result.outcomes) {
    // "A healthy Reckoning defers **nothing**, so anything here is an operator's alarm
    // that the resolver is being called without its witnesses." Asserted, because a
    // resolver whose witnesses stopped arriving would silently stop marking anybody and
    // the audit would read as clean.
    for (const fault of outcome.deedSetFaults) {
      out.push(`Reckoning ${outcome.reckoning}: the deed set does not reconcile — ${fault}`);
    }
    for (const deferral of outcome.seals?.deferred ?? []) {
      out.push(
        `Reckoning ${outcome.reckoning}: seal ${deferral.sealId} closed with no mark ` +
          `(${deferral.basis}); a witnessed Reckoning marks every seal it holds`,
      );
    }
    for (const bypassed of outcome.bypassedFreezeFaults) {
      out.push(`Reckoning ${outcome.reckoning}: the freeze was bypassed — ${bypassed}`);
    }
  }
  return out;
}

// ── the world's moving parts ────────────────────────────────────────────────

function ventureId(reckoning: number, index: number): VentureId {
  return `v::r${String(reckoning)}::${String(index)}` as VentureId;
}

function ventureIdsFor(reckonings: number): readonly VentureId[] {
  const out: VentureId[] = [];
  for (let r = 0; r < reckonings; r += 1) {
    for (let i = 0; i < VENTURES_PER_RECKONING; i += 1) out.push(ventureId(r, i));
  }
  return out;
}

function tickInputs(tick: number, seed: string): TickInputs {
  return freezeTriple({
    tick,
    snapshot: { tick: tick - 1 },
    actionLog: [],
    seed: `${seed}::${String(tick)}`,
  });
}

interface Draft {
  readonly tick: number;
  readonly kind: string;
  readonly actor: PrincipalId;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Every event the audit writes is PUBLIC: A9 parity is the default. */
function appendPublic(events: EventLedger, draft: Draft): EventId {
  const event: NewEvent = {
    tick: draft.tick,
    kind: draft.kind,
    rulesVersion: RULES_VERSION,
    actorPrincipalId: draft.actor,
    onBehalfOfPrincipalId: null,
    grantId: null,
    eventFamilyId: `audit::${draft.kind}`,
    parentEventId: null,
    isPublic: true,
    publicAt: draft.tick,
    declassifyAt: draft.tick,
    provenanceClass: 'FACT',
    actedOnStateVersion: null,
    decisionSource: 'HEURISTIC',
    payload: draft.payload,
    visibility: 'PUBLIC',
    audience: [],
  };
  return events.append(event).event.id;
}

function topUp(ledger: Ledger, events: EventLedger, principal: PrincipalId, tick: number): void {
  const shortfall = STORES_TARGET - ledger.balance(storesAccount(principal));
  if (shortfall <= 0) return;
  ledger.issueCurrency({
    eventId: appendPublic(events, {
      tick,
      kind: 'stores.funded',
      actor: principal,
      payload: { account: storesAccount(principal), amountMinor: shortfall },
    }),
    tick,
    faucet: CURRENCY_FAUCET.STARTER_STAKE,
    to: storesAccount(principal),
    amount: minor(shortfall),
  });
}

/** A `HAUL` with two wage roles, taken all the way to LIVE and funded. */
function openHaul(args: {
  readonly book: VentureBook;
  readonly world: WorldState;
  readonly ledger: Ledger;
  readonly events: EventLedger;
  readonly obligations: SimpleObligationBook;
  readonly id: VentureId;
  readonly creator: PrincipalId;
  readonly stage: SystemId;
  readonly formTick: number;
  readonly bump: () => number;
}): VentureRecord {
  const terms = wageTerms(minor(ESCROWED_PART), minor(ELECTIVE_PART));
  const created = createVenture({
    id: args.id,
    kind: 'HAUL',
    creator: args.creator,
    stage: args.stage,
    terms: [terms, terms],
    windowOpensTick: args.formTick,
    windowClosesTick: args.formTick + 4,
    // Due at this Reckoning's settlement, which is what puts it in `settlementSet`.
    resolvesAtTick: args.formTick - 1 + TICKS_PER_RECKONING - 1,
    valuation: pinnedAt(DEFAULT_VALUATION_RULE, args.formTick),
    rulesVersion: RULES_VERSION,
    visibility: 'PUBLIC',
    preference: [],
  });
  if (!created.ok) throw new Error(`audit createVenture: ${created.invariant} ${created.hint}`);
  const venture = args.book.add(created.value);

  for (const [index, holder] of HOLDERS.entries()) {
    const hand = freeHand(args.book, args.world, holder);
    const filled = fillRole(venture, index, hand, args.formTick);
    if (!filled.ok) throw new Error(`audit fillRole: ${filled.invariant} ${filled.hint}`);
    args.book.indexFill(venture.id, index, hand.id);
    const committed = commitHand(hand);
    if (!committed.ok) throw new Error(`audit commitHand: ${committed.invariant} ${committed.hint}`);
  }

  const hash = venture.termsHash;
  if (hash === null) throw new Error('audit venture has no terms_hash');
  for (const principal of signatoriesRequired(venture)) {
    const take = yourTakeAtP50(venture, principal);
    const signed = countersign(venture, principal, hash, take, take);
    if (!signed.ok) throw new Error(`audit countersign: ${signed.invariant} ${signed.hint}`);
  }

  openVentureEscrow(args.ledger, venture.id, venture.creator);
  args.ledger.transferCurrency({
    eventId: appendPublic(args.events, {
      tick: args.formTick,
      kind: 'venture.escrow_funded',
      actor: venture.creator,
      payload: { venture: venture.id, amountMinor: ESCROWED_PART * venture.roles.length },
    }),
    tick: args.formTick,
    from: storesAccount(venture.creator),
    to: escrowAccount(venture.id, venture.creator),
    amount: minor(ESCROWED_PART * venture.roles.length),
  });

  const live = activate(venture, args.bump(), args.formTick);
  if (!live.ok) throw new Error(`audit activate: ${live.invariant} ${live.hint}`);
  // §7.3: a live venture is an open obligation, so INV-4 has something for its locks to
  // point at. `requiresEncumbrance: false` because the audit does not lock fill stakes —
  // that is the allocation path's job — and a secured obligation with no lock is itself
  // an INV-4 fault.
  args.obligations.open(venture.id, false);
  return venture;
}

function freeHand(book: VentureBook, world: WorldState, principal: PrincipalId): HandRecord {
  for (const hand of handsOf(world, principal)) {
    if (book.commitmentOf(hand.id) === null) return hand;
  }
  throw new Error(`${principal} has no uncommitted hand left`);
}

/**
 * A raid drains a committed account.
 *
 * `seizeCurrency` is the right door and the only one: it takes *locked* value too,
 * because an encumbrance is a claim on a thing and never a shield over it (PROP-L3).
 * Both the escrow and the payer's stores are drained — see the module header on why
 * draining only one of them proves nothing.
 */
function raid(
  ledger: Ledger,
  events: EventLedger,
  args: { readonly venture: VentureId; readonly creator: PrincipalId; readonly tick: number },
): EventId {
  const escrow = escrowAccount(args.venture, args.creator);
  const stores = storesAccount(args.creator);
  const take = minor(
    (ledger.account(escrow) === undefined ? 0 : ledger.balance(escrow)) + ledger.balance(stores),
  );
  const eventId = appendPublic(events, {
    tick: args.tick,
    kind: 'raid.struck',
    actor: RAIDER,
    payload: { venture: args.venture, escrow, target: stores, takeMinor: take },
  });
  const fromEscrow = ledger.account(escrow) === undefined ? minor(0) : ledger.balance(escrow);
  if (fromEscrow > 0) {
    ledger.seizeCurrency({
      eventId: `${eventId}#escrow` as EventId,
      tick: args.tick,
      from: escrow,
      to: storesAccount(RAIDER),
      amount: fromEscrow,
    });
  }
  const fromStores = ledger.balance(stores);
  if (fromStores > 0) {
    ledger.seizeCurrency({
      eventId: `${eventId}#stores` as EventId,
      tick: args.tick,
      from: stores,
      to: storesAccount(RAIDER),
      amount: fromStores,
    });
  }
  return eventId;
}

/**
 * Drain the payer's stores and nothing else — §15.4's account X.
 *
 * Separate from {@link raid} because the escrow must survive: the guaranteed half has to
 * execute normally so that the *only* thing the drain changes is whether the elective half
 * can be funded. That is what makes the resulting default a fabrication rather than a
 * second defence firing.
 */
function drainPayerStores(
  ledger: Ledger,
  events: EventLedger,
  args: { readonly venture: VentureId; readonly creator: PrincipalId; readonly tick: number },
): EventId {
  const stores = storesAccount(args.creator);
  const take = ledger.balance(stores);
  const eventId = appendPublic(events, {
    tick: args.tick,
    kind: 'raid.struck',
    actor: RAIDER,
    payload: { venture: args.venture, target: stores, takeMinor: take },
  });
  if (take > 0) {
    ledger.seizeCurrency({
      eventId: `${eventId}#stores` as EventId,
      tick: args.tick,
      from: stores,
      to: storesAccount(RAIDER),
      amount: take,
    });
  }
  return eventId;
}
