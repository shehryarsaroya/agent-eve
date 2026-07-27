/**
 * THE CORE LOOP HAD NO BRANCH IN THE CAST, SO IT COULD NOT HAPPEN.
 *
 * A6 is the design's core loop — *betrayal through legitimate delegated authority* — and §16's Phase 0
 * acceptance requires "≥1 authority-betrayal occurs unprompted, and its replay shows the grant, the
 * accepted warning, the seal, and the deed."
 *
 * The live world reported `authorityLines: 0` on its published frame, for eight Reckonings. That was
 * read as *the cast chooses not to delegate.* It was not. Measured 2026-07-26:
 *
 *   - `grant` had no affordance at all, so it was never on the menu (fixed earlier: 5C in
 *     `api/observe.ts`) — while the cast prompt tells a player *"the safest plan is built from entries
 *     in affordances[]"*;
 *   - and the heuristic cast emitted exactly **eight verbs** — `create · deliver · elect · fill_role ·
 *     move · seal · sign · vote` — with **no `grant` branch in the decision tree at all.** Heuristics
 *     were ~83% of production decisions (296 HEURISTIC against 61 LIVE), so most of the world's agency
 *     structurally could not exercise the core loop.
 *
 * So `authorityLines: 0` was not a behavioural finding. It was two missing entry points, and A13's
 * "every mechanic renders" was satisfied in the renderer and unsatisfiable in the world.
 *
 * ── WHAT THIS FILE ASSERTS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────
 *
 * It asserts A6 is **reachable**: a plain heuristic world issues grants through the ordinary front
 * door, and they reach the frame the browser polls. That is the A13 claim for the core loop and it had
 * never been true.
 *
 * It does **not** assert that anyone betrays. Whether granted authority gets abused is `AGT-E1`'s
 * question, it is answered by measurement on a live world rather than by a unit test, and the design's
 * own falsification gate says the answer must be allowed to come back "no". A test that forced a
 * betrayal would be rigging the one result the project is not allowed to rig.
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed } from '../../src/core/time.js';
import { Runtime } from '../../src/sim/runtime.js';

/** Run a plain heuristic world and report what it did. */
function run(seed: string, ticks: number): {
  readonly verbs: ReadonlyMap<string, number>;
  readonly authorityLines: number;
  readonly halted: boolean;
} {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const cast = new HeuristicCast(rt, { size: 8 });
  cast.seat(seed);

  const verbs = new Map<string, number>();
  let halted = false;
  for (let i = 0; i < ticks; i += 1) {
    for (const a of cast.decide(rt.engine.tick + 1, seed)) {
      verbs.set(a.verb, (verbs.get(a.verb) ?? 0) + 1);
      rt.engine.submit(a);
    }
    if (rt.runTick().halted) {
      halted = true;
      break;
    }
  }
  const frame = rt.reckoningFrame() as unknown as { readonly authorityLines?: readonly unknown[] } | null;
  return { verbs, authorityLines: (frame?.authorityLines ?? []).length, halted };
}

describe('A6 can actually happen in a world nobody is steering', () => {
  it('the heuristic cast issues grants through the ordinary front door', () => {
    const r = run('a6-fires', 900);
    expect(r.halted, 'a halt would make every count below meaningless').toBe(false);
    const grants = r.verbs.get('grant') ?? 0;
    expect(
      grants,
      `the cast emitted no \`grant\` in 900 ticks. Verbs seen: ${[...r.verbs.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(', ')}. ` +
        `This is the regression that made the core loop unreachable — a missing branch reads exactly ` +
        `like a cast that chose not to delegate.`,
    ).toBeGreaterThan(0);
  }, 180_000);

  it('and those grants REACH THE FRAME, which is A13 for the core loop', () => {
    // The half that matters for the show. `authorityLines` is A6's pixel signature; a grant that
    // happens and does not render leaves the browser showing an empty authority panel, which is what
    // the live world looked like for eight Reckonings.
    const r = run('a6-renders', 900);
    expect(r.halted).toBe(false);
    expect(
      r.authorityLines,
      'grants were issued but `authorityLines` is empty, so the core loop happens invisibly',
    ).toBeGreaterThan(0);
  }, 180_000);

  it('a grant needs no HAND, so a fully-committed principal can still delegate', () => {
    // Why the branch sits ahead of the idle-hand gate rather than behind it.
    //
    // D19 measured that filling a role commits a hand for the venture's life, that ventures resolve on
    // Reckoning boundaries, and that the members who work most therefore act least — halcyon held
    // three hands committed for 96% of all hand-ticks and managed 62 acts in 900 ticks against
    // brannock's 585. Every other material branch is fronted by `idle.length > 0`, so such a member
    // could do nothing whatsoever.
    //
    // Delegating is precisely what it should do: out of hands, not out of assets, which is A6's own
    // premise that you cannot run an empire alone. So `grant` must not be gated on having a spare
    // hand — and the way to prove the ordering rather than assert it is to check that grants appear
    // even when the world is at its most hand-starved.
    const r = run('a6-committed', 900);
    expect(r.halted).toBe(false);
    const grants = r.verbs.get('grant') ?? 0;
    const fills = r.verbs.get('fill_role') ?? 0;
    expect(fills, 'this world should be committing hands, or the test proves nothing').toBeGreaterThan(0);
    expect(grants, 'grants must occur in a world that is busy committing its hands').toBeGreaterThan(0);
  }, 180_000);
});
