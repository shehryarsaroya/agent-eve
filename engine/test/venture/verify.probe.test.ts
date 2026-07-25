/**
 * Adversarial verification probes for the venture module. Written by the verifier,
 * not the builder.
 *
 * Two kinds of test here, following the house pattern in
 * `test/seal/verify.probe.test.ts` and `test/events/verify.probe.test.ts`:
 *
 * - **`it.fails('DEFECT(venture): …')`** — the body asserts the *correct* behaviour,
 *   so the suite stays green while the defect stands and flips to an unexpected pass
 *   the moment it is fixed. Never red forever, never silently forgotten.
 * - **plain `it`** — a *witness*: it records what the module actually does for an
 *   input the builder's suite never constructs, where the behaviour is a consequence
 *   of the design rather than a defect in it.
 */

import { describe, expect, it } from 'vitest';
import { bps, minor, type Minor } from '../../src/core/units.js';
import type { PrincipalId } from '../../src/core/types.js';
import { CURRENCY_FAUCET, storesAccount } from '../../src/ledger/index.js';
import { checkInv9, handById } from '../../src/world/index.js';
import {
  allocateFills,
  computeClaims,
  settleBatch,
  settleVenture,
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
  STATE_VERSION,
  ev,
  fixture,
  goLive,
  makeHaul,
  share,
  vid,
  wage,
  type Fixture,
} from './fixture.js';

function inp(
  venture: VentureRecord,
  proceeds: Minor,
  elections: ReadonlyMap<number, Minor> = new Map(),
  overrides: Partial<SettleInput> = {},
): SettleInput {
  return {
    venture,
    tick: 287,
    eventId: ev(`settle:${venture.id}`),
    outcome: 'FULFILLED',
    proceeds,
    elections,
    stateVersion: STATE_VERSION,
    causeEventId: null,
    ...overrides,
  };
}

/**
 * The four-venture reverse payment chain from `slice.test.ts`, which truncates the
 * cascade and therefore defers `v-a`. Reproduced here so the deferral's *second*
 * settlement can be inspected, which the builder's suite never does beyond
 * `recordedLoss`.
 */
function truncatingChain(): { f: Fixture; inputs: SettleInput[]; first: VentureRecord } {
  const ESCROWED = 100;
  const ELECTIVE = 5_000;
  const f = fixture(minor(ESCROWED));
  f.ledger.issueCurrency({
    eventId: ev('fund:chain-head'),
    tick: 0,
    faucet: CURRENCY_FAUCET.STARTER_STAKE,
    to: storesAccount(DOV),
    amount: minor(ELECTIVE),
  });
  const links: readonly [string, PrincipalId, PrincipalId, PrincipalId][] = [
    ['v-a', ALICE, ESK, BRAM],
    ['v-b', BRAM, ALICE, CASS],
    ['v-c', CASS, BRAM, DOV],
    ['v-d', DOV, CASS, ESK],
  ];
  const inputs: SettleInput[] = [];
  let first: VentureRecord | null = null;
  for (const [id, creator, carrier, escort] of links) {
    const haul = makeHaul(f, {
      id: vid(id),
      creator,
      carrier: wage(ESCROWED, ELECTIVE),
      escort: share(bps(3_000), 0, 500),
    });
    goLive(f, haul, [carrier, escort], minor(0));
    first ??= haul;
    const claims = computeClaims(haul, minor(0));
    const elections = new Map<number, Minor>();
    for (const r of claims.roles) if (r.electiveDue > 0) elections.set(r.roleIndex, r.electiveDue);
    inputs.push(inp(haul, minor(0), elections, { proceeds: minor(0) }));
  }
  if (first === null) throw new Error('fixture');
  return { f, inputs, first };
}

