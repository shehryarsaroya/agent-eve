/**
 * A9 — the parity fuzz. SPEC §16 step 2's gating assertion.
 *
 * **The spectator filter is a strict subset of the union of the agent filters**,
 * over randomly generated event sets. Agents read the public feed, so a viewer
 * who sees a live fact that no agent's own `observe` would show is not a
 * cosmetic asymmetry — it is an exploit any agent can farm by pointing a scraper
 * at the show. That is why this is a test and not a review item.
 *
 * It is checked in the stronger form the implementation actually promises:
 * anything a viewer may read, **every** agent may read, at the **same**
 * redaction. `agentView` is built by calling `spectatorView` first, so this is a
 * regression test on that construction, and the day somebody "optimises" the two
 * filters into two independent switches it fails here rather than in production.
 *
 * Also fuzzed here, because it is the same shape of failure: no seal intent ever
 * reaches any live reader (PROP-D2), and PROP-VI1's tier readerships hold
 * generatively and not just for the five cases written down by hand.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PrincipalId, Visibility } from '../../src/core/types.js';
import {
  EventLedger,
  agentView,
  spectatorView,
  type FeedCursor,
  type NewEvent,
  type EventRecord,
} from '../../src/events/index.js';
import { partiesEvent, pid, privateEvent, publicEvent, sealedEvent, sensedEvent } from './helpers.js';

const TIERS: readonly Visibility[] = ['PUBLIC', 'PARTIES', 'SENSED', 'SEALED', 'PRIVATE'];

interface Spec {
  readonly visibility: Visibility;
  readonly tickGap: number;
  readonly declassifyGap: number;
  readonly actorIdx: number;
  readonly audienceIdx: readonly number[];
}

const specArb: fc.Arbitrary<Spec> = fc.record({
  visibility: fc.constantFrom(...TIERS),
  tickGap: fc.integer({ min: 0, max: 4 }),
  declassifyGap: fc.integer({ min: 1, max: 25 }),
  actorIdx: fc.integer({ min: 0, max: 5 }),
  audienceIdx: fc.uniqueArray(fc.integer({ min: 0, max: 5 }), { maxLength: 4 }),
});

const worldArb = fc.record({
  principalCount: fc.integer({ min: 2, max: 5 }),
  specs: fc.array(specArb, { minLength: 1, maxLength: 14 }),
  lateAdmitGap: fc.integer({ min: 0, max: 8 }),
});

type World = ReturnType<typeof buildWorld>;

/** Choose `min` or more distinct principals, deterministically. */
function chooseAudience(
  idxs: readonly number[],
  principals: readonly PrincipalId[],
  min: number,
): PrincipalId[] {
  const out: PrincipalId[] = [];
  for (const i of idxs) {
    const p = principals[i % principals.length];
    if (p !== undefined && !out.includes(p)) out.push(p);
  }
  for (const p of principals) {
    if (out.length >= min) break;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

function buildWorld(input: {
  principalCount: number;
  specs: readonly Spec[];
  lateAdmitGap: number;
}): {
  ledger: EventLedger;
  principals: readonly PrincipalId[];
  records: readonly EventRecord[];
  queryTicks: readonly number[];
} {
  const principals: PrincipalId[] = [];
  for (let i = 0; i < input.principalCount; i += 1) principals.push(pid(`p${i}`));

  const ledger = new EventLedger();
  const records: EventRecord[] = [];
  const queryTicks = new Set<number>([0]);
  let tick = 0;

  for (const spec of input.specs) {
    tick += spec.tickGap;
    const actor = principals[spec.actorIdx % principals.length] ?? principals[0];
    if (actor === undefined) continue;
    const declassifyAtTick = tick + spec.declassifyGap;
    let input2: NewEvent;
    switch (spec.visibility) {
      case 'PUBLIC':
        input2 = publicEvent({ tick, actor });
        break;
      case 'PARTIES':
        input2 = partiesEvent({
          tick,
          actor,
          family: 'neg',
          parties: chooseAudience(spec.audienceIdx, principals, 2),
          settlesAtTick: declassifyAtTick,
        });
        break;
      case 'SENSED':
        input2 = sensedEvent({
          tick,
          actor,
          inRange: chooseAudience(spec.audienceIdx, principals, 1),
          declassifyAtTick,
          payload: { good: 'ore', qty: 7 },
        });
        break;
      case 'SEALED':
        input2 = sealedEvent({
          tick,
          actor,
          revealsAtTick: declassifyAtTick,
          intent: { verb: 'RAID', target: 'gate-2' },
        });
        break;
      case 'PRIVATE':
        input2 = privateEvent({ tick, principal: actor, payload: { plan: 'defect' } });
        break;
    }
    records.push(ledger.append(input2));
    queryTicks.add(tick);
    queryTicks.add(declassifyAtTick - 1);
    queryTicks.add(declassifyAtTick);
    queryTicks.add(declassifyAtTick + 1);
  }

  // Late intel purchases, after every append so the ledger's watermark holds.
  const admitTick = ledger.lastTick + input.lateAdmitGap;
  for (const rec of records) {
    if (rec.visibility !== 'SENSED' && rec.visibility !== 'PARTIES') continue;
    const buyer = principals[principals.length - 1];
    if (buyer === undefined) continue;
    ledger.admitAudience(rec.event.id, buyer, 'INTEL', admitTick);
  }
  queryTicks.add(admitTick);
  queryTicks.add(admitTick + 1);

  const ticks = [...queryTicks].filter((t) => t >= 0).sort((a, b) => a - b);
  return { ledger, principals, records, queryTicks: ticks };
}

/** Every `(eventId, redaction)` the filter yields at this tick. */
function viewerSet(world: World, atTick: number): Set<string> {
  const out = new Set<string>();
  for (const rec of world.records) {
    const view = spectatorView(rec, atTick);
    if (view !== null) out.add(`${rec.event.id}|${view.redaction}`);
  }
  return out;
}

function agentUnion(world: World, atTick: number): Set<string> {
  const out = new Set<string>();
  for (const principal of world.principals) {
    for (const rec of world.records) {
      const view = agentView(rec, principal, atTick, world.ledger);
      if (view !== null) out.add(`${rec.event.id}|${view.redaction}`);
    }
  }
  return out;
}

/** Drain a paged feed. Bounded loop: a runaway cursor is a test failure, not a hang. */
function drain(
  page: (after: FeedCursor | null) => { views: readonly { event: { id: string }; redaction: string }[]; nextCursor: FeedCursor | null; complete: boolean },
): Set<string> {
  const out = new Set<string>();
  let cursor: FeedCursor | null = null;
  for (let guard = 0; guard < 64; guard += 1) {
    const result = page(cursor);
    for (const view of result.views) out.add(`${view.event.id}|${view.redaction}`);
    if (result.complete || result.nextCursor === null) return out;
    cursor = result.nextCursor;
  }
  throw new Error('feed paging did not terminate');
}

describe('A9 — spectator parity, fuzzed', () => {
  it('the spectator filter is a subset of the union of agent filters', () => {
    fc.assert(
      fc.property(worldArb, (input) => {
        const world = buildWorld(input);
        for (const atTick of world.queryTicks) {
          const viewers = viewerSet(world, atTick);
          const agents = agentUnion(world, atTick);
          for (const fact of viewers) {
            expect(agents.has(fact)).toBe(true);
          }
        }
      }),
      { numRuns: 250 },
    );
  });

  it('the stronger form: EVERY agent reads whatever a viewer reads, at the same redaction', () => {
    fc.assert(
      fc.property(worldArb, (input) => {
        const world = buildWorld(input);
        for (const atTick of world.queryTicks) {
          for (const rec of world.records) {
            const viewer = spectatorView(rec, atTick);
            if (viewer === null) continue;
            for (const principal of world.principals) {
              const agent = agentView(rec, principal, atTick, world.ledger);
              expect(agent).not.toBeNull();
              expect(agent?.redaction).toBe(viewer.redaction);
              expect(agent?.revealedAtTick).toBe(viewer.revealedAtTick);
            }
          }
        }
      }),
      { numRuns: 250 },
    );
  });

  it('holds through the paged feeds, not just the pure filters', () => {
    fc.assert(
      fc.property(worldArb, (input) => {
        const world = buildWorld(input);
        for (const atTick of world.queryTicks) {
          const viewers = drain((after) =>
            world.ledger.spectatorFeed({ atTick, after, limit: 6 }),
          );
          const agents = new Set<string>();
          for (const principal of world.principals) {
            for (const fact of drain((after) =>
              world.ledger.agentFeed({ principal, atTick, after, limit: 6 }),
            )) {
              agents.add(fact);
            }
          }
          for (const fact of viewers) {
            expect(agents.has(fact)).toBe(true);
          }
        }
      }),
      { numRuns: 120 },
    );
  });

  it('the subset is strict: a PRIVATE event is in the agent union and never in the viewer set', () => {
    fc.assert(
      fc.property(worldArb, (input) => {
        const world = buildWorld(input);
        const own = world.records.filter((r) => r.visibility === 'PRIVATE');
        fc.pre(own.length > 0);
        const atTick = Math.max(...world.queryTicks) + 1;
        const viewers = viewerSet(world, atTick);
        const agents = agentUnion(world, atTick);
        for (const rec of own) {
          expect(agents.has(`${rec.event.id}|FULL`)).toBe(true);
          expect(viewers.has(`${rec.event.id}|FULL`)).toBe(false);
        }
        expect(viewers.size).toBeLessThan(agents.size);
      }),
      { numRuns: 250 },
    );
  });
});

/**
 * The negative controls, and a finding worth writing down.
 *
 * **"Subset of the *union* of agent filters" does not actually bind.** Leak a
 * live `PARTIES` negotiation to viewers and the union form still passes, because
 * the two parties are agents and they can read it — the union contains it. But
 * SPEC §11.2's own sentence is "a viewer never sees a fact ahead of a
 * **non-party** agent", and that is the *intersection*: whatever a viewer may
 * read, **every** agent may read. The intersection form is the one with teeth,
 * it is what `agentView` delegating to `spectatorView` actually guarantees, and
 * it is the one these controls exercise. The union form is kept above because it
 * is the literal wording and it is cheap, not because it is sufficient.
 */
describe('the parity assertion has teeth', () => {
  /** Every agent reads whatever a viewer reads — the form that binds. */
  function intersectionHolds(
    world: World,
    atTick: number,
    viewFor: (rec: EventRecord, atTick: number) => { redaction: string } | null,
  ): boolean {
    for (const rec of world.records) {
      const viewer = viewFor(rec, atTick);
      if (viewer === null) continue;
      for (const principal of world.principals) {
        const agent = agentView(rec, principal, atTick, world.ledger);
        if (agent === null || agent.redaction !== viewer.redaction) return false;
      }
    }
    return true;
  }

  const correct = (rec: EventRecord, atTick: number): { redaction: string } | null =>
    spectatorView(rec, atTick);

  it('catches a spectator filter that leaks a live PARTIES negotiation', () => {
    // What a plausible "improvement" looks like: broadcast the negotiation while
    // it is live, because a hosted conversation is the best artifact in the
    // design. It is also an information gift to every agent with a scraper.
    const leaky = (rec: EventRecord, atTick: number): { redaction: string } | null =>
      rec.visibility === 'PARTIES' && atTick >= rec.event.tick
        ? { redaction: 'FULL' }
        : spectatorView(rec, atTick);

    const world = buildWorld({
      principalCount: 3,
      specs: [
        { visibility: 'PARTIES', tickGap: 1, declassifyGap: 20, actorIdx: 0, audienceIdx: [0, 1] },
      ],
      // p2 buys the intel at tick 6, so at tick 1 it is genuinely a non-party.
      lateAdmitGap: 5,
    });
    expect(intersectionHolds(world, 1, correct)).toBe(true);
    expect(intersectionHolds(world, 1, leaky)).toBe(false);

    // And the reason the union form is not enough: it passes either way, because
    // the two parties are themselves agents.
    const leaked = new Set<string>();
    for (const rec of world.records) {
      const view = leaky(rec, 1);
      if (view !== null) leaked.add(`${rec.event.id}|${view.redaction}`);
    }
    const union = agentUnion(world, 1);
    expect([...leaked].every((f) => union.has(f))).toBe(true);
  });

  it('catches a spectator filter that serves seal content', () => {
    const leaky = (rec: EventRecord, atTick: number): { redaction: string } | null =>
      rec.visibility === 'SEALED' && atTick >= (rec.event.declassifyAt ?? Infinity)
        ? { redaction: 'FULL' }
        : spectatorView(rec, atTick);

    const world = buildWorld({
      principalCount: 2,
      specs: [{ visibility: 'SEALED', tickGap: 0, declassifyGap: 10, actorIdx: 0, audienceIdx: [] }],
      lateAdmitGap: 0,
    });
    expect(intersectionHolds(world, 10, correct)).toBe(true);
    expect(intersectionHolds(world, 10, leaky)).toBe(false);
    // Here the union form does catch it — a viewer FULL that no agent has.
    const rec = world.records[0];
    expect(agentUnion(world, 10).has(`${rec?.event.id}|FULL`)).toBe(false);
    expect(viewerSet(world, 10).has(`${rec?.event.id}|FLAG_ONLY`)).toBe(true);
  });

  it('catches a spectator filter that serves PRIVATE reasoning', () => {
    const leaky = (rec: EventRecord, atTick: number): { redaction: string } | null =>
      rec.visibility === 'PRIVATE' ? { redaction: 'FULL' } : spectatorView(rec, atTick);

    const world = buildWorld({
      principalCount: 3,
      specs: [{ visibility: 'PRIVATE', tickGap: 0, declassifyGap: 5, actorIdx: 0, audienceIdx: [] }],
      lateAdmitGap: 0,
    });
    expect(intersectionHolds(world, 3, correct)).toBe(true);
    expect(intersectionHolds(world, 3, leaky)).toBe(false);
    const rec = world.records[0];
    expect(agentUnion(world, 3).has(`${rec?.event.id}|FULL`)).toBe(true);
    // The union form passes: the writing principal is an agent and can read it.
    // Only the intersection form sees that two other agents cannot.
  });
});

describe('PROP-D2 — no seal intent reaches any live reader, at any tier, on any delay', () => {
  it('is absent from every agent view, every viewer view, and every feed', () => {
    fc.assert(
      fc.property(worldArb, (input) => {
        const world = buildWorld(input);
        const seals = world.records.filter((r) => r.visibility === 'SEALED');
        fc.pre(seals.length > 0);
        // Well past every declassification, and past a season boundary.
        const ticks = [...world.queryTicks, Math.max(...world.queryTicks) + 288 * 8];
        for (const atTick of ticks) {
          for (const rec of seals) {
            expect(spectatorView(rec, atTick)?.event.payload['intent']).toBeUndefined();
            for (const principal of world.principals) {
              const view = agentView(rec, principal, atTick, world.ledger);
              expect(view?.event.payload['intent']).toBeUndefined();
            }
          }
        }
        // The content exists — it is simply not on a live feed. The season
        // documentary is the only reader, and it is a separate named artifact.
        const replay = world.ledger.seasonReplaySealedContent(Math.max(...world.queryTicks));
        expect(replay.length).toBe(seals.length);
        expect(replay.every((r) => r.event.payload['intent'] !== undefined)).toBe(true);
      }),
      { numRuns: 250 },
    );
  });
});

describe('PROP-VI1 — tier readership, fuzzed', () => {
  it('a principal outside the audience reads nothing before declassification', () => {
    fc.assert(
      fc.property(worldArb, (input) => {
        const world = buildWorld(input);
        for (const rec of world.records) {
          const declassifyAt = rec.event.declassifyAt;
          for (const principal of world.principals) {
            const admitted = world.ledger.admittedAtTick(rec.event.id, principal);
            const probe = declassifyAt === null ? rec.event.tick + 1 : declassifyAt - 1;
            if (probe < rec.event.tick) continue;
            const view = agentView(rec, principal, probe, world.ledger);
            const shouldRead =
              rec.visibility === 'PUBLIC' ||
              (rec.visibility !== 'SEALED' && admitted !== null && admitted <= probe);
            expect(view !== null).toBe(shouldRead);
          }
        }
      }),
      { numRuns: 250 },
    );
  });
});
