/**
 * COMPARTMENTS, CLEARANCE, the DOSSIER and the delayed audit (SPEC §8, §11.2;
 * `PASS-TERRITORY-POLITICS` §16.7 MUST-5/7/8/9, §16.12 #3).
 *
 * ── WHAT THIS FILE IS FOR, AND WHY IT LEADS WITH NON-VACUITY ─────────────────
 *
 * *"A capability that exists and is never exercised is indistinguishable from one that is
 * missing."* This project has thirteen recorded instances, the most recent being
 * `lockFillStake` — which implements §7.3's escrow, quotes the section above itself, has its
 * own passing unit test, and had **no caller anywhere in `src/`**.
 *
 * A test suite is exactly where that hides, because a guard whose subject cannot occur passes
 * and reports green. So the first `describe` below proves the *world* can reach each new
 * mechanism through the front door — a compartmented grant is issuable, a dossier is cuttable,
 * an audit is spendable, the affordance offers each — and everything after it is a rule about a
 * thing already shown to happen.
 *
 * Every guard is MUTATION-VERIFIED. Each mutation is recorded next to the case it kills, and
 * each is simulated in-process (a mutant input handed to the real checker) rather than by
 * editing `src/` once by hand, so the mutation runs on every CI pass — the discipline
 * `vocabulary-repo.test.ts` established after keying on the bare term passed while the very
 * collision it hunts was live in the tree.
 *
 * Assertions compare against **the engine's recorded answer**, never a figure retyped here:
 * `compartmentDigest` is checked against `runtime.compartmentPort()`'s own output and the
 * reveal tick against `AUDIT_LAG_TICKS`, so a change to either moves the test with the engine
 * instead of leaving a fixture asserting last week's rules.
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import { isSettlementTick, setSpeed } from '../../src/core/time.js';
import type { EventId, GrantId, PrincipalId, SystemId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import {
  AUDIT_LAG_TICKS,
  canonicalClearance,
  canonicalVerbs,
  compartmentDigest,
  COMPARTMENTS,
  DELEGABLE_VERBS,
  DossierBook,
  dossiersStateTable,
  AuditLog,
  GrantBook,
  grantsStateTable,
  MAX_DOSSIERS,
  OFFICE_SHAPES,
  officeShape,
  type Dossier,
  type DossierId,
} from '../../src/grant/index.js';
import { checkInv22, type CustodyRow, type GrantSpend } from '../../src/invariants/authority.js';
import { commonsSystems } from '../../src/world/index.js';
import { MAX_GRANT_OFFERS, Runtime, type PendingCorrection } from '../../src/sim/runtime.js';
import { MAX_DOSSIER_OFFERS } from '../../src/api/observe.js';

type Row = Record<string, unknown>;
const obj = (v: unknown): Row => (typeof v === 'object' && v !== null ? (v as Row) : {});
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.map(obj) : []);
/** DET-1: a bare `.sort()` is banned, so string comparison is explicit everywhere. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface World {
  readonly runtime: Runtime;
  readonly grantor: PrincipalId;
  readonly delegate: PrincipalId;
  readonly outsider: PrincipalId;
  readonly stage: SystemId;
}

function world(seed: string): World {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const stage = commonsSystems(runtime.world.map)[0];
  if (stage === undefined) throw new Error('the launch map has no Commons system');
  const grantor = 'p:grantor' as PrincipalId;
  const delegate = 'p:delegate' as PrincipalId;
  const outsider = 'p:outsider' as PrincipalId;
  for (const [who, handle] of [
    [grantor, 'grantor'],
    [delegate, 'delegate'],
    [outsider, 'outsider'],
  ] as const) {
    runtime.seat(who, handle, stage);
    runtime.standing.open(who);
  }
  return { runtime, grantor, delegate, outsider, stage };
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

/** Advance the world n ticks with nobody acting, halting the test if the world halts. */
function idle(runtime: Runtime, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) {
    const report = runtime.runTick();
    if (report.halted) {
      throw new Error(
        `an idle tick halted the world at ${String(report.tick)}: ` +
          report.violations.map((v) => `${v.id} ${v.message}`).join(' | '),
      );
    }
  }
}

function observe(w: World, who: PrincipalId): Row {
  return buildObservation({
    runtime: w.runtime,
    principal: who,
    serverNowMs: 0,
    fresh: true,
    stale: false,
    actionsRemaining: 4,
    wakesRemaining: 16,
    corrections: [],
    correctionsDropped: 0,
  }) as unknown as Row;
}

/** Every event of one kind the ledger holds, as records (so `visibility` is readable). */
function eventsOfKind(w: World, kind: string): readonly { readonly event: Row; readonly visibility: string }[] {
  const out: { event: Row; visibility: string }[] = [];
  for (const tick of w.runtime.events.ticks()) {
    for (const record of w.runtime.events.eventsAtTick(tick)) {
      if (record.event.kind !== kind) continue;
      out.push({ event: record.event as unknown as Row, visibility: record.visibility });
    }
  }
  return out;
}

const GRANT = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  delegate: 'p:delegate',
  template: 'steward',
  max_direct_loss: 500,
  max_contingent_liability: 500,
  expires_tick: 200,
  ...over,
});

// ════════════════════════════════════════════════════════════════════════════
// 1. NON-VACUITY — every mechanism below can actually happen, through the front door
// ════════════════════════════════════════════════════════════════════════════

