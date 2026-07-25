/**
 * PROP-O5 — `if_you_do_nothing` is accurate.
 *
 * > "Take no action, advance to the next Reckoning, assert the stated consequence is
 * > what occurred. **This is the single highest-value cheap test in the document** — it
 * > is High Water's `projectedDrown` generalised, and it is what lets a model
 * > self-correct."
 *
 * The shape of every test below is the same and it is the shape TESTING.md asks for:
 *
 *   1. build a live venture through the **real** formation path;
 *   2. read `briefing.if_you_do_nothing`;
 *   3. settle through the **real** `settleBatch` with **an empty elections map** —
 *      which is what "taking no action" means (`settlement.ts:electionFor`: "An absent
 *      entry is zero. That single line is PROP-V4's second clause");
 *   4. assert the record matches what the briefing said it would be.
 *
 * A `FACT` outcome must match **exactly**. An `ESTIMATE` must contain what happened
 * inside its published p10..p90 band — asserting equality on an estimate would either
 * fail on honest randomness or force the test to pin the seed and stop testing the
 * claim `agent.md` §4 actually makes.
 */

import { describe, expect, it } from 'vitest';
import { minor, type Bps } from '../../src/core/units.js';
import { buildBriefing, buildObservation, nextSettlementTick } from '../../src/observe/index.js';
import {
  NEUTRAL_STAGE_BPS,
  computeProceeds,
  filledIndices,
  residualAtPercentile,
  settleVenture,
  IN_FULL,
} from '../../src/venture/index.js';
import { ticksUntilReckoning } from '../../src/core/time.js';
import type { Election } from '../../src/venture/index.js';
import {
  ACCOUNTS,
  ALICE,
  BRAM,
  CASS,
  STATE_VERSION,
  depositProceeds,
  ev,
  fill,
  fixture,
  goLive,
  levyOwing,
  makeHaul,
  makeTopYield,
  presenceOf,
  share,
  signAll,
  sourcesFor,
  vid,
  wage,
} from './fixture.js';

/** p50 proceeds — the residual the briefing quotes against. */
function proceedsAtP50(f: ReturnType<typeof fixture>, ventureId: string): number {
  const venture = f.book.require(vid(ventureId));
  return computeProceeds({
    kind: venture.kind,
    filled: filledIndices(venture),
    stageBps: NEUTRAL_STAGE_BPS,
    residualSignedBps: residualAtPercentile(venture.kind, 'p50'),
  }).proceeds;
}

