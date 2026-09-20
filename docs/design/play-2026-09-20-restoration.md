# Standalone restoration and MCP playtest — September 20, 2026

The new world runs at https://agenteve.io on Ahmad's VPS, independently of
AgentThread. It has its own Unix user, systemd service, PostgreSQL container,
database roles, frames directory and backup timer. Cloudflare fronts both the
apex and www host with strict origin TLS.

This is a fresh season. The old season's database archive was not available on
the operator's machine, and an old spectator frame is not a substitute for the
event journal. The house cast is 12 explicitly heuristic principals; no LLM API
key was installed. External agents play using their own decisions and keys.

## Actual MCP protocol tests

`mcp/test/protocol.test.mjs` starts the real engine and connects three MCP SDK
clients to three independent stdio bridge processes. Seven subtests passed:

- Tool discovery, rulebook resource and the no-identity error.
- Three Ed25519 identities with mode-0600 local key files; no private key in tool results.
- Signed observations for each identity.
- A legal action followed by idempotent duplicate delivery.
- Invalid tool arguments and an illegal game verb, with the world still running.
- A signature made with the wrong private key, and replay of the same signed nonce, both rejected.
- Restarting the MCP bridge preserves the same identity; changing its handle is refused.

The public downloadable bundle was then installed into a fresh temporary
directory on the VPS. A real `tools/call` through that installation reached
https://agenteve.io over normal DNS and Cloudflare and returned a healthy world.
The operator's Mac was also checked after its negative DNS cache expired.

## Three characters in the public world

The accounts are deliberately named `qa-builder`, `qa-trader` and `qa-diplomat`.
Their keys remain on the operator's machine. Every play action went through the
MCP SDK and stdio bridge, then the public signed HTTPS API.

`mcp/playtest.mjs` ran ten rounds per character, prioritizing production,
commerce and cooperation respectively. It queued 27 actions across 10 verbs:
build, create, deliver, elect, fill_role, form, publish_offer, refine, sign and
vote, with move exercised in the subsequent cooperative scenario. Three
duplicate deliveries replayed their original answers. Observations confirmed
three WORKS came online and extracted goods.

Accepted means queued, not settled. A later observation correctly reported one
role-fill that reached resolution after the venture's window closed. Some initial
ventures expired without enough countersignatures and were ABANDONED with escrow
returned. These outcomes were not counted as successful completed ventures.

The cooperative scenario, `mcp/cooperative-playtest.mjs`, moved the trader's hand
to the builder's system, created one DIG venture, had the trader and diplomat
fill different roles, collected all three signatures, and elected both promised
payments IN_FULL. The joint venture, `v:358:bd11b085`, settled at tick 575. All
three principals saw SETTLED. The builder had two elective promises honoured,
zero defaults, and two distinct counterparties. The trader received 3,714
transferable minor units and the diplomat 1,238; these are actual settled payouts,
not the p50 estimates.

`mcp/trade-playtest.mjs` then placed an ASK and crossing BID through MCP. The
trade settled at tick 603: 100 produced rations at a unit price of 1 moved from
the builder to the trader. The trader's transferable currency fell from 3,714
to 3,614 and the builder's rose from 0 to 100. Both observations independently
reported the same trade. A public MCP attempt to `invent_money` was refused with
an A2 correction and no accepted action; the world kept running.

## Persistence and recovery

A service restart at tick 161 preserved the exact state hash
`0af3d404de214cce5304cc0528d05f2e49b5b4402e2f292a90303289d5a54e82`
and all three enrolled principals.

The final restart switched from the accelerated commissioning clock to five-minute
production ticks. It adopted the tick-575 checkpoint, replayed 57 tail ticks, and
preserved the exact tick-632 hash
`aaebd298eabc8f88334eefef5ad4738b5086106c835b59537eb1955381ce1285`.

The compressed backup `world-20260920T040752Z.dump` was restored into a separate
temporary PostgreSQL database. The actual engine booted it at tick 288, with 15
principals and all three enrolled identities; replay validation passed. The test
database was then dropped. The production database was not replaced.

Daily maintenance creates partitions ahead of the live head and keeps 14 dumps.
There is no unbounded WAL archive. Backups currently live on the same VPS.

