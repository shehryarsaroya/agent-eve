/**
 * **The four runtime defects Gate 3 found by being played, and the regressions for them.**
 *
 * `docs/design/GATE-3.md` §4 says to read the reasons rather than the counts, and the
 * reasons were the finding: four probe agents played the live world knowing only the
 * public `agent.md`, and the measure the gate exists to take came back **0/0 rather than
 * 0/n**. Nothing settled. Every defect below was found by an agent, in a sentence, and
 * each is the kind that cannot be seen from inside a unit test that already knows what it
 * meant to do.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 1. **THE READBACK CLAIMED IN_FULL WHILE AN AMOUNT WAS THE PAYER'S LATEST STATEMENT.**
 *    An accepted action resolves in the *next* tick (§15.2), so between `POST /act` and
 *    that tick the election book still held the payer's previous word — and the `elect`
 *    affordance's "You have currently stated: …" is built from that book. A probe restated
 *    an amount, read `IN_FULL` back in a fresh `stale: false` observation, and observed
 *    that an agent which then goes dark — 16 wakes over 288 ticks is one per 18 — takes a
 *    permanent public default it was shown as not owing. §15.4's class exactly: A5′.
 *
 * 2. **`outcome.accepted` MEANT QUEUED, AND A REFUSED FILL SAID NOTHING AT ALL.**
 *    `allocateFills` returns `{granted, refused}` and every refusal carries an invariant
 *    and a written sentence; the return value was discarded. 20+ silent no-ops across
 *    three probes, two retracted bug reports, and one probe's verdict: "an accepted no-op
 *    is strictly worse than a refusal."
 *
 * 3. **A `PARTIES` CHANNEL WITH NO PARTY CHECK.** `message` validated only that the
 *    venture existed, so an outsider could push text into a live venture's private
 *    channel — which declassifies publicly at settlement and feeds the receipt reel — and
 *    could never see a reply. A probe did it.
 *
 * 4. **A SEAL FELL BACK TO A ROLE THE AGENT DID NOT NAME.** A probe finished holding four
 *    seals attached to roles it never cited, unreadable back (a verdict is `HONOURED |
 *    CONTRADICTED` and nothing else — PROP-D2), any of which could be judged against its
 *    deeds. Its own words: "I would not have sealed at all had I known."
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **THE CLOCK.** `quiet 0..261 · commitment 262..285 · freeze 286 · settlement 287`.
 */

import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import { setSpeed } from '../../src/core/time.js';
import type { HandId, PrincipalId, SystemId, VentureId } from '../../src/core/types.js';
import { buildObservation, type Affordance } from '../../src/api/observe.js';
import { IN_FULL, openIndices, roleOfPrincipal } from '../../src/venture/index.js';
import { commonsSystems } from '../../src/world/index.js';
import {
  FILL_REFUSAL_NOTE,
  MAX_IN_FLIGHT_ELECTIONS,
  Runtime,
  type PendingCorrection,
} from '../../src/sim/runtime.js';

interface World {
  readonly runtime: Runtime;
  readonly stage: SystemId;
}

function world(seed: string, ...principals: readonly PrincipalId[]): World {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const stage = commonsSystems(runtime.world.map)[0];
  if (stage === undefined) throw new Error('the launch map has no Commons system');
  for (const principal of principals) {
    runtime.seat(principal, principal.replace('p:', ''), stage);
    runtime.standing.open(principal);
  }
  return { runtime, stage };
}

function submit(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  params: Readonly<Record<string, unknown>>,
  sequence = 0,
): void {
  const outcome = runtime.engine.submit({
    principal,
    verb,
    params,
    clientSequence: sequence,
    arrivalMs: sequence,
    decisionSource: 'LIVE',
  });
  if (!outcome.ok) throw new Error(`submit ${verb}: ${outcome.invariant} ${outcome.hint}`);
}

function tick(runtime: Runtime): void {
  const report = runtime.runTick();
  if (report.halted) {
    throw new Error(
      `halted at tick ${String(report.tick)}: ` +
        report.violations.map((v) => `${v.id} ${v.message}`).join(' | '),
    );
  }
}

