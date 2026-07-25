/**
 * The false-default audit, in two modes (SPEC §15.4).
 *
 * > Naively specified it cannot catch the bug it exists for: with hazards off it
 * > never exercises the raid-drains-the-account path, and with hazards on some
 * > defaults are legitimate so zero cannot be asserted. So it runs in two modes.
 * > **Mode A, hazards off:** an all-cooperative simulation must log **zero**
 * > defaults. **Mode B, hazards on:** every logged default must be *attributable* —
 * > each one carries the event ID of the loss or the missed delivery that caused it,
 * > and a default with no attributable cause is top-severity, because it is the game
 * > accusing an innocent agent.
 *
 * Both modes run the same model. That is the point: two assertions over one
 * simulation, because the two failures they catch are different failures. Mode A
 * catches *invention* — a default recorded where nothing went wrong. Mode B catches
 * *unattributability* — a default recorded for a real loss that the record cannot
 * point at. A codebase with only Mode A ships the second bug; a codebase with only
 * Mode B ships the first, because a fabricated default is trivially attributable to
 * whatever event happened to be nearby.
 *
 * ## This is a model, and saying so is part of the audit
 *
 * There is no venture module yet, so the settlement here is a **reference model**:
 * real `Ledger`, real `EventLedger`, real `DefaultRegister`, real freeze arithmetic
 * from `core/time.ts`, real aggregate assert pass — and a settlement written in this
 * file. When the venture module lands, the two `settle` passes below must be replaced
 * by calls into it — {@link AuditResult.model} hands back the world the audit built so
 * the swap can be verified against the same ledger rather than a fresh one. Until then
 * the audit proves the *plumbing*, not the real waterfall. Reporting that honestly is
 * cheaper than discovering it during the first real default.
 *
 * ## It can be shown to bite
 *
 * Three injectable defects, each aimed at one mode:
 * `injectFabricatedDefault` records a default for a promise that was kept — Mode A
 * catches it and Mode B cannot. `injectUnattributedDefault` publishes the accusation
 * without registering a cause — Mode B catches it. `disableFreeze` lets a rival
 * drain a committed account inside the freeze — INV-18 catches it, which is the
 * mechanism SPEC §15.4 lists first among its five defences.
 */

import { Rng } from '../core/rng.js';
import {
  FREEZE_TICKS,
  TICKS_PER_RECKONING,
  inFreeze,
  isSettlementTick,
  reckoningIndex,
} from '../core/time.js';
import type {
  AccountId,
  EventId,
  InvariantViolation,
  PrincipalId,
  Standing,
  VentureId,
} from '../core/types.js';
import { minor, type Minor } from '../core/units.js';
import { EventLedger } from '../events/ledger.js';
import type { NewEvent } from '../events/ledger.js';
import { CURRENCY_FAUCET, escrowAccount, storesAccount } from '../ledger/accounts.js';
import { SimpleObligationBook } from '../ledger/encumbrance.js';
import { Ledger, openStores, openVentureEscrow } from '../ledger/ledger.js';
import { checkInvariants, type InvariantReport, type SettledPayouts } from './aggregate.js';
import { DefaultRegister, type DefaultAttribution } from './attribution.js';
import type { SettlementSet, StandingChange } from './promises.js';
import { halting } from './registry.js';

/** The rules version every event in the model pins (INV-15). */
const MODEL_RULES_VERSION = 1;

/**
 * What each principal is topped up to at the start of every Reckoning.
 *
 * Topped up rather than funded once, because a raid **drains** the target's stores
 * (see {@link raid}) and a drained principal could not fund next Reckoning's escrow.
 * Issuing from the named starter-stake faucet each Reckoning keeps the model running
 * for long enough to matter while staying inside INV-1's form B and INV-2's identity.
 */
