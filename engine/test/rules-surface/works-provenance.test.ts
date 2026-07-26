/**
 * WHO MAY PAY FOR A WORKS — the engine's answer, and the four surfaces that disagreed with it.
 *
 * A probe agent played the newcomer path reading only `agent.md`, built a WORKS at tick 284 out of
 * a balance that was 100% enrolment grant, and reported it as a contradiction. It was right that the
 * surfaces contradicted the engine, and wrong about which side was broken.
 *
 * The engine is deliberate. `worksQuote` gates on `freeBalance` — the starter stake counts — with a
 * comment recording that the earlier `freeCash` version made the mechanic **unreachable**:
 * `worksAffordableBy` read 0 of 21 principals, because the floor withholds the whole endowment and a
 * graduated principal has less free than the floor. The economy's only faucet was correct, tested,
 * offered, rendered, and dead.
 *
 * D7's actual rule is that an endowment may never **leave** a principal, because a sock puppet
 * handing its stake to its operator turns free identities into capital. A build does not transfer:
 * it retires the money into `sink:upkeep`. A puppet that spends its stake here gives its operator
 * nothing. What bounds extraction is the map — a place yields what it yields, split among every
 * WORKS on it — so the ceiling is the number of systems, not the number of identities. That is A15
 * met by topology rather than by a price, which is why the price was never load-bearing.
 *
 * Meanwhile four agent-facing strings still taught the abandoned rule, and one of them was not
 * cosmetic: the cast prompt said *"It costs EARNINGS, not your starter stake"*, so a cast member with
 * no earnings concluded it could not build. Production ran with `works: 0` and
 * `worksAffordableBy: 2` — the demand side of the economy suppressed by a stale sentence. That is
 * scar #1: the engine changed the rule and the rules surface did not.
 *
 * ── WHAT THIS FILE CHECKS, AND WHAT IT CANNOT ────────────────────────────────
 * The engine half is a real end-to-end pin: a principal that has earned nothing builds a WORKS
 * through the front door. Re-adding the earnings gate fails it.
 *
 * The surface half is a **ban list of phrasings that were actually there**. It cannot catch someone
 * re-asserting the rule in new words. Stated plainly because a guard I claim is general and is not
 * is worse than one I label.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { storesAccount } from '../../src/ledger/index.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from '../api/harness.js';

type Row = Record<string, unknown>;
let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'works-provenance' });
});
afterEach(async () => {
  await h.close();
});

async function observe(who: Agent): Promise<Row> {
  const res = await signed(h, who, 'GET', PATHS.observe);
  expect(res.status, res.text.slice(0, 300)).toBe(200);
  return res.json['observation'] as Row;
}

describe('the endowment may raise a WORKS, because a build retires rather than transfers', () => {
  it('a principal that has earned NOTHING can build one, end to end', async () => {
    const who = agent('freshly-enrolled');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    const p = who.principalId as PrincipalId;

    const holding = (await observe(who))['holding'] as Row;
    const system = String(holding['system']) as SystemId;
    const works = holding['works'] as Row;
    const here = works['here'] as Row;

    // The premise of the test, asserted rather than assumed: this principal has done nothing, so
    // every unit of currency it holds is enrolment grant. If a future endowment change made a fresh
    // principal poorer than the cost, this would be a vacuous pass — so it is checked.
    expect(h.runtime.engine.tick, 'nothing has had time to be earned').toBeLessThan(4);
    const quote = h.runtime.worksQuote(p, system);
    expect(quote.freeMinor, 'the whole balance is grant').toBeGreaterThanOrEqual(quote.costMinor);
    expect(
      here['affordable'],
      'a fresh principal must be able to afford the economy\'s only faucet — gating this on earnings ' +
        'made it unreachable for every principal in a 21-principal world',
    ).toBe(true);

    // Through the front door, not by calling the verb handler: this is the path the probe took.
    const res = await signed(h, who, 'POST', PATHS.act, {
      actions: [{ verb: 'build', params: { kind: 'WORKS', system }, clientSequence: 1 }],
    });
    expect(res.status, res.text.slice(0, 400)).toBe(200);
    const outcome = res.json['outcome'] as Row;
    expect(
      (outcome['accepted'] as readonly unknown[]).length,
      `build refused: ${JSON.stringify(outcome['corrections'] ?? []).slice(0, 400)}`,
    ).toBe(1);
    tick(h, 2);
    // Read back through `observe`, not off an internal book: the front door is the surface the probe
    // used, and a private field would only prove the engine agrees with itself.
    const after = (await observe(who))['holding'] as Row;
    const held = (after['works'] as Row)['held'] as readonly unknown[];
    expect(held.length, 'the WORKS stands, and the agent can see that it stands').toBeGreaterThan(0);

    // And D7 still holds where it actually applies: the money went to a sink, not to a principal.
    // If a build ever paid another account, the puppet-to-operator route D7 exists to close would
    // be open, and this is the assertion that would notice.
    const stores = h.runtime.ledger.account(storesAccount(p));
    expect(stores, 'the account survives the build').toBeDefined();
  });
});

describe('no agent-facing surface teaches the abandoned earnings rule', () => {
  /** Every file an agent or a cast member reads the rule from. */
  const SURFACES: readonly string[] = ['agent.md', 'src/cast/prompt.ts', 'src/api/observe.ts'];

  /**
   * Phrasings that were literally present and literally wrong. Present tense on purpose: the
   * historical note in `agent.md` describes the abandoned rule in the past tense, and must stay
   * readable — an agent is owed the reason the rule it may have heard elsewhere is not the rule.
   */
  const BANNED: readonly string[] = [
    'starter stake cannot buy',
    'the starter stake cannot buy one',
    'starter stake is withheld from anything that buys permanent income',
    'starter stake is withheld from this',
    'costs EARNINGS, not your starter stake',
    'The currency must be **earned**',
  ];

  it('reads the surfaces non-trivially, so a bad path cannot pass this file vacuously', () => {
    for (const rel of SURFACES) {
      const text = readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
      expect(text.length, `${rel} is empty or unreadable`).toBeGreaterThan(2_000);
      expect(text, `${rel} must actually discuss the mechanic`).toMatch(/WORKS/);
    }
  });

  it('none of them asserts it', () => {
    const hits: string[] = [];
    for (const rel of SURFACES) {
      const text = readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
      for (const phrase of BANNED) {
        if (text.includes(phrase)) hits.push(`${rel}: "${phrase}"`);
      }
    }
    expect(
      hits,
      'these surfaces teach a rule the engine does not have. `worksQuote` gates on `freeBalance`, so ' +
        'the starter stake CAN raise a WORKS — the build retires the money instead of transferring ' +
        'it, and D7 only forbids an endowment leaving a principal. Fix the text, or if you are ' +
        'reinstating the gate, fix the engine first and expect the test above to fail.',
    ).toEqual([]);
  });

  it('and agent.md positively tells an agent it may', () => {
    // The absence of a wrong sentence is not the presence of a right one. The probe's failure mode
    // was reading the manual and concluding it could not build; silence would reproduce it.
    const md = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');
    expect(md).toMatch(/your starter stake can cover it/);
    expect(md, 'and names the field that decides it').toMatch(/works\.here\.affordable/);
  });
});
