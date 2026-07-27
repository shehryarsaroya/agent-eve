/**
 * Building a HULL: `build {kind: 'HULL', hull, modules}` as a function of its inputs.
 *
 * ── WHY THIS SPENDS NO VERB ─────────────────────────────────────────────────
 *
 * §17's verb budget is 40/40 and this change already spent its one swap on `engage`. Shipbuilding
 * needs no second slot because **`build` is already the right word.** §3 gives it *"the production
 * structure"* context and the engine gives it *"turn goods into a durable located thing"* — a WORKS
 * and a HULL are both that, and `kind` is how the venture verb already distinguishes eight cases.
 * A `fit` verb, an `assemble` verb, or a `shipyard` verb would each be a second word for one concept,
 * which hard rule 4 forbids and §17's ceiling makes unaffordable anyway.
 *
 * ── THE ONE THING THIS FILE REFUSES THAT A READER WILL WANT TO RELAX ────────
 *
 * A hull may only be built where the builder's **holding stands**, and never in the Commons.
 *
 * The Commons half is A8 read forward rather than backward. A8 makes hostile action *invalid* there
 * — not punished, invalid — and a shipyard inside a permanent sanctuary would make the sanctuary the
 * arsenal: build in perfect safety, sortie, come home. That is the same collapse §9 names for the
 * toll cartel, and its pixel signature is worse than identical-to-peace: it is *a fleet nobody can
 * ever attack.* So warships are a thing you can only make somewhere you can be reached, which is
 * what makes `graduate` a decision with a military consequence rather than only an economic one.
 *
 * The holding half is A15. A gate priced in identities is unpriced, and *"build a hull anywhere"*
 * would be exactly that — free enrolment plus a fitted frigate at every system is a Sybil fleet. A
 * holding costs currency plus manufactured goods at the crossing (§6.3), which is *"capital that is
 * slashable"* and therefore a real price.
 */

import type { PrincipalId, SystemId } from '../core/types.js';
import { qty, type Qty } from '../core/units.js';
import { reject, type Rejection, type WorldResult } from '../world/result.js';
import { hullSpec, HULL_NAMES, MODULE_NAMES } from './catalogue.js';
import { Fleet, hullIdFor, readyAtFor, type HullRecord } from './fleet.js';
import { fitWarnings, simulateFit, type FitProfile } from './fit.js';
import type { ShipyardPort } from './engage.js';
import { HULL_COST_GOODS, hullCostStatement, MAX_HULLS_PER_PRINCIPAL } from './params.js';

/** What the caller has to name. Every field is the agent's own statement. */
export interface BuildHullRequest {
  readonly principal: PrincipalId;
  readonly system: SystemId;
  readonly hull: string;
  readonly modules: readonly string[];
  readonly tick: number;
}

/** What an accepted build produced. */
export interface BuildHullResult {
  readonly record: HullRecord;
  readonly profile: FitProfile;
  /** Legal-but-notable properties: no gun, unstable capacitor, no role tag. */
  readonly warnings: readonly string[];
  readonly frameSpent: Qty;
  readonly fuelSpent: Qty;
}

/**
 * The **single** gate, called by both the affordance layer and the verb.
 *
 * Gates in published order: 1. the hull is real · 2. the fit is legal (delegated to
 * {@link simulateFit}, which is the same arithmetic the resolver runs) · 3. not the Commons ·
 * 4. your holding stands here · 5. the frame good is present and unpledged · 6. the fuel is too ·
 * 7. you are under the fleet cap.
 */
