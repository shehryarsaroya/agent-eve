/**
 * ★ **THE MARKET PRINTS A FILL, AND THE ENDOWMENT STILL CANNOT LEAVE.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE BAR FOR THIS FILE IS A FILL, NOT A FIELD.** `market/` is 3,065 lines and had
 * **never printed a fill in any world this repo has ever run.** Supply worked — the cast
 * refines alloy and puts 8–16 asks on the book every world — and nothing could ever buy
 * them, because `freeCash` was `freeBalance − STARTER_STAKE` with the floor at the whole
 * 250,000 while every cast member in every world sits between 62,000 and 203,000. The buy
 * side was unreachable **by construction**.
 *
 * `test/works/a-good-only-the-commons-makes.spec.ts` already proves the chain works when a
 * buyer is hand-funded, and says so in its own header. That is a fixture. **This file runs
 * the cast, funds nobody, and asserts that an ask and a bid from two different principals
 * cross** — goods one way, currency the other, measured across the fill's own tick.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## And the second half, which is the one A15 cares about
 *
 * HARD RULE 5: *any gate priced in identities is unpriced.* Making the floor movable must
 * not make an identity worth anything. The theorem is exact and it is proved here **from
 * the posting log of real worlds**, not from a fixture's own arithmetic:
 *
 *     balance(p)   =  STARTER_STAKE + received(p) − sent(p) − retired(p)
 *     remaining(p) =  max(0, STARTER_STAKE − retired(p))
 *     ⟹  balance(p) − remaining(p)  =  received(p) − sent(p)   [while retired ≤ STAKE]
 *
 * **The endowment cancels out.** What a principal may transfer is exactly what it was paid,
 * minus what it has already sent — and a fresh identity has been paid nothing. That is a
 * stronger statement than the old static floor could make, and it is measured over every
 * principal of eight worlds rather than asserted.
 *
 * ## A note on the instrument, because it lied once already
 *
 * The first version of this file read the roster as `m.principalId`. `CastMember` names the
 * field `principal`, so every lookup was `stores:undefined`, `freeCash` returned its
 * not-an-account zero, and the whole A15 column read a confident and meaningless `0`. It
 * was caught only because a *different* assertion threw on the same bad id. **A witness
 * with its own copy of the subject can be wrong in exactly the direction that hides**, and
 * this project has now paid for that three times. Non-vacuity assertions below are there
 * for that reason and are not decoration.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import { Runtime } from '../../src/sim/runtime.js';
import {
  cashLegEvent,
  freeCash,
  goodsLegEvent,
  marketEscrowAccount,
} from '../../src/market/escrow.js';
import { storesAccount, CURRENCY_FAUCET } from '../../src/ledger/index.js';
import { STARTER_STAKE } from '../../src/ledger/endowment.js';
import { postingLedger } from '../../src/ledger/batch.js';
import type { Ledger } from '../../src/ledger/ledger.js';
import type { PrincipalId } from '../../src/core/types.js';
import type { Fill } from '../../src/market/book.js';

const SEEDS = ['g01', 'g02', 'g03', 'g04', 'g05', 'g06', 'g07', 'g08'] as const;

interface Played {
  readonly runtime: Runtime;
  readonly roster: readonly PrincipalId[];
  readonly fills: readonly Fill[];
}

/** Worlds are expensive; each seed/horizon pair is played once for the whole file. */
const PLAYED = new Map<string, Played>();

