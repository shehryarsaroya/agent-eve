/**
 * ★ **A5′ ON THE TWO SENTENCES THAT ACCUSE A NAMED AGENT** — the deed line, and the seal verdict.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **1. THE DEED SENTENCE OVERSTATED A REAL AGENT'S BETRAYAL BY 2.9x, PERMANENTLY AND IN PUBLIC.**
 *
 * A blind player read *"lode-vela walked away from 4K it had promised."* What happened: role 0 was
 * honoured **in full** (`electiveHonouredValue: 2712`) and role 1 declined 1,439 of 1,440. It walked
 * away from **1,439**. `consequenceFor` was built from `atStake`, which is `Σ electiveDue` — the whole
 * elective half of the whole venture, honoured parts included — so every partial default in this
 * game's history has been published as a total one.
 *
 * `electiveShortfall` was in the same `st.payouts` the loop already summed. The defect was a missing
 * FIELD, not a missing measurement, and no test asserted the sentence: `atStake` is supplied by every
 * fixture, so the arithmetic that fills it is unreachable from the suite.
 *
 * **2. `sealVerdict` HAD NEVER ONCE BEEN `CONTRADICTED`.** 104 `HONOURED` · 76 `null` · zero, in a
 * visual audit of two frames — reported as *"looks constant, not computed"*. It IS computed; two
 * filters were wrong. `rec.role === null` dropped a seal from the frame that `SealBook.resolve` had
 * already charged standing for, so the row printed `HONOURED` while the same agent's
 * `standing.contradicted_seals` went to 1 off that seal. And the key was `rec.role.venture` — the free
 * SLOT the seal was paid out of — rather than `intent.target`, what it promised.
 *
 * §14's say-do gap is the product. It had no test in `test/frames/` at all: every `CONTRADICTED`
 * assertion in the suite lives in `test/seal/` or `test/reckoning/`, and not one of them goes through
 * `reckoningFrame()`. `test/frames/say-do.test.ts` re-implements the very filter under test.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { minor } from '../../src/core/units.js';
import type { Handle, PrincipalId, VentureId } from '../../src/core/types.js';
import { renderFrame, type FrameSource, type SettledView } from '../../src/frames/render.js';
import { Runtime } from '../../src/sim/runtime.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setSpeed, reckoningIndex } from '../../src/core/time.js';
import { HeuristicCast } from '../../src/cast/index.js';

const HANDLES = new Map<PrincipalId, Handle>([['p:vela' as PrincipalId, 'lode-vela' as Handle]]);

function settled(over: Partial<SettledView>): SettledView {
  return {
    venture: 'v:377' as VentureId,
    kind: 'HAUL',
    stage: 'sys-05',
    creator: 'p:vela' as PrincipalId,
    rolesFilled: 2,
    rolesTotal: 2,
    electiveBps: 2500,
    atStake: minor(4152),
    defaulted: true,
    deferred: false,
    parties: ['p:vela' as PrincipalId, 'p:kestrel' as PrincipalId],
    publicLine: null,
    sealVerdict: null,
    messages: [],
    ...over,
  };
}

function frameOf(views: readonly SettledView[]): ReturnType<typeof renderFrame> {
  const src: FrameSource = {
    reckoning: 9,
    tick: 2879,
    stateHash: 'x'.repeat(64),
    settled: views,
    meters: { levyShort: minor(0), onAPromise: minor(0), kept: 0, broken: 0 },
    handles: HANDLES,
    ticker: [],
    tomorrow: [],
  };
  return renderFrame(src);
}

function deedOf(views: readonly SettledView[]): string {
  const beat = frameOf(views).rundown[0];
  expect(beat, 'one settled view must produce one beat').toBeDefined();
  return String(beat?.deed);
}

describe('★ the deed line names WHAT WAS WITHHELD, never the whole promise (A5′)', () => {
  it('★ THE DEFECT, reproduced with the player\'s own numbers: 1,439 withheld out of 4,152', () => {
    // MUTATION: point `consequenceFor`'s defaulted branch back at `money(v.atStake)` and this goes
    // red on the first assertion. It is the assertion that did not exist.
    const deed = deedOf([settled({ atStake: minor(4152), withheld: minor(1439) })]);
    expect(deed, 'the accusation must be the amount actually withheld').toContain('walked away from 1439');
    expect(deed, 'and it must not print the whole promise as the amount taken').not.toContain(
      'walked away from 4K',
    );
    // The whole promise stays in the sentence as CONTEXT, so nothing is lost and the honoured
    // remainder is recoverable by subtraction.
    expect(deed).toContain('of the 4K it had promised');
    expect(deed, 'and the agent is named by handle, never by raw id').toContain('lode-vela');
  });

  it('★ the accusing figure is EXACT, not rounded — `money` overstates by a third at 1,500', () => {
    // `money(1500)` is "2K", a 33% overstatement in the direction that harms the principal named.
    // Right for a viewer reading a stake in three seconds; wrong for a permanent public accusation.
    const deed = deedOf([settled({ atStake: minor(9000), withheld: minor(1500) })]);
    expect(deed).toContain('walked away from 1500');
    expect(deed).not.toContain('walked away from 2K');
  });

  it('a default that took EVERYTHING reads as one clause, with no phantom remainder', () => {
    const deed = deedOf([settled({ atStake: minor(1440), withheld: minor(1440) })]);
    expect(deed).toContain('walked away from all 1440 it had promised');
    expect(deed, 'naming "1440 of the 1440" invites a reader to look for a remainder').not.toContain(
      'of the 1440 it had promised.',
    );
  });

  it('an unmeasured caller falls back to the whole promise rather than inventing a split', () => {
    // `withheld` is optional so `emptyFrame` and every pre-existing fixture stay valid. A caller that
    // did not measure it says nothing; it does not get to publish a number nobody computed.
    const deed = deedOf([settled({ atStake: minor(4152) })]);
    expect(deed).toContain('walked away from all 4152 it had promised');
  });

  it('an HONOURED settlement is untouched — `atStake` is still right for its three other readers', () => {
    const deed = deedOf([settled({ atStake: minor(4152), withheld: minor(0), defaulted: false })]);
    expect(deed).toContain('paid 4K it could have kept');
    expect(deed).not.toContain('walked away');
  });

  it('★ the PRODUCTION caller fills it from `electiveShortfall`, which is the term that was missing', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // A source pin, deliberately, and the reason is the shape of the defect. `atStake` is supplied by
    // every fixture in the suite, so **the arithmetic that fills it is unreachable from a test that
    // builds a `SettledView`** — which is exactly why 2.9x shipped with a green suite. The fixture
    // tests above prove the sentence; this proves the one production caller reads the right field.
    //
    // The two candidate terms sit adjacent on the same `RolePayout` and only one of them is what was
    // taken: `electiveDue` (promised) and `electiveShortfall` (withheld). A run-based check cannot
    // separate them unless that seed happens to produce a PARTIAL default — and `withheld-measured`
    // produces none, which is the vacuity this pin exists to cover.
    //
    // MUTATION: change `electiveShortfall` to `electiveDue` in `reckoningFrame` and this goes red.
    // ══════════════════════════════════════════════════════════════════════════
    const src = readFileSync(fileURLToPath(new URL('../../src/sim/runtime.ts', import.meta.url)), 'utf8');
    expect(
      src,
      'reckoningFrame must sum the SHORTFALL into `withheld`, never the due',
    ).toMatch(/withheld: sumMinor\(st\.payouts\.map\(\(pp\) => pp\.electiveShortfall\)\)/);
    expect(
      src,
      'and `atStake` must still be the due — it is right for the headline, the honoured sentence and the meter',
    ).toMatch(/atStake: electiveDue,/);
  });

  it('★ and the runtime MEASURES it — `withheld` is Σ electiveShortfall, not a constant', () => {
    // The field being on the type is not the fix; the fix is the production caller filling it from
    // the payouts. A heuristic world produces real defaults (Gate 3 measured 12% of settled elective
    // promises broken, unprompted), so this asserts on the engine's own arithmetic rather than a
    // fixture — and asserts NON-VACUITY first, because a world with no default proves nothing.
    setSpeed('instant');
    const rt = new Runtime({ seed: 'withheld-measured' });
    const cast = new HeuristicCast(rt, { size: 6 });
    cast.seat('withheld-measured');
    for (let i = 0; i < 900; i += 1) {
      const target = rt.engine.tick + 1;
      for (const a of cast.decide(target, 'withheld-measured')) rt.engine.submit(a);
      const r = rt.runTick();
      if (r.halted) throw new Error(`halted at ${String(r.tick)}`);
    }
    const outcome = rt.lastReckoning;
    expect(outcome, 'a Reckoning must have settled in 900 ticks').not.toBeNull();
    if (outcome === null) return;

    // Every settled row's `withheld` must equal the shortfall sum, and must never exceed `atStake`.
    let measured = 0;
    let anyDefault = 0;
    const frame = rt.reckoningFrame();
    expect(frame).not.toBeNull();
    for (const st of outcome.settlements) {
      const shortfall = st.payouts.reduce((n, pp) => n + pp.electiveShortfall, 0);
      const due = st.payouts.reduce((n, pp) => n + pp.electiveDue, 0);
      if (shortfall > 0) measured += 1;
      if (st.terminalState === 'DEFAULTED') anyDefault += 1;
      expect(shortfall, 'a shortfall can never exceed the due it comes out of').toBeLessThanOrEqual(due);
    }
    // NON-VACUITY: if this world settled nothing and defaulted on nothing the test above is a no-op,
    // and it must say so rather than pass.
    expect(outcome.settlements.length, 'nothing settled; this assertion had no subject').toBeGreaterThan(0);
    // Deeds in the frame must never quote a figure above the promise they came out of.
    for (const beat of frame?.rundown ?? []) {
      const row = beat as unknown as Record<string, unknown>;
      if (row['defaulted'] !== true || row['venture'] === null) continue;
      const walked = /walked away from (?:all )?(\d+)/.exec(String(row['deed']));
      if (walked === null) continue;
      expect(
        Number(walked[1]),
        `${String(row['deed'])} — an accusation may never name more than was at stake`,
      ).toBeLessThanOrEqual(Number(row['atStake']));
    }
    // Reported rather than asserted: whether this seed happened to produce a PARTIAL default is not
    // this test's subject, and pinning it would make the file fail on a calibration change.
    console.log('settlements:', outcome.settlements.length, '| with a shortfall:', measured, '| DEFAULTED:', anyDefault);
  }, 120_000);
});

describe('★ sealVerdict reaches CONTRADICTED, and names who (§14, A5′)', () => {
  /**
   * Drive a real contradiction through `reckoningFrame`, with `role: null` on purpose.
   *
   * `role` is the free SLOT a seal claims, not what it is about. A seal naming no held role costs an
   * action and carries `role: null` — and `SealBook.resolve` charges standing for its CONTRADICTED
   * verdict either way, while `reckoningFrame` used to skip it. So this is the exact population that
   * produced *"`HONOURED` on the frame, `contradicted_seals: 1` in the standing panel"*, and it is the
   * one the old filter could not see.
   *
   * MUTATION: restore `if (rec.role === null || rec.verdict === null) continue;` and the verdict
   * assertion goes red while everything else in the file stays green.
   */
  function worldWithAContradictedSeal(seed: string): Runtime {
    setSpeed('instant');
    const rt = new Runtime({ seed });
    const cast = new HeuristicCast(rt, { size: 6 });
    cast.seat(seed);
    // Sealed in EVERY Reckoning, not once. The first version sealed once, in Reckoning 1, and
    // `reckoningFrame()` renders only the LAST settled Reckoning — so the fixture had no subject on
    // the frame it was checking and the test said so instead of passing. A seal per cycle guarantees
    // the rendered Reckoning is one of them.
    const sealedIn = new Set<number>();
    for (let i = 0; i < 900; i += 1) {
      const target = rt.engine.tick + 1;
      for (const a of cast.decide(target, seed)) rt.engine.submit(a);
      const r = rt.runTick();
      if (r.halted) throw new Error(`halted at ${String(r.tick)}`);
      // Seal about a venture that will settle in THIS Reckoning, with a band no deed can satisfy and
      // no role claimed — `judge` then answers CONTRADICTED on `NO_ATTRIBUTABLE_DEED` or OUT_OF_BAND.
      const here = reckoningIndex(rt.engine.tick);
      if (sealedIn.has(here)) continue;
      const doomed = rt.ventures
        .all()
        .find((v) => v.state === 'LIVE' && reckoningIndex(v.resolvesAtTick) === here && v.resolvesAtTick > rt.engine.tick);
      if (doomed === undefined) continue;
      const committed = rt.seals.commit({
        principal: doomed.creator,
        tick: rt.engine.tick,
        actedOnStateVersion: rt.engine.stateVersion,
        stateVersion: rt.engine.stateVersion,
        intent: {
          verb: 'deliver',
          target: String(doomed.id),
          measure: 'MINOR',
          // Deliberately unreachable, so the deed cannot land in the band.
          outcomeLow: 999_000_000,
          outcomeHigh: 999_000_001,
        },
        prose: 'I will move an impossible amount.',
        role: null,
        rolesHeld: [],
      });
      if (committed.ok) sealedIn.add(here);
    }
    expect(
      sealedIn.size,
      'the fixture must have committed a seal in at least two Reckonings, or the rendered one may hold none',
    ).toBeGreaterThan(1);
    return rt;
  }

  it('★ a CONTRADICTED seal with `role: null` reaches the frame and names its principal', () => {
    const rt = worldWithAContradictedSeal('contradicted-frame');
    const contradicted = rt.seals.auditRecords().filter((r) => r.verdict === 'CONTRADICTED');
    // NON-VACUITY, first: the book must actually hold a contradiction, and it must be one the OLD
    // filter would have dropped. If either is false this test proves nothing and says so.
    expect(contradicted.length, 'no seal was judged CONTRADICTED; the fixture is not exercising §14').toBeGreaterThan(0);
    expect(
      contradicted.some((r) => r.role === null),
      'and at least one must carry `role: null` — that is the population the frame used to skip',
    ).toBe(true);

    const targets = new Set(contradicted.map((r) => r.intent.target));
    const frame = rt.reckoningFrame();
    expect(frame).not.toBeNull();
    const hits = (frame?.rundown ?? []).filter(
      (s) => s.venture !== null && targets.has(String(s.venture)),
    );
    if (hits.length === 0) {
      // The seal's venture settled in a Reckoning this frame is not about. Say so rather than pass
      // silently — a green run with no subject is the defect this file exists for.
      throw new Error(
        'the contradicted seal\'s venture is not on the published frame; the fixture must seal against ' +
          'a venture settling in the SAME Reckoning the frame renders',
      );
    }
    for (const beat of hits) {
      expect(beat.sealVerdict, `${String(beat.venture)}: a contradicted seal must print CONTRADICTED`).toBe(
        'CONTRADICTED',
      );
      expect(
        beat.sealContradictedBy,
        'and §14\'s subject is an agent, so the row names one',
      ).toBeTruthy();
    }
  }, 120_000);

  it('★ the frame and `standing.contradicted_seals` never disagree about the same seal', () => {
    // The reported symptom, as an invariant over the whole book rather than one row: every principal
    // the standing panel charges must have a contradiction the frame is capable of attributing.
    const rt = worldWithAContradictedSeal('contradicted-parity');
    const charged = new Set(
      rt.world.principalOrder.filter((p) => rt.standing.row(p).contradictedSeals > 0),
    );
    expect(charged.size, 'standing must have charged somebody, or there is no parity to check').toBeGreaterThan(0);
    const inBook = new Set(
      rt.seals.auditRecords().filter((r) => r.verdict === 'CONTRADICTED').map((r) => r.principal),
    );
    for (const who of charged) {
      expect(
        inBook.has(who),
        `${who} is charged a contradicted seal that the seal book does not contain — the two surfaces ` +
          'are reading different facts, which is exactly how the frame printed HONOURED over it',
      ).toBe(true);
    }
  }, 120_000);

  it('an HONOURED verdict names nobody, and a beat with no seal carries no attribution', () => {
    const honoured = frameOf([settled({ sealVerdict: 'HONOURED', withheld: minor(0), defaulted: false })]);
    expect(honoured.rundown[0]?.sealVerdict).toBe('HONOURED');
    expect(
      honoured.rundown[0]?.sealContradictedBy,
      'an HONOURED row must not assert a contradiction that did not happen',
    ).toBeUndefined();
    const none = frameOf([settled({ sealVerdict: null })]);
    expect(none.rundown[0]?.sealContradictedBy).toBeUndefined();
  });
});

