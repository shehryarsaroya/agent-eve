/**
 * The vertical slice's venture half, and the branches only a whole settlement shows.
 *
 * §16: "A forms a `HAUL` and hires B's hand as `ESCORT` for a share, part escrowed and
 * part elective ... At the Reckoning it settles — or B's elective part goes unpaid and
 * a default is recorded — and both outcomes emit a receipt that renders as a link
 * holding or snapping."
 *
 * `E2E-1a` the honoured branch. `E2E-1b` the default branch, with its attributable
 * cause. `E2E-2` `CARGO_LOST` distinguishable from a default. `E2E-13` a circular
 * batch defers rather than defaulting, and cannot be looped forever.
 *
 * The movement, the interception and the map link belong to other modules; what is
 * asserted here is that the venture produces the right *record* for each branch,
 * because A5' makes the record the thing that must never be wrong.
 */

import { describe, expect, it } from 'vitest';
import { bps, minor, type Minor } from '../../src/core/units.js';
import type { EventId, PrincipalId, VentureId } from '../../src/core/types.js';
import {
  CURRENCY_FAUCET,
  checkLedgerInvariants,
  escrowAccount,
  storesAccount,
} from '../../src/ledger/index.js';
import { EventLedger, assertEventInvariants } from '../../src/events/index.js';
import {
  CASCADE_ROUND_LIMIT,
  MAX_DEFERRALS,
  SettlementHalt,
  VENTURE_EVENT_KINDS,
  batchEvents,
  checkSettlementExact,
  checkVentureInvariants,
  computeClaims,
  formationEvent,
  settleBatch,
  settleVenture,
  settlementEvents,
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
  balance,
  ev,
  fixture,
  goLive,
  makeHaul,
  share,
  vid,
  wage,
  type Fixture,
} from './fixture.js';

const PROCEEDS = minor(12_000);

function slice(f: Fixture): VentureRecord {
  // Part escrowed and part elective on both roles, exactly as §16 describes.
  const haul = makeHaul(f, {
    carrier: wage(800, 400),
    escort: share(bps(3_000), 500, 900),
  });
  goLive(f, haul, [ALICE, BRAM], PROCEEDS);
  return haul;
}

function settleInput(
  venture: VentureRecord,
  elections: ReadonlyMap<number, Minor>,
  overrides: Partial<SettleInput> = {},
): SettleInput {
  return {
    venture,
    tick: 287,
    eventId: ev(`settle:${venture.id}`),
    outcome: 'FULFILLED',
    proceeds: PROCEEDS,
    elections,
    stateVersion: STATE_VERSION,
    causeEventId: null,
    ...overrides,
  };
}

function receipts(tick = 287): ReceiptContext {
  return {
    tick,
    rulesVersion: RULES_VERSION,
    actedOnStateVersion: STATE_VERSION,
    familyOf: (venture: VentureId) => `family:${venture}`,
    parentEventId: null,
  };
}

describe('E2E-1a — the honoured branch', () => {
  it('pays both halves, records standing only for the elective one, and settles clean', () => {
    const f = fixture();
    const haul = slice(f);
    const claims = computeClaims(haul, PROCEEDS);
    const elections = new Map<number, Minor>();
    for (const r of claims.roles) if (r.electiveDue > 0) elections.set(r.roleIndex, r.electiveDue);

    const beforeBram = balance(f, BRAM);
    const s = settleVenture(f.ledger, f.book, settleInput(haul, elections), ACCOUNTS);

    expect(s.terminalState).toBe('SETTLED');
    expect(s.defaults).toEqual([]);
    expect(s.recordedLoss).toBe(0);
    expect(s.unattributed).toBe(0);

    // The escort was paid its whole share of the residual.
    const escort = s.payouts[1];
    expect(escort?.escrowedPaid).toBe(escort?.escrowedDue);
    expect(escort?.electivePaid).toBe(escort?.electiveDue);
    expect(balance(f, BRAM)).toBe(beforeBram + (escort?.claim ?? 0));

    // §6.4: standing accrues **only** to the elective part honoured, and it names the
    // counterparty so the diversity term downstream has something to weight.
    const standing = s.standing.filter((x) => x.counterparty === BRAM);
    expect(standing).toHaveLength(1);
    expect(standing[0]?.electiveHonouredValue).toBe(escort?.electiveDue);
    expect(standing[0]?.principal).toBe(ALICE);

    expect(checkSettlementExact(s, 287)).toEqual([]);
    expect(checkVentureInvariants(f.book, 287)).toEqual([]);
    expect(f.ledger.balance(escrowAccount(haul.id, ALICE))).toBe(0);
    expect(
      checkLedgerInvariants(f.ledger, {
        tick: 287,
        obligations: { isLive: () => false, securedObligations: () => [] },
      }),
    ).toEqual([]);
  });

  it('emits a settled receipt that is PUBLIC on the night', () => {
    const f = fixture();
    const haul = slice(f);
    const claims = computeClaims(haul, PROCEEDS);
    const elections = new Map<number, Minor>();
    for (const r of claims.roles) if (r.electiveDue > 0) elections.set(r.roleIndex, r.electiveDue);
    const s = settleVenture(f.ledger, f.book, settleInput(haul, elections), ACCOUNTS);

    const events = settlementEvents(s, ALICE, receipts());
    expect(events).toHaveLength(1);
    const settled = events[0];
    expect(settled?.kind).toBe(VENTURE_EVENT_KINDS.settled);
    expect(settled?.isPublic).toBe(true);
    expect(settled?.declassifyAt).toBe(287);

    // And it is admissible to the append-only ledger, which validates the tier.
    const ledger = new EventLedger();
    for (const e of events) ledger.append(e);
    expect(assertEventInvariants(ledger, { tick: 287, scope: 'FULL' })).toEqual([]);
  });
});

