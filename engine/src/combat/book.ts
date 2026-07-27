/**
 * The ENGAGEMENT book: which battles are running, who is in them, and what state each combatant is
 * in.
 *
 * ── THE A13 PIXEL SIGNATURE THIS BOOK EXISTS TO FEED: **THE BATTLE LINE** ────
 *
 * A13: *"No feature ships without a named pixel signature."* Predation's is the raid arc; the
 * Levy's is the tribute line; A6's is the authority line. This is the engagement's, and every field
 * below is here because the picture needs it:
 *
 * > At the stage, two lines of bars face each other across a **gap that visibly narrows or widens
 * > every tick**. That gap is the range race and it is the most legible thing on the board: a
 * > brawler fleet drags it shut, a kiting fleet holds it open, and a web wing decides which of them
 * > wins. Each side's bars are stacked in four rows by **ECHELON** — screen at the front, reserve
 * > drawn greyed out behind everything. A bar's width is its hull count and its **height is its EHP
 * > fraction**, so a formation visibly *thins* as it dies rather than vanishing at zero. Four
 * > overlays carry the four force multipliers: a **tether** from a REPAIR formation to whatever it
 * > is mending (draw it, then cut it, and a viewer has learned what logistics is), a **chain** on a
 * > PINNED formation, a **dark bar** on a formation whose capacitor is empty — undamaged and
 * > operationally dead, which `PASS-SHIPS-COMBAT-extended` §1 MUST-3 names as capacitor's whole
 * > story — and a **halo** over the echelon a command formation covers. When a hull dies its
 * > **wreck** mark persists at the stage into AFTERMATH.
 *
 * A viewer with the sound off and the text off can read: how many are on each side, who is winning
 * the range race, who cannot leave, whose repairs just stopped, and who just died. That is the A13
 * test.
 *
 * ── WHY EVERY ONE OF THESE FIELDS IS INSIDE `state_hash` ────────────────────
 *
 * `worksStateTable`'s argument verbatim, and it applies harder here: a book that decides which
 * hulls are destroyed, sitting outside the hash, means two worlds that disagree about who died
 * would hash the same, and an aborted tick would leave hulls wrecked against postings that were
 * rolled back. A5 has no opt-out and A5′ says the record must never be wrong, so a wreck must be
 * exactly as rollback-safe as a posting.
 *
 * ── COHORTS, AND WHY A FORMATION IS NOT ONE HULL ────────────────────────────
 *
 * §2 MUST-2: *"formations with identical fit/state/order automatically coalesce, preventing 'one
 * ship per formation' action spam."* {@link Book.commit} enforces that by keying on
 * `(principal, fitHash, echelon, posture, primary)` — commit a second identical hull and it joins
 * the existing formation rather than making a new row. Damage lands on the cohort and destroys
 * **whole hulls**, routing one hand per wreck, so per-hull ownership and loss survive while the
 * resolver does cohort arithmetic.
 */

import type { CanonicalValue } from '../core/canonical.js';
import type { EngagementState, HandId, PrincipalId, SystemId } from '../core/types.js';
import { compareIds } from '../ledger/order.js';
import type { RaidId, RaidSide } from '../predation/book.js';
import {
  readArray,
  readInt,
  readObject,
  readString,
  SnapshotError,
  type StateTable,
} from '../tick/snapshot.js';
import type { FitHash } from './fit.js';
import type { HullId } from './fleet.js';
import {
  ENGAGEMENT_PHASE_TICKS,
  ENGAGEMENT_RETAIN_TICKS,
  GAP_AT_CONTACT,
  MAX_ENGAGEMENT_ROWS,
  MAX_FORMATIONS_PER_SIDE,
  MAX_TRACE_ENTRIES,
  MAX_WRECKS_PER_ENGAGEMENT,
} from './params.js';

export type { EngagementState };

/** An engagement id, derived from the raid that opened it. One battle per standoff, by construction. */
export type EngagementId = string & { readonly __brand: 'EngagementId' };

export function engagementIdFor(raid: RaidId): EngagementId {
  return `eng:${raid}` as EngagementId;
}

