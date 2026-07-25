/**
 * The observation's size budget (SPEC §12.1, §17: "~3k normal / ~6.5k
 * pre-Reckoning", R2).
 *
 * ## Why the caps live here and not in the builder
 *
 * §12.1: "**The token budget is enforced by eligibility filtering, never
 * truncation.**" That sentence only means something if the *cap* and the *ladder
 * of narrowings* are separate objects: a builder that owned its own cap would
 * meet it by slicing, because slicing is always the shortest edit. So this file
 * holds the arithmetic and nothing else, `withheld.ts` holds the accounting, and
 * `observation.ts` applies rungs and re-measures until the measurement fits.
 *
 * ## The estimator is deliberately crude and deliberately integer
 *
 * {@link estimateTokens} counts the canonical serialisation's characters and
 * divides by {@link CHARS_PER_TOKEN}. It is not a BPE tokeniser and does not
 * pretend to be one: a real tokeniser is a dependency, a download, and a
 * per-model answer, and what the budget actually needs is a *monotone* size
 * signal that never differs between two hosts (DET-4). Characters over a fixed
 * divisor is exactly that, and it errs high on JSON — punctuation and short keys
 * tokenise at better than 4:1 — which is the safe direction for a cap.
 *
 * No floats reach any result here: {@link divCeil} truncates with `Math.trunc`,
 * which is exact for every safe integer.
 *
 * ## Two caps, one boundary
 *
 * The pre-Reckoning cap applies inside the commitment window and the freeze,
 * which is the only window where an agent legitimately needs more on screen —
 * every settling obligation, every election, every seal slot at once. Outside it
 * the smaller cap holds, because a payload an agent reads 16 times a day is the
 * owner's bill (§12.4) and it is our promise to cap it.
 */

import { canonicalize, type CanonicalValue } from '../core/canonical.js';
import { inCommitmentWindow, inFreeze } from '../core/time.js';

/**
 * Characters per token, for the estimate. 4 is the conventional English/JSON
 * figure and it is a *constant*, not a measurement, so two hosts agree.
 */
export const CHARS_PER_TOKEN = 4;

/** §17: the observation budget on an ordinary wake. */
export const NORMAL_TOKEN_CAP = 3_000;

/**
 * §17: the budget inside the commitment window and the freeze. Larger because
 * this is the wake where everything that is about to resolve has to be visible
 * at once, and an agent that cannot see its own settling obligations cannot
 * elect on them.
 */
export const COMMITMENT_TOKEN_CAP = 6_500;

/**
 * Per-item text bounds. Every free-text field in an observation is capped, which
 * is what makes the whole payload's worst case computable rather than hopeful
 * (INV-26, scar #3 — an unbounded array became an OOM and a disk DoS).
 */
export const MAX_PHRASE_CHARS = 64;
/** Entries in one affordance's `what_it_forecloses`. */
export const MAX_FORECLOSE_ENTRIES = 2;
/** One prose line — the `prompt`, or `if_you_do_nothing.line`. */
export const MAX_LINE_CHARS = 240;

/**
 * Every list in an observation, and its bound.
 *
 * One interface for both rungs so a cap added at rung 0 and forgotten at the floor is
 * a compile error rather than an unbounded list on the one path that matters.
 */
export interface ListCaps {
  readonly affordances: number;
  readonly mine: number;
  readonly board: number;
  readonly talks: number;
  readonly counterparties: number;
  readonly market: number;
  readonly granted: number;
  readonly held: number;
  readonly whatResolves: number;
  readonly withheldRows: number;
  readonly doNothing: number;
  readonly hands: number;
  readonly cargoGoods: number;
}

/**
 * Declared caps at rung 0, before any narrowing. These are INV-26's bounds: an
 * observation is never larger than this even when the token cap is not reached,
 * so memory and disk are bounded by construction and not by traffic.
 */
export const LIST_CAPS: ListCaps = Object.freeze({
  affordances: 48,
  mine: 12,
  board: 12,
  talks: 8,
  counterparties: 12,
  market: 4,
  granted: 8,
  held: 8,
  whatResolves: 8,
  withheldRows: 32,
  doNothing: 12,
  hands: 3,
  cargoGoods: 8,
});

/**
 * Caps at the **floor rung** — the last narrowing, the one that makes the worst
 * case fit by arithmetic rather than by luck.
 *
 * `test/observe/tokens.test.ts` asserts `floorWorstCaseChars() <=
 * NORMAL_TOKEN_CAP * CHARS_PER_TOKEN`, so these numbers are load-bearing and a
 * change to them fails a test rather than quietly overflowing an agent's context.
 */
