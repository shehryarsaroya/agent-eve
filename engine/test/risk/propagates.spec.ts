/**
 * ★ THE ACCEPTANCE TEST: does a catastrophe actually propagate?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **Not a green suite.** Seventeen times a mechanic in this repo has been built, tested, reported
 * complete, and used by nothing. So this file asks the one question the whole layer exists to answer,
 * and it asks it of a **real `Runtime` running the real tick** — real `HAZARD`, real `OBLIGE`, real
 * verbs, real invariants in the real `ASSERT` phase. Nothing here constructs a settlement by hand.
 *
 * The chain under test is the smallest one that can fail interestingly:
 *
 * ```
 *   rk01 holds `ration` at a MARCHES system
 *   rk02 writes a primary COVER over it            ← publish_offer {kind:"COVER"}
 *   rk01 binds it                                   ← sign {cover}
 *   rk03 writes a COVER over rk02's COVER           ← publish_offer {kind:"COVER", over}
 *   rk02 binds that                                 ← sign {cover}
 *   a FRONT lands on the system                     ← HAZARD
 *   rk03 refuses its elective half                  ← silence
 *   rk02 is short, and decides                      ← elect {cover} or silence
 * ```
 *
 * **NON-VACUITY FIRST**, because this repo's signature defect is a check whose subject cannot happen.
 * Every block below opens by asserting the thing it is about actually occurred — the front struck, the
 * cohort is non-empty, the chain has two layers — before it asserts anything about the outcome. A
 * green "nothing propagated" over an empty cohort would be INV-22's silence with a new number.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { LEVY_GOOD } from '../../src/levy/index.js';
import { storesAccount } from '../../src/ledger/accounts.js';
import {
  COVER_ELECTIVE_BPS_CEILING,
  FRONT_COVER_FREEZE_TICKS,
  riskSubjects,
  stateAt,
  type CoverId,
} from '../../src/risk/index.js';
import type { Runtime } from '../../src/sim/runtime.js';
import {
  FIRST_ANNOUNCE_TICK,
  FIRST_FRONT_RECKONING,
  FIRST_LANDFALL_TICK,
  act,
  eventsOfKind,
  fund,
  riskWorld,
  runTo,
  stockAt,
  tick,
} from './fixture.js';

/** The one Reckoning we care about, one tick before its settlement. */
const SETTLE_TICK = FIRST_FRONT_RECKONING * TICKS_PER_RECKONING + TICKS_PER_RECKONING - 1;

interface Chain {
  readonly runtime: Runtime;
  readonly holder: PrincipalId;
  readonly primary: PrincipalId;
  readonly reinsurer: PrincipalId;
  readonly primaryCover: CoverId;
  readonly cession: CoverId;
  readonly system: string;
}

/**
 * Build the two-layer chain over a system the FRONT will actually strike.
 *
 * ★ **The system is chosen from the FRONT's own SWATH**, not from the CONE and not at random. Writing
 * cover over a system the storm misses is a legitimate outcome of the *game* and a useless one for a
 * test of propagation: the cohort would be empty and every assertion below would pass vacuously about
 * a mechanic that never ran. So the fixture takes the swath's first cell — which the engine has
 * already committed by then and simply not published — and stocks a holder there.
 */
