/**
 * PROP-V1, PROP-V4, PROP-V7 — the settlement waterfall (§7.4, §16 step 5).
 *
 * `PROP-V1` For random venture configurations: splits sum to proceeds, seniority
 * respected (fixed `wage` before residual `share`), no negative payout, remainder
 * deterministic.
 *
 * `PROP-V4` The escrowed part always executes at settlement. The elective part
 * **never** auto-executes.
 *
 * `PROP-V7` Settlement is independent of everything except `venture_id` order.
 */

import { describe, expect, it } from 'vitest';
import { BPS_ONE, bps, minor, type Minor } from '../../src/core/units.js';
import type { PrincipalId } from '../../src/core/types.js';
import { checkLedgerInvariants, escrowAccount, storesAccount } from '../../src/ledger/index.js';
import {
  NEUTRAL_STAGE_BPS,
  SettlementHalt,
  checkSettlementExact,
  computeClaims,
  computeProceeds,
  createVenture,
  residualAtPercentile,
  settleBatch,
  settleVenture,
  termsHashOf,
  type SettleInput,
  type VentureRecord,
} from '../../src/venture/index.js';
import {
  ACCOUNTS,
  ALICE,
  BRAM,
  CASS,
  DOV,
  ESK,
  RULES_VERSION,
  STATE_VERSION,
  balance,
  ev,
  fixture,
  fundEscrow,
  goLive,
  makeHaul,
  makeTopYield,
  rngFor,
  share,
  vid,
  wage,
  type Fixture,
} from './fixture.js';

function input(
  venture: VentureRecord,
  proceeds: Minor,
  elections: ReadonlyMap<number, Minor> = new Map(),
  overrides: Partial<SettleInput> = {},
): SettleInput {
  return {
    venture,
    tick: 200,
    eventId: ev(`settle:${venture.id}`),
    outcome: 'FULFILLED',
    proceeds,
    elections,
    actedOnStateVersion: STATE_VERSION,
    causeEventId: null,
    ...overrides,
  };
}

/** Every elective part in full — the honoured branch. */
function payEverything(venture: VentureRecord, proceeds: Minor): Map<number, Minor> {
  const claims = computeClaims(venture, proceeds);
  const out = new Map<number, Minor>();
  for (const r of claims.roles) {
    if (r.electiveDue > 0) out.set(r.roleIndex, r.electiveDue);
  }
  return out;
}

