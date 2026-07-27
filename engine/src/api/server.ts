/**
 * The HTTP surface. Five endpoints, and every one of them is a rules surface.
 *
 * ┌─ THE THREE THINGS THIS FILE EXISTS TO GET RIGHT ────────────────────────┐
 * │ 1. **An illegal action is not an error** (PROP-O7). It returns 200 with  │
 * │    the violated invariant, the changed fields, the nearest legal         │
 * │    affordance, and a fresh observation. A 400 wastes the agent's turn    │
 * │    and it loops; a hint makes it correct itself immediately.             │
 * │ 2. **A hint never reaches the public feed** (scar #10). High Water wrote │
 * │    illegal-move rejections as public ledger receipts and the watcher UI  │
 * │    filled with noise. A hint is not an event. Corrections are returned   │
 * │    on the response and written nowhere.                                  │
 * │ 3. **No agent-reachable input may halt the world** (AGT-X9). Every route │
 * │    catches, every ledger call downstream is guarded, and the error       │
 * │    middleware is registered before any route can throw (scar #11).       │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * The mount path is `agent.md`'s: `/compact/api/*`. The bare `/enroll` spelling
 * SPEC §12.5 uses is mounted too, because a signature covers `@path` and therefore
 * each spelling verifies against itself — but `agent.md` is what a player reads, so
 * that is the canonical one and it is the one the tests exercise.
 *
 * ┌─ AN UNRESOLVED DUPLICATION, RECORDED RATHER THAN LEFT TO BE FOUND ───────┐
 * │ `src/observe/` landed in parallel with this module and is a **second,     │
 * │ independent implementation of the same ten-key observation** — its own    │
 * │ affordance solver, correction shape, withheld accounting, quote and       │
 * │ briefing, with its own test suite. It is wired to no transport.           │
 * │ `src/api/observe.ts` is the one this server serves.                       │
 * │                                                                          │
 * │ Two observation builders is one concept with two homes, and the concept   │
 * │ is the *rules surface an agent plays from* — the exact shape of scar #1.  │
 * │ It must be resolved before either is trusted, and the recommendation is   │
 * │ that `src/observe/` wins (it owns the concept, and its token-budget,      │
 * │ sensing and free-service layers go further) with this server adapted onto │
 * │ it and `src/api/observe.ts` deleted. Reported upward, not papered over.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import {
  SPEEDS,
  TICKS_PER_RECKONING,
  isSpeedName,
  reckoningIndex,
  setSpeed,
  systemClock,
  ticksToMs,
  type Clock,
} from '../core/time.js';
import { publishFrame } from '../frames/write.js';
import { costOf } from '../tick/index.js';
import { createCast, type Cast } from '../cast/index.js';
import { Runtime, RULES_VERSION } from '../sim/runtime.js';
import type { PrincipalId } from '../core/types.js';
import {
  InMemoryJournalStore,
  Journal,
  PgJournalStore,
  bootWorld,
  describeDiagnosis,
  type BootDiagnosis,
  type BootOutcome,
  type JournalStore,
} from '../persist/index.js';
import {
  BoundedReplayStore,
  Keyring,
  RequestVerifier,
  DEFAULT_SIGNATURE_POLICY,
  recordFromJwk,
  verifySignedRequest,
  wallSecondsFrom,
  type PublicKeyJwk,
  type RefusalDiagnostic,
  type SignableRequest,
} from '../identity/index.js';
import { buildHealth, type CastHealth, type HaltRecord, type HealthOptions } from './health.js';
import { IdempotencyStore } from './idempotency.js';
import {
  MAX_BODY_BYTES,
  RateLimiter,
  REPLAY_STORE_LIMITS,
  clientAddress,
  type RouteName,
} from './limits.js';
import {
  buildObservation,
  wakesRemainingFor,
  type Affordance,
  type Observation,
} from './observe.js';
import { HANDLE_GRAMMAR, MAX_HANDLE_LENGTH, SeatBook } from './seats.js';
import { classifyVerb, unbuiltVerbs } from './verbs.js';
import {
  WIRE_REASON,
  parseBody,
  readIntField,
  readStringField,
  refusal,
  scrub,
  scrubTo,
  type WireRefusal,
} from './wire.js';

/** `agent.md`'s base path. The canonical spelling. */
export const API_BASE_PATH = '/compact/api';

/** Actions accepted in one `act` batch. §12.3: one batch per tick. */
export const MAX_ACTIONS_PER_BATCH = 8;

/** Discrepancy reports retained in memory. Bounded (scar #3). */
export const MAX_DISCREPANCIES = 512;

/**
 * Characters accepted in one half of a discrepancy report.
 *
 * Deliberately **not** `MAX_DETAIL_LENGTH`. That constant bounds a string this server
 * *emits* to an agent, and reusing it as the bound on a report an agent *submits*
 * conflated two unrelated quantities — a Gate-3 probe had its most important finding
 * rejected three times at 480 characters, a cap stated in no document. Two fields at
 * this size across {@link MAX_DISCREPANCIES} rows is a ~2 MB ceiling on the buffer,
 * which is the bound that actually matters here.
 */
export const MAX_REPORT_LENGTH = 2000;

/**
 * Field names accepted for the two halves of a report, canonical first.
 *
 * agent.md §13 asks for "what you expected and what happened" and names no key, so a
 * reporter following the document guesses. The aliases are agent.md's own words and
 * the obvious synonyms; the canonical spelling is what `read_from` echoes back and the
 * only one that appears in a stored {@link DiscrepancyReport}, so §3's one-word-per-
 * concept rule still holds on both the storage and the outbound side.
 */
const EXPECTED_FIELDS = ['expected', 'expectation', 'wanted', 'should'] as const;
const OBSERVED_FIELDS = ['observed', 'happened', 'actual', 'got', 'instead'] as const;
/**
 * Accepted when neither half is named: the whole report as one string.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **`message`, `text`, `body` AND `note` ARE DELIBERATELY NOT HERE (HARD RULE 4).**
 *
 * The first version of this list carried all four, and every one of them was already
 * spoken for by a *different* concept on the same API:
 *
 *   - **MESSAGE** is §3 canon — "one typed act in a hosted private negotiation" — and
 *     a live free verb (`FREE_VERBS`, `src/api/verbs.ts`, `Runtime.vMessage`).
 *   - `text` and `body` are that verb's own two parameter spellings.
 *   - `note` is this endpoint's own **response** key.
 *
 * So `{"venture": "…", "act": "assure", "text": "I will pay"}` — the exact body
 * `vMessage` prints in its own refusal — posted one path segment wrong answered
 * `202 {recorded: true, note: "Thank you…"}`, dropped `venture` and `act` on the
 * floor, and filed a negotiation act into an operator's ring buffer that no
 * counterparty reads. An affirmative receipt for a game act that never happened, and
 * in a design whose best artifact is the reassuring thing the traitor said (§14), a
 * swallowed `assure` is a deleted piece of evidence.
 *
 * Widening the accepted shape was right; widening it onto four taken words was not.
 * A reporter who guesses one of them now gets a free refusal that names the verb, so
 * the confusion is *corrected* instead of confirmed — which is the whole point of
 * scar #1: the refusal text is a rules surface.
 * ══════════════════════════════════════════════════════════════════════════
 */
const WHOLE_REPORT_FIELDS = ['report', 'detail', 'details'] as const;

/**
 * Field names that mean something else on this API, listed so the refusal can say so.
 *
 * Cheaper than silence and far cheaper than acceptance: an agent that reached for one
 * of these has confused two concepts, and this is the one moment we can tell it.
 */
const TAKEN_FIELD_NAMES: readonly (readonly [string, string])[] = Object.freeze([
  ['message', "`message` is a VERB (POST /act) — one typed act in a venture's private channel"],
  ['text', '`text` is the `message` verb\'s own parameter (POST /act)'],
  ['body', '`body` is the `message` verb\'s own parameter (POST /act)'],
  ['note', '`note` is this endpoint\'s response key, not a request field'],
]);

/** Recorded for the half a reporter did not state. Never blank: a blank reads as lost. */
const NOT_STATED = '(not stated)';

export interface DiscrepancyReport {
  readonly tick: number;
  readonly principal: PrincipalId | null;
  readonly expected: string;
  readonly observed: string;
}

export interface ApiOptions {
  readonly runtime: Runtime;
  /** Injected. `Date.now` is banned outside `core/time.ts` (DET-7). */
  readonly clock: Clock;
  /** True in production, where nginx behind Cloudflare sets `CF-Connecting-IP`. */
  readonly trustEdge?: boolean;
  readonly seats?: SeatBook;
  readonly keyring?: Keyring;
  readonly limiter?: RateLimiter;
  readonly health?: HealthOptions;
  /**
   * Called when an enrolment succeeds, so the durable journal can record it and boot
   * can re-seat it after a restart (A10: identity never resets). Never throws into
   * the route — it enqueues; see {@link Journal.recordEnrollment}.
   */
  readonly onEnroll?: (enrollment: {
    readonly principal: PrincipalId;
    readonly handle: string;
    readonly publicKey: string;
    readonly enrolledAtTick: number;
    readonly ownerEmail: string | null;
  }) => void;
}

/**
 * Everything the app owns, exposed so tests and the sim can inspect it without
 * going through HTTP. Nothing here is mutable from outside.
 */
export interface ApiContext {
  readonly runtime: Runtime;
  readonly seats: SeatBook;
  readonly keyring: Keyring;
  readonly limiter: RateLimiter;
  readonly idempotency: IdempotencyStore;
  readonly discrepancies: readonly DiscrepancyReport[];
  /** Wakes spent per principal, this Reckoning. §12.4's budget. */
  wakesSpent(principal: PrincipalId): number;
  /** Observations served from cache rather than rebuilt. PROP-O6's evidence. */
  readonly cacheHits: () => number;
}

export interface CreatedApp {
  readonly app: Express;
  readonly context: ApiContext;
}

interface CacheEntry {
  readonly tick: number;
  readonly body: string;
}

/**
 * Build the app.
 *
 * Registration order is load-bearing and reads top to bottom: posture, then the
 * body reader, then the routes, then the 404, then the error handler. The error
 * handler must be last for Express to use it and must exist before any route can
 * throw — which, since routes are added in this same function, it does.
 */
