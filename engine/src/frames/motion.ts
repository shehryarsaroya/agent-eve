/**
 * ★ THE CONVOY LINE and THE COMPACT LINK — A13's three unrendered named examples.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * A13 names six pixel signatures by hand (`SPEC.md` §2): *a claim tints a system · **a compact draws
 * a link between two holdings** · **a broken compact snaps that link and scars both parties** · a
 * venture is a ring whose hollow arc is the part riding on someone's word · a siege closes a ring ·
 * **a convoy is a line that can be severed***.
 *
 * Three of the six had **no frame field at all**. The siege is honestly labelled Phase 1 in
 * `observe/observation.ts` and stays there. The other two are here, and the convoy is the one with
 * the sharpest irony attached: the phrase *"a convoy is visible to anyone, because it is the map's
 * motion and the map is the show"* appears **five times inside `frames/contract.ts`** as the §11.2
 * clause that lets `raidLines`, `battleLines`, `map` and `swayLines` be published — and the convoy
 * itself was not on the frame. The clause every other line borrowed had no object of its own.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Both builders live here rather than in `render.ts` for the reason every line set is passed in:
 * *a renderer that computed its own would be inventing one.* A drawn convoy nobody dispatched, or a
 * link between two agents who never dealt, is a claim about real principals that a stranger has no
 * second source for (A5′).
 */

import type { GrantId, HandId, PrincipalId, SystemId, VentureId, VentureState } from '../core/types.js';
import { minor, type Minor } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import {
  MAX_FRAME_COMPACT_LINKS,
  MAX_FRAME_CONVOY_LINES,
  type CompactLink,
  type ConvoyLine,
} from './contract.js';

// ── ★ THE CONVOY LINE ───────────────────────────────────────────────────────

/**
 * One hand, as this builder needs it.
 *
 * **`laden` and never a quantity**, and that one bit is the whole §11.2 argument. `runtime.ts:vHaul`
 * emits `haul.departed` `PUBLIC` at birth with `payload: { hand, from, to, arrivesAtTick, lots }`
 * and deliberately without `good` or `qty`, because *"putting them here would put a `SENSED` fact on
 * a `PUBLIC` row"*. A bare `move` emits **nothing at all** (`tick/loop.ts:BUILT_IN_VERBS.move`), so
 * an unladen hand on a lane has no public row and must draw no line — otherwise the frame would
 * report a fleet redeployment that no agent's `observe` reports, which is A9 inverted.
 */
export interface ConvoyHandRead {
  readonly hand: HandId;
  readonly principal: PrincipalId;
  /** Where it is travelling FROM. `HandRecord.location` while `IN_TRANSIT`. */
  readonly from: SystemId;
  /** `HandRecord.destination`. Null means it is not on a lane. */
  readonly to: SystemId | null;
  /** `HandRecord.freeAtTick` — the tick it lands. Null when it is not travelling. */
  readonly arrivesAtTick: number | null;
  /** Is it carrying anything at all? One bit, never a figure. See the interface doc. */
  readonly laden: boolean;
}

export interface ConvoyLinesArgs {
  readonly hands: Iterable<ConvoyHandRead>;
  /**
   * Is this lane a STRAIT? A pure function of the topology, supplied rather than derived, so the
   * frame's pinch and the frame's convoy agree by construction rather than by two lookups.
   */
  readonly isStrait: (a: SystemId, b: SystemId) => boolean;
  readonly handleOf: (principal: PrincipalId) => string;
  readonly tick: number;
  readonly limit?: number;
}

/**
 * THE CONVOY LINES, landing soonest first.
 *
 * **Soonest first, and the direction is the argument.** Every other line budget in this frame keeps
 * the biggest; this one keeps the ones about to arrive, because a convoy is only news at its two
 * ends and the departure has already been drawn. A cap that dropped the imminent arrivals would fail
 * in the direction that hides — which this repo has now shipped three times — and the hidden thing
 * would be the exact tick a viewer was watching for.
 */
export function convoyLinesFor(args: ConvoyLinesArgs): readonly ConvoyLine[] {
  const lines: ConvoyLine[] = [];
  for (const hand of args.hands) {
    if (hand.to === null || hand.arrivesAtTick === null) continue;
    // Not on a lane, or nothing aboard. An empty hand emits no `haul.departed`, so it publishes no
    // line here either — the filter IS the A9 argument, not a tidiness rule.
    if (!hand.laden) continue;
    // Defensive, and it has a real cause: `beginTransit` refuses `destination === location`, but a
    // hand-built fixture can carry the shape and `assertFrameBudgets` would then refuse the whole
    // frame over one malformed row. Dropping it is the honest half of "never publish a broken tick".
    if (hand.to === hand.from) continue;
    const ticksLeft = Math.max(0, hand.arrivesAtTick - args.tick);
    const strait = args.isStrait(hand.from, hand.to);
    lines.push({
      hand: hand.hand,
      principal: hand.principal,
      from: hand.from,
      to: hand.to,
      arrivesAtTick: hand.arrivesAtTick,
      ticksLeft,
      strait,
      legend:
        `${args.handleOf(hand.principal).toUpperCase()}'S CONVOY · ${String(hand.from)} → ${String(hand.to)}` +
        `${strait ? ' · STRAIT' : ''} · ${ticksLeft === 0 ? 'LANDING' : `${String(ticksLeft)} TICKS`}`,
    });
  }
  return lines
    .sort((a, b) => a.ticksLeft - b.ticksLeft || compareIds(a.hand, b.hand))
    .slice(0, args.limit ?? MAX_FRAME_CONVOY_LINES);
}

