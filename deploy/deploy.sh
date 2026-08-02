#!/usr/bin/env bash
# AGENT TRANSFER (né THE COMPACT) — deploy.
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
WEB_DIR=/var/www/agenttransfer.dev
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
  # ── A FAILED BUILD USED TO REPORT SUCCESS ─────────────────────────────────
  #
  # This line was `npm run build 2>&1 | tail -2`, and a pipeline exits with the status of
  # its LAST command — so `tail` returning 0 hid every compile error, the script printed
  # "compiled to dist/", and the restart below brought the service back up on whatever
  # `dist/` happened to be there from the previous deploy. A deploy that says it worked
  # while production runs older code is scar #4's shape by a different route: the failure
  # is invisible from the server side, everything looks right, and the only symptom is that
  # the change you shipped is not there.
  #
  # No pipe, so ssh returns the remote exit status; the log is tailed separately.
  log "building"
  $SSH "cd $CODE_DIR/engine && npm run build > /tmp/compact-build.log 2>&1" || {
    $SSH "tail -30 /tmp/compact-build.log" || true
    fail "the build FAILED on the server — dist/ is stale and the service was NOT restarted"
  }
  $SSH "tail -2 /tmp/compact-build.log" || true
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
  # ── HOW TO ACCEPT A DELIBERATE RULES CHANGE, AND WHY IT IS NOT A TICK ─────
  #
  # Set COMPACT_ACCEPT_DIVERGENCE_AT_TICK in /etc/compact/env to the FULL string the check
  # prints — `<tick>:<fingerprint>`, e.g. `287:9f3a1c4e5b07d218`. The boot then resumes the
  # world and writes the discontinuity into the permanent public record (journal_divergence),
  # with `accepted_as` naming exactly what was authorised.
  #
  # A BARE TICK IS REFUSED, and that refusal is the point. Measured on this very world:
  #
  #     select count(*), min(tick), max(tick) from journal_divergence;
  #      19 | 287 | 287
  #
  # Nineteen accepted divergences, every one at tick 287, because `=287` had been standing in
  # /etc/compact/env since an early change and nearly every rules change first diverges at the
  # world's first snapshot tripwire. A tick is WHERE a divergence is, never WHICH divergence it
  # is — so the standing declaration pre-authorised all nineteen and would have pre-authorised
  # every future one. The fingerprint binds the acceptance to the change, which is what lets
  # the line safely stay in the env file: it is inert against the next change by construction.
  #
  # ── AND THAT IS WHY THIS SCRIPT DOES NOT CLEAR THE VARIABLE AFTER A SUCCESS ─
  #
  # It was proposed, and the availability cost is real. `Restart=always` means the process can
  # come back at any moment, and a restart before the world has checkpointed under the NEW
  # rules replays from genesis and hits the accepted tripwire again — so it needs the door
  # still open. Clearing it here would turn any crash inside that window into a HELD world
  # waiting on a human, in exchange for hygiene that the binding already provides
  # structurally. A procedural fix layered on a structural one, paid for in outages.
  #
  # What replaces it: the preflight NAMES a standing declaration that no longer matches, so a
  # stale line is visible on every deploy rather than silently effective on one.
  log "replay preflight — would this build still reproduce the record?"
  set +e
  $SSH "set -a && . /etc/compact/env && set +a && cd $CODE_DIR/engine && node dist/persist/replayCheck.js"
  REPLAY_STATUS=$?
  set -e
  case "$REPLAY_STATUS" in
    0) ok "this build reproduces the record — a restart will resume the world" ;;
    3) fail "THIS BUILD WOULD NOT REPRODUCE THE RECORD. The service was NOT restarted and the
     live world is still up on the old build. Read the reason above: it prints the exact
     COMPACT_ACCEPT_DIVERGENCE_AT_TICK=<tick>:<fingerprint> line that accepts THIS change.
     Either fix the change, or put that exact line in /etc/compact/env and re-run. A bare
     tick is refused — it would pre-authorise every future change at the same tick, which is
     how nineteen consecutive rules changes were waved through this gate." ;;
    *) fail "the replay preflight could not run (exit $REPLAY_STATUS). Refusing to restart: an
     unrun check proves nothing, and the failure mode it guards against is an
     unrecoverable crash loop with no HTTP surface." ;;
  esac
fi

