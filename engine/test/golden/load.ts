/**
 * Golden-file loader.
 *
 * The golden files ARE the cross-platform contract. DET-4 wants "identical
 * hashes on macOS and Linux", and one test process cannot host two operating
 * systems — so instead every host must reproduce the exact strings committed
 * here. A Linux CI run that disagrees is DET-4 firing.
 *
 * Loading is validated rather than trusted: a golden file with a missing column
 * would otherwise make its test silently vacuous, which is the worst possible
 * outcome for a file whose whole job is to be an oracle.
 */

import { readFileSync } from 'node:fs';
import type { CanonicalValue } from '../../src/core/canonical.js';

/** The golden files, by name. Exported so a test can assert properties of the raw text. */
export const GOLDEN_FILES = [
  'canonical.json',
  'canonical-edge.json',
  'rng.json',
  'units.json',
  'time.json',
] as const;

export function readGoldenText(file: string): string {
  return readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
}

function read(file: string): unknown {
  return JSON.parse(readGoldenText(file)) as unknown;
}

/**
 * The canonicaliser version each golden file was written against. A bump to
 * `CANONICAL_VERSION` changes every hash in this directory, so the handshake is
 * asserted rather than assumed — otherwise a version bump would present as dozens
 * of unexplained hash failures.
 */
export function goldenCanonicalVersion(file: string): number {
  const doc = read(file);
  if (!isRecord(doc)) throw new Error(`golden ${file}: not an object`);
  const meta = doc.__meta;
  if (!isRecord(meta)) throw new Error(`golden ${file}: missing __meta`);
  return requireNumber(meta, 'canonical_version', `${file}.__meta`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(row: Record<string, unknown>, key: string, where: string): string {
  const v = row[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`golden ${where}: '${key}' must be a non-empty string`);
  }
  return v;
}

function requireNumber(row: Record<string, unknown>, key: string, where: string): number {
  const v = row[key];
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw new Error(`golden ${where}: '${key}' must be a safe integer`);
  }
  return v;
}

function requireIntArray(row: Record<string, unknown>, key: string, where: string): number[] {
  const v = row[key];
  if (!Array.isArray(v) || v.length === 0) {
    throw new Error(`golden ${where}: '${key}' must be a non-empty array`);
  }
  return v.map((x, i) => {
    if (typeof x !== 'number' || !Number.isSafeInteger(x)) {
      throw new Error(`golden ${where}: '${key}[${i}]' must be a safe integer`);
    }
    return x;
  });
}

function rows(doc: unknown, key: string, file: string): Record<string, unknown>[] {
  if (!isRecord(doc)) throw new Error(`golden ${file}: not an object`);
  const list = doc[key];
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`golden ${file}: '${key}' must be a non-empty array`);
  }
  return list.map((r, i) => {
    if (!isRecord(r)) throw new Error(`golden ${file}: ${key}[${i}] is not an object`);
    return r;
  });
}

// ── canonical.json ──────────────────────────────────────────────────────────

export interface CanonicalGoldenCase {
  readonly name: string;
  readonly note: string;
  /** The input, carried as JSON so the file reads as a contract rather than a blob. */
  readonly value: CanonicalValue;
  readonly canonical: string;
  readonly hash: string;
}

export function loadCanonicalGolden(): readonly CanonicalGoldenCase[] {
  const doc = read('canonical.json');
  return rows(doc, 'cases', 'canonical.json').map((r, i) => {
    const where = `canonical.json[${i}]`;
    // `value` may legitimately be null/false/0, so it is checked for presence
    // rather than truthiness — a missing key must fail, a falsy one must not.
    if (!('value' in r)) throw new Error(`golden ${where}: missing 'value'`);
    return {
      name: requireString(r, 'name', where),
      note: requireString(r, 'note', where),
      value: r.value as CanonicalValue,
      canonical: requireString(r, 'canonical', where),
      hash: requireString(r, 'hash', where),
    };
  });
}

