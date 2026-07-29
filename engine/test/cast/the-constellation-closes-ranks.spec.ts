/**
 * ★ **AN UNEVEN DOCKET MUST STILL BE PAYABLE — the carry at the aged horizon.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHAT THIS FILE IS FOR.** `RULES_VERSION` 26 gave EXPOSURE its delegated half: §3 defines it as
 * *"Σ of your open `max_direct_loss`, and nothing else"*, an **encumbrance** and a **grant** each
 * carry one, and only the first was ever summed. That was correct, it stays, and it made
 * `BY_EXPOSURE` discriminate for the first time in the project's life (`D30`).
 *
 * It also produced one red tribute line at nine Reckonings, and the line was not about exposure.
 * Measured on seed `g07`, Reckoning 7, constellation 1, `BY_EXPOSURE`, docket 120,000:
 *
 *   · `p:halcyon` was assessed **48,768** — 2.4x `LEVY_DUTY_PER_PRINCIPAL` — on a weight of 107,824
 *     against 19,507–54,475 for its five co-members;
 *   · it delivered 29,898 **by its own hand across 22 separate deliveries**, was carried a further
 *     13,503, ended the Reckoning holding **0** of the levy good, and was recorded short **5,367**;
 *   · `presenceOwed` was **0**, so every unit of that shortfall sat in the **escrowable** bucket —
 *     the one §5.2 explicitly lets another principal's hand fill;
 *   · and its five co-members were sitting on **157,000 unspent units of the same good in the same
 *     constellation**, with nothing outstanding of their own.
 *
 * So it was neither insolvency nor carriage. The goods were in the constellation, the bucket was
 * open, `deliver {payer}` was legal, and **the cast's own reserve refused it**: at
 * `CAST_CARRY_RESERVE_RECKONINGS` of 2 the reserve is `2 x max(assessment, 20,000)`, which by the
 * aged horizon is larger than anything a mid-sized member ever holds. `carryFor`'s
 * `surplus - reserve` was negative for **all five** of them. The constant's own declaration had
 * already named that failure mode as the argument against *three*; nine Reckonings made it the
 * argument against two.
 *
 * ── WHAT IS ASSERTED, AND WHY EACH CLAUSE CANNOT PASS VACUOUSLY ─────────────
 *
 * The trap in testing a shortfall fix is that the fix deletes its own subject: assert *"nobody is
 * short"* and the assertion holds for a world where nothing was ever owed. So every test below
 * establishes its subject from the engine's **recorded settlement rows** before asserting anything
 * about them, and each non-vacuity clause is chosen to be satisfied **on both sides of the change**
 * — on master too — so that it cannot be what the fix manufactures.
 *
 * MUTATION, run rather than reasoned about: put `CAST_CARRY_RESERVE_RECKONINGS` back to **2** and
 * both tests go red naming `p:halcyon`, R7, 5,367 short of 48,768 beside 156,947 units held by its
 * roll. That is the whole of what this file covers, and the boundary is worth stating because the
 * constant has **two** sides:
 *
 * ── ⚑ THE LOWER BOUND IS NOT TESTED HERE, AND THAT IS A MEASURED CHOICE ────
 *
 * Dropping the reserve to **0** makes the eight-seed sweep worse — `levyShort` 957, one red line, on
 * `g02` — but it does **not** fail either test below, and neither does deleting the `max` clause in
 * `carryFor`'s `perReckoning`. Both were run. The 0 failure is `p:sable` short 957 on its own
 * **non-escrowable** presence share, which no carry may ever fill at any price (§5.2), reached
 * through a changed trajectory rather than through goods it gave away — so it is a different
 * mechanism from the one these tests are about, and a third test asserting "no carrier is short in a
 * Reckoning it carried in" was written, measured against both mutations, caught neither, and
 * **deleted**. An assertion no mutation can break is decoration, and this repo's standing lesson is
 * that decoration reads exactly like coverage.
 *
 * The lower bound therefore lives where it can actually be re-run: the sweep in
 * `scripts/balance-gate.ts --reckonings 9`, and the table at the constant's own declaration.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { isSettlementTick, reckoningIndex, setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import { LEVY_DUTY_PER_PRINCIPAL, type LevyRule } from '../../src/levy/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import type { PrincipalId } from '../../src/core/types.js';

/**
 * One settled line, read off the book rather than recomputed. `held` is
 * `Runtime.levyGoodAvailable` — the same reader the sweep, the delivery quote and the carry offer
 * all use, so "the constellation was holding the goods" means the exact quantity a carry could
 * have moved and not a gross inventory figure.
 */
