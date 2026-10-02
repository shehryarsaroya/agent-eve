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
 * ══════════════════════════════════════════════════════════════════════════
 * ★ **A SEAT IS KEPT BY PLAY, NOT BY BEING SEEN.**
 *
 * The idleness clock used to be `lastSeenTick`, moved by **every authenticated
 * request** — so one signed `GET /observe` every four Reckonings held a seat
 * forever, while enrolment is free and the seats are capped at 300. A squatter
 * needed one key and one cheap ping per seat to fill the world, and the newcomer it
 * turned away was told the cap was "on how many principals this box can serve at
 * once, never on who may play" — by a box serving nobody who played.
 *
 * So the clock is now {@link Seat.lastAcceptedTick}: the last tick an action of the
 * principal's was **accepted** into the world (`POST /act`'s `outcome.accepted`, any
 * verb, social ones included). A seat is recyclable {@link IDLE_SEAT_TICKS} after
 * that — four Reckonings, unchanged, so R19's promise is untouched for anyone who
 * plays at all — and a seat taken and **never played** (at enrolment, or by a
 * dormant principal returning) is recyclable after {@link UNPLAYED_SEAT_TICKS}, one
 * Reckoning. Observing still re-seats a dormant principal if there is room; it no
 * longer keeps the seat.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **None of this is world state.** The book lives in the API process, is rebuilt at
 * boot from `journal_enrollment` and the replayed action log, and no tick, ledger
 * posting, settlement or `state_hash` reads it: `Runtime.seat` mints the world half of
 * an enrolment and never consults this file, and a recycled principal keeps its
 * holding, hands and standing. So the policy can change without the record moving.
 *
 * Everything here is in **ticks**. A seat is a world-facing concept, so its clock
 * is the world's; there is no wall-clock idle timer to drift with the speed.
 */

import { TICKS_PER_RECKONING } from '../core/time.js';
import { MAX_PRINCIPALS } from '../core/time.js';
import type { PrincipalId } from '../core/types.js';
import { compareIds } from '../ledger/index.js';

/**
 * ★ **The HOST's seat count at launch — decoupled from the WORLD's ceiling.** *(calibrate)*
 *
 * Seats are a host resource (see the file header): how many principals this one box serves at once.
 * `MAX_PRINCIPALS` is the world's ceiling — the population every book is dimensioned for — and this is
 * deliberately below it, so a host can raise its seats with `COMPACT_SEATS` and no rules change.
 *
 * **Five hundred, and the number is set by MEMORY OVER A SEASON, not by CPU** (the Season 1 scale
 * measurement, `docs/design/SCALE-2026-10-01.md`). CPU is not what binds: at 3,000 principals a steady
 * tick is a fifth to a half of a second of a 300-second production tick and every principal observing
 * on the tick after a Reckoning is ~13 s of one core. What binds is that the posting log, the batch log and
 * the lots are held in memory for the world's whole life, growing ~0.5–0.8 KB per principal per tick
 * (lower at higher populations). Over Season 1's 14 Reckonings (4,032 ticks) that is ~1.4 GB of heap
 * at 500 principals, ~2.1 GB at 1,000 and ~5.4 GB at 3,000, against the 4 GiB slice
 * `deploy/agenteve.service` ships — and RSS measured at two to four times the live heap. Five hundred
 * leaves room for agents busier than the harness's synthetic cast, and it is also what the launch map
 * stages at §4.2's 8–20 principals a system (30 systems).
 *
 * Raising it is configuration, not a rules change: `COMPACT_SEATS=1000` wants an 8 GiB slice and
 * `--max-old-space-size=6144`; 3,000 wants ~16 GiB, or the in-memory journal paged out (the SCALE doc's
 * open item). A default that can exhaust the slice mid-season is a halt nobody configured.
 */
export const DEFAULT_SEATS = 500;

