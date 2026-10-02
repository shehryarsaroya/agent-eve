/**
 * SERIALIZE-ONCE OBSERVATIONS (SPEC §15.5) — shared fragments, serialized once per read epoch, spliced
 * into a per-principal envelope.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * §15.5: *"Observation serialization is the term that actually scales — O(P × size). Build blobs from
 * shared immutable fragments plus a per-principal envelope … serialize once and concatenate. That is
 * the difference between 300 and 3,000 principals."*
 *
 * **What measuring it found, and why this file is two mechanisms rather than one.** The sentence
 * assumed the map, the books and the public feed dominate an observation. In this build they do not:
 * the map is on the frame, not in `observe`, and ~85% of an observation's bytes are the reader's own
 * — its affordances, its ventures, its counterparties. What actually scaled as O(P²) was not the
 * serializing but the BUILDING: a handful of world-wide reads ran inside every principal's build
 * (`levyCarryRows` walked the constellation roll twice per observation; `exposureBand` summed every
 * principal's EXPOSURE). So:
 *
 *   1. **Shared COMPUTATION** — `Runtime.perEpoch` caches each world-wide view once between two ticks,
 *      and every observation in the epoch reads the same object. That is where the time went.
 *   2. **Shared SERIALIZATION** — this file. Every value `perEpoch` hands out is frozen and registered,
 *      so it is the same immutable object for every reader; its JSON is computed once, keyed by
 *      identity, and the envelope carries a token where it goes. One native `JSON.stringify` of the
 *      envelope, one splice. Only a REGISTERED view is a fragment — an object that merely happens to be
 *      frozen (the risk block freezes its own per-reader rows) is serialized in place, because caching
 *      the text of something no other reader will ever hold is work with no second customer.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## The byte-identity contract
 *
 * `observationBody(input)` returns **exactly** `JSON.stringify({ ok: true, observation:
 * buildObservation(input) })` — the bytes `server.ts` always sent. Two reasons it can be exact rather
 * than "equivalent":
 *
 *   - `JSON.stringify` of a nested object is, at that position, exactly `JSON.stringify` of the object
 *     alone: no indent, no replacer, no `toJSON` anywhere in an observation. So a cached fragment is the
 *     text the full serialization would have produced there.
 *   - The envelope is a shallow clone along the paths that hold fragments, so every key keeps its
 *     insertion position and the clone serializes in the same order as the original.
 *
 * `test/api/fragments.spec.ts` builds every principal's observation in a populated world both ways —
 * the cached, spliced path and the reference path with every shared view recomputed from scratch
 * (`Runtime.withoutReadMemo`) — across enrolments and submissions, and asserts the bytes are equal.
 *
 * ## The one hazard, and the guard
 *
 * A token is a string, and an agent can write strings into an observation (a talk message, a parley).
 * If a payload string ever equalled a token, a naive splice would put a fragment where the agent's text
 * was. So every token must appear exactly once in the envelope's text, and if any does not, the splice
 * is abandoned for the plain serialization of the whole observation. Correct first, fast second.
 */

import type { Runtime } from '../sim/runtime.js';
import { buildObservation, type Observation, type ObserveInput } from './observe.js';

/**
 * How deep the envelope walk looks for fragments. Two levels covers every shared view `observe` places
 * (`header.raid_schedule`, `header.growth`, `market.fees`, …) and keeps the walk a few dozen property
 * reads per observation.
 */
export const FRAGMENT_DEPTH = 2;

/** The smallest fragment worth a token. Below this a token costs as much as it saves. */
export const MIN_FRAGMENT_BYTES = 64;

/**
 * The JSON text of every frozen value an observation has carried, by identity.
 *
 * A `WeakMap`, so a view retired at the end of its read epoch is collected with its text; nothing here
 * outlives the object it describes, and nothing here can describe an object that changed — a frozen
 * object cannot.
 */
export class FragmentCache {
  private readonly text = new WeakMap<object, string>();
  /** Fragments served, and fragments serialized — `served - serialized` is the work saved. */
  served = 0;
  serialized = 0;

