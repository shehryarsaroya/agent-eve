/**
 * Receipts — the settlement's rows in the append-only record (SPEC §7.4, §11.2).
 *
 * §7.4's order ends "receipts posted -> standing moves -> encumbrances released", and
 * this is the receipts. It builds `NewEvent` drafts and **appends nothing**: the tick
 * loop owns the `EventLedger` and the batch is one transaction that fails closed
 * (§15.3), so a module that appended mid-settlement could leave rows behind a tick
 * that later aborted — and the event table admits no delete (INV-16).
 *
 * ## Tiers, and why a default is `PUBLIC` on the night
 *
 * §11.2 assigns them: "`PUBLIC`: ... settled ventures, defaults and cures". Both go
 * out at birth, to agents and viewers together, which is what makes A5 ("loss is
 * real, public, priceable") a property of the record rather than a promise about the
 * UI. §11.3 lists defaults among the things that are *always* public.
 *
 * A **recorded loss** is `PUBLIC` too and is deliberately a *different kind* from a
 * default. §10.2: an escrow shortfall is "a recorded loss, not a default". Emitting
 * one event kind for both would make `CARGO_LOST` indistinguishable from a broken
 * promise in the one artifact whose value is being right (E2E-2 asserts exactly this
 * distinction), and no amount of payload nuance survives a feed query that filters
 * on `kind`.
 *
 * ## Value is not in these payloads
 *
 * `posting` is authoritative (§15.1), and putting balanced totals on an event
 * "duplicates the posting table — scar #5 inside the field list that exists to
 * prevent scar #5". The amounts below are *descriptions of a settlement*, keyed to
 * the postings by `eventFamilyId`, and nothing reads them to decide anything.
 */

import type { EventId, GameEvent, PrincipalId, VentureId } from '../core/types.js';
import type { AudienceAdmission, NewEvent } from '../events/index.js';
import { compareIds } from '../ledger/index.js';
import type { VentureRecord } from './venture.js';
import { partiesOf } from './venture.js';
import type { VentureSettlement } from './settlement.js';

/** Event kinds this module writes. One kind per fact the feed must filter on. */
export const VENTURE_EVENT_KINDS = {
  formed: 'venture.formed',
  filled: 'venture.role_filled',
  settled: 'venture.settled',
  /** A broken promise, with its attributable cause (INV-17). */
  defaulted: 'venture.default',
  /** Value destroyed. **Not** a default — §10.2, PROP-L3, E2E-2. */
  loss: 'venture.recorded_loss',
  /** The deferral (§15.3). Explicitly not a breach, and the feed must say so. */
  deferred: 'venture.deferred',
} as const;

export interface ReceiptContext {
  readonly tick: number;
  readonly rulesVersion: number;
  /** INV-19's column, carried onto every row so replay can compare it. */
  readonly actedOnStateVersion: number | null;
  /** The cohort every row of one settlement shares (§15.1's immutable primary cohort). */
  familyOf(venture: VentureId): string;
  /** The event this settlement descends from, for the causality graph (INV-12). */
  readonly parentEventId: EventId | null;
}

function publicEvent(args: {
  readonly ctx: ReceiptContext;
  readonly kind: string;
  readonly actor: PrincipalId | null;
  readonly venture: VentureId;
  readonly payload: GameEvent['payload'];
}): NewEvent {
  return {
    tick: args.ctx.tick,
    kind: args.kind,
    rulesVersion: args.ctx.rulesVersion,
    actorPrincipalId: args.actor,
    onBehalfOfPrincipalId: null,
    grantId: null,
    eventFamilyId: args.ctx.familyOf(args.venture),
    parentEventId: args.ctx.parentEventId,
    isPublic: true,
    // PUBLIC declassifies at birth: `publicAt === declassifyAt === tick`, which is
    // what `visibilityFaultsAtBirth` requires and the reason these three are written
    // together rather than defaulted apart.
    publicAt: args.ctx.tick,
    declassifyAt: args.ctx.tick,
    provenanceClass: 'FACT',
    actedOnStateVersion: args.ctx.actedOnStateVersion,
    decisionSource: null,
    visibility: 'PUBLIC',
    audience: [],
    payload: args.payload,
  };
}

