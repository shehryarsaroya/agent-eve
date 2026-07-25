/**
 * Golden files for the tick.
 *
 * `TESTING.md` §16: golden files exist for "canonical serialisation, `terms_hash`,
 * affordance semantics, `agent.md`, observation shape ... **from commit #1** —
 * retrofitting them means diffing a codebase against its own bugs."
 *
 * Three surfaces are pinned here, and each is pinned for a different reason:
 *
 *   - **The phase order.** It is the rules surface. `phases.test.ts` proves it
 *     matches SPEC §15.2 today; this proves it has not moved since, which is the
 *     thing a spec-parsing test cannot see (both sides could be edited together).
 *   - **A per-tick `state_hash` sequence.** DET-1's claim is byte-identical hashes,
 *     and byte-identical to *what* only means something if the bytes are recorded.
 *     A change here is legitimate whenever a state table's capture shape changes —
 *     but it must be a deliberate act with a line in the commit message, not a
 *     silent drift.
 *   - **`INTENT_ORDER_STATEMENT`.** The sentence `agent.md` carries verbatim. Scar
 *     #1 was the engine and the agent-facing text disagreeing about one word, so
 *     the text is a golden file and the engine is checked against it.
 *
 * To regenerate deliberately: `GOLDEN_WRITE=1 npx vitest run test/tick/golden.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  Engine,
  INTENT_ORDER_STATEMENT,
  PHASES,
  STEP_BUDGET,
  stepBudgetFor,
} from '../../src/tick/index.js';
import { PROBE_VERB, moveEveryone, probeVerbs, seatWorld, submission } from './harness.js';

const GOLDEN = new URL('./golden/tick.json', import.meta.url);
const WRITE = process.env['GOLDEN_WRITE'] === '1';

interface TickGolden {
  readonly phases: readonly string[];
  readonly intentOrderStatement: string;
  readonly stepBudget: { readonly base: number; readonly perAction: number; readonly perHand: number; readonly perIntent: number };
  readonly stepBudgetSample: number;
  readonly scenario: string;
  readonly seed: string;
  readonly principals: number;
  readonly stateHashes: readonly string[];
}

/**
 * The pinned scenario. Named, per `TESTING.md` §16's "fixtures as named worlds":
 * four principals in the Commons, one move and one metered read each per tick, eight
 * ticks. No ledger, no venture, no market — DET-1 runs before any content exists.
 */
const SCENARIO = 'four_in_the_commons_eight_ticks';
const SEED = 'golden-tick-1';
const PRINCIPALS = 4;
const TICKS = 8;

function runScenario(): string[] {
  const { world, principals } = seatWorld(PRINCIPALS);
  const engine = new Engine({ world, seed: SEED, verbs: probeVerbs() });
  const hashes: string[] = [];
  for (let t = 0; t < TICKS; t += 1) {
    for (const [i, principal] of principals.entries()) {
      const move = moveEveryone(world, [principal])[0];
      if (move !== undefined) engine.submit(move);
      engine.submit(submission({ principal, verb: PROBE_VERB, clientSequence: 1 + i, params: { t } }));
    }
    const report = engine.runTick();
    if (report.halted) throw new Error(`the golden scenario halted at tick ${String(report.tick)}`);
    hashes.push(report.stateHash);
  }
  return hashes;
}

function current(): TickGolden {
  return {
    phases: [...PHASES],
    intentOrderStatement: INTENT_ORDER_STATEMENT,
    stepBudget: { ...STEP_BUDGET },
    stepBudgetSample: stepBudgetFor(4, 12, 1, 6),
    scenario: SCENARIO,
    seed: SEED,
    principals: PRINCIPALS,
    stateHashes: runScenario(),
  };
}

describe('the tick’s golden file', () => {
  it('matches, or a rules surface moved without a commit message saying so', () => {
    const now = current();
    if (WRITE) {
      writeFileSync(GOLDEN, `${JSON.stringify(now, null, 2)}\n`, 'utf8');
    }
    const pinned = JSON.parse(readFileSync(GOLDEN, 'utf8')) as TickGolden;

    // Reported field by field, because "the golden file does not match" is a useless
    // failure message on a file with four unrelated surfaces in it.
    expect(now.phases).toEqual(pinned.phases);
    expect(now.intentOrderStatement).toBe(pinned.intentOrderStatement);
    expect(now.stepBudget).toEqual(pinned.stepBudget);
    expect(now.stepBudgetSample).toBe(pinned.stepBudgetSample);
    expect(now.scenario).toBe(pinned.scenario);
    expect(now.seed).toBe(pinned.seed);
    expect(now.principals).toBe(pinned.principals);
    expect(now.stateHashes).toEqual(pinned.stateHashes);
  });

  it('the pinned scenario really advanced, so the hashes are not eight copies of nothing', () => {
    const pinned = JSON.parse(readFileSync(GOLDEN, 'utf8')) as TickGolden;
    expect(pinned.stateHashes.length).toBe(TICKS);
    expect(new Set(pinned.stateHashes).size).toBeGreaterThan(1);
    for (const hash of pinned.stateHashes) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a second run of the pinned scenario reproduces it, which is DET-1 against the file', () => {
    expect(runScenario()).toEqual(runScenario());
  });
});
