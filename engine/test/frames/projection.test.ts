/**
 * The frame's A9 boundary. See `src/frames/projection.ts`.
 */
import { describe, expect, it } from 'vitest';
import { assertInertPublicFacts, ProjectionError, PUBLIC_FACT_KEYS } from '../../src/frames/projection.js';
import { emptyFrame, type FrameSource } from '../../src/frames/render.js';
import { minor } from '../../src/core/units.js';
import type { PrincipalId, Handle } from '../../src/core/types.js';

function facts(over: Partial<FrameSource> = {}): FrameSource {
  return {
    reckoning: 1,
    tick: 287,
    stateHash: 'abc',
    settled: [],
    meters: { levyShort: minor(0), onAPromise: minor(0), kept: 0, broken: 0 },
    handles: new Map<PrincipalId, Handle>(),
    ticker: [],
    tomorrow: [],
    ...over,
  };
}

describe('the frame may only be built from admissible public facts', () => {
  it('accepts a projection of inert, tier-legal data', () => {
    expect(() => {
      assertInertPublicFacts(facts());
    }).not.toThrow();
  });

  it('REFUSES a field no §11.2 clause admits', () => {
    // The Charge "fuel gauge" the expansion critique killed was exactly this shape: a
    // frame field derived from a public recipe and a PRIVATE stockpile. It would now
    // have to be argued into PUBLIC_FACT_KEYS instead of just appearing on screen.
    const smuggled = { ...facts(), chargeReserveRemaining: 3 } as unknown as FrameSource;
    expect(() => {
      assertInertPublicFacts(smuggled);
    }).toThrow(ProjectionError);
    expect(() => {
      assertInertPublicFacts(smuggled);
    }).toThrow(/chargeReserveRemaining/);
  });

  it('REFUSES a projection still holding a handle to live state', () => {
    // The failure this file exists to make impossible: a "projection" that is really a
    // window onto the runtime. A getter or a bound method cannot canonicalise, so it is
    // refused rather than rendered.
    const live = {
      ...facts(),
      get settled(): never {
        throw new Error('should not be read');
      },
    } as unknown as FrameSource;
    // A live getter is not inert; either it throws on read or it fails to canonicalise.
    expect(() => {
      assertInertPublicFacts(live);
    }).toThrow();

    const withMethod = { ...facts(), ticker: [(): string => 'live'] } as unknown as FrameSource;
    expect(() => {
      assertInertPublicFacts(withMethod);
    }).toThrow(ProjectionError);
  });

  it('the real empty frame source passes, so the boundary is not vacuous', () => {
    // A guard that only ever sees hand-built objects proves nothing about production.
    expect(PUBLIC_FACT_KEYS.length).toBeGreaterThan(5);
    expect(emptyFrame(0, 0, 'h')).toBeDefined();
  });
});
