/**
 * THE DIRECTORY — **who is dealing in one constellation, what each is offering or seeking, and the
 * public record a stranger would price it by.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE DEFECT THIS ANSWERS: FINDING A COUNTERPARTY WAS LUCK.**
 *
 * A design review on 2026-10-01 measured blind probes managing at most five to seven counterparties
 * across a whole run, and named the cause in one line: *there is no public place that says who is
 * dealing.* An agent could read the venture board (only the slots it is eligible for), the market's
 * last twenty-four offers (galaxy-wide, with no record beside them) and its own `counterparties[]`
 * (only principals it had already dealt with or could already address). Nothing answered the question
 * an agent actually asks before it commits a hand: *who near me wants something done, and have they
 * kept their word?*
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── WHY THIS IS NOT "AN OPEN DIRECTORY OF EVERY ENROLLED PRINCIPAL" ──────────
 *
 * `say/reach.ts` rejects that phrase, and the rejection stands. An open address book is A15-unpriced:
 * enrolment is free, so a list of everybody is a list N free identities appear in for nothing, and if
 * appearing in it bought the right to be ADDRESSED the correct play would be to broadcast at all of
 * them. Three properties keep this list on the other side of that line:
 *
 *   1. **Listing reaches nobody.** A row is information, never a channel. To address a listed
 *      principal the reader still needs a reach rung and an allowance (`say/reach.ts`,
 *      `say/parley.ts`); the observation names which rung, if any, beside each row. A Sybil that
 *      gets itself listed has bought a line of text a reader may ignore.
 *   2. **It is bounded by the MAP, not by the population.** One constellation — §4.2's political
 *      unit, 5–8 systems — and only principals whose HOLDING stands in it, which is a `PUBLIC` fact
 *      and the same scope `reach.ts`'s campaign clause already uses.
 *   3. **It ranks by RECORD, so free identities sink.** Inside each band the order is elective
 *      promises honoured with *distinct* counterparties first — `standing.distinctCounterparties`, the
 *      vector scar #9 hardened against duplicate dealing — then promises kept, then recency. A fresh
 *      identity has zero of the first two by construction. It is credit withheld, never an accusation
 *      (A15): a zero-record newcomer is listed honestly, below everybody who has a record, and the
 *      cap's `unlisted` count says how many more there are.
 *
 * ── WHAT "DEALING" MEANS, AND WHY EACH CLAUSE IS PUBLIC ─────────────────────
 *
 * A principal is listed when at least one of these is true, and every one is a fact §11.2 already
 * assigns to `PUBLIC`:
 *
 *   - **offering** — it published an offer (`publish_offer`) within {@link DIRECTORY_OFFER_FRESH_TICKS}.
 *     §11.2: *"published offers"* are `PUBLIC`; `market.offers` already serves them galaxy-wide.
 *   - **seeking** — a venture it created is still `FORMING` with a role unfilled. `venture.formed` and
 *     `venture.role_filled` are `PUBLIC` rows, and the live frame already draws the empty socket.
 *   - **at work** — it holds a role in, or created, a venture that is `LIVE`. The ring's filled pips
 *     are the same fact on the map.
 *
 * Soliciting principals (offering or seeking) rank ahead of principals who are merely at work,
 * because a solicitation is the thing a reader can respond to.
 *
 * **What a row may never carry**, each considered: any principal's stores, escrow, balance or goods
 * (`SENSED` — *"a ship at sea is visible; its manifest is not"*); where its hands are (`SENSED`, and
 * `world/sway.ts` refuses hands as an input for exactly this reason); anything it said in private
 * (`PARTIES`); a score (§3: STANDING is the factual vectors, never a score — the row carries the
 * vectors and the order is a presentation, not a verdict).
 *
 * ── ONE BUILDER, TWO READERS ─────────────────────────────────────────────────
 *
 * `api/observe.ts` publishes the reader's own constellation as `ventures.directory`; the spectator
 * frames publish every constellation as `directoryLines`. Both call {@link directoryFor} so a viewer
 * and an agent cannot be shown two different lists of who is dealing — A9's parity by construction,
 * the same discipline `raidLinesFor` keeps.
 */

import { TICKS_PER_RECKONING } from '../core/time.js';
import type { PrincipalId, SystemId, VentureKind } from '../core/types.js';
import { compareIds } from '../ledger/order.js';

/** Rows `observe` publishes for the reader's constellation (INV-26). The rest are counted. */
export const MAX_DIRECTORY_ROWS = 8;

/**
 * How long a published offer keeps a principal listed as OFFERING, in ticks. *(calibrate)*
 *
 * One Reckoning-length, deliberately rolling rather than cut at the boundary: an offer posted an hour
 * before the settlement is still an offer the next morning, and a boundary cut would make the same
 * sentence an advertisement at tick 286 and nothing at tick 288. Also the window `reach.ts`'s OFFER
 * rung reads, through {@link freshOfferOf}, so "listed as offering" and "addressable as an advertiser"
 * are one fact rather than two clocks.
 */
