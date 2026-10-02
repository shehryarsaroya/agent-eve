/**
 * ★ **NO MEMBER BEARS THE DOCKET — §5.2's max share** (owner call (3) of the Season 1 launch fixes).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHAT THE OWNER DECIDED, AND WHY.** Under the published default `INVERSE_EXPOSURE` a member at an
 * EXPOSURE high-water mark of 0 weighs 1,000,000 against a few thousand for a member that staked, so
 * when its constellation-mates are exposed it takes nearly the whole docket — measured near season
 * end at 5–9x `LEVY_DUTY_PER_PRINCIPAL`, and on `g07` R6 at the balance-gate horizon: `p:varrow`
 * assessed 101,844 of the 120,000. Its co-members carried the whole escrowable 70%; its 30% presence
 * share, 30,554, is nobody else's to carry at any price, and it came up 8,194 short.
 *
 * The rule (`LEVY_MAX_SHARE_MULTIPLE`, `levy/assessment.ts:maxShareOf`): **no line of a docket's
 * remainder pool exceeds three times the pool's even share**, and what a held line no longer carries
 * goes to the rest of the pool by the same rule's weights, until nothing is over. Floored and spared
 * lines are the nominal rate and untouched.
 *
 * ── WHAT IS ASSERTED, AND EACH CLAUSE ESTABLISHES ITS SUBJECT FIRST ─────────
 *
 *   1. On a docket shaped like the finding, the free share IS over the bound (asserted before
 *      anything about the bound), and the line is held at exactly three duties.
 *   2. The excess goes to the others **by the rule's own weights** — they are exactly
 *      `largestRemainder(what is left, their weights)` — so the more a rule weighs a member, the
 *      more of the excess it bears, and the order of the bill is the order of the weights.
 *   3. Water-filling: a line pushed over the bound by another's excess is held too.
 *   4. Floored and spared lines are the nominal rate with weight 0, and a spared member raises the
 *      even share and the bound with it — the "about" in *"about 3x the normal duty"*.
 *   5. A seeded sweep: Σ exact, no line above the bound, fewer than a third of a pool held, the free
 *      docket unchanged to the unit wherever nothing is over it, and nothing held below a pool of four.
 *   6. INV-24 passes the docket `allocate` cuts and halts the same docket cut without the bound.
 *   7. **The preview the cast votes on is the assessment**, rule by rule — and the vote changes
 *      because of it: on the finding's docket an exposed member that the weight ratio sent to
 *      `INVERSE_EXPOSURE` is billed less under `BY_EXPOSURE` once the bound has moved the excess.
 *      (7b: where `allocate` cannot cut a docket, the preview throws the same `LevyArithmeticError` —
 *      the one class the cast's ballot catches, so `decide` stays total.)
 *   8. In a real world (`g08`, eight members, six Reckonings): a docket line is held at the bound, the
 *      member's own observation shows the bound as its assessment, every LEVY ballot the cast casts
 *      is the rule whose previewed bill is lowest, and at least one of them is a ballot the old weight
 *      ratio would have cast differently.
 *
 * MUTATION, run rather than reasoned about (each on this file, then restored):
 *
 *   - `allocate` dividing the pool with `largestRemainder` instead of `poolShares` — the bound removed
 *     from the one place a docket is cut: 1, 2, 4, 6 and 7 go red (`p:varrow` 103,527 where 60,000 is
 *     the bound; ashby's preview 17,956 against a bill of 4,930), and the real world of 8 **halts** at
 *     tick 864 — `INV-24 p:sable is assessed 104059 in con-1, above the max share of 69750` — which is
 *     the bound failing closed rather than silently. 3 and 5 stay green: they call `poolShares` itself.
 *   - the cast's ballot reverted to the weight ratio: 8's ballot clause goes red at tick 1441,
 *     `p:varrow voted INVERSE_EXPOSURE where its lowest previewed bill is BY_EXPOSURE`.
 *   - INV-24's max-share clause switched off: 6 goes red, and so does
 *     `test/invariants/aggregate.test.ts`'s case for the clause.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { largestRemainder } from '../../src/core/allocate.js';
import { Rng } from '../../src/core/rng.js';
import { reckoningIndex, setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { ConstellationId, PrincipalId, SystemId } from '../../src/core/types.js';
import { minor, type Minor } from '../../src/core/units.js';
import { checkInv24 } from '../../src/invariants/crowd.js';
import { compareIds } from '../../src/ledger/order.js';
import {
  allocate,
  Book,
  constellationOf,
  inv24InputsFor,
  LEVY_DUTY_PER_PRINCIPAL,
  LEVY_MAX_SHARE_MULTIPLE,
  LEVY_NOMINAL_MINOR,
  LEVY_RULES,
  LevyArithmeticError,
  maxShareOf,
  poolShares,
  previewShares,
  rollByConstellation,
  weightOf,
  type Allocation,
  type LevyRule,
  type LevySubject,
} from '../../src/levy/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { newcomer, subject } from './fixture.js';

const C = 'con-1' as ConstellationId;
const PLACE = 's:place' as SystemId;
const P = (name: string): PrincipalId => name as PrincipalId;

/**
 * The finding's shape: `g07` R6 had `p:varrow` at an EXPOSURE peak of 0 and five co-members exposed.
 * These five peaks are illustrative rather than the measured ones; the free share they produce,
 * 103,527 of 120,000 (5.18x the duty), is the measured 101,844's shape.
 */
