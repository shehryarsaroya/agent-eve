/**
 * **PROP-LV1 · PROP-LV2 · E2E-7 · E2E-8 — the vote, and what it cannot do.**
 *
 *   - `PROP-LV1` Any vote outcome sums to the total. Quorum failure falls back to the
 *     published inverse-Exposure formula.
 *   - `PROP-LV2` The newcomer floor holds under **every** allocation, including
 *     adversarial votes explicitly targeting a newcomer. Newcomers are never in the
 *     seizure queue.
 *   - `E2E-7` A vote adversarially targets one principal; the floor and the "never
 *     identity, never holding, never standing" guarantee both hold.
 *   - `E2E-8` Quorum fails; the published formula applies; **the result is identical to
 *     the formula computed independently.**
 *
 * E2E-8 is the one worth reading twice, because it is the difference between a test and a
 * tautology: the expected allocation is computed here, from the published rule, by a
 * second road — not read back out of the object under test.
 */

import { describe, expect, it } from 'vitest';
import type { ConstellationId, PrincipalId } from '../../src/core/types.js';
import {
  LEVY_NOMINAL_MINOR,
  LEVY_SPARE_MIN_NOMINATIONS,
  PUBLISHED_DEFAULT_RULE,
  allocate,
  ballotFault,
  largestRemainder,
  namedLoser,
  quorumFor,
  tally,
  totalFor,
  weightOf,
  type LevyBallot,
  type LevyRule,
} from '../../src/levy/index.js';
import { newcomer, subject } from './fixture.js';

const C = 'c:one' as ConstellationId;

function ballot(principal: string, rule: LevyRule, spare: string | null = null, forReckoning = 1): LevyBallot {
  return {
    principal: principal as PrincipalId,
    constellation: C,
    forReckoning,
    rule,
    spare: spare === null ? null : (spare as PrincipalId),
    tick: 10,
  };
}

describe('PROP-LV1 — any vote outcome sums to the total', () => {
  it('holds for every rule the ballot can name, with and without a spared principal', () => {
    const subjects = [
      subject('p:a', { exposurePeak: 0, freeStores: 700_000 }),
      subject('p:b', { exposurePeak: 5_000, freeStores: 3 }),
      subject('p:c', { exposurePeak: 900_000, freeStores: 400_000 }),
      newcomer('p:new'),
    ];
    const total = totalFor(subjects);
    for (const rule of ['BY_EXPOSURE', 'BY_STORES', 'EVEN', 'INVERSE_EXPOSURE'] as const) {
      for (const spared of [null, 'p:a' as PrincipalId, 'p:c' as PrincipalId]) {
        const out = allocate({ constellation: C, subjects, rule, spared, byDefault: false });
        expect(out.lines.reduce((n, l) => n + l.amount, 0), `${rule}/${String(spared)}`).toBe(total);
      }
    }
  });

  it('funds a spared principal out of the others — a redistribution, never a discount', () => {
    const subjects = [subject('p:a'), subject('p:b'), subject('p:c')];
    const total = totalFor(subjects);
    const out = allocate({ constellation: C, subjects, rule: 'EVEN', spared: 'p:b' as PrincipalId, byDefault: false });
    const spared = out.lines.find((l) => l.principal === ('p:b' as PrincipalId));
    expect(spared?.amount).toBe(LEVY_NOMINAL_MINOR);
    expect(spared?.spared).toBe(true);
    // `spared` and `newcomerFloored` are separate columns because "the group chose to
    // relieve you" and "the rules protect you" are two different facts about a principal.
    expect(spared?.newcomerFloored).toBe(false);
    expect(out.total).toBe(total);
    for (const line of out.lines) {
      if (line.principal === ('p:b' as PrincipalId)) continue;
      expect(line.amount).toBeGreaterThan(LEVY_NOMINAL_MINOR);
    }
  });
});

