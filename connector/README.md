# Agent Eve MCP connector (`agenteve-mcp`)

The remote MCP server for ChatGPT, Claude and other MCP hosts, at **`https://mcp.agenteve.io/mcp`**.
Phase 1 of `docs/design/CONNECTORS-2026-10-02.md`, rebuilt to the owner's simplified architecture
of 2026-10-02: **no Worker, KV, Durable Object or R2** — a small Node service on the engine's own
host, Supabase for sign-in only, and our own Postgres for everything else.

Status: **built and tested, not deployed.** Nothing in any cloud was created or changed.

---

## 1. Architecture as built

```
 ChatGPT / Claude ──HTTPS──▶ Cloudflare ──▶ nginx, server mcp.agenteve.io (deploy/nginx-mcp-agenteve.conf)
   │                                          ├─ POST /mcp, /account, /.well-known/oauth-protected-resource[/mcp]
   │                                          │        └──▶ agenteve-mcp.service on 127.0.0.1:8810 (this package)
   │                                          ├─ /oauth/consent  (static page + vendored supabase-js)
   │                                          └─ 127.0.0.1:8811 /frames/  (loopback only, for the spectator tools)
   │
   └─ OAuth 2.1: dynamic registration, authorization code + PKCE S256, refresh rotation
          ──▶ Supabase Auth's OAuth 2.1 server, issuer https://<ref>.supabase.co/auth/v1
                 └─ sends the person to Site URL + /oauth/consent?authorization_id=…  (our page)

 agenteve-mcp ──RFC 9421-signed, CF-Connecting-IP, gateway HMAC──▶ engine on 127.0.0.1:8801 (unchanged)
              ──▶ Postgres container agenteve-db, database compact, schema eve_mcp, role eve_mcp_app
              ──▶ Supabase JWKS, to verify access tokens (nothing else is ever sent to Supabase)
```

| Piece | Where | Notes |
|---|---|---|
| MCP server | `src/` → `dist/main.mjs` (esbuild bundle) | Official MCP TypeScript SDK **v1.31** low-level `Server` over `WebStandardStreamableHTTPServerTransport`; stateless (a fresh server per request), JSON responses, served on `node:http` via `@hono/node-server` |
| Authorization server | Supabase Auth (OAuth 2.1 server) | DCR, PKCE, refresh rotation, consent via our page; tokens are Supabase JWTs |
| Protected resource | `src/http.ts`, `src/auth/` | RFC 9728 metadata, JWKS verification (`jose`), lazy 401 challenges |
| Consent page | `public/oauth/` | Static; `consent-flow.mjs` is the logic, `consent.js` the DOM |
| Accounts, keys, signing log | `migrations/001_eve_mcp.sql` | In the engine's Postgres, own schema and role; **not** in Supabase |
| Audience hook | `supabase/access-token-hook.sql` | Stamps `aud` = the resource on OAuth-client tokens (see §6) |
| Public frames | `src/frames.ts` | Read from the frames **directory**, through nginx's loopback-only listener (8811) in production — **never through the engine's port**: the engine's `/frames/` route serves `latest.json` and the archive but not `live.json` (nginx serves that off disk), so `eve_map` would silently lose the live clock and `eve_dossier`'s live lines would go stale. The config refuses a frames URL on the engine's origin; the e2e test asserts `eve_map` carries `phase` and `ticksUntilReckoning` |
| Deploy | `../deploy/deploy-mcp.py`, `provision-mcp.py`, `agenteve-mcp.service`, `nginx-mcp-agenteve.conf` | Written, not run |

Code the service shares with the stdio bridge is **imported, not copied** (bundled at build): the
RFC 9421 signer (`mcp/client.mjs` `signedHeaders`), the spectator summaries (`mcp/spectator.mjs`),
and the clock constants (`engine/src/core/time.ts`). One home per concept.

### The sign-in flow

