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
 *
 * ── ★ THE CAST HOOK, AS A NAMED LIST OF CALLS ────────────────────────────────
 *
 * `src/cast/heuristic.ts` is another agent's lane this round, so the branch is reported rather than
 * written. Two halves, and **the second is the one without which the mechanism is dead**: a channel
 * whose messages nobody reads is `lockFillStake` with a passing test and no caller.
 *
 * **(a) ASK — for a member that is a campaign belligerent and would lose the next pulse.**
 *
 *     const capacity = runtime.parleysFor(me, tick);          // header.parley
 *     if (capacity.parleys_remaining === 0) return;           // priced, and it says why in `.rule`
 *     for (const view of runtime.campaignsFor(me, tick, 24))  // holding.campaigns[]
 *       if (view.your_side !== null && view.force.outcome_if_pulsed_now === 'REBUFF')
 *         for (const row of runtime.reachFor(me, tick))       // ONLY these ids are legal
 *           if (runtime.parleyRefusalFor(me, row.principal, tick) === null)
 *             emit('message', { to: row.principal, act: 'offer', text: <the terms> });
 *
 *   Rank by `runtime.standing.row(row.principal).defaults` ascending — §12.4's advice, now applicable
 *   to a stranger for the first time — and prefer `why === 'CAMPAIGN'` rows over `'GRANT'` ones.
 *
 * **(b) ANSWER — for every member, every wake, and it costs nothing to be entitled to.**
 *
 *     for (const c of observation.counterparties)             // the inbox IS the address book
 *       if (c.parleys_received > 0 && c.last_parley !== null) {
 *         if (<the terms are worth taking> && <a live campaign names the asker>)
 *           emit('join', { campaign: <id>, side: <the side the asker is on>, system: <objective> });
 *         emit('message', { to: c.principal, act: 'accept' | 'decline', text: <why> });
 *       }
 *
 *   `header.parley.principals_awaiting_your_reply` is the count, and a member with no entitlement of its own
 *   still has exactly that many parleys — so (b) is reachable for every seat in the world from the
 *   first Reckoning, which (a) is not.
 *
 * **What to measure once it exists.** `scripts/parley-probe.ts` reports entitlement, reach and offers;
 * what it cannot report until the cast has these branches is *uptake* — parleys sent, replies sent, and
 * **roster rows whose principal had received a parley naming that campaign.** That last number is the
 * only one that answers "did a coalition form because somebody asked".
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import type { PrincipalId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { AUDIT_LAG_TICKS } from '../../src/grant/dossier.js';
import { compareIds } from '../../src/ledger/index.js';
import { PARLEYS_PER_RECKONING, MAX_PARLEY_LENGTH } from '../../src/say/parley.js';
import { MAX_MESSAGE_LENGTH, type Runtime } from '../../src/sim/runtime.js';
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

    // ── AND IT MUST SURVIVE `firstOfEachVerb` ─────────────────────────────────
    //
    // `api/observe.ts` sorts the first offer of each verb ahead of every repeat, because that is what
    // an agent copying its menu takes. `message` has two other shapes — `assure` on an unpaid elective
    // half, and a DOSSIER cut — so the parley is only first when neither applies. For a belligerent
    // that owes no elective half and holds no clearance, which is exactly the probe's position, it
    // must be: an agent that copies its top row while losing a war should be asking for help.
    const firstMessage = observe(w.runtime, w.attacker).affordances.find((a) => a.verb === 'message');
    expect(
      (firstMessage?.params as Record<string, unknown> | undefined)?.['to'],
      'a belligerent owing no elective half must find the PARLEY as its FIRST `message` offer, or a blind ' +
        'copier fighting a war it cannot win alone never asks anybody',
    ).not.toBeUndefined();
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
    expect(recruitCapacity.principals_awaiting_your_reply, 'but somebody is waiting on it').toBe(1);
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

  it('★ writes a `say.parley` ROW on the record, PARTIES and ASSERTION — not just a ring entry', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE HALF A MUTATION TEST CAUGHT NOTHING ABOUT.** Every assertion above reads the parley RING,
    // which is what agents see. The event LEDGER is what the viewer, the audit and §14's receipt reel
    // read — and the brief's own example is `haul.landed`, refused on **every** emission for the
    // project's life, so the record stayed silent while nothing failed and no test went red.
    //
    // Flipping `provenanceClass` from `ASSERTION` to `FACT` was mutation M11 and it **survived** the
    // whole file. This closes it, and the field is not a formality: `FACT` is the engine vouching for
    // a claim it cannot check. It vouches that these words were said, at this tick, by this principal,
    // and for nothing about whether they are true. Stamping an agent's promise `FACT` is A5′ inverted
    // on the one surface §14 quotes verbatim.
    // ══════════════════════════════════════════════════════════════════════════
    const w = warWorld('parley-record');
    expect(
      act(w.runtime, w.attacker, 'message', { to: w.ally, act: 'assure', text: 'your lanes are safe with me' }),
    ).toBeNull();

    const rows = w.runtime.events
      .ticks()
      .flatMap((t) => w.runtime.events.eventsAtTick(t))
      .filter((e) => e.event.kind === 'say.parley');
    expect(rows.length, 'exactly one row, and it must EXIST — a ring entry is not a record').toBe(1);
    const record = rows[0];
    if (record === undefined) throw new Error('no row');
    const row = record.event;

    expect(row.isPublic, 'PARTIES while live means not public at send').toBe(false);
    expect(record.visibility).toBe('PARTIES');
    expect(
      row.provenanceClass,
      'ASSERTION. The engine vouches that it was SAID, never that it is TRUE — mutation M11 flipped this to ' +
        'FACT and every other assertion in this file still passed.',
    ).toBe('ASSERTION');
    expect(
      [row.publicAt, row.declassifyAt],
      'both clocks are the row\'s own reveal tick. Two numbers is how a leak publishes on one surface before ' +
        'another (§11.2), and the DOSSIER uses exactly this shape.',
    ).toEqual([row.tick + AUDIT_LAG_TICKS, row.tick + AUDIT_LAG_TICKS]);
    expect(
      w.runtime.events.audienceOf(row.id).map((a) => String(a.principal)).sort(compareIds),
      'both parties, and nobody else: one said it and one was told it',
    ).toEqual([String(w.attacker), String(w.ally)].sort(compareIds));
    expect(
      row.payload['text'],
      'the TEXT is in the payload, unlike a dossier\'s figures — §14 has nothing to quote otherwise',
    ).toBe('your lanes are safe with me');
    expect(row.payload['why']).toBe('CAMPAIGN');
    expect(row.payload['about'], 'and the public situation that made the address legal').toBe(w.campaign);
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

  it('⚑ an unentitled principal addressed by TWO others can answer BOTH — the allowance is a denominator', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE REGRESSION FOR A BUG THE FIRST VERSION HAD AND THE ONE-SENDER TEST COULD NOT SEE.**
    //
    // The reply allowance was `min(3, unanswered senders)`, and `remaining` is `allowance − sent`. So
    // answering the first sender removed it from `unanswered` AND counted as spend — the same reply
    // subtracted twice — and a recruit courted by both sides of a war could answer one of them and was
    // then mute to the other for the rest of the Reckoning. That is the megaphone defect one layer in,
    // and it would have shipped: the coalition test has one sender and passed throughout.
    //
    // The term is now a count of parleys RECEIVED, which is monotone inside a Reckoning: a denominator
    // rather than a balance.
    // ══════════════════════════════════════════════════════════════════════════
    const w = warWorld('parley-two-askers', 1);
    const recruit = w.bystanders[0];
    if (recruit === undefined) throw new Error('no recruit');

    // Both sides court the same bystander. The defender is entitled (the fixture funds it for its
    // claim bond) and the attacker is entitled, and both stand in the same war as the recruit's
    // constellation, so both may address it.
    expect(act(w.runtime, w.attacker, 'message', { to: recruit, act: 'offer', text: 'join me, 20000' })).toBeNull();
    expect(act(w.runtime, w.defender, 'message', { to: recruit, act: 'offer', text: 'defend, 25000' })).toBeNull();

    const capacity = w.runtime.parleysFor(recruit, w.runtime.engine.tick);
    expect(capacity.distinct_counterparties, 'the recruit has earned nothing').toBe(0);
    expect(capacity.earned_minor).toBe(0);
    expect(capacity.parleys_received_this_reckoning, 'two parleys arrived').toBe(2);
    expect(capacity.principals_awaiting_your_reply, 'from two distinct principals').toBe(2);
    expect(capacity.parleys_remaining, 'so it holds two replies, not one').toBe(2);

    expect(act(w.runtime, recruit, 'message', { to: w.attacker, act: 'decline', text: 'not enough' })).toBeNull();
    expect(
      act(w.runtime, recruit, 'message', { to: w.defender, act: 'accept', text: 'done' }),
      'the SECOND reply must land. Under the old arithmetic this was refused A15 and the recruit could ' +
        'never tell the second bidder anything.',
    ).toBeNull();
    expect(w.runtime.parleysFor(recruit, w.runtime.engine.tick).parleys_remaining, 'and now it is spent').toBe(0);
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

    // ── ONE PUBLISHED QUANTITY, TWO DECLARATIONS, PINNED (scar #5) ────────────
    //
    // `MAX_PARLEY_LENGTH` cannot import `MAX_MESSAGE_LENGTH` without a module cycle, so the two
    // literals are held equal here instead. `agent.md` tells an agent one number for "how long a
    // message can be" and it must not silently become two.
    expect(
      MAX_PARLEY_LENGTH,
      'a parley and a venture MESSAGE must carry the same length. If this diverges, `agent.md` §4 states ' +
        'one figure for two limits and one of them is a lie (scar #1 through a constant).',
    ).toBe(MAX_MESSAGE_LENGTH);
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
