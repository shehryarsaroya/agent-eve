/**
 * The shared Reckoning fixture: a whole wired world, because that is what this module
 * is for.
 *
 * Every other module's fixture builds one artifact. This one builds all of them — the
 * ledger, the venture book, the event ledger, the default register, the seal book, the
 * standing table, the obligation book, presence and the halt controller — because the
 * thing under test is precisely the *wiring*, and a fixture that stubbed any one of them
 * would test the driver against a world that cannot fail the way the real one does.
 *
 * No clock and no unseeded draw anywhere (DET-7). Every tick is a literal derived from
 * `core/time.ts`'s own arithmetic, so a change to `TICKS_PER_RECKONING` moves the tests
 * with it rather than silently making them settle on a non-settlement tick.
 */

import { canonicalHash } from '../../src/core/canonical.js';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import type {
  AccountId,
  EventId,
  PrincipalId,
  RoleTerms,
  SystemId,
  VentureId,
} from '../../src/core/types.js';
import { bps, minor, type Bps, type Minor } from '../../src/core/units.js';
import { EventLedger, type NewEvent } from '../../src/events/index.js';
import {
  CURRENCY_FAUCET,
  DEFAULT_VALUATION_RULE,
  Ledger,
  SimpleObligationBook,
  escrowAccount,
  openStores,
  openVentureEscrow,
  storesAccount,
} from '../../src/ledger/index.js';
import {
  DefaultRegister,
  HaltController,
  freezeTriple,
  type TickInputs,
} from '../../src/invariants/index.js';
import { SealBook, sealWorldIndex, type Deed, type SealIntent } from '../../src/seal/index.js';
import {
  VentureBook,
  activate,
  countersign,
  createVenture,
  fillRole,
  pinnedAt,
  shareTerms,
  signatoriesRequired,
  wageTerms,
  yourTakeAtP50,
  type Election,
  type ResolutionKind,
  type VentureRecord,
} from '../../src/venture/index.js';
import {
  commitHand,
  commonsSystems,
  createWorld,
  enroll,
  handsOf,
  launchMap,
  type HandRecord,
  type WorldState,
} from '../../src/world/index.js';
import {
  freezeReckoning,
  runReckoningBatch,
  StandingBook,
  type FrozenReckoning,
  type ObligationPlan,
  type ReckoningOutcome,
  type ReckoningWorld,
} from '../../src/reckoning/index.js';

export const RULES_VERSION = 1;
/**
 * The Reckoning these tests settle.
 *
 * The FREEZE tick and the SETTLEMENT tick are different ticks, and the gap between
 * them is the whole point: SPEC §5.1 puts the freeze "last tick *before* settlement",
 * and INV-18 ranges over that interval. `core/time.ts` originally made both predicates
 * true at phase 287, so the interval was empty and these fixtures froze at 287 without
 * complaint. The driver's own guard was correct the whole time — "the settlement set is
 * computed at the freeze and nowhere else" — it was simply unsatisfiable.
 */
export const RECKONING = 0;
export const SETTLE_TICK = TICKS_PER_RECKONING - 1;
/** Where the settlement set is computed and its inputs hashed. One tick earlier. */
export const FREEZE_TICK = SETTLE_TICK - 1;
export const FORM_TICK = 1;
export const STARTING_STORES = minor(1_000_000);

export const CAST: readonly PrincipalId[] = Object.freeze([
  'p-alice',
  'p-bram',
  'p-cass',
  'p-dov',
  'p-esk',
] as PrincipalId[]);

export const [ALICE, BRAM, CASS, DOV, ESK] = CAST as readonly [
  PrincipalId,
  PrincipalId,
  PrincipalId,
  PrincipalId,
  PrincipalId,
];

export interface Fix {
  readonly ledger: Ledger;
  readonly world: WorldState;
  readonly book: VentureBook;
  readonly events: EventLedger;
  readonly register: DefaultRegister;
  readonly seals: SealBook;
  readonly standing: StandingBook;
  readonly obligations: SimpleObligationBook;
  readonly controller: HaltController;
  readonly stage: SystemId;
  readonly reckoningWorld: ReckoningWorld;
  /** The engine's state version. Monotonic, injected — never a clock (DET-7). */
  bump(): number;
  version(): number;
}

