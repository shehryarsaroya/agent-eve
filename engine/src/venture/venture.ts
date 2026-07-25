/**
 * The venture record, its creation, and its state machine (SPEC §7).
 *
 * ## Commitment has exactly one home
 *
 * `venture_role.filled_by_hand_id` is it (§6.2, INV-9). There is no
 * `hand.venture_id` and there is no `venture.hands[]` — a hand's `COMMITTED` state
 * says *that* it is engaged and never *to what*, so it duplicates no reference.
 * Two homes for one quantity is scar #5 on the keystone, and the keystone is
 * presence.
 *
 * The uniqueness half — a hand appears in at most one live role — is enforced by
 * {@link ./book.ts}'s index, which is the in-process equivalent of the partial
 * unique index the schema owes. It is asserted as well as indexed, because
 * `TESTING.md` says the index "is the thing most likely to be dropped by a
 * careless migration".
 *
 * ## Role concurrency, which is what makes presence scarcity bind
 *
 * §7.2 records that the v2.0 draft's presence budget did not bind: 3 hands x 24 h
 * is ~72 hand-hours a day against ~6 for a serialised three-role haul, so an agent
 * could dig in the morning, escort its own load at noon, deliver in the evening,
 * and never need a counterparty. Three rules fix it and all three live here:
 *
 *   1. **One window per venture.** Roles do not have their own windows, so they
 *      are concurrent by construction. There is nowhere to put a second window.
 *   2. **One principal fills at most one role in a venture** ({@link fillRole}).
 *   3. **>=4 roles on top-yield kinds** ({@link createVenture}, via `minRoles`).
 *
 * 2 and 3 together are the arithmetic: >=4 roles at one principal each needs >=4
 * distinct principals, and no amount of capital changes the count. That is what
 * {@link soloIsImpossible} states and what PROP-V6 asserts.
 */

import type {
  HandId,
  PrincipalId,
  RoleTerms,
  SystemId,
  Venture,
  VentureId,
  VentureKind,
  VentureRole,
  VentureState,
} from '../core/types.js';
import { minor, type Minor } from '../core/units.js';
import { accept, isPresent, reject, type HandRecord, type WorldResult } from '../world/index.js';
import {
  MAX_ROLES_PER_VENTURE,
  isTopYield,
  kindSpec,
  minRoles,
  principalsRequired,
  type RoleLabel,
} from './kinds.js';
import {
  pinnedConsideration,
  termsHash,
  validateRoleTerms,
  type PinnedValuation,
} from './terms.js';

/**
 * The stored role row.
 *
 * `label` narrows core's `string` to {@link RoleLabel} so the vocabulary guard can
 * see it. `stakeEncumbranceId` exists so INV-4 has a live obligation to point at
 * and so the lock can actually be released at settlement — an orphan lock is an
 * invariant failure, and a lock nobody remembers the id of is an orphan waiting.
 *
 * ## Why the paid-so-far figures are rows and not locals
 *
 * §15.3's deferral makes one obligation settle over **more than one Reckoning**, so
 * "how much has this role been paid" is a question about the obligation and not about
 * the current pass. The first build answered it from a working map rebuilt per
 * `settleBatch` call, so the second pass re-paid the elective part from zero: the
 * payee was over-paid, the payer was double-charged, and a default was written against
 * a payer that had by then paid more than it owed. That is A5' — "a fabricated default
 * libels a real agent permanently and is worse than a crash" — produced by the very
 * machinery §15.3 added to prevent it.
 *
 * These are **progress markers, not balances** (§15.1: `posting` stays authoritative
 * for value, and there is no way to recover this figure from the posting table because
 * each pass stamps its own `event_id`). Cumulative, monotonic, and never reset.
 */
export interface VentureRoleRecord extends VentureRole {
  readonly label: RoleLabel;
  filledAtTick: number | null;
  stakeEncumbranceId: string | null;
  /** Paid to this role out of the escrow, cumulative over every settlement pass. */
  settledEscrowedMinor: Minor;
  /** Paid to this role electively, cumulative over every settlement pass. */
  settledElectiveMinor: Minor;
}

/**
 * The stored venture row.
 *
 * Extends core's `Venture` with the five things §7's own block names that
 * `core/types.ts` does not carry. Each is here because something asserted or
 * rendered is otherwise impossible:
 *   - `stage` — §7: "system_id — where it happens and renders". No stage, no pixel.
 *   - `preference` — §7.3's "resolved by the initiator's stated preference order".
 *     Without it, contested slots fall back to stake and then to id, and the
 *     initiator has no say at all.
 *   - `countersigned` — §7.3: "Nothing binds until both parties countersign the
 *     same `terms_hash`".
 *   - `valuation` — §15.4's pinned rule *and* as-of tick.
 *   - `rulesVersion` — INV-15, pinned at acceptance and never rewritten.
 */
