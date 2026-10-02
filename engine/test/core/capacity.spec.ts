/**
 * THE CAP AUDIT (Season 1) — every published cap in `src/`, classified, and the arithmetic each class
 * owes checked against the ceiling it must clear.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY A TABLE, AND WHY IT MUST BE COMPLETE.** `core/time.ts:MAX_PRINCIPALS` records the first time
 * a cap bound below the population it was capping: the Levy ballot book, a flat 512, full at 171
 * voters while the world seated 300 — a denial decided by arrival order. The Season 1 audit found the
 * same shape six more times (the submission window at 4,096, the fill queue at 512, elections at 2,048,
 * grants at 4,096, open orders at 2,048, syndicates at 64) and two that THROW inside a tick, which is a
 * halt (the per-tick event buffer at 8,192, the Charge ballot book at 512). None was visible in any
 * report until it bound.
 *
 * So every `export const MAX_*` in `src/` must appear below with a CLASS, and the class says what the
 * cap owes: a population book must clear `per × MAX_PRINCIPALS`, a map book `per × MAX_MAP_SYSTEMS`, a
 * legibility budget must NOT grow with the population (§17's seven labels are a property of a viewer,
 * not of a world). A new cap that is not classified fails the completeness test, so the next one is
 * argued before it ships rather than discovered when it binds.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Classes:
 *
 *   CEILING     a ceiling itself — the world's population, the map's size, the house cast's names
 *   POPULATION  a world book holding up to `per` rows per principal: must clear per × MAX_PRINCIPALS
 *   MAP         a world book holding up to `per` rows per system: must clear per × MAX_MAP_SYSTEMS
 *   PER_ROW     a bound on one principal, one object or one input — scales by itself
 *   LEGIBILITY  a frame or observation budget — a viewer's limit, deliberately flat
 *   RETENTION   a horizon of recent history (a ring or a count of Reckonings) — its time window narrows
 *               as volume rises, which is acceptable only where nothing COMPUTES from the evicted rows
 *   DRAMA       a world-wide budget on scheduled conflict — flat by design today, flagged for Season 1
 *   HOST        the API process's own memory, sized from the host's seats, never read by a tick
 *   FLAGGED     known to bind at scale and owned by another lane, or needing a design call — each
 *               carries the finding, and `docs/design/SCALE-2026-10-01.md` lists them for the owner
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as follow from '../../src/api/follow/email.js';
import * as recap from '../../src/api/follow/recap.js';
import * as followService from '../../src/api/follow/service.js';
import * as followWorker from '../../src/api/follow/worker.js';
import * as idem from '../../src/api/idempotency.js';
import * as limits from '../../src/api/limits.js';
import * as observe from '../../src/api/observe.js';
import { DEFAULT_SEATS, MAX_HANDLE_LENGTH, SeatBook, seatCapacityFrom } from '../../src/api/seats.js';
import * as server from '../../src/api/server.js';
import * as wire from '../../src/api/wire.js';
import * as campaign from '../../src/campaign/params.js';
import { MAX_CAST } from '../../src/cast/heuristic.js';
import * as parse from '../../src/cast/parse.js';
import * as prompt from '../../src/cast/prompt.js';
import * as combat from '../../src/combat/params.js';
import * as combatView from '../../src/combat/view.js';
import { MAX_PARAM_LIST } from '../../src/core/params.js';
import { ACTIONS_PER_TICK, MAX_PRINCIPALS } from '../../src/core/time.js';
import * as frames from '../../src/frames/contract.js';
import * as grantBook from '../../src/grant/book.js';
import { MAX_DIGEST_CHARS } from '../../src/grant/compartment.js';
import * as dossier from '../../src/grant/dossier.js';
import { MAX_ALTERNATE_REQUEST_TARGETS } from '../../src/identity/httpsig.js';
import { MAX_DELEGATION_DEPTH } from '../../src/identity/vc.js';
import * as levy from '../../src/levy/params.js';
import * as marketBook from '../../src/market/book.js';
import * as marketPlace from '../../src/market/place.js';
import { MAX_LIVE_QUOTES } from '../../src/observe/quote.js';
import { MAX_PLANS } from '../../src/observe/services.js';
import * as tokens from '../../src/observe/tokens.js';
import * as predation from '../../src/predation/params.js';
import { MAX_INDEMNITY_DEFERRALS } from '../../src/risk/indemnity.js';
import * as riskLines from '../../src/risk/lines.js';
import * as risk from '../../src/risk/params.js';
import * as directory from '../../src/say/directory.js';
import * as parley from '../../src/say/parley.js';
import { MAX_REACH_ROWS } from '../../src/say/reach.js';
import { MAX_SEALS_PER_PRINCIPAL_PER_RECKONING } from '../../src/seal/book.js';
import * as intent from '../../src/seal/intent.js';
import { MAX_ROW_ITEMS } from '../../src/seal/saydo.js';
import * as runtime from '../../src/sim/runtime.js';
import * as season from '../../src/season/params.js';
import * as sovereignty from '../../src/sovereignty/params.js';
import { MAX_NAME_CHARS } from '../../src/syndicate/form.js';
import * as syndicate from '../../src/syndicate/params.js';
import { MAX_LIVE_INTENTS_PER_PRINCIPAL } from '../../src/tick/intent.js';
import { EVENTS_PER_PRINCIPAL_PER_TICK, MAX_BUFFERED_EVENTS } from '../../src/tick/loop.js';
import { MAX_QUEUED_ACTIONS, MAX_QUEUED_PER_PRINCIPAL } from '../../src/tick/queue.js';
import { MAX_ROLES_PER_VENTURE } from '../../src/venture/kinds.js';
import { MAX_DEFERRALS } from '../../src/venture/settlement.js';
import { MAX_CLASSIFY_DEPTH } from '../../src/world/commons.js';
import {
  GROWTH_QUALIFIED_PER_SYSTEM,
  HANDS_PER_PRINCIPAL,
  LAUNCH_SYSTEM_BOUNDS,
  MAX_GROWN_CONSTELLATIONS,
  MAX_MAP_SYSTEMS,
} from '../../src/world/index.js';
import { MAX_CARGO_GOODS } from '../../src/world/hands.js';
import { MAX_HAUL_QTY } from '../../src/world/haul.js';

type CapClass =
  | 'CEILING'
  | 'POPULATION'
  | 'MAP'
  | 'PER_ROW'
  | 'LEGIBILITY'
  | 'RETENTION'
  | 'DRAMA'
  | 'HOST'
  | 'FLAGGED';

interface Cap {
  readonly value: number;
  readonly class: CapClass;
  /** POPULATION / MAP / HOST: rows per principal (or per system, or per seat) the cap must clear. */
  readonly per?: number;
  readonly why: string;
}

