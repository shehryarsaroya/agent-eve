/**
 * E2E-30 and E2E-31 — the halt surface, and the resume that produces the world every
 * observer was promised.
 *
 * `E2E-30` Inject an invariant violation. Assert: tick aborts, nothing publishes,
 * world enters `PAUSED`, `observe` returns the last good snapshot marked `stale` with
 * an empty affordance list, `act` returns 503 with a reason, the client shows
 * **"Reckoning delayed"** and not a countdown to an event that will not occur,
 * submissions queue to a published bound.
 *
 * `E2E-31` Operator replays the failed tick in a sandbox from the immutable input
 * triple, fixes the defect, issues a signed `resume` — and the re-run produces **the
 * world every observer was promised**.
 *
 * The last clause is the one worth being careful about, because it is easy to test
 * tautologically. "The world every observer was promised" is not "whatever the re-run
 * produced" — it is the world that a *correct* implementation derives from
 * `(snapshot_T, action_log_T, seed_T)`. So the test derives that hash independently,
 * in a sandbox, from the same triple, before the resume runs, and then asserts the
 * resumed world matches it.
 */

import { describe, expect, it } from 'vitest';
import { canonicalHash, canonicalize, type CanonicalValue } from '../../src/core/canonical.js';
import { generateKeypair, type PublicKeyJwk } from '../../src/identity/keys.js';
import type { InvariantReport } from '../../src/invariants/index.js';
import {
  HaltController,
  RECKONING_DELAYED,
  SUBMISSION_QUEUE_BOUND,
  freezeTriple,
  halt,
  resumeBytes,
  signResume,
  tripleHash,
  type RerunResult,
  type TickInputs,
} from '../../src/invariants/index.js';
import { ALICE, BOB } from './fixture.js';

const START_TICK = 100;
const START_HASH = canonicalHash({ world: 'clean', tick: START_TICK });
const FAILED_TICK = 101;

/**
 * The failed tick's inputs. Frozen, because the promise that a fix reproduces the
 * promised world rests entirely on these bytes not having moved.
 */
function inputs(): TickInputs {
  return freezeTriple({
    tick: FAILED_TICK,
    snapshot: { tick: START_TICK, accounts: [{ id: 'stores:alice', balanceMinor: 1_000 }] },
    actionLog: [
      { principal: 'alice', verb: 'move', clientSequence: 1 },
      { principal: 'bob', verb: 'fill_role', clientSequence: 1 },
    ],
    seed: 'seed:101',
  });
}

function brokenReport(id = 'INV-17'): InvariantReport {
  return {
    tick: FAILED_TICK,
    violations: [halt(id, FAILED_TICK, 'a default with no attributable cause')],
    checked: [id],
    skipped: [{ id: 'INV-24', reason: 'no Levy assessments supplied' }],
  };
}

/**
 * The sandbox: the *fixed* implementation, deriving the next state from the triple
 * alone. This is the independent source of "the world every observer was promised".
 */
function fixedImplementation(t: TickInputs): string {
  return canonicalHash({
    fromSnapshot: t.snapshot,
    appliedInOrder: [...t.actionLog],
    withSeed: t.seed,
    atTick: t.tick,
  });
}

interface Operator {
  readonly keys: ReadonlyMap<string, PublicKeyJwk>;
  readonly sign: (bytes: Uint8Array) => Uint8Array;
  readonly keyid: string;
}

function operator(): Operator {
  const pair = generateKeypair();
  return {
    keys: new Map([[pair.keyid, pair.record.publicKeyJwk]]),
    sign: (bytes) => pair.sign(bytes),
    keyid: pair.keyid,
  };
}

function paused(op = operator()): { ctl: HaltController; triple: TickInputs; op: Operator } {
  const ctl = new HaltController({
    startTick: START_TICK,
    startStateHash: START_HASH,
    resumeKeys: op.keys,
  });
  const triple = inputs();
  ctl.haltTick(brokenReport(), triple);
  return { ctl, triple, op };
}

