/**
 * `INV-17`'s attribution column and `INV-19`'s frozen capture — the two debts this module
 * was assigned to discharge.
 *
 * ## INV-17: the cause has to be a COLUMN
 *
 * `src/venture/events.ts` records the constraint and the reason it could not be met there:
 * `EventLedger.append` mints ids as `ev:{tick}:{seq}`, so the handle the emitter holds can
 * never be a ledger id, and writing it into `parent_event_id` makes INV-12 refuse the row.
 * Only the caller that appends the batch knows the settled row's minted id. These tests
 * assert that caller does the job, on **both** cause kinds:
 *
 *   - `ELAPSED_WINDOW` — the payer declined and the window ran out. The cause is the
 *     `venture.settled` row that says so.
 *   - `LOSS` — value was destroyed and the promise broke with it. The cause is the raid.
 *
 * ## INV-19: the capture has to be a different value read at a different time
 *
 * `SettleInput.actedOnStateVersion` names the two wrong answers and why each is wrong: the
 * engine's live counter halts every venture that outlives its activation tick, and the row
 * read back at settlement is the same object on both sides of `!==` — a check that cannot
 * fail. The tests below assert the *third* thing: that the value the driver passes is
 * neither, which is the only way the comparison has content.
 */

import { describe, expect, it } from 'vitest';
import { minor } from '../../src/core/units.js';
import { escrowAccount, storesAccount } from '../../src/ledger/index.js';
import { checkInv17, checkInv19 } from '../../src/invariants/index.js';
import {
  ReckoningHalt,
  resolveDefaultCause,
  settlementHandle,
  settlementItemsOf,
  verifyFrozenInputs,
} from '../../src/reckoning/index.js';
import { computeClaims, type Election } from '../../src/venture/index.js';
import {
  ALICE,
  BRAM,
  DOV,
  FORM_TICK,
  RECKONING,
  SETTLE_TICK,
  appendPublic,
  drain,
  fixture,
  freeze,
  goLive,
  makeHaul,
  planFor,
  run,
  wage,
  type Fix,
} from './fixture.js';

const PROCEEDS = minor(12_000);

/** The slice, with the escort's elective part declined: one `ELAPSED_WINDOW` default. */
function declined(f: Fix) {
  const haul = makeHaul(f);
  goLive(f, haul, [ALICE, BRAM], PROCEEDS);
  const carrier = computeClaims(haul, PROCEEDS).roles[0];
  if (carrier === undefined) throw new Error('fixture');
  const elections = new Map<number, Election>([[0, carrier.electiveDue]]);
  return { haul, frozen: freeze(f, [planFor(haul, { proceeds: PROCEEDS, elections })]) };
}

/**
 * A raided venture: the cargo is gone, the escrow and the payer's stores with it.
 *
 * Two **wage** roles, because a wage is a senior fixed claim that survives the loss of the
 * cargo. A share role's claim on a destroyed cargo is zero, so it can owe nothing and can
 * never produce the `LOSS`-attributed default this test is about.
 */
function raided(f: Fix) {
  const haul = makeHaul(f, {
    creator: DOV,
    carrier: wage(100, 1_200),
    escort: wage(100, 1_200),
  });
  goLive(f, haul, [ALICE, BRAM], minor(0));
  const raid = drain(f, {
    from: escrowAccount(haul.id, DOV),
    tick: FORM_TICK + 2,
    venture: haul.id,
  });
  drain(f, { from: storesAccount(DOV), tick: FORM_TICK + 2, venture: haul.id });

  const elections = new Map<number, Election>();
  for (const r of computeClaims(haul, minor(0)).roles) {
    if (r.electiveDue > 0) elections.set(r.roleIndex, r.electiveDue);
  }
  const frozen = freeze(f, [
    planFor(haul, {
      outcome: 'CARGO_LOST',
      proceeds: minor(0),
      elections,
      causeEventId: raid,
    }),
  ]);
  return { haul, frozen, raid };
}

