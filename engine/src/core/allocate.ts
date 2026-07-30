/**
 * Splitting an integer total across integer weights so that the parts sum to the total, **exactly**.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **ONE ALLOCATOR, AND IT LIVES BELOW EVERYTHING THAT ALLOCATES.**
 *
 * This is `levy/assessment.ts:largestRemainder` moved down a layer at `RULES_VERSION` 38, unchanged
 * line for line. It moved because four modules allocate and only one of them is the Levy:
 *
 *   | caller                    | what it splits                        | what the old import cost it |
 *   |---------------------------|---------------------------------------|-----------------------------|
 *   | `levy/assessment.ts`      | a docket's total across the roll      | nothing — it was home       |
 *   | `world/lode.ts`           | a tier's yield across its systems     | `as never` + `as readonly number[]` |
 *   | `works/book.ts`           | a system's rent across claimants      | `as unknown as Minor`       |
 *   | `sovereignty/charge.ts`   | a constellation's upkeep across claims| a `minor()`/`qty()` round trip |
 *
 * Three of the four had to reach **upward into `levy/`** for arithmetic that has nothing to do with
 * the Levy, and each paid for it in a cast plus a paragraph apologising for the cast. `world/lode.ts`
 * paid the most: `as never` does not launder a brand, it **switches off type checking for that
 * argument entirely**, so the one call in this engine that most needs to be integer-checked was the
 * one call the compiler had been told to ignore.
 *
 * It also closed a cycle. `levy` imports `world` (the roll needs the map); `world` imported `levy`
 * (for this function). `PulsePort.swayAt` exists precisely because `campaign` may not import
 * `world/sway` — the same defect one module over, already paid for once.
 *
 * **Generic over the brand, not laundering it.** `Minor`, `Qty` and a bare `number` are the same
 * integer with different compile-time labels, and the algorithm is indifferent to which — but the
 * *caller* is not, and now the caller keeps its label all the way through instead of dropping it at
 * the door and re-attaching it on the way out.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **Why exactness is the whole point.** An allocation summing to one minor unit *more* than the total
 * puts a principal in the sweep for a debt the rule never created. A fabricated debt is the A5′ shape
 * wearing arithmetic — the record is *wrong*, permanently and publicly, about a real agent — and this
 * repo has shipped eight bugs of that shape. INV-24 (the Levy), SOV-4 (the Charge) and INV-W1 (the
 * lode) are each the same assertion over a different caller of this function, which is the argument
 * for there being exactly one of it.
 */

/**
 * An allocation that could not be made exactly.
 *
 * Thrown rather than returned, and never caught inside the engine: every branch below is either a
 * caller passing something the rule forbids (a negative total, weights that sum to zero) or a
 * quantity that has left integer range. Both are halts — an allocator that "did its best" is the
 * fabricated-debt failure with a softer name.
 */
export class AllocationError extends Error {}

/**
 * Distribute `amount` across `weights` so that the sum is `amount`, exactly.
 *
 * Largest remainder, with **the index order as the tie-break** — so callers must pass weights in a
 * canonical order, which every caller does (`levy/assessment.ts` sorts by principal, `world/lode.ts`
 * by `systemOrder`, `sovereignty/charge.ts` by claim id). An arrival-ordered caller would get a
 * different-but-still-exact split, which is the worst kind of wrong: it reconciles.
 *
 * `splitByBps` cannot be used here — its weights must sum to 10 000 bps, and converting arbitrary
 * integer weights to bps first is the rounding step this method exists to avoid.
 *
 * The brand travels: `largestRemainder(someMinor, w)` returns `readonly Minor[]`,
 * `largestRemainder(somePlainNumber, w)` returns `readonly number[]`. Nothing here inspects the
 * brand, and nothing here removes it.
 */
export function largestRemainder<T extends number>(amount: T, weights: readonly number[]): readonly T[] {
  if (weights.length === 0) {
    if (amount !== 0) {
      throw new AllocationError(`cannot allocate ${String(amount)} across zero weights`);
    }
    return [];
  }
  if (amount < 0) throw new AllocationError(`cannot allocate a negative total (${String(amount)})`);

  const totalWeight = weights.reduce<number>((a, b) => a + b, 0);
  if (totalWeight <= 0) throw new AllocationError('weights must sum to a positive number');

  const scaled = weights.map((w) => {
    const product = amount * w;
    if (!Number.isSafeInteger(product)) {
      // Loud rather than silently imprecise: past 2^53 the division below stops being
      // integer arithmetic, and a value path that has stopped being integral cannot be
      // reconciled at all.
      throw new AllocationError(`allocation overflow: ${String(amount)} x ${String(w)} leaves safe integer range`);
    }
    return product;
  });

  const base = scaled.map((p) => Math.trunc(p / totalWeight));
  let left = amount - base.reduce<number>((a, b) => a + b, 0);
  const order = scaled
    .map((p, i) => ({ i, remainder: p - Math.trunc(p / totalWeight) * totalWeight }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);

  const out = [...base];
  let cursor = 0;
  while (left > 0) {
    const pick = order[cursor % order.length];
    if (pick === undefined) throw new AllocationError('unreachable: empty remainder order');
    out[pick.i] = (out[pick.i] ?? 0) + 1;
    left -= 1;
    cursor += 1;
    if (cursor > order.length * 2) {
      throw new AllocationError('unreachable: remainder distribution failed to converge');
    }
  }

  const check = out.reduce<number>((a, b) => a + b, 0);
  if (check !== amount) {
    throw new AllocationError(`allocation lost value: allocated ${String(check)}, expected ${String(amount)}`);
  }
  // The only cast in the file, and it re-attaches the brand the signature already promised: every
  // member of `out` came from integer arithmetic over `amount`, which was a `T`. TypeScript cannot
  // narrow `number` back into a branded subtype, so the widening is explicit — the same spelling
  // `combat/params.ts:136` uses to build a `Bps[]` from integer literals. It is one cast here in
  // place of three at the call sites, and unlike `world/lode.ts`'s former `as never` it constrains
  // the *return* rather than switching off checking on an *argument*.
  return out as unknown as readonly T[];
}
