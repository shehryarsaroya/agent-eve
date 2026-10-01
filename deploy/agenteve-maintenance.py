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

# The off-server copy: R2 bucket `daily/` (a lifecycle rule expires it after 30 days). Runs after the
# local copy and the pruning, so a failed upload leaves this machine's backups exactly as they were,
# and it raises, so systemd records the failure. Credentials stay in a 0600 curl config file rather
# than on a command line, which every user of this shared host could read in /proc.
offsite = Path('/etc/agenteve/backup.env')
if offsite.exists():
    conf = dict(line.split('=', 1) for line in offsite.read_text().splitlines() if '=' in line)
    url = f"{conf['AGENTEVE_R2_ENDPOINT'].rstrip('/')}/{conf['AGENTEVE_R2_BUCKET']}/daily/{target.name}"
    curl = ['curl', '--fail', '--silent', '--show-error', '--retry', '3', '-K', '/etc/agenteve/r2.curlrc']
    subprocess.run(curl + ['-T', str(target), url], check=True)
    head = subprocess.run(curl + ['--head', url], check=True, text=True, capture_output=True).stdout
    size = next((int(line.split(':', 1)[1]) for line in head.splitlines() if line.lower().startswith('content-length:')), -1)
    if size != target.stat().st_size:
        raise RuntimeError(f'off-server copy of {target.name} is {size} bytes, local is {target.stat().st_size}')
    print(f'Off-server copy verified: daily/{target.name}, {size} bytes.')
