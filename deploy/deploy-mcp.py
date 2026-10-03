"""Deploy the Agent Eve MCP connector (connector/) at https://mcp.agenteve.io. WRITTEN, NOT YET RUN.

Run from the repo root on the operator's machine, on a clean `master` that is already pushed:

    python3 deploy/deploy-mcp.py --ops-email <address> [--project-ref <ref>] [--restart-engine]
    python3 deploy/deploy-mcp.py --ops-email <address> --create-project --org-slug <slug> --region <region>
    python3 deploy/deploy-mcp.py --plan     # print the steps and touch nothing

What it creates or updates, in order (every step is idempotent; re-running converges):
  1. Supabase (Management API): the auth-only project; an asymmetric (ES256) JWT signing key in
     use; the access-token hook (audience, review-only passwords); the OAuth 2.1 server (dynamic registration on,
     authorization path /oauth/consent), Site URL and redirect allow-list; sign-in email
     templates and, when a key is in the vault, SMTP through Resend; Google/GitHub when their
     credentials are in the vault; optionally the directory reviewer's password login.
  2. Cloudflare: the `mcp.agenteve.io` A record (DNS-only until the origin certificate exists,
     then proxied, like agenteve.io).
  3. The host (89.117.78.215): ships the pushed commit with `git archive`, builds it in
     /opt/agenteve-mcp-next, provisions (deploy/provision-mcp.py — which also makes the engine's
     COMPACT_GATEWAY_SECRET equal to the connector's EVE_GATEWAY_SECRET, generated on the host and
     never printed), migrates schema eve_mcp, gets the origin certificate, installs the nginx vhost
     (`nginx -t` first), installs and restarts agenteve-mcp.service, rolls back by itself if the new
     build will not stay up. The engine reads COMPACT_GATEWAY_SECRET only at start: when provisioning
     added or changed it, --restart-engine restarts agenteve.service (and waits for it to be
     RUNNING again); without the flag the script stops short and prints the one command to run.
  4. Verifies the connector publicly AND that agenteve.service is still running and healthy, and
     that the engine reports its gateway header as `configured` — until it does, every account
     tool is refused 400 GATEWAY_UNVERIFIED (the engine never trusts the header without the secret).

Reads, by NAME only, from the private kit vault (~/Projects/yc-gstack-kit/credentials/.env):
  required  SUPABASE_ACCESS_TOKEN, CLOUDFLARE_EMAIL, CLOUDFLARE_GLOBAL_API_KEY
  optional  AGENTEVE_SUPABASE_PROJECT_REF       the project, instead of --project-ref
            AGENTEVE_RESEND_AUTH_KEY            SMTP for sign-in mail (Supabase's built-in mail is
                                                capped at a few messages an hour: set this)
            AGENTEVE_GOOGLE_OAUTH_CLIENT_ID / AGENTEVE_GOOGLE_OAUTH_CLIENT_SECRET
            AGENTEVE_GITHUB_OAUTH_CLIENT_ID / AGENTEVE_GITHUB_OAUTH_CLIENT_SECRET
            AGENTEVE_MCP_REVIEWER_EMAIL / AGENTEVE_MCP_REVIEWER_PASSWORD   (connector/SUBMISSION.md)
R2_ACCOUNT_ID is not needed: this architecture uses no Worker, KV or R2.
Values travel only in HTTPS requests to Supabase and Cloudflare and are never printed. The host's
own secrets (master key, gateway secret, database password) are generated ON the host by
provision-mcp.py and never leave it.
"""
import argparse
import json
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HOST = 'root@89.117.78.215'
HOST_IP = '89.117.78.215'
KEY = Path('~/Projects/yc-gstack-kit/credentials/keys/ahmadecho_vps_ed25519').expanduser()
VAULT = Path('~/Projects/yc-gstack-kit/credentials/.env').expanduser()
ZONE = 'agenteve.io'
NAME = 'mcp.agenteve.io'
ORIGIN = f'https://{NAME}'
RESOURCE = f'{ORIGIN}/mcp'
# engine/src/api/gateway.ts is the ONE home of the gateway MAC: the connector bundles it (the engine
# verifies with the same file), so what is sent and what is checked cannot drift.
SHIP = ['connector', 'mcp/client.mjs', 'mcp/spectator.mjs', 'engine/src/core/time.ts', 'engine/src/api/gateway.ts', 'deploy/agenteve-mcp.service', 'deploy/nginx-mcp-agenteve.conf', 'deploy/provision-mcp.py']
ROOT = Path(__file__).resolve().parent.parent

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('--ops-email', help='Let\'s Encrypt account address (kept out of this public repo)')
parser.add_argument('--project-ref')
parser.add_argument('--create-project', action='store_true')
parser.add_argument('--org-slug')
parser.add_argument('--region')
parser.add_argument('--restart-engine', action='store_true', help='restart agenteve.service when provisioning added or changed COMPACT_GATEWAY_SECRET in /etc/agenteve/env (the engine reads it only at start)')
parser.add_argument('--skip-supabase', action='store_true')
parser.add_argument('--skip-dns', action='store_true')
parser.add_argument('--skip-host', action='store_true')
parser.add_argument('--plan', action='store_true', help='print the steps; read nothing, touch nothing')
args = parser.parse_args()

