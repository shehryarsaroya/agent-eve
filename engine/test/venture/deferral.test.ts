/**
 * §15.3's deferral, and the memory it has to have.
 *
 * > escrowed parts -> elective parts in `venture_id` order -> cascade in <=3 fixed
 * > rounds, and **an obligation still unresolved at the round limit DEFERS to the
 * > next Reckoning; it never defaults**. — §15.3
 *
 * A deferral is *one obligation settled over more than one Reckoning*, so every
 * question settlement asks — "how much is still owed", "was the guaranteed half
 * delivered", "did the payer decline" — is a question about the whole obligation and
 * not about the current pass. The first build answered all three from a `Working`
 * rebuilt per call, and every answer was wrong on the second pass: the elective part
 * was re-paid from zero (double-charging the payer and over-paying the payee), the
 * receipt published the escrowed half as undelivered, and a default was written
 * against a payer that had by then paid **more** than it owed.
 *
 * That is A5' exactly — "a fabricated default libels a real agent permanently and is
 * worse than a crash" — produced by the machinery §15.3 added to prevent it. So the
 * paid-so-far figures live on the venture's own rows and both phases read them.
 */

import { describe, expect, it } from 'vitest';
import { bps, minor, type Minor } from '../../src/core/units.js';
import type { PrincipalId } from '../../src/core/types.js';
import {
  CURRENCY_FAUCET,
  checkLedgerInvariants,
  escrowAccount,
  storesAccount,
} from '../../src/ledger/index.js';
import { checkInv9 } from '../../src/world/index.js';
import {
  IN_FULL,
  MAX_DEFERRALS,
  SettlementHalt,
  VENTURE_EVENT_KINDS,
  checkSettlementExact,
  checkVentureInvariants,
  computeClaims,
  settleBatch,
  settlementEvents,
  termsHashOf,
  type Election,
  type ReceiptContext,
  type SettleInput,
  type SettlementBatch,
  type VentureRecord,
  type VentureSettlement,
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
  ev,
  fixture,
  goLive,
  makeHaul,
  presenceOf,
  share,
  vid,
  wage,
  type Fixture,
} from './fixture.js';

const ESCROWED = 100;
const ELECTIVE = 5_000;

function inp(
  venture: VentureRecord,
  elections: ReadonlyMap<number, Election>,
  overrides: Partial<SettleInput> = {},
): SettleInput {
  return {
    venture,
    tick: 287,
    eventId: ev(`settle:${venture.id}`),
    outcome: 'FULFILLED',
    proceeds: minor(0),
    elections,
    actedOnStateVersion: STATE_VERSION,
    causeEventId: null,
    ...overrides,
  };
}

function receipts(tick = 287): ReceiptContext {
  return {
    tick,
    rulesVersion: RULES_VERSION,
    actedOnStateVersion: STATE_VERSION,
    familyOf: (venture) => `family:${venture}`,
    parentEventId: null,
  };
}

function only(batch: SettlementBatch): VentureSettlement {
  const s = batch.settlements[0];
  if (s === undefined) throw new Error('the batch produced no settlement');
  return s;
}

/**
 * The four-venture reverse payment chain from `slice.test.ts`: dependency order is
 * the reverse of `venture_id` order, so `v-a` is still unpaid when the round limit
 * stops the cascade and it defers. Reproduced here because the *second* settlement is
 * what this file is about.
 */
function truncatingChain(): {
  readonly f: Fixture;
  readonly inputs: SettleInput[];
  readonly first: VentureRecord;
} {
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
      // Escrowed 0 on the escort, so the escrow requirement is exactly ESCROWED.
      escort: share(bps(3_000), 0, 500),
    });
    goLive(f, haul, [carrier, escort], minor(0));
    first ??= haul;
    const claims = computeClaims(haul, minor(0));
    const elections = new Map<number, Election>();
    for (const r of claims.roles) if (r.electiveDue > 0) elections.set(r.roleIndex, r.electiveDue);
    inputs.push(inp(haul, elections));
  }
  if (first === null) throw new Error('fixture');
  return { f, inputs, first };
}

/** Settle the chain, then settle the deferred head again. The two-Reckoning shape. */
function acrossTheDeferral(): {
  readonly f: Fixture;
  readonly first: VentureRecord;
  readonly payee: PrincipalId;
  readonly before: Minor;
  readonly second: VentureSettlement;
} {
  const { f, inputs, first } = truncatingChain();
  const payee = first.roles[0]?.filledByPrincipal;
  if (payee === null || payee === undefined) throw new Error('fixture');
  const before = f.ledger.balance(storesAccount(payee));

  const head = inputs[0];
  if (head === undefined) throw new Error('fixture');
  settleBatch(f.ledger, f.book, inputs, ACCOUNTS, presenceOf(f));
  expect(first.state).toBe('DEFERRED');
  return { f, first, payee, before, second: only(settleBatch(f.ledger, f.book, [head], ACCOUNTS, presenceOf(f))) };
}