export const DIRECTORY_OFFER_FRESH_TICKS = TICKS_PER_RECKONING;

/** Forming ventures listed per row. A principal recruiting for more is counted, not listed. */
export const MAX_DIRECTORY_SEEKING = 3;

/** One forming venture with a role still open, in the only shape the directory needs. */
export interface DirectoryVenture {
  readonly venture: string;
  readonly kind: VentureKind;
  readonly stage: SystemId;
  readonly creator: PrincipalId;
  /** The role labels still unfilled, in template order. */
  readonly open: readonly string[];
  /** Every role the kind has. `open.length` of `roles` is how far it is from forming. */
  readonly roles: number;
  /** The tick its formation window closes; unfilled at that tick it retires ABANDONED. */
  readonly closesTick: number;
}

/**
 * The public record beside a row: §6.4's factual vectors, never a score.
 *
 * Every field carries its unit in its name in the observation (`one-word-two-units.spec.ts`); here
 * they are counts except `bondMinor`.
 */
export interface DirectoryRecord {
  /** Elective promises honoured — `standing.elective_honoured`. */
  readonly kept: number;
  /** Defaults on the record — `standing.defaults`. */
  readonly broke: number;
  /** Distinct counterparties it has honoured an elective promise to — the anti-farm term. */
  readonly counterparties: number;
  readonly lastDefaultTick: number | null;
  /** Posted, slashable bond (§6.4: *"public, and any amount — it is your credit rating"*). */
  readonly bondMinor: number;
}

/** What the directory reads. Narrow on purpose: the signature is the enumeration (`D21`). */
export interface DirectoryPort {
  /** Every seated principal and the system its HOLDING stands on, in canonical principal order. */
  readonly seated: () => readonly { readonly principal: PrincipalId; readonly system: SystemId }[];
  readonly constellationOf: (system: SystemId) => string;
  /** The prose offer book, oldest first. */
  readonly offers: () => readonly { readonly by: PrincipalId; readonly text: string; readonly tick: number }[];
  /** Ventures still `FORMING` with at least one role open, by creator. */
  readonly forming: () => readonly DirectoryVenture[];
  /** Roles held in, plus ventures run as creator, among `LIVE` ventures — per principal. */
  readonly liveRoles: () => ReadonlyMap<PrincipalId, number>;
  readonly record: (principal: PrincipalId) => DirectoryRecord;
}

/** One listed principal. */
export interface DirectoryRow {
  readonly principal: PrincipalId;
  readonly constellation: string;
  /** Where its HOLDING stands. */
  readonly at: SystemId;
  /** Its latest offer, if fresh; `null` otherwise. */
  readonly offering: { readonly text: string; readonly tick: number } | null;
  /** Ventures it is recruiting for, nearest-to-closing first, capped at {@link MAX_DIRECTORY_SEEKING}. */
  readonly seeking: readonly DirectoryVenture[];
  /** How many more forming ventures it is recruiting for than `seeking` lists. */
  readonly seekingUnlisted: number;
  /** Live roles held and live ventures run. Work in progress, not an invitation. */
  readonly liveRoles: number;
  readonly record: DirectoryRecord;
  /** The most recent public act this row is listed on — the recency tiebreak, and a fact. */
  readonly latestTick: number;
}

export interface Directory {
  readonly constellation: string;
  readonly rows: readonly DirectoryRow[];
  /** Dealing principals the cap left off. Present at zero, because "nobody else" must be sayable. */
  readonly unlisted: number;
  /** Seated principals in the constellation, dealing or not. The denominator. */
  readonly seated: number;
}

/**
 * A principal's latest offer, if it is still fresh at `tick`. **One home** for the freshness rule:
 * the directory lists by it and `reach.ts`'s OFFER rung addresses by it.
 */
export function freshOfferOf(
  offers: readonly { readonly by: PrincipalId; readonly text: string; readonly tick: number }[],
  principal: PrincipalId,
  tick: number,
): { readonly text: string; readonly tick: number } | null {
  let latest: { readonly text: string; readonly tick: number } | null = null;
  for (const offer of offers) {
    if (offer.by !== principal) continue;
    if (offer.tick > tick) continue;
    if (latest === null || offer.tick >= latest.tick) latest = { text: offer.text, tick: offer.tick };
  }
  if (latest === null) return null;
  return tick - latest.tick <= DIRECTORY_OFFER_FRESH_TICKS ? latest : null;
}

/** Is this row soliciting — something a reader can respond to — rather than only at work? */
export function isSoliciting(row: Pick<DirectoryRow, 'offering' | 'seeking'>): boolean {
  return row.offering !== null || row.seeking.length > 0;
}

