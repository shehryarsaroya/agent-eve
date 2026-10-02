// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://mcp.test.example/oauth/consent?authorization_id=auth-1"}
/**
 * The consent page's DOM layer (`public/oauth/consent.js`) in a browser-like environment: it
 * renders, wires its buttons to supabase-js, and puts a client-chosen name in as text, never HTML.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function fakeSupabase(signedIn: boolean, clientName: string) {
  const calls: unknown[][] = [];
  const client = {
    calls,
    auth: {
      getSession: async () => ({ data: { session: signedIn ? { access_token: 'session-token' } : null } }),
      signInWithOtp: async (args: unknown) => (calls.push(['otp', args]), { error: null }),
      verifyOtp: async () => ({ error: null }),
      signInWithPassword: async () => ({ error: null }),
      signInWithOAuth: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
      oauth: {
        getAuthorizationDetails: async (id: string) => ({
          data: { authorization_id: id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', client: { id: 'c', name: clientName }, user: { id: 'u', email: 'p@example.com' }, scope: 'email' },
          error: null,
        }),
        approveAuthorization: async (id: string) => (calls.push(['approve', id]), { data: { redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=1' }, error: null }),
        denyAuthorization: async (id: string) => (calls.push(['deny', id]), { data: { redirect_url: 'https://claude.ai/api/mcp/auth_callback?error=access_denied' }, error: null }),
      },
    },
  };
  return client;
}

async function load(signedIn: boolean, clientName = 'Claude') {
  vi.resetModules();
  document.body.innerHTML = '<main id="app"></main>';
  const client = fakeSupabase(signedIn, clientName);
  Object.assign(window, {
    EVE_CONSENT: { supabaseUrl: 'https://x.supabase.co', supabaseKey: 'sb_publishable_test', providers: ['github'], passwordSignIn: true, knownRedirectHosts: ['claude.ai'], gameOrigin: 'https://agenteve.io' },
    supabase: { createClient: () => client },
  });
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ handle: 'brannock' }), { status: 200 })) as typeof fetch;
  await import('../public/oauth/consent.js');
  await settle();
  return client;
}

describe('the consent page in a browser', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('asks a signed-out person for an email and sends the link back to this request', async () => {
    const client = await load(false);
    expect(document.querySelector('h1')?.textContent).toBe('Sign in to Agent Eve');
    const email = document.querySelector<HTMLInputElement>('#email');
    expect(email).not.toBeNull();
    expect(document.body.textContent).toContain('Continue with GitHub');
    expect(document.body.textContent).toContain('Have a password? (review accounts)');
    (email as HTMLInputElement).value = 'p@example.com';
    document.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(client.calls).toContainEqual(['otp', { email: 'p@example.com', options: { emailRedirectTo: 'https://mcp.test.example/oauth/consent?authorization_id=auth-1', shouldCreateUser: true } }]);
    expect(document.body.textContent).toContain('We emailed a sign-in link and a code to p@example.com');
    expect(document.querySelector<HTMLElement>('#code-row')?.hidden).toBe(false);
  });

  it('shows the consent screen, renders a hostile client name as text, and approves', async () => {
    const hostile = '<img src=x onerror="window.pwned=1">';
    const client = await load(true, hostile);
    expect(document.querySelector('.client')?.textContent).toBe(hostile);
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('Your agent: brannock');
    expect(document.body.textContent).toContain('Nothing in the game has real-money value');
    expect(document.body.textContent).toContain('claude.ai');
    const allow = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Allow');
    allow?.click();
    await settle();
    expect(client.calls).toContainEqual(['approve', 'auth-1']);
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });
});
