/**
 * The PROP-D2 boundary: **agents receive `HONOURED | CONTRADICTED` and nothing
 * else, ever, at any tier, on any delay.**
 *
 * ## Why this is the one prohibition with no exceptions
 *
 * SPEC §11.2: publishing seal *content* to a channel agents can read hands them a
 * perfect tool for verifying each other's private pre-commitments, "and the harm
 * survives even a 24-hour lag, because *did you honour the abstention you
 * promised* is checkable retrospectively." Six agents with a shared brief and a
 * nightly content feed have a working cartel monitor. That is `AGT-X4`'s explicit
 * assertion and the quiet-equilibrium critic's named failure mode.
 *
 * Wave 1 found this same prohibition escaping through an **unchecked
 * caller-supplied allow-list**: `flagKeys` on a `SEALED` event was whatever the
 * caller passed, so naming `intent` published the content through the ordinary
 * append path with no invariant firing. The events module closed it with
 * `SEAL_FLAG_KEYS`. This module closes the other half:
 *
 * - {@link sealCommitEvent} and {@link sealVerdictEvent} take **no** payload and
 *   **no** allow-list argument. There is no parameter through which a caller can
 *   widen what escapes, so opting out requires editing this file.
 * - {@link agentSealDisclosure} builds a fresh object with a fixed key list. It
 *   never spreads the record, so a field added to `SealAuditRecord` later cannot
 *   silently join the disclosure.
 * - {@link viewerSealDisclosure} is implemented by *calling* the agent one, the
 *   same construction `events/visibility.ts` uses to make A9 a theorem: the two
 *   readerships cannot drift because there is only one implementation.
 * - {@link sealContentLeaks} is the belt-and-braces scan an HTTP layer can run
 *   over anything it is about to send.
 *
 * ## What deliberately does not appear anywhere agent-readable
 *
 * Not just the intent and the prose:
 *
 * - **the verdict basis** — `OUT_OF_BAND` and `NO_ATTRIBUTABLE_DEED` are two
 *   different facts about a sealed intention ("it acted and missed" versus "it did
 *   nothing"), and PROP-D2 permits one fact;
 * - **the cited deed** — naming the public deed a verdict was computed from
 *   narrows the sealed `verb` and `target` to that deed's, which is content
 *   arriving on a fixed lag by another route;
 * - **the venture the seal's role belonged to** — so both seal events carry the
 *   family `seal:{id}` rather than the venture's cohort. The receipt reel is
 *   assembled per principal per Reckoning, which needs no such link.
 *
 * All three live on the audit record and reach viewers only in the season replay,
 * "when it is archaeology rather than intelligence" (§11.2).
 */

import type { EventId, PrincipalId, SealId, SealVerdict } from '../core/types.js';
import { TICKS_PER_RECKONING } from '../core/time.js';
import { SEAL_FLAG_KEYS, type NewEvent } from '../events/index.js';
import { compareIds } from '../ledger/order.js';
import type { SealAuditRecord, SealRoleRef } from './book.js';
import { intentToCanonical, type SealIntent } from './intent.js';

/** Programmer error at the disclosure boundary. Never a rejection: no agent asked. */
export class SealDisclosureError extends Error {}

/**
 * The **only** shape a seal ever takes for an agent or a viewer. Exactly four
 * keys, asserted by a test against {@link SEAL_DISCLOSURE_KEYS}.
 */
export const SEAL_DISCLOSURE_KEYS = ['sealId', 'reckoningIndex', 'principal', 'verdict'] as const;

export interface SealDisclosure {
  readonly sealId: SealId;
  readonly reckoningIndex: number;
  readonly principal: PrincipalId;
  /** `null` until its own Reckoning resolves. Never anything but the flag. */
  readonly verdict: SealVerdict | null;
}

/**
 * The agent projection.
 *
 * Built key by key on purpose. `{...rec, ...}` with a delete list would leak every
 * field added to the record afterwards, and the field it leaked would be seal
 * content — the same shape as the allow-list bug wave 1 found.
 */
export function agentSealDisclosure(rec: SealAuditRecord): SealDisclosure {
  return Object.freeze({
    sealId: rec.id,
    reckoningIndex: rec.reckoningIndex,
    principal: rec.principal,
    verdict: rec.verdict,
  });
}

/**
 * The viewer projection. Identical, by construction rather than by coincidence:
 * A9 says a viewer never sees a live fact an agent's own `observe` would not.
 */
export function viewerSealDisclosure(rec: SealAuditRecord): SealDisclosure {
  return agentSealDisclosure(rec);
}

// ── Events ───────────────────────────────────────────────────────────────────

/**
 * The tick at which a Reckoning settles — and therefore the tick a seal's **flag**
 * declassifies. Derived, never a literal, so it moves with `TICKS_PER_RECKONING`.
 */
