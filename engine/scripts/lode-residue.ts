/**
 * ★ **WHERE DOES THE CAST STAND, AND IS THAT GROUND RICH OR POOR?**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE QUESTION THIS ANSWERS.** A lode conserves a **tier's** total exactly — but the cast occupies
 * five or six of eighteen MARCHES systems, and *the occupied subset's* total is conserved by nothing
 * at all. So a world can be short on the same map that produces the same aggregate, purely because
 * of which ground the cast happens to be standing on.
 *
 * That is the difference between a calibration question and a design defect, and it is not
 * answerable by staring at `levyShort`: a shortfall reads identically whether the cast settled poor
 * or the allocation misfired. This prints the discriminator — Σ over the OCCUPIED systems against Σ
 * of the tier BASE over the same count, per Reckoning.
 *
 *   occupiedΣ  <  baseΣ   the cast settled on poor ground; the lode moved the burden
 *   occupiedΣ  ≥  baseΣ   the ground is fine and the shortfall is distribution or timing
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `npx tsx scripts/lode-residue.ts [seed] [reckonings]`
 */

import { HeuristicCast } from '../src/cast/index.js';
import { isSettlementTick, reckoningIndex, setSpeed, TICKS_PER_RECKONING } from '../src/core/time.js';
import type { SystemId } from '../src/core/types.js';
import { LEVY_DUTY_PER_PRINCIPAL } from '../src/levy/params.js';
import { Runtime } from '../src/sim/runtime.js';
import { systemYield, YIELD_PER_TICK } from '../src/works/params.js';
import { tierOf } from '../src/world/map.js';

function main(): void {
  const seed = process.argv[2] ?? 'g01';
  const reckonings = Number(process.argv[3] ?? '9');
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: 8 });
  cast.seat(seed);

  console.log(`seed ${seed}, ${String(reckonings)} Reckonings, 8 members`);
  console.log('Rk  short   carried  occupied  occupiedΣ  baseΣ    Δ      duty     systems');

  for (let i = 0; i < reckonings * TICKS_PER_RECKONING; i += 1) {
    const next = runtime.engine.tick + 1;
    for (const action of cast.decide(next, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    if (report.halted) throw new Error(`halted at ${String(report.tick)}`);
    if (!isSettlementTick(report.tick)) continue;

    const occupied = new Set<SystemId>(runtime.works.liveInOrder().map((w) => w.system));
    let occupiedSum = 0;
    let baseSum = 0;
    const rows: string[] = [];
    for (const system of [...occupied].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const y = systemYield(runtime.world.map, system);
      const base = YIELD_PER_TICK[tierOf(runtime.world.map, system)];
      occupiedSum += y;
      baseSum += base;
      rows.push(`${system}:${String(y)}${y === base ? '' : y > base ? '+' : '-'}`);
    }
    const duty = Number(LEVY_DUTY_PER_PRINCIPAL) * runtime.world.principalOrder.length;
    const short = runtime.levySettlement?.levyShort ?? -1;
    // ⚑ `paidOther` is a per-LINE field on the levy BOOK, not a field on `LevySettlement`. The first
    // version of this script read `levySettlement.paidOther`, got `undefined ?? 0`, and printed a
    // confident **0 carried** for nine Reckonings — an instrument reporting that a mechanism never
    // fired when it had never asked. `tsc` caught it; nothing in the output would have.
    let carried = 0;
    const rk = reckoningIndex(report.tick);
    for (const plan of runtime.levy.plansIn(rk)) {
      for (const line of plan.lines) carried += runtime.levy.paymentOf(rk, line.principal).paidOther;
    }
    console.log(
      `${String(rk).padStart(2)} ${String(short).padStart(7)} ` +
        `${String(carried).padStart(9)} ${String(occupied.size).padStart(8)} ` +
        `${String(occupiedSum * TICKS_PER_RECKONING).padStart(10)} ` +
        `${String(baseSum * TICKS_PER_RECKONING).padStart(7)} ` +
        `${String((occupiedSum - baseSum) * TICKS_PER_RECKONING).padStart(7)} ` +
        `${String(duty).padStart(8)}  ${rows.join(' ')}`,
    );
  }
}

main();
