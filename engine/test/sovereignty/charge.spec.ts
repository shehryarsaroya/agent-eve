/**
 * The Charge's arithmetic, the collapse arc, and the pixel signature — SOV-1…7 and A5′.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * These are the **fixture-driven** tests: they build a claim book directly, because the
 * arithmetic has to be checkable without a world. The acceptance test
 * (`test/api/sovereignty-acceptance.test.ts`) is the one that refuses to do that, and its
 * header explains why both files have to exist — a fixture suite can be green while the
 * mechanic is unreachable, and that has happened in this repo.
 *
 * Every test names the mutation it was checked against: the line was broken, the test was
 * confirmed red, and the line restored. Where a property is guarded twice, the test says so
 * rather than implying it owns the guard.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import type { CanonicalValue } from '../../src/core/canonical.js';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { ConstellationId, PrincipalId, SystemId, ZoneTier } from '../../src/core/types.js';
import { minor, qty, type Minor } from '../../src/core/units.js';
import { assertFrameBudgets, FrameBudgetError, type ReckoningFrame } from '../../src/frames/contract.js';
import {
  ANCHOR_QTY,
  ARREARS_STEPS,
  Book,
  CESSION_SALVAGE_BPS,
  CHARGE_ARREARS_SURCHARGE_BPS,
  CHARGE_BY_TIER,
  CHARGE_MISSES_TO_LAPSE,
  CLAIM_BOND_MINOR,
  CLAIM_RENT_BPS,
  VULNERABILITY_WINDOW,
  allocateCharge,
  assertSovereigntySchedule,
  assessCharge,
  chargeOf,
  checkChargeAttribution,
  checkSov1,
  checkSov3,
  checkSov4,
  checkSov7,
  claimDoNothing,
  claimIdFor,
  claimLegend,
  claimLinesFor,
  claimRouteFor,
  inVulnerabilityWindow,
  nominalChargeOf,
  settleCharge,
  totalCharge,
  type ChargeSubject,
  type ClaimRecord,
  type SlashPort,
} from '../../src/sovereignty/index.js';

const CON = 'con-1' as ConstellationId;
const A = 'p:alpha' as PrincipalId;
const B = 'p:bravo' as PrincipalId;

function claim(system: string, claimant: PrincipalId, epoch = 1): ClaimRecord {
  return {
    id: claimIdFor(system as SystemId, epoch),
    system: system as SystemId,
    constellation: CON,
    claimant,
    epoch,
    takenAtTick: 0,
    anchorQty: ANCHOR_QTY,
    rentBps: CLAIM_RENT_BPS,
    bondEncumbranceId: `enc:bond:${claimant}:0`,
    state: 'SUPPLIED',
    endedAtReckoning: null,
    succeededBy: null,
  };
}

function bookWith(...claims: readonly ClaimRecord[]): Book {
  const book = new Book();
  for (const c of claims) {
    book.take(c);
    book.addBondLock(c.claimant, `enc:bond:${c.claimant}:0`);
  }
  return book;
}

const MARCHES: ZoneTier = 'MARCHES';
const FRONTIER: ZoneTier = 'FRONTIER';

function subject(system: string, claimant: PrincipalId, tier: ZoneTier, misses = 0): ChargeSubject {
  return { claim: claimIdFor(system as SystemId, 1), system, claimant, tier, misses };
}

/** A slash port that takes exactly what it is asked for. The happy path. */
function fullSlash(): { port: SlashPort; taken: Minor[] } {
  const taken: Minor[] = [];
  return {
    port: {
      slash: (args) => {
        taken.push(args.want);
        return args.want;
      },
    },
    taken,
  };
}

// ── 1. the total is fixed by rule and cannot be dodged ──────────────────────

