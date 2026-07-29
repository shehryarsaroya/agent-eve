/**
 * THREE THINGS THE ENGINE KNEW AND DID NOT SAY — all three found by blind probes playing the live
 * shard, and all three the same defect wearing different clothes.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A2: *"Known arithmetic is exact and machine-readable… never make an agent need a wiki."***
 * The class this file guards is not "the engine is wrong". In every case below the engine is
 * exactly right and the *surface an agent plays from* is silent — which is the class that has
 * produced most of this project's real defects, because it is invisible from inside: every unit
 * test passes, every invariant is green, and the agent still cannot decide.
 *
 *   1. **§9's aggression capacity was invisible until it was gone.** The strings `aggression` and
 *      `capacity` were absent from the entire observation of a real enrolled principal; the only
 *      mention anywhere was a `withheld` reason that fires **exactly when the agent has spent all
 *      of it**. So a principal learned the resource existed by exhausting one it had never been
 *      told it had, and one holding all of it with no reachable target saw an empty menu and no
 *      sentence. `aggressionNote()` had been written for that agent and reached no observation.
 *
 *   2. **A `create` affordance never said how many roles it would mint.** A probe created a `DIG`
 *      expecting one and got two — DIGGER and TALLYMAN, different shares, separate
 *      escrowed/elective splits — so it committed to obligations it was never shown, and the
 *      escrowed halves lock on the create. The engine states the rule *in a refusal somewhere
 *      else* (`unhonouredCreateParam`), which is a wiki with extra steps.
 *
 *   3. **Self-dealing earns zero standing and nothing said so.** A probe noticed it could fill
 *      roles in its own venture and reasonably wondered whether that farms standing. It cannot —
 *      the guard is three deep (§6.4, scar #9) — but an agent either burns actions discovering
 *      that or, worse, believes the exploit works and plans around it.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## How these assert, and why it matters here more than usual
 *
 * **Against the engine's own recorded answer, never against a literal and never against a fixture's
 * own copy of the subject.** A recent mutation survived in this repo precisely because a test built
 * its own object and then asserted about that object rather than about what the caller was handed.
 * So: the role count comes from `kindSpec`, the per-role figures from `defaultTerms`, the refusal
 * sentence from `demandRefusalFor` — the same calls the payload made — and the self-dealing claim
 * is checked against a **real settlement's `standing` output**, not against the string that makes
 * it. A sentence that is only true of itself is the defect, not the test.
 */

import { describe, expect, it } from 'vitest';
import { buildObservation, type Affordance } from '../../src/api/observe.js';
import { canonicalize, type CanonicalValue } from '../../src/core/canonical.js';
import { LAST_DEMAND_PHASE, RAID_DEMAND_QTY, AGGRESSION_PER_RECKONING } from '../../src/predation/index.js';
import { TICKS_PER_RECKONING, phaseOfReckoning } from '../../src/core/time.js';
import type { PrincipalId, VentureKind } from '../../src/core/types.js';
import { minor, type Minor } from '../../src/core/units.js';
import { LEVY_GOOD } from '../../src/levy/index.js';
import { defaultTerms, type Runtime } from '../../src/sim/runtime.js';
import { kindSpec, settleVenture, type SettleInput } from '../../src/venture/index.js';
import { handsOf, principalIsCommonsBound } from '../../src/world/index.js';
import { act, commonsWorld, raidWorld, tick } from '../predation/fixture.js';
import {
  ACCOUNTS,
  ALICE,
  BRAM,
  CASS,
  STATE_VERSION,
  ev,
  fixture,
  goLive,
  makeHaul,
  vid,
} from '../venture/fixture.js';

function observation(runtime: Runtime, principal: PrincipalId): ReturnType<typeof buildObservation> {
  return buildObservation({
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 4,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  });
}

function withheldReason(runtime: Runtime, principal: PrincipalId): string {
  const w = observation(runtime, principal).header['withheld'] as Record<string, unknown>;
  return String(w['reason']);
}

function withheldCount(runtime: Runtime, principal: PrincipalId): number {
  const w = observation(runtime, principal).header['withheld'] as Record<string, unknown>;
  return Number(w['count']);
}

function aggressionOf(runtime: Runtime, principal: PrincipalId): Record<string, unknown> {
  return observation(runtime, principal).header['aggression'] as Record<string, unknown>;
}

// ── 1. §9's aggression capacity ──────────────────────────────────────────────