function finding(): readonly LevySubject[] {
  return [
    subject('p:varrow', { exposurePeak: 0 }),
    subject('p:ashby', { exposurePeak: 20_000 }),
    subject('p:brisk', { exposurePeak: 25_000 }),
    subject('p:cole', { exposurePeak: 30_000 }),
    subject('p:dane', { exposurePeak: 40_000 }),
    subject('p:edda', { exposurePeak: 60_000 }),
  ];
}

function amountOf(lines: readonly Allocation[], principal: string): number {
  const line = lines.find((l) => l.principal === P(principal));
  if (line === undefined) throw new Error(`no line for ${principal}`);
  return Number(line.amount);
}

/** The rule whose bill is lowest for `me` — the cast's own choice, first in `LEVY_RULES` order on a tie. */
function cheapestBill(subjects: readonly LevySubject[], me: PrincipalId): LevyRule | null {
  let best: LevyRule | null = null;
  let bestShare = 0;
  for (const rule of LEVY_RULES) {
    const share = previewShares(rule, subjects).get(me);
    if (share === undefined) continue;
    if (best === null || share < bestShare) {
      best = rule;
      bestShare = share;
    }
  }
  return best;
}

/** The rule the old weight ratio picked: `weightOf(me) / Σ weightOf`, by cross multiplication. */
function cheapestRatio(subjects: readonly LevySubject[], me: PrincipalId): LevyRule | null {
  const mine = subjects.find((s) => s.principal === me);
  if (mine === undefined) return null;
  let best: LevyRule | null = null;
  let bestMine = 0;
  let bestTotal = 1;
  for (const rule of LEVY_RULES) {
    const myWeight = weightOf(rule, mine);
    const total = subjects.reduce<number>((n, s) => n + weightOf(rule, s), 0);
    if (best === null || myWeight * bestTotal < bestMine * total) {
      best = rule;
      bestMine = myWeight;
      bestTotal = total;
    }
  }
  return best;
}