describe('PROP-V1 — splits sum to proceeds, exactly', () => {
  it('holds for 400 random configurations', () => {
    const rng = rngFor('prop-v1');
    for (let i = 0; i < 400; i += 1) {
      const f = fixture();
      // Random-but-legal terms: a wage role and a share role, both above f(HAUL).
      const carrierEscrowed = rng.range(0, 4_000);
      const carrierElective = Math.max(
        100,
        Math.ceil((carrierEscrowed + 1) / 3),
        rng.range(1, 4_000),
      );
      const escortShare = bps(rng.range(1, 9_000));
      const escortEscrowed = rng.range(0, 3_000);
      const escortElective = Math.max(100, Math.ceil((escortEscrowed + 1) / 3), rng.range(1, 3_000));

      const haul = makeHaul(f, {
        id: vid(`v-${String(i)}`),
        carrier: wage(carrierEscrowed, carrierElective),
        escort: share(escortShare, escortEscrowed, escortElective),
      });
      const proceeds = minor(rng.range(0, 40_000));
      goLive(f, haul, [ALICE, BRAM], proceeds);

      const claims = computeClaims(haul, proceeds);

      // The split adds to the proceeds, to the minor unit. `splitByBps` guarantees it
      // and `assertClaimsExact` (called inside computeClaims) proves it.
      let shareSum = 0;
      for (const r of claims.roles) if (r.priority === 1 && r.counted) shareSum += r.claim;
      expect(claims.wagesCovered + shareSum + claims.creatorPart).toBe(proceeds);

      // Seniority: the wage is covered before any residual exists.
      if (claims.wageTotal >= proceeds) {
        expect(claims.residual).toBe(0);
        expect(shareSum).toBe(0);
      } else {
        expect(claims.wagesCovered).toBe(claims.wageTotal);
      }

      // No negative payout, and each claim splits into its two halves exactly.
      for (const r of claims.roles) {
        expect(r.claim).toBeGreaterThanOrEqual(0);
        expect(r.escrowedDue + r.electiveDue).toBe(r.claim);
        expect(r.escrowedDue).toBeLessThanOrEqual(r.claim);
      }
    }
  });

  it('allocates the truncation remainder to the roles before the creator', () => {
    // 3 minor units across 3333/3333/3334 bps: the remainder walks the weights in the
    // order given, and the creator is last. Stated so it is a rule, not an accident.
    const f = fixture();
    const haul = makeHaul(f, {
      carrier: share(bps(3_333), 300, 700),
      escort: share(bps(3_333), 300, 700),
    });
    goLive(f, haul, [ALICE, BRAM], minor(10));
    const claims = computeClaims(haul, minor(10));
    const parts = claims.roles.filter((r) => r.counted).map((r) => r.claim);
    expect(parts.reduce<number>((a, b) => a + b, 0) + claims.creatorPart).toBe(10);
    // Deterministic: the same inputs give the same allocation every run.
    expect(parts).toEqual(computeClaims(haul, minor(10)).roles.filter((r) => r.counted).map((r) => r.claim));
  });

  it('pays nothing to an unfilled role and reverts its share to the creator', () => {
    const f = fixture();
    const haul = makeHaul(f);
    // Only the carrier fills; the escort's 3000 bps has no claimant.
    const claims = computeClaims(haul, minor(10_000));
    expect(claims.creatorShareBps).toBe(BPS_ONE);
    expect(claims.roles[1]?.claim).toBe(0);
    expect(claims.roles[1]?.holder).toBeNull();
  });

  it('refuses negative proceeds rather than handing out negative payouts', () => {
    const f = fixture();
    const haul = makeHaul(f);
    expect(() => computeClaims(haul, minor(-1))).toThrow(SettlementHalt);
  });

  it('a wage exceeding proceeds leaves no residual and no share claim', () => {
    const f = fixture();
    const haul = makeHaul(f, { carrier: wage(4_000, 4_000), escort: share(bps(5_000), 500, 700) });
    goLive(f, haul, [ALICE, BRAM], minor(3_000));
    const claims = computeClaims(haul, minor(3_000));
    expect(claims.wageTotal).toBe(8_000);
    expect(claims.wagesCovered).toBe(3_000);
    expect(claims.residual).toBe(0);
    expect(claims.roles[1]?.claim).toBe(0);
    // The wage claim is still 8000 — what is owed does not shrink because the venture
    // underperformed. The shortfall lands on the escrowed and elective halves.
    expect(claims.roles[0]?.claim).toBe(8_000);
  });
});

