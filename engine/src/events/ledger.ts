/**
 * The event ledger — append-only, immutable, and the product (SPEC §15.1).
 *
 * Three write artifacts, two projections. This is the second artifact: the
 * thing the viewer storyline, the audit and the dataset are all read from.
 * **Events are output, not input** — replay's input is
 * `(snapshot_T, action_log_T, seed_T) → snapshot_T+1`, so nothing here folds
 * events to answer a question. That is the event-sourcing cliff SPEC §15.1
 * names, and the reason `observe` reads state tables instead.
 *
 * ## Append is the only mutation
 *
 * INV-16 and A5 are structural, not conventional:
 *
 * - there is no update, delete, patch or revoke method on this class, and a
 *   reflective test asserts none appears later;
 * - every stored record, its event, and its payload are deep-frozen, so a
 *   mutation attempt throws under ESM strict mode rather than silently landing;
 * - ids are minted from `(tick, seq)` and re-appending one is refused;
 * - the audience fan-out grows and never shrinks — a `SENSED` audience widens
 *   when somebody buys the intel, which is a legitimate add, and there is
 *   deliberately no way to take a row back.
 *
 * The database half is already handled: `src/db/migrate.ts` revokes
 * `UPDATE, DELETE, TRUNCATE` on `event` and `event_audience` from the app role
 * (`AX-A5-1`). This class is the in-process half of the same promise.
 *
 * ## The fan-out is a table, and paging it is not a scan
 *
 * A jsonb ACL on the event row is un-indexable and turns per-principal paging
 * into a sequential scan (SPEC §15.1). So audience membership lives in rows,
 * indexed two ways: by event (for the filters) and **by principal, in admission
 * order** (for paging). `PROP-VI5` measures it: {@link EventLedger.metrics}
 * counts every stream entry the reader touched, and the test asserts a page of
 * one principal's audience feed out of thousands of foreign events touches a
 * bounded number of rows.
 *
 * ## Feeds are ordered by reveal, not by event tick
 *
 * A `PARTIES` message written at tick 5 and declassified at tick 287 must reach
 * a non-party's feed *at 287*. Ordered by `(tick, seq)` it would land behind
 * every cursor that principal already holds and never be delivered at all — a
 * silent hole in the one artifact whose whole value is being complete. So the
 * ordering key is `(revealedAtTick, ordinal)` (see {@link FeedCursor}), and an
 * event enters a reader's feed exactly once, at {@link firstAgentRevealTick}.
 */

import type { EventId, GameEvent, PrincipalId, Visibility } from '../core/types.js';
import {
  agentView,
  describeVisibility,
  everyoneReveal,
  firstAgentRevealTick,
  spectatorView,
  visibilityRule,
  visibilityFaultsAtBirth,
  type AudienceAdmission,
  type AudienceIndex,
  type AudienceRow,
  type EventView,
  type Redaction,
  type EventRecord,
  type VisibilityDescriptor,
} from './visibility.js';

/**
 * A refusal to append. Loud on purpose: the caller is the engine, not an agent,
 * so there is no hint to return and no turn to save — a malformed permanent row
 * is worse than an aborted tick (SPEC §15.2, "never publish a broken tick").
 */
export class EventLedgerError extends Error {}

/**
 * An event as submitted. `id` and `seqInTick` are the ledger's to mint: seq
 * assigned by the ledger is dense and gapless by construction, which is half of
 * INV-11, and the other half is asserted anyway because the index that
 * guarantees it is the thing most likely to be dropped by a careless migration.
 */
export type NewEvent = Omit<GameEvent, 'id' | 'seqInTick'> & {
  readonly visibility: Visibility;
  readonly audience: readonly AudienceAdmission[];
  /** Payload keys that survive `FLAG_ONLY`. `SEALED` only. */
  readonly flagKeys?: readonly string[];
};

