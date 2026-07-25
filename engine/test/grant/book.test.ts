/**
 * The GrantBook (SPEC §8, A6) — the live, enforced, HASHED table of scoped authority.
 *
 * A6 makes betrayal-via-legitimate-authority the core loop, so the book a delegate's
 * act is checked against has to have the same three properties money already has: it
 * captures into `state_hash`, it restores on abort, and it replays from the journal.
 * These tests pin all three, plus the clock rules (expiry, revocation-next-tick) and
 * the two-halves spend cache that INV-22 audits.
 */

import { describe, expect, it } from 'vitest';
import { GrantBook, GrantBookError, grantsStateTable } from '../../src/grant/index.js';
import { canonicalHash } from '../../src/core/canonical.js';
import type { EventId, Grant, GrantId, PrincipalId } from '../../src/core/types.js';
import type { GrantSpend } from '../../src/invariants/authority.js';
import { minor } from '../../src/core/units.js';

let spendSeq = 0;
/** A spend row against a grant — the journal INV-22 audits. */
function sp(grant: GrantId, direct: number, contingent: number, delegate = 'p:bob'): GrantSpend {
  spendSeq += 1;
  return {
    grant,
    delegate: delegate as PrincipalId,
    tick: 1,
    eventId: `ev:spend:${String(spendSeq)}` as EventId,
    direct: minor(direct),
    contingent: minor(contingent),
  };
}

function grant(over: Partial<Grant> & Pick<Grant, 'id' | 'grantor' | 'delegate'>): Grant {
  return {
    template: 'treasury-hand',
    maxDirectLoss: minor(1000),
    maxContingentLiability: minor(500),
    spentDirect: minor(0),
    spentContingent: minor(0),
    expiresTick: 300,
    revokedAtTick: null,
    ...over,
  };
}

const G = (id: string): GrantId => id as GrantId;
const P = (id: string): PrincipalId => id as PrincipalId;

describe('GrantBook — the row store', () => {
  it('adds, gets, and lists in canonical id order', () => {
    const book = new GrantBook();
    book.add(grant({ id: G('g:b'), grantor: P('p:alice'), delegate: P('p:bob') }));
    book.add(grant({ id: G('g:a'), grantor: P('p:alice'), delegate: P('p:cass') }));
    expect(book.has(G('g:a'))).toBe(true);
    expect(book.get(G('g:b'))?.delegate).toBe('p:bob');
    expect(book.all().map((g) => g.id)).toEqual(['g:a', 'g:b']); // sorted, not insertion order
  });

  it('refuses a duplicate id — ids are minted once, never a silent overwrite', () => {
    const book = new GrantBook();
    book.add(grant({ id: G('g:1'), grantor: P('p:alice'), delegate: P('p:bob'), spentDirect: minor(400) }));
    expect(() => book.add(grant({ id: G('g:1'), grantor: P('p:alice'), delegate: P('p:bob') }))).toThrow(
      GrantBookError,
    );
    // The accrued spend survived the refused overwrite.
    expect(book.get(G('g:1'))?.spentDirect).toBe(400);
  });

  it('spend accrues on both halves separately (LIMITS cap destruction, not just transfers)', () => {
    const book = new GrantBook();
    book.add(grant({ id: G('g:1'), grantor: P('p:alice'), delegate: P('p:bob') }));
    book.recordSpend(sp(G('g:1'), 300, 100));
    book.recordSpend(sp(G('g:1'), 250, 50));
    expect(book.get(G('g:1'))?.spentDirect).toBe(550);
    expect(book.get(G('g:1'))?.spentContingent).toBe(150);
    expect(book.headroom(G('g:1'))).toEqual({ direct: 450, contingent: 350 });
    // The journal INV-22 audits carries both draws.
    expect(book.allSpends()).toHaveLength(2);
    expect(book.allSpends().reduce((n, s) => n + s.direct, 0)).toBe(550);
  });

  it('headroom never goes negative even if spend somehow exceeds the LIMIT', () => {
    const book = new GrantBook();
    book.add(grant({ id: G('g:1'), grantor: P('p:alice'), delegate: P('p:bob'), maxDirectLoss: minor(100) }));
    book.recordSpend(sp(G('g:1'), 140, 0));
    expect(book.headroom(G('g:1')).direct).toBe(0);
  });
});