export function createApp(options: ApiOptions): CreatedApp {
  const runtime = options.runtime;
  const clock = options.clock;
  const seats = options.seats ?? new SeatBook();
  const keyring = options.keyring ?? new Keyring();
  const limiter = options.limiter ?? new RateLimiter();
  const idempotency = new IdempotencyStore();
  const replay = new BoundedReplayStore(REPLAY_STORE_LIMITS);
  // The invariant that spans the three: a nonce must be remembered for at least as
  // long as a signature bearing it can still be fresh. Asserted at construction,
  // because the hole it leaves is exactly the width of the difference and invisible.
  RequestVerifier.assertReplayCoversPolicy(REPLAY_STORE_LIMITS, DEFAULT_SIGNATURE_POLICY);

  const trustEdge = options.trustEdge ?? false;
  const discrepancies: DiscrepancyReport[] = [];
  const wakes = new Map<PrincipalId, { reckoning: number; spent: number }>();
  const observationCache = new Map<PrincipalId, CacheEntry>();
  /**
   * Material actions this API has accepted into the **open window**, per principal.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * Not a second home for the action budget — a count of a different fact.
   *
   * `ActionBudget.remaining()` is charged during `VALIDATE+LOCK` and cleared at the
   * top of each tick, so during the submission window it answers for the tick that
   * just *resolved*, not the one being submitted into. Measured: a principal that
   * spends all four actions in tick T reads `actions_remaining: 0` while submitting
   * into T+1, where it actually has four. An agent that budgeted against that number —
   * which `agent.md` §7 tells it to — would under-act permanently, and nothing would
   * ever fail.
   *
   * The engine's count is authoritative for *charging*; this one is authoritative for
   * *what the agent may still send into the open window*, which is the question the
   * field is asked. The proper fix is `src/tick/budget.ts` exposing a per-window
   * count; until then this is the honest answer and it is reported upward.
   * ══════════════════════════════════════════════════════════════════════════
   */
  const windowSpend = new Map<PrincipalId, { window: number; material: number }>();
  let cacheHits = 0;

  const app = express();

  // ── Posture (scar #11) ────────────────────────────────────────────────────
  //
  // `app.set('env', 'production')` is the one that actually closes the hole:
  // Express renders `finalhandler`'s HTML stack page only when its own env is not
  // production, and that is decided by this setting rather than by `NODE_ENV` at
  // the moment a request fails. Setting it explicitly means a shell that forgot
  // `NODE_ENV=production` cannot reopen it.
  app.set('env', 'production');
  // `X-Powered-By: Express` is a version-adjacent fingerprint for free.
  app.disable('x-powered-by');
  // Never trust a proxy's `X-Forwarded-For` for anything. `limits.ts` reads
  // `CF-Connecting-IP` and nothing else, and Express's own `trust proxy` would put
  // a second, disagreeing answer to "who is the client" into `req.ip`.
  app.set('trust proxy', false);
  app.set('etag', false);

  const router = express.Router();

  // Raw bytes, always. RFC 9421 signs a digest over the exact body, and a parser
  // that hands us an object has thrown those bytes away.
  router.use(express.raw({ type: () => true, limit: MAX_BODY_BYTES }));

  // ── enroll ────────────────────────────────────────────────────────────────
  //
  // Ordered `callerOf → validate → meter → create`, and the middle two are in that
  // order on purpose. See {@link meter}: a malformed field creates nothing, so it must
  // not spend one of three enrolment windows in ten minutes.
  router.post('/enroll', (req, res) => {
    guard(res, () => {
      const ip = callerOf(req, res);
      if (ip === null) return;

      const parsed = parseBody(bytesOf(req), MAX_BODY_BYTES);
      if (!parsed.ok) return send(res, 400, uncharged(parsed.refusal));
      const body = parsed.value.json;

      const handle = readStringField(body, 'handle', MAX_HANDLE_LENGTH);
      if (!handle.ok) return send(res, 400, uncharged(handle.refusal));
      if (!HANDLE_GRAMMAR.test(handle.value)) {
        // The grammar is stated as a pattern, not only as prose. A Gate-3 probe read
        // agent.md §2 — whose worked example is the bare handle "vale" and which states
        // no grammar at all — guessed an underscore, and paid ten minutes for it.
        return send(
          res,
          400,
          uncharged(
            refusal(
              WIRE_REASON.FIELD_MALFORMED,
              `'${scrub(handle.value)}' is not a handle. The grammar is ${HANDLE_GRAMMAR.source}: ` +
                `lowercase letters and digits, single internal hyphens, starting with a letter, ` +
                `1..${String(MAX_HANDLE_LENGTH)} characters. No underscores, no capitals, no dots. ` +
                `'vale' and 'red-ash-9' are handles; 'Vale', 'red_ash' and 'vale-' are not. It is also ` +
                'your address at agenttransfer.dev, so it has to be one.',
            ),
          ),
        );
      }
      const publicKey = readStringField(body, 'publicKey', 256);
      if (!publicKey.ok) return send(res, 400, uncharged(publicKey.refusal));

      const jwk = jwkFromBase64Url(publicKey.value);
      if (jwk === null) {
        return send(
          res,
          400,
          uncharged(
            refusal(
              WIRE_REASON.FIELD_MALFORMED,
              'publicKey must be the base64url encoding of your 32-byte Ed25519 public key — 43 characters, ' +
                'unpadded, alphabet A-Z a-z 0-9 - _. We never see your private key.',
            ),
          ),
        );
      }

      // Everything past here reads or writes world state, so everything past here is
      // metered — including handle enumeration, which a free path would hand over.
      const gate = meter(res, 'enroll', ip);
      if (gate === null) return;

      const principal = `p:${handle.value}` as PrincipalId;
      const tick = runtime.engine.tick + 1;

      // ── The world is asked FIRST, before anything is committed ───────────────
      //
      // ══════════════════════════════════════════════════════════════════════
      // **A5′. THIS CHECK IS THE ONLY THING STANDING BETWEEN `POST /enroll` AND
      // IDENTITY TAKEOVER OF A NAMED HOUSE-CAST PRINCIPAL.**
      //
      // A principal id is derived from the handle (`p:<handle>`), and the house cast
      // is seated at boot through `Runtime.seat()` — which mints a holding, hands and
      // a stake in the *world* and never touches this `SeatBook`. So for a cast
      // principal, `seats.claim` sees no row and succeeds, `keyring.register` sees no
      // key and succeeds, and only the third step — `runtime.seat` — knows the
      // principal already exists, at which point it throws and the request 500s with
      // the first two steps already committed.
      //
      // The attacker's own Ed25519 key is then bound to `p:vale`, and every signed
      // request afterwards *is* that principal: its observation is readable, and its
      // deeds — including a declined elective part, which is a permanent public
      // default — are recorded against a character it does not own. That is A5′
      // exactly: the record made wrong about a real agent, which the design calls
      // worse than a crash.
      //
      // `agent.md` §2's worked example is `{ "handle": "vale" }`, which is **not** in
      // `CAST_NAMES` — the documented first request enrols cleanly. Do not read that as
      // reassurance: the twenty cast handles are printed on the map and in every frame,
      // so they are the first thing an agent reading the spectator client would try.
      // The guard is exercised by `test/api/enroll-takeover.test.ts`, which reads the
      // handles out of `CAST_NAMES` rather than naming one here.
      //
      // Ordered before `seats.claim` because a refused enrolment must have no side
      // effect at all: the previous shape flipped a seat to occupied and bound a key
      // on the way to failing. Status alone does not prove that — with this check
      // deleted the route still answers 409, because `runtime.seat` throws and the
      // catch below reports it, *after* `keyring.register` has bound the stranger's
      // key. So the takeover test asserts the three tables, not the status code.
      // ══════════════════════════════════════════════════════════════════════
      if (keyring.activeFor(principal) !== null) {
        return send(
          res,
          409,
          refusal(
            WIRE_REASON.ALREADY_ENROLLED,
            `${principal} is already enrolled and holds a live key. Identity is never re-minted (A10) — ` +
              'sign an observe with the key you enrolled with. If you have lost it, that is not recoverable ' +
              'here, and a new handle is a new principal with no standing.',
          ),
        );
      }
      if (runtime.world.holdingByPrincipal.has(principal)) {
        return send(
          res,
          409,
          refusal(
            WIRE_REASON.HANDLE_TAKEN,
            `the handle '${handle.value}' already belongs to a principal in this world — it is one of the ` +
              'named characters the house runs. A handle is a public name and an address, so it is never ' +
              'reissued. Pick another one — nothing about it is competitive — but know that this attempt ' +
              'COST YOU A SLOT against the enrolment limit, because trying handles is enumeration and a ' +
              'free path would hand over the whole namespace. Choose your next one deliberately rather ' +
              'than sending a series of guesses.',
          ),
        );
      }

      const claimed = seats.claim(principal, handle.value, tick);
      if (!claimed.ok) {
        const kind = claimed.refusal.kind;
        // A full world is a 503 and a *helpful* one (§15.6): it says what would have
        // to change. A taken handle is a 409, which is a different mistake.
        const status = kind === 'full' ? 503 : 409;
        const reason =
          kind === 'full'
            ? WIRE_REASON.SEATS_FULL
            : kind === 'taken'
              ? WIRE_REASON.HANDLE_TAKEN
              : WIRE_REASON.ALREADY_ENROLLED;
        if (kind === 'full') res.setHeader('Retry-After', '60');
        return send(res, status, refusal(reason, claimed.refusal.detail));
      }

      let registered;
      try {
        registered = keyring.register(principal, recordFromJwk(jwk), Math.max(0, tick));
      } catch (error: unknown) {
        return send(
          res,
          409,
          refusal(
            WIRE_REASON.ALREADY_ENROLLED,
            `that key cannot be registered: ${describe(error)}. Generate a fresh keypair.`,
          ),
        );
      }

      // Wrapped, even though the two pre-checks above make the throw unreachable.
      // `Runtime.seat` raises rather than returning a rejection — correct for an engine
      // bug, wrong for a stranger's JSON — and a bare 500 here is what hid the takeover
      // above for a whole build. A named refusal is the difference between "we know
      // what this is" and "something happened".
      let enrolment;
      try {
        enrolment = runtime.seat(principal, handle.value);
      } catch (error: unknown) {
        return send(
          res,
          409,
          refusal(
            WIRE_REASON.HANDLE_TAKEN,
            `'${handle.value}' could not be seated in the world (${describe(error)}). Nothing was created. ` +
              'Pick another handle.',
          ),
        );
      }
      // Persist the enrolment so a restart re-seats it. After the world seat
      // succeeded and before the response, so a recorded enrolment is always one the
      // world actually holds. `publicKey.value` is the base64url the agent sent.
      options.onEnroll?.({
        principal,
        handle: handle.value,
        publicKey: publicKey.value,
        enrolledAtTick: tick,
        ownerEmail: null,
      });

      const observation = observe(principal, true);

      return send(res, 201, {
        ok: true,
        principalId: principal,
        handle: handle.value,
        /** §15.7: the handle *is* the address. */
        email: `${handle.value}@agenttransfer.dev`,
        keyid: registered.keyid,
        didKey: registered.didKey,
        holding: { id: enrolment.holding.id, name: enrolment.holding.name, system: enrolment.holding.system },
        hands: enrolment.hands.map((h) => ({ id: h.id, location: h.location, state: h.state })),
        agentMd: `${API_BASE_PATH}/agent.md`,
        /** §12.5's three-call exercise, so a harness needs nothing but HTTP. */
        conformance: [
          `GET ${API_BASE_PATH}/observe (signed)`,
          `POST ${API_BASE_PATH}/act with one affordance copied verbatim from affordances[]`,
          `GET ${API_BASE_PATH}/observe again and read briefing.if_you_do_nothing`,
        ],
        signing: {
          algorithm: 'ed25519',
          scheme: 'RFC 9421 HTTP Message Signatures',
          coveredComponents: ['@method', '@path', '@authority', 'content-digest'],
          required: ['created', 'keyid', 'nonce', 'alg'],
        },
        /**
         * The canon lists every verb; these are the ones whose mechanic has landed.
         * Told at enrolment rather than discovered by spending actions on refusals.
         */
        liveVerbs: [...runtime.liveVerbs].sort(byteOrder),
        notYetLive: unbuiltVerbs(runtime.liveVerbs),
        observation,
      });
    });
  });

  // ── observe ───────────────────────────────────────────────────────────────
  router.get('/observe', (req, res) => {
    guard(res, () => {
      const gate = admit(req, res, 'observe');
      if (gate === null) return;
      const who = authenticate(req, res);
      if (who === null) return;

      const cached = observationCache.get(who);
      if (cached !== undefined && cached.tick === runtime.engine.tick) {
        // PROP-O6 and A4 in one line: a repeat fetch inside one tick is the same
        // bytes and costs no wake, so polling faster buys exactly nothing.
        cacheHits += 1;
        res.status(200).type('application/json').send(cached.body);
        return;
      }

      const fresh = spendWake(who);
      const observation = observe(who, fresh);
      const body = JSON.stringify({ ok: true, observation });
      observationCache.set(who, { tick: runtime.engine.tick, body });
      res.status(200).type('application/json').send(body);
    });
  });

  // ── act ───────────────────────────────────────────────────────────────────
  router.post('/act', (req, res) => {
    guard(res, () => {
      const gate = admit(req, res, 'act');
      if (gate === null) return;
      const who = authenticate(req, res);
      if (who === null) return;

      const parsed = parseBody(bytesOf(req), MAX_BODY_BYTES);
      if (!parsed.ok) return send(res, 400, parsed.refusal);
      const body = parsed.value.json;

      const rawKey = body['idempotencyKey'];
      const key = typeof rawKey === 'string' ? rawKey : null;
      if (key !== null && !IdempotencyStore.isWellFormed(key)) {
        return send(
          res,
          400,
          refusal(
            WIRE_REASON.FIELD_MALFORMED,
            'idempotencyKey must be 1..128 characters of letters, digits, and _ : . -',
          ),
        );
      }
      if (key !== null) {
        const previous = idempotency.get(who, key);
        if (previous !== undefined) {
          // PROP-W2: a no-op returning the original result. The outcome is verbatim;
          // the observation is rebuilt, because a stale one would send the agent to
          // act against a world the engine has already moved past.
          return send(res, 200, {
            ok: true,
            replayed: true,
            outcome: previous.outcome,
            stateVersion: runtime.engine.stateVersion,
            observation: observe(who, false, false),
          });
        }
      }

      const expected = readIntField(body, 'expectedStateVersion');
      if (!expected.ok) return send(res, 400, expected.refusal);

      // ── PROP-W3, at the boundary ────────────────────────────────────────────
      //
      // "`expected_state_version` mismatch always returns a fresh preview and never
      // guesses." The engine checks it too, in `applyOne`, against the version frozen
      // at FREEZE_QUEUE — and that check is the authoritative one. This is not a
      // second, disagreeing answer: `submit` refuses while a tick is in flight, so the
      // live version during the window IS the version that will be frozen. Checking
      // here as well is what makes the *preview* immediate, rather than a correction
      // the agent has to come back for a tick later.
      if (expected.value !== undefined && expected.value !== runtime.engine.stateVersion) {
        const preview = observe(who, false);
        return send(res, 200, {
          ok: true,
          replayed: false,
          outcome: {
            accepted: [],
            corrections: [
              {
                clientSequence: null,
                verb: null,
                invariant: 'PROP-W3',
                hint: scrub(
                  `you acted on state version ${String(expected.value)}; the world is at ` +
                    `${String(runtime.engine.stateVersion)}. Nothing was submitted and nothing was charged — ` +
                    'the engine will not guess what you meant. This response carries a fresh preview.',
                ),
                changed: [
                  {
                    field: 'header.state_version',
                    you_acted_on: expected.value,
                    now: runtime.engine.stateVersion,
                  },
                ],
                nearest_legal: nearestLegal(preview.affordances, ''),
                observation: preview,
              },
            ],
          },
          stateVersion: runtime.engine.stateVersion,
          observation: preview,
        });
      }

      const rawActions = body['actions'];
      if (!Array.isArray(rawActions)) {
        return send(
          res,
          400,
          refusal(WIRE_REASON.FIELD_MALFORMED, "'actions' must be an array of {verb, params, clientSequence}."),
        );
      }
      if (rawActions.length === 0 || rawActions.length > MAX_ACTIONS_PER_BATCH) {
        return send(
          res,
          400,
          refusal(
            WIRE_REASON.FIELD_MALFORMED,
            `send 1..${String(MAX_ACTIONS_PER_BATCH)} actions in one batch; ordering inside it is by clientSequence, never by arrival.`,
          ),
        );
      }

      const accepted: Record<string, unknown>[] = [];
      const corrections: Record<string, unknown>[] = [];
      const observationForHints = observe(who, false, false);
      // The fresh nearest-legal set, solved at most once for the whole batch and paid
      // for with one wake (see solveHintSet). Lazy: a batch with no corrections spends
      // nothing, and a batch with several shares the one solve rather than harvesting
      // a fresh priced set per rejected action.
      let hintSet: readonly Affordance[] | null | undefined;
      const hints = (): readonly Affordance[] | null => {
        if (hintSet === undefined) hintSet = solveHintSet(who);
        return hintSet;
      };

      for (const [index, raw] of rawActions.entries()) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
          corrections.push(
            correction(index, '?', 'A2', 'each action must be an object: {"verb": "...", "params": {...}}', observationForHints, hints()),
          );
          continue;
        }
        const spec = raw as Record<string, unknown>;
        const verb = typeof spec['verb'] === 'string' ? spec['verb'] : '';
        const paramsRaw = spec['params'];
        const params =
          typeof paramsRaw === 'object' && paramsRaw !== null && !Array.isArray(paramsRaw)
            ? (paramsRaw as Record<string, unknown>)
            : {};
        const clientSequence =
          typeof spec['clientSequence'] === 'number' && Number.isSafeInteger(spec['clientSequence'])
            ? spec['clientSequence']
            : index;

        const verdict = classifyVerb(verb, runtime.liveVerbs);
        if (!verdict.live) {
          // Refused here, before submission, so nothing is charged. The tick loop
          // charges the budget before it runs a handler — correct for an act that
          // reached the rules and lost, wrong for a verb whose rules do not exist.
          corrections.push(correction(clientSequence, verb, verdict.invariant, verdict.hint, observationForHints, hints()));
          continue;
        }

        const submitted = runtime.engine.submit({
          principal: who,
          verb,
          params,
          clientSequence,
          // Wall clock, from the injected clock, **for the A4 audit only**. Nothing
          // in the engine orders by it; the comparator is handed a type without it.
          arrivalMs: clock.nowMs(),
          decisionSource: 'LIVE',
          ...(key === null ? {} : { idempotencyKey: `${key}:${String(clientSequence)}` }),
          ...(expected.value === undefined ? {} : { actedOnStateVersion: expected.value }),
        });

        if (submitted.ok) {
          if (costOf(verb) === 'MATERIAL') chargeWindow(who, submitted.value.targetTick);
          accepted.push({
            clientSequence,
            verb,
            resolvesInTick: submitted.value.targetTick,
            priority: submitted.value.priority,
          });
        } else {
          corrections.push(
            correction(clientSequence, verb, submitted.invariant, submitted.hint, observationForHints, hints(), {
              runtime,
              principal: who,
              params,
              expected: expected.value,
            }),
          );
        }
      }

      // A submission changes what the agent may still send, so a cached observation
      // from earlier in this same tick is now wrong about `actions_remaining`.
      if (accepted.length > 0) observationCache.delete(who);

      const outcome = {
        accepted,
        /**
         * Scar #10: this list is returned to the agent and written **nowhere**. A
         * hint is not an event, and illegal-move receipts in the public feed filled
         * High Water's watcher UI with noise until the real story was unreadable.
         */
        corrections,
      };
      if (key !== null) {
        idempotency.put(who, key, {
          tick: runtime.engine.tick,
          stateVersion: runtime.engine.stateVersion,
          outcome,
        });
      }
      return send(res, 200, {
        ok: true,
        replayed: false,
        outcome,
        stateVersion: runtime.engine.stateVersion,
        observation: observe(who, false),
      });
    });
  });

  // ── health ────────────────────────────────────────────────────────────────
  router.get('/health', (req, res) => {
    guard(res, () => {
      const gate = admit(req, res, 'health');
      if (gate === null) return;
      const report = buildHealth(runtime, seats, options.health ?? {});
      // 503 when the world is boring. See the header of `health.ts`: a green check
      // on a world where nothing is deciding is the exact shape of scar #14b.
      return send(res, report.status === 'healthy' ? 200 : 503, { ok: report.status === 'healthy', report });
    });
  });

  // ── discrepancy ───────────────────────────────────────────────────────────
  //
  // A5′'s only sensor. Signature is *optional*: a probe that cannot sign yet is
  // exactly the caller most likely to have found a contract mismatch, and refusing
  // it would close the channel at the moment it is most useful. Signed reports are
  // attributed; unsigned ones are still recorded, and both are rate-limited.
  //
  // ══════════════════════════════════════════════════════════════════════════
  // **THE CHANNEL agent.md CALLS "THE SINGLE MOST USEFUL THING YOU CAN SEND US"
  // WAS THE HARDEST ONE TO USE.** Three Gate-3 defects, all here:
  //
  //   1. A probe's most important report was **rejected three times for length** —
  //      the cap was `MAX_DETAIL_LENGTH`, which is the bound on a string we *send*,
  //      reused as the bound on a report we *receive*. Those are not the same
  //      quantity and one of them was documented nowhere.
  //   2. agent.md §13 says "what you expected and what happened" and **names no
  //      field at all**; the engine demanded exactly `expected` and `observed`, and
  //      required both. A reporter following the document had to guess twice.
  //   3. Each rejected attempt still spent a window, so the guessing was metered.
  //
  // So: a real cap, stated in every response; agent.md's own words accepted as field
  // names; either half sufficient on its own; and validation before the meter.
  // ══════════════════════════════════════════════════════════════════════════
  router.post('/discrepancy', (req, res) => {
    guard(res, () => {
      const ip = callerOf(req, res);
      if (ip === null) return;

      const parsed = parseBody(bytesOf(req), MAX_BODY_BYTES);
      if (!parsed.ok) return send(res, 400, uncharged(parsed.refusal));
      const read = readDiscrepancy(parsed.value.json);
      if (!read.ok) return send(res, 400, uncharged(read.refusal));

      const gate = meter(res, 'discrepancy', ip);
      if (gate === null) return;

      const signed = tryAuthenticate(req);
      const report: DiscrepancyReport = {
        tick: runtime.engine.tick,
        principal: signed,
        // Scrubbed on the way *in* as well as out: this text is read by an operator
        // and may be replayed into a log, and the reporter chose it.
        expected: scrubReport(read.expected),
        observed: scrubReport(read.observed),
      };
      discrepancies.push(report);
      while (discrepancies.length > MAX_DISCREPANCIES) discrepancies.shift();

      return send(res, 202, {
        ok: true,
        recorded: true,
        at_tick: report.tick,
        attributed_to: report.principal,
        /** Which keys we read, so a reporter using agent.md's words learns the canon. */
        read_from: read.readFrom,
        /** Stated here because a cap an agent discovers by rejection is undocumented. */
        max_field_length: MAX_REPORT_LENGTH,
        note:
          'Thank you — this is the most useful thing you can send us and it is never penalised. ' +
          'A promise recorded as broken when it was not is worse than a crash, so if that is what you are ' +
          'reporting it is the highest-severity thing in this project.',
      });
    });
  });

  // `agent.md` served from the API, so a harness needs nothing but HTTP (§12.5).
  router.get('/agent.md', (req, res) => {
    guard(res, () => {
      const gate = admit(req, res, 'observe');
      if (gate === null) return;
      res.status(200).type('text/markdown').send(agentMd());
    });
  });

  app.use(API_BASE_PATH, router);
  // SPEC §12.5 writes `POST /enroll`; `agent.md` writes `/compact/api/enroll`.
  // Both are mounted and each signature verifies against its own `@path`, so the
  // two spellings cannot disagree about anything an agent can observe.
  app.use('/', router);

  // ── 404, in JSON ──────────────────────────────────────────────────────────
  app.use((req: Request, res: Response) => {
    send(
      res,
      404,
      refusal(
        WIRE_REASON.NO_SUCH_ROUTE,
        `no route ${req.method} ${scrub(req.path)}. The whole API is POST ${API_BASE_PATH}/enroll, ` +
          `GET ${API_BASE_PATH}/observe, POST ${API_BASE_PATH}/act, GET ${API_BASE_PATH}/health, ` +
          `POST ${API_BASE_PATH}/discrepancy.`,
      ),
    );
  });

  // ── The error middleware (scar #11) ───────────────────────────────────────
  //
  // Four arguments, or Express treats it as a route and the HTML stack page comes
  // back. The signature is the contract.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const tooLarge =
      typeof error === 'object' &&
      error !== null &&
      (error as { type?: string }).type === 'entity.too.large';
    if (res.headersSent) {
      res.end();
      return;
    }
    if (tooLarge) {
      send(
        res,
        413,
        refusal(WIRE_REASON.BODY_TOO_LARGE, `the body exceeds the ${String(MAX_BODY_BYTES)}-byte cap.`),
      );
      return;
    }
    // Deliberately says nothing about the error. `scrub` would probably be enough,
    // but "probably enough" is how a path gets out, and the agent can do nothing
    // with our stack trace anyway.
    send(res, 500, internalRefusal());
  });

  const context: ApiContext = {
    runtime,
    seats,
    keyring,
    limiter,
    idempotency,
    discrepancies,
    wakesSpent: (principal) => wakes.get(principal)?.spent ?? 0,
    cacheHits: () => cacheHits,
  };
  return { app, context };

  // ── Helpers, closed over the app's own state ──────────────────────────────

  /**
   * Rate limit and establish the caller. Returns null when it has already replied.
   *
   * SEC-5's assertion lives here: behind Cloudflare the header is required, and a
   * request without it is refused rather than served as an anonymous share of one
   * global bucket.
   */
  function admit(req: Request, res: Response, route: RouteName): true | null {
    const ip = callerOf(req, res);
    if (ip === null) return null;
    return meter(res, route, ip);
  }

  /**
   * Establish the real client address, or reply and return null.
   *
   * Split out of {@link admit} so that a route can identify its caller *before*
   * deciding whether the request is even worth metering. Nothing here consumes a
   * limiter window; that is {@link meter}'s job and its only job.
   */
  function callerOf(req: Request, res: Response): string | null {
    const address = clientAddress(req.headers, req.socket.remoteAddress, { trustEdge });
    if (!address.ok) {
      send(res, 400, refusal(WIRE_REASON.CLIENT_IP_UNVERIFIED, `${address.reason}: ${address.detail}`));
      return null;
    }
    return address.value.ip;
  }

  /**
   * Spend one of this caller's windows on this route, or reply 429.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **A REQUEST THAT CREATES NOTHING MUST NOT CONSUME A SCARCE WINDOW.**
   *
   * `enroll` is `{burst: 3, windowSeconds: 600}`, and a Gate-3 probe spent **27
   * minutes** landing one enrolment — because a `FIELD_MALFORMED` refusal (its first
   * guess at the handle grammar used an underscore) created nothing, changed nothing,
   * and still burned one of three, opening a fresh 600 s window in the process and
   * pushing `Retry-After` from 383 s to 589 s. A client bug became a ten-minute
   * outage for a newcomer, which is a strictly worse failure than the load it avoided.
   *
   * So the two halves are separate calls and the routes that create rows order them
   * `callerOf → validate → meter`. What runs before the meter is bounded by
   * `express.raw`'s 64 KB cap, allocates nothing retained, touches no world state, and
   * is cheaper than the TLS handshake the edge has already paid for. What runs after
   * it is every lookup against real state (`ALREADY_ENROLLED`, `HANDLE_TAKEN` — handle
   * enumeration, which must stay metered) and every row creation, which is the scar #3
   * surface the allowance exists for.
   * ══════════════════════════════════════════════════════════════════════════
   */
  function meter(res: Response, route: RouteName, ip: string): true | null {
    const verdict = limiter.check(route, ip, wallSecondsFrom(clock));
    if (!verdict.allowed) {
      res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
      send(
        res,
        429,
        refusal(
          WIRE_REASON.RATE_LIMITED,
          `too many ${route} requests from ${ip}; retry in ${String(verdict.retryAfterSeconds)}s. ` +
            'This limit protects the host and is not a game rule: sending requests faster never helps you. ' +
            'A request refused for a MALFORMED FIELD costs you nothing — validation runs before this ' +
            'check — so fix the shape and resend at once. A request that reached real state DID cost a ' +
            'slot, including a handle that was already taken, because trying handles is enumeration. ' +
            'So if you are here after a taken handle, waiting is the only thing that helps.',
        ),
      );
      return null;
    }
    return true;
  }

  /** Verify the signature, or reply with the specific reason and return null. */
  function authenticate(req: Request, res: Response): PrincipalId | null {
    const verified = verifySignedRequest({
      request: signableOf(req),
      now: wallSecondsFrom(clock),
      tick: Math.max(0, runtime.engine.tick),
      directory: keyring,
      replay,
    });
    if (!verified.ok) {
      // agent.md promises a *specific* reason — "expired, wrong key, replayed
      // nonce, missing component, digest mismatch. Never a generic failure." The
      // identity module's closed set is passed through unchanged, spelling included,
      // and so is the diagnostic when it carries one.
      const status = verified.reason === 'NONCE_BUDGET_EXCEEDED' ? 429 : 401;
      send(res, status, signatureRefusal(verified.reason, verified.detail, verified.diagnostic));
      return null;
    }
    const principal = verified.value.principal;
    if (!seats.isSeated(principal)) {
      // A dormant principal returning. It never lost identity, holding or standing —
      // only the seat — so it is re-seated here if there is room, and told plainly
      // if there is not.
      const reclaimed = seats.claim(principal, seats.seatOf(principal)?.handle ?? '', runtime.engine.tick + 1);
      if (!reclaimed.ok) {
        res.setHeader('Retry-After', '60');
        send(res, 503, refusal(WIRE_REASON.SEATS_FULL, reclaimed.refusal.detail));
        return null;
      }
    }
    seats.touch(principal, runtime.engine.tick);
    return principal;
  }

  /** Verify if a signature is present, without replying. For `discrepancy`. */
  function tryAuthenticate(req: Request): PrincipalId | null {
    if (req.headers['signature'] === undefined) return null;
    const verified = verifySignedRequest({
      request: signableOf(req),
      now: wallSecondsFrom(clock),
      tick: Math.max(0, runtime.engine.tick),
      directory: keyring,
      replay,
    });
    return verified.ok ? verified.value.principal : null;
  }

  /**
   * Spend a wake, or report that there is none left.
   *
   * §12.4: outside a wake, `observe` returns the cached tick snapshot with no fresh
   * affordances and no new `quote_id` — legal, free, and useless. This is what
   * makes A4 enforceable through the budget rather than only through the clock.
   */
  function spendWake(principal: PrincipalId): boolean {
    const reckoning = reckoningIndex(Math.max(0, runtime.engine.tick));
    const row = wakes.get(principal);
    if (row === undefined || row.reckoning !== reckoning) {
      wakes.set(principal, { reckoning, spent: 1 });
      return true;
    }
    if (wakesRemainingFor(row.spent) <= 0) return false;
    row.spent += 1;
    return true;
  }

  /**
   * Build an observation, draining any undelivered corrections into it.
   *
   * `drain` is false for the copies attached to a correction's own `observation`
   * field: draining there would consume the refusals *while reporting them*, and the
   * next read would show nothing — a hint delivered to a nested field nobody looks at
   * twice. One drain per response, at the top level.
   */
  function observe(principal: PrincipalId, fresh: boolean, drain = true): Observation {
    const reckoning = reckoningIndex(Math.max(0, runtime.engine.tick));
    const row = wakes.get(principal);
    const spent = row !== undefined && row.reckoning === reckoning ? row.spent : 0;
    return buildObservation({
      runtime,
      principal,
      serverNowMs: clock.nowMs(),
      fresh,
      wakesRemaining: wakesRemainingFor(spent),
      stale: runtime.engine.status === 'PAUSED',
      corrections: drain ? runtime.takeCorrections(principal) : [],
      actionsRemaining: actionsRemainingFor(principal),
    });
  }

  /** What this principal may still send into the open window. See `windowSpend`. */
  function actionsRemainingFor(principal: PrincipalId): number {
    const window = runtime.engine.queue.targetTick;
    const row = windowSpend.get(principal);
    const material = row !== undefined && row.window === window ? row.material : 0;
    return Math.max(0, runtime.engine.budget.perTick - material);
  }

  function chargeWindow(principal: PrincipalId, window: number): void {
    const row = windowSpend.get(principal);
    if (row === undefined || row.window !== window) {
      windowSpend.set(principal, { window, material: 1 });
      return;
    }
    row.material += 1;
  }

  /**
   * PROP-O7's whole shape, in one function.
   *
   * The invariant, the changed fields, the nearest legal affordance, and a fresh
   * observation. `changed` is computed from the world rather than echoed from the
   * request, because "what changed" is only useful if it is what the engine
   * actually holds — an echo of the agent's own params tells it nothing.
   */
  function correction(
    clientSequence: number,
    verb: string,
    invariant: string,
    hint: string,
    observation: Observation,
    hintSet: readonly Affordance[] | null,
    context?: {
      readonly runtime: Runtime;
      readonly principal: PrincipalId;
      readonly params: Readonly<Record<string, unknown>>;
      readonly expected: number | undefined;
    },
  ): Record<string, unknown> {
    return {
      clientSequence,
      verb,
      invariant,
      hint: scrub(hint),
      changed: context === undefined ? [] : changedFields(context),
      /**
       * **One** affordance, not the list — and the distinction is an A4 hole if it
       * is got wrong.
       *
       * PROP-O7 requires "the nearest legal affordance", singular. Attaching the
       * whole freshly-solved list would make a deliberately illegal action a way to
       * buy a complete, un-metered information set: submit junk, read the
       * affordances, repeat, and the wake budget (§12.4) is bypassed through the
       * correction channel. So the list is solved to find the nearest one, and only
       * that one is sent; the observation attached below stays wake-gated exactly as
       * a read does.
       */
      nearest_legal: nearestFresh(hintSet, verb),
      observation,
    };
  }

  /**
   * The nearest legal act, solved fresh even when the attached observation is not.
   *
   * A correction whose `nearest_legal` was null because the reader happened to be
   * outside a wake would be PROP-O7 failing in exactly the case an agent most needs
   * it: it has just made a mistake and has nothing to try instead.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **BUT IT IS WAKE-GATED, AND THAT IS NOT NEGOTIABLE (A4, §12.4).**
   *
   * `observationForHints` is always built with `fresh: false`, so its affordance list
   * is always empty and the branch below always fired. Combined with a canon-but-
   * unbuilt verb — which is refused at the boundary and therefore costs **no action
   * and no wake** — an agent with 0 of 16 wakes left could POST `trade`, read a fully
   * priced affordance out of `nearest_legal` (exact `max_direct_loss`, exact
   * `max_contingent_liability`, and a live `quote_id`), and repeat. Measured: five
   * distinct `quote_id`s harvested with the wake budget at zero and the action budget
   * untouched.
   *
   * `agent.md` §7 states the opposite in as many words: outside a wake there are "no
   * fresh affordances and no new `quote_id` … a bigger inference budget cannot buy you
   * a bigger information set." A caller that can buy either through a refusal channel
   * makes that sentence false, which is A4 and a broken promise in one.
   *
   * So: fresh solving happens only for a caller that still holds a wake. Outside one,
   * `nearest_legal` is null — the hint still names the invariant and what to do, and
   * §12.4 already tells the agent why the world has gone quiet.
   * ══════════════════════════════════════════════════════════════════════════
   */
  /**
   * The fresh nearest-legal set for this response, solved AT MOST ONCE and paid for
   * with exactly one wake.
   *
   * The old version gated on HAVING a wake but never SPENT one, so an agent holding a
   * single wake could POST junk actions and harvest a complete, priced affordance set
   * with live quote_ids, repeatedly, unmetered — the wake budget (§12.4) bypassed
   * through the correction channel. A verifier caught it: "gating on having a wake is
   * not the same as spending one." A fresh affordance set with usable quote_ids IS
   * fresh information and costs a wake, exactly like a real observe — so it is solved
   * once per response, one wake, and reused for every correction in the batch. Out of
   * wakes, `nearest_legal` is null and the prose hint still names the invariant and the
   * fix (§12.4).
   */
  function solveHintSet(principal: PrincipalId): readonly Affordance[] | null {
    if (!spendWake(principal)) return null;
    const solved = buildObservation({
      runtime,
      principal,
      serverNowMs: clock.nowMs(),
      fresh: true,
      wakesRemaining: wakesRemainingFor(wakes.get(principal)?.spent ?? 0),
      stale: runtime.engine.status === 'PAUSED',
      corrections: [],
      actionsRemaining: actionsRemainingFor(principal),
    });
    return solved.affordances;
  }

  function nearestFresh(hintSet: readonly Affordance[] | null, verb: string): Affordance | null {
    if (hintSet === null) return null;
    return nearestLegal(hintSet, verb);
  }

  function changedFields(context: {
    readonly runtime: Runtime;
    readonly principal: PrincipalId;
    readonly params: Readonly<Record<string, unknown>>;
    readonly expected: number | undefined;
  }): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    if (context.expected !== undefined && context.expected !== context.runtime.engine.stateVersion) {
      out.push({
        field: 'header.state_version',
        you_acted_on: context.expected,
        now: context.runtime.engine.stateVersion,
      });
    }
    const handId = context.params['hand'];
    if (typeof handId === 'string') {
      const hand = context.runtime.world.hands.get(handId as never);
      out.push(
        hand === undefined
          ? { field: `hands[${handId}]`, now: null }
          : { field: `hands[${handId}].state`, now: hand.state, location: hand.location },
      );
    }
    const ventureId = context.params['venture'];
    if (typeof ventureId === 'string') {
      const venture = context.runtime.ventures.get(ventureId as never);
      out.push(
        venture === undefined
          ? { field: `ventures[${ventureId}]`, now: null }
          : { field: `ventures[${ventureId}].state`, now: venture.state, terms_hash: venture.termsHash },
      );
    }
    return out;
  }
}

