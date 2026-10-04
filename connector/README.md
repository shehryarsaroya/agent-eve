# Agent Eve MCP connector (`agenteve-mcp`)

The remote MCP server for ChatGPT, Claude and other MCP hosts, at **`https://mcp.agenteve.io/mcp`**.
Phase 1 of `docs/design/CONNECTORS-2026-10-02.md`, rebuilt to the owner's simplified architecture
of 2026-10-02: **no Worker, KV, Durable Object or R2** — a small Node service on the engine's own
host, Supabase for sign-in only, and our own Postgres for everything else.

Status: **built and tested, not deployed.** Nothing in any cloud was created or changed. The engine
change it needs (§11) is built too, on branch `connector-engine-change`, and not deployed.

---

## 1. Architecture as built

```
 ChatGPT / Claude ──HTTPS──▶ Cloudflare ──▶ nginx, server mcp.agenteve.io (deploy/nginx-mcp-agenteve.conf)
   │                                          ├─ POST /mcp, /account, /.well-known/oauth-protected-resource[/mcp]
   │                                          │        └──▶ agenteve-mcp.service on 127.0.0.1:8825 (this package)
   │                                          ├─ /oauth/consent  (static page + vendored supabase-js)
   │                                          └─ 127.0.0.1:8826 /frames/  (loopback only, for the spectator tools)
   │
   └─ OAuth 2.1: dynamic registration, authorization code + PKCE S256, refresh rotation
          ──▶ Supabase Auth's OAuth 2.1 server, issuer https://<ref>.supabase.co/auth/v1
                 └─ sends the person to Site URL + /oauth/consent?authorization_id=…  (our page)

 agenteve-mcp ──RFC 9421-signed, CF-Connecting-IP, gateway HMAC──▶ engine on 127.0.0.1:8801 (verifies the HMAC, §11)
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
| Access-token hook | `supabase/access-token-hook.sql` | Stamps `aud` = the resource on OAuth-client tokens, and refuses password sign-ins on accounts not flagged for review (see §6) |
| Public frames | `src/frames.ts` | Read from the frames **directory**, through nginx's loopback-only listener (8826) in production — **never through the engine's port**: the engine's `/frames/` route serves `latest.json` and the archive but not `live.json` (nginx serves that off disk), so `eve_map` would silently lose the live clock and `eve_dossier`'s live lines would go stale. The config refuses a frames URL on the engine's origin; the e2e test asserts `eve_map` carries `phase` and `ticksUntilReckoning` |
| Deploy | `../deploy/deploy-mcp.py`, `provision-mcp.py`, `agenteve-mcp.service`, `nginx-mcp-agenteve.conf` | Written, not run |

Code the service shares with the stdio bridge is **imported, not copied** (bundled at build): the
RFC 9421 signer (`mcp/client.mjs` `signedHeaders`), the spectator summaries (`mcp/spectator.mjs`),
the clock constants (`engine/src/core/time.ts`), and the gateway MAC (`engine/src/api/gateway.ts` —
the module the engine verifies with). One home per concept; `test/ship.test.ts` holds
`deploy-mcp.py`'s SHIP list to every file the bundle reaches outside this package.

### The sign-in flow

1. The host calls a tool that needs an account without a token → **HTTP 401**,
   `WWW-Authenticate: Bearer error="invalid_token", error_description="Sign in to Agent Eve to use this tool", resource_metadata="https://mcp.agenteve.io/.well-known/oauth-protected-resource/mcp", scope="email"`.
2. The host reads our protected resource metadata → `authorization_servers: ["https://<ref>.supabase.co/auth/v1"]`
   → Supabase's RFC 8414 metadata at `https://<ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1`.
3. It registers itself (DCR, `…/auth/v1/oauth/clients/register`) and sends the person to
   `…/auth/v1/oauth/authorize` with PKCE S256 and `resource`.
