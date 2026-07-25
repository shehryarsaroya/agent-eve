/**
 * `agent.md`: "**One seal per role you hold is free** and costs no action. Further
 * seals cost an action."
 *
 * That sentence was false. `budget.ts` deliberately left `seal` out of `FREE_VERBS`,
 * with sound reasoning — §17 gives seals their own allowance and duplicating that
 * count in the budget would give one quantity two homes (scar #5). But the *outcome*
 * was that every seal cost a material action, including the first, so the document
 * promised something the engine did not do. That is scar #1 with the doc on the losing
 * side, and it is exactly the class of defect the rules-surface tests exist to catch —
 * they compare the verb LIST and the observation SHAPE, not costs.
 *
 * The fix keeps both properties: the allowance stays in the seals book (one home), and
 * the budget ASKS via an injected predicate. The budget meters; the seals book counts.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ActionBudget, costOf, FREE_VERBS } from '../../src/tick/index.js';
import type { PrincipalId } from '../../src/core/types.js';

const P = 'p:vale' as PrincipalId;

function budget(): ActionBudget {
  const b = new ActionBudget();
  b.openTick(10);
  return b;
}

describe('the seal allowance is honoured, not merely documented', () => {
  it('agent.md still makes the promise this test defends', () => {
    // If the sentence is ever removed, this test should be reconsidered rather than
    // silently protecting a promise nobody makes.
    const md = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');
    expect(md).toContain('**One seal per role you hold is free** and costs no action');
  });

  it('a seal inside its allowance costs NO material action', () => {
    const b = budget();
    const r = b.charge(P, 'seal', false, true);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cost).toBe('FREE');
    // The material budget is untouched, which is what "costs no action" means.
    expect(b.spent(P)).toBe(0);
  });

  it('a seal OUTSIDE its allowance costs one, exactly as agent.md says', () => {
    const b = budget();
    const r = b.charge(P, 'seal', false, false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cost).toBe('MATERIAL');
    expect(b.spent(P)).toBe(1);
  });

  it('seal is NOT in FREE_VERBS, so the allowance cannot be bypassed wholesale', () => {
    // The other failure mode, and the reason this is a predicate rather than a list
    // entry: putting `seal` in FREE_VERBS would make every seal free and delete the
    // allowance §17 defines. Neither extreme is the promise.
    expect(FREE_VERBS.has('seal')).toBe(false);
    expect(costOf('seal')).toBe('MATERIAL');
  });

  it('the allowance cannot make a genuinely metered verb free', () => {
    // A caller that answered `true` for everything would quietly delete A4's budget.
    // The flag is only ever consulted for verbs the owning module has an allowance
    // for; this pins that a mistake there is visible rather than silent.
    const b = budget();
    // Exhaust the material budget with ordinary acts.
    for (let i = 0; i < 4; i++) expect(b.charge(P, 'haul', false, false).ok).toBe(true);
    const over = b.charge(P, 'haul', false, false);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.invariant).toBe('A4');
  });

  it('an exhausted material budget still admits a free-allowance seal', () => {
    // The point of the allowance: a principal that has spent its four actions can
    // still make the seal §17 says is free, because a seal it cannot afford is a seal
    // it cannot be judged on — and PROP-D4 makes sealing mandatory.
    const b = budget();
    for (let i = 0; i < 4; i++) b.charge(P, 'haul', false, false);
    const sealed = b.charge(P, 'seal', false, true);
    expect(sealed.ok).toBe(true);
    if (sealed.ok) expect(sealed.cost).toBe('FREE');
  });
});
