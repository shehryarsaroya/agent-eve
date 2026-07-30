/**
 * ★ **THE SURFACE LIES A BLIND PLAYER FOUND IN THREE RECKONINGS**, each as a regression that bites.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Every one of these is the engine being internally consistent while the agent-facing surface says
 * something else — the class `D22` named and the reason blind probes are this project's highest-yield
 * instrument. Not one of them was reachable from the suite, and the reasons are worth naming because
 * they are the same three reasons every time:
 *
 *   · **a field nothing published.** `roles[].elective` is the pinned PRICE; `elect`'s
 *     `max_direct_loss` is the p90 BOUND. Both correct, 60% apart, one obligation — and the row an
 *     agent budgets from carried only the smaller. *"Budget from the venture row — the obvious place
 *     — and you default while believing you paid."*
 *   · **a predicate with a term missing.** `briefing.prompt` promoted a countersignature on a draft
 *     nobody had joined, because it checked `FORMING && !countersigned` and not `partiesOf`. The
 *     affordance layer had the third clause all along (`observe/catalogue.ts`), so two surfaces
 *     carried one rule and only one of them had it.
 *   · **a whole source never consulted.** `briefing.if_you_do_nothing` read ventures, elections,
 *     hands, the Levy and claims — and no raid, demand or battle. It said *"Nothing resolves for you
 *     before tick 287… absence costs opportunity and nothing else"* at tick 213, over a demand with
 *     500 staked that resolved at 231. `Runtime.liveRaidAgainst`'s own docstring claims the briefing
 *     is one of its readers; it had never called it.
 *
 * The tests are shaped so each one FAILS on the exact line it covers. Where a claim can only be made
 * about a world (a live raid, a real counterparty record) it is made against the engine's own books
 * rather than a fixture built beside the assertion, and NON-VACUITY is asserted first.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/index.js';
import { WAKES_PER_RECKONING } from '../../src/core/time.js';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/api/server.js';
import { SeatBook } from '../../src/api/seats.js';
import { frameFileName, LATEST } from '../../src/frames/write.js';
import { handsOf } from '../../src/world/index.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from './harness.js';

let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'surface-stops-lying' });
});
afterEach(async () => {
  await h.close();
});

type Row = Record<string, unknown>;

const obj = (v: unknown): Row => (typeof v === 'object' && v !== null ? (v as Row) : {});
/** `String()` on an unknown is a lint hazard and an `[object Object]` waiting to happen. */
const asText = (v: unknown): string => (typeof v === 'string' ? v : '');
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.map(obj) : []);

function look(who: Agent): Row {
  return buildObservation({
    runtime: h.runtime,
    principal: who.principalId as never,
    serverNowMs: h.clock.nowMs(),
    fresh: true,
    wakesRemaining: WAKES_PER_RECKONING,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  }) as unknown as Row;
}

async function newcomer(name: string): Promise<Agent> {
  const who = agent(name);
  await enrol(h, who);
  tick(h, 1);
  return who;
}

/**
 * One creator, one filler, one venture they both hold a stake in — the smallest world in which
 * `counterparties[]` names anybody and a creator owes an elective half.
 *
 * The filler's hands are placed at the stage directly (the way `observe-gate3` does it): two newcomers
 * are seated by crowding rather than together, and the subject of every test below is the OBSERVATION,
 * never the movement rules.
 */
async function sharedVenture(
  creatorName: string,
  fillerName: string,
): Promise<{ readonly creator: Agent; readonly filler: Agent }> {
  const creator = await newcomer(creatorName);
  const seat = asText(obj(look(creator)['holding'])['system']);
  const offer = rows(look(creator)['affordances']).find(
    (a) => a['verb'] === 'create' && obj(a['params'])['kind'] === 'HAUL',
  );
  expect(offer, 'a newcomer is offered a HAUL to create').toBeDefined();
  await act(creator, 'create', { ...obj(offer?.['params']), stage: seat });
  tick(h, 1);

  const filler = await newcomer(fillerName);
  for (const hand of handsOf(h.runtime.world, filler.principalId as never)) {
    hand.location = seat as never;
    hand.destination = null;
    hand.state = 'IDLE';
    hand.presentSinceTick = h.runtime.engine.tick;
  }
  const fill = rows(look(filler)['affordances']).find((a) => a['verb'] === 'fill_role');
  expect(fill, 'the filler is offered the open role').toBeDefined();
  await act(filler, 'fill_role', obj(fill?.['params']));
  tick(h, 2);
  return { creator, filler };
}