export interface VentureRecord extends Venture {
  readonly roles: VentureRoleRecord[];
  readonly stage: SystemId;
  readonly preference: readonly PrincipalId[];
  readonly countersigned: Set<PrincipalId>;
  readonly valuation: PinnedValuation;
  readonly rulesVersion: number;
  resolvedAtTick: number | null;
  /** How many Reckonings this has deferred to (§15.3's bounded cascade). */
  deferrals: number;
  /**
   * The tick the escrowed half executed, or null while it has not.
   *
   * A7's escrowed part auto-executes **once**, out of an account that is emptied and
   * returned to the creator in the same phase. So the second pass of a deferral must
   * not run phase 1 again, and the fact it must test is *"has the escrow been drawn"* —
   * not `deferrals > 0`, which was the first build's proxy and is a different fact: a
   * venture can carry a deferral count without ever having settled, and skipping phase
   * 1 then strands the escrow forever **and** publishes a shortfall on the guaranteed
   * half, which is the record denying A7's own guarantee.
   */
  escrowExecutedAtTick: number | null;
}

/** Venture states in which a role's fill occupies its hand — the partial index. */
export const LIVE_STATES: readonly VentureState[] = Object.freeze([
  'FORMING',
  'LIVE',
] as VentureState[]);

export function isLive(venture: Pick<VentureRecord, 'state'>): boolean {
  return LIVE_STATES.includes(venture.state);
}

export interface CreateVentureInput {
  readonly id: VentureId;
  readonly kind: VentureKind;
  readonly creator: PrincipalId;
  readonly stage: SystemId;
  /** One entry per role, in template order. Length must match the kind's template. */
  readonly terms: readonly RoleTerms[];
  readonly windowOpensTick: number;
  readonly windowClosesTick: number;
  readonly resolvesAtTick: number;
  readonly valuation: PinnedValuation;
  readonly rulesVersion: number;
  readonly visibility?: Extract<Venture['visibility'], 'PUBLIC' | 'PARTIES'>;
  readonly preference?: readonly PrincipalId[];
}

/**
 * Create a venture in `FORMING`.
 *
 * Every check here is a rejection rather than a throw, and the hints name the rule
 * (§12.2). The order of checks is deliberate: shape first, then the window, then
 * the terms — so an agent that got the window wrong is not told about `f(kind)`
 * for a role it has not thought about yet.
 */
