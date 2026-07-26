/**
 * Two defects the sovereignty layer shipped with, both found by playing it rather than
 * reading it, and both in the same family: **a fact the engine knew and a surface that
 * disagreed.**
 *
 * ## 1. An ordinary affordance could halt the galaxy (INV-8)
 *
 * `build` takes a claim. `graduate` moves your holding. Nothing connected them, so
 * `graduate` stayed offered — with a pinned quote and a `what_it_forecloses` sentence —
 * to a principal already holding territory. Taking two consecutive offered affordances
 * verbatim moved the body out from under the claim, INV-8 fired, and the tick aborted.
 *
 * Aborting is *correct* (§15.4 fails closed; never publish a broken tick), which is what
 * made this severe rather than cosmetic: the failure mode is the whole world stopping,
 * reachable by any principal, for free, by playing legally. A4 says throughput must never
 * be power; an ordinary act that stops the galaxy is that rule with the sign flipped.
 *
 * INV-8 already stated the rule in its own violation message — *"a claim is anchored by a
 * body"* — so the fix adds no policy. It puts the fact in {@link GraduationQuote}, which
 * `runtime.ts` calls the one home with three readers, making it four.
 *
 * ## 2. The Charge preview lied, and lying is worse than crashing (A5′)
 *
 * The Charge is a duty on *territory*: `claims`, `missesAt` and `liveAt` are all keyed on
 * `SystemId`, and settlement resolves who pays by calling `liveAt(line.system)`. That is
 * deliberate and it is what makes "a transfer never resets the arrears" true.
 *
 * The payment row and the assessment lookup were keyed on `ClaimId` instead. Abandon a
 * claim mid-Reckoning and re-take the same system and the new claim carries a new id, so
 * `owingOf(reckoning, claim.id)` found no line and returned `owed: 0` — while settlement,
 * asking by system, still billed it. The agent was shown `if_you_do_nothing:
 * STAYS_SUPPLIED`, did nothing because it had been told it was current, and lapsed with
 * its bond slashed.
 *
 * That is A5′ exactly: not an unhelpful record, a **wrong** one. And it was the
 * consequence-preview field — the one High Water shipped as `projectedDrown` because an
 * agent plans against it, and the one `CLAUDE.md` names as a standing pattern. A guard
 * that lies is worse than no guard, because the agent stops looking.
 *
 * Both tests below are written to fail if the fix is reverted; the second asserts the
 * preview and the settlement **agree**, rather than asserting a literal, so it cannot pass
 * by matching a string the engine no longer means.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { storesAccount } from '../../src/ledger/index.js';
import { captureSnapshot } from '../../src/tick/snapshot.js';
import { CLAIM_BOND_MINOR } from '../../src/sovereignty/index.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from '../api/harness.js';

let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'anchored' });
});
afterEach(async () => {
  await h.close();
});

type Row = Record<string, unknown>;

async function observe(who: Agent): Promise<Row> {
  const res = await signed(h, who, 'GET', PATHS.observe);
  expect(res.status, res.text.slice(0, 400)).toBe(200);
  return res.json['observation'] as Row;
}

function affordance(o: Row, verb: string): Row | undefined {
  return (o['affordances'] as Row[]).find((a) => a['verb'] === verb);
}

async function act(who: Agent, verb: string, params: unknown): Promise<Row> {
  const res = await signed(h, who, 'POST', PATHS.act, {
    actions: [{ verb, params, clientSequence: 1 }],
  });
  expect(res.status, `${verb} -> ${res.status}: ${res.text.slice(0, 400)}`).toBe(200);
  return res.json['outcome'] as Row;
}

/** Advance, refusing to paper over a halt: a halted world must fail the test that caused it. */
function run(n: number): void {
  for (let i = 0; i < n; i += 1) {
    const report = h.runtime.runTick();
    expect(
      report.halted,
      `the world halted at tick ${String(report.tick)}: ${report.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`,
    ).toBe(false);
  }
}

function runToPhase(phase: number): void {
  const now = h.runtime.engine.tick;
  const base = now - (now % TICKS_PER_RECKONING);
  const target = base + phase > now ? base + phase : base + TICKS_PER_RECKONING + phase;
  run(target - now);
}