// ── Free functions ──────────────────────────────────────────────────────────

/**
 * The nearest legal thing to do instead.
 *
 * Same verb first, because an agent that got `move` wrong wants a legal `move`;
 * otherwise the first affordance, which is priority-ordered and therefore the most
 * useful single thing it could do. Null only when there is genuinely nothing legal,
 * which is itself the answer.
 */
export function nearestLegal(affordances: readonly Affordance[], verb: string): Affordance | null {
  return affordances.find((a) => a.verb === verb) ?? affordances[0] ?? null;
}

function send(res: Response, status: number, body: WireRefusal | Record<string, unknown>): void {
  res.status(status).type('application/json').send(JSON.stringify(body));
}

/**
 * Mark a refusal as having cost the caller nothing.
 *
 * The sentence is not decoration. `enroll` is three requests per ten minutes; an agent
 * that cannot tell "you are out of windows" from "that field was wrong" has to assume
 * the expensive one and wait. Saying so turns a ten-minute stall into an immediate
 * retry, and it is only sayable because {@link meter} runs after validation.
 */
function uncharged(source: WireRefusal): WireRefusal {
  return refusal(
    source.reason,
    `${source.detail} Nothing was created and no rate-limit window was charged: correct it and send it again immediately.`,
  );
}

/**
 * The two halves of a discrepancy report, however the reporter spelled them.
 *
 * Either half alone is enough. A reporter with only "a default was recorded against me
 * and it is wrong" has the highest-severity report in the game and must not be refused
 * for failing to also fill in a field agent.md never mentioned.
 *
 * A half that was not stated comes back as the empty string, and {@link scrubReport}
 * is the single place that turns that into {@link NOT_STATED}. Substituting it here as
 * well was the first shape of this function, and a mutation test proved the second
 * substitution unreachable — two spellings of one rule, one of which nothing could
 * exercise.
 */