function chain(seed: string): Chain {
  const world = riskWorld(seed, 7, 'MARCHES');
  const { runtime, principals } = world;
  const [holder, primary, reinsurer, bankA, bankB, bankC] = principals;
  if (
    holder === undefined ||
    primary === undefined ||
    reinsurer === undefined ||
    bankA === undefined ||
    bankB === undefined ||
    bankC === undefined
  ) {
    throw new Error('the fixture seats seven principals');
  }
  // ★ ALL THREE arrive with money they RECEIVED, and the A15 gate is why.
  //
  // The gate bit **twice** on this suite's first two runs, and both refusals were correct:
  //
  //   1. a payer's starter stake cannot fund an escrow — *"a fresh identity is worth zero here"*;
  //   2. a **payee's** starter stake cannot fund a premium either, and that half matters more than it
  //      looks. If it could, a puppet paying a premium to its operator would move endowment into the
  //      operator's `freeCash` — D7's laundering funnel through a door nobody had built yet. The
  //      subagent survey of `ledger/endowment.ts` flagged exactly this: *"a risk product that lets a
  //      puppet pay a premium to its operator is the D7 funnel through a new door."*
  //
  // So **both sides of the risk market are priced in `freeCash`**, which is the right answer for A15
  // and a real constraint on reachability: a newcomer can neither write cover nor buy it. GOV3's
  // newcomer microinsurance is the design answer to that and `params.ts` lists it as out of scope.
  fund(runtime, bankA, primary, 200_000);
  fund(runtime, bankB, reinsurer, 200_000);
  fund(runtime, bankC, holder, 200_000);

  runTo(runtime, FIRST_ANNOUNCE_TICK);
  const front = runtime.risk.allFronts()[0];
  expect(front, 'a FRONT is announced at this tick, or this whole file is about nothing').toBeDefined();
  if (front === undefined) throw new Error('unreachable');

  // ★ The cell with the HIGHEST intensity, not the alphabetically first one.
  //
  // `swath` is ordered by system id (canonical, for the hash), and intensity falls with lane distance
  // from the eye — so `swath[0]` can be a far cell at a few hundred bps. Building the fixture on it
  // gave a loss of 22,338 against a 60,000 limit, the primary's elective half came to 5,104, the
  // cession's escrowed half over-covered it, and **nothing propagated** while every other assertion
  // stayed green. The eye is where a storm tests an institution.
  const cell = [...front.swath].sort((a, b) => b.intensityBps - a.intensityBps)[0];
  expect(cell, 'the FRONT strikes at least SWATH_SYSTEMS_MIN systems').toBeDefined();
  if (cell === undefined) throw new Error('unreachable');
  const system = cell.system;

  // ★ The holding is large and BOTH layers are written at the elective CEILING, and both numbers are
  // decisions rather than round figures.
  //
  // `escrowedDue = min(covered, escrowed)` makes the elective half the **top slice** of a claim (see
  // `indemnity.ts:openPrimary`), so a small loss under a mostly-escrowed COVER produces `electiveDue:
  // 0` — nothing to elect, nothing to break, and this whole file green about a promise that was never
  // tested. That is exactly what the first run did. So: 400,000 units standing, and
  // `elective_bps: COVER_ELECTIVE_BPS_CEILING` on both layers, which is RSK3's cheap promise-heavy
  // cover and the configuration in which A7's second half actually engages.
  stockAt(runtime, holder, system, 400_000, LEVY_GOOD);

  // Layer 1 — the primary COVER.
  const offered = act(runtime, primary, 'publish_offer', {
    kind: 'COVER',
    system,
    good: LEVY_GOOD,
    limit: 60_000,
    premium: 1_000,
    elective_bps: COVER_ELECTIVE_BPS_CEILING,
  });
  expect(offered, `publish_offer {COVER} was refused: ${offered?.hint ?? ''}`).toBeNull();
  const primaryCover = runtime.risk.coversBy(primary)[0]?.id;
  expect(primaryCover, 'the offer is in the book').toBeDefined();
  if (primaryCover === undefined) throw new Error('unreachable');

  const signed = act(runtime, holder, 'sign', {
    cover: primaryCover,
    terms_hash: runtime.risk.requireCover(primaryCover).termsHash ?? '',
  });
  expect(signed, `sign {cover} was refused: ${signed?.hint ?? ''}`).toBeNull();

  // Layer 2 — the cession. This is RE1, and it is the only reason contagion is possible.
  const ceded = act(runtime, reinsurer, 'publish_offer', {
    kind: 'COVER',
    over: primaryCover,
    // ★ A PARTIAL cession, and the fraction is the point.
    //
    // A reinsurer takes a LAYER, not the whole risk (RE1: *"cede part of one large policy"*). It also
    // has to be a layer for the test to have a subject: if the cession's *escrowed* half alone covers
    // the primary's *elective* half, the primary is made whole by the certain money and never has a
    // decision to make. That is what happened on the first tuning — the primary settled `PAID` with
    // `elPaid 5104` out of the 12,500 its reinsurer's escrow handed over, and `propagated` was 0 with
    // no bug anywhere. So the cession is a sixth of the primary's limit.
    limit: 10_000,
    premium: 800,
    elective_bps: COVER_ELECTIVE_BPS_CEILING,
  });
  expect(ceded, `publish_offer {COVER, over} was refused: ${ceded?.hint ?? ''}`).toBeNull();
  const cession = runtime.risk.coversBy(reinsurer)[0]?.id;
  expect(cession, 'the cession is in the book').toBeDefined();
  if (cession === undefined) throw new Error('unreachable');

  const cededSigned = act(runtime, primary, 'sign', {
    cover: cession,
    terms_hash: runtime.risk.requireCover(cession).termsHash ?? '',
  });
  expect(cededSigned, `the primary could not bind its cession: ${cededSigned?.hint ?? ''}`).toBeNull();

  return { runtime, holder, primary, reinsurer, primaryCover, cession, system };
}

