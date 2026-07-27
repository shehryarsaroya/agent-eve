/**
 * `abandon` — giving up a FORMING venture, as a function of its inputs.
 *
 * Sixth extraction under `D21`'s coupling order. Sits beside `withdraw.ts` because the two are the
 * same decision seen from opposite ends of the deal: a filler `withdraw`s from someone else's venture,
 * a creator `abandon`s its own. Both are legal only while FORMING, and for one reason — once a venture
 * is LIVE the only exit is declining the elective half at settlement, which is a default on the record
 * (A7). An exit that cost nothing after binding would make every promise free to break quietly.
 *
 * ── THE CLAIM BRANCH STAYS IN THE RUNTIME ────────────────────────────────────
 *
 * `abandon` takes two kinds of object: a venture, or a sovereignty claim (which salvages part of its
 * bond). Only the venture half moves here — the adapter dispatches the claim first — so the port stays
 * narrow instead of dragging sovereignty and the bond book in behind it. Same call as `publish_offer`'s
 * cession branch, for the same reason.
 */

import { readString } from '../core/params.js';
import type { HandId, PrincipalId, VentureId } from '../core/types.js';
import { reject, type WorldResult } from '../world/result.js';
import type { VentureRecord } from './venture.js';

export interface AbandonPort {
  readonly ventureOf: (id: VentureId) => VentureRecord | undefined;
  /** Resolve the venture ABANDONED and return the hands it releases. */
  readonly resolveAbandoned: (id: VentureId) => readonly HandId[];
  /** Return a committed hand to IDLE. A no-op in any other state. */
  readonly freeHand: (hand: HandId) => void;
  /** Give the escrow back to whoever funded it. Never throws, never halts. */
  readonly refundEscrow: (venture: VentureRecord) => void;
}

export function abandon(
  port: AbandonPort,
  principal: PrincipalId,
  params: Readonly<Record<string, unknown>>,
): WorldResult<null> {
  const ventureId = readString(params, ['venture', 'venture_id']) as VentureId | null;
  if (ventureId === null) {
    return reject(
      'A2',
      'abandon needs {"venture": "<id>"} to give up a FORMING venture, or {"claim": "<system_id>"} to give up ' +
        'a claim and salvage part of its bond.',
    );
  }
  const venture = port.ventureOf(ventureId);
  if (venture === undefined) return reject('PROP-V6', `there is no venture ${ventureId}.`);
  if (venture.creator !== principal) {
    return reject('PROP-V6', `only ${venture.creator} can abandon ${ventureId}.`);
  }
  if (venture.state !== 'FORMING') {
    return reject('PROP-V6', `${ventureId} is ${venture.state}; only a FORMING venture can be abandoned.`);
  }
  for (const hand of port.resolveAbandoned(ventureId)) port.freeHand(hand);
  port.refundEscrow(venture);
  return { ok: true, value: null };
}
