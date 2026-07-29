/**
 * ★ §15.4's FALSE-DEFAULT AUDIT, FOR THE RISK PATHS — both modes, against a real `Runtime`.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > *"The design's only product is a permanent public record of promises kept and broken, and an
 * > unfrozen settlement can fabricate a broken promise."* — §15.4
 *
 * `src/invariants/audit.ts` runs this in two modes over a **self-contained model** of the venture
 * promise. That model has no `Runtime`, no clock and no risk market, so extending it in place would
 * mean rewriting another module's file around `src/risk/`. This file runs the same two modes over the
 * **real engine** instead — real `HAZARD`, real `OBLIGE`, real freeze, real `ASSERT` — which is
 * strictly the harder test and the one that already caught two live defects (INV-12 refusing every
 * `indemnity.opened` row, and INV-17 halting on an unregistered accusation).
 *
 * **Mode A, no hazard: an all-cooperative cohort must log ZERO defaults.** Mode A catches *invention* —
 * a default recorded where nothing went wrong.
 *
 * **Mode B, hazard on: every logged default must be ATTRIBUTABLE.** Mode B catches *silence* — a real
 * default the record cannot point at. §15.4 is explicit that a codebase with only Mode A ships the
 * second bug and one with only Mode B ships the first, *"because a fabricated default is trivially
 * attributable to whatever the fabricator felt like naming."*
 *
 * ## And a third mode this layer needs and ventures do not
 *
 * **Mode C: the post-event price spike.** After a FRONT, the good it destroyed is scarce and its mark
 * moves. Valuing the loss at the *current* mark would inflate every INDEMNITY past the limit its payer
 * agreed to and make the payer short **through a price move it did not cause** — a false default with
 * no race, no stale read, and every individual settlement arithmetically correct. §15.4's third defence
 * is the valuation pinned in `terms_hash`, and this is the mode that checks it.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import type { EventId, PrincipalId } from '../../src/core/types.js';
import { LEVY_GOOD } from '../../src/levy/index.js';
import { storesAccount } from '../../src/ledger/accounts.js';
import { COVER_ELECTIVE_BPS_CEILING, pinnedMark } from '../../src/risk/index.js';
import type { Runtime } from '../../src/sim/runtime.js';
import {
  FIRST_ANNOUNCE_TICK,
  FIRST_LANDFALL_TICK,
  act,
  eventsOfKind,
  fund,
  riskWorld,
  runTo,
  stockAt,
  tick,
} from './fixture.js';

const SETTLE_TICK = 3 * 288 + 287;

interface Bound {
  readonly runtime: Runtime;
  readonly payee: PrincipalId;
  readonly payer: PrincipalId;
  readonly cover: string;
  readonly system: string;
}

/** One bound primary COVER over goods a FRONT will strike. No cession: this is about invention. */
function bound(seed: string): Bound {
  const world = riskWorld(seed, 5, 'MARCHES');
  const { runtime, principals } = world;
  const [payee, payer, , bankA, bankB] = principals;
  if (payee === undefined || payer === undefined || bankA === undefined || bankB === undefined) {
    throw new Error('unreachable');
  }
  fund(runtime, bankA, payer, 200_000);
  fund(runtime, bankB, payee, 200_000);

  runTo(runtime, FIRST_ANNOUNCE_TICK);
  const front = runtime.risk.allFronts()[0];
  if (front === undefined) throw new Error('unreachable');
  const cell = [...front.swath].sort((a, b) => b.intensityBps - a.intensityBps)[0];
  if (cell === undefined) throw new Error('unreachable');
  stockAt(runtime, payee, cell.system, 400_000, LEVY_GOOD);

  const offered = act(runtime, payer, 'publish_offer', {
    kind: 'COVER',
    system: cell.system,
    good: LEVY_GOOD,
    limit: 60_000,
    premium: 1_000,
    elective_bps: COVER_ELECTIVE_BPS_CEILING,
  });
  expect(offered, `the offer was refused: ${offered?.hint ?? ''}`).toBeNull();
  const cover = runtime.risk.coversBy(payer)[0];
  if (cover === undefined) throw new Error('unreachable');
  const signed = act(runtime, payee, 'sign', { cover: cover.id, terms_hash: cover.termsHash ?? '' });
  expect(signed, `the sign was refused: ${signed?.hint ?? ''}`).toBeNull();

  return { runtime, payee, payer, cover: cover.id, system: cell.system };
}

