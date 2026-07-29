/**
 * ★ **THE FIVE DEFECTS A BLIND PROBE FOUND BY RUNNING A FULL BETRAYAL THROUGH THE FRONT DOOR.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **REPRODUCED FIRST, IN THIS FILE, AND THE NUMBERS ARE THE PROBE'S.** Its first revision asserted
 * the BROKEN behaviour and ran green — six assertions, all from the engine's own public surface —
 * and every one of them then went red on the fix. That order is the point: a unit test that passes
 * with the fix present but never reproduced the defect is the evidence that has failed this project
 * seventeen times. The commit before this one is that revision.
 *
 * | # | axiom | what the probe measured | what it is now |
 * |---|---|---|---|
 * | 1 | **A5′** | a `DEFAULTED` venture's row named the GRANTOR as creator and signatory; the delegate that formed it appeared nowhere | `actedBy` on the row, the default, the standing delta and two indexed event columns |
 * | 2 | **A7** | grant charged **2,000**; the same observation quoted the grantor a payable of **7,800** | the draw is the p90 worst case, and `agent.md`'s "the LIMITS are the whole of it" is true |
 * | 3 | — | an ABANDONED venture consumed 28,000 of a 30,000 mandate forever, at zero cost to the delegate | released, journalled, and audited by INV-22 |
 * | 4 | — | five grants, four carrying `create`, and every delegated `create` refused naming the fifth | selection consults the verb; an explicit `grant` is honoured |
 * | 5 | **§11B** | five live grants worth 160,000 of `max_direct_loss`, EXPOSURE **0**, and two Levy rules billing off it | EXPOSURE is Σ open `max_direct_loss` over locks **and grants** |
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { FREEZE_TICKS, TICKS_PER_RECKONING, setSpeed } from '../../src/core/time.js';
import type { GameEvent, GrantId, PrincipalId, SystemId, VentureId } from '../../src/core/types.js';
import { storesAccount } from '../../src/ledger/index.js';
import { allRoleIndices, electiveTotal, escrowRequired, type VentureRecord } from '../../src/venture/index.js';
import { slotClaimAt } from '../../src/observe/forecast.js';
import { commonsSystems } from '../../src/world/index.js';
import { Runtime, type PendingCorrection } from '../../src/sim/runtime.js';

const SETTLE_TICK = TICKS_PER_RECKONING - 1;

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
  const grantor = 'p:da-grantor' as PrincipalId;
  const delegate = 'p:da-delegate' as PrincipalId;
  const fillers = ['p:da-f1', 'p:da-f2', 'p:da-f3', 'p:da-f4'] as PrincipalId[];
  for (const [i, p] of [grantor, delegate, ...fillers].entries()) {
    runtime.seat(p, `h${String(i)}`, stage);
    runtime.standing.open(p);
  }
  return { runtime, grantor, delegate, fillers, stage };
}

function submit(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  params: Readonly<Record<string, unknown>>,
  sequence = 0,
): void {
  const outcome = runtime.engine.submit({
    principal,
    verb,
    params,
    clientSequence: sequence,
    arrivalMs: sequence,
    decisionSource: 'LIVE',
  });
  if (!outcome.ok) throw new Error(`submit ${verb}: ${outcome.invariant} ${outcome.hint}`);
}

function runTick(runtime: Runtime): void {
  const report = runtime.runTick();
  if (report.halted) {
    throw new Error(
      `halted at tick ${String(report.tick)}: ${report.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`,
    );
  }
}

function act(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  params: Readonly<Record<string, unknown>>,
): PendingCorrection | null {
  submit(runtime, principal, verb, params);
  runTick(runtime);
  return runtime.takeCorrections(principal)[0] ?? null;
}

function issueGrant(
  w: World,
  args: { readonly template: string; readonly direct: number; readonly contingent: number },
): GrantId {
  const before = new Set(w.runtime.grants.forGrantor(w.grantor).map((g) => g.id));
  expect(
    act(w.runtime, w.grantor, 'grant', {
      delegate: w.delegate,
      template: args.template,
      max_direct_loss: args.direct,
      max_contingent_liability: args.contingent,
      expires_tick: SETTLE_TICK + 20,
    }),
  ).toBeNull();
  const fresh = w.runtime.grants.forGrantor(w.grantor).find((g) => !before.has(g.id));
  if (fresh === undefined) throw new Error('the grant did not land');
  return fresh.id;
}

function delegatedCreate(w: World, params: Readonly<Record<string, unknown>>): PendingCorrection | null {
  return act(w.runtime, w.delegate, 'create', { on_behalf_of: w.grantor, stage: w.stage, ...params });
}

/**
 * The engine's own exact worst case for the elective half, summed over the roles — recomputed here
 * through `slotClaimAt`, which is a **different code path** from the `venture/preview.ts` function
 * the gate calls. Two roads to one number is the property §7.1 cares about.
 */
