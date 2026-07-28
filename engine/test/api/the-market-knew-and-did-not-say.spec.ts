/**
 * TWO MORE THINGS THE ENGINE KNEW AND DID NOT SAY — the sequel, one day later, and both
 * found by blind probes playing the live shard.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A2: *"Known arithmetic is exact and machine-readable… never make an agent need a wiki."***
 * `the-engine-knew-and-did-not-say.spec.ts` is this file's model and closed three instances
 * of the same class. These are the fourth and fifth, and the fourth landed on the **newest**
 * mechanic one field over from the fix — which is the argument for treating the class as
 * standing rather than as three bugs that happened to rhyme.
 *
 *   4. **`market.transferable_minor: 0` beside a six-figure balance.** `p:probe-scout-01`, a
 *      real enrolled principal in the MARCHES holding **200,000 currency and 40,116 `ration`**:
 *
 *          trade affordances offered ....... 0
 *          market.transferable_minor ....... 0
 *          "endowment" in the observation .. 0 occurrences
 *          "earned"    in the observation .. 0 occurrences
 *          header.withheld.count ........... 2   (a venture slot, and demand)
 *
 *      and `header.withheld` closes with *"Nothing you were eligible for has been dropped
 *      without this count."* **That promise was false for `trade`.** The rule underneath is
 *      correct and was built deliberately (D7): transferable currency is
 *      `balance − endowmentRemaining`, which is what stops N free identities becoming
 *      N × 250,000 of capital (A15). *The rule is not the defect. The silence was.*
 *
 *   5. **`resolves_at_tick: 287` on an `ABANDONED` venture.** From the first probe that ever
 *      reached a settlement. Every field individually accurate — `resolvesAtTick` is a stored
 *      value — and together a false fact about the future. It planned around that settlement,
 *      waited, and nothing happened. Same shape as #4: a number true in isolation and
 *      misleading in place.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## How these assert
 *
 * **Against the engine's own recorded answer, never a literal beside it.** The refusal
 * sentences come from `tradeCheck` — the same `planOrder` the `trade` verb runs — the
 * endowment figures from `freeCash` and `Ledger.endowments`, and the terminal-venture claim is
 * checked against a venture the engine really retired rather than one the test set a field on.
 * A sentence that is only true of itself is the defect, not the test.
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import { canonicalize, type CanonicalValue } from '../../src/core/canonical.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { minor, qty } from '../../src/core/units.js';
import { ENDOWMENT_GOOD, ENDOWMENT_GOOD_FLOOR_QTY, STARTER_STAKE } from '../../src/ledger/endowment.js';
import { CURRENCY_FAUCET, CURRENCY_SINK, storesAccount } from '../../src/ledger/index.js';
import type { EventId } from '../../src/core/types.js';
import {
  ENDOWMENT_GOODS_RULE,
  ENDOWMENT_RULE,
  MAKER_NOTE,
  freeCash,
  sellableGoods,
  tradeCheck,
} from '../../src/market/index.js';
import type { Runtime } from '../../src/sim/runtime.js';
import { handsOf } from '../../src/world/index.js';
import { ALICE, BOB, GOOD, act, submit, tick, world } from '../market/fixture.js';

function observation(runtime: Runtime, principal: PrincipalId): ReturnType<typeof buildObservation> {
  return buildObservation({
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 4,
    stale: false,
    corrections: [],
    actionsRemaining: 4,
  });
}

function withheld(runtime: Runtime, principal: PrincipalId): { count: number; verbs: string[]; reason: string } {
  const w = observation(runtime, principal).header['withheld'] as Record<string, unknown>;
  return {
    count: Number(w['count']),
    verbs: (w['verbs'] ?? []) as string[],
    reason: String(w['reason']),
  };
}

function endowment(runtime: Runtime, principal: PrincipalId): Record<string, unknown> {
  return observation(runtime, principal).market['endowment'] as Record<string, unknown>;
}

/**
 * A newcomer: seated, with **nothing but its endowment**.
 *
 * Not `market/fixture.ts`'s `world()`, which funds every principal above the floor on purpose
 * — that fixture exists so the matcher can be tested at all. This one reproduces the probe:
 * a real principal whose whole balance is stake, which is the state `freeCash` returns 0 for
 * and the state that had no sentence anywhere.
 */
function newcomerWorld(seed: string): { runtime: Runtime; venue: SystemId } {
  const w = world(seed);
  const runtime = w.runtime;
  runtime.seat(ALICE, 'alice', w.venue);
  runtime.standing.open(ALICE);
  return { runtime, venue: w.venue };
}

// ── 4. the endowment, and the trade that was silently impossible ─────────────