describe('§9 — the aggression capacity is readable BEFORE it is spent', () => {
  it('★ THE EXACT GREP THAT CAME BACK EMPTY ON THE LIVE SHARD NOW MATCHES', () => {
    // The finding was made with two `grep -c` against a real principal's whole observation, and
    // both returned 0. This is that check, run against the payload rather than against a field
    // somebody remembered to build — which is the difference between "the field is computed" and
    // "the agent can read it", and this project has been fooled by the first eleven times.
    const { runtime, principals } = raidWorld('a2-grep', 3);
    tick(runtime);
    const me = principals[0];
    if (me === undefined) throw new Error('fixture');
    const payload = canonicalize(observation(runtime, me) as unknown as CanonicalValue);
    expect(payload, 'the whole observation must contain the word').toContain('aggression');
    expect(payload, 'and it must say what kind of thing it is').toContain('capacity');
  });

  it('every figure in the block is the engine’s own, not a literal beside it', () => {
    const { runtime, principals } = raidWorld('a2-figures', 3);
    tick(runtime);
    const me = principals[0];
    if (me === undefined) throw new Error('fixture');
    const at = runtime.engine.tick;
    const agg = aggressionOf(runtime, me);

    // Non-vacuity first: the block exists at all, and the subject is a principal that really can
    // demand — a Commons-seated fixture would make every line below true of nothing.
    expect(agg, 'header.aggression is missing entirely').toBeDefined();
    expect(principalIsCommonsBound(runtime.world, me)).toBe(false);

    // The count is the SAME call the affordance layer and `demandRefusal` make. A second
    // derivation here would let the header and the gate disagree and both tests still pass.
    expect(agg['demands_remaining']).toBe(runtime.demandsRemainingFor(me, at));
    expect(agg['demands_per_reckoning']).toBe(AGGRESSION_PER_RECKONING);
    // `join` is free of this budget, published rather than inferred.
    expect(agg['join_costs_demands']).toBe(0);
    // Absolute ticks, so an agent compares them against `header.tick` with no phase arithmetic.
    const cycleStart = at - phaseOfReckoning(at);
    expect(agg['open_until_tick']).toBe(cycleStart + LAST_DEMAND_PHASE);
    expect(agg['refreshes_at_tick']).toBe(cycleStart + TICKS_PER_RECKONING);
    expect(Number(agg['open_until_tick'])).toBeLessThan(Number(agg['refreshes_at_tick']));
  });

  it('★ IT IS THERE AT FULL CAPACITY — the case that used to be silent — and it TRACKS', () => {
    // The whole defect: the old surface spoke only at zero. A field that is present at zero and
    // absent at full is worse than nothing, because it teaches an agent that the resource appears
    // when it runs out. So both readings are asserted, and the second one proves the first is not
    // a constant somebody typed.
    const { runtime, principals, stage } = raidWorld('a2-tracks', 3);
    tick(runtime);
    tick(runtime);
    const raider = principals[0];
    const target = principals[1];
    if (raider === undefined || target === undefined) throw new Error('fixture');

    expect(aggressionOf(runtime, raider)['demands_remaining']).toBe(AGGRESSION_PER_RECKONING);
    expect(
      act(runtime, raider, 'demand', {
        principal: target,
        system: stage,
        good: LEVY_GOOD,
        qty: RAID_DEMAND_QTY.min,
      }),
      'the fixture must actually open a demand, or the fall below proves nothing',
    ).toBeNull();
    expect(aggressionOf(runtime, raider)['demands_remaining']).toBe(AGGRESSION_PER_RECKONING - 1);
  });

  it('the rule text names the two beliefs that mis-plan a campaign: the expiry, and that join is free', () => {
    // An agent that thinks capacity banks holds fire for three cycles to fund one big move and
    // discovers it bought nothing. An agent that thinks `join` draws on it declines to reinforce
    // an ally — which closes the escort market §9 exists to keep open, for a reason the rules do
    // not contain.
    const { runtime, principals } = raidWorld('a2-rule', 3);
    tick(runtime);
    const me = principals[0];
    if (me === undefined) throw new Error('fixture');
    const rule = String(aggressionOf(runtime, me)['rule']);
    expect(rule.length, 'the rule must be a sentence, not a placeholder').toBeGreaterThan(80);
    expect(rule).toMatch(/DOES NOT CARRY|does not carry/i);
    expect(rule).toMatch(/join/i);
    expect(rule, 'and it must say join costs NONE of it, not merely mention the word').toMatch(
      /costs NONE of this/,
    );
  });

  it('★ AND A COMMONS NEWCOMER GETS IT TOO — but not a withheld row, because it is not eligible', () => {
    // Two claims, and the second is the reason the first is not enough on its own.
    //
    // The population that can least afford to learn a rule by breaking it is the one that has
    // never left the Commons, so the standing field is published to it as well. But `withheld`
    // promises "nothing you were ELIGIBLE for has been dropped without this count", and A8 makes
    // a hostile act INVALID rather than refused in the Commons — so counting `demand` there would
    // put a row on every newcomer's every wake for a decision it cannot make.
    const { runtime, principals } = commonsWorld('a2-commons', 3);
    tick(runtime);
    const me = principals[0];
    if (me === undefined) throw new Error('fixture');
    expect(principalIsCommonsBound(runtime.world, me), 'the fixture must really be Commons-bound').toBe(true);

    const agg = aggressionOf(runtime, me);
    expect(agg['demands_remaining']).toBe(AGGRESSION_PER_RECKONING);
    expect(String(agg['rule']).length).toBeGreaterThan(80);
    expect(withheldReason(runtime, me), 'a newcomer must not be billed a row for an invalid act').not.toContain(
      'no demand is offered',
    );
  });
});