function p90ElectiveCeiling(v: VentureRecord): number {
  let total = 0;
  for (const i of allRoleIndices(v)) total += slotClaimAt(v, i, 'p90').electiveDue;
  return total;
}

/**
 * Every `venture.default` row a **third party with no key** can read, from the spectator feed.
 *
 * `spectatorFeed` takes no principal argument, which is the structural reason a viewer cannot be
 * handed a fact no agent has — so this is the honest reading of "public state alone".
 */
function publicDefaults(w: World): readonly GameEvent[] {
  return w.runtime.events
    .spectatorFeed({ after: null, atTick: w.runtime.engine.tick, limit: 500 })
    .views.map((v) => v.event)
    .filter((e) => e.kind === 'venture.default');
}

function idleHandOf(w: World, p: PrincipalId): string {
  const hand = [...w.runtime.world.hands.values()].find((h) => h.principal === p && h.state === 'IDLE');
  if (hand === undefined) throw new Error(`${p} has no idle hand`);
  return hand.id;
}

/** Fill, sign and activate a venture, then run to settlement with nobody electing anything. */
function runToDefault(w: World, ventureId: VentureId): void {
  const v = w.runtime.ventures.require(ventureId);
  const others = w.fillers.slice(0, v.roles.length);
  for (const [i, filler] of others.entries()) {
    submit(w.runtime, filler, 'fill_role', { venture: ventureId, role: i, hand: idleHandOf(w, filler) }, i);
  }
  runTick(w.runtime);
  const hash = w.runtime.ventures.require(ventureId).termsHash;
  if (hash === null) throw new Error('no terms_hash');
  // The creator signs only when NO grant stood in for it. That asymmetry is the whole of
  // `GRANT_IS_CONSENT`, so the helper has to respect it rather than sign twice: a delegated venture
  // already has the creator in `countersigned` and `sign` would be a wasted action.
  const signers = v.actedBy === null ? [v.creator, ...others] : [...others];
  for (const [i, p] of signers.entries()) {
    submit(w.runtime, p, 'sign', { venture: ventureId, terms_hash: hash }, i);
  }
  runTick(w.runtime);
  runTick(w.runtime);
  expect(w.runtime.ventures.require(ventureId).state).toBe('LIVE');
  while (w.runtime.engine.tick <= SETTLE_TICK) runTick(w.runtime);
}

// ── DEFECT 1 — ★ A5′: the permanent public record names the principal that acted ──