describe('E2E-1b — the default branch, with its attributable cause', () => {
  it('records a default for the unpaid elective part and nothing for the escrowed one', () => {
    const f = fixture();
    const haul = slice(f);
    const beforeBram = balance(f, BRAM);

    // A pays the carrier's elective part (its own role) and declines the escort's.
    const claims = computeClaims(haul, PROCEEDS);
    const elections = new Map<number, Minor>();
    const carrier = claims.roles[0];
    if (carrier !== undefined && carrier.electiveDue > 0) {
      elections.set(carrier.roleIndex, carrier.electiveDue);
    }

    const s = settleVenture(f.ledger, f.book, settleInput(haul, elections), ACCOUNTS);
    expect(s.terminalState).toBe('DEFAULTED');
    expect(s.defaults).toHaveLength(1);

    const d = s.defaults[0];
    expect(d?.payer).toBe(ALICE);
    expect(d?.payee).toBe(BRAM);
    expect(d?.cause).toBe('DECLINED');
    // INV-17: never null. Without a cause the row is the game accusing an agent.
    expect(d?.causeEventId).toBe(`settle:${haul.id}`);
    expect(d?.amount).toBe(s.payouts[1]?.electiveDue);

    // The escrowed half still executed — that is the only thing escrow ever promised.
    expect(balance(f, BRAM)).toBe(beforeBram + (s.payouts[1]?.escrowedPaid ?? 0));
    expect(s.payouts[1]?.escrowedPaid).toBeGreaterThan(0);

    // Standing falls, and it falls against a named counterparty.
    const standing = s.standing.filter((x) => x.counterparty === BRAM);
    expect(standing[0]?.defaults).toBe(1);
    expect(standing[0]?.electiveHonoured).toBe(0);

    expect(checkSettlementExact(s, 287)).toEqual([]);
  });

  it('distinguishes DECLINED from UNFUNDED', () => {
    // Alice elected to pay and could not: the escrow took everything she had, the
    // venture yielded nothing, and there is no other source. That is a different story
    // from refusing, and the record has to say which.
    // Escrowed 0 on the escort, so the escrow requirement is exactly the carrier's
    // escrowed part and nothing comes back to the creator to fund the elective half.
    const f = fixture(minor(800));
    const haul = makeHaul(f, { carrier: wage(800, 400), escort: share(bps(3_000), 0, 500) });
    goLive(f, haul, [DOV, BRAM], minor(0));
    const claims = computeClaims(haul, minor(0));
    const elections = new Map<number, Minor>();
    for (const r of claims.roles) if (r.electiveDue > 0) elections.set(r.roleIndex, r.electiveDue);

    const s = settleVenture(
      f.ledger,
      f.book,
      settleInput(haul, elections, { proceeds: minor(0) }),
      ACCOUNTS,
    );
    const causes = new Set(s.defaults.map((d) => d.cause));
    expect(causes.has('UNFUNDED')).toBe(true);
    expect(causes.has('DECLINED')).toBe(false);
  });

  it('emits a default receipt distinguishable from a loss by kind', () => {
    const f = fixture();
    const haul = slice(f);
    const s = settleVenture(f.ledger, f.book, settleInput(haul, new Map()), ACCOUNTS);
    const events = settlementEvents(s, ALICE, receipts());
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain(VENTURE_EVENT_KINDS.settled);
    expect(kinds).toContain(VENTURE_EVENT_KINDS.defaulted);
    expect(kinds).not.toContain(VENTURE_EVENT_KINDS.loss);

    const defaultRow = events.find((e) => e.kind === VENTURE_EVENT_KINDS.defaulted);
    expect(defaultRow?.payload['isDefault']).toBe(true);
    expect(defaultRow?.payload['causeEventId']).toBeDefined();

    const ledger = new EventLedger();
    for (const e of events) ledger.append(e);
    expect(assertEventInvariants(ledger, { tick: 287, scope: 'FULL' })).toEqual([]);
  });

  it('never records a default against a principal for its own role (scar #9)', () => {
    const f = fixture();
    // Alice creates and fills both roles is impossible (PROP-V6), so she fills one and
    // declines her own elective part. Self-dealing yields no standing and no default.
    const haul = slice(f);
    const s = settleVenture(f.ledger, f.book, settleInput(haul, new Map()), ACCOUNTS);
    for (const d of s.defaults) expect(d.payer).not.toBe(d.payee);
    for (const x of s.standing) expect(x.principal).not.toBe(x.counterparty);
    // Alice holds the carrier role, so the carrier's elective part is a payment to
    // herself: booked, but never as a promise kept or broken.
    expect(s.standing.filter((x) => x.counterparty === ALICE)).toHaveLength(0);
  });
});