/** Every `export const MAX_*` in `src/`, by name. The completeness test reads `src/` to check it. */
const CAPS: Readonly<Record<string, Cap>> = {
  // ── ceilings ────────────────────────────────────────────────────────────────
  MAX_PRINCIPALS: { value: MAX_PRINCIPALS, class: 'CEILING', why: 'the world ceiling every population book derives from' },
  MAX_MAP_SYSTEMS: { value: MAX_MAP_SYSTEMS, class: 'CEILING', why: 'the map ceiling every per-system book derives from' },
  MAX_GROWN_CONSTELLATIONS: { value: MAX_GROWN_CONSTELLATIONS, class: 'CEILING', why: 'growth stops here; sized so the map stages MAX_PRINCIPALS at the stage floor' },
  MAX_CAST: { value: MAX_CAST, class: 'CEILING', why: 'the house cast is 12–20 named principals (§15.6); the scale harness seats synthetic rosters instead' },

  // ── population books: must clear per × MAX_PRINCIPALS ──────────────────────
  MAX_QUEUED_ACTIONS: { value: MAX_QUEUED_ACTIONS, class: 'POPULATION', per: MAX_QUEUED_PER_PRINCIPAL, why: 'one tick window; was 4,096 and bound at 128 loaded principals' },
  MAX_PENDING_FILLS: { value: runtime.MAX_PENDING_FILLS, class: 'POPULATION', per: ACTIONS_PER_TICK, why: 'fill_role requests in one tick; was MAX_TALK_ENTRIES (512)' },
  MAX_ELECTIONS: { value: runtime.MAX_ELECTIONS, class: 'POPULATION', per: HANDS_PER_PRINCIPAL, why: 'one per filled role, and a role is a hand; was 2,048' },
  MAX_IN_FLIGHT_ELECTIONS: { value: runtime.MAX_IN_FLIGHT_ELECTIONS, class: 'POPULATION', per: MAX_QUEUED_PER_PRINCIPAL, why: 'one overlay row per queued elect at most; was 1,024' },
  MAX_GRANTS: { value: runtime.MAX_GRANTS, class: 'POPULATION', per: runtime.MAX_GRANTS_PER_PRINCIPAL, why: 'a LIFETIME book until expired-grant pruning lands; was 4,096 — flagged for pruning' },
  MAX_GRANT_SPENDS: { value: grantBook.MAX_GRANT_SPENDS, class: 'POPULATION', per: grantBook.GRANT_SPENDS_PER_PRINCIPAL, why: 'LIFETIME journal that throws (a halt) when full; was 16,384 — flagged for pruning' },
  MAX_GRANT_RELEASES: { value: grantBook.MAX_GRANT_RELEASES, class: 'POPULATION', per: grantBook.GRANT_SPENDS_PER_PRINCIPAL, why: 'the release journal, sized with the spend journal' },
  MAX_DOSSIERS: { value: dossier.MAX_DOSSIERS, class: 'POPULATION', per: dossier.DOSSIERS_PER_PRINCIPAL, why: 'LIFETIME, refuses when full; was 4,096' },
  MAX_OPEN_ORDERS: { value: marketBook.MAX_OPEN_ORDERS, class: 'POPULATION', per: marketBook.MAX_OPEN_ORDERS_PER_PRINCIPAL, why: 'every principal at its own cap; was 2,048' },
  MAX_LEVY_BALLOTS: { value: levy.MAX_LEVY_BALLOTS, class: 'POPULATION', per: levy.LEVY_RETAINED_RECKONINGS + 1, why: 'the original finding: one ballot per principal per retained Reckoning' },
  MAX_CHARGE_BALLOTS: { value: sovereignty.MAX_CHARGE_BALLOTS, class: 'POPULATION', per: sovereignty.SOVEREIGNTY_RETAINED_RECKONINGS + 1, why: 'MAX_LEVY_BALLOTS\' derivation; was 512 and threw inside the tick' },
  MAX_SYNDICATES: { value: syndicate.MAX_SYNDICATES, class: 'POPULATION', per: 1, why: 'one founding per principal; was 64' },
  MAX_COVERS: { value: risk.MAX_COVERS, class: 'POPULATION', per: risk.MAX_COVERS_PER_PAYER, why: 'every payer at its own cap; was 512' },
  MAX_INDEMNITIES: { value: risk.MAX_INDEMNITIES, class: 'POPULATION', per: 2 * risk.MAX_COVERS_PER_PAYER, why: 'two rows per cover at most' },
  MAX_BUFFERED_EVENTS: { value: MAX_BUFFERED_EVENTS, class: 'POPULATION', per: EVENTS_PER_PRINCIPAL_PER_TICK, why: 'rows one tick may write; overrunning it THROWS, which is a halt; was 8,192' },

  // ── map books: must clear per × MAX_MAP_SYSTEMS ─────────────────────────────
  MAX_CLAIMS: { value: sovereignty.MAX_CLAIMS, class: 'MAP', per: 1, why: 'one claim per system; was the launch map\'s 64' },
  MAX_FRAME_SWAY_LINES: { value: frames.MAX_FRAME_SWAY_LINES, class: 'MAP', per: 1, why: 'THE VERGE is a fence and cannot be sampled: one line per system; was 32' },

  // ── per-row bounds ──────────────────────────────────────────────────────────
  MAX_QUEUED_PER_PRINCIPAL: { value: MAX_QUEUED_PER_PRINCIPAL, class: 'PER_ROW', why: 'per principal' },
  MAX_OPEN_ORDERS_PER_PRINCIPAL: { value: marketBook.MAX_OPEN_ORDERS_PER_PRINCIPAL, class: 'PER_ROW', why: 'per principal' },
  MAX_COVERS_PER_PAYER: { value: risk.MAX_COVERS_PER_PAYER, class: 'PER_ROW', why: 'per payer' },
  MAX_GRANTS_PER_PRINCIPAL: { value: runtime.MAX_GRANTS_PER_PRINCIPAL, class: 'PER_ROW', why: 'the per-principal factor of MAX_GRANTS' },
  MAX_SYNDICATES_PER_PRINCIPAL: { value: syndicate.MAX_SYNDICATES_PER_PRINCIPAL, class: 'PER_ROW', why: 'memberships per principal' },
  MAX_HULLS_PER_PRINCIPAL: { value: combat.MAX_HULLS_PER_PRINCIPAL, class: 'PER_ROW', why: 'per principal' },
  MAX_SEALS_PER_PRINCIPAL_PER_RECKONING: { value: MAX_SEALS_PER_PRINCIPAL_PER_RECKONING, class: 'PER_ROW', why: 'per principal' },
  MAX_LIVE_INTENTS_PER_PRINCIPAL: { value: MAX_LIVE_INTENTS_PER_PRINCIPAL, class: 'PER_ROW', why: 'per principal' },
  MAX_PENDING_CORRECTIONS: { value: runtime.MAX_PENDING_CORRECTIONS, class: 'PER_ROW', why: 'per principal ring' },
  MAX_KEYS_PER_PRINCIPAL: { value: idem.MAX_KEYS_PER_PRINCIPAL, class: 'PER_ROW', why: 'per principal (host)' },
  MAX_ROLES_PER_VENTURE: { value: MAX_ROLES_PER_VENTURE, class: 'PER_ROW', why: 'per venture' },
  MAX_VENTURE_PREFERENCE: { value: runtime.MAX_VENTURE_PREFERENCE, class: 'PER_ROW', why: 'per venture' },
  MAX_DEFERRALS: { value: MAX_DEFERRALS, class: 'PER_ROW', why: 'per venture' },
  MAX_INDEMNITY_DEFERRALS: { value: MAX_INDEMNITY_DEFERRALS, class: 'PER_ROW', why: 'per indemnity' },
  MAX_MEMBERS: { value: syndicate.MAX_MEMBERS, class: 'PER_ROW', why: 'per syndicate' },
  MAX_OPEN_PROPOSALS: { value: syndicate.MAX_OPEN_PROPOSALS, class: 'PER_ROW', why: 'per syndicate' },
  MAX_CAMPAIGN_PARTIES: { value: campaign.MAX_CAMPAIGN_PARTIES, class: 'PER_ROW', why: 'per campaign' },
  MAX_RAID_PARTIES: { value: predation.MAX_RAID_PARTIES, class: 'PER_ROW', why: 'per raid' },
  MAX_SEIZE_LOTS: { value: predation.MAX_SEIZE_LOTS, class: 'PER_ROW', why: 'per seizure' },
  MAX_FORMATIONS_PER_SIDE: { value: combat.MAX_FORMATIONS_PER_SIDE, class: 'PER_ROW', why: 'per engagement side' },
  MAX_MODULES_PER_FIT: { value: combat.MAX_MODULES_PER_FIT, class: 'PER_ROW', why: 'per fit' },
  MAX_WRECKS_PER_ENGAGEMENT: { value: combat.MAX_WRECKS_PER_ENGAGEMENT, class: 'PER_ROW', why: 'per engagement' },
  MAX_TRACE_ENTRIES: { value: combat.MAX_TRACE_ENTRIES, class: 'PER_ROW', why: 'per engagement' },
  MAX_CARGO_GOODS: { value: MAX_CARGO_GOODS, class: 'PER_ROW', why: 'per hand' },
  MAX_HAUL_QTY: { value: MAX_HAUL_QTY, class: 'PER_ROW', why: 'per haul' },
  MAX_ORDER_QTY: { value: marketPlace.MAX_ORDER_QTY, class: 'PER_ROW', why: 'per order' },
  MAX_UNIT_PRICE: { value: marketPlace.MAX_UNIT_PRICE, class: 'PER_ROW', why: 'per order' },
  MAX_DURATION_TICKS: { value: marketPlace.MAX_DURATION_TICKS, class: 'PER_ROW', why: 'per order' },
  MAX_BAND_WIDTH: { value: intent.MAX_BAND_WIDTH, class: 'PER_ROW', why: 'per seal' },
  MAX_DELEGATION_DEPTH: { value: MAX_DELEGATION_DEPTH, class: 'PER_ROW', why: 'per grant chain' },
  MAX_CUSTODY_DEPTH: { value: dossier.MAX_CUSTODY_DEPTH, class: 'PER_ROW', why: 'per dossier chain' },
  MAX_CLASSIFY_DEPTH: { value: MAX_CLASSIFY_DEPTH, class: 'PER_ROW', why: 'per action' },
  MAX_ALTERNATE_REQUEST_TARGETS: { value: MAX_ALTERNATE_REQUEST_TARGETS, class: 'PER_ROW', why: 'per request' },
  MAX_ACTIONS_PER_BATCH: { value: server.MAX_ACTIONS_PER_BATCH, class: 'PER_ROW', why: 'per request' },
  MAX_BODY_BYTES: { value: limits.MAX_BODY_BYTES, class: 'PER_ROW', why: 'per request' },
  MAX_BODY_DEPTH: { value: wire.MAX_BODY_DEPTH, class: 'PER_ROW', why: 'per request' },
  MAX_DETAIL_LENGTH: { value: wire.MAX_DETAIL_LENGTH, class: 'PER_ROW', why: 'per refusal' },
  MAX_REPORT_LENGTH: { value: server.MAX_REPORT_LENGTH, class: 'PER_ROW', why: 'per report' },
  MAX_KEY_LENGTH: { value: idem.MAX_KEY_LENGTH, class: 'PER_ROW', why: 'per key' },
  MAX_HANDLE_LENGTH: { value: MAX_HANDLE_LENGTH, class: 'PER_ROW', why: 'per handle' },
  MAX_EMAIL_LENGTH: { value: follow.MAX_EMAIL_LENGTH, class: 'PER_ROW', why: 'per address' },
  MAX_NAME_CHARS: { value: MAX_NAME_CHARS, class: 'PER_ROW', why: 'per syndicate name' },
  MAX_REASON_LENGTH: { value: runtime.MAX_REASON_LENGTH, class: 'PER_ROW', why: 'per reason' },
  MAX_MESSAGE_LENGTH: { value: runtime.MAX_MESSAGE_LENGTH, class: 'PER_ROW', why: 'per message' },
  MAX_PARLEY_LENGTH: { value: parley.MAX_PARLEY_LENGTH, class: 'PER_ROW', why: 'per parley' },
  // ── Season 1's contact lane ──
  MAX_PARLEYS_SENT_PER_RECKONING: { value: parley.MAX_PARLEYS_SENT_PER_RECKONING, class: 'PER_ROW', why: 'parleys one principal may send a Reckoning, answers and openings together' },
  MAX_DIRECTORY_SEEKING: { value: directory.MAX_DIRECTORY_SEEKING, class: 'PER_ROW', why: 'forming ventures listed on one directory row; the rest are counted' },
  MAX_FRAME_PARLEY_EXCERPT: { value: frames.MAX_FRAME_PARLEY_EXCERPT, class: 'PER_ROW', why: 'characters of one parley thread — the ticker\'s own bound' },
  MAX_MAIL_EXCERPT: { value: prompt.MAX_MAIL_EXCERPT, class: 'PER_ROW', why: 'characters of one waiting letter the cast prompt quotes; the whole letter is in the header' },
  MAX_PROSE_LENGTH: { value: intent.MAX_PROSE_LENGTH, class: 'PER_ROW', why: 'per seal' },
  MAX_TARGET_LENGTH: { value: intent.MAX_TARGET_LENGTH, class: 'PER_ROW', why: 'per seal' },
  MAX_DIGEST_CHARS: { value: MAX_DIGEST_CHARS, class: 'PER_ROW', why: 'per dossier' },
  MAX_PARAM_LIST: { value: MAX_PARAM_LIST, class: 'PER_ROW', why: 'per param' },
  MAX_PARAM_STRING: { value: parse.MAX_PARAM_STRING, class: 'PER_ROW', why: 'per cast param' },
  MAX_PARAM_KEYS: { value: parse.MAX_PARAM_KEYS, class: 'PER_ROW', why: 'per cast action' },
  MAX_PARAM_ARRAY: { value: parse.MAX_PARAM_ARRAY, class: 'PER_ROW', why: 'per cast param' },
  MAX_NOTE_CHARS: { value: parse.MAX_NOTE_CHARS, class: 'PER_ROW', why: 'per cast note' },
  MAX_REPLY_CHARS: { value: parse.MAX_REPLY_CHARS, class: 'PER_ROW', why: 'per model reply' },
  MAX_CONTRACT_CHARS: { value: prompt.MAX_CONTRACT_CHARS, class: 'PER_ROW', why: 'per cast prompt' },
  MAX_OBSERVATION_CHARS: { value: prompt.MAX_OBSERVATION_CHARS, class: 'PER_ROW', why: 'per cast prompt' },
  MAX_PHRASE_CHARS: { value: tokens.MAX_PHRASE_CHARS, class: 'PER_ROW', why: 'per phrase' },
  MAX_LINE_CHARS: { value: tokens.MAX_LINE_CHARS, class: 'PER_ROW', why: 'per line' },
  MAX_FORECLOSE_ENTRIES: { value: tokens.MAX_FORECLOSE_ENTRIES, class: 'PER_ROW', why: 'per affordance' },
  MAX_ROW_ITEMS: { value: MAX_ROW_ITEMS, class: 'PER_ROW', why: 'per say-do row' },
  MAX_RECAP_EVENTS: { value: recap.MAX_RECAP_EVENTS, class: 'PER_ROW', why: 'per recap email' },
  MAX_RECAP_AHEAD: { value: recap.MAX_RECAP_AHEAD, class: 'PER_ROW', why: 'per recap email' },
  MAX_RECAP_ATTEMPTS: { value: followWorker.MAX_RECAP_ATTEMPTS, class: 'PER_ROW', why: 'per recap' },

  // ── legibility budgets: a viewer's limit, deliberately flat ────────────────
  MAX_LABELS_PER_FRAME: { value: frames.MAX_LABELS_PER_FRAME, class: 'LEGIBILITY', why: '§17: seven labels a frame' },
  MAX_DOCKET_CARDS: { value: frames.MAX_DOCKET_CARDS, class: 'LEGIBILITY', why: '§17' },
  MAX_RUNDOWN_SEGMENTS: { value: frames.MAX_RUNDOWN_SEGMENTS, class: 'LEGIBILITY', why: '§17' },
  MAX_AUTHORITY_LINES: { value: frames.MAX_AUTHORITY_LINES, class: 'LEGIBILITY', why: 'frame' },
  MAX_RAID_LINES: { value: frames.MAX_RAID_LINES, class: 'LEGIBILITY', why: 'frame' },
  MAX_FRAME_CLAIM_LINES: { value: frames.MAX_FRAME_CLAIM_LINES, class: 'LEGIBILITY', why: 'frame' },
  MAX_FRAME_SAP_LINES: { value: frames.MAX_FRAME_SAP_LINES, class: 'LEGIBILITY', why: 'frame' },
  MAX_FRAME_WORKS_LINES: { value: frames.MAX_FRAME_WORKS_LINES, class: 'LEGIBILITY', why: 'frame' },
  MAX_FRAME_SYNDICATE_LINES: { value: frames.MAX_FRAME_SYNDICATE_LINES, class: 'LEGIBILITY', why: 'frame' },
  MAX_FRAME_RUINS: { value: frames.MAX_FRAME_RUINS, class: 'LEGIBILITY', why: 'frame' },
  MAX_FRAME_MARKET_LINES: { value: frames.MAX_FRAME_MARKET_LINES, class: 'LEGIBILITY', why: 'frame' },
  MAX_FRAME_BATTLE_LINES: { value: frames.MAX_FRAME_BATTLE_LINES, class: 'LEGIBILITY', why: 'frame' },
  MAX_FRAME_FRONT_BANDS: { value: frames.MAX_FRAME_FRONT_BANDS, class: 'LEGIBILITY', why: 'frame' },
  MAX_FRAME_COVER_ARCS: { value: frames.MAX_FRAME_COVER_ARCS, class: 'LEGIBILITY', why: 'frame' },
  MAX_FRAME_COVER_CHAINS: { value: frames.MAX_FRAME_COVER_CHAINS, class: 'LEGIBILITY', why: 'frame' },
  MAX_BATTLE_FORMATIONS: { value: frames.MAX_BATTLE_FORMATIONS, class: 'LEGIBILITY', why: 'frame' },
  MAX_LINE_DOSSIERS: { value: frames.MAX_LINE_DOSSIERS, class: 'LEGIBILITY', why: 'frame' },
  MAX_FRAME_CONVOY_LINES: { value: frames.MAX_FRAME_CONVOY_LINES, class: 'LEGIBILITY', why: 'frame' },
  MAX_FRAME_COMPACT_LINKS: { value: frames.MAX_FRAME_COMPACT_LINKS, class: 'LEGIBILITY', why: 'frame' },
  MAX_FRONT_BANDS: { value: riskLines.MAX_FRONT_BANDS, class: 'LEGIBILITY', why: 'frame' },
  MAX_COVER_ARCS: { value: riskLines.MAX_COVER_ARCS, class: 'LEGIBILITY', why: 'frame' },
  MAX_COVER_CHAIN_LINKS: { value: riskLines.MAX_COVER_CHAIN_LINKS, class: 'LEGIBILITY', why: 'frame' },
  MAX_CLAIM_LINES: { value: sovereignty.MAX_CLAIM_LINES, class: 'LEGIBILITY', why: 'frame' },
  MAX_SAP_LINES: { value: campaign.MAX_SAP_LINES, class: 'LEGIBILITY', why: 'frame' },
  MAX_VIEW_FORMATIONS: { value: combatView.MAX_VIEW_FORMATIONS, class: 'LEGIBILITY', why: 'observation' },
  MAX_VIEW_CONTACTS: { value: combatView.MAX_VIEW_CONTACTS, class: 'LEGIBILITY', why: 'observation' },
  MAX_VIEW_TRACE: { value: combatView.MAX_VIEW_TRACE, class: 'LEGIBILITY', why: 'observation' },
  MAX_AFFORDANCES: { value: observe.MAX_AFFORDANCES, class: 'LEGIBILITY', why: 'observation (§12.1)' },
  MAX_LIST_ROWS: { value: observe.MAX_LIST_ROWS, class: 'LEGIBILITY', why: 'observation' },
  MAX_DOSSIER_OFFERS: { value: observe.MAX_DOSSIER_OFFERS, class: 'LEGIBILITY', why: 'observation' },
  MAX_PARLEY_AFFORDANCES: { value: observe.MAX_PARLEY_AFFORDANCES, class: 'LEGIBILITY', why: 'observation' },
  MAX_LEVY_CARRY_OFFERS: { value: levy.MAX_LEVY_CARRY_OFFERS, class: 'LEGIBILITY', why: 'observation' },
  MAX_GRANT_OFFERS: { value: runtime.MAX_GRANT_OFFERS, class: 'LEGIBILITY', why: 'observation' },
  MAX_RELATIONS: { value: runtime.MAX_RELATIONS, class: 'LEGIBILITY', why: 'observation' },
  MAX_MARKET_ROWS: { value: runtime.MAX_MARKET_ROWS, class: 'LEGIBILITY', why: 'observation' },
  MAX_REACH_ROWS: { value: MAX_REACH_ROWS, class: 'LEGIBILITY', why: 'observation' },
  MAX_AWAITING_SHOWN: { value: parley.MAX_AWAITING_SHOWN, class: 'LEGIBILITY', why: 'observation: letters header.parley.awaiting_reply quotes in full; the rest are counted' },
  MAX_DIRECTORY_ROWS: { value: directory.MAX_DIRECTORY_ROWS, class: 'LEGIBILITY', why: 'observation: ventures.directory rows for the reader\'s constellation; the rest are counted' },
  MAX_FRAME_DIRECTORY_LINES: { value: frames.MAX_FRAME_DIRECTORY_LINES, class: 'LEGIBILITY', why: 'frame: THE DEALING MARK across every constellation — a grown map shares the same 16, which is a viewer\'s limit' },
  MAX_FRAME_DIRECTORY_PER_CONSTELLATION: { value: frames.MAX_FRAME_DIRECTORY_PER_CONSTELLATION, class: 'LEGIBILITY', why: 'frame: so one busy stage cannot fill the panel' },
  MAX_FRAME_PARLEY_LINES: { value: frames.MAX_FRAME_PARLEY_LINES, class: 'LEGIBILITY', why: 'frame: declassified parleys, newest first' },
  MAX_PLANS: { value: MAX_PLANS, class: 'LEGIBILITY', why: 'observation (the unwired rival)' },
  // ── Season 1's season lane: what a frame and a header list of the season, never the record ──
  MAX_FRAME_GRAND_CANDIDATES: { value: frames.MAX_FRAME_GRAND_CANDIDATES, class: 'LEGIBILITY', why: 'frame: grand candidates, largest public stake first' },
  MAX_FRAME_SEASONS: { value: frames.MAX_FRAME_SEASONS, class: 'LEGIBILITY', why: 'frame: closed seasons, newest first — the record is the season.closed rows' },
  MAX_FRAME_SEASON_RECORDS: { value: season.MAX_FRAME_SEASON_RECORDS, class: 'LEGIBILITY', why: 'the frame\'s season records, newest first' },
  MAX_LISTED_GRAND_CANDIDATES: { value: season.MAX_LISTED_GRAND_CANDIDATES, class: 'LEGIBILITY', why: 'header.season.grand: candidates listed, largest stake first; one prize per season whatever the population' },

  // ── retention: recent history whose window narrows with volume ──────────────
  MAX_TALK_ENTRIES: { value: runtime.MAX_TALK_ENTRIES, class: 'RETENTION', why: 'the negotiation ring; at volume a venture\'s messages can age out before its settlement reads them for the receipt reel — flagged' },
  MAX_OFFER_ENTRIES: { value: runtime.MAX_OFFER_ENTRIES, class: 'RETENTION', why: 'published offers, display only' },
  MAX_CLAIM_ENTRIES: { value: runtime.MAX_CLAIM_ENTRIES, class: 'RETENTION', why: 'public statements, display only' },
  MAX_RAID_TICKER_LINES: { value: runtime.MAX_RAID_TICKER_LINES, class: 'RETENTION', why: 'ticker' },
  MAX_RECKONING_SUMMARIES: { value: runtime.MAX_RECKONING_SUMMARIES, class: 'RETENTION', why: 'Reckonings, not rows' },
  MAX_TABLE_FAULTS: { value: runtime.MAX_TABLE_FAULTS, class: 'RETENTION', why: 'operator log' },
  MAX_CLOSED_ORDERS: { value: marketBook.MAX_CLOSED_ORDERS, class: 'RETENTION', why: 'display history of closed orders' },
  MAX_RAID_ROWS: { value: predation.MAX_RAID_ROWS, class: 'RETENTION', why: 'resolved raids pruned beyond it' },
  MAX_ENGAGEMENT_ROWS: { value: combat.MAX_ENGAGEMENT_ROWS, class: 'RETENTION', why: 'closed engagements pruned beyond it' },
  MAX_CAMPAIGNS: { value: campaign.MAX_CAMPAIGNS, class: 'RETENTION', why: 'campaign rows incl. ended ones' },
  MAX_FRONTS: { value: risk.MAX_FRONTS, class: 'RETENTION', why: 'fronts on record' },
  MAX_LEVY_ASSESSMENTS: { value: levy.MAX_LEVY_ASSESSMENTS, class: 'RETENTION', why: 'no longer caps an assessment (levy/params.ts says why); kept as the figure the old cliff sat at' },
  MAX_SEASON_RECORDS: { value: season.MAX_SEASON_RECORDS, class: 'RETENTION', why: 'closed seasons on the book\'s working list (~2.5 years at production pace); each close is a PUBLIC season.closed row that never leaves the record, and SSN-4 reads only contiguity, which eviction from the front keeps — counted in seasons, not principals' },

  // ── drama budgets: world-wide, flat by design today ─────────────────────────
  MAX_LIVE_RAIDS: { value: predation.MAX_LIVE_RAIDS, class: 'DRAMA', why: 'six live standoffs galaxy-wide — at thousands of principals agent demands queue behind each other; per-constellation scaling is an owner call (it moves MAX_RAID_LINES too)' },
  MAX_LIVE_CAMPAIGNS: { value: campaign.MAX_LIVE_CAMPAIGNS, class: 'DRAMA', why: 'four live wars galaxy-wide; same call' },
  MAX_LIVE_ENGAGEMENTS: { value: combat.MAX_LIVE_ENGAGEMENTS, class: 'DRAMA', why: 'four live battles galaxy-wide; same call' },
  MAX_LIVE_FRONTS: { value: risk.MAX_LIVE_FRONTS, class: 'DRAMA', why: 'one scheduled catastrophe at a time (A14)' },

  // ── host: the API process, sized from the seats ─────────────────────────────
  MAX_KEYS_TOTAL: { value: idem.MAX_KEYS_TOTAL, class: 'HOST', why: 'the module default only; createApp sizes the store at MAX_KEYS_PER_PRINCIPAL × seats' },
  MAX_TRACKED_CLIENTS: { value: limits.MAX_TRACKED_CLIENTS, class: 'HOST', why: 'per client IP, not per principal' },
  MAX_DISCREPANCIES: { value: server.MAX_DISCREPANCIES, class: 'HOST', why: 'operator ring' },
  MAX_QUEUED_REQUESTS: { value: followService.MAX_QUEUED_REQUESTS, class: 'HOST', why: 'follow-by-email queue (owned by the follow lane)' },
  MAX_RECAPS_PER_RUN: { value: followWorker.MAX_RECAPS_PER_RUN, class: 'HOST', why: 'follow-by-email worker batch' },
  MAX_LIVE_QUOTES: { value: MAX_LIVE_QUOTES, class: 'HOST', why: 'the unwired `src/observe/` rival\'s quote store; evicts' },

  // ── flagged ─────────────────────────────────────────────────────────────────
  MAX_PARLEY_ENTRIES: {
    value: parley.MAX_PARLEY_ENTRIES,
    class: 'FLAGGED',
    why:
      'a Ring whose size saturates at its capacity, and `parleyRefusal` refuses once it is full — so the 513th parley ' +
      'of the WORLD\'S LIFE is refused, and every one after it, at any population. Season 1\'s contact lane bounds the ' +
      'RATE (MAX_PARLEYS_SENT_PER_RECKONING) and made the book captured world state, not the lifetime; the refusal is ' +
      'load-bearing for A15, because the opening allowance and the sends ceiling are counted off this book, so letting ' +
      'the ring evict would hand a busy world free openings. An owner call: a per-principal count or a population-sized book',
  },
  MAX_FILLS: {
    value: marketBook.MAX_FILLS,
    class: 'FLAGGED',
    why:
      'the fill ring the valuation window reads; past ~40 fills a tick the 48-tick window outruns it and the mark ' +
      'loses prints — a computation reading an evicted row. Measured volume at 3,000 principals is far below that',
  },
  MAX_TRIBUTE_LINES: {
    value: levy.MAX_TRIBUTE_LINES,
    class: 'FLAGGED',
    why: 'one tribute line per assessed principal is the Levy\'s pixel signature (A13), and past 512 principals the frame drops lines — an aggregation is a design call',
  },
};

