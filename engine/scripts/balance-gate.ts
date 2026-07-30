#!/usr/bin/env node
/**
 * THE BALANCE GATE, as an instrument instead of as a paragraph somebody re-derives.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS FILE EXISTS.** `TRACKER.md` has published the same nine-row table three times —
 * `levyShort` · red tribute lines · `kept` · `broken` · ventures · live claims · rent ·
 * hulls · battles, master against a branch, N seeds each — and every one of those tables was
 * produced by a throwaway script that no longer exists. So the numbers could not be
 * reproduced, the seed sets differed between passes, and the *shape* of the comparison had
 * to be re-argued each time. A gate nobody can re-run is a claim, not a gate.
 *
 * Two properties are the whole design:
 *
 *   - **`--reckonings`, not `--ticks`.** Every sweep in this project's history ran 900 ticks
 *     — about three Reckonings — and `test/works/the-window-closes.spec.ts` records what that
 *     cost: the endowment window closes at Reckoning 5, so a 900-tick sweep is structurally
 *     incapable of seeing any gate priced in produced goods. The default is 3 to reproduce
 *     the historical table; **6 is the one that matters** and it is one flag away instead of
 *     a rewrite.
 *   - **`TRAPPED` is a first-class meter.** A principal that is rich in currency and cannot
 *     buy into the goods economy is the failure this instrument was built to see, and a
 *     balance table that reported ventures and rent while that number climbed would report a
 *     healthy world every time.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ```
 * npx tsx scripts/balance-gate.ts --seeds g01,g02 --reckonings 6 --members 8
 * npx tsx scripts/balance-gate.ts --seeds-from g --count 8            # g01..g08
 * ```
 *
 * Output is one row per seed plus a TOTAL row, on stdout, plus a machine-readable
 * `RESULT <json>` line so a sweep can be diffed between two checkouts without eyeballing.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ★ **READ THIS BEFORE QUOTING A CLEAN RUN AS EVIDENCE.**
 *
 * > **A byte-identical sweep is the reading a neutral change and a dead mechanic produce
 * > identically.**
 *
 * This file answers *"did the world still work"*. It cannot answer *"did the thing I built ever
 * do anything"*, and the two are routinely confused because a clean table looks like success. §16.12
 * #1 came back identical to master on **every** column at three, six and nine Reckonings — which was
 * correct, and said nothing at all about whether one lane had ever mattered.
 *
 * So a feature landing needs a **second instrument with a denominator**: how many times the mechanism
 * was *asked*, next to how many times it *bound*. `scripts/border-probe.ts` is the worked example and
 * carries the argument in full. This project has shipped a mechanic used by nothing **seventeen
 * times**; not one of those was caught by this file, and this file was green for all of them.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { HeuristicCast } from '../src/cast/index.js';
import { isSettlementTick, reckoningIndex, setSpeed, TICKS_PER_RECKONING } from '../src/core/time.js';
import { holdingOf } from '../src/world/index.js';
import { Runtime } from '../src/sim/runtime.js';
import { ENDOWMENT_WINDOW_RECKONINGS } from '../src/levy/params.js';

interface GateRow {
  readonly seed: string;
  readonly halted: boolean;
  readonly levyShort: number;
  readonly redTributeLines: number;
  readonly tributeLines: number;
  readonly kept: number;
  readonly broken: number;
  readonly ventures: number;
  readonly claims: number;
  readonly rent: number;
  readonly hulls: number;
  readonly battles: number;
  readonly works: number;
  /**
   * ★ WORKS this world DESTROYED — the razings. `Book.ruinsInOrder().length`.
   *
   * The meter that lands with the mechanism, and the reason it is here rather than inferred: for the
   * project's whole life `Book.raze` had no caller, and nothing in any instrument would have printed
   * the difference between *"nobody destroys production"* and *"production cannot be destroyed"*. A
   * `razed` of 0 across every seed is therefore a **finding**, not a clean bill: it means the raid
   * clock never produced a rout with a structure standing under it, and the loop is not closed.
   */
  readonly razed: number;
  /**
   * ★ WORKS raised by a principal AFTER one of its own was razed — **the replacement demand.**
   *
   * This is the column the whole change exists to move. Destroying capacity only closes EVE's loop if
   * somebody rebuilds: a razing with no rebuild has added a loss and no economy, and that answer is
   * worth more than a shipped mechanic. Counted per holder against its earliest razing rather than as
   * `raised - razed`, because the latter cannot tell a replacement from a newcomer's first structure.
   */
  readonly rebuilt: number;
  /** Members holding no WORKS and rich enough in currency to buy one. The trap. */
  readonly trapped: number;
  /**
   * ★ MINOR of Levy discharged by **somebody else's hand** — `Σ paidOther` over every docket.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **A METER FOR THE MECHANISM, BECAUSE THE ABSENCE OF ONE IS HOW IT STAYED INVISIBLE.**
   * §5.2 escrows 70% of every assessment and lets another principal's hand carry it;
   * `deliver {payer}` has implemented that since the Levy landed; `paidOther` was **0 in every
   * world this repo had ever run** and no instrument printed the figure, so nothing could tell
   * the difference between a mechanism nobody used and a mechanism that did not exist.
   *
   * This column is that difference. A `levyShort` of 0 with `carried` of 0 means the world never
   * needed the mechanism; a `levyShort` of 0 with `carried` above it means the mechanism is what
   * closed the gap — and those are different findings that the old table reported identically.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly carried: number;
  readonly finalStateHash: string;
}

function runOne(seed: string, ticks: number, members: number): GateRow {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: members });
  const roster = cast.seat(seed);

  let halted = false;
  let redTributeLines = 0;
  let tributeLines = 0;
  let finalStateHash = '';
  // ── ACCUMULATED PER SETTLEMENT, NOT SUMMED OFF `levyReckonings()` AT THE END ──
  //
  // `Runtime.levyReckonings()` and `Runtime.reckonings()` both return a `Ring` bounded at
  // `MAX_RECKONING_SUMMARIES` = 8, so a sweep longer than eight Reckonings silently DROPS the
  // oldest ones from every total this file prints — `levyShort`, `kept`, `broken`. That is the
  // `Book.prune` hazard living in the instrument rather than in the engine, and it fails in the
  // direction that hides: a nine-Reckoning sweep whose worst Reckoning was its first would report
  // a smaller number than a six-Reckoning one. Read at the settlement tick, these are the whole
  // run whatever its length.
  let levyShort = 0;
  let kept = 0;
  let broken = 0;
  // Accumulated at the settlement tick for the SAME prune reason as `levyShort`, and one more:
  // `Book.prune` keeps `LEVY_RETAINED_RECKONINGS` (3) of payment rows, so a read at the end of a
  // nine-Reckoning run would see the last three dockets and report a third of the truth. The
  // current Reckoning's rows survive `prune(current)` by construction (`reckoning >= current - 3`),
  // so reading here is the whole run whatever its length.
  let carried = 0;
  for (let i = 0; i < ticks; i += 1) {
    const next = runtime.engine.tick + 1;
    for (const action of cast.decide(next, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    finalStateHash = report.stateHash;
    // Sampled in the freeze, which is where the published frame is drawn from and therefore
    // the only reading a viewer ever sees. Counted CUMULATIVELY across Reckonings rather than
    // read once at the end: one red line on Reckoning 2 is the finding even if Reckoning 6
    // is clean, and a last-look reading would silently drop it.
    if (report.clock.inFreeze) {
      for (const line of runtime.tributeLines(report.tick)) {
        tributeLines += 1;
        if (line.state === 'RED') redTributeLines += 1;
      }
    }
    if (isSettlementTick(report.tick)) {
      levyShort += runtime.levySettlement?.levyShort ?? 0;
      const reckoning = reckoningIndex(report.tick);
      for (const plan of runtime.levy.plansIn(reckoning)) {
        for (const line of plan.lines) {
          carried += runtime.levy.paymentOf(reckoning, line.principal).paidOther;
        }
      }
      const settled = runtime.reckonings().at(-1);
      if (settled !== undefined) {
        kept += settled.electiveHonoured;
        broken += settled.defaults;
      }
    }
    if (report.halted) {
      halted = true;
      break;
    }
  }

  const rent = runtime.works.liveInOrder().reduce((n, w) => n + w.rentPaid, 0);

  // ── ★ RAZINGS AND REBUILDS ────────────────────────────────────────────────
  //
  // `rebuilt` is per holder against that holder's EARLIEST razing: a WORKS raised after a principal
  // first lost one is a replacement. `raised - razed` would count a newcomer's first structure as a
  // rebuild and report replacement demand a world never produced.
  const ruins = runtime.works.ruinsInOrder();
  const firstLossOf = new Map<string, number>();
  for (const ruin of ruins) {
    const at = ruin.razedAtTick ?? Number.MAX_SAFE_INTEGER;
    const held = firstLossOf.get(String(ruin.holder));
    if (held === undefined || at < held) firstLossOf.set(String(ruin.holder), at);
  }
  let rebuilt = 0;
  for (const works of runtime.works.everInOrder()) {
    const lost = firstLossOf.get(String(works.holder));
    if (lost !== undefined && works.raisedAtTick > lost) rebuilt += 1;
  }

  let trapped = 0;
  for (const member of roster) {
    if (runtime.works.ofPrincipal(member.principal).length > 0) continue;
    const quote = runtime.worksQuote(member.principal, holdingOf(runtime.world, member.principal).system);
    if (quote.freeMinor >= quote.costMinor && !quote.affordable) trapped += 1;
  }

  return {
    seed,
    halted,
    levyShort,
    redTributeLines,
    tributeLines,
    kept,
    broken,
    ventures: runtime.ventures.size,
    claims: runtime.sovereignty.liveClaims().length,
    rent,
    hulls: runtime.fleet.all().length,
    battles: runtime.battles.all().length,
    works: runtime.works.liveInOrder().length,
    razed: ruins.length,
    rebuilt,
    trapped,
    carried,
    finalStateHash,
  };
}

function parse(argv: readonly string[]): {
  readonly seeds: readonly string[];
  readonly ticks: number;
  readonly members: number;
} {
  let seeds: string[] = ['gate-a', 'gate-b', 'gate-c', 'gate-d'];
  let reckonings = 3;
  /** `--ticks` overrides, because the historical table is 900 ticks and 900 is not a multiple of 288. */
  let ticks: number | null = null;
  let members = 8;
  let prefix: string | null = null;
  let count = 8;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === undefined) continue;
    if (value === undefined) throw new Error(`${flag} needs a value`);
    switch (flag) {
      case '--seeds':
        seeds = value.split(',');
        break;
      case '--seeds-from':
        prefix = value;
        break;
      case '--count':
        count = Number.parseInt(value, 10);
        break;
      case '--reckonings':
        reckonings = Number.parseInt(value, 10);
        break;
      case '--ticks':
        ticks = Number.parseInt(value, 10);
        break;
      case '--members':
        members = Number.parseInt(value, 10);
        break;
      default:
        throw new Error(`unknown flag ${flag}`);
    }
    i += 1;
  }
  if (prefix !== null) {
    seeds = [];
    for (let n = 1; n <= count; n += 1) seeds.push(`${prefix}${String(n).padStart(2, '0')}`);
  }
  return { seeds, ticks: ticks ?? reckonings * TICKS_PER_RECKONING, members };
}

