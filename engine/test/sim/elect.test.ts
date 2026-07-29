/**
 * **`elect` and `seal`, as verbs an agent can actually reach** — and the two A5′ traps
 * that had to close before either could be registered.
 *
 * `test/venture/election.test.ts` already proves the settlement arithmetic: `IN_FULL`
 * caps at the due, an absent entry pays nothing, `DECLINED` and `UNFUNDED` are different
 * rows. `test/reckoning/seals.test.ts` proves the verdict. What neither can see is the
 * *door*: whether a payer is ever offered the choice, whether it can still change its
 * mind at the moment that matters, and whether the thing the server tells an agent to
 * seal is a thing the resolver will let it keep.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE TWO DEFECTS THIS FILE IS THE REGRESSION FOR.**
 *
 * 1. **The election was a parameter on `sign`.** So it was locked at signing — before the
 *    residual is drawn, and before there is any leverage to abuse. A6's signature moment
 *    is authority abused *at the moment of maximum leverage*, and §7.6's falsification
 *    test — *is the elective part always honoured?* — cannot be asked of a payer that was
 *    never offered the choice when it counted. The core loop was unreachable.
 * 2. **The seal affordance named `verb: 'sign'`** and this world records no `sign` deed.
 *    With the completeness witness working, such a seal resolves `CONTRADICTED` from an
 *    absence: a permanent public lie about an agent that copied the server's own
 *    affordance. That is the one penalty this design calls worse than a crash.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **THE CLOCK.** `quiet 0..261 · commitment 262..285 · freeze 286 · settlement 287`.
 * Derived from `core/time.ts` and never written down, because `inFreeze` and
 * `isSettlementTick` were once both true at phase 287.
 */

import { describe, expect, it } from 'vitest';
import {
  FREEZE_TICKS,
  TICKS_PER_RECKONING,
  inFreeze,
  isSettlementTick,
  setSpeed,
} from '../../src/core/time.js';
import type { PrincipalId, SystemId, VentureId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { storesAccount } from '../../src/ledger/index.js';
import { computeClaims, IN_FULL, roleOfPrincipal } from '../../src/venture/index.js';
import { slotClaimAt } from '../../src/observe/forecast.js';
import { commonsSystems } from '../../src/world/index.js';
import { buildObservation, type Affordance } from '../../src/api/observe.js';
import {
  assertSealSchedule,
  DELIVERY_EVENT_KIND,
  DELIVERY_LEAD_TICKS,
  DELIVERY_VERB,
  ELECTABLE_VENTURE_STATES,
  Runtime,
  electionsStateTable,
  electionKey,
  type PendingCorrection,
} from '../../src/sim/runtime.js';
import type { Election } from '../../src/venture/index.js';

const SETTLE_TICK = TICKS_PER_RECKONING - 1;
const FREEZE_TICK = SETTLE_TICK - FREEZE_TICKS;
/** The last tick on which a decision aimed at tonight can still be taken. */
const LAST_ACTING_TICK = FREEZE_TICK - 1;

interface World {
  readonly runtime: Runtime;
  readonly payer: PrincipalId;
  readonly hand: PrincipalId;
  readonly stage: SystemId;
}

function world(seed: string): World {
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

/**
 * Submit one act, run the tick, and hand back the refusal if there was one.
 *
 * A handler refusal is only knowable after the tick resolves — the handler mutates, so it
 * must not run at submit — so it arrives through the correction channel rather than as a
 * return value. That asymmetry is what this helper exists to hide.
 */
function act(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  params: Readonly<Record<string, unknown>>,
): PendingCorrection | null {
  submit(runtime, principal, verb, params);
  const report = runtime.runTick();
  if (report.halted) {
    throw new Error(
      `${verb} halted the world at tick ${String(report.tick)}: ` +
        report.violations.map((v) => `${v.id} ${v.message}`).join(' | '),
    );
  }
  return runtime.takeCorrections(principal)[0] ?? null;
}

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
 * One `HAUL` taken to `LIVE`. Role 0 is the payer's own hand (self-dealt); role 1 is the
 * counterparty's, and it is the only role an elective half is actually owed on.
 *
 * **No election is made here.** Every test below states its own, because when and whether
 * the payer elects is the subject.
 */
function haul(w: World): VentureId {
  const { runtime, payer, hand, stage } = w;
  submit(runtime, payer, 'create', { kind: 'HAUL', stage, value: 12_000 });
  runtime.runTick();
  const venture = runtime.ventures.all().find((v) => v.creator === payer && v.state === 'FORMING');
  if (venture === undefined) throw new Error('create did not mint a venture');
  const idleOf = (principal: PrincipalId): string => {
    const found = [...runtime.world.hands.values()].find(
      (h) => h.principal === principal && h.state === 'IDLE',
    );
    if (found === undefined) throw new Error(`${principal} has no idle hand`);
    return found.id;
  };
  submit(runtime, payer, 'fill_role', { venture: venture.id, role: 0, hand: idleOf(payer) }, 0);
  submit(runtime, hand, 'fill_role', { venture: venture.id, role: 1, hand: idleOf(hand) }, 1);
  runtime.runTick();
  const hash = venture.termsHash;
  if (hash === null) throw new Error('no terms_hash');
  submit(runtime, payer, 'sign', { venture: venture.id, terms_hash: hash }, 0);
  submit(runtime, hand, 'sign', { venture: venture.id, terms_hash: hash }, 1);
  runtime.runTick();
  runtime.runTick();
  const live = runtime.ventures.require(venture.id);
  if (live.state !== 'LIVE') throw new Error(`the venture is ${live.state}, not LIVE`);
  return venture.id;
}

function observe(runtime: Runtime, principal: PrincipalId): readonly Affordance[] {
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
  }).affordances;
}

function briefing(runtime: Runtime, principal: PrincipalId): Readonly<Record<string, unknown>> {
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
  }).briefing;
}

