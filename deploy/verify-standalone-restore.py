"""Restore the newest backup into a disposable database and boot the actual engine."""
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request

database = 'compact_restore_check'
backup = sorted(Path('/var/lib/agenteve/backups').glob('world-*.dump'))[-1]
prefix = ['docker', 'exec', 'agenteve-db']
exists = subprocess.run(prefix + ['psql', '-U', 'compact', '-d', 'compact', '-Atc', f"SELECT 1 FROM pg_database WHERE datname='{database}'"], text=True, capture_output=True, check=True).stdout.strip()
if exists:
    raise RuntimeError('Restore-check database already exists; refusing to overwrite it')
subprocess.run(prefix + ['createdb', '-U', 'compact', '-T', 'template0', '--locale=C', database], check=True)
process = None
try:
    with backup.open('rb') as source:
        subprocess.run(['docker', 'exec', '-i', 'agenteve-db', 'pg_restore', '-U', 'compact', '-d', database, '--exit-on-error'], stdin=source, check=True)
    env = dict(os.environ)
    env.update(dict(line.split('=', 1) for line in Path('/etc/agenteve/env').read_text().splitlines()))
    env.update(PGDATABASE=database, COMPACT_PORT='8802', COMPACT_SPEED='prod', COMPACT_FRAMES_DIR='/var/lib/agenteve/restore-frames')
    with open('/var/lib/agenteve/restore-check.log', 'w') as log:
        process = subprocess.Popen(['/usr/bin/node', '/opt/agenteve/deploy/run-standalone.mjs'], env=env, stdout=log, stderr=log)
        for attempt in range(45):
            time.sleep(1)
            if process.poll() is not None:
                raise RuntimeError('Restored engine exited; read restore-check.log')
            try:
                req = urllib.request.Request('http://127.0.0.1:8802/health', headers={'CF-Connecting-IP': '127.0.0.1'})
                with urllib.request.urlopen(req, timeout=2) as response:
                    report = json.load(response)['report']
                if report['world'] == 'RUNNING':
                    assert report['durability']['healthy']
                    assert report['tick'] > 0
                    assert report['seats']['occupied'] >= 3
                    print(json.dumps({'backup': backup.name, 'status': 'RESTORE_PASSED', 'tick': report['tick'], 'state_hash': report['state_hash'], 'population': report['seats']['population'], 'enrolled_agents': report['seats']['occupied']}))
                    break
            except (urllib.error.URLError, ConnectionError):
                pass
        else:
            raise RuntimeError('Restored engine did not become healthy; read restore-check.log')
finally:
    if process is not None:
        process.terminate()
        process.wait(timeout=30)
    subprocess.run(prefix + ['dropdb', '-U', 'compact', database], check=True)
