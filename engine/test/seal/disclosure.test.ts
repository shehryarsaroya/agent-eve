/**
 * PROP-D2 — **agents receive `HONOURED | CONTRADICTED` and nothing else, ever, at
 * any tier, on any delay.**
 *
 * This is the prohibition with no exceptions, and wave 1 found it escaping through
 * an unchecked caller-supplied allow-list on the events side. So this suite tests
 * the boundary from both directions:
 *
 * - the **shape** direction: the only agent-facing projection has four keys, and
 *   fuzzing the record's content cannot change them;
 * - the **route** direction: the seal's events, appended to a real `EventLedger`
 *   and read back through the real filters at every tick from the seal to the end
 *   of the season, never yield intent or prose to anybody — and a hand-rolled event
 *   that tries to widen the allow-list is refused by the ledger.
 *
 * `AGT-X4`'s cartel probe asserts the same thing from the outside: three probes
 * with a shared brief must not be able to use seal verdicts to monitor each other.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compareIds } from '../../src/ledger/order.js';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import { EventLedger, EventLedgerError, SEAL_FLAG_KEYS } from '../../src/events/index.js';
import {
  SEAL_DISCLOSURE_KEYS,
  SealBook,
  SealDisclosureError,
  agentSealDisclosure,
  sealCommitEvent,
  sealProjectionLeaks,
  sealVerdictEvent,
  seasonReplaySealContent,
  settlementTickOf,
  viewerSealDisclosure,
  type SealAuditRecord,
} from '../../src/seal/index.js';
import { deed, intent, pid, role, settlement } from './helpers.js';

const AUTHOR = pid('P-VEX');
const STRANGER = pid('P-HALCYON');
const SEAL_TICK = 100;
const SEASON_CLOSES = 20 * TICKS_PER_RECKONING;

interface Built {
  readonly book: SealBook;
  readonly rec: SealAuditRecord;
}

function build(prose: string, outcome: number, target = 'SYS-VEGA'): Built {
  const book = new SealBook();
  const held = [role('V-1')];
  const accepted = book.commit({
    principal: AUTHOR,
    tick: SEAL_TICK,
    actedOnStateVersion: 100,
    intent: intent({ target }),
    prose,
    role: held[0] ?? null,
    rolesHeld: held,
  });
  if (!accepted.ok) throw new Error(accepted.hint);
  book.resolve({
    reckoningIndex: 0,
    atTick: settlement(0),
    stateVersion: 400,
    deeds: [deed({ principal: AUTHOR, outcome, target })],
  });
  const rec = book.auditRecord(accepted.value.sealId);
  if (rec === null) throw new Error('no record');
  return { book, rec };
}

describe('PROP-D2 — the shape an agent gets', () => {
  it('is exactly four keys, and they are the flag plus its identity', () => {
    expect([...SEAL_DISCLOSURE_KEYS]).toEqual([
      'sealId',
      'reckoningIndex',
      'principal',
      'verdict',
    ]);
    const { rec } = build('I will hold the line at Vega.', 50);
    expect(Object.keys(agentSealDisclosure(rec)).sort(compareIds)).toEqual([...SEAL_DISCLOSURE_KEYS].sort(compareIds));
  });

  it('carries no intent, no prose, no basis and no cited deed', () => {
    const { rec } = build('I will hold the line at Vega.', 5);
    const disclosure = agentSealDisclosure(rec);
    // The record has all four; the disclosure has none of them.
    expect(rec.basis).toBe('OUT_OF_BAND');
    expect(rec.citedDeedEventId).not.toBeNull();
    expect(sealProjectionLeaks(disclosure, rec)).toEqual([]);
    expect(JSON.stringify(disclosure)).not.toContain('SYS-VEGA');
    expect(JSON.stringify(disclosure)).not.toContain('OUT_OF_BAND');
  });

  it('the leak scan bites — the audit record itself is flagged', () => {
    // A detector that never fires reads exactly like a clean bill of health.
    const { rec } = build('I will hold the line at Vega.', 50);
    const leaks = sealProjectionLeaks(rec, rec);
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks.join(' ')).toContain('prose');
  });

  it('a viewer gets identically what an agent gets, by construction (A9)', () => {
    const { rec } = build('anything', 50);
    expect(viewerSealDisclosure(rec)).toEqual(agentSealDisclosure(rec));
  });

  it('fuzzing the content cannot change the disclosure beyond the flag', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 200 }),
        fc.integer({ min: 0, max: 200 }),
        fc.string({ minLength: 1, maxLength: 40 }),
        (prose, outcome, target) => {
          const { rec } = build(prose, outcome, target);
          const disclosure = agentSealDisclosure(rec);
          expect(Object.keys(disclosure).sort(compareIds)).toEqual([...SEAL_DISCLOSURE_KEYS].sort(compareIds));
          expect(sealProjectionLeaks(disclosure, rec)).toEqual([]);
          expect(disclosure.verdict === 'HONOURED' || disclosure.verdict === 'CONTRADICTED').toBe(
            true,
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('PROP-D2 — the route through the real event ledger', () => {
  it('never yields intent or prose to the author, a stranger or a viewer, at any tick', () => {
    const { rec } = build('The escort departs at the gate. I will not touch the cargo.', 5);
    const ledger = new EventLedger();
    const commit = ledger.append(sealCommitEvent(rec, 1));
    const verdict = ledger.append(sealVerdictEvent(rec, 1, commit.event.id));

    expect(commit.visibility).toBe('SEALED');
    expect(verdict.visibility).toBe('PUBLIC');

    // Every tick from the seal to the end of the season, both feeds, three readers.
    for (let tick = SEAL_TICK; tick <= SEASON_CLOSES; tick += 29) {
      const readers = [
        ledger.agentFeed({ principal: rec.principal, atTick: tick, after: null, limit: 50 }),
        ledger.agentFeed({ principal: STRANGER, atTick: tick, after: null, limit: 50 }),
        ledger.spectatorFeed({ atTick: tick, after: null, limit: 50 }),
      ];
      for (const page of readers) {
        for (const view of page.views) {
          const json = JSON.stringify(view);
          expect(json, `tick ${tick}`).not.toContain('SYS-VEGA');
          expect(json, `tick ${tick}`).not.toContain('escort departs');
          expect(json, `tick ${tick}`).not.toContain('outcomeLow');
          expect(json, `tick ${tick}`).not.toContain('OUT_OF_BAND');
          expect(Object.keys(view.event.payload)).not.toContain('intent');
          expect(Object.keys(view.event.payload)).not.toContain('prose');
        }
      }
    }
  });

  it('the seal itself is unreadable before its Reckoning and a flag afterwards', () => {
    const { rec } = build('sealed prose', 50);
    const ledger = new EventLedger();
    ledger.append(sealCommitEvent(rec, 1));

    const before = ledger.spectatorFeed({ atTick: 200, after: null, limit: 10 });
    expect(before.views).toEqual([]);
    const authorBefore = ledger.agentFeed({
      principal: rec.principal,
      atTick: 200,
      after: null,
      limit: 10,
    });
    // Even its author reads nothing back: nobody is in a seal's audience (§11.2).
    expect(authorBefore.views).toEqual([]);

    const after = ledger.spectatorFeed({ atTick: settlementTickOf(0), after: null, limit: 10 });
    expect(after.views.length).toBe(1);
    const view = after.views[0]!;
    expect(view.redaction).toBe('FLAG_ONLY');
    expect(Object.keys(view.event.payload).sort(compareIds)).toEqual(['reckoningIndex', 'sealId']);
  });

  it('the verdict event payload is exactly the disclosure', () => {
    const { rec } = build('sealed prose', 50);
    const ledger = new EventLedger();
    const commit = ledger.append(sealCommitEvent(rec, 1));
    const verdict = ledger.append(sealVerdictEvent(rec, 1, commit.event.id));
    expect(Object.keys(verdict.event.payload).sort(compareIds)).toEqual([...SEAL_DISCLOSURE_KEYS].sort(compareIds));
    expect(verdict.event.payload['verdict']).toBe('HONOURED');
    // The Reckoning computed it, not the principal — so it reads as an engine act.
    expect(verdict.event.actorPrincipalId).toBeNull();
    expect(verdict.event.parentEventId).toBe(commit.event.id);
  });

  it('neither event links the seal to a venture', () => {
    // A verdict tagged with the venture would narrow the sealed target to that
    // venture's objects — content arriving on a fixed lag by another route.
    const { rec } = build('sealed prose', 50);
    const commit = sealCommitEvent(rec, 1);
    const verdict = sealVerdictEvent(rec, 1, null);
    expect(commit.eventFamilyId).toBe(`seal:${rec.id}`);
    expect(verdict.eventFamilyId).toBe(`seal:${rec.id}`);
    expect(JSON.stringify(verdict)).not.toContain('V-1');
  });
});

describe('PROP-D2 — a caller cannot opt out of the boundary', () => {
  it('the event builders take no payload and no allow-list argument', () => {
    // The structural guarantee. `sealCommitEvent(rec, rulesVersion)` and
    // `sealVerdictEvent(rec, rulesVersion, parent)` — there is nowhere to pass a
    // widened key set, so opting out requires editing src/seal/disclosure.ts.
    expect(sealCommitEvent.length).toBe(2);
    expect(sealVerdictEvent.length).toBe(3);
  });

  it('the flag keys it emits are a subset of the ladder’s set, for any record', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), fc.integer({ min: 0, max: 200 }), (prose, out) => {
        const { rec } = build(prose, out);
        const flagKeys = sealCommitEvent(rec, 1).flagKeys ?? [];
        expect(flagKeys.length).toBeGreaterThan(0);
        for (const key of flagKeys) expect(SEAL_FLAG_KEYS.has(key)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('a hand-rolled event that widens the allow-list is refused by the ledger', () => {
    // Defence in depth: even bypassing this module entirely, the ladder refuses.
    const { rec } = build('sealed prose', 50);
    const widened = { ...sealCommitEvent(rec, 1), flagKeys: ['sealId', 'intent', 'prose'] };
    const ledger = new EventLedger();
    expect(() => ledger.append(widened)).toThrow(EventLedgerError);
    expect(() => ledger.append(widened)).toThrow(/PROP-D2/);
  });
});

describe('PROP-D2 — content reaches the season replay and nothing earlier', () => {
  it('refuses before the season closes and yields content after', () => {
    const { rec } = build('I will hold the line at Vega.', 50);
    expect(() => seasonReplaySealContent(rec, SEASON_CLOSES, SEASON_CLOSES - 1)).toThrow(
      SealDisclosureError,
    );
    const row = seasonReplaySealContent(rec, SEASON_CLOSES, SEASON_CLOSES);
    expect(row.intent.target).toBe('SYS-VEGA');
    expect(row.prose).toContain('hold the line');
    expect(row.citedDeedEventId).not.toBeNull();
  });

  it('the ledger’s season-replay read is the only route to sealed content', () => {
    const { rec } = build('I will hold the line at Vega.', 50);
    const ledger = new EventLedger();
    ledger.append(sealCommitEvent(rec, 1));
    const sealed = ledger.seasonReplaySealedContent(SEASON_CLOSES);
    expect(sealed.length).toBe(1);
    expect(JSON.stringify(sealed[0]?.event.payload)).toContain('SYS-VEGA');
  });
});
