/**
 * The action budget: `ACTIONS_PER_TICK` material acts, social verbs free.
 *
 * A4, and it is High Water's scar #2 made structural. There, with no
 * engine-owned budget, "wealth was determined by requests-per-second, not
 * judgment" — the validated fix was pattern 6: *bound material actions per agent
 * per tick; leave talk, deals and voting free.*
 *
 * **The budget is engine-owned.** It lives here, inside the tick, and not in the
 * HTTP layer, because a budget enforced at the transport is a budget an
 * in-process cast, a delegate, or a standing intent walks straight past — and
 * SCAR-2's own test is "engine-owned action budget; social verbs free".
 *
 * The free set is a rules surface and is deliberately short. Each entry has a
 * reason, and the reasons are not interchangeable:
 *
 *   - `message` — §7.3's hosted negotiation. Charging for talk starves the
 *     receipt reel, which is the best artifact in the design (§14).
 *   - `claim` / `deny` — the `say` group. Words never bind and never harm
 *     (scar #8), so metering them buys nothing and costs the ticker its corpus.
 *   - `vote` — the Levy allocation, seizure and syndicate ballots. A charged vote
 *     competes with *paying* the Levy in the same budget, which would let an
 *     agent be priced out of the civic act A14 depends on happening.
 *
 * Everything else costs one, including the ones that look free:
 *
 *   - `scan` is **not** free. It is information, and unmetered information is
 *     throughput becoming power by a different route (A4). §12.1's free services
 *     are read-only *derivations of what you can already see*; `scan` reaches.
 *   - `seal` is **conditionally** free, and neither extreme is right. §17 gives
 *     seals their own allowance — "one free per role held" — and `agent.md` promises
 *     it in those words. Listing `seal` in `FREE_VERBS` would make EVERY seal free
 *     and delete the allowance; leaving it out charged for the first one and made
 *     `agent.md` a lie, which is scar #1 with the doc on the losing side.
 *
 *     So the allowance stays in the seals module — one home for one quantity, no
 *     scar #5 — and the budget ASKS. `charge` takes an optional `withinAllowance`
 *     flag that the caller sets from the seals ledger. The budget owns metering; the
 *     seals book owns the allowance; the promise is kept.
 */

import { ACTIONS_PER_TICK } from '../core/time.js';
import type { PrincipalId } from '../core/types.js';
import { compareIds } from '../ledger/index.js';
import { reject, type Rejection } from '../world/index.js';

/** What an action costs against the per-tick budget. */
export type ActionCost = 'MATERIAL' | 'FREE';

/**
 * Verbs that never consume the budget. Exact spellings from SPEC §12.2; a verb
 * not named here is material, so a new verb fails closed into being metered.
 */
export const FREE_VERBS: ReadonlySet<string> = new Set(['message', 'claim', 'deny', 'vote']);

export function costOf(verb: string): ActionCost {
  return FREE_VERBS.has(verb) ? 'FREE' : 'MATERIAL';
}

/**
 * Per-principal material spend for one tick.
 *
 * Holds the current tick only. A per-tick map kept forever is 288 rows per
 * principal per day for a season, which is scar #3 in slow motion; the running
 * totals below are per *principal*, so they are bounded by the seat count.
 */
export class ActionBudget {
  private tick = -1;
  private readonly spentThisTick = new Map<PrincipalId, number>();
  /** Lifetime counters, bounded by seats. Feed the A4 audit and A3's assertion. */
  private readonly materialTotal = new Map<PrincipalId, number>();
  private readonly freeTotal = new Map<PrincipalId, number>();
  /** Charges made for routine intent ticks. **Must stay zero** (A3). */
  private intentCharges = 0;

  constructor(readonly perTick: number = ACTIONS_PER_TICK) {
    if (!Number.isSafeInteger(perTick) || perTick < 1) {
      throw new Error(`the action budget must be a positive integer, got ${String(perTick)}`);
    }
  }

  /** Start a tick. Resets the per-tick spend and nothing else. */
  openTick(tick: number): void {
    this.tick = tick;
    this.spentThisTick.clear();
  }

  spent(principal: PrincipalId): number {
    return this.spentThisTick.get(principal) ?? 0;
  }

  remaining(principal: PrincipalId): number {
    return Math.max(0, this.perTick - this.spent(principal));
  }

  /**
   * Charge one action, or explain why it cannot be charged.
   *
   * `routine` marks a tick of an already-created durable intent. A3: "creating a
   * durable intent costs an action; its routine ticks do not." So a routine tick
   * is free **whatever its verb**, and the count of routine charges is tracked so
   * the claim can be asserted rather than believed.
   */
  charge(
    principal: PrincipalId,
    verb: string,
    routine = false,
    /**
     * True when this act falls inside its own module's free allowance — today only
     * `seal`, whose "one free per role held" ledger lives in the seals book (§17).
     *
     * Deliberately a caller-supplied fact rather than a verb lookup: the budget
     * cannot know how many seals this principal has already placed on this role
     * without duplicating that ledger, and duplicating it is scar #5.
     */
    withinAllowance = false,
  ): { readonly ok: true; readonly cost: ActionCost } | Rejection {
    if (routine) {
      // A durable intent already paid, once, at creation. Charging again here is
      // A3 quietly failing: an offline agent's standing intent would drain a
      // budget it cannot see, and going offline would stop being opportunity-only.
      this.intentCharges += 1;
      this.bump(this.freeTotal, principal);
      return { ok: true, cost: 'FREE' };
    }
    const cost = costOf(verb);
    if (cost === 'FREE' || withinAllowance) {
      this.bump(this.freeTotal, principal);
      return { ok: true, cost: 'FREE' };
    }
    const used = this.spent(principal);
    if (used >= this.perTick) {
      return reject(
        'A4',
        `you have already taken your ${this.perTick} material actions this tick. Talk, claims and ballots are ` +
          `free and still available; the rest waits for tick ${String(this.tick + 1)}. Acting faster buys nothing.`,
      );
    }
    this.spentThisTick.set(principal, used + 1);
    this.bump(this.materialTotal, principal);
    return { ok: true, cost };
  }

  /**
   * Routine intent charges seen so far. A3 asserts this is zero *materially*: the
   * counter exists to prove the routine path never reaches the material branch.
   */
  get routineChargesTaken(): number {
    return this.intentCharges;
  }

  /** Material spend for this tick, in canonical principal order. */
  thisTick(): readonly (readonly [PrincipalId, number])[] {
    return [...this.spentThisTick.entries()]
      .sort((a, b) => compareIds(a[0], b[0]))
      .map(([p, n]) => [p, n] as const);
  }

  materialTaken(principal: PrincipalId): number {
    return this.materialTotal.get(principal) ?? 0;
  }

  freeTaken(principal: PrincipalId): number {
    return this.freeTotal.get(principal) ?? 0;
  }

  private bump(m: Map<PrincipalId, number>, principal: PrincipalId): void {
    m.set(principal, (m.get(principal) ?? 0) + 1);
  }
}
