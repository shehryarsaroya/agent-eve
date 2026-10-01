/**
 * Follow by email — anyone may follow any principal by handle and receive one short email
 * after each Reckoning telling that principal's story, from the PUBLIC record only.
 *
 * What the rest of the engine needs to know about this module:
 *
 *   - **It is not part of the world.** Nothing under `src/persist`, `src/sim`, `src/tick`,
 *     `src/frames` or `src/ledger` imports it, the runtime never holds a handle to it, and its
 *     tables are private and deletable (`schema.sql`, migration 002). `state_hash` and replay
 *     are the same with it on or off — `test/follow/the-record-is-untouched.spec.ts`.
 *   - **It reads published frames, not the runtime** (`recap.ts`), so A9 holds by what it is
 *     given rather than by review.
 *   - **It is off until two variables are set** — `RESEND_API_KEY` and
 *     `COMPACT_FOLLOW_SECRET` — and off is a clear 503, never a crash (`setup.ts`).
 *   - **It is not the DISPATCH** (SPEC §3: the letter an AGENT emails its OWNER). It is the
 *     house's recap of the public record to whoever asked, which is §15.7's Gazette scoped to
 *     one principal. Calling it a dispatch would put one canon word on two concepts.
 */

export { normaliseEmail, IDENTITY_LABEL_DOMAINS, MAX_EMAIL_LENGTH, type AddressVerdict } from './email.js';
export { escapeHtml, renderPage, PAGE_HEADERS, type PageContent } from './html.js';
export {
  MAIL_REDACTED,
  MailError,
  RESEND_EMAILS_URL,
  describeMailFailure,
  mailKeyPresent,
  pacedMailer,
  redactMailSecrets,
  resendMailer,
  type MailReceipt,
  type Mailer,
  type OutboundMail,
} from './mailer.js';
export { PgFollowStore } from './postgres.js';
export { buildRecap, fmt, MAX_RECAP_AHEAD, MAX_RECAP_EVENTS, type Recap, type RecapInput, type RecapTone } from './recap.js';
export { composeConfirmation, composeRecap, followLinks, type ComposedMail, type FollowLinks } from './compose.js';
export { FOLLOW_PATHS, aboutDuration, followRouter, type FollowRouterOptions, type FollowWorld } from './routes.js';
export {
  FollowService,
  MAX_QUEUED_REQUESTS,
  msUntilNextUtcDay,
  secondsUntilNextUtcDay,
  utcDay,
  type ConfirmOutcome,
  type FollowServiceOptions,
  type RequestOutcome,
  type UnsubscribeOutcome,
} from './service.js';
export {
  DEFAULT_MAIL_FROM,
  DEFAULT_PUBLIC_URL,
  FOLLOW_ENV,
  createFollow,
  followConfigFromEnv,
  type CreateFollowOptions,
  type FollowConfig,
  type FollowHealth,
  type FollowSetup,
} from './setup.js';
export {
  FOLLOW_STATUSES,
  InMemoryFollowStore,
  compareFollowIds,
  type FollowRow,
  type FollowStatus,
  type FollowStore,
  type NewFollow,
} from './store.js';
export { TOKEN_GRAMMAR, hashToken, isTokenShaped, newLinkToken, unsubscribeTokenFor } from './tokens.js';
export {
  MAX_RECAPS_PER_RUN,
  MAX_RECAP_ATTEMPTS,
  RECAP_PAGE,
  RecapWorker,
  readPublishedFrame,
  type RecapRunReport,
  type RecapWorkerOptions,
} from './worker.js';
export { followWorldOf, latestSettledReckoningAt, ticksToNextSettlement, type WorldReader } from './world.js';
