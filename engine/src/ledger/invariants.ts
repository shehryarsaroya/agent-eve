/**
 * INV-1 … INV-7 — the value group, as executable assertions.
 *
 * TESTING.md §3: "These are not tests that run in CI; they are tests that run *in
 * production, forever*. Cheap enough at 300 principals that there is no reason to
 * sample." They run in the `ASSERT` phase of every tick, before `COMMIT`, and on
 * failure the tick aborts and the world enters `PAUSED` (SPEC §15.2). Never
 * publish a broken tick: a ledger that is wrong in public is worse than a ledger
 * that stopped, because the product *is* the record (A5′).
 *
 * INV-6 is not a whole-ledger scan — it is a property of one settlement — so it
 * lives with the payout code in `waterfall.ts` and is re-exported here so the
 * value group has one import site.
 */

import type { AccountId, GoodId, InvariantViolation, PrincipalId } from '../core/types.js';
import { subMinor, type Minor, type Qty } from '../core/units.js';
import { isWorldAccount } from './accounts.js';
import { checkBatchForm, postingLedger } from './batch.js';
import type { ObligationBook } from './encumbrance.js';
import type { Ledger } from './ledger.js';
import { compareIds } from './order.js';

export { assertPayoutsExact } from './waterfall.js';

export interface LedgerInvariantContext {
  readonly tick: number;
  readonly obligations: ObligationBook;
}

/** Thrown by {@link assertLedgerInvariants}. The tick aborts; the world PAUSES. */
export class LedgerHalt extends Error {
  constructor(readonly violations: readonly InvariantViolation[]) {
    super(`ledger invariants failed: ${violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`);
    this.name = 'LedgerHalt';
  }
}

function v(id: string, message: string, tick: number): InvariantViolation {
  return { id, message, tick, severity: 'HALT' };
}

/**
 * INV-1 — every value-moving event produces ≥2 postings summing to zero, or
 * exactly one ISSUE/RETIRE against a named faucet/sink.
 *
 * Re-checks every batch the ledger has applied, using the *same* function
 * `Ledger.apply` used to admit it. That is deliberate: an audit with its own
 * second implementation of the rule is an audit that can disagree with the engine,
 * and a disagreement about the rules is scar #1.
 */
export function checkInv1(l: Ledger, tick: number, sinceIndex = 0): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const batches = l.allBatches();
  for (let i = sinceIndex; i < batches.length; i += 1) {
    const b = batches[i];
    if (b === undefined) continue;
    out.push(
      ...checkBatchForm(
        { kind: b.kind, postings: b.postings, supply: b.supply, tick },
        { get: (id) => l.account(id) },
      ).map((problem) => v('INV-1', `event ${b.eventId}: ${problem.message}`, tick)),
    );
  }
  return out;
}

/**
 * INV-2 — supply conservation, per currency and per good.
 *
 * `Σ balances + Σ escrowed + Σ in-transit = Σ issued − Σ retired`. The buckets
 * partition: for currency, free stores + locks + escrow; for goods, available
 * lots + in-transit lots + escrowed lots. Nothing is in two buckets, which is the
 * only reason this identity means anything (INV-7 / scar #5).
 */
export function checkInv2(l: Ledger, tick: number): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const c = l.currencySupply();
  const held = c.free + c.encumbered + c.escrowed;
  const net = c.issued - c.retired;
  if (held !== net) {
    out.push(
      v(
        'INV-2',
        `currency: free ${c.free} + encumbered ${c.encumbered} + escrowed ${c.escrowed} = ${held}, but issued ${c.issued} − retired ${c.retired} = ${net}`,
        tick,
      ),
    );
  }
  for (const [good, g] of l.goodsSupply()) {
    const heldQty = g.available + g.inTransit + g.escrowed;
    const netQty = g.issued - g.retired;
    if (heldQty !== netQty) {
      out.push(
        v(
          'INV-2',
          `${good}: available ${g.available} + in-transit ${g.inTransit} + escrowed ${g.escrowed} = ${heldQty}, but issued ${g.issued} − retired ${g.retired} = ${netQty}`,
          tick,
        ),
      );
    }
  }
  return out;
}

/**
 * INV-3 — no negative balance on any non-faucet account, no negative lot, and no
 * account whose locks exceed what it holds.
 *
 * The third clause is the one that matters after predation: a raid drains an
 * account whose value was locked, and if locks were allowed to exceed the balance
 * the settlement would pay from money that is not there and the ledger would stop
 * balancing quietly.
 */