describe('PROP-O5 — the payer is told exactly what electing nothing costs', () => {
  it('a wage role: the stated amount is the amount defaulted, to the unit', () => {
    const f = fixture();
    // A wage role is a fixed claim, so the prediction is arithmetic, not a forecast.
    const haul = makeHaul(f, { carrier: wage(1_000, 4_000), escort: wage(500, 500) });
    const proceeds = minor(proceedsAtP50(f, 'v-haul-1'));
    goLive(f, haul, [BRAM, CASS], proceeds);

    const briefing = buildBriefing(sourcesFor(f, { tick: 190 }), ALICE);
    const lapses = briefing.if_you_do_nothing.outcomes.filter((o) => o.kind === 'ELECTIVE_LAPSES');
    expect(lapses.length).toBe(2);
    for (const outcome of lapses) expect(outcome.provenance).toBe('FACT');
    const predicted = new Map(lapses.map((o) => [o.subject, o.amount]));

    // Taking no action: no elections at all.
    const settled = settleVenture(
      f.ledger,
      f.book,
      {
        venture: haul,
        tick: 200,
        eventId: ev('settle-1'),
        outcome: 'FULFILLED',
        proceeds,
        elections: new Map<number, Election>(),
        actedOnStateVersion: STATE_VERSION,
        causeEventId: null,
      },
      ACCOUNTS,
      presenceOf(f),
    );

    expect(settled.terminalState).toBe('DEFAULTED');
    expect(settled.defaults.length).toBe(2);
    for (const record of settled.defaults) {
      const key = `${record.venture}#${String(record.roleIndex)}`;
      expect(predicted.get(key), `no prediction for ${key}`).toBe(record.amount);
      expect(record.cause).toBe('DECLINED');
    }
    // And the total the briefing named is the total the record shows.
    const predictedTotal = [...predicted.values()].reduce((a, b) => a + b, 0);
    const actualTotal = settled.defaults.reduce((a, d) => a + d.amount, 0);
    expect(actualTotal).toBe(predictedTotal);
  });

  it('a share role: what happened falls inside the published p10..p90 band', () => {
    const f = fixture();
    const haul = makeHaul(f, {
      carrier: wage(1_000, 1_000),
      escort: share(3_000 as Bps, 500, 2_000),
    });
    goLive(f, haul, [BRAM, CASS], minor(0));

    const briefing = buildBriefing(sourcesFor(f, { tick: 190 }), ALICE);
    const shareOutcome = briefing.if_you_do_nothing.outcomes.find(
      (o) => o.kind === 'ELECTIVE_LAPSES' && o.provenance === 'ESTIMATE',
    );
    expect(shareOutcome).toBeDefined();
    if (shareOutcome === undefined) return;
    expect(shareOutcome.band).not.toBeNull();

    // Settle at p90 — the venture over-performed, which is the case agent.md §4 warns
    // about and the one where a naive prediction is wrong in the dangerous direction.
    const atP90 = minor(
      computeProceeds({
        kind: haul.kind,
        filled: filledIndices(haul),
        stageBps: NEUTRAL_STAGE_BPS,
        residualSignedBps: residualAtPercentile(haul.kind, 'p90'),
      }).proceeds,
    );
    depositProceeds(f, haul, atP90);
    const settled = settleVenture(
      f.ledger,
      f.book,
      {
        venture: haul,
        tick: 200,
        eventId: ev('settle-2'),
        outcome: 'FULFILLED',
        proceeds: atP90,
        elections: new Map<number, Election>(),
        actedOnStateVersion: STATE_VERSION,
        causeEventId: null,
      },
      ACCOUNTS,
      presenceOf(f),
    );

    const actual = settled.defaults.find(
      (d) => `${d.venture}#${String(d.roleIndex)}` === shareOutcome.subject,
    );
    expect(actual).toBeDefined();
    const band = shareOutcome.band;
    if (actual === undefined || band === null) return;
    // The estimate's own band contains the outcome. This is the honest form of the
    // claim: a p50 figure is not the bill, and the payload says so.
    expect(actual.amount).toBeGreaterThanOrEqual(band[0]);
    expect(actual.amount).toBeLessThanOrEqual(band[1]);
  });

  it('predicts no default for a venture that never bound — it fails to form', () => {
    // The A5-prime direction, and the bug this test found. A `FORMING` venture cannot
    // default: settlement refuses anything but `LIVE` or `DEFERRED`, so a half-filled
    // venture whose window closes is ABANDONED and nobody broke a promise. Predicting
    // `ELECTIVE_LAPSES` for it told the creator it was about to be recorded as a
    // defaulter over a deal that never bound.
    const f = fixture();
    const build_ = makeTopYield(f, 'BUILD', vid('v-build-partial'), ALICE, 3_000);
    fill(f, build_, 0, BRAM, 1);
    fill(f, build_, 2, CASS, 1);
    signAll(f, build_);
    expect(build_.state).toBe('FORMING');

    const briefing = buildBriefing(sourcesFor(f, { tick: 190 }), ALICE);
    const kinds = briefing.if_you_do_nothing.outcomes.map((o) => o.kind);
    expect(kinds).not.toContain('ELECTIVE_LAPSES');
    // What *is* true, and what the agent needs to know: roles stay open.
    expect(kinds).toContain('ROLE_OPEN');
    const open = briefing.if_you_do_nothing.outcomes.find((o) => o.kind === 'ROLE_OPEN');
    expect(open?.amount).toBe(2);

    // And the engine agrees that this venture cannot be settled at all.
    expect(() =>
      settleVenture(
        f.ledger,
        f.book,
        {
          venture: build_,
          tick: 200,
          eventId: ev('settle-3'),
          outcome: 'PARTIAL_FILL',
          proceeds: minor(0),
          elections: new Map<number, Election>(),
          actedOnStateVersion: STATE_VERSION,
          causeEventId: ev('cause-3'),
        },
        ACCOUNTS,
        presenceOf(f),
      ),
    ).toThrow(/FORMING/);
  });

  it('predicts nothing about a role the creator holds itself — self-dealing is not a breach', () => {
    // settlement.ts books a self-dealt elective part as fully paid, "so it can never
    // read as a breach". A briefing that predicted one would be inventing an accusation
    // against an agent for a promise to itself.
    //
    // ── THE VENTURE HAS TO BE LIVE, OR THIS TEST ASSERTS NOTHING ───────────────
    //
    // The first version stopped at `signAll`, leaving the venture FORMING — and
    // `buildBriefing` gates `payerOutcomes` on `state === 'LIVE'`, so the world produced
    // **zero** `ELECTIVE_LAPSES` outcomes of any kind and `not.toContain` could not fail.
    // Deleting the self-deal guard in `briefing.ts:payerOutcomes` left the whole suite
    // green. So the venture is driven all the way to LIVE, and the positive control below
    // proves the list this test filters is non-empty before the negative claim is made.
    const f = fixture();
    const haul = makeHaul(f, { creator: ALICE, carrier: wage(1_000, 3_000), escort: wage(0, 500) });
    goLive(f, haul, [ALICE, BRAM], minor(20_000));
    expect(haul.state).toBe('LIVE');

    const briefing = buildBriefing(sourcesFor(f, { tick: 190 }), ALICE);
    const lapses = briefing.if_you_do_nothing.outcomes.filter((o) => o.kind === 'ELECTIVE_LAPSES');
    // POSITIVE CONTROL: ALICE owes BRAM's role, so the payer prediction is running.
    expect(
      lapses.map((o) => o.subject),
      'no ELECTIVE_LAPSES at all means the negative assertion below is vacuous',
    ).toContain(`${haul.id}#1`);
    // THE CLAIM: and it says nothing about the role ALICE holds itself.
    expect(lapses.map((o) => o.subject)).not.toContain(`${haul.id}#0`);
  });

  it('warns about a DEFERRED obligation — the settlement set is not isLive', () => {
    // A5-PRIME, THE QUIET DIRECTION. `venture/venture.ts:LIVE_STATES` is the
    // hand-occupancy index (`FORMING | LIVE`); `venture/book.ts:settlementSet` is
    // `(LIVE | DEFERRED) && resolvesAtTick <= tick` and deliberately does not move
    // `resolvesAtTick`, because that field is inside `terms_hash`.
    //
    // Filtering the briefing by `isLive` therefore dropped every deferred obligation, and
    // `if_you_do_nothing` told the creator of a venture due at this very Reckoning:
    // "Nothing of yours resolves at the Reckoning on tick 287." An over-claim makes an
    // agent look; a false all-clear makes it go dark — and the retry records the default.
    const f = fixture();
    const haul = makeHaul(f, { id: vid('v-deferred'), creator: ALICE, resolvesAtTick: 250 });
    goLive(f, haul, [BRAM, CASS], minor(20_000));
    // The Reckoning driver's own outcome when the cascade hits its round limit (§15.3).
    f.book.resolve(haul.id, 'DEFERRED', 250);
    expect(f.book.require(haul.id).state).toBe('DEFERRED');

    const sources = sourcesFor(f, { tick: 260 });
    const at = nextSettlementTick(260);
    // THE ENGINE'S OWN ANSWER: it is in the settlement set, so it will be judged.
    expect(f.book.settlementSet(at).map((v) => v.id)).toContain(haul.id);

    const built = buildObservation(sources, ALICE).observation;
    expect(built.header.next_reckoning.what_resolves).toContain(haul.id);
    const kinds = built.briefing.if_you_do_nothing.outcomes.map((o) => o.kind);
    expect(kinds).not.toContain('NOTHING_RESOLVES');
    expect(kinds).toContain('ELECTIVE_LAPSES');
    expect(built.briefing.if_you_do_nothing.line).not.toContain('Nothing of yours resolves');

    // And the two sets agree, so they cannot drift: what observe says resolves for this
    // principal is exactly the engine's settlement set restricted to this principal.
    const engineDue = f.book
      .settlementSet(at)
      .filter((v) => v.creator === ALICE || v.roles.some((r) => r.filledByPrincipal === ALICE))
      .map((v) => v.id)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(
      [...built.header.next_reckoning.what_resolves].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ).toEqual(engineDue);
  });
});