const STORES_TARGET = 10_000;
/**
 * A7's two halves, per venture. The elective part is the only one that can betray.
 *
 * The elective part is **larger than the escrowed part** on purpose, and that is not
 * a balance choice — it is what makes the audit able to fail. Every principal here is
 * a promisee as well as a promisor, so it receives one escrowed part at settlement.
 * If the elective part were the smaller number, that inflow would quietly refill a
 * drained account and no raid could ever produce a default: Mode B would report zero
 * and read exactly like a clean bill of health. An earlier version of this file had
 * it the other way round and did precisely that.
 */
const ESCROWED_PART = 1_000;
const ELECTIVE_PART = 3_000;
/** One in this many ventures is raided when hazards are on. */
const RAID_ODDS_DENOMINATOR = 3;
/** The tick within a Reckoning at which hazards fire. Well before the freeze. */
const HAZARD_PHASE = 100;

/**
 * The world-spawned raider (SPEC §9, E2E-4). Never a promisor and never a promisee.
 *
 * It has to be outside the promise graph, and an earlier version of this file learned
 * why the hard way: with the counterparty as raider, every principal both lost and
 * gained a drained balance in the same tick, so each one was refilled by its own raid
 * on somebody else and **not one default ever occurred**. Mode B reported zero
 * defaults and every assertion passed — a perfectly clean bill of health from a model
 * that could not reach the branch it exists to test. It is also the right design: a
 * raider that is also the counterparty is draining an account it is about to be paid
 * from, which is the self-deal INV-23 forbids under a grant.
 */
const WORLD_RAIDER = 'world-raider' as PrincipalId;

export interface AuditOptions {
  readonly seed: string;
  /** Mode A is `false`; Mode B is `true`. */
  readonly hazards: boolean;
  readonly reckonings?: number;
  readonly principals?: number;
  /**
   * Record a default for a promise that was in fact kept. Mode A's assertion is the
   * only thing that catches this, which is why Mode A exists.
   */
  readonly injectFabricatedDefault?: boolean;
  /**
   * Publish the accusation without registering its cause. INV-17, and therefore
   * Mode B, must catch this.
   */
  readonly injectUnattributedDefault?: boolean;
  /**
   * Let a rival drain a committed account *inside* the freeze. INV-18 must catch it;
   * SPEC §15.4's first defence is the hard freeze.
   */
  readonly disableFreeze?: boolean;
}

export interface AuditResult {
  readonly hazards: boolean;
  readonly ticksVisited: readonly number[];
  readonly ventures: number;
  readonly settled: number;
  /** Resolutions where cargo or currency was destroyed. Never defaults. */
  readonly losses: number;
  readonly defaults: readonly DefaultAttribution[];
  /** Default events with no attribution at all. Mode B's headline number. */
  readonly unattributedDefaults: readonly EventId[];
  /** Everything the aggregate pass reported, across every tick visited. */
  readonly violations: readonly InvariantViolation[];
  readonly reports: readonly InvariantReport[];
  /** Per-tick `state_hash`. Two runs of the same seed must match (DET-1). */
  readonly stateHashes: readonly string[];
  /** The world the audit built, for a caller that wants to check it independently. */
  readonly model: AuditModel;
}

/**
 * The seam the real venture module plugs into.
 *
 * Named and exported so the repointing is a one-line change with a type error if it
 * is done wrong, rather than a rewrite of this file.
 */
export interface AuditModel {
  readonly ledger: Ledger;
  readonly events: EventLedger;
  readonly defaults: DefaultRegister;
  readonly obligations: SimpleObligationBook;
}

interface Commitment {
  readonly venture: VentureId;
  readonly promisor: PrincipalId;
  readonly promisee: PrincipalId;
  readonly escrow: AccountId;
  readonly encumbranceId: string;
  readonly formedEventId: EventId;
  /** The event that took value from the promisor, if anything did. */
  raidEventId: EventId | null;
}

/**
 * Run the audit.
 *
 * Deterministic in `seed` and nothing else: no clock, no unseeded draw, no map
 * iteration order that depends on arrival (SPEC §15.2, §15.5).
 */
