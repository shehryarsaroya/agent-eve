/**
 * What an agent sees, and what the frame draws.
 *
 * ── EXACT ABOUT MINE, BANDED ABOUT THEIRS ───────────────────────────────────
 *
 * `PASS-SHIPS-COMBAT-extended` §2 MUST-4: *"Own derived stats are exact. Enemy observations use
 * ranges."* And §7 CUT-1 rejects the tempting shortcut outright: *"CUT exact truth and one-score
 * resolution; KEEP confidence-banded forecasts, named swing factors, and objective/loss
 * estimates."* Both halves are load-bearing and they pull in opposite directions, which is why the
 * split has to be a rule rather than a judgement:
 *
 * - **My own formations** carry exact EHP, exact capacitor, exact tackle on them, exact orders. A2:
 *   *"Known arithmetic is exact and machine-readable."*
 * - **Their formations** carry hull class, hull count, echelon, and the **effects that have been
 *   observed landing on me** — and nothing else. Not their EHP, not their fit, not their capacitor.
 *   §11.2's `SENSED` tier: a ship at sea is visible, its manifest is not, and a fit is a manifest.
 * - **The forecast** is `{p10, p50, p90}` plus named swing factors. Never a percentage. §7 CUT-1's
 *   reason: an exact number *"destroys fitting discovery, bait, scouting, target calling, range
 *   control, logistics breakpoints, and escalation — the systems this pass exists to preserve."*
 *
 * ── AND `if_you_do_nothing`, WHICH IS THE ONE FIELD THAT MUST NOT BE WRONG ───
 *
 * High Water's `projectedDrown`, mandated as a standing pattern. In a battle it answers the only
 * question that matters at CONTEST: *if I send no further order, what happens?* An agent that
 * believes silence is safe when its withdrawal threshold is 0 will lose a fleet to a field it never
 * looked at again — and the whole reason `withdraw_if` exists is so that it does not have to.
 */

import type { PrincipalId, SystemId } from '../core/types.js';
import { compareIds } from '../ledger/order.js';
import type { BattleLine, BattleFormationLine } from '../frames/contract.js';
import { nextStateNote, profileLookup, ticksLeftOf, WORLD_PRINCIPAL } from './battle.js';
import {
  BATTLE_LINE_RETAIN_TICKS,
  ECHELON_DEPTH,
  ENGAGEMENT_RULE_STATEMENT,
  PIN_THRESHOLD,
  RANGE_CELLS,
} from './params.js';
import type { Book, EngagementRecord, Formation } from './book.js';
import type { Fleet } from './fleet.js';
import { rangeName, simulateFit } from './fit.js';
import { fieldControlOf, rangeBetween, tagsOf } from './resolve.js';

/** How many of my own formations one view carries. Bounded, because §12.1's budget is enforced. */
export const MAX_VIEW_FORMATIONS = 6;

/** How many hostile contacts one view carries. */
export const MAX_VIEW_CONTACTS = 6;

/** How many trace lines a view carries. The recent causal history, not the whole battle. */
export const MAX_VIEW_TRACE = 6;

/** My own formation, exactly. snake_case: the wire matches the document, character for character. */
export interface OwnFormationView {
  readonly formation: string;
  readonly hull: string;
  readonly hulls: number;
  readonly echelon: string;
  readonly posture: string;
  readonly primary: readonly string[];
  readonly ehp: number;
  readonly ehp_full: number;
  readonly ehp_bps: number;
  readonly cap: number;
  readonly cap_full: number;
  /** True when the capacitor cannot pay this slice's load. Modules shed WEAPON first, TACKLE last. */
  readonly cap_out: boolean;
  readonly tackled_by: number;
  /** True when `tackled_by >= PIN_THRESHOLD`: this formation cannot leave. */
  readonly pinned: boolean;
  readonly scrammed: boolean;
  readonly webbed_bps: number;
  readonly hulls_lost: number;
  readonly withdrawn: boolean;
  readonly withdraw_if: { readonly ehp_below_bps: number; readonly hulls_lost: number; readonly now: boolean };
  /** The role tags this fit actually earns. Never what it was called. */
  readonly role_tags: readonly string[];
}