// ── canonical-edge.json ─────────────────────────────────────────────────────

export interface CanonicalEdgeCase {
  readonly name: string;
  readonly note: string;
  readonly canonical: string;
  readonly hash: string;
}

export interface CanonicalEdgeGolden {
  readonly cases: readonly CanonicalEdgeCase[];
  /** Names that must hash identically. The equality is the assertion, not an excuse. */
  readonly aliases: readonly (readonly [string, string])[];
}

export function loadCanonicalEdgeGolden(): CanonicalEdgeGolden {
  const doc = read('canonical-edge.json');
  const cases = rows(doc, 'cases', 'canonical-edge.json').map((r, i) => {
    const where = `canonical-edge.json[${i}]`;
    return {
      name: requireString(r, 'name', where),
      note: requireString(r, 'note', where),
      canonical: requireString(r, 'canonical', where),
      hash: requireString(r, 'hash', where),
    };
  });
  if (!isRecord(doc)) throw new Error('golden canonical-edge.json: not an object');
  const rawAliases = doc.aliases;
  if (!Array.isArray(rawAliases)) {
    throw new Error("golden canonical-edge.json: 'aliases' must be an array");
  }
  // Re-typed as unknown[] on purpose: Array.isArray narrows to any[], and an `any`
  // here would switch off checking for the rest of the loader.
  const aliasList: unknown[] = rawAliases as unknown[];
  const aliases = aliasList.map((pair, i) => {
    if (!Array.isArray(pair)) {
      throw new Error(`golden canonical-edge.json: aliases[${i}] must be a pair`);
    }
    const items: unknown[] = pair as unknown[];
    const a = items[0];
    const b = items[1];
    if (items.length !== 2 || typeof a !== 'string' || typeof b !== 'string') {
      throw new Error(`golden canonical-edge.json: aliases[${i}] must be two names`);
    }
    return [a, b] as const;
  });
  return { cases, aliases };
}

// ── rng.json ────────────────────────────────────────────────────────────────

export interface RngGolden {
  readonly seed: string;
  readonly seedHash: string;
  readonly rawDraws16: readonly number[];
  readonly derivedStreams: ReadonlyMap<string, readonly number[]>;
  readonly int6: readonly number[];
  readonly rangeNeg3To3: readonly number[];
  readonly chance1In3: readonly boolean[];
  readonly shuffle10: readonly string[];
  readonly pickFrom5: readonly string[];
  readonly drawsAfter16Raw: number;
}

export function loadRngGolden(): RngGolden {
  const doc = read('rng.json');
  if (!isRecord(doc)) throw new Error('golden rng.json: not an object');
  const derivedRaw = doc.derived_streams_4;
  if (!isRecord(derivedRaw)) throw new Error("golden rng.json: 'derived_streams_4' must be an object");
  const derived = new Map<string, readonly number[]>();
  for (const [label, seq] of Object.entries(derivedRaw)) {
    if (!Array.isArray(seq) || seq.length === 0) {
      throw new Error(`golden rng.json: derived stream '${label}' must be a non-empty array`);
    }
    derived.set(
      label,
      seq.map((x) => {
        if (typeof x !== 'number' || !Number.isSafeInteger(x)) {
          throw new Error(`golden rng.json: derived stream '${label}' holds a non-integer`);
        }
        return x;
      }),
    );
  }
  const chance = doc.chance_1_in_3_x_24;
  if (!Array.isArray(chance) || chance.some((b) => typeof b !== 'boolean')) {
    throw new Error("golden rng.json: 'chance_1_in_3_x_24' must be an array of booleans");
  }
  const strArray = (key: string): string[] => {
    const v = doc[key];
    if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) {
      throw new Error(`golden rng.json: '${key}' must be an array of strings`);
    }
    return v as string[];
  };
  return {
    seed: requireString(doc, 'seed', 'rng.json'),
    seedHash: requireString(doc, 'seed_hash', 'rng.json'),
    rawDraws16: requireIntArray(doc, 'raw_draws_16', 'rng.json'),
    derivedStreams: derived,
    int6: requireIntArray(doc, 'int_6_x_24', 'rng.json'),
    rangeNeg3To3: requireIntArray(doc, 'range_neg3_to_3_x_16', 'rng.json'),
    chance1In3: chance as boolean[],
    shuffle10: strArray('shuffle_10'),
    pickFrom5: strArray('pick_from_5_x_12'),
    drawsAfter16Raw: requireNumber(doc, 'draws_after_16_raw', 'rng.json'),
  };
}

