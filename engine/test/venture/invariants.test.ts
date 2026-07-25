/**
 * The venture invariants, and the mutation tests that prove each one bites.
 *
 * An invariant nobody has watched fail is indistinguishable from an invariant that
 * cannot fail. Scar #1 "survived a full build and three critic passes because every
 * individual component was correct", so every check below is exercised against a world
 * deliberately broken the way a careless migration or a direct patch would break it.
 */

import { describe, expect, it } from 'vitest';
import { bps, minor, type Minor } from '../../src/core/units.js';
import { storesAccount } from '../../src/ledger/index.js';
import {
  MAX_ROLES_PER_VENTURE,
  SettlementHalt,
  assertClaimsExact,
  assertSoloCannotSatisfyTopYield,
  checkSettlementExact,
  checkVentureIndex,
  checkVentureInvariants,
  checkVentureStructure,
  activate,
  computeClaims,
  electiveHonouredValue,
  escrowRequired,
  isFullyCountersigned,
  isFullyFilled,
  lockFillStake,
  openIndices,
  partiesOf,
  pinnedValue,
  roleAt,
  settleVenture,
  signatoriesRequired,
  vacateRole,
  VentureError,
  type ClaimBreakdown,
  type SettleInput,
  type VentureRecord,
  type VentureSettlement,
} from '../../src/venture/index.js';
import {
  ACCOUNTS,
  ALICE,
  BRAM,
  CASS,
  STATE_VERSION,
  depositProceeds,
  ev,
  fill,
  fixture,
  fundEscrow,
  goLive,
  signAll,
  makeHaul,
  makeTopYield,
  share,
  vid,
  wage,
  type Fixture,
} from './fixture.js';

function settleAll(f: Fixture, venture: VentureRecord, proceeds: Minor): VentureSettlement {
  const claims = computeClaims(venture, proceeds);
  const elections = new Map<number, Minor>();
  for (const r of claims.roles) if (r.electiveDue > 0) elections.set(r.roleIndex, r.electiveDue);
  const inputs: SettleInput = {
    venture,
    tick: 287,
    eventId: ev(`settle:${venture.id}`),
    outcome: 'FULFILLED',
    proceeds,
    elections,
    actedOnStateVersion: STATE_VERSION,
    causeEventId: null,
  };
  return settleVenture(f.ledger, f.book, inputs, ACCOUNTS);
}

describe('a sound world reports no violations', () => {
  it('after creation, after filling, and after settlement', () => {
    const f = fixture();
    const haul = makeHaul(f);
    expect(checkVentureInvariants(f.book, 1)).toEqual([]);
    goLive(f, haul, [ALICE, BRAM], minor(12_000));
    expect(checkVentureInvariants(f.book, 2)).toEqual([]);
    const s = settleAll(f, haul, minor(12_000));
    expect(checkVentureInvariants(f.book, 287)).toEqual([]);
    expect(checkSettlementExact(s, 287)).toEqual([]);
  });
});

describe('PROP-V5 is asserted, not only validated at creation', () => {
  it('flags a role whose elective part was pushed under f(kind) after signing', () => {
    // The reason this is asserted at all: a zero elective part is *playable*. If it
    // silently stopped holding, every venture would become fully escrowed, nobody would
    // risk trust, and no other check in the codebase would notice.
    const f = fixture();
    const haul = makeHaul(f);
    const role = roleAt(haul, 1);
    (role as { terms: typeof role.terms }).terms = share(bps(3_000), 1_200, 0);
    const faults = checkVentureStructure(f.book, 1);
    expect(faults.map((v) => v.id)).toContain('PROP-V5');
    expect(faults.every((v) => v.severity === 'HALT')).toBe(true);
  });

  it('flags an escrowed part on an un-escrowable top-yield kind', () => {
    const f = fixture();
    const build = makeTopYield(f, 'BUILD', vid('v-build'), CASS);
    const role = roleAt(build, 0);
    (role as { terms: typeof role.terms }).terms = share(bps(1_500), 6_000, 6_000);
    const faults = checkVentureStructure(f.book, 1);
    expect(faults.filter((v) => v.id === 'PROP-V5').length).toBeGreaterThan(0);
  });
});