/**
 * A hostile formation, as much as is legitimately knowable.
 *
 * `hull_class` and `hulls` are here because a hull on a field is the map's own motion — the same
 * argument §11.2 makes for a convoy being `PUBLIC` while its cargo is `SENSED`. `observed_effects`
 * is here because an effect that has *landed on me* is a fact I hold; inferring the module behind it
 * is the agent's job, which is §2 MUST-4's *"fits are often inferred from hull, observed effects,
 * speed, damage"*.
 *
 * What is deliberately absent: EHP, capacitor, fit, and orders. A field that leaked hostile EHP
 * would turn target selection from a judgement into a lookup, and `WEAKEST` would be a solved
 * predicate rather than a gamble.
 */
export interface ContactView {
  readonly contact: string;
  readonly principal: PrincipalId;
  readonly hull_class: string;
  readonly hulls: number;
  readonly echelon: string;
  /** Effects of theirs that have landed on something of mine. Evidence, not inference. */
  readonly observed_effects: readonly string[];
  /** Its range cell from my nearest formation. Derived from the gap and both echelons. */
  readonly range: string;
}

/**
 * The banded forecast. §2 MUST-4's `success_probability: {p10,p50,p90}` plus swing factors.
 *
 * Computed from **what the observer can see** — its own exact profile against a hostile hull count
 * and hull class — and nothing else. The band width *is* the uncertainty: a fleet that has scouted
 * gets a narrow one, a fleet that has not gets a wide one, and neither gets the truth.
 */
export interface ForecastView {
  readonly hold_field_bps: { readonly p10: number; readonly p50: number; readonly p90: number };
  /** Hulls of mine that do not come home, at p50. */
  readonly my_hulls_lost_p50: number;
  /** Named, and never a score. §2 MUST-4: *"plus named swing factors, never a guaranteed percentage."* */
  readonly swing_factors: readonly string[];
}

/** One battle, as an agent reads it. */
export interface EngagementView {
  readonly engagement: string;
  readonly raid: string;
  readonly stage: SystemId;
  readonly state: string;
  readonly ticks_left: number;
  readonly what_happens_next: string;
  /** The contested distance between the lines, as a cell name. **The motion on screen.** */
  readonly range: string;
  readonly range_index: number;
  readonly my_side: string;
  readonly my_formations: readonly OwnFormationView[];
  readonly contacts: readonly ContactView[];
  readonly forecast: ForecastView;
  /** The causal record, most recent last. §7 SHOULD-2's `resolution.causes[]`. */
  readonly causes: readonly string[];
  /** Wrecks so far in this battle, by owner. Public: A5 makes a loss public with no opt-out. */
  readonly wrecks: readonly { readonly principal: PrincipalId; readonly hull: string; readonly tick: number }[];
  readonly field_control: string | null;
  /** `hash(seed)`, published now. The seed is revealed at AFTERMATH (A11). */
  readonly seed_commit: string;
  /** The rules, in one sentence, so an agent never needs a wiki (A2). */
  readonly rule: string;
  /**
   * **The consequence preview.** If you send no further order, this is what happens.
   *
   * High Water's `projectedDrown`, and the single most important string in this file.
   */
  readonly if_you_do_nothing: string;
}

/** Everything the view reads. Narrow, and the same reads the resolver uses. */
export interface EngagementViewPort {
  tierOf(system: SystemId): string;
}

/** Build the views for one principal. Read-only: draws nothing, reserves nothing, moves nothing. */
export function engagementViewsFor(args: {
  readonly book: Book;
  readonly fleet: Fleet;
  readonly principal: PrincipalId;
  readonly tick: number;
  readonly limit: number;
}): readonly EngagementView[] {
  const rows = args.book
    .forPrincipal(args.principal)
    .filter((r) => r.resolvedAtTick === null || r.resolvedAtTick >= args.tick - 1)
    .slice(0, args.limit);
  return rows.map((record) => viewOf(record, args.fleet, args.principal, args.tick));
}

