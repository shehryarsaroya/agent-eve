/**
 * **`create` TAKES AN ESCROW/ELECTIVE PROPORTION, WITH A FLOOR** (A7, §7.5, `D22` finding 4).
 *
 * ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
 *
 * Every venture in the world was priced at exactly `f(kind)` elective and the rest escrowed, because
 * there was one pricer and it took no proportion. So *"the elective half is a real choice, every
 * time"* — `agent.md`'s own sentence about the most important rule in the game — was a fixed tax with
 * a fixed answer. Three blind probes independently reported the consequence: **nothing to negotiate,
 * so nobody negotiated**, and a game whose premise is *"the best decisions are about other agents"*
 * had no lever a decision about another agent could pull.
 *
 * And it was worse than absent. A probe **sent** `elective_bps: 4000` and `roles: 4`; both were
 * silently dropped and it got a 75/25 two-role venture with no correction. That is the
 * `graduate`/`on_behalf_of` failure again: on a verb that shapes a binding commitment, a dropped param
 * does not degrade the request, it changes what the agent is bound to.
 *
 * ── WHAT IS ASSERTED ─────────────────────────────────────────────────────────
 *
 * The proportion is honoured, both floors bite in both directions, the old spellings are refused
 * rather than ignored, the un-escrowable kinds refuse the knob instead of pretending to have one, and
 * the filler can READ the offer on the surface it decides from. Plus the guard `assertKindTable` gained
 * so a future calibration cannot empty the band and silently delete a whole venture kind.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { setSpeed } from '../../src/core/time.js';
import type { PrincipalId, SystemId, VentureKind } from '../../src/core/types.js';
import { BPS_ONE, bps, minor } from '../../src/core/units.js';
import { buildObservation } from '../../src/api/observe.js';
import { OFFERED_KINDS } from '../../src/api/observe.js';
import { HeuristicCast } from '../../src/cast/index.js';
import {
  ELECTIVE_BPS_STATEMENT,
  MIN_ESCROW_BPS,
  VENTURE_KINDS,
  assertKindTable,
  electiveBandProblem,
  electiveFloor,
  escrowRatioBps,
  isEscrowable,
  kindSpec,
  maxElectiveBps,
  minElectiveBps,
  pinnedConsideration,
  readElectiveBps,
  roleTermsFor,
  unhonouredCreateParam,
  validateRoleTerms,
} from '../../src/venture/index.js';
import { commonsSystems } from '../../src/world/index.js';
import { Runtime, type PendingCorrection } from '../../src/sim/runtime.js';

// ── The band itself ──────────────────────────────────────────────────────────

describe('the band every kind publishes', () => {
  it('is non-empty and wider than a point on every escrowable kind', () => {
    // The same claim `assertKindTable` now makes, asserted from outside it as well: the reason a floor
    // pair has to be checked is that raising either one far enough leaves NO legal proportion, and a
    // kind nobody can create is a kind deleted by a calibration with every test still green.
    for (const kind of VENTURE_KINDS) {
      const low = minElectiveBps(kind);
      const high = maxElectiveBps(kind);
      expect(low, `${kind} band is inverted`).toBeLessThanOrEqual(high);
      if (isEscrowable(kind)) {
        expect(high - low, `${kind} has nothing to negotiate`).toBeGreaterThan(0);
        expect(high).toBe(BPS_ONE - MIN_ESCROW_BPS);
      } else {
        // §7.5's law, not a calibration: a top-yield prize is 100% elective and the knob has one setting.
        expect(low).toBe(BPS_ONE);
        expect(high).toBe(BPS_ONE);
      }
    }
    expect(() => assertKindTable()).not.toThrow();
  });

  it('and the guard that keeps it non-empty actually bites', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The real table satisfies this check, so a test that only called `assertKindTable` could not
    // tell the check from its absence — *"a guard no test can bite on is indistinguishable from a
    // clean bill of health"*, which is INV-26's failure verbatim. Verified by mutation: deleting
    // either clause in `electiveBandProblem` fails one of these three.
    // ══════════════════════════════════════════════════════════════════════
    expect(electiveBandProblem({ kind: 'X', low: 8_000, high: 7_500, escrowable: true })).toContain(
      'band is empty',
    );
    expect(electiveBandProblem({ kind: 'X', low: 7_500, high: 7_500, escrowable: true })).toContain(
      'single-point',
    );
    // Except where §7.5 makes it one point by law.
    expect(electiveBandProblem({ kind: 'X', low: BPS_ONE, high: BPS_ONE, escrowable: false })).toBeNull();
    expect(electiveBandProblem({ kind: 'X', low: 2_500, high: 7_500, escrowable: true })).toBeNull();
  });

  it('leaves at least 4000 bps of room on every escrowable kind, which is what "negotiable" means', () => {
    // The number `MIN_ESCROW_BPS`'s own note commits to. If a future `f(kind)` rise ate the band down
    // to a few hundred bps the table would still be legal and the mechanic would be decorative.
    for (const kind of VENTURE_KINDS.filter(isEscrowable)) {
      expect(maxElectiveBps(kind) - minElectiveBps(kind), `${kind} band is too narrow to negotiate in`)
        .toBeGreaterThanOrEqual(4_000);
    }
  });
});

// ── The pricer ───────────────────────────────────────────────────────────────

describe('roleTermsFor prices what was asked for, and never below f(kind)', () => {
  it('a higher elective_bps moves value from escrow to the promise, exactly', () => {
    const at = (electiveBps: number) => roleTermsFor('HAUL', minor(12_000), bps(electiveBps));
    const low = at(2_500);
    const high = at(7_500);
    // The pinned total is the same deal either way — only how much of it is guaranteed moves.
    expect(low.map(pinnedConsideration)).toEqual(high.map(pinnedConsideration));
    for (const [i, l] of low.entries()) {
      const h = high[i];
      if (h === undefined) throw new Error('role count changed');
      expect(h.elective, `role ${String(i)} elective did not rise`).toBeGreaterThan(l.elective);
      expect(h.escrowed, `role ${String(i)} escrow did not fall`).toBeLessThan(l.escrowed);
      expect(escrowRatioBps(l)).toBe(7_500);
      expect(escrowRatioBps(h)).toBe(2_500);
    }
  });

  it('every proportion in the band produces terms the validator accepts', () => {
    // The pricer and the validator are two implementations of one rule, which is exactly where scar #1
    // lives. Swept rather than sampled at one point.
    for (const kind of VENTURE_KINDS) {
      const top: number = maxElectiveBps(kind);
      for (let e: number = minElectiveBps(kind); e <= top; e += 250) {
        for (const terms of roleTermsFor(kind, minor(kindSpec(kind).baseYieldMinor), bps(e))) {
          const check = validateRoleTerms(kind, terms);
          expect(check.ok, check.ok ? '' : `${kind} at ${String(e)} bps: ${check.invariant} ${check.hint}`).toBe(true);
        }
      }
    }
  });

  it('f(kind) wins where the ABSOLUTE floor bites, and the elective part rounds up not down', () => {
    // `electiveFloor` has a proportional term and an absolute one, and on a tiny role the absolute one
    // dominates. PROP-V5 is a rule and `elective_bps` is an offer, so the rule wins — stated here so
    // the precedence is a test rather than a comment.
    const tiny = roleTermsFor('HAUL', minor(120), bps(2_500));
    for (const t of tiny) {
      const priced = pinnedConsideration(t);
      expect(t.elective).toBeGreaterThanOrEqual(electiveFloor('HAUL', priced));
    }
    // Rounding: 2,501 bps of 100 is 25.01, and the unsecured half is never understated.
    const rounded = roleTermsFor('DIG', minor(1_000), bps(2_501));
    for (const t of rounded) {
      const priced = pinnedConsideration(t);
      expect(t.elective * BPS_ONE).toBeGreaterThanOrEqual(2_501 * priced);
    }
  });

  it('an un-escrowable kind is fully elective at every proportion, because §7.5 says so', () => {
    for (const kind of VENTURE_KINDS.filter((k) => !isEscrowable(k))) {
      for (const t of roleTermsFor(kind, minor(40_000), bps(BPS_ONE))) {
        expect(t.escrowed).toBe(0);
      }
    }
  });
});

// ── Reading the param ────────────────────────────────────────────────────────

describe('readElectiveBps', () => {
  const read = (kind: VentureKind, params: Record<string, unknown>) => readElectiveBps(kind, params);

  it('defaults to f(kind), so a create that says nothing is the venture it always was', () => {
    for (const kind of VENTURE_KINDS) {
      const out = read(kind, {});
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.value).toBe(minElectiveBps(kind));
    }
  });

  it('accepts escrow_bps as the exact complement, and refuses a pair that disagrees', () => {
    const one = read('HAUL', { escrow_bps: 4_000 });
    expect(one.ok).toBe(true);
    if (one.ok) expect(one.value).toBe(6_000);

    const agreeing = read('HAUL', { elective_bps: 6_000, escrow_bps: 4_000 });
    expect(agreeing.ok).toBe(true);

    const clashing = read('HAUL', { elective_bps: 6_000, escrow_bps: 9_000 });
    expect(clashing.ok).toBe(false);
    if (!clashing.ok) {
      expect(clashing.invariant).toBe('PROP-V5');
      expect(clashing.hint).toContain('same number from opposite ends');
    }
  });

  it('refuses below f(kind) and above the escrow floor, naming the band both times', () => {
    const tooSecured = read('HAUL', { elective_bps: 100 });
    expect(tooSecured.ok).toBe(false);
    if (!tooSecured.ok) {
      expect(tooSecured.invariant).toBe('PROP-V5');
      expect(tooSecured.hint).toContain('2500..7500');
      expect(tooSecured.hint).toContain('the only part standing can accrue to');
    }

    const tooOpen = read('HAUL', { elective_bps: 9_900 });
    expect(tooOpen.ok).toBe(false);
    if (!tooOpen.ok) {
      expect(tooOpen.invariant).toBe('PROP-V5');
      expect(tooOpen.hint).toContain('2500..7500');
      // The reason, not just the number: A7's fake counterparty and A15's free identity.
      expect(tooOpen.hint).toContain('walk away');
      expect(tooOpen.hint).toContain('capital rather than reputation');
    }

    // The endpoints themselves are legal — an off-by-one here would silently narrow the band.
    for (const e of [2_500, 7_500]) {
      const out = read('HAUL', { elective_bps: e });
      expect(out.ok, `${String(e)} must be inside the band`).toBe(true);
    }
  });

  it('refuses the knob on an un-escrowable kind rather than pretending it does something', () => {
    const out = read('BUILD', { elective_bps: 4_000 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.hint).toContain('legally un-escrowable');
    // 10000 is the truth about BUILD, so stating it is accepted rather than refused on a technicality.
    expect(read('BUILD', { elective_bps: BPS_ONE }).ok).toBe(true);
  });

  it('refuses nonsense rather than clamping it', () => {
    for (const bad of [-1, BPS_ONE + 1]) {
      const out = read('HAUL', { elective_bps: bad });
      expect(out.ok, `${String(bad)} was accepted`).toBe(false);
    }
  });

  it('refuses a proportion it was SENT and cannot read, instead of falling back to the default', () => {
    // ══════════════════════════════════════════════════════════════════════
    // A defect found by mutating this function rather than by reviewing it. `readInt` returns null
    // for both "absent" and "present and not a safe integer" — the same value for opposite facts —
    // so `elective_bps: 40.5` and `elective_bps: "4000"` both produced a venture priced at the
    // DEFAULT with no correction. That is the same silent drop the parameter exists to fix, one
    // layer inside the fix.
    // ══════════════════════════════════════════════════════════════════════
    for (const bad of [1.5, 40.5, '4000', null, true, {}] as unknown[]) {
      const out = read('HAUL', { elective_bps: bad });
      expect(out.ok, `elective_bps: ${JSON.stringify(bad)} was silently dropped`).toBe(false);
      if (!out.ok) expect(out.hint).toContain('Nothing was created');
    }
    // The same for the complement spelling, or half the door is open.
    expect(read('HAUL', { escrow_bps: 40.5 }).ok).toBe(false);
    // And a genuinely absent proportion is still an absence, not an error.
    expect(read('HAUL', {}).ok).toBe(true);
  });
});

describe('the params a create will not silently drop', () => {
  it('refuses `roles`, because the role count is the whole of PROP-V6', () => {
    const out = unhonouredCreateParam({ roles: 4 });
    expect(out).not.toBeNull();
    expect(out?.invariant).toBe('PROP-V6');
    expect(out?.hint).toContain('fixed by its kind');
    expect(out?.hint).toContain('BUILD and SIEGE');
    expect(out?.hint).toContain('Nothing was created');
  });

  it('refuses `split` and the percentage spellings, and points at elective_bps', () => {
    for (const key of ['split', 'escrow_pct', 'elective_pct']) {
      const out = unhonouredCreateParam({ [key]: 60 });
      expect(out, `${key} was dropped`).not.toBeNull();
      expect(out?.invariant).toBe('PROP-V5');
      expect(out?.hint).toContain('elective_bps');
    }
    // §3: SPLIT is the division of PROCEEDS and may not acquire a second meaning on a rules surface.
    expect(unhonouredCreateParam({ split: 60 })?.hint).toContain('division of proceeds');
  });

  it('lets an ordinary create through untouched', () => {
    expect(unhonouredCreateParam({ kind: 'HAUL', stage: 'sys-01', value: 12_000, elective_bps: 4_000 })).toBeNull();
  });
});

// ── Through the verb, and onto the surfaces a filler reads ───────────────────

interface World {
  readonly runtime: Runtime;
  readonly creator: PrincipalId;
  readonly filler: PrincipalId;
  readonly stage: SystemId;
}

function world(seed: string): World {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const stage = commonsSystems(runtime.world.map)[0];
  if (stage === undefined) throw new Error('the launch map has no Commons system');
  const creator = 'p:creator' as PrincipalId;
  const filler = 'p:filler' as PrincipalId;
  for (const [i, p] of [creator, filler].entries()) {
    runtime.seat(p, `seat-${String(i)}`, stage);
    runtime.standing.open(p);
  }
  return { runtime, creator, filler, stage };
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
    throw new Error(`${verb} halted at ${String(report.tick)}: ${report.violations.map((v) => v.id).join(' ')}`);
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
    actionsRemaining: 4,
  });
}

describe('two creators can make visibly different offers', () => {
  it('the venture is priced at the proportion asked for, and the escrow drawn matches', () => {
    const w = world('prop-verb');
    expect(act(w.runtime, w.creator, 'create', {
      kind: 'HAUL',
      stage: w.stage,
      value: 12_000,
      elective_bps: 6_000,
    })).toBeNull();
    const v = w.runtime.ventures.forPrincipal(w.creator)[0];
    if (v === undefined) throw new Error('no venture');
    for (const role of v.roles) {
      expect(escrowRatioBps(role.terms)).toBe(4_000);
    }
  });

  it('a refused proportion creates nothing at all — the check runs before any value moves', () => {
    const w = world('prop-refuse');
    const refusal = act(w.runtime, w.creator, 'create', {
      kind: 'HAUL',
      stage: w.stage,
      value: 12_000,
      elective_bps: 9_500,
    });
    expect(refusal?.invariant).toBe('PROP-V5');
    expect(w.runtime.ventures.forPrincipal(w.creator)).toHaveLength(0);
  });

  it('★ the FILLER can read the proportion on its own board row before it commits a hand', () => {
    // The point of the whole change. `D22`: *"a filler weighing 60/40 against a creator's public
    // record is the moment reputation becomes worth reading"* — and it cannot weigh what it is not
    // shown. The row carries both figures, exactly, and both `fill_role` affordances name them.
    const w = world('prop-board');
    expect(act(w.runtime, w.creator, 'create', {
      kind: 'HAUL',
      stage: w.stage,
      value: 12_000,
      elective_bps: 6_000,
    })).toBeNull();

    const seen = observe(w, w.filler);
    const board = (seen.ventures as { readonly board?: readonly Record<string, unknown>[] }).board ?? [];
    expect(board.length).toBeGreaterThan(0);
    const row = board[0];
    expect(row?.['elective_bps']).toBe(6_000);
    expect(row?.['escrow_ratio_bps']).toBe(4_000);
    // And the two must agree with the amounts beside them, or the row states the deal twice, differently.
    expect(Number(row?.['escrowed']) + Number(row?.['elective'])).toBeGreaterThan(0);

    const fill = seen.affordances.find((a) => a.verb === 'fill_role');
    expect(fill, 'the filler must be offered the slot for this to mean anything').toBeDefined();
    expect(fill?.what_it_forecloses).toContain('6000 bps');
    expect(fill?.what_it_forecloses).toContain('4000 bps');
    expect(fill?.what_it_forecloses).toContain('silence is a default on ITS record, not yours');
  });

  it('the CREATE affordance carries the knob and names the band, or nobody knows it exists', () => {
    // A parameter that never appears in a copyable request is the defect that hid nine mechanics
    // including the core loop — and the probe that guessed this exact spelling had it dropped.
    const w = world('prop-affordance');
    const offers = observe(w, w.creator).affordances.filter((a) => a.verb === 'create');
    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) {
      const kind = (o.params as Record<string, unknown>)['kind'] as VentureKind;
      expect(o.params['elective_bps'], `${kind} offer has no elective_bps`).toBe(minElectiveBps(kind));
      if (isEscrowable(kind)) {
        expect(o.what_it_forecloses).toContain(
          `${String(minElectiveBps(kind))}..${String(maxElectiveBps(kind))}`,
        );
      } else {
        expect(o.what_it_forecloses).toContain('legally un-escrowable');
      }
    }
  });
});

describe('the rules surface says it once', () => {
  const AGENT_MD = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');

  it('ELECTIVE_BPS_STATEMENT is in agent.md verbatim', () => {
    // Same discipline as GRADUATION_STATEMENT: the engine's sentence and the document's sentence are
    // the same bytes. "You choose the proportion" and "the proportion is fixed" are the two readings
    // an agent can hold, and it held the wrong one for the whole life of the project.
    const normalised = AGENT_MD.replace(/\n> ?/g, ' ').replace(/[ \t]+/g, ' ');
    expect(normalised).toContain(ELECTIVE_BPS_STATEMENT.replace(/[ \t]+/g, ' '));
  });

  it('quotes the escrow floor the engine actually enforces', () => {
    // If `MIN_ESCROW_BPS` is recalibrated and the document is not, an agent reads a band that is not
    // the band — which is the class of defect this file's header is about.
    // Written out with the comma the document uses, without `toLocaleString` — that is
    // locale-dependent and banned (DET-4), and a guard that varies by host is not a guard.
    const grouped = `${String(Math.trunc(MIN_ESCROW_BPS / 1_000))},${String(MIN_ESCROW_BPS % 1_000).padStart(3, '0')}`;
    expect(AGENT_MD).toContain(`leaves at least ${grouped} bps escrowed`);
    expect(AGENT_MD).toContain('elective_bps');
    expect(AGENT_MD).toContain('escrow_ratio_bps');
    // And that the refused spellings are named, so the refusal is not the first an agent hears of it.
    for (const key of ['split', 'escrow_pct', 'elective_pct', 'roles']) {
      expect(AGENT_MD, `agent.md does not mention the refused param ${key}`).toContain(key);
    }
  });
});

describe('BUILD is on the menu at last', () => {
  it('is offered, is last, and is 100% elective at four roles', () => {
    // It was legal, worked by hand, and had never appeared in an affordance — so no agent in this
    // world had ever been shown the four-role fully-unsecured venture the social premise rests on.
    expect(OFFERED_KINDS).toContain('BUILD');
    // Last, because the prioritiser keeps the first offer of each verb ahead of every repeat: BUILD
    // first would make every blind copier open a four-role venture and nothing else.
    expect(OFFERED_KINDS[OFFERED_KINDS.length - 1]).toBe('BUILD');
    expect(isEscrowable('BUILD')).toBe(false);
    expect(kindSpec('BUILD').roles).toHaveLength(4);

    const w = world('build-offered');
    const offer = observe(w, w.creator).affordances.find(
      (a) => a.verb === 'create' && (a.params as Record<string, unknown>)['kind'] === 'BUILD',
    );
    expect(offer, 'BUILD must reach the affordance list').toBeDefined();
    // Exact, never an estimate (A2): nothing locked, everything promised.
    expect(offer?.max_direct_loss).toBe(0);
    expect(offer?.max_contingent_liability).toBeGreaterThan(0);
    expect(offer?.what_it_forecloses).toContain('permanent public default');
  });

  it('and the offer is actually accepted by the engine, not merely printed', () => {
    // AGT-S2: an affordance the engine refuses costs the agent a real action. Sent verbatim.
    const w = world('build-accepted');
    const offer = observe(w, w.creator).affordances.find(
      (a) => a.verb === 'create' && (a.params as Record<string, unknown>)['kind'] === 'BUILD',
    );
    if (offer === undefined) throw new Error('BUILD was not offered');
    expect(act(w.runtime, w.creator, 'create', offer.params)).toBeNull();
    const v = w.runtime.ventures.forPrincipal(w.creator).find((x) => x.kind === 'BUILD');
    expect(v?.roles).toHaveLength(4);
    expect(v?.roles.every((r) => r.terms.escrowed === 0)).toBe(true);
  });

  it('survives the affordance cap in a busy world, so it is not offered only to an empty one', () => {
    // The list is capped at 64 and BUILD is the last `create`, therefore a truncatable repeat. Measured
    // rather than assumed: a mechanic that is only reachable in a quiet world is not reachable.
    setSpeed('instant');
    const rt = new Runtime({ seed: 'build-cap' });
    const cast = new HeuristicCast(rt, { size: 8 });
    cast.seat('build-cap');
    for (let i = 0; i < 400; i += 1) {
      for (const a of cast.decide(rt.engine.tick + 1, 'build-cap')) rt.engine.submit(a);
      if (rt.runTick().halted) throw new Error('halted');
    }
    let saw = 0;
    let seats = 0;
    for (const p of rt.world.holdingByPrincipal.keys()) {
      seats += 1;
      const o = buildObservation({
        runtime: rt,
        principal: p,
        serverNowMs: 0,
        fresh: true,
        wakesRemaining: 16,
        stale: false,
        corrections: [],
        actionsRemaining: 4,
      });
      if (
        o.affordances.some(
          (a) => a.verb === 'create' && (a.params as Record<string, unknown>)['kind'] === 'BUILD',
        )
      ) {
        saw += 1;
      }
    }
    expect(seats).toBeGreaterThan(4);
    expect(saw, 'BUILD is being cut by the affordance cap in a world with activity in it').toBe(seats);
  });
});
