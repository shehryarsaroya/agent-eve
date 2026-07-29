/**
 * ★ **`briefing.prompt` CONTRADICTED `briefing.if_you_do_nothing` IN THE SAME OBJECT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * A blind probe ran a complete betrayal with two identities — five offices, five hundred ticks of
 * silent surveillance, three leaks to three rivals, two manufactured defaults. With 7,800 of
 * permanent default riding and three compartments handed to three rivals, the victim's own
 * observation said:
 *
 *   **prompt:** *"Nothing is waiting on you and 3 of your hands are idle; an idle hand earns
 *   nothing, and the Commons is safe but poor."*
 *   **if_you_do_nothing:** *"…your elective 7800 is NOT paid — … a default on the record."*
 *
 * Two keys of one object, disagreeing about whether anything was happening. Earlier in the same run
 * `prompt` had coached the victim to finish staffing the venture its delegate had fabricated,
 * calling it *"the 1 **you** created."* **The dilemma field never once mentioned the delegate, the
 * grant, or the surveillance.**
 *
 * The cause was the ranking: `promptFor` read `ventures.mine`, `ventures.board` and idle hands, and
 * nothing else. A6 is the core loop and every fact about it was invisible to the sentence an agent
 * reads first — the eleventh instance of this project's standing defect, this time not a mechanism
 * that is missing but one that is *unreachable from the place a decision gets made*.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Both new branches are asserted **against a world that reached the state through the front door**,
 * and each is mutation-verified: with the branch removed the fixture below falls through to the
 * idle-hands line, which is the exact string the probe was shown.
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import { setSpeed } from '../../src/core/time.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { AUDIT_LAG_TICKS } from '../../src/grant/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { commonsSystems } from '../../src/world/index.js';
import { act as campaignAct, campaignWorld } from '../campaign/fixture.js';

type Row = Record<string, unknown>;
const obj = (v: unknown): Row => (typeof v === 'object' && v !== null ? (v as Row) : {});
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.map(obj) : []);

const IDLE_HANDS_LINE = 'Nothing is waiting on you';

/** The campaign fixture's own submit-and-run helper, re-exported under the local name. */
const act2 = campaignAct;

interface World {
  readonly rt: Runtime;
  readonly grantor: PrincipalId;
  readonly delegate: PrincipalId;
  readonly rival: PrincipalId;
  readonly stage: SystemId;
}

function world(seed: string): World {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const stage = commonsSystems(rt.world.map)[0];
  if (stage === undefined) throw new Error('the launch map has no Commons system');
  const grantor = 'p:trusting' as PrincipalId;
  const delegate = 'p:mole' as PrincipalId;
  const rival = 'p:rival' as PrincipalId;
  for (const [who, handle] of [
    [grantor, 'trusting'],
    [delegate, 'mole'],
    [rival, 'rival'],
  ] as const) {
    rt.seat(who, handle, stage);
    rt.standing.open(who);
  }
  return { rt, grantor, delegate, rival, stage };
}

/** One act through the front door; throws rather than letting a silent refusal fake a green test. */
function act(rt: Runtime, principal: PrincipalId, verb: string, params: Row): void {
  const outcome = rt.engine.submit({
    principal,
    verb,
    params,
    clientSequence: 0,
    arrivalMs: 0,
    decisionSource: 'LIVE',
  });
  if (!outcome.ok) throw new Error(`submit ${verb}: ${outcome.invariant} ${outcome.hint}`);
  const report = rt.runTick();
  if (report.halted) throw new Error(`${verb} halted: ${report.violations.map((v) => v.id).join(',')}`);
  const refusal = rt.takeCorrections(principal)[0];
  if (refusal !== undefined) throw new Error(`${verb} refused by the handler: ${refusal.invariant} ${refusal.hint}`);
}

function idle(rt: Runtime, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) {
    const report = rt.runTick();
    if (report.halted) throw new Error(`idle halted: ${report.violations.map((v) => v.id).join(',')}`);
  }
}

function observe(rt: Runtime, who: PrincipalId): Row {
  return buildObservation({
    runtime: rt,
    principal: who,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 9,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  }) as unknown as Row;
}

