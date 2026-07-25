/**
 * Where standing actually moves — the journal and the cached rows (SPEC §6.4, INV-21).
 *
 * Three modules produce the *facts* and none of them writes standing, on purpose:
 *
 *   - `src/venture/settlement.ts` returns `StandingDelta[]` and says why it is "**a
 *     report, not a write** — INV-21 says standing changes only via an
 *     elective-honoured settlement, a default, a contradicted seal or scheduled decay,
 *     and the way to make that true is for settlement to hand the facts to whoever owns
 *     the vectors rather than reaching into them";
 *   - `src/seal/standing.ts` returns `SealStandingCharge[]` and says "**Standing itself
 *     is not stored here.** `resolve` returns charges; whoever owns the standing table
 *     applies them";
 *   - `src/invariants/promises.ts` can check the journal against the rows but owns
 *     neither.
 *
 * This is that owner. It is in the Reckoning module because standing moves **at the
 * Reckoning and nowhere else** (§5), so the table's writer and the Reckoning's driver
 * are one thing.
 *
 * ## Every write is journalled, and the journal is the proof
 *
 * `checkStandingJournal` replays the whole journal and compares it against the cached
 * row. That check is only worth anything if the row cannot move without a journal
 * entry, so {@link StandingBook.apply} is the only mutator and it writes both in one
 * statement. The alternative — a setter plus a separate log — is how scar #9 took a
 * reputation from 50 to 100 with ~17 duplicate pacts: the sum was right and the
 * *distinctness* was not, and nothing could tell the difference afterwards.
 *
 * ## The three arithmetic rules that are easy to get wrong
 *
 *   1. **`distinctCounterparties` counts a counterparty once, ever.** The delta is `+1`
 *      only the first time a principal honours something for that counterparty, so the
 *      summed journal and the distinct set agree — which is exactly what INV-21
 *      compares, and comparing a sum against a set is the only way scar #9 is visible.
 *   2. **`lastDefaultTick` is a stamp, not a count.** It is set to the tick of the
 *      latest `DEFAULT` change, because `checkStandingJournal` recomputes it that way
 *      and a row that disagrees with the journal fails INV-21.
 *   3. **`defaultedValue` has no vector.** `VECTORS_BY_CAUSE.DEFAULT` authorises
 *      `defaults` and `lastDefaultTick` and nothing else, so the value of a broken
 *      promise is reported on the receipt and never added to a standing field. A cause
 *      moving a field it does not authorise is an INV-21 halt.
 *
 * ## Nothing here ever falls
 *
 * `checkInv21`'s per-batch half refuses a *fall* under any cause but `DECAY`, and this
 * module has no decay path: §6.4's recency half-life is a scheduled job, not a
 * settlement effect, and giving the Reckoning the ability to lower a vector would make
 * "only scheduled decay lowers standing" unenforceable from the one place that writes.
 */

import type { EventId, PrincipalId, Standing } from '../core/types.js';
import { minor } from '../core/units.js';
import { compareIds } from '../ledger/index.js';
import type { StandingChange, StandingDiff } from '../invariants/index.js';
import {
  applySealStandingCharges,
  type SealStandingCharge,
  type StandingCause,
} from '../seal/index.js';
import type { StandingDelta } from '../venture/index.js';
import { ReckoningHalt } from './set.js';

/** A settlement's standing fact, paired with the **minted** row that justifies it. */
export interface StandingCredit {
  readonly delta: StandingDelta;
  /**
   * The permanent row this change cites.
   *
   * For a `DEFAULT` it must be the minted `venture.default` event, because
   * `checkStandingJournal` asserts that a `DEFAULT` change's event is in the
   * `DefaultRegister` — "reputation must never fall for an accusation the engine cannot
   * justify". For an `ELECTIVE_HONOURED` it is the `venture.settled` row.
   */
  readonly eventId: EventId;
}

/** A contradicted seal's charge, paired with the minted `SEAL_RESOLVED` row. */
export interface SealChargeRow {
  readonly charge: SealStandingCharge;
  readonly eventId: EventId;
}

export interface StandingApplied {
  readonly changes: readonly StandingChange[];
  /** Before/after per principal, for INV-21's per-batch half. */
  readonly diffs: readonly StandingDiff[];
}

function zero(principal: PrincipalId): Standing {
  return {
    principal,
    electiveHonoured: 0,
    electiveHonouredValue: minor(0),
    defaults: 0,
    contradictedSeals: 0,
    distinctCounterparties: 0,
    lastDefaultTick: null,
  };
}

export class StandingBook {
  private readonly byPrincipal = new Map<PrincipalId, Standing>();
  private readonly journal: StandingChange[] = [];
  /** Principal -> counterparties it has already earned diversity credit against. */
  private readonly counterparties = new Map<PrincipalId, Set<PrincipalId>>();

  /** A zero row for a principal that has done nothing yet. Idempotent. */
  open(principal: PrincipalId): Standing {
    const existing = this.byPrincipal.get(principal);
    if (existing !== undefined) return existing;
    const row = zero(principal);
    this.byPrincipal.set(principal, row);
    return row;
  }

  row(principal: PrincipalId): Standing {
    return this.byPrincipal.get(principal) ?? zero(principal);
  }

  /** Every row, in principal order. INV-21's cached side. */
  rows(): readonly Standing[] {
    return [...this.byPrincipal.keys()]
      .sort(compareIds)
      .map((p) => this.byPrincipal.get(p) ?? zero(p));
  }

  /** The whole journal, in the order it was written. INV-21's history side. */
  changes(): readonly StandingChange[] {
    return [...this.journal];
  }

