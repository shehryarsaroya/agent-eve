/**
 * `refine`, as a function of its inputs rather than a method on the world.
 *
 * ── WHY THIS LIVES HERE AND NOT IN `sim/runtime.ts` ──────────────────────────
 *
 * `runtime.ts` is 9,786 lines — 12% of the engine in one class, holding 26 verb handlers and 141
 * private helpers, with the handlers alone spanning ~7,200 of those lines. That is not a style
 * complaint. On 2026-07-26 **three separate mechanical edits landed in the wrong place in it and all
 * three passed `tsc`**:
 *
 *   - a mutation test hit the wrong one of two `recordSpend` calls 400 lines apart, appeared to pass,
 *     and produced a confidently wrong finding;
 *   - the `refine` affordance was spliced INSIDE the `build` affordance's
 *     `if (affordable && !alreadyHeld)`, so it was never offered to anyone holding ore — who by
 *     definition already hold a WORKS;
 *   - and an earlier brace-matching edit cut a method in half.
 *
 * A file that cannot be held in view makes "verify by reading" impossible and pushes everything onto
 * tests, which only catch what they were written to catch. Phase 2 adds more verbs, so the useful move
 * is not a heroic 7,000-line refactor at the end of a long session — it is to stop growing the monolith
 * and leave a worked example of the shape that replaces it.
 *
 * **This is that example.** The pattern is the one the codebase already uses elsewhere — `TargetPort`,
 * `PredationPort`, `RaidViewPort`, and the verb logic already living in `world/movement.ts`: a narrow
 * PORT of exactly what the operation reads and writes, so the function is testable without a world and
 * the runtime method shrinks to an adapter that gathers inputs.
 *
 * The port is deliberately narrow. Passing the whole `Runtime` would compile and would buy nothing:
 * the value here is that the signature ENUMERATES the operation's reach, so a reviewer can see it
 * touches lots, the ledger, and nothing else.
 */

import type { EventId, GoodId, PrincipalId, SystemId, ZoneTier } from '../core/types.js';
import { qty, type Qty } from '../core/units.js';
import { reject, type WorldResult } from '../world/result.js';
import {
  ALLOY_GOOD,
  ALLOY_IN_BY_TIER,
  ALLOY_OUT_QTY,
  REFINE_IN_QTY,
  REFINE_OUT_QTY,
  WORKS_GOOD,
  WORKS_YIELD_GOOD,
} from './params.js';

/**
 * The two recipes `refine` knows, and the *only* two.
 *
 * ── WHY A `kind` PARAMETER AND NOT A SECOND VERB ─────────────────────────────
 *
 * §17's budget is at 40 of 40 and spent, so a second conversion cannot be a second word. It does
 * not want to be one either: `build {kind:"WORKS"}` / `{kind:"ANCHOR"}` / `{kind:"HULL"}` already
 * establishes the shape, and the two recipes here **compete for the same input lot** — which is
 * precisely the decision §10.1 asked for, and which two verbs would have hidden by making them look
 * like unrelated activities.
 *
 * ── AND WHY THE DEFAULT IS `RATION` ──────────────────────────────────────────
 *
 * Every `refine` in the action log so far carries no `kind`, and it meant ore → rations. A default
 * of anything else would **reclassify history**: a replay would turn past rations into alloy, which
 * is a rewritten record rather than a new rule (A5). It is also the safe default going forward —
 * the good every obligation is priced in is what an agent short of tribute needs, and a mistyped
 * `kind` therefore fails toward solvency.
 */
export const REFINE_KINDS = Object.freeze(['RATION', 'ALLOY'] as const);

export type RefineKind = (typeof REFINE_KINDS)[number];

/**
 * The alloy rate at every tier, in one string. **The price, published in every refusal.**
 *
 * A2: *known arithmetic is exact and machine-readable*, and an agent refused for being short of ore
 * needs to know whether the answer is "wait" or "buy somewhere cheaper". Those are the two moves and
 * only this sentence distinguishes them. Built from the constant, never typed twice, because a rate
 * quoted in prose that stops matching the engine is scar #1.
 */
export function tierRates(): string {
  return (['COMMONS', 'MARCHES', 'FRONTIER'] as const)
    .map((t) => `${t} ${String(ALLOY_IN_BY_TIER[t])}:1`)
    .join(' · ');
}