describe('★ the max share — no member of a docket bears more than three even shares', () => {
  it('1. binds on the finding’s docket: one member at an EXPOSURE peak of 0, five exposed', () => {
    const subjects = finding();
    const weights = [...subjects]
      .sort((a, b) => compareIds(a.principal, b.principal))
      .map((s) => weightOf('INVERSE_EXPOSURE', s));
    const total = minor(LEVY_DUTY_PER_PRINCIPAL * subjects.length);
    const free = largestRemainder(total, weights);
    const freeVarrow = free[5] ?? 0; // `p:varrow` sorts last

    // The subject first: without the bound this docket is the finding — five duties and more.
    expect(freeVarrow, 'the free share of the zero-exposure member, the docket with no bound').toBe(103_527);
    expect(freeVarrow).toBeGreaterThan(5 * LEVY_DUTY_PER_PRINCIPAL);

    const bound = maxShareOf(total, subjects.length);
    expect(bound, 'nobody floored or spared: the even share is the duty, the bound three of them').toBe(
      LEVY_MAX_SHARE_MULTIPLE * LEVY_DUTY_PER_PRINCIPAL,
    );
    expect(bound).toBe(60_000);

    const out = allocate({ constellation: C, subjects, rule: 'INVERSE_EXPOSURE', spared: null, byDefault: true });
    expect(amountOf(out.lines, 'p:varrow'), 'held at the bound, not at its free share').toBe(60_000);
    for (const line of out.lines) {
      expect(line.amount, `${line.principal} is above the max share`).toBeLessThanOrEqual(bound);
    }
    expect(out.total, 'the total is fixed by rule and the bound does not move it').toBe(total);
    expect(out.lines.reduce((n, l) => n + l.amount, 0), 'Σ is the total, exactly (INV-24)').toBe(total);
    // The record keeps the rule's weight: the weight is what the rule said, the amount is the bill.
    expect(out.lines.find((l) => l.principal === P('p:varrow'))?.weight).toBe(1_000_000);
  });

  it('2. gives the excess to the others BY THE SAME RULE’S WEIGHTS — so the bill follows the weights', () => {
    const subjects = finding();
    const out = allocate({ constellation: C, subjects, rule: 'INVERSE_EXPOSURE', spared: null, byDefault: true });
    const others = out.lines.filter((l) => l.principal !== P('p:varrow'));

    // Exactly the remainder left after the held line, divided over the others by their own weights.
    const expected = largestRemainder(
      minor(LEVY_DUTY_PER_PRINCIPAL * subjects.length - 60_000),
      others.map((l) => l.weight),
    );
    expect(others.map((l) => Number(l.amount))).toEqual([...expected]);
    expect(others.map((l) => Number(l.amount))).toEqual([17_956, 14_502, 12_164, 9_197, 6_181]);

    // In weight order: the member the rule weighs most bears the most of the excess, and the bill of
    // the others is ordered exactly as their weights are.
    const byWeight = [...others].sort((a, b) => b.weight - a.weight);
    for (let i = 1; i < byWeight.length; i += 1) {
      const heavier = byWeight[i - 1];
      const lighter = byWeight[i];
      if (heavier === undefined || lighter === undefined) continue;
      expect(heavier.amount, `${heavier.principal} outweighs ${lighter.principal} and must bear more`).toBeGreaterThan(
        lighter.amount,
      );
    }
    // And each of them pays more than its free share: the excess is theirs now, in proportion.
    const free = largestRemainder(
      minor(LEVY_DUTY_PER_PRINCIPAL * subjects.length),
      out.lines.map((l) => l.weight),
    );
    for (const [i, line] of out.lines.entries()) {
      if (line.principal === P('p:varrow')) continue;
      expect(line.amount, `${line.principal} was not given any of the excess`).toBeGreaterThan(free[i] ?? 0);
    }
  });

  it('3. water-fills: a line pushed over the bound by another’s excess is held too', () => {
    // Nine in the pool, so the bound is 3 x 20,000. The second line starts UNDER it (48,980) and is
    // pushed over (102,128) only once the first is held — the case a single pass would miss.
    const weights = [1_000_000, 400_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000];
    const remainder = minor(180_000);
    const free = largestRemainder(remainder, weights);
    expect(free[0], 'the first line starts over the bound').toBeGreaterThan(60_000);
    expect(free[1], 'the second line starts UNDER the bound — the cascade is the subject').toBeLessThan(60_000);
    expect(largestRemainder(minor(120_000), weights.slice(1))[0], 'and is over it once the first is held').toBeGreaterThan(
      60_000,
    );

    const shares = poolShares(remainder, weights);
    expect(shares.slice(0, 2)).toEqual([60_000, 60_000]);
    expect(shares.slice(2)).toEqual([...largestRemainder(minor(60_000), weights.slice(2))]);
    expect(shares.reduce((n, s) => n + s, 0)).toBe(180_000);
  });

  it('4. leaves floored and spared lines alone — and a spared member raises the bound', () => {
    const subjects = [...finding(), newcomer('p:new')];
    const out = allocate({
      constellation: C,
      subjects,
      rule: 'INVERSE_EXPOSURE',
      spared: P('p:cole'),
      byDefault: false,
    });

    for (const name of ['p:new', 'p:cole']) {
      const line = out.lines.find((l) => l.principal === P(name));
      expect(line?.amount, `${name} is relieved and pays the nominal rate, bound or no bound`).toBe(LEVY_NOMINAL_MINOR);
      expect(line?.weight, `${name} is outside the remainder pool`).toBe(0);
    }
    expect(out.lines.find((l) => l.principal === P('p:new'))?.newcomerFloored).toBe(true);
    expect(out.lines.find((l) => l.principal === P('p:cole'))?.spared).toBe(true);

    // The total: five duties, the spared member's duty (its relief is funded by the pool), and the
    // newcomer's nominal rate. The remainder: that, less the two nominal lines.
    expect(out.total).toBe(6 * LEVY_DUTY_PER_PRINCIPAL + LEVY_NOMINAL_MINOR);
    const remainder = minor(out.total - 2 * LEVY_NOMINAL_MINOR);
    expect(remainder).toBe(119_500);
    const bound = maxShareOf(remainder, 5);
    expect(bound, '3 x ceil(119,500 / 5): the spare lifted the even share above the duty').toBe(71_700);
    expect(bound).toBeGreaterThan(LEVY_MAX_SHARE_MULTIPLE * LEVY_DUTY_PER_PRINCIPAL);

    const pool = out.lines.filter((l) => !l.newcomerFloored && !l.spared);
    const free = largestRemainder(remainder, pool.map((l) => l.weight));
    expect(free[pool.findIndex((l) => l.principal === P('p:varrow'))], 'the subject: over the bound').toBe(106_047);
    expect(amountOf(out.lines, 'p:varrow')).toBe(71_700);
    expect(pool.map((l) => Number(l.amount))).toEqual([...poolShares(remainder, pool.map((l) => l.weight))]);
    expect(out.lines.reduce((n, l) => n + l.amount, 0)).toBe(out.total);
  });

  it('5. a seeded sweep: exact, never above the bound, unchanged where nothing is over, quiet below four', () => {
    const rng = Rng.fromSeed('no-member-bears-the-docket');
    let held = 0;
    let untouched = 0;
    for (let trial = 0; trial < 2_000; trial += 1) {
      const size = rng.range(1, 14);
      const remainder = minor(rng.range(0, 400_000));
      // A heavy tail on purpose: the shape that binds is one weight dwarfing the rest.
      const weights = Array.from({ length: size }, () =>
        rng.chance(1, 5) ? rng.range(100_000, 1_000_000) : rng.range(1, 60_000),
      );
      const shares = poolShares(remainder, weights);
      const free = largestRemainder(remainder, weights);
      const bound = maxShareOf(remainder, size);
      const where = `trial ${String(trial)}: ${String(remainder)} over [${weights.join(', ')}]`;

      expect(shares.reduce((n, s) => n + s, 0), `${where} — Σ`).toBe(remainder);
      for (const share of shares) expect(share, `${where} — above the bound`).toBeLessThanOrEqual(bound);
      const heldHere = shares.filter((s, i) => s === bound && (free[i] ?? 0) > bound).length;
      expect(heldHere * LEVY_MAX_SHARE_MULTIPLE, `${where} — a third of the pool or more held`).toBeLessThan(size);
      if (Math.max(...free) <= bound) {
        expect([...shares], `${where} — nothing over, so nothing may move`).toEqual([...free]);
        untouched += 1;
      }
      if (size <= LEVY_MAX_SHARE_MULTIPLE) {
        expect([...shares], `${where} — a pool of three or fewer cannot bind`).toEqual([...free]);
      }
      held += heldHere;
    }
    // Non-vacuity of the sweep itself: both branches were exercised many times.
    expect(held, 'the sweep never held a line, so it proved nothing about the bound').toBeGreaterThan(100);
    expect(untouched, 'the sweep never left a docket alone').toBeGreaterThan(100);
  });

  it('6. INV-24 passes the docket allocate cuts, and halts the same docket cut without the bound', () => {
    const subjects = finding();
    const planOf = (lines: readonly Allocation[]): Book => {
      const book = new Book();
      book.assess({
        reckoning: 3,
        constellation: C,
        total: minor(LEVY_DUTY_PER_PRINCIPAL * subjects.length),
        rule: 'INVERSE_EXPOSURE',
        spared: null,
        byDefault: true,
        deliverableTo: PLACE,
        lines,
        assessedAtTick: 3 * TICKS_PER_RECKONING,
      });
      return book;
    };

    const cut = allocate({ constellation: C, subjects, rule: 'INVERSE_EXPOSURE', spared: null, byDefault: true });
    const fine = inv24InputsFor(planOf(cut.lines), 3);
    if (fine === null) throw new Error('no INV-24 inputs for an assessed Reckoning');
    expect(fine.maxShare.get(C), 'INV-24 is handed the bound the allocation used').toBe(60_000);
    expect(checkInv24(fine, 3 * TICKS_PER_RECKONING)).toEqual([]);

    // The same docket as the rule cut it before the bound existed: every line its free share. It
    // sums, so the only clause with anything to say is the max share.
    const free = largestRemainder(minor(LEVY_DUTY_PER_PRINCIPAL * subjects.length), cut.lines.map((l) => l.weight));
    const unbounded = cut.lines.map((line, i) => ({ ...line, amount: free[i] ?? minor(0) }));
    const inputs = inv24InputsFor(planOf(unbounded), 3);
    if (inputs === null) throw new Error('no INV-24 inputs for an assessed Reckoning');
    const violations = checkInv24(inputs, 3 * TICKS_PER_RECKONING);
    expect(violations.map((v) => v.id)).toEqual(['INV-24']);
    expect(violations[0]?.message).toContain('p:varrow is assessed 103527');
    expect(violations[0]?.message).toContain('above the max share of 60000');
  });

  it('7. ★ the preview the cast votes on IS the assessment, rule by rule — and it moves the vote', () => {
    const subjects = finding();
    for (const rule of LEVY_RULES) {
      const preview = previewShares(rule, subjects);
      const cut = allocate({ constellation: C, subjects, rule, spared: null, byDefault: false });
      for (const line of cut.lines) {
        expect(preview.get(line.principal), `${rule}: ${line.principal}'s preview is not its bill`).toBe(line.amount);
      }
    }

    // And a seeded sweep of veteran dockets, every rule: the preview is the bill, line for line.
    const rng = Rng.fromSeed('the-preview-is-the-bill');
    for (let trial = 0; trial < 200; trial += 1) {
      const roll = Array.from({ length: rng.range(1, 12) }, (_, i) =>
        subject(`p:m${String(i).padStart(2, '0')}`, {
          exposurePeak: rng.chance(1, 3) ? 0 : rng.range(0, 200_000),
          levyGoodHeld: rng.range(0, 300_000),
        }),
      );
      for (const rule of LEVY_RULES) {
        const preview = previewShares(rule, roll);
        const cut = allocate({ constellation: C, subjects: roll, rule, spared: null, byDefault: false });
        for (const line of cut.lines) {
          expect(preview.get(line.principal), `trial ${String(trial)} ${rule} ${line.principal}`).toBe(line.amount);
        }
      }
    }

    // ── WHY THE PREVIEW HAD TO CHANGE: THE BOUND MOVES A VOTE ─────────────────
    //
    // `p:ashby` is exposed, so the weight ratio sends it to the published default — under which its
    // ratio share is 4,930. But with `p:varrow` held at the bound, the excess is ashby's in proportion:
    // its bill under `INVERSE_EXPOSURE` is 17,956, and under `BY_EXPOSURE` it is 13,923. A cast
    // reading the ratio would vote for the docket that costs it more.
    expect(cheapestRatio(subjects, P('p:ashby')), 'the weight ratio, as the cast used to read it').toBe(
      'INVERSE_EXPOSURE',
    );
    expect(previewShares('INVERSE_EXPOSURE', subjects).get(P('p:ashby'))).toBe(17_956);
    expect(previewShares('BY_EXPOSURE', subjects).get(P('p:ashby'))).toBe(13_923);
    expect(cheapestBill(subjects, P('p:ashby')), 'the bill, read through the bound').toBe('BY_EXPOSURE');
  });

  it('7b. a docket allocate cannot cut, the preview cannot either — and says so with the class the cast catches', () => {
    // The cast's ballot catches exactly `LevyArithmeticError` from `previewShares` and skips that rule,
    // because the server's scheduler calls `decide` unguarded and the weight ratio it replaced never
    // threw. This pins the contract the catch relies on: the same docket, the same error class, both
    // roads. A remainder of 40,000 times a weight past 2.25e11 leaves safe-integer range.
    const subjects = [subject('p:huge', { exposurePeak: 1_000_000_000_000 }), subject('p:small')];
    expect(() =>
      allocate({ constellation: C, subjects, rule: 'BY_EXPOSURE', spared: null, byDefault: false }),
    ).toThrow(LevyArithmeticError);
    expect(() => previewShares('BY_EXPOSURE', subjects)).toThrow(LevyArithmeticError);
    // And the other rules, whose weights stay in range, still preview — so a ballot still has a choice.
    expect(previewShares('EVEN', subjects).get(P('p:huge'))).toBe(LEVY_DUTY_PER_PRINCIPAL);
  });
});