export function ev(name: string): EventId {
  return name as EventId;
}

export function vid(name: string): VentureId {
  return name as VentureId;
}

export function stores(principal: PrincipalId): AccountId {
  return storesAccount(principal);
}

export function balance(f: Fix, principal: PrincipalId): Minor {
  return f.ledger.balance(storesAccount(principal));
}

export function share(shareBps: Bps, escrowed: number, elective: number): RoleTerms {
  return shareTerms(shareBps, minor(escrowed), minor(elective));
}

export function wage(escrowed: number, elective: number): RoleTerms {
  return wageTerms(minor(escrowed), minor(elective));
}

/** Five principals, three hands each, funded stores, and every book the driver needs. */
export function fixture(startingStores: Minor = STARTING_STORES): Fix {
  const map = launchMap();
  const world = createWorld(map);
  const ledger = new Ledger();
  const events = new EventLedger();
  const stage = commonsSystems(map)[0];
  if (stage === undefined) throw new Error('the launch map has no Commons system');

  const standing = new StandingBook();
  for (const principal of CAST) {
    enroll(world, principal, `holding::${principal}`, 0, stage);
    openStores(ledger, principal);
    standing.open(principal);
    if (startingStores > 0) {
      ledger.issueCurrency({
        eventId: ev(`fund::${principal}`),
        tick: 0,
        faucet: CURRENCY_FAUCET.STARTER_STAKE,
        to: storesAccount(principal),
        amount: startingStores,
      });
    }
  }

  const book = new VentureBook();
  // Attached in production, so `target` and `measure` are checked at the door and a
  // formatting slip costs one action instead of a permanent public mark (scar #8).
  const seals = new SealBook(
    sealWorldIndex([...CAST, stage, ...KNOWN_VENTURE_IDS], (verb) =>
      verb === 'haul' ? 'MINOR' : null,
    ),
  );

  // One register and one obligation book, shared between the fixture's own handles and
  // the driver's world, so a test that inspects `f.register` sees exactly what the driver
  // wrote rather than a parallel copy.
  const register = new DefaultRegister();
  const obligations = new SimpleObligationBook();
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

  let version = 0;
  return {
    ledger,
    world,
    book,
    events,
    register,
    seals,
    standing,
    obligations,
    controller: new HaltController({
      startTick: -1,
      startStateHash: canonicalHash({ world: 'reckoning:start' }),
      resumeKeys: new Map(),
    }),
    stage,
    reckoningWorld,
    bump: () => {
      version += 1;
      return version;
    },
    version: () => version,
  };
}

/**
 * Venture ids the seal world index knows about.
 *
 * A seal whose target names nothing is refused at commit, so the ids a test may seal
 * against have to exist in the index before the venture does. Listed rather than derived
 * because the index is built once, at enrolment, exactly as production would build it.
 */
const KNOWN_VENTURE_IDS: readonly VentureId[] = Object.freeze([
  'v-haul-1',
  'v-a',
  'v-b',
  'v-c',
  'v-d',
] as VentureId[]);

export interface HaulOptions {
  readonly id?: VentureId;
  readonly creator?: PrincipalId;
  readonly carrier?: RoleTerms;
  readonly escort?: RoleTerms;
  readonly resolvesAtTick?: number;
  /** For a venture that belongs to a later Reckoning (E2E-15's second court). */
  readonly windowOpensTick?: number;
}

