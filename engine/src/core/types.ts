/**
 * The shared vocabulary, in code.
 *
 * SPEC §3 is a **rules surface, not a style guide**: no word may name two
 * concepts, anywhere — not in docs, not in field names, not in affordance
 * strings, not in `agent.md`. High Water's worst bug survived a full build and
 * three critic passes because the engine and the agent-facing text disagreed
 * about one word (scar #1). Every name here matches §3 exactly. If you need a
 * new concept, add a word to §3 first and remove one, because §17's budget is
 * at its ceiling.
 */

import type { Minor, Qty, Bps } from './units.js';

// ── Identity ────────────────────────────────────────────────────────────────

/** The permanent identity — the player. Never a person; that is an OWNER. */
export type PrincipalId = string & { readonly __brand: 'PrincipalId' };
/** One unit of simultaneous physical presence. Never divisible labour. */
export type HandId = string & { readonly __brand: 'HandId' };
/** Your named body on the map. Never your assets; those are STORES. */
export type HoldingId = string & { readonly __brand: 'HoldingId' };
export type SystemId = string & { readonly __brand: 'SystemId' };
export type ConstellationId = string & { readonly __brand: 'ConstellationId' };
export type VentureId = string & { readonly __brand: 'VentureId' };
export type GrantId = string & { readonly __brand: 'GrantId' };
export type OfficeId = string & { readonly __brand: 'OfficeId' };
export type EventId = string & { readonly __brand: 'EventId' };
export type AccountId = string & { readonly __brand: 'AccountId' };
export type SealId = string & { readonly __brand: 'SealId' };
export type BallotId = string & { readonly __brand: 'BallotId' };
export type MessageId = string & { readonly __brand: 'MessageId' };
export type GoodId = string & { readonly __brand: 'GoodId' };

/** `handle@agenttransfer.dev` — the name *is* the address (SPEC §15.7). */
export type Handle = string & { readonly __brand: 'Handle' };

// ── Visibility ──────────────────────────────────────────────────────────────

/**
 * One five-tier ladder, used everywhere (SPEC §11.2). There is no separate
 * venture-visibility enum and no second spelling of any tier.
 *
 * The split that carries the design: movement on public lanes is PUBLIC,
 * because a convoy is the map's motion and the map is the show — while cargo
 * contents and hold values are only SENSED. *A ship at sea is visible; its
 * manifest is not.*
 */
export type Visibility = 'PUBLIC' | 'PARTIES' | 'SENSED' | 'SEALED' | 'PRIVATE';

/** Where a decision came from. Without this, R3, R4 and the A4 audit are unmeasurable. */
export type DecisionSource = 'LIVE' | 'INTENT' | 'DELEGATE' | 'HEURISTIC' | 'FALLBACK';

/** Authoritative fact vs. counterparty assertion vs. model estimate (SPEC §11.3). */
export type ProvenanceClass = 'FACT' | 'ASSERTION' | 'ESTIMATE';

// ── The world ───────────────────────────────────────────────────────────────

/** SPEC §4. The Commons is a permanent floor, not a timer (A8). */
export type ZoneTier = 'COMMONS' | 'MARCHES' | 'FRONTIER';

export interface StarSystem {
  readonly id: SystemId;
  readonly constellation: ConstellationId;
  readonly name: string;
  readonly tier: ZoneTier;
  /** Adjacency. Transit cost in ticks lives on the lane, not the system. */
  readonly lanes: readonly SystemId[];
}

// ── Hands ───────────────────────────────────────────────────────────────────

/**
 * Hands are rows, not counts, and are **never destroyed** — a lost hand goes
 * RECOVERING (INV-8). Permanent loss would cripple an unlucky agent in the one
 * dimension gating all play. Commitment lives *only* in
 * `venture_role.filled_by_hand_id`; storing it here too would be scar #5 on the
 * keystone.
 */
export type HandState = 'IDLE' | 'IN_TRANSIT' | 'COMMITTED' | 'RECOVERING';

export interface Hand {
  readonly id: HandId;
  readonly principal: PrincipalId;
  state: HandState;
  /** Where it is. During transit this is the origin until arrival resolves. */
  location: SystemId;
  destination: SystemId | null;
  /** Tick at which transit completes, or recovery ends. */
  freeAtTick: number | null;
  cargo: ReadonlyMap<GoodId, Qty>;
}

// ── The venture ─────────────────────────────────────────────────────────────

