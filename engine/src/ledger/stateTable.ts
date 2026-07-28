/**
 * The Ledger as a snapshot-and-rollback state table.
 *
 * Why this file exists, and why its absence was serious. A verifier found that the
 * sim registered exactly one state table (`venture`), so **money was outside
 * `state_hash` and outside the abort path**. Two consequences, both of which
 * contradict claims the project makes about itself:
 *
 *   1. `state_hash` did not attest to value. Two runs with identical world, intent
 *      and venture state but divergent BALANCES hashed the same. DET-1 ("same seed,
 *      identical hash") held while saying nothing about the one thing the game is
 *      about. A hash that cannot see the money is not a hash of the world.
 *   2. `Engine.abort` could not restore it. SPEC §15.2's operator story — "replay the
 *      failed tick from the immutable triple and it produces the world every observer
 *      was promised" — was false for the table settlement mutates most. A halt left
 *      the ledger dirty and the next tick built on it.
 *
 * The append-only halves make this cheap rather than expensive. `posting` and
 * `batch` only ever grow, so **truncation to a captured length is an exact inverse**;
 * there is no need to carry their contents in every snapshot. Accounts, lots and
 * encumbrances are mutable and are carried in full.
 */

import type { CanonicalValue } from '../core/canonical.js';
import { minor, qty, type Minor, type Qty } from '../core/units.js';
import type { AccountId, GoodId, PrincipalId, SystemId } from '../core/types.js';
import type { StateTable } from '../tick/snapshot.js';
import type { Ledger } from './ledger.js';
import type { AccountKind, ValueLedger } from './accounts.js';
import type { Lot, LotId, LotState } from './lots.js';
import type { EncumbranceCapture } from './encumbrance.js';
import type { EndowmentRow } from './endowment.js';
import { compareIds } from './order.js';

export class LedgerRestoreError extends Error {}

/** Rows a caller must hand back to rebuild the ledger's mutable half. */
export interface LedgerRestore {
  readonly accounts: readonly LedgerAccountRow[];
  readonly lots: readonly Lot[];
  /** The open locks. Restoring these is what makes an abort actually undo a lock. */
  readonly encumbrances: EncumbranceCapture;
  /** D7's per-principal endowment counters (`RULES_VERSION` 19). */
  readonly endowments: readonly EndowmentRow[];
  /** Append-only tails are truncated to these lengths, not rebuilt. */
  readonly postingCount: number;
  readonly batchCount: number;
}

export interface LedgerAccountRow {
  readonly id: AccountId;
  readonly kind: AccountKind;
  readonly principal: PrincipalId | null;
  readonly name: string | null;
  readonly ledger: ValueLedger | null;
  readonly balanceMinor: Minor;
  readonly movedQty: ReadonlyMap<GoodId, Qty>;
}

function obj(v: CanonicalValue, where: string): Record<string, CanonicalValue> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new LedgerRestoreError(`${where}: expected an object`);
  }
  return v as Record<string, CanonicalValue>;
}

function arr(v: CanonicalValue, where: string): readonly CanonicalValue[] {
  if (!Array.isArray(v)) throw new LedgerRestoreError(`${where}: expected an array`);
  return v as readonly CanonicalValue[];
}

function int(o: Record<string, CanonicalValue>, k: string, where: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw new LedgerRestoreError(`${where}.${k}: expected a safe integer, got ${typeof v}`);
  }
  return v;
}

function str(o: Record<string, CanonicalValue>, k: string, where: string): string {
  const v = o[k];
  if (typeof v !== 'string') throw new LedgerRestoreError(`${where}.${k}: expected a string`);
  return v;
}

function strOrNull(o: Record<string, CanonicalValue>, k: string, where: string): string | null {
  const v = o[k];
  if (v === null) return null;
  if (typeof v !== 'string') throw new LedgerRestoreError(`${where}.${k}: expected a string or null`);
  return v;
}

