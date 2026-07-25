/**
 * PROP-V3 — `your_take_at_p50` echoed at signing matches what the waterfall actually
 * produces at p50, for random configurations. **The consequence-preview field is
 * itself under test.**
 *
 * The reason this is a property and not a spot check: §7.1's failure is an agent
 * signing believing one thing while the engine recorded another, and it was
 * "invisible to unit tests". A number that is right for the cases somebody thought of
 * is exactly the shape of that bug.
 */

import { describe, expect, it } from 'vitest';
import { bps, minor, type Minor } from '../../src/core/units.js';
import {
  PERCENTILES,
  computeProceeds,
  countersign,
  projectedSettlement,
  referenceSplit,
  residualAtPercentile,
  settleVenture,
  takeAtPercentile,
  ventureEscrowRatioBps,
  yourTakeAtP50,
  type Percentile,
} from '../../src/venture/index.js';
import {
  ACCOUNTS,
  ALICE,
  BRAM,
  CASS,
  DOV,
  ESK,
  STATE_VERSION,
  ev,
  fill,
  fixture,
  goLive,
  makeHaul,
  makeTopYield,
  rngFor,
  share,
  vid,
  wage,
} from './fixture.js';

/** Proceeds at a percentile, with every role filled — the quote's own assumption. */
function proceedsAtFullFill(kind: 'HAUL' | 'BUILD', roleCount: number, percentile: Percentile): Minor {
  return computeProceeds({
    kind,
    filled: Array.from({ length: roleCount }, (_, i) => i),
    stageBps: bps(10_000),
    residualSignedBps: residualAtPercentile(kind, percentile),
  }).proceeds;
}

