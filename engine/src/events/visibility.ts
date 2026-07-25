/**
 * The five-tier visibility ladder (SPEC §11.2) and the two filters.
 *
 * There is **one** ladder — `PUBLIC | PARTIES | SENSED | SEALED | PRIVATE` —
 * used everywhere, with no second spelling of any tier (SPEC §3). The split that
 * carries the design: movement on public lanes is `PUBLIC`, because a convoy is
 * the map's motion and the map is the show, while cargo contents are only
 * `SENSED`. *A ship at sea is visible; its manifest is not.*
 *
 * ## A9 is a theorem here, not a review item
 *
 * {@link agentView} is implemented by **calling {@link spectatorView} first**.
 * Anything a viewer may read now, every agent may read now, by construction —
 * there is no code path that grants a viewer a fact and no agent. The extra
 * readership an agent has (its audience rows, and its own `PRIVATE` events) can
 * only ever *widen* the agent set. The parity fuzz in `test/events/parity.test.ts`
 * is therefore a regression test on this construction, which is what SPEC §16
 * step 2 asks for: **A9 as a test, not a review item.**
 *
 * Agents read the public feed, so any viewer privilege is immediately an agent
 * exploit. That is why the containment direction matters and why it is asserted
 * rather than argued.
 *
 * ## How the two §15.1 date columns are used
 *
 * Two columns, two jobs, no overlap:
 *
 * - **`declassifyAt`** — the tick from which *every agent and every viewer* may
 *   read the event at the tier's declassified redaction. First light.
 * - **`publicAt`** — the tick from which the same readership may read it at
 *   `FULL`. For every tier whose declassification is already full this equals
 *   `declassifyAt`; for `SEALED` it is `null`, because seal *content* never
 *   reaches a live feed at all.
 *
 * `isPublic` is the birth flag — true iff the tier is `PUBLIC` — and is the
 * column a public-feed query filters on. It is never flipped later: the event
 * table admits no `UPDATE` (INV-16), so publicity after birth is *derived* from
 * the two date columns, never rewritten into the row.
 *
 * ## Why `SEALED` content never declassifies to a live feed
 *
 * SPEC §11.1: agents receive `HONOURED | CONTRADICTED` and nothing else, ever,
 * at any tier, on any delay (PROP-D2) — publishing seal content to an
 * agent-readable channel is a perfect cartel-monitoring tool, and the harm
 * survives even a 24-hour lag. So a `SEALED` event declassifies to
 * `FLAG_ONLY`: existence, author and Reckoning, never the intent. Viewers get
 * the same redaction at the same tick, which is what keeps A9 exact. The
 * *content* appears only in the season replay, which is a separate named
 * artifact ({@link Redaction} never grants it) and is deliberately not reachable
 * from either filter.
 *
 * The verdict itself is a **separate `PUBLIC` event** parented to the seal.
 * It has to be: the verdict is computed at the Reckoning and the seal row is
 * already immutable, so there is no row to write it into. That is the whole
 * reason this module needs a flag redaction rather than a mutable seal.
 */

import type { EventId, GameEvent, PrincipalId, Visibility } from '../core/types.js';

/**
 * How much of an event a reader gets. `FLAG_ONLY` keeps an **allow-list** of
 * payload keys, never a deny-list: a deny-list leaks every field added after it
 * was written, and the field it leaks would be seal content.
 */
export type Redaction = 'FULL' | 'FLAG_ONLY';

/**
 * Why a principal is in an event's audience.
 *
 * Deliberately **not** called `reason`: SPEC §11.1 owns that word for the
 * 140-character public line on every material act, and §3 is a rules surface —
 * no word may name two concepts.
 */
export type AudienceBasis = 'SELF' | 'PARTY' | 'IN_RANGE' | 'INTEL';

/** One row of the audience fan-out table. Rows are added, never removed. */
export interface AudienceRow {
  readonly eventId: EventId;
  readonly eventTick: number;
  readonly eventSeqInTick: number;
  readonly principal: PrincipalId;
  readonly basis: AudienceBasis;
  /**
   * The tick this row was written. A `SENSED` audience grows after the fact —
   * a hand comes into range, or somebody buys the intel — so the admission has
   * its own date. Without it, a feed cursor already past the event's own tick
   * would silently never deliver it.
   */
  readonly admittedAtTick: number;
}