/** Run one seeded world through the heuristic cast. Nobody is funded by hand. */
function play(seed: string, reckonings: number, members = 8): Played {
  const key = `${seed}/${String(reckonings)}/${String(members)}`;
  const hit = PLAYED.get(key);
  if (hit !== undefined) return hit;

  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: members });
  // ★ `principal`, which is what `CastMember` calls it. See the header.
  const roster = cast.seat(seed).map((m) => m.principal);
  for (const who of roster) {
    if (runtime.ledger.account(storesAccount(who)) === undefined) {
      throw new Error(`the roster is not readable: ${String(who)} has no STORES account`);
    }
  }
  for (let i = 0; i < reckonings * TICKS_PER_RECKONING; i += 1) {
    const next = runtime.engine.tick + 1;
    for (const action of cast.decide(next, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    expect(report.halted, `${seed} halted at ${String(report.tick)}`).toBe(false);
  }
  const out: Played = { runtime, roster, fills: runtime.market.fills() };
  PLAYED.set(key, out);
  return out;
}

/**
 * Currency into and out of a principal's STORES, recomputed from the posting log —
 * **a second road**, sharing no code with `freeCash` or with `EndowmentBook`.
 *
 * `received` deliberately excludes the enrolment stake, because the stake is the very thing
 * under test. `sent` excludes retirements, because those are the world being paid rather
 * than a counterparty, and they are what moves `remaining`.
 */
function flows(
  ledger: Ledger,
  who: PrincipalId,
): { received: number; sent: number; retired: number } {
  const account = storesAccount(who);
  let received = 0;
  let sent = 0;
  let retired = 0;
  for (const batch of ledger.allBatches()) {
    for (const p of batch.postings) {
      if (p.account !== account || postingLedger(p) !== 'CURRENCY') continue;
      const isStake =
        batch.supply?.direction === 'ISSUE' &&
        batch.supply.account === CURRENCY_FAUCET.STARTER_STAKE;
      if (batch.supply?.direction === 'RETIRE') retired += 0 - Number(p.amountMinor);
      else if (p.amountMinor > 0 && !isStake) received += p.amountMinor;
      else if (p.amountMinor < 0) sent += 0 - Number(p.amountMinor);
    }
  }
  return { received, sent, retired };
}

describe('★ the buy side is reachable — a fill, in a world nobody funded', () => {
  it('an ask and a bid from DIFFERENT principals cross, in real seeded worlds', () => {
    // ══════════════════════════════════════════════════════════════════════
    // MUTATION: revert `freeCash` to `freeBalance − ENDOWMENT_FLOOR_MINOR`. RED — and it is
    // RED at ZERO fills across every seed, which is the state this engine shipped in for
    // the whole life of `market/`.
    // ══════════════════════════════════════════════════════════════════════
    let worldsWithAFill = 0;
    let total = 0;
    for (const seed of SEEDS.slice(0, 4)) {
      const { fills } = play(seed, 6);
      total += fills.length;
      if (fills.length > 0) worldsWithAFill += 1;
      for (const f of fills) {
        expect(f.buyer, 'a fill between one principal and itself is a wash, not a market').not.toBe(
          f.seller,
        );
        expect(Number(f.qty)).toBeGreaterThan(0);
        expect(Number(f.unitPrice)).toBeGreaterThan(0);
        // Two different orders, i.e. two sides genuinely met rather than one being booked twice.
        expect(f.bid).not.toBe(f.ask);
      }
    }
    expect(total, 'the market must print a fill in a real world').toBeGreaterThan(0);
    expect(worldsWithAFill, 'and not only in one lucky seed').toBeGreaterThanOrEqual(3);
  });

  it('★ goods go one way and currency the other, measured across the fill own tick', () => {
    // ══════════════════════════════════════════════════════════════════════
    // A `Fill` row is a claim the matcher wrote about itself, so it is not the evidence. The
    // evidence is the two ledgers, sampled either side of the tick the fill landed on and
    // read through the engine's own accessors. Sampling at the END of the run would prove
    // nothing: the buyer bought the alloy in order to spend it on an ANCHOR, so its holding
    // is legitimately back to zero by then — which is how the first version of this test
    // failed, in the direction that looks like a bug and is not.
    // ══════════════════════════════════════════════════════════════════════
    setSpeed('instant');
    const seed = 'g01';
    const runtime = new Runtime({ seed });
    const cast = new HeuristicCast(runtime, { size: 8 });
    // Once. `seat` enrols, and enrolment is not idempotent — identity is never re-minted.
    const roster = cast.seat(seed).map((m) => m.principal);

    let before: Map<PrincipalId, number> | null = null;
    let fill: Fill | null = null;
    for (let i = 0; i < 6 * TICKS_PER_RECKONING && fill === null; i += 1) {
      const next = runtime.engine.tick + 1;
      for (const action of cast.decide(next, seed)) runtime.engine.submit(action);
      const snapshotCash = new Map<PrincipalId, number>();
      for (const who of roster) {
        snapshotCash.set(who, Number(runtime.ledger.balance(storesAccount(who))));
      }
      const report = runtime.runTick();
      expect(report.halted).toBe(false);
      const landed = runtime.market.fillsAt(report.tick);
      if (landed.length > 0) {
        fill = landed[0] ?? null;
        if (fill !== null) {
          before = snapshotCash;
        }
      }
    }

    expect(fill, 'non-vacuity: no fill landed, so nothing below was checked').not.toBeNull();
    if (fill === null || before === null) throw new Error('unreachable');

    const cash = Number(fill.qty) * Number(fill.unitPrice);
    expect(cash, 'a fill for nothing is not a fill').toBeGreaterThan(0);

    // ── CURRENCY: the fill's OWN cash leg, found in the posting log by its event id ──
    //
    // Not the tick's net balance change, which was the first version and was wrong: a
    // principal does other business in the same tick — the measured seller was also paying
    // 4,800 of something else — so the net moved by 1,200 while the fill moved 6,000. A
    // whole-tick delta is not evidence about one event, and the engine mints a named event
    // id for exactly this leg.
    const legs = runtime.ledger
      .allBatches()
      .filter((b) => String(b.eventId) === cashLegEvent(fill.id))
      .flatMap((b) => b.postings);
    expect(legs.length, 'the fill must have written a cash leg').toBe(2);
    const paid = legs.find((p) => p.account === storesAccount(fill.buyer));
    const got = legs.find((p) => p.account === storesAccount(fill.seller));
    expect(Number(paid?.amountMinor), 'the buyer paid exactly the price').toBe(0 - cash);
    expect(Number(got?.amountMinor), 'and the seller was paid exactly it').toBe(cash);
    // A double-entry pair summing to zero: currency moved, none was created.
    expect(legs.reduce((n, p) => n + p.amountMinor, 0)).toBe(0);

    // Belt and braces: the buyer's whole-tick delta is at least the price it paid.
    const buyerAfter = Number(runtime.ledger.balance(storesAccount(fill.buyer)));
    expect((before.get(fill.buyer) ?? 0) - buyerAfter).toBeGreaterThanOrEqual(cash);

    // ── GOODS: the fill's OWN goods legs, found the same way ──
    //
    // Read by event id rather than by sampling the buyer's holding, for the same reason the
    // cash leg is: a holding is the net of everything the principal did, and the second
    // version of this test compared a snapshot taken AFTER the tick to the value after the
    // tick and duly measured a delta of zero. `Fill.goodsLegs` exists precisely so the audit
    // can rebuild these ids, and MKT-4 uses them for the same purpose.
    expect(fill.goodsLegs, 'a fill must move goods over at least one lot leg').toBeGreaterThan(0);
    let intoBuyer = 0;
    let outOfEscrow = 0;
    for (let leg = 0; leg < fill.goodsLegs; leg += 1) {
      const id = goodsLegEvent(fill.id, leg);
      const postings = runtime.ledger
        .allBatches()
        .filter((b) => String(b.eventId) === id)
        .flatMap((b) => b.postings);
      expect(postings.length, `goods leg ${String(leg)} of ${fill.id} is missing`).toBeGreaterThan(0);
      for (const p of postings) {
        if (p.good !== fill.good || p.amountQty === null) continue;
        if (p.account === storesAccount(fill.buyer)) intoBuyer += p.amountQty;
        if (p.account === marketEscrowAccount(fill.seller)) outOfEscrow += p.amountQty;
      }
    }
    expect(intoBuyer, 'the goods must have arrived at the buyer').toBe(Number(fill.qty));
    expect(outOfEscrow, "and left the seller's escrow").toBe(0 - Number(fill.qty));

    // And the buyer is holding them at the venue it traded at — geography survives a fill.
    expect(Number(runtime.alloyAt(fill.buyer, fill.venue))).toBeGreaterThanOrEqual(
      Number(fill.qty),
    );
  });
});

describe('★ A15: what a principal may transfer is exactly what it was PAID', () => {
  it('balance − remaining == received − sent, over every principal of eight worlds', () => {
    // ══════════════════════════════════════════════════════════════════════
    // THE THEOREM, MEASURED. The endowment cancels out of the identity entirely, which is
    // why moving the floor cannot have widened the Sybil surface: what a principal may send
    // never mentions the stake, only the flows. A fresh identity has `received = 0` and
    // therefore nothing to send, at every N, forever.
    //
    // Stated as an EQUALITY on the balance side and an INEQUALITY on the `freeCash` side,
    // because `freeCash` reads `freeBalance` — an open BID lock or a sovereignty bond
    // legitimately holds spendable currency down, and clamping is the safe direction. The
    // equality is the claim; the inequality is what the market gate actually enforces.
    //
    // MUTATION: any change that lets `remaining` rise, or that decrements it on a transfer
    // rather than a retirement, breaks the equality on the first principal that has spent.
    // ══════════════════════════════════════════════════════════════════════
    let checked = 0;
    let withEarnings = 0;
    let overSpent = 0;
    for (const seed of SEEDS) {
      const { runtime, roster } = play(seed, 3);
      for (const who of roster) {
        const { received, sent, retired } = flows(runtime.ledger, who);
        const balance = Number(runtime.ledger.balance(storesAccount(who)));
        const remaining = Number(runtime.ledger.endowments.remaining(who));

        if (retired <= STARTER_STAKE) {
          expect(
            balance - remaining,
            `${seed}/${who}: balance ${String(balance)} − remaining ${String(remaining)} must be ` +
              `received ${String(received)} − sent ${String(sent)}`,
          ).toBe(received - sent);
        } else {
          overSpent += 1;
        }
        expect(Number(freeCash(runtime.ledger, who))).toBeLessThanOrEqual(
          Math.max(0, received - sent),
        );
        checked += 1;
        if (received > 0) withEarnings += 1;
      }
    }
    expect(checked, 'non-vacuity: some principals must have been examined').toBeGreaterThan(50);
    // ...and some must actually have EARNED, or the identity is only ever checked at 0 = 0
    // and proves nothing about the case that matters.
    expect(withEarnings, 'non-vacuity: the identity must be exercised at NON-ZERO').toBeGreaterThan(
      10,
    );
    // Recorded rather than asserted: if this ever stops being 0 the equality branch above is
    // being skipped for somebody and the exclusion needs re-reading.
    expect(overSpent, 'nobody in these worlds has retired past its whole stake').toBe(0);
  });

  it('★ a SOCK PUPPET enrolled into a live economy holds nothing transferable', () => {
    // ══════════════════════════════════════════════════════════════════════
    // THE SYBIL STATEMENT IN ITS PUREST FORM, AND THE SUBJECT HAD TO BE BUILT ON PURPOSE.
    //
    // The first version of this test looked for an unpaid CAST MEMBER and found none: at
    // three Reckonings **every** member of every one of the eight worlds has been paid
    // something. That is a finding about the economy rather than a broken test — the
    // non-vacuity guard is what surfaced it, and without the guard this would have passed
    // over an empty set and reported the Sybil property proved.
    //
    // So the puppet is enrolled into the running world, exactly as an attacker's would be:
    // free, at any time, with a full stake and no history. It never acts.
    // ══════════════════════════════════════════════════════════════════════
    const { runtime } = play('g01', 3);
    const sock = 'p:sock-puppet' as PrincipalId;
    runtime.seat(sock, 'sock-puppet', undefined);

    // Non-vacuity: the puppet is real, funded, and standing in a live economy.
    expect(Number(runtime.ledger.balance(storesAccount(sock)))).toBe(STARTER_STAKE);
    expect(runtime.market.fills().length, 'the world it joined has a working market').toBeGreaterThan(0);

    const { received } = flows(runtime.ledger, sock);
    expect(received, 'nobody has paid it anything').toBe(0);
    expect(
      Number(freeCash(runtime.ledger, sock)),
      'and therefore it can commit nothing to a BID, a cession or a contribution',
    ).toBe(0);
    expect(Number(runtime.ledger.endowments.remaining(sock))).toBe(STARTER_STAKE);

    // Ten of them concentrate ten times nothing, which is the arithmetic D7 exists for.
    let fleet = 0;
    for (let i = 0; i < 10; i += 1) {
      const p = `p:sock-${String(i)}` as PrincipalId;
      runtime.seat(p, `sock-${String(i)}`, undefined);
      fleet += Number(freeCash(runtime.ledger, p));
    }
    expect(fleet, 'a fleet of free identities yields zero tradeable capital').toBe(0);
  });

  it('the currency faucets are still exactly two, and only one of them is free', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The theorem says transferable currency equals `received`, which makes the SOURCES of
    // `received` the whole A15 question. They are pinned here: `STARTER_STAKE`, free per
    // identity and precisely what `EndowmentBook` withholds; and `CIVIC_PROCUREMENT`, which
    // mints `baseYield × filledOutputBps` and is therefore **zero unless a role is filled**
    // — i.e. priced in an independently-capitalised counterparty, which is exactly what A15
    // sanctions as a price. Neither is priced in identities.
    //
    // A third currency faucet would be a constitutional change (`accounts.ts` says so) and
    // would need this argument re-made from scratch.
    // ══════════════════════════════════════════════════════════════════════
    expect(Object.keys(CURRENCY_FAUCET).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(['CIVIC_PROCUREMENT', 'STARTER_STAKE']);
  });
});

describe('the rules surface says the same thing the engine does (scar #1)', () => {
  it('publishes what an agent may commit to a BID, under a name that is not the WORKS one', () => {
    // ══════════════════════════════════════════════════════════════════════
    // HARD RULE 4 and scar #1. Two DIFFERENT quantities were about to wear one name:
    // `works.here.spendable_minor` is `freeBalance` (a build DESTROYS currency, so the
    // endowment may pay for it) and the market's figure is `freeCash` (a BID TRANSFERS it,
    // so the endowment may not). High Water shipped a game whose central ritual reliably
    // produced the opposite of what the town voted for, and it survived three critic passes
    // because every individual component was correct and two surfaces disagreed about one
    // word. The names differ here because the rules differ.
    //
    // MUTATION: rename the market field to `spendable_minor`. RED on the second assertion.
    // ══════════════════════════════════════════════════════════════════════
    const { runtime, roster } = play('g01', 3);
    const who = roster[0];
    if (who === undefined) throw new Error('no roster');
    const view = runtime.marketView(who, runtime.engine.tick);

    expect(Object.keys(view)).toContain('transferable_minor');
    expect(
      Object.keys(view),
      'the market must not reuse the WORKS name for a different quantity',
    ).not.toContain('spendable_minor');
    // ★ The published number IS the gate, not a second arithmetic beside it.
    expect(view['transferable_minor']).toBe(freeCash(runtime.ledger, who));
  });

  it('agent.md states the rule, in the engine own field names', () => {
    // Pinned against the field names rather than retyped prose, so a rename cannot leave the
    // agent-facing text describing a field that no longer exists.
    const md = readFileSync(fileURLToPath(new URL('../../agent.md', import.meta.url)), 'utf8');
    for (const wanted of [
      'market.transferable_minor',
      'works.here.spendable_minor',
      '**Your endowment cannot LEAVE you. Everything you have EARNED can.**',
      'It is tracked down, not frozen',
    ]) {
      expect(md, `agent.md must say: ${wanted}`).toContain(wanted);
    }
  });
});