describe('E2E-30 — the PAUSED surface', () => {
  it('the tick aborts, nothing publishes, and the world is PAUSED', () => {
    const { ctl } = paused();
    expect(ctl.status).toBe('PAUSED');
    expect(ctl.publishedTick).toBe(START_TICK);
    expect(ctl.publishedStateHash).toBe(START_HASH);
    expect(ctl.haltRecord?.tick).toBe(FAILED_TICK);
    // The operator reads the worst thing first.
    expect(ctl.haltRecord?.topId).toBe('INV-17');
    expect(ctl.haltRecord?.reason).toContain('top severity');
    // And whether the failed pass was even looking at the whole world.
    expect(ctl.haltRecord?.skipped).toContain('INV-24');
  });

  it('observe returns the LAST GOOD snapshot, marked stale, with an EMPTY affordance list', () => {
    const { ctl } = paused();
    const view = ctl.observe();
    expect(view.stale).toBe(true);
    if (!view.stale) return;
    // The last good tick, never the tick that failed: that tick was aborted, and an
    // agent must not be able to infer a half-computed world from a stale read.
    expect(view.tick).toBe(START_TICK);
    expect(view.stateHash).toBe(START_HASH);
    expect(view.affordances).toEqual([]);
    expect(view.notice).toBe(RECKONING_DELAYED);
    expect(view.haltedAtTick).toBe(FAILED_TICK);
    expect(view.queueBound).toBe(SUBMISSION_QUEUE_BOUND);
  });

  it('observe is not stale while running', () => {
    const ctl = new HaltController({
      startTick: START_TICK,
      startStateHash: START_HASH,
      resumeKeys: new Map(),
    });
    const view = ctl.observe();
    expect(view.stale).toBe(false);
    expect(view.tick).toBe(START_TICK);
  });

  it('act returns 503 with a reason, and no retry estimate', () => {
    const { ctl } = paused();
    const refusal = ctl.act();
    expect(refusal).not.toBeNull();
    if (refusal === null) return;
    expect(refusal.ok).toBe(false);
    expect(refusal.status).toBe(503);
    expect(refusal.reason).toContain('PAUSED');
    expect(refusal.reason).toContain('INV-17');
    // A number here would be a countdown to an event that may not occur.
    expect(refusal.retryAfterTicks).toBeNull();
    // The refusal tells an agent it is not at fault and nothing was lost.
    expect(refusal.reason).toContain('queued');
  });

  it('act returns null while running, so a caller cannot mistake a refusal for a result', () => {
    const ctl = new HaltController({
      startTick: START_TICK,
      startStateHash: START_HASH,
      resumeKeys: new Map(),
    });
    expect(ctl.act()).toBeNull();
  });

  it('the client card says "Reckoning delayed" and has NO countdown field at all', () => {
    const { ctl } = paused();
    const card = ctl.card();
    expect(card).not.toBeNull();
    if (card === null) return;
    expect(card.headline).toBe(RECKONING_DELAYED);
    expect(card.lastGoodTick).toBe(START_TICK);
    expect(card.haltedAtTick).toBe(FAILED_TICK);

    // Structural, not stylistic: the absence of a countdown is the guarantee, so it
    // is asserted over the serialised shape rather than trusted to the type.
    const keys = Object.keys(card as unknown as Record<string, unknown>);
    const countdownish = /countdown|secondsuntil|msuntil|etaseconds|ticksuntil|resumesat|retryafter/i;
    expect(keys.filter((k) => countdownish.test(k))).toEqual([]);
    // And nothing in the rendered text promises a time.
    expect(card.detail).not.toMatch(/\bin \d+/);
  });

  it('there is no card while running — the client shows its usual countdown', () => {
    const ctl = new HaltController({
      startTick: START_TICK,
      startStateHash: START_HASH,
      resumeKeys: new Map(),
    });
    expect(ctl.card()).toBeNull();
  });

  it('submissions QUEUE to a published bound rather than being lost', () => {
    const { ctl } = paused();
    const first = ctl.submit({ principal: ALICE, clientSequence: 1, action: { verb: 'move' } }, 101);
    expect(first.ok).toBe(true);
    expect(first.queued).toBe(true);
    expect(first.position).toBe(0);
    expect(first.queueBound).toBe(SUBMISSION_QUEUE_BOUND);
    expect(first.reason).toContain('client_sequence');

    const second = ctl.submit({ principal: BOB, clientSequence: 1, action: { verb: 'sign' } }, 101);
    expect(second.position).toBe(1);
    expect(ctl.queueDepth).toBe(2);
  });

  it('a full queue refuses helpfully rather than dropping what is already queued (scar #3)', () => {
    const op = operator();
    const ctl = new HaltController({
      startTick: START_TICK,
      startStateHash: START_HASH,
      resumeKeys: op.keys,
      queueBound: 2,
    });
    ctl.haltTick(brokenReport(), inputs());
    expect(ctl.submit({ principal: ALICE, clientSequence: 1, action: {} }, 101).ok).toBe(true);
    expect(ctl.submit({ principal: ALICE, clientSequence: 2, action: {} }, 101).ok).toBe(true);
    const full = ctl.submit({ principal: ALICE, clientSequence: 3, action: {} }, 101);
    expect(full.ok).toBe(false);
    expect(full.queued).toBe(false);
    expect(full.reason).toContain('published cap of 2');
    expect(full.reason).toContain('nothing already queued has been dropped');
    // The bound is a bound: the queue did not grow past it.
    expect(ctl.queueDepth).toBe(2);
  });

  it('drain hands the queue over in ARRIVAL order, leaving resolution order to the tick loop', () => {
    const { ctl } = paused();
    ctl.submit({ principal: BOB, clientSequence: 7, action: {} }, 101);
    ctl.submit({ principal: ALICE, clientSequence: 1, action: {} }, 101);
    const drained = ctl.drain();
    // Arrival order, deliberately: `(priority, principal_id, client_sequence)` is the
    // tick loop's rule and must live in exactly one place (SPEC §15.2).
    expect(drained.map((s) => s.principal)).toEqual([BOB, ALICE]);
    expect(ctl.queueDepth).toBe(0);
  });

  it('refuses to halt on a WARN — an outage over something the design chose not to stop for', () => {
    const ctl = new HaltController({
      startTick: START_TICK,
      startStateHash: START_HASH,
      resumeKeys: new Map(),
    });
    expect(() =>
      ctl.haltTick(
        {
          tick: FAILED_TICK,
          violations: [{ id: 'INV-2', tick: FAILED_TICK, message: 'cosmetic', severity: 'WARN' }],
          checked: [],
          skipped: [],
        },
        inputs(),
      ),
    ).toThrow(/refusing to halt/);
    expect(ctl.status).toBe('RUNNING');
  });

  it('keeps the FIRST halt record when the same tick is halted twice', () => {
    const { ctl, triple } = paused();
    ctl.haltTick(brokenReport('INV-2'), triple);
    // The first failure is the one an operator needs; the rest are its consequences.
    expect(ctl.haltRecord?.topId).toBe('INV-17');
  });
});