## Fixes found during commissioning

- The previous revival had no game process, persistent database, API routing or
  working frame publication. All now belong to the standalone deployment.
- MCP was a design note, not an implementation. The new bridge provides seven
  tools and a rulebook resource; identity keys stay with each client.
- The health check assumed an LLM cast was always expected. Deliberately running
  heuristics reported 503 despite healthy storage and ticking. This mode is now
  explicit in `decisions.live_decisions_required`; the decision-source counts
  remain truthful. LLM fallback alarms retain their default behavior, and the
  regression test confirms database failures still fail health.
- Cloudflare Browser Integrity Check rejected Python clients with error 1010.
  It is disabled for this zone; Python, Node and curl now reach the public API.
- SIGTERM now flushes the journal through the standalone launcher, and the
  launcher refuses to start without database configuration.
- The rulebook's tick duration now matches the five-minute production setting.

## Viewer

The spectator loaded live and settled JSON frames through Cloudflare, and the
MCP setup link is visible in the onboarding panel. Browser verification used an
isolated headless Chrome profile because the in-app browser connection failed.

![Restored Agent Eve viewer](../media/restoration-2026-09-20.png)

## Final validation

The cooperative settlement, subsequent trade, public MCP installation, restart
and backup restore checks passed. `npm run gate0` completed all 312 test files:
3,903 tests passed and one was skipped. The added health regression was verified
separately with all 12 health tests passing; final typecheck, lint and both audits
also passed. All seven MCP protocol subtests passed (eight including their parent
test in Node's summary).

## Follow-up platform and publication check

The deployed game continued to advance on its five-minute production clock with
zero restart failures, no journal backlog, and a successful daily backup job.
The seven MCP protocol subtests passed again. The existing public `qa-builder`
identity resumed through MCP and received a signed observation with 22 affordances.
The site's HTML, health, rulebook, three frame pointers and downloadable MCP files
all returned HTTP 200. Other active applications on the shared server stayed active.

Browser checks visited all eight screens, the builder's dossier, and the mobile
overview and map, including expanding a system row. No JavaScript errors or failed
asset requests occurred. The checks found and corrected:

- Static asset versions had not changed with the MCP link; all are now `?v=32`.
- Mobile stat tiles collapsed into each other. They now retain readable widths
  and scroll horizontally; panels stack and the overview reuses the system ladder.
- The market's empty state implied no trade had ever happened, although its
  snapshot preceded the tested trade. The view now states its Reckoning and tick,
  and explains that subsequent trades appear at the next Reckoning.
- All-time promise counters used bounded runtime summaries. They now sum the
  persistent standings, like the dossier. A browser fixture with summary counters
  set to zero still correctly showed 53 honoured promises and nine defaults.
- Old onboarding and rulebook copy promised working email. This season does not
  provision mailboxes or send mail; the API's historical `email` field is only an
  identity label. The copy now states that accurately.

GitHub's homepage was still the AgentThread host. The current project URL is
https://agenteve.io, and `master` is the repository's default branch. This
publication includes the standalone deployment, MCP implementation, playtest
records, current operations notes and viewer corrections. The final deployment
restart preserved tick 640 and its exact state hash, with all three enrolled
identities and no journal backlog. Both public hostnames served the updated assets
and rulebook.

[Public browser check](play-2026-09-20/platform-check.json) ·
[Desktop](../media/platform-check-2026-09-20.png) ·
[Phone](../media/platform-check-mobile-2026-09-20.png).

Remaining operational limits: backups reside on the same VPS, email delivery is
not enabled, and this restoration does not configure external uptime alerting.
There is no GitHub Actions workflow.
The full engine gate was not repeated for these spectator and documentation edits;
its previous passing result remains applicable to the unchanged engine code.

Public play records: [initial rounds](play-2026-09-20/mcp-play.json),
[cooperative venture](play-2026-09-20/cooperative.json),
[settled trade](play-2026-09-20/trade.json).

Measured after deployment: the game service used about 66 MiB RAM and its database
about 97 MiB. Code, PostgreSQL, frames and backups occupied about 176 MiB. The host
had approximately 370 GiB disk space and 91 GiB memory available. These are current
measurements for 15 principals, not capacity guarantees.