describe('DEFECT 1 — A5′: the record names BOTH principals, from public state alone', () => {
  it('a delegated venture that DEFAULTS is attributable to the delegate with no private state', () => {
    const w = world('d1');
    const grant = issueGrant(w, { template: 'steward', direct: 5_000_000, contingent: 5_000_000 });
    expect(delegatedCreate(w, { kind: 'HAUL', value: 8_000 })).toBeNull();
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('no venture');
    // The row itself, before anything settles: one home for "who acted".
    expect(v.actedBy).toBe(w.delegate);
    expect(v.boundByGrant).toBe(grant);
    runToDefault(w, v.id);

    const settlement = w.runtime.lastReckoning?.settlements.find((s) => s.venture === v.id);
    if (settlement === undefined) throw new Error('the venture never settled');
    expect(settlement.terminalState).toBe('DEFAULTED');
    expect(settlement.defaults.length).toBeGreaterThan(0);

    // The default itself. `payer` is unchanged — the grantor really is liable, that is what the
    // grant meant — and `actedBy` is the second half of the sentence.
    for (const d of settlement.defaults) {
      expect(d.payer).toBe(w.grantor);
      expect(d.actedBy).toBe(w.delegate);
      expect(d.boundByGrant).toBe(grant);
    }
    // The standing delta, which is the number other agents read to decide who to trust.
    for (const s of settlement.standing) {
      expect(s.principal).toBe(w.grantor);
      expect(s.actedBy).toBe(w.delegate);
      expect(s.boundByGrant).toBe(grant);
    }

    // ★ PUBLIC STATE. `spectatorFeed` takes no principal argument, so this is what a third party
    // with no key can read — not a private observation, and not a join through the grant table.
    const rows = publicDefaults(w);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // The two INDEXED columns the schema says the A6 replay joins on. INV-17 has always accepted
      // this pair — `actor` need not be the promisor provided `on_behalf_of` is — and nothing had
      // ever filled it.
      expect(row.actorPrincipalId).toBe(w.delegate);
      expect(row.onBehalfOfPrincipalId).toBe(w.grantor);
      expect(row.grantId).toBe(grant);
      // And the payload, for a reader that has the row and not the schema.
      expect(row.payload['payer']).toBe(w.grantor);
      expect(row.payload['actedBy']).toBe(w.delegate);
      expect(row.payload['boundByGrant']).toBe(grant);
      expect(String(row.payload['boundNote'])).toContain(w.delegate);
    }
    // The settled row carries it too — that is the row the probe quoted and found naming only the
    // victim.
    const settled = w.runtime.events
      .spectatorFeed({ after: null, atTick: w.runtime.engine.tick, limit: 500 })
      .views.map((x) => x.event)
      .filter((e) => e.kind === 'venture.settled' && e.payload['venture'] === v.id);
    expect(settled).toHaveLength(1);
    expect(settled[0]?.payload['creator']).toBe(w.grantor);
    expect(settled[0]?.payload['actedBy']).toBe(w.delegate);
  }, 30_000);

  it('a SELF-created venture names nobody, so the field is not stuck on', () => {
    // The mutation that matters most: a field that always names somebody would libel every solo
    // creator as somebody else's puppet, which is A5′ in the opposite direction.
    const w = world('d1-self');
    expect(act(w.runtime, w.grantor, 'create', { kind: 'HAUL', value: 8_000, stage: w.stage })).toBeNull();
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('no venture');
    expect(v.actedBy).toBeNull();
    expect(v.boundByGrant).toBeNull();
    runToDefault(w, v.id);
    for (const d of w.runtime.lastReckoning?.settlements.find((s) => s.venture === v.id)?.defaults ?? []) {
      expect(d.actedBy).toBeNull();
      expect(d.boundByGrant).toBeNull();
    }
    for (const row of publicDefaults(w)) {
      expect(row.actorPrincipalId).toBe(w.grantor);
      expect(row.onBehalfOfPrincipalId).toBeNull();
      expect(row.grantId).toBeNull();
      expect(row.payload['actedBy']).toBeUndefined();
    }
  }, 30_000);

  it('survives the capture/restore round trip: the actor is inside `state_hash`', () => {
    // Not captured, a rollback rebuilds the venture with a grant and no actor — and since
    // `createVenture` refuses that pair, the restore fails LOUDLY rather than quietly producing an
    // under-attributed record. Asserted both ways round.
    const w = world('d1-capture');
    const grant = issueGrant(w, { template: 'steward', direct: 5_000_000, contingent: 5_000_000 });
    expect(delegatedCreate(w, { kind: 'HAUL', value: 8_000 })).toBeNull();
    const before = w.runtime.engine.stateHash;
    const table = w.runtime.engine.stateTables.find((t) => t.name === 'venture');
    if (table?.restore === undefined) throw new Error('no restorable venture state table');
    table.restore(table.capture());
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    expect(v?.actedBy).toBe(w.delegate);
    expect(v?.boundByGrant).toBe(grant);
    expect(w.runtime.engine.stateHash).toBe(before);
  });
});