/** A principal to admit at append time, before the row has a date. */
export interface AudienceAdmission {
  readonly principal: PrincipalId;
  readonly basis: AudienceBasis;
}

/**
 * An event as stored: the immutable §15.1 record, its tier, and the allow-list
 * that survives a `FLAG_ONLY` projection.
 *
 * `visibility` and `flagKeys` are columns on the event row, not payload keys —
 * a filter that has to parse jsonb to decide who may read something is the
 * un-indexable design SPEC §15.1 rejects.
 */
export interface EventRecord {
  readonly event: GameEvent;
  readonly visibility: Visibility;
  /** Payload keys that survive `FLAG_ONLY`. Empty for every tier but `SEALED`. */
  readonly flagKeys: readonly string[];
}

/** What a given reader may read of a given event, right now. */
export interface EventView {
  /** Already redacted. For `FLAG_ONLY` the payload holds only `flagKeys`. */
  readonly event: GameEvent;
  readonly redaction: Redaction;
  /** The tick this reader gained this view. The feed's ordering key. */
  readonly revealedAtTick: number;
}

/** Read-side view of the audience fan-out table. The ledger implements it. */
export interface AudienceIndex {
  /** The tick `principal` was admitted to `eventId`'s audience, or null. */
  admittedAtTick(eventId: EventId, principal: PrincipalId): number | null;
}

/** How much a tier releases when it declassifies. */
export function declassifiedRedaction(visibility: Visibility): Redaction {
  switch (visibility) {
    case 'SEALED':
      // The flag, forever. Content lives in the season replay only (PROP-D2).
      return 'FLAG_ONLY';
    case 'PUBLIC':
    case 'PARTIES':
    case 'SENSED':
    case 'PRIVATE':
      return 'FULL';
  }
}

/**
 * When an event becomes readable by **everyone** — every agent and every
 * viewer, the same tick, the same redaction. `null` means never, live.
 *
 * This single function is the whole of the spectator filter's authority, and it
 * takes no principal argument. That is the structural reason a viewer cannot be
 * privileged over an agent.
 */
export function everyoneReveal(
  rec: EventRecord,
): { readonly atTick: number; readonly redaction: Redaction } | null {
  const at = rec.event.declassifyAt;
  if (at === null) return null;
  return { atTick: at, redaction: declassifiedRedaction(rec.visibility) };
}

/** Project an event down to a redaction. Returns a frozen structure. */
export function redactedEvent(rec: EventRecord, redaction: Redaction): GameEvent {
  if (redaction === 'FULL') return rec.event;
  const payload: Record<string, unknown> = {};
  for (const key of rec.flagKeys) {
    // hasOwnProperty rather than `in`: a payload key inherited from Object's
    // prototype is not a fact anybody asserted.
    if (Object.prototype.hasOwnProperty.call(rec.event.payload, key)) {
      payload[key] = rec.event.payload[key];
    }
  }
  return Object.freeze({ ...rec.event, payload: Object.freeze(payload) });
}

/**
 * **The spectator filter.** What a viewer may read at `atTick`.
 *
 * An OWNER reads exactly this (SPEC §11.2: "an owner reads only what a viewer
 * reads, plus its own agent's dispatches"), which is why there is no third
 * filter — a second implementation of one readership is how the two drift apart.
 */
export function spectatorView(rec: EventRecord, atTick: number): EventView | null {
  const reveal = everyoneReveal(rec);
  if (reveal === null || atTick < reveal.atTick) return null;
  return {
    event: redactedEvent(rec, reveal.redaction),
    redaction: reveal.redaction,
    revealedAtTick: reveal.atTick,
  };
}

/**
 * **The agent filter.** What `principal` may read at `atTick`.
 *
 * Deliberately built on top of {@link spectatorView}: the agent set is the
 * viewer set plus this principal's audience rows, so containment cannot be
 * broken by editing one branch. See the module header.
 */