export function checkInv3(l: Ledger, tick: number): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const a of l.allAccounts()) {
    if (a.kind !== 'FAUCET' && a.balanceMinor < 0) {
      out.push(v('INV-3', `${a.kind} account ${a.id} holds ${a.balanceMinor}`, tick));
    }
    if (a.kind === 'FAUCET' && a.balanceMinor > 0) {
      out.push(
        v('INV-3', `faucet ${a.id} holds ${a.balanceMinor}; a faucet only ever issues`, tick),
      );
    }
    if (!isWorldAccount(a.kind)) continue;
    const locked = l.encumbrances.encumberedInAccount(a.id);
    if (locked > a.balanceMinor) {
      out.push(
        v('INV-3', `${a.id} has ${locked} locked against a balance of ${a.balanceMinor}`, tick),
      );
    }
  }
  for (const lot of l.allLots()) {
    if (lot.qty <= 0) {
      out.push(v('INV-3', `lot ${lot.id} holds ${lot.qty} of ${lot.good}`, tick));
    }
  }
  return out;
}

/**
 * INV-4 — every encumbrance references a live obligation; no orphan locks; no
 * obligation lacks its encumbrance. Plus: no lot pledged to a lock that is gone.
 *
 * An orphan lock is value nobody can spend and nobody can claim — it silently
 * removes capital from the game, and the agent it belongs to has no affordance
 * that would ever reveal it.
 */
export function checkInv4(l: Ledger, ctx: LedgerInvariantContext): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const { tick, obligations } = ctx;
  const backed = new Set<string>();
  for (const enc of l.encumbrances.open()) {
    backed.add(enc.obligationRef);
    if (!obligations.isLive(enc.obligationRef)) {
      out.push(
        v('INV-4', `encumbrance ${enc.id} locks ${enc.amountMinor} for dead obligation ${enc.obligationRef}`, tick),
      );
    }
    if (l.account(enc.account) === undefined) {
      out.push(v('INV-4', `encumbrance ${enc.id} locks value in unknown account ${enc.account}`, tick));
    }
  }
  for (const ref of obligations.securedObligations()) {
    if (!backed.has(ref)) {
      out.push(v('INV-4', `obligation ${ref} requires an encumbrance and has none`, tick));
    }
  }
  for (const lot of l.allLots()) {
    if (lot.encumbranceId === null) continue;
    if (!l.encumbrances.isOpen(lot.encumbranceId)) {
      out.push(
        v('INV-4', `lot ${lot.id} is pledged to ${lot.encumbranceId}, which is not an open encumbrance`, tick),
      );
    }
  }
  return out;
}

/**
 * INV-5 — EXPOSURE recomputed from the encumbrance table equals the cached value,
 * for every principal.
 *
 * SPEC §3 is strict about the word: EXPOSURE is Σ of open `max_direct_loss` and
 * *nothing else*. Safe value contributes zero by construction (`lockSafe` has no
 * `maxDirectLoss` argument), so there is no shading to detect here — only drift
 * between the table and the number an agent was shown before it signed.
 *
 * `served` is that second cache: the EXPOSURE the observation layer actually put in
 * front of a principal. It is checked as well as the book's own cache, because the
 * number that matters for A7's honesty guarantee is the one the agent read, and a
 * stale blob is the likeliest way for the two to part company (SPEC §15.5 builds
 * observations from shared immutable fragments, which is exactly where a snapshot
 * can go stale).
 */
export function checkInv5(
  l: Ledger,
  tick: number,
  served: ReadonlyMap<PrincipalId, Minor> | null = null,
): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const principals = new Set<PrincipalId>(l.encumbrances.principalsWithExposure());
  if (served !== null) for (const p of served.keys()) principals.add(p);
  for (const p of [...principals].sort(compareIds)) {
    const recomputed = l.encumbrances.recomputeExposure(p);
    const cached = l.encumbrances.cachedExposure(p);
    if (recomputed !== cached) {
      out.push(v('INV-5', `EXPOSURE for ${p}: table says ${recomputed}, cache says ${cached}`, tick));
    }
    if (served !== null) {
      const shown = served.get(p) ?? 0;
      if (shown !== recomputed) {
        out.push(
          v('INV-5', `EXPOSURE for ${p}: table says ${recomputed}, but ${shown} was served`, tick),
        );
      }
    }
  }
  return out;
}

/**
 * INV-7 — no quantity has two homes. Both mirrors are recomputed from `posting`,
 * which is authoritative, and compared.
 *
 * This is the assertion that would have caught scar #5 on the day it shipped: a
 * work handler added gold to an agent and to a district mirror, and the loss
 * handler summed both, so a drowning destroyed exactly 2× the real value.
 */
