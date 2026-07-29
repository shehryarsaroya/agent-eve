/**
 * ★ **A PARLEY IS REACHABLE FROM THE MENU, THE VERB ACCEPTS WHAT THE MENU SAID, AND A COALITION
 * FORMS BECAUSE SOMEBODY ASKED.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `test/campaign/reachable.spec.ts` is the worked example and this file copies it deliberately,
 * including its reason for existing: **the cast has no branch that reads inbound mail, and no branch
 * that declares a campaign at all** (`grep CAMPAIGN src/cast/heuristic.ts` is empty, and the file is
 * another agent's lane this round). So `test/api/agt-r5-reachability.test.ts` — which sweeps a live
 * world asking *"is every live verb offered somewhere"* — cannot enter the state this needs.
 *
 * The measured defect was not a crash. `message` took a venture you were already a party to or a
 * dossier you were cleared to cut, and at the Marches the defender gets +1 terrain, ties go to the
 * defender, and one principal caps at three hands — so **a solo attacker can only ever beat a garrison
 * of one.** The arithmetic makes coalitions mandatory, `join {campaign, side}` is the published answer,
 * and a probe published *"COALITION WANTED … I pay 20000 per hand"* into the void because no channel
 * could say it to anybody.
 *
 * The assertion that matters is therefore the last one in this file, and it is not "the suite is
 * green": **the attacker's force reading changes because it asked.**
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import type { PrincipalId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { AUDIT_LAG_TICKS } from '../../src/grant/dossier.js';
import { PARLEYS_PER_RECKONING, MAX_PARLEY_LENGTH } from '../../src/say/parley.js';
import type { Runtime } from '../../src/sim/runtime.js';
import { act, campaignWorld, fund, tick } from '../campaign/fixture.js';

function observe(runtime: Runtime, principal: PrincipalId): ReturnType<typeof buildObservation> {
  return buildObservation({
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 4,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  });
}

/** Every `message {to}` row the menu carries, which is the PARLEY affordance and nothing else. */
function parleyOffers(
  runtime: Runtime,
  principal: PrincipalId,
): readonly ReturnType<typeof observe>['affordances'][number][] {
  return observe(runtime, principal).affordances.filter(
    (a) => a.verb === 'message' && (a.params as Record<string, unknown>)['to'] !== undefined,
  );
}

/**
 * A live campaign with the attacker entitled to speak, plus `bystanders` unfunded principals seated
 * at the objective.
 *
 * The bystanders matter and are not padding. `campaignWorld` funds all three of its principals so
 * they can post bonds, which makes every one of them `freeCash`-entitled — so a test that used only
 * the fixture's own cast could never exercise the *unentitled recipient*, which is the case the reply
 * rung exists for and the case a real recruit is in.
 */
function warWorld(
  seed: string,
  bystanders = 0,
): ReturnType<typeof campaignWorld> & { readonly campaign: string; readonly bystanders: readonly PrincipalId[] } {
  const w = campaignWorld(seed);
  expect(act(w.runtime, w.attacker, 'build', { kind: 'CAMPAIGN', system: w.objective })).toBeNull();
  const id = w.runtime.campaigns.liveAgainst(w.objective)?.id;
  if (id === undefined) throw new Error('no campaign');
  const extra: PrincipalId[] = [];
  for (let n = 0; n < bystanders; n += 1) {
    const p = `p:bystand${String(n).padStart(2, '0')}` as PrincipalId;
    w.runtime.seat(p, `bystand${String(n)}`, w.objective);
    w.runtime.standing.open(p);
    extra.push(p);
  }
  if (bystanders > 0) tick(w.runtime);
  return { ...w, campaign: String(id), bystanders: extra };
}