/** A formation id, derived from everything that makes two formations the same one. */
export type FormationId = string & { readonly __brand: 'FormationId' };

export function formationIdFor(
  engagement: EngagementId,
  principal: PrincipalId,
  fit: FitHash,
  echelon: Echelon,
  posture: Posture,
): FormationId {
  return `${engagement}/${principal}/${fit}/${echelon}/${posture}` as FormationId;
}

/**
 * How far behind its own line a formation stands. §7 MUST-1's `depth`, renamed.
 *
 * **Not `depth`**, because §8 already spends that word on a grant's delegation depth and hard rule
 * 4 forbids a second concept on a canon word. ECHELON is the military term for exactly this — a
 * formation drawn up in successive lines — and it is collision-free across the whole corpus.
 */
export const ECHELONS = Object.freeze(['SCREEN', 'MAIN', 'SUPPORT', 'RESERVE'] as const);
export type Echelon = (typeof ECHELONS)[number];

/**
 * A formation's declared closing behaviour, and the input to the range race.
 *
 * §10 MUST-4 maps EVE's *"orbit / spiral / keep at range"* to `posture` + `range_goal` +
 * propulsion, keeping *"relative motion, range, application, cap, scram/web"* causal. Three values
 * rather than a numeric goal, because a numeric goal is a solved optimisation and three postures is
 * a decision: CLOSE drags the gap shut, KITE holds it open, HOLD spends nothing on either and keeps
 * its capacitor.
 */
export const POSTURES = Object.freeze(['CLOSE', 'HOLD', 'KITE'] as const);
export type Posture = (typeof POSTURES)[number];

/**
 * The ordered predicates a formation shoots by. §7 MUST-4's `primary_policy`.
 *
 * *"Policies can name targets or ordered predicates such as `enemy_logistics → command → tackle →
 * lowest_time_to_kill`"*. These are the predicates; the order is the agent's. **This is the field
 * that makes "kill the logi first" a decision an agent gets right or wrong**, and it is why §7
 * MUST-4 says *"coordination becomes power rather than a cosmetic command role."*
 */
export const TARGET_PREDICATES = Object.freeze([
  'REPAIR',
  'COMMAND',
  'TACKLE',
  'EWAR',
  'LINE',
  'WEAKEST',
  'NEAREST',
] as const);
export type TargetPredicate = (typeof TARGET_PREDICATES)[number];

/**
 * When a formation leaves, stated **before** the fight. A3's stop condition, and the reason an
 * offline agent is not a liability here.
 *
 * §7 MUST-7: *"Fleet competence cannot be a function of owner polling budget. Precommitment also
 * creates meaningful promises: an agent can publicly claim it will hold tackle to 50% losses, then
 * defect at 10%."* Both halves matter. The first is why this field exists at all; the second is why
 * it is on the public record — a withdrawal threshold is a promise the ledger can check.
 */
export interface WithdrawWhen {
  /** Leave once the formation's EHP falls below this fraction, in bps. 0 = never on damage. */
  readonly ehpBelowBps: number;
  /** Leave once this many of the formation's hulls are wrecks. 0 = never on losses. */
  readonly hullsLost: number;
  /** Leave immediately. What an explicit retreat order is. */
  readonly now: boolean;
}

export const HOLD_FOREVER: WithdrawWhen = Object.freeze({ ehpBelowBps: 0, hullsLost: 0, now: false });