/** The vertical slice's venture: a `HAUL` with a wage `CARRIER` and a share `ESCORT`. */
export function makeHaul(f: Fix, options: HaulOptions = {}): VentureRecord {
  const opens = options.windowOpensTick ?? FORM_TICK;
  const created = createVenture({
    id: options.id ?? vid('v-haul-1'),
    kind: 'HAUL',
    creator: options.creator ?? ALICE,
    stage: f.stage,
    terms: [options.carrier ?? wage(800, 400), options.escort ?? share(bps(3_000), 500, 900)],
    windowOpensTick: opens,
    windowClosesTick: opens + 8,
    resolvesAtTick: options.resolvesAtTick ?? SETTLE_TICK,
    valuation: pinnedAt(DEFAULT_VALUATION_RULE, FORM_TICK),
    rulesVersion: RULES_VERSION,
    visibility: 'PUBLIC',
    preference: [],
  });
  if (!created.ok) throw new Error(`makeHaul: ${created.invariant} ${created.hint}`);
  return f.book.add(created.value);
}

/** Take a venture to LIVE: fill, countersign, fund the escrow, realise the proceeds. */
export function goLive(
  f: Fix,
  venture: VentureRecord,
  holders: readonly PrincipalId[],
  proceeds: Minor,
  atTick = FORM_TICK,
): void {
  for (const [index, principal] of holders.entries()) {
    const hand = freeHand(f, principal);
    const filled = fillRole(venture, index, hand, atTick);
    if (!filled.ok) throw new Error(`goLive fill: ${filled.invariant} ${filled.hint}`);
    f.book.indexFill(venture.id, index, hand.id);
    const committed = commitHand(hand);
    if (!committed.ok) throw new Error(`goLive commit: ${committed.invariant} ${committed.hint}`);
  }

  const hash = venture.termsHash;
  if (hash === null) throw new Error('venture has no terms_hash');
  for (const principal of signatoriesRequired(venture)) {
    const take = yourTakeAtP50(venture, principal);
    const signed = countersign(venture, principal, hash, take, take);
    if (!signed.ok) throw new Error(`goLive sign: ${signed.invariant} ${signed.hint}`);
  }

  fundEscrow(f, venture, atTick);
  const live = activate(venture, f.bump(), atTick);
  if (!live.ok) throw new Error(`goLive activate: ${live.invariant} ${live.hint}`);
  f.obligations.open(venture.id, false);
  if (proceeds > 0) realiseProceeds(f, venture, proceeds, atTick);
}

export function fundEscrow(f: Fix, venture: VentureRecord, atTick = FORM_TICK): AccountId {
  const escrow = escrowAccount(venture.id, venture.creator);
  if (f.ledger.account(escrow) === undefined) {
    openVentureEscrow(f.ledger, venture.id, venture.creator);
  }
  let required = 0;
  for (const role of venture.roles) required += role.terms.escrowed;
  if (required > 0) {
    f.ledger.transferCurrency({
      eventId: ev(`escrow::${venture.id}::${String(atTick)}`),
      tick: atTick,
      from: storesAccount(venture.creator),
      to: escrow,
      amount: minor(required),
    });
  }
  return escrow;
}

/**
 * The venture realised value. Issued from the civic-procurement faucet (§10.1's demand
 * side) rather than moved out of the creator's stores, so a test's arithmetic about what
 * the payer can afford is not quietly entangled with what the venture produced.
 */
export function realiseProceeds(
  f: Fix,
  venture: VentureRecord,
  proceeds: Minor,
  atTick = FORM_TICK,
): void {
  f.ledger.issueCurrency({
    eventId: appendPublic(f, {
      tick: atTick,
      kind: 'venture.proceeds_realised',
      actor: venture.creator,
      payload: { venture: venture.id, amountMinor: proceeds },
    }),
    tick: atTick,
    faucet: CURRENCY_FAUCET.CIVIC_PROCUREMENT,
    to: escrowAccount(venture.id, venture.creator),
    amount: proceeds,
  });
}

export function freeHand(f: Fix, principal: PrincipalId): HandRecord {
  for (const hand of handsOf(f.world, principal)) {
    if (f.book.commitmentOf(hand.id) === null) return hand;
  }
  throw new Error(`${principal} has no uncommitted hand left`);
}

export interface PlanOptions {
  readonly outcome?: ResolutionKind;
  readonly proceeds: Minor;
  readonly elections?: ReadonlyMap<number, Election>;
  readonly causeEventId?: EventId | null;
}