describe('E2E-2 — CARGO_LOST is not a default', () => {
  it('pays the escrow by priority, charges the shortfall as a loss, and says so on the row', () => {
    const f = fixture();
    const haul = slice(f);
    const escrow = escrowAccount(haul.id, ALICE);
    // A raid drains the escrow. The lock is a claim on value, not a shield over it.
    f.ledger.seizeCurrency({
      eventId: ev('raid:1'),
      tick: 200,
      from: escrow,
      to: storesAccount(CASS),
      amount: minor(13_000),
    });

    const s = settleVenture(
      f.ledger,
      f.book,
      settleInput(haul, new Map(), { outcome: 'CARGO_LOST', causeEventId: ev('raid:1'), proceeds: minor(0) }),
      ACCOUNTS,
    );
    expect(s.recordedLoss).toBeGreaterThan(0);
    const events = settlementEvents(s, ALICE, receipts());
    const loss = events.find((e) => e.kind === VENTURE_EVENT_KINDS.loss);
    expect(loss).toBeDefined();
    expect(loss?.payload['isDefault']).toBe(false);
  });

  it('pays a wage before a share out of a short escrow', () => {
    const f = fixture();
    const haul = makeHaul(f, {
      carrier: wage(2_000, 700),
      escort: share(bps(3_000), 2_000, 700),
    });
    goLive(f, haul, [ALICE, BRAM], minor(0));
    // 4000 escrowed, 1500 left after a raid. Seniority decides who gets it.
    f.ledger.seizeCurrency({
      eventId: ev('raid:2'),
      tick: 200,
      from: escrowAccount(haul.id, ALICE),
      to: storesAccount(CASS),
      amount: minor(2_500),
    });
    const s = settleVenture(
      f.ledger,
      f.book,
      settleInput(haul, new Map(), { outcome: 'CARGO_LOST', causeEventId: ev('raid:2'), proceeds: minor(0) }),
      ACCOUNTS,
    );
    // The escort's claim is a share of a zero residual, so it is owed nothing; the wage
    // takes the whole 1500 and the rest is a recorded loss.
    expect(s.payouts[0]?.escrowedPaid).toBe(1_500);
    expect(s.payouts[1]?.escrowedDue).toBe(0);
    expect(s.recordedLoss).toBe(500);
    expect(s.defaults).toEqual([]);
  });
});