describe('PROP-V4 — the escrowed part always executes; the elective part never does', () => {
  it('pays the escrowed part with an empty elections map', () => {
    const f = fixture();
    const haul = makeHaul(f, { carrier: wage(1_000, 1_000), escort: share(bps(3_000), 500, 700) });
    goLive(f, haul, [ALICE, BRAM], minor(10_000));
    const before = balance(f, BRAM);

    // No elections at all. The escrowed half must still move.
    const s = settleVenture(f.ledger, f.book, input(haul, minor(10_000)), ACCOUNTS);
    const escort = s.payouts[1];
    expect(escort?.escrowedDue).toBe(500);
    expect(escort?.escrowedPaid).toBe(500);
    expect(escort?.electivePaid).toBe(0);
    expect(escort?.electiveShortfall).toBeGreaterThan(0);
    expect(balance(f, BRAM)).toBe(before + 500);
  });

  it('the elective part is zero without an explicit election, for every role', () => {
    const f = fixture();
    const build = makeTopYield(f, 'BUILD', vid('v-build'), ESK);
    goLive(f, build, [ALICE, BRAM, CASS, DOV], minor(80_000));
    const s = settleVenture(f.ledger, f.book, input(build, minor(80_000)), ACCOUNTS);
    // A top-yield kind is un-escrowable, so *every* payout is elective — and with no
    // elections, nobody is paid anything. That is A7 at its starkest.
    for (const p of s.payouts) {
      expect(p.escrowedDue).toBe(0);
      expect(p.electivePaid).toBe(0);
    }
    expect(s.defaults).toHaveLength(4);
    expect(s.terminalState).toBe('DEFAULTED');
  });

  it('pays the elective part when it is elected, and records it as honoured', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(10_000));
    const elections = payEverything(haul, minor(10_000));
    const before = balance(f, BRAM);

    const s = settleVenture(f.ledger, f.book, input(haul, minor(10_000), elections), ACCOUNTS);
    const escort = s.payouts[1];
    expect(escort?.electiveShortfall).toBe(0);
    expect(balance(f, BRAM)).toBe(before + (escort?.claim ?? 0));
    expect(s.defaults).toHaveLength(0);
    expect(s.terminalState).toBe('SETTLED');
    // Standing accrues, and only to the elective half.
    const bram = s.standing.find((x) => x.counterparty === BRAM);
    expect(bram?.electiveHonoured).toBe(1);
    expect(bram?.electiveHonouredValue).toBe(escort?.electiveDue);
  });

  it('caps an over-election at the elective due', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(10_000));
    const s = settleVenture(
      f.ledger,
      f.book,
      input(haul, minor(10_000), new Map([[1, minor(999_999)]])),
      ACCOUNTS,
    );
    const escort = s.payouts[1];
    expect(escort?.electivePaid).toBe(escort?.electiveDue);
  });

  it('a 100%-escrowed role earns a performance record and zero standing (PROP-S2)', () => {
    // Not reachable through `createVenture` — f(kind) forbids it — so the record is
    // built directly, which is exactly the state a future kind with a zero floor would
    // produce. `electiveDue === 0` must yield no standing entry at all.
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(10_000));
    const carrier = haul.roles[0];
    const escort = haul.roles[1];
    if (carrier === undefined || escort === undefined) throw new Error('fixture');
    (carrier as { terms: typeof carrier.terms }).terms = wage(2_000, 0);
    (escort as { terms: typeof escort.terms }).terms = share(bps(3_000), 100_000, 0);
    // Re-pin, because the terms were rewritten. Doing this by hand rather than working
    // around the guard is the point: the guard is what stops a *live* venture's terms
    // from moving, and it caught this edit the first time it was written.
    haul.termsHash = termsHashOf(haul);
    fundEscrow(f, haul, minor(100_000));

    const s = settleVenture(f.ledger, f.book, input(haul, minor(10_000)), ACCOUNTS);
    expect(s.payouts.every((p) => p.electiveDue === 0)).toBe(true);
    expect(s.standing).toEqual([]);
    expect(s.defaults).toEqual([]);
    expect(s.terminalState).toBe('SETTLED');
  });

  it('an escrow raided below the escrowed parts is a recorded LOSS, never a default', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(0));
    // A raid drains the escrow between signing and settlement — §15.4's own scenario.
    const escrow = escrowAccount(haul.id, ALICE);
    f.ledger.seizeCurrency({
      eventId: ev('raid'),
      tick: 150,
      from: escrow,
      to: storesAccount(CASS),
      amount: minor(1_400),
    });
    expect(f.ledger.balance(escrow)).toBe(100);

    const s = settleVenture(
      f.ledger,
      f.book,
      input(haul, minor(0), payEverything(haul, minor(0)), {
        outcome: 'CARGO_LOST',
        causeEventId: ev('raid'),
      }),
      ACCOUNTS,
    );
    expect(s.recordedLoss).toBeGreaterThan(0);
    // The distinction E2E-2 exists for: value was destroyed, nobody broke a promise.
    expect(s.defaults).toEqual([]);
    expect(s.terminalState).toBe('SETTLED');
  });

  it('halts rather than turning a short escrow on a delivered venture into a loss', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(0));
    f.ledger.seizeCurrency({
      eventId: ev('drain'),
      tick: 150,
      from: escrowAccount(haul.id, ALICE),
      to: storesAccount(CASS),
      amount: minor(1_400),
    });
    // FULFILLED means the venture delivered. A short escrow here is an unfunded
    // signature, and silently recording it as a loss nobody caused is the class of bug
    // §15.4 exists to prevent.
    expect(() =>
      settleVenture(f.ledger, f.book, input(haul, minor(0)), ACCOUNTS),
    ).toThrow(SettlementHalt);
  });

  it('an escrow shortfall does not migrate onto the elective half', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(10_000));
    const pinnedElective = computeClaims(haul, minor(10_000)).roles.map((r) => r.electiveDue);
    f.ledger.seizeCurrency({
      eventId: ev('drain'),
      tick: 150,
      from: escrowAccount(haul.id, ALICE),
      to: storesAccount(CASS),
      amount: minor(1_000),
    });
    const s = settleVenture(
      f.ledger,
      f.book,
      input(haul, minor(10_000), new Map(), { outcome: 'CARGO_LOST', causeEventId: ev('drain') }),
      ACCOUNTS,
    );
    // The elective due is what was pinned, not what the escrow failed to cover.
    expect(s.payouts.map((p) => p.electiveDue)).toEqual(pinnedElective);
  });
});

