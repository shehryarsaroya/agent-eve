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
 * 500 minor units against a deed of 500 whole goods is scar #1 with money. The
 * measure is **agent-supplied**, so the disagreement is a real input and not an
 * impossibility — {@link SealWorldIndex.measureOfVerb} is how it is refused at the
 * door, and {@link ../seal/verdict.ts} defers rather than marking when it was not.
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

// ── What the book must be able to ask the world ──────────────────────────────

/**
 * The two questions the seal book asks before it accepts a seal.
 *
 * Both exist for one reason: **the only two agent-supplied fields a verdict is
 * computed from are `target` and `measure`, and a disagreement about either can
 * only ever come out against the agent.** Sealing `sys-vega` and hauling to
 * `SYS-VEGA` compares unequal under `===`; sealing `haul` in `BPS` compares a
 * proportion against a count. Neither is a lie and neither is a defect in the
 * engine — they are formatting slips, and an LLM makes them constantly.
 *
 * Scar #8 is the reason this is a door and not a judgement: *when the penalty is
 * permanent and public, prefer precision over recall.* A rejection at `commit`
 * costs the agent one action and returns a sentence it can act on (High Water
 * pattern 4); a `CONTRADICTED` mark at settlement is permanent, public, and — since
 * `basis` is never disclosed (PROP-D2) — undiagnosable from the agent's side.
 *
 * **Injected, never a table in this module.** The world's ids and the unit a deed
 * of a given verb is recorded in are facts owned elsewhere; a second copy here is
 * scar #1 waiting for a rename, and scar #5 for the id list. So the book *asks*,
 * and a caller that cannot answer gets the degraded mode documented on
 * {@link ../seal/book.ts}'s `resolve` rather than a wrong answer.
 */
export interface SealWorldIndex {
  /**
   * The world's own spelling of `raw`, or `null` when nothing in the world answers
   * to it. Returning a *different* string is a hint, not a licence to rewrite: the
   * book refuses the seal and quotes the canonical spelling back.
   */
  canonicalTarget(raw: string): string | null;
  /**
   * The unit a deed of `verb` is recorded in, or `null` when the caller cannot say.
   * `null` is honest and is treated as "no opinion"; it never widens what a verdict
   * may mark.
   */
  measureOfVerb(verb: string): SealMeasure | null;
}

/**
 * Build an index from a flat list of ids and a verb→measure function.
 *
 * The fold is **only ever a hint, and it is withheld when it is ambiguous.** Two
 * real ids that differ only by case fold to one key, and resolving that key would
 * be a seal about one entity honoured by a deed about another — a fabricated
 * HONOURED, which is the same class of defect as a fabricated mark (A5′). So an
 * ambiguous key resolves to `null` and the agent is told the target names nothing,
 * which is the recoverable answer.
 */
