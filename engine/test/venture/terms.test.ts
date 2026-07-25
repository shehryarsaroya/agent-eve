/**
 * PROP-V2, PROP-V5, and `terms_hash`.
 *
 * `PROP-V2` `wage` and `share` are never both set. *(Scar #1 with money: one
 * polymorphic field carrying a senior fixed claim and a junior residual claim, in a
 * system that would then record a broken promise as honoured.)*
 *
 * `PROP-V5` `elective >= f(kind)` is enforced at creation; top kinds are
 * un-escrowable. *(Left free, agents set it to zero, escrow strictly dominates for
 * the buyer, and A7 is dead letter.)*
 */

import { describe, expect, it } from 'vitest';
import { BPS_ONE, bps, minor } from '../../src/core/units.js';
import { canonicalize } from '../../src/core/canonical.js';
import { DEFAULT_VALUATION_RULE } from '../../src/ledger/index.js';
import {
  SHARE_PRIORITY,
  WAGE_PRIORITY,
  createVenture,
  electiveFloor,
  escrowRatioBps,
  isShareRole,
  isWageRole,
  pinnedAt,
  pinnedConsideration,
  roleTerms,
  seniorityOf,
  shareTerms,
  termsCanonical,
  termsHash,
  topYieldKinds,
  validateRoleTerms,
  wageTerms,
  type TermsHashInput,
} from '../../src/venture/index.js';
import { RULES_VERSION, fixture, share, vid, wage } from './fixture.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';

describe('PROP-V2 — wage and share are never both set, and never both null', () => {
  it('refuses both set', () => {
    const both = roleTerms({
      wage: minor(2_000),
      share: bps(3_000),
      escrowed: minor(1_000),
      elective: minor(1_000),
    });
    const result = validateRoleTerms('HAUL', both);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.invariant).toBe('PROP-V2');
    // The hint has to name *why*, not just refuse: the agent's mental model is the
    // thing under repair (scar #1).
    expect(result.hint).toContain('senior');
    expect(result.hint).toContain('residual');
  });

  it('refuses both null — the half that is easy to forget', () => {
    // A role owed nothing settles silently and the receipt says the promise was kept,
    // which is the §7.1 failure with no field to blame.
    const neither = roleTerms({ escrowed: minor(1_000), elective: minor(1_000) });
    const result = validateRoleTerms('HAUL', neither);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.invariant).toBe('PROP-V2');
  });

  it('requires a wage to equal escrowed + elective, so two shown numbers cannot disagree', () => {
    const lying = roleTerms({ wage: minor(1_800), share: null, escrowed: minor(1_000), elective: minor(1_000) });
    const result = validateRoleTerms('HAUL', lying);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.invariant).toBe('PROP-V2');

    expect(validateRoleTerms('HAUL', wageTerms(minor(1_000), minor(1_000))).ok).toBe(true);
  });

  it('refuses a non-positive wage, a non-positive share, and a share over 100%', () => {
    expect(validateRoleTerms('HAUL', roleTerms({ wage: minor(0), escrowed: minor(0), elective: minor(0) })).ok).toBe(false);
    expect(validateRoleTerms('HAUL', shareTerms(bps(0), minor(500), minor(700))).ok).toBe(false);
    // `bps()` already refuses over 10_000, so the guard inside validate is defence in
    // depth against a caller that cast.
    expect(
      validateRoleTerms('HAUL', { wage: null, share: (BPS_ONE + 1) as never, escrowed: minor(0), elective: minor(1_200) }).ok,
    ).toBe(false);
  });

  it('refuses negative escrowed or elective', () => {
    expect(
      validateRoleTerms('HAUL', roleTerms({ wage: minor(500), escrowed: minor(-500), elective: minor(1_000) })).ok,
    ).toBe(false);
  });

  it('reports seniority from the field that is set — a wage before a share', () => {
    const w = wageTerms(minor(1_000), minor(1_000));
    const s = shareTerms(bps(3_000), minor(500), minor(700));
    expect(isWageRole(w)).toBe(true);
    expect(isShareRole(w)).toBe(false);
    expect(seniorityOf(w)).toBe(WAGE_PRIORITY);
    expect(seniorityOf(s)).toBe(SHARE_PRIORITY);
    expect(WAGE_PRIORITY).toBeLessThan(SHARE_PRIORITY);
  });

  it('rejects a venture whose roles allot more than 10000 bps of residual', () => {
    const f = fixture();
    const result = createVenture({
      id: vid('v-overshare'),
      kind: 'HAUL',
      creator: 'p-alice' as PrincipalId,
      stage: f.stage,
      terms: [share(bps(6_000), 500, 700), share(bps(5_000), 500, 700)],
      windowOpensTick: 0,
      windowClosesTick: 10,
      resolvesAtTick: 20,
      valuation: f.valuation,
      rulesVersion: RULES_VERSION,
      preference: [],
      visibility: 'PUBLIC',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.invariant).toBe('INV-6');
  });
});

