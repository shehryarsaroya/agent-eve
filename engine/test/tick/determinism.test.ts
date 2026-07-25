/**
 * DET-1 and DET-2 — the gating pair.
 *
 * `TESTING.md` §18 lists DET-2 among the ten tests that would exist if only ten
 * could: "**100 arrival orders, one hash.** A4 structurally, before any content."
 * SPEC §16 step 4 says the same thing from the build side. Everything downstream
 * rests on these: if the ledger cannot be reproduced, nothing it records can be
 * trusted, and the product *is* the record.
 */

import { describe, it, expect } from 'vitest';
import { captureSnapshot, compareOrderKey, PRIORITY, type OrderKey } from '../../src/tick/index.js';
import {
  PROBE_VERB,
  countingVerb,
  fixture,
  moveEveryone,
  permute,
  seatWorld,
  submission,
} from './harness.js';
import { Engine } from '../../src/tick/index.js';
import type { PrincipalId } from '../../src/core/types.js';

const PERMUTATIONS = 100;
const PRINCIPALS = 6;

describe('DET-2 — 100 arrival orders yield one state_hash', () => {
  it('is a live action set, not a set of refusals — otherwise the assertion is vacuous', () => {
    const f = fixture({ principals: PRINCIPALS });
    const actions = moveEveryone(f.world, f.principals);
    expect(actions.length).toBe(PRINCIPALS);
    for (const action of actions) {
      const accepted = f.engine.submit(action);
      expect(accepted.ok, accepted.ok ? '' : `${accepted.invariant}: ${accepted.hint}`).toBe(true);
    }
    const report = f.engine.runTick();
    // Every action applied and the world actually moved: the hash below is a hash
    // of something.
    expect(report.applied).toBe(PRINCIPALS);
    expect(report.refused).toBe(0);
    expect(report.stateHash).not.toBe('');
    const untouched = fixture({ principals: PRINCIPALS });
    expect(report.stateHash).not.toBe(untouched.engine.stateHash);
  });

  it('the same action set in 100 different arrival orders produces an identical hash', () => {
    const hashes = new Set<string>();
    const logs: number[][] = [];

    for (let run = 0; run < PERMUTATIONS; run += 1) {
      const f = fixture({ principals: PRINCIPALS });
      const base = moveEveryone(f.world, f.principals);
      // A seeded permutation per run, so a failure is reproducible from the run
      // index alone. Run 0 is the identity order.
      const ordered = run === 0 ? base : permute(base, `arrival:${String(run)}`);
      for (const action of ordered) {
        const accepted = f.engine.submit(action);
        expect(accepted.ok).toBe(true);
      }
      const report = f.engine.runTick();
      hashes.add(report.stateHash);
      logs.push(f.engine.log.forTick(report.tick).map((a) => a.arrivalOrdinal ?? -1));
    }

    expect(hashes.size, `${String(hashes.size)} distinct hashes across ${String(PERMUTATIONS)} arrival orders`).toBe(1);

    // And the permutations were real: at least one run resolved in an order that
    // disagrees with arrival. Without this the test could pass because the shuffle
    // never shuffled.
    const disordered = logs.filter((ordinals) =>
      ordinals.some((v, i) => i > 0 && v < (ordinals[i - 1] ?? -1)),
    );
    expect(disordered.length).toBeGreaterThan(0);
  });

  it('records arrival for the A4 audit and never orders by it', () => {
    const f = fixture({ principals: PRINCIPALS });
    const base = moveEveryone(f.world, f.principals);
    for (const action of permute(base, 'arrival:audit')) {
      expect(f.engine.submit(action).ok).toBe(true);
    }
    const report = f.engine.runTick();

    // The structural claim: resolution order is exactly the order key's order.
    expect(report.arrivalAudit.orderKeyExplainsResolution).toBe(true);
    expect(report.arrivalAudit.submitted).toBe(PRINCIPALS);

    // The evidence claim: arrival is on the log, so the audit can see it.
    const logged = f.engine.log.forTick(report.tick);
    expect(logged.every((a) => a.arrivalMs !== null)).toBe(true);
    // And resolution order really is by principal id here, not by arrival.
    const resolved = logged.map((a) => a.principal);
    expect([...resolved]).toEqual([...resolved].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('the comparator is handed a type with no arrival field at all', () => {
    // The strongest available form of "arrival is never an ordering key": a
    // comparator cannot read what it was never given. This test documents the
    // shape; the compiler enforces it.
    const key: OrderKey = { priority: PRIORITY.ORDINARY, principal: 'p-001' as PrincipalId, clientSequence: 0 };
    expect(Object.keys(key).sort((a, b) => (a < b ? -1 : 1))).toEqual([
      'clientSequence',
      'principal',
      'priority',
    ]);
    // Priority dominates, then principal, then sequence — in that order.
    const later: OrderKey = { ...key, priority: PRIORITY.CONTEST };
    expect(compareOrderKey(key, later)).toBeLessThan(0);
    expect(compareOrderKey(key, { ...key, principal: 'p-002' as PrincipalId })).toBeLessThan(0);
    expect(compareOrderKey(key, { ...key, clientSequence: 1 })).toBeLessThan(0);
  });
});

describe('DET-1 — same seed, same action log, byte-identical hash per tick', () => {
  function run(seed: string, ticks: number): { hashes: string[]; calls: number } {
    const counter = countingVerb();
    const { world, principals } = seatWorld(4);
    const engine = new Engine({ world, seed, verbs: { [PROBE_VERB]: counter.verb } });
    const hashes: string[] = [];
    for (let t = 0; t < ticks; t += 1) {
      for (const [i, principal] of principals.entries()) {
        // Two kinds of action per tick: one that moves the world and one that does
        // not, so the hash sequence exercises both.
        const move = moveEveryone(world, [principal])[0];
        if (move !== undefined) engine.submit(move);
        engine.submit(submission({ principal, verb: PROBE_VERB, clientSequence: 1 + i, params: { n: t } }));
      }
      hashes.push(engine.runTick().stateHash);
    }
    return { hashes, calls: counter.calls() };
  }

  it('two runs of the same seed and log produce identical per-tick hashes', () => {
    const a = run('det1-seed', 12);
    const b = run('det1-seed', 12);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.calls).toBe(b.calls);
    // The stub verb really ran. Without this the whole suite passes while every
    // action is refused by the Commons floor — which is exactly what the first
    // draft of this file did.
    expect(a.calls).toBe(12 * 4);
    // The world advanced: a run whose every hash is the same is a run that did
    // nothing, and would pass the equality above trivially.
    expect(new Set(a.hashes).size).toBeGreaterThan(1);
  });

  it('a different seed does not change the hashes here, because nothing drew — and that is the point', () => {
    // Stated rather than assumed: no phase in this build draws from the Rng, so the
    // seed cannot yet move an outcome. The commitment discipline is still enforced
    // (DET-6). When PREDATE or HAZARD lands, this expectation *should* flip, and it
    // is written as an equality so it fails loudly on that day rather than silently
    // continuing to pass.
    const a = run('det1-seed-a', 6);
    const b = run('det1-seed-b', 6);
    expect(a.hashes).toEqual(b.hashes);
  });

  it('the hash exists at tick boundaries only — there is none on a phase', () => {
    // §15.1: "drop per-event state hashing; hash at tick boundaries only."
    const f = fixture({ principals: 2 });
    const report = f.engine.runTick();
    expect(typeof report.stateHash).toBe('string');
    for (const trace of report.phases) {
      expect(Object.keys(trace).sort((x, y) => (x < y ? -1 : 1))).toEqual(['phase', 'steps', 'unbuilt']);
    }
  });
});

describe('nothing written after DERIVE is inside the hash it claims to be in', () => {
  it('the tables’ hash at the end of a tick equals the hash DERIVE published', () => {
    // The pipeline order forces this: DERIVE computes the hash, ASSERT checks what
    // DERIVE hashed, and COMMIT and WAKE run afterwards. So a state table written in
    // COMMIT or WAKE would be *outside* the hash and outside the snapshot, and the
    // snapshot would look complete while missing the last phase's writes.
    //
    // This caught a real one: the wake book was registered as a state table while
    // being written in WAKE.
    const { world, principals } = seatWorld(4);
    const engine = new Engine({ world, seed: 'post-derive' });
    for (let t = 0; t < 4; t += 1) {
      for (const move of moveEveryone(world, principals)) engine.submit(move);
      const report = engine.runTick();
      expect(report.halted).toBe(false);
      const after = captureSnapshot(engine.stateTables, report.tick, report.stateVersion);
      expect(after.stateHash).toBe(report.stateHash);
      expect(engine.snapshot().stateHash).toBe(report.stateHash);
    }
  });

  it('a handler that writes a hashed table in COMMIT or WAKE is caught by that equality', () => {
    // The mutation test for the assertion above, so it cannot rot into a tautology.
    const { world } = seatWorld(2);
    let sneaky = 'a';
    const engine = new Engine({
      world,
      seed: 'post-derive-mutant',
      tables: [
        {
          name: 'sneaky',
          capture: () => ({ v: sneaky }),
          restore: () => {
            sneaky = 'a';
          },
        },
      ],
      handlers: {
        WAKE: () => {
          sneaky = 'b';
        },
      },
    });
    const report = engine.runTick();
    const after = captureSnapshot(engine.stateTables, report.tick, report.stateVersion);
    expect(after.stateHash).not.toBe(report.stateHash);
  });
});
