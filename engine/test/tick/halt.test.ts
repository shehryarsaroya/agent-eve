/**
 * Aborting a tick: publish nothing, put the world back, and hand the operator the
 * immutable triple.
 *
 * SPEC §15.2. The half of E2E-30/E2E-31 that belongs to the pipeline — the PAUSED
 * *surface* (stale observe, 503 with a reason, "Reckoning delayed", the bounded
 * queue, the signed resume) is `src/invariants/halt.ts`'s and is tested there. What
 * is asserted here is the thing only the tick loop can promise: **the world is back
 * at `snapshot_T` afterwards, and nothing from the failed tick was published.**
 */

import { describe, it, expect } from 'vitest';
import type { InvariantViolation } from '../../src/core/types.js';
import type { NewEvent } from '../../src/events/index.js';
import { generateKeypair } from '../../src/identity/index.js';
import { HaltController, signResume } from '../../src/invariants/halt.js';
import { Engine, EngineError, hashOnlyTable } from '../../src/tick/index.js';
import { PROBE_VERB, moveEveryone, probeVerbs, seatWorld, submission } from './harness.js';

function halt(id: string, tick: number, message: string): InvariantViolation {
  return { id, message, tick, severity: 'HALT' };
}

/** A minimal event, shaped for the events module. Kinds are the caller's to name. */
function testEvent(tick: number): NewEvent {
  return {
    tick,
    kind: 'TEST_ONLY',
    rulesVersion: 1,
    actorPrincipalId: null,
    onBehalfOfPrincipalId: null,
    grantId: null,
    eventFamilyId: `fam-${String(tick)}`,
    parentEventId: null,
    isPublic: true,
    publicAt: tick,
    declassifyAt: null,
    provenanceClass: 'FACT',
    actedOnStateVersion: null,
    decisionSource: null,
    payload: {},
    visibility: 'PUBLIC',
    audience: [],
  };
}