/**
 * The canonical order. Soliciting first; then the record, strongest first; then the most recent act;
 * then the id, so two calls in one observation can never disagree.
 *
 * Exported so the frame and the observation sort with one comparator — two comparators is how a
 * viewer and an agent end up reading different "top eight".
 */
export function compareDirectoryRows(a: DirectoryRow, b: DirectoryRow): number {
  return (
    Number(isSoliciting(b)) - Number(isSoliciting(a)) ||
    b.record.counterparties - a.record.counterparties ||
    b.record.kept - a.record.kept ||
    b.latestTick - a.latestTick ||
    compareIds(a.principal, b.principal)
  );
}

/**
 * Every DEALING principal seated in `constellation`, in canonical order, uncapped.
 *
 * `exclude` drops the reader from its own directory: §3 says a counterparty is somebody you deal
 * with, and the reader's own record is already on `header.standing`.
 */
export function dealingIn(
  port: DirectoryPort,
  constellation: string,
  tick: number,
  exclude: PrincipalId | null = null,
): { readonly rows: readonly DirectoryRow[]; readonly seated: number } {
  const offers = port.offers();
  const forming = port.forming();
  const working = port.liveRoles();
  const seekingBy = new Map<PrincipalId, DirectoryVenture[]>();
  for (const venture of forming) {
    if (venture.open.length === 0) continue;
    const list = seekingBy.get(venture.creator) ?? [];
    list.push(venture);
    seekingBy.set(venture.creator, list);
  }

  const rows: DirectoryRow[] = [];
  let seated = 0;
  for (const { principal, system } of port.seated()) {
    if (port.constellationOf(system) !== constellation) continue;
    seated += 1;
    if (principal === exclude) continue;
    const offering = freshOfferOf(offers, principal, tick);
    const recruiting = [...(seekingBy.get(principal) ?? [])].sort(
      (a, b) => a.closesTick - b.closesTick || compareIds(a.venture, b.venture),
    );
    const liveRoles = working.get(principal) ?? 0;
    if (offering === null && recruiting.length === 0 && liveRoles === 0) continue;
    const seeking = recruiting.slice(0, MAX_DIRECTORY_SEEKING);
    // The most recent act the row is listed ON. A forming venture's window opens
    // `FORMATION_WINDOW_TICKS` before it closes; the close is what the row publishes, so the
    // recency key uses it rather than re-deriving an open tick this module cannot see.
    const latestTick = Math.max(
      offering?.tick ?? -1,
      ...recruiting.map((v) => v.closesTick),
      -1,
    );
    rows.push({
      principal,
      constellation,
      at: system,
      offering,
      seeking,
      seekingUnlisted: Math.max(0, recruiting.length - seeking.length),
      liveRoles,
      record: port.record(principal),
      latestTick,
    });
  }
  rows.sort(compareDirectoryRows);
  return { rows, seated };
}

/** The directory of one constellation, capped at `limit` rows with the remainder counted. */
export function directoryFor(
  port: DirectoryPort,
  constellation: string,
  tick: number,
  limit: number = MAX_DIRECTORY_ROWS,
  exclude: PrincipalId | null = null,
): Directory {
  const { rows, seated } = dealingIn(port, constellation, tick, exclude);
  const kept = rows.slice(0, Math.max(0, limit));
  return { constellation, rows: kept, unlisted: rows.length - kept.length, seated };
}

/**
 * The sentence an agent reads beside the rows. States what the list is, what it is not, and how to
 * get onto it — A2's "never make an agent need a wiki", applied to a list whose most important
 * property is the thing it does NOT grant.
 */
export function directoryRule(directory: Directory): string {
  const count =
    directory.rows.length === 0
      ? `Nobody in ${directory.constellation} is dealing right now (${String(directory.seated)} seated).`
      : `${String(directory.rows.length + directory.unlisted)} of the ${String(directory.seated)} principals ` +
        `seated in ${directory.constellation} are dealing` +
        (directory.unlisted > 0 ? `; ${String(directory.unlisted)} more are not listed here.` : '.');
  return (
    `${count} A row is listed for a fresh offer (publish_offer, within ` +
    `${String(DIRECTORY_OFFER_FRESH_TICKS)} ticks), a venture it is still recruiting for, or a live role. ` +
    'Soliciting rows come first, then by record — promises kept to DISTINCT counterparties, then promises ' +
    'kept — so a fresh identity sinks and a long honest record rises. It is PUBLIC: every agent and every ' +
    'viewer reads the same rows. Being listed reaches nobody: `parley` on a row names the reach rung that ' +
    'lets you address it, or null, and a recruiting venture can always be answered with `message {venture}` ' +
    'or `fill_role`. Publish an offer to be listed yourself.'
  );
}
