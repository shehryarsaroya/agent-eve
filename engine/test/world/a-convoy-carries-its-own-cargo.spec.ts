/**
 * ★ A CONVOY CARRIES **ITS OWN** CARGO — the two halts `haul` could reach from the front door.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHAT THIS FILE IS FOR.** A blind probe playing a fresh turbo world stopped it at tick 35 hauling
 * `ration` to pay its Levy. Two independent defects, both on the only verb that moves goods between
 * systems, both reachable by any enrolled agent in its first minute, and both **world-wide halts**:
 *
 *   1. **`INV-W7`** — *"ration: hands carry 5000 but the lot table holds 0 in transit"*.
 *      `landArrivedCargo` reconciled a **per-hand** manifest against an **anonymous pool** of
 *      in-transit lots keyed `(account, good, destination)`, walking it in lot-id order until the
 *      arriving hand's total was covered. Lot ids do not partition by hand — a split lot is named
 *      after its *event* — and the walk lands **whole lots**, so it overshoots: it lands a second
 *      hand's cargo early and clears only the first hand's manifest.
 *   2. **`TICK-STAGE`** — `duplicate lot id lot:haul.split:<tick>:<parent>:0`. The split event id
 *      counted its index inside one action, so two hauls in one tick out of the same parent lot
 *      derived the same id; `splitLot` threw and the throw escaped the verb into `VALIDATE+LOCK`,
 *      which aborts the tick and PAUSES the shard.
 *
 * Production survived both **only because nothing exercised the feature** — no cast branch sends
 * `haul`, while the affordance offers it to real principals. That is this project's signature defect
 * (`CLAUDE.md` §3) turned into an availability bug, so the tests below are written the only way that
 * proves anything for this class: **they drive real `haul` actions through the engine and assert the
 * world does not halt.** Revert the fix and they fail with the halt above, by name.
 *
 * ── WHY THE TICK NUMBERS ARE 9 AND 10 AND NOT 2 AND 3 ────────────────────────
 *
 * Because the derived lot id embeds the tick as a **string**: `haul.split:10:…` sorts *before*
 * `haul.split:9:…`. Below tick 10 the id order happened to match the departure order and the pool
 * walk was accidentally exact — so the defect is invisible in any test that hauls in a world's first
 * few ticks, which is exactly why it reached a probe instead of CI. Two hauls at ticks 9 and 10 out
 * of the starter allotment alone are enough, with nothing planted and nothing mocked.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';

import { setSpeed } from '../../src/core/time.js';
import type { HandId, PrincipalId, SystemId } from '../../src/core/types.js';
import { qty } from '../../src/core/units.js';
import { storesAccount } from '../../src/ledger/index.js';
import { LEVY_GOOD, LEVY_STARTER_ALLOTMENT } from '../../src/levy/params.js';
import { Runtime, RULES_VERSION } from '../../src/sim/runtime.js';
import { checkCargoMirror } from '../../src/world/index.js';

const WHO = 'p:hauler' as PrincipalId;

interface Fixture {
  readonly rt: Runtime;
  readonly seat: SystemId;
  readonly next: SystemId;
  readonly hands: readonly HandId[];
}

/** A one-principal world with the starter allotment standing at its seat, and nothing else. */
function world(seed: string): Fixture {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const enrolment = rt.seat(WHO, 'hauler');
  rt.runTick();
  const seat = enrolment.holding.system;
  const lane = [...rt.world.map.lanes.values()].find((l) => l.a === seat || l.b === seat);
  expect(lane, 'the seeded map must give the seat a lane').toBeDefined();
  const next = (lane?.a === seat ? lane.b : lane?.a) as SystemId;
  const hands = [...rt.world.hands.values()]
    .filter((h) => h.principal === WHO)
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((h) => h.id);
  expect(hands.length, 'three hands, §17').toBe(3);
  return { rt, seat, next, hands };
}

let sequence = 0;

/** Submit one `haul` for the next tick and return the submit-time verdict. */
function submitHaul(f: Fixture, hand: HandId, amount: number): { ok: boolean; hint: string } {
  sequence += 1;
  const out = f.rt.engine.submit({
    principal: WHO,
    clientSequence: sequence,
    verb: 'haul',
    params: { hand, to: f.next, good: LEVY_GOOD, qty: amount },
  } as never);
  return { ok: out.ok, hint: out.ok ? '' : out.hint };
}