export function createVenture(input: CreateVentureInput): WorldResult<VentureRecord> {
  const spec = kindSpec(input.kind);

  if (input.terms.length !== spec.roles.length) {
    return reject(
      'PROP-V6',
      `${input.kind} has ${spec.roles.length} roles (${spec.roles.map((r) => r.label).join(', ')}); ` +
        `you supplied terms for ${input.terms.length}. Every role is live in the same window, so every ` +
        'role is priced up front.',
    );
  }
  if (spec.roles.length < minRoles(input.kind)) {
    // Unreachable while `assertKindTable` passes in CI. Kept because the failure it
    // guards is "cooperation quietly became optional", which no other test asks.
    return reject(
      'PROP-V6',
      `${input.kind} needs >=${minRoles(input.kind)} roles${isTopYield(input.kind) ? ' (top-yield)' : ''}` +
        ` but its template declares ${spec.roles.length}.`,
    );
  }
  if (spec.roles.length > MAX_ROLES_PER_VENTURE) {
    return reject('INV-26', `a venture carries at most ${MAX_ROLES_PER_VENTURE} roles.`);
  }

  if (!Number.isSafeInteger(input.windowOpensTick) || input.windowOpensTick < 0) {
    return reject('INV-10', `windowOpensTick must be a non-negative tick, got ${input.windowOpensTick}.`);
  }
  if (input.windowClosesTick < input.windowOpensTick) {
    return reject(
      'PROP-V6',
      `the window closes (${input.windowClosesTick}) before it opens (${input.windowOpensTick}); ` +
        'roles must be live in the same window, so there has to be one.',
    );
  }
  if (input.resolvesAtTick < input.windowClosesTick) {
    return reject(
      'PROP-V6',
      `a venture resolves at or after its window closes; got resolvesAtTick ${input.resolvesAtTick} ` +
        `against windowClosesTick ${input.windowClosesTick}.`,
    );
  }

  let shareTotal = 0;
  for (const [index, terms] of input.terms.entries()) {
    const check = validateRoleTerms(input.kind, terms);
    if (!check.ok) {
      return reject(check.invariant, `role ${index} (${spec.roles[index]?.label ?? '?'}): ${check.hint}`);
    }
    shareTotal += terms.share ?? 0;
  }
  if (shareTotal > 10_000) {
    return reject(
      'INV-6',
      `the roles' shares add to ${shareTotal} bps, more than the 10000 bps of residual there is to ` +
        'divide. The remainder above the roles is the creator’s; it cannot be negative.',
    );
  }

  const roles: VentureRoleRecord[] = [];
  for (const [index, spec_] of spec.roles.entries()) {
    const terms = input.terms[index];
    // The length equality above already guarantees this; the check is here because
    // an index that reads `undefined` would otherwise be coerced by a `??` default
    // into a role priced at something nobody agreed to.
    if (terms === undefined) throw new VentureError(`unreachable: no terms for role ${index}`);
    roles.push({
      index,
      label: spec_.label,
      terms,
      filledByHandId: null,
      filledByPrincipal: null,
      filledAtTick: null,
      stakeEncumbranceId: null,
      settledEscrowedMinor: minor(0),
      settledElectiveMinor: minor(0),
    });
  }

  const venture: VentureRecord = {
    id: input.id,
    kind: input.kind,
    creator: input.creator,
    state: 'FORMING',
    visibility: input.visibility ?? 'PUBLIC',
    roles,
    stage: input.stage,
    windowOpensTick: input.windowOpensTick,
    windowClosesTick: input.windowClosesTick,
    resolvesAtTick: input.resolvesAtTick,
    termsHash: null,
    actedOnStateVersion: null,
    preference: [...(input.preference ?? [])],
    countersigned: new Set<PrincipalId>(),
    valuation: input.valuation,
    rulesVersion: input.rulesVersion,
    resolvedAtTick: null,
    deferrals: 0,
    escrowExecutedAtTick: null,
  };

  venture.termsHash = termsHashOf(venture);
  return accept(venture);
}

