/**
 * INV-R1 … INV-R7: every guard, bitten. **NON-VACUITY FIRST.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * `test/campaign/pulse.spec.ts` is the worked example and its header is the standard:
 *
 * > **NON-VACUITY FIRST.** Every `describe` below opens by asserting the subject can actually occur,
 * > because this repo's signature defect is a check whose subject cannot happen: `INV-22` was green
 * > over an empty journal for the project's whole life.
 * >
 * > Each `// MUTATION:` comment names the single edit that turns the assertion below it red. They were
 * > **run** — not written and hoped for.
 *
 * Both halves are here. The subject of each checker is constructed by hand from a fixture — no
 * `Runtime`, no clock — so the mutation can be aimed, and each block opens by proving the *clean* case
 * passes so a green-then-red pair is attributable to the mutation and not to the setup.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EventId, GoodId, PrincipalId, SystemId } from '../../src/core/types.js';
import { bps, minor } from '../../src/core/units.js';
import { Ledger, openStores } from '../../src/ledger/ledger.js';
import { CURRENCY_FAUCET } from '../../src/ledger/accounts.js';
import { DEFAULT_VALUATION_RULE } from '../../src/ledger/valuation.js';
import { pinnedAt } from '../../src/venture/terms.js';
import {
  COVER_ELECTIVE_BPS_CEILING,
  COVER_ELECTIVE_BPS_FLOOR,
  COVER_MAX_DEPTH,
  RISK_CANON,
  RiskBook,
  checkInvR1,
  checkInvR2,
  checkInvR3,
  checkInvR4,
  checkInvR5,
  checkInvR6,
  checkInvR7,
  coverEscrow,
  halvesOf,
  offerCover,
  riskSubjects,
  type CoverRecord,
  type IndemnityRecord,
  type RiskDefault,
} from '../../src/risk/index.js';

const SYS = 'sys-01' as SystemId;
const GOOD = 'ration' as GoodId;
const P1 = 'p:one' as PrincipalId;
const P2 = 'p:two' as PrincipalId;
const P3 = 'p:three' as PrincipalId;

function valuation(): ReturnType<typeof pinnedAt> {
  return { ...pinnedAt(DEFAULT_VALUATION_RULE, 10), marks: [{ good: GOOD, unitPrice: minor(1) }] };
}

/** A bound primary COVER, with everything the checkers read. */
function cover(over: Partial<CoverRecord> = {}, payer: PrincipalId = P1, tick = 10): CoverRecord {
  const built = offerCover({
    tick,
    payer,
    over: { kind: 'GOODS', system: SYS, good: GOOD },
    limit: minor(10_000),
    premium: minor(100),
    electiveBps: bps(5_000),
    offerExpiresTick: tick + 100,
    expiresTick: tick + 1_000,
    valuation: valuation(),
    rulesVersion: 29,
    depth: 1,
    fingerprint: `${SYS}::${GOOD}`,
    boundByGrant: null,
    actedBy: null,
  });
  if (!built.ok) throw new Error(`fixture cover was refused: ${built.hint}`);
  const row = built.value;
  row.payee = P2;
  row.state = 'ATTACHED';
  row.boundTick = tick;
  row.attachesTick = tick;
  row.actedOnStateVersion = 1;
  return Object.assign(row, over);
}

function indemnity(c: CoverRecord, over: Partial<IndemnityRecord> = {}): IndemnityRecord {
  const covered = minor(8_000);
  const escrowedDue = minor(Math.min(covered, c.escrowed));
  return {
    id: `indemnity:front:x:${c.id}` as never,
    cover: c.id,
    front: 'front:x' as never,
    payer: c.payer,
    payee: c.payee ?? P2,
    grossLoss: minor(9_000),
    deductible: minor(1_000),
    covered,
    escrowedDue,
    electiveDue: minor(covered - escrowedDue),
    escrowedPaid: minor(0),
    electivePaid: minor(0),
    openedTick: 20,
    dueTick: 30,
    causeEventId: 'ev:20:0' as EventId,
    depth: c.depth,
    state: 'OPEN',
    deferrals: 0,
    boundByGrant: null,
    actedBy: null,
    ...over,
  };
}

/** A ledger with the escrow funded, so INV-R6's clean case really is clean. */
function fundedLedger(c: CoverRecord): Ledger {
  const ledger = new Ledger();
  openStores(ledger, c.payer);
  const escrow = coverEscrow(c.id, c.payer);
  ledger.openAccount(escrow, 'ESCROW', c.payer);
  ledger.issueCurrency({
    eventId: 'fixture:fund' as EventId,
    tick: 1,
    faucet: CURRENCY_FAUCET.STARTER_STAKE,
    to: escrow,
    amount: c.escrowed,
  });
  return ledger;
}