describe('PROP-V2 is asserted, not only validated at creation', () => {
  it('flags a role that ended up with both wage and share set', () => {
    const f = fixture();
    const haul = makeHaul(f);
    const role = roleAt(haul, 0);
    (role as { terms: typeof role.terms }).terms = {
      wage: minor(2_000),
      share: bps(3_000),
      escrowed: minor(1_000),
      elective: minor(1_000),
    };
    expect(checkVentureStructure(f.book, 1).map((v) => v.id)).toContain('PROP-V2');
  });
});

describe('INV-9 — commitment has one home, and the reference is coherent', () => {
  it('flags a principal named with no hand', () => {
    const f = fixture();
    const haul = makeHaul(f);
    const role = roleAt(haul, 0);
    role.filledByPrincipal = ALICE;
    // No hand: commitment lives in `filled_by_hand_id` and nowhere else, so a principal
    // reference with no hand behind it is a second home for the same fact.
    expect(checkVentureStructure(f.book, 1).map((v) => v.id)).toContain('INV-9');
  });

  it('flags a hand named with no principal', () => {
    const f = fixture();
    const haul = makeHaul(f);
    const role = roleAt(haul, 0);
    role.filledByHandId = 'p-alice:h1' as typeof role.filledByHandId;
    expect(checkVentureStructure(f.book, 1).map((v) => v.id)).toContain('INV-9');
  });

  it('vacating a role clears both halves of the reference', () => {
    const f = fixture();
    const haul = makeHaul(f);
    fill(f, haul, 0, ALICE);
    const handId = vacateRole(haul, 0);
    expect(handId).not.toBeNull();
    expect(roleAt(haul, 0).filledByPrincipal).toBeNull();
    expect(roleAt(haul, 0).filledAtTick).toBeNull();
    // The index still holds it, and the rescan says so — release is the caller's job
    // and forgetting it is exactly the drift `indexFaults` exists to catch.
    expect(checkVentureIndex(f.book, 1).some((v) => v.message.includes('stale entry'))).toBe(true);
  });
});

describe('INV-15 — the pinned terms are asserted every tick', () => {
  it('flags a venture whose terms no longer hash to what was countersigned', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(12_000));
    (haul as { valuation: typeof haul.valuation }).valuation = {
      ...haul.valuation,
      asOfTick: 999,
    };
    expect(checkVentureStructure(f.book, 1).map((v) => v.id)).toContain('INV-15');
  });
});