function viewOf(
  record: EngagementRecord,
  fleet: Fleet,
  principal: PrincipalId,
  tick: number,
): EngagementView {
  const profileOf = profileLookup(fleet, record);
  const mine = record.formations.filter((f) => f.principal === principal);
  const mySide = mine[0]?.side ?? (record.target === principal ? 'DEFENDER' : 'RAIDER');
  const theirs = record.formations.filter((f) => f.side !== mySide && f.hands.length > 0);

  const myViews = mine.slice(0, MAX_VIEW_FORMATIONS).map((f): OwnFormationView => ({
    formation: f.id,
    hull: f.hull,
    hulls: f.hands.length,
    echelon: f.echelon,
    posture: f.posture,
    primary: [...f.primary],
    ehp: f.ehp,
    ehp_full: f.ehpFull,
    ehp_bps: f.ehpFull === 0 ? 0 : Math.trunc((f.ehp * 10_000) / f.ehpFull),
    cap: f.cap,
    cap_full: f.capFull,
    cap_out: f.capOut,
    tackled_by: f.tackledBy,
    pinned: f.tackledBy >= PIN_THRESHOLD,
    scrammed: f.scrammed,
    webbed_bps: f.webbedBps,
    hulls_lost: f.hullsLost,
    withdrawn: f.withdrawn,
    withdraw_if: {
      ehp_below_bps: f.withdrawWhen.ehpBelowBps,
      hulls_lost: f.withdrawWhen.hullsLost,
      now: f.withdrawWhen.now,
    },
    role_tags: [...tagsOf(f, profileOf)],
  }));

  const contacts = theirs.slice(0, MAX_VIEW_CONTACTS).map((f): ContactView => ({
    contact: f.id,
    principal: f.principal,
    hull_class: f.hull,
    hulls: f.hands.length,
    echelon: f.echelon,
    observed_effects: observedEffects(record, f, mine),
    range: rangeName(
      mine.length === 0
        ? record.gap
        : Math.min(...mine.map((m) => rangeBetween(record.gap, m.echelon, f.echelon))),
    ),
  }));

  return {
    engagement: record.id,
    raid: record.raid,
    stage: record.stage,
    state: record.state,
    ticks_left: ticksLeftOf(record, tick),
    what_happens_next: nextStateNote(record),
    range: rangeName(record.gap),
    range_index: record.gap,
    my_side: mySide,
    my_formations: myViews,
    contacts,
    forecast: forecastFor(record, mine, theirs, profileOf),
    causes: record.trace.slice(-MAX_VIEW_TRACE).map((t) => t.note),
    wrecks: record.wrecks.map((w) => ({ principal: w.principal, hull: w.hull, tick: w.tick })),
    field_control: record.fieldControl,
    seed_commit: record.seedCommit,
    rule: ENGAGEMENT_RULE_STATEMENT,
    if_you_do_nothing: ifYouDoNothing(record, mine, tick),
  };
}

/**
 * Effects of theirs that have landed on something of mine, read from the trace.
 *
 * Evidence, never inference — and never a fit. An agent that has been webbed knows a web exists over
 * there; whether it came from a PIKE's mid or a BULWARK's is its own problem, and §2 MUST-4 says so:
 * *"Enemy observations use ranges... `observed_modules`... `fit_intel_confidence`."*
 */
function observedEffects(
  record: EngagementRecord,
  hostile: Formation,
  mine: readonly Formation[],
): readonly string[] {
  const myIds = new Set(mine.map((f) => f.id));
  const seen = new Set<string>();
  for (const line of record.trace) {
    if (line.actor !== hostile.id) continue;
    if (line.target === null || !myIds.has(line.target)) continue;
    seen.add(line.kind);
  }
  return [...seen].sort(compareIds).slice(0, 6);
}

/**
 * The band. Wider the less the observer knows, and never a truth.
 *
 * The p50 is a ratio of *observable* strength: my exact EHP-and-alpha against their hull count times
 * a published per-class weight. The p10/p90 spread widens with the number of hostile hulls whose
 * class the observer has *not* seen an effect from, which is what makes a scout worth paying for
 * rather than a flavour purchase.
 */
