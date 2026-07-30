/**
 * ★★ BEING STRUCK MUST NOT BE PROFITABLE — RSK1, CAT6, INV-R8, A5′.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ## What this file is about, measured before it was written
 *
 * `cover.ts`'s header opens by naming the defect it exists to prevent:
 *
 * > *"two covers over one holding make Σ indemnity exceed the real loss, one payer is unavoidably
 * > short, and **the record calls it a default**. That is the false-default problem arriving through an
 * > economic hole rather than a race, and §15.4's five defences would not catch it, because every
 * > individual settlement would be arithmetically correct."*
 *
 * And then all three of the guards enforcing it sat inside `if (cover.over.kind === 'GOODS')`, so a
 * **cession** got no exclusivity and no ceiling. Driven, seed `dbl`, MARCHES, `front:r3:sys-17`:
 *
 * ```
 * actual loss                       20,892
 * primary recovered   18,803 + 18,803 = 37,606     ← two reinsurers, each owing the WHOLE obligation
 * primary paid out                  18,803
 * ── net                            +18,803        for being struck
 * ```
 *
 * No halt. No fault. INV-R1…R7 green, `assertIndemnityExact` green on all three rows, every settlement
 * `PAID`. **Every guard was per-row and all three rows were individually correct**, which is the whole
 * argument for a conservation rule that is not a bind-time gate.
 *
 * ## Two roads, and this file drives both
 *
 *   1. **The gate.** `bindCover` now applies all three RSK1/CAT6 guards to both shapes of subject.
 *      Driven through the real verb table: the second cession is *refused*, and the refusal names why.
 *   2. **The invariant.** {@link checkInvR8} — *Σ indemnity receivable ≤ the recipient's own loss* —
 *      because a gate inside the wrong `if` is exactly what happened once, and a restore, a prune or a
 *      third shape of subject would do it again. Driven, and **mutation-proven by reproducing the
 *      pre-fix bind**: the old path is re-created by calling `bindCover` with `interestTaken: false`,
 *      and the world then **halts at landfall** rather than paying somebody twice.
 *
 * **NON-VACUITY FIRST.** Every block asserts its subject occurred in a driven world before it asserts
 * anything about a guard — because *"a green INV-R over an empty book"* is this repo's fifteenth
 * instance of one defect, and INV-R8 exists because the fourteenth reached money.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { LEVY_GOOD } from '../../src/levy/index.js';
import { storesAccount } from '../../src/ledger/accounts.js';
import {
  bindCover,
  checkInvR8,
  openPrimary,
  checkInvR9,
  checkRiskInvariants,
  COVER_ELECTIVE_BPS_CEILING,
  riskSubjects,
  type CoverId,
} from '../../src/risk/index.js';
import type { Runtime } from '../../src/sim/runtime.js';
import { COVER_OFFER_TTL_TICKS } from '../../src/risk/params.js';
import {
  FIRST_ANNOUNCE_TICK,
  FIRST_FRONT_RECKONING,
  FIRST_LANDFALL_TICK,
  act,
  fund,
  riskWorld,
  runTo,
  seatsFor,
  stockAt,
  tick,
} from './fixture.js';

const SETTLE_TICK = FIRST_FRONT_RECKONING * TICKS_PER_RECKONING + TICKS_PER_RECKONING - 1;

interface Tower {
  readonly runtime: Runtime;
  readonly holder: PrincipalId;
  readonly primary: PrincipalId;
  readonly reA: PrincipalId;
  readonly reB: PrincipalId;
  readonly primaryCover: CoverId;
  readonly system: string;
}

/**
 * A primary over real goods, and **two reinsurers each holding a published offer over it.**
 *
 * Both offers are *published* — publishing is not the act under test and RSK2's firm capacity means
 * both escrows are already funded — and only the first is bound here. What happens to the second is
 * the whole subject of this file.
 */
