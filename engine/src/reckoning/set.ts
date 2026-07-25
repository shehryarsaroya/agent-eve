/**
 * The freeze, as an object: **the settlement set, computed once and then immutable**
 * (SPEC §5.1, §15.3).
 *
 * > **Freeze** (last tick before settlement). Hard: no new commitments, no book
 * > clears, no raid resolution, no grant spend, no hazard against any object in the
 * > settlement set. The settlement set is computed and **its inputs are hashed**.
 * > — §5.1
 *
 * > Commitment window (`PARTIES`-visible) -> **freeze, settlement set computed and
 * > inputs hashed** -> settle: **assert the input hash equals what parties acted on**
 * > -> ... — §15.3
 *
 * ## Why this is a separate object and not a local inside the driver
 *
 * `src/venture/settlement.ts` documents the contract this file exists to keep, and
 * says explicitly that it has no production caller yet:
 *
 * > §15.3's order is "freeze, settlement set computed and inputs hashed -> settle:
 * > assert the input hash equals what parties acted on", so the Reckoning driver
 * > reads `venture.actedOnStateVersion` **at the freeze**, keeps it inside the
 * > immutable settlement set alongside the inputs hash, and passes that captured
 * > copy here.
 *
 * A value captured and compared inside one function call is a value compared against
 * itself, which is the no-op that doc warns about twice. So the capture is a
 * *different object at a different time*: {@link freezeReckoning} reads the world,
 * {@link verifyFrozenInputs} reads it again, and the two are separate calls with a
 * gap between them that a raid can land in. That gap is E2E-12, and without this
 * split there is nowhere for it to happen.
 *
 * ## What is hashed, and why both halves are in one hash
 *
 * Two kinds of input decide a settlement:
 *
 *   1. **Decisions** — the outcome, the pinned proceeds, the payer's elections, the
 *      event that destroyed value. These are computed before the freeze and live
 *      here, frozen. Nothing outside this object can move them.
 *   2. **Readings** — what the world said at the freeze: the venture's pinned
 *      `acted_on_state_version`, its recomputed `terms_hash`, the free balance of the
 *      escrow and of the payer's stores, who filled each role. **Only these can
 *      move**, and every one of them can move the money a settlement is about to pay.
 *
 * Both go into `inputsHash`, so the single comparison at `VERIFY_INPUTS` covers
 * a tampered frozen set *and* a drained account. The field-by-field comparison
 * exists beside it because a hash mismatch tells an operator only that something
 * moved, and the sentence an operator needs at 04:00 is *which account lost how
 * much*.
 *
 * ## What is deliberately **not** in `objects`
 *
 * `objects` is INV-18's scope: the ids that no third party may touch between the
 * freeze and the settlement. It holds ventures, escrow accounts, the payer's and
 * every role-holder's stores, and the venture's open encumbrance ids. It does **not**
 * hold bare principal ids, and that omission is deliberate: `touchedObjects` collects
 * every string in an event payload, so listing a principal would make INV-18 fire on
 * that agent's own unrelated rows at the freeze tick — a false halt, which SPEC §15.4
 * puts in the same class as a false default. Value moves through accounts, and the
 * accounts are all here, so the value story is covered without the false positives.
 */

import { canonicalHash, type CanonicalValue } from '../core/canonical.js';
import { FREEZE_TICKS, inFreeze, isSettlementTick, reckoningIndex } from '../core/time.js';
import type { AccountId, EventId, PrincipalId, VentureId } from '../core/types.js';
import { minor, type Minor } from '../core/units.js';
import type { Ledger } from '../ledger/index.js';
import { compareIds } from '../ledger/index.js';
import type { SettlementItem, SettlementSet } from '../invariants/index.js';
import {
  IN_FULL,
  termsHashOf,
  type Election,
  type ResolutionKind,
  type SettlementAccounts,
  type VentureBook,
  type VentureRecord,
} from '../venture/index.js';