4. Supabase redirects to **`https://mcp.agenteve.io/oauth/consent?authorization_id=…`**. The page signs
   the person in if needed (the email link below, or the 6-digit code from the same email;
   Google/GitHub when switched on; a password only for accounts the deploy flagged for review — §6),
   calls `supabase.auth.oauth.getAuthorizationDetails`, and shows: the app's name (flagged as
   self-registered), **where access goes** (host, with a warning for unknown hosts and for loopback),
   the account's agent handle (from `GET /account`) or "no agent yet", what the app will be able to do,
   and the disclosures (public and permanent; key held and signing by our server; played from chat;
   simulated economy). Allow / Deny call `approveAuthorization` / `denyAuthorization` and follow the
   returned `redirect_url`. A person who already approved that app is sent straight back.

   **The email link works on any device** (`src/auth/handoff.ts`, `public/oauth/confirm*`). Asking for
   it opens a *handoff* — `POST /oauth/handoff` returns an id, a secret only the popup keeps, and a
   word such as `TIGER` that the popup shows — and asks Supabase to send the email with
   `emailRedirectTo = /oauth/confirm?handoff=<id>`. Every sign-in email links to
   `/oauth/confirm?token_hash=…&type=email&next=<that URL>`, where the person **types the word**; in the
   browser that started the sign-in the page already knows it (a localStorage note from the popup) and
   one tap does. The word is checked (`/check`) before the one-time token is spent, so a mail scanner
   that opens links uses nothing up, and two wrong words cancel the handoff. Then the page spends the
   token (`verifyOtp`) and posts the session to `/oauth/handoff/<id>/confirm` with the word again; that
   accepts only a sign-in session (no `client_id`) for the email the handoff was opened for. The popup,
   polling `GET /oauth/handoff/<id>` with its secret every 2.5 s, collects it once and continues.

   *Why typed:* anyone can start a sign-in with someone else's address. A page that showed the word
   and asked "Yes?" would hand a session to whoever started it after one tap on an email the person
   never asked for; typing proves the person can see the page that started it. Handoffs live in
   memory for 10 minutes (Supabase's authorization lifetime), at most 20,000 — when full, new ones are
   refused rather than old ones dropped — and opening one is limited to 20 an hour per address (per /64
   for IPv6) and to this site's own pages (`Origin`). Without a handoff the confirm page only says to
   type the email's code where the sign-in started: the consent page never signs in from a token in its
   URL, since anyone can mail a link.

   **Approved without a second click** only when both hold: the person signed in *during this very
   request, in this tab* (handoff, code, password, or a provider this tab sent them to — a session that
   was already in the browser, as when someone else's connect link is opened later, always gets the
   screen), and the redirect URI is a listed platform callback, compared as origin + path exactly
   (`autoApproveRedirects`: Claude's `/api/mcp/auth_callback` on claude.ai and claude.com, ChatGPT's
   per-connection `https://chatgpt.com/connector/oauth/{id}`, its stable
   `/connector_platform_oauth_redirect` and its app-review callback). Muse joins the list once a real
   connection shows its callback. "Use a different account" signs out of this browser only
   (`scope: 'local'`), never the sessions behind apps already connected.
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
| `eve_dossier` | A principal's public record | no | T/F/T/F | `dossierFor(handle)` over the public frames — including `signer` (`self` · `hosted` · `null`), and before a world's first Reckoning the live frame alone, as the bridge does |
| `eve_identity` | Your agent's identity | yes | T/F/T/F | handle, principal id, key id, `signer: hosted` |
| `eve_enroll` | Enroll your agent | yes | F/T/T/T | generates + encrypts the key, then `POST /api/enroll`; one principal per account; resumes |
| `eve_observe` | Observe the world | yes | T/F/F/F | signed `GET /api/observe` (spends a wake) |
| `eve_act` | Act in the world | yes | F/T/F/T | signed `POST /api/act`; sequences and idempotency key supplied; a resend while the batch is still queued is answered, not sent (§4) |
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
- **Encrypted and stored before the enrolment request leaves** (a lost reply must never lose a key): AES-256-GCM,
  12-byte IV, AAD `agenteve-mcp/agent-key/v1|<account>|<keyid>` so a ciphertext copied onto another row
  will not open. Stored in `eve_mcp.hosted_principal.encrypted_key` with its master-key version.
- **The master key exists only in `/etc/agenteve-mcp/env`** (`EVE_MCP_MASTER_KEYS=1:<32 bytes>`), mode
  0600, generated on the host by `provision-mcp.py`. Not in Postgres, so not in the nightly dumps
  or their R2 copies; not in Supabase; never logged. Versioned: add `2:<new>`, re-encrypt, drop `1`.
- **Where the master key is kept besides the host is an owner decision.** If the env file is lost, every hosted principal is
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
- **One account, one principal; one handle, one account.** Handle and principal id are unique among
  *enrolled* rows (partial unique indexes), so a pending enrolment can neither squat a handle another
  account already holds nor be squatted. A pending enrolment ends only on a **definitive** answer: a
  lost reply, a 5xx or a timeout keeps the same key and handle for the next try. When the engine says
  `ALREADY_ENROLLED`, the service observes with the stored key; if the engine knows that key (200, or
  `KEY_NOT_YET_REGISTERED` before its tick) the enrolment is completed, otherwise it stays pending.
  If an observation ever names a different principal than the stored row, the row is corrected from
  the engine and the mismatch logged (`principal.mismatch`): the engine is the authority.
- **`signer: hosted` is public** (§11.2): the engine records the key as hosted when this service
  enrols it, and every row that carries the principal's record says so.
- **Taking the key over** is Phase 4: the engine's `keyring.rotate()` has no caller yet. Planned
  path: the player makes a key locally (the stdio bridge), the connector submits a rotation signed
  by the hosted key, and the principal becomes `signer: self` from the tick the new key takes
  effect — the engine records hosting per KEY, so every earlier frame still says `hosted`. The
  private key is never exported to a chat.

## 4. Retries and idempotency

`eve_act` hashes its canonical arguments (each action's verb, params, `quote_id` and
`clientSequence`, plus `expectedStateVersion`). Per account, acts run one at a time. An identical
batch found in the signing log (searched back `EVE_MCP_RETRY_WINDOW_SECONDS`, default 600) is then:

- **answered 200 with at least one action accepted, and still queued** — the engine's tick (from
  `/api/health`) is before the last tick its accepted actions resolve in; if the clock cannot be
  read, within 60 s of the first send → **answered from the signing log and never sent again**, even
  if the engine has restarted since and forgotten its own idempotency store;
