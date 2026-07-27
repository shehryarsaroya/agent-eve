/**
 * The raid book. Every figure predation owns lives here and nowhere else.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **ONE HOME PER QUANTITY** (scar #5), and **INSIDE `state_hash`** ({@link raidStateTable}).
 *
 * A live demand decides what a future tick does to a principal's goods, so a hash blind
 * to it would call two worlds identical while one of them was about to lose half its
 * stock — and an aborted tick that left a `yield` credited would have the world
 * believing a payment that never published. The venture book, the election map and the
 * encumbrance book were each outside the hash once and a verifier found all three; the
 * last of those is on record as this engine's worst defect. This book is registered
 * unconditionally from its first commit.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## Stored versus derived
 *
 * Stored: the demand as issued (pinned at spawn, never recomputed — A5′), the raid's own
 * force, the parties and their locked stakes, the target's answer, and what the ledger
 * actually moved at resolution. Derived every time it is asked for: the force totals
 * (`resolve.ts`), whether a raid is live, and everything the observation shows.
 *
 * **The outcome fields are written from the ledger's return values, never from the
 * demand.** That is the single most important line in this module: a raid that demanded
 * forty and found three must record three, because the record is what libels people.
 *
 * ## Ids are printable, and never carry a NUL byte
 *
 * A NUL in a source file makes `file(1)` report it as `data`, and every grep-based guard
 * in this repo — including the outbound secret scan — silently stops covering the file
 * while tsc, eslint and vitest all stay green. Three agents have shipped one. Raid ids
 * are `raid:<tick>:<index>` and the book's other two maps are keyed by a `PrincipalId`
 * and a `SystemId` directly, so there is no compound key here at all.
 */

import type { CanonicalValue } from '../core/canonical.js';
import { reckoningIndex } from '../core/time.js';
import type { GoodId, HandId, PrincipalId, RaidState, SystemId } from '../core/types.js';
import { minor, qty, type Minor, type Qty } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import type { AggressionSpend } from './aggression.js';
import {
  readArray,
  readInt,
  readObject,
  readString,
  SnapshotError,
  type StateTable,
} from '../tick/snapshot.js';
import { MAX_RAID_PARTIES, MAX_RAID_ROWS } from './params.js';

/** A raid's id. Content-derived from its spawn tick, so replay needs no counter. */
export type RaidId = string & { readonly __brand: 'RaidId' };

export function raidIdFor(spawnTick: number, indexAtTick: number): RaidId {
  return `raid:${String(spawnTick)}:${String(indexAtTick)}` as RaidId;
}

/**
 * An **agent-initiated** raid's id, in a namespace the world's own spawn can never reach.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE `d` IS NOT DECORATION — IT IS AN AGENT-REACHABLE WORLD HALT, CLOSED.**
 *
 * A `demand` runs in `VALIDATE+LOCK`; the world spawns in `PREDATE`, later in the same tick.
 * With one numeric index both would want `raid:<tick>:0`, and `spawnOne` calls `book.spawn`
 * outside a try — so an agent that demanded on a spawn tick would abort the tick for everybody.
 * `predate.ts` says in as many words that nothing there may throw on an agent's input, and three
 * agent-triggerable halts have already shipped in this repo.
 *
 * Separate namespaces make the collision unrepresentable rather than merely unlikely, and the id
 * then also *says* which kind of raid it is in every log line that carries it.
 * ══════════════════════════════════════════════════════════════════════════
 */
export function demandIdFor(spawnTick: number, indexAtTick: number): RaidId {
  return `${demandIdPrefix(spawnTick)}${String(indexAtTick)}` as RaidId;
}

function demandIdPrefix(spawnTick: number): string {
  return `raid:${String(spawnTick)}:d`;
}

/**
 * Re-exported, never re-declared. `RaidState` lives in `core/types.ts` because the frame
 * contract needs the same five words and §3 forbids one concept having two homes.
 */
export type { RaidState };

/** The side a party took. `DEFENDER` must match `world/commons.ts`'s `DEFENDER_SIDE`. */
export type RaidSide = 'RAIDER' | 'DEFENDER';

