/**
 * The `WAKE` phase and the `wake_offer` table.
 *
 * §15.1 names two tables "the design requires and nobody named": `wake_offer` and
 * `observation_fetch`, "without which §5.1's wake guarantee is unenforceable."
 * This is the first of the two. The second belongs to the API layer, because only
 * it knows whether an observation was actually fetched.
 *
 * §5.1's guarantee, in full, because both halves matter: "Every party to a
 * resolving item is **offered one wake** before it (logged); **after one offer it
 * resolves regardless** — otherwise going offline defers settlement forever."
 *
 * So the table records offers, not attendance, and it enforces *exactly one* offer
 * per `(principal, item)`. A second offer would be a settlement waiting twice,
 * and an agent that never answered could hold a Reckoning hostage — which is the
 * failure mode A14 exists to prevent.
 *
 * The wake budget is A4 for cognition (§12.4): without it, an owner running a
 * bigger model at 40 wakes a day and camping the pre-Reckoning window buys a
 * strictly larger information set for ~19× the spend. `WAKES_PER_RECKONING` is the
 * cap and it is per principal per Reckoning, so it resets on the horizon it is
 * named for and never accumulates.
 */

import type { CanonicalValue } from '../core/canonical.js';
import { reckoningIndex, WAKES_PER_RECKONING } from '../core/time.js';
import type { PrincipalId } from '../core/types.js';
import { compareIds } from '../ledger/index.js';
import { readArray, readInt, readObject, type StateTable } from './snapshot.js';

/**
 * Why a wake was offered. §12.4's list: "venture formed, filled, or failed · hand
 * arrival · threat · limits breach · Levy assessment · settlement · Reckoning.
 * **Never on unchanged state.**"
 *
 * A free-text reason would be a rules surface nobody could golden-file, so the set
 * is closed and every member maps to one of §12.4's causes.
 */
export type WakeCause =
  | 'ARRIVAL'
  | 'VENTURE'
  | 'THREAT'
  | 'LIMITS'
  | 'ASSESSMENT'
  | 'SETTLEMENT'
  | 'RECKONING';

export interface WakeOffer {
  readonly principal: PrincipalId;
  readonly tick: number;
  readonly cause: WakeCause;
  /**
   * The thing that is about to resolve, so "exactly one offer per resolving item"
   * is checkable. `null` for causes that are not tied to one item (a Reckoning).
   */
  readonly item: string | null;
}

export type WakeOutcome =
  /** Offered and logged. */
  | { readonly granted: true; readonly offer: WakeOffer }
  /** Refused, with the reason. `ALREADY_OFFERED` is the §5.1 guarantee working. */
  | { readonly granted: false; readonly why: 'ALREADY_OFFERED' | 'BUDGET_SPENT' };

export class WakeBook {
  /** Offers this Reckoning, per principal. Reset on the Reckoning boundary. */
  private readonly spent = new Map<PrincipalId, number>();
  /** `(principal, item)` pairs already offered. Reset with the budget. */
  private readonly offered = new Set<string>();
  private reckoning = -1;
  private readonly log: WakeOffer[] = [];

  constructor(
    readonly perReckoning: number = WAKES_PER_RECKONING,
    /**
     * Offers retained in memory. Bounded (scar #3, INV-26): the durable copy is
     * the `wake_offer` table, and this mirror only has to serve the current
     * Reckoning's audit.
     */
    readonly retained: number = WAKES_PER_RECKONING * 64,
  ) {}

  /**
   * Roll the budget if this tick begins a new Reckoning.
   *
   * Called at the start of `WAKE`, never lazily on read: a budget that rolled on
   * first *use* would give an agent that acted early in a Reckoning a different
   * allowance from one that acted late, which is A4 through a side door.
   */
  private rollTo(tick: number): void {
    const r = reckoningIndex(tick);
    if (r === this.reckoning) return;
    this.reckoning = r;
    this.spent.clear();
    this.offered.clear();
  }

