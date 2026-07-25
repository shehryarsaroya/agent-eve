/**
 * `RECONCILE` and `RELEASE` — the last two steps of §15.3's sequence, as checks.
 *
 * > ... receipts, standing, unlock -> **reconcile** -> **release**. — §15.3
 *
 * ## Why these are checks and not work
 *
 * `settleBatch` performs the escrowed parts, the elective parts, the cascade, the split
 * waterfall, the encumbrance unlock and the presence release **in one call**, in that
 * order, because there is exactly one settlement implementation (PROP-V7) and splitting
 * it across the driver's stages would mean writing a second one. So the stages after it
 * verify its output rather than performing their own step, and this file is what they
 * run. Every function here returns faults; the driver turns them into a halt.
 *
 * That is not a formality. Each check below is the post-condition of a step that
 * `settleBatch` takes on its own, and every one of them has a named failure that is
 * invisible from inside the settlement:
 *
 *   - **an escrow with money still in it** means a unit entered the pot and never left,
 *     which INV-2 will report as conserved (it is still in an account) while the
 *     venture it belonged to is closed forever. Escrow conservation is exact by
 *     construction — "every unit that entered leaves" — so a non-zero balance is a
 *     silent imbalance in the one direction an append-only ledger cannot undo.
 *   - **an obligation still live in the obligation book** turns every one of its locks
 *     into an orphan at the *next* tick's INV-4, which reads as a ledger fault a
 *     Reckoning later and points nowhere near this settlement.
 *   - **a hand still indexed to a resolved venture** is INV-9's halt on the next tick,
 *     and it is also E2E-13's denial-of-settlement: a rival that can leave a competitor's
 *     hand pinned to a closed obligation has taken its presence for free.
 *   - **a deferral that recorded a breach** is the engine-fabricated default §15.3
 *     names, asserted here over the whole batch rather than per venture.
 */

import type { Ledger, ObligationBook } from '../ledger/index.js';
import { compareIds } from '../ledger/index.js';
import {
  checkSettlementExact,
  type SettlementAccounts,
  type VentureBook,
  type VentureSettlement,
} from '../venture/index.js';
import type { SettlementReceipt } from './receipts.js';
import type { FrozenReckoning } from './set.js';

/**
 * Has this obligation finished? `DEFERRED` has **not** (§15.3: the obligation returns
 * next Reckoning), which is the whole distinction the deferral rests on — so the
 * predicate lives here, once, and the driver imports it rather than keeping a second
 * set of the same two words.
 */
export function isTerminalState(state: VentureSettlement['terminalState']): boolean {
  return state === 'SETTLED' || state === 'DEFAULTED';
}

export interface ReconcileInput {
  readonly frozen: FrozenReckoning;
  readonly ledger: Ledger;
  readonly book: VentureBook;
  readonly accounts: SettlementAccounts;
  readonly obligations: ObligationBook;
  readonly settlements: readonly VentureSettlement[];
  readonly receipts: readonly SettlementReceipt[];
  readonly tick: number;
}