describe('a deferred venture remembers what it already paid', () => {
  it('pays a role its claim exactly once across the two Reckonings', () => {
    const { f, payee, before, second } = acrossTheDeferral();
    const carrier = second.payouts[0];
    if (carrier === undefined) throw new Error('no carrier payout');
    // 100 escrowed + 5000 elective. Before the fix the payee received 5200 for a
    // 5100 claim, because the elective part was re-paid from zero.
    expect(carrier.claim).toBe(ESCROWED + ELECTIVE);
    expect(f.ledger.balance(storesAccount(payee)) - before).toBe(carrier.claim);
  });

  it('never charges the payer more than the elective part it owed', () => {
    const { first, second } = acrossTheDeferral();
    const carrier = second.payouts[0];
    if (carrier === undefined) throw new Error('no carrier payout');
    expect(carrier.electivePaid).toBe(carrier.electiveDue);
    expect(carrier.electivePaid).toBeLessThanOrEqual(ELECTIVE);
    // The paid-so-far figure lives on the row, which is what makes the second pass
    // able to answer "how much is still owed" at all.
    expect(first.roles[0]?.settledElectiveMinor).toBe(ELECTIVE);
  });

  it('records no default against a payer that paid the elective part in full', () => {
    const { first, second } = acrossTheDeferral();
    // A5': the record must never accuse an agent that kept its promise.
    expect(second.defaults).toEqual([]);
    expect(second.unattributed).toBe(0);
    expect(second.terminalState).toBe('SETTLED');
    expect(first.state).toBe('SETTLED');
  });

  it('credits the elective part honoured once, at the value actually paid', () => {
    const { second, first } = acrossTheDeferral();
    const honoured = second.standing.filter((x) => x.cause === 'ELECTIVE_HONOURED');
    expect(honoured).toHaveLength(1);
    expect(honoured[0]?.principal).toBe(first.creator);
    expect(honoured[0]?.electiveHonouredValue).toBe(ELECTIVE);
    expect(second.standing.filter((x) => x.cause === 'DEFAULT')).toEqual([]);
  });

  it('publishes the escrowed half as delivered on the re-settlement receipt (A7)', () => {
    const { second } = acrossTheDeferral();
    const carrier = second.payouts[0];
    expect(carrier?.escrowedDue).toBe(ESCROWED);
    // A7's whole claim is that the escrowed part always executes. Publishing
    // `escrowedPaid: 0` against a half that was paid in full denies it on the record.
    expect(carrier?.escrowedPaid).toBe(ESCROWED);
    expect(carrier?.escrowedShortfall).toBe(0);
    expect(second.recordedLoss).toBe(0);

    const rows = settlementEvents(second, ALICE, receipts());
    const settled = rows.find((e) => e.kind === VENTURE_EVENT_KINDS.settled);
    const payouts = settled?.payload['payouts'];
    if (!Array.isArray(payouts)) throw new Error('the settled receipt carries no payouts');
    expect((payouts[0] as { escrowedPaid?: number }).escrowedPaid).toBe(ESCROWED);
    // And no second recorded-loss row for a loss that never happened.
    expect(rows.filter((e) => e.kind === VENTURE_EVENT_KINDS.loss)).toEqual([]);
  });

  it('does not draw the escrow twice, and leaves the ledger whole', () => {
    const { f, first, second } = acrossTheDeferral();
    expect(f.ledger.balance(escrowAccount(first.id, first.creator))).toBe(0);
    expect(checkSettlementExact(second, 288)).toEqual([]);
    expect(checkVentureInvariants(f.book, 288)).toEqual([]);
    expect(
      checkLedgerInvariants(f.ledger, {
        tick: 288,
        obligations: { isLive: () => false, securedObligations: () => [] },
      }),
    ).toEqual([]);
    expect(checkInv9(f.world, 288, f.book.roleFills())).toEqual([]);
  });

  it('defaults for the unpaid remainder only, when the payer withdraws at the second Reckoning', () => {
    // The venture defers at Reckoning 1 having paid part of the elective half, and at
    // Reckoning 2 the payer elects only what it has already paid — it withdraws the rest.
    // That is a real decline, and the amount on the row must be the **remainder**, never
    // the whole elective part the first pass had already partly honoured.
    const { f, inputs, first } = truncatingChain();
    settleBatch(f.ledger, f.book, inputs, ACCOUNTS, presenceOf(f));
    expect(first.state).toBe('DEFERRED');
    const paidOnPassOne = first.roles[0]?.settledElectiveMinor ?? minor(0);
    expect(paidOnPassOne).toBeGreaterThan(0);
    expect(paidOnPassOne).toBeLessThan(ELECTIVE);

    const withdrawn = inp(first, new Map<number, Election>([[0, paidOnPassOne]]));
    const second = only(settleBatch(f.ledger, f.book, [withdrawn], ACCOUNTS, presenceOf(f)));
    expect(second.payouts[0]?.electivePaid).toBe(paidOnPassOne);
    expect(second.defaults).toHaveLength(1);
    expect(second.defaults[0]?.cause).toBe('DECLINED');
    expect(second.defaults[0]?.amount).toBe(ELECTIVE - paidOnPassOne);
    // And the standing hit is the remainder too, not the whole promise.
    expect(second.standing.map((x) => x.defaultedValue)).toEqual([ELECTIVE - paidOnPassOne]);
  });

  it('halts rather than settling past the deferral bound', () => {
    const { f, inputs, first } = truncatingChain();
    first.deferrals = MAX_DEFERRALS + 1;
    expect(() => settleBatch(f.ledger, f.book, inputs, ACCOUNTS, presenceOf(f))).toThrow();
  });

  it('halts rather than publishing a role paid more than a re-quoted deferral makes it due', () => {
    // §15.3's second pass divides the *same* pot, so the proceeds are pinned by the
    // caller. A driver that re-quotes them shrinks `electiveDue` below what the first
    // pass already paid: the receipt would then say a role was overpaid and
    // `electiveShortfall` would go negative, deleting a default that was real.
    const { f, inputs, first } = truncatingChain();
    const head = inputs[0];
    if (head === undefined) throw new Error('fixture');
    settleBatch(f.ledger, f.book, inputs, ACCOUNTS, presenceOf(f));
    expect(first.state).toBe('DEFERRED');
    expect(first.roles[0]?.settledElectiveMinor).toBeGreaterThan(0);

    // The carrier is on a wage, so shrinking the proceeds cannot shrink its claim —
    // shrink the pinned escrowed figure's counterpart instead by re-quoting the wage
    // itself, which is what a driver rebuilding terms from a fresh read would do.
    const carrier = first.roles[0];
    if (carrier === undefined) throw new Error('fixture');
    (carrier as { terms: typeof carrier.terms }).terms = wage(ESCROWED, 100);
    first.termsHash = null;
    first.termsHash = termsHashOf(first);

    expect(() => settleBatch(f.ledger, f.book, [head], ACCOUNTS, presenceOf(f))).toThrow(SettlementHalt);
  });
});

