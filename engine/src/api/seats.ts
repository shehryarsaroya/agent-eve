/**
 * Seats: the population cap, and what "recycled" is allowed to mean.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **SCAR #3.** High Water's `/enroll` was unbounded. Every request minted a
 * permanent row, the whole map was re-serialised every 1.5 s, and an attacker
 * turned "remember this agent" into an OOM and a disk DoS. The ghosts never left,
 * so the cost was permanent and grew monotonically.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * SPEC §15.6's fix is one sentence with three parts, and the third is the one
 * people drop: *"Population is capped at seats with **idle-seat recycling** and a
 * helpful 503 when full."*
 *
 * **What a seat is, and what it is not.** A seat is the right to be *served* — an
 * observation blob built, affordances solved, a place in the cast. It is a host
 * resource. Recycling a seat frees that resource and **nothing else**:
 *
 *   - identity is never re-minted and never deleted (A10, §6.1),
 *   - the holding stays where it is,
 *   - standing is untouched,
 *   - hands stay committed to whatever they were doing.
 *
 * That separation is what makes recycling compatible with R19's promise that
 * absence costs opportunity and nothing else. It is also why the idle threshold is
 * **four Reckonings** rather than the two that would be cheaper: R19 tests an agent
 * left alone for three Reckonings, and a threshold inside that window would make
 * the two documents disagree even though the mechanics were fine.
 *
 * Everything here is in **ticks**. A seat is a world-facing concept, so its clock
 * is the world's; there is no wall-clock idle timer to drift with the speed.
 */

import { TICKS_PER_RECKONING } from '../core/time.js';
import type { PrincipalId } from '../core/types.js';
import { compareIds } from '../ledger/index.js';

/**
 * Seats in the world.
 *
 * SPEC §15.6 sizes the house cast at 12–20 and the architecture note at 300
 * principals; 300 is therefore the cap, not an aspiration, and the number is
 * *(calibrate)*.
 */
export const DEFAULT_SEATS = 300;

/**
 * Ticks of silence before a seat is recyclable.
 *
 * Four Reckonings, deliberately longer than the three R19 promises are harmless,
 * so no reading of either document has a seat vanishing inside the guarantee.
 */
export const IDLE_SEAT_TICKS = TICKS_PER_RECKONING * 4;

/** Longest handle accepted. Bounded because it is rendered and mailed (INV-26). */
export const MAX_HANDLE_LENGTH = 24;

/**
 * `handle@agenttransfer.dev` has to be a real address and a real map label, so the
 * grammar is the intersection of both: lowercase, digits, single internal hyphens.
 */
export const HANDLE_GRAMMAR = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export interface Seat {
  readonly principal: PrincipalId;
  readonly handle: string;
  readonly seatedAtTick: number;
  /** Last tick this principal observed or acted. The idleness clock. */
  lastSeenTick: number;
  /** True while it occupies a seat; false once recycled. Never deleted. */
  occupied: boolean;
  /** How many times this principal's seat has been recycled. Public metric. */
  recycles: number;
}

export type SeatRefusal =
  | { readonly kind: 'full'; readonly detail: string }
  | { readonly kind: 'taken'; readonly detail: string }
  | { readonly kind: 'enrolled'; readonly detail: string };

export interface SeatGrant {
  readonly seat: Seat;
  /** Principals whose seats were recycled to make room, in canonical order. */
  readonly recycled: readonly PrincipalId[];
}

export class SeatBook {
  private readonly byPrincipal = new Map<PrincipalId, Seat>();
  private readonly byHandle = new Map<string, PrincipalId>();
  private recycleCount = 0;