describe('the deferral re-settlement', () => {
  /**
   * `settleBatch` builds a fresh `Working` per call, so `electivePaid` starts at zero
   * on the deferral's second pass and `payElectiveParts` pays the election again from
   * the top. `settlement.ts:534` has the mirror guard for phase 1 (`deferrals > 0`
   * skips the escrowed parts, so the escrow is not double-drawn); phase 2 has none,
   * and nothing on `VentureRecord` records what a role has already been paid.
   */
  it.fails(
    'DEFECT(venture): a deferred venture re-pays the elective part, overpaying the payee',
    () => {
      const { f, inputs, first } = truncatingChain();
      const payee = first.roles[0]?.filledByPrincipal;
      if (payee === undefined || payee === null) throw new Error('fixture');
      const before = f.ledger.balance(storesAccount(payee));

      settleBatch(f.ledger, f.book, inputs, ACCOUNTS);
      const head = inputs[0];
      if (head === undefined) throw new Error('fixture');
      const second = settleBatch(f.ledger, f.book, [head], ACCOUNTS);

      const claim = second.settlements[0]?.payouts[0]?.claim ?? 0;
      const received = f.ledger.balance(storesAccount(payee)) - before;
      // A role is owed its claim once. Across the deferral it is paid 5200 for 5100.
      expect(received).toBeLessThanOrEqual(claim);
    },
  );

  /**
   * The same bug seen from the record's side, which is the A5' half: the payer has in
   * aggregate paid *more* than the elective part it owed, and the settlement still
   * writes a default against it and drops its standing.
   */
  it.fails(
    'DEFECT(venture): a payer that has over-paid across a deferral is still recorded in default',
    () => {
      const { f, inputs, first } = truncatingChain();
      const payer = first.creator;
      const payee = first.roles[0]?.filledByPrincipal;
      if (payee === undefined || payee === null) throw new Error('fixture');

      settleBatch(f.ledger, f.book, inputs, ACCOUNTS);
      const head = inputs[0];
      if (head === undefined) throw new Error('fixture');
      const second = settleBatch(f.ledger, f.book, [head], ACCOUNTS);
      const s = second.settlements[0];
      if (s === undefined) throw new Error('no settlement');

      const paidInTotal = 5_100; // 300 in pass 1 + 4800 in pass 2, against 5000 due.
      const due = s.payouts[0]?.electiveDue ?? 0;
      expect(paidInTotal).toBeGreaterThanOrEqual(due);
      // A5': the record must never accuse an agent that kept its promise.
      expect(s.defaults.filter((d) => d.payer === payer && d.payee === payee)).toEqual([]);
    },
  );

  /**
   * Phase 1 is skipped for a deferral so the escrow is not drawn twice — correct — but
   * `escrowedPaid` is then reported as zero, so the PUBLIC `venture.settled` payload
   * says the guaranteed half was never delivered. A7's whole claim is that the
   * escrowed part always executes; the receipt for the second pass denies it.
   */
  it.fails(
    'DEFECT(venture): a re-settled deferral publishes escrowedPaid 0 for a half that was paid',
    () => {
      const { f, inputs } = truncatingChain();
      settleBatch(f.ledger, f.book, inputs, ACCOUNTS);
      const head = inputs[0];
      if (head === undefined) throw new Error('fixture');
      const s = settleBatch(f.ledger, f.book, [head], ACCOUNTS).settlements[0];
      const carrier = s?.payouts[0];
      expect(carrier?.escrowedDue).toBeGreaterThan(0);
      // The escrowed half was paid in full on the first pass; the second pass must not
      // report it as outstanding.
      expect(carrier?.escrowedShortfall).toBe(0);
    },
  );
});

