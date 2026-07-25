/**
 * Shared venture fixture.
 *
 * Deliberately one fixture for the whole directory, like `test/ledger/fixture.ts`:
 * every test builds the same five principals in the same system, so a failure
 * message means the same thing in all of them.
 *
 * No clock and no unseeded draw anywhere. Event ids are strings the test chooses,
 * which is also how replay works (DET-3).
 */

import { Rng } from '../../src/core/rng.js';
import type {
  AccountId,
  EventId,
  PrincipalId,
  RoleTerms,
  SystemId,
  VentureId,
} from '../../src/core/types.js';
import { minor, type Bps, type Minor } from '../../src/core/units.js';
import {
  CURRENCY_FAUCET,
  DEFAULT_VALUATION_RULE,
  Ledger,
  escrowAccount,
  openStores,
  openVentureEscrow,
  storesAccount,
} from '../../src/ledger/index.js';
import {
  commitHand,
  commonsSystems,
  createWorld,
  enroll,
  handById,
  handsOf,
  launchMap,
  type HandRecord,
  type WorldState,
} from '../../src/world/index.js';
import {
  VentureBook,
  activate,
  countersign,
  createVenture,
  fillRole,
  fullyElectiveShare,
  kindSpec,
  pinnedAt,
  shareTerms,
  signatoriesRequired,
  wageTerms,
  yourTakeAtP50,
  type PinnedValuation,
  type SettlementAccounts,
  type SettlementPresence,
  type VentureRecord,
} from '../../src/venture/index.js';

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

export const RULES_VERSION = 1;
export const STATE_VERSION = 7;
export const STARTING_STORES = minor(1_000_000);

export interface Fixture {
  readonly ledger: Ledger;
  readonly world: WorldState;
  readonly book: VentureBook;
  readonly stage: SystemId;
  readonly valuation: PinnedValuation;
  readonly accounts: SettlementAccounts;
}

export function ev(name: string): EventId {
  return name as EventId;
}

export function vid(name: string): VentureId {
  return name as VentureId;
}

/** Five principals, each with three hands and a funded STORES account. */
export function fixture(startingStores: Minor = STARTING_STORES): Fixture {
  const map = launchMap();
  const world = createWorld(map);
  const ledger = new Ledger();
  const commons = commonsSystems(map);
  const stage = commons[0];
  if (stage === undefined) throw new Error('the launch map has no Commons system');

  for (const principal of CAST) {
    enroll(world, principal, `holding-${principal}`, 0, stage);
    openStores(ledger, principal);
    if (startingStores > 0) {
      ledger.issueCurrency({
        eventId: ev(`fund:${principal}`),
        tick: 0,
        faucet: CURRENCY_FAUCET.STARTER_STAKE,
        to: storesAccount(principal),
        amount: startingStores,
      });
    }
  }

  return {
    ledger,
    world,
    book: new VentureBook(),
    stage,
    valuation: pinnedAt(DEFAULT_VALUATION_RULE, 0),
    accounts: ACCOUNTS,
  };
}

/**
 * The account map every settlement takes. `escrowOf` is a function of the venture, so
 * one map serves a whole batch — see the note on `SettlementAccounts`.
 */
export const ACCOUNTS: SettlementAccounts = {
  escrowOf: (venture) => escrowAccount(venture.id, venture.creator),
  storesOf: (principal) => storesAccount(principal),
};

/**
 * Where a settlement finds the hand rows it must release.
 *
 * A function of the fixture rather than a constant, because hand *state* lives in the
 * world and account ids do not. A resolved venture that does not release presence
 * leaves a `COMMITTED` hand filling no live role, which INV-9 halts on — so a test that
 * asserts `checkInv9` after a settlement has to pass this.
 */
export function presenceOf(f: Fixture): SettlementPresence {
  return { handOf: (id) => f.world.hands.get(id) };
}

/** Kept for call sites that name a single venture; the map is venture-agnostic. */
export function accountsFor(_venture?: VentureId, _creator?: PrincipalId): SettlementAccounts {
  return ACCOUNTS;
}

/** The nth hand of a principal, 1-indexed. Present from tick 0 (enrolled at 0). */
export function handOf(f: Fixture, principal: PrincipalId, ordinal = 1): HandRecord {
  const hands = handsOf(f.world, principal);
  const hand = hands[ordinal - 1];
  if (hand === undefined) throw new Error(`${principal} has no hand ${ordinal}`);
  return hand;
}

