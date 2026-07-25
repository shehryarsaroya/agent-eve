/**
 * The five-tier ladder: PROP-VI1, PROP-VI3, PROP-VI4, INV-13, INV-14.
 *
 * PROP-VI1 is checked twice on purpose — table-driven here, against SPEC §11.2's
 * five rows read literally, and generatively in `parity.test.ts`. The table is
 * the readable statement of the rule; the fuzz is the one that finds the tier
 * combination nobody thought to write down.
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import {
  EventLedger,
  agentView,
  spectatorView,
  visibilityRegressions,
  type EventRecord,
  type VisibilityDescriptor,
} from '../../src/events/index.js';
import { partiesEvent, pid, privateEvent, publicEvent, sealedEvent, sensedEvent } from './helpers.js';

const A = pid('anvil');
const B = pid('bellows');
const C = pid('cinder');

/** Readership of one record, for one reader, at one tick. */
function readAs(
  ledger: EventLedger,
  rec: EventRecord,
  principal: PrincipalId,
  atTick: number,
): 'NONE' | 'FLAG_ONLY' | 'FULL' {
  const view = agentView(rec, principal, atTick, ledger);
  return view === null ? 'NONE' : view.redaction;
}

function readAsViewer(rec: EventRecord, atTick: number): 'NONE' | 'FLAG_ONLY' | 'FULL' {
  const view = spectatorView(rec, atTick);
  return view === null ? 'NONE' : view.redaction;
}

describe('PROP-VI1 — each tier\'s readership is exactly as SPEC §11.2 specifies', () => {
  it('PUBLIC: everyone now, viewers yes', () => {
    const ledger = new EventLedger();
    const rec = ledger.append(publicEvent({ tick: 4, kind: 'DEPART', actor: A }));
    expect(readAs(ledger, rec, A, 4)).toBe('FULL');
    expect(readAs(ledger, rec, C, 4)).toBe('FULL');
    expect(readAsViewer(rec, 4)).toBe('FULL');
    // Nobody reads it before it happened.
    expect(readAsViewer(rec, 3)).toBe('NONE');
  });

  it('PARTIES: the parties only, then all agents AND viewers at settlement', () => {
    const ledger = new EventLedger();
    const rec = ledger.append(
      partiesEvent({ tick: 10, parties: [A, B], settlesAtTick: 40, family: 'neg' }),
    );
    // Now.
    expect(readAs(ledger, rec, A, 10)).toBe('FULL');
    expect(readAs(ledger, rec, B, 39)).toBe('FULL');
    expect(readAs(ledger, rec, C, 39)).toBe('NONE');
    expect(readAsViewer(rec, 39)).toBe('NONE');
    // At settlement, completely, to both readerships at the same tick.
    expect(readAs(ledger, rec, C, 40)).toBe('FULL');
    expect(readAsViewer(rec, 40)).toBe('FULL');
  });

  it('SENSED: a hand in range or bought intel, then everyone after the Reckoning it mattered in', () => {
    const ledger = new EventLedger();
    const rec = ledger.append(
      sensedEvent({ tick: 6, inRange: [A], declassifyAtTick: 288, payload: { good: 'ore', qty: 40 } }),
    );
    expect(readAs(ledger, rec, A, 6)).toBe('FULL');
    expect(readAs(ledger, rec, B, 6)).toBe('NONE');
    expect(readAsViewer(rec, 287)).toBe('NONE');

    // Bought intel widens the audience, at the tick it was bought and not before.
    expect(ledger.admitAudience(rec.event.id, B, 'INTEL', 100)).toBe(true);
    expect(readAs(ledger, rec, B, 99)).toBe('NONE');
    expect(readAs(ledger, rec, B, 100)).toBe('FULL');

    expect(readAs(ledger, rec, C, 288)).toBe('FULL');
    expect(readAsViewer(rec, 288)).toBe('FULL');
  });

  it('SEALED: nobody now; the flag at the Reckoning; the content never on a live feed', () => {
    const ledger = new EventLedger();
    const rec = ledger.append(
      sealedEvent({ tick: 260, revealsAtTick: 288, intent: { verb: 'ESCORT', target: 'gate-3' }, actor: A }),
    );
    // Nobody, including the sealer: a seal is a claim about the future and
    // publishing it to an agent-readable channel is a cartel-monitoring tool.
    expect(readAs(ledger, rec, A, 287)).toBe('NONE');
    expect(readAs(ledger, rec, C, 287)).toBe('NONE');
    expect(readAsViewer(rec, 287)).toBe('NONE');

    // At its Reckoning: the flag, to both readerships, at the same redaction.
    expect(readAs(ledger, rec, C, 288)).toBe('FLAG_ONLY');
    expect(readAsViewer(rec, 288)).toBe('FLAG_ONLY');

    const flag = spectatorView(rec, 288);
    expect(Object.keys(flag?.event.payload ?? {}).sort((x, y) => (x < y ? -1 : 1))).toEqual([
      'reckoningIndex',
      'sealId',
    ]);
    expect(flag?.event.payload['intent']).toBeUndefined();

    // Forever: a much later tick still yields only the flag.
    expect(readAs(ledger, rec, A, 288 * 40)).toBe('FLAG_ONLY');
    expect(readAsViewer(rec, 288 * 40)).toBe('FLAG_ONLY');
  });

  it('PRIVATE: the principal itself, now and forever; never anyone else', () => {
    const ledger = new EventLedger();
    const rec = ledger.append(privateEvent({ tick: 2, principal: A, payload: { plan: 'defect at 280' } }));
    expect(readAs(ledger, rec, A, 2)).toBe('FULL');
    expect(readAs(ledger, rec, B, 2)).toBe('NONE');
    expect(readAs(ledger, rec, B, 288 * 100)).toBe('NONE');
    expect(readAsViewer(rec, 288 * 100)).toBe('NONE');
  });
});

