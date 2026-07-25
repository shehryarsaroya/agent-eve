/**
 * The three layers as one row (SPEC §11.1) — *what it told everyone → what it
 * privately committed to → what it did.*
 *
 * The property that matters here is a **negative** one: the row must not rebuild
 * the attribution. Layer 3 is carried by reference into the public feed, and the
 * link from a verdict to the deed it cited stays on the audit record until the
 * season closes — otherwise the row narrows a sealed verb and target to that deed's,
 * which is PROP-D2 broken by a presentation layer instead of by a filter.
 */

import { describe, expect, it } from 'vitest';
import { compareIds } from '../../src/ledger/order.js';
import {
  MAX_ROW_ITEMS,
  SealBook,
  SealDisclosureError,
  sayDoReplayRow,
  sayDoRow,
  sealProjectionLeaks,
  type PublicClaim,
  type SealAuditRecord,
} from '../../src/seal/index.js';
import { deed, eid, intent, pid, role, settlement } from './helpers.js';

const A = pid('P-VEX');
const B = pid('P-HALCYON');
const SEASON_CLOSES = 20 * 288;

function claim(tick: number, reason: string, principal = A): PublicClaim {
  return { principal, tick, reason };
}

/** One seal, resolved CONTRADICTED against a deed, so there is an attribution. */
function resolvedSeal(): { readonly book: SealBook; readonly rec: SealAuditRecord } {
  const book = new SealBook();
  const held = [role('V-1')];
  const accepted = book.commit({
    principal: A,
    tick: 40,
    actedOnStateVersion: 40,
    intent: intent(),
    prose: 'Forty to sixty, as promised.',
    role: held[0] ?? null,
    rolesHeld: held,
  });
  if (!accepted.ok) throw new Error(accepted.hint);
  book.resolve({
    reckoningIndex: 0,
    atTick: settlement(0),
    stateVersion: settlement(0),
    deeds: [deed({ principal: A, tick: 90, outcome: 0, valuedAtStateVersion: 90, eventId: eid('ev:90:0') })],
  });
  const rec = book.auditRecord(accepted.value.sealId);
  if (rec === null) throw new Error('no record');
  return { book, rec };
}

describe('the say-do row', () => {
  it('carries all three layers, and the seal layer is the flag alone', () => {
    const { rec } = resolvedSeal();
    const row = sayDoRow({
      principal: A,
      reckoningIndex: 0,
      claims: [claim(20, 'The convoy departs at the gate.')],
      seals: [rec],
      deedEventIds: [eid('ev:90:0'), eid('ev:44:1')],
    });
    expect(row.claims.length).toBe(1);
    expect(row.seals).toEqual([
      { sealId: rec.id, reckoningIndex: 0, principal: A, verdict: 'CONTRADICTED' },
    ]);
    expect([...row.deedEventIds]).toEqual(['ev:44:1', 'ev:90:0']);
    expect(row.withheld).toEqual({ claims: 0, deeds: 0 });
  });

  it('does not rebuild the attribution, and leaks no content', () => {
    // The record knows which deed contradicted the seal. The row must not say so —
    // that link is seal content arriving on a fixed lag by another route.
    const { rec } = resolvedSeal();
    expect(rec.citedDeedEventId).toBe('ev:90:0');
    const row = sayDoRow({
      principal: A,
      reckoningIndex: 0,
      claims: [claim(20, 'All is well.')],
      seals: [rec],
      deedEventIds: [eid('ev:90:0'), eid('ev:44:1')],
    });
    expect(sealProjectionLeaks(row, rec)).toEqual([]);
    expect(JSON.stringify(row)).not.toContain('SYS-VEGA');
    expect(JSON.stringify(row)).not.toContain('as promised');
    expect(JSON.stringify(row)).not.toContain('OUT_OF_BAND');
    // The cited id is present only because it is one of the public deeds; there is
    // no field naming it as the citation.
    expect(Object.keys(row).sort(compareIds)).toEqual([
      'claims',
      'deedEventIds',
      'principal',
      'reckoningIndex',
      'seals',
      'withheld',
    ]);
  });

  it('caps every array and counts what the cap dropped (INV-26, PROP-O1)', () => {
    const { rec } = resolvedSeal();
    const claims = Array.from({ length: MAX_ROW_ITEMS + 7 }, (_, i) =>
      claim(i, `line ${String(i)}`),
    );
    const deeds = Array.from({ length: MAX_ROW_ITEMS + 3 }, (_, i) => eid(`ev:${String(i)}:0`));
    const row = sayDoRow({ principal: A, reckoningIndex: 0, claims, seals: [rec], deedEventIds: deeds });
    expect(row.claims.length).toBe(MAX_ROW_ITEMS);
    expect(row.deedEventIds.length).toBe(MAX_ROW_ITEMS);
    // Silent truncation is indistinguishable from a quieter world; counted is not.
    expect(row.withheld.claims).toBe(7);
    expect(row.withheld.deeds).toBe(3);
  });

  it('refuses a claim or a seal belonging to another principal (A5-prime)', () => {
    const { rec } = resolvedSeal();
    expect(() =>
      sayDoRow({
        principal: A,
        reckoningIndex: 0,
        claims: [claim(20, 'not mine', B)],
        seals: [],
        deedEventIds: [],
      }),
    ).toThrow(SealDisclosureError);
    expect(() =>
      sayDoRow({ principal: B, reckoningIndex: 0, claims: [], seals: [rec], deedEventIds: [] }),
    ).toThrow(SealDisclosureError);
  });

  it('refuses a seal from another Reckoning — scar #7 at the presentation layer', () => {
    const { rec } = resolvedSeal();
    expect(() =>
      sayDoRow({ principal: A, reckoningIndex: 1, claims: [], seals: [rec], deedEventIds: [] }),
    ).toThrow(/Reckoning 0, not 1/);
  });

  it('refuses a claim over 140 characters rather than trimming it', () => {
    expect(() =>
      sayDoRow({
        principal: A,
        reckoningIndex: 0,
        claims: [claim(20, 'x'.repeat(141))],
        seals: [],
        deedEventIds: [],
      }),
    ).toThrow(SealDisclosureError);
  });
});

describe('the season replay row', () => {
  it('refuses before the season closes and reveals the attribution after', () => {
    const { rec } = resolvedSeal();
    const input = {
      principal: A,
      reckoningIndex: 0,
      claims: [claim(20, 'All is well.')],
      seals: [rec],
      deedEventIds: [eid('ev:90:0')],
    };
    expect(() => sayDoReplayRow(input, SEASON_CLOSES, SEASON_CLOSES - 1)).toThrow(
      SealDisclosureError,
    );
    const replay = sayDoReplayRow(input, SEASON_CLOSES, SEASON_CLOSES);
    expect(replay.seals[0]?.intent.target).toBe('SYS-VEGA');
    expect(replay.seals[0]?.prose).toContain('as promised');
    expect(replay.seals[0]?.citedDeedEventId).toBe('ev:90:0');
    // The claim stands beside it, unchanged and still a lie.
    expect(replay.claims[0]?.reason).toBe('All is well.');
  });
});