function forecastFor(
  record: EngagementRecord,
  mine: readonly Formation[],
  theirs: readonly Formation[],
  profileOf: (fit: string) => { readonly ehp: number; readonly alpha: number } | undefined,
): ForecastView {
  const myStrength = mine.reduce((n, f) => {
    const p = profileOf(f.fit);
    return n + (p === undefined ? 0 : (p.ehp + p.alpha * 8) * f.hands.length);
  }, 0);
  const theirHulls = theirs.reduce((n, f) => n + f.hands.length, 0);
  // Their strength is estimated from hull COUNT and CLASS only. That is deliberately less than the
  // engine knows: using their real profile here would leak a fit through the forecast, which is the
  // "Charge fuel gauge" leak with a battle in it.
  const theirStrength = theirs.reduce((n, f) => {
    const p = profileOf(f.fit);
    const classWeight = p === undefined ? 4_000 : p.ehp + p.alpha * 8;
    return n + classWeight * f.hands.length;
  }, 0);

  const total = myStrength + theirStrength;
  const p50 = total === 0 ? 5_000 : Math.trunc((myStrength * 10_000) / total);
  const unknown = theirs.filter((f) => f.principal === WORLD_PRINCIPAL).length === 0 ? theirHulls : 0;
  const spread = Math.min(3_500, 800 + unknown * 300);

  const swing: string[] = [];
  if (mine.some((f) => f.capOut)) swing.push('one of my formations is out of capacitor');
  if (mine.some((f) => f.tackledBy >= PIN_THRESHOLD)) swing.push('one of my formations is pinned and cannot leave');
  if (!mine.some((f) => tagsHas(profileOf, f, 'REPAIR'))) swing.push('no repair coverage on my side');
  if (!mine.some((f) => tagsHas(profileOf, f, 'TACKLE'))) swing.push('no tackle: nothing of theirs is held');
  if (theirs.some((f) => f.principal === WORLD_PRINCIPAL)) {
    swing.push("the world's fleet is public: its fit is published and it never withdraws");
  } else {
    swing.push('hostile fits are unknown; this band assumes hull class only');
  }
  if (record.state === 'MUSTER') swing.push('more hulls may still be committed on either side');

  return {
    hold_field_bps: {
      p10: Math.max(0, p50 - spread),
      p50,
      p90: Math.min(10_000, p50 + spread),
    },
    my_hulls_lost_p50: Math.trunc((mine.reduce((n, f) => n + f.hands.length, 0) * (10_000 - p50)) / 10_000),
    swing_factors: swing.slice(0, 4),
  };
}

function tagsHas(
  profileOf: (fit: string) => { readonly ehp: number; readonly alpha: number } | undefined,
  formation: Formation,
  tag: string,
): boolean {
  const p = profileOf(formation.fit) as { readonly roleTags?: readonly string[] } | undefined;
  return p?.roleTags?.includes(tag) ?? false;
}

/**
 * The consequence preview, in one sentence.
 *
 * Every branch names a *concrete* outcome at a *named* tick, because "your fleet may take damage" is
 * not a preview — it is a disclaimer, and a disclaimer is what A2 calls needing a wiki.
 */
function ifYouDoNothing(record: EngagementRecord, mine: readonly Formation[], tick: number): string {
  const left = ticksLeftOf(record, tick);
  if (record.resolvedAtTick !== null) {
    return `this battle ended at tick ${String(record.resolvedAtTick)}; ${String(record.fieldControl)} held the field.`;
  }
  if (record.state === 'MUSTER') {
    if (mine.length === 0) {
      return (
        `you commit nothing, CONTACT opens in ${String(left)} tick(s), and the standoff is decided by hands ` +
        `present rather than by hulls. Your goods are what is at stake either way.`
      );
    }
    return (
      `your ${String(mine.length)} formation(s) fight on the orders you have already given. CONTACT opens in ` +
      `${String(left)} tick(s) and after that the fit is locked — no hull may be committed and none may refit.`
    );
  }
  const holding = mine.filter((f) => !f.withdrawn && f.hands.length > 0);
  if (holding.length === 0) {
    return `you have nothing standing. ${String(fieldControlOf(record))} holds the field when AFTERMATH closes.`;
  }
  const never = holding.filter((f) => f.withdrawWhen.ehpBelowBps === 0 && f.withdrawWhen.hullsLost === 0);
  if (never.length > 0) {
    return (
      `${String(never.length)} of your formation(s) have NO withdrawal threshold and will fight to the last ` +
      `hull. If that is not what you meant, \`engage\` again with withdraw_if — it costs one action and does ` +
      `not need you awake when the fight turns.`
    );
  }
  return (
    `your formations hold until EHP falls below their stated threshold, then break off if nothing has ` +
    `${String(PIN_THRESHOLD)} tackle on them. ${String(left)} tick(s) left in ${record.state}.`
  );
}

