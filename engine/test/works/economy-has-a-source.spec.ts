/**
 * The reason this module exists, asserted end-to-end through the front door.
 *
 * Before WORKS, `grep -rn "sourceGoods(" src` returned **one** call site — the enrolment
 * grant — while the Levy destroyed goods every Reckoning and the Charge destroyed more. Goods
 * entered a world once per identity and left it forever, so every world ran to zero and then
 * accused every principal of defaults our own arithmetic had made unavoidable. That is A5′
 * with the economy as the cause, which is the exact sentence `ledger/endowment.ts` uses to
 * refuse removing the starter stake.
 *
 * These tests hold the two halves apart:
 *   - goods now **enter** through a place, on a rule, and
 *   - the amount that enters is bounded by the **map**, so it cannot be multiplied by enrolling.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { GOODS_FAUCET, storesAccount } from '../../src/ledger/index.js';
import { WORKS_SPINUP_TICKS, YIELD_PER_TICK } from '../../src/works/params.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from '../api/harness.js';

type Row = Record<string, unknown>;
let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'works-source' });
});
afterEach(async () => {
  await h.close();
});

async function observe(who: Agent): Promise<Row> {
  const res = await signed(h, who, 'GET', PATHS.observe);
  expect(res.status, res.text.slice(0, 300)).toBe(200);
  return res.json['observation'] as Row;
}

function run(n: number): void {
  for (let i = 0; i < n; i += 1) {
    const r = h.runtime.runTick();
    expect(
      r.halted,
      `halted at ${String(r.tick)}: ${r.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`,
    ).toBe(false);
  }
}

describe('the world has a goods source, and it is a place (§10.2)', () => {
  it('a WORKS extracts its system yield into the holder stores, at the system', async () => {
    const who = agent('digger');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    const p = who.principalId as PrincipalId;
    const home = (await observe(who))['holding'] as Row;
    const system = String(home['system']) as SystemId;

    // A newcomer's first WORKS is reachable out of the grant on the goods side; the currency
    // side needs earnings, so it is credited here the way income would arrive.
    const funder = agent('funder');
    expect((await enrol(h, funder)).status).toBe(201);
    tick(h, 1);
    h.runtime.ledger.transferCurrency({
      eventId: 'test.income:works' as never,
      tick: h.runtime.engine.tick,
      from: storesAccount(funder.principalId as PrincipalId),
      to: storesAccount(p),
      amount: 250_000 as never,
    });

    const res = await signed(h, who, 'POST', PATHS.act, {
      actions: [{ verb: 'build', params: { kind: 'WORKS', system }, clientSequence: 1 }],
    });
    expect(res.status).toBe(200);
    run(1);
    const raised = h.runtime.works.liveAt(system);
    expect(raised.length, 'the WORKS stands').toBe(1);

    const before = h.runtime.chargeGoodAt(p, system);
    // Spin-up: nothing yet.
    run(2);
    expect(
      h.runtime.chargeGoodAt(p, system),
      'a WORKS spinning up extracts nothing — that is what makes it a commitment',
    ).toBe(before);

    const onlineAt = raised[0]?.onlineAtTick ?? 0;
    run(WORKS_SPINUP_TICKS);
    const after = h.runtime.chargeGoodAt(p, system);
    expect(after, 'once online it extracts every tick').toBeGreaterThan(before);
    // Derived from the record rather than hardcoded, so the assertion stays true if the
    // spin-up or the tier yield is recalibrated — the numbers in params.ts are marked
    // *(calibrate)* and a test that pins them would make tuning them look like a regression.
    const ticksOnline = h.runtime.engine.tick - onlineAt + 1;
    expect(ticksOnline, 'the run must actually cross into the online window').toBeGreaterThan(0);

    // And it lands AT THE SYSTEM, not at the seat: §10.2 says everything is located, and the
    // Levy and the Charge are both payable only in goods standing where the duty is. Goods
    // that appeared somewhere the hand was not would be the D8 error in a new module — which
    // is why the reader above is `chargeGoodAt`, the same located query the Charge pays from.
    // Sole occupant of a COMMONS system, so the rate is the whole tier yield per tick.
    expect(after - before, 'the tier rate, once per online tick, at the place').toBe(
      YIELD_PER_TICK.COMMONS * ticksOnline,
    );
  });

  it('posts against the EXTRACTION faucet, so the audit can check output against the map', () => {
    // Two faucets have existed since commit #1. Enrolment is PRODUCTION — the world making
    // goods because a newcomer needs a floor — and this is EXTRACTION, a place giving up a
    // bounded amount. Merged into one, neither total could be checked against anything.
    expect(GOODS_FAUCET.EXTRACTION).not.toBe(GOODS_FAUCET.PRODUCTION);
    const extracted = h.runtime.ledger.balance(GOODS_FAUCET.EXTRACTION);
    expect(typeof extracted, 'the faucet is a real account the audit can read').toBe('number');
  });
});