/** Submit one act, run the tick, and hand back the refusal if there was one. */
function act(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  params: Readonly<Record<string, unknown>>,
  sequence = 0,
): PendingCorrection | null {
  submit(runtime, principal, verb, params, sequence);
  tick(runtime);
  return runtime.takeCorrections(principal)[0] ?? null;
}

function idleHandsOf(runtime: Runtime, principal: PrincipalId): HandId[] {
  return [...runtime.world.hands.values()]
    .filter((h) => h.principal === principal && h.state === 'IDLE')
    .map((h) => h.id);
}

function idleOf(runtime: Runtime, principal: PrincipalId): HandId {
  const found = idleHandsOf(runtime, principal)[0];
  if (found === undefined) throw new Error(`${principal} has no idle hand`);
  return found;
}

function observation(runtime: Runtime, principal: PrincipalId): ReturnType<typeof buildObservation> {
  return buildObservation({
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 16,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  });
}

/**
 * Take every `seal` affordance on offer, so PROP-D4's compliance gate is satisfied.
 *
 * Sealing is mandatory for every sealable role and it gates `create` and `fill_role`
 * (§11.1), so a test about a *different* refusal has to clear it first or it will measure
 * the wrong rule. Copied from the affordance verbatim, which is the shape agents use.
 */
function sealEverything(runtime: Runtime, principal: PrincipalId): void {
  for (const offered of observation(runtime, principal).affordances) {
    if (offered.verb !== 'seal') continue;
    const refusal = act(runtime, principal, 'seal', offered.params);
    if (refusal !== null) throw new Error(`the seal affordance was refused: ${refusal.hint}`);
  }
}

/** The `elect` affordance's readback tail, for one role — what the payer actually reads. */
function readback(runtime: Runtime, payer: PrincipalId, roleIndex: number): string {
  const found = observation(runtime, payer).affordances.find(
    (a: Affordance) => a.verb === 'elect' && a.params['role'] === roleIndex,
  );
  if (found === undefined) throw new Error(`no elect affordance for role ${String(roleIndex)}`);
  return found.what_it_forecloses;
}

/** A `FORMING` HAUL with role 0 self-dealt and role 1 open. */
function forming(w: World, payer: PrincipalId): VentureId {
  const { runtime, stage } = w;
  submit(runtime, payer, 'create', { kind: 'HAUL', stage, value: 12_000 });
  tick(runtime);
  const found = runtime.ventures
    .all()
    .find((v) => v.creator === payer && v.state === 'FORMING' && openIndices(v).length === 2);
  if (found === undefined) throw new Error('create did not mint a FORMING venture');
  submit(runtime, payer, 'fill_role', { venture: found.id, role: 0, hand: idleOf(runtime, payer) });
  tick(runtime);
  return found.id;
}

/** That venture taken all the way to `LIVE`, with `filler` on role 1. */
function live(w: World, payer: PrincipalId, filler: PrincipalId): VentureId {
  const { runtime } = w;
  const id = forming(w, payer);
  submit(runtime, filler, 'fill_role', { venture: id, role: 1, hand: idleOf(runtime, filler) });
  tick(runtime);
  const hash = runtime.ventures.require(id).termsHash;
  if (hash === null) throw new Error('no terms_hash');
  submit(runtime, payer, 'sign', { venture: id, terms_hash: hash }, 0);
  submit(runtime, filler, 'sign', { venture: id, terms_hash: hash }, 1);
  tick(runtime);
  tick(runtime);
  const state = runtime.ventures.require(id).state;
  if (state !== 'LIVE') throw new Error(`the venture is ${state}, not LIVE`);
  return id;
}

// ── 1. A5′ — the readback may never overstate a payment ──────────────────────

const PAYER = 'p:payer' as PrincipalId;
const FILLER = 'p:filler' as PrincipalId;
const OUTSIDER = 'p:outsider' as PrincipalId;

