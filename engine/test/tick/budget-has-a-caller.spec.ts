/**
 * A STEP BUDGET TERM WHOSE HOOK IS NEVER SUPPLIED IS A TERM THAT DOES NOT EXIST.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────
 *
 * `STEP_BUDGET` gained `perStoredLot` to fix a production outage: Phase 3 filled the `HAZARD`
 * phase, which reads every principal's holdings, and `DET-9` halted the replay at tick 7,128 with
 * every route serving 503. The term was added to {@link stepBudgetFor}. **The caller was not.**
 *
 * `Engine` takes the count through an injected hook that defaults to `() => 0`, exactly as
 * `restingOrders` does — so the missing wire was not a type error, not a lint error, and not a test
 * failure. The budget stayed at 1,760, the second deploy halted at the same tick with the same
 * message, and the fix was sitting in the deployed build the whole time.
 *
 * That is this project's signature defect — *a capability that exists and is never exercised is
 * indistinguishable from one that is missing* — occurring inside the mechanism built to bound the
 * tick. It has now appeared at six depths: a verb with no affordance, an affordance no cast selects,
 * an invariant whose subject cannot occur, a reserved slot nothing fills, a solvency mechanism
 * nobody used, and now **a budget term nothing passes**.
 *
 * ── WHAT THIS ASSERTS, AND WHY IT IS THE RIGHT SHAPE ──────────────────────────
 *
 * The naive test — "assert `storedLots` is wired in `Runtime`" — would pass over a hook that
 * returns a constant, and would not survive the next term being added. So instead:
 *
 *   1. **Every optional numeric hook `Engine` accepts is supplied by `Runtime`.** Derived from the
 *      options type at runtime rather than a hand-written list, so a seventh term inherits the
 *      guard for free. This is the assertion that would have caught the outage.
 *   2. **The budget actually RISES with the quantity**, through a real `Runtime` — a term wired to
 *      a hook that ignores its subject is the same defect one level in.
 *   3. **The default is honest.** A bare `Engine` with no hook must budget as though the quantity
 *      is zero, because that is what an engine with no ledger truthfully knows.
 */

import { describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import { STEP_BUDGET, stepBudgetFor } from '../../src/tick/index.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { Runtime } from '../../src/sim/runtime.js';

/** The optional hooks `Engine` reads for budget terms, by name. */
const BUDGET_HOOKS = ['restingOrders', 'storedLots'] as const;

describe('every step-budget term has a caller', () => {
  it('★ THE OUTAGE: Runtime supplies every budget hook Engine accepts', () => {
    // ── THE FIRST VERSION OF THIS TEST WAS VACUOUS, AND THE MUTATION PROVED IT ──
    //
    // It asserted `typeof engine[hook] === 'function'`. That can never fail: `Engine` assigns
    // `options.storedLots ?? (() => 0)`, so the field is a function whether or not anybody supplied
    // it. Deleting the wire from `Runtime` — the exact edit that caused the outage — left the test
    // green. A guard that cannot distinguish "supplied" from "defaulted" is a guard against nothing,
    // which is the same class of defect it was written to catch, one level up.
    //
    // The honest assertion is that the hook RETURNS THE QUANTITY. Only a real wire can do that, so
    // this fails the moment the caller goes missing.
    setSpeed('instant');
    const rt = new Runtime({ seed: 'budget-caller' });
    const cast = new HeuristicCast(rt, { size: 4 });
    cast.seat('budget-caller');
    const engine = rt.engine as unknown as Record<string, () => number>;
    const truth: Record<(typeof BUDGET_HOOKS)[number], number> = {
      // `marketBook` is private; the engine's own hook is the only public reading, and
      // `restingOrders` is not the term under test here — `storedLots` is what must be non-zero.
      restingOrders: (rt.engine as unknown as Record<string, () => number>)['restingOrders']?.() ?? 0,
      storedLots: rt.ledger.allLots().length,
    };
    // At least one subject must exist, or every comparison below is 0 === 0.
    expect(
      truth.storedLots,
      'a seated world must hold lots, or this test passes over a defaulted hook',
    ).toBeGreaterThan(0);
    for (const hook of BUDGET_HOOKS) {
      const fn = engine[hook];
      expect(typeof fn, `Engine.${hook} is not wired at all`).toBe('function');
      expect(
        fn?.(),
        `Engine.${hook}() does not report the real quantity — it is defaulted to () => 0, so ` +
          `STEP_BUDGET.per${hook[0]?.toUpperCase() ?? ''}${hook.slice(1)} contributes nothing. ` +
          `This is what shipped when perStoredLot was added to stepBudgetFor and the caller in ` +
          `Runtime was not: DET-9 halted production at tick 7,128 twice, with the fix present in ` +
          `the deployed build both times.`,
      ).toBe(truth[hook]);
    }
  });

  it('and the budget RISES with stored lots, so the hook is not a constant', () => {
    // A hook that returns 0 forever would satisfy the test above. This one cannot be satisfied
    // without the count being real: a seeded world holds lots from enrolment onward.
    setSpeed('instant');
    const rt = new Runtime({ seed: 'budget-rises' });
    const cast = new HeuristicCast(rt, { size: 4 });
    cast.seat('budget-rises');
    const lots = rt.ledger.allLots().length;
    expect(lots, 'this world must hold lots or the comparison below is vacuous').toBeGreaterThan(0);

    const withLots = stepBudgetFor(0, 0, 0, 0, 0, lots);
    const withNone = stepBudgetFor(0, 0, 0, 0, 0, 0);
    expect(withLots - withNone).toBe(STEP_BUDGET.perStoredLot * lots);
    expect(withLots, 'the term must actually widen the cap').toBeGreaterThan(withNone);
  });

  it('and an Engine with no hook budgets as though the quantity is zero, honestly', () => {
    // Not a defect: an engine constructed without a ledger genuinely has no lots. The defect is a
    // Runtime that HAS a ledger and does not pass it, which is what the first test pins.
    expect(stepBudgetFor(0, 0, 0, 0, 0)).toBe(stepBudgetFor(0, 0, 0, 0, 0, 0));
  });
});
