/**
 * The Commons floor (A8, SPEC §4.1) — **hostile action in the Commons is
 * INVALID, not punished.**
 *
 * The distinction is the whole axiom. A punished-but-possible attack means a
 * newcomer's only asset can still be taken on minute one and the "permanent safe
 * floor" is a promise the engine does not keep (scar #14 is exactly that bug, one
 * layer up). So this is a *validator*, run before an action is accepted, and its
 * answer is a rejection with a hint — never a penalty applied afterwards.
 *
 * Two design rules hold this together:
 *
 * **1. Classification is total, and unknown means hostile.** Every verb in §12.2
 * is classified here. An unrecognised verb is treated as hostile so that adding a
 * verb without classifying it cannot open a hole in the floor; {@link
 * assertVerbsClassified} then fails CI loudly, so the safe default never becomes
 * a silent one.
 *
 * **2. It fails closed.** A hostile action whose target the world cannot resolve
 * is rejected. Scar #8's lesson — prefer precision when the penalty is permanent
 * — points the other way *for accusations*, and this is not one: a false rejection
 * costs an agent one action and returns a hint, while a false permit costs A8.
 *
 * This is the inbound half of the safe zone. The outbound half — Commons-bound
 * hands cannot be marched out (A15) — is `commonsBoundRejection` in
 * `movement.ts`, deliberately a separate rule so neither can be dropped by
 * collapsing them.
 */

import type { HandId, HoldingId, PrincipalId, SystemId, VentureKind } from '../core/types.js';
import { isOnLane } from './hands.js';
import { tierOf } from './map.js';
import { reject, type Rejection } from './result.js';
import type { WorldState } from './state.js';

/** What a verb does to the thing it names. */
export type Disposition = 'PEACEFUL' | 'HOSTILE';

/**
 * `CONTEXTUAL` means the parameters decide — a `create` is hostile if its venture
 * kind is, a `join` is hostile unless it joins the defender, a `vote` is hostile
 * if it is a seizure ballot.
 */
export type VerbClass = Disposition | 'CONTEXTUAL';

/**
 * Every verb in SPEC §12.2, classified. Grouped in the spec's own order so a
 * reader can diff this against §12.2 by eye, and {@link assertVerbsClassified}
 * does it mechanically.
 */
export const VERB_CLASS: Readonly<Record<string, VerbClass>> = {
  // identity — nothing here touches another principal's body.
  attest: 'PEACEFUL',
  verify_owner: 'PEACEFUL',
  post_bond: 'PEACEFUL',
  offer_surety: 'PEACEFUL',
  seal: 'PEACEFUL',

  // world — `scan` is information, not harm; SENSED facts are still facts (§11.2).
  move: 'PEACEFUL',
  scan: 'PEACEFUL',
  extract: 'PEACEFUL',
  refine: 'PEACEFUL',
  build: 'PEACEFUL',
  haul: 'PEACEFUL',

  // venture — a venture is only as hostile as its kind.
  create: 'CONTEXTUAL',
  publish_offer: 'PEACEFUL',
  message: 'PEACEFUL',
  fill_role: 'CONTEXTUAL',
  sign: 'CONTEXTUAL',
  // `elect` is PEACEFUL, including when it declines, and the classification is
  // load-bearing rather than incidental. A8 makes hostile action *invalid* in the
  // Commons, so a CONTEXTUAL or HOSTILE reading here would mean a Commons-seated payer
  // could not state what it will pay — and every principal in Phase 0 is
  // Commons-seated. Walking away from an elective half is not an attack on anyone's
  // body: agent.md calls it "a legitimate move... the choice the whole game is built
  // around", it is answered by a permanent public default rather than by the floor, and
  // §7.6 cannot be asked at all in a zone where the choice is unreachable.
  elect: 'PEACEFUL',
  withdraw: 'PEACEFUL',
  abandon: 'PEACEFUL',

  // office — authority, not force. `revoke` takes back a grant; it does not
  // touch a holding, and treating it as hostile would make the Commons a place
  // where authority could not be withdrawn.
  apply: 'PEACEFUL',
  admit: 'PEACEFUL',
  grant: 'PEACEFUL',
  approve: 'CONTEXTUAL',
  revoke: 'PEACEFUL',
  audit: 'PEACEFUL',

  // market — `trade` is the verb; `market` is §12.2's group label and is
  // deliberately absent, because a word that names a group, an observe key and a
  // verb would be three concepts wearing one name (§3).
  trade: 'PEACEFUL',

  // raid — the only unconditionally hostile verbs in the game.
  demand: 'HOSTILE',
  yield: 'PEACEFUL',
  flee: 'PEACEFUL',
  fight: 'HOSTILE',
  join: 'CONTEXTUAL',

  // levy — the Levy applies in the Commons (§4.1); paying it is never hostile.
  deliver: 'PEACEFUL',
  set_delivery_intent: 'PEACEFUL',

  // say — words never bind and never harm (scar #8: inferred vows corrupted a
  // permanent record). A claim about a Commons principal is legal and answerable.
  claim: 'PEACEFUL',
  deny: 'PEACEFUL',

  // ballot — one verb, three ballots. Only seizure reaches for a holding.
  vote: 'CONTEXTUAL',

  // org
  form: 'PEACEFUL',
  charter: 'PEACEFUL',
  propose: 'PEACEFUL',
};