describe('E2E-13 — a truncated cascade defers, and the deferral is bounded', () => {
  /**
   * A four-venture payment chain whose dependency order is the **reverse** of
   * `venture_id` order, so within-round propagation cannot help it.
   *
   *   v-a's creator is paid by v-b · v-b's by v-c · v-c's by v-d · v-d's creator is
   *   the only one that starts with money.
   *
   * Round 1 can only settle `v-d` (the others are visited before their funder). Round 2
   * settles `v-c`, round 3 settles `v-b` — and `v-a` is still unpaid when the round
   * limit stops the loop with progress still being made. That is the truncation §15.3
   * is about, and the state in which a default would be the engine's fault.
   */
  function truncatingChain(firstDeferrals = 0): {
    readonly f: Fixture;
    readonly inputs: SettleInput[];
    readonly first: VentureRecord;
  } {
    const ESCROWED = 100;
    const ELECTIVE = 5_000;
    // Everyone can fund an escrow and nothing else; the chain's head can also pay once.
    const f = fixture(minor(ESCROWED));
    f.ledger.issueCurrency({
      eventId: ev('fund:chain-head'),
      tick: 0,
      faucet: CURRENCY_FAUCET.STARTER_STAKE,
      to: storesAccount(DOV),
      amount: minor(ELECTIVE),
    });

    const links: readonly [string, PrincipalId, PrincipalId, PrincipalId][] = [
      // id, creator, carrier (the payee that unblocks the next link), escort
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
      const elections = new Map<number, Minor>();
      for (const r of claims.roles) if (r.electiveDue > 0) elections.set(r.roleIndex, r.electiveDue);
      inputs.push(settleInput(haul, elections, { proceeds: minor(0) }));
    }
    if (first === null) throw new Error('fixture');
    first.deferrals = firstDeferrals;
    return { f, inputs, first };
  }

  it('truncates within the round limit rather than looping to convergence (DET-9)', () => {
    const { f, inputs } = truncatingChain();
    const batch = settleBatch(f.ledger, f.book, inputs, ACCOUNTS);
    expect(batch.roundsUsed).toBeLessThanOrEqual(CASCADE_ROUND_LIMIT);
    expect(batch.truncated).toBe(true);
  });

  it('defers the unresolved link and records no breach', () => {
    const { f, inputs } = truncatingChain();
    const batch = settleBatch(f.ledger, f.book, inputs, ACCOUNTS);
    const deferred = batch.settlements.filter((s) => s.terminalState === 'DEFERRED');
    expect(deferred.map((s) => s.venture)).toEqual(['v-a']);
    // §15.3: "an obligation still unresolved at the round limit DEFERS to the next
    // Reckoning; **it never defaults**". A truncated cascade recording a breach is an
    // engine-fabricated default, and a rival can construct one deliberately.
    for (const s of deferred) {
      expect(s.defaults).toEqual([]);
      expect(s.standing).toEqual([]);
      expect(s.unattributed).toBe(0);
    }
    expect(batch.defaults).toEqual([]);
    // The three links that did resolve are settled, not deferred.
    expect(batch.settlements.filter((s) => s.terminalState === 'SETTLED').map((s) => s.venture)).toEqual([
      'v-b',
      'v-c',
      'v-d',
    ]);
  });

  it('a payer that is simply broke defaults rather than deferring', () => {
    // The distinction that closes the grief loop. Settled alone, the venture makes no
    // progress in round 2, so the loop exits on "nothing moved" — and a shortfall with
    // no new money possible is the payer's own and is attributable.
    const { f, inputs } = truncatingChain();
    const head = inputs[0];
    if (head === undefined) throw new Error('fixture');
    const batch = settleBatch(f.ledger, f.book, [head], ACCOUNTS);
    expect(batch.truncated).toBe(false);
    expect(batch.settlements[0]?.terminalState).toBe('DEFAULTED');
    expect(batch.settlements[0]?.defaults.map((d) => d.cause)).toContain('UNFUNDED');
  });

  it('frees the hands, so a deferral cannot pin a competitor s presence', () => {
    const { f, inputs, first } = truncatingChain();
    settleBatch(f.ledger, f.book, inputs, ACCOUNTS);
    expect(first.state).toBe('DEFERRED');
    for (const role of first.roles) {
      if (role.filledByHandId === null) continue;
      expect(f.book.commitmentOf(role.filledByHandId)).toBeNull();
    }
  });

  it('at the deferral bound it records an unattributed loss, never a default', () => {
    const { f, inputs } = truncatingChain(MAX_DEFERRALS);
    const batch = settleBatch(f.ledger, f.book, inputs, ACCOUNTS);
    expect(batch.truncated).toBe(true);
    // No third deferral: the bound is what stops a rival constructing a deferral loop
    // as a denial-of-settlement (E2E-13's second half).
    expect(batch.settlements.some((s) => s.terminalState === 'DEFERRED')).toBe(false);
    expect(batch.unattributed).toBeGreaterThan(0);
    // A5': the engine knows the value is unpaid and knows it cannot say why, so it
    // publishes a loss and leaves standing alone.
    expect(batch.defaults).toEqual([]);
    for (const s of batch.settlements) {
      if (s.unattributed > 0) {
        expect(s.defaults).toEqual([]);
        expect(s.standing).toEqual([]);
        expect(s.terminalState).toBe('SETTLED');
      }
    }
    // And it is published as a loss row, flagged as being at the bound.
    const head = batch.settlements.find((s) => s.unattributed > 0);
    if (head === undefined) throw new Error('expected an unattributed settlement');
    const rows = settlementEvents(head, ALICE, receipts());
    const loss = rows.find((e) => e.kind === VENTURE_EVENT_KINDS.loss);
    expect(loss?.payload['isDefault']).toBe(false);
    expect(loss?.payload['atDeferralBound']).toBe(true);
  });

  it('halts rather than settling a venture past the deferral bound', () => {
    const { f, inputs } = truncatingChain(MAX_DEFERRALS + 1);
    expect(() => settleBatch(f.ledger, f.book, inputs, ACCOUNTS)).toThrow(SettlementHalt);
  });

  it('does not re-pay the escrowed parts on a deferred re-settlement', () => {
    const { f, inputs, first } = truncatingChain();
    settleBatch(f.ledger, f.book, inputs, ACCOUNTS);
    const escrow = escrowAccount(first.id, first.creator);
    // The escrow is empty, so a second pass through phase 1 would read as a shortfall —
    // a recorded loss the engine invented.
    expect(f.ledger.balance(escrow)).toBe(0);
    const head = inputs[0];
    if (head === undefined) throw new Error('fixture');
    const second = settleBatch(f.ledger, f.book, [head], ACCOUNTS);
    expect(second.settlements[0]?.recordedLoss).toBe(0);
    expect(first.deferrals).toBe(1);
  });
});