/**
 * A position in a feed. Opaque to its holder.
 *
 * Ordered by `(revealedAtTick, ordinal)`, where `ordinal` is a **ledger-global**
 * counter minted when the reveal is recorded. The tiebreak is deliberately the
 * write order and not `(tick, seqInTick)`: two intel purchases settled in the
 * same tick, for events from different ticks, would otherwise insert *behind* a
 * cursor already issued from that reveal tick, and the second one would never be
 * delivered. A monotonic ordinal cannot land behind a cursor, so a reveal is
 * either ahead of you or already read — never lost.
 *
 * Being ledger-global also makes one cursor valid across both arms of the agent
 * feed merge, so a principal holds a single position rather than one per stream.
 *
 * **Precondition:** a cursor is only meaningful for reads at non-decreasing
 * ticks. Reading a feed *ahead* of `lastTick` and keeping the cursor will skip
 * whatever is written afterwards, so the tick loop reads at the tick it just
 * committed. The pure filters have no such constraint.
 */
export interface FeedCursor {
  readonly revealedAtTick: number;
  readonly ordinal: number;
}

export interface FeedPage {
  readonly views: readonly EventView[];
  /** Resume point. `null` when the page delivered nothing. */
  readonly nextCursor: FeedCursor | null;
  /** True when nothing further is readable at this tick. */
  readonly complete: boolean;
}

export interface FeedRequest {
  readonly atTick: number;
  readonly after: FeedCursor | null;
  readonly limit: number;
}

export interface AgentFeedRequest extends FeedRequest {
  readonly principal: PrincipalId;
}

/** Instrumentation, not state. Kept apart from the append-only record. */
export interface LedgerMetrics {
  /** Stream entries touched by reads. `PROP-VI5`'s scan detector. */
  entriesExamined: number;
}

interface RevealEntry {
  readonly rec: EventRecord;
  readonly atTick: number;
  readonly redaction: Redaction;
  /** Ledger-global write order. See {@link FeedCursor}. */
  readonly ordinal: number;
}

function cursorOf(entry: RevealEntry): FeedCursor {
  return { revealedAtTick: entry.atTick, ordinal: entry.ordinal };
}

function compareCursor(a: FeedCursor, b: FeedCursor): number {
  if (a.revealedAtTick !== b.revealedAtTick) return a.revealedAtTick - b.revealedAtTick;
  return a.ordinal - b.ordinal;
}

