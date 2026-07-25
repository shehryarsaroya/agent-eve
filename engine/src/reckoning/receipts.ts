/**
 * **The INV-17 attribution column.** This file is the debt `src/venture/events.ts`
 * records at the site and `test/rules-surface/agent-md.test.ts` pins so it cannot
 * ship unwired.
 *
 * The finding, in the venture module's own words:
 *
 * > INV-17 requires a default's `parent_event_id` to BE its attributable cause, as a
 * > COLUMN — a default is the most serious thing this engine writes about an agent,
 * > and the evidence has to be joinable in SQL by an auditor who does not have our
 * > code. Attribution living only in a jsonb payload is attribution an operator cannot
 * > query under pressure.
 * >
 * > It is NOT wired yet ... `EventLedger.append` mints ids itself as `ev:{tick}:{seq}`
 * > — the caller never chooses one. So `input.eventId`, the handle this module
 * > receives, is not and cannot be a ledger id, and writing it into `parentEventId`
 * > makes INV-12 reject the row outright: "a cause must precede its effect". I tried
 * > exactly that and the invariant was right to refuse it.
 * >
 * > Resolving it belongs to whoever appends the batch, because only that caller knows
 * > the settled row's minted id.
 *
 * That caller is this one. The sequence is:
 *
 *   1. append the `venture.settled` (or `venture.deferred`) row and **read its minted
 *      id back**;
 *   2. resolve each default's cause to a real ledger id — the loss event when there
 *      was one, otherwise the settled row that has just been minted;
 *   3. append each default row with `parentEventId` set to that id;
 *   4. register the attribution against the minted default id, so
 *      {@link checkInv17}'s two directions agree.
 *
 * ## Why the cause is resolved rather than copied
 *
 * `VentureDefault.causeEventId` is `input.causeEventId ?? input.eventId` — either a
 * real ledger event (the raid, the missed delivery) or the settlement's own *handle*,
 * which is a string the driver chose and is not in the record. Those two are the same
 * type and mean different things, so this module decides between them by comparing
 * against the handle it passed in, and maps them onto INV-17's own cause kinds:
 *
 * | resolved to | `DefaultCauseKind` | what happened |
 * |---|---|---|
 * | the settled row | `ELAPSED_WINDOW` | the window ran out and the payer did not pay |
 * | a prior ledger row | `LOSS` | value was destroyed and the promise broke with it |
 *
 * A cause that is neither — a handle that is not the one passed, naming no row in the
 * ledger — **halts**. That is an engine-side defect: the alternative is publishing an
 * accusation whose evidence an auditor cannot open, and A5′ puts that below crashing.
 *
 * ### A `DECLINED` default is never attributed to the loss
 *
 * `settleBatch` stamps **every** default on a loss-outcome venture with the loss event
 * (`input.causeEventId ?? input.eventId`, `src/venture/settlement.ts`), including the
 * ones whose own `cause` is `DECLINED`. Resolved naively that publishes a payer who had
 * the money and simply refused with `parent_event_id` pointing at somebody else's raid
 * and a register kind of `LOSS` — the record saying *the promise broke because value was
 * destroyed* about a promise its payer chose to break, on the same row whose payload says
 * `DECLINED`. That is A5′'s "the record must never be wrong" in the flattering direction,
 * and it also libels the raider by making its event the cause of a default it did not
 * cause. So the election is decided first: a refusal is attributed to the settlement that
 * recorded it, and only a *funding* failure is attributed to the event that destroyed the
 * funds.
 *
 * ## Ordering is causal, and the ledger enforces it
 *
 * The settled row is appended first, so it has a lower `seq_in_tick` than every
 * default that cites it. `EventLedger.append` refuses a parent that is not already
 * stored and `checkInv17` refuses a cause at or after its effect, so "the evidence
 * precedes the accusation" is checked twice by two modules that do not share code.
 */

import type { EventId, PrincipalId, VentureId } from '../core/types.js';
import type { EventLedger, NewEvent } from '../events/index.js';
import {
  DefaultRegister,
  type DefaultAttribution,
  type DefaultCauseKind,
} from '../invariants/index.js';
import {
  VENTURE_EVENT_KINDS,
  settlementEvents,
  type ReceiptContext,
  type VentureDefault,
  type VentureSettlement,
} from '../venture/index.js';
import { ReckoningHalt } from './set.js';

