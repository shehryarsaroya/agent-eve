/**
 * The wire, and the one rule that outranks everything else in this directory.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **NO KEY VALUE MAY EVER LEAVE THIS FILE.**
 *
 * The key is read from `process.env['OPENAI_API_KEY']` at one place, held in one
 * closure, and written into exactly one header. It is never returned, never stored on
 * an object a caller can reach, never interpolated into a message, and never logged.
 * Everything this module hands back to a caller — including every error — goes through
 * {@link redactSecrets} first, because the interesting failure is not "somebody printed
 * the key on purpose" but "a 401 body echoed the Authorization header into an error
 * string that got written to the journal".
 *
 * `redactSecrets` is belt *and* braces: it redacts the live key by literal match **and**
 * anything key-shaped, so a key that arrives from somewhere this module never saw — a
 * proxy's error body, a mis-set second variable — is redacted too.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **The transport is an interface because the tests must not touch the network.** The
 * whole cast is tested against a mock; there is no test in this repo that requires a
 * live key or an outbound request, and there must never be one — a suite that needs
 * quota is a suite that goes red for reasons that have nothing to do with the code.
 */

import { ticksToMs } from '../core/time.js';

/** What is sent. Deliberately small: a bigger surface is a bigger thing to mock. */
export interface CompletionRequest {
  readonly model: string;
  /**
   * Ordered messages. The **first** is the stable one (the player contract), so a
   * provider that caches identical prefixes can. Never relied on: see
   * `budget.ts`, which prices every call at full rate.
   */
  readonly messages: readonly CompletionMessage[];
  /** Hard cap on the reply. The budget's per-call ceiling, not a suggestion. */
  readonly maxOutputTokens: number;
  /** Cancelled when the cast gives up on this call. Optional so a mock can ignore it. */
  readonly signal?: AbortSignal;
}

export interface CompletionMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

export interface CompletionReply {
  /** The model's text. Never trusted; `parse.ts` is the only thing that reads it. */
  readonly text: string;
  /**
   * Tokens as the provider reported them, or `null` when it reported none.
   *
   * Null is not zero, and the budget must not treat it as zero — an un-metered call
   * is how a spend cap silently stops capping. `budget.ts` estimates from characters
   * when this is null and marks the estimate as such.
   */
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  /**
   * Input tokens the provider served from its prompt cache, or null if it said nothing.
   *
   * These are billed at a large discount, and for this cast they dominate: the player
   * contract is ~6.5k tokens, is the FIRST message, and is byte-identical for every one
   * of the 20 members, so after the first call of a Reckoning essentially the whole
   * prefix is a cache hit. Measured live against gpt-5.6-luna: 6498 of 6543 prompt
   * tokens cached, i.e. 99%. Pricing those at full rate makes the spend cap trip several
   * times earlier than real spend, which does not overspend but does cut the cast off
   * long before the money is gone.
   */
  readonly cachedInputTokens: number | null;
}

export interface CastTransport {
  complete(request: CompletionRequest): Promise<CompletionReply>;
}

/** What a redacted secret is replaced with. One spelling, so a test can grep for it. */
export const REDACTED = '[redacted]';

/**
 * Remove anything that could be a credential.
 *
 * Three passes, in this order:
 *
 *   1. **The live key, by literal match.** Read from the environment at call time and
 *      never retained. `split`/`join` rather than a `RegExp`, because a key containing
 *      a regex metacharacter would otherwise be matched wrongly or not at all.
 *   2. **Anything key-shaped.** `sk-…`, `sess-…`, and OpenAI's project/org prefixes.
 *      This is what catches a key this process never held.
 *   3. **Bearer tokens and Authorization headers**, whatever their shape, because an
 *      error body that echoes a request header is the common leak.
 *
 * Cheap enough to run on every string that leaves the module, which is the point: a
 * redactor you have to remember to call is a redactor that will be forgotten once.
 */
