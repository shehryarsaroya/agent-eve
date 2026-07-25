/**
 * PROP-O1 — **no eligible affordance is ever dropped uncounted.**
 *
 * > "The budget is met by eligibility filtering, never truncation, and every omission
 * > appears in `withheld` with a reason. Random states, exact count. *(Truncation is
 * > invisible to tests and indistinguishable, from the agent's side, from the world
 * > changing underneath it.)*"
 *
 * Three layers here, and the first is the one that matters most:
 *
 * 1. **Truncation is unrepresentable.** There is no `TRUNCATED` ground, so a slice has
 *    nothing to write in the `ground` column. Asserted against the closed set, because
 *    the day somebody adds one this test is the thing that argues with them.
 * 2. **The arithmetic balances**, per field, over random worlds.
 * 3. **What is paged is retrievable**, free, through the paginated read — which is what
 *    makes `PAGED` an honest ground rather than a polite one.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minor } from '../../src/core/units.js';
import {
  LIST_CAPS,
  PAGED,
  RUNGS,
  ServiceDesk,
  WITHHELD_FIELDS,
  WITHHELD_GROUNDS,
  WithheldTally,
  accountingFaults,
  buildObservation,
  checkObservation,
  pageBy,
  withheldFaults,
} from '../../src/observe/index.js';
import {
  ALICE,
  BRAM,
  CASS,
  DOV,
  ESK,
  bookRow,
  brokeFixture,
  fill,
  fixture,
  goLive,
  grantFrom,
  levyOwing,
  makeHaul,
  makeTopYield,
  signAll,
  sourcesFor,
  vid,
} from './fixture.js';

describe('PROP-O1 — truncation is unrepresentable', () => {
  it('has no ground that means "we cut the list"', () => {
    // The structural version of the promise. A reviewer adding TRUNCATED has to
    // delete this assertion, which is a conversation rather than a commit.
    for (const forbidden of ['TRUNCATED', 'TRIMMED', 'CAPPED', 'ELIDED', 'OVERFLOW']) {
      expect(WITHHELD_GROUNDS as readonly string[]).not.toContain(forbidden);
    }
    expect(PAGED).toBe('PAGED');
  });

  it('names its fields in the payload’s own dotted spelling, so a row is actionable', () => {
    expect(WITHHELD_FIELDS).toEqual([
      'affordances',
      'ventures.mine',
      'ventures.board',
      'ventures.talks',
      'counterparties',
      'market',
      'grants',
    ]);
  });
});

describe('PROP-O1 — the arithmetic balances, per field', () => {
  it('balances on a loaded world', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [BRAM, CASS], minor(12_000));
    const built = buildObservation(
      sourcesFor(f, {
        levy: levyOwing(f),
        market: [bookRow(f.stage, 'ore'), bookRow(f.stage, 'ice')],
        grants: [grantFrom({ delegate: BRAM })],
        talks: [{ venture: haul.id, counterparty: BRAM, unread: 1, last_tick: 1 }],
      }),
      ALICE,
    );
    expect(built.accounting).toEqual([]);
    expect(withheldFaults(built.observation)).toEqual([]);
  });

  it('balances for random budgets, ticks and principals', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [BRAM, CASS], minor(12_000));
    const forming = makeHaul(f, {
      id: vid('v-haul-2'),
      creator: DOV,
      windowClosesTick: 250,
      resolvesAtTick: 280,
    });
    fill(f, forming, 0, ESK, 1);

    fc.assert(
      fc.property(
        fc.constantFrom(ALICE, BRAM, CASS, DOV, ESK),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 1, max: 287 }),
        fc.boolean(),
        (principal, actions, tick, withLevy) => {
          const built = buildObservation(
            sourcesFor(f, {
              tick,
              actionsRemaining: actions,
              levy: withLevy ? levyOwing(f) : null,
              market: [bookRow(f.stage, 'ore')],
            }),
            principal,
          );
          // The exact count, per field, for every state the generator produces.
          expect(built.accounting).toEqual([]);
          expect(checkObservation(built.observation)).toEqual([]);
        },
      ),
      { numRuns: 120 },
    );
  });

  it('counts a Commons refusal rather than silently omitting it', () => {
    // RAID and SIEGE are hostile, the fixture seats everyone in the Commons, and A8
    // makes them invalid there. The agent must be told that, with the ground.
    const f = fixture();
    const built = buildObservation(sourcesFor(f), ALICE);
    const rows = built.observation.header.withheld.filter((r) => r.ground === 'COMMONS_FLOOR');
    expect(rows.length).toBe(1);
    expect(rows[0]?.count).toBeGreaterThanOrEqual(2);
    expect(built.observation.affordances.some((a) => a.params['kind'] === 'RAID')).toBe(false);
  });

  it('counts the action budget as a ground, and only for material verbs', () => {
    const f = fixture();
    const withBudget = buildObservation(sourcesFor(f, { actionsRemaining: 4 }), ALICE);
    const without = buildObservation(sourcesFor(f, { actionsRemaining: 0 }), ALICE);
    const spent = without.observation.header.withheld.find((r) => r.ground === 'ACTS_SPENT');
    expect(spent?.count).toBeGreaterThan(0);
    // Free verbs survive a spent budget: agent.md §7 promises "social verbs are free".
    expect(without.observation.affordances.every((a) => a.cost === 0)).toBe(true);
    expect(without.observation.affordances.length).toBeGreaterThan(0);
    expect(withBudget.observation.affordances.length).toBeGreaterThan(
      without.observation.affordances.length,
    );
  });

  it('counts SHORT_FUNDS rather than offering a signature nobody can fund', () => {
    const f = brokeFixture();
    const haul = makeHaul(f);
    fill(f, haul, 0, BRAM, 1);
    fill(f, haul, 1, CASS, 1);
    const built = buildObservation(sourcesFor(f), ALICE);
    expect(built.observation.affordances.some((a) => a.verb === 'sign')).toBe(false);
    expect(built.observation.header.withheld.some((r) => r.ground === 'SHORT_FUNDS')).toBe(true);
    expect(built.accounting).toEqual([]);
  });

  it('counts UNSENSED for a book the principal has nobody standing in', () => {
    const f = fixture();
    const elsewhere = [...f.world.map.systemOrder].find((s) => s !== f.stage);
    expect(elsewhere).toBeDefined();
    if (elsewhere === undefined) return;
    const built = buildObservation(sourcesFor(f, { market: [bookRow(elsewhere, 'ore')] }), ALICE);
    expect(built.observation.market.books).toEqual([]);
    expect(built.observation.header.withheld.some((r) => r.ground === 'UNSENSED')).toBe(true);
  });

  it('counts NO_RECORD instead of inventing a clean standing sheet', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [BRAM, CASS], minor(12_000));
    const built = buildObservation(sourcesFor(f, { standingOf: () => null }), ALICE);
    expect(built.observation.counterparties).toEqual([]);
    const row = built.observation.header.withheld.find(
      (r) => r.field === 'counterparties' && r.ground === 'NO_RECORD',
    );
    expect(row?.count).toBe(2);
    expect(built.accounting).toEqual([]);
  });
});

describe('PROP-O1 — a mandatory affordance survives every rung', () => {
  it('keeps a protected item past the cap and pages the rest', () => {
    const tally = new WithheldTally();
    const items = [1, 2, 3, 4, 5, 6];
    const kept = pageBy(items, 2, tally, 'affordances', (n) => n === 5);
    // Order preserved, the protected item kept, the overflow counted exactly. The cap
    // is a total: one protected item leaves room for one other, and `5` keeps its
    // place rather than being hoisted to the front.
    expect(kept).toEqual([1, 5]);
    expect(tally.forGround('affordances', 'PAGED')).toBe(4);
  });

  it('keeps a protected item even when the mandatory set alone exceeds the cap', () => {
    const tally = new WithheldTally();
    const kept = pageBy([1, 2, 3], 1, tally, 'affordances', () => true);
    expect(kept).toEqual([1, 2, 3]);
    expect(tally.total()).toBe(0);
  });

  it('rung 0 publishes every mandatory affordance', () => {
    // A world with a Levy, an unsealed role, an unsigned venture and a ballot — four
    // mandatory sources at once. This is the *baseline*: nothing here is narrowed, and
    // the test below is the one that exercises the ladder.
    const f = fixture();
    const haul = makeHaul(f);
    fill(f, haul, 0, BRAM, 1);
    fill(f, haul, 1, CASS, 1);
    const sources = sourcesFor(f, {
      levy: levyOwing(f),
      ballots: [{ id: 'b-1', kind: 'LEVY', closes_tick: 200, voted: false, target: null }],
      market: [bookRow(f.stage, 'ore')],
    });
    const built = buildObservation(sources, ALICE);
    // Named, because this test was titled "the floor rung keeps every mandatory
    // affordance" while building a world that reaches rung 0 — so it proved nothing
    // about any rung, and deleting `mandatory` from both `keepMaterial` and `pageBy`'s
    // protect predicate left the whole suite green.
    expect(built.rung).toBe(0);
    const verbs = built.observation.affordances.map((a) => a.verb);
    expect(verbs).toContain('sign');
    expect(verbs).toContain('vote');
    expect(verbs).toContain('set_delivery_intent');
    expect(built.accounting).toEqual([]);
  });

  it('THE FLOOR RUNG keeps every mandatory affordance, past its own cap', () => {
    // `affordance.ts` calls `mandatory` "the one flag the narrowing ladder may never
    // override", and `observation.ts:pageBy` says a mandatory affordance dropped to
    // satisfy a size budget "is exactly the trade PROP-O1 forbids". Both claims live in
    // the two code paths only the last rung runs — `keepMaterial` and the `protect`
    // predicate — so they need a world that actually gets there.
    //
    // The harm if they break: the Levy is A14's undodgeable obligation, sealing is §11.1's
    // requirement before the freeze, and a ballot closes. An agent whose payload silently
    // dropped one of those misses a deadline it was never shown.
    const f = fixture();
    // A LIVE venture ALICE holds a role in (an unsealed role -> mandatory `seal`).
    const live = makeHaul(f, { id: vid('v-seal-me'), creator: BRAM });
    goLive(f, live, [ALICE, CASS], minor(12_000));
    // A venture of ALICE's own awaiting its countersignature -> mandatory `sign`.
    const waiting = makeHaul(f, { id: vid('v-sign-me'), creator: ALICE });
    fill(f, waiting, 0, DOV, 1);
    fill(f, waiting, 1, ESK, 1);
    // And enough of everything else that the ladder has to reach the floor.
    for (let i = 0; i < 40; i += 1) {
      makeHaul(f, {
        id: vid(`v-bulk-${String(i).padStart(2, '0')}`),
        creator: DOV,
        windowClosesTick: 200,
        resolvesAtTick: 250,
      });
    }
    const sources = sourcesFor(f, {
      tick: 5,
      levy: levyOwing(f, 900_000_000),
      ballots: [{ id: 'b-1', kind: 'LEVY', closes_tick: 200, voted: false, target: null }],
      market: [bookRow(f.stage, 'ore'), bookRow(f.stage, 'ice'), bookRow(f.stage, 'alloy')],
      grants: [grantFrom({ delegate: BRAM }), grantFrom({ id: 'g-2', delegate: CASS })],
      talks: Array.from({ length: 20 }, (_, i) => ({
        venture: vid(`v-bulk-${String(i).padStart(2, '0')}`),
        counterparty: ESK,
        unread: 1,
        last_tick: 1,
      })),
    });
    const built = buildObservation(sources, ALICE);

    // The ladder genuinely ran to the last rung — the assertion the old test lacked.
    expect(built.rung, 'this world must reach the floor rung or the test proves nothing').toBe(
      RUNGS.length - 1,
    );
    const verbs = built.observation.affordances.map((a) => a.verb);
    for (const mandatory of ['seal', 'sign', 'vote', 'set_delivery_intent']) {
      expect(verbs, `the floor rung dropped the mandatory '${mandatory}'`).toContain(mandatory);
    }
    // Kept even though there are more mandatory affordances than the floor's own cap
    // allows: protection beats the cap, and `fits` is how we find out we overran.
    expect(built.observation.affordances.length).toBeGreaterThan(0);
    expect(built.accounting).toEqual([]);
  });
});

describe('PROP-O1 — what is paged is retrievable, free', () => {
  it('the paginated read returns exactly the affordances the payload paged', () => {
    // Force paging with a cap of 1, then assert the page service can reach the rest.
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [BRAM, CASS], minor(12_000));
    const sources = sourcesFor(f);
    const built = buildObservation(sources, ALICE);
    const desk = new ServiceDesk();

    const page = desk.page(sources, ALICE, 0, 1);
    expect(page.served).toBe(true);
    if (!page.served) return;
    expect(page.value.items.length).toBe(1);
    expect(page.value.next).toBe(1);

    // Walk every page and assert the union is the whole catalogue.
    const seen: string[] = [];
    let cursor: number | null = 0;
    const desk2 = new ServiceDesk();
    while (cursor !== null) {
      const reply = desk2.page(sources, ALICE, cursor, 2);
      expect(reply.served).toBe(true);
      if (!reply.served) return;
      for (const item of reply.value.items) seen.push(`${item.verb}::${item.quote_id}`);
      cursor = reply.value.next;
    }
    const inPayload = built.observation.affordances.map((a) => `${a.verb}::${a.quote_id}`);
    for (const key of inPayload) expect(seen).toContain(key);
  });

  it('paging costs no action and mints no new quote for the same tick', () => {
    const f = fixture();
    const sources = sourcesFor(f);
    const built = buildObservation(sources, ALICE);
    const desk = new ServiceDesk();
    const page = desk.page(sources, ALICE, 0, LIST_CAPS.affordances);
    expect(page.served).toBe(true);
    if (!page.served) return;
    // Same tick, same terms, same id — the quote book is idempotent, which is what
    // makes a page a *read* of the observation rather than a second offer.
    const first = built.observation.affordances[0];
    expect(first).toBeDefined();
    expect(page.value.items.map((a) => a.quote_id)).toContain(first?.quote_id);
  });
});

describe('the omission ledger can never itself be truncated', () => {
  it('the reachable (field, ground) pairs fit inside the declared cap', () => {
    // `WithheldTally.rows()` **throws** above the cap rather than dropping a row,
    // because a truncated omission ledger is the exact failure PROP-O1 exists to
    // prevent. That makes the cap load-bearing, and it is only safe if the reachable
    // set is smaller. Enumerated here rather than argued in a comment, because
    // `tokens.ts:floorWorstCaseChars` pays for `withheldRows` at its full cap and the
    // whole budget proof rests on this number.
    const reachable: Record<string, readonly string[]> = {
      affordances: [
        'ACTS_SPENT',
        'WAKE_SPENT',
        'HALTED',
        'FROZEN',
        'NO_HAND_FREE',
        'OUT_OF_REACH',
        'COMMONS_FLOOR',
        'COMMONS_BOUND',
        'SHORT_FUNDS',
        'NO_PRICE',
        'LIMITS_SPENT',
        'WINDOW_SHUT',
        'UNSENSED',
        'NO_RECORD',
        'PAGED',
      ],
      'ventures.mine': ['PAGED'],
      'ventures.board': ['WINDOW_SHUT', 'NO_HAND_FREE', 'OUT_OF_REACH', 'NO_RECORD', 'PAGED'],
      'ventures.talks': ['PAGED'],
      counterparties: ['NO_RECORD', 'PAGED'],
      market: ['UNSENSED', 'PAGED'],
      grants: ['PAGED'],
    };
    let pairs = 0;
    for (const field of WITHHELD_FIELDS) {
      const grounds = reachable[field];
      expect(grounds, `${field} has no enumerated reachable grounds`).toBeDefined();
      for (const ground of grounds ?? []) {
        expect(WITHHELD_GROUNDS as readonly string[]).toContain(ground);
      }
      pairs += (grounds ?? []).length;
    }
    expect(pairs).toBeLessThanOrEqual(LIST_CAPS.withheldRows);
  });

  it('a tally at the cap still emits every row', () => {
    const tally = new WithheldTally();
    let added = 0;
    for (const field of WITHHELD_FIELDS) {
      for (const ground of WITHHELD_GROUNDS) {
        if (added >= LIST_CAPS.withheldRows) break;
        tally.add(field, ground, 1);
        added += 1;
      }
      if (added >= LIST_CAPS.withheldRows) break;
    }
    expect(tally.rows().length).toBe(added);
    expect(tally.total()).toBe(added);
  });

  it('throws rather than dropping a row when the cap is genuinely exceeded', () => {
    // The loud failure. If the enumeration above ever becomes wrong, this is what CI
    // sees — not a silently shortened list.
    const tally = new WithheldTally();
    let added = 0;
    outer: for (const field of WITHHELD_FIELDS) {
      for (const ground of WITHHELD_GROUNDS) {
        tally.add(field, ground, 1);
        added += 1;
        if (added > LIST_CAPS.withheldRows) break outer;
      }
    }
    expect(() => tally.rows()).toThrow(/rather than dropping a row/);
  });
});

describe('the accounting checker itself bites', () => {
  it('reports a field whose numbers do not add up', () => {
    const tally = new WithheldTally();
    tally.add('affordances', 'ACTS_SPENT', 2);
    const faults = accountingFaults([{ field: 'affordances', candidates: 10, shown: 5 }], tally);
    expect(faults.join(' ')).toContain('PROP-O1');
  });

  it('reports a field that counted omissions but was never accounted', () => {
    const tally = new WithheldTally();
    tally.add('market', 'UNSENSED', 1);
    expect(accountingFaults([], tally).join(' ')).toContain('never accounted');
  });

  it('refuses a zero-count row, so a row always means something was withheld', () => {
    const tally = new WithheldTally();
    tally.add('affordances', 'PAGED', 0);
    expect(tally.rows()).toEqual([]);
  });

  it('the ladder is ordered least-decision-relevant first and ends at the floor', () => {
    expect(RUNGS[0]?.name).toBe('rung0');
    expect(RUNGS[RUNGS.length - 1]?.name).toBe('floor');
    expect(RUNGS.length).toBeGreaterThan(2);
  });

  it('a top-yield venture’s slots are accounted even when none is fillable', () => {
    const f = fixture();
    const build_ = makeTopYield(f, 'BUILD', vid('v-build-1'), ALICE);
    signAll(f, build_);
    const built = buildObservation(sourcesFor(f), BRAM);
    expect(built.accounting).toEqual([]);
    expect(build_.roles.length).toBeGreaterThanOrEqual(4);
  });
});
