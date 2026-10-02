"""Deploy deploy/uptime-worker.js as the Cloudflare Worker `agenteve-uptime` with a 5-minute cron.

Run on the operator's machine:
    python3 deploy/deploy-uptime-worker.py --alert-to <address> [--test-alert]

Reads, by name only, from the private kit vault (~/Projects/yc-gstack-kit/credentials/.env):
CLOUDFLARE_EMAIL, CLOUDFLARE_GLOBAL_API_KEY, R2_ACCOUNT_ID (the Cloudflare account id) and
AGENTEVE_RESEND_ALERTS_KEY. Values travel only in the HTTPS request to Cloudflare and are never
printed. The alert address is an argument so it stays out of this public repository.
--test-alert binds TEST_ALERT=1 so the next run mails a test; deploy again without it afterwards.
"""
import argparse
import json
import os
import re
import urllib.error
import urllib.request
import uuid
from pathlib import Path

SCRIPT = 'agenteve-uptime'
NAMESPACE = 'agenteve-uptime'
CRON = '*/5 * * * *'

parser = argparse.ArgumentParser()
parser.add_argument('--alert-to', required=True)
parser.add_argument('--test-alert', action='store_true')
args = parser.parse_args()
vault = Path('~/Projects/yc-gstack-kit/credentials/.env').expanduser().read_text()


def secret(name):
    match = re.search(rf'^{name}=(.+)$', vault, re.M)
    if not match:
        raise SystemExit(f'{name} is not in the vault')
    return match.group(1).strip().strip('"').strip("'")


email, key, account = secret('CLOUDFLARE_EMAIL'), secret('CLOUDFLARE_GLOBAL_API_KEY'), secret('R2_ACCOUNT_ID')
resend = secret('AGENTEVE_RESEND_ALERTS_KEY')
redact = [key, resend]


def api(method, path, body=None, content_type='application/json'):
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    request = urllib.request.Request(f'https://api.cloudflare.com/client/v4/accounts/{account}{path}', method=method, data=data,
                                     headers={'X-Auth-Email': email, 'X-Auth-Key': key, 'Content-Type': content_type, 'User-Agent': 'agenteve-deploy/1'})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        text = error.read().decode()[:500]
        for value in redact:
            text = text.replace(value, '[redacted]')
        raise SystemExit(f'{method} {path} failed: HTTP {error.code} {text}')


namespaces = api('GET', '/storage/kv/namespaces?per_page=100')['result']
namespace = next((n['id'] for n in namespaces if n['title'] == NAMESPACE), None)
if namespace is None:
    namespace = api('POST', '/storage/kv/namespaces', {'title': NAMESPACE})['result']['id']
    print('created KV namespace', NAMESPACE)

bindings = [
    {'type': 'kv_namespace', 'name': 'STATE', 'namespace_id': namespace},
    {'type': 'secret_text', 'name': 'RESEND_API_KEY', 'text': resend},
    {'type': 'secret_text', 'name': 'ALERT_TO', 'text': args.alert_to},
]
if args.test_alert:
    bindings.append({'type': 'plain_text', 'name': 'TEST_ALERT', 'text': '1'})
metadata = {'main_module': 'worker.js', 'compatibility_date': '2026-09-01', 'bindings': bindings}
boundary = uuid.uuid4().hex
code = (Path(__file__).parent / 'uptime-worker.js').read_bytes()
body = b''.join([
    f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'.encode(),
    json.dumps(metadata).encode(),
    f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="worker.js"; filename="worker.js"\r\nContent-Type: application/javascript+module\r\n\r\n'.encode(),
    code,
    f'\r\n--{boundary}--\r\n'.encode(),
])
api('PUT', f'/workers/scripts/{SCRIPT}', body, f'multipart/form-data; boundary={boundary}')
api('PUT', f'/workers/scripts/{SCRIPT}/schedules', [{'cron': CRON}])
schedules = api('GET', f'/workers/scripts/{SCRIPT}/schedules')['result']['schedules']
print(f'deployed {SCRIPT}: cron {[s["cron"] for s in schedules]}, KV {NAMESPACE}, test alert {"ON for the next run" if args.test_alert else "off"}')
