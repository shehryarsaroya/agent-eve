/**
 * LEGAL BUT UNOFFERED — the defect class a probe agent found by playing, and the one that had
 * already caught `graduate`, `build {WORKS}` and `assure` one at a time.
 *
 * `agent.md` §6 promises `affordances[]` is *"everything you can legally do right now"* and that
 * *"we never truncate this list — if something was left out you get a `withheld` count and a
 * reason."* Measured across 900 ticks and eight principals, **14 of 28 live verbs never appeared in
 * any affordance**, and `withheld` explained none of them.
 *
 * Four were then called directly and checked AFTER the tick — which matters, because `act` returns
 * `accepted` for *submission*, and the verdict only lands in `briefing.corrections[]` a tick later.
 * Measuring the response alone says "accepted" for an action the engine is about to refuse. All
 * four EXECUTED:
 *
 *     vote     {ballot: LEVY, rule: EVEN}   offered=false  -> EXECUTED
 *     deliver  {obligation: LEVY, amount}   offered=false  -> EXECUTED
 *     grant    {to, template, caps, expiry} offered=false  -> EXECUTED   <- the A6 core loop
 *     set_delivery_intent {intent, until}   offered=false  -> EXECUTED
 *
 * The Charge got affordances when sovereignty landed; the Levy never did. A14 says the Levy is
 * scheduled and cannot be dodged into quiet — it was being dodged by ignorance. And `grant` had no
 * affordance code at all, while the cast prompt tells a player *"the safest plan is built from
 * entries in affordances[]"*. The live world showed the consequence: `authorityLines: 0` on the
 * published frame, a core loop that had never run through the front door.
 *
 * This file guards the three that are now offered. `set_delivery_intent` is still unoffered and is
 * named here so the gap is recorded rather than forgotten.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import { buildObservation, MAX_GRANT_OFFERS } from '../../src/api/observe.js';
import { Runtime } from '../../src/sim/runtime.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from './harness.js';

type Row = Record<string, unknown>;
let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'legal-but-unoffered' });
});
afterEach(async () => {
  await h.close();
});

async function observe(who: Agent): Promise<Row> {
  const res = await signed(h, who, 'GET', PATHS.observe);
  expect(res.status, res.text.slice(0, 300)).toBe(200);
  return res.json['observation'] as Row;
}

function affordance(o: Row, verb: string): Row | undefined {
  return ((o['affordances'] ?? []) as readonly Row[]).find((a) => String(a['verb']) === verb);
}

describe('the Levy is on the menu, because A14 says it cannot be dodged into quiet', () => {
  it('offers `deliver` when an assessment is payable, and the offered params are ACCEPTED', async () => {
    const who = agent('levy-payer');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 3);

    const o = await observe(who);
    // Non-vacuity: there must really be something owed, or "offered" proves nothing.
    const levy = ((o['obligations'] ?? {}) as Row)['levy'] as Row;
    expect(levy, 'no Levy block, so this test would prove nothing').toBeDefined();
    expect(Number(levy['shortfall_if_unpaid']), 'nothing owed').toBeGreaterThan(0);

    // Matched on `obligation`, not on the verb alone: `deliver` discharges two obligations and a
    // bare lookup takes whichever the ranking put first.
    const offer = ((o['affordances'] ?? []) as readonly Row[]).find(
      (a) => String(a['verb']) === 'deliver' && (a['params'] as Row)['obligation'] === 'LEVY',
    );
    expect(offer, 'a payable Levy must offer the verb that pays it').toBeDefined();

    // The menu must not offer an act the engine refuses — that costs a real action. So the offered
    // params are replayed verbatim rather than reconstructed.
    const res = await signed(h, who, 'POST', PATHS.act, {
      actions: [{ verb: 'deliver', params: offer?.['params'], clientSequence: 1 }],
    });
    expect(res.status).toBe(200);
    tick(h, 2);
    const after = await observe(who);
    const refused = (((after['briefing'] as Row)['corrections'] ?? []) as readonly Row[]).filter(
      (c) => String(c['verb']) === 'deliver',
    );
    expect(
      refused,
      `the menu offered an act the engine then refused: ${JSON.stringify(refused).slice(0, 300)}`,
    ).toEqual([]);
  });

  it('offers `vote` while the ballot is open and uncast, and stops once cast', async () => {
    const who = agent('levy-voter');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 3);

    const o = await observe(who);
    const ballot = (((o['obligations'] ?? {}) as Row)['levy'] as Row)['ballot'] as Row | null;
    expect(ballot, 'no open ballot, so this test would prove nothing').not.toBeNull();
    expect(ballot?.['voted']).toBe(false);

    const offer = affordance(o, 'vote');
    expect(offer, 'an open uncast ballot must offer the vote').toBeDefined();
    expect(offer?.['cost'], 'a ballot is free — it must not cost an action').toBe(0);

    const res = await signed(h, who, 'POST', PATHS.act, {
      actions: [{ verb: 'vote', params: offer?.['params'], clientSequence: 1 }],
    });
    expect(res.status).toBe(200);
    tick(h, 2);

    const after = await observe(who);
    const refused = (((after['briefing'] as Row)['corrections'] ?? []) as readonly Row[]).filter(
      (c) => String(c['verb']) === 'vote',
    );
    expect(refused, 'the offered ballot params were refused').toEqual([]);
    // Cast once, gone from the menu: an affordance for an act that would now be refused is the
    // same defect pointing the other way.
    expect(
      affordance(after, 'vote'),
      'a ballot already cast must leave the menu',
    ).toBeUndefined();
  });
});

describe('the A6 core loop reaches the menu, and only after trust is earned', () => {
  it('offers `grant` once a counterparty has KEPT a promise, never before', () => {
    // Runtime-level: a kept promise requires a settled venture, so this needs a Reckoning to pass.
    setSpeed('instant');
    const seed = 'grant-affordance';
    const rt = new Runtime({ seed });
    const cast = new HeuristicCast(rt, { size: 8 });
    cast.seat(seed);

    let firstOfferTick: number | null = null;
    let sample: Row | null = null;
    let maxKept = 0;
    /** Every offer seen, paired with the record that was supposed to justify it. */
    let offersChecked = 0;
    const strangers: string[] = [];
    for (let i = 0; i < 900; i += 1) {
      const target = rt.engine.tick + 1;
      for (const a of cast.decide(target, seed)) rt.engine.submit(a);
      const r = rt.runTick();
      expect(r.halted, `halted at ${String(r.tick)}`).toBe(false);
      if (i % 10 !== 0) continue;
      for (const m of cast.roster) {
        const relations = rt.relationsFor(m.principal, 64);
        for (const rel of relations) maxKept = Math.max(maxKept, rel.kept);
        const o = buildObservation({
          runtime: rt,
          principal: m.principal,
          serverNowMs: 0,
          fresh: true,
          wakesRemaining: 9,
          stale: false,
          corrections: [],
          correctionsDropped: 0,
          actionsRemaining: 4,
        }) as unknown as Row;
        const offers = ((o['affordances'] ?? []) as readonly Row[]).filter(
          (a) => String(a['verb']) === 'grant',
        );
        expect(
          offers.length,
          'the office menu must stay inside its published cap',
        ).toBeLessThanOrEqual(MAX_GRANT_OFFERS);
        // THE GATE, CHECKED ON THE OFFER ITSELF. An earlier version asserted only that no grant
        // appeared before the first Reckoning, and deleting the `kept > 0` gate left it GREEN —
        // because a relation row does not exist until the two have dealt, so the timing held either
        // way. The assertion described the gate without touching it.
        for (const offer of offers) {
          offersChecked += 1;
          const to = String((offer['params'] as Row)['to']);
          const record = relations.find((r) => String(r.other) === to);
          if (record === undefined || record.kept <= 0) {
            strangers.push(`${String(m.principal)} -> ${to} (kept ${String(record?.kept ?? 0)})`);
          }
        }
        if (offers.length > 0 && firstOfferTick === null) {
          firstOfferTick = rt.engine.tick;
          sample = offers[0] as Row;
        }
      }
    }

    // Non-vacuity: promises must actually have been kept, or "offered" would be untested.
    expect(maxKept, 'no promise was ever kept, so the gate was never exercised').toBeGreaterThan(0);
    expect(
      firstOfferTick,
      'the A6 core loop must reach the affordance list — it had no affordance at all, and the live ' +
        'world published `authorityLines: 0` as a result',
    ).not.toBeNull();
    expect(offersChecked, 'no offer was ever inspected, so the gate is untested').toBeGreaterThan(0);
    expect(
      strangers.slice(0, 5),
      'an office was offered to a counterparty that has kept nothing. A6 is trust earned over ' +
        'months and then handed authority it could abuse — offered to a stranger it is a handout, ' +
        'and the receipt reads as one at settlement.',
    ).toEqual([]);
    // Corroboration, not the gate: a relation row does not exist before the two have dealt, so this
    // would hold even with the gate removed. Kept because it pins the ARC — the first office in a
    // world cannot predate the first settlement.
    expect(Number(firstOfferTick)).toBeGreaterThanOrEqual(TICKS_PER_RECKONING);

    const params = sample?.['params'] as Row;
    expect(params['template'], 'a receipt should read as an office, not a raw limit pair').toBe(
      'treasury-hand',
    );
    expect(Number(params['max_direct_loss']), 'the cap must be a real number').toBeGreaterThan(0);
    // Scar #7, the sticky vow: a short life is what makes each renewal a decision.
    expect(Number(params['expires_tick']) - Number(firstOfferTick)).toBe(TICKS_PER_RECKONING);
    expect(
      String(sample?.['what_it_forecloses']),
      '§8 requires the record that justifies the office to be shown with it',
    ).toMatch(/kept/);
  }, 120_000);
});
