/**
 * The money. Enforced in code, not in a runbook.
 *
 * The arithmetic that makes this necessary: twelve members × sixteen wakes × an ~8k-token
 * observation is ~1.5M input tokens per Reckoning. At `gpt-5.6-luna`'s $1/1M in and
 * $6/1M out that is roughly $1.50–2 a Reckoning, and a Reckoning at `fast` is 48 minutes
 * — so a world left running is about $2 an hour, and a world left running over a weekend
 * with a bug in the wake trigger is not.
 *
 * So there are **three** caps and they are independent, because each catches a different
 * way of spending money you did not mean to:
 *
 *   1. **Calls per Reckoning.** Catches a wake trigger that fires every tick. This one is
 *      a *rate* cap, and it is the only one that resets.
 *   2. **Output tokens per call.** Catches a model that answers a request for one JSON
 *      object with an essay. Sent on the request, so the provider enforces it too.
 *   3. **Cumulative spend.** Catches everything else, including the case the other two
 *      cannot see: a correct cast running correctly for longer than anybody intended.
 *      This one **never resets** — it is the total for the process — and when it trips the
 *      LLM cast is **disabled for good** and the world falls back to heuristics.
 *
 * ── EVERY FIGURE IS AN INTEGER NUMBER OF MICRO-DOLLARS ──
 *
 * A float here would be a float in a number that gates spending, and `0.1 + 0.2` is the
 * canonical demonstration of why the whole engine bans them in value paths. A micro-dollar
 * is 1/1,000,000 of a dollar, which makes `gpt-5.6-luna` exactly 1 micro-dollar per input
 * token and 6 per output token — no rounding at all at the default prices.
 *
 * ── THE ESTIMATE IS AN ESTIMATE, AND IT SAYS SO ──
 *
 * When a provider reports `usage`, the count is exact. When it does not, the count is
 * derived from characters at {@link CHARS_PER_TOKEN}, which is a rule of thumb and will be
 * wrong — so it is deliberately biased **high** (`ceil`), and {@link CastBudget.report}
 * says how many calls were estimated rather than measured. A spend cap that silently
 * treats an unmetered call as free is a spend cap that does not cap.
 */

/** Micro-dollars in a dollar. Named so the arithmetic reads. */
const MICROS_PER_DOLLAR = 1_000_000;

/** Tokens are priced per million; this is that million. */
const TOKENS_PER_PRICE_UNIT = 1_000_000;

/**
 * Characters per token when the provider reported no usage. *(calibrate)*
 *
 * Four is the usual English rule of thumb and JSON is denser than English, so this
 * under-counts tokens for an observation — which is why the caller rounds up and why the
 * report distinguishes measured calls from estimated ones.
 */
export const CHARS_PER_TOKEN = 4;