export function redactSecrets(text: string): string {
  let out = text;
  const key = process.env['OPENAI_API_KEY'];
  if (typeof key === 'string' && key.length >= 8) out = out.split(key).join(REDACTED);
  out = out.replace(/\b(?:sk|sess|rk)-[A-Za-z0-9_-]{6,}/g, REDACTED);
  out = out.replace(/\b(bearer)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${REDACTED}`);
  out = out.replace(/\b(authorization)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, `$1$2${REDACTED}`);
  return out;
}

/**
 * A redacted, bounded, single-line message for any thrown thing.
 *
 * Bounded because a provider error body can be a whole HTML page, and an unbounded
 * string copied into a log line every failed call is scar #3 through the error path.
 */
export function describeFailure(error: unknown, maxChars = 240): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const flat = redactSecrets(raw).replace(/\s+/g, ' ').trim();
  return flat.length <= maxChars ? flat : `${flat.slice(0, maxChars)}…`;
}

/**
 * Raised by {@link openAiTransport}. Its message is redacted before it is constructed.
 *
 * ── WHY {@link reachedProvider} IS ITS OWN FIELD AND NOT `status !== null` ──
 *
 * The budget refunds a charge for a call that **cannot be on an invoice**, and it used to
 * infer that from "there is no HTTP status". That inference is wrong in the direction that
 * costs money: a 200 whose body will not parse — OpenAI's refusal shape is
 * `{choices:[{message:{content:null, refusal:"…"}}]}`, and a proxy returning HTML with a
 * 200 is the other — has **no** status by the time it is raised (it is built inside
 * {@link readReply}, which never sees the response), and yet the provider generated and
 * billed it. Under that inference the whole cast can run indefinitely with the cumulative
 * cap reading `$0.00`: measured at 96 billed calls, `spentMicros: 0`, cap never tripped.
 *
 * So the question the budget actually needs answered — *did this request reach a provider
 * that could bill for it?* — is stored, not derived. It defaults to `status !== null`,
 * which is right for every call site that has a status, and {@link openAiTransport}
 * re-stamps the parse failures it catches with the status the response really carried.
 * An abort is charged deliberately: the request went out, so it may well be billed, and
 * under-counting real spend is the dangerous direction.
 */
export class CastTransportError extends Error {
  /** True when a provider answered — or may have — so this call may be on an invoice. */
  readonly reachedProvider: boolean;

  constructor(
    message: string,
    /** HTTP status, when there was one. `null` for a network or parse failure. */
    readonly status: number | null,
    reachedProvider?: boolean,
  ) {
    super(redactSecrets(message));
    this.name = 'CastTransportError';
    this.reachedProvider = reachedProvider ?? status !== null;
  }
}

/** The model the cast runs on. Decided; overridden only by `COMPACT_CAST_MODEL`. */
export const DEFAULT_CAST_MODEL = 'gpt-5.6-luna';

/** The one endpoint. Overridable so a test or a proxy can point it elsewhere. */
export const OPENAI_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

export interface OpenAiTransportOptions {
  readonly url?: string;
  /**
   * How long a call may run, **in ticks**.
   *
   * In ticks and not in milliseconds because DET-8 fails the build on a bare duration:
   * at 30× compression a "30 second" timeout is three game-ticks at `fast` and ninety
   * at `prod`, and the failure presents as the cast mysteriously under-performing at
   * one speed. Converted at the call site with `ticksToMs`, and skipped entirely at
   * `instant`, where a tick has no wall-clock length to derive from.
   */
  readonly deadlineTicks?: number;
  /** Injected so a test can drive the transport without a global. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * The real transport. **Not exercised by any test in this repo** — see the module note.
 *
 * It reads the key lazily, on each call, rather than at construction: an operator who
 * rotates the key does not have to restart the world, and a cast constructed before the
 * environment was loaded does not silently hold `undefined` forever.
 */
export function openAiTransport(options: OpenAiTransportOptions = {}): CastTransport {
  const url = options.url ?? OPENAI_COMPLETIONS_URL;
  const deadlineTicks = options.deadlineTicks ?? 0;
  const doFetch = options.fetchImpl ?? fetch;

  return {
    async complete(request: CompletionRequest): Promise<CompletionReply> {
      const key = process.env['OPENAI_API_KEY'];
      if (typeof key !== 'string' || key.length === 0) {
        // Says the variable's NAME and nothing about its value. The absence of a key is
        // the only fact about a key this codebase is ever allowed to state.
        throw new CastTransportError('OPENAI_API_KEY is not set', null);
      }

      const controller = new AbortController();
      const budgetMs = deadlineTicks > 0 ? ticksToMs(deadlineTicks) : 0;
      const timer =
        budgetMs > 0
          ? setTimeout(() => {
              controller.abort();
            }, budgetMs)
          : null;
      // An outer signal (the cast giving up, or shutdown) cancels the inner one too.
      const onOuterAbort = (): void => {
        controller.abort();
      };
      request.signal?.addEventListener('abort', onOuterAbort, { once: true });

      // The status the provider actually answered with, once it has. Everything thrown
      // after this is set is a call that may be on an invoice — see CastTransportError.
      let answered: number | null = null;
      // Set the instant the request leaves. An abort after this point may still have been
      // generated and billed server-side, so it is charged rather than refunded.
      let dispatched = false;

      try {
        dispatched = true;
        const response = await doFetch(url, {
          method: 'POST',
          headers: {
            // The one place the key is used. Never read back off this object.
            authorization: `Bearer ${key}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: request.model,
            messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
            // GPT-5-family chat completions take `max_completion_tokens`; `max_tokens`
            // is the legacy spelling and is rejected. Temperature is deliberately absent
            // — the default is the only value some tiers accept.
            max_completion_tokens: request.maxOutputTokens,
            response_format: { type: 'json_object' },
          }),
          signal: controller.signal,
        });

        answered = response.status;

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new CastTransportError(
            `completions returned ${String(response.status)}: ${body.slice(0, 200)}`,
            response.status,
          );
        }

        const payload: unknown = await response.json();
        return readReply(payload);
      } catch (error: unknown) {
        if (error instanceof CastTransportError) {
          // `readReply` raises with `status: null` because it is handed a payload and
          // never sees the response. Re-stamp it here, where the status is known: a 200
          // we could not read is still a 200 the provider billed for.
          if (answered !== null && !error.reachedProvider) {
            throw new CastTransportError(error.message, answered, true);
          }
          throw error;
        }
        // A `json()` that threw, a socket that died, an abort. The split that matters:
        //
        //   - **A connection failure** (DNS, ECONNREFUSED, TLS) means no bytes reached a
        //     provider. Refundable — and it must stay refundable, or a world whose network
        //     is down latches its own cumulative cap having spent nothing.
        //   - **An abort** means the request went out and we stopped waiting. The provider
        //     may well have finished generating and billed it, so it is charged. This is
        //     the routine case at a 3-tick deadline, and refunding it was the second half
        //     of the hole that let 96 billed calls report `spentMicros: 0`.
        const billable = answered !== null || (dispatched && isAbort(error));
        throw new CastTransportError(describeFailure(error), answered, billable);
      } finally {
        if (timer !== null) clearTimeout(timer);
        request.signal?.removeEventListener('abort', onOuterAbort);
      }
    },
  };
}