describe('a failed ASSERT aborts the tick and publishes nothing', () => {
  it('rolls the world back to snapshot_T and leaves the published hash untouched', () => {
    const { world, principals } = seatWorld(4);
    let breakIt = false;
    const engine = new Engine({
      world,
      seed: 'halt-rollback',
      assertions: [(tick) => (breakIt ? [halt('INV-9', tick, 'a hand is in two places')] : [])],
    });

    // A clean tick first, so the snapshot being restored is not the pristine one.
    for (const move of moveEveryone(world, principals)) engine.submit(move);
    const good = engine.runTick();
    expect(good.halted).toBe(false);
    const goodHash = good.stateHash;
    const goodSnapshot = engine.snapshot();
    const handPrint = (): string[] =>
      [...world.hands.values()]
        .map((h) => `${h.id}:${h.state}:${h.location}:${String(h.freeAtTick)}`)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const handsBefore = handPrint();

    // Now a tick that mutates state and then fails its assertions.
    breakIt = true;
    for (const move of moveEveryone(world, principals)) engine.submit(move);
    const bad = engine.runTick();

    expect(bad.halted).toBe(true);
    expect(engine.status).toBe('PAUSED');
    // Nothing published: the report carries no hash, and the engine's own published
    // hash is still the last good one.
    expect(bad.stateHash).toBe('');
    expect(engine.stateHash).toBe(goodHash);
    expect(engine.tick).toBe(good.tick);
    expect(engine.snapshot().stateHash).toBe(goodSnapshot.stateHash);

    // And the world itself is back — this is the claim the controller cannot make.
    expect(handPrint()).toEqual(handsBefore);
    expect(bad.rollback).toBe('FULL');
    expect(bad.rollbackGaps).toEqual([]);
  });

  it('discards the tick’s buffered events rather than retracting them', () => {
    // INV-16 makes retraction impossible by design, so buffering until COMMIT is the
    // only correct design: an aborted tick's events must never have existed.
    const { world } = seatWorld(2);
    const committed: NewEvent[] = [];
    let breakIt = false;
    const engine = new Engine({
      world,
      seed: 'halt-events',
      events: (events) => committed.push(...events),
      handlers: { VENTURES: (ctx) => ctx.emit(testEvent(ctx.tick)) },
      assertions: [(tick) => (breakIt ? [halt('INV-1', tick, 'postings do not sum to zero')] : [])],
    });

    const good = engine.runTick();
    expect(good.eventsCommitted).toBe(1);
    expect(committed.length).toBe(1);

    breakIt = true;
    const bad = engine.runTick();
    expect(bad.halted).toBe(true);
    expect(bad.eventsCommitted).toBe(0);
    // The sink never saw the aborted tick's event.
    expect(committed.length).toBe(1);
  });

  it('records the halt with the operator’s whole input triple', () => {
    const { world, principals } = seatWorld(2);
    const engine = new Engine({ world, seed: 'halt-triple', verbs: probeVerbs() });
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');

    const breaking = new Engine({
      world: seatWorld(2).world,
      seed: 'halt-triple',
      verbs: probeVerbs(),
      assertions: [(tick) => [halt('INV-17', tick, 'a default with no attributable cause')]],
    });
    expect(breaking.submit(submission({ principal, verb: PROBE_VERB })).ok).toBe(true);
    const bad = breaking.runTick();
    expect(bad.halted).toBe(true);

    const record = breaking.controller.haltRecord;
    expect(record).not.toBeNull();
    expect(record?.tick).toBe(bad.tick);
    // INV-17 is top severity: a default with no cause is the game accusing an
    // innocent agent, so it must lead the operator's reason line.
    expect(record?.topId).toBe('INV-17');
    // The triple: snapshot, action log, seed — and its identity, so a resume order
    // cannot quietly name different inputs.
    expect(record?.inputs.tick).toBe(bad.tick);
    expect(record?.inputs.seed).toBe(bad.seedRevealed);
    expect(record?.inputs.actionLog.length).toBe(1);
    expect(record?.inputsHash).toMatch(/^[0-9a-f]{64}$/);
    // Nothing about the healthy engine changed.
    expect(engine.status).toBe('RUNNING');
  });

  it('refuses to run again while PAUSED rather than spinning quietly', () => {
    // Scar #14b / `TESTING.md` §0's "verify the invisible": a scheduler that keeps
    // calling into a halted world and gets no error presents as a healthy system
    // that has silently stopped advancing.
    const { world } = seatWorld(1);
    const engine = new Engine({
      world,
      seed: 'halt-again',
      assertions: [(tick) => [halt('INV-2', tick, 'supply does not conserve')]],
    });
    expect(engine.runTick().halted).toBe(true);
    expect(() => engine.runTick()).toThrow(EngineError);
    expect(() => engine.runTick()).toThrow(/PAUSED/);
  });

  it('still accepts submissions while PAUSED, bounded, rather than losing them', () => {
    // §15.2: "Submissions queue (bounded, with a published cap) rather than being
    // lost."
    const { world, principals } = seatWorld(1);
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');
    const engine = new Engine({
      world,
      seed: 'halt-queue',
      verbs: probeVerbs(),
      assertions: [(tick) => [halt('INV-3', tick, 'a negative balance')]],
    });
    expect(engine.runTick().halted).toBe(true);
    const queued = engine.submit(submission({ principal, verb: PROBE_VERB, clientSequence: 1 }));
    // Not applied — no tick is resolving — but not lost either: it is held in the
    // controller's bounded queue, and the hint says so with the depth and the cap.
    expect(queued.ok).toBe(false);
    if (!queued.ok) {
      expect(queued.invariant).toBe('PAUSED');
      expect(queued.hint).toMatch(/queued at position 0/);
      expect(queued.hint).toContain(String(engine.controller.queueBound));
    }
    expect(engine.controller.queueDepth).toBe(1);
    // The tick's own window stays frozen holding the failed tick's actions, because
    // the resume has to re-run them byte for byte.
    expect(engine.queue.depth).toBe(0);
  });

  it('a module that throws out of a phase aborts the tick instead of publishing it', () => {
    // A module is supposed to return violations, not throw. When it throws anyway,
    // the answer is still "never publish a tick nobody checked".
    const { world } = seatWorld(2);
    const engine = new Engine({
      world,
      seed: 'halt-throw',
      handlers: {
        PRODUCE: () => {
          throw new Error('a module lost its nerve');
        },
      },
    });
    const report = engine.runTick();
    expect(report.halted).toBe(true);
    expect(report.violations.map((v) => v.id)).toContain('TICK-STAGE');
    expect(report.violations[0]?.message).toMatch(/PRODUCE/);
    expect(engine.status).toBe('PAUSED');
  });

  it('a WARN-only violation does not halt the tick', () => {
    // The design chose not to stop for a WARN, and halting on one would make an
    // outage out of something deliberately tolerated.
    const { world } = seatWorld(2);
    const engine = new Engine({
      world,
      seed: 'halt-warn',
      assertions: [(tick) => [{ id: 'INV-25', message: 'a docket row is thin', tick, severity: 'WARN' }]],
    });
    const report = engine.runTick();
    expect(report.halted).toBe(false);
    expect(report.violations.length).toBe(1);
    expect(report.stateHash).not.toBe('');
    expect(engine.status).toBe('RUNNING');
  });

  it('names the tables it cannot roll back, instead of claiming a clean abort', () => {
    // Wave 1's `Ledger` exposes `stateHash()` and no restore, so a world that
    // registers it cannot be put back in process. Saying so is the point: §15.3
    // calls a partially committed batch unrecoverable by construction.
    const { world } = seatWorld(2);
    let ledgerHash = 'aaaa';
    const engine = new Engine({
      world,
      seed: 'halt-gap',
      tables: [hashOnlyTable('value', () => ledgerHash)],
      handlers: {
        VENTURES: () => {
          ledgerHash = 'bbbb';
        },
      },
      assertions: [(tick) => [halt('INV-1', tick, 'postings do not sum to zero')]],
    });
    expect(engine.rollbackGaps).toEqual(['value']);
    const report = engine.runTick();
    expect(report.halted).toBe(true);
    expect(report.rollback).toBe('INCOMPLETE');
    expect(report.rollbackGaps).toEqual(['value']);
    // The world half *was* restored, which is strictly better than leaving it half
    // at T and half at T+1.
    expect(engine.stateHash).not.toBe('');
  });

  it('reports which invariants did not run, so an empty violation list is not read as clean', () => {
    // The invariants module's own instruction: "Read `report.skipped` before
    // believing `report.violations` is empty." Six invariants read state no module
    // writes yet.
    const { world } = seatWorld(2);
    const engine = new Engine({ world, seed: 'halt-skips' });
    const report = engine.runTick();
    expect(report.halted).toBe(false);
    expect(report.skipped.length).toBeGreaterThan(0);
    // Presence is supplied by the tick loop itself, so those three always run.
    expect(report.skipped).not.toContain('INV-8');
    expect(report.skipped).not.toContain('INV-10');
  });

  it('requireAllInvariants turns every skip into a halt, for the day the modules exist', () => {
    // Off by default and stated as a gap, because turning it on now would halt the
    // first tick of every fixture. On, it does exactly what the invariants module
    // says it should.
    const { world } = seatWorld(2);
    const strict = new Engine({ world, seed: 'halt-strict', requireAllInvariants: true });
    const report = strict.runTick();
    expect(report.halted).toBe(true);
    expect(strict.status).toBe('PAUSED');
  });
});

