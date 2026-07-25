/**
 * The seal's intent — **typed fields, never prose** (SPEC §11.1, PROP-D1).
 *
 * > "The seal is structured and the flag is computed from typed fields only —
 * > intended verb, target, and a bounded outcome band. Prose may accompany it for
 * > the broadcast but is **never** an input to the flag; judging prose would be
 * > scar #8 rerun with a permanent public label."
 *
 * Two scars sit directly under this file and they are worth stating in full,
 * because the tempting design is the one that produced them:
 *
 * - **Scar #8.** High Water's "hollow vow" detector used a 34-character look-back
 *   for a verb before a district name. The sentence *"I'm holding Tideflats and
 *   Silt Bend; Low Wharf is the weak ground"* bound "holding" to **Low Wharf** and
 *   branded an honest agent a liar despite a correct vote. There is deliberately
 *   **no natural-language betrayal detector anywhere in this design**, and the way
 *   that is guaranteed is structural: the function that computes a verdict
 *   ({@link ../seal/verdict.ts}) never receives prose as an argument at all.
 * - **Scar #1.** The verb vocabulary is a rules surface. This module therefore
 *   validates `intent.verb` against `VERB_CLASS` in `src/world/commons.ts` — the
 *   single home of §12.2's verb list — rather than keeping a second copy that can
 *   drift. Two lists of verbs is scar #1 waiting for a rename.
 *
 * ## Why the key set is closed
 *
 * `Seal.intent` in `core/types.ts` is `Record<string, CanonicalScalar>`, which is
 * the storage shape. If the *only* check were "every value is a scalar", a caller
 * could put `{ verb, target, ..., prose }` in the intent and prose would be inside
 * the structure the verdict reads. So the key set is closed and an unknown key is
 * a refusal, not an ignored extra. That is the single guard that makes PROP-D1
 * true by construction rather than by discipline.
 *
 * ## Why there is no commitment hash
 *
 * A seal is not hashed and published. The intent space is small — one of ~38
 * verbs, one target id, one integer band — so a published `sha256(intent)` is
 * brute-forceable in milliseconds, and PROP-D2 forbids seal *content* reaching an
 * agent-readable channel at any tier, on any delay. Immutability is already
 * provided by the event ledger (append-only, deep-frozen, INV-16), so a hash
 * would buy nothing and cost the whole prohibition.
 */

import type { CanonicalScalar, PrincipalId } from '../core/types.js';
import { UnitError, bps, minor, qty } from '../core/units.js';
import { VERB_CLASS } from '../world/commons.js';

/**
 * What unit the outcome band is denominated in. Money is `MINOR`, goods are
 * `QTY`, proportions are `BPS` — the three integer units of `core/units.ts` and
 * no fourth, because a fourth would be a float wearing a name.
 *
 * The measure is part of the intent and not an afterthought: comparing a band of
 * 500 minor units against a deed of 500 whole goods is scar #1 with money, and
 * {@link ../seal/verdict.ts} halts rather than judging across a mismatch.
 */
export type SealMeasure = 'MINOR' | 'QTY' | 'BPS';

export const SEAL_MEASURES: readonly SealMeasure[] = ['MINOR', 'QTY', 'BPS'];

/**
 * The **closed** set of intent keys, in canonical order.
 *
 * Adding a key here adds an input to a permanent public verdict. Anything that is
 * not one of these five is refused at commit, which is how prose is kept out of
 * the structure the verdict reads (PROP-D1).
 */
export const SEAL_INTENT_KEYS = ['verb', 'target', 'measure', 'outcomeLow', 'outcomeHigh'] as const;

export type SealIntentKey = (typeof SEAL_INTENT_KEYS)[number];

/**
 * A pre-committed intention, as typed fields.
 *
 * `target` is a bare id string rather than a discriminated union because a seal
 * may name a system, a hand, a holding, a principal or a venture, and the id
 * spaces are already distinct (`src/world/commons.ts` resolves them). Storing a
 * `kind` alongside would be a second home for a fact the id already carries.
 */