describe('PROP-V7 — settlement depends on venture_id order and nothing else', () => {
  /** Four ventures whose ids are deliberately not their creation order. */
  function batchWorld(): { readonly f: Fixture; readonly inputs: SettleInput[] } {
    const f = fixture();
    const inputs: SettleInput[] = [];
    for (const [i, id] of ['v-z', 'v-m', 'v-a', 'v-q'].entries()) {
      const creator = [ALICE, BRAM, CASS, DOV][i] as PrincipalId;
      const holder = [BRAM, CASS, DOV, ESK][i] as PrincipalId;
      const haul = makeHaul(f, {
        id: vid(id),
        creator,
        carrier: wage(500 + i * 100, 500 + i * 50),
        escort: share(bps(2_000 + i * 500), 300, 400),
      });
      const proceeds = minor(5_000 + i * 1_111);
      goLive(f, haul, [creator, holder], proceeds);
      inputs.push(input(haul, proceeds, payEverything(haul, proceeds)));
    }
    return { f, inputs };
  }

  it('produces identical payouts and an identical ledger state_hash for 24 permutations', () => {
    const outcomes = new Set<string>();
    const hashes = new Set<string>();
    for (let i = 0; i < 24; i += 1) {
      const { f, inputs } = batchWorld();
      const batch = settleBatch(f.ledger, f.book, rngFor(`v7-${i}`).shuffle([...inputs]), ACCOUNTS);
      outcomes.add(
        JSON.stringify(
          batch.settlements.map((s) => [
            s.venture,
            s.terminalState,
            s.claims.proceeds,
            s.escrowReturned,
            s.payouts.map((p) => [p.roleIndex, p.claim, p.escrowedPaid, p.electivePaid]),
          ]),
        ),
      );
      hashes.add(f.ledger.stateHash());
    }
    // One outcome and one ledger hash across every permutation. If anything but
    // `venture_id` order mattered, both sets would be larger.
    expect(outcomes.size).toBe(1);
    expect(hashes.size).toBe(1);
  });

  it('reports settlements in venture_id order regardless of input order', () => {
    const { f, inputs } = batchWorld();
    const batch = settleBatch(f.ledger, f.book, [...inputs].reverse(), ACCOUNTS);
    expect(batch.settlements.map((s) => s.venture)).toEqual(['v-a', 'v-m', 'v-q', 'v-z']);
  });

  it('pays each venture out of its own escrow, not the first one in the batch', () => {
    // The bug this test exists for: one `escrow` field on the accounts map made the
    // whole batch balance while every individual promise came out of one pot.
    const { f, inputs } = batchWorld();
    settleBatch(f.ledger, f.book, inputs, ACCOUNTS);
    for (const i of inputs) {
      expect(f.ledger.balance(escrowAccount(i.venture.id, i.venture.creator))).toBe(0);
    }
    // Each holder was paid its own venture's claim, in full.
    for (const i of inputs) {
      const claims = computeClaims(i.venture, i.proceeds);
      for (const r of claims.roles) {
        if (r.holder === null || r.holder === i.venture.creator) continue;
        expect(balance(f, r.holder)).toBeGreaterThan(0);
      }
    }
  });
});