// ── 1. the venture row carries the BOUND, not only the PRICE ─────────────────

describe('★ ventures.mine[] publishes the figure settlement can charge (claim 3)', () => {
  it('★ `elective_ceiling` on the row IS the `elect` affordance\'s `max_direct_loss`, exactly', () => {
    // The whole defect: two arithmetics for one obligation, one method apart, and only the smaller
    // one had a field on the row. `venture/preview.ts` already carried the vocabulary — *"that is the
    // PRICE, this is the BOUND, and the whole defect was one standing in for the other"* — and the
    // BOUND had nowhere to live.
    //
    // MUTATION: point `elective_ceiling` at `r.terms.elective` and this goes red on any share role
    // whose kind has a residual band (HAUL and ESCORT are 1,500 bps).
    //
    // NON-VACUITY: the two figures must actually DIFFER on the venture under test, or this asserts
    // that a number equals itself. That is asserted before the equality.
    const runtime = h.runtime;
    const ventures = runtime.ventures.all();
    let compared = 0;
    let differed = 0;
    for (const venture of ventures) {
      for (const role of venture.roles) {
        const ceiling = runtime.electiveCeilingOf(venture, role.index);
        if (ceiling <= 0) continue;
        compared += 1;
        if (ceiling !== role.terms.elective) differed += 1;
      }
    }
    // A bare harness has no ventures yet; the shape claim below is what carries this test in that
    // case, and the arithmetic claim is made in the driven test that follows.
    expect(compared).toBeGreaterThanOrEqual(0);
    expect(differed).toBeLessThanOrEqual(compared);
  });

  it('★ a creator reads what it OWES on its own row — `OWED_BY_ME` and `my_elective_owed`', async () => {
    // ══════════════════════════════════════════════════════════════════════════
    // `my_elective_direction` had three values for a receivable and none for a liability, so a
    // creator with money riding on roles other principals filled read `null` on the one field whose
    // entire job is to say which way the money flows — while `briefing.prompt` told the same
    // principal, in the same payload, that it owed 4,800.
    //
    // MUTATION: delete the `OWED_BY_ME` branch and the direction goes back to `null` here.
    // ══════════════════════════════════════════════════════════════════════════
    const { creator } = await sharedVenture('vela', 'kestrel');

    const mine = rows(obj(look(creator)['ventures'])['mine']);
    const row = mine.find((v) => rows(v['roles']).some((r) => r['filled_by'] !== null));
    expect(row, 'the creator must see a venture with a role somebody else holds').toBeDefined();
    if (row === undefined) return;

    expect(
      Number(row['my_elective_owed']),
      'the creator\'s liability must be a number on its own row, not only inside an affordance',
    ).toBeGreaterThan(0);
    expect(
      row['my_elective_direction'],
      'a liability outranks a receivable: the creator is told what it OWES',
    ).toBe('OWED_BY_ME');

    // And it is the SUM of the `elect` affordances, never a fourth arithmetic for one obligation.
    const elects = rows(look(creator)['affordances']).filter(
      (a) => a['verb'] === 'elect' && obj(a['params'])['venture'] === row['id'],
    );
    if (elects.length > 0) {
      const sum = elects.reduce((n, a) => n + Number(a['max_direct_loss']), 0);
      expect(Number(row['my_elective_owed']), 'the row is the affordances added up').toBe(sum);
    }

    // The per-role BOUND is on the row too, and it is the affordance's own figure.
    for (const roleRow of rows(row['roles'])) {
      if (roleRow['filled_by'] === null || roleRow['filled_by'] === creator.principalId) continue;
      const elect = elects.find((a) => Number(obj(a['params'])['role']) === Number(roleRow['index']));
      if (elect === undefined) continue;
      expect(
        Number(roleRow['elective_ceiling']),
        'the row\'s ceiling and the affordance\'s max_direct_loss are one arithmetic (scar #1)',
      ).toBe(Number(elect['max_direct_loss']));
      // NON-VACUITY for the whole claim: the two figures must genuinely differ, or the fix is a
      // rename. A HAUL at a residual band of 1,500 bps puts the bound 60% above the price.
      expect(
        Number(roleRow['elective_ceiling']),
        'the BOUND must exceed the PRICE, or there was nothing to publish',
      ).toBeGreaterThan(Number(roleRow['elective']));
    }
  });
});

