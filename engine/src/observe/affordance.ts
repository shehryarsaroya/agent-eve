/**
 * The affordance — the honesty guarantee, as a shape (SPEC §12.1, PROP-O4).
 *
 * > "Every affordance carries `cost`, `max_direct_loss`,
 * > `max_contingent_liability`, `what_it_forecloses`, `expires_tick`, `quote_id`.
 * > Missing any is a hard failure — the shown-worst-case is the core loop's
 * > honesty guarantee." — TESTING.md, PROP-O4
 *
 * `agent.md` §12 tells players to rely on it in as many words: *"Check
 * `max_direct_loss` on every affordance before acting. **It is exact, not an
 * estimate.**"* That sentence is the reason `max_direct_loss` is computed from
 * pinned terms and the world's own tables and never from a model, a heuristic or a
 * band — and the reason {@link affordanceFaults} treats a missing field as a
 * failure rather than a default.
 *
 * ## The field names are snake_case because the promise is
 *
 * §12.1 and `agent.md` §6 both spell these `max_direct_loss`,
 * `what_it_forecloses`, `expires_tick`, `quote_id`. `header.serverNow` is
 * camelCase in both. The mixture is not tidy and it is not ours to tidy: the
 * agent-facing text is a rules surface (scar #1), so the wire matches the document
 * exactly, character for character, and a rename is a documentation change first.
 *
 * ## Why the verb list is duplicated from `world/commons.ts` — and how that is safe
 *
 * `VERB_CLASS` there classifies every verb as peaceful or hostile; {@link VERBS}
 * here is the ordered list an affordance's `verb` must come from. Two lists of the
 * same 39 words is exactly the drift scar #1 is made of, so
 * `test/observe/shape.test.ts` asserts the two sets are **equal** — not that one
 * contains the other. A verb added to §12.2 and classified but not listed here
 * fails that test, and so does the reverse.
 */

import type { CanonicalScalar } from '../core/types.js';
import type { Minor } from '../core/units.js';
import { compareIds } from '../ledger/index.js';
import { costOf } from '../tick/index.js';
import { MAX_FORECLOSE_ENTRIES, MAX_PHRASE_CHARS } from './tokens.js';

/**
 * SPEC §12.2's verbs, in the spec's own group order. **All 40 of the §17 budget's 40** —
 * `graduate` spent the last slot, because a live playtest found no principal could ever
 * leave the Commons and A8's floor had therefore become the entire world.
 *
 * Grouped and commented so a reader can diff this against §12.2 by eye; the
 * mechanical diff is in the test.
 */
export const VERBS = Object.freeze([
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
  'graduate',
  // venture
  'create',
  'publish_offer',
  'message',
  'fill_role',
  'sign',
  'elect',
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
  'engage',
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
] as const);

export type Verb = (typeof VERBS)[number];

/** Ordering position, so an affordance list renders the same way twice (DET-1). */
export function verbOrder(verb: Verb): number {
  const index = VERBS.indexOf(verb);
  if (index < 0) throw new Error(`unreachable: ${verb} is not in VERBS`);
  return index;
}

export function isVerb(candidate: string): candidate is Verb {
  return (VERBS as readonly string[]).includes(candidate);
}

/**
 * Params are canonical scalars only — no nesting.
 *
 * Flat on purpose: params go into `terms_hash` inputs and into a `quote_id`, and a
 * nested structure invites two serialisations of the same logical parameters,
 * which is the `terms_hash` mismatch agents correctly read as a counterparty
 * reneging (PROP-W1).
 */
export type AffordanceParams = Readonly<Record<string, CanonicalScalar>>;

/**
 * One thing an agent can legally do right now, with its full price.
 *
 * The six mandatory fields after `verb`/`params` are PROP-O4's list. There is no
 * optional field in this interface, and that is the design: an affordance whose
 * worst case we could not compute is an affordance we may not publish, so the
 * generator omits it and counts it withheld rather than shipping a `null` an agent
 * would read as "nothing at risk".
 */
