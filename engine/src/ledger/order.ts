/**
 * Deterministic ordering.
 *
 * Every scan the ledger performs — invariant checks, state hashing, pro-rata
 * allocation — must visit rows in the same order on every host, or `state_hash`
 * differs between macOS and Linux (DET-4) and the remainder allocation in
 * `splitByBps` lands on a different claimant (INV-6). Locale collation in an
 * `ORDER BY` is one of the determinism killers SPEC §15.5 bans by name, and code
 * units are the only ordering that is the same everywhere.
 */

/** Compare by UTF-16 code unit. Never `localeCompare`, never a bare `.sort()`. */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
