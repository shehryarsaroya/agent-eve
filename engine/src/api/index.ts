/**
 * The HTTP surface.
 *
 * What the rest of the engine needs to know about this module:
 *
 *   - **An illegal action is not an error** (PROP-O7). `POST /act` answers 200 with
 *     the violated invariant, the changed fields, the nearest legal affordance and a
 *     fresh observation. Only a malformed *request* is a 4xx.
 *   - **A hint is not an event** (scar #10). Corrections are returned on the
 *     response and written to no ledger, ever.
 *   - **`limits.ts` is the one home of wall-clock time here**, and it is
 *     deliberately scale-invariant: it protects the host, not the game. It is
 *     whitelisted in the scale audit with that reason recorded.
 *   - **`observe` is memoised per `(principal, tick)`** and the wake budget is
 *     enforced on it, which is what makes A4 enforceable through the budget rather
 *     than only through the clock (§12.4).
 *   - **`GET /health` returns 503 when nothing is deciding.** That is scar #14b's
 *     fix and it is intentional: a green check on a world of zombies is the failure.
 */

export { buildHealth, DECIDING_FLOOR_BPS, HEALTH_WARMUP_TICKS, type HealthOptions, type HealthReport } from './health.js';

export {
  IdempotencyStore,
  MAX_KEYS_PER_PRINCIPAL,
  MAX_KEYS_TOTAL,
  MAX_KEY_LENGTH,
  type StoredOutcome,
} from './idempotency.js';

export {
  CLIENT_IP_HEADER,
  IP_REFUSAL,
  MAX_BODY_BYTES,
  MAX_TRACKED_CLIENTS,
  RATE_LIMITS,
  RateLimiter,
  REPLAY_STORE_LIMITS,
  clientAddress,
  type Allowance,
  type ClientAddress,
  type IpRefusal,
  type LimitVerdict,
  type RouteName,
} from './limits.js';

export {
  MAX_AFFORDANCES,
  MAX_LIST_ROWS,
  OBSERVE_KEYS,
  OFFERED_KINDS,
  QUOTE_PIN_TICKS,
  buildObservation,
  quoteId,
  quoteIsFresh,
  wakesRemainingFor,
  type Affordance,
  type ObserveInput,
  type Observation,
  type Withheld,
} from './observe.js';

export {
  DEFAULT_SEATS,
  HANDLE_GRAMMAR,
  IDLE_SEAT_TICKS,
  MAX_HANDLE_LENGTH,
  SeatBook,
  type Seat,
  type SeatGrant,
  type SeatRefusal,
} from './seats.js';

export {
  API_BASE_PATH,
  MAX_ACTIONS_PER_BATCH,
  MAX_DISCREPANCIES,
  createApp,
  nearestLegal,
  type ApiContext,
  type ApiOptions,
  type CreatedApp,
  type DiscrepancyReport,
} from './server.js';

export {
  CANON_VERBS,
  FREE_SERVICES,
  VERB_ARRIVES_AT,
  classifyVerb,
  isCanonVerb,
  unbuiltVerbs,
  type VerbVerdict,
} from './verbs.js';

export {
  MAX_BODY_DEPTH,
  MAX_DETAIL_LENGTH,
  WIRE_REASON,
  parseBody,
  readIntField,
  readStringField,
  refusal,
  scrub,
  type ParsedBody,
  type WireReason,
  type WireRefusal,
} from './wire.js';