describe('the dilemma names the delegate, the grant and the leak', () => {
  it('★ a DOSSIER cut on you outranks idle hands, and the two briefing keys agree', () => {
    const w = world('leak-outranks-idle');

    // Before anything happens the fallback is CORRECT, and pinning that is what keeps the fix from
    // being "always say something alarming". Issuing no grant means nothing to report.
    expect(
      String(obj(observe(w.rt, w.grantor)['briefing'])['prompt']),
      'a grantor with no delegates and nothing owed genuinely has idle hands as its dilemma',
    ).toContain(IDLE_HANDS_LINE);

    act(w.rt, w.grantor, 'grant', {
      delegate: w.delegate,
      template: 'steward',
      max_direct_loss: 500,
      max_contingent_liability: 500,
      expires_tick: 400,
    });
    // Issuing a grant is STILL not a dilemma: it is the USE that is news. A branch that fired here
    // would nag every grantor forever and would be ignored within one wake.
    expect(
      String(obj(observe(w.rt, w.grantor)['briefing'])['prompt']),
      'a delegate that has done nothing is not a dilemma',
    ).toContain(IDLE_HANDS_LINE);

    // The mole cuts a dossier on its grantor's books and hands it to a rival.
    act(w.rt, w.delegate, 'message', { to: w.rival, dossier: `${String(w.grantor)}/STORES` });

    // Non-vacuity: it must actually be visible to the subject, or the branch is reading an empty
    // list. The lag is the engine's own constant, not a number retyped here.
    idle(w.rt, AUDIT_LAG_TICKS + 1);
    const payload = observe(w.rt, w.grantor);
    const aboutMe = rows(obj(payload['grants'])['about_me']);
    expect(aboutMe.length, 'the cut must have reached the subject, or there is nothing to name').toBe(1);
    expect(aboutMe[0]?.['cut_by']).toBe(w.delegate);

    const prompt = String(obj(payload['briefing'])['prompt']);
    expect(prompt, 'the fallback must no longer be reachable while a leak is on the record').not.toContain(
      IDLE_HANDS_LINE,
    );
    expect(prompt, 'it must name the delegate — a dilemma about nobody is not a dilemma').toContain(
      String(w.delegate),
    );
    expect(prompt, 'and the compartment that was read').toContain('STORES');
    expect(prompt, 'and who now holds it').toContain(String(w.rival));
    expect(prompt, 'and the two levers, since §13B gives owners narrative and agents control').toContain('revoke');
    expect(prompt).toContain('audit');
  });

  it('a venture SIGNED IN YOUR NAME is named as such, not as "the 1 you created"', () => {
    const w = world('delegated-bind-named');
    act(w.rt, w.grantor, 'grant', {
      delegate: w.delegate,
      template: 'quartermaster', // `create` — the verb that binds somebody else
      max_direct_loss: 50_000,
      max_contingent_liability: 50_000,
      expires_tick: 400,
    });
    act(w.rt, w.delegate, 'create', {
      kind: 'DIG',
      stage: w.stage,
      value: 4_000,
      elective_bps: 2_000,
      on_behalf_of: w.grantor,
    });

    const payload = observe(w.rt, w.grantor);
    // Non-vacuity: the venture must really be the grantor's, bound by the grant.
    const bound = rows(obj(payload['ventures'])['mine']).filter((v) => v['bound_by_grant'] !== null);
    expect(bound.length, 'the delegated create must have produced a venture in the grantor\'s name').toBe(1);

    const prompt = String(obj(payload['briefing'])['prompt']);
    expect(prompt).not.toContain(IDLE_HANDS_LINE);
    expect(prompt, 'the sentence must say the venture was signed in your name').toContain('signed in your name');
    expect(prompt, 'and name who did it').toContain(String(w.delegate));
    expect(
      prompt,
      'it must not read as the grantor\'s own initiative — "the 1 you created" is what the probe was told ' +
        'about a venture its delegate had fabricated',
    ).not.toContain('you created');
  });

  it('an unelected elective riding into settlement outranks the venture ladder', () => {
    // A5′: a formation window that closes retires a venture with nothing settled; a settlement that
    // arrives unelected writes a DEFAULTED row no verb removes. So the permanent one goes first.
    // This is the branch whose absence let "nothing is waiting on you" sit beside a 7,800 default.
    const w = world('elective-riding');
    act(w.rt, w.grantor, 'create', { kind: 'DIG', stage: w.stage, value: 6_000, elective_bps: 3_000 });
    const venture = w.rt.ventures.all().find((v) => v.creator === w.grantor);
    expect(venture, 'the fixture needs a venture').toBeDefined();
    if (venture === undefined) return;

    // Staff it with TWO parties and sign both, so it actually reaches LIVE — an unelected elective
    // only rides on a LIVE venture, and a fixture that stalls at FORMING would pass this test while
    // asserting nothing. (The first draft did exactly that: one hand, one role of two, and it
    // survived the mutation that deletes the branch under test.)
    const handOf = (who: PrincipalId): string => {
      const hand = [...w.rt.world.hands.values()].find((h) => h.principal === who);
      if (hand === undefined) throw new Error(`${who} has no hand`);
      return hand.id;
    };
    const [first, second] = venture.roles;
    expect(first, 'a DIG has two roles; this fixture needs both').toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    act(w.rt, w.grantor, 'fill_role', { venture: venture.id, role: first.index, hand: handOf(w.grantor), stake: 0 });
    act(w.rt, w.rival, 'fill_role', { venture: venture.id, role: second.index, hand: handOf(w.rival), stake: 0 });
    act(w.rt, w.grantor, 'sign', { venture: venture.id, terms_hash: venture.termsHash });
    act(w.rt, w.rival, 'sign', { venture: venture.id, terms_hash: venture.termsHash });

    // NON-VACUITY: it must be LIVE, and an elective must genuinely be unelected.
    expect(
      w.rt.ventures.require(venture.id).state,
      'the venture must reach LIVE or nothing can ride into settlement',
    ).toBe('LIVE');

    const payload = observe(w.rt, w.grantor);
    const prompt = String(obj(payload['briefing'])['prompt']);
    const ifNothing = String(obj(payload['briefing'])['if_you_do_nothing']);
    expect(
      ifNothing,
      'if_you_do_nothing must be reporting an unpaid elective, or the contradiction under test cannot exist',
    ).toMatch(/elective \d+ is NOT paid/);
    // ── THE PROPERTY: the two keys cannot disagree about whether anything is owed ──
    expect(
      prompt,
      `if_you_do_nothing says an elective is unpaid (${ifNothing.slice(0, 120)}…) while prompt said nothing ` +
        'was waiting — that is the two-keys-of-one-object contradiction a probe caught mid-betrayal',
    ).not.toContain(IDLE_HANDS_LINE);
    expect(prompt).toContain('ELECTIVE');
    expect(prompt, 'and it must say the record is permanent, because that is the whole decision').toContain(
      'DEFAULT',
    );
    // The same figure in both keys, from the same arithmetic. Two derivations is how they drift.
    const figure = /elective (\d+) is NOT paid/.exec(ifNothing)?.[1];
    expect(figure, 'the figure must be readable').toBeDefined();
    expect(prompt, 'and prompt must quote the same number, not a second derivation of it').toContain(
      String(figure),
    );
  });
});