function tower(seed: string, cessionLimit = 30_000): Tower {
  const world = riskWorld(seed, 9, 'MARCHES');
  const { runtime } = world;
  const [holder, primary, reA, reB, b1, b2, b3, b4] = seatsFor(world, 0, 1, 2, 3, 4, 5, 6, 7);
  // Earned capital on every side: a starter stake's `freeCash` is zero and the A15 gate is right to
  // refuse it. See `fixture.ts:fund`.
  fund(runtime, b1, primary, 200_000);
  fund(runtime, b2, reA, 200_000);
  fund(runtime, b3, reB, 200_000);
  fund(runtime, b4, holder, 200_000);

  runTo(runtime, FIRST_ANNOUNCE_TICK);
  const front = runtime.risk.allFronts()[0];
  expect(front, 'a FRONT is announced at this tick, or this file is about nothing').toBeDefined();
  if (front === undefined) throw new Error('unreachable');
  // The eye: the highest-intensity cell, which since the truncation fix is always in the swath.
  const cell = [...front.swath].sort((a, b) => b.intensityBps - a.intensityBps)[0];
  if (cell === undefined) throw new Error('unreachable');
  const system = cell.system;

  stockAt(runtime, holder, system, 400_000, LEVY_GOOD);

  const offered = act(runtime, primary, 'publish_offer', {
    kind: 'COVER',
    system,
    good: LEVY_GOOD,
    limit: 60_000,
    premium: 1_000,
    elective_bps: COVER_ELECTIVE_BPS_CEILING,
  });
  expect(offered, `publish_offer {COVER} refused: ${offered?.hint ?? ''}`).toBeNull();
  const primaryCover = runtime.risk.coversBy(primary)[0]?.id;
  if (primaryCover === undefined) throw new Error('unreachable');
  const signed = act(runtime, holder, 'sign', {
    cover: primaryCover,
    terms_hash: runtime.risk.requireCover(primaryCover).termsHash ?? '',
  });
  expect(signed, `sign {cover} refused: ${signed?.hint ?? ''}`).toBeNull();

  for (const re of [reA, reB]) {
    const ceded = act(runtime, re, 'publish_offer', {
      kind: 'COVER',
      over: primaryCover,
      limit: cessionLimit,
      premium: 800,
      elective_bps: COVER_ELECTIVE_BPS_CEILING,
    });
    expect(ceded, `publish_offer {COVER, over} refused for ${re}: ${ceded?.hint ?? ''}`).toBeNull();
  }

  return { runtime, holder, primary, reA, reB, primaryCover, system };
}

function cessionOf(t: Tower, re: PrincipalId): CoverId {
  const id = t.runtime.risk.coversBy(re)[0]?.id;
  if (id === undefined) throw new Error(`${re} has no cession in the book`);
  return id;
}

