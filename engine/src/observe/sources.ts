/**
 * What `observe` reads — the input port, and the modules it is waiting for.
 *
 * ## Why this is a port and not a set of imports
 *
 * The observation is a **projection of state tables** (§15.1: "State tables (agent
 * `observe`)"), and three of the tables it projects do not exist yet: the Levy, the
 * market, and the hosted negotiation channel. The choice was between stubbing them
 * inside this module — inventing a Levy formula in the observation layer, which is
 * where a rule goes to be duplicated — and naming the shape they must supply.
 *
 * Naming the shape has two properties the stub does not: the field names here are
 * the ones `agent.md` §6 already promises (`levy{my_assessment, paid,
 * deliverable_to, shortfall_if_unpaid, ballot}`, `exposure{mine,
 * constellation_band}`), so the module that fills them has no naming latitude and
 * cannot drift from the promise; and an absent source is `null` rather than a
 * fabricated zero, so an agent can tell "no assessment yet" from "assessed at
 * nothing".
 *
 * ## The one thing this module refuses to take as input
 *
 * There is no `affordances` field and no `briefing` field. Both are *computed*
 * here, from the tables, because both are honesty guarantees: an affordance whose
 * `max_direct_loss` arrived from a caller is a worst case nobody checked, and a
 * `briefing.if_you_do_nothing` supplied from outside is a prediction with no test
 * behind it. PROP-O4 and PROP-O5 are only testable if this module owns them.
 *
 * ## `serverNowMs`, and why it is not read from the clock here
 *
 * `Date.now` is banned (DET-7) and the sanctioned reader is the tick scheduler
 * (`src/core/time.ts`). So wall time arrives as a number the caller took from an
 * injected {@link import('../core/time.js').Clock}, once, for the whole
 * observation. One read per observation is also what keeps countdowns monotonic:
 * scar #14d was a countdown "derived per-request from server time", and two clock
 * reads inside one payload is that bug in miniature.
 */

import type {
  GoodId,
  Grant,
  Handle,
  PrincipalId,
  Standing,
  SystemId,
  VentureId,
  WorldStatus,
} from '../core/types.js';
import type { Minor, Qty } from '../core/units.js';
import type { Ledger } from '../ledger/index.js';
import { storesAccount } from '../ledger/index.js';
import type { VentureRecord } from '../venture/index.js';
import type { WorldState } from '../world/index.js';
import type { SensingIndex } from './sensing.js';

/**
 * A principal's own value, read-only.
 *
 * Narrow because the observation must not be able to move value, and a `Ledger`
 * handle can. {@link storesReadOf} is the real adapter and is what production uses;
 * a fixture can supply the three numbers directly.
 */
export interface StoresRead {
  /** Free currency — balance less encumbrances. What an affordance can actually spend. */
  freeMinor(principal: PrincipalId): Minor;
  /** EXPOSURE: Σ open `max_direct_loss`, and nothing else (§3). */
  exposureMinor(principal: PrincipalId): Minor;
  /** Goods on hand, in the account tree. Cargo on a hand is the world's, not this. */
  goods(principal: PrincipalId): ReadonlyMap<GoodId, Qty>;
  /**
   * What one open lock holds, or `null` if there is no such lock.
   *
   * Needed because `withdraw` forfeits a stake (§7.3) and `max_direct_loss` on that
   * affordance has to be the *actual* locked amount, not the amount somebody
   * remembers locking.
   */
  lockedMinor(encumbranceId: string): Minor | null;
}

/**
 * The real adapter. Reads the cached EXPOSURE rather than recomputing it, because
 * INV-5 asserts the cache is right and the affordance layer must read the same
 * number the invariant checks — two homes for EXPOSURE would mean an agent was
 * shown a figure nothing verified.
 */