describe('D7 — the endowment explains itself, at zero and above it', () => {
  it('★ THE EXACT TWO GREPS THAT CAME BACK EMPTY ON THE LIVE SHARD NOW MATCH', () => {
    // The finding was made with `grep -c` against a real principal's whole observation and both
    // returned 0. This is that check, against the payload rather than against a field somebody
    // remembered to build — the difference between "the field is computed" and "the agent can
    // read it", which this project has been fooled by a dozen times.
    const { runtime } = newcomerWorld('a2-mkt-grep');
    tick(runtime);
    const payload = canonicalize(observation(runtime, ALICE) as unknown as CanonicalValue);
    expect(payload, 'the whole observation must contain the word').toContain('endowment');
    expect(payload, 'and it must say what unlocks it').toContain('PAID');
    expect(payload, 'and it must name the floor on the GOODS side too').toContain('floor_qty');
  });

  it('every figure in the block is the engine’s own, not a literal beside it', () => {
    const { runtime } = newcomerWorld('a2-mkt-figures');
    tick(runtime);
    const block = endowment(runtime, ALICE);

    // Non-vacuity first: the subject is a principal that really is all-endowment, or every
    // identity below is true of nothing.
    expect(block, 'market.endowment is missing entirely').toBeDefined();
    expect(Number(block['remaining_minor']), 'the fixture must not have spent any stake').toBe(STARTER_STAKE);
    expect(Number(block['balance_minor']), 'and it must actually hold money').toBeGreaterThan(0);

    // The SAME calls `market.transferable_minor` and `planOrder` make. A second derivation here
    // would let the field and its own explanation disagree and both tests still pass.
    expect(block['transferable_minor']).toBe(freeCash(runtime.ledger, ALICE));
    expect(block['remaining_minor']).toBe(runtime.ledger.endowments.remaining(ALICE));
    expect(block['balance_minor']).toBe(runtime.ledger.freeBalance(storesAccount(ALICE)));
    expect(block['endowment_good']).toBe(ENDOWMENT_GOOD);
    expect(block['floor_qty']).toBe(ENDOWMENT_GOOD_FLOOR_QTY);
    // The identity the block exists to make checkable, asserted as arithmetic on the payload.
    expect(Number(block['transferable_minor'])).toBe(
      Math.max(0, Number(block['balance_minor']) - Number(block['remaining_minor'])),
    );
    // And it is the same number as the field one row up, which is the field the probe read.
    expect(block['transferable_minor']).toBe(observation(runtime, ALICE).market['transferable_minor']);
  });

  it('★ IT IS THERE AT ZERO — the case that was silent — AND IT TRACKS', () => {
    // The whole defect: a bare `0` beside 200,000. So both readings are asserted, and the
    // second proves the first is not a constant somebody typed.
    const { runtime } = newcomerWorld('a2-mkt-tracks');
    tick(runtime);
    expect(endowment(runtime, ALICE)['transferable_minor'], 'all stake ⇒ nothing transferable').toBe(0);

    // Pay it, from the same faucet enrolment uses, so supply stays accounted (INV-2).
    runtime.ledger.issueCurrency({
      eventId: 'test:earn:alice' as EventId,
      tick: runtime.engine.tick,
      faucet: CURRENCY_FAUCET.STARTER_STAKE,
      to: storesAccount(ALICE),
      amount: minor(7_000),
    });
    const after = endowment(runtime, ALICE);
    expect(after['transferable_minor'], 'being paid unlocks it one-for-one').toBe(7_000);
    expect(after['remaining_minor'], 'and a payment never moves the counter').toBe(STARTER_STAKE);
  });

  it('★ AND BURNING ENDOWMENT UNLOCKS NOTHING, which is what the rule text claims', () => {
    // ══════════════════════════════════════════════════════════════════════
    // This runs against the LEDGER, not against the string, and it is the reason the string is
    // allowed to make the claim at all. "Burn some to free the rest" is the expensive wrong
    // belief a bare zero produces — an agent acting on it builds a WORKS it did not want — so
    // if the engine did not really behave this way the sentence would be a lie asserted into
    // permanence, which is the failure mode this whole file is about, one level up.
    // ══════════════════════════════════════════════════════════════════════
    const { runtime } = newcomerWorld('a2-mkt-burn');
    tick(runtime);
    const before = endowment(runtime, ALICE);
    runtime.ledger.retireCurrency({
      eventId: 'test:burn:alice' as EventId,
      tick: runtime.engine.tick,
      from: storesAccount(ALICE),
      amount: minor(40_000),
      sink: CURRENCY_SINK.UPKEEP,
    });
    const after = endowment(runtime, ALICE);
    // Non-vacuity: the burn really happened, or "unchanged" is trivially true.
    expect(Number(after['balance_minor']), 'the balance must really have fallen').toBe(
      Number(before['balance_minor']) - 40_000,
    );
    expect(Number(after['remaining_minor']), 'and the counter with it').toBe(
      Number(before['remaining_minor']) - 40_000,
    );
    expect(after['transferable_minor'], 'a retirement is freeCash-NEUTRAL').toBe(before['transferable_minor']);
    expect(ENDOWMENT_RULE, 'and the published rule says exactly that').toContain('UNLOCKS NOTHING');
  });

  it('the rule text names all three mis-beliefs a bare zero produces', () => {
    const { runtime } = newcomerWorld('a2-mkt-rule');
    tick(runtime);
    const block = endowment(runtime, ALICE);
    const rule = String(block['rule']);
    expect(rule.length, 'the rule must be a sentence, not a placeholder').toBeGreaterThan(200);
    // 1. "I am broke" — the identity, so the two numbers are visibly different things.
    expect(rule).toContain('balance_minor - remaining_minor');
    // 2. "burn some to free the rest" — the one an agent loses money on.
    expect(rule).toMatch(/UNLOCKS NOTHING/);
    // 3. "then nothing ever unlocks it".
    expect(rule).toMatch(/PAID/);
    expect(rule, 'and WHY, or it is a rule to memorise rather than understand').toContain('A15');
    expect(String(block['goods_rule']), 'the goods half exists and is its own sentence').toBe(
      ENDOWMENT_GOODS_RULE,
    );
  });
});

