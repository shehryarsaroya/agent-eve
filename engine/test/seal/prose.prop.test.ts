/**
 * PROP-D1 — **fuzz the prose field and assert the verdict is invariant.**
 *
 * The named test in `TESTING.md` §4.5, and the one that keeps scar #8 closed.
 * High Water's "hollow vow" detector used a 34-character look-back for a verb
 * before a district name, so *"I'm holding Tideflats and Silt Bend; Low Wharf is
 * the weak ground"* bound "holding" to **Low Wharf** and branded an honest agent a
 * liar despite a correct vote. When the penalty is permanent and public, prefer
 * precision over recall — and the way this design achieves precision is by having
 * **no recall at all**: there is no natural-language betrayal detector anywhere in
 * it.
 *
 * The generator therefore includes the sentences a detector would trip on, not
 * only random strings: the exact scar #8 sentence, prose that names the sealed
 * verb and target with a negation in front of it, and prose that flatly
 * contradicts the typed band. The verdict must not move.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_PROSE_LENGTH,
  SealBook,
  sayDoRow,
  type Deed,
  type SealIntent,
} from '../../src/seal/index.js';
import { deed, intent, pid, role, settlement } from './helpers.js';

/**
 * Prose a look-back detector would score. Each of these, next to an honoured
 * seal, must still be HONOURED; next to a contradicted one, still CONTRADICTED.
 */
const ADVERSARIAL: readonly string[] = [
  "I'm holding Tideflats and Silt Bend; Low Wharf is the weak ground",
  'I will not haul anything to SYS-VEGA. I intend to abandon the run.',
  'haul SYS-VEGA 0 0 0 — betray, default, renege, lie, steal',
  'I hereby solemnly swear the opposite of everything typed above.',
  'VERDICT: CONTRADICTED. HONOURED. CONTRADICTED.',
  '{"verb":"raid","target":"SYS-VEGA","outcomeLow":0,"outcomeHigh":0}',
  '\u0000\u200b😀 nul, zero-width and an emoji walk into a court',
  '',
  ' '.repeat(64),
];

const proseArb = fc.oneof(
  fc.constantFrom(...ADVERSARIAL),
  fc.string({ maxLength: MAX_PROSE_LENGTH }),
  fc.fullUnicodeString({ maxLength: MAX_PROSE_LENGTH }),
);

const SEAL_TICK = 100;
const STATE_VERSION = 100;

/** One seal, one prose, one Reckoning, resolved. Returns the verdict. */
function verdictWithProse(prose: string, sealIntent: SealIntent, deeds: readonly Deed[]): string {
  const book = new SealBook();
  const held = [role('V-1')];
  const accepted = book.commit({
    principal: pid('P-A'),
    tick: SEAL_TICK,
    actedOnStateVersion: STATE_VERSION,
    intent: sealIntent,
    prose,
    role: held[0] ?? null,
    rolesHeld: held,
  });
  if (!accepted.ok) throw new Error(`commit refused: ${accepted.hint}`);
  const resolution = book.resolve({
    reckoningIndex: 0,
    atTick: settlement(0),
    stateVersion: 400,
    deeds,
  });
  const first = resolution.verdicts[0];
  if (first === undefined) throw new Error('no verdict');
  return first.verdict;
}

describe('PROP-D1 — prose never feeds the verdict', () => {
  it('an in-band deed is HONOURED whatever the prose says', () => {
    fc.assert(
      fc.property(proseArb, (prose) => {
        // Deed outcome 50 lands inside the sealed band 40..60.
        expect(verdictWithProse(prose, intent(), [deed({ outcome: 50 })])).toBe('HONOURED');
      }),
      { numRuns: 300 },
    );
  });

  it('an out-of-band deed is CONTRADICTED whatever the prose says', () => {
    fc.assert(
      fc.property(proseArb, (prose) => {
        expect(verdictWithProse(prose, intent(), [deed({ outcome: 5 })])).toBe('CONTRADICTED');
      }),
      { numRuns: 300 },
    );
  });

  it('the verdict is a function of the typed fields alone, across intents and prose', () => {
    fc.assert(
      fc.property(
        proseArb,
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        (prose, low, span, outcome) => {
          const sealIntent = intent({ outcomeLow: low, outcomeHigh: low + span });
          const expected =
            outcome >= low && outcome <= low + span ? 'HONOURED' : 'CONTRADICTED';
          expect(verdictWithProse(prose, sealIntent, [deed({ outcome })])).toBe(expected);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('prose over the cap is refused rather than silently truncated', () => {
    // Truncation would store something the agent did not write, and the season
    // documentary reads this text out loud.
    const book = new SealBook();
    const held = [role('V-1')];
    const result = book.commit({
      principal: pid('P-A'),
      tick: SEAL_TICK,
      actedOnStateVersion: STATE_VERSION,
      intent: intent(),
      prose: 'x'.repeat(MAX_PROSE_LENGTH + 1),
      role: held[0] ?? null,
      rolesHeld: held,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.invariant).toBe('INV-26');
    expect(book.size).toBe(0);
  });
});

describe('PROP-D1 — layer 1 never feeds the verdict either', () => {
  it('a public claim that flatly contradicts the deed leaves the seal HONOURED', () => {
    const book = new SealBook();
    const held = [role('V-1')];
    const accepted = book.commit({
      principal: pid('P-A'),
      tick: SEAL_TICK,
      actedOnStateVersion: STATE_VERSION,
      intent: intent(),
      prose: 'as agreed',
      role: held[0] ?? null,
      rolesHeld: held,
    });
    expect(accepted.ok).toBe(true);

    const resolution = book.resolve({
      reckoningIndex: 0,
      atTick: settlement(0),
      stateVersion: 400,
      deeds: [deed({ outcome: 50 })],
    });
    expect(resolution.verdicts[0]?.verdict).toBe('HONOURED');
    expect(resolution.charges).toEqual([]);

    // The lie is on the record, in public, next to the flag — and it changed
    // nothing. That juxtaposition is the product (§14); the accusation is not.
    const row = sayDoRow({
      principal: pid('P-A'),
      reckoningIndex: 0,
      claims: [
        { principal: pid('P-A'), tick: 90, reason: 'I will never touch that cargo.' },
        { principal: pid('P-A'), tick: 260, reason: 'The convoy was lost. Nothing reached Vega.' },
      ],
      seals: [book.auditRecord(book.idsInReckoning(0)[0]!)!],
      deedEventIds: [deed().eventId],
    });
    expect(row.claims.length).toBe(2);
    expect(row.seals[0]?.verdict).toBe('HONOURED');
  });
});