// ── DEFECT 2 — ★ A7: the draw is the worst case the grantor can be billed ────

describe('DEFECT 2 — A7: the contingent draw is the worst case, not the p50', () => {
  it('a HAUL at value 8000 charges the 7800 it can be billed, not the 2000 it is priced at', () => {
    const w = world('d2');
    const id = issueGrant(w, { template: 'steward', direct: 5_000_000, contingent: 30_000 });
    expect(delegatedCreate(w, { kind: 'HAUL', value: 8_000, elective_bps: 2_500 })).toBeNull();
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('no venture');

    expect(escrowRequired(v)).toBe(6_000);
    // The PRICE is unchanged — the parties still agreed 2,000 of unsecured tail.
    expect(electiveTotal(v)).toBe(2_000);
    // The BOUND is what the mandate is charged, recomputed here off `slotClaimAt`.
    expect(p90ElectiveCeiling(v)).toBe(7_800);
    expect(w.runtime.grants.get(id)?.spentContingent).toBe(p90ElectiveCeiling(v));
    expect(w.runtime.grants.get(id)?.spentContingent).toBe(7_800);
    // The 3.9× the probe measured, now on the right side of the comparison.
    expect(p90ElectiveCeiling(v)).toBeGreaterThan(electiveTotal(v) * 3);
  });

  it('a grantor that caps contingent liability at 2000 CANNOT be bound to 7800', () => {
    // The probe's sentence, as an assertion: *"a grantor that caps contingent liability at 2,000
    // believing that bounds its downside can be bound to 7,800."* It cannot now.
    const w = world('d2-cap');
    const id = issueGrant(w, { template: 'steward', direct: 5_000_000, contingent: 2_000 });
    const refusal = delegatedCreate(w, { kind: 'HAUL', value: 8_000, elective_bps: 2_500 });
    expect(refusal?.invariant).toBe('INV-22');
    expect(refusal?.hint).toContain('7800');
    expect(refusal?.hint).toContain('contingent headroom of 2000');
    expect(w.runtime.ventures.forPrincipal(w.grantor)).toHaveLength(0);
    expect(w.runtime.grants.get(id)?.spentContingent).toBe(0);
  });

  it('`create` and `elect` now charge ONE arithmetic, and the venture is not charged twice', () => {
    // Both verbs read the same p90 ceiling since this change, so a `steward` used for both used to
    // consume the bound twice for one liability — and a mandate sized for one venture would have
    // refused the very `elect` that keeps its promise. Forcing a default out of an authority limit
    // is the engine manufacturing a breach (A5′).
    const w = world('d2-both');
    const probe = world('d2-both-probe');
    issueGrant(probe, { template: 'steward', direct: 5_000_000, contingent: 5_000_000 });
    expect(delegatedCreate(probe, { kind: 'HAUL', value: 8_000 })).toBeNull();
    const pv = probe.runtime.ventures.forPrincipal(probe.grantor)[0];
    if (pv === undefined) throw new Error('no probe venture');
    const bound = p90ElectiveCeiling(pv);

    // A mandate that authorises EXACTLY one venture's worst case, and nothing more.
    const id = issueGrant(w, { template: 'steward', direct: 5_000_000, contingent: bound });
    expect(delegatedCreate(w, { kind: 'HAUL', value: 8_000 })).toBeNull();
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('no venture');
    expect(w.runtime.grants.headroom(id).contingent).toBe(0);

    // Fill and sign so there is something to elect on.
    for (const [i, filler] of w.fillers.slice(0, v.roles.length).entries()) {
      submit(w.runtime, filler, 'fill_role', { venture: v.id, role: i, hand: idleHandOf(w, filler) }, i);
    }
    runTick(w.runtime);
    const hash = w.runtime.ventures.require(v.id).termsHash;
    if (hash === null) throw new Error('no terms_hash');
    for (const [i, p] of w.fillers.slice(0, v.roles.length).entries()) {
      submit(w.runtime, p, 'sign', { venture: v.id, terms_hash: hash }, i);
    }
    runTick(w.runtime);
    runTick(w.runtime);

    // ★ The delegate can still elect IN_FULL on the grantor's behalf with zero headroom left,
    // because the liability was charged once. This is the assertion that would fail if the two
    // verbs double-charged.
    expect(act(w.runtime, w.delegate, 'elect', { venture: v.id, role: 0, election: 'IN_FULL' })).toBeNull();
    expect(w.runtime.grants.get(id)?.spentContingent).toBe(bound);
  });
});