// ── `elect`, the verb ────────────────────────────────────────────────────────

describe('`elect` is a real verb, offered every tick until the freeze', () => {
  it('is registered, and the affordance carries all six honesty fields', () => {
    const w = world('offered');
    expect(w.runtime.liveVerbs.has('elect')).toBe(true);

    const id = haul(w);
    const offered = observe(w.runtime, w.payer).filter((a) => a.verb === 'elect');
    // One per elective role the payer pays — role 1 only, because role 0 is its own.
    expect(offered).toHaveLength(1);
    const a = offered[0];
    expect(a?.params['venture']).toBe(id);
    expect(a?.params['role']).toBe(1);
    expect(a?.params['election']).toBe(IN_FULL);
    expect(a?.cost).toBe(1);
    expect(a?.max_direct_loss).toBeGreaterThan(0);
    expect(a?.max_contingent_liability).toBe(0);
    expect(a?.expires_tick).toBe(LAST_ACTING_TICK);
    expect(String(a?.quote_id).length).toBeGreaterThan(0);
    // The whole truth about the alternative, in the field an agent reads before acting.
    expect(String(a?.what_it_forecloses)).toContain('decline');
    expect(String(a?.what_it_forecloses)).toContain('permanent public default');
    expect(String(a?.what_it_forecloses)).toContain('nothing, which is a decline');
  });

  it('offers it on EVERY tick from signing to the last acting tick, not just once', () => {
    // "The elective half is a real choice *every time*, not a box you ticked when you
    // signed." An affordance offered once and then withdrawn would be the old behaviour
    // wearing the new verb's name.
    const w = world('every-tick');
    const id = haul(w);
    // ── ELECT FIRST, OR THIS PROVES NOTHING ──────────────────────────────────
    //
    // A first version swept the ticks without ever electing, and a mutation proved it
    // worthless: gating the affordance on `stated === undefined` — which is the old
    // once-only behaviour wearing the new verb's name — left it **green**, because a payer
    // that never states anything is offered the choice forever either way. The property is
    // that the offer *survives having been taken*, so the sweep starts after a statement.
    expect(act(w.runtime, w.payer, 'elect', { venture: id, role: 1, election: IN_FULL })).toBeNull();
    let offeredOn = 0;
    let missing = 0;
    while (w.runtime.engine.tick < LAST_ACTING_TICK) {
      w.runtime.runTick();
      const has = observe(w.runtime, w.payer).some((a) => a.verb === 'elect');
      if (has) offeredOn += 1;
      else missing += 1;
    }
    expect(missing).toBe(0);
    expect(offeredOn).toBeGreaterThan(200);
    // And it is still offered on the very last tick a restatement is legal.
    expect(w.runtime.engine.tick).toBe(LAST_ACTING_TICK);
    expect(observe(w.runtime, w.payer).some((a) => a.verb === 'elect')).toBe(true);
  });

  it('stops offering it inside the freeze, because there is nothing there to offer', () => {
    const w = world('freeze-offer');
    haul(w);
    runTo(w.runtime, LAST_ACTING_TICK);
    expect(observe(w.runtime, w.payer).some((a) => a.verb === 'elect')).toBe(true);
    w.runtime.runTick();
    expect(inFreeze(w.runtime.engine.tick)).toBe(true);
    expect(observe(w.runtime, w.payer).some((a) => a.verb === 'elect')).toBe(false);
  });

  it('is restatable, and the LAST statement is what settles', () => {
    // The whole point of the split. IN_FULL, then a partial, then a smaller partial —
    // and the money that moves is the last one's.
    const w = world('restate');
    const id = haul(w);
    expect(act(w.runtime, w.payer, 'elect', { venture: id, role: 1, election: IN_FULL })).toBeNull();
    expect(w.runtime.electionOn(id, 1)).toBe(IN_FULL);
    expect(act(w.runtime, w.payer, 'elect', { venture: id, role: 1, election: 400 })).toBeNull();
    expect(w.runtime.electionOn(id, 1)).toBe(400);
    expect(act(w.runtime, w.payer, 'elect', { venture: id, role: 1, election: 150 })).toBeNull();
    expect(w.runtime.electionOn(id, 1)).toBe(150);

    runTo(w.runtime, FREEZE_TICK);
    const before = w.runtime.ledger.balance(storesAccount(w.hand));
    w.runtime.runTick();
    const settlement = w.runtime.lastReckoning?.settlements[0];
    const paid = settlement?.payouts.find((p) => p.roleIndex === 1);
    expect(paid?.electivePaid).toBe(150);
    // 150 of elective, plus whatever the escrowed half paid.
    expect(w.runtime.ledger.balance(storesAccount(w.hand))).toBe(
      before + (paid?.escrowedPaid ?? 0) + 150,
    );
    // Short of the due is a decline, and a decline is a default with that cause.
    expect(settlement?.defaults[0]?.cause).toBe('DECLINED');
  });

  it('refuses at the freeze and at settlement, and says the last statement stands', () => {
    // §5.1: "there is no decision to make inside this window". The refusal must not tell
    // the payer to try again next tick — the tick after the freeze is the settlement, by
    // which time the obligation it was about has resolved.
    const w = world('frozen-elect');
    const id = haul(w);
    runTo(w.runtime, FREEZE_TICK - 1);

    for (const tick of [FREEZE_TICK, SETTLE_TICK]) {
      const refusal = act(w.runtime, w.payer, 'elect', { venture: id, role: 1, election: IN_FULL });
      expect(w.runtime.engine.tick).toBe(tick);
      expect(refusal?.invariant).toBe('INV-18');
      expect(refusal?.hint).toContain('is what happens tonight');
      expect(refusal?.hint).toContain('elections are closed');
      // §5.1's reason, in the agent's own words, because a rule without its reason is a
      // rule an agent will read as arbitrary.
      expect(refusal?.hint).toContain('offline');
      // And NOT `committing`'s sentence, which would be a lie here: the tick after the
      // freeze is the settlement, by which time this obligation has resolved.
      expect(refusal?.hint).not.toContain('submit again next tick');
    }
    // And it changed nothing: silence stayed silence.
    expect(w.runtime.electionOn(id, 1)).toBeUndefined();
  });

  it('lets only the payer of the role elect on it', () => {
    const w = world('payer-only');
    const id = haul(w);
    const refusal = act(w.runtime, w.hand, 'elect', { venture: id, role: 1, election: IN_FULL });
    expect(refusal?.invariant).toBe('PROP-V4');
    // The wording moved when `elect` learned about mandates (A6): a non-creator is no longer simply
    // "not the payer", it is someone who *holds no live grant* from the payer. The refusal still names
    // the payer and now also names the way in, which is the A2 requirement for a dead end.
    expect(refusal?.hint).toContain('you hold no live grant');
    expect(refusal?.hint, 'and it must still say WHOSE money it is').toContain('elects on');
    expect(w.runtime.electionOn(id, 1)).toBeUndefined();
  });

  it('refuses an election on a role the payer holds itself, and says why', () => {
    // Settlement books a payment to your own stores as paid in full *before* it reads the
    // election, so it can never read as a breach (scar #9). An agent that thought it was
    // paying somebody would be budgeting for a payment that never happens.
    const w = world('self-dealt');
    const id = haul(w);
    const refusal = act(w.runtime, w.payer, 'elect', { venture: id, role: 0, election: IN_FULL });
    expect(refusal?.invariant).toBe('PROP-V4');
    expect(refusal?.hint).toContain('yourself');
    expect(w.runtime.electionOn(id, 0)).toBeUndefined();
    // And the affordance never offered role 0 in the first place.
    expect(observe(w.runtime, w.payer).filter((a) => a.verb === 'elect')).toHaveLength(1);
  });

  it('names the roles it does have when the index is wrong, and never throws', () => {
    const w = world('bad-role');
    const id = haul(w);
    for (const role of [2, 99, -1]) {
      const refusal = act(w.runtime, w.payer, 'elect', { venture: id, role, election: IN_FULL });
      expect(refusal?.invariant).toBe('PROP-V6');
      expect(refusal?.hint).toContain('CARRIER');
    }
  });

  it('refuses an election on a finished obligation, so the shared book cannot be filled', () => {
    // ══════════════════════════════════════════════════════════════════════
    // A5′ REACHED SIDEWAYS, THROUGH A BUFFER — and it was live until this gate.
    //
    // `releaseElections` runs when an obligation goes terminal, so an election accepted
    // *after* that is a key nothing ever cleans up. The book is **shared** and has a
    // published cap: an agent electing on a few thousand of its own settled ventures fills
    // it, and then every *other* payer's `elect` is refused for INV-26 — silently forcing
    // `DECLINED` defaults on principals that were trying to pay. Nobody would have been
    // accused of anything by the agent doing it.
    //
    // The gate is the electable states, which are exactly the states that still release.
    // ══════════════════════════════════════════════════════════════════════
    const w = world('terminal');
    const id = haul(w);
    runTo(w.runtime, FREEZE_TICK);
    w.runtime.runTick();
    expect(['SETTLED', 'DEFAULTED']).toContain(w.runtime.ventures.require(id).state);
    // Every key this venture ever held was released when it finished.
    expect(w.runtime.bufferSizes()['elections']).toBe(0);

    const refusal = act(w.runtime, w.payer, 'elect', { venture: id, role: 1, election: IN_FULL });
    expect(refusal?.invariant).toBe('PROP-V6');
    expect(refusal?.hint).toContain('nothing left to elect');
    // And nothing was written, so the book is still empty.
    expect(w.runtime.electionOn(id, 1)).toBeUndefined();
    expect(w.runtime.bufferSizes()['elections']).toBe(0);
    // The affordance agrees: a finished obligation is not offered.
    expect(observe(w.runtime, w.payer).some((a) => a.verb === 'elect')).toBe(false);
    // One home for the list, so the door and the offer cannot drift apart.
    expect(
      [...ELECTABLE_VENTURE_STATES].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ).toEqual(['DEFERRED', 'FORMING', 'LIVE']);
  });

  it('is per role, so one counterparty can be paid and another declined', () => {
    // The limitation the previous build reported: one statement covered a whole venture,
    // so a payer could not honour one promise and break another inside one obligation.
    const w = world('per-role');
    const id = haul(w);
    expect(act(w.runtime, w.payer, 'elect', { venture: id, role: 1, election: IN_FULL })).toBeNull();
    expect(w.runtime.electionOn(id, 1)).toBe(IN_FULL);
    // Role 0's key is untouched, which is what "per role" means at the storage layer.
    expect(w.runtime.electionOn(id, 0)).toBeUndefined();
    expect(electionKey(id, 1)).toContain('::');
    expect(electionKey(id, 1)).not.toBe(electionKey(id, 0));
  });
});