interface Line {
  readonly principal: PrincipalId;
  readonly assessment: number;
  readonly paidOwn: number;
  readonly paidOther: number;
  readonly owed: number;
  readonly presenceOwed: number;
  readonly held: number;
}

interface Docket {
  readonly reckoning: number;
  readonly rule: LevyRule;
  readonly lines: readonly Line[];
}

interface Aged {
  readonly dockets: readonly Docket[];
  readonly levyShort: number;
  readonly redTributeLines: number;
  /**
   * Every carry the cast actually chose: `deliver {payer}` naming somebody else. Recorded from the
   * cast's own decisions rather than from `paidOther`, because the two answer different questions —
   * `paidOther` says a payer *received*, this says who *chose* to give — and the first
   * non-vacuity clause below needs the second one.
   */
  readonly carries: readonly { readonly carrier: PrincipalId; readonly payer: PrincipalId }[];
}

/**
 * Nine Reckonings of a real world — real `Runtime`, real `HeuristicCast`, every invariant asserting
 * at every tick close. Nine and not three: `ENDOWMENT_WINDOW_RECKONINGS` is 4, so a shorter run is
 * still watching the enrolment allotment pay the tribute and cannot see this at all
 * (`scripts/balance-gate.ts` prints that limit next to its own zeroes).
 */
function playAged(seed: string, reckonings: number): Aged {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: 8 });
  cast.seat(seed);

  const dockets: Docket[] = [];
  const carries: { carrier: PrincipalId; payer: PrincipalId }[] = [];
  let levyShort = 0;
  let redTributeLines = 0;

  for (let i = 0; i < reckonings * TICKS_PER_RECKONING; i += 1) {
    const next = runtime.engine.tick + 1;
    for (const action of cast.decide(next, seed)) {
      const payer = action.params['payer'];
      if (action.verb === 'deliver' && typeof payer === 'string' && payer !== String(action.principal)) {
        carries.push({ carrier: action.principal, payer: payer as PrincipalId });
      }
      runtime.engine.submit(action);
    }
    const report = runtime.runTick();
    expect(
      report.halted,
      `aged world halted at ${String(report.tick)}: ${report.violations
        .map((v) => `${v.id} ${v.message}`)
        .join(' | ')}`,
    ).toBe(false);

    // Sampled in the freeze, which is the only reading a viewer ever sees, and accumulated rather
    // than read once at the end — one red line on Reckoning 2 is the finding even if 9 is clean.
    if (report.clock.inFreeze) {
      for (const line of runtime.tributeLines(report.tick)) {
        if (line.state === 'RED') redTributeLines += 1;
      }
    }

    if (!isSettlementTick(report.tick)) continue;
    levyShort += runtime.levySettlement?.levyShort ?? 0;
    const reckoning = reckoningIndex(report.tick);
    for (const plan of runtime.levy.plansIn(reckoning)) {
      dockets.push({
        reckoning,
        rule: plan.rule,
        lines: plan.lines.map((line) => {
          const owing = runtime.levy.owingOf(reckoning, line.principal);
          const payment = runtime.levy.paymentOf(reckoning, line.principal);
          return {
            principal: line.principal,
            assessment: Number(line.amount),
            paidOwn: Number(payment.paidOwn),
            paidOther: Number(payment.paidOther),
            owed: Number(owing.owed),
            presenceOwed: Number(owing.presenceOwed),
            held: Number(runtime.levyGoodAvailable(line.principal)),
          };
        }),
      });
    }
  }
  return { dockets, levyShort, redTributeLines, carries };
}

