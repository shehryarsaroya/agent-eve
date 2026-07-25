/**
 * What an **open** slot is worth — `board[]`'s EV bands (SPEC §12.1).
 *
 * ## Why this function exists at all
 *
 * `venture/preview.ts:takeAtPercentile` answers "what does *this principal* take",
 * and it starts by looking up `roleOfPrincipal`. A slot on the board is by definition
 * held by nobody, so that lookup returns null and the preview declines to quote —
 * correctly, because a *take* is what a party takes and §3 will not let the word mean
 * two things.
 *
 * So the question here is a different one: *what would this slot pay whoever filled
 * it*. It is answered by the **same** three exported primitives the preview uses —
 * `computeProceeds`, `residualAtPercentile`, `computeClaims` — with the holder lookup
 * lifted. There is no second implementation of "what is a role owed" anywhere in this
 * file, which is the property §7.1 cares about: "there is one function that answers
 * 'what is this role owed', and both the quote and the payout read it."
 *
 * `test/observe/catalogue.test.ts` ("slotForecast agrees with the preview it lifts the
 * holder out of") pins that down the only way it can be pinned: for a role that *is*
 * held, this function and `takeAtPercentile` must agree exactly, at all three
 * percentiles and on both claim halves. A divergence means one of the two grew a rule
 * the other did not. *(This comment named a `forecast.test.ts` that does not exist — a
 * pointer to a file nobody wrote reads exactly like coverage.)*
 *
 * ## Quoted against a full fill, like the echo
 *
 * `preview.ts` gives three reasons and the third is the one that matters: quoting the
 * fullest version means a partially-filled venture cannot pay a share role *less*
 * than it was quoted while the engine still calls the quote met. A board slot is a
 * pre-signature quote, so it takes the same stance — and taking a different one would
 * mean the number on the board and the number at signing disagreed, which is the
 * `your_take_at_p50` failure with an extra step.
 */

import { minor, type Minor } from '../core/units.js';
import {
  NEUTRAL_STAGE_BPS,
  PERCENTILES,
  allRoleIndices,
  computeClaims,
  computeProceeds,
  residualAtPercentile,
  type Percentile,
  type VentureRecord,
} from '../venture/index.js';

/** One slot's band, and how it splits across A7's two halves at p50. */
export interface SlotForecast {
  readonly roleIndex: number;
  readonly p10: Minor;
  readonly p50: Minor;
  readonly p90: Minor;
  readonly escrowedAtP50: Minor;
  readonly electiveAtP50: Minor;
}

/** What one role is owed at one percentile, against a full fill. */
export function slotClaimAt(
  venture: VentureRecord,
  roleIndex: number,
  percentile: Percentile,
): { readonly claim: Minor; readonly escrowedDue: Minor; readonly electiveDue: Minor } {
  const filled = allRoleIndices(venture);
  const proceeds = computeProceeds({
    kind: venture.kind,
    filled,
    stageBps: NEUTRAL_STAGE_BPS,
    residualSignedBps: residualAtPercentile(venture.kind, percentile),
  }).proceeds;
  const claims = computeClaims(venture, proceeds, filled);
  const mine = claims.roles.find((r) => r.roleIndex === roleIndex);
  if (mine === undefined) {
    return { claim: minor(0), escrowedDue: minor(0), electiveDue: minor(0) };
  }
  return { claim: mine.claim, escrowedDue: mine.escrowedDue, electiveDue: mine.electiveDue };
}

export function slotForecast(venture: VentureRecord, roleIndex: number): SlotForecast {
  const at = (percentile: Percentile): ReturnType<typeof slotClaimAt> =>
    slotClaimAt(venture, roleIndex, percentile);
  const p50 = at('p50');
  return {
    roleIndex,
    p10: at('p10').claim,
    p50: p50.claim,
    p90: at('p90').claim,
    escrowedAtP50: p50.escrowedDue,
    electiveAtP50: p50.electiveDue,
  };
}

/** The three percentiles, re-exported so a caller need not import two modules. */
export const FORECAST_PERCENTILES = PERCENTILES;