describe("silence, IN_FULL and an unfundable IN_FULL are three different records", () => {
  it('records DECLINED when the payer never elects — silence is a decline', () => {
    const w = world('silence');
    const id = haul(w);
    runTo(w.runtime, FREEZE_TICK);
    w.runtime.runTick();
    const settlement = w.runtime.lastReckoning?.settlements[0];
    expect(settlement?.terminalState).toBe('DEFAULTED');
    expect(settlement?.defaults[0]?.cause).toBe('DECLINED');
    expect(w.runtime.ventures.require(id).state).toBe('DEFAULTED');
  });

  it('never calls a payer that elected IN_FULL and was drained a refuser', () => {
    // ══════════════════════════════════════════════════════════════════════
    // A5′, and the distinction `agent.md` promises the record makes: "If you genuinely
    // cannot fund it, that is recorded as unfunded rather than as a refusal, which are
    // different things and the record distinguishes them." A payer that said it would pay
    // everything and then could not is not a refuser, and calling it one is a fabricated
    // accusation that stands forever.
    //
    // **What this asserts, and what it deliberately does not.** The `DECLINED`/`UNFUNDED`
    // split is settlement's, and it is already proven there against a hand-built
    // `SettleInput` (`test/venture/election.test.ts`, `slice.test.ts`,
    // `reverify.regression.test.ts`). What is *not* reachable end to end in Phase 0 is
    // `UNFUNDED` itself, and the reason is structural rather than a gap: §7.4 returns the
    // remaining escrow to the creator **before** the elective parts are paid, and that
    // return is the venture's proceeds while the elective parts are a fraction of them —
    // measured here at 12,999 returned against 1,199 owed. So an emptied payer is refilled
    // by its own escrow and pays. That is exactly what `src/reckoning/audit.ts` sizes its
    // DRAIN scenario around.
    //
    // So the wired assertion is the A5′ half that *is* reachable and is the one that
    // matters: whatever the funding does, an `IN_FULL` never reads as a refusal.
    // ══════════════════════════════════════════════════════════════════════
    const w = world('unfunded');
    const id = haul(w);
    expect(act(w.runtime, w.payer, 'elect', { venture: id, role: 1, election: IN_FULL })).toBeNull();

    // Drained *before* the freeze reads the balance, so the freeze and the settlement
    // agree and no false-default guard fires. The payer meant to pay and has nothing.
    runTo(w.runtime, FREEZE_TICK - 1);
    const stores = storesAccount(w.payer);
    w.runtime.ledger.transferCurrency({
      eventId: 'drain::probe' as never,
      tick: w.runtime.engine.tick,
      from: stores,
      to: storesAccount(w.hand),
      amount: w.runtime.ledger.freeBalance(stores),
    });
    expect(w.runtime.ledger.freeBalance(stores)).toBe(0);
    runTo(w.runtime, FREEZE_TICK);
    const report = w.runtime.runTick();
    expect(report.halted).toBe(false);

    const settlement = w.runtime.lastReckoning?.settlements[0];
    // Not one default, and above all not a `DECLINED` one.
    for (const d of settlement?.defaults ?? []) expect(d.cause).toBe('UNFUNDED');
    expect(settlement?.defaults.some((d) => d.cause === 'DECLINED')).toBe(false);
    expect(w.runtime.standing.row(w.payer).defaults).toBe(0);
    // And the escrow return is what made it possible, which is the fact the comment above
    // rests on — asserted rather than asserted-about.
    expect(settlement?.escrowReturned ?? 0).toBeGreaterThan(
      settlement?.payouts.find((p) => p.roleIndex === 1)?.electiveDue ?? 0,
    );
  });

  it('never pays more than the due on IN_FULL, even when the venture over-performs', () => {
    // "IN_FULL never pays more than you owe." The cap lives in `electionFor`; this is the
    // wired assertion that it is reached through the verb.
    const w = world('cap');
    const id = haul(w);
    expect(act(w.runtime, w.payer, 'elect', { venture: id, role: 1, election: IN_FULL })).toBeNull();
    runTo(w.runtime, FREEZE_TICK);
    w.runtime.runTick();
    const settlement = w.runtime.lastReckoning?.settlements[0];
    const paid = settlement?.payouts.find((p) => p.roleIndex === 1);
    expect(paid?.electivePaid).toBe(paid?.electiveDue);
    expect(paid?.electiveShortfall).toBe(0);
    expect(settlement?.terminalState).toBe('SETTLED');
    expect(w.runtime.standing.row(w.payer).electiveHonoured).toBe(1);
  });

  it("quotes a max_direct_loss the settlement never exceeds, on a share role", () => {
    // ══════════════════════════════════════════════════════════════════════
    // `agent.md` §12: "Check `max_direct_loss` on every affordance before acting. **It is
    // exact, not an estimate.**" On a share role the due is a fraction of proceeds, so the
    // *pinned* elective would understate the worst case on exactly the roles §7.1 warns
    // about — in the one field the document says to trust. Asserted against what actually
    // settles rather than against another copy of the arithmetic.
    // ══════════════════════════════════════════════════════════════════════
    const w = world('exact-loss');
    const id = haul(w);
    const quoted = observe(w.runtime, w.payer).find((a) => a.verb === 'elect')?.max_direct_loss ?? -1;
    expect(quoted).toBeGreaterThan(0);

    // ── The clause that makes this bite whatever the seed drew ───────────────
    //
    // A first version compared the quote only against what actually settled, and a
    // mutation proved it worthless: with the quote reverted to `role.terms.elective` this
    // stayed **green**, because `HAUL`'s residual is a *signed* draw and this seed drew a
    // negative one — so the pinned figure happened not to understate. The property is
    // about the top of the band, not about the draw, so it is asserted there: the quote is
    // the band's ceiling, and on this venture that ceiling is strictly more than the
    // pinned elective. Which is §7.1's trap, in numbers.
    const venture = w.runtime.ventures.require(id);
    const pinned = venture.roles.find((r) => r.index === 1)?.terms.elective ?? 0;
    const ceiling = slotClaimAt(venture, 1, 'p90').electiveDue;
    expect(ceiling).toBeGreaterThan(pinned);
    expect(quoted).toBe(ceiling);

    expect(act(w.runtime, w.payer, 'elect', { venture: id, role: 1, election: IN_FULL })).toBeNull();
    runTo(w.runtime, FREEZE_TICK);
    w.runtime.runTick();
    const paid = w.runtime.lastReckoning?.settlements[0]?.payouts.find((p) => p.roleIndex === 1);
    expect(paid?.electivePaid).toBeGreaterThan(0);
    expect(paid?.electivePaid ?? 0).toBeLessThanOrEqual(quoted);
    expect(paid?.electiveDue ?? 0).toBeLessThanOrEqual(quoted);
  });
});

