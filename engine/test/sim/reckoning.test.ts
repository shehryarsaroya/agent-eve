/**
 * **The Reckoning, wired.** The tick loop, the venture book and the Reckoning driver
 * driving each other, at the two ticks that matter.
 *
 * `test/reckoning/**` already tests the driver against a hand-built world: the right
 * claims, the right receipts, the attribution column, the freeze biting. What none of it
 * can see is the *wiring* — whether the freeze is computed at the freeze tick from the
 * world the tick loop actually produced, whether `OBLIGE` reaches the settlement,
 * whether the seals of a Reckoning nobody sealed in still resolve, and whether a halted
 * tick puts the venture book back. Those are this file's subject.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE CLOCK.** `quiet 0..261 · commitment 262..285 · freeze 286 · settlement 287`.
 * The freeze tick and the settlement tick are **different ticks** and every test here
 * derives both from `core/time.ts` rather than writing 287 down, because `inFreeze` and
 * `isSettlementTick` were once both true at phase 287 — which made INV-18's interval
 * empty and was pinned as intended in two places before anyone noticed.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import {
  FREEZE_TICKS,
  TICKS_PER_RECKONING,
  inFreeze,
  isSettlementTick,
  setSpeed,
} from '../../src/core/time.js';
import type { PrincipalId, SystemId, VentureId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { escrowAccount, storesAccount } from '../../src/ledger/index.js';
import { computeClaims, IN_FULL, roleOfPrincipal } from '../../src/venture/index.js';
import { commonsSystems } from '../../src/world/index.js';
import {
  DELIVERY_EVENT_KIND,
  DELIVERY_MEASURE,
  DELIVERY_VERB,
  Runtime,
  electionKey,
  reckoningOf,
  ventureStateTable,
  VentureRestoreError,
} from '../../src/sim/runtime.js';
import { VentureBook } from '../../src/venture/index.js';
import { isDefaultEventKind } from '../../src/invariants/index.js';

const SETTLE_TICK = TICKS_PER_RECKONING - 1;
const FREEZE_TICK = SETTLE_TICK - FREEZE_TICKS;

/** Two principals, seated in the Commons, funded. The smallest world that can settle. */
function world(seed: string): {
  readonly runtime: Runtime;
  readonly payer: PrincipalId;
  readonly hand: PrincipalId;
  readonly stage: SystemId;
} {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const stage = commonsSystems(runtime.world.map)[0];
  if (stage === undefined) throw new Error('the launch map has no Commons system');
  const payer = 'p:payer' as PrincipalId;
  const hand = 'p:hand' as PrincipalId;
  runtime.seat(payer, 'payer', stage);
  runtime.seat(hand, 'hand', stage);
  runtime.standing.open(payer);
  runtime.standing.open(hand);
  return { runtime, payer, hand, stage };
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

/** Run to `tick` inclusive, asserting the world never halts on the way. */
function runTo(runtime: Runtime, tick: number): void {
  while (runtime.engine.tick < tick) {
    const report = runtime.runTick();
    if (report.halted) {
      throw new Error(
        `halted at tick ${String(report.tick)}: ${report.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`,
      );
    }
  }
}

/**
 * One `HAUL`, formed by `payer`, with `hand` filling role 1, taken all the way to LIVE.
 *
 * Uses the verbs an agent would use, through `submit`, because the thing under test is
 * the wiring and a fixture that reached into the book would test a world no agent can
 * reach.
 */
function haul(args: {
  readonly runtime: Runtime;
  readonly payer: PrincipalId;
  readonly hand: PrincipalId;
  readonly stage: SystemId;
  readonly election?: unknown;
  readonly openTick?: number;
}): VentureId {
  const { runtime, payer, hand, stage } = args;
  runTo(runtime, (args.openTick ?? 0) - 1);
  submit(runtime, payer, 'create', { kind: 'HAUL', stage, value: 12_000 });
  runtime.runTick();

  const venture = runtime.ventures.all().find((v) => v.creator === payer && v.state === 'FORMING');
  if (venture === undefined) throw new Error('create did not mint a venture');
  const handOf = (principal: PrincipalId): string => {
    const found = [...runtime.world.hands.values()].find(
      (h) => h.principal === principal && h.state === 'IDLE',
    );
    if (found === undefined) throw new Error(`${principal} has no idle hand`);
    return found.id;
  };

  // Both roles, or the venture never goes live: a venture goes live "filled or not at
  // all" (PROP-V6). The payer takes role 0 with its own hand — self-dealing, which is
  // legal to *fill* and earns zero standing — and the counterparty takes role 1, which
  // is the promise the elective half is actually about.
  submit(runtime, payer, 'fill_role', { venture: venture.id, role: 0, hand: handOf(payer) }, 0);
  submit(runtime, hand, 'fill_role', { venture: venture.id, role: 1, hand: handOf(hand) }, 1);
  runtime.runTick();

  const hash = venture.termsHash;
  if (hash === null) throw new Error('no terms_hash');
  submit(runtime, payer, 'sign', {
    venture: venture.id,
    terms_hash: hash,
    ...(args.election === undefined ? {} : { election: args.election }),
  }, 0);
  submit(runtime, hand, 'sign', { venture: venture.id, terms_hash: hash }, 1);
  runtime.runTick();
  runtime.runTick();

  const live = runtime.ventures.require(venture.id);
  if (live.state !== 'LIVE') throw new Error(`the venture is ${live.state}, not LIVE`);
  return venture.id;
}

describe('the freeze and the settlement are two ticks, and both are wired', () => {
  it('computes the settlement set at the freeze tick and settles it at the next one', () => {
    const { runtime, payer, hand, stage } = world('wired');
    const id = haul({ runtime, payer, hand, stage, election: IN_FULL });

    runTo(runtime, FREEZE_TICK - 1);
    expect(runtime.lastReckoning).toBeNull();

    // The freeze tick. The set is computed here and nothing settles.
    const frozenTick = runtime.runTick();
    expect(frozenTick.tick).toBe(FREEZE_TICK);
    expect(inFreeze(frozenTick.tick)).toBe(true);
    expect(isSettlementTick(frozenTick.tick)).toBe(false);
    expect(runtime.ventures.require(id).state).toBe('LIVE');
    expect(runtime.lastReckoning).toBeNull();

    // The settlement tick. One tick later, and it resolves.
    const settled = runtime.runTick();
    expect(settled.tick).toBe(SETTLE_TICK);
    expect(isSettlementTick(settled.tick)).toBe(true);
    expect(settled.halted).toBe(false);
    expect(settled.violations).toEqual([]);

    const outcome = runtime.lastReckoning;
    expect(outcome?.transaction.committed).toBe(true);
    expect(outcome?.transaction.torn).toBe(false);
    // All ten of §15.3's stages, in order.
    expect(outcome?.transaction.planned).toHaveLength(10);
    expect(outcome?.reckoning).toBe(reckoningOf(SETTLE_TICK));
    expect(runtime.ventures.require(id).state).toBe('SETTLED');
  });

  it('feeds OBLIGE the settlement set, so the cascade runs over it', () => {
    const { runtime, payer, hand, stage } = world('oblige');
    const id = haul({ runtime, payer, hand, stage, election: IN_FULL });

    runTo(runtime, FREEZE_TICK);
    const settled = runtime.runTick();
    // The cascade is the tick loop's, and the obligation it resolved is the venture.
    expect(settled.cascade).not.toBeNull();
    expect(settled.cascade?.resolved.map((s) => s.id)).toEqual([id]);
    expect(settled.cascade?.deferred).toEqual([]);
    expect(settled.cascade?.resolved[0]?.breached).toBe(false);
    // And the step budget was sized for it: `STEP_BUDGET.perObligation` exists because
    // the settlement set scales with ventures rather than hands.
    expect(settled.steps).toBeLessThanOrEqual(settled.stepBudget);
  });

  it('pays both halves, honours the elective part, and moves standing for the payer', () => {
    const { runtime, payer, hand, stage } = world('halves');
    const id = haul({ runtime, payer, hand, stage, election: IN_FULL });

    const delivered = (): number => runtime.deliveryOf(id)?.proceeds ?? -1;
    runTo(runtime, FREEZE_TICK);
    // Delivery happened before the freeze, which is what makes the settlement's inputs
    // stable across it (§5.1's hard freeze; `DELIVERY_LEAD_TICKS`).
    expect(delivered()).toBeGreaterThan(0);
    expect(runtime.deliveryOf(id)?.tick).toBe(SETTLE_TICK - FREEZE_TICKS - 1);

    const before = runtime.ledger.balance(storesAccount(hand));
    runtime.runTick();

    const venture = runtime.ventures.require(id);
    const claims = computeClaims(venture, minor(delivered()));
    const role = claims.roles[1];
    expect(role?.electiveDue).toBeGreaterThan(0);
    expect(runtime.ledger.balance(storesAccount(hand))).toBe(before + (role?.claim ?? 0));
    // Every unit that entered the pot left it.
    expect(runtime.ledger.balance(escrowAccount(id, payer))).toBe(0);

    // §6.4: standing accrues to the elective part honoured and to nothing else.
    const standing = runtime.standing.row(payer);
    expect(standing.electiveHonoured).toBe(1);
    expect(standing.electiveHonouredValue).toBe(role?.electiveDue);
    expect(standing.defaults).toBe(0);
    expect(runtime.standing.row(hand).electiveHonoured).toBe(0);
  });

  it('records a default, with its cause as a column, when the payer elects nothing', () => {
    // The other branch, and the one that must never happen by accident: no election at
    // all. PROP-V4 — "an absent entry pays nothing" — so this is a decline, and a
    // decline is a default on the record.
    const { runtime, payer, hand, stage } = world('declined');
    const id = haul({ runtime, payer, hand, stage });

    runTo(runtime, FREEZE_TICK);
    const settled = runtime.runTick();
    expect(settled.halted).toBe(false);
    expect(settled.violations).toEqual([]);

    const outcome = runtime.lastReckoning;
    expect(outcome?.transaction.committed).toBe(true);
    expect(runtime.ventures.require(id).state).toBe('DEFAULTED');
    expect(outcome?.defaults).toHaveLength(1);

    const accusation = outcome?.defaults[0];
    expect(accusation?.promisor).toBe(payer);
    expect(accusation?.obligation).toBe(id);
    // INV-17's whole point: the evidence is a row, joinable by an auditor who does not
    // have our code, and it is not the accusation itself.
    expect(accusation?.cause).toBe('ELAPSED_WINDOW');
    expect(accusation?.causeEventId).not.toBe(accusation?.defaultEventId);
    const evidence = runtime.events.get(accusation?.causeEventId ?? ('' as never));
    expect(evidence).not.toBeNull();
    expect(isDefaultEventKind(evidence?.event.kind ?? '')).toBe(false);

    // Standing fell, and only for the payer.
    expect(runtime.standing.row(payer).defaults).toBe(1);
    expect(runtime.standing.row(payer).lastDefaultTick).toBe(SETTLE_TICK);
    expect(runtime.standing.row(hand).defaults).toBe(0);
  });

  it('refuses a commitment inside the freeze rather than halting on a moved balance', () => {
    // ── The false-default route, closed at the door ──────────────────────────
    //
    // `verifyFrozenInputs` re-reads the escrow and the payer's free stores at the
    // settlement tick and halts on any difference **in either direction**. So one
    // `create` by a payer at the freeze or settlement tick funds an escrow out of the
    // figure the settlement was computed from and stops the world on a tick where
    // nothing was wrong. A refusal costs the agent one action and a hint; a halt would
    // be a denial of settlement anybody could trigger with an ordinary act (AGT-X9).
    const { runtime, payer, hand, stage } = world('frozen');
    haul({ runtime, payer, hand, stage, election: IN_FULL });
    runTo(runtime, FREEZE_TICK - 1);

    for (const tick of [FREEZE_TICK, SETTLE_TICK]) {
      submit(runtime, payer, 'create', { kind: 'DIG', stage, value: 6_000 });
      const report = runtime.runTick();
      expect(report.tick).toBe(tick);
      expect(report.halted).toBe(false);
      expect(report.violations).toEqual([]);
      expect(report.refused).toBe(1);
    }
    // The refusal reached the agent as a correction rather than vanishing.
    const held = runtime.takeCorrections(payer);
    expect(held).toHaveLength(2);
    expect(held[0]?.invariant).toBe('INV-18');
    expect(held[0]?.hint).toContain('freeze');
  });

  it('halts rather than settling when a raid moves the money inside the freeze', () => {
    // ── E2E-12 at the runtime level, and §15.4's own sentence ────────────────
    //
    // > I commit to pay from account X; during the window my convoy is raided and X is
    // > drained; my "default" is your bug, permanently attached to my name, invisible in
    // > a healthy-looking system.
    //
    // Predation is not built, so the raid is performed the way one would move the value
    // — straight through the ledger, after the freeze has read it. There is no
    // `disableFreeze` switch anywhere near production code; what is asserted here is
    // that the halt **reaches the tick loop**: the driver reports, the `assertions` hook
    // carries it into ASSERT, the tick aborts, the world PAUSES, and the venture book is
    // put back. Nothing is published and nobody is accused.
    const { runtime, payer, hand, stage } = world('raided');
    const id = haul({ runtime, payer, hand, stage, election: IN_FULL });

    runTo(runtime, FREEZE_TICK - 1);
    runtime.runTick(); // the freeze reads the payer's stores here
    const before = runtime.engine.snapshot();

    runtime.ledger.transferCurrency({
      eventId: 'raid::probe' as never,
      tick: FREEZE_TICK,
      from: storesAccount(payer),
      to: storesAccount(hand),
      amount: minor(1_000),
    });

    const settled = runtime.runTick();
    expect(settled.tick).toBe(SETTLE_TICK);
    expect(settled.halted).toBe(true);
    // The halt names the account and the direction, which is the sentence an operator
    // needs at 04:00 — not merely that a hash differed.
    const message = settled.violations.map((v) => v.message).join(' ');
    expect(message).toContain(storesAccount(payer));
    expect(message).toContain('the settlement inputs moved between the freeze and the settlement');
    // Nothing was published and nobody was accused.
    expect(settled.stateHash).toBe('');
    expect(runtime.register.size).toBe(0);
    expect(runtime.ventures.require(id).state).toBe('LIVE');
    // And the abort was complete: every registered table went back.
    expect(settled.rollback).toBe('FULL');
    expect(settled.rollbackGaps).toEqual([]);
    expect(runtime.engine.snapshot().stateHash).toBe(before.stateHash);
    expect(runtime.paused).toBe(true);
  });

  it('settles a Reckoning that nobody was party to, so the seals still resolve', () => {
    // A Reckoning with an empty settlement set still has to happen: INV-20 requires
    // every seal made in it to be resolved when it closes, and `checkUnjudgedSeals`
    // halts a tick later on a Reckoning that never ran.
    const { runtime } = world('empty');
    runTo(runtime, FREEZE_TICK);
    const settled = runtime.runTick();
    expect(settled.halted).toBe(false);
    expect(runtime.lastReckoning?.settlements).toEqual([]);
    expect(runtime.seals.isResolved(reckoningOf(SETTLE_TICK))).toBe(true);
  });
});

/**
 * Seal the delivery of a role this principal holds, through the handler the verb table
 * would call.
 *
 * The `seal` verb is not registered (see `cli.test.ts`), so this drives
 * {@link Runtime.sealHandler} directly. What the seal tests are about is the driver's
 * SEALS stage and the deed set behind it, not the verb's registration.
 */
function sealDelivery(runtime: Runtime, principal: PrincipalId, id: VentureId): void {
  const role = roleOfPrincipal(runtime.ventures.require(id), principal);
  if (role === null) throw new Error(`${principal} holds no role in ${id}`);
  const sealed = runtime.sealHandler(
    {
      phase: 'VALIDATE+LOCK',
      tick: runtime.engine.tick + 1,
      world: runtime.world,
      // Its own stream: the tick's seed is sealed until that tick's window closes
      // (DET-6), and the seal handler draws nothing anyway.
      rng: Rng.fromSeed('test::seal'),
      actions: [],
      intents: runtime.engine.intents,
      frozenStateVersion: runtime.engine.stateVersion,
      clock: { reckoning: 0, ticksUntilReckoning: 1, inCommitmentWindow: false, inFreeze: false, isSettlementTick: false },
      emit: () => undefined,
      step: () => undefined,
      createIntent: () => {
        throw new Error('not used');
      },
      offerWake: () => undefined,
    },
    {
      principal,
      verb: 'seal',
      params: {
        verb: DELIVERY_VERB,
        target: id,
        role: role.index,
        measure: DELIVERY_MEASURE,
        outcome_low: 0,
        outcome_high: 1_000_000,
      },
      decisionSource: 'LIVE',
      intentId: null,
    },
  );
  if (!sealed.ok) throw new Error(`seal refused: ${sealed.invariant} ${sealed.hint}`);
}

describe('seals are judged against deeds the engine recorded', () => {
  it('honours a seal whose band the delivery landed in, citing the deed', () => {
    const { runtime, payer, hand, stage } = world('sealed');
    const id = haul({ runtime, payer, hand, stage, election: IN_FULL });

    sealDelivery(runtime, hand, id);
    expect(runtime.seals.size).toBe(1);

    runTo(runtime, FREEZE_TICK);
    const settled = runtime.runTick();
    expect(settled.halted).toBe(false);
    expect(settled.violations).toEqual([]);

    const resolution = runtime.lastReckoning?.seals;
    expect(resolution?.verdicts).toHaveLength(1);
    expect(resolution?.verdicts[0]?.verdict).toBe('HONOURED');
    expect(resolution?.verdicts[0]?.principal).toBe(hand);
    // A healthy Reckoning defers nothing and reconciles its own witness.
    expect(resolution?.deferred).toEqual([]);
    expect(resolution?.deedSetFaults).toEqual([]);

    // The verdict cites the delivery, which is a row in the record and not a claim.
    const record = runtime.seals.auditRecord(resolution?.verdicts[0]?.sealId ?? ('' as never));
    const cited = runtime.events.get(record?.citedDeedEventId ?? ('' as never));
    expect(cited?.event.kind).toBe(DELIVERY_EVENT_KIND);
    expect(record?.evaluations).toBe(1);
  });

  it('marks nothing from an absence when the deed tally and the deeds disagree', () => {
    // ── The completeness witness, doing the only thing it is for ─────────────
    //
    // The tally comes from the venture rows and the deeds come from the delivery
    // records, so a delivery record that goes missing makes the two disagree — and the
    // principal it dropped looks exactly like one that abstained. A5′: the answer is to
    // make **no mark**, report the mismatch, and never halt.
    //
    // ── THERE HAS TO BE A SEAL IN THE WORLD, OR THIS TEST IS A TAUTOLOGY ──────
    //
    // Without one, `verdicts` is empty because nobody sealed, and the assertion that
    // "nothing was marked" passes whatever the tally does. Verified by mutation: with
    // `deedTallyFor` derived from the deed array it is checked against — the exact
    // defect the two-roads rule exists to stop, and one that has shipped in this
    // project once — this seal comes back `CONTRADICTED` with a permanent standing
    // charge on a principal that delivered exactly what it said it would.
    const { runtime, payer, hand, stage } = world('witness');
    const id = haul({ runtime, payer, hand, stage, election: IN_FULL });
    sealDelivery(runtime, hand, id);
    expect(runtime.seals.size).toBe(1);
    runTo(runtime, FREEZE_TICK);

    // Two roads, and this cuts one of them: the deed rows vanish while the venture rows
    // still say a delivery happened for this principal.
    const deliveries = runtime as unknown as { readonly deliveries: Map<VentureId, unknown> };
    expect(deliveries.deliveries.delete(id)).toBe(true);

    const settled = runtime.runTick();
    // Not a halt. The world keeps running and the operator gets a sentence.
    expect(settled.halted).toBe(false);
    const resolution = runtime.lastReckoning?.seals;
    // Nobody marked, and the seal is *held* rather than judged: a mark from an absence
    // the engine itself caused is the permanent penalty A5′ puts below crashing.
    expect(resolution?.verdicts).toEqual([]);
    expect(resolution?.deferred.map((d) => d.basis)).toEqual(['UNWITNESSED_DEED_SET']);
    expect(runtime.standing.row(hand).contradictedSeals).toBe(0);
    expect(runtime.lastReckoning?.deedSetFaults.length ?? 0).toBeGreaterThan(0);
  });
});

describe('the record is actually written', () => {
  it('appends the events the tick buffered, so the ledger is not silently empty', () => {
    // ── The regression for a fix with no guard on it ──────────────────────────
    //
    // The runtime once registered **no** `EventSink`, so every `ctx.emit` draft was
    // buffered for the tick and dropped at COMMIT: `venture.formed` never reached the
    // record and the `EventLedger` was permanently empty. It went unnoticed because
    // nothing asserted it — events are not in `state_hash`, so the sim's hash stream is
    // byte-identical with the sink removed, and the whole suite stayed green. Verified
    // by mutation: replacing the sink with `() => undefined` passed all 1,822 tests.
    //
    // So this asserts the *record*, not the projection: the viewer, the audit trail and
    // the dataset are all reads of this table, and a formation nobody can join to its
    // settlement breaks the receipt reel (§14) without breaking anything measurable.
    const { runtime, payer, hand, stage } = world('recorded');
    const id = haul({ runtime, payer, hand, stage, election: IN_FULL });

    const formed = runtime.events
      .transcript(`venture::${id}`, runtime.engine.tick, { kind: 'VIEWER' })
      .filter((row) => row.event.kind === 'venture.formed');
    expect(formed).toHaveLength(1);
    expect(formed[0]?.event.actorPrincipalId).toBe(payer);
    expect(formed[0]?.event.payload['venture']).toBe(id);
    // And nothing was refused on the way in: `recordEvents` turns a rejected row into an
    // operator fault rather than a throw, so an empty fault list is the other half.
    expect(runtime.operatorFaults()).toEqual([]);
  });
});

describe('the venture book can be rolled back', () => {
  it('round-trips a whole book — states, fills, signatures and paid-so-far markers', () => {
    const { runtime, payer, hand, stage } = world('rollback');
    haul({ runtime, payer, hand, stage, election: IN_FULL });
    runTo(runtime, FREEZE_TICK);
    runtime.runTick();

    let held = runtime.ventures;
    const table = ventureStateTable(
      () => held,
      (book) => {
        held = book;
      },
    );
    const captured = table.capture();
    if (table.restore === undefined) throw new Error('the venture table has no restore path');
    table.restore(captured);
    expect(table.capture()).toEqual(captured);
    expect(held).not.toBe(runtime.ventures);
    // The index came back from the rows, not from a captured copy of itself.
    for (const venture of held.all()) {
      for (const role of venture.roles) {
        if (role.filledByHandId === null) continue;
        const commitment = held.commitmentOf(role.filledByHandId);
        const live = venture.state === 'FORMING' || venture.state === 'LIVE';
        expect(commitment?.venture === venture.id).toBe(live);
      }
    }
    expect(held.checkVentureInvariants(SETTLE_TICK)).toEqual([]);
  });

  it('refuses a capture it cannot reproduce, rather than restoring a different world', () => {
    // The load-bearing line. A restore that silently produced a *slightly* different
    // book would make every later hash comparison agree about two different worlds.
    let held = new VentureBook();
    const table = ventureStateTable(
      () => held,
      (book) => {
        held = book;
      },
    );
    const { runtime, payer, hand, stage } = world('tamper');
    haul({ runtime, payer, hand, stage, election: IN_FULL });
    let source = runtime.ventures;
    const captured = ventureStateTable(
      () => source,
      (book) => {
        source = book;
      },
    ).capture();

    const rows = captured as { termsHash: string; deferrals: number }[];
    const first = rows[0];
    if (first === undefined) throw new Error('nothing captured');
    // A row whose terms were edited after signing: the hash no longer matches what the
    // constructor produces, which is E2E-14's shape one layer down.
    expect(() => table.restore?.([{ ...first, termsHash: 'deadbeef' }])).toThrow(VentureRestoreError);
  });

  it('undoes a halted tick, including the ventures it created', () => {
    // The operator's story, made true: a halt at ASSERT puts the world back at
    // `snapshot_T` and the report says so, so "replay the failed tick from the immutable
    // triple" is a procedure rather than a hope.
    const { runtime, payer, stage } = world('halt');
    runTo(runtime, 4);
    const before = runtime.engine.snapshot();
    const ventures = runtime.ventures.size;

    // A HALT-severity violation from a registered assertion, which is how any module
    // stops a tick. Injected through the engine's own hook rather than by corrupting
    // state, so the tick fails for a reason the abort path is built for.
    const engine = runtime.engine as unknown as {
      assertions: ((tick: number) => readonly { id: string; tick: number; severity: string; message: string }[])[];
    };
    engine.assertions.push((tick) => [
      { id: 'INV-1', tick, severity: 'HALT', message: 'injected, to abort this tick on purpose' },
    ]);

    submit(runtime, payer, 'create', { kind: 'DIG', stage, value: 6_000 });
    const report = runtime.runTick();
    expect(report.halted).toBe(true);
    expect(report.rollback).toBe('FULL');
    expect(report.rollbackGaps).toEqual([]);
    // The venture the failed tick created is gone, and the book is byte-identical to
    // the one the tick started from.
    expect(runtime.ventures.size).toBe(ventures);
    expect(runtime.engine.snapshot().stateHash).toBe(before.stateHash);
    expect(runtime.paused).toBe(true);
    // And the runtime refuses to keep ticking, rather than spinning on a halted world.
    expect(() => runtime.runTick()).toThrow(/PAUSED/);
  });
});

describe('the report is how Gate 3 gets read', () => {
  it('counts what happened rather than inferring it', () => {
    const { runtime, payer, hand, stage } = world('report');
    const id = haul({ runtime, payer, hand, stage, election: IN_FULL });
    runTo(runtime, SETTLE_TICK);

    const rows = runtime.reckonings();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.tick).toBe(SETTLE_TICK);
    expect(row?.committed).toBe(true);
    expect(row?.obligations).toBe(1);
    expect(row?.settled).toBe(1);
    expect(row?.defaulted).toBe(0);
    expect(row?.deferred).toBe(0);
    expect(row?.defaults).toBe(0);
    expect(row?.electiveHonoured).toBe(1);
    expect(row?.standingMoves).toBe(1);
    expect(row?.paidElective).toBeGreaterThan(0);
    expect(row?.proceeds).toBe(runtime.deliveryOf(id)?.proceeds);
    // Nothing the driver reports as an alarm went unreported.
    expect(runtime.operatorFaults()).toEqual([]);
    expect(row?.deedSetFaults).toBe(0);

    // A delivery accuses nobody, so the attribution index must not think it is an
    // accusation — a kind INV-17 read as one would demand evidence for good news.
    expect(isDefaultEventKind(DELIVERY_EVENT_KIND)).toBe(false);
    const delivery = runtime.events.get(runtime.deliveryOf(id)?.eventId ?? ('' as never));
    expect(delivery?.event.kind).toBe(DELIVERY_EVENT_KIND);
    expect(delivery?.event.isPublic).toBe(true);
    // Every row this runtime writes is in the venture's cohort, so the receipt reel
    // pulls formation, delivery and settlement out of one query (§15.1).
    expect(delivery?.event.eventFamilyId).toBe(`venture::${id}`);
  });

  it('releases the election when the obligation finishes, so the book stays bounded', () => {
    const { runtime, payer, hand, stage } = world('bounded');
    const id = haul({ runtime, payer, hand, stage, election: IN_FULL });
    expect(runtime.bufferSizes()['elections']).toBeGreaterThan(0);
    expect(electionKey(id, 0)).toContain('::');
    runTo(runtime, SETTLE_TICK);
    expect(runtime.bufferSizes()['elections']).toBe(0);
  });
});
