/**
 * A DELEGATE CAN NOW ACT UNDER DELEGATED AUTHORITY. A6'S SECOND LINK.
 *
 * Until this landed, `grant` was issued, bounded, warned, rendered, revocable, captured,
 * VC-serialised and audited — and **nothing could use one.** `grantBook.recordSpend()` was never
 * called outside its own file, no verb accepted a grant to act under, and every grant in every world
 * was `UNUSED`/`spent: 0` forever. Betrayal via legitimate authority was impossible by construction,
 * which is the one thing the whole design is named for (`D20`).
 *
 * The door is `vElect`'s payer gate, and its own comment was the specification: *"the elective half is
 * paid out of the payer's own stores, so anyone else electing on it would be spending another agent's
 * money."* That is not a reason to refuse — it is the definition of what a grant hands over.
 *
 * Three things make this a small change rather than a large one:
 *
 *   - **No ledger change.** The elective half already pays from the creator's stores, so a delegate
 *     electing on the grantor's venture moves the grantor's value through the path that already exists.
 *   - **No new state, no `RULES_VERSION` bump.** The draw is recorded at election time, and INV-22 reads
 *     `eventId` only for sort identity and messages — it never dereferences it — so election-scoped
 *     provenance is honest. The spend journal is already inside `grantsStateTable`'s capture.
 *   - **No new verb.** The verb budget is at its §17 ceiling (40/40), so this is a param: `grant`, as
 *     `revoke` already spells it, and deliberately NOT `on_behalf_of`, which `grant` uses for the
 *     syndicate an office is appointed for (one canon word, two concepts = scar #1).
 *
 * ── WHAT IT DOES NOT CLAIM ───────────────────────────────────────────────────
 *
 * That anyone betrays. This makes abuse *possible*, which is A6's precondition and not its outcome.
 * Whether a delegate actually turns a mandate against its grantor is `AGT-E1`'s question, answered by
 * measurement on a live world, and the design insists the answer be allowed to come back "no". A test
 * that forced a betrayal would rig the one result this project may not rig.
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { ELECTABLE_VENTURE_STATES, Runtime } from '../../src/sim/runtime.js';

/**
 * Run a heuristic world until a live grant exists whose grantor also has an electable venture with a
 * role held by a third party — the situation a delegate can actually act in.
 */
function worldWithAMandate(seed: string): {
  readonly rt: Runtime;
  readonly grantId: string;
  readonly grantor: PrincipalId;
  readonly delegate: PrincipalId;
  readonly venture: string;
  readonly roleIndex: number;
} | null {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const cast = new HeuristicCast(rt, { size: 8 });
  cast.seat(seed);

  for (let i = 0; i < 900; i += 1) {
    for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
    if (rt.runTick().halted) return null;

    const tick = rt.engine.tick;
    for (const grant of rt.grants.all()) {
      if (!rt.grants.isLive(grant.id, tick)) continue;
      for (const v of rt.ventures.forPrincipal(grant.grantor)) {
        if (v.creator !== grant.grantor) continue;
        // Electable states only. A SETTLED venture is refused by `vElect` before the mandate is even
        // consulted, so picking one tests the state gate and reports it as an authority failure.
        if (!ELECTABLE_VENTURE_STATES.includes(v.state)) continue;
        for (const role of v.roles) {
          const holder = role.filledByPrincipal;
          if (holder === null) continue;
          // The delegate must not hold the role itself: a creator paying its own role is booked as
          // paid in full and `vElect` refuses it (scar #9), so that pairing would test the wrong gate.
          if (holder === grant.delegate) continue;
          if (rt.electionOn(v.id, role.index) !== undefined) continue;
          return {
            rt,
            grantId: grant.id,
            grantor: grant.grantor,
            delegate: grant.delegate,
            venture: v.id,
            roleIndex: role.index,
          };
        }
      }
    }
  }
  return null;
}

