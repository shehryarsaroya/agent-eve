/**
 * The WORKS book: which places are being worked, by whom, and what each tick yields them.
 *
 * ## Two rules hold this together, and both are about the yield cap
 *
 * 1. **A system's yield is divided, never multiplied.** {@link Book.sharesAt} splits
 *    `YIELD_PER_TICK[tier]` across the live WORKS at that system with the Levy's own
 *    `largestRemainder`, so Σ shares === the tier yield *exactly*. A split that rounded up
 *    would mint goods out of arithmetic, which is the A15 hole this design exists to close —
 *    and it would do it invisibly, a unit at a time, at every system, every tick.
 *
 * 2. **Order is canonical, never insertion.** Shares are assigned in `compareIds` order over
 *    the WORKS ids, because largest-remainder's tie-break is index order: two worlds that
 *    admitted the same WORKS in a different sequence must extract the same amounts, or
 *    replay diverges and every hash after it is wrong.
 */

import type { CanonicalValue } from '../core/canonical.js';
import type { PrincipalId, SystemId, ZoneTier } from '../core/types.js';
import { qty, type Minor, type Qty } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import { largestRemainder } from '../levy/assessment.js';
import {
  readArray,
  readInt,
  readObject,
  readString,
  SnapshotError,
  type StateTable,
} from '../tick/snapshot.js';
import {
  FUEL_YIELD_PER_TICK,
  WORKS_PER_PRINCIPAL_PER_SYSTEM,
  WORKS_SPINUP_TICKS,
  YIELD_PER_TICK,
} from './params.js';

/** A WORKS id is content-derived from its place and the tick it was raised. */
export type WorksId = string & { readonly __brand: 'WorksId' };

export function worksId(system: SystemId, tick: number, holder: PrincipalId): WorksId {
  return `works:${system}:${String(tick)}:${holder}` as WorksId;
}

export interface WorksRecord {
  readonly id: WorksId;
  readonly system: SystemId;
  readonly holder: PrincipalId;
  readonly raisedAtTick: number;
  /** The tick from which it extracts. `raisedAtTick + WORKS_SPINUP_TICKS`. */
  readonly onlineAtTick: number;
  /** Ended WORKS stay in the book: the record is append-only and A5 has no opt-out. */
  readonly razed: boolean;
  readonly razedAtTick: number | null;
  /**
   * The Reckoning this WORKS fell in, or `null` while it stands. **THE RUIN's label.**
   *
   * Derivable from `razedAtTick` and stored anyway, and the precedent is exact:
   * `world/holding.ts` carries `fellAtReckoning` beside the tick for the same reason §16 asks for
   * *"a permanent ruin at a fallen holding's berth labelled with the handle and the Reckoning it
   * fell"*. A projection that re-derived it would be one `setSpeed` away from labelling a ruin with
   * a Reckoning the world never had — `TICKS_PER_RECKONING` is a runtime setting, and a ruin is a
   * permanent public claim about when a real agent lost real capital (A5′).
   */
  readonly fellAtReckoning: number | null;
  /**
   * Who ended it, or `null` while it stands.
   *
   * On the row rather than only on the event, because THE RUIN is a projection over this book and a
   * ruin that could not name the principal that made it would be a loss with no author — which is
   * most of what makes a razing a story rather than an accident. The event carries it too; this is
   * the state the map reads.
   */
  readonly razedBy: PrincipalId | null;
  /** Cumulative units extracted. The audit trail, and what the frame draws. */
  extracted: Qty;
  /**
   * Cumulative units of that extraction handed to the claim-holder of this system as RENT.
   *
   * **Counted here rather than derived from `extracted × rentBps`**, and the difference is the
   * whole reason this field exists: the rate can differ from today's for a claim raised earlier,
   * a WORKS spends part of its life on unclaimed ground and part under a landlord, and a claim
   * that lapses stops collecting. So the product of two present-tense numbers would be a
   * confident, wrong history — and it is the number the frame prints beside the holder's name.
   *
   * `extracted` stays GROSS: the place handed that much over, which is what it means.
   */
  rentPaid: Qty;
  /**
   * Cumulative units of {@link import('./params.js').FUEL_GOOD} this WORKS has been handed.
   *
   * **A second counter and not a second meaning for `extracted`** (hard rule 4). Fuel and ore are
   * different goods with different sinks and different geography; one number summing both would
   * make `worksLines.extracted` a quantity of nothing in particular, and it would silently widen
   * INV-W4's and INV-W5's bounds — both of which are stated against the ORE yield — so a rent
   * above the ore a place handed over would stop tripping.
   *
   * Zero forever outside the Frontier, which is what `checkFuelIsFrontierOnly` asserts.
   */
  fuelExtracted: Qty;
}