// ── 8. A REAL WORLD ──────────────────────────────────────────────────────────

interface Seen {
  /** Every pool line the bound held: `R<n> <principal> <amount>` beside the free share it replaced. */
  readonly held: readonly { reckoning: number; principal: PrincipalId; amount: number; free: number; bound: number }[];
  /** `levy.my_assessment` as the held member's own observation printed it, one tick after the docket. */
  readonly shown: ReadonlyMap<string, number>;
  /** Every LEVY ballot the cast cast, with the rules the bill and the old ratio would each have chosen. */
  readonly ballots: readonly { tick: number; principal: PrincipalId; rule: unknown; bill: LevyRule | null; ratio: LevyRule | null }[];
}

/**
 * `g08`, eight members, six Reckonings: the after-tree sweep put its first held line at R3 (`p:sable`,
 * free 104,059, held at 69,750 with one member spared) and its first ballot the bound moved at R5.
 * Both are properties of a trajectory, so the assertions below establish them before relying on them.
 */
function playG08(): Seen {
  setSpeed('instant');
  const seed = 'g08';
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: 8 });
  cast.seat(seed);

  const held: { reckoning: number; principal: PrincipalId; amount: number; free: number; bound: number }[] = [];
  const shown = new Map<string, number>();
  const ballots: { tick: number; principal: PrincipalId; rule: unknown; bill: LevyRule | null; ratio: LevyRule | null }[] = [];

  for (let i = 0; i < 6 * TICKS_PER_RECKONING; i += 1) {
    const next = runtime.engine.tick + 1;
    const actions = cast.decide(next, seed);
    for (const action of actions) {
      if (action.verb !== 'vote' || action.params['ballot'] !== 'LEVY') continue;
      const constellation = constellationOf(runtime.world, action.principal);
      if (constellation === null) continue;
      // The voter's own subjects at the tick it voted, read the way the cast reads them.
      const roll = [...(rollByConstellation(runtime.world).get(constellation) ?? [])].sort(compareIds);
      const subjects = roll.map((p) => runtime.levySubjectOf(p, next));
      ballots.push({
        tick: next,
        principal: action.principal,
        rule: action.params['rule'],
        bill: cheapestBill(subjects, action.principal),
        ratio: cheapestRatio(subjects, action.principal),
      });
    }
    for (const action of actions) runtime.engine.submit(action);
    const report = runtime.runTick();
    expect(
      report.halted,
      `g08 halted at ${String(report.tick)}: ${report.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`,
    ).toBe(false);

    // One tick after a docket is cut (phase 1), read every held line and what its member is shown.
    if (report.tick % TICKS_PER_RECKONING === 1) {
      const reckoning = reckoningIndex(report.tick);
      for (const plan of runtime.levy.plansIn(reckoning)) {
        const pool = plan.lines.filter((l) => !l.newcomerFloored && !l.spared);
        if (pool.length === 0) continue;
        const remainder = minor(pool.reduce((n, l) => n + l.amount, 0));
        const bound = maxShareOf(remainder, pool.length);
        const free = largestRemainder(remainder, pool.map((l) => l.weight));
        for (const [k, line] of pool.entries()) {
          if ((free[k] ?? 0) <= bound) continue;
          held.push({ reckoning, principal: line.principal, amount: line.amount, free: free[k] ?? 0, bound });
          shown.set(
            `${String(reckoning)}::${line.principal}`,
            Number(runtime.levyBlockFor(line.principal, report.tick)?.my_assessment ?? -1),
          );
        }
      }
    }
  }
  return { held, shown, ballots };
}