/** Run one tick and fail loudly, naming the invariant, if it halted. */
function tickOrExplain(f: Fixture): void {
  const report = f.rt.runTick();
  const why = (report.violations ?? []).map((v) => `${v.id}: ${v.message}`).join(' | ');
  expect(report.halted, `the world HALTED at tick ${String(report.tick)} — ${why}`).toBe(false);
}

/** Advance to the tick *before* `target`, so the next submission lands at `target`. */
function walkTo(f: Fixture, target: number): void {
  expect(f.rt.engine.tick, 'the fixture is already past this tick').toBeLessThan(target);
  while (f.rt.engine.tick < target - 1) tickOrExplain(f);
}

/** `Σ hand.cargo` and `Σ in-transit lots`, per good — INV-W7's two halves, read directly. */
function mirror(f: Fixture): { readonly manifest: number; readonly lots: number } {
  let manifest = 0;
  for (const hand of f.rt.world.hands.values()) {
    for (const amount of hand.cargo.values()) manifest += amount;
  }
  let lots = 0;
  for (const lot of f.rt.ledger.allLots()) {
    if (lot.state === 'IN_TRANSIT') lots += lot.qty;
  }
  return { manifest, lots };
}

describe('the manifest and the ledger are the same quantity and they agree', () => {
  it('★ TWO HAULS ONE TICK APART DO NOT HALT THE WORLD (INV-W7, the probe\'s halt)', () => {
    // ══════════════════════════════════════════════════════════════════════
    // THE REGRESSION. Front door only: enrol, then two hauls of different sizes on consecutive
    // ticks out of the one starter-allotment lot. Under the pooled landing this HALTS at tick 12
    // with `INV-W7 ration: hands carry 6000 but the lot table holds 5000 in transit`, because the
    // first hand to arrive lands the *second* hand's 6,000-unit lot (its id sorts first — "10" <
    // "9") and clears only its own 5,000 from the manifest.
    //
    // MUTATION: put `inTransitTo(principal, destination, good)` back in place of `carriedBy(hand,
    // good)` in `landArrivedCargo`. RED here, and the live shard stops on the first agent that
    // hauls twice.
    // ══════════════════════════════════════════════════════════════════════
    const f = world('convoy-inv-w7');

    walkTo(f, 9);
    expect(submitHaul(f, f.hands[0] as HandId, 5_000).hint, 'first haul refused').toBe('');
    tickOrExplain(f);
    expect(f.rt.engine.tick).toBe(9);

    expect(submitHaul(f, f.hands[1] as HandId, 6_000).hint, 'second haul refused').toBe('');
    tickOrExplain(f);
    expect(f.rt.engine.tick).toBe(10);

    // Both convoys are on the lane and the mirror is exact while they travel.
    const flying = mirror(f);
    expect(flying.manifest, 'both hands are carrying').toBe(11_000);
    expect(flying.lots, 'and the ledger holds exactly that in transit').toBe(11_000);

    // ── THE ARRIVAL WINDOW, WHICH IS WHERE IT USED TO STOP ──────────────────
    for (let i = 0; i < 12; i += 1) tickOrExplain(f);

    const landed = mirror(f);
    expect(landed.manifest, 'every manifest is cleared once its convoy lands').toBe(0);
    expect(landed.lots, 'and nothing is stranded in transit').toBe(0);

    // Nothing was created or destroyed by the trip: the allotment is intact, now at two places.
    let atSeat = 0;
    let atNext = 0;
    for (const lot of f.rt.ledger.lotsInAccount(storesAccount(WHO))) {
      if (lot.good !== LEVY_GOOD) continue;
      if (lot.location === f.seat) atSeat += lot.qty;
      if (lot.location === f.next) atNext += lot.qty;
    }
    expect(atNext, 'both convoys delivered, in full').toBe(11_000);
    expect(atSeat + atNext, 'and no units were invented or lost on the way').toBe(
      Number(LEVY_STARTER_ALLOTMENT),
    );
  }, 60_000);

  it('★ TWO HAULS IN ONE TICK OUT OF ONE LOT DO NOT HALT THE WORLD (the split-id collision)', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The cheaper of the two halts, and the likelier: enrolment issues ONE 50,000-unit allotment
    // lot and THREE hands, so "send two hands out at once" is the obvious first move. Both hauls
    // split the same parent, both derived `lot:haul.split:<tick>:<parent>:0`, and `splitLot` threw
    // `duplicate lot id` **out of the verb** — which in `VALIDATE+LOCK` is not a refusal but an
    // aborted tick and a PAUSED world.
    //
    // MUTATION, both halves measured. Drop the hand from the split event id in `Runtime.haulPort`
    // and this goes RED on the manifest total (5,000 not 12,000) — the second haul is *refused*,
    // because `haul` now catches the throw. Drop the `try`/`catch` in `haul` as well, which is the
    // original code byte for byte, and it goes RED with the halt itself:
    //
    //   `the world HALTED at tick 9 — TICK-STAGE: phase VALIDATE+LOCK threw:
    //    duplicate lot id lot:haul.split:9:lot:enrol.goods:p:hauler:0`
    //
    // Both are needed and they are two different fixes: the unique id is what makes the haul
    // *succeed*, and the catch is what stops any future refusal in that loop from being a halt.
    // ══════════════════════════════════════════════════════════════════════
    const f = world('convoy-split-id');
    walkTo(f, 9);
    expect(submitHaul(f, f.hands[0] as HandId, 5_000).hint, 'first haul refused').toBe('');
    expect(submitHaul(f, f.hands[1] as HandId, 7_000).hint, 'second haul refused').toBe('');
    tickOrExplain(f);

    const flying = mirror(f);
    expect(flying.manifest, 'both hands left in the same tick').toBe(12_000);
    expect(flying.lots).toBe(12_000);
    // Three lots now: the two that departed and the remainder standing at the seat.
    expect(
      f.rt.ledger.lotsInAccount(storesAccount(WHO)).filter((l) => l.good === LEVY_GOOD).length,
    ).toBe(3);

    for (let i = 0; i < 12; i += 1) tickOrExplain(f);
    expect(mirror(f), 'and both land cleanly').toEqual({ manifest: 0, lots: 0 });
  }, 60_000);

  it('a landing retires the LANDING hand\'s lots and leaves the other convoy alone', () => {
    // The property the quantity check cannot see. Under the pooled landing the arithmetic could
    // balance for a tick while the units sat on the wrong hand — so this names the lots.
    //
    // MUTATION: make `carriedBy` ignore its `hand` argument and return every in-transit lot of the
    // good. RED here, and RED on the per-hand half of INV-W7.
    const f = world('convoy-provenance');
    walkTo(f, 9);
    expect(submitHaul(f, f.hands[0] as HandId, 5_000).hint).toBe('');
    tickOrExplain(f);
    expect(submitHaul(f, f.hands[1] as HandId, 6_000).hint).toBe('');
    tickOrExplain(f);

    const carriedBy = (hand: HandId): readonly string[] =>
      f.rt.ledger
        .lotsCarriedBy(hand)
        .map((l) => String(l.id))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const first = carriedBy(f.hands[0] as HandId);
    const second = carriedBy(f.hands[1] as HandId);
    expect(first.length, 'the first convoy owns its lots').toBeGreaterThan(0);
    expect(second.length, 'and so does the second').toBeGreaterThan(0);
    expect(
      first.filter((id) => second.includes(id)),
      'no lot is carried by two hands',
    ).toEqual([]);

    // Walk until the first hand has landed and the second has not.
    let guard = 0;
    while (carriedBy(f.hands[0] as HandId).length > 0 && guard < 12) {
      tickOrExplain(f);
      guard += 1;
    }
    expect(guard, 'the first convoy must actually arrive').toBeLessThan(12);
    expect(
      carriedBy(f.hands[1] as HandId),
      'the second convoy still holds exactly the lots it departed with',
    ).toEqual(second);
    expect(mirror(f), 'and the mirror is exact at that instant, per hand and per good').toEqual({
      manifest: 6_000,
      lots: 6_000,
    });
  }, 60_000);

  it('★ THE LANDING REACHES THE RECORD — every arrival writes a `haul.landed` row', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // THE THIRD DEFECT, AND THE ONLY ONE THAT BROKE NOTHING.
    //
    // `haul.landed` was emitted `SENSED` with `declassifyAt: ctx.tick` and `publicAt: null`, which
    // violates that tier twice — `STRICTLY_LATER` declassifying at birth, and a `fullOnDeclassify`
    // tier with a null `publicAt`. `visibilityFaultsAtBirth` therefore refused **every row the verb
    // has ever emitted**, and `flushRecord` records a refusal as a `faults` string rather than a halt.
    //
    // So the cargo landed, the manifest cleared, INV-W7 stayed green, the world never halted, and the
    // record said nothing at all. Nine landings in a 3-Reckoning heuristic world (`g01`) produced
    // nine faults and zero rows. Nothing in the suite could see it because everything in the suite
    // asserts on *state*, and the state was right the whole time.
    //
    // MUTATION: restore `publicAt: null, declassifyAt: ctx.tick`. RED on `landed` (0, not 1) and RED
    // on `faults` — which is the assertion that matters, because a silent record is the failure mode.
    // ══════════════════════════════════════════════════════════════════════════
    const f = world('convoy-record');
    walkTo(f, 9);
    expect(submitHaul(f, f.hands[0] as HandId, 5_000).hint).toBe('');
    tickOrExplain(f);

    let guard = 0;
    while (f.rt.ledger.lotsCarriedBy(f.hands[0] as HandId).length > 0 && guard < 12) {
      tickOrExplain(f);
      guard += 1;
    }
    expect(guard, 'the convoy must actually arrive').toBeLessThan(12);

    const rows = f.rt.events
      .ticks()
      .flatMap((t) => f.rt.events.eventsAtTick(t))
      .filter((r) => r.event.kind === 'haul.landed' || r.event.kind === 'haul.departed');
    const departed = rows.filter((r) => r.event.kind === 'haul.departed');
    const landed = rows.filter((r) => r.event.kind === 'haul.landed');
    expect(departed.length, 'one departure').toBe(1);
    expect(landed.length, 'and one landing — the record must hold BOTH halves of the journey').toBe(
      1,
    );

    // The refusal path, asserted directly: a row the record rejects is a fault, and a run that
    // published every row it meant to publish has none. This is the half a state assertion misses.
    const faults = (f.rt as unknown as { readonly faults: { readonly all: readonly string[] } })
      .faults.all;
    expect(
      faults.filter((s) => s.includes('haul')),
      'the record refused nothing',
    ).toEqual([]);

    // §11.2: `SENSED` is "whoever has a hand in range or bought the intel; everyone AFTER THE
    // RECKONING IT MATTERED IN" — so the row declassifies strictly later, at the Reckoning boundary,
    // and to FULL. Pinning both halves stops a future edit from "fixing" the refusal by demoting the
    // manifest to `PUBLIC`, which would hand every viewer a cargo list and delete the reason
    // reconnaissance is worth paying for.
    const row = landed[0];
    expect(row?.visibility, 'the manifest is SENSED, never PUBLIC').toBe('SENSED');
    expect(row?.event.isPublic).toBe(false);
    expect(
      row?.event.declassifyAt ?? 0,
      'declassifies strictly later than the tick it happened on',
    ).toBeGreaterThan(row?.event.tick ?? 0);
    expect(row?.event.publicAt, 'and it declassifies to FULL, so the two ticks agree').toBe(
      row?.event.declassifyAt,
    );
    expect(row?.event.payload, 'the landed quantity is what the LEDGER moved').toMatchObject({
      good: LEVY_GOOD,
      qty: 5_000,
    });
  }, 60_000);

  it('every IN_TRANSIT lot has a carrier and every carrier is in transit', () => {
    // `Lot.carrier`'s contract, asserted rather than documented — this is what makes a future sink
    // that lands a lot without clearing the carrier halt instead of quietly re-pooling it.
    const f = world('convoy-carrier-contract');
    walkTo(f, 9);
    expect(submitHaul(f, f.hands[0] as HandId, 5_000).hint).toBe('');
    tickOrExplain(f);
    expect(submitHaul(f, f.hands[2] as HandId, 4_000).hint).toBe('');
    tickOrExplain(f);

    let inTransit = 0;
    for (const lot of f.rt.ledger.allLots()) {
      if (lot.state === 'IN_TRANSIT') {
        inTransit += 1;
        expect(lot.carrier, `in-transit lot ${lot.id} has no carrier`).not.toBeNull();
      } else {
        expect(lot.carrier, `standing lot ${lot.id} still names a carrier`).toBeNull();
      }
    }
    expect(inTransit, 'non-vacuity: there must be lots in transit to check').toBeGreaterThan(0);

    // And the invariant the tick runs agrees, on the real world rather than a constructed one.
    expect(
      checkCargoMirror({
        state: f.rt.world,
        inTransit: f.rt.ledger
          .lotsInTransit()
          .map((l) => ({ id: l.id, good: l.good, qty: l.qty, carrier: l.carrier })),
        tick: f.rt.engine.tick,
      }),
    ).toEqual([]);

    for (let i = 0; i < 12; i += 1) tickOrExplain(f);
    for (const lot of f.rt.ledger.allLots()) {
      expect(lot.carrier, `lot ${lot.id} is standing still and must name no carrier`).toBeNull();
    }
  }, 60_000);

  it('a haul REFUSES rather than throwing, because a throw in a verb halts the world', () => {
    // The structural half. `port.split` reaches `Ledger.splitLot`, which throws on a pledged lot,
    // on a whole-lot split and on a duplicate id — and verbs run inside `VALIDATE+LOCK`, so a
    // throw is not a refusal, it is a PAUSED shard. `haul` now plans its splits before it writes
    // anything, and every planned split is one the ledger has already been shown to accept.
    //
    // MUTATION: remove the `try`/`catch` around `port.split` in `haul`. This test stays green
    // (nothing reachable throws any more) but `two hauls in one tick` above goes RED, which is the
    // pair working as intended: the catch is the floor, the id is the fix.
    const f = world('convoy-refusals');
    walkTo(f, 9);

    // Over the declared cap, and over what is standing here. Both are REFUSALS on the merits, which
    // is the distinction that matters: `refused` rises, `halted` stays false, and the mirror stays
    // at zero because nothing moved.
    submitHaul(f, f.hands[0] as HandId, 20_001);
    submitHaul(f, f.hands[1] as HandId, Number(LEVY_STARTER_ALLOTMENT) + 1);
    const report = f.rt.runTick();
    expect(report.halted, 'a refusable haul must never abort the tick').toBe(false);
    expect(report.refused, 'both must be refused on the merits, not applied').toBe(2);
    expect(report.applied, 'and neither may apply').toBe(0);
    expect(mirror(f), 'a refusal moves nothing, so the mirror is still empty').toEqual({
      manifest: 0,
      lots: 0,
    });

    // And the largest legal trip still works, end to end.
    expect(submitHaul(f, f.hands[0] as HandId, 20_000).ok).toBe(true);
    tickOrExplain(f);
    expect(mirror(f)).toEqual({ manifest: 20_000, lots: 20_000 });
    for (let i = 0; i < 12; i += 1) tickOrExplain(f);
    expect(mirror(f)).toEqual({ manifest: 0, lots: 0 });
  }, 60_000);

  it('the carrier is a CAPTURED field, so the rules version moved with it', () => {
    // `RULES_VERSION` 25. The lot rows inside `ledgerStateTable.capture()` carry one more key, so a
    // journal written under 24 cannot be replayed under this build — declared here rather than
    // discovered at boot. `hydrate.ts` refuses on `RULES_VERSION_MISMATCH` first either way.
    expect(RULES_VERSION).toBeGreaterThanOrEqual(25);
    const f = world('convoy-capture');
    walkTo(f, 9);
    expect(submitHaul(f, f.hands[0] as HandId, 5_000).hint).toBe('');
    tickOrExplain(f);
    const withCargo = f.rt.engine.stateHash;
    // Same world, same tick, cargo landed: the hash must have moved, or the field is not captured.
    for (let i = 0; i < 12; i += 1) tickOrExplain(f);
    expect(f.rt.engine.stateHash, 'a world whose convoy has landed is a different world').not.toBe(
      withCargo,
    );
    // And the mirror the hash now covers is the one INV-W7 asserts.
    expect(mirror(f)).toEqual({ manifest: qty(0), lots: qty(0) });
  }, 60_000);
});