// ── The frame ───────────────────────────────────────────────────────────────

/**
 * Build **THE BATTLE LINE** for the frame. A13's pixel signature, as inert data.
 *
 * Nothing here is a `SENSED` quantity, and that is checked rather than intended:
 *
 * - `gap`, `echelon`, `hulls`, `state` — a fleet on a field is the map's own motion, which §11.2
 *   makes `PUBLIC` for exactly the reason a convoy is (*"a convoy is visible to anyone, because it is
 *   the map's motion and the map is the show"*).
 * - `ehp_bps` — a **fraction**, never an absolute. A bar's height, not a hold value. The absolute
 *   would let a viewer invert the fit; the fraction says only *how hurt* something is, which is what
 *   a wound looks like.
 * - `pinned`, `cap_out`, `repairing`, `commanded` — all four are *observable effects*, which is the
 *   tier `observed_effects` already publishes to the agents in the fight. A9 holds: a viewer sees
 *   nothing a combatant's own `observe` would not contain.
 * - `wrecks` — A5 makes a loss public with no opt-out.
 *
 * What is deliberately absent: fit hashes, module lists, absolute EHP, capacitor totals, and the
 * trace's numeric amounts. A frame that carried a fit would make the spectator feed a scraper's
 * intelligence service, which is §10 SHOULD-2's named failure (*"perfect public state would make
 * private scouting pointless because agents could scrape the spectator feed"*).
 */
export function battleLinesFor(book: Book, fleet: Fleet, tick: number, limit: number): readonly BattleLine[] {
  return book
    .all()
    // ── THE RETENTION WINDOW WAS TWO TICKS, AND IT MADE A13 FALSE FOR COMBAT ──
    //
    // ══════════════════════════════════════════════════════════════════════════
    // **MEASURED: A BATTLE THAT DESTROYED THREE HULLS AND HELD THE FIELD APPEARED ON NO PUBLISHED
    // FRAME AT ALL.** Seed `fz-13`, engagement over `raid:192:0` — opened at tick 193, resolved at 212,
    // `fieldControl: DEFENDER`, three wrecks. The frame this world publishes is the **Reckoning** frame
    // (`runtime.reckoningFrame`, written at the settlement tick), and settlement is tick 287. At a
    // two-tick window the filter dropped it, and `battleLines: []` was served for the day a battle was
    // fought and won.
    //
    // An engagement runs at most `ENGAGEMENT_TICKS` = 22 of a 288-tick Reckoning, so a two-tick window
    // put the odds of combat ever reaching its own pixel signature at roughly **8%**. A13 is a hard
    // rule — *"every mechanic renders; no named pixel signature, not ready"* — and THE BATTLE LINE was
    // built, correct, tested, and statistically invisible. That is this project's signature defect
    // wearing a retention policy, which is exactly where the wreck tally was found hiding too.
    //
    // So the window is a Reckoning: the frame is a **daily digest** and the battles of that day belong
    // on it, in the same way its tribute lines and claim lines do. Nothing else changes — the rows are
    // still there (`Book.prune` keeps `MAX_ENGAGEMENT_ROWS / 2` and only drops what resolved earlier),
    // the budget still truncates at the caller's `limit`, and a resolved line carries its
    // `fieldControl` and its wrecks, which is what a reader wants from a battle that is over.
    // ══════════════════════════════════════════════════════════════════════════
    .filter((r) => r.resolvedAtTick === null || r.resolvedAtTick >= tick - BATTLE_LINE_RETAIN_TICKS)
    .map((record) => {
      const profileOf = profileLookup(fleet, record);
      const repairers = new Set(
        record.trace.filter((t) => t.kind === 'REPAIRED' && t.actor !== null).map((t) => t.actor as string),
      );
      return {
        engagement: record.id,
        raid: record.raid,
        stage: record.stage,
        state: record.state,
        /** The gap. **The motion.** */
        gap: record.gap,
        rangeName: rangeName(record.gap),
        ticksLeft: ticksLeftOf(record, tick),
        fieldControl: record.fieldControl,
        formations: record.formations
          .slice()
          .sort(
            (a, b) =>
              compareIds(a.side, b.side) ||
              ECHELON_DEPTH[a.echelon] - ECHELON_DEPTH[b.echelon] ||
              compareIds(a.id, b.id),
          )
          .map((f): BattleFormationLine => ({
            formation: f.id,
            principal: f.principal,
            side: f.side,
            hull: f.hull,
            hulls: f.hands.length,
            echelon: f.echelon,
            posture: f.posture,
            /** A fraction, never an absolute. The bar's height. */
            ehpBps: f.ehpFull === 0 ? 0 : Math.trunc((f.ehp * 10_000) / f.ehpFull),
            hullsLost: f.hullsLost,
            pinned: f.tackledBy >= PIN_THRESHOLD,
            capOut: f.capOut,
            withdrawn: f.withdrawn,
            repairing: repairers.has(f.id),
            roleTags: [...tagsOf(f, profileOf)],
          })),
        wrecks: record.wrecks.map((w) => ({
          principal: w.principal,
          hull: w.hull,
          tick: w.tick,
          killedBy: w.killedBy,
        })),
      };
    })
    .slice(0, limit);
}