export function buildHullRefusal(
  port: ShipyardPort,
  fleet: Fleet,
  req: BuildHullRequest,
): Rejection | null {
  // 1.
  const spec = hullSpec(req.hull);
  if (spec === undefined) {
    return reject(
      'A2',
      `unknown_hull: "${req.hull}". The five are ${HULL_NAMES.join(' · ')}. Modules: ` +
        `${MODULE_NAMES.slice(0, 8).join(' · ')} and ${String(MODULE_NAMES.length - 8)} more — ` +
        `simulate any combination for free before you spend anything.`,
    );
  }

  // 2. The fit's legality is the fit simulator's answer, never a second copy of it.
  const simulated = simulateFit(req.hull, req.modules);
  if (!simulated.ok) return simulated;

  // 3.
  if (port.tierOf(req.system) === 'COMMONS') {
    return reject(
      'A8',
      `${req.system} is COMMONS and no hull may be built there. A8 makes the Commons a permanent floor for ` +
        `your body, and a shipyard inside a place nobody may attack would make the sanctuary the arsenal. ` +
        `\`graduate\` first: leaving the floor is what makes a fleet possible and what makes it reachable.`,
    );
  }

  // 4.
  if (!port.seatedAt(req.principal, req.system)) {
    return reject(
      'A15',
      `your holding does not stand at ${req.system}, and a hull is built at a berth rather than in space. ` +
        `This is the anti-Sybil price: a holding costs currency plus manufactured goods at the crossing, so ` +
        `"a fitted frigate at every system" costs capital rather than accounts.`,
    );
  }

  // 5–6.
  const frameNeed = qty(spec.costFrame);
  const fuelNeed = qty(spec.costFuel);
  const frameHave = port.goodsAt(req.principal, req.system, HULL_COST_GOODS.frame);
  if (frameHave < frameNeed) {
    return reject(
      'A2',
      `a ${req.hull} costs ${hullCostStatement(frameNeed, fuelNeed)} You hold ${String(frameHave)} unpledged ` +
        `${HULL_COST_GOODS.frame} at ${req.system}. Encumbered lots do not count.`,
    );
  }
  const fuelHave = port.goodsAt(req.principal, req.system, HULL_COST_GOODS.fuel);
  if (fuelHave < fuelNeed) {
    return reject(
      'A2',
      `a ${req.hull} costs ${hullCostStatement(frameNeed, fuelNeed)} You hold ${String(fuelHave)} unpledged ` +
        `${HULL_COST_GOODS.fuel} at ${req.system}. ${HULL_COST_GOODS.fuel} is produced only at FRONTIER ` +
        `systems, so either hold ground there or buy it from somebody who does — which is the whole reason ` +
        `warships give territory a military value.`,
    );
  }

  // 7.
  if (fleet.readyOrBusyOf(req.principal).length >= MAX_HULLS_PER_PRINCIPAL) {
    return reject(
      'A2',
      `you already hold ${String(MAX_HULLS_PER_PRINCIPAL)} live hulls, which is the cap. A wreck frees a slot; ` +
        `nothing else does.`,
    );
  }

  return null;
}

/**
 * Build it. **The gate has already run.**
 *
 * `refine.ts`'s ordering rule verbatim: **destroy first, then create.** If the second half failed
 * after the first, destroy-then-fail leaves the actor poorer — safe, visible, recoverable — where
 * create-then-fail mints a warship from nothing and breaks supply conservation, which is the one
 * thing INV-1 exists to catch and the worst possible residue to leave in an append-only record.
 */
export function buildHull(
  port: ShipyardPort,
  fleet: Fleet,
  req: BuildHullRequest,
): WorldResult<BuildHullResult> {
  const refusal = buildHullRefusal(port, fleet, req);
  if (refusal !== null) return refusal;

  const spec = hullSpec(req.hull);
  if (spec === undefined) return reject('A2', `unknown_hull: "${req.hull}".`);
  const simulated = simulateFit(req.hull, req.modules);
  if (!simulated.ok) return simulated;
  const profile = simulated.value;

  const frameSpent = port.consume({
    principal: req.principal,
    system: req.system,
    good: HULL_COST_GOODS.frame,
    qty: qty(spec.costFrame),
    eventId: `hull.frame:${req.principal}:${String(req.tick)}:${req.system}`,
    tick: req.tick,
  });
  const fuelSpent = port.consume({
    principal: req.principal,
    system: req.system,
    good: HULL_COST_GOODS.fuel,
    qty: qty(spec.costFuel),
    eventId: `hull.fuel:${req.principal}:${String(req.tick)}:${req.system}`,
    tick: req.tick,
  });

  if (frameSpent < spec.costFrame || fuelSpent < spec.costFuel) {
    // The gate passed and the ledger moved less than it said it would. That is a real divergence
    // between the affordance and the world, and the honest move is to refuse loudly rather than
    // hand out a discounted warship: the goods are already gone, the actor is poorer, and the
    // record says exactly what happened. `refine.ts`'s destroy-then-fail branch, with a hull in it.
    return reject(
      'A2',
      `the ledger moved ${String(frameSpent)} ${HULL_COST_GOODS.frame} and ${String(fuelSpent)} ` +
        `${HULL_COST_GOODS.fuel} where the quote said ${String(spec.costFrame)} and ${String(spec.costFuel)}. ` +
        `Nothing was built and the goods are spent. Report this: an affordance and the ledger disagreed.`,
    );
  }

  const record: HullRecord = {
    id: hullIdFor(req.system, req.tick, req.principal, fleet.nextOrdinal(req.principal, req.tick)),
    owner: req.principal,
    hull: req.hull,
    fit: profile.fitHash,
    modules: [...req.modules],
    location: req.system,
    builtAtTick: req.tick,
    readyAtTick: readyAtFor(req.tick),
    state: 'FITTING',
    wreckedAtTick: null,
    battles: 0,
  };
  fleet.build(record);

  return {
    ok: true,
    value: { record, profile, warnings: fitWarnings(profile), frameSpent, fuelSpent },
  };
}

/** What a hull would cost, for the affordance. Free, exact, reserves nothing. */
export function hullQuote(hull: string): { readonly frame: Qty; readonly fuel: Qty } | null {
  const spec = hullSpec(hull);
  if (spec === undefined) return null;
  return { frame: qty(spec.costFrame), fuel: qty(spec.costFuel) };
}
