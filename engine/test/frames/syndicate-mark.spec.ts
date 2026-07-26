/**
 * A13 for syndicates. Hard rule 3: no named pixel signature, not ready.
 *
 * A claim tints a system and a WORKS marks one. A syndicate has no *place* — it is an authority
 * structure — so its signature is the **shape of the authority**: how many pooled in, what the
 * constitution permits, and **how many people could empty the treasury today without breaking a
 * rule.** That last number is the whole of A6 stated as one integer, which is why the frame orders
 * by it rather than by size: the story is the treasury closest to being taken, not the richest org.
 *
 * The §11.2 line is drawn at `treasuryMinor`, and it is in on §6.4's precedent — bond is *"posted
 * slashable capital, public, and any amount — it is your credit rating"*, and a pooled treasury is
 * that same object at org scale. What stays out is any MEMBER's own stores, which pooling does not
 * publish.
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import {
  assertFrameBudgets,
  MAX_FRAME_SYNDICATE_LINES,
  type ReckoningFrame,
  type SyndicateLine,
} from '../../src/frames/contract.js';
import { emptyFrame } from '../../src/frames/render.js';

function line(over: Partial<SyndicateLine> = {}): SyndicateLine {
  return {
    syndicate: 'syn:p:chair:10',
    name: 'The Long Haul',
    founder: 'p:chair' as PrincipalId,
    members: 4,
    admission: 'INVITE',
    decision: 'FOUNDER',
    treasuryOffices: true,
    treasuryMinor: minor(180_000),
    officeHolders: 1,
    legend: '4 POOLED · 1 CAN SPEND',
    ...over,
  };
}

function refusal(lines: readonly SyndicateLine[]): string {
  const frame: ReckoningFrame = { ...emptyFrame(0, 0, 'hash'), syndicateLines: lines };
  try {
    assertFrameBudgets(frame);
    return '';
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('the signature is the shape of the authority', () => {
  it('draws a coherent line', () => {
    expect(refusal([line()])).toBe('');
  });

  it('draws a strongbox, which is the other legible state', () => {
    expect(
      refusal([
        line({ treasuryOffices: false, officeHolders: 0, legend: 'STRONGBOX · 4 POOLED' }),
      ]),
    ).toBe('');
  });
});

describe('a line may not contradict the constitution it reports', () => {
  it('refuses office-holders over a pool the charter forbids offices on', () => {
    // The charter clause every member relied on. A frame that showed a spender on a strongbox would
    // be publishing that the constitution failed, with no second source for a stranger to check.
    expect(refusal([line({ treasuryOffices: false, legend: 'STRONGBOX · 4 POOLED' })])).toMatch(
      /no office may exist over that pool/,
    );
  });

  it('refuses a strongbox that does not say STRONGBOX', () => {
    expect(
      refusal([line({ treasuryOffices: false, officeHolders: 0, legend: '4 POOLED · 0 CAN SPEND' })]),
    ).toMatch(/does not say STRONGBOX/);
  });

  it('refuses a syndicate with no members — it always holds its founder', () => {
    expect(refusal([line({ members: 0 })])).toMatch(/always holds its founder/);
  });

  it('refuses negative quantities', () => {
    expect(refusal([line({ treasuryMinor: minor(-1) })])).toMatch(/negative/);
  });

  it('keeps the legend a legend rather than a directory', () => {
    const many = Array.from({ length: MAX_FRAME_SYNDICATE_LINES + 3 }, (_, i) =>
      line({ syndicate: `syn:p:c${String(i)}:10` }),
    );
    expect(refusal(many)).toMatch(/budget is/);
  });
});

describe("a member's own stores stay SENSED, pooling or not", () => {
  it.each(['memberStockQty', 'memberHoldings', 'holdingsHere', 'reserveMinor', 'coverBps'])(
    'refuses a line carrying %s',
    (key) => {
      const smuggled: SyndicateLine = { ...line(), [key]: 1 };
      expect(refusal([smuggled]), `${key} must be refused`).toMatch(/SENSED|pooling does not publish/);
    },
  );

  it('still admits the pooled treasury itself, on §6.4 precedent', () => {
    // The distinction: currency every member deliberately pooled into a named account, minted by
    // PUBLIC events, is the org's credit rating. What a member privately holds is not.
    expect(refusal([line({ treasuryMinor: minor(9_999_999) })])).toBe('');
  });
});