  jsonOf(value: object): string {
    const hit = this.text.get(value);
    if (hit !== undefined) {
      this.served += 1;
      return hit;
    }
    const json = JSON.stringify(value);
    this.text.set(value, json);
    this.serialized += 1;
    this.served += 1;
    return json;
  }
}

/** The process-wide cache. One is enough: it is keyed by object identity and holds nothing alive. */
const SHARED = new FragmentCache();

/** A token cannot be confused with a payload string unless the payload contains NUL and these digits. */
function token(i: number): string {
  return `\u0000frag:${String(i)}\u0000`;
}

const TOKEN_JSON = /"\\u0000frag:(\d+)\\u0000"/g;

/**
 * Shallow-clone `value` along every path to a shared fragment, replacing each fragment with a token.
 * Returns the original object untouched when nothing at this level or below is a fragment, so the
 * common case allocates nothing.
 */
function envelope(
  value: unknown,
  depth: number,
  cache: FragmentCache,
  shared: (value: object) => boolean,
  out: string[],
): unknown {
  if (depth === 0 || value === null || typeof value !== 'object') return value;
  let clone: Record<string, unknown> | unknown[] | null = null;
  const list: readonly unknown[] | null = Array.isArray(value) ? (value as readonly unknown[]) : null;
  const entries: readonly (readonly [string | number, unknown])[] =
    list !== null ? list.map((v, i) => [i, v] as const) : Object.entries(value as Record<string, unknown>);
  for (const [k, v] of entries) {
    let replaced: unknown = v;
    if (v !== null && typeof v === 'object' && shared(v)) {
      const json = cache.jsonOf(v);
      if (json.length >= MIN_FRAGMENT_BYTES) {
        out.push(json);
        replaced = token(out.length - 1);
      }
    } else {
      replaced = envelope(v, depth - 1, cache, shared, out);
    }
    if (replaced !== v) {
      clone ??= list !== null ? [...list] : { ...(value as Record<string, unknown>) };
      if (Array.isArray(clone)) clone[Number(k)] = replaced;
      else clone[String(k)] = replaced;
    }
  }
  return clone ?? value;
}

/**
 * Serialize `{ ok: true, observation }`, splicing every frozen fragment from the cache.
 *
 * Byte-identical to `JSON.stringify({ ok: true, observation })`; see the file header.
 */
export function serializeObservation(
  observation: Observation,
  shared: (value: object) => boolean,
  cache: FragmentCache = SHARED,
): string {
  const fragments: string[] = [];
  const body = envelope(observation, FRAGMENT_DEPTH, cache, shared, fragments);
  const text = JSON.stringify({ ok: true, observation: body });
  if (fragments.length === 0) return text;
  const seen = new Array<number>(fragments.length).fill(0);
  let foreign = false;
  const spliced = text.replace(TOKEN_JSON, (match, index: string) => {
    const i = Number(index);
    const fragment = fragments[i];
    if (fragment === undefined) {
      foreign = true;
      return match;
    }
    seen[i] = (seen[i] ?? 0) + 1;
    return fragment;
  });
  // Every token exactly once, or a payload string looked like one: fall back to the plain bytes.
  if (foreign || seen.some((n) => n !== 1)) return JSON.stringify({ ok: true, observation });
  return spliced;
}

/** The bytes `GET /observe` sends for one principal: the build, then the spliced serialization. */
export function observationBody(input: ObserveInput, cache: FragmentCache = SHARED): string {
  return serializeObservation(buildObservation(input), (v) => input.runtime.isSharedView(v), cache);
}

/** The reference bytes: every shared view recomputed, then the plain serialization. For tests. */
export function referenceObservationBody(input: ObserveInput): string {
  return input.runtime.withoutReadMemo(() => JSON.stringify({ ok: true, observation: buildObservation(input) }));
}

/** The cache's counters, for `/health` and the scale harness. */
export function fragmentStats(cache: FragmentCache = SHARED): { readonly served: number; readonly serialized: number } {
  return { served: cache.served, serialized: cache.serialized };
}

export type { Runtime };
