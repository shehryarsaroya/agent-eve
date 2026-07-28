/**
 * THE OPERATOR DOOR HAS A KEY, NOT A DOORSTOP.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Measured on production before this file existed:
 *
 * ```
 * select count(*), min(tick), max(tick) from journal_divergence;
 *  19 | 287 | 287
 * ```
 *
 * Nineteen accepted discontinuities, **every one at tick 287.**
 * `COMPACT_ACCEPT_DIVERGENCE_AT_TICK=287` had stood in `/etc/compact/env` since an early
 * change, and nearly every rules change first diverges at the world's first snapshot
 * tripwire — which is tick 287. So the preflight read a matching number, called the
 * divergence pre-accepted, and restarted production without asking. Nineteen consecutive
 * times. The most recent deploy did it while the agent running it expected to be stopped.
 *
 * The recording was honest the whole time. The GATE was not, and its failure condition could
 * not occur: **a tick is where a divergence is, never which divergence it is.**
 *
 * So this file pins the properties that make the acceptance a key:
 *
 *   1. a **bare tick is refused**, loudly, with the exact string to use instead;
 *   2. a bound acceptance opens the door **once**, for the change it names;
 *   3. the same acceptance is **inert against a different change at the same tick** —
 *      which is precisely the nineteen-deploy scenario, reproduced;
 *   4. an unparseable value **holds the world** rather than being widened into one that works;
 *   5. what was authorised **reaches `journal_divergence`**, so the record says which.
 *
 * Nothing here is world state, so no `RULES_VERSION` bump: the acceptance is read from the
 * environment at boot and never enters a hashed structure.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import type { PrincipalId } from '../../src/core/types.js';
import type { SubmittedAction } from '../../src/tick/index.js';
import {
  ACCEPT_ENV_VAR,
  ACCEPT_FINGERPRINT_CHARS,
  ACCEPT_FINGERPRINT_MIN_CHARS,
  InMemoryJournalStore,
  Journal,
  acceptanceAuthorises,
  acceptanceStringFor,
  acceptanceStringForDiagnosis,
  bootFromStore,
  bootWorld,
  describeAcceptanceRefusal,
  describeDiagnosis,
  divergenceFingerprint,
  identityOf,
  parseAcceptance,
  replayCheck,
  type DivergenceIdentity,
} from '../../src/persist/index.js';

const SEED = 'operator-door-key-1';
const CAST = 6;
/** Two Reckonings, so the record holds a genuine snapshot tripwire at 287. */
const TICKS = 320;
/** Every boot here judges the record, and the door only exists on the replay path. */
const GENESIS = { disabled: true } as const;

function seated(): Runtime {
  const rt = new Runtime({ seed: SEED });
  new HeuristicCast(rt, { size: CAST }).seat(SEED);
  return rt;
}

/** A rules change: from `fromTick`, this principal's actions are refused. */
function refuse(rt: Runtime, principal: PrincipalId, fromTick: number, tag: string): void {
  const engine = rt.engine;
  const original = engine.submit.bind(engine);
  engine.submit = (a: SubmittedAction): ReturnType<typeof original> =>
    a.principal === principal && engine.tick + 1 >= fromTick
      ? { ok: false, invariant: 'A6-CONTINGENT', hint: tag }
      : original(a);
}

/** Explicit comparator (DET-1): a bare `.sort()` is implementation-defined on non-strings. */
function sorted(values: readonly (string | null)[]): readonly (string | null)[] {
  return [...values].sort((x, y) => (String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0));
}