/** One cohort: identical hulls, identical fit, identical order. */
export interface Formation {
  readonly id: FormationId;
  readonly principal: PrincipalId;
  readonly side: RaidSide;
  readonly fit: FitHash;
  readonly hull: string;
  /**
   * The hands crewing it, one per hull. **The link that makes a wreck cost a hand.**
   *
   * §6.2: hands are *"never destroyed"* — a hand whose hull is wrecked goes RECOVERING at its
   * holding. So the permanent loss is the hull and its modules, and the cost in presence is time.
   * That is the Continuity Core applied to warfare, and it is what lets an unlucky agent lose a
   * fleet without being crippled in the dimension that gates all play.
   */
  hands: HandId[];
  /**
   * The hulls, one per hand, **index-aligned with {@link Formation.hands}**.
   *
   * Two parallel arrays rather than a lookup, because the alternative is a `hullOfHand` port method
   * and that is a second home for the pairing (scar #5). The invariant `hands.length ===
   * hulls.length` is asserted by `OPS-2` rather than hoped for — an off-by-one here would wreck the
   * wrong principal's asset, which is A5′ with somebody else's warship.
   */
  hulls: HullId[];
  echelon: Echelon;
  posture: Posture;
  primary: TargetPredicate[];
  withdrawWhen: WithdrawWhen;
  /** Remaining hit points across the whole cohort. `hulls × fit.ehp` at commit. */
  ehp: number;
  /** Hit points the cohort had when it committed. The denominator of the bar's height. */
  ehpFull: number;
  /** Remaining capacitor across the cohort. */
  cap: number;
  capFull: number;
  /** Tackle strength currently applied to this formation. ≥ PIN_THRESHOLD means it cannot leave. */
  tackledBy: number;
  /** Its MWD is off because something scrammed it. */
  scrammed: boolean;
  /** Mobility reduction applied to it this slice, in bps. */
  webbedBps: number;
  /** Signature increase applied to it, in bps. */
  paintedBps: number;
  /** True while `cap` cannot pay the fit's load. The **dark bar**. */
  capOut: boolean;
  /** It has left the field. Still a row, because the record is append-only. */
  withdrawn: boolean;
  /** Hulls destroyed out of this cohort. */
  hullsLost: number;
  readonly committedAtTick: number;
}

/** A destroyed hull. Permanent, public, priceable — A5, and §7 MUST-9's `loss_record`. */
export interface Wreck {
  readonly formation: FormationId;
  readonly principal: PrincipalId;
  readonly hull: string;
  readonly fit: FitHash;
  readonly hand: HandId;
  /** Which formation's fire did it. `null` when BREAK pursuit or attrition did. */
  readonly killedBy: PrincipalId | null;
  readonly tick: number;
  /** What the record says it was worth. See `WRECK_VALUE_PER_GOOD` on why this is not a market price. */
  readonly value: number;
}

/**
 * One line of the causal explanation. §7 SHOULD-2's `resolution.causes[]`.
 *
 * *"Auto-narration is grounded in the same trace: 'the line did not lack DPS; only 28% applied after
 * its web wing died.'"* The trace is what makes that sentence derivable rather than authored (A12),
 * and it is the difference between a battle a viewer watched and a battle a viewer understood.
 */
export interface TraceEntry {
  readonly tick: number;
  readonly slice: number;
  readonly kind: string;
  readonly actor: FormationId | null;
  readonly target: FormationId | null;
  readonly amount: number;
  /** ≤140 chars, so it is a ticker line for free. */
  readonly note: string;
}

/** Which side holds the field. `null` until AFTERMATH. */
export type FieldControl = RaidSide | 'CONTESTED';

export interface EngagementRecord {
  readonly id: EngagementId;
  /** The standoff that opened it. An engagement never exists without one. */
  readonly raid: RaidId;
  readonly stage: SystemId;
  readonly target: PrincipalId;
  /** `null` when the world's raid opened it — §9's two forms, carried through. */
  readonly initiator: PrincipalId | null;
  /** How many hulls the world brought, or 0 for an agent-initiated raid. */
  readonly worldForce: number;
  readonly openedAtTick: number;
  state: EngagementState;
  /** The tick this state ends. The countdown a viewer reads. */
  phaseEndsTick: number;
  /**
   * How far apart the two lines stand, 0 (CONTACT) to `GAP_MAX` (EXTREME). **The motion on screen.**
   *
   * Contested every slice by posture × effective mobility, deterministically. No dice: §9's
   * *"higher wins deterministically"* applied to the range race, which is what makes a WEB a
   * strategic purchase rather than a lottery ticket.
   */
  gap: number;
  /** `hash(seed)` published when the engagement opens; the seed itself revealed at AFTERMATH (A11). */
  readonly seedCommit: string;
  formations: Formation[];
  wrecks: Wreck[];
  trace: TraceEntry[];
  fieldControl: FieldControl | null;
  resolvedAtTick: number | null;
}

