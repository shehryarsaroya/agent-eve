#!/usr/bin/env bash
# THE COMPACT — RE-SEED. **This destroys a permanent public record.**
#
# ══════════════════════════════════════════════════════════════════════════
# A5 says loss is real, public and permanent, and A10 says identity, reputation and legend never
# reset. This script contradicts both on purpose and may only be run when an owner has said so in
# words — the authorisation for the 2026-07-30 run is quoted in
# `docs/design/SESSION-2026-07-30-HANDOFF.md`. It is a script rather than a paste so that what was
# destroyed, and what was kept, is reviewable afterwards.
#
# ── WHY A WORLD WOULD EVER BE ENDED ────────────────────────────────────────
#
# Three independent readings, none of them a crash, are what justified the first one:
#
#   1. `kept: 0, broken: 0` across all 14 cast members after thirty Reckonings. A fresh world on the
#      same code does `kept: 51, broken: 11` in two.
#   2. 16 of 16 WORKS still in the Commons, one claim in the galaxy, eight grants all `UNUSED`.
#   3. `/health` reporting `unhealthy` while `world: RUNNING`, because 1,469 consecutive decisions
#      came from the heuristic and **not one** from LIVE, INTENT or DELEGATE.
#
# And an availability reading on top: every accepted divergence refuses checkpoint adoption, so boot
# replays from genesis. At tick 10,136 with 25 discontinuities that is **~37 minutes**. A world with
# none boots in seconds.
#
# ── WHAT IT KEEPS ──────────────────────────────────────────────────────────
#
#   - A `pg_dump` of the whole database, gzipped, under /var/lib/compact/backups. The record is
#     ENDED, not deleted: it can still be read, replayed and quoted.
#   - `schema_migration`, so the next boot does not re-run migrations.
#   - Every file this script does not name.
#
# ── WHAT IT ENDS ───────────────────────────────────────────────────────────
#
#   - Every world table: the ledger, the event log, the action log, snapshots, enrolments, the
#     divergence journal. Enrolled identities included — a principal row is part of the record.
#   - The house cast's memory, which is a projection of the world that just ended.
#   - Every published frame, because a frame from the old world on the new world's viewer is a lie
#     about what is happening now.
#   - Any standing `COMPACT_ACCEPT_DIVERGENCE_AT_TICK`. A fresh world has nothing to accept, and a
#     declaration left lying in the env file is how nineteen consecutive rules changes were waved
#     through the operator door (see `deploy.sh`).
#
# Usage: ./deploy/reseed.sh --yes-destroy-the-record
set -euo pipefail

HOST=147.93.179.114
KEY=~/.ssh/agenttransfer_vps
SSH="ssh -i $KEY -o ConnectTimeout=20 root@$HOST"
WEB_DIR=/var/www/agentinsurance.io/compact

log()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
fail() { printf '  ✗ %s\n' "$*" >&2; exit 1; }

[[ "${1:-}" == "--yes-destroy-the-record" ]] || fail \
  "refusing without --yes-destroy-the-record. This ends a permanent public record (A5, A10) and
     needs an owner's word, not a habit."

log "pre-flight"
$SSH 'systemctl is-active --quiet postgresql' || fail "postgresql not running"
BEFORE=$($SSH "sudo -u postgres psql -qAt -d compact -c \"select coalesce(max(tick),0) from action_log;\"" || echo "?")
DIVS=$($SSH "sudo -u postgres psql -qAt -d compact -c \"select count(*) from journal_divergence;\"" || echo "?")
printf '  the world being ended: head tick %s, %s declared discontinuities\n' "$BEFORE" "$DIVS"