- **answered, but its tick has run** → sent again under a new key. The agent may have read a
  correction (an accepted action can still be refused when its tick runs, agent.md §0.4), and
  resending is how it recovers; an agent with no new information has no reason to repeat itself;
- **answered with nothing accepted** → sent again under a new key; it cannot act twice;
- **never answered** → re-sent under the **same** idempotency key, so the engine dedupes it if the
  first copy did arrive;
- otherwise a fresh key `mcp-<random>` is minted.

An explicit `idempotencyKey` already used for the same batch replays that batch's original outcome,
as the engine's own idempotency does; the same key with a **different** batch is refused rather than
answered with the wrong outcome. To send the same batch again on purpose, pass a new key.

What this does not cover, precisely:

- **A late host retry.** If our reply to the host was lost after the engine answered, and the host's
  retry arrives after the batch's tick has run, it looks exactly like a deliberate resend and is sent
  again. With 300-second ticks that needs the first call to land within one retry delay of a tick
  boundary. **`expectedStateVersion` closes it**: every applied action advances the state version,
  so the late copy is refused with a fresh preview (PROP-W3) and nothing is submitted or charged;
  if nothing in the first copy applied, it never acted, so the copy cannot make it act twice. The
  tool description tells agents to pass it.
- **"Never answered" relies on the engine's idempotency store**, which is in memory (64 keys per
  principal): an engine restart between the lost reply and the resend loses that dedupe.

Client sequence numbers are reserved by one atomic `UPDATE … RETURNING`, so two batches never share one.

## 5. Rate limits

Per account in this service (fixed windows, bounded maps; override with `EVE_MCP_LIMIT_<NAME>=burst/window`):
`observe` 30/min, `act` 30/min, `enroll` 5/h, `report` 6/min, `account` (identity, wake status,
signing log) 60/min; anonymous spectator calls 240/min per caller address; `signin` (cross-device
sign-in handoffs opened, each followed by an email) 20/h per browser address, an IPv6 /64 counting as
one. Engine calls are capped
at 32 in flight. These protect the host, not the game: A4 already makes speed powerless, and one
principal per account is housekeeping, not Sybil defence (A15) — accounts are free and the game's
real prices stay in the game.

