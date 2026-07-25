/**
 * `E2E-15` — a seal from a previous Reckoning is not re-evaluated in this one. *(Scar #7.)*
 *
 * > `SCAR-6` The mandatory event that didn't happen → `INV-18`, `INV-19`
 * > `SCAR-7` The sticky vow (unscoped window) → `INV-20`, `E2E-15`: every judgment stamped
 * > with its `reckoning_id`, evaluated once. — TESTING.md §12
 *
 * High Water's `lastSay` persisted across tides, so one promise was re-judged at every
 * subsequent court and ground an honest agent's reputation down for a single utterance.
 * `SealBook` closes that by construction — `reckoningIndex` is derived from the sealing
 * tick and `resolve` refuses to run outside its own settlement tick — so what is left for
 * the driver to prove is that **running a second Reckoning does not reopen the first**: no
 * second evaluation, no second verdict row, no second standing charge.
 *
 * That is a claim about two Reckonings, and it is the only test in this suite that runs
 * the driver twice.
 */

import { describe, expect, it } from 'vitest';
import { FREEZE_TICKS, TICKS_PER_RECKONING } from '../../src/core/time.js';
import { minor } from '../../src/core/units.js';
import { checkInv20 } from '../../src/seal/index.js';
import { computeClaims, type Election } from '../../src/venture/index.js';
import {
  ALICE,
  BRAM,
  CASS,
  FORM_TICK,
  SETTLE_TICK,
  appendPublic,
  fixture,
  freeze,
  goLive,
  haulDeed,
  makeHaul,
  planFor,
  run,
  sealFor,
  vid,
  type Fix,
} from './fixture.js';

const PROCEEDS = minor(12_000);
const SECOND_FORM_TICK = TICKS_PER_RECKONING + 1;
const SECOND_SETTLE_TICK = 2 * TICKS_PER_RECKONING - 1;

/** One Reckoning: a venture, a seal against a role its holder actually fills, a deed. */
function reckoning(
  f: Fix,
  args: {
    readonly id: string;
    readonly formTick: number;
    readonly settleTick: number;
    /** Below the band, so the seal is contradicted. In band, so it is honoured. */
    readonly delivered: number;
  },
) {
  const haul = makeHaul(f, {
    id: vid(args.id),
    windowOpensTick: args.formTick,
    resolvesAtTick: args.settleTick,
  });
  goLive(f, haul, [ALICE, BRAM], PROCEEDS, args.formTick);
  sealFor(
    f,
    BRAM,
    { verb: 'haul', target: haul.id, measure: 'MINOR', outcomeLow: 1_000, outcomeHigh: PROCEEDS },
    { venture: haul.id, roleIndex: 1 },
    args.formTick,
  );
  const deedEvent = appendPublic(f, {
    tick: args.formTick + 1,
    kind: 'venture.delivery',
    actor: BRAM,
    payload: { venture: haul.id, deliveredMinor: args.delivered },
  });
  const elections = new Map<number, Election>();
  for (const r of computeClaims(haul, PROCEEDS).roles) {
    if (r.electiveDue > 0) elections.set(r.roleIndex, r.electiveDue);
  }
  // `freeze` takes the FREEZE tick, which is `FREEZE_TICKS` before the settlement it
  // resolves (SPEC §5.1). It used to be handed `args.settleTick` directly, which only
  // worked while `core/time.ts` made phase 287 both freeze and settlement; the driver then
  // derives the settlement tick back out of the frozen set, so every verdict below is
  // still stamped at `args.settleTick`.
  const frozen = freeze(
    f,
    [planFor(haul, { proceeds: PROCEEDS, elections })],
    args.settleTick - FREEZE_TICKS,
  );
  return run(f, frozen, {
    deeds: [
      haulDeed({
        principal: BRAM,
        venture: haul.id,
        outcome: args.delivered,
        tick: args.formTick + 1,
        valuedAtStateVersion: f.version(),
        eventId: deedEvent,
      }),
    ],
    deedTally: [[BRAM, 1]],
  });
}