/**
 * A halt raised by the Reckoning driver. Thrown, never returned.
 *
 * Every throw site is reachable only from an **engine-side** defect: a driver that
 * froze the wrong tick, a resolution plan that names a venture the book does not
 * hold, a default whose cause is not in the record. SPEC §15.2's rule is abort the
 * tick and halt rather than publish a broken one, and `runReckoning` turns a throw in
 * a stage into a halt record with the input triple attached.
 *
 * **Nothing an agent sends reaches one.** That is a standing rule and not an
 * observation: a halt an agent can trigger is a denial of settlement (AGT-X9), and
 * the one agent-supplied value that flows through this module — an election — is
 * normalised rather than refused (see {@link normaliseElections}).
 */
export class ReckoningHalt extends Error {}

/**
 * The version of the hashed shape.
 *
 * Prefixed into `inputsHash` for the same reason `canonicalize` carries `c1:`: a
 * change to *what* the freeze hashes must be visible as a version bump rather than
 * silently making every stored hash unreproducible.
 */
export const FROZEN_INPUTS_VERSION = 1;

/**
 * One obligation's resolution decisions, computed before the freeze.
 *
 * This is the venture module's `SettleInput` minus the two fields only the freeze can
 * supply (`actedOnStateVersion`, and the settlement's own event handle). Keeping them
 * out is what makes it impossible for a caller to pass the wrong
 * `acted_on_state_version` — there is no field to pass it in.
 */
export interface ObligationPlan {
  readonly venture: VentureId;
  readonly outcome: ResolutionKind;
  /** Pinned by the caller. A deferral's second pass divides the same pot (§15.3). */
  readonly proceeds: Minor;
  /** Role index -> what the payer elects. **An absent entry pays nothing** (PROP-V4). */
  readonly elections: ReadonlyMap<number, Election>;
  /** The event that destroyed value, on a loss outcome. INV-17's evidence. */
  readonly causeEventId: EventId | null;
}

/** What the freeze read off the world for one obligation. The only half that can move. */
export interface FrozenReading {
  /** `venture.actedOnStateVersion` **as read at the freeze** (INV-19, §15.4). */
  readonly actedOnStateVersion: number;
  /** `termsHashOf(venture)`, recomputed at the freeze rather than copied off the row. */
  readonly termsHash: string;
  readonly state: string;
  readonly deferrals: number;
  readonly escrowExecutedAtTick: number | null;
  readonly escrow: AccountId;
  readonly escrowFreeMinor: Minor;
  readonly payerStores: AccountId;
  readonly payerFreeMinor: Minor;
  /** Role index -> the principal holding it, or null. Ordered by index. */
  readonly holders: readonly (PrincipalId | null)[];
}

export interface FrozenObligation {
  readonly venture: VentureId;
  readonly payer: PrincipalId;
  readonly plan: ObligationPlan;
  readonly reading: FrozenReading;
  /**
   * Elections the freeze could not read as an election, by role index.
   *
   * Empty in any world whose `act` layer validated its input. When it is not empty
   * the entry was **dropped**, which is PROP-V4's own default ("an absent entry pays
   * nothing") and the only answer available: halting would hand every agent a
   * one-field denial of settlement (AGT-X9), and coercing to `IN_FULL` would spend
   * the payer's money on an election it never made. Published here so an operator
   * sees it rather than inferring it from a default.
   */
  readonly malformedElections: readonly number[];
}

/**
 * The whole frozen set. Deep-frozen on the way out, so "immutable" is enforced by
 * the runtime rather than by the `readonly` keyword the JS boundary erases.
 */