export function planFor(venture: VentureRecord, options: PlanOptions): ObligationPlan {
  return {
    venture: venture.id,
    outcome: options.outcome ?? 'FULFILLED',
    proceeds: options.proceeds,
    elections: options.elections ?? new Map<number, Election>(),
    causeEventId: options.causeEventId ?? null,
  };
}

export function freeze(f: Fix, plans: readonly ObligationPlan[], tick = FREEZE_TICK): FrozenReckoning {
  return freezeReckoning({
    tick,
    stateVersion: f.bump(),
    ledger: f.ledger,
    book: f.book,
    accounts: f.reckoningWorld.accounts,
    plans,
  });
}

export interface RunOptions {
  readonly deeds?: readonly Deed[];
  readonly deedTally?: readonly (readonly [PrincipalId, number])[];
  readonly disableFreeze?: true;
}

export function run(f: Fix, frozen: FrozenReckoning, options: RunOptions = {}): ReckoningOutcome {
  return runReckoningBatch({
    world: f.reckoningWorld,
    frozen,
    rulesVersion: RULES_VERSION,
    controller: f.controller,
    inputs: tickInputs(frozen.settlementTick),
    deeds: options.deeds ?? [],
    deedTally: options.deedTally ?? [],
    ...(options.disableFreeze === true ? { disableFreeze: true as const } : {}),
  });
}

export function tickInputs(tick: number): TickInputs {
  return freezeTriple({
    tick,
    snapshot: { tick: tick - 1 },
    actionLog: [],
    seed: `test::reckoning::${String(tick)}`,
  });
}

/** A raid. `seizeCurrency` takes locked value too: a lock is a claim, never a shield. */
export function drain(
  f: Fix,
  args: { readonly from: AccountId; readonly tick: number; readonly venture: VentureId },
): EventId {
  const amount = f.ledger.balance(args.from);
  const eventId = appendPublic(f, {
    tick: args.tick,
    kind: 'raid.struck',
    actor: CASS,
    payload: { venture: args.venture, target: args.from, takeMinor: amount },
  });
  if (amount > 0) {
    f.ledger.seizeCurrency({
      eventId: `${eventId}#take` as EventId,
      tick: args.tick,
      from: args.from,
      to: storesAccount(CASS),
      amount,
    });
  }
  return eventId;
}

export interface DraftOptions {
  readonly tick: number;
  readonly kind: string;
  readonly actor: PrincipalId;
  readonly payload: Readonly<Record<string, unknown>>;
}

export function appendPublic(f: Fix, draft: DraftOptions): EventId {
  const event: NewEvent = {
    tick: draft.tick,
    kind: draft.kind,
    rulesVersion: RULES_VERSION,
    actorPrincipalId: draft.actor,
    onBehalfOfPrincipalId: null,
    grantId: null,
    eventFamilyId: `test::${draft.kind}`,
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
  return f.events.append(event).event.id;
}

/** Commit a seal for a role the principal actually holds, at `FORM_TICK`. */
export function sealFor(
  f: Fix,
  principal: PrincipalId,
  intent: SealIntent,
  role: { readonly venture: VentureId; readonly roleIndex: number } | null,
  tick = FORM_TICK,
): void {
  const result = f.seals.commit({
    principal,
    tick,
    actedOnStateVersion: f.version(),
    stateVersion: f.version(),
    intent,
    prose: 'said out loud, never judged',
    role,
    rolesHeld: role === null ? [] : [role],
  });
  if (!result.ok) throw new Error(`sealFor: ${result.invariant} ${result.hint}`);
}

export function haulDeed(args: {
  readonly principal: PrincipalId;
  readonly venture: VentureId;
  readonly outcome: number;
  readonly tick: number;
  readonly valuedAtStateVersion: number;
  readonly eventId: EventId;
}): Deed {
  return {
    principal: args.principal,
    tick: args.tick,
    verb: 'haul',
    target: args.venture,
    measure: 'MINOR',
    outcome: args.outcome,
    valuedAtStateVersion: args.valuedAtStateVersion,
    eventId: args.eventId,
  };
}