describe('§12 — when no `trade` is offered, `withheld` says WHICH thing is missing', () => {
  it('★ NO VENUE: carries the gate’s own sentence and names a system `move` can reach', () => {
    // The probe's exact state: a hand in the Commons, a holding in the MARCHES, and
    // `market.at: ['sys-01']` with `books: []`. Here the harder case — no venue at all.
    const { runtime } = newcomerWorld('a2-mkt-novenue');
    tick(runtime);
    // Walk EVERY hand off the board through the ordinary verb, so the state is one the engine
    // really produces rather than one the test wrote. Every hand, because a principal is seated
    // with three and moving one leaves two standing in a market — the model file's `demand`
    // fixture makes the same correction for the same reason.
    for (const hand of handsOf(runtime.world, ALICE)) {
      const offer = observation(runtime, ALICE)
        .affordances.filter((a) => a.verb === 'move')
        .find((m) => (m.params as Record<string, unknown>)['hand'] === hand.id);
      if (offer === undefined) continue;
      expect(act(runtime, ALICE, 'move', offer.params)).toBeNull();
    }
    expect(
      handsOf(runtime.world, ALICE).every((h) => h.state !== 'IDLE'),
      'the fixture must actually leave no IDLE hand, or this asserts nothing',
    ).toBe(true);

    const view = observation(runtime, ALICE);
    // Non-vacuity, both halves: no venue AND no trade offered. Either alone proves nothing.
    expect((view.market['at'] as string[]).length, 'the fixture must leave no reachable venue').toBe(0);
    expect(view.affordances.some((a) => a.verb === 'trade')).toBe(false);

    const w = withheld(runtime, ALICE);
    expect(w.verbs, 'and the absence must be ATTRIBUTED, not merely counted').toContain('trade');
    expect(w.reason).toContain('you are not standing in a market');
    expect(w.reason, 'market.at[] must be named, because that is the field that says so').toContain(
      'market.at[]',
    );
  });

  it('★ NO BOOK: says it is NOT a refusal, and names the maker order the menu never offers', () => {
    // The live shard's own state, and the one that closes the economy if it stays unsaid:
    // world-wide `market.ticker` is `[]` — no fill has EVER printed — because every `trade`
    // affordance is an IOC against something already resting, so an empty book is an empty
    // menu and an agent reading only `affordances[]` concludes the market is shut.
    // A FUNDED principal, because that is who the template is for. A newcomer gets a different
    // sentence and the reason is two tests down — its first draft invited an order the verb
    // refused, which a probe found by copying it.
    const runtime = world('a2-mkt-nobook', ALICE).runtime;
    tick(runtime);
    const view = observation(runtime, ALICE);
    expect((view.market['at'] as string[]).length, 'a venue IS reachable — that is the point').toBeGreaterThan(0);
    expect((view.market['books'] as unknown[]).length, 'and nothing is resting there').toBe(0);
    expect(view.affordances.some((a) => a.verb === 'trade')).toBe(false);

    const w = withheld(runtime, ALICE);
    expect(w.verbs).toContain('trade');
    expect(w.reason).toContain('no book exists at');
    expect(w.reason, 'the agent must be told this is not a refusal').toContain('NOT a refusal');
    expect(w.reason, 'and given the legal act the menu withholds').toContain(MAKER_NOTE);
    expect(MAKER_NOTE, 'which must name the order type, or it is advice with no verb').toContain('GTC');
  });

  it('★ AND IT NEVER INVITES AN ORDER IT CANNOT FUND — found by a probe following the row', () => {
    // ══════════════════════════════════════════════════════════════════════
    // **AGT-S2 PRODUCED BY THE FIX FOR AGT-S2, found from outside and not from here.**
    //
    // The first version of the no-book row ended *"a GTC order at your own price is legal at any
    // venue you stand in — send `trade` {…} yourself"* and stopped. A freshly enrolled probe,
    // driven over real signed HTTP against a local build, did exactly that: it read the row, sent
    // a GTC ASK for 10 `ration` at the venue the row named, and the verb refused it. Its whole
    // 50,000 of `ration` **is** the endowment floor, so `sellableGoods` is 0, and its whole
    // 250,000 of currency is endowment, so `freeCash` is 0. Neither side was placeable and the
    // row invited an order anyway — costing the probe a real action.
    //
    // Invisible from inside: every test passed and the sentence was TRUE as a statement about the
    // rules. It was false as *advice to the principal reading it*, which is the whole class.
    //
    // Asserted against the engine's own refusal, both sides, so the row's claim and the verb's
    // behaviour cannot part company.
    // ══════════════════════════════════════════════════════════════════════
    const { runtime, venue } = newcomerWorld('a2-mkt-cannot-fund');
    tick(runtime);
    const view = observation(runtime, ALICE);
    // Non-vacuity: the no-book branch is the one firing, and the principal really can fund
    // neither side — which is every newcomer, on its first wake, for ever.
    expect((view.market['at'] as string[]).length).toBeGreaterThan(0);
    expect((view.market['books'] as unknown[]).length).toBe(0);
    expect(freeCash(runtime.ledger, ALICE), 'no BID is fundable').toBe(0);
    expect(sellableGoods(runtime.ledger, ALICE, GOOD, venue), 'and no ASK either').toBe(qty(0));

    const ports = {
      ledger: runtime.ledger,
      world: runtime.world,
      book: runtime.market,
      principal: ALICE,
      tick: runtime.engine.tick,
    };
    // THE ENGINE'S OWN ANSWER FIRST: both sides really are refused. If either were takeable the
    // row below would be right to invite it, and this test would be asserting the wrong thing.
    for (const side of ['BID', 'ASK'] as const) {
      expect(
        tradeCheck(ports, {
          operation: 'place',
          venue,
          good: GOOD,
          side,
          quantity: 10,
          limitPrice: 30,
          durationTicks: null,
          timeInForce: 'GTC',
          order: null,
        }),
        `a GTC ${side} must be refused, or the row is allowed to invite it`,
      ).not.toBeNull();
    }

    const got = withheld(runtime, ALICE);
    expect(got.verbs).toContain('trade');
    expect(got.reason, 'it must say the book is empty').toContain('no book exists at');
    expect(got.reason, 'and that an order of your own would start one').toContain('an order OF YOUR OWN');
    expect(got.reason, 'and that you cannot fund either side of it').toContain('could not fund either side');
    expect(got.reason, 'and what WOULD change it, both halves').toContain('being PAID');
    expect(got.reason).toContain('PRODUCING above');
    // ★ AND IT MUST NOT HAND OUT THE TEMPLATE. That is the sentence the probe copied.
    expect(got.reason, 'no order template for a principal that can place neither side').not.toContain(
      '"operation":"place"',
    );
  });

  it('★ BUT IT DOES NAME THE FUNDABLE SIDE WHEN THERE IS ONE — the control', () => {
    // Without this the branch above is a blanket refusal to advise, which would close the only
    // door out of an empty book. `market/fixture.ts`'s `world()` funds above the floor, so ALICE
    // can rest both sides and must be told so, with figures.
    const w = world('a2-mkt-can-fund', ALICE);
    const runtime = w.runtime;
    tick(runtime);
    const view = observation(runtime, ALICE);
    // Non-vacuity: still no book, so the same branch fires — only the funding differs.
    expect((view.market['books'] as unknown[]).length, 'the same empty-book branch must fire').toBe(0);
    expect(freeCash(runtime.ledger, ALICE)).toBeGreaterThan(0);
    expect(sellableGoods(runtime.ledger, ALICE, GOOD, w.venue)).toBeGreaterThan(0);

    const got = withheld(runtime, ALICE);
    expect(got.verbs).toContain('trade');
    expect(got.reason, 'now the template IS appropriate').toContain('"operation":"place"');
    expect(got.reason).toContain('You can fund');
    // The figures are the engine's own, not a literal beside them.
    expect(got.reason).toContain(String(freeCash(runtime.ledger, ALICE)));
    expect(got.reason).toContain(
      `${String(sellableGoods(runtime.ledger, ALICE, GOOD, w.venue))} ${GOOD} at ${w.venue}`,
    );
    expect(got.reason, 'and it must not tell a funded principal it cannot fund anything').not.toContain(
      'could not fund either side',
    );
  });

  it('★ NOTHING TRANSFERABLE: carries `planOrder`’s own arithmetic, VERBATIM', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The strongest form available here. `tradeCheck` is the same `planOrder` the verb runs and
    // it returns a full sentence with the shortfall in it, so this asserts the payload carries
    // THAT sentence rather than a paraphrase of it — by asking the gate directly and comparing.
    // A paraphrase is a second home for a rule (scar #1).
    // ══════════════════════════════════════════════════════════════════════
    const w = world('a2-mkt-broke', BOB);
    const runtime = w.runtime;
    // BOB is funded above the floor by the fixture and rests an ASK, so there is something to
    // take. ALICE is a newcomer with nothing but stake — the probe's own position.
    runtime.seat(ALICE, 'alice', w.venue);
    runtime.standing.open(ALICE);
    tick(runtime);
    submit(runtime, BOB, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 40,
      limit_price: 25,
      time_in_force: 'GTC',
    });
    tick(runtime);
    tick(runtime);

    const view = observation(runtime, ALICE);
    const books = view.market['books'] as { levels: { ask: { price: number }[] } }[];
    const level = books[0]?.levels.ask[0];
    // Non-vacuity, three ways: a book exists, it has an ask, and ALICE holds money she cannot
    // spend. Without all three the sentence below could be true for another branch's reason.
    if (level === undefined) throw new Error('fixture: BOB’s ask is not on ALICE’s book');
    expect(runtime.ledger.freeBalance(storesAccount(ALICE)), 'ALICE must hold real money').toBeGreaterThan(
      level.price,
    );
    expect(freeCash(runtime.ledger, ALICE), 'and none of it may be transferable').toBe(0);
    expect(view.affordances.some((a) => a.verb === 'trade')).toBe(false);

    // Ask the gate the same question the payload asked, and compare.
    const hint = tradeCheck(
      { ledger: runtime.ledger, world: runtime.world, book: runtime.market, principal: ALICE, tick: runtime.engine.tick },
      {
        operation: 'place',
        venue: w.venue,
        good: GOOD,
        side: 'BID',
        quantity: 1,
        limitPrice: level.price,
        durationTicks: null,
        timeInForce: 'IOC',
        order: null,
      },
    );
    if (hint === null) throw new Error('fixture: the gate must refuse ALICE’s bid');
    const got = withheld(runtime, ALICE);
    expect(got.verbs).toContain('trade');
    expect(got.reason, 'the gate’s own hint, not a second copy of the rule').toContain(hint);
    expect(got.reason, 'and a pointer at the block that explains the number').toContain('market.endowment');
  });

  it('★ NOTHING SELLABLE: the GOODS floor gets the same treatment the currency floor got', () => {
    // The other half of D7, and the half that had no field and no sentence at all. A principal
    // under `ENDOWMENT_GOOD_FLOOR_QTY` can sell NONE of the good every obligation is priced in.
    const w = world('a2-mkt-nosell', BOB);
    const runtime = w.runtime;
    runtime.seat(ALICE, 'alice', w.venue);
    runtime.standing.open(ALICE);
    tick(runtime);
    submit(runtime, BOB, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'BID',
      quantity: 40,
      limit_price: 25,
      time_in_force: 'GTC',
    });
    tick(runtime);
    tick(runtime);

    // Non-vacuity: ALICE HOLDS the good — the enrolment allotment — and can sell none of it.
    // Held-and-unsellable is the whole finding; unheld would be an unremarkable empty store.
    const held = runtime.ledger
      .lotsInAccount(storesAccount(ALICE))
      .filter((lot) => lot.good === (GOOD))
      .reduce((sum, lot) => sum + lot.qty, 0);
    expect(held, 'ALICE must really hold the good').toBeGreaterThan(0);
    // At or below the floor is the state the fix is about, and a newcomer sits exactly ON it:
    // the enrolment allotment IS the floor, so the very first thing a principal is given is the
    // thing it may not sell. Asserted as the measurement rather than as `<`, because equality is
    // the real starting position and `<` would have made this test pass for the wrong reason.
    expect(held, 'and hold no MORE than the floor').toBeLessThanOrEqual(ENDOWMENT_GOOD_FLOOR_QTY);
    expect(sellableGoods(runtime.ledger, ALICE, GOOD, w.venue)).toBe(qty(0));
    expect(observation(runtime, ALICE).affordances.some((a) => a.verb === 'trade')).toBe(false);

    const got = withheld(runtime, ALICE);
    expect(got.verbs).toContain('trade');
    expect(got.reason).toContain('a sell order escrows the goods');
    expect(got.reason, 'and the rule, on the good it applies to').toContain(ENDOWMENT_GOODS_RULE);
    // The published figures an agent would plan the fix from.
    const block = endowment(runtime, ALICE);
    expect(block['sellable_qty']).toBe(qty(0));
    expect(Number(block['floor_qty']), 'the floor is what withholds it').toBeGreaterThanOrEqual(held);
  });

  it('the silent row is COUNTED, exactly once, and unseats the “nothing was withheld” claim', () => {
    const { runtime } = newcomerWorld('a2-mkt-counted');
    tick(runtime);
    const w = withheld(runtime, ALICE);
    const clauses = w.reason.split('; ').filter((c) => c.includes('trade'));
    expect(clauses, 'exactly one trade clause, never one per book').toHaveLength(1);
    expect(w.count).toBeGreaterThan(0);
    expect(w.reason).not.toBe('nothing was withheld: this is every legal act, with its full cost.');
  });

  it('and when a trade IS offered, no row is billed for it — the control', () => {
    // Without this the branch above could be boilerplate that fires always, which is the
    // failure `header.aggression`'s own control catches: a field present at zero and absent at
    // full is worse than nothing.
    const w = world('a2-mkt-offered', ALICE, BOB);
    const runtime = w.runtime;
    tick(runtime);
    submit(runtime, BOB, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 40,
      limit_price: 25,
      time_in_force: 'GTC',
    });
    tick(runtime);
    tick(runtime);
    // Non-vacuity: ALICE really is offered a trade here (the fixture funds her above the floor).
    expect(
      observation(runtime, ALICE).affordances.some((a) => a.verb === 'trade'),
      'the fixture must offer a trade, or the assertion below proves nothing',
    ).toBe(true);
    expect(withheld(runtime, ALICE).verbs, 'an offered verb must never be billed a row').not.toContain(
      'trade',
    );
  });
});

