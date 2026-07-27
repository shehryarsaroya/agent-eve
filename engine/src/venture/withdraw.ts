/**
 * `withdraw` — leaving a venture before it binds, as a function of its inputs.
 *
 * Third extraction under `D21`'s coupling order (2 runtime members: the venture book and the hand it
 * releases).
 *
 * ── THE RULE THIS VERB EXISTS TO STATE ───────────────────────────────────────
 *
 * You may leave while a venture is **FORMING** and not after. Once it is LIVE the way out is to decline
 * the elective half at settlement — **and that is a default on the record.** A7 is the reason: the
 * escrowed part auto-executes and the elective part stays a promise, so an exit that cost nothing after
 * binding would make every promise free to break quietly and delete the only thing the game measures.
 *
 * The refusal says both halves, because "you may not withdraw" without "here is the exit that does
 * exist, and here is what it costs you" is a dead end an agent pays for every wake (A2).
 */

import { readString } from '../core/params.js';
import type { HandId, PrincipalId, VentureId } from '../core/types.js';
import { reject, type WorldResult } from '../world/result.js';
import { roleOfPrincipal, vacateRole, type VentureRecord } from './venture.js';

/** What `withdraw` touches: the venture, and the hand it hands back. */
export interface WithdrawPort {
  readonly ventureOf: (id: VentureId) => VentureRecord | undefined;
  /** Drop the venture book's index entry for a freed hand. */
  readonly releaseIndex: (hand: HandId) => void;
  /** Return a committed hand to IDLE. A no-op if it is in any other state. */
  readonly freeHand: (hand: HandId) => void;
}

export function withdraw(
  port: WithdrawPort,
  principal: PrincipalId,
  params: Readonly<Record<string, unknown>>,
): WorldResult<null> {
  const ventureId = readString(params, ['venture', 'venture_id']) as VentureId | null;
  if (ventureId === null) return reject('A2', 'withdraw needs {"venture": "<id>"}.');
  const venture = port.ventureOf(ventureId);
  if (venture === undefined) return reject('PROP-V6', `there is no venture ${ventureId}.`);
  if (venture.state !== 'FORMING') {
    return reject(
      'PROP-V6',
      `${ventureId} is ${venture.state}. You may withdraw from a venture while it is FORMING; once it is ` +
        'LIVE the way out is to decline the elective part at settlement, and that is a default on the record.',
    );
  }
  const role = roleOfPrincipal(venture, principal);
  if (role === null) return reject('PROP-V6', `you hold no role in ${ventureId}.`);
  const freed = vacateRole(venture, role.index);
  if (freed !== null) {
    port.releaseIndex(freed);
    port.freeHand(freed);
  }
  return { ok: true, value: null };
}
