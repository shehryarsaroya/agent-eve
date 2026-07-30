/**
 * The gates on `apply` and its contribution branch, pinned one at a time against a fake port.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * `apply` was extracted out of `sim/runtime.ts` into `syndicate/apply.ts` (D21's order). Of its six
 * gates, mutation testing against the existing suite killed three and left three standing. Those three
 * are not one thing:
 *
 *   - **the positive-stake gate was a real hole.** Remove it and a `stake` of 0 walks straight through
 *     `spendable < amount` (false), transfers nothing, and the runtime publishes a PUBLIC
 *     `syndicate.pooled` row for a contribution that never happened — a permanent record of a payment
 *     nobody made, which is the A5' failure the record exists to not commit. Pinned below.
 *   - **the not-a-syndicate gate is PARTLY redundant.** `admissionFault` also refuses an unknown id, so
 *     removing this gate still produces a refusal — but a *different sentence*: the terse
 *     "X is not a syndicate." instead of the one that tells an agent charters are PUBLIC and readable
 *     off the feed before it commits. Refusal text is a rules surface (scar #1), so the richer sentence
 *     is what is asserted, and the mutation now dies on the wording rather than on the outcome.
 *   - **the admissionFault gate is fully redundant**, exactly as in `admit`: `Book.admit` calls the same
 *     predicate and throws the same single-line string. Kept for the same reason and asserted the same
 *     way — see `admit-gates.spec.ts`.
 *
 * ── AND WHAT `state_hash` COULD NOT SAY ──────────────────────────────────────
 *
 * The heuristic cast never issues `apply` in 900 ticks, so the byte-identical hash stream that backs
 * this extraction is silent about every line below. It proves the other verbs still behave; these
 * assertions are the only evidence for this one.
 */

import { describe, expect, it } from 'vitest';
import { readIntOrFault, type IntRead } from '../../src/core/params.js';
import type { PrincipalId } from '../../src/core/types.js';
import { minor, type Minor } from '../../src/core/units.js';
import { Book, type SyndicateId } from '../../src/syndicate/book.js';
import { DEFAULT_CHARTER, type Charter } from '../../src/syndicate/charter.js';
import { apply, type ApplyPort } from '../../src/syndicate/apply.js';

const FOUNDER = 'p:founder' as PrincipalId;
const JOINER = 'p:joiner' as PrincipalId;

const OPEN: Charter = { ...DEFAULT_CHARTER, admission: 'OPEN' };
const INVITE: Charter = { ...DEFAULT_CHARTER, admission: 'INVITE' };

interface Recording extends ApplyPort {
  readonly moved: { readonly member: PrincipalId; readonly amount: Minor }[];
  readonly pools: SyndicateId[];
}

function fakePort(earnings: Minor, opts: { readonly failTransfer?: boolean } = {}): Recording {
  const moved: { member: PrincipalId; amount: Minor }[] = [];
  const pools: SyndicateId[] = [];
  return {
    moved,
    pools,
    freeCashOf: () => earnings,
    openPool: (id) => {
      pools.push(id);
    },
    transferToPool: (args) => {
      if (opts.failTransfer === true) throw new Error('the stores are locked\nand a second line');
      moved.push({ member: args.member, amount: args.amount });
    },
  };
}

function bookWith(charter: Charter): { readonly book: Book; readonly id: SyndicateId } {
  const book = new Book();
  const row = book.form({ founder: FOUNDER, name: 'the-house', charter, tick: 1 });
  return { book, id: row.id };
}

const req = (over: Partial<Parameters<typeof apply>[2]> = {}): Parameters<typeof apply>[2] => ({
  applicant: JOINER,
  syndicate: 'syn:x' as SyndicateId,
  stake: { kind: 'ABSENT' },
  tick: 5,
  ...over,
});

/** A stake that parsed. */
const paid = (value: number): IntRead => ({ kind: 'OK', value });

