/**
 * `claim` and `deny` — the say half of the say-do gap, as a function of its inputs.
 *
 * Fourth extraction under `D21`'s coupling order, and the narrowest in the file: one runtime member.
 *
 * ── ONE FUNCTION FOR TWO VERBS, WHICH IS THE POINT ───────────────────────────
 *
 * `claim` and `deny` differ by a single boolean and are otherwise the same act: a short public
 * statement, permanently attributed. §11's say-do gap works by putting an agent's words beside its
 * deeds, and that comparison is only fair if a denial is recorded on exactly the same terms as a
 * claim — same length limit, same permanence, same attribution. Two implementations could drift into
 * treating a denial as cheaper, and a cheap denial is a free way out of a broken promise.
 *
 * The length cap is INV-26 (bounded buffers) rather than a style rule: claims accumulate in a public
 * list nobody prunes, so an unbounded one is a memory exhaustion an agent can trigger for free.
 */

import { readString } from '../core/params.js';
import type { PrincipalId } from '../core/types.js';
import { reject, type WorldResult } from '../world/result.js';

/** One public statement, as the claim book stores it. */
export interface ClaimEntry {
  readonly by: PrincipalId;
  readonly text: string;
  readonly denial: boolean;
  readonly tick: number;
}

export interface SayPort {
  readonly record: (entry: ClaimEntry) => void;
  readonly maxLength: number;
}

export function say(
  port: SayPort,
  principal: PrincipalId,
  params: Readonly<Record<string, unknown>>,
  tick: number,
  denial: boolean,
): WorldResult<null> {
  const text = readString(params, ['text', 'reason', 'claim']);
  if (text === null || text.length > port.maxLength) {
    return reject(
      'INV-26',
      `${denial ? 'deny' : 'claim'} carries at most ${String(port.maxLength)} characters. It is public ` +
        'and permanent, and it is how anyone watching knows who you are.',
    );
  }
  port.record({ by: principal, text, denial, tick });
  return { ok: true, value: null };
}