/** What the target said. Silence is not an answer and is stored as `null`. */
export type RaidAnswer = 'YIELD' | 'FIGHT';

export interface RaidParty {
  readonly principal: PrincipalId;
  readonly side: RaidSide;
  /** The hand this party put in. Force is per hand; capital buys none. */
  readonly handId: HandId;
  /**
   * Locked at join and forfeited to the target if the raid is repulsed. Zero on the
   * defender's side: a defender already risks its hand, and charging it to help would
   * price the only counter-move in the mechanic.
   */
  readonly stake: Minor;
  /** The lock holding {@link stake}, or null when there is nothing to hold. */
  readonly encumbranceId: string | null;
  readonly joinedAtTick: number;
}

export interface RaidRecord {
  readonly id: RaidId;
  /**
   * **Who chose this. `null` means nobody did.**
   *
   * ══════════════════════════════════════════════════════════════════════════
   * §9 has two forms of predation and this one field is the whole difference between them.
   * A **world raid** is weather: *"nobody owns them, so nobody can be bribed to call them
   * off"*, which is the entire argument for their existence and the reason A12 permits
   * them (a target-*selection* rule is physics). A **demand** is somebody's decision, made
   * with a name on it, out of a capacity that expires unspent.
   *
   * So this is not a provenance annotation. Six rules read it:
   *
   *   - **aggression capacity** is derived by counting the rows where it is set
   *     (`aggression.ts` keeps no counter, deliberately — scar #5);
   *   - a **repulsed** demand writes no stage hold and no victim cooldown, because those
   *     are the *world raid's* price for losing and an agent's choice must never be able
   *     to mint immunity from the world for a friend (see `predate.ts`);
   *   - the same for a **plundered** or **paid** demand;
   *   - the **frame** draws a demand differently, because "somebody attacked somebody"
   *     and "a raid arrived" are two different things to watch (A13);
   *   - the **ticker** names the raider;
   *   - and `PRD-7` refuses a demand aimed at its own initiator (§9's related-party rule).
   *
   * `null` for a world raid rather than a sentinel principal: a sentinel would be a
   * principal id naming nobody, and every reader that forgot the sentinel would attribute
   * the weather to an agent — which is a permanent public accusation (A5′).
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly initiator: PrincipalId | null;
  readonly target: PrincipalId;
  readonly stage: SystemId;
  readonly good: GoodId;
  /**
   * The demand, pinned at spawn and never recomputed.
   *
   * Recomputing it at resolution would be the false-default mechanism in §15.4 wearing
   * a different hat: the number an agent read when it decided has to be the number it
   * is held to.
   */
  readonly demandQty: Qty;
  /** The world raid's own force, drawn at spawn inside the published band. */
  readonly force: number;
  readonly spawnedAtTick: number;
  readonly resolvesAtTick: number;
  state: RaidState;
  answer: RaidAnswer | null;
  answeredAtTick: number | null;
  parties: RaidParty[];
  resolvedAtTick: number | null;
  /** What the ledger actually destroyed or relocated. Never the demand. */
  lostQty: Qty;
  /** What the ledger actually moved out of raider stakes. Never the stake total. */
  forfeited: Minor;
  /** The two sides as resolution computed them. Published, so the arithmetic is checkable. */
  defenderForce: number;
  raiderForce: number;
}

export class RaidBookError extends Error {}

export class Book {
  private readonly raids = new Map<RaidId, RaidRecord>();
  /** Principal → the tick its cooldown ends. Scar #14's per-victim protection. */
  private readonly victimCooldown = new Map<PrincipalId, number>();
  /** Stage → the tick its held-peace ends. The world raid's own downside. */
  private readonly stageHeld = new Map<SystemId, number>();

  // ── writing ───────────────────────────────────────────────────────────────

  /** Record a spawned raid. Refuses a duplicate id rather than overwriting a demand. */
  spawn(record: RaidRecord): void {
    if (this.raids.has(record.id)) {
      throw new RaidBookError(`raid ${record.id} already exists; a demand is issued once`);
    }
    this.raids.set(record.id, record);
  }