function readDiscrepancy(
  body: Readonly<Record<string, unknown>>,
):
  | {
      readonly ok: true;
      readonly expected: string;
      readonly observed: string;
      readonly readFrom: readonly string[];
    }
  | { readonly ok: false; readonly refusal: WireRefusal } {
  const expected = readAlias(body, EXPECTED_FIELDS);
  if (!expected.ok) return expected;
  const observed = readAlias(body, OBSERVED_FIELDS);
  if (!observed.ok) return observed;
  const whole = observed.field === null ? readAlias(body, WHOLE_REPORT_FIELDS) : observed;
  if (!whole.ok) return whole;

  const observedText = observed.field === null ? whole.value : observed.value;
  const readFrom = [expected.field, observed.field ?? whole.field].filter(
    (field): field is string => field !== null,
  );
  if (readFrom.length === 0) {
    // If the reporter reached for a word this API already spends on something else,
    // say which — a refusal that only restates the right answer leaves the confusion
    // in place, and this is the one moment we can name it (scar #1).
    const taken = TAKEN_FIELD_NAMES.filter(([name]) => typeof body[name] === 'string')
      .map(([, why]) => why)
      .join('; ');
    return {
      ok: false,
      refusal: refusal(
        WIRE_REASON.FIELD_MISSING,
        'send what you expected and what happened: {"expected": "...", "observed": "..."}. ' +
          `Either half on its own is accepted, as is a single {"report": "..."}, up to ${String(MAX_REPORT_LENGTH)} characters each.` +
          (taken.length === 0 ? '' : ` Note: ${taken}.`),
      ),
    };
  }
  return { ok: true, expected: expected.value, observed: observedText, readFrom };
}