/**
 * Read `COMPACT_SEATS`. Absent or empty is {@link DEFAULT_SEATS}; anything else must be a positive
 * integer no larger than the world's ceiling, and anything that is not is refused at boot with the
 * reason — a host that silently fell back to the default would be a host serving a number nobody set.
 */
export function seatCapacityFrom(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_SEATS;
  const n = Number(raw.trim());
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error(`COMPACT_SEATS must be a positive integer, got '${raw}'`);
  }
  if (n > MAX_PRINCIPALS) {
    throw new Error(
      `COMPACT_SEATS is ${String(n)}, above the world's ceiling of ${String(MAX_PRINCIPALS)} (core/time.ts:MAX_PRINCIPALS). ` +
        'Every population-sized book is dimensioned for that ceiling, so seating more would let a cap bind on ' +
        'legitimate play; raising it is a rules change, not a configuration one.',
    );
  }
  return n;
}

/**
 * Ticks after a principal's last ACCEPTED action before its seat is recyclable.
 *
 * Four Reckonings, deliberately longer than the three R19 promises are harmless,
 * so no reading of either document has a seat vanishing inside the guarantee — for
 * a principal that plays. What no longer moves this clock is a request that plays
 * nothing: see the file header.
 *
 * ★ **The world reads the same fact, separately** (`RULES_VERSION` 41): after the same
 * four Reckonings without an accepted action a principal's WORKS goes DORMANT and stops
 * dividing its system's yield (`works/params.ts:WORKS_DORMANT_AFTER_TICKS`). Two
 * constants, because this one is a host resource the tick never reads and that one is a
 * world rule inside `state_hash`; `test/works/dormant-works.spec.ts` pins that they
 * agree, so the host and the world never disagree about when a principal stopped playing.
 */
export const IDLE_SEAT_TICKS = TICKS_PER_RECKONING * 4;

/**
 * Ticks a seat is held when its principal has had **no** action accepted since it
 * took the seat — at enrolment, or on returning after a recycle.
 *
 * One Reckoning: long enough for any agent that means to play to send one act from
 * the live first observation its enrolment response already carries, and short
 * enough that a key minted only to hold a seat gives it back the next day.
 */
export const UNPLAYED_SEAT_TICKS = TICKS_PER_RECKONING;

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
  /** The tick this principal first took a seat — its enrolment. Never moves. */
  readonly seatedAtTick: number;
  /**
   * The tick it took the seat it holds NOW: its enrolment, its return after a recycle, or
   * a restart. {@link UNPLAYED_SEAT_TICKS} counts from here.
   */
  occupiedSinceTick: number;
  /** Last tick this principal made any authenticated request. Reported, never the idleness clock. */
  lastSeenTick: number;
  /**
   * ★ **The idleness clock.** The last tick an action of this principal's was accepted into
   * the world (the tick it resolves in), or null if none ever was.
   */
  lastAcceptedTick: number | null;
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

/** The two fields of an action-log row the seat clock reads. See {@link SeatBook.recordAcceptedRows}. */
export interface AcceptedRow {
  readonly principal: PrincipalId;
  /** The tick the action resolved in. */
  readonly tick: number;
  /** Null for a standing intent's own run, which nobody submitted and which is not play. */
  readonly arrivalOrdinal: number | null;
}

type ClaimResult =
  | { readonly ok: true; readonly value: SeatGrant }
  | { readonly ok: false; readonly refusal: SeatRefusal };

export class SeatBook {
  private readonly byPrincipal = new Map<PrincipalId, Seat>();
  private readonly byHandle = new Map<string, PrincipalId>();
  private recycleCount = 0;