describe('★ one interest, one COVER — and a CESSION is an interest (RSK1, CAT6)', () => {
  it('is not vacuous: two reinsurers really do publish offers over one primary', () => {
    const t = tower('cons-shape');
    const subjects = riskSubjects(t.runtime.risk);
    expect(subjects.cessions, 'two cessions exist in the book to compete for one primary').toBe(2);
    expect(subjects.boundCovers, 'and exactly one of the three is bound so far — the primary').toBe(1);
    // MUTATION: if `publishCover` refused a second offer over a bound cover, this file could not build
    // its subject at all and every assertion below would be about nothing. Publishing is deliberately
    // free — RSK2's firm capacity escrows at publication, so the offer board is not a list of lies —
    // and the exclusivity is enforced at *bind*, which is where the money and the liability meet.
    expect(subjects.covers, 'one primary and two competing cessions').toBe(3);
  });

  it('★ binds the FIRST cession and REFUSES the second, naming the double recovery', () => {
    const t = tower('cons-refuse');
    const first = cessionOf(t, t.reA);
    const second = cessionOf(t, t.reB);
    expect(first).not.toBe(second);

    const boundFirst = act(t.runtime, t.primary, 'sign', {
      cover: first,
      terms_hash: t.runtime.risk.requireCover(first).termsHash ?? '',
    });
    expect(boundFirst, `the first cession must bind: ${boundFirst?.hint ?? ''}`).toBeNull();

    // ★ THE FIX. MUTATION: put the three guards back inside `if (cover.over.kind === 'GOODS')` in
    // `bindCover` — or restore `interestTaken: cover.over.kind === 'GOODS' && …` in `wire.ts:signCover`
    // — and this goes green-to-red: the second cession binds, and the world then pays the primary
    // twice for one loss with every settlement arithmetically correct.
    const boundSecond = act(t.runtime, t.primary, 'sign', {
      cover: second,
      terms_hash: t.runtime.risk.requireCover(second).termsHash ?? '',
    });
    expect(boundSecond, 'the second cession over one COVER is refused').not.toBeNull();
    // A2: the refusal names the parent AND the cession already standing over it, so a payee does not
    // have to grep its own book to find out what collided.
    expect(boundSecond?.hint ?? '', 'and names the parent it collides over').toContain(t.primaryCover);
    expect(boundSecond?.hint ?? '', 'and the cession already there').toContain(first);
    expect(
      boundSecond?.hint ?? '',
      'and says what binding both would do, in the words A5′ uses',
    ).toContain('twice for one loss');
    expect(riskSubjects(t.runtime.risk).boundCovers, 'so two covers stand, not three').toBe(2);
  });

  it('refuses a cession that promises MORE than the layer below could ever owe (the ceiling)', () => {
    // The primary's limit is 60,000, so a 90,000 cession is a reinsurer promising to cover a loss
    // larger than any the primary can suffer.
    const t = tower('cons-ceiling', 90_000);
    const over = cessionOf(t, t.reA);
    const refused = act(t.runtime, t.primary, 'sign', {
      cover: over,
      terms_hash: t.runtime.risk.requireCover(over).termsHash ?? '',
    });
    // MUTATION: this is the guard `interestOf` made untestable by returning the CESSION's own limit as
    // the unit price — `ceiling = cover.limit` and then `if (cover.limit > cover.limit)`, a field
    // compared to itself. Restore `unitPrice: minor(cover.limit)` and this goes red.
    expect(refused, 'a cession may not exceed its parent’s limit').not.toBeNull();
    expect(refused?.hint ?? '', 'and the refusal publishes both numbers').toContain('60000');
    expect(refused?.hint ?? '').toContain('90000');
  });

  it('refuses a cession over a COVER nobody has bound — there is no interest under it', () => {
    const world = riskWorld('cons-unbound', 5, 'MARCHES');
    const { runtime } = world;
    const [primary, re, b1, b2] = seatsFor(world, 0, 1, 2, 3);
    fund(runtime, b1, primary, 200_000);
    fund(runtime, b2, re, 200_000);
    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    const cell = [...front.swath].sort((a, b) => b.intensityBps - a.intensityBps)[0];
    if (cell === undefined) throw new Error('unreachable');
    act(runtime, primary, 'publish_offer', {
      kind: 'COVER',
      system: cell.system,
      good: LEVY_GOOD,
      limit: 60_000,
      premium: 1_000,
      elective_bps: COVER_ELECTIVE_BPS_CEILING,
    });
    const unbound = runtime.risk.coversBy(primary)[0]?.id;
    if (unbound === undefined) throw new Error('unreachable');
    // `publishCover` already refuses this one at the door, and it should: a cession attaches to an
    // obligation somebody has actually taken on. Asserted so the two roads cannot silently become one.
    const refused = act(runtime, re, 'publish_offer', {
      kind: 'COVER',
      over: unbound,
      limit: 10_000,
      premium: 800,
      elective_bps: COVER_ELECTIVE_BPS_CEILING,
    });
    expect(refused, 'a cession over an unbound offer is refused').not.toBeNull();
    expect(refused?.hint ?? '').toContain('not bound');
  });
});