export function runFalseDefaultAudit(options: AuditOptions): AuditResult {
  const reckonings = options.reckonings ?? 2;
  const principalCount = options.principals ?? 4;
  if (principalCount < 2) {
    throw new Error('the audit needs at least two principals; a promise has two sides');
  }

  const rng = Rng.fromSeed(options.seed).derive('false-default-audit');
  const ledger = new Ledger();
  const events = new EventLedger();
  const defaults = new DefaultRegister();
  const obligations = new SimpleObligationBook();

  const principals: PrincipalId[] = [];
  for (let i = 0; i < principalCount; i += 1) principals.push(`p${i}` as PrincipalId);
  for (const p of principals) openStores(ledger, p);
  openStores(ledger, WORLD_RAIDER);

  const standingChanges: StandingChange[] = [];
  const standings = new Map<PrincipalId, Standing>();
  const seenCounterparties = new Map<PrincipalId, Set<PrincipalId>>();
  for (const p of principals) {
    standings.set(p, {
      principal: p,
      electiveHonoured: 0,
      electiveHonouredValue: minor(0),
      defaults: 0,
      contradictedSeals: 0,
      distinctCounterparties: 0,
      lastDefaultTick: null,
    });
  }

  const settlements: SettledPayouts[] = [];
  const violations: InvariantViolation[] = [];
  const reports: InvariantReport[] = [];
  const stateHashes: string[] = [];
  const ticksVisited: number[] = [];
  const unattributedDefaults: EventId[] = [];
  let ventures = 0;
  let settled = 0;
  let losses = 0;

  /**
   * Top a principal's stores up to {@link STORES_TARGET} from the named faucet.
   *
   * One posting against a named faucet is INV-1's form B; the faucet runs negative
   * by what it issued, which is what keeps INV-2 pure arithmetic.
   */
  const topUp = (p: PrincipalId, tick: number): void => {
    const shortfall = STORES_TARGET - ledger.balance(storesAccount(p));
    if (shortfall <= 0) return;
    const fundEvent = append(events, {
      tick,
      kind: 'STORES_FUNDED',
      actor: p,
      payload: { account: storesAccount(p), amountMinor: shortfall },
    });
    ledger.issueCurrency({
      eventId: fundEvent,
      tick,
      faucet: CURRENCY_FAUCET.STARTER_STAKE,
      to: storesAccount(p),
      amount: minor(shortfall),
    });
  };

  for (const p of principals) topUp(p, 0);

  const visit = (tick: number, set: SettlementSet | null): void => {
    const report = checkInvariants(
      {
        ledger,
        obligations,
        events,
        eventScope: 'TICK',
        defaults,
        settlements,
        standingChanges,
        standings: [...standings.values()],
        ...(set === null ? {} : { settlementSet: set }),
      },
      tick,
    );
    reports.push(report);
    violations.push(...report.violations);
    stateHashes.push(ledger.stateHash());
    ticksVisited.push(tick);
  };

  visit(0, null);

  // ── one Reckoning at a time ───────────────────────────────────────────────
  for (let r = 0; r < reckonings; r += 1) {
    const base = r * TICKS_PER_RECKONING;
    const formTick = base + 1;
    const hazardTick = base + HAZARD_PHASE;
    const settleTick = base + TICKS_PER_RECKONING - 1;
    /**
     * Where the settlement set is computed and its inputs read. **Strictly before the
     * settlement tick** (SPEC §5.1: the freeze is "the last tick *before* settlement"), so
     * INV-18's `(frozenAtTick .. settlementTick]` names a real interval. Derived from
     * `FREEZE_TICKS` rather than written as `- 1`, so a wider freeze moves the model too.
     */
    const freezeTick = settleTick - FREEZE_TICKS;
    if (!isSettlementTick(settleTick)) {
      throw new Error(`the audit computed ${settleTick} as a settlement tick and core/time disagrees`);
    }

    const live: Commitment[] = [];
    for (const p of principals) topUp(p, formTick);
    for (let i = 0; i < principals.length; i += 1) {
      const promisor = principals[i];
      const promisee = principals[(i + 1) % principals.length];
      if (promisor === undefined || promisee === undefined) continue;
      const venture = `v:${r}:${i}` as VentureId;
      const escrow = escrowAccount(venture, promisor);
      openVentureEscrow(ledger, venture, promisor);

      const formed = append(events, {
        tick: formTick,
        kind: 'VENTURE_FORMED',
        actor: promisor,
        payload: {
          venture,
          promisee,
          escrow,
          stores: storesAccount(promisor),
          escrowedMinor: ESCROWED_PART,
          electiveMinor: ELECTIVE_PART,
        },
      });
      ledger.transferCurrency({
        eventId: formed,
        tick: formTick,
        from: storesAccount(promisor),
        to: escrow,
        amount: minor(ESCROWED_PART),
      });
      obligations.open(venture, true);
      const encumbranceId = ledger.encumbrances.lock({
        eventId: formed,
        tick: formTick,
        principal: promisor,
        account: storesAccount(promisor),
        amountMinor: minor(ELECTIVE_PART),
        obligationRef: venture,
        maxDirectLoss: minor(ELECTIVE_PART),
      });
      live.push({
        venture,
        promisor,
        promisee,
        escrow,
        encumbranceId,
        formedEventId: formed,
        raidEventId: null,
      });
      ventures += 1;
    }
    visit(formTick, null);

    // ── hazards, well before the freeze ─────────────────────────────────────
    if (options.hazards) {
      for (const c of live) {
        if (!rng.chance(1, RAID_ODDS_DENOMINATOR)) continue;
        c.raidEventId = raid(ledger, events, c, hazardTick);
        losses += 1;
      }
      visit(hazardTick, null);
    }

    // ── the freeze, and the settlement one tick later ────────────────────────
    if (!inFreeze(freezeTick)) {
      throw new Error(`core/time says tick ${freezeTick} is not in the freeze; the model is out of step`);
    }

    // A rival drains a committed account *inside* the freeze. Only reachable with
    // the freeze disabled, and INV-18 is what notices.
    if (options.disableFreeze === true && options.hazards) {
      const victim = live[0];
      if (victim !== undefined) {
        victim.raidEventId = raid(ledger, events, victim, settleTick);
        losses += 1;
      }
    }

    // The settlement set, frozen at `freezeTick` and settled at `settleTick`, so INV-18
    // ranges over a real interval as well as over the within-tick seq boundary.
    // `settlementSeqFrom` is the seq at which the settlement's own events begin, which is
    // what separates "the settlement touched the set" from "somebody else did" for the
    // rows written at the settlement tick itself.
    const objects = new Set<string>();
    for (const c of live) {
      objects.add(c.venture);
      objects.add(c.escrow);
      objects.add(storesAccount(c.promisor));
    }
    const set: SettlementSet = {
      reckoningIndex: reckoningIndex(settleTick),
      frozenAtTick: freezeTick,
      settlementTick: settleTick,
      settlementSeqFrom: events.eventsAtTick(settleTick).length,
      objects,
      inputsHash: ledger.stateHash(),
      stateVersion: settleTick,
    };

    /**
     * What each promisor can pay, **pinned at the freeze**.
     *
     * Read before any payout moves, and not recomputed afterwards. SPEC §15.3 hashes
     * the settlement inputs at the freeze precisely so the outcome is a function of
     * the frozen state; deciding solvency from a running balance instead makes it a
     * function of the order the ventures happen to be paid in. That is not a
     * theoretical objection — with the running balance, a drained principal that
     * appeared early in the elective pass was refilled by another venture's payout
     * and its default silently disappeared, which is INV-19's failure with the sign
     * flipped: the settlement resolved from a state nobody acted on and the record
     * came out *flattering* instead of libellous.
     */
    const payableAtFreeze = new Map<VentureId, Minor>();
    for (const c of live) {
      payableAtFreeze.set(
        c.venture,
        minor(Math.min(ELECTIVE_PART, ledger.balance(storesAccount(c.promisor)))),
      );
    }

    // ── every escrowed part, first. SPEC §15.3's order, not a convenience. ──
    // "escrowed parts -> elective parts in venture_id order". Interleaving them
    // would pay one venture's junior elective claim before another's senior
    // escrowed one, which is the §7.1 inversion with the ventures swapped.
    for (const c of live) {
      const escrowBalance = ledger.freeBalance(c.escrow);
      const paidEvent = append(events, {
        tick: settleTick,
        kind: 'ESCROWED_PART_PAID',
        actor: c.promisor,
        parent: c.formedEventId,
        payload: { venture: c.venture, to: storesAccount(c.promisee), amountMinor: escrowBalance },
      });
      if (escrowBalance > 0) {
        ledger.transferCurrency({
          eventId: paidEvent,
          tick: settleTick,
          from: c.escrow,
          to: storesAccount(c.promisee),
          amount: escrowBalance,
        });
      }
    }

    // ── then every elective part, in venture order. ─────────────────────────
    for (const c of live) {
      ledger.encumbrances.release(c.encumbranceId, settleTick);
      obligations.close(c.venture);
      const payable = payableAtFreeze.get(c.venture) ?? minor(0);
      const fabricate = options.injectFabricatedDefault === true;

      if (payable >= ELECTIVE_PART && !fabricate) {
        const honoured = append(events, {
          tick: settleTick,
          kind: 'ELECTIVE_PART_HONOURED',
          actor: c.promisor,
          parent: c.formedEventId,
          payload: { venture: c.venture, to: storesAccount(c.promisee), amountMinor: ELECTIVE_PART },
        });
        ledger.transferCurrency({
          eventId: honoured,
          tick: settleTick,
          from: storesAccount(c.promisor),
          to: storesAccount(c.promisee),
          amount: minor(ELECTIVE_PART),
        });
        creditStanding(
          standingChanges,
          standings,
          seenCounterparties,
          c,
          honoured,
          settleTick,
          minor(ELECTIVE_PART),
        );
        settled += 1;
      } else {
        // A default. The cause is the raid if there was one, and the elapsed window
        // otherwise — and there must be one, or nothing is published.
        const causeEventId = c.raidEventId ?? (fabricate ? c.formedEventId : null);
        const cause: DefaultAttribution['cause'] = c.raidEventId === null ? 'ELAPSED_WINDOW' : 'LOSS';
        const parent = causeEventId ?? c.formedEventId;
        const defaultEvent = append(events, {
          tick: settleTick,
          kind: 'VENTURE_DEFAULTED',
          actor: c.promisor,
          parent,
          payload: {
            venture: c.venture,
            promisee: c.promisee,
            shortfallMinor: ELECTIVE_PART - payable,
            causeEventId: parent,
          },
        });
        if (options.injectUnattributedDefault === true) {
          // Deliberately skip the register. INV-17 must fire.
          unattributedDefaults.push(defaultEvent);
        } else {
          defaults.attribute({
            defaultEventId: defaultEvent,
            promisor: c.promisor,
            obligation: c.venture,
            cause,
            causeEventId: parent,
            tick: settleTick,
            reckoningIndex: reckoningIndex(settleTick),
          });
        }
        debitStanding(standingChanges, standings, c.promisor, defaultEvent, settleTick);
        if (payable > 0) {
          ledger.transferCurrency({
            eventId: `${defaultEvent}#part` as EventId,
            tick: settleTick,
            from: storesAccount(c.promisor),
            to: storesAccount(c.promisee),
            amount: payable,
          });
        }
      }
    }

    visit(settleTick, set);
  }

  return {
    hazards: options.hazards,
    ticksVisited,
    ventures,
    settled,
    losses,
    defaults: defaults.all(),
    unattributedDefaults,
    violations,
    reports,
    stateHashes,
    model: { ledger, events, defaults, obligations },
  };
}