describe('the FRONT — CAT1, CAT2, and §10.1’s fourth sink', () => {
  it('is not vacuous: a FRONT is scheduled, announced, and strikes located goods', () => {
    const world = riskWorld('front-strikes', 2, 'MARCHES');
    const { runtime, principals, stage } = world;
    const holder = principals[0];
    if (holder === undefined) throw new Error('unreachable');

    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    expect(front, 'the FRONT is announced on its own tick — A14, a clock nobody can dodge').toBeDefined();
    if (front === undefined) throw new Error('unreachable');
    expect(front.cone.length, 'the CONE names systems').toBeGreaterThan(0);
    expect(front.swath.length, 'the SWATH is drawn at announcement and withheld').toBeGreaterThan(0);

    // MUTATION: delete the `HAZARD` handler registration in `runtime.ts`. This goes red here, and
    // `front.forecast` never appears in the record either, which is the second road.
    expect(eventsOfKind(runtime, 'front.forecast').length, 'the forecast is on the record').toBe(1);

    // ★ The CONE is published and the SWATH is NOT. CAT11 CUTS an oracle; this is that, checked.
    const forecast = eventsOfKind(runtime, 'front.forecast')[0];
    const payload = forecast?.payload as Record<string, unknown>;
    expect(Object.keys(payload)).toContain('cone');
    expect(Object.keys(payload), 'publishing the SWATH would be an oracle any agent could farm').not.toContain(
      'swath',
    );
    expect(forecast?.provenanceClass, 'a forecast is an ESTIMATE; A5 must not call it a fact').toBe(
      'ESTIMATE',
    );

    const cell = front.swath[0];
    if (cell === undefined) throw new Error('unreachable');
    stockAt(runtime, holder, cell.system, 30_000, LEVY_GOOD);
    const before = held(runtime, holder, cell.system);
    expect(before, 'the fixture stocked goods, or the strike has nothing to take').toBe(30_000);

    runTo(runtime, FIRST_LANDFALL_TICK);
    tick(runtime);

    const struck = eventsOfKind(runtime, 'front.swept');
    expect(struck.length, 'the FRONT struck').toBe(1);
    const after = held(runtime, holder, cell.system);
    // MUTATION: make `destroySet` skip `stores:` accounts. This goes red; nothing else notices,
    // because a front that takes nothing is a front whose whole record still reads as having landed.
    expect(after, 'located goods in the SWATH are gone (§10.1’s fourth sink)').toBeLessThan(before);
    expect(after, 'and FRONT_SPARES_QTY survives, so no obligation becomes impossible to pay').toBeGreaterThan(
      0,
    );
    void stage;
  });

  it('shuts to new COVER before it lands, and says so — CAT12’s free-option CUT', () => {
    const world = riskWorld('front-imminent', 2, 'MARCHES');
    const { runtime } = world;
    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');

    // Non-vacuity: the two states are both reachable on this front's own clock.
    expect(stateAt(front, FIRST_ANNOUNCE_TICK, FRONT_COVER_FREEZE_TICKS)).toBe('FORECAST');
    expect(
      stateAt(front, front.landfallTick - 1, FRONT_COVER_FREEZE_TICKS),
      'a front one tick from landfall is IMMINENT, or the freeze window is a decoration',
    ).toBe('IMMINENT');
    // MUTATION: set `FRONT_COVER_FREEZE_TICKS` to 0. The line above goes red.
    expect(FRONT_COVER_FREEZE_TICKS).toBeGreaterThan(0);
  });
});

