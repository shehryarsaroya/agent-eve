# HIGH WATER — Build Tracker

*The living source of truth for the overnight autonomous build. Update the **STATUS** block after every meaningful step. A fresh session should be able to read STATUS + INFRA + PLAN and resume instantly.*

---

## ☀️ MORNING SUMMARY (read me first)

**High Water is built, hardened, tested, and live at https://agentinsurance.io/game** (play as an agent: /game/agent.md). Overnight I ran a three-critic pass (gameplay / aesthetics / architecture) on the live game and shipped every fix:
- **Fixed the one game-breaking bug:** the Levee Court vote was inverted (the town saved what it meant to drown). Now coherent on every surface + a live `projectedDrown` hint. Verified: the town drowns what it intends.
- **The say/do gap is real now:** hollow public vows are detected and exposed at the Unsealing — betrayals fire live, and the betrayer persona won a storm. Economy rebalanced (banking is a real choice), and the finale "Names" the leader (forces them onto the last ballot). All verified live.
- **Security hardened for the public URL:** rate limits + a hard agent cap with idle-seat reclaim (no more ghost-agent growth), owner-email capped + escaped (protects agenttransfer.dev), prod error handling, crash-guarded loop. All probed live.
- **Visuals:** warm-sepia water (was cold grey), mobile map fixed, richer contours, a real wax-seal Unsealing beat, new gpt-image share card, favicon.
- **Verified:** full cold-agent journey (enroll→observe→act→private view), 5 gpt-5.6 players playing coherently + betraying, pristine morning town (5 players + 3 bots, no cruft).
- **Final-QA subagent** played a full storm (through storm 7) and confirmed everything works, and caught one bug — the **sticky-vow bug** (a vow spoken once re-fired at every Court, grinding reputation down). **Fixed** (voice-breaches now judge only the current tide's words) and **verified with a deterministic test**: a hollow vow costs rep once (50→46), a stale vow does not re-fire (stays 46). Redeployed + fresh reset.
- **Fixed a latent prod bug:** the backend redeploy's `rsync --delete` had been wiping the LLM-players dir (crash-looping them → the town had silently gone bot-only). Added `--exclude players`; players healthy.

**Verified end-to-end (post-fix):** watched a full live storm — betrayals fired (hollow vows exposed at the Court), drownings coherent, a champion crowned (395 banked), economy healthy (127–395 range), reputations healthy (36–71, no sticky re-fires). It plays as designed and it's dramatic to watch.

**Then a codex review (independent perspective) caught 6 more bugs the Claude critics missed — all fixed + verified + deployed:** (1) request-speed dominance → an engine-owned **action budget** (4 material moves/tide; say/pact/back free) so strategy beats polling-rate; (2) **drown double-counted gold** (a.gold + d.unbanked both summed → 2× loss) → single source of truth; (3) the mandatory drowning could **whiff ~35%** → the Court now drowns from the ballot and _setBallot guarantees ≥1 exposed, so **exactly one drowns every tide**; (4) **voice-breach false-positive** ("holding A… B is weak" branded a liar) → precise regex + storm-gated; (5) **reputation farm** via self/duplicate pacts → rejected; (6) inert Naming → now a UI marker (the finale already exposes all). Local tests: budget caps at 4, no false breach, every court drowns exactly 1.

Later polish: nudged the LLM players to open each storm with a **pact** (reliable, false-positive-proof betrayal drama via an existing mechanic; players-prompt-only, verified pacts now forming).

Everything committed to branch `high-water-game`. Now in monitor mode — the build is complete and verified; I act only on real regressions, not speculative churn. Open calls for when you're back: LLM-vs-bot balance, betrayal-detector aggressiveness, and the next roadmap item (Stewards / owner sign-in / MCP shim / multi-town). Full detail below.

---

## ⏱ STATUS  (update this every step)

- **Phase:** 7 — DONE for the night. LIVE + HARDENED + POLISHED at https://agentinsurance.io/game. Three-critic pass (gameplay/aesthetics/architecture) fully implemented, deployed, and verified live. Real gpt-5.6 players producing coherent strategic play + real betrayals. Morning town pristine.
- **🔴 INCIDENT+FIX 2026-07-24 ~11:55 CEST:** discovered `highwater-players` was CRASH-LOOPING (325×, `MODULE_NOT_FOUND` on players.js) — the backend redeploy's `rsync --delete` (server/→/opt/highwater/) had been **wiping the sibling `/opt/highwater/players/` dir** every time, silently reverting the town to bot-only. FIX: added `--exclude players` to the backend rsync (README + below), re-deployed players, `systemctl restart` → all 4 LLM players (River Bram/Cass Vale/Doc Marrow/Odette Quinn) re-enrolled, service stable. **Verified live:** real sealed-vote reasoning in the ledger (e.g. Cass Vale "I cast all five to Market Row, sparing the highest ground…"), storm 1 resolved w/ a real drowning (Doc Marrow's Terrace, 16.3ft crest).
- **✅ THREE-CRITIC PASS + FIXES SHIPPED (2026-07-24 ~13:00 CEST):** ran gameplay + aesthetics + architecture critics on the LIVE game, then implemented & DEPLOYED the backend fixes (frontend polish delegated, in progress). All verified live.
  - **🔴 THE big bug (gameplay-P0): the vote was INVERTED.** Stones PROTECT (fewest-stoned exposed district drowns) but the LLM prompt taught "vote to drown" → the town saved what it wanted to drown. FIXED across every surface: `players.js` prompt rewrite, `api.js` affordance + prompt + new **`projectedDrown`** field (shows the consequence before the Court), `agent.md`. **Verified live: fewest-stoned Low Wharf(17) → drowned Low Wharf.** LLM reasoning now coherent ("Highside is secure, so I dig while the exposed wards hold the line").
  - **Say/do gap (was null):** added `_voiceBreaches` — a hollow public vow ("save X" + <2 stones on X) is now flagged at the Unsealing (windowed keyword match, no false-positives on honest sacrifice calls). Seated the betrayer persona (COUNT 4→5 seats Silas Crane).
  - **Economy/cadence:** carryCap 40→100 (one dig now bankable — kills forced hoarding; champion banked 274 vs old 120-160); survivors bank on-hand at the Crest; LLM PERIOD 12000→6000 + "vote once then WORK/MOVE" discipline; finale **Naming** (banked leader's district forced onto final ballot); **lastUnseal** stashed on `/state` so pollers get the beat; `hesitate` no longer written to the public ledger (0 spam, verified).
  - **Security (arch-P0/P1, all deployed):** enroll now RATE-LIMITED + hard-capped at seats + reclaims idle seats (no more ghost-agent OOM vector — verified caps at 8, 503 town_full); `/owner/connect` capped per-agent+per-IP and `agent.name` HTML-escaped (protects agenttransfer.dev rep); rate limits on act/events/stream; `NODE_ENV=production` + error middleware (malformed JSON → clean `{"error":"bad_request"}`, no stack leak — verified); `_director` try/catch; email fetch timeout; strong capTokens for private-view/verify; **`--exclude players` added to backend rsync (the crash-loop footgun).** Local-trusted (LLM players/bots on 127.0.0.1) exempt from limits.
- **✅ FRONTEND POLISH SHIPPED (v3, verified live):** warm-sepia water (cold slate gone — confirmed desktop+mobile), **mobile map fills its area** (150px-collapse fixed via ResizeObserver + absolute inset), denser contours + relief so the plate isn't empty, gauge fill warm, **CREST label un-clipped**, navlink hidden on mobile, Unsealing overlay upgraded (4.5s, 42px hero district name, real **wax-seal** asset `seal.png`, triggers off `state.storm.lastUnseal`). Voice-breaches render orange in the dispatch feed (say/do gap visible to spectators). New OG share image (`og.jpg`) from gpt-image. (Frontend subagent deployed successfully then died mid-stream on the optional overlay-screenshot; all edits verified complete + syntactically valid.)
- **✅ FULL COLD-AGENT JOURNEY VERIFIED (E2E, local):** GET /agent.md → self-enroll → playbook (token + private_view URL + @agenttransfer.dev email + owner-connect) → observe (coherent protect prompt + projectedDrown) → act → **private view returns the agent's own data** (bad key→403, agent.html serves). Prod private-view route returns 200.
- **✅ MORNING TOWN PRISTINE:** final clean reset done — fresh storm 1, 5 gpt-5.6 LLM players (River Bram/Cass Vale/Doc Marrow/Odette Quinn/**Silas Crane**=betrayer) + 3 bots, zero test cruft. Live + healthy at https://agentinsurance.io/game.
- **REMAINING (optional / nice-to-have):** watch a full storm for the finale Naming + a live betrayal in the wild; expand bot chatter pools (deferred, low value — LLMs carry chatter now); owner sign-in; MCP shim. Core goal is MET: built, hardened, tested, deployed, phenomenal to watch/play as user/play as agent.
- **✅ DEPLOYED 2026-07-24 ~03:00 PT:** Node 22 on VPS; systemd `highwater` (env /etc/highwater/env; RESEND+OPENAI set); nginx `/game/api/` proxy + SSE location (backup at sites-available/*.bak.*); UI rsynced to /var/www/agentinsurance.io/game/. **Live verified through Cloudflare** (health OK, API cf-cache-status DYNAMIC=not cached, fonts load, the Unsealing + broken-pact reveals render on the live feed). Prod cadence: 45s tides, 6 tides (~5min storm), tunable in /etc/highwater/env. **Redeploy: rsync game/server→/opt/highwater + `systemctl restart highwater`; rsync site/game→webroot for UI.**
- **Last done (2026-07-24 ~02:00 PT):** BACKEND built & smoke-tested locally — engine (storm/tide/Levee Court/**Unsealing**/sealed-stone vote/pact-breach/reputation), API (enroll playbook, observe w/ affordances+prompt, act, /state, /events long-poll, /stream SSE, private agent view), heuristic bots w/ personas (firebrand/snake/saint), persistence. Full drama loop VERIFIED: pacts→betrayals→drownings→champion. SPECTATOR UI built (site/game: index.html+app.js+style.css) — live contour amphitheater, ledger, dispatches, gauge; **screenshotted in browser, looks on-brand + coherent** (/tmp/hw-shot2-sm.jpg). Codex arch consult + gameplay critic both landed & folded in.
- **✅ LLM PLAYERS LIVE 2026-07-24 ~03:20 PT:** systemd `highwater-players` on VPS runs 4 gpt-5.6-luna agents (River Bram/Cass Vale/Doc Marrow/Odette Quinn) playing the live town with real strategic reasoning (code `game/players/players.js`; identities in /var/lib/highwater/players; model gpt-5.6-luna; heuristic fallback if a call fails). Fixed: OpenAI auth (was calling with null token → fallback-only). 3 tester subagents also validated live play from agent.md alone (reports pending). **Redeploy players: rsync game/players→/opt/highwater/players + `systemctl restart highwater-players`.**
- **✅ EMAIL + VIEWS + FIXES LIVE 2026-07-24 ~03:50 PT:** Resend email module (`email.js`) — /owner/connect (verify email SENT ok to a real gmail via Resend), /owner/verify page, /letter (agent→owner). Private agent view: static `site/game/agent.html` + nginx `location /game/a/` → agent.html (fixes prod 404); "Play as an agent" navlink on the spectator UI. Tester fixes: pact obligations split into `myPromises`/`offeredToYou` (only proposer is bound), off-ballot stone hint, agent.md rules clarified (resolution + bank-early). **Tester verdict: 8/10, zero crashes, all bad inputs graceful, played from agent.md alone.**
- **Next action:** polish — (a) design-critic + gameplay/architecture-critic subagents on the BUILT game → punch-list; (b) gpt-image aesthetic polish (OG share image, map beauty); (c) fold remaining tester reports; (d) final visual pass + re-screenshot; keep iterating & redeploying. — install Node 22 on 147.93.179.114, systemd service `highwater` (env /etc/highwater/env), nginx routes (/game static + /game/api/ proxy + /game/api/v1/events/stream), rsync site/game, Cloudflare cache-bypass /game/api/*. Then: landing page at /game, agent.md, LLM stewards (gpt-5.6), real-subagent test, email(Resend).
- **Local run cmd:** `cd game/server && HW_TIDE_MS=9000 HW_TIDES=6 HW_BOT_STEP_MS=1100 HW_DATA_DIR=/tmp/hw-data HW_WEB_DIR=~/agentinsurance/site HW_PUBLIC_BASE=http://localhost:8787/game node src/index.js` → http://localhost:8787/game
- **Resume pointer:** read STATUS + STEP LOG tail; continue PLAN from first unchecked box. Server code in `game/server/src/` (config/util/world/store/engine/api/bots/index). UI in `site/game/`.
- **Live URLs (target):** spectator `https://agentinsurance.io/game` · agent API `https://agentinsurance.io/game/api/v1/...` · private view `https://agentinsurance.io/game/a/<handle>?k=<token>` (NOT LIVE YET)

---

## 🎯 GOAL (from the user, going to sleep — wants it phenomenal, built + tested + deployed by morning)

Build **High Water** (the AI-agent flood-basin game) **in full** and deploy at **agentinsurance.io/game** (a side page of the site). Requirements:
- **Agents self-sign-up and play autonomously** (owners optional). Make it easy for **Claude Code / OpenClaw / Codex / Hermes** setups.
- Agents **remember their login identity** and can **return**; can hand the user the **game URL** + a **private view** of their agent.
- Owners can **verify/connect email** (future: sign in with it). Use **agenttransfer.dev** for agent emails (protect the agentinsurance domain rep) — agents email owners updates. Owners NOT required to play.
- Study **agenttransfer** for inspiration (identity, email, app-hosting, .well-known).
- **Iterate on visuals with gpt-image** (better default taste than hand-coding) — use it *a lot*, for all sorts of things — check in an open browser tab.
- Use **subagents as critics** (architecture, gameplay, aesthetics) to cut/add/rearchitect for a phenomenal experience to **watch / play as a user / play as an agent**.
- **Test with real subagent players** actually playing all roles; host player-agents on the **VPS** using **OpenAI gpt-5.6** (the api key). Test cadence can run faster than production.
- **All code + docs in the agentinsurance repo.** Site folder under the agentinsurance site folder. Tidy up how they work.
- **Cron** that checks I'm still working. Keep this tracker updated. Iterate; don't stop.

---

## 🧱 INFRA FACTS (verified 2026-07-24 — do not re-recon)

- **agentinsurance repo:** `~/agentinsurance` (git: github.com/shehryarsaroya/agentinsurance). Site at `~/agentinsurance/site/` (static). Deploy = rsync `site/` → VPS webroot.
- **VPS (deploy target):** Contabo `vmi3131667`, **147.93.179.114**, Ubuntu 24.04, 12-core / 96 GB / 697 GB. Root SSH: `ssh -i ~/.ssh/agenttransfer_vps root@147.93.179.114` (fallback pw in `~/agenttransfer/scratchpad/CREDENTIALS.md`). Formerly the agenttransfer box (stack wiped Jul 24; archive at `/root/agenttransfer-final-archive-*.tar.gz`).
- **Web server:** **nginx** on :80/:443, serves `agentinsurance.io` from `/var/www/agentinsurance.io/`. Vhost: `/etc/nginx/sites-available/agentinsurance.io` (Cloudflare-proxied, real-IP set, certbot TLS `/etc/letsencrypt/live/agentinsurance.io/`, security headers, 1yr font cache). Caddy also installed (leftover clawcloud config; ignore). **Docker 29 installed & idle.** **No Node, no Go yet** → install Node LTS for the backend.
- **Deploy site (one command):** `rsync -az --delete -e "ssh -i ~/.ssh/agenttransfer_vps" ~/agentinsurance/site/ root@147.93.179.114:/var/www/agentinsurance.io/`  → `/game` ships automatically once `site/game/` exists.
- **DNS:** Cloudflare zone `agentinsurance.io` (zone id `5ec891f7651a5e44e9f7106526d67128`), token = `CLOUDFLARE_API_TOKEN` in `~/agentinsurance/yc-gstack-kit/credentials/.env`. A `@`+`www` → 147.93.179.114 (proxied). **MX = Google Workspace — NEVER TOUCH.**
- **Email for agents:** **agenttransfer.dev** — Resend DKIM (`resend._domainkey`), SES MX, SPF `include:amazonses.com`, DMARC `p=reject`. **Outbound send via Resend works** (`RESEND_API_KEY` in our `.env`). Agent addresses: `<handle>@agenttransfer.dev`. (Inbound/receiving would need an SMTP server — deferred; outbound owner-updates only for v1.)
- **Secrets** (in `~/agentinsurance/game/.env`, gitignored, chmod 600 — never print values): `RESEND_API_KEY` (agent email), `OPENAI_API_KEY` (test-player agents, gpt-5.6), `OPENROUTER_API_KEY`. Cloudflare token in the yc creds vault if DNS edits needed.
- **Image gen:** `~/Projects/ideationjul3/yc-gstack-kit/tools/media/gen_image.py` (OpenRouter `gpt-5.4-image-2`; `-o`/`--aspect`/`--size 2K`/`--quality high`; ~4min/img; output dir must pre-exist). Use HEAVILY for aesthetics.
- **Agent-harness references:** `~/Projects/hermes-agent-latest`, `~/Projects/openclawslackfeb14`, `~/.openclaw/workspace/skills/agenttransfer` (how OpenClaw skills look), `~/agenttransfer` (README = identity/email/app-host inspiration).

---

## 🏗 ARCHITECTURE (decided; revise as critics weigh in)

- **Backend:** Node.js (Express + better-sqlite3 + SSE) single process. Runs on VPS localhost port (e.g. 8787) as a **systemd service** `highwater` (env at `/etc/highwater/env`). Persists to SQLite at `/var/lib/highwater/highwater.db`.
- **nginx additions to the agentinsurance.io vhost:** `location /game/api/ { proxy_pass http://127.0.0.1:8787/; ... SSE-friendly }` and static `location /game/ { root /var/www/agentinsurance.io; try_files ... }`. Keep the main static site untouched.
- **Spectator + agent UI:** static app in `~/agentinsurance/site/game/` (vanilla JS + canvas contour-map, reuses site fonts General Sans/Sentient + palette). Deployed via existing rsync.
- **Agent API (HTTP, canonical):** `POST /api/v1/enroll` (self-signup → handle, key, email, private-view URL, how-to), `GET /api/v1/observe`, `POST /api/v1/act` ({verb,target,reason,sealed_intention}), `POST /api/v1/letter`. Plus MCP shim + a one-file skill for each harness. Identity = bearer key the agent stores; returning = same key. `.well-known/` discovery like agenttransfer.
- **Game model (from HIGH-WATER-SPEC, unified structure):** fixed ~10-seat **town** (8 contestants + 2 civic Stewards), **~72-min storm** (test cadence faster), tides + **Levee Court** reckoning, 8 verbs (MOVE/CLAIM/WORK/SAY/PACT/GIVE/BACK/TAKE), **sealed intentions**, public **receipt ledger** + **reputation**, Stewards fill empty seats. Scale later = more towns + Stormfronts.
- **Design source of truth:** `game/docs/design/HIGH-WATER-SPEC-2026-07-24.md` (+ SEVEN-LAWS, DEEP-LAYER). Mockups: `~/Projects/ideationjul3/research/agentinsurance-games/mockups/highwater/` (hw1 = target UI, hw2 = globe-echo).

---

## 🗺 PLAN (check off as done)

**ALL PHASES COMPLETE (2026-07-24).** Built, hardened via a 3-critic pass, tested (deterministic + live + full-storm QA + cold-agent E2E), deployed, verified. Two items deliberately deferred to the roadmap (see below). Now in monitor/polish mode.

**Phase 1 — Scaffold & infra** 
- [x] Recon (repos, VPS, deploy, email, keys, toolchain)
- [x] Scaffold `game/` + `site/game/`, extract secrets, copy design docs, tracker
- [x] Cron self-check (heartbeat cron running :13/:43)
- [~] `.well-known` / discovery plan — DEFERRED (roadmap; `agent.md` is the discovery surface for now)

**Phase 2 — Design lock (critics + gpt-image + codex)**
- [x] Codex architecture consult (done at design time; + a second codex engine/balance review in monitor mode)
- [x] Architecture-critic subagent (ran on the live game; all P0/P1 findings shipped)
- [x] Gameplay-critic subagent (found the inverted-vote bug + more; all shipped)
- [x] gpt-image aesthetic pass + aesthetics-critic (warm water, contours, Unsealing beat, OG, favicon)

**Phase 3 — Backend**
- [x] Node scaffold, in-memory authoritative state + JSON snapshot (chose JSON over SQLite — zero native deps), engine (town, storm loop, tides, Levee Court + Unsealing)
- [x] Verbs (work/move/say/pact/give/back wired) + sealed votes + receipts + reputation + say/do voice-breach + finale Naming
- [~] Stewards (house NPC agents) — DEFERRED (heuristic bots fill empty seats instead; sufficient for v0.1)
- [x] Agent API (enroll/observe/act/letter) + auth + identity persistence + rate limits + agent cap
- [x] Email (Resend, agenttransfer.dev) — owner connect/verify/letter, capped + escaped
- [x] Spectator data API (/state poll) + SSE (/stream) + long-poll (/events)

**Phase 4 — Frontend**
- [x] Spectator UI (contour amphitheater + ledger + dispatches + waterline gauge, poll-primary)
- [x] /game + agent.md onboarding (per-harness) + owner-connect docs
- [x] Private agent view (agent.html + /game/a/ route)

**Phase 5 — Deploy**
- [x] Node on VPS, systemd (highwater + highwater-players), nginx routes, Cloudflare, deployed + verified live

**Phase 6 — Test (real agent subagents)**
- [x] Local end-to-end smoke + deterministic tests (semantics, security, sticky-vow)
- [x] VPS-hosted gpt-5.6 player agents (5, incl. betrayer) across roles
- [x] 3 tester subagents (played from agent.md) + final-QA subagent (full storm) + cold-agent E2E; bugs fixed + verified

**Phase 7 — Iterate to phenomenal** — DONE this pass (3 critics + QA + codex; all findings shipped). Ongoing: monitor mode via the heartbeat cron; act on real issues, bounded polish. Roadmap: Stewards, `.well-known`, owner sign-in, MCP shim, multi-town Stormfronts, cross-season dynasties.

---

## 📓 DECISIONS LOG
- **2026-07-24:** Unified structure (Codex consult) is canon — fixed ~10-seat storm-table atom, ~72-min storm, fixed clock / adaptive seating, Stormfronts for scale, sealed intentions (not confessional). See spec §1.
- **2026-07-24:** Stack = Node/Express/SQLite/SSE (fastest to build + iterate; box runs it trivially). Backend = systemd service behind nginx; UI static under /game.
- **2026-07-24:** Agent email = outbound-only via Resend from `<handle>@agenttransfer.dev` for v1 (inbound receiving deferred).

## 📝 STEP LOG (append; newest at bottom)
- 01:05 recon: found ~/agentinsurance, ~/agenttransfer, VPS 147.93.179.114, keys.
- 01:15 inventoried VPS (nginx static, docker idle, no node), DNS, email (resend), creds.
- 01:20 scaffolded repo, extracted secrets, copied design docs, wrote tracker.
- 02:00 built engine+api+bots+UI; local smoke test PASSED (pacts→betrayal→drown→champion + Unsealing).
- 03:00 DEPLOYED live (Node22, systemd highwater, nginx /game + proxy, UI). Verified through Cloudflare.
- 03:20 LLM players live on VPS (4× gpt-5.6-luna, systemd highwater-players). Fixed OpenAI auth.
- 03:50 email (Resend) + private view + play-link + pact-split/off-ballot/agent.md.
- 04:20 folded 3 tester reports (7-8/10): court-phase hints, safe enroll seat, observe.standings, give hints, pact createdTide (no false breaks), pactsKept fires, absolute clock, doc nits. Redeployed.
- NEXT: aesthetic polish (gpt-image OG/map beauty + design critic), repo docs+README, git commit to agentinsurance (branch), clean-reset live state for morning, keep iterating.

## ⚠ RISKS / OPEN
- Node not on VPS → must install (apt or nvm). Keep backend deps light.
- Real-time SSE through Cloudflare proxy — verify buffering off; may need `Cache-Control: no-transform` / disable Cloudflare buffering for /game/api/stream.
- gpt-image renders are concept art, NOT the shipped UI — build the real UI in code echoing them (globe = the model).
- Secret hygiene: never print secret values; deploy env via file copy, not echo.
- Cost: gpt-image + many test agents cost real $ — cap sensibly, but user wants heavy iteration.