describe('the escrowed half executes exactly once, and its marker says so', () => {
  it('is not skipped merely because the deferral counter is non-zero', () => {
    // `deferrals > 0` was the proxy for "the escrowed half already ran". It is not the
    // same fact: a venture can carry a deferral count without ever having settled, and
    // skipping phase 1 then strands the escrow forever and publishes a shortfall for a
    // guaranteed half nobody ever tried to pay.
    const { f, inputs, first } = truncatingChain();
    first.deferrals = MAX_DEFERRALS;
    const escrow = escrowAccount(first.id, first.creator);
    expect(f.ledger.balance(escrow)).toBe(ESCROWED);

    const batch = settleBatch(f.ledger, f.book, inputs, ACCOUNTS, presenceOf(f));
    const head = batch.settlements.find((s) => s.venture === first.id);
    expect(head?.payouts[0]?.escrowedPaid).toBe(ESCROWED);
    expect(head?.payouts[0]?.escrowedShortfall).toBe(0);
    expect(f.ledger.balance(escrow)).toBe(0);
    expect(first.escrowExecutedAtTick).toBe(287);
  });

  it('marks a plain settlement as having executed its escrowed half', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(12_000));
    expect(haul.escrowExecutedAtTick).toBeNull();
    settleBatch(
      f.ledger,
      f.book,
      [inp(haul, new Map<number, Election>([[1, IN_FULL]]), { proceeds: minor(12_000) })],
      ACCOUNTS,
      presenceOf(f),
    );
    expect(haul.escrowExecutedAtTick).toBe(287);
  });

  it('reports a re-settled loss shortfall without recording the loss a second time', () => {
    // A raided escrow on a loss outcome is a recorded loss (§10.2). If the venture then
    // defers, the second pass must still say the guaranteed half fell short — that is
    // true — without publishing a second loss row for the same destroyed value.
    const { f, inputs, first } = truncatingChain();
    const head = inputs[0];
    if (head === undefined) throw new Error('fixture');
    f.ledger.seizeCurrency({
      eventId: ev('raid'),
      tick: 200,
      from: escrowAccount(first.id, first.creator),
      to: storesAccount(CASS),
      amount: minor(ESCROWED),
    });
    const lossy: SettleInput = { ...head, outcome: 'CARGO_LOST', causeEventId: ev('raid') };

    const one = settleBatch(f.ledger, f.book, [lossy, ...inputs.slice(1)], ACCOUNTS, presenceOf(f));
    expect(one.settlements.find((s) => s.venture === first.id)?.recordedLoss).toBe(ESCROWED);
    expect(first.state).toBe('DEFERRED');

    const second = only(settleBatch(f.ledger, f.book, [lossy], ACCOUNTS, presenceOf(f)));
    expect(second.recordedLoss).toBe(0);
    expect(second.payouts[0]?.escrowedPaid).toBe(0);
    expect(second.payouts[0]?.escrowedShortfall).toBe(ESCROWED);
    expect(settlementEvents(second, ALICE, receipts()).filter((e) => e.kind === VENTURE_EVENT_KINDS.loss)).toEqual([]);
  });
});
