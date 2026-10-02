#!/usr/bin/env bash
# Start a NEW SEASON on the standalone Agent Eve host (docs/background/INFRA.md).
#
# ══════════════════════════════════════════════════════════════════════════
# THIS ENDS THE LIVE WORLD'S RECORD. A5 says loss is real and permanent, and A10 says identity,
# standing and legend never reset; a new season with a new seed contradicts both on purpose, so it
# runs only on an owner's word and only with the flag below. The old record is ENDED, never
# deleted: a full dump is kept on the host outside the backup rotation AND copied to this machine.
# ══════════════════════════════════════════════════════════════════════════
#
# What it keeps: schema_migration, and the PRIVATE follow tables (follows outlive a world; recaps
# restart at the new world's first Reckoning). What it ends: every world table, the house cast's
# memory, and the published frames (archived first). It refuses outright if the database holds a
# table on neither list, so a table added by a later migration is a decision, not an accident.
#
# Deploy shape is deploy-standalone.sh's: ship the pushed commit with git archive, build on the
# host, prove the build first — here by booting it from GENESIS on an empty database, because a
# new season's rules cannot (and must not) replay the old record — then swap the trees.
#
# Usage: ./deploy/new-season-standalone.sh --seed agenteve-season-1 [--cast 20] [--seats 1000 --memory-gb 8] --yes-end-the-current-world
#        --seats sets COMPACT_SEATS; --memory-gb sets the service's MemoryMax and Node's heap limit together,
#        through a systemd drop-in, because raising seats without memory is an out-of-memory crash mid-season
#        (docs/design/SCALE-2026-10-01.md: ~1.4 GB at 500 seats, ~2.1 GB at 1,000, ~5.4 GB at 3,000 per season).
#        add --dry-run to stop after step 4: ship, build, the genesis pre-flight and the table check,
#        with nothing ended and the live world untouched.
set -euo pipefail

HOST="${AGENTEVE_HOST:-root@89.117.78.215}"
KEY="${AGENTEVE_SSH_KEY:-$HOME/Projects/yc-gstack-kit/credentials/keys/ahmadecho_vps_ed25519}"
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=60 -o ServerAliveInterval=30 "$HOST")
SHIP=(engine client deploy mcp README.md TRACKER.md)
ARCHIVE_LOCAL="${AGENTEVE_ARCHIVE_DIR:-$HOME/agenteve-archive}"
# Tables a new season empties, and tables it must never touch. Every table in `public` that is not
# a partition must be on exactly one list, or the script stops before anything is changed.
WORLD_TABLES=(principal mandate account event event_audience posting action_log idempotency
  wake_offer observation_fetch snapshot world_status journal_meta tick_seed journal_enrollment
  journal_divergence)
KEEP_TABLES=(schema_migration follow_subscription follow_mail_day)

SEED=''
CAST=''
SEATS=''
MEMORY_GB=''
CONFIRMED=''
DRY_RUN=''
while [ $# -gt 0 ]; do
  case "$1" in
    --seed) SEED="${2:-}"; shift 2 ;;
    --cast) CAST="${2:-}"; shift 2 ;;
    --seats) SEATS="${2:-}"; shift 2 ;;
    --memory-gb) MEMORY_GB="${2:-}"; shift 2 ;;
    --yes-end-the-current-world) CONFIRMED=yes; shift ;;
    --dry-run) DRY_RUN=yes; shift ;;
    *) echo "unknown argument: $1"; exit 1 ;;
  esac
done
[ "$CONFIRMED" = yes ] || { echo "refusing without --yes-end-the-current-world: this ends a permanent public record and needs an owner's word"; exit 1; }
[[ "$SEED" =~ ^[a-z0-9][a-z0-9-]{3,63}$ ]] || { echo "refusing: --seed must be a lowercase name like agenteve-season-1"; exit 1; }
[ -z "$CAST" ] || [[ "$CAST" =~ ^[0-9]+$ ]] || { echo "refusing: --cast must be a number"; exit 1; }
[ -z "$SEATS" ] || [[ "$SEATS" =~ ^[0-9]+$ ]] || { echo "refusing: --seats must be a number"; exit 1; }
[ -z "$MEMORY_GB" ] || [[ "$MEMORY_GB" =~ ^[0-9]+$ ]] || { echo "refusing: --memory-gb must be a whole number"; exit 1; }
if [ -n "$SEATS" ] && [ -z "$MEMORY_GB" ]; then echo "refusing: --seats needs --memory-gb, so capacity and memory move together"; exit 1; fi