describe('AGT-S2 — the menu and the verb agree about `trade`, because they ask one gate', () => {
  it('★ THE BID AFFORDANCE IS SIZED ON `freeCash`, NOT ON THE RAW BALANCE', () => {
    // ══════════════════════════════════════════════════════════════════════
    // A real bug, found on the same read as the silence and never fired only because the
    // probe's venue had nothing resting to price against. The affordance layer sized a BID
    // with `Math.floor(free / price)` — the RAW unlocked balance — while `planOrder` gates the
    // same order on `freeCash`. Those differ by the whole endowment, so on the live shard's own
    // numbers (200,000 free, 0 transferable) the menu offered up to 200,000 of BIDs the verb
    // refuses every one of: the server telling an agent to do something and then declining,
    // which costs the agent a real action every time.
    // ══════════════════════════════════════════════════════════════════════
    const w = world('a2-mkt-agts2', BOB);
    const runtime = w.runtime;
    runtime.seat(ALICE, 'alice', w.venue);
    runtime.standing.open(ALICE);
    tick(runtime);
    submit(runtime, BOB, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 40,
      limit_price: 25,
      time_in_force: 'GTC',
    });
    tick(runtime);
    tick(runtime);

    // Non-vacuity: the two figures really do disagree for this principal, and there really is
    // a takeable level. A fixture where `free === freeCash` makes this test vacuous.
    expect(runtime.ledger.freeBalance(storesAccount(ALICE))).toBeGreaterThan(0);
    expect(freeCash(runtime.ledger, ALICE)).toBe(0);
    const books = observation(runtime, ALICE).market['books'] as { levels: { ask: unknown[] } }[];
    expect(books[0]?.levels.ask.length, 'there must be an ask to be tempted by').toBeGreaterThan(0);

    expect(
      observation(runtime, ALICE).affordances.filter((a) => a.verb === 'trade'),
      'no BID may be offered to a principal that cannot escrow one',
    ).toEqual([]);
  });

  it('★ AND IT IS SIZED TO `freeCash`, so PARTIAL funds buy a SMALLER order, not nothing', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The test above passes with the bug restored, and that is worth stating rather than
    // hiding: once the gate is asked, an over-sized offer is *refused* and simply never
    // appears, so "no unaffordable offer" is true either way. The property the sizing carries
    // on its own is this one — and it is the one an agent loses money on, because it is the
    // difference between a smaller order and NO order.
    //
    // A principal with SOME transferable money and a much larger balance sized on `free` asks
    // for `balance / price` units, the gate refuses the whole thing, and the menu goes empty
    // for a principal that could perfectly well have bought a third of the level. Mutation-
    // verified: reverting `transferable` to `free` here fails this test and nothing else.
    // ══════════════════════════════════════════════════════════════════════
    const w = world('a2-mkt-sized', BOB);
    const runtime = w.runtime;
    runtime.seat(ALICE, 'alice', w.venue);
    runtime.standing.open(ALICE);
    // Pay ALICE a little: enough for part of the level, far less than her whole balance.
    runtime.ledger.issueCurrency({
      eventId: 'test:earn:sized' as EventId,
      tick: 0,
      faucet: CURRENCY_FAUCET.STARTER_STAKE,
      to: storesAccount(ALICE),
      amount: minor(250),
    });
    tick(runtime);
    submit(runtime, BOB, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 400,
      limit_price: 25,
      time_in_force: 'GTC',
    });
    tick(runtime);
    tick(runtime);

    // Non-vacuity: partial funds, and a level far larger than they cover.
    const cash = freeCash(runtime.ledger, ALICE);
    expect(cash, 'ALICE must be able to afford SOMETHING').toBe(250);
    expect(runtime.ledger.freeBalance(storesAccount(ALICE)), 'and her balance must dwarf it').toBeGreaterThan(
      cash * 10,
    );
    const bid = observation(runtime, ALICE).affordances.find(
      (a) => a.verb === 'trade' && (a.params as Record<string, unknown>)['side'] === 'BID',
    );
    expect(bid, 'a BID must be offered — a smaller one, never none').toBeDefined();
    expect(
      Number((bid?.params as Record<string, unknown>)['quantity']),
      'sized to freeCash / price = 10, not to balance / price',
    ).toBe(10);
    expect(bid?.max_direct_loss, 'and the honesty field is the escrow it really locks').toBe(250);
    // And it is real: the engine takes it verbatim.
    expect(act(runtime, ALICE, 'trade', bid?.params ?? {})).toBeNull();
  });

  it('★ NO BID AGAINST YOUR OWN ASK — the leak the gate closes that affordability cannot', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The second half of the AGT-S2 argument, and the half no amount of correct affordability
    // arithmetic reaches. `planOrder` refuses a self-crossing order on **A15** — one principal
    // may never be both sides of a print, because a self-match prints a price nobody paid and
    // `ledger/valuation.ts` calls that the game's single most dangerous exploit. The affordance
    // layer never checked it, so a principal whose own ask was the only level on the book was
    // offered a BID against itself, every wake, for as long as the order rested.
    //
    // This is also the case that proves the withheld row is not just a shortfall reporter: the
    // obstacle here is neither an empty wallet nor an empty book, and the row still names it —
    // in the gate's own words.
    // ══════════════════════════════════════════════════════════════════════
    const w = world('a2-mkt-selfcross', ALICE);
    const runtime = w.runtime;
    tick(runtime);
    submit(runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 40,
      limit_price: 25,
      time_in_force: 'GTC',
    });
    tick(runtime);
    tick(runtime);

    // Non-vacuity, three ways: ALICE's own ask IS the top of the book, she can afford to take
    // it, and she is the only principal here — so the level cannot belong to anyone else.
    const books = observation(runtime, ALICE).market['books'] as {
      levels: { ask: { price: number }[] };
      mine: { side: string }[];
    }[];
    const level = books[0]?.levels.ask[0];
    if (level === undefined) throw new Error('fixture: ALICE’s own ask is not on the book');
    expect(books[0]?.mine.some((o) => o.side === 'ASK'), 'the level must be HERS').toBe(true);
    expect(freeCash(runtime.ledger, ALICE), 'and she must be able to afford it').toBeGreaterThan(level.price);

    expect(
      observation(runtime, ALICE).affordances.filter(
        (a) => a.verb === 'trade' && (a.params as Record<string, unknown>)['side'] === 'BID',
      ),
      'no BID may be offered against a principal’s own resting ask (A15)',
    ).toEqual([]);

    const got = withheld(runtime, ALICE);
    expect(got.verbs, 'and the absence is attributed').toContain('trade');
    expect(got.reason, 'in the gate’s own words, which name the rule and the remedy').toContain(
      'one principal may never be both sides of a print',
    );
  });

  it('★ NOR AN ASK INTO YOUR OWN BID — the same leak, the other side of the book', () => {
    // The mirror, and it is a separate test rather than a loop because the two sides fail for
    // different reasons in the un-gated build: the BID side leaks past an affordability filter,
    // the ASK side past a `sellableGoods` filter. Mutation-verified independently — removing
    // either gate fails exactly its own case.
    const w = world('a2-mkt-selfcross-ask', ALICE);
    const runtime = w.runtime;
    tick(runtime);
    submit(runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'BID',
      quantity: 40,
      limit_price: 25,
      time_in_force: 'GTC',
    });
    tick(runtime);
    tick(runtime);

    const books = observation(runtime, ALICE).market['books'] as {
      levels: { bid: { price: number }[] };
      mine: { side: string }[];
    }[];
    // Non-vacuity: her own bid is the top of the book, and she really holds sellable goods —
    // so the un-gated menu would have offered the sale.
    if (books[0]?.levels.bid[0] === undefined) throw new Error('fixture: ALICE’s bid is not on the book');
    expect(books[0]?.mine.some((o) => o.side === 'BID')).toBe(true);
    expect(sellableGoods(runtime.ledger, ALICE, GOOD, w.venue)).toBeGreaterThan(0);

    expect(
      observation(runtime, ALICE).affordances.filter(
        (a) => a.verb === 'trade' && (a.params as Record<string, unknown>)['side'] === 'ASK',
      ),
      'no ASK may be offered into a principal’s own resting bid (A15)',
    ).toEqual([]);
    expect(withheld(runtime, ALICE).reason).toContain('one principal may never be both sides of a print');
  });

  it('★ A BOOK THAT HAS PRINTED AND IS NOW EMPTY still gets a sentence', () => {
    // The branch that closed a hole in the fix itself. `MarketBook.visibleBooks` keeps every
    // `(venue, good)` that has ever printed, so `market.books[]` being non-empty does NOT mean
    // anything is takeable — and left to the two side branches this state produces no row at
    // all and `trade` goes silent again, one level down from the defect this file is about.
    const w = world('a2-mkt-printed-empty', ALICE, BOB);
    const runtime = w.runtime;
    tick(runtime);
    submit(runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 10,
      limit_price: 20,
      time_in_force: 'GTC',
    });
    tick(runtime);
    submit(runtime, BOB, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'BID',
      quantity: 10,
      limit_price: 20,
      time_in_force: 'GTC',
    });
    tick(runtime);
    tick(runtime);

    // Non-vacuity, and it is the strongest part of this test: the fill REALLY HAPPENED, so the
    // book is visible for the reason the branch exists, and both sides are now empty.
    expect(runtime.market.fills().length, 'the fixture must actually print, or the book is not visible').toBe(1);
    const view = observation(runtime, BOB);
    const books = view.market['books'] as { levels: { ask: unknown[]; bid: unknown[] } }[];
    expect(books.length, 'the printed book must still be published').toBe(1);
    expect(books[0]?.levels.ask.length, 'and be empty on both sides').toBe(0);
    expect(books[0]?.levels.bid.length).toBe(0);
    expect(view.affordances.some((a) => a.verb === 'trade')).toBe(false);

    const got = withheld(runtime, BOB);
    expect(got.verbs, 'the absence must still be attributed').toContain('trade');
    expect(got.reason).toContain('has printed before but has NOTHING resting');
    expect(got.reason, 'and point at the maker order, which is the only way to restart it').toContain(
      'GTC',
    );
  });

  it('★ AND EVERY OFFERED `trade` IS ONE THE VERB REALLY TAKES — sent verbatim', () => {
    // The check that makes the rest worth anything: copy the affordance exactly as `agent.md`
    // tells an agent to, and require the engine to accept it.
    const w = world('a2-mkt-verbatim', ALICE, BOB);
    const runtime = w.runtime;
    tick(runtime);
    submit(runtime, BOB, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 40,
      limit_price: 25,
      time_in_force: 'GTC',
    });
    tick(runtime);
    tick(runtime);
    const offers = observation(runtime, ALICE).affordances.filter((a) => a.verb === 'trade');
    expect(offers.length, 'the menu must offer at least one, or this proves nothing').toBeGreaterThan(0);
    const offer = offers[0];
    if (offer === undefined) throw new Error('fixture');
    expect(act(runtime, ALICE, 'trade', offer.params), 'the menu offered it, so the engine must take it').toBeNull();
  });
});

