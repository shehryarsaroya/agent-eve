#!/usr/bin/env bash
# Deploy origin/master to the standalone Agent Eve host (docs/background/INFRA.md).
#
# Ships exactly the pushed commit (git archive, never the working tree) and stamps it in
# /opt/agenteve/REVISION, so "is production in sync with git?" is one command. Builds on the
# host in a fresh staging directory, boots the NEW build against a restore of a fresh backup
# before the live tree is touched, then swaps directories so a rollback is one `mv` away.
# Run from the repo root on the operator's machine. Names only: no secret passes through here.
set -euo pipefail

HOST="${AGENTEVE_HOST:-root@89.117.78.215}"
KEY="${AGENTEVE_SSH_KEY:-$HOME/Projects/yc-gstack-kit/credentials/keys/ahmadecho_vps_ed25519}"
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=60 -o ServerAliveInterval=30 "$HOST")
SHIP=(engine client deploy mcp README.md TRACKER.md)

say() { printf '\n== %s\n' "$*"; }
digest() { shasum -a 256 | cut -c1-64; }

say "1/6 what ships is what GitHub has"
[ -z "$(git status --porcelain)" ] || { echo "refusing: the working tree is not clean"; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = master ] || { echo "refusing: not on master"; exit 1; }
git fetch -q origin master
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/master)" ] || { echo "refusing: HEAD is not origin/master; push first"; exit 1; }
REV="$(git rev-parse HEAD)"
echo "revision $REV"

say "2/6 stage into a fresh directory"
"${SSH[@]}" 'rm -rf /opt/agenteve-next && mkdir -p /opt/agenteve-next'
git archive --format=tar "$REV" "${SHIP[@]}" | "${SSH[@]}" 'tar -x -C /opt/agenteve-next'
"${SSH[@]}" "echo $REV > /opt/agenteve-next/REVISION"

say "3/6 build on the host"
"${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
cd /opt/agenteve-next/engine
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent
npm prune --omit=dev --no-audit --no-fund --loglevel=error
cd /opt/agenteve-next/mcp
npm ci --omit=dev --no-audit --no-fund --loglevel=error
REMOTE

say "4/6 pre-flight: a fresh backup, then the NEW build boots against its restore"
"${SSH[@]}" 'systemctl start agenteve-maintenance && python3 /opt/agenteve-next/deploy/verify-standalone-restore.py --engine-dir /opt/agenteve-next'

say "5/6 swap, migrate, restart"
"${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
install -d -o agenteve -g agenteve -m 0700 /var/lib/agenteve/cast
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
if ! cmp -s /opt/agenteve-next/deploy/agenteve.service /etc/systemd/system/agenteve.service; then
  install -m 0644 /opt/agenteve-next/deploy/agenteve.service /etc/systemd/system/agenteve.service
  systemctl daemon-reload
fi
# Migrations are additive, so they run before the swap: a failure here leaves the live tree
# and the running world exactly as they were.
( set -a; . /etc/agenteve/migrate.env; set +a; /usr/bin/node /opt/agenteve-next/engine/dist/db/migrate.js >/dev/null )
systemctl stop agenteve
mv /opt/agenteve "/opt/agenteve-prev-$stamp"
mv /opt/agenteve-next /opt/agenteve
systemctl start agenteve
for _ in $(seq 1 12); do systemctl is-active --quiet agenteve && break; sleep 5; done
if ! systemctl is-active --quiet agenteve; then
  echo "the new build did not stay up; rolling back to /opt/agenteve-prev-$stamp"
  systemctl stop agenteve || true
  mv /opt/agenteve "/opt/agenteve-failed-$stamp"
  mv "/opt/agenteve-prev-$stamp" /opt/agenteve
  systemctl start agenteve
  exit 1
fi
# The public MCP download, rebuilt from the deployed tree so it cannot drift from git.
work="$(mktemp -d)"
mkdir "$work/agenteve-mcp"
cp /opt/agenteve/mcp/{server.mjs,client.mjs,spectator.mjs,call.mjs,package.json,package-lock.json,README.md} "$work/agenteve-mcp/"
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -C "$work" -cf - agenteve-mcp | gzip -n > /var/www/agenteve.io/mcp/agenteve-mcp.tar.gz.new
mv /var/www/agenteve.io/mcp/agenteve-mcp.tar.gz.new /var/www/agenteve.io/mcp/agenteve-mcp.tar.gz
install -m 0644 /opt/agenteve/mcp/README.md /var/www/agenteve.io/mcp/README.md
rm -rf "$work"
# Keep the two newest previous trees. This script created every one of them.
ls -1d /opt/agenteve-prev-* 2>/dev/null | sort | head -n -2 | xargs -r rm -rf
echo "previous tree kept at /opt/agenteve-prev-$stamp"
echo "rollback: systemctl stop agenteve && mv /opt/agenteve /opt/agenteve-failed-$stamp && mv /opt/agenteve-prev-$stamp /opt/agenteve && systemctl start agenteve"
REMOTE

say "6/6 verify the public site against git"
report=''
for _ in $(seq 1 90); do
  if report="$(curl -fsS -m 10 https://agenteve.io/health 2>/dev/null)" &&
    python3 -c "import json,sys; r=json.loads(sys.argv[1])['report']; sys.exit(0 if r['world']=='RUNNING' and r['durability']['healthy'] else 1)" "$report"; then
    break
  fi
  report=''
  sleep 5
done
[ -n "$report" ] || { echo "the world did not come back RUNNING within 7.5 minutes; see journalctl -u agenteve"; exit 1; }
python3 -c "import json,sys; r=json.loads(sys.argv[1])['report']; c=r.get('cast') or {}; print('health', r['status'], '| tick', r['tick'], '| failures', r['failures'], '| cast model', c.get('model'))" "$report"
[ "$(curl -fsS -m 10 https://agenteve.io/ | digest)" = "$(git show "$REV:client/index.html" | digest)" ] || { echo "index.html DIFFERS from git"; exit 1; }
[ "$(curl -fsS -m 10 https://agenteve.io/agent.md | digest)" = "$(git show "$REV:engine/agent.md" | digest)" ] || { echo "agent.md DIFFERS from git"; exit 1; }
[ "$("${SSH[@]}" 'cat /opt/agenteve/REVISION')" = "$REV" ] || { echo "REVISION on the host is not $REV"; exit 1; }
echo "deployed $REV: index.html, agent.md and REVISION match git"