// ── the completeness half ────────────────────────────────────────────────────

const SRC = new URL('../../src/', import.meta.url).pathname;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...tsFiles(path));
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

const DECLARED = new Set<string>();
for (const file of tsFiles(SRC)) {
  for (const m of readFileSync(file, 'utf8').matchAll(/^export const (MAX_[A-Z0-9_]+)\b/gm)) {
    if (m[1] !== undefined) DECLARED.add(m[1]);
  }
}

describe('every published cap in src/ is classified', () => {
  it('names every `export const MAX_*` in the table, and nothing the code no longer declares', () => {
    // MUTATION: add `export const MAX_ANYTHING = 1` anywhere under src/ — RED until it is classified.
    const byName = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
    const missing = [...DECLARED].filter((name) => CAPS[name] === undefined).sort(byName);
    const stale = Object.keys(CAPS).filter((name) => !DECLARED.has(name)).sort(byName);
    expect(missing, 'unclassified caps: argue each one in CAPS before it ships').toEqual([]);
    expect(stale, 'caps in the table that src/ no longer declares').toEqual([]);
    expect(DECLARED.size).toBeGreaterThan(100); // the walk really read the tree
  });

  it('carries a reason for every entry and a positive integer value', () => {
    for (const [name, cap] of Object.entries(CAPS)) {
      expect(Number.isSafeInteger(cap.value) && cap.value > 0, `${name} = ${String(cap.value)}`).toBe(true);
      expect(cap.why.length, `${name} has no reason`).toBeGreaterThan(0);
    }
  });
});

