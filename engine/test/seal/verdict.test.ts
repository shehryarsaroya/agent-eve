/**
 * The verdict: deterministic, timestamped, and computed against the state the
 * agent acted on.
 *
 * Three separate design claims are under test here, and each has a scar behind it:
 *
 * - **the timestamp** — a contradiction is provable against a timestamp, never
 *   inferred from behaviour (§11.1). A seal written *after* a matching deed does
 *   not get to claim it, which is what stops an externally-run agent performing for
 *   the reveal;
 * - **the window** — a seal is evaluated only against its own Reckoning (scar #7);
 * - **the state version** — resolve from the same state the agents acted on (scar
 *   #6, which made a "mandatory" event not happen ~35% of the time).
 *
 * Plus the one that matters most for A5′: when the engine and the seal disagree
 * about *units or state version*, the tick **halts** rather than publishing
 * CONTRADICTED. A halt is recoverable; a permanent false public mark is not.
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import { SealHalt, judge, type Deed, type VerdictInputs } from '../../src/seal/index.js';
import { deed, eid, intent, pid } from './helpers.js';

const AT_TICK = 287;

function inputs(over: Partial<VerdictInputs> = {}): VerdictInputs {
  return {
    principal: pid('P-A'),
    reckoningIndex: 0,
    sealedAtTick: 100,
    actedOnStateVersion: 100,
    intent: intent(),
    ...over,
  };
}

describe('the verdict, from typed fields', () => {
  it('HONOURED when an attributable deed lands in the band', () => {
    const j = judge(inputs(), [deed({ outcome: 50 })], AT_TICK);
    expect(j.verdict).toBe('HONOURED');
    expect(j.basis).toBe('IN_BAND');
    expect(j.citedDeedEventId).toBe('ev:150:0');
  });

  it('CONTRADICTED, citing the deed, when the deed misses the band', () => {
    const j = judge(inputs(), [deed({ outcome: 5 })], AT_TICK);
    expect(j.verdict).toBe('CONTRADICTED');
    expect(j.basis).toBe('OUT_OF_BAND');
    expect(j.citedDeedEventId).toBe('ev:150:0');
  });

  it('CONTRADICTED with nothing to cite when the sealed act never happened', () => {
    // The abstention case §11.2 names: "did you honour the abstention you
    // promised". There is no third verdict — `SealVerdict` is two values — so a
    // sealed intention with no matching deed is contradicted, and the attributable
    // cause is the closing of the Reckoning itself.
    const j = judge(inputs(), [], AT_TICK);
    expect(j.verdict).toBe('CONTRADICTED');
    expect(j.basis).toBe('NO_ATTRIBUTABLE_DEED');
    expect(j.citedDeedEventId).toBeNull();
    expect(j.attributableCount).toBe(0);
  });

  it('any in-band deed honours the seal — precision over recall (scar #8)', () => {
    // Deed 1 misses, deed 2 lands. An agent that did what it said, once, kept its
    // word; "the first deed must be in band" would manufacture contradictions.
    const j = judge(
      inputs(),
      [
        deed({ tick: 120, outcome: 5, eventId: eid('ev:120:0') }),
        deed({ tick: 150, outcome: 50, eventId: eid('ev:150:0') }),
      ],
      AT_TICK,
    );
    expect(j.verdict).toBe('HONOURED');
    expect(j.citedDeedEventId).toBe('ev:150:0');
    expect(j.attributableCount).toBe(2);
  });
});

describe('attribution — the timestamp', () => {
  it('a deed at or before the seal does not honour it', () => {
    // Sealing after the fact is not a pre-commitment. This is the rule that makes
    // "an externally-run agent cannot perform for it" true.
    for (const tick of [99, 100]) {
      const j = judge(
        inputs({ sealedAtTick: 100 }),
        [deed({ tick, outcome: 50, eventId: eid(`ev:${String(tick)}:0`) })],
        AT_TICK,
      );
      expect(j.verdict, `deed at ${tick}`).toBe('CONTRADICTED');
      expect(j.basis).toBe('NO_ATTRIBUTABLE_DEED');
    }
    // One tick later, the same deed honours it.
    expect(judge(inputs({ sealedAtTick: 100 }), [deed({ tick: 101, outcome: 50 })], AT_TICK).verdict).toBe(
      'HONOURED',
    );
  });
});

describe('attribution — the window (scar #7)', () => {
  it('ignores a deed from another Reckoning entirely', () => {
    const nextReckoningDeed = deed({
      tick: TICKS_PER_RECKONING + 10,
      outcome: 50,
      eventId: eid('ev:298:0'),
    });
    const j = judge(inputs(), [nextReckoningDeed], AT_TICK);
    expect(j.verdict).toBe('CONTRADICTED');
    expect(j.basis).toBe('NO_ATTRIBUTABLE_DEED');

    // And the mirror: a seal in Reckoning 1 is not honoured by Reckoning 0's deed.
    const j2 = judge(
      inputs({ reckoningIndex: 1, sealedAtTick: TICKS_PER_RECKONING + 5 }),
      [deed({ tick: 150, outcome: 50 })],
      TICKS_PER_RECKONING * 2 - 1,
    );
    expect(j2.basis).toBe('NO_ATTRIBUTABLE_DEED');
  });
});

describe('attribution — the act named', () => {
  it('a different verb or a different target is not the sealed act', () => {
    expect(judge(inputs(), [deed({ verb: 'trade', outcome: 50 })], AT_TICK).basis).toBe(
      'NO_ATTRIBUTABLE_DEED',
    );
    expect(judge(inputs(), [deed({ target: 'SYS-OTHER', outcome: 50 })], AT_TICK).basis).toBe(
      'NO_ATTRIBUTABLE_DEED',
    );
  });
});

describe('A5-prime — a measurement disagreement halts instead of libelling', () => {
  it('halts when a matching deed is measured in another unit', () => {
    // Comparing a band of 50 minor units against 50 whole goods is scar #1 with
    // money. Publishing CONTRADICTED off that comparison would mark an agent that
    // did exactly what it said.
    expect(() => judge(inputs(), [deed({ measure: 'MINOR', outcome: 50 })], AT_TICK)).toThrow(
      SealHalt,
    );
    try {
      judge(inputs(), [deed({ measure: 'MINOR', outcome: 50 })], AT_TICK);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(SealHalt);
      if (err instanceof SealHalt) {
        expect(err.violations[0]?.severity).toBe('HALT');
        expect(err.message).toContain('refusing to contradict');
      }
    }
  });

  it('halts when a matching deed was valued against a state older than the seal', () => {
    expect(() =>
      judge(inputs({ actedOnStateVersion: 100 }), [deed({ valuedAtStateVersion: 99 })], AT_TICK),
    ).toThrow(SealHalt);
  });

  it('does NOT halt when a good deed also exists — the seal is simply honoured', () => {
    // The halt exists to avoid a false contradiction, not to punish a stray row.
    const j = judge(
      inputs(),
      [
        deed({ tick: 120, measure: 'MINOR', outcome: 50, eventId: eid('ev:120:0') }),
        deed({ tick: 150, outcome: 50, eventId: eid('ev:150:0') }),
      ],
      AT_TICK,
    );
    expect(j.verdict).toBe('HONOURED');
  });

  it('halts on a deed belonging to another principal', () => {
    expect(() => judge(inputs(), [deed({ principal: pid('P-B'), outcome: 50 })], AT_TICK)).toThrow(
      SealHalt,
    );
  });

  it('halts on a malformed deed rather than judging from it', () => {
    for (const bad of [
      deed({ outcome: 1.5 }),
      deed({ tick: -1 }),
      deed({ valuedAtStateVersion: -1 }),
      deed({ verb: 'betray' }),
      deed({ target: '' }),
    ]) {
      expect(() => judge(inputs(), [bad], AT_TICK)).toThrow(SealHalt);
    }
  });
});

describe('DET-2 — the judgement is independent of the caller’s argument order', () => {
  it('all 24 permutations of four deeds give an identical judgement', () => {
    const deeds: Deed[] = [
      deed({ tick: 110, outcome: 5, eventId: eid('ev:110:0') }),
      deed({ tick: 120, outcome: 50, eventId: eid('ev:120:0') }),
      deed({ tick: 130, outcome: 55, eventId: eid('ev:130:0') }),
      deed({ tick: 140, verb: 'trade', outcome: 7, eventId: eid('ev:140:0') }),
    ];
    const expected = judge(inputs(), deeds, AT_TICK);
    expect(expected.verdict).toBe('HONOURED');
    expect(expected.citedDeedEventId).toBe('ev:120:0');

    for (const order of permutations([0, 1, 2, 3])) {
      const shuffled = order.map((i) => deeds[i]!);
      expect(judge(inputs(), shuffled, AT_TICK)).toEqual(expected);
    }
  });
});

function permutations(xs: readonly number[]): number[][] {
  if (xs.length <= 1) return [[...xs]];
  const out: number[][] = [];
  for (const [i, x] of xs.entries()) {
    const rest = [...xs.slice(0, i), ...xs.slice(i + 1)];
    for (const p of permutations(rest)) out.push([x, ...p]);
  }
  return out;
}