/**
 * A venture's formation, as `PARTIES` while it forms.
 *
 * §11.2 assigns `PARTIES` to "`PARTIES`-marked venture terms" and §5.1 requires that
 * commitments made in the commitment window are "`PARTIES`-visible only ... what
 * stops late information from being superior information (A4)". Declassifies at
 * settlement, which is what makes the receipt reel possible (PROP-VI3).
 */
export function formationEvent(
  venture: VentureRecord,
  ctx: ReceiptContext,
  declassifyAtTick: number,
): NewEvent {
  const audience: AudienceAdmission[] = [
    { principal: venture.creator, basis: 'SELF' },
    ...partiesOf(venture)
      .filter((p) => p !== venture.creator)
      .map((p): AudienceAdmission => ({ principal: p, basis: 'PARTY' })),
  ];
  if (venture.visibility === 'PUBLIC') {
    return publicEvent({
      ctx,
      kind: VENTURE_EVENT_KINDS.formed,
      actor: venture.creator,
      venture: venture.id,
      payload: formationPayload(venture),
    });
  }
  return {
    tick: ctx.tick,
    kind: VENTURE_EVENT_KINDS.formed,
    rulesVersion: ctx.rulesVersion,
    actorPrincipalId: venture.creator,
    onBehalfOfPrincipalId: null,
    grantId: null,
    eventFamilyId: ctx.familyOf(venture.id),
    parentEventId: ctx.parentEventId,
    isPublic: false,
    publicAt: declassifyAtTick,
    declassifyAt: declassifyAtTick,
    provenanceClass: 'FACT',
    actedOnStateVersion: ctx.actedOnStateVersion,
    decisionSource: null,
    visibility: 'PARTIES',
    audience,
    payload: formationPayload(venture),
  };
}

function formationPayload(venture: VentureRecord): GameEvent['payload'] {
  return {
    venture: venture.id,
    kind: venture.kind,
    creator: venture.creator,
    stage: venture.stage,
    termsHash: venture.termsHash,
    windowOpensTick: venture.windowOpensTick,
    windowClosesTick: venture.windowClosesTick,
    resolvesAtTick: venture.resolvesAtTick,
    roles: venture.roles.map((r) => ({
      index: r.index,
      label: r.label,
      wage: r.terms.wage,
      share: r.terms.share,
      escrowed: r.terms.escrowed,
      elective: r.terms.elective,
      filledByHandId: r.filledByHandId,
      filledByPrincipal: r.filledByPrincipal,
    })),
  };
}

/**
 * The rows one settlement produces: one `settled`, plus one per default, one for a
 * recorded loss, one for a deferral.
 *
 * Ordered, and the order is causal: the settlement first, then what it revealed. A
 * feed that shows a default before the settlement it came out of reads as an
 * accusation with no context.
 */