describe('A5′ — the elect readback can never claim IN_FULL while an amount is stated', () => {
  it('reports the amount the moment it is accepted, not one tick later', () => {
    const w = world('readback', PAYER, FILLER);
    const id = live(w, PAYER, FILLER);
    expect(act(w.runtime, PAYER, 'elect', { venture: id, role: 1, election: IN_FULL })).toBeNull();
    expect(w.runtime.electionOn(id, 1)).toBe(IN_FULL);
    expect(readback(w.runtime, PAYER, 1)).toContain('You have currently stated: IN_FULL');

    // The restatement is accepted into the open window and resolves next tick. THIS is
    // the read that reported `IN_FULL` — a fresh, non-stale observation, telling a payer
    // that had just declined 2340 of its due that it was paying everything.
    submit(w.runtime, PAYER, 'elect', { venture: id, role: 1, election: 2340 });
    expect(readback(w.runtime, PAYER, 1)).toContain('You have currently stated: 2340');
    expect(readback(w.runtime, PAYER, 1)).not.toContain('stated: IN_FULL');
    expect(w.runtime.electionOn(id, 1)).toBe(2340);

    // And the same answer once it has landed, so the fix is not a one-tick illusion.
    tick(w.runtime);
    expect(w.runtime.electionOn(id, 1)).toBe(2340);
    expect(readback(w.runtime, PAYER, 1)).toContain('You have currently stated: 2340');
  });

  it('never lets an in-flight statement RAISE the readback, only lower it', () => {
    // The other direction, and it is deliberately conservative: a queued `IN_FULL` may
    // still be refused for the action budget (MAX_QUEUED_PER_PRINCIPAL is eight times the
    // per-tick budget), so reporting it would be the same lie with the roles swapped.
    const w = world('raise', PAYER, FILLER);
    const id = live(w, PAYER, FILLER);
    act(w.runtime, PAYER, 'elect', { venture: id, role: 1, election: 2340 });
    expect(w.runtime.electionOn(id, 1)).toBe(2340);

    submit(w.runtime, PAYER, 'elect', { venture: id, role: 1, election: IN_FULL });
    expect(w.runtime.electionOn(id, 1)).toBe(2340);
    tick(w.runtime);
    expect(w.runtime.electionOn(id, 1)).toBe(IN_FULL);
  });

  it('reports the lower of a stated amount and a queued one, in both orders', () => {
    // Two amounts, and the answer is the same whichever is in the book — which is what
    // makes it a floor rather than a "most recent", and what makes it order-independent.
    const down = world('down', PAYER, FILLER);
    const first = live(down, PAYER, FILLER);
    act(down.runtime, PAYER, 'elect', { venture: first, role: 1, election: 5000 });
    submit(down.runtime, PAYER, 'elect', { venture: first, role: 1, election: 2340 });
    expect(down.runtime.electionOn(first, 1)).toBe(2340);

    const up = world('up', PAYER, FILLER);
    const second = live(up, PAYER, FILLER);
    act(up.runtime, PAYER, 'elect', { venture: second, role: 1, election: 2340 });
    submit(up.runtime, PAYER, 'elect', { venture: second, role: 1, election: 5000 });
    expect(up.runtime.electionOn(second, 1)).toBe(2340);
  });

  it('keeps the LEAST-paying of several statements in one window, whatever order they came in', () => {
    // Which of a payer's queued elections survives is decided by the action budget, not
    // by the last thing sent — so the readback reports the most dangerous candidate. Being
    // a minimum, the answer does not depend on arrival order (A4).
    const w = world('several', PAYER, FILLER);
    const id = live(w, PAYER, FILLER);
    act(w.runtime, PAYER, 'elect', { venture: id, role: 1, election: IN_FULL });
    submit(w.runtime, PAYER, 'elect', { venture: id, role: 1, election: 900 }, 0);
    submit(w.runtime, PAYER, 'elect', { venture: id, role: 1, election: 40 }, 1);
    submit(w.runtime, PAYER, 'elect', { venture: id, role: 1, election: 700 }, 2);
    expect(w.runtime.electionOn(id, 1)).toBe(40);
  });

  it('leaves silence reading as silence, because a decline is already the worst reading', () => {
    const w = world('silence', PAYER, FILLER);
    const id = live(w, PAYER, FILLER);
    submit(w.runtime, PAYER, 'elect', { venture: id, role: 1, election: 2340 });
    // Nothing is in the book yet and an amount is in flight. The honest answer is the
    // book's: silence pays nothing at all, which is a fuller decline than 2340.
    expect(w.runtime.electionOn(id, 1)).toBeUndefined();
    expect(readback(w.runtime, PAYER, 1)).toContain('nothing, which is a decline');
  });

  it('does not let a stranger move the payer’s readback', () => {
    // An overlay a non-payer could write into would be a fresh way to tell a payer it
    // owes something it does not — the same harm arriving from the other side.
    const w = world('stranger', PAYER, FILLER, OUTSIDER);
    const id = live(w, PAYER, FILLER);
    act(w.runtime, PAYER, 'elect', { venture: id, role: 1, election: IN_FULL });
    submit(w.runtime, OUTSIDER, 'elect', { venture: id, role: 1, election: 1 });
    expect(w.runtime.electionOn(id, 1)).toBe(IN_FULL);
    tick(w.runtime);
    expect(w.runtime.electionOn(id, 1)).toBe(IN_FULL);
  });

  it('keeps the settlement reading the book alone, so no action reacts to another (§15.2)', () => {
    // The overlay is the readback's, and only the readback's. If the settlement could see
    // it, an election accepted into the open window would change a Reckoning computed
    // from the frozen one — which is the false-default machinery §15.4 exists to prevent.
    const w = world('settle', PAYER, FILLER);
    const id = live(w, PAYER, FILLER);
    act(w.runtime, PAYER, 'elect', { venture: id, role: 1, election: IN_FULL });
    const before = w.runtime.engine.stateHash;
    submit(w.runtime, PAYER, 'elect', { venture: id, role: 1, election: 2340 });
    // The overlay is outside `state_hash` on purpose: it is a fact about the window, not
    // about the world, and two runs are compared on the latter.
    expect(w.runtime.engine.stateHash).toBe(before);
  });

  it('holds the overlay for exactly one window and reports its size', () => {
    const w = world('window', PAYER, FILLER);
    const id = live(w, PAYER, FILLER);
    expect(w.runtime.bufferSizes()['electionsInFlight']).toBe(0);
    submit(w.runtime, PAYER, 'elect', { venture: id, role: 1, election: 2340 });
    expect(w.runtime.bufferSizes()['electionsInFlight']).toBe(1);
    tick(w.runtime);
    // Applied, so the book has caught up and a survivor could only keep flooring a
    // readback that is already correct.
    expect(w.runtime.bufferSizes()['electionsInFlight']).toBe(0);
    expect(MAX_IN_FLIGHT_ELECTIONS).toBeGreaterThan(0);
  });

  it('settles on exactly what the payer was last shown, which is the whole point', () => {
    // The end-to-end claim. A payer elects an amount short of the due, reads its own
    // readback once, goes dark, and the Reckoning records a default: the harm is not the
    // default, it is being shown `IN_FULL` on the way to it.
    const w = world('endtoend', PAYER, FILLER);
    const id = live(w, PAYER, FILLER);
    act(w.runtime, PAYER, 'elect', { venture: id, role: 1, election: IN_FULL });
    submit(w.runtime, PAYER, 'elect', { venture: id, role: 1, election: 1 });
    const shown = readback(w.runtime, PAYER, 1);
    tick(w.runtime);
    while (w.runtime.ventures.require(id).state === 'LIVE') tick(w.runtime);
    const state = w.runtime.ventures.require(id).state;
    expect(state).toBe('DEFAULTED');
    // The last thing it read named the statement that produced that row.
    expect(shown).toContain('You have currently stated: 1');
  });
});

