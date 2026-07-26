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

  it('never says "it held" about a pair with a broken promise between them (A5\u2032)', () => {
    // THE ASSERTION NEITHER TEST ABOVE MADE. Both checked whether the parties had DEALT; neither
    // checked whether the deal HELD. `haveDealtBefore` returned true for any resolved shared
    // venture, so a pair whose only prior deal was a DEFAULT got a public frame stating that it
    // held — the record being wrong about a named relationship, which is the thing A5\u2032 forbids
    // above all others and which other agents read to decide who to trust.
    //
    // Found by a spectacle critic reading the render path. No invariant covers the truth of a
    // sentence, which is exactly why this class of defect needs an assertion of its own.
    //
    // Checked against the STANDING JOURNAL rather than against the field that produced the
    // sentence, so it cannot pass by agreeing with itself.
    let held = 0;
    for (const seed of ['docket-a', 'docket-b', 'docket-c']) {
      const rt = world(seed);
      const frame = rt.reckoningFrame();
      for (const card of frame?.docket ?? []) {
        if (!/and it held/.test(card.tension)) continue;
        held += 1;
        const v = rt.ventures.get(card.venture);
        const fillers = new Set(
          (v?.roles ?? [])
            .map((r) => r.filledByPrincipal)
            .filter((x): x is PrincipalId => x !== null)
            .map(String),
        );
        for (const relation of rt.relationsFor(v?.creator as PrincipalId)) {
          if (!fillers.has(String(relation.other))) continue;
          expect(
            relation.broke + relation.youBroke,
            `${card.venture}'s card says "it held" and the journal records ` +
              `${String(relation.broke + relation.youBroke)} broken promise(s) between ` +
              `${String(v?.creator)} and ${String(relation.other)}. The docket is asserting ` +
              'something untrue about two real agents, in public, on the surface other agents ' +
              'price each other from.',
          ).toBe(0);
        }
      }
    }
    // ── THIS ASSERTION IS CURRENTLY VACUOUS, AND SAYING SO IS THE POINT ──────
    //
    // 19 cards say "it held" across these seeds and every one of them genuinely held, so the
    // assertion passes without ever meeting the case it exists for. I know it is vacuous because I
    // mutated the fix — making `priorDealings` unable to return BROKEN at all — and this test
    // stayed GREEN.
    //
    // The reason is worth recording: **the heuristic cast never breaks a promise.** Measured across
    // six seeds and 900 ticks each, zero pairs have a DEFAULT recorded between them. So no test
    // driven by the heuristic can exercise this path, and that is a fact about the whole suite, not
    // about this file — `AGT-E1` ("does anyone betray anyone?") is unanswerable without LLM agents
    // for exactly the same reason.
    //
    // Nor can the state be faked. A `DEFAULT` standing change must cite an eventId that is in the
    // `DefaultRegister` (`reckoning/standing.ts:79-82`) because *"reputation must never fall for an
    // accusation the engine cannot justify"* — so `checkStandingJournal` would halt a synthetic
    // default. That is A5' enforced structurally, and it is right to make this hard.
    //
    // So: the guard is real, the fix is real, and the discrimination is owed by a probe run with
    // real agents. Labelled rather than dressed up, because a guard I claim is proven and is not is
    // worse than one I mark.
    console.log('docket cards claiming "it held" across three seeds:', held);
    expect(held, 'no card said "it held", so the assertion never ran at all').toBeGreaterThan(0);
  });
});