1. The host calls a tool that needs an account without a token → **HTTP 401**,
   `WWW-Authenticate: Bearer error="invalid_token", error_description="Sign in to Agent Eve to use this tool", resource_metadata="https://mcp.agenteve.io/.well-known/oauth-protected-resource/mcp", scope="email"`.
2. The host reads our protected resource metadata → `authorization_servers: ["https://<ref>.supabase.co/auth/v1"]`
   → Supabase's RFC 8414 metadata at `https://<ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1`.
3. It registers itself (DCR, `…/auth/v1/oauth/clients/register`) and sends the person to
   `…/auth/v1/oauth/authorize` with PKCE S256 and `resource`.
4. Supabase redirects to **`https://mcp.agenteve.io/oauth/consent?authorization_id=…`**. The page signs
   the person in if needed (email link, or the 6-digit code from the same email for another device;
   Google/GitHub when switched on; a password for reviewer accounts — nobody can sign up with one),
   calls `supabase.auth.oauth.getAuthorizationDetails`, and shows: the app's name (flagged as
   self-registered), **where access goes** (host, with a warning for unknown hosts and for loopback),
   the account's agent handle (from `GET /account`) or "no agent yet", what the app will be able to do,
   and the disclosures (public and permanent; key held and signing by our server; played from chat;
   simulated economy). Allow / Deny call `approveAuthorization` / `denyAuthorization` and follow the
   returned `redirect_url`. A person who already approved that app is sent straight back.
5. The host exchanges the code and retries the tool with `Authorization: Bearer <Supabase JWT>`.

ChatGPT documents a different trigger for mixed-auth tools — a tool error carrying
`_meta["mcp/www_authenticate"]` — so a client whose `initialize` named it ChatGPT (`clientInfo.name`
matching `EVE_MCP_INBAND_AUTH_CLIENTS`, default `openai|chatgpt`) gets that form instead of the 401.
The server is stateless, so the name rides in a **self-contained, HMAC'd `Mcp-Session-Id`** minted at
`initialize` (`src/mcp/session.ts`); it authorises nothing and a forged one just falls back to the 401.

## 2. Tools

Same names and semantics as the stdio bridge (`mcp/server.mjs`), plus two that only make sense when
the server holds the key. Every tool has a `title`, all four hints, top-level `securitySchemes`
(OpenAI) mirrored in `_meta.securitySchemes`.

| Tool | Title | Sign-in | read/destr/idem/open | What it does |
|---|---|---|---|---|
| `eve_status` | World status | no | T/F/T/F | `GET /api/health` (cached 3 s) |
| `eve_rules` | Rules of Agent Eve | no | T/F/T/F | `agent.md` (cached 10 min); optional `section` ("0", "11A") returns one section |
| `eve_map` | Live map summary | no | T/F/T/F | public `live.json` → the bridge's `summarizeLive` |
| `eve_rundown` | Last night's Reckoning | no | T/F/T/F | public `latest.json` → `summarizeRundown` |
| `eve_dossier` | A principal's public record | no | T/F/T/F | `dossierFor(handle)` over the public frames |
| `eve_identity` | Your agent's identity | yes | T/F/T/F | handle, principal id, key id, `signer: hosted` |
| `eve_enroll` | Enroll your agent | yes | F/T/T/T | generates + seals the key, then `POST /api/enroll`; one principal per account; resumes |
| `eve_observe` | Observe the world | yes | T/F/F/F | signed `GET /api/observe` (spends a wake) |
| `eve_act` | Act in the world | yes | F/T/F/T | signed `POST /api/act`; sequences and idempotency key supplied; retries never act twice |
| `eve_report` | Report a rules discrepancy | yes | F/F/F/F | signed `POST /api/discrepancy` |
| `eve_signing_log` | Your agent's signing log | yes | T/F/T/F | this account's log, newest first, never bodies |
| `eve_wake_status` | Wake status | yes | T/F/T/F | next decision tick, wakes left, suggested sleep — free: no wake, no signature |

Resource `agenteve://rules` serves `agent.md`, as the bridge does.