function principals(rt: Runtime): readonly PrincipalId[] {
  return [...rt.world.principalOrder].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

async function runLive(): Promise<InMemoryJournalStore> {
  const rt = new Runtime({ seed: SEED });
  const cast = new HeuristicCast(rt, { size: CAST });
  cast.seat(SEED);
  const store = new InMemoryJournalStore();
  const journal = new Journal(store);
  await bootFromStore(rt, store, { seed: SEED, checkpoint: GENESIS });
  for (let i = 0; i < TICKS; i += 1) {
    for (const a of cast.decide(rt.engine.tick + 1, SEED)) rt.engine.submit(a);
    const report = rt.runTick();
    if (report.halted) throw new Error(`live halted at tick ${String(report.tick)}`);
    journal.record(rt, report);
    await journal.flushPending();
  }
  await journal.drain();
  return store;
}

interface Change {
  readonly principal: PrincipalId;
  readonly fromTick: number;
  readonly tag: string;
}

/**
 * Two rules changes whose FIRST divergence is the same tick, found by sweeping.
 *
 * Swept rather than assumed, for the reason `divergence-annotation.test.ts` records: which
 * world grows a collision is incidental to the property under test, and the first draft of
 * this file hardcoded `fromTick: 100` and got ticks 100 and 104 — the fixture died in its own
 * setup with a message that read like a finding. Widen the sweep; never weaken the assertion,
 * because a collision is the entire point: it is the shape tick 287 had nineteen times.
 */
async function findCollision(store: InMemoryJournalStore): Promise<{
  readonly one: Change;
  readonly two: Change;
  readonly tick: number;
}> {
  for (const fromTick of [100, 60, 140, 40, 180, 20, 220, 80, 120]) {
    const byTick = new Map<number, Change[]>();
    for (const principal of principals(seated())) {
      const change: Change = { principal, fromTick, tag: `change targeting ${principal}` };
      const held = await bootUnder(store, change);
      if (held.status !== 'HELD') continue;
      byTick.set(held.diagnosis.tick, [...(byTick.get(held.diagnosis.tick) ?? []), change]);
    }
    for (const [tick, group] of byTick) {
      const [one, two] = group;
      if (one !== undefined && two !== undefined) return { one, two, tick };
    }
  }
  throw new Error(
    'no refusal tick in the sweep produced two rules changes diverging at the same tick. Widen the ' +
      'sweep — do not weaken the assertion: the property under test is that a standing acceptance is ' +
      'inert against a DIFFERENT change at the SAME tick, and it needs a genuine collision.',
  );
}

/** Boot the record under a named rules change, optionally carrying a declaration. */
async function bootUnder(
  store: InMemoryJournalStore,
  change: Change,
  declaration?: string,
): Promise<Awaited<ReturnType<typeof bootWorld>>> {
  const rt = seated();
  refuse(rt, change.principal, change.fromTick, change.tag);
  return bootWorld(rt, store, {
    seed: SEED,
    checkpoint: GENESIS,
    nowMs: () => 1_700_000_000_000,
    ...(declaration === undefined ? {} : { acceptDivergence: declaration }),
  });
}

// ── 1. THE PARSER, IN ISOLATION ─────────────────────────────────────────────

describe('an acceptance names WHAT it accepts, and a bare tick is not that', () => {
  const identity: DivergenceIdentity = {
    tick: 287,
    kind: 'STATE_HASH_MISMATCH',
    detail: 'replayed state_hash aaa does not match the journalled snapshot bbb',
    expectedHash: 'b'.repeat(64),
    actualHash: 'a'.repeat(64),
  };

  it('★ REFUSES A BARE TICK — the mutation that re-wedges the door', () => {
    // ── THE NAMED REGRESSION ────────────────────────────────────────────────
    //
    // Reverting `acceptanceAuthorises` to `acceptance.tick === id.tick` (the shipped
    // behaviour for nineteen deploys) fails exactly this assertion. That is the mutation the
    // brief asks for, and it is what this test exists to kill.
    const bare = parseAcceptance('287');
    expect(bare.kind).toBe('BARE_TICK');
    expect(acceptanceAuthorises(bare, identity)).toBe(false);

    // …even though the tick it names is exactly right.
    expect(bare.kind === 'BARE_TICK' ? bare.tick : -1).toBe(identity.tick);
  });

  it('says WHY, and prints the exact string to use instead', () => {
    const refusal = describeAcceptanceRefusal(parseAcceptance('287'), identity) ?? '';
    // The wedge, named. An operator under time pressure must be told, not trusted to recall.
    expect(refusal).toContain('A BARE TICK IS NOT A KEY');
    expect(refusal).toContain('pre-authorises every');
    // And the actionable half: the literal line, ready to paste.
    expect(refusal).toContain(`${ACCEPT_ENV_VAR}=${acceptanceStringFor(identity)}`);
  });

  it('accepts the bound form it printed, and only for the divergence it names', () => {
    const key = acceptanceStringFor(identity);
    expect(key).toMatch(/^287:[0-9a-f]{16}$/);
    expect(acceptanceAuthorises(parseAcceptance(key), identity)).toBe(true);

    // The right tick, a different change. This is the nineteen-deploy case in one line.
    const otherChange: DivergenceIdentity = { ...identity, actualHash: 'c'.repeat(64) };
    expect(divergenceFingerprint(otherChange)).not.toBe(divergenceFingerprint(identity));
    expect(acceptanceAuthorises(parseAcceptance(key), otherChange)).toBe(false);

    // The right change, a different tick.
    expect(acceptanceAuthorises(parseAcceptance(key), { ...identity, tick: 288 })).toBe(false);
  });

  it('binds to what THIS build computes, not to what the record holds', () => {
    // If the fingerprint were taken over `expectedHash` alone it would be almost as wedged as
    // the bare tick: the record's hash at a tick is the same for every candidate build, so one
    // declaration would still pre-authorise every future change there.
    const a = { ...identity, actualHash: '1'.repeat(64) };
    const b = { ...identity, actualHash: '2'.repeat(64) };
    expect(a.expectedHash).toBe(b.expectedHash);
    expect(divergenceFingerprint(a)).not.toBe(divergenceFingerprint(b));

    // And an APPLIED_REFUSED divergence has no hashes at all, so `detail` has to be in it too.
    const r1 = { tick: 66, kind: 'APPLIED_REFUSED', detail: 'p:vex create -> A6', expectedHash: null, actualHash: null };
    const r2 = { ...r1, detail: 'p:vale create -> A6' };
    expect(divergenceFingerprint(r1)).not.toBe(divergenceFingerprint(r2));
  });

  it('FAILS CLOSED on anything it cannot read, and never widens', () => {
    for (const bad of [
      'yes',
      '287:',
      '287:zzzzzzzz',
      '287:9f3a', // shorter than the floor
      `287:${'a'.repeat(ACCEPT_FINGERPRINT_CHARS + 1)}`, // longer than this build prints
      'tick 287',
      '-1:9f3a1c4e5b07d218',
    ]) {
      const parsed = parseAcceptance(bad);
      expect(parsed.kind, bad).toBe('MALFORMED');
      expect(acceptanceAuthorises(parsed, identity), bad).toBe(false);
      expect(describeAcceptanceRefusal(parsed, identity) ?? '', bad).toContain('CANNOT BE READ');
    }
    // Absent and blank authorise nothing and complain about nothing.
    for (const empty of [null, undefined, '', '   ']) {
      expect(parseAcceptance(empty).kind).toBe('ABSENT');
      expect(acceptanceAuthorises(parseAcceptance(empty), identity)).toBe(false);
      expect(describeAcceptanceRefusal(parseAcceptance(empty), identity)).toBeNull();
    }
  });

  it('accepts a truncated prefix down to the published floor, and no further', () => {
    const full = divergenceFingerprint(identity);
    const floor = `287:${full.slice(0, ACCEPT_FINGERPRINT_MIN_CHARS)}`;
    expect(acceptanceAuthorises(parseAcceptance(floor), identity)).toBe(true);
    const tooShort = `287:${full.slice(0, ACCEPT_FINGERPRINT_MIN_CHARS - 1)}`;
    expect(parseAcceptance(tooShort).kind).toBe('MALFORMED');
    // Upper-case is a transcription artefact, not a different key.
    expect(acceptanceAuthorises(parseAcceptance(`287:${full.toUpperCase()}`), identity)).toBe(true);
  });
});

// ── 2. THE DOOR, AGAINST A REAL RECORD ──────────────────────────────────────

describe('the door, against a journal this build cannot reproduce', () => {
  it('★ a standing bare tick does NOT let the deploy through — the 19-deploy defect', async () => {
    const store = await runLive();
    const victim = principals(seated())[0];
    if (victim === undefined) throw new Error('no principals seated');
    const change = { principal: victim, fromTick: 100, tag: 'change one' };

    const held = await bootUnder(store, change);
    expect(held.status).toBe('HELD');
    if (held.status !== 'HELD') throw new Error('unreachable');
    const at = held.diagnosis.tick;

    // The exact value that stood in /etc/compact/env, aimed at the exact right tick.
    const wedged = await bootUnder(store, change, String(at));
    expect(wedged.status).toBe('HELD');
    // Nothing was written: holding is not accepting.
    expect((await store.divergences()).length).toBe(0);
    // And the world says why, in the words that name the defect.
    if (wedged.status !== 'HELD') throw new Error('unreachable');
    expect(wedged.diagnosis.acceptanceRefusal ?? '').toContain('A BARE TICK IS NOT A KEY');
    expect(describeDiagnosis(wedged.diagnosis)).toContain('A BARE TICK IS NOT A KEY');

    // The bound form, taken off the diagnosis the operator was shown, DOES open it.
    const opened = await bootUnder(store, change, acceptanceStringForDiagnosis(held.diagnosis));
    expect(opened.status).toBe('READY');
    const rows = await store.divergences();
    expect(rows.length).toBe(1);
    // ── WHAT WAS AUTHORISED, IN THE RECORD ──────────────────────────────────
    expect(rows[0]?.acceptedAs).toBe(acceptanceStringForDiagnosis(held.diagnosis));
    expect(rows[0]?.acceptedAs ?? '').toContain(`${String(at)}:`);
  }, 240_000);

  it('★ a STANDING acceptance is inert against the NEXT change at the same tick', async () => {
    // The nineteen-deploy scenario, reproduced end to end: two different rules changes whose
    // first divergence is the same tick. Under the old gate the first declaration authorised
    // the second change forever. It must now refuse it.
    const store = await runLive();
    const { one, two, tick } = await findCollision(store);
    const heldOne = await bootUnder(store, one);
    const heldTwo = await bootUnder(store, two);
    if (heldOne.status !== 'HELD' || heldTwo.status !== 'HELD') throw new Error('expected two HELDs');

    // Non-vacuity: the fixture is only about this defect if the two collide on the tick.
    expect(heldOne.diagnosis.tick).toBe(tick);
    expect(heldTwo.diagnosis.tick).toBe(tick);
    expect(one.principal).not.toBe(two.principal);
    const keyOne = acceptanceStringForDiagnosis(heldOne.diagnosis);
    const keyTwo = acceptanceStringForDiagnosis(heldTwo.diagnosis);
    expect(keyOne).not.toBe(keyTwo);
    expect(keyOne.split(':')[0]).toBe(keyTwo.split(':')[0]);

    // Change one is accepted and the world resumes.
    expect((await bootUnder(store, one, keyOne)).status).toBe('READY');

    // ★ Change two, deployed later with change one's declaration still standing, is REFUSED.
    const second = await bootUnder(store, two, keyOne);
    expect(second.status).toBe('HELD');
    if (second.status !== 'HELD') throw new Error('unreachable');
    expect(second.diagnosis.acceptanceRefusal ?? '').toContain('DOES NOT NAME THIS DIVERGENCE');
    expect(second.diagnosis.acceptanceRefusal ?? '').toContain('INERT against a new one');
    // One discontinuity accepted, one row. Not two.
    expect((await store.divergences()).length).toBe(1);

    // And with its own key it goes through, and the record now distinguishes the two.
    expect((await bootUnder(store, two, keyTwo)).status).toBe('READY');
    const rows = await store.divergences();
    expect(rows.length).toBe(2);
    expect(new Set(rows.map((r) => r.acceptedAs)).size).toBe(2);
    expect(sorted(rows.map((r) => r.acceptedAs))).toEqual(sorted([keyOne, keyTwo]));
  }, 300_000);

  it('the same key re-opens the same door without annotating twice', async () => {
    const store = await runLive();
    const victim = principals(seated())[0];
    if (victim === undefined) throw new Error('no principals seated');
    const change = { principal: victim, fromTick: 100, tag: 'change one' };

    const held = await bootUnder(store, change);
    if (held.status !== 'HELD') throw new Error('expected HELD');
    const key = acceptanceStringForDiagnosis(held.diagnosis);

    for (let restart = 0; restart < 3; restart += 1) {
      expect((await bootUnder(store, change, key)).status).toBe('READY');
    }
    expect((await store.divergences()).length).toBe(1);
  }, 300_000);

  it('the preflight refuses a bare tick and prints the key — the deploy stops', async () => {
    const store = await runLive();
    const victim = principals(seated())[0];
    if (victim === undefined) throw new Error('no principals seated');
    const build = (): Runtime => {
      const rt = seated();
      refuse(rt, victim, 100, 'change one');
      return rt;
    };

    const undeclared = await replayCheck({ store, seed: SEED, buildRuntime: build });
    expect(undeclared.reproduces).toBe(false);
    if (undeclared.diagnosis === null) throw new Error('unreachable');
    const at = undeclared.diagnosis.tick;
    const key = acceptanceStringForDiagnosis(undeclared.diagnosis);

    // ★ The standing bare tick, at the right tick. `preAccepted` used to be true here, which
    // is precisely what let nineteen deploys restart production unasked.
    const wedged = await replayCheck({
      store,
      seed: SEED,
      buildRuntime: build,
      acceptDivergence: String(at),
    });
    expect(wedged.preAccepted).toBe(false);
    expect(wedged.report).toContain('A BARE TICK IS NOT A KEY');
    expect(wedged.report).toContain(`${ACCEPT_ENV_VAR}=${key}`);
    expect(wedged.report).toContain('THE DEPLOY MUST STOP HERE');

    // The bound form passes it, and says what it authorised.
    const bound = await replayCheck({ store, seed: SEED, buildRuntime: build, acceptDivergence: key });
    expect(bound.preAccepted).toBe(true);
    expect(bound.report).toContain('ALREADY declared this exact divergence');

    // The check is still read-only: asking wrote nothing either way.
    expect((await store.divergences()).length).toBe(0);
  }, 300_000);

  it('an unparseable declaration holds the world rather than being widened', async () => {
    const store = await runLive();
    const victim = principals(seated())[0];
    if (victim === undefined) throw new Error('no principals seated');
    const change = { principal: victim, fromTick: 100, tag: 'change one' };

    for (const bad of ['287:', 'yes', '287 : abc', '0x11f:9f3a1c4e5b07d218']) {
      const outcome = await bootUnder(store, change, bad);
      expect(outcome.status, bad).toBe('HELD');
      if (outcome.status !== 'HELD') throw new Error('unreachable');
      expect(outcome.diagnosis.acceptanceRefusal ?? '', bad).toContain('CANNOT BE READ');
    }
    expect((await store.divergences()).length).toBe(0);
  }, 300_000);

  it('the instruction a diagnosis prints is the one that opens the door', async () => {
    // The documentation-lie check. `operatorInstruction` is the surface that guides an
    // operator, so it printing the wedged form would be this module issuing the defect it
    // refuses. Proven by round trip rather than by string comparison.
    const store = await runLive();
    const victim = principals(seated())[0];
    if (victim === undefined) throw new Error('no principals seated');
    const change = { principal: victim, fromTick: 100, tag: 'change one' };

    const held = await bootUnder(store, change);
    if (held.status !== 'HELD') throw new Error('expected HELD');
    const instruction = held.diagnosis.operatorInstruction ?? '';
    expect(instruction).toMatch(/^COMPACT_ACCEPT_DIVERGENCE_AT_TICK=\d+:[0-9a-f]{16}$/);
    expect(instruction).not.toMatch(/^COMPACT_ACCEPT_DIVERGENCE_AT_TICK=\d+$/);

    const declared = instruction.split('=')[1] ?? '';
    expect(acceptanceAuthorises(parseAcceptance(declared), identityOf(held.diagnosis))).toBe(true);
    expect((await bootUnder(store, change, declared)).status).toBe('READY');
  }, 240_000);
});