describe('resume — the re-run produces the world every observer was promised (E2E-31)', () => {
  it('re-runs the failed tick from its immutable triple once the defect is fixed', () => {
    // The tick loop's half of E2E-31. The signature check, the single-use rule and
    // the "fails again stays paused" rule are the controller's and are tested there;
    // what is asserted here is that the *re-run* is deterministic and lands on a
    // published hash.
    const keypair = generateKeypair();
    const controller = new HaltController({
      startTick: -1,
      startStateHash: '',
      resumeKeys: new Map([[keypair.keyid, keypair.record.publicKeyJwk]]),
    });

    const { world, principals } = seatWorld(3);
    let defect = true;
    const engine = new Engine({
      world,
      seed: 'resume',
      controller,
      assertions: [(tick) => (defect ? [halt('INV-9', tick, 'the defect')] : [])],
    });

    for (const move of moveEveryone(world, principals)) engine.submit(move);
    const bad = engine.runTick();
    expect(bad.halted).toBe(true);
    const record = controller.haltRecord;
    if (record === null) throw new Error('the halt was not recorded');

    // A reference run of the same tick with the defect absent, so the promised hash
    // is known independently of the resume path.
    const reference = (() => {
      const fresh = seatWorld(3);
      const e = new Engine({ world: fresh.world, seed: 'resume' });
      for (const move of moveEveryone(fresh.world, fresh.principals)) e.submit(move);
      return e.runTick().stateHash;
    })();

    // The operator fixes the defect and signs an order naming this tick and this
    // triple. An order with no stated fix, or for a different triple, is refused by
    // the controller — that is its test, not this one.
    defect = false;
    const order = signResume(
      {
        tick: record.tick,
        tripleHash: record.inputsHash,
        keyid: keypair.keyid,
        note: 'the defect was a bad assertion; corrected',
      },
      (bytes) => keypair.sign(bytes),
    );
    const { outcome, report } = engine.resume(order);

    expect(outcome.ok, outcome.reason).toBe(true);
    expect(engine.status).toBe('RUNNING');
    expect(report?.halted).toBe(false);
    expect(report?.tick).toBe(bad.tick);
    // The world every observer was promised: the same hash a clean run would have
    // produced from the same inputs.
    expect(report?.stateHash).toBe(reference);
    expect(engine.stateHash).toBe(reference);
    expect(controller.publishedStateHash).toBe(reference);
    expect(controller.publishedTick).toBe(bad.tick);
  });

  it('a still-broken re-run leaves the world PAUSED', () => {
    const keypair = generateKeypair();
    const controller = new HaltController({
      startTick: -1,
      startStateHash: '',
      resumeKeys: new Map([[keypair.keyid, keypair.record.publicKeyJwk]]),
    });
    const { world } = seatWorld(2);
    const engine = new Engine({
      world,
      seed: 'resume-broken',
      controller,
      verbs: probeVerbs(),
      assertions: [(tick) => [halt('INV-1', tick, 'still broken')]],
    });
    const bad = engine.runTick();
    const record = controller.haltRecord;
    if (record === null) throw new Error('the halt was not recorded');

    const order = signResume(
      { tick: record.tick, tripleHash: record.inputsHash, keyid: keypair.keyid, note: 'guessed' },
      (bytes) => keypair.sign(bytes),
    );
    const { outcome, report } = engine.resume(order);
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe('PAUSED');
    expect(report?.halted).toBe(true);
    expect(engine.status).toBe('PAUSED');
    expect(controller.publishedTick).toBeLessThan(bad.tick);
  });
});
