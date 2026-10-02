/**
 * ★ **THE AUTHORITY LINE OVERSTATED A DELEGATE'S SPENDING** — past the limit it was given (A5′, A13).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `frames/authority.ts` summed every draw in the grant journal and never subtracted the RELEASE
 * journal — the draws given back when a venture retires without binding anybody (`RULES_VERSION` 26).
 * INV-22 subtracts it; the grant's row cache subtracts it; the delegate's own headroom is measured
 * net of it. Only the public line read gross. And a released draw is headroom the LIMIT has again, so
 * the delegate can draw it a second time: the gross sum is not bounded by the limit at all. A playtest
 * grant whose ventures were all ABANDONED and refunded showed **`spent 14400` of a `10000` limit,
 * `DRAWN`** — a public frame telling every viewer a delegate overran its authority, when nothing was
 * outstanding. `contract.ts` defines `DRAWN` as *"some headroom used"*, and none was.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Heuristic worlds cannot reach this: measured on seeds `s1`, `s2`, `fz-13`, `g01` (12 principals, 900
 * ticks), **zero** releases — the house cast never lets a delegated venture lapse. So the world-level
 * case below scripts the delegate a playtester was: create, let the window close, create again.
 */

import { describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import type { GrantId, PrincipalId, SystemId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { commonsSystems } from '../../src/world/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { authorityLinesFor, rankAuthorityLines } from '../../src/frames/authority.js';
import type { AuthorityLine, LiveFrame } from '../../src/frames/contract.js';

const G = (id: string): GrantId => id as GrantId;
const P = (h: string): PrincipalId => `p:${h}` as PrincipalId;

const grant = (id: string, over: Partial<Parameters<typeof authorityLinesFor>[0]['grants'][number]> = {}) => ({
  id: G(id),
  grantor: P('halcyon'),
  delegate: P('quill'),
  maxDirectLoss: minor(10_000),
  maxContingentLiability: minor(0),
  clearance: [] as readonly string[],
  expiresTick: 500,
  revokedAtTick: null,
  ...over,
});
const draw = (id: string, direct: number, contingent = 0) => ({ grant: G(id), direct: minor(direct), contingent: minor(contingent) });

describe('★ the line publishes what is OUTSTANDING, net of the release journal', () => {
  it('★ THE DEFECT, with the playtest\'s numbers: three 4,800 draws, all given back, on a 10,000 limit', () => {
    // MUTATION: fold `draws` alone in `outstandingByGrant` (drop the `releases` loop) and this reads
    // `spent 14400`, `DRAWN` — RED on the first two assertions.
    const [line] = authorityLinesFor({
      grants: [grant('g:1')],
      draws: [draw('g:1', 4_800), draw('g:1', 4_800), draw('g:1', 4_800)],
      releases: [draw('g:1', 4_800), draw('g:1', 4_800), draw('g:1', 4_800)],
      headroom: () => ({ direct: minor(10_000), contingent: minor(0) }),
      boundVentures: new Map([[G('g:1'), 3]]),
      dossiers: new Map(),
      tick: 10,
    });
    expect(line?.spent, 'nothing is outstanding, so nothing is spent').toBe(0);
    expect(line?.state, '"some headroom used" — and none is').toBe('UNUSED');
    expect(line?.boundVentures, 'what the delegate DID is still on the line').toBe(3);
  });

  it('a partial release leaves exactly the outstanding draw, and the line stays inside its limit', () => {
    const [line] = authorityLinesFor({
      grants: [grant('g:1')],
      draws: [draw('g:1', 4_800), draw('g:1', 4_800), draw('g:1', 4_800, 300)],
      releases: [draw('g:1', 4_800), draw('g:1', 4_800)],
      headroom: () => ({ direct: minor(5_200), contingent: minor(0) }),
      boundVentures: new Map(),
      dossiers: new Map(),
      tick: 10,
    });
    expect(line?.spent).toBe(4_800);
    expect(line?.spentContingent).toBe(300);
    expect(line?.spent ?? Infinity).toBeLessThanOrEqual(line?.granted ?? 0);
    expect(line?.state).toBe('DRAWN');
  });

  it('a released grant still outranks an untouched one through what it bound, and a live draw outranks both', () => {
    const lines = rankAuthorityLines(
      authorityLinesFor({
        grants: [
          grant('g:huge', { maxDirectLoss: minor(9_000_000), delegate: P('a') }),
          grant('g:released', { delegate: P('b') }),
          grant('g:drawing', { maxDirectLoss: minor(10), delegate: P('c') }),
        ],
        draws: [draw('g:released', 4_800), draw('g:drawing', 5)],
        releases: [draw('g:released', 4_800)],
        headroom: (id) => ({ direct: minor(id === G('g:drawing') ? 5 : 10_000), contingent: minor(0) }),
        boundVentures: new Map([[G('g:released'), 1]]),
        dossiers: new Map(),
        tick: 10,
      }),
    );
    expect(lines.map((l) => String(l.grant))).toEqual(['g:drawing', 'g:released', 'g:huge']);
  });
});

// ── A scripted delegate, because no house cast ever lets a delegated venture lapse ──────────────

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
  const grantor = P('netg');
  const delegate = P('netd');
  for (const [i, p] of [grantor, delegate, P('netf1'), P('netf2'), P('netf3'), P('netf4')].entries()) {
    runtime.seat(p, `n${String(i)}`, stage);
    runtime.standing.open(p);
  }
  return { runtime, grantor, delegate, stage };
}

function act(w: World, principal: PrincipalId, verb: string, params: Readonly<Record<string, unknown>>): void {
  const submitted = w.runtime.engine.submit({ principal, verb, params, clientSequence: 0, arrivalMs: 0, decisionSource: 'LIVE' });
  if (!submitted.ok) throw new Error(`submit ${verb}: ${submitted.invariant} ${submitted.hint}`);
  tick(w);
  const refused = w.runtime.takeCorrections(principal)[0];
  if (refused !== undefined) throw new Error(`${verb} refused: ${refused.invariant} ${refused.hint}`);
}

function tick(w: World): void {
  const report = w.runtime.runTick();
  if (report.halted) throw new Error(`halted at ${String(report.tick)}: ${report.violations.map((v) => v.id).join(' ')}`);
}

function issue(w: World, contingent: number): GrantId {
  act(w, w.grantor, 'grant', {
    delegate: w.delegate,
    template: 'steward',
    max_direct_loss: 0,
    max_contingent_liability: contingent,
    expires_tick: 280,
  });
  const id = w.runtime.grants.forGrantor(w.grantor)[0]?.id;
  if (id === undefined) throw new Error('the grant did not land');
  return id;
}

function createBuild(w: World): void {
  // BUILD is top-yield, so un-escrowable: a delegated one draws only the contingent limit.
  act(w, w.delegate, 'create', { on_behalf_of: w.grantor, stage: w.stage, kind: 'BUILD' });
}

function lineOf(frame: LiveFrame, grantor: PrincipalId): AuthorityLine {
  const line = frame.authorityLines.find((l) => l.grantor === grantor);
  if (line === undefined) throw new Error('no authority line for the grantor');
  return line;
}

describe('★ a delegate that keeps re-drawing headroom its lapsed ventures gave back', () => {
  it('★ publishes only what is outstanding — never more than the limit — and agrees with the book INV-22 checks', () => {
    // The step is learned from one create in a wide-open world, not typed in: the draw is the p90
    // elective ceiling, and a literal here would agree with the engine only by coincidence.
    const probe = world('net-of-releases-probe');
    issue(probe, 10_000_000);
    createBuild(probe);
    const step = probe.runtime.grants.forGrantor(probe.grantor)[0]?.spentContingent ?? 0;
    expect(step).toBeGreaterThan(0);

    // Room for ONE BUILD at a time: the second can only be drawn on headroom the first gave back.
    const limit = step + Math.floor(step / 2);
    const w = world('net-of-releases');
    const id = issue(w, limit);
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      createBuild(w);
      const forming = lineOf(w.runtime.liveFrame(), w.grantor);
      expect(forming.spentContingent, `cycle ${String(cycle)}: the forming BUILD's draw is outstanding`).toBe(step);
      expect(forming.state).toBe('DRAWN');
      // Nobody fills it; its formation window closes and `retireFormation` gives the draw back. Found
      // by state, not position: `forPrincipal` is in id order, and `v:15:…` sorts before `v:1:…`.
      const venture = w.runtime.ventures.forPrincipal(w.grantor).find((v) => v.state === 'FORMING');
      for (let i = 0; i < 40 && venture?.state === 'FORMING'; i += 1) tick(w);
      expect(venture?.state, `cycle ${String(cycle)}: the window closed with the role open`).toBe('ABANDONED');
    }

    // NON-VACUITY: the gross sum the line used to publish really is above the limit.
    const gross = w.runtime.grants.allSpends().filter((s) => s.grant === id).reduce((n, s) => n + s.contingent, 0);
    expect(gross).toBe(3 * step);
    expect(gross, 'the old line would have published a delegate overrunning its limit').toBeGreaterThan(limit);
    expect(w.runtime.grants.allReleases().filter((r) => r.grant === id)).toHaveLength(3);

    // MUTATION: drop `releases` from `outstandingByGrant` and this line reads `3 × step` over a
    // `limit` of 1.5 × step, `DRAWN` — RED on the next two assertions.
    const line = lineOf(w.runtime.liveFrame(), w.grantor);
    expect(line.spentContingent).toBe(0);
    expect(line.state).toBe('UNUSED');
    expect(line.spentContingent, 'one number with the row cache INV-22 recomputes').toBe(w.runtime.grants.get(id)?.spentContingent);
    expect(line.boundVentures, 'three ventures bound in the grantor\'s name, all of them still counted').toBe(3);
  }, 120_000);
});
