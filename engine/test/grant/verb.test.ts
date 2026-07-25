/**
 * The `grant` and `revoke` verbs (SPEC §8, A6) — the core loop's issuance half.
 *
 * A6's signature moment is authority abused at the moment of maximum leverage, with
 * "the grant, the accepted warning, the sealed intention, and the deed all on the
 * record". This file pins the FIRST two of those four: a grant lands as an authoritative,
 * hashed row with its worst case (max_direct_loss / max_contingent_liability) on it, and
 * a revocation is always accepted and takes effect the next tick. The USE of the grant
 * (the deed) is the enforcement path, tested separately.
 *
 * Grants are recorded from parameters, not a submitted VC: the Keyring holds only public
 * keys and the house cast has no keypair, so the row is authoritative and the signed,
 * portable credential (identity/vc.ts) is the grantor's to produce from the same claims.
 */

import { describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import type { GrantId, PrincipalId, SystemId } from '../../src/core/types.js';
import { commonsSystems } from '../../src/world/index.js';
import {
  GRANT_MAX_LIFETIME_TICKS,
  Runtime,
  type PendingCorrection,
} from '../../src/sim/runtime.js';

interface World {
  readonly runtime: Runtime;
  readonly grantor: PrincipalId;
  readonly delegate: PrincipalId;
  readonly stage: SystemId;
}

function world(seed: string): World {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const stage = commonsSystems(runtime.world.map)[0];
  if (stage === undefined) throw new Error('the launch map has no Commons system');
  const grantor = 'p:grantor' as PrincipalId;
  const delegate = 'p:delegate' as PrincipalId;
  runtime.seat(grantor, 'grantor', stage);
  runtime.seat(delegate, 'delegate', stage);
  runtime.standing.open(grantor);
  runtime.standing.open(delegate);
  return { runtime, grantor, delegate, stage };
}

/** Submit one act, run the tick, and return the refusal (via the correction channel) or null. */
function act(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  params: Readonly<Record<string, unknown>>,
): PendingCorrection | null {
  const outcome = runtime.engine.submit({
    principal,
    verb,
    params,
    clientSequence: 0,
    arrivalMs: 0,
    decisionSource: 'LIVE',
  });
  if (!outcome.ok) throw new Error(`submit ${verb} refused at the door: ${outcome.invariant} ${outcome.hint}`);
  const report = runtime.runTick();
  if (report.halted) {
    throw new Error(
      `${verb} halted the world at tick ${String(report.tick)}: ` +
        report.violations.map((v) => `${v.id} ${v.message}`).join(' | '),
    );
  }
  return runtime.takeCorrections(principal)[0] ?? null;
}

const OK = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  delegate: 'p:delegate',
  template: 'treasury-hand',
  max_direct_loss: 500,
  max_contingent_liability: 200,
  expires_tick: 100,
  ...over,
});

describe('grant — issuance (SPEC §8, A6)', () => {
  it('grant is live in the verb table', () => {
    expect(world('g1').runtime.liveVerbs.has('grant')).toBe(true);
    expect(world('g1').runtime.liveVerbs.has('revoke')).toBe(true);
  });

  it('records an authoritative row with its worst case, and no refusal', () => {
    const w = world('g2');
    expect(act(w.runtime, w.grantor, 'grant', OK())).toBeNull();

    const grants = w.runtime.grants.forGrantor(w.grantor);
    expect(grants).toHaveLength(1);
    const g = grants[0]!;
    expect(g.grantor).toBe(w.grantor);
    expect(g.delegate).toBe(w.delegate);
    expect(g.template).toBe('treasury-hand');
    expect(g.maxDirectLoss).toBe(500);
    expect(g.maxContingentLiability).toBe(200);
    expect(g.spentDirect).toBe(0);
    expect(g.revokedAtTick).toBeNull();
    // A brand-new grant is live now and stays live through its expiry.
    expect(w.runtime.grants.isLive(g.id, w.runtime.engine.tick)).toBe(true);
    expect(w.runtime.grants.liveGrantBetween(w.grantor, w.delegate, w.runtime.engine.tick)?.id).toBe(g.id);
  });

  it('refuses a self-grant — the first hop of laundering unlimited authority (INV-23)', () => {
    const w = world('g3');
    const refusal = act(w.runtime, w.grantor, 'grant', OK({ delegate: 'p:grantor' }));
    expect(refusal?.invariant).toBe('INV-23');
    expect(w.runtime.grants.all()).toHaveLength(0);
  });

  it('refuses a delegate that does not exist', () => {
    const w = world('g4');
    const refusal = act(w.runtime, w.grantor, 'grant', OK({ delegate: 'p:nobody' }));
    expect(refusal).not.toBeNull();
    expect(w.runtime.grants.all()).toHaveLength(0);
  });

  it('refuses a negative LIMIT — the worst case must be a real bound (A7)', () => {
    const w = world('g5');
    expect(act(w.runtime, w.grantor, 'grant', OK({ max_direct_loss: -1 }))?.invariant).toBe('A7');
    expect(act(w.runtime, w.grantor, 'grant', OK({ max_contingent_liability: -5 }))?.invariant).toBe(
      'A7',
    );
  });

  it('refuses a missing or already-past expiry (grants expire by design, §8.1 #5)', () => {
    const w = world('g6');
    // At tick 0 (the first run), an expiry of 0 is not in the future.
    expect(act(w.runtime, w.grantor, 'grant', OK({ expires_tick: 0 }))).not.toBeNull();
    expect(w.runtime.grants.all()).toHaveLength(0);
  });

  it('refuses a lifetime beyond ~3 Reckonings (scar #7, the sticky vow)', () => {
    const w = world('g7');
    const tooFar = GRANT_MAX_LIFETIME_TICKS + 50;
    const refusal = act(w.runtime, w.grantor, 'grant', OK({ expires_tick: tooFar }));
    expect(refusal?.invariant).toBe('A14');
    expect(w.runtime.grants.all()).toHaveLength(0);
  });
});

describe('revoke — always accepted, effective next tick (SPEC §8.1 #6)', () => {
  function grantOne(w: World): GrantId {
    expect(act(w.runtime, w.grantor, 'grant', OK())).toBeNull();
    const id = w.runtime.grants.forGrantor(w.grantor)[0]?.id;
    if (id === undefined) throw new Error('grant did not land');
    return id;
  }

  it('the grantor revokes; the grant is live the tick it is revoked and dead the next', () => {
    const w = world('r1');
    const id = grantOne(w);
    const at = w.runtime.engine.tick;
    expect(act(w.runtime, w.grantor, 'revoke', { grant: id })).toBeNull();
    expect(w.runtime.grants.get(id)?.revokedAtTick).toBe(at + 1); // revoke ran on the next tick
    // It is dead from the tick after it was revoked.
    const revokedAt = w.runtime.grants.get(id)!.revokedAtTick!;
    expect(w.runtime.grants.isLive(id, revokedAt)).toBe(true);
    expect(w.runtime.grants.isLive(id, revokedAt + 1)).toBe(false);
  });

  it('a delegate cannot revoke the authority handed to it (INV-23)', () => {
    const w = world('r2');
    const id = grantOne(w);
    const refusal = act(w.runtime, w.delegate, 'revoke', { grant: id });
    expect(refusal?.invariant).toBe('INV-23');
    expect(w.runtime.grants.get(id)?.revokedAtTick).toBeNull();
  });

  it('refuses revoking a grant that does not exist', () => {
    const w = world('r3');
    expect(act(w.runtime, w.grantor, 'revoke', { grant: 'g:nope' })).not.toBeNull();
  });
});
