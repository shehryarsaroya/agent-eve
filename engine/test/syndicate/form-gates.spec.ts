/**
 * The gates on `form`, pinned one at a time against a fake port.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * `form` was extracted out of `sim/runtime.ts` into `syndicate/form.ts` (D21's order). The extraction
 * is behaviour-preserving — `state_hash` is byte-identical over 900 heuristic ticks with 12 `form`s
 * applied — but `state_hash` covers the state tables and **not refusal text**, and refusal text is a
 * rules surface (scar #1). So each moved gate was mutation-tested against the existing suite, and three
 * of the four survived:
 *
 *   - the **charter fault** gate is genuinely covered — `form-through-the-front-door.spec.ts` kills a
 *     mutation of it, which is why there is no test for it here;
 *   - the **name length** gate had no test at all;
 *   - the **membership cap** gate had no test at all;
 *   - the **founding cost** gate had no test that could tell it from the throw path behind it. Breaking
 *     it still produced *a* refusal — `INV-3` off the failed charge instead of `A15` off the gate — so
 *     a test that only asserted "a poor founder founds nothing" passed either way. The invariant code is
 *     what an agent branches on, so that is what is asserted below.
 *
 * A surviving mutation on a guard you just moved is the one case where "behaviour unchanged" is a claim
 * with nothing behind it, so these close the gap rather than describing it.
 *
 * ── AND WHY IT NEEDS NO WORLD ────────────────────────────────────────────────
 *
 * This is what the port shape buys, and the reason to prefer it over passing the whole `Runtime`: a
 * fake `FormPort` of three members plus a real `Book` is the entire fixture. No HTTP harness, no tick
 * loop, no enrolment — so a gate can be pinned in milliseconds and the failure names the gate rather
 * than a route.
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { minor, type Minor } from '../../src/core/units.js';
import { Book, type SyndicateId } from '../../src/syndicate/book.js';
import { DEFAULT_CHARTER } from '../../src/syndicate/charter.js';
import { form, MAX_NAME_CHARS, type FormPort } from '../../src/syndicate/form.js';
import { FOUNDING_COST_MINOR, MAX_SYNDICATES_PER_PRINCIPAL } from '../../src/syndicate/params.js';

const FOUNDER = 'p:founder' as PrincipalId;

/**
 * A port that records what it was asked to do.
 *
 * `retired` and `pools` exist so a refusal can be shown to have charged **nothing** — the gates are
 * meant to run before any value moves, and a gate that refused after taking the money would be a worse
 * bug than no gate.
 */
function fakePort(free: Minor, opts: { readonly failCharge?: boolean } = {}): FormPort & {
  readonly retired: PrincipalId[];
  readonly pools: SyndicateId[];
} {
  const retired: PrincipalId[] = [];
  const pools: SyndicateId[] = [];
  return {
    retired,
    pools,
    freeStoresOf: () => free,
    retireFoundingCost: (args) => {
      if (opts.failCharge === true) throw new Error('stores are locked\nsecond line must not appear');
      retired.push(args.principal);
    },
    openPool: (id) => {
      pools.push(id);
    },
  };
}

const goodRequest = {
  founder: FOUNDER,
  name: 'the-house',
  charter: DEFAULT_CHARTER,
  tick: 10,
};

describe('form charges nothing until every gate has passed', () => {
  it('founds a house, retires the cost, and opens exactly one pool', () => {
    const port = fakePort(FOUNDING_COST_MINOR);
    const book = new Book();
    const out = form(port, book, goodRequest);

    expect(out.ok, out.ok ? '' : out.hint).toBe(true);
    expect(port.retired, 'the founder paid').toEqual([FOUNDER]);
    expect(port.pools.length, 'and the pool was opened once').toBe(1);
    expect(book.of(FOUNDER, 10).length).toBe(1);
  });

  it('trims the name it stores but measures the length it was given', () => {
    // Both halves matter and they are deliberately different: the original checked `name.length`
    // against the cap on the UNTRIMMED string and then stored `name.trim()`. Asserting only the stored
    // value would let a future edit move the cap onto the trimmed length, which silently widens it.
    const port = fakePort(FOUNDING_COST_MINOR);
    const book = new Book();
    const out = form(port, book, { ...goodRequest, name: '  spaced  ' });

    expect(out.ok).toBe(true);
    expect(book.of(FOUNDER, 10)[0]?.name, 'stored trimmed').toBe('spaced');
  });
});