/**
 * One recipe at one place, fully described. The table is the rule; nothing below branches on a name.
 *
 * **`inQty` depends on the TIER, which is the whole of the fourth good's geography.** `ALLOY_IN_BY_TIER`
 * carries the argument in full: it is a price gradient rather than a wall, because the wall version was
 * measured and deadlocked — a Marches claimant could neither refine alloy nor fund a market BID, so
 * `claims` went to zero. Every tier can make it; the Commons makes it four times cheaper than the
 * Marches and eight times cheaper than the Frontier, and that difference is the price a haul is worth.
 */
interface Recipe {
  readonly kind: RefineKind;
  readonly inGood: GoodId;
  readonly inQty: number;
  readonly outGood: GoodId;
  readonly outQty: number;
}

/** Parse a `kind` param. Unknown spellings are refused by name rather than defaulted (A2). */
export function refineKindOf(named: string | null): RefineKind | null {
  if (named === null) return 'RATION';
  const upper = named.toUpperCase();
  return REFINE_KINDS.includes(upper as RefineKind) ? (upper as RefineKind) : null;
}

/**
 * What one recipe consumes and produces **at one tier**.
 *
 * The tier is a parameter rather than a lookup inside {@link refine}, so the affordance, the cast and
 * the verb all price a batch through the same function. Two copies of "how much ore does an alloy cost
 * here" is scar #5 with a geography attached, and the failure would be a menu quoting the Commons rate
 * to a Marches member — an affordance the engine then refuses, which costs an agent a real action
 * every wake (AGT-S2).
 */
export function recipeOf(kind: RefineKind, tier: ZoneTier): Recipe {
  if (kind === 'RATION') {
    return {
      kind,
      inGood: WORKS_YIELD_GOOD,
      inQty: REFINE_IN_QTY,
      outGood: WORKS_GOOD,
      outQty: REFINE_OUT_QTY,
    };
  }
  return {
    kind,
    inGood: WORKS_YIELD_GOOD,
    inQty: ALLOY_IN_BY_TIER[tier],
    outGood: ALLOY_GOOD,
    outQty: ALLOY_OUT_QTY,
  };
}

/** An unpledged parcel of one good standing at one place. */
export interface RefinableLot {
  readonly id: string;
  readonly qty: number;
}

/**
 * Everything `refine` touches. Nothing else is reachable from here, which is the point.
 */
export interface RefinePort {
  /** Unpledged lots of `good` this principal holds AT `system`, canonical order. */
  readonly lotsOf: (principal: PrincipalId, system: SystemId, good: GoodId) => readonly RefinableLot[];
  /**
   * The tier of `system`. **Asked, never assumed**, because {@link recipeOf}'s `onlyAt` is the whole
   * of the fourth good's geography and a port that could not answer this would have to be handed a
   * map — which is how a narrow port becomes the whole `Runtime` again.
   */
  readonly tierOf: (system: SystemId) => ZoneTier | null;
  /** Destroy `qty` from one lot, into the CONSUMPTION sink. */
  readonly destroy: (args: { readonly eventId: EventId; readonly lotId: string; readonly qty: Qty }) => void;
  /** Create `qty` of `good` at `location`, from the PRODUCTION faucet. */
  readonly source: (args: {
    readonly eventId: EventId;
    readonly good: GoodId;
    readonly qty: Qty;
    readonly location: SystemId;
  }) => void;
}

/**
 * Turn raw {@link WORKS_YIELD_GOOD} into the good every obligation is payable in.
 *
 * §10's *"one build step"*. A WORKS extracts ore; the Levy, a sovereignty Charge and the goods half of
 * a WORKS build are each payable in rations; this is the only conversion. Located, like everything
 * else (§10.2): the output appears **where the ore stood**, never at the actor's seat — goods that
 * appeared at a holding the hand had left would be a located fact that was false, the error D8
 * corrected in the Levy.
 *
 * `wanted` is a quantity of OUTPUT, or null for "every whole batch I can". Whole batches only: a
 * partial batch would either round in the actor's favour or silently destroy the remainder, and §10.2
 * requires published rounding rather than a choice made here.
 */