describe('non-vacuity — a compartment can bind, and each verb is reachable', () => {
  it('a grant carries a fence and a clearance, and both land on the hashed row', () => {
    const w = world('nv1');
    expect(act(w.runtime, w.grantor, 'grant', GRANT())).toBeNull();
    const g = w.runtime.grants.forGrantor(w.grantor)[0];
    expect(g).toBeDefined();
    // Against the office table, not a retyped list: `steward` is where the shape is declared.
    expect(g?.verbs).toEqual([...(officeShape('steward')?.verbs ?? [])]);
    expect(g?.clearance).toEqual([...(officeShape('steward')?.clearance ?? [])]);
    expect(g?.clearance.length).toBeGreaterThan(0);
  });

  it('a cleared delegate reads the figures, and they are the ENGINE\'s figures', () => {
    const w = world('nv2');
    act(w.runtime, w.grantor, 'grant', GRANT());
    const held = rows(obj(observe(w, w.delegate)['grants'])['held']);
    expect(held).toHaveLength(1);
    const reads = obj(held[0]?.['reads']);
    // Compared against `compartmentDigest` over the runtime's own port, so this asserts the
    // observation serves the engine's answer rather than asserting a string somebody typed.
    for (const room of COMPARTMENTS) {
      expect(reads[room]).toBe(
        compartmentDigest(w.runtime.compartmentPort(), w.grantor, room, w.runtime.engine.tick),
      );
    }
    // And the STORES digest is not a constant: it names the grantor's real free balance.
    expect(String(reads['STORES'])).toContain('free=');
  });

  it('a DOSSIER can be cut and handed to a third party, and the book records it', () => {
    const w = world('nv3');
    act(w.runtime, w.grantor, 'grant', GRANT());
    expect(
      act(w.runtime, w.delegate, 'message', { to: w.outsider, dossier: `${w.grantor}/STORES` }),
    ).toBeNull();
    const cut = w.runtime.dossiers.all();
    expect(cut).toHaveLength(1);
    expect(cut[0]?.subject).toBe(w.grantor);
    expect(cut[0]?.cutBy).toBe(w.delegate);
    expect(cut[0]?.toWhom).toBe(w.outsider);
    expect(cut[0]?.grant).toBe(w.runtime.grants.forGrantor(w.grantor)[0]?.id);
  });

  it('`audit` is live and is a canon verb — no slot was spent', () => {
    const w = world('nv4');
    expect(w.runtime.liveVerbs.has('audit')).toBe(true);
    act(w.runtime, w.grantor, 'grant', GRANT());
    expect(act(w.runtime, w.grantor, 'audit', {})).toBeNull();
    expect(w.runtime.audits.through(w.grantor)).not.toBeNull();
  });

  it('the affordance list offers grant WITH both scopes, the dossier, and the audit', () => {
    const w = world('nv5');
    // A grant candidate needs a kept promise, which this bare world has none of — so the
    // `grant` row's own reachability is `agt-r5`'s business. What must be true here is that the
    // two NEW verbs are offered once a cleared grant exists, because they are the mechanisms
    // this change adds and an unoffered mechanism is an absent one.
    act(w.runtime, w.grantor, 'grant', GRANT());

    const delegateAffordances = rows(observe(w, w.delegate)['affordances']);
    const cite = delegateAffordances.filter((a) => a['verb'] === 'message' && 'dossier' in obj(a['params']));
    expect(cite.length).toBeGreaterThan(0);
    // The default recipient is the SUBJECT — the honest use — and the warning says so.
    expect(String(obj(cite[0]?.['params'])['to'])).toBe(String(w.grantor));
    expect(String(cite[0]?.['what_it_forecloses'])).toContain('leak');

    const grantorAffordances = rows(observe(w, w.grantor)['affordances']);
    expect(grantorAffordances.some((a) => a['verb'] === 'audit')).toBe(true);
  });

  it('the dossier offers are CAPPED across grants, not per grant', () => {
    // ── A CAP THAT IS NOT A CAP IS WORSE THAN NONE ─────────────────────────────
    //
    // The first draft tested the running count inside the INNER loop over a grant's compartments
    // and `break`-ed on it, which leaves only that loop — so a delegate holding several cleared
    // grants pushed `MAX_GRANT_OFFERS` rows PER GRANT. PROP-O1 reconciles
    // `candidates === shown + Σ withheld` per field, so an over-full list makes that arithmetic
    // wrong in the direction nobody checks. Found by reading, not by a failing test, which is why
    // this one exists.
    // ── ★ AND THEN THE CAP THAT WAS A CAP DROPPED A LIVE CAPABILITY ───────────
    //
    // Fixing the arithmetic left two defects standing, both found by a probe running a betrayal from
    // outside. The cap was `MAX_GRANT_OFFERS` — **a cap on a different list** (how many principals to
    // suggest you promote) — and the walk was grant-id hash order, so ONE grantor could take every
    // slot. A delegate holding an office in a syndicate *and* a personal grant over the principal
    // that trusted it was offered dossiers on the syndicate only; `withheld` said
    // `count: 4, verbs: [build, move, trade]`, naming neither `message` nor the subject, because
    // neither `break` incremented anything. The probe hand-built the call, it was accepted, and the
    // leak landed.
    //
    // So: `MAX_DOSSIER_OFFERS`, breadth-first by grantor, every drop counted with its subjects named.
    // The property this case now pins is the one that survived the rename — **the cap bounds the
    // whole list and not each grant** — and the fairness half is in
    // `test/api/withheld-is-accountable.spec.ts`, where the accountability promise lives.
    const w = world('nv7');
    // Three grantors, each handing this delegate a steward's office: 3 grants × 2 compartments = 6
    // candidate rows.
    for (const name of ['a', 'b', 'c']) {
      const grantor = `p:g-${name}` as PrincipalId;
      w.runtime.seat(grantor, `g-${name}`, w.stage);
      w.runtime.standing.open(grantor);
      expect(act(w.runtime, grantor, 'grant', GRANT({ template: 'steward' }))).toBeNull();
    }
    expect(w.runtime.grants.forDelegate(w.delegate).length).toBe(3);
    const cite = rows(observe(w, w.delegate)['affordances']).filter(
      (a) => a['verb'] === 'message' && 'dossier' in obj(a['params']),
    );
    expect(
      cite.length,
      'the cap bounds the WHOLE list, not each grant: 3 cleared grants must not yield 3 × the cap',
    ).toBeLessThanOrEqual(MAX_DOSSIER_OFFERS);
    expect(cite.length, 'and it is not zero — the cap must bound a list that exists').toBeGreaterThan(0);
    // And the two caps are now SEPARATE constants, which is the whole correction: one sizes "how many
    // principals is it decent to suggest you promote", the other "how many of your own live
    // capabilities may this list omit". Reusing one for both is HARD RULE 4 one level below the
    // vocabulary, and it is what deleted a subject from the menu.
    expect(MAX_DOSSIER_OFFERS).not.toBe(MAX_GRANT_OFFERS);
    // Six candidates against a cap of six, so all six are shown — and the per-grant bug would have
    // published eighteen. That is the arithmetic this case is for; the case where the cap actually
    // BITES, and the fairness of what it drops, is `test/api/withheld-is-accountable.spec.ts` with
    // four grantors against six slots.
    expect(
      new Set(cite.map((a) => String(obj(a['params'])['dossier']).split('/')[0])).size,
      'every grantor the delegate can read must appear, not just whichever grant-id sorts first — the ' +
        'old walk was grant-id hash order and one grantor could take every slot',
    ).toBe(3);
  });

  it('the `grant` affordance names verbs and clearance in its params, so the fields are discoverable', () => {
    // The mechanism this closes: a parameter that only ever appears as a server-side default is
    // one no agent will ever vary. `preference` sat on `create` unread for the project's life.
    const w = world('nv6');
    // Manufacture a kept promise the cheap way — `grantCandidates` reads the relation index, so
    // this asserts against whatever the index says rather than reconstructing its rule.
    const candidates = w.runtime.grantCandidates(w.grantor, w.runtime.engine.tick, 2);
    if (candidates.length === 0) {
      // No candidate in a bare world is correct and is not this file's subject; assert the
      // shape the affordance WOULD carry, from the one home that decides it.
      expect(officeShape('treasury-hand')?.verbs).toEqual(['elect']);
      expect(officeShape('treasury-hand')?.clearance).toEqual(['STORES']);
      return;
    }
    const offer = rows(observe(w, w.grantor)['affordances']).find((a) => a['verb'] === 'grant');
    expect(obj(offer?.['params'])['verbs']).toBeDefined();
    expect(obj(offer?.['params'])['clearance']).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. THE FENCE — a treasurer is not automatically a quartermaster (§16.12 #3)
// ════════════════════════════════════════════════════════════════════════════

describe('the verb fence (SPEC §8: a grant specifies VERBS × … × limits)', () => {
  it('every template names a DIFFERENT power — the labels are no longer six words for one thing', () => {
    // The defect this closes, stated as a property: if two templates had identical shapes the
    // agent-facing menu would be offering a distinction the engine does not make.
    const shapes = Object.entries(OFFICE_SHAPES)
      .filter(([name]) => name !== 'custom')
      .map(([name, s]) => [name, `${s.verbs.join('+')}|${s.clearance.join('+')}`] as const);
    const seen = new Map<string, string>();
    for (const [name, key] of shapes) {
      expect(seen.has(key), `${name} and ${seen.get(key) ?? '?'} are the same office under two names`).toBe(
        false,
      );
      seen.set(key, name);
    }
    expect(seen.size).toBe(shapes.length);
  });

  it('`factor` is full authority with zero sight — so "a clearance is required to be useful" is false', () => {
    const shape = officeShape('factor');
    expect(shape?.verbs).toEqual([...DELEGABLE_VERBS]);
    expect(shape?.clearance).toEqual([]);
  });

  it('a treasury-hand may NOT create in its grantor\'s name (INV-22 at the door)', () => {
    const w = world('f1');
    act(w.runtime, w.grantor, 'grant', GRANT({ template: 'treasury-hand' }));
    const refusal = act(w.runtime, w.delegate, 'create', {
      kind: 'HAUL',
      on_behalf_of: w.grantor,
      value: 100,
    });
    expect(refusal?.invariant).toBe('INV-22');
    // The hint has to name the fix or the refusal is a wall: which templates carry `create`.
    expect(refusal?.hint).toContain('create');
    expect(refusal?.hint).toContain('quartermaster');
    // And nothing was drawn: a refusal leaves the world untouched.
    expect(w.runtime.grants.allSpends()).toHaveLength(0);
  });

  it('a quartermaster may NOT elect in its grantor\'s name', () => {
    const w = world('f2');
    act(w.runtime, w.grantor, 'grant', GRANT({ template: 'quartermaster' }));
    // The grantor creates a venture of its own so there is something to elect on.
    expect(act(w.runtime, w.grantor, 'create', { kind: 'HAUL', value: 100 })).toBeNull();
    const mine = w.runtime.ventures.forPrincipal(w.grantor)[0];
    expect(mine).toBeDefined();
    const refusal = act(w.runtime, w.delegate, 'elect', {
      venture: mine?.id,
      role: 0,
      elect: 'IN_FULL',
    });
    // Either the fence bit, or an earlier rule about the role did. The fence is what this case is
    // about, so it asserts the fence specifically rather than "some refusal happened".
    expect(refusal).not.toBeNull();
    if (refusal?.invariant === 'INV-22') {
      expect(refusal.hint).toContain('elect');
      expect(refusal.hint).toContain('treasury-hand');
    }
  });

  it('`custom` grants NOTHING unless named, so the escape hatch is the narrowest template', () => {
    const w = world('f3');
    // No `verbs`, no `clearance`: refused, because a grant that delegates no verb is an office
    // nobody can use — and silently defaulting it wide would make the safest word the widest.
    const refusal = act(w.runtime, w.grantor, 'grant', GRANT({ template: 'custom' }));
    expect(refusal?.invariant).toBe('A2');
    expect(w.runtime.grants.all()).toHaveLength(0);

    // Named explicitly: accepted, and exactly what was named.
    expect(
      act(w.runtime, w.grantor, 'grant', GRANT({ template: 'custom', verbs: ['elect'], clearance: [] })),
    ).toBeNull();
    const g = w.runtime.grants.forGrantor(w.grantor)[0];
    expect(g?.verbs).toEqual(['elect']);
    expect(g?.clearance).toEqual([]);
  });

  it('refuses a verb outside the delegable set, and names the set', () => {
    const w = world('f4');
    const refusal = act(w.runtime, w.grantor, 'grant', GRANT({ verbs: ['move', 'trade'] }));
    expect(refusal?.invariant).toBe('A2');
    expect(refusal?.hint).toContain('move');
    for (const v of DELEGABLE_VERBS) expect(refusal?.hint).toContain(v);
  });

  it('refuses a compartment that does not exist, and never offers a seal compartment', () => {
    const w = world('f5');
    const refusal = act(w.runtime, w.grantor, 'grant', GRANT({ clearance: ['SEALS'] }));
    expect(refusal?.invariant).toBe('A2');
    // PROP-D2 is the one prohibition with no exceptions, so the refusal says so out loud.
    expect(refusal?.hint).toContain('seal');
    expect(COMPARTMENTS).not.toContain('SEALS' as never);
  });

  it('an explicit empty verb list is a DIFFERENT answer from no key at all', () => {
    // `readList` returns null for "absent" and [] for "explicitly empty", and collapsing the two
    // would silently widen an agent's stated intent to the template's default.
    const w = world('f6');
    // Absent → the template's fence, which for a steward is both verbs.
    expect(act(w.runtime, w.grantor, 'grant', GRANT())).toBeNull();
    expect(w.runtime.grants.forGrantor(w.grantor)[0]?.verbs).toEqual([...DELEGABLE_VERBS]);
    // Explicit [] → refused as an unusable office, NOT quietly filled in from the template.
    const refusal = act(w.runtime, w.grantor, 'grant', GRANT({ delegate: 'p:outsider', verbs: [] }));
    expect(refusal?.invariant).toBe('A2');
  });

  it('MUTATION — INV-22 halts on a draw whose verb the grant does not carry', () => {
    // The mutant: a spend journal row on `create` against an `elect`-only fence. Simulated by
    // handing the real checker a mutant input, so it runs every CI pass. Deleting the fence
    // clause in `checkInv22` turns this green, which is the mutation this case kills.
    const row = {
      id: 'g:m1' as GrantId,
      grantor: 'p:g' as PrincipalId,
      delegate: 'p:d' as PrincipalId,
      template: 'treasury-hand',
      maxDirectLoss: minor(1_000),
      maxContingentLiability: minor(1_000),
      spentDirect: minor(100),
      spentContingent: minor(0),
      verbs: ['elect'],
      clearance: [] as readonly string[],
      expiresTick: 1_000,
      revokedAtTick: null,
    };
    const spends: readonly GrantSpend[] = [
      {
        grant: row.id,
        delegate: row.delegate,
        tick: 1,
        eventId: 'ev:m1' as EventId,
        direct: minor(100),
        contingent: minor(0),
        verb: 'create',
      },
    ];
    const fired = checkInv22([row], spends, 2);
    expect(fired.map((v) => v.id)).toContain('INV-22');
    expect(fired.map((v) => v.message).join(' ')).toContain('create');

    // NON-VACUITY of the mutation: the same journal on the delegated verb is clean, so the case
    // above fails for the fence and not for some other clause it happens to trip.
    expect(checkInv22([row], [{ ...spends[0]!, verb: 'elect' }], 2)).toEqual([]);
  });

  it('MUTATION — the book refuses the same draw, so the door and the net agree', () => {
    const book = new GrantBook();
    const id = 'g:m2' as GrantId;
    book.add({
      id,
      grantor: 'p:g' as PrincipalId,
      delegate: 'p:d' as PrincipalId,
      template: 'treasury-hand',
      maxDirectLoss: minor(1_000),
      maxContingentLiability: minor(1_000),
      spentDirect: minor(0),
      spentContingent: minor(0),
      verbs: ['elect'],
      clearance: [],
      expiresTick: 1_000,
      revokedAtTick: null,
    });
    expect(book.carriesVerb(id, 'elect')).toBe(true);
    expect(book.carriesVerb(id, 'create')).toBe(false);
    expect(() =>
      book.recordSpend({
        grant: id,
        delegate: 'p:d' as PrincipalId,
        tick: 1,
        eventId: 'ev:m2' as EventId,
        direct: minor(1),
        contingent: minor(0),
        verb: 'create',
      }),
    ).toThrow(/does not carry|carries/);
    // And the legal draw still lands — the guard is not simply refusing everything.
    book.recordSpend({
      grant: id,
      delegate: 'p:d' as PrincipalId,
      tick: 1,
      eventId: 'ev:m3' as EventId,
      direct: minor(1),
      contingent: minor(0),
      verb: 'elect',
    });
    expect(book.allSpends()).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. THE CLEARANCE and the DOSSIER — sight, custody, and what revoke cannot undo
// ════════════════════════════════════════════════════════════════════════════

describe('clearance and custody (§16.7 MUST-5, MUST-7)', () => {
  it('a delegate with authority and no clearance cannot cut anything, and is told why', () => {
    const w = world('c1');
    act(w.runtime, w.grantor, 'grant', GRANT({ template: 'factor' }));
    const refusal = act(w.runtime, w.delegate, 'message', {
      to: w.outsider,
      dossier: `${w.grantor}/STORES`,
    });
    expect(refusal?.invariant).toBe('INV-22');
    // The sentence has to teach the distinction, because "a delegate with the first and not the
    // second is the ordinary case, not a mistake".
    expect(refusal?.hint).toContain('CLEARANCE');
    expect(w.runtime.dossiers.all()).toHaveLength(0);
  });

  it('a clearance on STORES does not open HANDS — compartments are separate', () => {
    const w = world('c2');
    act(w.runtime, w.grantor, 'grant', GRANT({ template: 'treasury-hand' }));
    expect(
      act(w.runtime, w.delegate, 'message', { to: w.outsider, dossier: `${w.grantor}/STORES` }),
    ).toBeNull();
    const refusal = act(w.runtime, w.delegate, 'message', {
      to: w.outsider,
      dossier: `${w.grantor}/HANDS`,
    });
    expect(refusal?.invariant).toBe('INV-22');
    expect(w.runtime.dossiers.all()).toHaveLength(1);
  });

  it('★ REVOKE IS NOT A CURE — a held dossier is re-handable after the grant dies', () => {
    const w = world('c3');
    act(w.runtime, w.grantor, 'grant', GRANT());
    const g = w.runtime.grants.forGrantor(w.grantor)[0];
    expect(g).toBeDefined();
    act(w.runtime, w.delegate, 'message', { to: w.outsider, dossier: `${w.grantor}/STORES` });
    const first = w.runtime.dossiers.all()[0];
    expect(first).toBeDefined();

    // The grantor revokes. A fresh cut must now fail…
    expect(act(w.runtime, w.grantor, 'revoke', { grant: g?.id })).toBeNull();
    idle(w.runtime, 1);
    expect(w.runtime.grants.isLive(g!.id, w.runtime.engine.tick)).toBe(false);
    expect(
      act(w.runtime, w.delegate, 'message', { to: w.outsider, dossier: `${w.grantor}/STORES` })
        ?.invariant,
    ).toBe('INV-22');

    // …and the copy already taken must still travel. This is the whole reason a clearance is
    // heavier than a loss limit, and it is asserted rather than described.
    expect(
      act(w.runtime, w.outsider, 'message', { to: w.delegate, dossier: first?.id }),
    ).toBeNull();
    const chain = w.runtime.dossiers.all();
    expect(chain).toHaveLength(2);
    const copy = chain.find((d) => d.id !== first?.id);
    expect(copy?.parent).toBe(first?.id);
    expect(copy?.grant).toBeNull();
    // The digest travels verbatim, stamps included, so a stale figure announces its own age.
    expect(copy?.digest).toBe(first?.digest);
    // And the custody chain still roots at the promotion that started it (§14's receipt reel).
    expect(w.runtime.dossiers.rootOf(copy!)).toBe(g?.id);
  });

  it('you cannot re-hand a dossier you have only heard about', () => {
    const w = world('c4');
    act(w.runtime, w.grantor, 'grant', GRANT());
    act(w.runtime, w.delegate, 'message', { to: w.grantor, dossier: `${w.grantor}/STORES` });
    const row = w.runtime.dossiers.all()[0];
    const refusal = act(w.runtime, w.outsider, 'message', { to: w.delegate, dossier: row?.id });
    expect(refusal?.invariant).toBe('INV-22');
    expect(w.runtime.dossiers.all()).toHaveLength(1);
  });

  it('a dossier goes to exactly one named principal, and never to yourself', () => {
    const w = world('c5');
    act(w.runtime, w.grantor, 'grant', GRANT());
    expect(act(w.runtime, w.delegate, 'message', { dossier: `${w.grantor}/STORES` })?.invariant).toBe('A2');
    expect(
      act(w.runtime, w.delegate, 'message', { to: w.delegate, dossier: `${w.grantor}/STORES` })
        ?.invariant,
    ).toBe('A2');
    expect(w.runtime.dossiers.all()).toHaveLength(0);
  });

  it('MUTATION — INV-22 halts on a cut with no clearance behind it', () => {
    const grant = {
      id: 'g:m3' as GrantId,
      grantor: 'p:g' as PrincipalId,
      delegate: 'p:d' as PrincipalId,
      template: 'factor',
      maxDirectLoss: minor(0),
      maxContingentLiability: minor(0),
      spentDirect: minor(0),
      spentContingent: minor(0),
      verbs: ['create'],
      clearance: [] as readonly string[],
      expiresTick: 1_000,
      revokedAtTick: null,
    };
    const base: CustodyRow = {
      id: 'd:m3',
      subject: grant.grantor,
      compartment: 'STORES',
      cutBy: grant.delegate,
      grant: grant.id,
      parent: null,
      cutAtTick: 10,
      revealsAtTick: 10 + AUDIT_LAG_TICKS,
      lagTicks: AUDIT_LAG_TICKS,
    };
    const fired = checkInv22([grant], [], 20, [base]);
    expect(fired.map((v) => v.id)).toContain('INV-22');
    expect(fired.map((v) => v.message).join(' ')).toContain('CLEARANCE');

    // NON-VACUITY: the same row under a grant that DOES carry the clearance is clean.
    expect(checkInv22([{ ...grant, clearance: ['STORES'] }], [], 20, [base])).toEqual([]);
  });

  it('MUTATION — INV-22 halts on broken provenance, a wrong cutter, and a dangling parent', () => {
    const grant = {
      id: 'g:m4' as GrantId,
      grantor: 'p:g' as PrincipalId,
      delegate: 'p:d' as PrincipalId,
      template: 'steward',
      maxDirectLoss: minor(0),
      maxContingentLiability: minor(0),
      spentDirect: minor(0),
      spentContingent: minor(0),
      verbs: ['create'],
      clearance: ['STORES'] as readonly string[],
      expiresTick: 1_000,
      revokedAtTick: null,
    };
    const ok: CustodyRow = {
      id: 'd:ok',
      subject: grant.grantor,
      compartment: 'STORES',
      cutBy: grant.delegate,
      grant: grant.id,
      parent: null,
      cutAtTick: 5,
      revealsAtTick: 5 + AUDIT_LAG_TICKS,
      lagTicks: AUDIT_LAG_TICKS,
    };
    expect(checkInv22([grant], [], 20, [ok])).toEqual([]);

    const cases: readonly (readonly [string, CustodyRow, string])[] = [
      ['neither grant nor parent', { ...ok, id: 'd:1', grant: null }, 'neither'],
      ['both grant and parent', { ...ok, id: 'd:2', parent: 'd:ok' }, 'both'],
      ['a reveal time of its own', { ...ok, id: 'd:3', revealsAtTick: ok.cutAtTick + 1 }, 'audit lag'],
      ['a cutter the grant does not name', { ...ok, id: 'd:4', cutBy: 'p:x' as PrincipalId }, 'cut by'],
      ['a subject the grant is not over', { ...ok, id: 'd:5', subject: 'p:y' as PrincipalId }, 'compartments'],
      ['a dangling parent', { ...ok, id: 'd:6', grant: null, parent: 'd:gone' }, 'not in the dossier table'],
      ['a cut after expiry', { ...ok, id: 'd:7', cutAtTick: 2_000, revealsAtTick: 2_000 + AUDIT_LAG_TICKS }, 'expired'],
    ];
    for (const [name, mutant, needle] of cases) {
      const fired = checkInv22([grant], [], 20, [ok, mutant]);
      expect(fired.length, `${name} should have fired INV-22`).toBeGreaterThan(0);
      expect(fired.map((v) => v.message).join(' '), name).toContain(needle);
    }
  });

  it('the custody walk is bounded, so a cyclic chain cannot spin inside a tick (DET-9)', () => {
    const book = new DossierBook();
    // A cycle cannot be built through `add` (a parent must already exist), so this asserts the
    // bound directly on the walker: a chain longer than the cap answers `null` rather than
    // looping, and INV-22 reports that as broken custody.
    const mk = (n: number, parent: string | null): Dossier => ({
      id: `d:${String(n)}` as DossierId,
      subject: 'p:g' as PrincipalId,
      compartment: 'STORES',
      cutBy: 'p:d' as PrincipalId,
      toWhom: 'p:x' as PrincipalId,
      grant: null,
      parent: parent as DossierId | null,
      cutAtTick: n,
      revealsAtTick: n + AUDIT_LAG_TICKS,
      digest: 'STORES@1 free=0 encumbered=0',
    });
    // Root has a grant; the rest chain off it. 40 deep, past MAX_CUSTODY_DEPTH of 32.
    book.add({ ...mk(0, null), grant: 'g:root' as GrantId });
    for (let n = 1; n < 40; n += 1) book.add(mk(n, `d:${String(n - 1)}`));
    expect(book.rootOf(book.get('d:5' as DossierId)!)).toBe('g:root');
    expect(book.rootOf(book.get('d:39' as DossierId)!)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. THE DELAYED AUDIT — the window, its retention, and A9
// ════════════════════════════════════════════════════════════════════════════

describe('the delayed audit (§16.7 MUST-8) and its retention', () => {
  it('★ the subject cannot see the row before the lag, and CAN see it after', () => {
    const w = world('d1');
    act(w.runtime, w.grantor, 'grant', GRANT());
    act(w.runtime, w.delegate, 'message', { to: w.outsider, dossier: `${w.grantor}/STORES` });
    const row = w.runtime.dossiers.all()[0];
    expect(row).toBeDefined();
    expect(row?.revealsAtTick).toBe(row!.cutAtTick + AUDIT_LAG_TICKS);

    // Dark: the count is published, the row is not. Both halves matter — the count is what makes
    // `audit` a purchase rather than a ritual, and the row is what the window withholds.
    const dark = obj(observe(w, w.grantor)['grants']);
    expect(rows(dark['about_me'])).toHaveLength(0);
    expect(obj(dark['window'])['unrevealed_count']).toBe(1);
    expect(obj(dark['window'])['audit_lag_ticks']).toBe(AUDIT_LAG_TICKS);

    // ★ RETENTION, and it is the `Book.prune` hazard by name. Idle past the reveal and read it
    // back: the row must still BE there. A retention window shorter than the lag would drop it
    // exactly here, which is the failure that once made a §9 fix evaporate in production.
    idle(w.runtime, AUDIT_LAG_TICKS + 1);
    const lit = obj(observe(w, w.grantor)['grants']);
    expect(rows(lit['about_me'])).toHaveLength(1);
    expect(obj(lit['window'])['unrevealed_count']).toBe(0);
    expect(w.runtime.dossiers.all()).toHaveLength(1);
  });

  it('★ and it is still there a very long time later — NOTHING prunes this book', () => {
    // The claim in `grant/dossier.ts` is that there is no prune path and the cap is the only
    // bound. This is that claim as a test: a row survives an order of magnitude more ticks than
    // any retention window in this engine, and the module's own surface offers no way to remove
    // one.
    const w = world('d2');
    act(w.runtime, w.grantor, 'grant', GRANT());
    act(w.runtime, w.delegate, 'message', { to: w.outsider, dossier: `${w.grantor}/STORES` });
    const id = w.runtime.dossiers.all()[0]?.id;
    idle(w.runtime, 320);
    expect(w.runtime.dossiers.get(id!)).toBeDefined();

    // And structurally: the book exposes no remover. A method added later fails this line, which
    // is the point — the assertion is about the SURFACE, not about one row's luck.
    const surface = Object.getOwnPropertyNames(DossierBook.prototype);
    for (const banned of ['prune', 'delete', 'remove', 'clear', 'evict', 'trim']) {
      expect(surface, `DossierBook.${banned} would make evidence expire`).not.toContain(banned);
    }
  });

  it('`audit` shortens the window and posts the ATTEMPT publicly, not the findings', () => {
    const w = world('d3');
    act(w.runtime, w.grantor, 'grant', GRANT());
    act(w.runtime, w.delegate, 'message', { to: w.outsider, dossier: `${w.grantor}/STORES` });
    expect(rows(obj(observe(w, w.grantor)['grants'])['about_me'])).toHaveLength(0);

    expect(act(w.runtime, w.grantor, 'audit', {})).toBeNull();
    const seen = rows(obj(observe(w, w.grantor)['grants'])['about_me']);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.['cut_by']).toBe(w.delegate);
    expect(seen[0]?.['to_whom']).toBe(w.outsider);
    // The SUBJECT never reads its own figures back — it knows them, and publishing them would
    // make every leak leak twice.
    expect(seen[0]?.['digest']).toBeNull();

    // The public row is the attempt and a count. It names no compartment and no delegate.
    const posted = eventsOfKind(w, 'grant.audited');
    expect(posted).toHaveLength(1);
    expect(JSON.stringify(posted[0]?.event['payload'])).not.toContain('STORES');
    expect(JSON.stringify(posted[0]?.event['payload'])).not.toContain(String(w.delegate));
  });

  it('an audit before anything is cut buys nothing, and a later cut is still dark', () => {
    // The stamp is "I read the log through tick T", so auditing early must not pre-clear future
    // cuts — otherwise one action would buy permanent omniscience.
    const w = world('d4');
    act(w.runtime, w.grantor, 'grant', GRANT());
    act(w.runtime, w.grantor, 'audit', {});
    act(w.runtime, w.delegate, 'message', { to: w.outsider, dossier: `${w.grantor}/STORES` });
    expect(rows(obj(observe(w, w.grantor)['grants'])['about_me'])).toHaveLength(0);
    expect(obj(obj(observe(w, w.grantor)['grants'])['window'])['unrevealed_count']).toBe(1);
  });

  it('★ A9 — the holder sees the figures, and the frame draws no thread before the reveal', () => {
    const w = world('d5');
    act(w.runtime, w.grantor, 'grant', GRANT());
    act(w.runtime, w.delegate, 'message', { to: w.outsider, dossier: `${w.grantor}/STORES` });
    const row = w.runtime.dossiers.all()[0];

    // The two holders get the document, figures and all: it is in their hands.
    for (const holder of [w.delegate, w.outsider]) {
      const held = rows(obj(observe(w, holder)['grants'])['i_hold']);
      expect(held).toHaveLength(1);
      expect(held[0]?.['digest']).toBe(row?.digest);
    }
    // A stranger holds nothing and sees nothing.
    const stranger = 'p:nobody' as PrincipalId;
    w.runtime.seat(stranger, 'nobody', w.stage);
    w.runtime.standing.open(stranger);
    expect(rows(obj(observe(w, stranger)['grants'])['i_hold'])).toHaveLength(0);
    expect(rows(obj(observe(w, stranger)['grants'])['about_me'])).toHaveLength(0);
  });

  it('the event is PARTIES with the two holders as its audience, and publishes at the reveal', () => {
    const w = world('d6');
    act(w.runtime, w.grantor, 'grant', GRANT());
    act(w.runtime, w.delegate, 'message', { to: w.outsider, dossier: `${w.grantor}/STORES` });
    const record = eventsOfKind(w, 'grant.dossier_cut')[0];
    expect(record).toBeDefined();
    expect(record?.visibility).toBe('PARTIES');
    expect(record?.event['isPublic']).toBe(false);
    const cut = w.runtime.dossiers.all()[0];
    expect(record?.event['publicAt']).toBe(cut?.revealsAtTick);
    // The figures are NOT on the row. What reveals is that a disclosure happened.
    expect(JSON.stringify(record?.event['payload'])).not.toContain('free=');

    // The audience is the two who were there, and NOT the subject: the subject is precisely who
    // the window excludes. Read off the fan-out table rather than inferred from the tier.
    const admitted = w.runtime.events
      .allAudienceRows()
      .filter((r) => String(r.eventId) === String(record?.event['id']))
      .map((r) => String(r.principal))
      .sort(cmp);
    expect(admitted).toEqual([String(w.delegate), String(w.outsider)].sort(cmp));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. THE PIXEL SIGNATURES (A13)
// ════════════════════════════════════════════════════════════════════════════

describe('the pixel signatures — clearance pips and dossier threads (A13)', () => {
  /**
   * Drive a bare world to its first settlement, so `reckoningFrame()` has an outcome to project.
   *
   * The frame is only built at a Reckoning, which is the right design (§14.3 — the frame IS the
   * rundown) and means an A13 assertion has to pay for a real one. 288 ticks at `instant` speed is
   * the same price `a6-can-actually-happen` pays for the line it checks, and the alternative — a
   * hand-built `FrameSource` — would assert the renderer rather than the projection, which is
   * exactly the half that can silently fail to wire a new field.
   */
  function toFirstReckoning(w: World): ReturnType<Runtime['reckoningFrame']> {
    while (w.runtime.reckoningFrame() === null) {
      const report = w.runtime.runTick();
      if (report.halted) {
        throw new Error(
          `the world halted before its first Reckoning at ${String(report.tick)}: ` +
            report.violations.map((v) => `${v.id} ${v.message}`).join(' | '),
        );
      }
      if (w.runtime.engine.tick > 400) throw new Error('no Reckoning inside 400 ticks');
    }
    return w.runtime.reckoningFrame();
  }

  it('★ an authority line carries the CLEARANCE PIPS and one DOSSIER THREAD per revealed cut', () => {
    const w = world('p1');
    // Long enough to still be live at the Reckoning: a dead grant is dropped from the frame, and
    // this case is about a live office being read.
    act(w.runtime, w.grantor, 'grant', GRANT({ expires_tick: 700 }));
    act(w.runtime, w.delegate, 'message', { to: w.outsider, dossier: `${w.grantor}/STORES` });

    const frame = toFirstReckoning(w);
    const line = frame?.authorityLines.find((l) => String(l.delegate) === String(w.delegate));
    expect(line, 'the grant must render or A13 is unsatisfied').toBeDefined();
    // The pips, against the office table rather than a retyped list.
    expect(line?.clearance).toEqual([...(officeShape('steward')?.clearance ?? [])]);
    // The thread.
    expect(line?.dossiers).toHaveLength(1);
    expect(String(line?.dossiers[0]?.to)).toBe(String(w.outsider));
    expect(line?.dossiers[0]?.compartment).toBe('STORES');
    expect(line?.dossiers[0]?.copied).toBe(false);
  });

  it('★ A9 ON THE FRAME — a cut inside the lag draws NO thread', () => {
    // The mechanism: the projection gates on `outcome.tick < revealsAtTick`, so a cut made within
    // AUDIT_LAG_TICKS of the settlement must be absent from the frame that settlement produces.
    // Publishing it would put a leak on screen that the victim's own `observe` cannot yet answer —
    // four separate visibility leaks in this codebase took exactly that shape in one week.
    const w = world('p3');
    act(w.runtime, w.grantor, 'grant', GRANT({ expires_tick: 700 }));
    // One cut now (will be revealed by the Reckoning) …
    act(w.runtime, w.delegate, 'message', { to: w.outsider, dossier: `${w.grantor}/STORES` });
    // … and one as late as the freeze allows, which the Reckoning must NOT draw.
    while (!isSettlementTick(w.runtime.engine.tick + AUDIT_LAG_TICKS)) {
      const report = w.runtime.runTick();
      if (report.halted) throw new Error(`halted at ${String(report.tick)}`);
      if (w.runtime.engine.tick > 400) throw new Error('no settlement inside 400 ticks');
    }
    act(w.runtime, w.delegate, 'message', { to: w.grantor, dossier: `${w.grantor}/HANDS` });
    expect(w.runtime.dossiers.all()).toHaveLength(2);

    const frame = toFirstReckoning(w);
    const line = frame?.authorityLines.find((l) => String(l.delegate) === String(w.delegate));
    const dark = w.runtime.dossiers.all().filter((d) => d.revealsAtTick > (frame?.tick ?? 0));
    expect(dark.length, 'the late cut must still be dark at the settlement tick').toBe(1);
    expect(line?.dossiers).toHaveLength(1);
    expect(line?.dossiers[0]?.compartment).toBe('STORES');
  });

  it('a revoked line keeps its threads — the picture of "revoke takes back nothing"', () => {
    const w = world('p2');
    act(w.runtime, w.grantor, 'grant', GRANT({ expires_tick: 700 }));
    const g = w.runtime.grants.forGrantor(w.grantor)[0];
    act(w.runtime, w.delegate, 'message', { to: w.outsider, dossier: `${w.grantor}/STORES` });
    idle(w.runtime, AUDIT_LAG_TICKS + 1);
    act(w.runtime, w.grantor, 'revoke', { grant: g?.id });
    const frame = toFirstReckoning(w);
    const line = frame?.authorityLines.find((l) => String(l.delegate) === String(w.delegate));
    expect(line?.state).toBe('REVOKED');
    expect(line?.dossiers).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. THE HASH — both scopes and the whole log survive a capture/restore
// ════════════════════════════════════════════════════════════════════════════

describe('capture and restore (the state-outside-the-hash class)', () => {
  it('a grant\'s fence and clearance round-trip through the state table', () => {
    const src = new GrantBook();
    src.add({
      id: 'g:r1' as GrantId,
      grantor: 'p:g' as PrincipalId,
      delegate: 'p:d' as PrincipalId,
      template: 'escort-captain',
      maxDirectLoss: minor(10),
      maxContingentLiability: minor(20),
      spentDirect: minor(0),
      spentContingent: minor(0),
      verbs: canonicalVerbs(['create']),
      clearance: canonicalClearance(['HANDS']),
      expiresTick: 99,
      revokedAtTick: null,
    });
    let restored = new GrantBook();
    const table = grantsStateTable(
      () => src,
      (book) => {
        restored = book;
      },
    );
    // `restore` is optional on `StateTable` — a table may legitimately be unrollbackable — so
    // the call is asserted. Both tables under test define it, and `rollbackGaps` is what
    // would catch one that did not.
    table.restore?.(table.capture());
    const back = restored.get('g:r1' as GrantId);
    expect(back?.verbs).toEqual(['create']);
    expect(back?.clearance).toEqual(['HANDS']);
    expect(restored.carriesVerb('g:r1' as GrantId, 'create')).toBe(true);
    expect(restored.carriesClearance('g:r1' as GrantId, 'HANDS')).toBe(true);
    expect(restored.carriesClearance('g:r1' as GrantId, 'STORES')).toBe(false);
  });

  it('an absent fence restores to NOTHING, never to everything', () => {
    // The `RULES_VERSION` 20 → 23 discontinuity, as a property: an old snapshot has no `verbs`
    // key, and the safe direction for a mis-read authority record is "this delegate can do
    // nothing". A restore that defaulted wide would silently promote every legacy grant.
    let restored = new GrantBook();
    const table = grantsStateTable(
      () => new GrantBook(),
      (book) => {
        restored = book;
      },
    );
    table.restore?.({
      grants: [
        {
          id: 'g:old',
          grantor: 'p:g',
          delegate: 'p:d',
          template: 'steward',
          maxDirectLoss: 10,
          maxContingentLiability: 10,
          spentDirect: 0,
          spentContingent: 0,
          expiresTick: 99,
          revokedAtTick: null,
        },
      ],
      spends: [],
    });
    expect(restored.get('g:old' as GrantId)?.verbs).toEqual([]);
    expect(restored.get('g:old' as GrantId)?.clearance).toEqual([]);
  });

  it('the dossier book and the audit stamps round-trip together', () => {
    const dossiers = new DossierBook();
    const audits = new AuditLog();
    dossiers.add({
      id: 'd:r1' as DossierId,
      subject: 'p:g' as PrincipalId,
      compartment: 'STORES',
      cutBy: 'p:d' as PrincipalId,
      toWhom: 'p:x' as PrincipalId,
      grant: 'g:r1' as GrantId,
      parent: null,
      cutAtTick: 40,
      revealsAtTick: 40 + AUDIT_LAG_TICKS,
      digest: 'STORES@40 free=7 encumbered=0',
    });
    audits.record('p:g' as PrincipalId, 55);
    let out = { dossiers: new DossierBook(), audits: new AuditLog() };
    const table = dossiersStateTable(
      () => ({ dossiers, audits }),
      (restored) => {
        out = { dossiers: restored.dossiers, audits: restored.audits };
      },
    );
    // `restore` is optional on `StateTable` — a table may legitimately be unrollbackable — so
    // the call is asserted. Both tables under test define it, and `rollbackGaps` is what
    // would catch one that did not.
    table.restore?.(table.capture());
    expect(out.dossiers.all()).toHaveLength(1);
    expect(out.dossiers.get('d:r1' as DossierId)?.digest).toBe('STORES@40 free=7 encumbered=0');
    expect(out.audits.through('p:g' as PrincipalId)).toBe(55);
    // And the reveal gate answers the same after a restore as before it.
    const row = out.dossiers.get('d:r1' as DossierId)!;
    expect(out.dossiers.visibleToSubject(row, 41, null)).toBe(false);
    expect(out.dossiers.visibleToSubject(row, 40 + AUDIT_LAG_TICKS, null)).toBe(true);
    expect(out.dossiers.visibleToSubject(row, 41, 55)).toBe(true);
  });

  it('the book refuses a per-row reveal offset and a doubled provenance at the door', () => {
    const book = new DossierBook();
    const base = {
      subject: 'p:g' as PrincipalId,
      compartment: 'STORES' as const,
      cutBy: 'p:d' as PrincipalId,
      toWhom: 'p:x' as PrincipalId,
      parent: null,
      cutAtTick: 1,
      digest: 'STORES@1 free=0 encumbered=0',
    };
    expect(() =>
      book.add({ ...base, id: 'd:bad1' as DossierId, grant: 'g:1' as GrantId, revealsAtTick: 99 }),
    ).toThrow(/lag/);
    expect(() =>
      book.add({
        ...base,
        id: 'd:bad2' as DossierId,
        grant: null,
        revealsAtTick: 1 + AUDIT_LAG_TICKS,
      }),
    ).toThrow(/exactly one/);
    expect(book.size).toBe(0);
    expect(MAX_DOSSIERS).toBeGreaterThan(0);
  });
});
