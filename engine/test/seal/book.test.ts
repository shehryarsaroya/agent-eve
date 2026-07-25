/**
 * INV-20 and PROP-D4 — the seal book.
 *
 * - `INV-20` Every seal has exactly one verdict, scoped to its own
 *   `reckoning_id`, evaluated once. *(Scar #7: a promise made once must not be
 *   re-judged at every subsequent Reckoning.)*
 * - `PROP-D4` Seals are mandatory and one per role held is free — else there are
 *   no reveals.
 *
 * The mutation suite at the bottom is deliberate. A checker that cannot be shown
 * to fire is indistinguishable from a clean bill of health, which is the shape of
 * every detector bug in the scar list — so `checkInv20` is run against
 * hand-constructed broken books, one per clause.
 */

import { describe, expect, it } from 'vitest';
import { compareIds } from '../../src/ledger/order.js';
import { TICKS_PER_RECKONING, inFreeze } from '../../src/core/time.js';
import type { SealId } from '../../src/core/types.js';
import {
  MAX_SEALS_PER_PRINCIPAL_PER_RECKONING,
  SealBook,
  SealHalt,
  checkInv20,
  roleKey,
  type SealAuditRecord,
} from '../../src/seal/index.js';
import { deed, intent, pid, role, settlement, vid } from './helpers.js';

const A = pid('P-A');
const B = pid('P-B');

function commit(
  book: SealBook,
  over: {
    principal?: ReturnType<typeof pid>;
    tick?: number;
    // `undefined` means "use the first held role"; `null` means "cite no role".
    role?: ReturnType<typeof role> | null | undefined;
    rolesHeld?: ReturnType<typeof role>[];
    version?: number;
  } = {},
): { ok: boolean; sealId?: SealId; costsAction?: boolean; invariant?: string; hint?: string } {
  const held = over.rolesHeld ?? [role('V-1')];
  const result = book.commit({
    principal: over.principal ?? A,
    tick: over.tick ?? 100,
    actedOnStateVersion: over.version ?? 100,
    intent: intent(),
    prose: 'as agreed',
    role: over.role === undefined ? (held[0] ?? null) : over.role,
    rolesHeld: held,
  });
  return result.ok
    ? { ok: true, sealId: result.value.sealId, costsAction: result.value.costsAction }
    : { ok: false, invariant: result.invariant, hint: result.hint };
}

describe('INV-20 — one verdict, its own Reckoning, evaluated once', () => {
  it('resolves each seal exactly once and stamps the verdict at its own settlement', () => {
    const book = new SealBook();
    const first = commit(book, { tick: 100 });
    expect(first.ok).toBe(true);

    const resolution = book.resolve({
      reckoningIndex: 0,
      atTick: settlement(0),
      stateVersion: 400,
      deeds: [deed({ principal: A, outcome: 50 })],
    });
    expect(resolution.verdicts.length).toBe(1);
    const rec = book.auditRecord(first.sealId!)!;
    expect(rec.verdict).toBe('HONOURED');
    expect(rec.evaluations).toBe(1);
    expect(rec.verdictAtTick).toBe(settlement(0));
    expect(checkInv20(book, settlement(0))).toEqual([]);
  });

  it('refuses to resolve the same Reckoning twice', () => {
    const book = new SealBook();
    commit(book, { tick: 100 });
    const input = {
      reckoningIndex: 0,
      atTick: settlement(0),
      stateVersion: 400,
      deeds: [deed({ principal: A, outcome: 50 })],
    };
    book.resolve(input);
    expect(() => book.resolve(input)).toThrow(SealHalt);
    // And the verdict is untouched by the refused second attempt.
    const rec = book.auditRecords()[0]!;
    expect(rec.evaluations).toBe(1);
  });

  it('refuses to resolve a Reckoning at any tick but its own settlement', () => {
    const book = new SealBook();
    commit(book, { tick: 100 });
    for (const atTick of [100, 286, settlement(1), settlement(0) - 1, settlement(0) + 1]) {
      expect(() =>
        book.resolve({ reckoningIndex: 0, atTick, stateVersion: 400, deeds: [] }),
      ).toThrow(SealHalt);
    }
    expect(book.isResolved(0)).toBe(false);
  });

  it('derives the Reckoning from the sealing tick — there is no field to supply it in', () => {
    // Scar #7's root cause was a persistent field whose window was decided
    // elsewhere. `SealCommit` has no `reckoningIndex`, so the scope cannot be aimed.
    const book = new SealBook();
    const early = commit(book, { tick: 5 });
    const late = commit(book, { tick: TICKS_PER_RECKONING + 5, role: null });
    expect(book.auditRecord(early.sealId!)!.reckoningIndex).toBe(0);
    expect(book.auditRecord(late.sealId!)!.reckoningIndex).toBe(1);
    expect(book.idsInReckoning(0)).toEqual([early.sealId]);
    expect(book.idsInReckoning(1)).toEqual([late.sealId]);
  });

  it('refuses a seal inside the freeze (INV-18)', () => {
    const book = new SealBook();
    const freezeTick = settlement(0);
    expect(inFreeze(freezeTick)).toBe(true);
    const refused = commit(book, { tick: freezeTick });
    expect(refused.ok).toBe(false);
    expect(refused.invariant).toBe('INV-18');
    expect(book.size).toBe(0);

    // The last tick before the freeze is still open.
    expect(commit(book, { tick: freezeTick - 1 }).ok).toBe(true);
  });

  it('a seal that lands in a resolved Reckoning is caught by INV-20, not by the door', () => {
    // A deliberate design choice, and the one place this module keeps a reachable
    // bad state on purpose. Under a monotonic tick loop it cannot happen — a seal's
    // Reckoning is derived from its own tick — but a restored snapshot or a
    // mis-migrated row can produce it, and that is what INV-20 is *for*. Refusing at
    // `commit` would make the clause unconstructible in a test, and a checker that
    // cannot be shown to fire reads exactly like a clean bill of health.
    const book = new SealBook();
    book.resolve({ reckoningIndex: 0, atTick: settlement(0), stateVersion: 400, deeds: [] });
    const late = commit(book, { tick: 10, role: null });
    expect(late.ok).toBe(true);

    const violations = checkInv20(book, settlement(0));
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.map((v) => v.id)).toContain('INV-20');
    expect(violations.map((v) => v.message).join(' ')).toContain('no verdict');
  });

  it('refuses a seal backdated behind the book’s watermark', () => {
    const book = new SealBook();
    expect(commit(book, { tick: 200 }).ok).toBe(true);
    const refused = commit(book, { tick: 199, role: null });
    expect(refused.ok).toBe(false);
    expect(refused.invariant).toBe('INV-20');
    expect(refused.hint).toContain('backdated');
    // The same tick is fine: many principals seal within one tick.
    expect(commit(book, { principal: B, tick: 200 }).ok).toBe(true);
  });

  it('seals ids sort in creation order, so resolution order is deterministic', () => {
    const book = new SealBook();
    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const r = commit(book, { tick: 100 + i, role: role('V-1', i), rolesHeld: [role('V-1', i)] });
      ids.push(r.sealId!);
    }
    expect([...book.idsInReckoning(0)]).toEqual(ids);
  });

  it('exposes the core/types.ts contract shape with the closed intent record', () => {
    const book = new SealBook();
    const r = commit(book, { tick: 100 });
    const seal = book.asSeal(r.sealId!)!;
    expect(Object.keys(seal.intent).sort(compareIds)).toEqual([
      'measure',
      'outcomeHigh',
      'outcomeLow',
      'target',
      'verb',
    ]);
    expect(seal.verdict).toBeNull();
    expect(seal.reckoningIndex).toBe(0);
  });
});