export interface Affordance {
  readonly verb: Verb;
  readonly params: AffordanceParams;
  /** Material actions this consumes. `0` for §12.2's free verbs (A3, §17). */
  readonly cost: number;
  /**
   * **The most you can lose.** Exact, from pinned terms and the world's tables.
   *
   * Bounds destruction, not just transfers (PROP-G1) — a delegate that marches
   * your hands into a raid has spent your `max_direct_loss` even though nothing was
   * transferred anywhere.
   */
  readonly max_direct_loss: Minor;
  /** The most you could owe later — Σ of the elective parts you would become payer of. */
  readonly max_contingent_liability: Minor;
  /** What doing this stops you doing. Bounded phrases, so the payload's size is computable. */
  readonly what_it_forecloses: readonly string[];
  /** Inclusive: an action at exactly this tick is still inside the option. */
  readonly expires_tick: number;
  /** §12.3's pin. Reserves nothing. */
  readonly quote_id: string;
}

/** The six fields PROP-O4 names, plus the two that identify the act. */
export const AFFORDANCE_KEYS: readonly string[] = Object.freeze([
  'verb',
  'params',
  'cost',
  'max_direct_loss',
  'max_contingent_liability',
  'what_it_forecloses',
  'expires_tick',
  'quote_id',
]);

/**
 * What an action costs against the per-tick material budget, **including the one
 * allowance the budget module deliberately does not know about.**
 *
 * `src/tick/budget.ts` owns the free set and says why `seal` is not in it: "§17
 * gives seals their own allowance — 'one free per role held' — which is the seals
 * module's ledger, not this one. Putting `seal` here would give one quantity two
 * homes (scar #5)." That reasoning is right, and it leaves a gap: `agent.md` §8
 * promises *"One seal per role you hold is free and costs no action"*, and nothing
 * on the charge path currently applies that allowance.
 *
 * This module publishes the promise, because the promise is the rules surface
 * (scar #1) — so a mandatory first seal quotes `cost: 0`. The exception is narrow
 * by construction: `usesFreeAllowance` is only ever true for `seal`, and
 * {@link affordanceFaults} asserts that. The charge-side half of the gap is
 * reported rather than papered over.
 */
export function actionCostOf(verb: Verb, usesFreeAllowance = false): number {
  if (costOf(verb) === 'FREE') return 0;
  if (usesFreeAllowance && verb === 'seal') return 0;
  return 1;
}

/**
 * A candidate before eligibility ran — what the generators produce.
 *
 * `mandatory` is the one flag the narrowing ladder may never override: a seal on a
 * role held before the freeze (§11.1: "sealing is mandatory"), a Levy assessment
 * (§5.2: "the total cannot be dodged"), a countersignature a venture is waiting
 * on, an open ballot. R1's *"3–6 live options **+ mandatory**"* is this flag.
 *
 * `weight` orders candidates within a verb when the floor rung pages the tail. It
 * is the amount at stake, so what survives is what matters most — never the tail
 * of an arrival-ordered list.
 */
export interface Candidate {
  readonly affordance: Affordance;
  readonly mandatory: boolean;
  readonly weight: Minor;
  /** True only for a `seal` covered by §17's one-free-per-role-held allowance. */
  readonly usesFreeAllowance: boolean;
}

/** Canonical candidate order: verb group, then stake descending, then params. */
export function compareCandidates(a: Candidate, b: Candidate): number {
  const byVerb = verbOrder(a.affordance.verb) - verbOrder(b.affordance.verb);
  if (byVerb !== 0) return byVerb;
  // Mandatory first inside a verb, so a per-verb cap can never page a mandatory act.
  if (a.mandatory !== b.mandatory) return a.mandatory ? -1 : 1;
  if (a.weight !== b.weight) return b.weight - a.weight;
  return compareIds(paramKey(a.affordance), paramKey(b.affordance));
}

