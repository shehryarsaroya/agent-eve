/**
 * The house cast — heuristic principals that keep the world from being empty.
 *
 * SPEC §15.6: *"you cannot cast a show you do not fund"*. Agents bring their own
 * inference, which is what makes hundreds affordable, but a world whose external
 * agents have all gone quiet has no show in it. So the house runs a permanent cast
 * on its own keys, and — the part that matters mechanically — **heuristics fill
 * unfilled role slots so ventures always resolve.** A venture that never fills is
 * a story that never happens, and §7.2's concurrency rule means one unfilled slot
 * kills the whole thing.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **EVERY DRAW COMES FROM `Rng`.** `Math.random` is banned by lint (DET-7) and the
 * ban is not about tidiness: the cast is inside the tick, so a single unseeded draw
 * makes the whole world unreplayable, and replay is the only thing that makes a
 * permanent public record trustworthy. Each bot derives its own sub-stream from the
 * tick's seed by label, so adding a bot cannot shift another bot's draws — or every
 * golden file moves and it reads as a balance regression.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The cast is **`HEURISTIC`**, and it says so in every action's `decision_source`.
 * That honesty is what makes `GET /health` able to catch scar #14b: if the LLM
 * players fall back, the deciding share collapses and the health check fails. A
 * cast that labelled itself `LIVE` would make the one measurement that catches the
 * silent failure permanently green.
 */

import { Rng } from '../core/rng.js';
import type { PrincipalId, SystemId, VentureKind } from '../core/types.js';
import { compareIds } from '../ledger/index.js';
import { IN_FULL, openIndices, roleOfPrincipal } from '../venture/index.js';
import { handsOf, tierOf } from '../world/index.js';
import { reckoningOf, type Runtime } from '../sim/runtime.js';
import type { SubmittedAction } from '../tick/index.js';

/**
 * Named cast members. §15.6: "a permanent cast of 12–20 named principals".
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **NO NAME HERE MAY APPEAR AS A HANDLE IN `agent.md`.** A principal id is derived
 * from its handle, so a cast name that `agent.md` uses as a worked example is a handle
 * a first-time agent will send verbatim and be refused for — and, before the enrol
 * handler was fixed, was a handle that bound the caller's key to a house-cast
 * principal outright (see the A5′ note in `src/api/server.ts`).
 *
 * This list previously began with `vale`, which is exactly the handle `agent.md` §2
 * uses in `{ "handle": "vale" }` and in `vale@agenttransfer.dev`. `agent.md` is the
 * contract and does not move, so the cast does.
 * `test/cast/heuristic.test.ts` parses the document and asserts the disjointness, so
 * the next name added cannot quietly re-close the trap.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const CAST_NAMES: readonly string[] = Object.freeze([
  'varrow',
  'halcyon',
  'vex',
  'brannock',
  'sable',
  'orrin',
  'thessaly',
  'kestrel',
  'dunmore',
  'ferren',
  'ashlin',
  'corvid',
  'marrow',
  'quill',
  'severin',
  'tolen',
  'wren',
  'ysolde',
  'bram',
  'cassian',
]);

export const MAX_CAST = CAST_NAMES.length;

/**
 * What a bot is for.
 *
 * Lower case deliberately: `RAIDER` and `ESCORT` are `RoleLabel` members and
 * `RAID`/`ESCORT` are `VentureKind` members, and a third ALL-CAPS union sharing
 * those words would be one word doing three jobs (§3, and the repo-wide vocabulary
 * guard would catch it — which is the point of writing it this way first).
 */
export type CastRole = 'digger' | 'hauler' | 'escort' | 'raider';

export const CAST_ROLES: readonly CastRole[] = Object.freeze(['digger', 'hauler', 'escort', 'raider']);

/** Which kind each role creates when it decides to start something. */
const CREATES: Readonly<Record<CastRole, VentureKind>> = Object.freeze({
  digger: 'DIG',
  hauler: 'HAUL',
  escort: 'ESCORT',
  raider: 'RAID',
});

export interface CastMember {
  readonly principal: PrincipalId;
  readonly handle: string;
  readonly role: CastRole;
  /** Where it was seated. Raiders sit outside the Commons, or they can never act. */
  readonly seat: SystemId;
}

export interface CastOptions {
  /** How many to seat. Capped at {@link MAX_CAST}. */
  readonly size: number;
  /**
   * Chance in 10 000 that a member creates a venture on a tick it has nothing else
   * to do. Integers only: a float here would be a float in a hashed path the moment
   * anybody put the cast's state into a snapshot.
   */
  readonly createChanceBps?: number;
}