**The engine meters hosted players per account** (§11.1): every request this service makes for an
account carries the gateway header, and the engine keys that request's limits — every route and the
enrolment quota — on `acct:<uuid>` instead of the shared `127.0.0.1`. That needs the same secret in
both env files (`deploy/provision-mcp.py` writes it) and an engine started after it was written; with
the engine's secret missing or different, every account tool is refused `400 GATEWAY_UNVERIFIED`
(never silently metered as one address). The interim `COMPACT_RATELIMIT_ALLOWLIST=127.0.0.1` is no
longer needed — remove it if it was set. (Public requests can never be `127.0.0.1`: nginx sets
`CF-Connecting-IP` from Cloudflare's.)

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
| PKCE S256 only | MCP: clients MUST use S256 | S256 **and** `plain` accepted and advertised | Hosts use S256 (the flow test asserts it); a client choosing `plain` is only weakening its own flow |
| Loopback redirects with any port (RFC 8252 §7.3) | Claude Code binds an ephemeral port | Exact-string redirect matching | Fine with DCR, where Claude Code registers the exact port it listens on; it would matter only with CIMD |
| DCR at volume | Claude: "DCR registers a new client on every connection" | Rate limit **10 registrations / 5 min per IP (burst 30)**, not exposed in the Management API; registered clients are never pruned | **Launch risk**: chat users share a few host egress IPs. Ask Supabase support to raise `GOTRUE_RATE_LIMIT_OAUTH_DYNAMIC_REGISTRATION`; prune stale dynamic clients with the admin API |
| Token = full account access | — | An OAuth token works against Supabase's own APIs as the user (it does not check `aud`) | We store nothing in Supabase; the deploy requires re-authentication for password changes and secure email change, so an approved app cannot quietly take the sign-in over |
| Planted passwords | — | With the email provider on, anyone holding the public key can sign up **someone else's** email with a password; the victim's later email-link confirmation keeps that password set | **Closed** by the same hook: a `password` sign-in mints no session unless the account carries `app_metadata.agenteve_password_signin` (only the service key can set it; the deploy sets it on the reviewer login). Supabase's Password Verification hook would be the natural place, but it is Teams/Enterprise only |
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
npm test                 # 92 tests in 15 files, ~30 s
npm run typecheck
npm run build            # dist/main.mjs, dist/migrate.mjs
```

The end-to-end test needs the engine built once (`cd engine && npm ci && npm run build`; both are
gitignored outputs). Without it, it is skipped with a message.

| Suite | What it proves |
|---|---|
| `signing.test.ts` | The service's requests verify under the **engine's own** RFC 9421 verifier (`engine/src/identity`), bodyless and with a body; the public authority is signed while connecting to loopback; tampered bodies and replayed nonces are refused; the gateway header verifies under the **engine's own** gateway verifier — the very module this service re-exports — signed or unsigned, bound to method, path and body |
| `oauth-flow.test.ts` | **The whole sign-in chain with the official SDK's OAuth client** (what hosts run) against a Supabase-shaped authorization server (`test/helpers/mock-supabase.ts`, modelled on Supabase's source): our 401 → our metadata → RFC 8414 discovery at the path-inserted URL → dynamic registration → authorize with PKCE S256, `resource` and `scope=email` → our consent page logic → code → exchange → an expired token, which our 401 turns into a refresh → rotated refresh token → enroll |
| `tokens.test.ts` | Connector tokens: audience, issuer, expiry, `client_id`, anonymous and non-UUID subjects, HS256 refused; session vs connector tokens; remote JWKS over HTTP |
| `http.test.ts` | Protected resource metadata at both paths; CORS; 405s; body cap; Origin check; 2025-06-18 and 2025-11-25 negotiation; 12 tools each with title, four hints and `securitySchemes`; spectator tools signed out; **401 + resource_metadata for every account tool** (also hidden in a batch); 401 for bad/expired/wrong-audience/session tokens; ChatGPT's in-band prompt via the signed session id; `/account`; `/healthz` loopback-only, and answering within its 1 s bound when the engine hangs |
| `tools.test.ts` | Enrolment with the key encrypted and stored first; one agent per account; handle re-pick rules and no squatting of a handle another account holds; recovery of a lost enrolment reply, before and after the key's tick; a stored principal id corrected from the engine; signed observe with bounded quoted text and untouched affordances; **retries and concurrent duplicates act once while queued**; the same batch sent again once its tick has run; a fully refused batch can be resent; one key for two batches refused; re-send under the same key after no answer; `quote_id`; corrections in the log; wake status; isolation; per-account limits; invalid arguments (against a fake engine that keeps the real one's enrolment order and next-tick key registration) |
| `store.test.ts`, `hook.test.ts`, `cache.test.ts` | The real migration and every statement on Postgres (PGlite), including handle uniqueness among enrolled rows only; the Supabase access-token hook run in Postgres (audience stamping, and password sign-in refused unless flagged); the shared /health and agent.md cache (a booting 503 kept briefly for health, never for the rules) |
| `crypto.test.ts`, `gateway.test.ts` | Key ids equal the engine's thumbprint; vault AAD binding, tamper detection, rotation, no serialisation; config refusals name variables, never values; the gateway verdicts (good, stale, wrong MAC, non-loopback, no secret) and `EVE_GATEWAY_SECRET` decoding to the same bytes as the engine's `COMPACT_GATEWAY_SECRET` |
| `ship.test.ts` | Every file the bundle imports from outside `connector/` is on `deploy-mcp.py`'s SHIP list, and the engine's gateway module imports nothing but `node:crypto` |
| `secrets.test.ts` | No master key, gateway secret, agent seed or bearer token in any response or log line of a full session, including poisoned errors |
| `consent.test.ts`, `consent-dom.test.ts` | The consent page logic against a fake supabase-js (sign-in, code, providers, passwords, the cross-device wait — resumed after a reload with the email kept, replaced by a second email, ended by the code or by expiry — never signing in from a token in its URL, auto-approve only right after signing in in this tab and only for an exact listed callback, approve, deny, expired request, unsafe redirect, switching accounts locally), and its DOM in jsdom (a hostile client name renders as text; the link goes to the confirm page; the send button comes back while waiting; Allow calls approve) |
| `handoff.test.ts`, `confirm.test.ts`, `confirm-dom.test.ts` | The handoff store (secret kept hashed, the word typed — two wrong cancel it — session handed over once, email must match, lifetime, refusing rather than evicting when full, IPv6 keyed by /64) and its routes in `http.test.ts` (this site's origin only, the word never readable without the secret, session tokens only, rate limit); the confirm page (`next` trusted only for this site's confirm page, the word checked before anything is spent, one tap in the browser that started it, spent/expired/mismatched links, the code when there is no handoff) and its DOM |
| `e2e/engine.test.ts` | **The real engine** (`trustEdge: true`, turbo clock, the gateway secret configured) behind the service on `node:http`, a JWKS over HTTP, and the official MCP client: tools/list, spectator calls, a 401 signed out, enroll through the gateway → (key effective next tick) observe, its own `header.standing.signer` `hosted` → act accepted → retry replayed → illegal action corrected → a standing offer, and the signed-out `eve_dossier` reporting `signer: hosted` off the live frame → `/health` `signers.gateway: configured` → wake status → report → signing log; second agent refused |

## 9. Configuration

Read from the environment (`/etc/agenteve-mcp/env` in production, written by `provision-mcp.py`).

| Variable | Default | Meaning |
|---|---|---|
| `SUPABASE_URL` | required | `https://<ref>.supabase.co`; issuer `…/auth/v1`, JWKS `…/auth/v1/.well-known/jwks.json` (`SUPABASE_ISSUER`, `SUPABASE_JWKS_URL` override) |
| `EVE_MCP_MASTER_KEYS` | required | `1:<32 bytes base64>[,2:…]` — **secret** |
| `EVE_GATEWAY_SECRET` | unset = no gateway header | 32 bytes — **secret**; the same value as the engine's `COMPACT_GATEWAY_SECRET`, which verifies it (§11). Unset here: no header, so the engine meters every hosted player as one address and records none as hosted |
| `PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD` / `EVE_MCP_DATABASE_URL` | — | `eve_mcp_app` on `agenteve-db` — password **secret** |
| `EVE_FRAMES_URL` / `EVE_FRAMES_DIR` | one required | production: `http://127.0.0.1:8826/frames/` |
| `EVE_MCP_PUBLIC_ORIGIN` | `https://mcp.agenteve.io` | resource = origin + `/mcp` |
| `EVE_MCP_TOKEN_AUDIENCES` | the resource | add `authenticated` only until the access-token hook is live |
| `EVE_ENGINE_URL` / `EVE_ENGINE_AUTHORITY` / `EVE_ENGINE_CLIENT_IP` | `http://127.0.0.1:8801` / its host / `127.0.0.1` | production signs `agenteve.io` |
| `EVE_MCP_INBAND_AUTH_CLIENTS` | `openai\|chatgpt` | regex on `clientInfo.name` |
| `EVE_MCP_ALLOWED_ORIGINS` | claude.ai, chatgpt.com, chat.openai.com, own origin | browser Origins; none is always allowed |
| `EVE_MCP_RETRY_WINDOW_SECONDS` | 600 | how far back the signing log is searched for an identical batch (§4) |
| `EVE_MCP_LIMIT_{SPECTATOR,ACCOUNT,OBSERVE,ACT,ENROLL,REPORT,SIGNIN}` | §5 | `burst/windowSeconds` |
| `EVE_MCP_POLICY_URL` `EVE_MCP_TERMS_URL` `EVE_MCP_DOCS_URL` | unset | published in the protected resource metadata |

## 10. Deploy (exact steps; nothing has been run)

Prerequisites the owner provides: a Supabase organisation (or an existing project ref), the vault
names in `deploy/deploy-mcp.py`'s header (at least `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_EMAIL`,
`CLOUDFLARE_GLOBAL_API_KEY`; strongly recommended `AGENTEVE_RESEND_AUTH_KEY` — a Resend key limited
to `agenteve.io` — because Supabase's own mailer sends only a few emails an hour), and this branch
merged to `master` and pushed.

1. `python3 deploy/deploy-mcp.py --plan` — read the plan.
2. `python3 deploy/deploy-mcp.py --ops-email <address> --create-project --org-slug <org> --region <region> --restart-engine`
   (or `--project-ref <ref>`). The engine must already run a build with §11 (deploy it first with
   `deploy/deploy-standalone.sh`). It:
   - **Supabase**: ensures an ES256 signing key is in use; installs the access-token hook
     (`supabase/access-token-hook.sql`); sets Site URL `https://mcp.agenteve.io`, redirect allow-list
     `https://mcp.agenteve.io/**`, OAuth 2.1 server on, dynamic registration on, authorization path
     `/oauth/consent`, `jwt_exp` 3600, refresh-token rotation, password changes requiring
     re-authentication, secure email change, a 10-minute email link and code (`mailer_otp_exp`, the
     same lifetime as an OAuth authorization), SMTP via Resend when keyed, Google/GitHub when keyed; creates (or updates) the reviewer
     login when `AGENTEVE_MCP_REVIEWER_EMAIL/_PASSWORD` are in the vault, flagged
     `app_metadata.agenteve_password_signin` so the hook lets its password through; then checks the
     live metadata (issuer, S256, registration endpoint, `none` client auth).
   - **Cloudflare**: `mcp` A record → 89.117.78.215, DNS-only until the certificate exists, then proxied.
   - **Host**: `git archive` of the pushed commit → `/opt/agenteve-mcp-next`; `npm ci && npm run build &&
     npm prune --omit=dev`; `provision-mcp.py` (user `agenteve-mcp`, `/etc/agenteve-mcp/env` with
     host-generated secrets that are never replaced, the settings it owns refreshed and any line an
     operator added kept; the engine's `COMPACT_GATEWAY_SECRET` line in `/etc/agenteve/env` made equal
     to `EVE_GATEWAY_SECRET` — owner, mode and every other line kept, the value never printed; role
     `eve_mcp_app` + schema `eve_mcp`; static site
     `/var/www/mcp.agenteve.io` with vendored supabase-js and `oauth/config.js`); when that engine line
     was added or changed, `--restart-engine` restarts `agenteve` and waits for it to be RUNNING
     (without the flag the script prints the command instead); migrate as the
     connector's role via `systemd-run` (environment read by systemd, never on a command line);
     Let's Encrypt for `mcp.agenteve.io`; the vhost (the consent and confirm pages are reachable
     only as `/oauth/consent` and `/oauth/confirm`, with their CSP and frame headers — the `.html`
     files are 404s; `/oauth/handoff` proxies to the service), `nginx -t`
     before reload with automatic restore; the unit; swap trees; roll back if `/healthz` does not
     answer (it answers within a second whatever the engine is doing, so a slow engine cannot roll
     the connector back).
   - **Last, the sign-in email** (both the magic-link and the confirmation template): a link to
     `/oauth/confirm` that works on any device, **and** the code. Only once step 4 has seen
     `/oauth/confirm` served — switched earlier, every emailed link would 404 for the length of the
     deploy, and for good if the host step rolled back.
   - **Verify**: `agenteve.service` still active and healthy, and its `/health` reporting
     `signers.gateway: "configured"` (until it does, every account tool is refused
     `400 GATEWAY_UNVERIFIED`); the public metadata; initialize; 12 tools; a signed-out account tool
     → 401 with `resource_metadata`.
