/**
 * `state_hash`, the snapshot, and the rollback that makes "publish nothing" true.
 *
 * Three things are the same object here, and that is deliberate:
 *
 *   - **`state_hash` at tick boundaries.** §15.1: "drop per-event state hashing;
 *     hash at tick boundaries only." So there is exactly one hash per tick and it
 *     is a hash of every state table's canonical capture.
 *   - **The snapshot in `(snapshot_T, action_log_T, seed_T)`.** §15.1's correction
 *     is that replay's input is a snapshot and an action log — *events are output,
 *     not input*. Building observations by folding an event stream is the
 *     event-sourcing cliff, and it makes `expected_state_version` incoherent.
 *   - **The rollback for an aborted tick.** §15.2: "abort the tick and halt. Never
 *     publish a broken tick." In a single-writer in-memory sim the phases have
 *     already mutated state by the time `ASSERT` fires, so aborting *means*
 *     restoring the capture taken at the top of the tick. Without that, "abort"
 *     leaves a half-resolved world that no observer was ever promised.
 *
 * Because all three are one mechanism, the snapshot is exercised every tick in
 * production rather than only by DET-3 — which is the difference between a replay
 * path that works and one that has never been run.
 *
 * **What is not in the hash, and why:** `status` (RUNNING / PAUSED). It is
 * operational, not world state. If it were hashed, a halted-then-resumed tick
 * would produce a different hash from the one every observer was promised, and
 * E2E-31's whole claim is that it produces the same world.
 */

import { canonicalHash, type CanonicalValue } from '../core/canonical.js';
import type { GoodId, HandId, HandState, PrincipalId, SystemId } from '../core/types.js';
import { qty, type Qty } from '../core/units.js';
import {
  cmpHands,
  createHands,
  createHolding,
  HANDS_PER_PRINCIPAL,
  holdingsInOrder,
  handsInOrder,
  mapHash,
  type HandRecord,
  type HoldingRecord,
  type HoldingState,
  type WorldState,
} from '../world/index.js';

export class SnapshotError extends Error {}

/**
 * One participant in the state hash.
 *
 * `restore` is optional for exactly one reason, stated so it is not mistaken for
 * a design choice: wave 1's `Ledger` exposes `stateHash()` but no restore path, so
 * it can contribute to the hash and cannot be rolled back. A table without
 * `restore` makes the abort path *incomplete*, and {@link rollbackGaps} names
 * which ones, so a halt report can say honestly what it could not undo instead of
 * claiming a clean abort.
 */
export interface StateTable {
  readonly name: string;
  /** Canonical: sorted, integers only, no `undefined`. Throws on a float. */
  capture(): CanonicalValue;
  restore?(captured: CanonicalValue): void;
}