/**
 * Mode A — hazards off. An all-cooperative simulation must log **zero** defaults.
 *
 * Nothing goes wrong in this world: every promisor can pay and every promisor does.
 * A default here is the engine inventing one, which is the A5′ failure.
 */
export function auditModeA(options: Omit<AuditOptions, 'hazards'>): AuditResult {
  return runFalseDefaultAudit({ ...options, hazards: false });
}

/**
 * Mode B — hazards on. Every logged default must carry the event id that caused it.
 *
 * Zero cannot be asserted here, because some defaults are legitimate: a raid really
 * did drain the account, and the promise really was broken. What must hold is that
 * the record can point at *why*, for every single one.
 */
export function auditModeB(options: Omit<AuditOptions, 'hazards'>): AuditResult {
  return runFalseDefaultAudit({ ...options, hazards: true });
}

export interface AuditVerdict {
  readonly ok: boolean;
  readonly failures: readonly string[];
}

/** Mode A's assertion, as a value rather than a throw, so a caller can report both. */
export function verifyModeA(result: AuditResult): AuditVerdict {
  const failures: string[] = [];
  if (result.hazards) failures.push('Mode A must run with hazards off');
  if (result.defaults.length > 0) {
    failures.push(
      `Mode A logged ${result.defaults.length} default(s) in an all-cooperative world: ` +
        result.defaults.map((d) => `${d.defaultEventId} against ${d.promisor}`).join(', ') +
        '. Every one of these is the engine accusing an innocent agent',
    );
  }
  if (result.unattributedDefaults.length > 0) {
    failures.push(
      `Mode A published ${result.unattributedDefaults.length} unattributed default event(s)`,
    );
  }
  failures.push(...invariantFailures(result));
  if (result.settled === 0) {
    // A run that settled nothing proves nothing, and would pass the zero-defaults
    // assertion trivially. TESTING.md §3's own warning, applied to the audit itself.
    failures.push('Mode A settled zero ventures, so its zero-defaults result is vacuous');
  }
  return { ok: failures.length === 0, failures };
}

