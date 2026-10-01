"""Restore the newest backup into a disposable database and boot the actual engine.

`--engine-dir DIR` boots a different build (default: the deployed one). The deploy uses it to
prove a NEW build migrates and adopts today's record before the live tree is touched.
"""
import argparse
import http.client
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--engine-dir', default='/opt/agenteve', help='tree containing engine/ and deploy/')
root = Path(parser.parse_args().engine_dir)
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
    # Identities are never deleted, so every enrolment in the dump must come back as a seat row.
    # Occupancy is not the test: an idle seat is recycled after four Reckonings.
    enrolled = int(subprocess.run(prefix + ['psql', '-U', 'compact', '-d', database, '-Atc', 'SELECT count(*) FROM journal_enrollment'], text=True, capture_output=True, check=True).stdout)
    # The build under test brings its own schema changes, so migrate the copy with them first.
    migrate = dict(os.environ)
    migrate.update(dict(line.split('=', 1) for line in Path('/etc/agenteve/migrate.env').read_text().splitlines()))
    migrate.update(PGDATABASE=database)
    subprocess.run(['/usr/bin/node', str(root / 'engine/dist/db/migrate.js')], env=migrate, check=True, stdout=subprocess.DEVNULL)
    env = dict(os.environ)
    env.update(dict(line.split('=', 1) for line in Path('/etc/agenteve/env').read_text().splitlines()))
    env.update(PGDATABASE=database, COMPACT_PORT='8802', COMPACT_SPEED='prod', COMPACT_FRAMES_DIR='/var/lib/agenteve/restore-frames')
    # The copy must have no side effects outside its own database: no paid model calls, no
    # writes to the live cast's memory file, and no mail to real followers.
    env.update(COMPACT_CAST_LLM='0')
    for name in ('OPENAI_API_KEY', 'COMPACT_CAST_MEMORY', 'RESEND_API_KEY'):
        env.pop(name, None)
    with open('/var/lib/agenteve/restore-check.log', 'w') as log:
        process = subprocess.Popen(['/usr/bin/node', str(root / 'deploy/run-standalone.mjs')], env=env, stdout=log, stderr=log)
        # Hydration is synchronous, so a booting engine can accept a connection and not answer it
        # for several seconds. A read timeout, a refused connection and a 503 all mean "not yet".
        deadline = time.monotonic() + 600
        last = 'no response'
        while time.monotonic() < deadline:
            time.sleep(1)
            if process.poll() is not None:
                raise RuntimeError('Restored engine exited; read restore-check.log')
            try:
                req = urllib.request.Request('http://127.0.0.1:8802/health', headers={'CF-Connecting-IP': '127.0.0.1'})
                with urllib.request.urlopen(req, timeout=10) as response:
                    report = json.load(response)['report']
            except (OSError, http.client.HTTPException) as error:
                last = repr(error)
                continue
            if report['world'] == 'RUNNING':
                assert report['durability']['healthy'], report['durability']
                assert report['tick'] > 0
                assert report['seats']['rows'] == enrolled, (report['seats'], enrolled)
                print(json.dumps({'engine': str(root), 'backup': backup.name, 'status': 'RESTORE_PASSED', 'tick': report['tick'], 'state_hash': report['state_hash'], 'population': report['seats']['population'], 'enrolled_identities': enrolled, 'seated_agents': report['seats']['occupied']}))
                break
            last = f"world {report['world']}"
        else:
            raise RuntimeError(f'Restored engine did not become healthy ({last}); read restore-check.log')
finally:
    if process is not None:
        process.terminate()
        process.wait(timeout=30)
    subprocess.run(prefix + ['dropdb', '-U', 'compact', database], check=True)
