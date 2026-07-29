/**
 * Can an agent REACH the risk market from the menu?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Copies `test/campaign/reachable.spec.ts` deliberately, which copies
 * `test/combat/reachable.spec.ts` deliberately. The defect all three exist for is the same one:
 *
 * > *"A capability that exists and is never exercised is indistinguishable from one that is
 * > missing"* — in every report, on every frame, and to every reader including its author.
 *
 * `test/api/agt-r5-reachability.test.ts` sweeps a live heuristic world and asks *"is every live verb
 * offered somewhere"*. It cannot enter this conjunction — a FRONT in FORECAST, a payer with earned
 * capital, and a payee holding goods inside the CONE — so this file is its REACHABLE-ELSEWHERE proof.
 *
 * **The three assertions per act are the pattern's, not a variation of it:**
 *
 *   1. the offer **exists** with the right discriminator (`publish_offer{COVER}`, not bare
 *      `publish_offer` — the verb also posts prose and cedes a claim, so *"publish_offer is offered"*
 *      would pass on a menu that never mentions insurance);
 *   2. its **params are complete and copyable**, because agents paste them verbatim;
 *   3. **the offer is takeable** — the affordance's own params object is sent straight back through
 *      the verb table, which is why the refusal logic is ONE function called by both rather than two
 *      that agree today.
 *
 * And a **negative half**, defended the same way `campaign/reachable.spec.ts` defends its: when the
 * act is unavailable the menu must **say so**, with the verb named in `header.withheld.verbs`. An
 * absence nobody accounts for is the same harm as not offering it, with the sign flipped.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { LEVY_GOOD } from '../../src/levy/index.js';
import { buildObservation } from '../../src/api/observe.js';
import type { Runtime } from '../../src/sim/runtime.js';
import { COVER_ELECTIVE_BPS_CEILING } from '../../src/risk/index.js';
import {
  FIRST_ANNOUNCE_TICK,
  FIRST_LANDFALL_TICK,
  act,
  fund,
  riskWorld,
  runTo,
  stockAt,
  tick,
} from './fixture.js';

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

/** Offers of one verb, filtered on a params key and value. Never a bare-verb filter. */
function offersOf(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  key?: string,
  value?: string,
): readonly { readonly params: Record<string, unknown>; readonly max_direct_loss: number; readonly what_it_forecloses: string }[] {
  const payload = observe(runtime, principal) as unknown as {
    readonly affordances: readonly {
      readonly verb: string;
      readonly params: Record<string, unknown>;
      readonly max_direct_loss: number;
      readonly what_it_forecloses: string;
    }[];
  };
  return payload.affordances.filter(
    (a) => a.verb === verb && (key === undefined || String(a.params[key]) === value),
  );
}

function withheldOf(runtime: Runtime, principal: PrincipalId): { verbs: string[]; reason: string } {
  const payload = observe(runtime, principal) as unknown as {
    readonly header: { readonly withheld: { readonly verbs: readonly string[]; readonly reason: string } };
  };
  return { verbs: [...payload.header.withheld.verbs], reason: payload.header.withheld.reason };
}