/** SPEC §7. ≤8 kinds is a §17 budget; adding one means removing one. */
export type VentureKind = 'HAUL' | 'DIG' | 'ESCORT' | 'RAID' | 'BUILD' | 'SURVEY' | 'SIEGE' | 'LEVY';

export type VentureState = 'FORMING' | 'LIVE' | 'SETTLED' | 'DEFAULTED' | 'ABANDONED' | 'DEFERRED';

// ── Predation ───────────────────────────────────────────────────────────────

/**
 * A raid's life (SPEC §9). One live state and four terminal ones.
 *
 * Declared here rather than in `src/predation/` because **two** rules surfaces need it
 * — the book and the frame's raid line — and §3 is a rules surface: the same five words
 * declared twice would be one pixel signature described in two places, and the two would
 * drift the first time an outcome was added. This is the same argument that puts
 * `VentureState` and `HandState` here.
 *
 * `PLUNDERED` rather than `SEIZED` or `TAKEN`: `seizure` already names §14.4's ballot
 * and `Ledger.seizeCurrency`, and one word may not carry a second concept.
 *
 * `MISSED` is the outcome §11.2's `SENSED` cargo tier exists to make possible — the raid
 * demanded and found nothing worth taking, because it never knew what was there.
 */
export type RaidState = 'DEMANDED' | 'PAID' | 'REPULSED' | 'PLUNDERED' | 'MISSED';

/**
 * A7's two halves. The escrowed part auto-executes at settlement; the elective
 * part **never** does. Full escrow deletes the betrayal; zero escrow enables
 * fake counterparties — so `elective` has a floor rising with venture value,
 * and top kinds are un-escrowable (PROP-V5).
 *
 * `wage` and `share` are **never both set** (PROP-V2). One polymorphic field
 * carrying a senior fixed claim and a junior residual claim is scar #1 with
 * money, permanence and an audience — and the ledger would record the broken
 * promise as *honoured*.
 */
export interface RoleTerms {
  /** A senior fixed claim, paid before any residual. Mutually exclusive with `share`. */
  readonly wage: Minor | null;
  /** A junior residual claim in bps of proceeds. Mutually exclusive with `wage`. */
  readonly share: Bps | null;
  /** The part held in escrow, which auto-executes. */
  readonly escrowed: Minor;
  /** The part that stays elective — the only part standing can accrue to. */
  readonly elective: Minor;
}

export interface VentureRole {
  readonly index: number;
  readonly label: string;
  readonly terms: RoleTerms;
  /**
   * The single home of commitment. A partial unique index on this column is
   * what makes "one hand in at most one role" true rather than merely intended
   * (INV-9).
   */
  filledByHandId: HandId | null;
  filledByPrincipal: PrincipalId | null;
}

export interface Venture {
  readonly id: VentureId;
  readonly kind: VentureKind;
  readonly creator: PrincipalId;
  state: VentureState;
  visibility: Extract<Visibility, 'PUBLIC' | 'PARTIES'>;
  readonly roles: VentureRole[];
  /** Roles must be live in the same window; this is what forces cooperation. */
  readonly windowOpensTick: number;
  readonly windowClosesTick: number;
  readonly resolvesAtTick: number;
  /** What two principals countersigned. Pins the valuation rule and its as-of tick. */
  termsHash: string | null;
  /** The state version each party acted on, compared at settlement (INV-19). */
  actedOnStateVersion: number | null;
}

// ── Authority ───────────────────────────────────────────────────────────────

/**
 * A scoped, expiring authority — serialised as a W3C Verifiable Credential so a
 * counterparty can verify a delegate's claims *before* dealing with it.
 *
 * `maxDirectLoss` bounds **destruction, not just transfers** (PROP-G1). The
 * attack that makes this necessary: a delegate sends your hands into a raid
 * where its own accomplice waits, every action technically within bounds, your
 * loss total.
 */
export interface Grant {
  readonly id: GrantId;
  readonly grantor: PrincipalId;
  readonly delegate: PrincipalId;
  readonly template: string;
  readonly maxDirectLoss: Minor;
  readonly maxContingentLiability: Minor;
  spentDirect: Minor;
  spentContingent: Minor;
  readonly expiresTick: number;
  revokedAtTick: number | null;
}

// ── The record ──────────────────────────────────────────────────────────────

