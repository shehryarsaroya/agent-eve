/**
 * ★ **`deliver {payer}` — §5.2's ESCROWABLE HALF, EXERCISED FOR THE FIRST TIME.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS FILE EXISTS.** §5.2 states the non-escrowable share as a limit — *"a stated share of
 * every assessment is non-escrowable; it must be carried by a hand, not bought as a service"* —
 * and `test/levy/coase.test.ts` has guarded that limit since the Levy landed. Nobody read what the
 * limit **leaves**: 70% of every assessment *is* escrowable, and §5.2 permits that share to be
 * carried by another principal's hand.
 *
 * `deliver {payer}` implements it in full. `creditFor` bounds a foreign delivery to the escrowable
 * bucket. `settle.ts` publishes `paidOther` on every shortfall row and `levy.short` carries
 * `paidOtherMinor` to the viewer. **No affordance ever offered it, no cast ever selected it, and
 * `paidOther` was 0 in every world this repo had ever run** — which is the project's defining
 * defect at its ninth appearance: a capability that exists and is never exercised is
 * indistinguishable from one that is missing, in every report and to every reader.
 *
 * What it cost, in numbers. At nine Reckonings on eight seeds master reads `levyShort` **202,540**
 * with **19 of 576** tribute lines red, and `test/levy/aged-solvency.spec.ts` diagnosed a §10
 * production shortfall: income is Σ over occupied *systems* and duty is Σ over *principals*. True,
 * and not the whole story — on `g01` at R7 three members hold a WORKS on one MARCHES system at
 * occupancy 3, earning `floor(110/3) x 288 = 10,368` against a 23,900 assessment, while `orrin`,
 * `sable` and `varrow` sit on **360,000 units of the same good in the same constellation.** The
 * goods exist. They are in somebody else's warehouse. That is a **distribution** failure, and this
 * is the door §5.2 already wrote for it.
 *
 * ## What each test pins, and why it is the shape rather than the number
 *
 *   1. **The offer exists at all**, and is the row the verb accepts — the regression against the
 *      whole defect. NON-VACUITY FIRST: every loop here asserts it iterated.
 *   2. **The offer is bounded by the payer's ESCROWABLE remainder**, never the assessment. An
 *      offer that promised to clear a bill it structurally cannot would be scar #1 with a Levy
 *      shortfall attached.
 *   3. **The offer never spends the deliverer's own duty.** The one mistake the engine can see
 *      coming, and A2 says known arithmetic is exact.
 *   4. **The cap counts OFFERS, not rows** — the bug that made the first implementation of this
 *      change look like it had barely worked (`levyShort` 57,696 instead of 1,275 on `g01`).
 *   5. **`paidOther` is non-zero in an aged world**, which is the only assertion that can tell a
 *      mechanism nobody uses from a mechanism that does not exist.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import {
  isSettlementTick,
  reckoningIndex,
  setSpeed,
  TICKS_PER_RECKONING,
} from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { minor, qty } from '../../src/core/units.js';
import { compareIds } from '../../src/ledger/index.js';
import {
  carryableOf,
  LEVY_GOOD,
  MAX_LEVY_CARRY_OFFERS,
  nonEscrowableOf,
  owingOf,
} from '../../src/levy/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { buildObservation, type Withheld } from '../../src/api/observe.js';
import { act, levyWorld, runTo, tick, walkToPlace } from './fixture.js';

describe('carryableOf — the arithmetic, alone', () => {
  it('★ is bounded by the payer\'s ESCROWABLE remainder and never by the assessment', () => {
    const assessment = minor(20_000);
    const presence = nonEscrowableOf(assessment);
    const payerOwing = owingOf(assessment, { paidOwn: minor(0), paidOther: minor(0) });
    // A deliverer with a fortune and nothing of its own owed.
    const carry = carryableOf({
      payerOwing,
      ownOwing: owingOf(minor(0), { paidOwn: minor(0), paidOther: minor(0) }),
      available: qty(1_000_000),
      // The payer can reach nothing itself — no hand at the place, or no stock. That is the case
      // §5.2's carry exists for, and it is the baseline every row below varies from.
      payerReach: minor(0),
    });
    expect(carry.escrowableOwed).toBe(assessment - presence);
    expect(carry.presenceOwed).toBe(presence);
    // NOT the assessment: the presence share is unbuyable at any price (§5.2, PROP-LV3), and an
    // offer that quoted the whole bill would be promising a discharge it cannot deliver.
    expect(carry.payable).toBe(assessment - presence);
    expect(carry.payable).toBeLessThan(assessment);
  });

  it('★ never offers the goods the deliverer\'s OWN duty needs', () => {
    const payerOwing = owingOf(minor(20_000), { paidOwn: minor(0), paidOther: minor(0) });
    // 5,000 units to hand, 4,000 of them owed on its own assessment. Exactly 1,000 is surplus.
    const carry = carryableOf({
      payerOwing,
      ownOwing: owingOf(minor(4_000), { paidOwn: minor(0), paidOther: minor(0) }),
      available: qty(5_000),
      payerReach: minor(0),
    });
    expect(carry.ownOwed).toBe(4_000);
    expect(carry.surplus).toBe(1_000);
    expect(carry.payable).toBe(1_000);

    // And a deliverer whose own duty exceeds its stock offers nothing at all rather than a
    // negative number or its whole warehouse.
    const broke = carryableOf({
      payerOwing,
      ownOwing: owingOf(minor(9_000), { paidOwn: minor(0), paidOther: minor(0) }),
      available: qty(5_000),
      payerReach: minor(0),
    });
    expect(broke.surplus).toBe(0);
    expect(broke.payable).toBe(0);
  });

  it('offers nothing against a payer that has already discharged its escrowable share', () => {
    const assessment = minor(20_000);
    const escrowable = assessment - nonEscrowableOf(assessment);
    const settled = owingOf(assessment, { paidOwn: minor(0), paidOther: minor(escrowable) });
    const carry = carryableOf({
      payerOwing: settled,
      ownOwing: owingOf(minor(0), { paidOwn: minor(0), paidOther: minor(0) }),
      available: qty(1_000_000),
      // The payer can reach nothing itself — no hand at the place, or no stock. That is the case
      // §5.2's carry exists for, and it is the baseline every row below varies from.
      payerReach: minor(0),
    });
    expect(carry.escrowableOwed).toBe(0);
    expect(carry.payable).toBe(0);
    // Its presence share is still owed and still nobody else's to carry.
    expect(carry.presenceOwed).toBeGreaterThan(0);
  });

  it('★ offers nothing a payer standing at the place can hand over ITSELF', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE RACE THIS CLOSES WAS MEASURED, NOT ANTICIPATED.** `test/cast/heuristic.test.ts` caught
    // **six repeated `deliver A14` refusals** — AGT-S3's threshold is three — because actions
    // resolve from snapshot T (§15.2) and a payer paying its own bill in the same tick a neighbour
    // carried part of it left whichever landed second with no room.
    //
    // Netting the payer's own reach is also the better mechanic: §5.2's carry exists for a
    // principal that cannot reach the goods, and a payer at the delivery place with a full
    // warehouse is not one.
    //
    // MUTATION: drop the `reachToEscrowable` term from `carryableOf` and this goes red; the
    // heuristic suite's AGT-S3 assertion goes red too, which is the pair that matters.
    // ══════════════════════════════════════════════════════════════════════════
    const assessment = minor(20_000);
    const presence = nonEscrowableOf(assessment);
    const escrowable = assessment - presence;
    const payerOwing = owingOf(assessment, { paidOwn: minor(0), paidOther: minor(0) });
    const rich = {
      ownOwing: owingOf(minor(0), { paidOwn: minor(0), paidOther: minor(0) }),
      available: qty(1_000_000),
    };

    // A payer that can cover the whole bill itself needs no carrying at all.
    const selfSufficient = carryableOf({ payerOwing, ...rich, payerReach: assessment });
    expect(selfSufficient.escrowableOwed).toBe(0);
    expect(selfSufficient.payable).toBe(0);
    expect(selfSufficient.payerReach).toBe(assessment);

    // Its own hand fills PRESENCE first (`owingOf`), so reach up to the presence share leaves the
    // escrowable bucket untouched and fully carryable. This is the clause that stops the netting
    // from swallowing the mechanism on a payer with a little stock and a big bill.
    const justPresence = carryableOf({ payerOwing, ...rich, payerReach: presence });
    expect(justPresence.escrowableOwed).toBe(escrowable);
    expect(justPresence.payable).toBe(escrowable);

    // Halfway: reach 1,000 above presence takes exactly 1,000 off what is carryable.
    const partial = carryableOf({ payerOwing, ...rich, payerReach: minor(presence + 1_000) });
    expect(partial.escrowableOwed).toBe(escrowable - 1_000);
  });
});

describe('the affordance offers it, and the verb accepts the row', () => {
  /**
   * Two principals in one constellation, one of them standing at the delivery place with a
   * fortune in the levy good, the other holding a bill it will not pay.
   *
   * The real `Runtime`, the real verb, the real affordance builder. A fixture that hand-built an
   * `Affordance` would prove nothing about the list an agent actually receives.
   */
  function twoPrincipals(seed: string): {
    readonly runtime: Runtime;
    readonly rich: PrincipalId;
    readonly poor: PrincipalId;
  } {
    const world = levyWorld(seed, 2, 1);
    const [rich, poor] = world.principals;
    if (rich === undefined || poor === undefined) throw new Error('levyWorld seated fewer than two');
    // Past the first assessment, so both hold a real line.
    runTo(world.runtime, 1);
    walkToPlace(world.runtime, rich);
    // ONE MORE TICK, and it is the rule rather than a fixture quirk: `isPresent` is
    // `tick >= hand.presentSinceTick`, so **a hand that arrived this tick is not present until the
    // next one** — which is what `observe`'s own `withheld` sentence tells an agent about
    // `fill_role`. `walkToPlace` returns on the arrival tick, so a carry quoted here would be
    // refused by `deliveryFault` for want of a carrier that is standing right there. Verified: the
    // arithmetic read `payable: 350` with the presence fault set, hand IDLE at `sys-01`.
    tick(world.runtime);
    return { runtime: world.runtime, rich, poor };
  }

  /** One observation, exactly as the HTTP surface builds it. `fresh`, or there are no affordances. */
  function observe(runtime: Runtime, principal: PrincipalId): ReturnType<typeof buildObservation> {
    return buildObservation({
      runtime,
      principal,
      serverNowMs: 0,
      fresh: true,
      wakesRemaining: 4,
      stale: false,
      corrections: [],
      correctionsDropped: 0,
      actionsRemaining: 4,
    });
  }

  function carryOffers(
    runtime: Runtime,
    principal: PrincipalId,
  ): readonly ReturnType<typeof observe>['affordances'][number][] {
    return observe(runtime, principal).affordances.filter(
      (a) => a.verb === 'deliver' && a.params['payer'] !== undefined,
    );
  }

  it('★ OFFERS `deliver {payer}` — the ninth unexercised capability, on the menu', () => {
    const { runtime, rich, poor } = twoPrincipals('carry-a');

    // NON-VACUITY, FIRST AND LOUDLY. The last agent's aged test would have iterated zero times in
    // a world that never voted `BY_STORES` and reported green; the same failure here would be a
    // test that asserts an affordance exists in a world where no carry is possible at all.
    const quotes = runtime.levyCarryQuotes(rich);
    expect(
      quotes.length,
      'no carry is possible in this fixture at all, so every assertion below is about nothing',
    ).toBeGreaterThan(0);
    expect(quotes[0]?.payer, 'the only other principal on this roll').toBe(poor);

    const offers = carryOffers(runtime, rich);
    expect(
      offers.length,
      'a carry is possible and `affordances[]` did not offer it — which is the whole defect: ' +
        '`deliver {payer}` is legal, executes, credits `paidOther`, and no observation named it',
    ).toBeGreaterThan(0);

    const offer = offers[0];
    expect(offer?.params['obligation']).toBe('LEVY');
    expect(offer?.params['payer']).toBe(poor);
    expect(Number(offer?.params['amount'])).toBeGreaterThan(0);
  });

  it('★ the row the affordance offers is a row the VERB ACCEPTS, verbatim', () => {
    const { runtime, rich, poor } = twoPrincipals('carry-b');
    const offer = carryOffers(runtime, rich)[0];
    expect(offer, 'nothing to copy, so this test asserted nothing').toBeDefined();
    if (offer === undefined) return;

    const before = runtime.levy.paymentOf(reckoningIndex(runtime.engine.tick), poor);
    expect(before.paidOther, 'the fixture must start from zero for the delta to mean anything').toBe(0);

    // `agent.md` tells a player the safest plan is built from entries in `affordances[]`, so the
    // params go in untouched. An affordance the engine then refuses costs an agent a real action
    // and is worse than a missing one (AGT-S2).
    const refusal = act(runtime, rich, 'deliver', offer.params);
    expect(refusal, `the engine refused its own affordance: ${refusal?.hint ?? ''}`).toBeNull();

    const after = runtime.levy.paymentOf(reckoningIndex(runtime.engine.tick), poor);
    expect(
      after.paidOther,
      '`paidOther` is still zero after a delivery the affordance offered against another payer',
    ).toBe(Number(offer.params['amount']));
    // And it landed in the escrowable bucket only — the deliverer's hand cannot buy presence.
    expect(after.paidOwn).toBe(0);
    const owing = runtime.levy.owingOf(reckoningIndex(runtime.engine.tick), poor);
    expect(owing.presenceOwed, 'a purchased carry must never fill the presence share').toBe(
      owing.nonEscrowable,
    );
  });

  it('★ the offered amount never exceeds what the payer can have carried', () => {
    const { runtime, rich, poor } = twoPrincipals('carry-c');
    const reckoning = reckoningIndex(runtime.engine.tick);
    const owing = runtime.levy.owingOf(reckoning, poor);
    const offer = carryOffers(runtime, rich)[0];
    expect(offer, 'no offer, so this asserted nothing').toBeDefined();
    if (offer === undefined) return;
    expect(Number(offer.params['amount'])).toBeLessThanOrEqual(owing.purchasableOwed);
    expect(
      Number(offer.params['amount']),
      'an offer that quoted the whole assessment would promise a discharge §5.2 forbids',
    ).toBeLessThan(owing.assessment);
  });

  it('does not offer a carry to a principal with no hand at the delivery place', () => {
    // Same fixture WITHOUT the walk. `deliveryFault` is the gate and it is the verb's own, so the
    // list cannot offer an act the engine would refuse — the property, asserted from the outside.
    const world = levyWorld('carry-d', 2, 1);
    const [rich, poor] = world.principals;
    if (rich === undefined || poor === undefined) throw new Error('levyWorld seated fewer than two');
    runTo(world.runtime, 1);
    expect(carryOffers(world.runtime, rich).length).toBe(0);

    // And the omission is COUNTED with a reason an agent can act on (PROP-O1) — not silent, which
    // would teach it that the mechanism does not apply to it.
    const blocked = world.runtime.levyCarryObstacles(rich);
    expect(blocked.length, 'the obstacle list is empty, so `withheld` explains nothing').toBeGreaterThan(0);
    expect(blocked[0]?.payer).toBe(poor);
    expect(blocked[0]?.fault ?? '').toContain('hands');
    // `header` is `Record<string, unknown>` by design (`api/observe.ts`), so the reason is read the
    // way an agent's JSON parser reads it rather than through a type the engine hands over.
    const withheld = observe(world.runtime, rich).header['withheld'] as Withheld;
    expect(withheld.reason).toContain('ANOTHER principal');
    expect(withheld.count).toBeGreaterThan(0);
  });

  it('★ names the LEVY good, the payer, the place and BOTH shares in the offer text (A2)', () => {
    const { runtime, rich, poor } = twoPrincipals('carry-e');
    const offer = observe(runtime, rich).affordances.find(
      (a) => a.verb === 'deliver' && a.params['payer'] === poor,
    );
    expect(offer, 'no carry offer to read').toBeDefined();
    const text = offer?.what_it_forecloses ?? '';
    const place = runtime.levyBlockFor(poor)?.deliverable_to ?? '';
    // ── GOLDEN CLAUSES, BECAUSE THREE WEAKER VERSIONS SURVIVED MUTATION ────────
    //
    // A2 wants *known arithmetic exact and machine-readable*, and three attempts to check that
    // loosely all passed against a broken offer — each failing for a reason worth writing down,
    // because each is the same shape as the bugs this file is about:
    //
    //   · `toContain(LEVY_GOOD)` passed while the handing-over clause named a good that does not
    //     exist, because `ration` appears again later in the sentence;
    //   · `toContain('${amount} of ${LEVY_GOOD}')` passed against `... of rationX`, because
    //     `CHARGE_GOOD` **is** `ration` today, so any mutation built from it is a superstring;
    //   · a set of whole words passed with the amount off by one and with the escrowable figure
    //     deleted, because in this fixture `payable === escrowableOwed === 350` and the surviving
    //     copy of the number satisfied the check for the missing one.
    //
    // So each figure is asserted **in the clause that gives it its meaning**, built from the quote
    // the engine published. That is deliberately brittle to rewording: `agent.md`, the affordance
    // strings and the observation field names are rules surfaces (HIGH-WATER-LESSONS, scar #1), and
    // a golden test that has to be updated when the wording changes is the point rather than the
    // cost — somebody looks at the sentence.
    const carry = runtime.levyCarryQuotes(rich).find((c) => c.payer === poor);
    expect(carry, 'no quote behind the offer').toBeDefined();
    if (carry === undefined) return;
    for (const [label, clause] of [
      [
        'what is handed over, in which good, from whose stores, at which place',
        `hands ${String(carry.payable)} of ${LEVY_GOOD} — out of YOUR stores, at ${place}, `,
      ],
      [
        'whose duty, split into the carryable share and the unbuyable one',
        `${poor} owes ${String(carry.escrowableOwed)} that any hand may carry and ` +
          `${String(carry.presenceOwed)} that ONLY its own hand may`,
      ],
      [
        'the deliverer\'s own position, which is what makes the offer safe to copy',
        `You hold ${String(carry.available)} of ${LEVY_GOOD} and still owe ` +
          `${String(carry.ownOwed)} on your own assessment; this offer is the ` +
          `${String(carry.surplus)} above that`,
      ],
    ] as const) {
      expect(text, `${label} — the clause is missing or its arithmetic has moved`).toContain(clause);
    }
    // The amount in the TEXT is the amount in `params`, or an agent that reads the prose and an
    // agent that copies the params are being told two different prices.
    expect(String(offer?.params['amount'])).toBe(String(carry.payable));
    // The non-escrowable share is the reason this cannot clear the whole bill, named as the rule
    // rather than left to be discovered from a smaller-than-expected credit.
    expect(text).toContain('non-escrowable and cannot be bought at any price');
    // No consideration is enforced, and saying so is the honest half: nothing here pays a carrier.
    expect(text.toLowerCase()).toContain('agree terms');
  });
});