# ── spectator client ────────────────────────────────────────────────────────
if [[ "$TARGET" == "client" || "$TARGET" == "all" ]]; then
  log "syncing spectator client → $WEB_DIR"
  $SSH "mkdir -p $WEB_DIR"
  # STILL NO --delete, and the reason CHANGED on 2026-08-02 rather than going away.
  #
  # It used to be co-tenancy: this lived inside agentinsurance.io's webroot and a
  # --delete with a wrong path would have taken the landing page down. The game has its
  # own host now and owns this directory outright, so that specific danger is gone.
  #
  # What replaces it is the frames. COMPACT_FRAMES_DIR is $WEB_DIR/frames — the ENGINE
  # writes there every tick, and this script does not sync it. A --delete from client/
  # would therefore delete every published frame, including the whole Reckoning archive,
  # and the client would keep returning 200 while showing an empty world. That is scar #4
  # with the same shape and a different victim, which is the argument for keeping the
  # habit rather than re-earning the scar.
  rsync -az -e "ssh -i $KEY" "$REPO_ROOT/client/" "root@$HOST:$WEB_DIR/"
  ok "client synced (deliberately without --delete)"

  ok "client synced"
fi

# ── the rules surface ships with the RULES, not with the client ──────────────
#
# ⚑ **agent.md USED TO BE PUBLISHED ONLY BY THE `client` TARGET, AND THAT WAS A REAL OUTAGE
# OF THE RULES SURFACE.** Found by a blind probe on 2026-07-28: the deployed rulebook was
# **1,091 lines against 1,514 in the repo** — no §11D, no §11E — so every live agent had been
# playing with **no documentation of hulls, battles or campaigns at all**, while the engine
# offered them all three. Fifteen rules versions shipped through `deploy.sh api` and not one
# of them carried the document that describes them.
#
# The comment that used to sit here called agent.md *"the ONE artifact an agent must be able
# to play from with zero extra reading"* — which is exactly why it cannot be gated on the
# cosmetic target. **A rules change and its rulebook are one deploy.** This is scar #4's
# family: a deploy that reports success while silently omitting a component, except the
# component here is the rules themselves.
#
# Still copied from `engine/agent.md` rather than kept as a second file under `client/`,
# because two copies of a rules surface is scar #1 waiting for someone to edit the wrong one.
if [[ "$TARGET" == "api" || "$TARGET" == "client" || "$TARGET" == "all" ]]; then
  scp -q -i "$KEY" "$REPO_ROOT/engine/agent.md" "root@$HOST:$WEB_DIR/agent.md"
  ok "agent.md published from its single source"
fi