export function termsHashOf(venture: VentureRecord): string {
  return termsHash({
    venture: venture.id,
    kind: venture.kind,
    creator: venture.creator,
    stage: venture.stage,
    roles: venture.roles.map((r) => ({ index: r.index, label: r.label, terms: r.terms })),
    windowOpensTick: venture.windowOpensTick,
    windowClosesTick: venture.windowClosesTick,
    resolvesAtTick: venture.resolvesAtTick,
    valuation: venture.valuation,
    rulesVersion: venture.rulesVersion,
  });
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function roleAt(venture: VentureRecord, index: number): VentureRoleRecord {
  const role = venture.roles[index];
  if (role === undefined) {
    throw new VentureError(`${venture.id} has no role at index ${index}`);
  }
  return role;
}

export function filledIndices(venture: VentureRecord): number[] {
  return venture.roles.filter((r) => r.filledByHandId !== null).map((r) => r.index);
}

export function openIndices(venture: VentureRecord): number[] {
  return venture.roles.filter((r) => r.filledByHandId === null).map((r) => r.index);
}

export function isFullyFilled(venture: VentureRecord): boolean {
  return openIndices(venture).length === 0;
}

/** Distinct principals holding a role. PROP-V6's counterparty count. */
export function partiesOf(venture: VentureRecord): readonly PrincipalId[] {
  const seen = new Set<PrincipalId>();
  for (const role of venture.roles) {
    if (role.filledByPrincipal !== null) seen.add(role.filledByPrincipal);
  }
  return [...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function roleOfPrincipal(venture: VentureRecord, principal: PrincipalId): VentureRoleRecord | null {
  return venture.roles.find((r) => r.filledByPrincipal === principal) ?? null;
}

/** Σ escrowed over every role — what the creator must fund before signing binds. */
export function escrowRequired(venture: VentureRecord): Minor {
  let total = 0;
  for (const role of venture.roles) total += role.terms.escrowed;
  return minor(total);
}

/** Σ (escrowed + elective) — the venture's pinned value, for `f(kind)` and the card. */
export function pinnedValue(venture: VentureRecord): Minor {
  let total = 0;
  for (const role of venture.roles) total += pinnedConsideration(role.terms);
  return minor(total);
}

/**
 * Two windows overlap if they share at least one tick.
 *
 * §7.2's first rule, in one place. "An escort is only an escort while the cargo
 * moves" is exactly this predicate: a hand cannot be in two ventures whose windows
 * touch, so a principal cannot serialise its own three-role haul across a day.
 */
export function windowsOverlap(
  a: Pick<VentureRecord, 'windowOpensTick' | 'windowClosesTick'>,
  b: Pick<VentureRecord, 'windowOpensTick' | 'windowClosesTick'>,
): boolean {
  return a.windowOpensTick <= b.windowClosesTick && b.windowOpensTick <= a.windowClosesTick;
}

export function windowContains(venture: VentureRecord, tick: number): boolean {
  return tick >= venture.windowOpensTick && tick <= venture.windowClosesTick;
}

/**
 * **PROP-V6's headline, as a function.** Can one principal, alone, satisfy this
 * kind?
 *
 * Takes no balance and no hand count on purpose. The answer depends only on the
 * role count and the one-role-per-principal rule, so "at any capital level" is not
 * a claim about a large number — it is a claim that capital is not an argument.
 */
export function soloIsImpossible(kind: VentureKind): boolean {
  return principalsRequired(kind) > 1;
}

// ── Transitions ──────────────────────────────────────────────────────────────

export class VentureError extends Error {}

/**
 * Countersign the terms. §7.3: "Nothing binds until both parties countersign the
 * same `terms_hash`."
 *
 * The hash the signer supplies is compared, never trusted: a signer that computed
 * a different hash from the same logical terms has read different terms, and
 * signing anyway is how a compact binds somebody to a deal they did not see.
 */
export function countersign(
  venture: VentureRecord,
  principal: PrincipalId,
  hash: string,
  echoedTakeAtP50: Minor,
  serverTakeAtP50: Minor,
): WorldResult<VentureRecord> {
  if (venture.termsHash === null) {
    return reject('PROP-W1', `${venture.id} has no terms_hash to countersign.`);
  }
  if (hash !== venture.termsHash) {
    return reject(
      'PROP-W1',
      `the terms_hash you signed (${hash.slice(0, 12)}) is not this venture's (` +
        `${venture.termsHash.slice(0, 12)}). Fetch the venture again and sign the hash it publishes; ` +
        'a mismatch means you and the counterparty are looking at different terms.',
    );
  }
  if (echoedTakeAtP50 !== serverTakeAtP50) {
    // §7.1: the echo is "a confirmation of *understanding*, not just of terms".
    // This is the check that makes it one — an agent that believed it took a wage
    // when the engine recorded a share echoes a different number here, and the
    // signature is refused before the venture can record a broken promise as
    // honoured.
    return reject(
      'PROP-V3',
      `your echoed your_take_at_p50 (${echoedTakeAtP50}) does not match the server's (${serverTakeAtP50}). ` +
        'The echo confirms you understand what you are being paid, not just that you saw the terms. ' +
        'Re-read the role: a wage is fixed and senior, a share is a residual and junior.',
    );
  }
  if (!isLive(venture)) {
    return reject('PROP-V6', `${venture.id} is ${venture.state} and can no longer be signed.`);
  }
  venture.countersigned.add(principal);
  return accept(venture);
}

/**
 * Everyone whose signature a venture needs: the creator plus every role-holder.
 * A role filled by the creator does not need a second signature from it.
 */
export function signatoriesRequired(venture: VentureRecord): readonly PrincipalId[] {
  const set = new Set<PrincipalId>([venture.creator, ...partiesOf(venture)]);
  return [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function isFullyCountersigned(venture: VentureRecord): boolean {
  return signatoriesRequired(venture).every((p) => venture.countersigned.has(p));
}

/**
 * Move a fully-filled, fully-countersigned venture to `LIVE` and pin the state
 * version its parties acted on.
 *
 * `actedOnStateVersion` is INV-19's input and is pinned exactly once, here.
 * Settlement compares it and **halts on a mismatch** rather than settling against
 * a world the parties never saw — one of §15.4's five defences against the
 * false-default problem.
 */
export function activate(venture: VentureRecord, stateVersion: number, tick: number): WorldResult<VentureRecord> {
  if (venture.state !== 'FORMING') {
    return reject('PROP-V6', `${venture.id} is ${venture.state}, not FORMING.`);
  }
  if (!isFullyFilled(venture)) {
    const open = openIndices(venture).map((i) => roleAt(venture, i).label);
    return reject(
      'PROP-V6',
      `${venture.id} still has open roles (${open.join(', ')}). Roles are live in the same window, so a ` +
        'venture goes live filled or not at all.',
    );
  }
  if (!isFullyCountersigned(venture)) {
    const missing = signatoriesRequired(venture).filter((p) => !venture.countersigned.has(p));
    return reject(
      'PROP-W1',
      `${venture.id} is waiting on countersignatures from ${missing.join(', ')}. Nothing binds until every ` +
        'party has signed the same terms_hash.',
    );
  }
  if (tick > venture.windowClosesTick) {
    return reject(
      'PROP-V6',
      `${venture.id}'s window closed at tick ${venture.windowClosesTick}; it is tick ${tick}.`,
    );
  }
  venture.state = 'LIVE';
  venture.actedOnStateVersion = stateVersion;
  return accept(venture);
}

/**
 * Fill one role.
 *
 * The uniqueness check against every other live venture is **not** here — it lives
 * in {@link ./book.ts}, which owns the index. This function enforces only what one
 * venture can see, so there is exactly one place that can answer "is this hand
 * already committed" and it is the index.
 */
export function fillRole(
  venture: VentureRecord,
  roleIndex: number,
  hand: HandRecord,
  tick: number,
): WorldResult<VentureRoleRecord> {
  if (venture.state !== 'FORMING') {
    return reject(
      'PROP-V6',
      `${venture.id} is ${venture.state}; roles are filled while a venture is FORMING.`,
    );
  }
  if (!windowContains(venture, tick)) {
    return reject(
      'PROP-V6',
      `${venture.id}'s window is ticks ${venture.windowOpensTick}..${venture.windowClosesTick} and it is ` +
        `tick ${tick}. Every role in a venture is live in the same window — that is what makes an ` +
        'escort an escort.',
    );
  }
  const role = venture.roles[roleIndex];
  if (role === undefined) {
    return reject('PROP-V6', `${venture.id} has no role at index ${roleIndex}.`);
  }
  if (role.filledByHandId !== null) {
    return reject(
      'INV-9',
      `${venture.id} role ${roleIndex} (${role.label}) is already filled by ${role.filledByHandId}.`,
    );
  }

  // PROP-V6 clause 2, and the reason a solo principal cannot satisfy a top-yield
  // kind at any capital level: the constraint is on the *principal*, not the hand.
  // At the hand level a principal with three hands could fill three of four roles
  // and only need one counterparty, and §7.2's arithmetic would not bind.
  const existing = roleOfPrincipal(venture, hand.principal);
  if (existing !== null) {
    return reject(
      'PROP-V6',
      `${hand.principal} already holds role ${existing.index} (${existing.label}) in ${venture.id}. ` +
        'One principal fills at most one role in a venture; this kind needs ' +
        `${principalsRequired(venture.kind)} distinct principals and no amount of capital substitutes ` +
        'for one of them.',
    );
  }

  if (!isPresent(hand, tick)) {
    return reject(
      'INV-9',
      `hand ${hand.id} is ${hand.state.toLowerCase()} and is not present until tick ` +
        `${String(hand.presentSinceTick)}; it cannot fill a role before then.`,
    );
  }

  role.filledByHandId = hand.id;
  role.filledByPrincipal = hand.principal;
  role.filledAtTick = tick;
  return accept(role);
}

/**
 * Record what a settlement pass just paid a role.
 *
 * The **only** writer of the paid-so-far markers, so they can only grow: settlement
 * across a deferral adds to them and nothing anywhere resets them. A role that was
 * vacated keeps them, because what was paid was paid and the record is append-only.
 */
export function recordPaid(role: VentureRoleRecord, escrowed: Minor, elective: Minor): void {
  if (escrowed < 0 || elective < 0) {
    throw new VentureError(
      `role ${role.index} (${role.label}) cannot un-pay ${escrowed} escrowed / ${elective} elective; ` +
        'the paid-so-far markers are monotonic or a deferral can forget a payment',
    );
  }
  role.settledEscrowedMinor = minor(role.settledEscrowedMinor + escrowed);
  role.settledElectiveMinor = minor(role.settledElectiveMinor + elective);
}

/** Empty a role. The hand's physical state is the world module's business. */
export function vacateRole(venture: VentureRecord, roleIndex: number): HandId | null {
  const role = roleAt(venture, roleIndex);
  const hand = role.filledByHandId;
  role.filledByHandId = null;
  role.filledByPrincipal = null;
  role.filledAtTick = null;
  return hand;
}

/** Terminal states a venture can reach. `DEFERRED` is not terminal (§15.3). */
export type TerminalState = Extract<VentureState, 'SETTLED' | 'DEFAULTED' | 'ABANDONED'>;