/** A stable string for a candidate's params. Only for ordering, never for identity. */
export function paramKey(affordance: Affordance): string {
  return Object.keys(affordance.params)
    .sort((x, y) => compareIds(x, y))
    .map((k) => `${k}=${String(affordance.params[k])}`)
    .join('::');
}

/**
 * PROP-O4 as a checker. Everything wrong with one affordance, or empty.
 *
 * Returns faults rather than throwing so a caller can report every fault in one
 * pass; `assertObservation` is what turns them into a failure.
 */
export function affordanceFaults(
  affordance: Affordance,
  tick: number,
  usesFreeAllowance = false,
): string[] {
  const faults: string[] = [];
  const a = affordance as unknown as Record<string, unknown>;

  // Checked before the presence sweep so the narrow-exception fault is reported even
  // on an otherwise malformed affordance: claiming the seal allowance for another verb
  // is a rules-surface error, not a shape error.
  if (usesFreeAllowance && affordance.verb !== 'seal') {
    faults.push(
      `PROP-O4: '${affordance.verb}' claims §17's free allowance, which exists only for seals ` +
        '(one per role held); every other verb is charged by src/tick/budget.ts',
    );
  }

  for (const key of AFFORDANCE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(a, key) || a[key] === undefined || a[key] === null) {
      faults.push(
        `PROP-O4: affordance '${String(affordance.verb)}' is missing ${key}. The shown worst case is the ` +
          "core loop's honesty guarantee and agent.md tells players to rely on it",
      );
    }
  }
  // Stop here when a field is absent. Every check below reads one of them, and a
  // *checker* that throws on malformed input is a checker that cannot be run on the
  // path where malformed input actually arrives.
  if (faults.length > 0) return faults;

  if (!isVerb(affordance.verb)) {
    faults.push(`PROP-O4: '${String(affordance.verb)}' is not one of SPEC §12.2's verbs`);
  }

  // `cost` must agree with the engine-owned budget, not with a local opinion.
  // SCAR-2's fix was an engine-owned action budget; an affordance that quoted a
  // different cost would be the agent-facing text disagreeing with the engine.
  const declared = actionCostOf(affordance.verb, usesFreeAllowance);
  if (affordance.cost !== declared) {
    faults.push(
      `PROP-O4: '${affordance.verb}' quotes cost ${affordance.cost} but the engine charges ${declared} ` +
        '(src/tick/budget.ts owns the free set); two homes for one price is scar #5',
    );
  }

  for (const [name, value] of [
    ['max_direct_loss', affordance.max_direct_loss],
    ['max_contingent_liability', affordance.max_contingent_liability],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      faults.push(
        `PROP-O4: '${affordance.verb}' quotes ${name} of ${String(value)}; a worst case is a ` +
          'non-negative whole number of minor units, never a float and never unknown',
      );
    }
  }

  if (!Number.isSafeInteger(affordance.expires_tick) || affordance.expires_tick < tick) {
    faults.push(
      `PROP-O4: '${affordance.verb}' expires at tick ${String(affordance.expires_tick)}, which is before ` +
        `the observation's tick ${tick}; an option that has already died is not something you can do now`,
    );
  }

  if (affordance.quote_id.length === 0) {
    faults.push(`PROP-O4: '${affordance.verb}' carries an empty quote_id`);
  }

  if (affordance.what_it_forecloses.length > MAX_FORECLOSE_ENTRIES) {
    faults.push(
      `INV-26: '${affordance.verb}' lists ${affordance.what_it_forecloses.length} foreclosures against a ` +
        `cap of ${MAX_FORECLOSE_ENTRIES}`,
    );
  }
  for (const entry of affordance.what_it_forecloses) {
    if (entry.length > MAX_PHRASE_CHARS) {
      faults.push(
        `INV-26: '${affordance.verb}' has a ${entry.length}-character foreclosure phrase against a cap of ` +
          `${MAX_PHRASE_CHARS}`,
      );
    }
  }

  return faults;
}
