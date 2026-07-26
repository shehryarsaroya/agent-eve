/**
 * The fourteen phases, in the one order SPEC §15.2 gives them.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE ORDER IS A RULES SURFACE.** Not a code-organisation choice.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Three consequences follow, and each is why this file exists as data rather
 * than as the call sequence inside a function:
 *
 * 1. **Inserting a phase later shifts every seeded draw and every golden file.**
 *    Each phase draws from its own `Rng.derive(phase)` sub-stream precisely so
 *    that *adding a draw* inside one phase cannot move another's; but adding a
 *    whole *phase* changes the set of labels, and a label change is a new
 *    stream. So the phases that have no module yet are present as explicit no-op
 *    hooks from the first commit. They are not omitted and they are not commented
 *    out. **The promise has now been cashed** — `PREDATE` took a registered handler
 *    (SPEC §16 step 12) — and no other phase's sub-stream moved, because the label set
 *    never changed. That is the payoff for having reserved the slot in commit #1.
 * 2. **Two of the adjacencies are load-bearing rules**, not tidiness:
 *    `MOVE` before every resolution phase (or every published ETA is a tick
 *    optimistic), and `MARKETS` before `PRODUCE` (§15.2's "clear-before-produce,
 *    and jobs may not buy at market"). {@link assertPhaseOrder} makes both
 *    executable, because `TESTING.md` §0's standing rule is assertions over
 *    review.
 * 3. **The spelling is the spec's spelling.** `VALIDATE+LOCK` keeps its `+`.
 *    Renaming it to `VALIDATE_LOCK` would give one phase two names, in a
 *    codebase whose §3 discipline is one word per concept — and scar #1 was
 *    exactly the engine and the documentation disagreeing about one word.
 */

import { MOVE_PHASE_MUST_PRECEDE } from '../world/index.js';

/** The pipeline. Index is meaning: this array *is* SPEC §15.2's arrow chain. */
export const PHASES = [
  'FREEZE_QUEUE',
  'EXPIRE',
  'VALIDATE+LOCK',
  'MOVE',
  'PREDATE',
  'MARKETS',
  'PRODUCE',
  'VENTURES',
  'HAZARD',
  'OBLIGE',
  'DERIVE',
  'ASSERT',
  'COMMIT',
  'WAKE',
] as const;

export type PhaseName = (typeof PHASES)[number];

export class PhaseOrderError extends Error {}

const INDEX: ReadonlyMap<string, number> = new Map(PHASES.map((p, i) => [p, i]));

export function phaseIndex(phase: PhaseName): number {
  const i = INDEX.get(phase);
  if (i === undefined) throw new PhaseOrderError(`unknown phase ${phase}`);
  return i;
}

export function isPhaseName(s: string): s is PhaseName {
  return INDEX.has(s);
}

/**
 * Phases with no module behind them yet. They run, they do nothing, and they
 * hold their slot in the order so that the build step that fills them does not
 * move anything else.
 *
 * `VENTURES`, `HAZARD` and `OBLIGE` are deliberately **not** on this list even
 * though Phase 0 ships them empty too: they take registered handlers from the
 * venture, predation and Levy modules, so they are unfilled rather than unbuilt.
 *
 * `PREDATE` left the list when `src/predation/` landed: it is now in exactly the same
 * position as `VENTURES` — the slot is the tick loop's and the content is a module's.
 *
 * **`MARKETS` is left on the list and that is a reported inconsistency, not a claim.**
 * `src/market/` exists and `Runtime` registers a `MARKETS` handler, so the phase is
 * filled in the wired engine; the entry survives because a fixture built without the
 * market module still runs it empty. Correcting it belongs to whoever owns the market,
 * not to the predation change that noticed it.
 */
// `MARKETS` came off this list when the order book landed and `PRODUCE` when WORKS did.
// Kept as a list rather than deleted: `PREDATE` was the third reserved hook and the tick
// loop still asserts that a phase named here does nothing, which is what made filling these
// three provably free of seeded-substream drift.
export const UNBUILT_PHASES: readonly PhaseName[] = [];

/**
 * What each phase is for, and — for the unbuilt ones — which build step fills
 * it. Written here rather than as scattered comments so a reader can diff the
 * pipeline against SPEC §16's build order in one screen.
 */
