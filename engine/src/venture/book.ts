/**
 * The venture book, and the index that makes INV-9 true rather than intended.
 *
 * ## The partial unique index, in process
 *
 * The schema owes this:
 *
 * ```sql
 * CREATE UNIQUE INDEX venture_role_hand_uq ON venture_role (filled_by_hand_id)
 *   WHERE filled_by_hand_id IS NOT NULL AND venture_is_live;
 * ```
 *
 * {@link VentureBook.liveFillByHand} is its in-process equivalent, and it is
 * **partial in exactly the same way**: a role in a `SETTLED`, `DEFAULTED` or
 * `ABANDONED` venture keeps its `filledByHandId` forever, because the record is
 * append-only and "who carried that cargo" is a permanent fact — but it no longer
 * occupies the hand. Making the index total instead would mean a hand could fill
 * one role in its entire life, which is not a rule anyone wants; dropping the
 * historical column instead would delete the record. Partial is the only shape
 * that is both.
 *
 * The index is also **rescanned and compared** ({@link VentureBook.indexFaults}),
 * because `TESTING.md` INV-9 says the index "is the thing most likely to be
 * dropped by a careless migration" and an index nobody checks reads exactly like a
 * correct one.
 *
 * ## Why ordering is by id and never by insertion
 *
 * §15.3 settles "elective parts in `venture_id` order" and §15.2 orders the queue
 * by `(priority, principal_id, client_sequence)`, "never arrival". So every scan
 * this class exposes is sorted by `compareIds`, and there is deliberately no method
 * that returns ventures in insertion order — a phase whose iteration order depends
 * on when agents happened to arrive is DET-2 failing silently.
 */

import type { HandId, InvariantViolation, PrincipalId, VentureId } from '../core/types.js';
import { compareIds } from '../ledger/index.js';
import type { RoleFills } from '../world/index.js';
import { isLive, windowsOverlap, type VentureRecord, type TerminalState } from './venture.js';

/** Where a hand is committed: the venture and the role index. */
export interface RoleRef {
  readonly venture: VentureId;
  readonly roleIndex: number;
}

export class BookError extends Error {}

export class VentureBook {
  private readonly ventures = new Map<VentureId, VentureRecord>();
  /**
   * The partial unique index. One entry per hand, covering live ventures only.
   *
   * A `Map` keyed by hand *is* the uniqueness constraint: there is no shape of this
   * structure in which a hand has two live fills, which is stronger than a check
   * somebody has to remember to run.
   */
  private readonly liveFillByHand = new Map<HandId, RoleRef>();

  add(venture: VentureRecord): VentureRecord {
    if (this.ventures.has(venture.id)) {
      throw new BookError(`venture ${venture.id} is already in the book`);
    }
    this.ventures.set(venture.id, venture);
    // A venture may arrive already filled (a replay from a snapshot), so the index
    // is built from the rows rather than assumed empty.
    if (isLive(venture)) {
      for (const role of venture.roles) {
        if (role.filledByHandId !== null) {
          this.claim(role.filledByHandId, { venture: venture.id, roleIndex: role.index });
        }
      }
    }
    return venture;
  }

  get(id: VentureId): VentureRecord | undefined {
    return this.ventures.get(id);
  }

  require(id: VentureId): VentureRecord {
    const v = this.ventures.get(id);
    if (v === undefined) throw new BookError(`no such venture ${id}`);
    return v;
  }

  get size(): number {
    return this.ventures.size;
  }

  /** Every venture, in `venture_id` order. The only sanctioned full scan. */
  all(): readonly VentureRecord[] {
    return [...this.ventures.values()].sort((a, b) => compareIds(a.id, b.id));
  }

  live(): readonly VentureRecord[] {
    return this.all().filter(isLive);
  }

  /**
   * Ventures due to resolve at or before `tick` — the settlement set (§15.3).
   *
   * `DEFERRED` is included, and it is included *without moving `resolvesAtTick`*.
   * That field is inside `terms_hash`, so re-arming a deferral by pushing its
   * resolution tick forward would invalidate the hash both parties countersigned
   * and every subsequent settlement would fail its own integrity check — a
   * fabricated betrayal produced by the deferral machinery meant to prevent one
   * (§15.4, E2E-14). A deferral is therefore "still due, tried again next
   * Reckoning", and `deferrals` is what bounds it.
   */
  settlementSet(tick: number): readonly VentureRecord[] {
    return this.all().filter(
      (v) => (v.state === 'LIVE' || v.state === 'DEFERRED') && v.resolvesAtTick <= tick,
    );
  }

