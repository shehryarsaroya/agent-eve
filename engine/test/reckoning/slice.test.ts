/**
 * `E2E-1a` and `E2E-1b` — the vertical slice's two branches, **through the Reckoning**.
 *
 * `test/venture/slice.test.ts` already asserts both branches at the settlement level: the
 * right claims, the right payouts, the right receipt drafts. What it cannot see is
 * everything this module exists for — whether the drafts reach the append-only record,
 * whether the default carries its cause as a *column*, whether standing actually moves,
 * whether the batch commits, and whether the 26 invariants are clean over the world the
 * Reckoning produced. So these tests assert the *record*, not the arithmetic.
 *
 * > `E2E-1a` The honoured branch: A forms a `HAUL`, hires B's hand as `ESCORT` for a
 * > share, part escrowed and part elective ... settlement pays both parts; the map link
 * > holds gold; standing rises ... by the elective amount only.
 * > `E2E-1b` The default branch: identical, but B's elective part goes unpaid. A default
 * > is recorded **with its attributable cause**, the link snaps black, standing falls, the
 * > receipt renders. — TESTING.md §6
 *
 * **One deliberate reading.** TESTING.md's E2E-1a sentence says standing rises "for B".
 * The engine credits the **payer**: `StandingDelta.principal` is the venture's creator,
 * because §6.4 accrues standing "only to elective parts honoured, weighted against the
 * honourer's total capital" and the honourer is whoever chose to pay. `agent.md` §4 agrees
 * — "Honour elective parts, especially when it costs you. It is the only thing that builds
 * standing" is addressed to the payer — and so does `test/venture/slice.test.ts`. These
 * tests follow the engine and `agent.md`; the discrepancy in TESTING.md's prose is
 * reported rather than encoded.
 */

import { describe, expect, it } from 'vitest';
import { bps, minor, type Minor } from '../../src/core/units.js';
import { VENTURE_EVENT_KINDS, computeClaims, type Election } from '../../src/venture/index.js';
import { escrowAccount, storesAccount } from '../../src/ledger/index.js';
import {
  ALICE,
  BRAM,
  FORM_TICK,
  RECKONING,
  SETTLE_TICK,
  balance,
  fixture,
  freeze,
  goLive,
  haulDeed,
  makeHaul,
  planFor,
  run,
  sealFor,
  share,
  vid,
  wage,
  appendPublic,
  type Fix,
} from './fixture.js';

const PROCEEDS = minor(12_000);

/** §16's shape exactly: A on a wage `CARRIER`, B on a share `ESCORT`, both halves priced. */
function slice(f: Fix): ReturnType<typeof makeHaul> {
  const haul = makeHaul(f, {
    carrier: wage(800, 400),
    escort: share(bps(3_000), 500, 900),
  });
  goLive(f, haul, [ALICE, BRAM], PROCEEDS);
  return haul;
}

function electionsPayingAll(haul: ReturnType<typeof makeHaul>): Map<number, Election> {
  const out = new Map<number, Election>();
  for (const r of computeClaims(haul, PROCEEDS).roles) {
    if (r.electiveDue > 0) out.set(r.roleIndex, r.electiveDue);
  }
  return out;
}