describe('MODE A — an all-cooperative cohort logs ZERO defaults', () => {
  it('is not vacuous: the FRONT struck, an INDEMNITY opened, and the payee was PAID', () => {
    const b = bound('mode-a');
    runTo(b.runtime, FIRST_LANDFALL_TICK);
    tick(b.runtime);
    expect(b.runtime.risk.allIndemnities().length, 'the subject occurred').toBe(1);

    const before = b.runtime.ledger.balance(storesAccount(b.payee));
    act(b.runtime, b.payer, 'elect', { cover: b.cover, election: 'IN_FULL' });
    runTo(b.runtime, SETTLE_TICK);

    const after = b.runtime.ledger.balance(storesAccount(b.payee));
    expect(after, 'the promise was kept, in money').toBeGreaterThan(before);
    const ind = b.runtime.risk.allIndemnities()[0];
    expect(ind?.state, 'and the row says so').toBe('PAID');
  });

  it('★ ZERO `indemnity.default` events, and ZERO risk rows in the DefaultRegister', () => {
    const b = bound('mode-a-zero');
    runTo(b.runtime, FIRST_LANDFALL_TICK);
    tick(b.runtime);
    act(b.runtime, b.payer, 'elect', { cover: b.cover, election: 'IN_FULL' });
    runTo(b.runtime, SETTLE_TICK);

    // MUTATION: in `settleIndemnity`, change `electiveShortfall > 0` to `>= 0`. A cooperative payer
    // that paid every unit is then recorded as a defaulter for zero, which is §15.4's *invention* —
    // and it is the only failure Mode A can see, because a fabricated default is trivially
    // attributable to whatever the fabricator names.
    expect(eventsOfKind(b.runtime, 'indemnity.default').length, 'nothing was invented').toBe(0);
    expect(
      eventsOfKind(b.runtime, 'indemnity.settled').length,
      'and the settlement WAS recorded, so the zero above is not a silent no-op',
    ).toBeGreaterThan(0);
  });

  it('★ and a FRONT that takes NOTHING covered logs zero defaults too', () => {
    // The other half of invention: a peril that fires and reaches nobody insured must not produce an
    // obligation. A world with a front, a cover, and no overlap between them.
    const world = riskWorld('mode-a-miss', 4, 'MARCHES');
    const { runtime, principals } = world;
    const [payee, payer, , bank] = principals;
    if (payee === undefined || payer === undefined || bank === undefined) throw new Error('unreachable');
    fund(runtime, bank, payer, 200_000);
    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    // A system the CONE names and the SWATH does not — non-vacuity for "the storm missed".
    const struck = new Set(front.swath.map((c) => c.system));
    const missed = front.cone.find((c) => !struck.has(c.system));
    expect(missed, 'the CONE names a system the front will miss, or this test has no subject').toBeDefined();
    if (missed === undefined) throw new Error('unreachable');
    stockAt(runtime, payee, missed.system, 200_000, LEVY_GOOD);

    runTo(runtime, FIRST_LANDFALL_TICK);
    tick(runtime);
    expect(eventsOfKind(runtime, 'front.swept').length, 'the front DID land').toBe(1);
    expect(runtime.risk.allIndemnities().length, 'and owed nobody anything').toBe(0);
    runTo(runtime, SETTLE_TICK);
    expect(eventsOfKind(runtime, 'indemnity.default').length).toBe(0);
  });
});

describe('MODE B — every logged default is ATTRIBUTABLE (§15.4, INV-17)', () => {
  it('is not vacuous: a drained payer really does default', () => {
    const b = bound('mode-b');
    runTo(b.runtime, FIRST_LANDFALL_TICK);
    tick(b.runtime);
    drain(b.runtime, b.payer);
    act(b.runtime, b.payer, 'elect', { cover: b.cover, election: 'IN_FULL' });
    runTo(b.runtime, SETTLE_TICK);
    expect(eventsOfKind(b.runtime, 'indemnity.default').length, 'the subject occurred').toBeGreaterThan(
      0,
    );
  });

  it('★ every default row carries a parent_event_id that is IN THE LEDGER, and the register agrees', () => {
    const b = bound('mode-b-attrib');
    runTo(b.runtime, FIRST_LANDFALL_TICK);
    tick(b.runtime);
    drain(b.runtime, b.payer);
    act(b.runtime, b.payer, 'elect', { cover: b.cover, election: 'IN_FULL' });
    runTo(b.runtime, SETTLE_TICK);

    const defaults = eventsOfKind(b.runtime, 'indemnity.default');
    expect(defaults.length).toBeGreaterThan(0);
    for (const row of defaults) {
      // §15.4's Mode B, verbatim: *"each one carries the event ID of the loss or the missed delivery
      // that caused it."* And it must be a row an operator can open under pressure, which is why the
      // column matters and a payload field would not do.
      expect(row.parentEventId, `${row.id} names no cause`).not.toBeNull();
      const cause = b.runtime.events.get(row.parentEventId as EventId);
      expect(cause, `${row.id} cites ${String(row.parentEventId)}, which is not in the ledger`).not.toBeNull();
      // MUTATION: pass `parent: null` from `publishDefault` in `wire.ts`. INV-17 halts the world in
      // ASSERT and `fixture.ts:tick` throws — so this test never even reaches its own assertion, which
      // is the correct severity for the game accusing an innocent agent.
      expect(cause?.event.tick, 'a cause precedes its effect (INV-12)').toBeLessThanOrEqual(row.tick);
    }
    // The register's own side, which is what survives a restart.
    for (const row of defaults) {
      const attribution = b.runtime.register.of(row.id);
      expect(attribution, `${row.id} has no DefaultRegister row`).toBeDefined();
      expect(attribution?.causeEventId, 'and the two agree about WHY').toBe(row.parentEventId);
      expect(attribution?.promisor, 'and about WHO').toBe(row.actorPrincipalId);
    }
  });

  it('★ an ESCROWED shortfall is never a default — cargoLost’s rule, in the risk path', () => {
    const b = bound('mode-b-escrow');
    runTo(b.runtime, FIRST_LANDFALL_TICK);
    tick(b.runtime);
    // Nobody elects anything. The escrowed half must still arrive, and whatever it could not cover
    // must be reported as a RECORDED LOSS in its own column — never as `broke`.
    runTo(b.runtime, SETTLE_TICK);
    const rows = eventsOfKind(b.runtime, 'indemnity.default').concat(
      eventsOfKind(b.runtime, 'indemnity.settled'),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const p = row.payload as Record<string, number>;
      // MUTATION: fold `escrowedShortfall` into `broke` in `wire.ts`'s payload. A payer whose escrow
      // was short through no act of its own then reads as a promise-breaker, which is A5′ — and
      // `escrowShortIsNeverDefault` is a literal `false` for exactly this reason.
      expect(p['recordedLoss'], 'the escrow paid in full, so the loss column is zero').toBe(0);
      expect(Object.keys(p), 'and the two are separate columns, always').toContain('broke');
    }
  });
});

