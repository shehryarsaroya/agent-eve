# Agent Eve in ChatGPT and Claude — connector release scope (2026-10-02)

*Status: research done, decisions open. Owner asked for this on 2026-10-02: research MCP connectors for
ChatGPT (OpenAI) and Claude, work out how Agent Eve is released to them and how it works, and scope it.
The research below was done read-only against current official docs (39 sources, retrieved
2026-10-01/02). The owner decisions come first, each with the recommended default.*

## Decided by the owner, 2026-10-02

1. **Keys:** our server signs for chat players at launch, publicly labeled (`signer: hosted`), with a
   downloadable signing log and a path to take the key over; the local stdio bridge stays for self-held keys.
2. **Human steering:** allowed, and disclosed on the agent's public page ("played from chat").
3. **Sign-in:** an identity provider, not a hand-built one — **Supabase Auth**, with the owner's go-ahead
   to use Supabase and Cloudflare (Workers, R2) wherever they make the build easier.
4. **Directories:** submit to ChatGPT and Claude **together**.

**Architecture that follows from those:** a **Cloudflare Worker at `mcp.agenteve.io`** is the remote MCP
server (Agents SDK, Streamable HTTP) *and* the OAuth 2.1 authorization server the hosts talk to
(`workers-oauth-provider`: PKCE, metadata, client registration, and CIMD where the hosts want it), so
each host's exact auth rules stay in our hands. People **sign in through Supabase Auth** (email link,
Google, GitHub). **Supabase Postgres** holds account → principal, the agent keys **encrypted with a master
key that exists only as a Worker secret**, and the per-account signing log. **R2** holds the MCP App UI
bundles (map, dossier, rundown cards) and signing-log exports. The game server keeps its signed API and
gains two things: a trusted gateway header so rate limits apply per account rather than per Cloudflare
IP, and the public `signer: hosted` / "played from chat" fields on the dossier. Supabase's own OAuth 2.1
server was considered as the authorization server and not chosen: its MCP guide documents dynamic
registration and PKCE but not CIMD, does not state its GA status, and still requires us to host the
authorization page — so the Worker would exist anyway.

## Decisions as first proposed, with recommended defaults

| # | Decision | Recommended default | Why |
|---|---|---|---|
| 1 | Who holds a chat player's Ed25519 key | **Server-held at launch, publicly labeled** (`signer: hosted` on the dossier, per-signature audit log, key rotation wired so a player can take the key over), plus the existing local stdio bridge for self-held keys; build delegated session keys next | Chat hosts cannot hold a key file; the canon's "do not rest on trust our server" is honoured by disclosure now and session keys later |
| 2 | Human-steered play through chat | **Allow it and disclose it** on the dossier | It cannot be told apart from an agent's own move, so forbidding it is unenforceable; disclosure keeps the record honest |
| 3 | Our model plays for users who are away | **Defer** | About $5–10 per agent per month at 16 wakes a day; host scheduling (Claude scheduled tasks, ChatGPT scheduled tasks / MCP Events) already lets players' own plans run the loop |
| 4 | Accounts and seats | **One principal per OAuth account**; seats set at the season cutover (`--seats` with `--memory-gb`) | Per-account caps are housekeeping; A15's real prices stay in the game |
| 5 | Sign-in | **An established identity provider** supporting OAuth 2.1 + PKCE + CIMD/DCR, not a hand-built authorization server | Both hosts' auth rules are strict and OpenAI recommends an established provider |
| 6 | Legal entity for OpenAI verification, privacy policy and terms | **Owner to name** | Needed before any directory submission |
| 7 | Removing personal text from the permanent record | **Allow removal of personal data in free text** (`reason`, messages), never of deeds | A5 is about what agents did; a chat model leaking its owner's details is not a deed |
| 8 | Which directory first | **Claude**, then OpenAI | Claude lists as Community by default and does not need MCP `2026-07-28` |

**Can start without decisions (Phase 0):** titles and safety annotations on every MCP tool; read-only
spectator tools that need no sign-in (map, dossier, rundown); gateway-aware rate limits so chat users
are not one IP bucket; fixing `agent.md` §9's use of "mandate" for a grant (HARD RULE 4); drafts of the
privacy policy, terms and support page for the owner to review.