describe('the quorum, and the published default (PROP-LV1, E2E-8)', () => {
  it('needs a majority of the roll, rounded up', () => {
    expect(quorumFor(0)).toBe(0);
    expect(quorumFor(1)).toBe(1);
    expect(quorumFor(2)).toBe(1);
    expect(quorumFor(3)).toBe(2);
    expect(quorumFor(12)).toBe(6);
  });

  it('discards the WHOLE outcome on quorum failure — rule and spare together', () => {
    const counted = tally({
      constellation: C,
      forReckoning: 1,
      // Two ballots naming EVEN and both sparing p:c, in a constellation of twelve.
      ballots: [ballot('p:a', 'EVEN', 'p:c'), ballot('p:b', 'EVEN', 'p:c')],
      eligible: 12,
    });
    expect(counted.reachedQuorum).toBe(false);
    expect(counted.rule).toBe(PUBLISHED_DEFAULT_RULE);
    // Half a decision nobody reached would be worse than none: keeping the spared name
    // from a failed vote would apply the coalition's wish without its mandate.
    expect(counted.spared).toBeNull();
    expect(counted.spareVotes).toBe(0);
  });

  it('E2E-8: the fallback is identical to the published formula computed independently', () => {
    const subjects = [
      subject('p:a', { exposurePeak: 0, freeStores: 250_000 }),
      subject('p:b', { exposurePeak: 40_000, freeStores: 250_000 }),
      subject('p:c', { exposurePeak: 1_500_000, freeStores: 250_000 }),
      newcomer('p:new'),
    ];
    const counted = tally({ constellation: C, forReckoning: 1, ballots: [], eligible: 4 });
    const out = allocate({
      constellation: C,
      subjects,
      rule: counted.rule,
      spared: counted.spared,
      byDefault: !counted.reachedQuorum,
    });

    // ── The second road. Inverse EXPOSURE, by hand, from the published parameters ──
    const pool = subjects.filter((s) => s.principal !== ('p:new' as PrincipalId));
    const remainder = totalFor(subjects) - LEVY_NOMINAL_MINOR;
    const expected = largestRemainder(
      remainder as never,
      pool.map((s) => weightOf('INVERSE_EXPOSURE', s)),
    );
    for (const [i, s] of pool.entries()) {
      expect(out.lines.find((l) => l.principal === s.principal)?.amount).toBe(expected[i]);
    }
    expect(out.lines.find((l) => l.principal === ('p:new' as PrincipalId))?.amount).toBe(LEVY_NOMINAL_MINOR);
    expect(out.byDefault).toBe(true);
  });
});

describe('the tally is a choice, and its tie-breaks are stated', () => {
  it('picks the rule with the most ballots', () => {
    const counted = tally({
      constellation: C,
      forReckoning: 1,
      ballots: [ballot('p:a', 'EVEN'), ballot('p:b', 'EVEN'), ballot('p:c', 'BY_STORES')],
      eligible: 3,
    });
    expect(counted.reachedQuorum).toBe(true);
    expect(counted.rule).toBe('EVEN');
    expect(counted.ruleVotes).toBe(2);
  });

  it('breaks a rule tie toward the PUBLISHED default rather than alphabetically', () => {
    const counted = tally({
      constellation: C,
      forReckoning: 1,
      ballots: [ballot('p:a', 'BY_STORES'), ballot('p:b', 'INVERSE_EXPOSURE')],
      eligible: 2,
    });
    // The constellation did not decide, so the published thing applies. `BY_STORES` would
    // win an alphabetical tie-break, which is why this assertion is worth making.
    expect(counted.rule).toBe(PUBLISHED_DEFAULT_RULE);
  });

  it('needs a coalition to spare anybody: one nomination is not enough', () => {
    expect(LEVY_SPARE_MIN_NOMINATIONS).toBe(2);
    const alone = tally({
      constellation: C,
      forReckoning: 1,
      ballots: [ballot('p:a', 'EVEN', 'p:a'), ballot('p:b', 'EVEN'), ballot('p:c', 'EVEN')],
      eligible: 3,
    });
    // "Spare me" cannot be a free verb, or the vote is an opt-out rather than politics.
    expect(alone.spared).toBeNull();

    const coalition = tally({
      constellation: C,
      forReckoning: 1,
      ballots: [ballot('p:a', 'EVEN', 'p:c'), ballot('p:b', 'EVEN', 'p:c'), ballot('p:c', 'EVEN')],
      eligible: 3,
    });
    expect(coalition.spared).toBe('p:c' as PrincipalId);
    expect(coalition.spareVotes).toBe(2);
  });

  it('names the loser the group\'s choice actually cost, and nobody when it cost nothing', () => {
    const subjects = [subject('p:a'), subject('p:b'), subject('p:c')];
    const voted = allocate({
      constellation: C,
      subjects,
      rule: 'EVEN',
      spared: 'p:c' as PrincipalId,
      byDefault: false,
    });
    const underDefault = allocate({
      constellation: C,
      subjects,
      rule: PUBLISHED_DEFAULT_RULE,
      spared: null,
      byDefault: true,
    });
    const loser = namedLoser(voted, underDefault);
    // §14.4 wants a *named* loser by the group's action. Whoever picked up the most relief.
    expect(loser).not.toBeNull();
    expect(loser?.extra).toBeGreaterThan(0);
    expect([subjects[0]?.principal, subjects[1]?.principal]).toContain(loser?.principal);

    // And when the vote changed nothing, there is no victim to dress up (A12).
    expect(namedLoser(underDefault, underDefault)).toBeNull();
  });

  it('is deterministic: the same ballots in any order tally identically (DET-1)', () => {
    const ballots = [ballot('p:c', 'BY_STORES', 'p:a'), ballot('p:a', 'EVEN', 'p:b'), ballot('p:b', 'EVEN', 'p:a')];
    const forwards = tally({ constellation: C, forReckoning: 1, ballots, eligible: 3 });
    const backwards = tally({ constellation: C, forReckoning: 1, ballots: [...ballots].reverse(), eligible: 3 });
    expect(backwards).toEqual(forwards);
  });
});

