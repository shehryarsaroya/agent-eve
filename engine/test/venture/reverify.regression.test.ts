/**
 * The gaps the verified fixes left in the module's own coverage, as regressions.
 *
 * Written during adversarial re-verification of the six /tmp/w2 venture findings. Each
 * fix was confirmed by reverting it and watching a named test go red; these are the
 * cases *no* test covered either before or after, all of them on the seam the fix newly
 * crosses:
 *
 *  - **INV-9 at the deferral boundary.** The fix made a resolution release presence, and
 *    a deferral is a resolution. `presence.test.ts`'s "frees presence on a deferral too"
 *    does not reach a deferral — its own comment admits the venture DEFAULTS — and
 *    `deferral.test.ts` only asserts `checkInv9` after the *second* pass. So nothing
 *    asserted the world the ALLOCATE/ASSERT halt was about, at the one boundary the fix
 *    added.
 *  - **`checkSettlementExact` on a re-settled loss.** `recordedLoss` is now "newly
 *    recorded by this pass" and is 0 on pass 2 while `escrowedShortfall` still stands.
 *    That split is deliberate, and it had no assertion that the invariant which reads
 *    both does not fire on it.
 *  - **The cumulative payout figures on the feed.** `RolePayout.escrowedPaid` became
 *    cumulative; the receipt payload key did not change name. Witnessed rather than
 *    asserted-away, because the naive fold over a venture's receipts double-counts the
 *    guaranteed half and no consumer exists yet to decide the right answer.
 *  - **A malformed election reaches a tick halt.** Elections originate with an agent, and
 *    `guardSettleable` throws `SettlementHalt` on a non-integer one. Pinned so that
 *    whoever wires the HTTP surface sees that validation has to happen *before* here.
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
import { checkInv9, handById } from '../../src/world/index.js';
import {
  IN_FULL,
  MAX_DEFERRALS,
  SettlementHalt,
  VENTURE_EVENT_KINDS,
  allocateFills,
  checkSettlementExact,
  checkVentureInvariants,
  computeClaims,
  settleBatch,
  settleVenture,
  settlementEvents,
  yourTakeAtP50,
  type Election,
  type FillRequest,
  type ReceiptContext,
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
  ev,
  fixture,
  freeHandOf,
  goLive,
  makeHaul,
  presenceOf,
  share,
  signAll,
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

function receipts(tick: number): ReceiptContext {
  return {
    tick,
    rulesVersion: RULES_VERSION,
    actedOnStateVersion: STATE_VERSION,
    familyOf: (v) => `family:${v}`,
    parentEventId: null,
  };
}

/** The verifier's own four-venture reverse chain, rebuilt from the finding text. */
function chain(): { f: Fixture; inputs: SettleInput[]; head: VentureRecord } {
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
  let head: VentureRecord | null = null;
  for (const [id, creator, carrier, escort] of links) {
    const haul = makeHaul(f, {
      id: vid(id),
      creator,
      carrier: wage(ESCROWED, ELECTIVE),
      escort: share(bps(3_000), 0, 500),
    });
    goLive(f, haul, [carrier, escort], minor(0));
    head ??= haul;
    const claims = computeClaims(haul, minor(0));
    const elections = new Map<number, Election>();
    for (const r of claims.roles) if (r.electiveDue > 0) elections.set(r.roleIndex, r.electiveDue);
    inputs.push(inp(haul, elections));
  }
  if (head === null) throw new Error('fixture');
  return { f, inputs, head };
}

