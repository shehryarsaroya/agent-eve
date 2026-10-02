/**
 * ★ **A SEAL THE RULEBOOK TAUGHT COULD ONLY BE MARKED AGAINST YOU** (`RULES_VERSION` 41).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Found while verifying a blind playtest of the merged Season 1 tree. `agent.md` §8's example sealed
 * `{"verb": "deliver", "target": "v:265", …}`, and a venture's deed is recorded as `haul`
 * (`DELIVERY_VERB`). The door accepted the seal — `measureOfVerb` answers `null` for a verb it does not
 * know, and `null` is "no opinion" — so it was judged at the Reckoning against a deed that could never
 * exist and came back CONTRADICTED: a permanent public mark on an agent that did exactly what it said,
 * because it did what the rulebook said.
 *
 * Now the door knows the verbs this world records a deed under (`SealWorldIndex.deedVerbs`) and
 * refuses any other, in private and recoverably (A5′ / scar #8), naming the verb it should have been.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { reckoningIndex } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { DELIVERY_VERB, type Runtime } from '../../src/sim/runtime.js';
import { act, contactWorld, liveHaul, observe } from '../say/contact-fixture.js';

const PAYER = 'p:sealpayer' as PrincipalId;
const FILLER = 'p:sealfiller' as PrincipalId;

const sealed = (runtime: Runtime): number => runtime.seals.idsOf(PAYER, reckoningIndex(runtime.engine.tick)).length;

/** A live HAUL the payer holds role 0 in, and the seal row its observation offers for it. */
function holdingARole(seed: string) {
  const w = contactWorld(seed, [PAYER, FILLER]);
  liveHaul(w, PAYER, FILLER);
  const offered = observe(w.runtime, PAYER).affordances.find((a) => a.verb === 'seal');
  if (offered === undefined) throw new Error('a role holder in a LIVE venture is offered no seal');
  return { runtime: w.runtime, offered };
}

describe('★ the seal door refuses a verb no deed is recorded under', () => {
  it("refuses the rulebook's old example — `deliver` on a venture — and names `haul`", () => {
    const { runtime, offered } = holdingARole('seal-door-deliver');
    expect(offered.params['verb'], 'the offered row was already right').toBe(DELIVERY_VERB);

    const refusal = act(runtime, PAYER, 'seal', { ...offered.params, verb: 'deliver' });
    expect(refusal?.invariant, 'MUTATION: drop `deedVerbs` from the runtime and this is accepted').toBe('A5');
    expect(refusal?.hint).toMatch(/no 'deliver' deed/);
    expect(refusal?.hint).toMatch(/'haul'/);
    expect(sealed(runtime), 'nothing was sealed').toBe(0);
  });

  it('refuses any other unrecorded verb the same way', () => {
    const { runtime, offered } = holdingARole('seal-door-sign');
    expect(act(runtime, PAYER, 'seal', { ...offered.params, verb: 'sign' })?.invariant).toBe('A5');
  });

  it('accepts the row the observation offers, verbatim', () => {
    const { runtime, offered } = holdingARole('seal-door-offered');
    expect(act(runtime, PAYER, 'seal', offered.params)).toBeNull();
    expect(sealed(runtime)).toBe(1);
  });
});
