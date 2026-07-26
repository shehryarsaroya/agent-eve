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
#
# EVERY PATTERN IS ANCHORED WITH A LEADING SLASH, and that is not style. An rsync
# pattern without one matches at ANY depth, so `--exclude 'cast/'` silently omitted
# `src/cast/` as well as the intended top-level house-cast directory. The build then
# failed with "Cannot find module '../cast/index.js'" — and it failed loudly only by
# luck, because the module happened to be imported at the top level. Had it been
# lazily required, the deploy would have succeeded and the cast would simply never
# have run.
#
# That is scar #4's shape with a different verb: the predecessor's `--delete` removed
# the players directory and reverted a live game to bots-only while looking healthy;
# an unanchored `--exclude` omits code and looks equally healthy. Anchoring makes the
# pattern mean the directory it names and nothing else.
EXCLUDES=(
  --exclude '/node_modules/'
  --exclude '/.env'
  --exclude '/.git/'
  --exclude '/dist/'
  --exclude '/coverage/'
  --exclude '/verify-restore.sh'   # ops script, lives on the box, not synced
  --exclude '/backups/'
  --exclude '/cast/'               # house cast dir on the BOX; src/cast/ must still sync
)

# ── preflight ───────────────────────────────────────────────────────────────
log "preflight"
$SSH 'test -f /etc/compact/env' || fail "/etc/compact/env missing — run the bootstrap first"
$SSH 'grep -q COMPACT_FRAMES_DIR /etc/compact/env' || fail "COMPACT_FRAMES_DIR not set in /etc/compact/env — the spectator client will have no frames"
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

  # Assert the sync actually delivered the tree, rather than trusting rsync's exit
  # code. An over-broad exclude exits 0 while omitting a module (see EXCLUDES above),
  # and scar #4's whole lesson is that a silent omission looks like health.
  MISSING_DIRS=$($SSH "cd $CODE_DIR/engine && for d in core ledger events world identity tick venture seal invariants reckoning observe api cast sim frames db; do test -d src/\$d || echo \$d; done")
  [[ -z "$MISSING_DIRS" ]] || fail "these source directories did not reach the server: $MISSING_DIRS"
  ok "every source directory arrived"

  $SSH "cd $CODE_DIR/engine && npm ci --silent 2>&1 | tail -2"
  ok "deps installed"

  # Compile on the box rather than shipping dist/: every import here carries a `.js`
  # extension (correct for compiled ESM), and Node's --experimental-strip-types does
  # not rewrite those to `.ts`, so running src/ raw dies on the first relative import.
  # Building makes the extensions true rather than aspirational.
  log "building"
  $SSH "cd $CODE_DIR/engine && npm run build 2>&1 | tail -2"
  ok "compiled to dist/"

  # Devtime deps were needed for the build; drop them now so the runtime module path
  # holds nothing the server does not use.
  $SSH "cd $CODE_DIR/engine && npm prune --omit=dev --silent 2>&1 | tail -1" || true
  ok "dev deps pruned"

  log "migrating database"
  $SSH "set -a && . /etc/compact/env && set +a && cd $CODE_DIR/engine && node dist/db/migrate.js"
  ok "migrations applied, partition runway asserted (OPS-3)"

  # ── THE REPLAY PREFLIGHT — the check that stops a deploy from bricking the world ──
  #
  # Boot replays the durable action log under whatever code is deployed. A change that
  # makes any PAST tick compute differently — an action the record says APPLIED that is
  # now refused, or arithmetic that moves a state_hash — makes boot unable to reproduce
  # the record. That is correctly a refusal to serve (A5'), but it means the world stops.
  #
  # So we ask the question BEFORE the restart, with the OLD process still serving: replay
  # the real journal against the NEW build in a throwaway process. It writes nothing.
  #
  #   exit 0  reproduces (or the divergence is one the operator already declared)
  #   exit 3  would NOT reproduce -> the deploy stops here and the world stays up
  #   exit 1  the check could not run -> also a stop, because an unrun check proves nothing
  #
  # To deploy a deliberate rules change, set COMPACT_ACCEPT_DIVERGENCE_AT_TICK to the
  # exact tick the check names, in /etc/compact/env. The boot then resumes the world and
  # writes the discontinuity into the permanent public record (journal_divergence).
  log "replay preflight — would this build still reproduce the record?"
  set +e
  $SSH "set -a && . /etc/compact/env && set +a && cd $CODE_DIR/engine && node dist/persist/replayCheck.js"
  REPLAY_STATUS=$?
  set -e
  case "$REPLAY_STATUS" in
    0) ok "this build reproduces the record — a restart will resume the world" ;;
    3) fail "THIS BUILD WOULD NOT REPRODUCE THE RECORD. The service was NOT restarted and the
     live world is still up on the old build. Read the tick and the reason above. Either
     fix the change, or accept the discontinuity deliberately by setting
     COMPACT_ACCEPT_DIVERGENCE_AT_TICK=<that exact tick> in /etc/compact/env and
     re-running this deploy." ;;
    *) fail "the replay preflight could not run (exit $REPLAY_STATUS). Refusing to restart: an
     unrun check proves nothing, and the failure mode it guards against is an
     unrecoverable crash loop with no HTTP surface." ;;
  esac
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

  # agent.md is the ONE artifact an agent must be able to play from with zero extra
  # reading, so it has to be fetchable. Copied from engine/agent.md rather than kept as
  # a second file in client/, because two copies of a rules surface is scar #1 waiting
  # for someone to edit the wrong one.
  scp -q -i "$KEY" "$REPO_ROOT/engine/agent.md" "root@$HOST:$WEB_DIR/agent.md"
  ok "agent.md published from its single source"
