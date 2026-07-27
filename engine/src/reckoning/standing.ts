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

import type { CanonicalValue } from '../core/canonical.js';
import type { EventId, PrincipalId, Standing } from '../core/types.js';
import { minor } from '../core/units.js';
import { compareIds } from '../ledger/index.js';
import {
  readArray,
  readInt,
  readIntOrNull,
  readObject,
  readString,
  readStringOrNull,
} from '../tick/snapshot.js';
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
        // ── WHO IT WAS BROKEN AGAINST, WHICH USED TO BE `null` ──────────────
        //
        // `counterparty` is metadata on the change, not one of the vectors — the authorised-fields
        // rule above governs `delta`, and `ELECTIVE_HONOURED` sets this same field a few lines up.
        // It was `null` here, and that silently emptied everything downstream that asks *"what
        // passed between these two"*:
        //
        //   - `relationsFor` skips any change with a null counterparty, so its `broke` and
        //     `youBroke` counters were **structurally always zero**. They could not increment,
        //     because the only cause that increments them carried nobody to attribute it to.
        //   - `priorDealings` — added the same day to stop the docket publishing *"they have dealt
        //     before, and it held"* about a pair whose only prior deal was a DEFAULT — decides
        //     `BROKEN` from `relation.broke > 0`. So that fix was INERT and the docket kept lying.
        //     Its mutation test did not bite, and I misread that as "the heuristic never defaults"
        //     when the cause was that this field was null.
        //   - The cast prompt maps `relationsFor` into the relationship history it shows an LLM
        //     player, so every agent was told every counterparty had broken **zero** promises. A
        //     rules surface stating something false about a real agent's record.
        //
        // The delta already carries the counterparty — the self-dealing guard above compares it —
        // so this was propagation that had been dropped, not information that was missing.
        counterparty: delta.counterparty,
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

  // ── The capture (A10) ───────────────────────────────────────────────────────

  /**
   * Everything this book owns, for the hashed capture and the abort path.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THIS BOOK WAS IN NO STATE TABLE, AND THAT IS THE A10 FAILURE.** A snapshot
   * carries the engine's state tables and `state_hash` hashes exactly those, so a
   * book outside them is neither carried nor missed. Measured on a 600-tick run
   * adopting the checkpoint at tick 575: the adopted world's hash equalled the
   * genesis-replayed hash **to the byte** and every balance agreed, while the cast's
   * `electiveHonoured` went from `4, 6, 2, 4, …` to all zeros. A10 says identity,
   * reputation, relationships and legend never reset; they reset silently, past a
   * tripwire that reported success — a wrong boot that passes its own integrity
   * check, which is strictly worse than a slow one.
   * ══════════════════════════════════════════════════════════════════════════
   *
   * **Two of the three maps are carried, and the third is derived — on purpose.**
   *
   *   - `byPrincipal` (the rows an agent reads) and `journal` (the history INV-21
   *     recomputes from) are both carried, exactly as `grantsStateTable` carries both
   *     the grant rows and the spend journal. Carrying only the journal and replaying
   *     it would be slower and would put the arithmetic of `apply` on the restore
   *     path; carrying only the rows would let a restored world pass INV-21's
   *     sum-vs-cache check vacuously, over an empty history.
   *   - `counterparties` is **not** carried. It is an index over the journal — the
   *     set of counterparties a principal has already earned diversity credit against
   *     — and every `ELECTIVE_HONOURED` change records its `counterparty`, so the set
   *     is exactly `{c.counterparty}` over that principal's honoured changes.
   *     Capturing it too would give one fact two homes (scar #5), and the anti-farm
   *     term is the one place this codebase has already been burned by a count and a
   *     set disagreeing (scar #9). It is rebuilt in {@link restore} from the same
   *     journal INV-21 audits, which is the `worldStateTable` rule: derive the index
   *     from the rows, never read a captured copy of it.
   */
  capture(): CanonicalValue {
    return {
      rows: this.rows().map((r) => ({
        principal: r.principal,
        electiveHonoured: r.electiveHonoured,
        electiveHonouredValue: r.electiveHonouredValue,
        defaults: r.defaults,
        contradictedSeals: r.contradictedSeals,
        distinctCounterparties: r.distinctCounterparties,
        lastDefaultTick: r.lastDefaultTick,
      })),
      // Write order, not sorted. The journal IS a sequence and INV-21 recomputes by
      // replaying it; re-ordering it would change nothing about the sums and would
      // quietly destroy the one thing a journal is for.
      changes: this.journal.map((c) => ({
        principal: c.principal,
        tick: c.tick,
        cause: c.cause,
        eventId: c.eventId,
        // Fixed key order, absent fields omitted rather than nulled: the canonical
        // serialiser sorts keys, and `undefined` may never reach a hashed structure.
        delta: standingDeltaOut(c.delta),
        counterparty: c.counterparty,
      })),
    };
  }

  /**
   * Replace this book's contents with a captured state. The inverse of {@link capture}.
   *
   * **Parsed strictly, and a capture that cannot be read is a refusal with a located
   * error.** An empty `StandingBook` is indistinguishable from *nobody has ever kept a
   * promise*, and this is the record whose only claim is that it is permanent (A5,
   * A10). A restore that swallowed a malformed row would publish that claim as a lie
   * and nothing downstream could tell.
   */
  restore(captured: CanonicalValue): void {
    const root = readObject(captured, 'standing');
    const rows = readArray(root['rows'] ?? [], 'standing.rows').map((raw, i) => {
      const where = `standing.rows[${String(i)}]`;
      const o = readObject(raw, where);
      const row: Standing = {
        principal: readString(o, 'principal', where) as PrincipalId,
        electiveHonoured: readInt(o, 'electiveHonoured', where),
        electiveHonouredValue: minor(readInt(o, 'electiveHonouredValue', where)),
        defaults: readInt(o, 'defaults', where),
        contradictedSeals: readInt(o, 'contradictedSeals', where),
        distinctCounterparties: readInt(o, 'distinctCounterparties', where),
        lastDefaultTick: readIntOrNull(o, 'lastDefaultTick', where),
      };
      for (const field of STANDING_ROW_COUNTS) {
        if (row[field] < 0) {
          throw new ReckoningHalt(
            `${where}.${field} is ${String(row[field])}; standing vectors are non-negative integers`,
          );
        }
      }
      return row;
    });

    const changes = readArray(root['changes'] ?? [], 'standing.changes').map((raw, i) => {
      const where = `standing.changes[${String(i)}]`;
      const o = readObject(raw, where);
      const cause = readString(o, 'cause', where);
      if (!STANDING_CAUSES.has(cause)) {
        throw new ReckoningHalt(`${where}.cause: '${cause}' is not a standing cause`);
      }
      const change: StandingChange = {
        principal: readString(o, 'principal', where) as PrincipalId,
        tick: readInt(o, 'tick', where),
        cause: cause as StandingCause,
        eventId: readString(o, 'eventId', where) as EventId,
        delta: standingDeltaIn(o['delta'] ?? {}, `${where}.delta`),
        counterparty: readStringOrNull(o, 'counterparty', where) as PrincipalId | null,
      };
      return change;
    });

    this.byPrincipal.clear();
    this.journal.length = 0;
    this.counterparties.clear();

    for (const row of rows) {
      if (this.byPrincipal.has(row.principal)) {
        throw new ReckoningHalt(
          `standing.rows names ${row.principal} twice; one principal has one standing row`,
        );
      }
      this.byPrincipal.set(row.principal, row);
    }
    for (const change of changes) {
      this.journal.push(change);
      // The derived index, rebuilt from the journal rather than from a captured copy.
      // This is what keeps the distinct-counterparty count and the distinct set
      // agreeing through a restore — the exact disagreement scar #9 was.
      if (change.cause !== 'ELECTIVE_HONOURED' || change.counterparty === null) continue;
      let seen = this.counterparties.get(change.principal);
      if (seen === undefined) {
        seen = new Set<PrincipalId>();
        this.counterparties.set(change.principal, seen);
      }
      seen.add(change.counterparty);
    }
  }
}