describe('PROP-V5 — the elective floor is enforced at creation', () => {
  it('refuses elective below f(kind)', () => {
    // A HAUL role priced at 2000 needs elective >= 500 (2500 bps). 499 is refused.
    const total = 2_000;
    expect(electiveFloor('HAUL', minor(total))).toBe(500);
    const thin = shareTerms(bps(3_000), minor(total - 499), minor(499));
    const result = validateRoleTerms('HAUL', thin);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.invariant).toBe('PROP-V5');

    expect(validateRoleTerms('HAUL', shareTerms(bps(3_000), minor(1_500), minor(500))).ok).toBe(true);
  });

  it('refuses a zero elective part outright — the case the floor exists for', () => {
    // §7.5: left free, agents set it to zero because escrow strictly dominates for the
    // buyer of any promise, "and then no trust is ever risked, A7 is dead letter, and
    // standing has nothing to accrue to".
    const fullyEscrowed = shareTerms(bps(3_000), minor(2_000), minor(0));
    const result = validateRoleTerms('HAUL', fullyEscrowed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.invariant).toBe('PROP-V5');
  });

  it('makes top-yield kinds un-escrowable', () => {
    for (const kind of topYieldKinds()) {
      const escrowedAtAll = shareTerms(bps(2_000), minor(1), minor(49_999));
      const result = validateRoleTerms(kind, escrowedAtAll);
      expect(result.ok, kind).toBe(false);
      if (!result.ok) expect(result.invariant).toBe('PROP-V5');

      // Fully elective is the only legal shape.
      expect(validateRoleTerms(kind, shareTerms(bps(2_000), minor(0), minor(50_000))).ok, kind).toBe(true);
    }
  });

  it('rejects a whole venture when one role is under the floor, naming the role', () => {
    const f = fixture();
    const result = createVenture({
      id: vid('v-thin'),
      kind: 'HAUL',
      creator: 'p-alice' as PrincipalId,
      stage: f.stage,
      terms: [wage(1_000, 1_000), share(bps(3_000), 2_000, 1)],
      windowOpensTick: 0,
      windowClosesTick: 10,
      resolvesAtTick: 20,
      valuation: f.valuation,
      rulesVersion: RULES_VERSION,
      preference: [],
      visibility: 'PUBLIC',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invariant).toBe('PROP-V5');
      expect(result.hint).toContain('role 1');
      expect(result.hint).toContain('ESCORT');
    }
  });

  it('publishes the escrow ratio, which §7.5 requires on the card', () => {
    // "An A7 'explicitly priced unsecured tail' that is not displayed is not priced;
    // it is hidden, which is the parser deceit the economic laws forbid."
    expect(escrowRatioBps(shareTerms(bps(3_000), minor(750), minor(250)))).toBe(7_500);
    expect(escrowRatioBps(shareTerms(bps(3_000), minor(0), minor(1_000)))).toBe(0);
    expect(pinnedConsideration(shareTerms(bps(3_000), minor(750), minor(250)))).toBe(1_000);
  });
});