/** Enrol, cross out of the Commons, post bond, take a claim. The road to territory. */
async function enrolAndClaim(handle: string): Promise<{ who: Agent; system: SystemId }> {
  const who = agent(handle);
  expect((await enrol(h, who)).status).toBe(201);
  tick(h, 1);
  // `build` is two acts — ANCHOR takes territory, WORKS raises a production structure — so the
  // road to territory has to name which. Matching on the verb alone takes whichever comes first,
  // which is the trap `agent.md` now warns agents about explicitly.
  for (const step of [
    { verb: 'graduate' as const, kind: null },
    { verb: 'post_bond' as const, kind: null },
    { verb: 'build' as const, kind: 'ANCHOR' },
  ]) {
    const offered = (((await observe(who))['affordances'] as Row[]) ?? []).find(
      (a) => a['verb'] === step.verb && (step.kind === null || (a['params'] as Row)['kind'] === step.kind),
    );
    expect(offered, `${step.verb}${step.kind === null ? '' : ` ${step.kind}`} must be offered`).toBeDefined();
    await act(who, step.verb, offered?.['params']);
    run(1);
  }
  const holding = (await observe(who))['holding'] as Row;
  const system = String(holding['system']) as SystemId;
  expect(h.runtime.sovereignty.liveAt(system), 'a live claim must exist').not.toBeNull();
  return { who, system };
}

function chargeRow(o: Row): Row | undefined {
  return (((o['obligations'] as Row)['charge'] ?? []) as Row[])[0];
}

describe('a claim anchors the body that holds it (INV-8)', () => {
  it('withholds graduate while a claim is live, says why, and does not halt when taken anyway', async () => {
    const { who, system } = await enrolAndClaim('wanderer');
    const o = await observe(who);

    // 1. Not offered — an agent plays from affordances[], so this is the half that matters.
    expect(affordance(o, 'graduate'), 'graduate must not be offered while a claim is live').toBeUndefined();

    // 2. Counted, not silently dropped. Every omission in observe.ts carries a reason, and
    //    an exit that vanishes without one reads exactly like the defect a playtest found.
    const withheld = (o['header'] as Row)['withheld'] as Row;
    expect(
      String(withheld['reason']),
      'the withheld reason must name the claim AND the two acts that free the body',
    ).toMatch(new RegExp(`live claim.*${system}[\\s\\S]*abandon[\\s\\S]*cede`, 'i'));

    // 3. The obstacle is legible where the price is, so the agent does not hunt for currency
    //    it already has. A2: the real reason, not a plausible one.
    const grad = (o['holding'] as Row)['graduation'] as Row;
    expect(grad['anchoring'], 'holding.graduation.anchoring names what holds the body').toEqual([system]);
    expect(grad['affordable'], 'the price was never the problem — that is the point').toBe(true);

    // 4. Refused rather than performed if an agent constructs it by hand, and the world
    //    survives. This is the assertion the fix exists for: before it, this halted.
    // Accepted at the API and adjudicated at tick close — actions land in T+1, so the
    // refusal arrives as a correction rather than in the accept outcome.
    await act(who, 'graduate', { to: 'sys-06' });
    run(2);
    const corrections = h.runtime
      .takeCorrections(who.principalId as PrincipalId)
      .map((c) => `${c.verb}/${c.invariant}: ${c.hint}`);
    expect(corrections.join(' | '), 'a hand-built graduate must be refused with a usable hint').toMatch(
      /abandon[\s\S]*cede|anchored by a body/i,
    );
    expect(
      h.runtime.world.holdingByPrincipal.get(who.principalId as PrincipalId),
      'the body must not have moved',
    ).toBeDefined();
    expect(h.runtime.sovereignty.liveAt(system), 'the claim must still stand').not.toBeNull();
  });

  it('abandon frees the body, so the crossing is deferred and never denied', async () => {
    const { who, system } = await enrolAndClaim('leaver');
    runToPhase(40);
    await act(who, 'abandon', { claim: system });
    run(1);
    const grad = (await observe(who))['holding'] as Row;
    expect((grad['graduation'] as Row)['anchoring'], 'letting the claim go clears the anchor').toEqual([]);
  });
});