describe('a delegate can elect in its grantor’s name, inside the LIMITS', () => {
  it('records a draw against the grant, so INV-22 finally has something to audit', () => {
    const w = worldWithAMandate('delegate-spends');
    expect(w, 'no world produced a live grant over an electable venture, so this proves nothing').not.toBeNull();
    if (w === null) return;

    // Drain first: 900 ticks of cast activity leaves its own refusals in the ring, and reading those
    // as a verdict on this action would be the same confusion one layer along.
    w.rt.takeCorrections(w.delegate);
    const before = w.rt.grants.allSpends().length;
    const headroomBefore = w.rt.grants.headroom(w.grantId as never);

    const outcome = w.rt.engine.submit({
      principal: w.delegate,
      verb: 'elect',
      params: {
        venture: w.venture,
        role: w.roleIndex,
        election: 'IN_FULL',
      },
      clientSequence: 1,
      arrivalMs: 0,
      decisionSource: 'LIVE',
    });
    // `submit` returning ok means accepted for SUBMISSION into T+1, not that the verb succeeded — the
    // verdict lands a tick later on the corrections channel. Reading acceptance as success is a mistake
    // this project has made before, so the refusal is drained and reported instead of assumed absent.
    expect(outcome.ok, 'the action must at least reach the queue').toBe(true);
    w.rt.runTick();
    const corrections = w.rt.takeCorrections(w.delegate);
    expect(
      corrections.map((c) => c.hint ?? JSON.stringify(c)),
      'the delegate election was refused in-tick',
    ).toEqual([]);

    const after = w.rt.grants.allSpends();
    expect(after.length, 'a draw must be journalled, or the LIMIT is decorative').toBe(before + 1);

    const spend = after[after.length - 1];
    expect(spend?.grant).toBe(w.grantId);
    expect(spend?.delegate, 'the journal names who drew, which is the audit trail').toBe(w.delegate);
    // IN_FULL is unknowable until resolution, so it draws on the CONTINGENT limit — the split §8
    // defines and the affordance already showed the grantor before they signed.
    expect(spend?.contingent, 'IN_FULL is a contingent liability, not a direct loss').toBeGreaterThan(0);
    expect(spend?.direct).toBe(0);

    // And the headroom actually moved, which is what makes the limit binding rather than recorded.
    const headroomAfter = w.rt.grants.headroom(w.grantId as never);
    expect(headroomAfter.contingent).toBeLessThan(headroomBefore.contingent);
  }, 180_000);

  it('refuses a principal holding NO live grant from the payer, and says how to get one', () => {
    // With the mandate inferred rather than named, "no grant" and "wrong delegate" are the same
    // situation and produce one refusal — which is the point of inferring. A third party is used
    // rather than a made-up id because there is no id to make up.
    const w = worldWithAMandate('delegate-unmandated');
    expect(w).not.toBeNull();
    if (w === null) return;

    // Must hold NO live grant from the payer. The cast issues grants freely, so several principals
    // may be mandated by the same grantor at once — picking "any third party" found one that was
    // legitimately authorised and read its success as a gate failure.
    const outsider = [...w.rt.world.holdings.values()]
      .map((h) => h.principal)
      .find(
        (p) =>
          p !== w.delegate &&
          p !== w.grantor &&
          w.rt.grants.liveGrantBetween(w.grantor, p, w.rt.engine.tick) === null,
      );
    expect(outsider, 'no UNMANDATED third party available, so this test would prove nothing').toBeDefined();
    if (outsider === undefined) return;

    w.rt.takeCorrections(outsider);
    const spendsBefore = w.rt.grants.allSpends().length;
    const outcome = w.rt.engine.submit({
      principal: outsider,
      verb: 'elect',
      params: { venture: w.venture, role: w.roleIndex, election: 'IN_FULL' },
      clientSequence: 1,
      arrivalMs: 0,
      decisionSource: 'LIVE',
    });
    expect(outcome.ok, 'the action must at least reach the queue').toBe(true);
    w.rt.runTick();

    expect(
      w.rt.electionOn(w.venture as never, w.roleIndex),
      'an unmandated principal must not have set an election on someone else’s venture',
    ).toBeUndefined();
    expect(w.rt.grants.allSpends().length, 'and must not have drawn on anyone').toBe(spendsBefore);
    const why = w.rt.takeCorrections(outsider).map((c) => c.hint ?? '');
    expect(why.join(' | '), 'the refusal must name the way in, or it is a dead end').toMatch(
      /no live grant/i,
    );
  }, 180_000);

  it('a delegate states an election ONCE, so it cannot walk the amount up and re-draw', () => {
    // `elect` is restatable until the freeze, which is right for a principal spending its own stores.
    // Under a mandate it is not: without this guard each restatement draws fresh headroom, so a
    // delegate could elect 1, then 2, then 3 and charge the grantor's LIMIT three times over for one
    // promise. Netting restatements needs a per-election spend record that this deliberately does not
    // add, so the safe answer is one draw per role.
    const w = worldWithAMandate('delegate-states-once');
    expect(w).not.toBeNull();
    if (w === null) return;

    const submit = (seq: number): void => {
      w.rt.engine.submit({
        principal: w.delegate,
        verb: 'elect',
        params: { venture: w.venture, role: w.roleIndex, election: 'IN_FULL' },
        clientSequence: seq,
        arrivalMs: 0,
        decisionSource: 'LIVE',
      });
    };

    w.rt.takeCorrections(w.delegate);
    const before = w.rt.grants.allSpends().length;
    submit(1);
    w.rt.runTick();
    expect(w.rt.grants.allSpends().length, 'the first election must draw once').toBe(before + 1);

    w.rt.takeCorrections(w.delegate);
    submit(2);
    w.rt.runTick();
    expect(
      w.rt.grants.allSpends().length,
      'a restatement must NOT draw a second time against the same role',
    ).toBe(before + 1);
    const why = w.rt.takeCorrections(w.delegate).map((c) => c.hint ?? '');
    expect(why.join(' | '), 'and the refusal must say who may still restate').toMatch(
      /already stands|states it once/i,
    );
  }, 300_000);

  it('refuses a REVOKED mandate, because authority ends when the grantor says so (scar #7)', () => {
    // Revocation rather than expiry, and the reason is structural rather than convenience. A cast
    // grant lives one Reckoning and ventures resolve ON Reckoning boundaries, so by the tick a grant
    // expires its grantor's ventures have already settled — and `vElect` refuses a settled venture
    // before it ever consults the mandate. An earlier version of this test "passed" on exactly that:
    // an ABANDONED-venture refusal, matched by a regex widened with `nothing left` to make it green.
    // It said nothing about authority at all.
    //
    // `liveGrantBetween` consults `isLive`, which is the one gate covering expiry AND revocation, and
    // revoking bites immediately — so this exercises the real check on a still-electable venture.
    const w = worldWithAMandate('delegate-revoked');
    expect(w).not.toBeNull();
    if (w === null) return;

    const revoke = w.rt.engine.submit({
      principal: w.grantor,
      verb: 'revoke',
      params: { grant: w.grantId },
      clientSequence: 1,
      arrivalMs: 0,
      decisionSource: 'LIVE',
    });
    expect(revoke.ok, 'the revoke must reach the queue').toBe(true);
    w.rt.runTick();
    // Revocation lands ON a tick and bites from the NEXT one: `isRevokedAt` is `atTick >
    // revokedAtTick`, the same inclusive rule expiry uses ("live THROUGH expiresTick"). So one more
    // tick, or the grant is still legitimately live and this would test the wrong thing — which is
    // what the vacuity guard below caught the first time.
    w.rt.runTick();
    expect(
      w.rt.grants.isLive(w.grantId as never, w.rt.engine.tick),
      'the grant must actually be dead, or the assertions below are vacuous',
    ).toBe(false);

    w.rt.takeCorrections(w.delegate);
    const spendsBefore = w.rt.grants.allSpends().length;
    const outcome = w.rt.engine.submit({
      principal: w.delegate,
      verb: 'elect',
      params: { venture: w.venture, role: w.roleIndex, election: 'IN_FULL' },
      clientSequence: 2,
      arrivalMs: 0,
      decisionSource: 'LIVE',
    });
    expect(outcome.ok, 'the action must at least reach the queue').toBe(true);
    w.rt.runTick();

    expect(
      w.rt.grants.allSpends().length,
      'a revoked mandate must not be able to draw on the grantor',
    ).toBe(spendsBefore);
    const why = w.rt.takeCorrections(w.delegate).map((c) => c.hint ?? '');
    expect(why.join(' | '), 'the refusal must be about holding no live authority').toMatch(
      /no live grant/i,
    );
  }, 300_000);
});
