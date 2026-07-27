/**
 * A PARAM MEANING "ACT FOR SOMEONE ELSE" MUST NEVER BE SILENTLY DROPPED.
 *
 * A blind probe sent `graduate {"on_behalf_of": "<victim>", "to": "sys-05"}`, intending to graduate
 * another principal's holding using a mandate it held. `graduate` does not read `on_behalf_of`, so the
 * param was ignored and the probe **irreversibly graduated its own holding out of the Commons** — no
 * refusal, no correction, permanent loss of A8 protection, from a param the docs never said the verb
 * takes.
 *
 * Its own verdict: *"for the game's explicitly one-way, most-consequential verb, silently dropping an
 * unrecognised param is the worst available failure mode."* That is right, and the general rule is
 * better than a special case: the act a delegation param modifies is precisely the act you did not
 * intend to perform on yourself, so dropping it does not degrade the request — it inverts it.
 *
 * The guard fronts EVERY handler rather than sitting in each one, for the reason the affordance
 * liveness filter gives a few lines away: a per-branch check is one somebody forgets when they add a
 * verb, and the verb they forget it on is the one that silently acts on the sender.
 */

import { describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { Runtime } from '../../src/sim/runtime.js';

function world(seed: string): { rt: Runtime; who: ReturnType<HeuristicCast['roster']['at']> } {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const cast = new HeuristicCast(rt, { size: 4 });
  cast.seat(seed);
  rt.runTick();
  return { rt, who: cast.roster[0] };
}

describe('a delegation param on a verb that ignores it is refused, not dropped', () => {
  it('graduate refuses on_behalf_of instead of graduating the SENDER', () => {
    const { rt, who } = world('drop-guard');
    const principal = who!.principal;
    const before = rt.world.holdingByPrincipal.get(principal);

    rt.engine.submit({
      principal,
      verb: 'graduate',
      params: { on_behalf_of: 'p:somebody-else', to: 'sys-05' },
      clientSequence: 1,
      arrivalMs: 0,
      decisionSource: 'LIVE',
    });
    rt.takeCorrections(principal);
    rt.runTick();

    // The irreversible thing must NOT have happened to the sender.
    expect(
      rt.world.holdingByPrincipal.get(principal),
      'the sender was graduated by a param the verb does not read — permanent, and not what was asked',
    ).toBe(before);

    const why = rt.takeCorrections(principal).map((c) => c.hint ?? '');
    expect(why.join(' | '), 'and it must SAY it refused, not merely decline to act').toMatch(
      /on_behalf_of|does not act on another/i,
    );
  }, 60_000);

  it('and the verbs that DO honour it are untouched', () => {
    // The guard's own guard. A blanket refusal would break delegated `create`, which is the one place
    // A6's mandate actually reaches the world — trading a silent inversion for a silent amputation.
    const { rt, who } = world('drop-guard-allows');
    const principal = who!.principal;
    rt.takeCorrections(principal);
    rt.engine.submit({
      principal,
      verb: 'create',
      params: { kind: 'HAUL', stage: 'sys-01', on_behalf_of: 'p:someone' },
      clientSequence: 1,
      arrivalMs: 0,
      decisionSource: 'LIVE',
    });
    rt.runTick();
    const why = rt.takeCorrections(principal).map((c) => c.hint ?? '').join(' | ');
    expect(
      why,
      '`create` reads on_behalf_of, so it must be refused on its own merits (no live grant, bad target) ' +
        'and never by the dropped-param guard',
    ).not.toMatch(/does not act on another principal/i);
  }, 60_000);
});