describe('INV-17 — the attribution column, resolved by the caller that appends the batch', () => {
  it('an ELAPSED_WINDOW default parents on the settled row that was minted a step earlier', () => {
    const f = fixture();
    const { frozen } = declined(f);
    const outcome = run(f, frozen);

    expect(outcome.defaults).toHaveLength(1);
    const attribution = outcome.defaults[0];
    const settledId = outcome.receipts[0]?.settledEventId;
    expect(attribution?.cause).toBe('ELAPSED_WINDOW');
    expect(attribution?.causeEventId).toBe(settledId);

    const row = f.events.get(attribution?.defaultEventId ?? ('' as never));
    // The column, which is what INV-17 checks and what an auditor joins on.
    expect(row?.event.parentEventId).toBe(settledId);
    // And the human-readable copy beside it, deliberately duplicated.
    expect(row?.event.payload['causeEventId']).toBe(settlementHandle(RECKONING, 'v-haul-1' as never));
    // The cause precedes the effect in the record, not merely in intent.
    const cause = f.events.get(settledId ?? ('' as never));
    expect(cause?.event.tick).toBe(row?.event.tick);
    expect(cause?.event.seqInTick).toBeLessThan(row?.event.seqInTick ?? -1);
  });

  it('a LOSS default parents on the raid, not on the settlement', () => {
    const f = fixture(minor(2_500));
    const { frozen, raid } = raided(f);
    const outcome = run(f, frozen);

    expect(outcome.transaction.committed).toBe(true);
    expect(outcome.defaults.length).toBeGreaterThan(0);
    for (const attribution of outcome.defaults) {
      expect(attribution.cause).toBe('LOSS');
      expect(attribution.causeEventId).toBe(raid);
      expect(f.events.get(attribution.defaultEventId)?.event.parentEventId).toBe(raid);
    }
    // The escrowed shortfall is a recorded LOSS and never a default, and its row points at
    // the raid too.
    const lossRow = f.events.get(outcome.receipts[0]?.lossEventIds[0] ?? ('' as never));
    expect(lossRow?.event.payload['isDefault']).toBe(false);
    expect(lossRow?.event.parentEventId).toBe(raid);
  });

  it('checkInv17 walks the whole ledger clean, in both directions', () => {
    const f = fixture();
    const { frozen } = declined(f);
    run(f, frozen);
    // Forward: every default-shaped row has an attribution whose cause is in the ledger and
    // precedes it. Backward: every attribution names a row that exists and is a default.
    expect(checkInv17(f.events, f.register, SETTLE_TICK, { scope: 'FULL' })).toEqual([]);
    expect(f.register.size).toBe(1);
  });

  it('refuses to publish an accusation whose evidence is not in the record', () => {
    const f = fixture();
    const { haul } = declined(f);
    const settled = appendPublic(f, {
      tick: SETTLE_TICK,
      kind: 'venture.settled',
      actor: ALICE,
      payload: { venture: haul.id },
    });
    expect(() =>
      resolveDefaultCause({
        d: {
          venture: haul.id,
          roleIndex: 1,
          payer: ALICE,
          payee: BRAM,
          amount: minor(10),
          cause: 'DECLINED',
          causeEventId: 'ev:999:0' as never,
          actedBy: null,
          boundByGrant: null,
        },
        handle: settlementHandle(RECKONING, haul.id),
        settledEventId: settled,
        events: f.events,
      }),
    ).toThrow(ReckoningHalt);
  });

  it('standing falls only where the record can show the default', () => {
    const f = fixture();
    const { frozen } = declined(f);
    run(f, frozen);
    const fall = f.standing.changes().find((c) => c.cause === 'DEFAULT');
    // The journal cites the minted default row, so INV-21's clause — reputation never falls
    // for an accusation the engine cannot justify — has something to check.
    expect(fall?.eventId).toBe(f.register.all()[0]?.defaultEventId);
    expect(f.register.has(fall?.eventId ?? ('' as never))).toBe(true);
  });
});