export function stores(principal: PrincipalId): AccountId {
  return storesAccount(principal);
}

export function balance(f: Fixture, principal: PrincipalId): Minor {
  return f.ledger.balance(storesAccount(principal));
}

/**
 * A share role priced at `escrowed + elective`. `HAUL`'s floor is 25% of the pinned
 * consideration with an absolute floor of 100, so callers that want the *minimum*
 * legal elective part should use {@link minimalHaulTerms}.
 */
export function share(shareBps: Bps, escrowed: number, elective: number): RoleTerms {
  return shareTerms(shareBps, minor(escrowed), minor(elective));
}

export function wage(escrowed: number, elective: number): RoleTerms {
  return wageTerms(minor(escrowed), minor(elective));
}

export interface HaulOptions {
  readonly id?: VentureId;
  readonly creator?: PrincipalId;
  readonly carrier?: RoleTerms;
  readonly escort?: RoleTerms;
  readonly windowOpensTick?: number;
  readonly windowClosesTick?: number;
  readonly resolvesAtTick?: number;
  readonly preference?: readonly PrincipalId[];
  readonly visibility?: 'PUBLIC' | 'PARTIES';
}

/**
 * The vertical slice's venture: a `HAUL` with `CARRIER` and `ESCORT`, the carrier on
 * a wage and the escort on a share, each part escrowed and part elective.
 */
export function makeHaul(f: Fixture, options: HaulOptions = {}): VentureRecord {
  const id = options.id ?? vid('v-haul-1');
  const creator = options.creator ?? ALICE;
  const result = createVenture({
    id,
    kind: 'HAUL',
    creator,
    stage: f.stage,
    terms: [
      options.carrier ?? wage(1_000, 1_000),
      options.escort ?? share(3_000 as Bps, 500, 700),
    ],
    windowOpensTick: options.windowOpensTick ?? 0,
    windowClosesTick: options.windowClosesTick ?? 100,
    resolvesAtTick: options.resolvesAtTick ?? 200,
    valuation: f.valuation,
    rulesVersion: RULES_VERSION,
    preference: options.preference ?? [],
    visibility: options.visibility ?? 'PUBLIC',
  });
  if (!result.ok) throw new Error(`makeHaul: ${result.invariant} ${result.hint}`);
  return f.book.add(result.value);
}

/**
 * A top-yield venture: four roles, **un-escrowable**, so every role's consideration
 * is fully elective. The shape §7.5 requires of the highest prizes, and the one that
 * PROP-V6's headline claim is about.
 */
export function makeTopYield(
  f: Fixture,
  kind: 'BUILD' | 'SIEGE',
  id: VentureId,
  creator: PrincipalId,
  electivePerRole = 12_000,
): VentureRecord {
  const spec = kindSpec(kind);
  const result = createVenture({
    id,
    kind,
    creator,
    stage: f.stage,
    // 1500 bps each leaves 4000 bps of residual to the creator.
    terms: spec.roles.map(() => fullyElectiveShare(1_500 as Bps, minor(electivePerRole))),
    windowOpensTick: 0,
    windowClosesTick: 100,
    resolvesAtTick: 200,
    valuation: f.valuation,
    rulesVersion: RULES_VERSION,
    preference: [],
    visibility: 'PUBLIC',
  });
  if (!result.ok) throw new Error(`makeTopYield: ${result.invariant} ${result.hint}`);
  return f.book.add(result.value);
}

/**
 * The principal's first hand with no live commitment.
 *
 * A principal has three hands and may hold a role in three concurrent ventures, so a
 * fixture that always reached for hand 1 would trip INV-9 on the second venture and
 * present as a bug in the engine rather than in the fixture.
 */
export function freeHandOf(f: Fixture, principal: PrincipalId): HandRecord {
  for (const hand of handsOf(f.world, principal)) {
    if (f.book.commitmentOf(hand.id) === null) return hand;
  }
  throw new Error(`${principal} has no uncommitted hand left`);
}

