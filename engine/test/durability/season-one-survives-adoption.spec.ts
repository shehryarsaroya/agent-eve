/**
 * ★ **SEASON 1, ADOPTED: A BOOT THAT TAKES A CHECKPOINT ACROSS EVERY BOOK THE FOUR LANES ADDED, AND
 * REACHES THE LIVE HEAD HASH** (Season 1 merge).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Each Season 1 lane added state that a booted world must carry across an adopted checkpoint, and each
 * proved its own book in isolation: the season table (`season`), the letter and offer books (`say`),
 * the WORKS play clock (`works.played`), and the grown map (`world`, rebuilt by `regrowMap`). The class
 * of failure they share is the one `a-letter-survives-adoption.spec.ts` measured: a captured table that
 * misses a book does not fail the boot — the tail past the last snapshot has no tripwire, so the boot
 * SUCCEEDS into a world that has silently forked from its own record (A5′).
 *
 * So this is one world that holds all four at once, through the real journal and the real boot:
 *
 *   - a whole SEASON played from genesis by the house cast, so the checkpoint the boot adopts is the
 *     FINALE's own settlement — the season record written, every Frontier claim CLOSED, the grand
 *     venture's verdict on the book — and the replayed tail is Season 2's first ticks;
 *   - a grown region: `growthPerSystem` 0 opens a constellation at every settlement, so the adopted
 *     map is the launch map plus one per Reckoning (the knob production never passes; `world/growth.ts`);
 *   - a DORMANT WORKS: `p:sleeper` raises one on its first wake and never acts again until the tail,
 *     where one accepted act wakes it — so the play clock has to survive adoption for the WORKS to resume
 *     on the tick the record says it did;
 *   - a LETTER: written to `p:letterbox` ten ticks before the checkpoint and answered twelve ticks after
 *     it, free, as an answer — the replayed answer has to find its letter in the adopted `say` book.
 *
 * The assertion is the only one that matters for A5′: adopt-plus-tail reaches the live head hash, to
 * the byte. Every fact above is first established on the live run, so none of it can pass vacuously.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { InMemoryJournalStore, Journal, bootFromStore } from '../../src/persist/index.js';
import { finaleTickOf } from '../../src/season/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import type { SubmittedAction } from '../../src/tick/index.js';
import { commonsSystems, holdingOf } from '../../src/world/index.js';

const SEED = 'season-one-adoption';
const CAST_SIZE = 12;
const SLEEPER = 'p:sleeper' as PrincipalId;
const LETTERBOX = 'p:letterbox' as PrincipalId;
/** The checkpoint the boot adopts: the FINALE's settlement, where the season boundary ran. */
const CHECKPOINT = finaleTickOf(1);
const BUILD_AT = 2;
const OFFER_AT = CHECKPOINT - 30;
const LETTER_AT = CHECKPOINT - 10;
const ANSWER_AT = CHECKPOINT + 12;
const WAKE_AT = CHECKPOINT + 16;
const END = CHECKPOINT + 30;

function seated(): { runtime: Runtime; cast: HeuristicCast } {
  setSpeed('instant');
  const runtime = new Runtime({ seed: SEED, growthPerSystem: 0 });
  const cast = new HeuristicCast(runtime, { size: CAST_SIZE });
  cast.seat(SEED);
  // The letterbox stands beside a member that is not a raider, so a cast writer can reach it through
  // the OFFER rung (bounded by the constellation the writer stands in).
  const host = cast.roster.find((m) => m.role !== 'raider');
  if (host === undefined) throw new Error('no non-raider in the cast');
  runtime.seat(LETTERBOX, 'letterbox', holdingOf(runtime.world, host.principal).system);
  const quiet = commonsSystems(runtime.world.map).at(-1);
  if (quiet === undefined) throw new Error('the launch map has no Commons');
  runtime.seat(SLEEPER, 'sleeper', quiet);
  for (const p of [LETTERBOX, SLEEPER]) runtime.standing.open(p);
  return { runtime, cast };
}

function observe(runtime: Runtime, principal: PrincipalId): ReturnType<typeof buildObservation> {
  return buildObservation({
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 16,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  });
}

function act(principal: PrincipalId, verb: string, params: Readonly<Record<string, unknown>>): SubmittedAction {
  return { principal, verb, params, clientSequence: 0, arrivalMs: 0, decisionSource: 'LIVE' };
}

interface Live {
  readonly store: InMemoryJournalStore;
  readonly headHash: string;
  readonly grown: number;
  readonly writer: PrincipalId;
}