describe('★ a parley is reachable, takeable, and it forms a coalition', () => {
  it('names REAL principals in the affordance — never a placeholder to guess', () => {
    const w = warWorld('parley-reach');
    const offers = parleyOffers(w.runtime, w.attacker);

    expect(
      offers.length,
      'an attacker standing in a live campaign must be offered somebody to address. This is the defect: the ' +
        'probe had `join {campaign, side}` published as its only answer, `counterparties[]` empty, and no ' +
        'channel that could ask anybody to take it.',
    ).toBeGreaterThan(0);

    for (const offer of offers) {
      const to = (offer.params as Record<string, unknown>)['to'];
      expect(typeof to, 'the recipient must be a string id').toBe('string');
      expect(
        w.runtime.world.holdingByPrincipal.get(to as PrincipalId),
        `the menu named ${String(to)}, which is not a seated principal. A2: an affordance is a complete, ` +
          'copyable act, and "<principal>" as literal text is a rule an agent cannot follow — which is exactly ' +
          'what it had before.',
      ).not.toBeUndefined();
      expect(offer.cost, 'a parley is FREE of the action budget, like every other `message`').toBe(0);
      expect(offer.max_direct_loss, 'a parley moves nothing').toBe(0);
    }

    // The ally is seated AT the objective, so it is in the objective's constellation — the clause
    // that makes a lone attacker able to recruit at all, rather than only able to talk to the roster
    // it does not have yet.
    expect(
      offers.map((o) => (o.params as Record<string, unknown>)['to']),
      "the objective's constellation must be reachable, or the recruiting case this exists for is missing",
    ).toContain(w.ally);
  });

  it('the verb accepts the exact params the menu published (AGT-S2)', () => {
    const w = warWorld('parley-accept');
    const offer = parleyOffers(w.runtime, w.attacker).find(
      (o) => (o.params as Record<string, unknown>)['to'] === w.ally,
    );
    if (offer === undefined) throw new Error('no parley offer to the ally');

    // Verbatim, plus the text the affordance told the agent to supply. `text: ''` in the menu is a
    // published placeholder and the handler refuses it on purpose (INV-26) — an empty parley spends
    // capacity that does not carry and says nothing.
    expect(
      act(w.runtime, w.attacker, 'message', offer.params),
      'the empty placeholder must be refused rather than recorded',
    ).not.toBeNull();

    const refusal = act(w.runtime, w.attacker, 'message', {
      ...offer.params,
      text: 'COALITION: join ATTACKER and I pay 20000 per hand at the objective.',
    });
    expect(
      refusal,
      `the affordance the menu published was refused by the verb: ${refusal?.hint ?? ''}. The gate is ONE ` +
        'function — `runtime.parleyRefusalFor` — precisely so this cannot happen.',
    ).toBeNull();

    const mail = w.runtime.parleysVisible(w.ally, w.runtime.engine.tick);
    expect(mail.length, 'the accepted act must have produced a row the recipient can read').toBe(1);
    expect(mail[0]?.from).toBe(w.attacker);
    expect(mail[0]?.act).toBe('offer');
    expect(mail[0]?.about, 'the row names the public situation that authorised the address').toBe(w.campaign);
    expect(mail[0]?.why).toBe('CAMPAIGN');
  });

  it('★ A COALITION FORMS BECAUSE SOMEBODY ASKED — the force reading changes', () => {
    const w = warWorld('parley-coalition', 1);
    // The recruit: seated at the objective, funded by nobody, standing in no war. `freeCash` 0 and
    // `distinct_counterparties` 0 — the state a real bystander is in, and the state the fixture's own
    // `ally` is NOT in (it is funded so it can post a bond, which makes it entitled by accident).
    const recruit = w.bystanders[0];
    if (recruit === undefined) throw new Error('no recruit');

    // The state the probe was in: it can see the answer and cannot ask for it.
    expect(
      w.runtime.campaigns.require(w.campaign as never).parties,
      'the roster starts empty — this is the probe\'s `counterparties[]: []`',
    ).toEqual([]);

    expect(
      act(w.runtime, w.attacker, 'message', {
        to: recruit,
        act: 'offer',
        text: 'COALITION WANTED: join this campaign ATTACKER. I pay 20000 per hand standing at the objective.',
      }),
      'the ask must land',
    ).toBeNull();

    // ── THE RECIPIENT READS IT, IN THE LIST THAT WAS EMPTY ────────────────────
    //
    // Not `parleysVisible` — the *observation*, because prose is not an interface and an agent plays
    // from the payload. §12.4's advice ("look at `counterparties[].last_default` before you trust
    // someone") has to be followable about the asker, which is the whole point of putting the
    // address book and the inbox in one list.
    const row = observe(w.runtime, recruit).counterparties.find(
      (c) => (c as Record<string, unknown>)['principal'] === w.attacker,
    ) as Record<string, unknown> | undefined;
    expect(
      row,
      'the asker must appear in the recipient\'s `counterparties[]`. It shares no venture with the ally, so ' +
        'before this it appeared nowhere and the mail was unreadable from inside the game.',
    ).not.toBeUndefined();
    expect(row?.['parleys_received']).toBe(1);
    expect((row?.['last_parley'] as Record<string, unknown> | null)?.['text']).toContain('20000 per hand');
    expect(
      row?.['last_default'],
      'the standing line must be present about a principal the reader has never dealt with — that is what ' +
        'makes pricing a stranger possible BEFORE dealing with it (§8, §12.4)',
    ).not.toBeUndefined();

    // ── AND IT CAN ANSWER, WITHOUT HAVING EARNED THE ENTITLEMENT ──────────────
    //
    // The ally holds no kept elective promise and `freeCash` 0, so it may start nothing. A channel it
    // could not answer would be a megaphone, and that is the defect `talksFor` closed for venture
    // channels with the arrow reversed.
    const recruitCapacity = w.runtime.parleysFor(recruit, w.runtime.engine.tick);
    expect(recruitCapacity.distinct_counterparties, 'the recruit has kept no elective promise').toBe(0);
    expect(recruitCapacity.earned_minor, 'and nobody has paid it anything').toBe(0);
    expect(recruitCapacity.awaiting_your_reply, 'but somebody is waiting on it').toBe(1);
    expect(
      recruitCapacity.parleys_remaining,
      'so it may answer exactly the one principal that addressed it, and start nothing',
    ).toBe(1);
    expect(
      act(w.runtime, recruit, 'message', { to: w.attacker, act: 'accept', text: 'Done. Three hands, 20000 each.' }),
      'the reply must be accepted',
    ).toBeNull();

    // ── THE COALITION ─────────────────────────────────────────────────────────
    const joins = observe(w.runtime, recruit).affordances.filter(
      (a) => a.verb === 'join' && (a.params as Record<string, unknown>)['campaign'] === w.campaign,
    );
    const attackSide = joins.find((a) => (a.params as Record<string, unknown>)['side'] === 'ATTACKER');
    expect(attackSide, 'the side it was asked to take must be offered').not.toBeUndefined();
    expect(act(w.runtime, recruit, 'join', attackSide?.params ?? {})).toBeNull();

    const roster = w.runtime.campaigns.require(w.campaign as never).parties;
    expect(
      roster.map((p) => String(p.principal)),
      '★ THE WHOLE POINT. A coalition exists that did not exist, and the only thing between the two states ' +
        'was one principal being able to ask another.',
    ).toEqual([String(recruit)]);
    expect(roster[0]?.side).toBe('ATTACKER');
  });

  it('is PARTIES while live and PUBLIC at sent + AUDIT_LAG_TICKS — one clock, three readerships (A9)', () => {
    const w = warWorld('parley-tier');
    const sentAt = w.runtime.engine.tick + 1;
    expect(
      act(w.runtime, w.attacker, 'message', { to: w.ally, act: 'assure', text: 'I will not touch your lanes.' }),
    ).toBeNull();

    const entry = w.runtime.parleysVisible(w.attacker, w.runtime.engine.tick)[0];
    if (entry === undefined) throw new Error('no parley');
    expect(entry.tick, 'the row is stamped with the tick it landed on').toBe(sentAt);
    expect(
      entry.revealsAtTick - entry.tick,
      'the declassify clock is `AUDIT_LAG_TICKS`, the SAME number a DOSSIER uses. Two numbers would let one ' +
        'surface publish ahead of another, which is how four visibility leaks in this codebase happened.',
    ).toBe(AUDIT_LAG_TICKS);

    // ── A9, IN THE DIRECTION THAT MATTERS ─────────────────────────────────────
    //
    // The recipient reads it now (it is addressed to it). A viewer — `reader: null` — and every
    // non-party agent read it together, later. So the spectator strictly FOLLOWS the recipient.
    expect(w.runtime.parleysVisible(w.ally, entry.tick).length, 'the recipient reads its own mail at once').toBe(1);
    expect(
      w.runtime.parleysVisible(null, entry.tick).length,
      'a viewer must NOT see it yet. A9: the client never shows a live fact an agent\'s own `observe` would ' +
        'not, and here the non-party agent cannot see it either.',
    ).toBe(0);
    expect(
      w.runtime.parleysVisible(w.defender, entry.tick).length,
      'and neither may a third principal standing in the same war',
    ).toBe(0);
    expect(
      w.runtime.parleysVisible(null, entry.revealsAtTick).length,
      'at `revealsAtTick` it is PUBLIC — to every viewer and every agent at once, which is what makes §14 able ' +
        'to print it beside what the sender actually did',
    ).toBe(1);
    expect(w.runtime.parleysVisible(w.defender, entry.revealsAtTick).length).toBe(1);
  });

  it('the allowance EXPIRES UNSPENT and the count is published before it is charged', () => {
    const w = warWorld('parley-capacity', 3);
    const before = w.runtime.parleysFor(w.attacker, w.runtime.engine.tick);
    expect(
      before.parleys_per_reckoning,
      'an entitled principal gets the whole allowance, and it is on `header` at full rather than only in a ' +
        'refusal that fires when it hits zero — §9\'s capacity spent this project\'s whole life that way',
    ).toBe(PARLEYS_PER_RECKONING);
    expect(before.rule, 'the expiry must be stated, not implied').toMatch(/DOES NOT\s+CARRY|do not carry/i);
    expect(before.reading_costs_parleys, 'reading and answering are free, published rather than implied').toBe(0);

    // Spend the lot on distinct recipients, then confirm the (N+1)th is refused as capacity and not
    // as reach — a refusal naming the wrong wall costs an agent an action every wake while it guesses.
    const targets = w.runtime.reachFor(w.attacker, w.runtime.engine.tick).map((r) => r.principal);
    expect(targets.length, 'the world must offer at least one more principal than the allowance').toBeGreaterThan(
      PARLEYS_PER_RECKONING,
    );
    for (let n = 0; n < PARLEYS_PER_RECKONING; n += 1) {
      const to = targets[n];
      if (to === undefined) throw new Error('short reach');
      expect(act(w.runtime, w.attacker, 'message', { to, act: 'offer', text: `terms ${String(n)}` })).toBeNull();
    }
    expect(w.runtime.parleysFor(w.attacker, w.runtime.engine.tick).parleys_remaining).toBe(0);
    const spent = act(w.runtime, w.attacker, 'message', {
      to: targets[PARLEYS_PER_RECKONING],
      act: 'offer',
      text: 'one too many',
    });
    expect(spent?.invariant).toBe('A15');
    expect(
      spent?.hint,
      'the refusal must say it does not accumulate. An agent that thinks capacity banks will plan a recruiting ' +
        'round it can never fund — `aggressionNote` records the same argument for demands.',
    ).toMatch(/does not accumulate|DO NOT CARRY/i);
  });

  it('refuses an unreachable principal, and the sentence says what would change it', () => {
    const w = warWorld('parley-unreachable');
    // A principal seated far away, in no campaign with the attacker and holding none of its grants.
    const stranger = 'p:stranger01' as PrincipalId;
    const far = w.runtime.world.map.systemOrder.find((s) => {
      const constellation = w.runtime.world.map.systems.get(s)?.constellation;
      return constellation !== w.runtime.world.map.systems.get(w.objective)?.constellation;
    });
    if (far === undefined) throw new Error('the launch map has one constellation');
    w.runtime.seat(stranger, 'stranger01', far);
    w.runtime.standing.open(stranger);
    tick(w.runtime);

    expect(
      w.runtime.reachFor(w.attacker, w.runtime.engine.tick).map((r) => String(r.principal)),
      'a principal in another constellation with no shared situation must not be reachable — an open directory ' +
        'of every enrolled principal is a gate priced in identities (A15)',
    ).not.toContain(String(stranger));

    const refusal = act(w.runtime, w.attacker, 'message', { to: stranger, act: 'offer', text: 'hello' });
    expect(refusal?.invariant).toBe('A15');
    expect(
      refusal?.hint,
      'the sentence must name the way in, or an agent burns an action a wake finding out. "You may not" without ' +
        '"and here is what would change that" is A2 failing.',
    ).toMatch(/join|grant/);
    expect(parleyOffers(w.runtime, w.attacker).map((o) => (o.params as Record<string, unknown>)['to'])).not.toContain(
      stranger,
    );
  });

  it('refuses a parley to yourself, and one over the length cap', () => {
    const w = warWorld('parley-guards');
    const self = act(w.runtime, w.attacker, 'message', { to: w.attacker, act: 'offer', text: 'note to self' });
    expect(self?.invariant, 'a self-parley is A2, not a silent no-op').toBe('A2');
    expect(
      self?.hint,
      'and the reason is the one an agent needs: its own reasoning is PRIVATE and nothing publishes it',
    ).toMatch(/PRIVATE/);

    const long = act(w.runtime, w.attacker, 'message', {
      to: w.ally,
      act: 'offer',
      text: 'x'.repeat(MAX_PARLEY_LENGTH + 1),
    });
    expect(long?.invariant, 'the cap is INV-26 (bounded buffers), not a style rule').toBe('INV-26');
  });

  it('does not disturb a MESSAGE inside a venture, or a DOSSIER hand', () => {
    // ── THE NON-VACUITY GUARD ON THE PARAMETER SPLIT ──────────────────────────
    //
    // `message` now selects between three objects by parameter. A `{to, dossier}` call must still
    // reach `cite` and a `{venture, act, text}` call must still reach the talk ring — a widening that
    // silently captured either would be scar #1 with the router as the cause.
    const w = warWorld('parley-coexist');
    const before = w.runtime.parleysVisible(w.attacker, w.runtime.engine.tick).length;
    fund(w.runtime, w.attacker, minor(1), 'noop');

    const noVenture = act(w.runtime, w.attacker, 'message', { venture: 'v:nope', act: 'offer', text: 'hi' });
    expect(
      noVenture?.invariant,
      'a `{venture}` call must still be routed to the venture channel and refused there (PROP-V6), never ' +
        'swallowed by the parley branch',
    ).toBe('PROP-V6');

    const noGrant = act(w.runtime, w.attacker, 'message', {
      to: w.ally,
      dossier: `${String(w.defender)}/STORES`,
    });
    expect(
      noGrant?.invariant,
      'a `{to, dossier}` call must still be routed to `cite` and refused for want of a CLEARANCE (INV-22) — ' +
        '`dossier` is tried FIRST, so a caller that sends both gets the document',
    ).toBe('INV-22');
    expect(
      w.runtime.parleysVisible(w.attacker, w.runtime.engine.tick).length,
      'and neither refusal may have written a parley',
    ).toBe(before);
  });
});
