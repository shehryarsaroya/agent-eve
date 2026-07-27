/**
 * The FLEET book: which HULLS exist, who owns them, where they are berthed, and which are wrecks.
 *
 * ── A HULL IS AN ASSET, NOT A STAT ──────────────────────────────────────────
 *
 * A5 requires that *"destruction removes the actual located asset"*, and §7 MUST-9 wants a
 * `loss_record` per hull with fit and provenance. So a hull is a row: located, owned, priceable, and
 * permanently marked when it dies. `WRECKED` rows are never deleted — the record is append-only and
 * A5 has no opt-out — which is also what lets a dossier say *"lost four CITADELs at Orison"* a
 * season later.
 *
 * ── A HULL DOES NOT TRAVEL, AND THAT IS THE CUT THAT PAYS FOR ITSELF ────────
 *
 * A hull is berthed where it was built and is committed only to a battle **at that system**. Force
 * projection is therefore a *production* problem: to fight at Orison you must have built at Orison,
 * which means having hauled {@link import('./params.js').HULL_COST_GOODS} there.
 *
 * What that costs: §9 of the pass — jump drives, bridges, cynos, staged reserves — is unreachable.
 * That whole section is explicitly gated (*"add only after counters work"*), so this is the pass's
 * own build order rather than a shortcut. What it buys is the thing `D23` says the build is missing
 * most: *"logistics as strategy"* becomes load-bearing for warfare specifically, and a fleet is
 * something somebody carried rather than something somebody bought.
 *
 * ── AND THE FIT IS FROZEN AT BUILD ──────────────────────────────────────────
 *
 * §1 MUST-8 exists to protect one property: *"staging infrastructure and supply intelligence matter
 * only if combatants cannot freely morph into the exact counter after seeing the enemy."* Freezing
 * the fit at build is the strongest possible version of that and costs no verb. The refit ladder —
 * `full_service` / `field_service` / `none`, repair, reload, re-rig — is the named deferral.
 */

import type { CanonicalValue } from '../core/canonical.js';
import { canonicalHash } from '../core/canonical.js';
import type { PrincipalId, SystemId } from '../core/types.js';
import { compareIds } from '../ledger/order.js';
import {
  readArray,
  readInt,
  readObject,
  readString,
  SnapshotError,
  type StateTable,
} from '../tick/snapshot.js';
import type { FitHash } from './fit.js';
import { HULL_FIT_TICKS, MAX_HULLS_PER_PRINCIPAL } from './params.js';

export type HullId = string & { readonly __brand: 'HullId' };

/**
 * Content-derived, with an ordinal folded into a hash the way `mintGrantId` does it.
 *
 * A bare counter would not survive replay: it is not in `capture()`, so a restarted world would
 * mint `hull:3` twice (DET-3/DET-5). Hashing `(system, tick, owner, ordinal)` gives a stable id from
 * inputs the snapshot already holds.
 */
export function hullIdFor(system: SystemId, tick: number, owner: PrincipalId, ordinal: number): HullId {
  return `hull:${String(tick)}:${canonicalHash({ system, tick, owner, ordinal }).slice(0, 10)}` as HullId;
}

/**
 * A hull's life. `READY` → `ENGAGED` → `READY`, or → `WRECKED`, which is terminal.
 *
 * **`ENGAGED` and not `COMMITTED`, and the repo-wide vocabulary guard is what found it.** `HandState`
 * already spends `COMMITTED` on a hand filled into a venture role, and
 * `test/core/vocabulary-repo.test.ts` refuses one member name in two unions without a sanctioned
 * reason — which is hard rule 4 enforced at the level below the canon table. A hull in a battle is
 * `ENGAGED`, which is §9A's own word for the thing it is in, so the state and the mechanic agree.
 */
export type HullState = 'FITTING' | 'READY' | 'ENGAGED' | 'WRECKED';

export interface HullRecord {
  readonly id: HullId;
  readonly owner: PrincipalId;
  /** Keys `HULLS` in the catalogue. */
  readonly hull: string;
  readonly fit: FitHash;
  /** The exact module list, so a wreck report can name what burned without a second lookup. */
  readonly modules: readonly string[];
  /** Where it is berthed. Fixed at build — see the file header. */
  readonly location: SystemId;
  readonly builtAtTick: number;
  /** Not committable before this. `builtAtTick + HULL_FIT_TICKS`. */
  readonly readyAtTick: number;
  state: HullState;
  wreckedAtTick: number | null;
  /** How many engagements it has come home from. The killmark, and purely narrative (§3 NICE-1). */
  battles: number;
}

export class FleetError extends Error {}

export class Fleet {
  private readonly rows = new Map<HullId, HullRecord>();

  // ── Writes ────────────────────────────────────────────────────────────────

  build(record: HullRecord): void {
    if (this.rows.has(record.id)) throw new FleetError(`hull ${record.id} already exists`);
    if (this.readyOrBusyOf(record.owner).length >= MAX_HULLS_PER_PRINCIPAL) {
      throw new FleetError(
        `${record.owner} already holds ${String(MAX_HULLS_PER_PRINCIPAL)} live hulls, which is the cap`,
      );
    }
    this.rows.set(record.id, record);
  }

  /** Mark a hull committed to a battle. Throws if it is not free — a hull cannot be in two fights. */
  commit(id: HullId): HullRecord {
    const row = this.require(id);
    if (row.state !== 'READY') {
      throw new FleetError(`hull ${id} is ${row.state}, not READY`);
    }
    row.state = 'ENGAGED';
    return row;
  }

  /** It came home. */
  release(id: HullId): void {
    const row = this.rows.get(id);
    if (row === undefined || row.state !== 'ENGAGED') return;
    row.state = 'READY';
    row.battles += 1;
  }