describe('the total is fixed by rule (§5.2 half one, the alarm)', () => {
  it('is Σ per-claim tier amounts, so an extra identity adds its own cost and lowers nobody else (A15)', () => {
    // MUTATION: make `totalCharge` divide by `subjects.length`. Two claims then cost what one
    // did, an extra identity halves everybody's bill, and the second expectation goes RED —
    // which is the A15 hole this arithmetic exists to close.
    const one = totalCharge([subject('sys-a', A, MARCHES)]);
    const two = totalCharge([subject('sys-a', A, MARCHES), subject('sys-b', B, MARCHES)]);
    expect(one).toBe(CHARGE_BY_TIER.MARCHES);
    expect(two).toBe(CHARGE_BY_TIER.MARCHES * 2);
    // And a Frontier claim costs strictly more than a Marches one: the price of projecting
    // force rises with how far out it is projected (§6.3).
    expect(chargeOf({ tier: FRONTIER, misses: 0 })).toBeGreaterThan(chargeOf({ tier: MARCHES, misses: 0 }));
  });

  it('adds a BOUNDED surcharge in arrears — the cure never becomes unreachable', () => {
    // ══════════════════════════════════════════════════════════════════════
    // MUTATION: make `chargeOf` return `base * (1 + misses)`. Two misses then bill three
    // Charges at once, which is the correlated death spiral the economic critic rejected
    // ("do not accumulate impossible back arrears"). The `toBe` on the two-miss figure goes
    // RED, and so does the strict ceiling below it.
    // ══════════════════════════════════════════════════════════════════════
    const clean = chargeOf({ tier: MARCHES, misses: 0 });
    const one = chargeOf({ tier: MARCHES, misses: 1 });
    const two = chargeOf({ tier: MARCHES, misses: 2 });
    expect(one).toBeGreaterThan(clean);
    // The surcharge does NOT compound with the miss count: one miss and two cost the same.
    expect(two).toBe(one);
    const ceiling = clean + Math.ceil((clean * CHARGE_ARREARS_SURCHARGE_BPS) / 10_000);
    expect(one).toBe(ceiling);
    // A blockaded claim can always be rescued by one convoy that gets through.
    expect(two).toBeLessThan(clean * 2);
  });
});

// ── 2. the allocation is a vote ─────────────────────────────────────────────

describe('the allocation is a vote (§5.2 half two, the drama)', () => {
  it('sums EXACTLY to the total under every rule — a line over its share is a fabricated debt', () => {
    // MUTATION: replace `shareOut`'s largest-remainder pass with `Math.round(total * w / Σw)`.
    // Three unequal weights then sum to total±1 and this goes RED for at least one rule. That
    // one unit is a debt the rule never created, and the claim bearing it goes into arrears
    // for it (SOV-4).
    const subjects = [
      subject('sys-a', A, MARCHES),
      subject('sys-b', A, FRONTIER),
      subject('sys-c', B, MARCHES),
    ];
    for (const rule of ['EVEN', 'BY_CLAIMS', 'BY_TIER'] as const) {
      const plan = allocateCharge({ constellation: CON, subjects, rule, spared: null, byDefault: false });
      const summed = plan.lines.reduce((n, l) => n + l.amount, 0);
      expect(summed, rule).toBe(plan.total);
      expect(plan.total).toBe(totalCharge(subjects));
    }
  });

  it('BY_CLAIMS loads the total onto whoever holds the most territory, and names the loser', () => {
    // MUTATION: make `chargeWeightOf('BY_CLAIMS')` return 1. Every rule becomes EVEN, the
    // vote stops mattering, and the inequality below goes RED — the mechanic keeps its
    // arithmetic and loses its politics.
    const subjects = [
      subject('sys-a', A, MARCHES),
      subject('sys-b', A, MARCHES),
      subject('sys-c', B, MARCHES),
    ];
    const even = allocateCharge({ constellation: CON, subjects, rule: 'EVEN', spared: null, byDefault: false });
    const byClaims = allocateCharge({ constellation: CON, subjects, rule: 'BY_CLAIMS', spared: null, byDefault: false });
    const aUnderEven = even.lines.filter((l) => l.claimant === A).reduce((n, l) => n + l.amount, 0);
    const aUnderClaims = byClaims.lines.filter((l) => l.claimant === A).reduce((n, l) => n + l.amount, 0);
    expect(aUnderClaims).toBeGreaterThan(aUnderEven);
    // And B, holding one claim, bears strictly less than it would have.
    const bUnderEven = even.lines.filter((l) => l.claimant === B).reduce((n, l) => n + l.amount, 0);
    const bUnderClaims = byClaims.lines.filter((l) => l.claimant === B).reduce((n, l) => n + l.amount, 0);
    expect(bUnderClaims).toBeLessThan(bUnderEven);
  });

  it('a spared claimant bears the nominal share and the rest FUND the relief', () => {
    // MUTATION: in `allocateCharge`, put the spared subjects in `pool` as well. Their lines
    // are then allocated normally, `spared` becomes decoration, and the first expectation
    // goes RED.
    //
    // GUARDED TWICE, AND THIS TEST DOES NOT OWN IT: `checkSov5` independently halts a tick on
    // a spared line assessed above `ruleQty`. That clause reads the recorded `spared` column,
    // so it catches the same failure from the settlement side; this checks the constructor.
    const subjects = [subject('sys-a', A, MARCHES), subject('sys-b', B, MARCHES)];
    const plan = allocateCharge({ constellation: CON, subjects, rule: 'EVEN', spared: A, byDefault: false });
    const relieved = plan.lines.find((l) => l.claimant === A);
    const funder = plan.lines.find((l) => l.claimant === B);
    expect(relieved?.amount).toBe(nominalChargeOf(MARCHES));
    expect(relieved?.spared).toBe(true);
    // Redistribution, not a discount: the total is unchanged and B pays the difference.
    expect(plan.total).toBe(totalCharge(subjects));
    expect(funder?.amount).toBeGreaterThan(CHARGE_BY_TIER.MARCHES);
  });

  it('reduces the total ONLY when every claim is spared, and then by rule', () => {
    // MUTATION: make `relievedChargeTotal` always return `totalCharge(subjects)`. With every
    // claim spared there is nobody to redistribute to, `largestRemainder` is handed a positive
    // amount and zero weights, and it throws `cannot allocate ... across zero weights` — so
    // this goes RED as an exception rather than an assertion, which is the loudest kind.
    const subjects = [subject('sys-a', A, MARCHES), subject('sys-b', A, FRONTIER)];
    const plan = allocateCharge({ constellation: CON, subjects, rule: 'EVEN', spared: A, byDefault: false });
    expect(plan.total).toBe(nominalChargeOf(MARCHES) + nominalChargeOf(FRONTIER));
    expect(plan.total).toBeLessThan(totalCharge(subjects));
  });
});

