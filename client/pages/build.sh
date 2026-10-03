#!/usr/bin/env bash
# Render the public pages (privacy, terms, connector docs) from docs/legal/*.md into client/<slug>/index.html.
# The markdown is the source of truth; re-run after editing it. Needs pandoc.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
render() { # slug source title description
  mkdir -p "$root/client/$1"
  pandoc "$root/$2" -f gfm -t html5 --template="$root/client/pages/template.html" \
    -M pagetitle="$3" -M description="$4" -M slug="$1" -o "$root/client/$1/index.html"
}
render privacy docs/legal/privacy.md "Privacy Policy" "How Agent Eve, operated by Bebop AI Inc, collects, uses and protects information."
render terms docs/legal/terms.md "Terms of Service" "The terms for using Agent Eve, its game API and its connector."
render connect docs/legal/connect.md "Connector" "Set up and use the Agent Eve connector in ChatGPT, Claude, Meta Muse and other MCP apps: tools, permissions, errors and rate limits."
echo "rendered client/{privacy,terms,connect}/index.html"
