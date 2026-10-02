/**
 * ★ **A GRANT BUYS NO LEVY RELIEF — EXPOSURE IS LOCKED VALUE, AND A GRANT'S `max_direct_loss` IS A
 * LIMIT** (`RULES_VERSION` 41).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * From `RULES_VERSION` 26 `Runtime.exposureOf` summed live grants' `max_direct_loss` beside the locks.
 * A grant's `max_direct_loss` is a ceiling the grantor sets on what a delegate may draw: unbounded,
 * funded by nothing, locked nowhere. And the Levy's published default, `INVERSE_EXPOSURE` — the rule
 * that applies whenever a constellation fails quorum — bills the more exposed LESS, from the
 * Reckoning's high-water mark. So one elect-only grant of 900,000,000 to a neighbour, live for two
 * ticks and never used, took its grantor's bill from 20,000 to 0 and billed the other three for it
 * (measured on the Season 1 tree by a verifier of a blind playtest: 26,667 · 26,667 · 26,666).
 *
 * The same world, twice — once with the grant, once without — must bill the grantor the same.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { Runtime } from '../../src/sim/runtime.js';
import { observe } from '../say/contact-fixture.js';

const A = 'p:galder' as PrincipalId;
const B = 'p:gbirch' as PrincipalId;
const C = 'p:gcedar' as PrincipalId;
const D = 'p:gdelegate' as PrincipalId;
const R = TICKS_PER_RECKONING;

interface Bills {
  readonly bills: ReadonlyMap<PrincipalId, number | undefined>;
  readonly exposureWhileLive: number | null;
}

function world(withGrant: boolean): Bills {
  setSpeed('instant');
  const seed = 'a-grant-buys-no-relief';
  const runtime = new Runtime({ seed });
  const stage = runtime.seatInTier('COMMONS', Rng.fromSeed(`${seed}:stage`));
  if (stage === undefined) throw new Error('the launch map has no COMMONS system');
  for (const p of [A, B, C, D]) {
    runtime.seat(p, p.replace('p:', ''), stage);
    runtime.standing.open(p);
  }
  let sequence = 1;
  const tick = (): void => {
    const report = runtime.runTick();
    if (report.halted) throw new Error(`halted at ${String(report.tick)}: ${report.violations.map((v) => v.message).join(' | ')}`);
  };
  // Inside Reckoning 2, so everyone is past the newcomer floor by the assessment the mark feeds.
  while (runtime.engine.tick < 2 * R + 20) tick();
  let exposureWhileLive: number | null = null;
  if (withGrant) {
    const outcome = runtime.engine.submit({
      principal: A,
      verb: 'grant',
      params: {
        to: D,
        template: 'treasury-hand',
        verbs: ['elect'],
        clearance: [],
        max_direct_loss: 900_000_000,
        max_contingent_liability: 0,
        expires_tick: runtime.engine.tick + 2,
      },
      clientSequence: sequence,
      arrivalMs: sequence,
      decisionSource: 'LIVE',
    });
    sequence += 1;
    if (!outcome.ok) throw new Error(`grant refused at the door: ${outcome.hint}`);
    tick();
    expect(runtime.takeCorrections(A), 'the grant itself is legal').toEqual([]);
    const grants = observe(runtime, A)['grants'] as { readonly granted: readonly unknown[] };
    expect(grants.granted, 'and it was issued').toHaveLength(1);
    exposureWhileLive = runtime.exposureOf(A);
  }
  // Past Reckoning 2's settlement and Reckoning 3's assessment, which reads Reckoning 2's mark.
  while (runtime.engine.tick < 3 * R + 5) tick();
  const bills = new Map([A, B, C, D].map((p) => [p, runtime.levyBlockFor(p)?.my_assessment]));
  return { bills, exposureWhileLive };
}

describe('★ a grant buys no Levy relief', () => {
  it('a never-used 900,000,000 grant leaves its grantor, and everyone else, billed exactly as without it', () => {
    const control = world(false);
    const treated = world(true);
    for (const p of [A, B, C, D]) {
      expect(control.bills.get(p), `${String(p)} is billed at all`).toBeGreaterThan(0);
      expect(
        treated.bills.get(p),
        `MUTATION: count grants in exposureOf again and ${String(p)}'s bill moves (the grantor's to 0)`,
      ).toBe(control.bills.get(p));
    }
    expect(treated.exposureWhileLive, 'a grant opens no lock, so it is no EXPOSURE').toBe(0);
  }, 120_000);
});
