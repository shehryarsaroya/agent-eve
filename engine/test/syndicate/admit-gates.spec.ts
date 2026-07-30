/**
 * The gates on `admit`, pinned one at a time against a fake port.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * `admit` was extracted out of `sim/runtime.ts` into `syndicate/admit.ts` (D21's order). All five of
 * its gates survived mutation against the existing suite — none of them was tested.
 *
 * That is not an accident of coverage, it is a shape problem worth naming: `form-through-the-front-door`
 * does drive `admit` twice, but through a helper whose only assertion is **HTTP 200** — and in this
 * engine an illegal move is a 200 carrying `{ok:false, hint}` (SPEC §12.2, and deliberately so). So a
 * test that submits an action and checks the status code cannot distinguish "it worked" from "it was
 * refused", and every widening mutation of every gate passed it. The happy path was covered; the rules
 * were not.
 *
 * `state_hash` cannot help here either, in two independent ways: `admit` is never issued by the
 * heuristic cast over 900 ticks, so the hash stream is silent about it, and refusal text is not hashed
 * even when it does run. Mutation plus these assertions is the whole of the evidence.
 *
 * ── ORDER IS PART OF THE CONTRACT ────────────────────────────────────────────
 *
 * The gates are asserted in the order the runtime applied them, because which sentence an agent reads
 * when several gates would all refuse is observable behaviour that no state table records. `describe`
 * blocks below run outermost-first for that reason.
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { Book, type SyndicateId } from '../../src/syndicate/book.js';
import { DEFAULT_CHARTER, type Charter } from '../../src/syndicate/charter.js';
import { admit, type AdmitPort } from '../../src/syndicate/admit.js';

const FOUNDER = 'p:founder' as PrincipalId;
const GUEST = 'p:guest' as PrincipalId;
const OUTSIDER = 'p:outsider' as PrincipalId;

/** Everyone named in these tests is enrolled unless a test says otherwise. */
function port(seated: readonly PrincipalId[] = [FOUNDER, GUEST, OUTSIDER]): AdmitPort {
  return { isSeated: (principal) => seated.includes(principal) };
}

/** A book holding one syndicate under `charter`, founded by {@link FOUNDER} at tick 1. */
function bookWith(charter: Charter): { readonly book: Book; readonly id: SyndicateId } {
  const book = new Book();
  const row = book.form({ founder: FOUNDER, name: 'the-house', charter, tick: 1 });
  return { book, id: row.id };
}

const INVITE: Charter = { ...DEFAULT_CHARTER, admission: 'INVITE' };