  constructor(
    readonly capacity: number = DEFAULT_SEATS,
    readonly idleTicks: number = IDLE_SEAT_TICKS,
    readonly unplayedTicks: number = UNPLAYED_SEAT_TICKS,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error(`seat capacity must be a positive integer, got ${String(capacity)}`);
    }
    if (capacity > MAX_PRINCIPALS) {
      throw new Error(
        `seat capacity ${String(capacity)} is above the world's ceiling of ${String(MAX_PRINCIPALS)}; ` +
          'see seatCapacityFrom',
      );
    }
    if (!Number.isSafeInteger(idleTicks) || idleTicks < 1) {
      throw new Error(`the idle threshold must be a positive number of ticks, got ${String(idleTicks)}`);
    }
    if (!Number.isSafeInteger(unplayedTicks) || unplayedTicks < 1) {
      throw new Error(`the unplayed threshold must be a positive number of ticks, got ${String(unplayedTicks)}`);
    }
  }

  get occupied(): number {
    let n = 0;
    for (const seat of this.byPrincipal.values()) if (seat.occupied) n += 1;
    return n;
  }

  /** Occupied seats whose principal has had no action accepted since it took the seat. */
  get unplayed(): number {
    let n = 0;
    for (const seat of this.byPrincipal.values()) {
      if (seat.occupied && !this.playedSinceSeated(seat)) n += 1;
    }
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
  claim(principal: PrincipalId, handle: string, tick: number): ClaimResult {
    return this.seat(principal, handle, tick, 'ALWAYS');
  }

  /**
   * Re-seat a journalled enrolment while the world boots.
   *
   * {@link claim} without the recycling sweep, unless the book is full and a sweep is the
   * only way to make room. A restart must never recycle a seat that the running world was
   * still serving: the requests that kept a dormant principal seated are not journalled,
   * so the replay cannot know about them, and judging them absent would turn every
   * restart into a mass eviction.
   */
  restore(principal: PrincipalId, handle: string, tick: number): ClaimResult {
    return this.seat(principal, handle, tick, 'ONLY_IF_FULL');
  }

  private seat(principal: PrincipalId, handle: string, tick: number, sweep: 'ALWAYS' | 'ONLY_IF_FULL'): ClaimResult {
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

    const recycled = sweep === 'ALWAYS' || this.occupied >= this.capacity ? this.recycleIdle(tick) : [];

    if (existing !== undefined) {
      // A dormant principal returning. It keeps its identity, its holding and its
      // standing; all it lost was the seat, and it takes one back if there is room —
      // with a fresh UNPLAYED lease, because coming back is not the same as playing.
      if (this.occupied >= this.capacity) {
        return { ok: false, refusal: { kind: 'full', detail: this.fullDetail(tick) } };
      }
      existing.occupied = true;
      existing.occupiedSinceTick = tick;
      if (tick > existing.lastSeenTick) existing.lastSeenTick = tick;
      return { ok: true, value: { seat: existing, recycled } };
    }

    if (this.occupied >= this.capacity) {
      return { ok: false, refusal: { kind: 'full', detail: this.fullDetail(tick) } };
    }

    const seat: Seat = {
      principal,
      handle,
      seatedAtTick: tick,
      occupiedSinceTick: tick,
      lastSeenTick: tick,
      lastAcceptedTick: null,
      occupied: true,
      recycles: 0,
    };
    this.byPrincipal.set(principal, seat);
    this.byHandle.set(handle, principal);
    return { ok: true, value: { seat, recycled } };
  }

  /**
   * Record that a principal was SEEN — any authenticated request.
   *
   * Reported, and that is all it does now. It used to be the idleness clock, which is
   * how one signed ping every four Reckonings held a seat forever (see the file header).
   */
  touch(principal: PrincipalId, tick: number): void {
    const seat = this.byPrincipal.get(principal);
    if (seat === undefined) return;
    if (tick > seat.lastSeenTick) seat.lastSeenTick = tick;
  }

  /**
   * ★ Record that an action of this principal's was ACCEPTED into the world, resolving in
   * `tick`. The one thing that keeps a seat. Monotone: an older tick never rewinds it.
   */
  recordAccepted(principal: PrincipalId, tick: number): void {
    const seat = this.byPrincipal.get(principal);
    if (seat === undefined) return;
    if (seat.lastAcceptedTick === null || tick > seat.lastAcceptedTick) seat.lastAcceptedTick = tick;
  }

  /**
   * Fold one tick of the action log into the clock — how boot rebuilds it from the record.
   *
   * Every row the log holds for a principal was accepted at submission (a refusal at submit
   * never enters the queue, so never the log), which is exactly what `POST /act` reports as
   * `accepted` and what {@link recordAccepted} counts live. A standing intent's own run has
   * no arrival and is skipped: an order left running is not somebody playing.
   */
  recordAcceptedRows(rows: readonly AcceptedRow[]): void {
    for (const row of rows) {
      if (row.arrivalOrdinal === null) continue;
      this.recordAccepted(row.principal, row.tick);
    }
  }

  /**
   * Close a boot: what the replay could not see, it must not punish.
   *
   * Every occupied seat's unplayed lease restarts at `bootTick`, so **no seat is recyclable
   * inside the first Reckoning after a restart** — a dormant principal re-seated by a request
   * the journal never recorded is not evicted by the reboot. And a seat whose principal
   * enrolled before `replayedFromTick` (a checkpoint was adopted, so its earlier actions were
   * never re-read) and shows no accepted action in the tail is given `bootTick` as its last
   * accepted action: the conservative reading of a history this boot did not look at.
   */
  afterRestart(bootTick: number, replayedFromTick: number): void {
    for (const seat of this.byPrincipal.values()) {
      if (!seat.occupied) continue;
      if (bootTick > seat.occupiedSinceTick) seat.occupiedSinceTick = bootTick;
      if (seat.lastAcceptedTick === null && seat.seatedAtTick < replayedFromTick) {
        seat.lastAcceptedTick = bootTick;
      }
    }
  }

  /**
   * The first tick at which this seat may be recycled.
   *
   * The later of two leases: {@link UNPLAYED_SEAT_TICKS} from taking the seat, and
   * {@link IDLE_SEAT_TICKS} from the last accepted action. A principal that plays is held
   * four Reckonings from its last act; one that never has is held one Reckoning from its
   * seating — and a returning principal, whatever it did before, starts on the short lease.
   */
  recyclableAt(seat: Seat): number {
    const unplayedLease = seat.occupiedSinceTick + this.unplayedTicks;
    return seat.lastAcceptedTick === null
      ? unplayedLease
      : Math.max(unplayedLease, seat.lastAcceptedTick + this.idleTicks);
  }

  /**
   * Release every seat whose lease has run out.
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
      if (tick < this.recyclableAt(seat)) continue;
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

  private playedSinceSeated(seat: Seat): boolean {
    return seat.lastAcceptedTick !== null && seat.lastAcceptedTick >= seat.occupiedSinceTick;
  }

  /**
   * The 503 body's detail. SPEC §15.6 asks for a *helpful* 503, and helpful means
   * telling the caller what would have to change, which is a seat becoming idle.
   */
  private fullDetail(tick: number): string {
    const soonest = this.soonestRecyclableTick(tick);
    const when =
      soonest === null
        ? 'none is due to recycle yet'
        : `the next seat becomes recyclable at tick ${String(soonest)}`;
    return (
      `the world is full: ${String(this.occupied)} of ${String(this.capacity)} seats are occupied. ` +
      `A seat is kept by play: it recycles ${String(this.idleTicks)} ticks after its principal's last ` +
      `accepted action, or ${String(this.unplayedTicks)} ticks after it was taken if none has been accepted ` +
      `since — observing alone does not hold one — and ${when}. ` +
      'Enrolment is free and stays free; the cap is on how many principals this box can serve at once, never on who may play.'
    );
  }

  private soonestRecyclableTick(tick: number): number | null {
    let soonest: number | null = null;
    for (const seat of this.byPrincipal.values()) {
      if (!seat.occupied) continue;
      const at = this.recyclableAt(seat);
      if (at <= tick) continue;
      if (soonest === null || at < soonest) soonest = at;
    }
    return soonest;
  }
}
