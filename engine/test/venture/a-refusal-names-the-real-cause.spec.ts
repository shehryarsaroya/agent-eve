/**
 * ★ A REFUSAL LEADS WITH THE CAUSE THAT IS TRUE — not with whichever check happened to fail first.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A blind playtest got two refusals that contradicted themselves, both about a venture that had been
 * retired ABANDONED:
 *
 *   - `fill_role`: *"… is ABANDONED; roles are filled while a venture is FORMING. Another principal
 *     took this slot in the same tick …"* — an abandoned formation keeps its fills, and the allocator
 *     labelled any filled slot a lost contest, so the true cause got a false one appended;
 *   - `sign`: *"your echoed your_take_at_p50 (8400) does not match the server's (0) … Re-read the
 *     role"* — `countersign` checked the echo before the venture's state, and the server's take for a
 *     role you never got is 0, so the agent was sent to re-read a role on a deal that no longer existed.
 *
 * Both are corrections — returned to the agent, never written to the ledger or the event stream — and
 * the set of acts refused is unchanged; only which sentence an agent reads first moves.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import type { HandId, PrincipalId, SystemId, VentureId } from '../../src/core/types.js';
import { openIndices } from '../../src/venture/index.js';
import { commonsSystems } from '../../src/world/index.js';
import { FILL_REFUSAL_NOTE, lostContestNote, Runtime, type PendingCorrection } from '../../src/sim/runtime.js';

const ALPHA = 'p:alpha' as PrincipalId;
const BRAVO = 'p:bravo' as PrincipalId;
const CHARLIE = 'p:charlie' as PrincipalId;

function world(seed: string): { runtime: Runtime; stage: SystemId } {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const stage = commonsSystems(runtime.world.map)[0];
  if (stage === undefined) throw new Error('the launch map has no Commons system');
  for (const p of [ALPHA, BRAVO, CHARLIE]) {
    runtime.seat(p, p.replace('p:', ''), stage);
    runtime.standing.open(p);
  }
  return { runtime, stage };
}

function act(runtime: Runtime, principal: PrincipalId, verb: string, params: Record<string, unknown>): PendingCorrection | null {
  const outcome = runtime.engine.submit({ principal, verb, params, clientSequence: 0, arrivalMs: 0, decisionSource: 'LIVE' });
  if (!outcome.ok) throw new Error(`submit ${verb}: ${outcome.invariant} ${outcome.hint}`);
  const report = runtime.runTick();
  if (report.halted) throw new Error(`halted at ${String(report.tick)}`);
  return runtime.takeCorrections(principal)[0] ?? null;
}

function idleOf(runtime: Runtime, principal: PrincipalId): HandId {
  const found = [...runtime.world.hands.values()].find((h) => h.principal === principal && h.state === 'IDLE');
  if (found === undefined) throw new Error(`${principal} has no idle hand`);
  return found.id;
}

/** A HAUL whose two roles alpha and bravo fill, that nobody signs, retired ABANDONED at window close. */
function abandoned(runtime: Runtime, stage: SystemId): VentureId {
  expect(act(runtime, ALPHA, 'create', { kind: 'HAUL', stage, value: 12_000 })).toBeNull();
  const v = runtime.ventures.all().find((x) => x.creator === ALPHA && x.state === 'FORMING');
  if (v === undefined || openIndices(v).length !== 2) throw new Error('create did not mint a two-role venture');
  expect(act(runtime, ALPHA, 'fill_role', { venture: v.id, role: 0, hand: idleOf(runtime, ALPHA) })).toBeNull();
  expect(act(runtime, BRAVO, 'fill_role', { venture: v.id, role: 1, hand: idleOf(runtime, BRAVO) })).toBeNull();
  for (let i = 0; i < 40 && runtime.ventures.require(v.id).state === 'FORMING'; i += 1) runtime.runTick();
  expect(runtime.ventures.require(v.id).state, 'non-vacuity: the formation was retired').toBe('ABANDONED');
  expect(runtime.ventures.require(v.id).roles[1]?.filledByPrincipal, 'and it kept its fills').toBe(BRAVO);
  return v.id;
}