describe('E2E-1a — the honoured branch, through a whole Reckoning', () => {
  it('commits, pays both halves, and publishes one settled row per venture', () => {
    const f = fixture();
    const haul = slice(f);
    const escortClaim = computeClaims(haul, PROCEEDS).roles[1];
    if (escortClaim === undefined) throw new Error('fixture');
    const beforeBram = balance(f, BRAM);

    const frozen = freeze(f, [planFor(haul, { proceeds: PROCEEDS, elections: electionsPayingAll(haul) })]);
    const outcome = run(f, frozen);

    expect(outcome.transaction.committed).toBe(true);
    expect(outcome.transaction.torn).toBe(false);
    expect(outcome.transaction.planned).toHaveLength(10);
    expect(outcome.defaults).toEqual([]);
    expect(outcome.settlements[0]?.terminalState).toBe('SETTLED');

    // Both halves reached B, and the escrow is empty afterwards: every unit that entered
    // the pot left it.
    expect(balance(f, BRAM)).toBe(beforeBram + escortClaim.claim);
    expect(f.ledger.balance(escrowAccount(haul.id, ALICE))).toBe(0);

    const receipt = outcome.receipts[0];
    expect(receipt?.defaults).toEqual([]);
    expect(receipt?.lossEventIds).toEqual([]);
    const settled = f.events.get(receipt?.settledEventId ?? ('' as never));
    expect(settled?.event.kind).toBe(VENTURE_EVENT_KINDS.settled);
    // PUBLIC on the night: A5 is a property of the record, not of the UI.
    expect(settled?.event.isPublic).toBe(true);
    expect(settled?.event.declassifyAt).toBe(SETTLE_TICK);
  });

  it('moves standing for the payer by the elective amount only, against a named counterparty', () => {
    const f = fixture();
    const haul = slice(f);
    const escortClaim = computeClaims(haul, PROCEEDS).roles[1];
    if (escortClaim === undefined) throw new Error('fixture');

    const frozen = freeze(f, [planFor(haul, { proceeds: PROCEEDS, elections: electionsPayingAll(haul) })]);
    run(f, frozen);

    const alice = f.standing.row(ALICE);
    expect(alice.electiveHonoured).toBe(1);
    // §6.4: standing accrues to the **elective** part honoured and never to the escrowed
    // one. A fully escrowed venture earns a performance record and zero standing.
    expect(alice.electiveHonouredValue).toBe(escortClaim.electiveDue);
    expect(alice.electiveHonouredValue).toBeLessThan(escortClaim.claim);
    expect(alice.defaults).toBe(0);
    // The anti-farm term counts distinct counterparties, and the self-dealt CARRIER role
    // earns nothing at all (scar #9).
    expect(alice.distinctCounterparties).toBe(1);
    expect(f.standing.row(BRAM).electiveHonoured).toBe(0);

    const journal = f.standing.changes();
    expect(journal).toHaveLength(1);
    expect(journal[0]?.cause).toBe('ELECTIVE_HONOURED');
    expect(journal[0]?.counterparty).toBe(BRAM);
    // The journal cites a row that is actually in the record, which is what lets INV-21
    // recompute the cached figure from history.
    expect(f.events.get(journal[0]?.eventId ?? ('' as never))).not.toBeNull();
  });

  it('breaks no invariant, and says which ones it actually checked', () => {
    const f = fixture();
    const haul = slice(f);
    const frozen = freeze(f, [planFor(haul, { proceeds: PROCEEDS, elections: electionsPayingAll(haul) })]);
    const outcome = run(f, frozen);

    expect(outcome.report?.violations).toEqual([]);
    // Read `checked`, not just `violations`: a pass that verified nothing returns an empty
    // violation list too, which is the exact failure the aggregate's `skipped` exists for.
    const checked = new Set(outcome.report?.checked ?? []);
    for (const id of ['INV-1', 'INV-6', 'INV-9', 'INV-17', 'INV-18', 'INV-19', 'INV-20', 'INV-21']) {
      expect(checked.has(id), `${id} did not run`).toBe(true);
    }
  });

  it('reveals a seal stamped with its own Reckoning, and publishes only the flag', () => {
    const f = fixture();
    const haul = slice(f);
    sealFor(
      f,
      BRAM,
      { verb: 'haul', target: haul.id, measure: 'MINOR', outcomeLow: 0, outcomeHigh: PROCEEDS },
      { venture: haul.id, roleIndex: 1 },
    );
    const deedEvent = appendPublic(f, {
      tick: FORM_TICK + 1,
      kind: 'venture.delivery',
      actor: BRAM,
      payload: { venture: haul.id, deliveredMinor: PROCEEDS },
    });

    const frozen = freeze(f, [planFor(haul, { proceeds: PROCEEDS, elections: electionsPayingAll(haul) })]);
    const outcome = run(f, frozen, {
      deeds: [
        haulDeed({
          principal: BRAM,
          venture: haul.id,
          outcome: PROCEEDS,
          tick: FORM_TICK + 1,
          valuedAtStateVersion: f.version(),
          eventId: deedEvent,
        }),
      ],
      // The producer's own count, not `deeds.length` — the tally and the deeds must have
      // two independent sources or the resolver's reconciliation is a tautology.
      deedTally: [[BRAM, 1]],
    });

    expect(outcome.transaction.committed).toBe(true);
    expect(outcome.seals?.reckoningIndex).toBe(RECKONING);
    expect(outcome.seals?.verdicts).toHaveLength(1);
    expect(outcome.seals?.verdicts[0]?.verdict).toBe('HONOURED');
    // A healthy Reckoning defers nothing and reconciles cleanly.
    expect(outcome.seals?.deferred).toEqual([]);
    expect(outcome.deedSetFaults).toEqual([]);
    // Honouring a seal costs and earns nothing: standing accrues only to the elective part.
    expect(f.standing.row(BRAM).contradictedSeals).toBe(0);

    const verdictRow = f.events
      .eventsAtTick(SETTLE_TICK)
      .find((r) => r.event.kind === 'SEAL_RESOLVED');
    expect(verdictRow).toBeDefined();
    // PROP-D2: the flag and nothing else, ever, at any tier, on any delay.
    expect(
      Object.keys(verdictRow?.event.payload ?? {}).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ).toEqual([
      'principal',
      'reckoningIndex',
      'sealId',
      'verdict',
    ]);
  });
});