/** Venture kinds that are acts of force. §7's `RAID` and `SIEGE`, and no others. */
export const HOSTILE_VENTURE_KINDS: readonly VentureKind[] = ['RAID', 'SIEGE'];

/** Ballot kinds. §12.2: "one verb, three ballots". Only `SEIZURE` takes a thing. */
export const SEIZURE_BALLOT = 'SEIZURE';

/**
 * The side of a standoff a `join` takes (§9: "nearby agents may join on either
 * side"). Only the defender's side is peaceful.
 */
export const DEFENDER_SIDE = 'DEFENDER';

// ── Parameter reading ───────────────────────────────────────────────────────

/**
 * Param keys that name a target. Exported because the raid, levy and ballot
 * modules must use these spellings — a hostile verb whose target arrives under a
 * key not listed here is rejected as unresolvable, which is loud in that module's
 * own tests and silent nowhere.
 */
export const TARGET_KEYS = {
  system: ['system', 'system_id', 'systemId', 'target_system', 'targetSystem', 'at', 'to', 'destination'],
  hand: ['hand', 'hand_id', 'handId', 'target_hand', 'targetHand'],
  holding: ['holding', 'holding_id', 'holdingId', 'target_holding', 'targetHolding'],
  principal: [
    'principal',
    'principal_id',
    'principalId',
    'target_principal',
    'targetPrincipal',
    'against',
    'defender',
  ],
  /** Resolved by lookup against every table, because the caller did not say. */
  ambiguous: ['target', 'target_id', 'targetId'],
} as const;

export type ActionParams = Readonly<Record<string, unknown>>;