  get(id: RaidId): RaidRecord | undefined {
    return this.raids.get(id);
  }

  require(id: RaidId): RaidRecord {
    const raid = this.raids.get(id);
    if (raid === undefined) throw new RaidBookError(`no such raid: ${id}`);
    return raid;
  }

  /** Is this raid still open? The predicate `liveObligations` extends `isLive` with. */
  isLive(id: string): boolean {
    return this.raids.get(id as RaidId)?.state === 'DEMANDED';
  }

  /**
   * Admit a party. Refuses past the cap and refuses a second entry for one principal —
   * both are agent-reachable, so both return a thrown error the verb handler turns into
   * a sentence rather than a halt.
   */
  addParty(id: RaidId, party: RaidParty): void {
    const raid = this.require(id);
    if (raid.state !== 'DEMANDED') {
      throw new RaidBookError(`raid ${id} has already resolved as ${raid.state}`);
    }
    if (raid.parties.length >= MAX_RAID_PARTIES) {
      // The sentence says what to DO, because this is the one refusal in the mechanic that no later
      // action can clear: a full standoff stays full until it resolves. The old wording ("already has
      // 8 parties, which is the cap") was true and left an agent with nothing to try, and its downstream
      // `engage` then told it *"you are not a party — take a side with `join` first"*, which is advice
      // to retry the action that just failed structurally. See `combat/engage.ts` gate 5.
      throw new RaidBookError(
        `raid ${id} is FULL: all ${String(MAX_RAID_PARTIES)} party slots are taken and a standoff never gains ` +
          `more, so no later join can succeed either. A coalition larger than ${String(MAX_RAID_PARTIES)} ` +
          `principals has to be split across separate standoffs.`,
      );
    }
    if (raid.parties.some((p) => p.principal === party.principal)) {
      throw new RaidBookError(`${party.principal} has already joined raid ${id}`);
    }
    raid.parties.push(party);
    raid.parties.sort((a, b) => compareIds(a.principal, b.principal));
  }

  /** Record the target's answer. First answer wins: a demand is answered once. */
  answer(id: RaidId, answer: RaidAnswer, tick: number): void {
    const raid = this.require(id);
    if (raid.state !== 'DEMANDED') {
      throw new RaidBookError(`raid ${id} has already resolved as ${raid.state}`);
    }
    if (raid.answer !== null) {
      throw new RaidBookError(`raid ${id} was already answered '${raid.answer}' at tick ${String(raid.answeredAtTick)}`);
    }
    raid.answer = answer;
    raid.answeredAtTick = tick;
  }

  /**
   * Close a raid with what actually happened.
   *
   * Takes the *measured* figures — what the ledger moved — rather than the intended
   * ones. A5′: the record must never be wrong, and the cheapest way to guarantee that
   * is to make the intended figure unreachable from here.
   */
  close(
    id: RaidId,
    outcome: {
      readonly state: Exclude<RaidState, 'DEMANDED'>;
      readonly tick: number;
      readonly lostQty: Qty;
      readonly forfeited: Minor;
      readonly defenderForce: number;
      readonly raiderForce: number;
    },
  ): void {
    const raid = this.require(id);
    if (raid.state !== 'DEMANDED') {
      throw new RaidBookError(`raid ${id} has already resolved as ${raid.state}`);
    }
    raid.state = outcome.state;
    raid.resolvedAtTick = outcome.tick;
    raid.lostQty = outcome.lostQty;
    raid.forfeited = outcome.forfeited;
    raid.defenderForce = outcome.defenderForce;
    raid.raiderForce = outcome.raiderForce;
  }

  /** Put a principal out of range until `untilTick`. Latest wins; never shortens. */
  coolVictim(principal: PrincipalId, untilTick: number): void {
    const held = this.victimCooldown.get(principal) ?? -1;
    if (untilTick > held) this.victimCooldown.set(principal, untilTick);
  }

