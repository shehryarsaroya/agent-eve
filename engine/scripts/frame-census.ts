#!/usr/bin/env tsx
/**
 * ★ THE FRAME CENSUS — rows per key, and rows per NON-DEFAULT field.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **THIS EXISTS BECAUSE A FIELD THAT IS ALWAYS ZERO IS INDISTINGUISHABLE FROM A FIELD THAT DOES NOT
 * EXIST**, and at the pixel layer that has now cost this project eleven separate gaps at once.
 *
 * The A13 audit of 2026-07-30 found them by writing two throwaway scripts, running four worlds, and
 * censusing 21 archived frames by hand. Its own closing recommendation was that *"a standing
 * `scripts/frame-census.ts` printing rows per key and rows per non-default field, run after any change
 * an agent can see, would have caught GAP 2, GAP 7 and GAP 8 on the day each landed."* This is that
 * script.
 *
 * Two censuses, because the two frames fail differently:
 *
 *   - the **Reckoning** frame is a daily digest, so the question is *which keys are empty and which
 *     load-bearing fields are constant*;
 *   - the **live** frame is motion, so the question is *does anything CHANGE between consecutive
 *     ticks* — and `MOVED` is the column that answers it. A field non-zero once and a field counting
 *     down are different claims, and only a sequence tells them apart.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Usage:
 *   tsx scripts/frame-census.ts [--seed g01] [--reckonings 6] [--principals 16]
 *
 * Writes nothing outside a temp directory it removes on the way out.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TICKS_PER_RECKONING } from '../src/core/time.js';
import { DEFAULT_ARGS, runSim } from '../src/sim/cli.js';

interface Args {
  readonly seed: string;
  readonly reckonings: number;
  readonly principals: number;
}

function parse(argv: readonly string[]): Args {
  let out: Args = { seed: 'g01', reckonings: 6, principals: 16 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--seed' && value !== undefined) {
      out = { ...out, seed: value };
      i += 1;
    } else if (flag === '--reckonings' && value !== undefined) {
      out = { ...out, reckonings: Number(value) };
      i += 1;
    } else if (flag === '--principals' && value !== undefined) {
      out = { ...out, principals: Number(value) };
      i += 1;
    }
  }
  return out;
}

type Row = Readonly<Record<string, unknown>>;

/** Is this value the *absence* of information? The census's whole definition of "says nothing". */
function isDefault(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (v === 0 || v === false || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function tallyRows(rows: readonly Row[], into: Map<string, { rows: number; nonDefault: number }>): void {
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      const acc = into.get(k) ?? { rows: 0, nonDefault: 0 };
      acc.rows += 1;
      if (!isDefault(v)) acc.nonDefault += 1;
      into.set(k, acc);
    }
  }
}

function census(label: string, frames: readonly Row[]): void {
  process.stdout.write(`\n── ${label}: ${String(frames.length)} frames ${'─'.repeat(Math.max(0, 46 - label.length))}\n`);
  const keys = new Set<string>();
  for (const f of frames) for (const k of Object.keys(f)) keys.add(k);
  const ordered = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  for (const key of ordered) {
    const values = frames.map((f) => f[key]);
    if (!values.some((v) => Array.isArray(v))) continue;
    const rows: Row[] = [];
    for (const v of values) if (Array.isArray(v)) for (const r of v as unknown[]) if (typeof r === 'object' && r !== null) rows.push(r as Row);
    const total = values.reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
    const fields = new Map<string, { rows: number; nonDefault: number }>();
    tallyRows(rows, fields);
    const dead = [...fields.entries()].filter(([, a]) => a.nonDefault === 0).map(([k]) => k);
    const flag = total === 0 ? ' ⚑ EMPTY' : dead.length > 0 ? ` ⚑ ${String(dead.length)} DEAD` : '';
    process.stdout.write(`  ${key.padEnd(18)} rows ${String(total).padStart(5)}${flag}\n`);
    if (dead.length > 0 && total > 0) {
      process.stdout.write(`    always-default: ${dead.join(' ')}\n`);
    }
    // A state set with one member is a rule that never discriminates — the repo's own named class.
    for (const name of ['state', 'kind', 'legend', 'phase']) {
      const seen = new Set(rows.map((r) => r[name]).filter((v) => typeof v === 'string'));
      if (seen.size > 0 && name !== 'legend') {
        process.stdout.write(`    ${name}: ${[...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(' · ')}${seen.size === 1 ? '  ⚑ ONE VALUE' : ''}\n`);
      }
    }
  }
}