const args = parse(process.argv.slice(2));
process.stdout.write(
  `balance gate — ${String(args.seeds.length)} seeds x ${String(args.ticks)} ticks ` +
    `(${String(Math.floor(args.ticks / TICKS_PER_RECKONING))} Reckonings) x ${String(args.members)} members\n\n`,
);
process.stdout.write(
  'seed        levyShort  red/lines   kept broken  ventures claims     rent hulls battles works RAZED REBUILT TRAPPED   CARRIED\n',
);
const rows: GateRow[] = [];
for (const seed of args.seeds) {
  const row = runOne(seed, args.ticks, args.members);
  rows.push(row);
  process.stdout.write(
    `${seed.padEnd(11)} ${String(row.levyShort).padStart(9)}  ` +
      `${`${String(row.redTributeLines)}/${String(row.tributeLines)}`.padStart(9)} ` +
      `${String(row.kept).padStart(6)} ${String(row.broken).padStart(6)} ` +
      `${String(row.ventures).padStart(9)} ${String(row.claims).padStart(6)} ` +
      `${String(row.rent).padStart(8)} ${String(row.hulls).padStart(5)} ` +
      `${String(row.battles).padStart(7)} ${String(row.works).padStart(5)} ` +
      `${String(row.razed).padStart(5)} ${String(row.rebuilt).padStart(7)} ` +
      `${String(row.trapped).padStart(7)} ${String(row.carried).padStart(9)}` +
      `${row.halted ? '  HALTED' : ''}\n`,
  );
}
const sum = (pick: (r: GateRow) => number): number => rows.reduce((n, r) => n + pick(r), 0);
const total = {
  seeds: rows.length,
  ticks: args.ticks,
  members: args.members,
  halted: rows.filter((r) => r.halted).length,
  levyShort: sum((r) => r.levyShort),
  redTributeLines: sum((r) => r.redTributeLines),
  tributeLines: sum((r) => r.tributeLines),
  kept: sum((r) => r.kept),
  broken: sum((r) => r.broken),
  ventures: sum((r) => r.ventures),
  claims: sum((r) => r.claims),
  rent: sum((r) => r.rent),
  hulls: sum((r) => r.hulls),
  battles: sum((r) => r.battles),
  works: sum((r) => r.works),
  razed: sum((r) => r.razed),
  rebuilt: sum((r) => r.rebuilt),
  trapped: sum((r) => r.trapped),
  carried: sum((r) => r.carried),
};
/**
 * ── THE HORIZON IS PART OF THE RESULT, AND A SHORT SWEEP MAY NOT REPORT GREEN ──
 *
 * `test/levy/aged-solvency.spec.ts` measures what this exists for: `g07` is `levyShort` **0** at
 * three Reckonings and **37,237** at six, on one seed, with nothing changed but the length. The
 * endowment window (`test/works/aged.ts`) is four Reckonings, so a three-Reckoning sweep is still
 * watching the enrolment allotment pay the tribute — it cannot observe the economy the world runs
 * on, and every balance table ever published in `TRACKER.md` was drawn there.
 *
 * So a sweep at or under the window prints its own limit next to its zeroes. Not a refusal to run
 * — the default exists to reproduce the historical table and that is worth keeping — a refusal to
 * be quoted as evidence. The inverse failure matters too and is why this is a line of text rather
 * than a non-zero exit: a gate that cried wolf on the default horizon would be edited out.
 */
