/**
 * Grants (SPEC §8, A6) — scoped authority one principal hands another, the surface
 * betrayal-via-legitimate-authority works against.
 *
 * The signed, portable form of a grant (the W3C Verifiable Credential) lives in
 * `identity/vc.ts`; this module is the live, enforced, hashed *book* of them.
 *
 * A grant now has **three** dimensions rather than one, and each is priced in the preview
 * the grantor reads before it signs (A7):
 *
 *   - `book.ts`        the two LIMITS — how much a delegate may lose you
 *   - `compartment.ts` the verb fence and the CLEARANCE — what it may do, and what it may see
 *   - `dossier.ts`     what it did with what it saw: evidence, custody, and the delayed audit
 */

export {
  MAX_GRANT_RELEASES,
  MAX_GRANT_SPENDS,
  GrantBook,
  GrantBookError,
  grantsStateTable,
} from './book.js';
export {
  preferWiderGrant,
  selectGrant,
  type GrantSelection,
  type GrantSelectionPort,
} from './select.js';
export {
  canonicalClearance,
  canonicalVerbs,
  compartmentDigest,
  COMPARTMENTS,
  DELEGABLE_VERBS,
  HANDS_COMPARTMENT,
  isCompartment,
  isDelegableVerb,
  MAX_DIGEST_CHARS,
  OFFICE_NAMES,
  OFFICE_SHAPES,
  officeShape,
  officesCarrying,
  STORES_COMPARTMENT,
  type Compartment,
  type CompartmentPort,
  type OfficeShape,
} from './compartment.js';
export {
  AUDIT_LAG_TICKS,
  AuditLog,
  DossierBook,
  DossierBookError,
  dossiersStateTable,
  MAX_CUSTODY_DEPTH,
  MAX_DOSSIERS,
  type Dossier,
  type DossierId,
} from './dossier.js';
