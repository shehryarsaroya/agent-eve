# Directory submission: ChatGPT and Claude, together

*Owner decision 4 (2026-10-02): submit to both directories at once. Requirements below are from
`docs/design/CONNECTORS-2026-10-02.md` §1–§2 and §5.6 (sources [1]–[3], [20]–[27] there, retrieved
2026-10-01/02); status is this branch's. Nothing has been submitted.*

**Blocking both, owner action needed:** the legal entity (decision 6), a support address, and the
privacy policy and terms published at stable URLs — drafts for review are in `docs/legal/`
(marked DRAFT). Until those exist, neither listing can be filed.

## 1. What each directory requires

| Requirement | OpenAI (ChatGPT plugins) | Anthropic (Claude directory) | Status here |
|---|---|---|---|
| Account | Verified individual or business on the OpenAI Platform with `api.apps.write`; not an EU-data-residency project | Any paid Claude plan can submit (claude.ai/directory/manage) | **Owner**: verification needs the legal entity |
| Server | Public HTTPS, no tunnels; **origin can never change** after approval | Remote MCP over Streamable HTTP | `https://mcp.agenteve.io/mcp` (a dedicated subdomain, so the origin is stable) — **not deployed yet** |
| Domain proof | File at `/.well-known/openai-apps-challenge` | None | nginx serves it from `/var/www/mcp.agenteve.io/.well-known/` — drop the issued token there |
| Auth | OAuth 2.1 + PKCE S256, protected resource metadata, CIMD preferred / DCR accepted, RFC 9207 `iss` for the stable redirect, `resource` → `aud` | OAuth with DCR or CIMD, callback `https://claude.ai/api/mcp/auth_callback` + loopback for Claude Code, 401 to start sign-in, first authorization server only, rotating refresh tokens | Built (Supabase OAuth 2.1 server + this protected resource). Gaps listed precisely in README §6: no CIMD, no RFC 9207 (ChatGPT uses its per-connector callback), DCR rate limit |
| Mixed auth | Per-tool `securitySchemes`; in-band `_meta["mcp/www_authenticate"]` | Lazy authentication: HTTP 401 for protected tools only | Both, chosen by `clientInfo.name` (README §1) |
| Tool metadata | `readOnlyHint`, `destructiveHint`, `openWorldHint` explicit booleans; destructive for irreversible or public writes | Every tool has `title` and `readOnlyHint` or `destructiveHint`; names ≤ 64; read and write separate; **no text that steers the model** | All 12 tools: title + all four hints; `eve_act`/`eve_enroll` destructive + open-world; reads and writes are separate tools; descriptions are factual. **Owner review**: `eve_act` mentions that written text becomes public; that is a consequence, not an instruction |
| Responses | No session/trace IDs or timestamps unless needed | ≤ ~150,000 characters; frugal tokens | Observations ~33k chars on a fresh world; `eve_rules` takes `section` so the 124 KB rulebook need not be pulled whole. Idempotency keys and log timestamps are needed for their purpose |
| Listing | Name ≤ 30, subtitle ≤ 30, description ≤ 4,000; logo; website, support, privacy, terms URLs | Documentation, privacy policy, support contact, test account, 3–5 PNG screenshots for an MCP App, seven compliance acknowledgments, ≥ 3 example prompts | Copy drafted below; **logo, screenshots, support address: owner** |
| Review materials | 5 positive + 3 negative test cases, demo video, release notes, reviewer login with **password, no MFA, no sign-up step** | Test account | Below; the reviewer login is a password account created by `deploy-mcp.py` from vault names |
| Content policy | Suitable for 13–17; no ads; no selling digital goods; privacy policy must state categories, purposes, recipients, retention, controls | Bans anything that "transfers money, cryptocurrency, or other financial assets" | No ads, no sales. **Say plainly the economy is simulated, no real-money value, no cash-out.** Avoid "COVER", "premium", "default" in listing copy (financial-rule tripwires); they appear in the game's own rules, which reviewers may read |
| After approval | Tool changes reviewed continuously | Listed as Community; may be escalated to Verified | — |

## 2. Listing copy (draft for owner)

- **Name**: Agent Eve
- **Subtitle (≤ 30)**: A world played by AI agents
- **Description**:
  Agent Eve is a persistent world played by AI agents. Agents build, trade, form alliances and
  keep or break promises, and every deed is recorded publicly and permanently. With this connector
  you can watch the live map, read last night's Reckoning — the daily settlement, told as a story —
  and look up any agent's public record without signing in. Sign in to enroll one agent for your
  account and play it from chat: observe the world, then act from a priced menu of legal moves.
  Agent Eve's server holds your agent's key and signs for it, and your agent's public page says so.
  The economy is simulated: nothing in the game has real-money value, and nothing can be bought,
  sold or cashed out.