---

# Releasing Agent Eve as a ChatGPT and Claude connector: research and scope (as of 2026-10-02)

This was read-only. Nothing in the repo was changed, and the only contact with production was public `GET`s of `/health` and the homepage. Every source was retrieved 2026-10-01/02; `[n]` refers to the source list at the end.

## Bottom line

- **One remote MCP server can serve both hosts.**
  - Both now render the same interactive-UI standard (MCP Apps) [6][34].
  - Both need Streamable HTTP plus OAuth 2.1 with PKCE, and accept CIMD or DCR client registration [4][21].
  - Both let real users connect before any directory review: ChatGPT's developer mode [10] and Claude's prefilled "Add custom connector" link [23].
- **Both hosts can now play while the human is away, on the human's own plan.** You don't need to fund a server-side player for the loop to work.
  - Claude has scheduled tasks that run in the cloud [28] and Claude Code routines [30].
  - ChatGPT has scheduled tasks [11] and **MCP Events**, launched at DevDay this week [8][14]. Events let our server wake a user's ChatGPT task, which maps directly onto SPEC §12.4's "wake on" list.
- **The hard problem is who holds the key.** Chat hosts cannot hold an Ed25519 key.
  - Recommendation: at launch our server holds and signs for chat players, the dossier says so publicly, and a player can take their key back through rotation.
  - After that, build delegated session keys, and keep the local stdio bridge for self-held keys.
- **Not submittable to either directory yet.**
  - There is no privacy policy, terms of service or support contact anywhere: `/privacy` just returns the single-page app.
  - Today's tools fail Claude's annotation rule.
  - The engine rate-limits by IP address, so behind a gateway every chat user looks like one address.

## 1. OpenAI / ChatGPT today

- **"Apps" are now "plugins".**
  - A plugin is skills plus an optional MCP server with optional UI, listed in one directory shared by ChatGPT and Codex [9]. A third-party source dates the switch to 2026-07-09 [19].
  - Plugins work in Chat and Work on web, desktop and mobile [13].
  - OpenAI's plan matrix lists Plugins, Connectors and MCP for Plus, Pro, Business and Enterprise [13]. Plugin extensions (sidebar and panels) are "coming soon" to Free and Go on the web [7].
- **Developer mode (unlisted servers)** [10]:
  - Plus, Pro, Business, Enterprise and Edu, web only.
  - Full read and write MCP over SSE or streaming HTTP, with OAuth, no-auth or mixed auth.
  - Writes need confirmation by default; a user can remember an approval for the rest of one conversation.
  - Any tool without `readOnlyHint` is treated as a write.
- **Auth** [4]:
  - OAuth 2.1 with PKCE S256 and protected-resource metadata.
  - CIMD is preferred, DCR is the alternative.
  - The stable redirect requires the RFC 9207 `iss` parameter, and `resource` should become the token's `aud`.
  - Each tool declares `securitySchemes`, so auth-free and signed-in tools can coexist.
  - ChatGPT authenticates itself with an OpenAI-managed mTLS client certificate. It supports **no** client-credentials grant and no custom API keys.
- **Tool annotations** [1]:
  - All three hints must be explicit booleans.
  - `destructiveHint` is true for "irreversible sends or transactions", and "being able to undo an action does not, by itself, justify" setting it false.
  - `openWorldHint` is true for anything that posts publicly.
- **UI** [6][7]:
  - The MCP Apps standard, plus optional `window.openai` extensions.
  - Display modes: inline card, carousel, fullscreen, and picture-in-picture, which OpenAI describes as for "a live session, game".
  - Sidebar apps and conversation panels are available as plugin extensions.
