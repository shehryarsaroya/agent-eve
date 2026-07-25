/**
 * PROP-D1, the structural half — **seals are structured; prose never feeds the
 * verdict.**
 *
 * The fuzz half is `prose.prop.test.ts`. This file asserts the thing the fuzz
 * cannot see: that there is no *route* by which prose enters the structure a
 * verdict is computed from. Scars #7 and #8 are the reason both halves exist — a
 * 34-character look-back over ordinary prose branded an honest agent a liar, and
 * the penalty in this design is public and permanent.
 */

import { describe, expect, it } from 'vitest';
import { compareIds } from '../../src/ledger/order.js';
import {
  SEAL_INTENT_KEYS,
  SEAL_MEASURES,
  claimFaults,
  inBand,
  intentFaults,
  intentFromCanonical,
  intentToCanonical,
  isDeclaredVerb,
  judge,
  MAX_TARGET_LENGTH,
  PUBLIC_CLAIM_MAX_CHARS,
} from '../../src/seal/index.js';
import { VERB_CLASS } from '../../src/world/index.js';
import { deed, intent, pid } from './helpers.js';

describe('PROP-D1 — the intent is a closed set of typed fields', () => {
  it('has exactly five keys, and the canonical form carries exactly those', () => {
    // A counting test, per PROP-O3's discipline: the budget is enforced by
    // arithmetic, not intentions. Adding a key here adds an input to a permanent
    // public verdict.
    expect([...SEAL_INTENT_KEYS]).toEqual([
      'verb',
      'target',
      'measure',
      'outcomeLow',
      'outcomeHigh',
    ]);
    expect(Object.keys(intentToCanonical(intent())).sort(compareIds)).toEqual([...SEAL_INTENT_KEYS].sort(compareIds));
  });

  it('refuses any key that is not one of the five — this is the prose boundary', () => {
    for (const smuggled of ['prose', 'note', 'justification', 'reason', 'explanation', 'because']) {
      const raw = { ...intentToCanonical(intent()), [smuggled]: 'I fully intend to protect Vega' };
      const read = intentFromCanonical(raw);
      expect(read.intent, `${smuggled} was accepted into the intent`).toBeNull();
      expect(read.faults.join(' ')).toContain('PROP-D1');
    }
  });

  it('round-trips a well-formed intent unchanged', () => {
    const original = intent({ verb: 'trade', measure: 'MINOR', outcomeLow: -50, outcomeHigh: 900 });
    const read = intentFromCanonical(intentToCanonical(original));
    expect(read.faults).toEqual([]);
    expect(read.intent).toEqual(original);
  });

  it('reports a missing key rather than defaulting it', () => {
    for (const key of SEAL_INTENT_KEYS) {
      const raw: Record<string, unknown> = { ...intentToCanonical(intent()) };
      delete raw[key];
      const read = intentFromCanonical(raw);
      expect(read.intent).toBeNull();
      expect(read.faults.join(' ')).toContain(key);
    }
  });

  it('refuses a non-scalar or wrongly-typed field', () => {
    const raw = { ...intentToCanonical(intent()), outcomeLow: '40' };
    expect(intentFromCanonical(raw).intent).toBeNull();
  });
});

describe('PROP-D1 — the verb list has one home', () => {
  it('accepts every verb SPEC §12.2 declares, read from the single home of that list', () => {
    // Not a second copy of §12.2. `VERB_CLASS` is the Commons floor's table and it
    // is cross-checked against the spec by `assertVerbsClassified`; keeping a
    // second list here is scar #1 waiting for a rename.
    const verbs = Object.keys(VERB_CLASS);
    expect(verbs.length).toBeGreaterThan(30);
    for (const verb of verbs) {
      expect(isDeclaredVerb(verb), verb).toBe(true);
      expect(intentFaults(intent({ verb }))).toEqual([]);
    }
  });

  it('refuses an undeclared verb, including the inherited Object names', () => {
    // A bare `VERB_CLASS[verb]` returns a function for these eight, which is
    // neither undefined nor a VerbClass — the hole `src/world/commons.ts` names.
    for (const verb of [
      'betray',
      'constructor',
      'toString',
      'valueOf',
      'hasOwnProperty',
      '__proto__',
      'isPrototypeOf',
      'propertyIsEnumerable',
    ]) {
      expect(isDeclaredVerb(verb), verb).toBe(false);
      expect(intentFaults(intent({ verb })).join(' ')).toContain(verb);
    }
  });

  it('there is deliberately no betrayal verb to seal', () => {
    // A6: no `betray()` verb, no hidden loyalty meter. Asserted here because a
    // seal naming one would be the first place such a verb could appear.
    expect(Object.keys(VERB_CLASS)).not.toContain('betray');
  });
});