/** Mode B's assertion. */
export function verifyModeB(result: AuditResult): AuditVerdict {
  const failures: string[] = [];
  if (!result.hazards) failures.push('Mode B must run with hazards on');
  if (result.unattributedDefaults.length > 0) {
    failures.push(
      `Mode B published ${result.unattributedDefaults.length} default event(s) with no attribution: ` +
        result.unattributedDefaults.join(', '),
    );
  }
  for (const d of result.defaults) {
    if (d.causeEventId.length === 0) {
      failures.push(`default ${d.defaultEventId} carries no cause event id`);
    }
  }
  failures.push(...invariantFailures(result));
  if (result.losses === 0) {
    // The whole reason Mode B exists is the raid-drains-the-account path. A run
    // where no hazard fired has not exercised it.
    failures.push('Mode B fired zero hazards, so it never exercised the raid-drains-the-account path');
  }
  if (result.defaults.length === 0 && result.unattributedDefaults.length === 0) {
    // Mode B's assertion is "every default is attributable". Over zero defaults that
    // is vacuously true, and an earlier version of this file passed exactly that way
    // for a full run: raids fired, every drained account was refilled before its
    // elective part was evaluated, and Mode B reported a clean world. Never again by
    // accident — if the model stops producing defaults, that is the finding.
    failures.push(
      `Mode B logged ${result.losses} loss(es) and zero defaults, so its attribution clause is vacuous. ` +
        'Either the model no longer reaches the default branch, or losses are being absorbed somewhere',
    );
  }
  return { ok: failures.length === 0, failures };
}