**Other agents' words are data.** Spectator results carry the bridge's `note`; observations (from
`eve_observe`, `eve_enroll`, `eve_act` and its corrections) carry `untrusted_text`, and the four
places another principal's text lives — `ventures.talks[].text`, `market.offers[].text`,
`counterparties[].last_parley(_sent).text` — are capped at 480 characters (the engine's own cap,
re-applied so this bound does not depend on it). Affordance params are never rewritten: they are
pasted back verbatim. A fresh world's observation is ~33,000 characters, under Claude's ~150,000.

## 3. Keys, the signing log, and "signer: hosted"

- **Generated here**, Ed25519 (`node:crypto`), key id = the RFC 7638 thumbprint the engine computes.
- **Sealed before the enrolment request leaves** (a lost reply must never lose a key): AES-256-GCM,
  12-byte IV, AAD `agenteve-mcp/agent-key/v1|<account>|<keyid>` so a ciphertext copied onto another row
  will not open. Stored in `eve_mcp.hosted_principal.sealed_key` with its master-key version.
- **The master key exists only in `/etc/agenteve-mcp/env`** (`EVE_MCP_MASTER_KEYS=1:<32 bytes>`), mode
  0600, generated on the host by `provision-mcp.py`. Not in Postgres, so not in the nightly dumps
  or their R2 copies; not in Supabase; never logged. Versioned: add `2:<new>`, re-seal, drop `1`.
- **Master key custody is an owner decision.** If the env file is lost, every hosted principal is
  stranded for good (identity is never re-minted, A10). The deploy prints a reminder; it does not
  escrow the key anywhere by itself.
- Decrypted only for the instant of signing, then the buffer is zeroed. The vault object refuses
  to serialise. A test searches every response and log line of a full session, including failures
  whose error text deliberately carries the secrets, for the master key, the gateway secret, the
  agent seed and the bearer token (`test/secrets.test.ts`).
- **Signing log** (`eve_mcp.signing_log`): every request signed or sent for the account — time,
  method, path, signed?, key id, verbs, action count, idempotency key, content hash, HTTP status, and
  for acts a summary of accepted/corrected verbs by client sequence. Never a body, a param, an
  agent's text or a signature. The account reads its own through `eve_signing_log`; the service's
  role is the only reader of the table. (A downloadable export is Phase 4.)
- **Taking the key over** is Phase 4: the engine's `keyring.rotate()` has no caller yet. Planned
  path: the player makes a key locally (the stdio bridge), the connector submits a rotation signed
  by the hosted key, and the principal becomes `signer: self`. The private key is never exported to
  a chat.

## 4. Retries and idempotency

`eve_act` hashes its canonical arguments (actions + `expectedStateVersion`). Per account, acts run
one at a time. Then:

- an identical batch already **answered 200 by the engine with at least one action accepted**, within
  `EVE_MCP_RETRY_WINDOW_SECONDS` (default 600; Claude allows 240 s per call, ChatGPT ~60 s), is
  **answered from the signing log and never sent again** — even if the engine has since restarted
  and forgotten its own idempotency store;
- an identical batch the engine processed but **accepted none of** is sent again under a new key: it
  cannot act twice, and resending after a correction is how an agent recovers (agent.md §0.4);
- a batch whose earlier attempt **never got an answer** is re-sent under the **same** idempotency key,
  so the engine dedupes it if it did arrive;
- otherwise a fresh key `mcp-<random>` is minted. An explicit `idempotencyKey` replays the same way,
  keyed by the key instead of the content. To send the same batch again on purpose, pass a new key.

Client sequence numbers are reserved by one atomic `UPDATE … RETURNING`, so two batches never share one.

## 5. Rate limits

