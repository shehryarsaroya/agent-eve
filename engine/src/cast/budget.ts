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
 *   3. **Spend per window.** Catches everything else, including the case the other two
 *      cannot see: a correct cast running correctly for longer than anybody intended.
 *      Latching *within* its window — once it trips the cast is on heuristics until the
 *      window rolls — and the window is wall-clock, so the figure means what an operator
 *      reading an invoice thinks it means.
 *
 * ── WHY #3 GREW A WINDOW (2026-08-01) ──
 *
 * It used to have none: one cumulative total for the life of the process, latching for
 * good. The argument for that is still in {@link CastBudget.disabled} and it is still
 * right about what it was arguing against — *a cap that un-trips on the next **Reckoning**
 * is a rate limit wearing a spend cap's name*, because a Reckoning is world time and world
 * time is not money.
 *
 * A **wall-clock day** is money. The failure the old shape actually produced, in
 * production, on 2026-07-31: the cast tripped $5.00 after 310 calls seven and a half hours
 * into a fresh world, and then the world ran **thirty-two hours on heuristics** with the
 * site up, frames publishing, and nothing but `/health` saying so. That is not a budget
 * working; that is a budget failing in the direction that hides — the same class of defect
 * this repo keeps re-finding. A daily ceiling bounds the money *and* self-heals, and it is
 * what an operator means by "a hundred a day".
 *
 * Set {@link CastBudgetLimits.spendWindowMs} to `0` to get the old lifetime behaviour back.
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

import type { Clock } from '../core/time.js';

/** Micro-dollars in a dollar. Named so the arithmetic reads. */
const MICROS_PER_DOLLAR = 1_000_000;

/** Milliseconds in an hour, so the window default reads as the day it is. */
const MS_PER_HOUR = 3_600_000;

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
   * `buildPrompt`'s `maxObservationChars`, and the `agent.md` contract excerpt (31k for a
   * newcomer up to 47k for a fully-developed claimant — `prompt.ts:CONTRACT_CATALOG`) and
   * the character brief sit outside it. Setting this to 2,000 measurably yields a
   * ~26,400-character prompt, not a 2,000-character one.
   *
   * That is deliberate rather than an oversight to fix: the contract is the rules
   * surface, and scar #1 is what happens when a player reasons from a partial copy of
   * the rules — the excerpt would rather drop whole named sections and say so
   * ({@link MAX_CONTRACT_CHARS}) than have a byte budget quietly shave it. Cost is
   * still counted honestly either way: `charge()` prices the prompt that was actually
   * built, so a prompt over this figure is billed at what it really costs.
   */
  readonly maxPromptChars: number;
  /** Ceiling on spend inside one {@link spendWindowMs}. Tripping it disables the LLM cast. */
  readonly spendCapMicros: number;
  /**
   * The window {@link spendCapMicros} is measured over, in wall-clock milliseconds.
   *
   * `0` disables the window: the cap becomes cumulative for the life of the process and
   * latches for good, which is what this class did before 2026-08-01.
   *
   * **Tumbling, not sliding**, anchored on the first charge. A sliding window would need a
   * timestamped entry per call and would buy one thing: it would stop an operator spending
   * the cap at 23:59 and again at 00:01. That worst case is bounded at 2× over a few
   * minutes, every provider's own daily limit works this way, and the honest comparison is
   * against the alternative actually on the table — a cap with no window at all, whose
   * worst case is *the world runs on heuristics until somebody notices*. If the burst ever
   * matters, the fix is a ring of `(nowMs, micros)` here and nothing outside this file.
   *
   * **Requires a {@link Clock}.** Construct with one or the window silently cannot roll;
   * the constructor refuses that combination rather than letting it become a lifetime cap
   * wearing a daily cap's name.
   */
  readonly spendWindowMs: number;
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
 *   - **$100 per 24 h** is the working ceiling, set by owner decision on 2026-08-01. It is
 *     roughly six times the measured burn — production spent $5.00 in seven and a half
 *     hours, so ~$16 a day at twelve members — which is headroom enough that it should
 *     never bind in normal operation and still bounds a runaway wake trigger to a number
 *     an operator can absorb noticing a day late.
 *   - The predecessor was **$5.00 for the life of the process**, and raising it is not the
 *     whole change: a lifetime cap that trips is a world on heuristics forever, and that is
 *     what it did. See the header note.
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
  spendCapMicros: 100 * MICROS_PER_DOLLAR,
  spendWindowMs: 24 * MS_PER_HOUR,
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
  /** Spend inside the current window — the figure {@link CastBudgetLimits.spendCapMicros} gates. */
  readonly spentMicros: number;
  readonly capMicros: number;
  /** The window `spentMicros` is measured over, in ms. `0` when the cap is cumulative. */
  readonly windowMs: number;
  /**
   * Ms until the window rolls and a tripped cap clears, or `null` when there is no window
   * (or nothing has been charged yet, so no window has been anchored).
   *
   * On the report on purpose: without it, "the cast is disabled" is the whole story an
   * operator gets, and the follow-up question is always *for how long*.
   */
  readonly windowResetsInMs: number | null;
  /** Process total, across every window. Reporting only — no cap gates this. */
  readonly spentLifetimeMicros: number;
  /** Calls whose token counts were guessed from characters rather than reported. */
  readonly estimatedCalls: number;
  readonly disabled: boolean;
  readonly disabledWhy: BudgetRefusal | null;
}

