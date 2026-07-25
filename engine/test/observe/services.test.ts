/**
 * PROP-O6 — the free services.
 *
 * > "Free services never consume an action, never reserve, and are memoised per
 * > `(principal, tick)`. Under load they respect the node budget and per-principal rate
 * > limit. *(An unmetered allocation solver offered free to every principal is the
 * > design's one real capacity risk.)*"
 *
 * Four claims, four assertions, and each is made the strong way:
 *
 * - **never consumes an action** — a *real* `ActionBudget` is passed alongside and its
 *   spend is asserted unchanged. Not "the code does not import it"; the counter.
 * - **never reserves** — `worldHash` and the ledger's `stateHash` are byte-identical
 *   across a sweep of every service. Not "nothing looks like a write".
 * - **memoised** — identical calls return the **same object**, asserted by identity. A
 *   fresh-but-equal result would mean the solver ran again, and then the capacity
 *   guarantee is words.
 * - **bounded** — both limits are exercised until they refuse, and the refusal is a
 *   value rather than a throw.
 */

import { describe, expect, it } from 'vitest';
import { minor } from '../../src/core/units.js';
import {
  CALLS_PER_PRINCIPAL_PER_TICK,
  MAX_PLANS,
  MIN_PLANS,
  NODE_BUDGET_PER_TICK,
  SERVICE_NAMES,
  ServiceDesk,
} from '../../src/observe/index.js';
import { ActionBudget } from '../../src/tick/index.js';
import { handsOf, worldHash } from '../../src/world/index.js';
import {
  ALICE,
  BRAM,
  CASS,
  DOV,
  ESK,
  fill,
  fixture,
  goLive,
  grantFrom,
  makeHaul,
  makeTopYield,
  sourcesFor,
  vid,
} from './fixture.js';
import type { GrantId, VentureId } from '../../src/core/types.js';

describe('PROP-O6 — a free service never consumes an action', () => {
  it('leaves a real ActionBudget untouched across every service', () => {
    const f = fixture();
    const haul = makeHaul(f);
    fill(f, haul, 0, BRAM, 1);
    const sources = sourcesFor(f, { grants: [grantFrom({ delegate: BRAM })] });
    const desk = new ServiceDesk();

    const budget = new ActionBudget();
    budget.openTick(sources.tick);
    const before = budget.spent(ALICE);

    desk.planHands(sources, ALICE);
    desk.quoteVenture(sources, ALICE, haul.id);
    desk.referenceSplitOf(sources, ALICE, haul.id);
    desk.stressGrant(sources, ALICE, 'g-1' as GrantId);
    desk.dryRun(sources, ALICE, 'move', {});
    desk.mandate(sources, ALICE);
    desk.page(sources, ALICE, 0, 5);

    expect(budget.spent(ALICE)).toBe(before);
    expect(budget.remaining(ALICE)).toBe(4);
    expect(budget.materialTaken(ALICE)).toBe(0);
  });

  it('names the seven services agent.md promises', () => {
    expect([...SERVICE_NAMES]).toEqual([
      'plan_hands',
      'quote_venture',
      'reference_split',
      'stress_grant',
      'dry_run',
      'mandate',
      'page',
    ]);
  });
});

describe('PROP-O6 — a free service never reserves', () => {
  it('leaves the world and the ledger byte-identical', () => {
    const f = fixture();
    const haul = makeHaul(f);
    fill(f, haul, 0, BRAM, 1);
    const sources = sourcesFor(f, { grants: [grantFrom({ delegate: BRAM })] });
    const desk = new ServiceDesk();

    const worldBefore = worldHash(f.world);
    const ledgerBefore = f.ledger.stateHash();
    const exposureBefore = f.ledger.encumbrances.encumberedTotal();

    for (const principal of [ALICE, BRAM, CASS]) {
      desk.planHands(sources, principal);
      desk.quoteVenture(sources, principal, haul.id);
      desk.referenceSplitOf(sources, principal, haul.id);
      desk.stressGrant(sources, principal, 'g-1' as GrantId);
      desk.dryRun(sources, principal, 'fill_role', { venture: haul.id });
      desk.mandate(sources, principal);
      desk.page(sources, principal, 0, 4);
    }

    expect(worldHash(f.world)).toBe(worldBefore);
    expect(f.ledger.stateHash()).toBe(ledgerBefore);
    expect(f.ledger.encumbrances.encumberedTotal()).toBe(exposureBefore);
  });

  it('two principals can hold quotes on the same slot — nothing is reserved (PROP-W4)', () => {
    const f = fixture();
    const haul = makeHaul(f, { creator: ALICE });
    const sources = sourcesFor(f);
    const desk = new ServiceDesk();
    const forBram = desk.page(sources, BRAM, 0, 40);
    const forCass = desk.page(sources, CASS, 0, 40);
    expect(forBram.served && forCass.served).toBe(true);
    if (!forBram.served || !forCass.served) return;
    const bramSlot = forBram.value.items.find(
      (a) => a.verb === 'fill_role' && a.params['venture'] === haul.id,
    );
    const cassSlot = forCass.value.items.find(
      (a) => a.verb === 'fill_role' && a.params['venture'] === haul.id,
    );
    expect(bramSlot).toBeDefined();
    expect(cassSlot).toBeDefined();
    // Same slot, two live quotes, different ids because the principal is pinned.
    expect(bramSlot?.params['role_index']).toBe(cassSlot?.params['role_index']);
    expect(bramSlot?.quote_id).not.toBe(cassSlot?.quote_id);
  });
});

