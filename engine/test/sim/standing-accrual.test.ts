/**
 * STANDING ACCRUES — the reputation loop fires end-to-end (Gate 3 §7, findings #7/#8).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Gate 3 run 2 confirmed the DEMAND side — every enrolled probe read
 * `counterparties[].standing` before dealing, unprompted — but could not confirm the
 * SUPPLY side. Every counterparty a probe saw read all-zero, and from a probe seat it
 * was, in the run's own words, "unresolvable ... whether accrual is even firing in the
 * deployed build." Two things made standing read zero live, and NEITHER is a claim that
 * INV-21 accrual is broken:
 *
 *   1. the world reset to tick 0 on every deploy (the heap-only substrate, now fixed by
 *      `src/persist/**`), so standing never accumulated across days;
 *   2. the no-directory design caps a probe at ~5-7 counterparties, a small sample early.
 *
 * This is the CI proof a probe could not run: drive the deterministic house cast across
 * several Reckonings and assert standing goes NON-ZERO for a real honoured elective, with
 * real value, credited across a genuinely DISTINCT counterparty — which is exactly the
 * priceable supply side AGT-E2 needs and could not see. If this ever goes green-to-red,
 * the trust market has lost its supply side and the core loop is decoration.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { Runtime } from '../../src/sim/runtime.js';
import { HeuristicCast } from '../../src/cast/index.js';
import type { Standing } from '../../src/core/types.js';

const SEED = 'standing-accrual-1';
const CAST_SIZE = 8;
/** Three Reckonings (settlements at 287, 575, 863) — enough for electives to settle thrice. */
const TICKS = 900;

function runCast(seed: string, ticks: number): Runtime {
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: CAST_SIZE });
  cast.seat(seed);
  for (let i = 0; i < ticks; i += 1) {
    for (const action of cast.decide(runtime.engine.tick + 1, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    if (report.halted) {
      throw new Error(
        `cast sim halted at tick ${String(report.tick)}: ${report.violations.map((v) => v.code).join(', ')}`,
      );
    }
  }
  return runtime;
}

function standings(runtime: Runtime): readonly Standing[] {
  return [...runtime.world.principalOrder].map((id) => runtime.standing.row(id));
}

describe('standing accrues across distinct counterparties (Gate 3 #7/#8)', () => {
  it('a real honoured elective drives standing non-zero, with value, across a distinct counterparty', () => {
    const rows = standings(runCast(SEED, TICKS));

    const honoured = rows.filter((r) => r.electiveHonoured > 0);
    expect(
      honoured.length,
      'some principal must have honoured an elective across three Reckonings — the supply side AGT-E2 needs',
    ).toBeGreaterThan(0);

    // The sharp claim: standing is not just a count. A honoured elective moved real value
    // (electiveHonouredValue) and it was credited across a genuinely distinct counterparty
    // (distinctCounterparties) — self-dealing and repeats accrue nothing (INV-21's anti-farm term).
    const priceable = honoured.filter(
      (r) => r.distinctCounterparties > 0 && (r.electiveHonouredValue as number) > 0,
    );
    expect(
      priceable.length,
      'a honoured elective must credit real value across a distinct counterparty — else the trust market has no priceable supply',
    ).toBeGreaterThan(0);
  }, 60_000);

  it('records BOTH halves honestly, so §7.6 has a real answer and not a rigged one', () => {
    const rows = standings(runCast(SEED, TICKS));
    const totalHonoured = rows.reduce((n, r) => n + r.electiveHonoured, 0);
    const totalHonouredValue = rows.reduce((n, r) => n + (r.electiveHonouredValue as number), 0);
    const totalDefaults = rows.reduce((n, r) => n + r.defaults, 0);

    // Honour must happen — that is the first test. This one exists to surface the split for
    // calibration: a cast that NEVER defaults would rig §7.6 the way the old always-honour
    // bot did, and a cast that never honours would leave the trust market empty. The appetite
    // (CAST_ELECTIVE_APPETITE_BPS) is what holds both open; the numbers are logged, not
    // hard-asserted, because the exact split is a tuning target, not an invariant.
    expect(totalHonoured).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(
      `standing after ${String(TICKS)} ticks (${String(CAST_SIZE)} cast): ` +
        `honoured=${String(totalHonoured)} (value ${String(totalHonouredValue)}), defaults=${String(totalDefaults)}`,
    );
  }, 60_000);
});
