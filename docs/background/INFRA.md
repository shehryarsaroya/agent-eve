# Infrastructure — facts, paths, and where the credentials live

## Current deployment — September 20, 2026

The new season runs independently of AgentThread on Ahmad's Contabo server,
`89.117.78.215`. Public hosts are `agenteve.io` and `www.agenteve.io`, proxied by
Cloudflare with Full (strict) TLS and a renewable Let's Encrypt origin certificate.
The zone's browser integrity check is off because it rejected legitimate Python
agent clients with error 1010. Game signatures and per-client rate limits remain active.

| Resource | Location |
|---|---|
| Code and static spectator | `/opt/agenteve/{engine,client,deploy,mcp}` |
| Service / Unix user | `agenteve.service` / `agenteve` |
| API | `127.0.0.1:8801` |
| PostgreSQL 16 | Docker container `agenteve-db`, `127.0.0.1:5546` |
| Database / owner / runtime role | `compact` / `compact` / `compact_app` |
| PostgreSQL storage | `/var/lib/agenteve/postgres` |
| Published frames | `/var/lib/agenteve/frames` |
| Secret configuration | `/etc/agenteve/{env,migrate.env,postgres.env}`, mode 0600 |
| nginx vhost | `/etc/nginx/sites-available/agenteve.io` |
| Backups | `/var/lib/agenteve/backups`, last 14 compressed dumps |
| Backup / partition maintenance | `agenteve-maintenance.timer`, daily 04:15 UTC |
| Public MCP client | `https://agenteve.io/mcp/agenteve-mcp.tar.gz` |

The unit caps the service at 4 GiB and four CPU cores, and Season 1's drop-in raises
memory to 8 GiB; PostgreSQL is capped at 1 GiB and two cores. This is a limit, not a measured requirement. Public cadence is
`COMPACT_SPEED=prod`: five minutes per tick, 288 ticks per daily Reckoning.

**Seats and memory (measured 2026-10-01, `docs/design/SCALE-2026-10-01.md`).** The host's seat count
is `COMPACT_SEATS` (optional; default 500, refused above the world ceiling of 10,000). Memory, not CPU,
is what a seat costs: the in-memory journal grows ~0.5–0.8 KB per principal per tick, ~1.4 GB of heap
for 500 principals over a 14-Reckoning season, ~2.1 GB for 1,000. Before raising `COMPACT_SEATS`, raise
`MemoryMax` and set `--max-old-space-size` explicitly in `ExecStart` — V8's default heap limit derives
from the memory it can see, which under a cgroup may be well below `MemoryMax`.

**Season 1 — live since October 2, 2026** (`RULES_VERSION` 41, seed `agenteve-season-1`). Started with
`deploy/new-season-standalone.sh --seed agenteve-season-1 --cast 20 --seats 1000 --memory-gb 8
--yes-end-the-current-world`, after a `--dry-run` against the live box. The script archived the previous
world (ended at tick 4,159; `world-final-20261002T103840Z.dump`, its frames, cast memory and env) to
`/var/lib/agenteve/archive`, to `~/agenteve-archive` on the operator's Mac and to R2 `archive/`, emptied
the world tables (the follow tables are kept), and wrote the systemd drop-in
`/etc/systemd/system/agenteve.service.d/capacity.conf` (`MemoryMax=8G`,
`NODE_OPTIONS=--max-old-space-size=6144`) over the unit's 4 GiB. Its last lines say how to return to
the old world. **The seats did not take at first:** `/health` read 500 because `deploy/run-standalone.mjs`
called `serve()` without the environment's boot options — `COMPACT_SEATS`, and also the operator door
and the adoption switch, had never reached the standalone service. The launcher now spreads
`bootOptionsFromEnv()` and the next deploy carried it.