describe('the risk market is reachable from the menu', () => {
  it('offers `publish_offer {kind:"COVER"}` to a payer with earned capital, and it is TAKEABLE', () => {
    const world = riskWorld('reach-write', 4, 'MARCHES');
    const { runtime, principals } = world;
    const [payer, payee, bank] = principals;
    if (payer === undefined || payee === undefined || bank === undefined) throw new Error('unreachable');
    fund(runtime, bank, payer, 200_000);

    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    expect(front, 'a FRONT is in FORECAST, or there is nothing to write against').toBeDefined();
    if (front === undefined) throw new Error('unreachable');
    const cell = [...front.cone].sort((a, b) => b.oddsBps - a.oddsBps)[0];
    if (cell === undefined) throw new Error('unreachable');
    // Somebody else has to be HOLDING inside the CONE, or there is no interest to insure and the
    // engine correctly withholds instead of offering (see the negative half below).
    stockAt(runtime, payee, cell.system, 200_000, LEVY_GOOD);
    tick(runtime);

    const offers = offersOf(runtime, payer, 'publish_offer', 'kind', 'COVER');
    // MUTATION: drop the `risk.offered` loop from `api/observe.ts:affordancesFor`. This goes red;
    // nothing else in the suite does, because the verb handler and the book both keep working.
    expect(offers.length, '`publish_offer {kind:"COVER"}` is on the menu').toBeGreaterThan(0);
    const offer = offers[0];
    if (offer === undefined) throw new Error('unreachable');

    // The params must be complete and copyable — agents paste them verbatim.
    for (const key of ['kind', 'system', 'good', 'limit', 'premium', 'elective_bps']) {
      expect(Object.keys(offer.params), `params must carry ${key}`).toContain(key);
    }
    expect(offer.max_direct_loss, 'the escrowed half, exactly').toBeGreaterThan(0);
    expect(offer.what_it_forecloses, 'the prose names the escrow AND the promise').toMatch(/escrowed/);
    expect(offer.what_it_forecloses).toMatch(/word/);

    // ★ Takeable, with the affordance's own params.
    const taken = act(runtime, payer, 'publish_offer', offer.params);
    expect(taken, `the menu offered an act the engine refused: ${taken?.hint ?? ''}`).toBeNull();
    expect(runtime.risk.coversBy(payer).length, 'and a COVER exists').toBe(1);
  });

  it('offers `sign {cover}` only to a principal that HOLDS the goods — RSK1’s insurable interest', () => {
    const world = riskWorld('reach-sign', 5, 'MARCHES');
    const { runtime, principals } = world;
    const [payer, payee, stranger, bankA, bankB] = principals;
    if (
      payer === undefined ||
      payee === undefined ||
      stranger === undefined ||
      bankA === undefined ||
      bankB === undefined
    ) {
      throw new Error('unreachable');
    }
    fund(runtime, bankA, payer, 200_000);
    fund(runtime, bankB, payee, 200_000);

    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    const cell = [...front.cone].sort((a, b) => b.oddsBps - a.oddsBps)[0];
    if (cell === undefined) throw new Error('unreachable');
    stockAt(runtime, payee, cell.system, 200_000, LEVY_GOOD);

    const offered = act(runtime, payer, 'publish_offer', {
      kind: 'COVER',
      system: cell.system,
      good: LEVY_GOOD,
      limit: 40_000,
      premium: 1_000,
      elective_bps: COVER_ELECTIVE_BPS_CEILING,
    });
    expect(offered, `the offer was refused: ${offered?.hint ?? ''}`).toBeNull();

    const mine = offersOf(runtime, payee, 'sign');
    const coverOffers = mine.filter((o) => o.params['cover'] !== undefined);
    expect(coverOffers.length, 'the holder is offered `sign {cover}`').toBeGreaterThan(0);
    const take = coverOffers[0];
    if (take === undefined) throw new Error('unreachable');
    expect(Object.keys(take.params), 'and the terms_hash is on it, to echo').toContain('terms_hash');
    expect(take.max_direct_loss, 'the premium, exactly').toBe(1_000);

    // ★ The negative half, and it is not decorative: a stranger holding nothing there must NOT be
    // offered it. An offer a reader cannot take is an action it spends on a refusal every wake.
    //
    // MUTATION: delete the `held === undefined || held.qty <= 0` guard in `view.ts:coverOffersFor`.
    // This goes red and every principal in the galaxy is invited to insure goods it does not own.
    const strangerOffers = offersOf(runtime, stranger, 'sign').filter(
      (o) => o.params['cover'] !== undefined,
    );
    expect(strangerOffers.length, 'a principal with no interest there is not offered cover').toBe(0);

    const taken = act(runtime, payee, 'sign', take.params);
    expect(taken, `the menu offered a sign the engine refused: ${taken?.hint ?? ''}`).toBeNull();
    expect(runtime.risk.coversFor(payee).length).toBe(1);
  });

  it('offers `elect {cover}` once a FRONT has struck, and it disappears when it is settled', () => {
    const world = riskWorld('reach-elect', 5, 'MARCHES');
    const { runtime, principals } = world;
    const [payer, payee, , bankA, bankB] = principals;
    if (payer === undefined || payee === undefined || bankA === undefined || bankB === undefined) {
      throw new Error('unreachable');
    }
    fund(runtime, bankA, payer, 200_000);
    fund(runtime, bankB, payee, 200_000);

    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    const cell = [...front.swath].sort((a, b) => b.intensityBps - a.intensityBps)[0];
    if (cell === undefined) throw new Error('unreachable');
    stockAt(runtime, payee, cell.system, 400_000, LEVY_GOOD);

    act(runtime, payer, 'publish_offer', {
      kind: 'COVER',
      system: cell.system,
      good: LEVY_GOOD,
      limit: 40_000,
      premium: 1_000,
      elective_bps: COVER_ELECTIVE_BPS_CEILING,
    });
    const cover = runtime.risk.coversBy(payer)[0];
    if (cover === undefined) throw new Error('unreachable');
    act(runtime, payee, 'sign', { cover: cover.id, terms_hash: cover.termsHash ?? '' });

    // Before the strike there is nothing to elect on. That is the honest state and it is asserted, so
    // the positive assertion below cannot be true for the wrong reason.
    expect(
      offersOf(runtime, payer, 'elect').filter((o) => o.params['cover'] !== undefined).length,
      'nothing is due before a FRONT strikes',
    ).toBe(0);

    runTo(runtime, FIRST_LANDFALL_TICK);
    tick(runtime);
    const due = runtime.risk.dueBy(payer);
    expect(due.length, 'the INDEMNITY is open').toBe(1);
    expect(due[0]?.electiveDue, 'and it has an elective half to decide about').toBeGreaterThan(0);

    const elections = offersOf(runtime, payer, 'elect').filter((o) => o.params['cover'] !== undefined);
    expect(elections.length, '`elect {cover}` is on the menu').toBe(1);
    const election = elections[0];
    if (election === undefined) throw new Error('unreachable');
    expect(election.params['election'], 'IN_FULL, so a blind copier pays rather than guesses').toBe(
      'IN_FULL',
    );
    // The cost quoted is the elective half — the escrowed half is already committed and cannot be
    // refused, so quoting the whole limit would make honouring look identical to being ruined.
    expect(election.max_direct_loss).toBe(due[0]?.electiveDue);
    expect(election.what_it_forecloses).toMatch(/permanent/);

    const taken = act(runtime, payer, 'elect', election.params);
    expect(taken, `the menu offered an election the engine refused: ${taken?.hint ?? ''}`).toBeNull();
  });
});