export class CastBudget {
  private readonly limits: CastBudgetLimits;
  private readonly clock: Clock | null;
  private reckoning = -1;
  private inReckoning = 0;
  private calls = 0;
  private estimated = 0;
  /** Spend inside the current window. This is the figure the cap gates. */
  private spent = 0;
  /** Spend for the life of the process. Reporting only; nothing gates on it. */
  private spentLifetime = 0;
  /** When the current window opened, or `null` before the first charge anchors one. */
  private windowStartMs: number | null = null;
  private stopped: BudgetRefusal | null = null;

  /**
   * @param clock Required whenever `spendWindowMs > 0`. Omitting it is refused rather than
   *   tolerated: a window that cannot read a clock cannot roll, so it would behave exactly
   *   like a lifetime cap while reporting a daily one — and a budget that lies about its
   *   own shape is worse than the shape it lies about. `Date.now` is banned here (DET-7);
   *   production injects `systemClock()` and tests inject `fixedClock()`.
   */
  constructor(limits: Partial<CastBudgetLimits> = {}, clock?: Clock) {
    this.limits = { ...DEFAULT_CAST_LIMITS, ...limits };
    this.clock = clock ?? null;
    if (this.limits.spendWindowMs > 0 && this.clock === null) {
      throw new Error(
        'CastBudget: spendWindowMs > 0 requires a Clock. Pass one, or set spendWindowMs: 0 ' +
          'for a cumulative life-of-process cap.',
      );
    }
  }

  get caps(): CastBudgetLimits {
    return this.limits;
  }

  /**
   * True once the spend cap has tripped.
   *
   * **Latching within its window**, with two exceptions, and the distinction between them
   * is the whole design.
   *
   * Neither a new Reckoning nor a downward {@link settle} clears it. The cap trips on
   * *reserved* spend, which is deliberately pessimistic, and a cap that flickers as
   * estimates are corrected is not a cap. **A cap that un-trips on the next Reckoning is a
   * rate limit wearing a spend cap's name** — a Reckoning is world time, world time runs at
   * whatever `COMPACT_SPEED` says, and money does not.
   *
   * The exceptions are both things that genuinely mean *the line was not crossed*:
   *
   *   1. {@link refund} — reverses a charge for a call that **provably never reached the
   *      provider**, so the money was never spent. Without it, a world misconfigured with
   *      no key would disable its cast permanently after spending nothing at all.
   *   2. {@link rollWindow} — a **wall-clock** window elapsing. This is not the Reckoning
   *      loophole the paragraph above refuses: the sentence there is about world time, and
   *      a day is not world time. $100 in the last 24 h is a claim about an invoice.
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

  /**
   * Roll the spend window if it has elapsed, clearing a `SPEND_CAP` latch with it.
   *
   * Called from {@link mayCall} and {@link charge} rather than from a timer, so the window
   * advances on use. Nothing is spending while nothing is asking, so a window that only
   * moves when asked is indistinguishable from one that moves on its own — and it needs no
   * lifecycle.
   *
   * A backwards clock jump (NTP correcting a drifting VM, which this box is) re-anchors the
   * window without clearing the spend. The alternative reading — treat it as elapsed — hands
   * out a fresh allowance every time the clock steps back, which is a way to spend real
   * money on a fault nobody would think to look for.
   */
  private rollWindow(): void {
    const windowMs = this.limits.spendWindowMs;
    if (windowMs <= 0 || this.clock === null) return;
    const now = this.clock.nowMs();
    if (this.windowStartMs === null || now < this.windowStartMs) {
      this.windowStartMs = now;
      return;
    }
    if (now - this.windowStartMs < windowMs) return;
    this.windowStartMs = now;
    this.spent = 0;
    if (this.stopped === 'SPEND_CAP') this.stopped = null;
  }

  /** May one more call be made? Rolls the window; charges nothing. */
  mayCall(): BudgetVerdict {
    this.rollWindow();
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
    this.rollWindow();
    this.calls += 1;
    this.inReckoning += 1;
    const inputTokens = Math.ceil(Math.max(0, promptChars) / CHARS_PER_TOKEN);
    const worstCase =
      this.priceInput(inputTokens) + this.priceOutput(this.limits.maxOutputTokens);
    this.spent += worstCase;
    this.spentLifetime += worstCase;
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
    // Only the output half is known when input was not measured: keep the reserved input
    // estimate and swap the output half only.
    const correction =
      inputTokens === null
        ? actual - this.priceOutput(this.limits.maxOutputTokens)
        : actual - reserved;
    this.spent += correction;
    this.spentLifetime += correction;
    if (this.spent < 0) this.spent = 0;
    if (this.spentLifetime < 0) this.spentLifetime = 0;
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
    this.spentLifetime = Math.max(0, this.spentLifetime - reserved);
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
      windowMs: this.limits.spendWindowMs,
      windowResetsInMs: this.windowResetsInMs(),
      spentLifetimeMicros: this.spentLifetime,
      estimatedCalls: this.estimated,
      disabled: this.disabled,
      disabledWhy: this.stopped,
    };
  }

  /**
   * Ms until the window rolls, or `null` when there is no window or none is anchored yet.
   *
   * Never negative: an elapsed-but-unrolled window reads `0`, because {@link rollWindow}
   * runs on use and a report taken between the elapse and the next call would otherwise
   * print a countdown that had gone through zero.
   */
  private windowResetsInMs(): number | null {
    if (this.limits.spendWindowMs <= 0 || this.clock === null) return null;
    if (this.windowStartMs === null) return null;
    const elapsed = this.clock.nowMs() - this.windowStartMs;
    return Math.max(0, this.limits.spendWindowMs - elapsed);
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