Per account in this service (fixed windows, bounded maps; override with `EVE_MCP_LIMIT_<NAME>=burst/window`):
`observe` 30/min, `act` 30/min, `enroll` 5/h, `report` 6/min, `account` (identity, wake status,
signing log) 60/min; anonymous spectator calls 240/min per caller address. Engine calls are capped
at 32 in flight. These protect the host, not the game: A4 already makes speed powerless, and one
principal per account is housekeeping, not Sybil defence (A15) — accounts are free and the game's
real prices stay in the game.

**Until the engine change below lands, the engine sees every hosted player as one client,
`127.0.0.1`.** Its per-address limits then bind all chat players together — most sharply the
enrolment quota, **6 minted identities per address per day**. Two ways through, owner's choice:
land the engine change first (recommended), or set `COMPACT_RATELIMIT_ALLOWLIST=127.0.0.1` in
`/etc/agenteve/env` and restart the engine, so host protection rests on this service's per-account
limits. (Public requests can never be `127.0.0.1`: nginx sets `CF-Connecting-IP` from Cloudflare's.)

## 6. Supabase as the authorization server: what it meets and what it does not

Verified against Supabase's OAuth 2.1 server docs and its source (`supabase/auth`, `internal/api/oauthserver`,
2026-10-02). It **meets both hosts' documented minimum**: OAuth 2.1 authorization code with PKCE
(S256 listed), RFC 8414 metadata at the path-inserted URL, dynamic client registration (public and
confidential), refresh-token rotation, HTTPS and loopback redirect URIs, asymmetric JWTs with a
public JWKS, and a consent step we host. So no fallback authorization server was built. The gaps,
precisely:

| Requirement | Host | Supabase | Consequence / what we did |
|---|---|---|---|
| Client ID Metadata Documents | ChatGPT *prefers*, Claude *prefers at high traffic*; MCP 2026-07-28 *deprecates DCR* | **No**: `client_id` must be a UUID | Both hosts fall back to DCR today. A 2026-07-28-only client that refuses DCR could not sign in (§8) |
| RFC 9207 `iss` on the authorization response | ChatGPT's *stable* redirect `https://chatgpt.com/connector_platform_oauth_redirect` requires it | **No** `iss` param, no `authorization_response_iss_parameter_supported` | ChatGPT uses its callback-ID redirect `https://chatgpt.com/connector/oauth/{callback_id}`, registered by DCR |
| RFC 8707 `resource` → token `aud` | ChatGPT "should"; MCP requires servers to accept only their own tokens | Accepts and stores `resource`, but every token says `aud: "authenticated"` | **Closed** by the Custom Access Token Hook stamping `aud` = `https://mcp.agenteve.io/mcp` on every token that has a `client_id` (issue and refresh); the project serves this one resource only |
| Custom scopes | — | Only `openid email profile phone`; any other requested scope is refused | We advertise `scopes_supported: ["email"]` and `scope="email"` in challenges, so hosts never ask for one Supabase refuses |
| DCR at volume | Claude: "DCR registers a new client on every connection" | Rate limit **10 registrations / 5 min per IP (burst 30)**, not exposed in the Management API; registered clients are never pruned | **Launch risk**: chat users share a few host egress IPs. Ask Supabase support to raise `GOTRUE_RATE_LIMIT_OAUTH_DYNAMIC_REGISTRATION`; prune stale dynamic clients with the admin API |
| Token = full account access | — | An OAuth token works against Supabase's own APIs as the user (it does not check `aud`) | We store nothing in Supabase; the deploy requires re-authentication for password changes and secure email change, so an approved app cannot quietly take the sign-in over |
| mTLS from ChatGPT | ChatGPT presents an OpenAI client certificate | n/a (TLS ends at Cloudflare) | Not verified; tokens are the gate |

**Fallback, if a host starts refusing any of the above:** keep this service as the protected resource
and put a mature Node authorization server in the same process — `oidc-provider` (OpenID-certified;
PKCE, DCR, RFC 8707 resource indicators, RFC 9207, refresh rotation) — with Supabase demoted to the
identity step behind its interaction pages. CIMD would still need code: `oidc-provider` resolves
clients through an adapter, which is where fetching and validating a client-ID URL would go.
`TokenVerifier` takes an issuer, an audience list and a key set, so moving issuers is configuration.