// ── 5. a forward-looking field on a record with no future ────────────────────

describe('§7 — a venture that will never resolve does not publish a tick at which it does', () => {
  it('★ THE PROBE’S CASE: a terminal venture answers `null`, and says when it DID resolve', () => {
    // Driven through the ordinary verbs to a real terminal state, never by setting a field: the
    // claim is about what the engine produces, and a hand-built record would let the assertion
    // pass over a state the engine cannot reach.
    const w = world('a2-vent-terminal', ALICE, BOB);
    const runtime = w.runtime;
    tick(runtime);
    const create = observation(runtime, ALICE).affordances.find((a) => a.verb === 'create');
    if (create === undefined) throw new Error('fixture: no create offered');
    expect(act(runtime, ALICE, 'create', create.params)).toBeNull();
    const mine = runtime.ventures.forPrincipal(ALICE)[0];
    if (mine === undefined) throw new Error('fixture: nothing was created');
    const stored = mine.resolvesAtTick;

    // While it is live the field is the stored tick — the control, and the reason the `null`
    // below is a branch rather than the field having been deleted.
    const live = (observation(runtime, ALICE).ventures['mine'] as Record<string, unknown>[]).find(
      (row) => row['id'] === mine.id,
    );
    expect(live?.['resolves_at_tick'], 'a LIVE venture still answers with its tick').toBe(stored);
    expect(live?.['resolved_at_tick'], 'and has not resolved').toBeNull();

    // Let the signing window close. `venture/book.ts` retires it ABANDONED, which is exactly
    // the state the probe read `resolves_at_tick: 287` from.
    while (runtime.engine.tick <= mine.windowClosesTick + 1) tick(runtime);
    expect(mine.state, 'the fixture must actually retire it, or this asserts nothing').toBe('ABANDONED');
    expect(stored, 'and the stored tick must still be a real number, or `null` proves nothing').toBeGreaterThan(0);

    const row = (observation(runtime, ALICE).ventures['mine'] as Record<string, unknown>[]).find(
      (r) => r['id'] === mine.id,
    );
    if (row === undefined) throw new Error('the terminal venture left ventures.mine entirely');
    expect(row['state']).toBe('ABANDONED');
    expect(row['resolves_at_tick'], 'nothing is coming, so the honest answer is null').toBeNull();
    expect(row['resolved_at_tick'], 'and this is when it really happened — the engine’s own value').toBe(
      mine.resolvedAtTick,
    );
    expect(row['window_closes_tick'], 'countersign refuses on PROP-V6 once it is not LIVE').toBeNull();
  });
});