/** Rent collected at one system during one Reckoning, and who is collecting it. */
export interface RentTally {
  readonly system: SystemId;
  readonly reckoning: number;
  readonly claimant: PrincipalId;
  taken: Qty;
}

export class WorksError extends Error {}

/**
 * Split a quantity into `n` equal-as-possible parts summing to it exactly.
 *
 * `largestRemainder` lives in the Levy and is typed in `Minor`, because that is what the Levy
 * divides. The algorithm itself is unit-agnostic integer arithmetic — it is the *sum-exactly*
 * property this module needs, and reimplementing it here to satisfy the type would mean two
 * copies of the one piece of arithmetic that must never round in our favour.
 *
 * So the units are laundered **once, here, with the reason**, rather than at each call site
 * where the cast would look like carelessness. `Qty` and `Minor` are branded apart on purpose
 * and that is worth keeping; this is the single crossing.
 */
function splitQty(total: Qty, parts: number): readonly Qty[] {
  const shares = largestRemainder(total as unknown as Minor, Array.from({ length: parts }, () => 1));
  return shares.map((n) => qty(Number(n)));
}

export class Book {
  private readonly rows = new Map<WorksId, WorksRecord>();
  /**
   * Rent taken at each system **in the current Reckoning only**, keyed by system.
   *
   * ── WHY ONE RECKONING AND NOT A HISTORY ──────────────────────────────────────
   *
   * A13 asks the claim line for *"the rent taken this Reckoning"*, which is the number a viewer
   * can compare against the Charge that settles tonight. A per-Reckoning history would be an
   * unbounded map inside `state_hash` — scar #3's shape, and INV-26 requires a declared bound —
   * and the ledger already holds every posting, so the history exists where history belongs.
   *
   * The whole map is dropped the first time rent is taken in a later Reckoning, so the bound is
   * the number of systems on the map and the reset needs no scheduled hook: a hook would be a
   * second place that had to agree about which Reckoning it is.
   */
  private readonly rent = new Map<SystemId, RentTally>();
  /**
   * The Reckoning each system's anchor was last fuelled for. Absent means cold.
   *
   * Bounded by the map for the same reason the rent tally is, and dropped wholesale when a later
   * Reckoning lights one: an anchor fuelled two Reckonings ago is not fuelled now, and a stale row
   * would keep the rent flowing on fuel that was burned for a different cycle.
   */
  private readonly hot = new Map<SystemId, number>();

  /** Live WORKS at a system, canonical order. The order the share split depends on. */
  liveAt(system: SystemId): readonly WorksRecord[] {
    return [...this.rows.values()]
      .filter((w) => w.system === system && !w.razed)
      .sort((a, b) => compareIds(a.id, b.id));
  }

  at(id: WorksId): WorksRecord | null {
    return this.rows.get(id) ?? null;
  }

  ofPrincipal(holder: PrincipalId): readonly WorksRecord[] {
    return [...this.rows.values()]
      .filter((w) => w.holder === holder && !w.razed)
      .sort((a, b) => compareIds(a.id, b.id));
  }

  /**
   * Every WORKS this world has ever raised, razed ones included, canonical order.
   *
   * The only accessor that does not filter `razed`, and it exists for the world-memory projections
   * (`frames/memory.ts`). Every other reader wants the live set because it is asking a question about
   * the present — what extracts, what divides a yield, what a principal holds. A place is named for
   * whoever first opened it whether or not that WORKS still stands, so history needs the whole book,
   * and the book keeps ended rows precisely so it can be asked (A5 has no opt-out).
   */
  everInOrder(): readonly WorksRecord[] {
    return [...this.rows.values()].sort((a, b) => compareIds(a.id, b.id));
  }