describe('MAX_LEVY_CARRY_OFFERS caps OFFERS, not rows', () => {
  it('★ an unreachable co-member never consumes an offer slot', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE BUG THIS PINS, MEASURED.** The first implementation capped the whole traversal, so a
    // co-member whose row carried a `fault` — nothing left to carry, or no hand of yours at the
    // place — spent one of the two slots and the reachable payer further down the canonical order
    // was never seen. On `g01` at nine Reckonings that read as `carried` 50,411 with `levyShort`
    // still at 57,696; with the cap counting offers it is `carried` 93,633 and `levyShort` 1,275.
    //
    // A cap that counts unusable rows is a cap on the mechanism rather than on the payload — the
    // `Book.prune` hazard in a different coat, failing in the direction that hides.
    //
    // MUTATION: put the `if (out.length >= max) break;` back inside `levyCarryRows`' loop, or move
    // the `.slice` above the `.filter` in `levyCarryQuotes`, and this goes red naming the payer
    // that vanished.
    // ══════════════════════════════════════════════════════════════════════════
    const world = levyWorld('carry-cap', 4, 1);
    const roll = world.principals;
    const rich = roll[0];
    if (rich === undefined) throw new Error('levyWorld seated nobody');
    runTo(world.runtime, 1);
    walkToPlace(world.runtime, rich);
    tick(world.runtime); // presence lands the tick AFTER arrival — see `twoPrincipals`.

    const reckoning = reckoningIndex(world.runtime.engine.tick);
    const others = roll.filter((p) => p !== rich);
    expect(others.length, 'need at least three co-members for the cap to be testable').toBe(3);

    // Discharge the escrowable share of the FIRST co-member in canonical order, so its row is
    // present, faulted, and ahead of the others — exactly the row that used to eat a slot.
    // `compareIds`, not a bare sort: `levyCarryRows` walks `rollByConstellation`'s canonical order
    // and this has to name the same first row it does (DET-1).
    const first = [...others].sort(compareIds)[0];
    if (first === undefined) throw new Error('no co-member');
    const escrowable = world.runtime.levy.owingOf(reckoning, first).purchasableOwed;
    expect(escrowable, 'the fixture needs a real escrowable share to fill').toBeGreaterThan(0);
    world.runtime.levy.credit(reckoning, first, minor(escrowable), false);

    const offers = world.runtime.levyCarryQuotes(rich);
    expect(offers.length, 'the cap is the number of OFFERS').toBe(MAX_LEVY_CARRY_OFFERS);
    expect(
      offers.map((o) => o.payer),
      'the discharged co-member must not appear, and must not have displaced anybody',
    ).not.toContain(first);
    for (const offer of offers) {
      expect(offer.fault).toBeNull();
      expect(offer.payable).toBeGreaterThan(0);
    }
  });
});

