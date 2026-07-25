#!/usr/bin/env bash
# THE COMPACT — deploy.
#
# Scar #4 cost a live outage: High Water's backend deploy ran `rsync --delete`
# into /opt/highwater/, which repeatedly deleted the sibling players/ directory
# and silently reverted the live game to bots-only. The game looked perfectly
# healthy the whole time. Two rules come out of that and both are enforced below:
#
#   1. Never --delete into a directory containing anything you did not sync.
#      Every sibling that lives under the target is listed as an --exclude.
#   2. After any deploy, verify the components you did NOT deploy are still
#      running — and running *properly*, not merely alive (scar #14b).
#
# Usage: ./deploy/deploy.sh [api|sim|client|all]
set -euo pipefail

HOST=147.93.179.114
KEY=~/.ssh/agenttransfer_vps
SSH="ssh -i $KEY -o ConnectTimeout=20 root@$HOST"
CODE_DIR=/opt/compact
WEB_DIR=/var/www/agentinsurance.io/compact
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TARGET="${1:-all}"

log()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
fail() { printf '  ✗ %s\n' "$*" >&2; exit 1; }

# Anything under $CODE_DIR that this script does not own. Add to this list
# BEFORE adding a sibling directory, not after an outage.
EXCLUDES=(
  --exclude node_modules
  --exclude .env
  --exclude .git
  --exclude dist
  --exclude coverage
  --exclude 'verify-restore.sh'   # ops script, lives here, not synced from repo
  --exclude 'backups/'
  --exclude 'cast/'               # house cast runs from its own dir on its own keys
)

# ── preflight ───────────────────────────────────────────────────────────────
log "preflight"
$SSH 'test -f /etc/compact/env' || fail "/etc/compact/env missing — run the bootstrap first"
ok "runtime env present (never read, never printed)"
$SSH 'systemctl is-active --quiet postgresql' || fail "postgresql not running"
ok "postgresql running"

# Record what is running BEFORE we touch anything, so the post-deploy check has
# something real to compare against rather than a guess.
BEFORE=$($SSH 'systemctl list-units "compact-*" --state=running --no-legend --no-pager 2>/dev/null | awk "{print \$1}" | sort' || true)
printf '  running before: %s\n' "${BEFORE:-none}"

# ── engine ──────────────────────────────────────────────────────────────────
if [[ "$TARGET" == "api" || "$TARGET" == "sim" || "$TARGET" == "all" ]]; then
  log "gate 0 before deploying anything"
  ( cd "$REPO_ROOT/engine" && npm run gate0 ) || fail "Gate 0 failed — refusing to deploy"
  ok "Gate 0 green"

  log "syncing engine → $CODE_DIR"
  # --delete is safe here ONLY because of the exclude list above.
  rsync -az --delete "${EXCLUDES[@]}" -e "ssh -i $KEY" \
    "$REPO_ROOT/engine/" "root@$HOST:$CODE_DIR/engine/"
  ok "engine synced"

  $SSH "cd $CODE_DIR/engine && npm ci --omit=dev --silent 2>&1 | tail -2"
  ok "production deps installed"

  log "migrating database"
  $SSH "set -a && . /etc/compact/env && set +a && cd $CODE_DIR/engine && node --experimental-strip-types src/db/migrate.ts"
  ok "migrations applied, partition runway asserted (OPS-3)"
fi

# ── spectator client ────────────────────────────────────────────────────────
if [[ "$TARGET" == "client" || "$TARGET" == "all" ]]; then
  log "syncing spectator client → $WEB_DIR"
  $SSH "mkdir -p $WEB_DIR"
  # NO --delete here. This lives inside the live landing page's webroot, and a
  # --delete with a wrong path would take agentinsurance.io down. The cost of a
  # stale orphan file is nothing; the cost of that mistake is the whole site.
  rsync -az -e "ssh -i $KEY" "$REPO_ROOT/client/" "root@$HOST:$WEB_DIR/"
  ok "client synced (deliberately without --delete)"
fi

# ── services ────────────────────────────────────────────────────────────────
log "installing unit files"
for unit in compact-api compact-sim; do
  scp -q -i "$KEY" "$REPO_ROOT/deploy/$unit.service" "root@$HOST:/etc/systemd/system/$unit.service"
done
$SSH 'systemctl daemon-reload'
ok "units installed"

log "installing nginx snippet"
scp -q -i "$KEY" "$REPO_ROOT/deploy/nginx-compact.conf" "root@$HOST:/etc/nginx/snippets/compact.conf"
# Wire it in with a single idempotent line rather than rewriting the vhost that
# also carries the live landing page and the certbot TLS block.
$SSH 'grep -q "snippets/compact.conf" /etc/nginx/sites-available/agentinsurance.io || \
      sed -i "0,/^    location \/ {/s##    include /etc/nginx/snippets/compact.conf;\n\n    location / {#" \
        /etc/nginx/sites-available/agentinsurance.io'
$SSH 'nginx -t' || fail "nginx config invalid — NOT reloading, the landing page stays up"
$SSH 'systemctl reload nginx'
ok "nginx reloaded"

log "restarting services"
$SSH 'systemctl enable --now compact-sim compact-api 2>&1 | tail -2'
sleep 4
for unit in compact-sim compact-api; do
  $SSH "systemctl is-active --quiet $unit" || {
    $SSH "journalctl -u $unit -n 30 --no-pager" >&2
    fail "$unit failed to start"
  }
  ok "$unit active"
done

# ── post-deploy verification — the scar #4 half ─────────────────────────────
log "post-deploy verification"

# The landing page is the thing most likely to be collateral damage, and it is
# not something we deployed, so it is exactly what scar #4 says to check.
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://agentinsurance.io/ || echo 000)
[[ "$CODE" == "200" ]] || fail "landing page returned $CODE — it was 200 before this deploy"
ok "landing page still 200"

CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://agentinsurance.io/whitepaper.html || echo 000)
[[ "$CODE" == "200" ]] || fail "whitepaper returned $CODE"
ok "whitepaper still 200"

# Health must assert the interesting property, not liveness (scar #14b).
HEALTH=$(curl -s --max-time 20 https://agentinsurance.io/compact/health || echo '{}')
printf '  health: %s\n' "$HEALTH"
grep -q '"ok":true' <<<"$HEALTH" || fail "health endpoint not ok"
ok "health ok"

# Anything that was running before must still be running. This is the check
# whose absence let scar #4 stay invisible for days.
AFTER=$($SSH 'systemctl list-units "compact-*" --state=running --no-legend --no-pager 2>/dev/null | awk "{print \$1}" | sort' || true)
if [[ -n "${BEFORE:-}" ]]; then
  MISSING=$(comm -23 <(printf '%s\n' "$BEFORE") <(printf '%s\n' "$AFTER") || true)
  [[ -z "$MISSING" ]] || fail "these were running before the deploy and are not now: $MISSING"
fi
ok "nothing that was running stopped running"

printf '\n\033[1;32mdeploy complete\033[0m  https://agentinsurance.io/compact/\n\n'