describe('PROP-D1 — the band is integers in a named unit', () => {
  it('validates through core/units.ts rather than a second copy of its rules', () => {
    expect(intentFaults(intent({ measure: 'QTY', outcomeLow: -1 })).join(' ')).toContain('Qty');
    expect(intentFaults(intent({ measure: 'BPS', outcomeHigh: 10_001 })).join(' ')).toContain('Bps');
    expect(intentFaults(intent({ measure: 'MINOR', outcomeLow: -900, outcomeHigh: 0 }))).toEqual([]);
  });

  it('refuses a float — no floats in a value path, ever', () => {
    expect(intentFaults(intent({ outcomeLow: 40.5 })).length).toBeGreaterThan(0);
    expect(intentFaults(intent({ outcomeHigh: Number.NaN })).length).toBeGreaterThan(0);
  });

  it('refuses an inverted band, which would be contradicted by construction', () => {
    expect(intentFaults(intent({ outcomeLow: 60, outcomeHigh: 40 })).join(' ')).toContain(
      'below outcomeLow',
    );
  });

  it('refuses an unknown measure and lists the three that exist', () => {
    expect([...SEAL_MEASURES]).toEqual(['MINOR', 'QTY', 'BPS']);
    // A cast is the only way to reach this at runtime; an HTTP body is exactly
    // that, so the check has to exist.
    const bad = { ...intent(), measure: 'TONNES' } as unknown as ReturnType<typeof intent>;
    expect(intentFaults(bad).join(' ')).toContain('measure must be one of');
  });

  it('the band is inclusive at both ends', () => {
    const i = intent({ outcomeLow: 40, outcomeHigh: 60 });
    expect(inBand(i, 40)).toBe(true);
    expect(inBand(i, 60)).toBe(true);
    expect(inBand(i, 39)).toBe(false);
    expect(inBand(i, 61)).toBe(false);
  });

  it('bounds the target, because an unbounded string in a stored row is scar #3', () => {
    expect(intentFaults(intent({ target: 'x'.repeat(MAX_TARGET_LENGTH) }))).toEqual([]);
    expect(intentFaults(intent({ target: 'x'.repeat(MAX_TARGET_LENGTH + 1) })).length).toBe(1);
    expect(intentFaults(intent({ target: '' })).length).toBe(1);
  });
});

describe('PROP-D1 — the verdict function cannot see prose', () => {
  it('takes an intent, deeds and a tick, and has no parameter prose could arrive in', () => {
    // A signature assertion is a blunt instrument, and it is the right one here:
    // the guarantee is *structural*, and the way it breaks is somebody adding a
    // fourth parameter. `Function.length` counts declared parameters.
    expect(judge.length).toBe(3);
  });

  it('judges from the intent alone: two seals with identical intents judge identically', () => {
    const deeds = [deed({ outcome: 50 })];
    const a = judge(
      {
        principal: pid('P-A'),
        reckoningIndex: 0,
        sealedAtTick: 100,
        actedOnStateVersion: 100,
        intent: intent(),
        deedSetWitnessed: true,
        targetWitnessed: true,
      },
      deeds,
      287,
    );
    const b = judge(
      {
        principal: pid('P-A'),
        reckoningIndex: 0,
        sealedAtTick: 100,
        actedOnStateVersion: 100,
        intent: { ...intent() },
        deedSetWitnessed: true,
        targetWitnessed: true,
      },
      deeds,
      287,
    );
    expect(a).toEqual(b);
  });
});

describe('layer 1 — the public claim is capped at 140 characters and may lie', () => {
  it('accepts exactly 140 and refuses 141', () => {
    expect(PUBLIC_CLAIM_MAX_CHARS).toBe(140);
    const at = { principal: pid('P-A'), tick: 5, reason: 'x'.repeat(140) };
    expect(claimFaults(at)).toEqual([]);
    expect(claimFaults({ ...at, reason: 'x'.repeat(141) }).length).toBe(1);
    expect(claimFaults({ ...at, reason: '' }).length).toBe(1);
  });

  it('never validates truthfulness — a claim is a claim', () => {
    // There is no honesty check to write. This test exists to say so: the only
    // thing checked is the cap, because judging the text is scar #8.
    const lie = {
      principal: pid('P-A'),
      tick: 5,
      reason: 'The escort departs at the gate and I will not touch the cargo.',
    };
    expect(claimFaults(lie)).toEqual([]);
  });
});