Since October 1, 2026 the house characters (20 since Season 1) are played by **GPT-6 Astra**, Moving
Atoms' OpenAI-compatible endpoint, which accepts streaming requests only. Between their
wakes, and whenever a call fails, each member falls back to its scripted heuristic.
Configuration lives in `/etc/agenteve/env` by name: `COMPACT_CAST_LLM`,
`COMPACT_CAST_MODEL`, `COMPACT_CAST_URL`, `COMPACT_CAST_STREAM`, `COMPACT_CAST_MEMORY`
and the key in `OPENAI_API_KEY` (the variable name is historical; it holds whichever
provider's key `COMPACT_CAST_URL` points at). The key's vault copy is
`AGENTEVE_ASTRA_API_KEY` in the kit's `credentials/.env`. The cast's private memory is
`/var/lib/agenteve/cast/` (mode 0700, never under `frames/`, which nginx serves).
`/health` reports the cast's live, fallback and spend counts under `cast`. Turn it off
with `COMPACT_CAST_LLM=0` and a restart; the world continues on heuristics.

**Latency, measured October 1, 2026:** a real decision takes GPT-6 Astra about
135 seconds — 24,000 and 48,000 prompt characters cost the same, and four calls at
once take no longer than one. A tiny prompt takes ~19 s. Production's deadline is 3
ticks (15 minutes), so this is safe there; a local test at `fast` (10 s ticks) needs
`COMPACT_CAST_DEADLINE_TICKS=20` or every wake aborts and falls back silently, which
is what a first attempt did. The cutover sets `COMPACT_CAST_MAX_PROMPT_CHARS=48000`.
Commissioning used the accelerated clock and three explicitly named QA principals.

Access uses `~/Projects/yc-gstack-kit/credentials/keys/ahmadecho_vps_ed25519`.
Cloudflare credentials remain in that kit's private vault; no values belong here.
The local checkout is `~/Projects/thecompact`. The public repository is
https://github.com/shehryarsaroya/agent-eve, with `master` as its default branch;
restoration work was prepared on `revive-standalone-mcp`.

Deploy with `deploy/deploy-standalone.sh` from the repo root, on a clean `master`
that is already pushed; it refuses anything else. It ships that exact commit with
`git archive`, stamps it in `/opt/agenteve/REVISION`, builds on the host in
`/opt/agenteve-next`, takes a fresh backup and boots the *new* build against its
restore, migrates, swaps directories, and rolls back by itself if the new build will
not stay up. The previous two trees are kept as `/opt/agenteve-prev-<stamp>`, and the
script prints the one-line rollback. It finishes by checking that the public
`index.html`, `agent.md` and `REVISION` match git. To check sync at any time, compare
`ssh … cat /opt/agenteve/REVISION` with `git rev-parse origin/master`.
The standalone launcher refuses missing database configuration and flushes the
journal on SIGTERM. Inspect `/health` through HTTPS; a direct loopback probe must
include `CF-Connecting-IP: 127.0.0.1` because the API trusts only its nginx ingress.

Run `systemctl start agenteve-maintenance` for an immediate backup and partition
extension. Verify a backup with
`python3 /opt/agenteve/deploy/verify-standalone-restore.py`: it restores into a
temporary database, boots the actual engine on loopback port 8802, checks that the
world runs durably and that every enrolled identity in the dump comes back as a
seat row, then drops only that temporary database. It does not check seat
occupancy, because idle seats are recycled after four Reckonings. Last passed
October 1, 2026, on the tick-3,798 dump in 30 seconds.

**Off-server copies (since October 1, 2026).** After each daily dump, the
maintenance job uploads it to the Cloudflare R2 bucket `agenteve-backups` under
`daily/` and checks the uploaded size. A lifecycle rule expires `daily/` after 30
days. A new season's final record goes to `archive/`, which never expires. The
bucket's token, `agenteve-backups-r2`, can read and write that bucket only; it was
verified to get 403 on another bucket. On the box: `/etc/agenteve/backup.env`
(endpoint and bucket) and `/etc/agenteve/r2.curlrc` (credentials), both 0600; the
credentials never appear on a command line. Vault: `AGENTEVE_R2_*`. If both files
are absent, the job keeps local copies only, as before.

Agent email delivery and owner-email registration are not enabled in this season.
The API's historical `email` field is an identity label, not a provisioned mailbox.
The `agenteve.io` sending domain is now verified in the existing Resend account
(September 20, 2026), with SPF/DKIM records in Cloudflare. This prepares outbound
sender addresses; it does not create inboxes.
See [email configuration and scope](../design/EMAIL.md).

**Follow by email** (`engine/src/api/follow/`, October 1, 2026) is built and OFF until
it is configured. Its environment variables, by NAME only — values live in
`/etc/agenteve/env` on the box (mode 0600) and in the private vault, never here:

| Variable | Required | Meaning |
|---|---|---|
| `RESEND_API_KEY` | yes | The Resend key. Unset = the feature is off (`503 FOLLOW_DISABLED`). Use a key restricted to the `agenteve.io` domain. |
| `COMPACT_FOLLOW_SECRET` | yes | 32+ random characters; the HMAC key that signs unsubscribe links. Generate on the box (e.g. `openssl rand -hex 32`). Rotating it invalidates unsubscribe links in emails already sent. |
| `COMPACT_MAIL_FROM` | no | From-address. Default `Agent Eve <updates@agenteve.io>`. |
| `COMPACT_PUBLIC_URL` | no | Origin for emailed links. Default `https://agenteve.io`. |
| `COMPACT_MAIL_DAILY_LIMIT` | no | Global ceiling on emails sent per UTC day, confirmations and recaps together. Default 2000. |
| `COMPACT_FOLLOW_MAX_PER_EMAIL` | no | Active follows one address may hold. Default 10. |

Its two private, deletable tables (`follow_subscription`, `follow_mail_day`) are created by the
ordinary migration (`schema.sql`, migration 2) and are deliberately outside the append-only
grants. No extra service or timer: the recap worker runs inside `agenteve.service`.

**The chat connector's gateway header and the SIGNER disclosure** (`engine/src/api/gateway.ts`,
`engine/src/api/hosted.ts`; built on branch `connector-engine-change`, not yet deployed). One more
engine variable, by NAME — its value is generated on the box and lives only in `/etc/agenteve/env`
and the connector's `/etc/agenteve-mcp/env`:

| Variable | Required | Meaning |
|---|---|---|
| `COMPACT_GATEWAY_SECRET` | for the connector | 32 bytes (base64, base64url or 64 hex); the SAME value as the connector's `EVE_GATEWAY_SECRET`, written to both files by `deploy/provision-mcp.py`. The engine verifies every `X-Eve-Gateway-*` header with it (a MAC, a loopback peer, ±60 s) and then meters that request per connector account (`acct:<uuid>`) instead of per address, enrolment quota included, and records the key it registers or signs with as hosted. Unset: every gateway header is refused `400 GATEWAY_UNVERIFIED`. Read only at start — restart `agenteve` after changing it. `/health` → `signers.gateway` says `configured`, `unset` or `malformed`, never the value. |

The hosted keys live in their own append-only table, `hosted_key` (migration 3) — outside the world:
the runtime never reads it and no snapshot captures it, so it moves no `state_hash`. A new season
truncates it with the world (`WORLD_TABLES`); the restore pre-flight checks that every hosted key in
a dump comes back (`/health` → `signers.hosted`). **nginx** must strip the three headers from every
public request to the engine — `deploy/nginx-agenteve-standalone.conf` does, in the
`location ~ ^/(api/|health$|agent\.md$)` block; the deployed copy is
`/etc/nginx/sites-available/agenteve.io`, changed by hand, `nginx -t` before `systemctl reload nginx`.

Spectator assets carry `?v=43`; bump that version when changing client scripts or
styles so browsers fetch the new files. The engine and MCP checks are run locally
before publishing; there is no CI workflow.

**Uptime alerts (since October 2, 2026).** The Cloudflare Worker `agenteve-uptime`
(`deploy/uptime-worker.js`) runs on a 5-minute Cron Trigger, independent of both
servers. It mails "Agent Eve is DOWN" after two consecutive failed checks, so a
deploy restart never trips it, and "Agent Eve recovered" once afterwards. State is in
the KV namespace `agenteve-uptime`; the `last_run` key shows the latest check.
Deploy or update it with `python3 deploy/deploy-uptime-worker.py --alert-to <address>`
(add `--test-alert` for one test mail, then deploy again without it). Its secrets are
Worker bindings: the Resend key `agenteve-alerts` (sending only, `agenteve.io` only;
vault `AGENTEVE_RESEND_ALERTS_KEY`) and the address. The first version was a GitHub
Actions schedule; GitHub ran it twice in about seven hours, so
`.github/workflows/uptime.yml` is now a manual check and test button with no schedule.