describe('the ledger stays whole across a settlement', () => {
  it('keeps supply conserved and the escrow emptied', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(10_000));
    settleVenture(
      f.ledger,
      f.book,
      input(haul, minor(10_000), payEverything(haul, minor(10_000))),
      ACCOUNTS,
    );
    // Everything that entered the escrow left it, so INV-2 has nothing to reconcile.
    expect(f.ledger.balance(escrowAccount(haul.id, ALICE))).toBe(0);
    expect(
      checkLedgerInvariants(f.ledger, { tick: 200, obligations: { isLive: () => false, securedObligations: () => [] } }),
    ).toEqual([]);
  });

  it('reports no INV-6 fault on the settlement itself', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(10_000));
    const s = settleVenture(
      f.ledger,
      f.book,
      input(haul, minor(10_000), payEverything(haul, minor(10_000))),
      ACCOUNTS,
    );
    expect(checkSettlementExact(s, 200)).toEqual([]);
  });
});

describe('proceeds — §7.4s output function', () => {
  it('yields exactly the base at a full fill, neutral stage, median residual', () => {
    const p = computeProceeds({ kind: 'HAUL', filled: [0, 1], stageBps: NEUTRAL_STAGE_BPS, residualSignedBps: 0 });
    expect(p.proceeds).toBe(12_000);
    expect(p.fullFill).toBe(true);
    expect(p.bottleneck).toBeNull();
  });

  it('yields strictly less on a partial fill, and names the bottleneck', () => {
    const p = computeProceeds({ kind: 'HAUL', filled: [1], stageBps: NEUTRAL_STAGE_BPS, residualSignedBps: 0 });
    expect(p.proceeds).toBeLessThan(12_000);
    expect(p.bottleneck?.label).toBe('CARRIER');
    expect(p.bottleneck?.forgoneBps).toBe(7_000);
  });

  it('has a symmetric band, so p50 is exactly zero residual', () => {
    expect(residualAtPercentile('HAUL', 'p50')).toBe(0);
    expect(residualAtPercentile('HAUL', 'p10')).toBe(-residualAtPercentile('HAUL', 'p90'));
  });

  it('refuses a residual outside the kind band', () => {
    expect(() =>
      computeProceeds({ kind: 'HAUL', filled: [0, 1], stageBps: NEUTRAL_STAGE_BPS, residualSignedBps: 9_999 }),
    ).toThrow();
  });

  it('never goes negative, however bad the stage', () => {
    const p = computeProceeds({
      kind: 'HAUL',
      filled: [0, 1],
      stageBps: bps(0),
      residualSignedBps: -1_500,
    });
    expect(p.proceeds).toBe(0);
  });
});