const reckoningsRun = Math.floor(args.ticks / TICKS_PER_RECKONING);
const seesTheEconomy = reckoningsRun > ENDOWMENT_WINDOW_RECKONINGS;

process.stdout.write(
  `${'TOTAL'.padEnd(11)} ${String(total.levyShort).padStart(9)}  ` +
    `${`${String(total.redTributeLines)}/${String(total.tributeLines)}`.padStart(9)} ` +
    `${String(total.kept).padStart(6)} ${String(total.broken).padStart(6)} ` +
    `${String(total.ventures).padStart(9)} ${String(total.claims).padStart(6)} ` +
    `${String(total.rent).padStart(8)} ${String(total.hulls).padStart(5)} ` +
    `${String(total.battles).padStart(7)} ${String(total.works).padStart(5)} ` +
    `${String(total.razed).padStart(5)} ${String(total.rebuilt).padStart(7)} ` +
    `${String(total.trapped).padStart(7)} ${String(total.carried).padStart(9)}\n`,
);
if (!seesTheEconomy) {
  process.stdout.write(
    `\n⚠ HORIZON ${String(reckoningsRun)} RECKONINGS — AT OR UNDER THE ${String(
      ENDOWMENT_WINDOW_RECKONINGS,
    )}-RECKONING ENDOWMENT WINDOW.\n` +
      '  The enrolment allotment is still paying the tribute here, so a clean `levyShort` and a clean\n' +
      '  red-line count say NOTHING about whether the produced economy covers its obligations. `g07`\n' +
      '  reads 0 at three Reckonings and 37,237 at six. Re-run with `--reckonings 6` (and 9) before\n' +
      '  quoting these zeroes as a balance result. See test/levy/aged-solvency.spec.ts.\n',
  );
}
process.stdout.write(
  `\nRESULT ${JSON.stringify({ ...total, reckonings: reckoningsRun, seesTheEconomy })}\n`,
);
