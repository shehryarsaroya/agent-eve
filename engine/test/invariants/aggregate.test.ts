/**
 * INV-1 … INV-26 through the one aggregate pass, and **every one of them made to
 * fire**.
 *
 * Wave 1's verifier found that INV-2 and INV-7 had nine call sites between them and
 * no test that either had ever fired. A check that has never been seen to fire is a
 * comment: it reads like a guarantee and it is a hope. So the shape of every test
 * below is the same — break exactly one thing, assert the aggregate reports exactly
 * that id, and assert the healthy world reports nothing.
 *
 * ## Three invariants are *structurally unreachable* through the aggregate, and that
 * is a feature
 *
 * INV-11 (dense seq), INV-12 (a cause after its effect) and INV-15 (a bad
 * rules_version) cannot be violated through `EventLedger.append`: the ledger mints
 * seq itself, refuses a parent it has not seen, and rejects a nonsense version. That
 * is exactly what wave 1's events module says it built on purpose — "a detector that
 * can only be exercised by a bug it also prevents is a detector nobody has ever seen
 * fire", so its checks are pure functions over hand-built records.
 *
 * For those three, the test does two things instead of one: it fires the underlying
 * pure check with a hand-built record, and it asserts the aggregate lists the id as
 * `checked` when an event ledger is present. Together those are the whole claim the
 * registry makes — the check bites, and this pass reaches it. Pretending a
 * happy-path `[]` was a test would be the flattering version.
 */

import { describe, expect, it } from 'vitest';
import { canonicalHash } from '../../src/core/canonical.js';
import { TICKS_PER_RECKONING, reckoningIndex } from '../../src/core/time.js';
import type { EventId, GameEvent, InvariantViolation, PrincipalId } from '../../src/core/types.js';
import { minor, qty } from '../../src/core/units.js';
import { EventLedger } from '../../src/events/ledger.js';
import {
  causalityViolations,
  fanOutViolations,
  recordIntegrityViolations,
  seqDensityViolations,
} from '../../src/events/invariants.js';
import type { EventRecord } from '../../src/events/visibility.js';
import { MAX_DELEGATION_DEPTH } from '../../src/identity/vc.js';
import { GOODS_FAUCET, payByPriority, type Claim } from '../../src/ledger/index.js';
import { SealBook } from '../../src/seal/book.js';
import {
  DefaultRegister,
  InvariantHalt,
  assertInvariants,
  checkInvariants,
  type InvariantInputs,
} from '../../src/invariants/index.js';
import {
  A_STORES,
  ALICE,
  BOB,
  B_STORES,
  CARA,
  ev,
  fixture,
  grant,
  HAUL,
  HAUL_ESCROW,
  money,
  ORE,
  PRINCIPALS,
  publicEvent,
  standing,
  tieredEvent,
  type Fixture,
} from './fixture.js';

