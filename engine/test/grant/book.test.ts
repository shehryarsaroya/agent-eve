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
import type { GrantRelease, GrantSpend } from '../../src/invariants/authority.js';
import { checkInv22 } from '../../src/invariants/authority.js';
import { minor } from '../../src/core/units.js';

let spendSeq = 0;
/** A spend row against a grant — the journal INV-22 audits. */
function sp(
  grant: GrantId,
  direct: number,
  contingent: number,
  delegate = 'p:bob',
  // The default matches {@link grant}'s default fence, so an existing case that says nothing
  // about verbs keeps testing what it always tested. A case about the FENCE passes one
  // explicitly — see `the fence is enforced at the book, not only at the door`.
  verb = 'create',
): GrantSpend {
  spendSeq += 1;
  return {
    grant,
    delegate: delegate as PrincipalId,
    tick: 1,
    eventId: `ev:spend:${String(spendSeq)}` as EventId,
    direct: minor(direct),
    contingent: minor(contingent),
    verb,
  };
}

function grant(over: Partial<Grant> & Pick<Grant, 'id' | 'grantor' | 'delegate'>): Grant {
  return {
    template: 'treasury-hand',
    maxDirectLoss: minor(1000),
    maxContingentLiability: minor(500),
    spentDirect: minor(0),
    spentContingent: minor(0),
    // Both delegable verbs by default: these cases are about the LIMITS, and a helper whose
    // default fence excluded the verb its default spend uses would fail every one of them for
    // a reason none of them is about.
    verbs: ['create', 'elect'],
    clearance: [],
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

// ── ★ THE RELEASE JOURNAL (`RULES_VERSION` 26) ───────────────────────────────

describe('a draw can be given BACK, and every way of laundering headroom is refused', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **A RETIRED VENTURE USED TO CONSUME ITS GRANTOR'S BUDGET FOREVER.** A blind probe watched a
   * BUILD with 28,000 of elective liability retire ABANDONED having paid nobody, and read
   * `spent_contingent: 28000, headroom_contingent: 2000` off the grant on three later wakes — a
   * denial-of-authority attack whose only requirement is a `create` and an `abandon`.
   *
   * `recordSpend` refuses a negative row (*"a spend never returns headroom"*) and INV-22 halts over
   * one, and both should stay that way: a journal whose rows can be negative is a journal in which
   * an over-release and a legitimate draw look alike. So a release is its own row and it must NAME
   * the draw it gives back. These cases are the five ways that could go wrong — every one of them
   * is engine-side and unreachable from a request, which is exactly why they are tested here rather
   * than assumed (an invariant whose subject cannot occur reports green forever).
   * ══════════════════════════════════════════════════════════════════════════
   */
  const release = (
    grantId: GrantId,
    eventId: EventId,
    direct: number,
    contingent: number,
    over: Partial<GrantRelease> = {},
  ): GrantRelease => ({
    grant: grantId,
    delegate: 'p:bob' as PrincipalId,
    tick: 9,
    eventId,
    direct: minor(direct),
    contingent: minor(contingent),
    verb: 'create',
    cause: 'ABANDONED',
    ...over,
  });

  function bookWithDraw(): { book: GrantBook; id: GrantId; draw: EventId } {
    const book = new GrantBook();
    const id = G('g:rel');
    book.add(grant({ id, grantor: 'p:alice' as PrincipalId, delegate: 'p:bob' as PrincipalId }));
    const spend = sp(id, 400, 300);
    book.recordSpend(spend);
    return { book, id, draw: spend.eventId };
  }

  it('returns headroom to the row cache and the journal together', () => {
    const { book, id, draw } = bookWithDraw();
    expect(book.headroom(id)).toEqual({ direct: 600, contingent: 200 });
    book.releaseSpend(release(id, draw, 400, 300));
    expect(book.get(id)?.spentDirect).toBe(0);
    expect(book.get(id)?.spentContingent).toBe(0);
    expect(book.headroom(id)).toEqual({ direct: 1000, contingent: 500 });
    expect(book.allReleases()).toHaveLength(1);
    // The net the invariant recomputes agrees with the cache it just moved.
    expect(book.netSpendOf(id)).toEqual({ direct: 0, contingent: 0 });
    expect(checkInv22(book.all(), book.allSpends(), 10, [], book.allReleases())).toEqual([]);
  });

  it('refuses a release that names no draw — headroom cannot be returned where none was charged', () => {
    const { book, id } = bookWithDraw();
    expect(() => book.releaseSpend(release(id, 'ev:never-drawn' as EventId, 1, 0))).toThrow(
      GrantBookError,
    );
    expect(book.get(id)?.spentDirect).toBe(400);
    expect(book.allReleases()).toHaveLength(0);
  });

  it('refuses a release LARGER than the draw it names, on either half', () => {
    for (const [direct, contingent] of [
      [401, 0],
      [0, 301],
    ]) {
      const { book, id, draw } = bookWithDraw();
      expect(() =>
        book.releaseSpend(release(id, draw, direct as number, contingent as number)),
      ).toThrow(GrantBookError);
      expect(book.netSpendOf(id)).toEqual({ direct: 400, contingent: 300 });
    }
  });

  it('refuses a SECOND release of the same draw — the give-back is not repeatable', () => {
    const { book, id, draw } = bookWithDraw();
    book.releaseSpend(release(id, draw, 400, 300));
    expect(() => book.releaseSpend(release(id, draw, 1, 0))).toThrow(GrantBookError);
    expect(book.allReleases()).toHaveLength(1);
  });

  it('refuses a negative release, so a "release" cannot charge a limit', () => {
    const { book, id, draw } = bookWithDraw();
    expect(() => book.releaseSpend(release(id, draw, -1, 0))).toThrow(GrantBookError);
    expect(book.allReleases()).toHaveLength(0);
  });

  it('INV-22 catches a release the book itself would have refused', () => {
    // The book is the door; the invariant is the net. A release forged straight into the journal —
    // a bad restore, a replay, a future caller that skips `releaseSpend` — has to be caught too,
    // and each clause is asserted separately so none of them can be vacuous.
    const { book, id, draw } = bookWithDraw();
    const cases: readonly { readonly row: GrantRelease; readonly says: string }[] = [
      { row: release(id, 'ev:phantom' as EventId, 1, 0), says: 'names no draw' },
      { row: release(id, draw, 401, 0), says: 'can never exceed the draw it names' },
      { row: release(G('g:missing'), draw, 1, 0), says: 'not in the' },
      { row: release(id, draw, 1, 0, { delegate: 'p:carol' as PrincipalId }), says: 'is attributed to' },
      {
        row: release(id, draw, 1, 0, { cause: 'WHIM' as unknown as GrantRelease['cause'] }),
        says: 'is not one of',
      },
      { row: release(id, draw, -1, 0), says: 'is negative' },
    ];
    for (const c of cases) {
      const found = checkInv22(book.all(), book.allSpends(), 11, [], [c.row]);
      expect(found.map((v) => v.message).join(' | '), c.says).toContain(c.says);
      expect(found.every((v) => v.id === 'INV-22')).toBe(true);
    }
    // Non-vacuity, and it has to go through the book: a release handed to the invariant alone nets
    // the journal below the row cache, which is the journal-vs-cache clause correctly firing. So the
    // clean case is a release the book actually APPLIED — the pair moves together or neither does.
    const clean = bookWithDraw();
    clean.book.releaseSpend(release(clean.id, clean.draw, 400, 300));
    expect(
      checkInv22(clean.book.all(), clean.book.allSpends(), 11, [], clean.book.allReleases()),
    ).toEqual([]);
  });

  it('round-trips through the state table, so a rollback cannot forget a give-back', () => {
    const { book, id, draw } = bookWithDraw();
    book.releaseSpend(release(id, draw, 400, 300));
    let restored: GrantBook | null = null;
    const table = grantsStateTable(
      () => book,
      (b) => {
        restored = b;
      },
    );
    const captured = table.capture();
    if (table.restore === undefined) throw new Error('the grant table has no restore');
    table.restore(captured);
    if (restored === null) throw new Error('restore never ran');
    const back: GrantBook = restored;
    expect(back.allReleases()).toHaveLength(1);
    expect(back.get(id)?.spentDirect).toBe(0);
    expect(back.netSpendOf(id)).toEqual({ direct: 0, contingent: 0 });
    expect(canonicalHash(grantsStateTable(() => back, () => undefined).capture())).toBe(
      canonicalHash(captured),
    );
    // A captured cause this build cannot state is refused rather than restored.
    const forged = JSON.parse(JSON.stringify(captured)) as {
      releases: { cause: string }[];
    };
    forged.releases[0]!.cause = 'WHIM';
    expect(() => table.restore?.(forged as never)).toThrow(GrantBookError);
  });
});