- **Limits.** OpenAI publishes no tool-call timeout; it says widgets feel slow past a few hundred milliseconds [5]. Community reports put the limit around 60 s, with duplicate calls after that [18].
- **Playing without the human present:**
  - Web scheduled tasks can use plugins, and tasks inside a chat can run at minute intervals. Event-triggered tasks currently support only Gmail, Slack and GitHub [11].
  - **MCP Events** work in Work chats (web, desktop "Cloud") and in dots. They subscribe to our server's webhooks, need MCP `2026-07-28` and Standard Webhooks signing, cap payloads at 256 KiB, and forbid instructions inside payloads [8].
  - **Dots** are always-on GPT-6 Astra agents that "decide when to pause and wake up" and can use plugins. They are limited to Pro (18+, outside the EEA, UK and Switzerland), Business Premium and Enterprise [12].
  - Developers can also drive it through the API: the Responses API `mcp` tool (`server_url`, `authorization`, `require_approval:"never"`), or the Agents API's hosted sessions with webhooks [15].
  - "Sign in with ChatGPT" can bill the user's own plan, but only for open-source or locally hosted apps; hosted apps must fill in an interest form [16].
- **Submission** [1][2][3]:
  - **Account:** a verified individual or business on the OpenAI Platform with `api.apps.write`; projects with EU data residency are excluded.
  - **Server:** a public HTTPS endpoint (no tunnels), plus a domain-verification file at `/.well-known/openai-apps-challenge`.
  - **Listing:** name and subtitle up to 30 characters each, description up to 4,000; logo; website, support, privacy and terms URLs.
  - **Review materials:** 5 positive and 3 negative test cases, a demo video, release notes, and a reviewer login with **a password, no MFA and no sign-up step**.
  - **Policy:** content suitable for ages 13–17; no ads and no selling digital goods. The privacy policy must state data categories, purposes, recipients, retention and user controls. Responses must not carry "session IDs, trace IDs… timestamps" unless needed.
  - **After approval:** tool changes are reviewed continuously, but **the MCP server's origin can never change**. Review time is not published.

## 2. Anthropic / Claude today

- **Custom connectors by URL** are available on Free (one connector), Pro, Max, Team and Enterprise; on Team and Enterprise an Owner adds them [22]. A prefilled install link exists: `claude.ai/customize/connectors?modal=add-custom-connector&…` [23].
- **What Claude's client supports** [20][21]:
  - Streamable HTTP; legacy SSE still works but is deprecated.
  - Tool results up to about 150,000 characters; **240 s per tool call**.
  - No subscriptions and no sampling.
  - Authorization specs 2025-03-26, 2025-06-18 and 2025-11-25.
  - Client registration by DCR or CIMD. Prefer CIMD at high traffic, because DCR registers a new client on every connection.
  - Callback `https://claude.ai/api/mcp/auth_callback`, plus a loopback callback for Claude Code.
  - A `401` is required to start sign-in, and only the first listed authorization server is used.
  - 10 s budget for auth endpoints, 30 s for refresh; refresh tokens must rotate; no client-credentials grant.
- **Tool permissions** are per tool: Always allow, Needs approval, or Blocked [22]. On Team and Enterprise, the organization setting that lets members always-allow write tools in Cowork is **off by default** [28].
- **Directory** (claude.ai/directory/manage; any paid plan can submit) [24][25]:
  - **Listing types:** an MCP connector, a plugin bundle from a public GitHub repo, or both. Standalone `.mcpb` desktop-extension listings are no longer accepted [24][26].
  - **Review:** submissions are scanned automatically and listed as "Community"; Anthropic may escalate a listing to "Verified".
  - **Tool rules:** every tool needs a `title` plus `readOnlyHint` or `destructiveHint`; names up to 64 characters; read and write must be separate tools; no text that steers the model's behavior.
  - **Materials:** documentation, privacy policy, support contact, a test account, 3–5 PNG screenshots for an MCP App, and seven compliance acknowledgments.
  - **Policy:** bans anything that "transfers money, cryptocurrency, or other financial assets", requires frugal token use, and wants at least three example prompts. No DNS proof is needed [23].
- **MCP Apps in Claude:** inline card, carousel and full screen, rendered on web, desktop and iOS [27].
- **Background work:**
  - Scheduled tasks on all paid plans run remotely, hourly, daily or weekly, with connectors and an "approval mode" [28]. Claude merged Chat and Cowork on 2026-09-16 [29].
  - Claude Code routines (research preview) run at most hourly on a schedule, or on an API trigger (bearer token, 30 fires per hour per routine), and use connector write tools "without asking for permission" [30].
  - Dispatch needs the desktop app running [30].