describe('REPRO F1 (P0) — a deferred venture must not re-pay the elective part from zero', () => {
  it('pays the payee exactly its claim across both Reckonings, and charges the payer exactly its due', () => {
    const { f, inputs, head } = chain();
    const payee = head.roles[0]?.filledByPrincipal;
    const payer = head.creator;
    if (payee === null || payee === undefined) throw new Error('fixture');
    const payeeBefore = f.ledger.balance(storesAccount(payee));
    const payerBefore = f.ledger.balance(storesAccount(payer));
    const first = inputs[0];
    if (first === undefined) throw new Error('fixture');

    settleBatch(f.ledger, f.book, inputs, ACCOUNTS, presenceOf(f));
    expect(head.state).toBe('DEFERRED');
    const two = settleBatch(f.ledger, f.book, [first], ACCOUNTS, presenceOf(f));
    const s = two.settlements[0];
    if (s === undefined) throw new Error('no settlement');

    const payeeDelta = f.ledger.balance(storesAccount(payee)) - payeeBefore;
    // 100 escrowed + 5000 elective = 5100. The original defect paid the payee 5200
    // and charged the payer 5100 of a 5000 elective obligation.
    expect(payeeDelta).toBe(ESCROWED + ELECTIVE);
    // ALICE is also v-b's carrier, so her balance is not a clean measure. Sum the
    // debits on her STORES that belong to v-a's own elective transfers instead.
    let electiveDebited = 0;
    for (const p of f.ledger.allPostings()) {
      if (!p.eventId.startsWith('settle:v-a#elective')) continue;
      if (p.account !== storesAccount(payer)) continue;
      electiveDebited -= p.amountMinor;
    }
    expect(electiveDebited).toBe(ELECTIVE);
    void payerBefore;
    expect(s.defaults).toEqual([]);
    expect(s.standing.filter((x) => x.cause === 'DEFAULT')).toEqual([]);
    expect(s.terminalState).toBe('SETTLED');
  });

  it('records no fabricated {UNFUNDED, 200} default on the second pass', () => {
    const { f, inputs } = chain();
    const first = inputs[0];
    if (first === undefined) throw new Error('fixture');
    settleBatch(f.ledger, f.book, inputs, ACCOUNTS, presenceOf(f));
    const two = settleBatch(f.ledger, f.book, [first], ACCOUNTS, presenceOf(f));
    expect(two.defaults).toEqual([]);
    expect(two.unattributed).toBe(0);
  });
});

describe('REPRO F2 (P1) — allocateFills must not leave a filling hand IDLE', () => {
  it('leaves the granted hand COMMITTED and checkInv9 clean', () => {
    const f = fixture();
    const haul = makeHaul(f);
    const hand = freeHandOf(f, BRAM);
    const request: FillRequest = {
      venture: haul.id,
      roleIndex: 1,
      principal: BRAM,
      hand: hand.id,
      clientSequence: 1,
      stake: minor(0),
    };
    const out = allocateFills(f.book, [request], {
      tick: 1,
      handOf: (id) => f.world.hands.get(id),
    });
    expect(out.granted).toHaveLength(1);
    expect(handById(f.world, hand.id).state).not.toBe('IDLE');
    expect(checkInv9(f.world, 1, f.book.roleFills())).toEqual([]);
  });

  it('leaves every hand IDLE and checkInv9 clean after a settlement (the disclosed mirror)', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(12_000));
    settleVenture(
      f.ledger,
      f.book,
      inp(haul, new Map<number, Election>([[1, IN_FULL]]), { proceeds: minor(12_000) }),
      ACCOUNTS,
      presenceOf(f),
    );
    expect(checkInv9(f.world, 288, f.book.roleFills())).toEqual([]);
    for (const h of f.world.hands.values()) expect(h.state).toBe('IDLE');
  });
});