export function refine(
  port: RefinePort,
  principal: PrincipalId,
  system: SystemId,
  tick: number,
  wanted: number | null,
  kind: RefineKind = 'RATION',
): WorldResult<null> {
  // ── THE TIER IS READ FIRST, BECAUSE IT IS THE PRICE ─────────────────────────
  //
  // A refusal that named a quantity without naming the place would be A2 half-kept: a Marches member
  // with 20,000 ore is not "short", it is paying four times the Commons rate, and those are different
  // facts with different fixes. Every message below therefore carries the tier and the two rates.
  const tier = port.tierOf(system);
  if (tier === null) {
    return reject('A2', `there is no system ${system}, so nothing can be refined there.`);
  }
  const recipe = recipeOf(kind, tier);

  const lots = port.lotsOf(principal, system, recipe.inGood);
  const have = lots.reduce((n, l) => n + l.qty, 0);
  if (have < recipe.inQty) {
    return reject(
      'A2',
      `refine {kind:"${recipe.kind}"} turns ${recipe.inGood} into ${recipe.outGood}, and you have ` +
        `${String(have)} unpledged ${recipe.inGood} at ${system} — the recipe needs ` +
        `${String(recipe.inQty)} here, because ${system} is ${tier}` +
        `${recipe.kind === 'ALLOY' ? ` and the rate is ${tierRates()}` : ''}. A WORKS yields ` +
        `${WORKS_YIELD_GOOD} where it stands; ${WORKS_GOOD} is what the Levy, a Charge and a WORKS ` +
        `build are payable in. Encumbered lots do not count.`,
    );
  }

  const batches = wanted === null ? Math.trunc(have / recipe.inQty) : Math.trunc(wanted / recipe.outQty);
  if (batches <= 0) {
    return reject(
      'A2',
      `refine {kind:"${recipe.kind}"} needs a positive quantity; ${String(wanted)} of ` +
        `${recipe.outGood} rounds to no whole batch of ${String(recipe.outQty)}.`,
    );
  }
  const takeQty = batches * recipe.inQty;
  if (takeQty > have) {
    return reject(
      'A2',
      `${String(batches)} batch(es) of ${recipe.outGood} would consume ${String(takeQty)} ` +
        `${recipe.inGood} and you have ${String(have)} at ${system}. ` +
        `The recipe is ${String(recipe.inQty)} ${recipe.inGood} for ${String(recipe.outQty)} ` +
        `${recipe.outGood} at a ${tier} system` +
        `${recipe.kind === 'ALLOY' ? ` — ${tierRates()}, so buying it where it is cheap and hauling it is often the better trade` : ''}.`,
    );
  }

  // ── DESTROY FIRST, THEN SOURCE ──────────────────────────────────────────────
  //
  // The ordering rule the delegated `create` path documents (AGT-X9). If the second half failed after
  // the first, destroy-then-fail leaves the actor poorer — safe, visible, and recoverable — where
  // source-then-fail mints goods from nothing and breaks supply conservation, which is the one thing
  // INV-1 exists to catch and the worst possible residue to leave in an append-only record.
  // ── THE ID SUFFIX IS EMPTY FOR `RATION`, AND THAT IS THE DIVERGENCE BUDGET ──
  //
  // Event ids are content-derived and reach the record, so putting the kind in *every* id would
  // rename every `refine` event this world has ever written — turning a narrow, nameable
  // discontinuity ("the first `refine {kind:"ALLOY"}`", which no journal contains) into "every refine
  // since genesis". A5 forbids rewriting a past row and the operator door takes ONE tick, so the
  // default recipe keeps its historical id exactly.
  //
  // The suffix is still needed for the second recipe: two kinds drawing from the same lot in one tick
  // would otherwise mint the same `lot:` id twice and the ledger refuses a duplicate — a legal pair
  // of actions turned into an agent-reachable throw.
  const tag = recipe.kind === 'RATION' ? '' : `${recipe.kind}:`;
  let taken = 0;
  for (const lot of lots) {
    if (taken >= takeQty) break;
    const portion = Math.min(takeQty - taken, lot.qty);
    if (portion <= 0) continue;
    port.destroy({
      eventId: `refine.in:${tag}${principal}:${String(tick)}:${lot.id}` as EventId,
      lotId: lot.id,
      qty: qty(portion),
    });
    taken += portion;
  }
  port.source({
    eventId: `refine.out:${tag}${principal}:${String(tick)}:${system}` as EventId,
    good: recipe.outGood,
    qty: qty(batches * recipe.outQty),
    location: system,
  });
  return { ok: true, value: null };
}