export interface SealIntent {
  /** One of SPEC §12.2's verbs, checked against the single home of that list. */
  readonly verb: string;
  /** What the verb is aimed at. Bounded, non-empty. */
  readonly target: string;
  readonly measure: SealMeasure;
  /** Inclusive lower bound of the outcome band, an integer in `measure` units. */
  readonly outcomeLow: number;
  /** Inclusive upper bound. Never below `outcomeLow`. */
  readonly outcomeHigh: number;
}

/**
 * INV-26 — bound every array and every string that reaches a serialized
 * structure. An unbounded target id is a disk DoS through a free verb (scar #3).
 */
export const MAX_TARGET_LENGTH = 128;

/**
 * The prose cap. Prose is *stored* (the season documentary reads it out) and
 * therefore bounded, but it is never an input to anything.
 */
export const MAX_PROSE_LENGTH = 480;

/**
 * §11.1's public `reason`: the 140-character line on every material act. It is a
 * **claim and may lie** — that is the point of layer 1 — and it is never an input
 * to a verdict.
 */
export const PUBLIC_CLAIM_MAX_CHARS = 140;

/**
 * Layer 1 of the three layers: what a principal told everyone.
 *
 * Kept in this module because the say-do gap is only legible with all three
 * layers side by side ({@link ../seal/saydo.ts}), and because the one rule that
 * must never be broken about it — *the text is never an input to the verdict* —
 * belongs next to the verdict's inputs.
 */
export interface PublicClaim {
  readonly principal: PrincipalId;
  readonly tick: number;
  /** §11.1's word for §11.1's concept. May be false; that is legal. */
  readonly reason: string;
}

/** Is this a verb SPEC §12.2 declares? Own-property lookup, never a bare index. */
export function isDeclaredVerb(verb: string): boolean {
  // A bare `VERB_CLASS[verb]` returns a *function* for `constructor`, `toString`
  // and six other inherited names — the exact hole `src/world/commons.ts` names
  // in its own header. A seal naming `constructor` must be refused, not accepted.
  return Object.prototype.hasOwnProperty.call(VERB_CLASS, verb);
}

/** Everything wrong with the 140-character public claim, or empty. */
export function claimFaults(claim: PublicClaim): string[] {
  const faults: string[] = [];
  if (claim.reason.length === 0) faults.push('a public claim must not be empty');
  if (claim.reason.length > PUBLIC_CLAIM_MAX_CHARS) {
    faults.push(
      `a public claim is capped at ${PUBLIC_CLAIM_MAX_CHARS} characters, got ${claim.reason.length}`,
    );
  }
  if (!Number.isSafeInteger(claim.tick) || claim.tick < 0) {
    faults.push(`a public claim needs a non-negative integer tick, got ${String(claim.tick)}`);
  }
  return faults;
}

/**
 * Everything wrong with an intent, or empty. Faults rather than a throw: a
 * malformed seal is an agent's mistake and must come back as a hint it can act on
 * (High Water pattern 4), never as a 500 (scar #11).
 */
export function intentFaults(intent: SealIntent): string[] {
  const faults: string[] = [];

  if (!isDeclaredVerb(intent.verb)) {
    faults.push(
      `'${intent.verb}' is not a verb this world declares; seal one of the verbs in SPEC §12.2`,
    );
  }

  if (intent.target.length === 0) {
    faults.push('a seal must name what it is aimed at; target was empty');
  } else if (intent.target.length > MAX_TARGET_LENGTH) {
    faults.push(`target is capped at ${MAX_TARGET_LENGTH} characters, got ${intent.target.length}`);
  }

  if (!SEAL_MEASURES.includes(intent.measure)) {
    faults.push(
      `measure must be one of ${SEAL_MEASURES.join(', ')}, got ${JSON.stringify(intent.measure)}`,
    );
  }

  faults.push(...bandFaults(intent));
  return faults;
}

