/**
 * The observation fixture — one named world for the whole directory.
 *
 * `TESTING.md` §16: "Fixtures as named worlds, not ad-hoc setup ... Every scenario
 * test names its fixture, so a fixture change fails loudly everywhere instead of
 * quietly somewhere."
 *
 * Built **on top of `test/venture/fixture.ts`** rather than beside it. That is
 * deliberate: the venture fixture already knows how to make a `HAUL` that reaches
 * `LIVE` through the real `fillRole`, `countersign`, `activate` and escrow-funding
 * paths, and a second way to build a live venture in the same repo is a second set of
 * assumptions about what "live" means. PROP-O5 in particular is only worth anything if
 * the venture it predicts against is one the real settlement code will accept.
 *
 * No clock and no unseeded draw anywhere: `serverNowMs` is a number the test chooses,
 * which is exactly how production supplies it (one read from an injected `Clock`).
 */

import type {
  GoodId,
  Grant,
  GrantId,
  Handle,
  PrincipalId,
  Standing,
  SystemId,
  WorldStatus,
} from '../../src/core/types.js';
import { minor, qty, type Minor, type Qty } from '../../src/core/units.js';
import { storesAccount } from '../../src/ledger/index.js';
import {
  noMarks,
  sensesNothing,
  sensingFromWorld,
  storesReadOf,
  type BallotRef,
  type BookRow,
  type GrantTemplate,
  type LevyBlock,
  type MandateRead,
  type MarkPriceRead,
  type ObserveSources,
  type SensingIndex,
  type TalkRow,
} from '../../src/observe/index.js';
import { CHARGE_GOOD } from '../../src/sovereignty/params.js';
import type { VentureRecord } from '../../src/venture/index.js';
import { ALICE, RULES_VERSION, fixture, type Fixture } from '../venture/fixture.js';

export { ALICE, BRAM, CASS, DOV, ESK, CAST, RULES_VERSION, STATE_VERSION } from '../venture/fixture.js';
export {
  depositProceeds,
  fill,
  freeHandOf,
  fundEscrow,
  goLive,
  handOf,
  makeHaul,
  makeTopYield,
  share,
  signAll,
  vid,
  wage,
  presenceOf,
  ACCOUNTS,
  ev,
} from '../venture/fixture.js';
export { fixture, type Fixture };

/** A wall-clock reading the test chooses. Never `Date.now` (DET-7). */
export const NOW_MS = 1_700_000_000_000;

/**
 * A newcomer's standing: genuine zeros, because a newcomer genuinely has none.
 *
 * Used as the fixture's `standingOf` so `counterparties[]` is populated. The
 * production port may return `null`, and the observation counts that as `NO_RECORD`
 * rather than showing zeros — the distinction is tested, so the fixture needs both.
 */
export function zeroStanding(principal: PrincipalId): Standing {
  return {
    principal,
    electiveHonoured: 0,
    electiveHonouredValue: minor(0),
    defaults: 0,
    contradictedSeals: 0,
    distinctCounterparties: 0,
    lastDefaultTick: null,
  };
}

export interface SourceOptions {
  readonly tick?: number;
  readonly serverNowMs?: number;
  readonly stateVersion?: number;
  readonly status?: WorldStatus;
  readonly ventures?: readonly VentureRecord[];
  readonly grants?: readonly Grant[];
  readonly grantTemplates?: readonly GrantTemplate[];
  readonly actionsRemaining?: number;
  readonly wakesRemaining?: number;
  readonly isWake?: boolean;
  readonly mandate?: MandateRead | null;
  readonly levy?: LevyBlock | null;
  readonly market?: readonly BookRow[];
  readonly talks?: readonly TalkRow[];
  readonly ballots?: readonly BallotRef[];
  readonly sensing?: SensingIndex;
  readonly sealedRoles?: ReadonlySet<string>;
  readonly markPriceOf?: MarkPriceRead;
  readonly standingOf?: (principal: PrincipalId) => Standing | null;
  /** §6.3's Charge, in goods. Defaults to nothing owed — the no-claim case. */
  readonly upkeepOwed?: (principal: PrincipalId) => Qty;
}

/**
 * The sources for one principal at one tick.
 *
 * Defaults are the *live* case: a wake, a running world, a full action budget, the
 * venture book's own ventures, and sensing derived from real presence. A test that
 * wants the awkward case names it.
 */