export function sealWorldIndex(
  ids: Iterable<string>,
  measureOfVerb: (verb: string) => SealMeasure | null,
): SealWorldIndex {
  const exact = new Set<string>();
  /** Folded key -> the one id that owns it, or `null` once two ids claim it. */
  const folded = new Map<string, string | null>();
  for (const id of ids) {
    exact.add(id);
    const key = id.toLowerCase();
    const held = folded.get(key);
    folded.set(key, held === undefined || held === id ? id : null);
  }
  return Object.freeze({
    canonicalTarget(raw: string): string | null {
      if (exact.has(raw)) return raw;
      return folded.get(raw.trim().toLowerCase()) ?? null;
    },
    measureOfVerb,
  });
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
 * Everything the **world** says is wrong with an intent, or empty.
 *
 * Separate from {@link intentFaults} on purpose. Shape faults are a property of the
 * intent alone and are checkable by anyone; these two need the world, are reported
 * under `A5` rather than `PROP-D1`, and exist for a different reason — not "this is
 * malformed" but *"this is a seal we could only ever mark against you, so we will
 * not accept it."* Keeping them apart is also what lets a caller with no world
 * attached run the shape checks and know exactly which guarantee it is missing.
 *
 * Faults rather than a rewrite: trimming or case-folding the target would store
 * something the agent did not write, which is the argument
 * `test/seal/prose.prop.test.ts` already makes about truncating prose. The
 * canonical spelling is *quoted back* instead.
 */
export function intentWorldFaults(intent: SealIntent, world: SealWorldIndex): string[] {
  const faults: string[] = [];

  // Only when the shape check has nothing to say about the target; otherwise an
  // empty or over-long target would be reported twice in two vocabularies.
  if (intent.target.length > 0 && intent.target.length <= MAX_TARGET_LENGTH) {
    const canonical = world.canonicalTarget(intent.target);
    if (canonical === null) {
      faults.push(
        `'${intent.target}' names nothing this world can locate, so a seal aimed at it could only` +
          ' ever be contradicted. Name an existing system, hand, holding, principal or venture.',
      );
    } else if (canonical !== intent.target) {
      faults.push(
        `this world spells that target '${canonical}', not '${intent.target}'; a verdict compares the` +
          ` two exactly, so seal '${canonical}'.`,
      );
    }
  }

  const declared = world.measureOfVerb(intent.verb);
  if (declared !== null && declared !== intent.measure) {
    faults.push(
      `a '${intent.verb}' deed is recorded in ${declared}, so a band in ${intent.measure} is a` +
        ` measurement this world never takes. Restate the band in ${declared}.`,
    );
  }

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

  // ── AND THE MIRROR CASE, WHICH WAS MISSING AND IS THE DANGEROUS ONE ────────
  //
  // The check above refuses a band nothing can land in — "contradicted by construction". Its
  // mirror is a band EVERYTHING lands in, honoured by construction, and nothing refused it:
  // `inBand` is a bare `outcome >= low && outcome <= high`, so `[0, MAX_SAFE_INTEGER]` was a
  // legal seal that every possible outcome satisfied.
  //
  // The broken symmetry favoured the wrong side. A guaranteed contradiction only hurts the
  // agent that sealed it. A guaranteed HONOURED is written to the permanent public record as
  // "kept its word" about somebody who promised nothing — so it does not merely fail to build
  // trust, it MANUFACTURES it. A5′ says the record must never be wrong, and that is wrong in
  // the most damaging direction the mechanic has.
  //
  // ## Why this is a WIDTH rule and not a floor rule
  //
  // My first attempt required `outcomeLow > 0`, reasoning that a band starting at zero is
  // satisfied by doing nothing. `intent.test.ts` refused it, and was right to: a seal can be
  // about a LOSS. `[-900, 0]` is a real promise — *"I will lose no more than 900"* — and a floor
  // rule forbids the whole class. It also cannot be a RATIO of the floor, which is meaningless
  // once the floor is zero or negative.
  //
  // So the rule is the one the exploit actually needs: a band may not span an absurd stretch of
  // the number line. That refuses `[0, MAX_SAFE_INTEGER]` and `[1, MAX_SAFE_INTEGER]` — the
  // shapes that make a seal free — while permitting every band with a real quantity behind it,
  // in either direction. It deliberately does NOT judge whether a promise is a *good* one: a
  // wide-but-finite band is a weak claim, and the record showing it as weak is the mechanic
  // working, not something to forbid.
  if (
    Number.isSafeInteger(intent.outcomeLow) &&
    Number.isSafeInteger(intent.outcomeHigh) &&
    intent.outcomeHigh >= intent.outcomeLow &&
    intent.outcomeHigh - intent.outcomeLow > MAX_BAND_WIDTH
  ) {
    faults.push(
      `the band [${intent.outcomeLow}, ${intent.outcomeHigh}] spans ` +
        `${intent.outcomeHigh - intent.outcomeLow}, over the limit of ${MAX_BAND_WIDTH}. A band that ` +
        'cannot be missed is not a promise: the verdict would read HONOURED whatever you did. Name ' +
        'the range you are actually committing to — a tighter band is a stronger claim, and the ' +
        'record shows the difference.',
    );
  }
  return faults;
}

/**
 * The widest span a seal's band may cover. *(calibrate)*
 *
 * Deliberately generous, because this rule exists to refuse a band that spans the NUMBER LINE — the
 * shape that made a seal free — and not to referee whether a promise is a good one. A wide-but-finite
 * band is a weak claim, and the record showing it as weak is the mechanic working.
 *
 * For scale: the engine's own reference band (`deliveryBandOf`, p10–p90) measures about 2,400 wide on
 * 12,000 of proceeds in a driven world, and a whole venture's value is in the tens of thousands. A
 * million is far above anything with a real quantity behind it and far below `MAX_SAFE_INTEGER`,
 * which is the only thing being excluded.
 */
export const MAX_BAND_WIDTH = 1_000_000;

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