/** The first of `names` this body actually carries, or `field: null` for none. */
function readAlias(
  body: Readonly<Record<string, unknown>>,
  names: readonly string[],
):
  | { readonly ok: true; readonly field: string | null; readonly value: string }
  | { readonly ok: false; readonly refusal: WireRefusal } {
  for (const name of names) {
    const raw = body[name];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'string') {
      return { ok: false, refusal: refusal(WIRE_REASON.FIELD_MALFORMED, `'${name}' must be a string.`) };
    }
    const value = raw.trim();
    // An empty string is a reporter who filled the shape but not the field; fall
    // through to the next alias rather than recording nothing under this name.
    if (value.length === 0) continue;
    if (value.length > MAX_REPORT_LENGTH) {
      return {
        ok: false,
        refusal: refusal(
          WIRE_REASON.FIELD_MALFORMED,
          `'${name}' is ${String(value.length)} characters; the cap is ${String(MAX_REPORT_LENGTH)} per field. ` +
            'Send the shortest version that still names what you expected and what happened, and send the rest as a second report — ' +
            'we would much rather have two than lose one.',
        ),
      };
    }
    return { ok: true, field: name, value };
  }
  return { ok: true, field: null, value: '' };
}

/**
 * Scrub a report that is longer than one outbound detail.
 *
 * {@link scrub} truncates at `MAX_DETAIL_LENGTH`, which is correct for a string we are
 * about to send and silently destructive for a 2000-character report we have just been
 * given. So the bound travels as an argument — see {@link scrubTo}, which carries the
 * two ways the earlier scrub-in-400-character-segments shape broke: a credential
 * straddling a boundary stopped matching the redaction and was stored verbatim, and
 * every boundary injected a space into whatever identifier sat across it.
 *
 * The blank case is substituted here and only here: `readDiscrepancy` hands the empty
 * string over for the half a reporter did not state, and a blank field in the record
 * reads as a report we lost.
 */
function scrubReport(text: string): string {
  if (text.trim().length === 0) return NOT_STATED;
  return scrubTo(text, MAX_REPORT_LENGTH);
}

/**
 * A signature refusal, with the verifier's own working attached when it has some.
 *
 * The extra key is additive: `{ok, reason, detail}` is unchanged, so a client that
 * only reads those three is unaffected. Every string inside passes {@link scrub},
 * because a diagnostic is an outbound artifact like any other (SEC-9) — and because
 * the signature base is built from *client-chosen* header values, which is exactly
 * the text that must not be echoed raw.
 *
 * The base travels as an array of lines rather than one newline-joined string on
 * purpose: `scrub` collapses whitespace runs, so a joined base would arrive as one
 * unusable line and the diagnostic would defeat itself.
 */