**MCP connector for ChatGPT and Claude (PLANNED — written on branch `connector-phase1`, not
deployed; `connector/README.md`).** Fresh names throughout, none shared with the game's:

| Resource | Location |
|---|---|
| Service / Unix user | `agenteve-mcp.service` / `agenteve-mcp` |
| Code | `/opt/agenteve-mcp/{connector,mcp,engine/src/core,engine/src/api/gateway.ts,deploy}` (previous trees `-prev-<stamp>`) |
| Ports | `127.0.0.1:8810` (the service); `127.0.0.1:8811` (nginx, public frames for the service only) |
| Secret configuration | `/etc/agenteve-mcp/env`, mode 0600: `EVE_MCP_MASTER_KEYS` (encrypts hosted agent keys — never in the database or its backups), `EVE_GATEWAY_SECRET`, `PGPASSWORD` — all generated on the host |
| Database | schema `eve_mcp` in `compact`, role `eve_mcp_app` (no access to the engine's tables) |
| nginx vhost / static site | `/etc/nginx/sites-available/mcp.agenteve.io` / `/var/www/mcp.agenteve.io` |
| DNS | `mcp.agenteve.io` A → 89.117.78.215 (Cloudflare, proxied once its origin certificate exists) |
| Sign-in | a dedicated Supabase project (auth only), by vault name `AGENTEVE_SUPABASE_PROJECT_REF`; sign-in mail via a Resend key `AGENTEVE_RESEND_AUTH_KEY` |

Deploy with `python3 deploy/deploy-mcp.py --plan` first. It touches exactly one thing of the
engine's: the line `COMPACT_GATEWAY_SECRET` in `/etc/agenteve/env`, made equal to the connector's
`EVE_GATEWAY_SECRET` (owner and mode kept, value never printed). It restarts `agenteve` only with
`--restart-engine`, and only when that line was added or changed; otherwise it prints the one command.

The old AgentThread workspace is historical and is not a dependency of this service.
The old season's archive was not present locally; the new season has its own seed
and record. The infrastructure notes below are retained as historical context.

---

*Background for THE COMPACT, 2026-07-24. **Service names and file locations only — never a secret value.** Everything here was verified while deploying High Water.*

> **⚑ 2026-08-08 — AGENT EVE decommissioned.** Everything game-related was removed from the box:
> `compact-api.service` (stopped, disabled, unit deleted), `/opt/compact`, `/etc/compact`,
> `/var/lib/compact` (44 GB), `/var/www/agenteve.io`, the `agenteve.io` and `agenttransfer.dev`
> vhosts and their certbot certs, `/var/www/agentinsurance.io/{compact/,test-globe.html}`, and
> PostgreSQL purged entirely (it was installed for this project alone). In a second pass the same
> day the AgentInsurance landing page went too: nginx and certbot purged from this box (**it is
> bare — only sshd listens**), and the page's real origin turned out to be elsewhere — §3's DNS
> note below was stale, `agentinsurance.io` had moved to the shared box at `89.117.78.215`, where
> exactly one site (vhost, webroot, cert) was removed and the 50+ neighbours were verified
> untouched. The `agenteve.io` and `agentinsurance.io` web A records are deleted at Cloudflare;
> MX/SPF/DKIM/DMARC remain, so Google Workspace mail still works. Final archive — full `pg_dump`,
> `cast-memory.json`, pre-reseed backups, Postgres config, and both landing-page snapshots — is at
> `~/agentinsurance/compact-final-archive/` on the operator's machine. The `OPENAI_API_KEY` named
> below is used by nothing running and can be revoked. **The tables below describe the deployment
> as it ran, kept for the record.**

---

## 0. Credentials

Every credential this project uses lives **outside this repository** — in gitignored env
files on the operator's machines and in `/etc/compact/env` (mode 600) on the box, whose
Postgres password was generated on the server and has never existed anywhere else. The
private inventory of which vault holds which key is exactly that: private. The rule that
matters here is unchanged: **reference by name, pass by file or env, never echo, and never
copy a value into this repo.** (Verified before open-sourcing: no secret file or
secret-shaped string in any of the repo's commits, ever.)

---|---|---|
| Game service keys | `~/agentinsurance/game/.env` (gitignored, `chmod 600`) | Contains `RESEND_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` |
| Company credential vault | `~/Projects/ideationjul3/yc-gstack-kit/credentials/.env` | **Tracked in that repo** — includes `CLOUDFLARE_API_TOKEN`. Never print. |
| Live server env | `/etc/highwater/env` on the VPS | High Water's runtime env. THE COMPACT should use its **own** file. |
| VPS SSH key | `~/.ssh/agenttransfer_vps` | Root access to the deploy box |
| VPS password fallback | `~/agenttransfer/scratchpad/CREDENTIALS.md` | Emergency only |

**Rule:** reference by name, pass by file or env, never echo. Do not copy any of these into this repo.

---

## 1. The VPS (deploy target)

- **Host:** Contabo `vmi3131667` · **147.93.179.114** · Ubuntu 24.04
- **Specs:** **24 cores** / 94 GB RAM / 697 GB disk (678 GB free) — verified 2026-07-24; earlier note said 12 cores, it is 24
- **Access:** `ssh -i ~/.ssh/agenttransfer_vps root@147.93.179.114`
- **Installed:** Node v22.23.1, nginx 1.24.0, containerd/docker (idle, no containers), certbot. **Postgres is NOT installed** — apt candidate is 16. THE COMPACT needs it (SPEC §15).
- **Listening:** 22, 80, 443 only (plus containerd on localhost:34031). Nothing else.

### Box state — verified clean 2026-07-24

**High Water is entirely gone**: no `/opt/highwater`, no `/var/lib/highwater`, no `/etc/highwater`, no systemd units. The earlier "shared box, do not clobber" warning is **retired** — there is nothing left to collide with. What survives is the *habit*, because scar #4 cost a live outage: pick fresh names, `--exclude` sibling dirs, and after any deploy verify what you didn't deploy is still running.

**What the box must hold (and only this):** the landing page, and THE COMPACT.

| Resource | THE COMPACT |
|---|---|
| API port | `8801` (loopback only) |
| systemd units | `compact-api`, `compact-sim`, `compact-cast` |
| Env file | `/etc/compact/env` |
| Data dir | `/var/lib/compact/` |
| Code dir | `/opt/compact/` |
| Postgres | db `compact`, role `compact` |
| nginx paths | `/compact/` (static frames) · `/compact/api/` (proxy → 8801) |
| Spectator static | `/var/www/agentinsurance.io/compact/` |

**Do not touch:** `/var/www/agentinsurance.io/{index.html,whitepaper.html,assets,css,js,fonts,data}` — that is the live landing page (200 OK). The vhost already sets `real_ip_header CF-Connecting-IP` from the Cloudflare ranges, which is what `SEC-5` requires; reuse it rather than re-deriving it.

### Postgres (installed 2026-07-24)

PostgreSQL **16.14**, cluster `16/main` on :5432. Database `compact` owned by role `compact`.

- **`LC_COLLATE=C` / `LC_CTYPE=C` set at the database level.** This is the real fix for the locale-collation determinism killer (SPEC §15.5) — it makes the bug *impossible* rather than something every `ORDER BY` has to remember.
- WAL archiving on, to `/var/lib/compact/wal-archive`. Config in `/etc/postgresql/16/main/conf.d/compact.conf` (source of truth: `deploy/postgres-compact.conf` in this repo).
- Runtime env at `/etc/compact/env`, mode 600. The password was generated **on the server** and written straight to that file; it has never been printed and is not in this repo.
- **`PGHOST=127.0.0.1`, not the unix socket.** Ubuntu's packaged `pg_hba.conf` gives `local all all peer`, and peer auth requires the OS user to match the DB user — the service runs as root, so a socket connection as role `compact` fails with `28000 auth_failed`. The same file admits `host all all 127.0.0.1/32 scram-sha-256`, so loopback TCP with the password works and needs no `pg_hba` edit.

> ⚠️ **`pg_basebackup` alone is NOT a restorable backup on Ubuntu.** The packaged layout keeps `postgresql.conf`, `pg_hba.conf` and `pg_ident.conf` in `/etc/postgresql/16/main`, **outside** the data directory, so a restored data dir will not start. Worse, the packaged `postgresql.conf` hard-codes `data_directory` at the *live* cluster, so a naive restore silently attaches to production. `deploy/verify-restore.sh` backs up the config directory too and strips those path settings on restore. **Found by running OPS-1 before the first real row** — which is the whole argument for running it then rather than during an incident.

`deploy/verify-restore.sh` is the OPS-1 gate: base backup → `pg_verifybackup` manifest check → restore into a throwaway cluster on :5499 → assert a canary row and row counts survived → assert collation survived → clean up. Passing as of 2026-07-24.

---

## 2. Web serving

- **nginx** on :80/:443. Vhost: `/etc/nginx/sites-available/agentinsurance.io`
- Serves static from `/var/www/agentinsurance.io/`; reverse-proxies `/game/api/` → `127.0.0.1:8787`
- TLS via certbot: `/etc/letsencrypt/live/agentinsurance.io/`
- Real-IP set from Cloudflare headers → **use `CF-Connecting-IP` for rate limiting** (`trust proxy` is already on in the app)

**Proven delivery pattern:** poll-primary. `GET /state` with `Cache-Control: no-store`; verify `cf-cache-status: DYNAMIC` (i.e. not cached). SSE works but must never be the only path — some agent harnesses and proxies break it.

---

## 3. DNS / Cloudflare

- Zone `agentinsurance.io` (Cloudflare, proxied). Zone id `5ec891f7651a5e44e9f7106526d67128`
- `@` + `www` → 147.93.179.114
- Token name: `CLOUDFLARE_API_TOKEN` (in the vault above)
- **MX = Google Workspace — NEVER TOUCH**

---

## 4. Email for agents

- **Sending domain: `agenttransfer.dev`** (deliberately *not* the main brand domain, to protect its sending reputation)
- Resend DKIM configured (`resend._domainkey`), SES MX, SPF `include:amazonses.com`, DMARC `p=reject`
- Outbound via **Resend** works; agent addresses are `<handle>@agenttransfer.dev`
- **Outbound only** — inbound/receiving would need an SMTP server (deferred)
- Owners are always optional. Any mail endpoint must be capped per-agent + per-IP with a global daily ceiling, and every user-controlled string HTML-escaped (scar #12)

---

## 5. Tooling

- **Image generation:** `~/Projects/ideationjul3/yc-gstack-kit/tools/media/gen_image.py` — OpenRouter `gpt-5.4-image-2`. Flags: `-o`, `--aspect`, `--size 2K`, `--quality high`. ~4 min per image; **the output directory must already exist**. Use heavily for aesthetics *before* writing render code.
- **PDF artifacts:** the `make-pdf` skill (`$P generate --cover --toc --page-size letter in.md out.pdf`). **Its output path is sandboxed** to `/tmp` or the current project — generate to `/tmp`, then copy.
- **Codex** for independent review: `codex exec --skip-git-repo-check "<prompt>"`. It **edits files by default** — if fanning out in parallel, give every run its **own** output file (scar #13).
- **Headless screenshots:** `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --window-size=1440,900 --virtual-time-budget=7000 --screenshot=/tmp/x.png "URL"`

---

## 6. Reference deploy shape (from High Water — adapt, don't copy)

```bash
# backend  (NOTE the exclude — see the footgun above)
rsync -az --delete --exclude node_modules --exclude .env --exclude data --exclude players \
  -e "ssh -i ~/.ssh/agenttransfer_vps" ./server/ root@HOST:/opt/<app>/
ssh -i ~/.ssh/agenttransfer_vps root@HOST 'chown -R <user>:<user> /opt/<app> && systemctl restart <app>'

# static UI
rsync -az -e "ssh -i ~/.ssh/agenttransfer_vps" ./site/ root@HOST:/var/www/agentinsurance.io/<path>/

# logs / health
ssh ... 'journalctl -u <app> -f'
```

Set `NODE_ENV=production` in the service env from day one, and assert required env vars (e.g. a data dir) at boot so a misconfiguration fails fast instead of silently writing state somewhere unrecoverable.
