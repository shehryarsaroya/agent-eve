/**
 * `nearest_legal` — **the same act, re-priced, or nothing** (PROP-O7, `agent.md` §13).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ★ **ONE HOME FOR THE RULE, BECAUSE IT HAD TWO AND THEY DISAGREED.**
 *
 * `server.ts` matched the refused verb and otherwise fell back to `affordances[0]`; the observe path
 * (`api/observe.ts`, a correction delivered into a wake) matched the verb alone. So a refused
 * `create {"kind":"HAUL"}` came back as `create {"kind":"DIG"}` while HAUL rows sat on the same menu,
 * and a refused `join` came back as `create DIG` — a blind player called it *"neither near nor
 * legal"*. `agent.md` §13 says the field is *"never a substitute suggestion"*, and a field an agent
 * is told to copy that carries a different act is worse than an absent one.
 *
 * So the match is the VERB and, for every identifying parameter the refused act carried, the SAME
 * VALUE — its kind (`kind`, `obligation`, `act`, `side`, `good`, `rule` …) and its target (`venture`,
 * `raid`, `claim`, `grant`, `to`, `payer`, `stage`, `system` …). A row that differs only in HOW —
 * which hand, how much, what stake, which role of the same venture — is the nearest legal version of
 * the act that was sent, and it is returned. Anything else is `null`, and the prose `hint` still names
 * the invariant and the fix.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Pure, and it reads only the list it is handed: what that list may be is the caller's A4 question
 * (`server.ts` hands it the set the agent already holds this tick and nothing fresher).
 */

import type { Affordance } from './observe.js';

/**
 * The params that say WHAT an act is and WHAT it is aimed at. A refused act that carried one of these
 * is only matched by a row carrying the same value.
 *
 * Deliberately absent: `hand`, `amount`, `qty`, `stake`, `role`, `election`, `text`, `terms_hash`,
 * `elective_bps`, `until_tick` and the seal's own `verb`/`measure`/band — the parameters a correction
 * most often changes, which is the point of offering the corrected row.
 */
export const IDENTIFYING_PARAMS: readonly string[] = Object.freeze([
  // what the act is
  'kind',
  'obligation',
  'act',
  'side',
  'operation',
  'good',
  'ballot',
  'rule',
  'intent_verb',
  'template',
  'grand',
  'on_behalf_of',
  // what it is aimed at
  'venture',
  'target',
  'raid',
  'campaign',
  'claim',
  'cede',
  'grant',
  'syndicate',
  'principal',
  'payer',
  'to',
  'dossier',
  'stage',
  'system',
  'target_system',
  'venue',
  'at',
  'stop',
  'cover',
]);

/**
 * The two whose ABSENCE is a value: no `payer` means your own bill and no `on_behalf_of` means your
 * own name. A refused act without one is only matched by a row without one — paying your own Levy is
 * not near carrying a neighbour's, and acting for yourself is not near acting for your grantor.
 */
const ABSENT_MEANS_SELF: readonly string[] = Object.freeze(['payer', 'on_behalf_of']);

function scalar(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : null;
}

/**
 * The first row of `affordances` that is the act `refused` named, or `null`.
 *
 * First rather than "best": the list is already priority-ordered by the solver, and a second ranking
 * here would be a second opinion about the same menu.
 */
export function nearestLegal(
  affordances: readonly Affordance[],
  refused: { readonly verb: string; readonly params?: Readonly<Record<string, unknown>> },
): Affordance | null {
  const sent = (key: string): string | null => scalar(refused.params?.[key]);
  return (
    affordances.find((a) => {
      if (a.verb !== refused.verb) return false;
      const row = a.params;
      return IDENTIFYING_PARAMS.every((key) => {
        const value = sent(key);
        if (value !== null) return scalar(row[key]) === value;
        return !ABSENT_MEANS_SELF.includes(key) || scalar(row[key]) === null;
      });
    }) ?? null
  );
}
