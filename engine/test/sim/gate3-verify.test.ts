/**
 * **Adversarial verification of the four runtime Gate-3 fixes, over real signed HTTP.**
 *
 * `test/sim/gate3.test.ts` proves the fixes against `Runtime` directly, which is the right
 * place for the rules. This file exists because two of the claims are only true if the
 * *transport* also holds them, and neither is visible from inside a `Runtime` test:
 *
 *   1. **The readback fix has to survive the observation cache.** `POST /act` invalidates
 *      the cached observation only `if (accepted.length > 0)` (`src/api/server.ts:638`). An
 *      in-flight election that did not clear the cache would be told to a payer as the
 *      *previous* statement anyway, and the whole A5′ repair would be dead on the wire
 *      while green in the unit test.
 *   2. **A correction has to reach `observation.corrections[]`.** `gate3.test.ts` reads
 *      `runtime.takeCorrections`, and its own `observation()` helper hard-codes
 *      `corrections: []` — so nothing in it can see whether the refusal actually reaches an
 *      agent. The drain lives in `server.ts:968`, one layer above everything it asserts.
 *
 * The third test is the one the brief asks for by name: **no new way to record a false
 * default.** `noteElection` deliberately re-checks every door `vElect` refuses — except the
 * clock. So an `elect` submitted during the freeze is *refused* by `electingFrozen` and
 * *recorded* by the overlay, and this pins that the record still comes out right.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IN_FULL, openIndices } from '../../src/venture/index.js';
import { handsOf } from '../../src/world/index.js';
import { FILL_REFUSAL_NOTE } from '../../src/sim/runtime.js';
import type { HandId, PrincipalId, VentureId } from '../../src/core/types.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from '../api/harness.js';

let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'gate3-verify' });
});
afterEach(async () => {
  await h.close();
});

type Row = Record<string, unknown>;

function pid(a: Agent): PrincipalId {
  return a.principalId as PrincipalId;
}

/** One signed GET /observe, unwrapped. The real door, and it spends a real wake. */
async function observe(who: Agent): Promise<Row> {
  const res = await signed(h, who, 'GET', PATHS.observe);
  expect(res.status, `observe -> ${res.status}: ${res.text.slice(0, 400)}`).toBe(200);
  return res.json['observation'] as Row;
}

/** One signed POST /act. Returns the response's own corrections, which may be empty. */
async function post(who: Agent, verb: string, params: unknown, sequence = 1): Promise<Row[]> {
  const res = await signed(h, who, 'POST', PATHS.act, {
    actions: [{ verb, params, clientSequence: sequence }],
  });
  expect(res.status, `${verb} -> ${res.status}: ${res.text.slice(0, 400)}`).toBe(200);
  return (res.json['outcome'] as Row)['corrections'] as Row[];
}

function submit(who: PrincipalId, verb: string, params: Row, sequence = 0): void {
  const outcome = h.runtime.engine.submit({
    principal: who,
    verb,
    params,
    clientSequence: sequence,
    arrivalMs: sequence,
    decisionSource: 'LIVE',
  });
  if (!outcome.ok) throw new Error(`submit ${verb}: ${outcome.invariant} ${outcome.hint}`);
}

/** Put a principal's hands at a system without paying the ticks a `move` costs. */
function bring(who: Agent, system: string): void {
  for (const hand of handsOf(h.runtime.world, pid(who))) {
    hand.location = system as never;
    hand.destination = null;
    hand.state = 'IDLE';
    hand.presentSinceTick = h.runtime.engine.tick;
  }
}

function idleOf(who: Agent): HandId {
  const found = handsOf(h.runtime.world, pid(who)).find((hand) => hand.state === 'IDLE');
  if (found === undefined) throw new Error(`${who.handle} has no idle hand`);
  return found.id;
}

/** Two enrolled agents, co-located, with a LIVE two-role HAUL between them. */
async function liveVenture(): Promise<{
  readonly payer: Agent;
  readonly filler: Agent;
  readonly venture: VentureId;
}> {
  const payer = agent('vellan');
  const filler = agent('doryn');
  await enrol(h, payer);
  await enrol(h, filler);
  tick(h, 1);

  const stage = handsOf(h.runtime.world, pid(payer))[0]?.location;
  if (stage === undefined) throw new Error('the payer has no hand');
  bring(payer, stage);
  bring(filler, stage);

  submit(pid(payer), 'create', { kind: 'HAUL', stage, value: 12_000 });
  tick(h, 1);
  const found = h.runtime.ventures
    .all()
    .find((v) => v.creator === pid(payer) && v.state === 'FORMING' && openIndices(v).length === 2);
  if (found === undefined) throw new Error('create did not mint a FORMING venture');

  submit(pid(payer), 'fill_role', { venture: found.id, role: 0, hand: idleOf(payer) });
  tick(h, 1);
  submit(pid(filler), 'fill_role', { venture: found.id, role: 1, hand: idleOf(filler) });
  tick(h, 1);

  const hash = h.runtime.ventures.require(found.id).termsHash;
  if (hash === null) throw new Error('no terms_hash');
  submit(pid(payer), 'sign', { venture: found.id, terms_hash: hash }, 0);
  submit(pid(filler), 'sign', { venture: found.id, terms_hash: hash }, 1);
  tick(h, 2);

  const state = h.runtime.ventures.require(found.id).state;
  if (state !== 'LIVE') throw new Error(`the venture is ${state}, not LIVE`);
  return { payer, filler, venture: found.id };
}