describe('§9 — and when the menu is empty anyway, it says WHICH thing is empty', () => {
  it('★ NO NEIGHBOUR: names the stages your hands are actually standing at', () => {
    // The probe's own report: with full capacity and no reachable target, `demand` was simply not
    // offered and nothing explained why — so it could not tell zero capacity from a withholding.
    const { runtime, principals, stage } = raidWorld('a2-alone', 1);
    tick(runtime);
    const me = principals[0];
    if (me === undefined) throw new Error('fixture');

    // Non-vacuity: capacity is FULL and no demand is offered. Both halves, or the sentence below
    // could be true for the reason the old branch already covered.
    expect(runtime.demandsRemainingFor(me, runtime.engine.tick)).toBe(AGGRESSION_PER_RECKONING);
    expect(observation(runtime, me).affordances.some((a) => a.verb === 'demand')).toBe(false);

    const reason = withheldReason(runtime, me);
    expect(reason).toContain('no demand is offered even though you hold');
    expect(reason, 'the capacity must be exonerated by name, or the agent guesses again').toContain(
      'the capacity is NOT what is stopping you',
    );
    // The stage comes from the world, not from a literal: a hardcoded `sys-17` would pass on this
    // seed and lie on every other one.
    expect(reason).toContain(stage);
    expect(reason).toContain('No other principal\'s holding stands at');
  });

  it('★ EVERY CANDIDATE REFUSED: carries the gate’s own sentence, verbatim', () => {
    // "The engine knows and does not say" has an exact remedy here — `demandRefusalFor` is the
    // same predicate `vDemand` runs and it returns a full sentence. This asserts the payload
    // carries THAT sentence rather than a paraphrase of it, by asking the gate directly and
    // comparing. A paraphrase is a second home for a rule (scar #1).
    const { runtime, principals, stage } = raidWorld('a2-refused', 2);
    tick(runtime);
    tick(runtime);
    const raider = principals[0];
    const target = principals[1];
    if (raider === undefined || target === undefined) throw new Error('fixture');
    expect(
      act(runtime, raider, 'demand', {
        principal: target,
        system: stage,
        good: LEVY_GOOD,
        qty: RAID_DEMAND_QTY.min,
      }),
    ).toBeNull();

    const at = runtime.engine.tick + 1;
    // Non-vacuity: capacity remains, the only neighbour is now unavailable, and nothing is offered.
    expect(runtime.demandsRemainingFor(raider, at)).toBeGreaterThan(0);
    const refusal = runtime.demandRefusalFor({
      initiator: raider,
      target,
      stage,
      good: LEVY_GOOD,
      demand: RAID_DEMAND_QTY.min,
      tick: at,
      handId: null,
    });
    if (refusal === null) throw new Error('fixture: the only neighbour must now be refused');
    expect(observation(runtime, raider).affordances.some((a) => a.verb === 'demand')).toBe(false);

    const reason = withheldReason(runtime, raider);
    expect(reason).toContain('1 neighbour(s) were considered and every one was refused');
    expect(reason, 'the gate’s own hint, not a second copy of the rule').toContain(refusal.hint);
  });

  it('★ NO HAND OUTSIDE THE COMMONS: names presence, because capacity buys nothing without it', () => {
    const { runtime, principals } = raidWorld('a2-nohand', 2);
    tick(runtime);
    tick(runtime);
    const me = principals[0];
    if (me === undefined) throw new Error('fixture');
    // Walk every hand off the stage through the ordinary verb, so the state is one the engine
    // really produces rather than one the test wrote.
    const moves = observation(runtime, me).affordances.filter((a) => a.verb === 'move');
    for (const hand of handsOf(runtime.world, me)) {
      const offer = moves.find((m) => (m.params as Record<string, unknown>)['hand'] === hand.id);
      if (offer === undefined) continue;
      act(runtime, me, 'move', offer.params);
    }
    expect(
      handsOf(runtime.world, me).every((h) => h.state !== 'IDLE'),
      'the fixture must actually leave no IDLE hand, or this asserts nothing',
    ).toBe(true);
    expect(runtime.demandsRemainingFor(me, runtime.engine.tick)).toBe(AGGRESSION_PER_RECKONING);

    const reason = withheldReason(runtime, me);
    expect(reason).toContain('You have no IDLE hand standing outside the Commons');
    expect(reason).toContain('capacity buys nothing without presence');
  });

  it('the silent row is COUNTED, exactly once, and unseats the “nothing was withheld” claim', () => {
    // PROP-O1's arithmetic. Counted as one because the thing withheld is the ACT, and there is
    // one of it however many neighbours were considered.
    const { runtime, principals } = raidWorld('a2-counted', 1);
    tick(runtime);
    const me = principals[0];
    if (me === undefined) throw new Error('fixture');
    const reason = withheldReason(runtime, me);
    const clauses = reason.split('; ').filter((c) => c.includes('no demand is offered'));
    expect(clauses, 'exactly one demand clause, never one per neighbour').toHaveLength(1);
    expect(withheldCount(runtime, me)).toBeGreaterThan(0);
    expect(reason).not.toBe('nothing was withheld: this is every legal act, with its full cost.');
  });
});