describe('the rules surface cannot disagree with the engine about how to elect', () => {
  it('refuses an `election` sent on `sign`, whole, rather than dropping it', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The shape a stale document produces. Ignoring the parameter is the option a
    // reasonable person implements by accident, and it ends in a `DECLINED` default —
    // "a deliberate refusal" — permanently, against an agent that was trying to pay.
    // ══════════════════════════════════════════════════════════════════════
    const w = world('sign-election');
    submit(w.runtime, w.payer, 'create', { kind: 'HAUL', stage: w.stage, value: 12_000 });
    w.runtime.runTick();
    const venture = w.runtime.ventures.all().find((v) => v.creator === w.payer);
    if (venture === undefined) throw new Error('no venture');
    const hash = venture.termsHash;
    if (hash === null) throw new Error('no terms_hash');

    const refusal = act(w.runtime, w.payer, 'sign', {
      venture: venture.id,
      terms_hash: hash,
      election: IN_FULL,
    });
    expect(refusal?.invariant).toBe('PROP-V4');
    expect(refusal?.hint).toContain('elect');
    // Neither half happened. A signature recorded with the election dropped would be the
    // exact failure this refusal exists to prevent.
    expect(refusal?.hint).toContain('Nothing was signed and nothing was elected');
    expect(w.runtime.ventures.require(venture.id).countersigned.has(w.payer)).toBe(false);
    expect(w.runtime.electionOn(venture.id, 0)).toBeUndefined();
  });

  it('never offers an `election` on a `sign` affordance', () => {
    const w = world('sign-affordance');
    submit(w.runtime, w.payer, 'create', { kind: 'HAUL', stage: w.stage, value: 12_000 });
    w.runtime.runTick();
    w.runtime.runTick();
    const signs = observe(w.runtime, w.payer).filter((a) => a.verb === 'sign');
    expect(signs.length).toBeGreaterThan(0);
    for (const a of signs) {
      expect(Object.keys(a.params)).not.toContain('election');
      // And it points at the verb that does decide the payment, or a payer reading only
      // this string would think signing was the whole decision.
      expect(String(a.what_it_forecloses)).toContain('elect');
    }
  });

  it('stops telling the payer its elective is unpaid once it has elected (PROP-O5)', () => {
    // `if_you_do_nothing` is tested against reality. While the election rode on `sign`
    // there was no separate book to read, so this sentence could not be wrong; now it can.
    const w = world('briefing');
    const id = haul(w);
    runTo(w.runtime, FREEZE_TICK - 3);
    expect(String(briefing(w.runtime, w.payer)['if_you_do_nothing'])).toContain('is NOT paid');
    expect(act(w.runtime, w.payer, 'elect', { venture: id, role: 1, election: IN_FULL })).toBeNull();
    expect(String(briefing(w.runtime, w.payer)['if_you_do_nothing'])).not.toContain('is NOT paid');
  });
});