// ── DEFECT 3 — a retired venture returns its draw ────────────────────────────

describe('DEFECT 3 — an ABANDONED venture gives the grantor’s budget back', () => {
  it('abandon releases the whole draw, and a later create that was refused now lands', () => {
    const w = world('d3');
    const id = issueGrant(w, { template: 'steward', direct: 5_000_000, contingent: 50_000 });
    expect(delegatedCreate(w, { kind: 'BUILD', value: 28_000 })).toBeNull();
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('no venture');
    const drawn = w.runtime.grants.get(id)?.spentContingent ?? 0;
    expect(drawn).toBe(p90ElectiveCeiling(v));
    expect(drawn).toBeGreaterThan(0);
    // A second one has nowhere to go: the whole budget is committed.
    expect(delegatedCreate(w, { kind: 'BUILD', value: 28_000 })?.invariant).toBe('INV-22');

    expect(act(w.runtime, w.grantor, 'abandon', { venture: v.id })).toBeNull();
    expect(w.runtime.ventures.require(v.id).state).toBe('ABANDONED');
    // ★ The draw came back, journalled, with a cause.
    expect(w.runtime.grants.get(id)?.spentContingent).toBe(0);
    expect(w.runtime.grants.get(id)?.spentDirect).toBe(0);
    expect(w.runtime.grants.headroom(id).contingent).toBe(50_000);
    const releases = w.runtime.grants.allReleases();
    expect(releases).toHaveLength(1);
    expect(releases[0]?.cause).toBe('ABANDONED');
    expect(releases[0]?.delegate).toBe(w.delegate);
    expect(releases[0]?.contingent).toBe(drawn);

    // And the authority the delegate got back is REAL: the create that was just refused now lands.
    expect(delegatedCreate(w, { kind: 'BUILD', value: 28_000 })).toBeNull();
  });

  it('a formation window that closes unfilled releases it too — the other retirement path', () => {
    const w = world('d3-window');
    const id = issueGrant(w, { template: 'steward', direct: 5_000_000, contingent: 50_000 });
    expect(delegatedCreate(w, { kind: 'BUILD', value: 28_000 })).toBeNull();
    expect(w.runtime.grants.get(id)?.spentContingent).toBeGreaterThan(0);
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('no venture');
    while (w.runtime.ventures.require(v.id).state === 'FORMING') runTick(w.runtime);
    expect(w.runtime.ventures.require(v.id).state).toBe('ABANDONED');
    expect(w.runtime.grants.get(id)?.spentContingent).toBe(0);
    expect(w.runtime.grants.allReleases()).toHaveLength(1);
  });

  it('a SETTLED venture keeps its draw — the limit is a lifetime bound, not a concurrent one', () => {
    // The over-release direction. Releasing at settlement would turn `max_contingent_liability`
    // into a different promise from the one the grantor read, so it deliberately does not.
    const w = world('d3-settled');
    const id = issueGrant(w, { template: 'steward', direct: 5_000_000, contingent: 5_000_000 });
    expect(delegatedCreate(w, { kind: 'HAUL', value: 8_000 })).toBeNull();
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('no venture');
    const drawn = w.runtime.grants.get(id)?.spentContingent ?? 0;
    runToDefault(w, v.id);
    expect(w.runtime.ventures.require(v.id).state).toBe('DEFAULTED');
    expect(w.runtime.grants.get(id)?.spentContingent).toBe(drawn);
    expect(w.runtime.grants.allReleases()).toHaveLength(0);
  }, 30_000);

  it('the release journal is inside the capture, so a rollback cannot forget a give-back', () => {
    const w = world('d3-capture');
    const id = issueGrant(w, { template: 'steward', direct: 5_000_000, contingent: 50_000 });
    expect(delegatedCreate(w, { kind: 'BUILD', value: 28_000 })).toBeNull();
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('no venture');
    expect(act(w.runtime, w.grantor, 'abandon', { venture: v.id })).toBeNull();
    const before = w.runtime.engine.stateHash;
    const table = w.runtime.engine.stateTables.find((t) => t.name === 'grant');
    if (table?.restore === undefined) throw new Error('no restorable grant state table');
    table.restore(table.capture());
    expect(w.runtime.grants.allReleases()).toHaveLength(1);
    expect(w.runtime.grants.get(id)?.spentContingent).toBe(0);
    expect(w.runtime.engine.stateHash).toBe(before);
  });
});