  /**
   * ★ Has this principal **ever** raised a WORKS — razed ones included?
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE ONCE-PER-IDENTITY PREDICATE, AND IT IS DELIBERATELY NOT `ofPrincipal(h).length === 0`.**
   *
   * `works/params.ts:WORKS_GOODS_IN_CURRENCY_MINOR` lets a principal's **first** WORKS pay its goods
   * half in retired currency, because the enrolment allotment is a once-per-identity window and a
   * principal drained past it had no legal way back into the economy. That justification is about a
   * *lifetime*, so the gate has to be too.
   *
   * `ofPrincipal` filters `razed`, so it answers "holds none **now**", and this one answers "held
   * one ever". **THAT DAY HAS ARRIVED AND THE TWO PREDICATES NOW DISAGREE** — `works/raze.ts` ends a
   * WORKS off a raid and off a campaign breach, so `ofPrincipal` goes back to zero for a principal
   * whose only structure was burned. The prediction written here before the mechanism existed was
   * exact: the shorter spelling would reopen the bootstrap door **once per razing, at 25,000 a
   * turn** — an A15 hole arriving with a feature that has nothing to do with it, and the shape of
   * the `Book.prune` defect that made a §9 fix evaporate in production only.
   *
   * The decision this forced, made on purpose: **a principal that LOSES its only WORKS does not get
   * a fresh bootstrap.** The door's justification is a once-per-*identity* window out of a trap the
   * *enrolment allotment* creates, and a principal that has held a WORKS has had a goods income —
   * losing it to an assault is the loss A5 exists to make real, not a return to the starting line.
   * The rebuild is priced in goods like everybody else's, which is the replacement demand razing was
   * built to create; a currency door reopening on each razing would let a rich agent buy its way
   * around production indefinitely by being raided, and make the razing *profitable*.
   *
   * `the door is once per IDENTITY` in `test/works/the-window-closes.spec.ts` razed a row by hand to
   * force this decision, and `test/works/raze.spec.ts` now razes one through the engine and asserts
   * the same answer on the real path.
   * ══════════════════════════════════════════════════════════════════════════
   */
  everHeldBy(holder: PrincipalId): boolean {
    for (const w of this.rows.values()) if (w.holder === holder) return true;
    return false;
  }

  /** Every live WORKS, canonical order. What PRODUCE walks. */
  liveInOrder(): readonly WorksRecord[] {
    return [...this.rows.values()].filter((w) => !w.razed).sort((a, b) => compareIds(a.id, b.id));
  }

  /** Systems with at least one live WORKS, canonical order. */
  workedSystems(): readonly SystemId[] {
    const out = new Set<SystemId>();
    for (const w of this.liveInOrder()) out.add(w.system);
    return [...out].sort(compareIds);
  }

  holdsAt(holder: PrincipalId, system: SystemId): number {
    return this.liveAt(system).filter((w) => w.holder === holder).length;
  }

  atCapacity(holder: PrincipalId, system: SystemId): boolean {
    return this.holdsAt(holder, system) >= WORKS_PER_PRINCIPAL_PER_SYSTEM;
  }

  raise(args: {
    readonly system: SystemId;
    readonly holder: PrincipalId;
    readonly tick: number;
  }): WorksRecord {
    const id = worksId(args.system, args.tick, args.holder);
    if (this.rows.has(id)) throw new WorksError(`${id} already exists`);
    const row: WorksRecord = {
      id,
      system: args.system,
      holder: args.holder,
      raisedAtTick: args.tick,
      onlineAtTick: args.tick + WORKS_SPINUP_TICKS,
      razed: false,
      razedAtTick: null,
      fellAtReckoning: null,
      razedBy: null,
      extracted: qty(0),
      rentPaid: qty(0),
      fuelExtracted: qty(0),
    };
    this.rows.set(id, row);
    return row;
  }