describe('no population or map book can bind on legitimate play below its ceiling', () => {
  it('every POPULATION book clears per × MAX_PRINCIPALS', () => {
    // MUTATION: put any of the six derived caps back to its flat Phase 0 figure — RED, naming it.
    for (const [name, cap] of Object.entries(CAPS)) {
      if (cap.class !== 'POPULATION') continue;
      expect(cap.per, `${name} has no per-principal bound`).toBeGreaterThan(0);
      expect(cap.value, `${name} binds below ${String(cap.per)} × ${String(MAX_PRINCIPALS)}`).toBeGreaterThanOrEqual(
        (cap.per ?? 0) * MAX_PRINCIPALS,
      );
    }
  });

  it('every MAP book clears per × MAX_MAP_SYSTEMS', () => {
    for (const [name, cap] of Object.entries(CAPS)) {
      if (cap.class !== 'MAP') continue;
      expect(cap.value, `${name} binds below the map ceiling`).toBeGreaterThanOrEqual((cap.per ?? 0) * MAX_MAP_SYSTEMS);
    }
  });

  it('the map can stage the world ceiling at the stage floor, and the launch map fits inside it', () => {
    expect(MAX_MAP_SYSTEMS * GROWTH_QUALIFIED_PER_SYSTEM).toBeGreaterThanOrEqual(MAX_PRINCIPALS);
    expect(MAX_MAP_SYSTEMS).toBeGreaterThan(LAUNCH_SYSTEM_BOUNDS.max);
  });

  it('a legibility budget did not grow with the population', () => {
    // §17: labels per frame is a viewer's limit. If someone "fixes" a frame budget by deriving it from
    // the population, the frame becomes a screensaver of names.
    expect(frames.MAX_LABELS_PER_FRAME).toBe(7);
    for (const [name, cap] of Object.entries(CAPS)) {
      if (cap.class !== 'LEGIBILITY') continue;
      expect(cap.value, `${name} looks population-sized`).toBeLessThanOrEqual(64);
    }
  });
});