describe("a creator's own `sign` quotes the escrow it actually owes", () => {
  it('★ max_direct_loss does not fall to 0 when the creator also fills a role', () => {
    // Measured from outside on a live turbo world: 4,800 before the creator filled a role in its own
    // venture, **0** after, with the escrow unchanged. The gate was `role === null` — the escrow
    // quoted to whoever holds NO role, rather than to whoever OWES it — and those come apart for
    // exactly one party: the creator that also fills a role. `fill_role` on your own venture is
    // offered from the menu, so this is two affordances copied in a row.
    //
    // A6's headline promise is `max_direct_loss` shown before you sign. It read zero.
    const w = world('creator-escrow-quote');
    act(w.rt, w.grantor, 'create', { kind: 'DIG', stage: w.stage, value: 8_000, elective_bps: 2_000 });
    const venture = w.rt.ventures.all().find((v) => v.creator === w.grantor);
    expect(venture, 'the fixture needs a venture').toBeDefined();
    if (venture === undefined) return;

    const signOf = (): Row | undefined =>
      rows(observe(w.rt, w.grantor)['affordances']).find(
        (a) => a['verb'] === 'sign' && obj(a['params'])['venture'] === venture.id,
      );

    const before = signOf();
    expect(before, 'the creator must be offered its own countersignature').toBeDefined();
    const quoted = Number(before?.['max_direct_loss']);
    // Non-vacuity: a venture whose escrow is 0 could not show this defect at all.
    expect(quoted, 'the escrow must be non-zero, or the assertion below is about nothing').toBeGreaterThan(0);

    const hand = [...w.rt.world.hands.values()].find((h) => h.principal === w.grantor);
    expect(hand).toBeDefined();
    if (hand === undefined) return;
    const role = venture.roles[0];
    expect(role).toBeDefined();
    if (role === undefined) return;
    act(w.rt, w.grantor, 'fill_role', { venture: venture.id, role: role.index, hand: hand.id, stake: 0 });

    const after = signOf();
    expect(after, 'still FORMING and still unsigned, so still offered').toBeDefined();
    const mine = rows(obj(observe(w.rt, w.grantor)['ventures'])['mine']).find((v) => v['id'] === venture.id);
    expect(mine?.['my_role'], 'the creator now holds a role — the case that broke the quote').not.toBeNull();
    expect(
      Number(after?.['max_direct_loss']),
      'the creator still escrows the whole amount; holding a role changes who DELIVERS, never who PAYS',
    ).toBe(quoted);
  });
});