/**
 * The settlement event **handle** for one venture in one Reckoning.
 *
 * Content-derived rather than a counter, which is what `SettleInput.eventId`'s doc
 * asks for: the same venture in the same Reckoning always produces the same handle, so
 * a replay stamps the same postings, and a deferral's second pass gets a different
 * handle because it is a different Reckoning.
 *
 * `::` is the separator everywhere in this codebase. Two earlier waves used a NUL
 * byte, after which `file(1)` reports the source as `data` and `grep` skips it while
 * every gate stays green.
 */
export function settlementHandle(reckoning: number, venture: VentureId): EventId {
  return `settle::r${String(reckoning)}::${venture}` as EventId;
}

/** What one venture's receipts became in the permanent record. */
export interface SettlementReceipt {
  readonly venture: VentureId;
  /** The minted `venture.settled` or `venture.deferred` row. */
  readonly settledEventId: EventId;
  /** Loss rows, in emission order. Never a default (§10.2, PROP-L3, E2E-2). */
  readonly lossEventIds: readonly EventId[];
  /** Minted default rows, in role-index order, paired with their registered cause. */
  readonly defaults: readonly {
    readonly roleIndex: number;
    readonly payee: PrincipalId;
    readonly eventId: EventId;
    readonly attribution: DefaultAttribution;
  }[];
}

/**
 * Append one settlement's receipts and register every default's attribution.
 *
 * Appends and registers together, in one call, on purpose: an accusation in the record
 * with no row in the register is INV-17's forward failure and a row in the register
 * with no accusation is its backward failure, and the only way neither can happen is
 * for one function to do both.
 */
export function appendSettlementReceipts(args: {
  readonly events: EventLedger;
  readonly register: DefaultRegister;
  readonly settlement: VentureSettlement;
  readonly creator: PrincipalId;
  readonly ctx: ReceiptContext;
  /** The handle passed as `SettleInput.eventId` for this settlement. */
  readonly handle: EventId;
  /**
   * The event that destroyed value, as the resolution plan named it — the same value
   * passed as `SettleInput.causeEventId`.
   *
   * Passed in rather than recovered from `settlement.defaults`. The first version of this
   * module inferred it from the defaults, and a `CARGO_LOST` venture whose proceeds were
   * zero produced a recorded loss and **no** defaults at all — so the inference found
   * nothing and parented the loss row on the settlement, making the causal graph say the
   * Reckoning destroyed the cargo. The plan knows; the settlement's output does not.
   */
  readonly causeEventId: EventId | null;
  readonly reckoning: number;
}): SettlementReceipt {
  const { events, register, settlement, ctx } = args;
  const drafts = settlementEvents(settlement, args.creator, ctx);
  const external = externalCause(events, args.causeEventId, settlement.venture);

  const head = drafts[0];
  if (head === undefined) {
    throw new ReckoningHalt(
      `${settlement.venture} produced no receipt; every settled, deferred or defaulted obligation writes ` +
        'a row, or the record cannot be read',
    );
  }
  if (head.kind !== VENTURE_EVENT_KINDS.settled && head.kind !== VENTURE_EVENT_KINDS.deferred) {
    throw new ReckoningHalt(
      `${settlement.venture}'s first receipt is ${head.kind}, not ${VENTURE_EVENT_KINDS.settled} or ` +
        `${VENTURE_EVENT_KINDS.deferred}; a default appended before the settlement it came out of reads ` +
        'as an accusation with no context',
    );
  }

  // Step 1 — the settled row, and its minted id. Everything else hangs off this.
  const settledEventId = events.append(head).event.id;

  const lossEventIds: EventId[] = [];
  const defaultDrafts: NewEvent[] = [];
  for (const draft of drafts.slice(1)) {
    if (draft.kind === VENTURE_EVENT_KINDS.loss) {
      // A recorded loss descends from the event that destroyed the value when there is
      // one, and from the settlement otherwise — the deferral bound, where the engine
      // knows value is unpaid and knows it cannot say why. Parenting it on the settled
      // row in the first case would make the causal graph say the settlement did it.
      lossEventIds.push(
        events.append({ ...draft, parentEventId: external ?? settledEventId }).event.id,
      );
      continue;
    }
    if (draft.kind === VENTURE_EVENT_KINDS.defaulted) {
      defaultDrafts.push(draft);
      continue;
    }
    throw new ReckoningHalt(
      `${settlement.venture} emitted an unexpected receipt kind ${draft.kind}; this module resolves the ` +
        'attribution column for defaults and must be taught about any new kind before it appends one',
    );
  }

  // Steps 2–4 — the defaults, in role-index order, each with its cause as a column.
  const ordered = [...settlement.defaults].sort((a, b) => a.roleIndex - b.roleIndex);
  if (ordered.length !== defaultDrafts.length) {
    throw new ReckoningHalt(
      `${settlement.venture} reports ${ordered.length} default(s) and emitted ${defaultDrafts.length} ` +
        'default row(s); the attribution column can only be resolved if the two agree row for row',
    );
  }

  const defaults: SettlementReceipt['defaults'][number][] = [];
  for (const [i, d] of ordered.entries()) {
    const draft = defaultDrafts[i];
    if (draft === undefined) throw new ReckoningHalt('unreachable: default draft index out of range');
    const onRow = draft.payload['roleIndex'];
    if (onRow !== d.roleIndex) {
      // The zip is by position and the position is by role index on both sides. If it
      // ever disagrees, the attribution would be attached to the wrong role — which
      // means the wrong payee on a permanent public accusation.
      throw new ReckoningHalt(
        `${settlement.venture}: default row ${i} names role ${String(onRow)} but the settlement's ${i}th ` +
          `default is role ${d.roleIndex}; refusing to attribute an accusation to a role it is not about`,
      );
    }
    const resolved = resolveDefaultCause({ d, handle: args.handle, settledEventId, events });
    const eventId = events.append({ ...draft, parentEventId: resolved.causeEventId }).event.id;
    const attribution: DefaultAttribution = {
      defaultEventId: eventId,
      promisor: d.payer,
      obligation: d.venture,
      cause: resolved.cause,
      causeEventId: resolved.causeEventId,
      tick: ctx.tick,
      reckoningIndex: args.reckoning,
    };
    register.attribute(attribution);
    defaults.push({ roleIndex: d.roleIndex, payee: d.payee, eventId, attribution });
  }

  return {
    venture: settlement.venture,
    settledEventId,
    lossEventIds: Object.freeze(lossEventIds),
    defaults: Object.freeze(defaults),
  };
}

