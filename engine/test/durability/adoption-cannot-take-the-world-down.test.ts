/**
 * ADOPTION IS AN OPTIMISATION. IT MUST NEVER BE ABLE TO CAUSE AN OUTAGE.
 *
 * Checkpoint adoption ran in production for the first time ever on 2026-07-26 — the write-once rules
 * gate in `planCheckpoint` had refused it on every boot since the world's first rules change, so the
 * path had never once executed — and it threw:
 *
 *     CHECKPOINT_UNUSABLE at tick 4895
 *     posting (tick 2830, batch 0, index 1) moves value in account
 *     escrow:v:2830:117e86ad:p:vale, which the snapshot's ledger capture does not contain.
 *
 * Boot turned that into `BootError` with `operatorInstruction: null` — no door, on the reasoning that
 * *"the posting log and the snapshot describe different worlds… the record itself is inconsistent."*
 * The world HELD: every route answering 503, for four minutes.
 *
 * **The diagnosis was wrong, and the next boot proved it.** Replaying the same journal from genesis
 * verified 17 snapshot tripwires and came up healthy at the same head. The record was sound. What had
 * actually happened is that the account check's premise is false: a checkpoint at 4895 captures the
 * accounts alive at 4895, the hydrate feeds it every posting since genesis, and an escrow that opened
 * and closed in between is legitimately absent. The check assumed the final account set is a superset
 * of every account ever referenced.
 *
 * So the world was taken down by an optimisation failing safely, on a record that was fine.
 *
 * ── THE PROPERTY THIS FILE PINS ──────────────────────────────────────────────
 *
 * A snapshot this build cannot rebuild is a reason to take the SLOW path, not a reason to stop
 * serving. `CheckpointUnusableError` is thrown only from validation that provably precedes any
 * mutation — `hydrateLedgerForSnapshot` builds its batches in memory and touches the ledger on its
 * last line — so the runtime is still clean and boot can fall through to the genesis replay it would
 * have run had `planCheckpoint` refused in the first place.
 *
 * **What is deliberately NOT relaxed:** a failure at or after `hydrateAppendOnly`, in the event
 * hydrate, or in `adoptSnapshot` leaves a half-built world, and replaying into that would be worse
 * than refusing to serve. Those still throw. The second test pins that, because a fix that made
 * every adoption failure recoverable would have traded an outage for a corrupt world.
 *
 * The condition is constructed here by re-pointing one posting at an account no capture contains,
 * which is the shape rather than the cause. **The cause is now reproduced**, in
 * `a-forked-record-cannot-be-adopted.test.ts`: an accepted divergence forks the world from its own
 * durable log, and a venture id derived from a world-global ordinal is renamed by any action the new
 * rules refuse. The property under test here — *an unrebuildable snapshot degrades instead of
 * holding* — does not depend on which account went missing or why, so this fixture stands as
 * written.
 *
 * What DID change under it: "everything else still throws" is no longer the ordering accident it was.
 * Boot now reads and checks both append-only halves before applying either, so a recoverable refusal
 * cannot arrive with the ledger already rebuilt. That was not caution: making the event half
 * recoverable without it produced a fallback that halted on its first replayed tick.
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed } from '../../src/core/time.js';
import {
  bootFromStore,
  InMemoryJournalStore,
  Journal,
  type JournalStore,
  type PersistedPosting,
} from '../../src/persist/index.js';
import { Runtime } from '../../src/sim/runtime.js';

const SEED = 'adoption-no-outage';
const TICKS = 320;

/** A real journal with at least one adoptable snapshot, plus the head hash to compare against. */
async function journalled(): Promise<{ store: InMemoryJournalStore; headHash: string; tick: number }> {
  setSpeed('instant');
  const runtime = new Runtime({ seed: SEED });
  const cast = new HeuristicCast(runtime, { size: 6 });
  cast.seat(SEED);
  const store = new InMemoryJournalStore();
  const journal = new Journal(store, { snapshotEveryTicks: 100 });
  await bootFromStore(runtime, store, { seed: SEED });
  for (let i = 0; i < TICKS; i += 1) {
    for (const a of cast.decide(runtime.engine.tick + 1, SEED)) runtime.engine.submit(a);
    const report = runtime.runTick();
    if (report.halted) throw new Error(`sim halted at ${String(report.tick)}`);
    journal.record(runtime, report);
    await journal.flushPending();
  }
  await journal.drain();
  return { store, headHash: runtime.engine.stateHash, tick: runtime.engine.tick };
}