describe('the election is inside state_hash and inside the abort path', () => {
  it('changes the state hash, so two worlds that elected differently cannot hash alike', () => {
    const a = world('hash-a');
    const idA = haul(a);
    const b = world('hash-a');
    const idB = haul(b);
    expect(idA).toBe(idB);
    expect(a.runtime.engine.snapshot().stateHash).toBe(b.runtime.engine.snapshot().stateHash);

    expect(act(a.runtime, a.payer, 'elect', { venture: idA, role: 1, election: IN_FULL })).toBeNull();
    expect(act(b.runtime, b.payer, 'elect', { venture: idB, role: 1, election: 1 })).toBeNull();
    expect(a.runtime.engine.snapshot().stateHash).not.toBe(b.runtime.engine.snapshot().stateHash);
  });

  it('round-trips through its own state table, IN_FULL and an amount alike', () => {
    // `IN_FULL` is a string and an amount is an integer, which is how `Election`
    // discriminates them — so a restore that coerced would turn "pay whatever is owed"
    // into "pay zero", which is a decline the payer never made.
    let held = new Map<string, Election>([
      ['v:1::0', IN_FULL],
      ['v:1::1', minor(42)],
      ['v:2::0', minor(0)],
    ]);
    const table = electionsStateTable(
      () => held,
      (restored) => {
        held = restored;
      },
    );
    const captured = table.capture();
    held = new Map();
    if (table.restore === undefined) throw new Error('no restore path');
    table.restore(captured);
    expect(held.get('v:1::0')).toBe(IN_FULL);
    expect(held.get('v:1::1')).toBe(42);
    expect(held.get('v:2::0')).toBe(0);
    expect(table.capture()).toEqual(captured);
    expect(table.name).toBe('election');
  });

  it('leaves no rollback gap, so a halted tick puts the elections back too', () => {
    const w = world('gaps');
    expect(w.runtime.engine.rollbackGaps).toEqual([]);
    expect(w.runtime.engine.stateTables.map((t) => t.name)).toContain('election');
  });
});

// ── `seal`, the verb that was a trap ────────────────────────────────────────

/** The seal affordance for this principal, copied verbatim — never hand-written. */
function sealAffordance(runtime: Runtime, principal: PrincipalId): Affordance {
  const found = observe(runtime, principal).find((a) => a.verb === 'seal');
  if (found === undefined) throw new Error(`no seal affordance offered to ${principal}`);
  return found;
}