export interface CastBudgetLimits {
  /** Maximum LLM calls, whole cast, per Reckoning. Resets on the Reckoning boundary. */
  readonly callsPerReckoning: number;
  /** Maximum tokens in one reply. Also sent to the provider on the request. */
  readonly maxOutputTokens: number;
  /**
   * Ceiling on the **observation JSON** inside a prompt, in characters.
   *
   * Named for the prompt and applied to the observation, which is worth stating plainly
   * because the difference is most of the bill: `llm.ts` passes this as
   * `buildPrompt`'s `maxObservationChars`, and the `agent.md` contract excerpt (25k–38k
   * depending on the wake — `prompt.ts:CONTRACT_CATALOG`) and the character brief sit
   * outside it. Setting this to 2,000 measurably yields a ~26,400-character prompt, not a
   * 2,000-character one.
   *
   * That is deliberate rather than an oversight to fix: the contract is the rules
   * surface, and scar #1 is what happens when a player reasons from a partial copy of
   * the rules — the excerpt would rather drop whole named sections and say so
   * ({@link MAX_CONTRACT_CHARS}) than have a byte budget quietly shave it. Cost is
   * still counted honestly either way: `charge()` prices the prompt that was actually
   * built, so a prompt over this figure is billed at what it really costs.
   */
  readonly maxPromptChars: number;
  /** Cumulative, for the life of the process. Tripping this disables the LLM cast. */
  readonly spendCapMicros: number;
  /** Micro-dollars per million input tokens. `gpt-5.6-luna`: $1 → 1,000,000. */
  readonly inputMicrosPerMillion: number;
  /** Micro-dollars per million output tokens. `gpt-5.6-luna`: $6 → 6,000,000. */
  readonly outputMicrosPerMillion: number;
  /**
   * Micro-dollars per million input tokens the provider served from its prompt cache.
   *
   * This matters more than it looks. The player contract is the first message, and it opens
   * with a ~5.2k-token floor that is byte-identical for all 20 members, so once it is warm
   * essentially the whole prompt is a cache hit — measured live at 6498/6543 tokens, 99%,
   * before per-wake section selection landed. Charging those at full input price does not
   * overspend, but it makes the cumulative cap trip several times earlier than the real
   * invoice, which cuts the cast off while the money is still there. Default is a tenth of
   * the input rate. See `transport.ts:cachedInputTokens` for what selection changed.
   */
  readonly cachedInputMicrosPerMillion: number;
}

/**
 * Conservative defaults, in the sense that matters: **an operator who turns the cast on
 * and forgets about it spends a bounded amount and then gets heuristics.**
 *
 *   - 200 calls per Reckoning is a little over the 192 that twelve members at sixteen
 *     wakes can legitimately want, so the rate cap does not bind in normal operation and
 *     does bind hard on a runaway.
 *   - $5.00 total is roughly two to three Reckonings. It is meant to be raised
 *     deliberately by an operator watching the spend, not to be a working ceiling.
 */
export const DEFAULT_CAST_LIMITS: CastBudgetLimits = Object.freeze({
  callsPerReckoning: 200,
  // Must cover REASONING TOKENS PLUS the answer, not just the answer. The GPT-5 tiers
  // spend reasoning out of `max_completion_tokens`, and a cap that is too low returns
  // HTTP 200 with EMPTY content rather than a short answer. Measured on gpt-5.6-luna:
  // a cap of 200 was entirely consumed by reasoning (finish_reason=length, no text),
  // while the same prompt used 113–200 reasoning tokens run to run. 400 left almost no
  // margin over observed reasoning alone, so a harder decision would have silently
  // produced nothing and fallen back to heuristics forever. 1500 is ~10x the observed
  // answer and comfortably clears the reasoning. At $6/1M output that is $0.009 worst
  // case per call, and calls are charged at worst case before they are made.
  maxOutputTokens: 1500,
  maxPromptChars: 24_000,
  spendCapMicros: 5 * MICROS_PER_DOLLAR,
  inputMicrosPerMillion: 1 * MICROS_PER_DOLLAR,
  cachedInputMicrosPerMillion: MICROS_PER_DOLLAR / 10,
  outputMicrosPerMillion: 6 * MICROS_PER_DOLLAR,
});

/** Why a call was refused. Closed set, so the log line is greppable. */
export type BudgetRefusal = 'SPEND_CAP' | 'CALL_RATE';

export type BudgetVerdict = { readonly ok: true } | { readonly ok: false; readonly why: BudgetRefusal };

export interface CastSpendReport {
  readonly calls: number;
  readonly callsThisReckoning: number;
  readonly spentMicros: number;
  readonly capMicros: number;
  /** Calls whose token counts were guessed from characters rather than reported. */
  readonly estimatedCalls: number;
  readonly disabled: boolean;
  readonly disabledWhy: BudgetRefusal | null;
}

export class CastBudget {
  private readonly limits: CastBudgetLimits;
  private reckoning = -1;
  private inReckoning = 0;
  private calls = 0;
  private estimated = 0;
  private spent = 0;
  private stopped: BudgetRefusal | null = null;