describe('E2E-15 — a seal is judged at its own Reckoning and never at a later one', () => {
  it('the first Reckoning s seal keeps its one verdict when the second runs', () => {
    const f = fixture();
    // Reckoning 0: the load falls short of the sealed band, so the seal is contradicted.
    const first = reckoning(f, { id: 'v-a', formTick: FORM_TICK, settleTick: SETTLE_TICK, delivered: 10 });
    expect(first.transaction.committed).toBe(true);
    expect(first.seals?.verdicts).toHaveLength(1);
    expect(first.seals?.verdicts[0]?.verdict).toBe('CONTRADICTED');

    const sealId = first.seals?.verdicts[0]?.sealId;
    if (sealId === undefined) throw new Error('fixture');
    const afterFirst = f.seals.auditRecord(sealId);
    expect(afterFirst?.evaluations).toBe(1);
    expect(afterFirst?.verdictAtTick).toBe(SETTLE_TICK);
    expect(f.standing.row(BRAM).contradictedSeals).toBe(1);

    // Reckoning 1: a fresh venture, a fresh seal, delivered in band this time.
    const second = reckoning(f, {
      id: 'v-b',
      formTick: SECOND_FORM_TICK,
      settleTick: SECOND_SETTLE_TICK,
      delivered: PROCEEDS,
    });
    expect(second.transaction.committed).toBe(true);

    // The first seal is untouched: same verdict, same tick, still exactly one evaluation.
    const afterSecond = f.seals.auditRecord(sealId);
    expect(afterSecond?.evaluations).toBe(1);
    expect(afterSecond?.verdict).toBe('CONTRADICTED');
    expect(afterSecond?.verdictAtTick).toBe(SETTLE_TICK);

    // The second court judged only its own seal.
    expect(second.seals?.reckoningIndex).toBe(1);
    expect(second.seals?.verdicts).toHaveLength(1);
    expect(second.seals?.verdicts[0]?.sealId).not.toBe(sealId);
    expect(second.seals?.verdicts[0]?.verdict).toBe('HONOURED');

    // The standing charge did not repeat. One utterance, one mark, forever — which is the
    // whole of scar #7.
    expect(f.standing.row(BRAM).contradictedSeals).toBe(1);
    expect(f.standing.changes().filter((c) => c.cause === 'CONTRADICTED_SEAL')).toHaveLength(1);
    expect(checkInv20(f.seals, SECOND_SETTLE_TICK)).toEqual([]);
  });

  it('publishes exactly one verdict row per seal, ever', () => {
    const f = fixture();
    reckoning(f, { id: 'v-a', formTick: FORM_TICK, settleTick: SETTLE_TICK, delivered: 10 });
    reckoning(f, {
      id: 'v-b',
      formTick: SECOND_FORM_TICK,
      settleTick: SECOND_SETTLE_TICK,
      delivered: PROCEEDS,
    });

    const rows = [SETTLE_TICK, SECOND_SETTLE_TICK].flatMap((t) =>
      f.events.eventsAtTick(t).filter((r) => r.event.kind === 'SEAL_RESOLVED'),
    );
    expect(rows).toHaveLength(2);
    const ids = rows.map((r) => r.event.payload['sealId']);
    expect(new Set(ids).size).toBe(2);
  });

  it('a second run of the same Reckoning is refused rather than settling twice', () => {
    const f = fixture();
    const haul = makeHaul(f, { id: vid('v-a'), creator: CASS });
    goLive(f, haul, [CASS, BRAM], PROCEEDS);
    const frozen = freeze(f, [planFor(haul, { proceeds: PROCEEDS })]);
    expect(run(f, frozen).transaction.committed).toBe(true);

    // The idempotence gate. Two receipts for one promise is a record that cannot be read,
    // and the seal book's "exactly one resolution" is what the driver borrows to know.
    const second = run(f, frozen);
    expect(second.transaction.committed).toBe(false);
    expect(second.transaction.failedAt).toBe('FREEZE');
    // A plan-stage failure, so nothing was applied twice: the payer is not double-charged.
    expect(second.transaction.torn).toBe(false);
    expect(second.transaction.applied).toEqual([]);
    expect(second.transaction.haltRecord?.reason ?? '').toContain('second settlement');
  });
});
