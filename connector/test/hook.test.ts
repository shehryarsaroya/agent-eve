/**
 * The Supabase access-token hook, run for real in Postgres (PGlite): connector tokens get this
 * resource as their audience; sign-in sessions keep Supabase's default.
 */

import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RESOURCE = 'https://mcp.agenteve.io/mcp';
let pg: PGlite;

beforeAll(async () => {
  pg = await PGlite.create();
  const sql = readFileSync(new URL('../supabase/access-token-hook.sql', import.meta.url), 'utf8')
    .replaceAll('@RESOURCE@', RESOURCE)
    // Supabase's roles do not exist here; the grants are exercised by the real project.
    .split('\n')
    .filter((line) => !/^(grant|revoke) /.test(line))
    .join('\n');
  await pg.exec(sql);
});
afterAll(async () => {
  await pg.close();
});

async function hook(event: unknown): Promise<{ claims: Record<string, unknown> }> {
  const { rows } = await pg.query<{ out: { claims: Record<string, unknown> } }>('select public.agenteve_mcp_access_token_hook($1::jsonb) as out', [JSON.stringify(event)]);
  return rows[0]?.out as { claims: Record<string, unknown> };
}

const base = { aud: 'authenticated', sub: '8ccaa7af-909f-44e7-84cb-67cdccb56be6', role: 'authenticated', exp: 1, iat: 0, email: '', phone: '', aal: 'aal1', session_id: 's', is_anonymous: false };

describe('the access-token hook', () => {
  it('binds connector tokens to this resource, on issue and on refresh', async () => {
    for (const method of ['oauth_provider/authorization_code', 'token_refresh']) {
      const out = await hook({ user_id: base.sub, authentication_method: method, claims: { ...base, client_id: 'c-1' } });
      expect(out.claims['aud']).toBe(RESOURCE);
      expect(out.claims['client_id']).toBe('c-1');
      expect(out.claims['sub']).toBe(base.sub);
    }
  });

  it('leaves sign-in session tokens alone', async () => {
    for (const method of ['magiclink', 'password', 'oauth', 'otp']) {
      const out = await hook({ user_id: base.sub, authentication_method: method, claims: { ...base } });
      expect(out.claims).toEqual(base);
    }
  });
});