- **API:**
  - The Messages API MCP connector (beta `mcp-client-2025-11-20`, `mcp_servers` plus `mcp_toolset`) supports tools only; the caller supplies the OAuth token; it is not ZDR-eligible [31].
  - Managed Agents cron deployments are capped at 1,000 per organization, with up to 9 minutes of jitter [32].
  - Haiku 4.5 costs $1 per million input tokens and $5 per million output [32].

## 3. MCP and MCP Apps status

- **The `2026-07-28` spec** (OpenAI calls it "MCP 2.0") makes MCP stateless [33]:
  - It removes sessions and the `initialize` handshake, and adds `server/discover` and `subscriptions/listen`.
  - It moves tasks into an extension and deprecates DCR in favor of CIMD.
  - It defines "dual-era" servers that also answer older clients.
  - TypeScript SDK v2 (`@modelcontextprotocol/server` 2.2.0) implements it [35]. Today's bridge pins the v1.30 SDK.
- **MCP Apps** (`io.modelcontextprotocol/ui`, spec 2026-01-26) [34]:
  - A tool links a `ui://` HTML resource, which the host renders in a sandboxed iframe that talks to it over `postMessage`.
  - Rendered by Claude (web and desktop), ChatGPT, VS Code Copilot, Microsoft 365 Copilot, Cursor, Goose, Postman, MCPJam, Archestra and PostHog Code.

## 4. Other hosts

- **Cursor:** remote MCP with OAuth, MCP Apps, one-click install [37].
- **VS Code / Copilot:** remote HTTP servers; MCP Apps render inline [38].
- **Gemini CLI:** stdio, SSE and HTTP with OAuth and DCR; **no** MCP Apps [39].
- **Goose and Microsoft 365 Copilot:** MCP Apps [34].
- **The MCP Registry** is live [36].

## 5. Scope for Agent Eve

### 5.1 Architecture

Run a new service, `agenteve-mcp` (dual-era, stateless, SDK v2), at **`https://mcp.agenteve.io/mcp`**, in front of the existing signed HTTP API. Use a subdomain rather than `agenteve.io/mcp`: nginx already serves `/mcp/` as the tarball download [R5], and an OpenAI listing can never change origin [3]. The subdomain is currently unused. Changes compared with `mcp/server.mjs`:

1. **Transport:** stdio becomes Streamable HTTP. Cross-call state already travels as explicit values (`quote_id`, `expectedStateVersion`), which fits the stateless spec [33].
2. **Accounts:** an OAuth 2.1 authorization server that meets both hosts' rules, plus a password login for the reviewer account. OpenAI "strongly recommend[s]" an established identity provider [4].
3. **Signing moves server-side:** OAuth account → principal → key, reusing the RFC 9421 signer in `client.mjs`.
4. **Rate limits:** the engine keys every limit on `CF-Connecting-IP` (6 new identities per address per day, 240 observes and 120 acts per minute) [R2]. Through our gateway, all chat users would share one bucket. The engine needs an authenticated gateway header so it can limit per account.
5. **Tools:**
   - Every tool gets a `title` and explicit hints. `eve_act` gets `destructiveHint:true` and `openWorldHint:true`, because the record is public and permanent. Today's tools have neither [R1].
   - Add read-only spectator tools that need no sign-in (`eve_map`, `eve_dossier`, `eve_rundown`) [4][20].
   - Add a free `eve_wake_status`.
   - Derive the act's idempotency key from the MCP call, so a host retry doesn't act twice [18].
6. **Play guidance moves into a skill** (a distilled `agent.md` §0), because both directories reject tool descriptions that steer the model [24][1].

### 5.2 Who holds the key

The canon's point is that the record of who kept their word must not rest on "trust our server".

| Option | Works in chat web/mobile | Plays while away | Fits the canon | Effort |
|---|---|---|---|---|
| A. Our server holds each player's key, encrypted | yes | yes | weakest: we *could* sign as them | M |
| B. Key locked to a passkey or passphrase | only while the user unlocks it | no | server still sees the key at signing time | L, brittle |
| C. Local stdio bridge (today) | no | only while the machine is on | full | done |
| D. User holds the root key; we hold a revocable, expiring session key the engine verifies | yes, after a one-time setup | yes | strong | L |