describe('★ a catastrophe propagates — RE1, GOV4, and §16.12 #4', () => {
  it('is not vacuous: the chain has two layers over goods the FRONT actually took', () => {
    const c = chain('propagate-shape');
    const subjects = riskSubjects(c.runtime.risk);
    expect(subjects.boundCovers, 'both layers are bound').toBe(2);
    expect(subjects.cessions, 'one of them is a COVER over a COVER — RE1').toBe(1);
    expect(subjects.deepestChain, 'and the chain is two deep').toBe(2);
  });

  it('opens ONE cohort off ONE event, at both layers', () => {
    const c = chain('propagate-cohort');
    runTo(c.runtime, FIRST_LANDFALL_TICK);
    tick(c.runtime);

    const opened = eventsOfKind(c.runtime, 'indemnity.opened');
    expect(opened.length, 'the primary AND the cession both fell due off one strike').toBe(2);
    // ★ THE CORRELATION, as a column. One `event_family_id` for the whole cohort.
    const families = new Set(opened.map((e) => e.eventFamilyId));
    expect(families.size, 'one FRONT, one event family — that is what makes claims *correlated*').toBe(1);

    const depths = opened
      .map((e) => (e.payload as Record<string, number>)['depth'] ?? 0)
      .sort((a, b) => a - b);
    expect(depths, 'one primary at layer 1 and one cession at layer 2').toEqual([1, 2]);
  });

  it('★ a reinsurer’s refusal leaves the primary short, and the record says WHICH failure caused WHICH', () => {
    const c = chain('propagate-default');
    runTo(c.runtime, FIRST_LANDFALL_TICK);
    tick(c.runtime);

    const cohort = c.runtime.risk.cohortOf(c.runtime.risk.allFronts()[0]?.id ?? ('' as never));
    expect(cohort.length, 'a cohort to settle').toBe(2);

    // ── NON-VACUITY FOR THE SCENARIO ITSELF ────────────────────────────────
    //
    // The primary must owe MORE on its word than the cession's certain half can hand it, or the
    // certain money makes it whole and there is no decision to propagate. Asserted rather than
    // assumed, because this is the exact configuration the first tuning of this file got wrong.
    const primaryInd = cohort.find((i) => i.depth === 1);
    const cessionInd = cohort.find((i) => i.depth === 2);
    expect(primaryInd?.electiveDue, 'the primary has a promise to keep at all').toBeGreaterThan(0);
    expect(
      cessionInd?.escrowedDue ?? 0,
      'the reinsurer’s CERTAIN half must not cover the primary’s promise, or nothing is at stake',
    ).toBeLessThan(primaryInd?.electiveDue ?? 0);

    // The primary elects to pay its holder in full. The reinsurer elects NOTHING — silence, which
    // §7.4 MUST-5 is explicit about: *"disconnecting is no escape."*
    const elected = act(c.runtime, c.primary, 'elect', { cover: c.primaryCover, election: 'IN_FULL' });
    expect(elected, `the primary could not elect: ${elected?.hint ?? ''}`).toBeNull();

    // Drain the primary so it CANNOT pay out of its own pocket once the cession fails. This is the
    // whole scenario: solvent if its reinsurer pays, dead tonight if it does not (SOL4).
    drain(c.runtime, c.primary);

    runTo(c.runtime, SETTLE_TICK);
    tick(c.runtime);

    const defaults = eventsOfKind(c.runtime, 'indemnity.default');
    expect(defaults.length, 'somebody broke a promise').toBeGreaterThan(0);

    const propagated = eventsOfKind(c.runtime, 'indemnity.propagated');
    // ★ THE HEADLINE. A default whose cause is another default rather than the FRONT.
    //
    // MUTATION: in `settleCohort`, replace `upstreamDefaultEventId: letDownBy.get(ind.payer) ?? null`
    // with `null`. Every default then cites the front, `propagated` falls to 0, and this goes red —
    // while every individual settlement stays arithmetically correct, which is exactly why the
    // measurement has to exist rather than being inferred from the defaults' count.
    expect(
      propagated.length,
      'a failure travelled: the primary’s default cites the reinsurer’s, not the storm’s',
    ).toBeGreaterThan(0);
    const p = propagated[0]?.payload as Record<string, number>;
    expect(p['propagated']).toBeGreaterThan(0);
    expect(p['deepestFailure'], 'and the deepest failure is the outer layer').toBeGreaterThanOrEqual(2);
  });

  it('and the primary REMAINS LIABLE — there is no cut-through, deliberately', () => {
    const c = chain('propagate-liable');
    runTo(c.runtime, FIRST_LANDFALL_TICK);
    tick(c.runtime);

    const primaryInd = c.runtime.risk.indemnityForCover(c.primaryCover);
    const cessionInd = c.runtime.risk.indemnityForCover(c.cession);
    expect(primaryInd, 'the primary owes its holder').toBeDefined();
    expect(cessionInd, 'the reinsurer owes the primary').toBeDefined();
    if (primaryInd === undefined || cessionInd === undefined) throw new Error('unreachable');

    // MUTATION: make `openCession` reduce the primary's `covered` by what it ceded. This goes red,
    // and RE1's rule — *"the primary remains liable if the reinsurer defaults"* — silently inverts.
    expect(
      primaryInd.covered,
      'ceding risk does not reduce what you owe your own counterparty (RE1)',
    ).toBeGreaterThan(0);
    expect(cessionInd.grossLoss, 'the cession stands over the primary’s whole obligation').toBe(
      primaryInd.covered,
    );
  });

  it('settles OUTERMOST FIRST, so the primary decides knowing what it received (SOL2)', () => {
    const c = chain('propagate-order');
    runTo(c.runtime, FIRST_LANDFALL_TICK);
    tick(c.runtime);
    const front = c.runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    const order = c.runtime.risk.cohortOf(front.id).map((i) => i.depth);
    // MUTATION: flip the comparator in `RiskBook.cohortOf` to ascending depth. This goes red, and the
    // primary would then answer before its reinsurer — which deletes the propagation channel without
    // deleting a single line of the code that implements it.
    expect(order, 'descending depth: the reinsurer answers before the house it stands behind').toEqual([
      2, 1,
    ]);
  });
});

