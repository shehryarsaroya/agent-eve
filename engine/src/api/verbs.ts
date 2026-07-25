/**
 * The verb surface, and the honest gap in it.
 *
 * `agent.md` §7 lists thirty-eight verbs and an agent reads that list as a promise
 * that all thirty-eight do something. Phase 0 does not implement thirty-eight
 * mechanics, and there are exactly two ways to handle that:
 *
 *   1. Let the unbuilt ones fall through to the tick loop's `unknownVerb`, which
 *      tells the agent *"there is no such verb"* — a sentence that contradicts the
 *      document the agent learned the game from. **That is scar #1's exact shape:**
 *      the engine and the agent-facing text disagreeing about one word, with every
 *      component individually correct.
 *   2. Name the gap. A verb in the canon whose mechanic has not landed gets a
 *      correction that says so, costs no action, and points at what *is* live.
 *
 * This file is (2). {@link CANON_VERBS} is the SPEC §12.2 list, asserted against
 * the document itself by `test/api/verbs.test.ts` so the two cannot drift.
 * {@link liveVerbs} is what the runtime actually registered. The difference is
 * reported to the agent in its own words, and it is reported upward as an
 * `agent.md` mismatch rather than quietly papered over.
 *
 * **Costing nothing is the load-bearing part.** The tick loop charges the action
 * budget *before* it runs a handler, and it is right to — an act that reached the
 * rules and lost consumed a decision. But a verb whose mechanic does not exist
 * never reaches the rules, so charging for it would mean an agent playing exactly
 * as `agent.md` told it to could spend its whole budget on nothing. So these are
 * refused at the HTTP boundary, before submission, where nothing has been charged.
 */

/**
 * SPEC §12.2, in the spec's own grouping and spelling.
 *
 * Hard-coded rather than parsed at runtime: production must not depend on a
 * markdown file being on disk. `test/api/verbs.test.ts` parses §12.2 and asserts
 * set equality, which puts the drift check in CI where it belongs.
 */
export const CANON_VERBS: readonly string[] = Object.freeze([
  // identity
  'attest',
  'verify_owner',
  'post_bond',
  'offer_surety',
  'seal',
  // world
  'move',
  'scan',
  'extract',
  'refine',
  'build',
  'haul',
  // venture
  'create',
  'publish_offer',
  'message',
  'fill_role',
  'sign',
  'withdraw',
  'abandon',
  // office
  'apply',
  'admit',
  'grant',
  'approve',
  'revoke',
  'audit',
  // market
  'trade',
  // raid
  'demand',
  'yield',
  'flee',
  'fight',
  'join',
  // levy
  'deliver',
  'set_delivery_intent',
  // say
  'claim',
  'deny',
  // ballot
  'vote',
  // org
  'form',
  'charter',
  'propose',
]);

const CANON = new Set(CANON_VERBS);

export function isCanonVerb(verb: string): boolean {
  return CANON.has(verb);
}

/**
 * Which build step each unbuilt verb is waiting on, from SPEC §16's numbered
 * order. The agent is told the step, not an apology: a step number is checkable
 * against a public plan and "coming soon" is not.
 */
export const VERB_ARRIVES_AT: Readonly<Record<string, string>> = Object.freeze({
  /**
   * `seal` is written, tested and deliberately not live.
   *
   * INV-20 requires every seal to be resolved exactly once when its Reckoning closes,
   * and seal resolution needs the deeds to judge against — which belongs to the
   * Reckoning driver. Offering `seal` before that exists means the first settlement
   * tick after any agent seals HALTS the world, which is a denial of settlement any
   * agent could trigger with one free action (AGT-X9). See the note in
   * `src/sim/runtime.ts`.
   */
  seal: 'step 14 (seals and the rundown)',
  attest: 'step 9 (grants and offline semantics)',
  verify_owner: 'step 9 (grants and offline semantics)',
  post_bond: 'step 9 (grants and offline semantics)',
  offer_surety: 'step 9 (grants and offline semantics)',
  scan: 'step 12 (predation and the sensed layer)',
  extract: 'step 11 (markets and the production graph)',
  refine: 'step 11 (markets and the production graph)',
  build: 'step 11 (markets and the production graph)',
  haul: 'step 11 (markets and the production graph)',
  apply: 'step 9 (offices and grants)',
  admit: 'step 9 (offices and grants)',
  grant: 'step 9 (offices and grants)',
  approve: 'step 9 (offices and grants)',
  revoke: 'step 9 (offices and grants)',
  audit: 'step 9 (offices and grants)',
  trade: 'step 11 (markets)',
  demand: 'step 12 (predation)',
  yield: 'step 12 (predation)',
  flee: 'step 12 (predation)',
  fight: 'step 12 (predation)',
  join: 'step 12 (predation)',
  deliver: 'step 10 (the Levy)',
  vote: 'step 10 (the Levy ballot)',
  form: 'step 9 (syndicates)',
  charter: 'step 9 (syndicates)',
  propose: 'step 9 (syndicates)',
});