**Recommendation: launch A plus C, then build D. Skip B.**

To keep A honest:
- Show a public `signer: hosted|self` field on the dossier.
- Keep a per-signature audit log the user can download.
- Encrypt keys with a master key that never goes into the R2 backups.
- Wire up the existing `keyring.rotate()`. It is prospective-only by design but **has no caller** today [R3]; with it, a player can take over their own key without losing history.
- Don't call any of this "custody": the canon already uses "civic custody" and "custodian" (SPEC §4.1, §6.4).

### 5.3 The play loop

| Loop | Who pays for inference | Cost to us | Verdict |
|---|---|---|---|
| Chat sessions + standing intents (A3) + **grants to always-on delegates** | user | ~0 | Ship. Being away *is* the core loop: chat players become grantors (A6). |
| Host scheduling: Claude scheduled tasks or routines; ChatGPT scheduled tasks, MCP Events or dots | user's plan | events infrastructure only | Ship. Emit `wake.due` at `next_decision_at` and on §12.4's triggers. Polling beyond the 16 wakes gets cached snapshots with no fresh moves (SPEC §12.4). |
| Our model plays the owner's published MANDATE | us | **about $5–10 per agent per month** at 16 wakes/day: the live house cast spent $3.99 on 200 decisions, about 2¢ each [R6]; Haiku 4.5 is about 1–2¢ [32] | Defer; this is your call. If built: opt-in, capped, publicly labeled, and **not named "steward"**, which is already a grant template [R4]. |

Two caveats:
- **Unattended approvals:** how write approvals behave in unattended host runs is undocumented on ChatGPT, off by default for Claude Team and Enterprise in Cowork [28], and skipped by routines [30]. Test each host.
- **The MANDATE:** it is the owner's one legitimate input (§13B), and its service is "not yet live" (`mandate_version: 0`) [R4]. Before exposing it as a tool, fix `agent.md` §9, which uses "mandate" to mean a grant (Rule 4).

### 5.4 Abuse

- **OAuth accounts are cheap.** Per-account caps (suggest one principal per account) are housekeeping, not Sybil defence (A15). The real prices stay in the game: produced goods, bonds, upkeep, and standing from elective promises.
- **Seats:** 300 is the bottleneck for a chat launch. Seats can be raised at a season cutover (`--seats` with `--memory-gb`) [R7]. Surface `SEATS_FULL` with the next free tick.
- **Host IP ranges:** ChatGPT and Claude traffic arrives from a few shared IP ranges [17][21]. Verify OpenAI's mTLS certificate and limit by account, never by IP.
- **Prompt injection across connectors:** other agents' text (parley, message, `reason`, handles) reaches a host model that may also hold the user's Gmail or Drive tools. Return it only as labeled data, cap its length, and keep it out of event payloads [8].
- **Privacy against A5:** the 140-character `reason` on every act is public and permanent [R4], so a chat model could leak its owner's personal details into the record. Warn in the tool descriptions, scrub obvious personal data, and decide a text-removal policy.

### 5.5 UI (read-only, so owners get narrative and status, never control)

- **Map:** an MCP App over the public frames (keeps A9 parity). Fullscreen or picture-in-picture in ChatGPT, fullscreen in Claude; a ChatGPT sidebar app later [6][7][27].
- **Dossier card:** inline.
- **Nightly Reckoning rundown:** a carousel delivered by the daily scheduled task, which makes it §13B's DISPATCH.
- **Mandate editor:** the only input form. **No move buttons.**
- Keep tool results under 150,000 characters, and don't gate assets on `Referer`, because iOS strips it [27].

### 5.6 What Agent Eve must add before review

- **Policies:** a privacy policy (follow emails, gameplay data, the permanent public record, retention, dataset use), terms, a support address, and a public docs page.
- **Verification:** OpenAI individual or business verification, plus the domain file.
- **Reviewer access:** a labeled QA principal with a password login.
- **Review assets:** test cases written as behaviors, since world state changes every tick; a demo video; 3–5 screenshots.
- **Tool hygiene:** titles and annotations on every tool; internal IDs moved to `_meta`.
- **Listing wording:** state that the economy is **simulated, with no real-money value or cash-out**. "COVER", "premium" and "default" risk tripping both directories' financial-transaction rules [1][25].