describe('GrantBook — the clock rules (SPEC §8.1 #5, #6)', () => {
  it('expiry: a grant is live THROUGH expiresTick and dead the next tick', () => {
    const book = new GrantBook();
    book.add(grant({ id: G('g:1'), grantor: P('p:alice'), delegate: P('p:bob'), expiresTick: 300 }));
    expect(book.isLive(G('g:1'), 300)).toBe(true);
    expect(book.isLive(G('g:1'), 301)).toBe(false);
  });

  it('revocation: always accepted, takes effect the NEXT tick, earliest wins', () => {
    const book = new GrantBook();
    book.add(grant({ id: G('g:1'), grantor: P('p:alice'), delegate: P('p:bob') }));
    book.revoke(G('g:1'), 100);
    expect(book.isLive(G('g:1'), 100)).toBe(true); // still live the tick it was revoked
    expect(book.isLive(G('g:1'), 101)).toBe(false); // dead the tick after
    // A later revoke cannot delay or undo the earlier one.
    book.revoke(G('g:1'), 200);
    expect(book.get(G('g:1'))?.revokedAtTick).toBe(100);
  });

  it('liveGrantBetween finds the authorising grant and skips expired/revoked ones', () => {
    const book = new GrantBook();
    book.add(grant({ id: G('g:live'), grantor: P('p:alice'), delegate: P('p:bob'), maxDirectLoss: minor(900) }));
    book.add(grant({ id: G('g:exp'), grantor: P('p:alice'), delegate: P('p:bob'), expiresTick: 50 }));
    // At tick 60 the expired one is out; the live one is found.
    expect(book.liveGrantBetween(P('p:alice'), P('p:bob'), 60)?.id).toBe('g:live');
    // No grant to an unrelated delegate.
    expect(book.liveGrantBetween(P('p:alice'), P('p:zed'), 60)).toBeNull();
    // Revoke the live one; nothing authorises bob the tick after.
    book.revoke(G('g:live'), 60);
    expect(book.liveGrantBetween(P('p:alice'), P('p:bob'), 61)).toBeNull();
  });
});

describe('grantsStateTable — capture / restore / hash (fable F2: not outside the hash)', () => {
  function populated(): GrantBook {
    const book = new GrantBook();
    book.add(grant({ id: G('g:1'), grantor: P('p:alice'), delegate: P('p:bob') }));
    book.add(grant({ id: G('g:2'), grantor: P('p:alice'), delegate: P('p:cass'), revokedAtTick: 88 }));
    // Spend via the journal so the row cache and the journal agree — a realistic book,
    // the kind INV-22 accepts (cache == journal sum).
    book.recordSpend(sp(G('g:1'), 120, 0));
    return book;
  }

  it('round-trips every field, including the mutable spend and revocation', () => {
    const src = populated();
    src.recordSpend(sp(G('g:1'), 30, 15));

    const table = grantsStateTable(() => src, () => undefined);
    const captured = table.capture();

    let restored = new GrantBook();
    grantsStateTable(
      () => restored,
      (b) => {
        restored = b;
      },
    ).restore!(captured);

    expect(restored.get(G('g:1'))?.spentDirect).toBe(150);
    expect(restored.get(G('g:1'))?.spentContingent).toBe(15);
    expect(restored.get(G('g:2'))?.revokedAtTick).toBe(88);
    // The whole book hashes identically — the property state_hash rests on.
    const recap = grantsStateTable(() => restored, () => undefined).capture();
    expect(canonicalHash(recap)).toBe(canonicalHash(captured));
  });

  it('MUTATION PROOF: a changed spend diverges the capture hash', () => {
    const a = populated();
    const b = populated();
    b.recordSpend(sp(G('g:1'), 1, 0)); // one unit of drift

    const ha = canonicalHash(grantsStateTable(() => a, () => undefined).capture());
    const hb = canonicalHash(grantsStateTable(() => b, () => undefined).capture());
    expect(hb).not.toBe(ha);
  });
});