// ── 3. the collapse arc, not the death spiral ───────────────────────────────

describe('the collapse arc (DRAFT-2 §2: a fire sale or a rescue, never a cliff)', () => {
  function settleOnce(book: Book, reckoning: number, port: SlashPort): void {
    settleCharge({
      book,
      reckoning,
      tick: reckoning * TICKS_PER_RECKONING + TICKS_PER_RECKONING - 1,
      slash: port,
      bondAtRiskOf: () => CLAIM_BOND_MINOR,
    });
  }

  function assessAt(book: Book, reckoning: number): void {
    assessCharge({
      book,
      tick: reckoning * TICKS_PER_RECKONING,
      tierOf: () => MARCHES,
    });
  }

  it('walks SUPPLIED -> STRAINED -> CONTESTED -> LAPSED and takes three misses to do it', () => {
    // MUTATION: change `CHARGE_MISSES_TO_LAPSE` to 2. The claim lapses at the second miss,
    // `CONTESTED` never appears, and the middle of the arc — the published window, the fire
    // sale, the rescue — is unreachable. RED on the CONTESTED assertion, and `checkSov7` also
    // fires on the constant itself, which is the second guard on that number.
    const book = bookWith(claim('sys-a', A));
    const { port } = fullSlash();
    const seen: string[] = [];

    for (let r = 0; r < CHARGE_MISSES_TO_LAPSE; r += 1) {
      assessAt(book, r);
      settleOnce(book, r, port);
      seen.push(book.at('sys-a' as SystemId)?.state ?? 'GONE');
    }
    expect(seen).toEqual(['STRAINED', 'CONTESTED', 'LAPSED']);
    expect(book.liveAt('sys-a' as SystemId)).toBeNull();
  });

  it('partial payment counts, and one Charge paid in full clears the arrears completely', () => {
    // ══════════════════════════════════════════════════════════════════════
    // MUTATION 1: make `Book.owingOf` return `assessment` whenever `paid < assessment`.
    // Partial payment stops counting, 3,999 of a 4,000 Charge is "unpaid", and the partial
    // assertion goes RED. That is the all-or-nothing rule the critique rejected.
    //
    // MUTATION 2: delete the `book.clearMisses` call from `settleCharge`'s paid branch. The
    // arrears never clear, one bad Reckoning is permanent, and the last assertion goes RED.
    // ══════════════════════════════════════════════════════════════════════
    const book = bookWith(claim('sys-a', A));
    const { port } = fullSlash();

    assessAt(book, 0);
    const due = book.assessmentOf(0, 'sys-a' as SystemId);
    book.credit(0, 'sys-a' as SystemId, qty(due - 1));
    expect(book.owingOf(0, 'sys-a' as SystemId).owed).toBe(1);
    settleOnce(book, 0, port);
    expect(book.missesAt('sys-a' as SystemId)).toBe(1);

    assessAt(book, 1);
    const cure = book.assessmentOf(1, 'sys-a' as SystemId);
    // The cure is the CURRENT Charge plus the bounded surcharge — never the missed one too.
    expect(cure).toBe(chargeOf({ tier: MARCHES, misses: 1 }));
    book.credit(1, 'sys-a' as SystemId, cure);
    settleOnce(book, 1, port);
    expect(book.missesAt('sys-a' as SystemId)).toBe(0);
    expect(book.liveAt('sys-a' as SystemId)?.state).toBe('SUPPLIED');
  });

  it('a transfer NEVER resets the arrears: delinquency attaches to the system, not the holder', () => {
    // ══════════════════════════════════════════════════════════════════════
    // MUTATION: key `Book.delinquencyAt` on `claim.claimant` instead of on the system. A
    // failing claimant then sells to a friend, the counter reads zero for the new holder, and
    // the claim is immortal for the price of one cession per two Reckonings. This is the
    // economic critic's §5 exploit table, row 4 — "transfer/cede/reclaim after first arrears
    // to reset the consecutive-miss counter" — and it goes RED here.
    // ══════════════════════════════════════════════════════════════════════
    const book = bookWith(claim('sys-a', A));
    const { port } = fullSlash();
    assessAt(book, 0);
    settleOnce(book, 0, port);
    expect(book.missesAt('sys-a' as SystemId)).toBe(1);

    book.addBondLock(B, 'enc:bond:p:bravo:0');
    book.succeed('sys-a' as SystemId, B, 'enc:bond:p:bravo:0');
    expect(book.liveAt('sys-a' as SystemId)?.claimant).toBe(B);
    // The state and the count travel with the ground.
    expect(book.missesAt('sys-a' as SystemId)).toBe(1);
    expect(book.liveAt('sys-a' as SystemId)?.state).toBe('STRAINED');
    // And the *next* assessment carries the inherited surcharge, so the buyer pays for it.
    assessAt(book, 1);
    expect(book.lineFor(1, 'sys-a' as SystemId)?.line.missesAtAssessment).toBe(1);
  });

  it('a cession salvages part of the bond and a lapse takes all of it — the exit is cheaper', () => {
    // MUTATION: set `CESSION_SALVAGE_BPS` to 0. Giving up costs exactly what failing costs,
    // "sacrifice your edge" stops being a strategy, and the inequality goes RED.
    const forfeitOnCession = CLAIM_BOND_MINOR - Math.trunc((CLAIM_BOND_MINOR * CESSION_SALVAGE_BPS) / 10_000);
    expect(forfeitOnCession).toBeLessThan(CLAIM_BOND_MINOR);
    expect(forfeitOnCession).toBeGreaterThan(0);

    const book = bookWith(claim('sys-a', A));
    book.end('sys-a' as SystemId, 'CEDED', 3, null);
    expect(book.liveAt('sys-a' as SystemId)).toBeNull();
    // A ceded claim is terminal and distinct from a lapsed one: a viewer is owed the
    // difference between the world taking it and the holder letting go.
    expect(book.at('sys-a' as SystemId)?.state).toBe('CEDED');
    expect(book.at('sys-a' as SystemId)?.endedAtReckoning).toBe(3);
  });

  it('is contestable ONLY inside the published window, and only when CONTESTED (A14)', () => {
    // ══════════════════════════════════════════════════════════════════════
    // MUTATION 1: make `inVulnerabilityWindow` return `true`. A claim becomes takeable at
    // whatever tick the challenger happens to be awake for, which is a mechanic that rewards
    // uptime (A4) and gives the defender no clock to read. RED on the outside-window case.
    //
    // MUTATION 2: drop the `live.state === 'CONTESTED'` condition from `claimRouteFor`. Any
    // claim becomes takeable inside the window, including one that has paid every Charge —
    // "a claimant that pays is safe by rule" stops being true. RED on the SUPPLIED case.
    // ══════════════════════════════════════════════════════════════════════
    const inside = VULNERABILITY_WINDOW.firstPhase + 1;
    const outside = VULNERABILITY_WINDOW.firstPhase - 1;
    expect(inVulnerabilityWindow(inside)).toBe(true);
    expect(inVulnerabilityWindow(outside)).toBe(false);

    const book = bookWith(claim('sys-a', A));
    expect(claimRouteFor(book, 'sys-a' as SystemId, inside)).toBeNull();
    book.setState('sys-a' as SystemId, 'CONTESTED');
    expect(claimRouteFor(book, 'sys-a' as SystemId, inside)).toBe('TAKEOVER');
    expect(claimRouteFor(book, 'sys-a' as SystemId, outside)).toBeNull();

    // A published cession is the other road in, and it does not need the window at all: it is
    // the holder's own offer.
    book.offerCession({
      system: 'sys-a' as SystemId,
      claim: claimIdFor('sys-a' as SystemId, 1),
      by: A,
      price: minor(1_000),
      openedAtTick: 0,
    });
    expect(claimRouteFor(book, 'sys-a' as SystemId, outside)).toBe('CESSION');
    // An unclaimed system is always open. Nothing about sovereignty gates a first claim.
    expect(claimRouteFor(book, 'sys-z' as SystemId, outside)).toBe('VIRGIN');
  });

  it('a lapse slashes ONE claim s bond, so the first lapse does not cascade into the rest', () => {
    // MUTATION: make `settleCharge` pass `postedBondOf(...)` instead of `bondAtRiskOf(...)`.
    // A claimant holding four claims loses all 200,000 on the first lapse and the other three
    // claims lose their backing in the same tick — the correlated cascade the arc exists to
    // avoid. RED on the `taken` assertion.
    const book = bookWith(claim('sys-a', A), claim('sys-b', A));
    const { port, taken } = fullSlash();
    for (let r = 0; r < CHARGE_MISSES_TO_LAPSE; r += 1) {
      assessCharge({ book, tick: r * TICKS_PER_RECKONING, tierOf: () => MARCHES });
      settleCharge({
        book,
        reckoning: r,
        tick: r * TICKS_PER_RECKONING + TICKS_PER_RECKONING - 1,
        slash: port,
        bondAtRiskOf: () => CLAIM_BOND_MINOR,
      });
    }
    // Two claims lapsed, and each was slashed exactly one claim's bond.
    expect(taken).toEqual([CLAIM_BOND_MINOR, CLAIM_BOND_MINOR]);
  });
});