/** Index of the first element of an ascending array that is >= target. */
function lowerBound(xs: readonly number[], target: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const v = xs[mid];
    if (v === undefined || v < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * One reader's reveal stream, bucketed by reveal tick.
 *
 * Buckets rather than one sorted array because reveals arrive out of order: a
 * `PARTIES` event appended at tick 5 reveals at 287, and a `PUBLIC` event
 * appended at tick 6 reveals at 6. Within a bucket, entries are already in feed
 * order because the tiebreak is the global ordinal and ordinals only ever
 * increase — so nothing is ever sorted, and nothing can be inserted behind a
 * cursor already issued from that bucket.
 *
 * Reading is `O(log B + page)`: binary-search the bucket index, then walk. There
 * is no arrangement of appends that makes it a scan, which is the whole of
 * PROP-VI5.
 */
class RevealStream {
  private readonly buckets = new Map<number, RevealEntry[]>();
  /** Ascending distinct reveal ticks. */
  private readonly tickIndex: number[] = [];
  private count = 0;

  add(entry: RevealEntry): void {
    let bucket = this.buckets.get(entry.atTick);
    if (bucket === undefined) {
      bucket = [];
      this.buckets.set(entry.atTick, bucket);
      this.tickIndex.splice(lowerBound(this.tickIndex, entry.atTick), 0, entry.atTick);
    }
    bucket.push(entry);
    this.count += 1;
  }

  get size(): number {
    return this.count;
  }

  /**
   * Drop every entry minted at or after `ordinal`. The exact inverse of the adds
   * made since the capture that recorded it.
   *
   * Ordinals are global and strictly increasing in write order (see
   * {@link EventLedger.nextOrdinal}), so "written after the capture" and "ordinal
   * >= the captured next ordinal" are the same set — which is what makes this a
   * truncation rather than a guess about what to remove.
   */
  truncateAtOrdinal(ordinal: number): void {
    for (const [tick, bucket] of [...this.buckets.entries()]) {
      const kept = bucket.filter((entry) => entry.ordinal < ordinal);
      if (kept.length === bucket.length) continue;
      this.count -= bucket.length - kept.length;
      if (kept.length === 0) {
        this.buckets.delete(tick);
        const at = lowerBound(this.tickIndex, tick);
        if (this.tickIndex[at] === tick) this.tickIndex.splice(at, 1);
        continue;
      }
      this.buckets.set(tick, kept);
    }
  }

  /** Entries strictly after `after`, revealed by `uptoTick`, in feed order. */
  *iterate(
    after: FeedCursor | null,
    uptoTick: number,
    onExamine: () => void,
  ): Generator<RevealEntry> {
    const startTick = after === null ? 0 : after.revealedAtTick;
    for (let i = lowerBound(this.tickIndex, startTick); i < this.tickIndex.length; i += 1) {
      const t = this.tickIndex[i];
      if (t === undefined || t > uptoTick) return;
      const bucket = this.buckets.get(t);
      if (bucket === undefined) continue;
      for (const row of bucket) {
        onExamine();
        if (after !== null && compareCursor(cursorOf(row), after) <= 0) continue;
        yield row;
      }
    }
  }
}

export class EventLedger implements AudienceIndex {
  private readonly byId = new Map<EventId, EventRecord>();
  private readonly byTick = new Map<number, EventRecord[]>();
  private readonly byFamily = new Map<string, EventRecord[]>();

  /** The fan-out **table**, in write order. The rows, not an ACL blob. */
  private readonly audienceTable: AudienceRow[] = [];
  /** Index: event -> principal -> row. Serves both filters. */
  private readonly audienceByEvent = new Map<EventId, Map<PrincipalId, AudienceRow>>();
  /** Index: principal -> reveal stream. The one PROP-VI5 is about. */
  private readonly audienceByPrincipal = new Map<PrincipalId, RevealStream>();

  /**
   * Reveals to everyone. Shared by the spectator feed **and** by every agent
   * feed, as one object — the architectural half of A9 (SPEC §15.5). There is no
   * viewer-only stream to accidentally fill.
   */
  private readonly everyoneStream = new RevealStream();

  /** INV-14's previous observation. Compared, never read for behaviour. */
  private readonly visibilitySnapshot = new Map<EventId, VisibilityDescriptor>();
  /** Records whose audience changed, or that were appended, since the last assert. */
  private readonly touched = new Set<EventId>();

  private readonly seqByTick = new Map<number, number>();
  /** Highest tick this ledger has been written at. Time only moves forward. */
  private watermark = -1;
  /**
   * Global write order for reveal entries. Deterministic because the tick loop
   * orders actions by `(priority, principal_id, client_sequence)` and never by
   * arrival (SPEC §15.2), so the same action log mints the same ordinals.
   */
  private nextOrdinal = 0;

  readonly metrics: LedgerMetrics = { entriesExamined: 0 };

  private readonly examine = (): void => {
    this.metrics.entriesExamined += 1;
  };

  // ── Append ─────────────────────────────────────────────────────────────────

  /**
   * Append one event. The only mutation this class offers.
   *
   * Throws on anything that would write a permanent row the design cannot
   * stand behind. The caller is the tick loop, and a throw here means abort the
   * tick and halt (SPEC §15.2) rather than publish something wrong.
   */
  append(input: NewEvent): EventRecord {
    const { tick } = input;
    if (!Number.isSafeInteger(tick) || tick < 0) {
      throw new EventLedgerError(`event tick must be a non-negative safe integer, got ${tick}`);
    }
    if (tick < this.watermark) {
      throw new EventLedgerError(
        `cannot append at tick ${tick} behind the ledger watermark ${this.watermark};` +
          ' the record is append-only in time as well as in rows',
      );
    }
    if (!Number.isSafeInteger(input.rulesVersion) || input.rulesVersion < 1) {
      // INV-15: an accepted obligation pins the version it quoted. A missing or
      // nonsense version is how a later balance patch retroactively edits history.
      throw new EventLedgerError(
        `rulesVersion must be a positive safe integer, got ${String(input.rulesVersion)}`,
      );
    }
    if (input.kind.length === 0) throw new EventLedgerError('event kind must not be empty');
    if (input.eventFamilyId.length === 0) {
      throw new EventLedgerError('eventFamilyId must not be empty; it is the immutable cohort');
    }

    const seqInTick = this.seqByTick.get(tick) ?? 0;
    const id = mintEventId(tick, seqInTick);
    if (this.byId.has(id)) {
      throw new EventLedgerError(`event ${id} already exists; the ledger admits no rewrite`);
    }

    // INV-12: causality points backwards, always. A parent that does not exist
    // yet cannot be a cause, and requiring it to exist is what makes the
    // causality graph acyclic by construction rather than by inspection.
    if (input.parentEventId !== null) {
      const parent = this.byId.get(input.parentEventId);
      if (parent === undefined) {
        throw new EventLedgerError(
          `INV-12: parentEventId ${input.parentEventId} is not in the ledger; a cause must precede its effect`,
        );
      }
      if (parent.event.tick > tick) {
        throw new EventLedgerError(
          `INV-12: parent ${input.parentEventId} is at tick ${parent.event.tick}, later than child tick ${tick}`,
        );
      }
    }

    const event: GameEvent = deepFreeze({
      id,
      tick,
      seqInTick,
      kind: input.kind,
      rulesVersion: input.rulesVersion,
      actorPrincipalId: input.actorPrincipalId,
      onBehalfOfPrincipalId: input.onBehalfOfPrincipalId,
      grantId: input.grantId,
      eventFamilyId: input.eventFamilyId,
      parentEventId: input.parentEventId,
      isPublic: input.isPublic,
      publicAt: input.publicAt,
      declassifyAt: input.declassifyAt,
      provenanceClass: input.provenanceClass,
      actedOnStateVersion: input.actedOnStateVersion,
      decisionSource: input.decisionSource,
      payload: input.payload,
    });

    const rec: EventRecord = Object.freeze({
      event,
      visibility: input.visibility,
      flagKeys: Object.freeze([...(input.flagKeys ?? [])]),
    });

    const faults = visibilityFaultsAtBirth(rec, input.audience);
    if (faults.length > 0) {
      throw new EventLedgerError(
        `event ${id} (${rec.visibility}) rejected: ${faults.join('; ')}`,
      );
    }

    this.byId.set(id, rec);
    pushInto(this.byTick, tick, rec);
    pushInto(this.byFamily, input.eventFamilyId, rec);
    this.seqByTick.set(tick, seqInTick + 1);
    this.watermark = tick;

    for (const admission of input.audience) {
      this.writeAudienceRow(rec, admission, tick);
    }

    const reveal = everyoneReveal(rec);
    if (reveal !== null) {
      this.everyoneStream.add({
        rec,
        atTick: reveal.atTick,
        redaction: reveal.redaction,
        ordinal: this.nextOrdinal++,
      });
    }

    this.touched.add(id);
    return rec;
  }

  /**
   * Admit a principal to an event's audience after the fact — a hand came into
   * range, or the intel was bought.
   *
   * Returns false when the row would be pointless (already admitted, or the
   * event is already readable by everyone at this tick) and throws when the
   * caller is asking for something the ladder forbids. Rows are never removed;
   * that asymmetry is INV-14's audience clause, made structural.
   */
  admitAudience(
    eventId: EventId,
    principal: PrincipalId,
    basis: AudienceRow['basis'],
    atTick: number,
  ): boolean {
    const rec = this.byId.get(eventId);
    if (rec === undefined) throw new EventLedgerError(`no such event ${eventId}`);
    if (!Number.isSafeInteger(atTick) || atTick < rec.event.tick) {
      throw new EventLedgerError(
        `admitAudience tick ${atTick} precedes event ${eventId} at tick ${rec.event.tick}`,
      );
    }
    if (atTick < this.watermark) {
      throw new EventLedgerError(
        `cannot admit at tick ${atTick} behind the ledger watermark ${this.watermark}`,
      );
    }

    const rule = visibilityRule(rec.visibility);
    const existing = this.audienceByEvent.get(eventId) ?? new Map<PrincipalId, AudienceRow>();
    if (existing.has(principal)) return false;
    if (rule.maxAudience !== null && existing.size >= rule.maxAudience) {
      throw new EventLedgerError(
        `${rec.visibility} admits at most ${rule.maxAudience} audience rows` +
          (rec.visibility === 'SEALED'
            ? '; a seal is readable by nobody and PROP-D2 has no exceptions'
            : ''),
      );
    }

    // Admitting at or after declassification adds a row nobody needs and would
    // give one event two reveals in one reader's feed. Refuse, quietly.
    const reveal = everyoneReveal(rec);
    if (reveal !== null && atTick >= reveal.atTick) return false;

    this.writeAudienceRow(rec, { principal, basis }, atTick);
    this.watermark = atTick;
    this.touched.add(eventId);
    return true;
  }

  private writeAudienceRow(
    rec: EventRecord,
    admission: AudienceAdmission,
    atTick: number,
  ): void {
    const row: AudienceRow = Object.freeze({
      eventId: rec.event.id,
      eventTick: rec.event.tick,
      eventSeqInTick: rec.event.seqInTick,
      principal: admission.principal,
      basis: admission.basis,
      admittedAtTick: atTick,
    });
    this.audienceTable.push(row);

    let byPrincipal = this.audienceByEvent.get(rec.event.id);
    if (byPrincipal === undefined) {
      byPrincipal = new Map<PrincipalId, AudienceRow>();
      this.audienceByEvent.set(rec.event.id, byPrincipal);
    }
    byPrincipal.set(admission.principal, row);

    let stream = this.audienceByPrincipal.get(admission.principal);
    if (stream === undefined) {
      stream = new RevealStream();
      this.audienceByPrincipal.set(admission.principal, stream);
    }
    stream.add({ rec, atTick, redaction: 'FULL', ordinal: this.nextOrdinal++ });
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  /** {@link AudienceIndex}. The fan-out index, not a payload scan. */
  admittedAtTick(eventId: EventId, principal: PrincipalId): number | null {
    return this.audienceByEvent.get(eventId)?.get(principal)?.admittedAtTick ?? null;
  }

  get(id: EventId): EventRecord | null {
    return this.byId.get(id) ?? null;
  }

  get eventCount(): number {
    return this.byId.size;
  }

  get audienceRowCount(): number {
    return this.audienceTable.length;
  }

  get lastTick(): number {
    return this.watermark;
  }

  /** Distinct ticks written, ascending. */
  ticks(): readonly number[] {
    return [...this.byTick.keys()].sort((a, b) => a - b);
  }

  eventsAtTick(tick: number): readonly EventRecord[] {
    return this.byTick.get(tick) ?? [];
  }

  /** Every row of the fan-out table for one event. */
  audienceOf(eventId: EventId): readonly AudienceRow[] {
    const byPrincipal = this.audienceByEvent.get(eventId);
    if (byPrincipal === undefined) return [];
    return [...byPrincipal.values()];
  }

  /** All rows of the fan-out table, in write order. For the invariant pass. */
  allAudienceRows(): readonly AudienceRow[] {
    return this.audienceTable;
  }

  /**
   * **The spectator feed.** Exactly the everyone-stream, filtered by
   * {@link spectatorView}. No principal argument exists to pass, which is why a
   * viewer cannot be handed a fact no agent has.
   */
  spectatorFeed(req: FeedRequest): FeedPage {
    requirePageLimit(req.limit);
    const views: EventView[] = [];
    let last: FeedCursor | null = null;
    let complete = true;
    for (const entry of this.everyoneStream.iterate(req.after, req.atTick, this.examine)) {
      if (views.length >= req.limit) {
        complete = false;
        break;
      }
      const view = spectatorView(entry.rec, req.atTick);
      if (view === null) continue;
      views.push(view);
      last = cursorOf(entry);
    }
    return { views, nextCursor: last, complete };
  }

  /**
   * **The agent feed.** The everyone-stream merged with this principal's
   * audience stream, each event placed at the first tick this principal could
   * read it.
   */
  agentFeed(req: AgentFeedRequest): FeedPage {
    requirePageLimit(req.limit);
    const mine = this.audienceByPrincipal.get(req.principal);
    const everyone = this.everyoneStream.iterate(req.after, req.atTick, this.examine);
    const audience =
      mine === undefined
        ? emptyEntries()
        : mine.iterate(req.after, req.atTick, this.examine);

    const views: EventView[] = [];
    let last: FeedCursor | null = null;
    let complete = true;

    for (const entry of mergeByCursor(everyone, audience)) {
      if (views.length >= req.limit) {
        complete = false;
        break;
      }
      // Place each event once, at its earliest reveal for this reader: a party
      // sees its own negotiation when it happens, not again at settlement.
      const first = firstAgentRevealTick(entry.rec, req.principal, this);
      if (first !== entry.atTick) continue;
      const view = agentView(entry.rec, req.principal, req.atTick, this);
      if (view === null) continue;
      views.push(view);
      last = cursorOf(entry);
    }
    return { views, nextCursor: last, complete };
  }

  /**
   * The per-principal slice a jsonb ACL would turn into a sequential scan —
   * `PROP-VI5`'s "private-feed paging". Reads the fan-out index only, so its
   * cost is the page, not the ledger.
   */
  audiencePage(req: AgentFeedRequest): FeedPage {
    requirePageLimit(req.limit);
    const mine = this.audienceByPrincipal.get(req.principal);
    if (mine === undefined) return { views: [], nextCursor: null, complete: true };

    const views: EventView[] = [];
    let last: FeedCursor | null = null;
    let complete = true;
    for (const entry of mine.iterate(req.after, req.atTick, this.examine)) {
      if (views.length >= req.limit) {
        complete = false;
        break;
      }
      const view = agentView(entry.rec, req.principal, req.atTick, this);
      if (view === null) continue;
      views.push(view);
      last = cursorOf(entry);
    }
    return { views, nextCursor: last, complete };
  }

  /**
   * One cohort in causal order, through whichever filter the reader gets.
   *
   * This is the receipt reel's query (SPEC §14): after settlement a `PARTIES`
   * negotiation declassifies **completely**, so every reassuring thing the
   * traitor said can be put next to the promise it broke (`PROP-VI3`).
   */
  transcript(
    family: string,
    atTick: number,
    reader: { readonly kind: 'AGENT'; readonly principal: PrincipalId } | { readonly kind: 'VIEWER' },
  ): readonly EventView[] {
    const cohort = this.byFamily.get(family) ?? [];
    const out: EventView[] = [];
    for (const rec of cohort) {
      const view =
        reader.kind === 'VIEWER'
          ? spectatorView(rec, atTick)
          : agentView(rec, reader.principal, atTick, this);
      if (view !== null) out.push(view);
    }
    // Causal order, not reveal order: a transcript is read as a conversation.
    return out.sort(
      (a, b) => a.event.tick - b.event.tick || a.event.seqInTick - b.event.seqInTick,
    );
  }

  /**
   * `SEALED` content, for the season documentary and nothing else.
   *
   * Named at length because it is the one read in this file that is not a
   * filter: SPEC §11.2 gives seal content to viewers "in the season replay, when
   * it is archaeology rather than intelligence", and to agents never. It is
   * deliberately unreachable from {@link spectatorFeed} and {@link agentFeed} —
   * if it were a tier or a redaction, some future feed would eventually serve it.
   */
  seasonReplaySealedContent(throughTick: number): readonly EventRecord[] {
    const out: EventRecord[] = [];
    for (const tick of this.ticks()) {
      if (tick > throughTick) break;
      for (const rec of this.eventsAtTick(tick)) {
        if (rec.visibility === 'SEALED') out.push(rec);
      }
    }
    return out;
  }

  // ── The INV-14 audit snapshot ──────────────────────────────────────────────

  /** Records appended or re-audienced since {@link clearTouched}. */
  touchedSinceAssert(): readonly EventId[] {
    return [...this.touched];
  }

  clearTouched(): void {
    this.touched.clear();
  }

  describe(id: EventId): VisibilityDescriptor | null {
    const rec = this.byId.get(id);
    if (rec === undefined) return null;
    return describeVisibility(
      rec,
      this.audienceOf(id).map((r) => r.principal),
    );
  }

  previousDescriptor(id: EventId): VisibilityDescriptor | null {
    return this.visibilitySnapshot.get(id) ?? null;
  }

  recordDescriptor(id: EventId, descriptor: VisibilityDescriptor): void {
    this.visibilitySnapshot.set(id, descriptor);
  }
}

/**
 * Deterministic ids. `(tick, seq)` is already the primary key of the event
 * table, so deriving the id from it costs nothing and buys replay: no counter to
 * restore, no randomness, no clock, and the id sorts with the row it names.
 */
export function mintEventId(tick: number, seqInTick: number): EventId {
  return `ev:${tick}:${seqInTick}` as EventId;
}

/**
 * A page of zero is a caller bug that presents as an empty feed with no cursor
 * to resume from — indistinguishable, from an agent's side, from the world
 * having nothing to say. Refuse it (INV-26's spirit: bound every array, but
 * bound it above zero).
 */
function requirePageLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new EventLedgerError(`feed limit must be a positive safe integer, got ${limit}`);
  }
}

function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing === undefined) map.set(key, [value]);
  else existing.push(value);
}

