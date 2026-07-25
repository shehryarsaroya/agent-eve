/**
 * The election, and why it needs a way to say **"in full"** rather than a number.
 *
 * §7.1 gives a signing party exactly one figure: the server-computed
 * `your_take_at_p50` it must echo. On a `share` role that figure is a *forecast* — the
 * elective part is only known once the seeded residual is drawn at resolution — so a
 * payer that elects the number it countersigned has elected the p50 and nothing else.
 *
 * The first build capped every election at `electiveDue` and had no other shape, so a
 * venture that **over-performed** turned that payer into a `DECLINED` default for the
 * difference. `DECLINED` means a deliberate refusal, and the payer had paid every unit
 * it was ever shown: that is A5' — the record mis-characterising a kept promise as a
 * refusal — and the only escape was to over-elect an arbitrary large number that
 * nothing documented.
 *
 * {@link IN_FULL} is the election that expresses the intention instead of guessing the
 * amount. It is still an *election*: absent, nothing is paid (PROP-V4).
 */

import { describe, expect, it } from 'vitest';
import { bps, minor, type Minor } from '../../src/core/units.js';
import {
  IN_FULL,
  SettlementHalt,
  checkSettlementExact,
  computeClaims,
  settleVenture,
  yourTakeAtP50,
  type Election,
  type SettleInput,
  type VentureRecord,
} from '../../src/venture/index.js';
import {
  ACCOUNTS,
  ALICE,
  BRAM,
  DOV,
  STATE_VERSION,
  balance,
  ev,
  fixture,
  goLive,
  makeHaul,
  presenceOf,
  share,
  vid,
  wage,
} from './fixture.js';

/** HAUL at a full fill and a neutral stage: p50 = 12_000, p90 = 13_800. */
const P50 = minor(12_000);
const P90 = minor(13_800);

function inp(
  venture: VentureRecord,
  proceeds: Minor,
  elections: ReadonlyMap<number, Election>,
  overrides: Partial<SettleInput> = {},
): SettleInput {
  return {
    venture,
    tick: 287,
    eventId: ev(`settle:${venture.id}`),
    outcome: 'FULFILLED',
    proceeds,
    elections,
    actedOnStateVersion: STATE_VERSION,
    causeEventId: null,
    ...overrides,
  };
}