describe('PROP-LV2 / E2E-7 — the floor holds against an adversarial vote', () => {
  it('cannot lift a newcomer above the nominal rate under ANY rule or nomination', () => {
    const subjects = [subject('p:a'), subject('p:b'), subject('p:c'), newcomer('p:victim')];
    for (const rule of ['BY_EXPOSURE', 'BY_STORES', 'EVEN', 'INVERSE_EXPOSURE'] as const) {
      // The adversarial coalition's best shot: pick the rule, and spare *themselves* so
      // the relief lands on somebody else. It cannot land on the newcomer.
      for (const spared of ['p:a', 'p:b', 'p:c', 'p:victim'] as const) {
        const out = allocate({
          constellation: C,
          subjects,
          rule,
          spared: spared as PrincipalId,
          byDefault: false,
        });
        const victim = out.lines.find((l) => l.principal === ('p:victim' as PrincipalId));
        expect(victim?.amount, `${rule}/${spared}`).toBe(LEVY_NOMINAL_MINOR);
        expect(victim?.newcomerFloored).toBe(true);
        expect(out.lines.reduce((n, l) => n + l.amount, 0)).toBe(out.total);
      }
    }
  });

  it('cannot even nominate someone outside the constellation, let alone load them', () => {
    // The ballot has no "load this principal" field at all — that asymmetry is the
    // anti-Sybil shape (A15). All a coalition can do is spare, and only inside its roll.
    expect(
      ballotFault({
        rule: 'EVEN',
        spare: 'p:stranger',
        roll: ['p:a', 'p:b'] as PrincipalId[],
        voter: 'p:a' as PrincipalId,
      }),
    ).toContain('your own constellation');
    expect(
      ballotFault({ rule: 'NOPE', spare: null, roll: ['p:a'] as PrincipalId[], voter: 'p:a' as PrincipalId }),
    ).toContain('INVERSE_EXPOSURE');
    expect(
      ballotFault({ rule: 'EVEN', spare: null, roll: ['p:a'] as PrincipalId[], voter: 'p:b' as PrincipalId }),
    ).toContain('roll');
    expect(
      ballotFault({ rule: 'EVEN', spare: 'p:a', roll: ['p:a'] as PrincipalId[], voter: 'p:a' as PrincipalId }),
    ).toBeNull();
  });

  it('BITES: a floor that stopped applying is caught by the same assertion', () => {
    // The mutation: allocate as though the newcomer were an ordinary subject. This is what
    // a future edit that dropped `isNewcomer` from `allocate` would produce, and it is the
    // exact failure §5.2 warns about — "inverse-Exposure weighting hands the minute-60
    // newcomer the *maximum* assessment".
    const subjects = [subject('p:a'), newcomer('p:victim')];
    const unfloored = allocate({
      constellation: C,
      subjects: subjects.map((s) => ({ ...s, tenureTicks: 999_999 })),
      rule: 'INVERSE_EXPOSURE',
      spared: null,
      byDefault: true,
    });
    const victim = unfloored.lines.find((l) => l.principal === ('p:victim' as PrincipalId));
    expect(victim?.amount).toBeGreaterThan(LEVY_NOMINAL_MINOR);
    expect(victim?.newcomerFloored).toBe(false);
  });
});
