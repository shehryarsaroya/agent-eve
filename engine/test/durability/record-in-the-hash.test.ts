/**
 * THE RECORD'S TWO UNTESTED HALVES, AND THE PHASE MOVE THAT PUT IT IN THE HASH.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Registering the `event` book closed a hash gap and opened three questions that
 * `books-in-the-hash` cannot answer, because every world it runs has **zero audience
 * rows** and it never leaves the tick loop:
 *
 *   1. **The audience count is one of the four the capture carries, and it was 0 in
 *      every fixture.** `{"events":125,"audience":0,...}` — so the fan-out half of the
 *      capture was decoration, and the truncation that undoes it had never removed a
 *      row. A market order writes one (`visibility: 'PRIVATE'`, `basis: 'SELF'`), which
 *      is how this file gets a non-zero one.
 *   2. **The hydrate rebuilds the audience from the journal, and nothing compared the
 *      result.** `restoreTo` refuses to *grow*, so a hydrate short on audience rows is
 *      caught — but a hydrate that rebuilt the same number of rows in a different
 *      order, or lost a `basis`, would pass the count check and serve a different feed
 *      to a real agent. The counts are not the claim; the feed is.
 *   3. **The record moved from COMMIT to DERIVE**, one phase earlier, so that rows land
 *      inside the `state_hash` that claims to cover them. `tick/determinism` and
 *      `tick/regressions` both pin "nothing written after DERIVE is in the hash" — on a
 *      bare `Engine` with four ticks of moves, and on the intent prune. Neither runs a
 *      `Runtime`, and the `Runtime` is where all sixteen `emitRow` sites, the Reckoning
 *      batch and the Levy sweep live. If any of them writes a hashed table after DERIVE
 *      the published hash is a lie, and the next tick's abort restores a snapshot that
 *      never described the world.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import type { InvariantViolation } from '../../src/core/types.js';
import { EventLedger } from '../../src/events/index.js';
import {
  InMemoryJournalStore,
  extractTick,
  hydrateEventsForSnapshot,
  snapshotRecordOf,
} from '../../src/persist/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { captureSnapshot, type StateTable } from '../../src/tick/index.js';
import { ALICE, BOB, GOOD, submit, tick, world } from '../market/fixture.js';

function tableOf(runtime: Runtime, name: string): StateTable {
  const found = runtime.engine.stateTables.find((t) => t.name === name);
  if (found === undefined) throw new Error(`no state table named '${name}'`);
  return found;
}

/** Force this tick to abort, through the engine's own assertion hook. */
function abortNextTick(runtime: Runtime): void {
  const engine = runtime.engine as unknown as {
    assertions: ((tick: number) => readonly InvariantViolation[])[];
  };
  engine.assertions.push((t): readonly InvariantViolation[] => [
    { id: 'INV-1', tick: t, severity: 'HALT', message: 'injected, to abort this tick on purpose' },
  ]);
}

const FEED = { after: null, limit: 200 } as const;