// ── 2. A refused fill reaches its agent ──────────────────────────────────────

const ALPHA = 'p:alpha' as PrincipalId;
const BRAVO = 'p:bravo' as PrincipalId;

describe('a refused fill reaches its agent, with the invariant and what to do instead', () => {
  it('tells the loser of a contested slot that it lost, and that speed would not have helped', () => {
    const w = world('contest', PAYER, ALPHA, BRAVO);
    const id = forming(w, PAYER);
    // Both bid for role 1 in one tick. The comparator resolves it by preference, then
    // stake, then principal id — never arrival — so `p:alpha` takes it.
    submit(w.runtime, ALPHA, 'fill_role', { venture: id, role: 1, hand: idleOf(w.runtime, ALPHA) });
    submit(w.runtime, BRAVO, 'fill_role', { venture: id, role: 1, hand: idleOf(w.runtime, BRAVO) });
    tick(w.runtime);

    expect(roleOfPrincipal(w.runtime.ventures.require(id), ALPHA)?.index).toBe(1);
    expect(w.runtime.takeCorrections(ALPHA)).toEqual([]);

    const refusal = w.runtime.takeCorrections(BRAVO)[0];
    expect(refusal?.verb).toBe('fill_role');
    expect(refusal?.invariant).toBe('INV-9');
    expect(refusal?.hint).toContain(FILL_REFUSAL_NOTE.LOST_CONTEST);
    // Echoed from the request, so the agent can match the refusal to what it sent.
    expect(refusal?.params['venture']).toBe(id);
    expect(refusal?.params['role']).toBe(1);
    expect(refusal?.params['hand']).toBe(idleHandsOf(w.runtime, BRAVO)[0]);
  });

  it('names the venture a committed hand is already in, rather than doing nothing', () => {
    // The second venture is created by a principal with no LIVE role of its own, because
    // PROP-D4's compliance gate refuses a new commitment from anyone holding an unsealed
    // sealable role — which is a correct rule and would otherwise be mistaken for this one.
    const w = world('committed', PAYER, ALPHA, BRAVO);
    const first = live(w, PAYER, ALPHA);
    const second = forming(w, BRAVO);
    const busy = roleOfPrincipal(w.runtime.ventures.require(first), ALPHA)?.filledByHandId;
    expect(busy).not.toBeNull();
    // PROP-D4's mandatory seal is cleared first — it gates every new commitment, so an
    // unsealed role would refuse this fill for a reason that is not the one under test.
    sealEverything(w.runtime, ALPHA);

    const refusal = act(w.runtime, ALPHA, 'fill_role', { venture: second, role: 1, hand: busy });
    expect(refusal?.invariant).toBe('INV-9');
    expect(refusal?.hint).toContain(first);
    expect(refusal?.hint).toContain(FILL_REFUSAL_NOTE.HAND_COMMITTED);
  });

  it('says one principal fills one role, when a second hand goes for a second slot', () => {
    const w = world('onerole', PAYER, ALPHA);
    const id = forming(w, PAYER);
    // ALPHA takes role 1 …
    submit(w.runtime, ALPHA, 'fill_role', { venture: id, role: 1, hand: idleOf(w.runtime, ALPHA) });
    tick(w.runtime);
    w.runtime.takeCorrections(ALPHA);
    // … and PAYER, which already holds role 0, tries role 1's neighbour with a spare hand.
    const spare = idleHandsOf(w.runtime, PAYER)[0];
    const refusal = act(w.runtime, PAYER, 'fill_role', { venture: id, role: 1, hand: spare });
    expect(refusal?.verb).toBe('fill_role');
    expect(refusal?.hint).toContain(FILL_REFUSAL_NOTE.LOST_CONTEST);
  });

  it('cites the client_sequence the agent actually sent, not the queue’s length', () => {
    // `FillRequest.clientSequence` is "a statement of the agent's own preference" (§12.3)
    // and the last tiebreak in `canonicalRequestOrder` reads it. It used to be the length
    // of the pending array — arrival order, inside the one comparator written to make
    // arrival irrelevant (A4) — and a correction citing a sequence the agent never sent
    // is one it cannot match to anything it did.
    const w = world('sequence', PAYER, ALPHA, BRAVO);
    const id = forming(w, PAYER);
    submit(w.runtime, ALPHA, 'fill_role', { venture: id, role: 1, hand: idleOf(w.runtime, ALPHA) }, 3);
    submit(w.runtime, BRAVO, 'fill_role', { venture: id, role: 1, hand: idleOf(w.runtime, BRAVO) }, 7);
    tick(w.runtime);
    expect(w.runtime.takeCorrections(BRAVO)[0]?.clientSequence).toBe(7);
  });

  it('never turns a refused fill into an event — a correction is a hint (scar #10)', () => {
    const w = world('nohint', PAYER, ALPHA, BRAVO);
    const id = forming(w, PAYER);
    submit(w.runtime, ALPHA, 'fill_role', { venture: id, role: 1, hand: idleOf(w.runtime, ALPHA) });
    submit(w.runtime, BRAVO, 'fill_role', { venture: id, role: 1, hand: idleOf(w.runtime, BRAVO) });
    tick(w.runtime);
    expect(w.runtime.takeCorrections(BRAVO)).toHaveLength(1);

    // ── THIS LOOP USED TO BE EMPTY, AND THAT MADE THE GUARD A DECORATION ──────
    //
    // It read `eventsAtTick(at)` for the contested tick. Nothing in the runtime appends
    // an event when a fill is granted or refused, so that set is **zero records** and the
    // assertion inside never ran: measured 0 events at the contested tick, and the only
    // two rows in the whole run are `venture.formed` and `levy.assessed`, both at tick 0.
    // A guard for scar #10 that iterates an empty collection is the file header's own
    // warning ("seven guards in this project have passed while testing nothing") arriving
    // in the file that quotes it.
    //
    // So: scan the WHOLE ledger, and assert first that there is something in it to scan.
    const scanned = w.runtime.events.ticks().flatMap((t) => [...w.runtime.events.eventsAtTick(t)]);
    expect(scanned.length, 'nothing was appended at all, so this asserts nothing').toBeGreaterThan(0);
    // A refusal is private and recoverable; the public record only ever carries what
    // actually happened, and the loser of a contest did nothing that happened.
    for (const record of scanned) {
      expect(JSON.stringify(record.event)).not.toContain(BRAVO);
    }
  });
});

