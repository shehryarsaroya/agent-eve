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

    // ── MEASURED IN THE RAW YIELD, NOT THE PAYABLE GOOD ──────────────────────
    //
    // This read `chargeGoodAt` — rations — and it was right until §10's production graph landed. A
    // WORKS now yields `ore`, and nothing about extraction produces rations any more, so the old
    // assertion compared 45,000 against 45,000 and failed. It was detecting the change correctly.
    //
    // Measured through `refinableAt`, which is the same accessor the verb, the affordance and the cast
    // all read — so this test cannot pass on a quantity the engine would refuse to refine.
    const before = h.runtime.refinableAt(p, system);
    // Spin-up: nothing yet.
    run(2);
    expect(
      h.runtime.refinableAt(p, system),
      'a WORKS spinning up extracts nothing — that is what makes it a commitment',
    ).toBe(before);

    const onlineAt = raised[0]?.onlineAtTick ?? 0;
    run(WORKS_SPINUP_TICKS);
    const after = h.runtime.refinableAt(p, system);
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

    // ── AND THE CHAIN'S SECOND HALF, BECAUSE ORE PAYS NOTHING ─────────────────
    //
    // The economy having "a source" is only true if the source produces something an obligation can be
    // settled with. Ore settles nothing — not the Levy, not a Charge, not a WORKS build — so a test
    // that stopped at extraction would be asserting a faucet into a dead end.
    const rationsBefore = h.runtime.chargeGoodAt(p, system);
    const refined = await signed(h, who, 'POST', PATHS.act, {
      actions: [{ verb: 'refine', params: { system }, clientSequence: 2 }],
    });
    expect(refined.status).toBe(200);
    run(1);
    expect(
      h.runtime.chargeGoodAt(p, system),
      'refine must turn extracted ore into the good every obligation is payable in',
    ).toBeGreaterThan(rationsBefore);
    expect(
      h.runtime.refinableAt(p, system),
      'and the ore it consumed must be gone — goods are transformed, not duplicated (INV-1)',
    ).toBeLessThan(after);
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

describe('a fresh enrolment can reach its first WORKS (the reachability property)', () => {
  /**
   * The property this file exists to protect, and the one the first version broke.
   *
   * The build gated on `freeCash`, reasoning that free enrolment must not buy permanent income.
   * Measured on the live world, `worksAffordableBy` read **0 of 21** — the floor withholds the
   * whole starter stake, and a principal that has graduated has less free than the floor. The
   * economy's only faucet was correct, tested, offered and rendered, and no principal could
   * ever build one.
   *
   * The gate was also the wrong reading of D7, whose rule is that the endowment cannot **leave**
   * a principal. A WORKS build retires the money into `sink:upkeep` — destroyed, paid to nobody
   * — so a puppet gains its operator nothing here. The exploit that remains (extract, then sell)
   * is bounded by the map, which was always the real defence.
   *
   * A test that only checked "a funded principal can build" would have passed the whole time.
   * This one starts from nothing but an enrolment.
   */
  it('with no income at all, only the grant', async () => {
    const who = agent('bootstrap');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    const p = who.principalId as PrincipalId;

    // Nothing has been earned. This is the exact state every principal is in at minute one.
    const obs = await observe(who);
    const system = String((obs['holding'] as Row)['system']) as SystemId;
    const quote = h.runtime.worksQuote(p, system);
    expect(quote.affordable, 'the grant alone must cover the first WORKS').toBe(true);
    const offer = (obs['affordances'] as Row[]).find(
      (a) => a['verb'] === 'build' && (a['params'] as Row)['kind'] === 'WORKS',
    );
    expect(offer, 'a newcomer with only its grant must be OFFERED its first WORKS').toBeDefined();

    const res = await signed(h, who, 'POST', PATHS.act, {
      actions: [{ verb: 'build', params: offer?.['params'], clientSequence: 1 }],
    });
    expect(res.status).toBe(200);
    run(1);
    expect(
      h.runtime.takeCorrections(p).map((c) => c.hint),
      'and taking it must not be refused',
    ).toEqual([]);
    expect(h.runtime.worksOf(p).length, 'the WORKS stands').toBe(1);
  });

  it('but the grant still cannot buy a claim from another principal', async () => {
    // The distinction that makes the change principled rather than a relaxation: retirement is
    // not transfer. `cession-endowment.spec.ts` holds the other side of this in full.
    const { freeCash } = await import('../../src/market/escrow.js');
    const who = agent('nontransferor');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    expect(
      freeCash(h.runtime.ledger, who.principalId as PrincipalId),
      'nothing the grant contains may be paid to another principal',
    ).toBe(0);
  });
});