describe('apply admits under OPEN', () => {
  it('seats the applicant and reports JOINED', () => {
    const { book, id } = bookWith(OPEN);
    const out = apply(fakePort(minor(0)), book, req({ syndicate: id }));

    expect(out.ok, out.ok ? '' : out.hint).toBe(true);
    if (!out.ok) return;
    expect(out.value.kind).toBe('JOINED');
    expect(book.isMember(id, JOINER, 5)).toBe(true);
  });

  it('refuses an unknown syndicate with the sentence that says charters are readable first', () => {
    // ★ Kills a mutation that `admissionFault` would otherwise cover. Removing this gate still refuses,
    // but with "X is not a syndicate." — losing the only sentence that tells an agent WHERE to look
    // before it spends another action guessing (A2).
    const out = apply(fakePort(minor(0)), new Book(), req({ syndicate: 'syn:ghost' as SyndicateId }));

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.invariant).toBe('A2');
    expect(out.hint).toMatch(/there is no syndicate syn:ghost/);
    expect(out.hint, 'and it points at the feed rather than just saying no').toMatch(
      /charters are PUBLIC — read them off the/,
    );
  });

  it('refuses under INVITE, naming the members who can answer and that message is free', () => {
    const { book, id } = bookWith(INVITE);
    const out = apply(fakePort(minor(0)), book, req({ syndicate: id }));

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.hint).toMatch(/charter is INVITE/);
    expect(out.hint, 'the sitting members are named, so the next step is concrete').toMatch(
      new RegExp(FOUNDER),
    );
    expect(out.hint, 'and that asking costs no action').toMatch(/costs no action/);
    expect(book.isMember(id, JOINER, 5), 'nothing was queued and nobody joined').toBe(false);
  });
});

describe('applying again is contributing, and it spends EARNINGS only', () => {
  function memberBook(): { readonly book: Book; readonly id: SyndicateId } {
    const made = bookWith(OPEN);
    made.book.admit(made.id, JOINER, 2);
    return made;
  }

  it('pools the stake and reports POOLED with the amount', () => {
    const { book, id } = memberBook();
    const port = fakePort(minor(1_000));
    const out = apply(port, book, req({ syndicate: id, stake: paid(600) }));

    expect(out.ok, out.ok ? '' : out.hint).toBe(true);
    if (!out.ok) return;
    expect(out.value.kind).toBe('POOLED');
    if (out.value.kind !== 'POOLED') return;
    expect(out.value.staked).toBe(600);
    expect(port.moved).toEqual([{ member: JOINER, amount: 600 }]);
    expect(port.pools, 'the pool is opened before value moves into it').toEqual([id]);
  });

  const refused: readonly [string, IntRead][] = [
    ['absent', { kind: 'ABSENT' }],
    ['zero', paid(0)],
    ['negative', paid(-50)],
  ];
  it.each(refused)('refuses a %s stake and moves nothing', (_label, stake) => {
    // ★ The real hole this file was written for. Without the gate a stake of 0 passes `spendable < 0`,
    // transfers nothing, and the caller publishes a PUBLIC `syndicate.pooled` row for a contribution
    // that never happened.
    const { book, id } = memberBook();
    const port = fakePort(minor(1_000));
    const out = apply(port, book, req({ syndicate: id, stake }));

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.invariant).toBe('A2');
    expect(out.hint, 'it says you are already in').toMatch(/already a member/);
    expect(out.hint, 'and that the pooling terms are permanent').toMatch(/treasury_offices/);
    expect(port.moved, 'nothing moved').toEqual([]);
  });

  it('tells a member that sent a STRING that it sent a string, and shows it', () => {
    // ★ The absent-vs-malformed split. Before this, `{"stake":"600"}` got the same sentence as sending
    // no stake at all — *"send {"stake":N}"* — so an agent that believed it had done exactly that had no
    // way to learn otherwise from the hint, and would resend identical JSON forever.
    const { book, id } = memberBook();
    const port = fakePort(minor(1_000));
    const out = apply(port, book, {
      ...req({ syndicate: id }),
      stake: readIntOrFault({ stake: '600' }, ['stake', 'amount', 'contribute']),
    });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.hint, 'it names the offending key').toMatch(/`stake` has to be a JSON number/);
    expect(out.hint, 'and quotes what arrived, so the agent can see its own mistake').toMatch(
      /you sent the string "600"/,
    );
    expect(out.hint, 'and says how to fix it').toMatch(/unquoted and whole/);
    expect(port.moved).toEqual([]);
  });

  it('names a fraction as a fraction rather than as a missing number', () => {
    const { book, id } = memberBook();
    const out = apply(fakePort(minor(1_000)), book, {
      ...req({ syndicate: id }),
      stake: readIntOrFault({ stake: 12.5 }, ['stake', 'amount', 'contribute']),
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.hint).toMatch(/you sent 12\.5, which is a fraction/);
  });

  it('accepts a good spelling even when a bad one is also present', () => {
    // `{"stake":"600","amount":600}` plainly means 600. Refusing on the bad spelling when a good one
    // parsed would be strictness with no safety in it.
    const { book, id } = memberBook();
    const port = fakePort(minor(1_000));
    const out = apply(port, book, {
      ...req({ syndicate: id }),
      stake: readIntOrFault({ stake: '600', amount: 600 }, ['stake', 'amount', 'contribute']),
    });
    expect(out.ok, out.ok ? '' : out.hint).toBe(true);
    expect(port.moved).toEqual([{ member: JOINER, amount: 600 }]);
  });

  it('refuses a stake beyond EARNINGS under A15 and names D7', () => {
    // The gate that keeps free enrolment from becoming somebody else's capital. `freeCashOf` is
    // earnings, NOT free stores: the starter stake must not be poolable or an operator founds a house,
    // takes the office, and has every puppet pay in.
    const { book, id } = memberBook();
    const port = fakePort(minor(100));
    const out = apply(port, book, req({ syndicate: id, stake: paid(101) }));

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.invariant).toBe('A15');
    expect(out.hint).toMatch(/you can pool 100 and asked to pool 101/);
    expect(out.hint).toMatch(/D7\/A15/);
    expect(port.moved).toEqual([]);
  });

  it('reports a failed transfer as INV-3, first line only, and pools nothing', () => {
    const { book, id } = memberBook();
    const port = fakePort(minor(1_000), { failTransfer: true });
    const out = apply(port, book, req({ syndicate: id, stake: paid(600) }));

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.invariant).toBe('INV-3');
    expect(out.hint).toMatch(/nothing moved/);
    expect(out.hint).toContain('the stores are locked');
    expect(out.hint, 'describeError takes the first line only').not.toContain('second line');
    expect(port.moved).toEqual([]);
  });
});

