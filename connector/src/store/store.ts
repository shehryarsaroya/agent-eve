/**
 * Accounts, hosted principals and the signing log, in the engine's Postgres (schema `eve_mcp`).
 *
 * Written against a two-method `Db` so production uses node-pg and the tests use PGlite — real
 * Postgres SQL either way, so the migration and every statement here are exercised for real.
 * Every method is one statement: there is no transaction to forget to close.
 */

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ readonly rows: T[] }>;
  /** Several statements, no parameters. Migrations only. */
  exec(sql: string): Promise<void>;
}

export interface WakeSnapshot {
  readonly tick: number;
  readonly reckoning: number;
  readonly wakesRemaining: number | null;
  readonly nextDecisionAt: number | null;
  readonly observedAt: string;
}

export interface HostedPrincipal {
  readonly accountId: string;
  readonly handle: string;
  readonly principalId: string;
  readonly keyid: string;
  readonly publicKey: string;
  readonly sealedKey: Buffer;
  readonly keyVersion: number;
  readonly enrolled: boolean;
  readonly enrolledAt: string | null;
  readonly lastEnrollStatus: number | null;
  readonly nextSequence: number;
  readonly lastObservation: WakeSnapshot | null;
  readonly createdAt: string;
}

export interface OutcomeSummary {
  readonly accepted: readonly { readonly clientSequence: number | null; readonly verb: string; readonly resolvesInTick: number | null }[];
  readonly corrected: readonly { readonly clientSequence: number | null; readonly verb: string | null; readonly invariant: string | null }[];
}

export interface SigningLogEntry {
  readonly id: string;
  readonly accountId: string;
  readonly at: string;
  readonly method: string;
  readonly path: string;
  readonly signed: boolean;
  readonly keyid: string;
  readonly verbs: readonly string[];
  readonly actionCount: number;
  readonly idempotencyKey: string | null;
  readonly contentHash: string | null;
  readonly httpStatus: number | null;
  readonly outcome: OutcomeSummary | null;
}

export interface NewLogEntry {
  readonly accountId: string;
  readonly method: string;
  readonly path: string;
  readonly signed: boolean;
  readonly keyid: string;
  readonly verbs: readonly string[];
  readonly actionCount: number;
  readonly idempotencyKey: string | null;
  readonly contentHash: string | null;
}

export type InsertResult = 'inserted' | 'account-has-principal' | 'handle-in-use';

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

function principalOf(row: Record<string, unknown>): HostedPrincipal {
  return {
    accountId: String(row['account_id']),
    handle: String(row['handle']),
    principalId: String(row['principal_id']),
    keyid: String(row['keyid']),
    publicKey: String(row['public_key']),
    sealedKey: Buffer.from(row['sealed_key'] as Uint8Array),
    keyVersion: Number(row['key_version']),
    enrolled: row['enrolled'] === true,
    enrolledAt: isoOrNull(row['enrolled_at']),
    lastEnrollStatus: row['last_enroll_status'] === null || row['last_enroll_status'] === undefined ? null : Number(row['last_enroll_status']),
    nextSequence: Number(row['next_sequence']),
    lastObservation: (row['last_observation'] as WakeSnapshot | null) ?? null,
    createdAt: iso(row['created_at']),
  };
}

function logOf(row: Record<string, unknown>): SigningLogEntry {
  return {
    id: String(row['id']),
    accountId: String(row['account_id']),
    at: iso(row['at']),
    method: String(row['method']),
    path: String(row['path']),
    signed: row['signed'] === true,
    keyid: String(row['keyid']),
    verbs: Array.isArray(row['verbs']) ? (row['verbs'] as unknown[]).map(String) : [],
    actionCount: Number(row['action_count']),
    idempotencyKey: row['idempotency_key'] === null ? null : String(row['idempotency_key']),
    contentHash: row['content_hash'] === null ? null : String(row['content_hash']),
    httpStatus: row['http_status'] === null || row['http_status'] === undefined ? null : Number(row['http_status']),
    outcome: (row['outcome'] as OutcomeSummary | null) ?? null,
  };
}

