/**
 * Reading a model's reply, on the assumption that it is hostile.
 *
 * Not because a model is an attacker, but because the consequences of a bad reply are
 * asymmetric and one of them is unrecoverable:
 *
 *   - **A float in `params` halts the world.** Action params are canonicalised into the
 *     hashed action log, and `canonicalize` *throws* on a non-integer number (`float in
 *     canonical structure`). That throw would land inside the tick scheduler, on a path
 *     with no catch, and take the world down — a model's typo becoming an outage.
 *   - **A NUL byte poisons the record.** Banned repo-wide; it reaches the journal, the
 *     frame and the Gazette.
 *   - **An unbounded string is scar #3**, arriving through a channel we pay for.
 *
 * So this module answers exactly one question — *is this reply safe to hand the engine* —
 * and it answers `no` freely. A discarded reply costs one wake and one heuristic action.
 * A reply that should have been discarded costs the world.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ──
 *
 * **It does not check whether an action is legal.** No "does this venture exist", no "can
 * this hand move there", no per-verb parameter schema. That validation already exists, in
 * the engine, and a second copy of it here would be a second rules surface that can
 * disagree with the first — scar #1 with extra steps. An illegal action from the cast is
 * refused exactly as an illegal action from a stranger is: `{ok:false, hint}`, a
 * correction held, and the member reads it on its next wake. That is the designed path
 * and the cast should walk it.
 *
 * What it checks is only what the *serialiser* and the *buffers* require. Type-safety,
 * not rules.
 */

import { hasControlBytes, stripControlBytes } from './text.js';

/** Verbs are lower-case identifiers. Anything else is not a verb, whatever it says. */
const VERB_SHAPE = /^[a-z][a-z0-9_]{1,31}$/;

/** Param keys share the shape. A key with a space or a dot is not one of ours. */
const KEY_SHAPE = /^[a-z][a-z0-9_]{0,39}$/;

/** Longest string value accepted in a param. Bounded (INV-26, scar #3). */
export const MAX_PARAM_STRING = 512;

/** Most keys one params object may carry. No verb in the canon comes close. */
export const MAX_PARAM_KEYS = 16;

/** Longest array accepted as a param value. */
export const MAX_PARAM_ARRAY = 16;

/** Longest `note` retained. It goes to memory and to a log line, never to the record. */
export const MAX_NOTE_CHARS = 200;

/** Bytes of reply text read at all. A reply longer than this is refused unparsed. */
export const MAX_REPLY_CHARS = 20_000;

export interface ParsedAction {
  readonly verb: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export type ParseResult =
  | { readonly ok: true; readonly plan: readonly ParsedAction[]; readonly note: string | null }
  | { readonly ok: false; readonly why: string };

export interface ParseOptions {
  /** The engine's own verb registry (`runtime.liveVerbs`). Never a copy of it. */
  readonly liveVerbs: ReadonlySet<string>;
  readonly planMax: number;
}

/**
 * Parse a reply into a plan, or say why not.
 *
 * **Never throws.** Every failure is a `{ok:false, why}` with a short, greppable reason,
 * because the caller is the tick scheduler and a throw there is an outage. The `why`
 * strings are a closed vocabulary in practice — `not-json`, `no-plan`, `bad-verb:x` —
 * so a rising count of one of them in the logs names the defect.
 */
export function parseReply(raw: string, options: ParseOptions): ParseResult {
  if (typeof raw !== 'string') return { ok: false, why: 'not-a-string' };
  if (raw.length > MAX_REPLY_CHARS) return { ok: false, why: 'reply-too-long' };

  const text = unfence(raw).trim();
  if (text.length === 0) return { ok: false, why: 'empty' };

  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { ok: false, why: 'not-json' };
  }
  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    return { ok: false, why: 'not-an-object' };
  }

  const body = root as Record<string, unknown>;
  const rawPlan = body['plan'];
  if (!Array.isArray(rawPlan)) return { ok: false, why: 'no-plan' };
  if (rawPlan.length === 0) return { ok: false, why: 'empty-plan' };

  const plan: ParsedAction[] = [];
  // A plan longer than the cap is TRUNCATED rather than rejected: the first entries are
  // still a decision the model made, and throwing away a good first action because the
  // fourth was surplus would be strictness for its own sake. A malformed entry anywhere
  // is different — see below — because it means the reply is not the shape we asked for.
  for (const entry of rawPlan.slice(0, Math.max(1, options.planMax))) {
    const action = readAction(entry, options.liveVerbs);
    if (!action.ok) return { ok: false, why: action.why };
    plan.push(action.action);
  }

  const note = body['note'];
  return {
    ok: true,
    plan,
    note: typeof note === 'string' ? scrub(note).slice(0, MAX_NOTE_CHARS) : null,
  };
}

/**
 * Strip a markdown fence if the model wrapped its JSON in one.
 *
 * Tolerated rather than rejected because it is the single most common deviation, it is
 * unambiguous, and it costs one regex. Everything past this point is strict.
 */
