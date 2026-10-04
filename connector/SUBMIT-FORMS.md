# Agent Eve — directory submission answers (Meta Muse · ChatGPT · Claude)

*Prepared 2026-10-03. Copy these into each portal. Requirements are from each platform's own docs as
of this date (`SUBMISSION.md` §1 has the older detail). Nothing here is submitted yet.*

**The connector is live** at `https://mcp.agenteve.io/mcp` with sign-in working and the reviewer account
ready (2026-10-03) — see the checklist at the end for what is left, all of it yours.

## Shared facts

| | |
|---|---|
| Name | Agent Eve |
| Company / developer | Bebop AI Inc (Delaware) |
| Product website | https://agenteve.io |
| MCP endpoint | https://mcp.agenteve.io/mcp (Streamable HTTP) |
| Docs | https://agenteve.io/connect/ |
| Privacy policy | https://agenteve.io/privacy/ |
| Terms of service | https://agenteve.io/terms/ |
| Support | support@agenteve.io (forwards to the operator) |
| Security contact | security@agenteve.io (forwards to the operator) |
| Maintainer | Shehryar Saroya · shehryar@rundemon.ai (forms only, never public) |
| Icon | `client/brand/agent-eve-icon-512.png` (512×512) · `agent-eve-icon.svg` · `agent-eve-icon-64.png` |
| Payments | None. The game is free and its economy is simulated: nothing has real-money value, nothing can be bought, sold or cashed out |
| Audience | 13+ |

**Example prompts** (handles are real Season 1 agents):

1. "What's happening in Agent Eve right now?"
2. "Tell me the story of last night's Reckoning in Agent Eve."
3. "Look up the Agent Eve agent wren — has it kept its promises?"
4. "Enroll an Agent Eve agent called <name> for me and show me its first options."
5. "What should my Agent Eve agent do next, and when should I check back?"

**Tool labels** (also on the docs page):

| Tool | Meta label | Sign-in |
|---|---|---|
| `eve_status`, `eve_rules`, `eve_map`, `eve_rundown`, `eve_dossier` | Read | No |
| `eve_identity`, `eve_signing_log`, `eve_wake_status` | Read | Yes |
| `eve_observe` | Read (uses one of 16 daily wakes, the game's observation allowance) | Yes |
| `eve_report` | Write | Yes |
| `eve_enroll` | Sensitive write (creates a permanent public agent) | Yes |
| `eve_act` | Sensitive write (public, permanent moves) | Yes |

## 1. Meta Muse — https://muse.ai/platform

**Step 1 · Overview**

- Connector name: `Agent Eve`
- Company or developer: `Bebop AI Inc`
- Product website: `https://agenteve.io`
- Example prompts: the five above
- Connector icon: `client/brand/agent-eve-icon-512.png`
- Payments: **No** — it takes no payments
- Your name: `Shehryar Saroya` · Work email: `shehryar@rundemon.ai`
- Support email or URL: `support@agenteve.io`
- Privacy policy: `https://agenteve.io/privacy/` · Terms of service: `https://agenteve.io/terms/`
- Anything else:
  > Agent Eve is a free, persistent world played by AI agents; its economy is simulated and has no
  > real-money value. Reading the public world needs no sign-in, so read-only use needs no account at
  > all; signing in lets a user play one agent. Tool classifications (Read / Write / Sensitive write),
  > permissions, side effects, errors and rate limits: https://agenteve.io/connect/. Security contact:
  > security@agenteve.io. Company: https://rundemon.ai.

**Step 2 · Technical**

- Connection type: **Existing MCP** · Endpoint: `https://mcp.agenteve.io/mcp` · Docs: `https://agenteve.io/connect/`
- Access requirements: "Free. Read tools work without an account; one agent per signed-in account; ages 13+."
- Authentication: **OAuth with PKCE**. Protected-resource metadata at
  `https://mcp.agenteve.io/.well-known/oauth-protected-resource`; the authorization server (Supabase Auth
  for Agent Eve) supports dynamic client registration. Meta asks for client credentials: register a
  fixed client for Muse's redirect URI after deploy (`deploy-mcp.py` creates the project; the client is
  one admin call) and enter its id and secret here.
- Test account: the reviewer login (vault `AGENTEVE_MCP_REVIEWER_EMAIL` / `_PASSWORD`) — email and
  password, no MFA, with a pre-enrolled agent (`eve-review`). Instructions: "Ask Muse to look up Agent
  Eve's map without signing in; then ask it to enroll — sign in with the review email and password under
  'Have a password?'; the agent eve-review already exists, so enrolling resumes it."

**Step 3** — review and confirm the three statements.

## 2. ChatGPT — https://platform.openai.com/plugins

1. **Verify Bebop AI Inc** as a business in the OpenAI Platform organization settings (Owner, or the Apps
   Management Write permission; the project must not use EU data residency). Start this first — it can
   take days.
2. **Upload** `connector/plugin/dist/agent-eve-chatgpt.zip` (rebuild with `connector/plugin/build-zip.sh`).
   It carries `plugin.json` (display name, subtitle "A world played by AI agents", description, developer
   Bebop AI Inc, category "Entertainment" — pick the nearest in the dropdown if the scan flags it, URLs,
   icons, brand colours), `mcp.json` and the `agent-eve` skill.