describe('the Charge is a duty on territory, and the preview cannot disagree with it (A5′)', () => {
  it('a system retaken mid-Reckoning is shown the arrears it actually carries', async () => {
    const { who, system } = await enrolAndClaim('recycler');
    const p = who.principalId as PrincipalId;

    // Two missed Reckonings: the claim is CONTESTED and one more miss lapses it.
    for (let i = 0; i < 2; i += 1) {
      runToPhase(TICKS_PER_RECKONING - 1);
      run(1);
    }
    expect(h.runtime.sovereignty.missesAt(system)).toBe(2);

    // Abandon and immediately re-take the same system: a new claim id, the same territory.
    runToPhase(40);
    await act(who, 'abandon', { claim: system });
    run(1);
    await act(who, 'post_bond', { amount: CLAIM_BOND_MINOR });
    run(1);
    await act(who, 'build', { kind: 'ANCHOR', system });
    run(1);

    const shown = chargeRow(await observe(who));
    expect(shown, 'the retaken claim must appear in obligations.charge').toBeDefined();

    // THE ASSERTION: the preview is the settlement's own arithmetic, so compare them
    // rather than a literal. `claimDoNothing` and `settleCharge` disagreeing is the bug.
    const predicted = String(shown?.['if_you_do_nothing']);
    expect(predicted, 'a system carrying arrears cannot be previewed as current').not.toBe('STAYS_SUPPLIED');
    expect(Number(shown?.['arrears']), 'arrears attach to the system, not the claim record').toBe(2);
    expect(Number(shown?.['owed']), 'the duty survives the retake').toBeGreaterThan(0);

    const balanceBefore = h.runtime.ledger.balance(storesAccount(p));
    runToPhase(TICKS_PER_RECKONING - 1);
    run(1);

    // And the prediction was true. PROP-O5's shape: state the consequence, take no action,
    // assert what happened is what was said.
    if (predicted === 'LAPSES') {
      expect(h.runtime.sovereignty.liveAt(system), 'LAPSES was predicted, so the claim must be gone').toBeNull();
      expect(
        h.runtime.ledger.balance(storesAccount(p)),
        'a predicted lapse slashes the bond, and A5 makes that loss real',
      ).toBeLessThan(balanceBefore);
    }
  });

  it('goods delivered before an abandon still discharge the system that received them', async () => {
    // The mirror of the bug above: if the duty were keyed on the claim record, a payment
    // made and THEN abandoned would orphan, and the retaker would be billed for goods the
    // world had already destroyed. Territorial keying has to cut both ways or it is just
    // a differently-placed error.
    const { who, system } = await enrolAndClaim('payer');
    const reckoning = Math.floor(h.runtime.engine.tick / TICKS_PER_RECKONING);
    const before = h.runtime.sovereignty.owingOf(reckoning, system);
    expect(before.assessment, 'a claim is assessed in its first Reckoning').toBeGreaterThan(0);

    // `obligation` MATCHED, not just the verb. `deliver` discharges two world obligations now — the
    // Levy and the Charge — and the Levy's affordance can sort first, so a bare `verb == 'deliver'`
    // lookup pays the wrong duty and then asserts about the other one. That is the `build`
    // ambiguity exactly (ANCHOR vs WORKS), which turned four helpers in this repo ambiguous in a
    // single commit. Same shape, one verb later.
    const deliver = ((await observe(who))['affordances'] as Row[]).find(
      (a) => a['verb'] === 'deliver' && (a['params'] as Row)['obligation'] === 'CHARGE',
    );
    if (deliver !== undefined) {
      await act(who, 'deliver', deliver['params']);
      run(1);
      const paid = h.runtime.sovereignty.owingOf(reckoning, system).paid;
      expect(paid, 'the delivery credited the system').toBeGreaterThan(0);

      runToPhase(50);
      await act(who, 'abandon', { claim: system });
      run(1);
      expect(
        h.runtime.sovereignty.owingOf(reckoning, system).paid,
        'the credit belongs to the territory and must survive the claim that earned it',
      ).toBe(paid);
    }
  });
});

describe('the sovereignty book is inside state_hash', () => {
  it('a claim state change moves the hash', async () => {
    // Cheap, and it is the property that makes every other sovereignty guarantee
    // enforceable: state outside the hash diverges silently on replay, which is the
    // keystone defect the EncumbranceBook already had once.
    const { system } = await enrolAndClaim('hashme');
    const cap = (): string =>
      captureSnapshot(h.runtime.engine.stateTables, h.runtime.engine.tick, 0).stateHash;
    const before = cap();
    h.runtime.sovereignty.setState(system, 'STRAINED');
    expect(cap(), 'the sovereignty book must be inside state_hash').not.toBe(before);
  });
});
