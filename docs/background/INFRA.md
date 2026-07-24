# Infrastructure — facts, paths, and where the credentials live

*Background for THE COMPACT, 2026-07-24. **Service names and file locations only — never a secret value.** Everything here was verified while deploying High Water.*

---

## 0. Credential locations (names only — never read the values)

| What | Where it lives | Notes |
|---|---|---|
| Game service keys | `~/agentinsurance/game/.env` (gitignored, `chmod 600`) | Contains `RESEND_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` |
| Company credential vault | `~/Projects/ideationjul3/yc-gstack-kit/credentials/.env` | **Tracked in that repo** — includes `CLOUDFLARE_API_TOKEN`. Never print. |
| Live server env | `/etc/highwater/env` on the VPS | High Water's runtime env. THE COMPACT should use its **own** file. |
| VPS SSH key | `~/.ssh/agenttransfer_vps` | Root access to the deploy box |
| VPS password fallback | `~/agenttransfer/scratchpad/CREDENTIALS.md` | Emergency only |

**Rule:** reference by name, pass by file or env, never echo. Do not copy any of these into this repo.

---

## 1. The VPS (deploy target)

- **Host:** Contabo `vmi3131667` · **147.93.179.114** · Ubuntu 24.04
- **Specs:** 12 cores / 96 GB RAM / 697 GB disk — comfortable headroom for a tick server + Postgres + an LLM-player fleet
- **Access:** `ssh -i ~/.ssh/agenttransfer_vps root@147.93.179.114`
- **Installed:** Node 22, nginx, Docker 29 (idle), certbot. **Postgres is NOT installed yet** — THE COMPACT needs it (SPEC §15).
- **Also present:** Caddy (leftover, ignore)

### ⚠️ Shared box — do not clobber High Water

A working game is live on this host. When deploying THE COMPACT, use **new** names everywhere:

| Resource | High Water (do not reuse) | Use for THE COMPACT |
|---|---|---|
| Port | `8787` | a new port |
| systemd units | `highwater`, `highwater-players` | new unit names |
| Env file | `/etc/highwater/env` | new path |
| Data dir | `/var/lib/highwater/` | new path |
| Code dir | `/opt/highwater/` | new path |
| nginx path | `/game` and `/game/api/` | a new path |

**Deploy footgun (cost us a live outage):** High Water's backend deploy uses `rsync --delete` into `/opt/highwater/`, which repeatedly **deleted the sibling `players/` directory** and silently reverted the live game to bots-only. Always `--exclude` sibling dirs, and after any deploy verify the components you *didn't* deploy are still running. See `HIGH-WATER-LESSONS.md` scar #4.

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