export interface FrozenReckoning {
  readonly reckoning: number;
  /** The tick the freeze took effect. */
  readonly frozenAtTick: number;
  /**
   * The tick settlement runs at.
   *
   * `frozenAtTick + FREEZE_TICKS`, and deliberately NOT equal to `frozenAtTick`.
   *
   * INV-18 ranges over `(frozenAtTick, settlementTick]` — "between freeze and
   * settlement, zero events touch the settlement set". If the two are ever the same
   * value that range is empty and the check silently stops meaning anything, which is
   * precisely what happened while `core/time.ts` had `inFreeze` and `isSettlementTick`
   * both true at phase 287. Kept as a field rather than recomputed so every reader sees
   * the same value the inputs hash was taken over.
   */
  readonly settlementTick: number;
  /** The engine's state version at the freeze. Settlement and the seals run at it. */
  readonly stateVersion: number;
  readonly obligations: readonly FrozenObligation[];
  /** INV-18's scope. See the module header on what is left out and why. */
  readonly objects: ReadonlySet<string>;
  readonly inputsHash: string;
}

/**
 * Is this a legal election? Exported because the `act` layer is the right place to
 * refuse a malformed one, with a hint, for one action (High Water pattern 4).
 */
export function isElection(value: unknown): value is Election {
  if (value === IN_FULL) return true;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Drop anything that is not an election, and say which. */
function normaliseElections(elections: ReadonlyMap<number, Election>): {
  readonly kept: ReadonlyMap<number, Election>;
  readonly dropped: readonly number[];
} {
  const kept = new Map<number, Election>();
  const dropped: number[] = [];
  for (const roleIndex of [...elections.keys()].sort((a, b) => a - b)) {
    const value = elections.get(roleIndex);
    if (isElection(value)) kept.set(roleIndex, value);
    else dropped.push(roleIndex);
  }
  return { kept, dropped };
}

/**
 * Compute the settlement set and hash its inputs.
 *
 * Call this **at the freeze tick**, once, before anything settles. The due set is
 * taken from the book rather than from the caller's list, and a plan is then required
 * for every member: a due venture with no plan would otherwise be silently dropped,
 * which is the mirror of the bug `checkUnjudgedSeals` exists for — a promise the world
 * quietly forgot reads, to the agent that made it, as a promise that never counted.
 */
export function freezeReckoning(input: {
  readonly tick: number;
  readonly stateVersion: number;
  readonly ledger: Ledger;
  readonly book: VentureBook;
  readonly accounts: SettlementAccounts;
  readonly plans: readonly ObligationPlan[];
}): FrozenReckoning {
  const { tick, stateVersion, ledger, book, accounts } = input;

  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new ReckoningHalt(`the freeze needs a non-negative integer tick, got ${String(tick)}`);
  }
  if (!inFreeze(tick)) {
    // The set is computed at the FREEZE tick, which is strictly before the settlement
    // tick (SPEC §5.1: "the last tick *before* settlement"). This used to require
    // `inFreeze(tick) && isSettlementTick(tick)` — a condition satisfiable only because
    // `core/time.ts` had both predicates true at phase 287, which is the bug that made
    // INV-18's interval empty. So this guard encoded that bug and could not have been
    // satisfied once it was fixed. Asserting the freeze alone is the rule the canon
    // states, and the settlement tick is derived from it below rather than conflated
    // with it.
    throw new ReckoningHalt(
      `tick ${tick} is not the freeze tick of a Reckoning (inFreeze=${String(inFreeze(tick))}, ` +
        `isSettlementTick=${String(isSettlementTick(tick))}); the settlement set is computed at the freeze ` +
        'and nowhere else',
    );
  }
  if (!Number.isSafeInteger(stateVersion) || stateVersion < 0) {
    throw new ReckoningHalt(
      `the freeze needs the engine's state version, got ${String(stateVersion)}`,
    );
  }

  // Derived, never conflated. `frozenAtTick` is where the set is computed and the
  // inputs hashed; `settlementTick` is where it resolves. INV-18 ranges over
  // (frozenAtTick, settlementTick], so if these two are ever the same value that range
  // is empty and the check silently stops meaning anything — which is exactly what
  // happened while core/time.ts had both predicates true at one phase.
  const settlementTick = tick + FREEZE_TICKS;
  if (!isSettlementTick(settlementTick)) {
    throw new ReckoningHalt(
      `the freeze at tick ${String(tick)} does not immediately precede a settlement tick ` +
        `(derived ${String(settlementTick)}); FREEZE_TICKS and the phase bands disagree`,
    );
  }

  // The set is computed AT the freeze for what will be due AT settlement. Reading it at
  // the freeze tick would exclude everything resolving on the settlement tick, i.e.
  // everything — another place the old freeze/settlement collision hid a conflation by
  // making the two ticks interchangeable.
  const due = book.settlementSet(settlementTick);
  const planByVenture = new Map<VentureId, ObligationPlan>();
  for (const plan of input.plans) {
    if (planByVenture.has(plan.venture)) {
      throw new ReckoningHalt(
        `${plan.venture} has two resolution plans in one Reckoning; one obligation settles once, and two ` +
          'plans is the engine not knowing which outcome it means',
      );
    }
    planByVenture.set(plan.venture, plan);
  }
  const dueIds = new Set(due.map((v) => v.id));
  for (const id of [...planByVenture.keys()].sort(compareIds)) {
    if (!dueIds.has(id)) {
      throw new ReckoningHalt(
        `${id} has a resolution plan but is not due at settlement tick ${String(settlementTick)}; settling an obligation nobody is ` +
          'owed yet resolves a promise before its window closed',
      );
    }
  }

  const obligations: FrozenObligation[] = [];
  const objects = new Set<string>();
  for (const venture of due) {
    const plan = planByVenture.get(venture.id);
    if (plan === undefined) {
      throw new ReckoningHalt(
        `${venture.id} is due at tick ${tick} with no resolution plan; a due obligation that is left out ` +
          'of the settlement set is a promise the world dropped in silence',
      );
    }
    const { kept, dropped } = normaliseElections(plan.elections);
    const reading = readObligation(ledger, accounts, venture);
    obligations.push(
      Object.freeze({
        venture: venture.id,
        payer: venture.creator,
        plan: Object.freeze({ ...plan, elections: kept }),
        reading,
        malformedElections: Object.freeze(dropped),
      }),
    );
    for (const id of objectsOf(ledger, accounts, venture)) objects.add(id);
  }

  obligations.sort((a, b) => compareIds(a.venture, b.venture));

  const frozen: FrozenReckoning = {
    reckoning: reckoningIndex(tick),
    frozenAtTick: tick,
    settlementTick,
    stateVersion,
    obligations: Object.freeze(obligations),
    objects: objects,
    inputsHash: hashFrozenInputs({
      reckoning: reckoningIndex(tick),
      frozenAtTick: tick,
      settlementTick,
      stateVersion,
      obligations,
    }),
  };
  return Object.freeze(frozen);
}