/** `[[good, qty], …]` in canonical id order, so the capture is stable. */
function movedQtyOut(moved: ReadonlyMap<GoodId, Qty>): CanonicalValue {
  return [...moved.entries()]
    .sort((a, b) => compareIds(a[0], b[0]))
    .map(([good, n]) => [good, n as number] as CanonicalValue);
}

function movedQtyIn(v: CanonicalValue, where: string): Map<GoodId, Qty> {
  const out = new Map<GoodId, Qty>();
  for (const [i, raw] of arr(v, where).entries()) {
    const pair = arr(raw, `${where}[${String(i)}]`);
    const good = pair[0];
    const n = pair[1];
    if (typeof good !== 'string' || typeof n !== 'number') {
      throw new LedgerRestoreError(`${where}[${String(i)}]: expected [good, qty]`);
    }
    out.set(good as GoodId, qty(n));
  }
  return out;
}

/**
 * The state table. `capture` is the hash input; `restore` is the abort path.
 *
 * Every number here is an integer by construction — the canonical serialiser throws
 * on a float, which is the property that makes a balance safe to hash at all.
 */
export function ledgerStateTable(
  read: () => Ledger,
  write: (restore: LedgerRestore) => void,
): StateTable {
  return {
    name: 'ledger',

    capture(): CanonicalValue {
      const l = read();
      const accounts = [...l.allAccounts()]
        .sort((a, b) => compareIds(a.id, b.id))
        .map((a) => ({
          id: a.id,
          kind: a.kind,
          principal: a.principal,
          name: a.name,
          ledger: a.ledger,
          // The number the whole game turns on, now inside the hash.
          balanceMinor: a.balanceMinor,
          movedQty: movedQtyOut(a.movedQty),
        }));

      const lots = [...l.allLots()]
        .sort((a, b) => compareIds(a.id, b.id))
        .map((lot) => ({
          id: lot.id,
          account: lot.account,
          good: lot.good,
          qty: lot.qty,
          location: lot.location,
          state: lot.state,
          encumbranceId: lot.encumbranceId,
          createdTick: lot.createdTick,
          origin: lot.origin,
        }));

      return {
        accounts,
        lots,
        // The open locks. Absent until now, which meant an aborted tick kept its
        // encumbrances, a snapshot restored a world whose escrow was spendable, and
        // two worlds with different escrow hashed the same. See
        // `EncumbranceBook.capture` for the four consequences and how they were found.
        encumbrances: l.encumbrances.capture(),
        // ★ D7's per-principal endowment counters (`RULES_VERSION` 19). In the hash
        // because they decide who may transfer currency, and a world where two
        // principals have spent differently is a different world — the same argument
        // that put `balanceMinor` here. Sorted by principal inside `all()`; only
        // principals that have retired currency have a row, so this is empty in a
        // world nobody has charged and bounded by the roll in every other.
        endowments: l.endowments.all().map((row) => ({
          principal: row.principal,
          remaining: row.remaining,
        })),
        // Append-only. Counted, not carried: the contents are already immutable and
        // re-listing them in every snapshot would make the hash input grow without
        // bound for no additional attestation.
        postingCount: l.allPostings().length,
        batchCount: l.allBatches().length,
      };
    },

    restore(captured: CanonicalValue): void {
      const root = obj(captured, 'ledger');

      const accounts: LedgerAccountRow[] = arr(root['accounts'] ?? [], 'ledger.accounts').map(
        (raw, i) => {
          const where = `ledger.accounts[${String(i)}]`;
          const o = obj(raw, where);
          return {
            id: str(o, 'id', where) as AccountId,
            kind: str(o, 'kind', where) as AccountKind,
            principal: strOrNull(o, 'principal', where) as PrincipalId | null,
            name: strOrNull(o, 'name', where),
            ledger: strOrNull(o, 'ledger', where) as ValueLedger | null,
            balanceMinor: minor(int(o, 'balanceMinor', where)),
            movedQty: movedQtyIn(o['movedQty'] ?? [], `${where}.movedQty`),
          };
        },
      );

      const lots: Lot[] = arr(root['lots'] ?? [], 'ledger.lots').map((raw, i) => {
        const where = `ledger.lots[${String(i)}]`;
        const o = obj(raw, where);
        return {
          id: str(o, 'id', where) as LotId,
          account: str(o, 'account', where) as AccountId,
          good: str(o, 'good', where) as GoodId,
          qty: qty(int(o, 'qty', where)),
          location: str(o, 'location', where) as SystemId,
          state: str(o, 'state', where) as LotState,
          encumbranceId: strOrNull(o, 'encumbranceId', where),
          createdTick: int(o, 'createdTick', where),
          origin: str(o, 'origin', where) as PrincipalId,
        };
      });

      const postingCount = int(root, 'postingCount', 'ledger');
      const batchCount = int(root, 'batchCount', 'ledger');
      if (postingCount < 0 || batchCount < 0) {
        throw new LedgerRestoreError('ledger: append-only lengths cannot be negative');
      }

      // The locks. Parsed strictly like everything else: a snapshot that cannot be
      // read is a refusal, never a silently empty book — an empty book here would be
      // exactly the A5′ failure this capture was added to prevent (escrowed stake
      // becoming spendable), and it would look like a clean restore.
      const encRoot = obj(root['encumbrances'] ?? { rows: [], exposure: [], perEvent: [] },
        'ledger.encumbrances');
      const encumbrances: EncumbranceCapture = {
        rows: arr(encRoot['rows'] ?? [], 'ledger.encumbrances.rows').map((raw, i) => {
          const where = `ledger.encumbrances.rows[${String(i)}]`;
          const o = obj(raw, where);
          return {
            id: str(o, 'id', where),
            principal: str(o, 'principal', where) as PrincipalId,
            account: str(o, 'account', where) as AccountId,
            amountMinor: minor(int(o, 'amountMinor', where)),
            obligationRef: str(o, 'obligationRef', where) as EncumbranceCapture['rows'][number]['obligationRef'],
            maxDirectLoss: minor(int(o, 'maxDirectLoss', where)),
            openedTick: int(o, 'openedTick', where),
            releasedAtTick: o['releasedAtTick'] === null ? null : int(o, 'releasedAtTick', where),
          };
        }),
        exposure: arr(encRoot['exposure'] ?? [], 'ledger.encumbrances.exposure').map((raw, i) => {
          const where = `ledger.encumbrances.exposure[${String(i)}]`;
          const pair = arr(raw, where);
          const who = pair[0];
          const amount = pair[1];
          if (typeof who !== 'string' || typeof amount !== 'number') {
            throw new LedgerRestoreError(`${where}: expected [principal, amount]`);
          }
          return [who as PrincipalId, minor(amount)] as const;
        }),
        perEvent: arr(encRoot['perEvent'] ?? [], 'ledger.encumbrances.perEvent').map((raw, i) => {
          const where = `ledger.encumbrances.perEvent[${String(i)}]`;
          const pair = arr(raw, where);
          const eventId = pair[0];
          const count = pair[1];
          if (typeof eventId !== 'string' || typeof count !== 'number') {
            throw new LedgerRestoreError(`${where}: expected [eventId, count]`);
          }
          return [eventId, count] as const;
        }),
      };

      // ── D7's counters ────────────────────────────────────────────────────────
      //
      // A MISSING key defaults to `[]`, which is not a silent empty book but the
      // MAXIMUM-WITHHOLDING state: every principal reverts to the full endowment
      // withheld, i.e. exactly the pre-19 behaviour, which costs buying power and
      // grants nothing. That is the opposite of `StandingBook`, where an empty book was
      // maximum permission and therefore had to throw. A key that is PRESENT and
      // malformed still throws — a capture we cannot read is a corrupt triple.
      const endowments: EndowmentRow[] = arr(root['endowments'] ?? [], 'ledger.endowments').map(
        (raw, i) => {
          const where = `ledger.endowments[${String(i)}]`;
          const o = obj(raw, where);
          return {
            principal: str(o, 'principal', where) as PrincipalId,
            remaining: minor(int(o, 'remaining', where)),
          };
        },
      );

      write({ accounts, lots, encumbrances, endowments, postingCount, batchCount });
    },
  };
}