describe('PROP-VI4 — PRIVATE reasoning is never published to anyone, including its own owner', () => {
  it('an OWNER reads the spectator filter, which never returns PRIVATE', () => {
    const ledger = new EventLedger();
    const rec = ledger.append(privateEvent({ tick: 1, principal: A, payload: { plan: 'x' } }));
    // SPEC §11.2: "an owner reads only what a viewer reads, plus its own agent's
    // dispatches." There is deliberately no third filter to test, because a
    // second implementation of one readership is how the two drift apart.
    for (const tick of [1, 2, 288, 288 * 8]) {
      expect(spectatorView(rec, tick)).toBeNull();
    }
  });

  it('no principal but the writer can reach it through the feed, at any tick', () => {
    const ledger = new EventLedger();
    ledger.append(privateEvent({ tick: 1, principal: A, payload: { plan: 'x' } }));
    ledger.append(publicEvent({ tick: 1 }));
    for (const tick of [1, 5, 288]) {
      const seenByB = ledger.agentFeed({ principal: B, atTick: tick, after: null, limit: 100 });
      expect(seenByB.views.some((v) => v.event.payload['plan'] !== undefined)).toBe(false);
      const seenByViewer = ledger.spectatorFeed({ atTick: tick, after: null, limit: 100 });
      expect(seenByViewer.views.some((v) => v.event.payload['plan'] !== undefined)).toBe(false);
    }
    const own = ledger.agentFeed({ principal: A, atTick: 1, after: null, limit: 100 });
    expect(own.views.some((v) => v.event.payload['plan'] === 'x')).toBe(true);
  });
});