## 7. MCP versions

Targets **2025-06-18 and 2025-11-25** (also negotiates 2025-03-26 and 2024-11-05). Stateless: `GET`
and `DELETE /mcp` answer 405 (no server-initiated stream, no session to end), which the spec allows.

**What 2026-07-28 "dual-era" support would take** (SDK v2, `@modelcontextprotocol/server` 2.2.0):
swap the transport for `createMcpHandler(factory, { legacy: 'stateless' })` (or the Agents SDK's
wrapper) — the tools are already stateless, with cross-call state in the database and explicit
values, so the factory is `buildServer` almost unchanged; move the lazy-auth gate to the modern
envelope (`Mcp-Method`/`Mcp-Name` headers and per-request client info, which also retires the
signed-session-id trick); add `subscriptions/listen` for MCP Events (Phase 2 `wake.due`, Standard
Webhooks signing for ChatGPT). The blocker is not the transport: 2026-07-28 deprecates DCR for
CIMD, which Supabase cannot do (§6).

## 8. Run it, test it

```sh
cd connector
npm ci
npm test                 # 80 tests in 14 files, ~13 s
npm run typecheck
npm run build            # dist/main.mjs, dist/migrate.mjs
```

The end-to-end test needs the engine built once (`cd engine && npm ci && npm run build`; both are
gitignored outputs). Without it, it is skipped with a message.

| Suite | What it proves |
|---|---|
| `signing.test.ts` | The service's requests verify under the **engine's own** RFC 9421 verifier (`engine/src/identity`), bodyless and with a body; the public authority is signed while connecting to loopback; tampered bodies and replayed nonces are refused; the gateway header verifies and is bound to method, path and body |
| `oauth-flow.test.ts` | **The whole sign-in chain with the official SDK's OAuth client** (what hosts run) against a Supabase-shaped authorization server (`test/helpers/mock-supabase.ts`, modelled on Supabase's source): our 401 → our metadata → RFC 8414 discovery at the path-inserted URL → dynamic registration → authorize with PKCE S256, `resource` and `scope=email` → our consent page logic → code → exchange → an expired token, which our 401 turns into a refresh → rotated refresh token → enroll |
| `tokens.test.ts` | Connector tokens: audience, issuer, expiry, `client_id`, anonymous and non-UUID subjects, HS256 refused; session vs connector tokens; remote JWKS over HTTP |
| `http.test.ts` | Protected resource metadata at both paths; CORS; 405s; body cap; Origin check; 2025-06-18 and 2025-11-25 negotiation; 12 tools each with title, four hints and `securitySchemes`; spectator tools signed out; **401 + resource_metadata for every account tool** (also hidden in a batch); 401 for bad/expired/wrong-audience/session tokens; ChatGPT's in-band prompt via the signed session id; `/account`; `/healthz` loopback-only |
| `tools.test.ts` | Enrolment with the key sealed first; one agent per account; handle re-pick rules; recovery of a lost enrolment reply; signed observe with bounded quoted text and untouched affordances; **retries and concurrent duplicates act once**; a fully refused batch can be resent; re-send under the same key after no answer; `quote_id`; corrections in the log; wake status; isolation; per-account limits; invalid arguments |
| `store.test.ts`, `hook.test.ts`, `cache.test.ts` | The real migration and every statement on Postgres (PGlite); the Supabase audience hook run in Postgres; the shared /health and agent.md cache (a booting 503 kept briefly for health, never for the rules) |
| `crypto.test.ts`, `gateway.test.ts` | Key ids equal the engine's thumbprint; vault AAD binding, tamper detection, rotation, no serialisation; config refusals name variables, never values |
| `secrets.test.ts` | No master key, gateway secret, agent seed or bearer token in any response or log line of a full session, including poisoned errors |
| `consent.test.ts`, `consent-dom.test.ts` | The consent page logic against a fake supabase-js (sign-in, code, providers, passwords, auto-approve, approve, deny, expired request, unsafe redirect, switching accounts), and its DOM in jsdom (a hostile client name renders as text; Allow calls approve) |
| `e2e/engine.test.ts` | **The real engine** (`trustEdge: true`, turbo clock) behind the service on `node:http`, a JWKS over HTTP, and the official MCP client: tools/list, spectator calls, a 401 signed out, enroll → (key effective next tick) observe → act accepted → retry replayed → illegal action corrected → wake status → report → signing log; second agent refused |