/** Tables that cannot be rolled back, in name order. Empty is the healthy case. */
export function rollbackGaps(tables: readonly StateTable[]): readonly string[] {
  return tables
    .filter((t) => t.restore === undefined)
    .map((t) => t.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The immutable first term of §15.2's input triple. */
export interface Snapshot {
  /** The tick this snapshot is *after*. Ticks resolve into `tick + 1`. */
  readonly tick: number;
  readonly stateVersion: number;
  /** `[name, capture]` pairs, sorted by name so the hash cannot depend on wiring. */
  readonly tables: readonly (readonly [string, CanonicalValue])[];
  /** The hash of this snapshot. Published; agents and viewers compare it. */
  readonly stateHash: string;
}

const SNAPSHOT_VERSION = 1;

function tablePairs(tables: readonly StateTable[]): (readonly [string, CanonicalValue])[] {
  const names = new Set<string>();
  const pairs: (readonly [string, CanonicalValue])[] = [];
  for (const table of tables) {
    if (names.has(table.name)) {
      // Two tables under one name would silently hash only one of them, which is
      // a state_hash that cannot see part of the state — the worst possible shape
      // of bug for a record whose only claim is reproducibility.
      throw new SnapshotError(`two state tables are both named '${table.name}'`);
    }
    names.add(table.name);
    pairs.push([table.name, table.capture()] as const);
  }
  return pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function captureSnapshot(
  tables: readonly StateTable[],
  tick: number,
  stateVersion: number,
): Snapshot {
  const pairs = tablePairs(tables);
  const stateHash = canonicalHash({
    v: SNAPSHOT_VERSION,
    tick,
    stateVersion,
    tables: pairs.map(([name, value]) => [name, value] as CanonicalValue),
  });
  return { tick, stateVersion, tables: pairs, stateHash };
}

/**
 * Put every table back exactly as captured.
 *
 * Refuses on a table it does not recognise, and on a table it cannot restore.
 * Silently skipping either would produce a world that *looks* restored — which is
 * the class of failure `TESTING.md` §0 calls out: two of the predecessor's worst
 * bugs presented as a perfectly healthy system.
 */
export function restoreSnapshot(tables: readonly StateTable[], snapshot: Snapshot): void {
  const byName = new Map(tables.map((t) => [t.name, t] as const));
  const problems: string[] = [];

  for (const [name, captured] of snapshot.tables) {
    const table = byName.get(name);
    if (table === undefined) {
      problems.push(`the snapshot holds table '${name}', which this engine does not have`);
      continue;
    }
    if (table.restore === undefined) {
      problems.push(`table '${name}' has no restore path, so it cannot be rolled back`);
      continue;
    }
    table.restore(captured);
  }
  for (const name of byName.keys()) {
    if (!snapshot.tables.some(([n]) => n === name)) {
      problems.push(`table '${name}' is not in the snapshot, so restoring would leave it at the wrong tick`);
    }
  }
  if (problems.length > 0) {
    throw new SnapshotError(`snapshot restore refused:\n  - ${problems.join('\n  - ')}`);
  }
}

// ── Canonical reading ───────────────────────────────────────────────────────
// Small, loud readers. A snapshot is machine-written, so a shape error here is a
// bug in this file rather than bad input — which is exactly why it must throw
// instead of coercing.

function asObject(v: CanonicalValue, where: string): { readonly [k: string]: CanonicalValue } {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new SnapshotError(`${where}: expected an object`);
  }
  // `Array.isArray` does not narrow a `readonly T[]` member out of the union, so
  // the assertion carries what the guard above has already established.
  return v as { readonly [k: string]: CanonicalValue };
}

function asArray(v: CanonicalValue, where: string): readonly CanonicalValue[] {
  if (!Array.isArray(v)) throw new SnapshotError(`${where}: expected an array`);
  // `Array.isArray` widens to `any[]`, which the lint correctly distrusts; the
  // union already tells us the only array member is `readonly CanonicalValue[]`.
  return v as readonly CanonicalValue[];
}

function str(o: { readonly [k: string]: CanonicalValue }, key: string, where: string): string {
  const v = o[key];
  if (typeof v !== 'string') throw new SnapshotError(`${where}.${key}: expected a string`);
  return v;
}

function int(o: { readonly [k: string]: CanonicalValue }, key: string, where: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw new SnapshotError(`${where}.${key}: expected a safe integer`);
  }
  return v;
}

function intOrNull(
  o: { readonly [k: string]: CanonicalValue },
  key: string,
  where: string,
): number | null {
  const v = o[key];
  if (v === null) return null;
  return int(o, key, where);
}

function strOrNull(
  o: { readonly [k: string]: CanonicalValue },
  key: string,
  where: string,
): string | null {
  const v = o[key];
  if (v === null) return null;
  return str(o, key, where);
}

export { asObject as readObject, asArray as readArray, str as readString, int as readInt };
export { intOrNull as readIntOrNull, strOrNull as readStringOrNull };

/**
 * Validate action parameters as canonical, and return them as such.
 *
 * A standing intent stores the parameters it will replay for days. If they are not
 * canonical — a float, a `Date`, a function, a cycle — the snapshot cannot hold
 * them and the intent becomes unreplayable *later*, in a tick nobody is watching.
 * So the check happens at creation, where it can still be a hint to an agent
 * instead of a halt. This is the same argument `canonical.ts` makes for
 * `terms_hash`: an ambiguous serialisation reads to an agent as a counterparty
 * reneging.
 */
export function canonicalParams(params: Readonly<Record<string, unknown>>, where: string): CanonicalValue {
  return canonicalScalar(params, where, 0);
}

function canonicalScalar(value: unknown, where: string, depth: number): CanonicalValue {
  if (depth > 8) throw new SnapshotError(`${where}: nested deeper than 8 levels`);
  if (value === null) return null;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return value;
    case 'number':
      if (!Number.isSafeInteger(value)) {
        throw new SnapshotError(
          `${where}: ${String(value)} is not a safe integer. Money is minor units and shares are basis points; ` +
            `no float may reach a hashed structure.`,
        );
      }
      return value;
    case 'object': {
      if (Array.isArray(value)) {
        return value.map((v, i) => canonicalScalar(v, `${where}[${String(i)}]`, depth + 1));
      }
      const out: Record<string, CanonicalValue> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === undefined) continue; // absent, not null
        out[k] = canonicalScalar(v, `${where}.${k}`, depth + 1);
      }
      return out;
    }
    case 'undefined':
    case 'bigint':
    case 'symbol':
    case 'function':
      // Named individually rather than caught by a `default`, so a JS type added in
      // future is a compile error here instead of a silent pass into a hash.
      throw new SnapshotError(`${where}: ${typeof value} cannot be serialised canonically`);
  }
  // Unreachable: the switch covers every `typeof` result. Present because the
  // compiler does not treat a `typeof` switch over `unknown` as exhaustive, and
  // falling out of this function returning `undefined` would put an `undefined`
  // into a canonical structure — the one thing `canonical.ts` refuses outright.
  throw new SnapshotError(`${where}: unreachable — unclassifiable value`);
}

