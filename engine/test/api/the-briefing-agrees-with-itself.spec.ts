/**
 * ★ THE BRIEFING AGREES WITH ITSELF — three things a blind playtest read that the engine contradicted.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *   (i)   Its FIRST briefing said *"You have no idle hand at sys-01, so move one there first"* with all
 *         three hands at sys-01. Enrolment mints them IDLE at the holding, PRESENT from the next tick;
 *         `move` refuses a trip to the system a hand is already in (INV-10), so the sentence sent the
 *         agent at an act the engine cannot take. Such a hand needs a tick, not a trip.
 *   (ii)  `prompt` said *"Nothing is waiting on you"* while `if_you_do_nothing`, one key over, warned of
 *         a public shortfall: the prompt's ladder never read the Levy or the Charge.
 *   (vii) `exposure.mine` read 0 beside escrow locked in a venture. That is the RULE (SPEC §3: EXPOSURE
 *         is Σ open `max_direct_loss` over the encumbrance table, and escrow is not on it), so the fix
 *         is text — `create` and `agent.md` now say so — and the rule is pinned here, unchanged.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { buildObservation } from '../../src/api/index.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { handsOf } from '../../src/world/index.js';
import { commonsSystems } from '../../src/world/index.js';
import { Runtime } from '../../src/sim/runtime.js';

const AGENT_MD = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');

type Row = Record<string, unknown>;

/** The payload as an agent reads it: JSON-shaped, no compile-time promises about nested blocks. */
interface Payload {
  readonly briefing: { readonly prompt: string; readonly if_you_do_nothing: string };
  readonly affordances: readonly { verb: string; params: Row; max_direct_loss: number; what_it_forecloses: string }[];
  readonly ventures: { readonly board: readonly Row[]; readonly mine: readonly Row[] };
  readonly obligations: { readonly exposure: { readonly mine: number } };
}

function observe(rt: Runtime, who: PrincipalId): Payload {
  return buildObservation({
    runtime: rt,
    principal: who,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 16,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  }) as unknown as Payload;
}

function act(rt: Runtime, principal: PrincipalId, verb: string, params: Record<string, unknown>): void {
  const outcome = rt.engine.submit({ principal, verb, params, clientSequence: 0, arrivalMs: 0, decisionSource: 'LIVE' });
  if (!outcome.ok) throw new Error(`submit ${verb}: ${outcome.invariant} ${outcome.hint}`);
  const report = rt.runTick();
  if (report.halted) throw new Error(`halted at ${String(report.tick)}`);
  const refusal = rt.takeCorrections(principal)[0];
  if (refusal !== undefined) throw new Error(`${verb} refused: ${refusal.invariant} ${refusal.hint}`);
}

function world(seed: string): { rt: Runtime; stage: SystemId } {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const stage = commonsSystems(rt.world.map)[0];
  if (stage === undefined) throw new Error('the launch map has no Commons system');
  return { rt, stage };
}

describe('(i) a hand minted at the stage needs a tick, not a trip', () => {
  it('★ the first briefing names the tick the hands become PRESENT, and never says "move one there"', () => {
    const { rt, stage } = world('first-briefing');
    const maker = 'p:maker' as PrincipalId;
    rt.seat(maker, 'maker', stage);
    rt.standing.open(maker);
    act(rt, maker, 'create', { kind: 'DIG', stage, value: 4_000 });
    // A newcomer seated at the same stage — exactly the enrol route: seated, then observed, no tick between.
    const newcomer = 'p:newbie' as PrincipalId;
    rt.seat(newcomer, 'newbie', stage);
    const hands = handsOf(rt.world, newcomer);
    expect(hands.every((h) => h.location === stage && h.state === 'IDLE'), 'non-vacuity: all three are there').toBe(true);
    expect(hands.every((h) => h.presentSinceTick > rt.engine.tick), 'and none is present yet').toBe(true);

    const o = observe(rt, newcomer);
    expect(o.ventures.board.some((row) => row['stage'] === stage), 'non-vacuity: a slot is open at the stage').toBe(true);
    const prompt = o.briefing.prompt;
    expect(prompt, 'the false instruction').not.toContain(`no idle hand at ${stage}`);
    expect(prompt).not.toContain('move one there first');
    expect(prompt).toContain(`already at ${stage} and become PRESENT at tick ${String(rt.engine.tick + 1)}`);
  });
});

