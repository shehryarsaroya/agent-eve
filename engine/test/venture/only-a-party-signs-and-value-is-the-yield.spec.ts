/**
 * ★ **TWO DOORS A BLIND PLAYTEST FOUND OPEN ON THE MERGED SEASON 1 TREE** (`RULES_VERSION` 41).
 *
 * ══════════════════════════════════════════════════════════════════════════
 *   1. **Only a party countersigns.** `sign` never asked whether the signer was one of the venture's
 *      signatories. A stranger's signature bound nothing — `isFullyCountersigned` asks for the parties
 *      by name — but it was written into the public `countersigned` list, and a filler whose fill had
 *      lost the slot was told its echo mismatched "the server's (0)" instead of that it was not a party.
 *   2. **`value` is the kind's yield.** A role's escrowed and elective halves were priced off the
 *      creator's `value`, while every role is paid a share of the kind's yield. So `value: 1` escrowed
 *      nothing, and a creator that then elected nothing kept the whole yield while its fillers were paid
 *      0 (measured: 12,273 kept, 0 and 0 paid) — the escrow floor A7 promises, defeated by one number.
 *      A `value` other than the yield is now refused, naming the yield; the house cast never sends one.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { kindSpec, openIndices } from '../../src/venture/index.js';
import { act, contactWorld, idleOf, submit, tick } from '../say/contact-fixture.js';

const PAYER = 'p:vpayer' as PrincipalId;
const FILLER = 'p:vfiller' as PrincipalId;
const STRANGER = 'p:vstranger' as PrincipalId;
const HAUL_YIELD = kindSpec('HAUL').baseYieldMinor;

describe('★ 1. only a party countersigns', () => {
  it("refuses a stranger's signature with the reason, and keeps it off the public list", () => {
    const w = contactWorld('only-a-party-signs', [PAYER, FILLER, STRANGER]);
    const { runtime, stage } = w;
    submit(runtime, PAYER, 'create', { kind: 'HAUL', stage });
    tick(runtime);
    const made = runtime.ventures.all().find((v) => v.creator === PAYER && v.state === 'FORMING');
    if (made === undefined) throw new Error('create did not mint a FORMING HAUL');
    submit(runtime, PAYER, 'fill_role', { venture: made.id, role: 0, hand: idleOf(runtime, PAYER) });
    tick(runtime);
    submit(runtime, FILLER, 'fill_role', { venture: made.id, role: 1, hand: idleOf(runtime, FILLER) });
    tick(runtime);
    const hash = runtime.ventures.require(made.id).termsHash;
    if (hash === null) throw new Error('no terms_hash after both roles filled');

    const refusal = act(runtime, STRANGER, 'sign', { venture: made.id, terms_hash: hash });
    expect(refusal?.invariant, 'MUTATION: drop the party check in countersign and this is accepted').toBe('PROP-W1');
    expect(refusal?.hint).toMatch(/not a party/);
    expect(refusal?.hint, 'not the old echo sentence').not.toMatch(/does not match the server's/);
    expect(runtime.ventures.require(made.id).countersigned.has(STRANGER)).toBe(false);

    submit(runtime, PAYER, 'sign', { venture: made.id, terms_hash: hash }, 0);
    submit(runtime, FILLER, 'sign', { venture: made.id, terms_hash: hash }, 1);
    tick(runtime);
    tick(runtime);
    expect(runtime.ventures.require(made.id).state, 'the parties still bind it').toBe('LIVE');
  });
});

describe('★ 2. `value` is the kind\'s yield, not a free parameter', () => {
  it('refuses the exploit — `value: 1` — and a fictitious high value, naming the yield', () => {
    const w = contactWorld('value-is-the-yield', [PAYER]);
    for (const value of [1, HAUL_YIELD * 2]) {
      const refusal = act(w.runtime, PAYER, 'create', { kind: 'HAUL', stage: w.stage, value });
      expect(refusal?.invariant, `value ${String(value)}`).toBe('PROP-V5');
      expect(refusal?.hint).toContain(String(HAUL_YIELD));
    }
    expect(w.runtime.ventures.all().filter((v) => v.creator === PAYER), 'nothing was created').toHaveLength(0);
  });

  it('accepts the yield itself, or no value at all, and prices every role from it', () => {
    const w = contactWorld('value-is-the-yield-ok', [PAYER]);
    expect(act(w.runtime, PAYER, 'create', { kind: 'HAUL', stage: w.stage, value: HAUL_YIELD })).toBeNull();
    expect(act(w.runtime, PAYER, 'create', { kind: 'HAUL', stage: w.stage })).toBeNull();
    const made = w.runtime.ventures.all().filter((v) => v.creator === PAYER);
    expect(made).toHaveLength(2);
    for (const venture of made) {
      expect(openIndices(venture).length).toBeGreaterThan(0);
      for (const role of venture.roles) {
        expect(role.terms.escrowed, 'the escrow floor binds: something is secured on every role').toBeGreaterThan(0);
      }
    }
  });
});