fi

# ── the rules surface must actually be served ───────────────────────────────
if [[ "$TARGET" == "client" || "$TARGET" == "all" ]]; then
  :
fi

# ── services ────────────────────────────────────────────────────────────────
log "installing unit files"
for unit in compact-api; do
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

# ── ONLY THE API NEEDS A RESTART ────────────────────────────────────────────
#
# A client-only deploy is static files and an nginx reload; restarting the API for it
# bounces a running world through a multi-minute replay for no reason, and then the
# post-deploy check reads the mid-replay 503 and calls the deploy failed. That is
# exactly what happened on the first client deploy after the frames fix: nothing was
# wrong, the world was simply replaying 3,071 of 3,297 ticks because a page of HTML
# had changed.
#
# The world checks below are gated with it: "is the world RUNNING" is not a question a
# client deploy is entitled to fail on, because a client deploy cannot affect it.
if [[ "$TARGET" == "api" || "$TARGET" == "sim" || "$TARGET" == "all" ]]; then

log "restarting services"
# `enable --now` was the bug: on an ALREADY-ACTIVE service `--now` runs `start`, and
# `start` on a running unit is a no-op — so a redeploy synced, built and migrated the new
# code and then never loaded it, leaving the OLD process (and its stale prompt, scar #1)
# live. `restart` always stops the old and starts the new; `enable` (idempotent) only
# keeps boot-persistence. That silent no-op is scar #4's shape a third time — a deploy that
# looks healthy while the change never took — so it is called out here.
$SSH 'systemctl enable compact-api >/dev/null 2>&1 || true; systemctl restart compact-api 2>&1 | tail -2'
sleep 4
for unit in compact-api; do
  $SSH "systemctl is-active --quiet $unit" || {
    $SSH "journalctl -u $unit -n 30 --no-pager" >&2
    fail "$unit failed to start"
  }
  ok "$unit active"
done
# Prove the restart actually loaded THIS build, not the old process: the new serve()
# prints a boot line the old one never did. Its absence means the cutover silently failed.
$SSH "journalctl -u compact-api --since '-60s' --no-pager 2>/dev/null | grep -qE 'compact: boot'" \
  || fail "the new build did not boot (no 'compact: boot' line in the last 60s) — the restart did not cut over"
ok "the new build booted (boot line present)"