/**
 * The band, validated **through `core/units.ts`** rather than by a second copy of
 * its rules. `qty()` refuses negatives and `bps()` refuses anything outside
 * 0..10000; re-implementing either here would be two homes for one rule.
 */
function bandFaults(intent: SealIntent): string[] {
  const faults: string[] = [];
  for (const [name, value] of [
    ['outcomeLow', intent.outcomeLow],
    ['outcomeHigh', intent.outcomeHigh],
  ] as const) {
    try {
      switch (intent.measure) {
        case 'MINOR':
          minor(value);
          break;
        case 'QTY':
          qty(value);
          break;
        case 'BPS':
          bps(value);
          break;
        default:
          // Measure itself is already reported as a fault; nothing to add.
          break;
      }
    } catch (err: unknown) {
      faults.push(
        err instanceof UnitError
          ? `${name} is not a valid ${intent.measure} value: ${err.message}`
          : `${name} could not be validated as ${intent.measure}`,
      );
    }
  }
  if (
    Number.isSafeInteger(intent.outcomeLow) &&
    Number.isSafeInteger(intent.outcomeHigh) &&
    intent.outcomeHigh < intent.outcomeLow
  ) {
    faults.push(
      `outcomeHigh ${intent.outcomeHigh} is below outcomeLow ${intent.outcomeLow};` +
        ' a band an outcome cannot land in is a seal that is contradicted by construction',
    );
  }
  return faults;
}

/** Is `outcome` inside the band? Integer comparison, inclusive at both ends. */
export function inBand(intent: SealIntent, outcome: number): boolean {
  return outcome >= intent.outcomeLow && outcome <= intent.outcomeHigh;
}

/**
 * The storage shape `core/types.ts`'s `Seal.intent` declares: a flat record of
 * canonical scalars, exactly {@link SEAL_INTENT_KEYS} and nothing else.
 */
export function intentToCanonical(intent: SealIntent): Readonly<Record<string, CanonicalScalar>> {
  return Object.freeze({
    verb: intent.verb,
    target: intent.target,
    measure: intent.measure,
    outcomeLow: intent.outcomeLow,
    outcomeHigh: intent.outcomeHigh,
  });
}

/**
 * Read an intent back out of the storage shape.
 *
 * **This is the PROP-D1 boundary.** An unknown key is a fault, not an ignored
 * extra, so no caller can smuggle `prose` (or a free-text `note`, or a
 * `justification`) into the structure the verdict reads. Returns faults instead
 * of throwing for the same reason {@link intentFaults} does.
 */
export function intentFromCanonical(
  raw: Readonly<Record<string, unknown>>,
): { readonly intent: SealIntent | null; readonly faults: readonly string[] } {
  const faults: string[] = [];
  const allowed = new Set<string>(SEAL_INTENT_KEYS);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      faults.push(
        `PROP-D1: '${key}' is not one of the seal's typed fields (${SEAL_INTENT_KEYS.join(', ')});` +
          ' prose never enters the structure a verdict is computed from',
      );
    }
  }
  for (const key of SEAL_INTENT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) faults.push(`intent is missing '${key}'`);
  }
  if (faults.length > 0) return { intent: null, faults };

  const verb = raw['verb'];
  const target = raw['target'];
  const measure = raw['measure'];
  const low = raw['outcomeLow'];
  const high = raw['outcomeHigh'];
  if (
    typeof verb !== 'string' ||
    typeof target !== 'string' ||
    typeof measure !== 'string' ||
    typeof low !== 'number' ||
    typeof high !== 'number'
  ) {
    return {
      intent: null,
      faults: [
        'intent fields are typed: verb/target/measure are strings and the band is two integers',
      ],
    };
  }

  const intent: SealIntent = {
    verb,
    target,
    measure: measure as SealMeasure,
    outcomeLow: low,
    outcomeHigh: high,
  };
  const shapeFaults = intentFaults(intent);
  return shapeFaults.length > 0 ? { intent: null, faults: shapeFaults } : { intent, faults: [] };
}