/**
 * Was this failure the request being cancelled, rather than the network refusing it?
 *
 * `AbortError` is what both `AbortController` and an undici timeout raise, as a
 * `DOMException` in some runtimes and an `Error` in others — so the name is checked
 * rather than the type. `TimeoutError` is undici's newer spelling for the same thing.
 */
function isAbort(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * Read a chat-completions payload defensively.
 *
 * Exported because it is the half of the transport that *can* be tested without a
 * network: the shape it accepts is a contract with the provider, and a provider that
 * changes it should fail here with a named error rather than deep inside the cast.
 */
export function readReply(payload: unknown): CompletionReply {
  if (typeof payload !== 'object' || payload === null) {
    throw new CastTransportError('completions reply was not an object', null);
  }
  const root = payload as Record<string, unknown>;
  const choices = root['choices'];
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new CastTransportError('completions reply carried no choices', null);
  }
  const first: unknown = choices[0];
  const message =
    typeof first === 'object' && first !== null
      ? (first as Record<string, unknown>)['message']
      : undefined;
  const content =
    typeof message === 'object' && message !== null
      ? (message as Record<string, unknown>)['content']
      : undefined;
  if (typeof content !== 'string') {
    throw new CastTransportError('completions reply carried no text content', null);
  }

  // An EMPTY reply is a failure, and which failure matters enough to say out loud.
  //
  // The GPT-5 tiers are reasoning models, and their reasoning tokens are spent out of
  // `max_completion_tokens`. So a cap that is too low does not truncate the answer — the
  // model reasons until the budget is gone and returns `finish_reason: 'length'` with
  // **empty content and HTTP 200**. Measured on gpt-5.6-luna with one small prompt:
  //
  //     cap=200  -> finish=length  reasoning=200  content=""
  //     cap=400  -> finish=stop    reasoning=200  content=207 chars
  //     cap=1200 -> finish=stop    reasoning=113  content=159 chars
  //
  // Returned as a bare empty string this is indistinguishable from a model that answered
  // with nothing: `parse.ts` rejects it, the member falls back to its heuristic, and the
  // world looks healthy while no LIVE decision is ever made — a misconfiguration wearing a
  // model failure's clothes, which is scar #14b's shape. Raising here makes the operator
  // read the one sentence that fixes it. Found by making a real API call; the builder
  // could not, because the key had no quota at the time.
  if (content.length === 0) {
    const finish =
      typeof first === 'object' && first !== null
        ? (first as Record<string, unknown>)['finish_reason']
        : undefined;
    if (finish === 'length') {
      throw new CastTransportError(
        'the model spent its whole completion budget on reasoning and returned no text ' +
          '(finish_reason=length). Raise COMPACT_CAST_MAX_OUTPUT_TOKENS — it must cover ' +
          'reasoning tokens AND the answer, not just the answer.',
        null,
      );
    }
    throw new CastTransportError(
      `completions reply was empty (finish_reason=${String(finish ?? 'absent')})`,
      null,
    );
  }

  const usage = root['usage'];
  const readNested = (group: string, name: string): number | null => {
    if (typeof usage !== 'object' || usage === null) return null;
    const inner = (usage as Record<string, unknown>)[group];
    if (typeof inner !== 'object' || inner === null) return null;
    const value = (inner as Record<string, unknown>)[name];
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const readCount = (name: string): number | null => {
    if (typeof usage !== 'object' || usage === null) return null;
    const value = (usage as Record<string, unknown>)[name];
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  };

  return {
    text: content,
    inputTokens: readCount('prompt_tokens'),
    outputTokens: readCount('completion_tokens'),
    cachedInputTokens: readNested('prompt_tokens_details', 'cached_tokens'),
  };
}