/** Ids reported at HALT severity, deduplicated. */
function fired(violations: readonly InvariantViolation[]): readonly string[] {
  return [...new Set(violations.filter((v) => v.severity === 'HALT').map((v) => v.id))].sort(
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
}

/** The whole world, healthy, with every group's inputs supplied. */
function healthy(f: Fixture): InvariantInputs {
  return {
    ledger: f.ledger,
    obligations: f.obligations,
    events: f.events,
    eventScope: 'TICK',
    defaults: new DefaultRegister(),
    presence: f.presence,
    roleFills: new Map(),
    standings: PRINCIPALS.map((p) => standing(p)),
    standingChanges: [],
    grants: [grant()],
    grantSpends: [],
    // ★ INV-22's release clause (`RULES_VERSION` 26), supplied empty for exactly the reason the
    // custody note below gives — and this test is what caught it: `requireAll` escalated the
    // "no release journal supplied" skip to a HALT the moment the clause existed, which is the
    // anti-flattery mechanism working on the same day the clause landed.
    grantReleases: [],
    // Supplied, and EMPTY is the point: INV-22's custody clause reports a named skip when the
    // dossier table is absent, and `requireAll` escalates every skip to a HALT — correctly, since
    // the tick loop has no excuse for missing inputs. An empty table is an honest "nothing has
    // been cut", which is what a healthy world with grants and no disclosures looks like.
    custody: [],
    deals: [],
    settlements: [],
    settlementItems: [],
  };
}

describe('the aggregate pass is silent on a healthy world', () => {
  it('reports no violation, and says which invariants it did not reach', () => {
    const f = fixture();
    publicEvent(f.events, { tick: 1, kind: 'NOTHING_HAPPENED', actor: ALICE });
    const report = checkInvariants(healthy(f), 1);
    expect(report.violations).toEqual([]);
    // The honesty clause: an empty violation list is only meaningful next to the
    // list of checks that could not run.
    expect(report.skipped.map((s) => s.id)).toContain('INV-20');
    expect(report.checked).toContain('INV-1');
    expect(report.checked).toContain('INV-17');
  });

  it('turns every skip into a HALT under requireAll, because the tick loop has no excuse', () => {
    const f = fixture();
    const report = checkInvariants({ ledger: f.ledger, requireAll: true }, 1);
    const ids = fired(report.violations);
    // Everything the bare ledger cannot answer must be reported, not assumed.
    expect(ids).toContain('INV-8');
    expect(ids).toContain('INV-20');
    expect(ids).toContain('INV-25');
    expect(ids).toContain('INV-4');
  });

  it('requireAll on a fully-supplied healthy world PASSES — or the switch can never be turned on', () => {
    // The test that was missing, and the defect it found. `requireAll` escalated every
    // skip, including INV-16's database half, which no caller can supply in-process. So
    // a healthy world with every single input filled in still produced a HALT, the tick
    // loop could never set `requireAllInvariants: true`, and the anti-flattery
    // mechanism was permanently off. The remaining skip is still *reported* — it is
    // just not an outage.
    const f = fixture();
    publicEvent(f.events, { tick: 1, kind: 'NOTHING_HAPPENED', actor: ALICE });
    const book = new SealBook();
    const report = checkInvariants(
      {
        ...healthy(f),
        servedExposure: new Map(),
        sealBook: book,
        standingDiffs: [],
        settlementSet: {
          reckoningIndex: 0,
          frozenAtTick: 1,
          settlementTick: 1,
          settlementSeqFrom: 0,
          objects: new Set(),
          inputsHash: 'deadbeef',
          stateVersion: 1,
        },
        levy: {
          totals: new Map(),
          assessments: [],
          floorEligible: new Set(),
          nominalRate: minor(50),
          seizureQueue: [],
        },
        docket: [{ reckoningIndex: 0, kind: 'LEVY', principals: [...PRINCIPALS] }],
        principals: [...PRINCIPALS],
        atReckoning: 0,
        capped: [{ label: 'observation', value: { hands: [] }, caps: [{ path: 'hands', max: 3 }] }],
        requireAll: true,
      },
      1,
    );
    expect(report.violations).toEqual([]);
    // Reported, not escalated: an operator still sees that the DB half did not run.
    expect(report.skipped.map((s) => s.id)).toEqual(['INV-16']);
    expect(report.skipped[0]?.outOfProcess).toBe(true);
  });

  it('assertInvariants throws InvariantHalt carrying the whole report', () => {
    const f = fixture();
    f.obligations.open(HAUL, true);
    let caught: unknown;
    try {
      assertInvariants({ ledger: f.ledger, obligations: f.obligations }, 3);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvariantHalt);
    const halt = caught as InvariantHalt;
    expect(fired(halt.report.violations)).toContain('INV-4');
    expect(halt.report.tick).toBe(3);
  });
});

// ── value: INV-1 .. INV-7 ───────────────────────────────────────────────────

describe('the value group fires', () => {
  it('INV-1 — a batch whose postings do not sum to zero', () => {
    const f = fixture();
    // Reach past the convenience ops to the raw door, exactly as a buggy handler
    // would: two credits and no debit.
    expect(() =>
      f.ledger.apply({
        eventId: ev('lopsided'),
        tick: 1,
        kind: 'TRANSFER',
        postings: [
          { account: A_STORES, good: null, amountMinor: money(100), amountQty: null },
          { account: B_STORES, good: null, amountMinor: money(100), amountQty: null },
        ],
        supply: null,
        opens: [],
        deltas: [],
      }),
    ).toThrow(/INV-1/);
    // The write path refuses it, so the aggregate can only see it if the mirror is
    // corrupted directly — which is INV-7's test. What matters here is that INV-1
    // is reached on every batch the ledger has ever applied.
    const report = checkInvariants({ ledger: f.ledger }, 1);
    expect(report.checked).toContain('INV-1');
  });

  it('INV-2 — supply conservation, broken by tampering with a faucet accumulator', () => {
    const f = fixture();
    const faucet = f.ledger.requireAccount('faucet:starter_stake' as never);
    faucet.balanceMinor = money(faucet.balanceMinor - 1);
    expect(fired(checkInvariants({ ledger: f.ledger }, 1).violations)).toContain('INV-2');
  });

  it('INV-3 — a negative balance on a world account', () => {
    const f = fixture();
    const stores = f.ledger.requireAccount(A_STORES);
    stores.balanceMinor = money(-1);
    expect(fired(checkInvariants({ ledger: f.ledger }, 1).violations)).toContain('INV-3');
  });

  it('INV-4 — an obligation that requires an encumbrance and has none', () => {
    const f = fixture();
    f.obligations.open(HAUL, true);
    const report = checkInvariants({ ledger: f.ledger, obligations: f.obligations }, 1);
    expect(fired(report.violations)).toContain('INV-4');
  });

  it('INV-5 — the EXPOSURE served to an agent is not the EXPOSURE in the table', () => {
    const f = fixture();
    f.obligations.open(HAUL, true);
    f.ledger.encumbrances.lock({
      eventId: 'lock:1',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: money(5_000),
      obligationRef: HAUL,
      maxDirectLoss: money(5_000),
    });
    const lied = new Map<PrincipalId, ReturnType<typeof money>>([[ALICE, money(1)]]);
    const report = checkInvariants(
      { ledger: f.ledger, obligations: f.obligations, servedExposure: lied },
      1,
    );
    expect(fired(report.violations)).toContain('INV-5');
  });

  it('INV-6 — a settlement whose payouts do not account for every minor unit', () => {
    const claims: Claim[] = [
      { account: B_STORES, priority: 0, amount: money(600), key: 'r0' },
      { account: A_STORES, priority: 1, amount: money(600), key: 'r1' },
    ];
    const good = payByPriority(money(1_000), claims);
    // Same pot, a payout quietly raised by one unit: the rounding leak INV-6 exists
    // for, and the reason the check is arithmetic rather than a review item.
    const leaky = {
      ...good,
      payouts: good.payouts.map((p, i) => (i === 0 ? { ...p, paid: money(p.paid + 1) } : p)),
    };
    const report = checkInvariants(
      { settlements: [{ obligation: 'v1', proceeds: money(1_000), result: leaky }] },
      1,
    );
    expect(fired(report.violations)).toContain('INV-6');
  });

  it('INV-7 — one quantity, two homes: the lot mirror disagrees with the postings', () => {
    const f = fixture();
    const lotId = f.ledger.sourceGoods({
      eventId: ev('dig'),
      tick: 0,
      faucet: GOODS_FAUCET.EXTRACTION,
      to: A_STORES,
      good: ORE,
      qty: qty(10),
      location: 'sys-home' as never,
      origin: ALICE,
    });
    // Scar #5, reproduced in one line: the lot says 20, the postings say 10.
    const lot = f.ledger.requireLot(lotId);
    lot.qty = qty(20);
    expect(fired(checkInvariants({ ledger: f.ledger }, 1).violations)).toContain('INV-7');
  });
});

// ── presence: INV-8 .. INV-10 ───────────────────────────────────────────────

describe('the presence group fires', () => {
  it('INV-8 — a hand that no longer exists', () => {
    const f = fixture();
    const ids = f.presence.handsByPrincipal.get(ALICE) ?? [];
    const first = ids[0];
    expect(first).toBeDefined();
    if (first !== undefined) f.presence.hands.delete(first);
    expect(fired(checkInvariants({ presence: f.presence }, 1).violations)).toContain('INV-8');
  });

  it('INV-9 — one hand filling two venture roles', () => {
    const f = fixture();
    const handId = (f.presence.handsByPrincipal.get(ALICE) ?? [])[0];
    expect(handId).toBeDefined();
    if (handId === undefined) return;
    const hand = f.presence.hands.get(handId);
    if (hand !== undefined) hand.state = 'COMMITTED';
    const fills = new Map([[handId, 2]]);
    const report = checkInvariants({ presence: f.presence, roleFills: fills }, 1);
    expect(fired(report.violations)).toContain('INV-9');
  });

  it('INV-9 — the multiplicity clause does not run without RoleFills, and says so', () => {
    const f = fixture();
    const report = checkInvariants({ presence: f.presence }, 1);
    expect(report.skipped.some((s) => s.id === 'INV-9')).toBe(true);
  });

  it('INV-10 — a published ETA the gate table does not agree with', () => {
    const f = fixture();
    const handId = (f.presence.handsByPrincipal.get(BOB) ?? [])[0];
    if (handId === undefined) return;
    const hand = f.presence.hands.get(handId);
    if (hand === undefined) return;
    const lane = [...f.presence.map.lanes.values()].find((l) => l.a === hand.location || l.b === hand.location);
    expect(lane).toBeDefined();
    if (lane === undefined) return;
    hand.state = 'IN_TRANSIT';
    hand.destination = lane.a === hand.location ? lane.b : lane.a;
    hand.departedAtTick = 1;
    // The gate table says departedAt + transitTicks. Publish something else.
    hand.freeAtTick = 1 + lane.transitTicks + 5;
    expect(fired(checkInvariants({ presence: f.presence }, 2).violations)).toContain('INV-10');
  });
});

// ── the record: INV-11 .. INV-16 ────────────────────────────────────────────

/** A frozen record, hand-built, for the checks the append path makes unreachable. */
function handBuilt(overrides: Partial<GameEvent>): EventRecord {
  const event: GameEvent = Object.freeze({
    id: 'ev:1:0' as EventId,
    tick: 1,
    seqInTick: 0,
    kind: 'HAND_BUILT',
    rulesVersion: 1,
    actorPrincipalId: null,
    onBehalfOfPrincipalId: null,
    grantId: null,
    eventFamilyId: 'HAND_BUILT',
    parentEventId: null,
    isPublic: true,
    publicAt: 1,
    declassifyAt: 1,
    provenanceClass: 'FACT',
    actedOnStateVersion: 1,
    decisionSource: null,
    payload: Object.freeze({}),
    ...overrides,
  });
  return Object.freeze({ event, visibility: 'PUBLIC', flagKeys: Object.freeze([]) });
}

describe('the record group fires', () => {
  it('INV-11 — a gap in seq_in_tick (unreachable through append, so hand-built)', () => {
    const withGap = [handBuilt({ seqInTick: 0 }), handBuilt({ id: 'ev:1:2' as EventId, seqInTick: 2 })];
    expect(seqDensityViolations(withGap, 1).map((v) => v.id)).toContain('INV-11');

    const f = fixture();
    publicEvent(f.events, { tick: 1, kind: 'ANYTHING' });
    expect(checkInvariants({ events: f.events }, 1).checked).toContain('INV-11');
  });

  it('INV-12 — a cause that arrives after its effect (hand-built)', () => {
    const child = handBuilt({ id: 'ev:1:0' as EventId, tick: 1, parentEventId: 'ev:5:0' as EventId });
    const parent = handBuilt({ id: 'ev:5:0' as EventId, tick: 5 });
    const source = {
      get: (id: EventId) => (id === parent.event.id ? parent : id === child.event.id ? child : null),
      audienceOf: () => [],
    };
    expect(causalityViolations([child], source, 1).map((v) => v.id)).toContain('INV-12');

    const f = fixture();
    publicEvent(f.events, { tick: 1, kind: 'ANYTHING' });
    expect(checkInvariants({ events: f.events }, 1).checked).toContain('INV-12');
  });

  it('INV-13 — a PARTIES event with one audience row (hand-built)', () => {
    const rec: EventRecord = Object.freeze({
      event: handBuilt({ isPublic: false, publicAt: 9, declassifyAt: 9 }).event,
      visibility: 'PARTIES',
      flagKeys: Object.freeze([]),
    });
    const source = { get: () => rec, audienceOf: () => [] };
    expect(fanOutViolations([rec], source, 1).map((v) => v.id)).toContain('INV-13');
  });

  it('INV-14 — visibility regressing, through the real aggregate', () => {
    const f = fixture();
    const id = tieredEvent(f.events, 'SENSED', {
      tick: 1,
      kind: 'CARGO_SENSED',
      actor: ALICE,
      declassifyAt: 20,
      audience: [{ principal: BOB, basis: 'IN_RANGE' }],
    });
    // Pass 1 records the descriptor as the "before".
    expect(checkInvariants({ events: f.events }, 1).violations).toEqual([]);
    // Tamper with the audit snapshot so the "before" claims a later declassification
    // than the row actually has: declassify_at moving earlier is the regression.
    const now = f.events.describe(id);
    expect(now).not.toBeNull();
    if (now === null) return;
    f.events.recordDescriptor(id, { ...now, declassifyAt: 40, publicAt: 40 });
    f.events.admitAudience(id, CARA, 'INTEL', 2);
    expect(fired(checkInvariants({ events: f.events }, 2).violations)).toContain('INV-14');
  });

  it('INV-15 — a rules_version that pins nothing (hand-built)', () => {
    const rec = handBuilt({ rulesVersion: 0 });
    expect(recordIntegrityViolations([rec], 1).map((v) => v.id)).toContain('INV-15');

    const f = fixture();
    publicEvent(f.events, { tick: 1, kind: 'ANYTHING' });
    expect(checkInvariants({ events: f.events }, 1).checked).toContain('INV-15');
  });

  it('INV-16 — a write path appearing on the ledger, through the real aggregate', () => {
    // The reflective half of INV-16: the failure it guards against is not a bad call
    // site but a future *method*, so a subclass that grows one must be caught.
    class LedgerWithARewrite extends EventLedger {
      updateEvent(): void {
        // Exists only to be found.
      }
    }
    const events = new LedgerWithARewrite();
    publicEvent(events, { tick: 1, kind: 'ANYTHING' });
    expect(fired(checkInvariants({ events }, 1).violations)).toContain('INV-16');
  });
});

// ── promises: INV-17 .. INV-21 ──────────────────────────────────────────────

describe('the promises group fires', () => {
  it('INV-17 — a default event with no attributable cause', () => {
    const f = fixture();
    publicEvent(f.events, {
      tick: 1,
      kind: 'VENTURE_DEFAULTED',
      actor: ALICE,
      payload: { venture: HAUL },
    });
    const report = checkInvariants(
      { events: f.events, defaults: new DefaultRegister(), eventScope: 'FULL' },
      1,
    );
    expect(fired(report.violations)).toContain('INV-17');
  });

  it('INV-17 leads the report, because it is the top-severity check in the codebase', () => {
    const f = fixture();
    const stores = f.ledger.requireAccount(A_STORES);
    stores.balanceMinor = money(-1);
    publicEvent(f.events, { tick: 1, kind: 'VENTURE_DEFAULTED', actor: ALICE });
    const report = checkInvariants(
      { ledger: f.ledger, events: f.events, defaults: new DefaultRegister(), eventScope: 'FULL' },
      1,
    );
    expect(fired(report.violations)).toContain('INV-3');
    expect(report.violations[0]?.id).toBe('INV-17');
  });

  it('INV-17 — the attribution is in the register but not in the permanent record', () => {
    const f = fixture();
    const cause = publicEvent(f.events, { tick: 1, kind: 'RAID_STRUCK', actor: BOB });
    // No parentEventId: the register knows why, the record does not, and the record
    // is the thing that outlives the process.
    const defaulted = publicEvent(f.events, { tick: 1, kind: 'VENTURE_DEFAULTED', actor: ALICE });
    const register = new DefaultRegister();
    register.attribute({
      defaultEventId: defaulted,
      promisor: ALICE,
      obligation: HAUL,
      cause: 'LOSS',
      causeEventId: cause,
      tick: 1,
      reckoningIndex: 0,
    });
    const report = checkInvariants({ events: f.events, defaults: register, eventScope: 'FULL' }, 1);
    expect(
      report.violations.some((v) => v.id === 'INV-17' && v.message.includes('parent_event_id')),
    ).toBe(true);
  });

  it('INV-17 is silent when the cause is registered and carried in parent_event_id', () => {
    const f = fixture();
    const cause = publicEvent(f.events, { tick: 1, kind: 'RAID_STRUCK', actor: BOB });
    const defaulted = publicEvent(f.events, {
      tick: 1,
      kind: 'VENTURE_DEFAULTED',
      actor: ALICE,
      parent: cause,
    });
    const register = new DefaultRegister();
    register.attribute({
      defaultEventId: defaulted,
      promisor: ALICE,
      obligation: HAUL,
      cause: 'LOSS',
      causeEventId: cause,
      tick: 1,
      reckoningIndex: 0,
    });
    const report = checkInvariants({ events: f.events, defaults: register, eventScope: 'FULL' }, 1);
    expect(fired(report.violations)).not.toContain('INV-17');
  });

  it('INV-18 — a third party touches the settlement set inside the freeze', () => {
    const f = fixture();
    const settleTick = TICKS_PER_RECKONING - 1;
    // A raid on a committed account, written at the freeze tick before settlement's
    // own events. This is SPEC §15.4's false-default construction, exactly.
    publicEvent(f.events, {
      tick: settleTick,
      kind: 'RAID_STRUCK',
      actor: CARA,
      payload: { target: A_STORES, venture: HAUL },
    });
    const report = checkInvariants(
      {
        events: f.events,
        settlementSet: {
          reckoningIndex: reckoningIndex(settleTick),
          frozenAtTick: settleTick,
          settlementTick: settleTick,
          // Settlement's own events would start at seq 1; the raid is at seq 0.
          settlementSeqFrom: 1,
          objects: new Set([HAUL, HAUL_ESCROW, A_STORES]),
          inputsHash: 'deadbeef',
          stateVersion: settleTick,
        },
      },
      settleTick,
    );
    expect(fired(report.violations)).toContain('INV-18');
  });

  it('INV-18 is silent when the only events at the freeze tick are the settlement’s own', () => {
    const f = fixture();
    const settleTick = TICKS_PER_RECKONING - 1;
    publicEvent(f.events, {
      tick: settleTick,
      kind: 'ESCROWED_PART_PAID',
      actor: ALICE,
      payload: { venture: HAUL },
    });
    const report = checkInvariants(
      {
        events: f.events,
        settlementSet: {
          reckoningIndex: reckoningIndex(settleTick),
          frozenAtTick: settleTick,
          settlementTick: settleTick,
          settlementSeqFrom: 0,
          objects: new Set([HAUL, A_STORES]),
          inputsHash: 'deadbeef',
          stateVersion: settleTick,
        },
      },
      settleTick,
    );
    expect(fired(report.violations)).not.toContain('INV-18');
  });

  it('INV-19 — the state version at settlement is not the one the parties acted on', () => {
    const report = checkInvariants(
      {
        settlementItems: [
          {
            obligation: HAUL,
            pinnedStateVersion: 100,
            observedStateVersion: 104,
            pinnedTermsHash: canonicalHash({ terms: 1 }),
            observedTermsHash: canonicalHash({ terms: 1 }),
          },
        ],
      },
      287,
    );
    expect(fired(report.violations)).toContain('INV-19');
  });

  it('INV-19 — the valuation moved between agreement and settlement', () => {
    const report = checkInvariants(
      {
        settlementItems: [
          {
            obligation: HAUL,
            pinnedStateVersion: 100,
            observedStateVersion: 100,
            pinnedTermsHash: canonicalHash({ terms: 1 }),
            observedTermsHash: canonicalHash({ terms: 2 }),
          },
        ],
      },
      287,
    );
    expect(fired(report.violations)).toContain('INV-19');
  });

  it('INV-20 — a seal whose Reckoning closed and never resolved', () => {
    // `src/seal/invariants.ts` branches on `isResolved`, so a Reckoning that never
    // ran takes the unresolved branch forever and its seals stay unjudged in
    // silence. Exactly one verdict means zero is a violation too, and this is the
    // clause `checkUnjudgedSeals` adds — the aggregate runs both.
    const book = new SealBook();
    const accepted = book.commit({
      principal: ALICE,
      tick: 10,
      actedOnStateVersion: 10,
      intent: { verb: 'haul', target: HAUL, measure: 'QTY', outcomeLow: 10, outcomeHigh: 20 },
      prose: 'I will deliver.',
      role: null,
      rolesHeld: [],
    });
    // Asserted, not guarded: the first version of this test wrapped its assertion in
    // `if (accepted.ok)` and passed while the seal was being rejected for a malformed
    // intent. A conditional assertion is the flattering version of a test.
    expect(accepted.ok, JSON.stringify(accepted)).toBe(true);

    // Inside its own Reckoning, an unjudged seal is simply pending.
    expect(fired(checkInvariants({ sealBook: book }, 200).violations)).not.toContain('INV-20');
    // A Reckoning later, it is a promise the world dropped.
    const nextReckoning = TICKS_PER_RECKONING + 10;
    const report = checkInvariants({ sealBook: book }, nextReckoning);
    expect(report.checked).toContain('INV-20');
    expect(fired(report.violations)).toContain('INV-20');
  });

  it('INV-20 is silent once the Reckoning resolved its seals', () => {
    const book = new SealBook();
    const accepted = book.commit({
      principal: ALICE,
      tick: 10,
      actedOnStateVersion: 10,
      intent: { verb: 'haul', target: HAUL, measure: 'QTY', outcomeLow: 10, outcomeHigh: 20 },
      prose: 'I will deliver.',
      role: null,
      rolesHeld: [],
    });
    expect(accepted.ok).toBe(true);
    const settleTick = TICKS_PER_RECKONING - 1;
    book.resolve({ reckoningIndex: 0, atTick: settleTick, stateVersion: settleTick, deeds: [] });
    const report = checkInvariants({ sealBook: book }, TICKS_PER_RECKONING + 10);
    expect(fired(report.violations)).not.toContain('INV-20');
  });

  it('INV-21 — the cached standing row does not match its journal', () => {
    const f = fixture();
    const eventId = publicEvent(f.events, { tick: 1, kind: 'ELECTIVE_PART_HONOURED', actor: ALICE });
    const report = checkInvariants(
      {
        events: f.events,
        defaults: new DefaultRegister(),
        standingChanges: [
          {
            principal: ALICE,
            tick: 1,
            cause: 'ELECTIVE_HONOURED',
            eventId,
            delta: { electiveHonoured: 1, electiveHonouredValue: 500, distinctCounterparties: 1 },
            counterparty: BOB,
          },
        ],
        // The row claims five honoured parts on a journal that accounts for one.
        standings: [standing(ALICE, { electiveHonoured: 5, electiveHonouredValue: minor(500), distinctCounterparties: 1 })],
      },
      1,
    );
    expect(fired(report.violations)).toContain('INV-21');
  });

  it('INV-21 — standing falls for a default INV-17 cannot justify', () => {
    const f = fixture();
    const eventId = publicEvent(f.events, { tick: 1, kind: 'VENTURE_DEFAULTED', actor: ALICE });
    const report = checkInvariants(
      {
        events: f.events,
        defaults: new DefaultRegister(),
        standingChanges: [
          { principal: ALICE, tick: 1, cause: 'DEFAULT', eventId, delta: { defaults: 1 }, counterparty: null },
        ],
        standings: [standing(ALICE, { defaults: 1, lastDefaultTick: 1 })],
      },
      1,
    );
    expect(
      report.violations.some((v) => v.id === 'INV-21' && v.message.includes('attributable')),
    ).toBe(true);
  });

  it('INV-21 — scar #9: the same counterparty counted twice as diversity', () => {
    const f = fixture();
    const a = publicEvent(f.events, { tick: 1, kind: 'ELECTIVE_PART_HONOURED', actor: ALICE });
    const b = publicEvent(f.events, { tick: 2, kind: 'ELECTIVE_PART_HONOURED', actor: ALICE });
    const report = checkInvariants(
      {
        events: f.events,
        defaults: new DefaultRegister(),
        standingChanges: [
          {
            principal: ALICE,
            tick: 1,
            cause: 'ELECTIVE_HONOURED',
            eventId: a,
            delta: { electiveHonoured: 1, distinctCounterparties: 1 },
            counterparty: BOB,
          },
          {
            principal: ALICE,
            tick: 2,
            cause: 'ELECTIVE_HONOURED',
            eventId: b,
            // The same counterparty, credited as new diversity a second time.
            delta: { electiveHonoured: 1, distinctCounterparties: 1 },
            counterparty: BOB,
          },
        ],
        standings: [standing(ALICE, { electiveHonoured: 2, distinctCounterparties: 2 })],
      },
      2,
    );
    expect(
      report.violations.some((v) => v.id === 'INV-21' && v.message.includes('scar #9')),
    ).toBe(true);
  });

  it('INV-21 is silent when scheduled DECAY reduces distinctCounterparties', () => {
    // The self-contradiction this pins. `VECTORS_BY_CAUSE.DECAY` authorises
    // `distinctCounterparties`, so the summed journal falls; the distinct *set* cannot
    // un-name a counterparty, so it does not. Both were compared against the same
    // cached field with `!==`, which made them mutually unsatisfiable: after any decay
    // of that field, INV-21 halted a healthy world whatever the row said.
    const f = fixture();
    const honoured = publicEvent(f.events, { tick: 1, kind: 'ELECTIVE_PART_HONOURED', actor: ALICE });
    const decayed = publicEvent(f.events, { tick: 500, kind: 'STANDING_DECAYED', actor: ALICE });
    const report = checkInvariants(
      {
        events: f.events,
        eventScope: 'FULL',
        defaults: new DefaultRegister(),
        standingChanges: [
          {
            principal: ALICE,
            tick: 1,
            cause: 'ELECTIVE_HONOURED',
            eventId: honoured,
            delta: { electiveHonoured: 1, electiveHonouredValue: 500, distinctCounterparties: 1 },
            counterparty: BOB,
          },
          {
            principal: ALICE,
            tick: 500,
            cause: 'DECAY',
            eventId: decayed,
            delta: { electiveHonoured: -1, electiveHonouredValue: -500, distinctCounterparties: -1 },
            counterparty: null,
          },
        ],
        standings: [standing(ALICE)],
      },
      500,
    );
    expect(report.violations.filter((v) => v.id === 'INV-21')).toEqual([]);
  });

  it('INV-21 — a cause moving a field it may not touch', () => {
    const f = fixture();
    const eventId = publicEvent(f.events, { tick: 1, kind: 'VENTURE_DEFAULTED', actor: ALICE });
    const report = checkInvariants(
      {
        events: f.events,
        defaults: new DefaultRegister(),
        standingChanges: [
          {
            principal: ALICE,
            tick: 1,
            cause: 'DEFAULT',
            eventId,
            // A default quietly crediting an honoured elective part.
            delta: { electiveHonoured: 1 },
            counterparty: null,
          },
        ],
        standings: [standing(ALICE, { electiveHonoured: 1 })],
      },
      1,
    );
    expect(
      report.violations.some((v) => v.id === 'INV-21' && v.message.includes('may not touch')),
    ).toBe(true);
  });
});

// ── authority: INV-22, INV-23 ───────────────────────────────────────────────

describe('the authority group fires', () => {
  it('INV-22 — a grant spent past its LIMITS', () => {
    const report = checkInvariants(
      { grants: [grant({ spentDirect: minor(10_001) })], grantSpends: [] },
      1,
    );
    expect(fired(report.violations)).toContain('INV-22');
  });

  it('INV-22 — the spend journal and the cached counter disagree (the concurrency clause)', () => {
    const g = grant({ spentDirect: minor(1_000) });
    const report = checkInvariants(
      {
        grants: [g],
        grantSpends: [
          { grant: g.id, delegate: BOB, tick: 1, eventId: ev('s1'), direct: minor(600), contingent: minor(0), verb: 'create' },
          { grant: g.id, delegate: BOB, tick: 1, eventId: ev('s2'), direct: minor(600), contingent: minor(0), verb: 'create' },
        ],
      },
      1,
    );
    // Two concurrent delegates each drew 600; the counter says 1,000.
    expect(
      report.violations.some((v) => v.id === 'INV-22' && v.message.includes('journal')),
    ).toBe(true);
  });

  // ── THE THREE TESTS BELOW USED TO ASSERT A HALT, AND THE HALT WAS A FALSE ONE ──
  //
  // They encoded the CREDENTIAL-chain model applied to the GRANT BOOK, which has no parentage.
  // `vGrant` sets `grantor` to the actor and binds the grantor's OWN stores, and `Grant` has no
  // `parentGrantId` — so holding a grant from A does not let you delegate A's authority onward.
  // Read as a graph of *who may spend whose money*:
  //
  //     p0 -> p1 -> p2 -> p0     three neighbours who each trust one other
  //     p0 -> p1 -> ... -> p6    seven principals who each trust one other
  //
  // Neither amplifies anything: holding p2's grant gives you no access to p1's money, because each
  // grant is bounded by its own two limits over its own grantor's stores. Both were halting the
  // world, permanently, from four ordinary grants — and the `grant` affordance now offers exactly
  // this shape to every counterparty with a kept promise, so a latent halt became a likely one.
  //
  // The real property — a credential chain laundering authority into a namespace where the limits
  // were stripped — is unchanged and still enforced where chains actually exist:
  // `identity/vc.ts:394-420`, covered by `test/identity/vc.test.ts:335`
  // (`CREDENTIAL_CHAIN_CYCLE`). Nothing was disarmed; a check was pointed at the right book.
  //
  // See `test/invariants/authority-no-false-halt.test.ts`, which also carries the tripwire that
  // FAILS the moment `parentGrantId` appears, so the transitive walk cannot stay inert once there
  // is a real chain to check.

  it('INV-23 — a ring of independent grants is trust, not a cycle', () => {
    const report = checkInvariants(
      {
        grants: [
          grant({ id: 'g:1' as never, grantor: ALICE, delegate: BOB }),
          grant({ id: 'g:2' as never, grantor: BOB, delegate: CARA }),
          grant({ id: 'g:3' as never, grantor: CARA, delegate: ALICE }),
        ],
      },
      1,
    );
    expect(
      report.violations.filter((v) => v.id === 'INV-23'),
      'three principals each granting over their own stores is the most desirable state in the game',
    ).toEqual([]);
  });

  it('INV-23 — a principal made its own delegate', () => {
    const report = checkInvariants({ grants: [grant({ grantor: ALICE, delegate: ALICE })] }, 1);
    expect(
      report.violations.some((v) => v.id === 'INV-23' && v.message.includes('its own delegate')),
    ).toBe(true);
  });

  it('INV-23 — a long line of independent grants does not halt, and invents nothing', () => {
    // Still asserts the no-invented-accusation property, which was a real fix: abandoning the walk
    // used to leave nodes GREY so a later start read them as on its own path and published
    // "p2 is transitively its own delegate" about principals whose grants form no cycle. That
    // sentence must never appear, and now neither must the depth halt.
    const chain = Array.from({ length: MAX_DELEGATION_DEPTH + 3 }, (_unused, i) =>
      grant({
        id: `g:${i}` as never,
        grantor: `p${i}` as PrincipalId,
        delegate: `p${i + 1}` as PrincipalId,
      }),
    );
    const report = checkInvariants({ grants: chain }, 1);
    const messages = report.violations.filter((v) => v.id === 'INV-23').map((v) => v.message);
    expect(messages, `INV-23 fired on ${String(chain.length)} independent grants`).toEqual([]);
  });

  it('INV-23 — a delegate on both sides of a deal it signed for someone else', () => {
    const report = checkInvariants(
      {
        grants: [grant()],
        deals: [
          { eventId: ev('deal:1'), signer: BOB, onBehalfOf: ALICE, grant: 'grant:1' as never, counterparties: [BOB] },
        ],
      },
      1,
    );
    expect(
      report.violations.some((v) => v.id === 'INV-23' && v.message.includes('both sides')),
    ).toBe(true);
  });
});

// ── the clock and the crowd: INV-24 .. INV-26 ───────────────────────────────

describe('the clock-and-crowd group fires', () => {
  const CONSTELLATION = 'con-1' as never;

  it('INV-24 — assessments that do not sum to the constellation total', () => {
    const report = checkInvariants(
      {
        levy: {
          totals: new Map([[CONSTELLATION, minor(1_000)]]),
          assessments: [
            { principal: ALICE, constellation: CONSTELLATION, amount: minor(400), newcomerFloored: false },
            { principal: BOB, constellation: CONSTELLATION, amount: minor(400), newcomerFloored: false },
          ],
          floorEligible: new Set(),
          nominalRate: minor(50),
          seizureQueue: [],
        },
      },
      287,
    );
    expect(fired(report.violations)).toContain('INV-24');
  });

  it('INV-24 — the newcomer floor was not applied to an eligible principal', () => {
    const report = checkInvariants(
      {
        levy: {
          totals: new Map([[CONSTELLATION, minor(1_000)]]),
          assessments: [
            { principal: ALICE, constellation: CONSTELLATION, amount: minor(950), newcomerFloored: false },
            { principal: CARA, constellation: CONSTELLATION, amount: minor(50), newcomerFloored: false },
          ],
          // CARA is a newcomer and must be at the nominal rate and out of the queue.
          floorEligible: new Set([CARA]),
          nominalRate: minor(50),
          seizureQueue: [CARA],
        },
      },
      287,
    );
    const messages = report.violations.filter((v) => v.id === 'INV-24').map((v) => v.message);
    expect(messages.some((m) => m.includes('does not record the floor'))).toBe(true);
    expect(messages.some((m) => m.includes('seizure queue'))).toBe(true);
  });

  it('INV-25 — a principal absent from the docket (the anti-quiet invariant)', () => {
    const report = checkInvariants(
      {
        principals: [...PRINCIPALS],
        atReckoning: 0,
        docket: [{ reckoningIndex: 0, kind: 'LEVY', principals: [ALICE, BOB] }],
      },
      287,
    );
    expect(
      report.violations.some((v) => v.id === 'INV-25' && v.message.includes(CARA)),
    ).toBe(true);
  });

  it('INV-25 — refuses to pass vacuously on an empty world', () => {
    const report = checkInvariants({ principals: [], atReckoning: 0, docket: [] }, 287);
    expect(fired(report.violations)).toContain('INV-25');
  });

  it('INV-26 — an array over its declared cap, and an array with no cap at all', () => {
    const over = checkInvariants(
      {
        capped: [
          {
            label: 'observation',
            value: { hands: [1, 2, 3, 4] },
            caps: [{ path: 'hands', max: 3 }],
          },
        ],
      },
      1,
    );
    expect(fired(over.violations)).toContain('INV-26');

    const undeclared = checkInvariants(
      { capped: [{ label: 'observation', value: { affordances: ['a'] }, caps: [] }] },
      1,
    );
    expect(
      undeclared.violations.some((v) => v.id === 'INV-26' && v.message.includes('no declared')),
    ).toBe(true);
  });

  it('INV-26 is silent when every array is declared and within bounds', () => {
    const report = checkInvariants(
      {
        capped: [
          {
            label: 'observation',
            value: { hands: [{ cargo: ['ore'] }, { cargo: [] }] },
            caps: [
              { path: 'hands', max: 3 },
              { path: 'hands.*.cargo', max: 8 },
            ],
          },
        ],
      },
      1,
    );
    expect(report.violations).toEqual([]);
  });
});