// ── ★ WHO A COMPACT IS "WITH" — ONE RULE FOR THE LINK AND THE DEED ─────────

/**
 * One payee of a compact that has SETTLED: its elective half as the settlement computed it, summed
 * over every role the principal held. `electiveDue - electivePaid === electiveShortfall`, exactly as on
 * each `RolePayout` it is folded from (`venture/settlement.ts`) — the same three words, because they
 * are the same three quantities (HARD RULE 4).
 */
export interface SettledPayee {
  readonly principal: PrincipalId;
  readonly electiveDue: Minor;
  readonly electivePaid: Minor;
  /** What the payer withheld from this principal. Zero on a role paid in full. */
  readonly electiveShortfall: Minor;
}

/** The fields of a `RolePayout` the fold reads — structural, so this file stays off the venture module. */
export interface PayoutRead {
  readonly holder: PrincipalId | null;
  readonly electiveDue: Minor;
  readonly electivePaid: Minor;
  readonly electiveShortfall: Minor;
}

/**
 * A settlement's payouts, folded per PRINCIPAL and in id order. A role nobody held pays nobody and is
 * dropped; a principal holding two roles is one payee, because the deed and the link name agents, not
 * slots. The payer itself appears when it filled a role of its own — the readers decide what that means.
 */
export function payeesOf(payouts: readonly PayoutRead[]): readonly SettledPayee[] {
  const by = new Map<PrincipalId, { due: number; paid: number; short: number }>();
  for (const p of payouts) {
    if (p.holder === null) continue;
    const acc = by.get(p.holder) ?? { due: 0, paid: 0, short: 0 };
    acc.due += p.electiveDue;
    acc.paid += p.electivePaid;
    acc.short += p.electiveShortfall;
    by.set(p.holder, acc);
  }
  return [...by.entries()]
    .sort((a, b) => compareIds(a[0], b[0]))
    .map(([principal, v]) => ({
      principal,
      electiveDue: minor(v.due),
      electivePaid: minor(v.paid),
      electiveShortfall: minor(v.short),
    }));
}

/** One party to a compact, as {@link counterpartiesOf} reads it. */
export interface CompactPartyRead {
  readonly principal: PrincipalId;
  /** What rides on this party's roles: the pinned elective while the compact is live, the DUE once settled. */
  readonly riding: Minor;
  /** What the creator withheld from it at settlement. Zero while the compact is live. */
  readonly shorted: Minor;
}

/**
 * ★ **The creator's counterparties, most-wronged first** — the ONE ordering both THE COMPACT LINK's `b`
 * and the rundown's deed (`render.ts:headlineFor`) read.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE DEED NAMED A FILLER PAID IN FULL AS THE VICTIM OF A DEFAULT, AND THE SAME FRAME'S LINK DREW TO
 * THE REAL ONE.** A blind playtest's frame: `v:932` was `s1blind-bo`'s own DIG, `varrow` was elected
 * 100 of 169 due and `severin` was paid in full — and the deed read *"s1blind-bo's 225 was riding on
 * severin's dig. s1blind-bo walked away from 69 of the 225 it had promised"*. `headlineFor` named the
 * first non-creator party in id order; `compactLinksFor` named the one with the largest elective. Two
 * rules, one venture, two agents — and the deed is the half that is archived and emailed (A5′).
 * ══════════════════════════════════════════════════════════════════════════
 *
 * So one rule, here: among the parties other than the creator, the one the creator **shorted** most
 * comes first — a broken compact is a story about its victim — then the one with the most **riding**
 * on it, then the lower id (DET-2). On a live compact nobody has been shorted yet, so this is exactly
 * the previous link rule. Per PRINCIPAL rather than per role, so a party holding two roles is weighed
 * by both.
 */
export function counterpartiesOf(
  creator: PrincipalId,
  parties: readonly CompactPartyRead[],
): readonly CompactPartyRead[] {
  const by = new Map<PrincipalId, { riding: number; shorted: number }>();
  for (const p of parties) {
    if (p.principal === creator) continue;
    const acc = by.get(p.principal) ?? { riding: 0, shorted: 0 };
    acc.riding += p.riding;
    acc.shorted += p.shorted;
    by.set(p.principal, acc);
  }
  return [...by.entries()]
    .map(([principal, v]) => ({ principal, riding: minor(v.riding), shorted: minor(v.shorted) }))
    .sort((a, b) => b.shorted - a.shorted || b.riding - a.riding || compareIds(a.principal, b.principal));
}

/** A settled compact's payees as the counterparty rule reads them. One mapping, for the link and the deed. */
export function settledParties(payees: readonly SettledPayee[]): readonly CompactPartyRead[] {
  return payees.map((p) => ({ principal: p.principal, riding: p.electiveDue, shorted: p.electiveShortfall }));
}