export const FLOOR_CAPS: ListCaps = Object.freeze({
  // Deliberately aggressive. The floor rung only runs when four narrowings have
  // already failed to fit, so its job is to *guarantee* the cap rather than to serve
  // a comfortable payload — and everything it drops is `PAGED`, retrievable free.
  affordances: 4,
  mine: 3,
  board: 2,
  talks: 2,
  counterparties: 2,
  market: 1,
  granted: 2,
  held: 2,
  // ── THE FOUR BELOW ARE NOT NARROWED BY ANY RUNG, AND SAY SO ────────────────
  //
  // `observation.ts` applies the rung's caps through `pageBy` for the eight lists
  // above and reads `LIST_CAPS` directly for these four. That is deliberate for three
  // of them and a limitation for the fourth, but either way the proof below must be
  // arithmetic about the numbers the code *applies*, not about numbers that only exist
  // here — the first version of this table declared `doNothing: 4` and `whatResolves: 2`
  // while the builder sliced at 12 and 8, so `floorWorstCaseChars()` under-counted the
  // floor rung by ~4,000 characters and the ladder could run out of rungs on a world
  // inside every declared cap. These therefore equal their rung-0 caps by definition.
  //
  //   - `withheldRows` — may never be shortened: a truncated `withheld` is the exact
  //     failure PROP-O1 exists to prevent, and `WithheldTally.rows()` throws rather
  //     than dropping a row.
  //   - `doNothing` — `agent.md` §12 tells players to read `if_you_do_nothing` first
  //     every wake. Dropping four of twelve predicted consequences to save 900
  //     characters is the worst trade in the payload, and it has no `withheld` field
  //     to be counted in.
  //   - `hands` / `cargoGoods` — structural. `world/hands.ts` mints exactly
  //     `HANDS_PER_PRINCIPAL` hands and caps cargo at `MAX_CARGO_GOODS`, so these are
  //     the world's numbers rather than the payload's, and the proof pays for them in
  //     full through `WORST_ITEM_CHARS.hand`.
  //   - `whatResolves` — a derived index into `ventures.mine`, which carries every
  //     `resolves_at` anyway, so it is cheap (40 chars an entry) and paid in full.
  whatResolves: 8,
  withheldRows: 32,
  doNothing: 12,
  hands: 3,
  cargoGoods: 8,
});

/**
 * Worst-case characters for one serialised item of each kind.
 *
 * **Measured, not guessed** — and measured against the *largest legal* world, which is
 * the part that was wrong. The first version measured a comfortable fixture (empty
 * cargo, one grant) and declared `hand: 200` and `affordance: 300`; a world using only
 * the engine's own declared caps — three hands each loaded to
 * `world/hands.ts:MAX_CARGO_GOODS`, sixteen grants, ten-figure amounts — produces a
 * 397-character hand line and a 317-character affordance. A bound that a legal payload
 * exceeds is not a bound, and the proof underneath it is arithmetic about a payload
 * that does not exist.
 *
 * `tokens.test.ts` asserts a real observation's items never exceed these **on that
 * maximal world**, so a field added to any of these shapes fails a test rather than
 * quietly invalidating the proof below.
 */
const WORST_ITEM_CHARS = Object.freeze({
  affordance: 350,
  mine: 320,
  board: 290,
  talk: 100,
  counterparty: 310,
  market: 200,
  grant: 300,
  whatResolves: 40,
  withheldRow: 70,
  doNothing: 110,
  /** Three hands, each with `MAX_CARGO_GOODS` distinct goods at nine-figure amounts. */
  hand: 440,
  /** header base + holding + obligations + briefing prose, together. */
  fixed: 1_300,
});

/** The arithmetic the floor rung rests on. Integer, and asserted in CI. */
export function floorWorstCaseChars(): number {
  const c = FLOOR_CAPS;
  const w = WORST_ITEM_CHARS;
  return (
    w.fixed +
    c.affordances * w.affordance +
    c.mine * w.mine +
    c.board * w.board +
    c.talks * w.talk +
    c.counterparties * w.counterparty +
    c.market * w.market +
    (c.granted + c.held) * w.grant +
    c.whatResolves * w.whatResolves +
    c.withheldRows * w.withheldRow +
    c.doNothing * w.doNothing +
    c.hands * w.hand
  );
}

/** Ceiling division with no float in the result. Exact for safe integers. */
export function divCeil(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || b <= 0) {
    throw new Error(`divCeil needs safe integers and a positive divisor, got ${a}/${b}`);
  }
  const q = Math.trunc(a / b);
  return q * b === a ? q : q + 1;
}

/**
 * The size signal the ladder measures. Canonicalising rather than
 * `JSON.stringify`ing is not incidental: it throws on a float, on `undefined` in
 * an array, and on a `Map`, so measuring the payload also proves the payload is
 * hashable — which is what lets the same object be golden-filed.
 */
export function estimateTokens(value: CanonicalValue): number {
  return divCeil(canonicalize(value).length, CHARS_PER_TOKEN);
}

/** Which cap applies at `tick`. */
export function tokenCapFor(tick: number): number {
  return inCommitmentWindow(tick) || inFreeze(tick) ? COMMITMENT_TOKEN_CAP : NORMAL_TOKEN_CAP;
}

/** True inside the commitment window or the freeze. Named for the caps' sake. */
export function isPreReckoning(tick: number): boolean {
  return inCommitmentWindow(tick) || inFreeze(tick);
}

/** Clip a phrase to its declared bound. Never silently: the bound is published. */
export function phrase(text: string): string {
  return text.length <= MAX_PHRASE_CHARS ? text : text.slice(0, MAX_PHRASE_CHARS);
}

/** Clip a prose line to its declared bound. */
export function line(text: string): string {
  return text.length <= MAX_LINE_CHARS ? text : text.slice(0, MAX_LINE_CHARS);
}
