/**
 * Reading a verb's params, tolerantly and in one place.
 *
 * These lived as module-local functions inside `sim/runtime.ts` and moved here when the first verb was
 * extracted (`D21`): a handler that lives in `venture/` cannot import from `sim/` without inverting
 * the layering, and copying them would be scar #5 — one rule, two homes, free to disagree about what
 * counts as a value.
 *
 * **Both are deliberately forgiving about SPELLING and strict about TYPE.** An agent that sends
 * `venture_id` where the docs say `venture` has made a harmless mistake and should be understood; an
 * agent that sends `"3"` where a number is required has made a meaningful one and must be refused,
 * because coercing it would make `qty: "3"` and `qty: 3` the same action while the record shows only
 * one of them. Every accepted spelling is listed at the call site, so the tolerated set is visible
 * rather than inferred.
 */

/** The first key present as a non-empty string, or null. Empty strings are absent, never "". */
export function readString(
  params: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

/**
 * The first key present as a safe integer, or null.
 *
 * `Number.isSafeInteger` rather than `typeof === 'number'`: floats are banned in anything hashed
 * (DET), and a quantity past 2^53 silently loses precision — which in a ledger is a quantity that does
 * not add up, discovered at settlement rather than at the door.
 */
export function readInt(
  params: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  }
  return null;
}

/**
 * What {@link readIntOrFault} found: a number, nothing, or something it refused to coerce.
 *
 * ── WHY THIS EXISTS ALONGSIDE `readInt` ──────────────────────────────────────
 *
 * `readInt` answers `null` for **two different mistakes** — "you sent no quantity" and "you sent a
 * quantity I will not accept" — and every caller that turns that `null` into a refusal therefore tells
 * an agent the first thing when the truth may be the second. An agent that sent `{"stake": "600"}` reads
 * *"send {"stake":N}"*, does exactly that again with the same JSON, and is refused again identically.
 * That is a loop the agent cannot escape by reading the hint, which is A2's whole promise broken at the
 * cheapest possible place — and `HIGH-WATER-LESSONS` validated pattern 4 is precisely that a hint an
 * agent can act on is the difference between self-correction and a wasted turn.
 *
 * The type is a discriminated union rather than a nullable number so a caller cannot accidentally treat
 * the two the same: there is no falsy value to collapse them onto.
 */
export type IntRead =
  | { readonly kind: 'OK'; readonly value: number }
  /** No listed key was present at all. */
  | { readonly kind: 'ABSENT' }
  /** A listed key was present and was not a safe integer. `saw` is for the hint, never for coercion. */
  | { readonly kind: 'MALFORMED'; readonly key: string; readonly saw: string };

/**
 * How to describe what arrived, in a sentence an agent can act on.
 *
 * Deliberately names the JSON type rather than echoing the value unbounded: an agent that sent a
 * 40 KB string must not get 40 KB of it back in a refusal that goes on the record, and a value is
 * truncated for the same reason every buffer in this engine is capped (INV-26, scar #3).
 */
function sawWhat(value: unknown): string {
  if (typeof value === 'string') {
    const shown = value.length > 32 ? `${value.slice(0, 32)}…` : value;
    return `the string "${shown}"`;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return `${String(value)}, which is not a finite number`;
    if (!Number.isInteger(value)) return `${String(value)}, which is a fraction`;
    // Integral but past 2^53, where arithmetic silently stops being exact.
    return `${String(value)}, which is too large to be exact`;
  }
  if (typeof value === 'boolean') return `${String(value)}, which is a boolean`;
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return `a ${typeof value}`;
}

/**
 * The first listed key as a safe integer, distinguishing **absent** from **malformed**.
 *
 * Same tolerance as {@link readInt} — forgiving about spelling, strict about type, for the reasons in
 * this file's header — but it reports *which* mistake was made so the refusal can name it. Prefer this
 * over `readInt` wherever a `null` becomes a refusal an agent reads; `readInt` stays correct where
 * `null` means "use the default", which is a third, legitimate answer that needs no explanation.
 *
 * A key present with the right type wins immediately. A key present with the WRONG type is remembered
 * and the search continues, so `{"qty": "3", "quantity": 3}` is accepted on the good spelling rather
 * than refused on the bad one — an agent that sent both plainly meant the one that parses.
 */
export function readIntOrFault(
  params: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): IntRead {
  let fault: { readonly key: string; readonly saw: string } | null = null;
  for (const key of keys) {
    if (!(key in params)) continue;
    const value = params[key];
    if (typeof value === 'number' && Number.isSafeInteger(value)) return { kind: 'OK', value };
    // First bad spelling is the one reported: it is the one the agent most likely meant.
    fault ??= { key, saw: sawWhat(value) };
  }
  if (fault !== null) return { kind: 'MALFORMED', key: fault.key, saw: fault.saw };
  return { kind: 'ABSENT' };
}

/**
 * The first key present as a list of non-empty strings, or `null` when no key is present.
 *
 * **`null` and `[]` are different answers and the distinction is load-bearing.** A grant's
 * fence reads *"no key at all"* as "use the template's default" and *"an explicit empty
 * list"* as "delegate nothing" — a caller that collapsed the two would silently widen an
 * agent's stated intent to whatever the default happened to be, which on a grant is the
 * difference between an office and a blank cheque.
 *
 * Forgiving about SHAPE in the one way an LLM actually gets wrong: a single string is read
 * as a one-element list, and a comma- or space-delimited string is split. Strict about
 * TYPE — a non-string member is a refusal at the door, never a coerced `"[object Object]"`
 * quietly entering a captured row.
 *
 * Bounded at {@link MAX_PARAM_LIST}: every list in this engine is (INV-26, scar #3), and a
 * params array is the cheapest unbounded buffer an agent has.
 */
export const MAX_PARAM_LIST = 32;

export function readList(
  params: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): readonly string[] | null {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string') {
      if (value.length === 0) return [];
      return value
        .split(/[,\s]+/)
        .filter((part) => part.length > 0)
        .slice(0, MAX_PARAM_LIST);
    }
    if (Array.isArray(value)) {
      const out: string[] = [];
      for (const member of value.slice(0, MAX_PARAM_LIST)) {
        if (typeof member !== 'string' || member.length === 0) continue;
        out.push(member);
      }
      return out;
    }
  }
  return null;
}
