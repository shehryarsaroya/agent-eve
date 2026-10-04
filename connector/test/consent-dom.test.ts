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

async function load(signedIn: boolean, clientName = 'Claude', options: { handoffDown?: boolean } = {}) {
  vi.resetModules();
  document.body.innerHTML = '<main id="app"></main>';
  window.sessionStorage.clear();
  window.localStorage.clear();
  const client = fakeSupabase(signedIn, clientName);
  Object.assign(window, {
    EVE_CONSENT: { supabaseUrl: 'https://x.supabase.co', supabaseKey: 'sb_publishable_test', providers: ['github'], passwordSignIn: true, knownRedirectHosts: ['claude.ai'], gameOrigin: 'https://agenteve.io' },
    supabase: { createClient: () => client },
  });
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === '/oauth/handoff' && init?.method === 'POST') {
      return options.handoffDown ? reply(503, { error: 'unavailable' }) : reply(201, { id: 'h1', secret: 's1', word: 'TIGER-42', expires_in: 600 });
    }
    if (path.startsWith('/oauth/handoff/')) return reply(200, { status: 'waiting' });
    return reply(200, { handle: 'brannock' });
  }) as typeof fetch;
  await import('../public/oauth/consent.js');
  await settle();
  return client;
}

describe('the consent page in a browser', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('asks a signed-out person for an email and sends a link that works on any device', async () => {
    const client = await load(false);
    expect(document.querySelector('h1')?.textContent).toBe('Sign in to Agent Eve');
    const email = document.querySelector<HTMLInputElement>('#email') as HTMLInputElement;
    email.value = 'p@example.com';
    document.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(client.calls).toContainEqual(['otp', { email: 'p@example.com', options: { emailRedirectTo: 'https://mcp.test.example/oauth/confirm?handoff=h1', shouldCreateUser: true } }]);
    expect(document.body.textContent).toContain('Open it on any device');
    expect(document.body.textContent).toContain('If it asks for a word, type:');
    expect(document.querySelector('.word')?.textContent).toBe('TIGER-42');
    expect(document.querySelector<HTMLElement>('#code-row')?.hidden).toBe(false);
    // Usable again while the page waits, so a second email needs no reload.
    const send = document.querySelector<HTMLButtonElement>('form button[type=submit]');
    expect(send?.disabled).toBe(false);
    expect(send?.textContent).toBe('Send a new link');
    // Left for the confirm page, should the email be opened in this same browser.
    expect(JSON.parse(window.localStorage.getItem('eve-handoff-word') ?? 'null')).toMatchObject({ id: 'h1', word: 'TIGER-42' });
  });

  it('falls back to a link back to this request when no handoff can be opened', async () => {
    const client = await load(false, 'Claude', { handoffDown: true });
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
