/**
 * INV-17 — the highest-severity check in this codebase, and its plumbing.
 *
 * > **Every default event carries an attributable cause**: the event ID of the
 * > loss, the missed delivery, or the elapsed window that produced it. A default
 * > with no attributable cause is a top-severity halt, because it is the game
 * > accusing an innocent agent. — TESTING.md §3
 *
 * A5′ is why this file is not just a predicate. The design's only product is a
 * permanent public record of promises kept and broken, so a fabricated default
 * libels a real principal *forever*, and it does it inside a healthy-looking
 * system (SPEC §15.4). A check that runs after the fact can only tell you the
 * record is already wrong. So there are three layers here, and each one closes a
 * hole the others cannot:
 *
 * 1. **The register** — {@link DefaultRegister.attribute} is the only way to
 *    record a default, and its argument type has no shape without a
 *    `causeEventId`. There is no default-with-no-cause to construct.
 * 2. **The record** — the check requires `parentEventId === causeEventId` on the
 *    published event. The register is memory; the event ledger is the artifact
 *    that outlives the process, and `parent_event_id` is the non-retrofittable
 *    causality column SPEC §15.1 put there on day one. If the attribution lives
 *    only in the register, a restart loses the ability to answer *why*.
 * 3. **The audit** — {@link ./audit.ts} runs the whole thing in two modes,
 *    because a naive version cannot catch the bug it exists for.
 *
 * ## What "default-shaped" means, and the limit of it
 *
 * {@link isDefaultEventKind} matches a registered set plus a name pattern. A kind
 * that accuses somebody while calling itself something else escapes it — that is
 * a real hole and it is why layer 1 exists: the register is the door, and
 * {@link checkInv17} also walks it *backwards*, so a registered attribution whose
 * event is not in the ledger is itself a halt. The pattern is the net for a
 * careless name, not the guarantee.
 */

import type {
  EventId,
  GrantId,
  InvariantViolation,
  PrincipalId,
  VentureId,
} from '../core/types.js';
import type { EventLedger } from '../events/ledger.js';
import { halt } from './registry.js';

/**
 * What produced a default. Exactly TESTING.md §3's three, no more.
 *
 * Deliberately *not* a free-form string: "the reason it defaulted" as prose is
 * scars #7 and #8 — prose never feeds a verdict, and a permanent accusation is
 * the worst possible place to start.
 *
 * `LOSS` is the raid, the front, the interception — something was destroyed or
 * taken and the promise could not be kept. Note that a `CARGO_LOST` resolution is
 * **not** a default at all (`src/ledger/cargoLost.ts` makes `isDefault: false` a
 * literal type); `LOSS` here is for the case where a promise really was broken
 * *and* a loss is the reason.
 */
export type DefaultCauseKind = 'LOSS' | 'MISSED_DELIVERY' | 'ELAPSED_WINDOW';

export const DEFAULT_CAUSE_KINDS: readonly DefaultCauseKind[] = [
  'LOSS',
  'MISSED_DELIVERY',
  'ELAPSED_WINDOW',
];

/**
 * One accusation, and the evidence for it.
 *
 * `promisor` is who the record will name. That field is the reason every other
 * field is mandatory.
 */
export interface DefaultAttribution {
  /** The published default event. This is the row that names a principal. */
  readonly defaultEventId: EventId;
  /** Who the record accuses. */
  readonly promisor: PrincipalId;
  /** The promise that broke. */
  readonly obligation: VentureId | GrantId;
  readonly cause: DefaultCauseKind;
  /** The event that proves the cause. Must exist, and must precede the default. */
  readonly causeEventId: EventId;
  readonly tick: number;
  /** Scoped to a Reckoning, like every other judgment (scar #7). */
  readonly reckoningIndex: number;
}

export class AttributionError extends Error {}

/**
 * Event kinds this engine treats as accusations. Registered, so adding one is a
 * deliberate act with a code review attached.
 */
export const DEFAULT_EVENT_KINDS: ReadonlySet<string> = new Set([
  'VENTURE_DEFAULTED',
  'OBLIGATION_DEFAULTED',
  'LEVY_DEFAULTED',
  'GRANT_DEFAULTED',
  // `src/venture/events.ts:VENTURE_EVENT_KINDS.defaulted` — the only kind in the
  // engine that actually accuses anybody today. It is registered here rather than
  // left to the pattern because the pattern missed it for a full build: the venture
  // module names its kinds `venture.default`, this file's net was
  // `/(^|_)DEFAULT.../` on an uppercase word, and the two conventions never met. The
  // top-severity check in the codebase returned `[]` on every real default event.
  // `test/invariants/attribution.test.ts` now pins the two tables against each other.
  'venture.default',
]);