describe('(ii) "Nothing is waiting on you" only when nothing is', () => {
  it('★ an unpaid Levy is named by the prompt, as the preview names it', () => {
    const { rt, stage } = world('levy-prompt');
    const who = 'p:quiet' as PrincipalId;
    rt.seat(who, 'quiet', stage);
    rt.standing.open(who);
    rt.runTick();
    const o = observe(rt, who);
    expect(o.briefing.if_you_do_nothing, 'non-vacuity: the preview records the shortfall').toContain('UNPAID');
    expect(o.briefing.prompt).not.toContain('Nothing is waiting on you');
    expect(o.briefing.prompt).toContain('Your Levy assessment is not paid');
    // And the preview's parts join cleanly: a part that is a sentence no longer leaves ".;" behind.
    expect(o.briefing.if_you_do_nothing).not.toContain('.;');
  });

  it('★ in a played world, the idle line never sits beside a debt the preview records', () => {
    const seed = 'briefing-agrees';
    setSpeed('instant');
    const rt = new Runtime({ seed });
    const cast = new HeuristicCast(rt, { size: 8 });
    const roster = cast.seat(seed);
    let idleLines = 0;
    let debtLines = 0;
    for (let t = 0; t < 400; t += 1) {
      for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
      rt.runTick();
      if (t % 20 !== 0) continue;
      for (const member of roster) {
        const o = observe(rt, member.principal);
        const owes = /UNPAID|ARREARS|LAPSE|NOT paid/.test(o.briefing.if_you_do_nothing);
        if (owes) debtLines += 1;
        if (!o.briefing.prompt.includes('Nothing is waiting on you')) continue;
        idleLines += 1;
        expect(owes, `${member.principal} at tick ${String(rt.engine.tick)}: "${o.briefing.if_you_do_nothing}"`).toBe(false);
      }
    }
    expect(debtLines, 'non-vacuity: somebody owed something at some sample').toBeGreaterThan(0);
    console.log('idle-line samples:', idleLines, '· samples with a debt on the preview:', debtLines);
  }, 300_000);
});

describe('(vii) escrow is committed value, not EXPOSURE — and the surface says so', () => {
  it('★ a creator with escrow locked reads exposure.mine 0, and the create affordance explains why', () => {
    const { rt, stage } = world('escrow-not-exposure');
    const maker = 'p:escrower' as PrincipalId;
    rt.seat(maker, 'escrower', stage);
    rt.standing.open(maker);
    rt.runTick();
    const before = observe(rt, maker);
    const create = before.affordances.find((a) => a.verb === 'create');
    expect(create, 'non-vacuity: create is on the menu').toBeDefined();
    expect(create?.what_it_forecloses).toContain('not EXPOSURE, so obligations.exposure.mine will not count it');
    act(rt, maker, 'create', { ...(create?.params ?? {}) });

    const after = observe(rt, maker);
    const mine = after.ventures.mine.find((v) => v['state'] === 'FORMING');
    expect(mine, 'non-vacuity: the venture exists, escrow and all').toBeDefined();
    expect(Number(create?.max_direct_loss), 'and it escrowed something').toBeGreaterThan(0);
    // The RULE, unchanged (SPEC §3, §15.1): changing it would move the Levy's EXPOSURE weights.
    expect(after.obligations.exposure.mine).toBe(0);
    expect(AGENT_MD).toContain('A venture\'s\n  **escrow is not in it**');
  });
});
