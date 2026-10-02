/**
 * ★ **NO MAP FOR THE FIRST DAY OF A NEW SEASON** — the live frame carries it until a Reckoning settles.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `deploy/new-season-standalone.sh` clears the frames, and the topology rode only the nightly frame. So
 * for the first 288 ticks — 24 hours at production speed — there was no `latest.json` or `index.json`,
 * `live.json` carried no map, the site drew "NO MAP UNTIL THE FIRST RECKONING" (`client/lib/mapview.js`),
 * and the MCP bridge's rundown and dossier tools answered NOT_YET. Writing an early `r-000000.json`
 * would have put a Reckoning in the archive that never settled, so the LIVE frame carries the map —
 * from the one builder the nightly frame uses — for exactly as long as no settled frame exists.
 *
 * And the engine's own `GET /frames/:name` refused `live.json` outright (`no frame live.json`), so on a
 * local or self-hosted world the one frame that exists before the first Reckoning could not be fetched
 * from the app that writes it. Production nginx serves it off disk.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { TICKS_PER_RECKONING, fixedClock, setSpeed } from '../../src/core/time.js';
import { qty } from '../../src/core/units.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { FrameBudgetError, assertLiveFrameBudgets, type MapSystem } from '../../src/frames/contract.js';
import { LIVE_FACT_KEYS, renderLiveFrame } from '../../src/frames/live.js';
import { PUBLIC_FACT_KEYS } from '../../src/frames/projection.js';
import { FRAME_INDEX, LATEST, LIVE, publishLiveFrame } from '../../src/frames/write.js';
import { createApp } from '../../src/api/server.js';
import { SeatBook } from '../../src/api/seats.js';

function drive(rt: Runtime, cast: HeuristicCast, seed: string, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) {
    for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
    const report = rt.runTick();
    if (report.halted) throw new Error(`halted at ${String(report.tick)}`);
  }
}

describe('★ the live frame carries the map until the first Reckoning settles, and only until then', () => {
  it('★ from genesis: the topology is on live.json — and it is the topology latest.json will carry', () => {
    setSpeed('instant');
    const seed = 'map-from-genesis';
    const rt = new Runtime({ seed });
    const cast = new HeuristicCast(rt, { size: 8 });
    cast.seat(seed);
    drive(rt, cast, seed, 1);

    // MUTATION: drop `...(this.outcome === null ? { map: this.frameMap() } : {})` from `liveFrame` and
    // the genesis frame carries `map: []` again — RED here.
    const genesis = rt.liveFrame();
    expect(genesis.lastReckoning, 'no Reckoning has settled at tick 1').toBeNull();
    expect(rt.reckoningFrame(), 'and there is no settled frame to carry the map').toBeNull();
    expect(genesis.map.length, 'the map rides the live frame from the first tick').toBeGreaterThan(0);
    expect(() => {
      assertLiveFrameBudgets(genesis);
    }).not.toThrow();

    // Up to the settlement tick: still carried, still the same graph.
    drive(rt, cast, seed, TICKS_PER_RECKONING - 2 - rt.engine.tick);
    const lastBefore = rt.liveFrame();
    expect(lastBefore.lastReckoning).toBeNull();
    expect(lastBefore.map).toEqual(genesis.map);

    // The first settlement: the nightly frame now carries it — the SAME rows — and the live frame stops.
    drive(rt, cast, seed, 1);
    const nightly = rt.reckoningFrame();
    expect(nightly, 'Reckoning 0 settled').not.toBeNull();
    expect(nightly?.map, 'one builder, so one graph on both artifacts').toEqual(genesis.map);
    const after = rt.liveFrame();
    expect(after.lastReckoning).toBe(0);
    expect(after.map, 'the per-tick artifact stops paying for a map latest.json now carries').toEqual([]);
  }, 120_000);

  it('★ a map beside a lastReckoning is refused, and a carried map obeys the nightly frame\'s graph rules', () => {
    const S = (id: string): MapSystem['id'] => id as MapSystem['id'];
    const sys = (id: string, over: Partial<MapSystem> = {}): MapSystem => ({
      id: S(id),
      name: id,
      tier: 'MARCHES',
      constellation: 'con-1' as MapSystem['constellation'],
      lanes: [],
      yieldPerTick: qty(110),
      fuelPerTick: qty(0),
      richnessBps: 10_000,
      straits: [],
      ...over,
    });
    const base = renderLiveFrame({ tick: 300, stateHash: 'h', lastReckoning: null, ventures: [], map: [sys('sys-01')] });
    expect(() => {
      assertLiveFrameBudgets(base);
    }).not.toThrow();
    // MUTATION: delete the `lastReckoning !== null` refusal in `assertLiveFrameBudgets` — RED.
    expect(() => {
      assertLiveFrameBudgets({ ...base, lastReckoning: 0 });
    }).toThrow(/carries the map after Reckoning 0 settled/);
    // MUTATION: drop `problems.push(...mapProblems(liveMap))` — a one-sided strait renders. RED.
    // (`renderLiveFrame` asserts its own frame, so the refusal arrives at render time.)
    expect(() =>
      renderLiveFrame({
        tick: 300,
        stateHash: 'h',
        lastReckoning: null,
        ventures: [],
        map: [
          sys('sys-01', { lanes: [S('sys-02')], straits: [{ to: S('sys-02'), detourHops: 6, severs: false, severed: 0 }] }),
          sys('sys-02', { lanes: [S('sys-01')] }),
        ],
      }),
    ).toThrow(FrameBudgetError);
  });

  it('the map key is admitted on the argument PUBLIC_FACT_KEYS already carries', () => {
    expect((LIVE_FACT_KEYS as readonly string[]).includes('map')).toBe(true);
    expect((PUBLIC_FACT_KEYS as readonly string[]).includes('map')).toBe(true);
  });
});

describe('★ GET /frames/live.json is served by the engine, not refused as "no frame"', () => {
  let close: (() => Promise<void>) | null = null;
  let dir: string | null = null;
  afterEach(async () => {
    await close?.();
    close = null;
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  async function serveFrames(framesDir: string): Promise<string> {
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'frames-route-live' });
    const { app } = createApp({ runtime, clock: fixedClock(1_700_000_000_000), framesDir, seats: new SeatBook(8) });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((done) => server.once('listening', done));
    close = () => new Promise<void>((done) => server.close(() => done()));
    return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  }

  it('★ before the first Reckoning: live.json is served, and latest.json says the map is on live.json', async () => {
    dir = mkdtempSync(join(tmpdir(), 'compact-live-route-'));
    const frame = renderLiveFrame({ tick: 12, stateHash: 'h12', lastReckoning: null, ventures: [] });
    publishLiveFrame(dir, frame);
    const origin = await serveFrames(dir);

    // MUTATION: drop `|| name === LIVE` from `framesHandler` — this is a 404 "no frame live.json". RED.
    const live = await fetch(`${origin}/frames/${LIVE}`);
    expect(live.status, 'the frame that exists before the first Reckoning must be served').toBe(200);
    expect(live.headers.get('cache-control')).toBe('no-store');
    expect(((await live.json()) as { tick: number }).tick).toBe(12);

    const latest = await fetch(`${origin}/frames/${LATEST}`);
    expect(latest.status).toBe(404);
    expect(await latest.text(), 'the refusal points at the frame that carries the map until then').toContain(
      `/frames/${LIVE} carries the map until the first one does`,
    );

    const unknown = await (await fetch(`${origin}/frames/nonsense.json`)).text();
    for (const name of [LIVE, LATEST, FRAME_INDEX, 'r-000001.json']) expect(unknown).toContain(name);
  });

  it('a live.json not written yet says so, and a settled world serves latest.json as before', async () => {
    dir = mkdtempSync(join(tmpdir(), 'compact-live-route-'));
    const origin = await serveFrames(dir);
    const missing = await (await fetch(`${origin}/frames/${LIVE}`)).text();
    expect(missing).toMatch(/the frames route EXISTS and live\.json has not been written yet/);
    writeFileSync(join(dir, LATEST), '{"reckoningIndex":0}', 'utf8');
    expect((await fetch(`${origin}/frames/${LATEST}`)).status).toBe(200);
  });

  it('publishing the genesis live frame writes no Reckoning into the archive or its index', () => {
    // "Without making index.json / r-NNNNNN.json numbering dishonest": the map rides `live.json`, and a
    // live publish touches nothing else — so Reckoning 0's file is still the first settlement's own.
    dir = mkdtempSync(join(tmpdir(), 'compact-live-route-'));
    publishLiveFrame(dir, renderLiveFrame({ tick: 3, stateHash: 'h3', lastReckoning: null, ventures: [] }));
    expect(readdirSync(dir).filter((f) => !f.startsWith('.'))).toEqual([LIVE]);
  });
});