  /** Put a stage out of range until `untilTick`. What a repulse actually buys. */
  holdStage(stage: SystemId, untilTick: number): void {
    const held = this.stageHeld.get(stage) ?? -1;
    if (untilTick > held) this.stageHeld.set(stage, untilTick);
  }

  // ── reading ───────────────────────────────────────────────────────────────

  victimCooledUntil(principal: PrincipalId): number | null {
    return this.victimCooldown.get(principal) ?? null;
  }

  stageHeldUntil(stage: SystemId): number | null {
    return this.stageHeld.get(stage) ?? null;
  }

  isVictimCooling(principal: PrincipalId, tick: number): boolean {
    return (this.victimCooldown.get(principal) ?? -1) > tick;
  }

  isStageHeld(stage: SystemId, tick: number): boolean {
    return (this.stageHeld.get(stage) ?? -1) > tick;
  }

  /** Every raid, in canonical id order. The only sanctioned way to walk the book. */
  all(): readonly RaidRecord[] {
    return [...this.raids.values()].sort((a, b) => compareIds(a.id, b.id));
  }

  live(): readonly RaidRecord[] {
    return this.all().filter((r) => r.state === 'DEMANDED');
  }

  /** Live raids due to resolve at or before `tick`, in canonical order. */
  dueAt(tick: number): readonly RaidRecord[] {
    return this.live().filter((r) => r.resolvesAtTick <= tick);
  }

  /** Raids this principal is the target of, or a party to. What `observe` shows it. */
  forPrincipal(principal: PrincipalId): readonly RaidRecord[] {
    return this.all().filter(
      (r) => r.target === principal || r.parties.some((p) => p.principal === principal),
    );
  }

  liveCount(): number {
    return this.live().length;
  }

  size(): number {
    return this.raids.size;
  }

  /**
   * Every agent-initiated demand in the book, as an aggression spend (§9).
   *
   * The capacity has **no state table of its own** and that is deliberate (`aggression.ts`):
   * the spends are already here, one row each, so a counter would be a second home for a
   * quantity the record already determines — scar #5 — and it would need its own capture, its
   * own restore, and a reset hook at the Reckoning boundary that could drift from the boundary.
   * Derived also means it is right across a restart for free, and A4 forbids uptime being power.
   */
  aggressionSpends(): readonly AggressionSpend[] {
    const out: AggressionSpend[] = [];
    for (const raid of this.all()) {
      if (raid.initiator === null) continue;
      out.push({ initiator: raid.initiator, tick: raid.spawnedAtTick });
    }
    return out;
  }

  /**
   * The next free demand index at `tick`. Deterministic, because {@link all} is ordered and
   * every raid opened at this tick is still in the book (a live row is never pruned, and no
   * later tick can add one to this tick).
   */
  nextDemandIndexAt(tick: number): number {
    const prefix = demandIdPrefix(tick);
    let n = 0;
    for (const raid of this.raids.keys()) {
      if (raid.startsWith(prefix)) n += 1;
    }
    return n;
  }

  /**
   * Drop resolved rows past the retention cap, oldest first.
   *
   * Runs **inside** the hash — called from PREDATE, which is before DERIVE — for the
   * reason `IntentBook.prune` states: dropping a row of a hashed table after DERIVE
   * makes `snapshot_T` describe a book the engine no longer holds, and the replay of
   * `T+1` from that snapshot diverges (DET-3). A live raid is never pruned; a season is
   * 8,064 ticks and an unbounded row set is scar #3.
   *
   * ── AND A PRUNED DEMAND MUST NOT REFUND AGGRESSION CAPACITY ────────────────
   *
   * {@link aggressionSpends} derives §9's capacity by counting rows, so deleting a row of
   * **this** Reckoning would hand the raider its allowance back — an exploit whose only
   * requirement is filling the book, which is exactly the shape A4 forbids (throughput
   * buying power). So this Reckoning's rows are dropped **last**, not never: refusing to
   * drop them at all would let a busy Reckoning push the book past `MAX_RAID_ROWS`, and
   * `PRD-2` halts the world on that. A refunded demand is a calibration failure; a halted
   * world is an outage, and the ordering picks the cheaper one when both cannot be had.
   */
  prune(tick: number): number {
    if (this.raids.size <= MAX_RAID_ROWS) return 0;
    const here = reckoningIndex(tick);
    const resolved = this.all().filter((r) => r.state !== 'DEMANDED');
    const older = resolved.filter((r) => reckoningIndex(r.spawnedAtTick) !== here);
    const thisCycle = resolved.filter((r) => reckoningIndex(r.spawnedAtTick) === here);
    let dropped = 0;
    for (const raid of [...older, ...thisCycle]) {
      if (this.raids.size <= MAX_RAID_ROWS) break;
      this.raids.delete(raid.id);
      dropped += 1;
    }
    return dropped;
  }