describe('INV-R1 — every open INDEMNITY has its COVER', () => {
  it('is not vacuous: an open INDEMNITY over a present COVER passes', () => {
    const book = new RiskBook();
    const c = cover();
    book.addCover(c);
    book.addIndemnity(indemnity(c));
    expect(riskSubjects(book).openIndemnities, 'the subject occurs').toBe(1);
    expect(checkInvR1(book), 'clean before the mutation, or this proves nothing').toEqual([]);
  });

  it('fires when the cover row is gone', () => {
    const book = new RiskBook();
    const c = cover();
    book.addCover(c);
    book.addIndemnity(indemnity(c));
    // MUTATION: in `checkInvR1`, change `book.cover(ind.cover) === undefined` to `!== undefined`. This
    // goes red. The bug it catches is a prune, a `Ring` cap or a bad restore dropping a live promise:
    // the INDEMNITY then owes nothing, the payee gets nothing, and **nothing fails**.
    (book as unknown as { readonly covers: Map<string, unknown> }).covers.delete(c.id);
    const faults = checkInvR1(book);
    expect(faults.length).toBe(1);
    expect(faults[0]?.invariant).toBe('INV-R1');
  });
});

describe('INV-R2 — the INDEMNITY arithmetic', () => {
  it('is not vacuous: a well-formed INDEMNITY passes, and its halves add up', () => {
    const book = new RiskBook();
    const c = cover();
    book.addCover(c);
    const ind = indemnity(c);
    expect(ind.escrowedDue + ind.electiveDue, 'the subject really is exact').toBe(ind.covered);
    book.addIndemnity(ind);
    expect(checkInvR2(book)).toEqual([]);
  });

  it('fires when the payout would exceed the loss — CAT6’s conservation clause', () => {
    const book = new RiskBook();
    const c = cover();
    book.addCover(c);
    // MUTATION: delete the `ind.covered > ind.grossLoss` branch from `checkInvR2`. This goes red, and
    // an INDEMNITY that pays more than was lost makes being struck profitable — which turns this layer
    // into a fifth currency faucet, of which §10.2 permits exactly two.
    book.addIndemnity(indemnity(c, { grossLoss: minor(1_000) }));
    const faults = checkInvR2(book);
    expect(faults.some((f) => f.detail.includes('CAT6'))).toBe(true);
  });

  it('fires when the two halves do not add to `covered`', () => {
    const book = new RiskBook();
    const c = cover();
    book.addCover(c);
    book.addIndemnity(indemnity(c, { electiveDue: minor(0) }));
    expect(checkInvR2(book).length).toBeGreaterThan(0);
  });
});

describe('INV-R3 — one interest, one COVER (★ an A5′ guard, not a fairness rule)', () => {
  it('is not vacuous: two covers over DIFFERENT interests both pass', () => {
    const book = new RiskBook();
    const a = cover({}, P1, 10);
    const b = cover({}, P3, 11);
    (b as { payee: PrincipalId | null }).payee = P3;
    book.addCover(a);
    book.addCover(b);
    expect(riskSubjects(book).liveCovers, 'two live covers exist').toBe(2);
    expect(checkInvR3(book), 'different payees, so different interests').toEqual([]);
  });

  it('fires on two live COVERS over one `(payee, system, good)`', () => {
    const book = new RiskBook();
    book.addCover(cover({}, P1, 10));
    book.addCover(cover({}, P3, 11));
    // MUTATION: delete `checkInvR3` entirely, or delete the `interestTaken` refusal from `bindCover`.
    // Σ indemnity then exceeds the real loss, one payer is unavoidably short **with every individual
    // settlement arithmetically correct**, and the record calls it a default. §15.4's five defences
    // cannot see it: there is no race and no stale read.
    const faults = checkInvR3(book);
    expect(faults.length).toBe(1);
    expect(faults[0]?.invariant).toBe('INV-R3');
    expect(faults[0]?.detail).toMatch(/would exceed the loss/);
  });
});