export function agentView(
  rec: EventRecord,
  principal: PrincipalId,
  atTick: number,
  audience: AudienceIndex,
): EventView | null {
  const asViewer = spectatorView(rec, atTick);
  if (asViewer !== null) return asViewer;

  // Defence in depth on the one thing PROP-D2 forbids absolutely. An audience
  // row on a SEALED event is rejected at append; if one ever existed anyway it
  // must not become a hole through which seal content reaches an agent.
  if (rec.visibility === 'SEALED') return null;

  const admitted = audience.admittedAtTick(rec.event.id, principal);
  if (admitted === null || atTick < admitted) return null;
  return { event: rec.event, redaction: 'FULL', revealedAtTick: admitted };
}

/**
 * The first tick `principal` could read this event at all, or null for never.
 *
 * Feeds use it to place each event exactly once: a party sees a `PARTIES`
 * message when it is written, not again when it declassifies.
 */
export function firstAgentRevealTick(
  rec: EventRecord,
  principal: PrincipalId,
  audience: AudienceIndex,
): number | null {
  const everyone = everyoneReveal(rec);
  const admitted =
    rec.visibility === 'SEALED' ? null : audience.admittedAtTick(rec.event.id, principal);
  if (everyone === null) return admitted;
  if (admitted === null) return everyone.atTick;
  return Math.min(everyone.atTick, admitted);
}

// ── Tier rules, as data ──────────────────────────────────────────────────────

/** What `declassifyAt` may be, per tier. */
type DeclassifyRule = 'NULL' | 'BIRTH' | 'STRICTLY_LATER';

interface VisibilityRule {
  /** `isPublic` is true for exactly one tier. */
  readonly isPublic: boolean;
  readonly declassifyAt: DeclassifyRule;
  /** `true` when `publicAt` must equal `declassifyAt`; `false` when it must be null. */
  readonly fullOnDeclassify: boolean;
  readonly minAudience: number;
  readonly maxAudience: number | null;
  readonly flagKeysAllowed: boolean;
}

/**
 * The ladder, as a table the append path checks rather than a convention the
 * append path hopes for. Read it against SPEC §11.2's five rows.
 */
const VISIBILITY_RULES: Readonly<Record<Visibility, VisibilityRule>> = Object.freeze({
  // Everyone, now. The map's motion.
  PUBLIC: {
    isPublic: true,
    declassifyAt: 'BIRTH',
    fullOnDeclassify: true,
    minAudience: 0,
    maxAudience: 0,
    flagKeysAllowed: false,
  },
  // The parties now; all agents AND viewers at settlement. Two parties minimum,
  // or it is not a negotiation and INV-13 has nothing to check.
  PARTIES: {
    isPublic: false,
    declassifyAt: 'STRICTLY_LATER',
    fullOnDeclassify: true,
    minAudience: 2,
    maxAudience: null,
    flagKeysAllowed: false,
  },
  // Whoever has a hand in range or bought the intel; everyone after the
  // Reckoning it mattered in.
  SENSED: {
    isPublic: false,
    declassifyAt: 'STRICTLY_LATER',
    fullOnDeclassify: true,
    minAudience: 1,
    maxAudience: null,
    flagKeysAllowed: false,
  },
  // Nobody now. The flag at its Reckoning; the content never, live.
  SEALED: {
    isPublic: false,
    declassifyAt: 'STRICTLY_LATER',
    fullOnDeclassify: false,
    minAudience: 0,
    maxAudience: 0,
    flagKeysAllowed: true,
  },
  // The principal itself. Never anyone else, ever, including its owner.
  PRIVATE: {
    isPublic: false,
    declassifyAt: 'NULL',
    fullOnDeclassify: false,
    minAudience: 1,
    maxAudience: 1,
    flagKeysAllowed: false,
  },
} satisfies Record<Visibility, VisibilityRule>);

export function visibilityRule(visibility: Visibility): VisibilityRule {
  return VISIBILITY_RULES[visibility];
}