describe('the AUDIENCE half of the record is carried, hashed and rolled back', () => {
  it('a market order writes a fan-out row, and an aborted tick removes it exactly', () => {
    const { runtime, venue } = world('audience-abort', ALICE, BOB);

    const before = tableOf(runtime, 'event').capture() as Record<string, number>;
    expect(before['audience']).toBe(0);

    submit(runtime, ALICE, 'trade', {
      operation: 'place',
      venue,
      good: GOOD,
      side: 'ASK',
      quantity: 40,
      limit_price: 10,
    });
    tick(runtime);

    // NON-VACUITY. Without this the rollback below proves nothing: it is the only
    // assertion in the suite that says the fan-out table is reachable at all.
    const withRow = tableOf(runtime, 'event').capture() as Record<string, number>;
    expect(withRow['audience'], 'a placed order must fan out to its own principal').toBeGreaterThan(
      0,
    );

    const capBefore = tableOf(runtime, 'event').capture();
    const hashBefore = runtime.engine.stateHash;
    const aliceBefore = JSON.stringify(
      runtime.events.agentFeed({ principal: ALICE, atTick: runtime.engine.tick, ...FEED }),
    );
    const bobBefore = JSON.stringify(
      runtime.events.agentFeed({ principal: BOB, atTick: runtime.engine.tick, ...FEED }),
    );
    const rows = runtime.events.audienceRowCount;

    // A tick that writes a SECOND fan-out row, and then aborts.
    submit(runtime, BOB, 'trade', {
      operation: 'place',
      venue,
      good: GOOD,
      side: 'BID',
      quantity: 10,
      limit_price: 3,
    });
    abortNextTick(runtime);
    const report = runtime.runTick();
    expect(report.halted).toBe(true);
    expect(runtime.engine.rollbackGaps).toEqual([]);

    // The counts, the hash, and — the part a count cannot check — the per-principal
    // reveal streams, which are truncated by ordinal rather than by length.
    expect(tableOf(runtime, 'event').capture()).toEqual(capBefore);
    expect(runtime.events.audienceRowCount).toBe(rows);
    expect(runtime.engine.stateHash).toBe(hashBefore);
    expect(
      captureSnapshot(
        runtime.engine.stateTables,
        runtime.engine.tick,
        runtime.engine.snapshot().stateVersion,
      ).stateHash,
    ).toBe(hashBefore);
    expect(
      JSON.stringify(runtime.events.agentFeed({ principal: ALICE, atTick: runtime.engine.tick, ...FEED })),
    ).toBe(aliceBefore);
    expect(
      JSON.stringify(runtime.events.agentFeed({ principal: BOB, atTick: runtime.engine.tick, ...FEED })),
      "BOB must not be able to read the order the aborted tick never placed",
    ).toBe(bobBefore);
  }, 120_000);

  it('a hydrate rebuilds the fan-out, and every principal feed comes back byte-identical', async () => {
    // The `event` capture is four counts, so an adopted world's record comes from the
    // journal. `restoreTo` checks the counts; nothing checked the ROWS. A rebuild that
    // lost a `basis`, or ordered two reveals differently, satisfies the counts exactly
    // and serves a different feed to a real agent — a wrong record that passes its own
    // integrity check, which is the failure this whole change exists to close.
    const { runtime, venue } = world('audience-hydrate', ALICE, BOB);
    const store = new InMemoryJournalStore();
    await store.init('audience-hydrate');

    let last: ReturnType<Runtime['runTick']> | null = null;
    for (let i = 0; i < 24; i += 1) {
      if (i % 3 === 0) {
        submit(
          runtime,
          i % 2 === 0 ? ALICE : BOB,
          'trade',
          {
            operation: 'place',
            venue,
            good: GOOD,
            side: i % 2 === 0 ? 'ASK' : 'BID',
            quantity: 2,
            limit_price: 10,
          },
          900 + i,
        );
      }
      const report = runtime.runTick();
      if (report.halted) {
        throw new Error(
          `the fixture halted at ${String(report.tick)}: ` +
            report.violations.map((v) => `${v.id} ${v.message}`).join(' | '),
        );
      }
      await store.appendTick(extractTick(runtime, report));
      last = report;
    }
    expect(last).not.toBeNull();
    if (last === null) return;
    const snapshot = snapshotRecordOf(runtime, last);
    await store.writeSnapshot(snapshot);

    const live = runtime.events.capture() as Record<string, number>;
    expect(live['audience'], 'non-vacuity: this run must have fanned out').toBeGreaterThan(0);

    const rebuilt = new EventLedger();
    const hydration = await hydrateEventsForSnapshot(rebuilt, store, snapshot);
    expect(hydration.events).toBe(live['events']);
    // Zero today. Non-zero would mean reveal ordinals were re-derived rather than
    // carried, which `EventHydration.lateAdmissions` exists to make visible.
    expect(hydration.lateAdmissions).toBe(0);
    expect(rebuilt.capture()).toEqual(live);

    for (const principal of [ALICE, BOB]) {
      const before = runtime.events.agentFeed({ principal, atTick: runtime.engine.tick, ...FEED });
      const after = rebuilt.agentFeed({ principal, atTick: runtime.engine.tick, ...FEED });
      expect(after.views.length, `${principal} sees a different number of rows`).toBe(
        before.views.length,
      );
      expect(JSON.stringify(after), `${principal}'s feed is not the one the run produced`).toBe(
        JSON.stringify(before),
      );
    }
    // And the fan-out index itself, row for row, including `basis` and `admittedAtTick`.
    for (const t of runtime.events.ticks()) {
      for (const rec of runtime.events.eventsAtTick(t)) {
        expect(rebuilt.audienceOf(rec.event.id)).toEqual(runtime.events.audienceOf(rec.event.id));
      }
    }
  }, 300_000);
});

describe('the record is written in DERIVE, so the published hash describes the world', () => {
  it('600 Runtime ticks across two Reckonings: recapturing at tick close never differs', () => {
    // The existing post-DERIVE tests run a bare `Engine`: four ticks of moves, and the
    // intent prune. This is the same rule on the object that actually moved — the
    // `Runtime`, with sixteen `emitRow` sites, the Reckoning batch, the Levy sweep and
    // the raid resolution all running after the record's new flush slot.
    //
    // If this ever goes red, `state_hash` is a number no observer can reproduce and the
    // NEXT tick's abort silently reverts whatever the later phase wrote.
    const seed = 'derive-slot';
    const runtime = new Runtime({ seed });
    const cast = new HeuristicCast(runtime, { size: 6 });
    cast.seat(seed);
    const queued = (runtime as unknown as { pendingRecord: readonly unknown[] }).pendingRecord;

    let settlements = 0;
    for (let i = 0; i < 600; i += 1) {
      const target = runtime.engine.tick + 1;
      for (const action of cast.decide(target, seed)) runtime.engine.submit(action);
      const report = runtime.runTick();
      expect(
        report.halted,
        report.violations.map((v) => `${v.id} ${v.message}`).join(' | '),
      ).toBe(false);
      if (report.clock.isSettlementTick) settlements += 1;

      const recaptured = captureSnapshot(
        runtime.engine.stateTables,
        report.tick,
        report.stateVersion,
      );
      expect(recaptured.stateHash, `a hashed table moved after DERIVE at tick ${String(report.tick)}`).toBe(
        report.stateHash,
      );
      expect(runtime.engine.snapshot().stateHash).toBe(report.stateHash);
      // Nothing may be left queued at tick close: a row still in the buffer would be
      // appended by the NEXT tick's DERIVE, at a tick number the ledger's watermark
      // refuses, and the fault would be a silently missing row in the record.
      expect(queued.length, `a row was queued after DERIVE at tick ${String(report.tick)}`).toBe(0);
    }

    // Non-vacuity: a run that never settles never exercises the Reckoning batch, which
    // is the one phase that appends receipts and moves five books at once.
    expect(settlements, 'the run must cross a Reckoning').toBeGreaterThan(1);
    // The engine's COMMIT sink is a tripwire now. A row arriving there is a call site
    // still emitting outside the hash.
    expect(runtime.operatorFaults().filter((f) => /emit|COMMIT/i.test(f))).toEqual([]);
  }, 300_000);
});