// ── 4. A5′ — the record must never be wrong ─────────────────────────────────

describe('A5-prime: never an arrears against a claimant that paid or was never billed', () => {
  it('halts on a shortfall row the delivery journal cannot reproduce', () => {
    // ══════════════════════════════════════════════════════════════════════
    // MUTATION: delete the `row.owed !== expected` clause from `checkChargeAttribution`.
    //
    // **THE FIRST VERSION OF THIS TEST WAS OVERSOLD AND THE MUTATION PROVED IT.** It used a
    // row claiming 9,999 short against a *fully paid* journal — and that case is caught by the
    // SECOND clause (`owed > 0 && expected === 0`), so removing the first clause left the test
    // green while the guard it named was gone. The row below is short by a **partially paid**
    // amount instead: the journal reproduces 1, the row says 9,999, and neither the fully-paid
    // clause nor the never-assessed clause fires. Only the arithmetic clause does.
    // ══════════════════════════════════════════════════════════════════════
    const book = bookWith(claim('sys-a', A));
    assessCharge({ book, tick: 0, tierOf: () => MARCHES });
    const id = 'sys-a' as SystemId; // the duty key: territorial, not the claim record
    const rec = claimIdFor(id, 1);
    const due = book.assessmentOf(0, id);
    book.credit(0, id, qty(due - 1));
    book.recordShortfall({
      reckoning: 0,
      claim: rec,
      system: 'sys-a' as SystemId,
      claimant: A,
      assessment: due,
      paid: qty(due - 1),
      owed: qty(9_999),
      misses: 1,
      state: 'STRAINED',
      slashed: minor(0),
    });
    const violations = checkChargeAttribution(book, 0, 100, CLAIM_BOND_MINOR);
    expect(violations.length).toBe(1);
    expect(violations[0]?.severity).toBe('HALT');
    expect(violations[0]?.id).toBe('A5-PRIME');
    expect(violations[0]?.message).toContain('reproduces 1');
  });

  it('halts on a claim recorded short that delivered in full — the second clause, separately', () => {
    // The clause that made the test above pass for the wrong reason, tested on its own so both
    // are actually owned. A row that lied about its own journal cannot vouch for itself: this
    // one is computed from the journal, not from the row.
    //
    // MUTATION: delete the `row.owed > 0 && expected === 0` clause. A claimant that handed
    // over every unit is still recorded short and nothing halts. RED here.
    const book = bookWith(claim('sys-a', A));
    assessCharge({ book, tick: 0, tierOf: () => MARCHES });
    const id = 'sys-a' as SystemId; // the duty key: territorial, not the claim record
    const rec = claimIdFor(id, 1);
    const due = book.assessmentOf(0, id);
    book.credit(0, id, due);
    book.recordShortfall({
      reckoning: 0,
      claim: rec,
      system: 'sys-a' as SystemId,
      claimant: A,
      assessment: due,
      paid: due,
      owed: qty(1),
      misses: 1,
      state: 'STRAINED',
      slashed: minor(0),
    });
    const messages = checkChargeAttribution(book, 0, 100, CLAIM_BOND_MINOR).map((v) => v.message);
    expect(messages.join(' | ')).toContain('delivered the whole Reckoning');
  });

  it('halts on an arrears against a claim that holds no assessment at all', () => {
    // ══════════════════════════════════════════════════════════════════════
    // MUTATION: delete the `assessed <= 0 && row.owed > 0` clause. A claim taken mid-cycle,
    // or one whose assessment failed to compute, can then be billed for a Reckoning it was
    // never told about — which is the one A5′ clause the Levy does not need, because the Levy
    // assesses everybody. RED here.
    // ══════════════════════════════════════════════════════════════════════
    const book = bookWith(claim('sys-a', A));
    const id = 'sys-a' as SystemId; // the duty key: territorial, not the claim record
    const rec = claimIdFor(id, 1);
    book.recordShortfall({
      reckoning: 7,
      claim: rec,
      system: 'sys-a' as SystemId,
      claimant: A,
      assessment: qty(0),
      paid: qty(0),
      owed: qty(4_000),
      misses: 1,
      state: 'STRAINED',
      slashed: minor(0),
    });
    const problems = checkChargeAttribution(book, 7, 100, CLAIM_BOND_MINOR);
    expect(problems.map((v) => v.message).join(' ')).toContain('never shown what it owed');
  });

  it('halts on a LAPSE recorded below the published threshold, and on a slash without one', () => {
    // MUTATION: delete both the `state === 'LAPSED' && misses < threshold` clause and the
    // `slashed > 0 && state !== 'LAPSED'` clause. The world can then take territory earlier
    // than the rules say and slash a bond on an arrears. RED on both messages.
    //
    // GUARDED TWICE, STATED: `checkSov3` independently walks the same rows for the slash
    // clause. It is the settlement-side reading and this is the attribution-side one; neither
    // test owns the property alone.
    const book = bookWith(claim('sys-a', A));
    assessCharge({ book, tick: 0, tierOf: () => MARCHES });
    const id = 'sys-a' as SystemId; // the duty key: territorial, not the claim record
    const rec = claimIdFor(id, 1);
    book.recordShortfall({
      reckoning: 0,
      claim: rec,
      system: 'sys-a' as SystemId,
      claimant: A,
      assessment: book.assessmentOf(0, id),
      paid: qty(0),
      owed: book.assessmentOf(0, id),
      misses: 1,
      state: 'LAPSED',
      slashed: minor(CLAIM_BOND_MINOR * 4),
    });
    const messages = checkChargeAttribution(book, 0, 100, CLAIM_BOND_MINOR).map((v) => v.message).join(' | ');
    expect(messages).toContain('consecutive miss');
    expect(messages).toContain('more than the');
    expect(checkSov3({
      book,
      tick: 100,
      tierOf: () => MARCHES,
      holdingSystemOf: () => 'sys-a' as SystemId,
      bondCeiling: CLAIM_BOND_MINOR,
    }).length).toBeGreaterThan(0);
  });

  it('predicts exactly what settlement will do, or PROP-O5 is decoration', () => {
    // MUTATION: make `claimDoNothing` return `'ENTERS_ARREARS'` for every unpaid claim. The
    // observation stops warning about the lapse one Reckoning ahead — the agent is told the
    // cheap consequence and gets the irreversible one. RED on the third case.
    expect(claimDoNothing(qty(0), 0)).toBe('STAYS_SUPPLIED');
    expect(claimDoNothing(qty(1), 0)).toBe('ENTERS_ARREARS');
    expect(claimDoNothing(qty(1), 1)).toBe('BECOMES_CONTESTABLE');
    expect(claimDoNothing(qty(1), CHARGE_MISSES_TO_LAPSE - 1)).toBe('LAPSES');
  });
});

