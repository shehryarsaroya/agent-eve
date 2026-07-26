/**
 * `publicFacts` — the one boundary the nightly frame is allowed to cross.
 *
 * ## Why this file exists
 *
 * A9 says the spectator client never shows a live fact an agent's own `observe` would
 * not. For the **event feed** that is enforced architecturally and fuzzed: `agentView`
 * is built by calling `spectatorView` first, and `test/events/parity.test.ts` proves
 * anything a viewer may read, *every* agent may read, at the same redaction.
 *
 * The **frame** did not go through any of that. `reckoningFrame()` read
 * `world.holdings`, the venture book and the grant book directly, so A9 held on that
 * path by good behaviour rather than by construction. Everything it read was in fact
 * tier-legal — but nothing stopped the next field from being sensed cargo or a hidden
 * stockpile, and that is not a hypothetical: the Charge "fuel gauge" proposed in the
 * expansion draft was exactly that mistake, a frame field derived from a public recipe
 * and a **private** stockpile, and it took an outside critic to notice.
 *
 * So the frame now reads a `PublicFacts` value, and this file is where a new field has
 * to argue for itself against §11.2 before it can reach a screen.
 *
 * ## What makes this a boundary rather than a rename
 *
 * {@link assertInertPublicFacts} canonicalises the projection. `canonicalize` refuses
 * functions, symbols, class instances and cycles, so a projection that still holds a
 * handle to the runtime — a getter, a bound method, a live book — **throws** rather
 * than rendering. That is the structural half: you cannot accidentally pass live state
 * through a value that is required to serialise.
 *
 * The tier half is the field list below. Each entry names the §11.2 tier that admits
 * it, and the assertion checks the value carries no key outside that list.
 */

import { canonicalize, type CanonicalValue } from '../core/canonical.js';
import type { FrameSource } from './render.js';

/**
 * The fields a nightly frame may be built from, each with the §11.2 clause that admits
 * it. This list is the rules surface; the type is just its shape.
 *
 * | field | tier | §11.2 clause |
 * |---|---|---|
 * | `reckoning`, `tick`, `stateHash` | `PUBLIC` | the clock and the published hash |
 * | `settled` | `PUBLIC` | "settled ventures, defaults and cures" |
 * | `meters` | `PUBLIC` | derived from settled ventures and the Levy's public result |
 * | `handles` | `PUBLIC` | "holdings" — a holding is rendered with its name on it |
 * | `ticker` | `PUBLIC` | published lines, already 140-char bounded |
 * | `tomorrow` | `PUBLIC` | the docket of ventures whose terms are already public |
 * | `tributeLines` | `PUBLIC` | "the Levy vote and its result, tribute lines" |
 * | `authorityLines` | `PUBLIC` | a grant's LIMITS, parties and renewal chain (D9a) |
 * | `modelBadges` | `PUBLIC` | which model runs a cast seat; not a game fact |
 *
 * **Not admissible, and the reason each was considered:** cargo contents and hold values
 * (`SENSED` — "a ship at sea is visible; its manifest is not"); exact hand disposition
 * off public lanes (`SENSED`); seal *content* (`SEALED`, and it releases in the season
 * replay, not on the night); negotiation messages before settlement (`PARTIES`); a
 * grant's verbs, selectors, approvals and delegation depth (`PARTIES`, D9a); anything
 * derived from a private stockpile, however public the formula.
 */
export const PUBLIC_FACT_KEYS: readonly (keyof FrameSource)[] = Object.freeze([
  'reckoning',
  'tick',
  'stateHash',
  'settled',
  'meters',
  'handles',
  'modelBadges',
  'ticker',
  'tomorrow',
  'tributeLines',
  'authorityLines',
]);

export class ProjectionError extends Error {}

/**
 * Prove the projection is inert data carrying only admissible keys.
 *
 * Called on the way into the renderer, so the failure is a refused frame rather than a
 * published one. Both halves matter and they fail differently:
 *
 *   - an **unknown key** means somebody added a field without arguing it against §11.2;
 *   - a **canonicalisation failure** means the projection is still holding live state,
 *     which is the leak this file exists to make impossible.
 */
export function assertInertPublicFacts(facts: FrameSource): void {
  const allowed = new Set<string>(PUBLIC_FACT_KEYS as readonly string[]);
  const extra = Object.keys(facts).filter((k) => !allowed.has(k));
  if (extra.length > 0) {
    throw new ProjectionError(
      `frame projection carries ${extra.join(', ')}, which no §11.2 clause admits. ` +
        'Add it to PUBLIC_FACT_KEYS with the tier that permits it, or keep it out of the frame.',
    );
  }

  // `handles` and `modelBadges` are Maps, which are legitimately not canonical values;
  // everything else must serialise. A Map of primitives is inert, so it is unwrapped
  // rather than rejected — but its CONTENTS still have to be plain.
  const inert: Record<string, unknown> = {};
  for (const key of Object.keys(facts)) {
    const value = (facts as unknown as Record<string, unknown>)[key];
    inert[key] = value instanceof Map ? [...value.entries()] : value;
  }
  try {
    canonicalize(inert as CanonicalValue);
  } catch (error: unknown) {
    throw new ProjectionError(
      'frame projection is not inert data — it is still holding a handle to live state ' +
        `(${error instanceof Error ? error.message : String(error)}). The frame must be ` +
        'built from a value, so that what a viewer sees cannot depend on what the world ' +
        'happens to contain when the renderer runs.',
    );
  }
}