if args.plan:
    print(__doc__)
    sys.exit(0)
if not args.ops_email:
    parser.error('--ops-email is required')

vault_text = VAULT.read_text()
redact: list[str] = []


def secret(name, required=True):
    match = re.search(rf'^{name}=(.+)$', vault_text, re.M)
    if not match:
        if required:
            raise SystemExit(f'{name} is not in the vault')
        return None
    value = match.group(1).strip().strip('"').strip("'")
    redact.append(value)
    return value


def scrub(text):
    for value in redact:
        if value and len(value) >= 6:
            text = text.replace(value, '[redacted]')
    return text


def say(step):
    print(f'\n== {step}', flush=True)


def http(method, url, headers, body=None, form=False, ok=(200, 201, 204)):
    data = None
    if body is not None:
        data = urllib.parse.urlencode(body).encode() if form else json.dumps(body).encode()
    request = urllib.request.Request(url, method=method, data=data, headers={'User-Agent': 'agenteve-deploy/1', 'Content-Type': 'application/x-www-form-urlencoded' if form else 'application/json', **headers})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            raw = response.read().decode()
            return response.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as error:
        text = scrub(error.read().decode()[:600])
        if error.code in ok:
            return error.code, None
        raise SystemExit(f'{method} {scrub(url)} failed: HTTP {error.code} {text}')


