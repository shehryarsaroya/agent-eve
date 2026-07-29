/**
 * `risk-probe` — does the risk market bind, does a catastrophe propagate, and is A15 priced?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **Three questions, and a negative answer to any of them is worth more than a shipped mechanic
 * nobody enters.** This is the instrument, not the test suite: the suite proves the machine works
 * given a chain; this asks what a world that nobody steers actually does with it.
 *
 *   `npx tsx scripts/risk-probe.ts [--seeds N] [--reckonings N]`
 *
 * ## 1. THE FRONT — does the world produce catastrophes at all?
 *
 * A front is scheduled (A14), so this is arithmetic rather than luck; what is *not* arithmetic is how
 * much it destroys and how many principals it reaches. Prints struck fronts, systems swept, goods
 * destroyed, and **`naked`** — principals whose goods it took that held no COVER. Naked is the demand
 * side's own measure: if it is always zero the market has no customers; if it is always everyone the
 * market has no reach.
 *
 * ## 2. ★ A15, BY MEASUREMENT RATHER THAN ARGUMENT — N = 1 / 4 / 16 AT ONE SYSTEM
 *
 * *"The pattern here is N = 1/4/16 identities at one system, and it has caught a wrong design
 * twice."* The question is whether an operator with sixteen identities can write sixteen times the
 * cover, and the answer must be **no**: a COVER's escrow is funded from `freeCash`, which is
 * `freeBalance − endowments.remaining`, so a fresh identity's whole balance is withheld and its
 * writable capacity is **zero**.
 *
 * The table prints total writable limit at N = 1, 4 and 16. **The design is wrong if it scales with
 * N.** It is also, separately, a reachability warning if N = 1 prints zero for a *mature* principal —
 * that is D7's open floor question, and this is the instrument that would show it.
 *
 * ## 3. PROPAGATION — does one failure become several agents' problem?
 *
 * The suite proves it can with a hand-built chain. This prints what a driven world reaches: cohorts
 * opened, layers deep, defaults, and how many of those defaults cite **another default** rather than
 * the storm. Zero propagation with non-zero defaults is a real finding and should be reported as one:
 * it would mean the layer is insurance without contagion, which is a tax with extra steps.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { Rng } from '../src/core/rng.js';
import { TICKS_PER_RECKONING, setSpeed } from '../src/core/time.js';
import type { GoodId, PrincipalId, SystemId } from '../src/core/types.js';
import { minor, qty } from '../src/core/units.js';
import { GOODS_FAUCET, storesAccount } from '../src/ledger/accounts.js';
import { LEVY_GOOD } from '../src/levy/index.js';
import { freeCash } from '../src/market/escrow.js';
import { COVER_ELECTIVE_BPS_CEILING, riskSubjects, type CoverId } from '../src/risk/index.js';
import { Runtime } from '../src/sim/runtime.js';

function arg(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit !== undefined) return Number(hit.split('=')[1]);
  const idx = process.argv.indexOf(`--${name}`);
  const next = idx >= 0 ? process.argv[idx + 1] : undefined;
  return next === undefined ? fallback : Number(next);
}

const SEEDS = arg('seeds', 4);
const RECKONINGS = arg('reckonings', 4);

function seat(runtime: Runtime, tier: 'COMMONS' | 'MARCHES' | 'FRONTIER', seed: string, n: number): {
  readonly system: SystemId;
  readonly principals: readonly PrincipalId[];
} {
  const system = runtime.seatInTier(tier, Rng.fromSeed(`${seed}:stage`));
  if (system === undefined) throw new Error(`no ${tier} system`);
  const principals: PrincipalId[] = [];
  for (let i = 0; i < n; i += 1) {
    const handle = `rp${String(i + 1).padStart(2, '0')}`;
    const principal = `p:${handle}` as PrincipalId;
    runtime.seat(principal, handle, system);
    runtime.standing.open(principal);
    principals.push(principal);
  }
  return { system, principals };
}

function stock(runtime: Runtime, who: PrincipalId, at: SystemId, amount: number, good: GoodId = LEVY_GOOD): void {
  runtime.ledger.sourceGoods({
    // The TICK is in the id, and it has to be: two fronts can strike the same system in one run, and a
    // content-derived id without the tick collides on `duplicate lot id` the second time. Found at
    // seven Reckonings, which is the first horizon with two fronts in it.
    eventId: `probe:stock:${who}:${at}:${String(amount)}:${String(runtime.engine.tick)}` as never,
    tick: runtime.engine.tick,
    faucet: GOODS_FAUCET.EXTRACTION,
    to: storesAccount(who),
    good,
    qty: qty(amount),
    location: at,
    origin: who,
  });
}

function submit(runtime: Runtime, principal: PrincipalId, verb: string, params: Record<string, unknown>): void {
  runtime.engine.submit({ principal, verb, params, clientSequence: 0, arrivalMs: 0, decisionSource: 'HEURISTIC' });
}

// ── 2. A15 ──────────────────────────────────────────────────────────────────

/**
 * How much COVER an operator with `n` identities can write, in total limit.
 *
 * `freeCash` is the only thing that funds an escrow, so the writable limit is
 * `Σ freeCash / (1 − elective_bps)` at the most promise-heavy legal ratio — the *cheapest* cover an
 * operator could write, which is the direction that favours the attacker.
 */