/** ★ The live frame's own question: does anything change from one tick to the next? */
function motion(frames: readonly Row[]): void {
  process.stdout.write(`\n── ★ MOTION across ${String(frames.length)} consecutive live frames ─────────\n`);
  if (frames.length < 2) {
    process.stdout.write('  fewer than two frames; nothing to compare\n');
    return;
  }
  const keys = new Set<string>();
  for (const f of frames) for (const k of Object.keys(f)) keys.add(k);
  for (const key of [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    let changed = 0;
    for (let i = 1; i < frames.length; i += 1) {
      if (JSON.stringify(frames[i]?.[key]) !== JSON.stringify(frames[i - 1]?.[key])) changed += 1;
    }
    const pct = Math.round((changed * 100) / (frames.length - 1));
    process.stdout.write(
      `  ${key.padEnd(18)} moved on ${String(changed).padStart(5)} / ${String(frames.length - 1)} ticks (${String(pct)}%)` +
        `${changed === 0 ? '  ⚑ FROZEN' : ''}\n`,
    );
  }

  // ── THE FIVE CLAIMS THE PROMPT ASKED FOR, EACH AS A COUNTED FACT ───────────
  const countdowns: number[] = [];
  let gapMoves = 0;
  let formings = 0;
  let demanded = 0;
  let drawn = 0;
  const liveBattleStates = new Set<string>();
  let convoyTicks = 0;
  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i];
    if (f === undefined) continue;
    const raids = (f['raidLines'] ?? []) as { state?: string; ticksLeft?: number }[];
    for (const r of raids) {
      if (r.state === 'DEMANDED') demanded += 1;
      if ((r.ticksLeft ?? 0) > 0) countdowns.push(r.ticksLeft ?? 0);
    }
    const battles = (f['battleLines'] ?? []) as { state?: string; gap?: number; engagement?: string }[];
    for (const b of battles) if (typeof b.state === 'string') liveBattleStates.add(b.state);
    const prev = i > 0 ? frames[i - 1] : undefined;
    if (prev !== undefined) {
      const before = new Map(
        ((prev['battleLines'] ?? []) as { engagement?: string; gap?: number }[]).map((b) => [b.engagement, b.gap]),
      );
      for (const b of battles) if (before.has(b.engagement) && before.get(b.engagement) !== b.gap) gapMoves += 1;
    }
    for (const g of (f['glyphs'] ?? []) as { state?: string }[]) if (g.state === 'FORMING') formings += 1;
    for (const a of (f['authorityLines'] ?? []) as { state?: string }[]) if (a.state === 'DRAWN' || a.state === 'EXHAUSTED') drawn += 1;
    if (((f['convoyLines'] ?? []) as unknown[]).length > 0) convoyTicks += 1;
  }
  process.stdout.write('\n── ★ THE FIVE THINGS THAT COULD NOT REACH A FRAME BEFORE ────────\n');
  process.stdout.write(`  raidLines.state DEMANDED       ${String(demanded)} row-ticks\n`);
  process.stdout.write(`  raidLines.ticksLeft > 0        ${String(countdowns.length)} row-ticks\n`);
  process.stdout.write(`  battleLines.gap CHANGED        ${String(gapMoves)} times\n`);
  process.stdout.write(`  battleLines.state seen         ${[...liveBattleStates].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(' · ') || '(none)'}\n`);
  process.stdout.write(`  glyphs.state FORMING           ${String(formings)} row-ticks\n`);
  process.stdout.write(`  authorityLines DRAWN/EXHAUSTED ${String(drawn)} row-ticks\n`);
  process.stdout.write(`  convoyLines non-empty on       ${String(convoyTicks)} / ${String(frames.length)} ticks\n`);
}

/**
 * ★ THE TRACE — the same three fields printed tick by tick, because a total is not a countdown.
 *
 * `raidLines.ticksLeft > 0 on 288 row-ticks` is a claim that the field is populated. **`6, 5, 4, 3`
 * is the claim that it counts down**, and those are different facts: a bug that recomputed the
 * countdown from a stale tick would satisfy the first and fail the second. The audit that found the
 * nightly frame to be a post-mortem read consecutive frames by hand; this prints them.
 */