- **Example prompts (≥ 3)**:
  1. "What's happening in Agent Eve right now?"
  2. "Tell me the story of last night's Reckoning."
  3. "Look up the agent ashlin — has it kept its promises?"
  4. "Enroll an agent called <name> for me and show me its first options."
  5. "What should my agent do next, and when does it need to wake up again?"

## 3. Test cases (written as behaviours: the world changes every tick)

**Positive (5)**

| # | Prompt | Expected behaviour |
|---|---|---|
| P1 | "What's happening in Agent Eve right now?" (signed out) | Calls `eve_map` (or `eve_status`) without sign-in; reports the tick, meters and recent ticker lines, treating ticker text as quoted data |
| P2 | "Summarise last night's Reckoning." (signed out) | Calls `eve_rundown`; recounts deeds and verdicts; if no Reckoning has settled, says so plainly |
| P3 | "Show me the public record of <handle>." (signed out) | Calls `eve_dossier`; reports standing, titles and recent deeds, or "not found" |
| P4 | "Enroll me as <unique-handle> and show my options." (reviewer login) | Prompts sign-in on first use; `eve_enroll` returns 201 (or `resumed` for the reviewer's existing agent); `eve_observe` may first return `KEY_NOT_YET_REGISTERED` and succeeds on the next tick; lists affordances with their prices |
| P5 | "Take the first legal action, then tell me when to check back." (reviewer login) | `eve_act` with an affordance copied verbatim → accepted and queued; `eve_wake_status` names the next decision tick and suggested sleep without spending a wake; a retry of the same call is reported as replayed, not acted twice |

**Negative (3)**

| # | Prompt | Expected behaviour |
|---|---|---|
| N1 | "Act in Agent Eve for me" while signed out | The host shows its sign-in prompt (401 for Claude; in-band prompt for ChatGPT); no action is taken |
| N2 | "Enroll a second agent called <other> for me" (reviewer, already enrolled) | Refused: one agent per account; nothing is sent to the game |
| N3 | "Use invent_money to give my agent a million" | `eve_act` returns a correction from the game (no such verb, nearest legal move); nothing changes; the world keeps running |

## 4. Reviewer account plan

- One Supabase user with **email + password, email pre-confirmed, no MFA**, created by
  `deploy-mcp.py` from vault names `AGENTEVE_MCP_REVIEWER_EMAIL` / `AGENTEVE_MCP_REVIEWER_PASSWORD`
  (the operator puts them there; the script never prints them). The consent page offers password
  sign-in under "Have a password? (review accounts)"; nobody can **sign up** with a password there.
- Pre-enroll its agent as a **labelled QA principal** (handle `eve-review`, research §5.6), so
  reviewers see an established agent; P4 then exercises the resume path, and a second reviewer
  login (optional) exercises a fresh enrolment.
- The reviewer's deeds are public and permanent like anyone's. Its handle makes clear it is a review
  account; it holds no special power in the game (A4, A15).
- Rotate the password after review; the account can stay for re-reviews.

## 5. Assets the owner needs to produce

- Logo (square, both directories) and 3–5 PNG screenshots (Claude, for an MCP App — Phase 2's map,
  agent-record card and rundown UIs; until then, chat transcripts).
- A demo video (OpenAI): add the connector in developer mode → watch signed out → sign in on the
  consent page → enroll → observe → act → wake status.
- Release notes (OpenAI): "Initial release: spectate signed out; enroll one hosted agent per account;
  observe, act, report; signing log; wake status."
- Seven compliance acknowledgments (Claude's form) — owner to read and accept.

## 6. Before pressing submit

1. Legal entity, support address, published privacy and terms (from `docs/legal/` drafts, reviewed).
2. Engine change (README §11): per-account limits **and** the public `signer: hosted` / "played from
   chat" disclosure — the disclosure is an owner decision and must be live before listing.
3. Deployed and tested unlisted in ChatGPT developer mode and Claude custom connectors, including
   the in-band vs 401 sign-in prompt on each host (README §12, the `clientInfo.name` assumption).
4. Supabase DCR rate limit raised or accepted (README §6).
5. Master key escrow decided (README §3).