function seated(): Runtime {
  setSpeed('instant');
  const rt = new Runtime({ seed: SEED });
  const cast = new HeuristicCast(rt, { size: 6 });
  cast.seat(SEED);
  return rt;
}

function registeredTables(rt: Runtime): readonly string[] {
  return rt.engine.stateTables.filter((t) => t.restore !== undefined).map((t) => t.name);
}

/**
 * The same store, but the POSTING LOG names an account the snapshot's capture does not hold.
 *
 * ── WHY A PROXY AND NOT A DAMAGED SNAPSHOT ───────────────────────────────────
 *
 * Two earlier constructions were wrong in instructive ways. Dropping an account from the capture and
 * leaving the hash made `planCheckpoint` refuse two gates earlier, so the fallback never ran.
 * Recomputing the hash got the fallback to fire — and then the genesis replay tripped on that very
 * snapshot, because a genesis replay verifies every journalled snapshot as a tripwire and the edit had
 * made this one genuinely wrong.
 *
 * That second failure is the point. **Production's snapshot was not wrong.** Its genesis replay
 * verified 17 tripwires and reached the recorded head; the only thing that could not handle it was
 * adoption's account check. So a fixture that corrupts the snapshot is testing a different bug.
 *
 * The honest isolation is that the two boot paths read different things: a genesis replay replays the
 * ACTION log, and only the hydrate reads `postingsInRange`. Corrupting the posting log therefore
 * breaks adoption and leaves the slow path exactly as sound as it really is — which is the production
 * situation, reproduced in the one dimension that matters.
 */
function withAnUnknownAccountInThePostingLog(src: InMemoryJournalStore): JournalStore {
  return new Proxy(src, {
    get(target, prop, receiver): unknown {
      if (prop !== 'postingsInRange') return Reflect.get(target, prop, receiver) as unknown;
      return async (from: number, to: number): Promise<readonly PersistedPosting[]> => {
        const rows = await target.postingsInRange(from, to);
        const first = rows[0];
        if (first === undefined) return rows;
        // One row, re-pointed at an account no capture contains — the shape of an escrow that closed
        // before the checkpoint. Everything else about the row stays valid so the failure is the
        // account check and nothing else.
        return [{ ...first, account: 'escrow:v:1:closed:p:gone' as PersistedPosting['account'] }, ...rows.slice(1)];
      };
    },
  });
}

describe('a snapshot this build cannot rebuild costs a slow boot, not an outage', () => {
  it('falls back to a genesis replay and lands on the recorded world', async () => {
    const live = await journalled();
    const store = withAnUnknownAccountInThePostingLog(live.store);

    const fresh = seated();
    // The assertion that matters is that this does NOT throw. Before the fix it raised a BootError
    // with `operatorInstruction: null`, which `serve()` turns into a HELD world answering 503 on
    // every route — the four-minute outage described above.
    const result = await bootFromStore(fresh, store, {
      seed: SEED,
      checkpoint: { requiredTables: registeredTables(fresh) },
    });

    expect(result.adoptedAtTick, 'the damaged snapshot must not be adopted').toBeNull();
    // And it must say it TRIED and backed out, which is a different fact from never having tried.
    expect(result.checkpointRefusal).toMatch(/abandoned|does not contain/);
    // The slow path ran in full and re-derived the record.
    expect(result.ticksReplayed).toBe(TICKS);
    expect(result.tripwiresChecked, 'genesis replay checks every journalled snapshot').toBeGreaterThan(0);
    expect(fresh.engine.stateHash, 'and lands on exactly the recorded world').toBe(live.headHash);
  }, 180_000);

  it('the undamaged journal still ADOPTS, so the fallback is not hiding a broken optimisation', async () => {
    // The guard's own guard. A "fix" that quietly disabled adoption would pass the test above and
    // reintroduce the unbounded boot cost this whole line of work exists to remove.
    const live = await journalled();
    const fresh = seated();
    const result = await bootFromStore(fresh, live.store, {
      seed: SEED,
      checkpoint: { requiredTables: registeredTables(fresh) },
    });
    expect(result.adoptedAtTick, 'a sound snapshot must still be adopted').not.toBeNull();
    expect(result.ticksReplayed, 'and adoption must actually save work').toBeLessThan(TICKS);
    expect(fresh.engine.stateHash).toBe(live.headHash);
  }, 180_000);
});