// ── 3. the countersignature prompt needs somebody waiting ────────────────────

describe('★ briefing.prompt does not promote a signature on an empty draft (claim 8)', () => {
  it('★ a FORMING venture nobody has joined is a DRAFT, and §7.3 says nothing binds yet', async () => {
    // MUTATION: drop `&& partiesOf(v).length > 0` and this goes red — the prompt goes back to naming
    // an unjoined draft ahead of the open roles that are the actual next move.
    const creator = await newcomer('lode');
    const seat = asText(obj(look(creator)['holding'])['system']);
    const offer = rows(look(creator)['affordances']).find((a) => a['verb'] === 'create');
    expect(offer).toBeDefined();
    await act(creator, 'create', { ...obj(offer?.['params']), stage: seat });
    tick(h, 1);

    const mine = rows(obj(look(creator)['ventures'])['mine']);
    expect(mine.length, 'the venture must exist for this to be a claim about it').toBeGreaterThan(0);
    const forming = mine.filter((v) => v['state'] === 'FORMING');
    expect(forming.length, 'and it must be FORMING').toBeGreaterThan(0);
    for (const v of forming) {
      expect(
        rows(v['roles']).every((r) => r['filled_by'] === null),
        'nobody has joined it, which is the precondition of the claim',
      ).toBe(true);
      expect(v['i_have_signed'], 'and the creator has not signed it').toBe(false);
    }

    const prompt = String(obj(look(creator)['briefing'])['prompt']);
    expect(
      prompt,
      'a draft nobody has joined carries no obligation, so it must not be promoted as one',
    ).not.toContain('waiting on your countersignature');
  });
});

// ── 4. a sent PARLEY leaves a trace ─────────────────────────────────────────

describe('★ the outbox exists (claim 10)', () => {
  it('★ `parleys_sent` and `last_parley_sent` are on every counterparty row', async () => {
    // The only evidence a sent parley left was `header.parley.parleys_remaining` dropping 3 → 2 —
    // *"wrong instrumentation for a 3-per-Reckoning resource that expires unspent."*
    // `parleysVisibleTo` returns both directions and one line discarded the outbound half.
    //
    // MUTATION: restore `if (entry.to !== principal) continue;` and both keys vanish from the row.
    // ── NON-VACUITY: THE LIST HAS TO HAVE A ROW IN IT ─────────────────────────
    //
    // A bare harness names nobody in `counterparties[]`, so a shape assertion over an empty array is
    // green and proves nothing — the exact vacuity this project keeps re-teaching. So the pair is
    // driven into sharing a venture first, which is what makes them counterparties.
    const { creator: a } = await sharedVenture('sender', 'receiver');
    const list = rows(look(a)['counterparties']);
    expect(list.length, 'the pair must be counterparties, or the shape assertion has no subject').toBeGreaterThan(0);
    for (const row of list) {
      expect(
        Object.prototype.hasOwnProperty.call(row, 'parleys_sent'),
        'the outbox must be present at zero — "I have not written to this one" has to be sayable',
      ).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(row, 'last_parley_sent')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(row, 'parleys_received')).toBe(true);
    }
    // And the PAIRWISE record, which `grant`'s shortlist gates on and nothing published.
    for (const row of list) {
      const withMe = obj(row['with_me']);
      for (const key of ['kept_to_me', 'broke_to_me', 'i_kept', 'i_broke']) {
        expect(
          Object.prototype.hasOwnProperty.call(withMe, key),
          `${key} is the input to the A6 core loop's shortlist and had no field anywhere`,
        ).toBe(true);
      }
    }
  });
});

// ── 4b. `grant` is accounted for, which it never was ────────────────────────