/** Read canonical parameters back out of a capture. */
export function readCanonicalParams(value: CanonicalValue, where: string): Readonly<Record<string, unknown>> {
  return asObject(value, where);
}

// ── The world's table ───────────────────────────────────────────────────────

const HAND_STATE_SET: ReadonlySet<string> = new Set<HandState>([
  'IDLE',
  'IN_TRANSIT',
  'COMMITTED',
  'RECOVERING',
]);
const HOLDING_STATE_SET: ReadonlySet<string> = new Set<HoldingState>(['INTACT', 'FALLEN']);

function cargoPairs(cargo: ReadonlyMap<GoodId, Qty>): CanonicalValue {
  return [...cargo.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([good, amount]) => [good, amount] as CanonicalValue);
}

/**
 * The presence tables as a capture/restore pair.
 *
 * **The map is not captured, only its hash.** The map is authored and pinned
 * (`launchMap` is generated from a fixed seed and golden-filed), so it is not
 * mutable state — but restoring into the *wrong* map would silently move every
 * hand, so the hash is compared and the restore refuses on a mismatch.
 *
 * `handsByPrincipal` and `holdingByPrincipal` are **derived** on restore rather
 * than captured. They are indexes over the same rows, and capturing them too
 * would put one quantity in two homes — scar #5, whose loss handler destroyed
 * exactly 2× the real value.
 */
export function worldStateTable(world: WorldState): StateTable {
  return {
    name: 'world',
    capture(): CanonicalValue {
      return {
        mapHash: mapHash(world.map),
        // Enrolment order, not sorted: it is the order the world was built in and
        // a restore must reproduce it, because future seating reads the sequence.
        principals: [...world.principalOrder],
        holdings: holdingsInOrder(world).map((h) => ({
          id: h.id,
          principal: h.principal,
          name: h.name,
          system: h.system,
          state: h.state,
          fellAtReckoning: h.fellAtReckoning,
        })),
        hands: handsInOrder(world).map((h) => ({
          id: h.id,
          principal: h.principal,
          ordinal: h.ordinal,
          state: h.state,
          location: h.location,
          destination: h.destination,
          freeAtTick: h.freeAtTick,
          departedAtTick: h.departedAtTick,
          presentSinceTick: h.presentSinceTick,
          cargo: cargoPairs(h.cargo),
        })),
      };
    },
    restore(captured: CanonicalValue): void {
      const root = asObject(captured, 'world');
      const expectedMap = str(root, 'mapHash', 'world');
      const actualMap = mapHash(world.map);
      if (expectedMap !== actualMap) {
        throw new SnapshotError(
          `world snapshot was taken on map ${expectedMap} but this engine holds ${actualMap}; ` +
            `restoring would move every hand to a place that does not exist`,
        );
      }

      const principals = asArray(root['principals'] ?? [], 'world.principals').map((p, i) => {
        if (typeof p !== 'string') throw new SnapshotError(`world.principals[${i}]: expected a string`);
        return p as PrincipalId;
      });

      const holdings = asArray(root['holdings'] ?? [], 'world.holdings').map((raw, i) =>
        readHolding(raw, `world.holdings[${i}]`),
      );
      const hands = asArray(root['hands'] ?? [], 'world.hands').map((raw, i) =>
        readHand(raw, `world.hands[${i}]`),
      );

      world.hands.clear();
      world.holdings.clear();
      world.principalOrder.length = 0;
      world.handsByPrincipal.clear();
      world.holdingByPrincipal.clear();

      for (const p of principals) world.principalOrder.push(p);
      for (const holding of holdings) {
        world.holdings.set(holding.id, holding);
        world.holdingByPrincipal.set(holding.principal, holding.id);
      }
      // Rebuild the index from the rows, in canonical order. Deriving rather than
      // reading a captured copy is what keeps INV-7 true through a restore.
      const byPrincipal = new Map<PrincipalId, HandId[]>();
      for (const hand of [...hands].sort(cmpHands)) {
        world.hands.set(hand.id, hand);
        const ids = byPrincipal.get(hand.principal) ?? [];
        ids.push(hand.id);
        byPrincipal.set(hand.principal, ids);
      }
      for (const [principal, ids] of byPrincipal) {
        if (ids.length !== HANDS_PER_PRINCIPAL) {
          throw new SnapshotError(
            `INV-8: the snapshot gives ${principal} ${ids.length} hands, not ${HANDS_PER_PRINCIPAL}`,
          );
        }
        world.handsByPrincipal.set(principal, ids);
      }
    },
  };
}