describe('★★ INV-R8 — Σ indemnity receivable ≤ the recipient’s own loss (CAT6, A5′)', () => {
  it('is not vacuous: a driven, LEGITIMATE chain has receivables the rule ranges over', () => {
    const t = tower('r8-subject');
    const first = cessionOf(t, t.reA);
    act(t.runtime, t.primary, 'sign', {
      cover: first,
      terms_hash: t.runtime.risk.requireCover(first).termsHash ?? '',
    });
    runTo(t.runtime, FIRST_LANDFALL_TICK);
    tick(t.runtime);

    const subjects = riskSubjects(t.runtime.risk);
    // ★ THE DENOMINATOR. Without this the rule below is *"nobody was owed anything"* wearing a green
    // tick, which is INV-22's silence with a new number — the exact failure this module's own
    // `invariants.ts` header claims to have avoided and then instantiated.
    expect(subjects.payeesWithReceivables, 'somebody is actually owed something').toBeGreaterThan(0);
    expect(subjects.indemnities, 'at both layers').toBe(2);
    expect(subjects.deepestChain, 'over a two-deep chain').toBe(2);
    expect(checkInvR8(t.runtime.risk), 'and a legitimate chain does not trip it').toEqual([]);
  });

  it('★ a legitimate chain moves the loss inward three times and is NOT a breach', () => {
    const t = tower('r8-chain');
    const first = cessionOf(t, t.reA);
    act(t.runtime, t.primary, 'sign', {
      cover: first,
      terms_hash: t.runtime.risk.requireCover(first).termsHash ?? '',
    });
    runTo(t.runtime, FIRST_LANDFALL_TICK);
    tick(t.runtime);

    const front = t.runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    const cohort = t.runtime.risk.cohortOf(front.id);
    const primaryInd = cohort.find((i) => i.depth === 1);
    const cessionInd = cohort.find((i) => i.depth === 2);
    if (primaryInd === undefined || cessionInd === undefined) throw new Error('unreachable');

    // Gross Σ over the chain is 2× the loss and that is CORRECT: the holder is paid, and the primary
    // is reimbursed for what it paid. So a rule that summed the chain would fire on the healthy case
    // and could only be silenced by deleting it. The conserved quantity is **per recipient**.
    expect(
      primaryInd.covered + cessionInd.covered,
      'gross Σ over the chain legitimately exceeds one loss — money is flowing inward',
    ).toBeGreaterThan(primaryInd.grossLoss);
    expect(
      cessionInd.covered,
      'but the reinsurer never owes the primary more than the primary owes its holder (RE1)',
    ).toBeLessThanOrEqual(primaryInd.covered);
    expect(checkInvR8(t.runtime.risk), 'so the rule is silent').toEqual([]);
  });

  it('★★ MUTATION — reproduce the pre-fix bind and the world HALTS at landfall', () => {
    // ★ `60_000` — the primary's own limit — and the number is the point. `openCession` gives every
    // cession `grossLoss = under.covered`, the **whole** obligation below it (RE1 facultative; RE2's
    // quota share is not built), so a cession at the parent's limit always covers the entire claim and
    // two of them always double it. At `30_000` each the two would *exactly tile* a maximal loss and Σ
    // receivable would equal the obligation — no over-recovery, and INV-R8 correctly stays silent. That
    // asymmetry is why **both roads are needed**: the invariant is exact and therefore loss-dependent,
    // while the bind-time gate refuses the construction whatever the storm turns out to do.
    const t = tower('r8-halt', 60_000);
    const first = cessionOf(t, t.reA);
    const second = cessionOf(t, t.reB);
    const boundFirst = act(t.runtime, t.primary, 'sign', {
      cover: first,
      terms_hash: t.runtime.risk.requireCover(first).termsHash ?? '',
    });
    expect(boundFirst, 'the legitimate cession binds').toBeNull();

    // ── ★ THE PRE-FIX PATH, EXACTLY ────────────────────────────────────────────
    //
    // `interestTaken: false` for a cession is what `wire.ts:signCover` used to pass unconditionally
    // (`cover.over.kind === 'GOODS' && …`), and `unitPrice: parent.limit` is what `interestOf` used to
    // get wrong. Calling `bindCover` directly with the old arguments re-creates the shipped behaviour
    // without editing `src/`, which is what makes this a regression test and not a description of one.
    const row = t.runtime.risk.requireCover(second);
    const parent = t.runtime.risk.requireCover(t.primaryCover);
    const bound = bindCover({
      cover: row,
      payee: t.primary,
      tick: t.runtime.engine.tick,
      echoedTermsHash: row.termsHash ?? '',
      stateVersion: 1,
      interestQty: 1,
      unitPrice: parent.limit,
      interestTaken: false,
      frontCoverFrozen: false,
    });
    expect(bound.ok, 'the old arguments bind the second cession — that WAS the bug').toBe(true);
    expect(riskSubjects(t.runtime.risk).boundCovers, 'three bound covers over one loss').toBe(3);

    // ── AND THE INVARIANT CATCHES IT WHERE THE GATE DID NOT ────────────────────
    let halt = '';
    try {
      runTo(t.runtime, FIRST_LANDFALL_TICK);
      tick(t.runtime);
    } catch (error) {
      halt = String(error);
    }
    expect(halt, 'the tick that opens the double cohort halts').toContain('INV-R8');
    expect(halt, 'and the message says who is owed how much against what loss').toContain(t.primary);
    expect(halt, 'and names the conservation rule in CAT6’s words').toContain(
      'may never exceed the real loss',
    );
  });

  it('★ and the FAILURE MODE it prevents, stated as arithmetic in the halt message', () => {
    const t = tower('r8-numbers', 60_000);
    const first = cessionOf(t, t.reA);
    act(t.runtime, t.primary, 'sign', {
      cover: first,
      terms_hash: t.runtime.risk.requireCover(first).termsHash ?? '',
    });
    const row = t.runtime.risk.requireCover(cessionOf(t, t.reB));
    const parent = t.runtime.risk.requireCover(t.primaryCover);
    bindCover({
      cover: row,
      payee: t.primary,
      tick: t.runtime.engine.tick,
      echoedTermsHash: row.termsHash ?? '',
      stateVersion: 1,
      interestQty: 1,
      unitPrice: parent.limit,
      interestTaken: false,
      frontCoverFrozen: false,
    });

    // ★ The numbers are read off the HALT MESSAGE rather than the post-abort book, and that is not a
    // convenience: an aborted tick **rolls the books back** (*"never held across a tick boundary: the
    // rollback replaces it"*), so the state the invariant refused only survives in what it said about
    // it. Which is also the property that makes the halt useful to an operator at 3am.
    let detail = '';
    try {
      runTo(t.runtime, FIRST_LANDFALL_TICK);
      tick(t.runtime);
    } catch (error) {
      detail = String(error);
    }
    expect(detail, 'the tick halted').toContain('INV-R8');

    // ★ The measured shape of the original defect: owed once, receivable twice.
    const owed = Number(/against a loss of (\d+)/.exec(detail)?.[1] ?? 0);
    const gets = Number(/is owed (\d+)/.exec(detail)?.[1] ?? 0);
    expect(owed, 'the primary owes a real amount').toBeGreaterThan(0);
    expect(gets, 'and is owed strictly more than that').toBeGreaterThan(owed);
    expect(gets, 'twice over, because each cession stands over the WHOLE obligation below it').toBe(
      owed * 2,
    );
    expect(detail, 'and the halt names the goods half of the loss as zero — a payer is not a holder').toContain(
      '0 in goods',
    );
  });

  it('subsumes INV-R3’s economics: two primaries over one holding trip it too', () => {
    const world = riskWorld('r8-double-primary', 6, 'MARCHES');
    const { runtime } = world;
    const [holder, pA, pB, b1, b2, b3] = seatsFor(world, 0, 1, 2, 3, 4, 5);
    fund(runtime, b1, pA, 200_000);
    fund(runtime, b2, pB, 200_000);
    fund(runtime, b3, holder, 200_000);
    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    const cell = [...front.swath].sort((a, b) => b.intensityBps - a.intensityBps)[0];
    if (cell === undefined) throw new Error('unreachable');
    stockAt(runtime, holder, cell.system, 400_000, LEVY_GOOD);
    expect(COVER_OFFER_TTL_TICKS, 'the offer clock is short on purpose — see the note below').toBe(144);

    const ids: CoverId[] = [];
    for (const payer of [pA, pB]) {
      act(runtime, payer, 'publish_offer', {
        kind: 'COVER',
        system: cell.system,
        good: LEVY_GOOD,
        limit: 60_000,
        premium: 1_000,
        elective_bps: COVER_ELECTIVE_BPS_CEILING,
      });
      const id = runtime.risk.coversBy(payer)[0]?.id;
      if (id === undefined) throw new Error('unreachable');
      ids.push(id);
    }
    const [firstId, secondId] = ids as [CoverId, CoverId];
    const okFirst = act(runtime, holder, 'sign', {
      cover: firstId,
      terms_hash: runtime.risk.requireCover(firstId).termsHash ?? '',
    });
    expect(okFirst, 'the first cover binds').toBeNull();
    const refused = act(runtime, holder, 'sign', {
      cover: secondId,
      terms_hash: runtime.risk.requireCover(secondId).termsHash ?? '',
    });
    expect(refused, 'the second over the same (payee, system, good) is refused').not.toBeNull();

    // ── ★ AND NOW BOTH ROADS, ON ONE BOOK ──────────────────────────────────────
    //
    // The gate is bypassed the way it used to bypass itself, and the two claims are opened **without a
    // tick in between**. Two reasons, and both are properties of the engine rather than convenience:
    //
    //   1. an aborted tick **rolls the books back** (*"never held across a tick boundary: the rollback
    //      replaces it"*), so the state an invariant refused does not survive to be inspected;
    //   2. an **unbound** offer lapses on {@link COVER_OFFER_TTL_TICKS} — 144 ticks — while landfall is
    //      two Reckonings out, so waiting for the strike means binding a `LAPSED` row. That is the two
    //      clocks working exactly as `params.ts` says they must.
    const row = runtime.risk.requireCover(secondId);
    const bound = bindCover({
      cover: row,
      payee: holder,
      tick: runtime.engine.tick,
      echoedTermsHash: row.termsHash ?? '',
      stateVersion: 1,
      interestQty: 400_000,
      unitPrice: minor(1),
      interestTaken: false,
      frontCoverFrozen: false,
    });
    expect(bound.ok, 'the old arguments bind a second cover over one holding — that WAS the bug').toBe(true);

    const front2 = runtime.risk.allFronts()[0];
    if (front2 === undefined) throw new Error('unreachable');
    for (const id of [firstId, secondId]) {
      runtime.risk.addIndemnity(
        openPrimary({
          cover: runtime.risk.requireCover(id),
          front: front2.id,
          // The SAME destroyed goods, valued at the SAME pinned mark — which is the whole point: one
          // loss, two claims, each arithmetically correct.
          qtyLost: 40_000 as never,
          good: LEVY_GOOD,
          tick: runtime.engine.tick,
          dueTick: runtime.engine.tick + 1,
          causeEventId: 'ev:test:one-loss' as never,
        }),
      );
    }

    const faults = checkRiskInvariants(runtime.ledger, runtime.risk).map((f) => f.invariant);
    // R3 names the offending pair — which is what a halt message needs.
    expect(faults, 'INV-R3 sees two covers over one (payee, system, good)').toContain('INV-R3');
    // ★ R8 prices the same economics, which is what lets it ALSO see the cession shape R3's key
    // grammar cannot reach. Two roads over one book, and only one of them generalises.
    expect(faults, 'and INV-R8 prices it').toContain('INV-R8');
    const r8 = checkInvR8(runtime.risk);
    expect(r8.length, 'exactly one over-recovered principal').toBe(1);
    expect(r8[0]?.detail ?? '', 'and it is the holder').toContain(holder);

    // ★ AND THE REGISTRATION IS WHAT MAKES EITHER OF THEM MATTER. `assertRiskInvariants` used to have
    // one caller, inside `runCohortPhase` — a settlement tick, per struck FRONT, only with a non-empty
    // cohort — so a book in this state went unchecked for the rest of the Reckoning. It now aborts the
    // very next tick, through `ASSERT`.
    let halt = '';
    try {
      tick(runtime);
    } catch (error) {
      halt = String(error);
    }
    expect(halt, 'and the next tick halts rather than discovering it at settlement').toContain('INV-R8');
  });
});