/** Read the world's answer for one obligation. The only half of the hash that moves. */
function readObligation(
  ledger: Ledger,
  accounts: SettlementAccounts,
  venture: VentureRecord,
): FrozenReading {
  if (venture.actedOnStateVersion === null) {
    // Unreachable through the engine: `activate` is the only path to LIVE and it pins
    // the version in the same statement. Asserted because the alternative — settling
    // with nothing to compare — is exactly what INV-19 exists to stop, and
    // `guardSettleable` halts on it one layer down anyway.
    throw new ReckoningHalt(
      `INV-19: ${venture.id} is in the settlement set with no acted_on_state_version; only activate() ` +
        'reaches LIVE and it pins the version, so this row was written by something else',
    );
  }
  const escrow = accounts.escrowOf(venture);
  const payerStores = accounts.storesOf(venture.creator);
  return Object.freeze({
    actedOnStateVersion: venture.actedOnStateVersion,
    termsHash: termsHashOf(venture),
    state: venture.state,
    deferrals: venture.deferrals,
    escrowExecutedAtTick: venture.escrowExecutedAtTick,
    escrow,
    escrowFreeMinor: freeOrZero(ledger, escrow),
    payerStores,
    payerFreeMinor: freeOrZero(ledger, payerStores),
    holders: Object.freeze(venture.roles.map((r) => r.filledByPrincipal)),
  });
}