/**
 * One world, three questions about it. Nine Reckonings is ~45 s, so it is played once — in a
 * `beforeAll` rather than at module scope, because work done during **collection** is not covered
 * by any test timeout and a 45-second collect is one contended run away from tripping vitest's
 * default. `CLAUDE.md` records five runs lost to contention in one session; this is that hazard
 * inside a test file.
 */
const RECKONINGS = 9;
/** Where the defect is: `p:halcyon`, R7, 5,367 escrowable beside 156,947 units in the same roll. */
const SEED = 'g07';
let world: Aged;

describe('the constellation closes ranks — the carry at the aged horizon', () => {
  beforeAll(() => {
    world = playAged(SEED, RECKONINGS);
  }, 300_000);

  it('★ NO ESCROWABLE SHORTFALL STANDS BESIDE A CONSTELLATION THAT IS HOLDING THE GOODS', () => {
    // ── NON-VACUITY, and it is the whole reason this test is trustworthy ─────
    //
    // Every clause below establishes its subject from recorded rows first. The horizon check is not
    // a formality: a run that halted early, or one whose settlement rows never landed, would make
    // the shortfall loop iterate zero times and report green — which is this project's signature
    // defect (*"an invariant whose subject cannot occur"*) arriving inside its own regression test.
    expect(
      world.dockets.length,
      `no Levy docket settled in ${String(RECKONINGS)} Reckonings of ${SEED}, so every assertion ` +
        `below iterates zero times. Do not relax this — find out why the Levy stopped assessing.`,
    ).toBeGreaterThan(0);
    const settledReckonings = new Set(world.dockets.map((d) => d.reckoning));
    expect(
      settledReckonings.size,
      `${SEED} settled ${String(settledReckonings.size)} Reckonings, not ${String(RECKONINGS)}. ` +
        `The regime this file measures starts AFTER the 4-Reckoning endowment window, so a short ` +
        `run cannot see it.`,
    ).toBe(RECKONINGS);

    // ── AND THE MECHANISM UNDER TEST ACTUALLY RAN ────────────────────────────
    //
    // A member whose own hand could not discharge its assessment and whose tribute was completed by
    // somebody else's. **Satisfied on master too** — `p:halcyon` at R7 is assessed 48,768, delivers
    // 29,898 by its own hand and is carried 13,503 — which is exactly what makes it a usable
    // witness: it is not something the fix creates, so it cannot make the test pass by itself.
    const relied = world.dockets
      .flatMap((d) => d.lines.map((l) => ({ ...l, reckoning: d.reckoning })))
      .filter((l) => l.paidOther > 0 && l.assessment > l.paidOwn);
    expect(
      relied.length,
      `no member in ${String(RECKONINGS)} Reckonings of ${SEED} was assessed more than its own hand ` +
        `delivered AND had part of its tribute carried by another principal. §5.2's escrowable share ` +
        `is the mechanism this file is about; if nothing used it, the assertion below is empty. ` +
        `Carries the cast chose: ${String(world.carries.length)}.`,
    ).toBeGreaterThan(0);

    // ── THE PROPERTY ─────────────────────────────────────────────────────────
    //
    // Stated as the shape of the defect rather than as `levyShort === 0`, because the two are not
    // the same claim: §5.2 permits a constellation to vote itself into trouble, and a constellation
    // that has genuinely run out of the good is *entitled* to a red line (the twelve-Reckoning
    // residue `test/levy/aged-solvency.spec.ts` pins is exactly that). What is not permitted is a
    // member recorded short in the escrowable bucket while its neighbours hold the goods that would
    // have filled it.
    for (const docket of world.dockets) {
      for (const line of docket.lines) {
        if (line.owed <= 0) continue;
        const escrowableShort = line.owed - line.presenceOwed;
        // A non-escrowable remainder is nobody else's to fill at any price (§5.2), so a line short
        // only on presence is not this file's subject.
        if (escrowableShort <= 0) continue;
        const beside = docket.lines
          .filter((other) => other.principal !== line.principal)
          .reduce((n, other) => n + Math.max(0, other.held - other.owed), 0);
        expect(
          beside,
          `R${String(docket.reckoning)} of ${SEED} voted ${docket.rule} and recorded ${line.principal} ` +
            `short ${String(line.owed)} of ${String(line.assessment)}, of which ` +
            `${String(escrowableShort)} was in the ESCROWABLE bucket — the share §5.2 lets another ` +
            `principal's hand carry. Its constellation was holding ${String(beside)} unpledged units ` +
            `of the levy good above their own outstanding duty at that settlement. The goods were ` +
            `there and the verb was legal, so what refused the carry was cast policy: see ` +
            `CAST_CARRY_RESERVE_RECKONINGS.`,
        ).toBeLessThan(escrowableShort);
      }
    }

    // ── AND THE TWO METERS, PINNED, because the property above is the REASON and these are the
    // REGRESSION. `scripts/balance-gate.ts`'s null control moved `ventures` −15% and `CARRIED` −83%
    // on nothing but the sign of a tie-break, so `levyShort` and the red-line count are the only two
    // of its columns that are evidence — and on this seed at this horizon they are measured facts
    // rather than a general claim about every possible world.
    expect(
      world.levyShort,
      `${SEED} at ${String(RECKONINGS)} Reckonings summed \`levyShort\` ${String(world.levyShort)}. ` +
        `Master reads 5,367 here, on \`p:halcyon\` at R7, and every other seed of the eight reads 0.`,
    ).toBe(0);
    expect(
      world.redTributeLines,
      `${SEED} published ${String(world.redTributeLines)} RED tribute lines in the freeze across ` +
        `${String(RECKONINGS)} Reckonings. A13: this is the mechanic's pixel signature, so a red ` +
        `line the world did not choose is a false accusation on the frame (A5′). Master reads 1.`,
    ).toBe(0);
  });

  it('★ A DOCKET THAT BILLS ONE MEMBER ABOVE THE FLAT DUTY IS STILL PAID IN FULL', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THIS IS `RULES_VERSION` 26's OWN BILL, AND IT IS THE ONE THAT WENT UNPAID.** Before 26,
    // EXPOSURE was identically zero, so `BY_EXPOSURE`, `EVEN` and the published default
    // `INVERSE_EXPOSURE` were one flat weight and no member was ever billed far from
    // `LEVY_DUTY_PER_PRINCIPAL`. With the delegated half summed, a member carrying four live
    // mandates is billed 2.4x the duty — legitimately, that is what the rule says — and the
    // question this asserts is whether an uneven docket is *payable*.
    //
    // §5.2 wants the vote to have teeth, so unevenness is the feature. A public shortfall is not.
    // ══════════════════════════════════════════════════════════════════════════
    const heavy = world.dockets.flatMap((d) =>
      d.lines.filter((l) => l.assessment > Number(LEVY_DUTY_PER_PRINCIPAL)).map((l) => ({ ...l, docket: d })),
    );
    // Non-vacuity, satisfied on master too: `p:halcyon` R7 at 48,768. If EXPOSURE ever goes flat
    // again this clause is what says so, and it says it as a failure rather than as a green run.
    expect(
      heavy.length,
      `no docket in ${String(RECKONINGS)} Reckonings of ${SEED} assessed ANY member above the flat ` +
        `duty of ${String(LEVY_DUTY_PER_PRINCIPAL)}. That is not this test passing — it is the ` +
        `allocation rules going flat again, which is D30's finding, and the assertion below would ` +
        `then be empty. Rules seen: ${[...new Set(world.dockets.map((d) => d.rule))]
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
          .join(' ')}.`,
    ).toBeGreaterThan(0);

    for (const line of heavy) {
      expect(
        line.owed,
        `R${String(line.docket.reckoning)} of ${SEED} voted ${line.docket.rule} and assessed ` +
          `${line.principal} ${String(line.assessment)} — ${String(
            Math.round((line.assessment / Number(LEVY_DUTY_PER_PRINCIPAL)) * 100) / 100,
          )}x the flat duty — and it finished ${String(line.owed)} short after delivering ` +
          `${String(line.paidOwn)} itself and being carried ${String(line.paidOther)}. An uneven ` +
          `docket is §5.2 working; an unpayable one is the cast refusing to distribute.`,
      ).toBe(0);
    }
  });

}, 300_000);