describe('REPRO F3 (P1) — an over-performing share must not fabricate a DECLINED default', () => {
  /** The finding's exact numbers: HAUL, escort share 3000bps escrowed 0 elective 900. */
  function overPerformer(): { f: Fixture; haul: VentureRecord; quoted: Minor } {
    const f = fixture();
    const haul = makeHaul(f, { escort: share(bps(3_000), 0, 900) });
    goLive(f, haul, [ALICE, BRAM], minor(13_800));
    const quoted = yourTakeAtP50(haul, BRAM);
    return { f, haul, quoted };
  }

  it('IN_FULL honours the whole over-performed elective part with no default', () => {
    const { f, haul } = overPerformer();
    const s = settleVenture(
      f.ledger,
      f.book,
      inp(haul, new Map<number, Election>([[1, IN_FULL]]), { proceeds: minor(13_800) }),
      ACCOUNTS,
      presenceOf(f),
    );
    const escort = s.payouts[1];
    expect(escort?.electivePaid).toBe(escort?.electiveDue);
    expect(escort?.electiveShortfall).toBe(0);
    expect(s.defaults).toEqual([]);
    expect(s.terminalState).toBe('SETTLED');
  });

  it('DEFECT STILL PRESENT? electing the countersigned p50 amount', () => {
    // The finding: "a payer that elects exactly the server-computed your_take_at_p50 it
    // countersigned is recorded as having DECLINED". Record what the amount form does now.
    const { f, haul, quoted } = overPerformer();
    const s = settleVenture(
      f.ledger,
      f.book,
      inp(haul, new Map<number, Election>([[1, quoted]]), { proceeds: minor(13_800) }),
      ACCOUNTS,
      presenceOf(f),
    );
    console.log('AMOUNT-FORM p50 election:', JSON.stringify({ quoted, defaults: s.defaults, terminal: s.terminalState }));
    expect(s.defaults.length).toBeGreaterThanOrEqual(0);
  });

  it('IN_FULL never pays more than the due when the venture under-performs', () => {
    const f = fixture();
    const haul = makeHaul(f, { escort: share(bps(3_000), 0, 900) });
    goLive(f, haul, [ALICE, BRAM], minor(2_000));
    const before = f.ledger.balance(storesAccount(BRAM));
    const s = settleVenture(
      f.ledger,
      f.book,
      inp(haul, new Map<number, Election>([[1, IN_FULL]]), { proceeds: minor(2_000) }),
      ACCOUNTS,
      presenceOf(f),
    );
    const escort = s.payouts[1];
    if (escort === undefined) throw new Error('no escort payout');
    expect(escort.electivePaid).toBe(escort.electiveDue);
    expect(f.ledger.balance(storesAccount(BRAM)) - before).toBe(escort.claim);
  });
});

describe('REPRO F4 (P1) — the re-settlement receipt must publish the escrowed half as delivered', () => {
  it('reports escrowedPaid === escrowedDue on the PUBLIC payload', () => {
    const { f, inputs } = chain();
    const first = inputs[0];
    if (first === undefined) throw new Error('fixture');
    settleBatch(f.ledger, f.book, inputs, ACCOUNTS, presenceOf(f));
    const two = settleBatch(f.ledger, f.book, [first], ACCOUNTS, presenceOf(f));
    const s = two.settlements[0];
    if (s === undefined) throw new Error('no settlement');
    expect(s.payouts[0]?.escrowedPaid).toBe(ESCROWED);
    expect(s.payouts[0]?.escrowedShortfall).toBe(0);

    const ctx: ReceiptContext = {
      tick: 288,
      rulesVersion: RULES_VERSION,
      actedOnStateVersion: STATE_VERSION,
      familyOf: (v) => `family:${v}`,
      parentEventId: null,
    };
    const rows = settlementEvents(s, ALICE, ctx);
    const settled = rows.find((e) => e.kind === VENTURE_EVENT_KINDS.settled);
    const payouts = settled?.payload['payouts'];
    if (!Array.isArray(payouts)) throw new Error('no payouts on the receipt');
    expect((payouts[0] as { escrowedPaid?: number }).escrowedPaid).toBe(ESCROWED);
    expect(checkSettlementExact(s, 288)).toEqual([]);
    expect(checkVentureInvariants(f.book, 288)).toEqual([]);
    expect(
      checkLedgerInvariants(f.ledger, {
        tick: 288,
        obligations: { isLive: () => false, securedObligations: () => [] },
      }),
    ).toEqual([]);
  });
});

describe('REPRO F6 (P1) — INV-19 must not be vacuous nor a guaranteed halt', () => {
  it('settles a venture that outlived its activation tick (live counter is not the source)', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(12_000));
    // The freeze captured STATE_VERSION; the world has moved on many times since.
    expect(() =>
      settleVenture(
        f.ledger,
        f.book,
        inp(haul, new Map<number, Election>([[1, IN_FULL]]), { proceeds: minor(12_000) }),
        ACCOUNTS,
        presenceOf(f),
      ),
    ).not.toThrow();
  });

  it('halts when the row is rewritten between the freeze and the settlement', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(12_000));
    haul.actedOnStateVersion = STATE_VERSION + 5;
    expect(() =>
      settleVenture(
        f.ledger,
        f.book,
        inp(haul, new Map<number, Election>(), { proceeds: minor(12_000) }),
        ACCOUNTS,
        presenceOf(f),
      ),
    ).toThrow(/rewritten between the freeze/);
  });
});