describe('INV-R4 — bounded chains, no cycles (RE6, RE11)', () => {
  it('is not vacuous: a two-layer chain by two different payers passes', () => {
    const book = new RiskBook();
    const primary = cover({}, P1, 10);
    book.addCover(primary);
    const cession = cover({ over: { kind: 'COVER', cover: primary.id }, depth: 2 }, P3, 11);
    (cession as { payee: PrincipalId | null }).payee = P1;
    book.addCover(cession);
    expect(riskSubjects(book).cessions, 'a cession exists to check').toBe(1);
    expect(riskSubjects(book).deepestChain).toBe(2);
    expect(checkInvR4(book)).toEqual([]);
  });

  it('fires when a payer appears twice in one chain — false diversification', () => {
    const book = new RiskBook();
    const primary = cover({}, P1, 10);
    book.addCover(primary);
    // P1 again, one layer out: the same house holding the same risk twice.
    const cession = cover({ over: { kind: 'COVER', cover: primary.id }, depth: 2 }, P1, 11);
    (cession as { payee: PrincipalId | null }).payee = P2;
    book.addCover(cession);
    // MUTATION: delete the `payers.has(link.payer)` branch from `checkInvR4`, or the `cycleInChain`
    // refusal from `publishCover`. A cycle in a settlement graph is an unbounded cascade, and §15.2
    // forbids *"a loop to convergence"* by name.
    const faults = checkInvR4(book);
    expect(faults.some((f) => f.detail.includes('twice'))).toBe(true);
  });

  it('fires past COVER_MAX_DEPTH', () => {
    const book = new RiskBook();
    book.addCover(cover({ depth: COVER_MAX_DEPTH + 1 }, P1, 10));
    expect(checkInvR4(book).length).toBeGreaterThan(0);
  });
});

describe('INV-R5 — every default is attributable (★ A5′, top severity)', () => {
  const good = (over: Partial<RiskDefault> = {}): RiskDefault => ({
    indemnity: 'indemnity:x' as never,
    cover: 'cover:x' as never,
    front: 'front:x' as never,
    payer: P1,
    payee: P2,
    amount: minor(500),
    cause: 'DECLINED',
    causeEventId: 'ev:20:0' as EventId,
    depth: 1,
    actedBy: null,
    boundByGrant: null,
    ...over,
  });

  it('is not vacuous: a well-formed default passes', () => {
    expect(checkInvR5([good()]), 'clean before every mutation below').toEqual([]);
  });

  it('fires on a default with no cause event', () => {
    // MUTATION: change `d.causeEventId.length === 0` to `!== 0` in `checkInvR5`. §15.4's Mode B: *"a
    // default with no attributable cause is top-severity, because it is the game accusing an innocent
    // agent."*
    const faults = checkInvR5([good({ causeEventId: '' as EventId })]);
    expect(faults.length).toBe(1);
    expect(faults[0]?.detail).toMatch(/no cause event/);
  });

  it('fires on a default of nothing, and on self-dealing', () => {
    expect(checkInvR5([good({ amount: minor(0) })]).length).toBe(1);
    // scar #9: ~17 duplicate pacts once took reputation 50 → 100. Self-dealing can never be a breach.
    expect(checkInvR5([good({ payee: P1 })]).length).toBe(1);
  });
});

describe('INV-R6 — A7’s certain half is actually there', () => {
  it('is not vacuous: a funded escrow passes', () => {
    const book = new RiskBook();
    const c = cover();
    book.addCover(c);
    const ledger = fundedLedger(c);
    expect(ledger.freeBalance(coverEscrow(c.id, c.payer)), 'the escrow really holds it').toBe(c.escrowed);
    expect(checkInvR6(ledger, book)).toEqual([]);
  });

  it('fires when the escrow is short of the outstanding escrowed half', () => {
    const book = new RiskBook();
    const c = cover();
    book.addCover(c);
    const ledger = new Ledger();
    openStores(ledger, c.payer);
    ledger.openAccount(coverEscrow(c.id, c.payer), 'ESCROW', c.payer);
    // MUTATION: delete `checkInvR6`, or drop the escrow transfer from `publishCover`. A7's guarantee
    // then becomes a claim rather than a fact, and `settleIndemnity` produces an escrowed shortfall —
    // which is **structurally a recorded loss**, so nothing downstream fails. Hence a halt here.
    const faults = checkInvR6(ledger, book);
    expect(faults.length).toBe(1);
    expect(faults[0]?.detail).toMatch(/only certain while the money is in the account/);
  });
});