describe('a refusal about an ABANDONED venture says so, and only so', () => {
  it('★ fill_role: the venture is ABANDONED — and nobody "took this slot in the same tick"', () => {
    const { runtime, stage } = world('refusal-fill');
    const id = abandoned(runtime, stage);
    const refusal = act(runtime, CHARLIE, 'fill_role', { venture: id, role: 1, hand: idleOf(runtime, CHARLIE) });
    expect(refusal?.verb).toBe('fill_role');
    expect(refusal?.hint).toContain('ABANDONED');
    expect(refusal?.hint, 'the lost-contest advice is false about a retired venture').not.toContain(
      FILL_REFUSAL_NOTE.LOST_CONTEST,
    );
    expect(refusal?.hint).toContain(FILL_REFUSAL_NOTE.ROLE_RULE);
  });

  it('★ sign: the venture is ABANDONED — not a your_take_at_p50 mismatch', () => {
    const { runtime, stage } = world('refusal-sign');
    const id = abandoned(runtime, stage);
    const hash = runtime.ventures.require(id).termsHash;
    // The echo a filler copies off a board row: the slot's quote, which the server cannot match for a
    // role this principal never got.
    const refusal = act(runtime, CHARLIE, 'sign', { venture: id, terms_hash: hash, your_take_at_p50: 8_400 });
    expect(refusal?.invariant).toBe('PROP-V6');
    expect(refusal?.hint).toContain('ABANDONED');
    expect(refusal?.hint).not.toContain('does not match');
    // And a stale hash on the same venture gets the same, true, answer.
    const stale = act(runtime, BRAVO, 'sign', { venture: id, terms_hash: 'f'.repeat(64) });
    expect(stale?.invariant).toBe('PROP-V6');
  });

  // ── ★ "IN THE SAME TICK" WAS SAID OF EVERY LOSS, AND THIS TEST PINNED THE FALSE CASE ─────────────
  //
  // It read *"a slot a rival really did take is still reported as a lost contest"*, with BRAVO filling
  // one tick and CHARLIE asking the NEXT — and asserted the sentence "Another principal took this slot
  // in the same tick". No contest happened: preference and stake only order requests that land in the
  // same tick, and BRAVO had held the slot for a tick already (`lostContestNote`). Split in two, so the
  // label is still proved to fire where it is true.
  it('a slot filled at an EARLIER tick says when, and that no contest was held', () => {
    const { runtime, stage } = world('refusal-contest');
    expect(act(runtime, ALPHA, 'create', { kind: 'HAUL', stage, value: 12_000 })).toBeNull();
    const v = runtime.ventures.all().find((x) => x.creator === ALPHA && x.state === 'FORMING');
    if (v === undefined) throw new Error('create did not mint a venture');
    expect(act(runtime, BRAVO, 'fill_role', { venture: v.id, role: 1, hand: idleOf(runtime, BRAVO) })).toBeNull();
    const filledAt = runtime.ventures.require(v.id).roles[1]?.filledAtTick;
    const refusal = act(runtime, CHARLIE, 'fill_role', { venture: v.id, role: 1, hand: idleOf(runtime, CHARLIE) });
    expect(refusal?.hint, 'nobody took it "in the same tick"').not.toContain(FILL_REFUSAL_NOTE.LOST_CONTEST);
    expect(refusal?.hint).toContain(`already filled at tick ${String(filledAt)}`);
    expect(refusal?.hint).toContain('SAME tick');
  });

  it('a slot a rival really did take in the same tick is still reported as a lost contest', () => {
    // The other side of the label, so the fix cannot pass by never saying LOST_CONTEST at all.
    const { runtime, stage } = world('refusal-contest-same');
    expect(act(runtime, ALPHA, 'create', { kind: 'HAUL', stage, value: 12_000 })).toBeNull();
    const v = runtime.ventures.all().find((x) => x.creator === ALPHA && x.state === 'FORMING');
    if (v === undefined) throw new Error('create did not mint a venture');
    for (const [who, seq] of [[BRAVO, 1], [CHARLIE, 2]] as const) {
      const outcome = runtime.engine.submit({
        principal: who,
        verb: 'fill_role',
        params: { venture: v.id, role: 1, hand: idleOf(runtime, who) },
        clientSequence: seq,
        arrivalMs: seq,
        decisionSource: 'LIVE',
      });
      if (!outcome.ok) throw new Error(`submit: ${outcome.invariant}`);
    }
    runtime.runTick();
    const lost = [BRAVO, CHARLIE]
      .map((p) => runtime.takeCorrections(p)[0])
      .find((c) => c !== undefined);
    expect(lost, 'non-vacuity: one of the two lost').toBeDefined();
    expect(lost?.hint).toContain(FILL_REFUSAL_NOTE.LOST_CONTEST);
  });

  it('the note reads the role as it stands: same tick, an earlier tick, or vacated after the label', () => {
    // The third branch is the one no cheap world produces — a winner vacated AFTER the losers were
    // labelled (a stake that could not be escrowed, a grand role re-checked) — so the pure function is
    // pinned directly, all three ways.
    expect(lostContestNote({ filledByPrincipal: BRAVO, filledAtTick: 9 }, 9)).toBe(FILL_REFUSAL_NOTE.LOST_CONTEST);
    expect(lostContestNote({ filledByPrincipal: BRAVO, filledAtTick: 4 }, 9)).toContain('already filled at tick 4');
    expect(lostContestNote({ filledByPrincipal: null, filledAtTick: null }, 9)).toContain('OPEN');
  });
});