describe('the name length gate', () => {
  it(`refuses a name longer than ${String(MAX_NAME_CHARS)} characters under A2, and charges nothing`, () => {
    const port = fakePort(FOUNDING_COST_MINOR);
    const out = form(port, new Book(), { ...goodRequest, name: 'x'.repeat(MAX_NAME_CHARS + 1) });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.invariant).toBe('A2');
    expect(out.hint, 'the refusal quotes both the cap and what was sent').toMatch(
      new RegExp(`${String(MAX_NAME_CHARS)} characters; yours is ${String(MAX_NAME_CHARS + 1)}`),
    );
    expect(port.retired, 'a refusal is free').toEqual([]);
  });

  it(`accepts a name of exactly ${String(MAX_NAME_CHARS)} characters`, () => {
    // The boundary in the other direction, so the gate cannot be tightened to `>=` without a failure.
    const out = form(fakePort(FOUNDING_COST_MINOR), new Book(), {
      ...goodRequest,
      name: 'x'.repeat(MAX_NAME_CHARS),
    });
    expect(out.ok, out.ok ? '' : out.hint).toBe(true);
  });
});

describe('the membership cap gate', () => {
  it(`refuses the ${String(MAX_SYNDICATES_PER_PRINCIPAL + 1)}th syndicate under A15 and names the cap`, () => {
    const book = new Book();
    const port = fakePort(FOUNDING_COST_MINOR);
    // Founded through `form` itself rather than seeded into the book, so the count the gate reads is
    // the count this module actually produces.
    for (let i = 0; i < MAX_SYNDICATES_PER_PRINCIPAL; i += 1) {
      const seeded = form(port, book, { ...goodRequest, name: `house-${String(i)}`, tick: 10 + i });
      expect(seeded.ok, seeded.ok ? '' : seeded.hint).toBe(true);
    }
    expect(book.of(FOUNDER, 20).length).toBe(MAX_SYNDICATES_PER_PRINCIPAL);

    const over = form(port, book, { ...goodRequest, name: 'one-too-many', tick: 20 });
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.invariant, 'a cap on divided loyalty is an A15 gate, not an A2 typo').toBe('A15');
    expect(over.hint).toMatch(new RegExp(`cap of ${String(MAX_SYNDICATES_PER_PRINCIPAL)}`));
    expect(port.retired.length, 'and the refused founder paid nothing extra').toBe(
      MAX_SYNDICATES_PER_PRINCIPAL,
    );
  });
});

describe('the founding cost gate', () => {
  it('refuses a founder one minor short under A15, before anything is charged', () => {
    const port = fakePort(minor(Number(FOUNDING_COST_MINOR) - 1));
    const out = form(port, new Book(), goodRequest);

    expect(out.ok).toBe(false);
    if (out.ok) return;
    // ★ The invariant code is the assertion that matters. Breaking the gate still refuses — the charge
    // below it throws and yields `INV-3` — so only this distinguishes "you cannot afford it" from
    // "the charge failed", and those are different facts with different fixes (A2).
    expect(out.invariant, 'the gate answers A15, not the INV-3 of a failed charge').toBe('A15');
    expect(out.hint).toMatch(/locked stores do not count/);
    expect(port.retired, 'nothing was taken from a founder that could not pay').toEqual([]);
  });

  it('reports a failed charge as INV-3 and founds nothing', () => {
    // The path behind the gate, so the pair above is meaningful rather than a single assertion twice.
    const port = fakePort(FOUNDING_COST_MINOR, { failCharge: true });
    const book = new Book();
    const out = form(port, book, goodRequest);

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.invariant).toBe('INV-3');
    expect(out.hint, 'and it says nothing was founded').toMatch(/nothing was founded/);
    // Pins `describeError`'s first-line-only contract, which is the behaviour the extracted copy in
    // `syndicate/describe.ts` has to keep: a multi-line throw must not spill its second line into a
    // hint an agent reads.
    expect(out.hint).toContain('stores are locked');
    expect(out.hint, 'only the first line of the throw reaches the agent').not.toContain('second line');
    expect(book.of(FOUNDER, 10).length).toBe(0);
  });
});
