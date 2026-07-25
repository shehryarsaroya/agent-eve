/**
 * The posting batch, and INV-1 as a function.
 *
 * > INV-1 — every value-moving event produces ≥2 postings summing to zero, or
 * > exactly one ISSUE/RETIRE against a **named** faucet/sink.
 *
 * One implementation, two callers: `Ledger.apply` calls it *before* mutating
 * anything (fail closed — never publish a broken tick), and `checkInv1` calls it
 * over every batch the ledger has ever applied at the `ASSERT` phase of each
 * tick. Two implementations of an invariant is how the engine and its own audit
 * come to disagree, which is scar #1 wearing an accountant's hat.
 *
 * Note what a batch does **not** carry: balances. Value moves in postings and
 * nowhere else (SPEC §15.1) — a `currency_after` field here would be scar #5
 * inside the structure that exists to prevent scar #5.
 */

import type { AccountId, EventId, GoodId, InvariantViolation, Posting } from '../core/types.js';
import type { Minor, Qty } from '../core/units.js';
import type { Account, ValueLedger } from './accounts.js';
import { isWorldAccount } from './accounts.js';
import { compareIds } from './order.js';

/** A supply change is always attributable, so its faucet or sink is named. */
export type SupplyDirection = 'ISSUE' | 'RETIRE';

export interface SupplyLeg {
  readonly direction: SupplyDirection;
  /** Must be a member of `NAMED_SUPPLY_ACCOUNTS`. Unnamed minting is unauditable. */
  readonly account: AccountId;
}

/** `TRANSFER` moves value between world accounts; supply is unchanged. */
export type BatchKind = 'TRANSFER' | 'ISSUE' | 'RETIRE';

/** A posting before it is stamped with its event. Mirrors `posting` in schema.sql. */
export interface PostingDraft {
  readonly account: AccountId;
  readonly good: GoodId | null;
  readonly amountMinor: Minor;
  readonly amountQty: Qty | null;
}

export interface AppliedBatch {
  readonly eventId: EventId;
  readonly tick: number;
  readonly kind: BatchKind;
  readonly postings: readonly Posting[];
  readonly supply: SupplyLeg | null;
}

/** What the form check needs to know about an account, without importing the store. */
export interface AccountFacts {
  get(id: AccountId): Account | undefined;
}

function violation(message: string, tick: number): InvariantViolation {
  return { id: 'INV-1', message, tick, severity: 'HALT' };
}

/**
 * Is this posting a currency leg or a goods leg?
 *
 * `schema.sql` requires `good_id` and `amount_qty` to be null or non-null
 * together. We are stricter: a goods leg carries **no** currency, so a trade is
 * four postings (two currency, two goods) rather than two postings each doing two
 * jobs. One row, one movement, one dimension — the mirror check against the lot
 * table then has nothing to disambiguate.
 */
export function postingLedger(p: PostingDraft | Posting): ValueLedger | null {
  if (p.good === null) {
    return p.amountQty === null ? 'CURRENCY' : null;
  }
  return p.amountQty !== null && p.amountMinor === 0 ? 'GOODS' : null;
}

/**
 * INV-1, plus the structural rules that make it meaningful. Returns every
 * problem found rather than the first, because a batch with two defects should
 * report two.
 */