function invariantFailures(result: AuditResult): readonly string[] {
  return halting(result.violations).map((v) => `${v.id} at tick ${v.tick}: ${v.message}`);
}

// ── the model's moving parts ────────────────────────────────────────────────

interface EventDraft {
  readonly tick: number;
  readonly kind: string;
  readonly actor: PrincipalId;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly parent?: EventId;
}

/**
 * Append a PUBLIC event. Every event in the model is PUBLIC on purpose: A9 parity is
 * the default, and a tier the audit does not need is a tier the audit should not use.
 */
function append(events: EventLedger, draft: EventDraft): EventId {
  const event: NewEvent = {
    tick: draft.tick,
    kind: draft.kind,
    rulesVersion: MODEL_RULES_VERSION,
    actorPrincipalId: draft.actor,
    onBehalfOfPrincipalId: null,
    grantId: null,
    eventFamilyId: draft.kind,
    parentEventId: draft.parent ?? null,
    isPublic: true,
    publicAt: draft.tick,
    declassifyAt: draft.tick,
    provenanceClass: 'FACT',
    actedOnStateVersion: draft.tick,
    decisionSource: 'HEURISTIC',
    payload: draft.payload,
    visibility: 'PUBLIC',
    audience: [],
  };
  return events.append(event).event.id;
}