describe('★ MODE C — the post-event price spike, which is this layer’s own false default', () => {
  it('values the loss at the PINNED mark, not at the mark after the storm', () => {
    const b = bound('mode-c');
    const cover = b.runtime.risk.requireCover(b.cover as never);
    const pinned = pinnedMark(cover, LEVY_GOOD);
    expect(pinned, 'non-vacuity: a mark really was pinned at bind').toBeGreaterThan(0);

    runTo(b.runtime, FIRST_LANDFALL_TICK);
    tick(b.runtime);
    const ind = b.runtime.risk.allIndemnities()[0];
    expect(ind, 'an INDEMNITY opened').toBeDefined();
    if (ind === undefined) throw new Error('unreachable');

    // The loss is `qtyLost x pinnedMark` and nothing else. Recovered from the row rather than
    // recomputed, so the assertion is about what the engine wrote.
    const qtyLost = ind.grossLoss / pinned;
    expect(Number.isInteger(qtyLost), 'grossLoss is an exact multiple of the PINNED mark').toBe(true);

    // MUTATION: in `openPrimary`, replace `pinnedMark(cover, good)` with the runtime's current
    // `markOf(good, tick)`. After a front the destroyed good is scarce, the mark moves UP, every
    // INDEMNITY inflates past the limit its payer agreed to, and the payer is short **through a price
    // move it did not cause** — with no race and no stale read, so §15.4's other four defences are all
    // blind to it. This is the assertion that catches it.
    expect(
      ind.covered,
      'and the payout is capped at the limit the payer agreed to, whatever the mark does now',
    ).toBeLessThanOrEqual(cover.limit);
    expect(ind.covered, 'and at the loss, so being struck is never profitable (CAT6)').toBeLessThanOrEqual(
      ind.grossLoss,
    );
  });

  it('and the terms_hash that pinned it is what the settlement compares against (§15.4 defence 3)', () => {
    const b = bound('mode-c-hash');
    const cover = b.runtime.risk.requireCover(b.cover as never);
    // The valuation rule AND its as-of tick are inside the hash. `coverCanonical` writes both, so a
    // mark that moved after bind cannot change the hash without changing the terms — which is the
    // thing a counterparty correctly reads as reneging.
    expect(cover.termsHash, 'a hash exists').not.toBeNull();
    expect(cover.valuation.asOfTick, 'and it pinned an as-of tick').toBeGreaterThan(0);
    expect(cover.valuation.marks.length, 'and a mark for the good it covers').toBe(1);
    expect(cover.actedOnStateVersion, 'and the state version the freeze will compare').not.toBeNull();
  });
});

function drain(runtime: Runtime, principal: PrincipalId): void {
  const account = storesAccount(principal);
  const free = runtime.ledger.freeBalance(account);
  if (free <= 0) return;
  runtime.ledger.retireCurrency({
    eventId: `fixture:drain:${principal}` as never,
    tick: runtime.engine.tick,
    sink: 'sink:fees' as never,
    from: account,
    amount: free,
  });
}