# ── the SERVED rulebook must be the one in this repo, line for line ─────────
#
# The old post-deploy check asserted only that `agent.md` came back as MARKDOWN. It passed
# for fifteen rules versions while the served document was **423 lines shorter than the repo's**
# and missing two whole sections. A check that cannot tell a stale rulebook from a current one
# is the "detector that cannot fail" shape this project keeps finding — it was green throughout.
#
# So compare the line count of what is actually served against the file that was just shipped.
# Not a hash: nginx may serve it with different line endings and a byte compare would cry wolf,
# which is how a check gets ignored. A line count catches truncation and a missing section,
# which are the two ways this has actually gone wrong.
if [[ "$TARGET" == "api" || "$TARGET" == "client" || "$TARGET" == "all" ]]; then
  WANT=$(wc -l < "$REPO_ROOT/engine/agent.md" | tr -d ' ')
  GOT=$(curl -s --max-time 20 https://agenttransfer.dev/agent.md | wc -l | tr -d ' ')
  if [[ "$WANT" != "$GOT" ]]; then
    fail "THE SERVED RULEBOOK IS NOT THE ONE IN THIS REPO: agent.md is $WANT lines here and
     $GOT lines at agenttransfer.dev/agent.md. Agents play from the served copy, so a
     stale one means the engine offers verbs the rules do not describe. This exact gap hid
     hulls, battles and campaigns from every live agent for fifteen rules versions because
     agent.md was published only by the 'client' target."
  fi
  ok "the served rulebook matches this repo ($WANT lines)"
fi

# ── services ────────────────────────────────────────────────────────────────
log "installing unit files"
for unit in compact-api; do
  scp -q -i "$KEY" "$REPO_ROOT/deploy/$unit.service" "root@$HOST:/etc/systemd/system/$unit.service"
done
$SSH 'systemctl daemon-reload'
ok "units installed"

log "installing the agenttransfer.dev vhost"
# A WHOLE VHOST, not an include. Until 2026-08-02 this was a fragment grafted into
# agentinsurance.io's vhost with an idempotent sed, because the game lived inside that
# site's webroot and could not have a server block of its own. It has its own host now,
# so it owns its own file and the graft is gone.
scp -q -i "$KEY" "$REPO_ROOT/deploy/nginx-agenttransfer.conf" \
    "root@$HOST:/etc/nginx/sites-available/agenttransfer.dev"
$SSH 'ln -sfn /etc/nginx/sites-available/agenttransfer.dev /etc/nginx/sites-enabled/agenttransfer.dev'
$SSH 'nginx -t' || fail "nginx config invalid — NOT reloading, the running site stays up"
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
# ── THE LOOP WAITS FOR A **POSITIVE** SIGNAL, AND THAT IS THE WHOLE FIX ──────
#
# This has now been wrong twice, in opposite directions, and both times it was the same mistake:
# the loop's exit condition was "the thing I am waiting for is ABSENT."
#
#   v1  `curl … | grep -q BOOTING`  — exited when CURL failed, because grep then saw no input.
#       So it declared the replay finished within seconds of a restart, while the socket was still
#       not accepting.
#   v2  the `[[ -z "$BODY" ]] && exit 0` / `grep -q BOOTING` pair — correct about those two states
#       and silent about every other one. On 2026-07-30 it printed *"the replay finished (waited
#       45s)"* while `/health` read `BOOTING, replayed_tick 4607 of 10136`, and the next check
#       failed the deploy on `world is not RUNNING`. **A healthy deploy reported as broken, which
#       trains an operator to ignore every check in this file.**
#
# Both versions enumerate the states that mean KEEP WAITING and treat the rest — an ssh blip
# (255), a body of an unexpected shape, a half-second where the old process is still answering
# RUNNING before systemd kills it, a wrong `COMPACT_PORT`, a proxy error page — as "done". That is
# a check that fails in the direction that hides, which is the one direction this repo has decided
# is never acceptable.
#
# Inverted: the loop ends only when the body affirmatively says `"world":"RUNNING"` **or** the world
# is `HELD` (an honest refusal the block below diagnoses). Everything else keeps waiting, and the
# timeout is the backstop. A hung deploy is a visible, bounded, diagnosable failure; a false
# "finished" is not.
#
# ── AND THE TIMEOUT IS 3600s, NOT 600 ───────────────────────────────────────
#
# Boot is O(entire history) and adoption is refused while the record carries declared
# discontinuities, so **this world replayed from genesis in ~37 minutes at tick 10,136** — six
# times the old bound. 600s would now fail every deploy of a mature shard on the clock alone. The
# real fix is a record epoch (or a world that never forked); until then the bound has to be honest
# about what boot costs.
WAITED=0
until $SSH "set -a && . /etc/compact/env && set +a
      BODY=\$(curl -s --max-time 10 http://127.0.0.1:\${COMPACT_PORT:-8787}/health || true)
      case \"\$BODY\" in
        *'\"world\":\"RUNNING\"'*) exit 0 ;;   # up: the only clean way out
        *'\"world\":\"HELD\"'*)    exit 0 ;;   # refused on purpose: diagnosed just below
        *)                            exit 1 ;;   # anything else at all: keep waiting
      esac"; do
  WAITED=$((WAITED + 5))
  [[ $WAITED -lt 3600 ]] || fail "still not RUNNING after ${WAITED}s. The world is probably not lost — the
     process is up and answering 503 BOOTING — but boot is O(entire history) and has outgrown even
     this bound. Check /health for replayed_tick against head_tick before doing anything: if it is
     still climbing, the deploy is fine and only this timeout is wrong. A record epoch is the fix."
  # Print the replay's own progress rather than only the clock, so "still going" and "wedged" are
  # different pictures to whoever is watching. An unmoving replayed_tick is the thing to act on.
  PROGRESS=$($SSH "set -a && . /etc/compact/env && set +a
      curl -s --max-time 10 http://127.0.0.1:\${COMPACT_PORT:-8787}/health 2>/dev/null \
        | tr ',' '\n' | grep -E 'replayed_tick|head_tick|world' | tr '\n' ' '" 2>/dev/null || true)
  printf '  replaying… %ss  %s\n' "$WAITED" "${PROGRESS:-(no answer yet)}"
  sleep 5
done
ok "the world answered RUNNING or HELD (waited ${WAITED}s)"

# HELD is the honest refusal, not a crash — the process is up and serving 503 with a
# diagnosis rather than looping. It is still a failed deploy, and the message has to say
# which of the two it is or the operator debugs the wrong thing.
if $SSH "journalctl -u compact-api --since '-60s' --no-pager 2>/dev/null | grep -q 'compact api HELD'"; then
  $SSH "journalctl -u compact-api --since '-120s' --no-pager | tail -40" >&2
  fail "the world is HELD: this build could not reproduce the record (see the diagnosis above).
     The process is alive and answering 503 on every route — it is NOT crash-looping — but no
     world is being served. The diagnosis prints the exact
     COMPACT_ACCEPT_DIVERGENCE_AT_TICK=<tick>:<fingerprint> line that accepts it — including
     when the reason it is held is that a STANDING declaration from an earlier deploy names a
     different change. Set that line, or roll back."
fi

# ── post-deploy verification — the scar #4 half ─────────────────────────────
#
# ── A HEALTHY DEPLOY MUST NOT REPORT FAILURE, EITHER ────────────────────────
#
# The last deploy exited **56** after every substantive step passed. The cause was in this
# block, three times over: `BODY=$(curl … | head -c 40)`. `head` exits the moment it has its
# 40 bytes and closes the pipe; `curl` then fails writing to it (56 is CURLE_RECV_ERROR), and
# `set -o pipefail` makes the pipeline's status the failing one, and `set -e` exits on it. So
# a completely sound deploy of a live world reported failure.
#
# That is the mirror image of scar #4, and no less dangerous. Scar #4 was a deploy that LOOKED
# healthy while being broken. This is a deploy that looks broken while being fine — and an
# operator who learns that the exit code lies has been trained to ignore every check in this
# file, which disarms all of them at once.
#
# The fix is `fetch`: one curl into a variable, no pipe at all, and the truncation done by bash
# substring expansion. A genuine fetch failure is then a genuine non-zero, named on the spot.
log "post-deploy verification"

# Fetch a URL into $BODY, or fail the deploy naming the URL.
#
# NO PIPELINE. `curl … | head` cannot distinguish "the server is down" from "the reader
# stopped reading", and under pipefail both come back as the same non-zero. Here curl either
# succeeds or its exit code reaches `fail` with the URL attached.
#
# The whole body is downloaded rather than the first N bytes. That is a deliberate trade: every
# artifact checked here is bounded (agent.md is tens of kB, a frame is budget-capped by
# `assertFrameBudgets`), and the alternative is the SIGPIPE this function exists to remove.
BODY=''
fetch() {
  local url="$1" status=0
  BODY=$(curl -sS --max-time 20 "$url") || status=$?
  [[ "$status" -eq 0 ]] || fail "could not fetch $url (curl exit $status)"
}

# Does the first slice of $BODY contain $1 — or not? Substring tests, not `grep -qv`.
#
# `grep -qv PATTERN` succeeds when ANY line lacks the pattern, so on a multi-line body it is
# true almost unconditionally — a check whose failure condition cannot occur, which is the
# defect class this deploy is fixing elsewhere. It only worked before because the body had
# already been truncated to one line. `[[ != * ]]` is correct at any length.
#
# Both are used as `head_x … || fail …` and never as `head_x … && fail …`: under `set -e` an
# `a && b` list whose overall status is non-zero exits the script, so the ALL-CLEAR path of an
# `&& fail` check would kill the deploy. That is the same class of accident as the SIGPIPE.
head_has()   { [[ "${BODY:0:400}" == *"$1"* ]]; }
head_lacks() { [[ "${BODY:0:400}" != *"$1"* ]]; }
# The same question of the WHOLE body, for a key that legitimately sits deep in a document.
body_has()   { [[ "$BODY" == *"$1"* ]]; }

# ── THE CO-TENANCY CHECK IS GONE, AND THAT IS THE POINT OF THE MOVE ──
#
# This used to curl agentinsurance.io/ and /whitepaper.html after every deploy, because
# the game lived INSIDE that site's webroot and scar #4 says to verify the thing you did
# not deploy. As of 2026-08-02 the site is on a different box entirely (ahmadecho,
# 89.117.78.215) and this one serves the game and nothing else. Checking the site from
# here would now be checking a server this script cannot affect — a red light for causes
# outside its reach, which is how a check earns a reputation for lying and stops being read.
#
# The rule it enforced still applies and still has teeth below: verify what you did not
# deploy. On this box that is compact-api itself when only the client was synced, and the
# BEFORE/AFTER unit comparison at the end.

# agent.md must return MARKDOWN, not the client's index.html. nginx's
# `try_files $uri $uri/ /index.html` turns a missing file into a 200 serving a
# web page, so a probe fetching the rules would get HTML and try to parse it as rules —
# and the status code would say everything was fine. A 200 is not evidence; the content
# is. This check exists because that is exactly what happened.
fetch https://agenttransfer.dev/agent.md
head_has 'how to play' || fail "agent.md is not being served as markdown (got: ${BODY:0:40})"
head_lacks '<!DOCTYPE' || fail "agent.md fell through to index.html — a probe would parse HTML as rules"
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
fetch https://agenttransfer.dev/frames/latest.json
head_lacks '<!DOCTYPE' || fail "frames/latest.json fell through to index.html — the client polls this and would parse HTML as a frame"
head_has '{' || fail "frames/latest.json is not JSON (got: ${BODY:0:60})"
ok "the spectator frame is served as JSON"

# THE MARKET'S PIXEL SIGNATURE, ON THE FRAME A VIEWER ACTUALLY GETS (A13).
#
# `market/` printed its first fill in this repo's history and no market or price key existed
# anywhere in `frames/latest.json`, so the first production fill would have been invisible.
# A13 is a ship gate: no named pixel signature, not ready. The key must be PRESENT even when
# empty — an absent key and an empty one are the same to a client, and "the economy has not
# traded here yet" is a fact the frame is supposed to be able to state.
body_has '"marketLines"' || fail "frames/latest.json carries no marketLines — the market has no pixel signature on the live frame (A13)"
ok "the market's print reaches the frame"

# THE ARCHIVE, FETCHED THE WAY A VIEWER REACHES IT.
#
# D23 #5 reported `frames/r-15.json` as a 404 and read it as "the per-Reckoning archive
# is not served". It was served the whole time: frames are padded to six digits, so the
# file is `r-000015.json`, and nothing published that naming rule — so the history was
# reachable and undiscoverable, which for a viewer is the same thing. The index is the
# fix, and it is checked the same way the frame is: by fetching the URL and reading the
# body, because a 200 carrying HTML looks like success to everything but the parser.
fetch https://agenttransfer.dev/frames/index.json
head_lacks '<!DOCTYPE' || fail "frames/index.json fell through to index.html — the history strip would parse HTML as an index"
body_has '"reckonings"' || fail "frames/index.json carries no reckonings (got: ${BODY:0:80})"
# And the file it names must actually be there. A table of contents with a broken link in
# it is worse than no table of contents, because a viewer blames the show.
#
# Bash's own regex rather than `sed … | head -1`: that pipeline had the identical SIGPIPE shape
# (head closes, sed dies, pipefail promotes it) and only ever survived because a 200-byte
# herestring drained before head exited. `=~` finds the leftmost match, which is the first
# entry in the index — the same file the old pipeline picked.
ARCHIVED=''
if [[ "$BODY" =~ \"file\":\"(r-[0-9]+\.json)\" ]]; then ARCHIVED="${BASH_REMATCH[1]}"; fi
[[ -n "$ARCHIVED" ]] || fail "frames/index.json names no archive file"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://agenttransfer.dev/frames/$ARCHIVED" || echo 000)
[[ "$CODE" == "200" ]] || fail "the index names $ARCHIVED and it returns $CODE — the archive has a broken link in it"
ok "the archive is indexed and $ARCHIVED resolves"

# Post-deploy health has TWO distinct questions, and conflating them was a bug:
# "did the deploy work" vs "is a live run in progress". The service being up with a
# sound world is the deploy's business; whether LLM players are currently deciding is
# not — right after a restart there is no run, so the deciding-share floor (scar #14b)
# is EXPECTED to be tripped and must not fail the deploy. It is a monitoring alert for
# during a run, surfaced here as a warning.
HEALTH=$(curl -s --max-time 20 https://agenttransfer.dev/health || echo '{}')
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

printf '\n\033[1;32mdeploy complete\033[0m  https://agenttransfer.dev/\n\n'