// ── ★ THE COMPACT LINK ──────────────────────────────────────────────────────

/** One venture, as this builder needs it. A projection, never the record. */
export interface CompactVentureRead {
  readonly venture: VentureId;
  readonly kind: string;
  readonly stage: SystemId;
  readonly state: VentureState;
  readonly creator: PrincipalId;
  /** Every filled role's principal, with what that role has riding on the elective half. */
  readonly filled: readonly { readonly principal: PrincipalId; readonly elective: Minor }[];
  /** The unsecured proportion of the whole compact, in bps. A7's half that stays a promise. */
  readonly electiveBps: number;
  readonly grant: GrantId | null;
  /**
   * ★ The settlement's payees, when this compact settled on the frame being built — null or absent
   * while it is live. With them the link's `b` is chosen from what the settlement DID (who was
   * shorted, who was due what), by {@link counterpartiesOf} — the rule the rundown's deed reads — so
   * the snap and the sentence name the same agent.
   */
  readonly payees?: readonly SettledPayee[] | null;
}

export interface CompactLinksArgs {
  readonly ventures: Iterable<CompactVentureRead>;
  /**
   * Where a principal's HOLDING sits.
   *
   * §11.2 admits `handles` because *"a holding is rendered with its name on it"*, and `world/sway.ts`
   * derives the whole border layer from holdings for exactly this reason — a holding is `PUBLIC`
   * where a hand's disposition is not. Null for a principal with no holding, which draws no end.
   */
  readonly holdingAt: (principal: PrincipalId) => SystemId | null;
  readonly limit?: number;
}

/** `HAUL · 12K ON A WORD · SNAPPED` — the words a viewer reads. Never a score (§3). */
function compactLegend(kind: string, atStake: Minor, state: VentureState, parties: number): string {
  const money =
    Math.abs(atStake) >= 1_000_000
      ? `${String(Math.round(atStake / 100_000) / 10)}M`
      : Math.abs(atStake) >= 1_000
        ? `${String(Math.round(atStake / 1_000))}K`
        : String(atStake);
  const ending =
    state === 'DEFAULTED'
      ? 'SNAPPED'
      : state === 'SETTLED'
        ? 'HELD'
        : state === 'FORMING'
          ? `FORMING · ${String(parties)} IN`
          : state === 'DEFERRED'
            ? 'CARRIED'
            : state === 'ABANDONED'
              ? 'ABANDONED'
              : 'LIVE';
  return `${kind.toUpperCase()} · ${money} ON A WORD · ${ending}`;
}

/**
 * THE COMPACT LINKS, snaps first.
 *
 * **Snaps first, unconditionally.** A13 names the snap as its own signature — *"a broken compact
 * snaps that link and scars both parties"* — so a cap that could drop one would delete the named
 * pixel while keeping the unnamed ones. Then by what is riding on it, then by id. Exactly the
 * separation `render.ts` makes for the rundown: choose what must be shown, then order it.
 */
export function compactLinksFor(args: CompactLinksArgs): readonly CompactLink[] {
  const links: CompactLink[] = [];
  for (const v of args.ventures) {
    // The counterparty, by THE rule the rundown's deed reads ({@link counterpartiesOf}): the one the
    // creator shorted most on a compact that settled tonight, else the one with the most riding on it.
    // `null` while no role is filled — a compact with one party is not a link, and drawing one to
    // nowhere would assert a relationship that does not exist (A5′). That state has its own signature
    // already: `glyph.state: FORMING` is the socket.
    const counted =
      v.payees === undefined || v.payees === null
        ? v.filled.map((r) => ({ principal: r.principal, riding: r.elective, shorted: minor(0) }))
        : settledParties(v.payees);
    const b = counterpartiesOf(v.creator, counted)[0]?.principal ?? null;
    const bAt = b === null ? null : args.holdingAt(b);
    const aAt = args.holdingAt(v.creator);
    if (aAt === null) continue;
    const atStake = minor(v.filled.reduce((n, r) => n + r.elective, 0));
    const parties = new Set([v.creator, ...v.filled.map((r) => r.principal)]).size;
    links.push({
      venture: v.venture,
      kind: v.kind,
      stage: v.stage,
      state: v.state,
      a: v.creator,
      aAt,
      // Both or neither: `assertFrameBudgets` refuses a link that names a counterparty at one field
      // and not the other, because half a link is a line drawn to the origin of the plot.
      b: bAt === null ? null : b,
      bAt: bAt === null ? null : bAt,
      parties,
      electiveBps: v.electiveBps,
      atStake,
      snapped: v.state === 'DEFAULTED',
      grant: v.grant,
      legend: compactLegend(v.kind, atStake, v.state, parties),
    });
  }
  return links
    .sort(
      (a, b) =>
        Number(b.snapped) - Number(a.snapped) || b.atStake - a.atStake || compareIds(a.venture, b.venture),
    )
    .slice(0, args.limit ?? MAX_FRAME_COMPACT_LINKS);
}