describe('a seal an agent keeps is HONOURED, and the deed is cited', () => {
  it('resolves HONOURED end to end from the affordance, copied verbatim', () => {
    // ══════════════════════════════════════════════════════════════════════
    // THE TEST THAT HAD TO PASS BEFORE `seal` COULD BE REGISTERED. `agent.md` tells an
    // agent to copy an affordance's params verbatim, so this does exactly that — no
    // hand-written intent anywhere — and then asserts the resolver's verdict. While the
    // affordance named `verb: 'sign'`, this came back CONTRADICTED from an absence.
    // ══════════════════════════════════════════════════════════════════════
    const w = world('honoured');
    const id = haul(w);
    const offered = sealAffordance(w.runtime, w.hand);
    expect(offered.params['verb']).toBe(DELIVERY_VERB);
    expect(offered.params['target']).toBe(id);
    expect(offered.cost).toBe(0);

    expect(act(w.runtime, w.hand, 'seal', offered.params)).toBeNull();
    expect(w.runtime.seals.size).toBe(1);

    runTo(w.runtime, FREEZE_TICK);
    const report = w.runtime.runTick();
    expect(report.halted).toBe(false);
    expect(report.violations).toEqual([]);

    const resolution = w.runtime.lastReckoning?.seals;
    expect(resolution?.verdicts).toHaveLength(1);
    expect(resolution?.verdicts[0]?.verdict).toBe('HONOURED');
    expect(resolution?.verdicts[0]?.principal).toBe(w.hand);
    expect(resolution?.deferred).toEqual([]);
    expect(resolution?.deedSetFaults).toEqual([]);

    // The verdict cites a row an auditor can open, not a claim.
    const record = w.runtime.seals.auditRecord(resolution?.verdicts[0]?.sealId ?? ('' as never));
    const cited = w.runtime.events.get(record?.citedDeedEventId ?? ('' as never));
    expect(cited?.event.kind).toBe(DELIVERY_EVENT_KIND);
    expect(record?.evaluations).toBe(1);
    expect(w.runtime.standing.row(w.hand).contradictedSeals).toBe(0);
  });

  it('resolves CONTRADICTED with the deed that contradicts it, when the seal is broken', () => {
    // The other half, and it must cite a *deed* rather than rest on an absence: INV-17's
    // rule for defaults applied to seals — the record can point at the act that missed
    // the band. The band here is deliberately above everything the kind can deliver.
    const w = world('contradicted');
    const id = haul(w);
    const offered = sealAffordance(w.runtime, w.hand);
    const high = Number(offered.params['outcome_high']);
    expect(act(w.runtime, w.hand, 'seal', {
      ...offered.params,
      outcome_low: high + 1_000,
      outcome_high: high + 2_000,
    })).toBeNull();

    runTo(w.runtime, FREEZE_TICK);
    const report = w.runtime.runTick();
    expect(report.halted).toBe(false);

    const resolution = w.runtime.lastReckoning?.seals;
    expect(resolution?.verdicts).toHaveLength(1);
    expect(resolution?.verdicts[0]?.verdict).toBe('CONTRADICTED');
    const record = w.runtime.seals.auditRecord(resolution?.verdicts[0]?.sealId ?? ('' as never));
    expect(record?.basis).toBe('OUT_OF_BAND');
    // A mark with evidence behind it, and the evidence is the delivery.
    const cited = w.runtime.events.get(record?.citedDeedEventId ?? ('' as never));
    expect(cited?.event.kind).toBe(DELIVERY_EVENT_KIND);
    expect(String(cited?.event.payload['venture'])).toBe(id);
    // §11.1: "a contradicted seal costs standing."
    expect(w.runtime.standing.row(w.hand).contradictedSeals).toBe(1);
  });

  it('never offers a seal whose promise the resolver could not let you keep', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The A5′ property, stated as a sweep rather than as three separate cases: at every
    // tick of a Reckoning, if a seal is offered then following it verbatim resolves
    // HONOURED. `sealableRoles` is the one home of that rule, read by the affordance, the
    // cast and PROP-D4's compliance gate alike.
    //
    // The three clauses it is enforcing, each from `verdict.ts` read backwards: the deed
    // must exist (LIVE, so it delivers), it must land strictly *after* the seal (delivery
    // still ahead), and it must be in the *same* Reckoning (scar #7).
    // ══════════════════════════════════════════════════════════════════════
    const w = world('sweep');
    const id = haul(w);
    const delivery = w.runtime.deliveryTickOf(w.runtime.ventures.require(id));
    let offeredTicks = 0;
    let lastOffered = -1;
    while (w.runtime.engine.tick < SETTLE_TICK - 1) {
      w.runtime.runTick();
      if (observe(w.runtime, w.hand).some((a) => a.verb === 'seal')) {
        offeredTicks += 1;
        lastOffered = w.runtime.engine.tick;
      }
    }
    expect(offeredTicks).toBeGreaterThan(200);
    // Never at or after the delivery: a seal written then can have no deed after it, and
    // a pre-commitment made in hindsight is not a pre-commitment.
    expect(lastOffered).toBeLessThan(delivery);
    // Nor inside the freeze, where `SealBook.commit` refuses outright.
    expect(inFreeze(lastOffered)).toBe(false);
    expect(isSettlementTick(lastOffered)).toBe(false);
  });

  it('offers no seal on a FORMING venture, which may never deliver at all', () => {
    // A role in a venture that never fills produces no deed through nobody's fault, and
    // the mark for that is indistinguishable from the mark for abstaining. So the offer
    // waits for LIVE — which is fully filled, and therefore certain to deliver.
    const w = world('forming');
    submit(w.runtime, w.payer, 'create', { kind: 'HAUL', stage: w.stage, value: 12_000 });
    w.runtime.runTick();
    const venture = w.runtime.ventures.all().find((v) => v.creator === w.payer);
    if (venture === undefined) throw new Error('no venture');
    const idle = [...w.runtime.world.hands.values()].find(
      (h) => h.principal === w.hand && h.state === 'IDLE',
    );
    submit(w.runtime, w.hand, 'fill_role', {
      venture: venture.id,
      role: 1,
      hand: idle?.id ?? '',
    });
    w.runtime.runTick();
    expect(w.runtime.ventures.require(venture.id).state).toBe('FORMING');
    expect(roleOfPrincipal(w.runtime.ventures.require(venture.id), w.hand)).not.toBeNull();
    expect(w.runtime.sealableRoles(w.hand, w.runtime.engine.tick + 1)).toEqual([]);
    expect(observe(w.runtime, w.hand).some((a) => a.verb === 'seal')).toBe(false);
  });
});