export const PHASE_NOTE: Readonly<Record<PhaseName, string>> = {
  FREEZE_QUEUE:
    'Order the window by (priority, principal_id, client_sequence) — never arrival — and reveal seed(T). ' +
    'Nothing else may enter tick T after this point.',
  EXPIRE:
    'Retire what timed out (intents past their stop condition, quotes, grants) before anything can lock it. ' +
    'Expiring after VALIDATE would let an action lock a thing that had already lapsed.',
  'VALIDATE+LOCK':
    'Charge the action budget, run the Commons floor (A8), compare acted_on_state_version against the frozen ' +
    'snapshot, then apply. Submit-time validation is honest because snapshot T does not move during the window.',
  MOVE:
    'Resolve every arrival and recovery due this tick. Runs before every resolution phase, or every published ' +
    'ETA is a tick optimistic (SPEC §15.2).',
  PREDATE:
    'The world spawns raids on a published schedule, and every demand whose window has run resolves here ' +
    '(SPEC §9, §16 step 12). Filled by src/predation via a registered handler; the tick loop owns the slot. ' +
    'After MOVE, so a hand that marched to the stage to defend is present on the tick its ETA promised.',
  MARKETS:
    'Resting orders cross at one venue per system (SPEC §10.3). Filled by src/market via a registered ' +
    'handler. After MOVE so a hand that arrived this tick can trade where it landed, and before PRODUCE — ' +
    '§15.2: clear-before-produce, and jobs may not buy at market.',
  PRODUCE:
    'WORKS extract what their system yields, divided among the WORKS standing there (SPEC §10.2, A15). ' +
    'Filled by src/works via a registered handler. After MARKETS so a principal cannot read this tick\'s ' +
    'clearing price and then decide what to make (§15.2, clear-before-produce).',
  VENTURES:
    'Ventures advance and settle. Filled by SPEC §16 step 5 (HAUL and the settlement waterfall) via a ' +
    'registered handler; the tick loop owns the slot, not the content.',
  HAZARD:
    'Hazards roll against what is still standing. After VENTURES, so a hazard cannot pre-empt a settlement ' +
    'the parties already earned.',
  OBLIGE:
    'Obligations discharge, in fixed cascade rounds. Anything unresolved at the round limit DEFERS to the next ' +
    'Reckoning and never defaults — a truncated cascade recording a breach is an engine-fabricated default.',
  DERIVE:
    'Recompute the caches ASSERT is about to check, and compute the boundary state_hash. Per-event hashing was ' +
    'dropped deliberately (§15.1); the hash exists at tick boundaries only.',
  ASSERT:
    'Every invariant, every tick, in production, forever. On any HALT violation the tick aborts, nothing is ' +
    'published, and the world enters PAUSED.',
  COMMIT:
    'The publish boundary. Buffered events reach the append-only ledger here and nowhere earlier, which is what ' +
    'makes "never publish a broken tick" literally true rather than aspirational.',
  WAKE:
    'Offer wakes to the parties of anything that resolved. Logged, so §5.1\'s "offered exactly one wake" is ' +
    'auditable rather than asserted.',
};

/**
 * The ordering rules, executable.
 *
 * Called from the Engine constructor, not only from a test: a pipeline built in
 * the wrong order must fail at construction, before it has published a tick that
 * an observer might have believed.
 */
export function assertPhaseOrder(): void {
  const problems: string[] = [];

  if (PHASES[0] !== 'FREEZE_QUEUE') {
    problems.push('FREEZE_QUEUE must be first: the window closes before anything reads it');
  }
  if (PHASES[PHASES.length - 1] !== 'WAKE') {
    problems.push('WAKE must be last: a wake offered before COMMIT advertises a tick that may still abort');
  }
  if (PHASES.length !== new Set<string>(PHASES).size) {
    problems.push('a phase name appears twice; each phase runs exactly once per tick');
  }

  // MOVE before every resolution phase. The list is the world module's, so the
  // two modules cannot drift apart about which phases depend on arrivals.
  const move = phaseIndex('MOVE');
  for (const after of MOVE_PHASE_MUST_PRECEDE) {
    if (!isPhaseName(after)) {
      problems.push(`world/movement names '${after}' as a phase MOVE must precede, but there is no such phase`);
      continue;
    }
    if (phaseIndex(after) <= move) {
      problems.push(`MOVE must precede ${after}, or every published ETA is a tick optimistic`);
    }
  }

  // §15.2's named hazard: clear before produce.
  if (phaseIndex('MARKETS') >= phaseIndex('PRODUCE')) {
    problems.push('MARKETS must precede PRODUCE (§15.2: clear-before-produce; jobs may not buy at market)');
  }
  // The two that make A5' hold: assert before publish, derive before assert.
  if (phaseIndex('DERIVE') >= phaseIndex('ASSERT')) {
    problems.push('DERIVE must precede ASSERT, or ASSERT checks caches this tick has not refreshed');
  }
  if (phaseIndex('ASSERT') >= phaseIndex('COMMIT')) {
    problems.push('ASSERT must precede COMMIT, or a broken tick is published before it is checked');
  }
  if (phaseIndex('EXPIRE') >= phaseIndex('VALIDATE+LOCK')) {
    problems.push('EXPIRE must precede VALIDATE+LOCK, or an action can lock something that had already lapsed');
  }

  if (problems.length > 0) {
    throw new PhaseOrderError(`SPEC §15.2 phase order violated:\n  - ${problems.join('\n  - ')}`);
  }
}