// ── 3. The PARTIES channel, both ways ────────────────────────────────────────

describe('a venture’s channel is the parties’ once it binds, and recruiting before that', () => {
  it('refuses an outsider writing into a channel whose roles are all taken', () => {
    const w = world('leak', PAYER, FILLER, OUTSIDER);
    const id = live(w, PAYER, FILLER);
    const refusal = act(w.runtime, OUTSIDER, 'message', {
      venture: id,
      act: 'assure',
      text: 'words that would be published beside somebody else’s broken promise',
    });
    expect(refusal?.invariant).toBe('PROP-VI1');
    expect(refusal?.hint).toContain('parties');
    // Nothing was written, so nothing declassifies at settlement (§11.2, §14).
    expect(w.runtime.talksFor(PAYER)).toEqual([]);
    expect(w.runtime.talksFor(OUTSIDER)).toEqual([]);
  });

  it('lets the parties talk, and both of them read it', () => {
    const w = world('parties', PAYER, FILLER, OUTSIDER);
    const id = live(w, PAYER, FILLER);
    expect(act(w.runtime, PAYER, 'message', { venture: id, act: 'assure', text: 'on my way' })).toBeNull();
    expect(act(w.runtime, FILLER, 'message', { venture: id, act: 'accept', text: 'understood' })).toBeNull();
    expect(w.runtime.talksFor(PAYER)).toHaveLength(2);
    expect(w.runtime.talksFor(FILLER)).toHaveLength(2);
    expect(w.runtime.talksFor(OUTSIDER)).toEqual([]);
  });

  it('lets a stranger pitch for an OPEN role and READ the reply — the recruiting channel', () => {
    // The read path is the half that makes `agent.md`'s "roles are filled by talking"
    // buildable: a candidate that cannot see the creator's answer cannot negotiate, and a
    // probe named the missing reply as the reason the channel felt unusable. Nothing binds
    // until both parties countersign the same terms_hash, so an open venture has no
    // parties yet to keep a secret from — and its terms are already on the public board.
    const w = world('recruit', PAYER, OUTSIDER);
    const id = forming(w, PAYER);
    expect(
      act(w.runtime, OUTSIDER, 'message', { venture: id, act: 'offer', text: 'my hand for 8%' }),
    ).toBeNull();
    expect(act(w.runtime, PAYER, 'message', { venture: id, act: 'counter', text: '6% and no deep runs' })).toBeNull();
    const heard = w.runtime.talksFor(OUTSIDER);
    expect(heard.map((t) => t.act)).toEqual(['offer', 'counter']);
  });

  it('closes the channel to a suitor the moment the venture stops recruiting', () => {
    const w = world('closes', PAYER, FILLER, OUTSIDER);
    const id = forming(w, PAYER);
    act(w.runtime, OUTSIDER, 'message', { venture: id, act: 'offer', text: 'pick me' });
    expect(w.runtime.talksFor(OUTSIDER)).toHaveLength(1);

    // FILLER takes the last open role, so the deal is now between the two of them.
    submit(w.runtime, FILLER, 'fill_role', { venture: id, role: 1, hand: idleOf(w.runtime, FILLER) });
    tick(w.runtime);
    expect(openIndices(w.runtime.ventures.require(id))).toEqual([]);
    expect(w.runtime.talksFor(OUTSIDER)).toEqual([]);
    // And the parties still hold the whole thread, including what the suitor said.
    expect(w.runtime.talksFor(PAYER)).toHaveLength(1);

    const refusal = act(w.runtime, OUTSIDER, 'message', { venture: id, act: 'assure', text: 'still here' });
    expect(refusal?.invariant).toBe('PROP-VI1');
  });

  it('never lets a suitor read a thread it never spoke in', () => {
    // The read gate is exactly as wide as the write gate and not one row wider: a
    // recruiting channel a stranger could *read* without pitching would be a free view of
    // every negotiation in the world.
    const w = world('nosnoop', PAYER, ALPHA, OUTSIDER);
    const id = forming(w, PAYER);
    act(w.runtime, ALPHA, 'message', { venture: id, act: 'offer', text: 'mine for 9%' });
    expect(w.runtime.talksFor(ALPHA)).toHaveLength(1);
    expect(w.runtime.talksFor(OUTSIDER)).toEqual([]);
  });
});