export function checkBatchForm(
  batch: { readonly kind: BatchKind; readonly postings: readonly (PostingDraft | Posting)[]; readonly supply: SupplyLeg | null; readonly tick: number },
  accounts: AccountFacts,
): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const t = batch.tick;
  const { postings, supply } = batch;

  if (postings.length === 0) {
    out.push(violation('a value-moving event produced no postings', t));
    return out;
  }

  // Every posting names a real account, on a real ledger, and never a faucet or
  // sink: supply is expressed by the named supply leg, so a posting against a
  // faucet would give cumulative issuance a second home (INV-7).
  for (const [i, p] of postings.entries()) {
    const acct = accounts.get(p.account);
    if (acct === undefined) {
      out.push(violation(`posting ${i} references unknown account ${p.account}`, t));
      continue;
    }
    if (!isWorldAccount(acct.kind)) {
      out.push(
        violation(
          `posting ${i} targets ${acct.kind} account ${p.account}; supply moves through the batch's named supply leg, not through a posting`,
          t,
        ),
      );
    }
    if (postingLedger(p) === null) {
      out.push(
        violation(
          `posting ${i} on ${p.account} is neither a currency leg (good=null, amountQty=null, amountMinor!=0) nor a goods leg (good set, amountQty set, amountMinor=0)`,
          t,
        ),
      );
    }
    if (p.good === null && p.amountMinor === 0) {
      out.push(violation(`posting ${i} on ${p.account} moves no value`, t));
    }
    if (p.good !== null && p.amountQty === 0) {
      out.push(violation(`posting ${i} on ${p.account} moves no ${p.good}`, t));
    }
  }

  if (supply === null) {
    // Form A — a transfer. >=2 postings, and zero-sum in every dimension it touches.
    if (batch.kind !== 'TRANSFER') {
      out.push(violation(`batch kind ${batch.kind} requires a named faucet or sink`, t));
    }
    if (postings.length < 2) {
      out.push(
        violation(
          `a transfer produced ${postings.length} posting(s); >=2 summing to zero are required, or a named ISSUE/RETIRE`,
          t,
        ),
      );
    }
    let currency = 0;
    const byGood = new Map<GoodId, number>();
    for (const p of postings) {
      currency += p.amountMinor;
      if (p.good !== null && p.amountQty !== null) {
        byGood.set(p.good, (byGood.get(p.good) ?? 0) + p.amountQty);
      }
    }
    if (currency !== 0) {
      out.push(violation(`postings do not sum to zero: currency residue ${currency}`, t));
    }
    for (const good of [...byGood.keys()].sort(compareIds)) {
      const sum = byGood.get(good) ?? 0;
      if (sum !== 0) out.push(violation(`postings do not sum to zero: ${good} residue ${sum}`, t));
    }
    return out;
  }

  // Form B — a supply change. Exactly one posting, against a named faucet or sink.
  if (batch.kind === 'TRANSFER') {
    out.push(violation('a TRANSFER may not carry a supply leg; supply would change', t));
  }
  if (postings.length !== 1) {
    out.push(
      violation(
        `an ${batch.kind} produced ${postings.length} postings; INV-1 permits exactly one against a named faucet/sink`,
        t,
      ),
    );
    return out;
  }
  const p = postings[0];
  if (p === undefined) return out; // unreachable: length checked above

  const supplyAcct = accounts.get(supply.account);
  if (supplyAcct === undefined || supplyAcct.name === null || supplyAcct.ledger === null) {
    out.push(violation(`${batch.kind} names ${supply.account}, which is not a named faucet or sink`, t));
    return out;
  }
  const wantKind = supply.direction === 'ISSUE' ? 'FAUCET' : 'SINK';
  if (supplyAcct.kind !== wantKind) {
    out.push(
      violation(`${supply.direction} names ${supply.account}, which is a ${supplyAcct.kind}, not a ${wantKind}`, t),
    );
  }
  if (supply.direction !== batch.kind) {
    out.push(violation(`batch kind ${batch.kind} disagrees with supply direction ${supply.direction}`, t));
  }

  const leg = postingLedger(p);
  if (leg !== null && leg !== supplyAcct.ledger) {
    // Two ledgers, strictly separated (SPEC §10.2). A goods faucet minting
    // currency is the shape of an unbounded money supply.
    out.push(
      violation(
        `${supply.direction} against ${supplyAcct.ledger} ${supplyAcct.kind} ${supply.account} carries a ${leg} posting`,
        t,
      ),
    );
  }

  const amount = leg === 'GOODS' ? (p.amountQty ?? 0) : p.amountMinor;
  if (supply.direction === 'ISSUE' && amount <= 0) {
    out.push(violation(`ISSUE against ${supply.account} must increase a world account, got ${amount}`, t));
  }
  if (supply.direction === 'RETIRE' && amount >= 0) {
    out.push(violation(`RETIRE against ${supply.account} must decrease a world account, got ${amount}`, t));
  }

  return out;
}