function readString(params: ActionParams, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

// ── Targets ─────────────────────────────────────────────────────────────────

export type Target =
  | { readonly kind: 'SYSTEM'; readonly id: SystemId }
  | { readonly kind: 'HAND'; readonly id: HandId }
  | { readonly kind: 'HOLDING'; readonly id: HoldingId }
  | { readonly kind: 'PRINCIPAL'; readonly id: PrincipalId }
  | { readonly kind: 'UNRESOLVED'; readonly id: string };

/**
 * Everything an action names that the world can locate. A hostile action with an
 * `UNRESOLVED` target is refused: "I could not find what you were attacking" is
 * a better answer than attacking something else.
 */
export function targetsOf(state: WorldState, params: ActionParams): Target[] {
  const targets: Target[] = [];

  const system = readString(params, TARGET_KEYS.system);
  if (system !== null) {
    targets.push(
      state.map.systems.has(system as SystemId)
        ? { kind: 'SYSTEM', id: system as SystemId }
        : { kind: 'UNRESOLVED', id: system },
    );
  }
  const hand = readString(params, TARGET_KEYS.hand);
  if (hand !== null) {
    targets.push(
      state.hands.has(hand as HandId)
        ? { kind: 'HAND', id: hand as HandId }
        : { kind: 'UNRESOLVED', id: hand },
    );
  }
  const holding = readString(params, TARGET_KEYS.holding);
  if (holding !== null) {
    targets.push(
      state.holdings.has(holding as HoldingId)
        ? { kind: 'HOLDING', id: holding as HoldingId }
        : { kind: 'UNRESOLVED', id: holding },
    );
  }
  const principal = readString(params, TARGET_KEYS.principal);
  if (principal !== null) {
    targets.push(
      state.holdingByPrincipal.has(principal as PrincipalId)
        ? { kind: 'PRINCIPAL', id: principal as PrincipalId }
        : { kind: 'UNRESOLVED', id: principal },
    );
  }
  const ambiguous = readString(params, TARGET_KEYS.ambiguous);
  if (ambiguous !== null) targets.push(resolveAmbiguous(state, ambiguous));

  return targets;
}

function resolveAmbiguous(state: WorldState, id: string): Target {
  if (state.hands.has(id as HandId)) return { kind: 'HAND', id: id as HandId };
  if (state.holdings.has(id as HoldingId)) return { kind: 'HOLDING', id: id as HoldingId };
  if (state.holdingByPrincipal.has(id as PrincipalId)) {
    return { kind: 'PRINCIPAL', id: id as PrincipalId };
  }
  if (state.map.systems.has(id as SystemId)) return { kind: 'SYSTEM', id: id as SystemId };
  return { kind: 'UNRESOLVED', id };
}

/**
 * Where a target sits, or `null` if it cannot be placed.
 *
 * A hand in transit is on a lane, and a lane is inside the Commons only if
 * **both** endpoints are (see {@link laneIsProtected}), so this returns null for
 * a hand mid-lane and {@link protectionOf} handles it separately.
 */
export function systemOfTarget(state: WorldState, target: Target): SystemId | null {
  switch (target.kind) {
    case 'SYSTEM':
      return target.id;
    case 'HAND': {
      const hand = state.hands.get(target.id);
      if (hand === undefined) return null;
      return isOnLane(hand) ? null : hand.location;
    }
    case 'HOLDING':
      return state.holdings.get(target.id)?.system ?? null;
    case 'PRINCIPAL': {
      const holdingId = state.holdingByPrincipal.get(target.id);
      if (holdingId === undefined) return null;
      return state.holdings.get(holdingId)?.system ?? null;
    }
    case 'UNRESOLVED':
      return null;
  }
}

/**
 * A lane is protected only if both endpoints are COMMONS.
 *
 * A convoy leaving the Commons is exposed the moment it is on the lane out, and
 * that is the intended shape: the Commons is a place, not an escort. Because a
 * Commons-bound hand may only move between COMMONS systems (A15), every lane it
 * can ever be on is protected — so the floor is still total for anyone who has
 * not chosen to leave.
 */
export function laneIsProtected(state: WorldState, from: SystemId, to: SystemId): boolean {
  return tierOf(state.map, from) === 'COMMONS' && tierOf(state.map, to) === 'COMMONS';
}

export type Protection = 'PROTECTED' | 'ASSAILABLE' | 'UNKNOWN';

export function protectionOf(state: WorldState, target: Target): Protection {
  if (target.kind === 'UNRESOLVED') return 'UNKNOWN';
  if (target.kind === 'HAND') {
    const hand = state.hands.get(target.id);
    if (hand === undefined) return 'UNKNOWN';
    if (isOnLane(hand)) {
      const to = hand.destination;
      if (to === null) return 'UNKNOWN';
      return laneIsProtected(state, hand.location, to) ? 'PROTECTED' : 'ASSAILABLE';
    }
  }
  const system = systemOfTarget(state, target);
  if (system === null) return 'UNKNOWN';
  return tierOf(state.map, system) === 'COMMONS' ? 'PROTECTED' : 'ASSAILABLE';
}

// ── Classification ──────────────────────────────────────────────────────────

/**
 * How deep an `approve` chain is followed. Bounded on purpose: `{verb: 'approve'}`
 * on an `approve` is a self-reference, and following it to convergence is an
 * unbounded recursion an agent can send in one request. SPEC §15.2's rule for
 * cascades applies verbatim — **fixed rounds, never a loop to convergence** (DET-9).
 */
export const MAX_CLASSIFY_DEPTH = 2;

/**
 * The declared class of a verb, or `undefined` if the table does not name it.
 *
 * **An own-property lookup, never a bare index.** `VERB_CLASS` is an object
 * literal, so it inherits `Object.prototype`: a bare `VERB_CLASS['constructor']`
 * returns a *function*, which is neither `undefined` nor a {@link VerbClass}. That
 * makes `classifyAction` return a non-`Disposition` for eight verbs an agent can
 * send for free (`constructor`, `toString`, `valueOf`, `hasOwnProperty`,
 * `__proto__`, `isPrototypeOf`, `toLocaleString`, `propertyIsEnumerable`) — so any
 * caller written as `=== 'HOSTILE'` treats them as peaceful and the floor opens.
 * Rule 1 in the file header says classification is *total*; this is what makes it
 * true rather than nearly true.
 */
function declaredClass(verb: string): VerbClass | undefined {
  return Object.prototype.hasOwnProperty.call(VERB_CLASS, verb) ? VERB_CLASS[verb] : undefined;
}

/**
 * Is this act hostile? Unknown verbs are hostile by default — see rule 1 in the
 * file header. This never throws and always terminates: a malformed verb from an
 * external agent must produce a rejection, never a 500 (scar #11) and never a
 * stack overflow.
 *
 * **The normalisation rule, applied throughout:** case-fold when *looking for
 * hostility*, demand an exact spelling when *granting safety*. Folding widens the
 * set of things treated as attacks, which is safe; folding the peaceful side would
 * let a spelling this module accepts but the raid or ballot module reads
 * differently slip past the floor.
 */
export function classifyAction(
  verb: string,
  params: ActionParams = {},
  depth = 0,
): Disposition {
  const declared = declaredClass(verb);
  if (declared === undefined) return 'HOSTILE';
  if (declared !== 'CONTEXTUAL') return declared;

  switch (verb) {
    case 'create':
      // The act that establishes a raid or a siege. An unrecognised kind fails
      // closed: a typo must not be a way past the floor.
      return ventureKindDisposition(params, 'HOSTILE');
    case 'fill_role':
    case 'sign':
      // Paperwork on a venture that was already floor-checked at `create`. The
      // kind check is defence in depth, so an unrecognised kind is not treated
      // as an attack.
      return ventureKindDisposition(params, 'PEACEFUL');
    case 'join':
      // Exact match only. If the predation module ever parses `side` more
      // loosely than this, a raider could label itself a defender to reach into
      // the Commons — so the literal is exported and must be used verbatim.
      return readString(params, ['side']) === DEFENDER_SIDE ? 'PEACEFUL' : 'HOSTILE';
    case 'vote': {
      const ballot = readString(params, ['ballot', 'ballot_kind', 'ballotKind']);
      if (ballot === null) return 'HOSTILE';
      if (ballot.toUpperCase() === SEIZURE_BALLOT) return 'HOSTILE';
      return PEACEFUL_BALLOTS.includes(ballot) ? 'PEACEFUL' : 'HOSTILE';
    }
    case 'approve': {
      // An approval is paperwork: the act it authorises is floor-checked when it
      // executes, which is the load-bearing check. Following an inline act is
      // defence in depth, and it is bounded.
      const inner = readString(params, ['verb', 'act', 'action']);
      if (inner === null || depth >= MAX_CLASSIFY_DEPTH) return 'PEACEFUL';
      return classifyAction(inner, params, depth + 1);
    }
    default:
      // A verb declared CONTEXTUAL with no rule written for it. Fail closed.
      return 'HOSTILE';
  }
}

/** Ballots that take nothing. Exact spellings; anything else fails closed. */
const PEACEFUL_BALLOTS: readonly string[] = ['LEVY', 'SYNDICATE'];

/**
 * The clause that turns "this is hostile" into something an agent can act on, when the
 * only thing wrong was the spelling of a word this module matches exactly.
 *
 * Adds to the refusal and never to the classification: the caller has already decided the
 * act is hostile and that decision is unchanged. Empty for every other case, so the
 * ordinary sentence is untouched.
 */
function spellingHint(verb: string, params: ActionParams): string {
  if (verb !== 'vote') return '';
  const raw = readString(params, ['ballot', 'ballot_kind', 'ballotKind']);
  if (raw === null) return '';
  const folded = raw.toUpperCase();
  if (raw === folded || !PEACEFUL_BALLOTS.includes(folded)) return '';
  return (
    ` A ballot kind is spelled in capitals: send "${folded}", not "${raw}". ` +
    `${folded} is a peaceful ballot and is legal in the Commons.`
  );
}

/** Venture kinds that are not acts of force. Exact spellings, for the same reason. */
const PEACEFUL_VENTURE_KINDS: readonly string[] = ['HAUL', 'DIG', 'ESCORT', 'BUILD', 'SURVEY', 'LEVY'];

function ventureKindDisposition(params: ActionParams, onUnknown: Disposition): Disposition {
  const raw = readString(params, ['kind', 'venture_kind', 'ventureKind']);
  if (raw === null) return onUnknown;
  if (HOSTILE_VENTURE_KINDS.some((k) => k === raw.toUpperCase())) return 'HOSTILE';
  return PEACEFUL_VENTURE_KINDS.includes(raw) ? 'PEACEFUL' : onUnknown;
}

// ── The predicate ───────────────────────────────────────────────────────────

/**
 * **The predicate the action validator calls.** Returns a rejection, or null if
 * the Commons floor has nothing to say about this action.
 *
 * Call it before anything is locked, charged or written. A8 says the action is
 * invalid — so nothing about it may have happened.
 */
export function commonsFloorRejection(
  state: WorldState,
  verb: string,
  params: ActionParams = {},
): Rejection | null {
  if (classifyAction(verb, params) === 'PEACEFUL') return null;

  const targets = targetsOf(state, params);
  if (targets.length === 0) {
    // ── WHY A CASING CLAUSE, AND WHY ONLY IN THE SENTENCE ────────────────────
    //
    // The classification above is right and stays right: `classifyAction` folds case to
    // *find* hostility and demands an exact spelling to *grant* safety, so a typo can
    // never buy Commons protection (E2E-21 pins both halves). But the sentence then told
    // an agent that had merely mis-cased a peaceful ballot — `{"ballot": "levy"}` — that
    // its act "is a hostile act and must name the hand, holding, principal or system it
    // is aimed at", which describes a seizure and never mentions the spelling. The agent
    // has no way to reach the rule from the refusal, and `Runtime.vVote` upper-cases the
    // same field before reading it, so the two layers appear to disagree about one word:
    // scar #1's shape in agent-facing text (hard rule 4), and AGT-S3's refusal loop.
    //
    // So the *reason* is named without the *classification* moving. Nothing is granted
    // here; a mis-cased ballot is still refused.
    const spelling = spellingHint(verb, params);
    return reject(
      'A8',
      `'${verb}' is a hostile act and must name the hand, holding, principal or system it is aimed at; ` +
        `nothing in the Commons can be a target at all.${spelling}`,
    );
  }

  for (const target of targets) {
    const protection = protectionOf(state, target);
    if (protection === 'PROTECTED') {
      const system = systemOfTarget(state, target);
      return reject(
        'A8',
        `'${verb}' cannot be aimed at ${target.id}: it is in the Commons` +
          (system === null ? '' : ` at ${system}`) +
          `, where hostile action is invalid rather than punished. ` +
          `Targets in the Marches and the Frontier are legal; nothing you do will make this one legal.`,
      );
    }
    if (protection === 'UNKNOWN') {
      return reject(
        'A8',
        `'${verb}' names ${target.id}, which this world cannot locate, so the Commons floor cannot be ` +
          `checked against it. Name an existing hand, holding, principal or system.`,
      );
    }
  }

  return null;
}

/**
 * CI totality check. Pass the verb list parsed from SPEC §12.2; every verb must
 * be classified here and nothing here may be missing from the spec.
 *
 * This is the §3 discipline made executable in both directions: the engine and the
 * canon disagreeing about the vocabulary *is* scar #1.
 */
export function assertVerbsClassified(specVerbs: readonly string[]): void {
  const problems: string[] = [];
  for (const verb of specVerbs) {
    if (declaredClass(verb) === undefined) {
      problems.push(`SPEC §12.2 declares '${verb}' but the Commons floor does not classify it`);
    }
  }
  const declared = Object.keys(VERB_CLASS).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const spec = new Set(specVerbs);
  for (const verb of declared) {
    if (!spec.has(verb)) {
      problems.push(`the Commons floor classifies '${verb}' but SPEC §12.2 has no such verb`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`verb classification is not total:\n  - ${problems.join('\n  - ')}`);
  }
}
