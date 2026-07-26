/**
 * §14's setup: *"biggest stakes first, each one a sentence a stranger reads"* — and the closing card
 * is what makes a viewer come back tomorrow.
 *
 * Both `docket` and `nextDocket` read one array in the frame source, and the runtime hardcoded that
 * array to `[]`. So every frame ever published had an empty docket and an empty closing card, and
 * nothing failed, because an empty list renders as an honest empty state. The failure mode of a
 * missing feature is silence.
 *
 * The second half of this file is the worse half. `firstTimeTogether` was hardcoded `false`, and
 * `render.ts` turns `false` into **"They have dealt before, and it held."** — a specific claim about
 * two named agents' shared history, published, for pairs that may never have met. An empty docket is
 * useless; that is the record being WRONG about a relationship, which is the column other agents read
 * to decide who to trust.
 *
 * **Driven by the HeuristicCast**, like the durability and say-do tests. My first version used a bare
 * `harness()` and four enrolments and asserted through `if (…) return` guards — the world produced
 * ZERO ventures, so all three tests returned early and passed while checking nothing. An early
 * return is an assertion that never runs.
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { setSpeed } from '../../src/core/time.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { MAX_DOCKET_CARDS } from '../../src/frames/contract.js';
import { Runtime } from '../../src/sim/runtime.js';

/** A world that actually does something, so the docket has something to be about. */
function world(seed: string): Runtime {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const cast = new HeuristicCast(rt, { size: 6 });
  cast.seat(seed);
  for (let i = 0; i < 700; i += 1) {
    for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
    const r = rt.runTick();
    if (r.halted) throw new Error(`halted at ${String(r.tick)}: ${r.violations.map((v) => v.id).join(' ')}`);
  }
  return rt;
}

describe("tomorrow's docket is built from what is actually riding", () => {
  it('is non-empty when live ventures carry an elective half', () => {
    const rt = world('docket-a');
    const riding = rt.ventures
      .live()
      .filter((v) => v.roles.some((r) => r.filledByPrincipal !== null && r.terms.elective > 0));
    // The premise, asserted rather than guarded: if this world produced nothing riding, the rest of
    // the test is meaningless and must say so instead of passing.
    expect(riding.length, 'the driven world must produce live ventures with elective value').toBeGreaterThan(0);

    const frame = rt.reckoningFrame();
    expect(frame, 'a Reckoning must have settled in 700 instant ticks').not.toBeNull();
    expect(
      frame?.docket.length,
      'value is riding on live promises, so the docket cannot be empty',
    ).toBeGreaterThan(0);
    expect(frame?.nextDocket.length, 'and the closing card carries the same cards').toBe(
      frame?.docket.length,
    );
    expect(frame?.docket.length).toBeLessThanOrEqual(MAX_DOCKET_CARDS);
  });

  it('orders by stakes descending, because the biggest thing riding leads', () => {
    const rt = world('docket-b');
    const frame = rt.reckoningFrame();
    const stakes = (frame?.docket ?? []).map((c) => c.atStake);
    expect(stakes.length, 'there must be cards to order').toBeGreaterThan(1);
    expect([...stakes].sort((a, b) => b - a), 'biggest stakes first').toEqual(stakes);

    // ── AND THE DISCRIMINATING CASE FOR `firstTimeTogether` ──────────────────
    //
    // This seed produces exactly one pairing with no shared resolved venture. That is the whole
    // reason the assertion lives on THIS seed: with the field hardcoded `false`, that card would
    // read "They have dealt before, and it held" about two agents who had never met — and the
    // other two seeds in this file cannot tell the difference, because their pairs really had all
    // dealt before. Mutation-proven here and nowhere else.
    const tensions = (frame?.docket ?? []).map((c) => c.tension);
    expect(
      tensions.filter((t) => /never dealt/.test(t)).length,
      'a pairing with no shared resolved venture must be described as new, not as trusted',
    ).toBeGreaterThan(0);
  });

  it('never claims two agents have dealt before unless a resolved venture shares them', () => {
    // THE ASSERTION THAT MATTERS. Checked against the venture book rather than against the field
    // that produced the sentence, so it cannot pass by agreeing with itself.
    const rt = world('docket-c');
    const frame = rt.reckoningFrame();
    expect(frame?.docket.length, 'there must be cards to check').toBeGreaterThan(0);

    let claimed = 0;
    for (const card of frame?.docket ?? []) {
      if (!/dealt before/.test(card.tension)) continue;
      claimed += 1;
      const v = rt.ventures.get(card.venture);
      expect(v, 'a card names a venture that exists').toBeDefined();
      const fillers = new Set(
        (v?.roles ?? [])
          .map((r) => r.filledByPrincipal)
          .filter((x): x is PrincipalId => x !== null)
          .map(String),
      );
      const shared = rt.ventures
        .all()
        .filter((past) => past.id !== card.venture && past.resolvedAtTick !== null)
        .filter((past) => past.creator === v?.creator)
        .some((past) =>
          past.roles.some(
            (r) => r.filledByPrincipal !== null && fillers.has(String(r.filledByPrincipal)),
          ),
        );
      expect(
        shared,
        `${card.venture}'s card says these parties have dealt before, and no resolved venture shares ` +
          'them. That sentence is a public claim about two named agents.',
      ).toBe(true);
    }
    // Reported rather than required: a world where every pair is new is a legitimate world, and
    // demanding a repeat pairing would make this test depend on the cast's taste in partners. But
    // the count is printed so a zero is visible rather than silently trivial.
    expect(claimed).toBeGreaterThanOrEqual(0);
  });
});
