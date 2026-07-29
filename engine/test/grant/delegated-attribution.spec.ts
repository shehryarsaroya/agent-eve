/**
 * REPRODUCTION — the five defects a blind probe found by running a full betrayal through the
 * front door with two identities. This file's first revision asserted the BROKEN behaviour and
 * was run green; the numbers in each `it` name are the ones it printed.
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
  args: {
    readonly template: string;
    readonly direct: number;
    readonly contingent: number;
  },
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

/** The engine's own exact worst case for the elective half, summed over the roles. */
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
  for (const [i, p] of others.entries()) {
    submit(w.runtime, p, 'sign', { venture: ventureId, terms_hash: hash }, i);
  }
  runTick(w.runtime);
  runTick(w.runtime);
  expect(w.runtime.ventures.require(ventureId).state).toBe('LIVE');
  while (w.runtime.engine.tick <= SETTLE_TICK) runTick(w.runtime);
}

// ── DEFECT 1 — the permanent public record names the wrong principal ─────────

describe('DEFECT 1 — A5′: the record names the grantor and never the delegate', () => {
  it('a delegated venture that DEFAULTS carries no field naming the principal that acted', () => {
    const w = world('d1');
    issueGrant(w, { template: 'steward', direct: 5_000_000, contingent: 5_000_000 });
    expect(delegatedCreate(w, { kind: 'HAUL', value: 8_000 })).toBeNull();
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('no venture');
    runToDefault(w, v.id);

    const settlement = w.runtime.lastReckoning?.settlements.find((s) => s.venture === v.id);
    if (settlement === undefined) throw new Error('the venture never settled');
    expect(settlement.terminalState).toBe('DEFAULTED');
    expect(settlement.defaults.length).toBeGreaterThan(0);

    // THE DEFECT: every default names the grantor as payer and nothing anywhere on the row,
    // the standing delta, or the published event names `p:da-delegate`.
    for (const d of settlement.defaults) {
      expect(d.payer).toBe(w.grantor);
      expect(Object.keys(d)).not.toContain('actedBy');
    }
    for (const s of settlement.standing) {
      expect(s.principal).toBe(w.grantor);
      expect(Object.keys(s)).not.toContain('actedBy');
    }
    // ★ PUBLIC STATE, not a private observation: the spectator feed takes no principal
    // argument, so what it shows is what any third party can read.
    const rows = publicDefaults(w);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.actorPrincipalId).toBe(w.grantor);
      expect(row.grantId).toBeNull();
      expect(row.onBehalfOfPrincipalId).toBeNull();
      expect(JSON.stringify(row.payload)).not.toContain(w.delegate);
    }
    // And `VentureRecord` has no field for it at all.
    expect(Object.keys(w.runtime.ventures.require(v.id))).not.toContain('actedBy');
  }, 30_000);
});

// ── DEFECT 2 — the preview undercounts the grantor's bill ────────────────────

describe('DEFECT 2 — A7: the contingent draw is the p50, the bill is the p90', () => {
  it('a HAUL at value 8000 with elective_bps 2500 charges 2000 against a payable of 7800', () => {
    const w = world('d2');
    const id = issueGrant(w, { template: 'steward', direct: 5_000_000, contingent: 30_000 });
    expect(delegatedCreate(w, { kind: 'HAUL', value: 8_000, elective_bps: 2_500 })).toBeNull();
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('no venture');

    expect(escrowRequired(v)).toBe(6_000);
    expect(electiveTotal(v)).toBe(2_000);
    expect(w.runtime.grants.get(id)?.spentContingent).toBe(2_000);
    // The engine's own exact ceiling, from the same roles, at the same moment.
    expect(p90ElectiveCeiling(v)).toBe(7_800);
    expect(w.runtime.grants.get(id)?.spentContingent).toBeLessThan(p90ElectiveCeiling(v));
  });

  it('`elect` already charges the p90 ceiling for the same obligation — the two verbs disagree', () => {
    const w = world('d2-elect');
    const id = issueGrant(w, { template: 'steward', direct: 5_000_000, contingent: 5_000_000 });
    expect(delegatedCreate(w, { kind: 'HAUL', value: 8_000, elective_bps: 2_500 })).toBeNull();
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('no venture');
    const drawnByCreate = w.runtime.grants.get(id)?.spentContingent ?? 0;
    expect(drawnByCreate).toBe(2_000);
    // The same venture's role 0, priced by `electiveCeilingOf` — the p90 reading.
    expect(w.runtime.electiveCeilingOf(v, 0)).toBe(5_460);
    expect(w.runtime.electiveCeilingOf(v, 1)).toBe(2_340);
  });
});