/**
 * The only payload keys a `SEALED` event may release at `FLAG_ONLY` — the flag,
 * and nothing that could carry intent.
 *
 * This exists because `flagKeys` was otherwise an unrestricted caller-supplied
 * allow-list: naming the intent key published seal content to every agent and
 * every viewer at the seal's own Reckoning, through the ordinary append path,
 * with no cast and no invariant firing. PROP-D2 is the one prohibition in this
 * module with no exceptions, so it cannot be the one rule left to caller
 * discipline — the ladder decides what escapes a seal, not the seal's author.
 *
 * Extending this set is a deliberate act with a review attached. Adding a key
 * here is adding it to what agents may read about a promise before the season
 * closes, which is exactly the cartel-monitoring surface §11.2 closes.
 */
export const SEAL_FLAG_KEYS: ReadonlySet<string> = new Set(['sealId', 'reckoningIndex']);

/**
 * Everything wrong with a candidate event's visibility, checked before it is
 * admitted to the ledger. Empty means clean.
 *
 * This runs at append rather than at assert because an append-only table cannot
 * be corrected: a bad row is permanent, and a permanent row that libels a real
 * agent is the A5′ failure that is strictly worse than a crash.
 */
export function visibilityFaultsAtBirth(
  rec: EventRecord,
  audience: readonly AudienceAdmission[],
): string[] {
  const faults: string[] = [];
  const e = rec.event;
  const rule = VISIBILITY_RULES[rec.visibility];

  if (e.isPublic !== rule.isPublic) {
    faults.push(
      `isPublic must be ${String(rule.isPublic)} for visibility ${rec.visibility}, got ${String(e.isPublic)}`,
    );
  }

  switch (rule.declassifyAt) {
    case 'NULL':
      if (e.declassifyAt !== null) {
        faults.push(`${rec.visibility} never declassifies; declassifyAt must be null`);
      }
      break;
    case 'BIRTH':
      if (e.declassifyAt !== e.tick) {
        faults.push(`${rec.visibility} declassifies at birth; declassifyAt must equal tick ${e.tick}`);
      }
      break;
    case 'STRICTLY_LATER':
      if (e.declassifyAt === null || e.declassifyAt <= e.tick) {
        faults.push(
          `${rec.visibility} declassifies later; declassifyAt must be > tick ${e.tick}` +
            ` (use PUBLIC for a fact that is public on the tick it happens)`,
        );
      }
      break;
  }

  if (rule.fullOnDeclassify) {
    if (e.publicAt !== e.declassifyAt) {
      faults.push(
        `${rec.visibility} declassifies to FULL; publicAt must equal declassifyAt` +
          ` (${String(e.publicAt)} vs ${String(e.declassifyAt)})`,
      );
    }
  } else if (e.publicAt !== null) {
    faults.push(`${rec.visibility} is never fully public on a live feed; publicAt must be null`);
  }

  // INV-14 clause 3, checked where it can actually be violated: at birth. The
  // tier table makes it structurally unreachable, and this is the independent
  // check on the tier table.
  if (!e.isPublic && e.publicAt !== null && e.publicAt <= e.tick) {
    faults.push(
      `INV-14: publicAt ${e.publicAt} is not in the future while isPublic is false (tick ${e.tick})`,
    );
  }

  // INV-13's append-time half.
  if (audience.length < rule.minAudience) {
    faults.push(
      `INV-13: ${rec.visibility} requires >=${rule.minAudience} audience rows, got ${audience.length}`,
    );
  }
  if (rule.maxAudience !== null && audience.length > rule.maxAudience) {
    faults.push(
      `${rec.visibility} admits at most ${rule.maxAudience} audience rows, got ${audience.length}`,
    );
  }

  const seen = new Set<PrincipalId>();
  for (const row of audience) {
    if (seen.has(row.principal)) {
      faults.push(`duplicate audience row for ${row.principal}`);
    }
    seen.add(row.principal);
  }

  if (rec.visibility === 'PRIVATE') {
    const only = audience[0];
    if (only === undefined || only.basis !== 'SELF') {
      faults.push('PRIVATE admits exactly one audience row, with basis SELF');
    } else if (e.actorPrincipalId === null || only.principal !== e.actorPrincipalId) {
      faults.push(
        'PRIVATE belongs to the principal that wrote it; its audience row must be actorPrincipalId',
      );
    }
  }

  if (!rule.flagKeysAllowed && rec.flagKeys.length > 0) {
    faults.push(`flagKeys are only meaningful for SEALED, not ${rec.visibility}`);
  }
  if (rule.flagKeysAllowed) {
    for (const key of rec.flagKeys) {
      if (!Object.prototype.hasOwnProperty.call(e.payload, key)) {
        // A typo in the allow-list silently reveals nothing, which reads on
        // screen as "the seal had no flag". Fail loudly instead.
        faults.push(`flagKey ${JSON.stringify(key)} is not present in the payload`);
      }
      if (!SEAL_FLAG_KEYS.has(key)) {
        // PROP-D2: the ladder decides what escapes a seal, not the caller. An
        // unrestricted allow-list let `intent` be named and published.
        faults.push(
          `PROP-D2: flagKey ${JSON.stringify(key)} is not one of the flag keys a SEALED event may` +
            ` release (${[...SEAL_FLAG_KEYS].join(', ')}); seal content reaches no live feed, ever`,
        );
      }
    }
  }

  return faults;
}