  /** It did not. Terminal, and the row stays forever (A5). */
  wreck(id: HullId, tick: number): HullRecord | undefined {
    const row = this.rows.get(id);
    if (row === undefined || row.state === 'WRECKED') return undefined;
    row.state = 'WRECKED';
    row.wreckedAtTick = tick;
    return row;
  }

  /** A hull whose fitting time has elapsed becomes committable. Called from the tick, not from a verb. */
  ready(tick: number): number {
    let readied = 0;
    for (const id of [...this.rows.keys()].sort(compareIds)) {
      const row = this.rows.get(id);
      if (row === undefined || row.state !== 'FITTING') continue;
      if (tick < row.readyAtTick) continue;
      row.state = 'READY';
      readied += 1;
    }
    return readied;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  get(id: HullId): HullRecord | undefined {
    return this.rows.get(id);
  }

  require(id: HullId): HullRecord {
    const row = this.rows.get(id);
    if (row === undefined) throw new FleetError(`no hull ${id}`);
    return row;
  }

  all(): readonly HullRecord[] {
    return [...this.rows.values()].sort((a, b) => compareIds(a.id, b.id));
  }

  of(owner: PrincipalId): readonly HullRecord[] {
    return this.all().filter((h) => h.owner === owner);
  }

  /** Everything not yet a wreck. What the per-principal cap counts. */
  readyOrBusyOf(owner: PrincipalId): readonly HullRecord[] {
    return this.of(owner).filter((h) => h.state !== 'WRECKED');
  }

  /** Committable right now, at a named system, canonical order. */
  readyAt(owner: PrincipalId, system: SystemId): readonly HullRecord[] {
    return this.of(owner).filter((h) => h.state === 'READY' && h.location === system);
  }

  /** How many hulls this principal has ever lost. The public loss record, per A5. */
  wrecksOf(owner: PrincipalId): number {
    return this.of(owner).filter((h) => h.state === 'WRECKED').length;
  }

  /** How many of each hull type stand at a system, across all owners. Used by the frame. */
  countAt(system: SystemId): number {
    return this.all().filter((h) => h.location === system && h.state !== 'WRECKED').length;
  }

  /** Next ordinal for a principal at a tick, so `hullIdFor` never collides inside one tick. */
  nextOrdinal(owner: PrincipalId, tick: number): number {
    return this.of(owner).filter((h) => h.builtAtTick === tick).length;
  }

  size(): number {
    return this.rows.size;
  }

  // ── Snapshot ──────────────────────────────────────────────────────────────

  capture(): CanonicalValue {
    return {
      hulls: this.all().map((h) => ({
        id: h.id,
        owner: h.owner,
        hull: h.hull,
        fit: h.fit,
        modules: [...h.modules],
        location: h.location,
        builtAtTick: h.builtAtTick,
        readyAtTick: h.readyAtTick,
        state: h.state,
        wreckedAtTick: h.wreckedAtTick,
        battles: h.battles,
      })),
    };
  }

  restore(captured: CanonicalValue): void {
    this.rows.clear();
    const root = readObject(captured, 'fleet');
    for (const [i, raw] of readArray(root['hulls'] ?? [], 'fleet.hulls').entries()) {
      const where = `fleet.hulls[${String(i)}]`;
      const o = readObject(raw, where);
      const wrecked = o['wreckedAtTick'];
      const row: HullRecord = {
        id: readString(o, 'id', where) as HullId,
        owner: readString(o, 'owner', where) as PrincipalId,
        hull: readString(o, 'hull', where),
        fit: readString(o, 'fit', where) as FitHash,
        modules: readArray(o['modules'] ?? [], `${where}.modules`).map(
          (m, j) => readString({ m }, 'm', `${where}.modules[${String(j)}]`),
        ),
        location: readString(o, 'location', where) as SystemId,
        builtAtTick: readInt(o, 'builtAtTick', where),
        readyAtTick: readInt(o, 'readyAtTick', where),
        state: asHullState(readString(o, 'state', where), where),
        wreckedAtTick: wrecked === null || wrecked === undefined ? null : readInt(o, 'wreckedAtTick', where),
        battles: readInt(o, 'battles', where),
      };
      if (this.rows.has(row.id)) throw new SnapshotError(`${where}: duplicate hull ${row.id}`);
      this.rows.set(row.id, row);
    }
  }
}

const HULL_STATES: ReadonlySet<string> = new Set(['FITTING', 'READY', 'ENGAGED', 'WRECKED']);

function asHullState(value: string, where: string): HullState {
  if (!HULL_STATES.has(value)) throw new SnapshotError(`${where}.state: ${value} is not a hull state`);
  return value as HullState;
}

/** The fitting-out clock, exposed so the affordance can quote it rather than restating it. */
export function readyAtFor(builtAtTick: number): number {
  return builtAtTick + HULL_FIT_TICKS;
}

/**
 * The fleet book inside `state_hash` and the rollback set.
 *
 * Not optional: a book that decides which assets can be destroyed, sitting outside the hash, means
 * an aborted tick leaves a hull marked WRECKED against a goods destruction that was rolled back —
 * which is A5′ (*"the record must never be wrong"*) with a warship in it.
 */
export function fleetStateTable(getFleet: () => Fleet, setFleet: (fleet: Fleet) => void): StateTable {
  return {
    name: 'fleet',
    capture(): CanonicalValue {
      return getFleet().capture();
    },
    restore(captured: CanonicalValue): void {
      const fresh = new Fleet();
      fresh.restore(captured);
      setFleet(fresh);
    },
  };
}