// ── DEFECT 3 — an abandoned venture never returns its contingent draw ────────

describe('DEFECT 3 — a retired venture keeps the grantor’s budget forever', () => {
  it('abandon leaves spent_contingent at its full draw and headroom at zero', () => {
    const w = world('d3');
    const id = issueGrant(w, { template: 'steward', direct: 5_000_000, contingent: 30_000 });
    expect(delegatedCreate(w, { kind: 'BUILD', value: 28_000 })).toBeNull();
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('no venture');
    const drawn = w.runtime.grants.get(id)?.spentContingent ?? 0;
    expect(drawn).toBe(28_000);
    expect(w.runtime.grants.headroom(id).contingent).toBe(2_000);

    expect(act(w.runtime, w.grantor, 'abandon', { venture: v.id })).toBeNull();
    expect(w.runtime.ventures.require(v.id).state).toBe('ABANDONED');
    // THE DEFECT: nothing came back. 28 000 of a 30 000 budget is gone on a venture that
    // never bound anybody, at zero cost to the delegate.
    expect(w.runtime.grants.get(id)?.spentContingent).toBe(28_000);
    expect(w.runtime.grants.headroom(id).contingent).toBe(2_000);
  });
});

// ── DEFECT 4 — grant selection ignores the verb and an explicit `grant` ──────

describe('DEFECT 4 — the oldest grant wins, whatever it carries', () => {
  it('a narrow first grant makes every later, wider grant unusable', () => {
    const w = world('d4');
    const narrow = issueGrant(w, { template: 'treasury-hand', direct: 40_000, contingent: 40_000 });
    const wide = issueGrant(w, { template: 'quartermaster', direct: 40_000, contingent: 40_000 });
    expect(w.runtime.grants.forDelegate(w.delegate)).toHaveLength(2);

    const refusal = delegatedCreate(w, { kind: 'HAUL', value: 8_000 });
    expect(refusal?.invariant).toBe('INV-22');
    expect(refusal?.hint).toContain(narrow);
    expect(refusal?.hint).toContain('treasury-hand');

    // And naming the grant that DOES carry `create` is silently ignored.
    const named = act(w.runtime, w.delegate, 'create', {
      on_behalf_of: w.grantor,
      stage: w.stage,
      grant: wide,
      kind: 'HAUL',
      value: 8_000,
    });
    expect(named?.invariant).toBe('INV-22');
    expect(named?.hint).toContain(narrow);
  });
});

// ── DEFECT 5 — EXPOSURE never sees a grant ───────────────────────────────────

describe('DEFECT 5 — a principal loaded up by its delegate registers as unexposed', () => {
  it('five open grants of 32 000 max_direct_loss each leave EXPOSURE at 0', () => {
    const w = world('d5');
    let granted = 0;
    for (let n = 0; n < 5; n += 1) {
      issueGrant(w, { template: 'steward', direct: 32_000, contingent: 32_000 });
      granted += 32_000;
    }
    expect(granted).toBe(160_000);
    expect(w.runtime.grants.forGrantor(w.grantor)).toHaveLength(5);
    // THE DEFECT: §11B says EXPOSURE is Σ your open `max_direct_loss`.
    expect(w.runtime.ledger.encumbrances.cachedExposure(w.grantor)).toBe(0);
    while (w.runtime.engine.tick < TICKS_PER_RECKONING - FREEZE_TICKS) runTick(w.runtime);
    expect(w.runtime.levy.exposurePeakOf(0, w.grantor)).toBe(0);
    expect(w.runtime.levySubjectOf(w.grantor).exposurePeak).toBe(0);
    expect(w.runtime.ledger.freeBalance(storesAccount(w.grantor))).toBeGreaterThan(0);
  }, 30_000);
});
