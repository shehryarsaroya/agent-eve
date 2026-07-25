/**
 * Grants (SPEC §8, A6) — scoped authority one principal hands another, the surface
 * betrayal-via-legitimate-authority works against.
 *
 * The signed, portable form of a grant (the W3C Verifiable Credential) lives in
 * `identity/vc.ts`; this module is the live, enforced, hashed *book* of them.
 */

export { GrantBook, GrantBookError, grantsStateTable } from './book.js';