/**
 * The free read-only services `agent.md` §6 names — and they are **not verbs**.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `agent.md` §6 lists `plan_hands · quote_venture · reference_split · stress_grant ·
 * dry_run · mandate` under *"Free things that do not cost an action"*, and §12's very
 * first piece of advice is **"Call `plan_hands` before every allocation decision."**
 *
 * None of them has an endpoint in this build. That is a gap and it is reported as one.
 * What is *not* acceptable is the sentence the agent used to get for them: since they
 * are not in {@link CANON_VERBS}, `classifyVerb` answered **"'plan_hands' is not a verb
 * in this game. The full list is in agent.md §7."** — the server flatly denying the
 * existence of the thing the document tells the agent to call first, and citing that
 * same document as its authority.
 *
 * That is scar #1's exact shape: the engine and the agent-facing text disagreeing about
 * one word, with each component correct on its own. The gap costs the agent an
 * unanswered question; the sentence costs it its trust in the document, which is the
 * only thing it has.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const FREE_SERVICES: readonly string[] = Object.freeze([
  'plan_hands',
  'quote_venture',
  'reference_split',
  'stress_grant',
  'dry_run',
  'mandate',
]);

const SERVICES = new Set(FREE_SERVICES);

export interface VerbVerdict {
  /** True when the runtime has a handler for it. */
  readonly live: boolean;
  /** True when SPEC §12.2 names it at all. */
  readonly canon: boolean;
  readonly invariant: string;
  readonly hint: string;
}

/**
 * Classify a verb before it is submitted.
 *
 * The two refusals are deliberately different sentences, because they are
 * different mistakes and an agent can only correct the one it is told about:
 * a canon verb that is not live is *our* gap, and a non-canon verb is a typo.
 */
export function classifyVerb(verb: string, live: ReadonlySet<string>): VerbVerdict {
  if (live.has(verb)) {
    return { live: true, canon: CANON.has(verb), invariant: '', hint: '' };
  }
  if (SERVICES.has(verb)) {
    // Named as what it is, so the agent stops asking and knows why. Never "no such
    // verb": agent.md §6 says this exists, and agent.md is the rules.
    return {
      live: false,
      canon: false,
      invariant: 'PHASE-0',
      hint:
        `'${verb}' is one of the free read-only services agent.md §6 names, not an action verb, so it is ` +
        'not something `act` can carry. It has no endpoint in this build yet — it lands with the free-service ' +
        'layer at SPEC §16 step 8. Nothing was charged. Everything you need to decide without it is already ' +
        'in the observation: every affordance carries its exact cost, max_direct_loss and ' +
        'max_contingent_liability, and briefing.if_you_do_nothing is the consequence of not acting.',
    };
  }
  if (CANON.has(verb)) {
    const step = VERB_ARRIVES_AT[verb] ?? 'a later Phase 0 step';
    return {
      live: false,
      canon: true,
      invariant: 'PHASE-0',
      hint:
        `'${verb}' is in the rules and is not live yet — its mechanic lands at ${step}. ` +
        `Nothing was charged for this. What is live right now: ${[...live].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(' · ')}.`,
    };
  }
  return {
    live: false,
    canon: false,
    invariant: 'A2',
    hint:
      `'${verb}' is not a verb in this game. The full list is in agent.md §7. ` +
      `Live right now: ${[...live].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(' · ')}.`,
  };
}

/** Canon verbs with no handler, in canonical order. The gap, as a list. */
export function unbuiltVerbs(live: ReadonlySet<string>): readonly string[] {
  return CANON_VERBS.filter((v) => !live.has(v));
}
