/**
 * The deploy ships what the bundle imports.
 *
 * This service bundles a few files from outside its own package — the bridge's signer and spectator
 * summaries, the engine's clock and, since the engine verifies the gateway header, the engine's own
 * gateway module (one home for the MAC). `deploy/deploy-mcp.py` ships the pushed commit with
 * `git archive` and an explicit file list, so a new cross-package import that is not on that list
 * builds here and fails on the host, mid-deploy. This finds it here.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CONNECTOR = fileURLToPath(new URL('..', import.meta.url));
const ROOT = resolve(CONNECTOR, '..');
const DEPLOY = readFileSync(join(ROOT, 'deploy', 'deploy-mcp.py'), 'utf8');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

/** Every import in `src/` that leaves the connector package, as a repo-relative path. */
function crossPackageImports(): string[] {
  const found = new Set<string>();
  for (const file of sources(join(CONNECTOR, 'src'))) {
    for (const m of readFileSync(file, 'utf8').matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), m[1] ?? '');
      if (target.startsWith(CONNECTOR)) continue;
      found.add(relative(ROOT, target).replace(/\.js$/, '.ts').replace(/\\/g, '/'));
    }
  }
  return [...found].sort();
}

describe('deploy-mcp.py ships every file the bundle reaches outside connector/', () => {
  it('finds the cross-package imports, the engine gateway among them', () => {
    const imports = crossPackageImports();
    expect(imports).toContain('engine/src/api/gateway.ts');
    expect(imports).toContain('engine/src/core/time.ts');
    expect(imports).toContain('mcp/spectator.mjs');
  });

  it('every one of them is on the SHIP list', () => {
    const ship = /SHIP = \[([^\]]*)\]/.exec(DEPLOY)?.[1] ?? '';
    for (const path of crossPackageImports()) expect(ship, `${path} is bundled but not shipped`).toContain(`'${path}'`);
  });

  it('the engine gateway module imports nothing but node:crypto, so shipping that one file is enough', () => {
    const gateway = readFileSync(join(ROOT, 'engine', 'src', 'api', 'gateway.ts'), 'utf8');
    const imports = [...gateway.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(imports).toEqual(['node:crypto']);
  });
});