  // ── the state table ───────────────────────────────────────────────────────

  capture(): CanonicalValue {
    return {
      raids: this.all().map((r) => ({
        id: r.id,
        // A CAPTURED FIELD, so a demand survives a restart as a demand. Left out, an adopted
        // checkpoint would restore every agent-initiated raid as weather: the raider's spent
        // aggression capacity would come back, and a repulse would start writing the world's
        // stage hold. `RULES_VERSION` 6 -> 7 is this line.
        initiator: r.initiator,
        target: r.target,
        stage: r.stage,
        good: r.good,
        demandQty: r.demandQty,
        force: r.force,
        spawnedAtTick: r.spawnedAtTick,
        resolvesAtTick: r.resolvesAtTick,
        state: r.state,
        answer: r.answer,
        answeredAtTick: r.answeredAtTick,
        resolvedAtTick: r.resolvedAtTick,
        lostQty: r.lostQty,
        forfeited: r.forfeited,
        defenderForce: r.defenderForce,
        raiderForce: r.raiderForce,
        parties: [...r.parties]
          .sort((a, b) => compareIds(a.principal, b.principal))
          .map((p) => ({
            principal: p.principal,
            side: p.side,
            handId: p.handId,
            stake: p.stake,
            encumbranceId: p.encumbranceId,
            joinedAtTick: p.joinedAtTick,
          })),
      })),
      victimCooldown: [...this.victimCooldown.entries()]
        .sort((a, b) => compareIds(a[0], b[0]))
        .map(([principal, tick]) => ({ principal, tick })),
      stageHeld: [...this.stageHeld.entries()]
        .sort((a, b) => compareIds(a[0], b[0]))
        .map(([stage, tick]) => ({ stage, tick })),
    };
  }

