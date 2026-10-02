"""Run as root on the Agent Eve host. Provision only the MCP connector's own, freshly named resources.

    python3 provision-mcp.py --tree /opt/agenteve-mcp-next --supabase-url https://<ref>.supabase.co \
        --supabase-key <publishable key> [--providers google,github] [--share-gateway-secret]

Creates, if absent: the `agenteve-mcp` system user; /etc/agenteve-mcp (0700) and its env file (0600)
with a freshly generated master key, gateway secret and database password; the database role
`eve_mcp_app` and its schema `eve_mcp` in the engine's database; the static site
/var/www/mcp.agenteve.io (consent page, landing page, vendored supabase-js, generated config.js).

Secrets are generated HERE and written only to /etc/agenteve-mcp/env. Nothing secret is printed or
returned. It never touches agenteve.io's files, units or env — except that --share-gateway-secret
appends COMPACT_GATEWAY_SECRET to /etc/agenteve/env when absent (unused until the engine change,
README "Engine change"), and only then.
"""
import argparse
import base64
import json
import os
import re
import secrets
import shutil
import subprocess
from pathlib import Path

ENV_DIR = Path('/etc/agenteve-mcp')
ENV_FILE = ENV_DIR / 'env'
SITE = Path('/var/www/mcp.agenteve.io')
SECRET_KEYS = ('EVE_MCP_MASTER_KEYS', 'EVE_GATEWAY_SECRET', 'PGPASSWORD')

parser = argparse.ArgumentParser()
parser.add_argument('--tree', required=True, help='the staged release, e.g. /opt/agenteve-mcp-next')
parser.add_argument('--supabase-url', required=True)
parser.add_argument('--supabase-key', required=True, help='the PUBLISHABLE key; public by design')
parser.add_argument('--providers', default='', help='comma-separated: google,github')
parser.add_argument('--public-origin', default='https://mcp.agenteve.io')
parser.add_argument('--game-origin', default='https://agenteve.io')
parser.add_argument('--policy-url', default='')
parser.add_argument('--terms-url', default='')
parser.add_argument('--docs-url', default='')
parser.add_argument('--audiences', default='', help='override EVE_MCP_TOKEN_AUDIENCES (comma-separated)')
parser.add_argument('--share-gateway-secret', action='store_true')
args = parser.parse_args()

assert os.geteuid() == 0, 'run as root'
assert re.fullmatch(r'https://[a-z0-9]{20}\.supabase\.co', args.supabase_url), 'unexpected Supabase URL shape'
assert re.fullmatch(r'[A-Za-z0-9_.\-]{20,400}', args.supabase_key), 'unexpected publishable key shape'
providers = [p for p in args.providers.split(',') if p]
assert all(p in ('google', 'github') for p in providers), 'providers must be google and/or github'
tree = Path(args.tree)
assert (tree / 'connector' / 'dist' / 'main.mjs').exists(), 'build the connector before provisioning'


def run(command, **kwargs):
    return subprocess.run(command, check=True, text=True, capture_output=True, **kwargs)


def b64key():
    return base64.b64encode(secrets.token_bytes(32)).decode()


# ── the user ─────────────────────────────────────────────────────────────────────────────────
if subprocess.run(['id', 'agenteve-mcp'], capture_output=True).returncode:
    run(['useradd', '--system', '--no-create-home', '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin', 'agenteve-mcp'])

# ── the environment file: secrets generated once, kept forever; settings refreshed ──────────
ENV_DIR.mkdir(mode=0o700, exist_ok=True)
os.chmod(ENV_DIR, 0o700)
existing = {}
if ENV_FILE.exists():
    for line in ENV_FILE.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            existing[key] = value
generated = {
    # Versioned so it can rotate (connector/src/crypto/vault.ts). LOSING THIS STRANDS EVERY
    # HOSTED PRINCIPAL: identity is never re-minted. See README "Master key custody".
    'EVE_MCP_MASTER_KEYS': existing.get('EVE_MCP_MASTER_KEYS') or f'1:{b64key()}',
    'EVE_GATEWAY_SECRET': existing.get('EVE_GATEWAY_SECRET') or b64key(),
    'PGPASSWORD': existing.get('PGPASSWORD') or secrets.token_hex(32),
}
settings = {
    'NODE_ENV': 'production',
    'EVE_MCP_HOST': '127.0.0.1',
    'EVE_MCP_PORT': '8810',
    'EVE_MCP_PUBLIC_ORIGIN': args.public_origin,
    'EVE_GAME_ORIGIN': args.game_origin,
    'EVE_ENGINE_URL': 'http://127.0.0.1:8801',
    # Sign the public authority: hosted signatures then look exactly like self-held ones.
    'EVE_ENGINE_AUTHORITY': 'agenteve.io',
    'EVE_ENGINE_CLIENT_IP': '127.0.0.1',
    'EVE_ENGINE_TICK_SECONDS': '300',
    'EVE_FRAMES_URL': 'http://127.0.0.1:8811/frames/',
    'SUPABASE_URL': args.supabase_url,
    'PGHOST': '127.0.0.1',
    'PGPORT': '5546',
    'PGDATABASE': 'compact',
    'PGUSER': 'eve_mcp_app',
}
for name, value in (('EVE_MCP_POLICY_URL', args.policy_url), ('EVE_MCP_TERMS_URL', args.terms_url), ('EVE_MCP_DOCS_URL', args.docs_url), ('EVE_MCP_TOKEN_AUDIENCES', args.audiences)):
    if value:
        settings[name] = value