describe('PROP-VI3 — PARTIES declassifies at settlement, completely, and is then a transcript', () => {
  const SETTLES = 40;

  function negotiation(): { ledger: EventLedger; count: number } {
    const ledger = new EventLedger();
    const lines = [
      'the escort departs at the gate',
      'I will hold the lane until you clear',
      'agreed, half escrowed',
      'you have my word on the rest',
    ];
    lines.forEach((line, i) => {
      ledger.append(
        partiesEvent({
          tick: 10 + i,
          kind: 'MESSAGE',
          family: 'neg-1',
          parties: [A, B],
          settlesAtTick: SETTLES,
          payload: { line },
        }),
      );
    });
    return { ledger, count: lines.length };
  }

  it('is invisible to a non-party and to viewers while live', () => {
    const { ledger } = negotiation();
    expect(ledger.transcript('neg-1', SETTLES - 1, { kind: 'AGENT', principal: C })).toEqual([]);
    expect(ledger.transcript('neg-1', SETTLES - 1, { kind: 'VIEWER' })).toEqual([]);
  });

  it('is complete and FULL for both readerships at settlement, in causal order', () => {
    const { ledger, count } = negotiation();
    for (const reader of [
      { kind: 'AGENT', principal: C } as const,
      { kind: 'VIEWER' } as const,
    ]) {
      const transcript = ledger.transcript('neg-1', SETTLES, reader);
      expect(transcript).toHaveLength(count);
      expect(transcript.every((v) => v.redaction === 'FULL')).toBe(true);
      // The receipt reel needs every reassuring line, in the order it was said.
      expect(transcript.map((v) => v.event.tick)).toEqual([10, 11, 12, 13]);
      expect(transcript[3]?.event.payload['line']).toBe('you have my word on the rest');
    }
  });

  it('reaches a non-party feed at settlement even though its tick is long past', () => {
    const { ledger, count } = negotiation();
    // C polls at tick 20 and holds the cursor it was given. Ordered by event
    // tick, the tick-10 messages would fall behind that cursor forever; ordered
    // by reveal they arrive at settlement, which is the point of the feed.
    const early = ledger.agentFeed({ principal: C, atTick: 20, after: null, limit: 50 });
    expect(early.views).toEqual([]);
    const late = ledger.agentFeed({
      principal: C,
      atTick: SETTLES,
      after: early.nextCursor,
      limit: 50,
    });
    expect(late.views).toHaveLength(count);
    expect(late.views.every((v) => v.revealedAtTick === SETTLES)).toBe(true);
  });

  it('a party sees each message once — when it was said, not again at settlement', () => {
    const { ledger, count } = negotiation();
    const live = ledger.agentFeed({ principal: A, atTick: 13, after: null, limit: 50 });
    expect(live.views).toHaveLength(count);
    const after = ledger.agentFeed({
      principal: A,
      atTick: SETTLES,
      after: live.nextCursor,
      limit: 50,
    });
    expect(after.views).toEqual([]);
  });
});

describe('INV-14 — visibility is monotonic', () => {
  const base: VisibilityDescriptor = {
    visibility: 'PARTIES',
    isPublic: false,
    publicAt: 40,
    declassifyAt: 40,
    audience: [A, B],
  };

  it('accepts an audience that grows', () => {
    expect(visibilityRegressions(base, { ...base, audience: [A, B, C] })).toEqual([]);
  });

  it('rejects an audience that shrinks', () => {
    expect(visibilityRegressions(base, { ...base, audience: [A] })).toEqual([
      'audience lost bellows; rows are added, never removed',
    ]);
  });

  it('rejects declassifyAt moving earlier — a release pulled forward is a leak', () => {
    expect(visibilityRegressions(base, { ...base, publicAt: 20, declassifyAt: 20 })).toHaveLength(2);
  });

  it('rejects declassifyAt moving later — it un-publishes a fact somebody read', () => {
    expect(visibilityRegressions(base, { ...base, publicAt: 99, declassifyAt: 99 })).toHaveLength(2);
  });

  it('rejects a cancelled declassification, and a tier change', () => {
    expect(
      visibilityRegressions(base, { ...base, publicAt: null, declassifyAt: null }),
    ).toHaveLength(2);
    expect(visibilityRegressions(base, { ...base, visibility: 'PRIVATE' })).toContain(
      'visibility changed PARTIES -> PRIVATE',
    );
  });

  it('rejects a public event becoming private', () => {
    const wasPublic: VisibilityDescriptor = {
      visibility: 'PUBLIC',
      isPublic: true,
      publicAt: 3,
      declassifyAt: 3,
      audience: [],
    };
    const regressions = visibilityRegressions(wasPublic, { ...wasPublic, isPublic: false });
    expect(regressions).toContain('isPublic changed true -> false');
  });

  it('holds across a real sequence of appends and admissions', () => {
    const ledger = new EventLedger();
    const rec = ledger.append(sensedEvent({ tick: 1, inRange: [A], declassifyAtTick: 288 }));
    const before = ledger.describe(rec.event.id);
    ledger.admitAudience(rec.event.id, B, 'INTEL', 50);
    ledger.admitAudience(rec.event.id, C, 'IN_RANGE', 60);
    const after = ledger.describe(rec.event.id);
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(visibilityRegressions(before!, after!)).toEqual([]);
    expect(after!.audience).toEqual([A, B, C].sort((x, y) => (x < y ? -1 : 1)));
  });
});