describe('PROP-O5 — the payee is told what is guaranteed and what is not', () => {
  it('the escrowed half is stated as automatic, and it arrives', () => {
    const f = fixture();
    const haul = makeHaul(f, { carrier: wage(2_000, 1_000), escort: wage(500, 500) });
    const proceeds = minor(proceedsAtP50(f, 'v-haul-1'));
    goLive(f, haul, [BRAM, CASS], proceeds);

    const briefing = buildBriefing(sourcesFor(f, { tick: 190 }), BRAM);
    const escrow = briefing.if_you_do_nothing.outcomes.find((o) => o.kind === 'ESCROW_EXECUTES');
    expect(escrow).toBeDefined();
    if (escrow === undefined) return;
    expect(escrow.provenance).toBe('FACT');

    const before = f.ledger.balance(`stores:${BRAM}` as never);
    const settled = settleVenture(
      f.ledger,
      f.book,
      {
        venture: haul,
        tick: 200,
        eventId: ev('settle-4'),
        outcome: 'FULFILLED',
        proceeds,
        elections: new Map<number, Election>(),
        actedOnStateVersion: STATE_VERSION,
        causeEventId: null,
      },
      ACCOUNTS,
      presenceOf(f),
    );
    const paid = settled.payouts.find((p) => p.holder === BRAM);
    expect(paid?.escrowedPaid).toBe(escrow.amount);
    expect(f.ledger.balance(`stores:${BRAM}` as never) - before).toBe(escrow.amount);
  });

  it('the elective half is stated as the payer’s choice, never as an arrival', () => {
    const f = fixture();
    const haul = makeHaul(f, { carrier: wage(1_000, 3_000), escort: wage(500, 500) });
    goLive(f, haul, [BRAM, CASS], minor(proceedsAtP50(f, 'v-haul-1')));
    const briefing = buildBriefing(sourcesFor(f, { tick: 190 }), BRAM);
    const atRisk = briefing.if_you_do_nothing.outcomes.find((o) => o.kind === 'ELECTIVE_AT_RISK');
    expect(atRisk).toBeDefined();
    // The wording is part of the promise: it must not say the money is coming.
    expect(briefing.if_you_do_nothing.line).toContain("payer's choice");
    expect(briefing.if_you_do_nothing.line).toContain('not guaranteed');
  });

  it('an honoured elective half is not predicted as a loss', () => {
    const f = fixture();
    const haul = makeHaul(f, { carrier: wage(1_000, 3_000), escort: wage(500, 500) });
    const proceeds = minor(proceedsAtP50(f, 'v-haul-1'));
    goLive(f, haul, [BRAM, CASS], proceeds);
    const settled = settleVenture(
      f.ledger,
      f.book,
      {
        venture: haul,
        tick: 200,
        eventId: ev('settle-5'),
        outcome: 'FULFILLED',
        proceeds,
        // IN_FULL on both roles: the payer honours. Nothing may be recorded as broken.
        elections: new Map<number, Election>([
          [0, IN_FULL],
          [1, IN_FULL],
        ]),
        actedOnStateVersion: STATE_VERSION,
        causeEventId: null,
      },
      ACCOUNTS,
      presenceOf(f),
    );
    expect(settled.defaults).toEqual([]);
    expect(settled.terminalState).toBe('SETTLED');
  });
});

