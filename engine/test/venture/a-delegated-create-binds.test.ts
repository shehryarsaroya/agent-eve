/**
 * **A DELEGATED `create` BINDS THE GRANTOR. THE GRANT IS THE CONSENT.** (A6, §8.1, §9)
 *
 * ── THE DEFECT THIS FILE CLOSES ──────────────────────────────────────────────
 *
 * A delegate could create a venture in its grantor's name, draw on **both** of the grantor's LIMITS
 * and fund the escrow out of the grantor's stores — and the venture then sat `FORMING` until the
 * grantor itself sent a `sign`. So:
 *
 *   - **going dark was a perfect defence against a delegate.** Three blind probes reached that
 *     conclusion independently (`D22`): *"accepting a mandate has zero expected value, and granting one
 *     has a small non-zero cost. Both sides rationally opt out."* That is the quiet equilibrium
 *     arriving through the front door, on the one mechanic the design is named for;
 *   - **`agent.md` §9 said the opposite** — *"agents you granted authority to keep acting for you"* —
 *     so the document and the engine disagreed about one rule, which is scar #1's exact shape;
 *   - and **a syndicate could never sign at all**, because a house has no keypair, so every venture an
 *     office-holder created for its house was unactivatable by construction. Offices were unblocked
 *     over the treasury and dead-ended one step later.
 *
 * ── WHAT IS ASSERTED, AND WHAT IS DELIBERATELY NOT ───────────────────────────
 *
 * That the binding lands, that it is bounded by the LIMITS rather than by a signature, that it is
 * visible to every party and on the frame, and that an ordinary self-create is untouched. **Not** that
 * anybody betrays: that is `AGT-E1`'s question, answered by measurement on a live world, and a test
 * that forced a betrayal would rig the one result this project may not rig.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FREEZE_TICKS, TICKS_PER_RECKONING, setSpeed } from '../../src/core/time.js';
import { renderFrame } from '../../src/frames/render.js';
import type { Handle, GrantId, PrincipalId, SystemId, VentureId } from '../../src/core/types.js';
import { minor, type Bps } from '../../src/core/units.js';
import { storesAccount } from '../../src/ledger/index.js';
import {
  GRANT_IS_CONSENT,
  activate,
  bindingNote,
  boundAtFormation,
  countersign,
  createVenture,
  isFullyCountersigned,
  signatoriesRequired,
  yourTakeAtP50,
} from '../../src/venture/index.js';
import { syndicateAsPrincipal } from '../../src/syndicate/book.js';
import { commonsSystems } from '../../src/world/index.js';
import { Runtime, type PendingCorrection } from '../../src/sim/runtime.js';
import { buildObservation } from '../../src/api/observe.js';
import { ALICE, BRAM, CASS, fixture, fill, makeHaul, share, wage } from './fixture.js';

const SETTLE_TICK = TICKS_PER_RECKONING - 1;

// ── The unit half: the constructor, the signature set, and activation ─────────

describe('the creator is countersigned at formation exactly when a grant stood in for it', () => {
  it('boundAtFormation names the creator under a grant and nobody without one', () => {
    const creator = 'p:grantor' as PrincipalId;
    expect(boundAtFormation({ creator, boundByGrant: null })).toEqual([]);
    expect(boundAtFormation({ creator, boundByGrant: 'g:1' as GrantId })).toEqual([creator]);
  });

  it('a self-create still needs the creator’s own signature (the rule was NOT widened)', () => {
    const f = fixture();
    const v = makeHaul(f);
    expect(v.boundByGrant).toBeNull();
    expect([...v.countersigned]).toEqual([]);
    expect(signatoriesRequired(v)).toContain(v.creator);
    expect(isFullyCountersigned(v)).toBe(false);
  });

  it('a delegated create is bound at formation and still needs its role-holders', () => {
    const f = fixture();
    const made = createVenture({
      id: 'v-bound' as VentureId,
      kind: 'HAUL',
      creator: ALICE,
      stage: f.stage,
      terms: [wage(1_000, 1_000), share(3_000 as Bps, 500, 700)],
      windowOpensTick: 0,
      windowClosesTick: 100,
      resolvesAtTick: 200,
      valuation: f.valuation,
      rulesVersion: 1,
      boundByGrant: 'g:7' as GrantId,
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const v = f.book.add(made.value);

    expect(v.boundByGrant).toBe('g:7');
    expect([...v.countersigned]).toEqual([ALICE]);

    // Binding the creator does not activate anything by itself: an unfilled venture is still a
    // draft, and `activate` says so by name. This is the check that stops "bound" from being read
    // as "live" — a venture that went LIVE with open roles would pay nobody and settle silently.
    const early = activate(v, 7, 2);
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.hint).toContain('still has open roles');

    fill(f, v, 0, BRAM);
    fill(f, v, 1, CASS);
    // The other half of §7.3 is untouched: each counterparty still signs for itself.
    expect(isFullyCountersigned(v)).toBe(false);
    for (const p of [BRAM, CASS]) {
      const server = yourTakeAtP50(v, p);
      const signed = countersign(v, p, v.termsHash ?? '', server, server);
      expect(signed.ok, `${p} could not sign`).toBe(true);
    }

    // ★ THE CLAIM. The grantor never acted, and the venture is LIVE.
    expect(isFullyCountersigned(v)).toBe(true);
    const live = activate(v, 7, 2);
    expect(live.ok, live.ok ? '' : `${live.invariant} ${live.hint}`).toBe(true);
    expect(v.state).toBe('LIVE');
  });

  it('a HOUSE can now be a creator at all — it has no keypair and could never sign', () => {
    // ══════════════════════════════════════════════════════════════════════
    // A latent bug this change closes as a side effect, found while writing it.
    //
    // A syndicate is *"a principal with no keypair"* that *"cannot sign a request and cannot act"*.
    // `signatoriesRequired` includes `venture.creator`. So the office-holder path that was unblocked
    // over a pooled treasury produced ventures that **could never reach `isFullyCountersigned`** —
    // §8's quartermaster could finally spend the vault and the venture it spent it on was
    // unactivatable by construction. Nothing failed loudly: it retired ABANDONED at window close and
    // the escrow came back, which reads as "nobody wanted the roles".
    //
    // The fix is not a special case for houses. It is the same rule: the house's consent is the
    // covenant its members voted, carried by the grant the office holds.
    // ══════════════════════════════════════════════════════════════════════
    const f = fixture();
    const house = syndicateAsPrincipal('syn:p-alice:1' as never);
    const terms = [wage(1_000, 1_000), share(3_000 as Bps, 500, 700)];
    const args = {
      kind: 'HAUL' as const,
      creator: house,
      stage: f.stage,
      terms,
      windowOpensTick: 0,
      windowClosesTick: 100,
      resolvesAtTick: 200,
      valuation: f.valuation,
      rulesVersion: 1,
    };

    const unbound = createVenture({ ...args, id: 'v-house-unbound' as VentureId });
    expect(unbound.ok).toBe(true);
    if (!unbound.ok) return;
    // No signature the house could ever produce, and it is a required signatory.
    expect(signatoriesRequired(unbound.value)).toContain(house);
    expect(isFullyCountersigned(unbound.value)).toBe(false);

    const bound = createVenture({
      ...args,
      id: 'v-house-bound' as VentureId,
      boundByGrant: 'g:office' as GrantId,
    });
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(bound.value.countersigned.has(house)).toBe(true);
    expect(isFullyCountersigned(bound.value)).toBe(true);
  });

  it('the same venture WITHOUT the grant cannot activate however many counterparties sign', () => {
    // The mutation, run as a test: this is precisely the world before the change, and it is what
    // "going dark is a perfect defence" looked like from the counterparties' side.
    const f = fixture();
    const v = makeHaul(f, { id: 'v-unbound' as VentureId });
    fill(f, v, 0, BRAM);
    fill(f, v, 1, CASS);
    for (const p of [BRAM, CASS]) {
      const server = yourTakeAtP50(v, p);
      countersign(v, p, v.termsHash ?? '', server, server);
    }
    const live = activate(v, 7, 2);
    expect(live.ok).toBe(false);
    if (live.ok) return;
    expect(live.invariant).toBe('PROP-W1');
    expect(live.hint).toContain(String(ALICE));
  });
});

// ── The integration half: through the real verb, the grant gate and the ledger ─

interface World {
  readonly runtime: Runtime;
  readonly grantor: PrincipalId;
  readonly delegate: PrincipalId;
  readonly fillers: readonly PrincipalId[];
  readonly stage: SystemId;
}

function world(seed: string): World {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const stage = commonsSystems(runtime.world.map)[0];
  if (stage === undefined) throw new Error('the launch map has no Commons system');
  const grantor = 'p:grantor' as PrincipalId;
  const delegate = 'p:delegate' as PrincipalId;
  const fillers = ['p:filler-a' as PrincipalId, 'p:filler-b' as PrincipalId];
  for (const [i, p] of [grantor, delegate, ...fillers].entries()) {
    runtime.seat(p, `seat-${String(i)}`, stage);
    runtime.standing.open(p);
  }
  return { runtime, grantor, delegate, fillers, stage };
}

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
  if (!outcome.ok) throw new Error(`submit ${verb}: ${outcome.invariant} ${outcome.hint}`);
  const report = runtime.runTick();
  if (report.halted) {
    throw new Error(
      `${verb} halted at tick ${String(report.tick)}: ` +
        report.violations.map((v) => `${v.id} ${v.message}`).join(' | '),
    );
  }
  return runtime.takeCorrections(principal)[0] ?? null;
}

function observe(w: World, principal: PrincipalId): ReturnType<typeof buildObservation> {
  return buildObservation({
    runtime: w.runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 16,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  });
}

function grantAuthority(w: World, direct: number, contingent: number): GrantId {
  const refusal = act(w.runtime, w.grantor, 'grant', {
    delegate: w.delegate,
    // `steward`, not `treasury-hand`: this fixture's delegate does a delegated `create`, and since
    // `RULES_VERSION` 23 a template is an enforced FENCE rather than a label — a treasury-hand
    // carries `elect` only. The office named here now has to be one that carries the verb the
    // case exercises, which is the whole point of the change.
    template: 'steward',
    max_direct_loss: direct,
    max_contingent_liability: contingent,
    expires_tick: SETTLE_TICK + 10,
  });
  expect(refusal, refusal?.hint).toBeNull();
  const id = w.runtime.grants.forGrantor(w.grantor)[0]?.id;
  if (id === undefined) throw new Error('grant did not land');
  return id;
}

describe('a delegate binds its grantor through the real verb', () => {
  it('the grantor is countersigned, the grant is named, and the receipt says so', () => {
    const w = world('bind-basic');
    const id = grantAuthority(w, 40_000, 40_000);
    expect(act(w.runtime, w.delegate, 'create', {
      on_behalf_of: w.grantor,
      stage: w.stage,
      kind: 'HAUL',
      value: 12_000,
    })).toBeNull();

    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('the delegated create produced no venture');
    expect(v.creator).toBe(w.grantor);
    expect(v.boundByGrant).toBe(id);
    expect(v.countersigned.has(w.grantor)).toBe(true);
    // And the delegate is NOT a signatory — it acted, it is not a party.
    expect(v.countersigned.has(w.delegate)).toBe(false);

    // ── AND IT IS ON THE PERMANENT RECORD, WHICH IS THE HALF THAT MATTERS ────
    //
    // A6's signature moment is *"a grant used against you through an entirely legitimate act"*, and
    // the replay has to be able to point at the act. A state field with no receipt is a binding the
    // record cannot explain, and §14's receipt reel is read back from these rows — not from state.
    const formed = w.runtime.events
      .transcript(`venture::${v.id}`, w.runtime.engine.tick, { kind: 'VIEWER' })
      .filter((row) => row.event.kind === 'venture.formed');
    expect(formed).toHaveLength(1);
    expect(formed[0]?.event.payload['boundByGrant']).toBe(id);
    expect(formed[0]?.event.payload['boundNote']).toBe(
      bindingNote({ creator: w.grantor, delegate: w.delegate, grant: id }),
    );
    expect(formed[0]?.event.onBehalfOfPrincipalId).toBe(w.grantor);
    expect(formed[0]?.event.actorPrincipalId).toBe(w.delegate);
  });

  it('and a SELF create writes no binding onto the record, so the receipt cannot over-claim', () => {
    // The other direction of A5′: a row saying "bound under a grant" about a venture its creator
    // signed itself is the record being wrong about who decided, which is the column other agents
    // read to price a counterparty.
    const w = world('bind-receipt-self');
    expect(act(w.runtime, w.grantor, 'create', { stage: w.stage, kind: 'HAUL', value: 12_000 })).toBeNull();
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('no venture');
    const formed = w.runtime.events
      .transcript(`venture::${v.id}`, w.runtime.engine.tick, { kind: 'VIEWER' })
      .filter((row) => row.event.kind === 'venture.formed');
    expect(formed).toHaveLength(1);
    expect(formed[0]?.event.payload['boundByGrant']).toBeUndefined();
    expect(formed[0]?.event.payload['boundNote']).toBeUndefined();
  });

  it('★ the venture goes LIVE while the grantor never sends a single request', () => {
    const w = world('bind-live');
    grantAuthority(w, 40_000, 40_000);
    const before = w.runtime.engine.tick;
    expect(act(w.runtime, w.delegate, 'create', {
      on_behalf_of: w.grantor,
      stage: w.stage,
      kind: 'HAUL',
      value: 12_000,
    })).toBeNull();

    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('no venture');
    const hash = v.termsHash;

    // Two counterparties fill the two roles. Neither is the delegate: §8.1 #3 forbids a delegate
    // being paid out of a deal it holds authority over, and that gate is untouched by this change.
    for (const [i, filler] of w.fillers.entries()) {
      const hand = [...w.runtime.world.hands.values()].find(
        (h) => h.principal === filler && h.state === 'IDLE',
      );
      if (hand === undefined) throw new Error(`${filler} has no idle hand`);
      w.runtime.engine.submit({
        principal: filler,
        verb: 'fill_role',
        params: { venture: v.id, role: i, hand: hand.id, stake: 0 },
        clientSequence: 0,
        arrivalMs: 0,
        decisionSource: 'LIVE',
      });
    }
    w.runtime.runTick();
    expect(v.roles.every((r) => r.filledByPrincipal !== null), 'both roles must fill').toBe(true);

    for (const filler of w.fillers) {
      w.runtime.engine.submit({
        principal: filler,
        verb: 'sign',
        params: { venture: v.id, terms_hash: hash },
        clientSequence: 1,
        arrivalMs: 0,
        decisionSource: 'LIVE',
      });
    }
    w.runtime.runTick();
    w.runtime.runTick();

    expect(v.state, 'a bound venture activates on its counterparties’ signatures alone').toBe('LIVE');
    // The grantor did nothing after issuing the grant, and the window never had to wait for it.
    expect(w.runtime.engine.tick - before).toBeLessThan(12);
  });

  it('the LIMITS are what bound it: a create past either limit is still refused', () => {
    // The consequence of decision 1 stated as a test — the countersignature is gone, so if the
    // LIMITS did not bite there would be nothing left protecting a grantor at all.
    const w = world('bind-limits');
    grantAuthority(w, 100, 100);
    const refusal = act(w.runtime, w.delegate, 'create', {
      on_behalf_of: w.grantor,
      stage: w.stage,
      kind: 'HAUL',
      value: 12_000,
    });
    expect(refusal?.invariant).toBe('INV-22');
    expect(w.runtime.ventures.forPrincipal(w.grantor)).toHaveLength(0);
    expect(w.runtime.ledger.freeBalance(storesAccount(w.grantor))).toBeGreaterThan(0);
  });

  it('a self-create is unchanged: the creator is not bound and must still sign', () => {
    const w = world('bind-self');
    expect(act(w.runtime, w.grantor, 'create', { stage: w.stage, kind: 'HAUL', value: 12_000 })).toBeNull();
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('no venture');
    expect(v.boundByGrant).toBeNull();
    expect(v.countersigned.has(w.grantor)).toBe(false);
  });

  it('every party can READ that a delegate bound it — including the grantor itself', () => {
    // A13/A2: a grantor that finds its own name in `countersigned` and cannot see why would
    // reasonably file a discrepancy. `bound_by_grant` is the answer, on the row.
    const w = world('bind-observe');
    const id = grantAuthority(w, 40_000, 40_000);
    expect(act(w.runtime, w.delegate, 'create', {
      on_behalf_of: w.grantor,
      stage: w.stage,
      kind: 'HAUL',
      value: 12_000,
    })).toBeNull();

    const mine = observe(w, w.grantor);
    const rows = (mine.ventures as { readonly mine?: readonly Record<string, unknown>[] }).mine ?? [];
    const row = rows[0];
    expect(row?.['bound_by_grant']).toBe(id);
    expect(row?.['i_have_signed']).toBe(true);

    // And the recruiting surface a stranger reads before it commits a hand.
    const seen = observe(w, w.fillers[0] as PrincipalId);
    const board = (seen.ventures as { readonly board?: readonly Record<string, unknown>[] }).board ?? [];
    expect(board.length).toBeGreaterThan(0);
    expect(board[0]?.['creator_bound_by_grant']).toBe(id);
  });

  it('survives an abort and a replay: `boundByGrant` is inside the capture', () => {
    // Not captured, the rollback rebuilds the venture UNBOUND — the creator drops out of
    // `countersigned`, `activate` refuses a venture that is already live, and the authority line
    // under-states what a delegate committed. `terms_hash` cannot witness it, because the terms are
    // the same terms whoever formed them.
    const w = world('bind-capture');
    const id = grantAuthority(w, 40_000, 40_000);
    expect(act(w.runtime, w.delegate, 'create', {
      on_behalf_of: w.grantor,
      stage: w.stage,
      kind: 'HAUL',
      value: 12_000,
    })).toBeNull();
    const before = w.runtime.engine.stateHash;

    const table = w.runtime.engine.stateTables.find((t) => t.name === 'venture');
    if (table?.restore === undefined) throw new Error('no restorable venture state table');
    table.restore(table.capture());

    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    expect(v?.boundByGrant).toBe(id);
    expect(v?.countersigned.has(w.grantor)).toBe(true);
    expect(w.runtime.engine.stateHash).toBe(before);
  });
});

describe('A13 — the binding reaches the frame', () => {
  it('the authority line counts what the delegate has bound in its grantor’s name', () => {
    const w = world('bind-frame');
    grantAuthority(w, 400_000, 400_000);
    expect(act(w.runtime, w.delegate, 'create', {
      on_behalf_of: w.grantor,
      stage: w.stage,
      kind: 'HAUL',
      value: 12_000,
    })).toBeNull();
    expect(act(w.runtime, w.delegate, 'create', {
      on_behalf_of: w.grantor,
      stage: w.stage,
      kind: 'DIG',
      value: 6_000,
    })).toBeNull();

    while (w.runtime.engine.tick <= SETTLE_TICK) {
      const report = w.runtime.runTick();
      if (report.halted) {
        throw new Error(`halted at ${String(report.tick)}: ${report.violations.map((x) => x.id).join(' ')}`);
      }
    }
    const line = w.runtime.reckoningFrame()?.authorityLines.find((l) => l.grantor === w.grantor);
    if (line === undefined) throw new Error('the grant drew no authority line');
    expect(line.boundVentures).toBe(2);
    expect(line.delegate).toBe(w.delegate);
    expect(FREEZE_TICKS).toBeGreaterThan(0); // the clock the loop above relies on
  });

  it('the docket card says who committed whom, and outranks the prior-dealings sentence', () => {
    // `renderFrame` directly, because the sentence is the assertion: the docket is §14.1's DEFAULT
    // view, and a card that printed "they have dealt before, and it held" about a deal one party
    // never agreed to would be the record being wrong about a relationship (A5′).
    const grantor = 'p:halcyon' as PrincipalId;
    const delegate = 'p:vex' as PrincipalId;
    const upcoming = {
      venture: 'v-1' as VentureId,
      atStake: minor(9_000),
      parties: [grantor, delegate],
      priorDealings: 'HELD' as const,
      boundGrantor: grantor,
      boundBy: delegate,
    };
    const bound = renderFrame({
      reckoning: 1,
      tick: 287,
      stateHash: 'h',
      settled: [],
      meters: { levyShort: minor(0), onAPromise: minor(0), kept: 0, broken: 0 },
      handles: new Map([
        [grantor, 'halcyon' as Handle],
        [delegate, 'vex' as Handle],
      ]),
      ticker: [],
      tomorrow: [upcoming],
    });
    expect(bound.docket[0]?.tension).toBe(
      'vex committed halcyon to this under a grant. halcyon never signed it.',
    );

    // And with no delegate in it, the same card falls back to the history sentence — so the branch
    // is a discrimination rather than a constant.
    const plain = renderFrame({
      reckoning: 1,
      tick: 287,
      stateHash: 'h',
      settled: [],
      meters: { levyShort: minor(0), onAPromise: minor(0), kept: 0, broken: 0 },
      handles: new Map([
        [grantor, 'halcyon' as Handle],
        [delegate, 'vex' as Handle],
      ]),
      ticker: [],
      tomorrow: [{ ...upcoming, boundGrantor: null, boundBy: null }],
    });
    expect(plain.docket[0]?.tension).toBe('They have dealt before, and it held.');
  });

  it('a grant nobody has bound anything under counts zero (the field is not stuck on)', () => {
    const w = world('bind-frame-zero');
    grantAuthority(w, 400_000, 400_000);
    while (w.runtime.engine.tick <= SETTLE_TICK) {
      if (w.runtime.runTick().halted) throw new Error('halted');
    }
    const line = w.runtime.reckoningFrame()?.authorityLines.find((l) => l.grantor === w.grantor);
    expect(line?.boundVentures).toBe(0);
  });
});

describe('the rules surface says it once', () => {
  const AGENT_MD = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');

  it('GRANT_IS_CONSENT is in agent.md verbatim', () => {
    // Same discipline as GRADUATION_STATEMENT and the three sovereignty statements: the engine's
    // sentence and the document's sentence are the same bytes, because "the delegate can act while
    // you are dark" and "the delegate needs your signature" are the two readings a paraphrase can
    // slide between, and one of them is a quiet-equilibrium failure.
    const normalised = AGENT_MD.replace(/\n> ?/g, ' ').replace(/[ \t]+/g, ' ');
    expect(normalised).toContain(GRANT_IS_CONSENT.replace(/[ \t]+/g, ' '));
  });

  it('states the consequence, not just the mechanic', () => {
    // A6 is a two-sided rule and a document that stated only the delegate's new power would teach
    // half of it. Both halves, named.
    expect(AGENT_MD).toContain('It binds the grantor immediately.');
    expect(AGENT_MD).toContain('bound_by_grant');
  });
});