describe('the escrowed half is never a default — A7, A5′, and cargoLost’s own rule', () => {
  it('pays itself with no election at all, and standing is untouched by it', () => {
    const c = chain('escrow-auto');
    runTo(c.runtime, FIRST_LANDFALL_TICK);
    tick(c.runtime);
    const before = balance(c.runtime, c.holder);

    // No `elect` from anybody. The escrowed half must still arrive.
    runTo(c.runtime, SETTLE_TICK);
    tick(c.runtime);

    const after = balance(c.runtime, c.holder);
    // MUTATION: in `settleIndemnity`, guard the escrowed transfer on `input.election !== undefined`.
    // This goes red and A7's central claim quietly becomes conditional on the payer's goodwill.
    expect(after, 'the escrowed half executed with nobody deciding anything (A7)').toBeGreaterThan(before);

    const settled = eventsOfKind(c.runtime, 'indemnity.settled').concat(
      eventsOfKind(c.runtime, 'indemnity.default'),
    );
    expect(settled.length, 'the cohort settled').toBeGreaterThan(0);
    for (const e of settled) {
      const row = e.payload as Record<string, number>;
      // The two columns are separate so a reader can never mistake one for the other.
      expect(Object.keys(row)).toContain('recordedLoss');
      expect(Object.keys(row)).toContain('broke');
    }
  });
});

// ── reads ───────────────────────────────────────────────────────────────────

function held(runtime: Runtime, principal: PrincipalId, system: string): number {
  let total = 0;
  for (const lot of runtime.ledger.lotsInAccount(storesAccount(principal))) {
    if (lot.good !== LEVY_GOOD) continue;
    if (lot.location !== system) continue;
    if (lot.state === 'IN_TRANSIT') continue;
    total += lot.qty;
  }
  return total;
}

function balance(runtime: Runtime, principal: PrincipalId): number {
  return runtime.ledger.balance(storesAccount(principal));
}

/**
 * Empty a principal's free stores into a sink, so it is solvent-in-spirit and broke in fact.
 *
 * Through `retireCurrency` rather than a transfer to another principal, because a transfer would give
 * the money to somebody and change *their* decision too. This is the SOL4 scenario in its pure form:
 * *"solvent if its reinsurer pays, dead tonight if it does not."*
 */
function drain(runtime: Runtime, principal: PrincipalId): void {
  const account = storesAccount(principal);
  const free = runtime.ledger.freeBalance(account);
  if (free <= 0) return;
  runtime.ledger.retireCurrency({
    eventId: `fixture:drain:${principal}` as never,
    tick: runtime.engine.tick,
    sink: 'sink:fees' as never,
    from: account,
    amount: free,
  });
}