export class EngagementBookError extends Error {}

/** The state each engagement may move to. A total table, so an illegal move is a thrown error. */
const NEXT_STATE: Readonly<Record<EngagementState, EngagementState | null>> = Object.freeze({
  MUSTER: 'CONTACT',
  CONTACT: 'CONTEST',
  CONTEST: 'BREAK',
  BREAK: 'AFTERMATH',
  AFTERMATH: null,
});

/** How long a state lasts. Keyed the same way, so a new state cannot be added without a duration. */
const STATE_TICKS: Readonly<Record<EngagementState, number>> = Object.freeze({
  MUSTER: ENGAGEMENT_PHASE_TICKS.MUSTER,
  CONTACT: ENGAGEMENT_PHASE_TICKS.CONTACT,
  CONTEST: ENGAGEMENT_PHASE_TICKS.CONTEST,
  BREAK: ENGAGEMENT_PHASE_TICKS.BREAK,
  AFTERMATH: ENGAGEMENT_PHASE_TICKS.AFTERMATH,
});

export class Book {
  private readonly rows = new Map<EngagementId, EngagementRecord>();

  // ── Writes ────────────────────────────────────────────────────────────────

  /** Open an engagement. Throws on a duplicate: two battles over one standoff is not a state. */
  open(record: EngagementRecord): void {
    if (this.rows.has(record.id)) {
      throw new EngagementBookError(`engagement ${record.id} already exists`);
    }
    if (this.rows.size >= MAX_ENGAGEMENT_ROWS) {
      throw new EngagementBookError(
        `the engagement book holds ${String(MAX_ENGAGEMENT_ROWS)} rows and prune has not run`,
      );
    }
    this.rows.set(record.id, record);
  }

  /**
   * Commit hulls, coalescing into an existing identical formation.
   *
   * Returns the formation the hull joined. The coalescing key is the formation id itself, which is
   * derived from every field that makes two cohorts interchangeable — so this cannot drift from the
   * definition of "the same formation".
   */
  commit(args: {
    readonly engagement: EngagementId;
    readonly principal: PrincipalId;
    readonly side: RaidSide;
    readonly fit: FitHash;
    readonly hull: string;
    readonly hand: HandId;
    readonly hullId: HullId;
    readonly echelon: Echelon;
    readonly posture: Posture;
    readonly primary: readonly TargetPredicate[];
    readonly withdrawWhen: WithdrawWhen;
    readonly ehpPerHull: number;
    readonly capPerHull: number;
    readonly tick: number;
  }): Formation {
    const record = this.require(args.engagement);
    const id = formationIdFor(args.engagement, args.principal, args.fit, args.echelon, args.posture);
    const existing = record.formations.find((f) => f.id === id);
    if (existing !== undefined) {
      if (existing.hands.includes(args.hand)) {
        throw new EngagementBookError(`hand ${args.hand} is already in formation ${id}`);
      }
      existing.hands.push(args.hand);
      existing.hulls.push(args.hullId);
      existing.ehp += args.ehpPerHull;
      existing.ehpFull += args.ehpPerHull;
      existing.cap += args.capPerHull;
      existing.capFull += args.capPerHull;
      return existing;
    }
    const sideCount = record.formations.filter((f) => f.side === args.side).length;
    if (sideCount >= MAX_FORMATIONS_PER_SIDE) {
      throw new EngagementBookError(
        `the ${args.side} side already fields ${String(MAX_FORMATIONS_PER_SIDE)} formations, which is the cap`,
      );
    }
    const formation: Formation = {
      id,
      principal: args.principal,
      side: args.side,
      fit: args.fit,
      hull: args.hull,
      hands: [args.hand],
      hulls: [args.hullId],
      echelon: args.echelon,
      posture: args.posture,
      primary: [...args.primary],
      withdrawWhen: args.withdrawWhen,
      ehp: args.ehpPerHull,
      ehpFull: args.ehpPerHull,
      cap: args.capPerHull,
      capFull: args.capPerHull,
      tackledBy: 0,
      scrammed: false,
      webbedBps: 0,
      paintedBps: 0,
      capOut: false,
      withdrawn: false,
      hullsLost: 0,
      committedAtTick: args.tick,
    };
    record.formations.push(formation);
    record.formations.sort((a, b) => compareIds(a.id, b.id));
    return formation;
  }