function unfence(raw: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?\s*```\s*$/.exec(raw);
  return fenced === null ? raw : (fenced[1] ?? '');
}

type ActionRead = { ok: true; action: ParsedAction } | { ok: false; why: string };

function readAction(entry: unknown, liveVerbs: ReadonlySet<string>): ActionRead {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return { ok: false, why: 'plan-entry-not-an-object' };
  }
  const row = entry as Record<string, unknown>;

  const verb = row['verb'];
  if (typeof verb !== 'string') return { ok: false, why: 'verb-not-a-string' };
  if (!VERB_SHAPE.test(verb)) return { ok: false, why: 'verb-malformed' };
  // The engine's registry, passed in. A verb this runtime does not implement is refused
  // here rather than submitted, because submitting it produces one refusal per plan entry
  // and AGT-S3 reads a repeated refusal as a rules-surface defect — which it would be.
  if (!liveVerbs.has(verb)) return { ok: false, why: `unknown-verb:${verb.slice(0, 24)}` };

  const rawParams = row['params'] ?? {};
  if (typeof rawParams !== 'object' || rawParams === null || Array.isArray(rawParams)) {
    return { ok: false, why: 'params-not-an-object' };
  }
  const source = rawParams as Record<string, unknown>;
  const keys = Object.keys(source);
  if (keys.length > MAX_PARAM_KEYS) return { ok: false, why: 'too-many-params' };

  const params: Record<string, unknown> = {};
  // Sorted, so two replies carrying the same params build the same object in the same
  // order. Nothing downstream depends on it — `canonicalize` sorts keys itself — but a
  // stable order makes a logged params object diffable against another one.
  for (const key of [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!KEY_SHAPE.test(key)) return { ok: false, why: 'param-key-malformed' };
    const value = readValue(source[key]);
    if (!value.ok) return { ok: false, why: `param-${key.slice(0, 24)}-${value.why}` };
    params[key] = value.value;
  }

  return { ok: true, action: { verb, params } };
}

type ValueRead = { ok: true; value: unknown } | { ok: false; why: string };

/**
 * One param value: scalar, or an array of scalars. Nothing else, ever.
 *
 * The integer rule is the one that matters. `canonicalize` throws on a float, and that
 * throw would happen inside tick resolution where nothing catches it. So `2.5` is refused
 * here, three layers before it could become an outage — and the prompt says so, in the
 * same words, because telling the model the rule is cheaper than discarding its reply.
 */
function readValue(value: unknown, depth = 0): ValueRead {
  if (value === null) return { ok: true, value: null };

  switch (typeof value) {
    case 'boolean':
      return { ok: true, value };
    case 'number':
      if (!Number.isFinite(value)) return { ok: false, why: 'not-finite' };
      if (!Number.isInteger(value)) return { ok: false, why: 'not-an-integer' };
      if (!Number.isSafeInteger(value)) return { ok: false, why: 'unsafe-integer' };
      // -0 canonicalises to 0 anyway; normalised here so the logged params match.
      return { ok: true, value: Object.is(value, -0) ? 0 : value };
    case 'string':
      if (value.length > MAX_PARAM_STRING) return { ok: false, why: 'string-too-long' };
      // Refused, never cleaned: a param goes into the hashed action log, where the
      // difference between "as sent" and "tidied up" is the difference between a
      // faithful record and a helpful one.
      if (hasControlBytes(value)) return { ok: false, why: 'control-bytes' };
      return { ok: true, value };
    case 'object': {
      if (!Array.isArray(value)) return { ok: false, why: 'nested-object' };
      if (depth > 0) return { ok: false, why: 'nested-array' };
      if (value.length > MAX_PARAM_ARRAY) return { ok: false, why: 'array-too-long' };
      const out: unknown[] = [];
      for (const item of value as unknown[]) {
        const read = readValue(item, depth + 1);
        if (!read.ok) return read;
        out.push(read.value);
      }
      return { ok: true, value: out };
    }
    // Named rather than defaulted: `switch-exhaustiveness-check` is an error in this
    // repo, and a `default` here would silently absorb a `typeof` the language adds.
    case 'undefined':
    case 'bigint':
    case 'symbol':
    case 'function':
      return { ok: false, why: `unserialisable-${typeof value}` };
  }
  // Unreachable: the switch covers every `typeof`. Present because TypeScript does not
  // narrow an exhaustive `typeof` switch over `unknown`, and `noImplicitReturns` is on.
  return { ok: false, why: 'unserialisable' };
}

/**
 * Remove control bytes from prose.
 *
 * Used on a `note` only. A note is prose that goes to the member's memory and to a log
 * line; a stray newline in one is not worth discarding a decision over. Param strings
 * take the other treatment — see the `string` branch of {@link readValue}.
 */
function scrub(text: string): string {
  return stripControlBytes(text);
}