function a15Sweep(): void {
  process.stdout.write('\n── 2. A15: writable COVER against N identities at one system ──\n');
  process.stdout.write('    N   Σ freeCash   Σ writable limit   per identity\n');
  for (const n of [1, 4, 16]) {
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'a15-risk' });
    const { principals } = seat(runtime, 'MARCHES', 'a15-risk', n);
    let cash = 0;
    for (const p of principals) cash += freeCash(runtime.ledger, p);
    // The most cover this cash could buy, at the highest legal elective share.
    const escrowShare = 10_000 - COVER_ELECTIVE_BPS_CEILING;
    const writable = escrowShare === 0 ? 0 : Math.trunc((cash * 10_000) / escrowShare);
    process.stdout.write(
      `  ${String(n).padStart(3)}   ${String(cash).padStart(10)}   ${String(writable).padStart(16)}   ` +
        `${String(Math.trunc(writable / n)).padStart(12)}\n`,
    );
  }
  process.stdout.write(
    '\n  ★ Every row must read 0. A COVER escrow is funded from `freeCash` = `freeBalance − ' +
      'endowments.remaining`,\n    so a fresh identity is worth exactly nothing to an operator and the ' +
      'gate is priced in slashable capital (A15).\n    A non-zero row that scales with N is a Sybil ' +
      'price of zero and the design is wrong.\n',
  );
  process.stdout.write(
    '  ⚠ The same arithmetic is a REACHABILITY warning: a principal that has never been paid cannot ' +
      'write cover\n    OR buy it. That is D7’s open floor question, not a bug in this layer — see ' +
      '`test/risk/fixture.ts:fund`.\n',
  );
}

// ── 1 & 3. Driven worlds ────────────────────────────────────────────────────

interface SeedReport {
  readonly seed: string;
  readonly thin: boolean;
  readonly struckFronts: number;
  readonly systemsSwept: number;
  readonly destroyedQty: number;
  readonly naked: number;
  readonly coversBound: number;
  readonly cessions: number;
  readonly cohorts: number;
  readonly defaults: number;
  readonly propagated: number;
  readonly deepest: number;
  readonly paidOut: number;
}

/**
 * One world, driven to `RECKONINGS`, with a scripted chain per front.
 *
 * ⚑ **Scripted, and that is stated rather than hidden.** `src/cast/heuristic.ts` is owned elsewhere
 * this round, so the cast has no COVER branch and a world genuinely nobody steers writes **zero**
 * cover — which would make questions 1 and 3 unanswerable rather than answered negatively. So this
 * drives the six calls `test/risk/cast-hook.spec.ts` enumerates, and what it measures is whether the
 * *engine* produces catastrophes, cohorts and contagion at world scale. **Whether a heuristic cast
 * chooses to buy cover is a separate, unanswered question** and it is the next measurement, not this
 * one.
 */