content = ''.join(f'{k}={v}\n' for k, v in {**settings, **generated}.items())
tmp = ENV_FILE.with_suffix('.tmp')
with open(tmp, 'w') as stream:
    os.chmod(tmp, 0o600)
    stream.write(content)
os.replace(tmp, ENV_FILE)
os.chmod(ENV_FILE, 0o600)

# ── the database role and schema, as the database owner inside the container ───────────────
password = generated['PGPASSWORD']
assert re.fullmatch(r'[0-9a-f]{64}', password)
role_exists = run(['docker', 'exec', 'agenteve-db', 'psql', '-U', 'compact', '-d', 'compact', '-Atc', "SELECT 1 FROM pg_roles WHERE rolname='eve_mcp_app'"]).stdout.strip() == '1'
sql = [] if role_exists else [f"CREATE ROLE eve_mcp_app LOGIN PASSWORD '{password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;"]
sql += [
    # The connector's role owns its own schema. It is granted nothing on the engine's tables
    # (the engine grants those to compact_app by name), and compact_app nothing on eve_mcp.
    'CREATE SCHEMA IF NOT EXISTS eve_mcp AUTHORIZATION eve_mcp_app;',
    'GRANT CONNECT ON DATABASE compact TO eve_mcp_app;',
]
run(['docker', 'exec', '-i', 'agenteve-db', 'psql', '-U', 'compact', '-d', 'compact', '-v', 'ON_ERROR_STOP=1'], input='\n'.join(sql) + '\n')

# ── the static site: consent page, landing page, vendored supabase-js, generated config ─────
staged = SITE.with_name(SITE.name + '.next')
shutil.rmtree(staged, ignore_errors=True)
shutil.copytree(tree / 'connector' / 'public', staged)
(staged / 'oauth' / 'config.example.js').unlink(missing_ok=True)
(staged / 'vendor').mkdir(exist_ok=True)
shutil.copy2(tree / 'connector' / 'node_modules' / '@supabase' / 'supabase-js' / 'dist' / 'umd' / 'supabase.js', staged / 'vendor' / 'supabase.js')
config = {
    'supabaseUrl': args.supabase_url,
    'supabaseKey': args.supabase_key,
    'providers': providers,
    'passwordSignIn': True,
    'knownRedirectHosts': ['claude.ai', 'claude.com', 'chatgpt.com', 'chat.openai.com'],
    'gameOrigin': args.game_origin,
}
(staged / 'oauth' / 'config.js').write_text('window.EVE_CONSENT = ' + json.dumps(config, indent=2) + ';\n')
(staged / '.well-known' / 'acme-challenge').mkdir(parents=True, exist_ok=True)
if SITE.exists() and (SITE / '.well-known').exists():
    shutil.rmtree(staged / '.well-known')
    shutil.copytree(SITE / '.well-known', staged / '.well-known')
for root, dirs, files in os.walk(staged):
    os.chmod(root, 0o755)
    for name in files:
        os.chmod(os.path.join(root, name), 0o644)
previous = SITE.with_name(SITE.name + '.prev')
shutil.rmtree(previous, ignore_errors=True)
if SITE.exists():
    SITE.rename(previous)
staged.rename(SITE)

# ── optionally hand the engine the same gateway secret (inert until the engine change) ──────
shared = False
if args.share_gateway_secret:
    engine_env = Path('/etc/agenteve/env')
    text = engine_env.read_text()
    if not re.search(r'^COMPACT_GATEWAY_SECRET=', text, re.M):
        with open(engine_env, 'a') as stream:
            stream.write(('' if text.endswith('\n') else '\n') + f"COMPACT_GATEWAY_SECRET={generated['EVE_GATEWAY_SECRET']}\n")
        shared = True

print(json.dumps({'user': 'agenteve-mcp', 'env': str(ENV_FILE), 'database_role': 'eve_mcp_app', 'schema': 'eve_mcp', 'site': str(SITE), 'secrets': 'generated on host; not returned', 'gateway_secret_shared_with_engine': shared}))