// ── units.json ──────────────────────────────────────────────────────────────

export interface SplitGoldenCase {
  readonly name: string;
  readonly note: string;
  readonly amount: number;
  readonly weights: readonly number[];
  readonly parts: readonly number[];
}

export function loadSplitGolden(): readonly SplitGoldenCase[] {
  const doc = read('units.json');
  return rows(doc, 'splits', 'units.json').map((r, i) => {
    const where = `units.json[${i}]`;
    const weights = r.weights;
    const parts = r.parts;
    if (!Array.isArray(weights) || !Array.isArray(parts)) {
      throw new Error(`golden ${where}: 'weights' and 'parts' must be arrays`);
    }
    if (weights.length !== parts.length) {
      throw new Error(`golden ${where}: one part per weight, always`);
    }
    return {
      name: requireString(r, 'name', where),
      note: requireString(r, 'note', where),
      amount: requireNumber(r, 'amount', where),
      weights: weights as number[],
      parts: parts as number[],
    };
  });
}

// ── time.json ───────────────────────────────────────────────────────────────

export interface PhaseBand {
  readonly first: number;
  readonly last: number;
  readonly count: number;
}

export interface TimeSpot {
  readonly tick: number;
  readonly phase: number;
  readonly inCommitmentWindow: boolean;
  readonly inFreeze: boolean;
  readonly isSettlementTick: boolean;
}

export interface TimeGolden {
  readonly ticksPerReckoning: number;
  readonly commitmentWindowTicksConstant: number;
  readonly freezeTicksConstant: number;
  readonly bands: ReadonlyMap<string, PhaseBand>;
  readonly spots: readonly TimeSpot[];
}

export function loadTimeGolden(): TimeGolden {
  const doc = read('time.json');
  if (!isRecord(doc)) throw new Error('golden time.json: not an object');
  const phases = doc.phases;
  if (!isRecord(phases)) throw new Error("golden time.json: 'phases' must be an object");
  const bands = new Map<string, PhaseBand>();
  for (const [name, band] of Object.entries(phases)) {
    if (!isRecord(band)) throw new Error(`golden time.json: band '${name}' must be an object`);
    bands.set(name, {
      first: requireNumber(band, 'first', `time.json.phases.${name}`),
      last: requireNumber(band, 'last', `time.json.phases.${name}`),
      count: requireNumber(band, 'count', `time.json.phases.${name}`),
    });
  }
  const spotRows = rows(doc, 'spot', 'time.json');
  const spots = spotRows.map((r, i) => {
    const where = `time.json.spot[${i}]`;
    for (const k of ['in_commitment_window', 'in_freeze', 'is_settlement_tick']) {
      if (typeof r[k] !== 'boolean') throw new Error(`golden ${where}: '${k}' must be a boolean`);
    }
    return {
      tick: requireNumber(r, 'tick', where),
      phase: requireNumber(r, 'phase', where),
      inCommitmentWindow: r.in_commitment_window === true,
      inFreeze: r.in_freeze === true,
      isSettlementTick: r.is_settlement_tick === true,
    };
  });
  return {
    ticksPerReckoning: requireNumber(doc, 'ticks_per_reckoning', 'time.json'),
    commitmentWindowTicksConstant: requireNumber(doc, 'commitment_window_ticks_constant', 'time.json'),
    freezeTicksConstant: requireNumber(doc, 'freeze_ticks_constant', 'time.json'),
    bands,
    spots,
  };
}