// ── 4. A seal is charged to the role the agent named, or to none ─────────────

describe('a seal claims the role the agent named, and never a different one', () => {
  it('refuses a seal against a role the principal does not hold, and lists the ones it does', () => {
    const w = world('seal-wrong', PAYER, FILLER, ALPHA, BRAVO);
    const mine = live(w, PAYER, FILLER);
    // A LIVE venture with two role holders, neither of them the payer above.
    const theirs = live(w, ALPHA, BRAVO);
    const before = w.runtime.seals.size;

    const refusal = act(w.runtime, PAYER, 'seal', {
      verb: 'haul',
      target: theirs,
      role_venture: theirs,
      role: 0,
      measure: 'MINOR',
      outcome_low: 0,
      outcome_high: 1_000_000,
    });
    expect(refusal?.invariant).toBe('PROP-D4');
    expect(refusal?.hint).toContain('you hold no role');
    // The roles it *does* hold are named, so the next act is one action away.
    expect(refusal?.hint).toContain(mine);
    // And nothing was sealed: a mark is permanent and public, so a substitution is the
    // one thing this door must not make (A5′).
    expect(w.runtime.seals.size).toBe(before);
  });

  it('does not spend another role’s free slot when the target names no role of yours', () => {
    // The measured shape: a probe finished with four seals attached to roles it never
    // named, each charged to "the first held role that still has its free slot".
    const w = world('seal-null', PAYER, FILLER);
    const mine = live(w, PAYER, FILLER);
    const role = roleOfPrincipal(w.runtime.ventures.require(mine), PAYER);
    if (role === null) throw new Error('the payer holds no role');
    const slotsBefore = w.runtime.seals.freeSlotsRemaining(PAYER, 0, [
      { venture: mine, roleIndex: role.index },
    ]);
    expect(slotsBefore).toBe(1);

    expect(
      act(w.runtime, PAYER, 'seal', {
        verb: 'haul',
        target: mine,
        measure: 'MINOR',
        outcome_low: 0,
        outcome_high: 1_000_000,
      }),
    ).toBeNull();
    // Named its own venture and holds a role in it, so this one legitimately claims it.
    expect(
      w.runtime.seals.freeSlotsRemaining(PAYER, 0, [{ venture: mine, roleIndex: role.index }]),
    ).toBe(0);
  });

  it('accepts the affordance verbatim, which is the shape that must always work', () => {
    const w = world('seal-afford', PAYER, FILLER);
    live(w, PAYER, FILLER);
    const offered = observation(w.runtime, PAYER).affordances.find((a: Affordance) => a.verb === 'seal');
    if (offered === undefined) throw new Error('no seal affordance was offered');
    expect(act(w.runtime, PAYER, 'seal', offered.params)).toBeNull();
    expect(w.runtime.seals.size).toBe(1);
  });
});