function* emptyEntries(): Generator<RevealEntry> {
  // Nothing. Present so the merge always has two arms.
}

/** Merge two feed-ordered generators, preserving feed order. */
function* mergeByCursor(
  a: Generator<RevealEntry>,
  b: Generator<RevealEntry>,
): Generator<RevealEntry> {
  let left = a.next();
  let right = b.next();
  while (left.done !== true && right.done !== true) {
    if (compareCursor(cursorOf(left.value), cursorOf(right.value)) <= 0) {
      yield left.value;
      left = a.next();
    } else {
      yield right.value;
      right = b.next();
    }
  }
  while (left.done !== true) {
    yield left.value;
    left = a.next();
  }
  while (right.done !== true) {
    yield right.value;
    right = b.next();
  }
}

const MAX_FREEZE_DEPTH = 32;

/**
 * Freeze a structure so INV-16 holds at runtime and not only in the type
 * system. TypeScript's `readonly` disappears at the boundary with plain JS and
 * with `as` casts; `Object.freeze` does not, and under ESM strict mode a write
 * to a frozen property throws.
 */
function deepFreeze<T>(value: T, depth = 0): T {
  if (depth > MAX_FREEZE_DEPTH) {
    throw new EventLedgerError('event payload nested deeper than 32 levels');
  }
  if (value === null || typeof value !== 'object') return value;
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key], depth + 1);
  }
  return Object.freeze(value);
}
