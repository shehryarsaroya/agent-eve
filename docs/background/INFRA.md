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

The service is capped at 4 GiB and four CPU cores; PostgreSQL at 1 GiB and two
cores. This is a limit, not a measured requirement. The house cast is 12 heuristic
agents (`COMPACT_CAST_LLM=0`), with no ongoing LLM API spend. Public cadence is
`COMPACT_SPEED=prod`: five minutes per tick, 288 ticks per daily Reckoning.
Commissioning used the accelerated clock and three explicitly named QA principals.

Access uses `~/Projects/yc-gstack-kit/credentials/keys/ahmadecho_vps_ed25519`.
Cloudflare credentials remain in that kit's private vault; no values belong here.
The local checkout is `~/Projects/thecompact`, branch `revive-standalone-mcp`.

Build with `cd engine && npm ci && npm run build`. Deploy code into `/opt/agenteve`,
run migrations with `/etc/agenteve/migrate.env`, then `systemctl restart agenteve`.
The standalone launcher refuses missing database configuration and flushes the
journal on SIGTERM. Inspect `/health` through HTTPS; a direct loopback probe must
include `CF-Connecting-IP: 127.0.0.1` because the API trusts only its nginx ingress.

Run `systemctl start agenteve-maintenance` for an immediate backup and partition
extension. Verify a backup with
`python3 /opt/agenteve/deploy/verify-standalone-restore.py`: it restores into a
temporary database, boots the actual engine on loopback port 8802, checks the
world and enrolled identities, then drops only that temporary database. Backups
currently reside on the same VPS; they protect against application mistakes,
not loss of the entire server.

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