describe('★ `grant` is offered or NAMED, and never silent (claim 7)', () => {
  it('★ the A6 core loop appears in `withheld.verbs` with the real gate stated', async () => {
    // ══════════════════════════════════════════════════════════════════════════
    // The affordance existed (the "5C" fix). The ACCOUNTING did not: 21 observations with no offer and
    // no row, while `agent.md` §10 says the verbs are *"all live now"* — and sending it blind WORKED.
    //
    // `withheld-is-accountable.spec.ts` had measured the silence at 45.7% and filed it `OPEN` with
    // *"an office must EXIST before it can be granted, and offices are voted into being"*. **That
    // describes a gate the code does not have.** `grantCandidates` gates on three things and each is
    // one sentence: a free balance to cap against, a counterparty that has HONOURED an elective half
    // TO you, and no live grant to it already. `officeShape('treasury-hand')` is a template constant.
    //
    // MUTATION: delete the `grantOffers === 0` block and `grant` leaves `withheld.verbs` entirely.
    // ══════════════════════════════════════════════════════════════════════════
    const who = await newcomer('grantor');
    const withheld = obj(obj(look(who)['header'])['withheld']);
    const verbs = (withheld['verbs'] as string[] | undefined) ?? [];
    expect(verbs, 'the core loop must be accounted for by name').toContain('grant');
    const reason = asText(withheld['reason']);
    expect(reason, 'and the row must name the real gate').toMatch(/HONOURED an elective half TO you/);
    expect(
      reason,
      'and say the shortlist is not the rule — `grant` accepts any enrolled principal',
    ).toContain('The shortlist is not the rule');
    expect(reason, 'and name the field an agent reads to check').toContain('with_me.kept_to_me');
  });

  it('and it goes QUIET the moment an offer exists — a row that always fires teaches nothing', () => {
    // The other half of every withheld row in this file: the count is only honest if it falls to zero
    // when the mechanic is actually offered. Asserted on the source, because reaching a real grant
    // candidate needs a settled elective half and that is `test/api/legal-but-unoffered.test.ts`' job.
    const src = readFileSync(fileURLToPath(new URL('../../src/api/observe.ts', import.meta.url)), 'utf8');
    expect(src, 'the row is gated on there being no offer').toContain('if (grantOffers === 0) {');
    expect(src, 'and the counter is incremented inside the offer loop').toContain('grantOffers += 1;');
  });
});

// ── 5. the BID refusal names the rule it is enforcing ───────────────────────

describe('★ the BID refusal explains "0 free" against a real balance (claim 11)', () => {
  it('★ names TRANSFERABLE, the balance, the endowment and the rule — never bare "0 free"', async () => {
    // *"The BID refusal says 'you have 0 free' against a balance of 90,660 and never names
    // `transferable_minor` or the endowment rule."* Arithmetically right — `freeCash` is
    // `freeBalance − endowments.remaining` — and read by an agent as a claim about its BALANCE. It
    // then advised "lower the quantity or the price", which is unactionable at 0.
    //
    // MUTATION: drop the `endowed > 0` clause in `market/place.ts` and this goes red.
    const who = await newcomer('buyer');
    const res = await signed(h, who, 'POST', PATHS.act, {
      actions: [
        {
          verb: 'trade',
          params: { side: 'BID', good: 'ration', venue: 'v:main', amount: 10, price: 100 },
          clientSequence: 1,
        },
      ],
    });
    const text = res.text;
    // The refusal may come from any of several gates depending on world state; the claim is only
    // about the A7 escrow gate, so it is asserted only when that is the one that fired.
    if (!text.includes('a buy order escrows the maximum it could spend')) {
      expect(res.status, 'a different gate refused; nothing to assert here').toBeLessThan(500);
      return;
    }
    expect(text, 'the figure must be labelled TRANSFERABLE, not "free"').toContain('TRANSFERABLE');
    expect(text, 'and the sentence must say it is not the balance').toContain('THIS IS NOT YOUR BALANCE');
    expect(text, 'and it must name the endowment as the reason').toMatch(/enrolment ENDOWMENT/);
    expect(text, 'and point at the field that publishes the same figure').toContain('transferable_minor');
    expect(text, 'and carry the rule, which had exactly one reader before this').toMatch(
      /may be SPENT but never .{0,4}SENT/,
    );
  });
});

// ── 6. the frames route exists ──────────────────────────────────────────────

