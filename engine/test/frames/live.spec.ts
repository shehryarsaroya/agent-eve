/**
 * ★ THE LIVE FRAME — the artifact that makes the nightly one watchable.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **NON-VACUITY IS THE FIRST TEST IN THIS FILE AND IT IS NOT A FORMALITY.**
 *
 * Every gap this frame exists to close was a field that was populated, tested, correct and
 * **unreachable**: `raidLines.ticksLeft` was 0 on 117 of 117 measured rows, `DEMANDED` never occurred,
 * `FORMING` never occurred, and `battleLines.gap` never moved. Each had a passing unit test against
 * its builder. So a suite that asserted only *shapes* here would reproduce the exact defect it is
 * written against — which is why the first `it` drives a real world and fails loudly if the states
 * this file is about cannot occur in it.
 *
 * The guards below each name the MUTATION that must turn them red. A guard nobody has broken on
 * purpose is a guard nobody knows the strength of, and this repo shipped one two days ago that
 * asserted `typeof hook === 'function'` — which can never fail — over the exact defect it was written
 * for.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { minor, qty } from '../../src/core/units.js';
import type { GrantId, HandId, PrincipalId, SystemId, VentureId } from '../../src/core/types.js';
import {
  FrameBudgetError,
  assertLiveFrameBudgets,
  type CompactLink,
  type ConvoyLine,
  type LiveFrame,
} from '../../src/frames/contract.js';
import {
  LIVE_FACT_KEYS,
  LiveProjectionError,
  assertInertLiveFacts,
  livePhase,
  renderLiveFrame,
  type LiveSource,
} from '../../src/frames/live.js';
import { PUBLIC_FACT_KEYS } from '../../src/frames/projection.js';
import { authorityLinesFor, rankAuthorityLines } from '../../src/frames/authority.js';
import { convoyLinesFor } from '../../src/frames/motion.js';

function world(seed: string, size = 8): { rt: Runtime; run: (n: number) => void; frames: LiveFrame[] } {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const cast = new HeuristicCast(rt, { size });
  cast.seat(seed);
  const frames: LiveFrame[] = [];
  const run = (n: number): void => {
    for (let i = 0; i < n; i += 1) {
      for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
      const r = rt.runTick();
      if (r.halted) throw new Error(`halted at ${String(r.tick)}: ${r.violations.map((v) => v.id).join(' ')}`);
      frames.push(rt.liveFrame());
    }
  };
  return { rt, run, frames };
}

const P = (h: string): PrincipalId => `p:${h}` as PrincipalId;
const S = (n: string): SystemId => n as SystemId;

function convoy(over: Partial<ConvoyLine> = {}): ConvoyLine {
  return {
    hand: 'p:vex:h1' as HandId,
    principal: P('vex'),
    from: S('sys-01'),
    to: S('sys-02'),
    arrivesAtTick: 10,
    ticksLeft: 4,
    strait: false,
    legend: "VEX'S CONVOY · sys-01 → sys-02 · 4 TICKS",
    ...over,
  };
}

function link(over: Partial<CompactLink> = {}): CompactLink {
  return {
    venture: 'v:1:aa' as VentureId,
    kind: 'HAUL',
    stage: S('sys-03'),
    state: 'LIVE',
    a: P('halcyon'),
    aAt: S('sys-01'),
    b: P('vex'),
    bAt: S('sys-02'),
    parties: 2,
    electiveBps: 4_000,
    atStake: minor(12_000),
    snapped: false,
    grant: null,
    legend: 'HAUL · 12K ON A WORD · LIVE',
    ...over,
  };
}

function live(over: Partial<LiveSource> = {}): LiveSource {
  return { tick: 5, stateHash: 'h', lastReckoning: null, ventures: [], ...over };
}

describe('★ NON-VACUITY — the states this frame exists for must actually occur', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **IF THIS FAILS, EVERY OTHER TEST IN THIS FILE IS ABOUT A SHAPE NOTHING FILLS.**
   *
   * `fz-13` is one of `the-cast-goes-to-war.spec.ts`'s own war seeds, pinned there by
   * `scripts/war-seed-scan.ts` because it reaches a two-sided CONTEST. Four Reckonings, because a
   * battle runs at most `ENGAGEMENT_TICKS` of a 288-tick Reckoning and one Reckoning is a coin flip.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('a driven world produces DEMANDED raids, a moving countdown, FORMING glyphs, a moving gap and DRAWN authority', () => {
    const { run, frames } = world('fz-13');
    run(4 * TICKS_PER_RECKONING);

    const demanded = frames.flatMap((f) => f.raidLines.filter((r) => r.state === 'DEMANDED'));
    expect(
      demanded.length,
      'no raid was ever DEMANDED on a live frame. Before this artifact `DEMANDED` never occurred on ' +
        'any published frame at all — 117 of 117 rows were terminal — so this is the state the whole ' +
        'file is about',
    ).toBeGreaterThan(0);
    expect(
      demanded.filter((r) => r.ticksLeft > 0).length,
      'a DEMANDED raid must carry a live countdown; `ticksLeft` was 0 on 117 of 117 nightly rows',
    ).toBeGreaterThan(0);

    // ★ The COUNTDOWN, not merely a non-zero field. Those are different claims and only a sequence
    // separates them: a builder that recomputed `ticksLeft` off a stale tick would satisfy the
    // assertion above and fail this one.
    const byRaid = new Map<string, { tick: number; left: number }[]>();
    for (const f of frames) {
      for (const r of f.raidLines) {
        if (r.state !== 'DEMANDED') continue;
        byRaid.set(r.raid, [...(byRaid.get(r.raid) ?? []), { tick: f.tick, left: r.ticksLeft }]);
      }
    }
    const counted = [...byRaid.values()].filter((series) => series.length > 1);
    expect(counted.length, 'no raid was seen on two consecutive live frames').toBeGreaterThan(0);
    for (const series of counted) {
      for (let i = 1; i < series.length; i += 1) {
        const prev = series[i - 1];
        const cur = series[i];
        if (prev === undefined || cur === undefined) continue;
        expect(
          cur.left,
          `raid countdown went ${String(prev.left)} → ${String(cur.left)} between ticks ` +
            `${String(prev.tick)} and ${String(cur.tick)}; a countdown counts DOWN`,
        ).toBe(prev.left - (cur.tick - prev.tick));
      }
    }

    const forming = frames.flatMap((f) => f.glyphs.filter((g) => g.state === 'FORMING'));
    expect(
      forming.length,
      '`FORMING` never occurred. §14.5 calls it "an empty socket that pulses — that is what forming ' +
        'looks like", and `render.ts:glyphFor` cannot express it because it derives state from a ' +
        'SETTLED outcome',
    ).toBeGreaterThan(0);

    // ★ The gap, and it must MOVE. `contract.ts` calls it the most legible thing on the board.
    let gapMoves = 0;
    const states = new Set<string>();
    for (let i = 1; i < frames.length; i += 1) {
      const before = new Map((frames[i - 1]?.battleLines ?? []).map((b) => [b.engagement, b.gap]));
      for (const b of frames[i]?.battleLines ?? []) {
        states.add(b.state);
        if (before.has(b.engagement) && before.get(b.engagement) !== b.gap) gapMoves += 1;
      }
    }
    expect(
      gapMoves,
      `the battle gap never changed across ${String(frames.length)} live frames; states seen: ` +
        `${[...states].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(' ') || '(no battle at all)'}`,
    ).toBeGreaterThan(0);
    expect(
      [...states].some((s) => s !== 'AFTERMATH'),
      'every battle state observed is AFTERMATH — the nightly frame\'s exact failure, reproduced',
    ).toBe(true);

    // ★ A6. The core loop, rendering as USED.
    const drawn = frames.flatMap((f) => f.authorityLines.filter((a) => a.state === 'DRAWN' || a.state === 'EXHAUSTED'));
    expect(
      drawn.length,
      'no authority line ever rendered DRAWN. A6 is the core loop and it rendered UNUSED on 21 of 21 ' +
        'measured nightly frames while 98 draws sat in the journal',
    ).toBeGreaterThan(0);
    for (const line of drawn) {
      expect(line.spent + line.spentContingent, 'a DRAWN line must carry the draw it is named for').toBeGreaterThan(0);
    }

    // The phase word must actually vary, or it is a rule that never discriminates.
    expect(new Set(frames.map((f) => f.phase)).size, 'the clock never left one phase').toBeGreaterThan(1);
  }, 600_000);
});

describe('A9 — a live frame publishes nothing a nightly frame could not', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **THIS IS THE STRUCTURAL HALF OF THE A9 ARGUMENT AND IT IS THE WHOLE REASON THE LIVE FRAME
   * NEEDED TWO NEW ARGUMENTS RATHER THAN EIGHTEEN.**
   *
   * `PUBLIC_FACT_KEYS` carries a §11.2 argument per entry, written at length and reached with an
   * outside critic. Containment means the live frame inherits every one of them, and the only claim
   * left to make is that publishing an already-`PUBLIC` fact at a different tick is not publishing a
   * different fact — which is true except for the three tiers that declassify on a clock, and none of
   * those has a field here.
   *
   * MUTATION: add `'standings'` to `LIVE_FACT_KEYS` without adding it to `PUBLIC_FACT_KEYS`. RED.
   * (It *is* in `PUBLIC_FACT_KEYS`, so use a genuinely new key — `'seals'`.)
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('every live key is a PUBLIC_FACT_KEYS member, except the two that argue for themselves', () => {
    const nightly = new Set<string>(PUBLIC_FACT_KEYS as readonly string[]);
    // The three the live frame renames or adds, each with its argument on its own type.
    const OWN = new Set(['ventures', 'lastReckoning', 'convoyLines', 'compactLinks']);
    const unargued = (LIVE_FACT_KEYS as readonly string[]).filter((k) => !nightly.has(k) && !OWN.has(k));
    expect(
      unargued,
      'a live frame key with no §11.2 argument anywhere. Add it to PUBLIC_FACT_KEYS with the clause ' +
        'that admits it — and check first that the clause is not one of the three that declassify on ' +
        'a clock, because this artifact is published before all three of them fire',
    ).toEqual([]);
    // ★ And the key A9 actually refused, asserted as an ABSENCE rather than left to a comment.
    //
    // `tributeStateFor` derives `SOLID` from `carriageUnderway`, which reads `hand.destination` — a
    // `SENSED` disposition (§11.2), and no agent's `observe` answers it about any principal but
    // itself. It is the most tempting live signal on this frame (§5.2's "continuous off-peak motion")
    // and it is the one that may not be published 288 times a day.
    //
    // MUTATION: add `'tributeLines'` back to `LIVE_FACT_KEYS` and to `renderLiveFrame`. RED here.
    expect(
      (LIVE_FACT_KEYS as readonly string[]).includes('tributeLines'),
      'a tribute line publishes a hand destination, which §11.2 keeps SENSED',
    ).toBe(false);
    expect(Object.keys(renderLiveFrame(live()))).not.toContain('tributeLines');

    // Non-vacuity: the containment is only meaningful if most keys go through it.
    expect(LIVE_FACT_KEYS.length).toBeGreaterThan(8);
    expect((LIVE_FACT_KEYS as readonly string[]).filter((k) => nightly.has(k)).length).toBeGreaterThan(6);
  });

  it('carries no rundown, no receipt reel, no public line and no seal verdict', () => {
    // The three time-scoped tiers have exactly one carrier on a nightly frame — the rundown — and it
    // is absent here by construction rather than by filter. Asserted on the TYPE's own key set, so a
    // future field named `sealVerdict` fails here rather than on a screen.
    const frame = renderLiveFrame(live());
    for (const key of Object.keys(frame)) {
      expect(/rundown|receipt|reel|publicLine|seal|negotiation|message/i.test(key), `live frame carries ${key}`).toBe(
        false,
      );
    }
  });

  it('refuses a live frame carrying a declassifying field, by name', () => {
    // MUTATION: delete the `/receipt|reel|publicLine|seal|.../` loop from `assertLiveFrameBudgets`.
    // RED here. Before the mutation this is the guard that stops a well-meaning "put the seal verdict
    // on the live strip too" edit from publishing a SEALED flag a Reckoning early.
    const smuggled = { ...renderLiveFrame(live()), sealVerdict: 'CONTRADICTED' } as unknown as LiveFrame;
    expect(() => {
      assertLiveFrameBudgets(smuggled);
    }).toThrow(FrameBudgetError);
    // And the same call must PASS on the honest frame, or the guard is refusing everything.
    expect(() => {
      assertLiveFrameBudgets(renderLiveFrame(live()));
    }).not.toThrow();
  });

  it('refuses an unargued key and a live handle in the projection', () => {
    // MUTATION: return early from `assertInertLiveFacts`. Both halves RED.
    expect(() => {
      assertInertLiveFacts({ ...live(), seals: [] } as unknown as LiveSource);
    }).toThrow(LiveProjectionError);
    expect(() => {
      // A getter is the leak this boundary exists to make impossible: a projection holding a handle to
      // live state would make a frame's content depend on the world at render time.
      assertInertLiveFacts({ ...live(), ticker: (() => ['x']) as unknown as readonly string[] });
    }).toThrow(LiveProjectionError);
    expect(() => {
      assertInertLiveFacts(live());
    }).not.toThrow();
  });
});

describe('★ THE CONVOY LINE — A13\'s sixth named example', () => {
  it('draws a laden hand on a lane and NOTHING for an empty one', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE `laden` FILTER IS THE §11.2 ARGUMENT, NOT A TIDINESS RULE.**
    // `haul.departed` is PUBLIC; a bare `move` emits NO EVENT AT ALL. So publishing every in-transit
    // hand would put fleet redeployments on a public screen that no agent's `observe` reports — A9
    // inverted, and the exact leak `world/sway.ts` refuses by deriving borders from holdings.
    //
    // MUTATION: delete `if (!hand.laden) continue;` from `convoyLinesFor`. RED here.
    // ══════════════════════════════════════════════════════════════════════════
    const lines = convoyLinesFor({
      hands: [
        { hand: 'p:a:h1' as HandId, principal: P('a'), from: S('s1'), to: S('s2'), arrivesAtTick: 9, laden: true },
        { hand: 'p:b:h1' as HandId, principal: P('b'), from: S('s1'), to: S('s2'), arrivesAtTick: 9, laden: false },
        { hand: 'p:c:h1' as HandId, principal: P('c'), from: S('s1'), to: null, arrivesAtTick: null, laden: true },
      ],
      isStrait: () => false,
      handleOf: (p) => String(p),
      tick: 5,
    });
    expect(lines.map((l) => String(l.hand))).toEqual(['p:a:h1']);
    expect(lines[0]?.ticksLeft).toBe(4);
  });

  it('keeps the convoys landing SOONEST when the budget bites', () => {
    // Every other line budget keeps the biggest; this one keeps the imminent. A cap that dropped the
    // arrivals would fail in the direction that hides — which this repo has shipped three times.
    const hands = Array.from({ length: 30 }, (_, i) => ({
      hand: `p:x:h${String(i)}` as HandId,
      principal: P('x'),
      from: S('s1'),
      to: S('s2'),
      arrivesAtTick: 100 - i,
      laden: true,
    }));
    const lines = convoyLinesFor({ hands, isStrait: () => false, handleOf: () => 'x', tick: 5, limit: 4 });
    expect(lines.map((l) => l.ticksLeft)).toEqual([66, 67, 68, 69]);
  });

  it('refuses a convoy line carrying anything manifest-shaped', () => {
    // MUTATION: delete the `/good|qty|.../` loop from `convoyProblems`. RED.
    // §11.2: a ship at sea is visible; its manifest is not.
    // Spliced onto a frame `renderLiveFrame` already built, because the renderer asserts on the way out
    // — which is the point of it — so the leak has to be introduced downstream to test the assertion
    // rather than the renderer. That both paths refuse it is the property, and it is checked twice.
    const leak = {
      ...renderLiveFrame(live()),
      convoyLines: [{ ...convoy(), qty: 400 } as unknown as ConvoyLine],
    } as LiveFrame;
    expect(() => {
      assertLiveFrameBudgets(leak);
    }).toThrow(/manifest is not/);
    expect(() => {
      renderLiveFrame(live({ convoyLines: [{ ...convoy(), qty: 400 } as unknown as ConvoyLine] }));
    }).toThrow(/manifest is not/);
  });

  it('refuses a convoy drawn from a system to itself', () => {
    // MUTATION: delete the `from === to` clause. RED. One move is one lane, so a self-lane is a line
    // a renderer would draw as a dot on a node and a viewer would read as a stationary ship.
    expect(() => {
      assertLiveFrameBudgets(renderLiveFrame(live({ convoyLines: [convoy({ to: S('sys-01') })] })));
    }).toThrow(/one move is one lane/);
  });
});

describe('★ THE COMPACT LINK — A13\'s second and third named examples', () => {
  it('refuses a snap that the venture state does not support', () => {
    // MUTATION: delete the `snapped !== (state === 'DEFAULTED')` clause. RED.
    // A13: "a broken compact snaps that link and scars both parties." A snap over a settled compact is
    // a permanent public accusation against two named agents (A5′).
    expect(() => {
      assertLiveFrameBudgets(renderLiveFrame(live({ compactLinks: [link({ state: 'SETTLED', snapped: true })] })));
    }).toThrow(/only a\s*DEFAULTED compact snaps|only a DEFAULTED compact snaps/);
    expect(() => {
      assertLiveFrameBudgets(renderLiveFrame(live({ compactLinks: [link({ state: 'DEFAULTED', snapped: false })] })));
    }).toThrow(FrameBudgetError);
  });

  it('refuses half a link', () => {
    // MUTATION: delete the `(b === null) !== (bAt === null)` clause. RED. Half a link is a line drawn
    // to the origin of the plot, which a renderer cannot distinguish from a real edge.
    expect(() => {
      assertLiveFrameBudgets(renderLiveFrame(live({ compactLinks: [link({ b: P('vex'), bAt: null })] })));
    }).toThrow(/counterparty at one field/);
  });

  it('refuses a link carrying either end\'s stores', () => {
    expect(() => {
      assertLiveFrameBudgets(
        renderLiveFrame(live({ compactLinks: [{ ...link(), aStores: 40 } as unknown as CompactLink] })),
      );
    }).toThrow(/never either end's stores/);
  });
});

describe('★ A6 — the authority line ranks by whether anything HAPPENED', () => {
  const grant = (id: string, over: Partial<Parameters<typeof authorityLinesFor>[0]['grants'][number]> = {}) => ({
    id: id as GrantId,
    grantor: P('halcyon'),
    delegate: P(`d-${id}`),
    maxDirectLoss: minor(1_000),
    maxContingentLiability: minor(0),
    clearance: [] as readonly string[],
    expiresTick: 500,
    revokedAtTick: null,
    ...over,
  });

  it('puts a small DRAWN grant ahead of a huge untouched one', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE DEFECT, AS ONE ASSERTION.** `render.ts` ranked authority lines by
    // `granted + grantedContingent` and by nothing else — the only line set in the file with no term
    // for whether anything had happened. On seed `g01` three live-drawn grants lost the twelve-line
    // budget to bigger untouched ones, deterministically, on every frame ever published, and A6 — the
    // core loop — rendered `UNUSED` on 21 of 21 measured frames.
    //
    // MUTATION: delete the `Number(wasDrawn(b)) - Number(wasDrawn(a))` term from
    // `rankAuthorityLines`. RED here, and the whole A13 half of the A6 defect is back.
    // ══════════════════════════════════════════════════════════════════════════
    const lines = authorityLinesFor({
      grants: [
        grant('g:big', { maxDirectLoss: minor(900_000) }),
        grant('g:small', { maxDirectLoss: minor(10) }),
      ],
      draws: [{ grant: 'g:small' as GrantId, direct: minor(5), contingent: minor(0) }],
      headroom: (id) => (id === ('g:small' as GrantId) ? { direct: minor(5), contingent: minor(0) } : { direct: minor(900_000), contingent: minor(0) }),
      boundVentures: new Map(),
      dossiers: new Map(),
      tick: 10,
      limit: 1,
    });
    expect(lines.map((l) => String(l.grant))).toEqual(['g:small']);
    expect(lines[0]?.state).toBe('DRAWN');
  });

  it('folds the draw journal ONCE and still totals every row', () => {
    // The previous shape rescanned `allSpends()` per grant — O(grants × spends), unaffordable on a
    // frame published every tick, and the same shape as the quadratic that held production down for
    // four minutes. This asserts the arithmetic survived the change.
    const lines = authorityLinesFor({
      grants: [grant('g:1'), grant('g:2')],
      draws: [
        { grant: 'g:1' as GrantId, direct: minor(3), contingent: minor(7) },
        { grant: 'g:2' as GrantId, direct: minor(1), contingent: minor(0) },
        { grant: 'g:1' as GrantId, direct: minor(4), contingent: minor(1) },
      ],
      headroom: () => ({ direct: minor(100), contingent: minor(100) }),
      boundVentures: new Map(),
      dossiers: new Map(),
      tick: 10,
    });
    const one = lines.find((l) => String(l.grant) === 'g:1');
    expect(one?.spent).toBe(7);
    expect(one?.spentContingent).toBe(8);
  });

  it('drops an expired grant unless something on the frame NAMES it, and then says EXPIRED', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // §14 needs the grant beside the deed. A grant lives 592–1,959 ticks and its deed settles at a
    // Reckoning, so **38 of the 41 grants ever drawn on had expired before any frame was written** —
    // every one of them a `RundownSegment.grant` pointing at a line the frame did not carry.
    //
    // MUTATION: change `if (expired && !retain.has(g.id)) continue;` back to `if (expired) continue;`.
    // RED here, and RED again in the referential-integrity test below.
    // ══════════════════════════════════════════════════════════════════════════
    const args = {
      grants: [grant('g:gone', { expiresTick: 5 })],
      draws: [{ grant: 'g:gone' as GrantId, direct: minor(9), contingent: minor(0) }],
      headroom: () => ({ direct: minor(0), contingent: minor(0) }),
      boundVentures: new Map(),
      dossiers: new Map(),
      tick: 400,
    };
    expect(authorityLinesFor(args)).toEqual([]);
    const retained = authorityLinesFor({ ...args, retain: new Set(['g:gone' as GrantId]) });
    expect(retained).toHaveLength(1);
    // Not `EXHAUSTED` — that means "no headroom left", and a term that ran out with money still on it
    // is a different fact to publish about a real agent.
    expect(retained[0]?.state).toBe('EXPIRED');
    // And it ranks first, because it is the row whose eviction would publish a dangling pointer.
    const ranked = rankAuthorityLines([
      ...authorityLinesFor({
        grants: [grant('g:huge', { maxDirectLoss: minor(9_000_000) })],
        draws: [],
        headroom: () => ({ direct: minor(1), contingent: minor(1) }),
        boundVentures: new Map(),
        dossiers: new Map(),
        tick: 400,
      }),
      ...retained,
    ]);
    expect(String(ranked[0]?.grant)).toBe('g:gone');
  });

  it('REVOKED outranks EXPIRED when a grant is both', () => {
    // Somebody took the authority BACK, which is the more informative fact and the one A6 is about. A
    // term simply running out is what happens when nobody does anything.
    const lines = authorityLinesFor({
      grants: [grant('g:x', { expiresTick: 5, revokedAtTick: 3 })],
      draws: [],
      headroom: () => ({ direct: minor(0), contingent: minor(0) }),
      boundVentures: new Map(),
      dossiers: new Map(),
      tick: 400,
      retain: new Set(['g:x' as GrantId]),
    });
    expect(lines[0]?.state).toBe('REVOKED');
  });
});

describe('the clock is a word, and it comes from core/time', () => {
  it('names all four phases across one Reckoning and never OPEN', () => {
    const seen = new Set<string>();
    for (let t = 0; t < TICKS_PER_RECKONING; t += 1) seen.add(livePhase(t));
    // All four, or the phase field is a rule that never discriminates.
    expect([...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(['COMMITMENT', 'EARLY', 'FREEZE', 'SETTLING']);
  });

  it('refuses a clock outside 1..TICKS_PER_RECKONING', () => {
    // MUTATION: delete the `ticksUntilReckoning` bound. RED. A client draws a progress ring from this,
    // and a value outside the range draws a ring that has left the dial.
    const bad = { ...renderLiveFrame(live()), ticksUntilReckoning: 0 } as unknown as LiveFrame;
    expect(() => {
      assertLiveFrameBudgets(bad);
    }).toThrow(/the clock runs/);
  });
});

describe('an honest quiet frame is still a frame', () => {
  it('renders a world with nothing happening rather than returning null', () => {
    // An absent artifact and an empty one read the same to a client, and "nothing is happening right
    // now" is a fact the show has to be able to state. `reckoningFrame()` may return null because
    // before the first settlement there IS no settled Reckoning; a tick always exists.
    const frame = renderLiveFrame(live({ tick: 3 }));
    expect(frame.tick).toBe(3);
    expect(frame.meters).toEqual({ onAPromise: minor(0), forming: 0, live: 0, raidsLive: 0, battlesLive: 0, convoys: 0 });
    expect(frame.meters.onAPromise).toBe(qty(0));
  });
});