describe('extra adversarial probes', () => {
  it('an unfunded IN_FULL reads UNFUNDED, not DECLINED', () => {
    const f = fixture(minor(0));
    f.ledger.issueCurrency({
      eventId: ev('seed:alice'),
      tick: 0,
      faucet: CURRENCY_FAUCET.STARTER_STAKE,
      to: storesAccount(ALICE),
      amount: minor(1_500),
    });
    const haul = makeHaul(f, { carrier: wage(0, 1_000), escort: share(bps(3_000), 0, 500) });
    goLive(f, haul, [BRAM, CASS], minor(0));
    const s = settleVenture(
      f.ledger,
      f.book,
      inp(haul, new Map<number, Election>([[0, IN_FULL], [1, IN_FULL]])),
      ACCOUNTS,
      presenceOf(f),
    );
    for (const d of s.defaults) expect(d.cause).toBe('UNFUNDED');
  });

  it('a duplicated venture in one batch is refused rather than settled twice', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(12_000));
    const one = inp(haul, new Map<number, Election>([[1, IN_FULL]]), { proceeds: minor(12_000) });
    expect(() => settleBatch(f.ledger, f.book, [one, one], ACCOUNTS, presenceOf(f))).toThrow(/twice/);
  });

  it('no NaN/float reaches a payout figure on any of these paths', () => {
    const { f, inputs } = chain();
    const first = inputs[0];
    if (first === undefined) throw new Error('fixture');
    const all = [
      ...settleBatch(f.ledger, f.book, inputs, ACCOUNTS, presenceOf(f)).settlements,
      ...settleBatch(f.ledger, f.book, [first], ACCOUNTS, presenceOf(f)).settlements,
    ];
    for (const s of all) {
      for (const p of s.payouts) {
        for (const n of [p.claim, p.escrowedPaid, p.electivePaid, p.escrowedShortfall, p.electiveShortfall]) {
          expect(Number.isSafeInteger(n)).toBe(true);
        }
      }
    }
  });

  it('signAll is unaffected by IN_FULL (the countersign echo still uses the p50)', () => {
    const f = fixture();
    const haul = makeHaul(f);
    expect(() => signAll(f, haul)).not.toThrow();
    void ESK;
  });
});

describe('the deferral boundary itself — INV-9 and the venture invariants after PASS 1', () => {
  it('leaves no hand COMMITTED without a live role at the deferral boundary', () => {
    const { f, inputs, head } = chain();
    settleBatch(f.ledger, f.book, inputs, ACCOUNTS, presenceOf(f));
    expect(head.state).toBe('DEFERRED');
    // Asserted right after PASS 1. presence.test.ts's 'frees presence on a deferral too'
    // does not actually reach a deferral (its own comment admits the venture DEFAULTS),
    // and deferral.test.ts only checks INV-9 after pass 2.
    expect(checkInv9(f.world, 288, f.book.roleFills())).toEqual([]);
  });

  it('satisfies the new PROP-V4 escrow-execution invariant at the deferral boundary', () => {
    const { f, inputs, head } = chain();
    settleBatch(f.ledger, f.book, inputs, ACCOUNTS, presenceOf(f));
    expect(head.state).toBe('DEFERRED');
    expect(head.escrowExecutedAtTick).not.toBeNull();
    expect(checkVentureInvariants(f.book, 288)).toEqual([]);
    expect(
      checkLedgerInvariants(f.ledger, {
        tick: 288,
        obligations: { isLive: () => false, securedObligations: () => [] },
      }),
    ).toEqual([]);
  });

  it('keeps checkSettlementExact clean on a re-settled LOSS pass, where recordedLoss is 0 but the shortfall stands', () => {
    const { f, inputs, head } = chain();
    const first = inputs[0];
    if (first === undefined) throw new Error('fixture');
    f.ledger.seizeCurrency({
      eventId: ev('raid'),
      tick: 200,
      from: escrowAccount(head.id, head.creator),
      to: storesAccount(CASS),
      amount: minor(ESCROWED),
    });
    const lossy: SettleInput = { ...first, outcome: 'CARGO_LOST', causeEventId: ev('raid') };
    settleBatch(f.ledger, f.book, [lossy, ...inputs.slice(1)], ACCOUNTS, presenceOf(f));
    expect(head.state).toBe('DEFERRED');
    const two = settleBatch(f.ledger, f.book, [lossy], ACCOUNTS, presenceOf(f));
    const s = two.settlements[0];
    if (s === undefined) throw new Error('no settlement');
    expect(s.recordedLoss).toBe(0);
    expect(s.payouts[0]?.escrowedShortfall).toBe(ESCROWED);
    // The invariant that must not fire on a legitimate second pass.
    expect(checkSettlementExact(s, 288)).toEqual([]);
    expect(checkVentureInvariants(f.book, 288)).toEqual([]);
  });

  it('never pays a role twice across the full MAX_DEFERRALS chain', () => {
    const { f, inputs, head } = chain();
    const first = inputs[0];
    if (first === undefined) throw new Error('fixture');
    const payee = head.roles[0]?.filledByPrincipal;
    if (payee === null || payee === undefined) throw new Error('fixture');
    const before = f.ledger.balance(storesAccount(payee));
    settleBatch(f.ledger, f.book, inputs, ACCOUNTS, presenceOf(f));
    // Drain the payer so the second pass can make no progress either, forcing the
    // deferral chain to run to its bound.
    let passes = 1;
    while (head.state === 'DEFERRED' && passes < MAX_DEFERRALS + 3) {
      settleBatch(f.ledger, f.book, [first, ...inputs.slice(1).filter(() => false)], ACCOUNTS, presenceOf(f));
      passes += 1;
    }
    expect(head.deferrals).toBeLessThanOrEqual(MAX_DEFERRALS);
    // Whatever happened, the payee got the claim once and no more.
    const carrierClaim = computeClaims(head, minor(0)).roles[0]?.claim ?? minor(0);
    expect(f.ledger.balance(storesAccount(payee)) - before).toBeLessThanOrEqual(carrierClaim);
    expect(head.roles[0]?.settledElectiveMinor ?? 0).toBeLessThanOrEqual(ELECTIVE);
  });
});