/** The `elect` affordance's readback tail as it arrives on the wire, for one role. */
function readback(observation: Row, roleIndex: number): string {
  const found = (observation['affordances'] as Row[]).find(
    (a) => a['verb'] === 'elect' && (a['params'] as Row)['role'] === roleIndex,
  );
  if (found === undefined) {
    throw new Error(
      `no elect affordance for role ${String(roleIndex)}; offered: ${(observation['affordances'] as Row[])
        .map((a) => String(a['verb']))
        .join(', ')}`,
    );
  }
  return String(found['what_it_forecloses']);
}

// ── 1. the readback, on the wire, through the observation cache ──────────────

describe('A5′ on the wire — GET /observe never reports a statement the payer has replaced', () => {
  it('reports the in-flight amount, not the cached IN_FULL, in the same window', async () => {
    const { payer, venture } = await liveVenture();

    await post(payer, 'elect', { venture, role: 1, election: IN_FULL });
    tick(h, 1);
    expect(h.runtime.takeCorrections(pid(payer))).toEqual([]);

    // The observation that gets CACHED. This is the half the unit test cannot reach: if
    // POST /act failed to invalidate it, everything below would be served from here.
    expect(readback(await observe(payer), 1)).toContain('You have currently stated: IN_FULL');
    expect(h.runtime.electionOn(venture, 1)).toBe(IN_FULL);

    // Restated into the OPEN window, so the book still holds IN_FULL. This is the exact
    // read a probe made, in a fresh non-stale observation, and was lied to by.
    expect(await post(payer, 'elect', { venture, role: 1, election: 2340 }, 2)).toEqual([]);
    const after = readback(await observe(payer), 1);
    expect(after).toContain('You have currently stated: 2340');
    expect(after).not.toContain('stated: IN_FULL');

    // And it is still true once the statement has landed, so it is not a one-tick illusion.
    tick(h, 1);
    expect(readback(await observe(payer), 1)).toContain('You have currently stated: 2340');
  });

  it('never lets the preview claim safety the payer has just taken back', async () => {
    // `if_you_do_nothing` is the consequence preview — High Water's `projectedDrown`
    // generalised — and it reads the same `electionOn`. The dangerous direction is the one
    // where it reports nothing owing while a decline is what will settle, because that is
    // the sentence an agent goes dark on.
    const { payer, venture } = await liveVenture();
    await post(payer, 'elect', { venture, role: 1, election: IN_FULL });
    tick(h, 1);
    const safe = String((await observe(payer))['briefing'] instanceof Object
      ? ((await observe(payer))['briefing'] as Row)['if_you_do_nothing']
      : '');
    expect(safe).not.toContain('is NOT paid');

    await post(payer, 'elect', { venture, role: 1, election: 1 }, 2);
    const exposed = String(((await observe(payer))['briefing'] as Row)['if_you_do_nothing']);
    expect(exposed).toContain('is NOT paid');
  });
});

// ── 2. a refused fill reaches the agent, in the payload it actually reads ────

