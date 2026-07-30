/**
 * ★ THE RECORD REMEMBERS A LIVE PLAYER — standing accrues for a REAL SIGNED IDENTITY.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **EVERY PRIOR MEASUREMENT OF PROMISE-KEEPING IN THIS PROJECT WAS TAKEN ON HEURISTICS.**
 *
 * `test/sim/standing-accrual.test.ts` is this test's older sibling and it is a good test.
 * It drives `HeuristicCast` in-process, asserts standing goes non-zero with real value
 * across a distinct counterparty, and has passed for the project's whole life. What it
 * cannot see is the seat an actual player occupies: it never enrols, never signs an HTTP
 * request, never reads an affordance, and never sends `elect` over the wire. So the claim
 * *"the ledger records who kept their word"* was proven for one class of principal — the
 * one whose actions are constructed by the engine's own code — and **assumed** for the
 * other, which is the only class the premise is about.
 *
 * A play-test then reported four signed identities finishing 888 ticks with every standing
 * vector at zero. That reading turned out to be wrong (this file is the proof), but the
 * *gap* it exposed was real: **nothing in CI could have told the difference.** A blank
 * ledger for live players and a working one produce identical output from every existing
 * test, because no existing test looks.
 *
 * ── WHAT THIS FILE ASSERTS, IN THE ORDER THAT MATTERS ──────────────────────
 *
 * Non-vacuity **first**, on purpose. A world where nothing binds satisfies "no wrong
 * standing was written" perfectly, and this repo has shipped that shape at five depths
 * (a verb with no handler, an affordance nothing selects, an invariant whose subject
 * cannot occur, a mechanism nobody used, a rule that never discriminates). So before any
 * claim about the record, each case asserts that the thing being recorded **happened**:
 * `elect` was offered, the act was accepted, and the venture reached a terminal state
 * where a promise could be kept or broken. If the flow silently stops binding, these fail
 * with "the venture never went LIVE" rather than passing over an empty ledger.
 *
 * Then the record itself, from **both** sides of A7:
 *
 *   1. a creator that elects `IN_FULL` on every role → `electiveHonoured`,
 *      `electiveHonouredValue` and `distinctCounterparties` all move, and the journal
 *      names both counterparties;
 *   2. a creator that says nothing → `defaults` and `lastDefaultTick` move, and each
 *      `DEFAULT` change names **who it was broken against** (that field was `null` once,
 *      which silently emptied `relationsFor().broke` and made the docket lie);
 *   3. **the two records are not equal.** This is the play-test's actual complaint in one
 *      line: *"the honest payer and the explicit defaulter have identical, all-zero
 *      records."* A test that only checks case 1 would pass while every principal in the
 *      world shared one row.
 *   4. the **wire** agrees with the book. `header.standing` was a hardcoded zero beside a
 *      live `StandingBook` for most of this project's life, so reading the book alone
 *      proves the engine right and the agent-facing surface unexamined.
 *
 * ── AND WHAT A CREATOR OWES IS ON ITS OWN ROW ──────────────────────────────
 *
 * The last case pins `ventures.mine[].my_elective_owed` against Σ `max_direct_loss` over
 * that venture's own `elect` affordances. Two numbers for one obligation is the defect
 * this project keeps re-finding; asserting them equal is how they stay one.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PATHS,
  agent,
  harness,
  publicKeyOf,
  raw,
  signed,
  tick,
  type Agent,
  type Harness,
} from '../api/harness.js';
import { IN_FULL } from '../../src/venture/index.js';
import type { PrincipalId, Standing } from '../../src/core/types.js';

let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'record-remembers', seats: 32 });
});
afterEach(async () => {
  await h.close();
});

type Row = Record<string, unknown>;

interface Observation {
  readonly header: Row;
  readonly hands: readonly Row[];
  readonly ventures: Row;
  readonly affordances: readonly Row[];
  readonly briefing: Row;
}

async function enrol(a: Agent): Promise<void> {
  const res = await raw(
    h,
    'POST',
    PATHS.enroll,
    JSON.stringify({ handle: a.handle, publicKey: publicKeyOf(a) }),
    { 'content-type': 'application/json' },
  );
  expect(res.status, `enrol ${a.handle}: ${res.text.slice(0, 200)}`).toBe(201);
  a.principalId = String(res.json['principalId']);
}

/** A signed `GET /observe` — the payload an external agent actually gets. */
async function observe(a: Agent): Promise<Observation> {
  const res = await signed(h, a, 'GET', PATHS.observe);
  expect(res.status, `observe ${a.handle}: ${res.text.slice(0, 200)}`).toBe(200);
  const o = res.json['observation'] as Row;
  return {
    header: o['header'] as Row,
    hands: (o['hands'] ?? []) as Row[],
    ventures: (o['ventures'] ?? {}) as Row,
    affordances: (o['affordances'] ?? []) as Row[],
    briefing: (o['briefing'] ?? {}) as Row,
  };
}