export function settlementTickOf(reckoning: number): number {
  return (reckoning + 1) * TICKS_PER_RECKONING - 1;
}

/**
 * The `SEALED` event that records a seal.
 *
 * Nobody may read it now; at its Reckoning it declassifies to `FLAG_ONLY`, which
 * releases `sealId` and `reckoningIndex` and nothing else, forever. The content in
 * the payload exists for the season replay, which is reachable only through
 * `EventLedger.seasonReplaySealedContent` — deliberately not from either feed.
 *
 * There is no payload parameter and no `flagKeys` parameter. The ladder decides
 * what escapes a seal, not the seal's author.
 */
export function sealCommitEvent(rec: SealAuditRecord, rulesVersion: number): NewEvent {
  const payload: Readonly<Record<string, unknown>> = Object.freeze({
    sealId: rec.id,
    reckoningIndex: rec.reckoningIndex,
    sealedAtTick: rec.sealedAtTick,
    actedOnStateVersion: rec.actedOnStateVersion,
    // Season-replay content. Never released by a flag key; see SEAL_FLAG_KEYS.
    intent: intentToCanonical(rec.intent),
    prose: rec.prose,
    role: rec.role === null ? null : roleCanonical(rec.role),
  });

  const declassifyAt = settlementTickOf(rec.reckoningIndex);
  if (declassifyAt <= rec.sealedAtTick) {
    // Structurally impossible while `commit` refuses to seal in the freeze, and
    // asserted anyway: a SEALED event whose flag is already due would be rejected
    // by the ladder, and a rejected append at the Reckoning is a halted world.
    throw new SealDisclosureError(
      `seal ${rec.id} was sealed at tick ${rec.sealedAtTick}, at or after its own Reckoning's` +
        ` settlement tick ${declassifyAt}; a seal must precede the freeze`,
    );
  }

  return {
    tick: rec.sealedAtTick,
    kind: 'SEAL_COMMITTED',
    rulesVersion,
    actorPrincipalId: rec.principal,
    onBehalfOfPrincipalId: null,
    grantId: null,
    // Not the venture's cohort — see the module header on what must not link.
    eventFamilyId: `seal:${rec.id}`,
    parentEventId: null,
    visibility: 'SEALED',
    isPublic: false,
    publicAt: null,
    declassifyAt,
    provenanceClass: 'FACT',
    actedOnStateVersion: rec.actedOnStateVersion,
    decisionSource: 'LIVE',
    payload,
    audience: [],
    flagKeys: sealFlagKeysFor(payload),
  };
}

/**
 * The `PUBLIC` verdict event. Its payload is **exactly** the disclosure.
 *
 * A separate event because the seal row is already immutable when the verdict is
 * computed (INV-16: the event table admits no `UPDATE`), and because the two have
 * different readerships: the seal is `SEALED` forever, the flag is `PUBLIC` at the
 * Reckoning.
 *
 * `actorPrincipalId` is null: the Reckoning computed this, not the principal. The
 * principal it concerns is a payload field, so nothing reads as an act the agent
 * chose to take.
 *
 * **Drive this from `SealResolution.verdicts`, never from `auditRecords()`.** A seal
 * that closed `DEFERRED` has no flag by design and throws here, because there is
 * nothing to publish: to every reader it must look exactly like a seal whose
 * Reckoning has not come, and inventing a `DEFERRED` event would put a second fact
 * about a sealed intention on a `PUBLIC` channel (PROP-D2).
 */
export function sealVerdictEvent(
  rec: SealAuditRecord,
  rulesVersion: number,
  parentEventId: EventId | null,
): NewEvent {
  if (rec.verdict === null || rec.verdictAtTick === null) {
    throw new SealDisclosureError(`seal ${rec.id} has no verdict yet; nothing to publish`);
  }
  const disclosure = agentSealDisclosure(rec);
  return {
    tick: rec.verdictAtTick,
    kind: 'SEAL_RESOLVED',
    rulesVersion,
    actorPrincipalId: null,
    onBehalfOfPrincipalId: null,
    grantId: null,
    eventFamilyId: `seal:${rec.id}`,
    parentEventId,
    visibility: 'PUBLIC',
    isPublic: true,
    publicAt: rec.verdictAtTick,
    declassifyAt: rec.verdictAtTick,
    provenanceClass: 'FACT',
    actedOnStateVersion: null,
    decisionSource: null,
    payload: Object.freeze({
      sealId: disclosure.sealId,
      reckoningIndex: disclosure.reckoningIndex,
      principal: disclosure.principal,
      verdict: disclosure.verdict,
    }),
    audience: [],
  };
}