describe('INV-6 — the settlement arithmetic', () => {
  it('rejects a claim whose escrowed and elective halves do not add up to it', () => {
    // 40 + 40 against a claim of 100: twenty minor units with no home. This is the
    // rounding leak INV-6 names, constructed by hand because a correct implementation
    // cannot produce it.
    const broken: ClaimBreakdown = {
      venture: vid('v-x'),
      proceeds: minor(1_000),
      wageTotal: minor(0),
      wagesCovered: minor(0),
      residual: minor(1_000),
      creatorShareBps: bps(9_000),
      creatorPart: minor(900),
      roles: [
        {
          roleIndex: 0,
          label: 'ESCORT',
          holder: BRAM,
          counted: true,
          priority: 1,
          claim: minor(100),
          escrowedDue: minor(40),
          electiveDue: minor(40),
        },
      ],
    };
    expect(() => assertClaimsExact(broken)).toThrow(SettlementHalt);
  });

  it('rejects a residual divided into parts that do not sum to it', () => {
    const broken: ClaimBreakdown = {
      venture: vid('v-x'),
      proceeds: minor(1_000),
      wageTotal: minor(0),
      wagesCovered: minor(0),
      residual: minor(1_000),
      creatorShareBps: bps(7_000),
      creatorPart: minor(700),
      roles: [
        {
          roleIndex: 0,
          label: 'ESCORT',
          holder: BRAM,
          counted: true,
          priority: 1,
          claim: minor(299),
          escrowedDue: minor(0),
          electiveDue: minor(299),
        },
      ],
    };
    expect(() => assertClaimsExact(broken)).toThrow(SettlementHalt);
  });

  it('flags a payout that exceeds its claim', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(12_000));
    const s = settleAll(f, haul, minor(12_000));
    const tampered: VentureSettlement = {
      ...s,
      payouts: s.payouts.map((p, i) =>
        i === 1 ? { ...p, electivePaid: minor(p.electiveDue + 1) } : p,
      ),
    };
    expect(checkSettlementExact(tampered, 287).map((v) => v.id)).toContain('INV-6');
  });

  it('flags a default that names itself as payer and payee', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(12_000));
    const s = settleAll(f, haul, minor(12_000));
    const libel: VentureSettlement = {
      ...s,
      defaults: [
        {
          venture: haul.id,
          roleIndex: 0,
          payer: ALICE,
          payee: ALICE,
          amount: minor(10),
          cause: 'DECLINED',
          causeEventId: ev('x'),
        },
      ],
    };
    // Self-dealing is not a promise, so a default against yourself is the record
    // accusing an innocent agent — INV-17's own words.
    expect(checkSettlementExact(libel, 287).map((v) => v.id)).toContain('INV-17');
  });

  it('flags a default with no attributable cause (INV-17)', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(12_000));
    const s = settleAll(f, haul, minor(12_000));
    const causeless: VentureSettlement = {
      ...s,
      defaults: [
        {
          venture: haul.id,
          roleIndex: 1,
          payer: ALICE,
          payee: BRAM,
          amount: minor(10),
          cause: 'DECLINED',
          causeEventId: ev(''),
        },
      ],
    };
    expect(checkSettlementExact(causeless, 287).map((v) => v.id)).toContain('INV-17');
  });

  it('flags a standing change that is neither an honoured elective part nor a default (INV-21)', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(12_000));
    const s = settleAll(f, haul, minor(12_000));
    const leaked: VentureSettlement = {
      ...s,
      standing: [
        {
          cause: 'ELECTIVE_HONOURED',
          principal: ALICE,
          counterparty: BRAM,
          venture: haul.id,
          electiveHonoured: 0,
          electiveHonouredValue: minor(500),
          defaults: 0,
          defaultedValue: minor(0),
        },
      ],
    };
    expect(checkSettlementExact(leaked, 287).map((v) => v.id)).toContain('INV-21');
  });

  it('flags standing accrued against yourself (scar #9)', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(12_000));
    const s = settleAll(f, haul, minor(12_000));
    const farmed: VentureSettlement = {
      ...s,
      standing: [
        {
          cause: 'ELECTIVE_HONOURED',
          principal: ALICE,
          counterparty: ALICE,
          venture: haul.id,
          electiveHonoured: 1,
          electiveHonouredValue: minor(500),
          defaults: 0,
          defaultedValue: minor(0),
        },
      ],
    };
    expect(checkSettlementExact(farmed, 287).map((v) => v.id)).toContain('INV-21');
  });

  it('reports the elective value honoured, which is the only standing input', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(12_000));
    const s = settleAll(f, haul, minor(12_000));
    expect(electiveHonouredValue(s)).toBe(s.payouts[1]?.electiveDue);
  });
});

describe('PROP-V6 as a standing assertion over the kind table', () => {
  it('passes, and it takes no capital argument', () => {
    expect(() => {
      assertSoloCannotSatisfyTopYield();
    }).not.toThrow();
    expect(assertSoloCannotSatisfyTopYield.length).toBe(0);
  });
});

describe('the venture record answers the questions the API layer needs', () => {
  it('reports open roles, parties, signatories and the escrow requirement', () => {
    const f = fixture();
    const haul = makeHaul(f, { carrier: wage(700, 300), escort: share(bps(3_000), 400, 600) });
    expect(openIndices(haul)).toEqual([0, 1]);
    expect(isFullyFilled(haul)).toBe(false);
    expect(escrowRequired(haul)).toBe(1_100);
    expect(pinnedValue(haul)).toBe(2_000);
    expect(signatoriesRequired(haul)).toEqual([ALICE]);

    fill(f, haul, 0, ALICE);
    fill(f, haul, 1, BRAM);
    expect(openIndices(haul)).toEqual([]);
    expect(partiesOf(haul)).toEqual([ALICE, BRAM]);
    expect(signatoriesRequired(haul)).toEqual([ALICE, BRAM]);
    expect(isFullyCountersigned(haul)).toBe(false);
  });

  it('throws on a role index that does not exist', () => {
    const f = fixture();
    const haul = makeHaul(f);
    expect(() => roleAt(haul, 9)).toThrow(VentureError);
  });

  it('bounds the role array (INV-26)', () => {
    const f = fixture();
    const haul = makeHaul(f);
    expect(haul.roles.length).toBeLessThanOrEqual(MAX_ROLES_PER_VENTURE);
  });
});