  /**
   * Apply one Reckoning's facts.
   *
   * Deterministic in the inputs' canonical order and nothing else: credits by
   * `(venture, counterparty, cause)` and charges by `sealId`, so a replay produces the
   * same journal and therefore the same `state_hash` (DET-1, DET-2).
   */
  apply(args: {
    readonly tick: number;
    readonly credits: readonly StandingCredit[];
    readonly charges: readonly SealChargeRow[];
  }): StandingApplied {
    if (!Number.isSafeInteger(args.tick) || args.tick < 0) {
      throw new ReckoningHalt(`standing moves at a tick, got ${String(args.tick)}`);
    }

    const touched = new Set<PrincipalId>();
    const before = new Map<PrincipalId, Standing>();
    const causes = new Map<PrincipalId, Set<StandingCause>>();
    const changes: StandingChange[] = [];

    const remember = (principal: PrincipalId, cause: StandingCause): void => {
      if (!before.has(principal)) before.set(principal, this.row(principal));
      touched.add(principal);
      const set = causes.get(principal) ?? new Set<StandingCause>();
      set.add(cause);
      causes.set(principal, set);
    };

    const credits = [...args.credits].sort(
      (a, b) =>
        compareIds(a.delta.venture, b.delta.venture) ||
        compareIds(a.delta.counterparty, b.delta.counterparty) ||
        compareIds(a.delta.cause, b.delta.cause),
    );

    for (const credit of credits) {
      const { delta } = credit;
      if (delta.principal === delta.counterparty) {
        // §6.4 and scar #9: self-dealing earns zero. The venture module already refuses
        // to emit one, and `checkSettlementExact` flags it, so reaching here means two
        // guards were bypassed and the third must not write the row.
        throw new ReckoningHalt(
          `${delta.venture} credits ${delta.principal} for dealing with itself; self-dealing earns zero ` +
            'standing (scar #9)',
        );
      }
      remember(delta.principal, delta.cause);
      const row = this.row(delta.principal);

      if (delta.cause === 'ELECTIVE_HONOURED') {
        assertNonNegative(delta.electiveHonoured, 'electiveHonoured', delta.venture);
        assertNonNegative(delta.electiveHonouredValue, 'electiveHonouredValue', delta.venture);
        let seen = this.counterparties.get(delta.principal);
        if (seen === undefined) {
          seen = new Set<PrincipalId>();
          this.counterparties.set(delta.principal, seen);
        }
        const isNew = !seen.has(delta.counterparty);
        seen.add(delta.counterparty);
        this.byPrincipal.set(delta.principal, {
          ...row,
          electiveHonoured: row.electiveHonoured + delta.electiveHonoured,
          electiveHonouredValue: minor(row.electiveHonouredValue + delta.electiveHonouredValue),
          distinctCounterparties: row.distinctCounterparties + (isNew ? 1 : 0),
        });
        changes.push({
          principal: delta.principal,
          tick: args.tick,
          cause: 'ELECTIVE_HONOURED',
          eventId: credit.eventId,
          // The anti-farm term: +1 the first time only, so the summed journal and the
          // distinct set agree and scar #9 is visible to INV-21.
          delta: isNew
            ? {
                electiveHonoured: delta.electiveHonoured,
                electiveHonouredValue: delta.electiveHonouredValue,
                distinctCounterparties: 1,
              }
            : {
                electiveHonoured: delta.electiveHonoured,
                electiveHonouredValue: delta.electiveHonouredValue,
              },
          counterparty: delta.counterparty,
        });
        continue;
      }

      assertNonNegative(delta.defaults, 'defaults', delta.venture);
      this.byPrincipal.set(delta.principal, {
        ...row,
        defaults: row.defaults + delta.defaults,
        // A stamp, not a count. `checkStandingJournal` recomputes it from the journal's
        // latest DEFAULT and compares, so it must be this tick.
        lastDefaultTick: args.tick,
      });
      changes.push({
        principal: delta.principal,
        tick: args.tick,
        cause: 'DEFAULT',
        eventId: credit.eventId,
        // `defaultedValue` is deliberately absent: `VECTORS_BY_CAUSE.DEFAULT`
        // authorises `defaults` and `lastDefaultTick` only, and a cause moving a field
        // it does not authorise is an INV-21 halt.
        delta: { defaults: delta.defaults },
        counterparty: null,
      });
    }

    for (const row of [...args.charges].sort((a, b) => compareIds(a.charge.sealId, b.charge.sealId))) {
      remember(row.charge.principal, 'CONTRADICTED_SEAL');
      // Through the seal module's own applier, so the arithmetic of "costs standing on
      // the published schedule" has one implementation and PROP-D3 tests it there.
      this.byPrincipal.set(
        row.charge.principal,
        applySealStandingCharges(this.row(row.charge.principal), [row.charge]),
      );
      changes.push({
        principal: row.charge.principal,
        tick: args.tick,
        cause: 'CONTRADICTED_SEAL',
        eventId: row.eventId,
        delta: { contradictedSeals: row.charge.contradictedSealsDelta },
        counterparty: null,
      });
    }

    this.journal.push(...changes);

    const diffs: StandingDiff[] = [...touched].sort(compareIds).map((principal) => ({
      prev: before.get(principal) ?? zero(principal),
      next: this.row(principal),
      causes: [...(causes.get(principal) ?? new Set<StandingCause>())].sort(compareIds),
    }));

    return { changes: Object.freeze(changes), diffs: Object.freeze(diffs) };
  }
}

function assertNonNegative(value: number, field: string, venture: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    // Only scheduled decay lowers a vector (INV-21), and there is no decay path here.
    throw new ReckoningHalt(
      `${venture} reports ${field} of ${String(value)}; standing is non-negative integers and only ` +
        'scheduled decay ever lowers a vector',
    );
  }
}