// ── 5. §4's four-role kinds are real, and the cast has never shown one ────────

describe('the four-role, wholly-elective kinds the engine can build and the cast never creates', () => {
  it('takes a BUILD to LIVE on four distinct principals with nothing escrowed', () => {
    // ══════════════════════════════════════════════════════════════════════
    // §4's claim — that some kinds need "four or more roles" and so force cooperation by
    // arithmetic rather than by appeal — is TRUE OF THE ENGINE and was never demonstrated
    // to a player. `src/cast/heuristic.ts`'s `CREATES` table maps its four bot roles onto
    // `DIG | HAUL | ESCORT | RAID`, all two-role kinds, so `BUILD` and `SIEGE` never
    // reached the board and three Gate-3 probes concluded from the board that §4 was
    // false. That is a cast defect, not an engine one, and this test is the target it has
    // to hit: the mechanic exists, it needs four independently-capitalised counterparties
    // (A15), and it is wholly elective, which is what makes standing accrue on it at all.
    // ══════════════════════════════════════════════════════════════════════
    const four = ['p:one', 'p:two', 'p:three', 'p:four'] as PrincipalId[];
    const w = world('build', ...four);
    const [creator] = four;
    if (creator === undefined) throw new Error('no creator');

    submit(w.runtime, creator, 'create', { kind: 'BUILD', stage: w.stage, value: 40_000 });
    tick(w.runtime);
    const built = w.runtime.ventures.all().find((v) => v.kind === 'BUILD');
    if (built === undefined) throw new Error('the engine refused to mint a BUILD');
    expect(built.roles).toHaveLength(4);
    // Un-escrowable and floored at the whole consideration: there is no locked half to
    // hide behind, so every unit of it is a promise somebody can walk away from (A7).
    for (const role of built.roles) {
      expect(role.terms.escrowed).toBe(0);
      expect(role.terms.elective).toBeGreaterThan(0);
    }

    for (const [index, principal] of four.entries()) {
      submit(w.runtime, principal, 'fill_role', {
        venture: built.id,
        role: index,
        hand: idleOf(w.runtime, principal),
      }, index);
    }
    tick(w.runtime);
    const filled = w.runtime.ventures.require(built.id);
    expect(openIndices(filled)).toEqual([]);
    expect(new Set(filled.roles.map((r) => r.filledByPrincipal)).size).toBe(4);

    const hash = filled.termsHash;
    if (hash === null) throw new Error('no terms_hash');
    for (const [index, principal] of four.entries()) {
      submit(w.runtime, principal, 'sign', { venture: built.id, terms_hash: hash }, index);
    }
    tick(w.runtime);
    tick(w.runtime);
    expect(w.runtime.ventures.require(built.id).state).toBe('LIVE');
  });

  it('mints a SIEGE outside the Commons, where a hostile kind is legal', () => {
    // The other four-role kind, and its own constraint: hostile action in the Commons is
    // invalid rather than punished (A8), so a SIEGE has to be staged and aimed outside it.
    const w = world('siege');
    const four = ['p:five', 'p:six', 'p:seven', 'p:eight'] as PrincipalId[];
    const marches = w.runtime.seatInTier('MARCHES', Rng.fromSeed('siege:seat'));
    if (marches === undefined) throw new Error('the launch map has no MARCHES system');
    for (const principal of four) {
      w.runtime.seat(principal, principal.replace('p:', ''), marches);
      w.runtime.standing.open(principal);
    }
    const [creator] = four;
    if (creator === undefined) throw new Error('no creator');

    submit(w.runtime, creator, 'create', {
      kind: 'SIEGE',
      stage: marches,
      value: 60_000,
      target_system: marches,
    });
    tick(w.runtime);
    const siege = w.runtime.ventures.all().find((v) => v.kind === 'SIEGE');
    if (siege === undefined) throw new Error('the engine refused to mint a SIEGE');
    expect(siege.roles).toHaveLength(4);
    for (const role of siege.roles) expect(role.terms.escrowed).toBe(0);
  });
});
