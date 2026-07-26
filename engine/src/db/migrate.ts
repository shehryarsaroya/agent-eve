/**
 * Migration runner and partition manager.
 *
 * Two things here are load-bearing beyond "create the tables":
 *
 * 1. **Append-only is enforced by grants, not convention** (INV-16, A5). The
 *    schema owner (`compact`) can migrate; the application role (`compact_app`)
 *    holds INSERT and SELECT on `event`, `posting` and `action_log` and *no*
 *    UPDATE or DELETE. A bug that tries to rewrite history then fails loudly at
 *    the database instead of succeeding quietly. `AX-A5-1` asserts this by
 *    attempting both and requiring both to fail.
 *
 * 2. **Partitions are pre-created ahead of the write frontier with a boot
 *    assertion** (OPS-3). The failure this prevents is a world that stops
 *    accepting events at a partition boundary — which, for an append-only
 *    ledger in front of an audience, is an outage at exactly the wrong moment.
 */

import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { TICKS_PER_RECKONING } from '../core/time.js';

/** One partition per Reckoning. Keeps "this Reckoning" queries prunable. */
export const TICKS_PER_PARTITION = TICKS_PER_RECKONING;

/**
 * How far ahead partitions must always exist. Seven Reckonings is seven days at
 * production pace — long enough that a failed cron is noticed by a human before
 * it becomes an outage.
 */
export const PARTITION_LOOKAHEAD = 7;

const PARTITIONED_TABLES = ['event', 'event_audience', 'posting', 'action_log'] as const;
const APPEND_ONLY_TABLES = ['event', 'event_audience', 'posting', 'action_log'] as const;

/**
 * The journal's own tables, append-only and unpartitioned. Immutable by grant, not
 * convention (INV-16): a rewritten master seed or a re-minted enrolment would corrupt
 * the record A10 says never resets, so the app role gets INSERT + SELECT and no more.
 */
export const APPEND_ONLY_UNPARTITIONED = [
  'journal_meta',
  'tick_seed',
  'journal_enrollment',
  // The operator door's annotation. It exists to say "the rules changed at tick N",
  // so it above all must not be editable by the process that writes it.
  'journal_divergence',
  // THE TRIPWIRE ITSELF. Boot's only detector for "the arithmetic moved" is comparing
  // the replayed state_hash against `snapshot.state_hash`, so the whole hold-don't-
  // crash-loop design rests on this column. It was left writable, and the app role
  // could therefore disable its own integrity check: a stray UPDATE forces a permanent
  // false HELD, and a DELETE empties the tripwire set so boot reports
  // `tripwiresChecked: 0` and serves a world it never verified — the silent continue
  // this module exists to prevent. Costs nothing to close: `writeSnapshot` is
  // `INSERT ... ON CONFLICT (tick) DO NOTHING`, which needs INSERT only, and nothing
  // anywhere UPDATEs or DELETEs this table.
  'snapshot',
] as const;

export function partitionIndexForTick(tick: number): number {
  return Math.floor(tick / TICKS_PER_PARTITION);
}

/**
 * Create partitions covering `[fromIndex, fromIndex + count)`. Idempotent, so
 * it is safe to run on every boot and from a cron.
 */
export async function ensurePartitions(
  client: Client,
  fromIndex: number,
  count: number,
): Promise<string[]> {
  const created: string[] = [];
  for (let i = fromIndex; i < fromIndex + count; i++) {
    const lo = i * TICKS_PER_PARTITION;
    const hi = lo + TICKS_PER_PARTITION;
    for (const table of PARTITIONED_TABLES) {
      const name = `${table}_p${String(i).padStart(5, '0')}`;
      // Identifiers are built from an integer index, never from input, so
      // interpolation here cannot be an injection vector.
      const { rowCount } = await client.query(
        `SELECT 1 FROM pg_class WHERE relname = $1 AND relkind = 'r'`,
        [name],
      );
      if (rowCount === 0) {
        await client.query(
          `CREATE TABLE ${name} PARTITION OF ${table} FOR VALUES FROM (${lo}) TO (${hi})`,
        );
        created.push(name);
      }
    }
  }
  return created;
}

/**
 * OPS-3's boot assertion. Refuses to start if the write frontier is within
 * `PARTITION_LOOKAHEAD` partitions of the last one that exists.
 *
 * Deliberately fatal rather than a warning: a warning about partitions is a
 * warning nobody reads until the ledger stops accepting writes.
 */