  /** Ventures a principal is party to, in id order. */
  forPrincipal(principal: PrincipalId): readonly VentureRecord[] {
    return this.all().filter(
      (v) => v.creator === principal || v.roles.some((r) => r.filledByPrincipal === principal),
    );
  }

  // ── The index ──────────────────────────────────────────────────────────────

  /** Where this hand is committed right now, or null. The single home, read. */
  commitmentOf(hand: HandId): RoleRef | null {
    return this.liveFillByHand.get(hand) ?? null;
  }

  /**
   * INV-9's input for `checkInv9`: hand -> number of live roles it fills.
   *
   * Counts, not membership. "At most one role" is a multiplicity claim and a set
   * would satisfy it vacuously — which is the note `world/invariants.ts` makes
   * about `RoleFills` and the reason this returns the same shape it expects.
   */
  roleFills(): RoleFills {
    const out = new Map<HandId, number>();
    for (const venture of this.all()) {
      if (!isLive(venture)) continue;
      for (const role of venture.roles) {
        if (role.filledByHandId === null) continue;
        out.set(role.filledByHandId, (out.get(role.filledByHandId) ?? 0) + 1);
      }
    }
    return out;
  }

  /**
   * Take the index entry for a hand. Refuses a second live fill — this is the
   * unique constraint doing its job, and the message is the one an agent reads.
   */
  private claim(hand: HandId, ref: RoleRef): void {
    const existing = this.liveFillByHand.get(hand);
    if (existing !== undefined) {
      throw new BookError(
        `INV-9: hand ${hand} already fills ${existing.venture} role ${existing.roleIndex}; ` +
          `it cannot also fill ${ref.venture} role ${ref.roleIndex}. A hand is one unit of ` +
          'simultaneous physical presence.',
      );
    }
    this.liveFillByHand.set(hand, ref);
  }

  /**
   * Record a fill in the index, after the venture accepted it.
   *
   * Deliberately separate from `fillRole` in `venture.ts`: the venture can only see
   * itself, and cross-venture uniqueness is the book's. Splitting them means the
   * uniqueness rule has one implementation instead of one per caller.
   */
  indexFill(venture: VentureId, roleIndex: number, hand: HandId): void {
    const v = this.require(venture);
    if (!isLive(v)) {
      throw new BookError(`${venture} is ${v.state}; a fill in it does not occupy a hand`);
    }
    this.claim(hand, { venture, roleIndex });
  }

  /** Release a hand from the index. Idempotent, so a double release is not a fault. */
  indexRelease(hand: HandId): void {
    this.liveFillByHand.delete(hand);
  }

  /**
   * Take a venture out of the live index. Returns the hands it freed, in id order,
   * so the caller can `releaseHand` them — the world owns hand state, this owns the
   * reference, and neither writes the other's field.
   *
   * A `DEFERRED` venture frees its hands too. It is still owed, but it must not go
   * on holding somebody's presence for a whole Reckoning, or a rival could construct
   * a deferral loop specifically to pin a competitor's hands (E2E-13's second half).
   */
  resolve(venture: VentureId, state: TerminalState | 'DEFERRED', tick: number): readonly HandId[] {
    const v = this.require(venture);
    const freed: HandId[] = [];
    for (const role of v.roles) {
      if (role.filledByHandId === null) continue;
      const ref = this.liveFillByHand.get(role.filledByHandId);
      if (ref?.venture === venture) {
        this.liveFillByHand.delete(role.filledByHandId);
        freed.push(role.filledByHandId);
      }
    }
    v.state = state;
    v.resolvedAtTick = tick;
    if (state === 'DEFERRED') v.deferrals += 1;
    return freed.sort(compareIds);
  }

  // ── Assertions ─────────────────────────────────────────────────────────────