/**
 * Submit affordances **verbatim**, the way `agent.md` §12 tells an agent to, and return how
 * many the engine accepted.
 *
 * The count is returned rather than logged because it is an assertion target: an act that
 * was refused proves nothing about the record, and "0 accepted" is exactly the vacuous
 * green this file exists to prevent.
 */
async function send(a: Agent, affordances: readonly Row[]): Promise<number> {
  if (affordances.length === 0) return 0;
  const res = await signed(h, a, 'POST', PATHS.act, {
    actions: affordances.slice(0, 4).map((aff, i) => ({
      verb: aff['verb'],
      params: aff['params'],
      clientSequence: i + 1,
      quoteId: aff['quote_id'],
    })),
  });
  expect(res.status, `act ${a.handle}: ${res.text.slice(0, 300)}`).toBeLessThan(300);
  const outcome = (res.json['outcome'] ?? {}) as Row;
  return ((outcome['accepted'] ?? []) as unknown[]).length;
}

/**
 * A stable id order. Explicit comparator, never a bare `.sort()` (DET-1): the lint rule that
 * bans one here is the same rule that keeps a replay's `state_hash` reproducible, and a test
 * comparing two lists must not be the place it gets an exemption.
 */
function sortedIds(ids: readonly (string | null)[]): readonly string[] {
  return [...ids].map((x) => x ?? '').sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function verbs(o: Observation, verb: string): readonly Row[] {
  return o.affordances.filter((x) => x['verb'] === verb);
}

function myVenture(o: Observation, id: string): Row | undefined {
  return ((o.ventures['mine'] ?? []) as Row[]).find((v) => v['id'] === id);
}

function standingOf(a: Agent): Standing {
  return h.runtime.standing.row(a.principalId as PrincipalId);
}

/** `header.standing.standing`, the wire form of the reader's own record. */
function wireStanding(o: Observation): Row {
  return (o.header['standing'] as Row)['standing'] as Row;
}

interface Played {
  readonly creator: Agent;
  /** The two `max_*` figures on the creator's own `sign`, read before it was sent. */
  readonly signQuote: { readonly direct: number; readonly contingent: number };
  readonly holders: readonly Agent[];
  readonly venture: string;
  /** Every `elect` affordance the creator was offered once the venture was fully filled. */
  readonly electOffered: readonly Row[];
  readonly electAccepted: number;
  /** The creator's own row for the venture, read at the last look before the freeze. */
  readonly rowBeforeSettlement: Row;
  readonly terminalState: string;
}

/**
 * One venture, played end to end by three real signed identities.
 *
 * `election` decides what the creator states: `IN_FULL` (case 1), a token minor unit (the
 * play-test's `riv-obel` shape), or `null` for silence (case 2).
 */
async function playOneVenture(election: typeof IN_FULL | number | null): Promise<Played> {
  let signQuote = { direct: 0, contingent: 0 };
  const creator = agent('vane');
  const first = agent('obel');
  const second = agent('tarn');
  await enrol(creator);
  await enrol(first);
  await enrol(second);
  tick(h, 1);

  // The stage is wherever the creator's hands stand: home systems differ per principal, and
  // `fill_role` needs a hand *present at the venture's stage* (the rule that cost Gate 3 the
  // most). So the holders walk, rather than the test hardcoding a system id.
  const stage = String((await observe(creator)).hands[0]?.['location']);
  expect(stage, 'the creator has a hand somewhere').not.toBe('undefined');
  for (const holder of [first, second]) {
    const o = await observe(holder);
    const walk = verbs(o, 'move').filter((m) => (m['params'] as Row)['to'] === stage);
    expect(walk.length, `${holder.handle} can reach ${stage} — both start in the Commons`).toBeGreaterThan(0);
    expect(await send(holder, walk.slice(0, 1)), `${holder.handle}'s move is accepted`).toBe(1);
  }
  tick(h, 8);

  // Create, then countersign: `create` does not bind the creator, and the venture retires
  // ABANDONED if the window closes unsigned.
  const made = verbs(await observe(creator), 'create').slice(0, 1);
  expect(made.length, '`create` is offered to a funded newcomer').toBe(1);
  expect(await send(creator, made), '`create` is accepted').toBe(1);
  tick(h, 1);
  // ── ★ THE CONTINGENT COLUMN ON THE VERB THAT BINDS THE CREATOR ────────────
  // A6's headline is "with `max_direct_loss` and `max_contingent_liability` shown before you
  // sign". At this moment no role is filled, and the figure used to be Σ over roles ALREADY
  // held by somebody else — i.e. 0 — for the party carrying the whole elective half.
  const signOffer = verbs(await observe(creator), 'sign');
  expect(signOffer.length, 'the creator is asked to countersign its own venture').toBe(1);
  signQuote = {
    direct: Number(signOffer[0]?.['max_direct_loss']),
    contingent: Number(signOffer[0]?.['max_contingent_liability']),
  };
  expect(await send(creator, signOffer), 'the creator countersigns').toBe(1);
  tick(h, 1);

  const mine = ((await observe(creator)).ventures['mine'] ?? []) as Row[];
  const venture = String(mine.find((v) => v['state'] === 'FORMING')?.['id']);
  expect(venture, 'the creator has a FORMING venture').not.toBe('undefined');

  // Every role filled by a DIFFERENT principal, because §6.4 accrues standing only across
  // distinct counterparties and a self-filled role is booked as paid (scar #9). One holder
  // per role: `fill_role` refuses two roles in one venture to one principal.
  const roleCount = ((mine.find((v) => v['id'] === venture)?.['roles'] ?? []) as Row[]).length;
  expect(roleCount, 'the offered kind mints at least two roles').toBeGreaterThanOrEqual(2);
  for (const [i, holder] of [first, second].entries()) {
    const o = await observe(holder);
    const fill = verbs(o, 'fill_role').filter(
      (f) => (f['params'] as Row)['venture'] === venture && (f['params'] as Row)['role'] === i,
    );
    expect(fill.length, `${holder.handle} is offered role ${String(i)} of ${venture}`).toBe(1);
    expect(await send(holder, fill), `${holder.handle}'s fill_role is accepted`).toBe(1);
  }
  tick(h, 1);
  for (const holder of [first, second]) {
    const o = await observe(holder);
    const sign = verbs(o, 'sign').filter((s) => (s['params'] as Row)['venture'] === venture);
    expect(sign.length, `${holder.handle} is asked to countersign ${venture}`).toBe(1);
    expect(await send(holder, sign), `${holder.handle}'s countersignature is accepted`).toBe(1);
  }
  tick(h, 1);

  // ── NON-VACUITY GATE ──────────────────────────────────────────────────────
  // Nothing below this line means anything unless the venture actually bound and the
  // creator was actually offered the choice.
  const atChoice = await observe(creator);
  // A wake-exhausted read carries `affordances: []` and `withheld.verbs: []`, which would make
  // the next assertion fail as "elect was not offered" when the truth is "no affordance list was
  // solved". This flow spends ~7 of 16 wakes; if a future edit pushes it over, fail on the real
  // reason. (It is also the reading that most plausibly produced the play-test's report.)
  expect(
    Number(atChoice.header['wakes_remaining']),
    'the creator must still hold a wake, or this observation carries no affordance list at all',
  ).toBeGreaterThan(0);
  const row = myVenture(atChoice, venture);
  expect(row?.['state'], `${venture} must be LIVE before a promise can be kept or broken`).toBe('LIVE');
  const electOffered = verbs(atChoice, 'elect').filter((e) => (e['params'] as Row)['venture'] === venture);
  expect(
    electOffered.length,
    'the creator is offered one `elect` per role somebody else holds — the choice has to be offered or it is not a choice',
  ).toBe(2);

  let electAccepted = 0;
  if (election !== null) {
    const stated = electOffered.map((e) => ({
      ...e,
      params: { ...(e['params'] as Row), election },
    }));
    electAccepted = await send(creator, stated);
    expect(electAccepted, 'the creator’s election is accepted by the engine').toBe(2);
  }
  tick(h, 1);

  const rowBeforeSettlement = myVenture(await observe(creator), venture) ?? {};

  // To the settlement tick and one past it.
  const settlement = Number(row?.['resolves_at_tick']);
  expect(Number.isSafeInteger(settlement), 'the LIVE row publishes its settlement tick').toBe(true);
  tick(h, settlement + 1 - h.runtime.engine.tick);

  const after = myVenture(await observe(creator), venture);
  return {
    creator,
    signQuote,
    holders: [first, second],
    venture,
    electOffered,
    electAccepted,
    rowBeforeSettlement,
    terminalState: String(after?.['state']),
  };
}

describe('the record remembers a live player (A5, A6, A7, §6.4)', () => {
  it('a signed identity that elects IN_FULL is recorded as having honoured it', async () => {
    const played = await playOneVenture(IN_FULL);

    // Non-vacuity, restated at the assertion site: a venture that never settled cannot have
    // moved anybody's standing, and "0 honoured" would then be correct rather than a bug.
    expect(played.terminalState, `${played.venture} must reach SETTLED`).toBe('SETTLED');
    expect(played.electAccepted, 'both elections were accepted').toBe(2);

    const row = standingOf(played.creator);
    expect(row.electiveHonoured, 'an elective half paid in full is one honoured promise per role').toBe(2);
    expect(
      row.distinctCounterparties,
      'two independently-capitalised counterparties, so two units of diversity credit (INV-21’s anti-farm term)',
    ).toBe(2);
    expect(
      row.electiveHonouredValue as number,
      'standing carries the VALUE honoured, not only the count — a zero here makes trust unpriceable (AGT-E2)',
    ).toBeGreaterThan(0);
    expect(row.defaults, 'nothing was broken').toBe(0);
    expect(row.lastDefaultTick).toBeNull();

    // The journal is the proof the cached row cannot move without (scar #9), so it must name
    // both counterparties rather than summing to the right total.
    const changes = h.runtime.standing
      .changes()
      .filter((c) => c.principal === (played.creator.principalId as PrincipalId));
    expect(changes.length, 'one journal entry per honoured role').toBe(2);
    expect(changes.every((c) => c.cause === 'ELECTIVE_HONOURED')).toBe(true);
    expect(
      sortedIds(changes.map((c) => c.counterparty)),
      'the journal names WHO each promise was kept with',
    ).toEqual(sortedIds(played.holders.map((a) => a.principalId)));

    // The wire, which was a hardcoded zero beside this very book for most of the build.
    const wire = wireStanding(await observe(played.creator));
    expect(wire['elective_honoured'], 'the agent’s own observation agrees with the book').toBe(2);
    expect(wire['distinct_counterparties']).toBe(2);
    expect(wire['elective_honoured_value']).toBe(row.electiveHonouredValue);
  }, 120_000);

  it('a signed identity that says nothing is recorded as having defaulted, and names the payee', async () => {
    const played = await playOneVenture(null);

    expect(played.terminalState, `${played.venture} must reach DEFAULTED`).toBe('DEFAULTED');
    // The choice existed and was declined by silence rather than never offered — the
    // distinction between a betrayal and a missing mechanic.
    expect(played.electOffered.length, 'the creator WAS offered the choice it declined').toBe(2);

    const row = standingOf(played.creator);
    expect(row.defaults, 'an unelected elective half is a decline, and a decline is a default').toBe(2);
    expect(
      row.lastDefaultTick,
      'the stamp is the settlement tick — `agent.md` §12 tells every counterparty to read it',
    ).toBe(Number(played.rowBeforeSettlement['resolves_at_tick']));
    expect(row.electiveHonoured, 'nothing was honoured').toBe(0);
    expect(row.distinctCounterparties, 'a broken promise buys no diversity credit').toBe(0);

    const changes = h.runtime.standing
      .changes()
      .filter((c) => c.principal === (played.creator.principalId as PrincipalId));
    expect(changes.length).toBe(2);
    expect(changes.every((c) => c.cause === 'DEFAULT')).toBe(true);
    expect(
      sortedIds(changes.map((c) => c.counterparty)),
      'a DEFAULT names who it was broken against; this field was null once, and `relationsFor().broke` was ' +
        'structurally always zero because of it',
    ).toEqual(sortedIds(played.holders.map((a) => a.principalId)));

    const wire = wireStanding(await observe(played.creator));
    expect(wire['defaults'], 'an agent can see its own record, which §13 requires to report one').toBe(2);
    expect((await observe(played.creator)).header['standing']).toMatchObject({
      last_default: row.lastDefaultTick,
    });
  }, 120_000);

  it('a token election is a decline, not a discount', async () => {
    // The play-test's `riv-obel` shape: one minor unit stated against a whole role. Anything
    // short of the due is a decline (`elect`'s own `what_it_forecloses` says so), so this must
    // land on the record exactly like silence — otherwise a single unit buys immunity.
    const played = await playOneVenture(1);
    expect(played.terminalState).toBe('DEFAULTED');
    expect(played.electAccepted, 'the engine accepted the token election').toBe(2);

    const row = standingOf(played.creator);
    expect(row.defaults, 'a unit is not a payment').toBe(2);
    expect(row.electiveHonoured).toBe(0);
  }, 120_000);

  it('the honest payer and the defaulter do not share one record', async () => {
    // The play-test's complaint in one line. Two worlds rather than two principals in one,
    // because only the creator can elect and there is one creator per venture — so the
    // comparison that matters is between the same seat under the two choices.
    const honoured = await playOneVenture(IN_FULL);
    const honouredRow = standingOf(honoured.creator);
    await h.close();

    h = await harness({ seed: 'record-remembers', seats: 32 });
    const broken = await playOneVenture(null);
    const brokenRow = standingOf(broken.creator);

    // Same seed, same seat, same venture, opposite choice: everything about the two runs is
    // equal except the election, so any difference below is caused by the election alone.
    expect(honoured.venture, 'the two runs played the same venture').toBe(broken.venture);
    expect(
      { honoured: honouredRow.electiveHonoured, defaults: honouredRow.defaults },
      'the payer that kept its word',
    ).toEqual({ honoured: 2, defaults: 0 });
    expect(
      { honoured: brokenRow.electiveHonoured, defaults: brokenRow.defaults },
      'the payer that did not',
    ).toEqual({ honoured: 0, defaults: 2 });
    expect(
      honouredRow.electiveHonoured === brokenRow.electiveHonoured &&
        honouredRow.defaults === brokenRow.defaults,
      'if these ever match, the record has stopped distinguishing keeping a promise from breaking one, ' +
        'and the game has no memory of the only thing it is about',
    ).toBe(false);
  }, 240_000);

  it('a creator reads what IT owes on its own venture row, and it is the engine’s own charge', async () => {
    // ── A7's PAYING SIDE ────────────────────────────────────────────────────
    // `my_elective` is the elective on the role YOU hold; a bare creator holds none, so that
    // field is 0 and its direction was `null` — the promisor's own row naming its liability
    // as nothing. `my_elective_owed` is the missing figure, and it must equal what `elect`
    // charges, because two numbers for one obligation is the defect underneath this one.
    const played = await playOneVenture(null);
    const row = played.rowBeforeSettlement;

    expect(row['my_role'], 'this creator filled none of its own roles — the ordinary case').toBeNull();
    expect(row['my_elective'], '`my_elective` is still about the role you HOLD').toBe(0);
    expect(
      row['my_elective_direction'],
      'the creator is the promisor, and the row must say so rather than reading `null`',
    ).toBe('OWED_BY_ME');

    const charged = played.electOffered.reduce((n, e) => n + Number(e['max_direct_loss']), 0);
    expect(charged, 'the elect affordances charge something').toBeGreaterThan(0);
    expect(
      row['my_elective_owed'],
      'the row and the affordances quote ONE obligation: Σ max_direct_loss over this venture’s own `elect` rows',
    ).toBe(charged);
    expect(
      row['my_elective_unelected'],
      'nothing was elected, so the whole charge is still riding on a promise',
    ).toBe(charged);
  }, 120_000);

  it('`sign` shows the creator a contingent liability, not a zero (A6’s headline promise)', async () => {
    const played = await playOneVenture(IN_FULL);
    expect(
      played.signQuote.direct,
      'the escrow is locked by signing, so the direct column is real too',
    ).toBeGreaterThan(0);
    expect(
      played.signQuote.contingent,
      'the elective half is entirely contingent at signing — every role open, every one able to go to a ' +
        'stranger. Published as 0 for the party that carries all of it, on the verb A6 names.',
    ).toBeGreaterThan(0);
    // And it bounds what the same venture later actually charges: the worst case cannot be
    // smaller than the charge that materialises out of it.
    const owedOnce = Number(played.rowBeforeSettlement['my_elective_owed']);
    expect(owedOnce, 'the roles did get filled').toBeGreaterThan(0);
    expect(
      played.signQuote.contingent,
      'a bound that is exceeded is not a bound (A2, and `electiveCeilingOfRole`’s own scar)',
    ).toBeGreaterThanOrEqual(owedOnce);
  }, 120_000);

  it('electing IN_FULL empties the unelected figure on the creator’s own row', async () => {
    const played = await playOneVenture(IN_FULL);
    const row = played.rowBeforeSettlement;
    expect(row['my_elective_direction']).toBe('OWED_BY_ME');
    expect(Number(row['my_elective_owed']), 'the charge does not change when you elect').toBeGreaterThan(0);
    expect(
      row['my_elective_unelected'],
      'IN_FULL covers whatever the due turns out to be, so nothing is left unelected',
    ).toBe(0);
    // And the briefing agrees, because it is now the same call.
    expect(String(played.rowBeforeSettlement['id'])).toBe(played.venture);
  }, 120_000);
});