# Boot REPLAYS the whole action log, which is O(head) and takes minutes on a long
# season. The port is bound from the first millisecond and answers 503 while it runs,
# so "not ready yet" and "held" and "dead" are three different things and the deploy
# must wait for the first to resolve rather than reading a mid-replay 503 as failure.
log "waiting for the replay to finish"
WAITED=0
# `curl | grep -q BOOTING` exits the loop when curl FAILS, because grep then sees no
# input — and curl fails for the first few seconds after a restart, while the socket is
# not yet accepting. So the loop declared the replay finished about as fast as it could
# be asked, twice tonight, and the post-deploy check then read a genuine BOOTING and
# called a healthy deploy failed. "Not answering yet" and "answering BOOTING" are the
# same state to this loop and must both keep it waiting; only a real answer that is not
# BOOTING may end it.
while $SSH "set -a && . /etc/compact/env && set +a
      BODY=\$(curl -s --max-time 5 http://127.0.0.1:\${COMPACT_PORT:-8787}/health || true)
      [[ -z \"\$BODY\" ]] && exit 0            # not answering yet: keep waiting
      grep -q BOOTING <<<\"\$BODY\"            # answering BOOTING: keep waiting
      "; do
  WAITED=$((WAITED + 5))
  [[ $WAITED -lt 600 ]] || fail "still replaying after 600s. The world is not lost — the process is up and
     answering 503 BOOTING — but boot is O(entire history) and has outgrown this timeout.
     Checkpoint adoption is the fix; until then, expect this to grow every season."
  printf '  replaying… %ss\n' "$WAITED"
  sleep 5
done
ok "the replay finished (waited ${WAITED}s)"

# HELD is the honest refusal, not a crash — the process is up and serving 503 with a
# diagnosis rather than looping. It is still a failed deploy, and the message has to say
# which of the two it is or the operator debugs the wrong thing.
if $SSH "journalctl -u compact-api --since '-60s' --no-pager 2>/dev/null | grep -q 'compact api HELD'"; then
  $SSH "journalctl -u compact-api --since '-120s' --no-pager | tail -40" >&2
  fail "the world is HELD: this build could not reproduce the record (see the diagnosis above).
     The process is alive and answering 503 on every route — it is NOT crash-looping — but no
     world is being served. Accept the discontinuity with COMPACT_ACCEPT_DIVERGENCE_AT_TICK,
     or roll back."
fi

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

# agent.md must return MARKDOWN, not the client's index.html. nginx's
# `try_files $uri $uri/ /compact/index.html` turns a missing file into a 200 serving a
# web page, so a probe fetching the rules would get HTML and try to parse it as rules —
# and the status code would say everything was fine. A 200 is not evidence; the content
# is. This check exists because that is exactly what happened.
FIRST=$(curl -s --max-time 20 https://agentinsurance.io/compact/agent.md | head -c 40)
grep -q 'THE COMPACT' <<<"$FIRST" || fail "agent.md is not being served as markdown (got: ${FIRST:0:40})"
grep -qv '<!DOCTYPE' <<<"$FIRST" || fail "agent.md fell through to index.html — a probe would parse HTML as rules"
ok "agent.md served as markdown"

# THE FRAME THE CLIENT ACTUALLY FETCHES, fetched the way the client fetches it.
#
# The frames were being written correctly for days while every viewer got index.html:
# a regex `location` with `alias` does not append the remaining URI, so the path never
# resolved and nginx fell through to the SPA. Server-side everything looked right — the
# file was on disk, the deploy passed — because nothing here had ever asked for the URL.
# Same shape as the agent.md check above, and added for the same reason: a 200 carrying
# the wrong body is worse than a 404, since it looks like success to everything except
# the thing that has to parse it.
FRAME=$(curl -s --max-time 20 https://agentinsurance.io/compact/frames/latest.json | head -c 60)
grep -qv '<!DOCTYPE' <<<"$FRAME" || fail "frames/latest.json fell through to index.html — the client polls this and would parse HTML as a frame"
grep -q '{' <<<"$FRAME" || fail "frames/latest.json is not JSON (got: ${FRAME:0:60})"
ok "the spectator frame is served as JSON"

# Post-deploy health has TWO distinct questions, and conflating them was a bug:
# "did the deploy work" vs "is a live run in progress". The service being up with a
# sound world is the deploy's business; whether LLM players are currently deciding is
# not — right after a restart there is no run, so the deciding-share floor (scar #14b)
# is EXPECTED to be tripped and must not fail the deploy. It is a monitoring alert for
# during a run, surfaced here as a warning.
HEALTH=$(curl -s --max-time 20 https://agentinsurance.io/compact/health || echo '{}')
printf '  health: %s\n' "$HEALTH"
# Structural soundness — these WOULD be deploy failures:
grep -q '"world":"RUNNING"' <<<"$HEALTH" || fail "world is not RUNNING after deploy"
grep -q '"rollback_gaps":\[\]' <<<"$HEALTH" || fail "rollback_gaps is non-empty — a halt left state dirty"
ok "service up, world RUNNING, no rollback gaps"
# The deciding-share floor is informational at deploy time.
if grep -q '"status":"healthy"' <<<"$HEALTH"; then
  ok "live agents deciding above the floor"
else
  printf '  \033[33m! deciding-share floor tripped — expected with no live cast running; not a deploy failure (scar #14b is a run-time alert)\033[0m\n'
fi

# Anything that was running before must still be running. This is the check
# whose absence let scar #4 stay invisible for days.
AFTER=$($SSH 'systemctl list-units "compact-*" --state=running --no-legend --no-pager 2>/dev/null | awk "{print \$1}" | sort' || true)
if [[ -n "${BEFORE:-}" ]]; then
  MISSING=$(comm -23 <(printf '%s\n' "$BEFORE") <(printf '%s\n' "$AFTER") || true)
  [[ -z "$MISSING" ]] || fail "these were running before the deploy and are not now: $MISSING"
fi
ok "nothing that was running stopped running"

fi  # end api-only restart + world verification

printf '\n\033[1;32mdeploy complete\033[0m  https://agentinsurance.io/compact/\n\n'