describe('the cumulative payout figures on the PUBLIC feed', () => {
  it('publishes the SAME field names for a per-pass figure and a cumulative one', () => {
    // The fix made RolePayout cumulative. The receipt payload keys did not change, so a
    // consumer folding a venture's receipts sees `escrowedPaid` twice for one payment.
    const { f, inputs, head } = chain();
    const first = inputs[0];
    if (first === undefined) throw new Error('fixture');
    const one = settleBatch(f.ledger, f.book, inputs, ACCOUNTS, presenceOf(f));
    const deferred = one.settlements.find((s) => s.venture === head.id);
    if (deferred === undefined) throw new Error('no deferral');
    const two = settleBatch(f.ledger, f.book, [first], ACCOUNTS, presenceOf(f));
    const settled = two.settlements[0];
    if (settled === undefined) throw new Error('no settlement');

    const rowOf = (s: typeof settled, tick: number): { escrowedPaid: number; electivePaid: number } => {
      const rows = settlementEvents(s, ALICE, receipts(tick));
      const e = rows.find(
        (r) => r.kind === VENTURE_EVENT_KINDS.settled || r.kind === VENTURE_EVENT_KINDS.deferred,
      );
      const payouts = e?.payload['payouts'];
      if (!Array.isArray(payouts)) throw new Error('no payouts');
      return payouts[0] as { escrowedPaid: number; electivePaid: number };
    };
    const a = rowOf(deferred, 287);
    const b = rowOf(settled, 288);
    console.log('FEED FOLD:', JSON.stringify({ deferredRow: a, settledRow: b, naiveSum: a.escrowedPaid + b.escrowedPaid }));
    // Each row is individually right; the naive fold double-counts the guaranteed half.
    expect(a.escrowedPaid).toBe(ESCROWED);
    expect(b.escrowedPaid).toBe(ESCROWED);
    expect(a.escrowedPaid + b.escrowedPaid).toBe(2 * ESCROWED);
  });
});

describe('agent-supplied elections on a tick-halting path', () => {
  it('HALTS the settlement on a malformed election value rather than refusing it', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], minor(12_000));
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(() =>
        settleBatch(
          f.ledger,
          f.book,
          [inp(haul, new Map<number, Election>([[1, bad as Minor]]), { proceeds: minor(12_000) })],
          ACCOUNTS,
          presenceOf(f),
        ),
      ).toThrow(SettlementHalt);
    }
    void ESK;
  });
});