describe('PROP-V3 — the echoed p50 is what the waterfall pays at p50', () => {
  it('holds for 300 random configurations, through a real settlement', () => {
    const rng = rngFor('prop-v3');
    for (let i = 0; i < 300; i += 1) {
      const f = fixture();
      const carrierEscrowed = rng.range(0, 3_000);
      const carrierElective = Math.max(100, Math.ceil((carrierEscrowed + 1) / 3), rng.range(1, 3_000));
      const escortShare = bps(rng.range(1, 9_500));
      const escortEscrowed = rng.range(0, 2_000);
      const escortElective = Math.max(100, Math.ceil((escortEscrowed + 1) / 3), rng.range(1, 2_000));

      const haul = makeHaul(f, {
        id: vid(`v-${String(i)}`),
        carrier: wage(carrierEscrowed, carrierElective),
        escort: share(escortShare, escortEscrowed, escortElective),
      });

      // A quote names a *role holder*, so before anyone fills there is no take to
      // quote — asserted below, because "0" and "not applicable" must not read the
      // same to an agent that has not joined yet.
      const beforeFilling = [yourTakeAtP50(haul, ALICE), yourTakeAtP50(haul, BRAM)];

      const p50Proceeds = proceedsAtFullFill('HAUL', 2, 'p50');
      goLive(f, haul, [ALICE, BRAM], p50Proceeds);
      const quotedCarrier = yourTakeAtP50(haul, ALICE);
      const quotedEscort = yourTakeAtP50(haul, BRAM);

      const s = settleVenture(
        f.ledger,
        f.book,
        {
          venture: haul,
          tick: 200,
          eventId: ev(`settle:${haul.id}`),
          outcome: 'FULFILLED',
          proceeds: p50Proceeds,
          elections: new Map<number, Minor>(),
          stateVersion: STATE_VERSION,
          causeEventId: null,
        },
        ACCOUNTS,
      );

      // The claim the waterfall computed is the number the signer echoed. Not "close
      // to": equal, to the minor unit.
      expect(s.payouts[0]?.claim, `carrier @ ${i}`).toBe(quotedCarrier);
      expect(s.payouts[1]?.claim, `escort @ ${i}`).toBe(quotedEscort);
      // A principal holding no role has no take: the creator's residual is what is
      // left, not a take (§3 — one word, one concept).
      expect(beforeFilling).toEqual([0, 0]);
    }
  });

  it('breaks the take down into the guaranteed and the at-risk halves', () => {
    const f = fixture();
    const haul = makeHaul(f, { escort: share(bps(3_000), 500, 700) });
    goLive(f, haul, [ALICE, BRAM], proceedsAtFullFill('HAUL', 2, 'p50'));
    const forecast = takeAtPercentile(haul, BRAM, 'p50');
    expect(forecast).not.toBeNull();
    if (forecast === null) return;
    expect(forecast.escrowedPart + forecast.electivePart).toBe(forecast.take);
    // The escrowed part is capped by the pinned figure, not by the claim.
    expect(forecast.escrowedPart).toBeLessThanOrEqual(500);
    expect(forecast.escrowRatioBps).toBe(4_166);
    expect(forecast.isWage).toBe(false);
  });

  it('is monotonic across the percentile band for a share role', () => {
    const f = fixture();
    const haul = makeHaul(f, { escort: share(bps(5_000), 400, 600) });
    goLive(f, haul, [ALICE, BRAM], proceedsAtFullFill('HAUL', 2, 'p50'));
    const takes = PERCENTILES.map((p) => takeAtPercentile(haul, BRAM, p)?.take ?? 0);
    expect(takes[0]).toBeLessThan(takes[1] ?? 0);
    expect(takes[1]).toBeLessThan(takes[2] ?? 0);
  });

  it('is flat across the band for a wage role — a fixed claim does not move with output', () => {
    // The §7.1 distinction, visible in the preview: a wage is senior to the outcome.
    // If this ever varied, an agent reading a band on a wage would be reading a share.
    const f = fixture();
    const haul = makeHaul(f, { carrier: wage(1_000, 1_000) });
    goLive(f, haul, [ALICE, BRAM], proceedsAtFullFill('HAUL', 2, 'p50'));
    const takes = PERCENTILES.map((p) => takeAtPercentile(haul, ALICE, p)?.take ?? 0);
    expect(new Set(takes).size).toBe(1);
    expect(takes[0]).toBe(2_000);
  });

  it('refuses a signature whose echoed p50 disagrees with the server', () => {
    const f = fixture();
    const haul = makeHaul(f);
    fill(f, haul, 0, ALICE);
    fill(f, haul, 1, BRAM);
    const hash = haul.termsHash;
    if (hash === null) throw new Error('fixture');
    const server = yourTakeAtP50(haul, BRAM);

    const wrong = countersign(haul, BRAM, hash, minor(server + 1), server);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) {
      expect(wrong.invariant).toBe('PROP-V3');
      // The hint has to teach the distinction, because the mismatch means the agent's
      // mental model is wrong, not its arithmetic.
      expect(wrong.hint).toContain('wage is fixed');
    }
    expect(countersign(haul, BRAM, hash, server, server).ok).toBe(true);
  });

  it('refuses a signature on a foreign terms_hash', () => {
    const f = fixture();
    const a = makeHaul(f, { id: vid('v-a') });
    const b = makeHaul(f, { id: vid('v-b'), creator: BRAM });
    if (b.termsHash === null) throw new Error('fixture');
    const wrong = countersign(a, BRAM, b.termsHash, minor(0), minor(0));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.invariant).toBe('PROP-W1');
  });
});