function signatureRefusal(
  reason: string,
  detail: string,
  diagnostic: RefusalDiagnostic | undefined,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...refusal(reason, detail) };
  if (diagnostic === undefined) return body;
  const out: Record<string, string | string[]> = {};
  for (const field of Object.keys(diagnostic)) {
    const value = diagnostic[field];
    if (value === undefined) continue;
    out[field] = typeof value === 'string' ? scrub(value) : value.map((line) => scrub(line));
  }
  body['diagnostic'] = out;
  return body;
}

/**
 * Run a handler and never let a throw reach Express.
 *
 * The error middleware is the backstop and this is the belt: a route that throws
 * *after* writing headers cannot be turned into a clean JSON body by any
 * middleware, so the throw is caught where the response is still open.
 */
function guard(res: Response, run: () => void): void {
  try {
    run();
  } catch {
    if (res.headersSent) {
      res.end();
      return;
    }
    send(res, 500, internalRefusal());
  }
}

/**
 * The one internal-error sentence.
 *
 * There are two places a throw can be caught — {@link guard}, which holds the
 * response open, and the error middleware, which is the backstop — and they had two
 * different texts. One condition with two spellings is a rules surface disagreeing
 * with itself, and the shorter one had quietly dropped the pointer to
 * `/discrepancy`, which is A5′'s only sensor. So both call this.
 */
function internalRefusal(): WireRefusal {
  return refusal(
    WIRE_REASON.INTERNAL,
    'the request could not be processed. Nothing was charged and no action was queued. ' +
      `If this repeats, POST ${API_BASE_PATH}/discrepancy with what you expected and what happened — ` +
      'it is never penalised and it is the most useful thing you can send us.',
  );
}

function bytesOf(req: Request): Uint8Array {
  const body: unknown = req.body;
  if (body instanceof Buffer) return new Uint8Array(body);
  return new Uint8Array(0);
}

/**
 * Every spelling of the request target that reaches this same handler, **canonical
 * first**.
 *
 * ┌─ THE SINGLE BIGGEST BARRIER IN THE PRODUCT, IN A GATE-3 PROBE'S WORDS ────┐
 * │ A probe wrote a textbook RFC 9421 client and got 401 SIGNATURE_INVALID    │
 * │ until it signed `"@path": /observe` instead of `/compact/api/observe`. It  │
 * │ found that only by brute-forcing eight variants, at a cost of five        │
 * │ rejections and a large part of its session. **Every conformant client     │
 * │ failed at its first signed request.**                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The cause is not `originalUrl` vs `url` — that part was already right. It is that
 * `deploy/nginx-compact.conf` proxies `/compact/api/` to `http://127.0.0.1:8801/`,
 * and the trailing slash makes nginx **strip the mount prefix**: the client sends
 * `/compact/api/observe` and the app is handed `/observe`. RFC 9421 §2.2.6 derives
 * `@path` from the target the *client* sent, so the client is right and the origin
 * cannot see what it needs by inspection.
 *
 * It cannot be recovered, either: `/observe` arriving through the stripping proxy and
 * `/observe` arriving directly are byte-identical requests. So both spellings are
 * accepted, with the client-visible one canonical:
 *
 *   received `/observe`              → [`/compact/api/observe`, `/observe`]
 *   received `/compact/api/observe`  → [`/compact/api/observe`, `/observe`]
 *
 * Two properties make this the right shape rather than a shrug:
 *
 *   - **The canonical spelling is the RFC's.** It is what the diagnostic quotes and
 *     what the archive records, so the transitional form never becomes the taught
 *     one. When nginx is eventually changed to preserve the prefix, the alternate
 *     stops being exercised and nothing else moves.
 *   - **The received target is always in the set.** Every signature that verified
 *     before this change still verifies, which is what makes it safe to land under a
 *     live world with 1886 tests standing on the old behaviour.
 *
 * Why it does not weaken verification is argued where it has to hold — on
 * {@link SignableRequest.alternateRequestTargets}. In one line: the prefix is a
 * routing no-op here, so both spellings are the same resource, and the nonce is
 * spent per key rather than per path.
 */
export function requestTargetsFor(received: string, mount: string = API_BASE_PATH): readonly string[] {
  const unmounted =
    received === mount
      ? '/'
      : received.startsWith(`${mount}/`)
        ? received.slice(mount.length)
        : received.startsWith(`${mount}?`)
          ? `/${received.slice(mount.length)}`
          : received;
  const mounted = unmounted === '/' ? `${mount}/` : `${mount}${unmounted}`;
  const out: string[] = [];
  // `received` last and unconditionally: it is the one spelling that certainly
  // verified before this function existed.
  for (const target of [mounted, unmounted, received]) {
    if (!out.includes(target)) out.push(target);
  }
  return out;
}

/**
 * Reduce an Express request to exactly what a signature covers.
 *
 * `originalUrl` rather than `url`, because a router mount rewrites `url` and the
 * client signed the path it actually sent. Getting this wrong presents as every
 * signature being invalid, which is the most expensive possible way to be wrong —
 * and see {@link requestTargetsFor} for the half of that hazard which lives in
 * nginx rather than here.
 */
function signableOf(req: Request): SignableRequest {
  const forwarded = req.headers['x-forwarded-proto'];
  const proto = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined;
  const targets = requestTargetsFor(req.originalUrl);
  return {
    method: req.method,
    scheme: proto === 'https' ? 'https' : proto === 'http' ? 'http' : 'http',
    authority: typeof req.headers.host === 'string' ? req.headers.host : 'localhost',
    requestTarget: targets[0] ?? req.originalUrl,
    alternateRequestTargets: targets.slice(1),
    headers: req.headers as Readonly<Record<string, string | readonly string[]>>,
    body: bytesOf(req),
  };
}

/** A 32-byte Ed25519 key, base64url, as `agent.md` §2 asks for it. */
function jwkFromBase64Url(encoded: string): PublicKeyJwk | null {
  if (!/^[A-Za-z0-9_-]{43,44}={0,2}$/.test(encoded)) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(encoded, 'base64url');
  } catch {
    return null;
  }
  if (bytes.length !== 32) return null;
  return { kty: 'OKP', crv: 'Ed25519', x: bytes.toString('base64url') };
}

function describe(error: unknown): string {
  return error instanceof Error ? scrub(error.message) : 'unknown';
}

function byteOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `agent.md`, read from disk once.
 *
 * Served rather than duplicated: two copies of the rules is scar #1 with the
 * document itself as the second engine.
 */
let agentMdCache: string | null = null;
function agentMd(): string {
  if (agentMdCache !== null) return agentMdCache;
  try {
    agentMdCache = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');
  } catch {
    agentMdCache = '# THE COMPACT\n\nagent.md is not available on this host.\n';
  }
  return agentMdCache;
}

// ── The process entry point ─────────────────────────────────────────────────

/**
 * Boot a server when this file is executed directly (`npm run api`).
 *
 * `import.meta.url` compared against the resolved entry path, not the CJS
 * `require.main === module` idiom, which silently never fires in an ESM module — and
 * a script that starts nothing while printing nothing is the worst possible deploy
 * artifact.
 *
 * `systemClock()` is the one sanctioned reader of wall-clock time (`core/time.ts`,
 * whitelisted by path in the DET-7 lint). It is injected here, at the boundary, and
 * nowhere inside the tick.
 */
export interface ServeOptions {
  readonly port: number;
  readonly host: string;
  readonly seed: string;
  readonly trustEdge: boolean;
  readonly castSize: number;
  /**
   * Where to write settled-Reckoning frames for the spectator client, or null to
   * write none. In production this is the nginx-served frames directory.
   */
  readonly framesDir: string | null;
  /**
   * The durable journal store. When omitted, {@link serve} builds one from the
   * environment: a Postgres store if `COMPACT_DATABASE_URL` / `DATABASE_URL` / `PG*`
   * is configured, else an in-memory store with a LOUD warning — a silent ephemeral
   * fallback is the exact defect this subsystem exists to close.
   */
  readonly store?: JournalStore;
  /** Override the connection string; defaults to the DB environment. */
  readonly databaseUrl?: string | null;
  /**
   * **THE OPERATOR DOOR**, normally from `COMPACT_ACCEPT_DIVERGENCE_AT_TICK`.
   *
   * The exact tick at which the operator has decided to accept that this build no
   * longer reproduces the record. Default null: hold the world instead.
   */
  readonly acceptDivergenceFromTick?: number | null;
  /** Force a genesis replay, whatever the snapshot says. See {@link checkpointAdoptionDisabledFromEnv}. */
  readonly disableCheckpointAdoption?: boolean;
}

export interface ServeResult {
  /** Null while HELD: there is no world to serve, only a diagnosis. */
  readonly created: CreatedApp | null;
  readonly boot: BootOutcome;
  /** Null while HELD: nothing may be written to the journal of a world we cannot resume. */
  readonly journal: Journal | null;
  /**
   * The port actually bound. Equals `options.port` unless that was 0, which asks the
   * OS for a free one — the only way a test can start two servers without inventing
   * port numbers and inheriting a stale listener from a crashed run.
   */
  readonly port: number;
  readonly close: () => Promise<void>;
}

/**
 * Boot the world from the durable journal, then serve it and persist every tick.
 *
 * Async because boot replays the record before the first request can be served —
 * a restart RESUMES rather than resetting to tick 0, which was the whole defect. The
 * seed the store was born under wins over the provided one, because replaying a
 * persisted world under a different seed diverges every hash.
 *
 * ── THE HTTP SURFACE COMES UP FIRST, AND STAYS UP ───────────────────────────
 *
 * Two failures were the same bug. Boot is O(head) — minutes on a real season — and
 * the listener used to be created *after* it, so a restart was minutes of connection
 * refused with nothing to ask. And a boot that could not reproduce the record threw
 * out of the top-level await, exited, and was restarted identically forever by
 * `Restart=always`: an infinite crash loop, re-reading the whole action log from
 * Postgres each time, serving not even a 503.
 *
 * So the socket is bound before anything else and its handler is swapped as the boot
 * progresses: BOOTING -> RUNNING, or BOOTING -> HELD. **The process never exits for a
 * reason the record can explain.** Refusing to serve a world we cannot reproduce is
 * correct (A5′); refusing to *say so* was the defect.
 */
/**
 * The clock a world runs at when nobody says otherwise.
 *
 * Exported so the A4 test can assert against **the value the server actually applies**
 * rather than re-typing a speed name. My first version of that test read
 * `SPEEDS.rehearsal` directly and stayed green when I mutated the default back to
 * `fast` — a guard that cannot see the thing it guards, which is the defect class this
 * repo keeps rediscovering. Binding the test here is what makes the mutation bite.
 */
export const DEFAULT_SPEED = 'rehearsal';