  /**
   * End a WORKS. The row stays, and everything about it that was ever true stays with it.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE COUNTERS ARE NOT CLEARED, AND THAT IS THE WHOLE OF A5 HERE.** `extracted`, `rentPaid` and
   * `fuelExtracted` are what the place handed over while it stood, and they are still true after it
   * falls: INV-W4 walks `everInOrder()` precisely so a razed WORKS's rent history is still
   * checkable, and THE RUIN publishes `extracted` as what was lost. Zeroing them would delete a
   * landlord's public take along with its tenant's structure — no opt-out, no reroll.
   *
   * **Idempotent by refusal, not by shrug.** Razing an already-razed row throws rather than quietly
   * overwriting `razedBy`, because the second caller would be re-authoring a permanent public fact
   * about who destroyed whose capital, and the two callers of this method resolve on two different
   * clocks that can both come due in one Reckoning.
   * ══════════════════════════════════════════════════════════════════════════
   */
  raze(args: {
    readonly id: WorksId;
    readonly tick: number;
    readonly reckoning: number;
    readonly by: PrincipalId | null;
  }): void {
    const row = this.rows.get(args.id);
    if (row === undefined) throw new WorksError(`${args.id} does not exist`);
    if (row.razed) {
      throw new WorksError(
        `${args.id} was already razed at tick ${String(row.razedAtTick)} and a razing is not re-authored`,
      );
    }
    this.rows.set(args.id, {
      ...row,
      razed: true,
      razedAtTick: args.tick,
      fellAtReckoning: args.reckoning,
      razedBy: args.by,
    });
  }

  /**
   * Every WORKS this world has ended, canonical order. **THE RUIN's subject set.**
   *
   * The complement of `liveInOrder`, and the only accessor that asks for the razed rows *as such*
   * rather than tolerating them. It exists because a razed WORKS vanishing from `worksLines` is
   * indistinguishable on screen from one that was never raised — this project's signature defect
   * arriving at the pixel layer — so the loss needs a positive mark of its own (A13).
   */
  ruinsInOrder(): readonly WorksRecord[] {
    return [...this.rows.values()].filter((w) => w.razed).sort((a, b) => compareIds(a.id, b.id));
  }

  /** WORKS still standing. Distinct from {@link size}, which counts ruins too. */
  get liveSize(): number {
    return this.liveInOrder().length;
  }

  credit(id: WorksId, amount: Qty): void {
    const row = this.rows.get(id);
    if (row === undefined) throw new WorksError(`${id} does not exist`);
    // Defence in depth, and the depth is the point: today every caller reaches this through an id
    // set from `sharesAt`, which filters `razed`, so a ruin cannot be credited *by its caller*
    // rather than by anything here. That is exactly the guarantee that quietly stops holding when
    // somebody adds a fourth caller with a different id source — and a ruin that kept extracting
    // would make INV-W1's cap arithmetic true about a set the ledger no longer matches.
    if (row.razed) throw new WorksError(`${id} was razed at tick ${String(row.razedAtTick)} and extracts nothing`);
    row.extracted = qty(row.extracted + amount);
  }

  /**
   * Record rent taken out of one WORKS's extraction, for the claimant of its system.
   *
   * Two counters move together and neither is derivable from the other: the WORKS's own
   * lifetime rent (`rentPaid`, what a resident has handed over) and this Reckoning's take at the
   * system (the claim line's number). Called once per WORKS per tick, after the goods have
   * actually been posted — never before, because a counter that ran ahead of the ledger would
   * publish rent that was not collected (A5′'s shape in a public quantity).
   */
  creditRent(id: WorksId, amount: Qty, reckoning: number, claimant: PrincipalId): void {
    const row = this.rows.get(id);
    if (row === undefined) throw new WorksError(`${id} does not exist`);
    // Same guard as `credit`, and it matters more here: rent credited against a ruin would move
    // BOTH the WORKS's lifetime `rentPaid` and the claim's Reckoning tally, so it would publish a
    // landlord collecting from a structure that no longer exists — and INV-W5 would then be checking
    // a tally against a system that may have left `workedSystems()` entirely.
    if (row.razed) throw new WorksError(`${id} was razed at tick ${String(row.razedAtTick)} and pays no rent`);
    if (amount <= 0) return;
    row.rentPaid = qty(row.rentPaid + amount);
    const standing = this.rent.get(row.system);
    // A new Reckoning drops the whole map, not just this system's row: the frame's question is
    // "what did this claim take THIS Reckoning", and a stale row from two Reckonings ago would
    // answer a different question with a bigger number.
    if (standing === undefined || standing.reckoning !== reckoning) {
      for (const [system, tally] of [...this.rent.entries()]) {
        if (tally.reckoning !== reckoning) this.rent.delete(system);
      }
      this.rent.set(row.system, { system: row.system, reckoning, claimant, taken: qty(amount) });
      return;
    }
    // The claimant on the row is whoever is collecting NOW. A takeover mid-Reckoning inherits
    // the running total along with the arrears, which is the same rule the delinquency counter
    // follows: the figure belongs to the system.
    this.rent.set(row.system, { ...standing, claimant, taken: qty(standing.taken + amount) });
  }