/** Default appetite. *(calibrate)* — high enough that a day has ventures in it. */
export const DEFAULT_CREATE_CHANCE_BPS = 2_000;

/**
 * The cast, as a deterministic policy over the world.
 *
 * Stateless with respect to its own decisions: everything it needs is in the world
 * and the venture book, so it cannot drift out of sync with them and it needs no
 * state table of its own. The only state it holds is the roster.
 */
export class HeuristicCast {
  private readonly members: CastMember[] = [];

  constructor(
    private readonly runtime: Runtime,
    private readonly options: CastOptions,
  ) {}

  get roster(): readonly CastMember[] {
    return this.members;
  }

  /**
   * Seat the cast.
   *
   * Raiders are seated in the MARCHES on purpose. In the Commons a hostile act is
   * **invalid, not punished** (A8), so a raider seated there would have every
   * `RAID` it ever created refused by the floor — a bot that looks like it is
   * playing and cannot, which is the least debuggable kind of quiet.
   */
  seat(seed: string): readonly CastMember[] {
    const rng = Rng.fromSeed(`${seed}:cast:seating`);
    const size = Math.max(0, Math.min(this.options.size, MAX_CAST));
    for (let i = 0; i < size; i += 1) {
      const handle = CAST_NAMES[i];
      if (handle === undefined) break;
      const role = CAST_ROLES[i % CAST_ROLES.length];
      if (role === undefined) break;
      const tier = role === 'raider' ? 'MARCHES' : 'COMMONS';
      const seat = this.runtime.seatInTier(tier, rng.derive(`seat:${handle}`));
      if (seat === undefined) continue;
      const principal = `p:${handle}` as PrincipalId;
      this.runtime.seat(principal, handle, seat);
      this.members.push({ principal, handle, role, seat });
    }
    this.members.sort((a, b) => compareIds(a.principal, b.principal));
    return this.members;
  }

  /**
   * Decide this tick, for every member, in canonical order.
   *
   * Returns submissions rather than submitting them, so the caller owns ordering
   * and the cast cannot smuggle in an arrival-order advantage. The engine orders by
   * `(priority, principal_id, client_sequence)` anyway, and handing back a list is
   * what lets a test shuffle it and prove that.
   */
  decide(tick: number, seed: string): readonly SubmittedAction[] {
    const out: SubmittedAction[] = [];
    for (const member of this.members) {
      const rng = Rng.fromSeed(`${seed}:cast:${member.principal}:${String(tick)}`);
      const action = this.decideOne(member, tick, rng, out.length);
      if (action !== null) out.push(action);
    }
    return out;
  }