export async function serve(options: ServeOptions): Promise<ServeResult> {
  // ── THE SPEED IS A DECISION, NOT A CONSTANT ─────────────────────────────────
  //
  // This was hardcoded to `fast` (10 s a tick), and a live playtest found what that
  // costs: affordance and quote windows are 1–3 TICKS, so at `fast` they are 10–30
  // seconds — **shorter than one LLM inference.** The probe lost two ventures to expiry
  // copying an affordance verbatim, then rebuilt as a 281 ms loop and "never missed
  // again". That is latency deciding outcomes, which is exactly what **A4 forbids**, and
  // TESTING.md hazard 2 predicted it in as many words: a compressed run systematically
  // advantages fast models, and "A4 is a wall-clock property and is measured at `prod`
  // only".
  //
  // So the clock is now chosen by the operator, and the default moves to `rehearsal`
  // (60 s). At `rehearsal` a 1–3 tick window is 1–3 MINUTES, comfortably longer than any
  // reasoning model's round trip, so a slow deep model and a fast shallow one face the
  // same real deadline — and a Reckoning is still under five hours, so the world remains
  // watchable in a sitting. `prod` (300 s) is the canonical speed of §5 and the only one
  // A4 may be *measured* at; `fast` remains right for unattended overnight economy runs
  // where no agent is thinking.
  //
  // Deliberately NOT silent: an unrecognised value refuses rather than falling back, and
  // the chosen speed is printed, because a world running at a speed nobody chose is how
  // this defect survived for weeks.
  const requested = (process.env['COMPACT_SPEED'] ?? DEFAULT_SPEED).trim();
  if (!isSpeedName(requested)) {
    throw new Error(
      `COMPACT_SPEED=${requested} is not a speed. One of: ${Object.keys(SPEEDS).join(', ')}. ` +
        'A4 is a wall-clock property: at 10 s a tick an affordance window is shorter than one ' +
        'inference, so latency decides outcomes. Prefer rehearsal or prod for a world with agents in it.',
    );
  }
  setSpeed(requested);
  process.stderr.write(
    `compact: clock = ${requested} (${String(SPEEDS[requested])}s a tick, ` +
      `Reckoning every ${String(Math.round((SPEEDS[requested] * TICKS_PER_RECKONING) / 60))} min)\n`,
  );
  const clock = systemClock();
  const store = options.store ?? storeFromEnv(options, clock);

  // Bound first, so there is something to ask from the first millisecond of a
  // multi-minute replay, and something to answer with if the replay refuses.
  const gate = new ServeGate();
  const server = createServer((req, res) => {
    gate.handle(req, res);
  });
  // Awaited, so a port that cannot be bound is a rejection here rather than an
  // uncaught 'error' event minutes later, in the middle of a replay, with the
  // operator told nothing.
  const port = await listening(server, options.port, options.host);
  // Printed BEFORE the replay, not after. Boot is O(head); a deploy that greps the
  // log for proof the new build cut over must not have to wait out a whole season's
  // replay to find it (and must not conclude the restart silently failed).
  process.stderr.write(
    `compact: booting — port ${String(port)} is bound and answering 503 while the record replays\n`,
  );

  const boot = await bootTheWorld(options, store, clock, gate);
  if (boot.outcome.status === 'HELD') {
    process.stderr.write(`\n${describeDiagnosis(boot.outcome.diagnosis)}\n\n`);
    process.stderr.write(
      'compact: the world is HELD. The process stays up and serves 503 with the diagnosis above ' +
        'on every route. It is NOT exiting: exiting here is a crash loop under Restart=always.\n',
    );
    gate.hold(boot.outcome.diagnosis);
    return {
      created: null,
      boot: boot.outcome,
      journal: null,
      port,
      close: async () => {
        await closed(server);
        await store.close();
      },
    };
  }

  const { runtime, cast, keyring, seats, seed } = boot;
  const result = boot.outcome.result;
  process.stderr.write(
    `compact: boot ${result.mode}, head tick ${String(result.headTick)}, ` +
      `${String(result.ticksReplayed)} ticks replayed, ${String(result.enrollmentsApplied)} enrolments re-seated, ` +
      `${String(result.tripwiresChecked)} snapshot tripwires verified\n`,
  );
  // Why the boot was long, in the same breath as how long it was. "Replayed 242 000
  // ticks" is a fact an operator can do nothing with; "and here are the five books
  // that stop it adopting a checkpoint" is the same fact with an owner.
  process.stderr.write(
    result.adoptedAtTick === null
      ? `compact: boot replayed from genesis — ${result.checkpointRefusal ?? 'no reason recorded'}\n`
      : `compact: boot ADOPTED the checkpoint at tick ${String(result.adoptedAtTick)} ` +
          `(${String(result.postingsHydrated)} postings rehydrated), replaying only the tail\n`,
  );
  if (result.divergenceAccepted !== null) {
    const d = result.divergenceAccepted;
    process.stderr.write(
      `compact: ⚑ DECLARED DISCONTINUITY — an operator accepted a rules change at tick ${String(d.tick)} ` +
        `(rules_version ${d.fromRulesVersion === null ? 'unrecorded' : String(d.fromRulesVersion)} -> ` +
        `${String(d.toRulesVersion)}, ${String(d.toleratedAfter)} further divergences tolerated). ` +
        'It is written into the permanent public record; the ticks before and after it were computed by ' +
        'different code.\n',
    );
  } else if (result.rulesVersionChanged) {
    process.stderr.write(
      `compact: rules_version moved ${String(result.journalledRulesVersion)} -> ` +
        `${String(result.runningRulesVersion)} and the record still reproduced exactly. No discontinuity.\n`,
    );
  }

  const journal = new Journal(store);

  // A rate-limit allowlist for a controlled test window (Gate 3 #2): a probe fleet behind
  // one egress IP shares the enrol burst of 3/10min, so most of a fleet is starved before
  // it can play. An operator lists that IP here (comma-separated env). Default empty, so
  // production is metered exactly as before — this is an exemption for a trusted source,
  // never a weakening of the limiter for anyone else (scar #3). Safe because the limiter
  // guards the host, not the game: A4 already makes request speed powerless.
  const rateLimitAllowlist = new Set(
    (process.env['COMPACT_RATELIMIT_ALLOWLIST'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
  if (rateLimitAllowlist.size > 0) {
    process.stderr.write(
      `compact: rate-limit allowlist active for ${String(rateLimitAllowlist.size)} client(s) — a test window, not production\n`,
    );
  }

  const created = createApp({
    runtime,
    clock,
    trustEdge: options.trustEdge,
    keyring,
    seats,
    limiter: new RateLimiter(undefined, undefined, rateLimitAllowlist),
    health: {
      durability: (): ReturnType<Journal['health']> => journal.health(),
      /** Named so a PAUSED world can be diagnosed without a debugger on the box. */
      halt: (): HaltRecord | null => halted,
      // The spend meter. Probed live rather than snapshotted, so `/health` answers what
      // the cast is costing *now* — the world ran on a real key with a latching cap and
      // no observable spend, which made the only way to discover the figure be to hit it.
      cast: (): CastHealth | null => {
        const report = cast.report?.();
        if (report === undefined) return null;
        return {
          enabled: report.enabled,
          model: report.model,
          members: report.members,
          live: report.live,
          fallback: report.fallback,
          discarded: report.discarded,
          plans: report.plans,
          plannedActions: report.plannedActions,
          spentMicros: report.spend.spentMicros,
          capMicros: report.spend.capMicros,
          capTripped: report.spend.disabled,
          estimatedCalls: report.spend.estimatedCalls,
        };
      },
    },
    onEnroll: (enrollment) => {
      journal.recordEnrollment(enrollment);
    },
  });

  // The scheduler is the one place a real clock drives the world, and it derives its
  // interval from `ticksToMs(1)` so that changing the speed changes the schedule and
  // nothing else has to be told (TESTING.md §1.1, hazard 1).
  /** Set once, by the tick that aborted. Read by `/health` so a halt is diagnosable remotely. */
  let halted: HaltRecord | null = null;

  const interval = setInterval(() => {
    if (runtime.engine.status === 'PAUSED') return;
    for (const action of cast.decide(runtime.engine.tick + 1, seed)) {
      runtime.engine.submit(action);
    }
    const report = runtime.runTick();

    // ── A HALT MUST SAY SO, ONCE, LOUDLY ────────────────────────────────────
    //
    // This branch did not exist. `if (!report.halted) { persist }` had no `else`, so a world
    // that aborted a tick skipped persistence and the frame, logged NOTHING, and then
    // returned early from every subsequent interval because the status was PAUSED. It
    // stopped dead in silence.
    //
    // Found by living it: a probe agent's local world went PAUSED at tick 1281 with four
    // Reckonings and twenty-one principals in it, and the whole log was the six boot lines.
    // `/health` said PAUSED and named nothing, so there was no way, from inside or outside
    // the process, to learn which invariant had fired.
    //
    // Halting is correct — "on assertion failure, abort the tick and halt; never publish a
    // broken tick". Saying nothing about it is not. Recorded once (the loop returns early
    // afterwards, but a guard makes that explicit rather than incidental) and served from
    // `/health`, because the operator is usually not the person tailing this log.
    if (report.halted && halted === null) {
      halted = {
        tick: report.tick,
        stateHash: runtime.engine.stateHash,
        violations: report.violations.map((v) => ({ id: String(v.id), message: String(v.message) })),
      };
      process.stderr.write(
        `compact: ⚑ WORLD HALTED at tick ${String(report.tick)} — the tick was aborted and NOT ` +
          `published. state_hash ${runtime.engine.stateHash.slice(0, 16)}. ` +
          (halted.violations.length === 0
            ? 'No violations were carried on the report, which is itself a defect worth chasing.'
            : halted.violations.map((v) => `${v.id}: ${v.message}`).join(' | ')) +
          ' The world is now PAUSED and will not tick again until an operator resumes it.\n',
      );
    }

    // Persist the committed tick BEFORE the frame: the record is sacred, the show is
    // cosmetic. `record` buffers synchronously and never throws; `flushPending` is
    // single-flight, so firing it each tick drains the backlog as ticks flow and a DB
    // hiccup can never stall the loop (see `Journal`).
    if (!report.halted) {
      journal.record(runtime, report);
      void journal.flushPending();
    }

    // Publish the settled Reckoning for the spectator client. Wrapped so a frame
    // write can NEVER touch the world: a full disk or a bad path drops a frame rather
    // than halting the sim. The frame is a read model over the committed outcome.
    if (options.framesDir !== null && report.clock.isSettlementTick) {
      try {
        const frame = runtime.reckoningFrame();
        if (frame !== null) publishFrame(options.framesDir, frame);
      } catch (error: unknown) {
        process.stderr.write(
          `frame publish failed at tick ${String(report.tick)} (non-fatal): ` +
            `${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }
  }, ticksToMs(1));

  // The world is reproduced and running: hand the already-bound socket over to it.
  gate.run(created.app);
  return {
    created,
    boot: boot.outcome,
    journal,
    port,
    close: async () => {
      clearInterval(interval);
      // Drain buffered ticks to the store, then close it. A sustained outage leaves a
      // logged backlog — the bounded tail loss the Journal header describes — never a
      // silent claim of durability.
      await journal.close();
      await closed(server);
    },
  };
}

/** Bind, and resolve with the port actually taken (which is the point when it is 0). */
function listening(server: Server, port: number, host: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener('error', onError);
      const address = server.address();
      resolve(address !== null && typeof address === 'object' ? address.port : port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/**
 * Close, and wait until the port is actually free.
 *
 * A bare `server.close()` returns before the listener is released, so a test (or a
 * fast restart) that binds the same port next can lose the race — which presents as
 * an intermittent EADDRINUSE that looks like a flaky test rather than a leaked socket.
 */
function closed(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
    // Keep-alive sockets would otherwise hold the close open for the idle timeout.
    server.closeAllConnections();
  });
}

/** What `serve` got out of boot, held together so the HELD branch can return early. */
interface BootedWorld {
  readonly outcome: BootOutcome;
  readonly runtime: Runtime;
  readonly cast: Cast;
  readonly keyring: Keyring;
  readonly seats: SeatBook;
  readonly seed: string;
}

/**
 * Seat the cast and replay the record, converting **every** failure into a HELD
 * outcome rather than a thrown promise.
 *
 * The `catch` is deliberately total. `bootWorld` already converts a `BootError`, but
 * a store that cannot connect, a cast that cannot seat, or any other surprise would
 * otherwise reject out of `serve` and exit the process — which is the crash loop
 * again, arriving by a different door.
 */
async function bootTheWorld(
  options: ServeOptions,
  store: JournalStore,
  clock: Clock,
  gate: ServeGate,
): Promise<BootedWorld> {
  const seed = (await store.masterSeed().catch(() => null)) ?? options.seed;
  if (seed !== options.seed) {
    process.stderr.write(
      `compact: resuming under the journalled seed '${seed}', ignoring the provided '${options.seed}'\n`,
    );
  }
  const runtime = new Runtime({ seed });
  // The cast reads its own settings from the environment and returns the heuristic
  // cast unless COMPACT_CAST_LLM says otherwise, so this line is the whole switch: an
  // unconfigured world behaves exactly as it did before, and no key means no spend.
  const cast = createCast(runtime, { size: options.castSize, clock });
  // Built before boot, because boot re-registers each persisted enrolment's key and
  // seat as it re-seats the world principal — the identity half of A10.
  const keyring = new Keyring();
  const seats = new SeatBook();
  const shell = { runtime, cast, keyring, seats, seed };

  try {
    cast.seat(seed);
    const outcome = await bootWorld(runtime, store, {
      seed,
      nowMs: () => clock.nowMs(),
      acceptDivergenceFromTick: options.acceptDivergenceFromTick ?? null,
      ...(options.disableCheckpointAdoption === true
        ? { checkpoint: { disabled: true } as const }
        : {}),
      onEnrollment: (enrollment) => {
        const jwk = jwkFromBase64Url(enrollment.publicKey);
        if (jwk !== null) {
          try {
            keyring.register(enrollment.principal, recordFromJwk(jwk), Math.max(0, enrollment.enrolledAtTick));
          } catch {
            // Already registered on a prior boot step; identity is never re-minted.
          }
        }
        seats.claim(enrollment.principal, enrollment.handle, Math.max(0, enrollment.enrolledAtTick));
      },
      onProgress: (tick, head) => {
        gate.progress(tick, head);
      },
    });
    // Replay is over; everything after this tick is live play. The census forgets the
    // replayed decisions so the scar #14b floor judges the world that is running now
    // rather than the log it just re-read (see DecisionCensus.beginLivePlay).
    runtime.census.beginLivePlay(runtime.engine.tick);
    return { ...shell, outcome };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...shell,
      outcome: {
        status: 'HELD',
        message,
        diagnosis: {
          kind: 'REPLAY_HALTED',
          tick: runtime.engine.tick,
          message: `boot could not run at all: ${scrub(message)}`,
          expectedHash: null,
          actualHash: null,
          action: null,
          journalledRulesVersion: null,
          runningRulesVersion: RULES_VERSION,
          rulesVersionChanged: false,
          operatorInstruction: null,
        },
      },
    };
  }
}

/**
 * The socket's handler, swappable while the world boots.
 *
 * One `http.Server` whose request handler moves BOOTING -> RUNNING or BOOTING -> HELD.
 * Not two servers with a hand-off: closing one listener and opening another on the
 * same port races on `EADDRINUSE`, and a deploy that intermittently fails to bind is
 * indistinguishable from the outage it was meant to prevent.
 */
class ServeGate {
  private app: Express | null = null;
  private diagnosis: BootDiagnosis | null = null;
  private tick = -1;
  private head = -1;

  run(app: Express): void {
    this.app = app;
    this.diagnosis = null;
  }

  hold(diagnosis: BootDiagnosis): void {
    this.app = null;
    this.diagnosis = diagnosis;
  }

  progress(tick: number, head: number): void {
    this.tick = tick;
    this.head = head;
  }

  handle(req: IncomingMessage, res: ServerResponse): void {
    const app = this.app;
    if (app !== null) {
      app(req, res);
      return;
    }
    const held = this.diagnosis;
    const body =
      held === null
        ? {
            status: 'BOOTING',
            world: 'BOOTING',
            replayed_tick: this.tick,
            head_tick: this.head,
            detail:
              'the world is replaying the durable record; it will serve as soon as the record is reproduced',
          }
        : {
            status: 'HELD',
            world: 'HELD',
            detail: describeDiagnosis(held),
            failure: held.kind,
            tick: held.tick,
            expected_state_hash: held.expectedHash,
            actual_state_hash: held.actualHash,
            journalled_rules_version: held.journalledRulesVersion,
            running_rules_version: held.runningRulesVersion,
            rules_version_changed: held.rulesVersionChanged,
            operator_instruction: held.operatorInstruction,
          };
    // 503 on every route including /health: the world is genuinely unavailable, and
    // a 200 anywhere would let a monitor call this healthy.
    res.writeHead(503, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': '30',
    });
    res.end(JSON.stringify(body, null, 2));
  }
}

/**
 * Build the durable store from the environment, warning loudly on the ephemeral
 * fallback. A misconfigured deploy that silently reverts to in-memory is exactly the
 * shape of the outage this subsystem was written to prevent, so it is made visible.
 */
function storeFromEnv(options: ServeOptions, clock: Clock): JournalStore {
  const url =
    options.databaseUrl ??
    process.env['COMPACT_DATABASE_URL'] ??
    process.env['DATABASE_URL'] ??
    null;
  const hasPgEnv = process.env['PGHOST'] !== undefined || process.env['PGDATABASE'] !== undefined;
  if (url !== null || hasPgEnv) {
    return new PgJournalStore({
      ...(url === null ? {} : { connectionString: url }),
      nowMs: () => clock.nowMs(),
    });
  }
  process.stderr.write(
    'compact: WARNING — no COMPACT_DATABASE_URL / DATABASE_URL / PG* configured, so the journal is ' +
      'an EPHEMERAL in-memory store. The world will NOT survive a restart. Configure the database to make ' +
      'the permanent public record durable.\n',
  );
  return new InMemoryJournalStore();
}

/**
 * The operator door, read from the environment.
 *
 * A malformed value is refused rather than coerced: `Number('yes')` is `NaN`, and a
 * door that silently opens on a typo is not a door.
 */
/**
 * **THE ADOPTION KILL SWITCH**, from `COMPACT_CHECKPOINT_ADOPTION=off`.
 *
 * Checkpoint adoption took the live world down the first time it was ever allowed to run. The rules
 * gate had been refusing it on every boot since the world's first rules change (write-once
 * `journal_meta.rules_version`), so the adopt path had **never executed in production** — and when
 * it finally did, `hydrateLedgerForSnapshot` found a posting at tick 2830 against an escrow account
 * the tick-4895 ledger capture no longer holds, because that escrow had long since closed. Correct
 * fail-closed behaviour: the world HELD rather than serving a wrong record. But it HELD, and the
 * only lever available was a manual `UPDATE snapshot SET rules_version = NULL` over SSH.
 *
 * An operator needs to be able to turn off a boot path without editing the database. `disabled` is
 * the option `planCheckpoint` has always had; this just makes it reachable from the environment.
 *
 * Anything other than the exact string `off` leaves adoption ON, and a value that is neither `off`
 * nor empty is reported rather than guessed — same discipline as the operator door above: a switch
 * that silently flips on a typo is not a switch.
 */
function checkpointAdoptionDisabledFromEnv(): boolean {
  const raw = process.env['COMPACT_CHECKPOINT_ADOPTION'];
  if (raw === undefined || raw.trim().length === 0) return false;
  const v = raw.trim().toLowerCase();
  if (v === 'off') {
    process.stderr.write(
      'compact: ⚑ checkpoint adoption DISABLED by COMPACT_CHECKPOINT_ADOPTION=off. Every boot will ' +
        'replay from genesis, which is O(history) and grows without bound. Correct while the adopt ' +
        'path is known-broken; remove it once that is fixed, or restarts get slower forever.\n',
    );
    return true;
  }
  if (v !== 'on') {
    process.stderr.write(
      `compact: COMPACT_CHECKPOINT_ADOPTION='${raw}' is not 'on' or 'off'. Leaving adoption ON — ` +
        'a kill switch that engages on a typo is worse than none.\n',
    );
  }
  return false;
}

function acceptDivergenceFromEnv(): number | null {
  const raw = process.env['COMPACT_ACCEPT_DIVERGENCE_AT_TICK'];
  if (raw === undefined || raw.trim().length === 0) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) {
    process.stderr.write(
      `compact: COMPACT_ACCEPT_DIVERGENCE_AT_TICK='${raw}' is not a tick number. Ignoring it — ` +
        'the world will hold rather than guess what an operator meant.\n',
    );
    return null;
  }
  process.stderr.write(
    `compact: ⚑ operator door armed for tick ${String(n)}. If replay diverges at exactly that tick, ` +
      'the world resumes and the discontinuity is written into the permanent public record.\n',
  );
  return n;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const port = Number(process.env['COMPACT_PORT'] ?? '8787');
  const started = await serve({
    port: Number.isSafeInteger(port) ? port : 8787,
    host: process.env['COMPACT_HOST'] ?? '127.0.0.1',
    seed: process.env['COMPACT_SEED'] ?? 'compact-1',
    // Behind Cloudflare in production, so the client-IP header is mandatory (SEC-5).
    trustEdge: process.env['COMPACT_TRUST_EDGE'] === 'true',
    castSize: Number(process.env['COMPACT_CAST'] ?? '12'),
    framesDir: process.env['COMPACT_FRAMES_DIR'] ?? null,
    acceptDivergenceFromTick: acceptDivergenceFromEnv(),
    disableCheckpointAdoption: checkpointAdoptionDisabledFromEnv(),
  });
  if (started.created === null) {
    // HELD. The socket is bound and answering 503 with the diagnosis; the process
    // stays alive on purpose so systemd does not restart it into the same wall.
    process.stderr.write(
      `compact api HELD on ${API_BASE_PATH}; every route answers 503 with the boot diagnosis\n`,
    );
  } else {
    process.stderr.write(
      `compact api listening on ${API_BASE_PATH}; population ${String(started.created.context.runtime.world.principalOrder.length)}\n`,
    );
  }
}