describe('the formation receipt', () => {
  it('is PARTIES while forming and declassifies at settlement (PROP-VI3)', () => {
    const f = fixture();
    const haul = makeHaul(f, { visibility: 'PARTIES' });
    goLive(f, haul, [ALICE, BRAM], PROCEEDS);
    const event = formationEvent(haul, receipts(10), 287);
    expect(event.visibility).toBe('PARTIES');
    expect(event.isPublic).toBe(false);
    expect(event.declassifyAt).toBe(287);
    // §11.2 requires >=2 audience rows on PARTIES, and INV-13 asserts it.
    expect(event.audience.length).toBeGreaterThanOrEqual(2);

    const ledger = new EventLedger();
    ledger.append(event);
    expect(assertEventInvariants(ledger, { tick: 10, scope: 'FULL' })).toEqual([]);
  });

  it('is PUBLIC when the venture is', () => {
    const f = fixture();
    const haul = makeHaul(f, { visibility: 'PUBLIC' });
    const event = formationEvent(haul, receipts(10), 287);
    expect(event.visibility).toBe('PUBLIC');
    expect(event.declassifyAt).toBe(10);
    expect(event.audience).toEqual([]);
  });
});

describe('batch receipts', () => {
  it('are emitted in venture_id order and share one family per venture', () => {
    const f = fixture();
    const inputs: SettleInput[] = [];
    for (const [i, id] of ['v-z', 'v-a'].entries()) {
      const creator = [ALICE, BRAM][i] as PrincipalId;
      const holder = [CASS, DOV][i] as PrincipalId;
      const haul = makeHaul(f, { id: vid(id), creator });
      goLive(f, haul, [creator, holder], PROCEEDS);
      inputs.push(settleInput(haul, new Map()));
    }
    const batch = settleBatch(f.ledger, f.book, inputs, ACCOUNTS);
    const creatorOf = (venture: VentureId): PrincipalId =>
      f.book.require(venture).creator;
    const events = batchEvents(batch.settlements, creatorOf, receipts());
    const order = events.map((e) => e.eventFamilyId);
    expect(order[0]).toBe('family:v-a');
    expect(order[order.length - 1]).toBe('family:v-z');

    const ledger = new EventLedger();
    for (const e of events) ledger.append(e);
    expect(assertEventInvariants(ledger, { tick: 287, scope: 'FULL' })).toEqual([]);
    // Every row carries the state version the parties acted on, so replay can compare.
    for (const e of events) expect(e.actedOnStateVersion).toBe(STATE_VERSION);
  });

  it('carries no balance fields — value lives in postings (scar #5)', () => {
    const f = fixture();
    const haul = slice(f);
    const s = settleVenture(f.ledger, f.book, settleInput(haul, new Map()), ACCOUNTS);
    for (const e of settlementEvents(s, ALICE, receipts())) {
      // §15.1: "balanced currency_*/items_*/obligations_* on every event duplicates the
      // posting table — scar #5 inside the field list that exists to prevent scar #5."
      for (const key of Object.keys(e.payload)) {
        expect(key).not.toMatch(/^(currency|items|obligations)_/);
      }
      expect(Object.keys(e)).not.toContain('balanceMinor');
    }
  });
});

/** Unused-import guard: `EventId` is referenced only in a type position above. */
export type SliceEventId = EventId;
