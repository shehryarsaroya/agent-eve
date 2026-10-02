/**
 * ★ **THE MENU OFFERS WHAT AN ACT SENT NOW CAN DO — presence is read at the tick the act lands.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A hand is PRESENT from the tick after it is minted or arrives (`world/hands.ts`,
 * `ARRIVAL_IS_PRESENT_SAME_TICK = false`), and every verb checks presence at its own landing tick. The
 * menu asked at the OBSERVATION tick, one earlier, so:
 *
 *   - a hand that had just walked onto the Levy's delivery place got no `deliver` row and no standing
 *     order — on a payload whose briefing named the unpaid Levy first — while a hand-built delivery
 *     sent from that payload was ACCEPTED;
 *   - a newcomer's enrol response offered no `haul` with three hands and its goods at the holding, and
 *     its `trade` row said *"you have no hand standing at sys-01"* with all three standing there.
 *
 * The menu now asks at `tick + 1` for the Levy delivery (own, standing order and carry), `haul`, and
 * `market.at` with its trade note. Nothing the engine accepts moved: the verbs pass no `presentAt` and
 * read their own tick, exactly as before.
 *
 * (A newcomer's very first payload has no Levy row for a different and correct reason: its assessment
 * is cut at the next tick's OBLIGE, and a delivery sent from the enrol response is refused for want of
 * one. ★1b pins that, so the absence is not mistaken for this defect.)
 *
 * Mutation, run: the Levy quote's presence back at `tick` fails ★1; the haul call fails ★2; the
 * `marketView` filter fails ★3.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { afterEach, describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import { isPresent } from '../../src/world/index.js';
import { act, levyWorld, tick as levyTick, walkToPlace } from '../levy/fixture.js';
import { agent, enrol, harness, tick, type Harness } from './harness.js';

type Row = Record<string, unknown>;

let open: Harness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

const rows = (o: Row): Row[] => (o['affordances'] ?? []) as Row[];

async function newcomer(seed: string): Promise<Row> {
  const h = await harness({ seed });
  open = h;
  // A world that has run, so the enrolment tick is not tick 0 (where every clock clamps to zero and
  // the hand is present at once — the case that hid this).
  tick(h, 5);
  const res = await enrol(h, agent(`probe-${seed}`));
  expect(res.status).toBe(201);
  const hands = res.json['hands'] as Row[];
  expect(
    hands.every((x) => x['location'] === (res.json['holding'] as Row)['system']),
    'non-vacuity: the three hands stand at the holding',
  ).toBe(true);
  return res.json['observation'] as Row;
}

describe('★ a hand that has just arrived', () => {
  it('★1 is offered the Levy delivery its briefing names, and the row is accepted verbatim', () => {
    const world = levyWorld('arrived-pays', 2, 1);
    const rt = world.runtime;
    const payer = world.principals[0];
    if (payer === undefined) throw new Error('fixture');
    levyTick(rt);
    const place = walkToPlace(rt, payer);
    const hand = [...rt.world.hands.values()].find((x) => x.principal === payer && x.location === place);
    expect(hand, 'non-vacuity: a hand stands at the place').toBeDefined();
    if (hand === undefined) return;
    expect(isPresent(hand, rt.engine.tick), 'non-vacuity: it arrived THIS tick, so it is present from the next').toBe(false);
    const payload = buildObservation({
      runtime: rt,
      principal: payer,
      serverNowMs: 0,
      fresh: true,
      wakesRemaining: 9,
      stale: false,
      corrections: [],
      correctionsDropped: 0,
      actionsRemaining: 4,
    }) as unknown as Row;
    expect(String((payload['briefing'] as Row)['prompt'])).toContain('Levy');
    const deliver = rows(payload).find((a) => a['verb'] === 'deliver' && (a['params'] as Row)['obligation'] === 'LEVY');
    expect(deliver, 'the Levy row must be on the payload whose briefing names the Levy').toBeDefined();
    expect(act(rt, payer, 'deliver', deliver?.['params'] as Row), 'the menu offered it, so the engine must take it').toBeNull();
    expect(rt.levyBlockFor(payer, rt.engine.tick)?.paid).toBeGreaterThan(0);
  });
});

describe('★ a newcomer\'s first payload', () => {
  it('★1b carries no Levy row because no assessment exists yet — the correct absence', async () => {
    const first = await newcomer('first-levy');
    expect(((first['obligations'] as Row)['levy'] ?? null), 'assessed at the next tick, not this one').toBeNull();
    expect(rows(first).some((a) => a['verb'] === 'deliver')).toBe(false);
  }, 120_000);

  it('★2 offers a haul from the holding', async () => {
    const first = await newcomer('first-haul');
    expect(rows(first).some((a) => a['verb'] === 'haul'), 'goods stand at the holding with three hands').toBe(true);
  }, 120_000);

  it('★3 counts the holding as a venue it is standing in, and never says "no hand standing" there', async () => {
    const first = await newcomer('first-market');
    const at = ((first['market'] as Row)['at'] ?? []) as string[];
    expect(at.length, 'market.at must hold the venue its hands stand at').toBeGreaterThan(0);
    const withheld = String(((first['header'] as Row)['withheld'] as Row)['reason']);
    expect(withheld).not.toMatch(/you have no hand standing at/);
  }, 120_000);
});