// ── INV-14 ───────────────────────────────────────────────────────────────────

/**
 * A snapshot of one event's visibility, for the monotonicity check.
 *
 * This is an **audit snapshot, never a source of truth**: it is only ever
 * compared, never read to decide anything. Storing it and *using* it would be
 * scar #5 (one quantity, two homes) applied to the record itself.
 */
export interface VisibilityDescriptor {
  readonly visibility: Visibility;
  readonly isPublic: boolean;
  readonly publicAt: number | null;
  readonly declassifyAt: number | null;
  /** Ascending by UTF-16 code unit, so the comparison is platform-stable. */
  readonly audience: readonly PrincipalId[];
}

export function describeVisibility(
  rec: EventRecord,
  audience: readonly PrincipalId[],
): VisibilityDescriptor {
  const sorted = [...audience].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    visibility: rec.visibility,
    isPublic: rec.event.isPublic,
    publicAt: rec.event.publicAt,
    declassifyAt: rec.event.declassifyAt,
    audience: sorted,
  };
}

/**
 * INV-14 — visibility is monotonic. Everything that moved wrongly, or empty.
 *
 * The strict reading, taken deliberately: the tier and both date columns are
 * **frozen**, and the audience may only grow. "`declassify_at` never moves
 * earlier" is the leak case (a promised release pulled forward); moving it
 * *later* after it has passed un-publishes a fact somebody already read, which
 * "nothing already public becomes private" forbids; and a `null` schedule
 * gaining a date is how `PRIVATE` reasoning or seal content would escape. Every
 * direction is therefore a regression, which is both the safest rule and the one
 * that matches what an append-only table can actually promise.
 */
export function visibilityRegressions(
  prev: VisibilityDescriptor,
  next: VisibilityDescriptor,
): string[] {
  const out: string[] = [];
  if (prev.visibility !== next.visibility) {
    out.push(`visibility changed ${prev.visibility} -> ${next.visibility}`);
  }
  if (prev.isPublic !== next.isPublic) {
    out.push(`isPublic changed ${String(prev.isPublic)} -> ${String(next.isPublic)}`);
  }
  if (prev.publicAt !== next.publicAt) {
    out.push(`publicAt changed ${String(prev.publicAt)} -> ${String(next.publicAt)}`);
  }
  if (prev.declassifyAt !== next.declassifyAt) {
    out.push(`declassifyAt changed ${String(prev.declassifyAt)} -> ${String(next.declassifyAt)}`);
  }
  const now = new Set<PrincipalId>(next.audience);
  for (const p of prev.audience) {
    if (!now.has(p)) out.push(`audience lost ${p}; rows are added, never removed`);
  }
  return out;
}
