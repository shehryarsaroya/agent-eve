/**
 * D12: standing is farmable with free identities, and the code says it is not.
 *
 * `core/types.ts` calls `distinctCounterparties` *"Count of distinct **independently-capitalised**
 * counterparties. **The anti-farm term.**"* — two load-bearing names for a defence. The accrual in
 * `reckoning/standing.ts` is `distinctCounterparties + (isNew ? 1 : 0)` and checks **nothing** about
 * independence; the only thing excluded anywhere is self-dealing.
 *
 * The loop, and each mechanic in it is individually correct: filling a role is free (the stake
 * defaults to 0), enrolment is free and must stay free (A15), and the elective half is paid at
 * settlement rather than by a verb — so D7's `freeCash` withholding, which guards the market BID, the
 * cession price and a syndicate stake, does not reach it. An operator pays its own puppet, gains
 * standing, and the money comes back as *earned* capital.
 *
 * These tests **document the hole rather than assert it closed**, deliberately. The fix changes
 * standing accrual — past-tick computation — so it needs a `RULES_VERSION` bump and the operator
 * divergence door on a live world at ~4,500 ticks, and `D12` names three decisions to settle first.
 * Shipping it carelessly would be the A5′ failure the document is about.
 *
 * If somebody closes it, the second test goes red and should be rewritten to assert the new rule.
 * That is the point: a known hole with a failing-on-fix test is a hole nobody forgets.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const RUNTIME = readFileSync(new URL('../../src/sim/runtime.ts', import.meta.url), 'utf8');
const TYPES = readFileSync(new URL('../../src/core/types.ts', import.meta.url), 'utf8');
const STANDING = readFileSync(new URL('../../src/reckoning/standing.ts', import.meta.url), 'utf8');

describe('D12 — the mechanics that line up, each correct alone', () => {
  it('filling a role is FREE: the stake defaults to zero', () => {
    // The mechanic that makes a puppet usable at all. A principal with no capital can take a role,
    // because naming no stake takes no stake — and `lockRoleStake` returns early on `stake <= 0`.
    expect(RUNTIME, 'the fill request defaults the stake').toContain(
      "stake: minor(readInt(req.params, ['stake', 'stake_minor']) ?? 0)",
    );
  });

  it('the anti-farm NAME is on the field and the accrual does not implement it', () => {
    // Read as source, because the claim and the code live in different files and the gap between
    // them IS the finding. A behavioural test would have to build a whole farm to show the same thing.
    expect(TYPES, 'the field claims a defence').toMatch(/independently-capitalised counterparties/);
    expect(TYPES, 'and names itself the anti-farm term').toMatch(/anti-farm term/);
    expect(STANDING).toContain('distinctCounterparties: row.distinctCounterparties + (isNew ? 1 : 0)');

    const accrual = STANDING.slice(
      STANDING.indexOf('const isNew = !seen.has(delta.counterparty)'),
      STANDING.indexOf('distinctCounterparties: row.distinctCounterparties'),
    );
    expect(accrual.length, 'the accrual block must be found, or this test proves nothing').toBeGreaterThan(20);
    expect(
      /capital|freeCash|independent|third|other than/i.test(accrual),
      'D12: when this becomes true the hole is closed — rewrite this test to assert the new rule ' +
        'rather than the absence of one',
    ).toBe(false);
  });

  it('leaves electiveHonoured alone, because it counts something that really happened', () => {
    // The operator really did pay. Rewriting that would be the record lying in the other direction.
    // Only the diversity term claims something about WHOM the promises were to, and only that claim
    // is false — so it is the only field the fix should touch.
    expect(TYPES).toMatch(/electiveHonoured/);
    expect(STANDING).toContain('electiveHonoured: row.electiveHonoured + delta.electiveHonoured');
  });
});
