/**
 * ★ "THEY HAVE DEALT BEFORE, AND IT HELD" — only when they did, and it did.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A blind playtest read that sentence on a public docket card about two principals who had never
 * dealt. `Runtime.priorDealings` had three ways to say it falsely, each reproduced here against the
 * venture book and the standing journal rather than against the field that produced the sentence:
 *
 *   1. the creator counted as its own counterparty (the docket passes every filled role, its own too);
 *   2. an ABANDONED formation — which keeps its fills — counted as having dealt;
 *   3. "it held" was checked against only the six most recent counterparties.
 *
 * `test/frames/docket.spec.ts` says the BROKEN branch "can't be exercised" by the heuristic cast,
 * because the cast never defaults. Here a payer elects 1 of a due, which is a real default the
 * register attributes — so all three answers are driven, not asserted by construction.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import type { HandId, PrincipalId, SystemId, VentureId } from '../../src/core/types.js';
import { IN_FULL, openIndices } from '../../src/venture/index.js';
import { commonsSystems } from '../../src/world/index.js';
import { Runtime } from '../../src/sim/runtime.js';

function world(seed: string, principals: readonly PrincipalId[]): { runtime: Runtime; stage: SystemId } {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const stage = commonsSystems(runtime.world.map)[0];
  if (stage === undefined) throw new Error('the launch map has no Commons system');
  for (const p of principals) {
    runtime.seat(p, p.replace('p:', ''), stage);
    runtime.standing.open(p);
  }
  return { runtime, stage };
}

function submit(runtime: Runtime, principal: PrincipalId, verb: string, params: Record<string, unknown>, seq = 0): void {
  const outcome = runtime.engine.submit({ principal, verb, params, clientSequence: seq, arrivalMs: seq, decisionSource: 'LIVE' });
  if (!outcome.ok) throw new Error(`submit ${verb}: ${outcome.invariant} ${outcome.hint}`);
}

function tick(runtime: Runtime): void {
  const report = runtime.runTick();
  if (report.halted) throw new Error(`halted at ${String(report.tick)}: ${report.violations.map((v) => v.id).join(' ')}`);
}

function idleOf(runtime: Runtime, principal: PrincipalId, skip = 0): HandId {
  const found = [...runtime.world.hands.values()].filter((h) => h.principal === principal && h.state === 'IDLE')[skip];
  if (found === undefined) throw new Error(`${principal} has no idle hand`);
  return found.id;
}

/** A HAUL created by `creator`, its two roles filled by `a` and `b` (either may be the creator). */
function filled(runtime: Runtime, stage: SystemId, creator: PrincipalId, a: PrincipalId, b: PrincipalId): VentureId {
  const before = new Set(runtime.ventures.all().map((v) => String(v.id)));
  submit(runtime, creator, 'create', { kind: 'HAUL', stage, value: 4_000 });
  tick(runtime);
  const v = runtime.ventures.all().find((x) => !before.has(String(x.id)) && x.creator === creator);
  if (v === undefined || openIndices(v).length !== 2) throw new Error('create did not mint a two-role venture');
  submit(runtime, a, 'fill_role', { venture: v.id, role: 0, hand: idleOf(runtime, a) }, 0);
  submit(runtime, b, 'fill_role', { venture: v.id, role: 1, hand: idleOf(runtime, b, a === b ? 1 : 0) }, 1);
  tick(runtime);
  if (openIndices(runtime.ventures.require(v.id)).length !== 0) throw new Error('the roles did not fill');
  return v.id;
}

/** Everybody required signs, and the venture goes LIVE. */
function bind(runtime: Runtime, id: VentureId): void {
  const v = runtime.ventures.require(id);
  const hash = v.termsHash;
  if (hash === null) throw new Error('no terms hash');
  const signers = [...new Set([String(v.creator), ...v.roles.map((r) => String(r.filledByPrincipal))])];
  signers.forEach((p, i) => submit(runtime, p as PrincipalId, 'sign', { venture: id, terms_hash: hash }, 10 + i));
  tick(runtime);
  tick(runtime);
  if (runtime.ventures.require(id).state !== 'LIVE') throw new Error(`${id} is ${runtime.ventures.require(id).state}`);
}

function settle(runtime: Runtime, ids: readonly VentureId[]): void {
  for (let i = 0; i < 600 && ids.some((id) => runtime.ventures.require(id).state === 'LIVE'); i += 1) tick(runtime);
}

