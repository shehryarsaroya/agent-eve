/**
 * Accounts — the four kinds, and the *named* faucets and sinks.
 *
 * The kinds match `account_kind` in `src/db/schema.sql` exactly
 * (`STORES · ESCROW · FAUCET · SINK`), because two spellings of an account kind
 * is scar #1 with money. STORES is the SPEC §3 word for assets; a principal's
 * body on the map is its HOLDING and never appears here.
 *
 * **Two ledgers, strictly separated** (SPEC §10.2). Currency is created only by
 * named faucets and destroyed only by named sinks; items are created by
 * extraction, transformed by production, and destroyed by loss. A faucet or sink
 * therefore declares which ledger it may touch, and the ledger refuses to mint
 * currency from a goods faucet. There are **exactly two** currency faucets and
 * nothing else may mint currency — that is a constitutional limit, so it is
 * expressed as a closed table rather than as a rule someone has to remember.
 */

import type { AccountId, GoodId, PrincipalId, VentureId } from '../core/types.js';
import { minor, type Minor, type Qty } from '../core/units.js';

export type AccountKind = 'STORES' | 'ESCROW' | 'FAUCET' | 'SINK';

/** Which of the two strictly separated ledgers a faucet or sink may touch. */
export type ValueLedger = 'CURRENCY' | 'GOODS';

export interface Account {
  readonly id: AccountId;
  readonly kind: AccountKind;
  /** STORES and ESCROW are owned; FAUCET and SINK are world-owned (schema.sql). */
  readonly principal: PrincipalId | null;
  /** FAUCET and SINK only: the published name, so every mint is attributable. */
  readonly name: string | null;
  /** FAUCET and SINK only. */
  readonly ledger: ValueLedger | null;
  /**
   * Currency, in minor units.
   *
   * For a world account (STORES, ESCROW) this is Σ of its currency postings and
   * nothing else — INV-7 recomputes it from `posting` and compares.
   *
   * For a FAUCET it runs **negative** by the amount it has issued, and for a
   * SINK positive by the amount it has retired. That sign convention is what
   * makes INV-2 pure arithmetic: Σ world balances ≡ issued − retired. INV-3
   * exempts faucets from the non-negative rule for exactly this reason.
   */
  balanceMinor: Minor;
  /**
   * FAUCET and SINK only: cumulative goods sourced (faucet) or destroyed (sink),
   * as a magnitude per good. Goods have no negative representation, so the
   * direction lives in the account kind rather than in the sign.
   */
  readonly movedQty: Map<GoodId, Qty>;
}

// ── Account id conventions ──────────────────────────────────────────────────
//
// Ids are content-derived, never counters: a counter has to be snapshotted or
// replay diverges (DET-3/DET-5), and there is nothing to snapshot here.

export function storesAccount(principal: PrincipalId): AccountId {
  return `stores:${principal}` as AccountId;
}

/**
 * A venture's escrow — A7's escrowed part lives here and auto-executes from here.
 * `schema.sql` requires an owning principal on ESCROW, so the funder is named.
 */
export function escrowAccount(venture: VentureId, funder: PrincipalId): AccountId {
  return `escrow:${venture}:${funder}` as AccountId;
}

// ── The named faucets ───────────────────────────────────────────────────────

/**
 * Currency faucets — **exactly two**, per SPEC §10.2. Nothing else may mint
 * currency. Adding a third is a constitutional change, not a code change.
 */
export const CURRENCY_FAUCET = {
  /** The constellation buys delivered Levy and published-deficit goods in a band. */
  CIVIC_PROCUREMENT: 'faucet:civic_procurement' as AccountId,
  /** Bound goods with a lifetime cap. Never transferable cash. */
  STARTER_STAKE: 'faucet:starter_stake' as AccountId,
} as const;

/** Goods sources. Items are created by extraction and transformed by production. */
export const GOODS_FAUCET = {
  EXTRACTION: 'faucet:extraction' as AccountId,
  PRODUCTION: 'faucet:production' as AccountId,
} as const;

/** Currency sinks — the four in SPEC §10.2. */
export const CURRENCY_SINK = {
  UPKEEP: 'sink:upkeep' as AccountId,
  FEES: 'sink:fees' as AccountId,
  SLOT_AUCTION: 'sink:slot_auction' as AccountId,
  RECOVERY: 'sink:recovery' as AccountId,
} as const;

/**
 * Goods sinks. `LOSS` is the one that carries the design: raids, fronts and
 * `CARGO_LOST` all charge it, which is why an encumbrance must never become a
 * shield (PROP-L3) — a shield would kill this sink and with it every reason
 * tomorrow's goods are scarce.
 */
export const GOODS_SINK = {
  LOSS: 'sink:loss' as AccountId,
  /** A hand's consumable per venture, and a holding's upkeep good. */
  CONSUMPTION: 'sink:consumption' as AccountId,
  /** Recipe inputs, transformed rather than lost. */
  PRODUCTION_INPUT: 'sink:production_input' as AccountId,
} as const;

export interface NamedSupplyAccount {
  readonly id: AccountId;
  readonly kind: Extract<AccountKind, 'FAUCET' | 'SINK'>;
  readonly ledger: ValueLedger;
  readonly name: string;
}

function named(
  id: AccountId,
  kind: 'FAUCET' | 'SINK',
  ledger: ValueLedger,
  name: string,
): NamedSupplyAccount {
  return { id, kind, ledger, name };
}

/**
 * The closed set of accounts that may change supply. `Ledger` opens all of them
 * at construction and refuses an ISSUE or RETIRE against anything not in here,
 * so "named faucet/sink" in INV-1 is enforced rather than intended.
 */
export const NAMED_SUPPLY_ACCOUNTS: readonly NamedSupplyAccount[] = [
  named(CURRENCY_FAUCET.CIVIC_PROCUREMENT, 'FAUCET', 'CURRENCY', 'civic procurement'),
  named(CURRENCY_FAUCET.STARTER_STAKE, 'FAUCET', 'CURRENCY', 'starter stake'),
  named(GOODS_FAUCET.EXTRACTION, 'FAUCET', 'GOODS', 'extraction'),
  named(GOODS_FAUCET.PRODUCTION, 'FAUCET', 'GOODS', 'production'),
  named(CURRENCY_SINK.UPKEEP, 'SINK', 'CURRENCY', 'holding upkeep'),
  named(CURRENCY_SINK.FEES, 'SINK', 'CURRENCY', 'market and clearing fees'),
  named(CURRENCY_SINK.SLOT_AUCTION, 'SINK', 'CURRENCY', 'slot auction'),
  named(CURRENCY_SINK.RECOVERY, 'SINK', 'CURRENCY', 'recovery'),
  named(GOODS_SINK.LOSS, 'SINK', 'GOODS', 'loss'),
  named(GOODS_SINK.CONSUMPTION, 'SINK', 'GOODS', 'consumption'),
  named(GOODS_SINK.PRODUCTION_INPUT, 'SINK', 'GOODS', 'production inputs'),
];

/** Value held here counts toward supply. Faucets and sinks are outside the world. */
export function isWorldAccount(kind: AccountKind): boolean {
  return kind === 'STORES' || kind === 'ESCROW';
}

export function newAccount(
  id: AccountId,
  kind: AccountKind,
  principal: PrincipalId | null,
  name: string | null,
  ledger: ValueLedger | null,
): Account {
  return { id, kind, principal, name, ledger, balanceMinor: minor(0), movedQty: new Map() };
}
