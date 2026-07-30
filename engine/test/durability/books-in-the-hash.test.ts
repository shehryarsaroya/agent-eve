/**
 * THE SEVEN BOOKS THAT WERE IN NO STATE TABLE — carried, rolled back, and proven.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `state_hash` hashes exactly the registered state tables, and a snapshot carries
 * exactly those. A book outside them is therefore **neither carried nor missed**:
 * an adopted checkpoint reproduced the genesis hash to the byte while the cast's
 * `electiveHonoured` went `4, 6, 2, 4, …` → all zeros. A wrong boot that passes its
 * own integrity check.
 *
 * This is the third time the shape has appeared. Money was outside the hash; the
 * `EncumbranceBook` was outside it, so no snapshot carried an open lock and escrowed
 * stake was silently spendable; now the permanent record of promises kept and broken.
 *
 * Three claims per book, and the third is the one that matters most:
 *
 *   1. **CARRIED** — capture → wreck the book → restore reproduces it exactly, and
 *      the re-capture is byte-identical (that is `adoptSnapshot`'s own check).
 *   2. **HASHED** — a world whose book differs hashes differently. Without this, a
 *      capture is decoration.
 *   3. **MUTATION-PROVEN** — drop the book from the capture and a test here goes RED.
 *      A capture nobody tests is the defect this file exists to fix, wearing a fix's
 *      clothes. Every mutation below is applied to the engine's own registered table
 *      object, so it is the real capture that is being removed, not a stand-in.
 *
 * Plus the rollback (§15.2, "never publish a broken tick"): an aborted tick must
 * leave no standing change, no seal, no obligation, no event row and no accusation
 * behind — measured on the one tick where all of them move at once, the Reckoning's
 * settlement.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import type { CanonicalValue } from '../../src/core/canonical.js';
import type { EventId, InvariantViolation, PrincipalId, VentureId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { EventLedger } from '../../src/events/index.js';
import { DefaultRegister } from '../../src/invariants/index.js';
import { SimpleObligationBook } from '../../src/ledger/index.js';
import { StandingBook } from '../../src/reckoning/index.js';
import { SealBook } from '../../src/seal/index.js';
import {
  CHECKPOINT_REQUIRED_TABLES,
  missingCheckpointTables,
} from '../../src/persist/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { captureSnapshot, type StateTable } from '../../src/tick/index.js';
import { riskSubjects } from '../../src/risk/index.js';
import {
  FIRST_ANNOUNCE_TICK,
  FIRST_LANDFALL_TICK,
  act,
  fund,
  riskWorld,
  runTo,
  seatsFor,
  stockAt,
  tick as riskTick,
} from '../risk/fixture.js';

/** The same seed the checkpoint-adoption fixture uses, so standing really moves at 287. */
const SEED = 'checkpoint-1';
const CAST = 6;
/** The settlement tick of Reckoning 0. Standing, seals and obligations all move here. */
const SETTLEMENT = 287;

/** The books this file is about, in the order the report names them. */
const BOOKS = ['standing', 'seal', 'obligation', 'event', 'attribution', 'mint', 'delivery'] as const;

/**
 * A seated world and **the cast that seated it**.
 *
 * The cast is returned rather than discarded because it carries per-agent memory, so
 * a second `HeuristicCast` over the same runtime decides differently — and a fixture
 * that quietly produced a different history every time it was rebuilt would make
 * every non-vacuity check below a coin flip.
 */
function seated(seed = SEED): { runtime: Runtime; cast: HeuristicCast } {
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: CAST });
  cast.seat(seed);
  return { runtime, cast };
}