describe('the host\'s seats are decoupled from the world\'s ceiling, and bounded by it', () => {
  it('launches below the ceiling, so a host can raise its seats by configuration', () => {
    expect(DEFAULT_SEATS).toBeGreaterThan(300);
    expect(DEFAULT_SEATS).toBeLessThan(MAX_PRINCIPALS);
  });

  it('reads COMPACT_SEATS strictly: absent is the default, a bad value or one above the ceiling is refused', () => {
    expect(seatCapacityFrom(undefined)).toBe(DEFAULT_SEATS);
    expect(seatCapacityFrom('')).toBe(DEFAULT_SEATS);
    expect(seatCapacityFrom(' 1200 ')).toBe(1200);
    expect(seatCapacityFrom(String(MAX_PRINCIPALS))).toBe(MAX_PRINCIPALS);
    expect(() => seatCapacityFrom('0')).toThrow();
    expect(() => seatCapacityFrom('-5')).toThrow();
    expect(() => seatCapacityFrom('12.5')).toThrow();
    expect(() => seatCapacityFrom('lots')).toThrow();
    // MUTATION: drop the ceiling check — a host could seat principals no book was sized for. RED.
    expect(() => seatCapacityFrom(String(MAX_PRINCIPALS + 1))).toThrow(/ceiling/);
  });

  it('refuses a SeatBook larger than the world, whoever builds it', () => {
    expect(() => new SeatBook(MAX_PRINCIPALS + 1)).toThrow(/ceiling/);
    expect(new SeatBook(MAX_PRINCIPALS).capacity).toBe(MAX_PRINCIPALS);
  });
});