/**
 * `freeBalance` on an account that does not exist yet.
 *
 * Zero rather than a throw: an unopened escrow is a real state (the creator never
 * funded it), `guardSettleable` is the layer that refuses to settle against it with a
 * sentence naming the account, and a throw here would turn that into an
 * unattributable halt at the freeze.
 */
function freeOrZero(ledger: Ledger, id: AccountId): Minor {
  return ledger.account(id) === undefined ? minor(0) : ledger.freeBalance(id);
}

/** INV-18's scope for one venture. See the module header on the omission of principals. */
function objectsOf(
  ledger: Ledger,
  accounts: SettlementAccounts,
  venture: VentureRecord,
): readonly string[] {
  const out: string[] = [venture.id, accounts.escrowOf(venture), accounts.storesOf(venture.creator)];
  for (const role of venture.roles) {
    if (role.filledByPrincipal !== null) out.push(accounts.storesOf(role.filledByPrincipal));
    if (role.stakeEncumbranceId !== null) out.push(role.stakeEncumbranceId);
  }
  for (const enc of ledger.encumbrances.open()) {
    if (enc.obligationRef === venture.id) out.push(enc.id);
  }
  return out;
}

// ── The hash ─────────────────────────────────────────────────────────────────

function electionsCanonical(elections: ReadonlyMap<number, Election>): CanonicalValue {
  return [...elections.keys()]
    .sort((a, b) => a - b)
    .map((roleIndex) => {
      const election = elections.get(roleIndex);
      return {
        roleIndex,
        // `IN_FULL` is a string and an amount is an integer, so the canonical form
        // distinguishes them the same way `typeof` does — an amount that happens to
        // equal the due is a different statement from IN_FULL (see `Election`).
        election: election === undefined ? null : election,
      };
    });
}

function obligationCanonical(o: FrozenObligation): CanonicalValue {
  return {
    venture: o.venture,
    payer: o.payer,
    outcome: o.plan.outcome,
    proceeds: o.plan.proceeds,
    causeEventId: o.plan.causeEventId,
    elections: electionsCanonical(o.plan.elections),
    malformedElections: [...o.malformedElections],
    reading: {
      actedOnStateVersion: o.reading.actedOnStateVersion,
      termsHash: o.reading.termsHash,
      state: o.reading.state,
      deferrals: o.reading.deferrals,
      escrowExecutedAtTick: o.reading.escrowExecutedAtTick,
      escrow: o.reading.escrow,
      escrowFreeMinor: o.reading.escrowFreeMinor,
      payerStores: o.reading.payerStores,
      payerFreeMinor: o.reading.payerFreeMinor,
      holders: [...o.reading.holders],
    },
  };
}

/** The hash §15.3 takes at the freeze. Integers and strings only; no float can enter. */
export function hashFrozenInputs(parts: {
  readonly reckoning: number;
  readonly frozenAtTick: number;
  readonly settlementTick: number;
  readonly stateVersion: number;
  readonly obligations: readonly FrozenObligation[];
}): string {
  return canonicalHash({
    version: FROZEN_INPUTS_VERSION,
    reckoning: parts.reckoning,
    frozenAtTick: parts.frozenAtTick,
    settlementTick: parts.settlementTick,
    stateVersion: parts.stateVersion,
    obligations: [...parts.obligations]
      .sort((a, b) => compareIds(a.venture, b.venture))
      .map(obligationCanonical),
  });
}

// ── The comparison ───────────────────────────────────────────────────────────

/**
 * §15.3's "assert the input hash equals what the parties acted on".
 *
 * Returns faults rather than throwing, so the driver can put all of them in one halt
 * record: an operator reading a halt at the Reckoning wants every account that moved,
 * not the first one.
 *
 * **Call this before anything settles.** Half of what it reads (balances, the
 * venture's state, `escrowExecutedAtTick`) is changed *by* settling, so running it
 * afterwards reports the settlement as tampering.
 */