/**
 * ★ **THE SAME RANKING BUG, FOUND AGAIN IN A WAR — so treat it as confirmed, not single-sourced.**
 *
 * A second probe fought an actual campaign. **Both** the attacker and the besieged defender read:
 *
 *   *"Nothing is waiting on you and 3 of your hands are idle; an idle hand earns nothing, and the
 *   Commons is safe but poor."*
 *
 * Neither was in the Commons, and the attacker's three "idle" hands **were the war's entire force.**
 * One key over, `holding.campaigns[0].if_you_do_nothing` said *"the pulse at tick 792 is a BREACH
 * against you — 2 of 3, and at 3 the claim LAPSES and your bond is slashed."*
 *
 * Two probes, two scenarios that share nothing, one ranking. A14's whole point is that the pulse
 * *fires whether you are awake or not*, so a dilemma field that omits it omits the only thing on the
 * clock the agent cannot dodge — and it told a besieged defender it was safe.
 */
describe('the dilemma names the war', () => {
  it('★ a live campaign outranks idle hands, for the attacker AND the besieged defender', () => {
    const w = campaignWorld('prompt-names-the-war');
    expect(act2(w.runtime, w.attacker, 'build', { kind: 'CAMPAIGN', system: w.objective })).toBeNull();
    const live = w.runtime.campaigns.liveAgainst(w.objective);
    expect(live, 'the fixture must have produced a live campaign').not.toBeNull();
    if (live === null) return;

    for (const [who, label] of [
      [w.attacker, 'attacker'],
      [w.defender, 'besieged defender'],
    ] as const) {
      const payload = observe(w.runtime, who);
      // NON-VACUITY: this principal must actually be a party, or the branch is about somebody else.
      const mine = rows(obj(payload['holding'])['campaigns']).filter((c) => c['your_side'] !== null);
      expect(mine.length, `the ${label} must read itself as a party to the war`).toBeGreaterThan(0);

      const prompt = String(obj(payload['briefing'])['prompt']);
      expect(prompt, `the ${label} was told the Commons was safe while a war was live`).not.toContain(
        IDLE_HANDS_LINE,
      );
      expect(prompt, 'the campaign must be named by id, so the agent can find the row').toContain(live.id);
      expect(prompt, 'and the ground it is about').toContain(String(w.objective));
      expect(prompt, "and which side this reader is on").toContain(String(mine[0]?.['your_side']));
      // The sentence is QUOTED from the campaign row, never re-derived: two derivations of "how is my
      // war going" is how the prompt and `holding.campaigns[0]` come to disagree inside one payload.
      expect(
        prompt,
        'the top-level dilemma must quote the campaign row\'s own if_you_do_nothing, not a second version of it',
      ).toContain(String(mine[0]?.['if_you_do_nothing']));
      // The specific lie: three hands committed to a war being reported as idle earnings potential.
      expect(prompt, 'and it must say plainly that committed hands are not idle hands').toContain(
        'not idle',
      );
    }
  });
});