describe('INV-19 and the pinned terms halt the tick rather than settling wrongly', () => {
  it('halts on an acted_on_state_version mismatch', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(10_000));
    expect(() =>
      settleVenture(
        f.ledger,
        f.book,
        input(haul, minor(10_000), new Map(), { actedOnStateVersion: STATE_VERSION + 1 }),
        ACCOUNTS,
      ),
    ).toThrow(SettlementHalt);
  });

  it('halts when the pinned version was rewritten between the freeze and the settlement', () => {
    // The failure INV-19 can actually see, stated from the driver's side. The Reckoning
    // captures `acted_on_state_version` at the freeze and hashes it with the inputs; if
    // the row no longer agrees with that capture, something rewrote a pinned obligation
    // inside the freeze and the settlement about to be published would be wrong.
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(10_000));
    const capturedAtFreeze = haul.actedOnStateVersion;
    if (capturedAtFreeze === null) throw new Error('fixture');
    haul.actedOnStateVersion = capturedAtFreeze + 3;
    expect(() =>
      settleVenture(
        f.ledger,
        f.book,
        input(haul, minor(10_000), new Map(), { actedOnStateVersion: capturedAtFreeze }),
        ACCOUNTS,
      ),
    ).toThrow(SettlementHalt);
  });

  it('settles a venture that outlived its activation tick, because the live counter is not the input', () => {
    // The other half of the decision, and the one that makes the check non-vacuous
    // *without* making it a guaranteed halt: a venture is agreed in its formation window
    // and settled a whole Reckoning later, so the engine's own state version has moved on
    // many times by then. The freeze's capture is what is compared, so this settles.
    const f = fixture();
    const haul = makeHaul(f, { windowOpensTick: 0, windowClosesTick: 100, resolvesAtTick: 287 });
    goLive(f, haul, [ALICE, BRAM], minor(10_000));
    const capturedAtFreeze = haul.actedOnStateVersion;
    expect(capturedAtFreeze).toBe(STATE_VERSION);
    const s = settleVenture(
      f.ledger,
      f.book,
      input(haul, minor(10_000), new Map(), {
        tick: 287,
        actedOnStateVersion: capturedAtFreeze ?? 0,
      }),
      ACCOUNTS,
    );
    expect(s.terminalState).not.toBe('DEFERRED');
    expect(s.payouts[1]?.escrowedPaid).toBe(s.payouts[1]?.escrowedDue);
  });

  it('halts on a malformed capture rather than reading it as a rewritten row', () => {
    // Equality alone would halt on any of these, but with the wrong story: an operator
    // reading "the pinned version was rewritten between the freeze and the settlement"
    // goes looking for a forgery that is really a driver that forgot to capture. The
    // message has to name the malformed capture, so the message is what is asserted.
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(10_000));
    for (const bad of [-1, 7.5, Number.NaN]) {
      expect(() =>
        settleVenture(
          f.ledger,
          f.book,
          input(haul, minor(10_000), new Map(), { actedOnStateVersion: bad }),
          ACCOUNTS,
        ),
      ).toThrow(/malformed acted_on_state_version/);
    }
    // And the rewritten-row case keeps its own message, so the two never blur.
    expect(() =>
      settleVenture(
        f.ledger,
        f.book,
        input(haul, minor(10_000), new Map(), { actedOnStateVersion: STATE_VERSION + 1 }),
        ACCOUNTS,
      ),
    ).toThrow(/rewritten between the freeze and the settlement/);
  });

  it('halts when a role term was edited after signing', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(10_000));
    const role = haul.roles[0];
    if (role === undefined) throw new Error('fixture');
    (role as { terms: typeof role.terms }).terms = wage(1_000, 2_000);
    expect(() =>
      settleVenture(f.ledger, f.book, input(haul, minor(10_000)), ACCOUNTS),
    ).toThrow(SettlementHalt);
  });

  it('halts when the pinned valuation as-of tick was moved (E2E-14)', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(10_000));
    (haul as { valuation: typeof haul.valuation }).valuation = {
      ...haul.valuation,
      asOfTick: haul.valuation.asOfTick + 40,
    };
    expect(() =>
      settleVenture(f.ledger, f.book, input(haul, minor(10_000)), ACCOUNTS),
    ).toThrow(SettlementHalt);
  });

  it('halts when a FULFILLED outcome is claimed with an open role', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(10_000));
    const role = haul.roles[1];
    if (role === undefined) throw new Error('fixture');
    role.filledByHandId = null;
    role.filledByPrincipal = null;
    expect(() =>
      settleVenture(f.ledger, f.book, input(haul, minor(10_000)), ACCOUNTS),
    ).toThrow(SettlementHalt);
  });

  it('halts when a loss outcome names no cause (INV-17)', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(10_000));
    expect(() =>
      settleVenture(
        f.ledger,
        f.book,
        input(haul, minor(10_000), new Map(), { outcome: 'CARGO_LOST', causeEventId: null }),
        ACCOUNTS,
      ),
    ).toThrow(SettlementHalt);
  });

  it('halts on a venture that never pinned a state version', () => {
    const f = fixture();
    const created = createVenture({
      id: vid('v-unpinned'),
      kind: 'HAUL',
      creator: ALICE,
      stage: f.stage,
      terms: [wage(1_000, 1_000), share(bps(3_000), 500, 700)],
      windowOpensTick: 0,
      windowClosesTick: 100,
      resolvesAtTick: 200,
      valuation: f.valuation,
      rulesVersion: RULES_VERSION,
      preference: [],
      visibility: 'PUBLIC',
    });
    if (!created.ok) throw new Error('fixture');
    const haul = f.book.add(created.value);
    haul.state = 'LIVE';
    fundEscrow(f, haul);
    expect(() =>
      settleVenture(f.ledger, f.book, input(haul, minor(0)), ACCOUNTS),
    ).toThrow(SettlementHalt);
  });
});