def ssh(script, check=True):
    """Run a bash script on the host; secrets never appear on the command line."""
    result = subprocess.run(['ssh', '-i', str(KEY), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=60', '-o', 'ServerAliveInterval=30', HOST, 'bash -s'], input=script, text=True, capture_output=True)
    if check and result.returncode != 0:
        raise SystemExit(f'host step failed:\n{scrub(result.stdout[-2000:])}\n{scrub(result.stderr[-2000:])}')
    return result


# ── 0. what ships is what GitHub has ─────────────────────────────────────────────────────────
say('0/5 preflight')
git = lambda *a: subprocess.run(['git', '-C', str(ROOT), *a], check=True, text=True, capture_output=True).stdout.strip()  # noqa: E731
if git('status', '--porcelain'):
    raise SystemExit('refusing: the working tree is not clean')
if git('rev-parse', '--abbrev-ref', 'HEAD') != 'master':
    raise SystemExit('refusing: not on master')
git('fetch', '-q', 'origin', 'master')
REV = git('rev-parse', 'HEAD')
if REV != git('rev-parse', 'origin/master'):
    raise SystemExit('refusing: HEAD is not origin/master; push first')
print('revision', REV)

supabase_url = None
publishable = None
providers: list[str] = []

# ── 1. Supabase: the authorization server ────────────────────────────────────────────────────
if not args.skip_supabase:
    say('1/5 Supabase Auth (OAuth 2.1 server, signing key, access-token hook, sign-in mail)')
    token = secret('SUPABASE_ACCESS_TOKEN')
    api = 'https://api.supabase.com/v1'
    auth = {'Authorization': f'Bearer {token}'}
    ref = args.project_ref or secret('AGENTEVE_SUPABASE_PROJECT_REF', required=False)
    if ref is None:
        if not (args.create_project and args.org_slug and args.region):
            raise SystemExit('give --project-ref (or AGENTEVE_SUPABASE_PROJECT_REF), or --create-project --org-slug --region')
        # The project's own database is unused (the connector keeps nothing in Supabase but auth
        # configuration), so its password is generated, used once and discarded; reset it in the
        # dashboard if it is ever needed.
        _, created = http('POST', f'{api}/projects', auth, {'name': 'agenteve-auth', 'organization_slug': args.org_slug, 'region': args.region, 'db_pass': secrets.token_urlsafe(32)})
        ref = created['ref']
        print('created Supabase project', ref, '— record it in the vault as AGENTEVE_SUPABASE_PROJECT_REF')
    assert re.fullmatch(r'[a-z0-9]{20}', ref), 'unexpected project ref'
    for _ in range(60):
        _, project = http('GET', f'{api}/projects/{ref}', auth)
        if project.get('status') == 'ACTIVE_HEALTHY':
            break
        time.sleep(10)
    else:
        raise SystemExit('the Supabase project did not become healthy')
    supabase_url = f'https://{ref}.supabase.co'

    # Asymmetric signing, so the connector verifies with the public JWKS and holds no Supabase secret.
    _, keys = http('GET', f'{api}/projects/{ref}/config/auth/signing-keys', auth)
    listed = keys.get('keys', keys) if isinstance(keys, dict) else keys
    if not any(k.get('status') == 'in_use' and k.get('algorithm') in ('ES256', 'RS256', 'EdDSA') for k in listed or []):
        _, standby = http('POST', f'{api}/projects/{ref}/config/auth/signing-keys', auth, {'algorithm': 'ES256', 'status': 'standby'})
        http('PATCH', f'{api}/projects/{ref}/config/auth/signing-keys/{standby["id"]}', auth, {'status': 'in_use'})
        print('rotated to an ES256 signing key')

    hook_sql = (ROOT / 'connector' / 'supabase' / 'access-token-hook.sql').read_text().replace('@RESOURCE@', RESOURCE)
    http('POST', f'{api}/projects/{ref}/database/query', auth, {'query': hook_sql})

    template = (
        '<h2>Sign in to Agent Eve</h2>'
        '<p><a href="{{ .ConfirmationURL }}">Sign in on this device</a></p>'
        '<p>Or type this code where you started signing in: <strong>{{ .Token }}</strong></p>'
        '<p>If you did not ask to sign in, you can ignore this email.</p>'
    )
    config = {
        'site_url': ORIGIN,
        'uri_allow_list': f'{ORIGIN}/**',
        'oauth_server_enabled': True,
        'oauth_server_allow_dynamic_registration': True,
        'oauth_server_authorization_path': '/oauth/consent',
        'hook_custom_access_token_enabled': True,
        'hook_custom_access_token_uri': 'pg-functions://postgres/public/agenteve_mcp_access_token_hook',
        'jwt_exp': 3600,
        'refresh_token_rotation_enabled': True,
        'security_refresh_token_reuse_interval': 10,
        'security_update_password_require_reauthentication': True,
        'mailer_secure_email_change_enabled': True,
        'external_email_enabled': True,
        'mailer_otp_exp': 900,
        'mailer_subjects_magic_link': 'Your Agent Eve sign-in link',
        'mailer_templates_magic_link_content': template,
        'mailer_subjects_confirmation': 'Your Agent Eve sign-in link',
        'mailer_templates_confirmation_content': template,
    }
    resend = secret('AGENTEVE_RESEND_AUTH_KEY', required=False)
    if resend:
        config.update({'smtp_host': 'smtp.resend.com', 'smtp_port': '465', 'smtp_user': 'resend', 'smtp_pass': resend, 'smtp_admin_email': 'signin@agenteve.io', 'smtp_sender_name': 'Agent Eve', 'rate_limit_email_sent': 300})
    else:
        print('WARNING: no AGENTEVE_RESEND_AUTH_KEY — sign-in mail uses Supabase\'s built-in sender, capped at a few an hour')
    for provider, prefix in (('google', 'AGENTEVE_GOOGLE_OAUTH'), ('github', 'AGENTEVE_GITHUB_OAUTH')):
        client_id, client_secret = secret(f'{prefix}_CLIENT_ID', required=False), secret(f'{prefix}_CLIENT_SECRET', required=False)
        if client_id and client_secret:
            config.update({f'external_{provider}_enabled': True, f'external_{provider}_client_id': client_id, f'external_{provider}_secret': client_secret})
            providers.append(provider)
    http('PATCH', f'{api}/projects/{ref}/config/auth', auth, config)

    _, api_keys = http('GET', f'{api}/projects/{ref}/api-keys', auth)
    publishable = next((k['api_key'] for k in api_keys if k.get('type') == 'publishable'), None) or next((k['api_key'] for k in api_keys if k.get('name') == 'anon'), None)
    if not publishable:
        raise SystemExit('no publishable (or anon) key on the project')

    reviewer_email, reviewer_password = secret('AGENTEVE_MCP_REVIEWER_EMAIL', required=False), secret('AGENTEVE_MCP_REVIEWER_PASSWORD', required=False)
    if reviewer_email and reviewer_password:
        # The service key is fetched, used for this one call, and dropped.
        _, revealed = http('GET', f'{api}/projects/{ref}/api-keys?reveal=true', auth)
        service = next((k['api_key'] for k in revealed if k.get('type') == 'secret'), None) or next((k['api_key'] for k in revealed if k.get('name') == 'service_role'), None)
        if not service:
            raise SystemExit('no secret (service) key on the project to create the reviewer login with')
        redact.append(service)
        # New-format secret keys (sb_secret_…) go in `apikey` alone; a legacy service_role JWT also as a bearer.
        admin = {'apikey': service} if service.startswith('sb_secret_') else {'apikey': service, 'Authorization': f'Bearer {service}'}
        # The flag the access-token hook requires before a password sign-in mints a session; only
        # the service key can set app_metadata, so nobody can grant it to themselves.
        flag = {'agenteve_password_signin': True}
        status, _ = http('POST', f'{supabase_url}/auth/v1/admin/users', admin, {'email': reviewer_email, 'password': reviewer_password, 'email_confirm': True, 'app_metadata': flag}, ok=(200, 201, 422))
        if status == 422:
            _, listing = http('GET', f'{supabase_url}/auth/v1/admin/users?page=1&per_page=1000', admin)
            existing = next((u for u in listing.get('users', []) if u.get('email') == reviewer_email.lower()), None)
            if existing is None:
                raise SystemExit('the reviewer login exists but could not be found to flag it')
            http('PUT', f'{supabase_url}/auth/v1/admin/users/{existing["id"]}', admin, {'password': reviewer_password, 'app_metadata': {**(existing.get('app_metadata') or {}), **flag}})
        print('reviewer login', 'created' if status in (200, 201) else 'updated', '(password sign-in flagged)')
        del service

    # Supabase applies an auth-config PATCH asynchronously: the first deploy (2026-10-03) read
    # `feature_disabled: OAuth server is disabled` seconds after enabling it, and the same request
    # answered 200 a minute later. So wait for the discovery document instead of failing on the first read.
    for attempt in range(24):
        status, metadata = http('GET', f'{supabase_url}/.well-known/oauth-authorization-server/auth/v1', {}, ok=(200, 404))
        if status == 200 and metadata:
            break
        time.sleep(5)
    else:
        raise SystemExit('the OAuth 2.1 server is still disabled two minutes after enabling it; check the project in the dashboard')
    assert metadata['issuer'] == f'{supabase_url}/auth/v1', 'issuer mismatch'
    assert 'S256' in metadata['code_challenge_methods_supported'], 'S256 PKCE not advertised'
    assert metadata.get('registration_endpoint'), 'dynamic client registration is not on'
    assert 'none' in metadata['token_endpoint_auth_methods_supported'], 'public clients not accepted'
    print('authorization server', metadata['issuer'], '| registration', metadata['registration_endpoint'])

# ── 2. Cloudflare DNS ────────────────────────────────────────────────────────────────────────
cf = None
record = None
if not args.skip_dns:
    say('2/5 Cloudflare DNS for mcp.agenteve.io')
    cf = {'X-Auth-Email': secret('CLOUDFLARE_EMAIL'), 'X-Auth-Key': secret('CLOUDFLARE_GLOBAL_API_KEY')}
    _, zones = http('GET', f'https://api.cloudflare.com/client/v4/zones?name={ZONE}', cf)
    zone = zones['result'][0]['id']
    _, found = http('GET', f'https://api.cloudflare.com/client/v4/zones/{zone}/dns_records?type=A&name={NAME}', cf)
    if found['result']:
        record = found['result'][0]
    else:
        # DNS-only at first, so Let's Encrypt reaches the origin directly; proxied once the cert exists.
        _, made = http('POST', f'https://api.cloudflare.com/client/v4/zones/{zone}/dns_records', cf, {'type': 'A', 'name': 'mcp', 'content': HOST_IP, 'proxied': False, 'ttl': 120})
        record = made['result']
        print('created A record (DNS-only for now)')
    record['zone'] = zone

# ── 3. The host ──────────────────────────────────────────────────────────────────────────────
if not args.skip_host:
    if supabase_url is None or publishable is None:
        raise SystemExit('the host step needs the Supabase step in the same run (it provides the project URL and publishable key)')
    say('3/5 ship, build, provision, migrate, certificate, nginx, service')
    ssh('rm -rf /opt/agenteve-mcp-next && mkdir -p /opt/agenteve-mcp-next')
    archive = subprocess.run(['git', '-C', str(ROOT), 'archive', '--format=tar', REV, *SHIP], check=True, capture_output=True).stdout
    unpack = subprocess.run(['ssh', '-i', str(KEY), '-o', 'BatchMode=yes', HOST, 'tar -x -C /opt/agenteve-mcp-next'], input=archive, capture_output=True)
    if unpack.returncode:
        raise SystemExit('could not unpack the release on the host')
    ssh(f'''set -euo pipefail
echo {REV} > /opt/agenteve-mcp-next/REVISION
cd /opt/agenteve-mcp-next/connector
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent
npm prune --omit=dev --no-audit --no-fund --loglevel=error
''')
    providers_arg = ','.join(providers)
    provisioned = ssh(f'''set -euo pipefail
python3 /opt/agenteve-mcp-next/deploy/provision-mcp.py --tree /opt/agenteve-mcp-next --supabase-url {supabase_url} --supabase-key {publishable} --providers '{providers_arg}'
''')
    # The provisioner's one JSON line: names and states only, never a value.
    report = json.loads([line for line in provisioned.stdout.splitlines() if line.startswith('{')][-1])
    print('engine gateway secret:', report['engine_gateway_secret'])
    ssh('''set -euo pipefail
chown -R root:root /opt/agenteve-mcp-next && chmod -R go-w /opt/agenteve-mcp-next
# Migrate as the connector's role, its environment read by systemd (never on a command line).
systemd-run --quiet --wait --pipe --uid=agenteve-mcp --gid=agenteve-mcp --property=EnvironmentFile=/etc/agenteve-mcp/env /usr/bin/node /opt/agenteve-mcp-next/connector/dist/migrate.mjs
''')
    if report['engine_restart_needed']:
        if args.restart_engine:
            # A restart replays the record from the newest checkpoint; the world never resets (A10).
            ssh('''set -euo pipefail
systemctl restart agenteve
for _ in $(seq 1 120); do
  if curl -fsS -m 5 -H "CF-Connecting-IP: 127.0.0.1" http://127.0.0.1:8801/api/health 2>/dev/null | grep -q '"world":"RUNNING"'; then exit 0; fi
  sleep 5
done
echo "agenteve did not come back RUNNING within 10 minutes; read journalctl -u agenteve" >&2
exit 1
''')
            print('agenteve.service restarted with the shared COMPACT_GATEWAY_SECRET')
        else:
            print('RESTART NEEDED: the engine reads COMPACT_GATEWAY_SECRET only at start. Until `systemctl restart agenteve` '
                  'runs on the host (or this script with --restart-engine), every account tool is refused 400 GATEWAY_UNVERIFIED.')
    ssh(f'''set -euo pipefail
site=/etc/nginx/sites-available/{NAME}
if [ ! -s /etc/letsencrypt/live/{NAME}/fullchain.pem ]; then
  # Port 80 only, to answer the HTTP-01 challenge from /var/www/{NAME}.
  printf 'server {{\\n listen 80;\\n listen [::]:80;\\n server_name {NAME};\\n root /var/www/{NAME};\\n location ^~ /.well-known/acme-challenge/ {{ try_files $uri =404; }}\\n location / {{ return 503; }}\\n}}\\n' > "$site"
  ln -sf "$site" /etc/nginx/sites-enabled/{NAME}
  nginx -t && systemctl reload nginx
  certbot certonly --webroot -w /var/www/{NAME} -d {NAME} --non-interactive --agree-tos -m '{args.ops_email}' --keep-until-expiring
fi
cp "$site" "$site.prev" 2>/dev/null || true
sed 's#@SUPABASE_ORIGIN@#{supabase_url}#g' /opt/agenteve-mcp-next/deploy/nginx-mcp-agenteve.conf > "$site"
ln -sf "$site" /etc/nginx/sites-enabled/{NAME}
if ! nginx -t; then
  echo "nginx -t failed; restoring the previous vhost"
  if [ -f "$site.prev" ]; then mv "$site.prev" "$site"; else rm -f "$site" /etc/nginx/sites-enabled/{NAME}; fi
  nginx -t && systemctl reload nginx
  exit 1
fi
systemctl reload nginx
''')
    ssh('''set -euo pipefail
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
if ! cmp -s /opt/agenteve-mcp-next/deploy/agenteve-mcp.service /etc/systemd/system/agenteve-mcp.service; then
  install -m 0644 /opt/agenteve-mcp-next/deploy/agenteve-mcp.service /etc/systemd/system/agenteve-mcp.service
  systemctl daemon-reload
fi
systemctl stop agenteve-mcp 2>/dev/null || true
if [ -d /opt/agenteve-mcp ]; then mv /opt/agenteve-mcp "/opt/agenteve-mcp-prev-$stamp"; fi
mv /opt/agenteve-mcp-next /opt/agenteve-mcp
systemctl enable --now agenteve-mcp
for _ in $(seq 1 12); do curl -fsS -m 3 http://127.0.0.1:8810/healthz >/dev/null 2>&1 && break; sleep 2; done
if ! curl -fsS -m 3 http://127.0.0.1:8810/healthz >/dev/null; then
  echo "the new connector did not come up; rolling back"
  systemctl stop agenteve-mcp || true
  mv /opt/agenteve-mcp "/opt/agenteve-mcp-failed-$stamp"
  if ls -d /opt/agenteve-mcp-prev-$stamp >/dev/null 2>&1; then mv "/opt/agenteve-mcp-prev-$stamp" /opt/agenteve-mcp && systemctl start agenteve-mcp; fi
  exit 1
fi
ls -1d /opt/agenteve-mcp-prev-* 2>/dev/null | sort | head -n -2 | xargs -r rm -rf
echo "connector up; previous tree kept as /opt/agenteve-mcp-prev-$stamp"
''')
    if cf is not None and record is not None and not record.get('proxied'):
        http('PATCH', f'https://api.cloudflare.com/client/v4/zones/{record["zone"]}/dns_records/{record["id"]}', cf, {'proxied': True})
        print('DNS record now proxied through Cloudflare')

# ── 4. Verify, including what this script did not touch ──────────────────────────────────────
say('4/5 verify')
engine = ssh('systemctl is-active agenteve && curl -sS -m 10 -H "CF-Connecting-IP: 127.0.0.1" http://127.0.0.1:8801/api/health', check=False)
print('engine:', 'active' if engine.stdout.startswith('active') else 'NOT ACTIVE — investigate before anything else')
gateway_state = re.search(r'"gateway":"(configured|unset|malformed)"', engine.stdout)
print('engine gateway header:', gateway_state.group(1) if gateway_state else 'not reported (an engine build older than the gateway change)')
if not gateway_state or gateway_state.group(1) != 'configured':
    print('WARNING: until the engine reports gateway "configured", every account tool is refused 400 GATEWAY_UNVERIFIED.')
time.sleep(5)
_, prm = http('GET', f'{ORIGIN}/.well-known/oauth-protected-resource/mcp', {})
assert prm['resource'] == RESOURCE, 'protected resource metadata names the wrong resource'
print('protected resource metadata ->', prm['authorization_servers'])
mcp_headers = {'Accept': 'application/json, text/event-stream'}
_, init = http('POST', RESOURCE, mcp_headers, {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'agenteve-deploy', 'version': '1'}}})
_, listed = http('POST', RESOURCE, {**mcp_headers, 'Mcp-Protocol-Version': '2025-06-18'}, {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}})
print('tools:', len(listed['result']['tools']))
request = urllib.request.Request(RESOURCE, method='POST', data=json.dumps({'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'eve_observe', 'arguments': {}}}).encode(), headers={**mcp_headers, 'Content-Type': 'application/json', 'User-Agent': 'agenteve-deploy/1'})
try:
    urllib.request.urlopen(request, timeout=30)
    raise SystemExit('an account tool answered WITHOUT sign-in')
except urllib.error.HTTPError as error:
    assert error.code == 401 and 'resource_metadata=' in (error.headers.get('WWW-Authenticate') or ''), 'expected a 401 sign-in challenge'
    print('signed-out account tool -> 401 with resource_metadata (lazy authentication works)')

say('5/5 done')
print(f'''Connector live at {RESOURCE}.
  ChatGPT: Settings -> Apps & Connectors -> Advanced -> Developer mode; add {RESOURCE} (OAuth).
  Claude:  Customize -> Connectors -> Add custom connector -> {RESOURCE}.
REMINDER: escrow the master key (/etc/agenteve-mcp/env, EVE_MCP_MASTER_KEYS) somewhere the owner
controls. Lose it and every hosted principal is stranded for good. See connector/README.md.''')