export function sourcesFor(f: Fixture, options: SourceOptions = {}): ObserveSources {
  const tick = options.tick ?? 1;
  return {
    tick,
    serverNowMs: options.serverNowMs ?? NOW_MS,
    stateVersion: options.stateVersion ?? 7,
    status: options.status ?? 'RUNNING',
    rulesVersion: RULES_VERSION,
    world: f.world,
    stores: storesReadOf(f.ledger),
    markPriceOf: options.markPriceOf ?? noMarks,
    ventures: options.ventures ?? f.book.all(),
    grants: options.grants ?? [],
    grantTemplates: options.grantTemplates ?? [],
    standingOf: options.standingOf ?? zeroStanding,
    handleOf: (principal) => `${principal}@agenttransfer.dev` as Handle,
    actionsRemaining: options.actionsRemaining ?? 4,
    wakesRemaining: options.wakesRemaining ?? 16,
    isWake: options.isWake ?? true,
    mandate: options.mandate ?? { version: 1, text: 'consolidate; honour promises at a loss' },
    levy: options.levy ?? null,
    market: options.market ?? [],
    talks: options.talks ?? [],
    ballots: options.ballots ?? [],
    sensing: options.sensing ?? sensingFromWorld(f.world, tick),
    sealedRoles: options.sealedRoles ?? new Set<string>(),
    // The default is the no-claim case, which is the honest zero. A test about a claimant's upkeep
    // names its own, so a `0` here can never be mistaken for the assertion.
    upkeepOwed: options.upkeepOwed ?? (() => qty(0)),
    upkeepGood: CHARGE_GOOD,
  };
}

/** A world where nothing is sensed. The strictest possible reader (PROP-VI2). */
export function blindSources(f: Fixture, options: SourceOptions = {}): ObserveSources {
  return sourcesFor(f, { ...options, sensing: sensesNothing() });
}

/** A Levy block owing `amount`, deliverable where the fixture seats everyone. */
export function levyOwing(f: Fixture, amount = 5_000): LevyBlock {
  return {
    my_assessment: minor(amount),
    paid: minor(0),
    deliverable_to: f.stage,
    shortfall_if_unpaid: minor(amount),
    ballot: null,
    non_escrowable: minor(Math.trunc(amount / 2)),
  };
}

/** A book row with two bands, priced so a `trade` affordance is affordable. */
export function bookRow(system: SystemId, good: string, ask = 10): BookRow {
  return {
    system,
    good: good as GoodId,
    best_bid: minor(ask - 1),
    best_ask: minor(ask),
    depth: [
      { qty: 10 as never, bid: minor(ask - 1), ask: minor(ask) },
      { qty: 100 as never, bid: minor(ask - 2), ask: minor(ask + 2) },
    ],
  };
}

export function grantFrom(options: {
  readonly id?: string;
  readonly grantor?: PrincipalId;
  readonly delegate: PrincipalId;
  readonly maxDirectLoss?: number;
  readonly maxContingentLiability?: number;
  readonly expiresTick?: number;
  readonly revokedAtTick?: number | null;
}): Grant {
  return {
    id: (options.id ?? 'g-1') as GrantId,
    grantor: options.grantor ?? ALICE,
    delegate: options.delegate,
    template: 'treasury.spend',
    maxDirectLoss: minor(options.maxDirectLoss ?? 50_000),
    maxContingentLiability: minor(options.maxContingentLiability ?? 20_000),
    spentDirect: minor(0),
    spentContingent: minor(0),
    expiresTick: options.expiresTick ?? 500,
    revokedAtTick: options.revokedAtTick ?? null,
  };
}

/** Free currency, for the assertions that care whether an option was affordable. */
export function freeStores(f: Fixture, principal: PrincipalId): Minor {
  return f.ledger.freeBalance(storesAccount(principal));
}

/** Every hand id a principal owns. The exemption list for the sensing check. */
export function ownHandIds(f: Fixture, principal: PrincipalId): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const hand of f.world.hands.values()) {
    if (hand.principal === principal) ids.add(hand.id);
  }
  return ids;
}

/** A fixture with no starting stores, for the `SHORT_FUNDS` paths. */
export function brokeFixture(): Fixture {
  return fixture(minor(0));
}
