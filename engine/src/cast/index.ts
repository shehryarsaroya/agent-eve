/**
 * The house cast (SPEC §15.6).
 *
 * What the rest of the engine needs to know:
 *
 *   - **It is `HEURISTIC` and it says so.** Every action the cast submits carries
 *     `decision_source: 'HEURISTIC'`, which is what lets `GET /health` notice that
 *     the expensive path has stopped being taken (scar #14b). A cast that labelled
 *     itself `LIVE` would make that measurement permanently green.
 *   - **Every draw comes from `Rng`.** The cast runs inside the tick, so one
 *     unseeded draw makes the world unreplayable.
 *   - **Raiders are seated outside the Commons.** In the Commons a hostile act is
 *     invalid, not punished (A8), so a raider seated there could never act.
 *   - **It returns submissions; it never submits.** The caller owns ordering, which
 *     is what lets a test shuffle the list and prove arrival buys nothing (A4).
 */

export {
  CAST_NAMES,
  CAST_ROLES,
  DEFAULT_CREATE_CHANCE_BPS,
  HeuristicCast,
  MAX_CAST,
  type CastMember,
  type CastOptions,
  type CastRole,
} from './heuristic.js';