  /** Rent taken at one system in `reckoning`. Zero for any other Reckoning, by construction. */
  rentTakenAt(system: SystemId, reckoning: number): Qty {
    const tally = this.rent.get(system);
    return tally !== undefined && tally.reckoning === reckoning ? tally.taken : qty(0);
  }

  /**
   * Systems carrying a non-zero rent tally for `reckoning`, canonical order.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **INV-W5's SUBJECT SET, AND IT EXISTS BECAUSE RAZING OPENED A HOLE IN THE OLD ONE.**
   * INV-W5 used to walk `workedSystems()`, which filters `razed`, while the tally it checks does
   * **not** — the tally survives its subject ending on purpose, exactly as it survives a claim
   * ending. Raze the last WORKS at a system mid-Reckoning and that system left the invariant's
   * subject set with a non-zero tally standing, so the one check that catches double rent collection
   * silently stopped running there.
   *
   * That is a failure **in the direction that hides**, which this repo has now shipped three times
   * (`MAX_RECKONING_SUMMARIES`, `LEVY_RETAINED_RECKONINGS`, an offer cap counting unusable rows). It
   * was a no-op for the project's whole life because nothing razed a WORKS, and it would have become
   * reachable in the same commit as the feature that made it reachable — with every test still green.
   * ══════════════════════════════════════════════════════════════════════════
   */
  rentTalliedSystems(reckoning: number): readonly SystemId[] {
    return [...this.rent.values()]
      .filter((r) => r.reckoning === reckoning && r.taken > 0)
      .map((r) => r.system)
      .sort(compareIds);
  }

  /**
   * Live WORKS at a system whose holder is not `claimant`. The claim's TENANT COUNT.
   *
   * The set that actually pays rent, so the frame's `tenants` and the rent it prints beside it
   * can never disagree about who is in it (A13: a mark that contradicts its own numbers).
   */
  tenantsAt(system: SystemId, claimant: PrincipalId): number {
    return this.liveAt(system).filter((w) => w.holder !== claimant).length;
  }

  /**
   * This tick's extraction, per WORKS, at one system — **summing to the tier yield exactly.**
   *
   * A WORKS still spinning up takes no share and, deliberately, **does not dilute** the
   * others: it is not yet extracting, so counting it would let a principal suppress a rival's
   * output by raising a structure it never finishes. The share is over the *online* set.
   */
  sharesAt(system: SystemId, tier: ZoneTier, tick: number): ReadonlyMap<WorksId, Qty> {
    return this.sharesOf(system, YIELD_PER_TICK[tier], tick);
  }

  /**
   * The same split, for a system's yield in the FUEL good. Zero outside the Frontier.
   *
   * A second call into {@link sharesOf} rather than a second algorithm: `FUEL_YIELD_PER_TICK` is a
   * different total over the *same* set of online WORKS, and a fuel split that divided among a
   * different set — or rounded differently — would let one good's arithmetic drift from the
   * other's while both looked correct (scar #5 across two goods).
   */
  fuelSharesAt(system: SystemId, tier: ZoneTier, tick: number): ReadonlyMap<WorksId, Qty> {
    return this.sharesOf(system, FUEL_YIELD_PER_TICK[tier], tick);
  }