function drive(seed: string, thin: boolean): SeedReport {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const { principals } = seat(runtime, 'MARCHES', seed, 8);
  const [payee, payer, reinsurer, bankA, bankB, bankC] = principals;
  if (
    payee === undefined ||
    payer === undefined ||
    reinsurer === undefined ||
    bankA === undefined ||
    bankB === undefined ||
    bankC === undefined
  ) {
    throw new Error('eight seats');
  }
  // ★ Earned capital, from the endowment identity's own door: a transfer in.
  //
  // **`thin` is the whole second half of the measurement.** A DEEP primary is funded 200,000 and can
  // honour its insured out of pocket whatever its reinsurer does — so a reinsurer's default is
  // *absorbed* and nothing propagates. A THIN primary is funded only what writing the cover cost it
  // (`halvesOf(60,000).escrowed` plus the cession premium), so at the settlement its whole liquidity
  // is whatever its reinsurer just handed over. That is SOL4's scenario verbatim: *"solvent if its
  // reinsurer pays, dead tonight if it does not."*
  //
  // Running both is the point. Contagion is not a property of the mechanism alone — it is a property
  // of the mechanism **and the primary's balance sheet**, and a probe that only ran the deep case
  // would have reported `PROP 0` and called the layer a tax with extra steps.
  for (const [from, to, amount] of [
    [bankA, payer, 200_000],
    [bankB, reinsurer, 200_000],
    [bankC, payee, 200_000],
  ] as const) {
    runtime.ledger.transferCurrency({
      eventId: `probe:fund:${from}:${to}` as never,
      tick: runtime.engine.tick,
      from: storesAccount(from),
      to: storesAccount(to),
      amount: minor(amount),
    });
  }
  // A second holder at the same system that buys nothing, so `naked` measures the demand side rather
  // than reporting zero because the only exposed principal happened to be the insured one.
  const bystander = principals[6];

  const done = new Set<string>();
  const elected = new Set<CoverId>();
  let struckFronts = 0;
  let systemsSwept = 0;
  let destroyedQty = 0;
  let naked = 0;
  let cohorts = 0;
  let defaults = 0;
  let propagated = 0;
  let deepest = 0;

  const target = RECKONINGS * TICKS_PER_RECKONING;
  while (runtime.engine.tick < target) {
    const report = runtime.runTick();
    if (report.halted) {
      process.stdout.write(
        `  ${seed}: HALTED at ${String(report.tick)} — ` +
          report.violations.map((v) => `${v.id} ${v.message}`).join(' | ') +
          '\n',
      );
      break;
    }
    const tick = runtime.engine.tick;

    // Write the chain once per front, as soon as its CONE is up.
    for (const front of runtime.risk.liveFronts(tick)) {
      if (front.struckAtTick !== null || done.has(front.id)) continue;
      done.add(front.id);
      const cell = [...front.swath].sort((a, b) => b.intensityBps - a.intensityBps)[0];
      if (cell === undefined) continue;
      stock(runtime, payee, cell.system, 400_000);
      if (bystander !== undefined) stock(runtime, bystander, cell.system, 100_000);
      submit(runtime, payer, 'publish_offer', {
        kind: 'COVER',
        system: cell.system,
        good: LEVY_GOOD,
        limit: 60_000,
        premium: 1_000,
        elective_bps: COVER_ELECTIVE_BPS_CEILING,
      });
    }
    // Bind whatever is offered, one hop at a time, as the ticks pass.
    for (const cover of runtime.risk.openOffers(tick)) {
      if (cover.over.kind === 'GOODS') {
        submit(runtime, payee, 'sign', { cover: cover.id, terms_hash: cover.termsHash ?? '' });
      } else {
        submit(runtime, payer, 'sign', { cover: cover.id, terms_hash: cover.termsHash ?? '' });
      }
    }
    // Cede once the primary is bound.
    for (const cover of runtime.risk.coversBy(payer)) {
      if (cover.payee === null) continue;
      if (runtime.risk.cessionsOver(cover.id).length > 0) continue;
      submit(runtime, reinsurer, 'publish_offer', {
        kind: 'COVER',
        over: cover.id,
        limit: 10_000,
        premium: 800,
        elective_bps: COVER_ELECTIVE_BPS_CEILING,
      });
    }
    // ★ THIN: drain the primary's free stores on the strike tick.
    //
    // Funding it less at the start does **not** work, and finding that out is the useful part: the
    // A15 gate reads `freeCash` (`freeBalance − endowments.remaining`) but the *payment* at
    // settlement comes out of `freeBalance`, which includes the starter stake. That is not an
    // inconsistency in this layer — `venture/settlement.ts:payElectiveParts` pays a venture's elective
    // half from `freeBalance` too, so the endowment has always been spendable on a promise and only
    // unspendable on a market BID or a COVER escrow. So a payer with a full stake can honour an
    // INDEMNITY, and making it genuinely short means taking the stake away.
    if (thin) {
      const account = storesAccount(payer);
      const free = runtime.ledger.freeBalance(account);
      const struckNow = runtime.risk.allFronts().some((f) => f.struckAtTick === tick);
      if (struckNow && free > 0) {
        runtime.ledger.retireCurrency({
          eventId: `probe:thin:${seed}:${String(tick)}` as never,
          tick,
          sink: 'sink:fees' as never,
          from: account,
          amount: free,
        });
      }
    }
    // The primary always tries to honour; the reinsurer never does. That asymmetry is the point of
    // the measurement, not a claim about how agents behave.
    for (const ind of runtime.risk.dueBy(payer)) {
      if (elected.has(ind.cover)) continue;
      elected.add(ind.cover);
      submit(runtime, payer, 'elect', { cover: ind.cover, election: 'IN_FULL' });
    }

    for (const rec of runtime.events.eventsAtTick(tick)) {
      const e = rec.event;
      const p = e.payload as Record<string, number | string>;
      if (e.kind === 'front.swept') {
        struckFronts += 1;
        systemsSwept += String(p['swath'] ?? '').split(',').filter((x) => x.length > 0).length;
        destroyedQty += Number(p['destroyedQty'] ?? 0);
        naked += Number(p['naked'] ?? 0);
      }
      if (e.kind === 'indemnity.opened') cohorts += 1;
      if (e.kind === 'indemnity.default') defaults += 1;
      if (e.kind === 'indemnity.propagated') {
        propagated += Number(p['propagated'] ?? 0);
        deepest = Math.max(deepest, Number(p['deepestFailure'] ?? 0));
      }
    }
  }

  const subjects = riskSubjects(runtime.risk);
  let paidOut = 0;
  for (const row of runtime.risk.allRecords()) paidOut += row.paidOut;
  return {
    seed,
    thin,
    struckFronts,
    systemsSwept,
    destroyedQty,
    naked,
    coversBound: subjects.boundCovers,
    cessions: subjects.cessions,
    cohorts,
    defaults,
    propagated,
    deepest,
    paidOut,
  };
}