  /**
   * Restate a formation's standing order. **The only thing `engage` does after MUSTER.**
   *
   * A3: *"Creating or amending [an intent] costs an action; its routine ticks do not."* Note what
   * is *not* restatable: echelon and posture are part of the formation's identity, so changing them
   * would change which cohort it is. An agent that wants a different echelon commits a different
   * hull there — which is the *"formations with identical fit/state/order coalesce"* rule read
   * backwards, and it is what stops an order from being a free repositioning teleport.
   */
  reorder(args: {
    readonly engagement: EngagementId;
    readonly formation: FormationId;
    readonly primary: readonly TargetPredicate[];
    readonly withdrawWhen: WithdrawWhen;
  }): Formation {
    const record = this.require(args.engagement);
    const formation = record.formations.find((f) => f.id === args.formation);
    if (formation === undefined) {
      throw new EngagementBookError(`engagement ${args.engagement} has no formation ${args.formation}`);
    }
    formation.primary = [...args.primary];
    formation.withdrawWhen = args.withdrawWhen;
    return formation;
  }

  /** Advance to the next state, stamping its end tick. Returns the new state, or `null` at AFTERMATH. */
  advance(id: EngagementId, tick: number): EngagementState | null {
    const record = this.require(id);
    const next = NEXT_STATE[record.state];
    if (next === null) return null;
    record.state = next;
    record.phaseEndsTick = tick + STATE_TICKS[next];
    if (next === 'CONTEST') record.gap = GAP_AT_CONTACT;
    return next;
  }

  /** Close it, publishing field control. Idempotent on the state, because a double close is a bug. */
  close(id: EngagementId, control: FieldControl, tick: number): void {
    const record = this.require(id);
    if (record.resolvedAtTick !== null) {
      throw new EngagementBookError(`engagement ${id} already closed at tick ${String(record.resolvedAtTick)}`);
    }
    record.state = 'AFTERMATH';
    record.fieldControl = control;
    record.resolvedAtTick = tick;
  }

  /** Record a wreck. Bounded: a battle that destroyed more than the cap says so in the count. */
  wreck(id: EngagementId, wreck: Wreck): boolean {
    const record = this.require(id);
    if (record.wrecks.length >= MAX_WRECKS_PER_ENGAGEMENT) return false;
    record.wrecks.push(wreck);
    return true;
  }

  /** Append to the causal trace. Bounded, and the oldest entries win — a battle's opening explains it. */
  trace(id: EngagementId, entry: TraceEntry): void {
    const record = this.require(id);
    if (record.trace.length >= MAX_TRACE_ENTRIES) return;
    record.trace.push(entry);
  }