say() { printf '\n== %s\n' "$*"; }
digest() { shasum -a 256 | cut -c1-64; }

say "1/7 what ships is what GitHub has"
[ -z "$(git status --porcelain)" ] || { echo "refusing: the working tree is not clean"; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = master ] || { echo "refusing: not on master"; exit 1; }
git fetch -q origin master
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/master)" ] || { echo "refusing: HEAD is not origin/master; push first"; exit 1; }
REV="$(git rev-parse HEAD)"
echo "revision $REV, new seed $SEED${CAST:+, cast $CAST}"

say "2/7 stage and build the new season's code"
"${SSH[@]}" 'rm -rf /opt/agenteve-next && mkdir -p /opt/agenteve-next'
git archive --format=tar "$REV" "${SHIP[@]}" | "${SSH[@]}" 'tar -x -C /opt/agenteve-next'
"${SSH[@]}" "echo $REV > /opt/agenteve-next/REVISION"
"${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
cd /opt/agenteve-next/engine
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent
npm prune --omit=dev --no-audit --no-fund --loglevel=error
cd /opt/agenteve-next/mcp
npm ci --omit=dev --no-audit --no-fund --loglevel=error
REMOTE

say "3/7 pre-flight: the new build boots a world from genesis on an empty database"
"${SSH[@]}" "python3 /opt/agenteve-next/deploy/verify-standalone-restore.py --empty --engine-dir /opt/agenteve-next${CAST:+ --cast $CAST}"

say "4/7 migrate, then check every table is accounted for"
"${SSH[@]}" '( set -a; . /etc/agenteve/migrate.env; set +a; /usr/bin/node /opt/agenteve-next/engine/dist/db/migrate.js >/dev/null )'
TABLES="$("${SSH[@]}" "docker exec agenteve-db psql -U compact -d compact -Atc \"SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relispartition ORDER BY 1\"")"
UNKNOWN=''
for t in $TABLES; do
  case " ${WORLD_TABLES[*]} ${KEEP_TABLES[*]} " in *" $t "*) ;; *) UNKNOWN="$UNKNOWN $t" ;; esac
done
[ -z "$UNKNOWN" ] || { echo "refusing: tables on neither list:$UNKNOWN — add each to WORLD_TABLES or KEEP_TABLES in this script, deliberately"; exit 1; }
echo "all $(echo "$TABLES" | wc -w | tr -d ' ') tables accounted for"
if [ "$DRY_RUN" = yes ]; then
  "${SSH[@]}" 'rm -rf /opt/agenteve-next'
  echo "dry run: stopped before ending anything; the live world was not touched"
  exit 0
fi