/** §15.3's `reconcile`. Faults, in a stable order, or empty. */
export function reconcileFaults(input: ReconcileInput): readonly string[] {
  const faults: string[] = [];
  const byVenture = new Map(input.settlements.map((s) => [s.venture, s]));

  for (const o of input.frozen.obligations) {
    const settlement = byVenture.get(o.venture);
    if (settlement === undefined) {
      faults.push(
        `${o.venture} was in the frozen settlement set and produced no settlement; an obligation the ` +
          'Reckoning skipped is a promise the world dropped in silence',
      );
      continue;
    }
    const venture = input.book.get(o.venture);
    if (venture === undefined) {
      faults.push(`${o.venture} is no longer in the book after settling`);
      continue;
    }

    if (venture.state !== settlement.terminalState) {
      faults.push(
        `${o.venture} settled as ${settlement.terminalState} but its row says ${venture.state}; the ` +
          'receipt and the state table must agree about what happened',
      );
    }

    // Escrow conservation. Exact by construction, so anything left is a unit that
    // entered the pot and never came out.
    const escrow = input.accounts.escrowOf(venture);
    const left = input.ledger.account(escrow) === undefined ? 0 : input.ledger.balance(escrow);
    if (left !== 0) {
      faults.push(
        `${o.venture}: escrow ${escrow} still holds ${left} after settling. Every unit that entered the ` +
          'pot leaves it — the escrowed parts to their roles and the remainder home — so a balance here ' +
          'is value stranded in a closed obligation',
      );
    }

    const stillLive = input.obligations.isLive(o.venture);
    if (isTerminalState(settlement.terminalState) && stillLive) {
      faults.push(
        `${o.venture} resolved ${settlement.terminalState} but is still live in the obligation book; its ` +
          'locks become orphans at the next INV-4 pass',
      );
    }
    if (settlement.terminalState === 'DEFERRED' && !stillLive) {
      faults.push(
        `${o.venture} deferred but was closed in the obligation book; a deferral carries the obligation ` +
          'to the next Reckoning, so closing it drops the promise',
      );
    }

    // §15.3, over the batch rather than per venture: an obligation unresolved at the
    // round limit DEFERS and **never defaults**.
    if (settlement.terminalState === 'DEFERRED') {
      if (settlement.defaults.length > 0) {
        faults.push(
          `${o.venture} deferred and recorded ${settlement.defaults.length} default(s); a truncated ` +
            'cascade recording a breach is an engine-fabricated default',
        );
      }
      if (settlement.standing.length > 0) {
        faults.push(`${o.venture} deferred and moved standing; a deferral is not an outcome yet`);
      }
    }

    faults.push(
      ...checkSettlementExact(settlement, input.tick).map((v) => `${v.id}: ${v.message}`),
    );
  }

  // The record and the report must agree about how many accusations were published.
  const reported = input.settlements.reduce((n, s) => n + s.defaults.length, 0);
  const published = input.receipts.reduce((n, r) => n + r.defaults.length, 0);
  if (reported !== published) {
    faults.push(
      `the settlement reported ${reported} default(s) and the record carries ${published}; a default in ` +
        'one and not the other is an accusation nobody can audit',
    );
  }

  return faults;
}

/**
 * §15.3's `release` — presence and locks are genuinely back.
 *
 * The hand half is E2E-13's second clause. A deferral releases the hand even though the
 * obligation carries over, "or a rival can construct a deferral loop to pin a
 * competitor's hands", so this check makes no exception for `DEFERRED`.
 */
export function releaseFaults(input: {
  readonly frozen: FrozenReckoning;
  readonly ledger: Ledger;
  readonly book: VentureBook;
  readonly settlements: readonly VentureSettlement[];
}): readonly string[] {
  const faults: string[] = [];
  const resolved = new Set<string>(input.settlements.map((s) => s.venture));

  for (const o of input.frozen.obligations) {
    const venture = input.book.get(o.venture);
    if (venture === undefined) continue;
    for (const role of venture.roles) {
      if (role.filledByHandId === null) continue;
      const commitment = input.book.commitmentOf(role.filledByHandId);
      if (commitment !== null && commitment.venture === o.venture) {
        faults.push(
          `${o.venture} resolved ${venture.state} but hand ${role.filledByHandId} is still committed to ` +
            `role ${commitment.roleIndex} of it; a resolved venture releases presence, or a deferral loop ` +
            "becomes a way to pin a competitor's hands",
        );
      }
      if (role.stakeEncumbranceId !== null) {
        faults.push(
          `${o.venture} role ${role.index} still names stake lock ${role.stakeEncumbranceId} after ` +
            'settling; a lock nobody remembers releasing is an orphan waiting (INV-4)',
        );
      }
    }
  }

  for (const enc of [...input.ledger.encumbrances.open()].sort((a, b) => compareIds(a.id, b.id))) {
    if (!resolved.has(enc.obligationRef)) continue;
    faults.push(
      `encumbrance ${enc.id} is still open against ${enc.obligationRef}, which resolved this Reckoning; ` +
        'the obligation carries over on a deferral but the lock never does',
    );
  }

  return faults;
}