// ── DEFECT 4 — selection consults the verb, and honours an explicit `grant` ──

describe('DEFECT 4 — a narrow first grant no longer shadows every later one', () => {
  it('picks a grant that carries `create`, whatever order they were issued in', () => {
    const w = world('d4');
    const narrow = issueGrant(w, { template: 'treasury-hand', direct: 40_000, contingent: 40_000 });
    const wide = issueGrant(w, { template: 'quartermaster', direct: 40_000, contingent: 40_000 });
    expect(w.runtime.grants.forDelegate(w.delegate)).toHaveLength(2);

    expect(delegatedCreate(w, { kind: 'HAUL', value: 8_000 })).toBeNull();
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    expect(v?.boundByGrant).toBe(wide);
    // The treasury-hand was not touched, because it does not carry the verb.
    expect(w.runtime.grants.get(narrow)?.spentDirect).toBe(0);
    expect(w.runtime.grants.get(narrow)?.spentContingent).toBe(0);
  });

  it('honours an explicit `grant`, and refuses one that does not carry the verb by name', () => {
    const w = world('d4-named');
    const narrow = issueGrant(w, { template: 'treasury-hand', direct: 40_000, contingent: 40_000 });
    const a = issueGrant(w, { template: 'quartermaster', direct: 40_000, contingent: 40_000 });
    const b = issueGrant(w, { template: 'steward', direct: 90_000, contingent: 90_000 });

    // Left to the engine, the WIDEST that carries the verb wins — so `b`, not `a`.
    expect(delegatedCreate(w, { kind: 'HAUL', value: 8_000 })).toBeNull();
    expect(w.runtime.ventures.forPrincipal(w.grantor)[0]?.boundByGrant).toBe(b);

    // Named explicitly, the narrower one is used — the param is read, not overridden.
    expect(delegatedCreate(w, { grant: a, kind: 'DIG', value: 4_000 })).toBeNull();
    const dug = w.runtime.ventures.forPrincipal(w.grantor).find((v) => v.kind === 'DIG');
    expect(dug?.boundByGrant).toBe(a);

    // And naming one that cannot carry the verb is REFUSED, naming the ones that can.
    const refusal = delegatedCreate(w, { grant: narrow, kind: 'DIG', value: 4_000 });
    expect(refusal?.invariant).toBe('INV-22');
    expect(refusal?.hint).toContain(narrow);
    expect(refusal?.hint).toContain(a);
    expect(refusal?.hint).toContain(b);
  });

  it('when NOTHING carries the verb the refusal names every grant held and the offices to ask for', () => {
    const w = world('d4-none');
    const one = issueGrant(w, { template: 'treasury-hand', direct: 40_000, contingent: 40_000 });
    const two = issueGrant(w, { template: 'treasury-hand', direct: 50_000, contingent: 50_000 });
    const refusal = delegatedCreate(w, { kind: 'HAUL', value: 8_000 });
    expect(refusal?.invariant).toBe('INV-22');
    expect(refusal?.hint).toContain('none of the 2 live grant(s)');
    expect(refusal?.hint).toContain(one);
    expect(refusal?.hint).toContain(two);
    expect(refusal?.hint).toContain('quartermaster');
    expect(refusal?.hint).toContain('steward');
  });

  it('`elect` picks by verb too — the same defect wore the other verb', () => {
    const w = world('d4-elect');
    const wrong = issueGrant(w, { template: 'quartermaster', direct: 900_000, contingent: 900_000 });
    const right = issueGrant(w, { template: 'treasury-hand', direct: 40_000, contingent: 40_000 });
    // The grantor creates a venture of its own so there is something to elect on, and fills it.
    expect(act(w.runtime, w.grantor, 'create', { kind: 'HAUL', value: 8_000, stage: w.stage })).toBeNull();
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('no venture');
    for (const [i, filler] of w.fillers.slice(0, v.roles.length).entries()) {
      submit(w.runtime, filler, 'fill_role', { venture: v.id, role: i, hand: idleHandOf(w, filler) }, i);
    }
    runTick(w.runtime);
    const hash = w.runtime.ventures.require(v.id).termsHash;
    if (hash === null) throw new Error('no terms_hash');
    for (const [i, p] of [w.grantor, ...w.fillers.slice(0, v.roles.length)].entries()) {
      submit(w.runtime, p, 'sign', { venture: v.id, terms_hash: hash }, i);
    }
    runTick(w.runtime);
    runTick(w.runtime);

    // The quartermaster has 22× the headroom, so the old rule picked it and refused.
    expect(act(w.runtime, w.delegate, 'elect', { venture: v.id, role: 0, election: 1_000 })).toBeNull();
    expect(w.runtime.grants.get(right)?.spentDirect).toBe(1_000);
    expect(w.runtime.grants.get(wrong)?.spentDirect).toBe(0);
  });
});