describe('INV-19 — the frozen capture, and why it is not a tautology', () => {
  it('captures acted_on_state_version at the freeze, and it is NOT the engine s live counter', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], PROCEEDS);
    const pinnedAtActivation = haul.actedOnStateVersion;

    // The engine moves on between activation and the freeze, as it always does: that is
    // what a formation window *is*.
    f.bump();
    f.bump();
    const frozen = freeze(f, [planFor(haul, { proceeds: PROCEEDS })]);

    const captured = frozen.obligations[0]?.reading.actedOnStateVersion;
    expect(captured).toBe(pinnedAtActivation);
    // The two values the settlement must never be handed. If the driver passed either, the
    // comparison would halt every healthy venture or could never fail at all.
    expect(frozen.stateVersion).toBeGreaterThan(captured ?? -1);
    expect(captured).not.toBe(frozen.stateVersion);
  });

  it('the frozen set is immutable, so the capture cannot be rewritten before it is compared', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], PROCEEDS);
    const frozen = freeze(f, [planFor(haul, { proceeds: PROCEEDS })]);

    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.obligations)).toBe(true);
    expect(Object.isFrozen(frozen.obligations[0])).toBe(true);
    expect(Object.isFrozen(frozen.obligations[0]?.reading)).toBe(true);
  });

  it('a pinned version rewritten between the freeze and the settlement halts the tick', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], PROCEEDS);
    const frozen = freeze(f, [planFor(haul, { proceeds: PROCEEDS })]);

    // Scar #6's shape: the resolver would read a state the players never acted on.
    haul.actedOnStateVersion = 9_999;

    const faults = verifyFrozenInputs(frozen, {
      ledger: f.ledger,
      book: f.book,
      accounts: f.reckoningWorld.accounts,
    });
    expect(faults.join(' ')).toContain('INV-19');
    expect(faults.join(' ')).toContain('the pinned version was rewritten');

    const outcome = run(f, frozen);
    expect(outcome.transaction.committed).toBe(false);
    expect(outcome.transaction.failedAt).toBe('VERIFY_INPUTS');
    expect(outcome.defaults).toEqual([]);
  });

  it('supplies checkInv19 with the captured copy against the live row, so a healthy world passes', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], PROCEEDS);
    f.bump();
    const frozen = freeze(f, [planFor(haul, { proceeds: PROCEEDS })]);

    const items = settlementItemsOf(frozen, f.book);
    expect(items).toHaveLength(1);
    expect(items[0]?.pinnedStateVersion).toBe(haul.actedOnStateVersion);
    expect(items[0]?.observedStateVersion).toBe(haul.actedOnStateVersion);
    expect(items[0]?.pinnedTermsHash).toBe(haul.termsHash);
    expect(items[0]?.observedTermsHash).toBe(haul.termsHash);
    // The point: a healthy world passes. Passing the engine's live counter as the observed
    // side would halt here, and a false halt is the same class of bug as a false default.
    expect(checkInv19(items, SETTLE_TICK)).toEqual([]);
  });

  it('runs INV-18 over a scope that actually contains the settlement s objects', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], PROCEEDS);
    const frozen = freeze(f, [planFor(haul, { proceeds: PROCEEDS })]);

    // A check over an empty scope passes vacuously, so the scope is asserted before the
    // result is believed.
    expect(frozen.objects.has(haul.id)).toBe(true);
    expect(frozen.objects.has(escrowAccount(haul.id, ALICE))).toBe(true);
    expect(frozen.objects.has(storesAccount(ALICE))).toBe(true);
    expect(frozen.objects.has(storesAccount(BRAM))).toBe(true);
    // Deliberately absent: bare principal ids. `touchedObjects` collects every string in a
    // payload, so listing a principal would make INV-18 fire on that agent's own unrelated
    // rows at the freeze tick — a false halt.
    expect(frozen.objects.has(ALICE)).toBe(false);

    const outcome = run(f, frozen);
    // The settlement's own rows plainly touch every object above, and INV-18 still passes,
    // because `settlementSeqFrom` separates them from a third party's.
    expect(outcome.report?.checked).toContain('INV-18');
    expect(outcome.report?.violations).toEqual([]);
  });
});