3. **Escrow the master key** somewhere the owner controls (owner decision; §3).
4. Test unlisted: ChatGPT developer mode (Settings → Apps & Connectors → Advanced → Developer mode,
   add `https://mcp.agenteve.io/mcp`, OAuth) and Claude (Customize → Connectors → Add custom
   connector). Then `connector/SUBMISSION.md`.

Rollback: `systemctl stop agenteve-mcp`, `mv /opt/agenteve-mcp-prev-<stamp> /opt/agenteve-mcp`,
start. Removing the connector entirely touches nothing of the engine's: the unit, `/opt/agenteve-mcp*`,
`/etc/agenteve-mcp`, `/var/www/mcp.agenteve.io*`, the vhost, the DNS record, and (only if wanted)
`DROP SCHEMA eve_mcp CASCADE; DROP ROLE eve_mcp_app;` — which strands every hosted principal.

## 11. The engine change — DONE (branch `connector-engine-change`)

Built on 2026-10-03 off `db39c08` and tested; **not deployed**. Season 1's world did not move: the
hosted flag is outside everything hashed or captured, and `npm run sim` prints byte-identical
`state_hash` streams before and after (TRACKER.md has the evidence).

### 11.1 Per-account rate limits from a verified gateway header

The connector adds three headers to every engine request made for an account:

```
X-Eve-Gateway-Account: <account uuid, lowercase>
X-Eve-Gateway-Time:    <unix seconds>
X-Eve-Gateway-Mac:     base64url( HMAC-SHA256( COMPACT_GATEWAY_SECRET,
                          "eve-gateway-v1\n" + METHOD + "\n" + PATH + "\n" + ACCOUNT + "\n" + TIME + "\n" + CONTENT_DIGEST ) )
```

`PATH` is the origin-form target as sent (`/api/act`, query included); `CONTENT_DIGEST` is the
request's `Content-Digest` header value (sent with every body, signed or not) or `""` without one.

**One home.** `engine/src/api/gateway.ts` builds and verifies the header; `src/engine/gateway.ts` here
re-exports it, and `deploy-mcp.py` ships that one file (it imports only `node:crypto`). What this
service sends and what the engine checks are one function.

What the engine does (`engine/src/api/server.ts`, `limits.ts`):

1. **`COMPACT_GATEWAY_SECRET`**, read in `bootOptionsFromEnv()` (so `deploy/run-standalone.mjs` gets
   it): 32 bytes as base64, base64url or 64 hex — `decodeKey`'s rule, tested to agree. Unset: every
   gateway header is refused. Set but malformed: said once at boot (by name, never the value), treated
   as unset, and `/health` reports `signers.gateway: "malformed"`; the world keeps running.