export function verifyFrozenInputs(
  frozen: FrozenReckoning,
  world: {
    readonly ledger: Ledger;
    readonly book: VentureBook;
    readonly accounts: SettlementAccounts;
  },
): readonly string[] {
  const faults: string[] = [];
  const live: FrozenObligation[] = [];

  for (const o of frozen.obligations) {
    const venture = world.book.get(o.venture);
    if (venture === undefined) {
      faults.push(
        `${o.venture} was in the frozen settlement set and is no longer in the book; a settlement set ` +
          'cannot lose a member between the freeze and the settlement',
      );
      continue;
    }
    let reading: FrozenReading;
    try {
      reading = readObligation(world.ledger, world.accounts, venture);
    } catch (e) {
      faults.push(e instanceof Error ? e.message : String(e));
      continue;
    }
    live.push({ ...o, reading });
    faults.push(...readingFaults(o, reading));
  }

  // The belt-and-braces half. The field list above is what an operator reads; this is
  // what catches a field the list forgot, and a frozen set that was edited in place.
  const recomputed = hashFrozenInputs({
    reckoning: frozen.reckoning,
    frozenAtTick: frozen.frozenAtTick,
    settlementTick: frozen.settlementTick,
    stateVersion: frozen.stateVersion,
    obligations: live,
  });
  if (recomputed !== frozen.inputsHash) {
    faults.push(
      `the settlement inputs no longer hash to what the freeze recorded (${frozen.inputsHash.slice(0, 12)} ` +
        `vs ${recomputed.slice(0, 12)}); something moved between the freeze and the settlement, so halt ` +
        'rather than settle against a world the parties never saw',
    );
  }
  return faults;
}

function readingFaults(o: FrozenObligation, live: FrozenReading): readonly string[] {
  const faults: string[] = [];
  const say = (what: string, was: string | number | null, now: string | number | null): void => {
    faults.push(
      `${o.venture}: ${what} was ${String(was)} at the freeze and is ${String(now)} at settlement`,
    );
  };

  // INV-19, the clause §15.4 lists second among its five defences. The captured copy
  // against the live row — never the row against itself, which is the check that
  // cannot fail.
  if (o.reading.actedOnStateVersion !== live.actedOnStateVersion) {
    faults.push(
      `INV-19: ${o.venture} was frozen against acted_on_state_version ` +
        `${o.reading.actedOnStateVersion} and its row now says ${live.actedOnStateVersion}; the pinned ` +
        'version was rewritten between the freeze and the settlement',
    );
  }
  // E2E-14. `terms_hash` pins the valuation rule *and* its as-of tick, so a valuation
  // that moved after the countersignature shows up here as a different hash.
  if (o.reading.termsHash !== live.termsHash) {
    faults.push(
      `${o.venture}: terms_hash was ${o.reading.termsHash.slice(0, 12)} at the freeze and the row now ` +
        `hashes to ${live.termsHash.slice(0, 12)}; the pinned valuation rule or a role's terms were edited ` +
        'after signing, and the settlement must match what the parties agreed and not the new price',
    );
  }
  if (o.reading.state !== live.state) say('state', o.reading.state, live.state);
  if (o.reading.deferrals !== live.deferrals) {
    say('deferrals', o.reading.deferrals, live.deferrals);
  }
  if (o.reading.escrowExecutedAtTick !== live.escrowExecutedAtTick) {
    say('escrowExecutedAtTick', o.reading.escrowExecutedAtTick, live.escrowExecutedAtTick);
  }
  // E2E-12, and the whole reason the freeze is hard. §15.4: "I commit to pay from
  // account X; during the window my convoy is raided and X is drained; my 'default' is
  // your bug, permanently attached to my name."
  if (o.reading.escrowFreeMinor !== live.escrowFreeMinor) {
    faults.push(
      `${o.venture}: escrow ${o.reading.escrow} held ${o.reading.escrowFreeMinor} at the freeze and holds ` +
        `${live.escrowFreeMinor} at settlement (${live.escrowFreeMinor - o.reading.escrowFreeMinor}); ` +
        'settling against the new figure would record a shortfall nobody in this Reckoning caused',
    );
  }
  if (o.reading.payerFreeMinor !== live.payerFreeMinor) {
    faults.push(
      `${o.venture}: the payer's stores ${o.reading.payerStores} held ${o.reading.payerFreeMinor} at the ` +
        `freeze and hold ${live.payerFreeMinor} at settlement ` +
        `(${live.payerFreeMinor - o.reading.payerFreeMinor}); settling against the new figure would ` +
        'record a broken promise the payer could have kept',
    );
  }
  if (o.reading.holders.length !== live.holders.length) {
    say('role count', o.reading.holders.length, live.holders.length);
  } else {
    for (const [index, was] of o.reading.holders.entries()) {
      const now = live.holders[index] ?? null;
      if (was !== now) say(`role ${index}'s holder`, was, now);
    }
  }
  return faults;
}

