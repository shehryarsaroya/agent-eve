/**
 * A cast member's stance — how hard it leans on its creed this world — and the one draw that sets it.
 *
 * Its own module, and the reason is a module cycle rather than taste: `characters.ts` imports the
 * roster from `heuristic.ts` and checks it at module initialisation, so `heuristic.ts` importing
 * `characters.ts` back would hand that check an uninitialised `CAST_NAMES` whenever the heuristic
 * happened to be loaded first. The stance is the one fact both need, so it lives below both — one
 * home for the draw, and `characterOf` reads it from here.
 */

import { Rng } from '../core/rng.js';

/**
 * How hard a member leans on its creed this world.
 *
 * Four values, named rather than numeric, because they are printed into a prompt and
 * into the report an operator reads — and because a 0–3 integer in a prompt is a number
 * a model will invent its own meaning for.
 */
export type CastStance = 'PATIENT' | 'OPPORTUNIST' | 'ZEALOT' | 'MERCENARY';

export const CAST_STANCES: readonly CastStance[] = Object.freeze([
  'PATIENT',
  'OPPORTUNIST',
  'ZEALOT',
  'MERCENARY',
]);

/** The stance a handle is dealt in a seeded world. Its own sub-stream, so adding a name moves no other. */
export function stanceFor(handle: string, seed: string): CastStance | null {
  const draw = Rng.fromSeed(`${seed}:cast:stance:${handle}`).int(CAST_STANCES.length);
  return CAST_STANCES[draw] ?? null;
}
