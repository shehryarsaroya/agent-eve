#!/usr/bin/env bash
# Build the ChatGPT plugin ZIP (Agent Plugins format): plugin.json, mcp.json, skills/, assets/.
# The Claude bundle (.claude-plugin/, .mcp.json) shares skills/ but is published from a repository.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$here/dist"
rm -f "$here/dist/agent-eve-chatgpt.zip"
(cd "$here" && zip -qr -X dist/agent-eve-chatgpt.zip plugin.json mcp.json skills assets)
unzip -l "$here/dist/agent-eve-chatgpt.zip"