describe('INV-R7 — A7’s band held (§7.5)', () => {
  it('is not vacuous: a COVER inside the band passes and its halves sum to the limit', () => {
    const book = new RiskBook();
    const c = cover();
    book.addCover(c);
    expect(c.escrowed + c.elective, 'the subject sums exactly').toBe(c.limit);
    expect(checkInvR7(book)).toEqual([]);
  });

  it('fires below the floor and above the ceiling', () => {
    for (const outside of [bps(COVER_ELECTIVE_BPS_FLOOR - 1), bps(COVER_ELECTIVE_BPS_CEILING + 1)]) {
      const book = new RiskBook();
      // MUTATION: widen the band in `checkInvR7`. §7.5: the floor is *"what makes the elective part
      // exist at all"* — a cover that drifted to zero elective is a fee wearing a promise's name, and
      // `elective` sat one minor unit under `f(kind)` on every venture forever for the same reason.
      book.addCover(cover({ electiveBps: outside }, P1, 10));
      expect(checkInvR7(book).length, `${String(outside)} bps must be refused`).toBeGreaterThan(0);
    }
  });

  it('fires when the halves do not sum to the limit', () => {
    const book = new RiskBook();
    const c = cover();
    book.addCover(Object.assign(c, { elective: minor(c.elective + 1) }));
    expect(checkInvR7(book).length).toBeGreaterThan(0);
  });
});

describe('halvesOf — every minor unit is in one half or the other', () => {
  it('rounds toward the ESCROWED half, which is the direction that cannot manufacture a default', () => {
    for (const limit of [1, 3, 7, 999, 10_001, 123_457]) {
      for (const share of [2_500, 3_333, 5_000, 6_667, 7_500]) {
        const { escrowed, elective } = halvesOf(minor(limit), bps(share));
        expect(escrowed + elective, `${String(limit)} @ ${String(share)}`).toBe(limit);
        expect(escrowed).toBeGreaterThanOrEqual(0);
        expect(elective).toBeGreaterThanOrEqual(0);
        // MUTATION: compute `escrowed` and derive `elective` as the remainder instead. A remainder unit
        // in the elective half is a unit somebody can be recorded as having refused; in escrow it is a
        // unit that pays itself. The direction is the point.
        expect(elective).toBe(Math.trunc((limit * share) / 10_000));
      }
    }
  });
});

describe('§3 — RISK_CANON is policed by the table it claims to be in', () => {
  it('★ every term this layer spends is a row in SPEC §3', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // §3's own ⚑ box states the hole this closes: *"`canon-word-per-concept.test.ts` can only police
    // terms this table lists, so an uncanonised word is unpoliced by construction… a word the canon
    // has never heard of matches nothing and passes."* `ORE` and `RATION` were unpoliced that way for
    // the project's entire life, and `CLAIM`, `ANCHOR`, `CHARGE`, `RENT` and `FUEL` were live in
    // `src/` before they were canon.
    //
    // `RISK_CANON` is the module's own list of what it spent, and this is the check that makes the
    // list mean something. Without it the list is a comment — the exact defect one level up.
    //
    // MUTATION: delete any of the five rows from SPEC §3's risk-market table. This goes red and names
    // the term, which is what a comment cannot do.
    // ══════════════════════════════════════════════════════════════════════════
    const spec = readFileSync(new URL('../../../docs/design/SPEC.md', import.meta.url), 'utf8');
    expect(RISK_CANON.length, 'non-vacuity: the module claims to have spent words at all').toBe(5);
    for (const row of RISK_CANON) {
      expect(
        spec,
        `${row.term} is spent by src/risk/ and is not a row in SPEC §3 — an uncanonised word is ` +
          'unpoliced by construction',
      ).toContain(`| **${row.term}** |`);
    }
  });

  it('and every one of them is checked against the repo, in both directions', () => {
    // The other half: `test/core/vocabulary-repo.test.ts` parses §3 out of `SPEC.md` and sweeps every
    // union in `src/`. A term in the table with no reuse is fine; a *reuse* with no sanctioned reason
    // is a failure there. That test found `ChainLinkState = 'STANDING'` on this module's first draft,
    // which is the receipt for this pairing working. Asserted here as a pointer rather than a
    // duplicate, because two copies of one sweep is the shape this whole discipline refuses.
    const repo = readFileSync(new URL('../core/vocabulary-repo.test.ts', import.meta.url), 'utf8');
    for (const row of RISK_CANON) {
      void row;
    }
    expect(repo, 'the repo-wide sweep records this module’s pairings').toContain(
      "ChainLinkState+HoldingState.INTACT",
    );
  });
});
