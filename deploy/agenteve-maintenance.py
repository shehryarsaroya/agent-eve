"""Daily bounded backups and partition runway maintenance; root-only systemd job."""
import datetime
import os
from pathlib import Path
import subprocess

env = dict(os.environ)
env.update(dict(line.split('=', 1) for line in Path('/etc/agenteve/migrate.env').read_text().splitlines()))
subprocess.run(['/usr/bin/node', '/opt/agenteve/engine/dist/db/migrate.js'], env=env, check=True)
directory = Path('/var/lib/agenteve/backups')
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
target = directory / f'world-{stamp}.dump'
temporary = target.with_suffix('.tmp')
with temporary.open('xb') as output:
    os.chmod(temporary, 0o600)
    subprocess.run(['docker', 'exec', 'agenteve-db', 'pg_dump', '-U', 'compact', '-d', 'compact', '-Fc'], stdout=output, check=True)
temporary.replace(target)
for old in sorted(directory.glob('world-*.dump'))[:-14]:
    old.unlink()
print(f'Backup saved: {target.name}, {target.stat().st_size} bytes; retaining 14 snapshots.')