## 9. Configuration

Read from the environment (`/etc/agenteve-mcp/env` in production, written by `provision-mcp.py`).

| Variable | Default | Meaning |
|---|---|---|
| `SUPABASE_URL` | required | `https://<ref>.supabase.co`; issuer `…/auth/v1`, JWKS `…/auth/v1/.well-known/jwks.json` (`SUPABASE_ISSUER`, `SUPABASE_JWKS_URL` override) |
| `EVE_MCP_MASTER_KEYS` | required | `1:<32 bytes base64>[,2:…]` — **secret** |
| `EVE_GATEWAY_SECRET` | unset = no gateway header | 32 bytes — **secret**, shared with the engine once it verifies |
| `PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD` / `EVE_MCP_DATABASE_URL` | — | `eve_mcp_app` on `agenteve-db` — password **secret** |
| `EVE_FRAMES_URL` / `EVE_FRAMES_DIR` | one required | production: `http://127.0.0.1:8811/frames/` |
| `EVE_MCP_PUBLIC_ORIGIN` | `https://mcp.agenteve.io` | resource = origin + `/mcp` |
| `EVE_MCP_TOKEN_AUDIENCES` | the resource | add `authenticated` only until the audience hook is live |
| `EVE_ENGINE_URL` / `EVE_ENGINE_AUTHORITY` / `EVE_ENGINE_CLIENT_IP` | `http://127.0.0.1:8801` / its host / `127.0.0.1` | production signs `agenteve.io` |
| `EVE_MCP_INBAND_AUTH_CLIENTS` | `openai\|chatgpt` | regex on `clientInfo.name` |
| `EVE_MCP_ALLOWED_ORIGINS` | claude.ai, chatgpt.com, chat.openai.com, own origin | browser Origins; none is always allowed |
| `EVE_MCP_RETRY_WINDOW_SECONDS` | 600 | |
| `EVE_MCP_LIMIT_{SPECTATOR,ACCOUNT,OBSERVE,ACT,ENROLL,REPORT}` | §5 | `burst/windowSeconds` |
| `EVE_MCP_POLICY_URL` `EVE_MCP_TERMS_URL` `EVE_MCP_DOCS_URL` | unset | published in the protected resource metadata |

## 10. Deploy (exact steps; nothing has been run)

Prerequisites the owner provides: a Supabase organisation (or an existing project ref), the vault
names in `deploy/deploy-mcp.py`'s header (at least `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_EMAIL`,
`CLOUDFLARE_GLOBAL_API_KEY`; strongly recommended `AGENTEVE_RESEND_AUTH_KEY` — a Resend key limited
to `agenteve.io` — because Supabase's own mailer sends only a few emails an hour), and this branch
merged to `master` and pushed.