describe('PROP-D4 — sealing is mandatory, and the validator is on the acting path', () => {
  it('refuses a new commitment while a sealable role is unsealed, and the cure is free', () => {
    const w = world('mandatory');
    haul(w);
    expect(w.runtime.sealableRoles(w.hand, w.runtime.engine.tick + 1).length).toBe(1);

    const idle = [...w.runtime.world.hands.values()].find(
      (h) => h.principal === w.hand && h.state === 'IDLE',
    );
    const refusal = act(w.runtime, w.hand, 'create', {
      kind: 'DIG',
      stage: idle?.location ?? w.stage,
    });
    expect(refusal?.invariant).toBe('PROP-D4');
    expect(refusal?.hint).toContain('before the freeze');
    expect(refusal?.hint).toContain('free');

    // Cured with the affordance the same observation offered, at zero action cost.
    const offered = sealAffordance(w.runtime, w.hand);
    expect(offered.cost).toBe(0);
    expect(act(w.runtime, w.hand, 'seal', offered.params)).toBeNull();
    expect(w.runtime.sealableRoles(w.hand, w.runtime.engine.tick + 1)).not.toEqual([]);
    // And now the commitment goes through.
    expect(act(w.runtime, w.hand, 'create', {
      kind: 'DIG',
      stage: idle?.location ?? w.stage,
    })).toBeNull();
  });

  it('never blocks `elect`, `sign`, `withdraw` or `seal` on seal compliance', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The narrowness is the safety. Gating the *payment* decision behind an unrelated
    // rule is a road to a forced decline, and a decline is a permanent public default
    // (A5′). Gating `sign` would kill ventures in their windows. Gating the exits would
    // trap capital. Gating `seal` would make the cure require itself.
    // ══════════════════════════════════════════════════════════════════════
    const w = world('never-blocks');
    const id = haul(w);
    // The payer holds role 0 of its own venture, so it too has a sealable role and is
    // therefore out of compliance — which is the state this asserts is survivable.
    expect(w.runtime.sealableRoles(w.payer, w.runtime.engine.tick + 1).length).toBe(1);
    expect(act(w.runtime, w.payer, 'elect', { venture: id, role: 1, election: IN_FULL })).toBeNull();
    expect(w.runtime.electionOn(id, 1)).toBe(IN_FULL);

    // A second venture to sign and withdraw from, created *by the other party* so the
    // payer's own compliance never gates its creation.
    const other = [...w.runtime.world.hands.values()].find(
      (h) => h.principal === w.hand && h.state === 'IDLE',
    );
    expect(act(w.runtime, w.hand, 'seal', sealAffordance(w.runtime, w.hand).params)).toBeNull();
    submit(w.runtime, w.hand, 'create', { kind: 'HAUL', stage: other?.location ?? w.stage });
    w.runtime.runTick();
    const second = w.runtime.ventures
      .all()
      .find((v) => v.creator === w.hand && v.state === 'FORMING');
    if (second === undefined) throw new Error('no second venture');
    const mine = [...w.runtime.world.hands.values()].find(
      (h) => h.principal === w.payer && h.state === 'IDLE',
    );
    // `fill_role` IS gated, so this is the one act the payer must seal for first —
    // asserted by doing it after the seal, which the payer has not made.
    const gated = act(w.runtime, w.payer, 'fill_role', {
      venture: second.id,
      role: 1,
      hand: mine?.id ?? '',
    });
    expect(gated?.invariant).toBe('PROP-D4');
    // But signing and withdrawing are not gated. The payer signs the second venture's
    // terms (it holds no role, so it signs as a party) and abandons nothing.
    const hash = w.runtime.ventures.require(second.id).termsHash;
    if (hash !== null) {
      const signed = act(w.runtime, w.payer, 'sign', { venture: second.id, terms_hash: hash });
      expect(signed?.invariant).not.toBe('PROP-D4');
    }
    const withdrawn = act(w.runtime, w.payer, 'withdraw', { venture: id });
    expect(withdrawn?.invariant).not.toBe('PROP-D4');
  });

  it('asks nothing of a principal with no sealable role, so it can never lock anyone out', () => {
    // A gate whose demand is unsatisfiable is a lockout. `sealableRoles` returns nothing
    // for a role whose delivery has passed — and therefore nothing inside the freeze,
    // where `SealBook.commit` refuses anyway — so the demand and the cure appear and
    // disappear together. That the freeze case follows from the delivery case rather than
    // from a clause of its own is asserted by `assertSealSchedule` below.
    const w = world('no-roles');
    const id = haul(w);
    const delivery = w.runtime.deliveryTickOf(w.runtime.ventures.require(id));
    runTo(w.runtime, delivery);
    expect(w.runtime.sealableRoles(w.hand, w.runtime.engine.tick + 1)).toEqual([]);
    runTo(w.runtime, FREEZE_TICK - 1);
    expect(w.runtime.sealableRoles(w.hand, FREEZE_TICK)).toEqual([]);
    expect(w.runtime.sealableRoles(w.hand, SETTLE_TICK)).toEqual([]);
    // A brand-new principal holds nothing and is asked for nothing.
    const fresh = 'p:fresh' as PrincipalId;
    w.runtime.seat(fresh, 'fresh', w.stage);
    expect(w.runtime.sealableRoles(fresh, w.runtime.engine.tick + 1)).toEqual([]);
  });
});

