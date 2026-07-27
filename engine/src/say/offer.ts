/**
 * `publish_offer` — the standing price list, as a function of its inputs.
 *
 * Fifth extraction under `D21`'s coupling order. Sits beside `say.ts` because it is the same kind of
 * act: a short, public, permanently attributed statement. The difference is what it is FOR — a claim
 * says who you are, an offer says what you will do and for how much.
 *
 * ── THE CESSION BRANCH STAYS IN THE RUNTIME, DELIBERATELY ────────────────────
 *
 * `publish_offer` has two shapes. Naming a claim (`cede`) publishes an offer with a subject the engine
 * can actually transfer, which needs the sovereignty book, a price and a system. Everything else is
 * prose. Only the prose half moves here: the adapter dispatches the cession before calling this, so
 * the port stays one member wide instead of dragging sovereignty in behind it.
 *
 * A wider port would compile and would defeat the purpose — the value of these extractions is that the
 * signature ENUMERATES what the operation can reach.
 *
 * The length cap is INV-26 (bounded buffers), not style: offers accumulate in a public list nobody
 * prunes. `agent.md`'s own example is the right register — *"HANDS FOR HIRE — 8% OF CARGO, NO DEEP
 * RUNS"* — a price list, not an essay.
 */

import { readString } from '../core/params.js';
import type { PrincipalId } from '../core/types.js';
import { reject, type WorldResult } from '../world/result.js';

/** One published offer, as the offer book stores it. */
export interface OfferEntry {
  readonly by: PrincipalId;
  readonly text: string;
  readonly tick: number;
}

export interface OfferPort {
  readonly record: (entry: OfferEntry) => void;
  readonly maxLength: number;
}

export function publishOffer(
  port: OfferPort,
  principal: PrincipalId,
  params: Readonly<Record<string, unknown>>,
  tick: number,
): WorldResult<null> {
  const text = readString(params, ['text', 'offer', 'reason']);
  if (text === null || text.length > port.maxLength) {
    return reject(
      'INV-26',
      `publish_offer needs {"text": "..."} of at most ${String(port.maxLength)} characters — a price ` +
        'list, not an essay: HANDS FOR HIRE — 8% OF CARGO, NO DEEP RUNS.',
    );
  }
  port.record({ by: principal, text, tick });
  return { ok: true, value: null };
}
