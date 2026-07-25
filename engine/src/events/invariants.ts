/**
 * INV-11 … INV-16 — the record's invariants, asserted in the `ASSERT` phase of
 * every tick, before `COMMIT` (TESTING.md §3).
 *
 * These are not tests that run in CI; they are tests that run **in production,
 * forever**. On failure the tick aborts and the world enters `PAUSED` — never
 * publish a broken tick (SPEC §15.2), because the design's only product is a
 * permanent public record and a wrong row is worse than an outage (A5′).
 *
 * ## Every check is pure over the records it inspects
 *
 * Each check takes a flat record array and a read-only {@link RecordSource},
 * not the ledger. That is deliberate: most of these properties are *structural*
 * under the ledger's append path — the ledger mints `seqInTick`, so a gap is
 * impossible through its API — and a detector that can only be exercised by a
 * bug it also prevents is a detector nobody has ever seen fire. Pure functions
 * over hand-built records can be shown to fire, which is the difference between
 * an assertion and a comment.
 *
 * ## Two scopes, and why
 *
 * `TICK` checks the tick just written plus every record whose audience changed;
 * `FULL` checks the whole ledger. Re-reading a season of immutable rows every
 * tick would buy nothing and cost O(N) per tick — and an assertion that is
 * expensive is an assertion that gets sampled and then deleted. `FULL` runs in
 * CI, at replay, and after any migration, which is exactly when a structural
 * guarantee might have stopped holding.
 *
 * The exception is INV-14: the audience fan-out *is* allowed to grow, so its
 * monotonicity is the one property here that needs a before-and-after
 * comparison rather than a single-row check.
 */

import type { EventId, InvariantViolation } from '../core/types.js';
import { EventLedger } from './ledger.js';
import {
  visibilityRule,
  visibilityRegressions,
  type AudienceRow,
  type EventRecord,
} from './visibility.js';

export type AssertScope = 'TICK' | 'FULL';

export interface AssertOptions {
  readonly tick: number;
  readonly scope: AssertScope;
}

/** The read surface the checks need. {@link EventLedger} satisfies it. */
export interface RecordSource {
  get(id: EventId): EventRecord | null;
  audienceOf(id: EventId): readonly AudienceRow[];
}

/**
 * Methods that mutate the invariant-audit snapshot rather than the record.
 * Named individually so a future `setSomething` is caught by INV-16's reflective
 * check instead of quietly joining the allow-list.
 */
const AUDIT_ONLY_MUTATORS: ReadonlySet<string> = new Set(['clearTouched', 'recordDescriptor']);

/** Method-name shapes that would mean the ledger had grown a write path. */
const MUTATOR_SHAPE =
  /^(update|delete|remove|patch|set|mutate|replace|edit|drop|truncate|clear|splice|revoke|rewrite|amend|fix)/i;

function halt(id: string, tick: number, message: string): InvariantViolation {
  return { id, message, tick, severity: 'HALT' };
}

/**
 * Everything wrong with the record. Empty means the tick may commit.
 *
 * Returns violations rather than throwing so the caller can log all of them
 * before halting: an operator replaying a failed tick wants the whole failure,
 * not the first assertion that fired.
 *
 * Side effect, and the only one: advances INV-14's audit snapshot and clears the
 * ledger's touched set. The check is a before-and-after comparison, so the
 * "after" has to become the next "before" somewhere, and doing it here keeps the
 * pairing with the comparison that needs it.
 */
export function assertEventInvariants(
  ledger: EventLedger,
  opts: AssertOptions,
): readonly InvariantViolation[] {
  const { tick, scope } = opts;
  const ticksToCheck = scope === 'FULL' ? ledger.ticks() : [tick];
  const records: EventRecord[] = [];
  for (const t of ticksToCheck) records.push(...ledger.eventsAtTick(t));

  return [
    ...seqDensityViolations(records, tick),
    ...causalityViolations(records, ledger, tick),
    ...fanOutViolations(records, ledger, tick),
    ...recordIntegrityViolations(records, tick),
    ...monotonicityViolations(ledger, scope, tick),
    ...appendOnlySurfaceViolations(ledger, tick),
  ];
}