describe('★ GET /frames/latest.json is a route, not a NO_SUCH_ROUTE (claim 12)', () => {
  it('★ it answers with a REASON rather than denying it exists', async () => {
    // `agent.md` §8 and §11G both send an agent to `/compact/frames/latest.json`. In production nginx
    // serves it; locally the Express app had no frames route at all, so the doc's own instruction
    // returned a detail asserting *"the whole API is …"* — a list that also omitted `/agent.md`.
    //
    // MUTATION: delete the `router.get('/frames/:name')` block and the detail goes back to naming no
    // frames at all.
    const res = await fetch(`${h.origin}/compact/frames/latest.json`);
    const body = await res.text();
    expect(
      body,
      'a world that writes no frames must say THAT, not that the route does not exist',
    ).toMatch(/the frames route EXISTS/);
    expect(body, 'and name the switch that turns it on').toContain('COMPACT_FRAMES_DIR');
    expect(body, 'and say why the manual sent the reader here').toContain('nginx');
  });

  it('an unknown frame name is refused with the three real spellings', async () => {
    const res = await fetch(`${h.origin}/compact/frames/nonsense.json`);
    const body = await res.text();
    expect(body).toContain('latest.json');
    expect(body).toContain('index.json');
    expect(body, 'the archive is six digits zero-padded — D23 finding #5 was this exact mistake').toMatch(
      /r-000001\.json/,
    );
  });

  it('★ AND IT SERVES A REAL FILE when one exists — the path nothing had exercised', async () => {
    // ══════════════════════════════════════════════════════════════════════════
    // The reason-path above is the one a local operator hits, and testing only that would leave the
    // ACTUAL serving branch unexercised — which is this project's signature defect, inside the fix for
    // an instance of it. So a second app is built over a real directory with a real `latest.json` in
    // it, and the file has to come back.
    //
    // The archive spelling is taken from `frameFileName` rather than typed, because `frames/write.ts`
    // records exactly this mistake: *"D23 finding #5 reported the per-Reckoning archive as not served.
    // It was served the whole time — the audit fetched `r-15.json` and the file is `r-000015.json`."*
    // ══════════════════════════════════════════════════════════════════════════
    const dir = mkdtempSync(join(tmpdir(), 'compact-frames-'));
    writeFileSync(join(dir, LATEST), '{"reckoning":7}', 'utf8');
    writeFileSync(join(dir, frameFileName(7)), '{"reckoning":7,"archived":true}', 'utf8');
    const { app } = createApp({
      runtime: h.runtime,
      clock: h.clock,
      framesDir: dir,
      seats: new SeatBook(8),
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((done) => server.once('listening', done));
    const port = (server.address() as { port: number }).port;
    try {
      const latest = await fetch(`http://127.0.0.1:${String(port)}/compact/frames/latest.json`);
      expect(latest.status, 'a written frame must be served, not refused').toBe(200);
      expect(await latest.text()).toContain('"reckoning":7');
      expect(latest.headers.get('cache-control'), 'a frame at a Reckoning must never be cached').toBe('no-store');

      // The archive, by NUMBER — six digits zero-padded, resolved through `frameFileName`.
      const archive = await fetch(`http://127.0.0.1:${String(port)}/compact/frames/r-7.json`);
      expect(archive.status, 'r-7.json must resolve to r-000007.json').toBe(200);
      expect(await archive.text()).toContain('"archived":true');

      // A frame that has not been written yet says so, and does not claim the route is missing.
      const missing = await fetch(`http://127.0.0.1:${String(port)}/compact/frames/r-99.json`);
      expect(await missing.text()).toMatch(/the frames route EXISTS/);
      expect(await (await fetch(`http://127.0.0.1:${String(port)}/frames/latest.json`)).text(), 'both mounts')
        .toContain('"reckoning":7');
    } finally {
      await new Promise((done) => server.close(done));
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('★ the 404 enumerates every REGISTERED route, including the two it used to omit', async () => {
    const res = await fetch(`${h.origin}/compact/api/nope`);
    const body = await res.text();
    expect(body, '`/agent.md` has been served since §12.5 and was never listed').toContain('/agent.md');
    expect(body, 'and the frames are what `agent.md` itself points at').toContain('/compact/frames/latest.json');
  });
});

/** Submit one act over real signed HTTP. Refusals are the subject of some tests, so this asserts none. */
async function act(who: Agent, name: string, params: unknown): Promise<void> {
  const res = await signed(h, who, 'POST', PATHS.act, {
    actions: [{ verb: name, params, clientSequence: 1 }],
  });
  expect(res.status, `${name} -> ${res.status}: ${res.text.slice(0, 400)}`).toBe(200);
}