  /**
   * Rescan every live venture and compare against the index.
   *
   * This is the half of INV-9 that catches the index itself being wrong. An index
   * that has drifted allows exactly the bug the index exists to prevent, and it
   * cannot be found by any test that goes through the index to ask.
   */
  indexFaults(tick: number): InvariantViolation[] {
    const out: InvariantViolation[] = [];
    const scanned = new Map<HandId, RoleRef[]>();
    for (const venture of this.all()) {
      if (!isLive(venture)) continue;
      for (const role of venture.roles) {
        if (role.filledByHandId === null) continue;
        const refs = scanned.get(role.filledByHandId) ?? [];
        refs.push({ venture: venture.id, roleIndex: role.index });
        scanned.set(role.filledByHandId, refs);
      }
    }

    for (const [hand, refs] of [...scanned.entries()].sort((a, b) => compareIds(a[0], b[0]))) {
      if (refs.length > 1) {
        out.push({
          id: 'INV-9',
          tick,
          severity: 'HALT',
          message:
            `hand ${hand} fills ${refs.length} live venture roles (` +
            refs.map((r) => `${r.venture}#${r.roleIndex}`).join(', ') +
            '); the partial unique index on filled_by_hand_id has been bypassed',
        });
      }
      const indexed = this.liveFillByHand.get(hand);
      const first = refs[0];
      if (indexed === undefined) {
        out.push({
          id: 'INV-9',
          tick,
          severity: 'HALT',
          message: `hand ${hand} fills a live role but is absent from the index; the index has drifted`,
        });
      } else if (first !== undefined && refs.length === 1) {
        if (indexed.venture !== first.venture || indexed.roleIndex !== first.roleIndex) {
          out.push({
            id: 'INV-9',
            tick,
            severity: 'HALT',
            message:
              `hand ${hand} is indexed at ${indexed.venture}#${indexed.roleIndex} but the rows say ` +
              `${first.venture}#${first.roleIndex}`,
          });
        }
      }
    }

    for (const [hand, ref] of [...this.liveFillByHand.entries()].sort((a, b) => compareIds(a[0], b[0]))) {
      if (!scanned.has(hand)) {
        out.push({
          id: 'INV-9',
          tick,
          severity: 'HALT',
          message:
            `the index holds hand ${hand} at ${ref.venture}#${ref.roleIndex} but no live role names it; ` +
            'a stale entry silently forbids a legal fill',
        });
      }
    }

    return out;
  }

  /**
   * PROP-V6's first clause across ventures: no hand may be committed to two
   * ventures whose windows overlap.
   *
   * Implied by the index (a hand has at most one live fill, so it cannot be in two
   * ventures at all) and asserted separately anyway, because the two rules have
   * different failure modes: the index could be correct while a *replayed* snapshot
   * carried overlapping historical fills, and §7.2's whole argument is about
   * windows rather than about counts.
   */
  overlapFaults(tick: number): InvariantViolation[] {
    const out: InvariantViolation[] = [];
    const byHand = new Map<HandId, VentureRecord[]>();
    for (const venture of this.live()) {
      for (const role of venture.roles) {
        if (role.filledByHandId === null) continue;
        const list = byHand.get(role.filledByHandId) ?? [];
        list.push(venture);
        byHand.set(role.filledByHandId, list);
      }
    }
    for (const [hand, ventures] of [...byHand.entries()].sort((a, b) => compareIds(a[0], b[0]))) {
      for (let i = 0; i < ventures.length; i += 1) {
        for (let j = i + 1; j < ventures.length; j += 1) {
          const a = ventures[i];
          const b = ventures[j];
          if (a === undefined || b === undefined) continue;
          if (windowsOverlap(a, b)) {
            out.push({
              id: 'PROP-V6',
              tick,
              severity: 'HALT',
              message:
                `hand ${hand} is committed to ${a.id} (ticks ${a.windowOpensTick}..${a.windowClosesTick}) ` +
                `and ${b.id} (${b.windowOpensTick}..${b.windowClosesTick}), which overlap; roles must be ` +
                'live in the same window and a hand is one unit of simultaneous presence',
            });
          }
        }
      }
    }
    return out;
  }

  /** Both index checks, for the tick's ASSERT phase. */
  checkVentureInvariants(tick: number): InvariantViolation[] {
    return [...this.indexFaults(tick), ...this.overlapFaults(tick)];
  }
}