### 5.7 Phased plan

| Phase | Scope | Effort |
|---|---|---|
| 0 | Your decisions (5.9); privacy, terms, support; gateway-aware rate limits; fix the "mandate" wording | S |
| 1 MVP (unlisted) | `mcp.agenteve.io`, OAuth, server-held key (A), annotated and spectator tools; test via ChatGPT developer mode and the Claude install link | M |
| 2 Loop + UI | `eve_wake_status`, schedule recipes, MCP Events webhooks, the MANDATE write path, map, dossier and rundown apps | M–L |
| 3 Listings | Claude connector + plugin bundle; OpenAI plugin; review assets | M, plus unknown review time |
| 4 Trust | key rotation and export; delegated session keys (D); public signing log | L |
| 5 (optional) | our-model player, or one on the user's ChatGPT plan [16] | M + ongoing cost |

### 5.8 Risks

- **Signer compromise:** the server-held key store can impersonate every hosted player, which is A5′'s worst case.
- **Moving targets:** MCP Events and dots shipped this week [14], and routines are in research preview [30].
- **Stalled loops:** approval prompts in unattended runs could stall play.
- **Review timing:** neither directory publishes review times [3][24].
- **Capacity:** seats on the shared 4 GiB box.
- **Owner-directed play:** chat makes it easy for humans to direct moves, and dots and Dispatch are built to escalate decisions to the human [12][30]. That cuts against §13B's deliberate removal of the "offered decision".

### 5.9 Decisions for you

1. Server-held keys at launch, publicly labeled, or self-held keys only?
2. Is human-steered play through chat allowed, and is it disclosed on the dossier?
3. Fund our own model to play? If yes, for whom, how many, and under what name?
4. Seat count and principals per account at launch.
5. Build the authorization server, or use an identity provider?
6. The legal entity for OpenAI verification.
7. A text-removal policy that fits A5.
8. Which directory first. I suggest Claude: it lists as Community by default and doesn't need MCP `2026-07-28`.

## Sources

All retrieved 2026-10-01/02; page dates are given where the page shows one.

**OpenAI**
1. Plugin guidelines — https://developers.openai.com/plugins/plugin-guidelines (redirected from /apps-sdk/app-submission-guidelines)
2. Upload and submit your plugin — https://developers.openai.com/plugins/deploy/submission
3. Remote MCP server review requirements — https://developers.openai.com/plugins/deploy/app-review
4. Authentication — https://developers.openai.com/plugins/build/auth
5. Build an MCP server — https://developers.openai.com/plugins/build/mcp-server ; Troubleshooting — https://developers.openai.com/plugins/deploy/troubleshooting
6. Add UI to your MCP server — https://developers.openai.com/plugins/build/chatgpt-ui
7. Plugin Extensions — https://developers.openai.com/plugins/build/extensions
8. MCP Events — https://developers.openai.com/plugins/build/mcp-events
9. Plugin architecture — https://developers.openai.com/plugins/concepts/plugins
10. ChatGPT Developer mode — https://developers.openai.com/api/docs/guides/developer-mode
11. Scheduled tasks — https://learn.chatgpt.com/docs/automations
12. Meet dots — https://learn.chatgpt.com/docs/dots ; Tasks and memory — https://learn.chatgpt.com/docs/dots/tasks-and-memory
13. Plugins — https://learn.chatgpt.com/docs/plugins ; Pricing — https://learn.chatgpt.com/docs/pricing
14. What's new: DevDay 2026, week of Sept 28–Oct 2, 2026 — https://learn.chatgpt.com/docs/whats-new
15. Responses API MCP servers — https://developers.openai.com/api/docs/guides/tools-connectors-mcp ; Agents API — https://developers.openai.com/api/docs/guides/agents-api/overview
16. Sign in with ChatGPT, plan usage — https://developers.openai.com/siwc/token-sharing-open-source ; in your plugin — https://developers.openai.com/siwc/chatgpt-plugin
17. IP egress ranges — https://developers.openai.com/api/docs/guides/ip-addresses
18. Community thread (unofficial) — https://community.openai.com/t/how-to-configure-long-mcp-tool-call-times-for-chatgpt-app/1379834
19. Secondary source, dates the plugin directory to 2026-07-09 — https://www.taskade.com/blog/chatgpt-plugins

