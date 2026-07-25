/**
 * The house cast: deterministic, honest about being heuristic, and it actually fills
 * roles.
 *
 * SPEC §15.6's clause is mechanical, not decorative: *"Heuristics fill unfilled role
 * slots so ventures always resolve."* §7.2 makes every role concurrent, so one
 * unfilled slot kills the whole venture — and a cast that creates ventures nobody
 * fills produces a world of `FORMING` rows and no stories in it.
 *
 * The three properties, in the order they would fail:
 *
 *   1. **Determinism.** The cast runs inside the tick. One unseeded draw and the world
 *      is unreplayable, and replay is the only thing that makes a permanent public
 *      record trustworthy.
 *   2. **Ventures reach `LIVE`.** The clause above, asserted rather than assumed.
 *   3. **No refusal repeats.** A bot hitting the same rejection every tick is
 *      AGT-S3's signal that an affordance or a hint is wrong — and it is far cheaper
 *      to find with 12 bots than with 12 language models.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import { CAST_NAMES, CAST_ROLES, HeuristicCast, MAX_CAST } from '../../src/cast/index.js';
import { IN_FULL } from '../../src/venture/index.js';
import { storesAccount } from '../../src/ledger/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { tierOf } from '../../src/world/index.js';
import { Rng } from '../../src/core/rng.js';

function run(seed: string, ticks: number, size = 12): { runtime: Runtime; refusals: Map<string, number> } {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size });
  cast.seat(seed);
  const refusals = new Map<string, number>();
  for (let n = 0; n < ticks; n += 1) {
    for (const action of cast.decide(runtime.engine.tick + 1, seed)) {
      const submitted = runtime.engine.submit(action);
      if (!submitted.ok) {
        const key = `submit ${action.verb} ${submitted.invariant}`;
        refusals.set(key, (refusals.get(key) ?? 0) + 1);
      }
    }
    const report = runtime.runTick();
    for (const entry of runtime.engine.log.forTick(report.tick)) {
      if (entry.outcome === 'REFUSED' && entry.rejection !== null) {
        const key = `${entry.verb} ${entry.rejection.invariant}`;
        refusals.set(key, (refusals.get(key) ?? 0) + 1);
      }
    }
    if (report.halted) break;
  }
  return { runtime, refusals };
}

describe('the cast is deterministic', () => {
  it('two runs of the same seed produce identical per-tick state hashes', () => {
    const a = run('cast-det', 60);
    const b = run('cast-det', 60);
    expect(a.runtime.engine.stateHash).toBe(b.runtime.engine.stateHash);
    expect(a.runtime.ventures.size).toBe(b.runtime.ventures.size);
    expect(a.runtime.engine.stateVersion).toBe(b.runtime.engine.stateVersion);
  });

  it('a different seed produces a different world', () => {
    // The other half of determinism, and the one people forget: a "deterministic"
    // engine whose seed does nothing is deterministic and useless.
    const a = run('cast-seed-a', 60);
    const b = run('cast-seed-b', 60);
    expect(a.runtime.engine.stateHash).not.toBe(b.runtime.engine.stateHash);
  });

  it('decides from the world alone, so shuffling the submission order changes nothing', () => {
    // A4's structural half applied to the cast: the engine orders by
    // `(priority, principal_id, client_sequence)`, so the order the cast's decisions
    // were handed over cannot matter. Handing back a list rather than submitting is
    // what makes this assertable at all.
    setSpeed('instant');
    const forward = new Runtime({ seed: 'shuffle' });
    const shuffled = new Runtime({ seed: 'shuffle' });
    const castA = new HeuristicCast(forward, { size: 8 });
    const castB = new HeuristicCast(shuffled, { size: 8 });
    castA.seat('shuffle');
    castB.seat('shuffle');
    for (let n = 0; n < 40; n += 1) {
      const tick = forward.engine.tick + 1;
      for (const action of castA.decide(tick, 'shuffle')) forward.engine.submit(action);
      const reversed = [...castB.decide(shuffled.engine.tick + 1, 'shuffle')].reverse();
      for (const action of Rng.fromSeed(`perm-${String(n)}`).shuffle(reversed)) {
        shuffled.engine.submit(action);
      }
      forward.runTick();
      shuffled.runTick();
    }
    expect(shuffled.engine.stateHash).toBe(forward.engine.stateHash);
  });
});

describe('the cast plays the game', () => {
  it('gets ventures to LIVE, which is the clause §15.6 actually asks for', () => {
    const { runtime } = run('cast-live', 120);
    const live = runtime.ventures.all().filter((v) => v.state === 'LIVE');
    expect(live.length).toBeGreaterThan(0);
    // Every LIVE venture is fully filled by distinct principals: nobody staffed one
    // alone, which is PROP-V6 holding through the cast rather than only in a unit test.
    for (const venture of live) {
      const parties = new Set(venture.roles.map((r) => r.filledByPrincipal));
      expect(parties.has(null)).toBe(false);
      expect(parties.size).toBe(venture.roles.length);
    }
  });

  it('digs, hauls, escorts and raids — all four briefs appear', () => {
    const { runtime } = run('cast-kinds', 200, 12);
    const kinds = new Set(runtime.ventures.all().map((v) => v.kind));
    // The four the task names. RAID only exists because raiders are seated outside the
    // Commons; in the Commons a hostile act is invalid, not merely refused (A8).
    expect(kinds).toContain('DIG');
    expect(kinds).toContain('HAUL');
    expect(kinds).toContain('ESCORT');
    expect(kinds).toContain('RAID');
  });

  it('never repeats a refusal, because a repeat is a rules-surface defect (AGT-S3)', () => {
    const { refusals } = run('cast-clean', 150);
    const repeated = [...refusals].filter(([, count]) => count >= 3);
    expect(
      repeated,
      'a bot hitting the same refusal 3+ times means an affordance or a hint is wrong, not that the bot is wrong',
    ).toEqual([]);
  });

  it('never halts the world', () => {
    // The cast is agent-reachable input in every sense that matters: it goes through
    // `submit` and the verb table exactly as an HTTP caller does. A halt from it would
    // be a halt an agent could provoke (AGT-X9).
    const { runtime } = run('cast-nohalt', 300, MAX_CAST);
    expect(runtime.engine.status).toBe('RUNNING');
  });

  it('elects, seals, and answers §7.6 with BOTH branches in one day', () => {
    // ══════════════════════════════════════════════════════════════════════
    // §7.6 IS THE DESIGN'S OWN FALSIFICATION TEST, and it was rigged.
    //
    // The old cast elected `IN_FULL` on every venture it created, unconditionally, so
    // *is the elective part always honoured?* had exactly one possible answer and it was
    // "yes, because the only agent in the world cannot do otherwise". The default branch
    // was unreachable, and the honest comment in the cast said so.
    //
    // The bot now has a reason — {@link CAST_ELECTIVE_APPETITE_BPS} of its free stores,
    // across everything settling tonight — so both branches are reached in one Reckoning
    // from a *policy*, not a dice roll. This asserts both, because either alone is the
    // pre-answered version: all-honoured means trust is free, all-defaulted means it is
    // worthless.
    // ══════════════════════════════════════════════════════════════════════
    const { runtime } = run('cast-elective', TICKS_PER_RECKONING + 2, 12);
    const summary = runtime.reckonings()[0];
    expect(summary, 'no Reckoning settled, so this proves nothing').toBeDefined();
    expect(summary?.electiveHonoured).toBeGreaterThan(0);
    expect(summary?.defaults).toBeGreaterThan(0);
    // Honouring dominates. A world where most promises break has no trust to price.
    expect(summary?.electiveHonoured ?? 0).toBeGreaterThan(summary?.defaults ?? 0);
    // Seals were made and judged, and not one was marked from an absence (A5′).
    expect(summary?.sealsJudged ?? 0).toBeGreaterThan(0);
    expect(summary?.sealsContradicted).toBe(0);
    expect(summary?.deedSetFaults).toBe(0);
  });

  it('states less when the bill is large against the purse — a reason, not a dice roll', () => {
    // ══════════════════════════════════════════════════════════════════════
    // §6.4 prices the *resistance*: "resisting a temptation you could not afford is worth
    // more than resisting one you could not be bothered with." So the bot's reason has to
    // be affordability, and this is the assertion that it actually is one rather than a
    // constant with a comment attached: the same world, the same tick, the same venture —
    // only the purse changes, and the statement changes with it.
    //
    // A6 also requires there be no dice in it. That is structural rather than asserted:
    // `electionFor` takes no `Rng` at all, so there is no stream for it to draw from, and
    // `Math.random` is banned by lint (DET-7).
    // ══════════════════════════════════════════════════════════════════════
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'purse' });
    const cast = new HeuristicCast(runtime, { size: 8 });
    cast.seat('purse');
    // Run without ever submitting an election, so every role is still unstated and the
    // policy is deciding from scratch on the tick under test.
    for (let n = 0; n < 80; n += 1) {
      for (const action of cast.decide(runtime.engine.tick + 1, 'purse')) {
        if (action.verb !== 'elect') runtime.engine.submit(action);
      }
      runtime.runTick();
    }
    const first = cast
      .decide(runtime.engine.tick + 1, 'purse')
      .find((a) => a.verb === 'elect');
    expect(first, 'no payer had an election to make, so this proves nothing').toBeDefined();
    if (first === undefined) return;
    // A full purse against a small bill: the honest statement, and the only safe one on a
    // share role.
    expect(first.params['election']).toBe(IN_FULL);

    // Now empty that payer's stores. Nothing else about the world moves.
    const stores = storesAccount(first.principal);
    runtime.ledger.transferCurrency({
      eventId: 'purse::drain' as never,
      tick: runtime.engine.tick,
      from: stores,
      to: storesAccount(cast.roster.find((m) => m.principal !== first.principal)?.principal ?? first.principal),
      amount: runtime.ledger.freeBalance(stores),
    });
    const after = cast
      .decide(runtime.engine.tick + 1, 'purse')
      .find((a) => a.verb === 'elect' && a.principal === first.principal);
    expect(after, 'the payer stopped electing entirely, which is a different bug').toBeDefined();
    // Same venture, same role, and now a number instead of "whatever it costs" — which is
    // a decline for the difference, permanently, and it is meant to be.
    expect(after?.params['venture']).toBe(first.params['venture']);
    expect(after?.params['role']).toBe(first.params['role']);
    expect(after?.params['election']).not.toBe(IN_FULL);
    expect(after?.params['election']).toBe(0);
  });

  it('restates a promise it can no longer fund DOWNWARD, which is the drama the split buys', () => {
    // ══════════════════════════════════════════════════════════════════════
    // `agent.md`: "Changing your mind late is allowed, and it is the whole reason this game
    // has drama in it." A cast that only ever decided once would be the old
    // election-on-`sign` behaviour wearing the new verb's name, and the restatement path
    // would be dead code with a comment on it — which a mutation caught: emptying the
    // restate branch left every other assertion in this file green.
    //
    // So: the bot commits IN_FULL while it can afford to, the money goes elsewhere, and it
    // comes back and says a smaller number. Monotone downward, never up, which is what
    // makes the policy converge instead of thrashing.
    // ══════════════════════════════════════════════════════════════════════
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'restate' });
    const cast = new HeuristicCast(runtime, { size: 8 });
    cast.seat('restate');
    let committed: { principal: string; venture: string; role: number } | null = null;
    for (let n = 0; n < 120 && committed === null; n += 1) {
      const decisions = cast.decide(runtime.engine.tick + 1, 'restate');
      for (const action of decisions) runtime.engine.submit(action);
      runtime.runTick();
      const elected = decisions.find(
        (a) => a.verb === 'elect' && a.params['election'] === IN_FULL,
      );
      if (elected !== undefined) {
        committed = {
          principal: String(elected.principal),
          venture: String(elected.params['venture']),
          role: Number(elected.params['role']),
        };
      }
    }
    expect(committed, 'no payer ever committed IN_FULL, so this proves nothing').not.toBeNull();
    if (committed === null) return;
    expect(runtime.electionOn(committed.venture as never, committed.role)).toBe(IN_FULL);

    // The money goes elsewhere. Nothing about the promise changes; only the purse behind it.
    const stores = storesAccount(committed.principal as never);
    const elsewhere = cast.roster.find((m) => m.principal !== committed.principal)?.principal;
    runtime.ledger.transferCurrency({
      eventId: 'restate::drain' as never,
      tick: runtime.engine.tick,
      from: stores,
      to: storesAccount(elsewhere ?? (committed.principal as never)),
      amount: runtime.ledger.freeBalance(stores),
    });

    const restated = cast
      .decide(runtime.engine.tick + 1, 'restate')
      .find(
        (a) =>
          a.verb === 'elect' &&
          a.principal === committed.principal &&
          a.params['venture'] === committed.venture &&
          a.params['role'] === committed.role,
      );
    expect(restated, 'the bot let a promise it cannot fund stand').toBeDefined();
    expect(restated?.params['election']).not.toBe(IN_FULL);
    expect(Number(restated?.params['election'])).toBeLessThan(
      runtime.electiveCeilingOf(runtime.ventures.require(committed.venture as never), committed.role),
    );
  });

  it('seats raiders outside the Commons and everybody else inside it', () => {
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'seating' });
    const cast = new HeuristicCast(runtime, { size: 12 });
    const roster = cast.seat('seating');
    expect(roster.length).toBe(12);
    for (const member of roster) {
      const tier = tierOf(runtime.world.map, member.seat);
      if (member.role === 'raider') expect(tier).not.toBe('COMMONS');
      else expect(tier).toBe('COMMONS');
    }
  });

  it('labels every decision HEURISTIC, so the health check can catch a fallback', () => {
    // A cast that claimed `LIVE` would make the one measurement that catches scar #14b
    // permanently green. This is the assertion that keeps the census honest.
    const { runtime } = run('cast-source', 40);
    const distribution = runtime.census.distribution();
    expect(distribution.HEURISTIC).toBeGreaterThan(0);
    expect(distribution.LIVE).toBe(0);
    expect(distribution.FALLBACK).toBe(0);
  });

  it('is bounded by the roster it was given', () => {
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'bounded' });
    const cast = new HeuristicCast(runtime, { size: 10_000 });
    expect(cast.seat('bounded').length).toBeLessThanOrEqual(MAX_CAST);
    expect(CAST_NAMES.length).toBe(MAX_CAST);
    expect(new Set(CAST_NAMES).size).toBe(CAST_NAMES.length);
    expect(CAST_ROLES.length).toBe(4);
  });

  it('no cast name is a handle agent.md tells an agent to send (scar #1)', () => {
    // ── The trap this closes ─────────────────────────────────────────────────
    //
    // A principal id is derived from its handle, so a cast name that `agent.md` uses as
    // a worked example is a handle a first-time agent will send verbatim. This list
    // began with `vale`, which is exactly what `agent.md` §2 shows in
    // `{ "handle": "vale" }` and in `vale@agenttransfer.dev` — so the documented first
    // request was a collision with a house-cast principal, and before the enrol handler
    // was fixed it bound the caller's own key to that principal (A5′; see the note in
    // `src/api/server.ts` and the regression in `test/api/security.test.ts`).
    //
    // Parsed out of the document rather than hard-coded, because the failure mode is a
    // *future* name being added that happens to appear in it. `agent.md` is the contract
    // and never moves to accommodate the engine; this assertion is what makes the cast
    // move instead.
    const agentMd = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');
    const quoted = new Set<string>();
    for (const m of agentMd.matchAll(/"handle"\s*:\s*"([a-z][a-z0-9-]*)"/g)) quoted.add(m[1] ?? '');
    for (const m of agentMd.matchAll(/\b([a-z][a-z0-9-]*)@agenttransfer\.dev/g)) quoted.add(m[1] ?? '');
    // The guard's own guard: a regex that matched nothing would pass this vacuously.
    expect(quoted.size, 'no example handle was found in agent.md — the parse broke').toBeGreaterThan(0);
    const collisions = CAST_NAMES.filter((name) => quoted.has(name));
    expect(collisions, `agent.md uses ${collisions.join(', ')} as an example handle`).toEqual([]);
  });

  it('holds no unbounded array over a long run', () => {
    const { runtime } = run('cast-bounded', 400, 12);
    const buffers = runtime.bufferSizes();
    expect(buffers['talk']).toBeLessThanOrEqual(512);
    expect(buffers['claims']).toBeLessThanOrEqual(512);
    expect(buffers['offers']).toBeLessThanOrEqual(256);
    expect(buffers['pendingFills']).toBe(0);
    expect(buffers['censusTicks']).toBeLessThanOrEqual(288);
  });
});