/**
 * INV-11 — `seqInTick` is dense and gapless within each tick.
 *
 * The ledger mints seq itself so this holds by construction. It is asserted
 * anyway, for the same reason INV-9 asserts what its partial unique index
 * already guarantees: the mechanism that makes it true is the thing most likely
 * to be dropped by a careless migration, and a gap in seq means an event was
 * written somewhere this ledger cannot see.
 */
export function seqDensityViolations(
  records: readonly EventRecord[],
  tick: number,
): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const byTick = new Map<number, number[]>();
  for (const rec of records) {
    const seqs = byTick.get(rec.event.tick);
    if (seqs === undefined) byTick.set(rec.event.tick, [rec.event.seqInTick]);
    else seqs.push(rec.event.seqInTick);
  }
  for (const [t, seqs] of byTick) {
    const seen = new Set<number>();
    for (const seq of seqs) {
      if (seen.has(seq)) out.push(halt('INV-11', tick, `tick ${t} has two events at seqInTick ${seq}`));
      seen.add(seq);
    }
    for (let i = 0; i < seqs.length; i += 1) {
      if (!seen.has(i)) {
        out.push(
          halt(
            'INV-11',
            tick,
            `tick ${t} has ${seqs.length} events but no seqInTick ${i}; seq is not dense`,
          ),
        );
      }
    }
  }
  return out;
}

/**
 * INV-12 — no `parentEventId` from a later tick, and no cycle in the causality
 * graph.
 *
 * A cause that arrives after its effect is not a cause; a cycle means the replay
 * can never explain why anything happened, which is the one thing the ledger
 * exists to do.
 */
export function causalityViolations(
  records: readonly EventRecord[],
  source: RecordSource,
  tick: number,
): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const acyclic = new Set<EventId>();

  for (const rec of records) {
    const parentId = rec.event.parentEventId;
    if (parentId === null) {
      acyclic.add(rec.event.id);
      continue;
    }
    const parent = source.get(parentId);
    if (parent === null) {
      out.push(
        halt('INV-12', tick, `event ${rec.event.id} names parent ${parentId}, which is not in the ledger`),
      );
      continue;
    }
    if (parent.event.tick > rec.event.tick) {
      out.push(
        halt(
          'INV-12',
          tick,
          `event ${rec.event.id} at tick ${rec.event.tick} names parent ${parentId} at tick ${parent.event.tick};` +
            ' a cause cannot arrive after its effect',
        ),
      );
    } else if (
      parent.event.tick === rec.event.tick &&
      parent.event.seqInTick >= rec.event.seqInTick
    ) {
      out.push(
        halt(
          'INV-12',
          tick,
          `event ${rec.event.id} names parent ${parentId} at the same tick but seq ${parent.event.seqInTick}`,
        ),
      );
    }

    // Walk to a root, memoising known-acyclic ids. Without the memo this is
    // O(N * depth) every tick.
    const walked: EventId[] = [];
    const onPath = new Set<EventId>();
    let cursor: EventRecord | null = rec;
    let cyclic = false;
    while (cursor !== null && !acyclic.has(cursor.event.id)) {
      if (onPath.has(cursor.event.id)) {
        out.push(halt('INV-12', tick, `causality cycle through event ${cursor.event.id}`));
        cyclic = true;
        break;
      }
      onPath.add(cursor.event.id);
      walked.push(cursor.event.id);
      const next: EventId | null = cursor.event.parentEventId;
      cursor = next === null ? null : source.get(next);
    }
    // Never memoise a path that contained a cycle, or the second event on it
    // reports clean.
    if (!cyclic) for (const id of walked) acyclic.add(id);
  }
  return out;
}

/**
 * INV-13 — every `PARTIES` event has >=2 rows in the audience fan-out table and
 * every `SENSED` event has >=1; and every tier's ceiling holds.
 *
 * The ceiling matters as much as the floor: an audience row on a `SEALED` event
 * would be a hole through which seal content reaches an agent, and PROP-D2 has
 * no exceptions.
 */