export async function assertPartitionRunway(client: Client, currentTick: number): Promise<void> {
  const needUpTo = partitionIndexForTick(currentTick) + PARTITION_LOOKAHEAD;
  const { rows } = await client.query<{ max: string | null }>(
    `SELECT max(substring(relname from '[0-9]+$'))::text AS max
       FROM pg_class
      WHERE relname LIKE 'event_p%' AND relkind = 'r'`,
  );
  const have = rows[0]?.max === null || rows[0]?.max === undefined ? -1 : Number(rows[0].max);
  if (have < needUpTo) {
    throw new Error(
      `OPS-3: partition runway too short. Current tick ${currentTick} needs partitions ` +
        `through index ${needUpTo}, but the highest existing is ${have}. ` +
        `Run ensurePartitions() before starting.`,
    );
  }
}

/**
 * Grant the application role exactly what it needs and nothing more.
 * The append-only tables get INSERT + SELECT; state tables get full DML.
 */
async function applyGrants(client: Client, appRole: string): Promise<void> {
  await client.query(`GRANT USAGE ON SCHEMA public TO ${appRole}`);

  // Everything readable and writable by default...
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appRole}`,
  );
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${appRole}`);

  // ...then history is taken back. The order matters: revoke after the blanket
  // grant, or a later blanket grant silently restores the ability to rewrite
  // the record.
  for (const t of APPEND_ONLY_TABLES) {
    await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON ${t} FROM ${appRole}`);
    // Partitions inherit privileges at creation time, so existing children must
    // be revoked explicitly too.
    const { rows } = await client.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname LIKE $1 AND relkind = 'r'`,
      [`${t}_p%`],
    );
    for (const r of rows) {
      await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON ${r.relname} FROM ${appRole}`);
    }
  }

  // The journal's own append-only tables (unpartitioned, so no child partitions to
  // walk). Revoked after the blanket grant, same ordering rule as above.
  for (const t of APPEND_ONLY_UNPARTITIONED) {
    await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON ${t} FROM ${appRole}`);
  }

  // Future tables created by migrations follow the same shape.
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appRole}`,
  );
}

export interface MigrateOptions {
  readonly connectionString?: string;
  readonly appRole: string;
  readonly currentTick: number;
}

export async function migrate(opts: MigrateOptions): Promise<void> {
  const client = new Client(
    opts.connectionString === undefined ? {} : { connectionString: opts.connectionString },
  );
  await client.connect();
  try {
    const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
    await client.query(sql);

    const { rowCount } = await client.query(`SELECT 1 FROM schema_migration WHERE version = 1`);
    if (rowCount === 0) {
      await client.query(
        `INSERT INTO schema_migration (version, description) VALUES (1, $1)`,
        ['initial: identity, value, event ledger, action log, wake accounting, snapshots'],
      );
    }

    const from = partitionIndexForTick(opts.currentTick);
    const created = await ensurePartitions(client, from, PARTITION_LOOKAHEAD + 1);
    process.stdout.write(`partitions ensured: ${created.length} created\n`);

    // The app role must already exist — see the refusal below. It connects over
    // loopback TCP with a password rather than the unix socket, because Ubuntu's
    // packaged pg_hba gives `local all all peer` and peer auth requires the OS user to
    // match the DB user; the service runs as root.
    const { rowCount: roleExists } = await client.query(
      `SELECT 1 FROM pg_roles WHERE rolname = $1`,
      [opts.appRole],
    );
    if (roleExists === 0) {
      // Deliberately NOT created here. Role creation needs CREATEROLE, and granting
      // that to the migration role would widen the very privileges this app role
      // exists to narrow — the app role's whole purpose is that it CANNOT rewrite
      // history (INV-16), which is worth nothing if the thing that made it could
      // also make itself a superuser.
      //
      // So provisioning is an operator step and this is an actionable refusal rather
      // than a silent skip: a migration that quietly proceeds without the role leaves
      // the app connecting as the table OWNER, and append-only goes back to being a
      // convention.
      throw new Error(
        `role ${opts.appRole} does not exist. Create it as a superuser before migrating:\n` +
          `  sudo -u postgres psql -c "CREATE ROLE ${opts.appRole} LOGIN PASSWORD '<generated>';"\n` +
          `It is a separate role on purpose: the application must not be able to UPDATE or ` +
          `DELETE the event ledger, and that is enforced by grants rather than by discipline.`,
      );
    }
    await applyGrants(client, opts.appRole);
    process.stdout.write(`grants applied: ${opts.appRole} cannot UPDATE or DELETE history\n`);

    await client.query(
      `INSERT INTO world_status (singleton, status, current_tick)
       VALUES (true, 'RUNNING', $1)
       ON CONFLICT (singleton) DO NOTHING`,
      [opts.currentTick],
    );

    await assertPartitionRunway(client, opts.currentTick);
    process.stdout.write('OPS-3 partition runway assertion passed\n');
  } finally {
    await client.end();
  }
}

// Run directly: `npm run migrate`
if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  await migrate({ appRole: 'compact_app', currentTick: 0 });
  process.stdout.write('migration complete\n');
}
