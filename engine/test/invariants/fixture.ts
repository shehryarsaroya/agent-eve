/**
 * The shared fixture for the invariant-surface suite.
 *
 * Deliberately built from the **real** modules — a real `Ledger`, a real
 * `EventLedger`, a real `WorldState` — because the thing under test is whether one
 * pass over all 26 invariants actually reaches them. A fixture of stubs would prove
 * the aggregate calls something.
 *
 * No clock and no unseeded draw: event ids are strings the test chooses, which is
 * also how replay works (DET-3).
 */

import type {
  AccountId,
  EventId,
  GoodId,
  Grant,
  GrantId,
  PrincipalId,
  Standing,
  VentureId,
} from '../../src/core/types.js';
import { minor, type Minor } from '../../src/core/units.js';
import { EventLedger, type NewEvent } from '../../src/events/ledger.js';
import type { Visibility } from '../../src/core/types.js';
import type { AudienceAdmission } from '../../src/events/visibility.js';
import {
  CURRENCY_FAUCET,
  Ledger,
  SimpleObligationBook,
  escrowAccount,
  openStores,
  openVentureEscrow,
  storesAccount,
} from '../../src/ledger/index.js';
import { createWorld, enroll, launchMap, type WorldState } from '../../src/world/index.js';

export const ALICE = 'alice' as PrincipalId;
export const BOB = 'bob' as PrincipalId;
export const CARA = 'cara' as PrincipalId;
export const PRINCIPALS: readonly PrincipalId[] = [ALICE, BOB, CARA];

export const ORE = 'ore' as GoodId;
export const HAUL = 'venture-haul-1' as VentureId;

export const A_STORES: AccountId = storesAccount(ALICE);
export const B_STORES: AccountId = storesAccount(BOB);
export const C_STORES: AccountId = storesAccount(CARA);
export const HAUL_ESCROW: AccountId = escrowAccount(HAUL, ALICE);

export function ev(name: string): EventId {
  return name as EventId;
}

export interface Fixture {
  readonly ledger: Ledger;
  readonly obligations: SimpleObligationBook;
  readonly events: EventLedger;
  readonly presence: WorldState;
}

/** Three funded principals, one venture escrow, three seated holdings. */
export function fixture(): Fixture {
  const ledger = new Ledger();
  for (const p of PRINCIPALS) openStores(ledger, p);
  openVentureEscrow(ledger, HAUL, ALICE);
  for (const p of PRINCIPALS) {
    ledger.issueCurrency({
      eventId: ev(`fund:${p}`),
      tick: 0,
      faucet: CURRENCY_FAUCET.STARTER_STAKE,
      to: storesAccount(p),
      amount: minor(100_000),
    });
  }

  const presence = createWorld(launchMap());
  for (const p of PRINCIPALS) enroll(presence, p, `${p}'s holding`, 0);

  const events = new EventLedger();
  return { ledger, obligations: new SimpleObligationBook(), events, presence };
}

export interface EventOptions {
  readonly tick: number;
  readonly kind: string;
  readonly actor?: PrincipalId;
  readonly parent?: EventId;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly rulesVersion?: number;
}

/** A PUBLIC event: `isPublic` true, declassified at birth, no audience rows. */
export function publicEvent(events: EventLedger, options: EventOptions): EventId {
  const draft: NewEvent = {
    tick: options.tick,
    kind: options.kind,
    rulesVersion: options.rulesVersion ?? 1,
    actorPrincipalId: options.actor ?? null,
    onBehalfOfPrincipalId: null,
    grantId: null,
    eventFamilyId: options.kind,
    parentEventId: options.parent ?? null,
    isPublic: true,
    publicAt: options.tick,
    declassifyAt: options.tick,
    provenanceClass: 'FACT',
    actedOnStateVersion: options.tick,
    decisionSource: 'HEURISTIC',
    payload: options.payload ?? {},
    visibility: 'PUBLIC',
    audience: [],
  };
  return events.append(draft).event.id;
}

/** A tier that carries audience rows, for the fan-out and monotonicity checks. */
export function tieredEvent(
  events: EventLedger,
  visibility: Extract<Visibility, 'PARTIES' | 'SENSED'>,
  options: EventOptions & { readonly declassifyAt: number; readonly audience: readonly AudienceAdmission[] },
): EventId {
  const draft: NewEvent = {
    tick: options.tick,
    kind: options.kind,
    rulesVersion: options.rulesVersion ?? 1,
    actorPrincipalId: options.actor ?? null,
    onBehalfOfPrincipalId: null,
    grantId: null,
    eventFamilyId: options.kind,
    parentEventId: options.parent ?? null,
    isPublic: false,
    publicAt: options.declassifyAt,
    declassifyAt: options.declassifyAt,
    provenanceClass: 'FACT',
    actedOnStateVersion: options.tick,
    decisionSource: 'HEURISTIC',
    payload: options.payload ?? {},
    visibility,
    audience: options.audience,
  };
  return events.append(draft).event.id;
}

export function grant(overrides: Partial<Grant> = {}): Grant {
  return {
    id: 'grant:1' as GrantId,
    grantor: ALICE,
    delegate: BOB,
    template: 'treasury',
    maxDirectLoss: minor(10_000),
    maxContingentLiability: minor(20_000),
    spentDirect: minor(0),
    spentContingent: minor(0),
    verbs: ['create', 'elect'],
    clearance: [],
    expiresTick: 10_000,
    revokedAtTick: null,
    ...overrides,
  };
}

export function standing(principal: PrincipalId, overrides: Partial<Standing> = {}): Standing {
  return {
    principal,
    electiveHonoured: 0,
    electiveHonouredValue: minor(0),
    defaults: 0,
    contradictedSeals: 0,
    distinctCounterparties: 0,
    lastDefaultTick: null,
    ...overrides,
  };
}

export function money(n: number): Minor {
  return minor(n);
}