describe('the eight lines that were in the file twice', () => {
  it('routes a sitting member to the contribution branch exactly once', () => {
    // The duplicated block found while extracting this handler was `if (row !== null &&
    // isMember(...)) return contribute(...)`, present twice, the second unreachable. `transferToPool`
    // recording every call is what makes "once" an assertion rather than a hope: a second live copy
    // could only show up here as a second movement or a second refusal.
    const { book, id } = bookWith(OPEN);
    book.admit(id, JOINER, 2);
    const port = fakePort(minor(1_000));
    const out = apply(port, book, req({ syndicate: id, stake: paid(250) }));

    expect(out.ok).toBe(true);
    expect(port.moved.length, 'one contribution, not two').toBe(1);
    expect(port.pools.length).toBe(1);
  });
});

describe('the admissionFault gate is redundant with the book, and that is asserted not assumed', () => {
  it('gives the same refusal whether the gate or the book catches a full syndicate', () => {
    // Same reasoning as `admit-gates.spec.ts`: `Book.admit` calls `admissionFault` too, so deleting the
    // gate passes everything. The equivalence is pinned so that whoever removes the book's own check
    // learns here that the gate has become load-bearing.
    const { book, id } = bookWith(OPEN);
    book.admit(id, JOINER, 2);
    // A member re-applying with no stake takes the contribution branch, so reach the fault directly.
    const fault = book.admissionFault(id, JOINER, 5);
    expect(fault, 'the book already refuses a sitting member').toMatch(/already a member/);

    const direct = ((): string => {
      try {
        book.admit(id, JOINER, 5);
        return 'no throw';
      } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error);
      }
    })();
    expect(direct, 'and throws that same string').toBe(fault);
  });
});