describe('a contested fill refusal arrives in GET /observe corrections[]', () => {
  it('reaches the loser through the drain, with the invariant and what to do instead', async () => {
    const payer = agent('kesh');
    await enrol(h, payer);
    tick(h, 1);
    const stage = handsOf(h.runtime.world, pid(payer))[0]?.location;
    if (stage === undefined) throw new Error('no stage');
    bring(payer, stage);
    submit(pid(payer), 'create', { kind: 'HAUL', stage, value: 12_000 });
    tick(h, 1);
    const found = h.runtime.ventures.all().find((v) => v.creator === pid(payer) && v.state === 'FORMING');
    if (found === undefined) throw new Error('no venture');
    submit(pid(payer), 'fill_role', { venture: found.id, role: 0, hand: idleOf(payer) });
    tick(h, 1);

    const alpha = agent('amaranth');
    const bravo = agent('bellwether');
    for (const who of [alpha, bravo]) await enrol(h, who);
    tick(h, 1);
    for (const who of [alpha, bravo]) bring(who, stage);

    // Both bid for the one open role inside the same window, over real HTTP.
    for (const who of [alpha, bravo]) {
      expect(
        await post(who, 'fill_role', { venture: found.id, role: 1, hand: idleOf(who) }),
        'POST /act cannot know a contest yet: it is decided when the whole set is in',
      ).toEqual([]);
    }
    tick(h, 1);

    const role = h.runtime.ventures.require(found.id).roles.find((r) => r.index === 1);
    const winner = role?.filledByPrincipal;
    expect(winner).not.toBeNull();
    const loser = [alpha, bravo].find((who) => pid(who) !== winner);
    if (loser === undefined) throw new Error('both bids were granted');

    // THE ASSERTION. Not `takeCorrections` — the payload an agent reads. It sits inside
    // `briefing` rather than at the top level because §17 caps the observation at eleven keys.
    const delivered = ((await observe(loser))['briefing'] as Row)['corrections'] as Row[];
    const refusal = delivered.find((c) => c['verb'] === 'fill_role');
    expect(refusal, `nothing reached the loser: ${JSON.stringify(delivered)}`).toBeDefined();
    expect(refusal?.['invariant']).toBe('INV-9');
    expect(String(refusal?.['hint'])).toContain(FILL_REFUSAL_NOTE.LOST_CONTEST);
    // ── THE ONE THING THAT DOES NOT REACH THE WIRE ─────────────────────────
    //
    // `PendingCorrection` carries `params` and `test/sim/gate3.test.ts` asserts on them,
    // but `buildObservation` (`src/api/observe.ts:390`) maps a correction to
    // `{tick, verb, clientSequence, invariant, hint, nearest_legal}` and **drops
    // `params`**. So the engine-level claim "the params are echoed so the agent can match
    // the refusal to what it sent" is not true of the payload an agent reads. Pinned as
    // the current fact rather than fixed here: that file has another owner this session.
    // The match key an HTTP agent actually has is its own `clientSequence`.
    expect(refusal?.['params'], 'params are dropped by buildObservation — see the note').toBeUndefined();
    expect(refusal?.['clientSequence']).toBe(1);
    expect(String(refusal?.['hint'])).toContain(found.id);
    // Delivered once, then gone. A re-read *inside the same tick* is served from the
    // observation cache and is deliberately the same bytes for no wake (PROP-O6, A4), so
    // the drain is only observable across a tick boundary — which is where a correction
    // that came back a second time would make an agent act on it twice.
    expect(((await observe(loser))['briefing'] as Row)['corrections']).toHaveLength(1);
    tick(h, 1);
    expect(((await observe(loser))['briefing'] as Row)['corrections']).toEqual([]);
  });
});

// ── 3. no new way to record a false default ─────────────────────────────────

describe('the in-flight overlay can never reach the record', () => {
  it('honours the booked IN_FULL even when a decline the freeze refuses is in flight', async () => {
    // `noteElection` re-checks every door `vElect` refuses EXCEPT the clock, so an `elect`
    // sent during the freeze is recorded by the overlay and refused by the handler. The
    // readback goes pessimistic for one window, which is the safe direction — but the
    // *record* must be untouched, because a `DECLINED` row against a payer that paid in
    // full is §15.4's false default and this project's worst outcome.
    const { payer, venture } = await liveVenture();
    await post(payer, 'elect', { venture, role: 1, election: IN_FULL });
    tick(h, 1);
    expect(h.runtime.electionOn(venture, 1)).toBe(IN_FULL);

    // Walk to one tick before the freeze, so the statement RESOLVES on the freeze tick —
    // `submit` targets `tick + 1`, and FREEZE_TICKS === 1 puts the freeze at
    // `resolvesAtTick - 1`.
    const record = h.runtime.ventures.require(venture);
    while (h.runtime.engine.tick < record.resolvesAtTick - 2) tick(h, 1);
    submit(pid(payer), 'elect', { venture, role: 1, election: 1 }, 9);
    // The overlay took it (it does not read the clock) and the readback is now pessimistic.
    expect(h.runtime.electionOn(venture, 1)).toBe(1);

    tick(h, 1);
    // The handler refused it, so the book is untouched …
    const refusals = h.runtime.takeCorrections(pid(payer));
    expect(refusals.map((c) => c.verb)).toContain('elect');
    expect(h.runtime.electionOn(venture, 1)).toBe(IN_FULL);

    // … and the settlement, which reads the book alone, records no default at all.
    while (h.runtime.ventures.get(venture)?.state === 'LIVE') tick(h, 1);
    expect(h.runtime.ventures.require(venture).state).toBe('SETTLED');
    // `promisor` is who the record accuses (INV-17's own field name). Nobody, here.
    expect(h.runtime.register.all().filter((d) => d.promisor === pid(payer))).toEqual([]);
  });

  it('leaves state_hash identical whether or not a statement is in flight', async () => {
    // The overlay is deliberately outside the hash and outside the rollback. If it were
    // inside either, an accepted-but-unresolved statement would change a figure two runs
    // are compared on — and a replay divergence is how a false default gets *believed*.
    const { payer, venture } = await liveVenture();
    const before = h.runtime.engine.stateHash;
    await post(payer, 'elect', { venture, role: 1, election: 777 });
    expect(h.runtime.engine.stateHash).toBe(before);
    expect(h.runtime.bufferSizes()['electionsInFlight']).toBe(1);
  });
});
