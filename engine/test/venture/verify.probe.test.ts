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
    actedOnStateVersion: STATE_VERSION,
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
   * **Fixed.** `settleBatch` built a fresh `Working` per call, so `electivePaid` started
   * at zero on the deferral's second pass and `payElectiveParts` paid the election again
   * from the top. Phase 1 had the mirror guard (`deferrals > 0` skipped the escrowed
   * parts, so the escrow was not double-drawn); phase 2 had none, and nothing on
   * `VentureRecord` recorded what a role had already been paid.
   *
   * The paid-so-far figures now live on the venture's own rows
   * (`VentureRoleRecord.settledElectiveMinor`, `VentureRecord.escrowExecutedAtTick`) and
   * both phases read them. Kept as a regression: `test/venture/deferral.test.ts` covers
   * the same ground from the record's side.
   */
  it('does not re-pay the elective part, so the payee is not overpaid', () => {
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
    // A role is owed its claim once. Before the fix it was paid 5200 for 5100.
    expect(received).toBeLessThanOrEqual(claim);
  });

  /**
   * **Fixed.** The same bug seen from the record's side, which is the A5' half: the payer
   * had in aggregate paid *more* than the elective part it owed, and the settlement still
   * wrote a default against it and dropped its standing.
   */
  it('records no default against a payer that has paid the elective part across a deferral', () => {
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

    const paidInTotal = s.payouts[0]?.electivePaid ?? 0;
    const due = s.payouts[0]?.electiveDue ?? 0;
    expect(paidInTotal).toBeGreaterThanOrEqual(due);
    // A5': the record must never accuse an agent that kept its promise.
    expect(s.defaults.filter((d) => d.payer === payer && d.payee === payee)).toEqual([]);
  });

  /**
   * **Fixed.** Phase 1 is skipped for a deferral so the escrow is not drawn twice —
   * correct — but `escrowedPaid` was then reported as zero, so the PUBLIC
   * `venture.settled` payload said the guaranteed half was never delivered. A7's whole
   * claim is that the escrowed part always executes; the receipt for the second pass
   * denied it, and `checkSettlementExact` passed because `0 + due === due`.
   */
  it('publishes escrowedPaid in full on a re-settled deferral', () => {
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
  });
});

describe('the elections map against a residual claim', () => {
  /**
   * **Resolved, by adding vocabulary rather than by changing this branch.**
   *
   * The defect this probe was filed against was real: `electiveDue` on a share role is
   * only known once the seeded residual is drawn, so a payer electing the one number
   * §7.1 gives it — the countersigned `your_take_at_p50` — was recorded as having
   * DECLINED the difference whenever the venture over-performed, and the only escape was
   * to over-elect a figure nothing documented.
   *
   * The fix added {@link IN_FULL}: the election that states the intention instead of
   * guessing the amount. It deliberately did **not** change what a *named amount* means,
   * and that is the right call — `roleDeclined = electiveDue - want` is the engine's own
   * definition of a decline, and a payer that names 3240 against a due of 3780 has, by
   * that definition, declined 540. The defect was never in this branch; it was that the
   * API had no way to say "all of it".
   *
   * So this stays as a **witness** on the named-amount path, not an `it.fails` pin. It
   * was left as `it.fails` after the fix landed, which meant the suite recorded a live
   * A5' defect that `test/venture/election.test.ts`'s
   * "is what an agent electing only its countersigned p50 would otherwise be punished
   * for" simultaneously asserted was correct behaviour — two tests in one module
   * encoding opposite rules for one input, which is scar #1 inside the suite meant to
   * catch it.
   */
  it('records a named amount below the drawn due as DECLINED, which is why IN_FULL exists', () => {
    const f = fixture();
    const haul = makeHaul(f, { carrier: wage(800, 400), escort: share(bps(3_000), 0, 900) });
    // HAUL p50 = 12_000, p90 = 13_800.
    goLive(f, haul, [ALICE, BRAM], minor(13_800));
    const quoted = computeClaims(haul, minor(12_000));
    const elections = new Map<number, Minor>();
    for (const r of quoted.roles) if (r.electiveDue > 0) elections.set(r.roleIndex, r.electiveDue);

    const s = settleVenture(f.ledger, f.book, inp(haul, minor(13_800), elections), ACCOUNTS);
    // The named amount is a bet, and the venture beat it. `IN_FULL` is the election
    // that never has to bet — see test/venture/election.test.ts for the pair.
    expect(s.defaults.map((d) => d.cause)).toContain('DECLINED');
    const escort = s.payouts[1];
    if (escort === undefined) throw new Error('no escort payout');
    expect(escort.electiveDue).toBeGreaterThan(quoted.roles[1]?.electiveDue ?? 0);
  });
});

describe('allocation and the world', () => {
  /**
   * **Fixed.** `allocateFills` wrote the role and the index but never moved the hand out
   * of `IDLE`, and `checkInv9` requires a hand filling a live role to be `COMMITTED` or
   * `IN_TRANSIT`. So the ASSERT phase halted on a state the ALLOCATE phase had just
   * created. The builder's `allocation.test.ts` never ran `checkInv9`, and
   * `concurrency.test.ts` only ever reached it through the fixture's `fill()` helper,
   * which does call `commitHand` — the seam was exactly where the suite did not look.
   *
   * `allocateFills` now calls the world's own `commitHand` in the same phase as the
   * grant, and rolls the fill back if the world refuses. `test/venture/presence.test.ts`
   * carries the rest of the seam, including the settlement side.
   */
  it('commits the hand it grants a role to, so INV-9 has nothing to halt on', () => {
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
   * `settleBatch` refuses a duplicate rather than settling one obligation twice.
   *
   * As filed, it did not de-duplicate at all: the same venture twice drew its escrow
   * twice and the second draw presented as an *unfunded signature*, so the world halted
   * with a message about a raid that had not happened. The halt is right — two receipts
   * for one promise is a record nobody can read, and §15.2 says abort rather than publish
   * — but the reason has to be the real one, so `settleBatch` now names the duplicate.
   * (`settlementSet` returns each venture once, so this remains a landmine rather than a
   * live bug.)
   */
  it('the same venture twice in one batch halts instead of being refused', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(12_000));
    const one = inp(haul, minor(12_000));
    expect(() => settleBatch(f.ledger, f.book, [one, one], ACCOUNTS)).toThrow();
  });
});

describe('PROP-V3 tests the payment, not only the claim', () => {
  /**
   * **Fixed.** As filed, `takeAtPercentile` and `settleVenture` both routed through the
   * same `computeClaims(venture, proceeds, allIndices)` call, so `preview.test.ts`'s
   * 300-case property compared one function's output with itself and never read a
   * balance: mutating the escrowed transfer amount in `payEscrowedParts` to `p.paid - 1`
   * left the whole property green, and only four balance-comparing spot tests elsewhere
   * caught it.
   *
   * The property now elects `IN_FULL` and asserts the delta in the holder's STORES
   * against the quoted p50, so the same mutation fails it on the first of 300 cases.
   * This spot test — the one the verifier wrote — is kept as the smallest statement of
   * the same claim.
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