export function storesReadOf(ledger: Ledger): StoresRead {
  return {
    freeMinor: (principal) => ledger.freeBalance(storesAccount(principal)),
    exposureMinor: (principal) => ledger.encumbrances.cachedExposure(principal),
    goods: (principal) => ledger.goodsInAccount(storesAccount(principal)),
    lockedMinor: (id) => ledger.encumbrances.get(id)?.amountMinor ?? null,
  };
}

/**
 * The mark price of a good, or `null` when the book is too thin to price it.
 *
 * A separate port from {@link StoresRead} because valuing a good is the ledger's
 * `valueGood` — a windowed, related-party-filtered, haircut-aware rule — and an
 * observation must never carry a second opinion about what something is worth.
 * `null` is load-bearing: `valueGood` returns `THIN_BOOK` rather than pricing off
 * the only visible trade, and an affordance whose worst case depends on an unpriced
 * good is **withheld** rather than published with a guess (PROP-O4).
 */
export type MarkPriceRead = (good: GoodId) => Minor | null;

/** Nothing is priced. The honest default before a market exists. */
export const noMarks: MarkPriceRead = () => null;

/**
 * §13B's owner mandate. **Disposition, never control**: "no owner action moves a
 * piece". It is stable text rather than per-tick state, so it is a free read with
 * `header.mandate_version` announcing a change (§12.1) — shipping a page of prose
 * on all 16 wakes a day is waste an owner pays for.
 */
export interface MandateRead {
  readonly version: number;
  /** One page. Advice the agent may disregard, and it is told so. */
  readonly text: string;
}

/**
 * The Levy block, in `agent.md` §6's own field names.
 *
 * Supplied whole and passed through unaltered. This module deliberately computes
 * none of it: §5.2's allocation is a constellation vote with a published
 * inverse-Exposure fallback, and a second implementation of that arithmetic in a
 * read surface is how the number an agent is shown stops matching the number it is
 * charged.
 */
export interface LevyBlock {
  readonly my_assessment: Minor;
  readonly paid: Minor;
  /** Payable only in goods physically delivered to a named place (§5.2). */
  readonly deliverable_to: SystemId;
  readonly shortfall_if_unpaid: Minor;
  /** The allocation ballot, while it is open. */
  readonly ballot: BallotRef | null;
  /**
   * The share that cannot be escrowed and must be carried by a hand (§5.2). Named
   * so an agent can see that presence, not money, is what discharges it.
   */
  readonly non_escrowable: Minor;
}

export interface BallotRef {
  readonly id: string;
  /**
   * `LEVY`, `SEIZURE` or `SYNDICATE` (§12.2: "one verb, three ballots").
   *
   * Typed as `string`, not as a union, and the reason is §3 rather than laziness: a
   * `BallotKind` union would need a `'LEVY'` member, and `LEVY` is both a canon term
   * and a `VentureKind`. `test/core/vocabulary-repo.test.ts` keys its allowlist on
   * `Union.MEMBER` pairs, so declaring that union means editing the guard's
   * allowlist — which is the one edit that must be argued in review rather than made
   * in passing. `world/commons.ts` reached the same conclusion and kept
   * `SEIZURE_BALLOT` as a bare const.
   */
  readonly kind: string;
  readonly closes_tick: number;
  /** Whether this principal has already voted. A ballot voted is not an affordance. */
  readonly voted: boolean;
  /**
   * What a `SEIZURE` ballot is aimed at — a principal, holding or system id.
   *
   * `null` on the two ballots that take nothing. A seizure with a `null` target is
   * **withheld**, not offered: `world/commons.ts` refuses a hostile act whose target
   * it cannot resolve, and a vote is where the Commons floor has to hold as firmly as
   * a raid does.
   */
  readonly target: string | null;
}

/**
 * One row of the local order book: best bid/ask and depth at two quantity bands
 * (§12.1, "local book only").
 *
 * Aggregate by construction — no principal, no order id, no per-hand quantity. That
 * is PROP-VI2's market clause: cargo contents are `SENSED`, and a book that
 * resolved to individual holdings would let an ambusher read a manifest off the
 * depth ladder without ever scouting.
 */
