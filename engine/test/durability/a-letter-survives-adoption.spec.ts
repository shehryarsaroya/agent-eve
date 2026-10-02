/**
 * ★ **A LETTER SENT BEFORE THE CHECKPOINT CAN BE ANSWERED AFTER IT — ON AN ADOPTED BOOT
 * (`RULES_VERSION` 41).**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The parley book was a ring beside `talk`, outside every state table. That was safe by accident: a
 * booted world adopts the settlement-tick checkpoint and replays the tail, and while every count the
 * gate read was scoped to the current Reckoning, every row it could read was in that tail.
 *
 * 41 made the answer window ROLL across the boundary (`say/parley.ts` §4) — a letter landing two
 * ticks before settlement is answerable the next morning. So an adopted boot now replays an answer to
 * a letter from BEFORE its checkpoint, and an uncaptured book refuses it — and because the tail past
 * the last snapshot has no tripwire, the boot does not notice: it serves a world that has quietly
 * forked from the journal it was booted from.
 *
 * This is that scenario end to end, through the real journal and the real boot, and the second test
 * is the mutation proof `books-in-the-hash.test.ts` asks of every table: drop the `say` capture and
 * the same boot SUCCEEDS into a world that has forked from its own record — measured, and worse than
 * the outage this note first predicted, because the tail past the last snapshot carries no tripwire.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import type { CanonicalValue } from '../../src/core/canonical.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { InMemoryJournalStore, Journal, bootFromStore } from '../../src/persist/index.js';
import { SAY_TABLE } from '../../src/say/capture.js';
import { Runtime } from '../../src/sim/runtime.js';
import { holdingOf } from '../../src/world/index.js';

const SEED = 'say-adoption';
const CAST_SIZE = 6;
const OUTSIDER = 'p:letterbox' as PrincipalId;
/** The checkpoint the boot adopts: the second settlement. The letter lands just before it. */
const CHECKPOINT = 2 * TICKS_PER_RECKONING - 1;
const LETTER_AT = CHECKPOINT - 6;
const ANSWER_AT = CHECKPOINT + 12;
const END = CHECKPOINT + 20;

/** Seat the cast AND the outsider the same way in every runtime, before any tick. */
function seated(dropSay: boolean): { runtime: Runtime; cast: HeuristicCast } {
  setSpeed('instant');
  const runtime = new Runtime({ seed: SEED });
  const cast = new HeuristicCast(runtime, { size: CAST_SIZE });
  cast.seat(SEED);
  // Beside a member that is NOT a raider: raiders sit in the Marches, in another constellation, and
  // the OFFER rung is bounded by the constellation the writer stands in.
  const host = cast.roster.find((m) => m.role !== 'raider');
  if (host === undefined) throw new Error('no non-raider in the cast');
  runtime.seat(OUTSIDER, 'letterbox', holdingOf(runtime.world, host.principal).system);
  runtime.standing.open(OUTSIDER);
  if (dropSay) {
    const table = runtime.engine.stateTables.find((t) => t.name === SAY_TABLE);
    if (table === undefined) throw new Error('no say table');
    Object.assign(table, { capture: (): CanonicalValue => null, restore: (): void => undefined });
  }
  return { runtime, cast };
}

interface Run {
  readonly store: InMemoryJournalStore;
  readonly headHash: string;
  readonly writer: PrincipalId;
}

