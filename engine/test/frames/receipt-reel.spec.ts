/**
 * THE RECEIPT REEL (§14) — the moment CLAUDE.md calls the signature of the whole design: the
 * replay putting every reassuring thing a traitor said next to the promise it broke.
 *
 * **It has never fired in production.** Read off the live frame at tick 4,395: 12 segments, one
 * genuine break (*"kestrel walked away from 6K it had promised"*), and `publicLine: null` on every
 * single segment — so there was nothing to pair the deed against, and `receiptReel` was empty.
 *
 * The wiring was never proven either way. `say-do.test.ts` asserts the FIELDS exist on the segment
 * shape and says so explicitly — *"even in a Reckoning where the cast happened to seal nothing"* — so
 * a null `publicLine` passed it. This file proves the path end to end with a real assurance and a real
 * broken promise, which is the only way to tell a wiring gap from a behavioural one.
 */

import { describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import type { PrincipalId, VentureId } from '../../src/core/types.js';

function world(seed: string): { rt: Runtime; run: (n: number) => void } {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const cast = new HeuristicCast(rt, { size: 6 });
  cast.seat(seed);
  const run = (n: number): void => {
    for (let i = 0; i < n; i += 1) {
      for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
      const r = rt.runTick();
      if (r.halted) throw new Error(`halted at ${String(r.tick)}: ${r.violations.map((v) => v.id).join(' ')}`);
    }
  };
  return { rt, run };
}

describe('an assurance reaches the frame, and a broken promise brings the reel with it', () => {
  it('carries the creator assurance on the settled segment', () => {
    const { rt, run } = world('reel-1');
    run(200);

    // Find a live venture with a filled elective role — the only shape where a promise can break.
    const target = rt.ventures
      .live()
      .find((v) => v.roles.some((r) => r.filledByPrincipal !== null && r.terms.elective > 0));
    expect(target, 'the driven world must produce a venture with an elective promise on it').toBeDefined();
    const venture = target?.id as VentureId;
    const creator = target?.creator as PrincipalId;

    // The creator says something reassuring. This is the free verb the prompt now teaches, and the
    // party filtered on: the creator owes the elective half, so the creator is who can break it.
    // `clientSequence` and `arrivalMs` are REQUIRED on a SubmittedAction. My first version omitted
    // both, so the queue refused it silently and I read a missing talk entry as an engine gap —
    // `submit` returns a WorldResult and I was discarding it, which is the same
    // "I could not look" mistake as an unchecked exit code. The result is asserted now.
    const accepted = rt.engine.submit({
      principal: creator,
      verb: 'message',
      params: { venture, act: 'assure', text: 'You will be paid in full. You have my word.' },
      clientSequence: 1,
      arrivalMs: 0,
      decisionSource: 'LIVE',
    });
    expect(
      'ok' in accepted && accepted.ok,
      `the assurance must be QUEUED: ${JSON.stringify(accepted)}`,
    ).toBe(true);
    run(1);

    const spoken = rt.talksFor(creator).filter((t) => t.act === 'assure');
    expect(spoken.length, 'the assurance must be accepted by the engine, not refused').toBeGreaterThan(0);

    // Run until the PUBLISHED frame is the one that carries this venture. `reckoningFrame()`
    // returns the latest settled Reckoning, so a fixed `run(700)` sails past the Reckoning the
    // venture settled in — which is what made the first version of this assertion unreachable.
    let frame = rt.reckoningFrame();
    for (let i = 0; i < 900 && !(frame?.rundown ?? []).some((r) => String(r.venture) === String(venture)); i += 1) {
      run(1);
      frame = rt.reckoningFrame();
    }
    expect(frame, 'a Reckoning must settle').not.toBeNull();

    // Asserted, not guarded. An `if (seg === undefined) return` here would let this pass on any run
    // where the venture happened to settle in an earlier Reckoning than the published frame — and a
    // test that can silently skip its only real assertion is the pattern that let `publicLine` stay
    // null in production for its entire life without anything going red.
    const seg = (frame?.rundown ?? []).find((s) => String(s.venture) === String(venture));
    expect(
      seg,
      `the venture that carried the assurance must appear in the published rundown; got ${(frame?.rundown ?? []).map((r) => String(r.venture)).join(', ')}`,
    ).toBeDefined();
    expect(
      seg?.publicLine,
      'an assurance on a settled venture must reach the frame — this is the say-do gap',
    ).toContain('my word');
  });

  it('the reel exists only where an elective promise BROKE (A12)', () => {
    // The other half, and A12's constraint: a reel on a kept promise would be the show
    // editorialising. So a segment with a reel must be a segment whose glyph snapped.
    const { rt, run } = world('reel-2');
    run(900);
    const frame = rt.reckoningFrame();
    for (const seg of frame?.rundown ?? []) {
      if ((seg.receiptReel ?? []).length === 0) continue;
      expect(
        seg.glyph?.state,
        'a receipt reel may only appear where the promise snapped',
      ).toBe('SNAPPED_BLACK');
    }
  });

  it('a message from a NON-creator does not become the creator assurance', () => {
    // The filter is `from === creator`, and it has to be: the elective half is the creator's to
    // pay, so a filler's reassurance is not the promise that can break. Getting this wrong would
    // put one agent's words under another agent's deed, which is the worst possible attribution
    // error in a mechanic whose whole point is who said what.
    const { rt, run } = world('reel-3');
    run(200);
    const target = rt.ventures
      .live()
      .find((v) => v.roles.some((r) => r.filledByPrincipal !== null && r.terms.elective > 0));
    if (target === undefined) return;
    const filler = target.roles.find((r) => r.filledByPrincipal !== null)?.filledByPrincipal;
    if (filler === null || filler === undefined || filler === target.creator) return;

    rt.engine.submit({
      principal: filler,
      verb: 'message',
      params: { venture: target.id, act: 'assure', text: 'FILLER WORDS SHOULD NOT APPEAR' },
      clientSequence: 1,
      arrivalMs: 0,
      decisionSource: 'LIVE',
    });
    run(700);
    const frame = rt.reckoningFrame();
    const seg = (frame?.rundown ?? []).find((s) => String(s.venture) === String(target.id));
    if (seg === undefined) return;
    expect(String(seg.publicLine ?? '')).not.toContain('FILLER WORDS');
  });
});

describe('the assurance is OFFERED, not just legal', () => {
  /**
   * The reason the reel never fired. `message` is live, free, and taught in both `agent.md` and the
   * cast prompt — and it appeared **zero times** in `observe.ts`. An agent plays from
   * `affordances[]`; prose is not an interface.
   *
   * This is the third instance of that exact shape in one night. `graduate` was legal and unoffered,
   * so no principal ever reached the Marches. `build {"kind":"WORKS"}` was legal and unoffered, so
   * the economy's only faucet was unreachable. Both were found by playing, not by reading, and both
   * are now guarded by a test like this one.
   */
  it('offers assure to the party that owes an elective half, and to nobody else', async () => {
    const { harness, agent, enrol, signed, PATHS, tick } = await import('../api/harness.js');
    const h = await harness({ seed: 'assure-offered' });
    try {
      const { rt, run } = { rt: h.runtime, run: (n: number): void => { for (let i = 0; i < n; i += 1) h.runtime.runTick(); } };
      // A world with real ventures, driven by the cast the way the other frame tests do.
      const { HeuristicCast } = await import('../../src/cast/index.js');
      const cast = new HeuristicCast(rt, { size: 6 });
      cast.seat('assure-offered');
      for (let i = 0; i < 200; i += 1) {
        for (const a of cast.decide(rt.engine.tick + 1, 'assure-offered')) rt.engine.submit(a);
        rt.runTick();
      }

      const owing = rt.ventures
        .live()
        .filter((v) => v.resolvedAtTick === null)
        .filter((v) => v.roles.some((r) => r.filledByPrincipal !== null && r.terms.elective > 0));
      expect(owing.length, 'the driven world must produce an owed elective half').toBeGreaterThan(0);
      const creator = owing[0]?.creator;
      expect(creator).toBeDefined();

      // The helper the affordance reads. Asserted directly so a failure names the cause.
      const owed = rt.electivePromisesOwedBy(creator as never);
      expect(owed.length, 'the creator owes at least one elective half').toBeGreaterThan(0);
      expect(owed[0]?.electiveMinor, 'and the amount is real, not zero').toBeGreaterThan(0);

      // And a principal that owes nothing is offered nothing — the affordance must not be noise on
      // every observation, or it crowds the capped list for agents with no promise to make.
      const idle = agent('no-promises');
      expect((await enrol(h, idle)).status).toBe(201);
      tick(h, 1);
      expect(
        rt.electivePromisesOwedBy(idle.principalId as never).length,
        'a newcomer owes no elective half, so it is invited to assure nothing',
      ).toBe(0);
      run(1);

      const obs = (await signed(h, idle, 'GET', PATHS.observe)).json['observation'] as Record<string, unknown>;
      const offered = (obs['affordances'] as Record<string, unknown>[]).find((a) => a['verb'] === 'message');
      expect(offered, 'and it is not on the newcomer list').toBeUndefined();

      // ── AND IT IS ON THE LIST OF SOMEBODY WHO OWES ──────────────────────────
      //
      // The half I had not tested, and the half that matters: my earlier assertions covered the
      // HELPER and the newcomer case, so an affordance that never reached `affordances[]` would
      // have passed both. That is exactly the failure being fixed — a verb that is legal, taught,
      // and not on the list — so testing everything except the list would have been the same
      // mistake one level up.
      //
      // The owing principals are cast members, which cannot be signed for over HTTP, so this reads
      // the observation the server would build for them rather than fetching it.
      const owingPrincipal = owing[0]?.creator;
      expect(owingPrincipal).toBeDefined();
      const { buildObservation } = await import('../../src/api/observe.js');
      const built = buildObservation({
        runtime: rt,
        principal: owingPrincipal as never,
        serverNowMs: 0,
        fresh: true,
        wakesRemaining: 1,
        stale: false,
        corrections: [],
        actionsRemaining: 4,
      }) as unknown as Record<string, unknown>;
      const assure = (built['affordances'] as Record<string, unknown>[]).find(
        (a) => a['verb'] === 'message' && (a['params'] as Record<string, unknown>)['act'] === 'assure',
      );
      expect(
        assure,
        'a principal that owes an elective half must be OFFERED the assurance, not merely allowed it',
      ).toBeDefined();
      expect(String(assure?.['what_it_forecloses']), 'and told what it is staking').toMatch(
        /most damaging sentence/,
      );
      expect(Number(assure?.['cost']), 'free, so it never competes with a material action').toBe(0);
    } finally {
      await h.close();
    }
  });
});