describe('the clock a sealable role is decided from', () => {
  it('asserts the constants that keep every delivery outside the freeze', () => {
    // ══════════════════════════════════════════════════════════════════════
    // `sealableRoles` decides sealability from the **delivery tick alone**, and a written
    // `inFreeze(tick)` clause was deleted after a mutation showed nothing could bite on
    // it: the delivery clause already excludes every freeze tick, because a venture
    // delivers `DELIVERY_LEAD_TICKS` before a settlement tick and that exceeds
    // `FREEZE_TICKS`. Deleting a dead guard is right; leaving the *dependency* unstated
    // is how it comes back. So the dependency is the assertion, and it is checked at
    // construction — because a delivery inside the freeze is skipped by `resolveFills`,
    // which would leave every seal offered against it CONTRADICTED from an absence (A5′).
    // ══════════════════════════════════════════════════════════════════════
    expect(DELIVERY_LEAD_TICKS).toBeGreaterThan(FREEZE_TICKS);
    expect(() => {
      assertSealSchedule();
    }).not.toThrow();
    // And it FIRES on the pair it exists to catch. Without this half a mutation that made
    // the comparison unsatisfiable stayed green — the guard was untested, not merely
    // unfired, which is the exact failure this whole file's mutation pass is looking for.
    expect(() => {
      assertSealSchedule(FREEZE_TICKS, FREEZE_TICKS);
    }).toThrow(/must exceed FREEZE_TICKS/);
    expect(() => {
      assertSealSchedule(FREEZE_TICKS - 1, FREEZE_TICKS);
    }).toThrow(/CONTRADICTED from an absence/);

    // And the consequence, measured rather than asserted about: every venture the engine
    // mints delivers strictly before the freeze it settles in.
    const w = world('schedule');
    const id = haul(w);
    const venture = w.runtime.ventures.require(id);
    const delivery = w.runtime.deliveryTickOf(venture);
    expect(inFreeze(delivery)).toBe(false);
    expect(isSettlementTick(delivery)).toBe(false);
    expect(delivery).toBeLessThan(FREEZE_TICK);
  });
});

describe('nothing an agent sends through either verb can stop the world', () => {
  it('survives every malformed election and seal shape, with a hint each time', () => {
    const w = world('hostile');
    const id = haul(w);
    const shapes: Readonly<Record<string, unknown>>[] = [
      {},
      { venture: id },
      { venture: id, role: 1 },
      { venture: id, role: 1, election: 'IN_PART' },
      { venture: id, role: 1, election: -1 },
      { venture: id, role: 1, election: 1.5 },
      { venture: id, role: 1, election: Number.MAX_VALUE },
      { venture: id, role: 1, election: Number.NaN },
      { venture: id, role: 1, election: null },
      { venture: id, role: 1, election: { pay: 'all' } },
      { venture: id, role: 1, election: [] },
      { venture: id, role: Number.NaN, election: IN_FULL },
      { venture: id, role: 1.5, election: IN_FULL },
      { venture: 'ghost', role: 0, election: IN_FULL },
      { venture: id, role: 1, election: IN_FULL, extra: 'x'.repeat(5_000) },
      { verb: 'sign', target: id, measure: 'MINOR', outcome_low: 0, outcome_high: 1 },
      { verb: DELIVERY_VERB, target: 'ghost', measure: 'MINOR', outcome_low: 0, outcome_high: 1 },
      { verb: DELIVERY_VERB, target: id, measure: 'QTY', outcome_low: 0, outcome_high: 1 },
      { verb: DELIVERY_VERB, target: id, measure: 'MINOR', outcome_low: 9, outcome_high: 1 },
    ];
    for (const verb of ['elect', 'seal']) {
      for (const params of shapes) {
        submit(w.runtime, w.payer, verb, params);
        submit(w.runtime, w.hand, verb, params);
        const report = w.runtime.runTick();
        expect(report.halted, `${verb} ${JSON.stringify(params).slice(0, 60)} halted`).toBe(false);
        expect(report.violations).toEqual([]);
      }
    }
    expect(w.runtime.engine.status).toBe('RUNNING');
    // And the book holds an `Election` or nothing — never a NaN, a float or an object,
    // any of which the freeze would silently drop and the record would read as a decline.
    for (let role = 0; role < 2; role += 1) {
      const stored = w.runtime.electionOn(id, role);
      if (stored === undefined) continue;
      if (typeof stored === 'string') expect(stored).toBe(IN_FULL);
      else expect(Number.isSafeInteger(stored) && stored >= 0).toBe(true);
    }
    // One row in the sweep is a legal election with a giant unread extra field, so this
    // also proves an unknown parameter neither breaks the act nor corrupts what it stores.
    expect(w.runtime.electionOn(id, 1)).toBe(IN_FULL);
    expect(w.runtime.electionOn(id, 0)).toBeUndefined();
  });

  it('settles a Reckoning cleanly after all of that, accusing nobody wrongly', () => {
    const w = world('hostile-settle');
    const id = haul(w);
    expect(act(w.runtime, w.payer, 'elect', { venture: id, role: 1, election: IN_FULL })).toBeNull();
    for (const params of [
      { venture: id, role: 1, election: 'IN_PART' },
      { venture: id, role: 99, election: IN_FULL },
      { venture: id, role: 1, election: null },
    ]) {
      submit(w.runtime, w.payer, 'elect', params);
      w.runtime.runTick();
      w.runtime.takeCorrections(w.payer);
    }
    // A refused restatement leaves the honest one standing.
    expect(w.runtime.electionOn(id, 1)).toBe(IN_FULL);
    runTo(w.runtime, FREEZE_TICK);
    const report = w.runtime.runTick();
    expect(report.halted).toBe(false);
    const settlement = w.runtime.lastReckoning?.settlements[0];
    expect(settlement?.terminalState).toBe('SETTLED');
    expect(settlement?.defaults).toEqual([]);
    const venture = w.runtime.ventures.require(id);
    const claims = computeClaims(venture, minor(w.runtime.deliveryOf(id)?.proceeds ?? 0));
    expect(claims.roles[1]?.electiveDue).toBeGreaterThan(0);
  });
});