const ALPHA = 'p:alpha' as PrincipalId;
const BRAVO = 'p:bravo' as PrincipalId;
const CHARLIE = 'p:charlie' as PrincipalId;
const DELTA = 'p:delta' as PrincipalId;
const NONE = 'v:none' as VentureId;

describe('dealing is a venture that BOUND and FINISHED, with somebody other than yourself', () => {
  it('★ an ABANDONED formation is not dealing, and the creator is not its own counterparty', () => {
    const { runtime, stage } = world('dealt-abandoned', [ALPHA, BRAVO, CHARLIE]);
    const v1 = filled(runtime, stage, ALPHA, ALPHA, BRAVO);
    // Nobody signs: the window closes and the formation retires ABANDONED, fills and all.
    for (let i = 0; i < 40 && runtime.ventures.require(v1).state === 'FORMING'; i += 1) tick(runtime);
    expect(runtime.ventures.require(v1).state, 'non-vacuity: the formation was retired').toBe('ABANDONED');
    expect(runtime.ventures.require(v1).resolvedAtTick, 'and carries a resolution tick, which is what fooled it').not.toBeNull();

    // A stranger, on alpha's next venture: the docket passes alpha's own role as a filler too.
    expect(runtime.priorDealings(ALPHA, [ALPHA, CHARLIE], NONE), 'alpha counted itself').toBe('NEVER');
    expect(runtime.priorDealings(ALPHA, [ALPHA, BRAVO], NONE), 'an abandoned formation counted as a deal').toBe('NEVER');
    expect(runtime.priorDealings(ALPHA, [ALPHA], NONE)).toBe('NEVER');
  });

  it('★ a SETTLED venture that was honoured reads HELD — from either side of it', () => {
    const { runtime, stage } = world('dealt-held', [ALPHA, DELTA]);
    const v = filled(runtime, stage, ALPHA, ALPHA, DELTA);
    bind(runtime, v);
    submit(runtime, ALPHA, 'elect', { venture: v, role: 1, election: IN_FULL });
    tick(runtime);
    settle(runtime, [v]);
    expect(runtime.ventures.require(v).state).toBe('SETTLED');
    expect(runtime.priorDealings(ALPHA, [ALPHA, DELTA], NONE)).toBe('HELD');
    // Symmetric: delta creating next, with alpha filling, is the same pair with the same history.
    expect(runtime.priorDealings(DELTA, [ALPHA], NONE)).toBe('HELD');
  }, 120_000);

  it('★ a default beyond the six most recent counterparties still reads BROKEN, never "it held"', () => {
    // Eight counterparties settle on one tick; the default is with `p:zulu`, which sorts last, so the
    // capped list `relationsFor` returns by default (six) does not contain it.
    const fillers = ['p:f1', 'p:f2', 'p:f3', 'p:f4', 'p:f5', 'p:f6', 'p:f7', 'p:zulu'] as PrincipalId[];
    const { runtime, stage } = world('dealt-seventh', [ALPHA, ...fillers]);
    const ids: VentureId[] = [];
    for (let i = 0; i < fillers.length; i += 2) {
      const a = fillers[i];
      const b = fillers[i + 1];
      if (a === undefined || b === undefined) throw new Error('fixture');
      const id = filled(runtime, stage, ALPHA, a, b);
      bind(runtime, id);
      ids.push(id);
    }
    ids.forEach((id, i) => {
      const last = i === ids.length - 1;
      submit(runtime, ALPHA, 'elect', { venture: id, role: 0, election: IN_FULL }, 20 + 2 * i);
      // One role, the zulu one, elected 1 of its due: a real, attributed default.
      submit(runtime, ALPHA, 'elect', { venture: id, role: 1, election: last ? 1 : IN_FULL }, 21 + 2 * i);
    });
    tick(runtime);
    settle(runtime, ids);
    const lastId = ids[ids.length - 1];
    if (lastId === undefined) throw new Error('fixture');
    expect(runtime.ventures.require(lastId).state, 'non-vacuity: the zulu venture defaulted').toBe('DEFAULTED');
    const capped = runtime.relationsFor(ALPHA).map((r) => String(r.other));
    expect(capped, 'non-vacuity: the default sits past the default cap').not.toContain('p:zulu');
    expect(runtime.priorDealings(ALPHA, ['p:zulu' as PrincipalId], NONE)).toBe('BROKEN');
    expect(runtime.priorDealings(ALPHA, ['p:f1' as PrincipalId], NONE)).toBe('HELD');
  }, 180_000);
});
