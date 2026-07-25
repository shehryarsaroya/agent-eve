/**
 * The wire shapes, and the one place a string is scrubbed before it leaves.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **SCAR #11.** High Water had no error middleware, so a malformed body reached
 * Express's default handler and the response was an HTML stack trace carrying
 * absolute `/opt` paths, the library versions, and the shape of the deploy. It
 * was found by accident, months later, by a person poking the API by hand.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The fix is three-layered, because a single layer is one refactor from being
 * removed:
 *
 *   1. `app.set('env', 'production')` in `server.ts` — Express renders the HTML
 *      stack page from `finalhandler` only when its own env is not production, so
 *      this closes it regardless of what `NODE_ENV` happens to be in a shell.
 *   2. An error middleware registered before any route can throw.
 *   3. **This file.** Every outbound string passes {@link scrub}, so even a hint
 *      authored by a rules module cannot carry a path or a version out.
 *
 * Layer 3 exists because layers 1 and 2 only cover *thrown* errors. The hints in
 * this game are authored by the rules layer (`src/world/result.ts`) and are
 * deliberately chatty; one `${error}` interpolated into one hint would put a stack
 * frame into a 200 response, where no error handler will ever see it.
 *
 * **No secret ever appears in an outbound artifact** (SEC-9). Nothing here reads
 * the environment, and `scrub` redacts anything shaped like a key or a token.
 */

/** The refusal envelope. One shape for every non-2xx body this API produces. */
export interface WireRefusal {
  readonly ok: false;
  /**
   * A closed-set machine reason. The probe harness aggregates
   * `rejections_by_reason` (TESTING.md §16), which only works if this is closed
   * and `detail` is the only thing that varies.
   */
  readonly reason: string;
  /** One sentence for the agent. Scrubbed. */
  readonly detail: string;
}

/**
 * Reasons this layer can refuse for, as opposed to the identity module's
 * {@link import('../identity/index.js').SignatureRejection} (which it passes
 * through verbatim, because agent.md promises those spellings).
 *
 * Lower-case would be friendlier and is deliberately not used: these travel in
 * the same `reason` field as the signature reasons, and two casing conventions in
 * one field is a second spelling of one concept.
 */
export const WIRE_REASON = {
  BODY_TOO_LARGE: 'BODY_TOO_LARGE',
  BODY_NOT_JSON: 'BODY_NOT_JSON',
  BODY_NOT_OBJECT: 'BODY_NOT_OBJECT',
  BODY_TOO_DEEP: 'BODY_TOO_DEEP',
  FIELD_MISSING: 'FIELD_MISSING',
  FIELD_MALFORMED: 'FIELD_MALFORMED',
  NO_SUCH_ROUTE: 'NO_SUCH_ROUTE',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  RATE_LIMITED: 'RATE_LIMITED',
  CLIENT_IP_UNVERIFIED: 'CLIENT_IP_UNVERIFIED',
  SEATS_FULL: 'SEATS_FULL',
  ALREADY_ENROLLED: 'ALREADY_ENROLLED',
  HANDLE_TAKEN: 'HANDLE_TAKEN',
  NOT_ENROLLED: 'NOT_ENROLLED',
  SEAT_RECYCLED: 'SEAT_RECYCLED',
  WORLD_PAUSED: 'WORLD_PAUSED',
  UNHEALTHY: 'UNHEALTHY',
  INTERNAL: 'INTERNAL',
} as const;

export type WireReason = (typeof WIRE_REASON)[keyof typeof WIRE_REASON];

/** Maximum characters of any outbound detail. Bounded (INV-26, scar #3). */
export const MAX_DETAIL_LENGTH = 480;

/**
 * Patterns that must never leave this process. Ordered most-specific first, since
 * each is applied in turn and an earlier redaction shortens the work of the next.
 *
 * The list is deliberately conservative about what it keeps: a path is never
 * useful to an agent, and a version number is never useful to anyone but an
 * attacker enumerating known CVEs.
 */