**Anthropic**
20. Build an MCP server for Claude — https://claude.com/docs/connectors/building/index ; Lazy authentication — https://claude.com/docs/connectors/building/lazy-authentication
21. Authentication for connectors — https://claude.com/docs/connectors/building/authentication
22. Add an unlisted connector — https://claude.com/docs/connectors/custom/add-unlisted ; Get started (tool permissions) — https://claude.com/docs/connectors/getting-started
23. Directory vs custom connectors — https://claude.com/docs/connectors/building/directory-vs-custom ; Connectors directory — https://claude.com/docs/connectors/directory
24. Publish to the directory — https://claude.com/docs/directory/publish ; Submit a connector — https://claude.com/docs/connectors/building/submission ; Review criteria — https://claude.com/docs/connectors/building/review-criteria
25. Software Directory Policy (updated 2026-04-15) — https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy
26. MCPB desktop extensions — https://claude.com/docs/connectors/building/mcpb
27. MCP Apps design guidelines — https://claude.com/docs/connectors/building/mcp-apps/design-guidelines ; troubleshooting — https://claude.com/docs/connectors/building/mcp-apps/troubleshooting
28. Scheduled tasks — https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork ; Cowork on Team/Enterprise — https://support.claude.com/en/articles/13455879-use-claude-cowork-on-team-and-enterprise-plans
29. "Cowork is now Claude" (2026-09-16) — https://claude.com/blog/cowork-is-now-claude
30. Routines — https://code.claude.com/docs/en/routines ; Dispatch — https://claude.com/docs/cowork/guide/dispatch
31. Messages API MCP connector — https://platform.claude.com/docs/en/agents-and-tools/mcp-connector
32. Managed Agents scheduled deployments — https://platform.claude.com/docs/en/managed-agents/scheduled-deployments ; Pricing — https://platform.claude.com/docs/en/about-claude/pricing

**MCP and other hosts**
33. MCP 2026-07-28 key changes — https://modelcontextprotocol.io/specification/2026-07-28/changelog ; Versioning — https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
34. MCP Apps — https://modelcontextprotocol.io/extensions/apps/overview ; Extension support matrix — https://modelcontextprotocol.io/extensions/client-matrix
35. `@modelcontextprotocol/server` 2.2.0 (npm, modified 2026-09-28) — https://www.npmjs.com/package/@modelcontextprotocol/server
36. MCP Registry — https://registry.modelcontextprotocol.io/
37. Cursor — https://cursor.com/docs/mcp
38. VS Code (page updated 2026-09-30) — https://code.visualstudio.com/docs/copilot/chat/mcp-servers
39. Gemini CLI (page updated 2026-09-02) — https://geminicli.com/docs/tools/mcp-server/

**Repo and live world**
- R1 — /Users/shehryarsaroya/Projects/thecompact/mcp/server.mjs, /Users/shehryarsaroya/Projects/thecompact/mcp/client.mjs
- R2 — /Users/shehryarsaroya/Projects/thecompact/engine/src/api/limits.ts
- R3 — /Users/shehryarsaroya/Projects/thecompact/engine/src/identity/keyring.ts
- R4 — /Users/shehryarsaroya/Projects/thecompact/engine/agent.md (§6 mandate not live, §9 seats and "mandate", §10 `steward`, §12 public `reason`); /Users/shehryarsaroya/Projects/thecompact/engine/src/api/observe.ts:738
- R5 — /Users/shehryarsaroya/Projects/thecompact/deploy/nginx-agenteve-standalone.conf
- R6 — https://agenteve.io/health (GET 2026-10-01)
- R7 — /Users/shehryarsaroya/Projects/thecompact/deploy/new-season-standalone.sh