describe('IN_FULL — the election that names an intention, not a number', () => {
  it('honours a share role in full when the venture over-performs', () => {
    const f = fixture();
    const haul = makeHaul(f, { carrier: wage(800, 400), escort: share(bps(3_000), 0, 900) });
    goLive(f, haul, [ALICE, BRAM], P90);
    const before = balance(f, BRAM);

    const s = settleVenture(
      f.ledger,
      f.book,
      inp(haul, P90, new Map<number, Election>([[0, IN_FULL], [1, IN_FULL]])),
      ACCOUNTS,
      presenceOf(f),
    );
    const escort = s.payouts[1];
    if (escort === undefined) throw new Error('no escort payout');
    // The elective part at p90 is strictly larger than the p50 the payer countersigned.
    expect(escort.electiveDue).toBeGreaterThan(
      computeClaims(haul, P50).roles[1]?.electiveDue ?? 0,
    );
    expect(escort.electivePaid).toBe(escort.electiveDue);
    expect(escort.electiveShortfall).toBe(0);
    expect(s.defaults).toEqual([]);
    expect(s.terminalState).toBe('SETTLED');
    expect(balance(f, BRAM) - before).toBe(escort.claim);
    expect(checkSettlementExact(s, 287)).toEqual([]);
  });

  it('is what an agent electing only its countersigned p50 would otherwise be punished for', () => {
    // The same venture, the same over-performance, electing the exact figure §7.1 gave
    // it. This is the DECLINED default the record used to fabricate; it is *still* a
    // decline, because the payer named an amount — which is why IN_FULL has to exist.
    const f = fixture();
    const haul = makeHaul(f, { carrier: wage(800, 400), escort: share(bps(3_000), 0, 900) });
    goLive(f, haul, [ALICE, BRAM], P90);
    const quotedP50 = yourTakeAtP50(haul, BRAM);
    const atP50 = computeClaims(haul, P50).roles[1];
    if (atP50 === undefined) throw new Error('no escort claim');
    expect(atP50.claim).toBe(quotedP50);

    const named = settleVenture(
      f.ledger,
      f.book,
      inp(haul, P90, new Map<number, Election>([[0, IN_FULL], [1, atP50.electiveDue]])),
      ACCOUNTS,
      presenceOf(f),
    );
    expect(named.defaults.map((d) => d.cause)).toEqual(['DECLINED']);

    // IN_FULL, on an identical world, records nothing against the payer.
    const g = fixture();
    const same = makeHaul(g, { carrier: wage(800, 400), escort: share(bps(3_000), 0, 900) });
    goLive(g, same, [ALICE, BRAM], P90);
    const inFull = settleVenture(
      g.ledger,
      g.book,
      inp(same, P90, new Map<number, Election>([[0, IN_FULL], [1, IN_FULL]])),
      ACCOUNTS,
      presenceOf(g),
    );
    expect(inFull.defaults).toEqual([]);
  });

  it('pays nothing more than the elective part, even when the venture under-performs', () => {
    const f = fixture();
    const haul = makeHaul(f, { carrier: wage(800, 400), escort: share(bps(3_000), 0, 900) });
    goLive(f, haul, [ALICE, BRAM], minor(6_000));
    const before = balance(f, BRAM);
    const s = settleVenture(
      f.ledger,
      f.book,
      inp(haul, minor(6_000), new Map<number, Election>([[0, IN_FULL], [1, IN_FULL]])),
      ACCOUNTS,
      presenceOf(f),
    );
    const escort = s.payouts[1];
    if (escort === undefined) throw new Error('no escort payout');
    expect(escort.electivePaid).toBe(escort.electiveDue);
    // IN_FULL is "the elective part", never "as much as I can spare".
    expect(escort.electivePaid).toBeLessThanOrEqual(escort.claim);
    expect(balance(f, BRAM) - before).toBe(escort.claim);
  });

  it('is UNFUNDED rather than DECLINED when the payer elects in full and cannot pay', () => {
    // The distinction the record has to make: a payer that meant to pay and had nothing
    // is a different story from one that refused, and IN_FULL states the intention
    // unambiguously.
    const f = fixture(minor(800));
    const haul = makeHaul(f, { carrier: wage(800, 400), escort: share(bps(3_000), 0, 500) });
    goLive(f, haul, [DOV, BRAM], minor(0));
    const s = settleVenture(
      f.ledger,
      f.book,
      inp(haul, minor(0), new Map<number, Election>([[0, IN_FULL], [1, IN_FULL]]), {
        proceeds: minor(0),
      }),
      ACCOUNTS,
      presenceOf(f),
    );
    const causes = new Set(s.defaults.map((d) => d.cause));
    expect(causes.has('UNFUNDED')).toBe(true);
    expect(causes.has('DECLINED')).toBe(false);
  });

  it('pays nothing for a role with no entry at all (PROP-V4 still holds)', () => {
    const f = fixture();
    const haul = makeHaul(f, { carrier: wage(800, 400), escort: share(bps(3_000), 0, 900) });
    goLive(f, haul, [ALICE, BRAM], P50);
    const before = balance(f, BRAM);
    const s = settleVenture(
      f.ledger,
      f.book,
      inp(haul, P50, new Map<number, Election>([[0, IN_FULL]])),
      ACCOUNTS,
      presenceOf(f),
    );
    // The escort has no entry, so nothing elective moves — and its escrowed part is 0.
    expect(s.payouts[1]?.electivePaid).toBe(0);
    expect(balance(f, BRAM) - before).toBe(0);
    expect(s.defaults.map((d) => d.cause)).toEqual(['DECLINED']);
  });

  it('refuses an election that is neither IN_FULL nor a non-negative whole amount', () => {
    const f = fixture();
    const haul = makeHaul(f, { id: vid('v-bad') });
    goLive(f, haul, [ALICE, BRAM], P50);
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect(() =>
        settleVenture(
          f.ledger,
          f.book,
          inp(haul, P50, new Map<number, Election>([[1, bad as Minor]])),
          ACCOUNTS,
          presenceOf(f),
        ),
      ).toThrow(SettlementHalt);
    }
  });
});