/** Run a seated world to `throughTick`, with its own cast deciding. Never halts. */
function run(world: { runtime: Runtime; cast: HeuristicCast }, throughTick: number, seed = SEED): void {
  const { runtime, cast } = world;
  while (runtime.engine.tick < throughTick) {
    const target = runtime.engine.tick + 1;
    for (const action of cast.decide(target, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    if (report.halted) {
      throw new Error(
        `the fixture halted at ${String(report.tick)}: ` +
          report.violations.map((v) => `${v.id} ${v.message}`).join(' | '),
      );
    }
  }
}

function tableOf(runtime: Runtime, name: string): StateTable {
  const table = runtime.engine.stateTables.find((t) => t.name === name);
  if (table === undefined) throw new Error(`no state table named '${name}'`);
  return table;
}

/**
 * Drop a book from the capture, exactly as an unregistered book looked from here: a
 * constant capture the hash cannot see through, and a restore that puts nothing back.
 *
 * Applied to the engine's own table object, so what is being removed is the real
 * capture rather than a copy of it.
 */
function dropFromCapture(runtime: Runtime, name: string): void {
  const table = tableOf(runtime, name);
  Object.assign(table, {
    capture: (): CanonicalValue => null,
    restore: (): void => undefined,
  });
}

/** Force this tick to abort, through the engine's own assertion hook. */
function abortNextTick(runtime: Runtime): void {
  const engine = runtime.engine as unknown as {
    assertions: ((tick: number) => readonly InvariantViolation[])[];
  };
  engine.assertions.push((tick): readonly InvariantViolation[] => [
    { id: 'INV-1', tick, severity: 'HALT', message: 'injected, to abort this tick on purpose' },
  ]);
}

/** Everything the seven books hold, as one comparable value. */
function bookFacts(runtime: Runtime): Record<string, unknown> {
  return {
    standingRows: runtime.standing.rows(),
    standingChanges: runtime.standing.changes(),
    seals: runtime.seals.auditRecords(),
    sealsResolved: runtime.seals.resolved(),
    obligations: runtime.obligations.capture(),
    events: runtime.events.eventCount,
    audience: runtime.events.audienceRowCount,
    eventWatermark: runtime.events.lastTick,
    attributions: runtime.register.all(),
    // Read through the runtime's own accessor rather than the `delivery` table's
    // capture: a book compared through the very capture a mutation removes would
    // agree with itself under that mutation, which is a comparison that cannot fail.
    deliveries: runtime.ventures
      .all()
      .map((v) => [v.id, runtime.deliveryOf(v.id)] as const)
      .filter(([, record]) => record !== null),
  };
}

// ── 1. CARRIED: capture → wreck → restore reproduces the book ────────────────

describe('every book round-trips through its own capture', () => {
  it('all seven are registered, restorable, and leave no rollback gap', () => {
    const { runtime } = seated();
    const names = runtime.engine.stateTables.map((t) => t.name);
    for (const book of BOOKS) expect(names, `${book} must be a state table`).toContain(book);
    for (const book of BOOKS) {
      expect(typeof tableOf(runtime, book).restore, `${book} must be restorable`).toBe('function');
    }
    // A hash-only table attests to a book without being able to put it back, which is
    // the shape that lets an adoption look verified while dropping the contents.
    expect(runtime.engine.rollbackGaps).toEqual([]);
  }, 30_000);

  it('EVERY restorable table is named in the adoption manifest, not just the seven', () => {
    // `CHECKPOINT_REQUIRED_TABLES` is the gate `planCheckpoint` decides on, and it was
    // hand-maintained: `mint` and `delivery` were missing from it until an equivalence
    // test compared two whole worlds. A verifier then found the next instance already
    // sitting there — `raid` was restorable and unlisted, so a build that lost the raid
    // registration would have adopted a checkpoint and dropped every live demand while
    // the gate reported nothing missing.
    //
    // This closes that direction for good. It cannot see a book in NO table (that is
    // the equivalence test's job), but a book that HAS a table can no longer be absent
    // from the list that decides whether adopting is safe.
    const { runtime } = seated();
    const restorable = runtime.engine.stateTables
      .filter((t) => t.restore !== undefined)
      .map((t) => t.name)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const unlisted = restorable.filter((n) => !CHECKPOINT_REQUIRED_TABLES.includes(n));
    expect(
      unlisted,
      'a restorable state table missing from CHECKPOINT_REQUIRED_TABLES is a book an ' +
        'adoption could drop with the gate reporting nothing missing',
    ).toEqual([]);
    // And the reverse, so the manifest cannot name a book this build does not have:
    // `missingCheckpointTables` would then refuse every adoption forever.
    expect(missingCheckpointTables(runtime.engine.stateTables)).toEqual([]);
    // Non-vacuity: neither set may be empty.
    expect(restorable.length).toBeGreaterThan(BOOKS.length);
  }, 30_000);

  it('a live world captures and restores every book byte-for-byte', () => {
    const world = seated();
    const { runtime } = world;
    run(world, SETTLEMENT);
    // Non-vacuity: every book must actually hold something, or the round-trip proves
    // nothing at all.
    expect(runtime.standing.changes().length).toBeGreaterThan(0);
    expect(runtime.standing.rows().length).toBeGreaterThan(0);
    expect(runtime.seals.size).toBeGreaterThan(0);
    expect(runtime.seals.resolved().length).toBeGreaterThan(0);
    expect(runtime.events.eventCount).toBeGreaterThan(0);

    const before = captureSnapshot(runtime.engine.stateTables, runtime.engine.tick, 0);
    const facts = bookFacts(runtime);

    // Wreck each book by hand — the state a restore has to undo.
    runtime.standing.restore({ rows: [], changes: [] });
    runtime.seals.restore({ watermark: -1, resolved: [], seals: [] });
    runtime.obligations.restore({ live: [], secured: [] });
    runtime.register.restore([]);
    expect(bookFacts(runtime)).not.toEqual(facts);

    // The record cannot be wrecked downwards and put back from four counts, and that
    // refusal is deliberate — so it is asserted here rather than worked around.
    expect(() => tableOf(runtime, 'event').restore?.(before.tables.find(([n]) => n === 'event')?.[1] ?? null))
      .not.toThrow();

    for (const [name, captured] of before.tables) {
      if (name === 'event') continue; // already put back, and it never lost anything
      tableOf(runtime, name).restore?.(captured);
    }
    expect(bookFacts(runtime)).toEqual(facts);
    // `adoptSnapshot`'s own check: the restore reproduced the captured BYTES.
    const after = captureSnapshot(runtime.engine.stateTables, runtime.engine.tick, 0);
    expect(after.stateHash).toBe(before.stateHash);
  }, 120_000);
});

// ── 2. HASHED: a world whose book differs hashes differently ─────────────────

describe('state_hash can see each book', () => {
  const mutate: Record<(typeof BOOKS)[number], (r: Runtime) => void> = {
    standing: (r) => {
      r.standing.restore({ rows: [], changes: [] });
    },
    seal: (r) => {
      r.seals.restore({ watermark: -1, resolved: [], seals: [] });
    },
    obligation: (r) => {
      r.obligations.restore({ live: ['v:fake:0000' as VentureId], secured: [] });
    },
    event: (r) => {
      // Truncating by one row: the smallest difference the record can have.
      r.events.restoreTo({
        events: r.events.eventCount - 1,
        audience: r.events.audienceRowCount,
        ordinals: 0,
        watermark: r.events.lastTick,
      });
    },
    attribution: (r) => {
      r.register.attribute({
        defaultEventId: 'ev:1:0' as EventId,
        promisor: 'p:vex' as PrincipalId,
        obligation: 'v:1:aaaa' as VentureId,
        cause: 'LOSS',
        causeEventId: 'ev:0:0' as EventId,
        tick: 1,
        reckoningIndex: 0,
      });
    },
    mint: (r) => {
      // All three minters, because `mint`'s restore reads all three and `snapInt` refuses an
      // absent key. `dossier` joined at `RULES_VERSION` 23: a re-minted dossier id renames a
      // custody chain, and a chain whose parent no longer resolves is INV-22's *"an attribution
      // we assert rather than prove"* — the same failure the venture half of this table exists to
      // prevent, one book over.
      tableOf(r, 'mint').restore?.({ venture: 999, grant: 999, dossier: 999 });
    },
    delivery: (r) => {
      tableOf(r, 'delivery').restore?.([
        {
          venture: 'v:1:aaaa',
          tick: 1,
          proceeds: 1,
          stateVersion: 0,
          eventId: 'ev:0:0',
          holders: ['p:vex'],
        },
      ]);
    },
  };

  for (const book of BOOKS) {
    it(`a world whose '${book}' differs does not hash the same`, () => {
      const world = seated();
      const { runtime } = world;
      run(world, SETTLEMENT);
      const before = captureSnapshot(runtime.engine.stateTables, runtime.engine.tick, 0);
      mutate[book](runtime);
      const after = captureSnapshot(runtime.engine.stateTables, runtime.engine.tick, 0);
      expect(after.stateHash).not.toBe(before.stateHash);
    }, 120_000);

    it(`MUTATION PROOF: drop '${book}' from the capture and the hash stops seeing it`, () => {
      const world = seated();
      const { runtime } = world;
      run(world, SETTLEMENT);
      // Exactly what an unregistered book looked like: the hash cannot see through it.
      dropFromCapture(runtime, book);
      const before = captureSnapshot(runtime.engine.stateTables, runtime.engine.tick, 0);
      mutate[book](runtime);
      const after = captureSnapshot(runtime.engine.stateTables, runtime.engine.tick, 0);
      // RED without the capture. This is the assertion the previous build satisfied
      // for all seven books at once, which is why the adoption bug was invisible.
      expect(after.stateHash).toBe(before.stateHash);
    }, 120_000);
  }
});

// ── 3. ROLLBACK: an aborted tick leaves nothing behind ───────────────────────

describe('an aborted tick leaves no standing change, no seal, no obligation', () => {
  it('the settlement tick aborts and every book is byte-identical to before it', () => {
    const world = seated();
    const { runtime, cast } = world;
    run(world, SETTLEMENT - 1);

    const before = bookFacts(runtime);
    const beforeHash = runtime.engine.snapshot().stateHash;
    // Non-vacuity, measured on an identical clean run: this tick really does move
    // standing, seals, obligations and the record, so a rollback that did nothing
    // would show rather than pass quietly.
    const cleanWorld = seated();
    run(cleanWorld, SETTLEMENT);
    expect(cleanWorld.runtime.standing.changes().length).toBeGreaterThan(
      runtime.standing.changes().length,
    );
    expect(cleanWorld.runtime.seals.resolved().length).toBeGreaterThan(
      runtime.seals.resolved().length,
    );
    expect(cleanWorld.runtime.events.eventCount).toBeGreaterThan(runtime.events.eventCount);

    abortNextTick(runtime);
    for (const action of cast.decide(runtime.engine.tick + 1, SEED)) runtime.engine.submit(action);
    const report = runtime.runTick();

    expect(report.halted).toBe(true);
    expect(report.rollback).toBe('FULL');
    expect(report.rollbackGaps).toEqual([]);
    // THE CLAIM. No standing moved, no seal was judged, no obligation closed, no row
    // reached the permanent public record, and nobody was accused.
    expect(bookFacts(runtime)).toEqual(before);
    expect(runtime.engine.snapshot().stateHash).toBe(beforeHash);
    expect(runtime.paused).toBe(true);
  }, 180_000);

  it('MUTATION PROOF: drop the books from the capture and the aborted tick keeps them', () => {
    const world = seated();
    const { runtime, cast } = world;
    run(world, SETTLEMENT - 1);
    const before = bookFacts(runtime);
    for (const book of BOOKS) dropFromCapture(runtime, book);

    abortNextTick(runtime);
    for (const action of cast.decide(runtime.engine.tick + 1, SEED)) runtime.engine.submit(action);
    const report = runtime.runTick();
    expect(report.halted).toBe(true);
    // RED without the captures: the tick was rolled back, the world was told nothing
    // happened, and the permanent record of promises kept moved anyway.
    expect(bookFacts(runtime)).not.toEqual(before);
  }, 180_000);

  it('an aborted tick rolls the id minter back', () => {
    // The reason `mint` is a book rather than a counter: a venture's id is hashed from
    // an ordinal, and every escrow account, `terms_hash`, posting and event family
    // carries that id forever. An aborted tick that kept the advanced ordinal makes the
    // re-run mint a DIFFERENT id for the same act — one thing with two names, in a
    // permanent record. This is the same failure the equivalence test found across an
    // adoption, arriving through the rollback instead.
    const cleanWorld = seated();
    run(cleanWorld, 60);
    const mintOf = (r: Runtime): string => JSON.stringify(tableOf(r, 'mint').capture());

    // Walk the clean world forward until a tick actually mints something, so the
    // comparison below is about a tick that moved the counter.
    let target = -1;
    let previous = mintOf(cleanWorld.runtime);
    for (let i = 0; i < 60 && target < 0; i += 1) {
      const before = mintOf(cleanWorld.runtime);
      run(cleanWorld, cleanWorld.runtime.engine.tick + 1);
      if (mintOf(cleanWorld.runtime) !== before) {
        target = cleanWorld.runtime.engine.tick;
        previous = before;
      }
    }
    expect(target, 'the fixture must mint at least one id').toBeGreaterThan(0);
    expect(mintOf(cleanWorld.runtime)).not.toBe(previous);

    // The same world, halted on that exact tick.
    const world = seated();
    const { runtime, cast } = world;
    run(world, target - 1);
    expect(mintOf(runtime)).toBe(previous);
    abortNextTick(runtime);
    for (const action of cast.decide(target, SEED)) runtime.engine.submit(action);
    expect(runtime.runTick().halted).toBe(true);
    // THE CLAIM: the ordinal went back with everything else, so the re-run of this
    // tick mints exactly the ids the clean world minted.
    expect(mintOf(runtime)).toBe(previous);
  }, 180_000);

  it('an aborted tick that recorded a delivery does not keep it', () => {
    // `delivery` is the deed set's only source AND the pinned pot a deferral's second
    // pass divides (§15.3). A record left behind by an aborted tick re-quotes proceeds
    // the settlement never paid — which `guardProgressFitsClaims` halts on, correctly,
    // naming a caller bug that would be this rollback.
    // Non-null records only. Including the nulls would make this string change every
    // time a VENTURE is created, and the venture book rolls back on its own — so the
    // search below would settle on a tick that says nothing about deliveries.
    const deliveriesOf = (r: Runtime): string =>
      JSON.stringify(
        r.ventures
          .all()
          .map((v) => [v.id, r.deliveryOf(v.id)] as const)
          .filter(([, record]) => record !== null),
      );

    const cleanWorld = seated();
    run(cleanWorld, 40);
    let target = -1;
    let previous = deliveriesOf(cleanWorld.runtime);
    for (let i = 0; i < 260 && target < 0; i += 1) {
      const before = deliveriesOf(cleanWorld.runtime);
      run(cleanWorld, cleanWorld.runtime.engine.tick + 1);
      if (deliveriesOf(cleanWorld.runtime) !== before) {
        target = cleanWorld.runtime.engine.tick;
        previous = before;
      }
    }
    expect(target, 'the fixture must record at least one delivery').toBeGreaterThan(0);

    const world = seated();
    const { runtime, cast } = world;
    run(world, target - 1);
    expect(deliveriesOf(runtime)).toBe(previous);
    abortNextTick(runtime);
    for (const action of cast.decide(target, SEED)) runtime.engine.submit(action);
    expect(runtime.runTick().halted).toBe(true);
    expect(deliveriesOf(runtime)).toBe(previous);
  }, 180_000);

  it('an aborted tick drops its queued rows instead of publishing them a tick late', () => {
    const world = seated();
    const { runtime, cast } = world;
    run(world, 40);
    const events = runtime.events.eventCount;

    abortNextTick(runtime);
    for (const action of cast.decide(runtime.engine.tick + 1, SEED)) runtime.engine.submit(action);
    expect(runtime.runTick().halted).toBe(true);
    expect(runtime.events.eventCount).toBe(events);
    // And the queue went with it: a draft carrying the aborted tick's number would be
    // refused by the ledger's watermark on the next flush, one operator fault per row.
    expect(runtime.operatorFaults()).toEqual([]);
  }, 120_000);
});

// ── 4. STRICT PARSING: a capture that cannot be read is a refusal ────────────

describe('a capture that cannot be read is a refusal with a located error', () => {
  it('StandingBook refuses a malformed row rather than coming back empty', () => {
    const book = new StandingBook();
    book.apply({
      tick: 287,
      credits: [
        {
          delta: {
            principal: 'p:a' as PrincipalId,
            counterparty: 'p:b' as PrincipalId,
            venture: 'v:1:aaaa' as VentureId,
            cause: 'ELECTIVE_HONOURED',
            electiveHonoured: 1,
            electiveHonouredValue: minor(10),
            defaults: 0,
            defaultedValue: minor(0),
            actedBy: null,
            boundByGrant: null,
          },
          eventId: 'ev:1:0' as EventId,
        },
      ],
      charges: [],
    });
    const good = book.capture();
    expect(book.rows().length).toBe(1);

    // A float where a count belongs. The book must NOT come back empty: an empty
    // StandingBook is indistinguishable from "nobody has ever kept a promise", which
    // is the A5′ failure this capture exists to prevent.
    expect(() =>
      book.restore({ rows: [{ principal: 'p:a', electiveHonoured: 1.5 }], changes: [] }),
    ).toThrow(/standing\.rows\[0\]\.electiveHonoured/);
    // A vector no cause authorises, smuggled in through the journal.
    expect(() =>
      book.restore({
        rows: [],
        changes: [
          {
            principal: 'p:a',
            tick: 1,
            cause: 'ELECTIVE_HONOURED',
            eventId: 'ev:1:0',
            delta: { lastDefaultTick: 4 },
            counterparty: 'p:b',
          },
        ],
      }),
    ).toThrow(/not a standing vector/);
    expect(() => book.restore({ rows: [], changes: [{ cause: 'BRIBERY' }] })).toThrow(
      /not a standing cause/,
    );
    // And the good one still reads, so the refusals above are not simply "refuses".
    book.restore(good);
    expect(book.rows().length).toBe(1);
    expect(book.capture()).toEqual(good);
  });

  it('StandingBook rebuilds the distinct-counterparty set from the journal, not from a copy', () => {
    const book = new StandingBook();
    const credit = (counterparty: string, tick: number): void => {
      book.apply({
        tick,
        credits: [
          {
            delta: {
              principal: 'p:a' as PrincipalId,
              counterparty: counterparty as PrincipalId,
              venture: `v:${String(tick)}:aaaa` as VentureId,
              cause: 'ELECTIVE_HONOURED',
              electiveHonoured: 1,
              electiveHonouredValue: minor(10),
              defaults: 0,
              defaultedValue: minor(0),
              actedBy: null,
              boundByGrant: null,
            },
            eventId: `ev:${String(tick)}:0` as EventId,
          },
        ],
        charges: [],
      });
    };
    credit('p:b', 287);
    credit('p:c', 575);
    expect(book.row('p:a' as PrincipalId).distinctCounterparties).toBe(2);

    const captured = book.capture();
    const fresh = new StandingBook();
    fresh.restore(captured);
    // The anti-farm term is a count AND a set, and scar #9 is the two disagreeing.
    // A restored book must not credit a counterparty it has already credited.
    credit('p:b', 863);
    fresh.apply({
      tick: 863,
      credits: [
        {
          delta: {
            principal: 'p:a' as PrincipalId,
            counterparty: 'p:b' as PrincipalId,
            venture: 'v:863:aaaa' as VentureId,
            cause: 'ELECTIVE_HONOURED',
            electiveHonoured: 1,
            electiveHonouredValue: minor(10),
            defaults: 0,
            defaultedValue: minor(0),
            actedBy: null,
            boundByGrant: null,
          },
          eventId: 'ev:863:0' as EventId,
        },
      ],
      charges: [],
    });
    expect(fresh.row('p:a' as PrincipalId).distinctCounterparties).toBe(2);
    expect(fresh.capture()).toEqual(book.capture());
  });

  it('SealBook refuses a seal judged twice, and a torn verdict row', () => {
    const book = new SealBook();
    expect(() =>
      book.restore({
        watermark: 0,
        resolved: [],
        seals: [sealRow({ evaluations: 2, disposition: 'HONOURED', verdict: 'HONOURED' })],
      }),
    ).toThrow(/every seal is judged once/);
    expect(() =>
      book.restore({ watermark: 0, resolved: [], seals: [sealRow({ evaluations: 1 })] }),
    ).toThrow(/does not match 1 evaluation/);
    expect(() =>
      book.restore({
        watermark: 0,
        resolved: [],
        seals: [sealRow({ intent: { verb: 'haul', target: 't', measure: 'FURLONGS', outcomeLow: 0, outcomeHigh: 1 } })],
      }),
    ).toThrow(/not a seal measure/);
  });

  it('SealBook carries a Reckoning that resolved with no seals in it', () => {
    // The one field that cannot be derived from the records: a Reckoning with nothing
    // in it still resolves, and rebuilding the set from the rows would make it
    // resolvable a second time — scar #7 arriving through the restore path.
    const book = new SealBook();
    const captured = { watermark: 0, resolved: [3], seals: [] };
    book.restore(captured);
    expect(book.isResolved(3)).toBe(true);
    expect(book.capture()).toEqual(captured);
  });

  it('the EventLedger refuses to grow, and truncates exactly', () => {
    const ledger = new EventLedger();
    const append = (tick: number): EventId =>
      ledger.append({
        tick,
        kind: 'test.row',
        rulesVersion: 1,
        actorPrincipalId: null,
        onBehalfOfPrincipalId: null,
        grantId: null,
        eventFamilyId: `fam:${String(tick)}`,
        parentEventId: null,
        isPublic: true,
        publicAt: tick,
        declassifyAt: tick,
        provenanceClass: 'FACT',
        actedOnStateVersion: 0,
        decisionSource: 'HEURISTIC',
        payload: {},
        visibility: 'PUBLIC',
        audience: [],
      }).event.id;

    append(1);
    const mark = ledger.capture();
    const second = append(2);
    expect(ledger.eventCount).toBe(2);

    ledger.restoreTo(mark as never);
    expect(ledger.eventCount).toBe(1);
    expect(ledger.get(second)).toBeNull();
    expect(ledger.ticks()).toEqual([1]);
    expect(ledger.lastTick).toBe(1);
    // The reveal streams truncated with it, so a feed cannot serve a row the record
    // no longer holds.
    expect(
      ledger.spectatorFeed({ atTick: 5, after: null, limit: 10 }).views.map((v) => v.event.tick),
    ).toEqual([1]);
    // And the seq counter went back, so the next append at tick 2 mints the same id.
    expect(append(2)).toBe(second);

    // A snapshot carries counts, not contents. Growing is refused, loudly.
    expect(() => ledger.restoreTo({ events: 99, audience: 0, ordinals: 99, watermark: 2 })).toThrow(
      /must be rebuilt from the durable journal/,
    );
  });

  it('the obligation book refuses a secured obligation that is not live', () => {
    const book = new SimpleObligationBook();
    expect(() => book.restore({ live: [], secured: ['v:1:aaaa' as VentureId] })).toThrow(
      /secured but not as live/,
    );
    book.open('v:1:aaaa' as VentureId, true);
    const captured = book.capture();
    const fresh = new SimpleObligationBook();
    fresh.restore({ live: ['v:1:aaaa' as VentureId], secured: ['v:1:aaaa' as VentureId] });
    // Both sets, not just the headline one: `secured` is not derivable from `live`.
    expect(fresh.capture()).toEqual(captured);
    expect(fresh.securedObligations()).toEqual(['v:1:aaaa']);
  });

  it('the attribution register rebuilds through its own door, so a bad row cannot get in', () => {
    const register = new DefaultRegister();
    register.attribute({
      defaultEventId: 'ev:2:0' as EventId,
      promisor: 'p:a' as PrincipalId,
      obligation: 'v:1:aaaa' as VentureId,
      cause: 'MISSED_DELIVERY',
      causeEventId: 'ev:1:0' as EventId,
      tick: 2,
      reckoningIndex: 0,
    });
    const captured = register.capture();

    const fresh = new DefaultRegister();
    fresh.restore(captured);
    expect(fresh.all()).toEqual(register.all());
    expect(fresh.capture()).toEqual(captured);

    // The door's refusals apply to the restore, because the restore IS the door.
    expect(() =>
      fresh.restore([
        { defaultEventId: 'ev:2:0', promisor: 'p:a', obligation: 'v:1:aaaa', cause: 'LOSS', causeEventId: 'ev:2:0', tick: 2, reckoningIndex: 0 },
      ]),
    ).toThrow(/cites itself as its cause/);
    expect(() =>
      fresh.restore([
        { defaultEventId: 'ev:2:0', promisor: 'p:a', obligation: 'v:1:aaaa', cause: 'WEATHER', causeEventId: 'ev:1:0', tick: 2, reckoningIndex: 0 },
      ]),
    ).toThrow(/not one of the three causes/);
    expect(() => fresh.restore('not an array')).toThrow(/expected an array/);
  });
});

function sealRow(over: Record<string, CanonicalValue> = {}): CanonicalValue {
  return {
    id: 'seal:p:a:0:0000',
    principal: 'p:a',
    reckoningIndex: 0,
    sealedAtTick: 5,
    actedOnStateVersion: 0,
    role: null,
    intent: { verb: 'haul', target: 'sys-01', measure: 'QTY', outcomeLow: 1, outcomeHigh: 2 },
    prose: '',
    targetWitnessed: true,
    disposition: null,
    verdict: null,
    verdictAtTick: null,
    basis: null,
    citedDeedEventId: null,
    evaluations: 0,
    ...over,
  };
}

// ── 5. ★ THE `risk` TABLE, OVER A FIXTURE THAT ACTUALLY HOLDS A COVER ────────

/**
 * ★★ **THE GENERIC ROUND TRIP ABOVE COVERS `risk`, AND IT PASSED OVER AN EMPTY TABLE.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * `for (const [name, captured] of before.tables) tableOf(runtime, name).restore?.(captured)` restores
 * every registered table, `risk` included — and it was green while `RiskBook.restore` **could not put a
 * single COVER back**:
 *
 * ```
 * risk.covers[0].offerExpiresTick: expected a safe integer
 * ```
 *
 * `restore` read the key through a bare `readInt` and `capture` never wrote it. The fixture above stops
 * at tick **287** — before the first FRONT is even announced (tick 504), with a heuristic cast that has
 * no earned capital and therefore cannot write cover at all — so the table it round-tripped was `{fronts:
 * [], covers: [], indemnities: [], records: []}`. **A round trip over an empty table is this file's own
 * subject arriving one level up:** the guard exists, it is registered, it is in the manifest, and its
 * subject cannot occur.
 *
 * This block builds the subject. It runs its own world to the announcement tick, writes and binds a real
 * COVER through the real verbs, and then round-trips `risk` through the **registered** `StateTable` —
 * the adoption path itself. It is a separate `describe` rather than an extension of the fixture above
 * because reaching tick 504 with a cast that can pay for cover is a different world, and the note in
 * `seated()` is right that a fixture producing a different history each time makes every non-vacuity
 * check a coin flip.
 * ══════════════════════════════════════════════════════════════════════════════
 */
describe('★ the `risk` table round-trips a world that HOLDS a cover', () => {
  function withCover(): Runtime {
    const world = riskWorld('books-risk', 5, 'MARCHES');
    const { runtime } = world;
    const [holder, payer, bankA, bankB] = seatsFor(world, 0, 1, 2, 3);
    fund(runtime, bankA, payer, 200_000);
    fund(runtime, bankB, holder, 200_000);
    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('the fixture needs an announced FRONT');
    const cell = [...front.swath].sort((a, b) => b.intensityBps - a.intensityBps)[0];
    if (cell === undefined) throw new Error('the fixture needs a struck cell');
    stockAt(runtime, holder, cell.system, 400_000);
    const offered = act(runtime, payer, 'publish_offer', {
      kind: 'COVER',
      system: cell.system,
      good: 'ration',
      limit: 60_000,
      premium: 1_000,
      elective_bps: 7_500,
    });
    expect(offered, `publish_offer refused: ${offered?.hint ?? ''}`).toBeNull();
    const cover = runtime.risk.coversBy(payer)[0];
    if (cover === undefined) throw new Error('the offer is not in the book');
    const signed = act(runtime, holder, 'sign', { cover: cover.id, terms_hash: cover.termsHash ?? '' });
    expect(signed, `sign refused: ${signed?.hint ?? ''}`).toBeNull();
    // A landfall too, so the table also carries an INDEMNITY with §15.4's two landfall captures on it.
    runTo(runtime, FIRST_LANDFALL_TICK);
    riskTick(runtime);
    return runtime;
  }

  it('is not vacuous: `risk` is REQUIRED, registered, and non-empty', () => {
    const runtime = withCover();
    expect(CHECKPOINT_REQUIRED_TABLES, 'a checkpoint may not omit it').toContain('risk');
    expect(runtime.engine.stateTables.map((t) => t.name), 'and it is registered').toContain('risk');
    const subjects = riskSubjects(runtime.risk);
    // ★ THE DENOMINATOR THE OLD FIXTURE DID NOT HAVE. Every one of these was 0 at tick 287.
    expect(subjects.covers, 'a cover').toBeGreaterThan(0);
    expect(subjects.boundCovers, 'bound, so every nullable field is populated').toBeGreaterThan(0);
    expect(subjects.indemnities, 'and an INDEMNITY off a real strike').toBeGreaterThan(0);
    expect(subjects.struckFronts, 'off a front that landed').toBeGreaterThan(0);
  });

  it('★★ capture → restore reproduces the BYTES, with a cover in the table', () => {
    const runtime = withCover();
    const before = captureSnapshot(runtime.engine.stateTables, runtime.engine.tick, 0);
    const captured = before.tables.find(([n]) => n === 'risk')?.[1] ?? null;
    expect(captured, 'the snapshot carries `risk`').not.toBeNull();

    // MUTATION: delete `offerExpiresTick` from `RiskBook.capture()` and this throws with the exact
    // message a production boot printed. That is the whole defect, and this is the assertion that would
    // have caught it before the deploy rather than after.
    expect(() => tableOf(runtime, 'risk').restore?.(captured), 'the restore does not throw').not.toThrow();
    expect(riskSubjects(runtime.risk).covers, 'and the cover survived the swap').toBeGreaterThan(0);

    const after = captureSnapshot(runtime.engine.stateTables, runtime.engine.tick, 0);
    // `adoptSnapshot`'s own check. A field missing from `capture` is a field outside `state_hash`, so
    // this equality is also what makes the hash able to see the offer clock at all (§15.5).
    expect(after.stateHash, 'byte for byte').toBe(before.stateHash);
  });

  it('★ `state_hash` can SEE the offer clock — it could not, because it was not captured', () => {
    const runtime = withCover();
    const before = captureSnapshot(runtime.engine.stateTables, runtime.engine.tick, 0);
    const cover = runtime.risk.allCovers()[0];
    if (cover === undefined) throw new Error('unreachable');
    // Move only the field that used to be invisible. Two replicas differing in nothing else must not
    // agree — *"a hash that cannot see a field cannot detect a divergence in it."*
    (cover as { offerExpiresTick: number }).offerExpiresTick = cover.offerExpiresTick + 1;
    const after = captureSnapshot(runtime.engine.stateTables, runtime.engine.tick, 0);
    // MUTATION: remove `offerExpiresTick` from `capture()` and these two hashes become equal.
    expect(after.stateHash, 'the hash moved with it').not.toBe(before.stateHash);
  });
});