async function live(): Promise<Live> {
  const { runtime, cast } = seated();
  const store = new InMemoryJournalStore();
  const journal = new Journal(store);
  await bootFromStore(runtime, store, { seed: SEED });
  let writer: PrincipalId | null = null;
  while (runtime.engine.tick < END) {
    const target = runtime.engine.tick + 1;
    for (const action of cast.decide(target, SEED)) runtime.engine.submit(action);
    if (target === BUILD_AT) {
      // The sleeper's one act for four-plus Reckonings: the WORKS its own menu offers it, verbatim.
      const offered = observe(runtime, SLEEPER).affordances.find(
        (a) => a.verb === 'build' && (a.params as Record<string, unknown>)['kind'] === 'WORKS',
      );
      if (offered === undefined) throw new Error('the sleeper was offered no WORKS');
      runtime.engine.submit(act(SLEEPER, 'build', offered.params));
    }
    if (target === OFFER_AT) runtime.engine.submit(act(LETTERBOX, 'publish_offer', { text: 'NEW HERE — WRITE TO ME' }));
    if (target === LETTER_AT) {
      writer =
        cast.roster
          .map((m) => m.principal)
          .find(
            (p) =>
              runtime.parleysFor(p, target).parleys_per_reckoning > 0 &&
              runtime.parleyRefusalFor(p, LETTERBOX, target) === null,
          ) ?? null;
      if (writer === null) throw new Error('no cast member could write to the letterbox');
      runtime.engine.submit({
        ...act(writer, 'message', { to: LETTERBOX, act: 'offer', text: 'Crew for Season 2? Answer when you wake.' }),
        clientSequence: 99,
      });
    }
    if (target === ANSWER_AT && writer !== null) {
      runtime.engine.submit(act(LETTERBOX, 'message', { to: writer, act: 'accept', text: 'Yes — after the boundary.' }));
    }
    if (target === WAKE_AT) runtime.engine.submit(act(SLEEPER, 'publish_offer', { text: 'BACK, AND WORKING' }));
    const report = runtime.runTick();
    if (report.halted) {
      throw new Error(`live run halted at ${String(report.tick)}: ${report.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`);
    }
    expect(report.violations, `tick ${String(report.tick)}`).toEqual([]);
    journal.record(runtime, report);
    await journal.flushPending();
    // ── THE FOUR BOOKS, ESTABLISHED ON THE LIVE RUN BEFORE ANYTHING IS ASSERTED ABOUT A BOOT ──
    if (report.tick === BUILD_AT) {
      expect(runtime.works.ofPrincipal(SLEEPER), 'the sleeper raised its WORKS').toHaveLength(1);
    }
    if (report.tick === CHECKPOINT) {
      expect(runtime.seasons.closedThrough, 'the season boundary ran at the FINALE').toBe(1);
      expect(runtime.seasons.last()?.season, 'and its record is on the book').toBe(1);
      expect(runtime.world.map.grown.length, 'the region has grown').toBeGreaterThan(0);
      expect(runtime.works.isDormant(SLEEPER, CHECKPOINT), 'the sleeper is DORMANT at the checkpoint').toBe(true);
      expect(writer, 'the letter was written before the checkpoint').not.toBeNull();
    }
  }
  await journal.drain();
  if (writer === null) throw new Error('the letter was never written');
  // The answer crossed the checkpoint, as an answer; and the sleeper woke inside the tail.
  const answer = runtime
    .parleysVisible(LETTERBOX, runtime.engine.tick)
    .find((e) => e.from === LETTERBOX && e.to === writer);
  expect(answer?.answering, 'the letterbox answered after the checkpoint, free').toBe(true);
  expect(answer?.tick ?? 0).toBeGreaterThan(CHECKPOINT);
  expect(runtime.works.isDormant(SLEEPER, END), 'one accepted act woke the sleeper').toBe(false);
  return { store, headHash: runtime.engine.stateHash, grown: runtime.world.map.grown.length, writer };
}

describe('★ Season 1 survives checkpoint adoption: season, letters, a dormant WORKS and a grown region', () => {
  it('a boot adopts the FINALE checkpoint, replays Season 2’s first ticks, and reaches the live head hash', async () => {
    const run = await live();
    const { runtime } = seated();
    const result = await bootFromStore(runtime, run.store, {
      seed: SEED,
      checkpoint: {
        requiredTables: runtime.engine.stateTables.filter((t) => t.restore !== undefined).map((t) => t.name),
      },
    });
    expect(result.adoptedAtTick, 'the boot must ADOPT the FINALE checkpoint, or this proves nothing about it').toBe(
      CHECKPOINT,
    );
    expect(result.ticksReplayed).toBe(END - CHECKPOINT);
    expect(runtime.engine.stateHash, 'adopt-plus-tail reproduces the live world to the byte').toBe(run.headHash);
    // And the restored world is the one the record describes, book by book.
    expect(runtime.seasons.closedThrough).toBe(1);
    expect(runtime.world.map.grown.length).toBe(run.grown);
    expect(runtime.works.isDormant(SLEEPER, END)).toBe(false);
    expect(
      runtime.parleysVisible(LETTERBOX, runtime.engine.tick).some((e) => e.from === LETTERBOX && e.to === run.writer),
      'the replayed answer found its letter in the adopted book',
    ).toBe(true);
  }, 1_800_000);
});