  restore(captured: CanonicalValue): void {
    const root = readObject(captured, 'raid');
    this.raids.clear();
    this.victimCooldown.clear();
    this.stageHeld.clear();

    for (const [i, raw] of readArray(root['raids'] ?? [], 'raid.raids').entries()) {
      const where = `raid.raids[${String(i)}]`;
      const o = readObject(raw, where);
      const state = readString(o, 'state', where);
      if (!isRaidState(state)) throw new SnapshotError(`${where}: unknown raid state ${state}`);
      const answer = readEnumOrNull(o, 'answer', where, isRaidAnswer);
      const parties = readArray(o['parties'] ?? [], `${where}.parties`).map((rawParty, j) => {
        const pWhere = `${where}.parties[${String(j)}]`;
        const p = readObject(rawParty, pWhere);
        const side = readString(p, 'side', pWhere);
        if (!isRaidSide(side)) throw new SnapshotError(`${pWhere}: unknown side ${side}`);
        const party: RaidParty = {
          principal: readString(p, 'principal', pWhere) as PrincipalId,
          side,
          handId: readString(p, 'handId', pWhere) as HandId,
          stake: minor(readInt(p, 'stake', pWhere)),
          encumbranceId: readStringOrNullAt(p, 'encumbranceId', pWhere),
          joinedAtTick: readInt(p, 'joinedAtTick', pWhere),
        };
        return party;
      });
      const record: RaidRecord = {
        id: readString(o, 'id', where) as RaidId,
        // Absent reads as `null` — a world raid — because that is what every row written
        // before RULES_VERSION 7 actually was. A default that guessed a principal would
        // attribute the weather to a named agent, permanently (A5′).
        initiator: readStringOrNullAt(o, 'initiator', where) as PrincipalId | null,
        target: readString(o, 'target', where) as PrincipalId,
        stage: readString(o, 'stage', where) as SystemId,
        good: readString(o, 'good', where) as GoodId,
        demandQty: qty(readInt(o, 'demandQty', where)),
        force: readInt(o, 'force', where),
        spawnedAtTick: readInt(o, 'spawnedAtTick', where),
        resolvesAtTick: readInt(o, 'resolvesAtTick', where),
        state,
        answer,
        answeredAtTick: readIntOrNullAt(o, 'answeredAtTick', where),
        parties,
        resolvedAtTick: readIntOrNullAt(o, 'resolvedAtTick', where),
        lostQty: qty(readInt(o, 'lostQty', where)),
        forfeited: minor(readInt(o, 'forfeited', where)),
        defenderForce: readInt(o, 'defenderForce', where),
        raiderForce: readInt(o, 'raiderForce', where),
      };
      this.raids.set(record.id, record);
    }

    for (const [i, raw] of readArray(root['victimCooldown'] ?? [], 'raid.victimCooldown').entries()) {
      const where = `raid.victimCooldown[${String(i)}]`;
      const o = readObject(raw, where);
      this.victimCooldown.set(readString(o, 'principal', where) as PrincipalId, readInt(o, 'tick', where));
    }
    for (const [i, raw] of readArray(root['stageHeld'] ?? [], 'raid.stageHeld').entries()) {
      const where = `raid.stageHeld[${String(i)}]`;
      const o = readObject(raw, where);
      this.stageHeld.set(readString(o, 'stage', where) as SystemId, readInt(o, 'tick', where));
    }
  }
}

const RAID_STATES: ReadonlySet<string> = new Set<RaidState>([
  'DEMANDED',
  'PAID',
  'REPULSED',
  'PLUNDERED',
  'MISSED',
]);
const RAID_SIDES: ReadonlySet<string> = new Set<RaidSide>(['RAIDER', 'DEFENDER']);
const RAID_ANSWERS: ReadonlySet<string> = new Set<RaidAnswer>(['YIELD', 'FIGHT']);

export function isRaidState(s: string): s is RaidState {
  return RAID_STATES.has(s);
}

export function isRaidSide(s: string): s is RaidSide {
  return RAID_SIDES.has(s);
}

export function isRaidAnswer(s: string): s is RaidAnswer {
  return RAID_ANSWERS.has(s);
}

function readStringOrNullAt(
  o: Readonly<Record<string, CanonicalValue>>,
  key: string,
  where: string,
): string | null {
  const value = o[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new SnapshotError(`${where}.${key} must be a string or null`);
  return value;
}

function readIntOrNullAt(
  o: Readonly<Record<string, CanonicalValue>>,
  key: string,
  where: string,
): number | null {
  const value = o[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new SnapshotError(`${where}.${key} must be an integer or null`);
  }
  return value;
}

function readEnumOrNull<T extends string>(
  o: Readonly<Record<string, CanonicalValue>>,
  key: string,
  where: string,
  guard: (s: string) => s is T,
): T | null {
  const value = readStringOrNullAt(o, key, where);
  if (value === null) return null;
  if (!guard(value)) throw new SnapshotError(`${where}.${key}: unknown value ${value}`);
  return value;
}

/**
 * Predation as a state table.
 *
 * `getBook`/`setBook` rather than a captured reference, for the reason the venture, Levy
 * and grant tables take them: the rollback **replaces** the object, and a reader holding
 * the pre-abort book would be talking to a world that no longer exists.
 */
export function raidStateTable(getBook: () => Book, setBook: (book: Book) => void): StateTable {
  return {
    name: 'raid',
    capture(): CanonicalValue {
      return getBook().capture();
    },
    restore(captured: CanonicalValue): void {
      const fresh = new Book();
      fresh.restore(captured);
      setBook(fresh);
    },
  };
}