// ── DEFECT 5 — ★ §11B: EXPOSURE includes the authority you have handed out ──

describe('DEFECT 5 — EXPOSURE is Σ open max_direct_loss, and a grant carries one', () => {
  it('five live grants of 32000 register as 160000 of EXPOSURE, and the Levy bills off it', () => {
    const w = world('d5');
    let granted = 0;
    for (let n = 0; n < 5; n += 1) {
      issueGrant(w, { template: 'steward', direct: 32_000, contingent: 32_000 });
      granted += 32_000;
    }
    expect(granted).toBe(160_000);
    expect(w.runtime.grants.forGrantor(w.grantor)).toHaveLength(5);

    // The encumbrance term is still zero — a grant opens no lock — and that is exactly why the sum
    // had to grow a second term rather than the lock table growing a fake row.
    expect(w.runtime.ledger.encumbrances.cachedExposure(w.grantor)).toBe(0);
    expect(w.runtime.exposureOf(w.grantor)).toBe(granted);

    while (w.runtime.engine.tick < TICKS_PER_RECKONING - FREEZE_TICKS) runTick(w.runtime);
    // ★ The Levy's high-water mark, which two of its four allocation rules read.
    expect(w.runtime.levy.exposurePeakOf(0, w.grantor)).toBe(granted);
    expect(w.runtime.levySubjectOf(w.grantor).exposurePeak).toBe(granted);
    // The delegate carries none of it: `max_direct_loss` bounds the GRANTOR's loss.
    expect(w.runtime.exposureOf(w.delegate)).toBe(0);
    expect(w.runtime.ledger.freeBalance(storesAccount(w.grantor))).toBeGreaterThan(0);
  }, 30_000);

  it('revoking a grant lowers it, so hiding is not free and the figure is not stuck on', () => {
    // The mutation. A term that only ever grew would be a tax on having ever delegated, and a term
    // that never grew would be the defect. Revocation takes effect the NEXT tick (§8.1 #6).
    const w = world('d5-revoke');
    const id = issueGrant(w, { template: 'steward', direct: 32_000, contingent: 32_000 });
    expect(w.runtime.exposureOf(w.grantor)).toBe(32_000);
    expect(act(w.runtime, w.grantor, 'revoke', { grant: id })).toBeNull();
    runTick(w.runtime);
    expect(w.runtime.exposureOf(w.grantor)).toBe(0);
  });

  it('the CAP is what counts, not the draw — an unused wide mandate is not a hiding place', () => {
    const w = world('d5-cap');
    issueGrant(w, { template: 'steward', direct: 900_000, contingent: 900_000 });
    // Nothing drawn at all.
    expect(w.runtime.grants.allSpends()).toHaveLength(0);
    expect(w.runtime.exposureOf(w.grantor)).toBe(900_000);
  });
});