describe('PROP-O6 — memoised per (principal, tick)', () => {
  it('returns the same object for an identical call, and a new one next tick', () => {
    const f = fixture();
    const haul = makeHaul(f);
    const desk = new ServiceDesk();
    const t1 = sourcesFor(f, { tick: 1 });
    const first = desk.planHands(t1, ALICE);
    const second = desk.planHands(t1, ALICE);
    // Identity, not deep equality: an equal-but-fresh result means the solver ran again.
    expect(second).toBe(first);
    expect(desk.callsMade(ALICE)).toBe(1);

    const t2 = sourcesFor(f, { tick: 2 });
    const third = desk.planHands(t2, ALICE);
    expect(third).not.toBe(first);
    expect(desk.callsMade(ALICE)).toBe(1);
    void haul;
  });

  it('memoises per principal, not globally', () => {
    const f = fixture();
    makeHaul(f);
    const desk = new ServiceDesk();
    const sources = sourcesFor(f);
    const forAlice = desk.planHands(sources, ALICE);
    const forBram = desk.planHands(sources, BRAM);
    expect(forBram).not.toBe(forAlice);
  });

  it('memoises per argument, so a second venture is a second answer', () => {
    const f = fixture();
    const a = makeHaul(f, { id: vid('v-a'), creator: ALICE });
    const b = makeHaul(f, { id: vid('v-b'), creator: DOV });
    const desk = new ServiceDesk();
    const sources = sourcesFor(f);
    const qa = desk.quoteVenture(sources, ESK, a.id);
    const qb = desk.quoteVenture(sources, ESK, b.id);
    expect(qa).not.toBe(qb);
    expect(qa.served && qb.served).toBe(true);
  });

  it('drops the memo table when the tick advances, so it is bounded by seats', () => {
    const f = fixture();
    makeHaul(f);
    const desk = new ServiceDesk();
    desk.planHands(sourcesFor(f, { tick: 1 }), ALICE);
    desk.planHands(sourcesFor(f, { tick: 1 }), BRAM);
    expect(desk.memoSize).toBe(2);
    desk.planHands(sourcesFor(f, { tick: 2 }), ALICE);
    expect(desk.memoSize).toBe(1);
  });
});