export interface BookRow {
  readonly system: SystemId;
  readonly good: GoodId;
  readonly best_bid: Minor | null;
  readonly best_ask: Minor | null;
  /** Exactly two bands, small then large. Quantities are the published band sizes. */
  readonly depth: readonly BookBand[];
}

export interface BookBand {
  readonly qty: Qty;
  readonly bid: Minor | null;
  readonly ask: Minor | null;
}

/**
 * §7.3's hosted negotiation, as it appears in `ventures.talks[]`.
 *
 * Counts and ticks, never message bodies. Two reasons: the bodies are `PARTIES`
 * tier and declassify at settlement (§11.2), so they belong to the feed and the
 * receipt reel rather than to a per-wake payload; and `agent.md` §4 promises
 * "messages arrive inside an observation you were already fetching — **they never
 * wake you up**", which only stays true if a talk row is cheap.
 */
export interface TalkRow {
  readonly venture: VentureId;
  readonly counterparty: PrincipalId;
  readonly unread: number;
  readonly last_tick: number;
}

/**
 * A grant template an agent may issue against (§8). Empty until the office module
 * ships; present so `grant` is a real affordance with a real worst case rather than
 * a verb an agent has to guess the shape of.
 */
export interface GrantTemplate {
  readonly template: string;
  readonly max_direct_loss: Minor;
  readonly max_contingent_liability: Minor;
  readonly expires_tick: number;
}

/** Everything `observe` reads, for one tick. Frozen by the caller; never mutated here. */
export interface ObserveSources {
  readonly tick: number;
  /** One wall-clock read per observation, from an injected Clock. Never `Date.now`. */
  readonly serverNowMs: number;
  readonly stateVersion: number;
  /** `PAUSED` means the last tick aborted; no affordance is honest (E2E-30). */
  readonly status: WorldStatus;
  /** INV-15: pinned into every quote this observation publishes. */
  readonly rulesVersion: number;

  readonly world: WorldState;
  readonly stores: StoresRead;
  readonly markPriceOf: MarkPriceRead;
  /** Every venture this principal could be shown. Filtered by eligibility here. */
  readonly ventures: readonly VentureRecord[];
  readonly grants: readonly Grant[];
  readonly grantTemplates: readonly GrantTemplate[];

  /**
   * The public standing row, or `null` when we hold none.
   *
   * `null` is a real answer and is counted as a `NO_RECORD` omission rather than
   * flattened to zeros: a fabricated all-zero standing reads as "clean record",
   * which is a claim about a real agent that nothing supports.
   */
  standingOf(principal: PrincipalId): Standing | null;
  handleOf(principal: PrincipalId): Handle | null;

  readonly actionsRemaining: number;
  readonly wakesRemaining: number;
  /**
   * Is this fetch inside one of the day's 16 wakes (§12.4)?
   *
   * The caller decides, because only it knows whether a wake was offered and
   * whether this observation is the one being answered. What this module guarantees
   * is what happens when it is `false`: the cached snapshot, no fresh affordances,
   * no new `quote_id`.
   */
  readonly isWake: boolean;

  readonly mandate: MandateRead | null;
  readonly levy: LevyBlock | null;
  readonly market: readonly BookRow[];
  readonly talks: readonly TalkRow[];
  readonly ballots: readonly BallotRef[];
  readonly sensing: SensingIndex;
  /**
   * Roles that already carry a seal this Reckoning, keyed
   * `${ventureId}::${roleIndex}`.
   *
   * `::`, never a NUL byte: a NUL in a key makes `file(1)` report the source as
   * `data`, and grep — including the outbound secret scan — silently skips the file
   * while every gate stays green.
   */
  readonly sealedRoles: ReadonlySet<string>;
}

/** The seal key, in one place, so the API layer and this module cannot disagree. */
export function roleSealKey(venture: VentureId, roleIndex: number): string {
  return `${venture}::${String(roleIndex)}`;
}