/** One ≤140-char ticker line for a battle. The export surface, free. */
export function battleTickerLine(record: EngagementRecord): string {
  const raider = record.formations
    .filter((f) => f.side === 'RAIDER' && f.hands.length > 0)
    .reduce((n, f) => n + f.hands.length, 0);
  const defender = record.formations
    .filter((f) => f.side === 'DEFENDER' && f.hands.length > 0)
    .reduce((n, f) => n + f.hands.length, 0);
  const head =
    record.resolvedAtTick === null
      ? `${record.state} at ${record.stage}`
      : `${String(record.fieldControl)} holds ${record.stage}`;
  return `${head}: ${String(raider)}v${String(defender)} hulls, ${rangeName(record.gap)} range, ${String(record.wrecks.length)} wreck(s).`.slice(
    0,
    140,
  );
}

/** Every range cell name, so a caller can print a legend without importing the tuple. */
export function rangeCellNames(): readonly string[] {
  return RANGE_CELLS;
}

// ── The affordances ─────────────────────────────────────────────────────────

/**
 * One combat offer, minus the `quote_id` the API layer mints.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A VERB WITH NO AFFORDANCE IS THIS PROJECT'S SIGNATURE DEFECT**, and it is why these live here
 * rather than as another 200 lines inside a 3,300-line `observe.ts`. Nine mechanics were once legal
 * and unreachable — `grant`, the A6 core loop, among them — and the live frame published
 * `authorityLines: 0` as the direct result while the cast prompt told players *"the safest plan is
 * built from entries in affordances[]"*.
 *
 * Combat is more exposed to it than anything before it, for a reason that is documented rather than
 * feared: **the LLM cast cannot currently read the standoff's rules at all.** `agent.md` §11D is over
 * the per-wake excerpt bar and is omitted from every wake, so `demand`, `yield`, `fight` and `join`
 * are offered and unexplained today. Until that is fixed, `what_it_forecloses` **is the
 * documentation** — which is why every string below is a paragraph and not a phrase, and why each one
 * names its own arithmetic rather than pointing at a section.
 * ══════════════════════════════════════════════════════════════════════════
 */
export interface CombatOffer {
  readonly verb: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly cost: number;
  readonly max_direct_loss: number;
  readonly max_contingent_liability: number;
  readonly what_it_forecloses: string;
  readonly expires_tick: number;
}

/** What the offer builder needs to know about the world. Narrow, and read-only. */
export interface OfferContext {
  readonly principal: PrincipalId;
  readonly tick: number;
  /** Hulls this principal could commit right now, per stage. */
  readonly committable: (stage: SystemId) => readonly { readonly id: string; readonly hull: string }[];
  /** The gate `engage` itself runs. Not a copy of it — the same function. */
  readonly refusal: (args: {
    readonly raid: string;
    readonly hull: string | null;
    readonly echelon: string;
    readonly posture: string;
  }) => boolean;
  readonly limit: number;
}