export function fanOutViolations(
  records: readonly EventRecord[],
  source: RecordSource,
  tick: number,
): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const rec of records) {
    const rows = source.audienceOf(rec.event.id);
    const rule = visibilityRule(rec.visibility);
    if (rows.length < rule.minAudience) {
      out.push(
        halt(
          'INV-13',
          tick,
          `${rec.visibility} event ${rec.event.id} has ${rows.length} audience rows, needs >=${rule.minAudience}`,
        ),
      );
    }
    if (rule.maxAudience !== null && rows.length > rule.maxAudience) {
      out.push(
        halt(
          'INV-13',
          tick,
          `${rec.visibility} event ${rec.event.id} has ${rows.length} audience rows, allows <=${rule.maxAudience}`,
        ),
      );
    }
    for (const row of rows) {
      if (row.admittedAtTick < rec.event.tick) {
        out.push(
          halt(
            'INV-13',
            tick,
            `audience row for ${row.principal} on ${rec.event.id} is dated ${row.admittedAtTick}, before the event`,
          ),
        );
      }
    }
  }
  return out;
}

/**
 * INV-15 — `rules_version` is pinned at acceptance and never rewritten — and
 * INV-16's row-level half: the record is frozen at runtime, not merely
 * `readonly` in the type system.
 *
 * `readonly` vanishes at the boundary with plain JS and under an `as` cast.
 * `Object.freeze` does not.
 */
export function recordIntegrityViolations(
  records: readonly EventRecord[],
  tick: number,
): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const rec of records) {
    if (!Number.isSafeInteger(rec.event.rulesVersion) || rec.event.rulesVersion < 1) {
      out.push(
        halt(
          'INV-15',
          tick,
          `event ${rec.event.id} has rulesVersion ${String(rec.event.rulesVersion)}; obligations pin a real version`,
        ),
      );
    }
    if (
      !Object.isFrozen(rec) ||
      !Object.isFrozen(rec.event) ||
      !Object.isFrozen(rec.event.payload)
    ) {
      out.push(
        halt('INV-16', tick, `event ${rec.event.id} is not frozen; the ledger admits no UPDATE`),
      );
    }
  }
  return out;
}

/**
 * INV-14 — visibility is monotonic.
 *
 * The only thing that may change after a row is written is its audience, and it
 * may only grow. So the comparison is scoped to records that have audience rows:
 * `PUBLIC` and `SEALED` admit none at all, and a frozen row with no audience has
 * nothing that could move.
 */
export function monotonicityViolations(
  ledger: EventLedger,
  scope: AssertScope,
  tick: number,
): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const ids: readonly EventId[] =
    scope === 'FULL'
      ? ledger.ticks().flatMap((t) => ledger.eventsAtTick(t).map((r) => r.event.id))
      : ledger.touchedSinceAssert();

  for (const id of ids) {
    const now = ledger.describe(id);
    if (now === null) {
      out.push(halt('INV-14', tick, `event ${id} was touched but is not in the ledger`));
      continue;
    }
    const before = ledger.previousDescriptor(id);
    if (before !== null) {
      for (const regression of visibilityRegressions(before, now)) {
        out.push(halt('INV-14', tick, `event ${id}: ${regression}`));
      }
    }
    if (now.audience.length > 0) ledger.recordDescriptor(id, now);
  }
  ledger.clearTouched();
  return out;
}

/**
 * INV-16 — the record admits no `UPDATE` and no `DELETE`, structurally.
 *
 * The database half is already enforced: `src/db/migrate.ts` revokes
 * `UPDATE, DELETE, TRUNCATE` on `event` and `event_audience` from the app role
 * (`AX-A5-1`). This is the in-process half, and it is reflective on purpose — the
 * failure it guards against is not a bad call site but a future *method*, and a
 * method that does not exist cannot be called by accident.
 */
export function appendOnlySurfaceViolations(
  ledger: object,
  tick: number,
): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const proto: object = Object.getPrototypeOf(ledger) as object;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor' || AUDIT_ONLY_MUTATORS.has(name)) continue;
    if (MUTATOR_SHAPE.test(name)) {
      out.push(
        halt(
          'INV-16',
          tick,
          `EventLedger.${name} looks like a write path; the ledger's only mutation is append` +
            ' (A5: append-only, no opt-out, no reroll)',
        ),
      );
    }
  }
  return out;
}
