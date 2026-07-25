#!/usr/bin/env bash
# OPS-1 — prove a restore works, before the first real row exists.
#
# TESTING.md §14: "An unverified backup is not a backup." The scoring panel put
# Operability at 4/10, the lowest of any dimension, and this is the cheapest
# thing that raises it. The failure this prevents is the one where you discover
# at 3am that pg_basebackup was writing to a directory nobody ever read back.
#
# What it does: takes a base backup, verifies its manifest, restores it into a
# throwaway cluster on a spare port, and asserts a canary row written before the
# backup is present after the restore. Then cleans up.
#
# Run as root. Idempotent. Safe to run against a live cluster.
set -euo pipefail

# Postgres binaries live in a versioned dir that is not on postgres's PATH.
# Resolve it rather than assuming, so a major-version bump fails loudly here
# instead of silently skipping verification.
PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)
[ -x "$PGBIN/pg_verifybackup" ] || { echo "OPS-1 FAILED: pg_verifybackup not found under /usr/lib/postgresql/*/bin" >&2; exit 1; }

# On Debian/Ubuntu the cluster config lives in /etc/postgresql/<v>/main, OUTSIDE
# the data directory, so pg_basebackup alone does NOT produce a startable
# cluster. Found by this test on first run — which is the entire argument for
# running it before the first real row rather than during an incident.
PGETC=$(ls -d /etc/postgresql/*/main 2>/dev/null | sort -V | tail -1)

BACKUP_DIR=/var/lib/compact/basebackup
CONFIG_BACKUP=/var/lib/compact/config-backup
SCRATCH_DIR=/var/lib/compact/restore-test
SCRATCH_PORT=5499
CANARY_TABLE=ops1_restore_canary

log() { printf '  %s\n' "$*"; }
fail() { printf 'OPS-1 FAILED: %s\n' "$*" >&2; exit 1; }

cleanup() {
  if [ -d "$SCRATCH_DIR" ]; then
    sudo -u postgres "$PGBIN/pg_ctl" -D "$SCRATCH_DIR" stop -m immediate >/dev/null 2>&1 || true
    rm -rf "$SCRATCH_DIR"
  fi
}
trap cleanup EXIT

# ── 1. Write a canary with a known value ────────────────────────────────────
# The canary is what turns "the restore command exited 0" into "the data came
# back". Those are very different claims and only the second one matters.
CANARY="ops1-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
log "canary: $CANARY"
sudo -u postgres psql -q -d compact <<SQL
CREATE TABLE IF NOT EXISTS $CANARY_TABLE (id serial primary key, token text not null, written_at timestamptz default now());
INSERT INTO $CANARY_TABLE (token) VALUES ('$CANARY');
SQL

# Force a WAL switch so the canary is definitely in an archived segment.
sudo -u postgres psql -q -d compact -c "SELECT pg_switch_wal();" >/dev/null

# ── 2. Base backup ──────────────────────────────────────────────────────────
rm -rf "$BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
chown postgres:postgres "$BACKUP_DIR"
log "taking base backup..."
sudo -u postgres "$PGBIN/pg_basebackup" -D "$BACKUP_DIR" -Fp -Xstream -c fast -P 2>&1 | tail -1

# Back the config up too, or the backup is not restorable (see PGETC above).
rm -rf "$CONFIG_BACKUP"
mkdir -p "$CONFIG_BACKUP"
cp -a "$PGETC"/. "$CONFIG_BACKUP"/
log "config backed up from $PGETC" 

# ── 3. Verify the manifest ──────────────────────────────────────────────────
# pg_verifybackup checks every file against the backup manifest's checksums.
# This catches a truncated or partially-written backup, which is the common
# real-world failure and is invisible from the exit code of the backup itself.
log "verifying backup manifest..."
sudo -u postgres "$PGBIN/pg_verifybackup" "$BACKUP_DIR" || fail "pg_verifybackup rejected the backup"
log "manifest verified"

# ── 4. Restore into a throwaway cluster ─────────────────────────────────────
log "restoring into scratch cluster on port $SCRATCH_PORT..."
rm -rf "$SCRATCH_DIR"
cp -a "$BACKUP_DIR" "$SCRATCH_DIR"
chown -R postgres:postgres "$SCRATCH_DIR"
chmod 700 "$SCRATCH_DIR"
# Bring the config in from the config backup, then override the few things that
# must differ for a scratch copy. A restored cluster must NOT inherit the live
# archive_command, or it fights the primary over the same archive directory —
# which would corrupt the very backups we are relying on.
# Strip the Debian path settings rather than trying to override them: the
# packaged postgresql.conf hard-codes data_directory at the LIVE cluster, and a
# scratch copy that silently reads it would attach to production. Overriding via
# postgresql.auto.conf is not reliable enough for something this dangerous.
grep -vE "^\s*(data_directory|hba_file|ident_file|external_pid_file|include_dir|stats_temp_directory|ssl|ssl_cert_file|ssl_key_file)\s*=" \
  "$CONFIG_BACKUP/postgresql.conf" > "$SCRATCH_DIR/postgresql.conf"
cp "$CONFIG_BACKUP/pg_hba.conf" "$SCRATCH_DIR/pg_hba.conf"
cp "$CONFIG_BACKUP/pg_ident.conf" "$SCRATCH_DIR/pg_ident.conf"
# conf.d is deliberately NOT copied: it holds compact.conf, whose archive_command
# points at the live archive directory.
cat > "$SCRATCH_DIR/postgresql.auto.conf" <<EOF
data_directory = '$SCRATCH_DIR'
hba_file = '$SCRATCH_DIR/pg_hba.conf'
ident_file = '$SCRATCH_DIR/pg_ident.conf'
port = $SCRATCH_PORT
archive_mode = off
archive_command = ''
unix_socket_directories = '$SCRATCH_DIR'
external_pid_file = ''
ssl = off
EOF
chown -R postgres:postgres "$SCRATCH_DIR"
sudo -u postgres "$PGBIN/pg_ctl" -D "$SCRATCH_DIR" -l "$SCRATCH_DIR/startup.log" -w -t 60 start >/dev/null 2>&1 \
  || { echo "--- restored cluster startup log ---" >&2; tail -30 "$SCRATCH_DIR/startup.log" >&2 || true; fail "restored cluster would not start"; }
log "restored cluster started"

# ── 5. Assert the canary survived ───────────────────────────────────────────
FOUND=$(sudo -u postgres psql -h "$SCRATCH_DIR" -p "$SCRATCH_PORT" -d compact -tAc \
  "SELECT token FROM $CANARY_TABLE WHERE token = '$CANARY';" || true)
[ "$FOUND" = "$CANARY" ] || fail "canary missing from restored cluster (got '$FOUND')"
log "canary present in restored cluster"

# Row counts should match too — a restore that loses rows silently is worse
# than one that fails loudly.
LIVE_N=$(sudo -u postgres psql -d compact -tAc "SELECT count(*) FROM $CANARY_TABLE;")
REST_N=$(sudo -u postgres psql -h "$SCRATCH_DIR" -p "$SCRATCH_PORT" -d compact -tAc "SELECT count(*) FROM $CANARY_TABLE;")
[ "$LIVE_N" = "$REST_N" ] || fail "row count differs: live=$LIVE_N restored=$REST_N"
log "row counts match ($LIVE_N)"

# Collation must survive the restore, or DET-4 quietly stops holding on the
# restored host and every ORDER BY becomes locale-dependent again.
COLL=$(sudo -u postgres psql -h "$SCRATCH_DIR" -p "$SCRATCH_PORT" -tAc \
  "SELECT datcollate FROM pg_database WHERE datname='compact';")
[ "$COLL" = "C" ] || fail "restored database collation is '$COLL', expected 'C'"
log "collation preserved: C"

# Leave the game database clean — a stray canary table is exactly the sort of
# thing that confuses a later migration.
sudo -u postgres psql -q -d compact -c "DROP TABLE IF EXISTS $CANARY_TABLE;"
log "canary table dropped from live database"

echo
echo "OPS-1 PASSED — backup taken, manifest verified, restore started, canary and row counts confirmed, collation preserved."