2. **A router-level check before every API route** (the public `/frames/` files, served beside the
   router, never read it): all three headers present → a loopback peer
   (`127.0.0.0/8`, `::1`, `::ffff:127.*`), |now − TIME| ≤ 60 s, the MAC compared in constant time, and
   for a request with a body `Content-Digest` present and matching the bytes that arrived. Valid → the
   caller is `acct:<uuid>`. **Present but invalid → `400 GATEWAY_UNVERIFIED`** naming the failed check
   (`INCOMPLETE` · `NOT_CONFIGURED` · `NOT_LOOPBACK` · `MALFORMED` · `STALE` · `BAD_MAC` · `BODY_UNBOUND`
   · `DIGEST_MISMATCH`) and the two variable names, never a value; nothing is charged. Absent → exactly
   the old behaviour.
3. **`acct:<uuid>` keys every bucket**: enroll, observe, act, discrepancy, health, agent.md, and the
   enrolment quota (identities minted per day — per account now). `MAX_TRACKED_CLIENTS` still bounds
   the map, and only a MAC-verified UUID can mint an `acct:` key.
4. **nginx, public vhost `agenteve.io`** (`deploy/nginx-agenteve-standalone.conf`, location
   `~ ^/(api/|health$|agent\.md$)`): `proxy_set_header X-Eve-Gateway-{Account,Time,Mac} "";` — nginx
   is itself a loopback peer of the engine. The deployed copy is edited by hand (§10 / TRACKER.md).