/**
 * A name that reads as an accusation even though nobody registered it.
 *
 * `DEFER`/`DEFERRED` must **not** match: SPEC §15.3 is explicit that an
 * obligation unresolved at the cascade round limit *defers and never defaults*,
 * and a truncated cascade recording a breach is itself the engine-fabricated
 * default this whole file exists to prevent. The word boundary is therefore on
 * `DEFAULT`, never on the `DEF` prefix.
 *
 * The separator is `_` **or** `.`, and the match is case-insensitive, because the
 * engine has two live event-kind conventions — `VENTURE_FORMED`/`SEAL_RESOLVED` in
 * seal and ledger, `venture.formed`/`venture.default` in venture — and a net that
 * only speaks one of them is a detector with a blind spot exactly where the
 * accusations are. `venture.deferred` still does not match, which is the clause
 * that matters.
 */
const DEFAULT_NAME_SHAPE = /(?:^|[_.])DEFAULT(?:ED|S)?(?:$|[_.])/i;

export function isDefaultEventKind(kind: string): boolean {
  return DEFAULT_EVENT_KINDS.has(kind) || DEFAULT_NAME_SHAPE.test(kind);
}

/**
 * The attribution index: one row per accusation, keyed by the event that makes it.
 *
 * Not a second home for the default itself — the default *is* the event in the
 * append-only ledger (scar #5 would be storing the accusation twice). This holds
 * only the evidence link, and {@link checkInv17} asserts that the link in here and
 * the `parent_event_id` in the record agree.
 */
export class DefaultRegister {
  private readonly rows = new Map<EventId, DefaultAttribution>();

  /**
   * Record why a principal is being accused. The only door.
   *
   * Throws rather than returning a rejection: the caller is the engine, not an
   * agent, and there is no correct way to continue past "I am about to publish an
   * accusation I cannot justify" (SPEC §15.2, never publish a broken tick).
   */
  attribute(row: DefaultAttribution): void {
    if (row.defaultEventId.length === 0) {
      throw new AttributionError('a default attribution needs the default event it explains');
    }
    if (row.causeEventId.length === 0) {
      throw new AttributionError(
        `INV-17: default ${row.defaultEventId} names no cause event; a default with no attributable cause is the game accusing an innocent agent`,
      );
    }
    if (row.causeEventId === row.defaultEventId) {
      // Self-attribution is the shape a lazy fix takes, and it is worthless: the
      // accusation would be its own evidence.
      throw new AttributionError(
        `INV-17: default ${row.defaultEventId} cites itself as its cause`,
      );
    }
    if (!DEFAULT_CAUSE_KINDS.includes(row.cause)) {
      throw new AttributionError(`INV-17: ${String(row.cause)} is not one of the three causes`);
    }
    if (row.promisor.length === 0) {
      throw new AttributionError('a default attribution must name the principal it accuses');
    }
    const existing = this.rows.get(row.defaultEventId);
    if (existing !== undefined) {
      // Two causes for one accusation means the engine does not know which one is
      // true, which is indistinguishable from having neither.
      throw new AttributionError(
        `INV-17: default ${row.defaultEventId} already attributed to ${existing.causeEventId}`,
      );
    }
    this.rows.set(row.defaultEventId, Object.freeze({ ...row }));
  }

  of(defaultEventId: EventId): DefaultAttribution | undefined {
    return this.rows.get(defaultEventId);
  }

  has(defaultEventId: EventId): boolean {
    return this.rows.has(defaultEventId);
  }

  get size(): number {
    return this.rows.size;
  }

  /** Every attribution, in event-id order so a report is byte-stable. */
  all(): readonly DefaultAttribution[] {
    return [...this.rows.values()].sort((a, b) => cmp(a.defaultEventId, b.defaultEventId));
  }

  /** Accusations against one principal. The dossier query, and the audit's. */
  against(promisor: PrincipalId): readonly DefaultAttribution[] {
    return this.all().filter((r) => r.promisor === promisor);
  }
}

export interface Inv17Options {
  /** `FULL` walks the whole ledger; a number walks that tick only. */
  readonly scope: 'FULL' | { readonly tick: number };
}

/**
 * INV-17, both directions.
 *
 * Forward: every default-shaped event in scope has an attribution, its cause
 * exists in the ledger, the cause does not arrive after the effect, and the
 * *record itself* carries the link in `parent_event_id`.
 *
 * Backward: every attribution names an event that exists and is default-shaped.
 * Without this half, an attribution for an event that was never published would
 * make the forward walk pass on an empty set — a detector agreeing with itself.
 */