describe('★ 8. the max share in a real world — g08, eight members, six Reckonings', () => {
  let seen: Seen;
  beforeAll(() => {
    seen = playG08();
  }, 300_000);

  it('holds a real docket line at the bound, and the member is shown the bound as its bill', () => {
    expect(
      seen.held.length,
      'no docket line in six Reckonings of g08 had a free share above the max share, so nothing below ' +
        'is about the bound. The sweep that chose this fixture saw g08 R3; find out what moved.',
    ).toBeGreaterThan(0);
    for (const row of seen.held) {
      expect(row.amount, `R${String(row.reckoning)} ${row.principal}: free ${String(row.free)}`).toBe(row.bound);
      expect(row.free).toBeGreaterThan(row.bound);
      expect(
        seen.shown.get(`${String(row.reckoning)}::${row.principal}`),
        `R${String(row.reckoning)} ${row.principal}'s own observation must print the bill it was cut`,
      ).toBe(row.bound);
    }
  });

  it('casts every LEVY ballot for the rule whose BILL is lowest — and the bound moved at least one', () => {
    expect(seen.ballots.length, 'the cast cast no LEVY ballot in six Reckonings').toBeGreaterThan(0);
    for (const ballot of seen.ballots) {
      expect(
        ballot.rule,
        `tick ${String(ballot.tick)}: ${ballot.principal} voted ${String(ballot.rule)} where its lowest previewed ` +
          `bill is ${String(ballot.bill)} (the weight ratio said ${String(ballot.ratio)})`,
      ).toBe(ballot.bill);
    }
    // The mutation-killer: a ballot where the bill and the old ratio disagree. Without one, a cast
    // reading the ratio would pass the loop above.
    const moved = seen.ballots.filter((b) => b.bill !== b.ratio);
    expect(
      moved.length,
      'no ballot in six Reckonings of g08 was one the max share changed, so nothing here distinguishes a ' +
        'cast that reads the bill from one that reads the weight ratio',
    ).toBeGreaterThan(0);
  });

  it('never assesses a line above the bound — every docket the world cut', () => {
    // Redundant with INV-24 by design (the world would have halted above), and kept as the second road:
    // the bound here is restated from the plan's own lines, not handed over by the engine.
    for (const row of seen.held) expect(row.amount).toBeLessThanOrEqual(row.bound);
    const multiple = (n: Minor | number): number => Number(n) / LEVY_DUTY_PER_PRINCIPAL;
    for (const row of seen.held) {
      expect(multiple(row.amount), 'a held line is about three duties, not five or nine').toBeLessThan(4);
    }
  });
});