/** The five vectors that are counts. `lastDefaultTick` is a stamp and may be null. */
const STANDING_ROW_COUNTS = [
  'electiveHonoured',
  'electiveHonouredValue',
  'defaults',
  'contradictedSeals',
  'distinctCounterparties',
] as const;

const STANDING_CAUSES: ReadonlySet<string> = new Set<StandingCause>([
  'ELECTIVE_HONOURED',
  'DEFAULT',
  'CONTRADICTED_SEAL',
  'DECAY',
]);

/** The fields a `StandingChange.delta` may carry, in one place, in one order. */
const STANDING_DELTA_FIELDS = [
  'electiveHonoured',
  'electiveHonouredValue',
  'defaults',
  'contradictedSeals',
  'distinctCounterparties',
] as const;

type StandingDeltaField = (typeof STANDING_DELTA_FIELDS)[number];

function standingDeltaOut(
  delta: StandingChange['delta'],
): Record<string, CanonicalValue> {
  const out: Record<string, CanonicalValue> = {};
  for (const field of STANDING_DELTA_FIELDS) {
    const value = delta[field];
    // Absent, not null: an omitted vector is one this cause did not move, and
    // `VECTORS_BY_CAUSE` is what says which it may. A null would read as "moved by
    // nothing", which is a different claim.
    if (value === undefined) continue;
    out[field] = value;
  }
  return out;
}

function standingDeltaIn(raw: CanonicalValue, where: string): StandingChange['delta'] {
  const o = readObject(raw, where);
  const out: Partial<Record<StandingDeltaField, number>> = {};
  for (const key of Object.keys(o)) {
    if (!(STANDING_DELTA_FIELDS as readonly string[]).includes(key)) {
      throw new ReckoningHalt(
        `${where}.${key} is not a standing vector; a cause moving a field it does not authorise is an ` +
          'INV-21 halt, and a capture may not smuggle one in',
      );
    }
  }
  for (const field of STANDING_DELTA_FIELDS) {
    if (o[field] === undefined) continue;
    out[field] = readInt(o, field, where);
  }
  return out;
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