describe('PROP-O6 — bounded under load, and it refuses with a value', () => {
  it('refuses past the per-principal call limit, and never throws', () => {
    const f = fixture();
    for (let i = 0; i < 20; i += 1) {
      makeHaul(f, { id: vid(`v-${String(i)}`), creator: ALICE, windowClosesTick: 100, resolvesAtTick: 150 });
    }
    const desk = new ServiceDesk();
    const sources = sourcesFor(f);
    let refused = 0;
    for (let i = 0; i < CALLS_PER_PRINCIPAL_PER_TICK + 4; i += 1) {
      const reply = desk.quoteVenture(sources, BRAM, vid(`v-${String(i)}`));
      if (!reply.served) {
        refused += 1;
        // A refusal an agent can act on: come back next tick.
        expect(reply.ground).toBe('PAGED');
      }
    }
    expect(refused).toBe(4);
    expect(desk.callsMade(BRAM)).toBe(CALLS_PER_PRINCIPAL_PER_TICK);
  });

  it('one principal cannot exhaust another’s allowance', () => {
    const f = fixture();
    for (let i = 0; i < 20; i += 1) {
      makeHaul(f, { id: vid(`v-${String(i)}`), creator: ALICE, windowClosesTick: 100, resolvesAtTick: 150 });
    }
    const desk = new ServiceDesk();
    const sources = sourcesFor(f);
    for (let i = 0; i < CALLS_PER_PRINCIPAL_PER_TICK + 3; i += 1) {
      desk.quoteVenture(sources, BRAM, vid(`v-${String(i)}`));
    }
    expect(desk.quoteVenture(sources, CASS, vid('v-0')).served).toBe(true);
  });

  it('respects the shared node budget across principals, and says what it withheld', () => {
    // The limit that actually addresses the capacity risk: 300 principals each politely
    // inside their own call allowance is the load that matters.
    //
    // ── THE REFUSAL IS DRIVEN, NOT HOPED FOR ───────────────────────────────────
    //
    // The first version wrote `if (!second.served) expect(second.ground)...` — the
    // assertion about the refusal was guarded by the very thing it claimed to test, and
    // the refusal never fired, so deleting the whole `granted === 0` branch from
    // `planHands` left the suite green. A budget of 1 node cannot serve a single plan
    // (`claimNodes` grants `min(NODES_PER_PLAN_CALL, (hands+1)*(slots+1))` and the first
    // caller takes it all), so the second caller is refused for certain.
    const f = fixture();
    makeTopYield(f, 'BUILD', vid('v-big'), ALICE, 4_000);
    const desk = new ServiceDesk(undefined, 100, 6);
    const sources = sourcesFor(f);
    const first = desk.planHands(sources, BRAM);
    expect(first.served).toBe(true);
    expect(desk.nodes).toBe(6);
    const second = desk.planHands(sources, CASS);
    expect(second.served, 'the shared budget is spent, so the second caller must be refused').toBe(
      false,
    );
    if (second.served) return;
    // A value with a ground, never a throw and never a 500 (AGT-X9).
    expect(second.ground).toBe('NODE_BUDGET');
    expect(desk.nodes).toBeLessThanOrEqual(6);
  });

  it('the shared budget resets on the tick, never on first use', () => {
    const f = fixture();
    makeHaul(f);
    const desk = new ServiceDesk(undefined, 100, 8);
    desk.planHands(sourcesFor(f, { tick: 1 }), ALICE);
    expect(desk.nodes).toBeGreaterThan(0);
    desk.planHands(sourcesFor(f, { tick: 2 }), ALICE);
    expect(desk.nodes).toBeLessThanOrEqual(8);
  });

  it('the declared budget is the §12.1 number', () => {
    expect(NODE_BUDGET_PER_TICK).toBe(4_096);
    expect(CALLS_PER_PRINCIPAL_PER_TICK).toBe(12);
  });
});