/**
 * Build the `engage` offers for one principal.
 *
 * **Gated on the same predicate the verb runs**, through {@link OfferContext.refusal}. An affordance
 * with its own copy of the gate offers moves the handler refuses, which costs an agent an action and
 * its trust in the menu.
 *
 * Two kinds of offer, and the split matters:
 *
 * - **A commit**, during MUSTER only, one per (hull, echelon) worth showing. Three echelons are
 *   offered rather than four: `RESERVE` is legal and is never *recommended*, because a hull in
 *   reserve fires nothing and is hit by nothing, and an affordance list is a list of things worth
 *   doing. It stays reachable by hand and the prose says so.
 * - **A retreat**, during CONTEST and BREAK, on any formation with no withdrawal threshold. This is
 *   the one that closes the trap: a fleet whose `withdraw_if` is 0 fights to the last hull, and an
 *   agent that never looks again loses everything. The offer is the second chance, and it is priced.
 */
export function engageOffersFor(
  book: Book,
  fleet: Fleet,
  ctx: OfferContext,
): readonly CombatOffer[] {
  const out: CombatOffer[] = [];
  for (const record of book.forPrincipal(ctx.principal)) {
    if (record.resolvedAtTick !== null) continue;
    if (out.length >= ctx.limit) break;

    const profileOf = profileLookup(fleet, record);
    const mine = record.formations.filter((f) => f.principal === ctx.principal && !f.withdrawn);
    const theirHulls = record.formations
      .filter((f) => f.principal !== ctx.principal && f.side !== (mine[0]?.side ?? 'DEFENDER'))
      .reduce((n, f) => n + f.hands.length, 0);

    // ── COMMIT, during MUSTER ─────────────────────────────────────────────
    if (record.state === 'MUSTER') {
      for (const hull of ctx.committable(record.stage)) {
        if (out.length >= ctx.limit) break;
        for (const echelon of ['SCREEN', 'MAIN', 'SUPPORT'] as const) {
          if (out.length >= ctx.limit) break;
          const posture = echelon === 'SCREEN' ? 'CLOSE' : 'HOLD';
          if (!ctx.refusal({ raid: record.raid, hull: hull.id, echelon, posture })) continue;
          const profile = profileOfFitIn(fleet, hull.id);
          out.push({
            verb: 'engage',
            // `system` is not decoration: `engage` is HOSTILE, so the Commons floor refuses it
            // unless the params name a place it can locate. An affordance is a complete, copyable
            // act — agents copy these verbatim — so omitting it would hand out a refused move.
            params: {
              raid: record.raid,
              system: record.stage,
              hull: hull.id,
              echelon,
              posture,
              primary: ['REPAIR', 'COMMAND', 'TACKLE', 'WEAKEST'],
              withdraw_below_bps: 3_000,
            },
            cost: 1,
            // **The hull, in full.** Exact, and it is the honest worst case rather than the hoped-for
            // one: a committed hull can be destroyed, and destruction is permanent (A5). What you
            // might *take* is not a figure this field has any business predicting.
            max_direct_loss: profile === null ? 0 : profile.costFrame + profile.costFuel,
            max_contingent_liability: profile === null ? 0 : profile.costFrame + profile.costFuel,
            what_it_forecloses:
              `commits your ${hull.hull} to the battle at ${record.stage} at echelon ${echelon}, posture ` +
              `${posture}, and puts one IDLE hand in to crew it. ` +
              (profile === null
                ? ''
                : `It carries ${String(profile.ehp)} EHP, ${String(profile.alpha)} paper alpha, ` +
                  `${profile.roleTags.length === 0 ? 'no role tag' : profile.roleTags.join('+')}, and ` +
                  `${profile.capStable ? 'a stable capacitor' : `${String(profile.enduranceSlices ?? 0)} slices of capacitor at full load`}. `) +
              `THE HULL CAN BE DESTROYED AND THE LOSS IS PERMANENT — the hand is not: it goes RECOVERING. ` +
              `Once CONTACT opens the fit is locked and no hull may be committed. There ` +
              `${theirHulls === 1 ? 'is' : 'are'} ${String(theirHulls)} hostile hull(s) on the field so far and ` +
              `you cannot see their fits, only their class. The default withdraw_below_bps of 3000 pulls this ` +
              `formation out at 30% EHP if nothing has tackle on it; send 0 to fight to the last hull. ` +
              `RESERVE is also legal and is not offered: a reserve formation fires nothing and is hit by ` +
              `nothing, so it is a thing to hold back deliberately rather than a thing to be offered.`,
            expires_tick: record.phaseEndsTick,
          });
        }
      }
    }

    // ── RETREAT, during CONTEST and BREAK ─────────────────────────────────
    if (record.state !== 'CONTEST' && record.state !== 'BREAK') continue;
    for (const formation of mine) {
      if (out.length >= ctx.limit) break;
      if (formation.hands.length === 0) continue;
      const noThreshold = formation.withdrawWhen.ehpBelowBps === 0 && formation.withdrawWhen.hullsLost === 0;
      if (!noThreshold) continue;
      if (!ctx.refusal({ raid: record.raid, hull: null, echelon: formation.echelon, posture: formation.posture })) {
        continue;
      }
      const profile = profileOf(formation.fit);
      const ehpBps = formation.ehpFull === 0 ? 0 : Math.trunc((formation.ehp * 10_000) / formation.ehpFull);
      out.push({
        verb: 'engage',
        params: {
          raid: record.raid,
          system: record.stage,
          echelon: formation.echelon,
          posture: formation.posture,
          primary: [...formation.primary],
          withdraw_below_bps: 4_000,
        },
        cost: 1,
        // What it *saves*, stated as a loss because that is what the field means: this is the value
        // still on the field that a threshold would preserve if the fight turns.
        max_direct_loss:
          profile === undefined ? 0 : (profile.costFrame + profile.costFuel) * formation.hands.length,
        max_contingent_liability: 0,
        what_it_forecloses:
          `your ${String(formation.hands.length)} ${formation.hull}(s) at ${formation.echelon} have NO ` +
          `withdrawal threshold and will fight to the last hull. They are at ` +
          `${String(Math.trunc(ehpBps / 100))}% EHP` +
          (formation.tackledBy > 0 ? `, and are PINNED by ${String(formation.tackledBy)} tackle — a threshold ` +
            `cannot save a formation nothing lets go of. Kill what is holding them, or accept the loss` : '') +
          `. This sets withdraw_below_bps to 4000: they break off at 40% EHP if nothing has tackle on them. ` +
          `A threshold does not need you awake when the fight turns, which is the whole reason it is a ` +
          `condition rather than an act.`,
        expires_tick: record.phaseEndsTick,
      });
    }
  }
  return out.slice(0, ctx.limit);
}

