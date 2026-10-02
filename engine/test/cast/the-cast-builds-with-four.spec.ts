/**
 * ★ **A WORLD NOBODY STEERS PRODUCES FOUR-ROLE VENTURES, FILLS THEM, AND KEEPS THEM
 * (`RULES_VERSION` 41).**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A design review (2026-10-01): *no venture with four or more roles had ever occurred in the live
 * world* — BUILD, SURVEY, SIEGE and LEVY never appeared. Of those, BUILD and SIEGE are the four-role
 * kinds §7.2 relies on to force cooperation by arithmetic (*"top-yield kinds require ≥4 roles"*), and
 * the cause was the cast: its `CREATES` table maps every bot role onto a two-role kind, and its
 * first-fit filler handed a BUILD somebody else opened one formation in five.
 *
 * The claim under test is not "the code exists" — `test/sim/gate3.test.ts` already proved the engine
 * can take a BUILD to LIVE on four principals by hand. It is the completion bar `CLAUDE.md` sets:
 * **offered, selected, counted, reached** — the cast authors one, four distinct principals fill it,
 * it binds, it settles, and the creator's record moves because it kept its word to three of them.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { Rng } from '../../src/core/rng.js';
import { Runtime } from '../../src/sim/runtime.js';
import { isTopYield, openIndices } from '../../src/venture/index.js';

const SEED = 'g02';
const MEMBERS = 12;

function played(seed: string, ticks: number, topYieldChanceBps?: number): { runtime: Runtime; cast: HeuristicCast } {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, {
    size: MEMBERS,
    ...(topYieldChanceBps === undefined ? {} : { topYieldChanceBps }),
  });
  cast.seat(seed);
  while (runtime.engine.tick < ticks) {
    const target = runtime.engine.tick + 1;
    for (const action of cast.decide(target, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    if (report.halted) {
      throw new Error(`halted at ${String(report.tick)}: ${report.violations.map((v) => v.message).join(' | ')}`);
    }
  }
  return { runtime, cast };
}

describe('★ the cast authors, fills and keeps a four-role venture', () => {
  it('opens a BUILD, four DISTINCT principals fill it, it binds, and it SETTLES — honoured, not defaulted', () => {
    const { runtime, cast } = played(SEED, TICKS_PER_RECKONING);
    const castIds = new Set(cast.roster.map((m) => String(m.principal)));
    const fourRole = runtime.ventures.all().filter((v) => isTopYield(v.kind));

    expect(fourRole.length, 'ASKED: the cast must author at least one four-role venture in a Reckoning').toBeGreaterThan(0);
    const settled = fourRole.filter((v) => v.state === 'SETTLED');
    expect(
      settled.length,
      'BOUND and FINISHED: a four-role venture that is created and abandoned is the formation-probe ' +
        'finding repeated, not fixed',
    ).toBeGreaterThan(0);
    for (const v of settled) {
      expect(castIds.has(String(v.creator)), 'authored by the house cast').toBe(true);
      expect(v.roles.length).toBeGreaterThanOrEqual(4);
      expect(openIndices(v), 'every role filled').toEqual([]);
      const holders = new Set(v.roles.map((r) => r.filledByPrincipal));
      expect(holders.size, '§7.2: one principal per role, so FOUR principals — capital cannot substitute').toBe(
        v.roles.length,
      );
      expect(holders.has(v.creator), 'the creator works the top role of its own').toBe(true);
    }
    expect(fourRole.filter((v) => v.state === 'DEFAULTED'), 'no BUILD the cast opened was walked away from').toEqual([]);

    // COUNTED: the creator kept its word to three counterparties at once, and the record says so.
    const creator = settled[0]?.creator;
    if (creator === undefined) throw new Error('no settled BUILD');
    expect(
      runtime.standing.row(creator).distinctCounterparties,
      'a BUILD honoured in full credits its creator with every distinct counterparty on it — which is ' +
        'also the price of the constellation parley rung, so the four-role venture is how a record opens a voice',
    ).toBeGreaterThanOrEqual(3);
  }, 600_000);

  it('the branch is the cause: with it off, the same seed authors none', () => {
    const { runtime } = played(SEED, TICKS_PER_RECKONING, 0);
    expect(runtime.ventures.all().filter((v) => isTopYield(v.kind)), 'topYieldChanceBps 0 is the old world').toEqual([]);
  }, 600_000);

  it('the menu offers both four-role kinds where they are legal, and a forming one\'s roles to a stranger', () => {
    // ══════════════════════════════════════════════════════════════════════
    // "Make sure affordances offer them sensibly" — three facts, each read off a real observation:
    //   1. `create {kind:"BUILD"}` is on every menu that can fund the call (it escrows nothing);
    //   2. `create {kind:"SIEGE"}` is on the menu OUTSIDE the Commons — where a hostile kind is legal —
    //      and never inside it, where A8 makes it invalid rather than refused;
    //   3. a forming BUILD's open roles are on a stranger's board as `fill_role` rows it can take.
    // Constructed rather than cast-driven for (3): the cast fills its own BUILDs inside a tick or two,
    // which is the point of the change and leaves no window to observe a stranger's menu in.
    // ══════════════════════════════════════════════════════════════════════
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'four-on-the-menu' });
    const commons = runtime.seatInTier('COMMONS', Rng.fromSeed('four-on-the-menu:c'));
    const marches = runtime.seatInTier('MARCHES', Rng.fromSeed('four-on-the-menu:m'));
    if (commons === undefined || marches === undefined) throw new Error('the launch map has both tiers');
    const creator = 'p:wright' as PrincipalId;
    const stranger = 'p:stranger' as PrincipalId;
    const frontier = 'p:sieger' as PrincipalId;
    runtime.seat(creator, 'wright', commons);
    runtime.seat(stranger, 'stranger', commons);
    runtime.seat(frontier, 'sieger', marches);
    for (const p of [creator, stranger, frontier]) runtime.standing.open(p);
    runtime.runTick();
    const menu = (who: PrincipalId): ReturnType<typeof buildObservation>['affordances'] =>
      buildObservation({
        runtime,
        principal: who,
        serverNowMs: 0,
        fresh: true,
        wakesRemaining: 16,
        stale: false,
        corrections: [],
        correctionsDropped: 0,
        actionsRemaining: 4,
      }).affordances;
    const creates = (who: PrincipalId): readonly string[] =>
      menu(who)
        .filter((a) => a.verb === 'create')
        .map((a) => String(a.params['kind']));

    expect(creates(creator), 'BUILD is offered in the Commons').toContain('BUILD');
    expect(creates(creator), 'and SIEGE is not — a hostile kind is INVALID there (A8)').not.toContain('SIEGE');
    expect(creates(frontier), 'SIEGE is offered where it is legal').toContain('SIEGE');
    const siege = menu(frontier).find((a) => a.verb === 'create' && a.params['kind'] === 'SIEGE');
    expect(siege?.params['target_system'], 'aimed at the stage it names').toBe(siege?.params['stage']);
    expect(siege?.what_it_forecloses, 'and it says it needs four').toMatch(/FOUR principals/);

    // A BUILD and a SIEGE opened through the front door — each affordance sent VERBATIM, because an
    // offer the engine refuses is scar #1's shape — and then the stranger's board.
    const offered = menu(creator).find((a) => a.verb === 'create' && a.params['kind'] === 'BUILD');
    if (offered === undefined || siege === undefined) throw new Error('no BUILD or SIEGE affordance');
    for (const [principal, params] of [
      [creator, offered.params],
      [frontier, siege.params],
    ] as const) {
      runtime.engine.submit({ principal, verb: 'create', params, clientSequence: 0, arrivalMs: 0, decisionSource: 'LIVE' });
    }
    runtime.runTick();
    expect(runtime.takeCorrections(creator), 'the BUILD offer was accepted as offered').toEqual([]);
    expect(runtime.takeCorrections(frontier), 'and so was the SIEGE offer').toEqual([]);
    const build = runtime.ventures.all().find((v) => isTopYield(v.kind) && v.creator === creator);
    expect(build?.state, 'the affordance, sent verbatim, mints a FORMING BUILD').toBe('FORMING');
    const sieging = runtime.ventures.all().find((v) => v.kind === 'SIEGE' && v.creator === frontier);
    expect(sieging?.state, 'and the SIEGE affordance mints a FORMING SIEGE').toBe('FORMING');
    expect(sieging?.roles.length, 'with four roles to fill').toBeGreaterThanOrEqual(4);
    const rows = menu(stranger).filter((a) => a.verb === 'fill_role' && a.params['venture'] === build?.id);
    expect(rows.length, 'every open role of the BUILD is a slot the stranger can take').toBeGreaterThan(0);
  });
});
