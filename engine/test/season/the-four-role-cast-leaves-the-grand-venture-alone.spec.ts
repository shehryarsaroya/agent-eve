/**
 * ★ **THE CAST'S FOUR-ROLE HABITS NEVER TOUCH THE SEASON'S GRAND VENTURE** (Season 1 merge).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Two Season 1 lanes taught the house cast about BUILDs, independently. The contact lane made it open a
 * four-role BUILD about once a Reckoning per tier, staff it (`topYieldSlotFor` — the creator works role 0,
 * cast-mates spread across the rest), refuse a second one in a tier that already has one
 * (`topYieldCreateFor`) and honour it IN_FULL because a top-yield kind pays its own elective half
 * (`electionFor`). The season lane made the grand venture a BUILD with `"grand": true`, whose roles are
 * presence at the stage and a stake of earned capital, and whose shares its creator answers BY ITS CREED
 * — a MERCENARY keeps the yield.
 *
 * Every one of the contact lane's three rules matches a grand venture by kind. Each would be wrong on it:
 * a slot taken through the ordinary path carries no stake and `grandFillRejection` refuses it every
 * tick; a live grand candidate would bar its creator from an ordinary BUILD all FINALE; and IN_FULL on a
 * grand share would overrule a KEEP creed — the season's exam question answered by a branch that never
 * read it. This file pins all three skips, against a creator whose creed is to KEEP.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { CAST_GRAND_POLICY, HeuristicCast, type CastMember } from '../../src/cast/heuristic.js';
import { stanceFor } from '../../src/cast/stance.js';
import { Rng } from '../../src/core/rng.js';
import { setSpeed } from '../../src/core/time.js';
import type { PrincipalId, SystemId, VentureId } from '../../src/core/types.js';
import { grandStageFor } from '../../src/season/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { IN_FULL, isTopYield } from '../../src/venture/index.js';
import { act, earn, grandVentures, idleAt, submit, tick, WINDOW } from './fixture.js';

/** The two private branches under test, reached the way a unit test reaches a private seam. */
interface FourRoleBranches {
  topYieldSlotFor(member: CastMember, tick: number): { readonly venture: string; readonly role: number } | null;
  topYieldCreateFor(
    member: CastMember,
    tick: number,
    rng: Rng,
    spendable: number,
    idle: readonly { readonly location: SystemId }[],
  ): { readonly verb: string; readonly params: Readonly<Record<string, unknown>> } | null;
}

const SEED = 'cf-b';
// `brannock` draws MERCENARY on `cf-b` (`the-cast-takes-the-finale.spec.ts` pins it), so its creed KEEPS
// the yield. Index 0, so it is a digger seated in the Commons with three Commons cast-mates behind it.
const CREATOR_HANDLE = 'brannock';
const NAMES = [CREATOR_HANDLE, 'varrow', 'halcyon', 'vex', 'sable'] as const;
const CREW = ['p:crew-a', 'p:crew-b', 'p:crew-c', 'p:crew-d'] as PrincipalId[];

interface Setup {
  readonly runtime: Runtime;
  readonly cast: HeuristicCast;
  readonly creator: CastMember;
  readonly stage: SystemId;
  readonly grand: VentureId;
}

/** A FINALE with one grand candidate FORMING, created by a cast member whose creed is to KEEP. */
function finaleWithAKeepingCreator(): Setup {
  setSpeed('instant');
  const runtime = new Runtime({ seed: SEED, startTick: WINDOW.opens_tick - 1 });
  const stage = grandStageFor(runtime.world.map, 1);
  if (stage === null) throw new Error('the launch map has no Frontier');
  const cast = new HeuristicCast(runtime, { size: NAMES.length, names: NAMES, topYieldChanceBps: 10_000 });
  cast.seat(SEED);
  const creator = cast.roster.find((m) => m.handle === CREATOR_HANDLE);
  if (creator === undefined) throw new Error('the creator was not seated');
  earn(runtime, creator.principal, 200_000);
  for (const p of CREW) {
    runtime.seat(p, p.replace('p:', ''), stage);
    runtime.standing.open(p);
    earn(runtime, p, 200_000);
  }
  const refused = act(runtime, creator.principal, 'create', { kind: 'BUILD', stage, grand: true });
  if (refused !== null) throw new Error(`grand create refused: ${refused.invariant} ${refused.hint}`);
  const grand = grandVentures(runtime)[0];
  if (grand === undefined) throw new Error('no grand candidate formed');
  return { runtime, cast, creator, stage, grand: grand.id };
}