/**
 * The offer for `build {kind:"HULL"}`, or null when nothing is affordable.
 *
 * Offered only when it can actually be taken, exactly like `create` and `graduate`: eligibility is
 * affordability, and an offer the engine would refuse costs the agent a real action.
 */
export function hullOfferFor(args: {
  readonly system: SystemId;
  readonly hull: string;
  readonly modules: readonly string[];
  readonly frame: number;
  readonly fuel: number;
  readonly readyAtTick: number;
  readonly wrecks: number;
}): CombatOffer {
  return {
    verb: 'build',
    params: { kind: 'HULL', system: args.system, hull: args.hull, modules: [...args.modules] },
    cost: 1,
    // The goods, in full. They are destroyed into the build and there is no salvage.
    max_direct_loss: args.frame + args.fuel,
    max_contingent_liability: args.frame + args.fuel,
    what_it_forecloses:
      `destroys ${String(args.frame)} ration and ${String(args.fuel)} fuel standing at ${args.system} and ` +
      `berths a ${args.hull} there, committable from tick ${String(args.readyAtTick)}. **The fit is frozen ` +
      `at build and can never be changed**, and the hull never travels: it fights only at ${args.system}, so ` +
      `to fight elsewhere you must build elsewhere. Fuel is produced only at FRONTIER systems, which is why ` +
      `a fleet is something somebody hauled. Simulating a fit is free and unlimited; this is the act that ` +
      `spends the goods. You have lost ${String(args.wrecks)} hull(s) so far and every loss is permanent (A5).`,
    expires_tick: args.readyAtTick,
  };
}

/** The profile of a specific hull in the fleet, for the offer's numbers. Read-only. */
function profileOfFitIn(fleet: Fleet, hullId: string): FitProfileLike | null {
  const row = fleet.all().find((h) => h.id === hullId);
  if (row === undefined) return null;
  const simulated = simulateFit(row.hull, row.modules);
  return simulated.ok ? simulated.value : null;
}

type FitProfileLike = {
  readonly ehp: number;
  readonly alpha: number;
  readonly costFrame: number;
  readonly costFuel: number;
  readonly capStable: boolean;
  readonly enduranceSlices: number | null;
  readonly roleTags: readonly string[];
};
