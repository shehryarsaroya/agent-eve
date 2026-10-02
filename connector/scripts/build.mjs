#!/usr/bin/env node
// Bundle the service into dist/ with esbuild.
//
// npm packages stay external (installed by `npm ci --omit=dev` on the host); relative imports
// are bundled, which is how the stdio bridge's own signer and spectator summaries
// (`../mcp/client.mjs`, `../mcp/spectator.mjs`) ship inside this service without a second copy
// of either. One home per concept: a fix to the bridge's signer is a fix here.
import { build } from 'esbuild';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
rmSync(`${root}/dist`, { recursive: true, force: true });
mkdirSync(`${root}/dist`, { recursive: true });

const shared = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
};

await build({ ...shared, entryPoints: [`${root}/src/main.ts`], outfile: `${root}/dist/main.mjs` });
await build({ ...shared, entryPoints: [`${root}/src/migrate-cli.ts`], outfile: `${root}/dist/migrate.mjs` });