function trace(frames: readonly Row[]): void {
  const raid = new Map<string, { tick: number; left: number; state: string }[]>();
  const battle = new Map<string, { tick: number; gap: number; range: string; state: string }[]>();
  const convoy = new Map<string, { tick: number; left: number }[]>();
  for (const f of frames) {
    const tick = Number(f['tick']);
    for (const r of (f['raidLines'] ?? []) as { raid?: string; ticksLeft?: number; state?: string }[]) {
      const id = String(r.raid);
      raid.set(id, [...(raid.get(id) ?? []), { tick, left: r.ticksLeft ?? 0, state: String(r.state) }]);
    }
    for (const b of (f['battleLines'] ?? []) as { engagement?: string; gap?: number; rangeName?: string; state?: string }[]) {
      const id = String(b.engagement);
      battle.set(id, [
        ...(battle.get(id) ?? []),
        { tick, gap: b.gap ?? -1, range: String(b.rangeName), state: String(b.state) },
      ]);
    }
    for (const c of (f['convoyLines'] ?? []) as { hand?: string; ticksLeft?: number }[]) {
      const id = String(c.hand);
      convoy.set(id, [...(convoy.get(id) ?? []), { tick, left: c.ticksLeft ?? 0 }]);
    }
  }

  const longest = <T>(m: Map<string, T[]>): [string, T[]] | undefined =>
    [...m.entries()].sort((a, b) => b[1].length - a[1].length)[0];

  process.stdout.write('\n── ★ THE TRACE: consecutive live frames, one object each ─────────\n');
  const r = longest(raid);
  if (r !== undefined) {
    const live = r[1].filter((x) => x.state === 'DEMANDED');
    process.stdout.write(`  raid ${r[0]} — the countdown on the arc\n    `);
    process.stdout.write(
      (live.length > 0 ? live : r[1]).slice(0, 30).map((x) => `t${String(x.tick)}:${String(x.left)}`).join(' → ') + '\n',
    );
  }
  const b = longest(battle);
  if (b !== undefined) {
    process.stdout.write(`  battle ${b[0]} — the gap, which is the range race\n    `);
    process.stdout.write(
      b[1].slice(0, 30).map((x) => `t${String(x.tick)}:${x.state[0] ?? '?'}${String(x.gap)}`).join(' → ') + '\n',
    );
    process.stdout.write(
      `    ranges: ${[...new Set(b[1].map((x) => `${String(x.gap)}=${x.range}`))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(' · ')}\n`,
    );
  }
  const c = longest(convoy);
  if (c !== undefined) {
    process.stdout.write(`  convoy ${c[0]} — the line, and how long until it lands\n    `);
    process.stdout.write(c[1].slice(0, 30).map((x) => `t${String(x.tick)}:${String(x.left)}`).join(' → ') + '\n');
  }
}

function main(): void {
  const args = parse(process.argv.slice(2));
  const dir = mkdtempSync(join(tmpdir(), 'compact-census-'));
  try {
    const result = runSim({
      ...DEFAULT_ARGS,
      seed: args.seed,
      ticks: args.reckonings * TICKS_PER_RECKONING,
      principals: args.principals,
      hazards: true,
      quiet: true,
      emitStateHash: false,
      framesDir: dir,
      liveFrames: true,
    });
    process.stdout.write(
      `seed ${args.seed} · ${String(result.ticksRun)} ticks · ${String(result.reckonings.reckonings)} Reckonings · ` +
        `${String(result.framesWritten)} Reckoning frames · ${String(result.liveFramesWritten)} live frames, ` +
        `${String(result.liveFramesMoved)} of which MOVED\n`,
    );
    if (result.halted) process.stdout.write(`⚑ HALTED at tick ${String(result.haltedAtTick)}\n`);

    const read = (d: string, prefix: string): Row[] =>
      readdirSync(d)
        .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')) as Row);

    census('RECKONING FRAMES', read(dir, 'r-'));
    const live = read(join(dir, 'live'), 't-');
    census('LIVE FRAMES', live);
    motion(live);
    trace(live);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
