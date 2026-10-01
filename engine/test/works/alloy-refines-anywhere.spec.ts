/**
 * ★ ALLOY REFINES ANYWHERE, AT THE TIER'S RATE — and every refusal now says so.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A blind playtest sent `refine {"kind":"ALLOY"}` at a MARCHES system and got refusal text that
 * contradicted `agent.md` §7, §11A and its own menu. The engine was right — `ALLOY_IN_BY_TIER` is a
 * price gradient (COMMONS 8:1 · MARCHES 32:1 · FRONTIER 64:1), not a wall — and three agent-facing
 * strings still described the wall that was measured, deadlocked and removed:
 *
 *   - the unknown-kind refusal: *"ALLOY is 8 ore for 1 alloy and runs ONLY at a COMMONS system"*;
 *   - the `build ANCHOR` refusal: *"can only be refined at a COMMONS system — … so no amount of ore
 *     here becomes any"* — the one a MARCHES claimant actually hits;
 *   - `agent.md` §11A: *"only the Commons refines it"*, pinned by a test, on the wrong version.
 *
 * Text only: each refusal returns before any posting, and the recipe the engine runs is untouched.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { qty } from '../../src/core/units.js';
import { GOODS_FAUCET, storesAccount } from '../../src/ledger/index.js';
import { Runtime, type PendingCorrection } from '../../src/sim/runtime.js';
import { ANCHOR_QTY, CHARGE_GOOD } from '../../src/sovereignty/index.js';
import { ALLOY_ANCHOR_QTY, ALLOY_IN_BY_TIER, WORKS_YIELD_GOOD } from '../../src/works/params.js';
import { tierRates } from '../../src/works/refine.js';

const WHO = 'p:assayer' as PrincipalId;

function marchesWorld(seed: string): { runtime: Runtime; system: SystemId } {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const system = [...runtime.world.map.systems.values()]
    .filter((s) => s.tier === 'MARCHES')
    .map((s) => s.id)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];
  if (system === undefined) throw new Error('the launch map has no MARCHES system');
  runtime.seat(WHO, 'assayer', system);
  runtime.standing.open(WHO);
  runtime.runTick();
  return { runtime, system };
}

function stock(runtime: Runtime, system: SystemId, good: string, amount: number): void {
  runtime.ledger.sourceGoods({
    eventId: `fixture:stock:${good}:${String(amount)}:${String(runtime.engine.tick)}` as never,
    tick: runtime.engine.tick,
    faucet: GOODS_FAUCET.EXTRACTION,
    to: storesAccount(WHO),
    good: good as never,
    qty: qty(amount),
    location: system,
    origin: WHO,
  });
}

function act(runtime: Runtime, verb: string, params: Record<string, unknown>): PendingCorrection | null {
  const outcome = runtime.engine.submit({ principal: WHO, verb, params, clientSequence: 0, arrivalMs: 0, decisionSource: 'LIVE' });
  if (!outcome.ok) throw new Error(`submit ${verb}: ${outcome.invariant} ${outcome.hint}`);
  const report = runtime.runTick();
  if (report.halted) throw new Error(`halted at ${String(report.tick)}`);
  return runtime.takeCorrections(WHO)[0] ?? null;
}

describe('ALLOY at a MARCHES system — refused only for the real reason, and made when the ore is there', () => {
  it('★ short of the MARCHES rate: refused, naming the rate table; with the ore: made, right there', () => {
    const { runtime, system } = marchesWorld('alloy-marches');
    stock(runtime, system, WORKS_YIELD_GOOD, ALLOY_IN_BY_TIER.MARCHES - 1);
    const short = act(runtime, 'refine', { kind: 'ALLOY', system, qty: 1 });
    expect(short, 'one unit short of the MARCHES rate must be refused').not.toBeNull();
    expect(short?.hint).toContain(`MARCHES ${String(ALLOY_IN_BY_TIER.MARCHES)}:1`);
    expect(short?.hint).not.toMatch(/ONLY at a|can only be refined/);

    stock(runtime, system, WORKS_YIELD_GOOD, ALLOY_IN_BY_TIER.MARCHES + 1);
    expect(act(runtime, 'refine', { kind: 'ALLOY', system, qty: 2 }), 'two units at 32:1 from 64 ore').toBeNull();
    expect(runtime.alloyAt(WHO, system)).toBe(2);
  });

  it('★ an unknown kind is refused with the rates the engine runs, not a tier ban', () => {
    const { runtime } = marchesWorld('alloy-typo');
    const refusal = act(runtime, 'refine', { kind: 'ALOY' });
    expect(refusal?.hint).toContain('refine has no kind "ALOY"');
    expect(refusal?.hint).toContain(tierRates());
    expect(refusal?.hint, 'the ban that does not exist').not.toContain('ONLY at a');
  });

  it('★ build ANCHOR short of alloy at MARCHES prices the local refine instead of calling it impossible', () => {
    const { runtime, system } = marchesWorld('alloy-anchor');
    // The ration half is there, so the refusal reached is the alloy half's.
    stock(runtime, system, CHARGE_GOOD, ANCHOR_QTY);
    const refusal = act(runtime, 'build', { kind: 'ANCHOR', system });
    expect(refusal, 'non-vacuity: an anchor with no alloy must be refused').not.toBeNull();
    expect(refusal?.hint).toContain(`${String(ALLOY_ANCHOR_QTY)} units of alloy`);
    expect(refusal?.hint).not.toContain('no amount of ore here becomes any');
    expect(refusal?.hint).not.toContain('can only be refined');
    expect(refusal?.hint, 'and it prices the refine where the claimant stands').toContain(
      `${String(ALLOY_ANCHOR_QTY * ALLOY_IN_BY_TIER.MARCHES)} ${WORKS_YIELD_GOOD}`,
    );
  });
});
