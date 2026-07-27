/**
 * `sign` — countersigning a venture's terms, as a function of its inputs.
 *
 * Extracted from `sim/runtime.ts` following `D21`'s coupling order: this handler reached exactly ONE
 * runtime member (`this.ventures`), which is the narrowest port in the file and therefore the safest
 * thing to move after `refine` established the pattern.
 *
 * It is also **moving logic home rather than inventing a home for it**. `countersign` and
 * `yourTakeAtP50` were already in `venture/`; only the ten lines that read the params and dispatch to
 * them were living in a 9,745-line class three modules away.
 */

import { readInt, readString } from '../core/params.js';
import type { VentureId } from '../core/types.js';
import { minor } from '../core/units.js';
import type { PrincipalId } from '../core/types.js';
import { reject, type Rejection, type WorldResult } from '../world/result.js';
import { countersign, type VentureRecord } from './venture.js';
import { yourTakeAtP50 } from './preview.js';

/** The one thing `sign` reads from the world. */
export interface SignPort {
  readonly ventureOf: (id: VentureId) => VentureRecord | undefined;
}

/**
 * The election used to ride on `sign` and now has its own verb, so a `sign` carrying one is refused
 * WHOLE rather than signed with the election silently dropped.
 *
 * That choice is the load-bearing one: *"a payer that believes it elected and did not is a payer the
 * record will call a defaulter"* — A5′ reached through a convenience.
 */
export function electionOnSign(params: Readonly<Record<string, unknown>>): Rejection | null {
  if (params['election'] === undefined && params['elect'] === undefined) return null;
  return reject(
    'PROP-V4',
    'the election does not ride on sign any more — it has its own verb. `sign` binds the terms; `elect` ' +
      'decides the payment, one role at a time, and you may restate it every tick until the freeze. Send ' +
      'sign without the election, then {"verb": "elect", "params": {"venture": "<id>", "role": N, ' +
      '"election": "IN_FULL"}}. Nothing was signed and nothing was elected: this is refused whole rather ' +
      'than signed with the election dropped, because a payer that believes it elected and did not is a ' +
      'payer the record will call a defaulter.',
  );
}

/** Countersign a venture's terms. Signing twice is an accept, not a refusal — the signature is idempotent. */
export function sign(port: SignPort, principal: PrincipalId, params: Readonly<Record<string, unknown>>): WorldResult<null> {
  const ventureId = readString(params, ['venture', 'venture_id']) as VentureId | null;
  const hash = readString(params, ['terms_hash', 'termsHash']);
  if (ventureId === null || hash === null) {
    return reject(
      'PROP-W1',
      'sign needs {"venture": "<id>", "terms_hash": "<hash>"}. Nothing binds until both parties ' +
        'countersign the same terms_hash.',
    );
  }
  const venture = port.ventureOf(ventureId);
  if (venture === undefined) return reject('PROP-V6', `there is no venture ${ventureId}.`);

  const misplaced = electionOnSign(params);
  if (misplaced !== null) return misplaced;

  if (!venture.countersigned.has(principal)) {
    const echoed = readInt(params, ['your_take_at_p50', 'take_at_p50']);
    const server = yourTakeAtP50(venture, principal);
    const signed = countersign(venture, principal, hash, minor(echoed ?? server), server);
    if (!signed.ok) return signed;
  }
  return { ok: true, value: null };
}