/**
 * The plan's `causeEventId`, checked against the record.
 *
 * A cause that is not a row in the ledger is an **engine-side** defect and halts: the
 * whole point of INV-17 is that the evidence for a permanent mark can be opened by an
 * auditor, and a cause id naming nothing is evidence nobody can open. `guardSettleable`
 * already refuses a loss outcome with no cause at all, so what is left here is a cause
 * that exists as a string and not as a fact.
 */
function externalCause(
  events: EventLedger,
  causeEventId: EventId | null,
  venture: VentureId,
): EventId | null {
  if (causeEventId === null) return null;
  if (events.get(causeEventId) === null) {
    throw new ReckoningHalt(
      `INV-17: ${venture} names ${causeEventId} as the event that destroyed its value, and that event is ` +
        'not in the record. A cause an auditor cannot open is not an attributable cause',
    );
  }
  return causeEventId;
}

/**
 * Turn a settlement's `causeEventId` into a ledger id and INV-17's cause kind.
 *
 * Exported so the mapping can be tested directly. The three branches are the whole of
 * this module's judgement, and the first one halts.
 */
export function resolveDefaultCause(args: {
  readonly d: VentureDefault;
  readonly handle: EventId;
  readonly settledEventId: EventId;
  readonly events: EventLedger;
}): { readonly causeEventId: EventId; readonly cause: DefaultCauseKind } {
  const { d, handle, settledEventId, events } = args;

  // The halt first, so it is reached whatever the election said: a cause that is neither
  // the handle nor a row in the record is evidence nobody can open, and the `DECLINED`
  // rule below must not become a way to swallow one.
  if (d.causeEventId !== handle && events.get(d.causeEventId) === null) {
    throw new ReckoningHalt(
      `INV-17: ${d.venture} role ${d.roleIndex} defaults citing ${d.causeEventId}, which is neither this ` +
        `settlement's handle (${handle}) nor a row in the record. A default with no attributable cause is ` +
        'the game accusing an innocent agent, so halt rather than publish an accusation whose evidence ' +
        'nobody can open',
    );
  }
  if (d.causeEventId === handle || d.cause === 'DECLINED') {
    // The settlement is the cause: the window elapsed and the elective part went
    // unpaid. `settledEventId` is the row that says so, and it is in the ledger by
    // construction because it was appended one step ago.
    //
    // `d.cause === 'DECLINED'` lands here even on a loss outcome, where the settlement
    // stamped the loss event onto every default it emitted. A payer that *refused* is
    // not excused by the raid that emptied the hold, and the raid is not the cause of a
    // choice — see the module header.
    return { causeEventId: settledEventId, cause: 'ELAPSED_WINDOW' };
  }
  return { causeEventId: d.causeEventId, cause: 'LOSS' };
}