const REDACTIONS: readonly (readonly [RegExp, string])[] = Object.freeze([
  // Anything shaped like a credential, first: a secret inside a path must not
  // survive because the path matcher rewrote the line around it (SEC-9).
  [/\b(?:sk|pk|api[_-]?key|secret|token|password|bearer)[-_=: ]+[A-Za-z0-9_\-./+]{8,}/gi, '[redacted]'],
  // Stack frames — and the pattern is **narrow on purpose**.
  //
  // The first version was `/\n?\s*at\s+[^\n]*/g`, which is the obvious spelling and
  // it silently destroyed agent-facing text: the seat-full hint reads "the next seat
  // becomes recyclable **at tick 1152**. Enrolment is free and stays free…", and the
  // greedy pattern deleted everything from " at " to the end of the line. The refusal
  // still looked plausible, still parsed, still had a reason — and had lost the half
  // that told the caller what would change. A scrubber that quietly eats a rules
  // surface is worse than the leak it prevents, because nothing fails.
  //
  // So a frame must look like a frame: `at`, an optional function name, and a
  // location with a line and a column. Prose can say "at tick 12" all it likes.
  [/\n?\s*\bat\s+(?:async\s+)?(?:[\w$.<>[\]]+\s+)?\(?(?:file:\/\/|\/|[A-Za-z]:\\)[^\s)]*:\d+:\d+\)?/g, ''],
  // The bare `(/x/y.ts:1:2)` tail form, which V8 emits for anonymous frames.
  [/\((?:file:\/\/)?[^\s)]*:\d+:\d+\)/g, ''],
  // file:// and absolute POSIX paths under the directories a deploy actually uses.
  [/file:\/\/\S*/g, '[path]'],
  [/(?:^|[\s"'(])(\/(?:Users|home|opt|srv|var|usr|private|tmp|etc|root)\/[^\s"')]*)/g, ' [path]'],
  // Windows paths, because a developer machine is also a leak.
  [/[A-Za-z]:\\[^\s"')]*/g, '[path]'],
  // node_modules is a version-and-dependency map even without a version string.
  [/\S*node_modules\S*/g, '[path]'],
  // Semantic versions, with or without a leading v.
  //
  // Fenced on BOTH sides against a longer dotted run, because an IPv4 address is a
  // dotted quad and `\b` alone matched inside one: `127.0.0.1` came out as
  // `[version].1`. That is not hypothetical — it corrupted two agent-facing rules
  // surfaces at once. The `RATE_LIMITED` hint reads "too many enroll requests from
  // …", naming the caller's own address, on the endpoint a newcomer meets first; and
  // a `SIGNATURE_INVALID` diagnostic echoes the `"@authority"` line of the signature
  // base, which exists to be diffed byte for byte and is useless if we mangle it.
  // Production's authority is a hostname, which is why this survived a live deploy.
  //
  // Same class as the stack-frame pattern below it: a scrubber that quietly eats a
  // rules surface is worse than the leak it prevents, because nothing fails.
  [/(?<![\d.])v?\d+\.\d+\.\d+(?:-[\w.]+)?(?![\d.])/g, '[version]'],
  // Node's own banner shape, e.g. "node:internal/modules".
  [/\bnode:[a-z_/]+/g, '[internal]'],
]);

/**
 * Make a string safe to send to an agent.
 *
 * Idempotent and total: it never throws, and it always returns a bounded string,
 * because it runs on the error path and a scrubber that can fail is a scrubber
 * that hands the raw text to the fallback.
 */
export function scrub(text: unknown): string {
  return scrubTo(text, MAX_DETAIL_LENGTH);
}

/**
 * The same scrub, with the length bound as a parameter.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE BOUND IS A PARAMETER BECAUSE CHUNKING IS NOT AN ALTERNATIVE.**
 *
 * A caller that needs a longer bound than `MAX_DETAIL_LENGTH` — `/discrepancy` stores
 * 2000 characters — cannot get there by slicing the text into sub-480 pieces and
 * scrubbing each. That was tried, and it broke this function's first and most
 * important rule in two ways:
 *
 *   1. **A redaction split in half stops matching.** `token=SUPERSECRETVALUE123456`
 *      straddling a chunk boundary became `token=SUPE` + `RSECRETVALUE123456`, neither
 *      of which matches the credential pattern — so the secret was stored *verbatim*
 *      by the one function whose job is to remove it. The pattern is deliberately
 *      first in {@link REDACTIONS} for exactly this reason.
 *   2. **Every chunk boundary injected a space**, because the pieces had to be
 *      rejoined. A venture id or a `terms_hash` straddling the boundary came out cut
 *      in half — in a discrepancy report, which is the record an operator greps when
 *      an agent says a default was recorded against it wrongly.
 *
 * So: one pass over the whole string, one bound, chosen by the caller.
 * ══════════════════════════════════════════════════════════════════════════
 */
export function scrubTo(text: unknown, limit: number): string {
  let s: string;
  try {
    s = typeof text === 'string' ? text : String(text);
  } catch {
    return 'unprintable';
  }
  for (const [pattern, replacement] of REDACTIONS) {
    s = s.replace(pattern, replacement);
  }
  // Collapse the whitespace the frame stripper leaves behind.
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length === 0) return 'no detail';
  return s.length > limit ? `${s.slice(0, limit - 1)}…` : s;
}

export function refusal(reason: string, detail: string): WireRefusal {
  return { ok: false, reason, detail: scrub(detail) };
}

/**
 * Parse a request body without ever letting the parser's own error text out.
 *
 * We take the raw bytes and parse here rather than using `express.json()`,
 * for two reasons that both matter:
 *
 *   - RFC 9421 signs a **`Content-Digest` over the exact bytes**. A body parser
 *     that hands us an object has already thrown the bytes away, and
 *     re-serialising to check the digest is a second, disagreeing spelling of the
 *     message (the very ambiguity `httpsig.ts` refuses to allow).
 *   - `express.json()`'s failure is an exception whose message includes the
 *     offending text and, in some versions, a position and a file. Catching it in
 *     an error middleware works; not generating it is better.
 */
export interface ParsedBody {
  readonly bytes: Uint8Array;
  readonly json: Readonly<Record<string, unknown>>;
}

/** Deepest object nesting accepted in a body (SEC-6: deep nesting is a DoS). */
export const MAX_BODY_DEPTH = 12;

export function parseBody(
  bytes: Uint8Array,
  maxBytes: number,
): { readonly ok: true; readonly value: ParsedBody } | { readonly ok: false; readonly refusal: WireRefusal } {
  if (bytes.length > maxBytes) {
    return {
      ok: false,
      refusal: refusal(
        WIRE_REASON.BODY_TOO_LARGE,
        `the body is ${String(bytes.length)} bytes; the cap is ${String(maxBytes)}. Send one act batch, not a season.`,
      ),
    };
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return {
      ok: false,
      refusal: refusal(WIRE_REASON.BODY_NOT_JSON, 'the body is not valid UTF-8.'),
    };
  }
  if (text.trim().length === 0) {
    return {
      ok: false,
      refusal: refusal(WIRE_REASON.BODY_NOT_JSON, 'the body is empty; send a JSON object.'),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Deliberately not the parser's message: it quotes the input, and the input is
    // attacker-chosen. The agent already knows what it sent.
    return {
      ok: false,
      refusal: refusal(WIRE_REASON.BODY_NOT_JSON, 'the body is not valid JSON.'),
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      refusal: refusal(
        WIRE_REASON.BODY_NOT_OBJECT,
        'the body must be a JSON object, not an array or a bare value.',
      ),
    };
  }
  const depth = depthOf(parsed, 0);
  if (depth > MAX_BODY_DEPTH) {
    return {
      ok: false,
      refusal: refusal(
        WIRE_REASON.BODY_TOO_DEEP,
        `the body nests ${String(depth)} levels deep; the cap is ${String(MAX_BODY_DEPTH)}.`,
      ),
    };
  }
  return { ok: true, value: { bytes, json: parsed as Record<string, unknown> } };
}

/**
 * Depth, computed iteratively.
 *
 * A recursive version is the obvious spelling and it is a stack-overflow DoS on a
 * deeply nested body — the crash happens *before* the depth check that exists to
 * prevent it, which is the same shape as a guard that runs after the damage.
 */
function depthOf(root: unknown, _unused: number): number {
  let deepest = 0;
  const stack: { readonly value: unknown; readonly depth: number }[] = [{ value: root, depth: 1 }];
  let examined = 0;
  while (stack.length > 0) {
    const top = stack.pop();
    if (top === undefined) break;
    if (top.depth > deepest) deepest = top.depth;
    // Bounded work: stop as soon as the answer is "too deep", so a hostile body
    // cannot make the check itself expensive.
    if (deepest > MAX_BODY_DEPTH) return deepest;
    examined += 1;
    if (examined > 20_000) return deepest;
    const value = top.value;
    if (Array.isArray(value)) {
      for (const item of value) stack.push({ value: item, depth: top.depth + 1 });
    } else if (typeof value === 'object' && value !== null) {
      for (const key of Object.keys(value)) {
        stack.push({ value: (value as Record<string, unknown>)[key], depth: top.depth + 1 });
      }
    }
  }
  return deepest;
}

// ── Field readers ───────────────────────────────────────────────────────────

/** A bounded string field, or a refusal naming it. Never a coerced number. */
export function readStringField(
  body: Readonly<Record<string, unknown>>,
  field: string,
  maxLength: number,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly refusal: WireRefusal } {
  const raw = body[field];
  if (raw === undefined || raw === null) {
    return { ok: false, refusal: refusal(WIRE_REASON.FIELD_MISSING, `'${field}' is required.`) };
  }
  if (typeof raw !== 'string') {
    return {
      ok: false,
      refusal: refusal(WIRE_REASON.FIELD_MALFORMED, `'${field}' must be a string.`),
    };
  }
  if (raw.length === 0 || raw.length > maxLength) {
    return {
      ok: false,
      refusal: refusal(
        WIRE_REASON.FIELD_MALFORMED,
        `'${field}' must be 1..${String(maxLength)} characters.`,
      ),
    };
  }
  return { ok: true, value: raw };
}

/** An optional integer field. `undefined` means absent, never zero. */
export function readIntField(
  body: Readonly<Record<string, unknown>>,
  field: string,
): { readonly ok: true; readonly value: number | undefined } | { readonly ok: false; readonly refusal: WireRefusal } {
  const raw = body[field];
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) {
    return {
      ok: false,
      refusal: refusal(WIRE_REASON.FIELD_MALFORMED, `'${field}' must be an integer.`),
    };
  }
  return { ok: true, value: raw };
}