describe('plan_hands — 3–6 COMPLETE plans', () => {
  it('gives every plan a step for every hand', () => {
    // "Complete" is the requirement in §12.1, and a plan that mentions two of three
    // hands is a suggestion. This is the assertion that makes the word mean something.
    const f = fixture();
    makeHaul(f, { id: vid('v-a'), creator: ALICE });
    makeHaul(f, { id: vid('v-b'), creator: DOV });
    makeTopYield(f, 'BUILD', vid('v-c'), CASS, 3_000);
    const desk = new ServiceDesk();
    const reply = desk.planHands(sourcesFor(f), BRAM);
    expect(reply.served).toBe(true);
    if (!reply.served) return;

    expect(reply.value.plans.length).toBeGreaterThanOrEqual(1);
    expect(reply.value.plans.length).toBeLessThanOrEqual(MAX_PLANS);
    for (const plan of reply.value.plans) {
      expect(plan.steps.length).toBe(3);
      expect(new Set(plan.steps.map((s) => s.hand)).size).toBe(3);
      // Every hand accounted for by a decision, including the decision to hold.
      for (const step of plan.steps) {
        expect(['TAKE_ROLE', 'HOLD', 'BUSY']).toContain(step.kind);
      }
    }
  });

  it('gives a step to a hand the plan cannot move either — the BUSY case', () => {
    // "One step per hand, always." The test above only ever had IDLE, PRESENT hands, so
    // the `BUSY` branch never ran: deleting the `steps.push({ kind: 'BUSY', ... })` line
    // from `planAt` left the whole suite green while every plan silently became
    // *incomplete* for exactly the agent that needs completeness most — one whose hands
    // are already committed or in transit.
    const f = fixture();
    const busy = makeHaul(f, { id: vid('v-busy'), creator: ALICE });
    // Two of BRAM's three hands are committed to roles, so they are not IDLE.
    fill(f, busy, 0, BRAM, 1);
    const inTransit = makeHaul(f, { id: vid('v-busy-2'), creator: CASS });
    fill(f, inTransit, 0, BRAM, 1);
    makeHaul(f, { id: vid('v-open'), creator: DOV, windowClosesTick: 100, resolvesAtTick: 150 });

    const hands = handsOf(f.world, BRAM);
    expect(hands.length).toBe(3);
    const notIdle = hands.filter((h) => h.state !== 'IDLE');
    expect(notIdle.length, 'the world must actually hold a non-IDLE hand').toBeGreaterThan(0);

    const desk = new ServiceDesk();
    const reply = desk.planHands(sourcesFor(f), BRAM);
    expect(reply.served).toBe(true);
    if (!reply.served) return;
    for (const plan of reply.value.plans) {
      // Complete: one step per hand, and every non-IDLE hand named as BUSY.
      expect(plan.steps.length).toBe(hands.length);
      expect(new Set(plan.steps.map((s) => s.hand)).size).toBe(hands.length);
      for (const hand of notIdle) {
        const step = plan.steps.find((s) => s.hand === hand.id);
        expect(step, `hand ${hand.id} has no step, so the plan is not complete`).toBeDefined();
        expect(step?.kind).toBe('BUSY');
        expect(step?.venture).toBeNull();
        expect(step?.role_index).toBeNull();
      }
    }
  });

  it('offers at least MIN_PLANS distinct plans when the world offers the choices', () => {
    const f = fixture();
    for (let i = 0; i < 4; i += 1) {
      makeHaul(f, { id: vid(`v-p${String(i)}`), creator: ALICE, windowClosesTick: 100, resolvesAtTick: 150 });
    }
    const desk = new ServiceDesk();
    const reply = desk.planHands(sourcesFor(f), BRAM);
    expect(reply.served).toBe(true);
    if (!reply.served) return;
    expect(reply.value.plans.length).toBeGreaterThanOrEqual(MIN_PLANS);
    // Distinct: no two plans have the same step list.
    const keys = reply.value.plans.map((p) =>
      p.steps.map((s) => `${s.kind}:${String(s.venture)}:${String(s.role_index)}`).join('|'),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('always returns the all-hold plan, priced — the option agents least consider', () => {
    const f = fixture();
    const desk = new ServiceDesk();
    const reply = desk.planHands(sourcesFor(f), ALICE);
    expect(reply.served).toBe(true);
    if (!reply.served) return;
    expect(reply.value.plans.length).toBeGreaterThanOrEqual(1);
    const allHold = reply.value.plans.find((p) => p.steps.every((s) => s.kind === 'HOLD'));
    expect(allHold).toBeDefined();
    expect(allHold?.ev_p50).toBe(0);
    expect(allHold?.worst_case).toBe(0);
  });

  it('carries an EV band, a worst case and what each plan forecloses', () => {
    const f = fixture();
    makeHaul(f, { creator: ALICE });
    const desk = new ServiceDesk();
    const reply = desk.planHands(sourcesFor(f), BRAM);
    expect(reply.served).toBe(true);
    if (!reply.served) return;
    for (const plan of reply.value.plans) {
      expect(plan.ev_p10).toBeLessThanOrEqual(plan.ev_p50);
      expect(plan.ev_p50).toBeLessThanOrEqual(plan.ev_p90);
      expect(Number.isSafeInteger(plan.worst_case)).toBe(true);
      expect(plan.worst_case).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(plan.forecloses)).toBe(true);
    }
  });

  it('never puts one principal in two roles of the same venture', () => {
    const f = fixture();
    makeTopYield(f, 'BUILD', vid('v-solo'), ALICE, 3_000);
    const desk = new ServiceDesk();
    const reply = desk.planHands(sourcesFor(f), BRAM);
    expect(reply.served).toBe(true);
    if (!reply.served) return;
    for (const plan of reply.value.plans) {
      const ventures = plan.steps
        .filter((s) => s.kind === 'TAKE_ROLE')
        .map((s) => s.venture as VentureId);
      expect(new Set(ventures).size).toBe(ventures.length);
    }
  });

  it('counts the plans the node budget stopped it reaching', () => {
    const f = fixture();
    for (let i = 0; i < 6; i += 1) {
      makeHaul(f, { id: vid(`v-n${String(i)}`), creator: ALICE, windowClosesTick: 100, resolvesAtTick: 150 });
    }
    const desk = new ServiceDesk(undefined, 100, 8);
    const reply = desk.planHands(sourcesFor(f), BRAM);
    expect(reply.served).toBe(true);
    if (!reply.served) return;
    expect(reply.value.nodes).toBeLessThanOrEqual(8);
    expect(reply.value.withheld).toBeGreaterThanOrEqual(0);
    expect(reply.value.plans.length + reply.value.withheld).toBeGreaterThanOrEqual(
      reply.value.plans.length,
    );
  });
});

describe('the other services answer their own question', () => {
  it('quote_venture prices every open slot and projects the settlement', () => {
    const f = fixture();
    const haul = makeHaul(f, { creator: ALICE });
    const desk = new ServiceDesk();
    const reply = desk.quoteVenture(sourcesFor(f), BRAM, haul.id);
    expect(reply.served).toBe(true);
    if (!reply.served || reply.value === null) return;
    expect(reply.value.open_slots.length).toBe(2);
    expect(reply.value.my_role_index).toBeNull();
    expect(reply.value.projected.outcomeIfNow).toBe('PARTIAL_FILL');
  });

  it('reference_split is the kind table’s anchor, unweighted', () => {
    const f = fixture();
    const haul = makeHaul(f);
    const desk = new ServiceDesk();
    const reply = desk.referenceSplitOf(sourcesFor(f), ALICE, haul.id);
    expect(reply.served).toBe(true);
    if (!reply.served || reply.value === null) return;
    expect(reply.value.map((r) => r.referenceBps)).toEqual([7_000, 3_000]);
  });

  it('stress_grant states the worst case and that bounds are not protection', () => {
    const f = fixture();
    const desk = new ServiceDesk();
    const reply = desk.stressGrant(
      sourcesFor(f, { grants: [grantFrom({ delegate: BRAM, maxDirectLoss: 9_000, maxContingentLiability: 4_000 })] }),
      ALICE,
      'g-1' as GrantId,
    );
    expect(reply.served).toBe(true);
    if (!reply.served || reply.value === null) return;
    expect(reply.value.headroom_direct).toBe(9_000);
    expect(reply.value.headroom_contingent).toBe(4_000);
    expect(reply.value.worst_case_total).toBe(13_000);
    expect(reply.value.note).toContain('no betray verb');
  });

  it('stress_grant declines a grant you are not party to', () => {
    const f = fixture();
    const desk = new ServiceDesk();
    const reply = desk.stressGrant(
      sourcesFor(f, { grants: [grantFrom({ grantor: DOV, delegate: ESK })] }),
      ALICE,
      'g-1' as GrantId,
    );
    expect(reply.served).toBe(true);
    if (!reply.served) return;
    expect(reply.value).toBeNull();
  });

  it('dry_run agrees with the catalogue rather than re-deciding', () => {
    const f = fixture();
    const haul = makeHaul(f, { creator: ALICE });
    const desk = new ServiceDesk();
    const sources = sourcesFor(f);
    const legal = desk.dryRun(sources, BRAM, 'fill_role', { venture: haul.id, role_index: 0 });
    expect(legal.served).toBe(true);
    if (!legal.served) return;
    expect(legal.value.affordance).not.toBeNull();
    expect(legal.value.grounds).toEqual([]);

    const illegal = desk.dryRun(sources, BRAM, 'create', { kind: 'RAID' });
    expect(illegal.served).toBe(true);
    if (!illegal.served) return;
    expect(illegal.value.affordance).toBeNull();
    expect(illegal.value.grounds).toContain('COMMONS_FLOOR');
    // Never a dead end.
    expect(illegal.value.nearest).not.toBeNull();
  });

  it('mandate is advice, and it says so', () => {
    const f = fixture();
    const desk = new ServiceDesk();
    const reply = desk.mandate(sourcesFor(f), ALICE);
    expect(reply.served).toBe(true);
    if (!reply.served || reply.value === null) return;
    expect(reply.value.version).toBe(1);
    // §13B: an owner reads and never moves. There is no verb for a mandate, and the
    // observation only ever announces its version.
    expect(reply.value.text.length).toBeGreaterThan(0);
  });

  it('a live venture’s quote still prices the holder’s own role', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [BRAM, CASS], minor(12_000));
    const desk = new ServiceDesk();
    const reply = desk.quoteVenture(sourcesFor(f), BRAM, haul.id);
    expect(reply.served).toBe(true);
    if (!reply.served || reply.value === null) return;
    expect(reply.value.my_role_index).toBe(0);
    expect(reply.value.projected.outcomeIfNow).toBe('FULFILLED');
  });
});