describe('projected_settlement — "if this resolved now" (§7)', () => {
  it('quotes the venture as it stands, bottleneck and all', () => {
    const f = fixture();
    const haul = makeHaul(f);
    fill(f, haul, 1, BRAM);
    const projection = projectedSettlement(haul, 50);
    expect(projection.outcomeIfNow).toBe('PARTIAL_FILL');
    expect(projection.bottleneck?.label).toBe('CARRIER');
    expect(projection.parties).toHaveLength(1);
    expect(projection.parties[0]?.principal).toBe(BRAM);
    // A partial fill yields less, so the escort's p50 is below its full-fill quote.
    expect(projection.proceeds.p50).toBeLessThan(proceedsAtFullFill('HAUL', 2, 'p50'));
  });

  it('reports FULFILLED and no bottleneck at a full fill', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [ALICE, BRAM], proceedsAtFullFill('HAUL', 2, 'p50'));
    const projection = projectedSettlement(haul, 50);
    expect(projection.outcomeIfNow).toBe('FULFILLED');
    expect(projection.bottleneck).toBeNull();
    expect(projection.parties).toHaveLength(2);
  });

  it('publishes the escrow ratio and the value at risk (§7.5)', () => {
    const f = fixture();
    const haul = makeHaul(f, { carrier: wage(1_000, 1_000), escort: share(bps(3_000), 500, 700) });
    goLive(f, haul, [ALICE, BRAM], proceedsAtFullFill('HAUL', 2, 'p50'));
    const projection = projectedSettlement(haul, 50);
    // 1500 escrowed of 3200 pinned = 4687 bps.
    expect(projection.escrowRatioBps).toBe(4_687);
    expect(ventureEscrowRatioBps(haul)).toBe(4_687);
    // The at-risk figure is the sum of the elective halves at p50: the tail A7 prices.
    let expected = 0;
    for (const party of projection.parties) expected += party.electiveAtP50;
    expect(projection.atRiskAtP50).toBe(expected);
    expect(projection.atRiskAtP50).toBeGreaterThan(0);
  });

  it('shows a top-yield venture as entirely at risk', () => {
    const f = fixture();
    const build = makeTopYield(f, 'BUILD', vid('v-build'), ESK);
    goLive(f, build, [ALICE, BRAM, CASS, DOV], minor(40_000));
    const projection = projectedSettlement(build, 50);
    expect(projection.escrowRatioBps).toBe(0);
    for (const party of projection.parties) {
      expect(party.escrowedAtP50).toBe(0);
      expect(party.electiveAtP50).toBe(party.p50);
    }
  });

  it('accounts for every minor unit of proceeds between the parties and the creator', () => {
    const f = fixture();
    const haul = makeHaul(f, { carrier: share(bps(2_500), 300, 700), escort: share(bps(3_000), 300, 700) });
    goLive(f, haul, [ALICE, BRAM], proceedsAtFullFill('HAUL', 2, 'p50'));
    const projection = projectedSettlement(haul, 50);
    let total: number = projection.creatorResidualAtP50;
    for (const party of projection.parties) total += party.p50;
    expect(total).toBe(projection.proceeds.p50);
  });

  it('renders parties in role-index order, so a card looks the same twice', () => {
    const f = fixture();
    const build = makeTopYield(f, 'SIEGE', vid('v-siege'), ESK);
    goLive(f, build, [ALICE, BRAM, CASS, DOV], minor(60_000));
    const projection = projectedSettlement(build, 50);
    expect(projection.parties.map((p) => p.roleIndex)).toEqual([0, 1, 2, 3]);
  });
});

describe('reference_split — an anchor, never a recommendation (§7.3)', () => {
  it('is the kind s marginal output, not the negotiated terms', () => {
    const f = fixture();
    const haul = makeHaul(f, { escort: share(bps(1_000), 300, 700) });
    const reference = referenceSplit(haul);
    // HAUL's template is CARRIER 7000 / ESCORT 3000. The escort signed for 1000, so it
    // took 2000 points under reference — the readable signal §7.3 wants.
    expect(reference.map((r) => r.referenceBps)).toEqual([7_000, 3_000]);
    expect(reference[1]?.agreedBps).toBe(1_000);
    expect(reference[1]?.deviationBps).toBe(-2_000);
  });

  it('reports no deviation for a wage role, because the units differ', () => {
    const f = fixture();
    const haul = makeHaul(f, { carrier: wage(1_000, 1_000) });
    const reference = referenceSplit(haul);
    expect(reference[0]?.agreedBps).toBeNull();
    expect(reference[0]?.deviationBps).toBeNull();
  });

  it('does not move with stake, capital or standing', () => {
    // An anchor that took a side would be a recommendation. The function's only input
    // is the venture, so there is nothing to weight it by.
    const rich = fixture(minor(1_000_000_000));
    const poor = fixture(minor(1));
    const a = makeHaul(rich, { id: vid('v-x') });
    const b = makeHaul(poor, { id: vid('v-x') });
    expect(referenceSplit(a)).toEqual(referenceSplit(b));
  });
});