describe('and when it is NOT offered, the menu says so — the withheld half', () => {
  it('names `publish_offer` with a ground when there is no FRONT to write against', () => {
    const world = riskWorld('reach-nofront', 3, 'MARCHES');
    const { runtime, principals } = world;
    const payer = principals[0];
    if (payer === undefined) throw new Error('unreachable');
    tick(runtime);

    // Non-vacuity: there really is no front this early.
    expect(runtime.risk.allFronts().length, 'no FRONT yet').toBe(0);
    const withheld = withheldOf(runtime, payer);
    // MUTATION: delete the `NO_RECORD` branch in `view.ts:coverAffordances`. This goes red, and the
    // verb becomes silent — which is `trade`'s 497-of-576 defect with a new subject.
    expect(withheld.verbs, 'the absence is accounted for, by name').toContain('publish_offer');
    expect(withheld.reason, 'and the sentence says what would bring it back').toMatch(/FRONT/);
  });

  it('names `publish_offer` with SHORT_FUNDS when the payer’s capital is all endowment — A15', () => {
    const world = riskWorld('reach-poor', 3, 'MARCHES');
    const { runtime, principals } = world;
    const [payer, payee] = principals;
    if (payer === undefined || payee === undefined) throw new Error('unreachable');

    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    const cell = [...front.cone].sort((a, b) => b.oddsBps - a.oddsBps)[0];
    if (cell === undefined) throw new Error('unreachable');
    stockAt(runtime, payee, cell.system, 200_000, LEVY_GOOD);
    tick(runtime);

    // ★ Nobody funded this payer, so its whole balance is withheld endowment.
    const withheld = withheldOf(runtime, payer);
    expect(withheld.verbs).toContain('publish_offer');
    expect(
      withheld.reason,
      'the sentence must name the A15 rule rather than just saying no: an agent that cannot tell ' +
        '"you are poor" from "your stake does not count" takes the wrong corrective action',
    ).toMatch(/starter stake|free cash/i);
    expect(offersOf(runtime, payer, 'publish_offer', 'kind', 'COVER').length).toBe(0);
  });
});