describe('PROP-D4 — mandatory, and one per role held is free', () => {
  it('a seal citing a held role costs no action; the same role twice does', () => {
    const book = new SealBook();
    const held = [role('V-1')];
    const first = commit(book, { role: held[0], rolesHeld: held });
    expect(first.costsAction).toBe(false);
    const second = commit(book, { role: held[0], rolesHeld: held });
    expect(second.costsAction).toBe(true);
  });

  it('a seal citing no role always costs an action', () => {
    const book = new SealBook();
    expect(commit(book, { role: null }).costsAction).toBe(true);
  });

  it('a role you do not hold grants nothing — the allowance is priced in a real role', () => {
    // Left unchecked, the free allowance would be priced in nothing at all, which
    // is A15's prohibition read against a budget instead of an identity.
    const book = new SealBook();
    const refused = commit(book, { role: role('V-OTHER'), rolesHeld: [role('V-1')] });
    expect(refused.ok).toBe(false);
    expect(refused.invariant).toBe('PROP-D4');
    expect(refused.hint).toContain('V-OTHER');
    expect(book.size).toBe(0);
  });

  it('free slots equal the distinct roles held, and each is spent once', () => {
    const book = new SealBook();
    const held = [role('V-1'), role('V-2'), role('V-2')];
    expect(book.freeSlotsRemaining(A, 0, held)).toBe(2);
    commit(book, { role: role('V-1'), rolesHeld: held });
    expect(book.freeSlotsRemaining(A, 0, held)).toBe(1);
    commit(book, { role: role('V-2'), rolesHeld: held });
    expect(book.freeSlotsRemaining(A, 0, held)).toBe(0);
  });

  it('the free allowance is per Reckoning, so a new Reckoning restores it', () => {
    const book = new SealBook();
    const held = [role('V-1')];
    commit(book, { tick: 100, role: held[0], rolesHeld: held });
    expect(book.freeSlotsRemaining(A, 0, held)).toBe(0);
    expect(book.freeSlotsRemaining(A, 1, held)).toBe(1);
    expect(commit(book, { tick: TICKS_PER_RECKONING + 1, role: held[0], rolesHeld: held }).costsAction).toBe(
      false,
    );
  });

  it('the mandatory half is auditable: every unsealed held role is named', () => {
    const book = new SealBook();
    const held = [role('V-1'), role('V-2', 3)];
    expect(book.unsealedRoles(A, 0, held).map(roleKey)).toEqual(['V-1#0', 'V-2#3']);

    const rejection = book.sealComplianceRejection(A, 100, held);
    expect(rejection).not.toBeNull();
    expect(rejection?.invariant).toBe('PROP-D4');
    expect(rejection?.hint).toContain('V-1#0');
    expect(rejection?.hint).toContain('free');

    commit(book, { role: held[0], rolesHeld: held });
    expect(book.unsealedRoles(A, 0, held).map(roleKey)).toEqual(['V-2#3']);
    commit(book, { role: held[1], rolesHeld: held });
    expect(book.unsealedRoles(A, 0, held)).toEqual([]);
    expect(book.sealComplianceRejection(A, 100, held)).toBeNull();
  });

  it('holding no role means nothing is owed', () => {
    const book = new SealBook();
    expect(book.sealComplianceRejection(A, 100, [])).toBeNull();
  });

  it('one principal’s seals never satisfy another’s obligation', () => {
    const book = new SealBook();
    const held = [role('V-1')];
    commit(book, { principal: A, role: held[0], rolesHeld: held });
    expect(book.unsealedRoles(B, 0, held).map(roleKey)).toEqual(['V-1#0']);
    expect(book.freeSlotsRemaining(B, 0, held)).toBe(1);
  });

  it('caps seals per principal per Reckoning (INV-26)', () => {
    const book = new SealBook();
    for (let i = 0; i < MAX_SEALS_PER_PRINCIPAL_PER_RECKONING; i += 1) {
      expect(commit(book, { role: null }).ok, `seal ${i}`).toBe(true);
    }
    const over = commit(book, { role: null });
    expect(over.ok).toBe(false);
    expect(over.invariant).toBe('INV-26');
    // The other principal is unaffected: the cap is per principal.
    expect(commit(book, { principal: B, role: null }).ok).toBe(true);
  });

  it('refuses a seal with no usable state version (INV-19)', () => {
    const book = new SealBook();
    const refused = commit(book, { version: -1 });
    expect(refused.ok).toBe(false);
    expect(refused.invariant).toBe('INV-19');
  });
});