describe('the elections map against a residual claim', () => {
  /**
   * `electionFor` caps an election at `electiveDue`, and `electiveDue` on a share role
   * is only known once the seeded residual is drawn at resolution. A payer that elects
   * exactly the server-computed `your_take_at_p50` it countersigned — the only number
   * §7.1 gives it — is recorded as having **DECLINED** the difference when the venture
   * over-performs. There is no "pay in full" election, so honouring a share in full
   * requires over-electing a number the payer has to guess.
   */
  it.fails(
    'DEFECT(venture): electing the countersigned p50 is recorded as DECLINED when the venture over-performs',
    () => {
      const f = fixture();
      const haul = makeHaul(f, { carrier: wage(800, 400), escort: share(bps(3_000), 0, 900) });
      // HAUL p50 = 12_000, p90 = 13_800.
      goLive(f, haul, [ALICE, BRAM], minor(13_800));
      const quoted = computeClaims(haul, minor(12_000));
      const elections = new Map<number, Minor>();
      for (const r of quoted.roles) if (r.electiveDue > 0) elections.set(r.roleIndex, r.electiveDue);

      const s = settleVenture(f.ledger, f.book, inp(haul, minor(13_800), elections), ACCOUNTS);
      // DECLINED means a choice. The payer paid every unit it was ever quoted.
      expect(s.defaults.map((d) => d.cause)).not.toContain('DECLINED');
    },
  );
});

describe('allocation and the world', () => {
  /**
   * `allocateFills` writes the role and the index but never moves the hand out of
   * `IDLE`, and `checkInv9` requires a hand filling a live role to be `COMMITTED` or
   * `IN_TRANSIT`. So the ASSERT phase halts on a state the ALLOCATE phase just
   * created. The builder's `allocation.test.ts` never runs `checkInv9`, and
   * `concurrency.test.ts` only ever reaches it through the fixture's `fill()` helper,
   * which does call `commitHand` — the seam is exactly where the suite does not look.
   */
  it.fails('DEFECT(venture): a granted fill leaves its hand IDLE, which INV-9 halts on', () => {
    const f = fixture();
    const haul = makeHaul(f, { id: vid('v-a') });
    const hand = [...f.world.hands.values()].find((h) => h.principal === BRAM);
    if (hand === undefined) throw new Error('fixture');

    const result = allocateFills(
      f.book,
      [
        {
          venture: haul.id,
          roleIndex: 1,
          principal: BRAM,
          hand: hand.id,
          clientSequence: 1,
          stake: minor(0),
        },
      ],
      { tick: 1, handOf: (id) => f.world.hands.get(id) },
    );
    expect(result.granted).toHaveLength(1);
    expect(handById(f.world, hand.id).state).not.toBe('IDLE');
    expect(checkInv9(f.world, 1, f.book.roleFills())).toEqual([]);
  });

  /**
   * A witness, not a defect: the refusal *reason* for a role index the kind does not
   * have. `venture.roles[i]` is `undefined`, `?.filledByHandId` is therefore
   * `undefined`, and `undefined !== null` reads as "somebody else won this slot".
   * Fixed in `allocation.ts`; kept as a regression.
   */
  it('reports a nonexistent role index as a rule refusal, not a lost contest', () => {
    const f = fixture();
    const haul = makeHaul(f, { id: vid('v-a') });
    const hand = [...f.world.hands.values()].find((h) => h.principal === BRAM);
    if (hand === undefined) throw new Error('fixture');
    const result = allocateFills(
      f.book,
      [
        {
          venture: haul.id,
          roleIndex: 9,
          principal: BRAM,
          hand: hand.id,
          clientSequence: 1,
          stake: minor(0),
        },
      ],
      { tick: 1, handOf: (id) => f.world.hands.get(id) },
    );
    expect(result.refused[0]?.reason).toBe('ROLE_RULE');
    expect(result.refused[0]?.hint).toContain('no role at index 9');
  });
});