describe('E2E-1b — the default branch, with its attributable cause as a column', () => {
  it('records one default, publishes it PUBLIC, and points at the settlement that caused it', () => {
    const f = fixture();
    const haul = slice(f);
    const claims = computeClaims(haul, PROCEEDS);
    const escortClaim = claims.roles[1];
    const carrierClaim = claims.roles[0];
    if (escortClaim === undefined || carrierClaim === undefined) throw new Error('fixture');

    // A pays its own (self-dealt) carrier part and declines B's escort part.
    const elections = new Map<number, Election>([[0, carrierClaim.electiveDue]]);
    const frozen = freeze(f, [planFor(haul, { proceeds: PROCEEDS, elections })]);
    const outcome = run(f, frozen);

    expect(outcome.transaction.committed).toBe(true);
    expect(outcome.settlements[0]?.terminalState).toBe('DEFAULTED');
    expect(outcome.defaults).toHaveLength(1);

    const attribution = outcome.defaults[0];
    expect(attribution?.promisor).toBe(ALICE);
    expect(attribution?.obligation).toBe(haul.id);
    // The window ran out and the payer chose not to pay: the settlement itself is the
    // cause, and the row that says so is the `venture.settled` receipt.
    expect(attribution?.cause).toBe('ELAPSED_WINDOW');
    expect(attribution?.causeEventId).toBe(outcome.receipts[0]?.settledEventId);
    expect(attribution?.reckoningIndex).toBe(RECKONING);

    const row = f.events.get(attribution?.defaultEventId ?? ('' as never));
    expect(row?.event.kind).toBe(VENTURE_EVENT_KINDS.defaulted);
    expect(row?.event.isPublic).toBe(true);
    // INV-17's whole point: the evidence is the COLUMN, joinable by an auditor who does
    // not have our code — not only a field in the jsonb payload.
    expect(row?.event.parentEventId).toBe(attribution?.causeEventId);
    expect(row?.event.payload['cause']).toBe('DECLINED');
    expect(row?.event.payload['amount']).toBe(escortClaim.electiveDue);
  });

  it('the escrowed half still executed — that is the only thing escrow ever promised', () => {
    const f = fixture();
    const haul = slice(f);
    const beforeBram = balance(f, BRAM);
    const claims = computeClaims(haul, PROCEEDS);
    const escortClaim = claims.roles[1];
    if (escortClaim === undefined) throw new Error('fixture');

    const frozen = freeze(f, [planFor(haul, { proceeds: PROCEEDS, elections: new Map() })]);
    run(f, frozen);

    expect(balance(f, BRAM)).toBe(beforeBram + escortClaim.escrowedDue);
    expect(escortClaim.escrowedDue).toBeGreaterThan(0);
  });

  it('standing falls, and the fall cites a default the register can justify', () => {
    const f = fixture();
    const haul = slice(f);
    const frozen = freeze(f, [planFor(haul, { proceeds: PROCEEDS, elections: new Map() })]);
    const outcome = run(f, frozen);

    const alice = f.standing.row(ALICE);
    expect(alice.defaults).toBe(1);
    expect(alice.lastDefaultTick).toBe(SETTLE_TICK);
    expect(alice.electiveHonoured).toBe(0);

    const fall = f.standing.changes().find((c) => c.cause === 'DEFAULT');
    expect(fall).toBeDefined();
    // INV-21's clause that is reachable from nowhere else: reputation must never fall for
    // an accusation the engine cannot justify. The cited event is the default row itself,
    // and the register holds its evidence.
    expect(f.register.has(fall?.eventId ?? ('' as never))).toBe(true);
    expect(outcome.report?.violations).toEqual([]);
  });

  it('a recorded loss is a different kind from a default, in the record (E2E-2)', () => {
    const f = fixture();
    const haul = slice(f);
    // A rival drains the escrow before the freeze. An encumbrance is a claim on a thing,
    // never a shield over it (PROP-L3).
    const raid = drainEscrow(f, haul);

    const frozen = freeze(f, [
      planFor(haul, {
        outcome: 'CARGO_LOST',
        proceeds: minor(0),
        elections: new Map(),
        causeEventId: raid,
      }),
    ]);
    const outcome = run(f, frozen);

    expect(outcome.transaction.committed).toBe(true);
    const receipt = outcome.receipts[0];
    expect(receipt?.lossEventIds.length).toBeGreaterThan(0);
    const loss = f.events.get(receipt?.lossEventIds[0] ?? ('' as never));
    expect(loss?.event.kind).toBe(VENTURE_EVENT_KINDS.loss);
    expect(loss?.event.payload['isDefault']).toBe(false);
    // The loss row descends from the event that destroyed the value, not from the
    // settlement — the causal graph must not say the settlement did it.
    expect(loss?.event.parentEventId).toBe(raid);
    // The escrowed shortfall is a recorded LOSS and never a default (§10.2, PROP-L3).
    expect(outcome.settlements[0]?.recordedLoss).toBeGreaterThan(0);
    expect(outcome.defaults).toEqual([]);
    expect(f.standing.row(ALICE).defaults).toBe(0);
  });
});

function drainEscrow(f: Fix, haul: ReturnType<typeof makeHaul>) {
  const escrow = escrowAccount(haul.id, ALICE);
  const amount = f.ledger.balance(escrow);
  const eventId = appendPublic(f, {
    tick: FORM_TICK + 2,
    kind: 'raid.struck',
    actor: BRAM,
    payload: { venture: haul.id, target: escrow, takeMinor: amount },
  });
  f.ledger.seizeCurrency({
    eventId: `${eventId}#take` as never,
    tick: FORM_TICK + 2,
    from: escrow,
    to: storesAccount(BRAM),
    amount,
  });
  return eventId;
}

/** Unused-import guard: `Minor` is referenced only in a type position above. */
export type SliceMinor = Minor;
export type SliceVentureId = ReturnType<typeof vid>;