export function settlementEvents(
  settlement: VentureSettlement,
  creator: PrincipalId,
  ctx: ReceiptContext,
): readonly NewEvent[] {
  const out: NewEvent[] = [];

  out.push(
    publicEvent({
      ctx,
      kind:
        settlement.terminalState === 'DEFERRED'
          ? VENTURE_EVENT_KINDS.deferred
          : VENTURE_EVENT_KINDS.settled,
      actor: creator,
      venture: settlement.venture,
      payload: {
        venture: settlement.venture,
        outcome: settlement.outcome,
        terminalState: settlement.terminalState,
        proceeds: settlement.claims.proceeds,
        wagesCovered: settlement.claims.wagesCovered,
        residual: settlement.claims.residual,
        creatorShareBps: settlement.claims.creatorShareBps,
        creatorPart: settlement.claims.creatorPart,
        escrowReturned: settlement.escrowReturned,
        line: settlement.line,
        payouts: settlement.payouts
          .filter((p) => p.holder !== null)
          .map((p) => ({
            roleIndex: p.roleIndex,
            label: p.label,
            holder: p.holder,
            claim: p.claim,
            escrowedDue: p.escrowedDue,
            escrowedPaid: p.escrowedPaid,
            electiveDue: p.electiveDue,
            electivePaid: p.electivePaid,
          })),
      },
    }),
  );

  if (settlement.recordedLoss > 0) {
    out.push(
      publicEvent({
        ctx,
        kind: VENTURE_EVENT_KINDS.loss,
        actor: creator,
        venture: settlement.venture,
        payload: {
          venture: settlement.venture,
          outcome: settlement.outcome,
          amount: settlement.recordedLoss,
          // Structural, matching `ledger/cargoLost.ts`'s literal `isDefault: false`:
          // a shortfall on the escrowed half is value destroyed, and nobody broke a
          // promise. Naming it on the row means a feed cannot confuse the two.
          isDefault: false,
        },
      }),
    );
  }

  if (settlement.unattributed > 0) {
    out.push(
      publicEvent({
        ctx,
        kind: VENTURE_EVENT_KINDS.loss,
        actor: creator,
        venture: settlement.venture,
        payload: {
          venture: settlement.venture,
          outcome: settlement.outcome,
          amount: settlement.unattributed,
          isDefault: false,
          // The deferral bound. Published rather than swallowed, and published as a
          // loss rather than as a default, because A5' forbids a default this engine
          // cannot attribute.
          atDeferralBound: true,
        },
      }),
    );
  }

  for (const d of [...settlement.defaults].sort((a, b) => a.roleIndex - b.roleIndex)) {
    out.push(
      publicEvent({
        ctx,
        kind: VENTURE_EVENT_KINDS.defaulted,
        actor: d.payer,
        venture: settlement.venture,
        // ── AN OPEN CONSTRAINT, stated here because this is where it bites ────────
        //
        // INV-17 requires a default's `parent_event_id` to BE its attributable cause,
        // as a COLUMN — a default is the most serious thing this engine writes about
        // an agent, and the evidence has to be joinable in SQL by an auditor who does
        // not have our code. Attribution living only in a jsonb payload is attribution
        // an operator cannot query under pressure.
        //
        // It is NOT wired yet, and the reason is worth recording rather than guessing
        // at. `EventLedger.append` mints ids itself as `ev:{tick}:{seq}`
        // (events/ledger.ts) — the caller never chooses one. So `input.eventId`, the
        // handle this module receives, is not and cannot be a ledger id, and writing
        // it into `parentEventId` makes INV-12 reject the row outright: "a cause must
        // precede its effect". I tried exactly that and the invariant was right to
        // refuse it.
        //
        // Resolving it belongs to whoever appends the batch, because only that caller
        // knows the settled row's minted id: append the `venture.settled` row, read
        // the id back, then set each default's `parentEventId` to it before appending.
        // `settlementEvents` therefore has to become two-pass, or the Reckoning driver
        // has to patch the rows between emit and append. That is a Reckoning-driver
        // task and it is tracked, not forgotten — test/rules-surface pins the
        // requirement so it cannot ship unwired.
        payload: {
          venture: settlement.venture,
          roleIndex: d.roleIndex,
          payer: d.payer,
          payee: d.payee,
          amount: d.amount,
          cause: d.cause,
          // Kept in the payload too: the column is what INV-17 checks and what an
          // auditor joins on, and this is the human-readable copy beside the rest of
          // the row. Deliberately duplicated, and the invariant asserts they agree.
          causeEventId: d.causeEventId,
          isDefault: true,
        },
      }),
    );
  }

  return out;
}

/** Every row for a batch, in `venture_id` order — §15.3's settlement order. */
export function batchEvents(
  settlements: readonly VentureSettlement[],
  creatorOf: (venture: VentureId) => PrincipalId,
  ctx: ReceiptContext,
): readonly NewEvent[] {
  const ordered = [...settlements].sort((a, b) => compareIds(a.venture, b.venture));
  return ordered.flatMap((s) => settlementEvents(s, creatorOf(s.venture), ctx));
}