  /**
   * Drop settled rows once they can no longer be read.
   *
   * Settled-this-Reckoning rows are kept, exactly as `predation/book.ts` keeps them: the frame at
   * the Reckoning renders them, and a prune that ran first would publish a battle that left no
   * trace of having happened.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE CUTOFF WAS `AFTERMATH + 1` = TWO TICKS, AND THAT MADE TWO PUBLISHED CLAIMS FALSE ON ANY
   * WORLD OLD ENOUGH TO FILL THIS BOOK.**
   *
   * Two readers outlive a resolved engagement by design, and both of them are downstream of a row
   * this loop was entitled to delete:
   *
   *   1. **{@link BATTLE_LINE_RETAIN_TICKS}** is `TICKS_PER_RECKONING` = 288, because the published
   *      frame is the *Reckoning* frame and a battle is 22 ticks of 288 (`params.ts` carries the
   *      measurement: at two ticks a battle that destroyed three hulls appeared on **no** frame).
   *      A two-tick prune made that constant a decoration — `battleLinesFor` would filter over rows
   *      that had already been deleted.
   *   2. **{@link import('./battle.js').worldForceLeft}**, which `readForce` asks at the *raid's*
   *      resolution. A standoff answered FIGHT on the tick it spawned closes its battle at
   *      spawn + `ENGAGEMENT_TICKS` (22) and resolves at spawn + `DEMAND_WINDOW_TICKS` (24) — so
   *      the row is exactly **two** ticks old when the number is read, landing precisely on the old
   *      cutoff. A pruned row reports `null`, the drawn scalar stands, and the defender that
   *      destroyed the world's whole fleet loses the standoff again. Silently, and only once the
   *      book is over half full — a defect that appears after a few thousand ticks of production and
   *      in no test.
   *
   * So the window is the longer of the two, stated as {@link ENGAGEMENT_RETAIN_TICKS} rather than
   * spelled here, and `assertEngagementSchedule` refuses a build where it is shorter than either
   * reader needs. The bound INV-26 wants is unaffected: {@link MAX_ENGAGEMENT_ROWS}` / 2` still
   * stops the walk, so the book cannot be forced to grow by keeping rows longer — it can only be
   * forced to keep *older* rows, and `MAX_LIVE_ENGAGEMENTS` = 4 caps how fast they arrive.
   * ══════════════════════════════════════════════════════════════════════════
   */
  prune(tick: number): number {
    const cutoff = tick - ENGAGEMENT_RETAIN_TICKS - 1;
    let dropped = 0;
    for (const id of [...this.rows.keys()].sort(compareIds)) {
      const row = this.rows.get(id);
      if (row === undefined) continue;
      if (row.resolvedAtTick === null) continue;
      if (row.resolvedAtTick > cutoff) continue;
      if (this.rows.size <= MAX_ENGAGEMENT_ROWS / 2) break;
      this.rows.delete(id);
      dropped += 1;
    }
    return dropped;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  get(id: EngagementId): EngagementRecord | undefined {
    return this.rows.get(id);
  }

  require(id: EngagementId): EngagementRecord {
    const row = this.rows.get(id);
    if (row === undefined) throw new EngagementBookError(`no engagement ${id}`);
    return row;
  }

  /** Is there a live battle over this standoff? The predicate `liveObligations` needs. */
  isLive(id: string): boolean {
    const row = this.rows.get(id as EngagementId);
    return row !== undefined && row.resolvedAtTick === null;
  }

  /** Every row, in canonical id order. The only sanctioned walk. */
  all(): readonly EngagementRecord[] {
    return [...this.rows.values()].sort((a, b) => compareIds(a.id, b.id));
  }

  live(): readonly EngagementRecord[] {
    return this.all().filter((r) => r.resolvedAtTick === null);
  }

  liveCount(): number {
    return this.live().length;
  }

  /** Engagements this principal has a formation in, or is the target of. */
  forPrincipal(principal: PrincipalId): readonly EngagementRecord[] {
    return this.all().filter(
      (r) => r.target === principal || r.initiator === principal || r.formations.some((f) => f.principal === principal),
    );
  }

  /** The engagement over a given raid, if any. One battle per standoff. */
  forRaid(raid: RaidId): EngagementRecord | undefined {
    return this.rows.get(engagementIdFor(raid));
  }

  /** Formations a principal commands in one engagement, canonical order. */
  formationsOf(id: EngagementId, principal: PrincipalId): readonly Formation[] {
    const row = this.rows.get(id);
    if (row === undefined) return [];
    return row.formations.filter((f) => f.principal === principal);
  }

  /** Hands this principal has committed to any live engagement. What `engage` must not double-book. */
  committedHands(principal: PrincipalId): ReadonlySet<HandId> {
    const out = new Set<HandId>();
    for (const row of this.live()) {
      for (const formation of row.formations) {
        if (formation.principal !== principal) continue;
        for (const hand of formation.hands) out.add(hand);
      }
    }
    return out;
  }

  size(): number {
    return this.rows.size;
  }

  // ── Snapshot ──────────────────────────────────────────────────────────────

  capture(): CanonicalValue {
    return {
      engagements: this.all().map((r) => ({
        id: r.id,
        raid: r.raid,
        stage: r.stage,
        target: r.target,
        initiator: r.initiator,
        worldForce: r.worldForce,
        openedAtTick: r.openedAtTick,
        state: r.state,
        phaseEndsTick: r.phaseEndsTick,
        gap: r.gap,
        seedCommit: r.seedCommit,
        fieldControl: r.fieldControl,
        resolvedAtTick: r.resolvedAtTick,
        formations: r.formations.map((f) => ({
          id: f.id,
          principal: f.principal,
          side: f.side,
          fit: f.fit,
          hull: f.hull,
          // NOT sorted: `hands` and `hulls` are index-aligned, so a sort on one would silently
          // re-pair every hand with someone else's hull across a restart. Commit order is already
          // deterministic (the tick queue orders by `(priority, principal_id, client_sequence)`),
          // so insertion order is canonical here and sorting would be the bug rather than the fix.
          hands: [...f.hands],
          hulls: [...f.hulls],
          echelon: f.echelon,
          posture: f.posture,
          primary: [...f.primary],
          withdrawEhpBelowBps: f.withdrawWhen.ehpBelowBps,
          withdrawHullsLost: f.withdrawWhen.hullsLost,
          withdrawNow: f.withdrawWhen.now,
          ehp: f.ehp,
          ehpFull: f.ehpFull,
          cap: f.cap,
          capFull: f.capFull,
          tackledBy: f.tackledBy,
          scrammed: f.scrammed,
          webbedBps: f.webbedBps,
          paintedBps: f.paintedBps,
          capOut: f.capOut,
          withdrawn: f.withdrawn,
          hullsLost: f.hullsLost,
          committedAtTick: f.committedAtTick,
        })),
        wrecks: r.wrecks.map((w) => ({
          formation: w.formation,
          principal: w.principal,
          hull: w.hull,
          fit: w.fit,
          hand: w.hand,
          killedBy: w.killedBy,
          tick: w.tick,
          value: w.value,
        })),
        trace: r.trace.map((t) => ({
          tick: t.tick,
          slice: t.slice,
          kind: t.kind,
          actor: t.actor,
          target: t.target,
          amount: t.amount,
          note: t.note,
        })),
      })),
    };
  }

  restore(captured: CanonicalValue): void {
    this.rows.clear();
    const root = readObject(captured, 'engagement');
    for (const [i, raw] of readArray(root['engagements'] ?? [], 'engagement.engagements').entries()) {
      const where = `engagement.engagements[${String(i)}]`;
      const o = readObject(raw, where);
      const initiator = o['initiator'];
      const control = o['fieldControl'];
      const resolved = o['resolvedAtTick'];
      const row: EngagementRecord = {
        id: readString(o, 'id', where) as EngagementId,
        raid: readString(o, 'raid', where) as RaidId,
        stage: readString(o, 'stage', where) as SystemId,
        target: readString(o, 'target', where) as PrincipalId,
        initiator: initiator === null || initiator === undefined ? null : (readString(o, 'initiator', where) as PrincipalId),
        worldForce: readInt(o, 'worldForce', where),
        openedAtTick: readInt(o, 'openedAtTick', where),
        state: asState(readString(o, 'state', where), where),
        phaseEndsTick: readInt(o, 'phaseEndsTick', where),
        gap: readInt(o, 'gap', where),
        seedCommit: readString(o, 'seedCommit', where),
        formations: [],
        wrecks: [],
        trace: [],
        fieldControl: control === null || control === undefined ? null : (readString(o, 'fieldControl', where) as FieldControl),
        resolvedAtTick: resolved === null || resolved === undefined ? null : readInt(o, 'resolvedAtTick', where),
      };
      for (const [j, rawF] of readArray(o['formations'] ?? [], `${where}.formations`).entries()) {
        const fw = `${where}.formations[${String(j)}]`;
        const f = readObject(rawF, fw);
        row.formations.push({
          id: readString(f, 'id', fw) as FormationId,
          principal: readString(f, 'principal', fw) as PrincipalId,
          side: readString(f, 'side', fw) as RaidSide,
          fit: readString(f, 'fit', fw) as FitHash,
          hull: readString(f, 'hull', fw),
          hands: readArray(f['hands'] ?? [], `${fw}.hands`).map((h, k) =>
            readString({ h }, 'h', `${fw}.hands[${String(k)}]`) as HandId,
          ),
          hulls: readArray(f['hulls'] ?? [], `${fw}.hulls`).map((h, k) =>
            readString({ h }, 'h', `${fw}.hulls[${String(k)}]`) as HullId,
          ),
          echelon: readString(f, 'echelon', fw) as Echelon,
          posture: readString(f, 'posture', fw) as Posture,
          primary: readArray(f['primary'] ?? [], `${fw}.primary`).map(
            (p, k) => readString({ p }, 'p', `${fw}.primary[${String(k)}]`) as TargetPredicate,
          ),
          withdrawWhen: {
            ehpBelowBps: readInt(f, 'withdrawEhpBelowBps', fw),
            hullsLost: readInt(f, 'withdrawHullsLost', fw),
            now: f['withdrawNow'] === true,
          },
          ehp: readInt(f, 'ehp', fw),
          ehpFull: readInt(f, 'ehpFull', fw),
          cap: readInt(f, 'cap', fw),
          capFull: readInt(f, 'capFull', fw),
          tackledBy: readInt(f, 'tackledBy', fw),
          scrammed: f['scrammed'] === true,
          webbedBps: readInt(f, 'webbedBps', fw),
          paintedBps: readInt(f, 'paintedBps', fw),
          capOut: f['capOut'] === true,
          withdrawn: f['withdrawn'] === true,
          hullsLost: readInt(f, 'hullsLost', fw),
          committedAtTick: readInt(f, 'committedAtTick', fw),
        });
      }
      for (const [j, rawW] of readArray(o['wrecks'] ?? [], `${where}.wrecks`).entries()) {
        const ww = `${where}.wrecks[${String(j)}]`;
        const w = readObject(rawW, ww);
        const killedBy = w['killedBy'];
        row.wrecks.push({
          formation: readString(w, 'formation', ww) as FormationId,
          principal: readString(w, 'principal', ww) as PrincipalId,
          hull: readString(w, 'hull', ww),
          fit: readString(w, 'fit', ww) as FitHash,
          hand: readString(w, 'hand', ww) as HandId,
          killedBy: killedBy === null || killedBy === undefined ? null : (readString(w, 'killedBy', ww) as PrincipalId),
          tick: readInt(w, 'tick', ww),
          value: readInt(w, 'value', ww),
        });
      }
      for (const [j, rawT] of readArray(o['trace'] ?? [], `${where}.trace`).entries()) {
        const tw = `${where}.trace[${String(j)}]`;
        const t = readObject(rawT, tw);
        const actor = t['actor'];
        const target = t['target'];
        row.trace.push({
          tick: readInt(t, 'tick', tw),
          slice: readInt(t, 'slice', tw),
          kind: readString(t, 'kind', tw),
          actor: actor === null || actor === undefined ? null : (readString(t, 'actor', tw) as FormationId),
          target: target === null || target === undefined ? null : (readString(t, 'target', tw) as FormationId),
          amount: readInt(t, 'amount', tw),
          note: readString(t, 'note', tw),
        });
      }
      if (this.rows.has(row.id)) throw new SnapshotError(`${where}: duplicate engagement ${row.id}`);
      this.rows.set(row.id, row);
    }
  }
}

function asState(value: string, where: string): EngagementState {
  if (Object.prototype.hasOwnProperty.call(NEXT_STATE, value)) return value as EngagementState;
  throw new SnapshotError(`${where}.state: ${value} is not an engagement state`);
}

export function isEchelon(value: string): value is Echelon {
  return (ECHELONS as readonly string[]).includes(value);
}

export function isPosture(value: string): value is Posture {
  return (POSTURES as readonly string[]).includes(value);
}

export function isTargetPredicate(value: string): value is TargetPredicate {
  return (TARGET_PREDICATES as readonly string[]).includes(value);
}

/**
 * The engagement book inside `state_hash` and the rollback set.
 *
 * `getBook`/`setBook` rather than a captured reference, because rollback **replaces** the object —
 * `raidStateTable`'s comment, and the same trap.
 */
export function engagementStateTable(getBook: () => Book, setBook: (book: Book) => void): StateTable {
  return {
    name: 'engagement',
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
