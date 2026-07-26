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
import type { EventId, GrantId, PrincipalId, SystemId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { storesAccount } from '../../src/ledger/index.js';
import { commonsSystems, handsOf } from '../../src/world/index.js';
import { buildObservation } from '../../src/api/observe.js';

type Row = Record<string, unknown>;
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

describe('on-behalf create — a delegate draws on a grant (A6 enforcement)', () => {
  function grantTo(w: World, opts: Record<string, unknown> = {}): GrantId {
    expect(act(w.runtime, w.grantor, 'grant', OK(opts))).toBeNull();
    const id = w.runtime.grants.forGrantor(w.grantor)[0]?.id;
    if (id === undefined) throw new Error('grant did not land');
    return id;
  }

  it('creates a venture on the grantor’s account, drawing escrow from the GRANTOR, not the delegate', () => {
    const w = world('ob1');
    const id = grantTo(w, { max_direct_loss: 250_000 });
    const grantorBefore = w.runtime.ledger.freeBalance(storesAccount(w.grantor));
    const delegateBefore = w.runtime.ledger.freeBalance(storesAccount(w.delegate));

    const refusal = act(w.runtime, w.delegate, 'create', {
      kind: 'HAUL',
      on_behalf_of: w.grantor,
      value: 12_000,
      stage: w.stage,
    });
    expect(refusal).toBeNull();

    // The venture belongs to the grantor, not the delegate who formed it.
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    expect(v?.creator).toBe(w.grantor);

    // The escrow came out of the GRANTOR's stores; the delegate paid nothing.
    const escrow = grantorBefore - w.runtime.ledger.freeBalance(storesAccount(w.grantor));
    expect(escrow).toBeGreaterThan(0);
    expect(w.runtime.ledger.freeBalance(storesAccount(w.delegate))).toBe(delegateBefore);

    // The draw was recorded against the grant, by the delegate.
    expect(w.runtime.grants.get(id)?.spentDirect).toBe(escrow);
    expect(
      w.runtime.grants.allSpends().some((s) => s.grant === id && s.delegate === w.delegate),
    ).toBe(true);
  });

  it('a delegate with NO grant cannot act on the grantor’s behalf (INV-23)', () => {
    const w = world('ob2');
    const refusal = act(w.runtime, w.delegate, 'create', {
      kind: 'HAUL',
      on_behalf_of: w.grantor,
      value: 12_000,
      stage: w.stage,
    });
    expect(refusal?.invariant).toBe('INV-23');
    expect(w.runtime.ventures.forPrincipal(w.grantor)).toHaveLength(0);
  });

  it('a draw past the grant’s direct headroom is refused, and NO value moves (INV-22, the gate not the net)', () => {
    const w = world('ob3');
    const id = grantTo(w, { max_direct_loss: 1 }); // far below any real escrow
    const before = w.runtime.ledger.freeBalance(storesAccount(w.grantor));
    const refusal = act(w.runtime, w.delegate, 'create', {
      kind: 'HAUL',
      on_behalf_of: w.grantor,
      value: 12_000,
      stage: w.stage,
    });
    expect(refusal?.invariant).toBe('INV-22');
    // The gate ran before any value moved — the grantor is untouched, no venture, no spend.
    expect(w.runtime.ledger.freeBalance(storesAccount(w.grantor))).toBe(before);
    expect(w.runtime.ventures.forPrincipal(w.grantor)).toHaveLength(0);
    expect(w.runtime.grants.get(id)?.spentDirect).toBe(0);
  });

  it('a self-create still needs no grant — the common path is unchanged (regression)', () => {
    const w = world('ob4');
    const refusal = act(w.runtime, w.grantor, 'create', { kind: 'HAUL', value: 12_000, stage: w.stage });
    expect(refusal).toBeNull();
    expect(w.runtime.ventures.forPrincipal(w.grantor)[0]?.creator).toBe(w.grantor);
  });
});

describe('observe surfaces grants, so an agent can see and use its authority (A6)', () => {
  function grantsView(runtime: Runtime, principal: PrincipalId): { granted: Row[]; held: Row[] } {
    const observation = buildObservation({
      runtime,
      principal,
      serverNowMs: 0,
      fresh: true,
      wakesRemaining: 16,
      stale: false,
      corrections: [],
      actionsRemaining: 4,
    }) as unknown as { grants: { granted: Row[]; held: Row[] } };
    return observation.grants;
  }

  it('a grantor sees what it granted; a delegate sees what it holds — the same grant, one book', () => {
    const w = world('obs1');
    expect(act(w.runtime, w.grantor, 'grant', OK({ max_direct_loss: 500 }))).toBeNull();
    const id = w.runtime.grants.forGrantor(w.grantor)[0]!.id;

    const asGrantor = grantsView(w.runtime, w.grantor);
    expect(asGrantor.granted).toHaveLength(1);
    expect(asGrantor.granted[0]!['id']).toBe(id);
    expect(asGrantor.granted[0]!['delegate']).toBe(w.delegate);
    expect(asGrantor.granted[0]!['headroom_direct']).toBe(500);
    expect(asGrantor.granted[0]!['live']).toBe(true);
    expect(asGrantor.held).toHaveLength(0); // you are not your own delegate

    const asDelegate = grantsView(w.runtime, w.delegate);
    expect(asDelegate.held).toHaveLength(1);
    expect(asDelegate.held[0]!['id']).toBe(id);
    expect(asDelegate.held[0]!['grantor']).toBe(w.grantor);
    expect(asDelegate.granted).toHaveLength(0);
  });

  it('the grantor watches the headroom fall as its delegate draws on the grant (exposure is visible)', () => {
    const w = world('obs2');
    expect(act(w.runtime, w.grantor, 'grant', OK({ max_direct_loss: 250_000 }))).toBeNull();
    const id = w.runtime.grants.forGrantor(w.grantor)[0]!.id;
    expect(
      act(w.runtime, w.delegate, 'create', {
        kind: 'HAUL',
        on_behalf_of: w.grantor,
        value: 12_000,
        stage: w.stage,
      }),
    ).toBeNull();

    const spent = w.runtime.grants.get(id)!.spentDirect;
    expect(spent).toBeGreaterThan(0);
    const row = grantsView(w.runtime, w.grantor).granted[0]!;
    expect(row['spent_direct']).toBe(spent);
    expect(row['headroom_direct']).toBe(250_000 - spent);
  });
});

describe('anti-self-dealing — a delegate is not a counterparty to a deal it controls (§8.1 #3)', () => {
  it('a delegate may not fill a role in a venture whose creator it holds authority over', () => {
    const w = world('sd1');
    expect(act(w.runtime, w.grantor, 'grant', OK({ max_direct_loss: 250_000 }))).toBeNull();
    expect(
      act(w.runtime, w.delegate, 'create', {
        kind: 'HAUL',
        on_behalf_of: w.grantor,
        value: 12_000,
        stage: w.stage,
      }),
    ).toBeNull();

    const v = w.runtime.ventures.forPrincipal(w.grantor)[0]!;
    const open = v.roles.find((r) => r.filledByPrincipal === null)!;
    const hand = handsOf(w.runtime.world, w.delegate)[0]!;
    // The delegate created this venture on the grantor's account and now tries to be
    // paid out of it — the trivial self-deal §8.1 #3 forbids.
    const refusal = act(w.runtime, w.delegate, 'fill_role', {
      venture: v.id,
      role: open.index,
      hand: hand.id,
    });
    expect(refusal?.invariant).toBe('INV-23');
  });

  it('letting the grant LAPSE does not unlock the self-deal — the guard asks about creation', () => {
    // The one-tick bypass a codex review of the grant accounting found. The guard used to
    // ask "do you hold a live grant RIGHT NOW", so the trivial betrayal it exists to block
    // was available to anyone willing to wait: create the venture on the grantor's account
    // while the grant is live, revoke it (revocation takes effect next tick), let a tick
    // pass, then fill a paid role in the venture you shaped with the grantor's money.
    const w = world('sd-lapse');
    expect(act(w.runtime, w.grantor, 'grant', OK({ max_direct_loss: 250_000 }))).toBeNull();
    expect(
      act(w.runtime, w.delegate, 'create', {
        kind: 'HAUL',
        on_behalf_of: w.grantor,
        value: 12_000,
        stage: w.stage,
      }),
    ).toBeNull();

    const v = w.runtime.ventures.forPrincipal(w.grantor)[0]!;
    const id = w.runtime.grants.forGrantor(w.grantor)[0]!.id;

    // The grantor's authority is withdrawn, and a tick passes so it is fully effective.
    expect(act(w.runtime, w.grantor, 'revoke', { grant: id })).toBeNull();
    w.runtime.runTick();
    expect(w.runtime.grants.liveGrantBetween(w.grantor, w.delegate, w.runtime.engine.tick)).toBeNull();

    // No live grant — and the delegate must STILL be refused, because it could have
    // shaped this venture when it did hold one.
    const open = v.roles.find((r) => r.filledByPrincipal === null)!;
    const hand = handsOf(w.runtime.world, w.delegate)[0]!;
    const refusal = act(w.runtime, w.delegate, 'fill_role', {
      venture: v.id,
      role: open.index,
      hand: hand.id,
    });
    expect(refusal?.invariant).toBe('INV-23');
  });

  it('a principal with no authority over the creator may fill the role (control)', () => {
    const w = world('sd2');
    const outsider = 'p:outsider' as PrincipalId;
    w.runtime.seat(outsider, 'outsider', w.stage);
    w.runtime.standing.open(outsider);
    expect(act(w.runtime, w.grantor, 'create', { kind: 'HAUL', value: 12_000, stage: w.stage })).toBeNull();

    const v = w.runtime.ventures.forPrincipal(w.grantor)[0]!;
    const open = v.roles.find((r) => r.filledByPrincipal === null)!;
    const hand = handsOf(w.runtime.world, outsider)[0]!;
    const refusal = act(w.runtime, outsider, 'fill_role', {
      venture: v.id,
      role: open.index,
      hand: hand.id,
    });
    // May be refused for an unrelated eligibility reason, but never for self-dealing —
    // the outsider holds no authority over the creator.
    expect(refusal?.invariant).not.toBe('INV-23');
  });
});

describe('INV-22 is LIVE over the grant rows, not vacuous (A6 backstop)', () => {
  it('a grant forced past its LIMIT halts the world at tick close', () => {
    const w = world('inv22');
    expect(act(w.runtime, w.grantor, 'grant', OK({ max_direct_loss: 500 }))).toBeNull();
    const id = w.runtime.grants.forGrantor(w.grantor)[0]!.id;

    // Force a spend past the max_direct_loss the grantor was shown (A7). This is not
    // reachable through the verbs — it stands in for a delegate-enforcement bug that
    // let a draw overrun its LIMIT — and INV-22 is the net that must catch it.
    w.runtime.grants.recordSpend({
      grant: id,
      delegate: w.delegate,
      tick: w.runtime.engine.tick,
      eventId: 'ev:overrun' as EventId,
      direct: minor(600),
      contingent: minor(0),
    });

    const report = w.runtime.runTick();
    expect(report.halted).toBe(true);
    expect(report.violations.map((v) => v.id)).toContain('INV-22');
  });

  it('a grant spent within its LIMIT does not halt (the invariant is not trigger-happy)', () => {
    const w = world('inv22-ok');
    expect(act(w.runtime, w.grantor, 'grant', OK({ max_direct_loss: 500 }))).toBeNull();
    const id = w.runtime.grants.forGrantor(w.grantor)[0]!.id;
    w.runtime.grants.recordSpend({
      grant: id,
      delegate: w.delegate,
      tick: w.runtime.engine.tick,
      eventId: 'ev:ok' as EventId,
      direct: minor(400),
      contingent: minor(0),
    });
    const report = w.runtime.runTick();
    expect(report.halted).toBe(false);
    expect(w.runtime.grants.get(id)?.spentDirect).toBe(400);
  });
});