describe('admit brings somebody in, and says why when it will not', () => {
  it('admits a named principal under an INVITE charter', () => {
    const { book, id } = bookWith(INVITE);
    const out = admit(port(), book, { member: FOUNDER, syndicate: id, who: GUEST, tick: 5 });

    expect(out.ok, out.ok ? '' : out.hint).toBe(true);
    expect(book.isMember(id, GUEST, 5), 'the guest is now a sitting member').toBe(true);
    expect(book.sittingMembers(id, 5).length).toBe(2);
  });

  it('refuses an unknown syndicate and names it', () => {
    const out = admit(port(), new Book(), {
      member: FOUNDER,
      syndicate: 'syn:nothing' as SyndicateId,
      who: GUEST,
      tick: 5,
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.invariant).toBe('A2');
    expect(out.hint).toMatch(/there is no syndicate syn:nothing/);
  });

  it('refuses a non-member, because its say carries nothing', () => {
    const { book, id } = bookWith(INVITE);
    const out = admit(port(), book, { member: OUTSIDER, syndicate: id, who: GUEST, tick: 5 });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.hint).toMatch(/not a sitting member/);
    expect(book.isMember(id, GUEST, 5), 'and nobody was admitted').toBe(false);
  });

  it('refuses under a CLOSED charter and says the clause is permanent', () => {
    // The one gate with no workaround anywhere in the game: there is no verb that amends a charter, so
    // this refusal has to say so or an agent will keep spending actions looking for the vote.
    const { book, id } = bookWith({ ...DEFAULT_CHARTER, admission: 'CLOSED' });
    const out = admit(port(), book, { member: FOUNDER, syndicate: id, who: GUEST, tick: 5 });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.hint).toMatch(/CLOSED/);
    expect(out.hint, 'and that no vote changes it').toMatch(/permanent and no vote changes it/);
    expect(book.isMember(id, GUEST, 5)).toBe(false);
  });

  it('refuses a principal that never enrolled, rather than seating a ghost', () => {
    // The port's whole reason for existing. A membership row for a name nobody holds would be a
    // permanent public record about a principal that does not exist (A5').
    const { book, id } = bookWith(INVITE);
    const out = admit(port([FOUNDER]), book, { member: FOUNDER, syndicate: id, who: GUEST, tick: 5 });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.hint).toMatch(/there is no principal p:guest to admit; name one that has enrolled/);
    expect(book.sittingMembers(id, 5).length, 'the roll is unchanged').toBe(1);
  });

  it('refuses a second admission of a sitting member, through the book fault', () => {
    // `admissionFault` is the book's own predicate and the affordance shares it; this pins that the
    // verb still consults it rather than duplicating a copy that could drift.
    const { book, id } = bookWith(INVITE);
    expect(admit(port(), book, { member: FOUNDER, syndicate: id, who: GUEST, tick: 5 }).ok).toBe(true);

    const again = admit(port(), book, { member: FOUNDER, syndicate: id, who: GUEST, tick: 6 });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.invariant).toBe('A2');
    expect(book.sittingMembers(id, 6).length, 'and it is not counted twice').toBe(2);
  });
});

describe('the admissionFault gate is redundant with the book, and that is asserted not assumed', () => {
  it('gives the same refusal whether the gate or the book catches it', () => {
    // ★ Why this test exists: deleting the `admissionFault` line from `admitRefusal` passes every other
    // test in this file, because `Book.admit` calls the same predicate and throws the same string. That
    // is a redundancy rather than a coverage gap — but it is only redundant *while* the book keeps its
    // own check. This pins the equivalence, so whoever removes it from `Book.admit` learns here that
    // the gate has become load-bearing, instead of finding out from a full syndicate being offered a
    // place it cannot have.
    const { book, id } = bookWith(INVITE);
    expect(admit(port(), book, { member: FOUNDER, syndicate: id, who: GUEST, tick: 5 }).ok).toBe(true);

    const viaGate = admit(port(), book, { member: FOUNDER, syndicate: id, who: GUEST, tick: 6 });
    expect(viaGate.ok).toBe(false);
    if (viaGate.ok) return;

    const direct = ((): string => {
      try {
        book.admit(id, GUEST, 6);
        return 'no throw';
      } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error);
      }
    })();

    expect(viaGate.hint, 'the two roads say the same thing').toBe(direct);
    expect(viaGate.hint).toMatch(/already a member/);
  });
});

describe('the order the gates fire in', () => {
  it('tells a non-member it is a non-member before it mentions a CLOSED charter', () => {
    // Both gates would refuse. Which sentence comes back is the difference between "you personally may
    // not" and "nobody ever may", and an agent plans differently on each — so the order is pinned.
    const { book, id } = bookWith({ ...DEFAULT_CHARTER, admission: 'CLOSED' });
    const out = admit(port(), book, { member: OUTSIDER, syndicate: id, who: GUEST, tick: 5 });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.hint).toMatch(/not a sitting member/);
    expect(out.hint).not.toMatch(/CLOSED/);
  });

  it('mentions a CLOSED charter before it checks whether the invitee exists', () => {
    const { book, id } = bookWith({ ...DEFAULT_CHARTER, admission: 'CLOSED' });
    const out = admit(port([FOUNDER]), book, { member: FOUNDER, syndicate: id, who: GUEST, tick: 5 });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.hint).toMatch(/CLOSED/);
    expect(out.hint).not.toMatch(/never enrolled|has enrolled/);
  });
});
