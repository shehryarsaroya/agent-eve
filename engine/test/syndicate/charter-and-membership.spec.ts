/**
 * The syndicate book, and the two properties that decide whether the mechanic means anything.
 *
 * 1. **A charter cannot be amended.** That is the whole reason to pool goods you cannot withdraw on
 *    demand: the terms you joined under cannot move once you are inside. Every org game that allows
 *    amendment collapses to "whoever holds the votes today owns everything", which is not politics.
 * 2. **A syndicate is identifiable as one** (`isSyndicate`), because D11's rule — a syndicate is not
 *    a Levy subject, since the Levy is a duty on a BODY and it has none — has to be enforced from a
 *    single predicate. Three call sites that agree today is a rule that lapses on the fourth.
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { compareIds } from '../../src/ledger/order.js';
import {
  Book,
  syndicateAsPrincipal,
  syndicateId,
  SyndicateError,
} from '../../src/syndicate/book.js';
import {
  CHARTER_STATEMENT,
  DEFAULT_CHARTER,
  parseCharter,
  type Charter,
} from '../../src/syndicate/charter.js';
import { MAX_MEMBERS, MAX_SYNDICATES_PER_PRINCIPAL } from '../../src/syndicate/params.js';

const A = 'p:anders' as PrincipalId;
const B = 'p:brannock' as PrincipalId;

function founded(charter: Charter = DEFAULT_CHARTER, tick = 10): { book: Book; id: ReturnType<typeof syndicateId> } {
  const book = new Book();
  const row = book.form({ founder: A, name: 'The Long Haul', charter, tick });
  return { book, id: row.id };
}

describe('a charter is constitutional, and there is no way to amend one', () => {
  it('exposes no amend path at all — checked against the surface, not by intention', () => {
    const { book } = founded();
    // The property is the ABSENCE of a mechanism, so it is asserted against the book's own surface:
    // if somebody later adds `amendCharter`, this goes red and they have to argue for it.
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(book));
    expect(surface.filter((n) => /amend|setCharter|editCharter|reform/i.test(n))).toEqual([]);
  });

  it('keeps the founding charter through a snapshot round-trip', () => {
    const strict: Charter = { admission: 'CLOSED', decision: 'UNANIMOUS', treasuryOffices: false };
    const { book, id } = founded(strict);
    const fresh = new Book();
    fresh.restore(book.capture());
    expect(fresh.at(id)?.charter).toEqual(strict);
  });

  it('defaults to the cautious clauses, especially the treasury one', () => {
    // The safe default for "can one member spend the pool" is NO. A founder that wants a business
    // says so, having been told the clause is permanent.
    expect(DEFAULT_CHARTER.treasuryOffices).toBe(false);
    expect(DEFAULT_CHARTER.admission).toBe('INVITE');
  });

  it('tells a founder the clauses are final, and names the one that matters most', () => {
    expect(CHARTER_STATEMENT).toContain('A CHARTER IS PERMANENT');
    expect(CHARTER_STATEMENT).toContain('there is no verb in this game that amends one');
    expect(CHARTER_STATEMENT).toContain('treasury_offices');
    expect(CHARTER_STATEMENT, 'and what the dangerous setting actually does').toContain('how one is looted');
  });

  it('refuses an unparseable clause rather than silently defaulting it', () => {
    // Silently defaulting a constitutional clause would be the worst possible failure: permanent,
    // invisible, and not what was asked for.
    expect(parseCharter({ admission: 'SOMETIMES' })).toHaveProperty('fault');
    expect(parseCharter({ decision: 'VIBES' })).toHaveProperty('fault');
    expect(parseCharter({ treasury_offices: 'yes' })).toHaveProperty('fault');
    expect(parseCharter({ admission: 'open', decision: 'founder', treasury_offices: true })).toEqual({
      admission: 'OPEN',
      decision: 'FOUNDER',
      treasuryOffices: true,
    });
  });
});

describe('a syndicate is identifiable as one, which is what D11 hangs on', () => {
  it('answers isSyndicate for its own principal id and nothing else', () => {
    const { book, id } = founded();
    expect(book.isSyndicate(syndicateAsPrincipal(id)), 'the pooled subject').toBe(true);
    expect(book.isSyndicate(A), 'a real agent is not one').toBe(false);
    expect(book.isSyndicate(B)).toBe(false);
  });

  it('addresses the syndicate and its stores by ONE id, not a mapping to keep in step', () => {
    const { id } = founded();
    expect(String(syndicateAsPrincipal(id))).toBe(String(id));
  });
});

describe('membership: the charter decides who can ever be inside', () => {
  it('CLOSED means final, and says the clause is permanent when it refuses', () => {
    const { book, id } = founded({ ...DEFAULT_CHARTER, admission: 'CLOSED' });
    const fault = book.admissionFault(id, B, 11);
    expect(fault).toContain('CLOSED');
    expect(fault, 'a refusal an agent cannot act on must at least be explained').toContain('permanent');
  });

  it('admits under INVITE and counts the founder as a sitting member', () => {
    const { book, id } = founded();
    expect(book.sittingMembers(id, 11)).toEqual([A]);
    book.admit(id, B, 11);
    // Explicit comparator: DET-1 bans a bare .sort(), because implementation-defined ordering in
    // a test is a test that passes on one machine.
    expect(book.sittingMembers(id, 12)).toEqual([A, B].sort(compareIds));
  });

  it('caps membership and per-principal seats, because unbounded growth is scar #3', () => {
    const { book, id } = founded({ ...DEFAULT_CHARTER, admission: 'OPEN' });
    for (let i = 0; i < MAX_MEMBERS - 1; i += 1) {
      book.admit(id, `p:m${String(i)}` as PrincipalId, 11);
    }
    expect(book.sittingMembers(id, 12).length).toBe(MAX_MEMBERS);
    expect(book.admissionFault(id, B, 12)).toContain('cap');

    const spread = new Book();
    const ids = [0, 1, 2, 3].map(
      (i) => spread.form({ founder: `p:f${String(i)}` as PrincipalId, name: `s${String(i)}`, charter: { ...DEFAULT_CHARTER, admission: 'OPEN' }, tick: 10 + i }).id,
    );
    for (const s of ids.slice(0, MAX_SYNDICATES_PER_PRINCIPAL)) spread.admit(s, B, 20);
    expect(spread.admissionFault(ids[MAX_SYNDICATES_PER_PRINCIPAL] ?? ids[0]!, B, 21)).toContain('cap');
  });
});

describe('notice, because a pool that can be drained on a whim is not pooled', () => {
  it('keeps a member sitting until its notice expires', () => {
    const { book, id } = founded();
    book.admit(id, B, 11);
    book.giveNotice(id, B, 300);
    expect(book.isMember(id, B, 299), 'still in, and still bound, until the tick it leaves').toBe(true);
    expect(book.sittingMembers(id, 299), 'so it still counts in every vote until then').toContain(B);
    expect(book.isMember(id, B, 300)).toBe(false);
    expect(book.sittingMembers(id, 300)).not.toContain(B);
  });

  it('refuses a founder giving notice, and points at the act that does exist', () => {
    const { book, id } = founded();
    expect(() => book.giveNotice(id, A, 300)).toThrow(SyndicateError);
    try {
      book.giveNotice(id, A, 300);
    } catch (error: unknown) {
      expect(String(error), 'a refusal has to name the way out').toMatch(/dissolve/);
    }
  });
});