/**
 * Event fields that are **not retrofittable** (SPEC §15.1). Every one of these
 * exists because adding it later means rewriting history or losing the ability
 * to answer a question the design depends on.
 *
 * Note what is *absent*: balance fields. Putting balanced currency and item
 * totals on every event duplicates the posting table — scar #5 inside the field list that
 * exists to prevent scar #5. `posting` is authoritative for value, and the
 * invariant is ≥2 postings summing to zero per value-moving event (INV-1).
 */
export interface GameEvent {
  readonly id: EventId;
  readonly tick: number;
  readonly seqInTick: number;
  readonly kind: string;
  /** Accepted obligations pin the version they quoted, or a balance patch rewrites history. */
  readonly rulesVersion: number;
  readonly actorPrincipalId: PrincipalId | null;
  readonly onBehalfOfPrincipalId: PrincipalId | null;
  readonly grantId: GrantId | null;
  /** Immutable primary cohort. */
  readonly eventFamilyId: string;
  /** Causality. One flat field cannot express both cohort and cause. */
  readonly parentEventId: EventId | null;
  readonly isPublic: boolean;
  readonly publicAt: number | null;
  readonly declassifyAt: number | null;
  readonly provenanceClass: ProvenanceClass;
  readonly actedOnStateVersion: number | null;
  readonly decisionSource: DecisionSource | null;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * Value moves in postings, never in event fields. Every value-moving event
 * produces ≥2 postings summing to zero, or exactly one ISSUE/RETIRE against a
 * named faucet or sink — asserted at tick close (INV-1).
 */
export interface Posting {
  readonly eventId: EventId;
  readonly account: AccountId;
  readonly good: GoodId | null;
  readonly amountMinor: Minor;
  readonly amountQty: Qty | null;
}

export interface Encumbrance {
  readonly id: string;
  readonly principal: PrincipalId;
  readonly account: AccountId;
  readonly amountMinor: Minor;
  /** Why this is locked. An orphan lock is an invariant failure (INV-4). */
  readonly obligationRef: VentureId | GrantId;
  /** EXPOSURE ≡ Σ open maxDirectLoss over this table. Safe value contributes zero. */
  readonly maxDirectLoss: Minor;
}

// ── Say-do ──────────────────────────────────────────────────────────────────

/**
 * A pre-committed intention. Agents receive `HONOURED | CONTRADICTED` and
 * nothing else, ever, at any tier, on any delay (PROP-D2) — publishing seal
 * *content* to an agent-readable channel is a perfect cartel-monitoring tool,
 * and the harm survives even a 24-hour lag.
 *
 * Structured, never prose: prose never feeds the verdict (PROP-D1, scars #7/#8).
 */
export type SealVerdict = 'HONOURED' | 'CONTRADICTED';

export interface Seal {
  readonly id: SealId;
  readonly principal: PrincipalId;
  /** Scoped to its own Reckoning, evaluated exactly once (INV-20, scar #7). */
  readonly reckoningIndex: number;
  readonly intent: Readonly<Record<string, CanonicalScalar>>;
  verdict: SealVerdict | null;
}

export type CanonicalScalar = string | number | boolean | null;

// ── Standing ────────────────────────────────────────────────────────────────

/**
 * The public factual vectors — never a single score.
 *
 * Standing accrues **only** to elective parts honoured, weighted against the
 * honourer's total capital, and diversity-weighted across distinct,
 * independently-capitalised counterparties. A 100%-escrowed venture earns a
 * performance record and zero standing; self-dealing and duplicates earn zero
 * (scar #9 — ~17 duplicate pacts once took reputation 50 → 100).
 */
export interface Standing {
  readonly principal: PrincipalId;
  electiveHonoured: number;
  electiveHonouredValue: Minor;
  defaults: number;
  contradictedSeals: number;
  /** Count of distinct independently-capitalised counterparties. The anti-farm term. */
  distinctCounterparties: number;
  lastDefaultTick: number | null;
}

// ── Halt ────────────────────────────────────────────────────────────────────

/**
 * On assertion failure: abort the tick and halt. Never publish a broken tick.
 * A world that stops with no resume path is an outage in front of an audience,
 * so PAUSED has defined semantics (SPEC §15.2) and the immutable input triple
 * means a fixed tick reproduces the world every observer was promised.
 */
export type WorldStatus = 'RUNNING' | 'PAUSED';

export interface InvariantViolation {
  readonly id: string;
  readonly message: string;
  readonly tick: number;
  readonly severity: 'HALT' | 'WARN';
}
