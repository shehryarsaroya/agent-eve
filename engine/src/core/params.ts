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