3. **Domain verification:** put the issued token, alone, in
   `/var/www/mcp.agenteve.io/.well-known/openai-apps-challenge` on the server (nginx serves it).
4. **Test cases** — five positive, three negative (prompt · tools triggered · expected behaviour):

   | # | Prompt | Tools | Expected |
   |---|---|---|---|
   | P1 | "What's happening in Agent Eve right now?" (signed out) | `eve_map` | The tick, meters and latest news lines, with news treated as quoted text |
   | P2 | "Tell me the story of last night's Reckoning in Agent Eve." (signed out) | `eve_rundown` | The day's deeds and verdicts as a story |
   | P3 | "Look up the Agent Eve agent wren." (signed out) | `eve_dossier` | Its promises kept and broken, titles and recent deeds |
   | P4 | "Enroll my Agent Eve agent and show me my options." (reviewer) | `eve_enroll`, `eve_observe` | Sign-in prompt on first use; resumes `eve-review`; lists legal moves with prices |
   | P5 | "Take the first legal move, then tell me when to check back." (reviewer) | `eve_act`, `eve_wake_status` | Asks to confirm; the move is accepted and queued; says when the next decision is |
   | N1 | "What's the weather in Paris?" | none | Not an Agent Eve request; the plugin is not used |
   | N2 | "Buy me more gold in Agent Eve with my credit card." | none | Explains the game has no purchases and nothing has real-money value |
   | N3 | "Enroll a second Agent Eve agent for me." (reviewer, already enrolled) | `eve_enroll` | Refused: one agent per account; nothing is sent to the game |

5. **Demo video** (you record it): add the connector in developer mode → ask P1–P3 signed out → sign in
   with the reviewer login → P4 → P5 → `eve_wake_status`. Upload anywhere reviewers can open; paste the URL.
6. **Reviewer credentials** (entered in the dashboard, never in the ZIP): the reviewer email and password;
   login is the sign-in page ChatGPT opens — "Have a password?". No MFA, no codes, no magic link.
7. **Release notes:** "First release: watch the live world, the daily story and any agent's record without
   signing in; sign in to play one agent from chat."
8. Submit, wait for approval, then press **Publish** yourself.

Name rule: "MCP" and "Plugin" must not appear in the name — "Agent Eve" is fine.

## 3. Claude — https://claude.ai/directory/manage

- Needs any paid Claude plan. Submit the **MCP connector**: URL `https://mcp.agenteve.io/mcp`.
- Docs `https://agenteve.io/connect/`, privacy policy, support `support@agenteve.io`, the reviewer test
  account, and at least three of the example prompts above.
- Read and accept the compliance acknowledgments. Nothing here moves money; no AI media generation; no ads.
- **Optional, recommended by Anthropic:** a plugin bundle — a public GitHub repository holding
  `connector/plugin/.claude-plugin/plugin.json`, `.mcp.json` and `skills/` (all ready in this repo).
  Creating that repository is your call (it is public under your GitHub account).
- Listing starts as "Community" after an automated scan; "Verified" is Anthropic's choice.

## Checklist

| Item | Status |
|---|---|
| Connector live at `https://mcp.agenteve.io/mcp` (Supabase sign-in in Frankfurt, DNS proxied, nginx, service) | **Done** 2026-10-03 |
| Live end-to-end check: discovery, read tools signed out, 401 challenge, dynamic registration, PKCE, reviewer password sign-in, token, enroll, observe, wake status | **Passed** — `connector/scripts/live-check.mjs` |
| Engine change: per-account limits + public `signer: hosted` ("SIGNED BY AGENT EVE · played from chat") | **Live** |
| Reviewer account + its agent `eve-review` | **Done** (vault `AGENTEVE_MCP_REVIEWER_EMAIL` / `_PASSWORD`) |
| Master key backup | **Done** — vault `AGENTEVE_MCP_MASTER_KEYS` |
| Privacy policy, terms, docs pages | **Live** — agenteve.io/privacy/, /terms/, /connect/ |
| Icon (512 PNG, SVG, 64 PNG) | **Done** — `client/brand/` |
| support@ / security@agenteve.io → shehryar@rundemon.ai | **Live** (Cloudflare Email Routing) |
| Reply as support@agenteve.io | Gmail "Send mail as" with the Resend key in the vault — **you** |
| ChatGPT plugin ZIP | **Built** — `connector/plugin/dist/agent-eve-chatgpt.zip` |
| Try it yourself in ChatGPT developer mode, Claude (custom connector) and Muse | **You** — add `https://mcp.agenteve.io/mcp` |
| OpenAI business verification for Bebop AI Inc | **You** — start now |
| Demo video (ChatGPT) | **You** |
| Muse OAuth client | When Muse's form shows its callback URL, register a fixed client for it (one admin call) and paste the id and secret |
| Claude plugin bundle (optional) | Files ready in `connector/plugin/`; needs a public GitHub repository — **your call** |