export function checkInv17(
  events: EventLedger,
  register: DefaultRegister,
  tick: number,
  options: Inv17Options = { scope: 'FULL' },
): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const ticks =
    options.scope === 'FULL' ? events.ticks() : [options.scope.tick];

  for (const t of ticks) {
    for (const rec of events.eventsAtTick(t)) {
      const { event } = rec;
      if (!isDefaultEventKind(event.kind)) continue;

      const attribution = register.of(event.id);
      if (attribution === undefined) {
        out.push(
          halt(
            'INV-17',
            tick,
            `default event ${event.id} (${event.kind}) has no attributable cause; ` +
              'the record is accusing ' +
              `${String(event.actorPrincipalId ?? 'a principal')} with no evidence`,
          ),
        );
        continue;
      }

      // ── THE CONTRACT, and why this side of it is the right one ──────────────
      //
      // The wave-2 verifier found a genuine cross-module conflict here:
      // `src/venture/events.ts` sets `parentEventId` to the settlement's COHORT
      // parent and carries `causeEventId` in the payload, while this check requires
      // `parentEventId === causeEventId`. Once attribution is wired into real
      // settlement, one of the two halts the world at every Reckoning with a default.
      //
      // SPEC §15.1 already decides it, and says so in the same breath as the reason:
      //
      //   `event_family_id` (immutable primary cohort) · `parent_event_id`
      //   (causality — one flat field cannot express both)
      //
      // So the cohort belongs in `event_family_id` and `parent_event_id` is the
      // causal edge. This check is correct; the venture side must move its cohort to
      // `event_family_id`. Tracked as a cross-module fix rather than done here,
      // because src/venture/ has its own owner.
      //
      // The reason it must be the COLUMN and not the payload: a default is the most
      // serious thing this engine can write about an agent, and the evidence for it
      // has to survive a restart and be joinable in SQL by an auditor who does not
      // have our code. Attribution living only in a jsonb payload is attribution that
      // an operator cannot query under pressure.
      if (event.parentEventId === null) {
        out.push(
          halt(
            'INV-17',
            tick,
            `default event ${event.id} is attributed to ${attribution.causeEventId} in the register but ` +
              'carries no parent_event_id; the attribution must survive a restart, not only this process',
          ),
        );
      } else if (event.parentEventId !== attribution.causeEventId) {
        out.push(
          halt(
            'INV-17',
            tick,
            `default event ${event.id} names parent ${event.parentEventId} but is attributed to ` +
              `${attribution.causeEventId}; the register and the permanent record disagree about why`,
          ),
        );
      }

      const cause = events.get(attribution.causeEventId);
      if (cause === null) {
        out.push(
          halt(
            'INV-17',
            tick,
            `default event ${event.id} cites cause ${attribution.causeEventId}, which is not in the ledger`,
          ),
        );
        continue;
      }
      if (
        cause.event.tick > event.tick ||
        (cause.event.tick === event.tick && cause.event.seqInTick >= event.seqInTick)
      ) {
        out.push(
          halt(
            'INV-17',
            tick,
            `default event ${event.id} at (${event.tick},${event.seqInTick}) cites cause ` +
              `${attribution.causeEventId} at (${cause.event.tick},${cause.event.seqInTick}); ` +
              'a cause cannot arrive after its effect',
          ),
        );
      }
      if (
        event.actorPrincipalId !== null &&
        attribution.promisor !== event.actorPrincipalId &&
        event.onBehalfOfPrincipalId !== attribution.promisor
      ) {
        // The accusation and the row must name the same principal, or the dossier
        // and the ledger attach the default to different agents.
        out.push(
          halt(
            'INV-17',
            tick,
            `default event ${event.id} is recorded against ${attribution.promisor} but the event names ` +
              `${event.actorPrincipalId}`,
          ),
        );
      }
    }
  }

  for (const row of register.all()) {
    const rec = events.get(row.defaultEventId);
    if (rec === null) {
      out.push(
        halt(
          'INV-17',
          tick,
          `attribution for ${row.defaultEventId} names an event that is not in the ledger; ` +
            'the register and the record disagree about what was published',
        ),
      );
      continue;
    }
    if (!isDefaultEventKind(rec.event.kind)) {
      out.push(
        halt(
          'INV-17',
          tick,
          `attribution for ${row.defaultEventId} explains a ${rec.event.kind} event, which is not a default`,
        ),
      );
    }
  }

  return out;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