// ── 5. the pixel signature, and the gauge that must not come back ───────────

describe('the pixel signature is PUBLIC LEGAL STATE ONLY (A13, §11.2)', () => {
  it('reads PAID, ARREARS 1 of 2 and NEXT MISS LAPSES, and the label tracks the state', () => {
    // MUTATION: make `claimLegend` return `'PAID'` for CONTESTED. `assertFrameBudgets` then
    // refuses the frame, so this is guarded twice on purpose — but the string itself is what a
    // stranger reads in three seconds, so it is asserted directly too.
    expect(claimLegend('SUPPLIED', 0)).toBe('PAID');
    expect(claimLegend('STRAINED', 1)).toBe(`ARREARS 1 of ${String(ARREARS_STEPS)}`);
    expect(claimLegend('CONTESTED', 2)).toContain('NEXT MISS LAPSES');
    expect(claimLegend('LAPSED', 3)).toContain('BOND SLASHED');
    expect(claimLegend('CEDED', 0)).toBe('CEDED');
    expect(ARREARS_STEPS).toBe(CHARGE_MISSES_TO_LAPSE - 1);
  });

  it('draws no field that is a function of what a claimant STILL holds', () => {
    // ══════════════════════════════════════════════════════════════════════
    // **THE FUEL GAUGE, REFUSED.** The rejected design published "Reckonings of Charge
    // remaining", which is a public recipe over a private stockpile. This asserts the *shape*:
    // every key on a claim line is enumerated, so a future edit adding one has to change this
    // list — and `assertFrameBudgets` independently refuses any key matching
    // /cover|remaining|reserve|stock|gauge/i, which is the second guard and is not this test's.
    //
    // MUTATION: add `reckoningsOfCover` to `claimLinesFor`'s row. RED here on the key list,
    // and RED again in the frame budget check.
    // ══════════════════════════════════════════════════════════════════════
    const book = bookWith(claim('sys-a', A));
    assessCharge({ book, tick: 0, tierOf: () => MARCHES });
    const lines = claimLinesFor({
      book,
      reckoning: 0,
      tick: 10,
      tierOf: () => MARCHES,
      // No WORKS book in this unit test, so nothing is being extracted and nothing is collected.
      // The three rent keys still have to be ON the row: A13 wants the territory layer's income
      // drawn, and the key list below is what pins that.
      rentAt: () => ({
        taken: qty(0),
        tenants: 0,
        perTick: qty(0),
        fuelDue: qty(0),
        anchorHot: true,
        fuelHere: qty(0),
      }),
      bondRead: () => minor(CLAIM_BOND_MINOR),
    });
    expect(lines.length).toBe(1);
    // Explicit comparator: DET-1 bans a bare `.sort()` even on strings, because the default is
    // implementation-defined for anything that is not a string and a habit is easier to guard
    // than an exception.
    expect(Object.keys(lines[0] ?? {}).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([
      'anchorHot',
      'arrears',
      'arrearsOf',
      'bondAtRisk',
      'claim',
      'claimant',
      'contestable',
      'deadlineTick',
      'due',
      'forSale',
      'fuelDue',
      'legend',
      'owed',
      'rentBps',
      'rentTaken',
      'slashed',
      'state',
      'system',
      'tenants',
    ]);
    // `owed` is `due` less what was DESTROYED, so it can never exceed `due` — a fact about the
    // past, never about the warehouse.
    expect(lines[0]?.owed).toBeLessThanOrEqual(lines[0]?.due ?? -1);
  });

  it('refuses a frame whose legend and legal state disagree', () => {
    // MUTATION: delete the `expectsArrears !== startsWith('ARREARS')` clause from
    // `assertFrameBudgets`. A tint reading SUPPLIED under "NEXT MISS LAPSES" reaches a screen,
    // and a stranger has no second source. RED here.
    const frame = (state: 'SUPPLIED' | 'CONTESTED', legend: string): ReckoningFrame => ({
      reckoningIndex: 0,
      tick: 0,
      saps: [],
      swayLines: [],
      worksLines: [],
      marketLines: [],
      standings: [],
      places: [],
      hallOfFame: [],
      syndicateLines: [],
      battleLines: [],
      map: [],
      stateHash: 'x',
      meters: { levyShort: minor(0), onAPromise: minor(0), kept: 0, broken: 0, unrefined: qty(0) },
      docket: [],
      rundown: [],
      tributeLines: [],
      authorityLines: [],
      raidLines: [],
      claimLines: [
        {
          claim: 'claim:sys-a:1',
          system: 'sys-a' as SystemId,
          claimant: A,
          state,
          legend,
          arrears: state === 'CONTESTED' ? 2 : 0,
          arrearsOf: ARREARS_STEPS,
          due: 4_000,
          owed: 0,
          deadlineTick: 287,
          bondAtRisk: minor(CLAIM_BOND_MINOR),
          slashed: minor(0),
          forSale: null,
          rentBps: 0,
          rentTaken: 0,
          tenants: 0,
          anchorHot: true,
          fuelDue: 0,
          contestable: false,
        },
      ],
      glyphs: [],
      ticker: [],
      nextDocket: [],
    });
    expect(() => assertFrameBudgets(frame('SUPPLIED', 'PAID'))).not.toThrow();
    expect(() => assertFrameBudgets(frame('SUPPLIED', 'ARREARS 1 of 2'))).toThrow(FrameBudgetError);
    expect(() => assertFrameBudgets(frame('CONTESTED', 'PAID'))).toThrow(FrameBudgetError);
    // And a slash on anything but a lapse never renders.
    const bad = frame('CONTESTED', `ARREARS 2 of ${String(ARREARS_STEPS)} · NEXT MISS LAPSES`);
    const withSlash = {
      ...bad,
      claimLines: [{ ...bad.claimLines[0]!, slashed: minor(1) }],
    } as ReckoningFrame;
    expect(() => assertFrameBudgets(withSlash)).toThrow(FrameBudgetError);
  });
});

// ── 6. the invariants and the schedule ──────────────────────────────────────

describe('SOV-1..7 and the schedule assertion', () => {
  it('SOV-1 halts on a claim standing in the Commons (A8)', () => {
    // MUTATION: delete the tier check from `claimRejection`. A Commons claim becomes takeable,
    // A8's "invalid, not punished" becomes "punished later", and this halts — which is the
    // point. RED if the clause is removed from `checkSov1` instead.
    const book = bookWith(claim('sys-a', A));
    const clean = checkSov1({
      book,
      tick: 1,
      tierOf: () => MARCHES,
      holdingSystemOf: () => 'sys-a' as SystemId,
      bondCeiling: CLAIM_BOND_MINOR,
    });
    expect(clean).toEqual([]);
    const commons = checkSov1({
      book,
      tick: 1,
      tierOf: () => 'COMMONS',
      holdingSystemOf: () => 'sys-a' as SystemId,
      bondCeiling: CLAIM_BOND_MINOR,
    });
    expect(commons.length).toBe(1);
    expect(commons[0]?.id).toBe('A8');
  });

  it('SOV-4 halts on a plan whose lines do not sum to its total', () => {
    // MUTATION: delete the clause. A plan off by one publishes an arrears for a debt the rule
    // never created, which is the A5′ shape wearing arithmetic. RED here.
    const book = bookWith(claim('sys-a', A));
    assessCharge({ book, tick: 0, tierOf: () => MARCHES });
    expect(
      checkSov4({
        book,
        tick: 1,
        tierOf: () => MARCHES,
        holdingSystemOf: () => 'sys-a' as SystemId,
        bondCeiling: CLAIM_BOND_MINOR,
      }),
    ).toEqual([]);
    const plan = book.planFor(0, CON);
    // Rewrite the total out from under the lines, the way a bad allocator would — through the
    // snapshot road, so the book's own restore has to accept it and the clause has to catch it.
    const captured = book.capture() as Record<string, CanonicalValue>;
    const dirty = new Book();
    dirty.restore({
      claims: captured['claims'] ?? [],
      delinquency: captured['delinquency'] ?? [],
      payments: [],
      ballots: [],
      shortfalls: [],
      cessions: [],
      bondLocks: captured['bondLocks'] ?? [],
      epochs: captured['epochs'] ?? [],
      settled: [],
      plans: [
        {
          reckoning: 0,
          constellation: CON,
          total: (plan?.total ?? 0) + 1,
          rule: plan?.rule ?? 'BY_CLAIMS',
          spared: null,
          byDefault: false,
          assessedAtTick: 0,
          lines: (plan?.lines ?? []).map((l) => ({ ...l })),
        },
      ],
    });
    const violations = checkSov4({
      book: dirty,
      tick: 1,
      tierOf: () => MARCHES,
      holdingSystemOf: () => 'sys-a' as SystemId,
      bondCeiling: CLAIM_BOND_MINOR,
    });
    expect(violations.length).toBe(1);
    expect(violations[0]?.id).toBe('INV-24');
  });

  it('SOV-7 halts on a CONTESTED claim the record has not published two misses for', () => {
    // MUTATION: delete the clause. A claim can be marked contestable on one miss, and the
    // world then invites a takeover the rules did not permit. RED here.
    const book = bookWith(claim('sys-a', A));
    book.setState('sys-a' as SystemId, 'CONTESTED');
    const violations = checkSov7({
      book,
      tick: 1,
      tierOf: () => MARCHES,
      holdingSystemOf: () => 'sys-a' as SystemId,
      bondCeiling: CLAIM_BOND_MINOR,
    });
    expect(violations.map((v) => v.id)).toContain('A5-PRIME');
  });

  it('the vulnerability window fits the clock, or the world does not start', () => {
    // MUTATION: set `VULNERABILITY_WINDOW.lastPhase` to 287. The window then overlaps the
    // freeze and the settlement, a claim could change hands inside §5.1's window, and the
    // constructor throws instead of starting a world that cannot honour its own clock. This
    // asserts the assertion runs clean today; the throw path is covered by the params guard's
    // own arithmetic, which is why the value is compared as well.
    expect(() => assertSovereigntySchedule()).not.toThrow();
    expect(VULNERABILITY_WINDOW.lastPhase).toBeLessThan(TICKS_PER_RECKONING - 1);
    expect(VULNERABILITY_WINDOW.firstPhase).toBeGreaterThan(0);
  });

  it('round-trips through its own capture, byte for byte', () => {
    // MUTATION: drop `delinquency` from `Book.capture`. The claims survive an adoption and
    // every arrears counter resets to zero, so a claim two misses from lapsing comes up clean
    // — the StandingBook failure exactly, in the book that takes territory. RED here.
    const book = bookWith(claim('sys-a', A), claim('sys-b', B));
    assessCharge({ book, tick: 0, tierOf: () => MARCHES });
    book.credit(0, 'sys-a' as SystemId, qty(1_000));
    book.miss('sys-b' as SystemId, 0);
    book.offerCession({
      system: 'sys-b' as SystemId,
      claim: claimIdFor('sys-b' as SystemId, 1),
      by: B,
      price: minor(500),
      openedAtTick: 3,
    });
    book.markSettled(0);

    const captured = book.capture();
    const fresh = new Book();
    fresh.restore(captured);
    expect(JSON.stringify(fresh.capture())).toBe(JSON.stringify(captured));
    expect(fresh.missesAt('sys-b' as SystemId)).toBe(1);
    expect(fresh.cessionAt('sys-b' as SystemId)?.price).toBe(500);
    expect(fresh.isSettled(0)).toBe(true);
    expect(fresh.isLive('bond:p:alpha')).toBe(true);
    expect(fresh.isLive('bond:p:nobody')).toBe(false);
  });
});