  /** Divide any total across the ONLINE WORKS at a system, summing to it exactly. */
  sharesOf(system: SystemId, total: Qty, tick: number): ReadonlyMap<WorksId, Qty> {
    const online = this.liveAt(system).filter((w) => tick >= w.onlineAtTick);
    const out = new Map<WorksId, Qty>();
    if (online.length === 0 || total <= 0) return out;
    // Equal weights: a WORKS is a WORKS. Weighting by anything a principal controls would
    // be a lever to buy a bigger share of a fixed pool, which is the cap defeated.
    const shares = splitQty(total, online.length);
    for (const [i, w] of online.entries()) out.set(w.id, shares[i] ?? qty(0));
    return out;
  }

  /** Cumulative fuel credited to one WORKS. Separate counter: fuel is a separate good. */
  creditFuel(id: WorksId, amount: Qty): void {
    const row = this.rows.get(id);
    if (row === undefined) throw new WorksError(`${id} does not exist`);
    // And here for INV-W6's sake: fuel is the one good whose existence the map alone authorises, so
    // a ruin credited with any would be a permanent counter-example to "fuel exists only where the
    // map says it does" that no live-row filter would ever surface.
    if (row.razed) throw new WorksError(`${id} was razed at tick ${String(row.razedAtTick)} and yields no fuel`);
    row.fuelExtracted = qty(row.fuelExtracted + amount);
  }

  // ── THE HOT ANCHOR: FUEL BOUGHT ONCE A RECKONING, NOT ONCE A TICK ─────────

  /**
   * Record that a system's anchor has been fuelled for `reckoning`.
   *
   * Per Reckoning rather than per tick because a per-tick burn of a whole Reckoning's fuel would be
   * unpayable, and a per-tick burn of 1/288th of it would round to nothing at every published
   * figure. One purchase, one Reckoning, and `agent.md` can state the number.
   */
  lightAnchor(system: SystemId, reckoning: number): void {
    for (const [key, at] of [...this.hot.entries()]) {
      if (at !== reckoning) this.hot.delete(key);
    }
    this.hot.set(system, reckoning);
  }

  /** Has this system's anchor been fuelled for `reckoning`? */
  anchorHot(system: SystemId, reckoning: number): boolean {
    return this.hot.get(system) === reckoning;
  }

  get size(): number {
    return this.rows.size;
  }

  capture(): CanonicalValue {
    return {
      works: [...this.rows.values()]
        .sort((a, b) => compareIds(a.id, b.id))
        .map((w) => ({
          id: w.id,
          system: w.system,
          holder: w.holder,
          raisedAtTick: w.raisedAtTick,
          onlineAtTick: w.onlineAtTick,
          razed: w.razed,
          razedAtTick: w.razedAtTick,
          // Inside the hash, both of them. A ruin's Reckoning and its author are the only permanent
          // public record of who destroyed whose production; two worlds that disagreed about either
          // would hash the same, and THE RUIN is a projection over exactly these two fields.
          fellAtReckoning: w.fellAtReckoning,
          razedBy: w.razedBy,
          extracted: w.extracted,
          rentPaid: w.rentPaid,
          fuelExtracted: w.fuelExtracted,
        })),
      // Inside the hash for the same reason the rest of the book is: two worlds that disagree
      // about what a claim collected this Reckoning would hash the same, and an aborted tick
      // would leave the counter advanced against a posting that was rolled back.
      rent: [...this.rent.values()]
        .sort((a, b) => compareIds(a.system, b.system))
        .map((r) => ({
          system: r.system,
          reckoning: r.reckoning,
          claimant: r.claimant,
          taken: r.taken,
        })),
      // Inside the hash: two worlds that disagree about whether an anchor is fuelled disagree about
      // whether rent flows next tick, which is a value movement.
      hot: [...this.hot.entries()]
        .sort((a, b) => compareIds(a[0], b[0]))
        .map(([system, reckoning]) => ({ system, reckoning })),
    };
  }