say "5/7 end the current world (archived first, never deleted)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
HEAD_TICK="$("${SSH[@]}" "docker exec agenteve-db psql -U compact -d compact -Atc 'SELECT coalesce(max(tick), -1) FROM action_log'")"
"${SSH[@]}" "bash -s -- $STAMP" <<'REMOTE'
set -euo pipefail
stamp="$1"
install -d -m 0700 /var/lib/agenteve/archive
docker exec agenteve-db pg_dump -U compact -d compact -Fc > "/var/lib/agenteve/archive/world-final-$stamp.dump"
tar -C /var/lib/agenteve -czf "/var/lib/agenteve/archive/frames-final-$stamp.tar.gz" frames
[ ! -f /var/lib/agenteve/cast/memory.json ] || cp -a /var/lib/agenteve/cast/memory.json "/var/lib/agenteve/archive/cast-memory-final-$stamp.json"
chmod 0600 /var/lib/agenteve/archive/*
REMOTE
SIZE="$("${SSH[@]}" "stat -c %s /var/lib/agenteve/archive/world-final-$STAMP.dump")"
[ "$SIZE" -gt 100000 ] || { echo "refusing: the final dump is only $SIZE bytes, which is not a world; nothing has been ended"; exit 1; }
mkdir -p "$ARCHIVE_LOCAL"
scp -i "$KEY" -o BatchMode=yes -q "$HOST:/var/lib/agenteve/archive/world-final-$STAMP.dump" "$ARCHIVE_LOCAL/"
[ "$(stat -f %z "$ARCHIVE_LOCAL/world-final-$STAMP.dump")" = "$SIZE" ] || { echo "refusing: the local copy of the final dump does not match; nothing has been ended"; exit 1; }
"${SSH[@]}" "bash -s -- $STAMP $SIZE" <<'REMOTE'
set -euo pipefail
stamp="$1"; size="$2"
[ -f /etc/agenteve/backup.env ] || { echo "no /etc/agenteve/backup.env; skipping the R2 archive copy"; exit 0; }
set -a; . /etc/agenteve/backup.env; set +a
url="${AGENTEVE_R2_ENDPOINT%/}/$AGENTEVE_R2_BUCKET/archive/world-final-$stamp.dump"
curl --fail --silent --show-error --retry 3 -K /etc/agenteve/r2.curlrc -T "/var/lib/agenteve/archive/world-final-$stamp.dump" "$url"
got="$(curl --fail --silent --show-error -K /etc/agenteve/r2.curlrc --head "$url" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-length"{print $2}')"
[ "$got" = "$size" ] || { echo "the R2 archive copy is $got bytes, not $size; nothing has been ended"; exit 1; }
echo "final record also in R2: archive/world-final-$stamp.dump (never expires)"
REMOTE
echo "final record at tick $HEAD_TICK: $SIZE bytes, on the host in /var/lib/agenteve/archive and here in $ARCHIVE_LOCAL"

TRUNCATE_LIST="$(IFS=,; echo "${WORLD_TABLES[*]}")"
"${SSH[@]}" "bash -s -- $STAMP $TRUNCATE_LIST" <<'REMOTE'
set -euo pipefail
stamp="$1"; list="$2"
systemctl stop agenteve
# One statement, so one transaction: a half-emptied database is a world no code has seen.
docker exec agenteve-db psql -U compact -d compact -v ON_ERROR_STOP=1 -qc "TRUNCATE ${list} RESTART IDENTITY CASCADE"
rows="$(docker exec agenteve-db psql -U compact -d compact -Atc 'SELECT count(*) FROM action_log')"
[ "$rows" = 0 ] || { echo "action_log still holds $rows rows"; exit 1; }
rm -f /var/lib/agenteve/cast/memory.json
find /var/lib/agenteve/frames -mindepth 1 -delete
cp -a /etc/agenteve/env "/var/lib/agenteve/archive/env-before-$stamp"
chmod 0600 "/var/lib/agenteve/archive/env-before-$stamp"
echo "world tables emptied; cast memory and frames cleared"
REMOTE
UPDATES=("COMPACT_SEED=$SEED")
if [ -n "$CAST" ]; then
  # 48,000 prompt characters cost GPT-6 Astra no latency (~137 s at 24k and at 48k, measured
  # 2026-10-01) and at 24,000 the cast saw about half its affordances.
  UPDATES+=("COMPACT_CAST=$CAST" "COMPACT_CAST_CALLS_PER_RECKONING=$((CAST * 20))" "COMPACT_CAST_MAX_PROMPT_CHARS=48000")
fi
[ -z "$SEATS" ] || UPDATES+=("COMPACT_SEATS=$SEATS")
# Values here are validated above and never secret, so they may travel as arguments.
"${SSH[@]}" "python3 - ${UPDATES[*]}" <<'PY'
import os, sys
path = '/etc/agenteve/env'
updates = dict(arg.split('=', 1) for arg in sys.argv[1:])
drop = set(updates) | {'COMPACT_ACCEPT_DIVERGENCE_AT_TICK'}
kept = [line for line in open(path).read().splitlines() if line.partition('=')[0] not in drop]
temporary = path + '.new'
fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as stream:
    stream.write('\n'.join(kept + [f'{k}={v}' for k, v in updates.items()]) + '\n')
os.replace(temporary, path)
print('env set:', ', '.join(sorted(updates)), '| any divergence declaration removed')
PY

say "6/7 swap the trees and start the new world"
"${SSH[@]}" "bash -s -- $STAMP $MEMORY_GB" <<'REMOTE'
set -euo pipefail
stamp="$1"
memory_gb="${2:-}"
if [ -n "$memory_gb" ]; then
  # Node's default heap limit can sit far below the cgroup cap, so set both; leave headroom for RSS.
  install -d /etc/systemd/system/agenteve.service.d
  printf '[Service]\nMemoryMax=%sG\nEnvironment=NODE_OPTIONS=--max-old-space-size=%s\n' "$memory_gb" "$((memory_gb * 1024 * 3 / 4))" > /etc/systemd/system/agenteve.service.d/capacity.conf
fi
install -m 0644 /opt/agenteve-next/deploy/agenteve.service /etc/systemd/system/agenteve.service
systemctl daemon-reload
mv /opt/agenteve "/opt/agenteve-prev-$stamp"
mv /opt/agenteve-next /opt/agenteve
systemctl start agenteve
work="$(mktemp -d)"
mkdir "$work/agenteve-mcp"
cp /opt/agenteve/mcp/{server.mjs,client.mjs,spectator.mjs,call.mjs,package.json,package-lock.json,README.md} "$work/agenteve-mcp/"
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -C "$work" -cf - agenteve-mcp | gzip -n > /var/www/agenteve.io/mcp/agenteve-mcp.tar.gz.new
mv /var/www/agenteve.io/mcp/agenteve-mcp.tar.gz.new /var/www/agenteve.io/mcp/agenteve-mcp.tar.gz
install -m 0644 /opt/agenteve/mcp/README.md /var/www/agenteve.io/mcp/README.md
rm -rf "$work"
REMOTE

say "7/7 verify the new world against git"
report=''
for _ in $(seq 1 90); do
  if report="$(curl -fsS -m 10 https://agenteve.io/health 2>/dev/null)" &&
    python3 -c "import json,sys; r=json.loads(sys.argv[1])['report']; sys.exit(0 if r['world']=='RUNNING' and r['durability']['healthy'] else 1)" "$report"; then
    break
  fi
  report=''
  sleep 5
done
[ -n "$report" ] || { echo "the new world did not come up RUNNING; read journalctl -u agenteve. Rollback is in the summary below."; exit 1; }
python3 -c "import json,sys; r=json.loads(sys.argv[1])['report']; c=r.get('cast') or {}; print('health', r['status'], '| tick', r['tick'], '| population', r['seats']['population'], '| identities', r['seats']['rows'], '| cast', c.get('model'), c.get('members'), '| failures', r['failures'])" "$report"
[ "$(curl -fsS -m 10 https://agenteve.io/ | digest)" = "$(git show "$REV:client/index.html" | digest)" ] || { echo "index.html DIFFERS from git"; exit 1; }
[ "$(curl -fsS -m 10 https://agenteve.io/agent.md | digest)" = "$(git show "$REV:engine/agent.md" | digest)" ] || { echo "agent.md DIFFERS from git"; exit 1; }
[ "$("${SSH[@]}" 'cat /opt/agenteve/REVISION')" = "$REV" ] || { echo "REVISION on the host is not $REV"; exit 1; }
cat <<EOF

The previous world's record ENDED at tick $HEAD_TICK. It is archived, not deleted:
  host:  /var/lib/agenteve/archive/world-final-$STAMP.dump (+ frames, cast memory, env)
  here:  $ARCHIVE_LOCAL/world-final-$STAMP.dump
A new world is running as seed $SEED at revision $REV.
To return to the old world: stop agenteve; restore that dump into the compact database; put
/var/lib/agenteve/archive/env-before-$STAMP back as /etc/agenteve/env; move /opt/agenteve-prev-$STAMP
back to /opt/agenteve; start agenteve.
EOF