// ── The checker must be shown to bite ────────────────────────────────────────

/**
 * A book-shaped stub. `checkInv20` reads only `auditRecords()` and `isResolved()`,
 * so each clause can be given a record that violates exactly it — the mutation
 * discipline `test/core/vocabulary-repo.test.ts` had to learn the hard way.
 */
function brokenBook(rec: SealAuditRecord, resolved: boolean): SealBook {
  return {
    auditRecords: () => [rec],
    isResolved: () => resolved,
  } as unknown as SealBook;
}

function record(over: Partial<SealAuditRecord> = {}): SealAuditRecord {
  return {
    id: 'seal:P-A:0:0000' as SealId,
    principal: A,
    reckoningIndex: 0,
    sealedAtTick: 100,
    actedOnStateVersion: 100,
    role: { venture: vid('V-1'), roleIndex: 0 },
    intent: intent(),
    prose: '',
    verdict: null,
    verdictAtTick: null,
    basis: null,
    citedDeedEventId: null,
    evaluations: 0,
    ...over,
  };
}

describe('INV-20 — the checker bites, one clause at a time', () => {
  it('a scope that disagrees with the sealing tick', () => {
    const violations = checkInv20(brokenBook(record({ reckoningIndex: 3 }), false), 100);
    expect(violations.map((v) => v.id)).toContain('INV-20');
    expect(violations[0]?.message).toContain('scoped to Reckoning 3');
  });

  it('a resolved Reckoning with a verdict-less seal', () => {
    const v = checkInv20(brokenBook(record({ evaluations: 1 }), true), 287);
    expect(v.length).toBe(1);
    expect(v[0]?.message).toContain('no verdict');
  });

  it('a seal evaluated twice — the scar #7 shape', () => {
    const v = checkInv20(
      brokenBook(record({ verdict: 'CONTRADICTED', verdictAtTick: 287, evaluations: 2 }), true),
      287,
    );
    expect(v.length).toBe(1);
    expect(v[0]?.message).toContain('evaluated 2 times');
  });

  it('a verdict stamped at a later Reckoning', () => {
    const v = checkInv20(
      brokenBook(
        record({ verdict: 'HONOURED', verdictAtTick: settlement(4), evaluations: 1 }),
        true,
      ),
      settlement(4),
    );
    expect(v.length).toBe(1);
    expect(v[0]?.message).toContain('was judged at tick');
  });

  it('a verdict before its Reckoning resolved', () => {
    const v = checkInv20(brokenBook(record({ verdict: 'HONOURED', evaluations: 1 }), false), 150);
    expect(v.length).toBe(2);
    expect(v.map((x) => x.message).join(' ')).toContain('has not resolved');
  });

  it('every violation is severity HALT — a false mark is worse than an outage', () => {
    const v = checkInv20(brokenBook(record({ reckoningIndex: 9 }), false), 100);
    for (const x of v) expect(x.severity).toBe('HALT');
  });
});
