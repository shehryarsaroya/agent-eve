/**
 * Builders for the seal suite.
 *
 * Deliberately thin. A helper that decided a verdict would be a second
 * implementation of `judge`, and the tests would then be checking the helper
 * against itself — which is how scar #1 survived three critic passes.
 */

import type { EventId, PrincipalId, Standing, VentureId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { Deed, SealIntent, SealMeasure, SealRoleRef } from '../../src/seal/index.js';

export function pid(name: string): PrincipalId {
  return name as PrincipalId;
}

export function vid(name: string): VentureId {
  return name as VentureId;
}

export function eid(name: string): EventId {
  return name as EventId;
}

export function role(venture: string, roleIndex = 0): SealRoleRef {
  return { venture: vid(venture), roleIndex };
}

/** First tick of a Reckoning. */
export function reckoningStart(r: number): number {
  return r * TICKS_PER_RECKONING;
}

/** The settlement tick of a Reckoning — where `resolve` must be called. */
export function settlement(r: number): number {
  return (r + 1) * TICKS_PER_RECKONING - 1;
}

export function intent(over: Partial<SealIntent> = {}): SealIntent {
  return {
    verb: 'haul',
    target: 'SYS-VEGA',
    measure: 'QTY',
    outcomeLow: 40,
    outcomeHigh: 60,
    ...over,
  };
}

export interface DeedOver {
  readonly principal?: PrincipalId;
  readonly tick?: number;
  readonly verb?: string;
  readonly target?: string;
  readonly measure?: SealMeasure;
  readonly outcome?: number;
  readonly valuedAtStateVersion?: number;
  readonly eventId?: EventId;
}

export function deed(over: DeedOver = {}): Deed {
  return {
    principal: over.principal ?? pid('P-A'),
    tick: over.tick ?? 150,
    verb: over.verb ?? 'haul',
    target: over.target ?? 'SYS-VEGA',
    measure: over.measure ?? 'QTY',
    outcome: over.outcome ?? 50,
    valuedAtStateVersion: over.valuedAtStateVersion ?? 150,
    eventId: over.eventId ?? eid('ev:150:0'),
  };
}

/**
 * A zeroed standing row.
 *
 * Lives in the test helpers on purpose: the authoritative `standing` table has no
 * owner module yet, and putting a constructor in `src/seal/` would make this the
 * second home for a row the standing module will own (scar #5).
 */
export function zeroStanding(principal: PrincipalId): Standing {
  return {
    principal,
    electiveHonoured: 0,
    electiveHonouredValue: minor(0),
    defaults: 0,
    contradictedSeals: 0,
    distinctCounterparties: 0,
    lastDefaultTick: null,
  };
}