  constructor(
    readonly capacity: number = DEFAULT_SEATS,
    readonly idleTicks: number = IDLE_SEAT_TICKS,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error(`seat capacity must be a positive integer, got ${String(capacity)}`);
    }
    if (!Number.isSafeInteger(idleTicks) || idleTicks < 1) {
      throw new Error(`the idle threshold must be a positive number of ticks, got ${String(idleTicks)}`);
    }
  }

  get occupied(): number {
    let n = 0;
    for (const seat of this.byPrincipal.values()) if (seat.occupied) n += 1;
    return n;
  }

  /** Rows held, occupied or not. **This is the number scar #3 was about.** */
  get rows(): number {
    return this.byPrincipal.size;
  }

  get recyclesTotal(): number {
    return this.recycleCount;
  }

  seatOf(principal: PrincipalId): Seat | undefined {
    return this.byPrincipal.get(principal);
  }

  principalForHandle(handle: string): PrincipalId | undefined {
    return this.byHandle.get(handle);
  }

  /** Every seat, in canonical principal order. */
  all(): readonly Seat[] {
    return [...this.byPrincipal.values()].sort((a, b) => compareIds(a.principal, b.principal));
  }

  /**
   * Seat a new principal, recycling idle seats first if the world is full.
   *
   * Recycling happens *before* the capacity test rather than on a timer, for the
   * same reason the rate limiter prunes on admission: the map is only ever too big
   * at the moment somebody is trying to add to it, and a timer is a second clock.
   */
  claim(
    principal: PrincipalId,
    handle: string,
    tick: number,
  ): { readonly ok: true; readonly value: SeatGrant } | { readonly ok: false; readonly refusal: SeatRefusal } {
    const existingHandle = this.byHandle.get(handle);
    if (existingHandle !== undefined && existingHandle !== principal) {
      return {
        ok: false,
        refusal: {
          kind: 'taken',
          detail: `the handle '${handle}' belongs to another principal. A handle is an address and a public name, so it is never reissued.`,
        },
      };
    }
    const existing = this.byPrincipal.get(principal);
    if (existing !== undefined && existing.occupied) {
      return {
        ok: false,
        refusal: {
          kind: 'enrolled',
          detail: `${principal} is already enrolled and holding a seat. Identity is never re-minted; sign an observe instead.`,
        },
      };
    }

    const recycled = this.recycleIdle(tick);

    if (existing !== undefined) {
      // A dormant principal returning. It keeps its identity, its holding and its
      // standing; all it lost was the seat, and it takes one back if there is room.
      if (this.occupied >= this.capacity) {
        return { ok: false, refusal: { kind: 'full', detail: this.fullDetail(tick) } };
      }
      existing.occupied = true;
      existing.lastSeenTick = tick;
      return { ok: true, value: { seat: existing, recycled } };
    }

    if (this.occupied >= this.capacity) {
      return { ok: false, refusal: { kind: 'full', detail: this.fullDetail(tick) } };
    }

    const seat: Seat = {
      principal,
      handle,
      seatedAtTick: tick,
      lastSeenTick: tick,
      occupied: true,
      recycles: 0,
    };
    this.byPrincipal.set(principal, seat);
    this.byHandle.set(handle, principal);
    return { ok: true, value: { seat, recycled } };
  }

  /** Mark a principal active. Every served `observe` and `act` calls this. */
  touch(principal: PrincipalId, tick: number): void {
    const seat = this.byPrincipal.get(principal);
    if (seat === undefined) return;
    if (tick > seat.lastSeenTick) seat.lastSeenTick = tick;
  }

  /**
   * Release every seat idle for longer than the threshold.
   *
   * Deterministic: canonical principal order, so a replayed run recycles the same
   * seats in the same order. The rows are **kept** — dropping them would delete an
   * identity, which A10 forbids and which is also how a handle could be re-minted
   * to a different key.
   */
  recycleIdle(tick: number): readonly PrincipalId[] {
    const freed: PrincipalId[] = [];
    for (const seat of this.all()) {
      if (!seat.occupied) continue;
      if (tick - seat.lastSeenTick < this.idleTicks) continue;
      seat.occupied = false;
      seat.recycles += 1;
      this.recycleCount += 1;
      freed.push(seat.principal);
    }
    return freed;
  }

  /**
   * Is this principal being served right now?
   *
   * A recycled principal is not refused outright — that would be a denial of
   * service against an agent that did nothing wrong. It is re-seated on its next
   * request if there is room, which is what {@link claim} does for a returning
   * dormant principal.
   */
  isSeated(principal: PrincipalId): boolean {
    return this.byPrincipal.get(principal)?.occupied === true;
  }

  /**
   * The 503 body's detail. SPEC §15.6 asks for a *helpful* 503, and helpful means
   * telling the caller what would have to change, which is a seat becoming idle.
   */
  private fullDetail(tick: number): string {
    const soonest = this.soonestRecyclableTick(tick);
    const when =
      soonest === null
        ? 'every seat is active, so none is due to recycle yet'
        : `the next seat becomes recyclable at tick ${String(soonest)}`;
    return (
      `the world is full: ${String(this.occupied)} of ${String(this.capacity)} seats are occupied. ` +
      `Seats recycle after ${String(this.idleTicks)} ticks of silence and ${when}. ` +
      'Enrolment is free and stays free; the cap is on how many principals this box can serve at once, never on who may play.'
    );
  }

  private soonestRecyclableTick(tick: number): number | null {
    let soonest: number | null = null;
    for (const seat of this.byPrincipal.values()) {
      if (!seat.occupied) continue;
      const at = seat.lastSeenTick + this.idleTicks;
      if (at <= tick) continue;
      if (soonest === null || at < soonest) soonest = at;
    }
    return soonest;
  }
}