log "backing the record up before ending it"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
$SSH "mkdir -p /var/lib/compact/backups && sudo -u postgres pg_dump compact | gzip -9 > /var/lib/compact/backups/pre-reseed-$STAMP.sql.gz"
SIZE=$($SSH "stat -c %s /var/lib/compact/backups/pre-reseed-$STAMP.sql.gz")
# A backup that is a few hundred bytes is an error message in a gzip wrapper, which is the failure
# mode that looks most like success. 1 MB is far below any real dump of a world worth keeping.
[[ "$SIZE" -gt 1000000 ]] || fail "the backup is only $SIZE bytes — that is not a world. Nothing has been touched."
ok "record backed up to /var/lib/compact/backups/pre-reseed-$STAMP.sql.gz ($SIZE bytes)"

log "stopping the API"
$SSH 'systemctl stop compact-api'
ok "compact-api stopped (the world is now offline on purpose)"

log "ending the record"
# One statement, so it is one transaction: a half-truncated database is a world that boots into a
# state no code has ever seen. CASCADE covers the FKs; TRUNCATE on a partitioned parent takes its
# partitions with it. `schema_migration` is deliberately absent.
$SSH "sudo -u postgres psql -q -d compact -c \"TRUNCATE
  principal, mandate, account, event, event_audience, posting, action_log,
  idempotency, wake_offer, observation_fetch, snapshot, world_status,
  journal_meta, tick_seed, journal_enrollment, journal_divergence
  RESTART IDENTITY CASCADE;\""
ROWS=$($SSH "sudo -u postgres psql -qAt -d compact -c \"select count(*) from action_log;\"")
[[ "$ROWS" == "0" ]] || fail "action_log still holds $ROWS rows after the truncate"
ok "every world table is empty; schema_migration kept so the next boot does not re-migrate"

log "clearing the projections of a world that no longer exists"
$SSH "rm -f /var/lib/compact/cast-memory.json"
ok "cast memory cleared"
$SSH "rm -f $WEB_DIR/frames/*.json"
ok "published frames cleared (a frame from the old world is a lie about this one)"

log "closing the operator door behind us"
# Backed up, never edited in place: the env file also holds credentials this script must not read.
$SSH "cp -a /etc/compact/env /etc/compact/env.pre-reseed-$STAMP && \
      sed -i '/^COMPACT_ACCEPT_DIVERGENCE_AT_TICK=/d' /etc/compact/env"
$SSH "grep -q '^COMPACT_ACCEPT_DIVERGENCE_AT_TICK=' /etc/compact/env" \
  && fail "the declaration is still in /etc/compact/env" || true
ok "any standing divergence declaration removed (backup: /etc/compact/env.pre-reseed-$STAMP)"

log "starting a new world"
$SSH 'systemctl start compact-api'
WAITED=0
until $SSH "set -a && . /etc/compact/env && set +a
      BODY=\$(curl -s --max-time 10 http://127.0.0.1:\${COMPACT_PORT:-8787}/health || true)
      case \"\$BODY\" in
        *'\"world\":\"RUNNING\"'*) exit 0 ;;
        *'\"world\":\"HELD\"'*)    exit 0 ;;
        *)                            exit 1 ;;
      esac"; do
  WAITED=$((WAITED + 5))
  [[ $WAITED -lt 600 ]] || fail "a FRESH world did not reach RUNNING in ${WAITED}s. It has nothing to
     replay, so this is not the O(history) boot — read the journal."
  printf '  starting… %ss\n' "$WAITED"
  sleep 5
done
ok "the new world answered in ${WAITED}s"

log "verification"
BODY=$(curl -sS --max-time 20 https://agentinsurance.io/compact/health)
[[ "$BODY" == *'"world":"RUNNING"'* ]] || fail "world is not RUNNING: ${BODY:0:400}"
[[ "$BODY" == *'"failures":[]'* ]] || fail "failures is not empty: ${BODY:0:400}"
ok "world RUNNING, failures []"
printf '\n%s\n' "${BODY:0:1200}"

printf '\n\033[1m▸ the prior world%s record ENDED at tick %s. It is backed up, not deleted.\033[0m\n' "'s" "$BEFORE"
printf '  Next: watch /health for a LIVE decision inside one Reckoning. A fresh world where only the\n'
printf '  heuristic acts is no better to watch than the one that was just ended.\n'
