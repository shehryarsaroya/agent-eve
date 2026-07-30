/**
 * The message off an unknown throw, for a refusal hint.
 *
 * ── WHY THIS IS A FILE AND NOT THREE INLINE COPIES ───────────────────────────
 *
 * A refusal hint is a **rules surface** (scar #1): the sentence an agent reads is part of the game's
 * contract, so the transformation that produces it cannot be re-guessed per call site. `form`, `apply`
 * and `admit` each turn a caught throw into a hint, so without one home there would be three.
 *
 * ── AND WHY IT IS A COPY OF `sim/runtime.ts`'s ───────────────────────────────
 *
 * **This must stay byte-identical to `describeError` in `sim/runtime.ts`.** The syndicate handlers were
 * extracted out of that file and their refusal text has to be unchanged, and the runtime's version is
 * NOT the obvious one-liner the rest of the codebase inlines: it takes only the **first line** of the
 * message and answers `'unknown'` for a non-`Error`. Writing the obvious
 * `error instanceof Error ? error.message : String(error)` here instead would silently widen every hint
 * these three verbs can emit — a behaviour change dressed as a refactor, and invisible to `state_hash`
 * because refusal text is not hashed.
 *
 * It is a copy rather than an import because the dependency has to point this way: a domain module that
 * reached back into `sim/runtime.ts` for a string helper would make the file this extraction exists to
 * shrink a prerequisite for reading the module that left it. The real fix is one home in `core/` with
 * both callers pointing at it; that is a two-line change for whoever is next in a shared file, and it
 * is named here so the duplication is a known debt rather than a discovered one.
 */

/** First line of an `Error`'s message, or `'unknown'`. Must match `sim/runtime.ts:describeError`. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message.split('\n')[0] ?? 'unknown';
  return 'unknown';
}
