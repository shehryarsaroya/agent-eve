/**
 * The nonce store, bounded — scar #3 made executable.
 *
 * High Water's `/enroll` accumulated a row per request forever and serialised the
 * whole map every 1.5 s, so an attacker turned "remember this" into an OOM and a
 * disk DoS. A replay store is the same hazard with a sharper edge: its entire job
 * is to remember things an attacker chooses. So the assertions here are about
 * *ceilings*, not behaviour: `remembered ≤ capacity` and `bucketCount ≤ maxKeys`,
 * under adversarial input.
 *
 * The store is deliberately in wall-clock seconds. It protects the host, not the
 * world, so it must not become 300× looser when the tick becomes 300× shorter —
 * the same argument that whitelists `src/api/limits.ts` in the scale audit.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { BoundedReplayStore, IdentityError, wallSeconds } from '../../src/identity/index.js';
import type { WallSeconds } from '../../src/identity/index.js';

const T0: WallSeconds = wallSeconds(1_700_000_000);

function store(perKeyCap = 4, maxKeys = 3, retention = 60): BoundedReplayStore {
  return new BoundedReplayStore({
    retention: wallSeconds(retention),
    perKeyCap,
    maxKeys,
  });
}

describe('the replay store remembers, and forgets on purpose', () => {
  it('spends a nonce once', () => {
    const s = store();
    expect(s.spend('k1', 'n1', T0)).toBe('FRESH');
    expect(s.spend('k1', 'n1', T0)).toBe('REPLAYED');
  });

  it('keeps keys separate: the same nonce from two keys is two nonces', () => {
    const s = store();
    expect(s.spend('k1', 'n1', T0)).toBe('FRESH');
    expect(s.spend('k2', 'n1', T0)).toBe('FRESH');
  });

  it('remembers across one rotation, so the window is at least the retention', () => {
    const s = store(4, 3, 60);
    expect(s.spend('k1', 'n1', T0)).toBe('FRESH');
    // Just inside the first generation.
    expect(s.spend('k1', 'n1', wallSeconds(T0 + 59))).toBe('REPLAYED');
    // Rotated: 'n1' is now in `previous` and still refused.
    expect(s.spend('k1', 'n1', wallSeconds(T0 + 60))).toBe('REPLAYED');
    expect(s.spend('k1', 'n1', wallSeconds(T0 + 119))).toBe('REPLAYED');
    // Two full windows on: forgotten, which is safe only because a signature
    // that old is refused on age. `httpsig.test.ts` asserts that composition.
    expect(s.spend('k1', 'n1', wallSeconds(T0 + 200))).toBe('FRESH');
  });
});

describe('the store is bounded, whatever the traffic', () => {
  it('caps per key, so one principal cannot lock another out', () => {
    const s = store(2, 3);
    expect(s.spend('k1', 'a-nonce', T0)).toBe('FRESH');
    expect(s.spend('k1', 'b-nonce', T0)).toBe('FRESH');
    // k1 has spent its budget...
    expect(s.spend('k1', 'c-nonce', T0)).toBe('BUDGET_EXCEEDED');
    // ...and k2 is entirely unaffected. A global cap would have failed here, and
    // that is the cross-tenant denial of service the per-key cap exists to avoid.
    expect(s.spend('k2', 'c-nonce', T0)).toBe('FRESH');
  });

  it('caps the number of buckets', () => {
    const s = store(2, 3);
    for (const k of ['k1', 'k2', 'k3']) expect(s.spend(k, 'n', T0)).toBe('FRESH');
    expect(s.spend('k4', 'n', T0)).toBe('BUDGET_EXCEEDED');
    expect(s.bucketCount).toBe(3);
  });

  it('reclaims buckets that can no longer hold anything fresh', () => {
    const s = store(2, 3, 60);
    for (const k of ['k1', 'k2', 'k3']) s.spend(k, 'n', T0);
    expect(s.spend('k4', 'n', T0)).toBe('BUDGET_EXCEEDED');
    // Two retention windows later, k1..k3's generations cannot contain a nonce
    // whose signature is still fresh, so their buckets are dead weight.
    const later = wallSeconds(T0 + 121);
    expect(s.spend('k4', 'n', later)).toBe('FRESH');
    expect(s.bucketCount).toBeLessThanOrEqual(3);
  });

  it('never exceeds its stated capacity under adversarial input', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            key: fc.integer({ min: 0, max: 40 }),
            nonce: fc.integer({ min: 0, max: 200 }),
            skip: fc.integer({ min: 0, max: 200 }),
          }),
          { maxLength: 800 },
        ),
        (ops) => {
          const s = store(4, 3, 60);
          let now = T0;
          for (const op of ops) {
            now = wallSeconds(now + op.skip);
            s.spend(`k${op.key}`, `n${op.nonce}`, now);
            // The two claims the design makes, asserted every step rather than at
            // the end: a ceiling that only holds at quiescence is not a ceiling.
            expect(s.bucketCount).toBeLessThanOrEqual(3);
            expect(s.remembered).toBeLessThanOrEqual(s.capacity);
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it('states its own ceiling', () => {
    // maxKeys × perKeyCap × 2 generations. Written down so a change to the
    // eviction strategy has to change this number deliberately.
    expect(store(4, 3).capacity).toBe(24);
  });

  it('refuses limits that would make it useless', () => {
    expect(() => new BoundedReplayStore({ retention: wallSeconds(60), perKeyCap: 0, maxKeys: 4 })).toThrow(
      IdentityError,
    );
    expect(() => new BoundedReplayStore({ retention: wallSeconds(60), perKeyCap: 4, maxKeys: 0 })).toThrow(
      IdentityError,
    );
    expect(() => new BoundedReplayStore({ retention: wallSeconds(0), perKeyCap: 4, maxKeys: 4 })).toThrow(
      /nothing is remembered/,
    );
  });
});