  constructor(limits: Partial<CastBudgetLimits> = {}) {
    this.limits = { ...DEFAULT_CAST_LIMITS, ...limits };
  }

  get caps(): CastBudgetLimits {
    return this.limits;
  }

  /**
   * True once the cumulative cap has tripped.
   *
   * **Latching**, with exactly one exception. Neither a new Reckoning nor a downward
   * {@link settle} clears it: the cap trips on *reserved* spend, which is deliberately
   * pessimistic, and a cap that flickers as estimates are corrected is not a cap. A cap
   * that un-trips on the next Reckoning is a rate limit wearing a spend cap's name.
   *
   * The exception is {@link refund}, and it is not a loophole: a refund reverses a charge
   * for a call that **provably never reached the provider**, so the money was never spent
   * and the line was never actually crossed. Without it, a world misconfigured with no key
   * would disable its cast permanently after a few Reckonings of spending nothing at all.
   */
  get disabled(): boolean {
    return this.stopped === 'SPEND_CAP';
  }

  get spentMicros(): number {
    return this.spent;
  }

  /**
   * Roll the per-Reckoning counter.
   *
   * Called at the top of every tick rather than lazily on first use, for the reason
   * `WakeBook` gives for the same choice: a counter that rolls on use gives a member that
   * acted early in a Reckoning a different allowance from one that acted late.
   */
  rollTo(reckoningIndexNow: number): void {
    if (reckoningIndexNow === this.reckoning) return;
    this.reckoning = reckoningIndexNow;
    this.inReckoning = 0;
    // `stopped` is NOT cleared here when it is SPEND_CAP: see `disabled`. A CALL_RATE
    // stop is a per-Reckoning fact and does clear, which is what this line does.
    if (this.stopped === 'CALL_RATE') this.stopped = null;
  }

  /** May one more call be made? Pure: it decides nothing and charges nothing. */
  mayCall(): BudgetVerdict {
    if (this.stopped === 'SPEND_CAP') return { ok: false, why: 'SPEND_CAP' };
    if (this.spent >= this.limits.spendCapMicros) return { ok: false, why: 'SPEND_CAP' };
    if (this.inReckoning >= this.limits.callsPerReckoning) return { ok: false, why: 'CALL_RATE' };
    return { ok: true };
  }

  /**
   * Charge a call **before** it is made, at its worst case.
   *
   * Deliberately pessimistic and deliberately up-front. Charging on the reply would
   * leave an unbounded number of calls in flight against a cap that has not noticed them
   * yet — the classic way a spend cap is overshot by exactly the concurrency. So the
   * prompt is priced from what is about to be sent and the reply is priced at its
   * ceiling; {@link settle} then corrects the estimate downwards when the truth arrives.
   */
  charge(promptChars: number): number {
    this.calls += 1;
    this.inReckoning += 1;
    const inputTokens = Math.ceil(Math.max(0, promptChars) / CHARS_PER_TOKEN);
    const worstCase =
      this.priceInput(inputTokens) + this.priceOutput(this.limits.maxOutputTokens);
    this.spent += worstCase;
    this.checkCap();
    return worstCase;
  }