  /**
   * One member's move, in priority order.
   *
   *   1. **Sign what is waiting on you.** Nothing binds until every party
   *      countersigns, so an unsigned venture is a venture that cannot go live.
   *   2. **Fill somebody's open role.** This is the clause §15.6 actually asks for:
   *      heuristics fill unfilled slots so ventures always resolve.
   *   3. **Seal a role you hold.** Free, mandatory, and the reveal is the show.
   *   4. **Create something**, occasionally, so the board is never empty.
   *   5. **Move an idle hand**, so the map has motion in it (A13).
   */
  private decideOne(
    member: CastMember,
    tick: number,
    rng: Rng,
    ordinal: number,
  ): SubmittedAction | null {
    const runtime = this.runtime;
    const base = {
      principal: member.principal,
      clientSequence: ordinal,
      // Nothing in the engine reads this. It exists so the A4 audit can compare
      // arrival order against resolution order and show no correlation.
      arrivalMs: tick,
      decisionSource: 'HEURISTIC' as const,
    };

    for (const venture of runtime.ventures.forPrincipal(member.principal)) {
      if (venture.state !== 'FORMING') continue;
      if (venture.termsHash === null) continue;
      if (venture.countersigned.has(member.principal)) continue;
      return {
        ...base,
        verb: 'sign',
        params: {
          venture: venture.id,
          terms_hash: venture.termsHash,
          // ── The election, and it is the payer's choice, not the engine's ──────
          //
          // Only the creator may elect, because the elective half is paid out of its
          // own stores. `IN_FULL` rather than the figure it was quoted: on a share
          // role the due is not knowable until the residual is drawn, so an agent
          // that elects the number it signed for is electing *less than it owes* on
          // any venture that over-performs — and the record would show it declined
          // the difference (§7.1, and the trap `agent.md` §4 spells out).
          //
          // **A bot that always honours cannot answer §7.6.** This cast is honest by
          // policy, which exercises the honoured branch and the standing that accrues
          // to it; the default branch is reached the other way — a payer whose stores
          // cannot cover the elective part at settlement, which is `UNFUNDED` and is a
          // different row from a refusal. Whether betrayal is *rational* is a question
          // only agents that reason can answer, and the falsification probes are where
          // it gets asked.
          ...(venture.creator === member.principal ? { election: IN_FULL } : {}),
        },
      };
    }

    const idle = handsOf(runtime.world, member.principal).filter((h) => h.state === 'IDLE');
    if (idle.length > 0) {
      const slot = this.openSlotFor(member, tick);
      const hand = idle[0];
      if (slot !== null && hand !== undefined) {
        return {
          ...base,
          verb: 'fill_role',
          params: { venture: slot.venture, role: slot.role, hand: hand.id, stake: 0 },
        };
      }
    }

    // Sealing is only attempted when the verb is live. It is deliberately not, until
    // the Reckoning driver resolves seals (see the note in `src/sim/runtime.ts`), and a
    // bot that tried anyway would generate one refusal per tick forever — which reads
    // in the logs exactly like a rules-surface defect (AGT-S3) and would bury the real
    // ones. The branch stays, gated, so turning the verb on turns the behaviour on.
    for (const venture of runtime.liveVerbs.has('seal')
      ? runtime.ventures.forPrincipal(member.principal)
      : []) {
      const role = roleOfPrincipal(venture, member.principal);
      if (role === null) continue;
      if (venture.state !== 'LIVE' && venture.state !== 'FORMING') continue;
      const held = [{ venture: venture.id, roleIndex: role.index }];
      if (runtime.seals.freeSlotsRemaining(member.principal, reckoningOf(tick), held) === 0) continue;
      return {
        ...base,
        verb: 'seal',
        params: {
          verb: 'sign',
          // `target` names the venture and `role` names the slot, so the free slot
          // the engine charges is the one this bot's own arithmetic checked.
          target: venture.id,
          role: role.index,
          measure: 'MINOR',
          outcome_low: 0,
          outcome_high: role.terms.escrowed + role.terms.elective,
        },
      };
    }

    const appetite = this.options.createChanceBps ?? DEFAULT_CREATE_CHANCE_BPS;
    if (idle.length > 0 && rng.chance(appetite, 10_000)) {
      const hand = idle[0];
      if (hand !== undefined) {
        const kind = CREATES[member.role];
        return {
          ...base,
          verb: 'create',
          params: {
            kind,
            stage: hand.location,
            // A hostile kind must name what it is aimed at, or the Commons floor
            // refuses it for naming nothing — correct fail-closed behaviour, and a
            // bot that never names a target is a bot whose every raid is refused.
            ...(kind === 'RAID' || kind === 'SIEGE' ? { target_system: hand.location } : {}),
          },
        };
      }
    }

    if (idle.length > 0) {
      const hand = idle[rng.int(idle.length)];
      if (hand !== undefined) {
        const system = runtime.world.map.systems.get(hand.location);
        if (system !== undefined && system.lanes.length > 0) {
          // Stay in the tier it was seated in: a Commons-bound principal may only
          // move between Commons systems (A15), and a refused move is a wasted bot.
          const home = tierOf(runtime.world.map, member.seat);
          const legal = [...system.lanes]
            .filter((lane) => tierOf(runtime.world.map, lane) === home)
            .sort(compareIds);
          const lane = legal.length === 0 ? undefined : legal[rng.int(legal.length)];
          if (lane !== undefined) {
            return { ...base, verb: 'move', params: { hand: hand.id, to: lane } };
          }
        }
      }
    }
    return null;
  }

  /**
   * The first open slot this member is eligible for.
   *
   * Eligibility, not preference: one principal fills at most one role in a venture
   * (PROP-V6), and a bot that requested a second role in a venture it already holds
   * would generate a refusal every tick forever — which reads in the logs exactly
   * like a rules-surface defect (AGT-S3).
   */
  private openSlotFor(
    member: CastMember,
    tick: number,
  ): { readonly venture: string; readonly role: number } | null {
    for (const venture of this.runtime.ventures.live()) {
      if (venture.state !== 'FORMING') continue;
      if (tick > venture.windowClosesTick) continue;
      if (venture.creator === member.principal) continue;
      if (roleOfPrincipal(venture, member.principal) !== null) continue;
      // A hostile venture in the Commons can never be filled, so do not try.
      if (tierOf(this.runtime.world.map, venture.stage) !== tierOf(this.runtime.world.map, member.seat)) {
        continue;
      }
      const open = openIndices(venture);
      const first = open[0];
      if (first === undefined) continue;
      return { venture: venture.id, role: first };
    }
    return null;
  }
}