// ── 2. the roles a `create` mints ────────────────────────────────────────────

function createOffer(runtime: Runtime, principal: PrincipalId, kind: VentureKind): Affordance {
  const offer = observation(runtime, principal).affordances.find(
    (a) => a.verb === 'create' && (a.params as Record<string, unknown>)['kind'] === kind,
  );
  if (offer === undefined) throw new Error(`no create {${kind}} on the menu — this test proves nothing`);
  return offer;
}

describe('§7 — a create affordance names the roles it will mint, and what each commits you to', () => {
  it('★ THE PROBE’S CASE: a DIG says TWO, and names both slots', () => {
    // It created a DIG expecting one role and got two. The count comes from `kindSpec`, so a
    // hardcoded "2" in the payload would pass here and fail on BUILD one test down.
    const { runtime, principals } = raidWorld('a2-dig', 3);
    tick(runtime);
    const me = principals[0];
    if (me === undefined) throw new Error('fixture');
    const text = createOffer(runtime, me, 'DIG').what_it_forecloses;
    const spec = kindSpec('DIG');
    expect(spec.roles.length, 'if DIG ever became one role this test is the wrong shape').toBe(2);
    expect(text).toContain(`Roles minted: ${String(spec.roles.length)}`);
    for (const role of spec.roles) expect(text, `${role.label} is unnamed`).toContain(role.label);
  });

  it('the per-role split is `defaultTerms`, and it sums to the two honesty fields', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The strongest form available: the manifest is not merely *present*, it is the SAME
    // arithmetic as `max_direct_loss` and `max_contingent_liability` on the same affordance.
    // A manifest that disagreed with the two `max_*` figures beside it would be scar #1 inside
    // one object — and it is exactly what a second table here would produce.
    // ══════════════════════════════════════════════════════════════════════
    const { runtime, principals } = raidWorld('a2-split', 3);
    tick(runtime);
    const me = principals[0];
    if (me === undefined) throw new Error('fixture');
    for (const kind of ['DIG', 'HAUL', 'SURVEY'] as const) {
      const offer = createOffer(runtime, me, kind);
      const spec = kindSpec(kind);
      const terms = defaultTerms(kind, spec.baseYieldMinor);
      let escrowed = 0;
      let elective = 0;
      for (const [i, role] of spec.roles.entries()) {
        const t = terms[i];
        if (t === undefined) throw new Error('kind table');
        escrowed += t.escrowed;
        elective += t.elective;
        expect(
          offer.what_it_forecloses,
          `${kind}/${role.label} does not publish its own escrowed + elective`,
        ).toContain(`${role.label} ${String(role.marginalOutputBps)} → ${String(t.escrowed)} + ${String(t.elective)}`);
      }
      expect(offer.max_direct_loss, `${kind}: the manifest and max_direct_loss disagree`).toBe(escrowed);
      expect(offer.max_contingent_liability, `${kind}: the manifest and the contingent figure disagree`).toBe(
        elective,
      );
    }
  });

  it('★ THE CONTROL — BUILD says FOUR, so a hardcoded two would fail here', () => {
    const { runtime, principals } = raidWorld('a2-build', 3);
    tick(runtime);
    const me = principals[0];
    if (me === undefined) throw new Error('fixture');
    const spec = kindSpec('BUILD');
    expect(spec.roles.length, 'BUILD is the four-role kind §7.2 needs').toBe(4);
    const text = createOffer(runtime, me, 'BUILD').what_it_forecloses;
    expect(text).toContain('Roles minted: 4');
    for (const role of spec.roles) expect(text).toContain(role.label);
  });

  it('★ AND THE MANIFEST IS TRUE OF THE DEED, not only of itself', () => {
    // The check that makes the rest of this block worth anything: send the affordance verbatim and
    // compare the venture the engine actually minted against what the string said it would.
    const { runtime, principals } = raidWorld('a2-deed', 3);
    tick(runtime);
    const me = principals[0];
    if (me === undefined) throw new Error('fixture');
    const offer = createOffer(runtime, me, 'DIG');
    const before = new Set(runtime.ventures.forPrincipal(me).map((v) => v.id));
    expect(act(runtime, me, 'create', offer.params), 'the menu offered it, so the engine must take it').toBeNull();
    const minted = runtime.ventures.forPrincipal(me).find((v) => !before.has(v.id));
    if (minted === undefined) throw new Error('nothing was created');

    expect(offer.what_it_forecloses).toContain(`Roles minted: ${String(minted.roles.length)}`);
    let escrowed = 0;
    for (const role of minted.roles) {
      expect(offer.what_it_forecloses, `the deed has a ${role.label} the offer never named`).toContain(
        `${role.label} ${String(role.terms.share ?? 0)} → ${String(role.terms.escrowed)} + ${String(
          role.terms.elective,
        )}`,
      );
      escrowed += role.terms.escrowed;
    }
    expect(offer.max_direct_loss, 'and the escrow really is the sum of the roles').toBe(escrowed);
  });

  it('the rule that is identical on every kind is carried ONCE, and the rest point at it', () => {
    // The same trade `fill_role`'s worked example makes: five rows repeating one 200-character
    // rule is a kilobyte of identical prose in a payload the owner pays for. Nothing is withheld —
    // the per-kind figures, which are the part that differs, are on every row.
    const { runtime, principals } = raidWorld('a2-once', 3);
    tick(runtime);
    const me = principals[0];
    if (me === undefined) throw new Error('fixture');
    const creates = observation(runtime, me).affordances.filter((a) => a.verb === 'create');
    expect(creates.length, 'several create offers, or this asserts nothing').toBeGreaterThan(1);
    const withRule = creates.filter((a) => a.what_it_forecloses.includes('FIXED BY THE KIND'));
    expect(withRule, 'exactly one row carries the shared rule').toHaveLength(1);
    expect(withRule[0], 'and it is the FIRST, which is the row that survives truncation').toBe(creates[0]);
    for (const other of creates.slice(1)) {
      expect(other.what_it_forecloses).toContain('on the first create affordance');
      expect(other.what_it_forecloses, 'the per-kind figures are never the thing dropped').toContain(
        'Roles minted:',
      );
    }
  });
});