  restore(captured: CanonicalValue): void {
    this.rows.clear();
    this.rent.clear();
    this.hot.clear();
    const root = readObject(captured, 'works');
    for (const [i, raw] of readArray(root['works'] ?? [], 'works.works').entries()) {
      const where = `works.works[${String(i)}]`;
      const o = readObject(raw, where);
      const razedAt = o['razedAtTick'];
      const fellAt = o['fellAtReckoning'];
      const razedBy = o['razedBy'];
      const row: WorksRecord = {
        id: readString(o, 'id', where) as WorksId,
        system: readString(o, 'system', where) as SystemId,
        holder: readString(o, 'holder', where) as PrincipalId,
        raisedAtTick: readInt(o, 'raisedAtTick', where),
        onlineAtTick: readInt(o, 'onlineAtTick', where),
        razed: readBool(o, 'razed', where),
        razedAtTick: razedAt === null || razedAt === undefined ? null : readInt(o, 'razedAtTick', where),
        // Tolerant, like `rentPaid` and `fuelExtracted` before them, and for a stronger reason than
        // either: **no snapshot in this world's history can contain a razed WORKS**, because nothing
        // could raze one until this version. So `undefined` here is not a missing field on a fallen
        // structure, it is a structure that never fell, and `null` is its true history. A strict
        // reader would refuse to restore the live world across this one deploy and refuse it on a
        // row where the honest answer is knowable.
        fellAtReckoning: fellAt === null || fellAt === undefined ? null : readInt(o, 'fellAtReckoning', where),
        razedBy: razedBy === null || razedBy === undefined ? null : (readString(o, 'razedBy', where) as PrincipalId),
        extracted: qty(readInt(o, 'extracted', where)),
        // Tolerant for exactly one deploy: a snapshot written before the rent landed has no
        // counter on its WORKS, and zero is the true history for a world in which no rent was
        // ever taken. Strictness would refuse to restore the live world across this deploy.
        rentPaid: qty(o['rentPaid'] === undefined ? 0 : readInt(o, 'rentPaid', where)),
        // Tolerant for one deploy, like `rentPaid`: a snapshot from before fuel existed recorded
        // none, and zero is the true history of a world in which none was ever extracted.
        fuelExtracted: qty(o['fuelExtracted'] === undefined ? 0 : readInt(o, 'fuelExtracted', where)),
      };
      if (this.rows.has(row.id)) throw new SnapshotError(`${where}: duplicate WORKS ${row.id}`);
      this.rows.set(row.id, row);
    }

    for (const [i, raw] of readArray(root['rent'] ?? [], 'works.rent').entries()) {
      const where = `works.rent[${String(i)}]`;
      const o = readObject(raw, where);
      const row: RentTally = {
        system: readString(o, 'system', where) as SystemId,
        reckoning: readInt(o, 'reckoning', where),
        claimant: readString(o, 'claimant', where) as PrincipalId,
        taken: qty(readInt(o, 'taken', where)),
      };
      if (this.rent.has(row.system)) throw new SnapshotError(`${where}: duplicate rent row for ${row.system}`);
      this.rent.set(row.system, row);
    }

    for (const [i, raw] of readArray(root['hot'] ?? [], 'works.hot').entries()) {
      const where = `works.hot[${String(i)}]`;
      const o = readObject(raw, where);
      const system = readString(o, 'system', where) as SystemId;
      if (this.hot.has(system)) throw new SnapshotError(`${where}: duplicate hot row for ${system}`);
      this.hot.set(system, readInt(o, 'reckoning', where));
    }
  }
}

/**
 * The WORKS book inside `state_hash` and the rollback set.
 *
 * Not optional and not a later step. A book that decides how many goods enter the world
 * every tick, sitting outside the hash, is the keystone defect the `EncumbranceBook` already
 * had once: two worlds that disagree about who is extracting what would hash the same, and
 * an aborted tick would leave the extraction counters advanced.
 */
export function worksStateTable(getBook: () => Book, setBook: (book: Book) => void): StateTable {
  return {
    name: 'works',
    capture(): CanonicalValue {
      return getBook().capture();
    },
    restore(captured: CanonicalValue): void {
      const fresh = new Book();
      fresh.restore(captured);
      setBook(fresh);
    },
  };
}

/** Local, like `sovereignty/book.ts`'s: the shared readers have no boolean. */
function readBool(o: Readonly<Record<string, CanonicalValue>>, key: string, where: string): boolean {
  const value = o[key];
  if (typeof value !== 'boolean') throw new SnapshotError(`${where}.${key} must be a boolean`);
  return value;
}