describe('INV-R9 — one unstruck FRONT, measured rather than asserted in a comment', () => {
  it('is not vacuous: a driven world really does carry exactly one unstruck FRONT', () => {
    const world = riskWorld('r9-subject', 2, 'MARCHES');
    runTo(world.runtime, FIRST_ANNOUNCE_TICK);
    // ★ THE DENOMINATOR. `MAX_LIVE_FRONTS` used to be a silent `return null` inside `announceIfDue`
    // whose condition the schedule made unreachable — a guard whose subject cannot occur, guarding in
    // the direction A14 forbids (a scheduled front may not be skipped).
    expect(riskSubjects(world.runtime.risk).unstruckFronts, 'one, on the announcement tick').toBe(1);
    expect(checkInvR9(world.runtime.risk), 'so the bound is satisfied, not vacuous').toEqual([]);

    runTo(world.runtime, FIRST_LANDFALL_TICK);
    tick(world.runtime);
    expect(riskSubjects(world.runtime.risk).unstruckFronts, 'and zero once it lands').toBe(0);
  });

  it('MUTATION — a second unstruck FRONT in the book fires it', () => {
    const world = riskWorld('r9-mutate', 2, 'MARCHES');
    runTo(world.runtime, FIRST_ANNOUNCE_TICK);
    const front = world.runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    // The world-level mutation is `FRONT_EVERY_RECKONINGS = 1`, which announces `R + 1` a Reckoning
    // before `R` lands. Reproduced here as a second row so the test does not have to move a constant.
    world.runtime.risk.addFront({ ...front, id: `${front.id}:twin` as never, struckAtTick: null });
    const faults = checkInvR9(world.runtime.risk);
    expect(faults.length, 'two unstruck fronts is a weather map instead of a story').toBe(1);
    expect(faults[0]?.detail ?? '', 'and the message cites A13’s label budget').toContain('A13');
    expect(checkRiskInvariants(world.runtime.ledger, world.runtime.risk).map((f) => f.invariant)).toContain(
      'INV-R9',
    );
  });
});