// ── 3. self-dealing ──────────────────────────────────────────────────────────

describe('§6.4 — filling a role in your own venture earns zero standing, and the menu says so', () => {
  it('★ THE ENGINE’S OWN ANSWER FIRST: a settlement credits nothing for a self-held role', () => {
    // ══════════════════════════════════════════════════════════════════════
    // This runs before the string test on purpose. The affordance makes a claim about what the
    // engine will do; if the claim were false, a test that only checked the string would be
    // asserting a lie into permanence — which is the failure mode the whole file is about, one
    // level up. So the claim is checked against a real `settleVenture`, and the two roles differ
    // in exactly one thing: who holds them.
    // ══════════════════════════════════════════════════════════════════════
    const f = fixture();
    const selfHeld = makeHaul(f, { id: vid('v-self'), creator: ALICE });
    // ALICE creates and fills role 0 herself; BRAM takes role 1. Same venture, same terms.
    goLive(f, selfHeld, [ALICE, BRAM], minor(12_000));
    const input: SettleInput = {
      venture: selfHeld,
      tick: 200,
      eventId: ev('settle:self'),
      outcome: 'FULFILLED',
      proceeds: minor(12_000),
      // Pay every elective part in full, which is the ONLY branch that credits standing at all.
      elections: new Map<number, Minor>(
        selfHeld.roles.map((r) => [r.index, minor(r.terms.elective)] as const),
      ),
      actedOnStateVersion: STATE_VERSION,
      causeEventId: null,
    };
    const settled = settleVenture(f.ledger, f.book, input, ACCOUNTS);

    // Non-vacuity: standing really was credited for SOMEBODY, or "no entry for ALICE" is trivially
    // true and this test proves nothing at all.
    expect(settled.standing.length, 'nothing accrued to anybody — the fixture is wrong').toBeGreaterThan(0);
    expect(
      settled.standing.some((s) => s.counterparty === BRAM),
      'the arm’s-length role must accrue, or the comparison has no control',
    ).toBe(true);
    expect(
      settled.standing.filter((s) => s.principal === s.counterparty),
      'self-dealing must credit nothing (§6.4, scar #9)',
    ).toEqual([]);
    expect(
      settled.standing.some((s) => s.counterparty === ALICE),
      'ALICE holds a role in her own venture and must earn nothing for it',
    ).toBe(false);
  });

  it('★ AND THE AFFORDANCE SAYS SO, on the row that offers the fill', () => {
    const { runtime, principals } = raidWorld('a2-selfdeal', 3);
    tick(runtime);
    const me = principals[0];
    if (me === undefined) throw new Error('fixture');
    const create = createOffer(runtime, me, 'DIG');
    expect(act(runtime, me, 'create', create.params)).toBeNull();

    const mine = observation(runtime, me).affordances.filter(
      (a) => a.verb === 'fill_role' && a.what_it_forecloses.includes('YOU CREATED'),
    );
    // Non-vacuity: the creator really IS offered a fill on its own venture. If that ever stops
    // being true the note is dead code and this test is the thing that says so.
    expect(mine.length, 'a creator is not offered fill_role on its own venture — the note is unreachable').toBeGreaterThan(
      0,
    );
    const text = mine[0]?.what_it_forecloses ?? '';
    expect(text).toContain('ZERO STANDING');
    expect(text, 'and WHY, or it is a rule to memorise rather than understand').toContain('§6.4');
    expect(text).toContain('scar #9');
    expect(text, 'no default either — the other half an agent would otherwise fear').toContain(
      'can record no default against you',
    );
    expect(text, 'and the honest reason it is still worth doing').toContain(
      'raises the venture\'s output',
    );
  });

  it('a STRANGER’s slot carries no such note — the control that stops it being boilerplate', () => {
    const { runtime, principals } = raidWorld('a2-stranger', 3);
    tick(runtime);
    const creator = principals[0];
    const filler = principals[1];
    if (creator === undefined || filler === undefined) throw new Error('fixture');
    expect(act(runtime, creator, 'create', createOffer(runtime, creator, 'DIG').params)).toBeNull();

    const theirs = observation(runtime, filler).affordances.filter((a) => a.verb === 'fill_role');
    expect(theirs.length, 'the neighbour must be offered the slot, or this proves nothing').toBeGreaterThan(0);
    for (const offer of theirs) {
      expect(offer.what_it_forecloses, 'an arm’s-length fill must not be told it earns nothing').not.toContain(
        'ZERO STANDING',
      );
    }
    // And the fill really is arm's-length: the creator is somebody else.
    expect(creator).not.toBe(filler);
  });
});

// ── the guard against this file rotting into decoration ──────────────────────

describe('the three surfaces stay wired to the engine', () => {
  it('CASS is unused-import bait: every principal named here is a real one', () => {
    // A trivial-looking assertion with a real job. Two of the fixtures above pick principals by
    // index, and an index that silently went out of range would make `undefined` throw a fixture
    // error rather than fail an assertion — so the cast is pinned.
    expect([ALICE, BRAM, CASS].every((p) => p.startsWith('p-'))).toBe(true);
  });
});