function readHolding(raw: CanonicalValue, where: string): HoldingRecord {
  const o = asObject(raw, where);
  const principal = str(o, 'principal', where) as PrincipalId;
  const holding = createHolding(principal, str(o, 'name', where), str(o, 'system', where) as SystemId);
  const id = str(o, 'id', where);
  if (holding.id !== id) {
    throw new SnapshotError(`${where}: holding id ${id} is not derivable from principal ${principal}`);
  }
  const state = str(o, 'state', where);
  if (!HOLDING_STATE_SET.has(state)) throw new SnapshotError(`${where}: unknown holding state ${state}`);
  holding.state = state as HoldingState;
  holding.fellAtReckoning = intOrNull(o, 'fellAtReckoning', where);
  return holding;
}

function readHand(raw: CanonicalValue, where: string): HandRecord {
  const o = asObject(raw, where);
  const principal = str(o, 'principal', where) as PrincipalId;
  const ordinal = int(o, 'ordinal', where);
  const location = str(o, 'location', where) as SystemId;
  const presentSinceTick = int(o, 'presentSinceTick', where);

  // Built through the world module's own constructor so the id derivation stays
  // in one place (`handIdFor`). A literal here would be a second home for the id
  // rule, and ids are referenced by the append-only ledger forever.
  const trio = createHands(principal, location, presentSinceTick);
  const hand = trio.find((h) => h.ordinal === ordinal);
  if (hand === undefined) {
    throw new SnapshotError(
      `${where}: ordinal ${ordinal} is outside 1..${HANDS_PER_PRINCIPAL}; a principal has exactly that many hands`,
    );
  }
  const id = str(o, 'id', where);
  if (hand.id !== id) {
    throw new SnapshotError(`${where}: hand id ${id} is not derivable from ${principal} ordinal ${ordinal}`);
  }
  const state = str(o, 'state', where);
  if (!HAND_STATE_SET.has(state)) throw new SnapshotError(`${where}: unknown hand state ${state}`);
  hand.state = state as HandState;
  hand.destination = strOrNull(o, 'destination', where) as SystemId | null;
  hand.freeAtTick = intOrNull(o, 'freeAtTick', where);
  hand.departedAtTick = intOrNull(o, 'departedAtTick', where);
  hand.presentSinceTick = presentSinceTick;

  const cargo = new Map<GoodId, Qty>();
  for (const [i, entry] of asArray(o['cargo'] ?? [], `${where}.cargo`).entries()) {
    const pair = asArray(entry, `${where}.cargo[${i}]`);
    const good = pair[0];
    const amount = pair[1];
    if (typeof good !== 'string' || typeof amount !== 'number') {
      throw new SnapshotError(`${where}.cargo[${i}]: expected [good, qty]`);
    }
    cargo.set(good as GoodId, qty(amount));
  }
  hand.cargo = cargo;
  return hand;
}

/**
 * A participant that can be hashed but not rolled back.
 *
 * The honest adapter for wave 1's `Ledger` and `EventLedger`, both of which expose
 * a hash and neither of which has a restore. Registering one makes the abort path
 * *incomplete* and {@link rollbackGaps} will say so — which is the point. A silent
 * partial rollback in an append-only ledger is what §15.3 calls unrecoverable by
 * construction.
 */
export function hashOnlyTable(name: string, hash: () => string): StateTable {
  return {
    name,
    capture(): CanonicalValue {
      return { hash: hash() };
    },
  };
}