describe('★ AN AGED WORLD ACTUALLY USES IT — `paidOther` is no longer zero', () => {
  it('the heuristic cast carries a neighbour\'s share across nine Reckonings', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE ONLY ASSERTION THAT CAN TELL AN UNUSED MECHANISM FROM A MISSING ONE.** An affordance
    // no cast ever selects is the second of the three depths this project's defining defect shows
    // up at — the four empty panels are the precedent — so offering the verb without a bot that
    // uses it would only have moved the defect one layer along.
    //
    // `g01` is the seed the residue was diagnosed on. Read from `Book.paymentOf` per settlement
    // rather than at the end: `Book.prune` keeps `LEVY_RETAINED_RECKONINGS` (3) Reckonings of
    // payment rows, so a last-look reading of a nine-Reckoning run would see a third of the truth
    // and report the smaller number — the instrument blind in the hiding direction again.
    //
    // MUTATION: delete the `carryFor` call from `decide`'s chain and this goes red on `carried`;
    // delete the branch's reserve and it stays green (the reserve is a starvation guard, not the
    // mechanism), which is why the two are asserted separately.
    // ══════════════════════════════════════════════════════════════════════════
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'g01' });
    const cast = new HeuristicCast(runtime, { size: 8 });
    cast.seat('g01');

    let carried = 0;
    let shortAfter = 0;
    for (let i = 0; i < 9 * TICKS_PER_RECKONING; i += 1) {
      const next = runtime.engine.tick + 1;
      for (const action of cast.decide(next, 'g01')) runtime.engine.submit(action);
      const report = runtime.runTick();
      expect(
        report.halted,
        `aged world halted at ${String(report.tick)}: ${report.violations
          .map((v) => `${v.id} ${v.message}`)
          .join(' | ')}`,
      ).toBe(false);
      if (isSettlementTick(report.tick)) {
        const reckoning = reckoningIndex(report.tick);
        for (const plan of runtime.levy.plansIn(reckoning)) {
          for (const l of plan.lines) carried += runtime.levy.paymentOf(reckoning, l.principal).paidOther;
        }
        shortAfter += runtime.levySettlement?.levyShort ?? 0;
      }
    }

    expect(
      carried,
      'no principal in nine Reckonings carried one unit of another\'s Levy. `deliver {payer}` is ' +
        'legal and executes, so a zero here means it is still offered to nobody who takes it — ' +
        'which reads, in every report and on every frame, exactly like a mechanism that does not exist',
    ).toBeGreaterThan(0);

    // And it is the thing that moved the meter. Master reads 87,714 on this seed at this horizon;
    // this asserts the ORDER OF MAGNITUDE rather than the figure, so a balance change elsewhere
    // does not make this file lie about causation.
    expect(
      shortAfter,
      'g01 was 87,714 short at nine Reckonings before the carry; if this is back above 40,000 the ' +
        'distribution route has stopped working and the residue is a §10 calibration question again',
    ).toBeLessThan(40_000);
  }, 300_000);
});