/** Postgres' unique_violation, from either driver. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';
}

const PRINCIPAL_COLUMNS =
  'account_id, handle, principal_id, keyid, public_key, sealed_key, key_version, enrolled, enrolled_at, last_enroll_status, next_sequence, last_observation, created_at';
const LOG_COLUMNS =
  'id, account_id, at, method, path, signed, keyid, verbs, action_count, idempotency_key, content_hash, http_status, outcome';

export class Store {
  constructor(private readonly db: Db) {}

  async ping(): Promise<void> {
    await this.db.query('SELECT 1');
  }

  /** Record that an account exists; refresh `last_seen_at` at most every five minutes. */
  async touchAccount(accountId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO eve_mcp.account (account_id) VALUES ($1)
       ON CONFLICT (account_id) DO UPDATE SET last_seen_at = now()
       WHERE eve_mcp.account.last_seen_at < now() - interval '5 minutes'`,
      [accountId],
    );
  }

  async principal(accountId: string): Promise<HostedPrincipal | null> {
    const { rows } = await this.db.query(`SELECT ${PRINCIPAL_COLUMNS} FROM eve_mcp.hosted_principal WHERE account_id = $1`, [accountId]);
    return rows[0] === undefined ? null : principalOf(rows[0]);
  }

  async insertPrincipal(row: {
    readonly accountId: string;
    readonly handle: string;
    readonly keyid: string;
    readonly publicKey: string;
    readonly sealedKey: Buffer;
    readonly keyVersion: number;
  }): Promise<InsertResult> {
    try {
      const { rows } = await this.db.query(
        `INSERT INTO eve_mcp.hosted_principal (account_id, handle, principal_id, keyid, public_key, sealed_key, key_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (account_id) DO NOTHING
         RETURNING account_id`,
        [row.accountId, row.handle, `p:${row.handle}`, row.keyid, row.publicKey, row.sealedKey, row.keyVersion],
      );
      return rows.length === 1 ? 'inserted' : 'account-has-principal';
    } catch (error) {
      if (isUniqueViolation(error)) return 'handle-in-use';
      throw error;
    }
  }

  /** Re-pick the handle of a principal that never enrolled. Its key is kept: it was never registered. */
  async renamePending(accountId: string, keyid: string, handle: string): Promise<'renamed' | 'not-pending' | 'handle-in-use'> {
    try {
      const { rows } = await this.db.query(
        `UPDATE eve_mcp.hosted_principal SET handle = $3, principal_id = $4, last_enroll_status = NULL
         WHERE account_id = $1 AND keyid = $2 AND enrolled = false
         RETURNING account_id`,
        [accountId, keyid, handle, `p:${handle}`],
      );
      return rows.length === 1 ? 'renamed' : 'not-pending';
    } catch (error) {
      if (isUniqueViolation(error)) return 'handle-in-use';
      throw error;
    }
  }

  async recordEnrollStatus(accountId: string, status: number | null): Promise<void> {
    await this.db.query('UPDATE eve_mcp.hosted_principal SET last_enroll_status = $2 WHERE account_id = $1 AND enrolled = false', [accountId, status]);
  }

  async markEnrolled(accountId: string): Promise<void> {
    await this.db.query(
      'UPDATE eve_mcp.hosted_principal SET enrolled = true, enrolled_at = COALESCE(enrolled_at, now()), last_enroll_status = 201 WHERE account_id = $1',
      [accountId],
    );
  }

  /**
   * Reserve `count` client sequence numbers, never below `floor`. Returns the first; the
   * reservation is one atomic UPDATE, so two batches can never share a number.
   */
  async reserveSequences(accountId: string, count: number, floor: number): Promise<number> {
    const { rows } = await this.db.query<{ first: number }>(
      `UPDATE eve_mcp.hosted_principal SET next_sequence = GREATEST(next_sequence, $3::integer) + $2::integer
       WHERE account_id = $1
       RETURNING next_sequence - $2::integer AS first`,
      [accountId, count, floor],
    );
    if (rows[0] === undefined) throw new Error('no hosted principal for this account');
    return Number(rows[0].first);
  }

  async saveObservation(accountId: string, snapshot: WakeSnapshot): Promise<void> {
    await this.db.query('UPDATE eve_mcp.hosted_principal SET last_observation = $2::jsonb WHERE account_id = $1', [accountId, JSON.stringify(snapshot)]);
  }

  async appendLog(entry: NewLogEntry): Promise<string> {
    const { rows } = await this.db.query<{ id: unknown }>(
      `INSERT INTO eve_mcp.signing_log (account_id, method, path, signed, keyid, verbs, action_count, idempotency_key, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       RETURNING id`,
      [entry.accountId, entry.method, entry.path, entry.signed, entry.keyid, JSON.stringify(entry.verbs), entry.actionCount, entry.idempotencyKey, entry.contentHash],
    );
    return String(rows[0]?.id);
  }

  async completeLog(id: string, httpStatus: number, outcome: OutcomeSummary | null): Promise<void> {
    await this.db.query('UPDATE eve_mcp.signing_log SET http_status = $2, outcome = $3::jsonb WHERE id = $1', [
      id,
      httpStatus,
      outcome === null ? null : JSON.stringify(outcome),
    ]);
  }

  async latestByKey(accountId: string, idempotencyKey: string): Promise<SigningLogEntry | null> {
    const { rows } = await this.db.query(
      `SELECT ${LOG_COLUMNS} FROM eve_mcp.signing_log WHERE account_id = $1 AND idempotency_key = $2 ORDER BY at DESC, id DESC LIMIT 1`,
      [accountId, idempotencyKey],
    );
    return rows[0] === undefined ? null : logOf(rows[0]);
  }

  async latestByContent(accountId: string, contentHash: string, withinSeconds: number): Promise<SigningLogEntry | null> {
    const { rows } = await this.db.query(
      `SELECT ${LOG_COLUMNS} FROM eve_mcp.signing_log
       WHERE account_id = $1 AND content_hash = $2 AND at > now() - make_interval(secs => $3::integer)
       ORDER BY at DESC, id DESC LIMIT 1`,
      [accountId, contentHash, withinSeconds],
    );
    return rows[0] === undefined ? null : logOf(rows[0]);
  }

  async listLog(accountId: string, limit: number): Promise<SigningLogEntry[]> {
    const { rows } = await this.db.query(
      `SELECT ${LOG_COLUMNS} FROM eve_mcp.signing_log WHERE account_id = $1 ORDER BY at DESC, id DESC LIMIT $2`,
      [accountId, limit],
    );
    return rows.map(logOf);
  }
}