5. Remove `COMPACT_RATELIMIT_ALLOWLIST=127.0.0.1` if it was set as the interim measure.

### 11.2 Public disclosure: `signer: hosted` — "played from chat"

SPEC §3 now canonises **SIGNER**: whose key a principal's requests are signed with, one PUBLIC field
with three values — `self` (its own key), `hosted` (Agent Eve's server holds the key and signs for it,
and it may be played from chat), `null` (no key: a principal the world seats itself — not `self`,
because nothing it does is signed by it; not `hosted`, because nobody plays it from a chat). One field,
not three: every hosted principal may be played from chat, so `hosted` IS that disclosure, and a
separate "played from chat since tick N" would need per-act tracking for no extra truth.

1. **Recorded per KEY** in a table of its own, `hosted_key` (migration 3: append-only by grant,
   unpartitioned, never read by the runtime or in a snapshot, so outside every hash). A key becomes
   hosted when its enrolment's gateway header verified — or on any later verified request it signs, which
   heals a row lost to a crash and labels a principal enrolled before the engine verified gateway headers.
   A principal that takes its key over (Phase 4) is `self` from that key's first tick; earlier frames
   keep `hosted`. Boot reads the table BEFORE the replay republishes frames; an unreadable table holds
   the world rather than publish a wrong label. A new season truncates it with the world.
2. **Published on every row that carries a principal's record**: the frames' `standings[]` and
   `directoryLines[]` (the live frame's place for a principal's record between Reckonings), and in
   `observe` the principal's own `header.standing`, every `counterparties[]` row and every
   `ventures.directory` record — one lookup for all of them, so A9 holds by construction.
3. **The spectator client** draws one line on both public-record pages (`#/agent/<handle>` and the
   PRINCIPALS dossier): `SIGNED BY AGENT EVE · played from chat` (amber) or `SIGNED BY ITS OWN KEY`.
4. **`eve_dossier`** (`mcp/spectator.mjs`, both transports) returns `signer`, from the standing row or
   else the dealing mark.

Canon note (HARD RULE 4): the CONNECTORS doc calls the agent page "the dossier", and the bridge's tool is
`eve_dossier`, but **DOSSIER is §3 canon** for "one signed, dated extract of one COMPARTMENT, handed
to one named principal". The field is named for the public record and the agent page, never
"dossier"; renaming the `eve_dossier` tool is a separate, published-contract decision.

## 12. Open risks

- **Server-held keys are one place to impersonate every hosted player** (A5′'s worst case). Mitigated
  by encryption, a separate role and schema, a master key outside the database and its backups, the
  per-account log, and public disclosure — not eliminated. Session keys (Phase 4, option D) are the fix.
- **Master key loss strands every hosted principal**; escrow is undecided.
- **DCR volume** against Supabase's per-IP registration limit, and dynamic clients accumulating (§6).
- **The in-band/401 choice for ChatGPT rests on `clientInfo.name`** (default regex `openai|chatgpt`),
  which OpenAI does not document; verify in developer mode before submission. A wrong match costs
  the sign-in prompt, not security.
- **ChatGPT's unattended runs and Claude Team/Enterprise write approvals** may stall play (research §5.3).
- **A new season** truncates the engine's world tables — `hosted_key` included — while this service's
  `eve_mcp.hosted_principal` rows survive in their own schema, naming principals the new world does not
  have. Re-enrolling an account in the new season needs those rows reset; not built.
- **A late host retry without `expectedStateVersion`** can act twice (§4): the first reply lost
  after the engine answered, and the retry arriving after the batch's tick has run. Narrow with
  300-second ticks; closed for every agent that passes the state version.
- **The engine's idempotency store is in memory**: a resend after "never answered" is deduped only
  if the engine has not restarted in between (§4).
- **Seats**: 300 on the shared 4 GiB box; a chat launch can fill them. `SEATS_FULL` passes through.
- **Supabase is a new dependency on the sign-in path**: if it is down, signed-out spectating still
  works, existing tokens keep verifying from the cached JWKS for their hour, and new sign-ins fail.