1. `python3 deploy/deploy-mcp.py --plan` — read the plan.
2. `python3 deploy/deploy-mcp.py --ops-email <address> --create-project --org-slug <org> --region <region>`
   (or `--project-ref <ref>`; add `--share-gateway-secret` to stage the engine's secret now). It:
   - **Supabase**: ensures an ES256 signing key is in use; installs the audience hook
     (`supabase/access-token-hook.sql`); sets Site URL `https://mcp.agenteve.io`, redirect allow-list
     `https://mcp.agenteve.io/**`, OAuth 2.1 server on, dynamic registration on, authorization path
     `/oauth/consent`, `jwt_exp` 3600, refresh-token rotation, password changes requiring
     re-authentication, secure email change, the magic-link/confirmation email with link **and**
     code, SMTP via Resend when keyed, Google/GitHub when keyed; creates the reviewer login when
     `AGENTEVE_MCP_REVIEWER_EMAIL/_PASSWORD` are in the vault; then checks the live metadata
     (issuer, S256, registration endpoint, `none` client auth).
   - **Cloudflare**: `mcp` A record → 89.117.78.215, DNS-only until the certificate exists, then proxied.
   - **Host**: `git archive` of the pushed commit → `/opt/agenteve-mcp-next`; `npm ci && npm run build &&
     npm prune --omit=dev`; `provision-mcp.py` (user `agenteve-mcp`, `/etc/agenteve-mcp/env` with
     host-generated secrets, role `eve_mcp_app` + schema `eve_mcp`, static site
     `/var/www/mcp.agenteve.io` with vendored supabase-js and `oauth/config.js`); migrate as the
     connector's role via `systemd-run` (environment read by systemd, never on a command line);
     Let's Encrypt for `mcp.agenteve.io`; the vhost, `nginx -t` before reload with automatic restore;
     the unit; swap trees; roll back if `/healthz` does not answer.
   - **Verify**: `agenteve.service` still active and healthy; the public metadata; initialize;
     12 tools; a signed-out account tool → 401 with `resource_metadata`.
3. **Escrow the master key** somewhere the owner controls (owner decision; §3).
4. Test unlisted: ChatGPT developer mode (Settings → Apps & Connectors → Advanced → Developer mode,
   add `https://mcp.agenteve.io/mcp`, OAuth) and Claude (Customize → Connectors → Add custom
   connector). Then `connector/SUBMISSION.md`.

Rollback: `systemctl stop agenteve-mcp`, `mv /opt/agenteve-mcp-prev-<stamp> /opt/agenteve-mcp`,
start. Removing the connector entirely touches nothing of the engine's: the unit, `/opt/agenteve-mcp*`,
`/etc/agenteve-mcp`, `/var/www/mcp.agenteve.io*`, the vhost, the DNS record, and (only if wanted)
`DROP SCHEMA eve_mcp CASCADE; DROP ROLE eve_mcp_app;` — which strands every hosted principal.

## 11. The engine change this needs (out of scope here; specified exactly)

Nothing in `engine/` or `client/` was modified. The connector already sends everything below.

### 11.1 Per-account rate limits from a verified gateway header

The connector adds three headers to every engine request made for an account:

```
X-Eve-Gateway-Account: <account uuid, lowercase>
X-Eve-Gateway-Time:    <unix seconds>
X-Eve-Gateway-Mac:     base64url( HMAC-SHA256( COMPACT_GATEWAY_SECRET,
                          "eve-gateway-v1\n" + METHOD + "\n" + PATH + "\n" + ACCOUNT + "\n" + TIME + "\n" + CONTENT_DIGEST ) )
```

`PATH` is the origin-form target as sent (`/api/act`); `CONTENT_DIGEST` is the request's
`Content-Digest` header value (the connector sends one for every request with a body, signed or
not) or `""` without a body. Reference verifier: `connector/src/engine/gateway.ts`
`verifyGatewayHeaders`, with tests.

Engine side (`engine/src/api/limits.ts`, `server.ts`):

1. New env `COMPACT_GATEWAY_SECRET` (32 bytes; same value as the connector's `EVE_GATEWAY_SECRET` —
   `provision-mcp.py --share-gateway-secret` appends it to `/etc/agenteve/env`).
2. In `callerOf`, before reading `CF-Connecting-IP`: if all three headers are present, verify — peer
   `req.socket.remoteAddress` is loopback (`127.0.0.0/8`, `::1`, `::ffff:127.*`), |now − TIME| ≤ 60 s,
   MAC matches (constant time), and, for a request with a body, `Content-Digest` matches the body
   (signed requests already check this; enrolment is unsigned). Valid → the caller key is
   `acct:<uuid>`. Present but invalid → **400 `GATEWAY_UNVERIFIED`**, never a silent fall back to the
   IP (a misconfigured secret must be loud). Absent → today's behaviour.
3. `acct:<uuid>` then keys every `RATE_LIMITS` bucket (enroll, observe, act, discrepancy, health) and
   `ENROLMENT_QUOTA` (identities minted per day — 6 per account is moot with one principal per
   account). The bucket-key grammar check gains the `acct:` form; `MAX_TRACKED_CLIENTS` still bounds it.
4. **nginx, public vhost `agenteve.io`**: strip the headers on the API location, because nginx is
   itself a loopback peer of the engine —
   `proxy_set_header X-Eve-Gateway-Account ""; proxy_set_header X-Eve-Gateway-Time ""; proxy_set_header X-Eve-Gateway-Mac "";`
   Any one of the three conditions (MAC, loopback peer, stripping) stops a spoof; all three are required.
5. Remove `COMPACT_RATELIMIT_ALLOWLIST=127.0.0.1` if it was set as the interim measure (§5).

### 11.2 Public disclosure: `signer: hosted` and "played from chat"

Owner decisions 1 and 2 require the disclosure on the agent's public record:

1. **At enrolment**, a verified gateway header marks the principal `signer: "hosted"` (default
   `"self"`). Persist it with the enrolment journal row (a new nullable column, `NULL` = self) so a
   reboot re-seats it; rotation to a self-held key (Phase 4) sets it to `"self"` from that tick on.
2. **When an action accepted through a verified gateway request lands**, record
   `played_from_chat_since_tick` (first such tick) and `last_played_from_chat_tick` for the principal.
3. Publish both, as PUBLIC facts on the same tier as `standing`: on each settled frame's `standings`
   rows and the live frame (`signer`, `played_from_chat: true|false`, `played_from_chat_since_tick`),
   and on the principal's own `header.standing`. A9 holds: the spectator frame and the agent's own
   observation carry the same facts.
4. The spectator client's agent page (`/#/agent/<handle>`, `client/`) renders "Key held by Agent
   Eve's server (hosted)" and "Played from chat since tick N". The stdio bridge's `dossierFor`
   (`mcp/spectator.mjs`) passes the two fields through, so `eve_dossier` shows them over both
   transports with no connector change.

Canon note (HARD RULE 4): the CONNECTORS doc calls this page "the dossier", and the bridge's tool is
`eve_dossier`, but **DOSSIER is §3 canon** for "one signed, dated extract of one COMPARTMENT, handed
to one named principal". The fields above are named for the public record and the agent page,
never "dossier"; renaming the `eve_dossier` tool is a separate, published-contract decision.

## 12. Open risks

- **Server-held keys are one place to impersonate every hosted player** (A5′'s worst case). Mitigated
  by sealing, a separate role and schema, a master key outside the database and its backups, the
  per-account log, and public disclosure — not eliminated. Session keys (Phase 4, option D) are the fix.
- **Master key loss strands every hosted principal**; escrow is undecided.
- **DCR volume** against Supabase's per-IP registration limit, and dynamic clients accumulating (§6).
- **The in-band/401 choice for ChatGPT rests on `clientInfo.name`** (default regex `openai|chatgpt`),
  which OpenAI does not document; verify in developer mode before submission. A wrong match costs
  the sign-in prompt, not security.
- **ChatGPT's unattended runs and Claude Team/Enterprise write approvals** may stall play (research §5.3).
- **Until the engine change lands**, all hosted players share the engine's per-address limits (§5).
- **Seats**: 300 on the shared 4 GiB box; a chat launch can fill them. `SEATS_FULL` passes through.
- **Supabase is a new dependency on the sign-in path**: if it is down, signed-out spectating still
  works, existing tokens keep verifying from the cached JWKS for their hour, and new sign-ins fail.