function main(): void {
  process.stdout.write(
    `risk-probe — ${String(SEEDS)} seeds x ${String(RECKONINGS)} Reckonings\n` +
      '════════════════════════════════════════════════════════════════════════\n',
  );

  process.stdout.write('\n── 1 & 3. THE FRONT, THE COHORT, AND THE CONTAGION ──\n');
  process.stdout.write(
    '  seed        fronts  systems  destroyed   naked  bound  ceded  cohort  def  PROP  deep     paid\n',
  );
  const rows: SeedReport[] = [];
  for (const thin of [false, true]) {
    process.stdout.write(`  ${thin ? '── THIN primary' : '── DEEP primary'} ──\n`);
  for (let i = 0; i < SEEDS; i += 1) {
    const row = drive(`risk-probe-${String(i).padStart(2, '0')}`, thin);
    rows.push(row);
    process.stdout.write(
      `  ${row.seed.padEnd(12)}${String(row.struckFronts).padStart(6)}` +
        `${String(row.systemsSwept).padStart(9)}${String(row.destroyedQty).padStart(11)}` +
        `${String(row.naked).padStart(8)}${String(row.coversBound).padStart(7)}` +
        `${String(row.cessions).padStart(7)}${String(row.cohorts).padStart(8)}` +
        `${String(row.defaults).padStart(5)}${String(row.propagated).padStart(6)}` +
        `${String(row.deepest).padStart(6)}${String(row.paidOut).padStart(9)}\n`,
    );
  }
  }
  const total = (pick: (r: SeedReport) => number): number => rows.reduce((s, r) => s + pick(r), 0);
  process.stdout.write(
    `  ${'TOTAL'.padEnd(12)}${String(total((r) => r.struckFronts)).padStart(6)}` +
      `${String(total((r) => r.systemsSwept)).padStart(9)}${String(total((r) => r.destroyedQty)).padStart(11)}` +
      `${String(total((r) => r.naked)).padStart(8)}${String(total((r) => r.coversBound)).padStart(7)}` +
      `${String(total((r) => r.cessions)).padStart(7)}${String(total((r) => r.cohorts)).padStart(8)}` +
      `${String(total((r) => r.defaults)).padStart(5)}${String(total((r) => r.propagated)).padStart(6)}` +
      `${String(Math.max(...rows.map((r) => r.deepest))).padStart(6)}` +
      `${String(total((r) => r.paidOut)).padStart(9)}\n`,
  );

  process.stdout.write(
    '\n  How to read it:\n' +
      '   · `fronts` 0 means the clock is broken — a front is SCHEDULED (A14), never rolled.\n' +
      '   · `destroyed` 0 with `fronts` > 0 means the SWATH missed every holding: the peril exists and\n' +
      '     reaches nobody, which is the mechanic being unreachable one layer down.\n' +
      '   · `cohort` 0 with `destroyed` > 0 means nothing was covered — a market with no customers.\n' +
      '   · ★ `PROP` 0 with `def` > 0 is the finding that matters: insurance WITHOUT contagion, which is\n' +
      '     a tax with extra steps. Report it rather than tuning until it is non-zero.\n' +
      '   · `naked` is the demand side, measured: principals the front robbed who had bought nothing.\n' +
      '   · ★ THE TWO BLOCKS ARE THE ANSWER TO WHY `PROP` MOVES: a DEEP primary absorbs its ' +
      'reinsurer’s\n     refusal out of pocket, a THIN one cannot. Contagion is a property of the ' +
      'mechanism AND the\n     balance sheet, which is SOL4 (*"solvent if its reinsurer pays, dead ' +
      'tonight if it does not"*).\n',
  );

  a15Sweep();
}

main();