describe('and being struck is not profitable end to end, in the ledger', () => {
  it('★ a primary’s stores never rise by more than the premiums it earned', () => {
    const t = tower('cons-ledger');
    const first = cessionOf(t, t.reA);
    act(t.runtime, t.primary, 'sign', {
      cover: first,
      terms_hash: t.runtime.risk.requireCover(first).termsHash ?? '',
    });
    runTo(t.runtime, FIRST_LANDFALL_TICK);
    tick(t.runtime);

    const before = t.runtime.ledger.balance(storesAccount(t.primary));
    act(t.runtime, t.primary, 'elect', { cover: t.primaryCover, election: 'IN_FULL' });
    act(t.runtime, t.reA, 'elect', { cover: first, election: 'IN_FULL' });
    runTo(t.runtime, SETTLE_TICK);
    tick(t.runtime);
    const after = t.runtime.ledger.balance(storesAccount(t.primary));

    const front = t.runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    const cohort = t.runtime.risk.cohortOf(front.id);
    expect(cohort.length, 'the cohort settled at both layers').toBe(2);
    expect(cohort.every((i) => i.state === 'PAID'), 'everybody paid in full').toBe(true);

    // ★ THE HEADLINE, AS MONEY. The primary is a *conduit*: it receives from its reinsurer and pays
    // its holder, so the front leaves it no better off than the escrow it had already committed. Before
    // the fix this delta was **+18,803 on a 20,892 loss**.
    //
    // MUTATION: bind the second cession (see the block above) and this goes red by the cession's whole
    // `covered` — while every settlement row still reads `PAID` with `broke: 0`.
    expect(after - before, 'the storm did not make the underwriter richer').toBeLessThanOrEqual(0);
    expect(checkInvR8(t.runtime.risk), 'and the conservation rule agrees').toEqual([]);
  });
});
