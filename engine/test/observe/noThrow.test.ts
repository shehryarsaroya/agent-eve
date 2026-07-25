/**
 * AGT-X9 / A5-prime — **a read may never throw on a state an agent can reach.**
 *
 * `index.ts` promises it: *"Nothing here halts. `observe` is a read, not a tick phase:
 * every checker returns faults, only the `assert*` wrappers throw, and an over-budget
 * payload is returned with `fits: false` rather than refused. An agent that can make a
 * read throw has a denial-of-settlement lever (AGT-X9)."*
 *
 * That is a claim about **every** path through eight files, so it is tested the only way
 * such a claim can be: by driving one adversarial-but-legal world through every tick of
 * two Reckonings, every principal, every action and wake budget, both world statuses, and
 * a ballot whose close is behind the current tick — and asserting four things at once.
 *
 * 1. `buildObservation` returns rather than throws. There are five `throw` sites reachable
 *    from a read (`WithheldTally.rows` above its declared cap, `WithheldTally.add` on a
 *    bad count, `divCeil` on a non-integer, `verbOrder` on an unknown verb, and
 *    `canonicalize` on a float or a `Map`), and each of them turns a spent wake into a
 *    500 the agent cannot get back.
 * 2. The payload passes its own checker — so no reachable state publishes a malformed
 *    affordance, an expired option, an eleventh key or an over-budget body.
 * 3. PROP-O1's accounting balances on every draw.
 * 4. Two successive reads never move a countdown backwards (PROP-O8, scar #14d), and the
 *    free services answer with a value rather than an exception under the same states.
 *
 * The world below is deliberately awkward: a LIVE venture, a venture whose `resolvesAtTick`
 * is already behind the read, a top-yield BUILD nobody can fill, fifteen bulk ventures to
 * force the narrowing ladder, three hands loaded to `MAX_CARGO_GOODS` with goods that have
 * no mark price, a hand on a lane, an expired grant, a revoked grant, and a seizure ballot
 * the Commons floor must refuse.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { GoodId } from '../../src/core/types.js';
import { minor, qty } from '../../src/core/units.js';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import {
  ObservationCache,
  QuoteBook,
  ServiceDesk,
  buildObservation,
  checkObservation,
  countdownFaults,
  observe,
  sensingFromWorld,
} from '../../src/observe/index.js';
import { beginTransit, handsOf, loadCargo } from '../../src/world/index.js';
import {
  ALICE,
  BRAM,
  CASS,
  DOV,
  ESK,
  bookRow,
  fill,
  fixture,
  goLive,
  grantFrom,
  levyOwing,
  makeHaul,
  makeTopYield,
  sourcesFor,
  vid,
} from './fixture.js';

const CAST = [ALICE, BRAM, CASS, DOV, ESK] as const;

describe('a read never throws and never publishes a payload that fails its own checker', () => {
  it('holds across an adversarial-but-legal world, every tick of two Reckonings', () => {
    const f = fixture();
    const live = makeHaul(f, { id: vid('v-live'), creator: ALICE });
    goLive(f, live, [BRAM, CASS], minor(12_000));
    // A LIVE venture whose named resolution tick is already behind the read. Ordinary:
    // resolution happens in the Reckoning batch, not on the tick the row names.
    const past = makeHaul(f, {
      id: vid('v-past'),
      creator: DOV,
      windowOpensTick: 0,
      windowClosesTick: 2,
      resolvesAtTick: 3,
    });
    fill(f, past, 0, ESK, 1);
    makeTopYield(f, 'BUILD', vid('v-top'), CASS, 4_000);
    for (let i = 0; i < 15; i += 1) {
      makeHaul(f, {
        id: vid(`v-bulk-${String(i).padStart(2, '0')}`),
        creator: DOV,
        windowClosesTick: 200,
        resolvesAtTick: 250,
      });
    }
    // Loaded hands, with goods the fixture's `noMarks` cannot price — which is what makes
    // `move` withhold under NO_PRICE instead of quoting a number it cannot stand behind.
    const goods = ['ore', 'ice', 'alloy', 'ceramic', 'core', 'frame', 'paste', 'matrix'] as GoodId[];
    for (const hand of handsOf(f.world, ALICE)) {
      for (const good of goods) loadCargo(hand, good, qty(1_000), 1);
    }
    // A hand on a lane: present nowhere, senses nothing, and has no move to offer.
    const wander = handsOf(f.world, ESK)[2];
    const elsewhere = [...f.world.map.systemOrder].find((s) => s !== f.stage);
    if (wander !== undefined && elsewhere !== undefined) {
      expect(beginTransit(f.world.map, wander, elsewhere, 1).ok).toBe(true);
    }

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: TICKS_PER_RECKONING * 2 }),
        fc.constantFrom(...CAST),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 16 }),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom('RUNNING' as const, 'PAUSED' as const),
        fc.integer({ min: -50, max: 400 }),
        (tick, principal, actions, wakes, withLevy, isWake, status, ballotCloses) => {
          const sources = sourcesFor(f, {
            tick,
            actionsRemaining: actions,
            wakesRemaining: wakes,
            isWake,
            status,
            levy: withLevy ? levyOwing(f, 900_000_000) : null,
            market: [bookRow(f.stage, 'ore'), bookRow(f.stage, 'ice')],
            grants: [
              grantFrom({ delegate: BRAM, expiresTick: 10 }),
              grantFrom({ id: 'g-2', delegate: CASS, revokedAtTick: 5 }),
              grantFrom({ id: 'g-3', grantor: DOV, delegate: ALICE }),
            ],
            talks: [{ venture: live.id, counterparty: BRAM, unread: 3, last_tick: tick }],
            ballots: [
              { id: 'b-1', kind: 'LEVY', closes_tick: ballotCloses, voted: false, target: null },
              {
                id: 'b-2',
                kind: 'SEIZURE_BALLOT',
                closes_tick: ballotCloses,
                voted: false,
                target: BRAM,
              },
            ],
            sensing: sensingFromWorld(f.world, tick),
          });
          const where = `tick ${String(tick)} ${principal} acts=${String(actions)} ${status}`;

          const built = buildObservation(sources, principal, new QuoteBook());
          expect(checkObservation(built.observation), where).toEqual([]);
          expect(built.accounting, where).toEqual([]);

          // The wake gate, twice, so the stale path and the cache are both exercised.
          const cache = new ObservationCache();
          const first = observe(sources, principal, cache, new QuoteBook());
          const second = observe(sources, principal, cache, new QuoteBook());
          expect(checkObservation(second.observation), where).toEqual([]);
          expect(countdownFaults(first.observation, second.observation), where).toEqual([]);

          // Every free service: a value with a ground, never an exception (§12.1).
          const desk = new ServiceDesk();
          expect(desk.planHands(sources, principal)).toBeDefined();
          expect(desk.quoteVenture(sources, principal, live.id)).toBeDefined();
          expect(desk.referenceSplitOf(sources, principal, live.id)).toBeDefined();
          expect(desk.stressGrant(sources, principal, 'g-1' as never)).toBeDefined();
          expect(desk.dryRun(sources, principal, 'move', {})).toBeDefined();
          expect(desk.mandate(sources, principal)).toBeDefined();
          expect(desk.page(sources, principal, 0, 5)).toBeDefined();
        },
      ),
      { numRuns: 300 },
    );
  });
});