  offer(principal: PrincipalId, tick: number, cause: WakeCause, item: string | null): WakeOutcome {
    this.rollTo(tick);

    // Both refusals are decided *before* either book is written. Marking the item
    // offered first — as the first draft did — recorded an offer that was then refused
    // for budget: `captureState().offered` claimed a party had been woken about an
    // item it was never told about, while `offers()` had no row for it, and §5.1's
    // "after one offer it resolves regardless" would then settle against a party on
    // the strength of an offer that never happened.
    const key = item === null ? null : `${principal} ${item}`;
    if (key !== null && this.offered.has(key)) return { granted: false, why: 'ALREADY_OFFERED' };
    const used = this.spent.get(principal) ?? 0;
    if (used >= this.perReckoning) return { granted: false, why: 'BUDGET_SPENT' };
    if (key !== null) this.offered.add(key);
    this.spent.set(principal, used + 1);

    const offer: WakeOffer = { principal, tick, cause, item };
    this.log.push(offer);
    while (this.log.length > this.retained) this.log.shift();
    return { granted: true, offer };
  }

  remaining(principal: PrincipalId, tick: number): number {
    if (reckoningIndex(tick) !== this.reckoning) return this.perReckoning;
    return Math.max(0, this.perReckoning - (this.spent.get(principal) ?? 0));
  }

  /** Offers logged this Reckoning, in canonical order. The audit surface. */
  offers(): readonly WakeOffer[] {
    return [...this.log].sort((a, b) => {
      if (a.tick !== b.tick) return a.tick - b.tick;
      const byPrincipal = compareIds(a.principal, b.principal);
      if (byPrincipal !== 0) return byPrincipal;
      return compareIds(a.item ?? '', b.item ?? '');
    });
  }

  get offerCount(): number {
    return this.log.length;
  }

  /** The budget and the one-offer-per-item set, for the snapshot. */
  captureState(): CanonicalValue {
    return {
      reckoning: this.reckoning,
      spent: [...this.spent.entries()]
        .sort((a, b) => compareIds(a[0], b[0]))
        .map(([p, n]) => [p, n] as CanonicalValue),
      offered: [...this.offered].sort((a, b) => compareIds(a, b)),
    };
  }

  restoreState(captured: CanonicalValue): void {
    const root = readObject(captured, 'wake');
    this.reckoning = readInt(root, 'reckoning', 'wake');
    this.spent.clear();
    for (const [i, entry] of readArray(root['spent'] ?? [], 'wake.spent').entries()) {
      const pair = readArray(entry, `wake.spent[${String(i)}]`);
      const principal = pair[0];
      const count = pair[1];
      if (typeof principal !== 'string' || typeof count !== 'number') {
        throw new Error(`wake.spent[${String(i)}]: expected [principal, count]`);
      }
      this.spent.set(principal as PrincipalId, count);
    }
    this.offered.clear();
    for (const [i, key] of readArray(root['offered'] ?? [], 'wake.offered').entries()) {
      if (typeof key !== 'string') throw new Error(`wake.offered[${String(i)}]: expected a string`);
      this.offered.add(key);
    }
    // The offer log is an audit mirror, not state: it is dropped rather than
    // restored, because the durable `wake_offer` table is the record and a
    // rebuilt in-memory log would be a second home for it (scar #5).
    this.log.length = 0;
  }
}

/**
 * The wake budget as a capture/restore pair.
 *
 * **Not registered in `state_hash`, and it cannot be.** DERIVE computes the hash and
 * ASSERT checks what DERIVE hashed; `WAKE` is the last phase, so nothing it writes
 * can be inside the hash for the tick it wrote in. Including this table anyway would
 * produce a snapshot that claimed to be complete while missing the last phase's
 * writes — a *worse* failure than leaving it out, because it would look complete.
 *
 * So `wake_offer` is a journal table in §15.1's sense (it is named there beside
 * `event`), and this pair exists for the persistence layer that captures and
 * restores it at its own boundary. What that layer owes: after a restart, the
 * `(principal, item)` set must be back, or §5.1's "offered exactly one wake" becomes
 * "offered one wake per restart".
 */
export function wakeStateTable(book: WakeBook): StateTable {
  return {
    name: 'wake',
    capture: (): CanonicalValue => book.captureState(),
    restore: (captured: CanonicalValue): void => {
      book.restoreState(captured);
    },
  };
}