async function live(dropSay: boolean): Promise<Run> {
  const { runtime, cast } = seated(dropSay);
  const store = new InMemoryJournalStore();
  const journal = new Journal(store);
  await bootFromStore(runtime, store, { seed: SEED });
  let writer: PrincipalId | null = null;
  while (runtime.engine.tick < END) {
    const target = runtime.engine.tick + 1;
    for (const action of cast.decide(target, SEED)) runtime.engine.submit(action);
    if (target === LETTER_AT - 4) {
      runtime.engine.submit({
        principal: OUTSIDER,
        verb: 'publish_offer',
        params: { text: 'NEW HERE — WRITE TO ME' },
        clientSequence: 0,
        arrivalMs: 0,
        decisionSource: 'LIVE',
      });
    }
    if (target === LETTER_AT) {
      // The first cast member that was PAID in Reckoning 0 — entitled to speak first — and stands in
      // the outsider's constellation, so the advertisement is a rung it can reach.
      writer =
        cast.roster
          .map((m) => m.principal)
          .find(
            (p) =>
              runtime.parleysFor(p, target).parleys_per_reckoning > 0 &&
              runtime.parleyRefusalFor(p, OUTSIDER, target) === null,
          ) ?? null;
      if (writer === null) throw new Error('no cast member could write to the outsider');
      runtime.engine.submit({
        principal: writer,
        verb: 'message',
        params: { to: OUTSIDER, act: 'offer', text: 'Crew for a BUILD? Answer when you wake.' },
        clientSequence: 99,
        arrivalMs: 0,
        decisionSource: 'LIVE',
      });
    }
    if (target === ANSWER_AT && writer !== null) {
      runtime.engine.submit({
        principal: OUTSIDER,
        verb: 'message',
        params: { to: writer, act: 'accept', text: 'Yes — after the Reckoning, as you see.' },
        clientSequence: 0,
        arrivalMs: 0,
        decisionSource: 'LIVE',
      });
    }
    const report = runtime.runTick();
    if (report.halted) throw new Error(`live run halted at ${String(report.tick)}`);
    journal.record(runtime, report);
    await journal.flushPending();
  }
  await journal.drain();
  if (writer === null) throw new Error('the letter was never written');
  // Non-vacuity: the answer CROSSED the boundary — sent in Reckoning 2, to a letter from Reckoning 1 —
  // and it landed, unentitled, as an answer.
  const answer = runtime
    .parleysVisible(OUTSIDER, runtime.engine.tick)
    .find((e) => e.from === OUTSIDER && e.to === writer);
  expect(answer, 'the outsider\'s answer must have landed in the live run').toBeDefined();
  expect(answer?.answering, 'as an ANSWER — the outsider is entitled to nothing of its own').toBe(true);
  expect(answer?.tick ?? 0).toBeGreaterThan(CHECKPOINT);
  return { store, headHash: runtime.engine.stateHash, writer };
}

describe('★ the `say` table carries the letters an answer depends on', () => {
  it('an adopted boot replays an answer to a pre-checkpoint letter, and reaches the live head hash', async () => {
    const run = await live(false);
    const { runtime } = seated(false);
    const result = await bootFromStore(runtime, run.store, {
      seed: SEED,
      checkpoint: { requiredTables: runtime.engine.stateTables.filter((t) => t.restore !== undefined).map((t) => t.name) },
    });
    expect(result.adoptedAtTick, 'the boot must ADOPT the checkpoint, or this proves nothing about it').toBe(CHECKPOINT);
    expect(result.ticksReplayed).toBe(END - CHECKPOINT);
    expect(runtime.engine.stateHash, 'adopt-plus-tail reproduces the live world to the byte').toBe(run.headHash);
  }, 600_000);

  it('MUTATION PROOF: drop the `say` capture and the adopted world silently forks from the record', async () => {
    const run = await live(true);
    const { runtime } = seated(true);
    const result = await bootFromStore(runtime, run.store, {
      seed: SEED,
      checkpoint: { requiredTables: runtime.engine.stateTables.filter((t) => t.restore !== undefined).map((t) => t.name) },
    });
    // ── WORSE THAN AN OUTAGE, AND THAT IS WHAT THIS PROVES ────────────────────
    //
    // The tail past the last snapshot has no tripwire (`tripwiresChecked` is 0 on this boot), so the
    // boot SUCCEEDS — and serves a world in which the outsider never answered: the replayed letter was
    // refused against an empty book, the `say.parley` row the journal holds has no counterpart, and
    // every tick after it hashes differently from the one the record was written by. A5′: the record
    // must never be wrong, and an adopted world disagreeing with its own journal is the record being
    // wrong about what happened.
    expect(result.adoptedAtTick, 'it adopted the checkpoint, exactly as the healthy boot did').toBe(CHECKPOINT);
    expect(
      runtime.engine.stateHash,
      'without the table the adopted world must NOT reproduce the live head — if it did, the capture was ' +
        'decoration and this test would be proving nothing',
    ).not.toBe(run.headHash);
    const answered = runtime
      .parleysVisible(OUTSIDER, runtime.engine.tick)
      .some((e) => e.from === OUTSIDER && e.to === run.writer);
    expect(answered, 'and the answer the record says was sent does not exist in the booted world').toBe(false);
  }, 600_000);
});