describe('delegation on a COVER election is shut, and the refusal says WHY', () => {
  it('★ refuses `on_behalf_of` by name rather than with a true-but-misleading reason', () => {
    const world = riskWorld('reach-delegate', 5, 'MARCHES');
    const { runtime, principals } = world;
    const [payee, payer, delegate, bankA, bankB] = principals;
    if (
      payee === undefined ||
      payer === undefined ||
      delegate === undefined ||
      bankA === undefined ||
      bankB === undefined
    ) {
      throw new Error('unreachable');
    }
    fund(runtime, bankA, payer, 200_000);
    fund(runtime, bankB, payee, 200_000);

    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    const cell = [...front.swath].sort((a, b) => b.intensityBps - a.intensityBps)[0];
    if (cell === undefined) throw new Error('unreachable');
    stockAt(runtime, payee, cell.system, 400_000, LEVY_GOOD);
    act(runtime, payer, 'publish_offer', {
      kind: 'COVER',
      system: cell.system,
      good: LEVY_GOOD,
      limit: 40_000,
      premium: 1_000,
      elective_bps: COVER_ELECTIVE_BPS_CEILING,
    });
    const cover = runtime.risk.coversBy(payer)[0];
    if (cover === undefined) throw new Error('unreachable');
    act(runtime, payee, 'sign', { cover: cover.id, terms_hash: cover.termsHash ?? '' });
    runTo(runtime, FIRST_LANDFALL_TICK);
    tick(runtime);

    // Non-vacuity: the election really is available to the payer itself, so the refusal below is about
    // delegation and not about the state of the obligation.
    expect(runtime.risk.dueBy(payer).length, 'an INDEMNITY is open').toBe(1);
    const own = act(runtime, payer, 'elect', { cover: cover.id, election: 'IN_FULL' });
    expect(own, `the payer's own election was refused: ${own?.hint ?? ''}`).toBeNull();

    // ★ And a delegate's is refused with the honest reason.
    //
    // `grant`, not `on_behalf_of`: `elect` is NOT in `HONOURS_ON_BEHALF` and a venture's election
    // delegates through `electionMandate`, which reads `['grant','grant_id']`. The first version of
    // both this test and the branch it exercises used the wrong spelling and the branch was dead code —
    // refused one layer up by `unhonouredOnBehalf`, with a message about a different rule.
    //
    // MUTATION: delete the `namedGrant !== null` branch from `wire.ts:electCover`. The act is still
    // refused — by `cover.payer !== principal` — so a naive test passes. What breaks is the SENTENCE:
    // it becomes "X is the payer, not you", which is true and describes the wrong rule. `elect` is in
    // `DELEGABLE_VERBS`, so an agent holding a good grant would read that as a fence problem and go
    // looking for one that does not exist. That is scar #1 in the agent-facing text.
    const delegated = act(runtime, delegate, 'elect', {
      cover: cover.id,
      election: 'IN_FULL',
      grant: 'g:whatever',
    });
    expect(delegated, 'a delegate is refused').not.toBeNull();
    expect(delegated?.hint, 'and told it is DELEGATION that is unavailable, not its grant').toMatch(
      /cannot be delegated/,
    );
    expect(
      delegated?.hint,
      'and that a venture role’s election IS delegable, so the distinction is learnable',
    ).toMatch(/venture role/);
    expect(delegated?.hint, 'and that nothing happened').toMatch(/Nothing was elected/);
    // And the OTHER spelling is refused one layer up, by the runtime's own guard, which is why the
    // branch above must not check it: `elect does not act on another principal's behalf`.
    const wrongSpelling = act(runtime, delegate, 'elect', {
      cover: cover.id,
      election: 'IN_FULL',
      on_behalf_of: payer,
    });
    expect(wrongSpelling?.hint, 'the runtime guard owns `on_behalf_of`').toMatch(
      /does not act on another principal/,
    );
  });
});