export function checkInv7(l: Ledger, tick: number): InvariantViolation[] {
  const out: InvariantViolation[] = [];

  // Mirror 1: Account.balanceMinor for world accounts is Σ its currency postings.
  const fromPostings = new Map<string, number>();
  const goodsFromPostings = new Map<string, number>();
  for (const p of l.allPostings()) {
    const leg = postingLedger(p);
    if (leg === 'CURRENCY') {
      fromPostings.set(p.account, (fromPostings.get(p.account) ?? 0) + p.amountMinor);
    } else if (leg === 'GOODS' && p.good !== null && p.amountQty !== null) {
      const k = `${p.account}\u0000${p.good}`;
      goodsFromPostings.set(k, (goodsFromPostings.get(k) ?? 0) + p.amountQty);
    }
  }
  for (const a of l.allAccounts()) {
    if (!isWorldAccount(a.kind)) continue;
    const recomputed = fromPostings.get(a.id) ?? 0;
    if (recomputed !== a.balanceMinor) {
      out.push(
        v('INV-7', `${a.id}: postings sum to ${recomputed}, cached balance is ${a.balanceMinor}`, tick),
      );
    }
  }

  // Mirror 2: Σ lot.qty per (account, good) is Σ that account's goods postings.
  const fromLots = new Map<string, number>();
  for (const lot of l.allLots()) {
    const k = `${lot.account}\u0000${lot.good}`;
    fromLots.set(k, (fromLots.get(k) ?? 0) + lot.qty);
  }
  for (const k of [...new Set([...goodsFromPostings.keys(), ...fromLots.keys()])].sort(compareIds)) {
    const posted = goodsFromPostings.get(k) ?? 0;
    const held = fromLots.get(k) ?? 0;
    if (posted !== held) {
      const [account, good] = k.split('\u0000');
      out.push(
        v(
          'INV-7',
          `${String(good)} in ${String(account)}: postings sum to ${posted}, lots hold ${held}`,
          tick,
        ),
      );
    }
  }

  // Mirror 3: faucet and sink accumulators against the batches that moved supply.
  const issuedMinor = new Map<string, number>();
  const movedQtyByAccount = new Map<string, number>();
  for (const b of l.allBatches()) {
    if (b.supply === null) continue;
    for (const p of b.postings) {
      const leg = postingLedger(p);
      if (leg === 'CURRENCY') {
        issuedMinor.set(b.supply.account, (issuedMinor.get(b.supply.account) ?? 0) - p.amountMinor);
      } else if (leg === 'GOODS' && p.good !== null && p.amountQty !== null) {
        const k = `${b.supply.account}\u0000${p.good}`;
        movedQtyByAccount.set(k, (movedQtyByAccount.get(k) ?? 0) + Math.abs(p.amountQty));
      }
    }
  }
  for (const a of l.allAccounts()) {
    if (isWorldAccount(a.kind)) continue;
    const expected = issuedMinor.get(a.id) ?? 0;
    if (expected !== a.balanceMinor) {
      out.push(
        v('INV-7', `${a.kind} ${a.id}: supply legs sum to ${expected}, cached balance is ${a.balanceMinor}`, tick),
      );
    }
    for (const [good, moved] of [...a.movedQty.entries()].sort((x, y) => compareIds(x[0], y[0]))) {
      const want = movedQtyByAccount.get(`${a.id}\u0000${good}`) ?? 0;
      if (want !== moved) {
        out.push(
          v('INV-7', `${a.kind} ${a.id} ${good}: supply legs moved ${want}, accumulator says ${moved}`, tick),
        );
      }
    }
  }

  return out;
}

/** The whole value group, in id order. */
export function checkLedgerInvariants(l: Ledger, ctx: LedgerInvariantContext): InvariantViolation[] {
  return [
    ...checkInv1(l, ctx.tick),
    ...checkInv2(l, ctx.tick),
    ...checkInv3(l, ctx.tick),
    ...checkInv4(l, ctx),
    ...checkInv5(l, ctx.tick),
    ...checkInv7(l, ctx.tick),
  ];
}

/**
 * The `ASSERT` phase. Throws rather than returning, because the caller's only
 * correct response is to abort the tick — SPEC §15.2, "on assertion failure:
 * abort the tick and halt. Never publish a broken tick."
 */
export function assertLedgerInvariants(l: Ledger, ctx: LedgerInvariantContext): void {
  const violations = checkLedgerInvariants(l, ctx);
  if (violations.length > 0) throw new LedgerHalt(violations);
}

export interface PrincipalPosition {
  /** Spendable: balance less every open lock. */
  readonly free: Minor;
  /** EXPOSURE — Σ open `max_direct_loss`, and nothing else (SPEC §3). */
  readonly exposure: Minor;
  readonly goods: ReadonlyMap<GoodId, Qty>;
}

/**
 * What a principal may still spend and what it stands to lose. Both numbers go on
 * every affordance (PROP-O4), so they are computed in exactly one place — an
 * affordance that shows a different EXPOSURE from the one settlement uses is the
 * shown-worst-case guarantee quietly breaking.
 */
export function principalPosition(
  l: Ledger,
  principal: PrincipalId,
  stores: AccountId,
): PrincipalPosition {
  return {
    free: subMinor(l.balance(stores), l.encumbrances.encumberedInAccount(stores)),
    exposure: l.encumbrances.cachedExposure(principal),
    goods: l.goodsInAccount(stores),
  };
}