describe('INV-4 — the fill stake has a live obligation and is released', () => {
  it('locks the stake at fill time and releases it at settlement', () => {
    // §7.3: "Filling a role escrows the stake at fill time. Otherwise filling a slot is
    // a free option and sybils can hold a stage's entire capacity all day and no-show."
    const f = fixture();
    const haul = makeHaul(f);
    fill(f, haul, 0, ALICE);
    fill(f, haul, 1, BRAM);
    const role = roleAt(haul, 1);
    const id = lockFillStake(f.ledger, {
      venture: haul,
      role,
      principal: BRAM,
      stores: storesAccount(BRAM),
      stake: minor(2_000),
      eventId: ev('fill:stake'),
      tick: 1,
    });
    expect(id).not.toBeNull();
    expect(role.stakeEncumbranceId).toBe(id);
    // The lock points at a live obligation, and EXPOSURE says the stake can be lost —
    // §7.3 forfeits an abandoned stake to the other parties, so it genuinely can be.
    expect(f.ledger.encumbrances.get(id ?? '')?.obligationRef).toBe(haul.id);
    expect(f.ledger.encumbrances.recomputeExposure(BRAM)).toBe(2_000);
    // Locked value is unspendable but the balance is unchanged.
    expect(f.ledger.freeBalance(storesAccount(BRAM))).toBe(
      f.ledger.balance(storesAccount(BRAM)) - 2_000,
    );

    signAll(f, haul);
    const activated = activate(haul, STATE_VERSION, 1);
    expect(activated.ok).toBe(true);
    fundEscrow(f, haul);
    depositProceeds(f, haul, minor(12_000));

    const s = settleAll(f, haul, minor(12_000));
    expect(s.terminalState).toBe('SETTLED');
    // No orphan lock survives the settlement, and EXPOSURE falls back to zero.
    expect(f.ledger.encumbrances.open().filter((e) => e.obligationRef === haul.id)).toEqual([]);
    expect(f.ledger.encumbrances.recomputeExposure(BRAM)).toBe(0);
    expect(roleAt(haul, 1).stakeEncumbranceId).toBeNull();
  });

  it('locks nothing for a zero stake, so there is no empty row to orphan', () => {
    const f = fixture();
    const haul = makeHaul(f);
    fill(f, haul, 1, BRAM);
    const id = lockFillStake(f.ledger, {
      venture: haul,
      role: roleAt(haul, 1),
      principal: BRAM,
      stores: storesAccount(BRAM),
      stake: minor(0),
      eventId: ev('fill:no-stake'),
      tick: 1,
    });
    expect(id).toBeNull();
    expect(f.ledger.encumbrances.open()).toEqual([]);
  });

  it('releases every lock the venture opened, even on a default', () => {
    const f = fixture();
    const haul = makeHaul(f);
    fill(f, haul, 0, ALICE);
    fill(f, haul, 1, BRAM);
    lockFillStake(f.ledger, {
      venture: haul,
      role: roleAt(haul, 1),
      principal: BRAM,
      stores: storesAccount(BRAM),
      stake: minor(500),
      eventId: ev('fill:stake-2'),
      tick: 1,
    });
    signAll(f, haul);
    activate(haul, STATE_VERSION, 1);
    fundEscrow(f, haul);
    depositProceeds(f, haul, minor(12_000));

    // No elections: the elective part defaults, and the lock must still come off — an
    // orphan lock is an INV-4 failure that would halt the next tick.
    const s = settleVenture(
      f.ledger,
      f.book,
      {
        venture: haul,
        tick: 287,
        eventId: ev(`settle:${haul.id}`),
        outcome: 'FULFILLED',
        proceeds: minor(12_000),
        elections: new Map<number, Minor>(),
        actedOnStateVersion: STATE_VERSION,
        causeEventId: null,
      },
      ACCOUNTS,
    );
    expect(s.terminalState).toBe('DEFAULTED');
    expect(f.ledger.encumbrances.open()).toEqual([]);
  });
});
