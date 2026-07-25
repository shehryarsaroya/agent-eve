/**
 * Seals and the say-do gap — SPEC §11.
 *
 * What the rest of the engine needs to know about this module:
 *
 *   - **A seal is typed fields. Prose never feeds the verdict** (PROP-D1). `judge`
 *     in `verdict.ts` does not take prose as an argument, and `intentFromCanonical`
 *     refuses any key outside the closed five. There is **no natural-language
 *     betrayal detector anywhere in this design** (scars #7 and #8).
 *   - **Agents receive `HONOURED | CONTRADICTED` and nothing else** (PROP-D2). The
 *     only agent-facing shape is `SealDisclosure` and its four keys; content
 *     reaches viewers in the season replay and agents never. `sealCommitEvent` and
 *     `sealVerdictEvent` take no payload and no allow-list argument, so a caller
 *     **cannot** opt out.
 *   - **`reckoningIndex` is derived from the sealing tick**, never supplied, and
 *     `resolve` refuses to run outside its own Reckoning's settlement tick. That is
 *     scar #7 closed by construction rather than by care.
 *   - **A contradicted seal costs standing on a published schedule** —
 *     `SEAL_STANDING_SCHEDULE`, versioned, with `SEAL_STANDING_STATEMENT` as the
 *     sentence `agent.md` must carry verbatim (scar #1: the agent-facing text is a
 *     rules surface).
 *   - **Sealing is mandatory and one seal per role held is free.**
 *     `sealComplianceRejection` is the predicate the venture module must call before
 *     a role is carried into the freeze; `unsealedRoles` is the Reckoning-time audit.
 *   - **Role membership is never stored here.** `venture_role.filled_by_hand_id` is
 *     the single home of commitment (§6.2, scar #5), so `rolesHeld` is an argument.
 *   - **Standing itself is not stored here.** `resolve` returns charges; whoever
 *     owns the standing table applies them and runs `checkInv21` with the causes it
 *     authorised.
 *   - **A halt is for our bug, never for their input.** Nothing an agent can send
 *     reaches a `SealHalt`. A `target`, `measure` or `actedOnStateVersion` the engine
 *     cannot account for makes the seal `DEFERRED` — judged once, closed with no mark,
 *     never re-judged (§15.3's unresolved-obligation rule; scar #7 for the "never
 *     again"). That replaced a halt path an agent could trigger every Reckoning with
 *     one free seal (AGT-X9).
 *   - **A mark that rests on an ABSENCE needs a witness.** Two of them, and the tick
 *     loop owns both: `SealResolveInput.deedSet` (a {@link DeedSetWitness} — "these
 *     are all of this Reckoning's deeds, for these principals") and a
 *     {@link SealWorldIndex} on `new SealBook(world)` (targets name real entities, in
 *     the world's own spelling). Without them "the agent abstained" and "our query
 *     missed this principal" are the same input, and the second libels a real agent
 *     permanently (§15.4). Unwitnessed, the seal defers — so a Reckoning resolved
 *     without them produces **no reveals at all**, which is what
 *     `SealResolution.deferred` is for.
 */

export {
  ALL_DEEDS_CLAIM,
  MAX_SEALS_PER_PRINCIPAL_PER_RECKONING,
  SealBook,
  allDeedsWitness,
  roleKey,
  type DeedSetWitness,
  type SealAccepted,
  type SealAuditRecord,
  type SealCommit,
  type SealDeferral,
  type SealResolution,
  type SealResolveInput,
  type SealRoleRef,
} from './book.js';

export { cmpDeeds, deedFaults, type Deed } from './deed.js';

export {
  SEAL_DISCLOSURE_KEYS,
  SealDisclosureError,
  agentSealDisclosure,
  sealCommitEvent,
  sealProjectionLeaks,
  sealVerdictEvent,
  seasonReplaySealContent,
  settlementTickOf,
  viewerSealDisclosure,
  type SealDisclosure,
  type SealReplayRow,
} from './disclosure.js';

export {
  MAX_PROSE_LENGTH,
  MAX_TARGET_LENGTH,
  PUBLIC_CLAIM_MAX_CHARS,
  SEAL_INTENT_KEYS,
  SEAL_MEASURES,
  claimFaults,
  inBand,
  intentFaults,
  intentFromCanonical,
  intentToCanonical,
  intentWorldFaults,
  isDeclaredVerb,
  sealWorldIndex,
  type PublicClaim,
  type SealIntent,
  type SealIntentKey,
  type SealMeasure,
  type SealWorldIndex,
} from './intent.js';

export { assertSealInvariants, checkInv20 } from './invariants.js';

export {
  MAX_ROW_ITEMS,
  sayDoReplayRow,
  sayDoRow,
  type SayDoReplayRow,
  type SayDoRow,
  type SayDoRowInput,
  type SayDoWithheld,
} from './saydo.js';

export {
  SEAL_STANDING_SCHEDULE,
  SEAL_STANDING_STATEMENT,
  STANDING_VECTORS,
  VECTORS_BY_CAUSE,
  applySealStandingCharges,
  chargeForContradiction,
  checkInv21,
  type SealStandingCharge,
  type StandingCause,
  type StandingVector,
} from './standing.js';

export {
  SealHalt,
  judge,
  sealViolation,
  type Judgement,
  type SealDisposition,
  type VerdictBasis,
  type VerdictInputs,
} from './verdict.js';