/** Fill a role and keep the book's index in step, as the allocator would. */
export function fill(
  f: Fixture,
  venture: VentureRecord,
  roleIndex: number,
  principal: PrincipalId,
  tick = 1,
  ordinal?: number,
): void {
  const hand = ordinal === undefined ? freeHandOf(f, principal) : handOf(f, principal, ordinal);
  const result = fillRole(venture, roleIndex, hand, tick);
  if (!result.ok) throw new Error(`fill: ${result.invariant} ${result.hint}`);
  f.book.indexFill(venture.id, roleIndex, hand.id);
  // The world owns hand state; the venture owns the reference. Going through
  // `commitHand` rather than assigning the field is what keeps INV-9's "a hand in a
  // role is COMMITTED or IN_TRANSIT" true of the fixture as well as of the engine.
  const committed = commitHand(handById(f.world, hand.id));
  if (!committed.ok) throw new Error(`commitHand: ${committed.invariant} ${committed.hint}`);
}

/**
 * Countersign for every required signatory, through the real {@link countersign}
 * path with the server-computed p50 echoed back.
 *
 * Deliberately not a direct write to `countersigned`: the echo check is §7.1's
 * confirmation-of-understanding gate, and a fixture that bypassed it would let every
 * settlement test pass against terms no signer could actually have signed.
 */
export function signAll(f: Fixture, venture: VentureRecord): void {
  const hash = venture.termsHash;
  if (hash === null) throw new Error('venture has no terms_hash');
  for (const principal of signatoriesRequired(venture)) {
    const serverTake = yourTakeAtP50(venture, principal);
    const result = countersign(venture, principal, hash, serverTake, serverTake);
    if (!result.ok) throw new Error(`signAll ${principal}: ${result.invariant} ${result.hint}`);
  }
  void f;
}

/** Fund the venture's escrow with `Σ escrowed`, as signing does. */
export function fundEscrow(f: Fixture, venture: VentureRecord, extra: Minor = minor(0)): AccountId {
  const escrow = escrowAccount(venture.id, venture.creator);
  if (f.ledger.account(escrow) === undefined) {
    openVentureEscrow(f.ledger, venture.id, venture.creator);
  }
  let required = 0;
  for (const role of venture.roles) required += role.terms.escrowed;
  const amount = minor(required + extra);
  if (amount > 0) {
    f.ledger.transferCurrency({
      eventId: ev(`escrow:${venture.id}`),
      tick: 0,
      from: storesAccount(venture.creator),
      to: escrow,
      amount,
    });
  }
  return escrow;
}

/** Deposit realised proceeds into the venture's pot, as the tick loop would. */
export function depositProceeds(f: Fixture, venture: VentureRecord, proceeds: Minor): void {
  if (proceeds <= 0) return;
  f.ledger.transferCurrency({
    eventId: ev(`proceeds:${venture.id}`),
    tick: 1,
    from: storesAccount(venture.creator),
    to: escrowAccount(venture.id, venture.creator),
    amount: proceeds,
  });
}

/**
 * Take a venture all the way to `LIVE`: fill every role from the cast, countersign,
 * fund the escrow, deposit the proceeds.
 *
 * Returns the principals holding each role, in role order, so a test can name them.
 */
export function goLive(
  f: Fixture,
  venture: VentureRecord,
  holders: readonly PrincipalId[],
  proceeds: Minor,
  tick = 1,
): readonly PrincipalId[] {
  for (const [index, principal] of holders.entries()) {
    fill(f, venture, index, principal, tick);
  }
  signAll(f, venture);
  fundEscrow(f, venture);
  const activated = activate(venture, STATE_VERSION, tick);
  if (!activated.ok) throw new Error(`goLive: ${activated.invariant} ${activated.hint}`);
  depositProceeds(f, venture, proceeds);
  return holders;
}

/** A seeded generator for the property tests. Never `Math.random` (DET-7). */
export function rngFor(label: string): Rng {
  return Rng.fromSeed(`test:venture:${label}`);
}

/** An elections map that pays every elective part in full. */
export function payAll(
  venture: VentureRecord,
  claims: readonly { readonly roleIndex: number; readonly electiveDue: Minor }[],
): Map<number, Minor> {
  const out = new Map<number, Minor>();
  for (const c of claims) {
    if (c.electiveDue > 0) out.set(c.roleIndex, c.electiveDue);
  }
  void venture;
  return out;
}