// ── Projections the invariant pass needs ─────────────────────────────────────

/**
 * INV-18's input.
 *
 * `settlementSeqFrom` is the `seqInTick` at which the settlement's **own** events
 * begin, and it is captured immediately before the first receipt is appended rather
 * than at the freeze: with `FREEZE_TICKS === 1` the freeze and the settlement share a
 * tick, so the sequence within it is the only thing separating "the settlement touched
 * the set" from "somebody else did".
 */
export function settlementSetOf(
  frozen: FrozenReckoning,
  settlementSeqFrom: number,
): SettlementSet {
  return {
    reckoningIndex: frozen.reckoning,
    frozenAtTick: frozen.frozenAtTick,
    settlementTick: frozen.settlementTick,
    settlementSeqFrom,
    objects: frozen.objects,
    inputsHash: frozen.inputsHash,
    stateVersion: frozen.stateVersion,
  };
}

/**
 * INV-19's input, and the one place a cross-module reading has to be stated.
 *
 * `src/invariants/promises.ts` names the two sides `pinnedStateVersion` ("as pinned at
 * countersignature") and `observedStateVersion` ("the state version the settlement is
 * resolving from"). Taken literally, the second would be the engine's live counter —
 * and `SettleInput.actedOnStateVersion`'s own doc explains at length why that reading
 * halts a healthy world: the counter moves on every applied action, so **every**
 * venture that outlives its activation tick would fail the comparison, and a false
 * halt is the same class of bug as a false default (§15.4).
 *
 * So the pair this function supplies is the one the settlement module specifies: the
 * copy the freeze captured against the live row. That makes INV-19 a real comparison
 * with a real failure mode — the row was rewritten between the freeze and the
 * settlement — and leaves the "did the world move at all" question to the freeze plus
 * INV-18, which is where §15.4 puts it.
 */
export function settlementItemsOf(
  frozen: FrozenReckoning,
  book: VentureBook,
): readonly SettlementItem[] {
  return frozen.obligations.map((o) => {
    const venture = book.get(o.venture);
    return {
      obligation: o.venture,
      pinnedStateVersion: o.reading.actedOnStateVersion,
      observedStateVersion: venture?.actedOnStateVersion ?? -1,
      pinnedTermsHash: o.reading.termsHash,
      observedTermsHash: venture === undefined ? null : termsHashOf(venture),
    };
  });
}

/** Every party to the Reckoning, in canonical order. The seal witness's coverage. */
export function partiesOfReckoning(frozen: FrozenReckoning): readonly PrincipalId[] {
  const out = new Set<PrincipalId>();
  for (const o of frozen.obligations) {
    out.add(o.payer);
    for (const holder of o.reading.holders) {
      if (holder !== null) out.add(holder);
    }
  }
  return [...out].sort(compareIds);
}