describe('E2E-31 — the operator replays, fixes, and issues a signed resume', () => {
  it('the re-run produces the world every observer was promised', () => {
    const { ctl, triple, op } = paused();

    // 1. The operator takes the immutable triple into a sandbox and derives, with the
    //    FIXED implementation, what the tick should have produced. This hash is
    //    computed *before* the resume, from the triple alone — it is the promise.
    const record = ctl.haltRecord;
    expect(record).not.toBeNull();
    if (record === null) return;
    const promised = fixedImplementation(record.inputs);
    expect(record.inputsHash).toBe(tripleHash(triple));

    // 2. The operator signs a resume naming this tick and this triple.
    const order = signResume(
      {
        tick: FAILED_TICK,
        tripleHash: record.inputsHash,
        keyid: op.keyid,
        note: 'INV-17: the default handler was not passing the raid event id through',
      },
      op.sign,
    );

    // 3. Production re-runs from the triple, using the fixed implementation.
    let seenTriple: TickInputs | null = null;
    const outcome = ctl.resume(order, (t): RerunResult => {
      seenTriple = t;
      return {
        committed: true,
        stateHash: fixedImplementation(t),
        report: { tick: t.tick, violations: [], checked: ['INV-17'], skipped: [] },
      };
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.status).toBe('RUNNING');
    expect(ctl.status).toBe('RUNNING');
    expect(ctl.publishedTick).toBe(FAILED_TICK);
    // The claim, asserted against the independently derived hash.
    expect(ctl.publishedStateHash).toBe(promised);
    expect(outcome.stateHash).toBe(promised);
    expect(outcome.reason).toContain('re-ran from its immutable inputs');
    // Replay's input is the triple, not the current state and not the event stream.
    expect(seenTriple).not.toBeNull();
    expect(canonicalize(seenTriple as unknown as CanonicalValue)).toBe(
      canonicalize(triple as unknown as CanonicalValue),
    );
  });

  it('the input triple is immutable, which is what makes the promise derivable', () => {
    const { ctl } = paused();
    const record = ctl.haltRecord;
    if (record === null) return;
    expect(Object.isFrozen(record.inputs)).toBe(true);
    expect(Object.isFrozen(record.inputs.actionLog)).toBe(true);
    expect(Object.isFrozen(record.inputs.snapshot)).toBe(true);
    expect(() => {
      (record.inputs as { seed: string }).seed = 'tampered';
    }).toThrow();
    expect(tripleHash(record.inputs)).toBe(record.inputsHash);
  });

  it('releases the queued submissions to the tick loop on success', () => {
    const { ctl, op } = paused();
    ctl.submit({ principal: ALICE, clientSequence: 1, action: { verb: 'move' } }, 101);
    ctl.submit({ principal: BOB, clientSequence: 1, action: { verb: 'sign' } }, 101);
    const record = ctl.haltRecord;
    if (record === null) return;
    const order = signResume(
      { tick: FAILED_TICK, tripleHash: record.inputsHash, keyid: op.keyid, note: 'fixed the handler' },
      op.sign,
    );
    const outcome = ctl.resume(order, (t) => ({
      committed: true,
      stateHash: fixedImplementation(t),
      report: { tick: t.tick, violations: [], checked: [], skipped: [] },
    }));
    expect(outcome.released.map((s) => s.principal)).toEqual([ALICE, BOB]);
    expect(ctl.queueDepth).toBe(0);
  });

  it('a re-run that fails again leaves the world PAUSED — the worst case, handled', () => {
    const { ctl, op } = paused();
    const record = ctl.haltRecord;
    if (record === null) return;
    const order = signResume(
      { tick: FAILED_TICK, tripleHash: record.inputsHash, keyid: op.keyid, note: 'a guess' },
      op.sign,
    );
    const outcome = ctl.resume(order, (t) => ({
      committed: false,
      stateHash: '',
      report: {
        tick: t.tick,
        violations: [halt('INV-17', t.tick, 'still no attributable cause')],
        checked: ['INV-17'],
        skipped: [],
      },
    }));
    expect(outcome.ok).toBe(false);
    expect(ctl.status).toBe('PAUSED');
    expect(ctl.publishedTick).toBe(START_TICK);
    expect(outcome.reason).toContain('failed again');
  });

  it('a re-run that throws leaves the world PAUSED and leaks no stack trace (scar #11)', () => {
    const { ctl, op } = paused();
    const record = ctl.haltRecord;
    if (record === null) return;
    const order = signResume(
      { tick: FAILED_TICK, tripleHash: record.inputsHash, keyid: op.keyid, note: 'a worse guess' },
      op.sign,
    );
    const outcome = ctl.resume(order, () => {
      throw new Error('/srv/agentinsurance/engine/dist/tick.js exploded');
    });
    expect(outcome.ok).toBe(false);
    expect(ctl.status).toBe('PAUSED');
    expect(outcome.reason).toContain('threw');
    expect(outcome.reason).not.toContain('at Object.');
  });

  it('refuses an unsigned or wrongly-signed order', () => {
    const { ctl, op } = paused();
    const record = ctl.haltRecord;
    if (record === null) return;
    const claim = {
      tick: FAILED_TICK,
      tripleHash: record.inputsHash,
      keyid: op.keyid,
      note: 'trust me',
    };
    const forged = { claim, signature: new Uint8Array(64) };
    let reran = false;
    const outcome = ctl.resume(forged, () => {
      reran = true;
      return { committed: true, stateHash: 'x', report: brokenReport() };
    });
    expect(outcome.ok).toBe(false);
    expect(reran).toBe(false);
    expect(outcome.reason).toContain('does not verify');
    expect(ctl.status).toBe('PAUSED');
  });

  it('refuses an order signed by a key that may not resume this world', () => {
    const { ctl } = paused();
    const stranger = operator();
    const record = ctl.haltRecord;
    if (record === null) return;
    const order = signResume(
      { tick: FAILED_TICK, tripleHash: record.inputsHash, keyid: stranger.keyid, note: 'let me in' },
      stranger.sign,
    );
    const outcome = ctl.resume(order, () => ({ committed: true, stateHash: 'x', report: brokenReport() }));
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain('no operator key named');
  });

  it('refuses an order naming a different triple — the inputs are immutable, so a mismatch means the wrong sandbox', () => {
    const { ctl, op } = paused();
    const order = signResume(
      {
        tick: FAILED_TICK,
        tripleHash: canonicalHash({ some: 'other triple' }),
        keyid: op.keyid,
        note: 'replayed something else',
      },
      op.sign,
    );
    const outcome = ctl.resume(order, () => ({ committed: true, stateHash: 'x', report: brokenReport() }));
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain('input triple');
  });

  it('refuses an order naming a different tick', () => {
    const { ctl, op } = paused();
    const record = ctl.haltRecord;
    if (record === null) return;
    const order = signResume(
      { tick: FAILED_TICK + 5, tripleHash: record.inputsHash, keyid: op.keyid, note: 'wrong tick' },
      op.sign,
    );
    const outcome = ctl.resume(order, () => ({ committed: true, stateHash: 'x', report: brokenReport() }));
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain('names tick');
  });

  it('refuses an order that states no defect', () => {
    const { ctl, op } = paused();
    const record = ctl.haltRecord;
    if (record === null) return;
    const order = signResume(
      { tick: FAILED_TICK, tripleHash: record.inputsHash, keyid: op.keyid, note: '   ' },
      op.sign,
    );
    const outcome = ctl.resume(order, () => ({ committed: true, stateHash: 'x', report: brokenReport() }));
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain('what was fixed');
  });

  it('a signed order is single-use, so one captured off the wire cannot replay at the next halt', () => {
    const { ctl, op, triple } = paused();
    const record = ctl.haltRecord;
    if (record === null) return;
    const order = signResume(
      { tick: FAILED_TICK, tripleHash: record.inputsHash, keyid: op.keyid, note: 'fixed once' },
      op.sign,
    );
    const rerun = (t: TickInputs): RerunResult => ({
      committed: true,
      stateHash: fixedImplementation(t),
      report: { tick: t.tick, violations: [], checked: [], skipped: [] },
    });
    expect(ctl.resume(order, rerun).ok).toBe(true);

    // The same tick number fails again later, and the old order is presented again.
    ctl.haltTick(brokenReport(), triple);
    const replayed = ctl.resume(order, rerun);
    expect(replayed.ok).toBe(false);
    expect(replayed.reason).toContain('already been used');
    expect(ctl.status).toBe('PAUSED');
  });

  it('there is nothing to resume while running', () => {
    const op = operator();
    const ctl = new HaltController({
      startTick: START_TICK,
      startStateHash: START_HASH,
      resumeKeys: op.keys,
    });
    const order = signResume(
      { tick: FAILED_TICK, tripleHash: 'x', keyid: op.keyid, note: 'nothing broke' },
      op.sign,
    );
    expect(ctl.resume(order, () => ({ committed: true, stateHash: 'x', report: brokenReport() })).ok).toBe(
      false,
    );
  });

  it('signer and verifier serialise the claim exactly one way', () => {
    const claim = { tick: 1, tripleHash: 'abc', keyid: 'k', note: 'n' };
    // Same bytes, whichever order the object literal was written in — otherwise a
    // valid order reads as a forgery and an operator cannot restart the world.
    const reordered = { note: 'n', keyid: 'k', tripleHash: 'abc', tick: 1 };
    expect(resumeBytes(claim)).toEqual(resumeBytes(reordered));
  });
});