describe('witnesses — behaviour the builder s suite never constructs', () => {
  /**
   * A loss outcome may legitimately be short of its escrowed parts, so an escrow that
   * was **never funded at all** settles clean as a recorded loss with no default and no
   * standing movement — provided the outcome is one of the four loss kinds. Whether a
   * creator can choose `WITHDRAWN` is the caller's business; the venture module does
   * not stop it, so nothing here guarantees the escrowed half is ever honoured.
   */
  it('a WITHDRAWN venture with an empty escrow is a loss, not a default', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(0));
    const escrow = ACCOUNTS.escrowOf(haul);
    f.ledger.seizeCurrency({
      eventId: ev('drain'),
      tick: 200,
      from: escrow,
      to: storesAccount(CASS),
      amount: f.ledger.balance(escrow),
    });
    const s = settleVenture(
      f.ledger,
      f.book,
      inp(haul, minor(0), new Map(), { outcome: 'WITHDRAWN', causeEventId: ev('drain') }),
      ACCOUNTS,
    );
    expect(s.recordedLoss).toBeGreaterThan(0);
    expect(s.defaults).toEqual([]);
    expect(s.standing).toEqual([]);
    expect(s.terminalState).toBe('SETTLED');
  });

  /**
   * `truncated` is a property of the whole batch, so a payer that is genuinely broke
   * defers rather than defaults whenever *some other* venture in the same Reckoning
   * kept the cascade progressing to the round limit. Disclosed by the builder and
   * conservative in the safe direction (never a fabricated breach); recorded here
   * because it is the surface a Gate 3 grief probe should aim at.
   */
  it('an unrelated broke payer defers because another chain truncated the cascade', () => {
    const { f, inputs } = truncatingChain();
    const broke = makeHaul(f, {
      id: vid('v-zzz'),
      creator: ESK,
      carrier: wage(100, 5_000),
      escort: share(bps(3_000), 0, 500),
    });
    goLive(f, broke, [CASS, DOV], minor(0));
    const claims = computeClaims(broke, minor(0));
    const el = new Map<number, Minor>();
    for (const r of claims.roles) if (r.electiveDue > 0) el.set(r.roleIndex, r.electiveDue);
    const batch = settleBatch(f.ledger, f.book, [...inputs, inp(broke, minor(0), el, { proceeds: minor(0) })], ACCOUNTS);
    const zzz = batch.settlements.find((s) => s.venture === 'v-zzz');
    expect(batch.truncated).toBe(true);
    expect(zzz?.terminalState).toBe('DEFERRED');
    expect(zzz?.defaults).toEqual([]);
  });

  /**
   * `settleBatch` does not de-duplicate its input, so the same venture twice in one
   * batch draws its escrow twice and the second draw presents as an unfunded signature
   * — a `SettlementHalt`, i.e. the world halting on a caller mistake rather than
   * refusing it. `settlementSet` returns each venture once, so this is a landmine
   * rather than a live bug.
   */
  it('the same venture twice in one batch halts instead of being refused', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(12_000));
    const one = inp(haul, minor(12_000));
    expect(() => settleBatch(f.ledger, f.book, [one, one], ACCOUNTS)).toThrow();
  });
});

describe('PROP-V3 tests the claim, not the payment', () => {
  /**
   * A witness against the builder's own claim that PROP-V3 checks "what a real
   * settlement *pays* at p50, through a real Ledger". `takeAtPercentile` and
   * `settleVenture` both route through the same `computeClaims(venture, proceeds,
   * allIndices)` call, so `preview.test.ts`'s 300-case property compares one function's
   * output with itself and never reads a balance. Mutating the escrowed transfer amount
   * in `payEscrowedParts` leaves that property green; only four balance-comparing spot
   * tests elsewhere catch it. This test states the missing assertion.
   */
  it('a settlement pays the quoted claim into the holder s STORES', () => {
    const f = fixture();
    const haul = makeHaul(f, { carrier: wage(1_000, 1_000), escort: share(bps(3_000), 500, 700) });
    goLive(f, haul, [ALICE, BRAM], minor(12_000));
    const claims = computeClaims(haul, minor(12_000));
    const elections = new Map<number, Minor>();
    for (const r of claims.roles) if (r.electiveDue > 0) elections.set(r.roleIndex, r.electiveDue);

    const before = f.ledger.balance(storesAccount(BRAM));
    const s = settleVenture(f.ledger, f.book, inp(haul, minor(12_000), elections), ACCOUNTS);
    const escort = s.payouts[1];
    if (escort === undefined) throw new Error('no escort payout');
    // The quote, the claim and the money that moved are one number.
    expect(escort.claim).toBe(claims.roles[1]?.claim);
    expect(f.ledger.balance(storesAccount(BRAM)) - before).toBe(escort.claim);
  });
});