// ── terms_hash ───────────────────────────────────────────────────────────────

function hashInput(overrides: Partial<TermsHashInput> = {}): TermsHashInput {
  return {
    venture: vid('v-hash'),
    kind: 'HAUL',
    creator: 'p-alice' as PrincipalId,
    stage: 'sys-1' as SystemId,
    roles: [
      { index: 0, label: 'CARRIER', terms: wageTerms(minor(1_000), minor(1_000)) },
      { index: 1, label: 'ESCORT', terms: shareTerms(bps(3_000), minor(500), minor(700)) },
    ],
    windowOpensTick: 0,
    windowClosesTick: 100,
    resolvesAtTick: 200,
    valuation: pinnedAt(DEFAULT_VALUATION_RULE, 42),
    rulesVersion: RULES_VERSION,
    ...overrides,
  };
}

describe('terms_hash (PROP-W1, §15.4)', () => {
  it('is stable across key order and role order', () => {
    // Otherwise agents see random mismatches and correctly read them as a
    // counterparty reneging — the engine fabricating a betrayal.
    const a = hashInput();
    const b = hashInput({ roles: [...hashInput().roles].reverse() });
    expect(termsHash(b)).toBe(termsHash(a));
  });

  it('contains no float, because canonicalize throws on one', () => {
    expect(() => canonicalize(termsCanonical(hashInput()))).not.toThrow();
  });

  it('changes when the valuation rule changes', () => {
    // §15.4: terms_hash pins the valuation rule. Without this clause the haircut or
    // the window width could change under a live compact.
    const base = termsHash(hashInput());
    const wider = termsHash(
      hashInput({
        valuation: pinnedAt({ ...DEFAULT_VALUATION_RULE, windowTicks: 96 }, 42),
      }),
    );
    const harsher = termsHash(
      hashInput({
        valuation: pinnedAt({ ...DEFAULT_VALUATION_RULE, haircutBps: bps(4_000) }, 42),
      }),
    );
    expect(wider).not.toBe(base);
    expect(harsher).not.toBe(base);
  });

  it('changes when the valuation as-of tick changes (E2E-14)', () => {
    // Pinning the rule without the tick still lets the rule be re-evaluated against a
    // later window, which is exactly the price move E2E-14 constructs.
    const base = termsHash(hashInput());
    const later = termsHash(hashInput({ valuation: pinnedAt(DEFAULT_VALUATION_RULE, 43) }));
    expect(later).not.toBe(base);
  });

  it('changes when any role term changes', () => {
    const base = termsHash(hashInput());
    const roles = hashInput().roles;
    const first = roles[0];
    const second = roles[1];
    if (first === undefined || second === undefined) throw new Error('fixture');
    const moved = termsHash(
      hashInput({
        roles: [{ ...first, terms: wageTerms(minor(1_100), minor(900)) }, second],
      }),
    );
    expect(moved).not.toBe(base);
  });

  it('changes when rulesVersion changes (INV-15)', () => {
    expect(termsHash(hashInput({ rulesVersion: 2 }))).not.toBe(termsHash(hashInput()));
  });

  it('distinguishes a wage of N from a share whose pinned value is N', () => {
    // The §7.1 failure, at the hash: if these collided, a signer could countersign a
    // wage and settle against a share with the same hash on both sides.
    const asWage = termsHash(
      hashInput({ roles: [{ index: 0, label: 'CARRIER', terms: wageTerms(minor(600), minor(400)) }] }),
    );
    const asShare = termsHash(
      hashInput({
        roles: [{ index: 0, label: 'CARRIER', terms: shareTerms(bps(3_000), minor(600), minor(400)) }],
      }),
    );
    expect(asShare).not.toBe(asWage);
  });

  it('writes null explicitly, so absent and null cannot be confused', () => {
    const text = canonicalize(termsCanonical(hashInput()));
    expect(text).toContain('"share":null');
    expect(text).toContain('"wage":null');
  });
});