  /**
   * Replace a call's worst-case charge with what it actually cost.
   *
   * `reserved` is the figure {@link charge} returned. Passing it back rather than
   * remembering it here keeps this class free of per-call state, which is what lets a
   * caller drop a call on the floor (a timeout, a shutdown) without leaking a row.
   */
  settle(
    reserved: number,
    reply: {
      inputTokens: number | null;
      outputTokens: number | null;
      cachedInputTokens?: number | null;
    },
    replyChars: number,
  ): void {
    const measured = reply.inputTokens !== null && reply.outputTokens !== null;
    if (!measured) this.estimated += 1;
    const outputTokens = reply.outputTokens ?? Math.ceil(Math.max(0, replyChars) / CHARS_PER_TOKEN);
    // Input is only corrected when the provider measured it; the character estimate the
    // charge used is the best we have otherwise, and re-deriving it would change nothing.
    const inputTokens = reply.inputTokens;
    // Split the measured input into cached and fresh. `cached` is clamped to the total
    // the provider also reported, so a nonsense pair can never price a call as negative.
    const cached = Math.min(Math.max(0, reply.cachedInputTokens ?? 0), inputTokens ?? 0);
    const fresh = inputTokens === null ? 0 : inputTokens - cached;
    const actual =
      (inputTokens === null ? 0 : this.priceInput(fresh) + this.priceCachedInput(cached)) +
      this.priceOutput(outputTokens);
    if (inputTokens === null) {
      // Only the output half is known: keep the reserved input estimate, swap the output.
      const reservedOutput = this.priceOutput(this.limits.maxOutputTokens);
      this.spent += actual - reservedOutput;
    } else {
      this.spent += actual - reserved;
    }
    if (this.spent < 0) this.spent = 0;
    this.checkCap();
  }

  /**
   * Give back a charge for a call that **never reached the provider**.
   *
   * The only path that can un-trip the cumulative cap, and the reason is in
   * {@link disabled}: this reverses phantom spend, so if the total falls back under the
   * cap then the cap was never genuinely crossed. Caller's contract: only call this when
   * the failure is one that cannot possibly be on an invoice.
   */
  refund(reserved: number): void {
    this.spent = Math.max(0, this.spent - reserved);
    if (this.stopped === 'SPEND_CAP' && this.spent < this.limits.spendCapMicros) {
      this.stopped = null;
    }
  }

  report(): CastSpendReport {
    return {
      calls: this.calls,
      callsThisReckoning: this.inReckoning,
      spentMicros: this.spent,
      capMicros: this.limits.spendCapMicros,
      estimatedCalls: this.estimated,
      disabled: this.disabled,
      disabledWhy: this.stopped,
    };
  }

  /**
   * Trip the cumulative cap if the total has reached it — and never let the total stop
   * being a number.
   *
   * `NaN >= cap` is `false`, forever. So a single non-finite figure reaching {@link spent}
   * would not merely mis-count: it would silently and permanently switch the cumulative
   * cap off, which is the one failure this class exists to prevent. `readReply` already
   * guarantees safe integers, so nothing can reach that state through
   * {@link openAiTransport} — but `CastTransport` is an injectable interface, an
   * unbounded bill is the cost of being wrong about it, and the guard is one comparison.
   * A poisoned total is treated as "at the cap", because the safe reading of *we no
   * longer know what we have spent* is **stop spending**.
   */
  private checkCap(): void {
    if (!Number.isFinite(this.spent)) {
      this.spent = this.limits.spendCapMicros;
      this.stopped = 'SPEND_CAP';
      return;
    }
    if (this.spent >= this.limits.spendCapMicros) this.stopped = 'SPEND_CAP';
  }

  private priceCachedInput(tokens: number): number {
    return Math.trunc((tokens * this.limits.cachedInputMicrosPerMillion) / TOKENS_PER_PRICE_UNIT);
  }

  private priceInput(tokens: number): number {
    return Math.trunc((tokens * this.limits.inputMicrosPerMillion) / TOKENS_PER_PRICE_UNIT);
  }

  private priceOutput(tokens: number): number {
    return Math.trunc((tokens * this.limits.outputMicrosPerMillion) / TOKENS_PER_PRICE_UNIT);
  }
}

/** Micro-dollars as a plain `$0.000000` string, for a log line. Integer arithmetic only. */
export function formatMicros(micros: number): string {
  const whole = Math.trunc(micros / MICROS_PER_DOLLAR);
  const fraction = Math.abs(micros % MICROS_PER_DOLLAR);
  return `$${String(whole)}.${String(fraction).padStart(6, '0')}`;
}