/**
 * A raid takes value out of a committed account.
 *
 * `seizeCurrency` is the right door and the only one: it takes *locked* value,
 * because an encumbrance is a claim on a thing and never a shield over it (PROP-L3),
 * and it sheds the locks it invalidates so INV-3 stays true. This is SPEC §15.4's
 * scenario reproduced exactly — "during the window my convoy is raided and X is
 * drained" — and the point of the audit is that the resulting shortfall is
 * attributable to *this* event id.
 */
function raid(ledger: Ledger, events: EventLedger, c: Commitment, tick: number): EventId {
  const target = storesAccount(c.promisor);
  // Drained, not dented. SPEC §15.4's sentence is "my convoy is raided and X is
  // drained", and a raid that leaves enough behind to pay the elective part never
  // reaches the branch this audit exists to test.
  const take = ledger.balance(target);
  const eventId = append(events, {
    tick,
    kind: 'RAID_STRUCK',
    actor: WORLD_RAIDER,
    payload: {
      venture: c.venture,
      target,
      escrow: c.escrow,
      takeMinor: take,
    },
  });
  if (take > 0) {
    ledger.seizeCurrency({
      eventId,
      tick,
      from: target,
      to: storesAccount(WORLD_RAIDER),
      amount: take,
    });
  }
  return eventId;
}

function creditStanding(
  changes: StandingChange[],
  standings: Map<PrincipalId, Standing>,
  seen: Map<PrincipalId, Set<PrincipalId>>,
  c: Commitment,
  eventId: EventId,
  tick: number,
  value: Minor,
): void {
  let known = seen.get(c.promisor);
  if (known === undefined) {
    known = new Set<PrincipalId>();
    seen.set(c.promisor, known);
  }
  // Scar #9: a repeat counterparty adds no diversity. The delta is +1 only the first
  // time, so the summed journal and the distinct set agree — which is what INV-21
  // compares.
  const isNew = !known.has(c.promisee);
  known.add(c.promisee);
  changes.push({
    principal: c.promisor,
    tick,
    cause: 'ELECTIVE_HONOURED',
    eventId,
    delta: isNew
      ? { electiveHonoured: 1, electiveHonouredValue: value, distinctCounterparties: 1 }
      : { electiveHonoured: 1, electiveHonouredValue: value },
    counterparty: c.promisee,
  });
  const row = standings.get(c.promisor);
  if (row === undefined) return;
  standings.set(c.promisor, {
    ...row,
    electiveHonoured: row.electiveHonoured + 1,
    electiveHonouredValue: minor(row.electiveHonouredValue + value),
    distinctCounterparties: row.distinctCounterparties + (isNew ? 1 : 0),
  });
}

function debitStanding(
  changes: StandingChange[],
  standings: Map<PrincipalId, Standing>,
  promisor: PrincipalId,
  eventId: EventId,
  tick: number,
): void {
  changes.push({
    principal: promisor,
    tick,
    cause: 'DEFAULT',
    eventId,
    delta: { defaults: 1 },
    counterparty: null,
  });
  const row = standings.get(promisor);
  if (row === undefined) return;
  standings.set(promisor, { ...row, defaults: row.defaults + 1, lastDefaultTick: tick });
}