describe('★ the four-role cast leaves the season\'s grand venture to the season\'s own branches', () => {
  it('the creator\'s creed is KEEP, so the IN_FULL rule would be the wrong answer (non-vacuity)', () => {
    expect(stanceFor(CREATOR_HANDLE, SEED)).toBe('MERCENARY');
    expect(CAST_GRAND_POLICY.MERCENARY).toBe('KEEP');
  });

  it('SLOT FILLING: a member standing in the grand stage\'s own tier is never handed a grand role by the four-role path', () => {
    const { runtime, cast, stage, grand } = finaleWithAKeepingCreator();
    const branches = cast as unknown as FourRoleBranches;
    // A member SEATED at the Frontier stage, so `topYieldSlotFor`'s tier test admits the grand venture —
    // the case the skip exists for. Synthetic, because the house cast seats only in the Commons and the
    // Marches; the branch reads nothing but the member's principal and seat.
    const frontiersman: CastMember = { principal: 'p:frontiersman' as PrincipalId, handle: 'frontiersman', role: 'digger', seat: stage };
    expect(runtime.ventures.require(grand).state).toBe('FORMING');
    expect(branches.topYieldSlotFor(frontiersman, runtime.engine.tick + 1), 'never a grand role').toBeNull();

    // And the branch is live there: an ORDINARY BUILD forming on the same stage IS offered to that member.
    const builder = 'p:builder' as PrincipalId;
    runtime.seat(builder, 'builder', stage);
    runtime.standing.open(builder);
    const refused = act(runtime, builder, 'create', { kind: 'BUILD', stage });
    expect(refused, 'an ordinary BUILD at the Frontier stage is legal').toBeNull();
    const ordinary = runtime.ventures.all().find((v) => isTopYield(v.kind) && v.grand === null && v.creator === builder);
    expect(ordinary?.state).toBe('FORMING');
    const slot = branches.topYieldSlotFor(frontiersman, runtime.engine.tick + 1);
    expect(slot?.venture, 'the four-role path takes the ordinary BUILD and only it').toBe(ordinary?.id);
  });

  it('ONE PER TIER: a live grand candidate does not bar its creator from an ordinary four-role BUILD', () => {
    const { runtime, cast, creator } = finaleWithAKeepingCreator();
    const branches = cast as unknown as FourRoleBranches;
    // Inside the four-role phase window, on a stream that always rolls yes (topYieldChanceBps 10,000).
    while (runtime.engine.tick < WINDOW.opens_tick + 4) tick(runtime);
    const at = runtime.engine.tick + 1;
    const hand = runtime.world.hands.get(idleAt(runtime, creator.principal, creator.seat));
    if (hand === undefined) throw new Error('no idle hand');
    const made = branches.topYieldCreateFor(creator, at, Rng.fromSeed(`${SEED}:test:${String(at)}`), 1, [hand]);
    expect(made, 'the grand candidate it created is not "a four-role venture live in this tier"').not.toBeNull();
    expect(made?.params['kind']).toBe('BUILD');
    expect(made?.params['grand'], 'and what it opens is an ordinary BUILD').toBeUndefined();
  });

  it('PAY IN FULL: the creator answers the grand shares by its creed — 0 on every one, never IN_FULL', () => {
    const { runtime, cast, creator, stage, grand } = finaleWithAKeepingCreator();
    // Four crew at the stage, staked, signed: the candidate goes LIVE with every share owed by the creator.
    for (const [i, p] of CREW.entries()) {
      submit(runtime, p, 'fill_role', { venture: grand, role: i, hand: idleAt(runtime, p, stage), stake: 10_000 }, i);
    }
    tick(runtime);
    const hash = runtime.ventures.require(grand).termsHash;
    if (hash === null) throw new Error('no terms_hash');
    for (const [i, p] of CREW.entries()) submit(runtime, p, 'sign', { venture: grand, terms_hash: hash }, i);
    tick(runtime);
    tick(runtime);
    expect(runtime.ventures.require(grand).state, 'the crew is LIVE').toBe('LIVE');

    // Drive the cast up to the freeze and read every statement it makes on the grand venture.
    const statements: unknown[] = [];
    while (runtime.engine.tick < WINDOW.finale_tick - 2) {
      const at = runtime.engine.tick + 1;
      for (const action of cast.decide(at, SEED)) {
        if (action.verb === 'elect' && action.params['venture'] === grand) {
          expect(action.principal, 'only the creator states a grand share').toBe(creator.principal);
          statements.push(action.params['election']);
        }
        runtime.engine.submit(action);
      }
      tick(runtime);
    }
    expect(statements.length, 'the creator stated every share it owes').toBe(CREW.length);
    expect(statements.every((s) => s === 0), 'a KEEP creed states 0').toBe(true);
    expect(statements, 'and the four-role IN_FULL rule never reached a grand share').not.toContain(IN_FULL);
    for (const role of runtime.ventures.require(grand).roles) {
      expect(runtime.electionOn(grand, role.index), `role ${String(role.index)} as the engine recorded it`).toBe(0);
    }
  }, 600_000);
});