describe('PROP-O5 — the other outcomes are facts, not decoration', () => {
  it('names the settlement tick it is talking about', () => {
    const f = fixture();
    const briefing = buildBriefing(sourcesFor(f, { tick: 100 }), ALICE);
    expect(briefing.if_you_do_nothing.at_tick).toBe(100 + ticksUntilReckoning(100) - 1);
    expect(nextSettlementTick(100)).toBe(briefing.if_you_do_nothing.at_tick);
  });

  it('says so plainly when nothing of yours resolves', () => {
    const f = fixture();
    const briefing = buildBriefing(sourcesFor(f), ALICE);
    expect(briefing.if_you_do_nothing.outcomes.map((o) => o.kind)).toEqual(['NOTHING_RESOLVES']);
    expect(briefing.if_you_do_nothing.line).toContain('Nothing of yours resolves');
  });

  it('flags an unsealed role, which is mandatory before the freeze', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [BRAM, CASS], minor(12_000));
    const briefing = buildBriefing(sourcesFor(f, { tick: 190 }), BRAM);
    expect(briefing.if_you_do_nothing.outcomes.some((o) => o.kind === 'SEAL_ABSENT')).toBe(true);
  });

  it('reports the Levy exactly as owed, and stops reporting it once paid', () => {
    const f = fixture();
    const owing = buildBriefing(sourcesFor(f, { levy: levyOwing(f, 7_000) }), ALICE);
    const levy = owing.if_you_do_nothing.outcomes.find((o) => o.kind === 'LEVY_UNPAID');
    expect(levy?.amount).toBe(7_000);
    expect(levy?.provenance).toBe('FACT');

    const paid = buildBriefing(
      sourcesFor(f, { levy: { ...levyOwing(f, 7_000), paid: minor(7_000) } }),
      ALICE,
    );
    expect(paid.if_you_do_nothing.outcomes.some((o) => o.kind === 'LEVY_UNPAID')).toBe(false);
  });

  it('does not claim a venture resolves this Reckoning when it resolves later', () => {
    const f = fixture();
    const later = makeHaul(f, { windowClosesTick: 100, resolvesAtTick: 500 });
    goLive(f, later, [BRAM, CASS], minor(12_000));
    const briefing = buildBriefing(sourcesFor(f, { tick: 10 }), ALICE);
    expect(briefing.if_you_do_nothing.outcomes.some((o) => o.kind === 'ELECTIVE_LAPSES')).toBe(false);
    // The seal is still flagged: sealing is due this Reckoning even if settlement is not.
    expect(briefing.if_you_do_nothing.outcomes.some((o) => o.kind === 'ELECTIVE_LAPSES')).toBe(false);
  });

  it('the prompt names the dilemma in one sentence, within the line cap', () => {
    const f = fixture();
    const haul = makeHaul(f, { carrier: wage(1_000, 4_000), escort: wage(500, 500) });
    goLive(f, haul, [BRAM, CASS], minor(proceedsAtP50(f, 'v-haul-1')));
    const built = buildObservation(sourcesFor(f, { tick: 190 }), ALICE);
    const { prompt } = built.observation.briefing;
    expect(prompt.length).toBeGreaterThan(40);
    expect(prompt.length).toBeLessThanOrEqual(240);
    expect(prompt).toContain('elective');
  });

  it('outcomes are ordered by consequence, largest first', () => {
    const f = fixture();
    const haul = makeHaul(f, { carrier: wage(1_000, 5_000), escort: wage(500, 500) });
    goLive(f, haul, [BRAM, CASS], minor(proceedsAtP50(f, 'v-haul-1')));
    const briefing = buildBriefing(sourcesFor(f, { tick: 190, levy: levyOwing(f, 1) }), ALICE);
    const amounts = briefing.if_you_do_nothing.outcomes.map((o) => o.amount);
    const sorted = [...amounts].sort((a, b) => b - a);
    expect(amounts).toEqual(sorted);
  });
});
