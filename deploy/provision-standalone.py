"""Run as root on the intended host. Provision only Agent Eve's named resources."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import time


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs)


assert os.geteuid() == 0
if subprocess.run(['id', 'agenteve'], capture_output=True).returncode:
    run(['useradd', '--system', '--home-dir', '/var/lib/agenteve', '--shell', '/usr/sbin/nologin', 'agenteve'])
for directory in ['/opt/agenteve/engine', '/opt/agenteve/deploy', '/etc/agenteve', '/var/lib/agenteve/postgres', '/var/lib/agenteve/frames', '/var/lib/agenteve/backups', '/var/www/agenteve.io/.well-known/acme-challenge']:
    Path(directory).mkdir(parents=True, exist_ok=True)
os.chmod('/etc/agenteve', 0o700)
os.chmod('/var/lib/agenteve/backups', 0o700)
run(['chown', 'agenteve:www-data', '/var/lib/agenteve/frames'])
os.chmod('/var/lib/agenteve/frames', 0o2750)

env = Path('/etc/agenteve/env')
if not env.exists():
    owner_password = secrets.token_hex(32)
    app_password = secrets.token_hex(32)
    files = {
        '/etc/agenteve/postgres.env': f'POSTGRES_USER=compact\nPOSTGRES_DB=compact\nPOSTGRES_PASSWORD={owner_password}\nPOSTGRES_INITDB_ARGS=--locale=C --encoding=UTF8\n',
        '/etc/agenteve/migrate.env': f'PGHOST=127.0.0.1\nPGPORT=5546\nPGDATABASE=compact\nPGUSER=compact\nPGPASSWORD={owner_password}\n',
        '/etc/agenteve/env': f'NODE_ENV=production\nPGHOST=127.0.0.1\nPGPORT=5546\nPGDATABASE=compact\nPGUSER=compact_app\nPGPASSWORD={app_password}\nCOMPACT_PORT=8801\nCOMPACT_SEED=agenteve-2026-09-20\nCOMPACT_SPEED=prod\nCOMPACT_CAST=12\nCOMPACT_CAST_LLM=0\nCOMPACT_FRAMES_DIR=/var/lib/agenteve/frames\n',
    }
    for name, content in files.items():
        with open(name, 'x') as stream:
            os.chmod(name, 0o600)
            stream.write(content)

if subprocess.run(['docker', 'inspect', 'agenteve-db'], capture_output=True).returncode:
    run(['docker', 'run', '-d', '--name', 'agenteve-db', '--restart', 'unless-stopped', '--memory', '1g', '--cpus', '2', '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3', '--env-file', '/etc/agenteve/postgres.env', '-p', '127.0.0.1:5546:5432', '--mount', 'type=bind,source=/var/lib/agenteve/postgres,target=/var/lib/postgresql/data', 'postgres:16-alpine', '-c', 'max_connections=40', '-c', 'max_wal_size=1GB'])
for attempt in range(30):
    if subprocess.run(['docker', 'exec', 'agenteve-db', 'pg_isready', '-U', 'compact'], capture_output=True).returncode == 0:
        break
    time.sleep(1)
else:
    raise RuntimeError('Agent Eve database did not become ready')
exists = run(['docker', 'exec', 'agenteve-db', 'psql', '-U', 'compact', '-d', 'compact', '-Atc', "SELECT 1 FROM pg_roles WHERE rolname='compact_app'"]).stdout.strip()
if exists != '1':
    values = dict(line.split('=', 1) for line in env.read_text().splitlines())
    password = values['PGPASSWORD']
    assert len(password) == 64 and all(c in '0123456789abcdef' for c in password)
    run(['docker', 'exec', '-i', 'agenteve-db', 'psql', '-U', 'compact', '-d', 'compact', '-v', 'ON_ERROR_STOP=1'], input=f"CREATE ROLE compact_app LOGIN PASSWORD '{password}' NOSUPERUSER NOCREATEDB NOCREATEROLE;\n")

bootstrap = Path('/etc/nginx/sites-available/agenteve.io')
if not bootstrap.exists():
    bootstrap.write_text('''server {
    listen 80;
    listen [::]:80;
    server_name agenteve.io www.agenteve.io;
    root /var/www/agenteve.io;
    location ^~ /.well-known/acme-challenge/ { try_files $uri =404; }
    location / { return 503 "Agent Eve is being restored.\\n"; }
}
''')
    Path('/etc/nginx/sites-enabled/agenteve.io').symlink_to(bootstrap)
    try:
        run(['nginx', '-t'])
    except Exception:
        Path('/etc/nginx/sites-enabled/agenteve.io').unlink()
        raise
    run(['systemctl', 'reload', 'nginx'])
print(json.dumps({'database': 'agenteve-db', 'database_port': 5546, 'api_port': 8801, 'secrets': 'created on host; not returned', 'http_challenge_ready': True}))