/**
 * The flag keys, taken from the ladder's own set and intersected with the payload.
 *
 * Intersected rather than asserted because `visibilityFaultsAtBirth` rejects a
 * flag key that is absent from the payload, and a rejected append at commit time
 * is a halted world for a typo. Sorted so the row is byte-identical on every host
 * (DET-4).
 */
function sealFlagKeysFor(payload: Readonly<Record<string, unknown>>): readonly string[] {
  return [...SEAL_FLAG_KEYS]
    .filter((k) => Object.prototype.hasOwnProperty.call(payload, k))
    .sort(compareIds);
}

function roleCanonical(role: SealRoleRef): Readonly<Record<string, unknown>> {
  return Object.freeze({ venture: role.venture, roleIndex: role.roleIndex });
}

// ── The season replay ────────────────────────────────────────────────────────

/**
 * Seal content, for the season documentary and nothing else.
 *
 * §11.2 gives viewers the content "in the season replay, when it is archaeology
 * rather than intelligence", and gives agents it never. The season boundary is an
 * argument rather than a flag on the record so there is no field to flip early.
 */
export interface SealReplayRow {
  readonly sealId: SealId;
  readonly principal: PrincipalId;
  readonly reckoningIndex: number;
  readonly sealedAtTick: number;
  readonly intent: SealIntent;
  readonly prose: string;
  readonly role: SealRoleRef | null;
  readonly verdict: SealVerdict | null;
  /** The attributable cause of the mark, for the audit and the documentary. */
  readonly citedDeedEventId: EventId | null;
}

export function seasonReplaySealContent(
  rec: SealAuditRecord,
  seasonClosesAtTick: number,
  atTick: number,
): SealReplayRow {
  if (atTick < seasonClosesAtTick) {
    throw new SealDisclosureError(
      `seal content is released in the season replay: tick ${atTick} is before the season closes at` +
        ` ${seasonClosesAtTick}. Agents never receive content, at any tier, on any delay (PROP-D2).`,
    );
  }
  return Object.freeze({
    sealId: rec.id,
    principal: rec.principal,
    reckoningIndex: rec.reckoningIndex,
    sealedAtTick: rec.sealedAtTick,
    intent: rec.intent,
    prose: rec.prose,
    role: rec.role,
    verdict: rec.verdict,
    citedDeedEventId: rec.citedDeedEventId,
  });
}

// ── Defence in depth ─────────────────────────────────────────────────────────

/**
 * Key names that only a seal projection would carry.
 *
 * `verb` and `target` are deliberately **absent**: an affordance legitimately has
 * both, and a check that flagged them would flag every ordinary observation. What
 * covers those two is the structural guarantee — {@link agentSealDisclosure}
 * cannot emit them — not this scan.
 */
const CONTENT_KEY_NAMES: readonly string[] = [
  'intent',
  'prose',
  'measure',
  'outcomeLow',
  'outcomeHigh',
  'basis',
  'citedDeedEventId',
  // `disposition` distinguishes "no flag yet" from "judged, and unjudgeable" — a
  // second fact about a sealed intention, which PROP-D2 permits no more than the
  // basis does. {@link agentSealDisclosure} cannot emit it; this is the scan half.
  'disposition',
];

/**
 * Everything in a **seal projection** that would leak content, or empty.
 *
 * Scope, stated because an over-claimed detector is worse than none: this checks a
 * structure that is *about a seal* — a disclosure, a seal event view, a docket row.
 * It is **not** a general outbound filter. A target id and a verb name are
 * legitimate values in an affordance or a hand's location, so a filter that
 * blocked them would block the ordinary observation, and a detector that cries
 * wolf is scar #8's mechanism (a noisy detector whose output is trusted).
 *
 * Bare band integers are not flagged for the same reason: `0` and `1` appear in
 * every payload in the game. Precision over recall, applied to the leak detector
 * itself.
 */
export function sealProjectionLeaks(candidate: unknown, rec: SealAuditRecord): string[] {
  const found: string[] = [];
  const needles = new Set<string>([rec.intent.target]);
  if (rec.prose.length > 0) needles.add(rec.prose);
  walk(candidate, '', needles, found, 0);
  return found;
}

const MAX_SCAN_DEPTH = 16;

function walk(
  value: unknown,
  path: string,
  needles: ReadonlySet<string>,
  found: string[],
  depth: number,
): void {
  if (depth > MAX_SCAN_DEPTH) return;
  if (typeof value === 'string') {
    if (needles.has(value)) found.push(`${path || '(root)'} carries seal content`);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      walk(v, `${path}[${String(i)}]`, needles, found, depth + 1);
    });
    return;
  }
  for (const [key, v] of Object.entries(value)) {
    const here = path === '' ? key : `${path}.${key}`;
    if (CONTENT_KEY_NAMES.includes(key)) found.push(`${here} is a seal content field`);
    walk(v, here, needles, found, depth + 1);
  }
}
